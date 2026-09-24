// zzz780 — Special Focus / persistent catalyst memory.
//
// GET                                   → every stored record + its queue status
// POST { action: 'upsert', origin, catalysts }   → merge detections (portfolio page)
// POST { action: 'user', id, state, note? }      → confirm / watch / dismiss / archive / reviewed (null clears)
//
// Personal research state: protected by the site login (lib/site-auth).
// No price is read or stored here, and nothing here is a recommendation.
import { NextRequest, NextResponse } from 'next/server';
import { loadPersist, upsertDetections, setUserState, focusStatus, type UserFocusState } from '@/lib/catalyst/persistence-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const USER_STATES: UserFocusState[] = ['confirmed', 'watch', 'dismissed', 'archived', 'reviewed'];

function payload(blob: Awaited<ReturnType<typeof loadPersist>>) {
  const records = Object.values(blob.records).map((r) => ({ ...r, focus: focusStatus(r) }));
  return { ok: true, count: records.length, inQueue: records.filter((r) => r.focus.inQueue).length, records };
}

export async function GET() {
  const blob = await loadPersist();
  return NextResponse.json(payload(blob), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (body?.action === 'upsert') {
    const origin = body.origin === 'gainers' ? 'gainers' : 'portfolio';
    const list = Array.isArray(body.catalysts) ? body.catalysts.filter((c: any) => c && typeof c.id === 'string' && typeof c.ticker === 'string' && typeof c.kind === 'string').slice(0, 400) : [];
    const { changed, blob } = await upsertDetections(list, origin);
    return NextResponse.json({ ...payload(blob), changed });
  }
  if (body?.action === 'user') {
    const id = String(body.id || '');
    const state = body.state == null ? null : USER_STATES.includes(body.state) ? (body.state as UserFocusState) : undefined;
    if (!id || state === undefined) return NextResponse.json({ ok: false, error: 'id and a valid state are required' }, { status: 400 });
    const rec = await setUserState(id, state, body.note ?? null);
    if (!rec) return NextResponse.json({ ok: false, error: 'unknown catalyst id' }, { status: 404 });
    return NextResponse.json({ ok: true, record: { ...rec, focus: focusStatus(rec) } });
  }
  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
