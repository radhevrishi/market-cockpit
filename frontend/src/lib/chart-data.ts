// zzz937 — server-only: daily OHLCV for the /charts page from Yahoo's chart API, India via .NS (falling back to .BO).
import { yahooCandidates } from './yahoo-symbol';
// Kept in memory only (a few minutes) — chart series are large and must not go to Redis.
import type { Bar, Market } from './chart-math';
import { isIndianMarketOpen, isUSMarketOpen } from './market-hours';

// The same User-Agent (and no other header) as lib/us-prices.ts — Yahoo refuses other agents from the deploy host.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type DataRange = '2y' | '5y' | '10y' | 'max';
export const DATA_RANGES: DataRange[] = ['2y', '5y', '10y', 'max'];

export interface DailySeries {
  symbol: string; name: string | null; currency: string | null; exchange: string | null; bars: Bar[];
  /** zzz967 (DT-01) — provenance: Yahoo's own granularity, the quote time, and whether the newest bar was built from the quote */
  granularity?: string | null;
  quoteAt?: string | null;
  lastBarSynthetic?: boolean;
  lastBarOpenInferred?: boolean;
  /** zzz969 — cash dividends (ex-day at UTC midnight of the exchange's local date) */
  divs?: Array<{ t: number; amount: number }>;
  /** zzz990 (CP-03) — Yahoo meta.firstTradeDate (the listing / first trade), ms; null when Yahoo does not send it */
  firstTradeT?: number | null;
}

const _cache = new Map<string, { at: number; data: DailySeries | null }>();
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 60_000;
// zzz1053: was 200 — a watchlist sweep of a few hundred symbols pushed earlier charts out and every revisit went back to Yahoo
const MAX_ENTRIES = 600;

// ── zzz1053: stale-while-revalidate + a copy that survives a restart ──────────────────────────────────────────────────────────
// A daily series older than OK_TTL_MS is still SERVED at once (and refreshed behind it, one Yahoo call per key) when it is
//   • younger than STALE_SERVE_MS (a few minutes of a live session), or
//   • the market was closed both when it was fetched and now, and it is younger than CLOSED_STALE_MS — a full session (US 6.5 h,
//     India 6.25 h) cannot have happened in between, so the bars are the same.
// The last good 2y / 5y series is also written to Postgres (sec_frame_cache, key chart-series:v1:…) at most every 5 minutes per
// key, so the first chart after a restart / deploy is read from the database (tens of ms) instead of Yahoo (1–2 s) — under the
// same staleness rule, and refreshed behind it.
export const STALE_SERVE_MS = 10 * 60_000;
export const CLOSED_STALE_MS = 6 * 3_600_000;
const PERSIST_RANGES: ReadonlySet<DataRange> = new Set<DataRange>(['2y', '5y']);
const PERSIST_EVERY_MS = 5 * 60_000;
const PERSIST_READ_WAIT_MS = 800;

/** Pure: may a series fetched at `at` be served now (while a fresh one is fetched)? */
export function seriesServableStale(at: number, now: number, marketOpen: (d: Date) => boolean): boolean {
  const age = now - at;
  if (!(age >= 0)) return false;
  if (age < STALE_SERVE_MS) return true;
  return age < CLOSED_STALE_MS && !marketOpen(new Date(at)) && !marketOpen(new Date(now));
}
let _marketOpen: (m: Market, d: Date) => boolean = (m, d) => (m === 'IN' ? isIndianMarketOpen(d) : isUSMarketOpen(d));

export interface ChartSeriesStore {
  read(key: string): Promise<{ at: number; data: DailySeries } | null>;
  write(key: string, data: DailySeries, at: number): Promise<void>;
}
const pgChartStore: ChartSeriesStore = {
  async read(key) {
    const db = await import('./db');
    if (!db.getPool()) return null;
    const { ensureSchema } = await import('./db-migrate');
    if (!(await ensureSchema())) return null;
    const r = await db.dbQuery<{ data: any; fetched_at: string | Date }>(`SELECT data, fetched_at FROM sec_frame_cache WHERE key = $1`, [`chart-series:v1:${key}`]);
    if (!r.length) return null;
    const unpacked = unpackSeries(r[0].data);
    return unpacked ? { at: new Date(r[0].fetched_at).getTime(), data: unpacked } : null;
  },
  async write(key, data, at) {
    const db = await import('./db');
    if (!db.getPool()) return;
    const { ensureSchema } = await import('./db-migrate');
    if (!(await ensureSchema())) return;
    await db.dbQuery(`INSERT INTO sec_frame_cache (key, data, fetched_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
      [`chart-series:v1:${key}`, JSON.stringify(packSeries(data)), new Date(at).toISOString()]);
  },
};
let _store: ChartSeriesStore | null = pgChartStore;
const _persistedAt = new Map<string, number>();
/** test hooks */
export function _setChartSeriesStore(s: ChartSeriesStore | null): void { _store = s; }
export function _setMarketOpenForTests(fn: ((m: Market, d: Date) => boolean) | null): void { if (fn) _marketOpen = fn; }
export function _resetChartDataForTests(): void { _cache.clear(); _inflight.clear(); _persistedAt.clear(); }

/** Compact column form for the database copy. */
export function packSeries(s: DailySeries): any {
  return { ...s, bars: undefined, b: { t: s.bars.map((b) => b.t), o: s.bars.map((b) => b.o), h: s.bars.map((b) => b.h), l: s.bars.map((b) => b.l), c: s.bars.map((b) => b.c), v: s.bars.map((b) => b.v) } };
}
export function unpackSeries(x: any): DailySeries | null {
  const b = x?.b;
  if (!b || !Array.isArray(b.t) || !b.t.length) return null;
  const bars: Bar[] = b.t.map((t: number, i: number) => ({ t, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] }));
  if (bars.some((r) => !Number.isFinite(r.t) || !Number.isFinite(r.c))) return null;
  const { b: _b, bars: _bars, ...rest } = x;
  return { ...rest, bars } as DailySeries;
}

/** Parse one Yahoo v8 chart response into daily bars stamped at UTC midnight of the exchange's local date. */
export function parseYahooChart(j: any): DailySeries | null {
  const r = j?.chart?.result?.[0];
  if (!r) return null;
  const ts: number[] = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const off: number = Number(r.meta?.gmtoffset) || 0;
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || !Number.isFinite(c)) continue;
    const d = new Date((ts[i] + off) * 1000);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const o = Number.isFinite(q.open?.[i]) ? q.open[i] : c;
    const h = Math.max(Number.isFinite(q.high?.[i]) ? q.high[i] : c, o, c);
    const l = Math.min(Number.isFinite(q.low?.[i]) ? q.low[i] : c, o, c);
    const v = Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0;
    const prev = bars[bars.length - 1];
    if (prev && prev.t === t) { bars[bars.length - 1] = { t, o: prev.o, h: Math.max(prev.h, h), l: Math.min(prev.l, l), c, v: prev.v + v }; continue; }
    if (prev && prev.t > t) continue;
    bars.push({ t, o, h, l, c, v });
  }
  const m = r.meta || {};
  // zzz957 — Yahoo often leaves today's daily bar with an empty close (seen on BSE: TATVA.BO ended at 6 Oct while its quote
  // was 7 Oct). When the quote in the same answer is from a later day than the last full bar, add that day from the quote
  // (price, day high / low, volume; open from the bar's own open when Yahoo gave it, else the previous close).
  const px = Number(m.regularMarketPrice), mt = Number(m.regularMarketTime);
  let synthetic = false, openInferred = false;
  if (Number.isFinite(px) && px > 0 && Number.isFinite(mt) && mt > 0) {
    const d = new Date((mt + off) * 1000);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const last = bars[bars.length - 1];
    if (!last || t > last.t) {
      let o: number | null = null;
      for (let i = ts.length - 1; i >= 0; i--) {
        const di = new Date((ts[i] + off) * 1000);
        if (Date.UTC(di.getUTCFullYear(), di.getUTCMonth(), di.getUTCDate()) !== t) break;
        if (Number.isFinite(q.open?.[i])) { o = q.open[i]; }
      }
      const open = o ?? last?.c ?? px;
      synthetic = true; openInferred = o == null;
      const hi = Number(m.regularMarketDayHigh), lo = Number(m.regularMarketDayLow), vol = Number(m.regularMarketVolume);
      bars.push({ t, o: open, h: Math.max(Number.isFinite(hi) ? hi : px, open, px), l: Math.min(Number.isFinite(lo) && lo > 0 ? lo : px, open, px), c: px, v: Number.isFinite(vol) ? vol : 0 });
    }
  }
  if (!bars.length) return null;
  const divs: Array<{ t: number; amount: number }> = [];
  for (const d of Object.values<any>(r.events?.dividends || {})) {
    const at = Number(d?.date), amount = Number(d?.amount);
    if (!Number.isFinite(at) || !(amount > 0)) continue;
    const dd = new Date((at + off) * 1000);
    divs.push({ t: Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()), amount });
  }
  divs.sort((a, b) => a.t - b.t);
  return { divs, symbol: String(m.symbol || ''), name: m.longName || m.shortName || null, currency: m.currency || null, exchange: m.fullExchangeName || m.exchangeName || null, bars,
    granularity: typeof m.dataGranularity === 'string' ? m.dataGranularity : null,
    quoteAt: Number.isFinite(mt) && mt > 0 ? new Date(mt * 1000).toISOString() : null,
    lastBarSynthetic: synthetic, lastBarOpenInferred: openInferred,
    firstTradeT: Number.isFinite(Number(m.firstTradeDate)) && m.firstTradeDate != null ? Number(m.firstTradeDate) * 1000 : null };
}

async function fetchYahooDaily(symbol: string, range: DataRange): Promise<DailySeries | null> {
  for (const host of ['query1', 'query2']) {
    try {
      // zzz967 (CH-01) — Yahoo answers range=max with MONTHLY bars even when interval=1d is asked for (NVDA: 334 bars since
      // 1999), which made "All" read monthly bars as days (ADR 17%, RVol 0.02×). period1=0 returns the real daily history.
      const span = range === 'max' ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86_400}` : `range=${range}`;
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${span}&interval=1d&includePrePost=false&events=div%2Csplit`;
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, cache: 'no-store', signal: AbortSignal.timeout(range === 'max' ? 15_000 : 10_000) });
      if (!res.ok) continue;
      const parsed = parseYahooChart(await res.json());
      // never pass anything but daily bars on as daily
      if (parsed && (!parsed.granularity || parsed.granularity === '1d') && isDailyCadence(parsed.bars)) return parsed;
    } catch { /* try the next host */ }
  }
  return null;
}

/** Daily bars are mostly 1–4 days apart; a median gap above a week means the provider sent weekly / monthly bars. */
export function isDailyCadence(bars: Bar[]): boolean {
  if (bars.length < 20) return true;
  const gaps: number[] = [];
  for (let i = Math.max(1, bars.length - 400); i < bars.length; i++) gaps.push((bars[i].t - bars[i - 1].t) / 86_400_000);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] <= 5;
}

/** Yahoo symbols to try for a ticker: India .NS then .BO; US with "." written as "-" (BRK.B → BRK-B). */
export function yahooSymbolsFor(market: Market, ticker: string, exchange?: string): string[] {
  return yahooCandidates(market, ticker, exchange);   // zzz943: index names (CNXSMALLCAP, NIFTY, SPX…) and renamed tickers (TATAMOTORS) mapped
}

const _inflight = new Map<string, Promise<DailySeries | null>>();
const RANGE_YEARS: Record<Exclude<DataRange, 'max'>, number> = { '2y': 2, '5y': 5, '10y': 10 };

/**
 * zzz1010 — a shorter history cut from a longer one already in memory (5y → 2y …), so a chart that asked for 5 years does
 * not send the 2-year view back to Yahoo. Bars and dividends from `now − N years` (the window Yahoo's range=Ny covers);
 * everything else (quote time, synthetic last bar, listing date) is the longer answer's own.
 */
export function sliceSeries(s: DailySeries, range: DataRange, now = Date.now()): DailySeries {
  if (range === 'max') return s;
  const d = new Date(now);
  const from = Date.UTC(d.getUTCFullYear() - RANGE_YEARS[range], d.getUTCMonth(), d.getUTCDate());
  return { ...s, bars: s.bars.filter((b) => b.t >= from), divs: (s.divs || []).filter((x) => x.t >= from) };
}

/** A fresh longer series in memory for this ticker, cut to `range` (null when there is none). */
function fromLonger(market: Market, ticker: string, range: DataRange, exchange: string | undefined, now: number): DailySeries | null {
  if (range === 'max') return null;
  for (const r of DATA_RANGES) {
    if (DATA_RANGES.indexOf(r) <= DATA_RANGES.indexOf(range)) continue;   // only a LONGER history can be cut down
    const hit = _cache.get(`${market}:${ticker}:${r}:${exchange || 'auto'}`);
    if (hit?.data && now - hit.at < OK_TTL_MS && hit.data.bars.length) return sliceSeries(hit.data, range, now);
  }
  return null;
}

function lruTouch(key: string, e: { at: number; data: DailySeries | null }) { _cache.delete(key); _cache.set(key, e); }
function lruSet(key: string, e: { at: number; data: DailySeries | null }) {
  _cache.delete(key);
  _cache.set(key, e);
  while (_cache.size > MAX_ENTRIES) { const first = _cache.keys().next().value; if (first === undefined) break; _cache.delete(first); }
}

/** One Yahoo fetch per key at a time; a good answer replaces the kept one (and is persisted), a failed one never replaces data. */
function fetchShared(market: Market, ticker: string, range: DataRange, exchange: string | undefined, key: string): Promise<DailySeries | null> {
  const flying = _inflight.get(key);
  if (flying) return flying;
  const p = (async () => {
    let data: DailySeries | null = null;
    for (const sym of yahooSymbolsFor(market, ticker, exchange)) {
      data = await fetchYahooDaily(sym, range);
      if (data) break;
    }
    const at = Date.now();
    const prev = _cache.get(key);
    if (data || !prev?.data) lruSet(key, { at, data });
    if (data && _store && PERSIST_RANGES.has(range) && at - (_persistedAt.get(key) ?? 0) > PERSIST_EVERY_MS) {
      _persistedAt.set(key, at);
      if (_persistedAt.size > 5000) _persistedAt.clear();
      void _store.write(key, data, at).catch(() => { /* the memory copy is enough */ });
    }
    return data ?? prev?.data ?? null;
  })().finally(() => { _inflight.delete(key); });
  _inflight.set(key, p);
  return p;
}

async function readPersisted(key: string): Promise<{ at: number; data: DailySeries } | null> {
  if (!_store) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([_store.read(key).catch(() => null), new Promise<null>((r) => { timer = setTimeout(() => r(null), PERSIST_READ_WAIT_MS); })]);
  } finally { clearTimeout(timer); }
}

/** zzz1053 — age (ms) of the series this process holds for the key (0 when none): a route that keeps its own answer for a while
 *  dates it by the series, so a stale-served series is not kept as if it were fresh. */
export function seriesAgeMs(market: Market, ticker: string, range: DataRange, exchange?: string): number {
  const hit = _cache.get(`${market}:${ticker}:${range}:${exchange || 'auto'}`);
  return hit?.data ? Math.max(0, Date.now() - hit.at) : 0;
}

export async function getDailySeries(market: Market, ticker: string, range: DataRange, exchange?: string): Promise<DailySeries | null> {
  const key = `${market}:${ticker}:${range}:${exchange || 'auto'}`;
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.at < (hit.data ? OK_TTL_MS : FAIL_TTL_MS)) { lruTouch(key, hit); return hit.data; }
  const cut = fromLonger(market, ticker, range, exchange, now);
  if (cut) return cut;
  const open = (d: Date) => _marketOpen(market, d);
  // zzz1053 — a recent-enough copy answers now; the fresh one is fetched behind it (one call per key)
  if (hit?.data && seriesServableStale(hit.at, now, open)) {
    lruTouch(key, hit);
    void fetchShared(market, ticker, range, exchange, key).catch(() => null);
    return hit.data;
  }
  // zzz1010 — concurrent asks for the same series (daily + weekly view, chart + indicator, two tabs) share one Yahoo call
  const flying = _inflight.get(key);
  if (flying) return flying;
  // zzz1053 — not in memory (restart / deploy / evicted): the database copy, when recent enough
  if (!hit && PERSIST_RANGES.has(range)) {
    const saved = await readPersisted(key);
    if (saved && seriesServableStale(saved.at, Date.now(), open)) {
      if (!_cache.has(key)) lruSet(key, { at: saved.at, data: saved.data });
      _persistedAt.set(key, saved.at);
      if (Date.now() - saved.at >= OK_TTL_MS) void fetchShared(market, ticker, range, exchange, key).catch(() => null);
      return saved.data;
    }
  }
  return fetchShared(market, ticker, range, exchange, key);
}
