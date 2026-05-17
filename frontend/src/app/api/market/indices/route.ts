import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// In-memory cache: refresh every 60 seconds
let _cache: { data: any[]; ts: number } | null = null;
const CACHE_TTL = 60_000;

/**
 * GET /api/market/indices
 * Returns global market indices for the ticker bar.
 * Direct NSE fetch — no FastAPI dependency.
 */
export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 180, 60_000); // generous: polled every 60s
  if (limited) return limited;
  // Return cache if fresh
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return NextResponse.json(_cache.data);
  }

  const indices: any[] = [];

  try {
    // Fetch NIFTY 50 and SENSEX from NSE
    const [niftyData, bankNiftyData] = await Promise.all([
      nseApiFetch('/api/equity-stockIndices?index=NIFTY%2050', 60000).catch(() => null),
      nseApiFetch('/api/equity-stockIndices?index=NIFTY%20BANK', 60000).catch(() => null),
    ]);

    // PATCH 0445 BUG-001 — Derive a real change_pct from (last - prevClose)
    // when NSE's pChange is missing/zero. Hardcoded `change_pct: 0` was the
    // root cause of the persistent '+0.00%' on the ticker bar.
    const realPct = (last: any, prev: any, pChange: any): number | null => {
      const lastN = Number(last);
      const prevN = Number(prev);
      const pcN = Number(pChange);
      if (Number.isFinite(pcN) && Math.abs(pcN) > 0.0001) return pcN;
      if (Number.isFinite(lastN) && Number.isFinite(prevN) && prevN > 0) {
        const computed = ((lastN - prevN) / prevN) * 100;
        if (Number.isFinite(computed) && Math.abs(computed) > 0.0001) return computed;
      }
      // Fall back to NSE's pChange even if it's near-zero — at least it's truthful
      if (Number.isFinite(pcN)) return pcN;
      return null;
    };

    // NIFTY 50
    if (niftyData?.metadata) {
      const m = niftyData.metadata;
      const pct = realPct(m.last, m.previousClose, m.pChange);
      indices.push({
        symbol: 'NIFTY 50',
        price: m.last || m.previousClose || 0,
        change_pct: pct,
        change: m.change ?? null,
      });
    }

    // SENSEX — estimated from NIFTY (NSE doesn't serve SENSEX directly)
    if (niftyData?.metadata) {
      const niftyPrice = niftyData.metadata.last || 23500;
      const sensexEstimate = Math.round(niftyPrice * 3.28); // rough ratio
      const pct = realPct(niftyData.metadata.last, niftyData.metadata.previousClose, niftyData.metadata.pChange);
      indices.push({
        symbol: 'SENSEX',
        price: sensexEstimate,
        change_pct: pct,
        change: null,
      });
    }

    // BANK NIFTY
    if (bankNiftyData?.metadata) {
      const m = bankNiftyData.metadata;
      const pct = realPct(m.last, m.previousClose, m.pChange);
      indices.push({
        symbol: 'BANK NIFTY',
        price: m.last || m.previousClose || 0,
        change_pct: pct,
        change: m.change ?? null,
      });
    }

    // Static FX placeholder — explicit null so the front-end renders '—'
    // instead of a misleading '+0.00%' (PATCH 0445 BUG-001).
    indices.push(
      { symbol: 'USD/INR', price: 85.50, change_pct: null, change: null },
    );

    _cache = { data: indices, ts: Date.now() };
    return NextResponse.json(indices);
  } catch (error) {
    console.error('[Indices] Error:', error);
    // Return stale cache or empty
    if (_cache) return NextResponse.json(_cache.data);
    return NextResponse.json([]);
  }
}
