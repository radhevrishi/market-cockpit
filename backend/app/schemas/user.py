"""
Pydantic v2 schemas for User and UserProfile.
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=100)
    timezone: str = "Asia/Kolkata"
    preferred_markets: List[str] = ["IN", "US"]
    preferred_themes: List[str] = []


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserProfileRead(BaseModel):
    id: str
    email: str
    display_name: str
    timezone: str
    preferred_markets: List[str]
    preferred_themes: List[str]
    notification_channels: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    timezone: Optional[str] = None
    preferred_markets: Optional[List[str]] = None
    preferred_themes: Optional[List[str]] = None
    notification_channels: Optional[dict] = None
