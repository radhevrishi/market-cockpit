// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-thesis/read — READ ONE US COMPANY'S SEC EVIDENCE.         (zzz790)
//
// The US twin of /api/v1/india/ai-summary, writing to the US ledger keys.
//
//   mode=check        discovery only — EDGAR lists 10-Q / 10-K / 8-K Item
//                     2.02 filings; any not on file are recorded as pending,
//                     so the company reads NEW EVIDENCE AVAILABLE. No model.
//   mode=incremental  read only if EDGAR lists a filing newer than the
//                     latest period on file; otherwise SKIPPED (no model).
//   mode=read         (default) a stored period answers without a model;
//                     otherwise read and persist.
//   mode=prior        read the quarter BEFORE the latest on file (its own
//                     10-Q + earnings release), stored as its own period, so
//                     a level gets a before.
//   force=1           re-read the current period.
//
// AI, ONLY WHERE INDIA USES IT: one summary call (the shared SUMMARY_TOOL
// and prompt, with a US addendum) and the shared structural-event extractor
// — which makes no call when the documents hold no structural passage. Both
// go through lib/anthropic-meter (anthropicMessages → the configured
// provider). Every figure is verified against the documents before it is
// kept. No price is read anywhere in this route.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { tickerToCik, submissions, companyFacts } from '@/lib/us-edgar';
import { anthropicMessages, activeModel, modelConfigured, modelKeyName } from '@/lib/anthropic-meter';
import { SUMMARY_TOOL } from '@/lib/earnings/ai-summary-shared';
import { extractStructuralEvents, type StructuralEvent, type ExtractionPipeline } from '@/lib/thesis/evidence-extract';
import { latestSummary, unseenDocuments, periodOrdinal, contentHash } from '@/lib/thesis/evidence-ledger';
import { previousPeriod } from '@/lib/thesis/prior-period';
import {
  loadUsLedger, persistUsEvidenceRun, persistUsAttempt, persistUsSeen,
} from '@/lib/us-thesis/evidence-store';
import {
  US_SYSTEM, usCandidatesFromSubmissions, planUsRead, usLedgerDocuments, verifyUsSummary, deterministicUsFacts, fiscalLabelFor,
  type UsDocCandidate, type UsDocOutcome,
} from '@/lib/us-thesis/adapter';
import { readUsDocument } from '@/lib/us-thesis/sec-docs';
import { usFreshness } from '@/lib/us-thesis/calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MODEL = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'us-thesis-read-v1';
const MAX_CHARS = 140_000;
const TICKER_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

