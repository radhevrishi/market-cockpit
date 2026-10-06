// zzz914 — /api/v1/cron/portfolio-thesis-watch: composes and sends the weekday-morning Portfolio Thesis Watch (India
// holdings: thesis drift new since the last run, the owner's written invalidation triggers checked). No AI, no price.
// Run by the app scheduler (lib/app-scheduler.ts, job "portfolio-thesis-watch"); hand run: owner-briefs.yml workflow.
// Auth: CRON_SECRET in the x-cron-secret header (fail closed). Sends once per day (owner-notify send-once key).
//   ?dry=1    compose only — returns the brief in the response, sends nothing, changes no state
//   ?force=1  send again even if today's brief already went out
// The response and the log carry counts only (no holdings) unless dry=1.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { runThesisWatch } from '@/lib/owner-briefs/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(req: Request) {
  const auth = verifyCronSecret(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const out = await runThesisWatch({ dry: sp.get('dry') === '1', force: sp.get('force') === '1' });
    console.log(`[portfolio-thesis-watch] ok=${out.ok} oneLine=${out.oneLine} partial=${!!out.partial} counts=${JSON.stringify(out.counts)}`);
    return NextResponse.json(out, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
// zzz664: accept GET too, so a hand run from a browser never gets a 405
export async function GET(req: Request) { return POST(req); }
