// zzz1178 — GET the last Future 100-baggers run (no AI) and the state of a run in progress; POST starts the AI run in the
// background (zzz1181 — returns at once; the page polls GET). ≤ 6 runs a day.
import { NextResponse } from 'next/server';
import { loadHb, runHb } from '@/lib/hundred-baggers/run';
import { jobState, startJob } from '@/lib/ai-panel-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const KEY = 'hundred-baggers';

export async function GET() {
  const [report, job] = await Promise.all([loadHb().catch(() => null), jobState(KEY)]);
  return NextResponse.json({ ok: true, report, job }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST() {
  const job = await startJob(KEY, async () => { const r = await runHb(); return r.ok ? { ok: true } : { ok: false, error: r.error }; });
  return NextResponse.json({ ok: true, job }, { status: 202 });
}
