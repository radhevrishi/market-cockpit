// zzz790 — US Special Focus memory. Same contract as /api/v1/special-focus,
// separate KV key (`us-persist:v1:all`). Personal research state: protected
// by the site login (lib/site-auth '/api/v1/us-thesis'). No price read or stored.
// zzz793 — one company per record: a record whose evidence names another
// company's SEC filings is neither written nor returned (catalystIsolated).
import { NextRequest, NextResponse } from 'next/server';
import { focusStatus, type UserFocusState } from '@/lib/catalyst/persistence-store';
import { tickerToCik } from '@/lib/us-edgar';
import { loadUsPersist, upsertUsDetections, setUsUserState, isolatedUsBlob } from '@/lib/us-thesis/special-focus-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const USER_STATES: UserFocusState[] = ['confirmed', 'watch', 'dismissed', 'archived', 'reviewed'];

function payload(blob: Awaited<ReturnType<typeof loadUsPersist>>) {
  const records = Object.values(blob.records).map((r) => ({ ...r, focus: focusStatus(r) }));
  return { ok: true, count: records.length, inQueue: records.filter((r) => r.focus.inQueue).length, records };
}

/** The SEC CIK of every ticker named, so evidence can be checked against it. */
async function ciksFor(tickers: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const t of Array.from(new Set(tickers.map((x) => String(x).toUpperCase()))).slice(0, 400)) {
    out[t] = await tickerToCik(t).catch(() => null);
  }
  return out;
}

export async function GET() {
  const blob = await loadUsPersist();
  const ciks = await ciksFor(Object.values(blob.records).map((r) => r.ticker)).catch(() => ({}));
  return NextResponse.json(payload(isolatedUsBlob(blob, ciks)), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (body?.action === 'upsert') {
    const list = Array.isArray(body.catalysts) ? body.catalysts.filter((c: any) => c && typeof c.id === 'string' && typeof c.ticker === 'string' && typeof c.kind === 'string').slice(0, 400) : [];
    const ciks = await ciksFor(list.map((c: any) => c.ticker)).catch(() => ({}));
    const { changed, blob } = await upsertUsDetections(list, ciks);
    return NextResponse.json({ ...payload(blob), changed });
  }
  if (body?.action === 'user') {
    const id = String(body.id || '');
    const state = body.state == null ? null : USER_STATES.includes(body.state) ? (body.state as UserFocusState) : undefined;
    if (!id || state === undefined) return NextResponse.json({ ok: false, error: 'id and a valid state are required' }, { status: 400 });
    const rec = await setUsUserState(id, state, body.note ?? null);
    if (!rec) return NextResponse.json({ ok: false, error: 'unknown catalyst id' }, { status: 404 });
    return NextResponse.json({ ok: true, record: { ...rec, focus: focusStatus(rec) } });
  }
  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
