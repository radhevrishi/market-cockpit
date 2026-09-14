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

// The job's own budget. It is deliberately shorter than the graded route's
// ceiling: this endpoint is called from GitHub Actions over the public edge,
// which cuts long requests, so the job must return in time to report. A
// session it cannot finish inside the budget is STARTED and not awaited — see
// the fire-and-forget below.
const DEADLINE_MS = 230_000;
// The pages offer a THREE-MONTH bench window — about 63 trading sessions — and
// warming only thirty of them meant the older half of that window was always
// cold. Every cold session is graded one at a time, so a three-month sweep
// arrived as "13 could not be scanned" and a bench of ten names. Warming the
// whole range a session at a time costs nothing extra: a session already cached
// for the current engine version is skipped without touching EDGAR, so a run
// over 90 sessions on a warm window is 90 Redis reads and nothing else.
const MAX_SESSIONS = 95;

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

  // THE DAY THE BUDGET CANNOT COVER IS STILL STARTED.
  //
  // A heavy session takes longer than this job may run, so waiting for it is
  // impossible — but the work does not have to be wasted. Once the budget is
  // spent, the next cold session is kicked off over loopback and NOT awaited:
  // the server keeps grading it after this response returns, and writes it to
  // Redis when it finishes. Each run therefore leaves one more heavy day
  // permanently warm, and the window converges instead of stalling on the
  // first day that is too big to finish in five minutes.
  // ONE at a time. The earlier version launched three, reasoning that they
  // share the SEC gate anyway so they merely interleave. The throughput half
  // of that was right and the memory half was wrong: each concurrent grade
  // holds several multi-megabyte companyfacts documents while it waits its
  // turn at the gate, and three heavy August sessions together were enough to
  // hit the container's ceiling — Railway restarts the process and all three
  // die having written nothing, which is exactly why those sessions stayed
  // cold however often the job ran. Serialised, each one finishes and is
  // cached for good; the window converges over a few runs instead of never.
  const BACKGROUND_MAX = 1;
  const launched: string[] = [];
  for (const d of days) {
    if (Date.now() - t0 > DEADLINE_MS) {
      if (launched.length < BACKGROUND_MAX && d < today) {
        try {
          const already = await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${d}|1`).catch(() => null);
          if (!already?.by_tier && !already?.z) {
            launched.push(d);
            // LOOPBACK DIRECTLY, NOT VIA THE FALLBACK.
            //
            // `railwaySelfFetch` only drops to 127.0.0.1 when the public fetch
            // THROWS. A request that runs past the edge's own timeout does not
            // throw — it returns a 502 — so the background grade was still
            // edge-bound and still died at ~300s, which is why the seven
            // heaviest August sessions never cached however many times the job
            // ran. The edge is exactly what must be bypassed here: nobody is
            // waiting on this response, and the route's own ceiling is 900s.
            const port = process.env.PORT;
            const bgUrl = port
              ? `http://127.0.0.1:${port}/api/v1/earnings/graded-us?date=${d}&days=1`
              : `${origin}/api/v1/earnings/graded-us?date=${d}&days=1`;
            void fetch(bgUrl, { cache: 'no-store', headers: { 'x-mc-prewarm': 'background' } })
              .catch(() => {});
          }
        } catch { /* nothing to launch */ }
      }
      skippedForTime++; continue;
    }
    // TODAY IS NEVER WARMED. It is still filling up, and a half-day written to
    // a thirty-day cache is worse than no cache at all.
    if (d >= today) { continue; }
    // Already computed for THIS engine version? Then there is nothing to do,
    // and asking EDGAR would be pure waste. The key must match the one the
    // graded route writes.
    try {
      const hit = await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${d}|1`);
      if (hit?.by_tier || hit?.z) { cached.push(d); continue; }
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
    left_running_in_background: launched,
    detail: { warmed, failed, skipped_for_time: skippedForTime },
    note: skippedForTime
      ? `Deadline reached${launched.length ? ` — ${launched.join(', ')} left grading in the background and will be cached when they finish` : ''}. Run again to continue; sessions already warmed are skipped for free.`
      : 'Window fully warm for this engine version.',
  });
}
