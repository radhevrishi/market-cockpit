"""CronRun heartbeat model.

10y-ops Section 7.3: each GH Actions cron POSTs a heartbeat at start + end
so we detect silent failures (Railway suspended, workflow disabled, secret
expired, etc.) instead of the dashboard going stale invisibly for weeks.

Schema is deliberately tiny — one row per (name, started_at). mc-guardian
queries "any name with no ok=True row in the last 25h?" and pages.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.db_types import GUID


class CronRun(Base):
    __tablename__ = "cron_runs"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    # workflow name, e.g. "refresh-movers", "vercel-cron-bridge", "scrape-corp-filings"
    name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True
    )
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    # exit_code from the workflow run (curl http_code, github runner exit, etc.)
    exit_code: Mapped[int] = mapped_column(default=0, nullable=True)
    # optional error message (truncated to 500 chars by endpoint)
    error: Mapped[str] = mapped_column(Text, nullable=True)
    # GitHub Actions run URL for one-click debugging
    run_url: Mapped[str] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        # composite index for "latest ok per name" query in mc-guardian
        Index("ix_cron_runs_name_ok_started", "name", "ok", "started_at"),
    )
