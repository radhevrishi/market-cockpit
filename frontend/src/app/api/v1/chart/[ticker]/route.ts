// zzz937 — GET /api/v1/chart/<TICKER>?market=IN|US&interval=1d|1wk|1mo&range=2y|5y|10y|max → OHLCV bars for the /charts page,
// plus the header numbers (ADR%, RVol, average traded value, last price, day change) worked out from DAILY bars.
// Public market data (Yahoo). Cached in memory only: 5 min for daily, 30 min for weekly / monthly. Nothing written to Redis.
import { NextRequest, NextResponse } from 'next/server';
import { aggregateBars, backAdjustDividends, cleanTicker, floatPct, headerStats, validTicker, type Bar, type Market, type Timeframe } from '@/lib/chart-math';
import { dbAvailable, dbQuery } from '@/lib/db';
import { DATA_RANGES, getDailySeries, type DataRange } from '@/lib/chart-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const INTERVALS: Record<string, Timeframe> = { '1d': 'D', '1wk': 'W', '1mo': 'M' };
const _resp = new Map<string, { at: number; body: unknown }>();

// zzz944 — Float %: the stock screener's US snapshot already holds free float (% of shares, from Yahoo profiles). The whole
// ticker → float map is read once an hour (small) instead of asking Yahoo per chart. India: not known yet (needs promoter holding).
let _float: { at: number; map: Map<string, number> } | null = null;
async function floatFor(market: Market, ticker: string): Promise<number | null> {
  if (market !== 'US' || !dbAvailable()) return null;
  if (!_float || Date.now() - _float.at > 3600_000) {
    const map = new Map<string, number>();
    try {
      const rows = await dbQuery<{ t: string; f: number }>(`SELECT r->>'t' AS t, (r->>'flt')::float AS f FROM screener_snapshot, jsonb_array_elements(rows) r WHERE market = 'US' AND jsonb_typeof(r->'flt') = 'number'`);
      for (const r of rows) if (r.t && Number.isFinite(Number(r.f))) map.set(String(r.t).toUpperCase(), Number(r.f));
    } catch { /* no snapshot yet */ }
    _float = { at: Date.now(), map };
  }
  return floatPct({ pct: _float.map.get(ticker) ?? null });
}

function packBars(bars: Bar[]) {
  const r2 = (x: number) => Math.round(x * 10000) / 10000;
  return { t: bars.map((b) => b.t), o: bars.map((b) => r2(b.o)), h: bars.map((b) => r2(b.h)), l: bars.map((b) => r2(b.l)), c: bars.map((b) => r2(b.c)), v: bars.map((b) => Math.round(b.v)) };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const market: Market = String(sp.get('market') || 'US').toUpperCase() === 'IN' ? 'IN' : 'US';
  const exchange = sp.get('exchange') === 'BSE' ? 'BSE' : sp.get('exchange') === 'NSE' ? 'NSE' : undefined;
  const ticker = cleanTicker(decodeURIComponent(raw || ''));
  if (!validTicker(market, ticker)) return NextResponse.json({ ok: false, error: 'That does not look like a ticker.' }, { status: 400 });
  const interval = String(sp.get('interval') || '1d');
  const tf = INTERVALS[interval];
  if (!tf) return NextResponse.json({ ok: false, error: 'interval must be 1d, 1wk or 1mo.' }, { status: 400 });
  const rangeRaw = String(sp.get('range') || (tf === 'D' ? '2y' : tf === 'W' ? '10y' : 'max'));
  if (!(DATA_RANGES as string[]).includes(rangeRaw)) return NextResponse.json({ ok: false, error: 'range must be 2y, 5y, 10y or max.' }, { status: 400 });
  const range = rangeRaw as DataRange;
  // zzz969 — price basis: 'price' (split-adjusted closes, as printed) or 'tr' (total return: dividends reinvested)
  const basis: 'price' | 'tr' = sp.get('basis') === 'tr' ? 'tr' : 'price';

  const ttl = tf === 'D' ? 5 * 60_000 : 30 * 60_000;
  const ck = `${market}:${ticker}:${interval}:${range}:${exchange || 'auto'}:${basis}`;
  const hit = _resp.get(ck);
  const headers = { 'Cache-Control': `private, max-age=${Math.round(ttl / 1000)}` };
  if (hit && Date.now() - hit.at < ttl) return NextResponse.json(hit.body, { headers });

  const series = await getDailySeries(market, ticker, range, exchange);
  if (!series) return NextResponse.json({ ok: false, error: `No price history found for ${ticker} (${market === 'IN' ? 'NSE / BSE' : 'US'}).` }, { status: 404 });
  const divs = series.divs || [];
  const bars = aggregateBars(basis === 'tr' ? backAdjustDividends(series.bars, divs) : series.bars, tf);
  const body = {
    ok: true, ticker, market, interval, range, basis, dividends: divs.length, requestedExchange: market === 'IN' ? (exchange ?? null) : null,   // zzz967 (CH-02)
    symbol: series.symbol, name: series.name, currency: series.currency, exchange: series.exchange,
    stats: { ...headerStats(series.bars), floatPct: await floatFor(market, ticker).catch(() => null) },
    bars: packBars(bars),
    asOf: new Date().toISOString(),
    lastBarAt: series.bars.length ? new Date(series.bars[series.bars.length - 1].t).toISOString().slice(0, 10) : null,   // zzz957: date of the newest daily candle
    // zzz967 (DT-01) — where the numbers come from and what was filled in
    provenance: {
      source: 'Yahoo Finance chart API', nativeGranularity: series.granularity || '1d', displayInterval: interval,
      firstBarAt: series.bars.length ? new Date(series.bars[0].t).toISOString().slice(0, 10) : null,
      quoteAt: series.quoteAt ?? null,
      priceBasis: basis === 'tr' ? `total return — ${divs.length} cash dividends reinvested (history back-adjusted; the latest price is unchanged)` : 'split-adjusted, not dividend-adjusted',
      lastBarFromQuote: !!series.lastBarSynthetic, lastBarOpenInferred: !!series.lastBarOpenInferred,
      highLowRepaired: 'high/low widened to include open and close when the provider row is inconsistent',
    },
  };
  if (_resp.size >= 300) { const first = _resp.keys().next().value; if (first) _resp.delete(first); }
  _resp.set(ck, { at: Date.now(), body });
  return NextResponse.json(body, { headers });
}
