// ═══════════════════════════════════════════════════════════════════════════
// THE COMPANY EVIDENCE LEDGER — WHAT WAS READ, KEPT.                (zzz740)
//
// THE BUG THIS FIXES. "Read evidence for all 114" populated every card, and
// a page reload emptied them again. Only capex survived. The reason was not
// subtle once traced:
//
//   · The summary route DID persist its payload — KV key
//     `india-ai-summary:<prompt-version>:<ticker>:<filing-date|latest>`,
//     365-day TTL. The read was never lost server-side.
//   · The page NEVER ASKED FOR IT. `useBook` runs three stages on mount —
//     local book, server book, graded rows — and not one of them queries a
//     stored summary. A summary entered React state only through the
//     `readFiling` click, and React state is gone on reload.
//   · Capex "survived" because `buildCapexChain(summary, vars)` falls back to
//     the GRADED ROW's financial fields when `summary` is null. It was never
//     persisted evidence; it was recomputed from screener data every time.
//
// So the persistence existed and the load path did not. The fix is a ledger
// that is written by the reader and READ ON PAGE LOAD, keyed by company —
// not by the filing date the client happened to pass — so a reload can find
// it without knowing how it was produced.
//
// WHAT THE LEDGER IS. Per company: one record per REPORTING PERIOD, never
// overwritten by the next period; each period holds the documents read, the
// structured facts (from the typed events), the events themselves, the
// summary the card renders, the mechanism/output/forward tallies, and the
// status assigned. Plus a status history, a run log (with the raw model
// output, for audit), and the freshness fields the UI needs to say
// CURRENT / NEW EVIDENCE AVAILABLE / NEVER READ / SOURCE UNAVAILABLE.
//
// THIS MODULE IS PURE. It knows nothing about KV or HTTP: every function
// takes a ledger in and returns a ledger out, so the merge, dedup and
// what-changed rules are tested against fixtures without a network.
// ═══════════════════════════════════════════════════════════════════════════

import type { VarKey } from './taxonomy';
import { VAR_LABEL, VAR_DIMENSION } from './taxonomy';
import { judgeEventQuality, verifiedDirection, betterReading, type RankableReading, type StructuralEvent } from './evidence-extract';

export const LEDGER_VERSION = 1;

/** A document that was found for the period, and what happened to it. */
export interface LedgerDocument {
  id: string;                 // stable: sha-ish of the url
  url: string;
  label: string;
  kind: string;
  source: string;
  tier?: number;
  period: string | null;      // as the source labels it ("Jul 2026")
  date_iso: string | null;    // publication date when known
  outcome: 'read' | 'download_failed' | 'scanned' | 'too_short' | 'budget_exhausted' | 'not_selected';
  chars?: number;
  pages?: number;
  detail?: string;
}

/** One structured fact. The owner's schema (§4), with the identity key. */
export interface EvidenceFact {
  id: string;                 // dedup key — see factId()
  ticker: string;
  reporting_period: string;
  evidence_type: 'mechanism' | 'output' | 'forward' | 'context';
  metric_name: VarKey;
  metric_label: string;
  value: string | null;       // the "after" value, the current state
  before_value: string | null;
  after_value: string | null;
  unit: string | null;
  delta: string | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  source_document_id: string | null;
  source_name: string;
  source_date: string | null;
  source_type: string | null; // transcript / investor_presentation / results …
  source_quote: string;
  fact_or_management_statement: 'FACT' | 'GUIDANCE' | 'TARGET' | 'MANAGEMENT_CLAIM';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence_quality: 'sentence' | 'chart' | 'unit_mismatch';
  extracted_at: string;
  updated_at: string;
}

export interface EvidenceEvent extends StructuralEvent {
  id: string;
  reporting_period: string;
  source_document_id: string | null;
  extracted_at: string;
  updated_at: string;
}

export interface Tally { confirmed: number; pending: number; contradicted: number; stated?: number; flat?: number; total: number }

