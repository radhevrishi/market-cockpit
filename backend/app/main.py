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
    """Startup and shutdown events.

    PATCH 0813: init_db() is now non-blocking. Previously the lifespan
    awaited init_db() before yielding control to FastAPI, which meant
    /health didn't become reachable until the DB connection completed.
    On Render's free-tier Postgres, the DB can take 30-60s to wake from
    sleep — longer than Render's deploy health-check window. That caused
    P0811's deploy to fail even though the code change was correct.
    """
    logger.info("Starting Market Cockpit API...")

    # PATCH 0813: fire init_db as a background task so /health is reachable
    # immediately. DB-dependent endpoints fail gracefully if init_db is
    # still in flight; they'll succeed on retry.
    asyncio.create_task(_init_db_background())

    # Seed calendar data in background (non-blocking, deferred 30s)
    asyncio.create_task(_seed_initial_data())

    yield

    logger.info("Shutting down Market Cockpit API...")


async def _init_db_background():
    """Init DB tables without blocking the lifespan / health check.

    Render free-tier Postgres can take 30-60s to wake from sleep on cold
    start. If we awaited this synchronously the health-check window
    would expire and Render would mark the deploy failed (status 3).
    Run it in the background — it'll complete a few seconds after the
    container is marked healthy.
    """
    try:
        await init_db()
        logger.info("DB tables initialized")
    except Exception as e:
        logger.error(f"init_db failed (non-fatal, routes that need DB will retry): {e}")


async def _seed_initial_data():
    """Seed initial data asynchronously on startup.

    PATCH 0811: stripped down from a 200-line one-time-cleanup blob that
    loaded every NewsArticle into memory multiple times on every cold
    start, OOM-killing the 512MB Render free-tier instance (exit status
    3 in operator alerts). All the cleanups it used to run have been
    completed long ago; if any need re-running, do it via a one-shot
    script — not on every boot.

    What this still does:
      • Wait 30s so the health-check endpoint is responsive first.
      • Calendar seed (legitimately recurring; cheap, single API call).

    What was removed (was running on every cold start):
      • IBEF article delete/rename
      • CDATA URL cleanup
      • Hindi-article full-table scan
      • Future-timestamp cap
      • Techmeme cleanup
      • News ingestion from all sources (~50MB peak)
      • RATING_CHANGE article rescan (loaded all articles)
      • Signal-score reclassification (loaded all articles)
      • Bottleneck region fix (loaded all articles, twice)
      • Article-type reclassification (loaded all articles)
    """
    try:
        # Defer 30s so /health responds before we touch the DB at all.
        # Render's health-check timeout is short on cold start; getting
        # /health green first prevents premature kill.
        await asyncio.sleep(30)
        async with AsyncSessionLocal() as db:
            from app.services.calendar_service import CalendarService
            svc = CalendarService()
            result = await svc.sync_all_calendars(db)
            logger.info(f"Calendar seeded on startup: {result}")
    except Exception as e:
        logger.error(f"Startup seeding failed (non-fatal): {e}")


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
    """PATCH 0811: shallow liveness probe — returns 200 OK immediately.

    Render's deployment health-check on the free tier has a tight
    timeout; if /health touches the DB it can fail during cold start
    while the lifespan startup is still warming up. Shallow probe
    keeps Render happy. Use /health/deep for the full status dump.
    """
    import time
    return {"status": "ok", "timestamp": int(time.time())}


@app.get("/health/deep", tags=["health"])
async def health_check_deep():
    """Deep health check — touches DB + Redis + integrations.

    Use this for monitoring + debugging. Render does NOT hit this for
    its deployment health-check (path is /health, not /health/deep).
    """
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

    # Check AI key — just check if it exists, don't validate credentials
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


@app.get("/api/v1/health/deep", tags=["health"])
async def health_check_api_deep():
    return await health_check_deep()


@app.get("/", tags=["root"])
async def root():
    return {"message": "Market Cockpit API", "docs": "/docs", "health": "/health"}
