// zzz883 — the owner's personal data on the server (Postgres + a Redis mirror). PROTECTED (login cookie or service key):
// see lib/site-auth.ts. Only the browser keys listed in USER_STATE_KEYS are accepted.
//   GET  ?list=1          → versions and hashes of every saved key (cheap; the browser compares before it pulls)
//   GET  ?key=<k>         → one value
//   GET  ?history=<k>     → the saved versions of one key (newest first)
//   GET  ?export=1        → everything (the nightly backup job)
//   PUT  {key, value, baseVersion, device}
import { NextRequest, NextResponse } from 'next/server';
import { isUserStateKey, listUserState, getUserState, putUserState, userStateHistory, exportUserState, UserStateConflict } from '@/lib/user-state-store';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get('list') === '1') return NextResponse.json({ ok: true, ...(await listUserState()) }, { headers: noStore });
    if (sp.get('export') === '1') return NextResponse.json({ ok: true, ...(await exportUserState()) }, { headers: noStore });
    const h = sp.get('history');
    if (h) { if (!isUserStateKey(h)) return NextResponse.json({ ok: false, error: 'unknown key' }, { status: 400 }); return NextResponse.json({ ok: true, key: h, versions: await userStateHistory(h, Number(sp.get('limit') || 20)) }, { headers: noStore }); }
    const k = sp.get('key');
    if (!isUserStateKey(k)) return NextResponse.json({ ok: false, error: 'unknown key' }, { status: 400 });
    const row = await getUserState(k);
    return NextResponse.json({ ok: true, found: !!row, ...(row || { key: k }) }, { headers: noStore });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!isUserStateKey(body?.key)) return NextResponse.json({ ok: false, error: 'unknown key' }, { status: 400 });
  if (!('value' in (body || {}))) return NextResponse.json({ ok: false, error: 'value required' }, { status: 400 });
  if (body.baseVersion != null && (!Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0)) return NextResponse.json({ ok: false, error: 'invalid baseVersion' }, { status: 400 });
  try {
    const r = await putUserState(body.key, body.value, { baseVersion: body.baseVersion ?? null, device: body.device ?? null });
    return NextResponse.json(r, { headers: noStore });
  } catch (e: any) {
    if (e instanceof UserStateConflict) return NextResponse.json({ ok: false, conflict: true, version: e.version, hash: e.hash, error: e.message }, { status: 409, headers: noStore });
    const msg = String(e?.message || e).slice(0, 200);
    return NextResponse.json({ ok: false, error: msg }, { status: /too large/.test(msg) ? 413 : 500 });
  }
}
