// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/evidence — US LEDGERS, the India contract.        (zzz790)
//
// Mirrors /api/v1/portfolio/evidence on the US keys (lib/us-thesis/
// evidence-store): page load reads ledgers here, never the model.
//
// GET  ?tickers=A,B,C     → { ledgers, freshness, counts, batch, prior_batch }
// GET  ?thesis_types=1    → { thesis_types }
// POST { action: 'status', ticker, period, status, because, tallies }
// POST { action: 'thesis_type', ticker, pattern: A|B|F|G|null }
// POST { action: 'batch_start', tickers[], kind? } / { action: 'batch_finish', kind? }
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  loadUsLedgers, persistUsStatus, loadUsBatch, saveUsBatch, loadUsThesisTypes, saveUsThesisTypes, type UsBatchHeader,
} from '@/lib/us-thesis/evidence-store';
import { batchProgress, type CompanyLedger, type CompanyEvidenceState } from '@/lib/thesis/evidence-ledger';
import { applyUserType, US_AI_TYPES_KEY, type AiMap } from '@/lib/thesis/ai-type-store';
import { kvGet, kvSet } from '@/lib/kv';
import { usFreshness } from '@/lib/us-thesis/calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
const PATTERNS = new Set(['A', 'B', 'F', 'G']);

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  if (sp.get('thesis_types')) return NextResponse.json({ ok: true, thesis_types: await loadUsThesisTypes(), thesis_ai: (await kvGet<AiMap>(US_AI_TYPES_KEY).catch(() => null)) || {} });
  const tickers = Array.from(new Set((sp.get('tickers') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => TICKER_RE.test(s)))).slice(0, 400);
  const [ledgers, batch, priorBatch] = await Promise.all([
    tickers.length ? loadUsLedgers(tickers) : Promise.resolve({} as Record<string, CompanyLedger>), loadUsBatch(), loadUsBatch('prior'),
  ]);
  const freshness: Record<string, any> = {};
  const byState: Record<CompanyEvidenceState, number> = {
    NOT_SEARCHED: 0, EVIDENCE_INCOMPLETE: 0, CURRENT: 0, NEW_EVIDENCE_AVAILABLE: 0, STALE: 0, SOURCE_UNAVAILABLE: 0, RETRIEVAL_FAILED: 0,
  };
  let withEvidence = 0;
  for (const t of tickers) {
    const l = ledgers[t] || null;
    const f = usFreshness(l);
    freshness[t] = f;
    if (f.evidence_state) byState[f.evidence_state]++;
    if (l?.latest_period) withEvidence++;
  }
  return NextResponse.json({
    ok: true, tickers: tickers.length, ledgers, freshness,
    counts: { requested: tickers.length, with_evidence: withEvidence, remaining: tickers.length - withEvidence, by_state: byState },
    batch: batch ? { ...batch, ...batchProgress(batch, ledgers) } : null,
    prior_batch: priorBatch ? { ...priorBatch, ...batchProgress(priorBatch, ledgers) } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }
  const action = String(body?.action || '');

  if (action === 'thesis_type') {
    const ticker = String(body?.ticker || '').toUpperCase();
    const pattern = body?.pattern == null ? null : String(body.pattern).toUpperCase();
    if (!TICKER_RE.test(ticker) || (pattern !== null && !PATTERNS.has(pattern))) return NextResponse.json({ ok: false, error: 'ticker and pattern (A/B/F/G or null) are required' }, { status: 400 });
    const map = await loadUsThesisTypes();
    const aiMap = (await kvGet<AiMap>(US_AI_TYPES_KEY).catch(() => null)) || {};
    // zzz837: the owner's picker always wins — it also removes any AI record for the name.
    const r = applyUserType(map, aiMap, ticker, pattern);
    await Promise.all([saveUsThesisTypes(r.types), kvSet(US_AI_TYPES_KEY, r.ai)]); // no TTL: thesis type records
    return NextResponse.json({ ok: true, thesis_types: r.types, thesis_ai: r.ai });
  }
  if (action === 'status') {
    const ticker = String(body?.ticker || '').toUpperCase();
    const period = String(body?.period || '');
    const status = String(body?.status || '');
    if (!TICKER_RE.test(ticker) || !period || !status) return NextResponse.json({ ok: false, error: 'ticker, period and status are required' }, { status: 400 });
    const r = await persistUsStatus(ticker, period, status, body?.because ? String(body.because).slice(0, 600) : null, body?.tallies ?? null);
    return NextResponse.json({ ok: r.ok, error: r.error });
  }
  const kind: 'evidence' | 'prior' = body?.kind === 'prior' ? 'prior' : 'evidence';
  if (action === 'batch_start') {
    const tickers = Array.from(new Set((Array.isArray(body?.tickers) ? body.tickers : []).map((s: any) => String(s).toUpperCase()).filter((s: string) => TICKER_RE.test(s)))).slice(0, 400) as string[];
    if (!tickers.length) return NextResponse.json({ ok: false, error: 'tickers[] required' }, { status: 400 });
    const header: UsBatchHeader = { batch_id: `usbatch_${Date.now().toString(36)}`, started_at: new Date().toISOString(), finished_at: null, tickers, requested_by: kind === 'prior' ? 'us-portfolio-catalysts:prior-quarter' : 'us-portfolio-catalysts' };
    await saveUsBatch(header, kind);
    return NextResponse.json({ ok: true, batch: header });
  }
  if (action === 'batch_finish') {
    const b = await loadUsBatch(kind);
    if (!b) return NextResponse.json({ ok: false, error: 'no batch on file' });
    const done = { ...b, finished_at: new Date().toISOString() };
    await saveUsBatch(done, kind);
    return NextResponse.json({ ok: true, batch: done });
  }
  return NextResponse.json({ ok: false, error: `unknown action ${action}` }, { status: 400 });
}
