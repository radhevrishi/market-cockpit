// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS COVERAGE PROBE (PATCH 0174)
//
// GET /api/v1/earnings/coverage?ticker=SYRMA&date=2026-05-11
//
// Tells you exactly where a given ticker stands in our pipeline:
//   1. Is it in the /api/market/earnings universe for that date?
//   2. Does /api/v1/earnings/enrich return financials for it?
//   3. Does /api/v1/earnings/graded include it (and what tier)?
//
// Use this to diagnose "company X is on EarningsPulse but missing from our
// portal" complaints — surfaces which layer dropped it.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawTicker = (searchParams.get('ticker') || '').trim().toUpperCase();
  const date = (searchParams.get('date') || '').trim();
  if (!rawTicker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  if (!date) return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 });

  // Build the base URL from request headers (Vercel adds host)
  const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0];
  const host = req.headers.get('host') || '';
  const base = `${protocol}://${host}`;

  // YYYY-MM → month
  const month = date.slice(0, 7);

  // ── Layer 1: Is it in /api/market/earnings? ─────────────────────────────
  let inUniverse: any = null;
  let universeError: string | null = null;
  try {
    const r = await fetch(`${base}/api/market/earnings?market=india&month=${month}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const all = (j?.results || []) as any[];
      const match = all.find((e) => (e.ticker || '').toUpperCase() === rawTicker && e.resultDate === date);
      const matchAnyDate = !match
        ? all.find((e) => (e.ticker || '').toUpperCase() === rawTicker)
        : null;
      inUniverse = match
        ? { found: true, exact: true, ...match }
        : matchAnyDate
        ? { found: true, exact: false, note: `Found on different date: ${matchAnyDate.resultDate}`, ...matchAnyDate }
        : { found: false, monthScanned: month, totalInMonth: all.length };
    } else {
      universeError = `HTTP ${r.status}`;
    }
  } catch (e: any) {
    universeError = e?.message || String(e);
  }

  // ── Layer 2: Does /api/v1/earnings/enrich return financials? ────────────
  let enrichment: any = null;
  let enrichmentError: string | null = null;
  try {
    const r = await fetch(`${base}/api/v1/earnings/enrich?symbols=${rawTicker}&filed=${date}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const data = (j?.data || {})[rawTicker];
      enrichment = data
        ? {
            found: true,
            sales_yoy_pct: data.sales_yoy_pct ?? null,
            pat_yoy_pct: data.pat_yoy_pct ?? null,
            eps_yoy_pct: data.eps_yoy_pct ?? null,
            opm_pct: data.opm_pct ?? null,
            rs_rating: data.rs_rating ?? null,
            stage: data.stage ?? null,
            financials_source: data.financials_source ?? null,
            period_ended: data.period_ended ?? null,
            latest_quarter_end_iso: data.latest_quarter_end_iso ?? null,
          }
        : { found: false };
    } else {
      enrichmentError = `HTTP ${r.status}`;
    }
  } catch (e: any) {
    enrichmentError = e?.message || String(e);
  }

  // ── Layer 3: Does /api/v1/earnings/graded include it? ───────────────────
  let graded: any = null;
  let gradedError: string | null = null;
  try {
    const r = await fetch(`${base}/api/v1/earnings/graded?date=${date}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const tiers = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const;
      let foundTier: string | null = null;
      let foundRow: any = null;
      for (const t of tiers) {
        const arr = (j?.by_tier?.[t] || []) as any[];
        const hit = arr.find((c) => (c.ticker || '').toUpperCase() === rawTicker);
        if (hit) {
          foundTier = t;
          foundRow = hit;
          break;
        }
      }
      graded = foundRow
        ? { found: true, tier: foundTier, score: foundRow.composite_score, methodology_tags: foundRow.methodology_tags, caveat_tags: foundRow.caveat_tags }
        : { found: false, total: j?.candidates_total ?? 0 };
    } else {
      gradedError = `HTTP ${r.status}`;
    }
  } catch (e: any) {
    gradedError = e?.message || String(e);
  }

  // ── Diagnosis ───────────────────────────────────────────────────────────
  let diagnosis = '';
  if (!inUniverse?.found) {
    diagnosis = `❌ DROPPED at Layer 1 (/api/market/earnings): NSE/BSE feeds don't list this ticker for ${date}. ` +
      `This usually means either (a) the announcement of board-meeting outcome is delayed on NSE corporate-announcements, ` +
      `(b) it was filed under sub_category != "Financial Results", or (c) it's BSE-only and our BSE proxy didn't pick it up. ` +
      `Fix: cross-check against Trendlyne/Screener for the actual filing time, then either expand the NSE sub_category filter or ` +
      `extend the BSE adapter.`;
  } else if (!enrichment?.found || enrichment?.sales_yoy_pct == null) {
    diagnosis = `⚠ Universe has it, but Layer 2 (/api/v1/earnings/enrich) failed to fetch financials. ` +
      `Possible causes: Screener.in doesn't have the latest quarter yet, NSE structured XBRL fields not yet populated, ` +
      `or 6h KV cache holds stale "no data" entry. Fix: hit /api/v1/earnings/enrich?symbols=${rawTicker}&filed=${date}&nocache=1`;
  } else if (!graded?.found) {
    diagnosis = `⚠ Universe + financials both OK, but Layer 3 (/api/v1/earnings/graded) dropped it. ` +
      `Likely the gradeRow filter excluded it (future filing_date, quarter mismatch, or hub_quality='Upcoming'). ` +
      `Inspect the joined row to see which guard fired.`;
  } else {
    diagnosis = `✓ Fully covered: ${graded.tier} (score ${graded.score})`;
  }

  return NextResponse.json({
    ticker: rawTicker,
    date,
    layers: {
      universe: { ...inUniverse, error: universeError },
      enrichment: { ...enrichment, error: enrichmentError },
      graded: { ...graded, error: gradedError },
    },
    diagnosis,
    checked_at: new Date().toISOString(),
  });
}
