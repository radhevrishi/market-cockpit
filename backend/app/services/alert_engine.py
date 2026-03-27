"""
Alert evaluation engine for price alerts, news triggers, and volume spikes.
"""

import logging
import json
from datetime import datetime, timedelta
try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None  # type: ignore
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.alert import AlertRule, AlertInstance
from app.services.market_data import MarketDataService

logger = logging.getLogger(__name__)


class AlertEngine:
    """Service for evaluating and triggering alerts."""

    def __init__(self, redis_client=None):
        """Initialize alert engine with optional Redis client."""
        self.redis = redis_client
        self.market_data = MarketDataService(redis_client)
    
    async def evaluate_price_alerts(self, db: AsyncSession) -> int:
        """
        Evaluate all active price alert rules.
        
        Args:
            db: Database session
        
        Returns:
            Number of alerts triggered
        """
        alerts_triggered = 0
        
        try:
            # Get all active price alert rules
            result = await db.execute(
                select(AlertRule).where(
                    and_(
                        AlertRule.is_active == True,
                        AlertRule.rule_type.in_(["PRICE_LEVEL", "PRICE_PCT", "VOLUME_SPIKE"])
                    )
                )
            )
            rules = result.scalars().all()
            
            for rule in rules:
                try:
                    quote = await self.market_data.get_quote(rule.ticker, rule.exchange)
                    
                    if "error" in quote:
                        logger.error(f"Error getting quote for {rule.ticker}: {quote['error']}")
                        continue
                    
                    current_price = quote.get("price")
                    if not current_price:
                        continue
                    
                    # Check rule conditions
                    triggered = False
                    trigger_value = ""
                    
                    if rule.rule_type == "PRICE_LEVEL":
                        conditions = rule.conditions
                        target_price = conditions.get("price")
                        direction = conditions.get("direction", "above")
                        
                        if direction == "above" and current_price >= target_price:
                            triggered = True
                            trigger_value = f"Price {current_price} reached above {target_price}"
                        elif direction == "below" and current_price <= target_price:
                            triggered = True
                            trigger_value = f"Price {current_price} fell below {target_price}"
                    
                    elif rule.rule_type == "PRICE_PCT":
                        # Implement percentage change logic
                        conditions = rule.conditions
                        # Would need previous price from cache
                        pass
                    
                    elif rule.rule_type == "VOLUME_SPIKE":
                        # Implement volume spike logic
                        conditions = rule.conditions
                        volume = quote.get("volume")
                        # Would need average volume from historical data
                        pass
                    
                    # If triggered and not in cooldown, create alert instance
                    if triggered:
                        last_triggered = rule.last_triggered_at
                        now = datetime.utcnow()
                        
                        if last_triggered is None or \
                           (now - last_triggered).total_seconds() > rule.cooldown_minutes * 60:
                            
                            alert_instance = AlertInstance(
                                rule_id=rule.id,
                                triggered_at=now,
                                trigger_value=trigger_value,
                                status="SENT",
                                notification_payload=self._build_notification(
                                    rule, quote, trigger_value
                                )
                            )
                            db.add(alert_instance)
                            
                            rule.last_triggered_at = now
                            alerts_triggered += 1
                            
                            # Send notification
                            await self.send_alert_notification(alert_instance, rule)
                
                except Exception as e:
                    logger.error(f"Error evaluating rule {rule.id}: {e}")
                    continue
            
            await db.commit()
        except Exception as e:
            logger.error(f"Error in evaluate_price_alerts: {e}")
        
        return alerts_triggered
    
    async def evaluate_news_alerts(
        self,
        db: AsyncSession,
        article_id: str
    ) -> int:
        """
        Evaluate news-based alert rules for a new article.
        
        Args:
            db: Database session
            article_id: News article ID
        
        Returns:
            Number of alerts triggered
        """
        alerts_triggered = 0
        
        try:
            # Get all active news trigger rules
            result = await db.execute(
                select(AlertRule).where(
                    and_(
                        AlertRule.is_active == True,
                        AlertRule.rule_type == "NEWS_TRIGGER"
                    )
                )
            )
            rules = result.scalars().all()
            
            # This would fetch article from DB and check conditions
            # Simplified for now
            
        except Exception as e:
            logger.error(f"Error in evaluate_news_alerts: {e}")
        
        return alerts_triggered
    
    async def send_alert_notification(
        self,
        alert_instance: AlertInstance,
        rule: AlertRule
    ) -> None:
        """
        Send alert notification via configured channels.
        
        Args:
            alert_instance: AlertInstance object
            rule: AlertRule object
        """
        try:
            channels = rule.notification_channels
            
            if channels.get("email"):
                await self._send_email_notification(alert_instance, rule)
            
            if channels.get("telegram"):
                await self._send_telegram_notification(alert_instance, rule)
            
            if channels.get("browser"):
                await self._send_browser_notification(alert_instance, rule)
        
        except Exception as e:
            logger.error(f"Error sending notification: {e}")
    
    async def _send_email_notification(
        self,
        alert_instance: AlertInstance,
        rule: AlertRule
    ) -> None:
        """Send email notification (mock implementation)."""
        logger.info(
            f"EMAIL ALERT: Rule {rule.name} - {alert_instance.trigger_value}"
        )
    
    async def _send_telegram_notification(
        self,
        alert_instance: AlertInstance,
        rule: AlertRule
    ) -> None:
        """Send Telegram notification (mock implementation)."""
        logger.info(
            f"TELEGRAM ALERT: Rule {rule.name} - {alert_instance.trigger_value}"
        )
    
    async def _send_browser_notification(
        self,
        alert_instance: AlertInstance,
        rule: AlertRule
    ) -> None:
        """Publish browser notification via WebSocket."""
        try:
            channel = f"alerts:{rule.user_id}"
            message = json.dumps({
                "alert_id": str(alert_instance.id),
                "rule_name": rule.name,
                "trigger_value": alert_instance.trigger_value,
                "timestamp": alert_instance.triggered_at.isoformat()
            })
            await self.redis.publish(channel, message)
        except Exception as e:
            logger.error(f"Error publishing to Redis: {e}")
    
    def _build_notification(
        self,
        rule: AlertRule,
        quote: dict,
        trigger_value: str
    ) -> dict:
        """Build notification payload."""
        return {
            "rule_name": rule.name,
            "ticker": rule.ticker,
            "exchange": rule.exchange,
            "trigger_value": trigger_value,
            "current_price": quote.get("price"),
            "change_pct": quote.get("change_pct"),
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def get_user_alerts_channel(self, user_id: str) -> str:
        """Get Redis pub/sub channel name for user alerts."""
        return f"alerts:{user_id}"
