// zzz1193 — GUIDANCE AI CHECK. GET = the stored results (no AI) and the state of a run; POST {mode, targets | names} starts a run in the
// background (≤ 12 companies, its own small daily ceiling) and returns at once; the page polls GET. Owner-only (lib/site-auth).
import { NextRequest, NextResponse } from 'next/server';
import { jobState, startJob } from '@/lib/ai-panel-job';
import { AI_CHECK_JOB, cleanTargets, parseNames, type AiCheckMode } from '@/lib/gu-ai-check';
import { loadAiCheck, runAiCheck, aiCheckDailyCapUsd, aiCheckDayKey } from '@/lib/gu-ai-check-server';
import { kvGet, kvSet } from '@/lib/kv';
import { checkRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const LAST_KEY = 'gu-ai-check:v1:last-run';

export async function GET() {
  const [store, job, last, spent] = await Promise.all([loadAiCheck(), jobState(AI_CHECK_JOB), kvGet<any>(LAST_KEY).catch(() => null), kvGet<number | string>(aiCheckDayKey()).catch(() => 0)]);
  return NextResponse.json({ ok: true, report: { results: Object.values(store?.results || {}), updatedAt: store?.updatedAt ?? null, last, spentToday: Number(spent) || 0, dailyCapUsd: aiCheckDailyCapUsd() }, job }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (!checkRateLimit(`gu-ai-check:${ip}`, 6, 60_000).allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  let body: any = null; try { body = await req.json(); } catch { /* none */ }
  const mode: AiCheckMode = body?.mode === 'evidence' ? 'evidence' : body?.mode === 'names' ? 'names' : 'new';
  const targets = mode === 'names' ? parseNames(String(body?.names || ''), body?.market === 'US' ? 'US' : 'IN') : cleanTargets(body?.targets);
  if (!targets.length) return NextResponse.json({ ok: false, error: mode === 'names' ? 'Type one or more company names or symbols.' : 'Nothing to check.' }, { status: 400, headers: NO_STORE });
  const job = await startJob(AI_CHECK_JOB, async () => {
    const r = await runAiCheck(targets, mode);
    await kvSet(LAST_KEY, { at: new Date().toISOString(), mode, asked: targets.length, checked: r.checked, added: r.added, spentUsd: r.spentUsd, stoppedBy: r.stoppedBy ?? null, error: r.error ?? null }, 30 * 86_400).catch(() => null);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  return NextResponse.json({ ok: true, job, asked: targets.length }, { status: 202, headers: NO_STORE });
}
