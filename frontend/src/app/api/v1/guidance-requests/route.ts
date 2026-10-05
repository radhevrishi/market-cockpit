// zzz865 — the owner's "read these companies first" list. GET = the list, POST {names:[...]} = add. Company names only. Owner-protected (see site-auth).
import { NextRequest, NextResponse } from 'next/server';
import { addRequested, readRequested, cleanRequestedNames, readWatch, writeWatch, withRequested, emptyWatch } from '@/lib/guidance-watch';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json({ ok: true, names: await readRequested() }, { headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(req: NextRequest) {
  let body: any = null; try { body = await req.json(); } catch { /* not JSON */ }
  const names = cleanRequestedNames(body?.names);
  if (!names.length) return NextResponse.json({ ok: false, error: 'No valid company names were sent.' }, { status: 400 });
  const all = await addRequested(names);
  if (!all) return NextResponse.json({ ok: false, error: 'The list could not be saved right now. Please try again.' }, { status: 503 });
  // the watch set is also updated now, so the next filing scan already reads these companies first
  try { await writeWatch(withRequested((await readWatch()) ?? emptyWatch(), all)); } catch { /* the next universe build writes it */ }
  return NextResponse.json({ ok: true, added: names.length, total: all.length }, { headers: { 'Cache-Control': 'no-store' } });
}
