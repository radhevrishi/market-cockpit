"""
Pydantic schemas for news operations.
"""

from datetime import datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class NewsArticleRead(BaseModel):
    """Response model for a news article.

    The DB model uses `headline`, `source_name`, `source_url`, and a rich
    `tickers` JSON (list of {ticker, exchange, confidence} dicts).
    We add frontend-friendly aliases so the React app can use the simpler
    `title`, `source`, `url`, and `ticker_symbols` fields.
    """
    id: UUID
    external_id: str
    source_name: str
    source_url: str
    headline: str
    summary: Optional[str] = None
    region: str
    sectors: list[str] = []
    themes: list[str] = []
    tickers: list = []   # accepts list[str] or list[dict] from DB JSON
    importance_score: int
    sentiment: str
    article_type: str
    published_at: datetime
    ingested_at: datetime
    investment_tier: int = 0
    relevance_tags: list[str] = []
    is_duplicate: bool = False
    duplicate_of: Optional[UUID] = None

    # ── Frontend-friendly aliases ──────────────────────────────────────────────
    title: str = ""
    source: str = ""
    url: str = ""
    ticker_symbols: list[str] = []   # flat ["AAPL", "RELIANCE", ...]

    @model_validator(mode="after")
    def populate_aliases(self) -> "NewsArticleRead":
        self.title = self.headline
        self.source = self.source_name
        self.url = self.source_url
        # Handle both list[str] and list[dict] formats from DB
        symbols = []
        for t in (self.tickers or []):
            if isinstance(t, str):
                symbols.append(t)
            elif isinstance(t, dict) and t.get("ticker"):
                symbols.append(t["ticker"])
        self.ticker_symbols = symbols
        return self

    class Config:
        from_attributes = True


class NewsFilter(BaseModel):
    """Filter parameters for news feed."""
    region: Optional[str] = None  # IN, US, GLOBAL
    sectors: Optional[list[str]] = None
    themes: Optional[list[str]] = None
    article_types: Optional[list[str]] = None
    importance_min: int = Field(default=0, ge=0, le=100)
    from_dt: Optional[datetime] = None
    to_dt: Optional[datetime] = None
    ticker: Optional[str] = Field(None, max_length=20)
    search_query: Optional[str] = Field(None, max_length=255)
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
