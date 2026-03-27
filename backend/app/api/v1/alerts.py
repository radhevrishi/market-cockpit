"""FastAPI router for alert rules and alert instances."""

from uuid import UUID
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.alert import AlertRule, AlertInstance
from app.schemas.alert import AlertRuleCreate, AlertRuleRead, AlertRuleUpdate, AlertInstanceRead

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/rules", response_model=list[AlertRuleRead])
async def list_alert_rules(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all alert rules for the current user. Returns [] if none."""
    try:
        result = await db.execute(
            select(AlertRule)
            .where(AlertRule.user_id == UUID(user_id))
            .order_by(desc(AlertRule.created_at))
        )
        return result.scalars().all()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"list_alert_rules error: {e}")
        return []


def _map_frontend_rule_type(frontend_type: str) -> str:
    """Map frontend rule_type values to backend enum values."""
    mapping = {
        "PRICE": "PRICE_LEVEL",
        "NEWS": "NEWS_TRIGGER",
        # Keep existing backend values as-is
        "PRICE_LEVEL": "PRICE_LEVEL",
        "PRICE_PCT": "PRICE_PCT",
        "EARNINGS_NEAR": "EARNINGS_NEAR",
        "NEWS_TRIGGER": "NEWS_TRIGGER",
        "VOLUME_SPIKE": "VOLUME_SPIKE",
    }
    return mapping.get(frontend_type, frontend_type)


@router.post("/rules", response_model=AlertRuleRead, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    data: AlertRuleCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new alert rule."""
    try:
        # Map frontend rule_type to backend values
        backend_rule_type = _map_frontend_rule_type(data.rule_type)

        rule = AlertRule(
            user_id=UUID(user_id),
            name=data.name,
            is_active=getattr(data, 'is_active', True),
            rule_type=backend_rule_type,
            ticker=getattr(data, 'ticker', None),
            exchange=getattr(data, 'exchange', None),
            conditions=getattr(data, 'conditions', {}),
            news_conditions=getattr(data, 'news_conditions', None),
            notification_channels=getattr(data, 'notification_channels', {'email': True}),
            cooldown_minutes=getattr(data, 'cooldown_minutes', 60),
        )
        db.add(rule)
        await db.commit()
        await db.refresh(rule)
        return rule
    except Exception as e:
        await db.rollback()
        # Return user-friendly error message
        error_msg = str(e)
        if "Input should be a valid" in error_msg or "validation error" in error_msg.lower():
            error_msg = "Invalid alert configuration. Please check all required fields."
        raise HTTPException(status_code=400, detail=error_msg)


@router.patch("/rules/{rule_id}", response_model=AlertRuleRead)
async def update_alert_rule(
    rule_id: UUID,
    data: AlertRuleUpdate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rule = await db.get(AlertRule, rule_id)
        if not rule or rule.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Alert rule not found")
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(rule, field, value)
        await db.commit()
        await db.refresh(rule)
        return rule
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rule = await db.get(AlertRule, rule_id)
        if not rule or rule.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Alert rule not found")
        await db.delete(rule)
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/instances", response_model=list[AlertInstanceRead])
async def get_alert_instances(
    limit: int = Query(50, ge=1, le=200),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get recent alert trigger history. Returns [] if none."""
    try:
        cutoff = datetime.utcnow() - timedelta(days=30)
        result = await db.execute(
            select(AlertInstance)
            .join(AlertRule)
            .where(
                (AlertRule.user_id == UUID(user_id)) &
                (AlertInstance.triggered_at >= cutoff)
            )
            .order_by(desc(AlertInstance.triggered_at))
            .limit(limit)
        )
        return result.scalars().all()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"get_alert_instances error: {e}")
        return []


@router.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket, user_id: str):
    await websocket.accept()
    try:
        from app.core.config import settings
        import redis.asyncio as aioredis
        import json
        r = aioredis.from_url(settings.redis_url)
        pubsub = r.pubsub()
        await pubsub.subscribe(f"alerts:{user_id}")
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                await websocket.send_text(data)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass
