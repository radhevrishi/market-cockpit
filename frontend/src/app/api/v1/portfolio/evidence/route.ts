// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/portfolio/evidence — THE LOAD PATH THAT WAS MISSING.      (zzz740)
//
// GET  ?tickers=A,B,C   → { ledgers: {A: CompanyLedger…}, batch, counts }
//                         Page load reads THIS, never the model. No
//                         extraction happens here; a ticker with no ledger
//                         simply has no entry.
// POST { action: 'status', ticker, period, status, because, tallies }
//                       → the client's status engine assigned a status;
//                         recorded with history.
// POST { action: 'batch_start', tickers[] } / { action: 'batch_finish' }
//                       → the "Read evidence for all" job header, so a
//                         reload can say "37 updated · 77 remaining"
//                         from the ledgers' run timestamps.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { loadLedgers, persistStatus, loadBatch, saveBatch, type BatchHeader } from '@/lib/thesis/evidence-store';
import { applyUserType, IN_AI_TYPES_KEY, type AiMap } from '@/lib/thesis/ai-type-store';
import { freshnessOf, batchProgress, type CompanyLedger, type CompanyEvidenceState } from '@/lib/thesis/evidence-ledger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9&.\-]{1,24}$/;

// zzz774: the thesis type the owner assigned per holding (A/B/F/G).
const THESIS_TYPES_KEY = 'pc-thesis-types:v1';
const PATTERNS = new Set(['A', 'B', 'F', 'G']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('thesis_types')) {
    const map = (await kvGet<Record<string, string>>(THESIS_TYPES_KEY).catch(() => null)) || {};
    const ai = (await kvGet<AiMap>(IN_AI_TYPES_KEY).catch(() => null)) || {};
    return NextResponse.json({ ok: true, thesis_types: map, thesis_ai: ai });
  }
  const raw = (searchParams.get('tickers') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => TICKER_RE.test(s));
  const tickers = Array.from(new Set(raw)).slice(0, 400);
  const [ledgers, batch, priorBatch] = await Promise.all([tickers.length ? loadLedgers(tickers) : Promise.resolve({} as Record<string, CompanyLedger>), loadBatch(), loadBatch('prior')]);

  let withEvidence = 0, sourceUnavailable = 0, noDisclosure = 0, newEvidence = 0;
  const freshness: Record<string, { state: string; detail: string }> = {};
  // The owner's seven states, per company, from the persisted ledger. (zzz770)
  const byState: Record<CompanyEvidenceState, number> = {
    NOT_SEARCHED: 0, EVIDENCE_INCOMPLETE: 0, CURRENT: 0, NEW_EVIDENCE_AVAILABLE: 0,
    STALE: 0, SOURCE_UNAVAILABLE: 0, RETRIEVAL_FAILED: 0,
  };
  for (const t of tickers) {
    const l = ledgers[t] || null;
    const f = freshnessOf(l);
    freshness[t] = f;
    if (f.evidence_state) byState[f.evidence_state]++;
    if (l?.latest_period) withEvidence++;
    if (f.state === 'SOURCE_UNAVAILABLE') sourceUnavailable++;
    if (f.state === 'NEW_EVIDENCE_AVAILABLE') newEvidence++;
    if (!l?.latest_period && l?.last_attempt?.outcome === 'NO_DISCLOSURE') noDisclosure++;
  }

  // Batch progress is DERIVED from the ledgers: a ticker in the batch list
  // whose last attempt is at/after the batch start has been processed,
  // whatever the outcome. Nothing here can drift from the truth.
  const batchView = batch ? { ...batch, ...batchProgress(batch, ledgers) } : null;
  // The prior-quarter backfill (zzz765): same header, same derivation.
  const priorBatchView = priorBatch ? { ...priorBatch, ...batchProgress(priorBatch, ledgers) } : null;

  return NextResponse.json({
    ok: true, tickers: tickers.length, ledgers, freshness,
    counts: { requested: tickers.length, with_evidence: withEvidence, remaining: tickers.length - withEvidence, source_unavailable: sourceUnavailable, no_disclosure: noDisclosure, new_evidence_available: newEvidence, by_state: byState },
    batch: batchView,
    prior_batch: priorBatchView,
  });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }
  const action = String(body?.action || '');

  if (action === 'thesis_type') {
    const ticker = String(body?.ticker || '').toUpperCase();
    const pattern = body?.pattern == null ? null : String(body.pattern).toUpperCase();
    if (!TICKER_RE.test(ticker) || (pattern !== null && !PATTERNS.has(pattern))) return NextResponse.json({ ok: false, error: 'ticker and pattern (A/B/F/G or null) are required' }, { status: 400 });
    const map = (await kvGet<Record<string, string>>(THESIS_TYPES_KEY).catch(() => null)) || {};
    const aiMap = (await kvGet<AiMap>(IN_AI_TYPES_KEY).catch(() => null)) || {};
    // zzz837: the owner's picker always wins — it also removes any AI record for the name.
    const r = applyUserType(map, aiMap, ticker, pattern);
    await Promise.all([kvSet(THESIS_TYPES_KEY, r.types), kvSet(IN_AI_TYPES_KEY, r.ai)]); // no TTL: thesis type records
    return NextResponse.json({ ok: true, thesis_types: r.types, thesis_ai: r.ai });
  }

  if (action === 'status') {
    const ticker = String(body?.ticker || '').toUpperCase();
    const period = String(body?.period || '');
    const status = String(body?.status || '');
    if (!TICKER_RE.test(ticker) || !period || !status) return NextResponse.json({ ok: false, error: 'ticker, period and status are required' }, { status: 400 });
    const r = await persistStatus(ticker, period, status, body?.because ? String(body.because).slice(0, 600) : null, body?.tallies ?? null);
    return NextResponse.json({ ok: r.ok, error: r.error });
  }

  // `kind: 'prior'` files the header under the prior-quarter backfill's own
  // key; anything else is the evidence batch, as before. (zzz765)
  const kind: 'evidence' | 'prior' = body?.kind === 'prior' ? 'prior' : 'evidence';

  if (action === 'batch_start') {
    const tickers = Array.from(new Set((Array.isArray(body?.tickers) ? body.tickers : []).map((s: any) => String(s).toUpperCase()).filter((s: string) => TICKER_RE.test(s)))).slice(0, 400) as string[];
    if (!tickers.length) return NextResponse.json({ ok: false, error: 'tickers[] required' }, { status: 400 });
    const header: BatchHeader = { batch_id: `batch_${Date.now().toString(36)}`, started_at: new Date().toISOString(), finished_at: null, tickers, requested_by: kind === 'prior' ? 'portfolio-catalysts:prior-quarter' : 'portfolio-catalysts' };
    await saveBatch(header, kind);
    return NextResponse.json({ ok: true, batch: header });
  }

  if (action === 'batch_finish') {
    const b = await loadBatch(kind);
    if (!b) return NextResponse.json({ ok: false, error: 'no batch on file' });
    const done = { ...b, finished_at: new Date().toISOString() };
    await saveBatch(done, kind);
    return NextResponse.json({ ok: true, batch: done });
  }

  return NextResponse.json({ ok: false, error: `unknown action ${action}` }, { status: 400 });
}