export interface PeriodRecord {
  reporting_period: string;
  period_end_date: string | null;
  latest_document_date: string | null;
  documents: LedgerDocument[];
  documents_found: number;
  documents_read: number;
  documents_failed: number;
  documents_skipped: number;
  facts: EvidenceFact[];
  events: EvidenceEvent[];
  /** The verified summary the card renders (`structured` from the route). */
  summary: any;
  /** Assigned by the status engine on the client and posted back. */
  status: string | null;
  status_because: string | null;
  tallies: { mechanism: Tally; output: Tally; forward: Tally } | null;
  discovery_state: string | null;
  discovery_attempts: any[];
  run_id: string;
  prompt_version: string;
  model: string | null;
  extracted_at: string;
  updated_at: string;
}

export interface EvidenceRun {
  run_id: string;
  reporting_period: string | null;
  started_at: string;
  finished_at: string;
  outcome: 'COMPLETED' | 'FAILED' | 'SOURCE_UNAVAILABLE' | 'NO_DISCLOSURE' | 'SKIPPED_NO_NEW_EVIDENCE';
  error: string | null;
  documents_found: number;
  documents_read: number;
  facts_extracted: number;
  events_extracted: number;
  model: string | null;
  prompt_version: string | null;
  /** The model's output BEFORE validation and normalisation, for audit. Not
   *  rendered anywhere. Kept only on the last few runs to bound the record. */
  raw_extraction_json?: any;
  pipeline?: any;
}

export interface StatusEntry { reporting_period: string; status: string; because: string | null; at: string }

export type FreshnessState = 'CURRENT' | 'NEW_EVIDENCE_AVAILABLE' | 'STALE' | 'NEVER_READ' | 'SOURCE_UNAVAILABLE';

export interface CompanyLedger {
  version: number;
  ticker: string;
  market: 'IN' | 'US';
  periods: Record<string, PeriodRecord>;
  latest_period: string | null;
  latest_document_date: string | null;
  latest_source_count: number;
  last_evidence_read_at: string | null;
  /** The most recent attempt of any outcome — how the card says SOURCE
   *  UNAVAILABLE without erasing the evidence it already holds. */
  last_attempt: { at: string; outcome: EvidenceRun['outcome']; error: string | null; run_id: string } | null;
  /** Set by a "check for new evidence" pass: the newest readable document
   *  seen at a source, whether or not it has been read. */
  newest_seen_document_date: string | null;
  newest_seen_period: string | null;
  status_history: StatusEntry[];
  runs: EvidenceRun[];
  created_at: string;
  updated_at: string;
}

// ── identity ───────────────────────────────────────────────────────────────

/** Stable, short, deterministic id for a string. Not cryptographic; it only
 *  has to be the same for the same input on every run. */
export function stableId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x811c9dc5);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 14);
}

export function documentId(url: string): string { return 'doc_' + stableId(url.trim().toLowerCase()); }

/** company + period + evidence_type + metric + source document + value type.
 *  Running the same period twice therefore lands on the same id. */
export function factId(ticker: string, period: string, metric: string, valueType: string, docId: string | null): string {
  return 'fact_' + stableId(`${ticker}|${period}|${metric}|${valueType}|${docId || 'nodoc'}`);
}

export function eventId(ticker: string, period: string, e: StructuralEvent, docId: string | null): string {
  return 'evt_' + stableId(`${ticker}|${period}|${e.variable}|${e.value_type}|${e.before ?? ''}|${e.after ?? ''}|${docId || 'nodoc'}`);
}

// ── reporting periods ──────────────────────────────────────────────────────

/**
 * Indian fiscal year: April to March. A document dated July 2026 reports the
 * quarter that ended June 2026, which is Q1 of FY27 (the year ending March
 * 2027). The rule: the reporting period of a document is the last quarter
 * that ENDED before the document's date.
 *
 *   doc 2026-07-15 → quarter end 2026-06-30 → Q1 FY27
 *   doc 2026-05-20 → quarter end 2026-03-31 → Q4 FY26
 *   doc 2026-11-02 → quarter end 2026-09-30 → Q2 FY27
 */
