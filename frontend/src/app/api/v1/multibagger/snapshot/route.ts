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
import { snapshotEtag, etagMatches } from '@/lib/lean-view';

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
    // zzz230 — latest=1 recovery path. Browser storage eviction wipes the
    // client id together with the dataset, orphaning the server snapshot.
    // Single-user deployment: return the most recent snapshot for the market
    // and include its client_id so the browser can re-adopt it.
    const wantLatest = url.searchParams.get('latest') === '1';
    if (!isValidClientId(clientId) && !wantLatest) {
      return NextResponse.json({ ok: false, error: 'invalid clientId' }, { status: 400 });
    }
    await ensureTable();
    // zzz855 — lighter reads. A cheap metadata query (no snapshot_json, which is ~1 MB) runs first:
    //   ?view=meta  → returns { ok, snapshot: null, meta, updatedAt, clientId, view: 'meta' } so a caller can compare
    //                 meta.count with its local row count and fetch the full snapshot only when it actually needs it.
    //   default     → unchanged full response, now with an ETag (client + market + updated_at). The browser revalidates
    //                 every time (Cache-Control: private, no-cache — user data is never served stale) and gets a 304
    //                 with no body when the snapshot has not changed.
    const viewMeta = url.searchParams.get('view') === 'meta';
    type MetaRow = { client_id: string; meta_json: string | null; updated_at: string };
    const metaRows = isValidClientId(clientId)
      ? await dbQuery<MetaRow>(`SELECT client_id, meta_json, updated_at FROM mb_snapshots WHERE client_id = $1 AND market = $2 LIMIT 1`, [clientId, market])
      : await dbQuery<MetaRow>(`SELECT client_id, meta_json, updated_at FROM mb_snapshots WHERE market = $1 ORDER BY updated_at DESC LIMIT 1`, [market]);
    const noCache = { 'Cache-Control': 'private, no-cache' };
    if (!metaRows.length) {
      return NextResponse.json({ ok: true, snapshot: null, meta: null, ...(viewMeta ? { view: 'meta' } : {}) }, { headers: noCache });
    }
    const m0 = metaRows[0];
    let meta: any = null;
    try { meta = m0.meta_json ? JSON.parse(m0.meta_json) : null; } catch {}
    if (viewMeta) {
      return NextResponse.json({ ok: true, snapshot: null, meta, updatedAt: m0.updated_at, clientId: m0.client_id, view: 'meta' }, { headers: noCache });
    }
    const etag = snapshotEtag(m0.client_id, market, m0.updated_at);
    if (etagMatches(req.headers.get('if-none-match'), etag)) {
      return new NextResponse(null, { status: 304, headers: { ...noCache, ETag: etag } });
    }
    const rows = await dbQuery<{ client_id: string; snapshot_json: string; meta_json: string | null; updated_at: string }>(
      `SELECT client_id, snapshot_json, meta_json, updated_at FROM mb_snapshots WHERE client_id = $1 AND market = $2 LIMIT 1`,
      [m0.client_id, market]
    );
    if (!rows.length) {
      return NextResponse.json({ ok: true, snapshot: null, meta: null }, { headers: noCache });
    }
    const row = rows[0];
    meta = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch {}
    return NextResponse.json({ ok: true, snapshot: row.snapshot_json, meta, updatedAt: row.updated_at, clientId: row.client_id },
      { headers: { ...noCache, ETag: snapshotEtag(row.client_id, market, row.updated_at) } });
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
