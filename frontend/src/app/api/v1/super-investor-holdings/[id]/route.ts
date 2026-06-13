// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR HOLDINGS — LIVE REFRESH ENDPOINT (PATCH 1059)
//
// GET /api/v1/super-investor-holdings/[id]
//
// Returns the merged set of holdings for one investor with FRESHNESS METADATA
// the UI uses to show "as of …" chips and a manual refresh button.
//
// Resolution order (first non-empty wins):
//   1. KV cache `superinv:holdings:v1:<id>` (15-min TTL) — populated by the
//      worker scraper on every successful Trendlyne fetch.
//   2. Static fallback from lib/super-investors.ts — never empty, but tagged
//      as `source: 'static'` and `stale: true` so the UI can flag staleness.
//
// The actual scraper lives in worker/src/sources/trendlyne-superinvestor.ts
// (scaffold delivered in HANDOFF4). This endpoint is the read-side contract
// and is safe to deploy independently — UI gracefully degrades to the static
// list when KV is empty.
//
// Auth: public read (same as existing super-investor-flow endpoint).
// Cache: Cache-Control: public, s-maxage=300, stale-while-revalidate=900
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { SUPER_INVESTORS, type DisclosedHolding, type SuperInvestor } from '@/lib/super-investors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

type Source = 'kv' | 'static';

interface LiveHoldingsResponse {
  id: string;
  name: string;
  trendlyneUrl: string | null;
  holdings: DisclosedHolding[];
  source: Source;
  fetchedAt: string;           // ISO timestamp this endpoint produced the response
  lastRefreshedAt: string;     // ISO timestamp the underlying data was last scraped (or seeded)
  lastDisclosedAt: string;     // YYYY-MM-DD — max(disclosedOn) across all returned rows
  stale: boolean;              // true when source==='static' OR lastRefreshedAt is older than `staleAfterMs`
  staleAfterMs: number;
  count: number;
}

interface CachedPayload {
  scrapedAt: string;           // ISO when the worker wrote this
  holdings: DisclosedHolding[];
}

// 6 hours — Trendlyne filings update at-most a few times per quarter, so
// treating anything fresher than 6h as "fresh" is fine.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function maxDisclosedAt(rows: DisclosedHolding[]): string {
  let best = '';
  for (const r of rows) {
    if (r.disclosedOn && r.disclosedOn > best) best = r.disclosedOn;
  }
  return best;
}

function staticFallback(inv: SuperInvestor, fetchedAt: string): LiveHoldingsResponse {
  // Use the most-recent disclosedOn as a proxy for `lastRefreshedAt` so the
  // UI freshness chip says something true ("filings as of 2026-03-31") even
  // when the live cache is empty.
  const lastDisclosed = maxDisclosedAt(inv.topHoldings);
  const fakeRefresh = lastDisclosed ? `${lastDisclosed}T00:00:00Z` : fetchedAt;
  return {
    id: inv.id,
    name: inv.name,
    trendlyneUrl: inv.trendlyneUrl || null,
    holdings: inv.topHoldings,
    source: 'static',
    fetchedAt,
    lastRefreshedAt: fakeRefresh,
    lastDisclosedAt: lastDisclosed,
    stale: true,
    staleAfterMs: STALE_AFTER_MS,
    count: inv.topHoldings.length,
  };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
  // Next 15 makes params async; both shapes are safe to await.
  const params = await ctx.params;
  const id = params.id;
  const inv = SUPER_INVESTORS.find((x) => x.id === id);
  if (!inv) {
    return NextResponse.json({ error: `unknown investor: ${id}` }, { status: 404 });
  }

  const fetchedAt = new Date().toISOString();

  // Try KV first.
  let kvHit: CachedPayload | null = null;
  try {
    kvHit = await kvGet<CachedPayload>(`superinv:holdings:v1:${id}`);
  } catch (e) {
    // KV down — silently fall through to static. Don't bubble the error to
    // the caller; the static list is always usable.
    console.warn(`[super-investor-holdings] KV read failed for ${id}:`, e);
  }

  if (kvHit && Array.isArray(kvHit.holdings) && kvHit.holdings.length > 0) {
    const ageMs = Date.now() - new Date(kvHit.scrapedAt).getTime();
    const body: LiveHoldingsResponse = {
      id: inv.id,
      name: inv.name,
      trendlyneUrl: inv.trendlyneUrl || null,
      holdings: kvHit.holdings,
      source: 'kv',
      fetchedAt,
      lastRefreshedAt: kvHit.scrapedAt,
      lastDisclosedAt: maxDisclosedAt(kvHit.holdings),
      stale: ageMs > STALE_AFTER_MS,
      staleAfterMs: STALE_AFTER_MS,
      count: kvHit.holdings.length,
    };
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
        'X-Source': 'kv',
      },
    });
  }

  // Static fallback.
  const body = staticFallback(inv, fetchedAt);
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
      'X-Source': 'static',
    },
  });
}
