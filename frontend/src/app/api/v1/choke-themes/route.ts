// zzz1174 — GET the last Choke-Point Themes run (no AI) and the state of a run in progress; POST starts the AI run in the
// background (zzz1181 — it returns at once; the page polls GET until the run is done). ≤ 6 runs a day.
import { NextResponse } from 'next/server';
import { loadChoke, runChoke } from '@/lib/choke-themes/run';
import { jobState, startJob } from '@/lib/ai-panel-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const KEY = 'choke-themes';

export async function GET() {
  const [report, job] = await Promise.all([loadChoke().catch(() => null), jobState(KEY)]);
  return NextResponse.json({ ok: true, report, job }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST() {
  const job = await startJob(KEY, async () => { const r = await runChoke(); return r.ok ? { ok: true } : { ok: false, error: r.error }; });
  return NextResponse.json({ ok: true, job }, { status: 202 });
}
