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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const probe = url.searchParams.get('probe') === '1';

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const budget = await getHaikuBudget();

  const out: any = {
    ok: true,
    service: 'haiku-classifier',
    hasApiKey,
    budget,
  };

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
