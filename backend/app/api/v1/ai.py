"""
FastAPI router for AI-powered features (briefs, explanations, chat).
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_user
from app.services.ai_summarizer import AISummarizerService

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


def _redis_client():
    """Get optional Redis client; returns None if Redis unavailable."""
    try:
        import redis.asyncio as aioredis
        return aioredis.from_url(settings.redis_url)
    except Exception:
        return None


async def _close_redis(rc):
    """Safely close a Redis client."""
    if rc:
        try:
            await rc.aclose()
        except Exception:
            pass


def _check_ai_key():
    """Return True if AI key is configured."""
    return bool(settings.anthropic_api_key and settings.anthropic_api_key != "your-anthropic-api-key-here")


def _parse_ai_error(e: Exception) -> tuple[str, str]:
    """
    Parse AI API error and return (error_type, user_friendly_message).
    error_type can be: 'missing_key', 'insufficient_credits', 'rate_limited', 'unknown'
    """
    msg = str(e)
    msg_lower = msg.lower()

    if "credit balance" in msg_lower or "too low" in msg_lower or "insufficient_quota" in msg_lower:
        return ("insufficient_credits", "AI Brief unavailable — please check your Anthropic API credits")
    if "invalid_api_key" in msg_lower or "authentication" in msg_lower:
        return ("missing_key", "API key error — please check ANTHROPIC_API_KEY in .env")
    if "rate_limit" in msg_lower:
        return ("rate_limited", "API rate limit reached — please try again in a minute")
    if "overloaded" in msg_lower or "busy" in msg_lower:
        return ("service_overloaded", "Anthropic API is busy — please try again soon")

    # Default to unknown but still provide a safe message
    return ("unknown", "AI service error — please try again")


class ChatRequest(BaseModel):
    message: str
    portfolio_id: str | None = None


@router.get("/brief/morning")
async def get_morning_brief(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get today's morning market brief for user."""
    if not _check_ai_key():
        return {
            "type": "morning_brief",
            "content": [
                "API key not configured",
                "Add ANTHROPIC_API_KEY to your .env and restart",
                "Get your key at console.anthropic.com",
            ],
            "generated_at": datetime.utcnow().isoformat(),
            "model_version": None,
            "api_key_missing": True,
            "error": True,
            "error_type": "missing_key",
            "error_message": "Anthropic API key is not configured",
        }
    rc = None
    try:
        rc = _redis_client()
        ai_service = AISummarizerService(rc)
        brief = await ai_service.generate_morning_brief(user_id, db)
        content = brief if isinstance(brief, list) else str(brief).split("\n")
        return {
            "type": "morning_brief",
            "content": [line for line in content if line.strip()],
            "generated_at": datetime.utcnow().isoformat(),
            "model_version": "claude-3-haiku",
            "error": False,
        }
    except Exception as e:
        logger.error(f"Morning brief error: {e}")
        error_type, user_message = _parse_ai_error(e)
        return {
            "type": "morning_brief",
            "content": [user_message],
            "generated_at": datetime.utcnow().isoformat(),
            "model_version": None,
            "error": True,
            "error_type": error_type,
            "error_message": user_message,
        }
    finally:
        await _close_redis(rc)


