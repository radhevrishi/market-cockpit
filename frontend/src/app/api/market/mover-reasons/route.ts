// ═══════════════════════════════════════════════════════════════════════════
// /api/market/mover-reasons?tickers=A,B,C (PATCH 0801)
//
// Bulk-reads per-ticker mover-reasons KV keys populated by the
// scrape-mover-reasons GH Actions workflow. Returns top headline +
// narrative category per ticker.
//
// Used by home page Top Movers to surface a REAL public-source headline
// as the "primary driver" when the local catalyst-scoring engine has
// nothing (i.e. no filing/news/earnings match in our existing pipelines).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { rateLimitResponse } from '@/lib/rateLimit';

// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.
export const maxDuration = 15;

const RESPONSE_TTL = 60_000;
const responseCache = new Map<string, { data: any; ts: number }>();

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 60, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('tickers') || '';
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0 && /^[A-Z0-9&-]+$/.test(t))
    .slice(0, 50);

  if (tickers.length === 0) {
    return NextResponse.json({ reasons: {}, count: 0 });
  }

  const cacheKey = `mover-reasons:${tickers.slice().sort().join(',')}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESPONSE_TTL) {
    return NextResponse.json(cached.data);
  }

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const data = await kvGet<any>(`mover-reasons:v1:${ticker}`);
        return [ticker, data] as const;
      } catch {
        return [ticker, null] as const;
      }
    })
  );

  const reasons: Record<string, any> = {};
  let hit = 0;
  for (const [ticker, data] of results) {
    if (data) {
      reasons[ticker] = {
        topReason: data.topReason,
        narrative: data.narrative,
        allReasons: data.allReasons,
        generatedAt: data.generatedAt,
      };
      hit++;
    } else {
      reasons[ticker] = null;
    }
  }

  const responseData = {
    reasons,
    count: hit,
    requested: tickers.length,
    coverage: tickers.length > 0 ? Math.round((hit / tickers.length) * 100) : 0,
    source: 'Google News + Moneycontrol + Trendlyne + Yahoo (hourly scrape)',
    updatedAt: new Date().toISOString(),
  };
  responseCache.set(cacheKey, { data: responseData, ts: Date.now() });
  if (responseCache.size > 30) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    responseCache.delete(oldest[0]);
  }

  return NextResponse.json(responseData, {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=900' }, // PATCH 0818
  });
}
