"""
Application configuration using Pydantic Settings v2.
Loads environment variables from .env file.
"""

import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field

# Resolve DB path relative to the backend directory (where this file lives)
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_DEFAULT_DB_PATH = _BACKEND_DIR / "market_cockpit.db"
_DEFAULT_DB_URL = f"sqlite+aiosqlite:///{_DEFAULT_DB_PATH}"

# Find the best .env file
_ENV_FILE = str(_BACKEND_DIR / ".env")
if not (_BACKEND_DIR / ".env").exists():
    _parent_env = _BACKEND_DIR.parent / ".env"
    if _parent_env.exists():
        _ENV_FILE = str(_parent_env)


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database — always use absolute path so SQLite works regardless of CWD
    database_url: str = Field(
        default=_DEFAULT_DB_URL,
        alias="DATABASE_URL"
    )

    # Redis
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        alias="REDIS_URL"
    )

    # Security
    secret_key: str = Field(
        default="your-secret-key-here-min-32-chars-change-in-production",
        alias="SECRET_KEY"
    )
    algorithm: str = Field(default="HS256", alias="ALGORITHM")
    access_token_expire_minutes: int = Field(
        default=43200,  # 30 days
        alias="ACCESS_TOKEN_EXPIRE_MINUTES"
    )

    # Third-party APIs
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    alpha_vantage_key: str = Field(default="", alias="ALPHA_VANTAGE_KEY")

    # CORS
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:8000"],
        alias="CORS_ORIGINS"
    )

    # Polling intervals (seconds)
    news_poll_interval_seconds: int = Field(
        default=180,
        alias="NEWS_POLL_INTERVAL_SECONDS"
    )
    alert_check_interval_seconds: int = Field(
        default=60,
        alias="ALERT_CHECK_INTERVAL_SECONDS"
    )

    # AI Brief timing (in respective timezones)
    ai_brief_morning_ist: str = Field(
        default="08:30",
        alias="AI_BRIEF_MORNING_IST"
    )
    ai_brief_close_est: str = Field(
        default="17:30",
        alias="AI_BRIEF_CLOSE_EST"
    )

    # Monitoring
    sentry_dsn: Optional[str] = Field(default=None, alias="SENTRY_DSN")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    class Config:
        env_file = _ENV_FILE
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"


def _fix_db_url(url: str) -> str:
    """Ensure SQLite URL uses an absolute path."""
    if "sqlite" in url and ":///" in url:
        # Extract the path portion after sqlite+aiosqlite:///
        prefix, _, path = url.partition(":///")
        if path.startswith("./") or not path.startswith("/"):
            abs_path = str(_BACKEND_DIR / path.lstrip("./"))
            return f"{prefix}:///{abs_path}"
    return url


settings = Settings()
# Fix relative DB paths loaded from .env
settings.database_url = _fix_db_url(settings.database_url)
