// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE STORE — the ledger's home in KV.                          (zzz740)
//
// Server-only. One key per company, the whole ledger as one document, so a
// save is one write and therefore atomic: the period, its facts, its events,
// the run and the status land together or not at all. A failed write is
// returned to the caller, never swallowed — the route reports
// `persisted: false` and the card says so instead of "Evidence updated".
//
// Key: evidence:ledger:v1:<TICKER>. No TTL: this is a database, not a cache.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet as realKvGet, kvSet as realKvSet } from '@/lib/kv';
import {
  emptyLedger, mergePeriodDetailed, recordAttempt, recordSeen, recordStatus, ledgerView,
  reportingPeriodForDocuments, factsFromEvents, documentId, migrateLedger,
  appendRunLog, buildRunLogEntry, runLogLine, unseenDocuments,
  type CompanyLedger, type PeriodRecord, type EvidenceRun, type LedgerDocument,
  type FailureKind, type MergeDiff, type RunLogEntry, type SeenDocument,
} from './evidence-ledger';
import type { StructuralEvent } from './evidence-extract';
import { bareSymbol } from './filing-dates';
import { isQuickReadPeriod, supersedeQuickRead, QUICK_READ_MODE } from './quick-read';

// Keyed by the BARE symbol: IFBAGRO and IFBAGRO-BE are one company and must
// share one ledger. A ledger written under a suffixed key before zzz765 is
// still read (LEGACY_KEY) and migrates on its next save.
const KEY = (t: string) => `evidence:ledger:v1:${bareSymbol(t)}`;
const LEGACY_KEY = (t: string) => `evidence:ledger:v1:${t.toUpperCase().trim()}`;
export const BATCH_KEY = 'evidence:batch:v1:latest';
/** The prior-quarter backfill keeps its own header, so its Resume never
 *  collides with the evidence batch's. Same shape, same derivation. (zzz765) */
export const PRIOR_BATCH_KEY = 'evidence:batch:v1:prior';

// ── THE KV SEAM (zzz770). Production uses @/lib/kv; tests inject an
// in-memory map so the whole persist → reload path runs without a network.
type KvLike = { get: <T = any>(k: string) => Promise<T | null>; set: (k: string, v: any) => Promise<void> };
let kv: KvLike = { get: realKvGet, set: (k, v) => realKvSet(k, v) };
/** Test-only: swap the store's KV (pass null to restore the real one). */
export function setEvidenceKvForTests(fake: KvLike | null): void {
  kv = fake || { get: realKvGet, set: (k, v) => realKvSet(k, v) };
}
const kvGet = <T = any>(k: string) => kv.get<T>(k);
const kvSet = (k: string, v: any) => kv.set(k, v);

/** One structured JSON line per evidence run (zzz770). */
function logRun(entry: RunLogEntry): void {
  try { console.log(runLogLine(entry)); } catch { /* logging never breaks a read */ }
}

/**
 * Load a company's ledger, upgraded IN MEMORY to the current schema
 * (migrateLedger). Nothing is written here: an old-shape ledger reaches KV in
 * the new shape only with its next real save.
 */
export async function loadLedger(ticker: string): Promise<CompanyLedger | null> {
  try {
    const ok = (l: CompanyLedger | null | undefined) => !!l && typeof l === 'object' && !!l.periods;
    const l = await kvGet<CompanyLedger>(KEY(ticker));
    if (ok(l)) return migrateLedger(l);
    if (LEGACY_KEY(ticker) !== KEY(ticker)) {
      const legacy = await kvGet<CompanyLedger>(LEGACY_KEY(ticker));
      if (ok(legacy)) return migrateLedger(legacy);
    }
    return null;
  } catch { return null; }
}

/** Bounded-parallel bulk load for the page. */
export async function loadLedgers(tickers: string[], concurrency = 16): Promise<Record<string, CompanyLedger>> {
  const out: Record<string, CompanyLedger> = {};
  let i = 0;
  const worker = async () => {
    while (i < tickers.length) {
      const t = tickers[i++];
      const l = await loadLedger(t);
      if (l) out[t.toUpperCase()] = ledgerView(l);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tickers.length) }, worker));
  return out;
}