@router.get("/brief/evening")
async def get_evening_brief(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get today's evening market brief for user."""
    if not _check_ai_key():
        return {
            "type": "evening_brief",
            "content": [
                "API key not configured",
                "Add ANTHROPIC_API_KEY to your .env and restart",
                "Get your key at console.anthropic.com",
            ],
            "generated_at": datetime.utcnow().isoformat(),
            "model_version": None,
            "api_key_missing": True,
            "error": True,
            "error_type": "missing_key",
            "error_message": "Anthropic API key is not configured",
        }
    rc = None
    try:
        rc = _redis_client()
        ai_service = AISummarizerService(rc)
        brief = await ai_service.generate_evening_brief(user_id, db)
        content = brief if isinstance(brief, list) else str(brief).split("\n")
        return {
            "type": "evening_brief",
            "content": [line for line in content if line.strip()],
            "generated_at": datetime.utcnow().isoformat(),
            "model_version": "claude-3-haiku",
            "error": False,
        }
    except Exception as e:
        logger.error(f"Evening brief error: {e}")
        error_type, user_message = _parse_ai_error(e)
        return {
            "type": "evening_brief",
            "content": [user_message],
            "generated_at": datetime.utcnow().isoformat(),
            "model_version": None,
            "error": True,
            "error_type": error_type,
            "error_message": user_message,
        }
    finally:
        await _close_redis(rc)


@router.post("/chat")
async def chat_with_context(
    body: ChatRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Free-form chat with portfolio context."""
    if not _check_ai_key():
        return {
            "message": body.message,
            "response": "API key not configured — add ANTHROPIC_API_KEY to .env and restart",
            "generated_at": datetime.utcnow().isoformat(),
            "api_key_missing": True,
            "error": True,
            "error_type": "missing_key",
            "error_message": "Anthropic API key is not configured",
        }
    rc = None
    try:
        rc = _redis_client()
        ai_service = AISummarizerService(rc)
        response = await ai_service.chat_with_context(user_id, body.message, db)
        return {
            "message": body.message,
            "response": response,
            "generated_at": datetime.utcnow().isoformat(),
            "error": False,
        }
    except Exception as e:
        logger.error(f"Chat error: {e}")
        error_type, user_message = _parse_ai_error(e)
        return {
            "message": body.message,
            "response": user_message,
            "generated_at": datetime.utcnow().isoformat(),
            "error": True,
            "error_type": error_type,
            "error_message": user_message,
        }
    finally:
        await _close_redis(rc)


@router.post("/explain/{ticker}")
async def explain_ticker_move(
    ticker: str,
    exchange: str = "NASDAQ",
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get AI explanation of why a ticker moved today."""
    if not _check_ai_key():
        return {
            "error": True,
            "error_type": "missing_key",
            "error_message": "Anthropic API key not configured",
            "ticker": ticker,
            "exchange": exchange,
        }
    rc = None
    try:
        rc = _redis_client()
        ai_service = AISummarizerService(rc)
        explanation = await ai_service.explain_ticker_move(ticker, exchange, user_id, db)
        return {
            "ticker": ticker,
            "exchange": exchange,
            "explanation": explanation,
            "generated_at": datetime.utcnow().isoformat(),
            "error": False,
        }
    except Exception as e:
        logger.error(f"Explain error for {ticker}: {e}")
        error_type, user_message = _parse_ai_error(e)
        return {
            "error": True,
            "error_type": error_type,
            "error_message": user_message,
            "ticker": ticker,
            "exchange": exchange,
        }
    finally:
        await _close_redis(rc)


@router.post("/memo/{ticker}")
async def get_earnings_memo(
    ticker: str,
    exchange: str = "NASDAQ",
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get 3-quarter earnings memo for a ticker."""
    if not _check_ai_key():
        return {
            "error": True,
            "error_type": "missing_key",
            "error_message": "Anthropic API key not configured",
            "ticker": ticker,
            "exchange": exchange,
        }
    rc = None
    try:
        rc = _redis_client()
        ai_service = AISummarizerService(rc)
        memo = await ai_service.generate_earnings_memo(ticker, exchange, db)
        return {
            "ticker": ticker,
            "exchange": exchange,
            "memo": memo,
            "generated_at": datetime.utcnow().isoformat(),
            "error": False,
        }
    except Exception as e:
        logger.error(f"Memo error for {ticker}: {e}")
        error_type, user_message = _parse_ai_error(e)
        return {
            "error": True,
            "error_type": error_type,
            "error_message": user_message,
            "ticker": ticker,
            "exchange": exchange,
        }
    finally:
        await _close_redis(rc)


@router.get("/briefs")
async def list_saved_briefs(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List saved AI briefs for user."""
    # Future: query saved briefs from DB
    return []


@router.get("/status")
async def ai_status(user_id: str = Depends(get_current_user)):
    """Check if AI features are available."""
    has_key = _check_ai_key()
    return {
        "ai_available": has_key,
        "anthropic_key_configured": has_key,
        "message": "AI features ready" if has_key else "Add ANTHROPIC_API_KEY to .env to enable AI features",
    }
