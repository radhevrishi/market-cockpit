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
import { judgeEventQuality, verifiedDirection, betterReading, bestEventPerVariable, type RankableReading, type StructuralEvent } from './evidence-extract';
// zzz771: the snapshot engine answers to the same comparability rules as the
// board (fact-model) and the same type correction (fact-normalize). Both
// modules import `scaledNumber` from here; the cycle is safe because every
// use on both sides is inside a function, never at module load.
import { comparability, capacityMismatch, deltaText, normalizeValue, validateReading, factTypeOf, samePeriodPair, type FactType } from './fact-model';
import { normalizeEvent, datesIn, forwardAround, approvalPlan } from './fact-normalize';

// ── SCHEMA VERSION 2 (zzz770). Every field added in v2 is OPTIONAL, so a v1
// ledger read from KV still type-checks and renders; `migrateLedger` fills the
// v2 fields in memory on read, and the upgraded shape reaches KV only with the
// next real write (a read never writes). See migrateLedger for the mapping.
export const LEDGER_VERSION = 2;

/** A document that was found for the period, and what happened to it. */
export interface LedgerDocument {
  id: string;                 // stable: sha-ish of the url (facts reference it)
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
  // ── v2 (zzz770) ──
  /** url + published date + reporting period (+ text hash when read). Two
   *  documents with one url but different dates are different documents. */
  fingerprint?: string;
  /** The reporting period this document resolves to (reportingPeriodFromDate). */
  reporting_period?: string | null;
  /** Did we get the bytes? `failed` is OUR failure, never a disclosure gap. */
  retrieval_status?: 'retrieved' | 'failed' | 'not_attempted';
  /** Did the text reach the reader? */
  read_status?: 'read' | 'unreadable' | 'skipped';
  /** Hash of the text the reader saw, when it saw any. */
  content_hash?: string | null;
  first_seen_at?: string | null;
  last_read_at?: string | null;
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
  // ── v2 lineage and history (zzz770) ──
  source_url?: string | null;
  /** When the source document was published (= source_date). */
  source_published_date?: string | null;
  /** The date the fact describes: the reporting period's end. */
  effective_date?: string | null;
  /** When the document text was retrieved for this fact. */
  retrieved_at?: string | null;
  /** Page or section, when the source says. Never guessed. */
  source_section?: string | null;
  /** ACTIVE facts are what every reader sees; a SUPERSEDED fact lives in
   *  `PeriodRecord.superseded_facts` and is never deleted. */
  record_status?: 'ACTIVE' | 'SUPERSEDED';
  supersedes?: string | null;
  superseded_by?: string | null;
  superseded_at?: string | null;
}

export interface EvidenceEvent extends StructuralEvent {
  id: string;
  reporting_period: string;
  source_document_id: string | null;
  extracted_at: string;
  updated_at: string;
  record_status?: 'ACTIVE' | 'SUPERSEDED';
  supersedes?: string | null;
  superseded_by?: string | null;
  superseded_at?: string | null;
}

export interface Tally { confirmed: number; pending: number; contradicted: number; stated?: number; flat?: number; total: number }

export interface PeriodRecord {
  /** zzz771: the full per-variable snapshot for this period (see VariableSnapshot). Optional until PC-1 fills it. */
  variables?: Record<string, VariableSnapshot>;
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
  /** History, never deleted (zzz770): a fact or event a later read of the
   *  SAME period revised. Kept out of `facts`/`events` so every reader of
   *  those arrays sees only the active record. */
  superseded_facts?: EvidenceFact[];
  superseded_events?: EvidenceEvent[];
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
  /** v2 (zzz770): WHY a run produced nothing. `source_unreachable` — a source
   *  errored; `document_unreadable` — documents existed and could not be
   *  downloaded / OCR'd; `model_failed` — the reader's own call failed or its
   *  output was rejected. None of the three is ever a disclosure gap. */
  failure_kind?: FailureKind | null;
  mode?: string | null;
}

export type FailureKind = 'source_unreachable' | 'document_unreadable' | 'model_failed';

export interface StatusEntry { reporting_period: string; status: string; because: string | null; at: string }

/** The legacy five (kept: the card, the cron and existing callers switch on
 *  them). The owner's seven explicit states are `CompanyEvidenceState`. */
export type FreshnessState = 'CURRENT' | 'NEW_EVIDENCE_AVAILABLE' | 'STALE' | 'NEVER_READ' | 'SOURCE_UNAVAILABLE';

/**
 * THE SEVEN COMPANY EVIDENCE STATES (zzz770), explicit and distinct:
 *   NOT_SEARCHED           no search has ever run for this company
 *   EVIDENCE_INCOMPLETE    searched/read, but no structural fact is on file
 *                          (nothing readable disclosed, or a read with 0 facts)
 *   CURRENT                the expected reporting period is on file
 *   NEW_EVIDENCE_AVAILABLE a document not yet read has been seen at a source
 *   STALE                  a newer period is due and none has been found
 *   SOURCE_UNAVAILABLE     a source could not be reached (our outage)
 *   RETRIEVAL_FAILED       documents exist but could not be downloaded, OCR'd
 *                          or read (our reader's failure)
 * The last two are never "not disclosed".
 */
export type CompanyEvidenceState =
  | 'NOT_SEARCHED' | 'EVIDENCE_INCOMPLETE' | 'CURRENT' | 'NEW_EVIDENCE_AVAILABLE'
  | 'STALE' | 'SOURCE_UNAVAILABLE' | 'RETRIEVAL_FAILED';

/** A document seen at a source by a check, not yet read. */
export interface SeenDocument { id: string; url: string; label: string; kind: string; date_iso: string | null; reporting_period: string | null; seen_at: string }

/** One compact line per evidence run, persisted on the ledger (last 10). */
export interface RunLogEntry {
  run_id: string;
  at: string;
  ticker: string;
  mode: string | null;
  outcome: EvidenceRun['outcome'];
  period: string | null;
  sources_searched: number;
  sources_failed: string[];
  documents_found: number;
  documents_read: number;
  documents_new: number;
  facts_extracted: number;
  facts_new: number;
  facts_updated: number;
  facts_superseded: number;
  events_created: number;
  variables_changed: string[];
  /** NO_CHANGES when a re-read found exactly what was on file. */
  changes: 'NEW_PERIOD' | 'NEW_EVIDENCE' | 'REVISIONS' | 'NO_CHANGES' | 'NONE';
  status_before: string | null;
  status_after: string | null;
  state_before: CompanyEvidenceState;
  state_after: CompanyEvidenceState;
  error: string | null;
}

/** ── zzz771 CONTRACT (PC-1 fills) ─────────────────────────────────────────
 *  Per company → per period → per variable. Every period carries the FULL
 *  variable set with an explicit state, so an absent figure is recorded as
 *  NOT_DISCLOSED / NOT_SEARCHED in that period rather than missing. A new
 *  period is a new snapshot; it never overwrites an earlier one. */
