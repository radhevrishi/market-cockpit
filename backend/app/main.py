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

    try:
        async with AsyncSessionLocal() as db:
            from app.services.news_ingestor import NewsIngestor
            ingestor = NewsIngestor()
            count = await ingestor.ingest_all_sources(db)
            logger.info(f"News seeded on startup: {count} articles")
    except Exception as e:
        logger.error(f"Startup news ingestion failed (non-fatal): {e}")

    # Reclassify existing GENERAL articles that should be RATING_CHANGE, EARNINGS, etc.
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            from app.models.news import NewsArticle
            from app.services.news_ingestor import _is_rating_change
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
                elif any(w in title_lower for w in ["merger", "acquisition", "deal", "buyout", "takeover", "stake"]):
                    art.article_type = "CORPORATE"
                    reclassified += 1
                elif any(w in title_lower for w in ["rbi", "fed", "rate cut", "rate hike", "gdp", "inflation", "cpi", "monetary policy"]):
                    art.article_type = "MACRO"
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
