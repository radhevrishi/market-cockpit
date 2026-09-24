// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/check-all — SCHEDULED NEW-EVIDENCE CHECK, NO AI.  (zzz790)
//
// For every US-listed name in the US book (and bench), asks EDGAR for
// filings not yet on file and records them as pending — the discovery-only
// `mode=check` of /api/v1/us-thesis/read, run in sequence. Nothing is read
// and no model is called; a name with a new 10-Q / 10-K / 8-K 2.02 turns
// NEW EVIDENCE AVAILABLE and the owner reads it with one click.
//
// Protected like every US route (site cookie or service key), so a cron can
// call it with the service key.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { readUsBook, US_BOOK_OWNER } from '@/lib/us-book-store';
import { thesisUniverse } from '@/lib/us-book/model';
import { GET as readRoute } from '../read/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const { book, error } = await readUsBook(US_BOOK_OWNER);
  if (error) return NextResponse.json({ ok: false, error }, { status: 503 });
  const uni = thesisUniverse(book);
  const us = uni.filter((u) => u.listing === 'US').map((u) => u.ticker);
  const excluded = uni.filter((u) => u.listing !== 'US').map((u) => ({ ticker: u.ticker, reason: u.excludedReason }));
  const started = Date.now();
  const results: Array<{ ticker: string; new_evidence: boolean | null; error?: string }> = [];
  for (const t of us) {
    if (Date.now() - started > 270_000) { results.push({ ticker: t, new_evidence: null, error: 'time budget reached — not checked this run' }); continue; }
    try {
      const u = new URL(req.url);
      u.pathname = '/api/v1/us-thesis/read';
      u.search = `?ticker=${encodeURIComponent(t)}&mode=check`;
      const r = await readRoute(new NextRequest(u.toString()));
      const j: any = await r.json();
      results.push({ ticker: t, new_evidence: j?.ok ? !!j.new_evidence : null, ...(j?.ok ? {} : { error: String(j?.error || 'check failed').slice(0, 200) }) });
    } catch (e: any) {
      results.push({ ticker: t, new_evidence: null, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return NextResponse.json({
    ok: true, checked: results.length, with_new_evidence: results.filter((r) => r.new_evidence).map((r) => r.ticker),
    failed: results.filter((r) => r.new_evidence == null).length, excluded, results, note: 'Discovery only — no model was called.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