export interface VariableSnapshot {
  state: 'FOUND' | 'NOT_DISCLOSED' | 'NOT_SEARCHED' | 'UNCLEAR' | 'NOT_APPLICABLE' | 'SOURCE_UNAVAILABLE' | 'RETRIEVAL_FAILED';
  /** The ACTUAL figure as stated. Non-null ONLY when state is FOUND or
   *  UNCLEAR: a period that holds only guidance, a target or a historical
   *  figure for this variable is NOT_DISCLOSED with a null value, so a
   *  renderer can never print a promise as the quarter's number. (zzz771) */
  value: string | null;
  unit: string | null;
  numeric: number | null;
  fact_type: string | null;
  period_class: string | null;
  source_document_id: string | null;
  source_name: string | null;
  /** Comparison against the previous snapshot that disclosed this variable.
   *  `previous_period` names the EARLIER LEDGER PERIOD whose FOUND snapshot
   *  supplied the value. A previous_value with a NULL previous_period is the
   *  before-figure the document itself states ("improved from 70% to 80%"):
   *  comparison basis in_text. Guidance, targets and historical figures are
   *  never a previous value. (zzz771) */
  previous_period: string | null;
  previous_value: string | null;
  delta_abs: string | null;
  delta_pct: string | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN' | 'NOT_COMPARABLE' | null;
  not_comparable_reason: string | null;
  computed_at: string;
}
export interface CompanyLedger {
  /** zzz771: the first full snapshot ever taken — the original thesis baseline. Frozen; never updated. */
  thesis_baseline?: { period: string; taken_at: string; variables: Record<string, VariableSnapshot> } | null;
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
  // ── v2 (zzz770) ──
  /** Documents a check saw and no read has taken in yet. Any of them makes
   *  the company NEW_EVIDENCE_AVAILABLE; a read that lists them clears them. */
  pending_documents?: SeenDocument[];
  /** Compact observability, last RUN_LOG_MAX runs. */
  run_log?: RunLogEntry[];
  /** Set when the stored shape was upgraded in memory (not persisted until
   *  the next write). */
  migrated_from_version?: number | null;
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

/** v2 (zzz770): the document's identity beyond its url — url + published date
 *  + reporting period (+ a hash of its text when it was read). The `id` stays
 *  url-only because facts reference it; the fingerprint is what says "this is
 *  the same document, already seen". */
export function documentFingerprint(url: string, dateIso: string | null | undefined, period: string | null | undefined, hash?: string | null): string {
  return 'fp_' + stableId(`${String(url || '').trim().toLowerCase()}|${String(dateIso || '').slice(0, 10)}|${period || ''}|${hash || ''}`);
}

/** Pure: a short, stable hash of a document's text (first 20k chars). */
export function contentHash(text: string | null | undefined): string | null {
  const t = String(text || '');
  return t.length ? 'h_' + stableId(t.slice(0, 20_000)) : null;
}

/** Pure: a document outcome → its retrieval and read statuses. */
export function documentStatuses(outcome: LedgerDocument['outcome']): { retrieval_status: NonNullable<LedgerDocument['retrieval_status']>; read_status: NonNullable<LedgerDocument['read_status']> } {
  switch (outcome) {
    case 'read': return { retrieval_status: 'retrieved', read_status: 'read' };
    case 'download_failed': return { retrieval_status: 'failed', read_status: 'unreadable' };
    case 'scanned': return { retrieval_status: 'retrieved', read_status: 'unreadable' };
    case 'too_short': return { retrieval_status: 'retrieved', read_status: 'skipped' };
    default: return { retrieval_status: 'not_attempted', read_status: 'skipped' };
  }
}

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

/** "Q1 FY27" → "2026-06-30". Null for anything that is not a quarter. */
export function periodEndDate(period: string | null | undefined): string | null {
  const m = /^Q([1-4])\s+FY(\d{2})$/.exec(String(period || '').trim());
  if (!m) return null;
  const q = parseInt(m[1], 10), fyEnd = 2000 + parseInt(m[2], 10);
  const [y, mo] = q === 4 ? [fyEnd, 3] : [fyEnd - 1, q * 3 + 3];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
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
  [/(?:\b|(?<=\d))(billions?|bn)\b/i, 1e9],
  [/(?:\b|(?<=\d))(crores?|cr)\b/i, 1e7],
  [/(?:\b|(?<=\d))(millions?|mn)\b/i, 1e6],
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
  // A digit glued to a letter is a LABEL, not a quantity: "Q4 FY26" is a
  // period, "H1" a half, "B200" a product. BHAGCHEM printed "utilisation Q4
  // FY26 → nearly doubling compared with Q4 FY26 (+0%)" because both sides
  // parsed to 4. (zzz763)
  // …except a CURRENCY glued to its amount: "INR140 crores" is ₹140 Cr, and
  // GOLDIAM's order book INR140 → INR225 crores read as no number at all. (zzz765)
  // …and a UNIT glued to its amount is still the amount: "3920MT/PA" is
  // 3,920 MT. The old lookahead let the regex back off one digit to "392"
  // (the next character, "0", is not a letter), so PRECWIRE printed
  // "3920MT/PA → 4620 MT/PA · +1078.6%" and "10MW" read as 1. A number now
  // ends where its digits end, and a letter right after it is allowed only
  // when it spells a unit or a magnitude. (zzz769)
  const m = /(?:(?<=(?:INR|USD|EUR|GBP|JPY|Rs|RS|US\$|₹|\$))|(?<![A-Za-z\d]))-?\d[\d,]*\.?\d*(?:(?![A-Za-z\d]|[.,]\d)|(?=(?:MTPA|KTPA|TPA|MTPD|TPD|MT|MW[hp]?|GW[hp]?|kW[hp]?|KW[hp]?|KL(?:PD|D)?|kl|kg|KG|tons?|tonnes?|x|X|cr|Cr|CR|crores?|Crores?|mn|Mn|MN|bn|Bn|BN)(?![A-Za-z])))/.exec(String(s));
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
  // The same NUMBER in two phrasings is the same figure. ENTERO's "Q4 FY26:
  // 59 days → 59 days by Q4 FY26 (+0%)" and MOLBIO's "58% (March trailing)
  // → 58% · +0pp" were restatements rendered as movements of zero. (zzz763)
  if (a === b) return null;
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
  // One side a bare number, the other with its unit ("6,000 → 15,000 sq ft"):
  // the bare side inherits the unit of the sentence it came from. Only when
  // the labelled side names a real unit, never a percent. (zzz764)
  if ((wa && !wb) || (!wa && wb)) return !/%/.test(wa || wb);
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
      ...factLineage(doc, period, now),
    });
  }
  return { facts, events: out };
}

/** v2 lineage fields for a fact, from its source document. Page/section is
 *  filled only when the document says so — never guessed. */
function factLineage(doc: LedgerDocument | null, period: string, now: string): Partial<EvidenceFact> {
  return {
    source_url: doc ? doc.url : null,
    source_published_date: doc ? doc.date_iso : null,
    effective_date: periodEndDate(period),
    retrieved_at: doc?.last_read_at || now,
    source_section: null,
    record_status: 'ACTIVE', supersedes: null, superseded_by: null, superseded_at: null,
  };
}

/** Pure: fill a document's v2 fields from what it already carries. */
export function normaliseDocument(d: LedgerDocument, now: string): LedgerDocument {
  const rp = d.reporting_period !== undefined ? d.reporting_period : (reportingPeriodFromDate(d.date_iso)?.period || null);
  const st = documentStatuses(d.outcome);
  return {
    ...d,
    id: d.id || documentId(d.url),
    reporting_period: rp,
    retrieval_status: d.retrieval_status || st.retrieval_status,
    read_status: d.read_status || st.read_status,
    content_hash: d.content_hash ?? null,
    fingerprint: d.fingerprint || documentFingerprint(d.url, d.date_iso, rp, d.content_hash),
    first_seen_at: d.first_seen_at || now,
    last_read_at: d.last_read_at ?? (d.outcome === 'read' ? now : null),
  };
}

/** Pure: fill a fact's v2 fields (legacy facts get ACTIVE and their lineage
 *  from the period's documents). */
function normaliseFact(f: EvidenceFact, docs: LedgerDocument[]): EvidenceFact {
  if (f.record_status) return f;
  const doc = f.source_document_id ? docs.find((d) => d.id === f.source_document_id) || null : null;
  return {
    ...f,
    source_url: f.source_url ?? (doc ? doc.url : null),
    source_published_date: f.source_published_date ?? f.source_date ?? null,
    effective_date: f.effective_date ?? periodEndDate(f.reporting_period),
    retrieved_at: f.retrieved_at ?? f.extracted_at,
    source_section: f.source_section ?? null,
    record_status: 'ACTIVE', supersedes: f.supersedes ?? null, superseded_by: null, superseded_at: null,
  };
}

function normaliseEvent(e: EvidenceEvent): EvidenceEvent {
  return e.record_status ? e : { ...e, record_status: 'ACTIVE', supersedes: e.supersedes ?? null, superseded_by: null, superseded_at: null };
}

/** Pure: a period record with every v2 field present. */
export function normalisePeriod(p: PeriodRecord, now: string): PeriodRecord {
  const documents = (p.documents || []).map((d) => normaliseDocument(d, p.extracted_at || now));
  return {
    ...p,
    documents,
    facts: (p.facts || []).map((f) => normaliseFact(f, documents)),
    events: (p.events || []).map(normaliseEvent),
    superseded_facts: p.superseded_facts || [],
    superseded_events: p.superseded_events || [],
  };
}

/**
 * THE MIGRATION (v1 → v2). Pure, idempotent, lossless.
 *
 *   · every document gains fingerprint, reporting_period, retrieval_status,
 *     read_status (derived from `outcome`), first_seen_at (the period's
 *     extraction time) and last_read_at (same, for read documents);
 *   · every fact gains its lineage (source_url from its document,
 *     source_published_date = source_date, effective_date = period end,
 *     retrieved_at = extracted_at) and record_status ACTIVE;
 *   · every event gains record_status ACTIVE;
 *   · each period gains empty superseded_facts / superseded_events;
 *   · the ledger gains pending_documents [] and a run_log rebuilt from the
 *     runs already on file (counts only; nothing invented).
 * Nothing is removed and no value changes. The result is written back only
 * by the next real save — loading never writes.
 */
