// zzz937 — server-only: daily OHLCV for the /charts page from Yahoo's chart API, India via .NS (falling back to .BO).
import { yahooCandidates } from './yahoo-symbol';
// Kept in memory only (a few minutes) — chart series are large and must not go to Redis.
import type { Bar, Market } from './chart-math';

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
const MAX_ENTRIES = 200;

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

export async function getDailySeries(market: Market, ticker: string, range: DataRange, exchange?: string): Promise<DailySeries | null> {
  const key = `${market}:${ticker}:${range}:${exchange || 'auto'}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < (hit.data ? OK_TTL_MS : FAIL_TTL_MS)) return hit.data;
  let data: DailySeries | null = null;
  for (const sym of yahooSymbolsFor(market, ticker, exchange)) {
    data = await fetchYahooDaily(sym, range);
    if (data) break;
  }
  if (_cache.size >= MAX_ENTRIES) { const first = _cache.keys().next().value; if (first) _cache.delete(first); }
  _cache.set(key, { at: Date.now(), data });
  return data;
}
