// ═══════════════════════════════════════════════════════════════════════════
// THE PAGE'S EVIDENCE COUNTS — FROM PERSISTED RECORDS ONLY.         (zzz770)
//
// The header used to count a name as "evidence read" when its row held a
// summary, and a summary can sit in React state after a read whose save
// failed. Every figure here is derived from the ledger the server returned
// (and the evidence state computed from it), so the header after a reload is
// the header before it. A bench name is never counted as held.
// ═══════════════════════════════════════════════════════════════════════════

import { evidenceStateOf, type CompanyEvidenceState, type CompanyLedger } from './evidence-ledger';

export interface CountableRow {
  origin: 'book' | 'bench' | 'both' | string;
  ledger?: CompanyLedger | null;
  freshness?: { evidence_state?: CompanyEvidenceState } | null;
}

export interface EvidenceCounts {
  total: number;
  held: number;
  bench: number;
  evidence_read: number;
  not_searched: number;
  incomplete: number;
  current: number;
  new_evidence: number;
  stale: number;
  source_unavailable: number;
  retrieval_failed: number;
  documents_read: number;
  by_state: Record<CompanyEvidenceState, number>;
}

/** Pure: the company's evidence state, preferring the one computed with the
 *  ledger (server or client), else computed here from the ledger. */
export function rowEvidenceState(r: CountableRow, now?: Date | string): CompanyEvidenceState {
  return r.freshness?.evidence_state || evidenceStateOf(r.ledger || null, now).state;
}

/** Pure: header counts from persisted ledgers. */
export function evidenceCounts(rows: CountableRow[], now?: Date | string): EvidenceCounts {
  const by: Record<CompanyEvidenceState, number> = {
    NOT_SEARCHED: 0, EVIDENCE_INCOMPLETE: 0, CURRENT: 0, NEW_EVIDENCE_AVAILABLE: 0,
    STALE: 0, SOURCE_UNAVAILABLE: 0, RETRIEVAL_FAILED: 0,
  };
  let held = 0, bench = 0, read = 0, docs = 0;
  for (const r of rows) {
    // A name that is held AND on the bench is held; bench-only is never held.
    if (r.origin === 'book' || r.origin === 'both') held++; else bench++;
    const l = r.ledger || null;
    if (l?.latest_period && l.periods?.[l.latest_period]) {
      read++;
      docs += l.periods[l.latest_period].documents_read || 0;
    }
    by[rowEvidenceState(r, now)]++;
  }
  return {
    total: rows.length, held, bench, evidence_read: read,
    not_searched: by.NOT_SEARCHED, incomplete: by.EVIDENCE_INCOMPLETE, current: by.CURRENT,
    new_evidence: by.NEW_EVIDENCE_AVAILABLE, stale: by.STALE,
    source_unavailable: by.SOURCE_UNAVAILABLE, retrieval_failed: by.RETRIEVAL_FAILED,
    documents_read: docs, by_state: by,
  };
}

/** Pure: "✓ Evidence read · Q1 FY27 · 3 documents · 12 facts · 9 events ·
 *  Last updated 2026-09-22" — from the persisted latest period, or null. */
export function evidenceReadLine(ledger: CompanyLedger | null | undefined): string | null {
  const p = ledger?.latest_period ? ledger.periods?.[ledger.latest_period] : null;
  if (!p) return null;
  const n = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;
  return `✓ Evidence read · ${p.reporting_period} · ${n(p.documents_read || 0, 'document')} · ${n((p.facts || []).length, 'fact')} · ${n((p.events || []).length, 'event')} · Last updated ${String(p.updated_at || '').slice(0, 10)}`;
}

/** Pure: what a read changed, in words (from the store's merge diff). */
export function changesNote(diff: any): string | null {
  if (!diff || typeof diff !== 'object') return null;
  switch (diff.changes) {
    case 'NO_CHANGES': return 'No changes — the documents say what is already on file';
    case 'NEW_PERIOD': return `New period ${diff.period} added — earlier periods kept`;
    case 'REVISIONS': return `${diff.facts_updated || 0} fact(s) revised (${diff.facts_superseded || 0} superseded, kept in history)${diff.facts_new ? ` · ${diff.facts_new} new` : ''}`;
    case 'NEW_EVIDENCE': return `${diff.facts_new || 0} new fact(s) · ${diff.events_new || 0} new event(s)${diff.documents_new ? ` · ${diff.documents_new} new document(s)` : ''}`;
    default: return null;
  }
}