export function reportingPeriodFromDate(dateIso: string | null | undefined): { period: string; period_end: string } | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; // 1..12
  // Last completed quarter end before this date.
  let qEndMonth: number, qEndYear = y;
  if (m >= 10) qEndMonth = 9;
  else if (m >= 7) qEndMonth = 6;
  else if (m >= 4) qEndMonth = 3;
  else { qEndMonth = 12; qEndYear = y - 1; }
  const q = qEndMonth === 6 ? 1 : qEndMonth === 9 ? 2 : qEndMonth === 12 ? 3 : 4;
  const fyEndYear = qEndMonth === 3 ? qEndYear : qEndYear + 1;
  const lastDay = new Date(Date.UTC(qEndYear, qEndMonth, 0)).getUTCDate();
  return {
    period: `Q${q} FY${String(fyEndYear).slice(2)}`,
    period_end: `${qEndYear}-${String(qEndMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Sort key so "Q4 FY26" < "Q1 FY27". */
export function periodOrdinal(period: string): number {
  const m = /^Q([1-4])\s+FY(\d{2,4})$/.exec(period.trim());
  if (!m) return -1;
  const fy = m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10);
  return fy * 4 + parseInt(m[1], 10);
}

/** The period a set of read documents reports on: the newest document's. */
export function reportingPeriodForDocuments(docs: Array<{ date_iso: string | null; outcome?: string }>, fallbackDate?: string | null): { period: string; period_end: string | null; latest_document_date: string | null } {
  const dates = docs.filter((d) => !d.outcome || d.outcome === 'read').map((d) => d.date_iso).filter((x): x is string => !!x).sort();
  const latest = dates.length ? dates[dates.length - 1] : (fallbackDate || null);
  const rp = reportingPeriodFromDate(latest);
  return { period: rp?.period || 'UNDATED', period_end: rp?.period_end || null, latest_document_date: latest };
}

// ── facts from events ──────────────────────────────────────────────────────

function evidenceTypeOf(k: VarKey, valueType: string): EvidenceFact['evidence_type'] {
  if (valueType === 'GUIDANCE' || valueType === 'TARGET') return 'forward';
  const dim = VAR_DIMENSION[k];
  if (dim === 'financial' || dim === 'quality') return 'output';
  if (dim === 'forward') return 'forward';
  return 'mechanism';
}

// ── A MAGNITUDE WORD IS PART OF THE NUMBER.                        (zzz758)
//
// GPPL's card read "a little less than 1,000,000 metric tonnes → 1.6 million
// metric tonnes (−100%)". Both figures are right and the arrow is nonsense:
// the parser read 1,000,000 on one side and 1.6 on the other, because "million"
// was treated as a unit word rather than a multiplier. A throughput that grew
// 60% was printed as a total collapse.
//
// So the multiplier is folded into the value before any subtraction happens.
// Where one side carries a magnitude word and the other does not, the two are
// still scaled — "1,000,000 tonnes" and "1.6 million tonnes" ARE the same
// measure — and `sameUnit` remains the separate guard against comparing
// tonnes with kilolitres.
const MAGNITUDE: Array<[RegExp, number]> = [
  [/\btrillions?\b/i, 1e12],
  [/\b(billions?|bn)\b/i, 1e9],
  [/\b(crores?|cr)\b/i, 1e7],
  [/\b(millions?|mn)\b/i, 1e6],
  [/\blakhs?\b/i, 1e5],
  [/\bthousands?\b/i, 1e3],
];

/** The magnitude multiplier a value string carries, or 1. */
export function magnitudeOf(s: string | null | undefined): number {
  const t = String(s ?? '');
  for (const [re, mult] of MAGNITUDE) if (re.test(t)) return mult;
  return 1;
}

/** The leading number WITH its magnitude word applied. */
export function scaledNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /-?\d[\d,]*\.?\d*/.exec(String(s));
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return n * magnitudeOf(s);
}

function numOf(s: string | null): number | null {
  return scaledNumber(s);
}

export function deltaOf(before: string | null, after: string | null, unit: string | null): string | null {
  // Identical strings are not a change. CUPID printed "480 million units →
  // 480 million units (+0%)" and BHAGCHEM "Capacity utilisation +0%": a
  // restated figure rendered as a movement of zero, which reads as a finding
  // when it is the absence of one. (zzz758)
  if (before && after && before.trim().toLowerCase() === after.trim().toLowerCase()) return null;
  const b = numOf(before), a = numOf(after);
  if (b == null || a == null) return null;
  const pctUnit = /%/.test(String(unit || '')) || (/%/.test(before || '') && /%/.test(after || ''));
  if (pctUnit) { const d = a - b; return `${d >= 0 ? '+' : ''}${Math.round(d * 10) / 10}pp`; }
  if (b === 0) return null;
  const p = ((a - b) / Math.abs(b)) * 100;
  return `${p >= 0 ? '+' : ''}${Math.round(p * 10) / 10}%`;
}

/** Pure: do two stated values carry the same unit? Unit words are taken from
 *  the value strings themselves (the model's `unit` field is unreliable), so
 *  "314 kiloliters" vs "200 KLD" is a mismatch and "42,000" vs "222,000" is
 *  not (no unit on either side — the same bare count). */
export function sameUnit(a: string, b: string, ua: string | null, ub: string | null): boolean {
  const norm = (s: string) => Array.from(new Set(
    s.toLowerCase().replace(/[\d,.\s₹$`\-–]+/g, ' ').replace(/%+/g, ' % ')
      .replace(/\b(per|of|and|to|the|a|an|approx|approximately|about|around|nearly|over|~|odd|from)\b/g, ' ')
      // Magnitude words are part of the VALUE now (scaledNumber folds them in),
      // so they must not make "1,000,000 tonnes" and "1.6 million tonnes" look
      // like two different measures. (zzz758)
      .replace(/\b(trillions?|billions?|bn|crores?|cr|millions?|mn|lakhs?|thousands?)\b/g, ' ')
      .split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, '')),
  )).sort().join(' ');
  const wa = norm(a), wb = norm(b);
  if (wa && wb) return wa === wb;
  if (!wa && !wb) return String(ua || '').toLowerCase().trim() === String(ub || '').toLowerCase().trim();
  return false;
}

