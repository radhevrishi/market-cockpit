// ═══════════════════════════════════════════════════════════════════════════
// /api/market/fundamentals?tickers=A,B,C (PATCH 0800)
//
// Bulk-reads per-ticker Screener fundamentals from KV. Use this on
// demand for the few tickers that need quality-of-earnings detection
// (typically the home page's top movers + stock-sheet).
//
// Returns a map { [ticker]: fundamentals | null }. Missing tickers are
// expected — Screener scraper rotates through universe, so each ticker
// is refreshed every 1-2 weeks. Missing data is NOT an error.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvMGet } from '@/lib/kv';
import { rateLimitResponse } from '@/lib/rateLimit';

// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.
export const maxDuration = 15;

const RESPONSE_TTL = 60_000; // 60s in-memory cache for assembled batch
const responseCache = new Map<string, { data: any; ts: number }>();

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 60, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get('tickers') || '';
  const tickers = tickersParam
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0 && /^[A-Z0-9&-]+$/.test(t))
    .slice(0, 50); // cap at 50 to bound KV reads

  if (tickers.length === 0) {
    return NextResponse.json({ fundamentals: {}, count: 0, note: 'no tickers provided' });
  }

  const cacheKey = `fundamentals:${tickers.slice().sort().join(',')}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESPONSE_TTL) {
    return NextResponse.json(cached.data);
  }

  // zzz1049 — one MGET for all tickers (was one GET each, two for a missing ticker: up to 100 billed commands per call)
  let vals: any[];
  try { vals = await kvMGet<any>(tickers.map((t) => `fundamentals:v1:${t}`)); } catch { vals = tickers.map(() => null); }
  const results = tickers.map((ticker, i) => [ticker, vals[i] ?? null] as const);

  const fundamentals: Record<string, any> = {};
  let hit = 0;
  for (const [ticker, data] of results) {
    if (data) {
      fundamentals[ticker] = data;
      hit++;
    } else {
      fundamentals[ticker] = null;
    }
  }

  const responseData = {
    fundamentals,
    count: hit,
    requested: tickers.length,
    coverage: tickers.length > 0 ? Math.round((hit / tickers.length) * 100) : 0,
    source: 'Screener.in (cached, weekly rotation)',
    updatedAt: new Date().toISOString(),
  };
  responseCache.set(cacheKey, { data: responseData, ts: Date.now() });
  if (responseCache.size > 30) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    responseCache.delete(oldest[0]);
  }

  return NextResponse.json(responseData, {
    headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=3600' }, // PATCH 0818 — fundamentals change weekly
  });
}
