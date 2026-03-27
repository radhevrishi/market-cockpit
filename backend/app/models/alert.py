"""Alert rule and instance models."""

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Integer, DateTime, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.db_types import GUID


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    rule_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=True, index=True)
    exchange: Mapped[str] = mapped_column(String(20), nullable=False)
    conditions: Mapped[dict] = mapped_column(JSON, nullable=False)
    news_conditions: Mapped[dict] = mapped_column(JSON, default=lambda: {}, nullable=False)
    notification_channels: Mapped[dict] = mapped_column(
        JSON, default=lambda: {"email": True, "telegram": False}, nullable=False
    )
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    last_triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)


class AlertInstance(Base):
    __tablename__ = "alert_instances"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )
    trigger_value: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="SENT", nullable=False)
    notification_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=True)
