// PATCH 0319 — Theme revisions snapshot log.
//
// Bottleneck themes (Defence, Memory_Storage, AI_Infra, etc.) carry
// editorial metadata (label, description, severity_label, key_tickers).
// When that metadata changes — a theme gets renamed, severity is
// upgraded/downgraded, key tickers added/removed — we want a diff log
// so users can answer "what changed about this theme over the last
// month?"
//
// API:
//   POST /api/v1/themes/revisions/<bucket_id>  — body: { snapshot }
//       Stores the current snapshot; computes diff vs previous
//       snapshot; appends a Revision entry.
//   GET  /api/v1/themes/revisions/<bucket_id>  — returns the list of
//       revisions, newest first.
//   DELETE                                      — admin reset (secret).
//
// Storage: KV `themes-revisions:v1:<bucket_id>` — array of revision
// records, capped at 50 entries, 365-day TTL.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

interface ThemeSnapshot {
  bucket_id: string;
  label?: string;
  description?: string;
  severity?: number;
  severity_label?: string;
  key_tickers?: string[];
  signal_count?: number;
  article_count?: number;
}

interface RevisionEntry {
  ts: number;
  snapshot: ThemeSnapshot;
  diff?: Partial<Record<keyof ThemeSnapshot, { from: any; to: any }>>;
  // ticker-level deltas (added / removed) when key_tickers changed
  tickers_added?: string[];
  tickers_removed?: string[];
  /** Optional change-reason note from the caller. */
  note?: string;
}

const KEY = (id: string) => `themes-revisions:v1:${id}`;
const MAX_REVISIONS = 50;
const TTL_SECONDS = 365 * 24 * 60 * 60;

function shallowDiff(prev: ThemeSnapshot, curr: ThemeSnapshot): {
  diff: Partial<Record<keyof ThemeSnapshot, { from: any; to: any }>>;
  added: string[];
  removed: string[];
} {
  const diff: Partial<Record<keyof ThemeSnapshot, { from: any; to: any }>> = {};
  for (const k of Object.keys(curr) as Array<keyof ThemeSnapshot>) {
    if (k === 'key_tickers') continue; // handled separately below
    const a = (prev as any)[k];
    const b = (curr as any)[k];
    if (a !== b) diff[k] = { from: a, to: b };
  }
  const prevTickers = new Set((prev.key_tickers || []).map(t => t.toUpperCase()));
  const currTickers = new Set((curr.key_tickers || []).map(t => t.toUpperCase()));
  const added: string[] = [];
  const removed: string[] = [];
  currTickers.forEach(t => { if (!prevTickers.has(t)) added.push(t); });
  prevTickers.forEach(t => { if (!currTickers.has(t)) removed.push(t); });
  return { diff, added, removed };
}

function requireSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  return req.nextUrl.searchParams.get('secret') === expected;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ bucket_id: string }> }) {
  const { bucket_id } = await params;
  if (!bucket_id) return NextResponse.json({ error: 'bucket_id required' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ revisions: [], count: 0 });
  const revisions = (await kvGet<RevisionEntry[]>(KEY(bucket_id))) || [];
  return NextResponse.json({
    bucket_id,
    revisions: [...revisions].reverse(), // newest first for display
    count: revisions.length,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ bucket_id: string }> }) {
  const { bucket_id } = await params;
  if (!bucket_id) return NextResponse.json({ error: 'bucket_id required' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const snapshot: ThemeSnapshot = {
    bucket_id,
    label: body?.snapshot?.label ?? body?.label,
    description: body?.snapshot?.description ?? body?.description,
    severity: typeof body?.snapshot?.severity === 'number' ? body.snapshot.severity : (typeof body?.severity === 'number' ? body.severity : undefined),
    severity_label: body?.snapshot?.severity_label ?? body?.severity_label,
    key_tickers: Array.isArray(body?.snapshot?.key_tickers) ? body.snapshot.key_tickers : (Array.isArray(body?.key_tickers) ? body.key_tickers : undefined),
    signal_count: body?.snapshot?.signal_count ?? body?.signal_count,
    article_count: body?.snapshot?.article_count ?? body?.article_count,
  };
  const note = typeof body?.note === 'string' ? body.note.slice(0, 200) : undefined;

  const existing = (await kvGet<RevisionEntry[]>(KEY(bucket_id))) || [];
  const ts = Date.now();
  const prev = existing.length > 0 ? existing[existing.length - 1].snapshot : null;

  let diff: RevisionEntry['diff'] | undefined;
  let added: string[] | undefined;
  let removed: string[] | undefined;
  if (prev) {
    const result = shallowDiff(prev, snapshot);
    diff = result.diff;
    added = result.added.length > 0 ? result.added : undefined;
    removed = result.removed.length > 0 ? result.removed : undefined;
    // No-op when nothing actually changed.
    if (Object.keys(diff).length === 0 && !added && !removed) {
      return NextResponse.json({ ok: true, noop: true, note: 'snapshot unchanged' });
    }
  }

  const entry: RevisionEntry = { ts, snapshot, diff, tickers_added: added, tickers_removed: removed, note };
  const next = [...existing, entry].slice(-MAX_REVISIONS);
  await kvSet(KEY(bucket_id), next, TTL_SECONDS);
  return NextResponse.json({ ok: true, stored: next.length, entry });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ bucket_id: string }> }) {
  if (!requireSecret(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { bucket_id } = await params;
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });
  await kvSet(KEY(bucket_id), [], 1);
  return NextResponse.json({ ok: true, cleared: bucket_id });
}
