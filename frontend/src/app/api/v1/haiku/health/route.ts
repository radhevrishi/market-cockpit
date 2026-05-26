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
      const sample = 'MTAR Technologies announces acquisition of 51% stake in Anupam Rasayan for ₹1,369 Cr';
      const start = Date.now();
      const result = await classifyCatalyst(sample, 'MTARTECH');
      out.probe = {
        sample,
        result,
        elapsed_ms: Date.now() - start,
      };
    }
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
