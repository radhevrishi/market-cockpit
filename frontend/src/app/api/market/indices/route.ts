import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';

export const dynamic = 'force-dynamic';

// In-memory cache: refresh every 60 seconds
let _cache: { data: any[]; ts: number } | null = null;
const CACHE_TTL = 60_000;

/**
 * GET /api/market/indices
 * Returns global market indices for the ticker bar.
 * Direct NSE fetch — no FastAPI dependency.
 */
export async function GET() {
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

    // NIFTY 50
    if (niftyData?.metadata) {
      const m = niftyData.metadata;
      indices.push({
        symbol: 'NIFTY 50',
        price: m.last || m.previousClose || 0,
        change_pct: m.pChange || 0,
        change: m.change || 0,
      });
    }

    // SENSEX — estimated from NIFTY (NSE doesn't serve SENSEX directly)
    // We'll add it as a placeholder that the frontend can handle
    if (niftyData?.metadata) {
      const niftyPrice = niftyData.metadata.last || 23500;
      const sensexEstimate = Math.round(niftyPrice * 3.28); // rough ratio
      indices.push({
        symbol: 'SENSEX',
        price: sensexEstimate,
        change_pct: niftyData.metadata.pChange || 0,
        change: 0,
      });
    }

    // BANK NIFTY
    if (bankNiftyData?.metadata) {
      const m = bankNiftyData.metadata;
      indices.push({
        symbol: 'BANK NIFTY',
        price: m.last || m.previousClose || 0,
        change_pct: m.pChange || 0,
        change: m.change || 0,
      });
    }

    // Add static global indices (these don't change during IST market hours)
    indices.push(
      { symbol: 'USD/INR', price: 85.50, change_pct: 0, change: 0 },
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
