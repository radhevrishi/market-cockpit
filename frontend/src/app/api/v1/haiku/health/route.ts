// PATCH 0931 — Haiku classifier health/diagnostic endpoint.
// Visit /api/v1/haiku/health to verify the active model provider is wired
// (OPENAI_API_KEY or ANTHROPIC_API_KEY, whichever AI_PROVIDER selects), see
// today's budget consumption, and optionally trigger a probe classification.
//
// Curl examples:
//   curl 'https://market-cockpit.vercel.app/api/v1/haiku/health'
//   curl 'https://market-cockpit.vercel.app/api/v1/haiku/health?probe=1'
//
// Returns:
//   { ok, hasApiKey, budget: { date, callsCount, estimatedCostUsd, dailyCapUsd, remainingUsd }, probe? }

import { NextResponse } from 'next/server';
import { SITE_COOKIE, expectedToken, safeEqual } from '@/lib/site-auth';
import { classifyCatalyst, getHaikuBudget } from '@/lib/anthropic-classifier';
import { anthropicMessages, readSpend, monthlyCapUsd, modelConfigured, modelKeyName, provider, openaiModel } from '@/lib/anthropic-meter';

export const runtime = 'nodejs';
export const maxDuration = 15;

// ═══════════════════════════════════════════════════════════════════════════
// THIS ENDPOINT IS PUBLIC. IT WAS TELLING THE INTERNET ABOUT THE KEY. (zzz678)
//
// PATCH 0931-followup3 added a key-format diagnostic to debug a 401, and its
// commit message says "no key value exposed". That was true of the VALUE and
// false of everything around it: the response carried the key's exact length
// and its LAST FOUR CHARACTERS, to anyone who asked, with no authentication,
// on a deployment whose repository is public.
//
// Four characters are not a key. But they are enough to confirm that a key
// found somewhere else belongs to this account, and the exact length narrows
// the format. Neither has any business being readable by a stranger.
//
// `?probe=1` was worse than the diagnostic. It spends real money — an
// unauthenticated GET that calls the Anthropic API on the owner's account.
// The daily cap bounds the damage, but the cap is a budget control, not a
// security control: anyone could exhaust the day's allowance on a loop and
// switch the classifier off for everyone.
//
// So both now require the same secret the cron routes use. What stays public
// is the part that is genuinely useful for a health check and tells an
// outsider nothing they could use: whether a key is configured at all, and
// what the budget looks like. A debug aid should not outlive the debugging.
// ═══════════════════════════════════════════════════════════════════════════
// zzz790 — the logged-in owner may see which provider/model is live and this
// month's metered spend (no key material is ever returned).
async function isOwner(req: Request): Promise<boolean> {
  try {
    const want = await expectedToken();
    const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${SITE_COOKIE}=([^;]+)`));
    const got = m ? decodeURIComponent(m[1]) : '';
    return !!want && !!got && safeEqual(want, got);
  } catch { return false; }
}

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || '';
  // No secret configured means the diagnostic stays SHUT, not open. A missing
  // environment variable must never be the thing that unlocks a diagnostic.
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const headerKey = req.headers.get('x-cron-secret') || '';
  return bearer === secret || headerKey === secret;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const authed = isAuthorized(req) || await isOwner(req);
  const probe = url.searchParams.get('probe') === '1' && authed;

  const hasApiKey = modelConfigured();
  const budget = await getHaikuBudget();

  // zzz753 — the key-format diagnostic (length / prefix / suffix of the raw
  // key) is gone for good. The route never reads a key value any more; it asks
  // the wrapper whether a model is configured. What an authorised caller gets
  // instead is the thing that actually matters now that the provider can be
  // switched by environment variable: which provider and model are live, the
  // name of the variable that must be set, and this month's metered spend.
  const out: any = {
    ok: true,
    service: 'haiku-classifier',
    hasApiKey,
    budget,
  };
  if (authed) {
    const spend = await readSpend();
    out.model = {
      provider: provider(),
      model: provider() === 'openai' ? openaiModel() : 'anthropic (per-call model)',
      key_variable: modelKeyName(),
      configured: hasApiKey,
      month_usd: Math.round((spend.total_usd || 0) * 10000) / 10000,
      month_calls: spend.calls || 0,
      monthly_cap_usd: monthlyCapUsd(),
    };
  }
  if (!authed && url.searchParams.get('probe') === '1') {
    out.probe = { error: 'probe requires authorisation (zzz678)' };
  }

  if (probe) {
    if (!hasApiKey) {
      out.probe = { error: `${modelKeyName()} not set in Railway env` };
    } else {
      // PATCH 0931-followup — bypass cache+classifier wrapper, call Anthropic
      // DIRECTLY so we can see the actual error message instead of null.
      const sample = 'MTAR Technologies announces acquisition of 51% stake in Anupam Rasayan for ₹1,369 Cr';
      const start = Date.now();
      try {
        const resp = await anthropicMessages('health-probe', {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          messages: [{ role: 'user', content: `Classify this corporate announcement into one of: M&A, EARNINGS, ORDER_WIN, CAPEX, MANAGEMENT, OTHER. Just the label.\n\n"${sample}"` }],
        }, { signal: AbortSignal.timeout(15_000) });
        const elapsed_ms = Date.now() - start;
        const responseText = await resp.text();
        out.probe = {
          sample,
          http_status: resp.status,
          ok: resp.ok,
          elapsed_ms,
          response_body: responseText.slice(0, 800),
        };
        // Also try the wrapper for comparison
        const wrapperResult = await classifyCatalyst(sample, 'MTARTECH');
        out.probe.wrapper_result = wrapperResult;
      } catch (e: any) {
        out.probe = {
          sample,
          elapsed_ms: Date.now() - start,
          error_name: e?.name,
          error_message: e?.message,
        };
      }
    }
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
