// zzz937 — GET /api/v1/chart/<TICKER>?market=IN|US&interval=1d|1wk|1mo&range=2y|5y|10y|max → OHLCV bars for the /charts page,
// plus the header numbers (ADR%, RVol, average traded value, last price, day change) worked out from DAILY bars.
// Public market data (Yahoo). Cached in memory only: 5 min for daily, 30 min for weekly / monthly. Nothing written to Redis.
import { NextRequest, NextResponse } from 'next/server';
import { aggregateBars, cleanTicker, headerStats, validTicker, type Bar, type Market, type Timeframe } from '@/lib/chart-math';
import { DATA_RANGES, getDailySeries, type DataRange } from '@/lib/chart-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const INTERVALS: Record<string, Timeframe> = { '1d': 'D', '1wk': 'W', '1mo': 'M' };
const _resp = new Map<string, { at: number; body: unknown }>();

function packBars(bars: Bar[]) {
  const r2 = (x: number) => Math.round(x * 10000) / 10000;
  return { t: bars.map((b) => b.t), o: bars.map((b) => r2(b.o)), h: bars.map((b) => r2(b.h)), l: bars.map((b) => r2(b.l)), c: bars.map((b) => r2(b.c)), v: bars.map((b) => Math.round(b.v)) };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const market: Market = String(sp.get('market') || 'US').toUpperCase() === 'IN' ? 'IN' : 'US';
  const ticker = cleanTicker(decodeURIComponent(raw || ''));
  if (!validTicker(market, ticker)) return NextResponse.json({ ok: false, error: 'That does not look like a ticker.' }, { status: 400 });
  const interval = String(sp.get('interval') || '1d');
  const tf = INTERVALS[interval];
  if (!tf) return NextResponse.json({ ok: false, error: 'interval must be 1d, 1wk or 1mo.' }, { status: 400 });
  const rangeRaw = String(sp.get('range') || (tf === 'D' ? '2y' : tf === 'W' ? '10y' : 'max'));
  if (!(DATA_RANGES as string[]).includes(rangeRaw)) return NextResponse.json({ ok: false, error: 'range must be 2y, 5y, 10y or max.' }, { status: 400 });
  const range = rangeRaw as DataRange;

  const ttl = tf === 'D' ? 5 * 60_000 : 30 * 60_000;
  const ck = `${market}:${ticker}:${interval}:${range}`;
  const hit = _resp.get(ck);
  const headers = { 'Cache-Control': `private, max-age=${Math.round(ttl / 1000)}` };
  if (hit && Date.now() - hit.at < ttl) return NextResponse.json(hit.body, { headers });

  const series = await getDailySeries(market, ticker, range);
  if (!series) return NextResponse.json({ ok: false, error: `No price history found for ${ticker} (${market === 'IN' ? 'NSE / BSE' : 'US'}).` }, { status: 404 });
  const bars = aggregateBars(series.bars, tf);
  const body = {
    ok: true, ticker, market, interval, range,
    symbol: series.symbol, name: series.name, currency: series.currency, exchange: series.exchange,
    stats: headerStats(series.bars),
    bars: packBars(bars),
    asOf: new Date().toISOString(),
  };
  if (_resp.size >= 300) { const first = _resp.keys().next().value; if (first) _resp.delete(first); }
  _resp.set(ck, { at: Date.now(), body });
  return NextResponse.json(body, { headers });
}
