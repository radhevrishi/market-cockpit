"""
SQLAlchemy async database setup and utilities.
Provides async engine, session factory, and FastAPI dependency.
"""

from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool, StaticPool
from fastapi import Depends

from app.core.config import settings

# Declarative base for all models
Base = declarative_base()

# Global references
_engine: Optional[AsyncEngine] = None
_async_session_maker: Optional[async_sessionmaker] = None


async def init_db() -> None:
    """Initialize database: create all tables."""
    global _engine, _async_session_maker
    
    # SQLite needs StaticPool for async + aiosqlite to work correctly
    is_sqlite = settings.database_url.startswith("sqlite")
    engine_kwargs = {
        "echo": settings.environment == "development",
        "poolclass": NullPool,
    }
    if is_sqlite:
        engine_kwargs["poolclass"] = StaticPool
        engine_kwargs["connect_args"] = {"check_same_thread": False}

    _engine = create_async_engine(settings.database_url, **engine_kwargs)
    
    _async_session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Close database connection pool."""
    if _engine:
        await _engine.dispose()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for database session.

    Auto-commits if the request handler succeeds (no exception).
    Rolls back on any error to keep the session clean.
    """
    if _async_session_maker is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _async_session_maker() as session:
        try:
            yield session
            # Auto-commit if handler completed without raising
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def get_engine() -> AsyncEngine:
    """Get the current async engine."""
    if _engine is None:
        raise RuntimeError("Database engine not initialized.")
    return _engine


def get_session_maker() -> async_sessionmaker:
    """Get the current async session maker."""
    if _async_session_maker is None:
        raise RuntimeError("Session maker not initialized.")
    return _async_session_maker


# Alias for code that imports AsyncSessionLocal directly (e.g. main.py seeding)
class _AsyncSessionLocalProxy:
    """Callable proxy so `async with AsyncSessionLocal() as db:` works."""
    def __call__(self):
        return get_session_maker()()


AsyncSessionLocal = _AsyncSessionLocalProxy()