export function migrateLedger(raw: any): CompanyLedger | null {
  if (!raw || typeof raw !== 'object' || !raw.periods || typeof raw.periods !== 'object') return null;
  const from = Number(raw.version || 1);
  // A v2 ledger written before zzz771 has no per-period snapshots: they are
  // derived here, losslessly, from the facts already on file — so the 79
  // existing ledgers carry a series without a re-read. `computed_at` and the
  // baseline's `taken_at` are the ledger's own updated_at, not the clock, so
  // two loads of one ledger derive one identical document.
  if (from >= LEDGER_VERSION && Array.isArray(raw.run_log) && Array.isArray(raw.pending_documents)) {
    const l = raw as CompanyLedger;
    return needsVariableSnapshots(l) ? withVariableSnapshots(l, String(l.updated_at || l.created_at)) : l;
  }
  const now = String(raw.updated_at || raw.created_at || new Date(0).toISOString());
  const periods: Record<string, PeriodRecord> = {};
  for (const [k, p] of Object.entries<any>(raw.periods)) if (p) periods[k] = normalisePeriod(p as PeriodRecord, now);
  const runs: EvidenceRun[] = Array.isArray(raw.runs) ? raw.runs : [];
  const run_log: RunLogEntry[] = Array.isArray(raw.run_log) ? raw.run_log : runs.slice(-RUN_LOG_MAX).map((r) => ({
    run_id: r.run_id, at: r.finished_at, ticker: String(raw.ticker || ''), mode: r.mode ?? null, outcome: r.outcome,
    period: r.reporting_period ?? null, sources_searched: 0, sources_failed: [],
    documents_found: r.documents_found || 0, documents_read: r.documents_read || 0, documents_new: 0,
    facts_extracted: r.facts_extracted || 0, facts_new: 0, facts_updated: 0, facts_superseded: 0,
    events_created: r.events_extracted || 0, variables_changed: [],
    changes: 'NONE' as const, status_before: null, status_after: null,
    state_before: 'NOT_SEARCHED' as const, state_after: 'NOT_SEARCHED' as const, error: r.error ?? null,
  }));
  const migrated: CompanyLedger = {
    ...raw,
    version: LEDGER_VERSION,
    periods,
    status_history: Array.isArray(raw.status_history) ? raw.status_history : [],
    runs,
    pending_documents: Array.isArray(raw.pending_documents) ? raw.pending_documents : [],
    run_log,
    migrated_from_version: from < LEDGER_VERSION ? from : (raw.migrated_from_version ?? null),
  } as CompanyLedger;
  return needsVariableSnapshots(migrated) ? withVariableSnapshots(migrated, now) : migrated;
}

// ── merge ──────────────────────────────────────────────────────────────────

export function emptyLedger(ticker: string, market: 'IN' | 'US', now: string): CompanyLedger {
  return {
    version: LEDGER_VERSION, ticker, market, periods: {}, latest_period: null, latest_document_date: null,
    latest_source_count: 0, last_evidence_read_at: null, last_attempt: null,
    newest_seen_document_date: null, newest_seen_period: null,
    status_history: [], runs: [], created_at: now, updated_at: now,
    pending_documents: [], run_log: [], migrated_from_version: null,
  };
}

const MAX_RUNS = 12;
const RAW_KEPT_ON_LAST_N_RUNS = 3;
export const RUN_LOG_MAX = 10;
const SUPERSEDED_MAX = 60;

/** What one merge changed — the basis of "NO CHANGES" on a second read. */
export interface MergeDiff {
  period: string;
  is_new_period: boolean;
  documents_new: number;
  facts_new: number;
  facts_updated: number;
  facts_unchanged: number;
  facts_superseded: number;
  events_new: number;
  events_superseded: number;
  variables_changed: string[];
  changes: RunLogEntry['changes'];
}

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Same stated reading? Timestamps, confidence wording and quotes may move
 *  between two reads of one document; the VALUE is what makes a revision. */
function sameFactValue(a: EvidenceFact, b: EvidenceFact): boolean {
  return norm(a.value) === norm(b.value) && norm(a.before_value) === norm(b.before_value)
    && norm(a.after_value) === norm(b.after_value) && norm(a.unit) === norm(b.unit)
    && a.fact_or_management_statement === b.fact_or_management_statement;
}
const eventSlot = (e: EvidenceEvent) => `${e.variable}|${e.value_type}|${e.source_document_id || 'nodoc'}`;

/** Every document id any period of the ledger lists. */
function knownDocumentIds(ledger: CompanyLedger): Set<string> {
  const s = new Set<string>();
  for (const p of Object.values(ledger.periods || {})) for (const d of p?.documents || []) if (d?.id) s.add(d.id);
  return s;
}

/**
 * Upsert one period into the ledger. IDEMPOTENT: the same period read twice
 * produces the same facts and events (same ids), with `updated_at` moved and
 * confidence/quote refreshed. Other periods are untouched — Q1 stays when Q2
 * arrives.
 *
 * HISTORY IS NEVER DESTROYED (zzz770). A re-read of the SAME period whose
 * value differs for a fact slot (same metric, value type, document) moves the
 * old fact to `superseded_facts` as SUPERSEDED (superseded_by → the new id;
 * the new fact `supersedes` → the archived id). An event revised one-for-one
 * (same variable, value type, document; exactly one on each side) is kept the
 * same way in `superseded_events`. An identical re-read supersedes nothing.
 */
