// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL VARIABLES — WHAT ACTUALLY CHANGED.                     (zzz715)
//
// From the owner's specification. The instruction that shapes every line of
// this file: "Don't store news. Store events + evidence + implication." And
// the harder one underneath it: "Separate facts from interpretation."
//
// So a structural variable is a BEFORE, an AFTER, and a source — never a
// sentiment, never a score, and never a number this module computed from a
// number the filing did not state. Where the filing gives one side only, the
// other side stays null and the variable says `unknown`. An unknown variable
// is a real answer: it is the difference between "utilisation did not improve"
// and "the company did not disclose utilisation", and collapsing those two
// into one is how an exit engine ends up firing on silence.
//
// TWO EVIDENCE LEVELS, NEVER MIXED:
//
//   · GRADER   — the numbers the earnings engine computed from the filed
//                statements: revenue growth, earnings growth, OPM change,
//                cash conversion. Machine-read, no model involved.
//   · FILING   — the figure-verified `structured` object from the AI summary,
//                every number of which was checked against the document text
//                before it was allowed out of the route.
//
// Both are facts about a document. Nothing in this file is an inference about
// the future; that happens one layer up, in status.ts, and is labelled there.
// ═══════════════════════════════════════════════════════════════════════════

import {
  VAR_LABEL, VAR_GROUP, GRADER_AVAILABLE, businessProfileOf, isServicesBusiness,
  type VarKey, type VarGroup, type EvidenceKind,
} from './taxonomy';

import { bestEventPerVariable, judgeEventQuality, valueFitsVariable, verifiedDirection, type StructuralEvent } from './evidence-extract';
import { scaledNumber, sameUnit, magnitudeOf, deltaOf as ledgerDeltaOf, periodOrdinal, needsVariableSnapshots, withVariableSnapshots, formatDeltaAbs, type CompanyLedger, type VariableSnapshot } from './evidence-ledger';
import { BASIS_LABEL, type MetricComparison } from './comparison';
import { normalizeEvent, gapToTarget, hedgedAround, rangeOf, datesIn, stripPeriodTokens, movePeriodOut } from './fact-normalize';
import { parseOneOff, oneOffLine } from './one-offs';
import type { ChangeLine, LedgerDocument } from './evidence-ledger';
import {
  factTypeOf, metricGroupOf, validateReading, validateCashConversion, lineageOf, normalizeValue,
  comparability, capacityMismatch, isCapacityFigure, samePeriodPair, scopeOf, hasQuantity, isCommentaryOnly, RECURRING_METRICS, EVENT_METRICS,
  PRIOR_NOT_DISCLOSED, FACT_TYPE_LABEL,
  type FactType, type MetricGroup, type Validation, type Lineage, type NormalizedValue, type FactScope,
} from './fact-model';
export type { FactType, MetricGroup, Validation, Lineage, NormalizedValue, FactScope };

export { VAR_LABEL, VAR_GROUP, GRADER_AVAILABLE };
export type { VarKey, VarGroup, EvidenceKind };

// ── FIVE VERDICTS, NOT FOUR.                                       (zzz754)
//
// 'unknown' used to mean two different things: "nobody disclosed this" and
// "this was disclosed as a level with nothing to compare it to". The card
// drew the same hollow circle for both, so EXICOM's "order book INR1,400
// crores" and "utilisation 65%" — read, verified, on file — rendered as
// ○ Order book / ○ Capacity utilisation, and the status text listed them
// under "Missing". A figure the company stated is not missing.
//
//   stated  — disclosed, value shown, no comparison basis → neither
//             confirms nor contradicts; counted as disclosed, never as absent.
//   unknown — nothing on file for this variable.
export type VarVerdict = 'improving' | 'flat' | 'deteriorating' | 'stated' | 'unknown';
export type VarSource = 'grader' | 'filing';

/** ── zzz771 CONTRACT (PC-1 fills, PC-3 renders) ───────────────────────────
 *  Every quantitative thesis variable as a reading with its comparison:
 *  Current → Previous → Δ absolute → Δ % → direction → period. A missing
 *  previous is NOT_COMPARABLE with the reason, never a silent level. */
export type PeriodClass = 'CURRENT_QUARTER' | 'PREVIOUS_QUARTER' | 'PREVIOUS_FY' | 'HISTORICAL' | 'MANAGEMENT_TARGET' | 'GUIDANCE' | 'THESIS_BASELINE';
export interface ReadingPoint {
  value: string;
  period: string | null;
  period_class: PeriodClass;
  unit: string | null;
  /** Numeric value in the normalised unit, when the text parses to one number. */
  numeric: number | null;
  source: string | null;
}
export interface VariableReading {
  current: ReadingPoint | null;
  previous: ReadingPoint | null;
  /** The first reading ever taken for this holding (the original thesis baseline), when different from previous. */
  baseline: ReadingPoint | null;
  delta_abs: string | null;
  delta_pct: string | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN' | 'NOT_COMPARABLE';
  comparison_basis: 'QoQ' | 'YoY' | 'vs_prior_read' | 'vs_baseline' | 'in_text' | null;
  /** Why there is no comparison: "first reading", "unit changed", "scope changed", "same period", "not disclosed earlier". */
  not_comparable_reason: string | null;
  /** "80% (Q1 FY27) vs 70% (Q4 FY26) · +10pp · ▲ QoQ" or "80% (Q1 FY27) · previous: not disclosed (first reading)". */
  display: string;
}
export interface StructuralVar {
  /** zzz771: the time-series reading behind this row. Optional until PC-1 fills it. */
  reading?: VariableReading | null;
  key: VarKey;
  label: string;
  /** fact | claim | derived — the spec's hallucination firewall. A management
   *  target is a CLAIM about the future and must never read like a filed
   *  figure; operating leverage is DERIVED and must never read like something
   *  the company said. (zzz720) */
  kind?: EvidenceKind;
  /** As the source stated it. Strings, not numbers: "68%", "₹500 Cr", "2.1x". */
  before: string | null;
  after: string | null;
  /** The change, where the source stated both sides or stated the delta. */
  delta: string | null;
  verdict: VarVerdict;
  /** One line naming what was read and from where. Never a paraphrase of a
   *  conclusion — the fact itself. */
  evidence: string;
  source: VarSource;
  /** ── THE LONGITUDINAL JOIN.                                     (zzz758)
   *
   *  Non-null when the evidence ledger holds an earlier period carrying this
   *  same variable, so the row can print CURRENT → PREVIOUS → CHANGE with the
   *  comparison basis attached. Null where no earlier figure exists — and the
   *  card then says PREVIOUS: NOT DISCLOSED rather than inventing one. */
  comparison?: MetricComparison | null;
  /** ── TWO SOURCES, TWO NUMBERS.                                  (zzz759)
   *
   *  Non-null when another document read for the same period states a
   *  different value for this same variable. The more authoritative source
   *  supplies the row; the disagreement is never resolved silently, because a
   *  filing and a concall contradicting each other on a capacity is a fact
   *  about the disclosure, not a parsing detail. */
  conflict?: { value: string; source: string }[] | null;
  /** Why a disclosed figure is shown but NOT judged — a loss base, an
   *  unreadable sign, a sequential-only move, an unsized one-off. Distinct
   *  from "level with no comparison", which is the default reading of a
   *  stated value. Status prints this reason instead. (zzz763) */
  unjudged?: string | null;
  /** ── WHAT KIND OF STATEMENT THE ROW IS.                         (zzz765)
   *  ACTUAL — a reported figure; MANAGEMENT_STATEMENT — management's own
   *  description ("pretty much at maximum"); GUIDANCE / TARGET — forward;
   *  HISTORICAL — dated before this reporting period, shown as context. */
  statement?: 'ACTUAL' | 'MANAGEMENT_STATEMENT' | 'GUIDANCE' | 'TARGET' | 'HISTORICAL';
  /** The forward statement for the same variable, kept BESIDE the actual
   *  rather than merged into it: "Actual 74% · Target 80%+ · gap −6pp". */
  plan?: { value: string; type: 'GUIDANCE' | 'TARGET'; quote: string; source: string; gap: string | null } | null;
  /** The period the figure describes: the reporting period, or the date a
   *  historical figure is pinned to. */
  asOf?: string | null;
  /** Which read document the row came from (its label, as the card lists it). */
  sourceLabel?: string | null;
  /** Verbatim sentence behind the row. */
  quote?: string | null;
  /** Figures for the same variable dated BEFORE this period — context only. */
  context?: { value: string; asOf: string; quote: string; source: string }[] | null;
  /** Why the reading's type was corrected from the model's label. */
  retyped?: string | null;
  // ── THE FACT MODEL.                                              (zzz770)
  /** The owner's seven types: ACTUAL, MANAGEMENT_GUIDANCE, MANAGEMENT_TARGET,
   *  MANAGEMENT_COMMENTARY, HISTORICAL, ESTIMATE, SECONDARY_REPORT. */
  fact_type?: FactType;
  /** OUTPUT (what happened: revenue, margin, earnings, cash, ROCE…) or
   *  MECHANISM (why: capacity, utilisation, orders, customers, capex…). */
  metric_group?: MetricGroup;
  /** UNCLEAR = "validation required": shown, counted neither confirmed nor
   *  contradicted (verdict 'stated' or 'unknown', `unjudged` carries why). */
  validation?: Validation | null;
  /** Where the figure came from: id, name, url, type, date, period, page, quote. */
  lineage?: Lineage | null;
  /** raw_value / raw_unit / normalized_value / normalized_unit / conversion_method. */
  normalized?: NormalizedValue | null;
  /** Plant / project / phase / segment / basis the figure's clause names. */
  scope?: FactScope | null;
  /** Other readings of the SAME figure for the same period (a duplicate
   *  kept as corroboration, never a change). */
  corroboration?: { value: string; source: string }[] | null;
  /** The row as the owner asked it printed: "68% → 74% · +6pp", "74% · prior
   *  comparable value not disclosed", "Actual: 74% · Target: 80%+". */
  display?: string;
}


const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The AI-summary routes are instructed to write "not stated" rather than
 *  invent, so a placeholder is data — it means the document was silent. */
const PLACEHOLDER =
  /^(not\s+(stated|disclosed|quantified|available|applicable|given|provided)|n\/?a|none|unknown|—|-|nil)$/i;

