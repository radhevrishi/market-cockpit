// PATCH 0445 BUG-021 — Portfolio TREND endpoint.
//
// The /portfolio page previously showed '—' in the TREND column for every
// holding because the Intelligence service didn't return sectorTrend for
// portfolio tickers. This endpoint fills that gap with a basic RRG-style
// classification per ticker:
//
//   • Pull 3-month daily history from Yahoo for each holding AND the NIFTY 50.
//   • Compute 1m and 3m return for each ticker AND benchmark.
//   • Subtract benchmark return → relative-strength (RS) ratio + momentum.
//   • Map (RS_3m, RS_1m) → 4-quadrant RRG state:
//       LEADING    — both positive (outperforming, momentum confirming)
//       IMPROVING  — 3m negative, 1m positive (turning up)
//       WEAKENING  — 3m positive, 1m negative (rolling over)
//       LAGGING    — both negative (under-performing across both horizons)
//
// Cached in KV 1h. Response shape: { ticker, label, rs_1m, rs_3m }[].

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface TrendRow {
  ticker: string;
  label: 'LEADING' | 'IMPROVING' | 'WEAKENING' | 'LAGGING' | 'UNKNOWN';
  rs_1m: number | null;
  rs_3m: number | null;
}

const CACHE_TTL_S = 3600; // 1 hour

async function yahooDailyReturnFor(symbol: string, days: number): Promise<number | null> {
  // PATCH 0446 BUG-021 v2 — Yahoo /chart endpoint rate-limits India .NS
  // tickers. Try the bare symbol AND the .NS suffix variant; accept the
  // first that returns a usable close series. Header tweak (browser UA +
  // accept) also reduces Cloudflare friction.
  const tryOne = async (yahooSym: string): Promise<number | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const range = days <= 30 ? '3mo' : '6mo';
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=${range}&interval=1d`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*',
        },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const json = await res.json();
      const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const valid = closes.filter(c => typeof c === 'number' && c > 0);
      if (valid.length < days + 1) return null;
      const last = valid[valid.length - 1];
      const past = valid[valid.length - 1 - days];
      if (!past || past === 0) return null;
      return ((last - past) / past) * 100;
    } catch {
      return null;
    }
  };
  // Index symbols like ^NSEI shouldn't get .NS appended
  if (symbol.startsWith('^')) {
    return tryOne(symbol);
  }
  if (symbol.includes('.')) {
    return tryOne(symbol);
  }
  // Try .NS first (India), fall back to bare ticker (US)
  return (await tryOne(`${symbol}.NS`)) ?? (await tryOne(symbol));
}
const yahooDailyReturn = yahooDailyReturnFor; // legacy alias used below

function classify(rs1m: number | null, rs3m: number | null): TrendRow['label'] {
  if (rs1m === null && rs3m === null) return 'UNKNOWN';
  const p1 = rs1m ?? 0;
  const p3 = rs3m ?? 0;
  if (p1 >= 0 && p3 >= 0) return 'LEADING';
  if (p1 >= 0 && p3 < 0)  return 'IMPROVING';
  if (p1 < 0  && p3 >= 0) return 'WEAKENING';
  return 'LAGGING';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbolsParam = searchParams.get('symbols') || '';
  const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);
  if (symbols.length === 0) {
    return NextResponse.json({ rows: [], benchmark: '^NSEI', generated_at: new Date().toISOString() });
  }

  const cacheKey = `portfolio-trend:v1:${symbols.sort().join(',')}`;
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<{ rows: TrendRow[]; benchmark: string; generated_at: string }>(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true });
      }
    } catch {}
  }

  const benchmark = '^NSEI';
  const [bench1m, bench3m] = await Promise.all([
    yahooDailyReturn(benchmark, 21),
    yahooDailyReturn(benchmark, 63),
  ]);

  // Concurrency-capped fan-out to avoid Yahoo rate limits.
  const rows: TrendRow[] = [];
  const CONC = 6;
  for (let i = 0; i < symbols.length; i += CONC) {
    const chunk = symbols.slice(i, i + CONC);
    const settled = await Promise.allSettled(
      chunk.map(async (sym): Promise<TrendRow> => {
        const [r1, r3] = await Promise.all([
          yahooDailyReturn(sym, 21),
          yahooDailyReturn(sym, 63),
        ]);
        const rs1 = r1 !== null && bench1m !== null ? Math.round((r1 - bench1m) * 100) / 100 : null;
        const rs3 = r3 !== null && bench3m !== null ? Math.round((r3 - bench3m) * 100) / 100 : null;
        return { ticker: sym, label: classify(rs1, rs3), rs_1m: rs1, rs_3m: rs3 };
      })
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') rows.push(s.value);
    }
  }

  const payload = {
    rows,
    benchmark,
    bench_1m: bench1m,
    bench_3m: bench3m,
    generated_at: new Date().toISOString(),
  };
  if (isRedisAvailable()) {
    try { await kvSet(cacheKey, payload, CACHE_TTL_S); } catch {}
  }
  return NextResponse.json(payload);
}
