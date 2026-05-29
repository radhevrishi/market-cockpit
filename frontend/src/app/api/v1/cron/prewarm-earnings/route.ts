// ═══════════════════════════════════════════════════════════════════════════
// CRON: PRE-WARM EARNINGS PIPELINE (PATCH 0504)
//
// Runs hourly during India market hours via Vercel Cron. For each of the
// last 7 calendar days (incl weekends), forces a fresh fetch of the
// graded payload and today-live multi-source filings. Result: KV is
// always within an hour of the upstream NSE+BSE corp-announcements feed,
// so user visits to EO are instant cache hits with maximum coverage.
//
// Rationale: previously, the only background refresh was the daily 06:30 IST
// calendar cron. If a user opened EO at 3pm and a new BSE filing had
// arrived at 2pm, they'd need to manually click Force Re-scan. With this
// cron firing hourly, the freshest data is always pre-warmed.
//
// Cost: 7 dates × 2 endpoints = 14 fetches per hour × 24 hours = 336
// fetches/day. Well under Vercel function quotas.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { railwaySelfFetch } from '@/lib/railway-self-fetch'; // PATCH 0985

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 min — Pro plan

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature') || '';

  if (!vercelHeader) {
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'cron-secret-unset' }, { status: 503 });
      }
    } else if (provided !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const origin = new URL(req.url).origin;
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const results: Array<{
    date: string;
    today_live_status?: number;
    today_live_count?: number;
    graded_status?: number;
    graded_total?: number;
    error?: string;
  }> = [];

  // Process dates serially to avoid hammering upstream sources.
  // Each pair (today-live + graded) gets ~15s budget.
  for (const date of dates) {
    const entry: any = { date };
    try {
      // Step 1: pre-warm today-live (NSE+BSE multi-source)
      const liveRes = await railwaySelfFetch(`${origin}/api/v1/earnings/today-live?date=${date}&force=1`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      entry.today_live_status = liveRes.status;
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        entry.today_live_count = liveData?.count || 0;
      }

      // Step 2: pre-warm graded payload
      const gradedRes = await railwaySelfFetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(45_000),
      });
      entry.graded_status = gradedRes.status;
      if (gradedRes.ok) {
        const gradedData = await gradedRes.json();
        const tot = Object.values(gradedData?.by_tier || {}).reduce<number>(
          (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0
        );
        entry.graded_total = tot;
      }
    } catch (e: any) {
      entry.error = e?.message || String(e);
    }
    results.push(entry);
  }

  return NextResponse.json({
    status: 'ok',
    dates_warmed: results.length,
    results,
    completed_at: new Date().toISOString(),
  });
}

// PATCH 1031 — accept POST too (the GitHub cron bridge POSTs). Delegates to GET.
export async function POST(req: Request) { return GET(req); }
