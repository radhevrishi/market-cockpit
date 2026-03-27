"""
Redis client setup with optional in-memory fallback.
If Redis is not available, all cache operations silently no-op.
"""

import json
import logging
from typing import Any, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

# Global async Redis client (initialized lazily)
redis_client: Optional[Any] = None
_redis_available: Optional[bool] = None


class _NoOpRedis:
    """Silent no-op Redis substitute when Redis is unavailable."""
    async def ping(self): return True
    async def get(self, key): return None
    async def setex(self, key, ttl, value): pass
    async def delete(self, key): pass
    async def publish(self, channel, message): pass
    async def aclose(self): pass
    async def subscribe(self, *channels): pass
    async def unsubscribe(self, *channels): pass


async def get_redis() -> Any:
    """Get Redis client, falling back to no-op if Redis is unavailable."""
    global redis_client, _redis_available
    if redis_client is not None:
        return redis_client
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        await client.ping()
        redis_client = client
        _redis_available = True
        logger.info("Redis connected successfully")
        return redis_client
    except Exception as e:
        if _redis_available is not False:
            logger.warning(f"Redis unavailable ({e}), using in-memory no-op fallback. Cache and pub/sub will be disabled.")
        _redis_available = False
        redis_client = _NoOpRedis()
        return redis_client


async def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    r = await get_redis()
    try:
        await r.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass


async def cache_get(key: str) -> Optional[Any]:
    r = await get_redis()
    try:
        raw = await r.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception:
        return None


async def cache_delete(key: str) -> None:
    r = await get_redis()
    try:
        await r.delete(key)
    except Exception:
        pass


async def publish(channel: str, message: Any) -> None:
    r = await get_redis()
    try:
        await r.publish(channel, json.dumps(message, default=str))
    except Exception:
        pass


async def close_redis() -> None:
    global redis_client
    if redis_client:
        try:
            await redis_client.aclose()
        except Exception:
            pass
        redis_client = None
