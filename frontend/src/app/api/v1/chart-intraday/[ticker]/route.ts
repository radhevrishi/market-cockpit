// zzz1088 — GET /api/v1/chart-intraday/<TICKER>?market=IN|US&interval=5m|15m|60m[&exchange=NSE|BSE]
// Regular-session intraday bars (Yahoo chart API, includePrePost=false) with each bar's exchange session date, for the multi-chart
// page's intraday views and session VWAP. Public market data; memory cache only (60 s for 5-minute bars, 3 min otherwise).
import { NextRequest, NextResponse } from 'next/server';
import { cleanTicker, validTicker, type Market } from '@/lib/chart-math';
import { yahooSymbolsFor } from '@/lib/chart-data';
import { INTRADAY_META, isIntraday, parseYahooIntraday, type IntradaySeries, type IntradayTf } from '@/lib/intraday';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const _cache = new Map<string, { at: number; body: unknown }>();
const _inflight = new Map<string, Promise<IntradaySeries | null>>();

async function load(symbols: string[], tf: IntradayTf, market: Market): Promise<IntradaySeries | null> {
  for (const sym of symbols) {
    for (const host of ['query1', 'query2']) {
      try {
        const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${INTRADAY_META[tf].range}&interval=${tf}&includePrePost=false`;
        const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
        if (!res.ok) continue;
        const s = parseYahooIntraday(await res.json(), tf, Date.now(), market);
        if (s && (!s.granularity || s.granularity === tf)) return s;
      } catch { /* next host */ }
    }
  }
  return null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const market: Market = String(sp.get('market') || 'US').toUpperCase() === 'IN' ? 'IN' : 'US';
  const exchange = sp.get('exchange') === 'BSE' ? 'BSE' : sp.get('exchange') === 'NSE' ? 'NSE' : undefined;
  const ticker = cleanTicker(decodeURIComponent(raw || ''));
  if (!validTicker(market, ticker)) return NextResponse.json({ ok: false, error: 'That does not look like a ticker.' }, { status: 400 });
  const interval = String(sp.get('interval') || '5m');
  if (!isIntraday(interval)) return NextResponse.json({ ok: false, error: 'interval must be 5m, 15m or 60m.' }, { status: 400 });
  const ttl = interval === '5m' ? 60_000 : 180_000;
  const key = `${market}:${ticker}:${interval}:${exchange || 'auto'}`;
  const hit = _cache.get(key);
  const headers = { 'Cache-Control': `private, max-age=${Math.round(ttl / 1000)}` };
  if (hit && Date.now() - hit.at < ttl) return NextResponse.json(hit.body, { headers });
  let p = _inflight.get(key);
  if (!p) { p = load(yahooSymbolsFor(market, ticker, exchange), interval, market).finally(() => _inflight.delete(key)); _inflight.set(key, p); }
  const s = await p;
  if (!s) return NextResponse.json({ ok: false, error: `No ${INTRADAY_META[interval].label} bars found for ${ticker}. Intraday bars come from Yahoo and cover the ${INTRADAY_META[interval].days}; some small companies have none.` }, { status: 404 });
  const body = {
    ok: true, ticker, market, interval, symbol: s.symbol, name: s.name, currency: s.currency, exchange: s.exchange, tz: s.tz, lastLive: s.lastLive,
    bars: { t: s.bars.map((b) => b.t), o: s.bars.map((b) => b.o), h: s.bars.map((b) => b.h), l: s.bars.map((b) => b.l), c: s.bars.map((b) => b.c), v: s.bars.map((b) => Math.round(b.v)), s: s.bars.map((b) => b.s) },
    asOf: new Date().toISOString(),
    provenance: { source: 'Yahoo Finance chart API', interval, window: INTRADAY_META[interval].days, session: 'regular session only (no pre- or after-market)' },
  };
  if (_cache.size >= 300) { const first = _cache.keys().next().value; if (first) _cache.delete(first); }
  _cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body, { headers });
}
