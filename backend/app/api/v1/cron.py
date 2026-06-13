"""Cron heartbeat + health router.

10y-ops Section 7.3. Every GH Actions cron POSTs to /heartbeat at start and end.
mc-guardian (Cloudflare worker) polls /health every 30 min and pages on stale.

This router is intentionally tiny — no auth at all costs. The whole point is
"if anything in the chain breaks, we hear about it". A misconfigured secret
on a workflow that silently 401s is exactly the failure we're trying to catch.
We rate-limit by trusting the schedule: at most 11 workflows × 2 calls each ≈
22 writes/hour. That's a non-event.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.cron_run import CronRun

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cron", tags=["cron"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class HeartbeatIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    phase: str = Field("end", pattern="^(start|end)$")
    ok: bool = True
    exit_code: Optional[int] = None
    error: Optional[str] = Field(None, max_length=500)
    run_url: Optional[str] = Field(None, max_length=500)


class HealthRow(BaseModel):
    name: str
    last_ok_at: Optional[datetime]
    last_started_at: Optional[datetime]
    hours_since_ok: Optional[float]
    stale: bool


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/heartbeat")
async def heartbeat(body: HeartbeatIn, db: AsyncSession = Depends(get_db)):
    """Record a cron heartbeat. phase=start writes started_at; phase=end finalizes."""
    if body.phase == "start":
        row = CronRun(name=body.name, started_at=datetime.utcnow(), ok=False, run_url=body.run_url)
        db.add(row)
        await db.commit()
        return {"ok": True, "id": str(row.id), "phase": "start"}

    # phase == "end" — finalize the most recent row for this name without finished_at
    res = await db.execute(
        select(CronRun)
        .where(CronRun.name == body.name, CronRun.finished_at.is_(None))
        .order_by(desc(CronRun.started_at))
        .limit(1)
    )
    row = res.scalar_one_or_none()
    if row is None:
        # no start row — synthesize one (workflow only sent end). Still useful.
        row = CronRun(name=body.name, started_at=datetime.utcnow(), run_url=body.run_url)
        db.add(row)

    row.finished_at = datetime.utcnow()
    row.ok = body.ok
    if body.exit_code is not None:
        row.exit_code = body.exit_code
    if body.error:
        row.error = body.error[:500]
    if body.run_url:
        row.run_url = body.run_url

    await db.commit()
    return {"ok": True, "phase": "end", "stored_ok": row.ok}


@router.get("/health")
async def health(stale_hours: float = 25.0, db: AsyncSession = Depends(get_db)):
    """Return one row per known cron name with last-ok timestamp + stale flag.

    mc-guardian polls this every 30 min and pages on any stale=True.
    stale_hours=25 because most crons run daily; the extra hour buys timezone slop.
    """
    # All distinct names ever seen, plus latest ok=True per name
    res = await db.execute(select(CronRun.name).distinct())
    names = [r[0] for r in res.all()]

    cutoff = datetime.now(timezone.utc) - timedelta(hours=stale_hours)
    out: list[HealthRow] = []

    for name in names:
        ok_res = await db.execute(
            select(CronRun)
            .where(CronRun.name == name, CronRun.ok == True)  # noqa: E712
            .order_by(desc(CronRun.finished_at))
            .limit(1)
        )
        last_ok = ok_res.scalar_one_or_none()

        any_res = await db.execute(
            select(CronRun)
            .where(CronRun.name == name)
            .order_by(desc(CronRun.started_at))
            .limit(1)
        )
        last_any = any_res.scalar_one_or_none()

        last_ok_at = last_ok.finished_at if last_ok else None
        last_started = last_any.started_at if last_any else None
        hours_since_ok = None
        if last_ok_at is not None:
            delta = datetime.now(timezone.utc) - (
                last_ok_at if last_ok_at.tzinfo else last_ok_at.replace(tzinfo=timezone.utc)
            )
            hours_since_ok = round(delta.total_seconds() / 3600, 2)

        stale = last_ok_at is None or (
            (last_ok_at.tzinfo and last_ok_at < cutoff)
            or (not last_ok_at.tzinfo and last_ok_at.replace(tzinfo=timezone.utc) < cutoff)
        )

        out.append(
            HealthRow(
                name=name,
                last_ok_at=last_ok_at,
                last_started_at=last_started,
                hours_since_ok=hours_since_ok,
                stale=stale,
            )
        )

    out.sort(key=lambda r: (not r.stale, r.name))  # stale first
    any_stale = any(r.stale for r in out)
    return {"ok": not any_stale, "stale_count": sum(1 for r in out if r.stale), "rows": [r.model_dump() for r in out]}