export function mergePeriodDetailed(ledger0: CompanyLedger, incoming0: PeriodRecord, run: EvidenceRun): { ledger: CompanyLedger; diff: MergeDiff } {
  const ledger = migrateLedger(ledger0) || ledger0;
  const now = run.finished_at;
  const incoming = normalisePeriod(incoming0, now);
  const prev0 = ledger.periods[incoming.reporting_period];
  const prev = prev0 ? normalisePeriod(prev0, now) : null;
  const known = knownDocumentIds(ledger);
  const diff: MergeDiff = {
    period: incoming.reporting_period, is_new_period: !prev,
    documents_new: incoming.documents.filter((d) => !known.has(d.id)).length,
    facts_new: 0, facts_updated: 0, facts_unchanged: 0, facts_superseded: 0,
    events_new: 0, events_superseded: 0, variables_changed: [], changes: 'NONE',
  };
  const changedVars = new Set<string>();
  let period: PeriodRecord;
  if (!prev) {
    period = incoming;
    diff.facts_new = incoming.facts.length;
    diff.events_new = incoming.events.length;
    for (const f of incoming.facts) changedVars.add(f.metric_name);
  } else {
    const supF = [...(prev.superseded_facts || [])];
    const supE = [...(prev.superseded_events || [])];
    const facts = new Map(prev.facts.map((f) => [f.id, f]));
    for (const f of incoming.facts) {
      const old = facts.get(f.id);
      if (!old) { facts.set(f.id, f); diff.facts_new++; changedVars.add(f.metric_name); continue; }
      if (sameFactValue(old, f)) {
        facts.set(f.id, { ...old, ...f, extracted_at: old.extracted_at, updated_at: now, supersedes: old.supersedes ?? null, record_status: 'ACTIVE' });
        diff.facts_unchanged++;
        continue;
      }
      // A genuine revision: the old reading is archived, not overwritten.
      const archivedId = `${old.id}~${stableId(`${old.updated_at}|${old.value ?? ''}|${old.after_value ?? ''}`)}`;
      if (!supF.some((x) => x.id === archivedId)) {
        supF.push({ ...old, id: archivedId, record_status: 'SUPERSEDED', superseded_by: f.id, superseded_at: now });
        diff.facts_superseded++;
      }
      facts.set(f.id, { ...f, updated_at: now, supersedes: archivedId, record_status: 'ACTIVE' });
      diff.facts_updated++;
      changedVars.add(f.metric_name);
    }
    const events = new Map(prev.events.map((e) => [e.id, e]));
    const incomingIds = new Set(incoming.events.map((e) => e.id));
    const inBySlot = new Map<string, EvidenceEvent[]>();
    for (const e of incoming.events) inBySlot.set(eventSlot(e), [...(inBySlot.get(eventSlot(e)) || []), e]);
    for (const e of incoming.events) {
      const old = events.get(e.id);
      if (old) { events.set(e.id, { ...old, ...e, extracted_at: old.extracted_at, updated_at: now, supersedes: old.supersedes ?? null, record_status: 'ACTIVE' }); continue; }
      diff.events_new++;
      let supersedes: string | null = null;
      const slot = eventSlot(e);
      const olds = prev.events.filter((x) => eventSlot(x) === slot && !incomingIds.has(x.id));
      if (e.source_document_id && (inBySlot.get(slot) || []).length === 1 && olds.length === 1
        && prev.events.filter((x) => eventSlot(x) === slot).length === 1) {
        const o = olds[0];
        events.delete(o.id);
        supE.push({ ...o, record_status: 'SUPERSEDED', superseded_by: e.id, superseded_at: now });
        supersedes = o.id;
        diff.events_superseded++;
      }
      events.set(e.id, { ...e, supersedes, record_status: 'ACTIVE' });
    }
    const docs = new Map(prev.documents.map((d) => [d.id, d]));
    for (const d of incoming.documents) {
      const old = docs.get(d.id);
      // A document already read keeps its read record when a later pass only
      // lists it again (not_selected): a re-listing is not an un-reading.
      if (old && old.outcome === 'read' && d.outcome === 'not_selected') { docs.set(d.id, old); continue; }
      docs.set(d.id, old ? { ...old, ...d, first_seen_at: old.first_seen_at || d.first_seen_at, content_hash: d.content_hash ?? old.content_hash ?? null } : d);
    }
    period = {
      ...prev, ...incoming,
      facts: Array.from(facts.values()), events: Array.from(events.values()), documents: Array.from(docs.values()),
      superseded_facts: supF.slice(-SUPERSEDED_MAX), superseded_events: supE.slice(-SUPERSEDED_MAX),
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
  diff.variables_changed = Array.from(changedVars).sort();
  diff.changes = diff.is_new_period ? 'NEW_PERIOD'
    : (diff.facts_updated || diff.facts_superseded || diff.events_superseded) ? 'REVISIONS'
      : (diff.facts_new || diff.events_new || diff.documents_new) ? 'NEW_EVIDENCE' : 'NO_CHANGES';

  const periods = { ...ledger.periods, [incoming.reporting_period]: period };
  const ordered = Object.keys(periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  const latest = ordered.length ? ordered[ordered.length - 1] : null;
  const runs = [...ledger.runs.filter((r) => r.run_id !== run.run_id), run].slice(-MAX_RUNS)
    .map((r, i, arr) => (i < arr.length - RAW_KEPT_ON_LAST_N_RUNS ? { ...r, raw_extraction_json: undefined } : r));
  const merged: CompanyLedger = {
    ...ledger, version: LEDGER_VERSION, periods, latest_period: latest,
    latest_document_date: latest ? periods[latest].latest_document_date : null,
    latest_source_count: latest ? periods[latest].documents_read : 0,
    // A backfilled OLDER period is not a read of the current evidence: the
    // recent-reporters planner treats last_evidence_read_at as "read since the
    // filing", so a prior-quarter read must not move it. (zzz765)
    last_evidence_read_at: latest === incoming.reporting_period ? now : (ledger.last_evidence_read_at || now),
    last_attempt: { at: now, outcome: run.outcome, error: run.error, run_id: run.run_id },
    newest_seen_document_date: maxDate(ledger.newest_seen_document_date, latest ? periods[latest].latest_document_date : null),
    newest_seen_period: latest && periodOrdinal(latest) >= periodOrdinal(ledger.newest_seen_period || '') ? latest : ledger.newest_seen_period,
    runs, updated_at: now,
  };
  // A document a check saw is no longer pending once any period lists it.
  const nowKnown = knownDocumentIds(merged);
  merged.pending_documents = (ledger.pending_documents || []).filter((d) => !nowKnown.has(d.id));
  // Every period's variable snapshot, and the baseline if this is the first
  // one ever taken. A merge is the write path, so this is where the series
  // is persisted. (zzz771)
  return { ledger: withVariableSnapshots(merged, now), diff };
}

export function mergePeriod(ledger: CompanyLedger, incoming: PeriodRecord, run: EvidenceRun): CompanyLedger {
  return mergePeriodDetailed(ledger, incoming, run).ledger;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE VARIABLE SNAPSHOT — PER COMPANY, PER PERIOD, PER VARIABLE.     (zzz771)
//
// The owner's verdict on the previous build: "Capacity utilisation 80% — what
// was it earlier? +10pp? constant?" The ledger had the history (one
// PeriodRecord per quarter, never overwritten) but nothing turned it into a
// series: every card printed the latest level and the earlier quarter's
// figure sat in a JSON blob nobody joined to it.
//
// So every period now carries the FULL variable set as a snapshot: for each
// of the taxonomy's VarKeys, an explicit state — FOUND with the figure, or
// NOT_DISCLOSED / NOT_SEARCHED / UNCLEAR / SOURCE_UNAVAILABLE /
// RETRIEVAL_FAILED — and, where an EARLIER period's snapshot holds a
// comparable FOUND figure, the previous value with the delta. Three rules:
//
//   1. DERIVED, NEVER INVENTED. Every number here is a stored fact of that
//      period. A period with no read document says NOT_SEARCHED, a read
//      period with no fact says NOT_DISCLOSED; neither is zero.
//   2. A PREVIOUS VALUE IS AN EARLIER ACTUAL. The walk back stops at the most
//      recent earlier period whose snapshot is FOUND. Guidance, targets and
//      historical figures are typed as what they are and never supply it.
//      The comparability engine (fact-model) decides whether the two may be
//      subtracted at all: unit, scope, basis, definition, same period.
//   3. Q2 IS A NEW SNAPSHOT, NEVER AN OVERWRITE. Snapshots are recomputed
//      for every period on each merge — a backfilled Q4 gives Q1 its
//      previous — but a period's own reading never changes because a later
//      one arrived, and its `computed_at` is kept when nothing in it moved.
//
// The thesis baseline is the earliest period's snapshot the FIRST time any
// snapshot is computed for the company, and it is frozen from then on.
// ═══════════════════════════════════════════════════════════════════════════

/** Every VarKey the taxonomy names — the full set every snapshot carries. */
export const ALL_VAR_KEYS: readonly VarKey[] = Object.keys(VAR_LABEL) as VarKey[];

/** The best ACTUAL per variable in a period, chosen exactly as the board
 *  chooses its row (type corrected from the sentence, wrong-unit and
 *  historical readings set aside, then `bestEventPerVariable`). Events carry
 *  every reading of the period; the facts array is one-per-document-slot and
 *  is used only when a period stored no events (two pre-zzz740 periods). */
function snapshotActuals(p: PeriodRecord): Map<VarKey, StructuralEvent & { source_document_id?: string | null }> {
  const period = p.reporting_period;
  const raw: Array<StructuralEvent & { source_document_id?: string | null }> = (p.events && p.events.length)
    ? p.events.filter((e) => !e.record_status || e.record_status === 'ACTIVE')
    : (p.facts || []).filter((f) => !f.record_status || f.record_status === 'ACTIVE').map((f) => ({
      variable: f.metric_name,
      value_type: (f.fact_or_management_statement === 'FACT' ? 'ACTUAL' : f.fact_or_management_statement) as StructuralEvent['value_type'],
      before: f.before_value, after: f.after_value ?? f.value, unit: f.unit, period: null,
      direction: f.direction, evidence_text: f.source_quote, source: f.source_name, confidence: f.confidence,
      evidence_quality: f.evidence_quality, source_document_id: f.source_document_id,
    }));
  const live = raw
    .map((e) => ({ ...normalizeEvent(e, period), source_document_id: e.source_document_id ?? null }))
    .filter((e) => !(e.historical_as_of && e.value_type === 'ACTUAL'))
    .filter((e) => !(e as any).commentary && judgeEventQuality(e) !== 'unit_mismatch');
  const out = new Map<VarKey, StructuralEvent & { source_document_id?: string | null }>();
  for (const [k, slot] of bestEventPerVariable(live)) {
    const a = slot.actual;
    if (!a || a.value_type !== 'ACTUAL') continue;
    if (!String(a.after ?? a.before ?? '').trim()) continue;
    out.set(k, a);
  }
  return out;
}

/** The state a period's snapshot takes for a variable NO fact answers. */
function absentState(p: PeriodRecord, ledger: CompanyLedger): VariableSnapshot['state'] {
  const docs = p.documents || [];
  const read = (p.documents_read || 0) > 0 || docs.some((d) => d.outcome === 'read');
  if (read) return 'NOT_DISCLOSED';
  // Nothing was read: say WHY, from the period's own discovery record and
  // the run that produced it — a failure is never a disclosure gap.
  const run = ledger.runs.find((r) => r.run_id === p.run_id) || null;
  const kind = failureKindOf(run);
  if (p.discovery_state === 'RETRIEVAL_FAILED' || kind === 'document_unreadable' || kind === 'model_failed') return 'RETRIEVAL_FAILED';
  if (docs.length && docs.every((d) => d.outcome === 'download_failed' || d.outcome === 'scanned')) return 'RETRIEVAL_FAILED';
  if (kind === 'source_unreachable' || (p.discovery_attempts || []).some((a: any) => a?.outcome === 'error') && !docs.length) return 'SOURCE_UNAVAILABLE';
  return 'NOT_SEARCHED';
}

const EMPTY_SNAPSHOT = (state: VariableSnapshot['state'], now: string): VariableSnapshot => ({
  state, value: null, unit: null, numeric: null, fact_type: null, period_class: null,
  source_document_id: null, source_name: null,
  previous_period: null, previous_value: null, delta_abs: null, delta_pct: null,
  direction: null, not_comparable_reason: null, computed_at: now,
});

/** Signed, human: "+10pp", "−31 days", "+₹27 Cr", "+1,500 tonnes". The
 *  minus is U+2212 so a delta never reads as a hyphenated range. */
export function formatDeltaAbs(d: number, unit: string | null): string {
  const sign = d < 0 ? '−' : '+';
  const abs = Math.abs(d);
  const r1 = Math.round(abs * 10) / 10;
  const num = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });
  switch (unit) {
    case 'pp': return `${sign}${r1}pp`;
    case '%': return `${sign}${r1}%`;
    case '₹ crore': return `${sign}₹${num(r1)} Cr`;
    case 'days': return `${sign}${num(Math.round(abs))} days`;
    case 'x': return `${sign}${r1}×`;
    case 'USD million': return `${sign}$${num(r1)} mn`;
    case 'EUR million': return `${sign}€${num(r1)} mn`;
    default: return `${sign}${num(abs >= 100 ? Math.round(abs) : r1)}${unit ? ` ${unit}` : ''}`;
  }
}

/** The quarter a value pins itself to ("as on 31 March 2026", "in Q4 FY26"),
 *  read off its first clause — the same rule comparison.ts applies. */
function pinnedPeriod(value: string | null): string | null {
  const own = datesIn(String(value ?? '').split(/\band\b|;|,(?!\d)/)[0]);
  return own.length ? own.reduce((x, y) => (y.end > x.end ? y : x)).label : null;
}

/** Reason text the card prints in parentheses, from the engine's own wording. */
function shortReason(reason: string | null): string {
  const r = String(reason || '');
  if (/same period/i.test(r)) return 'same period';
  if (/unit|measure|stock and a rate|conversion|no number/i.test(r)) return 'unit changed';
  if (/scope|plant|segment|basis|definition|standalone/i.test(r)) return 'scope changed';
  if (/target|guidance|commentary/i.test(r)) return 'not an actual';
  return r || 'not comparable';
}

/**
 * Pure: the full variable snapshot of ONE period, with each variable's
 * previous value taken from the most recent EARLIER period whose snapshot is
 * FOUND and comparable. `earlier` are the already-derived snapshots of the
 * periods before this one (ascending); the caller supplies them so the walk
 * is one pass over the ledger.
 */
export function deriveVariableSnapshots(ledger: CompanyLedger, period: string, now?: string, earlier?: Array<{ period: string; variables: Record<string, VariableSnapshot> }>): Record<string, VariableSnapshot> {
  const p = ledger.periods[period];
  const at = now || p?.updated_at || ledger.updated_at;
  if (!p) return Object.fromEntries(ALL_VAR_KEYS.map((k) => [k, EMPTY_SNAPSHOT('NOT_SEARCHED', at)]));
  const prior = earlier ?? Object.keys(ledger.periods)
    .filter((k) => periodOrdinal(k) >= 0 && periodOrdinal(k) < periodOrdinal(period))
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b))
    .reduce<Array<{ period: string; variables: Record<string, VariableSnapshot> }>>((acc, k) => {
      acc.push({ period: k, variables: deriveVariableSnapshots(ledger, k, now, acc.slice()) });
      return acc;
    }, []);
  const actuals = snapshotActuals(p);
  const absent = absentState(p, ledger);
  const out: Record<string, VariableSnapshot> = {};
  for (const key of ALL_VAR_KEYS) {
    const a = actuals.get(key);
    if (!a) { out[key] = EMPTY_SNAPSHOT(absent, at); continue; }
    const value = String(a.after ?? a.before ?? '').trim();
    const validation = validateReading(key, value, a.evidence_text, a.unit);
    const norm = normalizeValue(value, a.unit);
    const factType: FactType = factTypeOf({ valueType: 'ACTUAL', key, value, text: a.evidence_text, source: a.source, retyped: (a as any).retyped_because });
    const snap: VariableSnapshot = {
      ...EMPTY_SNAPSHOT(validation.state === 'UNCLEAR' ? 'UNCLEAR' : 'FOUND', at),
      value, unit: norm.normalized_unit || a.unit || norm.raw_unit,
      numeric: norm.normalized_value ?? norm.value ?? null,
      fact_type: factType, period_class: 'CURRENT_QUARTER',
      source_document_id: a.source_document_id ?? null, source_name: a.source || null,
    };
    // Rule 2: the most recent earlier period whose snapshot FOUND this variable.
    let prev: { period: string; s: VariableSnapshot } | null = null;
    for (let i = prior.length - 1; i >= 0; i--) {
      const s = prior[i].variables[key];
      if (s && s.state === 'FOUND' && s.value) { prev = { period: prior[i].period, s }; break; }
    }
    if (snap.state === 'UNCLEAR') {
      // An ambiguous or implausible reading is not subtracted from anything;
      // the prior is named so the reader knows one exists.
      out[key] = { ...snap, previous_period: prev?.period ?? null, previous_value: prev?.s.value ?? null,
        direction: prev ? 'NOT_COMPARABLE' : null, not_comparable_reason: validation.reason || 'validation required' };
      continue;
    }
    if (prev) {
      const prevEv = snapshotActuals(ledger.periods[prev.period]).get(key);
      // The period a figure DESCRIBES wins over the period it was read in:
      // "82.88 crore deployed in April 2026" (CUPID) filed under Q4 FY26 and
      // again under Q1 FY27 is one figure, and the engine says "same period".
      const c = comparability(
        { key, value: prev.s.value, unit: prevEv?.unit ?? prev.s.unit, quote: prevEv?.evidence_text ?? null, period: pinnedPeriod(prev.s.value) || prev.period, fact_type: 'ACTUAL' },
        { key, value, unit: a.unit, quote: a.evidence_text, period: pinnedPeriod(value) || period, fact_type: 'ACTUAL' },
      );
      if (!c.comparable) {
        // Two statements with no figure ("successfully commissioned" twice)
        // are one event restated, not a unit change.
        const pv = prev.s.value ?? '';
        const noFigure = !/\d/.test(pv) || !/\d/.test(value);
        const restated = noFigure && pv.trim().toLowerCase().replace(/\s+/g, ' ') === value.toLowerCase().replace(/\s+/g, ' ');
        out[key] = { ...snap, previous_period: prev.period, previous_value: prev.s.value,
          direction: restated ? 'FLAT' : 'NOT_COMPARABLE',
          not_comparable_reason: restated ? null : noFigure && !c.same_period ? 'not a figure' : shortReason(c.reason) };
        continue;
      }
      const d = deltaText(c.prev_norm!, c.cur_norm!);
      const b = c.prev_norm!.normalized_value!, cur = c.cur_norm!.normalized_value!;
      const pctUnit = c.cur_norm!.dimension === 'percent' || c.cur_norm!.dimension === 'percent_points';
        // Days are a cycle length: the move is read in days, never as a % of days. (zzz771)
        const noRel = pctUnit || c.cur_norm!.dimension === 'days';
      out[key] = {
        ...snap, previous_period: prev.period, previous_value: prev.s.value,
        delta_abs: d.direction === 'flat' ? null : formatDeltaAbs(cur - b, pctUnit ? 'pp' : (c.cur_norm!.normalized_unit || null)),
        delta_pct: d.direction === 'flat' || noRel || b === 0 ? null : formatDeltaAbs(((cur - b) / Math.abs(b)) * 100, '%'),
        direction: d.direction === 'flat' ? 'FLAT' : d.direction === 'up' ? 'UP' : d.direction === 'down' ? 'DOWN' : 'UNKNOWN',
        not_comparable_reason: null,
      };
      continue;
    }
    // No earlier FOUND period: the document's own before→after, when it is
    // a real comparison (a figure on both sides, not one period restated).
    const before = String(a.before ?? '').trim();
    const bNum = scaledNumber(before), aNum = scaledNumber(value);
    if (before && a.after && bNum != null && aNum != null && bNum !== aNum && !samePeriodPair(before, value)) {
      const c = comparability({ key, value: before, unit: a.unit, quote: null, period: null }, { key, value, unit: a.unit, quote: null, period: null });
      if (c.comparable) {
        const d = deltaText(c.prev_norm!, c.cur_norm!);
        const b = c.prev_norm!.normalized_value!, cur = c.cur_norm!.normalized_value!;
        const pctUnit = c.cur_norm!.dimension === 'percent' || c.cur_norm!.dimension === 'percent_points';
        // Days are a cycle length: the move is read in days, never as a % of days. (zzz771)
        const noRel = pctUnit || c.cur_norm!.dimension === 'days';
        out[key] = {
          ...snap, previous_period: null, previous_value: before,
          delta_abs: formatDeltaAbs(cur - b, pctUnit ? 'pp' : (c.cur_norm!.normalized_unit || null)),
          delta_pct: noRel || b === 0 ? null : formatDeltaAbs(((cur - b) / Math.abs(b)) * 100, '%'),
          direction: d.direction === 'up' ? 'UP' : d.direction === 'down' ? 'DOWN' : 'FLAT',
          not_comparable_reason: null,
        };
        continue;
      }
    }
    // Nothing to compare against — and the reason is specific: no earlier
    // period at all, or an earlier period that was read and silent.
    const last = prior.length ? prior[prior.length - 1] : null;
    const lastState = last ? last.variables[key]?.state : null;
    out[key] = {
      ...snap, direction: null,
      not_comparable_reason: !last ? 'first reading'
        : lastState === 'NOT_DISCLOSED' ? `not disclosed in ${last.period}`
          : lastState === 'UNCLEAR' ? `unclear in ${last.period}`
            : `${last.period} not read`,
    };
  }
  return out;
}

