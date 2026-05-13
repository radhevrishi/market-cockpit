// PATCH 0308 — Public source-tier resolver.
//
// GET /api/v1/source-tier?source=<name>&url=<url>
//
// Returns the tier for a given source. Checks KV overrides first
// (curated by editors via /api/v1/admin/source-tiers), then falls
// back to the hardcoded heuristic in lib/source-tiers.ts.
//
// This is the endpoint that NewsCard and related surfaces should call
// when they want an authoritative tier (and not just the heuristic).
// The existing lib/source-tiers.ts:classifySource() remains as the
// pure client-side default for synchronous render paths.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, isRedisAvailable } from '@/lib/kv';
import { classifySource } from '@/lib/source-tiers';

type SourceTier = 'PRIMARY' | 'SPECIALIST' | 'SECONDARY' | 'AGGREGATOR';

interface Override {
  tier: SourceTier;
  note?: string;
  ts: number;
}
type Overrides = Record<string, Override>;

const KV_KEY = 'source-tiers:overrides:v1';

function extractDomain(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source') || '';
  const url = req.nextUrl.searchParams.get('url') || '';
  if (!source && !url) {
    return NextResponse.json({ error: 'pass ?source=… and/or ?url=…' }, { status: 400 });
  }

  let tier: SourceTier;
  let resolvedFrom: 'KV_OVERRIDE' | 'HEURISTIC' = 'HEURISTIC';
  let note: string | undefined;

  const domain = extractDomain(url);
  if (isRedisAvailable() && domain) {
    const overrides = (await kvGet<Overrides>(KV_KEY)) || {};
    if (overrides[domain]) {
      tier = overrides[domain].tier;
      note = overrides[domain].note;
      resolvedFrom = 'KV_OVERRIDE';
      return NextResponse.json({ tier, source, url, domain, resolvedFrom, note });
    }
  }

  tier = classifySource(source, url) as SourceTier;
  return NextResponse.json({ tier, source, url, domain, resolvedFrom });
}
