// ═══════════════════════════════════════════════════════════════════════════
// US READS INTO THE LEDGER.                                          (zzz770)
//
// The India reader persisted every read to the company ledger; the US reader
// only cached its payload under the ACCESSION key, which the page never asks
// for on load. So a US holding's "Read evidence" lived in React state and a
// reload showed it as never read — the exact failure the ledger was built to
// end, left open for one market.
//
// This writes the verified US summary into the same per-company ledger, once
// per earnings release (document id = the release url). A cached reading that
// is not yet on file is persisted too — no model call, the payload is already
// verified. Nothing here fetches or calls a model.
// ═══════════════════════════════════════════════════════════════════════════

import { loadLedger, persistEvidenceRun } from './evidence-store';
import { documentId, ledgerView, type CompanyLedger, type LedgerDocument } from './evidence-ledger';

/** Pure: the ledger document for a US earnings release. */
export function usReleaseDocument(sourceUrl: string, filingDate: string | null, generatedAt?: string | null): LedgerDocument {
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(filingDate || '')) ? String(filingDate).slice(0, 10)
    : /^\d{4}-\d{2}-\d{2}/.test(String(generatedAt || '')) ? String(generatedAt).slice(0, 10) : null;
  return {
    id: documentId(sourceUrl), url: sourceUrl, label: 'Earnings release (8-K Item 2.02)', kind: 'results',
    source: 'SEC EDGAR', tier: 1, period: date, date_iso: date, outcome: 'read',
  };
}

/** Pure: is this release already read into the ledger? */
export function usReleaseOnFile(ledger: CompanyLedger | null, sourceUrl: string): boolean {
  if (!ledger) return false;
  const id = documentId(sourceUrl);
  return Object.values(ledger.periods || {}).some((p) => !!p?.summary && (p.documents || []).some((d) => d.id === id && d.outcome === 'read'));
}

/**
 * Persist a verified US reading. Idempotent: a release already on file is
 * not written again. Never throws — a failed write is reported, and the
 * card then says NOT SAVED instead of "updated".
 */
export async function persistUsReading(args: {
  ticker: string; sourceUrl: string | null; filingDate: string | null; structured: any;
  model: string | null; promptVersion: string; generatedAt?: string | null; cached: boolean;
}): Promise<{ ledger: CompanyLedger | null; persisted: boolean | null; error: string | null; changes: any }> {
  try {
    const ticker = String(args.ticker || '').toUpperCase();
    if (!ticker || !args.sourceUrl || !args.structured) return { ledger: null, persisted: null, error: null, changes: null };
    const before = await loadLedger(ticker);
    if (usReleaseOnFile(before, args.sourceUrl)) return { ledger: before ? ledgerView(before) : null, persisted: true, error: null, changes: { changes: 'NO_CHANGES' } };
    const now = new Date().toISOString();
    const r = await persistEvidenceRun({
      ticker, market: 'US', runId: `run_${Date.now().toString(36)}_us`, startedAt: now,
      documents: [usReleaseDocument(args.sourceUrl, args.filingDate, args.generatedAt)],
      filingDate: args.filingDate, events: Array.isArray(args.structured?.events) ? args.structured.events : [],
      summary: args.structured, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [],
      promptVersion: args.promptVersion, model: args.model, rawExtraction: null, pipeline: null,
      mode: args.cached ? 'cache-backfill' : 'read',
    });
    return { ledger: r.ledger, persisted: r.persisted, error: r.error, changes: r.diff };
  } catch (e: any) {
    return { ledger: null, persisted: false, error: String(e?.message || e), changes: null };
  }
}
