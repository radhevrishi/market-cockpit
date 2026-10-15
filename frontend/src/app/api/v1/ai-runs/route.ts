// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/ai-runs — the AI call records (Postgres ai_run, lib/ai-runs).  (zzz1050)
//
//   GET ?days=14&outcome=&job=&limit=200
//     → today's guidance-reading spend vs its daily ceiling, the stronger-model
//       sub-cap, this month's AI spend vs the monthly cap, schema failures,
//       runs per day, failure reasons grouped, model mix, jobs, slowest runs and
//       the latest runs (filterable by outcome / job).
//
// PROTECTED (lib/site-auth PROTECTED_API_PREFIXES) and re-checked here: the owner's cookie or a service key. Read-only; no AI is called.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { siteAuthOk } from '@/lib/site-auth-request';
import { checkRateLimit } from '@/lib/rateLimit';
import { readRunsView } from '@/lib/ai-runs';
import { kvGet } from '@/lib/kv';
import { guidanceDailyCapUsd, guidanceDayKey, escalationDayKey, escalateShare, strongModel } from '@/lib/ai-guidance-router';
import { readSpend, monthlyCapUsd, provider, activeModel } from '@/lib/anthropic-meter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  if (!(await siteAuthOk(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (!checkRateLimit(`ai-runs:get:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const sp = req.nextUrl.searchParams;
  const dayCap = guidanceDailyCapUsd();
  const prov = provider();
  const [view, dayUsd, escUsd, month] = await Promise.all([
    readRunsView({ days: Number(sp.get('days')) || 14, outcome: sp.get('outcome'), job: sp.get('job'), limit: Number(sp.get('limit')) || 200 })
      .catch((e: any) => ({ available: false, reason: `could not read the records: ${String(e?.message || e).slice(0, 160)}` } as any)),
    kvGet<number | string>(guidanceDayKey()).catch(() => null),
    kvGet<number | string>(escalationDayKey()).catch(() => null),
    readSpend().catch(() => null),
  ]);
  return NextResponse.json({
    ok: true,
    budget: {
      guidanceToday: { spentUsd: Number(dayUsd) || 0, capUsd: dayCap },
      escalationToday: { spentUsd: Number(escUsd) || 0, capUsd: Math.round(dayCap * escalateShare() * 1e6) / 1e6, model: strongModel(prov, activeModel('claude-haiku-4-5-20251001')) },
      month: month ? { month: month.month, spentUsd: month.total_usd, capUsd: monthlyCapUsd(), calls: month.calls, failed: month.failed || 0, schemaFailures: month.schema_failures || 0,
        schemaFailuresByJob: Object.fromEntries(Object.entries(month.by_feature).filter(([, f]) => f.schema_failures).map(([k, f]) => [k, f.schema_failures])) } : null,
      provider: prov, model: activeModel('claude-haiku-4-5-20251001'),
    },
    runs: view,
  }, { headers: NO_STORE });
}