type Attempt = { source: string; outcome: 'ok' | 'empty' | 'error'; detail: string; found: number };

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: any;
  const timer = new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); });
  try { return await Promise.race([p, timer]); } finally { clearTimeout(t); }
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const ticker = String(sp.get('ticker') || '').trim().toUpperCase().replace(/[./ ]/g, '-');
  const mode = (String(sp.get('mode') || 'read').trim()) as 'read' | 'incremental' | 'check' | 'prior';
  const force = sp.get('force') === '1';
  if (!TICKER_RE.test(ticker)) return NextResponse.json({ ok: false, error: 'a valid ticker is required' }, { status: 400 });

  const runId = `usrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const ledgerBefore = await loadUsLedger(ticker);
  const runMode = force ? 'force' : mode;

  // ── PRIOR QUARTER: the period immediately before the latest on file.
  const priorTarget = mode === 'prior' ? previousPeriod(ledgerBefore?.latest_period) : null;
  if (mode === 'prior' && !priorTarget) {
    return NextResponse.json({ ok: false, error: `No period is on file for ${ticker}, so there is no prior quarter to read.` }, { status: 400 });
  }
  if (priorTarget && !force && ledgerBefore?.periods?.[priorTarget]?.summary) {
    const have = ledgerBefore.periods[priorTarget];
    return NextResponse.json({ ok: true, cached: true, from_ledger: true, ticker, target_period: priorTarget, structured: have.summary, events: have.events, ledger: ledgerBefore, reporting_period: priorTarget, persisted: true });
  }
  // ── THE LEDGER ANSWERS A PLAIN READ. No discovery, no model.
  if (mode === 'read' && !force) {
    const stored = latestSummary(ledgerBefore);
    if (stored) {
      return NextResponse.json({
        ok: true, cached: true, from_ledger: true, ticker,
        source_url: stored.period.documents.find((d) => d.outcome === 'read')?.url || null,
        structured: stored.summary, events: stored.period.events, documents_read: stored.period.documents.filter((d) => d.outcome === 'read'),
        discovery_attempts: stored.period.discovery_attempts, discovery_state: stored.period.discovery_state,
        document_outcomes: stored.period.documents.filter((d) => d.outcome !== 'not_selected'),
        ledger: ledgerBefore, reporting_period: stored.period.reporting_period, persisted: true,
      });
    }
  }

  // ── DISCOVERY (SEC EDGAR, no model) ─────────────────────────────────────
  const attempts: Attempt[] = [];
  const cik = await tickerToCik(ticker).catch(() => null);
  if (!cik) {
    attempts.push({ source: 'SEC company list', outcome: 'empty', detail: `${ticker} is not an SEC filer`, found: 0 });
    const a = await persistUsAttempt(ticker, runId, startedAt, 'NO_DISCLOSURE', `${ticker} is not in the SEC company list — no SEC filings exist to read`, { mode: runMode, attempts });
    return NextResponse.json({ ok: false, state: 'SEARCH_EXHAUSTED', error: `${ticker} is not in the SEC company list, so there are no SEC filings to read. (A non-US listing or a delisted name.)`, discovery_attempts: attempts, ledger: a.ledger, persisted: a.persisted });
  }
  const subs = await submissions(cik).catch(() => null);
  if (!subs) {
    attempts.push({ source: 'SEC EDGAR submissions', outcome: 'error', detail: 'EDGAR did not answer', found: 0 });
    const a = await persistUsAttempt(ticker, runId, startedAt, 'SOURCE_UNAVAILABLE', 'SEC EDGAR submissions could not be reached', { failureKind: 'source_unreachable', mode: runMode, attempts });
    return NextResponse.json({ ok: false, state: 'RETRIEVAL_FAILED', error: 'SEC EDGAR could not be reached — this is a retrieval failure, not an absence of disclosure. Retry later.', discovery_attempts: attempts, ledger: a.ledger, persisted: a.persisted, freshness: usFreshness(a.ledger) });
  }
  const now = new Date();
  const all = usCandidatesFromSubmissions(subs.recent, cik, now, { includeSixK: mode !== 'check' });
  const firm = all.filter((c) => c.form !== '6-K');   // what counts as NEW evidence
  attempts.push({ source: 'SEC EDGAR submissions', outcome: all.length ? 'ok' : 'empty', detail: `${firm.length} 10-Q / 10-K / 8-K Item 2.02 filings in the window${all.length > firm.length ? ` (+${all.length - firm.length} 6-K)` : ''}`, found: all.length });

  const unseen = priorTarget ? [] : unseenDocuments(ledgerBefore, firm.map((c) => ({ url: c.url, kind: c.kind, label: c.label, dateIso: c.dateIso })), startedAt);
  const newestDate = firm.map((c) => c.dateIso).sort().pop() || null;
  const newestPeriod = firm[0]?.period || null;
  const latestOnFile = ledgerBefore?.latest_period || null;
  const latestOnFileDate = ledgerBefore?.latest_document_date || null;
  const hasNewer = (!!newestDate && (!latestOnFile
    || (newestPeriod != null && periodOrdinal(newestPeriod) > periodOrdinal(latestOnFile))
    || (!!latestOnFileDate && newestDate > latestOnFileDate))) || (!!latestOnFile && unseen.length > 0);

  if (mode === 'check') {
    const seen = await persistUsSeen(ticker, newestDate, firm.map((c) => ({ url: c.url, kind: c.kind, label: c.label, dateIso: c.dateIso })), { runId, attempts });
    return NextResponse.json({
      ok: true, mode: 'check', ticker, new_evidence: hasNewer,
      unseen_documents: seen.unseen.map((d) => ({ label: d.label, kind: d.kind, date: d.date_iso, period: d.reporting_period })),
      newest_document_date: newestDate, newest_period: newestPeriod, latest_period_on_file: latestOnFile,
      candidates: firm.slice(0, 8).map((c) => ({ label: c.label, kind: c.kind, period: c.period, date: c.dateIso, source: c.source })),
      discovery_state: firm.length ? 'EVIDENCE_FOUND' : 'SEARCH_EXHAUSTED', discovery_attempts: attempts,
      freshness: usFreshness(seen.ledger), ledger: seen.ledger,
    });
  }

  if (mode === 'incremental' && !force && latestOnFile && !hasNewer) {
    const stored = latestSummary(ledgerBefore);
    const { ledger } = await persistUsAttempt(ticker, runId, startedAt, 'SKIPPED_NO_NEW_EVIDENCE', null, { documents_found: firm.length, newestSeenDate: newestDate, mode: runMode, attempts });
    return NextResponse.json({
      ok: true, skipped: 'SKIPPED_NO_NEW_EVIDENCE', cached: true, from_ledger: true,
      structured: stored?.summary || null, events: stored?.period.events || [],
      reporting_period: latestOnFile, ledger, persisted: true,
      note: `No SEC filing newer than ${latestOnFileDate || latestOnFile} on EDGAR. Evidence remains current.`,
    });
  }

  const plan = planUsRead(all, priorTarget);
  if (!plan.docs.length) {
    const why = priorTarget
      ? `EDGAR lists no 10-Q / 10-K / earnings release for ${priorTarget} for ${ticker}.`
      : `EDGAR lists no 10-Q, 10-K or 8-K earnings release for ${ticker} in the last 15 months.`;
    const a = await persistUsAttempt(ticker, runId, startedAt, 'NO_DISCLOSURE', why, { documents_found: all.length, mode: runMode, attempts, ...(priorTarget ? { reportingPeriod: priorTarget } : {}) });
    return NextResponse.json({ ok: false, state: 'SEARCH_EXHAUSTED', error: why, discovery_attempts: attempts, ledger: a.ledger, persisted: a.persisted });
  }
  if (!modelConfigured()) {
    return NextResponse.json({ ok: false, error: `The summary service is not configured on this deployment (${modelKeyName()} missing).` });
  }

  // ── READ THE DOCUMENTS ───────────────────────────────────────────────────
  let budget = MAX_CHARS;
  const read: Array<{ cand: UsDocCandidate; text: string }> = [];
  const outcomes: Array<{ url: string; outcome: UsDocOutcome; chars?: number; detail?: string; docUrl?: string | null; hash?: string | null }> = [];
  const queue = [...plan.docs];
  // A 6-K that is not a release is replaced by the next 6-K of the period.
  const spareSixK = all.filter((c) => c.form === '6-K' && c.period === plan.period && !queue.includes(c));
  while (queue.length) {
    const c = queue.shift()!;
    if (budget < 10_000) { outcomes.push({ url: c.url, outcome: 'budget_exhausted' }); continue; }
    const r = await readUsDocument(cik, c, budget);
    if (r.outcome !== 'read') {
      outcomes.push({ url: c.url, outcome: r.outcome, detail: r.detail, docUrl: r.docUrl });
      if (c.form === '6-K' && spareSixK.length) queue.push(spareSixK.shift()!);
      continue;
    }
    budget -= r.text.length;
    outcomes.push({ url: c.url, outcome: 'read', chars: r.text.length, docUrl: r.docUrl, hash: contentHash(r.text) });
    read.push({ cand: c, text: r.text });
  }
  const documents = usLedgerDocuments(all.filter((c) => c.form !== '6-K' || outcomes.some((o) => o.url === c.url)), outcomes);

  if (!read.length) {
    const failed = outcomes.some((o) => o.outcome === 'download_failed');
    const why = outcomes.map((o) => `${all.find((c) => c.url === o.url)?.label || o.url}: ${o.outcome.replace('_', ' ')}${o.detail ? ` (${o.detail})` : ''}`).join('; ');
    const a = await persistUsAttempt(ticker, runId, startedAt, failed ? 'SOURCE_UNAVAILABLE' : 'NO_DISCLOSURE', why.slice(0, 400),
      { documents_found: all.length, failureKind: failed ? 'document_unreadable' : null, mode: runMode, attempts, ...(priorTarget ? { reportingPeriod: priorTarget } : {}) });
    return NextResponse.json({
      ok: false, state: failed ? 'RETRIEVAL_FAILED' : 'SEARCH_EXHAUSTED',
      error: failed ? `The SEC documents exist but could not be downloaded (${why}). This is a retrieval failure, not an absence of disclosure.` : `Nothing readable: ${why}`,
      discovery_attempts: attempts, document_outcomes: documents.filter((d) => d.outcome !== 'not_selected'), ledger: a.ledger, persisted: a.persisted,
    });
  }

  // The company's own fiscal quarter, from its XBRL tags (bounded; optional).
  const periodic = read.find((r) => r.cand.role === 'periodic')?.cand || plan.docs.find((d) => d.role === 'periodic') || null;
  const facts = periodic?.reportDate ? await withTimeout(companyFacts(cik).catch(() => null), 8_000, null) : null;
  const fiscalLabel = periodic?.reportDate ? fiscalLabelFor(facts, periodic.reportDate) : null;

  const text = read.map(({ cand, text: t }) => `### SOURCE: ${cand.label} (${cand.form}, SEC EDGAR)\n${t}`).join('\n\n');
  const det = deterministicUsFacts(read.map(({ cand, text: t }) => ({ label: cand.label, text: t, role: cand.role })));

  // ── THE SUMMARY CALL (shared tool + prompt, US addendum) ─────────────────
  let data: any = null;
  try {
    const resp = await anthropicMessages('us-catalysts-summary', {
      model: activeModel(MODEL), max_tokens: 4096, system: US_SYSTEM,
      tools: [SUMMARY_TOOL], tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
      messages: [{ role: 'user', content: `${ticker}${fiscalLabel ? ` — ${fiscalLabel}` : ''}${periodic?.reportDate ? ` (quarter ended ${periodic.reportDate})` : ''}\n\n${text}` }],
    }, { signal: AbortSignal.timeout(70_000) });
    if (!resp.ok) {
      let detail = '';
      try { const t = await resp.text(); const je = JSON.parse(t); detail = String(je?.error?.message || je?.message || t).slice(0, 300); } catch { /* status alone */ }
      const a = await persistUsAttempt(ticker, runId, startedAt, 'FAILED', `model API HTTP ${resp.status}${detail ? `: ${detail}` : ''}`, { documents_found: all.length, failureKind: 'model_failed', mode: runMode, attempts });
      return NextResponse.json({ ok: false, state: 'RETRIEVAL_FAILED', error: `The summary service returned HTTP ${resp.status}${detail ? `: ${detail}` : '.'}`, ledger: a.ledger, persisted: a.persisted, discovery_attempts: attempts });
    }
    const j = await resp.json();
    data = (j?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === SUMMARY_TOOL.name)?.input || null;
  } catch (e: any) {
    const a = await persistUsAttempt(ticker, runId, startedAt, 'FAILED', `model API: ${String(e?.message || e)}`.slice(0, 300), { documents_found: all.length, failureKind: 'model_failed', mode: runMode, attempts });
    return NextResponse.json({ ok: false, state: 'RETRIEVAL_FAILED', error: `The summary service did not answer (${String(e?.message || e)}).`, ledger: a.ledger, persisted: a.persisted, discovery_attempts: attempts });
  }
  if (!data) {
    const a = await persistUsAttempt(ticker, runId, startedAt, 'FAILED', 'the summary service answered without filing a result', { documents_found: all.length, failureKind: 'model_failed', mode: runMode, attempts });
    return NextResponse.json({ ok: false, error: 'The summary service answered without filing a result.', ledger: a.ledger, persisted: a.persisted });
  }
  const v = verifyUsSummary(data, text);
  if (v.rejected) {
    const a = await persistUsAttempt(ticker, runId, startedAt, 'FAILED', v.rejected, { documents_found: all.length, failureKind: 'model_failed', mode: runMode, attempts });
    return NextResponse.json({ ok: false, error: `The summary cited figures that do not appear in the SEC documents (${v.dropped.slice(0, 3).join(', ')}), so it was discarded rather than shown.`, ledger: a.ledger, persisted: a.persisted });
  }
  data = v.data;

  // ── THE STRUCTURAL EVENTS (shared extractor; no call without passages) ───
  let events: StructuralEvent[] = [];
  let pipeline: ExtractionPipeline | null = null;
  let rawExtraction: any = null;
  try {
    const r = await extractStructuralEvents(read.map(({ cand, text: t }) => ({ label: cand.label, kind: cand.kind, text: t })), ticker, { model: activeModel(MODEL) });
    events = r.events; pipeline = r.pipeline; rawExtraction = (r as any).raw ?? null;
  } catch (e: any) {
    pipeline = { passages_by_family: det.byFamily, passages_sent: 0, events_returned: 0, events_kept: 0, events_by_family: {}, dropped: [], model_error: String(e?.message || e) };
  }
  data.events = events;
  data.us_fiscal = { label: fiscalLabel, quarter_end: periodic?.reportDate || null, note: 'the company\'s own fiscal quarter; the ledger period key is the calendar quarter the filing date resolves to' };

  const persisted = await persistUsEvidenceRun({
    ticker, runId, startedAt, documents, filingDate: plan.docs.map((d) => d.dateIso).sort().pop() || null,
    events, summary: data, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: attempts,
    promptVersion: PROMPT_VERSION, model: activeModel(MODEL),
    rawExtraction: { events_call: rawExtraction, pipeline, deterministic: { byFamily: det.byFamily, release: det.release } },
    pipeline, expectPeriod: priorTarget, mode: runMode,
  });
  const readDocs = documents.filter((d) => d.outcome === 'read');
  return NextResponse.json({
    ok: true, cached: false, ticker, structured: data, events, evidence_pipeline: pipeline,
    source_url: readDocs[0]?.url || null, us_fiscal_label: fiscalLabel,
    documents_read: readDocs.map((d) => ({ label: d.label, kind: d.kind, source: d.source, tier: d.tier, period: d.period, url: d.url })),
    discovery_attempts: attempts, discovery_state: 'EVIDENCE_FOUND',
    document_outcomes: documents.filter((d) => d.outcome !== 'not_selected'),
    dropped_figures: v.dropped.slice(0, 5), target_period: priorTarget,
    reporting_period: persisted.period, ledger: persisted.ledger,
    persisted: persisted.persisted, persist_error: persisted.error, changes: persisted.diff,
  });
}
