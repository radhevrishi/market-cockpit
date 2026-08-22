// ═══════════════════════════════════════════════════════════════════════════
// CRON: EARNINGS SELF-HEALING + SELF-FILLING SWEEP  (zzz417/zzz420)
//
// Runs 4×/day via the GitHub Actions cron bridge (03:00 / 06:00 / 11:00 /
// 14:00 UTC). Keeps the Earnings Opportunities page complete and warm — no
// Hard Refresh, no Backfill, no "Refresh N missing" clicks — for years,
// unattended. Two independent problems, two budgets:
//
//   HEAL  (missing CARDS): a cache written before the day's filings propagated
//          holds far fewer graded cards than the day filed (the 1-of-89 bug),
//          or is empty though the calendar has data. Fix = full force rebuild.
//
//   FILL  (missing DETAIL): the cards are all present but some lack YoY/margin
//          because Screener rate-limited the bulk enrich during the rebuild.
//          Fix = a refreshMissing pass (now serial + paced in the graded route,
//          so it actually completes instead of getting throttled).
//
// RECENT dates (<= RECENT_DAYS) always get force + fill (freshest intraday).
// OLDER dates get a cheap health check and are healed or filled only when
// needed, newest-first, capped by HEAL_BUDGET / FILL_BUDGET and DEADLINE_MS so
// the job always finishes inside its 5-min window. Past days are immutable, so
// once complete they're skipped forever — the window converges then maintains.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { railwaySelfFetch } from '@/lib/railway-self-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 min

const WINDOW_DAYS = 45;
const RECENT_DAYS = 2;
const HEAL_BUDGET = 5;         // max force-rebuilds (missing cards) per run
const FILL_BUDGET = 5;         // max refreshMissing passes (missing detail) per run
const DEADLINE_MS = 250_000;   // stop starting new work after ~4m10s
const UNDERCOUNT_RATIO = 0.6;
const MIN_RAW = 8;
const FILL_THRESHOLD = 8;      // # of un-enriched cards that triggers a fill pass

function tierTotal(g: any): number {
  return Object.values(g?.by_tier || {}).reduce<number>(
    (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature') || '';
  if (!vercelHeader && expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const windowDays = Math.min(120, Math.max(1, parseInt(searchParams.get('days') || String(WINDOW_DAYS), 10) || WINDOW_DAYS));
  const healBudgetMax = Math.max(0, parseInt(searchParams.get('heal') || String(HEAL_BUDGET), 10));
  const fillBudgetMax = Math.max(0, parseInt(searchParams.get('fill') || String(FILL_BUDGET), 10));
  const start = Date.now();
  const today = new Date();

  const results: any[] = [];
  let healsUsed = 0, fillsUsed = 0, healed = 0, filled = 0, refreshed = 0, healthy = 0;
  let budgetStopped = false;

  const forceGraded = async (date: string) => {
    const r = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1`, {
      cache: 'no-store', signal: AbortSignal.timeout(180_000),
    });
    return r.ok ? await r.json() : null;
  };
  const fillGraded = async (date: string) => {
    const r = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&refreshMissing=1`, {
      cache: 'no-store', signal: AbortSignal.timeout(180_000),
    });
    return r.ok ? await r.json() : null;
  };

  for (let i = 0; i <= windowDays; i++) {
    if (Date.now() - start > DEADLINE_MS) { budgetStopped = true; break; }
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const entry: any = { date };

    try {
      if (i <= RECENT_DAYS) {
        try {
          const liveRes = await railwaySelfFetch(`${origin}/api/v1/earnings/today-live?date=${date}&force=1`, {
            cache: 'no-store', signal: AbortSignal.timeout(20_000),
          });
          entry.today_live_status = liveRes.status;
          if (liveRes.ok) entry.today_live_count = (await liveRes.json())?.count || 0;
        } catch (e: any) { entry.today_live_error = e?.message || String(e); }

        const g = await forceGraded(date);
        if (g) entry.graded_total = tierTotal(g);
        const f = await fillGraded(date);   // always fill the hot dates
        if (f) { entry.graded_total = tierTotal(f); entry.refresh_msg = f?._refresh; }
        entry.action = 'refreshed+filled';
        refreshed++;
      } else {
        const chk = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}`, {
          cache: 'no-store', signal: AbortSignal.timeout(30_000),
        });
        entry.graded_status = chk.status;
        let cand = 0, raw = 0, failed = 0;
        if (chk.ok) {
          const j = await chk.json();
          cand = Number(j?.candidates_total) || tierTotal(j);
          raw = Number(j?.raw_items_total) || 0;
          failed = Array.isArray(j?._failed_tickers) ? j._failed_tickers.length : 0;
          entry.graded_total = cand; entry.raw_items_total = raw; entry.failed = failed;
        }
        const undercounted = (raw >= MIN_RAW && cand < UNDERCOUNT_RATIO * raw) || (cand === 0 && raw >= MIN_RAW);
        if (undercounted && healsUsed < healBudgetMax) {
          const g = await forceGraded(date);
          if (g) entry.graded_total_after = tierTotal(g);
          // a fresh rebuild often leaves an enrichment tail — fill it if budget allows
          if (fillsUsed < fillBudgetMax) { const f = await fillGraded(date); if (f) { entry.graded_total_after = tierTotal(f); entry.refresh_msg = f?._refresh; } fillsUsed++; }
          entry.action = 'healed'; healsUsed++; healed++;
        } else if (failed >= FILL_THRESHOLD && fillsUsed < fillBudgetMax) {
          const f = await fillGraded(date);
          if (f) { entry.graded_total = tierTotal(f); entry.refresh_msg = f?._refresh; entry.failed_after = Array.isArray(f?._failed_tickers) ? f._failed_tickers.length : undefined; }
          entry.action = 'filled'; fillsUsed++; filled++;
        } else if (undercounted) {
          entry.action = 'heal-deferred (budget)'; budgetStopped = true;
        } else if (failed >= FILL_THRESHOLD) {
          entry.action = 'fill-deferred (budget)';
        } else {
          entry.action = 'healthy'; healthy++;
        }
      }
    } catch (e: any) {
      entry.error = e?.message || String(e);
    }
    results.push(entry);
  }

  return NextResponse.json({
    status: 'ok',
    window_days: windowDays,
    scanned: results.length,
    refreshed, healed, filled, healthy,
    heals_used: healsUsed, fills_used: fillsUsed,
    budget_stopped: budgetStopped,
    elapsed_ms: Date.now() - start,
    results,
    completed_at: new Date().toISOString(),
  });
}

export async function POST(req: Request) { return GET(req); }
