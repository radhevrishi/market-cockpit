// PATCH 0308 — KV-backed source-tier override table.
//
// GET  /api/v1/admin/source-tiers       — list all overrides
// POST /api/v1/admin/source-tiers       — body: { domain, tier, note? }
// DELETE /api/v1/admin/source-tiers     — body: { domain }
//
// The hardcoded heuristic in lib/source-tiers.ts is the FALLBACK. Any
// domain present in this KV table OVERRIDES the heuristic. This lets
// editors curate the source tier list without redeploying.
//
// Storage shape (KV key `source-tiers:overrides:v1`):
//   Record<domain, { tier: SourceTier; note?: string; ts: number }>
//
// Auth: until real Auth lands, this endpoint requires a shared secret
// passed as the `?secret=` query param (matches the same env var used
// by /api/v1/cron/* routes).

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

type SourceTier = 'PRIMARY' | 'SPECIALIST' | 'SECONDARY' | 'AGGREGATOR';
const VALID_TIERS = new Set<SourceTier>(['PRIMARY', 'SPECIALIST', 'SECONDARY', 'AGGREGATOR']);

const KV_KEY = 'source-tiers:overrides:v1';

interface Override {
  tier: SourceTier;
  note?: string;
  ts: number;
}
type Overrides = Record<string, Override>;

function requireSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // no secret configured — open in dev
  return req.nextUrl.searchParams.get('secret') === expected;
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireSecret(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const overrides = (await kvGet<Overrides>(KV_KEY)) || {};
  return NextResponse.json({ overrides, count: Object.keys(overrides).length });
}

export async function POST(req: NextRequest) {
  if (!requireSecret(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const domain = typeof body?.domain === 'string' ? normalizeDomain(body.domain) : '';
  const tier = body?.tier as SourceTier;
  if (!domain) return NextResponse.json({ error: 'missing domain' }, { status: 400 });
  if (!VALID_TIERS.has(tier)) return NextResponse.json({ error: 'invalid tier — must be PRIMARY/SPECIALIST/SECONDARY/AGGREGATOR' }, { status: 400 });

  const current = (await kvGet<Overrides>(KV_KEY)) || {};
  current[domain] = {
    tier,
    note: typeof body?.note === 'string' ? body.note.slice(0, 200) : undefined,
    ts: Date.now(),
  };
  await kvSet(KV_KEY, current);
  return NextResponse.json({ ok: true, domain, tier, count: Object.keys(current).length });
}

export async function DELETE(req: NextRequest) {
  if (!requireSecret(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const domain = typeof body?.domain === 'string' ? normalizeDomain(body.domain) : '';
  if (!domain) return NextResponse.json({ error: 'missing domain' }, { status: 400 });

  const current = (await kvGet<Overrides>(KV_KEY)) || {};
  if (!current[domain]) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  delete current[domain];
  await kvSet(KV_KEY, current);
  return NextResponse.json({ ok: true, domain, count: Object.keys(current).length });
}
