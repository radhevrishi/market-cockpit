// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/guidance-extract — the AI guidance extractor.               (zzz857)
//
//   GET   status: provider, availability (key set? cap reached?), last run,
//         schedule + next run, run defaults, number of documents with a
//         result. ?docId=<id> also returns that document's result (rows with
//         ≤300-char quotes).
//   POST  run one batch (?limit=N, default GUIDANCE_EXTRACT_RUN_MAX_DOCS = 25;
//         ?maxUsd=, default GUIDANCE_EXTRACT_RUN_MAX_USD = 0.60; ?budgetMs=,
//         default 50 s; ?docId= re-reads one document): read the company's
//         own documents (transcripts / presentations / results releases first,
//         newest first, India and US interleaved), extract guidance rows,
//         check every quote and number against the document, store the result
//         and mark the document extracted. Called hourly at :50 by
//         .github/workflows/ai-guidance-extract.yml. The monthly AI cap binds.
//
// PROTECTED (lib/site-auth PROTECTED_API_PREFIXES): the owner's cookie or a
// service key (x-cron-secret / x-mc-key header). POST re-checks here (paid AI
// must never be reachable anonymously). Rate-limited. Responses and logs carry
// counts and short quotes only: never a key, never document text.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from '@/lib/site-auth';
import {
  readStatus, readIndex, readResults, realAvailability, realDeps, realKv, runExtraction, runMaxDocs, runMaxUsd, runBudgetMs, runConcurrency, runSinceDays,
  redact, usMode, GUIDANCE_EXTRACT_SCHEDULE,
} from '@/lib/ai-guidance-extract';
import { nextCronRun } from '@/lib/ai-verify';
import { kvGet, kvIncrByFloat } from '@/lib/kv';

// zzz915 — a DAILY spend ceiling for scheduled reading (owner, 6 Oct: the hourly runs cleared a backlog at ~$1/hour, which
// is far above the ~$10/month the site should cost). Default $0.40 a day (≈ $12/month at most; normal days use cents).
// Set GUIDANCE_EXTRACT_DAILY_USD in Railway to change it. A single-document re-read (?docId=) is never blocked by it.
function dailyCapUsd(): number {
  const v = Number(process.env.GUIDANCE_EXTRACT_DAILY_USD);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 20) : 0.4;
}
const dayKey = (d = new Date()) => `guidance-extract:day-usd:v1:${d.toISOString().slice(0, 10)}`;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const DOC_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

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
  const rl = checkRateLimit(`guidance-extract:get:${clientIp(req)}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const docId = new URL(req.url).searchParams.get('docId');
  const kv = realKv();
  const [status, index, av] = await Promise.all([
    readStatus(kv), readIndex(kv),
    realAvailability().catch(() => ({ available: false, reason: 'availability check failed', provider: 'unknown', model: null })),
  ]);
  const next = nextCronRun(GUIDANCE_EXTRACT_SCHEDULE, new Date());
  let result: unknown = undefined;
  if (docId) {
    if (!DOC_ID_RE.test(docId)) return NextResponse.json({ ok: false, error: 'invalid docId' }, { status: 400, headers: NO_STORE });
    result = (await readResults([docId], kv)).get(docId) || null;
  }
  return NextResponse.json({
    ok: true,
    extraction: { provider: av.provider, model: av.model, available: av.available, unavailableReason: av.reason, lastRunAt: status.lastRunAt, nextRunEta: next ? next.toISOString() : null, schedule: GUIDANCE_EXTRACT_SCHEDULE },
    lastRun: status.lastRun,
    runDefaults: { docs: runMaxDocs(), maxUsd: runMaxUsd(), budgetMs: runBudgetMs(), concurrency: runConcurrency(), sinceDays: runSinceDays(), usMode: usMode() },
    results: { documents: index.length, newest: index.slice(0, 20) },
    ...(docId ? { result } : {}),
  }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  const rl = checkRateLimit(`guidance-extract:post:${clientIp(req)}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(100, Number(sp.get('limit')) || runMaxDocs()));
  // per-run spend: at most $2 whatever is asked (the monthly cap binds on top)
  const maxUsd = Math.max(0.01, Math.min(2, Number(sp.get('maxUsd')) || runMaxUsd()));
  const budgetMs = Math.max(10_000, Math.min(55_000, Number(sp.get('budgetMs')) || runBudgetMs()));
  const docId = sp.get('docId');
  if (docId && !DOC_ID_RE.test(docId)) return NextResponse.json({ ok: false, error: 'invalid docId' }, { status: 400, headers: NO_STORE });
  // zzz915: daily ceiling (UTC day) on top of the per-run and monthly caps
  const dayCap = dailyCapUsd();
  const spentToday = Number(await kvGet<number | string>(dayKey()).catch(() => 0)) || 0;
  const dayLeft = Math.max(0, dayCap - spentToday);
  if (!docId && dayLeft < 0.01) {
    return NextResponse.json({ ok: true, run: { stoppedBy: 'daily_cap', queued: 0, attempted: 0, spentUsd: 0, note: `daily reading budget used ($${spentToday.toFixed(2)} of $${dayCap.toFixed(2)}); resumes tomorrow (UTC)` } }, { headers: NO_STORE });
  }
  try {
    const run = await runExtraction(await realDeps(), { limit, maxUsd: docId ? maxUsd : Math.min(maxUsd, dayLeft), budgetMs, concurrency: runConcurrency(), docIds: docId ? [docId] : undefined });
    if (run && Number((run as any).spentUsd) > 0) await kvIncrByFloat(dayKey(), Number((run as any).spentUsd), 3 * 86_400).catch(() => null);
    // 'unavailable' / 'cap' / 'no_store' are honest answers (200 with the reason), not server errors
    return NextResponse.json({ ok: true, run }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[guidance-extract] run failed:', redact(e?.message || e));
    return NextResponse.json({ ok: false, error: 'extraction run failed' }, { status: 500, headers: NO_STORE });
  }
}
