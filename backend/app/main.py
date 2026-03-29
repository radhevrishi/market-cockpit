"""Market Cockpit FastAPI application."""

import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import init_db, AsyncSessionLocal
from app.core.config import settings
from app.api.v1 import auth, portfolio, news, calendar, alerts, ai, market, watchlists

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting Market Cockpit API...")
    
    # Init DB tables
    await init_db()
    
    # Seed calendar data in background (non-blocking)
    asyncio.create_task(_seed_initial_data())
    
    yield
    
    logger.info("Shutting down Market Cockpit API...")


async def _seed_initial_data():
    """Seed initial data asynchronously on startup."""
    try:
        await asyncio.sleep(3)  # Wait for DB to be fully ready
        async with AsyncSessionLocal() as db:
            from app.services.calendar_service import CalendarService
            svc = CalendarService()
            result = await svc.sync_all_calendars(db)
            logger.info(f"Calendar seeded on startup: {result}")
    except Exception as e:
        logger.error(f"Startup seeding failed (non-fatal): {e}")
    
    # One-time cleanup: remove bad IBEF-scraped articles (broken URLs, wrong dates)
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            # Delete articles scraped from ibef.org (they have broken URLs)
            result = await db.execute(
                text("DELETE FROM news_articles WHERE source_name = 'IBEF' AND source_url LIKE '%ibef.org%'")
            )
            deleted = result.rowcount
            if deleted:
                await db.commit()
                logger.info(f"Cleaned up {deleted} IBEF-scraped articles with broken URLs")

            # Rename remaining "IBEF" articles to proper source names based on URL
            renames = [
                ("economictimes.indiatimes.com/industry", "ET Industry"),
                ("economictimes.indiatimes.com", "ET Markets"),
                ("business-standard.com/rss/economy", "BS Economy"),
                ("business-standard.com", "Business Standard"),
                ("livemint.com", "LiveMint"),
                ("moneycontrol.com", "MoneyControl"),
            ]
            total_renamed = 0
            for url_pattern, new_name in renames:
                r = await db.execute(
                    text("UPDATE news_articles SET source_name = :new_name WHERE source_name = 'IBEF' AND source_url LIKE :pattern"),
                    {"new_name": new_name, "pattern": f"%{url_pattern}%"},
                )
                total_renamed += r.rowcount
            if total_renamed:
                await db.commit()
                logger.info(f"Renamed {total_renamed} IBEF articles to correct source names")
    except Exception as e:
        logger.warning(f"IBEF cleanup failed (non-fatal): {e}")

    # One-time cleanup: fix CDATA-wrapped URLs in existing articles
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            result = await db.execute(
                text("UPDATE news_articles SET source_url = REPLACE(REPLACE(source_url, '<![CDATA[', ''), ']]>', '') WHERE source_url LIKE '%CDATA%'")
            )
            fixed = result.rowcount
            if fixed:
                await db.commit()
                logger.info(f"Fixed {fixed} articles with CDATA-wrapped URLs")
    except Exception as e:
        logger.warning(f"CDATA URL cleanup failed (non-fatal): {e}")

    # Remove existing Hindi/non-English articles from the database
    # (Hindi PIB RSS source has been removed; no new Hindi articles will be ingested)
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.news import NewsArticle
            from app.services.news_ingestor import _is_non_english
            result = await db.execute(select(NewsArticle))
            articles = result.scalars().all()
            deleted_count = 0
            for art in articles:
                if _is_non_english(art.headline):
                    await db.delete(art)
                    deleted_count += 1
            if deleted_count:
                await db.commit()
                logger.info(f"Removed {deleted_count} Hindi/non-English articles from database")
    except Exception as e:
        logger.warning(f"Hindi article cleanup failed (non-fatal): {e}")

    # Cap any articles with future timestamps to NOW().
    # RSS feeds sometimes pre-publish articles with future dates (e.g. LiveMint
    # buy/sell recs for next trading day). Also catches any remaining IST-as-UTC issues.
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            result = await db.execute(
                text("UPDATE news_articles SET published_at = NOW() WHERE published_at > NOW()")
            )
            fixed_tz = result.rowcount
            if fixed_tz:
                await db.commit()
                logger.info(f"Capped {fixed_tz} articles with future timestamps to NOW()")
    except Exception as e:
        logger.warning(f"Future timestamp fix failed (non-fatal): {e}")

    # One-time: delete Techmeme articles with techmeme.com source_url
    # so they get re-ingested with real source article URLs
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            result = await db.execute(
                text("DELETE FROM news_articles WHERE source_name = 'Techmeme' AND source_url LIKE '%techmeme.com%'")
            )
            deleted = result.rowcount
            if deleted:
                await db.commit()
                logger.info(f"Deleted {deleted} Techmeme articles for re-ingestion with real URLs")
    except Exception as e:
        logger.warning(f"Techmeme cleanup failed (non-fatal): {e}")

    try:
        async with AsyncSessionLocal() as db:
            from app.services.news_ingestor import NewsIngestor
            ingestor = NewsIngestor()
            count = await ingestor.ingest_all_sources(db)
            logger.info(f"News seeded on startup: {count} articles")
    except Exception as e:
        logger.error(f"Startup news ingestion failed (non-fatal): {e}")

    # Fix misclassified RATING_CHANGE articles (editorial pieces tagged as rating changes)
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.news import NewsArticle
            from app.services.news_ingestor import _is_rating_change
            result = await db.execute(
                select(NewsArticle).where(NewsArticle.article_type == "RATING_CHANGE")
            )
            articles = result.scalars().all()
            demoted = 0
            for art in articles:
                if not _is_rating_change(art.headline.lower()):
                    art.article_type = "GENERAL"
                    demoted += 1
            if demoted:
                await db.commit()
                logger.info(f"Demoted {demoted} editorial articles from RATING_CHANGE to GENERAL")
    except Exception as e:
        logger.warning(f"RATING_CHANGE cleanup failed (non-fatal): {e}")

    # ── Re-classify signal scores on ALL articles ─────────────────────────────
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.news import NewsArticle
            from app.services.news_relevance import classify_investment_relevance

            result = await db.execute(select(NewsArticle))
            all_articles = result.scalars().all()
            reclassified = 0

            for art in all_articles:
                # Extract ticker symbols
                ticker_symbols = []
                for t in (art.tickers or []):
                    if isinstance(t, str):
                        ticker_symbols.append(t)
                    elif isinstance(t, dict) and t.get("ticker"):
                        ticker_symbols.append(t["ticker"])

                relevance = classify_investment_relevance(
                    headline=art.headline,
                    summary=art.summary or "",
                    tickers=ticker_symbols,
                    importance_score=art.importance_score,
                    article_type=art.article_type,
                )

                if art.investment_tier != relevance["tier"] or art.relevance_tags != relevance.get("relevance_tags", []):
                    art.investment_tier = relevance["tier"]
                    art.relevance_tags = relevance.get("relevance_tags", [])
                    reclassified += 1

            if reclassified:
                await db.commit()
                logger.info(f"Re-classified signal scores on {reclassified}/{len(all_articles)} articles")
    except Exception as e:
        logger.warning(f"Signal reclassification failed (non-fatal): {e}")

    # Fix India Bottleneck cross-contamination: correct regions + re-run detection
    # Non-India articles (Tesla, ICE, etc.) that were incorrectly tagged with INDIA_* themes
    # will be stripped of those themes and possibly demoted from BOTTLENECK
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.news import NewsArticle
            from app.services.news_ingestor import _detect_bottleneck, _score_importance

            # Source-based region correction (fixes articles ingested with wrong region)
            indian_sources = {"ET Markets", "ET Economy", "MoneyControl", "MoneyControl Economy",
                             "LiveMint", "Business Standard", "IBEF", "Yahoo Finance IN",
                             "PIB India", "ElectronicsB2B"}
            us_sources = {"CNBC", "CNBC Economy", "CNBC World", "CNBC Tech", "MarketWatch",
                         "MarketWatch Pulse", "Bloomberg", "Reuters Finance",
                         "Yahoo Finance US", "Yahoo Finance US Financials", "The Information",
                         "Yahoo Tech Semis"}

            result = await db.execute(
                select(NewsArticle).where(NewsArticle.article_type == "BOTTLENECK")
            )
            articles = result.scalars().all()
            fixed = 0
            demoted = 0
            region_fixed = 0
            for art in articles:
                # First: correct region based on source_name
                sn = art.source_name or ""
                if sn in indian_sources:
                    correct_region = "IN"
                elif sn in us_sources:
                    text = ((art.headline or "") + " " + (art.summary or "")).lower()
                    india_kw = ["india", "indian", "nse", "bse", "sensex", "nifty",
                               "rupee", "rbi", "modi", "sebi", "adani", "reliance",
                               "tata", "infosys", "wipro"]
                    correct_region = "IN" if any(kw in text for kw in india_kw) else "US"
                else:
                    correct_region = art.region or "GLOBAL"
                if correct_region != art.region:
                    art.region = correct_region
                    region_fixed += 1

                new_themes = _detect_bottleneck(art.headline, art.summary or "", region=art.region or "")
                old_themes = art.themes if isinstance(art.themes, list) else []

                # Extra defense: force-strip INDIA_* themes from non-India articles
                # even if _detect_bottleneck returned them (e.g. due to generic keywords
                # like "tata" appearing in a non-India context)
                if art.region != "IN":
                    new_themes = [t for t in new_themes if not t.startswith("INDIA_")]

                if new_themes != old_themes:
                    if new_themes:
                        art.themes = new_themes
                        fixed += 1
                    else:
                        # No longer matches any bottleneck — demote to GENERAL
                        art.article_type = "GENERAL"
                        art.themes = []
                        art.importance_score = _score_importance(art.headline, art.summary or "", is_bottleneck=False)
                        demoted += 1
            if fixed or demoted or region_fixed:
                await db.commit()
                logger.info(f"Bottleneck region fix: updated {fixed} themes, demoted {demoted}, corrected {region_fixed} regions")
    except Exception as e:
        logger.warning(f"Bottleneck region fix failed (non-fatal): {e}")

    # Reclassify existing GENERAL articles that should be RATING_CHANGE, EARNINGS, etc.
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.news import NewsArticle
            from app.services.news_ingestor import _is_rating_change, _is_geopolitical, _is_tariff
            result = await db.execute(
                select(NewsArticle).where(NewsArticle.article_type == "GENERAL")
            )
            articles = result.scalars().all()
            reclassified = 0
            for art in articles:
                title_lower = art.headline.lower()
                if _is_rating_change(title_lower):
                    art.article_type = "RATING_CHANGE"
                    reclassified += 1
                elif any(w in title_lower for w in ["earnings", "results", "profit", "revenue", "q1", "q2", "q3", "q4", "quarterly", "net income"]):
                    art.article_type = "EARNINGS"
                    reclassified += 1
                elif any(w in title_lower for w in ["rbi", "fed", "rate cut", "rate hike", "gdp", "inflation", "cpi", "monetary policy"]):
                    art.article_type = "MACRO"
                    reclassified += 1
                elif _is_geopolitical(title_lower):
                    art.article_type = "GEOPOLITICAL"
                    reclassified += 1
                elif _is_tariff(title_lower):
                    art.article_type = "TARIFF"
                    reclassified += 1
                elif any(w in title_lower for w in ["merger", "acquisition", "deal", "buyout", "takeover", "stake"]):
                    art.article_type = "CORPORATE"
                    reclassified += 1
            if reclassified:
                await db.commit()
                logger.info(f"Reclassified {reclassified} articles with improved type detection")
    except Exception as e:
        logger.warning(f"Article reclassification failed (non-fatal): {e}")


