// ═══════════════════════════════════════════════════════════════════════════
// COVERAGE AUDIT (PATCH 0180)
//
// GET /api/v1/earnings/audit?date=YYYY-MM-DD
//
// Returns the diff between our /api/v1/earnings/graded payload and the
// EarningsPulse "Week Ahead" reference list (curated by user, stored in
// /lib/earnings-week-seed.ts).
//
// PURPOSE: validation / diagnostic only — does NOT auto-inject any tickers.
// User can see which companies our pipeline missed and decide whether to
// force-include them via Coverage Probe.
//
// Response shape:
// {
//   date,
//   expected: ['TATAPOWER', 'DRREDDY', ...],
//   we_have: ['TATAPOWER', ...],
//   missing: ['DRREDDY', ...],
//   stats: { expected_total, our_total, matched, gap, coverage_pct }
// }
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getCalendarTickersForDate } from '@/lib/earnings-week-seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = (searchParams.get('date') || '').trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
  }

  // PATCH 0181 — now reads from KV (populated by daily cron, no hardcoded data)
  const expected = await getCalendarTickersForDate(date);
  if (expected.length === 0) {
    return NextResponse.json({
      date,
      expected: [],
      we_have: [],
      missing: [],
      stats: { expected_total: 0, our_total: 0, matched: 0, gap: 0, coverage_pct: null },
      note: 'No calendar entries in KV for this date yet. Calendar populates daily via /api/v1/cron/refresh-earnings-calendar (Vercel Cron at 06:30 IST). Trigger manually if you need it now.',
    });
  }

  // Fetch our graded payload for the date
  const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0];
  const host = req.headers.get('host') || '';
  const base = `${protocol}://${host}`;
  const ourTickers = new Set<string>();
  try {
    const r = await fetch(`${base}/api/v1/earnings/graded?date=${date}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const tiers = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const;
      for (const t of tiers) {
        for (const c of ((j?.by_tier?.[t] || []) as any[])) {
          ourTickers.add((c.ticker || '').toUpperCase());
        }
      }
    }
  } catch {}

  const expectedSet = new Set(expected.map((t) => t.toUpperCase()));
  const we_have = [...expectedSet].filter((t) => ourTickers.has(t)).sort();
  const missing = [...expectedSet].filter((t) => !ourTickers.has(t)).sort();
  const matched = we_have.length;
  const gap = missing.length;
  const coverage_pct = expected.length > 0 ? Math.round((matched / expected.length) * 100) : null;

  return NextResponse.json({
    date,
    expected_total: expected.length,
    our_total: ourTickers.size,
    matched,
    gap,
    coverage_pct,
    expected,
    we_have,
    missing,
    note: gap === 0
      ? '✓ Full coverage — all expected tickers present.'
      : `${gap} expected tickers missing from /api/v1/earnings/graded for this date. Use Coverage Probe to diagnose individual gaps.`,
  });
}
