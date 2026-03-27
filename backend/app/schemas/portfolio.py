"""
Pydantic schemas for portfolio operations.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field


class PortfolioCreate(BaseModel):
    """Request model for creating a portfolio."""
    name: str = Field(..., min_length=1, max_length=255)
    currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    is_primary: bool = False


class PortfolioRead(BaseModel):
    """Response model for a portfolio."""
    id: UUID
    user_id: UUID
    name: str
    currency: str
    is_primary: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class PortfolioUpdate(BaseModel):
    """Request model for updating a portfolio."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_primary: Optional[bool] = None


class PositionCreate(BaseModel):
    """Request model for adding a position."""
    ticker: str = Field(..., min_length=1, max_length=20)
    exchange: str = Field(..., min_length=1, max_length=20)
    company_name: str = Field(..., min_length=1, max_length=255)
    quantity: Decimal = Field(..., gt=0)
    avg_cost: Decimal = Field(..., gt=0)
    currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    notes: Optional[str] = Field(None, max_length=1000)
    tags: dict = Field(default_factory=dict)


class PositionRead(BaseModel):
    """Response model for a position with live pricing."""
    id: UUID
    portfolio_id: UUID
    ticker: str
    exchange: str
    company_name: str
    quantity: Decimal
    avg_cost: Decimal
    currency: str
    notes: Optional[str]
    tags: dict
    created_at: datetime
    updated_at: datetime
    
    # Computed fields from live data
    cmp: Optional[float] = None
    current_price: Optional[float] = None   # alias for cmp (some callers use this)
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    weight: Optional[float] = None
    day_change_pct: Optional[float] = None      # set by enrichment
    day_change_percent: Optional[float] = None  # alias used by frontend PositionRow
    next_earnings_date: Optional[str] = None
    
    class Config:
        from_attributes = True


class PositionUpdate(BaseModel):
    """Request model for updating a position."""
    quantity: Optional[Decimal] = Field(None, gt=0)
    avg_cost: Optional[Decimal] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=1000)
    tags: Optional[dict] = None


class WatchlistCreate(BaseModel):
    """Request model for creating a watchlist."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    tags: dict = Field(default_factory=dict)


class WatchlistRead(BaseModel):
    """Response model for a watchlist."""
    id: UUID
    user_id: UUID
    name: str
    description: Optional[str]
    tags: dict
    created_at: datetime
    
    class Config:
        from_attributes = True


class WatchlistItemCreate(BaseModel):
    """Request model for adding an item to watchlist."""
    ticker: str = Field(..., min_length=1, max_length=20)
    exchange: str = Field(default="NASDAQ", min_length=1, max_length=20)
    company_name: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = Field(default=None, max_length=500)


class WatchlistItemRead(BaseModel):
    """Response model for a watchlist item."""
    id: UUID
    watchlist_id: UUID
    ticker: str
    exchange: str
    company_name: str
    added_at: datetime
    notes: Optional[str]
    
    class Config:
        from_attributes = True
