"""Calendar event model."""

import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.db_types import GUID


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=True, index=True)
    exchange: Mapped[str] = mapped_column(String(20), nullable=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=True)
    event_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    event_time: Mapped[str] = mapped_column(String(8), nullable=True)
    timezone: Mapped[str] = mapped_column(String(63), default="UTC", nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(String(2000), nullable=True)
    impact_level: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="SCHEDULED", nullable=False)
    eps_estimate: Mapped[str] = mapped_column(String(20), nullable=True)
    eps_actual: Mapped[str] = mapped_column(String(20), nullable=True)
    revenue_estimate: Mapped[str] = mapped_column(String(20), nullable=True)
    revenue_actual: Mapped[str] = mapped_column(String(20), nullable=True)
    surprise_pct: Mapped[float] = mapped_column(Float, nullable=True)
    fiscal_quarter: Mapped[str] = mapped_column(String(10), nullable=True)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=True)
    indicator_name: Mapped[str] = mapped_column(String(255), nullable=True)
    forecast: Mapped[str] = mapped_column(String(20), nullable=True)
    actual: Mapped[str] = mapped_column(String(20), nullable=True)
    prior: Mapped[str] = mapped_column(String(20), nullable=True)
    country: Mapped[str] = mapped_column(String(10), nullable=True)
    analyst_firm: Mapped[str] = mapped_column(String(255), nullable=True)
    rating_prev: Mapped[str] = mapped_column(String(50), nullable=True)
    rating_new: Mapped[str] = mapped_column(String(50), nullable=True)
    price_target: Mapped[float] = mapped_column(Float, nullable=True)
    change_type: Mapped[str] = mapped_column(String(20), nullable=True)
    from_rating: Mapped[str] = mapped_column(String(50), nullable=True)
    to_rating: Mapped[str] = mapped_column(String(50), nullable=True)
    from_target: Mapped[str] = mapped_column(String(20), nullable=True)
    to_target: Mapped[str] = mapped_column(String(20), nullable=True)
    dividend_amount: Mapped[float] = mapped_column(Float, nullable=True)
    dividend_currency: Mapped[str] = mapped_column(String(10), nullable=True)
    ex_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    record_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    pay_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    dividend_yield: Mapped[float] = mapped_column(Float, nullable=True)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
