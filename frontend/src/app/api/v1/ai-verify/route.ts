// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/ai-verify — the AI verification queue.                     (zzz854)
//
//   GET   status + queue: provider, availability (key set? cap reached?),
//         last run, queue length and the first `limit` queued claims.
//   POST  run one batch (?limit=N, default AI_VERIFY_RUN_MAX_CLAIMS = 40;
//         ?maxUsd=, default AI_VERIFY_RUN_MAX_USD = 0.60; ?budgetMs=): first
//         look up the company document of queued claims that carry none
//         (exchange announcements / EDGAR by CIK), then read the primary
//         document of each claim (Tier 1 → Tier 2 → Watchlist, newest first),
//         ask the model, check the answer, cache the verdict. The run stops
//         starting claims in time to answer inside the request limit and
//         continues on the next run. Called hourly by
//         .github/workflows/ai-verify.yml (which repeats while a run stopped
//         on time). The monthly AI cap still binds.
//
// PROTECTED (lib/site-auth PROTECTED_API_PREFIXES): the owner's cookie or a
// service key (x-cron-secret / x-mc-key header) is required — middleware
// enforces it; POST re-checks here (paid AI must never be reachable
// anonymously, even if the middleware matcher changes). Rate-limited.
// Responses and logs carry counts and ≤200-char quotes only: never a key,
// never document text.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from '@/lib/site-auth';
import { readQueue, readStatus, realAvailability, realDeps, realKv, runVerification, runMaxClaims, runMaxUsd, runBudgetMs, runConcurrency, gateMode, redact, nextCronRun, AI_VERIFY_SCHEDULE, priorityOf } from '@/lib/ai-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };

async function authorised(req: NextRequest): Promise<boolean> {
  if (hasServiceKey(req.headers.get('x-cron-secret')) || hasServiceKey(req.headers.get('x-mc-key'))) return true;
  const want = await expectedToken();
  const got = req.cookies.get(SITE_COOKIE)?.value || '';
  return !!want && !!got && safeEqual(want, got);
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anon';
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(`ai-verify:get:${clientIp(req)}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const limit = Math.max(0, Math.min(200, Number(new URL(req.url).searchParams.get('limit')) || 50));
  const kv = realKv();
  const [q, status, av] = await Promise.all([readQueue(kv), readStatus(kv), realAvailability().catch(() => ({ available: false, reason: 'availability check failed', provider: 'unknown', model: null }))]);
  const byKind: Record<string, number> = {}; const byPriority: Record<string, number> = {}; const byHow: Record<string, number> = {};
  let withPrimary = 0; let toLocate = 0; let noDocument = 0;
  for (const it of q.items) {
    byKind[it.claim.kind] = (byKind[it.claim.kind] || 0) + 1;
    const p = String(priorityOf(it.claim)); byPriority[p] = (byPriority[p] || 0) + 1;
    if (it.claim.primaryUrl) { withPrimary++; const h = it.claim.primaryHow || 'unknown'; byHow[h] = (byHow[h] || 0) + 1; }
    else if (it.claim.locateHints) toLocate++;
    else noDocument++;
  }
  const next = nextCronRun(AI_VERIFY_SCHEDULE, new Date());
  return NextResponse.json({
    ok: true,
    verification: { provider: av.provider, model: av.model, available: av.available, unavailableReason: av.reason, mode: gateMode(), lastRunAt: status.lastRunAt, nextRunEta: next ? next.toISOString() : null, schedule: AI_VERIFY_SCHEDULE },
    lastRun: status.lastRun,
    runDefaults: { claims: runMaxClaims(), maxUsd: runMaxUsd(), budgetMs: runBudgetMs(), concurrency: runConcurrency() },
    queue: {
      length: q.items.length, withPrimaryDocument: withPrimary, toLocate, noDocument, byHow, byKind, byPriority, updatedAt: q.updatedAt,
      items: q.items.slice(0, limit).map((x) => ({ claimId: x.claim.claimId, kind: x.claim.kind, market: x.claim.market, company: x.claim.company, ticker: x.claim.ticker, claimText: x.claim.claimText, primaryUrl: x.claim.primaryUrl, primaryHow: x.claim.primaryHow ?? null, priority: x.priority, eventDate: x.claim.eventDate ?? null, addedAt: x.addedAt })),
    },
  }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  // paid AI: at most 4 runs a minute per caller (the cron runs hourly, repeating up to 4 rounds while a run stopped on time)
  const rl = checkRateLimit(`ai-verify:post:${clientIp(req)}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(100, Number(sp.get('limit')) || runMaxClaims()));
  // per-run spend: at most $2 whatever is asked (the monthly cap binds on top)
  const maxUsd = Math.max(0.01, Math.min(2, Number(sp.get('maxUsd')) || runMaxUsd()));
  const budgetMs = Math.max(10_000, Math.min(55_000, Number(sp.get('budgetMs')) || runBudgetMs()));
  try {
    const run = await runVerification(realDeps(), { limit, maxUsd, budgetMs, concurrency: runConcurrency() });
    // 'unavailable' / 'cap' are honest answers (200 with available:false), not server errors
    return NextResponse.json({ ok: true, run }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[ai-verify] run failed:', redact(e?.message || e));
    return NextResponse.json({ ok: false, error: 'verification run failed' }, { status: 500, headers: NO_STORE });
  }
}
