// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — LIVE QUOTES FROM YAHOO (chart API).            (zzz793)
//
// BOOK PAGE ONLY. Nothing under lib/us-thesis may import this file.
//
// Why a US-book-own reader instead of the shared lib/yahoo helper: the shared
// batch quote endpoint is crumb-gated (401) so everything falls back to the
// per-symbol chart reader, and that fallback DROPS `currency` and the price
// time. Without currency the page cannot refuse a quote in the wrong
// currency; without a time it cannot say how old a price is. This reader
// keeps both, plus the previous close, straight from Yahoo's chart meta.
//
// Nothing is guessed: a field Yahoo did not send stays null.
// ═══════════════════════════════════════════════════════════════════════════

import type { UsQuote } from './valuation';

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const pos = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * One Yahoo chart response (range=1d, interval=1d) → a quote. Pure.
 * previousClose: meta.previousClose when Yahoo states it, else
 * chartPreviousClose — on a ONE-DAY range that is the close of the session
 * before, which is exactly the previous close. (On longer ranges it is not,
 * which is why this reader always asks for range=1d.)
 */
export function parseYahooChart(json: any, symbol: string): UsQuote {
  const meta = json?.chart?.result?.[0]?.meta;
  const price = pos(meta?.regularMarketPrice);
  const t = typeof meta?.regularMarketTime === 'number' && meta.regularMarketTime > 0 ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
  const range = String(meta?.range || '');
  const prev = pos(meta?.previousClose) ?? (range === '1d' ? pos(meta?.chartPreviousClose) : null);
  return {
    symbol,
    price,
    currency: meta?.currency ? String(meta.currency).toUpperCase() : null,
    source: price != null ? 'Yahoo Finance' : 'unavailable',
    asOf: t,
    marketTime: t,
    prevClose: price != null ? prev : null,
    name: meta?.longName || meta?.shortName || null,
    exchangeName: meta?.fullExchangeName || meta?.exchangeName || null,
    error: price != null ? null : (json?.chart?.error?.description || (meta ? 'Yahoo sent no price' : 'Yahoo does not know this symbol')),
  };
}

async function fetchOne(symbol: string, fetcher: typeof fetch): Promise<UsQuote> {
  try {
    const r = await fetcher(`${YF}${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(10_000) } as any);
    if (!r.ok) {
      let j: any = null; try { j = await r.json(); } catch { /* body not JSON */ }
      const q = parseYahooChart(j, symbol);
      return { ...q, error: r.status === 404 ? 'Yahoo does not know this symbol' : `Yahoo answered HTTP ${r.status}` };
    }
    return parseYahooChart(await r.json(), symbol);
  } catch (e: any) {
    return { symbol, price: null, currency: null, source: 'unavailable', asOf: null, marketTime: null, prevClose: null, name: null, exchangeName: null, error: /timeout|abort/i.test(String(e?.name || e?.message)) ? 'Yahoo did not answer in time' : 'Yahoo could not be reached' };
  }
}

/** Bounded-concurrency fetch of every symbol. Never throws. */
export async function fetchUsBookQuotes(symbols: string[], fetcher: typeof fetch = fetch): Promise<Record<string, UsQuote>> {
  const out: Record<string, UsQuote> = {};
  const list = Array.from(new Set(symbols.filter(Boolean)));
  const CONC = 6;
  for (let i = 0; i < list.length; i += CONC) {
    const slab = list.slice(i, i + CONC);
    const got = await Promise.all(slab.map((s) => fetchOne(s, fetcher)));
    got.forEach((q, k) => { out[slab[k]] = q; });
    if (i + CONC < list.length) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}
