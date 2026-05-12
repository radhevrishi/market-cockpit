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

// PATCH 0206 — Tier 1 source flag enum.
// Hierarchy by confidence (highest first):
//   'kv-calendar' — authoritative; pulled from existing graded:v8:<date> KV
//                   which was built from NSE+BSE corp filings.
//   'detected'    — inferred from Yahoo daily chart's overnight-gap signature.
//                   Used only when Tier 1 (and future Tier 2 NSE API) miss.
//   'explicit'    — passed directly by the caller; legacy path.
type FilingDateSource = 'explicit' | 'kv-calendar' | 'detected';

interface GapResult {
  ticker: string;
  filing_date: string;
  filing_date_source?: FilingDateSource; // PATCH 0205/0206 — provenance flag
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

// ─── PATCH 0205 ────────────────────────────────────────────────────────────
// Filing-date detection from Yahoo daily chart "footprint".
// When the client provides a `period` (e.g. "Mar 2026") instead of a known
// filing_date, we look at the actual price action to find when results were
// filed. Filings produce a characteristic signature: a significant overnight
// gap at market open (typically Mon/Tue if weekend-filed). We score each
// candidate day in the reporting window and pick the strongest signal.
// ───────────────────────────────────────────────────────────────────────────
function parsePeriodToQuarterEnd(period: string): Date | null {
  if (!period) return null;
  const parts = period.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const year = parseInt(parts[parts.length - 1]);
  if (isNaN(year)) return null;
  const months: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11,
    'January': 0, 'February': 1, 'March': 2, 'April': 3, 'June': 5,
    'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11,
  };
  const monthKey = parts[0].slice(0, 3);
  const m = months[monthKey] ?? months[parts[0]];
  if (m === undefined) return null;
  // End-of-quarter-month = last day of that month (Mar → Mar 31, Sep → Sep 30)
  return new Date(Date.UTC(year, m + 1, 0));  // day 0 of next month = last day of this month
}

function detectFilingDateFromYahoo(
  timestamps: number[],
  opens: number[],
  closes: number[],
  period: string,
): { isoDate: string; gap_pct: number; reason: string } | null {
  const quarterEnd = parsePeriodToQuarterEnd(period);
  if (!quarterEnd) return null;
  const windowStartMs = quarterEnd.getTime();                       // quarter-end (Mar 31 etc.)
  const windowEndMs = Math.min(Date.now(), windowStartMs + 90 * 86400_000);

  const candidates: { idx: number; gap: number; score: number; reason: string }[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const tMs = timestamps[i] * 1000;
    if (tMs < windowStartMs || tMs > windowEndMs) continue;
    const prevClose = closes[i - 1];
    const open = opens[i];
    if (prevClose == null || open == null || prevClose === 0) continue;
    const gap = ((open - prevClose) / prevClose) * 100;
    if (Math.abs(gap) < 3) continue;                                // significance threshold

    const dow = new Date(tMs).getUTCDay();                           // 0=Sun, 1=Mon, 2=Tue
    let dowBonus = 0;
    if (dow === 1) dowBonus = 5;       // Monday after weekend filing
    else if (dow === 2) dowBonus = 3;  // Tuesday (Monday holiday case)
    const recency = ((tMs - windowStartMs) / (windowEndMs - windowStartMs)) * 10;
    const gapMag = Math.abs(gap) * 0.3;
    const score = dowBonus + recency + gapMag;
    candidates.push({ idx: i, gap, score, reason: `gap${gap > 0 ? '+' : ''}${gap.toFixed(1)}% ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}` });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const priorIdx = winner.idx - 1;
  if (priorIdx < 0) return null;
  const priorTs = timestamps[priorIdx];
  const isoDate = new Date(priorTs * 1000).toISOString().slice(0, 10);
  return { isoDate, gap_pct: winner.gap, reason: winner.reason };
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

// ─── PATCH 0206 ────────────────────────────────────────────────────────────
// Tier 1 filing-date source: the existing graded:v8:<date> KV calendar.
// Each graded payload contains by_tier.{BLOCKBUSTER,STRONG,MIXED,AVOID}[] of
// ParsedEarning rows with authoritative `ticker` + `filing_date` fields,
// originally derived from NSE + BSE corporate filings.
//
// Strategy: scan the reporting window (quarter-end → today, capped at +90d),
// parallel-fetch each graded:v8:<date> payload, flatten all tickers across
// all tiers into a single {ticker → filing_date} map, and cache it in KV for
// 6h under filing-index:v1:<period>. Subsequent calls skip the scan.
// ───────────────────────────────────────────────────────────────────────────
async function buildOrFetchFilingIndex(period: string): Promise<Record<string, string>> {
  const indexKey = `filing-index:v1:${period}`;
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<Record<string, string>>(indexKey);
      if (cached && typeof cached === 'object') return cached;
    } catch {}
  }
  const quarterEnd = parsePeriodToQuarterEnd(period);
  if (!quarterEnd) return {};
  const startMs = quarterEnd.getTime() + 86400_000;  // day after quarter-end
  const endMs = Math.min(Date.now(), startMs + 90 * 86400_000);
  const dates: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86400_000) {
    dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  // Parallel-fetch all graded payloads. Missing dates return null and are skipped.
  const payloads = await Promise.all(
    dates.map(d => kvGet<any>(`graded:v8:${d}`).catch(() => null))
  );
  const index: Record<string, string> = {};
  for (const p of payloads) {
    if (!p?.by_tier) continue;
    for (const tier of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
      const rows = (p.by_tier as any)[tier] || [];
      for (const row of rows) {
        const t = row?.ticker;
        const fd = row?.filing_date;
        if (t && typeof fd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fd)) {
          // Keep the EARLIEST filing date seen for a ticker — protects against
          // duplicates where the same ticker shows up across multiple date keys.
          if (!index[t] || fd < index[t]) index[t] = fd;
        }
      }
    }
  }
  if (isRedisAvailable()) {
    try { await kvSet(indexKey, index, 6 * 3600); } catch {}
  }
  return index;
}

