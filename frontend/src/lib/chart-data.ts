// zzz937 — server-only: daily OHLCV for the /charts page from Yahoo's chart API, India via .NS (falling back to .BO).
import { yahooCandidates } from './yahoo-symbol';
// Kept in memory only (a few minutes) — chart series are large and must not go to Redis.
import type { Bar, Market } from './chart-math';

// The same User-Agent (and no other header) as lib/us-prices.ts — Yahoo refuses other agents from the deploy host.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type DataRange = '2y' | '5y' | '10y' | 'max';
export const DATA_RANGES: DataRange[] = ['2y', '5y', '10y', 'max'];

export interface DailySeries { symbol: string; name: string | null; currency: string | null; exchange: string | null; bars: Bar[] }

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
  if (!bars.length) return null;
  const m = r.meta || {};
  return { symbol: String(m.symbol || ''), name: m.longName || m.shortName || null, currency: m.currency || null, exchange: m.fullExchangeName || m.exchangeName || null, bars };
}

async function fetchYahooDaily(symbol: string, range: DataRange): Promise<DailySeries | null> {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false&events=div%2Csplit`;
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const parsed = parseYahooChart(await res.json());
      if (parsed) return parsed;
    } catch { /* try the next host */ }
  }
  return null;
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
