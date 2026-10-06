// zzz914 — /api/v1/cron/conviction-catalyst-brief: composes and sends the morning Conviction Catalyst brief (the owner's
// conviction list, ranked catalyst first, with the TradingView import block).
// Run by the app scheduler (lib/app-scheduler.ts, job "conviction-catalyst-brief"); hand run: owner-briefs.yml workflow.
// Auth: CRON_SECRET in the x-cron-secret header (fail closed). Sends once per day (owner-notify send-once key).
//   ?dry=1    compose only — returns the brief in the response, sends nothing, changes no state
//   ?force=1  send again even if today's brief already went out
//   ?ai=0     no AI call (rule-based catalyst lines only)
// The response and the log carry counts only (no tickers) unless dry=1.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { runConvictionBrief } from '@/lib/owner-briefs/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(req: Request) {
  const auth = verifyCronSecret(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const out = await runConvictionBrief({ dry: sp.get('dry') === '1', force: sp.get('force') === '1', ai: sp.get('ai') !== '0' });
    console.log(`[conviction-catalyst-brief] ok=${out.ok} oneLine=${out.oneLine} partial=${!!out.partial} counts=${JSON.stringify(out.counts)}`);
    return NextResponse.json(out, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
// zzz664: accept GET too, so a hand run from a browser never gets a 405
export async function GET(req: Request) { return POST(req); }
