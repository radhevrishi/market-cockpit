// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/facts — THE DETERMINISTIC US GRADER ROW.  (zzz790 → zzz793)
//
// GET ?tickers=A,B,C → { rows: { A: row | {source:'none', why, us_profile} } }
//
// For each US-listed name: EDGAR XBRL companyfacts → strict quarterly figures
// (lib/us-thesis/xbrl: 3-month facts only, the same fiscal quarter a year
// earlier, Q4 = full year − nine months only when both are clean and marked
// derived, ifrs-full for foreign filers) → usGradedRow. Every row also
// carries `us_profile`: SIC, what the company files (10-Q vs 20-F / 40-F),
// its fiscal calendar and, for a foreign filer, its latest half-year or
// annual figures labelled as such. NO model call, NO price, NO market value.
//
// Cached per ticker (`us-thesis:facts:v5:<T>`, zzz829): a row for 12 hours, a
// "no figures" answer for 1 hour, a retrieval failure not at all.

// zzz815: the work lives in lib/us-thesis/facts-server (shared, bounded):
// the SEC ticker map is fetched once, a failed map download is a RETRIEVAL
// FAILURE ("SEC request failed — retrying", never cached, never "no SEC
// filer"), each name has its own time limit and the batch answers inside
// the platform limit with every requested name accounted for.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { normalizeUsTicker } from '@/lib/us-book/import';
import { usFactsBatch } from '@/lib/us-thesis/facts-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const force = sp.get('force') === '1';
  const tickers = Array.from(new Set((sp.get('tickers') || '').split(',').map((s) => normalizeUsTicker(s)).filter((s) => TICKER_RE.test(s)))).slice(0, 40);
  const b = await usFactsBatch(tickers, { force, concurrency: 6, perNameMs: 25_000, deadlineMs: 45_000 });
  const coverage = { xbrl: 0, none: 0, failed: b.failed, cached: b.cached, fetched: b.fetched, not_reached: b.not_reached };
  for (const r of Object.values(b.rows)) { if (r?.source === 'sec-xbrl') coverage.xbrl++; else coverage.none++; }
  return NextResponse.json({ ok: true, rows: b.rows, coverage, note: 'Filed XBRL figures only — no price, no model.' }, { headers: { 'Cache-Control': 'no-store' } });
}
