// ═══════════════════════════════════════════════════════════════════════════
// CRON: WARM THE US GRADED SESSIONS  (zzz593)
//
// WHY THIS EXISTS — the arithmetic that makes the page slow
//
// Every US number comes from sec.gov, and sec.gov publishes a fair-access
// limit of 10 requests a second; the engine holds itself to 8, process-wide,
// because exceeding it earns a ten-minute IP block. A single session of the
// late-August wave is roughly 250 requests — the daily index, then companyfacts
// and the press-release exhibit for every filer that reported — so it takes
// about 40 seconds of pure queue time, and the heaviest days take 90.
//
// That limit is shared by every day being swept at once. Four sessions in
// flight do not go four times faster: they share one 8/s queue. A 30-session
// window is therefore (total requests) ÷ 8 per second ≈ ten to thirteen
// minutes, and NO amount of client parallelism can shorten it. "9 of 30 after
// several minutes" is not a defect; it is the speed of the source.
//
// There are exactly two ways around a hard rate limit: do not repeat the work
// (the Redis session cache does that — a completed session is immutable and is
// served in milliseconds for thirty days), and DO THE WORK BEFORE THE READER
// ARRIVES. This job is the second one. It grades each recent session on a
// schedule, straight into Redis, so by the time the page is opened the window
// is already computed and the sweep is thirty cache reads instead of six
// thousand SEC requests.
//
// It is also the answer to the one case the cache cannot cover: a change to
// the grading rules bumps US_ENGINE_VERSION and every cached session is
// correctly invalidated. Left alone, the next visitor pays the full ten
// minutes. Run this after a deploy and nobody does.
//
//   GET /api/v1/cron/prewarm-us-earnings?secret=<CRON_SECRET>&sessions=30
//
// Cheap and idempotent: a session already cached for the CURRENT engine
// version is skipped without touching EDGAR, so repeated runs converge on a
// warm window and then cost nothing. Budgeted by a deadline so the job always
// returns inside its window; whatever is left is picked up on the next run.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { railwaySelfFetch } from '@/lib/railway-self-fetch';
import { windowSessions } from '@/lib/us-merge';
import { kvGet } from '@/lib/kv';
import { US_ENGINE_VERSION } from '@/lib/us-engine-version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEADLINE_MS = 250_000;      // stop starting new sessions after ~4m10s
const MAX_SESSIONS = 60;

/** The engine's own trading-day calendar, so this warms exactly the sessions
 *  the page will ask for — never a Saturday the page never requests. */
function etToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const secret = u.searchParams.get('secret') || req.headers.get('x-cron-secret') || '';
  const expected = process.env.CRON_SECRET || '';
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const sessions = Math.min(
    MAX_SESSIONS,
    Math.max(1, parseInt(u.searchParams.get('sessions') || '30', 10) || 30),
  );
  const today = etToday();
  const days = windowSessions(today, sessions);
  const origin = `${u.protocol}//${u.host}`;
  const t0 = Date.now();

  const warmed: string[] = [];
  const cached: string[] = [];
  const failed: Array<{ date: string; why: string }> = [];
  let skippedForTime = 0;

  for (const d of days) {
    if (Date.now() - t0 > DEADLINE_MS) { skippedForTime++; continue; }
    // TODAY IS NEVER WARMED. It is still filling up, and a half-day written to
    // a thirty-day cache is worse than no cache at all.
    if (d >= today) { continue; }
    // Already computed for THIS engine version? Then there is nothing to do,
    // and asking EDGAR would be pure waste. The key must match the one the
    // graded route writes.
    try {
      const hit = await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${d}|1`);
      if (hit?.by_tier) { cached.push(d); continue; }
    } catch { /* no Redis — fall through and grade it */ }
    try {
      const res = await railwaySelfFetch(
        `${origin}/api/v1/earnings/graded-us?date=${d}&days=1`,
        { cache: 'no-store', headers: { 'x-mc-prewarm': '1' } },
      );
      if (!res.ok) { failed.push({ date: d, why: `HTTP ${res.status}` }); continue; }
      const j = await res.json();
      if (!j?.by_tier) { failed.push({ date: d, why: 'no by_tier in payload' }); continue; }
      warmed.push(d);
    } catch (e: any) {
      failed.push({ date: d, why: String(e?.message || e).slice(0, 120) });
    }
  }

  return NextResponse.json({
    ok: true,
    engine_version: US_ENGINE_VERSION,
    window_sessions: sessions,
    already_cached: cached.length,
    warmed: warmed.length,
    failed: failed.length,
    left_for_next_run: skippedForTime,
    elapsed_s: Math.round((Date.now() - t0) / 1000),
    detail: { warmed, failed, skipped_for_time: skippedForTime },
    note: skippedForTime
      ? 'Deadline reached — run again to continue; sessions already warmed are skipped for free.'
      : 'Window fully warm for this engine version.',
  });
}
