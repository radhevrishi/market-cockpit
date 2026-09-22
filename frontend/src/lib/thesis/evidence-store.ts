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

import { kvGet, kvSet } from '@/lib/kv';
import {
  emptyLedger, mergePeriod, recordAttempt, recordSeen, recordStatus, ledgerView,
  reportingPeriodForDocuments, factsFromEvents, documentId,
  type CompanyLedger, type PeriodRecord, type EvidenceRun, type LedgerDocument,
} from './evidence-ledger';
import type { StructuralEvent } from './evidence-extract';
import { bareSymbol } from './filing-dates';

// Keyed by the BARE symbol: IFBAGRO and IFBAGRO-BE are one company and must
// share one ledger. A ledger written under a suffixed key before zzz765 is
// still read (LEGACY_KEY) and migrates on its next save.
const KEY = (t: string) => `evidence:ledger:v1:${bareSymbol(t)}`;
const LEGACY_KEY = (t: string) => `evidence:ledger:v1:${t.toUpperCase().trim()}`;
export const BATCH_KEY = 'evidence:batch:v1:latest';
/** The prior-quarter backfill keeps its own header, so its Resume never
 *  collides with the evidence batch's. Same shape, same derivation. (zzz765) */
export const PRIOR_BATCH_KEY = 'evidence:batch:v1:prior';

export async function loadLedger(ticker: string): Promise<CompanyLedger | null> {
  try {
    const ok = (l: CompanyLedger | null | undefined) => !!l && typeof l === 'object' && !!l.periods;
    const l = await kvGet<CompanyLedger>(KEY(ticker));
    if (ok(l)) return l!;
    if (LEGACY_KEY(ticker) !== KEY(ticker)) {
      const legacy = await kvGet<CompanyLedger>(LEGACY_KEY(ticker));
      if (ok(legacy)) return legacy!;
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
}

/** A successful read: build the period record, merge, save. */
export async function persistEvidenceRun(inp: PersistInput): Promise<{ ledger: CompanyLedger; period: string; persisted: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const rp = reportingPeriodForDocuments(inp.documents, inp.filingDate);
  if (inp.expectPeriod && rp.period !== inp.expectPeriod) {
    const existing = (await loadLedger(inp.ticker)) || emptyLedger(inp.ticker, inp.market, now);
    return { ledger: ledgerView(existing), period: rp.period, persisted: false, error: `documents resolve to ${rp.period}, not ${inp.expectPeriod} — nothing written` };
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
  };
  const existing = (await loadLedger(inp.ticker)) || emptyLedger(inp.ticker, inp.market, now);
  const merged = mergePeriod(existing, period, run);
  const saved = await saveLedger(merged);
  return { ledger: ledgerView(merged), period: rp.period, persisted: saved.ok, error: saved.error };
}

/** A read that produced nothing: record it without touching evidence. */
export async function persistAttempt(ticker: string, market: 'IN' | 'US', runId: string, startedAt: string, outcome: EvidenceRun['outcome'], error: string | null, extra?: { documents_found?: number; newestSeenDate?: string | null; reportingPeriod?: string | null }): Promise<{ ledger: CompanyLedger; persisted: boolean }> {
  const now = new Date().toISOString();
  const run: EvidenceRun = {
    run_id: runId, reporting_period: extra?.reportingPeriod || null, started_at: startedAt, finished_at: now, outcome, error,
    documents_found: extra?.documents_found || 0, documents_read: 0, facts_extracted: 0, events_extracted: 0,
    model: null, prompt_version: null,
  };
  let ledger = (await loadLedger(ticker)) || emptyLedger(ticker, market, now);
  ledger = recordAttempt(ledger, run);
  if (extra?.newestSeenDate) ledger = recordSeen(ledger, extra.newestSeenDate, now);
  const saved = await saveLedger(ledger);
  return { ledger: ledgerView(ledger), persisted: saved.ok };
}

/** A freshness check saw documents at a source. */
export async function persistSeen(ticker: string, market: 'IN' | 'US', newestDocDate: string | null): Promise<CompanyLedger> {
  const now = new Date().toISOString();
  let ledger = (await loadLedger(ticker)) || emptyLedger(ticker, market, now);
  ledger = recordSeen(ledger, newestDocDate, now);
  await saveLedger(ledger);
  return ledgerView(ledger);
}

export async function persistStatus(ticker: string, period: string, status: string, because: string | null, tallies: PeriodRecord['tallies']): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const ledger = await loadLedger(ticker);
  if (!ledger || !ledger.periods[period]) return { ok: false, error: `no ${period} evidence on file for ${ticker}` };
  return saveLedger(recordStatus(ledger, period, status, because, tallies, now));
}

export function docsFromRoute(read: Array<{ label: string; kind: string; source: string; tier?: number; period: string | null; url: string; dateIso?: string | null }>, outcomes: Array<{ url: string; label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string }>, candidates: Array<{ url: string; label: string; kind: string; source: string; tier?: number; period: string | null; dateIso: string | null }>): LedgerDocument[] {
  const byUrl = new Map<string, LedgerDocument>();
  for (const c of candidates) {
    byUrl.set(c.url, { id: documentId(c.url), url: c.url, label: c.label, kind: c.kind, source: c.source, tier: c.tier, period: c.period, date_iso: c.dateIso, outcome: 'not_selected' });
  }
  for (const o of outcomes) {
    const c = byUrl.get(o.url);
    byUrl.set(o.url, { ...(c || { id: documentId(o.url), url: o.url, label: o.label, kind: o.kind, source: 'unknown', period: null, date_iso: null }), outcome: o.outcome as LedgerDocument['outcome'], chars: o.chars, pages: o.pages, detail: o.detail });
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
