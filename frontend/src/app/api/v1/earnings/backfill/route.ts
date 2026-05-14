// PATCH 0360 — Bulk backfill for Earnings Opportunities cached payloads.
//
// The user's complaint: past-date pages keep showing preview-only cards
// because the original cache was built before Screener had the day's
// filings. Each visit requires a manual Refresh click. This endpoint
// processes a date range and writes fully-enriched payloads to KV so
// every past-date page becomes self-serving.
//
// Design:
//
//   1. Caller specifies `from` and `to` (YYYY-MM-DD). Server walks days
//      sequentially. Skips today and future dates (they're not immutable).
//
//   2. For each day, hits `/api/v1/earnings/graded?date=<d>&refreshMissing=1`
//      internally. The graded route's partial-refresh path enriches all
//      preview-shape cards and writes back to KV.
//
//   3. Returns a summary: which dates were processed, which were skipped,
//      which still have preview-heavy results (indicating Screener simply
//      has no Q-data for that filing date).
//
// Constraints:
//
//   - Vercel function budget (55s). Backfilling more than ~5-8 dates per
//     call risks timeout because each date may trigger multiple enrich
//     fetches. We cap the per-call window at MAX_DAYS_PER_CALL and tell
//     the caller to re-invoke for the remainder.
//
//   - To enable user-facing batch backfill, the UI repeatedly calls this
//     endpoint with the `cursor` field returned on each response until
//     `done=true`.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// PATCH 0361 — reduced from 6 → 2. A graded?refreshMissing=1 call can
// take 12-20s per date (30 tickers × ~500ms enrich). 6 dates = 90s, way
// over Vercel's 55s budget → 504. With 2 dates/batch we're at ~30-40s
// worst case, leaving comfortable margin. Frontend chains via cursor_next
// so total wall-time is unchanged (~3 min for 90 weekdays).
const MAX_DAYS_PER_CALL = 2;

// Per-date timeout for the internal graded fetch. If a single date hangs,
// we skip it (return 'error') and the next iteration moves on rather than
// blocking the whole batch.
const PER_DATE_TIMEOUT_MS = 22_000;

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const d = new Date(iso);
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

interface DayResult {
  date: string;
  status: 'enriched' | 'skipped-future' | 'skipped-today' | 'skipped-weekend' | 'no-cache' | 'preview-only' | 'error';
  total?: number;
  populated?: number;
  enriched?: number;
  message?: string;
}

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const { searchParams } = reqUrl;
  const origin = `${reqUrl.protocol}//${reqUrl.host}`;

  const todayIso = new Date().toISOString().slice(0, 10);
  // PATCH 0361 — default backfill window 60 days (was 90). User feedback:
  // 60 is enough for their workflow and improves total backfill latency.
  const fromParam = searchParams.get('from') || isoNDaysAgo(60);
  const toParam = searchParams.get('to') || isoNDaysAgo(1);  // default: yesterday
  const skipWeekends = searchParams.get('skipWeekends') !== '0';  // default true

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    return NextResponse.json({ error: 'from / to required as YYYY-MM-DD' }, { status: 400 });
  }
  if (fromParam > toParam) {
    return NextResponse.json({ error: 'from must be <= to' }, { status: 400 });
  }

  // Build the full date list, then cap at MAX_DAYS_PER_CALL.
  const allDates: string[] = [];
  for (let d = fromParam; d <= toParam; d = shiftDate(d, 1)) {
    allDates.push(d);
  }
  // Filter dates we won't touch.
  const eligible = allDates.filter((d) => {
    if (d >= todayIso) return false;
    if (skipWeekends && isWeekend(d)) return false;
    return true;
  });

  const skipped: DayResult[] = allDates
    .filter((d) => !eligible.includes(d))
    .map((d) => ({
      date: d,
      status: d >= todayIso ? (d === todayIso ? 'skipped-today' : 'skipped-future') : 'skipped-weekend',
    }));

  // Process up to MAX_DAYS_PER_CALL dates this invocation.
  const batch = eligible.slice(0, MAX_DAYS_PER_CALL);
  const remaining = eligible.slice(MAX_DAYS_PER_CALL);

  const results: DayResult[] = [...skipped];

  for (const date of batch) {
    try {
      // Hit graded with refreshMissing=1 so the partial-refresh path runs
      // and enriches all preview-shape cards into real graded ones.
      // PATCH 0361 — per-date AbortSignal timeout. If one date hangs we
      // skip it instead of letting it eat the whole 55s function budget.
      const url = `${origin}/api/v1/earnings/graded?date=${date}&refreshMissing=1`;
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PER_DATE_TIMEOUT_MS),
      });
      if (!res.ok) {
        results.push({ date, status: 'error', message: `graded ${res.status}` });
        continue;
      }
      const payload: any = await res.json();
      // Count populated (has YoY) vs total cards after the enrich pass.
      const allCards: any[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']
        .flatMap((t) => payload?.by_tier?.[t] || []);
      const total = allCards.length;
      const populated = allCards.filter((c) =>
        c.sales_yoy_pct != null || c.net_profit_yoy_pct != null || c.eps_yoy_pct != null
      ).length;
      // Parse the X/Y updated message
      const refreshMsg: string = payload?._refresh || '';
      const m = refreshMsg.match(/^(\d+)\/(\d+)\s+updated/);
      const enrichedNow = m ? parseInt(m[1], 10) : 0;
      if (total === 0) {
        results.push({ date, status: 'no-cache', total: 0 });
      } else if (populated === 0) {
        results.push({ date, status: 'preview-only', total, populated, enriched: enrichedNow,
          message: 'Screener has no Q-data for this filing date — likely a holiday or empty filing day.' });
      } else {
        results.push({ date, status: 'enriched', total, populated, enriched: enrichedNow });
      }
    } catch (e: any) {
      results.push({ date, status: 'error', message: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    from: fromParam,
    to: toParam,
    todayIso,
    processed: batch.length,
    remaining_dates: remaining.length,
    cursor_next: remaining.length > 0 ? remaining[0] : null,
    done: remaining.length === 0,
    results,
  });
}
