"""FastAPI router for portfolios, positions, and watchlists."""

from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.portfolio import Portfolio, Position, Watchlist, WatchlistItem
from app.schemas.portfolio import (
    PortfolioCreate, PortfolioRead,
    PositionCreate, PositionRead,
    WatchlistCreate, WatchlistRead,
)


async def _enrich_position_with_quotes(position):
    """Add live quote data to a position object."""
    try:
        from app.services.market_data import get_quotes_batch
        quotes = await get_quotes_batch([{"ticker": position.ticker, "exchange": position.exchange or "NSE"}])
        q = quotes.get(position.ticker, {})
        position.cmp = q.get("price", float(position.avg_cost))
        position.current_price = position.cmp
        day_change_pct = q.get("change_pct", 0)
        position.day_change_pct = day_change_pct
        position.day_change_percent = day_change_pct
        position.pnl = (position.cmp - float(position.avg_cost)) * float(position.quantity)
        position.pnl_pct = ((position.cmp - float(position.avg_cost)) / float(position.avg_cost) * 100) if float(position.avg_cost) and float(position.avg_cost) > 0 else 0
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Quote enrichment failed for {position.ticker}: {e}")
    return position


router = APIRouter(prefix="/portfolios", tags=["portfolios"])


# ── Portfolios ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[PortfolioRead])
async def list_portfolios(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all portfolios for the current user. Returns [] if none."""
    try:
        result = await db.execute(
            select(Portfolio)
            .where(Portfolio.user_id == UUID(user_id))
            .order_by(Portfolio.created_at)
        )
        return result.scalars().all()  # [] is valid, not an error
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"list_portfolios error: {e}")
        return []


@router.post("", response_model=PortfolioRead, status_code=status.HTTP_201_CREATED)
async def create_portfolio(
    data: PortfolioCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new portfolio."""
    try:
        portfolio = Portfolio(
            user_id=UUID(user_id),
            name=data.name,
            currency=getattr(data, 'currency', 'INR'),
        )
        db.add(portfolio)
        await db.commit()
        await db.refresh(portfolio)
        return portfolio
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not create portfolio: {str(e)}")


@router.get("/{portfolio_id}", response_model=PortfolioRead)
async def get_portfolio(
    portfolio_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a portfolio by ID."""
    try:
        portfolio = await db.get(Portfolio, portfolio_id)
        if not portfolio or portfolio.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Portfolio not found")
        return portfolio
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_portfolio(
    portfolio_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    portfolio = await db.get(Portfolio, portfolio_id)
    if not portfolio or portfolio.user_id != UUID(user_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")
    await db.delete(portfolio)
    await db.commit()


# ── Positions ─────────────────────────────────────────────────────────────────

@router.get("/{portfolio_id}/positions", response_model=list[PositionRead])
async def list_positions(
    portfolio_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all positions in a portfolio."""
    try:
        portfolio = await db.get(Portfolio, portfolio_id)
        if not portfolio or portfolio.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Portfolio not found")
        
        result = await db.execute(
            select(Position)
            .where(Position.portfolio_id == portfolio_id)
            .order_by(Position.created_at)
        )
        positions = result.scalars().all()
        
        # Enrich with live quotes
        try:
            from app.services.market_data import get_quotes_batch
            ticker_items = [{"ticker": p.ticker, "exchange": p.exchange or "NSE"} for p in positions]
            if ticker_items:
                quotes = await get_quotes_batch(ticker_items)
                for pos in positions:
                    q = quotes.get(pos.ticker, {})
                    pos.cmp = q.get("price", pos.avg_cost)
                    pos.current_price = pos.cmp
                    day_change_pct = q.get("change_pct", 0)
                    pos.day_change_pct = day_change_pct
                    pos.day_change_percent = day_change_pct  # alias for frontend
                    pos.pnl = (pos.cmp - pos.avg_cost) * pos.quantity
                    pos.pnl_pct = ((pos.cmp - pos.avg_cost) / pos.avg_cost * 100) if pos.avg_cost and pos.avg_cost > 0 else 0
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Quote enrichment failed: {e}")
        
        return positions
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"list_positions error: {e}")
        return []


@router.post("/{portfolio_id}/positions", response_model=PositionRead, status_code=status.HTTP_201_CREATED)
async def add_position(
    portfolio_id: UUID,
    data: PositionCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a position to a portfolio (or update if it already exists)."""
    try:
        portfolio = await db.get(Portfolio, portfolio_id)
        if not portfolio or portfolio.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Portfolio not found")

        # Check if position with same ticker already exists in this portfolio (UPSERT logic)
        result = await db.execute(
            select(Position).where(
                Position.portfolio_id == portfolio_id,
                Position.ticker == data.ticker.upper()
            )
        )
        existing_position = result.scalars().first()

        if existing_position:
            # Update existing position instead of creating duplicate
            existing_position.quantity = data.quantity
            existing_position.avg_cost = data.avg_cost
            existing_position.exchange = data.exchange
            if hasattr(data, 'company_name') and data.company_name:
                existing_position.company_name = data.company_name
            if hasattr(data, 'currency') and data.currency:
                existing_position.currency = data.currency
            if hasattr(data, 'notes') and data.notes:
                existing_position.notes = data.notes
            db.add(existing_position)
            position = existing_position
        else:
            # Create new position
            position = Position(
                portfolio_id=portfolio_id,
                ticker=data.ticker.upper(),
                exchange=data.exchange,
                company_name=getattr(data, 'company_name', data.ticker.upper()),
                quantity=data.quantity,
                avg_cost=data.avg_cost,
                currency=getattr(data, 'currency', 'INR' if data.exchange in ('NSE', 'BSE') else 'USD'),
            )
            db.add(position)

        await db.commit()
        await db.refresh(position)
        # Enrich with live quotes
        await _enrich_position_with_quotes(position)
        return position
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not add position: {str(e)}")


@router.put("/{portfolio_id}/positions/{position_id}", response_model=PositionRead)
async def update_position(
    portfolio_id: UUID,
    position_id: UUID,
    data: dict,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a position (quantity and avg_cost)."""
    try:
        portfolio = await db.get(Portfolio, portfolio_id)
        if not portfolio or portfolio.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Portfolio not found")

        position = await db.get(Position, position_id)
        if not position or position.portfolio_id != portfolio_id:
            raise HTTPException(status_code=404, detail="Position not found")

        # Update only quantity and avg_cost
        if "quantity" in data and data["quantity"] is not None:
            position.quantity = float(data["quantity"])
        if "avg_cost" in data and data["avg_cost"] is not None:
            position.avg_cost = float(data["avg_cost"])

        db.add(position)
        await db.commit()
        await db.refresh(position)
        # Enrich with live quotes
        await _enrich_position_with_quotes(position)
        return position
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not update position: {str(e)}")


@router.delete("/{portfolio_id}/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    portfolio_id: UUID,
    position_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    portfolio = await db.get(Portfolio, portfolio_id)
    if not portfolio or portfolio.user_id != UUID(user_id):
        raise HTTPException(status_code=404, detail="Portfolio not found")
    position = await db.get(Position, position_id)
    if not position or position.portfolio_id != portfolio_id:
        raise HTTPException(status_code=404, detail="Position not found")
    await db.delete(position)
    await db.commit()


@router.get("/{portfolio_id}/summary")
async def get_portfolio_summary(
    portfolio_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get portfolio summary with live P&L data. Returns empty summary if no positions."""
    try:
        portfolio = await db.get(Portfolio, portfolio_id)
        if not portfolio or portfolio.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Portfolio not found")
        
        result = await db.execute(
            select(Position).where(Position.portfolio_id == portfolio_id)
        )
        positions = result.scalars().all()
        
        if not positions:
            return {
                "portfolio_id": str(portfolio_id),
                "portfolio_name": portfolio.name,
                "currency": portfolio.currency,
                "total_value": 0,
                "total_cost": 0,
                "total_pnl": 0,
                "total_pnl_pct": 0,
                "day_pnl": 0,
                "day_pnl_pct": 0,
                "position_count": 0,
                "positions": [],
            }
        
        # Fetch quotes
        try:
            from app.services.market_data import get_quotes_batch
            ticker_items = [{"ticker": p.ticker, "exchange": p.exchange or "NSE"} for p in positions]
            quotes = await get_quotes_batch(ticker_items)
        except Exception:
            quotes = {}
        
        total_value = 0
        total_cost = 0
        day_pnl = 0
        enriched = []
        
        for pos in positions:
            q = quotes.get(pos.ticker, {})
            # Fallback to avg_cost when live price is unavailable (e.g., due to rate limiting)
            cmp = q.get("price") or pos.avg_cost
            if cmp is None or cmp == 0:
                cmp = pos.avg_cost
            day_change_pct = q.get("change_pct", 0)

            cost = pos.avg_cost * pos.quantity
            value = cmp * pos.quantity
            pnl = value - cost
            # Only calculate pnl_pct if cost > 0; when cmp == avg_cost, pnl_pct is 0
            pnl_pct = ((pnl / cost) * 100) if cost and cost > 0 else 0
            pos_day_pnl = value * (day_change_pct / 100) if day_change_pct else 0

            total_value += value
            total_cost += cost
            day_pnl += pos_day_pnl
            
            enriched.append({
                "id": str(pos.id),
                "ticker": pos.ticker,
                "exchange": pos.exchange,
                "company_name": pos.company_name or pos.ticker,
                "quantity": pos.quantity,
                "avg_cost": pos.avg_cost,
                "cmp": round(cmp, 2),
                "value": round(value, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
                "day_change_pct": round(day_change_pct, 2),
                "weight_pct": 0,  # filled below
            })
        
        total_pnl = total_value - total_cost
        total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else 0
        
        for e in enriched:
            e["weight_pct"] = round(e["value"] / total_value * 100, 1) if total_value else 0
        
        return {
            "portfolio_id": str(portfolio_id),
            "portfolio_name": portfolio.name,
            "currency": portfolio.currency,
            "total_value": round(total_value, 2),
            "total_cost": round(total_cost, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl_pct, 2),
            "day_pnl": round(day_pnl, 2),
            "day_pnl_pct": round(day_pnl / total_value * 100, 2) if total_value else 0,
            "position_count": len(positions),
            "positions": enriched,
        }
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"portfolio summary error: {e}")
        # Return empty summary instead of error
        return {
            "portfolio_id": str(portfolio_id),
            "total_value": 0, "total_cost": 0,
            "total_pnl": 0, "total_pnl_pct": 0,
            "day_pnl": 0, "day_pnl_pct": 0,
            "position_count": 0, "positions": [],
        }


# ── Watchlists ─────────────────────────────────────────────────────────────────

@router.get("/watchlists/all", response_model=list[WatchlistRead])
async def list_watchlists(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(
            select(Watchlist).where(Watchlist.user_id == UUID(user_id))
        )
        return result.scalars().all()
    except Exception:
        return []


@router.post("/watchlists", response_model=WatchlistRead, status_code=201)
async def create_watchlist(
    data: WatchlistCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        wl = Watchlist(user_id=UUID(user_id), name=data.name)
        db.add(wl)
        await db.commit()
        await db.refresh(wl)
        return wl
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