async function computeGap(
  ticker: string,
  filing_date: string,
  timing?: string,
  period?: string,
  knownFromCalendar?: boolean,
): Promise<GapResult> {
  // PATCH 0206 — cache key bumped to v3, includes calendar provenance so a
  // calendar-resolved date doesn't share a slot with a detector-resolved one.
  const initialSource: FilingDateSource = knownFromCalendar ? 'kv-calendar' : 'explicit';
  const cacheKey = `post-gap:v3:${ticker}:${filing_date}:${timing || 'pre'}:${period || ''}:${initialSource}`;
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<GapResult>(cacheKey);
      if (cached) return cached;
    } catch {}
  }

  const result: GapResult = {
    ticker, filing_date,
    filing_date_source: initialSource,
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

  // PATCH 0205/0206 — Tier 3 fallback only.
  // If Tier 1 (kv-calendar) already gave us an authoritative filing_date,
  // skip the price-action detector — calendar wins. Otherwise, if period is
  // provided and we have no exact date, scan the chart for the overnight-gap
  // signature characteristic of a real filing event.
  if (period && !knownFromCalendar) {
    const detected = detectFilingDateFromYahoo(yahoo.timestamps, yahoo.opens, yahoo.closes, period);
    if (detected) {
      filing_date = detected.isoDate;
      result.filing_date = detected.isoDate;
      result.filing_date_source = 'detected';
    }
  }

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
  // PATCH 0205 — accept optional `period` so the server can detect the real
  // filing date from Yahoo price action when the client only has an estimate.
  const items: Array<{ ticker: string; filing_date: string; timing?: string; period?: string }> =
    Array.isArray(body?.items) ? body.items.slice(0, 200) : [];
  if (items.length === 0) return NextResponse.json({ data: {}, count: 0 });

  // PATCH 0206 — Tier 1 resolution.
  // Build one filing-date index per unique period upfront (parallel). This
  // amortizes the KV calendar scan across all tickers sharing a period
  // (typically all tickers in a quarter scan use the same period like
  // "Mar 2026"). Each index is a {ticker → filing_date} map sourced from
  // graded:v8:<date> KV entries — i.e., the authoritative NSE+BSE-derived
  // filings already in your earnings-opportunities pipeline.
  const uniquePeriods = Array.from(new Set(items.map(i => (i.period || '').trim()).filter(Boolean)));
  const periodIndexEntries = await Promise.all(
    uniquePeriods.map(async p => [p, await buildOrFetchFilingIndex(p).catch(() => ({}))] as const)
  );
  const indexByPeriod: Record<string, Record<string, string>> = {};
  for (const [p, idx] of periodIndexEntries) indexByPeriod[p] = idx;

  const results = await Promise.all(items.map(async (it) => {
    try {
      // Tier 1: authoritative calendar lookup
      const calendarDate = it.period ? indexByPeriod[it.period]?.[it.ticker] : undefined;
      const filingDate = calendarDate || it.filing_date;
      const r = await computeGap(it.ticker, filingDate, it.timing, it.period, !!calendarDate);
      return [it.ticker, r] as const;
    } catch (e: any) {
      return [it.ticker, { ticker: it.ticker, filing_date: it.filing_date, error: e?.message || 'compute failed' } as any] as const;
    }
  }));
  const data: Record<string, GapResult> = {};
  for (const [t, r] of results) data[t] = r as GapResult;
  // Telemetry: how many tickers were resolved by each tier?
  const sourceCounts = { 'kv-calendar': 0, 'detected': 0, 'explicit': 0 } as Record<FilingDateSource, number>;
  for (const r of Object.values(data)) {
    const s = (r as any).filing_date_source as FilingDateSource | undefined;
    if (s) sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  }
  return NextResponse.json({
    data,
    count: results.length,
    source_counts: sourceCounts,
    generated_at: new Date().toISOString(),
  });
}