const SNAPSHOT_KEYS_COMPARED: Array<keyof VariableSnapshot> = ['state', 'value', 'unit', 'numeric', 'fact_type', 'period_class', 'source_document_id', 'source_name', 'previous_period', 'previous_value', 'delta_abs', 'delta_pct', 'direction', 'not_comparable_reason'];
function sameSnapshot(a: VariableSnapshot | undefined, b: VariableSnapshot): boolean {
  if (!a) return false;
  return SNAPSHOT_KEYS_COMPARED.every((k) => a[k] === b[k]);
}

/**
 * Pure: the ledger with `period.variables` on every period and
 * `thesis_baseline` set once. Idempotent and lossless: a snapshot whose
 * content did not move keeps its `computed_at`; a baseline already on file is
 * never touched, whatever periods arrive later (Rule 3).
 */
export function withVariableSnapshots(ledger: CompanyLedger, now?: string): CompanyLedger {
  const ordered = Object.keys(ledger.periods || {}).filter((k) => !!ledger.periods[k])
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  if (!ordered.length) return ledger;
  const at = now || ledger.updated_at;
  const acc: Array<{ period: string; variables: Record<string, VariableSnapshot> }> = [];
  const periods: Record<string, PeriodRecord> = { ...ledger.periods };
  let changed = false;
  for (const k of ordered) {
    const fresh = deriveVariableSnapshots(ledger, k, at, acc.slice());
    const old = ledger.periods[k].variables || {};
    const variables: Record<string, VariableSnapshot> = {};
    for (const key of Object.keys(fresh)) variables[key] = sameSnapshot(old[key], fresh[key]) ? old[key] : fresh[key];
    if (Object.keys(variables).some((key) => variables[key] !== old[key]) || Object.keys(old).length !== Object.keys(variables).length) {
      periods[k] = { ...ledger.periods[k], variables };
      changed = true;
    }
    acc.push({ period: k, variables });
  }
  // The original thesis baseline: the earliest period's snapshot, taken once.
  const baseline = ledger.thesis_baseline
    ? ledger.thesis_baseline
    : { period: ordered[0], taken_at: at, variables: acc[0].variables };
  if (!changed && ledger.thesis_baseline) return ledger;
  return { ...ledger, periods, thesis_baseline: baseline };
}