const PLACEHOLDER_PREFIX = /^(not\s+(stated|disclosed|quantified|available|applicable|given|provided|mentioned|specified)|no (figure|number|data|detail)s?\b|n\/?a\b|none\b|unknown\b)/i;
export function said(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  // "Not stated in release" is a placeholder with a suffix, and AETHER
  // printed it as a before value: "Not stated in release → 74%". (zzz763)
  return s.length > 0 && !PLACEHOLDER.test(s) && !PLACEHOLDER_PREFIX.test(s);
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;

/** Percent out of a stated string like "68%", "68.5 per cent", "82". */
function pctIn(s: unknown): number | null {
  if (!said(s)) return null;
  // "Q4 FY26: 72%" is 72, not 4. (zzz772)
  const m = stripPeriodTokens(String(s)).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read every structural variable the two sources can support.
 *
 * `graded` is a row from the India or US earnings grader; `summary` is the
 * verified `structured` object from the AI summary route. Either may be null,
 * and the result is simply shorter — a holding with no filing read yet has a
 * thesis evaluated on grader numbers alone, and the UI says so rather than
 * pretending the evidence is complete.
 */
// ═══════════════════════════════════════════════════════════════════════════
// FROM TYPED EVENTS.                                                (zzz738)
//
// The events stage (lib/thesis/evidence-extract) returns facts that were
// validated against the document sentence they came from. They take
// precedence over the summary's loose fields for the same variable, for a
// reason that matters: an event carries its semantic type. A utilisation
// ACTUAL of 84% and a utilisation TARGET of 90% are both shown, and the
// verdict is computed from the actual alone — a card that let a target read
// as a filed figure would be wrong in the way that costs money.
// ═══════════════════════════════════════════════════════════════════════════

/** Variables where MORE is WORSE. A model reports "execution delay: up"
 *  meaning the delay grew; that is a deterioration, and TI's card printed it
 *  as "▲ Execution delay" in green. (zzz754) */
const NEGATIVE_VARS = new Set<VarKey>(['execution_delay', 'customer_loss', 'shutdown', 'capacity_bottleneck', 'supply_bottleneck', 'customer_concentration']);

/** "No explicit customer losses stated", "none", "no delays" — the summary
 *  put the company's denial into the field, and `said()` read a denial as a
 *  disclosure. A denial is a CHECKED, FLAT variable, not a deterioration. */
const DENIAL = /^(no|none|nil|not any|no explicit|no material|no significant|there (were|was|are|is) no|did not|does not|didn't|doesn't|without any)\b/i;
/** "Projects on schedule", "no stated delays", "not delayed", "on track" —
 *  a reassurance, not a delay. Anywhere in the value, not only at the start. (zzz767) */
const REASSURANCE = /\b(no (?:stated|explicit|specific|new|major|material|reported|cited|significant)?\s*(?:capex |project |execution )?delays?\b|not (?:been )?delayed|on (?:schedule|track|time)\b|as per (?:schedule|plan)|within (?:the )?(?:timeline|schedule))/i;
const DELAY_WORDS = /\b(delayed by|slipp(?:ed|age)|pushed (?:out|back)|deferred|postponed|behind schedule|paused)\b/i;
/** A delay field is a ▼ only when it reports a delay that HAPPENED. A
 *  timeline ("Phase-2 targeted Q2 FY28"), a plan ("deliveries expected in the
 *  next couple of months") or a possibility ("could delay", "timelines may
 *  shift") is stated, not judged. E2E, BHAGCHEM, KMEW and AARTIPHARM printed
 *  a red ▼ Execution delay for a schedule. (zzz767) */
// A customer's "temporary pause on CDMO volumes" is a deferral that happened
// (JUBLINGREA). (zzz769)
const HAPPENED_DELAY = /\b(delay(?:ed|s)?|slipp(?:ed|age)|pushed (?:out|back)|deferr(?:ed|al)|postpon|behind schedule|gating|stoppage|suspen(?:ded|sion)|halt(?:ed)?|disrupt(?:ed|ion)|curtail(?:ed|ment)?|cancell?(?:ed|ation)|paus(?:e|ed|ing)\b)/i;
// ── A POSSIBILITY IS NOT A DELAY, HOWEVER IT IS WORDED.            (zzz769)
// "potential project execution delays" (TDPOWERSYS) has two words between the
// hedge and the delay; "(risk if delayed)" (TI) is a condition. Both printed
// ▼ Execution delay. Up to three words may sit between the hedge and the
// delay word, and a conditional ("if / should / in case of … delayed") or a
// "risk of … delay" is a possibility too.
const POSSIBLE_DELAY = /\b(?:(?:could|may|might|can|possible|possibly|potential(?:ly)?|risks?(?: of)?|any)\s+(?:[\w-]+\s+){0,3}?|(?:if|should|unless|in case(?: of)?|in the event(?: of)?|risk if)\s+(?:[\w-]+\s+){0,3}?)(delay\w*|slip\w*|shift\w*|push\w*|defer\w*|postpon\w*|paus\w*)/gi;
export function delayVerdict(text: string | null): VarVerdict {
  const t = String(text || '');
  if (!t) return 'unknown';
  if (isDenial(t)) return 'deteriorating';          // push_ turns a denial into flat
  return HAPPENED_DELAY.test(t.replace(POSSIBLE_DELAY, ' ')) ? 'deteriorating' : 'stated';
}
export const isDenial = (v: unknown): boolean => {
  if (!said(v)) return false;
  const t = String(v).trim();
  if (DENIAL.test(t)) return true;
  return REASSURANCE.test(t) && !DELAY_WORDS.test(t);
};

/** One-off vocabulary: an item that is a genuine non-repeating P&L event. */
const ONE_OFF_EVENT = /one[- ]?off|one[- ]time|exceptional|non[- ]recurring|write[- ]?back|reversal|impairment|gain on (sale|disposal)|loss on (sale|disposal)|profit on sale|sale of|insurance|settlement|arbitration|refund|fair value|mark[- ]to[- ]market|\bmtm\b|forex|foreign exchange|earn[- ]?out|provision/i;
/** A proceeds-utilisation table (IPO / QIP money raised and spent). */
export const isFundRaiseLine = (t: string): boolean =>
  /\braised\b|\butili[sz](ed|ation)\b|\bproceeds\b|\bIPO\b|\bQIP\b/i.test(t) && !ONE_OFF_EVENT.test(t);
/** An amount expected in a later period is not in this quarter's profit. */
const ONE_OFF_FUTURE = /\bexpected\b|\bwill be\b|\bto be (received|recognised|recognized|booked)\b|\banticipat|\blikely\b|\bupcoming\b|\bin the coming\b/i;
/** Routine other income — interest, treasury, dividends — is not a one-off. */
const ONE_OFF_ROUTINE = /other income|other gain|\binterest\b|treasury|dividend income|investment income|\bFDR\b|fixed deposit/i;

/** A margin driver that names a mechanism which LIFTS the margin, and does
 *  not describe a decline, pressure or hit. (zzz769) */
const DRIVER_POSITIVE = /improv|expan|higher margin|operating leverage|better|richer|premium|favou?rable|value[- ]added/i;
const DRIVER_NEGATIVE = /declin|decreas|pressure|impact|headwind|compress|contract(ed|ion)|drag|weigh|adverse|erod|squeez|under-?absorp|lower (absorption|realis|realiz|volume|utilis|utiliz|margin)|one[- ]time expense|deleverag/i;
export function marginDriverPositive(detail: string): boolean {
  const t = String(detail || '');
  if (!DRIVER_POSITIVE.test(t)) return false;
  // A positive word inside a negative description ("better than the
  // decline feared") still leaves the driver describing pressure.
  return !DRIVER_NEGATIVE.test(t) || /improv|expan|operating leverage/i.test(t) && !/declin|decreas|compress/i.test(t);
}

const numIn = (s: string | null): number | null => {
  if (!s) return null;
  // Period labels stripped first: "Q1 FY26: 54.80" is 54.80. (zzz772)
  const m = stripPeriodTokens(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** A stated change between two like-for-like figures, or null. Never
 *  derived across units, and never derived when either side is missing.
 *  One implementation for the board and WHAT CHANGED: this used to parse
 *  the first digit it met, so "Q4 FY26 → nearly doubling compared with Q4
 *  FY26" printed "+0%" (both sides read as 4), and "59 days → 59 days by Q4
 *  FY26" printed a move of zero. (zzz764) */
function deltaOf(before: string | null, after: string | null): string | null {
  if (!before || !after) return null;
  if (!sameUnit(before, after, null, null)) return null;
  return ledgerDeltaOf(before, after, null);
}
/** Same number in two phrasings = one figure stated twice, not a move. */
function restatedPair(before: string | null, after: string | null): boolean {
  if (!before || !after) return false;
  const b = scaledNumber(before), a = scaledNumber(after);
  return b != null && a != null && b === a;
}

/** "+1400 Cr" on a slide means "more than 1,400 crore" — a level. Printed with
 *  the plus in front it reads as a change of 1,400 crore. (zzz763) */
export function levelText(s: string | null): string | null {
  if (!s) return s;
  const t = s.trim();
  if (/^\+\s*\d/.test(t) && !/%|\bpp\b|\bbps\b/i.test(t)) return `over ${t.replace(/^\+\s*/, '')}`;
  return t;
}

/** Working capital measured in DAYS is better when it falls. The same
 *  variable stated as cash is not. (zzz763) */
export function inverseByUnit(key: VarKey, text: string): boolean {
  return key === 'working_capital' && /\bdays?\b|cycle/i.test(text);
}

/** Working-capital DAYS against a plan: fewer days is the better side.
 *  UNIMECH "approximately 130 days · plan 160 days plus" is 30 days better
 *  than the plan, not a shortfall. Null unless both sides are day counts. (zzz772) */
export function daysGap(actual: string | null | undefined, plan: string | null | undefined): string | null {
  const a = normalizeValue(actual), p = normalizeValue(plan);
  if (a.dimension !== 'days' || p.dimension !== 'days' || a.normalized_value == null || p.normalized_value == null) return null;
  const d = Math.round((a.normalized_value - p.normalized_value) * 10) / 10;
  if (d === 0) return 'on plan';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} days, ${d < 0 ? 'better' : 'worse'} than plan`;
}

/** A figure, not a label: "Phase 1", "Unit 2", "Q3 FY26" carry digits and
 *  measure nothing. (zzz769) */
function hasFigure(s: string | null | undefined): boolean {
  return /\d/.test(String(s ?? '')
    .replace(/\b(phase|unit|line|block|stage|tranche|site|plant|building|module)\s*[-#]?\s*\d+\b/gi, ' ')
    .replace(/\b(FY|CY|H[12]|Q[1-4])\s*'?\d{2,4}\b/gi, ' '));
}
/** The plan states the actual's own figure again. (zzz769) */
function samePlanFigure(actual: string | null | undefined, plan: string | null | undefined): boolean {
  const a = String(actual ?? ''), p = String(plan ?? '');
  if (a.replace(/[^\d.]/g, '') === p.replace(/[^\d.]/g, '')) return true;
  const ra = rangeOf(a), rp = rangeOf(p);
  return !!ra && !!rp && ra.lo === rp.lo && ra.hi === rp.hi && ra.pct === rp.pct
    && magnitudeOf(a) === magnitudeOf(p);
}

export function varsFromEvents(events: StructuralEvent[] | null | undefined, period?: string | null, docs?: LedgerDocument[] | null): StructuralVar[] {
  if (!Array.isArray(events) || !events.length) return [];
  const out: StructuralVar[] = [];
  // ── TYPE FIRST, THEN RANK.                                       (zzz765)
  //
  // The model's label is corrected from the sentence before anything is
  // ranked (fact-normalize.ts): "another 1,024 B200 we are expecting soon"
  // stops being this quarter's capacity; "INR593 crores as on 31 March 2025"
  // stops being Q1 FY27 working capital. And a reading whose value does not
  // fit its variable is set aside BEFORE the ranking — otherwise E2E's MRR
  // figure (Rs million, filed under utilisation) outranked, and then took
  // down with it, management's own "pretty much at maximum level".
  const norm = events.map((e) => normalizeEvent(e, period));
  const historical = norm.filter((e) => e.historical_as_of && e.value_type === 'ACTUAL');
  const live = norm.filter((e) => !(e.historical_as_of && e.value_type === 'ACTUAL'))
    // Commentary carries no figure, so no unit test applies; it is kept and
    // typed as what it is rather than dropped. (zzz770)
    // …except utilisation: a sentence with no fill rate in it is not a
    // utilisation commentary either (AZAD's construction schedule, TATATECH's
    // growth outlook). (zzz772)
    .filter((e) => (e.commentary && e.variable !== 'utilisation' && e.variable !== 'capex') || judgeEventQuality(e) !== 'unit_mismatch');
  const slots = bestEventPerVariable(live);
  for (const [key, slot] of slots) {
    const a = slot.actual as (StructuralEvent & { flat_stated?: boolean; retyped_because?: string | null }) | null;
    const f = slot.forward;
    const label = VAR_LABEL[key] || key;
    // Only disagreements between values that would BOTH have been shown count.
    // A wrong-unit reading losing to a good one is the filter working, not two
    // sources contradicting each other.
    // ── A DIFFERENT MEASURE IS NOT A DISAGREEMENT.                 (zzz770)
    // GPPL's 1.6m MT of liquids, 5.2m MT of liquid-cargo capacity and 260–270k
    // RoRo cars are three scopes, not three answers to one question. Only a
    // reading the comparability engine would subtract is a conflict.
    const winnerVal = a ? String(a.after ?? a.before ?? '') : '';
    const conflicts = (slot.conflicts || [])
      .filter((c) => judgeEventQuality(c) !== 'unit_mismatch')
      .filter((c) => !a || comparability(
        { key, value: String(c.after ?? c.before ?? ''), unit: c.unit, quote: c.evidence_text, period: null },
        { key, value: winnerVal, unit: a.unit, quote: a.evidence_text, period: null }).comparable)
      .map((c) => ({ value: String(c.after ?? c.before ?? ''), source: c.source }))
      .filter((c) => c.value.trim().length > 0)
      .slice(0, 3);
    // The same figure read again from another document of the same period is
    // corroboration — kept, never a change and never a conflict.
    const winNum = scaledNumber(winnerVal);
    const corroboration = a ? live
      .filter((e) => e !== a && e.variable === key && e.value_type === 'ACTUAL' && e.source !== a.source)
      .filter((e) => { const x = String(e.after ?? e.before ?? ''); return winNum != null && scaledNumber(x) === winNum && sameUnit(x, winnerVal, e.unit, a.unit); })
      .map((e) => ({ value: String(e.after ?? e.before ?? ''), source: e.source }))
      .filter((c, i, arr) => arr.findIndex((y) => y.source === c.source) === i)
      .slice(0, 3) : [];
    // ── ABOVE NAMEPLATE IS POSSIBLE, AND WORTH A SECOND LOOK.       (zzz760)
    //
    // VAML carried "Capacity utilisation 120%". The 0–130% band stays as it is
    // — plants genuinely run above nameplate on extra shifts, and narrowing the
    // band would throw away GIPCL's real 19.89% CUF along with the bad ones. But
    // a figure over 100% is either a debottlenecked plant or a mis-read number,
    // and those are worth telling apart, so the row says which question to ask
    // instead of printing 120% as though it were ordinary.
    const utPct = key === 'utilisation' && a
      ? Number((`${a.after || a.before || ''}`.match(/-?\d+(?:\.\d+)?\s*%/) || [''])[0].replace('%', ''))
      : NaN;
    const overNameplate = Number.isFinite(utPct) && utPct > 100
      ? ` ⓘ Above 100% of nameplate. That is real when a plant runs extra shifts or has been de-bottlenecked, `
        + 'and it is also what a mis-read number looks like — check which before treating it as headroom exhausted.'
      : '';
    const conflictNote = conflicts.length
      ? ` ⚠ SOURCES DISAGREE — ${conflicts.map((c) => `${c.value} (${c.source})`).join('; ')}. `
        + 'The written document is shown; the other reading is kept here rather than discarded.'
      : '';
    // ── A VALUE THAT IS NOT ABOUT THIS VARIABLE IS NOT THIS VARIABLE'S
    //    VALUE.                                                     (zzz755)
    //
    // zzz754 stopped a wrong-unit fact from CONFIRMING, but still printed
    // it: the board showed "◐ Installed capacity ₹10,161 crores" on
    // REDINGTON and "◐ Capacity utilisation 4 to 6 months" on JINDRILL.
    // Marking a wrong number as unjudged does not make it less wrong. The
    // mis-filed actual is dropped here; the variable falls through to its
    // forward statement if it has one, and otherwise renders as an absence.
    // The event itself stays in the ledger for audit.
    const aOk = a && (((a as any).commentary && key !== 'utilisation' && key !== 'capex') || judgeEventQuality(a) !== 'unit_mismatch') ? a : null;
    if (aOk) {
      const a0 = aOk;
      // A pair that states one number twice is a LEVEL. (zzz764)
      // "Unchanged at ₹1,200 Cr" is a comparison the company made: the two
      // sides are the same figure and the row says FLAT, not a bare level.
      const flatStated = !!a0.flat_stated && a0.value_type === 'ACTUAL';
      // Two sides dated to ONE period are one figure stated twice (ENTERO
      // "Q4 FY26: 59 days → 59 days by Q4 FY26"), never a move. (zzz770)
      const a = flatStated ? { ...a0, before: a0.after }
        : restatedPair(a0.before, a0.after) || samePeriodPair(a0.before, a0.after) ? { ...a0, before: null } : a0;
      // Period labels do not take part in the arithmetic. (zzz772)
      const delta = flatStated ? 'FLAT' : deltaOf(a.before ? (stripPeriodTokens(a.before) || a.before) : a.before, a.after);
      // Re-judged on load, so ledgers written before a rule existed obey it.
      const quality = (a as any).commentary ? 'sentence' as const : judgeEventQuality(a);
      const dir = verifiedDirection(a);
      const chart = quality === 'chart' || quality === 'unit_mismatch';
      // Only a FILED figure from a real sentence with a verifiable move may
      // confirm or contradict. A management claim ("3x capacity", "at
      // maximum level") is shown as what it is; a chart axis and a
      // wrong-unit value are shown as claims; a bare level is 'stated'.
      // ── WORDS ARE NOT A COMPARISON FOR EVERY VARIABLE.           (zzz764)
      //
      // "Running at 120%" (VAML) and "approaching 50%" (MARKSANS) printed ▲
      // because the sentence contained an up-word; neither states an earlier
      // figure. A fill rate, a one-off and a working-capital AMOUNT are
      // judged only on two stated figures. Working capital in DAYS keeps
      // the inverse reading below.
      // Working capital in DAYS joins them (zzz772): UNIMECH "stood at
      // approximately 130 days, slightly inching up" printed ✕ with no
      // earlier figure anywhere. A stated move verb still counts, as for
      // utilisation; a drift word with no prior figure is a level.
      const needsTwoFigures = key === 'utilisation' || key === 'one_offs' || key === 'working_capital';
      // A stated move verb ("improved to 80%", "fell to 60%") is still a
      // comparison the company made; a state word ("running at", "at full",
      // "approaching") is not.
      const namesMove = /\b(improv|increas|rose|risen|grew|grown|up from|went up|declin|decreas|fell|fallen|dropped|down from|went down|reduc)/i.test(a.evidence_text);
      // ── AN ORDER BOOK IS WORK IN HAND, NOT REVENUE POTENTIAL.      (zzz765)
      // HAPPYFORGE's "order book representing around Rs.950 crores of peak
      // incremental annual revenue potential" is a pipeline estimate. It is
      // shown, labelled as what it is, and never judged as a backlog.
      const potential = (key === 'order_book' || key === 'order_intake')
        && /revenue potential|peak (?:incremental )?(?:annual )?revenue|incremental (?:annual )?(?:revenue|business)|potential revenue/i.test(a.evidence_text);
      const isFact = a.value_type === 'ACTUAL' && !chart && !potential;
      const mayJudge = isFact && key !== 'one_offs'
        && (flatStated || !needsTwoFigures || (!!a.before && !!delta) || ((key === 'utilisation' || (key === 'working_capital' && inverseByUnit(key, `${a.unit || ''} ${a.before || ''} ${a.after || ''} ${a.evidence_text}`))) && namesMove));
      const inverted = NEGATIVE_VARS.has(key) || inverseByUnit(key, `${a.unit || ''} ${a.before || ''} ${a.after || ''} ${a.evidence_text}`);
      // "No stated delays" / "projects on schedule" read as an execution
      // delay ▼. A denial on a more-is-worse variable is checked and flat. (zzz767)
      const denied = NEGATIVE_VARS.has(key) && (isDenial(a.after) || isDenial(a.evidence_text));
      const amountOnly = key === 'capex' || key === 'capex_status' || (key === 'working_capital' && !inverted);
      // "The Pune facility is under commissioning" is not commissioned. (zzz768)
      const notYet = key === 'commissioning' && /\b(under commissioning|to be commissioned|yet to (be )?commission|will be commissioned|expected to (be )?commission)/i.test(`${a.after || ''} ${a.evidence_text}`);
      const verdict0: VarVerdict = denied ? 'flat'
        : notYet ? 'stated'
        : amountOnly && mayJudge && !flatStated && (dir === 'up' || dir === 'down') ? 'stated'
        : !mayJudge ? 'stated'
        : flatStated ? 'flat'
        : dir === 'up' ? (inverted ? 'deteriorating' : 'improving')
          : dir === 'down' ? (inverted ? 'improving' : 'deteriorating')
            : dir === 'flat' ? 'flat' : 'stated';
      // ── SUSPICIOUS IS NOT BAD; IT IS UNREAD.                        (zzz770)
      // DEEPAKNTR "170-odd percent" utilisation with no stated denominator is
      // a validation question, counted neither confirmed nor contradicted.
      const validation = validateReading(key, a.after, a.evidence_text, a.unit);
      const unclear = validation.state === 'UNCLEAR';
      const verdict: VarVerdict = unclear ? 'stated' : verdict0;
      const statement: StructuralVar['statement'] = isFact ? 'ACTUAL' : potential ? 'MANAGEMENT_STATEMENT' : a.value_type === 'MANAGEMENT_CLAIM' ? 'MANAGEMENT_STATEMENT' : a.value_type === 'GUIDANCE' ? 'GUIDANCE' : a.value_type === 'TARGET' ? 'TARGET' : 'MANAGEMENT_STATEMENT';
      out.push({
        key, label,
        kind: isFact ? 'fact' : 'claim',
        // "Q1 FY26: 54.80 mmscm" prints as "54.80 mmscm (Q1 FY26)". (zzz772)
        before: levelText(movePeriodOut(a.before)), after: levelText(a.after), delta, verdict,
        evidence: (quality === 'unit_mismatch' ? 'Value does not fit this variable (wrong unit or no such statement) — shown as a claim only: '
          : chart ? 'Read from a chart, figures unlabelled — verify on the slide: '
            : a.value_type !== 'ACTUAL' ? `Management ${a.value_type === 'MANAGEMENT_CLAIM' ? 'claim' : a.value_type.toLowerCase()}, not a reported figure: `
              : verdict === 'stated' ? 'Level only — no earlier figure in the text to compare against: ' : '')
          + `${a.evidence_text.slice(0, 220)}${a.evidence_text.length > 220 ? '…' : ''}`
          + ` — ${a.source}${a.period ? `, ${a.period}` : ''}`
          + (f ? ` · ${f.value_type === 'GUIDANCE' ? 'Guidance' : 'Target'} ${f.after}${f.period ? ` (${f.period})` : ''}` : '')
          + (validation.metric_definition ? ` ⓘ Definition stated by the source: "${validation.metric_definition}".` : unclear ? `${overNameplate} ⓘ ${validation.reason}.` : overNameplate) + conflictNote,
        conflict: conflicts.length ? conflicts : null,
        corroboration: corroboration.length ? corroboration : null,
        source: 'filing',
        statement,
        fact_type: factTypeOf({ statement, key, value: a.after, text: a.evidence_text, source: a.source, retyped: a.retyped_because }),
        validation,
        lineage: lineageOf({ ...(a as any), period: period || a.period || null }, docs),
        normalized: normalizeValue(a.after ?? a.before, a.unit),
        scope: scopeOf(a.evidence_text, a.after ?? a.before),
        // The plan rides beside the actual only when it measures the same
        // thing: AARTIPHARM's "~450 KL" installed and "9,500 metric tons"
        // planned are two products, and a ₹210 Cr project against a ₹149 Cr
        // block is two projects. The gap is printed only for rates (pp).
        // A plan identical to the actual is the same figure twice (ICIL
        // "60% to 65% · plan 60 to 65%").
        // ── A PLAN MEASURED DIFFERENTLY IS A DIFFERENT PLAN.           (zzz769)
        // TI "Volume: 3.4 million cases · target mid-double digit" set a
        // count beside a growth rate. Both sides carry figures in the same
        // unit, or neither carries a figure. And "the same figure" compares
        // the leading figures: MENONBE "6.74 crore · plan 6.74 crore fully
        // deployed in FY26" differed only in the year.
        plan: f && judgeEventQuality(f) !== 'unit_mismatch' && String(f.after ?? '').trim()
          && !samePlanFigure(a.after, f.after)
          && hasFigure(a.after) === hasFigure(f.after)
          // Same measure AND same scope (zzz770): "80% plus" is a percent like
          // "74%"; a Plant B target never rides beside a Plant A actual.
          && (!hasFigure(a.after) || comparability(
            { key, value: String(a.after ?? ''), unit: a.unit, quote: a.evidence_text, period: null },
            { key, value: String(f.after), unit: f.unit, quote: f.evidence_text, period: null }).comparable) ? {
          value: String(f.after), type: f.value_type === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
          quote: f.evidence_text.slice(0, 240), source: f.source,
          gap: isFact && /%/.test(String(a.after ?? '')) && /%/.test(String(f.after)) ? gapToTarget(a.after, f.after)
            : isFact && inverseByUnit(key, `${a.unit || ''} ${a.after || ''}`) ? daysGap(a.after, f.after) : null,
        } : null,
        asOf: period || a.period || null,
        sourceLabel: a.source || null,
        quote: a.evidence_text.slice(0, 300),
        retyped: a.retyped_because || null,
        unjudged: potential ? 'described as revenue potential over the next years, not an executable order book'
          : unclear ? validation.reason
            : (a as any).commentary ? 'management commentary — an expectation with no figure, not a value and not a confirmation' : null,
      });
    } else if (f && judgeEventQuality(f) !== 'unit_mismatch') {
      // ── A TARGET IS STILL SUBJECT TO THE UNIT RULES.             (zzz761)
      //
      // zzz755 dropped mis-filed ACTUALS and left this branch unguarded, so
      // the same junk walked back in through the forward door: JINDRILL
      // printed "◐ Capacity utilisation 4 to 6 months (guidance)" — a
      // refurbishment period — and VIJAYA "◐ Capacity utilisation breakeven
      // within 1 year (target)". Neither is a fill rate. A management target
      // for a variable has to be a plausible value OF that variable before it
      // is allowed to stand in for one.
      // A forward statement with no actual behind it is a claim, shown as
      // such — and the BOARD has to say so, not just the tooltip. AARTIPHARM
      // printed "◐ Capacity utilisation 80% plus" from a TARGET, which reads
      // as this quarter's fill rate. The type travels with the value. (zzz755)
      const tag = f.value_type === 'GUIDANCE' ? 'guidance' : 'target';
      const fPotential = (key === 'order_book' || key === 'order_intake')
        && /revenue potential|peak (?:incremental )?(?:annual )?revenue|incremental (?:annual )?(?:revenue|business)|potential revenue/i.test(f.evidence_text);
      out.push({
        key, label, kind: 'claim',
        before: null, after: `${f.after} (${tag})`, delta: null, verdict: 'stated',
        evidence: `${f.value_type === 'GUIDANCE' ? 'Guidance' : 'Management target'}: ${f.after}${f.period ? ` by ${f.period}` : ''}. `
          + `"${f.evidence_text.slice(0, 200)}${f.evidence_text.length > 200 ? '…' : ''}" — ${f.source}`,
        source: 'filing',
        statement: f.value_type === 'GUIDANCE' ? 'GUIDANCE' : 'TARGET',
        unjudged: fPotential ? 'described as revenue potential over the next years, not an executable order book' : null,
        asOf: period || f.period || null,
        sourceLabel: f.source || null,
        quote: f.evidence_text.slice(0, 300),
        retyped: (f as any).retyped_because || null,
        fact_type: f.value_type === 'GUIDANCE' ? 'MANAGEMENT_GUIDANCE' : 'MANAGEMENT_TARGET',
        validation: null,
        lineage: lineageOf({ ...(f as any), period: period || f.period || null }, docs),
        normalized: normalizeValue(f.after, f.unit),
        scope: scopeOf(f.evidence_text, f.after),
      });
    }
  }
  // ── HISTORICAL CONTEXT.                                          (zzz765)
  //
  // ETHOSLTD's Q1 FY27 card printed "Working capital INR440 Cr (31 Mar 2024)
  // → INR593 Cr (31 Mar 2025)" as if it were this quarter's move. A figure
  // dated before the reporting period is kept — it is real — but it is
  // context: attached to the variable's row when there is one, or shown on a
  // row of its own that is never judged.
  for (const h of historical) {
    if (judgeEventQuality(h) === 'unit_mismatch') continue;
    // One period stated twice is one figure (ENTERO "Q4 FY26: 59 days → 59 days by Q4 FY26"). (zzz770)
    const hBefore = restatedPair(h.before, h.after) || samePeriodPair(h.before, h.after) ? null : h.before;
    const ctx = { value: [hBefore, h.after].filter(Boolean).join(' → '), asOf: String(h.historical_as_of), quote: h.evidence_text.slice(0, 240), source: h.source };
    const row = out.find((v) => v.key === h.variable);
    if (row) { row.context = [...(row.context || []), ctx]; continue; }
    out.push({
      key: h.variable, label: VAR_LABEL[h.variable] || h.variable, kind: 'fact',
      before: levelText(hBefore), after: levelText(h.after), delta: null, verdict: 'stated',
      evidence: `Historical context (${h.historical_as_of}), not ${period || 'this period'}'s evidence: ${h.evidence_text.slice(0, 220)} — ${h.source}`,
      source: 'filing', statement: 'HISTORICAL', asOf: String(h.historical_as_of),
      sourceLabel: h.source, quote: h.evidence_text.slice(0, 300),
      unjudged: `historical context — dated ${h.historical_as_of}, before ${period || 'this reporting period'}`,
      context: null,
      fact_type: 'HISTORICAL',
      lineage: lineageOf({ ...(h as any), period: String(h.historical_as_of) }, docs),
      normalized: normalizeValue(h.after, h.unit),
      scope: scopeOf(h.evidence_text, h.after),
    });
  }
  // ── INSTALLED vs ADDED: LIKE FOR LIKE, OR NOT AT ALL.              (zzz773)
  // LLOYDSENT "Installed capacity 55 MT" beside "Capacity added 150,000 MTPA";
  // SOTL "2,061 kWp" of rooftop power beside "~3,000 MTPA" of ester output.
  // Where the two do not share a measure and a scope, neither is read as a
  // progression of the other and neither may confirm the capacity thesis.
  const inst = out.find((v) => v.key === 'capacity' && v.statement !== 'HISTORICAL' && isCapacityFigure(v.after));
  const add = out.find((v) => v.key === 'capacity_addition' && v.statement !== 'HISTORICAL' && isCapacityFigure(v.after));
  if (inst && add) {
    const why = capacityMismatch({ value: String(inst.after), quote: inst.quote }, { value: String(add.after), quote: add.quote });
    if (why) {
      for (const [row, other] of [[inst, add], [add, inst]] as const) {
        row.evidence = `${row.evidence} ⓘ ${why} (${other.key === 'capacity' ? 'installed' : 'added'}: ${other.after}).`;
        // A row whose own before → after is one measure and one scope keeps
        // its move (AARTIPHARM 5,000 → 9,600+ MTPA of one product); only a
        // bare level, read against the other figure, is not judgeable.
        const ownMove = !!row.before && !!row.after && isCapacityFigure(row.before)
          && !capacityMismatch({ value: String(row.before), quote: row.quote }, { value: String(row.after), quote: row.quote });
        if (ownMove) continue;
        if (row.verdict === 'improving' || row.verdict === 'deteriorating' || row.verdict === 'flat') row.verdict = 'stated';
        if (row.verdict !== 'unknown') row.unjudged = row.unjudged || why;
      }
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE LONGITUDINAL UPGRADE.                                         (zzz758)
//
// A variable extracted from ONE document can only ever be a level: the filing
// says utilisation is 80% and the row says 80%, verdict `stated`, "no
// comparison basis". That was honest and it was also the ceiling — the board
// could never say 72% → 80% because nothing handed it last quarter's figure.
//
// `buildComparisons(ledger)` walks every period that has ever been read and
// finds the most recent EARLIER figure for the same variable. Where it finds
// one, the basis exists, and a level becomes a direction. Where it does not,
// the row is left exactly as it was — a level, marked as a level. That
// asymmetry is the whole guard against §75: a previous value appears on a
// card only when an earlier period record actually holds it.
// ═══════════════════════════════════════════════════════════════════════════

// ── AN INSTALLED CAPACITY IS NOT A CAPACITY ADDITION.              (zzz759)
//
// MOREPEN showed "Installed capacity 200 KLD" and "Capacity added 200 KLD" on
// the same card, from the same sentence. One sentence, filed twice under two
// names — and the second one is scored `improving` by default, so a level the
// company merely restated was counted as growth. Where the two carry the same
// value, the ADDITION is the one that goes: "capacity is 200 KLD" is the far
// more likely reading of a sentence that produced both, and a wrongly-claimed
// expansion is the more expensive of the two errors.
function dropRestatedCapacityAddition(vars: StructuralVar[]): StructuralVar[] {
  const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const installed = vars.find((v) => v.key === 'capacity');
  if (!installed) return vars;
  const inst = norm(installed.after || installed.before);
  if (!inst) return vars;
  return vars.filter((v) => !(v.key === 'capacity_addition' && norm(v.after || v.before) === inst));
}

/** Magnitude below which a move is noise rather than a direction. */
function movedEnough(c: MetricComparison): boolean {
  const s = c.change || '';
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return false;
  const v = Math.abs(Number(m[0]));
  return /pp$/i.test(s) ? v >= 1 : v >= 2;
}

export function applyComparisons(
  vars: StructuralVar[],
  comparisons: Partial<Record<VarKey, MetricComparison>> | null | undefined,
): StructuralVar[] {
  if (!comparisons) return vars;
  return vars.map((v) => {
    const c0 = comparisons[v.key];
    if (!c0) return v;
    // ── ONE ROW, ONE FIGURE.                                          (zzz765)
    //
    // AARTIPHARM's row printed "6,000 → 9,500 metric tons" while its
    // comparison carried "440 kL". A comparison whose CURRENT figure is not
    // the row's figure describes a different reading; its history is kept
    // only as a history note (no previous figure is borrowed from it).
    const digits = (x: string | null | undefined) => String(x ?? '').replace(/[^\d.]/g, '');
    const same = !c0.current || !v.after || digits(c0.current.raw) === digits(v.after)
      || String(v.after).toLowerCase().includes(String(c0.current.raw).toLowerCase());
    const c: MetricComparison = same ? c0 : { ...c0, previous: null, previous_period: null, change: null, change_relative: null, change_type: 'NEW', basis: 'NONE' };
    if (v.statement === 'HISTORICAL') return v;
    // A claim is never turned into a measured direction by a comparison: a
    // target restated is management repeating itself, not a business moving.
    // A value that carries its own hedge ("maybe INR30 crores") is a
    // management estimate whatever path it arrived by. (zzz769)
    const isFact = v.kind !== 'claim' && v.source === 'filing' && !hedgedAround(null, v.after)
      && v.validation?.state !== 'UNCLEAR';
    const hasBasis = c.basis !== 'NONE'
      && (c.change_type === 'INCREASED' || c.change_type === 'DECREASED' || c.change_type === 'UNCHANGED');
    if (!isFact || !hasBasis || !c.previous) {
      return { ...v, comparison: c };
    }
    // Days of working capital FALLING is the good direction — the same
    // inverse reading the event path applies. NEULANDLAB "137 → 84 days"
    // printed ▼ and CYIENTDLM "145 → 161 days" ▲ when the ledger comparison
    // took over the row. (zzz765)
    const inverted = NEGATIVE_VARS.has(v.key)
      || inverseByUnit(v.key, `${c.current?.raw || ''} ${c.previous?.raw || ''} ${v.after || ''} ${v.before || ''}`);
    const moved = movedEnough(c);
    // A capex budget or a working-capital AMOUNT moving has no good direction
    // on its own: WENDT's working capital ₹52 → ₹65 Cr printed ▲ improving,
    // NEULANDLAB's capex plan ₹1,460 → ₹870 Cr ▼. Shown with its change,
    // not judged. Working-capital DAYS keep the inverse reading. (zzz768)
    const amountOnly = v.key === 'capex' || v.key === 'capex_status' || (v.key === 'working_capital' && !inverted);
    const verdict: VarVerdict = amountOnly && moved && c.direction !== 'flat' ? 'stated'
      : !moved || c.direction === 'flat'
      ? 'flat'
      : c.direction === 'up' ? (inverted ? 'deteriorating' : 'improving')
        : c.direction === 'down' ? (inverted ? 'improving' : 'deteriorating')
          : v.verdict;
    return {
      ...v,
      comparison: c,
      // The BEFORE now comes from a period record, so it is printed — and the
      // period it came from is printed with it, because "previous" without a
      // date is the kind of number that quietly becomes a guess.
      before: v.before ?? c.previous.raw,
      delta: c.change ?? v.delta,
      verdict,
      kind: 'fact',
      evidence: `${c.previous.raw}${c.previous_period ? ` (${c.previous_period})` : ''} → ${c.current?.raw ?? v.after ?? ''}${c.current_period ? ` (${c.current_period})` : ''}`
        + `${c.change ? ` · ${c.change}` : ''}${c.change_relative ? ` (${c.change_relative})` : ''}`
        + ` · ${BASIS_LABEL[c.basis]}. `
        + (c.cause
          ? `Stated cause: ${c.cause.text} — ${c.cause.persistence === 'STRUCTURAL' ? 'STRUCTURAL' : c.cause.persistence === 'TEMPORARY' ? 'TEMPORARY' : 'PERSISTENCE UNCLASSIFIED'}. ${c.cause.persistence_because} `
          : 'CAUSE: not disclosed — the document states the change and gives no reason for it. ')
        + v.evidence,
    };
  });
}

export function extractVariables(
  graded: any | null,
  summary: any | null,
  comparisons?: Partial<Record<VarKey, MetricComparison>> | null,
  opts?: { period?: string | null; documents?: LedgerDocument[] | null;
    /** zzz771: the company ledger, so every quantitative row carries its
     *  time-series reading (current → previous → Δ) from the persisted
     *  per-period snapshots. Without it rows are levels, as before. */
    ledger?: CompanyLedger | null },
): StructuralVar[] {
  const out: StructuralVar[] = [];
  // Typed events first. Any key they cover is not re-pushed from the
  // summary's loose fields below — one variable, one row, and the row with
  // the verbatim evidence wins.
  const fromEvents = varsFromEvents(summary?.events, opts?.period ?? null, opts?.documents ?? null);
  const covered = new Set<VarKey>(fromEvents.map((v) => v.key));
  out.push(...fromEvents);

  // ── THE PRIOR THE SUMMARY ALREADY HELD.                          (zzz761)
  //
  // The events stage wins every key it covers, and that is right — the event
  // carries the verbatim sentence. But the summary's `utilisation` block has
  // its own `prior` field, and when the event captured only a level the prior
  // was being discarded along with the rest of the summary row. So a filing
  // that plainly said "utilisation rose from 72% to 80%" could still render as
  // a bare 80%. This recovers ONLY the before — the current value, verdict and
  // evidence stay the event's — and only when the event has no before of its
  // own. Nothing is invented: the figure comes from the same read document.
  const utBlock = summary?.utilisation || {};
  if (said(utBlock.prior)) {
    const row = out.find((v) => v.key === 'utilisation');
    if (row && !row.before && row.after && row.kind !== 'claim' && !restatedPair(String(utBlock.prior), row.after)) {
      const b = String(utBlock.prior).trim();
      const d = deltaOf(b, row.after);
      const bn = numIn(b), an = numIn(row.after);
      const moved = bn != null && an != null ? an - bn : null;
      row.before = b;
      row.delta = row.delta || d;
      if (moved != null) {
        row.verdict = moved >= 2 ? 'improving' : moved > -2 ? 'flat' : 'deteriorating';
        row.evidence = `${b} → ${row.after}${d ? ` · ${d}` : ''} (both stated in the documents read). ${row.evidence}`;
      }
    }
  }
  const push = (v: StructuralVar) => {
    if (covered.has(v.key)) {
      // ── A LEVEL FROM THE FILING MUST NOT BEAT A BRIDGE FROM THE
      //    GRADER.                                                  (zzz758)
      //
      // AZAD's concall says "operating margin came in at 18.4%" — a level,
      // no prior, verdict `stated`. The graded row holds 15.9% AND 18.4%,
      // which is the same figure WITH the comparison the document omitted.
      // The event row won simply because events are read first, so the card
      // printed CONFIRMATION REQUIRED — "no comparison basis" — with the
      // basis sitting one field away. Where the filing stated only a level
      // and the grader has both sides, the grader's row replaces it and the
      // ledger comparison, if any, is carried across.
      const i = out.findIndex((x) => x.key === v.key);
      const cur = i >= 0 ? out[i] : null;
      const levelOnly = !!cur && GRADER_AVAILABLE.has(v.key)
        && cur.verdict === 'stated' && !cur.before && !cur.comparison?.previous;
      const hasBridge = v.verdict !== 'unknown' && !!(v.before || v.delta);
      if (levelOnly && hasBridge) out[i] = { ...v, comparison: cur!.comparison ?? null };
      return;
    }
    // ── THE SAME UNIT RULES THE EVENTS PATH ANSWERS TO.            (zzz762)
    //
    // A summary row is a model's reading of the same document, and it can be
    // mis-filed in exactly the same ways: a growth rate under utilisation
    // (REDINGTON "−14%", DEEPAKNTR ">175%"), a stock day-count under it (SFL
    // "30 days inventory"), a bare percentage as an answer to "is the capex
    // earning yet" (RATEGAIN "78.8%"). The row's own evidence line names the
    // variable, so the sentence tests pass; only a value that cannot BE that
    // variable is dropped, and the card then shows the hollow circle, which is
    // the truth: nothing usable was read for it.
    // A commentary row needs words to show; "Management commentary: “”"
    // (UNIVCABLES) is an empty row. Utilisation is never waved through as
    // commentary: its value must be a fill rate. (zzz772)
    const commentary = v.source === 'filing' && v.key !== 'utilisation' && v.key !== 'capex' && !!String(v.after || '').trim()
      && isCommentaryOnly(v.key, v.after, `${v.after || ''} ${v.evidence || ''}`) && !v.before && !hasQuantity(v.delta);
    if (v.source === 'filing' && !commentary && !valueFitsVariable({
      variable: v.key, before: v.before, after: v.after, unit: null, evidence_text: v.evidence,
    })) return;
    // ── AN EXPECTATION IN A VALUE SLOT IS COMMENTARY.              (zzz770)
    // The summary's order-book "growth" slot can hold "should go up in line
    // with supplies" (EMCURE). It is shown as what it is — management
    // commentary — and never as an order-book value or a confirmation.
    if (commentary) {
      v = { ...v, kind: 'claim', statement: 'MANAGEMENT_STATEMENT', fact_type: 'MANAGEMENT_COMMENTARY', verdict: 'stated', delta: null,
        unjudged: 'management commentary — an expectation with no figure, not a value and not a confirmation' };
    }
    // Utilisation above 100% with no stated denominator is a validation
    // question on this path too (DEEPAKNTR). (zzz770)
    if (v.source === 'filing' && !v.validation) {
      const val = validateReading(v.key, v.after, v.evidence);
      if (val.state === 'UNCLEAR') v = { ...v, validation: val, verdict: v.verdict === 'unknown' ? 'unknown' : 'stated', unjudged: val.reason };
      else if (val.metric_definition) v = { ...v, validation: val };
    }
    // A value with no comparison basis is DISCLOSED. It is not absent.
    const hasValue = !!(String(v.after || '').trim() || String(v.before || '').trim() || String(v.delta || '').trim());
    if (v.verdict === 'unknown' && hasValue) v = { ...v, verdict: 'stated' };
    // A STATED chip with nothing in it is worse than a hollow circle: it
    // claims a disclosure and shows none. TI printed exactly that. (zzz757)
    if (v.verdict === 'stated' && !hasValue) v = { ...v, verdict: 'unknown' };
    out.push(v);
  };

  // ── GRADER FACTS ────────────────────────────────────────────────────────
  const salesY = n(graded?.sales_yoy_pct);
  // PAT growth first, EPS second — the same order the A/B/F/G classifier
  // uses, so the board and the pattern never quote two different growth
  // rates for one quarter. LUMAXTECH showed "+109%" (EPS) against a PAT
  // growth of 83%. (zzz763)
  const patGrowth = n(graded?.net_profit_yoy_pct);
  const epsY = patGrowth ?? n(graded?.eps_yoy_pct);
  const epsOnly = patGrowth == null && epsY != null;
  const patCurr = n(graded?.pat_curr_cr) ?? n(graded?.net_income_curr_musd);
  const patPrev = n(graded?.pat_prev_cr) ?? n(graded?.net_income_prev_musd);
  const opmNow = n(graded?.opm_pct);
  // ── A GROWTH RATE OFF A LOSS IS NOT A GROWTH RATE.               (zzz763)
  //
  // EXICOM's screener row: operating margin −6.6%, "net profit −3.4% YoY",
  // no PAT figures. A company losing money at the operating line is almost
  // certainly losing money at the bottom line, and a percentage change
  // between two negative numbers says nothing about direction. That row
  // drove THESIS WEAKENING on "earnings growth −3.4%". Where either period's
  // profit is known to be negative — or unknown while the operating margin is
  // negative — the rate is shown as unread, with the reason.
  const lossBase = (patCurr != null && patCurr < 0) || (patPrev != null && patPrev < 0)
    || (patCurr == null && patPrev == null && opmNow != null && opmNow < 0);
  const opmChange = n(graded?.opm_change_pp) ?? n(graded?.opm_delta_pp);
  // The screener exports carry no YoY margin bridge — only this quarter's OPM
  // and last quarter's. That is a SEQUENTIAL change, and it answers a
  // different question from a year-on-year one (it carries seasonality that
  // YoY cancels). It is used where nothing better exists, and the evidence
  // line says "sequential" so the reader can discount it accordingly. (zzz716)
  const opmChangeQoq = n(graded?.opm_change_pp_qoq);
  const opm = n(graded?.opm_pct);
  // ── THE MARGIN BRIDGE THAT WAS SITTING THERE UNREAD.            (zzz719)
  //
  // The India bench carries `opm_pct` AND `opm_prev_pct` — a genuine
  // year-on-year margin change, two fields apart. This extractor only looked
  // for `opm_change_pp`, which the bench does not have, so EVERY graded
  // holding reported "○ Operating margin — not disclosed" while the number
  // needed to compute it was in the same row. Twelve holdings sat at EVIDENCE
  // INCOMPLETE waiting on a filing for a figure already in hand.
  const opmPrev = n(graded?.opm_prev_pct);
  const opmChangeYoy = opmChange ?? (opm != null && opmPrev != null
    ? Math.round((opm - opmPrev) * 10) / 10 : null);
  const sequentialOnly = opmChangeYoy == null && opmChangeQoq != null;
  const cfoToPat = n(graded?.cfo_to_pat_ratio) ?? n(graded?.ocf_to_pat_ratio);

  if (salesY != null) {
    push({
      key: 'revenue_growth', label: VAR_LABEL.revenue_growth,
      before: null, after: pct(salesY), delta: pct(salesY),
      // A threshold is a judgement about the NUMBER, not about the future, so
      // it belongs here. The cut-offs are the ones the A test already uses, so
      // the page and the classifier can never disagree about the same quarter.
      verdict: salesY >= 15 ? 'improving' : salesY >= 0 ? 'flat' : 'deteriorating',
      evidence: `Revenue ${pct(salesY)} YoY, from the filed statements.`,
      source: 'grader',
    });
  }
  if (epsY != null && lossBase) {
    push({
      key: 'earnings_growth', label: VAR_LABEL.earnings_growth,
      before: patPrev != null ? `${patPrev} Cr` : null, after: patCurr != null ? `${patCurr} Cr` : `${pct(epsY)} (loss base)`, delta: null,
      verdict: 'unknown',
      unjudged: 'a growth rate on a loss base has no direction',
      evidence: `Reported as ${pct(epsY)} YoY, but ${patCurr != null && patCurr < 0 ? 'the latest quarter is a loss' : patPrev != null && patPrev < 0 ? 'the base quarter was a loss' : `the operating margin is ${opmNow?.toFixed(1)}%, so profit is almost certainly negative`}. A growth rate between negative numbers has no direction, so it is not read either way.`,
      source: 'grader',
    });
  } else if (epsY != null) {
    push({
      key: 'earnings_growth', label: VAR_LABEL.earnings_growth,
      before: patPrev != null ? `${patPrev} Cr` : null, after: patCurr != null ? `${patCurr} Cr` : pct(epsY), delta: pct(epsY),
      verdict: epsY >= 20 ? 'improving' : epsY >= 0 ? 'flat' : 'deteriorating',
      evidence: `${epsOnly ? 'EPS' : 'Profit after tax'} ${pct(epsY)} YoY, from the filed statements${epsOnly ? ' (PAT growth not on the row; EPS used)' : ''}.`,
      source: 'grader',
    });
  }

  // OPERATING LEVERAGE is the one computed variable here, and it is computed
  // from two filed numbers with no assumption in between: profit growing
  // faster than revenue IS operating leverage, arithmetically. The guard is
  // the same one the classifier uses — a ratio off a trivial revenue base is
  // noise, so below 1% growth the variable stays unknown rather than large.
  if (salesY != null && epsY != null && !lossBase) {
    if (salesY >= 1) {
      const r = epsY / salesY;
      push({
        key: 'operating_leverage', label: VAR_LABEL.operating_leverage,
        before: `revenue ${pct(salesY)}`, after: `earnings ${pct(epsY)}`,
        delta: `${(Math.round(r * 10) / 10).toFixed(1)}×`,
        verdict: r >= 1.5 ? 'improving' : r >= 1 ? 'flat' : 'deteriorating',
        evidence: r >= 1.5
          ? `Earnings grew ${r.toFixed(1)}× revenue — fixed costs are being absorbed.`
          : r >= 1
            ? `Earnings grew ${r.toFixed(1)}× revenue — profit is keeping pace, not pulling ahead.`
            : `Earnings grew slower than revenue (${r.toFixed(1)}×) — leverage is working against the P&L.`,
        source: 'grader',
      });
    } else {
      push({
        key: 'operating_leverage', label: VAR_LABEL.operating_leverage,
        before: null, after: null, delta: null, verdict: 'unknown',
        evidence: `Revenue moved ${pct(salesY)} — too small a base for a leverage ratio to mean anything.`,
        source: 'grader',
      });
    }
  }

  // ── MARGIN. The AI summary's bridge is preferred because it carries the
  //    REASON, which is the part that decides whether the change is structural.
  const mb = summary?.margin_bridge;
  // ── THE DELTA AND THE VERDICT MUST COME FROM THE SAME NUMBER.   (zzz755)
  //
  // AETHER printed "▼ Operating margin +1pp" — a red arrow beside a
  // positive number — because the DELTA was taken from the filing's
  // margin bridge while the VERDICT was computed from the grader's
  // year-on-year figure. TBZ printed the whole sentence "FY26: +4.46pp to
  // 11.18% (presentation); Q4: +6.51pp to 13.45%" in the delta slot, and
  // CUPID printed "+?pp" — a literal question mark the model wrote. A
  // bridge value is used only when it is a single clean pp figure.
  const mbRaw = said(mb?.opm_change_pp) ? String(mb.opm_change_pp).trim() : null;
  const mbDeltaRaw = mbRaw && /^[+-]?\d+(?:\.\d+)?\s*(pp|bps|bp|%)?$/i.test(mbRaw) ? mbRaw : null;
  // The field is `opm_change_pp`; a bare "-1.43" IS pp and prints as such.
  // ALKYLAMINE printed "Operating margin -1.43" with no unit. (zzz763)
  const mbDelta = mbDeltaRaw && /^[+-]?\d+(?:\.\d+)?$/.test(mbDeltaRaw) ? `${mbDeltaRaw}pp` : mbDeltaRaw;
  const drivers: any[] = Array.isArray(mb?.drivers) ? mb.drivers : [];
  if (mbDelta || opmChangeYoy != null || opmChangeQoq != null || opm != null) {
    // One source decides BOTH. The grader's own year-on-year bridge wins
    // because it is arithmetic on filed statements; the model's bridge is
    // second; the sequential figure is last and is labelled as such.
    // "+1450 bps" is 14.5pp. E2E's margin row read 1,450 pp. (zzz764)
    const bridgePp = mbDelta == null ? null
      : /bps?\b/i.test(mbDelta) ? (pctIn(mbDelta) ?? 0) / 100 : pctIn(mbDelta);
    const dv = opmChangeYoy != null ? opmChangeYoy : (bridgePp ?? opmChangeQoq);
    const dvFromBridge = opmChangeYoy == null && bridgePp != null;
    const structural = drivers.filter((d) => d?.nature === 'structural').length;
    const cyclical = drivers.filter((d) => d?.nature === 'cyclical').length;
    const why = drivers.length
      ? ` Reason: ${drivers.map((d) => `${d?.detail} (${String(d?.nature || '').replace(/_/g, ' ')})`).join('; ')}.`
      : ' No reason disclosed — the change is a number without a mechanism.';
    push({
      key: 'margin', label: VAR_LABEL.margin,
      // The BEFORE is the prior margin where the source states it, never a
      // level minus a delta from a different comparison basis. The DELTA is
      // always populated when one exists: the card shows `delta || after`, so
      // a null delta made the chip print the LEVEL next to a verdict computed
      // from the CHANGE — "✕ Operating margin 10.5%", which reads as though
      // 10.5% itself were the bad news. (zzz719)
      before: opmPrev != null ? `${opmPrev.toFixed(1)}%` : null,
      after: opm != null ? `${opm.toFixed(1)}%` : null,
      delta: dvFromBridge
        ? `${bridgePp! >= 0 ? '+' : ''}${bridgePp!.toFixed(1)}pp`
        : (dv != null ? `${dv >= 0 ? '+' : ''}${dv.toFixed(1)}pp${sequentialOnly ? ' QoQ' : ''}` : null),
      // A sequential move carries seasonality that a year-on-year move
      // cancels; it is shown with its label and NOT counted for or against
      // the thesis. EXICOM's "−6.7pp QoQ" was one of three "deteriorating"
      // core variables behind a WEAKENING call. (zzz763)
      verdict: dv == null ? 'unknown' : sequentialOnly ? 'stated' : dv >= 1 ? 'improving' : dv > -1 ? 'flat' : 'deteriorating',
      unjudged: dv != null && sequentialOnly ? 'only a sequential (QoQ) move is on file, which carries seasonality' : null,
      evidence: `Operating margin ${opm != null ? `${opm.toFixed(1)}%` : ''}`
        + `${opmPrev != null ? ` (was ${opmPrev.toFixed(1)}%)` : ''}`
        + `${dv == null ? ' — change not quantified'
          : ` — ${dv >= 0 ? '+' : ''}${dv.toFixed(1)}pp${sequentialOnly
            ? ' vs last quarter (sequential — no year-on-year bridge available, so seasonality is not cancelled)'
            : ' year on year'}`}.${why}`
        + (structural || cyclical ? ` (${structural} structural, ${cyclical} cyclical.)` : ''),
      source: drivers.length ? 'filing' : 'grader',
    });
  }

  if (cfoToPat != null) {
    // ── A NEGATIVE RATIO DOES NOT MEAN BAD CASH.                  (zzz719)
    //
    // CFO/PAT goes negative when EITHER side is negative, and the two mean
    // opposite things: negative cash against positive profit is the warning,
    // while positive cash against a LOSS is the company funding itself
    // through a bad quarter — often the best news in the filing. The live
    // page showed "✕ Cash conversion −21.30×" on TI and "−7.84×" on E2E and
    // counted both against the thesis without knowing which case it was.
    //
    // This is the same sign-inversion that made the profit-leak flag fire on
    // Raymond at PAT −99%. Where the numerator's sign cannot be established
    // the variable is UNKNOWN, which costs nothing, rather than a guess that
    // could push a holding onto the exit radar for the wrong reason.
    const patSign = n(graded?.pat_curr_cr) ?? n(graded?.net_income_curr_musd)
      ?? n(graded?.profit_after_tax_latest_quarter);
    const negative = cfoToPat < 0;
    const lossMaking = patSign != null && patSign < 0;
    // A POSITIVE ratio can hide two negatives. When profit is unknown and the
    // operating margin is negative, 0.32× may be (−CFO)/(−PAT), and it must
    // not read as "cash falls well below profit". (zzz763)
    const signUnreadable = !negative && patSign == null && opmNow != null && opmNow < 0;
    // The screener's "CFO to PAT" is LAST FULL YEAR's cash flow over last
    // full year's profit — an annual figure sitting on a card about this
    // quarter, and its sign is being checked against the latest QUARTER's
    // profit. Both are said on the row so a −21× is read for what it is.
    // zzz774: EVERY cash-conversion figure on file is annual. The graded rows
    // carry ocf_to_pat_ratio = ocf_annual_cr / pat_annual_cr, and Indian
    // companies file no Q1 cash-flow statement at all. Treating the graded
    // ratio as this quarter's let last FY's cash confirm (AETHER, GAEL) or
    // weaken (SOTL) a Q1 FY27 card. An explicitly quarterly/half-year figure
    // would carry its own period; none does today.
    const annual = !graded?.cfo_period_is_current;
    const basis = annual ? ' (last full year, screener figure — not this quarter\'s)' : '';
    // ── A NEGATIVE RATIO WHOSE DENOMINATOR IS ANOTHER PERIOD.        (zzz770)
    // LLOYDSENGG −3.72×: an annual ratio whose sign was "read" against the
    // latest QUARTER's profit. Neither side of the ratio is known for the
    // ratio's own period, so it is a validation question, not a verdict.
    const cashVal = validateCashConversion(cfoToPat, { profitSign: patSign == null ? null : Math.sign(patSign), ratioPeriodMatchesProfit: !annual });
    const cashUnclear = negative && cashVal.state === 'UNCLEAR' && patSign != null;
    push({
      key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
      before: null, after: `${cfoToPat.toFixed(2)}×${annual ? ' (last FY)' : ''}`, delta: null,
      unjudged: cashUnclear ? cashVal.reason
        : signUnreadable ? 'the sign of the ratio cannot be read with a negative operating margin and no profit figure'
        : lossMaking && !negative ? 'both cash and profit are negative, so the ratio has no meaning'
          : negative && !lossMaking && patSign == null ? 'which side of the ratio is negative is not stated' : null,
      validation: cashUnclear || (negative && patSign == null) ? cashVal
        : signUnreadable ? { state: 'UNCLEAR', flags: ['NEGATIVE_RATIO_SIGN_UNCLEAR'], reason: 'validation required — the sign of the ratio cannot be read', metric_definition: null } : null,
      verdict: cashUnclear ? 'stated'
        : signUnreadable || (lossMaking && !negative) ? 'unknown'
        : !negative
        ? (cfoToPat >= 1 ? 'improving' : cfoToPat >= 0.6 ? 'flat' : 'deteriorating')
        : lossMaking ? 'flat'
          : patSign != null ? 'deteriorating' : 'unknown',
      evidence: cashUnclear
        ? `Cash-to-profit reads ${cfoToPat.toFixed(2)}×${basis}. The ratio is annual and the only profit figure on file is the latest quarter's, so which side is negative — and against what denominator — cannot be read. Validation required; not counted either way.`
        : signUnreadable
        ? `Cash-to-profit reads ${cfoToPat.toFixed(2)}×${basis}, but the operating margin is ${opmNow?.toFixed(1)}% and no profit figure is on the row: a positive ratio here may be negative cash over a negative profit. It is not read either way.`
        : lossMaking && !negative
          ? `Cash-to-profit reads ${cfoToPat.toFixed(2)}×${basis} against a LOSS — both sides negative. The ratio says nothing about cash quality, so it is not counted either way.`
        : !negative
        ? `Operating cash flow is ${cfoToPat.toFixed(2)}× reported profit${basis}.`
        : lossMaking
          ? `Cash-to-profit reads ${cfoToPat.toFixed(2)}× because the ${annual ? 'latest quarter' : 'quarter'} was loss-making. A ratio against a negative base says nothing about cash quality, so it is not counted either way.`
          : patSign != null
            ? `Operating cash flow is negative against a positive profit (${cfoToPat.toFixed(2)}×${basis}) — profit is not becoming cash.${annual ? ' Sign inferred from the latest quarter\'s profit; the ratio itself is annual.' : ''}`
            : `Cash-to-profit reads ${cfoToPat.toFixed(2)}×, and which side is negative is not stated in this row. A negative ratio means the opposite thing depending on that, so it is left unread rather than guessed.`,
      source: 'grader',
    });
  }

  // ── THE HEADLINE THE FILING PRINTS ON PAGE ONE.                  (zzz762)
  //
  // Revenue growth, earnings growth and cash conversion came from the grader
  // row and nowhere else. A holding with no grader row — eighteen of the
  // owner's fifty-three — could have three documents read and thirteen facts
  // extracted and still show "revenue growth ⊘ · cash conversion ⊘ ·
  // EVIDENCE INCOMPLETE", because nothing ever asked the filing for the
  // figures on its first page. The summary schema now carries a `headline`
  // block, copied verbatim from the statement of results, and it fills each
  // of these ONLY where the grader had nothing.
  //
  // What is computed and what is not: a growth rate the document prints is
  // copied. Where it prints both periods' figures and no rate, the rate is
  // arithmetic on two stated numbers of the same unit — the same licence
  // `operating_leverage` already has — and the evidence line says so. No
  // figure is ever carried in from another period or another company.
  const hl = summary?.headline || {};
  const hlBasis = said(hl.comparison) && hl.comparison !== 'not_stated' ? String(hl.comparison).toUpperCase() : null;
  const hlPeriod = said(hl.period) ? ` (${String(hl.period).trim()})` : '';
  const hlGrowth = (cur: unknown, prior: unknown, printed: unknown): { rate: number; how: 'printed' | 'computed'; text: string } | null => {
    const p = pctIn(printed);
    if (p != null && /%|per ?cent/i.test(String(printed))) return { rate: p, how: 'printed', text: String(printed).trim() };
    const c = said(cur) ? String(cur).trim() : null;
    const b = said(prior) ? String(prior).trim() : null;
    if (!c || !b) return null;
    // Money against money, in the same magnitude words — or in none.
    if (!sameUnit(c, b, null, null)) return null;
    const cn = scaledNumber(c), bn = scaledNumber(b);
    if (cn == null || bn == null || bn === 0) return null;
    // A growth off a loss is not a growth; that case stays unread.
    if (bn < 0) return null;
    const r = ((cn - bn) / Math.abs(bn)) * 100;
    if (!Number.isFinite(r)) return null;
    return { rate: r, how: 'computed', text: `${b} → ${c}` };
  };
  if (salesY == null) {
    const rg = hlGrowth(hl.revenue, hl.revenue_prior, hl.revenue_growth);
    if (rg) {
      push({
        key: 'revenue_growth', label: VAR_LABEL.revenue_growth,
        before: said(hl.revenue_prior) ? String(hl.revenue_prior).trim() : null,
        after: said(hl.revenue) ? String(hl.revenue).trim() : pct(rg.rate),
        delta: pct(rg.rate),
        verdict: rg.rate >= 15 ? 'improving' : rg.rate >= 0 ? 'flat' : 'deteriorating',
        evidence: rg.how === 'printed'
          ? `Revenue ${rg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod}, as printed in the results filing.`
          : `Revenue ${rg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod} — both figures printed in the results filing; the ${pct(rg.rate)} is arithmetic on the two.`,
        source: 'filing',
      });
    }
  }
  if (epsY == null) {
    const eg = hlGrowth(hl.profit, hl.profit_prior, hl.profit_growth);
    if (eg) {
      push({
        key: 'earnings_growth', label: VAR_LABEL.earnings_growth,
        before: said(hl.profit_prior) ? String(hl.profit_prior).trim() : null,
        after: said(hl.profit) ? String(hl.profit).trim() : pct(eg.rate),
        delta: pct(eg.rate),
        verdict: eg.rate >= 20 ? 'improving' : eg.rate >= 0 ? 'flat' : 'deteriorating',
        evidence: eg.how === 'printed'
          ? `Profit after tax ${eg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod}, as printed in the results filing.`
          : `Profit after tax ${eg.text}${hlBasis ? ` ${hlBasis}` : ''}${hlPeriod} — both figures printed in the results filing; the ${pct(eg.rate)} is arithmetic on the two.`,
        source: 'filing',
      });
    }
  }
  if (cfoToPat == null && said(hl.cash_from_operations)) {
    // Cash conversion needs the cash figure AND a profit for the SAME period.
    // Indian quarterly filings print operating cash flow for the half-year or
    // the full year; against a quarter's PAT that ratio would be meaningless,
    // so where the periods differ the cash figure is shown as a level and the
    // ratio is not computed.
    const cfoText = String(hl.cash_from_operations).trim();
    const cfoPeriod = said(hl.cash_flow_period) ? String(hl.cash_flow_period).trim() : null;
    const samePeriod = !cfoPeriod || (said(hl.period) && cfoPeriod.toLowerCase() === String(hl.period).trim().toLowerCase());
    const cfo = scaledNumber(cfoText);
    const pat = said(hl.profit) && sameUnit(cfoText, String(hl.profit), null, null) ? scaledNumber(String(hl.profit)) : null;
    if (samePeriod && cfo != null && pat != null && pat > 0) {
      const ratio = cfo / pat;
      push({
        key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
        before: null, after: `${ratio.toFixed(2)}×`, delta: null,
        verdict: cfo < 0 ? 'deteriorating' : ratio >= 1 ? 'improving' : ratio >= 0.6 ? 'flat' : 'deteriorating',
        evidence: `Operating cash flow ${cfoText} against profit ${String(hl.profit).trim()}${hlPeriod} — ${ratio.toFixed(2)}× (both printed in the results filing; the ratio is arithmetic on the two).`,
        source: 'filing',
      });
    } else {
      push({
        key: 'cash_conversion', label: VAR_LABEL.cash_conversion,
        before: null, after: `${cfoText}${cfoPeriod ? ` (${cfoPeriod})` : ''}`, delta: null,
        verdict: 'unknown',
        evidence: `Operating cash flow ${cfoText}${cfoPeriod ? ` for ${cfoPeriod}` : ''}, as printed. `
          + (pat == null || pat <= 0
            ? 'No same-unit positive profit figure to set it against, so no ratio.'
            : 'The cash-flow period differs from the results period, so no ratio is drawn against a quarter\'s profit.'),
        source: 'filing',
      });
    }
  }

  // ── FILING FACTS ────────────────────────────────────────────────────────
  const ut = summary?.utilisation || {};
  const utPrior0 = pctIn(ut.prior), utNow = pctIn(ut.current), utExp = pctIn(ut.expected);
  // The same figure as prior and current is one figure (BHAGCHEM "~35% →
  // 35% · +0pp", GANDHAR "93% → 93%"). (zzz764)
  const utRestated = utPrior0 != null && utNow != null && utPrior0 === utNow;
  const utPrior = utRestated ? null : utPrior0;
  if (said(ut.current) || said(ut.prior) || said(ut.expected)) {
    const d = utPrior != null && utNow != null ? utNow - utPrior : null;
    push({
      key: 'utilisation', label: VAR_LABEL.utilisation,
      before: said(ut.prior) && !utRestated ? String(ut.prior) : null,
      after: said(ut.current) ? String(ut.current) : null,
      delta: d != null ? `${d >= 0 ? '+' : ''}${d.toFixed(0)}pp` : null,
      verdict: d == null ? 'unknown' : d >= 2 ? 'improving' : d > -2 ? 'flat' : 'deteriorating',
      evidence: [
        said(ut.prior) && said(ut.current) && !utRestated ? `Utilisation ${ut.prior} → ${ut.current}.`
          : said(ut.current) ? `Utilisation ${ut.current}, no prior figure disclosed.` : '',
        said(ut.expected) ? `Management expects utilisation of ${ut.expected}${said(ut.expected_by) ? ` by ${ut.expected_by}` : ''}.` : '',
      ].filter(Boolean).join(' '),
      source: 'filing',
    });
    void utExp;
  }

  const capex: any[] = Array.isArray(summary?.capex_projects) ? summary.capex_projects : [];
  if (capex.length) {
    const cap = capex.filter((c) => said(c?.capacity_added));
    push({
      key: 'capex', label: VAR_LABEL.capex,
      before: null,
      after: capex.map((c) => [c?.name, said(c?.amount) ? c.amount : null].filter(Boolean).join(' — ')).join(' · '),
      delta: null,
      // A capex ANNOUNCEMENT is not an improvement. It is money leaving the
      // business against a promise, and whether it improved anything is what
      // capex-chain.ts decides from utilisation and margin afterwards. Calling
      // it "improving" here is exactly the excitement the owner asked the
      // system to resist.
      verdict: 'unknown',
      evidence: capex.map((c) => [
        c?.name,
        said(c?.amount) ? c.amount : null,
        said(c?.capacity_added) ? `adds ${c.capacity_added}` : null,
        said(c?.completion_period) ? `completes ${c.completion_period}` : null,
        said(c?.revenue_from) ? `earns from ${c.revenue_from}` : null,
      ].filter(Boolean).join(', ')).join(' | '),
      source: 'filing',
    });
    if (cap.length) {
      push({
        key: 'capacity', label: VAR_LABEL.capacity,
        before: null, after: cap.map((c) => String(c.capacity_added)).join(' · '), delta: null,
        verdict: 'improving',
        evidence: `Capacity added: ${cap.map((c) => `${c.capacity_added}${said(c?.completion_period) ? ` (${c.completion_period})` : ''}`).join('; ')}.`,
        source: 'filing',
      });
    }
  }

  const ob = summary?.order_book || {};
  if (said(ob.closing_value) || said(ob.growth)) {
    // ── A LEVEL IN THE GROWTH SLOT IS A LEVEL.                      (zzz762)
    //
    // EXICOM's summary put "+1400 Cr" under `growth`, and the row printed
    // "◐ Order book +1400 Cr" as though a fourteen-hundred-crore CHANGE had
    // been stated. A growth is a rate: it carries % or pp. Anything else in
    // that slot is a stated level, and it becomes the level only when no
    // closing value was given — never a delta, and never a verdict.
    const growthRaw = said(ob.growth) ? String(ob.growth).trim() : null;
    const growthIsRate = !!growthRaw && /%|\bpp\b|per ?cent|\bbps\b/i.test(growthRaw);
    const level = said(ob.closing_value) ? String(ob.closing_value)
      : (growthRaw && !growthIsRate ? growthRaw.replace(/^\+/, '') : null);
    const g = growthIsRate ? pctIn(growthRaw) : null;
    push({
      key: 'order_book', label: VAR_LABEL.order_book,
      before: null,
      after: level,
      delta: growthIsRate ? growthRaw : null,
      verdict: g == null ? 'unknown' : g >= 15 ? 'improving' : g >= 0 ? 'flat' : 'deteriorating',
      evidence: [
        level ? `Order book ${level}.` : '',
        growthIsRate ? `Growth ${growthRaw}.` : '',
      ].filter(Boolean).join(' '),
      source: 'filing',
    });
  }
  if (said(ob.book_to_bill)) {
    const b = Number(String(ob.book_to_bill).match(/-?\d+(?:\.\d+)?/)?.[0]);
    push({
      key: 'book_to_bill', label: VAR_LABEL.book_to_bill,
      before: null, after: String(ob.book_to_bill), delta: null,
      verdict: !Number.isFinite(b) ? 'unknown' : b >= 1.1 ? 'improving' : b >= 1 ? 'flat' : 'deteriorating',
      evidence: `Book-to-bill ${ob.book_to_bill} — ${Number.isFinite(b) && b >= 1
        ? 'orders are being taken faster than they are being billed.'
        : 'the book is being drawn down faster than it is being replaced.'}`,
      source: 'filing',
    });
  }

  const g = summary?.guidance;
  if (g?.action && g.action !== 'none') {
    const a = String(g.action);
    push({
      key: 'guidance', label: VAR_LABEL.guidance,
      before: null, after: a, delta: null,
      verdict: a === 'raised' ? 'improving' : a === 'lowered' ? 'deteriorating' : 'flat',
      evidence: `Guidance ${a}${said(g.detail) ? `: ${g.detail}` : ''}${said(g.period) ? ` (${g.period})` : ''}.`,
      source: 'filing',
    });
  }

  // ── NOT EVERY LINE UNDER "ONE-OFFS" IS ONE.                       (zzz769)
  // E2E carried "Total raised 15,919.34 Mn and utilized till FY26 … balance
  // 1,326.79 Mn" — an IPO-proceeds utilisation table, not a P&L item. It is
  // dropped. MANINDS "Rs 35-50 crore expected in FY27" is a FUTURE receipt —
  // not in this quarter's profit, so it is shown and never sized against it.
  // WONDERLA "₹9.47 Cr other gain · other income" is routine treasury income
  // — shown, not counted as a one-off gain.
  const oneOffs: any[] = (Array.isArray(summary?.one_offs) ? summary.one_offs : [])
    .filter((o: any) => !isFundRaiseLine(`${o?.item ?? ''} ${o?.amount ?? ''}`));
  if (oneOffs.length) {
    const oText = (o: any) => `${o?.item ?? ''} ${o?.amount ?? ''}`;
    const future = (o: any) => ONE_OFF_FUTURE.test(oText(o));
    const routine = (o: any) => ONE_OFF_ROUTINE.test(oText(o)) && !ONE_OFF_EVENT.test(oText(o));
    const gainsAll = oneOffs.filter((o) => o?.direction === 'gain');
    const gains = gainsAll.filter((o) => !future(o) && !routine(o));
    const setAside = gainsAll.length - gains.length;
    // ── A ONE-OFF IS A FINDING ONLY WHEN IT IS BIG ENOUGH TO BE ONE. (zzz763)
    //
    // LUMAXTECH: PAT ₹99 Cr, up 83%, and one one-off gain — "tooling revenue
    // in Greenfuel, around INR 3 crore". Three per cent of profit. The F
    // thesis condition "the jump is traced to one-off items" fired on it and
    // the card said THESIS WEAKENING. A gain is sized against the profit it
    // sits in: under 10% of PAT it is shown and counted FLAT; where no amount
    // is stated it is shown as STATED, because an unsized item cannot trace
    // anything; only a material, quantified gain counts against durability.
    // Everything in raw rupees: the graded PAT is in crore; a stated amount
    // carries its own magnitude word, and one without any is read as crore.
    const rawOf = (v: unknown): number | null => {
      if (!said(v)) return null;
      const t = String(v);
      const x = scaledNumber(t);
      if (x == null) return null;
      return /\b(crores?|cr|lakhs?|millions?|mn|billions?|bn|thousands?)\b/i.test(t) ? x : x * 1e7;
    };
    const profitRaw = patCurr != null ? patCurr * 1e7 : rawOf(summary?.headline?.profit);
    const profitCr = profitRaw != null ? Math.round(profitRaw / 1e7) : null;
    const sizedGains = gains.map((o) => rawOf(o?.amount)).filter((x): x is number => x != null);
    const sized = sizedGains.length > 0;
    const gainRaw = sizedGains.reduce((t, x) => t + Math.abs(x), 0);
    const share = profitRaw != null && profitRaw > 0 && sized ? gainRaw / profitRaw : null;
    // ── THE QUESTION IS WHETHER THE JUMP SURVIVES WITHOUT THEM.      (zzz764)
    //
    // Sizing a gain against profit alone flagged GIPCL (tax refund, 11% of
    // PAT) while its profit went 57 → 158 Cr — +147% even with the refund
    // removed. The F thesis asks "is the jump traced to one-offs?", so the
    // test is the growth EX one-offs: if it collapses below 20%, the jump was
    // the one-off. Where a gain exceeds the whole profit, the two figures are
    // on different bases (a pre-exceptional PAT, a prior-period item, another
    // currency) and nothing is concluded from them.
    const prevRaw = patPrev != null ? patPrev * 1e7 : null;
    const exGrowth = share != null && share <= 1 && profitRaw != null && prevRaw != null && prevRaw > 0
      ? ((profitRaw - gainRaw) - prevRaw) / prevRaw : null;
    const material = share == null || share > 1 ? null
      : exGrowth != null ? exGrowth < 0.2
        : share >= 0.25;
    const verdict: VarVerdict = !gains.length ? (setAside ? 'stated' : 'flat')
      : material === true ? 'deteriorating'
        : material === false ? 'flat'
          : 'stated';
    push({
      key: 'one_offs', label: VAR_LABEL.one_offs,
      // The item itself, not a count: "₹56 Cr · earn-out expense · below
      // EBITDA · non-recurring" where the filing says so. (zzz765c parser)
      before: null, after: oneOffs.length === 1
        ? oneOffLine(parseOneOff(String(oneOffs[0]?.item || ''), said(oneOffs[0]?.amount) ? String(oneOffs[0].amount) : null)) || `1 item`
        : `${oneOffs.length} items`, delta: null,
      // A MATERIAL one-off GAIN flatters this quarter and will not repeat, so
      // it counts against the durability of the result even while it lifts
      // the number.
      verdict,
      unjudged: !gains.length && setAside ? 'the gain is expected in a later period or is routine other / interest / treasury income — not a one-off in this quarter\'s profit'
        : !gains.length || material != null ? null
        : share != null && share > 1 ? 'the stated one-off exceeds the reported profit, so the two are on different bases (pre-exceptional profit, a prior period or another currency) — verify in the filing'
          : 'the one-off amount is not stated, so it cannot be sized against the result',
      evidence: oneOffs.map((o) => {
        const d = oneOffLine(parseOneOff(String(o?.item || ''), said(o?.amount) ? String(o.amount) : null));
        // The direction mark carries the sign: SFL printed "− -6". (zzz767)
        const dd = d ? String(d).replace(/^\s*[-−+]\s*/, '') : d;
        return `${o?.direction === 'gain' ? '+' : '−'} ${dd || o?.item}${dd && o?.item ? ` — “${String(o.item).slice(0, 120)}”` : ''}`;
      }).join('; ')
        + (!gains.length ? (setAside ? ' — expected in a later period or routine other / interest income: not a one-off in this quarter\'s profit, so not counted.' : '')
          : material === true ? ` — one-off gains are ${Math.round(share! * 100)}% of reported profit${exGrowth != null ? `; without them profit growth is ${Math.round(exGrowth * 100)}%` : ''} — the jump rests on items that will not repeat.`
            : material === false ? ` — one-off gains are ${Math.round(share! * 100)}% of reported profit${exGrowth != null ? `; without them profit still grew ${Math.round(exGrowth * 100)}%` : ''}: the jump does not rest on them. Shown for the record.`
              : share != null && share > 1 ? ` — stated one-offs exceed the reported profit${profitCr != null ? ` (${profitCr} Cr)` : ''}; different bases, not judged.`
                : ' — amount not stated, so it cannot be sized against the result; shown, not counted.'),
      source: 'filing',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // THE STRUCTURAL BLOCK.                                        (zzz720)
  //
  // Everything above answers "what happened". Everything below answers "why,
  // and can it continue" — which is the distinction the owner drew, and the
  // reason the first engine could say "operating leverage 2.9×" without
  // knowing whether that was a plant filling up or a one-quarter cost freeze.
  //
  // Every field here comes from the figure-verified `structured` object. A
  // field the summary does not carry produces NO variable at all, which the
  // card renders as a hollow ○ — never as "flat". A variable nobody looked at
  // and a variable checked that did not move are different facts.
  // ═════════════════════════════════════════════════════════════════════
  const str = (v: unknown): string | null => (said(v) ? String(v).trim() : null);

  /** Push a variable only when the source actually said something. */
  const push_ = (
    key: VarKey, after: string | null, verdict: VarVerdict, evidence: string,
    opts: { before?: string | null; delta?: string | null; kind?: EvidenceKind } = {},
  ) => {
    if (!after && !opts.before && !opts.delta) return;
    // "No customer losses" is not a customer loss. The company was asked
    // and said none: checked, flat, and worth showing as such.
    if (verdict === 'deteriorating' && isDenial(after)) {
      push({ key, label: VAR_LABEL[key], before: null, after, delta: null, verdict: 'flat',
        evidence: `Company states no ${VAR_LABEL[key].toLowerCase()} — ${after}`, source: 'filing', kind: opts.kind ?? 'fact' });
      return;
    }
    push({
      key, label: VAR_LABEL[key],
      before: opts.before ?? null, after, delta: opts.delta ?? null,
      verdict, evidence, source: 'filing', kind: opts.kind ?? 'fact',
    });
  };

  const cap = summary?.capacity || {};
  push_('capacity', str(cap.installed), 'unknown',
    `Installed capacity ${str(cap.installed)}${str(cap.prior_installed) ? ` (was ${cap.prior_installed})` : ''}.`,
    { before: str(cap.prior_installed) });
  push_('capacity_addition', str(cap.added), 'improving',
    `Capacity added: ${str(cap.added)}${str(cap.added_by) ? `, by ${cap.added_by}` : ''}.`);
  push_('new_plant', str(cap.new_plant), 'unknown',
    `New plant: ${str(cap.new_plant)}${str(cap.new_plant_location) ? ` (${cap.new_plant_location})` : ''}.`,
    { kind: 'fact' });
  push_('commissioning', str(cap.commissioning), 'unknown',
    `Commissioning: ${str(cap.commissioning)}.`, { kind: 'claim' });
  if (str(cap.bottleneck)) {
    const removed = /remov|eas|resolv|de-?bottleneck/i.test(String(cap.bottleneck));
    push_('capacity_bottleneck', str(cap.bottleneck), removed ? 'improving' : 'deteriorating',
      `Capacity bottleneck: ${cap.bottleneck}.`);
  }

  const dem = summary?.demand || {};
  if (str(dem.order_intake) || str(dem.order_intake_growth)) {
    const gg = pctIn(dem.order_intake_growth);
    push_('order_intake', str(dem.order_intake), gg == null ? 'unknown' : gg >= 0 ? 'improving' : 'deteriorating',
      `Order intake ${str(dem.order_intake) || ''}${str(dem.order_intake_growth) ? `, ${dem.order_intake_growth}` : ''}.`,
      { delta: str(dem.order_intake_growth) });
  }
  push_('revenue_visibility', str(ob.coverage) || str(dem.revenue_visibility), 'unknown',
    `Revenue visibility: ${str(ob.coverage) || str(dem.revenue_visibility)}.`);
  if (str(dem.cancellations)) {
    push_('execution_delay', str(dem.cancellations), delayVerdict(str(dem.cancellations)),
      `Order cancellations or deferrals: ${dem.cancellations}.`);
  }

  // ── CAPEX AS A CHAIN, not an announcement. The status and the
  //    "is it earning" link are the two the owner asked for by name.
  const capexList: any[] = Array.isArray(summary?.capex_projects) ? summary.capex_projects : [];
  if (capexList.length) {
    const statuses = capexList.map((c) => str(c?.status)).filter(Boolean) as string[];
    if (statuses.length) {
      const delayed = statuses.some((x) => /delay/i.test(x));
      const running = statuses.some((x) => /commission|commercial|ramp|full/i.test(x));
      push_('capex_status', statuses.join('; '),
        delayed ? 'deteriorating' : running ? 'improving' : 'unknown',
        `Capex status: ${statuses.join('; ')}.`);
    }
    const growth = capexList.filter((c) => !/maintenance/i.test(String(c?.name || '') + String(c?.purpose || '')));
    if (growth.length !== capexList.length || growth.length) {
      push_('maintenance_vs_growth', `${growth.length} growth of ${capexList.length} disclosed`, 'unknown',
        `${growth.length} of ${capexList.length} disclosed programmes are growth rather than maintenance capex. `
        + 'Maintenance capex buys no new earnings; only growth capex can.');
    }
  }
  if (str(summary?.capex_earning)) {
    const s_ = String(summary.capex_earning);
    // ── READ THE CLAIM, NOT THE KEYWORD.                            (zzz764)
    // GIPCL "600 MW is generating revenue … CWIP relates to 500 MW not yet
    // revenue earning" printed ▼; ICIL "does not state revenue contribution"
    // printed ▲ because it contains "earning". A positive statement of money
    // coming in and a negative one about the same spend make it MIXED.
    const earns = /generat\w* (revenue|ebitda)|contribut\w* (revenue|to (revenue|ebitda|ebit))|commenced (commercial )?(operations|production)|already contributing|is contributing|running at \d|revenue from the (new|plant)|linked? .* to (improved|higher) (ebit|margin)/i.test(s_);
    const notYet = /not yet|below plan|behind (plan|schedule)|disappoint|delay|does not (state|tie|link)|did not state|no explicit link|no (quantified|explicit)|until commissioning|under construction|yet to/i.test(s_);
    // ── A PLAN IS NOT EARNING, AND SILENCE IS NOT FAILURE.         (zzz765)
    // MANINDS "expected to start contributing revenue from Mar '27" printed
    // ▲; HSCL/ICIL/SAMBHV "no explicit link / did not state" printed ▼. The
    // first is a forward statement, the second an absence of disclosure.
    // Only an actual shortfall (delay, behind plan, disappointing) is ▼.
    const future = /expected to (start )?(contribut|generat)|will (start )?(contribut|generat|add)|to contribute|from (FY|Q[1-4]|mar|apr|jun|sep|dec|oct|jan)\w*\s*'?\d{2}|once (commissioned|functional)|when (commissioned|fully ramped)|post[- ]commissioning/i.test(s_);
    const shortfall = /below plan|behind (plan|schedule)|disappoint|\bdelay/i.test(s_);
    push_('capex_earning', s_,
      shortfall ? 'deteriorating'
        : earns && !future ? (notYet ? 'stated' : 'improving')
          : (notYet || future || earns) ? 'stated' : 'unknown',
      `Capex earning: ${s_}.${earns && notYet ? ' Part of the spend is earning and part is not yet — shown, not judged either way.' : ''}`);
  }

  const cst = summary?.customers || {};
  push_('new_customer', str(cst.new_customer), 'improving', `New customer: ${str(cst.new_customer)}.`);
  push_('customer_loss', str(cst.loss), 'deteriorating', `Customer or programme lost: ${str(cst.loss)}.`);
  push_('customer_concentration', str(cst.concentration), 'unknown',
    `Customer concentration: ${str(cst.concentration)}.`);
  push_('qualification', str(cst.qualification), 'improving', `Qualification: ${str(cst.qualification)}.`);
  push_('approval', str(cst.approval), 'improving', `Approval: ${str(cst.approval)}.`);
  push_('new_product', str(cst.new_product), 'improving', `New product: ${str(cst.new_product)}.`);

  const vpm = summary?.volume_price_mix || {};
  if (str(vpm.volume)) {
    const vg = pctIn(vpm.volume);
    push_('volume', str(vpm.volume), vg == null ? 'unknown' : vg > 0 ? 'improving' : vg < 0 ? 'deteriorating' : 'flat',
      `Volume ${vpm.volume}. Volume growth is the part of revenue that is not price, so it is the part that needs capacity.`);
  }
  push_('price', str(vpm.price), 'unknown', `Price: ${str(vpm.price)}.`);
  push_('mix', str(vpm.mix), 'unknown', `Mix: ${str(vpm.mix)}.`);
  push_('exports', str(vpm.exports), 'unknown', `Exports / geography: ${str(vpm.exports)}.`);

  const fin = summary?.balance || {};
  push_('working_capital', str(fin.working_capital), 'unknown',
    `Working capital: ${str(fin.working_capital)}.`);
  push_('fcf', str(fin.fcf), 'unknown', `Free cash flow: ${str(fin.fcf)}.`);
  push_('debt', str(fin.debt), 'unknown', `Debt: ${str(fin.debt)}.`);
  const roce = n(graded?.roce) ?? n(graded?.roce_pct);
  if (roce != null) {
    // The screener's ROCE is LAST FULL YEAR's, like its cash ratio: said on
    // the row so the status engine keeps it out of the current period. (zzz773)
    const roceAnnual = ['screener', 'screener-live'].includes(String(graded?.source || ''));
    push({
      key: 'roce', label: VAR_LABEL.roce, before: null, after: `${roce.toFixed(1)}%${roceAnnual ? ' (last FY)' : ''}`, delta: null,
      verdict: roce >= 18 ? 'improving' : roce >= 12 ? 'flat' : 'deteriorating',
      evidence: `Return on capital employed ${roce.toFixed(1)}%${roceAnnual ? ' (last full year, screener figure — not this quarter\'s)' : ''}.`, source: 'grader', kind: 'fact',
    });
  }

  const risk = summary?.risks || {};
  if (str(risk.supply_bottleneck)) {
    const removed = /remov|eas|resolv/i.test(String(risk.supply_bottleneck));
    push_('supply_bottleneck', str(risk.supply_bottleneck), removed ? 'improving' : 'deteriorating',
      `Supply bottleneck: ${risk.supply_bottleneck}.`);
  }
  push_('execution_delay', str(risk.delay), delayVerdict(str(risk.delay)), `Delay: ${str(risk.delay)}.`);
  push_('shutdown', str(risk.shutdown), 'deteriorating', `Shutdown: ${str(risk.shutdown)}.`);
  push_('market_share', str(risk.market_share), 'unknown', `Market share: ${str(risk.market_share)}.`);
  push_('pricing_power', str(risk.pricing_power), 'unknown', `Pricing power: ${str(risk.pricing_power)}.`);
  push_('technology', str(risk.technology), 'unknown', `Technology / automation: ${str(risk.technology)}.`);
  push_('raw_materials', str(risk.raw_materials), 'unknown', `Raw materials: ${str(risk.raw_materials)}.`);

  // ── MANAGEMENT TARGETS ARE CLAIMS, NOT FACTS, and are tagged so. They are
  //    what the promise ledger will grade a LATER quarter against.
  for (const t of (Array.isArray(summary?.management_targets) ? summary.management_targets : [])) {
    if (!said(t?.metric) || !said(t?.target)) continue;
    push({
      key: 'management_target', label: VAR_LABEL.management_target,
      before: null, after: `${t.metric}: ${t.target}`, delta: null,
      verdict: 'unknown',
      evidence: `Management target — ${t.metric} ${t.target}${said(t?.by) ? ` by ${t.by}` : ''}. `
        + 'This is a claim about the future, not a reported figure. The ledger will check it next quarter.',
      source: 'filing', kind: 'claim',
    });
    break;
  }

  // ── THE MARGIN DRIVER. The owner's point: the reason matters more than the
  //    number. A margin built on mix, pricing, leverage or automation repeats;
  //    one built on a raw-material tailwind or forex does not, and the two
  //    read identically on the face of the P&L.
  if (drivers.length) {
    // ── A STRUCTURAL DRIVER OF A DECLINE IS NOT AN IMPROVEMENT.     (zzz769)
    // WENDT printed "▲ Margin driver" for "lower absorption cost due to
    // decreased topline leading to EBITDA decline; one-time expenses …
    // impacted FY results": the model tagged it structural, and structural
    // was read as good. Only a driver that names a positive mechanism counts;
    // one that describes pressure is shown and not judged.
    const structuralN = drivers.filter((d) => d?.nature === 'structural').length;
    const positiveN = drivers.filter((d) => d?.nature === 'structural' && marginDriverPositive(String(d?.detail || ''))).length;
    push({
      key: 'margin_driver', label: VAR_LABEL.margin_driver,
      before: null,
      after: drivers.map((d) => String(d?.detail || '')).filter(Boolean).slice(0, 2).join('; '),
      delta: null,
      verdict: positiveN > 0 ? 'improving' : structuralN > 0 ? 'stated' : 'flat',
      unjudged: positiveN === 0 && structuralN > 0 ? 'the structural drivers disclosed describe pressure or name no positive mechanism' : null,
      evidence: positiveN > 0
        ? `${positiveN} of ${drivers.length} disclosed margin drivers are structural improvements — that part repeats.`
        : structuralN > 0
          ? `${structuralN} of ${drivers.length} disclosed margin drivers are structural, but none names a mechanism that lifts the margin (${drivers.map((d) => String(d?.detail || '')).filter(Boolean).slice(0, 2).join('; ').slice(0, 200)}). Shown, not counted as an improvement.`
          : 'Every disclosed margin driver is cyclical or one-off. This margin does not repeat on its own.',
      source: 'filing', kind: 'fact',
    });
  }

  // Every row says what kind of statement it is and which period it covers,
  // including the ones built from the summary's loose fields. (zzz765)
  for (const v of out) {
    if (!v.statement) v.statement = v.key === 'guidance' ? 'GUIDANCE' : v.key === 'management_target' ? 'TARGET'
      : v.source === 'grader' ? 'ACTUAL' : v.kind === 'claim' ? 'MANAGEMENT_STATEMENT' : 'ACTUAL';
    if (v.asOf === undefined) v.asOf = opts?.period ?? null;
    decorate(v, graded, opts?.period ?? null);
  }
  const ctx = readingContext(opts?.ledger ?? null, opts?.period ?? null);
  const cleaned = tidyLevels(out, businessProfileOf(graded, summary));
  return applyComparisons(dropRestatedCapacityAddition(cleaned), comparisons)
    .map((v) => { const r = readingFor(v, ctx); return { ...v, reading: r, display: rowDisplay({ ...v, reading: r }) }; });
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVELS, AMOUNTS AND WHAT A BUSINESS CAN HAVE.                     (zzz772)
// ═══════════════════════════════════════════════════════════════════════════
/** A move the sentence itself states: a real addition or a rise. */
const POSITIVE_MOVE = /\b(increas\w*|rose|risen|grew|grown|growth|expan\w*|added|addition|adds|commission(?:ed|ing)|scal(?:e|ed|ing)[- ]?up|doubl\w*|tripl\w*|up\s+\d|up from|higher|ramp(?:ed)?[- ]up|enhanc\w*|augment\w*|all[- ]time high|record high|new (?:plant|line|facility|capacity))/i;
const NOT_DONE = /\b(in progress|under (?:construction|commissioning|development|implementation)|to be (?:commissioned|added|completed)|will be|expected to|planned|plans? to|proposed|approved at|upcoming|being (?:set up|built))\b/i;
/** Amount phrases in a capex value: "INR30 crores -INR35 crores", "₹80 Cr". */
const AMOUNT_RE = /(?:~|approx\.?\s*|approximately\s+|around\s+|about\s+|over\s+|nearly\s+)?(?:(?:₹|INR|Rs\.?|USD|US\$|\$|EUR|€)\s*[\d,]+(?:\.\d+)?(?:\s*(?:lakh\s+crores?|lakh\s+cr|crores?|cr|lakhs?|lacs?|mn|million|bn|billion))?|[\d,]+(?:\.\d+)?\s*(?:lakh\s+crores?|crores?|cr|lakhs?|lacs?|mn|million|bn|billion)\b)(?:\s*(?:-|–|to)\s*(?:₹|INR|Rs\.?|USD|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:crores?|cr|lakhs?|lacs?|mn|million|bn|billion)?)?/gi;
/** A capex value as an amount. Longer than ~60 characters, a spend
 *  sentence keeps only its amount phrase(s): MTARTECH "for quarter 1, we
 *  might have spent around INR30 crores -INR35 crores only capex, but
 *  overall INR80 crores which is capitalized" → "INR30 crores -INR35 crores ·
 *  INR80 crores". A project list keeps each name with its own amount. */
export function capexAmountText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (v.length <= 60) return v;
  const amounts = (x: string) => Array.from(new Set((x.match(AMOUNT_RE) || []).map((m) => m.trim()))).join(' · ');
  if (/ — /.test(v)) {
    return v.split(' · ').map((seg) => {
      const [name, ...rest] = seg.split(' — ');
      const amt = rest.join(' — ');
      if (!amt || amt.length <= 60) return seg;
      const a = amounts(amt);
      return a ? `${name} — ${a}` : seg;
    }).join(' · ');
  }
  return amounts(v) || v;
}
/** A distributor's or a services company's "installed capacity" is not
 *  production capacity (REDINGTON "100 MW", an IT distributor); nor is a
 *  captive solar plant at a business that does not sell power. */
const POWER_BUSINESS = /\b(solar|renewable|wind|power|energy|electricity|module|photovoltaic|pv\b|utility|EPC)\b/i;
function tidyLevels(vars: StructuralVar[], business: ReturnType<typeof businessProfileOf>): StructuralVar[] {
  const services = isServicesBusiness(business);
  const bizText = `${business?.sector || ''} ${business?.industry || ''} ${business?.text || ''}`;
  return vars.filter((v) => {
    if (v.key !== 'capacity' || v.source !== 'filing' || v.statement === 'HISTORICAL') return true;
    if (services) return false;
    const txt = `${v.after || ''} ${v.quote || v.evidence || ''}`;
    if (/\b(solar|rooftop|captive)\b/i.test(txt) && /\b(MW|kW|GW)p?\b/i.test(String(v.after || '')) && !POWER_BUSINESS.test(bizText)) return false;
    return true;
  }).map((v) => {
    let out = v;
    if (v.key === 'capex' && v.after) {
      const a = capexAmountText(stripTypeTag(v.after));
      const tag = /\((?:target|guidance)\)\s*$/i.exec(String(v.after))?.[0];
      if (a && a !== stripTypeTag(v.after)) out = { ...out, after: tag ? `${a} ${tag}` : a };
    }
    // ── A LEVEL ALONE IS STATED.                                     (zzz772)
    // An installed capacity, an order book or a utilisation with no earlier
    // figure in the text and no stated move is a level; a level is not an
    // improvement. A real before→after, a disclosed addition ("expanded to",
    // "commissioned", "grew from 94 to 103") or a stated rise still counts.
    if ((v.key === 'capacity' || v.key === 'order_book' || v.key === 'utilisation')
      && v.verdict === 'improving' && !v.before && (!v.delta || v.delta === 'FLAT')
      && (!v.statement || v.statement === 'ACTUAL')) {
      const txt = `${v.quote || v.evidence || ''}`;
      if (!POSITIVE_MOVE.test(txt) || NOT_DONE.test(txt)) {
        out = { ...out, verdict: 'stated', unjudged: out.unjudged ?? 'a level with no earlier figure and no stated move — shown, not judged' };
      }
    }
    return out;
  });
}

/** Every row carries its type, group, validation, normalised value and
 *  lineage, whichever path built it. Nothing already set is overwritten. (zzz770) */
function decorate(v: StructuralVar, graded: any | null, period: string | null): void {
  if (!v.fact_type) v.fact_type = factTypeOf({ statement: v.statement, key: v.key, value: v.after, text: v.evidence, retyped: v.retyped });
  if (!v.metric_group) v.metric_group = metricGroupOf(v.key, v.source);
  if (v.validation === undefined) v.validation = null;
  if (v.normalized === undefined) v.normalized = v.after ? normalizeValue(v.after) : null;
  if (!v.lineage) {
    v.lineage = v.source === 'grader'
      ? { source_id: null, source_name: `Filed statements (${String(graded?.source || 'grader')})`, source_url: graded?.source_url ?? null,
        source_type: 'financial_statements', publication_date: graded?.filing_date ?? null, period: graded?.period ?? period, page_section: null, quote: v.evidence }
      : { source_id: null, source_name: v.sourceLabel || 'Verified summary of the documents read', source_url: null, source_type: 'summary',
        publication_date: null, period: v.asOf ?? period, page_section: null, quote: v.quote || v.evidence };
  }
}

/** Index by key, last write wins — the filing beats the grader where both
 *  spoke, because the filing carries the reason. */
export function byKey(vars: StructuralVar[]): Partial<Record<VarKey, StructuralVar>> {
  const m: Partial<Record<VarKey, StructuralVar>> = {};
  for (const v of vars) {
    const prev = m[v.key];
    if (!prev || (prev.source === 'grader' && v.source === 'filing')) m[v.key] = v;
  }
  return m;
}


// ═══════════════════════════════════════════════════════════════════════════
// THE READING — EVERY QUANTITATIVE ROW AS A POINT IN A SERIES.       (zzz771)
//
// "Capacity utilisation 80%" is not evidence of anything on its own. The
// owner's question is always the same one: what was it earlier? So a
// quantitative row now carries a VariableReading — current → previous → Δ —
// built from the ledger's per-period snapshots (evidence-ledger.ts), and the
// row's printed value is the reading's display. Where no previous exists the
// display says so and says why: first reading, not disclosed last quarter,
// unit changed, scope changed, same period. A guidance figure, a management
// target or a historical figure is never the previous; those keep their own
// labelled slots (`plan`, `context`, statement HISTORICAL).
//
// The reading NEVER changes a verdict. Verdicts come from the comparison
// engine and the row's own before→after, exactly as before; the reading is
// the printed, persisted series behind them.
// ═══════════════════════════════════════════════════════════════════════════

export interface ReadingContext {
  period: string | null;
  /** This period's snapshot, by VarKey. */
  snapshots: Record<string, VariableSnapshot> | null;
  /** Periods on file BEFORE this one, ascending. */
  earlier: string[];
  baseline: { period: string; variables: Record<string, VariableSnapshot> } | null;
}

export function readingContext(ledger: CompanyLedger | null | undefined, period: string | null): ReadingContext {
  if (!ledger?.periods) return { period, snapshots: null, earlier: [], baseline: null };
  // A ledger handed in before the read path filled it (a harness, a test)
  // gets its snapshots derived here — the same pure function, same result.
  const l = needsVariableSnapshots(ledger) ? withVariableSnapshots(ledger) : ledger;
  const p = period || l.latest_period || null;
  const earlier = Object.keys(l.periods).filter((k) => periodOrdinal(k) >= 0 && p != null && periodOrdinal(k) < periodOrdinal(p))
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  return { period: p, snapshots: (p && l.periods[p]?.variables) || null, earlier, baseline: l.thesis_baseline || null };
}

/** "Q1 FY27" shifted by n quarters. Null when the period is not a quarter. */
export function shiftPeriod(period: string | null | undefined, n: number): string | null {
  const o = periodOrdinal(String(period || ''));
  if (o < 0) return null;
  const t = o + n;
  const fy = Math.floor((t - 1) / 4), q = ((t - 1) % 4) + 1;
  return `Q${q} FY${String(fy).slice(2)}`;
}

const basisOf = (from: string | null, to: string | null, baselinePeriod: string | null): VariableReading['comparison_basis'] => {
  if (!from || !to) return 'in_text';
  const gap = periodOrdinal(to) - periodOrdinal(from);
  if (gap === 1) return 'QoQ';
  if (gap === 4) return 'YoY';
  if (baselinePeriod && from === baselinePeriod) return 'vs_baseline';
  return 'vs_prior_read';
};
const classOf = (from: string | null, to: string | null): PeriodClass => {
  if (!from || !to) return 'HISTORICAL';
  const gap = periodOrdinal(to) - periodOrdinal(from);
  return gap === 1 ? 'PREVIOUS_QUARTER' : gap === 4 ? 'PREVIOUS_FY' : 'HISTORICAL';
};
const GLYPH: Record<string, string> = { UP: '▲', DOWN: '▼', FLAT: '→' };
// ── THE BASIS IN WORDS, NOT CODE.                                  (zzz772)
// The live page printed "▲ in_text" and "→ vs_baseline": the field value,
// not a sentence. `comparison_basis` keeps its code for the engine; the
// display says what it means.
export const BASIS_WORDS: Record<NonNullable<VariableReading['comparison_basis']>, string> = {
  QoQ: 'QoQ', YoY: 'YoY', vs_prior_read: 'vs prior read', vs_baseline: 'vs first read', in_text: 'per filing',
};
/** An in-text prior whose period the text names ("vs 145 days (Q4 FY26)")
 *  is a QoQ or YoY comparison when the two periods are one or four quarters
 *  apart; otherwise it stays "per filing". (zzz772) */
const inTextBasis = (from: string | null, to: string | null): VariableReading['comparison_basis'] => {
  if (!from || !to) return 'in_text';
  const a = periodOrdinal(from), b = periodOrdinal(to);
  if (a < 0 || b < 0) return 'in_text';
  return b - a === 1 ? 'QoQ' : b - a === 4 ? 'YoY' : 'in_text';
};

/** Money as the owner reads it: "INR107 crores" → "₹107 Cr", "₹13,000 Lakhs"
 *  → "₹130 Cr" (exact). Only a plain single-figure amount is rewritten; a
 *  range, a dated clause or anything with more words stays as stated. */
export function canonValue(raw: string): string {
  const s = rupeeGlyph(String(raw ?? '').trim());
  const nums = s.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  if (nums.length !== 1 || s.length > 32) return s;
  const n = normalizeValue(s);
  if (n.dimension === 'money:INR' && n.safe && n.normalized_unit === '₹ crore' && n.normalized_value != null
    && /^[~≈]?\s*(?:₹|INR|Rs\.?|rupees?)?\s*[\d,]+(?:\.\d+)?\s*(?:crores?|cr|lakhs?|lacs?|millions?|mn|billions?|bn)\.?\s*(?:\+|plus)?$/i.test(s)) {
    const v = Math.round(n.normalized_value * 100) / 100;
    const plus = /\+$|plus$/i.test(s) ? '+' : '';
    return `${/^[~≈]/.test(s) ? '~' : ''}₹${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} Cr${plus}`;
  }
  return s;
}

const digitsOnly = (x: string | null | undefined) => String(x ?? '').replace(/[^\d.]/g, '');

/** The quarter a date falls in: 2026-06-30 → "Q1 FY27". */
export function quarterOfDate(d: Date): string {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const q = m >= 4 ? Math.ceil((m - 3) / 3) : 4;
  const fy = m >= 4 ? y + 1 : y;
  return `Q${q} FY${String(fy).slice(2)}`;
}

/** "161 days in Q1 FY27" → { value: "161 days", period: "Q1 FY27" }; "142
 *  days in June 2025" → Q1 FY26; "66 days a year ago" → the quarter four
 *  back from `from`. The date the figure names is its period; nothing is
 *  guessed when it names none. (zzz771) */
export function figureAndPeriod(text: string, from: string | null): { value: string; period: string | null } {
  const t = String(text || '').trim();
  const TAIL = /\s+(?:in|as\s+(?:at|on|of)|at|for|by|during|end(?:ing)?\s+of|as\s+of\s+end)\s+(?:the\s+)?(?:end\s+of\s+)?(Q\s?[1-4]\s*[-' ]?\s*FY\s?'?\d{2,4}|FY\s?'?\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:\d{1,2}(?:st|nd|rd|th)?,?\s*)?(?:20)?\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+20\d{2})\s*$/i;
  // "Q1 FY26: 54.80 mmscm" and "54.80 mmscm (Q1 FY26)": the period written
  // as a prefix or in brackets is moved out of the value too. (zzz772)
  const PERIOD_TOKEN = String.raw`Q\s?[1-4]\s*[-' ]?\s*FY\s?'?\d{2,4}|FY\s?'?\d{2,4}`;
  const pre = new RegExp(`^(${PERIOD_TOKEN})\\s*[:–—-]\\s*(.+)$`, 'i').exec(t);
  const post = new RegExp(`^(.+?)\\s*\\(\\s*(${PERIOD_TOKEN})\\s*\\)\\s*$`, 'i').exec(t);
  const lead = pre ? { label: pre[1], rest: pre[2].trim() } : post ? { label: post[2], rest: post[1].trim() } : null;
  if (lead) {
    const ds = datesIn(lead.label);
    if (ds.length && isFigure(lead.rest)) {
      const d = ds[ds.length - 1];
      return { value: lead.rest, period: /^FY\d{2}$/.test(d.label) ? d.label : quarterOfDate(d.end) };
    }
  }
  const m = TAIL.exec(t);
  if (m) {
    const ds = datesIn(m[1]);
    const rest = t.slice(0, m.index).trim();
    if (ds.length && isFigure(rest)) {
      const d = ds[ds.length - 1];
      return { value: rest, period: /^FY\d{2}$/.test(d.label) ? d.label : quarterOfDate(d.end) };
    }
  }
  const ago = /\s+(?:a|one)\s+year\s+(?:ago|earlier|back)\s*$/i.exec(t);
  if (ago && isFigure(t.slice(0, ago.index))) return { value: t.slice(0, ago.index).trim(), period: shiftPeriod(from, -4) };
  return { value: t, period: null };
}

function point(value: string, period: string | null, period_class: PeriodClass, unit: string | null, source: string | null): ReadingPoint {
  const n = normalizeValue(value, unit);
  return { value: canonValue(value), period, period_class, unit: n.normalized_unit || unit || n.raw_unit, numeric: n.normalized_value ?? n.value ?? null, source };
}

/** A FIGURE, not a sentence that contains one: "80%", "~450 KL", "₹107 Cr",
 *  "9,600+MTPA", "42 days", "1.50× (last FY)" — but not "37 commercial
 *  projects provide visibility" and not "2 items". Only a figure is a point
 *  in a series. (zzz771) */
export function isFigure(s: string | null | undefined): boolean {
  const t = String(s ?? '').trim();
  if (!t || t.length > 72) return false;
  if (/^\d+\s+items?$/i.test(t)) return false;
  const lead = t.replace(/^(?:approximately|approx\.?|around|about|nearly|almost|over|circa|under|roughly|~|≈|<|>|\+)\s*/i, '');
  return /^(?:₹|INR|Rs\.?|rupees|USD|US\$|\$|€|EUR)?\s*-?\d/i.test(lead) && hasQuantity(lead);
}

/** The reading behind one row, or null for a row that is not a quantitative
 *  actual (guidance, target, historical context, commentary, a sentence). */
export function readingFor(v: StructuralVar, ctx: ReadingContext): VariableReading | null {
  if (v.statement && v.statement !== 'ACTUAL') return null;
  const src = v.sourceLabel || v.lineage?.source_name || null;
  // Operating leverage is DERIVED from two filed growth rates; the ratio is
  // the reading and its two inputs are named, never printed as a series.
  if (v.key === 'operating_leverage') {
    if (!v.delta || !/×$/.test(v.delta)) return null;
    const period0 = v.asOf || ctx.period || null;
    const cur: ReadingPoint = { value: v.delta, period: period0, period_class: 'CURRENT_QUARTER', unit: 'x', numeric: Number(v.delta.replace('×', '')) || null, source: src };
    const dir: VariableReading['direction'] = v.verdict === 'improving' ? 'UP' : v.verdict === 'deteriorating' ? 'DOWN' : 'FLAT';
    return { current: cur, previous: null, baseline: null, delta_abs: null, delta_pct: null, direction: dir, comparison_basis: 'YoY', not_comparable_reason: null,
      display: `${v.delta} (${period0 || 'period not stated'}) · derived: ${v.after} vs ${v.before} (YoY)` };
  }
  const after0 = stripTypeTag(v.after);
  if (!after0 || !isFigure(after0)) return null;
  // The screener's cash-conversion ratio is LAST FULL YEAR's and says so on
  // the row; the reading keeps that period rather than stamping the quarter.
  const lastFy = /\(last FY\)\s*$/i.test(after0);
  const fp = figureAndPeriod(lastFy ? after0.replace(/\s*\(last FY\)\s*$/i, '') : after0, v.asOf || ctx.period || null);
  const after = fp.value;
  const period = lastFy ? 'last FY' : (fp.period || v.asOf || ctx.period || null);
  const s = ctx.snapshots?.[v.key] || null;
  // The snapshot is this row's series point only when it holds this row's
  // figure; a grader row (margin from the filed statements) or a summary row
  // with another figure keeps to what the row itself states.
  const matches = !!s && (s.state === 'FOUND' || s.state === 'UNCLEAR') && !!s.value
    && (digitsOnly(s.value) === digitsOnly(after0) || digitsOnly(s.value) === digitsOnly(after) || after0.toLowerCase().includes(String(s.value).toLowerCase()));
  const current = point(after, period, 'CURRENT_QUARTER', matches ? s!.unit : null, src);
  const curTxt = `${current.value} (${period || 'period not stated'})`;
  const baselineSnap = ctx.baseline?.variables?.[v.key] || null;
  const baselineOf = (prevPeriod: string | null): ReadingPoint | null =>
    baselineSnap && baselineSnap.state === 'FOUND' && baselineSnap.value && ctx.baseline!.period !== period && ctx.baseline!.period !== prevPeriod
      ? point(baselineSnap.value, ctx.baseline!.period, 'THESIS_BASELINE', baselineSnap.unit, baselineSnap.source_name) : null;
  const base: VariableReading = {
    current, previous: null, baseline: baselineOf(null), delta_abs: null, delta_pct: null,
    direction: 'NOT_COMPARABLE', comparison_basis: null, not_comparable_reason: null, display: curTxt,
  };
  // ── UNCLEAR: shown, never compared, never a level. ──
  if (v.validation?.state === 'UNCLEAR' || (matches && s!.state === 'UNCLEAR')) {
    const reason = v.validation?.reason || s?.not_comparable_reason || 'validation required';
    return { ...base, not_comparable_reason: reason, display: `unclear — validation required: ${current.value}` };
  }
  const done = (prev: ReadingPoint, delta_abs: string | null, delta_pct: string | null, direction: VariableReading['direction'], basis0: VariableReading['comparison_basis']): VariableReading => {
    const prevTxt = `${prev.value} (${prev.period || 'earlier, in text'})`;
    const dTxt = direction === 'FLAT' || (!delta_abs && !delta_pct) ? 'unchanged' : [delta_abs, delta_pct].filter(Boolean).join(' · ');
    // An in-text prior that names its period is QoQ / YoY when that is what
    // the two periods are. (zzz772)
    const basis = basis0 === 'in_text' ? inTextBasis(prev.period, period) : basis0;
    return {
      ...base, previous: prev, baseline: baselineOf(prev.period), delta_abs, delta_pct, direction, comparison_basis: basis, not_comparable_reason: null,
      display: `${curTxt} vs ${prevTxt} · ${dTxt} · ${GLYPH[direction] || '·'} ${basis ? BASIS_WORDS[basis] : ''}`.trimEnd(),
    };
  };
  /** Δ from the two figures as written, in one unit; null when they cannot
   *  be subtracted. The persisted snapshot's delta was computed by an older
   *  parser (IRMENERGY "+5794%" from a "Q1 FY26:" label), so the reading
   *  recomputes it whenever both sides can be read. (zzz772) */
  const recomputed = (before: string, afterTxt: string): { dAbs: string | null; dPct: string | null; dir: VariableReading['direction'] } | null => {
    const nb = normalizeValue(before), na = normalizeValue(afterTxt);
    const b = nb.normalized_value, a = na.normalized_value;
    if (b == null || a == null || nb.normalized_unit !== na.normalized_unit || nb.dimension !== na.dimension || !na.safe || !nb.safe) return null;
    const pctUnit = na.dimension === 'percent' || na.dimension === 'percent_points';
    const noRel = pctUnit || na.dimension === 'days';
    const dir: VariableReading['direction'] = a > b ? 'UP' : a < b ? 'DOWN' : 'FLAT';
    return {
      dir,
      dAbs: a === b ? null : formatDeltaAbs(a - b, pctUnit ? 'pp' : (na.normalized_unit || null)),
      dPct: a === b || noRel || b === 0 ? null : formatDeltaAbs(((a - b) / Math.abs(b)) * 100, '%'),
    };
  };
  // ── 1. The persisted series: an earlier period's FOUND snapshot. ──
  if (matches && s!.previous_period && s!.previous_value) {
    const prev = point(s!.previous_value, s!.previous_period, classOf(s!.previous_period, period), null, null);
    if (s!.direction === 'NOT_COMPARABLE') {
      const why = s!.not_comparable_reason || 'not comparable';
      return { ...base, previous: prev, direction: 'NOT_COMPARABLE', comparison_basis: basisOf(s!.previous_period, period, ctx.baseline?.period ?? null),
        not_comparable_reason: why, display: `${curTxt} · previous: ${prev.value} (${prev.period}) · not comparable (${why})` };
    }
    const dir = (s!.direction === 'UP' || s!.direction === 'DOWN' || s!.direction === 'FLAT') ? s!.direction : 'UNKNOWN';
    return done(prev, s!.delta_abs, s!.delta_pct, dir, basisOf(s!.previous_period, period, ctx.baseline?.period ?? null));
  }
  // ── 2. The document's own before→after (no earlier period held a figure). ──
  if (matches && s!.previous_value && !s!.previous_period) {
    const pp = figureAndPeriod(s!.previous_value, period);
    const prev = point(pp.value, pp.period, pp.period ? classOf(pp.period, period) : 'HISTORICAL', null, src);
    const r = recomputed(pp.value, after);
    if (r) return done(prev, r.dAbs, r.dPct, r.dir, 'in_text');
    const dir = (s!.direction === 'UP' || s!.direction === 'DOWN' || s!.direction === 'FLAT') ? s!.direction : 'UNKNOWN';
    return done(prev, s!.delta_abs, s!.delta_pct, dir, 'in_text');
  }
  // ── 3. A row whose comparison (facts-based) found an earlier period. ──
  const c = v.comparison;
  if (c && c.previous && c.previous_period && c.basis !== 'NONE' && c.basis !== 'WITHIN_DOCUMENT'
    && ['INCREASED', 'DECREASED', 'UNCHANGED'].includes(c.change_type) && hasQuantity(c.previous.raw)) {
    const prev = point(c.previous.raw, c.previous_period, classOf(c.previous_period, period), null, null);
    const dir: VariableReading['direction'] = c.change_type === 'UNCHANGED' ? 'FLAT' : c.change_type === 'INCREASED' ? 'UP' : 'DOWN';
    // Δ absolute from the two normalised figures; the relative move only for
    // non-percent values ("+₹27 Cr · +33.8%"), never beside pp. (zzz771)
    const nb = normalizeValue(c.previous.raw), na = normalizeValue(after);
    const pctUnit = na.dimension === 'percent' || na.dimension === 'percent_points';
    const noRel = pctUnit || na.dimension === 'days';
    const both = nb.normalized_value != null && na.normalized_value != null && nb.normalized_unit === na.normalized_unit;
    const dAbs = c.change_type === 'UNCHANGED' ? null : both ? formatDeltaAbs(na.normalized_value! - nb.normalized_value!, pctUnit ? 'pp' : (na.normalized_unit || null)) : (pctUnit ? c.change : null);
    const dPct = c.change_type === 'UNCHANGED' || noRel ? null : (both && nb.normalized_value !== 0 ? formatDeltaAbs(((na.normalized_value! - nb.normalized_value!) / Math.abs(nb.normalized_value!)) * 100, '%') : c.change);
    return done(prev, dAbs, dPct, dir,
      c.basis === 'QOQ' ? 'QoQ' : c.basis === 'YOY' ? 'YoY' : basisOf(c.previous_period, period, ctx.baseline?.period ?? null));
  }
  // ── 4. The row's own before (grader bridge, summary prior, in-text). ──
  const before0 = v.before ? rupeeGlyph(v.before) : null;
  if (before0 && hasQuantity(before0) && digitsOnly(before0) !== digitsOnly(after)) {
    // The margin bridge is the grader's filed prior (same quarter last year,
    // or last quarter when only the sequential move exists) even when the
    // row is 'filing' because the summary attached the drivers.
    const grader = v.source === 'grader' || (v.key === 'margin' && /year on year|vs last quarter/.test(v.evidence));
    const qoq = /\bQoQ\b/i.test(String(v.delta || '')) || /vs last quarter/.test(v.evidence);
    const bp = grader ? { value: before0, period: shiftPeriod(period, qoq ? -1 : -4) } : figureAndPeriod(before0, period);
    const before = bp.value;
    const prevPeriod = bp.period;
    const prev = point(before, prevPeriod, grader ? (qoq ? 'PREVIOUS_QUARTER' : 'PREVIOUS_FY') : (prevPeriod ? classOf(prevPeriod, period) : 'HISTORICAL'), null, src);
    const nb = normalizeValue(before), na = normalizeValue(after);
    const b = nb.normalized_value, a = na.normalized_value;
    const dir: VariableReading['direction'] = b != null && a != null ? (a > b ? 'UP' : a < b ? 'DOWN' : 'FLAT')
      : /^[+]/.test(String(v.delta || '')) ? 'UP' : /^[-−]/.test(String(v.delta || '')) ? 'DOWN' : 'UNKNOWN';
    const stated = v.delta && v.delta !== 'FLAT' ? v.delta.replace(/\s*QoQ$/i, '').replace(/^-/, '−').trim() : null;
    const pctUnit = na.dimension === 'percent' || na.dimension === 'percent_points';
    const noRel = pctUnit || na.dimension === 'days';
    // Δ absolute is arithmetic on the two stated figures in one unit; the
    // relative move is the row's own stated rate where it is one. (zzz771)
    const sameUnitBoth = b != null && a != null && nb.normalized_unit === na.normalized_unit && nb.dimension === na.dimension;
    const dAbs = sameUnitBoth && a !== b ? formatDeltaAbs(a! - b!, pctUnit ? 'pp' : (na.normalized_unit || null)) : (stated && /pp$/i.test(stated) ? stated : null);
    const dPct = noRel ? null : stated && /%$/.test(stated) ? stated : (sameUnitBoth && b !== 0 && a !== b ? formatDeltaAbs(((a! - b!) / Math.abs(b!)) * 100, '%') : null);
    return done(prev, dAbs, dPct, dir, grader ? (qoq ? 'QoQ' : 'YoY') : 'in_text');
  }
  // ── 5. A grader rate is already a year-on-year change: it has no "previous". ──
  if (v.source === 'grader' && /^[+\-−]?\d[\d.,]*\s*%$/.test(after) && (v.key === 'revenue_growth' || v.key === 'earnings_growth')) {
    const dir: VariableReading['direction'] = /^-|^−/.test(after) ? 'DOWN' : /^\+/.test(after) ? 'UP' : 'FLAT';
    return { ...base, direction: dir, comparison_basis: 'YoY', display: `${curTxt} · ${GLYPH[dir]} YoY (growth rate as filed)` };
  }
  // ── 6. No previous anywhere — say precisely why. ──
  const why = matches && s!.not_comparable_reason ? s!.not_comparable_reason
    : !ctx.earlier.length ? 'first reading'
      : `not on file for ${ctx.earlier[ctx.earlier.length - 1]}`;
  const shown = /^not disclosed in /.test(why) ? why : /^(unit changed|scope changed|same period)$/.test(why) ? `not comparable (${why})` : `not disclosed (${why})`;
  return { ...base, not_comparable_reason: why, display: `${curTxt} · previous: ${shown}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// WHAT CHANGED, FROM THE BOARD'S OWN ROWS.                           (zzz765)
//
// The header list used to come from a separate ledger routine with its own
// selection, so one card printed two figures for one variable (ENTERO one-offs
// ₹56 Cr above, ₹11.5 Cr below; PICCADIL utilisation 80% above, 60% below)
// and kept "Capacity utilisation 65% to 70%" (INNOVACAP's at-peak plan) that
// the board had already re-typed as guidance. One source now: the rows.
// ═══════════════════════════════════════════════════════════════════════════
// A PDF's rupee glyph often extracts as a backtick: "` 110 crore". (zzz768)
// …and as "!" (AETHER "Capex: !833 million · plan !1,000 million"). (zzz769)
export const rupeeGlyph = (s: string) => s.replace(/`\s*(?=\d)/g, '₹').replace(/(?<![A-Za-z])H\s?(?=\d[\d,.]*\s*(?:crores?|cr\b|lakhs?|mn\b|million|billion|bn\b))/g, '₹')
  .replace(/!\s?(?=\d[\d,.]*\s*(?:crores?|cr\b|lakhs?|mn\b|million|billion|bn\b))/gi, '₹');
/** Every string in a stored summary / ledger with the PDF rupee glyph fixed.
 *  Display-only: stored ledgers are not rewritten. URLs are left alone. (zzz768) */
export function deepRupeeGlyph<T>(v: T): T {
  if (typeof v === 'string') return (/^https?:\/\//.test(v) ? v : rupeeGlyph(v)) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepRupeeGlyph(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = k === 'url' || k === 'source_url' ? x : deepRupeeGlyph(x);
    return o as T;
  }
  return v;
}
const stripTypeTag = (s: string | null | undefined) => rupeeGlyph(String(s ?? '').replace(/\s*\((?:target|guidance)\)\s*$/i, '').trim());

/** The ACTUAL figure with its comparison, as the owner asked: "68% (Q4 FY26)
 *  → 74% · +6pp", "59 days (Q4 FY26) → 59 days · unchanged", "74% · NOT
 *  COMPARABLE with … — reason". With `priorNote`, a recurring figure with no
 *  prior reads "74% · prior comparable value not disclosed". (zzz770) */
function actualCore(v: StructuralVar, priorNote: boolean): string {
  const after = stripTypeTag(v.after);
  const c = v.comparison;
  const numeric = hasQuantity(after);
  if (c && c.previous && c.basis !== 'NONE' && c.basis !== 'WITHIN_DOCUMENT' && c.change_type === 'NOT_COMPARABLE' && after
    && numeric && hasQuantity(c.previous.raw)) {
    return `${after} · NOT COMPARABLE with ${c.previous.raw}${c.previous_period ? ` (${c.previous_period})` : ''}${c.comparability?.reason ? ` — ${c.comparability.reason}` : ''}`;
  }
  // "LGFT (Q3 FY26) → LGFT · FLAT" (KINGFA) is one statement made twice, not
  // a measured flat. (zzz769) A FIGURE made twice across two genuinely
  // different periods is "59 → 59 · unchanged". (zzz770)
  if (c && c.previous && c.basis !== 'NONE' && c.basis !== 'WITHIN_DOCUMENT'
    && String(c.previous.raw ?? '').trim().toLowerCase() === after.toLowerCase() && after) {
    if (!numeric) return `${after} · unchanged since ${c.previous_period || 'the last disclosure'}`;
    return `${c.previous.raw}${c.previous_period ? ` (${c.previous_period})` : ''} → ${after} · unchanged`;
  }
  if (c && c.previous && c.basis !== 'NONE' && c.basis !== 'WITHIN_DOCUMENT'
    // "25 KLPD → 25 KLPD Ethanol plant", "₹23 Cr → over six months of
    // inventory": a prior that cannot be compared is not printed as a before. (zzz768)
    && c.change_type !== 'NOT_COMPARABLE') {
    const ch = c.change_type === 'UNCHANGED' ? 'unchanged' : (c.change || v.delta || '');
    return `${c.previous.raw}${c.previous_period ? ` (${c.previous_period})` : ''} → ${after}${ch ? ` · ${ch}` : ''}`;
  }
  // A zero move is no move: "13.0% → 13.0% · +0.0pp" reads "unchanged".
  const zero = /^[+-]?0(?:\.0+)?\s*(?:pp|%|bps)?$/i.test(String(v.delta || '').trim());
  if (v.before && after) return `${v.before} → ${after}${v.delta ? ` · ${v.delta === 'FLAT' || zero ? 'unchanged' : v.delta}` : ''}`;
  const lvl = `${after || v.delta || ''}${v.delta && v.delta !== after && after ? ` · ${v.delta}` : ''}`;
  // Only a FIGURE is a level in a series — not a sentence that contains one.
  const figure = after.length <= 40 && /^[~≈<>+]?\s*(?:₹|INR|Rs\.?|USD|\$|approx\w*\s+)?\s*\d/i.test(after);
  if (priorNote && v.source === 'filing' && figure && !v.delta && RECURRING_METRICS.has(v.key)) return `${lvl} · ${PRIOR_NOT_DISCLOSED}`;
  return lvl;
}

/** A plan beside the actual, never merged into it: "Actual: 74% · Target:
 *  80%+ · gap −6pp" (AARTIPHARM). (zzz770) */
function withPlan(core: string, v: StructuralVar): string {
  if (!v.plan) return core;
  return `Actual: ${core} · ${v.plan.type === 'TARGET' ? 'Target' : 'Guidance'}: ${rupeeGlyph(v.plan.value)}${v.plan.gap ? ` · gap ${v.plan.gap}` : ''}`;
}
const validationTail = (v: StructuralVar) => v.validation?.state === 'UNCLEAR' ? ' · validation required'
  : v.validation?.metric_definition ? ` · definition: ${v.validation.metric_definition}` : '';
const definitionTail = (v: StructuralVar) => v.validation?.metric_definition ? ` · definition: ${v.validation.metric_definition}` : '';

export function rowValueText(v: StructuralVar): string {
  const after = stripTypeTag(v.after);
  if (v.statement === 'GUIDANCE' || v.statement === 'TARGET') {
    if (/^(maintained|reiterated|unchanged)$/i.test(after)) return `${v.statement.toLowerCase()} MAINTAINED`;
    const gm = v.comparison?.guidance_move;
    if (gm && gm !== 'NOT_COMPARABLE' && gm !== 'MAINTAINED' && v.comparison?.previous) {
      return `${v.statement.toLowerCase()}: ${v.comparison.previous.raw}${v.comparison.previous_period ? ` (${v.comparison.previous_period})` : ''} → ${after} · ${gm.toLowerCase()}`;
    }
    return `${v.statement.toLowerCase()}: ${after}`;
  }
  if (v.statement === 'MANAGEMENT_STATEMENT') return `management: “${after}”${v.plan ? ` · ${v.plan.type === 'TARGET' ? 'target' : 'plan'} ${rupeeGlyph(v.plan.value)}` : ''}`;
  if (v.statement === 'HISTORICAL') return `${[v.before, after].filter(Boolean).join(' → ')} — historical context (${v.asOf})`;
  // A quantitative row prints its time-series reading, so "80%" never stands
  // alone when any prior exists. The reading already says "unclear —
  // validation required"; only a stated definition is appended. (zzz771)
  if (v.reading) return withPlan(v.reading.display, v) + definitionTail(v);
  return withPlan(actualCore(v, false), v) + validationTail(v);
}

/** The whole row as printed on the board (StructuralVar.display). (zzz770) */
export function rowDisplay(v: StructuralVar): string {
  const after = stripTypeTag(v.after);
  switch (v.statement) {
    case 'HISTORICAL': return `Historical context (${v.asOf}): ${[v.before, after].filter(Boolean).join(' → ')}`;
    case 'GUIDANCE': case 'TARGET': {
      const tag = v.statement === 'TARGET' ? 'Target' : 'Guidance';
      if (/^(maintained|reiterated|unchanged)$/i.test(after)) return `${tag}: maintained`;
      const moved = v.comparison?.guidance_move && v.comparison.guidance_move !== 'NOT_COMPARABLE' && v.comparison.previous
        ? `${v.comparison.previous.raw}${v.comparison.previous_period ? ` (${v.comparison.previous_period})` : ''} → ${after} · ${v.comparison.guidance_move.toLowerCase()}` : after;
      // A target is never shown as the actual: "Target: 80%+ · actual not disclosed".
      return `${tag}: ${moved}${RECURRING_METRICS.has(v.key) ? ' · actual not disclosed' : ''}`;
    }
    case 'MANAGEMENT_STATEMENT':
      return `${FACT_TYPE_LABEL[v.fact_type === 'ESTIMATE' ? 'ESTIMATE' : 'MANAGEMENT_COMMENTARY']}: “${after}”`;
    default:
      if (v.reading) return withPlan(v.reading.display, v) + definitionTail(v);
      return withPlan(actualCore(v, true), v) + validationTail(v);
  }
}

// ── THE CHANGE CLASSES.                                             (zzz770)
//
// WHAT CHANGED lists only real changes, each one of three kinds:
//   PERIOD_CHANGE    the figure against a previous comparable period
//                    (across ledger periods, or a before→after the document
//                    states itself);
//   NEW_EVENT        something happened this period — a plant commissioned,
//                    a customer won or lost, an approval — no arithmetic;
//   GUIDANCE_CHANGE  guidance moved (raised / lowered / narrowed / widened).
// A bare level with no prior and no event ("Installed capacity 152,000 MT")
// is not a change: it stays on the board and leaves this list. Historical
// context is never a current change.
export type ChangeClass = 'PERIOD_CHANGE' | 'NEW_EVENT' | 'GUIDANCE_CHANGE';
export const CHANGE_CLASS_LABEL: Record<ChangeClass, string> = {
  PERIOD_CHANGE: 'vs previous comparable period',
  NEW_EVENT: 'new event',
  GUIDANCE_CHANGE: 'guidance moved',
};
export interface ClassifiedChangeLine extends ChangeLine { change_class: ChangeClass }

const EVENT_DONE = /\b(commissioned|launched|added|won|signed|received|approved|qualified|opened|started|commenced|completed|acquired|lost|shut|onboarded|inaugurated|secured|bagged|went live|is live|are live|now operational|became operational|made operational|operationali[sz]ed|began|terminated|cancelled|exited)\b/i;
const EVENT_NOT_YET = /\b(under (?:commissioning|development|construction|implementation|execution|trial)|being (?:set up|built|constructed|commissioned)|in progress|to be commissioned|yet to|will be|expected to|plan(?:s|ned)? to|likely|going to|would|upcoming|proposed)\b/i;
const GUIDANCE_MOVED = /^(raised|lowered|revised|cut|upgraded|downgraded|withdrawn|narrowed|widened|increased|reduced)\b/i;

export function changeClassOf(v: StructuralVar): ChangeClass | null {
  if (v.statement === 'HISTORICAL' || v.verdict === 'unknown') return null;
  if (v.validation?.state === 'UNCLEAR') return null;
  if (v.statement === 'GUIDANCE' || v.statement === 'TARGET') {
    const gm = v.comparison?.guidance_move;
    if (gm && ['RAISED', 'LOWERED', 'NARROWED', 'WIDENED'].includes(gm)) return 'GUIDANCE_CHANGE';
    if (v.key === 'guidance' && GUIDANCE_MOVED.test(stripTypeTag(v.after))) return 'GUIDANCE_CHANGE';
    return null;
  }
  const text = `${v.after || ''} ${v.quote || ''}`;
  if (v.statement === 'MANAGEMENT_STATEMENT') {
    if (v.fact_type === 'MANAGEMENT_COMMENTARY' && v.unjudged) return null;
    return EVENT_METRICS.has(v.key) && EVENT_DONE.test(text) && !EVENT_NOT_YET.test(v.after || '') ? 'NEW_EVENT' : null;
  }
  const c = v.comparison;
  // An event already on file in an earlier period and restated now is the
  // same event, not a new one and not a change (IFBAGRO "25 KLPD ethanol
  // plant", SCI "3,000 DWT"). (zzz770)
  if (EVENT_METRICS.has(v.key) && c && c.previous && c.basis !== 'NONE' && c.basis !== 'WITHIN_DOCUMENT'
    && (c.change_type === 'UNCHANGED' || (c.change_type === 'NOT_COMPARABLE' && !(hasQuantity(c.previous.raw) && hasQuantity(v.after))))) return null;
  if (c && c.previous && c.basis !== 'NONE' && ['INCREASED', 'DECREASED', 'UNCHANGED'].includes(c.change_type)) return 'PERIOD_CHANGE';
  if (v.before && v.after && v.delta) return 'PERIOD_CHANGE';
  // A snapshot-backed reading with a comparable previous is a period change
  // even when the row itself carried no before. (zzz771)
  if (v.reading?.previous && ['UP', 'DOWN', 'FLAT'].includes(v.reading.direction)) return 'PERIOD_CHANGE';
  if (EVENT_METRICS.has(v.key)) {
    if (v.key === 'execution_delay' || v.key === 'customer_loss' || v.key === 'shutdown') return v.verdict === 'deteriorating' ? 'NEW_EVENT' : null;
    if (v.key === 'capacity_bottleneck' || v.key === 'supply_bottleneck') return v.verdict === 'improving' || v.verdict === 'deteriorating' ? 'NEW_EVENT' : null;
    if (v.key === 'commissioning' || v.key === 'capex_status') return EVENT_DONE.test(text) && !EVENT_NOT_YET.test(`${v.after || ''}`) ? 'NEW_EVENT' : null;
    return EVENT_NOT_YET.test(v.after || '') ? null : 'NEW_EVENT';
  }
  return null;
}

/** A comparable earlier value exists and differs. (zzz773) */
function isRealChange(v: StructuralVar, cls: ChangeClass): boolean {
  if (cls === 'GUIDANCE_CHANGE') return true;
  if (cls !== 'PERIOD_CHANGE' || v.unjudged) return false;
  const r = v.reading;
  if (r && r.previous && (r.direction === 'UP' || r.direction === 'DOWN') && !r.not_comparable_reason) return true;
  const c = v.comparison;
  if (c && c.previous && c.basis !== 'NONE' && (c.change_type === 'INCREASED' || c.change_type === 'DECREASED')) return true;
  return !!(v.before && v.after && v.delta && !/^(?:flat|unchanged|0(?:\.0+)?\s*(?:%|pp)?)$/i.test(v.delta.trim()));
}

export function rowChangeLines(vars: StructuralVar[], period: string | null): ClassifiedChangeLine[] {
  const rank = (v: StructuralVar) => v.statement === 'GUIDANCE' || v.statement === 'TARGET' ? 4
    : v.statement === 'MANAGEMENT_STATEMENT' ? 3
      : v.verdict === 'deteriorating' ? 0 : v.verdict === 'improving' ? 1 : 2;
  const CLASS_ORDER: Record<ChangeClass, number> = { PERIOD_CHANGE: 0, NEW_EVENT: 1, GUIDANCE_CHANGE: 2 };
  return vars
    // Rows read from typed events (they carry the document they came from);
    // the grader's financial rows have their own block on the card.
    .filter((v) => v.source === 'filing' && !!v.sourceLabel && v.verdict !== 'unknown')
    .map((v, i) => ({ v, i, cls: changeClassOf(v) }))
    .filter((x): x is { v: StructuralVar; i: number; cls: ChangeClass } => x.cls != null)
    .sort((a, b) => CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls] || rank(a.v) - rank(b.v) || a.i - b.i)
    .slice(0, 12)
    .map(({ v, cls }) => ({
      sign: (v.statement && v.statement !== 'ACTUAL') ? '·' as const
        : v.verdict === 'improving' ? '+' as const : v.verdict === 'deteriorating' ? '-' as const : '·' as const,
      // A separator between the variable and its value: "Guidance management:
      // “over 25%”" and "Capacity added guidance 8 plants" read as one run-on
      // phrase. (zzz767)
      // "Guidance — guidance: x" and "Management target — target: x" say the
      // type twice; the label already names it. (zzz768)
      text: (() => {
        const val = rowValueText(v);
        const t = (v.statement || '').toLowerCase();
        if ((t === 'guidance' || t === 'target') && new RegExp(`\\b${t}\\b`, 'i').test(v.label) && val.startsWith(`${t}: `)) return `${v.label}: ${val.slice(t.length + 2)}`;
        return `${v.label}${v.statement && v.statement !== 'ACTUAL' ? ' — ' : ': '}${val}`;
      })(),
      metric: v.key, period: period || v.asOf || '', source: v.sourceLabel || '',
      change_class: cls,
      // ── A CHANGE NEEDS A COMPARABLE EARLIER VALUE THAT DIFFERS.     (zzz773)
      // "Capacity added: 150,000 MTPA · previous: not disclosed (first
      // reading)" is evidence found, not a change.
      kind: isRealChange(v, cls) ? 'change' as const : 'evidence' as const,
    }))
    .map((l) => {
      const v = vars.find((x) => x.key === l.metric && x.source === 'filing');
      return v?.unjudged && !l.text.includes(v.unjudged) ? { ...l, text: `${l.text} — ${v.unjudged}` } : l;
    });
}

/** Historical context, kept OUT of WHAT CHANGED and labelled as what it is:
 *  "Working capital — Historical context (Mar 2025): INR440 Cr → INR593 Cr"
 *  (ETHOSLTD). For a card that wants to show it beneath the changes. (zzz770) */
export function rowContextLines(vars: StructuralVar[], period: string | null): ChangeLine[] {
  return vars
    .filter((v) => v.source === 'filing' && v.statement === 'HISTORICAL')
    .slice(0, 6)
    .map((v) => ({ sign: '·' as const, text: `${v.label} — ${rowDisplay(v)}`, metric: v.key, period: period || v.asOf || '', source: v.sourceLabel || '' }));
}
