// zzz938 — builds the stock screener snapshot (USA now; India added in the next step). Run by the app scheduler once a day,
// or by hand: POST /api/v1/cron/build-screener?market=US with the x-cron-secret header. Free sources only, no AI.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { buildUsSnapshot } from '@/lib/screener/us-build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

let running = false;
export async function POST(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.reason.includes('not configured') ? 503 : 401 });
  const market = new URL(req.url).searchParams.get('market') || 'US';
  if (market !== 'US') return NextResponse.json({ ok: false, error: 'market must be US (India comes next)' }, { status: 400 });
  if (running) return NextResponse.json({ ok: true, skipped: 'a build is already running' });
  running = true;
  try {
    const r = await buildUsSnapshot();
    return NextResponse.json(r, { status: r.ok ? 200 : 503 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 });
  } finally { running = false; }
}
export async function GET(req: Request) { return POST(req); }
