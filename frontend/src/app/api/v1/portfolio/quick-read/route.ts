// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/portfolio/quick-read — read one India company's latest documents
// WITHOUT AI and persist the facts to its evidence ledger.           (zzz816)
//
// GET ?ticker=ABC[&filing_date=YYYY-MM-DD][&force=1]
//   → { ok, outcome: READ | SKIPPED | NO_DOCUMENTS | FAILED, note, ledger,
//       documents: [{ label, kind, outcome, detail }], facts, period }
//
// Deterministic (lib/thesis/quick-read), no model call, no OCR. Discovery,
// download limits and the ledger are the AI read's own; the facts are marked
// "read without AI (deterministic)" and an AI read of the same period (on
// click, /api/v1/india/ai-summary) supersedes them. Owner-only (the
// /api/v1/portfolio prefix is protected in lib/site-auth).
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { runQuickRead } from '@/lib/thesis/quick-read-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9&.\-]{1,24}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return NextResponse.json({ ok: false, error: 'ticker is required' }, { status: 400 });
  const filingDate = (searchParams.get('filing_date') || '').slice(0, 10) || null;
  const force = searchParams.get('force') === '1';
  try {
    const r = await runQuickRead(ticker, { filingDate, force });
    return NextResponse.json(r);
  } catch (e: any) {
    // An unexpected error is reported as such — never as "nothing disclosed".
    return NextResponse.json({ ok: false, outcome: 'FAILED', ticker, note: `Quick read failed: ${String(e?.message || e).slice(0, 300)}`, documents: [], facts: 0, events: 0, ledger: null, persisted: false, period: null });
  }
}
