// ─── Yahoo Finance price enricher ──────────────────────────────────────────
// For each canonical event, fetches 1y daily OHLC from Yahoo Finance v8 API
// (free, no auth) and computes the price-derived fields EarningsPulse shows:
//   current_price, prev_close, gap_pct, d1_pct, move_pct
//   high_52w, low_52w, pct_from_52w_high
//   ma_50, ma_150, ma_200, ma_200_slope
//   rs_rating (1-99 vs Nifty 50 — percentile rank within enriched batch)
//   stage (Weinstein 1-4)
//   trend_template_passes (Minervini's 8 criteria)
//
// Endpoint: https://query1.finance.yahoo.com/v8/finance/chart/SYMBOL.NS?range=1y&interval=1d
//
// PATCH 0148.

import { CanonicalEvent } from '../types.js';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 6000;
const REQUEST_DELAY_MS = 80;
const NIFTY_SYMBOL = '^NSEI';

interface YahooDaily {
  timestamps: number[];     // unix seconds
  closes: (number | null)[];
  opens: (number | null)[];
  highs: (number | null)[];
  lows: (number | null)[];
  meta: any;
}

async function fetchYahoo(symbol: string): Promise<YahooDaily | null> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=1y&interval=1d&events=history`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts = r.timestamp || [];
    const q = r.indicators?.quote?.[0] || {};
    return {
      timestamps: ts,
      closes: q.close || [],
      opens: q.open || [],
      highs: q.high || [],
      lows: q.low || [],
      meta: r.meta || {},
    };
  } catch { return null; }
  finally { clearTimeout(t); }
}

// ─── Math helpers ──────────────────────────────────────────────────────────
function sma(arr: (number | null)[], window: number, atIdx: number): number | null {
  if (atIdx < window - 1) return null;
  let sum = 0;
  let n = 0;
  for (let i = atIdx - window + 1; i <= atIdx; i++) {
    const v = arr[i];
    if (v == null || !Number.isFinite(v)) return null;
    sum += v;
    n++;
  }
  return n > 0 ? sum / n : null;
}

function lastNonNull(arr: (number | null)[]): { idx: number; value: number } | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return { idx: i, value: v };
  }
  return null;
}

function returnBetween(arr: (number | null)[], fromIdx: number, toIdx: number): number | null {
  const from = arr[fromIdx];
  const to = arr[toIdx];
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

// ─── Stage detection (Weinstein) ───────────────────────────────────────────
function detectStage(close: number, ma50: number | null, ma150: number | null, ma200: number | null, ma200Slope: number | null): 1 | 2 | 3 | 4 | null {
  if (ma200 == null) return null;
  const above200 = close > ma200;
  const stacked = ma50 != null && ma150 != null && ma50 > ma150 && ma150 > ma200;
  const slopeUp = ma200Slope != null && ma200Slope > 0;
  if (above200 && stacked && slopeUp) return 2;
  if (!above200 && !slopeUp) return 4;
  if (above200 && !slopeUp) return 3;
  return 1;
}

// ─── Per-symbol enrichment ─────────────────────────────────────────────────
export interface PriceEnrichment {
  current_price: number | null;
  prev_close: number | null;
  open_price: number | null;
  high_today: number | null;
  low_today: number | null;
  gap_pct: number | null;
  d1_pct: number | null;
  move_pct: number | null;       // earnings-day-close to latest-close
  high_52w: number | null;
  low_52w: number | null;
  pct_from_52w_high: number | null;
  ma_50: number | null;
  ma_150: number | null;
  ma_200: number | null;
  ma_200_slope_30d: number | null;
  return_1y_pct: number | null;
  return_12w_pct: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  trend_template_passes: boolean;
  rs_rating: number | null;  // filled after batch ranking
}

function computeEnrichment(daily: YahooDaily, filingDateIso: string | null): PriceEnrichment {
  const closes = daily.closes;
  const opens = daily.opens;
  const ts = daily.timestamps;
  const N = closes.length;
  const last = lastNonNull(closes);
  const currentPrice = last?.value ?? null;
  const idx = last?.idx ?? N - 1;

  const prevClose = idx >= 1 ? closes[idx - 1] : null;
  const openToday = opens[idx] ?? null;
  const highToday = daily.highs[idx] ?? null;
  const lowToday = daily.lows[idx] ?? null;

  const gap = (openToday != null && prevClose != null && prevClose > 0)
    ? ((openToday - prevClose) / prevClose) * 100
    : null;
  const d1 = (currentPrice != null && prevClose != null && prevClose > 0)
    ? ((currentPrice - prevClose) / prevClose) * 100
    : null;

  // move_pct = return since filing-day close
  let movePct: number | null = null;
  if (filingDateIso && currentPrice != null) {
    const filingTs = Date.parse(filingDateIso) / 1000;
    if (Number.isFinite(filingTs)) {
      // Find first bar at or after filing date
      let filingIdx = -1;
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] >= filingTs - 86400) { filingIdx = i; break; }
      }
      if (filingIdx >= 0 && closes[filingIdx] != null && closes[filingIdx]! > 0) {
        movePct = ((currentPrice - closes[filingIdx]!) / closes[filingIdx]!) * 100;
      }
    }
  }

  const hi52 = daily.meta?.fiftyTwoWeekHigh ?? null;
  const lo52 = daily.meta?.fiftyTwoWeekLow ?? null;
  const pctFromHigh = (currentPrice != null && hi52 != null && hi52 > 0)
    ? ((currentPrice - hi52) / hi52) * 100
    : null;

  const ma50 = sma(closes, 50, idx);
  const ma150 = sma(closes, 150, idx);
  const ma200 = sma(closes, 200, idx);
  const ma200_30dAgo = idx - 30 >= 199 ? sma(closes, 200, idx - 30) : null;
  const ma200Slope30d = (ma200 != null && ma200_30dAgo != null && ma200_30dAgo > 0)
    ? ((ma200 - ma200_30dAgo) / ma200_30dAgo) * 100
    : null;

  const return1y = currentPrice != null && closes[0] != null && closes[0]! > 0
    ? ((currentPrice - closes[0]!) / closes[0]!) * 100
    : null;
  const idx12w = Math.max(0, idx - 60);
  const return12w = returnBetween(closes, idx12w, idx);

  const stage = currentPrice != null
    ? detectStage(currentPrice, ma50, ma150, ma200, ma200Slope30d)
    : null;

  // Minervini trend template (8 criteria, with RS as the 9th we'll fill in batch step)
  let trendTemplate = false;
  if (currentPrice != null && ma50 != null && ma150 != null && ma200 != null) {
    trendTemplate = (
      currentPrice > ma50 &&
      currentPrice > ma150 &&
      currentPrice > ma200 &&
      ma150 > ma200 &&
      (ma200Slope30d != null && ma200Slope30d > 0) &&
      ma50 > ma150 && ma150 > ma200 &&
      (lo52 != null && currentPrice > lo52 * 1.25) &&
      (hi52 != null && currentPrice >= hi52 * 0.75)
    );
  }

  return {
    current_price: currentPrice,
    prev_close: prevClose,
    open_price: openToday,
    high_today: highToday,
    low_today: lowToday,
    gap_pct: gap,
    d1_pct: d1,
    move_pct: movePct,
    high_52w: hi52,
    low_52w: lo52,
    pct_from_52w_high: pctFromHigh,
    ma_50: ma50,
    ma_150: ma150,
    ma_200: ma200,
    ma_200_slope_30d: ma200Slope30d,
    return_1y_pct: return1y,
    return_12w_pct: return12w,
    stage,
    trend_template_passes: trendTemplate,
    rs_rating: null,   // filled by batch ranker
  };
}

// ─── Public: batch enrich events ───────────────────────────────────────────
export async function enrichWithPrices(
  events: CanonicalEvent[],
  opts?: { budgetMs?: number },
): Promise<CanonicalEvent[]> {
  const budgetMs = opts?.budgetMs ?? 4 * 60_000;
  const startedAt = Date.now();
  const isValidSymbol = (s: string) => /^[A-Z][A-Z0-9&\-]{1,15}$/.test(s);

  // Fetch Nifty once for relative-strength baseline
  const nifty = await fetchYahoo(NIFTY_SYMBOL);
  let niftyReturn12w: number | null = null;
  if (nifty) {
    const n = nifty.closes.length;
    const lastN = lastNonNull(nifty.closes);
    if (lastN) {
      const idx12 = Math.max(0, lastN.idx - 60);
      niftyReturn12w = returnBetween(nifty.closes, idx12, lastN.idx);
    }
  }

  type Pair = { ev: CanonicalEvent; enrich: PriceEnrichment | null };
  const enriched: Pair[] = [];
  let ok = 0, fail = 0, skipped = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!isValidSymbol(ev.symbol)) {
      enriched.push({ ev, enrich: null });
      skipped++;
      continue;
    }
    if (Date.now() - startedAt > budgetMs) {
      for (let j = i; j < events.length; j++) enriched.push({ ev: events[j], enrich: null });
      console.log(`[yahoo] budget exhausted at ${i}/${events.length}`);
      break;
    }
    const daily = await fetchYahoo(`${ev.symbol}.NS`);
    if (daily) {
      const e = computeEnrichment(daily, ev.filing_dt_iso || null);
      enriched.push({ ev, enrich: e });
      ok++;
    } else {
      enriched.push({ ev, enrich: null });
      fail++;
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    if ((ok + fail) % 25 === 0) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[yahoo] ${ok + fail}/${events.length} (ok=${ok}, fail=${fail}, ${elapsed}s)`);
    }
  }

  // ── RS rating: rank 12-week returns within the batch, scale to 1-99
  const returns: number[] = enriched
    .map((p) => p.enrich?.return_12w_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const sorted = [...returns].sort((a, b) => a - b);
  for (const p of enriched) {
    if (!p.enrich) continue;
    const r12 = p.enrich.return_12w_pct;
    if (r12 == null) { p.enrich.rs_rating = null; continue; }
    // Percentile rank
    let below = 0;
    for (const v of sorted) {
      if (v < r12) below++;
      else break;
    }
    const pct = sorted.length > 0 ? (below / sorted.length) * 100 : 50;
    p.enrich.rs_rating = Math.max(1, Math.min(99, Math.round(pct)));
  }

  // ── Stitch enrichment onto events
  const out: CanonicalEvent[] = enriched.map(({ ev, enrich }) => {
    if (!enrich) return ev;
    return {
      ...ev,
      current_price: enrich.current_price ?? ev.current_price ?? null,
      gap_pct: enrich.gap_pct,
      d1_pct: enrich.d1_pct,
      move_pct: enrich.move_pct,
      high_52w: enrich.high_52w ?? ev.high_52w ?? null,
      low_52w: enrich.low_52w ?? ev.low_52w ?? null,
      pct_from_52w_high: enrich.pct_from_52w_high ?? ev.pct_from_52w_high ?? null,
      ma_50: enrich.ma_50,
      ma_150: enrich.ma_150,
      ma_200: enrich.ma_200,
      ma_200_slope_30d: enrich.ma_200_slope_30d,
      return_1y_pct: enrich.return_1y_pct,
      return_12w_pct: enrich.return_12w_pct,
      stage: enrich.stage ?? null,
      trend_template_passes: enrich.trend_template_passes,
      rs_rating: enrich.rs_rating,
      price_scraped_at: new Date().toISOString(),
    };
  });

  console.log(`[yahoo] DONE — ok=${ok}, fail=${fail}, skipped=${skipped}, niftyR12w=${niftyReturn12w?.toFixed(1)}%`);
  return out;
}