/** True when a stored ledger predates the snapshot schema (any period without
 *  `variables`, or no baseline) — the read path fills it in memory. */
export function needsVariableSnapshots(ledger: CompanyLedger | null | undefined): boolean {
  if (!ledger?.periods) return false;
  const ks = Object.keys(ledger.periods).filter((k) => !!ledger.periods[k]);
  if (!ks.length) return false;
  if (!ledger.thesis_baseline) return true;
  return ks.some((k) => !ledger.periods[k].variables || Object.keys(ledger.periods[k].variables!).length < ALL_VAR_KEYS.length);
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

/** A "check for new evidence" pass saw documents at a source. `unseen` are
 *  documents (from `unseenDocuments`) no period lists yet: they are kept as
 *  pending, which makes the company NEW_EVIDENCE_AVAILABLE even when their
 *  date is not newer than the last read (a transcript filed the same day as
 *  the results, a presentation posted under a new url). (zzz770) */
export function recordSeen(ledger: CompanyLedger, newestDocDate: string | null, now: string, unseen?: SeenDocument[]): CompanyLedger {
  const rp = reportingPeriodFromDate(newestDocDate);
  const known = knownDocumentIds(ledger);
  const pending = new Map((ledger.pending_documents || []).map((d) => [d.id, d]));
  for (const d of unseen || []) if (!known.has(d.id) && !pending.has(d.id)) pending.set(d.id, d);
  return {
    ...ledger, updated_at: now,
    newest_seen_document_date: maxDate(ledger.newest_seen_document_date, newestDocDate),
    newest_seen_period: rp && periodOrdinal(rp.period) > periodOrdinal(ledger.newest_seen_period || '') ? rp.period : ledger.newest_seen_period,
    pending_documents: Array.from(pending.values()).slice(-20),
  };
}

const NEW_EVIDENCE_KINDS = new Set(['transcript', 'investor_presentation', 'results', 'annual_report']);

/**
 * Pure: the candidates no period of the ledger lists — by document id — that
 * could carry evidence (not 'other') and report on the latest period on file
 * or a later one. An older unseen filing is history, not new evidence. A
 * candidate with no date is not claimed as new. (zzz770)
 */
export function unseenDocuments(ledger: CompanyLedger | null | undefined, candidates: Array<{ url: string; kind: string; label?: string; dateIso?: string | null; date_iso?: string | null }>, now: string): SeenDocument[] {
  const known = ledger ? knownDocumentIds(ledger) : new Set<string>();
  const latest = ledger?.latest_period ? periodOrdinal(ledger.latest_period) : -1;
  const out: SeenDocument[] = [];
  const seen = new Set<string>();
  for (const c of candidates || []) {
    // Only the kinds a read takes in: a routine announcement is not a reason
    // to re-read a quarter.
    if (!c?.url || !NEW_EVIDENCE_KINDS.has(c.kind)) continue;
    const id = documentId(c.url);
    if (known.has(id) || seen.has(id)) continue;
    const date = c.dateIso ?? c.date_iso ?? null;
    const rp = reportingPeriodFromDate(date)?.period || null;
    if (!rp) continue;
    if (latest >= 0 && periodOrdinal(rp) < latest) continue;
    seen.add(id);
    out.push({ id, url: c.url, label: c.label || c.url, kind: c.kind, date_iso: date, reporting_period: rp, seen_at: now });
  }
  return out;
}

/** The client's status engine assigned a status to a period. History is
 *  appended only when the status actually changed. The newest run-log entry
 *  for that period gets its `status_after` if it has none yet. */
export function recordStatus(ledger: CompanyLedger, period: string, status: string, because: string | null, tallies: PeriodRecord['tallies'], now: string): CompanyLedger {
  const p = ledger.periods[period];
  if (!p) return ledger;
  const last = ledger.status_history[ledger.status_history.length - 1];
  const changed = !last || last.reporting_period !== period || last.status !== status;
  const log = (ledger.run_log || []).slice();
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].period === period) { if (!log[i].status_after) log[i] = { ...log[i], status_after: status }; break; }
  }
  return {
    ...ledger, updated_at: now,
    periods: { ...ledger.periods, [period]: { ...p, status, status_because: because, tallies: tallies ?? p.tallies, updated_at: now } },
    status_history: changed ? [...ledger.status_history, { reporting_period: period, status, because, at: now }].slice(-40) : ledger.status_history,
    ...(ledger.run_log ? { run_log: log } : {}),
  };
}

/** Append a run-log entry (bounded to the last RUN_LOG_MAX). */
export function appendRunLog(ledger: CompanyLedger, entry: RunLogEntry): CompanyLedger {
  const log = [...(ledger.run_log || []).filter((e) => e.run_id !== entry.run_id), entry].slice(-RUN_LOG_MAX);
  return { ...ledger, run_log: log };
}

/** One line of structured JSON for the server log. */
export function runLogLine(entry: RunLogEntry): string {
  return JSON.stringify({ evt: 'evidence_run', ...entry });
}

/** Pure: build a run-log entry from what a run did. */
export function buildRunLogEntry(args: {
  ticker: string; run: EvidenceRun; before: CompanyLedger | null; after: CompanyLedger;
  diff?: MergeDiff | null; attempts?: Array<{ source: string; outcome: string }>; now?: Date | string;
}): RunLogEntry {
  const { run, before, after, diff } = args;
  const attempts = args.attempts || [];
  const prevStatus = before?.latest_period ? before.periods[before.latest_period]?.status ?? null : null;
  const nowD = args.now || run.finished_at;
  return {
    run_id: run.run_id, at: run.finished_at, ticker: args.ticker, mode: run.mode ?? null, outcome: run.outcome,
    period: diff?.period ?? run.reporting_period ?? null,
    sources_searched: attempts.length,
    sources_failed: attempts.filter((a) => a.outcome === 'error').map((a) => a.source),
    documents_found: run.documents_found || 0, documents_read: run.documents_read || 0,
    documents_new: diff?.documents_new || 0,
    facts_extracted: run.facts_extracted || 0,
    facts_new: diff?.facts_new || 0, facts_updated: diff?.facts_updated || 0, facts_superseded: diff?.facts_superseded || 0,
    events_created: diff?.events_new || 0,
    variables_changed: diff?.variables_changed || [],
    changes: diff?.changes || 'NONE',
    status_before: prevStatus,
    // The status is assigned by the client's engine after the write; it is
    // filled in by recordStatus when that arrives.
    status_after: diff ? null : prevStatus,
    state_before: evidenceStateOf(before, nowD).state,
    state_after: evidenceStateOf(after, nowD).state,
    error: run.error,
  };
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b; if (!b) return a; return a > b ? a : b;
}

// ── freshness ──────────────────────────────────────────────────────────────

// ── REPORTING-PERIOD INTELLIGENCE.                                (zzz765)
//
// "Stale" used to mean "the quarter ended more than 135 days ago". On 22
// September that let CUPID sit at Q4 FY26 looking merely old, while every
// Indian listed company had been obliged to publish Q1 FY27 since 14 August.
// The question a card must answer is sharper: WHICH quarter should be on file
// by now, and is it? SEBI LODR Reg 33: quarterly results within 45 days of
// quarter end; the Q4 / full-year audited results within 60.

/** Pure: the latest quarter whose results every listed Indian company must
 *  have published by `now` (45 days after Q1–Q3 end, 60 after Q4 end). */
