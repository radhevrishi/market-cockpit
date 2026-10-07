// zzz938/939 — builds the stock screener snapshot (market=US daily, market=IN hourly — India reads company pages a slice at a time). Run by the app scheduler once a day,
// or by hand: POST /api/v1/cron/build-screener?market=US with the x-cron-secret header. Free sources only, no AI.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { runBuild, isBuilding } from '@/lib/screener/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.reason.includes('not configured') ? 503 : 401 });
  const m = new URL(req.url).searchParams.get('market') || 'US';
  if (m !== 'US' && m !== 'IN') return NextResponse.json({ ok: false, error: 'market must be US or IN' }, { status: 400 });
  const market: 'US' | 'IN' = m;
  if (isBuilding(market)) return NextResponse.json({ ok: true, skipped: 'a build is already running' });
  try {
    const r = await runBuild(market);
    return NextResponse.json(r, { status: r.ok ? 200 : 503 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 });
  }
}
export async function GET(req: Request) { return POST(req); }
