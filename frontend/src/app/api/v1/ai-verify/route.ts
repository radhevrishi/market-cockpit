// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/ai-verify — the AI verification queue.                     (zzz854)
//
//   GET   status + queue: provider, availability (key set? cap reached?),
//         last run, queue length and the first `limit` queued claims.
//   POST  run one batch (?limit=N, default AI_VERIFY_RUN_MAX_CLAIMS): read
//         the primary document of each queued claim, ask the model, check
//         the answer, cache the verdict. Called every 2 hours by
//         .github/workflows/ai-verify.yml.
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
import { readQueue, readStatus, realAvailability, realDeps, realKv, runVerification, runMaxClaims, gateMode, redact } from '@/lib/ai-verify';

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
  const byKind: Record<string, number> = {}; const withPrimary = q.items.filter((x) => !!x.claim.primaryUrl).length;
  for (const it of q.items) byKind[it.claim.kind] = (byKind[it.claim.kind] || 0) + 1;
  return NextResponse.json({
    ok: true,
    verification: { provider: av.provider, model: av.model, available: av.available, unavailableReason: av.reason, mode: gateMode(), lastRunAt: status.lastRunAt },
    lastRun: status.lastRun,
    queue: {
      length: q.items.length, withPrimaryDocument: withPrimary, byKind, updatedAt: q.updatedAt,
      items: q.items.slice(0, limit).map((x) => ({ claimId: x.claim.claimId, kind: x.claim.kind, market: x.claim.market, company: x.claim.company, ticker: x.claim.ticker, claimText: x.claim.claimText, primaryUrl: x.claim.primaryUrl, addedAt: x.addedAt })),
    },
  }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  // paid AI: at most 4 runs a minute per caller (the cron runs once every 2 hours)
  const rl = checkRateLimit(`ai-verify:post:${clientIp(req)}`, 4, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(50, Number(sp.get('limit')) || runMaxClaims()));
  try {
    const run = await runVerification(realDeps(), { limit, budgetMs: 50_000 });
    // 'unavailable' / 'cap' are honest answers (200 with available:false), not server errors
    return NextResponse.json({ ok: true, run }, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[ai-verify] run failed:', redact(e?.message || e));
    return NextResponse.json({ ok: false, error: 'verification run failed' }, { status: 500, headers: NO_STORE });
  }
}