/** Pure: typed events → structured facts with stable ids. */
export function factsFromEvents(ticker: string, period: string, events: StructuralEvent[], docs: LedgerDocument[], now: string): { facts: EvidenceFact[]; events: EvidenceEvent[] } {
  const docByLabel = new Map<string, LedgerDocument>();
  for (const d of docs) { docByLabel.set(d.label.toLowerCase(), d); docByLabel.set(d.url, d); }
  const findDoc = (src: string): LedgerDocument | null => {
    const s = String(src || '').toLowerCase();
    for (const [k, d] of docByLabel) if (s && (s.includes(k) || k.includes(s))) return d;
    return null;
  };
  const facts: EvidenceFact[] = [];
  const out: EvidenceEvent[] = [];
  const seenF = new Set<string>();
  const seenE = new Set<string>();
  for (const e of events) {
    const doc = findDoc(e.source);
    const docId = doc ? doc.id : null;
    const eid = eventId(ticker, period, e, docId);
    if (!seenE.has(eid)) {
      seenE.add(eid);
      out.push({ ...e, id: eid, reporting_period: period, source_document_id: docId, extracted_at: now, updated_at: now });
    }
    const fid = factId(ticker, period, e.variable, e.value_type, docId);
    if (seenF.has(fid)) continue;       // same variable+type from the same document: one fact
    seenF.add(fid);
    facts.push({
      id: fid, ticker, reporting_period: period,
      evidence_type: evidenceTypeOf(e.variable, e.value_type),
      metric_name: e.variable, metric_label: VAR_LABEL[e.variable] || e.variable,
      value: e.after ?? e.before ?? null,
      before_value: e.before ?? null, after_value: e.after ?? null,
      unit: e.unit ?? null, delta: deltaOf(e.before ?? null, e.after ?? null, e.unit ?? null),
      direction: e.direction,
      source_document_id: docId,
      source_name: doc ? doc.label : e.source,
      source_date: doc ? doc.date_iso : null,
      source_type: doc ? doc.kind : null,
      source_quote: e.evidence_text,
      fact_or_management_statement: e.value_type === 'ACTUAL' ? 'FACT' : e.value_type,
      confidence: e.confidence,
      evidence_quality: e.evidence_quality || 'sentence',
      extracted_at: now, updated_at: now,
    });
  }
  return { facts, events: out };
}

