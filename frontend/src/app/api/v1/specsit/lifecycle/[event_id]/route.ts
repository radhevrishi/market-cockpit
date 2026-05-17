// PATCH 0320 — Special Situations lifecycle state machine API.
//
// GET    /api/v1/specsit/lifecycle/<event_id>          → returns current record
// POST   /api/v1/specsit/lifecycle/<event_id>          → body {to, source?, note?}
//                                                       applies transition
// DELETE /api/v1/specsit/lifecycle/<event_id>          → removes record (admin)
//
// Backed by Upstash KV: key `specsit-lifecycle:v1:<event_id>`.
// 90-day TTL; refreshed on every transition.

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import {
  LifecycleRecord, LifecycleState, LIFECYCLE_CONFIG,
  applyTransition, newRecord, daysInCurrentState, isStalled,
} from '@/lib/special-sit-lifecycle';

const KEY = (id: string) => `specsit-lifecycle:v1:${id}`;
const TTL_SECONDS = 90 * 24 * 60 * 60;

function isAdmin(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev fallback
  return req.nextUrl.searchParams.get('secret') === expected;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ event_id: string }> }) {
  const { event_id } = await params;
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });
  const rec = await kvGet<LifecycleRecord>(KEY(event_id));
  if (!rec) return NextResponse.json({ event_id, exists: false });
  return NextResponse.json({
    exists: true,
    record: rec,
    derived: {
      days_in_current_state: daysInCurrentState(rec),
      stalled: isStalled(rec),
      current_state_config: LIFECYCLE_CONFIG[rec.current_state],
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ event_id: string }> }) {
  // PATCH 0462 — same-origin Referer OR secret gate. Previously this was
  // unauthenticated, so any external caller could flip lifecycle state on
  // any event, poisoning shared KV.
  const secret = req.nextUrl.searchParams.get('secret');
  const expected = process.env.CRON_SECRET;
  const ref = req.headers.get('referer') || '';
  const origin = req.nextUrl.origin;
  const okSecret = expected && secret === expected;
  const okRef = ref && ref.startsWith(origin);
  if (!okSecret && !okRef) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { event_id } = await params;
  if (!event_id) return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const to = body?.to as LifecycleState;
  if (!to || !LIFECYCLE_CONFIG[to]) {
    return NextResponse.json({ error: `invalid to-state. Must be one of: ${Object.keys(LIFECYCLE_CONFIG).join(', ')}` }, { status: 400 });
  }
  const source = typeof body?.source === 'string' ? body.source.slice(0, 100) : undefined;
  const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : undefined;

  let rec = await kvGet<LifecycleRecord>(KEY(event_id));
  if (!rec) {
    // First-time observation — create at the supplied state.
    rec = newRecord(event_id, to, body?.meta);
    await kvSet(KEY(event_id), rec, TTL_SECONDS);
    return NextResponse.json({ ok: true, created: true, record: rec });
  }

  const next = applyTransition(rec, to, source, note);
  if (!next) {
    return NextResponse.json({
      ok: false,
      error: `illegal transition: ${rec.current_state} → ${to}. Allowed: ${LIFECYCLE_CONFIG[rec.current_state].next.join(', ') || 'terminal'}`,
    }, { status: 400 });
  }
  await kvSet(KEY(event_id), next, TTL_SECONDS);
  return NextResponse.json({ ok: true, transitioned: `${rec.current_state} → ${to}`, record: next });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ event_id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { event_id } = await params;
  if (!isRedisAvailable()) return NextResponse.json({ error: 'kv-unavailable' }, { status: 503 });
  // KV doesn't have a direct delete in our wrapper; we set undefined w/ 1s TTL.
  await kvSet(KEY(event_id), null, 1);
  return NextResponse.json({ ok: true, deleted: event_id });
}
