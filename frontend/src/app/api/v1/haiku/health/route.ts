// PATCH 0931 — Haiku classifier health/diagnostic endpoint.
// Visit /api/v1/haiku/health to verify ANTHROPIC_API_KEY is wired correctly,
// see today's budget consumption, and optionally trigger a probe classification.
//
// Curl examples:
//   curl 'https://market-cockpit.vercel.app/api/v1/haiku/health'
//   curl 'https://market-cockpit.vercel.app/api/v1/haiku/health?probe=1'
//
// Returns:
//   { ok, hasApiKey, budget: { date, callsCount, estimatedCostUsd, dailyCapUsd, remainingUsd }, probe? }

import { NextResponse } from 'next/server';
import { classifyCatalyst, getHaikuBudget } from '@/lib/anthropic-classifier';

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
  const authed = isAuthorized(req);
  const probe = url.searchParams.get('probe') === '1' && authed;

  const rawKey = process.env.ANTHROPIC_API_KEY || '';
  const hasApiKey = !!rawKey;
  const budget = await getHaikuBudget();

  // PATCH 0931-followup3 — surface key FORMAT (length / prefix / suffix / whitespace)
  // without exposing the value, so we can diagnose 401 invalid_x_api_key.
  // Anthropic keys start with sk-ant-api03- and are ~108 chars long.
  const keyDiagnostic = (rawKey && authed) ? {
    length: rawKey.length,
    first12: rawKey.slice(0, 12),
    last4: rawKey.slice(-4),
    startsWithSkAnt: rawKey.startsWith('sk-ant-'),
    hasLeadingWhitespace: /^\s/.test(rawKey),
    hasTrailingWhitespace: /\s$/.test(rawKey),
    hasLeadingQuote: rawKey.startsWith('"') || rawKey.startsWith("'"),
    hasTrailingQuote: rawKey.endsWith('"') || rawKey.endsWith("'"),
    hasInternalSpace: /\s/.test(rawKey.trim()),
    hasNewline: /[\r\n]/.test(rawKey),
  } : null;

  const out: any = {
    ok: true,
    service: 'haiku-classifier',
    hasApiKey,
    budget,
  };
  // Only attached for an authorised caller — `keyDiagnostic` is null otherwise,
  // and the field is omitted entirely rather than sent as null, so the response
  // does not advertise that a richer version exists.
  if (authed && keyDiagnostic) out.keyDiagnostic = keyDiagnostic;
  if (!authed && url.searchParams.get('probe') === '1') {
    out.probe = { error: 'probe requires authorisation (zzz678)' };
  }

  if (probe) {
    if (!hasApiKey) {
      out.probe = { error: 'ANTHROPIC_API_KEY not set in Vercel env' };
    } else {
      // PATCH 0931-followup — bypass cache+classifier wrapper, call Anthropic
      // DIRECTLY so we can see the actual error message instead of null.
      const sample = 'MTAR Technologies announces acquisition of 51% stake in Anupam Rasayan for ₹1,369 Cr';
      const start = Date.now();
      const apiKey = process.env.ANTHROPIC_API_KEY!;
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 100,
            messages: [{ role: 'user', content: `Classify this corporate announcement into one of: M&A, EARNINGS, ORDER_WIN, CAPEX, MANAGEMENT, OTHER. Just the label.\n\n"${sample}"` }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
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
