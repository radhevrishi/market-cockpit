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

/**
 * zzz793: batched and resumable. ?offset=&limit= (default: all, from 0) — the
 * names are checked three at a time inside a 240 s budget; whatever is not
 * reached is returned as `next_offset` so a caller (cron or page) continues
 * where this run stopped. Discovery only: no model is called.
 */
export async function GET(req: NextRequest) {
  const { book, error } = await readUsBook(US_BOOK_OWNER);
  if (error) return NextResponse.json({ ok: false, error }, { status: 503 });
  const uni = thesisUniverse(book);
  const usAll = uni.filter((u) => u.listing === 'US').map((u) => u.ticker);
  const excluded = uni.filter((u) => u.listing !== 'US').map((u) => ({ ticker: u.ticker, reason: u.excludedReason }));
  const sp = new URL(req.url).searchParams;
  const offset = Math.max(0, Number(sp.get('offset') || 0) || 0);
  const limit = Math.max(1, Math.min(400, Number(sp.get('limit') || usAll.length) || usAll.length));
  const us = usAll.slice(offset, offset + limit);
  const started = Date.now();
  const BUDGET_MS = 240_000;
  const results: Array<{ ticker: string; new_evidence: boolean | null; error?: string; attempts?: number }> = new Array(us.length);
  const checkOne = async (t: string): Promise<{ new_evidence: boolean | null; error?: string }> => {
    const u = new URL(req.url);
    u.pathname = '/api/v1/us-thesis/read';
    u.search = `?ticker=${encodeURIComponent(t)}&mode=check`;
    const r = await readRoute(new NextRequest(u.toString()));
    const j: any = await r.json();
    return j?.ok ? { new_evidence: !!j.new_evidence } : { new_evidence: null, error: String(j?.error || 'check failed').slice(0, 200) };
  };
  let i = 0;
  const worker = async () => {
    while (i < us.length) {
      if (Date.now() - started > BUDGET_MS) return;
      const k = i++;
      const t = us[k];
      let out: { new_evidence: boolean | null; error?: string } = { new_evidence: null, error: 'not checked' };
      let attempts = 0;
      // one retry for a failure — a retrieval error is not an answer
      for (; attempts < 2; attempts++) {
        try { out = await checkOne(t); } catch (e: any) { out = { new_evidence: null, error: String(e?.message || e).slice(0, 200) }; }
        if (out.new_evidence !== null || Date.now() - started > BUDGET_MS) break;
      }
      results[k] = { ticker: t, ...out, attempts: attempts + (attempts < 2 ? 1 : 0) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, us.length) }, worker));
  const done = results.filter(Boolean);
  const nextOffset = offset + done.length < usAll.length && done.length < us.length ? offset + done.length : (offset + us.length < usAll.length ? offset + us.length : null);
  return NextResponse.json({
    ok: true, total: usAll.length, offset, checked: done.length, next_offset: nextOffset,
    with_new_evidence: done.filter((r) => r.new_evidence).map((r) => r.ticker),
    failed: done.filter((r) => r.new_evidence == null).length, excluded, results: done,
    note: `Discovery only — no model was called.${nextOffset != null ? ` Continue with ?offset=${nextOffset}.` : ''}`,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
