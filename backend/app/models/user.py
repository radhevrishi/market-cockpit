"""User and UserProfile SQLAlchemy models."""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.db_types import GUID, ArrayOfString


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=True)
    timezone: Mapped[str] = mapped_column(String(63), default="Asia/Kolkata", nullable=False)
    preferred_markets: Mapped[list] = mapped_column(ArrayOfString(), default=lambda: ["IN", "US"], nullable=False)
    preferred_themes: Mapped[list] = mapped_column(ArrayOfString(), default=lambda: ["earnings", "sector_rotation"], nullable=False)
    notification_channels: Mapped[dict] = mapped_column(
        JSON, default=lambda: {"email": True, "telegram": False, "browser": True}, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
