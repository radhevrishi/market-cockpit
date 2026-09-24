// ═══════════════════════════════════════════════════════════════════════════
// US EVIDENCE STORE — the US ledgers' home in KV.                    (zzz790)
//
// The same ledger document, built by the same pure functions as India's
// (lib/thesis/evidence-ledger: mergePeriodDetailed, factsFromEvents,
// recordAttempt, recordSeen, recordStatus, …) — only the KEYS differ, so no
// US read can touch an India ledger and vice versa:
//
//   us-evidence:ledger:v1:<TICKER>     one ledger per company (no TTL)
//   us-evidence:batch:v1:latest        the "read evidence" job header
//   us-evidence:batch:v1:prior         the prior-quarter job header
//   us-thesis:types:v1                 thesis types (A/B/F/G) the owner set
//
// The India store (lib/thesis/evidence-store) is not imported for its KV at
// all; it is owned by another workstream and keyed `evidence:ledger:v1:*`.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet as realKvGet, kvSet as realKvSet } from '@/lib/kv';
import {
  emptyLedger, mergePeriodDetailed, recordAttempt, recordSeen, recordStatus, ledgerView,
  reportingPeriodForDocuments, factsFromEvents, migrateLedger,
  appendRunLog, buildRunLogEntry, runLogLine, unseenDocuments,
  type CompanyLedger, type PeriodRecord, type EvidenceRun, type LedgerDocument,
  type FailureKind, type MergeDiff, type RunLogEntry, type SeenDocument,
} from '@/lib/thesis/evidence-ledger';
import type { StructuralEvent } from '@/lib/thesis/evidence-extract';

const tickerKey = (t: string) => String(t || '').toUpperCase().trim().replace(/[./]/g, '-');
export const US_LEDGER_KEY = (t: string) => `us-evidence:ledger:v1:${tickerKey(t)}`;
export const US_BATCH_KEY = 'us-evidence:batch:v1:latest';
export const US_PRIOR_BATCH_KEY = 'us-evidence:batch:v1:prior';
export const US_THESIS_TYPES_KEY = 'us-thesis:types:v1';

type KvLike = { get: <T = any>(k: string) => Promise<T | null>; set: (k: string, v: any) => Promise<void> };
let kv: KvLike = { get: realKvGet, set: (k, v) => realKvSet(k, v) };
/** Test-only: swap the store's KV (null restores the real one). */
export function setUsEvidenceKvForTests(fake: KvLike | null): void {
  kv = fake || { get: realKvGet, set: (k, v) => realKvSet(k, v) };
}

function logRun(entry: RunLogEntry): void {
  try { console.log(`[us] ${runLogLine(entry)}`); } catch { /* logging never breaks a read */ }
}

export async function loadUsLedger(ticker: string): Promise<CompanyLedger | null> {
  try {
    const l = await kv.get<CompanyLedger>(US_LEDGER_KEY(ticker));
    if (!l || typeof l !== 'object' || !l.periods) return null;
    // zzz793: a ledger stored under this key that names ANOTHER company is
    // never handed out as this one's (one company per ledger, always).
    if (l.ticker && tickerKey(l.ticker) !== tickerKey(ticker)) {
      try { console.warn(`[us] ledger under ${US_LEDGER_KEY(ticker)} names ${l.ticker} — ignored`); } catch { /* noop */ }
      return null;
    }
    return migrateLedger(l);
  } catch { return null; }
}

export async function loadUsLedgers(tickers: string[], concurrency = 16): Promise<Record<string, CompanyLedger>> {
  const out: Record<string, CompanyLedger> = {};
  let i = 0;
  const worker = async () => {
    while (i < tickers.length) {
      const t = tickers[i++];
      const l = await loadUsLedger(t);
      if (l) out[tickerKey(t)] = ledgerView(l);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tickers.length) }, worker));
  return out;
}

