// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR HOLDINGS — BASE INDEX ENDPOINT (PATCH 1101zzz19)
//
// GET /api/v1/super-investor-holdings
//
// Returns the LIST of all super investors with their current freshness state.
// The per-investor detail endpoint is /api/v1/super-investor-holdings/[id].
//
// This base endpoint was previously absent — hitting the path 404'd. Now it
// returns a directory the UI / monitoring sweep can use to discover available
// investors without a hardcoded id list.
//
// Response shape:
//   {
//     count: number,
//     fetched_at: ISO,
//     investors: [
//       { id, name, style, tier, source: 'kv'|'static', fresh: boolean,
//         last_refreshed_at: ISO|null, holdings_count: number }
//     ]
//   }
//
// Auth: public read (parity with /[id] route).
// Cache: 5 min CDN.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { SUPER_INVESTORS } from '@/lib/super-investors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h — matches the /[id] route's window

export async function GET() {
  const fetchedAt = new Date().toISOString();
  const now = Date.now();
  const investors = await Promise.all(
    SUPER_INVESTORS.map(async (inv) => {
      let source: 'kv' | 'static' = 'static';
      let lastRefreshedAt: string | null = null;
      let holdingsCount = inv.holdings?.length || 0;
      try {
        const cached: any = await kvGet(`superinv:holdings:v1:${inv.id}`);
        if (cached && Array.isArray(cached.holdings)) {
          source = 'kv';
          lastRefreshedAt = String(cached.scrapedAt || '') || null;
          holdingsCount = cached.holdings.length;
        }
      } catch {}
      const refreshedMs = lastRefreshedAt ? Date.parse(lastRefreshedAt) : 0;
      const fresh = source === 'kv' && refreshedMs > 0 && now - refreshedMs < STALE_AFTER_MS;
      return {
        id: inv.id,
        name: inv.name,
        style: inv.style,
        tier: inv.tier,
        source,
        fresh,
        last_refreshed_at: lastRefreshedAt,
        holdings_count: holdingsCount,
      };
    })
  );

  return NextResponse.json(
    {
      count: investors.length,
      fetched_at: fetchedAt,
      stale_after_ms: STALE_AFTER_MS,
      investors,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
      },
    },
  );
}
