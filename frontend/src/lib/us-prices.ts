// ═══════════════════════════════════════════════════════════════════════════
// US PRICE + TECHNICALS (server-only).
//
// Source: Yahoo Finance chart v8 — free, keyless, unmetered.
//
// THE ONE THING THAT WILL BREAK THIS IN PRODUCTION
// ─────────────────────────────────────────────────
// Yahoo returns HTTP 429 for a non-browser User-Agent. It is NOT a rate limit —
// it is a UA filter, and it fires on the very first request. Verified:
//   no UA / curl default / "python-requests/2.31.0"  → 429, 429, 429
//   a real Chrome UA                                 → 200, 200, 200 (60 in a row)
// Node's `fetch` sends its own UA by default, so every call here MUST set one
// explicitly or the US engine silently returns zero prices on Railway while
// working perfectly in a browser tab.
//
// WHAT WE DELIBERATELY DO NOT USE
// ────────────────────────────────
// • Yahoo's v7/quote and v10/quoteSummary — 401 without a cookie+crumb dance,
//   and their `marketCap` is not trustworthy (ONTO: 61.1m shares reported vs
//   49.1m on the SEC cover page, a 25% overstatement). Market cap here is
//   EDGAR shares × this price. See `sharesOutstandingFromFacts`.
// • Stooq — it now serves a JavaScript proof-of-work wall instead of CSV, and
//   the challenge cannot be completed from a rotating-egress host ("challenge
//   invalid: ip mismatch"). It is not a fallback; it is dead for this use.
// ═══════════════════════════════════════════════════════════════════════════

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface Bars {
  symbol: string;
  price: number | null;
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

const _bars = new Map<string, { at: number; data: Bars | null }>();
const BARS_TTL_MS = 15 * 60_000;

async function yahooChart(symbol: string, range = '1y'): Promise<Bars | null> {
  const key = `${symbol}|${range}`;
  const hit = _bars.get(key);
  if (hit && Date.now() - hit.at < BARS_TTL_MS) return hit.data;

  const hosts = ['query1', 'query2'];
  for (const host of hosts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },   // mandatory — see header note
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const j: any = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r) continue;
      const ts: number[] = r.timestamp || [];
      const q = r.indicators?.quote?.[0] || {};
      const off: number = r.meta?.gmtoffset || 0;
      const dates: string[] = [];
      const open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = [], volume: number[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i];
        if (c == null || !Number.isFinite(c)) continue;      // halted sessions come back null
        dates.push(new Date((ts[i] + off) * 1000).toISOString().slice(0, 10));
        open.push(Number.isFinite(q.open?.[i]) ? q.open[i] : c);
        high.push(Number.isFinite(q.high?.[i]) ? q.high[i] : c);
        low.push(Number.isFinite(q.low?.[i]) ? q.low[i] : c);
        close.push(c);
        volume.push(Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0);
      }
      if (!close.length) continue;
      const data: Bars = {
        symbol: r.meta?.symbol || symbol,
        price: Number.isFinite(r.meta?.regularMarketPrice) ? r.meta.regularMarketPrice : close[close.length - 1],
        dates, open, high, low, close, volume,
      };
      _bars.set(key, { at: Date.now(), data });
      return data;
    } catch { /* try the next host */ }
  }
  _bars.set(key, { at: Date.now(), data: null });
  return null;
}

export interface UsTechnicals {
  price: number | null;
  d1_pct: number | null;
  gap_pct: number | null;
  move_pct: number | null;
  pct_from_52w_high: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  addv_musd: number | null;
  vol_ratio_20d: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret12m: number | null;
  rs_rating: number | null;     // filled later by assignRsRatings (cohort pass)
  reaction_date: string | null;
  close_30d: number[] | null;
}