export function latestExpectedPeriod(now: Date | string = new Date()): { period: string; period_end: string; due_date: string } {
  const t = typeof now === 'string' ? new Date(now) : now;
  const ms = t.getTime();
  // Walk quarter ends backwards from the one at or before today.
  let y = t.getUTCFullYear();
  let qm = [3, 6, 9, 12].filter((m) => Date.UTC(y, m, 0) <= ms).pop();
  if (qm == null) { y -= 1; qm = 12; }
  for (let i = 0; i < 8; i++) {
    const endMs = Date.UTC(y, qm, 0);
    const lag = qm === 3 ? 60 : 45;
    const due = endMs + lag * 86_400_000;
    if (ms >= due) {
      const q = qm === 6 ? 1 : qm === 9 ? 2 : qm === 12 ? 3 : 4;
      const fy = qm === 3 ? y : y + 1;
      return {
        period: `Q${q} FY${String(fy).slice(2)}`,
        period_end: new Date(endMs).toISOString().slice(0, 10),
        due_date: new Date(due).toISOString().slice(0, 10),
      };
    }
    qm -= 3;
    if (qm <= 0) { qm = 12; y -= 1; }
  }
  // Unreachable: some quarter within two years is always past its due date.
  return { period: 'UNDATED', period_end: '', due_date: '' };
}

export type Staleness = 'CURRENT' | 'UPDATE_AVAILABLE' | 'STALE_NO_NEWER_FILING' | 'NEVER_READ' | 'SOURCE_UNAVAILABLE';

export interface FreshnessView {
  state: FreshnessState;
  detail: string;
  staleness: Staleness;
  latest_known_period: string | null;
  latest_expected_period: string;
  /** Newest document date behind the latest known period. */
  latest_source_date: string | null;
  /** A newer document than the one read has been SEEN at a source. */
  new_evidence_available: boolean;
  /** When the sources were last searched (any attempt or read), and whether
   *  that was after the expected period became due. */
  last_checked_at: string | null;
  checked_since_due: boolean;
  /** The owner's seven explicit states (zzz770) and the reason for it. */
  evidence_state?: CompanyEvidenceState;
  evidence_detail?: string;
}

const STATE_OF: Record<Staleness, FreshnessState> = {
  CURRENT: 'CURRENT', UPDATE_AVAILABLE: 'NEW_EVIDENCE_AVAILABLE', STALE_NO_NEWER_FILING: 'STALE',
  NEVER_READ: 'NEVER_READ', SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
};

/**
 * Pure: the freshness of a company's evidence against the reporting calendar.
 * `state` keeps the old five values for existing callers; `staleness` is the
 * sharper classification:
 *   UPDATE_AVAILABLE        a newer document has been seen but not read
 *   SOURCE_UNAVAILABLE      the last search failed after the last read
 *   STALE_NO_NEWER_FILING   a newer period is due and no newer document has
 *                           been found at any source
 *   CURRENT                 the latest known period is the expected one
 */
function freshnessCore(ledger: CompanyLedger | null, now: Date | string = new Date()): FreshnessView {
  const exp = latestExpectedPeriod(now);
  const known = ledger?.latest_period || null;
  const lastChecked = [ledger?.last_attempt?.at || null, ledger?.last_evidence_read_at || null].filter((x): x is string => !!x).sort().pop() || null;
  const base = {
    latest_known_period: known,
    latest_expected_period: exp.period,
    latest_source_date: ledger?.latest_document_date || null,
    last_checked_at: lastChecked,
    checked_since_due: !!lastChecked && lastChecked.slice(0, 10) >= exp.due_date,
  };
  const out = (staleness: Staleness, detail: string, fresh = false): FreshnessView => ({ state: STATE_OF[staleness], detail, staleness, new_evidence_available: fresh, ...base });

  if (!ledger || !known) {
    if (ledger?.last_attempt?.outcome === 'SOURCE_UNAVAILABLE') return out('SOURCE_UNAVAILABLE', ledger.last_attempt.error || 'the source could not be reached');
    if (ledger?.last_attempt?.outcome === 'NO_DISCLOSURE') return out('NEVER_READ', 'searched — the company has no readable document at any source');
    return out('NEVER_READ', 'no evidence has been read for this company');
  }
  if (ledger.newest_seen_period && periodOrdinal(ledger.newest_seen_period) > periodOrdinal(known)) {
    return out('UPDATE_AVAILABLE', `${ledger.newest_seen_period} documents exist; latest read is ${known}`, true);
  }
  if (ledger.newest_seen_document_date && ledger.latest_document_date && ledger.newest_seen_document_date > ledger.latest_document_date) {
    return out('UPDATE_AVAILABLE', `a newer document (${ledger.newest_seen_document_date}) exists than the one last read (${ledger.latest_document_date})`, true);
  }
  // A document of the current (or a later) period that no read has taken in
  // yet — seen by a check under a url the ledger does not list. (zzz770)
  const pend = pendingDocuments(ledger);
  if (pend.length) {
    return out('UPDATE_AVAILABLE', `${pend.length} unread document${pend.length === 1 ? '' : 's'} seen for ${pend[0].reporting_period}: ${pend.slice(0, 3).map((d) => d.label).join('; ')}`, true);
  }
  // A failed PRIOR-quarter backfill says nothing about the current period's
  // sources being down; it is recorded in the run log, not on the card. (zzz765)
  const attemptRun = ledger.last_attempt ? ledger.runs.find((r) => r.run_id === ledger.last_attempt!.run_id) : null;
  const attemptOnOlder = !!attemptRun?.reporting_period && attemptRun.reporting_period !== ledger.latest_period;
  if (!attemptOnOlder && ledger.last_attempt?.outcome === 'SOURCE_UNAVAILABLE' && ledger.last_attempt.at >= (ledger.last_evidence_read_at || '')) {
    return out('SOURCE_UNAVAILABLE', `last check failed: ${ledger.last_attempt.error || 'source unreachable'} — showing ${known}`);
  }
  if (periodOrdinal(known) >= 0 && periodOrdinal(known) < periodOrdinal(exp.period)) {
    return out('STALE_NO_NEWER_FILING', base.checked_since_due
      ? `${exp.period} results were due by ${exp.due_date}; no filing newer than ${known} was found at any source (checked ${String(lastChecked).slice(0, 10)})`
      : `${exp.period} results were due by ${exp.due_date}; the sources have not been searched since — check for new evidence`);
  }
  return out('CURRENT', `${known} · read ${(ledger.last_evidence_read_at || '').slice(0, 10)}`);
}

/** Pending documents that still matter: not listed by any period, and of
 *  the latest period on file or a later one. */
export function pendingDocuments(ledger: CompanyLedger | null | undefined): SeenDocument[] {
  if (!ledger?.pending_documents?.length) return [];
  const known = knownDocumentIds(ledger);
  const latest = ledger.latest_period ? periodOrdinal(ledger.latest_period) : -1;
  return ledger.pending_documents.filter((d) => !known.has(d.id) && (latest < 0 || periodOrdinal(d.reporting_period || '') >= latest));
}

/** Pure: why did this run produce nothing? Explicit on v2 runs; inferred on
 *  v1 runs from their outcome and error text. */
export function failureKindOf(run: Pick<EvidenceRun, 'outcome' | 'error' | 'failure_kind'> | null | undefined): FailureKind | null {
  if (!run) return null;
  if (run.failure_kind) return run.failure_kind;
  if (run.outcome === 'FAILED') return 'model_failed';
  if (run.outcome !== 'SOURCE_UNAVAILABLE') return null;
  return /download|scanned|ocr|could not be read|none could be read|budget/i.test(String(run.error || '')) ? 'document_unreadable' : 'source_unreachable';
}

/**
 * Pure: the company's evidence state — one of the owner's seven — from the
 * persisted ledger alone. Currentness is per company, from ITS latest
 * reporting period against the reporting calendar, never a global cutoff.
 * A retrieval failure maps to SOURCE_UNAVAILABLE or RETRIEVAL_FAILED and is
 * never read as an absence of disclosure.
 */
export function evidenceStateOf(ledger: CompanyLedger | null | undefined, now: Date | string = new Date()): { state: CompanyEvidenceState; detail: string } {
  const f = freshnessCore(ledger || null, now);
  const la = ledger?.last_attempt || null;
  const run = la ? (ledger!.runs || []).find((r) => r.run_id === la.run_id) || { outcome: la.outcome, error: la.error } : null;
  const failState = (kind: FailureKind | null): CompanyEvidenceState => (kind === 'source_unreachable' ? 'SOURCE_UNAVAILABLE' : 'RETRIEVAL_FAILED');
  if (!ledger?.latest_period) {
    if (pendingDocuments(ledger).length || (ledger?.newest_seen_document_date && !la)) {
      return { state: 'NEW_EVIDENCE_AVAILABLE', detail: 'documents have been found at a source and not yet read' };
    }
    if (!la) return { state: 'NOT_SEARCHED', detail: 'no search has run for this company' };
    if (la.outcome === 'SOURCE_UNAVAILABLE' || la.outcome === 'FAILED') {
      const k = failureKindOf(run as any);
      return { state: failState(k), detail: la.error || (k === 'source_unreachable' ? 'the source could not be reached' : 'documents could not be read') };
    }
    return { state: 'EVIDENCE_INCOMPLETE', detail: la.outcome === 'NO_DISCLOSURE' ? 'searched — no readable document at any source' : 'searched — nothing read yet' };
  }
  switch (f.staleness) {
    case 'UPDATE_AVAILABLE': return { state: 'NEW_EVIDENCE_AVAILABLE', detail: f.detail };
    case 'SOURCE_UNAVAILABLE': return { state: failState(failureKindOf(run as any)), detail: f.detail };
    case 'STALE_NO_NEWER_FILING': return { state: 'STALE', detail: f.detail };
    default: break;
  }
  // A reader failure on the CURRENT period after the last read. (A failed
  // prior-quarter backfill says nothing about the current period.)
  const attemptOnOlder = !!(run as any)?.reporting_period && (run as any).reporting_period !== ledger.latest_period;
  if (la && la.outcome === 'FAILED' && !attemptOnOlder && la.at >= (ledger.last_evidence_read_at || '')) {
    return { state: 'RETRIEVAL_FAILED', detail: `last read failed: ${la.error || 'reader error'} — showing ${ledger.latest_period}` };
  }
  const p = ledger.periods[ledger.latest_period];
  if (!p || !p.documents_read || (!(p.facts || []).length && !(p.events || []).length)) {
    return { state: 'EVIDENCE_INCOMPLETE', detail: `${ledger.latest_period} on file but ${!p || !p.documents_read ? 'no document was read' : 'no structural fact was extracted'}` };
  }
  return { state: 'CURRENT', detail: f.detail };
}