app = FastAPI(
    title="Market Cockpit API",
    description="Bloomberg-lite financial dashboard for India + US equity investors",
    version="1.0.0",
    lifespan=lifespan,
)

_default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
# In production, CORS_ORIGINS env var overrides defaults
_origins = settings.cors_origins if settings.environment == "production" else _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router,      prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(news.router,      prefix="/api/v1")
app.include_router(calendar.router,  prefix="/api/v1")
app.include_router(alerts.router,    prefix="/api/v1")
app.include_router(ai.router,        prefix="/api/v1")
app.include_router(market.router,      prefix="/api/v1")
app.include_router(watchlists.router,  prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health_check():
    """Health check endpoint — checks DB and Redis connectivity."""
    import time
    status = {"status": "ok", "timestamp": int(time.time()), "services": {}}
    
    # Check DB
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            await db.execute(text("SELECT 1"))
        status["services"]["database"] = "ok"
    except Exception as e:
        status["services"]["database"] = f"error: {str(e)[:50]}"
        status["status"] = "degraded"
    
    # Check Redis (optional — not required for core functionality)
    try:
        from app.core.redis import get_redis, _redis_available
        r = await get_redis()
        await r.ping()
        status["services"]["redis"] = "ok" if _redis_available else "not_available (optional)"
    except Exception as e:
        status["services"]["redis"] = "not_available (optional)"
    
    # Check AI key — just check if it exists, don't validate credentials (would require API call)
    # Return 'present' if key is set and not a placeholder, 'not_configured' otherwise
    ai_status = "present" if (settings.anthropic_api_key and settings.anthropic_api_key != "your-anthropic-api-key-here" and len(settings.anthropic_api_key.strip()) > 0) else "not_configured"
    status["services"]["ai"] = ai_status

    # Check Alpha Vantage key
    av_status = "present" if (settings.alpha_vantage_key and settings.alpha_vantage_key != "your-alpha-vantage-key-here" and len(settings.alpha_vantage_key.strip()) > 0) else "not_configured"
    status["services"]["alpha_vantage"] = av_status

    return status


# Alias so the frontend can reach health via the /api/v1 proxy
@app.get("/api/v1/health", tags=["health"])
async def health_check_api():
    return await health_check()


@app.get("/", tags=["root"])
async def root():
    return {"message": "Market Cockpit API", "docs": "/docs", "health": "/health"}
