"""
Pydantic schemas for alerts.
"""

from datetime import datetime
from uuid import UUID
from typing import Optional, Union
from pydantic import BaseModel, Field, model_validator


class AlertRuleCreate(BaseModel):
    """Request model for creating an alert rule."""
    name: str = Field(..., min_length=1, max_length=255)
    is_active: bool = True
    rule_type: str  # PRICE_LEVEL, PRICE_PCT, EARNINGS_NEAR, NEWS_TRIGGER, VOLUME_SPIKE
    ticker: Optional[str] = Field(default=None, min_length=1, max_length=20)
    exchange: str = Field(..., min_length=1, max_length=20)
    conditions: Optional[dict] = Field(default_factory=dict)
    news_conditions: Optional[dict] = Field(default=None)
    notification_channels: Union[dict, list] = Field(
        default_factory=lambda: {"IN_APP": True}
    )
    cooldown_minutes: int = Field(default=60, ge=1)

    @model_validator(mode="before")
    @classmethod
    def normalize_notification_channels(cls, data):
        """Normalize notification_channels: if list received, convert to dict."""
        if isinstance(data, dict) and "notification_channels" in data:
            channels = data["notification_channels"]
            if isinstance(channels, list):
                # Convert list like ['IN_APP'] to dict like {'IN_APP': True}
                data["notification_channels"] = {channel: True for channel in channels}
        return data


class AlertRuleRead(BaseModel):
    """Response model for an alert rule."""
    id: UUID
    user_id: UUID
    name: str
    is_active: bool
    rule_type: str
    ticker: Optional[str] = None
    exchange: str
    conditions: Optional[dict] = None
    news_conditions: Optional[dict] = None
    notification_channels: dict
    cooldown_minutes: int
    created_at: datetime
    last_triggered_at: Optional[datetime]

    class Config:
        from_attributes = True


class AlertRuleUpdate(BaseModel):
    """Request model for updating an alert rule."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_active: Optional[bool] = None
    conditions: Optional[dict] = None
    news_conditions: Optional[dict] = None
    notification_channels: Optional[dict] = None
    cooldown_minutes: Optional[int] = Field(None, ge=1)


class AlertInstanceRead(BaseModel):
    """Response model for an alert instance."""
    id: UUID
    rule_id: UUID
    triggered_at: datetime
    trigger_value: str
    status: str
    notification_payload: dict
    message: Optional[str] = None

    class Config:
        from_attributes = True
