"""FastAPI router for all financial calendar events."""

import logging
from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.event import CalendarEvent
from app.models.portfolio import Portfolio, Position, Watchlist, WatchlistItem
from app.schemas.event import CalendarEventRead

router = APIRouter(prefix="/calendar", tags=["calendar"])
logger = logging.getLogger(__name__)


def _dedup_events(events: list) -> list:
    """Remove duplicate calendar events by composite key."""
    seen: set[str] = set()
    result = []
    for ev in events:
        # Build a composite key from type + ticker + date + title
        ticker = getattr(ev, 'ticker', '') or ''
        event_type = getattr(ev, 'event_type', '') or ''
        event_date = ''
        if hasattr(ev, 'event_date') and ev.event_date:
            event_date = ev.event_date.strftime('%Y-%m-%d') if hasattr(ev.event_date, 'strftime') else str(ev.event_date)[:10]
        title = getattr(ev, 'title', '') or ''
        # For ratings: include analyst_firm; for economic: include indicator_name
        extra = ''
        if event_type == 'RATING_CHANGE':
            extra = getattr(ev, 'analyst_firm', '') or ''
        elif event_type == 'ECONOMIC':
            extra = getattr(ev, 'indicator_name', '') or ''
        elif event_type == 'EARNINGS':
            extra = getattr(ev, 'fiscal_quarter', '') or ''

        # For dividends: use only ticker (no date), since duplicate dividends for same ticker are data errors
        if event_type == 'DIVIDEND':
            key = f"{event_type}|{ticker}"
        else:
            key = f"{event_type}|{ticker}|{event_date}|{extra}|{title}"
        if key not in seen:
            seen.add(key)
            result.append(ev)
    return result


def _parse_date(d: str) -> datetime:
    """Accept YYYY-MM-DD or ISO datetime."""
    try:
        return datetime.fromisoformat(d)
    except ValueError:
        return datetime.strptime(d, "%Y-%m-%d")


@router.get("/earnings", response_model=list[CalendarEventRead])
async def get_earnings_calendar(
    from_date: str = Query(None),
    to_date: str = Query(None),
    tickers: list[str] | None = Query(None),
    impact_level: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        fd = _parse_date(from_date) if from_date else datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=30)
        td = _parse_date(to_date) if to_date else datetime.utcnow() + timedelta(days=90)
        conditions = [
            CalendarEvent.event_type == "EARNINGS",
            CalendarEvent.event_date >= fd,
            CalendarEvent.event_date <= td,
        ]
        if impact_level:
            conditions.append(CalendarEvent.impact_level == impact_level)
        query = select(CalendarEvent).where(and_(*conditions))
        if tickers:
            query = query.where(CalendarEvent.ticker.in_(tickers))
        query = query.order_by(CalendarEvent.event_date)
        result = await db.execute(query)
        return _dedup_events(result.scalars().all())
    except Exception as e:
        logger.error(f"earnings calendar error: {e}")
        return []


@router.get("/economic", response_model=list[CalendarEventRead])
async def get_economic_calendar(
    from_date: str = Query(None),
    to_date: str = Query(None),
    impact_level: str | None = Query(None),
    country: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        fd = _parse_date(from_date) if from_date else datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=30)
        td = _parse_date(to_date) if to_date else datetime.utcnow() + timedelta(days=90)
        conditions = [
            CalendarEvent.event_type == "ECONOMIC",
            CalendarEvent.event_date >= fd,
            CalendarEvent.event_date <= td,
        ]
        if impact_level:
            conditions.append(CalendarEvent.impact_level == impact_level)
        if country:
            conditions.append(CalendarEvent.country == country)
        query = select(CalendarEvent).where(and_(*conditions)).order_by(CalendarEvent.event_date)
        result = await db.execute(query)
        return _dedup_events(result.scalars().all())
    except Exception as e:
        logger.error(f"economic calendar error: {e}")
        return []


@router.get("/ratings", response_model=list[CalendarEventRead])
async def get_ratings_calendar(
    from_date: str = Query(None),
    to_date: str = Query(None),
    tickers: list[str] | None = Query(None),
    change_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        fd = _parse_date(from_date) if from_date else datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=30)
        td = _parse_date(to_date) if to_date else datetime.utcnow() + timedelta(days=90)
        conditions = [
            CalendarEvent.event_type == "RATING_CHANGE",
            CalendarEvent.event_date >= fd,
            CalendarEvent.event_date <= td,
        ]
        if change_type:
            conditions.append(CalendarEvent.change_type == change_type)
        query = select(CalendarEvent).where(and_(*conditions))
        if tickers:
            query = query.where(CalendarEvent.ticker.in_(tickers))
        query = query.order_by(CalendarEvent.event_date.desc())
        result = await db.execute(query)
        return _dedup_events(result.scalars().all())
    except Exception as e:
        logger.error(f"ratings calendar error: {e}")
        return []


@router.get("/dividends", response_model=list[CalendarEventRead])
async def get_dividends_calendar(
    from_date: str = Query(None),
    to_date: str = Query(None),
    tickers: list[str] | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        fd = _parse_date(from_date) if from_date else datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=30)
        td = _parse_date(to_date) if to_date else datetime.utcnow() + timedelta(days=90)
        conditions = [
            CalendarEvent.event_type == "DIVIDEND",
            CalendarEvent.event_date >= fd,
            CalendarEvent.event_date <= td,
        ]
        query = select(CalendarEvent).where(and_(*conditions))
        if tickers:
            query = query.where(CalendarEvent.ticker.in_(tickers))
        query = query.order_by(CalendarEvent.event_date)
        result = await db.execute(query)
        return _dedup_events(result.scalars().all())
    except Exception as e:
        logger.error(f"dividends calendar error: {e}")
        return []


@router.get("/today", response_model=list[CalendarEventRead])
async def get_today_events(
    db: AsyncSession = Depends(get_db),
):
    """Get all calendar events for today (no auth required)."""
    try:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)

        result = await db.execute(
            select(CalendarEvent)
            .where(and_(CalendarEvent.event_date >= today_start, CalendarEvent.event_date <= today_end))
            .order_by(CalendarEvent.event_date)
        )
        return _dedup_events(result.scalars().all())
    except Exception as e:
        logger.error(f"today events error: {e}")
        return []


@router.get("/upcoming", response_model=list[CalendarEventRead])
async def get_upcoming_events(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Get upcoming calendar events (no auth required)."""
    try:
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        future = today + timedelta(days=days)

        result = await db.execute(
            select(CalendarEvent)
            .where(and_(CalendarEvent.event_date >= today, CalendarEvent.event_date <= future))
            .order_by(CalendarEvent.event_date)
        )
        return _dedup_events(result.scalars().all())
    except Exception as e:
        logger.error(f"upcoming events error: {e}")
        return []
