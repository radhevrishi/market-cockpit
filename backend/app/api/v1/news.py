"""FastAPI router for news articles."""

import logging
import math
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc, or_

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.news import NewsArticle
from app.schemas.news import NewsArticleRead

router = APIRouter(prefix="/news", tags=["news"])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[NewsArticleRead])
async def get_news(
    region: str | None = Query(None),
    article_type: str | None = Query(None),
    source_name: str | None = Query(None),
    min_importance: int = Query(1, ge=1, le=5, alias="importance_min"),
    tickers: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(300, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Get news articles with optional filters.

    Default behavior (no region filter): returns ALL articles from all regions sorted by published_at desc.
    If region is specified and != "ALL": returns articles matching that region OR GLOBAL articles.
    """
    try:
        conditions = [
            NewsArticle.importance_score >= min_importance,
            NewsArticle.is_duplicate == False,  # noqa: E712 — exclude duplicates
            # Hide Tier 3 noise by default (0 = unclassified, kept for backward compat)
            or_(NewsArticle.investment_tier <= 2, NewsArticle.investment_tier == 0),
        ]

        # Only filter by region if explicitly requested and not "ALL"
        if region and region != "ALL":
            conditions.append(or_(NewsArticle.region == region, NewsArticle.region == "GLOBAL"))
        # If region is None or "ALL", return all articles (no region filter)

        if article_type and article_type != "ALL":
            conditions.append(NewsArticle.article_type == article_type)
            # For BOTTLENECK filter: always show last 3 months of articles
            if article_type == "BOTTLENECK":
                three_months_ago = datetime.utcnow() - timedelta(days=90)
                conditions.append(NewsArticle.published_at >= three_months_ago)

        if source_name and source_name != "ALL":
            conditions.append(NewsArticle.source_name == source_name)

        if tickers:
            ticker_list = [t.strip().upper() for t in tickers.split(",")]
            ticker_conditions = [NewsArticle.tickers.contains([t]) for t in ticker_list]
            conditions.append(
                or_(*ticker_conditions) if len(ticker_conditions) > 1 else ticker_conditions[0]
            )

        if search:
            conditions.append(
                or_(
                    NewsArticle.headline.ilike(f"%{search}%"),
                    NewsArticle.summary.ilike(f"%{search}%"),
                )
            )

        # For bottleneck filter, use a higher limit to show full 3-month history
        effective_limit = 500 if (article_type and article_type == "BOTTLENECK") else limit

        query = (
            select(NewsArticle)
            .where(and_(*conditions))
            .order_by(desc(NewsArticle.published_at))
            .limit(effective_limit)
            .offset(offset)
        )

        result = await db.execute(query)
        return result.scalars().all()

    except Exception as e:
        logger.error(f"News fetch error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"News fetch error: {str(e)}")


@router.get("/in-play", response_model=list[NewsArticleRead])
async def get_in_play(
    db: AsyncSession = Depends(get_db),
):
    """Articles for the IN PLAY TODAY bar.

    Ranked by a composite score:
      score = (importance / 10) + log(ticker_count + 1) * 2 − hours_ago * 0.4

    This rewards recent articles, high-importance stories, and items that move
    multiple tickers (i.e. broad market-moving news).

    Tier strategy:
      1. Last 4 h, score ≥ 4  — breaking / high importance
      2. Last 12 h, score ≥ 4 — recent but potentially from overnight
      3. Last 12 h, score ≥ 3 — fallback: medium importance in past half-day

    Returns [] if nothing meets even the loosest criteria.
    """
    try:
        now = datetime.utcnow()
        candidates: list[NewsArticle] = []

        TIERS = [
            (4, 4),   # last 4 h, importance ≥ 4
            (12, 4),  # last 12 h, importance ≥ 4
            (12, 3),  # last 12 h, importance ≥ 3 (fallback)
        ]

        for hours, min_score in TIERS:
            cutoff = now - timedelta(hours=hours)
            result = await db.execute(
                select(NewsArticle)
                .where(
                    and_(
                        NewsArticle.importance_score >= min_score,
                        NewsArticle.published_at >= cutoff,
                        NewsArticle.is_duplicate == False,  # noqa: E712
                    )
                )
                .order_by(desc(NewsArticle.importance_score), desc(NewsArticle.published_at))
                .limit(100)
            )
            candidates = result.scalars().all()
            if len(candidates) >= 3:
                break

        if not candidates:
            return []

        def composite(art: NewsArticle) -> float:
            pub = art.published_at
            # Normalise to naive UTC so subtraction works
            if getattr(pub, "tzinfo", None) is not None:
                pub = pub.replace(tzinfo=None)
            hours_ago = max(0.0, (now - pub).total_seconds() / 3600)
            ticker_count = len(art.tickers) if isinstance(art.tickers, list) else 0
            # Normalise importance to 0-10 regardless of whether DB uses 1-5 or 0-100
            norm_importance = min(float(art.importance_score), 100.0) / 10.0
            return norm_importance + math.log(ticker_count + 1) * 2 - hours_ago * 0.4

        ranked = sorted(candidates, key=composite, reverse=True)
        return ranked[:12]

    except Exception as e:
        logger.error(f"In-play fetch error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"In-play fetch error: {str(e)}")


@router.get("/ticker/{ticker}", response_model=list[NewsArticleRead])
async def get_ticker_news(
    ticker: str,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Get news articles mentioning a specific ticker."""
    try:
        ticker = ticker.upper()
        result = await db.execute(
            select(NewsArticle)
            .where(NewsArticle.tickers.contains([ticker]))
            .order_by(desc(NewsArticle.published_at))
            .limit(limit)
        )
        return result.scalars().all()
    except Exception as e:
        logger.error(f"Ticker news fetch error for {ticker}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Ticker news fetch error: {str(e)}")


@router.post("/refresh", tags=["news"])
async def refresh_news(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger news ingestion."""
    try:
        from app.services.news_ingestor import NewsIngestor
        ingestor = NewsIngestor()
        count = await ingestor.ingest_all_sources(db)
        return {"success": True, "articles_added": count}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/reclassify-bottlenecks", tags=["news"])
async def reclassify_bottlenecks(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-scan ALL existing articles and tag any matching bottleneck keywords.

    This updates article_type, themes, and importance_score for articles
    that were ingested before bottleneck detection was added.
    """
    try:
        from app.services.news_ingestor import _detect_bottleneck, _score_importance

        result = await db.execute(select(NewsArticle))
        all_articles = result.scalars().all()
        updated = 0

        for art in all_articles:
            bottleneck_themes = _detect_bottleneck(art.headline, art.summary or "")
            if bottleneck_themes:
                art.article_type = "BOTTLENECK"
                art.themes = bottleneck_themes
                new_score = _score_importance(art.headline, art.summary or "", is_bottleneck=True)
                art.importance_score = max(art.importance_score, new_score)
                updated += 1

        await db.commit()
        return {"success": True, "articles_reclassified": updated, "total_scanned": len(all_articles)}
    except Exception as e:
        logger.error(f"Reclassify error: {e}")
        return {"success": False, "error": str(e)}


@router.get("/bottleneck-dashboard")
async def get_bottleneck_dashboard(
    region: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Clustered, hierarchized bottleneck intelligence dashboard.

    Returns macro-level bottleneck signals with:
    - Severity ranking (CRITICAL → MONITORING)
    - Event clustering (same story = one signal, not N articles)
    - Evidence articles grouped under each signal
    - Key tickers and source diversity
    """
    try:
        from app.services.bottleneck_engine import build_bottleneck_dashboard

        # Fetch all BOTTLENECK articles from last 90 days
        cutoff = datetime.utcnow() - timedelta(days=90)
        conditions = [
            NewsArticle.article_type == "BOTTLENECK",
            NewsArticle.published_at >= cutoff,
            NewsArticle.is_duplicate == False,  # noqa: E712
        ]
        if region and region != "ALL":
            conditions.append(or_(NewsArticle.region == region, NewsArticle.region == "GLOBAL"))
        result = await db.execute(
            select(NewsArticle)
            .where(and_(*conditions))
            .order_by(desc(NewsArticle.published_at))
        )
        articles = result.scalars().all()

        # Convert ORM objects to dicts for the engine
        article_dicts = []
        for art in articles:
            # Extract ticker symbols
            symbols = []
            for t in (art.tickers or []):
                if isinstance(t, str):
                    symbols.append(t)
                elif isinstance(t, dict) and t.get("ticker"):
                    symbols.append(t["ticker"])

            article_dicts.append({
                "id": str(art.id),
                "headline": art.headline,
                "summary": art.summary or "",
                "source_name": art.source_name,
                "source_url": art.source_url,
                "published_at": art.published_at,
                "importance_score": art.importance_score,
                "themes": art.themes if isinstance(art.themes, list) else [],
                "ticker_symbols": symbols,
                "sentiment": art.sentiment,
            })

        dashboard = build_bottleneck_dashboard(article_dicts)
        return {
            "success": True,
            "total_articles": len(article_dicts),
            "buckets": dashboard,
        }

    except Exception as e:
        logger.error(f"Bottleneck dashboard error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Bottleneck dashboard error: {str(e)}")


@router.get("/{article_id}", response_model=NewsArticleRead)
async def get_article(
    article_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single news article by ID."""
    from uuid import UUID
    try:
        article = await db.get(NewsArticle, UUID(article_id))
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        return article
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
