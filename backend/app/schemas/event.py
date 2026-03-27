"""
Pydantic schemas for calendar events.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field


class CalendarEventRead(BaseModel):
    """Response model for a calendar event."""
    id: UUID
    event_type: str
    ticker: Optional[str]
    exchange: Optional[str]
    company_name: Optional[str]
    event_date: datetime
    event_time: Optional[str]
    timezone: str
    title: str
    description: Optional[str]
    impact_level: str
    status: str
    eps_estimate: Optional[str]
    eps_actual: Optional[str]
    revenue_estimate: Optional[str]
    revenue_actual: Optional[str]
    surprise_pct: Optional[float]
    fiscal_quarter: Optional[str]
    fiscal_year: Optional[int]
    indicator_name: Optional[str]
    forecast: Optional[str]
    actual: Optional[str]
    prior: Optional[str]
    country: Optional[str]
    analyst_firm: Optional[str]
    rating_prev: Optional[str]
    rating_new: Optional[str]
    price_target: Optional[float]
    change_type: Optional[str]
    from_rating: Optional[str]
    to_rating: Optional[str]
    from_target: Optional[str]
    to_target: Optional[str]
    dividend_amount: Optional[float]
    dividend_currency: Optional[str]
    ex_date: Optional[datetime]
    record_date: Optional[datetime]
    pay_date: Optional[datetime]
    dividend_yield: Optional[float]
    source_url: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class EarningsCalendarFilter(BaseModel):
    """Filter for earnings calendar."""
    from_date: datetime
    to_date: datetime
    tickers: Optional[list[str]] = None
    sectors: Optional[list[str]] = None
    watchlist_id: Optional[UUID] = None
    impact_level: Optional[str] = None  # HIGH, MEDIUM, LOW


class EconomicCalendarFilter(BaseModel):
    """Filter for economic calendar."""
    from_date: datetime
    to_date: datetime
    impact_level: Optional[str] = None  # HIGH, MEDIUM, LOW
    regions: Optional[list[str]] = None
