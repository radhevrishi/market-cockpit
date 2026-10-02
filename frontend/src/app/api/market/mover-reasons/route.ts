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
import { kvMGet } from '@/lib/kv';
import { privateCache } from '@/lib/swr-cache';
import { rateLimitResponse } from '@/lib/rateLimit';

// PATCH 0819: removed force-dynamic so Cache-Control headers aren't overridden by Next.js. Query params still force dynamic at runtime.
export const maxDuration = 15;

// zzz855: per-ticker memo replaces the per-ticker-set response cache (overlapping sets now share entries)
const MEMO_HIT_MS = 5 * 60_000;
const MEMO_MISS_MS = 60_000;
const TICKER_MEMO: Map<string, { data: any; ts: number }> = (globalThis as any).__MC_MOVER_REASONS_MEMO__ || new Map();
(globalThis as any).__MC_MOVER_REASONS_MEMO__ = TICKER_MEMO;

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

  // zzz855 — was one KV GET per ticker (up to 50 parallel round-trips, each with a raw-REST fallback on a miss: ~2.2 s).
  // Now: a per-ticker in-process memo (hits 5 min, misses 60 s — the scrape is hourly) and ONE MGET for the rest.
  const nowMs = Date.now();
  const fromMem: Array<readonly [string, any]> = [];
  const need: string[] = [];
  for (const t of tickers) {
    const m = TICKER_MEMO.get(t);
    if (m && nowMs - m.ts < (m.data ? MEMO_HIT_MS : MEMO_MISS_MS)) fromMem.push([t, m.data] as const);
    else need.push(t);
  }
  let fetched: Array<readonly [string, any]> = [];
  if (need.length) {
    let vals: any[] = [];
    try { vals = await kvMGet<any>(need.map((t) => `mover-reasons:v1:${t}`)); } catch { vals = need.map(() => null); }
    fetched = need.map((t, i) => [t, vals[i] ?? null] as const);
    for (const [t, d] of fetched) TICKER_MEMO.set(t, { data: d, ts: nowMs });
    if (TICKER_MEMO.size > 2000) { for (const k of Array.from(TICKER_MEMO.keys()).slice(0, 500)) TICKER_MEMO.delete(k); }
  }
  const byT = new Map<string, any>([...fromMem, ...fetched]);
  const results = tickers.map((t) => [t, byT.get(t) ?? null] as const);

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
  return NextResponse.json(responseData, {
    headers: { 'Cache-Control': privateCache(60, 300), 'x-mc-cache': need.length === 0 ? 'hit' : 'miss' },
  });
}
