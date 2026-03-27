"""
Celery tasks for asynchronous data ingestion and processing.
"""

import logging
from app.workers.celery_app import celery_app
from app.core.database import init_db, get_session_maker
from app.core.config import settings
from app.services.news_ingestor import NewsIngestor
from app.services.calendar_service import CalendarService
from app.services.alert_engine import AlertEngine
from app.services.ai_summarizer import AISummarizerService
import redis.asyncio as aioredis
from sqlalchemy import select

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.ingestion_tasks.ingest_news_sources")
def ingest_news_sources():
    """
    Ingest news from all configured sources.
    Runs every 3 minutes via Celery Beat.
    """
    import asyncio
    
    async def run():
        await init_db()
        session_maker = get_session_maker()
        
        async with session_maker() as db:
            service = NewsIngestor()
            count = await service.ingest_all_sources(db)
            logger.info(f"Ingested {count} news articles")
            return count
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    result = loop.run_until_complete(run())
    return result


@celery_app.task(name="app.workers.ingestion_tasks.sync_calendars_task")
def sync_calendars_task():
    """
    Sync earnings and economic calendars.
    Runs every 60 minutes via Celery Beat.
    """
    import asyncio
    
    async def run():
        await init_db()
        session_maker = get_session_maker()
        
        async with session_maker() as db:
            service = CalendarService()
            result = await service.sync_all_calendars(db)
            logger.info(f"Calendar sync complete: {result}")
            return result
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    result = loop.run_until_complete(run())
    return result


@celery_app.task(name="app.workers.ingestion_tasks.evaluate_alerts_task")
def evaluate_alerts_task():
    """
    Evaluate all active alert rules.
    Runs every 60 seconds via Celery Beat.
    """
    import asyncio
    
    async def run():
        await init_db()
        session_maker = get_session_maker()
        redis_client = aioredis.from_url(settings.redis_url)
        
        async with session_maker() as db:
            service = AlertEngine(redis_client)
            count = await service.evaluate_price_alerts(db)
            logger.info(f"Evaluated alerts: {count} triggered")
            return count
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    result = loop.run_until_complete(run())
    return result


@celery_app.task(name="app.workers.ingestion_tasks.generate_morning_briefs_task")
def generate_morning_briefs_task():
    """
    Generate morning briefs for all active users.
    Runs at 8:30 AM IST via Celery Beat.
    """
    import asyncio
    from app.models.user import User
    
    async def run():
        await init_db()
        session_maker = get_session_maker()
        redis_client = aioredis.from_url(settings.redis_url)
        
        async with session_maker() as db:
            # Get all active users
            result = await db.execute(select(User).where(User.is_active == True))
            users = result.scalars().all()
            
            ai_service = AISummarizerService(redis_client)
            
            for user in users:
                try:
                    brief = await ai_service.generate_morning_brief(str(user.id), db)
                    logger.info(f"Generated morning brief for user {user.id}")
                except Exception as e:
                    logger.error(f"Error generating brief for {user.id}: {e}")
            
            return len(users)
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    result = loop.run_until_complete(run())
    return result


@celery_app.task(name="app.workers.ingestion_tasks.generate_evening_briefs_task")
def generate_evening_briefs_task():
    """
    Generate evening briefs for all active users.
    Runs at 5:30 PM EST via Celery Beat.
    """
    import asyncio
    from app.models.user import User
    
    async def run():
        await init_db()
        session_maker = get_session_maker()
        redis_client = aioredis.from_url(settings.redis_url)
        
        async with session_maker() as db:
            result = await db.execute(select(User).where(User.is_active == True))
            users = result.scalars().all()
            
            ai_service = AISummarizerService(redis_client)
            
            for user in users:
                try:
                    brief = await ai_service.generate_morning_brief(str(user.id), db)
                    logger.info(f"Generated evening brief for user {user.id}")
                except Exception as e:
                    logger.error(f"Error generating brief for {user.id}: {e}")
            
            return len(users)
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    result = loop.run_until_complete(run())
    return result


@celery_app.task(name="app.workers.ingestion_tasks.backfill_ticker_context")
def backfill_ticker_context(ticker: str, exchange: str, user_id: str):
    """
    Backfill market context for a newly added ticker.
    Called when user adds ticker to portfolio or watchlist.
    """
    import asyncio
    from app.services.market_data import MarketDataService
    
    async def run():
        market_data = MarketDataService()
        quote = await market_data.get_quote(ticker, exchange)
        fundamentals = await market_data.get_fundamentals(ticker, exchange)
        ohlcv = await market_data.get_ohlcv(ticker, exchange)
        
        logger.info(f"Backfilled context for {ticker}")
        return {
            "ticker": ticker,
            "quote": quote,
            "fundamentals": fundamentals,
            "ohlcv_points": len(ohlcv)
        }
    
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    result = loop.run_until_complete(run())
    return result