export async function saveLedger(ledger: CompanyLedger): Promise<{ ok: boolean; error: string | null }> {
  try {
    await kvSet(KEY(ledger.ticker), ledger);
    // Read-back is the only proof the write landed: kvSet logs Redis errors
    // and returns, so a quota-exhausted store would otherwise "succeed".
    const back = await kvGet<CompanyLedger>(KEY(ledger.ticker));
    if (!back || back.updated_at !== ledger.updated_at) return { ok: false, error: 'write did not land in KV (read-back mismatch)' };
    return { ok: true, error: null };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

export interface PersistInput {
  ticker: string;
  market: 'IN' | 'US';
  runId: string;
  startedAt: string;
  documents: LedgerDocument[];
  filingDate?: string | null;
  events: StructuralEvent[];
  summary: any;
  discoveryState: string | null;
  discoveryAttempts: any[];
  promptVersion: string;
  model: string | null;
  rawExtraction: any;
  pipeline: any;
  /** Prior-quarter backfill: the period the documents must resolve to. When
   *  they resolve to anything else nothing is written, so a backfill can never
   *  merge into the current period. (zzz765) */
  expectPeriod?: string | null;
  /** read / incremental / force / check / prior — for the run log. */
  mode?: string | null;
}

/** A successful read: build the period record, merge, save. The result
 *  carries the merge diff, so a second read of the same documents reports
 *  NO_CHANGES instead of "updated". */
export async function persistEvidenceRun(inp: PersistInput): Promise<{ ledger: CompanyLedger; period: string; persisted: boolean; error: string | null; diff: MergeDiff | null; log: RunLogEntry | null }> {
  const now = new Date().toISOString();
  const rp = reportingPeriodForDocuments(inp.documents, inp.filingDate);
  if (inp.expectPeriod && rp.period !== inp.expectPeriod) {
    const existing = (await loadLedger(inp.ticker)) || emptyLedger(inp.ticker, inp.market, now);
    return { ledger: ledgerView(existing), period: rp.period, persisted: false, error: `documents resolve to ${rp.period}, not ${inp.expectPeriod} — nothing written`, diff: null, log: null };
  }
  const { facts, events } = factsFromEvents(inp.ticker, rp.period, inp.events, inp.documents, now);
  const period: PeriodRecord = {
    reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
    documents: inp.documents,
    documents_found: inp.documents.length,
    documents_read: inp.documents.filter((d) => d.outcome === 'read').length,
    documents_failed: inp.documents.filter((d) => d.outcome === 'download_failed' || d.outcome === 'scanned').length,
    documents_skipped: inp.documents.filter((d) => d.outcome === 'too_short' || d.outcome === 'budget_exhausted' || d.outcome === 'not_selected').length,
    facts, events, summary: inp.summary,
    status: null, status_because: null, tallies: null,
    discovery_state: inp.discoveryState, discovery_attempts: inp.discoveryAttempts,
    run_id: inp.runId, prompt_version: inp.promptVersion, model: inp.model,
    extracted_at: now, updated_at: now,
  };
  const run: EvidenceRun = {
    run_id: inp.runId, reporting_period: rp.period, started_at: inp.startedAt, finished_at: now,
    outcome: 'COMPLETED', error: null,
    documents_found: period.documents_found, documents_read: period.documents_read,
    facts_extracted: facts.length, events_extracted: events.length,
    model: inp.model, prompt_version: inp.promptVersion,
    raw_extraction_json: inp.rawExtraction, pipeline: inp.pipeline,
    mode: inp.mode ?? null, failure_kind: null,
  };
  const before = await loadLedger(inp.ticker);
  let existing = before || emptyLedger(inp.ticker, inp.market, now);
  // ── A QUICK READ NEVER OVERWRITES AN AI READ; AN AI READ SUPERSEDES A
  // QUICK READ. (zzz816) The deterministic read fills a period nobody read;
  // when the model later reads the same period its facts replace the
  // deterministic ones (archived as superseded, never deleted). A second
  // quick read of a quick-read period replaces the first the same way.
  const onFile = existing.periods[rp.period];
  if (inp.mode === QUICK_READ_MODE && onFile && !isQuickReadPeriod(onFile) && (onFile.documents_read || 0) > 0) {
    return { ledger: ledgerView(existing), period: rp.period, persisted: false, error: `${rp.period} was already read with AI — a read without AI never replaces it`, diff: null, log: null };
  }
  if (onFile && isQuickReadPeriod(onFile)) existing = supersedeQuickRead(existing, rp.period, now, inp.runId);
  const { ledger: merged0, diff } = mergePeriodDetailed(existing, period, run);
  const entry = buildRunLogEntry({ ticker: inp.ticker, run, before, after: merged0, diff, attempts: inp.discoveryAttempts });
  const merged = appendRunLog(merged0, entry);
  const saved = await saveLedger(merged);
  logRun({ ...entry, error: saved.ok ? entry.error : `persist failed: ${saved.error}` });
  return { ledger: ledgerView(merged), period: rp.period, persisted: saved.ok, error: saved.error, diff, log: entry };
}

/** A read that produced nothing: record it without touching evidence. */
export async function persistAttempt(ticker: string, market: 'IN' | 'US', runId: string, startedAt: string, outcome: EvidenceRun['outcome'], error: string | null, extra?: { documents_found?: number; newestSeenDate?: string | null; reportingPeriod?: string | null; failureKind?: FailureKind | null; mode?: string | null; attempts?: Array<{ source: string; outcome: string }>; unseen?: SeenDocument[] }): Promise<{ ledger: CompanyLedger; persisted: boolean }> {
  const now = new Date().toISOString();
  const run: EvidenceRun = {
    run_id: runId, reporting_period: extra?.reportingPeriod || null, started_at: startedAt, finished_at: now, outcome, error,
    documents_found: extra?.documents_found || 0, documents_read: 0, facts_extracted: 0, events_extracted: 0,
    model: null, prompt_version: null,
    failure_kind: outcome === 'SOURCE_UNAVAILABLE' || outcome === 'FAILED' ? (extra?.failureKind ?? null) : null,
    mode: extra?.mode ?? null,
  };
  const before = await loadLedger(ticker);
  let ledger = before || emptyLedger(ticker, market, now);
  ledger = recordAttempt(ledger, run);
  if (extra?.newestSeenDate || extra?.unseen?.length) ledger = recordSeen(ledger, extra?.newestSeenDate || null, now, extra?.unseen);
  const entry = buildRunLogEntry({ ticker, run, before, after: ledger, attempts: extra?.attempts });
  ledger = appendRunLog(ledger, entry);
  const saved = await saveLedger(ledger);
  logRun(entry);
  return { ledger: ledgerView(ledger), persisted: saved.ok };
}

/** A freshness check saw documents at a source. `candidates` (optional) are
 *  every document discovery listed; the ones no period lists yet become
 *  pending, so a new filing marks only THIS company NEW_EVIDENCE_AVAILABLE. */
export async function persistSeen(ticker: string, market: 'IN' | 'US', newestDocDate: string | null, candidates?: Array<{ url: string; kind: string; label?: string; dateIso?: string | null }>, meta?: { runId?: string; attempts?: Array<{ source: string; outcome: string }> }): Promise<CompanyLedger> {
  const now = new Date().toISOString();
  const before = await loadLedger(ticker);
  let ledger = before || emptyLedger(ticker, market, now);
  const unseen = candidates ? unseenDocuments(ledger, candidates, now) : [];
  ledger = recordSeen(ledger, newestDocDate, now, unseen);
  if (meta?.runId) {
    const run: EvidenceRun = { run_id: meta.runId, reporting_period: null, started_at: now, finished_at: now, outcome: 'SKIPPED_NO_NEW_EVIDENCE', error: null,
      documents_found: candidates?.length || 0, documents_read: 0, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null, mode: 'check' };
    const entry = { ...buildRunLogEntry({ ticker, run, before, after: ledger, attempts: meta.attempts }), documents_new: unseen.length };
    ledger = appendRunLog(ledger, entry);
    logRun(entry);
  }
  await saveLedger(ledger);
  return ledgerView(ledger);
}

export async function persistStatus(ticker: string, period: string, status: string, because: string | null, tallies: PeriodRecord['tallies']): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const ledger = await loadLedger(ticker);
  if (!ledger || !ledger.periods[period]) return { ok: false, error: `no ${period} evidence on file for ${ticker}` };
  return saveLedger(recordStatus(ledger, period, status, because, tallies, now));
}

export function docsFromRoute(read: Array<{ label: string; kind: string; source: string; tier?: number; period: string | null; url: string; dateIso?: string | null }>, outcomes: Array<{ url: string; label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string; hash?: string | null }>, candidates: Array<{ url: string; label: string; kind: string; source: string; tier?: number; period: string | null; dateIso: string | null }>): LedgerDocument[] {
  const byUrl = new Map<string, LedgerDocument>();
  for (const c of candidates) {
    byUrl.set(c.url, { id: documentId(c.url), url: c.url, label: c.label, kind: c.kind, source: c.source, tier: c.tier, period: c.period, date_iso: c.dateIso, outcome: 'not_selected' });
  }
  for (const o of outcomes) {
    const c = byUrl.get(o.url);
    byUrl.set(o.url, { ...(c || { id: documentId(o.url), url: o.url, label: o.label, kind: o.kind, source: 'unknown', period: null, date_iso: null }), outcome: o.outcome as LedgerDocument['outcome'], chars: o.chars, pages: o.pages, detail: o.detail, ...(o.hash ? { content_hash: o.hash } : {}) });
  }
  void read;
  return Array.from(byUrl.values());
}

// ── batch job header ───────────────────────────────────────────────────────

export interface BatchHeader { batch_id: string; started_at: string; finished_at: string | null; tickers: string[]; requested_by: string }

export async function loadBatch(kind: 'evidence' | 'prior' = 'evidence'): Promise<BatchHeader | null> {
  try { return (await kvGet<BatchHeader>(kind === 'prior' ? PRIOR_BATCH_KEY : BATCH_KEY)) || null; } catch { return null; }
}
export async function saveBatch(b: BatchHeader, kind: 'evidence' | 'prior' = 'evidence'): Promise<void> { await kvSet(kind === 'prior' ? PRIOR_BATCH_KEY : BATCH_KEY, b); }