export async function saveUsLedger(ledger0: CompanyLedger, ticker?: string): Promise<{ ok: boolean; error: string | null }> {
  // zzz793: written under the ticker the run is FOR, and the document says so.
  const t = tickerKey(ticker || ledger0.ticker);
  if (!t) return { ok: false, error: 'no ticker for the ledger — nothing written' };
  const ledger = ledger0.ticker === t ? ledger0 : { ...ledger0, ticker: t };
  try {
    await kv.set(US_LEDGER_KEY(t), ledger);
    const back = await kv.get<CompanyLedger>(US_LEDGER_KEY(t));
    if (!back || back.updated_at !== ledger.updated_at) return { ok: false, error: 'write did not land in KV (read-back mismatch)' };
    return { ok: true, error: null };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

export interface UsPersistInput {
  ticker: string;
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
  expectPeriod?: string | null;
  mode?: string | null;
}

/** The India persist path, verbatim in logic, on the US keys. */
export async function persistUsEvidenceRun(inp: UsPersistInput): Promise<{ ledger: CompanyLedger; period: string; persisted: boolean; error: string | null; diff: MergeDiff | null; log: RunLogEntry | null }> {
  const now = new Date().toISOString();
  // zzz793: a catalyst press release (kind 'announcement') is evidence, but
  // the quarter is decided by the results documents only.
  const rp = reportingPeriodForDocuments(inp.documents.filter((d) => d.kind !== 'announcement'), inp.filingDate);
  if (inp.expectPeriod && rp.period !== inp.expectPeriod) {
    const existing = (await loadUsLedger(inp.ticker)) || emptyLedger(tickerKey(inp.ticker), 'US', now);
    return { ledger: ledgerView(existing), period: rp.period, persisted: false, error: `documents resolve to ${rp.period}, not ${inp.expectPeriod} — nothing written`, diff: null, log: null };
  }
  const { facts, events } = factsFromEvents(tickerKey(inp.ticker), rp.period, inp.events, inp.documents, now);
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
  const before = await loadUsLedger(inp.ticker);
  const existing = before || emptyLedger(tickerKey(inp.ticker), 'US', now);
  const { ledger: merged0, diff } = mergePeriodDetailed(existing, period, run);
  const entry = buildRunLogEntry({ ticker: tickerKey(inp.ticker), run, before, after: merged0, diff, attempts: inp.discoveryAttempts });
  const merged = appendRunLog(merged0, entry);
  const saved = await saveUsLedger(merged, inp.ticker);
  logRun({ ...entry, error: saved.ok ? entry.error : `persist failed: ${saved.error}` });
  return { ledger: ledgerView(merged), period: rp.period, persisted: saved.ok, error: saved.error, diff, log: entry };
}

export async function persistUsAttempt(ticker: string, runId: string, startedAt: string, outcome: EvidenceRun['outcome'], error: string | null, extra?: { documents_found?: number; newestSeenDate?: string | null; reportingPeriod?: string | null; failureKind?: FailureKind | null; mode?: string | null; attempts?: Array<{ source: string; outcome: string }>; unseen?: SeenDocument[] }): Promise<{ ledger: CompanyLedger; persisted: boolean }> {
  const now = new Date().toISOString();
  const run: EvidenceRun = {
    run_id: runId, reporting_period: extra?.reportingPeriod || null, started_at: startedAt, finished_at: now, outcome, error,
    documents_found: extra?.documents_found || 0, documents_read: 0, facts_extracted: 0, events_extracted: 0,
    model: null, prompt_version: null,
    failure_kind: outcome === 'SOURCE_UNAVAILABLE' || outcome === 'FAILED' ? (extra?.failureKind ?? null) : null,
    mode: extra?.mode ?? null,
  };
  const before = await loadUsLedger(ticker);
  let ledger = before || emptyLedger(tickerKey(ticker), 'US', now);
  ledger = recordAttempt(ledger, run);
  if (extra?.newestSeenDate || extra?.unseen?.length) ledger = recordSeen(ledger, extra?.newestSeenDate || null, now, extra?.unseen);
  const entry = buildRunLogEntry({ ticker: tickerKey(ticker), run, before, after: ledger, attempts: extra?.attempts });
  ledger = appendRunLog(ledger, entry);
  const saved = await saveUsLedger(ledger, ticker);
  logRun(entry);
  return { ledger: ledgerView(ledger), persisted: saved.ok };
}

export async function persistUsSeen(ticker: string, newestDocDate: string | null, candidates: Array<{ url: string; kind: string; label?: string; dateIso?: string | null }>, meta?: { runId?: string; attempts?: Array<{ source: string; outcome: string }> }): Promise<{ ledger: CompanyLedger; unseen: SeenDocument[] }> {
  const now = new Date().toISOString();
  const before = await loadUsLedger(ticker);
  let ledger = before || emptyLedger(tickerKey(ticker), 'US', now);
  const unseen = unseenDocuments(ledger, candidates, now);
  ledger = recordSeen(ledger, newestDocDate, now, unseen);
  if (meta?.runId) {
    const run: EvidenceRun = { run_id: meta.runId, reporting_period: null, started_at: now, finished_at: now, outcome: 'SKIPPED_NO_NEW_EVIDENCE', error: null,
      documents_found: candidates.length, documents_read: 0, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null, mode: 'check' };
    const entry = { ...buildRunLogEntry({ ticker: tickerKey(ticker), run, before, after: ledger, attempts: meta.attempts }), documents_new: unseen.length };
    ledger = appendRunLog(ledger, entry);
    logRun(entry);
  }
  await saveUsLedger(ledger, ticker);
  return { ledger: ledgerView(ledger), unseen };
}

export async function persistUsStatus(ticker: string, period: string, status: string, because: string | null, tallies: PeriodRecord['tallies']): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const ledger = await loadUsLedger(ticker);
  if (!ledger || !ledger.periods[period]) return { ok: false, error: `no ${period} evidence on file for ${ticker}` };
  return saveUsLedger(recordStatus(ledger, period, status, because, tallies, now), ticker);
}

export interface UsBatchHeader { batch_id: string; started_at: string; finished_at: string | null; tickers: string[]; requested_by: string }

export async function loadUsBatch(kind: 'evidence' | 'prior' = 'evidence'): Promise<UsBatchHeader | null> {
  try { return (await kv.get<UsBatchHeader>(kind === 'prior' ? US_PRIOR_BATCH_KEY : US_BATCH_KEY)) || null; } catch { return null; }
}
export async function saveUsBatch(b: UsBatchHeader, kind: 'evidence' | 'prior' = 'evidence'): Promise<void> {
  await kv.set(kind === 'prior' ? US_PRIOR_BATCH_KEY : US_BATCH_KEY, b);
}

export async function loadUsThesisTypes(): Promise<Record<string, string>> {
  try { return (await kv.get<Record<string, string>>(US_THESIS_TYPES_KEY)) || {}; } catch { return {}; }
}
export async function saveUsThesisTypes(map: Record<string, string>): Promise<void> {
  await kv.set(US_THESIS_TYPES_KEY, map);
}
