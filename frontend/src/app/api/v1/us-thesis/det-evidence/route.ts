// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/det-evidence — US EVIDENCE READ WITHOUT AI.       (zzz815)
//
// GET  ?tickers=A,B      the stored records (KV only — fast, no SEC).
// POST { tickers: [..] } read up to 3 names now (EX-99.1 + 10-Q MD&A, the
//                        deterministic US reader, XBRL), persist, return.
// No model is called and no price is read. The page runs POST in small,
// polite batches (book first, then the bench); the AI read stays on click.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { normalizeUsTicker } from '@/lib/us-book/import';
import { loadUsDetEvidence, runUsDetEvidence } from '@/lib/us-thesis/det-evidence-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
const clean = (xs: unknown[], max: number) => Array.from(new Set(xs.map((s) => normalizeUsTicker(String(s || ''))).filter((s) => TICKER_RE.test(s)))).slice(0, max);

export async function GET(req: NextRequest) {
  const tickers = clean((new URL(req.url).searchParams.get('tickers') || '').split(','), 200);
  const records = await loadUsDetEvidence(tickers).catch(() => ({}));
  return NextResponse.json({ ok: true, records, label: 'read without AI' }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const tickers = clean(Array.isArray(body?.tickers) ? body.tickers : [], 3);
  const t0 = Date.now();
  const records: Record<string, any> = {};
  for (const t of tickers) {
    const left = 52_000 - (Date.now() - t0);
    if (left < 8_000) break;                       // the page asks again for what was not reached
    records[t] = await runUsDetEvidence(t, Math.min(40_000, left - 2_000));
  }
  return NextResponse.json({ ok: true, records, label: 'read without AI', model_called: false }, { headers: { 'Cache-Control': 'no-store' } });
}