// ── merge ──────────────────────────────────────────────────────────────────

export function emptyLedger(ticker: string, market: 'IN' | 'US', now: string): CompanyLedger {
  return {
    version: LEDGER_VERSION, ticker, market, periods: {}, latest_period: null, latest_document_date: null,
    latest_source_count: 0, last_evidence_read_at: null, last_attempt: null,
    newest_seen_document_date: null, newest_seen_period: null,
    status_history: [], runs: [], created_at: now, updated_at: now,
  };
}

const MAX_RUNS = 12;
const RAW_KEPT_ON_LAST_N_RUNS = 3;

/**
 * Upsert one period into the ledger. IDEMPOTENT: the same period read twice
 * produces the same facts and events (same ids), with `updated_at` moved and
 * confidence/quote refreshed. Other periods are untouched — Q1 stays when Q2
 * arrives.
 */
export function mergePeriod(ledger: CompanyLedger, incoming: PeriodRecord, run: EvidenceRun): CompanyLedger {
  const now = run.finished_at;
  const prev = ledger.periods[incoming.reporting_period];
  let period: PeriodRecord;
  if (!prev) {
    period = incoming;
  } else {
    const facts = new Map(prev.facts.map((f) => [f.id, f]));
    for (const f of incoming.facts) {
      const old = facts.get(f.id);
      facts.set(f.id, old ? { ...old, ...f, extracted_at: old.extracted_at, updated_at: now } : f);
    }
    const events = new Map(prev.events.map((e) => [e.id, e]));
    for (const e of incoming.events) {
      const old = events.get(e.id);
      events.set(e.id, old ? { ...old, ...e, extracted_at: old.extracted_at, updated_at: now } : e);
    }
    const docs = new Map(prev.documents.map((d) => [d.id, d]));
    for (const d of incoming.documents) docs.set(d.id, d);
    period = {
      ...prev, ...incoming,
      facts: Array.from(facts.values()), events: Array.from(events.values()), documents: Array.from(docs.values()),
      // A status assigned earlier is kept until the client posts a new one.
      status: incoming.status ?? prev.status, status_because: incoming.status_because ?? prev.status_because,
      tallies: incoming.tallies ?? prev.tallies,
      extracted_at: prev.extracted_at, updated_at: now,
    };
    period.documents_found = period.documents.length;
    period.documents_read = period.documents.filter((d) => d.outcome === 'read').length;
    period.documents_failed = period.documents.filter((d) => d.outcome === 'download_failed' || d.outcome === 'scanned').length;
    period.documents_skipped = period.documents.filter((d) => d.outcome === 'too_short' || d.outcome === 'budget_exhausted' || d.outcome === 'not_selected').length;
  }
  const periods = { ...ledger.periods, [incoming.reporting_period]: period };
  const ordered = Object.keys(periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  const latest = ordered.length ? ordered[ordered.length - 1] : null;
  const runs = [...ledger.runs.filter((r) => r.run_id !== run.run_id), run].slice(-MAX_RUNS)
    .map((r, i, arr) => (i < arr.length - RAW_KEPT_ON_LAST_N_RUNS ? { ...r, raw_extraction_json: undefined } : r));
  return {
    ...ledger, periods, latest_period: latest,
    latest_document_date: latest ? periods[latest].latest_document_date : null,
    latest_source_count: latest ? periods[latest].documents_read : 0,
    last_evidence_read_at: now,
    last_attempt: { at: now, outcome: run.outcome, error: run.error, run_id: run.run_id },
    newest_seen_document_date: maxDate(ledger.newest_seen_document_date, latest ? periods[latest].latest_document_date : null),
    newest_seen_period: latest && periodOrdinal(latest) >= periodOrdinal(ledger.newest_seen_period || '') ? latest : ledger.newest_seen_period,
    runs, updated_at: now,
  };
}

/** Record an attempt that produced no period (source down, nothing disclosed,
 *  skipped). Existing evidence is never touched. */
export function recordAttempt(ledger: CompanyLedger, run: EvidenceRun): CompanyLedger {
  const runs = [...ledger.runs.filter((r) => r.run_id !== run.run_id), run].slice(-MAX_RUNS);
  return {
    ...ledger, runs, updated_at: run.finished_at,
    last_attempt: { at: run.finished_at, outcome: run.outcome, error: run.error, run_id: run.run_id },
  };
}

/** A "check for new evidence" pass saw documents at a source. */
export function recordSeen(ledger: CompanyLedger, newestDocDate: string | null, now: string): CompanyLedger {
  const rp = reportingPeriodFromDate(newestDocDate);
  return {
    ...ledger, updated_at: now,
    newest_seen_document_date: maxDate(ledger.newest_seen_document_date, newestDocDate),
    newest_seen_period: rp && periodOrdinal(rp.period) > periodOrdinal(ledger.newest_seen_period || '') ? rp.period : ledger.newest_seen_period,
  };
}

/** The client's status engine assigned a status to a period. History is
 *  appended only when the status actually changed. */
export function recordStatus(ledger: CompanyLedger, period: string, status: string, because: string | null, tallies: PeriodRecord['tallies'], now: string): CompanyLedger {
  const p = ledger.periods[period];
  if (!p) return ledger;
  const last = ledger.status_history[ledger.status_history.length - 1];
  const changed = !last || last.reporting_period !== period || last.status !== status;
  return {
    ...ledger, updated_at: now,
    periods: { ...ledger.periods, [period]: { ...p, status, status_because: because, tallies: tallies ?? p.tallies, updated_at: now } },
    status_history: changed ? [...ledger.status_history, { reporting_period: period, status, because, at: now }].slice(-40) : ledger.status_history,
  };
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b; if (!b) return a; return a > b ? a : b;
}

// ── freshness ──────────────────────────────────────────────────────────────

export function freshnessOf(ledger: CompanyLedger | null): { state: FreshnessState; detail: string } {
  if (!ledger || !ledger.latest_period) {
    if (ledger?.last_attempt?.outcome === 'SOURCE_UNAVAILABLE') return { state: 'SOURCE_UNAVAILABLE', detail: ledger.last_attempt.error || 'the source could not be reached' };
    if (ledger?.last_attempt?.outcome === 'NO_DISCLOSURE') return { state: 'NEVER_READ', detail: 'searched — the company has no readable document at any source' };
    return { state: 'NEVER_READ', detail: 'no evidence has been read for this company' };
  }
  if (ledger.newest_seen_period && periodOrdinal(ledger.newest_seen_period) > periodOrdinal(ledger.latest_period)) {
    return { state: 'NEW_EVIDENCE_AVAILABLE', detail: `${ledger.newest_seen_period} documents exist; latest read is ${ledger.latest_period}` };
  }
  if (ledger.newest_seen_document_date && ledger.latest_document_date && ledger.newest_seen_document_date > ledger.latest_document_date) {
    return { state: 'NEW_EVIDENCE_AVAILABLE', detail: `a newer document (${ledger.newest_seen_document_date}) exists than the one last read (${ledger.latest_document_date})` };
  }
  if (ledger.last_attempt?.outcome === 'SOURCE_UNAVAILABLE' && ledger.last_attempt.at > (ledger.last_evidence_read_at || '')) {
    return { state: 'SOURCE_UNAVAILABLE', detail: `last check failed: ${ledger.last_attempt.error || 'source unreachable'} — showing ${ledger.latest_period}` };
  }
  // STALE is judged from reporting dates, not from a made-up window: a period
  // whose quarter ended more than ~135 days ago has had its successor
  // reported by every listed company (45-day filing rule + slack).
  const pe = ledger.periods[ledger.latest_period]?.period_end_date;
  if (pe) {
    const age = (Date.now() - Date.parse(pe)) / 86_400_000;
    if (age > 135) return { state: 'STALE', detail: `${ledger.latest_period} ended ${Math.round(age)} days ago — the next quarter has been reported; check for new evidence` };
  }
  return { state: 'CURRENT', detail: `${ledger.latest_period} · read ${(ledger.last_evidence_read_at || '').slice(0, 10)}` };
}

// ── what changed ───────────────────────────────────────────────────────────

export interface ChangeLine { sign: '+' | '-' | '·'; text: string; metric: VarKey; period: string; source: string }

/** Pure: compare the latest period's facts with the previous period's. When
 *  there is no previous period, the latest period's own before→after moves
 *  are the change (that is what a first read tells you). */
export function whatChanged(ledger: CompanyLedger): { lines: ChangeLine[]; from: string | null; to: string | null } {
  const ordered = Object.keys(ledger.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  if (!ordered.length) return { lines: [], from: null, to: null };
  const to = ordered[ordered.length - 1];
  const from = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const cur = ledger.periods[to];
  const prev = from ? ledger.periods[from] : null;
  const lines: ChangeLine[] = [];
  // The same comparator the board uses — value type, then a before, then the
  // written document over the spoken one, then confidence. Ranking on
  // confidence alone here let WHAT CHANGED print a different figure from the
  // board for the same variable in the same quarter. (zzz762)
  const rankable = (f: EvidenceFact): RankableReading => ({
    value_type: f.fact_or_management_statement === 'FACT' ? 'ACTUAL' : f.fact_or_management_statement,
    before: f.before_value, source: f.source_name || f.source_type, confidence: f.confidence,
  });
  const bestPer = (facts: EvidenceFact[]) => {
    const m = new Map<VarKey, EvidenceFact>();
    for (const f of facts) {
      if (f.fact_or_management_statement !== 'FACT') continue;
      // Re-judged here, not trusted from the record: a fact stored before a
      // sanity rule existed (E2E "utilisation 160 → 374", TI "execution
      // delay 90%") must not keep printing as a change. (zzz754)
      const q = judgeEventQuality({ variable: f.metric_name, before: f.before_value, after: f.after_value, unit: f.unit, evidence_text: f.source_quote });
      if (q !== 'sentence') continue;
      const o = m.get(f.metric_name);
      if (!o || betterReading(rankable(f), rankable(o)) < 0) m.set(f.metric_name, f);
    }
    return m;
  };
  const curF = bestPer(cur.facts);
  const prevF = prev ? bestPer(prev.facts) : new Map<VarKey, EvidenceFact>();
  for (const [k, f] of curF) {
    const p = prevF.get(k);
    const label = VAR_LABEL[k] || k;
    const dir = verifiedDirection({ before: f.before_value, after: f.after_value, direction: f.direction, evidence_text: f.source_quote });
    if (p && p.value && f.value && p.value !== f.value) {
      // Two periods, two figures — a delta only when they measure the same
      // thing. MOREPEN's "314 kiloliters → 200 KLD (−36%)" compared a tank
      // volume with a daily throughput. Different units: two levels, no arrow.
      const comparable = sameUnit(p.value, f.value, p.unit, f.unit);
      const d = comparable ? deltaOf(p.value, f.value, f.unit) : null;
      const sign: ChangeLine['sign'] = !comparable ? '·' : d ? (d.startsWith('-') ? '-' : '+') : '·';
      lines.push({ sign, text: comparable ? `${label} ${p.value} → ${f.value}${d ? ` (${d})` : ''}` : `${label} ${f.value} (earlier period stated ${p.value} — different unit, not compared)`, metric: k, period: to, source: f.source_name });
    } else if (!p) {
      const sign: ChangeLine['sign'] = dir === 'down' ? '-' : dir === 'up' ? '+' : '·';
      // A figure restated identically is a LEVEL, not a move. (zzz758)
      const restated = !!f.before_value && !!f.after_value
        && f.before_value.trim().toLowerCase() === f.after_value.trim().toLowerCase();
      const text = f.before_value && f.after_value && !restated
        ? `${label} ${f.before_value} → ${f.after_value}${f.delta ? ` (${f.delta})` : ''}`
        : `${label} ${f.value}`;
      lines.push({ sign, text, metric: k, period: to, source: f.source_name });
    }
  }
  // New forward statements are worth a line too, marked as such. One line
  // per stated value: MOREPEN's "`825 Crore" came back filed as both an
  // order book and a management target, and printing it twice made one
  // sentence look like two disclosures.
  const seenValue = new Set<string>(Array.from(curF.values()).map((f) => String(f.value || '').toLowerCase()));
  for (const f of cur.facts) {
    if (f.fact_or_management_statement === 'FACT') continue;
    if (prev && prev.facts.some((q) => q.metric_name === f.metric_name && q.fact_or_management_statement === f.fact_or_management_statement && q.value === f.value)) continue;
    const vkey = String(f.value || '').toLowerCase();
    if (vkey && seenValue.has(vkey)) continue;
    seenValue.add(vkey);
    // A value that does not fit its variable is not a statement either.
    if (judgeEventQuality({ variable: f.metric_name, before: f.before_value, after: f.after_value, unit: f.unit, evidence_text: f.source_quote }) === 'unit_mismatch') continue;
    if (lines.length >= 12) break;
    lines.push({ sign: '·', text: `${VAR_LABEL[f.metric_name] || f.metric_name}: ${f.fact_or_management_statement.toLowerCase().replace('_', ' ')} ${f.value}`, metric: f.metric_name, period: to, source: f.source_name });
  }
  // Deteriorations first, then improvements, then statements.
  const order = { '-': 0, '+': 1, '·': 2 };
  lines.sort((a, b) => order[a.sign] - order[b.sign]);
  return { lines: lines.slice(0, 12), from, to };
}

// ── views ──────────────────────────────────────────────────────────────────

/** What the page loads: the ledger without raw model output. */
export function ledgerView(ledger: CompanyLedger): CompanyLedger {
  return { ...ledger, runs: ledger.runs.map((r) => ({ ...r, raw_extraction_json: undefined })) };
}

/** The summary the card renders for the latest period, or null. */
export function latestSummary(ledger: CompanyLedger | null): { period: PeriodRecord; summary: any } | null {
  if (!ledger || !ledger.latest_period) return null;
  const p = ledger.periods[ledger.latest_period];
  if (!p || !p.summary) return null;
  return { period: p, summary: p.summary };
}

// ── batch progress ─────────────────────────────────────────────────────────

export interface BatchProgress { done: number; skipped: number; failed: number; remaining: number; failed_tickers: string[]; remaining_tickers: string[] }

/** Pure: a batch's progress DERIVED from the ledgers. A ticker whose last
 *  attempt is at/after the batch start has been processed, whatever the
 *  outcome; nothing here can drift from what was persisted. */
export function batchProgress(header: { started_at: string; tickers: string[] }, ledgers: Record<string, CompanyLedger | null | undefined>): BatchProgress {
  const done: string[] = [], failed: string[] = [], remaining: string[] = [], skipped: string[] = [];
  for (const t of header.tickers) {
    const l = ledgers[t] || ledgers[t.toUpperCase()];
    const at = l?.last_attempt?.at || '';
    if (at && at >= header.started_at) {
      const o = l!.last_attempt!.outcome;
      if (o === 'COMPLETED') done.push(t);
      else if (o === 'SKIPPED_NO_NEW_EVIDENCE') skipped.push(t);
      else failed.push(t);
    } else remaining.push(t);
  }
  return { done: done.length, skipped: skipped.length, failed: failed.length, remaining: remaining.length, failed_tickers: failed.slice(0, 50), remaining_tickers: remaining.slice(0, 400) };
}
