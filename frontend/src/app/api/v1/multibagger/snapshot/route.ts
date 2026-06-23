// PATCH 1101m — /api/v1/multibagger/snapshot (POSTGRES-BACKED)
//
// REWRITE of 1101l: Upstash KV was falling back to in-memory storage when
// env vars weren't set OR when payload > 8MB cap, defeating persistence.
// Now uses Railway Postgres directly via lib/db.ts pool — auto-creates
// table on first call, no env-var dependency beyond DATABASE_URL.
//
// Schema (auto-created idempotent):
//   mb_snapshots(client_id text PK, market text, snapshot_json text,
//                meta_json text, updated_at timestamptz default now())
//
// POST  { clientId, snapshot, count, market }   → upsert
// GET   ?clientId=xxx&market=IN                 → fetch
//
// No TTL — snapshots persist until explicitly cleared. ~3-5 MB JSON per
// 345-stock dataset, well within Postgres TEXT column limits.

import { NextResponse, NextRequest } from 'next/server';
import { dbQuery, dbAvailable } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024; // 12MB hard cap — generous

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS mb_snapshots (
      client_id text NOT NULL,
      market text NOT NULL DEFAULT 'IN',
      snapshot_json text NOT NULL,
      meta_json text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (client_id, market)
    )
  `);
  tableEnsured = true;
}

function isValidClientId(cid: unknown): cid is string {
  return typeof cid === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(cid);
}

function normalizeMarket(m: unknown): string {
  const v = typeof m === 'string' ? m.toUpperCase() : 'IN';
  return v === 'USA' || v === 'TURNAROUND' ? v : 'IN';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!dbAvailable()) {
      return NextResponse.json({ ok: false, error: 'database not configured (DATABASE_URL missing)' }, { status: 503 });
    }
    const body = await req.json().catch(() => ({}));
    const clientId = body?.clientId;
    const snapshot = body?.snapshot;
    const market = normalizeMarket(body?.market);
    const count = typeof body?.count === 'number' ? body.count : 0;
    if (!isValidClientId(clientId)) {
      return NextResponse.json({ ok: false, error: 'invalid clientId' }, { status: 400 });
    }
    if (typeof snapshot !== 'string' || !snapshot.length) {
      return NextResponse.json({ ok: false, error: 'snapshot required' }, { status: 400 });
    }
    const bytes = snapshot.length;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json({ ok: false, error: `snapshot too large (${(bytes / 1024 / 1024).toFixed(2)}MB > 12MB)` }, { status: 413 });
    }
    await ensureTable();
    const meta = JSON.stringify({ count, bytes, savedAt: new Date().toISOString() });
    await dbQuery(
      `INSERT INTO mb_snapshots (client_id, market, snapshot_json, meta_json, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (client_id, market)
       DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, meta_json = EXCLUDED.meta_json, updated_at = now()`,
      [clientId, market, snapshot, meta]
    );
    return NextResponse.json({ ok: true, bytes, market, savedAt: new Date().toISOString() });
  } catch (e: any) {
    // PATCH zzz65 — log server-side, never leak Postgres details (table names,
    // SQL fragments, connection strings) to client.
    console.error('[mb-snapshot POST] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    if (!dbAvailable()) {
      return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 });
    }
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    const market = normalizeMarket(url.searchParams.get('market'));
    if (!isValidClientId(clientId)) {
      return NextResponse.json({ ok: false, error: 'invalid clientId' }, { status: 400 });
    }
    await ensureTable();
    const rows = await dbQuery<{ snapshot_json: string; meta_json: string | null; updated_at: string }>(
      `SELECT snapshot_json, meta_json, updated_at FROM mb_snapshots WHERE client_id = $1 AND market = $2 LIMIT 1`,
      [clientId, market]
    );
    if (!rows.length) {
      return NextResponse.json({ ok: true, snapshot: null, meta: null });
    }
    const row = rows[0];
    let meta: any = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch {}
    return NextResponse.json({ ok: true, snapshot: row.snapshot_json, meta, updatedAt: row.updated_at });
  } catch (e: any) {
    // PATCH zzz65 — sanitize.
    console.error('[mb-snapshot GET] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    if (!dbAvailable()) {
      return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 });
    }
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    const market = normalizeMarket(url.searchParams.get('market'));
    if (!isValidClientId(clientId)) {
      return NextResponse.json({ ok: false, error: 'invalid clientId' }, { status: 400 });
    }
    await ensureTable();
    await dbQuery(`DELETE FROM mb_snapshots WHERE client_id = $1 AND market = $2`, [clientId, market]);
    return NextResponse.json({ ok: true, market });
  } catch (e: any) {
    // PATCH zzz65 — sanitize.
    console.error('[mb-snapshot DELETE] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 });
  }
}
