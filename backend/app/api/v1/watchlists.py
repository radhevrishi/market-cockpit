"""FastAPI router for watchlists."""

import logging
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.portfolio import Watchlist, WatchlistItem
from app.schemas.portfolio import WatchlistCreate, WatchlistItemCreate

router = APIRouter(prefix="/watchlists", tags=["watchlists"])
logger = logging.getLogger(__name__)


# ── helpers ────────────────────────────────────────────────────────────────────

def _item_dict(item: WatchlistItem, quote: dict | None = None) -> dict:
    q = quote or {}
    # Determine currency from exchange
    exchange = item.exchange or "NASDAQ"
    currency = "INR" if exchange.upper() in ("NSE", "BSE") else "USD"
    return {
        "id": str(item.id),
        "ticker": item.ticker,
        "exchange": item.exchange,
        "company_name": item.company_name,
        "notes": item.notes,
        "added_at": item.added_at.isoformat(),
        "price": q.get("price"),
        "change_pct": q.get("change_pct"),
        "currency": q.get("currency", currency),
    }


async def _enrich_items(items: list[WatchlistItem]) -> list[dict]:
    """Return items enriched with live quotes; silently falls back to None on error."""
    if not items:
        return []
    try:
        from app.services.market_data import get_quotes_batch
        tickers = [i.ticker for i in items]
        quotes = await get_quotes_batch(tickers)
        return [_item_dict(item, quotes.get(item.ticker)) for item in items]
    except Exception as e:
        logger.warning(f"Quote enrichment skipped: {e}")
        return [_item_dict(item) for item in items]


# ── routes ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[dict])
async def list_watchlists(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all watchlists with their items and live prices."""
    try:
        result = await db.execute(
            select(Watchlist)
            .where(Watchlist.user_id == UUID(user_id))
            .order_by(Watchlist.created_at)
        )
        watchlists = result.scalars().all()

        output = []
        for wl in watchlists:
            items_result = await db.execute(
                select(WatchlistItem)
                .where(WatchlistItem.watchlist_id == wl.id)
                .order_by(WatchlistItem.added_at)
            )
            items = items_result.scalars().all()
            enriched = await _enrich_items(list(items))
            logger.info(f"Watchlist '{wl.name}' has {len(enriched)} items: {[i['ticker'] for i in enriched]}")
            output.append({
                "id": str(wl.id),
                "name": wl.name,
                "description": wl.description,
                "created_at": wl.created_at.isoformat(),
                "item_count": len(enriched),
                "items": enriched,
            })
        return output
    except Exception as e:
        logger.error(f"list_watchlists error: {e}")
        return []


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_watchlist(
    data: WatchlistCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new watchlist."""
    try:
        wl = Watchlist(
            user_id=UUID(user_id),
            name=data.name,
            description=getattr(data, "description", None),
        )
        db.add(wl)
        await db.commit()
        await db.refresh(wl)
        return {
            "id": str(wl.id),
            "name": wl.name,
            "description": wl.description,
            "created_at": wl.created_at.isoformat(),
            "item_count": 0,
            "items": [],
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not create watchlist: {e}")


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist(
    watchlist_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a watchlist (cascade removes its items)."""
    try:
        wl = await db.get(Watchlist, watchlist_id)
        if not wl or wl.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Watchlist not found")
        await db.delete(wl)
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{watchlist_id}/items", status_code=status.HTTP_201_CREATED)
async def add_item(
    watchlist_id: UUID,
    data: WatchlistItemCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a ticker to a watchlist."""
    logger.info(f"add_item called: watchlist_id={watchlist_id}, ticker={data.ticker}, exchange={data.exchange}, user_id={user_id}")
    try:
        wl = await db.get(Watchlist, watchlist_id)
        if not wl or wl.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Watchlist not found")

        # Duplicate check
        dup = await db.execute(
            select(WatchlistItem).where(
                WatchlistItem.watchlist_id == watchlist_id,
                WatchlistItem.ticker == data.ticker.upper(),
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"{data.ticker.upper()} is already in this watchlist")

        # Try to resolve company name and get initial quote
        company_name = data.company_name or data.ticker.upper()
        price, change_pct = None, None
        try:
            from app.services.market_data import MarketDataService
            q = await MarketDataService().get_quote(data.ticker.upper(), data.exchange or "NASDAQ")
            company_name = q.get("name") or company_name
            price = q.get("price")
            change_pct = q.get("change_pct")
        except Exception:
            pass

        item = WatchlistItem(
            watchlist_id=watchlist_id,
            ticker=data.ticker.upper(),
            exchange=data.exchange or "NASDAQ",
            company_name=company_name,
            notes=data.notes,
        )
        logger.info(f"Creating WatchlistItem: {item.ticker} in watchlist {watchlist_id}")
        db.add(item)
        logger.info(f"Item added to session, about to commit...")
        await db.commit()
        logger.info(f"Commit successful, about to refresh...")
        await db.refresh(item)

        logger.info(f"Successfully added item to watchlist: id={item.id}, ticker={item.ticker}")

        # Determine currency from exchange
        exchange = data.exchange or "NASDAQ"
        currency = "INR" if exchange.upper() in ("NSE", "BSE") else "USD"
        return {
            "id": str(item.id),
            "ticker": item.ticker,
            "exchange": item.exchange,
            "company_name": item.company_name,
            "notes": item.notes,
            "added_at": item.added_at.isoformat(),
            "price": price,
            "change_pct": change_pct,
            "currency": currency,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding item: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not add item: {e}")


@router.delete("/{watchlist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_item(
    watchlist_id: UUID,
    item_id: UUID,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a ticker from a watchlist."""
    try:
        wl = await db.get(Watchlist, watchlist_id)
        if not wl or wl.user_id != UUID(user_id):
            raise HTTPException(status_code=404, detail="Watchlist not found")
        item = await db.get(WatchlistItem, item_id)
        if not item or item.watchlist_id != watchlist_id:
            raise HTTPException(status_code=404, detail="Item not found")
        await db.delete(item)
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