/**
 * Pure: the freshness of a company's evidence against the reporting calendar.
 * `state` keeps the old five values for existing callers; `staleness` is the
 * sharper classification; `evidence_state` is the owner's seven (zzz770).
 */
export function freshnessOf(ledger: CompanyLedger | null, now: Date | string = new Date()): FreshnessView {
  const f = freshnessCore(ledger, now);
  const e = evidenceStateOf(ledger, now);
  return { ...f, evidence_state: e.state, evidence_detail: e.detail };
}

/** Pure: the one-line freshness text a card shows. (zzz765)
 *    "STALE · Last evidence: Q4 FY26 · Latest expected: Q1 FY27 · No newer filing found"
 *    "↻ Update available · Last evidence: Q4 FY26 · newer document seen" */
export function freshnessLine(f: Partial<FreshnessView> & { state: FreshnessState; detail: string } | null | undefined): { label: string; text: string; tone: 'ok' | 'warn' | 'alarm' | 'muted' } | null {
  if (!f) return null;
  const staleness: Staleness = f.staleness || (f.state === 'NEW_EVIDENCE_AVAILABLE' ? 'UPDATE_AVAILABLE' : f.state === 'STALE' ? 'STALE_NO_NEWER_FILING' : f.state as Staleness);
  const last = f.latest_known_period ? `Last evidence: ${f.latest_known_period}` : null;
  const exp = f.latest_expected_period ? `Latest expected: ${f.latest_expected_period}` : null;
  const join = (...xs: Array<string | null | false | undefined>) => xs.filter(Boolean).join(' · ');
  // The owner's explicit states the legacy five cannot say. (zzz770)
  if (f.evidence_state === 'RETRIEVAL_FAILED') return { label: 'RETRIEVAL FAILED', text: join(last, 'documents exist but could not be read — not a disclosure gap'), tone: 'alarm' };
  if (f.evidence_state === 'EVIDENCE_INCOMPLETE') return { label: 'EVIDENCE INCOMPLETE', text: join(last, f.evidence_detail || 'no structural fact on file'), tone: 'warn' };
  if (f.evidence_state === 'NEW_EVIDENCE_AVAILABLE' && staleness === 'NEVER_READ') return { label: '↻ Update available', text: join(exp, 'documents found, not yet read'), tone: 'warn' };
  if (f.evidence_state === 'NOT_SEARCHED') return { label: 'NOT SEARCHED', text: join(exp), tone: 'muted' };
  switch (staleness) {
    case 'CURRENT': return { label: 'CURRENT', text: join(last, f.latest_source_date && `source dated ${f.latest_source_date}`), tone: 'ok' };
    // zzz790: the owner's words for it.
    case 'UPDATE_AVAILABLE': return { label: 'NEWER EVIDENCE AVAILABLE — NOT YET READ', text: join(last, 'newer document seen, not yet read — the evidence on file is historical context until it is read'), tone: 'warn' };
    case 'STALE_NO_NEWER_FILING': return { label: 'STALE', text: join(last, exp, f.checked_since_due === false ? 'not searched since it fell due' : 'No newer filing found'), tone: 'warn' };
    case 'SOURCE_UNAVAILABLE': return { label: 'SOURCE UNAVAILABLE', text: join(last, exp, 'the sources could not be reached — not a disclosure gap'), tone: 'alarm' };
    default: return { label: 'NEVER READ', text: join(exp), tone: 'muted' };
  }
}

// ── what changed ───────────────────────────────────────────────────────────

export interface ChangeLine { sign: '+' | '-' | '·'; text: string; metric: VarKey; period: string; source: string;
  /** 'change' only when a comparable previous value exists and differs;
   *  everything else is 'evidence' — found this period, not a change. The
   *  card prints the two under different headings. (zzz773) */
  kind?: 'change' | 'evidence' }

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
    before: f.before_value, after: f.after_value, source: f.source_name || f.source_type, confidence: f.confidence,
    quality: judgeEventQuality({ variable: f.metric_name, before: f.before_value, after: f.after_value, unit: f.unit, evidence_text: f.source_quote }),
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
      // Capacity also needs the same measure AND scope (zzz773): 55 MT of
      // mining throughput is not an earlier reading of 150,000 MTPA.
      const capWhy = (k === 'capacity' || k === 'capacity_addition')
        ? capacityMismatch({ value: p.value, unit: p.unit, quote: p.source_quote }, { value: f.value, unit: f.unit, quote: f.source_quote }) : null;
      const comparable = sameUnit(p.value, f.value, p.unit, f.unit) && !capWhy;
      const d = comparable ? deltaOf(p.value, f.value, f.unit) : null;
      const sign: ChangeLine['sign'] = !comparable ? '·' : d ? (d.startsWith('-') ? '-' : '+') : '·';
      lines.push({ sign, text: comparable ? `${label} ${p.value} → ${f.value}${d ? ` (${d})` : ''}`
        : capWhy ? `${label} ${f.value} (earlier period stated ${p.value} — ${capWhy})`
          : `${label} ${f.value} (earlier period stated ${p.value} — different unit, not compared)`,
        metric: k, period: to, source: f.source_name, kind: comparable && d ? 'change' : 'evidence' });
    } else if (!p) {
      const bn0 = scaledNumber(f.before_value), an0 = scaledNumber(f.after_value);
      const arith: ChangeLine['sign'] | null = bn0 != null && an0 != null && bn0 !== an0 ? (an0 > bn0 ? '+' : '-') : null;
      // Days of working capital falling is the good direction; the sign on
      // WHAT CHANGED reads as good/bad, so it follows the meaning. (zzz764)
      const daysInverse = k === 'working_capital' && /days?|cycle/i.test(`${f.before_value || ''} ${f.after_value || ''} ${f.unit || ''}`);
      const raw: ChangeLine['sign'] = arith ?? (dir === 'down' ? '-' : dir === 'up' ? '+' : '·');
      const sign: ChangeLine['sign'] = daysInverse && raw !== '·' ? (raw === '+' ? '-' : '+') : raw;
      // A figure restated identically is a LEVEL, not a move. (zzz758)
      // The same number in two phrasings is restated too. (zzz763)
      const bn = scaledNumber(f.before_value), an = scaledNumber(f.after_value);
      const restated = !!f.before_value && !!f.after_value
        && (f.before_value.trim().toLowerCase() === f.after_value.trim().toLowerCase()
          || (bn != null && an != null && bn === an));
      // ── THE DELTA IS ARITHMETIC, NEVER THE MODEL'S.                 (zzz763)
      //
      // GPPL printed "a little less than 1,000,000 metric tonnes → 1.6
      // million metric tonnes (−100%)": the model's own `delta` field, taken
      // verbatim. Two stated figures of one unit give a delta by division;
      // where they do not, the model's string is used only if it is a rate.
      const computed = f.before_value && f.after_value && sameUnit(f.before_value, f.after_value, f.unit, f.unit)
        ? deltaOf(f.before_value, f.after_value, f.unit) : null;
      const modelRate = f.delta && /^[+-]?\d+(?:\.\d+)?\s*(%|pp|bps)$/i.test(f.delta.trim()) && bn == null ? f.delta.trim() : null;
      const shownDelta = computed || modelRate;
      const text = f.before_value && f.after_value && !restated
        ? `${label} ${f.before_value} → ${f.after_value}${shownDelta ? ` (${shownDelta})` : ''}`
        : `${label} ${f.value}`;
      // A before → after stated in the document is a change only when the
      // two figures share a unit and the sentence is not a plan. (zzz773)
      const inTextChange = !!(f.before_value && f.after_value && !restated && computed)
        && !forwardAround(f.source_quote || '', f.after_value) && !approvalPlan(f.source_quote, f.after_value);
      lines.push({ sign: inTextChange ? sign : '·', text, metric: k, period: to, source: f.source_name, kind: inTextChange ? 'change' : 'evidence' });
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
    lines.push({ sign: '·', text: `${VAR_LABEL[f.metric_name] || f.metric_name}: ${f.fact_or_management_statement.toLowerCase().replace('_', ' ')} ${f.value}`, metric: f.metric_name, period: to, source: f.source_name, kind: 'evidence' });
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
