// zzz937 — GET /api/v1/chart/<TICKER>?market=IN|US&interval=1d|1wk|1mo&range=2y|5y|10y|max → OHLCV bars for the /charts page,
// plus the header numbers (ADR%, RVol, average traded value, last price, day change) worked out from DAILY bars.
// Public market data (Yahoo). Cached in memory only: 5 min for daily, 30 min for weekly / monthly. Nothing written to Redis.
import { NextRequest, NextResponse } from 'next/server';
import { TOTAL_RETURN_LABEL, aggregateBars, backAdjustDividendsDetailed, cleanTicker, floatPct, headerStats, validTicker, type Bar, type Market, type Timeframe } from '@/lib/chart-math';
import { dbAvailable } from '@/lib/db';
import { getSnapshot } from '@/lib/screener/snapshot-cache';
import { DATA_RANGES, getDailySeries, seriesAgeMs, type DataRange } from '@/lib/chart-data';
import { serverTiming, withServerTiming } from '@/lib/server-timing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const INTERVALS: Record<string, Timeframe> = { '1d': 'D', '1wk': 'W', '1mo': 'M' };
const _resp = new Map<string, { at: number; body: unknown }>();

// zzz944 — Float %: the stock screener's US snapshot already holds free float (% of shares, from Yahoo profiles). The whole
// ticker → float map is read once an hour (small) instead of asking Yahoo per chart. India: not known yet (needs promoter holding).
let _float: { at: number; map: Map<string, number> } | null = null;
let _floatLoad: Promise<void> | null = null;   // zzz1010 — one database read at a time, shared by every chart request
function loadFloat(): Promise<void> {
  if (!_floatLoad) {
    _floatLoad = (async () => {
      const map = new Map<string, number>();
      try {
        // zzz1053 — from the shared in-memory snapshot (lib/screener/snapshot-cache.ts) instead of unpacking it again in Postgres
        const snap = await getSnapshot('US');
        for (const r of (snap?.rows || []) as any[]) if (r?.t && typeof r.flt === 'number' && Number.isFinite(r.flt)) map.set(String(r.t).toUpperCase(), r.flt);
      } catch { /* no snapshot yet */ }
      _float = { at: Date.now(), map };
    })().finally(() => { _floatLoad = null; });
  }
  return _floatLoad;
}
async function floatFor(market: Market, ticker: string): Promise<number | null> {
  if (market !== 'US' || !dbAvailable()) return null;
  if (!_float) await loadFloat();
  else if (Date.now() - _float.at > 3600_000) void loadFloat();   // the hour-old map answers now; the new one is read behind it
  return floatPct({ pct: _float?.map.get(ticker) ?? null });
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
  // zzz969 — price basis: 'price' (split-adjusted closes, as printed) or 'tr' (total return: dividends reinvested at the ex-date
  // close — N-05). Yahoo sends dividend amounts on the same split-adjusted basis as the closes (see backAdjustDividendsDetailed).
  const basis: 'price' | 'tr' = sp.get('basis') === 'tr' ? 'tr' : 'price';

  const ttl = tf === 'D' ? 5 * 60_000 : 30 * 60_000;
  // N-05: 'tr2' — the reinvest-at-ex-date-close formula; never serve bars cached under the old factor
  const ck = `${market}:${ticker}:${interval}:${range}:${exchange || 'auto'}:${basis === 'tr' ? 'tr2' : basis}`;
  const hit = _resp.get(ck);
  const headers = { 'Cache-Control': `private, max-age=${Math.round(ttl / 1000)}` };
  const t = serverTiming();
  if (hit && Date.now() - hit.at < ttl) {
    _resp.delete(ck); _resp.set(ck, hit);   // zzz1053: least-recently-used order
    t.note('memo', 'hit');
    return withServerTiming(NextResponse.json(hit.body, { headers }), t);
  }

  // zzz1010 — the float lookup (a database read once an hour) runs alongside the price history, never before it, and the
  // chart never waits more than 1.5 s for it (float is a header extra; the candles are what the owner is waiting for)
  let floatTimer: ReturnType<typeof setTimeout> | undefined;
  const floatP = Promise.race([floatFor(market, ticker).catch(() => null), new Promise<null>((r) => { floatTimer = setTimeout(() => r(null), 1500); })]).finally(() => clearTimeout(floatTimer));
  const s0 = t.elapsed();
  const series = await getDailySeries(market, ticker, range, exchange);
  t.add('series', t.elapsed() - s0, 'daily bars (memory / database / Yahoo)');
  if (!series) return NextResponse.json({ ok: false, error: `No price history found for ${ticker} (${market === 'IN' ? 'NSE / BSE' : 'US'}).` }, { status: 404 });
  const divs = series.divs || [];
  const adj = basis === 'tr' ? backAdjustDividendsDetailed(series.bars, divs) : null;
  const bars = aggregateBars(adj ? adj.bars : series.bars, tf);
  const body = {
    ok: true, ticker, market, interval, range, basis, dividends: divs.length, requestedExchange: market === 'IN' ? (exchange ?? null) : null,   // zzz967 (CH-02)
    symbol: series.symbol, name: series.name, currency: series.currency, exchange: series.exchange,
    stats: { ...headerStats(series.bars), floatPct: await floatP },
    bars: packBars(bars),
    asOf: new Date().toISOString(),
    lastBarAt: series.bars.length ? new Date(series.bars[series.bars.length - 1].t).toISOString().slice(0, 10) : null,   // zzz957: date of the newest daily candle
    firstTradeT: series.firstTradeT ?? null,   // zzz990 (CP-03): listing / first-trade date (ms) for the chart-pattern IPO-base rule
    // zzz967 (DT-01) — where the numbers come from and what was filled in
    provenance: {
      source: 'Yahoo Finance chart API', nativeGranularity: series.granularity || '1d', displayInterval: interval,
      firstBarAt: series.bars.length ? new Date(series.bars[0].t).toISOString().slice(0, 10) : null,
      quoteAt: series.quoteAt ?? null,
      priceBasis: adj
        ? `${TOTAL_RETURN_LABEL}; ${divs.length} cash dividends, history back-adjusted, the latest price is unchanged${adj.fallbacks.length ? `; ${adj.fallbacks.length} without an ex-date close used the previous close instead` : ''}`
        : 'split-adjusted, not dividend-adjusted',
      ...(adj ? { dividendMethod: 'reinvest-at-ex-date-close', dividendFallbacks: adj.fallbacks.map((f) => ({ date: new Date(f.t).toISOString().slice(0, 10), amount: f.amount, reason: f.reason })) } : {}),
      lastBarFromQuote: !!series.lastBarSynthetic, lastBarOpenInferred: !!series.lastBarOpenInferred,
      highLowRepaired: 'high/low widened to include open and close when the provider row is inconsistent',
    },
  };
  if (_resp.size >= 600) { const first = _resp.keys().next().value; if (first) _resp.delete(first); }
  // zzz1053 — dated by the series' own age: a series served stale (refreshing behind) is not kept here as if fresh
  _resp.set(ck, { at: Date.now() - Math.min(seriesAgeMs(market, ticker, range, exchange), ttl), body });
  return withServerTiming(NextResponse.json(body, { headers }), t);
}
