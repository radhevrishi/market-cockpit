// ═══════════════════════════════════════════════════════════════════════════
// POST-EARNINGS PRICE GAP (PATCH 0201)
//
// POST /api/v1/earnings/post-gap
//   body: { items: Array<{ ticker: string; filing_date: string; timing?: 'pre' | 'post' }> }
//
// For each ticker, fetches Yahoo Finance daily candles and computes:
//   - gap_pct: open of "target day" vs close of filing day (the overnight gap)
//   - close_move_pct: close of target day vs close of filing day (full-day move)
//   - live_move_pct: current/last price vs close of filing day (intraday if today)
//   - target_date: which date the price action is measured on
//   - is_live: true if target day's session is still open (latest bar = today)
//
// Logic:
//   - timing='post' (after-market filing): target day = NEXT trading day
//   - timing='pre' or unknown: target day = SAME day as filing
//
// Cached in KV per (ticker, filing_date) for 30 minutes — past dates can be
// cached longer since they're immutable.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface GapResult {
  ticker: string;
  filing_date: string;
  target_date: string | null;
  filing_close: number | null;
  target_open: number | null;
  target_close: number | null;
  live_price: number | null;
  gap_pct: number | null;          // open vs prior close (overnight)
  close_move_pct: number | null;   // close vs prior close (full day)
  live_move_pct: number | null;    // current vs prior close (intraday or final)
  is_live: boolean;                // true = target day still trading; close_move null
  source: 'yahoo' | null;
  error?: string;
}

function pct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

async function fetchYahooDaily(symbol: string): Promise<{ timestamps: number[]; closes: number[]; opens: number[]; lastPrice: number | null } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=3mo&interval=1d`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const ts: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const closes: number[] = quote.close || [];
    const opens: number[] = quote.open || [];
    return {
      timestamps: ts,
      closes,
      opens,
      lastPrice: meta.regularMarketPrice ?? closes[closes.length - 1] ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Find the index of the bar matching this calendar date (YYYY-MM-DD).
 *  If exact match not found (weekend / holiday), return the closest prior bar. */
function findBarIndex(timestamps: number[], targetIso: string, mode: 'on-or-before' | 'on-or-after'): number {
  const targetMs = new Date(targetIso + 'T12:00:00Z').getTime();  // mid-day to avoid TZ edge
  let best = -1;
  for (let i = 0; i < timestamps.length; i++) {
    const tMs = timestamps[i] * 1000;
    if (mode === 'on-or-before') {
      if (tMs <= targetMs) best = i;
      else break;
    } else {
      if (tMs >= targetMs) { best = i; break; }
    }
  }
  return best;
}

function nextTradingDayIso(timestamps: number[], filingIso: string): string | null {
  const filingMs = new Date(filingIso + 'T12:00:00Z').getTime();
  for (const t of timestamps) {
    const tMs = t * 1000;
    if (tMs > filingMs) {
      return new Date(tMs).toISOString().slice(0, 10);
    }
  }
  return null;
}

async function computeGap(ticker: string, filing_date: string, timing?: string): Promise<GapResult> {
  const cacheKey = `post-gap:v1:${ticker}:${filing_date}:${timing || 'pre'}`;
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<GapResult>(cacheKey);
      if (cached) return cached;
    } catch {}
  }

  const result: GapResult = {
    ticker, filing_date,
    target_date: null,
    filing_close: null, target_open: null, target_close: null, live_price: null,
    gap_pct: null, close_move_pct: null, live_move_pct: null,
    is_live: false, source: null,
  };

  const yahoo = await fetchYahooDaily(ticker);
  if (!yahoo || yahoo.timestamps.length === 0) {
    result.error = 'yahoo fetch failed or empty';
    return result;
  }
  result.source = 'yahoo';
  result.live_price = yahoo.lastPrice;

  // Resolve filing day bar (closest on-or-before the filing_date)
  const filingIdx = findBarIndex(yahoo.timestamps, filing_date, 'on-or-before');
  if (filingIdx < 0) {
    result.error = 'no bar at/before filing date';
    return result;
  }
  const filingClose = yahoo.closes[filingIdx];
  if (filingClose == null) {
    result.error = 'no close on filing day';
    return result;
  }
  result.filing_close = filingClose;

  // Determine target day based on timing
  // - 'post' (after-market): next trading day
  // - 'pre' or unknown: same day as filing (filingIdx itself)
  let targetIdx: number;
  if ((timing || '').toLowerCase() === 'post') {
    targetIdx = filingIdx + 1;
    if (targetIdx >= yahoo.timestamps.length) {
      result.target_date = nextTradingDayIso(yahoo.timestamps, filing_date);
      // No bar yet (after-market filing today; markets reopen tomorrow)
      result.error = 'target day has no data yet';
      return result;
    }
  } else {
    targetIdx = filingIdx;
  }

  const targetTs = yahoo.timestamps[targetIdx];
  result.target_date = new Date(targetTs * 1000).toISOString().slice(0, 10);
  result.target_open = yahoo.opens[targetIdx] ?? null;
  result.target_close = yahoo.closes[targetIdx] ?? null;

  // is_live: latest bar's date == target date (today's session)
  const todayIso = new Date().toISOString().slice(0, 10);
  result.is_live = result.target_date === todayIso;

  result.gap_pct = pct(result.target_open, filingClose);
  result.close_move_pct = pct(result.target_close, filingClose);
  result.live_move_pct = pct(result.live_price, filingClose);

  // Cache: past dates 7d, today 5min
  const filingMs = new Date(filing_date + 'T12:00:00Z').getTime();
  const isPast = filingMs < Date.now() - 24 * 3600_000;
  const ttl = isPast ? 7 * 24 * 3600 : 5 * 60;
  if (isRedisAvailable()) {
    try { await kvSet(cacheKey, result, ttl); } catch {}
  }
  return result;
}

export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const items: Array<{ ticker: string; filing_date: string; timing?: string }> =
    Array.isArray(body?.items) ? body.items.slice(0, 200) : [];
  if (items.length === 0) return NextResponse.json({ data: {}, count: 0 });

  const results = await Promise.all(items.map(async (it) => {
    try {
      const r = await computeGap(it.ticker, it.filing_date, it.timing);
      return [it.ticker, r] as const;
    } catch (e: any) {
      return [it.ticker, { ticker: it.ticker, filing_date: it.filing_date, error: e?.message || 'compute failed' } as any] as const;
    }
  }));
  const data: Record<string, GapResult> = {};
  for (const [t, r] of results) data[t] = r as GapResult;
  return NextResponse.json({ data, count: results.length, generated_at: new Date().toISOString() });
}
