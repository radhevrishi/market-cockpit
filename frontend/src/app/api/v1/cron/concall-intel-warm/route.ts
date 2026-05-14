// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0399 — Concall Intel cache pre-warmer.
//
// Triggered by Vercel cron to keep KV PDF + feed caches fresh so users get
// instant data on page open instead of waiting 30s for PDF extraction.
//
// Each invocation:
//   - Calls live-feed with force=1 (extracts up to 25 fresh PDFs)
//   - Calls warrant-feed with force=1 (warrant context refresh)
//   - Returns extraction stats
//
// Auth: secret query param required.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';

const SECRET = process.env.CRON_SECRET || 'mc-bot-2026';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const started = Date.now();
  const results: Record<string, unknown> = {};

  // Warm the bullish live-feed (extracts 25 fresh PDFs)
  try {
    const r = await fetch(`${origin}/api/v1/concall-intel/live-feed?days=7&force=1`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'MC-Cron-ConcallWarm/1.0' },
    });
    if (r.ok) {
      const j = await r.json();
      results.live_feed = {
        ok: true,
        count_total: j.count_total,
        count_relevant: j.count_relevant,
        count_high_bullish: j.count_high_bullish,
      };
    } else {
      results.live_feed = { ok: false, status: r.status };
    }
  } catch (e: any) {
    results.live_feed = { ok: false, error: e?.message || String(e) };
  }

  // Warm the warrant feed
  try {
    const r = await fetch(`${origin}/api/v1/concall-intel/warrant-feed?days=14&force=1`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'MC-Cron-ConcallWarm/1.0' },
    });
    if (r.ok) {
      const j = await r.json();
      results.warrant_feed = {
        ok: true,
        count_total: j.count_total,
        count_relevant: j.count_relevant,
        count_passing: j.count_passing,
      };
    } else {
      results.warrant_feed = { ok: false, status: r.status };
    }
  } catch (e: any) {
    results.warrant_feed = { ok: false, error: e?.message || String(e) };
  }

  // Warm the keyword-watch feed
  try {
    const r = await fetch(`${origin}/api/v1/concall-intel/keyword-watch?days=14&force=1`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'MC-Cron-ConcallWarm/1.0' },
    });
    if (r.ok) {
      const j = await r.json();
      results.keyword_watch = {
        ok: true,
        count_relevant: j.count_relevant,
        count_matched: j.count_matched,
      };
    } else {
      results.keyword_watch = { ok: false, status: r.status };
    }
  } catch (e: any) {
    results.keyword_watch = { ok: false, error: e?.message || String(e) };
  }

  return NextResponse.json({
    ok: true,
    elapsed_ms: Date.now() - started,
    ts: new Date().toISOString(),
    results,
  });
}
