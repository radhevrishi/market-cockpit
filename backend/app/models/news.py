"""News article model."""

import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.db_types import GUID, ArrayOfString


class NewsArticle(Base):
    __tablename__ = "news_articles"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str] = mapped_column(String(512), unique=True, nullable=False, index=True)
    source_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    headline: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str] = mapped_column(String(2000), nullable=True)
    region: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    sectors: Mapped[list] = mapped_column(ArrayOfString(), default=lambda: [], nullable=False)
    themes: Mapped[list] = mapped_column(ArrayOfString(), default=lambda: [], nullable=False)
    tickers: Mapped[list] = mapped_column(JSON, default=lambda: [], nullable=False)
    importance_score: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    sentiment: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    article_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    investment_tier: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    # 0 = unclassified, 1 = TRACK_DAILY, 2 = WEEKLY_DIGEST, 3 = NOISE
    relevance_tags: Mapped[list] = mapped_column(ArrayOfString(), default=lambda: [], nullable=False)
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duplicate_of: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("news_articles.id", ondelete="SET NULL"), nullable=True
    )
