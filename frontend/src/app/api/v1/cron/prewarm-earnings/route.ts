// ═══════════════════════════════════════════════════════════════════════════
// CRON: EARNINGS SELF-HEALING SWEEP  (zzz417 — rebuilt from PATCH 0504 prewarm)
//
// Runs 4×/day via the GitHub Actions cron bridge (03:00 / 06:00 / 11:00 /
// 14:00 UTC). Goal: the Earnings Opportunities page is ALWAYS a complete,
// warm cache hit — no Hard Refresh, no Backfill, no manual anything — for
// years, unattended.
//
// How it permanently kills the "1-of-89" bug:
//   • RECENT dates (<= RECENT_DAYS old): force a fresh today-live + graded
//     rebuild so intraday NSE+BSE filings are always reflected.
//   • OLDER dates (up to WINDOW_DAYS back): a CHEAP health check — read the
//     cached graded payload and compare candidates_total vs raw_items_total.
//     If undercounted (far fewer graded cards than the day actually filed) or
//     empty, force a full rebuild to recover the missing companies. Healthy
//     dates are instant cache hits and cost nothing.
//
// Budget: heavy rebuilds are capped per run (HEAL_BUDGET) and the sweep stops
// starting new work at DEADLINE_MS, so the job always finishes inside its
// 5-min window. Past filing days are immutable, so once a date is healed it
// stays healed and is skipped forever after — the window converges in a day
// or two and then just maintains itself.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { railwaySelfFetch } from '@/lib/railway-self-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 min

const WINDOW_DAYS = 45;       // how far back to keep healthy
const RECENT_DAYS = 2;        // <= this many days old = always force-refresh (intraday)
const HEAL_BUDGET = 6;        // max heavy force-rebuilds of OLDER dates per run
const DEADLINE_MS = 250_000;  // stop starting new work after ~4m10s (under the 5-min cap)
const UNDERCOUNT_RATIO = 0.6; // candidates < 60% of raw filings = undercounted cache
const MIN_RAW = 8;            // ignore genuinely-light days

function tierTotal(g: any): number {
  return Object.values(g?.by_tier || {}).reduce<number>(
    (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature') || '';
  // Only enforce the secret when one is actually configured (GitHub bridge
  // can't send the Vercel header). Same policy as PATCH 1041.
  if (!vercelHeader && expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const windowDays = Math.min(120, Math.max(1, parseInt(searchParams.get('days') || String(WINDOW_DAYS), 10) || WINDOW_DAYS));
  const healBudgetMax = Math.max(1, parseInt(searchParams.get('heal') || String(HEAL_BUDGET), 10) || HEAL_BUDGET);
  const start = Date.now();
  const today = new Date();

  const results: any[] = [];
  let healsUsed = 0, healed = 0, skipped = 0, refreshed = 0;
  let budgetStopped = false;

  for (let i = 0; i <= windowDays; i++) {
    if (Date.now() - start > DEADLINE_MS) { budgetStopped = true; break; }
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const entry: any = { date };

    try {
      if (i <= RECENT_DAYS) {
        // Freshest intraday view: warm today-live + force a graded rebuild.
        try {
          const liveRes = await railwaySelfFetch(`${origin}/api/v1/earnings/today-live?date=${date}&force=1`, {
            cache: 'no-store', signal: AbortSignal.timeout(20_000),
          });
          entry.today_live_status = liveRes.status;
          if (liveRes.ok) entry.today_live_count = (await liveRes.json())?.count || 0;
        } catch (e: any) { entry.today_live_error = e?.message || String(e); }

        const gRes = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1`, {
          cache: 'no-store', signal: AbortSignal.timeout(150_000),
        });
        entry.graded_status = gRes.status;
        if (gRes.ok) entry.graded_total = tierTotal(await gRes.json());
        entry.action = 'refreshed';
        refreshed++;
      } else {
        // Cheap health check (normal cache hit) — only heal if undercounted.
        const chk = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}`, {
          cache: 'no-store', signal: AbortSignal.timeout(30_000),
        });
        entry.graded_status = chk.status;
        let cand = 0, raw = 0;
        if (chk.ok) {
          const j = await chk.json();
          cand = Number(j?.candidates_total) || tierTotal(j);
          raw = Number(j?.raw_items_total) || 0;
          entry.graded_total = cand; entry.raw_items_total = raw;
        }
        const undercounted = (raw >= MIN_RAW && cand < UNDERCOUNT_RATIO * raw) || (cand === 0 && raw >= MIN_RAW);
        if (undercounted && healsUsed < healBudgetMax) {
          const fRes = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1`, {
            cache: 'no-store', signal: AbortSignal.timeout(150_000),
          });
          entry.heal_status = fRes.status;
          if (fRes.ok) entry.graded_total_after = tierTotal(await fRes.json());
          entry.action = 'healed';
          healsUsed++; healed++;
        } else if (undercounted) {
          entry.action = 'heal-deferred (budget)';
          budgetStopped = true;
        } else {
          entry.action = 'healthy';
          skipped++;
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
    refreshed, healed, skipped,
    heals_used: healsUsed,
    budget_stopped: budgetStopped,
    elapsed_ms: Date.now() - start,
    results,
    completed_at: new Date().toISOString(),
  });
}

// The GitHub cron bridge POSTs; delegate to GET.
export async function POST(req: Request) { return GET(req); }
