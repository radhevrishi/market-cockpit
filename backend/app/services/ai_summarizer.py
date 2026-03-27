"""
AI summarization service using Anthropic Claude API.
Generates morning/evening briefs, trade explanations, earnings memos, and chat.
"""

import logging
import json
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.models.portfolio import Portfolio, Position
from app.models.news import NewsArticle
from app.models.user import UserProfile

logger = logging.getLogger(__name__)

# Lazy-init Anthropic client to avoid import-time crashes
_client = None

def _get_anthropic():
    global _client
    if _client is None:
        try:
            from anthropic import Anthropic
            _client = Anthropic(api_key=settings.anthropic_api_key)
        except Exception as e:
            logger.warning(f"Could not init Anthropic client: {e}")
            return None
    return _client

CACHE_TTL = 1800  # 30 minutes


class AISummarizerService:
    """Service for AI-powered financial insights and summaries."""

    def __init__(self, redis_client=None):
        """Initialize with optional Redis client for caching."""
        self.redis = redis_client

    async def _get_cache(self, key: str) -> str | None:
        """Get cached response from Redis."""
        if not self.redis:
            return None
        try:
            data = await self.redis.get(key)
            if data:
                return data if isinstance(data, str) else data.decode()
        except Exception as e:
            logger.debug(f"Cache get error (non-fatal): {e}")
        return None

    async def _set_cache(self, key: str, value: str) -> None:
        """Cache response in Redis."""
        if not self.redis:
            return
        try:
            await self.redis.setex(key, CACHE_TTL, value)
        except Exception as e:
            logger.debug(f"Cache set error (non-fatal): {e}")
    
    async def generate_morning_brief(
        self,
        user_id: str,
        db: AsyncSession
    ) -> str:
        """
        Generate morning market brief for user.

        Args:
            user_id: User ID
            db: Database session

        Returns:
            AI-generated morning brief text
        """
        cache_key = f"morning_brief:{user_id}:{datetime.now().date()}"

        # Check cache first
        cached = await self._get_cache(cache_key)
        if cached:
            return cached

        try:
            # Build context
            context = await self._build_user_context(user_id, db)
            recent_news = await self._get_recent_news(db, limit=5)

            prompt = f"""You are a seasoned financial analyst providing morning market intelligence to an investor.

User's Portfolio Context:
{context}

Recent Market Headlines:
{json.dumps(recent_news, indent=2, default=str)}

Provide a concise 2-3 paragraph morning brief covering:
1. Key market themes and expected moves today
2. Relevant opportunities or risks for the user's portfolio
3. Key events to watch

Be conversational but professional. Focus on actionable insights."""

            response = _get_anthropic().messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )

            brief = response.content[0].text
            await self._set_cache(cache_key, brief)
            return brief

        except Exception as e:
            logger.error(f"Error generating morning brief: {e}")
            # Return clean error message without technical details
            raise e

    async def generate_evening_brief(
        self,
        user_id: str,
        db: AsyncSession
    ) -> str:
        """
        Generate evening market brief for user.

        Args:
            user_id: User ID
            db: Database session

        Returns:
            AI-generated evening brief text
        """
        cache_key = f"evening_brief:{user_id}:{datetime.now().date()}"

        # Check cache first
        cached = await self._get_cache(cache_key)
        if cached:
            return cached

        try:
            # Build context
            context = await self._build_user_context(user_id, db)
            recent_news = await self._get_recent_news(db, limit=5)

            prompt = f"""You are a seasoned financial analyst providing evening market recap and insights to an investor.

User's Portfolio Context:
{context}

Today's Market Headlines:
{json.dumps(recent_news, indent=2, default=str)}

Provide a concise 2-3 paragraph evening brief covering:
1. Major market moves and winners/losers today
2. How today's action impacts the user's portfolio
3. What to watch for in tomorrow's session

Be conversational but professional. Focus on actionable insights."""

            response = _get_anthropic().messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )

            brief = response.content[0].text
            await self._set_cache(cache_key, brief)
            return brief

        except Exception as e:
            logger.error(f"Error generating evening brief: {e}")
            # Return clean error message without technical details
            raise e
    
    async def explain_ticker_move(
        self,
        ticker: str,
        exchange: str,
        user_id: str,
        db: AsyncSession
    ) -> str:
        """
        Explain why a ticker moved today.
        
        Args:
            ticker: Stock ticker
            exchange: Stock exchange
            user_id: User ID
            db: Database session
        
        Returns:
            AI explanation of move
        """
        try:
            # Get recent news for ticker
            news = await self._get_news_for_ticker(db, ticker, exchange, hours=24, limit=5)
            
            prompt = f"""Analyze why {ticker} ({exchange}) might have moved significantly today.

Recent News:
{json.dumps(news, indent=2, default=str)}

Provide a 2-3 paragraph explanation covering:
1. Most likely driver of the move
2. Sector or market implications
3. What to watch next

Be analytical and evidence-based."""
            
            response = _get_anthropic().messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.content[0].text
        
        except Exception as e:
            logger.error(f"Error explaining ticker move: {e}")
            raise e
    
    async def generate_earnings_memo(
        self,
        ticker: str,
        exchange: str,
        db: AsyncSession
    ) -> str:
        """
        Generate earnings memo with 3-quarter trend analysis.
        
        Args:
            ticker: Stock ticker
            exchange: Stock exchange
            db: Database session
        
        Returns:
            AI-generated earnings memo
        """
        try:
            # In a real implementation, this would fetch actual earnings data
            # For now, using mock data structure
            
            prompt = f"""Generate an earnings analysis memo for {ticker} ({exchange}).

Focus on:
1. 3-quarter earnings trend and runway
2. Key margin and revenue drivers
3. Forward guidance and analyst consensus
4. Key risks and opportunities

Format as a professional investment memo with clear sections."""
            
            response = _get_anthropic().messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.content[0].text
        
        except Exception as e:
            logger.error(f"Error generating earnings memo: {e}")
            raise e
    
    async def chat_with_context(
        self,
        user_id: str,
        message: str,
        db: AsyncSession
    ) -> str:
        """
        Free-form chat with portfolio context.
        
        Args:
            user_id: User ID
            message: User message
            db: Database session
        
        Returns:
            AI response with portfolio context
        """
        try:
            context = await self._build_user_context(user_id, db)
            
            system_prompt = f"""You are a knowledgeable financial advisor helping an investor.
            
You have knowledge of their portfolio:
{context}

Be conversational, helpful, and evidence-based. Provide actionable insights when relevant."""
            
            response = _get_anthropic().messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                system=system_prompt,
                messages=[{"role": "user", "content": message}]
            )
            
            return response.content[0].text
        
        except Exception as e:
            logger.error(f"Error in chat: {e}")
            raise e
    
    async def _build_user_context(self, user_id: str, db: AsyncSession) -> str:
        """Build user portfolio context for AI prompts."""
        try:
            from uuid import UUID as _UUID
            uid = _UUID(user_id) if isinstance(user_id, str) else user_id

            # Get user profile
            result = await db.execute(
                select(UserProfile).where(UserProfile.user_id == uid)
            )
            profile = result.scalars().first()

            # Get portfolios and positions
            result = await db.execute(
                select(Portfolio).where(Portfolio.user_id == uid)
            )
            portfolios = result.scalars().all()
            
            context_parts = []
            for portfolio in portfolios:
                context_parts.append(f"Portfolio: {portfolio.name} ({portfolio.currency})")
                
                result = await db.execute(
                    select(Position).where(Position.portfolio_id == portfolio.id)
                )
                positions = result.scalars().all()
                
                for pos in positions:
                    context_parts.append(
                        f"  - {pos.company_name} ({pos.ticker}): "
                        f"{pos.quantity} units @ {pos.avg_cost}"
                    )
            
            return "\n".join(context_parts) or "No positions in portfolio"
        
        except Exception as e:
            logger.error(f"Error building user context: {e}")
            return "Portfolio context unavailable"
    
    async def _get_recent_news(self, db: AsyncSession, limit: int = 5) -> list[dict]:
        """Get recent market news."""
        try:
            result = await db.execute(
                select(NewsArticle)
                .order_by(NewsArticle.published_at.desc())
                .limit(limit)
            )
            articles = result.scalars().all()
            
            return [
                {
                    "headline": article.headline,
                    "summary": article.summary,
                    "importance": article.importance_score,
                    "region": article.region,
                }
                for article in articles
            ]
        except Exception as e:
            logger.error(f"Error getting recent news: {e}")
            return []
    
    async def _get_news_for_ticker(
        self,
        db: AsyncSession,
        ticker: str,
        exchange: str,
        hours: int = 24,
        limit: int = 5
    ) -> list[dict]:
        """Get recent news for specific ticker."""
        try:
            from datetime import timedelta
            cutoff = datetime.utcnow() - timedelta(hours=hours)
            
            # Search in tickers JSON array
            result = await db.execute(
                select(NewsArticle)
                .where(NewsArticle.published_at > cutoff)
                .order_by(NewsArticle.published_at.desc())
                .limit(limit)
            )
            articles = result.scalars().all()
            
            # Filter by ticker in tickers list (handles both str and dict formats)
            matching = []
            for article in articles:
                article_tickers = article.tickers or []
                for ticker_ref in article_tickers:
                    t = ticker_ref if isinstance(ticker_ref, str) else ticker_ref.get("ticker", "")
                    if t == ticker:
                        matching.append({
                            "headline": article.headline,
                            "summary": article.summary,
                            "importance": article.importance_score,
                            "source": article.source_name,
                        })
                        break
            
            return matching
        except Exception as e:
            logger.error(f"Error getting ticker news: {e}")
            return []