const median = (xs: number[]): number | null => {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const sma = (xs: number[], n: number): number | null => {
  if (xs.length < n) return null;
  let s = 0;
  for (let i = xs.length - n; i < xs.length; i++) s += xs[i];
  return s / n;
};
const smaAt = (xs: number[], n: number, endIdx: number): number | null => {
  if (endIdx + 1 < n) return null;
  let s = 0;
  for (let i = endIdx + 1 - n; i <= endIdx; i++) s += xs[i];
  return s / n;
};

/**
 * Which session priced the print.
 *
 * EDGAR's search index gives us the filing DATE but not the time, and US
 * earnings split roughly evenly between after-close (reaction = next session)
 * and before-open (reaction = the filing day itself). Default to the
 * after-close convention, then override to the filing day when that day
 * carried the clearly larger move (≥2× and ≥3% absolute) — which is what a
 * before-open release looks like in the tape. Returns the index into `dates`.
 */
function reactionIndex(b: Bars, filingDate: string): { pre: number; post: number } | null {
  let pre = -1;
  for (let i = 0; i < b.dates.length; i++) {
    if (b.dates[i] < filingDate) pre = i; else break;
  }
  if (pre < 0) return null;
  const isTradingDay = b.dates.includes(filingDate);
  let post = isTradingDay ? pre + 2 : pre + 1;
  if (post >= b.close.length) {
    // The next session hasn't happened yet (grading the same evening). Fall
    // back to the filing day itself when it exists, else there is no reaction.
    post = isTradingDay ? pre + 1 : -1;
    if (post < 0 || post >= b.close.length) return null;
    return { pre, post };
  }
  if (isTradingDay) {
    const dayIdx = pre + 1;
    const mDay = (b.close[dayIdx] / b.close[pre] - 1) * 100;
    const mNext = (b.close[post] / b.close[dayIdx] - 1) * 100;
    if (Math.abs(mDay) >= 3 && Math.abs(mDay) >= 2 * Math.abs(mNext)) {
      return { pre, post: dayIdx };              // looks like a before-open release
    }
  }
  return { pre, post };
}

/** Full technical read for one ticker around one filing date. */
export async function usTechnicals(ticker: string, filingDate: string): Promise<UsTechnicals | null> {
  const b = await yahooChart(ticker, '1y');
  if (!b || b.close.length < 30) return null;
  const c = b.close, v = b.volume, n = c.length;

  const hi52 = Math.max(...c);
  const last = c[n - 1];
  const pct_from_52w_high = hi52 > 0 ? ((last - hi52) / hi52) * 100 : null;

  const ma50 = sma(c, 50);
  const ma200 = sma(c, 200);
  const ma200Prev = n >= 221 ? smaAt(c, 200, n - 22) : null;
  const slope200 = (ma200 != null && ma200Prev != null) ? ma200 - ma200Prev : null;

  // Weinstein stage — the same four-stage read the India engine consumes.
  let stage: 1 | 2 | 3 | 4 | null = null;
  if (ma50 != null && ma200 != null) {
    const above200 = last > ma200;
    const rising = slope200 == null ? (ma50 > ma200) : slope200 > 0;
    if (above200 && ma50 > ma200 && rising) stage = 2;
    else if (!above200 && ma50 < ma200 && !rising) stage = 4;
    else if (above200) stage = 3;
    else stage = 1;
  }

  const rx = reactionIndex(b, filingDate);
  let d1_pct: number | null = null, gap_pct: number | null = null, move_pct: number | null = null;
  let vol_ratio_20d: number | null = null, reaction_date: string | null = null;
  if (rx) {
    const { pre, post } = rx;
    d1_pct = (c[post] / c[pre] - 1) * 100;
    const prevClose = c[post - 1] ?? c[pre];
    if (b.open[post] != null && prevClose) gap_pct = (b.open[post] / prevClose - 1) * 100;
    move_pct = (last / c[post] - 1) * 100;
    reaction_date = b.dates[post];
    const win = v.slice(Math.max(0, post - 20), post);
    const medVol = median(win);
    if (medVol && medVol > 0 && v[post] != null) vol_ratio_20d = v[post] / medVol;
  }

  // 20-day median dollar volume — the US thin-float gate ($2M/day).
  const dv: number[] = [];
  for (let i = Math.max(0, n - 20); i < n; i++) dv.push(c[i] * v[i]);
  const medDv = median(dv);
  const addv_musd = medDv != null ? medDv / 1e6 : null;

  const retFrom = (bars: number) => (n > bars && c[n - 1 - bars] > 0) ? (c[n - 1] / c[n - 1 - bars] - 1) * 100 : null;

  return {
    price: b.price ?? last,
    d1_pct: d1_pct != null ? Math.round(d1_pct * 100) / 100 : null,
    gap_pct: gap_pct != null ? Math.round(gap_pct * 100) / 100 : null,
    move_pct: move_pct != null ? Math.round(move_pct * 100) / 100 : null,
    pct_from_52w_high: pct_from_52w_high != null ? Math.round(pct_from_52w_high * 100) / 100 : null,
    stage,
    addv_musd: addv_musd != null ? Math.round(addv_musd * 100) / 100 : null,
    vol_ratio_20d: vol_ratio_20d != null ? Math.round(vol_ratio_20d * 100) / 100 : null,
    ret1m: retFrom(21), ret3m: retFrom(63), ret6m: retFrom(126), ret12m: retFrom(251),
    rs_rating: null,
    reaction_date,
    close_30d: c.slice(-30),
  };
}

/** SPY's 12-month return — the absolute leg of the RS blend. Cached 1h. */
let _spy: { at: number; ret: number | null } | null = null;
export async function spyReturn12m(): Promise<number | null> {
  if (_spy && Date.now() - _spy.at < 3600_000) return _spy.ret;
  const b = await yahooChart('SPY', '1y');
  let ret: number | null = null;
  if (b && b.close.length > 251) {
    const c = b.close;
    ret = (c[c.length - 1] / c[c.length - 1 - 251] - 1) * 100;
  }
  _spy = { at: Date.now(), ret };
  return ret;
}

/** Small concurrency-limited map — keeps us polite to both Yahoo and SEC. */
export async function pooled<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch { out[i] = undefined as any; }
    }
  });
  await Promise.all(workers);
  return out;
}
