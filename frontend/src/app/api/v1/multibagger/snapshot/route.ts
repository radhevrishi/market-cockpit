// PATCH 1101l — /api/v1/multibagger/snapshot
//
// Server-side persistence layer for the India Multibagger scored dataset.
// localStorage gets evicted at the 5MB quota; IndexedDB gets evicted under
// browser-wide storage pressure (especially Safari, Chrome under heavy use).
// This route stores the scored JSON in Upstash Redis keyed by an anonymous
// client UUID the client generates on first visit and stores in localStorage.
//
// POST  { clientId: string, snapshot: string }   → save (snapshot can be ~5MB)
// GET   ?clientId=xxx                            → fetch
//
// 30-day TTL means stale clients age out automatically. Each save bumps TTL.

import { NextResponse, NextRequest } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ROW_KEY = (cid: string) => `mb-snapshot:${cid}`;
const META_KEY = (cid: string) => `mb-snapshot-meta:${cid}`;
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Hard cap. Upstash supports up to 1MB per value on free tier, 10MB on paid.
// A 345-stock scored JSON is typically 1.5–3 MB. We cap at 8 MB to be safe.
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

interface SnapshotMeta {
  count: number;
  bytes: number;
  savedAt: string;
  market?: string;
}

function isValidClientId(cid: unknown): cid is string {
  return typeof cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(cid);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = body?.clientId;
    const snapshot = body?.snapshot;
    const market = typeof body?.market === 'string' ? body.market : 'IN';
    const count = typeof body?.count === 'number' ? body.count : 0;
    if (!isValidClientId(clientId)) {
      return NextResponse.json({ ok: false, error: 'invalid clientId' }, { status: 400 });
    }
    if (typeof snapshot !== 'string' || !snapshot.length) {
      return NextResponse.json({ ok: false, error: 'snapshot required' }, { status: 400 });
    }
    const bytes = snapshot.length;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json({ ok: false, error: `snapshot too large (${(bytes / 1024 / 1024).toFixed(2)}MB > 8MB)` }, { status: 413 });
    }
    const key = market === 'USA' ? `mb-snapshot-usa:${clientId}` : ROW_KEY(clientId);
    await kvSet(key, snapshot, TTL_SECONDS);
    const meta: SnapshotMeta = {
      count,
      bytes,
      savedAt: new Date().toISOString(),
      market,
    };
    await kvSet(META_KEY(clientId) + (market === 'USA' ? ':usa' : ''), JSON.stringify(meta), TTL_SECONDS);
    return NextResponse.json({ ok: true, bytes, savedAt: meta.savedAt });
  } catch (e: any) {
    console.error('[mb-snapshot POST] error', e);
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    const market = url.searchParams.get('market') || 'IN';
    if (!isValidClientId(clientId)) {
      return NextResponse.json({ ok: false, error: 'invalid clientId' }, { status: 400 });
    }
    const key = market === 'USA' ? `mb-snapshot-usa:${clientId}` : ROW_KEY(clientId);
    const snapshot = await kvGet<string>(key);
    if (!snapshot) {
      return NextResponse.json({ ok: true, snapshot: null, meta: null });
    }
    const metaRaw = await kvGet<string>(META_KEY(clientId) + (market === 'USA' ? ':usa' : ''));
    let meta: SnapshotMeta | null = null;
    if (metaRaw) {
      try { meta = JSON.parse(metaRaw); } catch {}
    }
    return NextResponse.json({ ok: true, snapshot, meta });
  } catch (e: any) {
    console.error('[mb-snapshot GET] error', e);
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}
