/**
 * Market Cockpit Bootstrap/Seed Endpoint
 *
 * Kicks off all background pipelines to seed Redis from scratch.
 * Call this once after deployment or when Redis is wiped.
 *
 * GET /api/market/seed                → run both pipelines
 * GET /api/market/seed?only=guidance  → guidance ingest only
 * GET /api/market/seed?only=intelligence → intelligence compute only
 * GET /api/market/seed?secret=mc-bot-2026 → secure call (Vercel cron)
 *
 * Returns immediately with job status — actual compute happens in background.
 * Both pipelines have their own distributed locks and run independently.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

async function triggerPipeline(
  url: string,
  label: string,
  timeoutMs = 50000
): Promise<{ label: string; status: string; detail?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    return {
      label,
      status: res.ok ? (data.success !== false ? 'success' : 'failed') : 'error',
      detail: data.message || `HTTP ${res.status}`,
    };
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.message?.includes('timeout');
    return {
      label,
      status: isTimeout ? 'timeout' : 'error',
      detail: isTimeout ? 'Triggered (running in background)' : e?.message,
    };
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // Optional secret check
  if (secret && secret !== 'mc-bot-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const only = searchParams.get('only');
  // CRITICAL: Use request origin (production alias) NOT VERCEL_URL
  // VERCEL_URL points to deployment-specific URL which is blocked by Deployment Protection (401)
  const baseUrl = new URL(request.url).origin;

  const jobs: Array<{ label: string; url: string; timeoutMs: number }> = [];

  if (!only || only === 'intelligence') {
    jobs.push({
      label: 'intelligence:compute',
      url: `${baseUrl}/api/market/intelligence/compute`,
      timeoutMs: 50000,
    });
  }

  if (!only || only === 'guidance') {
    jobs.push({
      label: 'guidance:ingest',
      url: `${baseUrl}/api/market/earnings-guidance/ingest`,
      timeoutMs: 50000,
    });
  }

  if (jobs.length === 0) {
    return NextResponse.json({ error: 'No valid pipeline specified', only }, { status: 400 });
  }

  // Run all jobs in parallel
  const results = await Promise.all(
    jobs.map(job => triggerPipeline(job.url, job.label, job.timeoutMs))
  );

  const elapsed = Date.now() - startTime;
  const allSuccess = results.every(r => r.status === 'success' || r.status === 'timeout');

  return NextResponse.json({
    success: allSuccess,
    message: allSuccess
      ? `Seed complete in ${elapsed}ms. Intelligence + Guidance pipelines ran.`
      : 'Some pipelines failed — check details',
    pipelines: results,
    elapsedMs: elapsed,
    note: 'Timeout status means the pipeline was triggered and is running in background. Check Redis for results.',
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
