// ═══════════════════════════════════════════════════════════════════════════
// THESIS STATUS — THE EVIDENCE, NOT THE DECISION.                   (zzz715)
//
// The owner's rule, verbatim: "Don't automate the decision. Automate the
// evidence required to make the decision." So nothing here returns BUY or
// SELL. The strongest verdict this module can reach is THESIS BROKEN, whose
// action is EXIT REVIEW — a prompt to look, with the evidence already
// assembled, not an instruction to trade.
//
// AND THE HARDER RULE: "A price move is never an exit reason." No price field
// is read anywhere in this file. Not the drawdown, not the day-one reaction,
// not the move since print. A holding down 40% with every operating variable
// improving is THESIS STRENGTHENING here, and that is the whole point — the
// owner's own ledger priced his price-triggered selling at roughly Rs 1.9 Cr
// of foregone gains.
//
// SIX STATUSES. Five are the spec's; the sixth exists because the first
// version failed a test the owner applied the moment he saw the page.
//
// ── WHY "EVIDENCE INCOMPLETE" HAD TO BE ADDED.                    (zzz717)
//
// With ZERO filings read, the page reported 8 holdings as THESIS
// STRENGTHENING — and said, two lines above, that utilisation, capex, order
// book and guidance all live in the filings it had not opened. It reached a
// conclusion from revenue, earnings and margin alone and dressed it as a
// verdict on a thesis whose core variables it had never looked at.
//
// The rule now, and it is asymmetric on purpose:
//
//   A POSITIVE verdict requires that the thesis's CORE variables were
//   actually checked. Absence of evidence cannot confirm health — the one
//   variable nobody looked at is exactly where the problem would be.
//
//   A NEGATIVE verdict does NOT require full coverage. Damage you can
//   already see in the filed numbers is not undone by reading more; a
//   collapsing margin is a collapsing margin whether or not utilisation was
//   disclosed. Refusing to flag it until everything is read would be the
//   mirror-image error, and the more expensive one.
//
// So an unread holding sits at EVIDENCE INCOMPLETE showing the financial
// trend it genuinely has, with the unchecked variables listed as unchecked —
// and can still be pulled straight to WEAKENING or BROKEN if the numbers in
// hand are bad enough.
//
//   EVIDENCE_INCOMPLETE  the core variables have not been checked yet
//   STRENGTHENING  new evidence supports the thesis
//   NEUTRAL        nothing material changed
//   WEAKENING      important evidence deteriorated — REVIEW, not exit
//   BROKEN         a core assumption is invalidated — EXIT REVIEW
//   EXPECTATION_GAP the business trajectory differs materially from what
//                  management implied — flagged separately because it is
//                  neither good nor bad news, it is a MISPRICING of
//                  expectations and it needs a different kind of look
//
// WHAT COUNTS AS BROKEN, and why the bar is where it is. One core variable
// deteriorating is not a break: a single weak quarter is the thing the owner
// sells on and regrets, and the whole point of the ledger is to stop that. A
// break needs either TWO core variables down together, or one core variable
// down alongside management reducing its own forward expectations — the
// combination that means the company agrees the mechanism has stopped.
// ═══════════════════════════════════════════════════════════════════════════

import type { AbfgPattern } from '@/lib/earnings/pattern-abfg';
import { thesisFor, type Thesis, type ThesisVariable } from './ledger';
import { byKey, type StructuralVar, type VarVerdict } from './variables';
import { BASIS_LABEL, type MetricComparison } from './comparison';
import { periodEnd } from './fact-normalize';
import { VAR_LABEL, GRADER_AVAILABLE, SILENCE_IS_A_PASS, VAR_DIMENSION, DIMENSION_LABEL, type VarKey, type VarDimension, type AbsenceReason,
  type EvidenceState, stateOfAbsence, isServicesBusiness, PHYSICAL_CAPACITY_VARS, type BusinessProfile } from './taxonomy';

/** A variable the grader can fill without a document is OUTPUT. (zzz738) */
const isOutput = (k: VarKey): boolean => VAR_DIMENSION[k] === 'financial' || GRADER_AVAILABLE.has(k);

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL OUTPUT IS NEVER MECHANISM EVIDENCE.                    (zzz765c)
//
// Revenue, PAT/EPS, margin — and operating leverage computed from them — are
// what the mechanism PRODUCES. The old mechanism chain listed every weight-3+
// ledger variable as a "link", so MINDACORP read "4 of 5 links hold" on
// revenue, margin, earnings and cash alone: output passing itself off as the
// mechanism. Operating leverage is output when it is arithmetic on revenue and
// profit (the grader's figure); it counts as structural only when a document
// states it — fixed-cost absorption named by the company.
// ═══════════════════════════════════════════════════════════════════════════
const isFinancialOutput = (k: VarKey, source?: string | null): boolean =>
  VAR_DIMENSION[k] === 'financial' && !(k === 'operating_leverage' && source === 'filing');

/** ── WHAT EACH STRATEGY'S STRUCTURAL MECHANISM IS.               (zzz765c)
 *
 *  The variables that establish WHY the output happened, per strategy. The
 *  REQUIRED subset is decided by the existing ledger weights (3 or 4), not by
 *  a new list: A needs utilisation and volume, B the order book, book-to-bill
 *  and intake, F the margin driver, one-offs and cash, G cash and ROCE. A
 *  grader-computed operating leverage is output, so it is never a gate. */
const STRATEGY_STRUCTURAL: Record<string, VarKey[]> = {
  A: ['utilisation', 'volume', 'capacity', 'capacity_addition', 'operating_leverage'],
  B: ['order_intake', 'order_book', 'book_to_bill'],
  F: ['margin_driver', 'one_offs', 'cash_conversion'],
  G: ['cash_conversion', 'working_capital', 'roce'],
  // No stated setup: the ledger's own non-output variables, cash first.
  UNCLASSIFIED: ['cash_conversion', 'working_capital', 'utilisation', 'order_book', 'capex_earning'],
};

/** Short names for the one-line financial-output summary. */
const OUTPUT_SHORT: Array<[VarKey, string]> = [
  ['revenue_growth', 'revenue'], ['earnings_growth', 'earnings'], ['margin', 'margin'],
];

// ── THE STATUS TEXT AGREES WITH THE LABEL.                        (zzz770)
// "🟢 THESIS STRENGTHENING … NO THESIS ACTION TRIGGERED" read as two verdicts
// on one card. Every action line now opens with its own status label, and the
// three sentences below are the owner's wording.
export const OUTPUT_ONLY_SENTENCE =
  'Financial output improved, but the structural cause has not yet been established.';
export const STRENGTHENING_SENTENCE =
  'THESIS STRENGTHENING — structural mechanism confirmed and financial evidence supports it. No separate invalidation trigger is present.';
export const CONFIRMATION_SENTENCE =
  'CONFIRMATION REQUIRED — financial output improved, but the structural cause has not yet been established.';
export const INCOMPLETE_SENTENCE =
  'EVIDENCE INCOMPLETE — required thesis variables remain unreviewed. This is not evidence of deterioration.';
const INCOMPLETE_BECAUSE = 'Required thesis variables remain unreviewed. This is not evidence of deterioration. ';
// ── THE OWNER'S SENTENCE FOR A GOOD PRINT WITH AN UNPROVEN CAUSE.  (zzz771)
// "It can say: Evidence incomplete — financial output strengthening;
// structural mechanism not yet fully confirmed." Template: {x}/{y} is the
// same count the green line prints, {confirmed} the variables behind it.
export const OUTPUT_STRENGTHENING_BECAUSE =
  'Evidence incomplete — financial output strengthening; structural mechanism not yet fully confirmed ({x}/{y}: {confirmed}).';
export const OUTPUT_STRENGTHENING_SENTENCE =
  'CONFIRMATION REQUIRED — evidence incomplete: financial output strengthening; structural mechanism not yet fully confirmed.';
const STRENGTHENING_BECAUSE = 'Structural mechanism confirmed and financial evidence supports it. No separate invalidation trigger is present. ';

/** Cash conversion is thesis-critical only where it IS the thesis: the F
 *  forensic test and G's "the quality is the cash". Everywhere else a weak
 *  reading is a FINANCIAL WARNING, shown and never a status mover. (zzz770) */
export const cashIsThesisCritical = (pattern: string | null | undefined): boolean => pattern === 'F' || pattern === 'G';

/** A negative cash-to-profit ratio from a grader row is an ANNUAL ratio whose
 *  sign may come from either side. It is UNCLEAR — validation required —
 *  and counted neither way. (zzz770) */
export const NEGATIVE_CASH_UNCLEAR = 'validation required — a negative cash-to-profit ratio; which side (cash or profit) is negative for the same period is not established';
const isNegativeRatio = (s: unknown) => /^\s*[-−]\s*\d/.test(String(s ?? ''));

/** For each core MECHANISM variable, the evidenced drivers that establish the
 *  same physical / commercial mechanism when the variable itself is silent.
 *  Utilisation's absorption can be shown by volume or capacity coming on
 *  stream; an order book by intake or book-to-bill. A margin driver or a
 *  product-mix story is NOT absorption. (zzz770) */
const MECH_SUBSTITUTES: Partial<Record<VarKey, VarKey[]>> = {
  utilisation: ['volume', 'capacity', 'capacity_addition', 'capex_earning', 'commissioning'],
  order_book: ['order_intake', 'book_to_bill'],
  order_intake: ['order_book', 'book_to_bill'],
  book_to_bill: ['order_book', 'order_intake'],
};

/** Three counts, never a fraction. (zzz738) */
// Five counts that ADD UP to the total. "2 confirmed · 0 pending · 1
// contradicted · of 4" left one variable unaccounted for on every card —
// the flat one — and a reader cannot audit a sum that does not sum. (zzz754)
// UNCLEAR is never contradicted and NOT_APPLICABLE is never pending: both are
// taken out of the five verdict counts and reported on their own, so the seven
// still add up to the total and `core_variables` excludes what cannot apply.
// (zzz770)
// ── UNKNOWN ≠ FLAT ≠ CONFIRMED.                                     (zzz771)
// A risk variable nobody mentioned passes its gate by silence (SILENCE_IS_A_PASS)
// and used to be COUNTED as "flat" — the same word the card uses for a figure
// read twice and found unchanged. Silence is zero readings; it is reported on
// its own line (`silent`) and never as flat. A figure read ONCE is a level,
// not "unchanged", so a one-reading flat counts as `stated`.
export interface Tally {
  confirmed: number; pending: number; contradicted: number; stated: number; flat: number;
  unclear: number; not_applicable: number; core_variables: number; total: number;
  /** Risk variables that passed by silence: documents read, nothing found, no reading. (zzz771) */
  silent: number;
}
function tally(vs: Array<{ verdict: string; state?: EvidenceState; readings?: 0 | 1 | 2 }>): Tally {
  const na = vs.filter((c) => c.state === 'NOT_APPLICABLE').length;
  const unclear = vs.filter((c) => c.state === 'UNCLEAR').length;
  const live = vs.filter((c) => c.state !== 'NOT_APPLICABLE' && c.state !== 'UNCLEAR');
  const flats = live.filter((c) => c.verdict === 'flat');
  return {
    confirmed: live.filter((c) => c.verdict === 'improving').length,
    pending: live.filter((c) => c.verdict === 'unknown').length,
    contradicted: live.filter((c) => c.verdict === 'deteriorating').length,
    stated: live.filter((c) => c.verdict === 'stated').length + flats.filter((c) => c.readings === 1).length,
    flat: flats.filter((c) => c.readings == null || c.readings === 2).length,
    silent: flats.filter((c) => c.readings === 0).length,
    unclear, not_applicable: na, core_variables: vs.length - na,
    total: vs.length,
  };
}

/** How many readings stand behind a row: 0 = no row at all (silence), 1 = a
 *  single figure or statement, 2 = a comparison (before → after, a stated
 *  delta, a YoY rate, or an earlier period on file). Only 2 may ever be
 *  printed as "unchanged". (zzz771) */
const readingsOf = (v: StructuralVar | null | undefined, comparison: MetricComparison | null): 0 | 1 | 2 => {
  if (!v) return 0;
  if (v.before != null || v.delta != null || v.reading?.previous || comparison?.previous) return 2;
  return 1;
};

export type ThesisStatus =
  | 'EVIDENCE_INCOMPLETE'
  | 'CONFIRMATION_REQUIRED'
  | 'STRENGTHENING' | 'NEUTRAL' | 'WEAKENING' | 'BROKEN'
  | 'NEGATIVE_EXPECTATION_GAP' | 'POSITIVE_EXPECTATION_GAP';

export interface CheckedVariable {
  key: VarKey;
  label: string;
  weight: 1 | 2 | 3 | 4;
  why: string;
  verdict: VarVerdict;
  before: string | null;
  after: string | null;
  delta: string | null;
  evidence: string;
  /** Present only when this variable's invalidation condition has fired. */
  invalidation: string | null;
  /** Why the variable has no value: nobody read a document, a document was
   *  read and was silent, it cannot apply, or it was mentioned unclearly.
   *  Null when the variable DOES have a value. (zzz723) */
  absence: AbsenceReason | null;
  /** FOUND / NOT_DISCLOSED / NOT_SEARCHED / UNCLEAR / NOT_APPLICABLE /
   *  SOURCE_UNAVAILABLE / RETRIEVAL_FAILED. Never a bare dash. (zzz770) */
  state: EvidenceState;
  /** Readings behind the verdict: 0 none (silence), 1 a level, 2 a comparison.
   *  A `flat` with fewer than 2 is never "unchanged". (zzz771) */
  readings: 0 | 1 | 2;
  /** True when the verdict is the silence pass: a risk variable the documents
   *  read did not mention. It passes its gate; it is never a confirmation and
   *  never "checked, nothing material". (zzz771) */
  silence: boolean;
  /** The specific reason behind UNCLEAR or NOT_APPLICABLE, when known. */
  stateReason: string | null;
  /** The cross-period join for this variable, when the ledger holds one. It is
   *  attached even where the variable has NO current value — a figure that was
   *  disclosed for four quarters and is absent from the fifth is the change
   *  the card most needs to show, and no amount of reading THIS filing finds
   *  it. (zzz758) */
  comparison?: MetricComparison | null;
  /** Other documents read for the same period that state a different value for
   *  this variable. Never resolved silently. (zzz759) */
  conflict?: { value: string; source: string }[] | null;
  unjudged?: string | null;
  /** Where the variable's own evidence came from, and whether it is a fact or
   *  a claim. Null when nothing was extracted for it. (zzz765c) */
  source?: 'grader' | 'filing' | null;
  kind?: string | null;
  /** ACTUAL / MANAGEMENT_STATEMENT / GUIDANCE / TARGET / HISTORICAL. (zzz765) */
  statement?: StructuralVar['statement'] | null;
  plan?: StructuralVar['plan'] | null;
  asOf?: string | null;
  sourceLabel?: string | null;
  quote?: string | null;
  context?: StructuralVar['context'] | null;
  retyped?: string | null;
}

/** ── zzz771 CONTRACT (PC-2 fills, PC-3 renders) ───────────────────────────
 *  Three separate questions, never collapsed into one label:
 *   1. Did a break trigger fire?          → breakTrigger
 *   2. Which way is the thesis moving?    → direction
 *   3. Has the mechanism been checked?    → evidence
 *  "No thesis action triggered" is answer 1; it never implies answer 2. */
export interface ThesisVerdict {
  breakTrigger: { fired: boolean; conditions: string[]; text: string };
  direction: 'STRENGTHENING' | 'WEAKENING' | 'UNCHANGED' | 'UNKNOWN';
  directionWhy: string;
  evidence: 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'NOT_CONTRADICTED' | 'CONTRADICTED' | 'INCOMPLETE' | 'UNCHECKED';
  evidenceWhy: string;
  /** Structural coverage the label rests on: confirmed / applicable core mechanism variables. */
  coverage: { confirmed: number; applicable: number; missing: string[] };
}
export interface ThesisAssessment {
  /** zzz771: the three separated dimensions. Optional until PC-2 fills it. */
  verdict?: ThesisVerdict;
  status: ThesisStatus;
  thesis: Thesis;
  /** Every variable the thesis rests on, disclosed or not. */
  checked: CheckedVariable[];
  /** The invalidation conditions that have actually FIRED, worst first. */
  triggered: Array<{ condition: string; weight: number; evidence: string }>;
  /** The conditions that would end this thesis, ranked — the dynamic
   *  replacement for the old static sentence. */
  invalidationConditions: Array<{ condition: string; weight: number; status: 'ok' | 'watch' | 'fired' | 'unknown' }>;
  /** What to look at next quarter to settle the open questions. */
  nextConfirmation: string[];
  /** ── THE LONGITUDINAL BLOCK.                                    (zzz758) */
  /** Every cross-period comparison that carries a change, worst first. */
  changes: MetricComparison[];
  /** How many of those changes have a STATED cause, and of what kind. A
   *  quarter where four things moved and none has a disclosed reason is a
   *  different quarter from one where three moves are traced to a new plant. */
  causeSummary: { structural: number; temporary: number; unclassified: number; none: number };
  /** Non-null only when the status actually differs from the previous read. */
  statusChangeReason: string | null;
  /** Reporting periods on file. Depth 1 means every figure is a first
   *  observation and no comparison was possible for an honest reason. */
  historyDepth: number;
  /** One line stating why the status is what it is. */
  because: string;
  /** Deteriorations in variables that are NOT part of this thesis's own
   *  mechanism — shown, loudly, but not allowed to set the status. EXICOM's
   *  cash conversion at 0.32× is a fact worth a red line on the card; it is
   *  not, on its own, evidence that an unclassified thesis is weakening
   *  when no document has been read. (zzz738) */
  financialWarning: Array<{ label: string; value: string; note?: string }>;
  /** ── THE THESIS LOGIC CHAIN, FROM EVIDENCE ONLY.               (zzz770)
   *  OBSERVATION → CAUSE → STRUCTURAL / TEMPORARY → THESIS IMPACT → FORWARD.
   *  A step the evidence does not establish says "not established". */
  logicChain: Array<{ step: 'OBSERVATION' | 'CAUSE' | 'STRUCTURAL / TEMPORARY' | 'THESIS IMPACT' | 'FORWARD'; text: string; established: boolean }>;
  /** Core mechanism variables that are unknown (not disclosed / not searched)
   *  with no substitute driver evidenced — the gap that keeps green away. */
  coreMechanismGaps: string[];
  /** How much of the thesis could be checked at all. */
  coverage: {
    checked: number; disclosed: number; corePossible: number; coreDisclosed: number;
    // ── THE EVIDENCE MATRIX, THESIS-SPECIFIC.                     (zzz727)
    //
    // "Core variables checked: 2/3" read as though the thesis were almost
    // fully examined. It was not: GOLDIAM's operating-inflection thesis
    // depends on revenue, volume, price/mix, operating leverage, margin,
    // capacity, utilisation, demand and capex — and the denominator counted
    // three. A fraction whose denominator is a generic model of a thesis
    // flatters every holding on the page.
    //
    // The denominator is now the THESIS-CRITICAL set: every variable this
    // particular ledger weights 3 or 4. And it is reported as three counts
    // rather than a fraction, because "2 confirmed, 5 pending, 0
    // contradicted" cannot be misread as progress towards completion.
    criticalTotal: number;
    criticalConfirmed: number;
    criticalPending: number;
    criticalContradicted: number;
    // ── OUTPUT ≠ MECHANISM ≠ FORWARD.                            (zzz738)
    //
    // "4 confirmed · 1 pending" on AARTIPHARM counted revenue, margin,
    // earnings and cash conversion as four confirmations while capacity,
    // order book, capex, customers and guidance were all unread. Those four
    // are the OUTPUT of a thesis. They confirm that the quarter was good;
    // they confirm nothing about why, and "why" is the thesis. The counts
    // are now kept apart so a good print can never read as a proven
    // mechanism.
    output: Tally;
    mechanism: Tally;
    forward: Tally;
    /** Core variables disclosed as a LEVEL only — read, recorded, and not
     *  yet a direction. Named separately from missingCore because "the
     *  company told you and there is nothing to compare it to" and "nobody
     *  looked" are different states. (zzz755) */
    levelOnlyCore: string[];
    /** Core variables shown but deliberately not judged, with the reason. */
    unjudgedCore: string[];
    /** The core variables NOT yet checked, by name. The owner asked for this
     *  exactly: "6/10 core variables checked. Missing: utilisation, capex,
     *  new capacity, order book" — not a bare "evidence incomplete". */
    missingCore: string[];
    /** Of the missing ones, those that can ONLY ever come from a filing. Named
     *  separately because "read the filing" is actionable and "the company did
     *  not disclose it" is not. */
    missingNeedsFiling: string[];
  };
  /** The action the OWNER takes. Never a trade. */
  action:
    | 'EVIDENCE INCOMPLETE' | 'CONFIRMATION REQUIRED' | 'EVIDENCE INCOMPLETE — RESULTS FIGURES NOT ON FILE'
    | 'THESIS STRENGTHENING' | 'NO MATERIAL CHANGE'
    | 'THESIS WEAKENING — REVIEW EVIDENCE' | 'THESIS BROKEN — EXIT REVIEW'
    | 'RUNNING BEHIND PLAN — RE-UNDERWRITE'
    | 'RUNNING AHEAD OF PLAN — RE-UNDERWRITE';
  /** Per required dimension: has the mechanism been established there? */
  dimensions: Array<{ dimension: VarDimension; label: string;
    state: 'confirmed' | 'contradicted' | 'unestablished'; by: string[] }>;
  /** Each link of the thesis mechanism, and whether the evidence confirms it.
   *  The spec's "OPERATING LEVERAGE CONFIRMED", rather than "earnings beat". */
  mechanismCheck: Array<{ link: string; state: 'confirmed' | 'contradicted' | 'unchecked' | 'unclear' }>;
  mechanismVerdict: string;
  /** ── STRUCTURAL vs OUTPUT, as the status sentence states them. (zzz765c)
   *  `confirmed/total` is the X/Y printed on the card; `required` are the
   *  structural variables the ledger weights 3+, every one of which must be
   *  confirmed from its OWN evidence before STRENGTHENING is available. */
  structural: {
    confirmed: number; total: number;
    confirmedLabels: string[]; required: string[]; missingRequired: string[];
    gatePassed: boolean;
  };
  /** Revenue / earnings / margin in one line, e.g. "revenue +27.2% · earnings +33.2% · margin +3.0pp". */
  outputSummary: string;
  /** One sentence naming the status the way the owner asked for it. */
  headline: string;
  /** `${action} — ${because}`: the line the card prints. */
  actionLine: string;
}

// ── THIS IS AN EVIDENCE ENGINE, NOT A PORTFOLIO ENGINE.            (zzz723)
//
// "Hold — no action" and "Watch" were portfolio instructions wearing the
// clothes of an evidence verdict, and the owner was right to want them gone:
// this module has no idea what he paid, what weight the position is, or what
// else he owns. It knows what the evidence says about the thesis. The decision
// stays with him, so the labels now describe the EVIDENCE state and nothing
// more.
// Every action opens with its status's own label. (zzz770)
const ACTION: Record<ThesisStatus, ThesisAssessment['action']> = {
  EVIDENCE_INCOMPLETE: 'EVIDENCE INCOMPLETE',
  CONFIRMATION_REQUIRED: 'CONFIRMATION REQUIRED',
  STRENGTHENING: 'THESIS STRENGTHENING',
  NEUTRAL: 'NO MATERIAL CHANGE',
  WEAKENING: 'THESIS WEAKENING — REVIEW EVIDENCE',
  BROKEN: 'THESIS BROKEN — EXIT REVIEW',
  NEGATIVE_EXPECTATION_GAP: 'RUNNING BEHIND PLAN — RE-UNDERWRITE',
  POSITIVE_EXPECTATION_GAP: 'RUNNING AHEAD OF PLAN — RE-UNDERWRITE',
};

export const STATUS_META: Record<ThesisStatus, { label: string; color: string; dot: string; meaning: string }> = {
  EVIDENCE_INCOMPLETE: { label: 'EVIDENCE INCOMPLETE', color: '#64748B', dot: '○',
    meaning: 'Required thesis variables remain unreviewed. This is unknown, not bad — it is not evidence of deterioration.' },
  STRENGTHENING: { label: 'THESIS STRENGTHENING', color: '#10B981', dot: '🟢',
    meaning: 'Structural mechanism confirmed and financial evidence supports it. No separate invalidation trigger is present.' },
  NEUTRAL: { label: 'NO MATERIAL CHANGE', color: '#94A3B8', dot: '⚪',
    meaning: 'Every thesis-critical variable was reviewed and none moved materially. Not the same as "nothing negative found".' },
  WEAKENING: { label: 'THESIS WEAKENING', color: '#F59E0B', dot: '🟠',
    meaning: 'Important evidence deteriorated. This is a prompt to look, not to sell.' },
  BROKEN: { label: 'THESIS BROKEN', color: '#EF4444', dot: '🔴',
    meaning: 'A core assumption behind owning this has been invalidated by the evidence.' },
  CONFIRMATION_REQUIRED: { label: 'CONFIRMATION REQUIRED', color: '#FBBF24', dot: '🟡',
    meaning: 'Financial output improved, but the structural cause has not yet been established. Good results are the RESULT of a thesis, never proof that it is intact.' },
  NEGATIVE_EXPECTATION_GAP: { label: 'RUNNING BEHIND PLAN', color: '#C084FC', dot: '🟣',
    meaning: 'The actual result materially TRAILS a figure management itself documented earlier. Reached only by comparing plan against actual — never from weak growth, because a company can shrink and still beat what it promised.' },
  POSITIVE_EXPECTATION_GAP: { label: 'RUNNING AHEAD OF PLAN', color: '#818CF8', dot: '🟣',
    meaning: 'The actual result materially EXCEEDS a figure management itself documented earlier. Never reached from strong growth alone — a company can grow 40% and still miss what it told you.' },
};

const SIGN: Record<VarVerdict, number> = { improving: 1, flat: 0, deteriorating: -1, stated: 0, unknown: 0 };

export interface AssessInput {
  pattern: AbfgPattern | null | undefined;
  variables: StructuralVar[];
  /** From guidance-ledger: a promise made earlier that this quarter can be
   *  checked against. Absent on the first quarter a holding is tracked. */
  /** ── AHEAD/BEHIND IS A COMPARISON, NEVER A MOOD.               (zzz727)
   *
   *  These two states may be reached ONLY by comparing an actual result to a
   *  figure management previously documented. Strong growth is not "ahead of
   *  plan" — a company can grow 40% and still miss what it told you, and a
   *  company can shrink and still beat it. So the comparison itself travels:
   *  plan, actual and variance are required and are printed on the card. A
   *  gap with no plan and actual attached is discarded by assessThesis. */
  promiseGap?: {
    gap: boolean; detail: string; direction?: 'behind' | 'ahead';
    plan?: string | null; actual?: string | null; variance?: string | null;
  } | null;
  /** True once an evidence document (filing, concall, announcement) has
   *  actually been read for this holding. NO MATERIAL CHANGE is not available
   *  before this: "nothing changed" and "nothing was read" are different
   *  statements and the page must never print the first when it means the
   *  second. (zzz723) */
  evidenceReviewed?: boolean;
  /** The last retrieval attempt could not reach the sources. (zzz765) */
  sourceUnavailable?: boolean;
  /** True when a graded or screener row exists for this company. Without one,
   *  revenue growth / earnings / margin / cash conversion / ROCE can never be
   *  filled by reading a filing, and the card must say so instead of asking
   *  for another read. (zzz757) */
  hasGraderRow?: boolean;
  /** Cross-period comparisons built from the evidence ledger. (zzz758) */
  comparisons?: Partial<Record<VarKey, MetricComparison>> | null;
  /** How many reporting periods the ledger holds. One means every variable is
   *  a first observation and the card must say so rather than implying that
   *  levels without directions are the company's fault. (zzz758) */
  historyDepth?: number;
  /** The status this holding carried at the previous read, so a change of
   *  status can be explained rather than silently replaced. (zzz758) */
  previousStatus?: { status: string; period: string } | null;
  /** The newest period the ledger holds evidence for, and the newest period
   *  every listed company should have published by now. When the first is
   *  more than two quarters behind the second, the drivers on file describe
   *  a business as it was, and cannot confirm the mechanism today. (zzz769) */
  evidencePeriod?: string | null;
  expectedPeriod?: string | null;
  /** Sector / industry / the company's own descriptive text, used ONLY to mark
   *  physical-capacity variables NOT_APPLICABLE for a services, software or
   *  financial business. Conservative; absent means nothing is N/A. (zzz770) */
  business?: BusinessProfile | null;
  /** The last discovery ended RETRIEVAL_FAILED. (zzz770) */
  retrievalFailed?: boolean;
}

/** Whole quarters between two period labels ("Q4 FY24" → "Q1 FY27" = 9), or
 *  null when either cannot be read. (zzz769) */
export function quartersBehind(evidence: string | null | undefined, expected: string | null | undefined): number | null {
  const a = periodEnd(evidence), b = periodEnd(expected);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / (91.3 * 86_400_000));
}
/** Evidence older than this many quarters cannot confirm a mechanism. */
export const STALE_EVIDENCE_QUARTERS = 2;

/** "THESIS WEAKENING — thesis-critical …": the sentence after the dash is not
 *  a new sentence. Leaves acronyms and figures alone. */
/** A margin move smaller than this is shown, never a status mover. (zzz770) */
export const MARGIN_MATERIAL_PP = 3;
const isMaterialDown = (c: { key: VarKey; verdict: string; delta: string | null; after: string | null }): boolean => {
  if (c.verdict !== 'deteriorating') return false;
  if (c.key !== 'margin') return true;
  const m = String(c.delta ?? '').match(/[-−]?\d+(?:\.\d+)?(?=\s*pp)/);
  if (!m) return true;
  return Math.abs(Number(m[0].replace('−', '-'))) >= MARGIN_MATERIAL_PP;
};
const lcFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
/** "Unchanged" needs a comparison. A risk variable (silence passes) may be
 *  silent or denied ("no customer losses") — that is the check passing, not
 *  a reading — every other flat needs two readings. (zzz771) */
const flatOnTwoReadings = (c: CheckedVariable): boolean =>
  c.verdict === 'flat' && (c.readings === 2 || SILENCE_IS_A_PASS.has(c.key));

export function assessThesis(input: AssessInput): ThesisAssessment {
  const thesis = thesisFor(input.pattern);
  const found = byKey(input.variables);
  const comps = input.comparisons || {};

  const graderMissing = input.hasGraderRow === false;
  const cashCritical = cashIsThesisCritical(thesis.pattern);
  // Physical capacity cannot apply to a services / software / financial
  // business: N/A, never pending. A figure that WAS disclosed is kept. (zzz770)
  const servicesBusiness = isServicesBusiness(input.business);
  const checked: CheckedVariable[] = thesis.variables.map((tv: ThesisVariable) => {
    let v = found[tv.key];
    // ── A NEGATIVE CASH RATIO IS UNCLEAR, NOT A VERDICT.           (zzz770)
    // The grader's CFO/PAT is last full year's ratio; its sign can come from
    // either side, and the quarter's profit cannot settle which. LLOYDSENGG
    // read "✕ −1.28×" against its thesis. It is shown, marked validation
    // required, and counted neither way. A same-period filing figure with a
    // positive profit (cash < 0 / profit > 0) is not ambiguous and is kept.
    if (v && v.key === 'cash_conversion' && v.source === 'grader' && isNegativeRatio(v.after)) {
      v = { ...v, verdict: 'stated', unjudged: NEGATIVE_CASH_UNCLEAR };
    } else if (v && v.unjudged && v.verdict === 'unknown' && v.after) {
      // Read and deliberately not judged: a disclosed value, UNCLEAR. (zzz770)
      v = { ...v, verdict: 'stated' };
    }
    const notApplicable = !v && servicesBusiness && PHYSICAL_CAPACITY_VARS.has(tv.key);
    // ── SILENCE ON A RISK IS A CHECK THAT PASSED.                  (zzz757)
    //
    // Three documents read and no one-off found is the forensic test
    // passing, not a gap in the evidence. Recorded as flat: checked, and
    // nothing found. Never improving — absence is not a positive finding.
    // The row's own (guarded) comparison when it has a row; the raw join only
    // for a variable with no current row (NOT_DISCLOSED). VADILALIND's chip
    // printed "150,000 → 380,000 · FLAT" from an unguarded comparison of a
    // different plant. (zzz765)
    const comparison = v ? (v.comparison ?? null) : (comps[tv.key] || null);
    // ── A VARIABLE THAT STOPPED BEING DISCLOSED IS NOT SILENCE.    (zzz758)
    //
    // The pass-on-silence rule was written for risks nobody mentioned. It must
    // not absolve a company that disclosed a figure for four quarters and has
    // now gone quiet on it — that is a disclosure DECISION, and the card says
    // so with the last known value beside it.
    const stoppedDisclosing = !v && comparison?.change_type === 'NOT_DISCLOSED';
    const silencePasses = !v && !notApplicable && !stoppedDisclosing && !!input.evidenceReviewed && SILENCE_IS_A_PASS.has(tv.key);
    // A variable the company did not disclose is UNKNOWN, never deteriorating.
    const verdict: VarVerdict = v ? v.verdict : silencePasses ? 'flat' : 'unknown';
    const fired = !!tv.invalidatedWhen && verdict === 'deteriorating';
    return {
      // An undisclosed variable has no extracted row, so `v` is null and the
      // label used to fall back to the raw KEY — the page printed
      // "○ one_offs" and "○ cash_conversion" next to properly-named ones.
      // VAR_LABEL is the single source of the human name. (zzz719)
      key: tv.key, label: v?.label || VAR_LABEL[tv.key] || tv.key, weight: tv.weight, why: tv.why,
      verdict,
      before: v?.before ?? null, after: v?.after ?? null, delta: v?.delta ?? null,
      comparison,
      conflict: v?.conflict ?? null,
      unjudged: v?.unjudged ?? null,
      source: v?.source ?? null,
      kind: v?.kind ?? null,
      statement: v?.statement ?? null,
      plan: v?.plan ?? null,
      asOf: v?.asOf ?? null,
      sourceLabel: v?.sourceLabel ?? null,
      quote: v?.quote ?? null,
      context: v?.context ?? null,
      retyped: v?.retyped ?? null,
      evidence: v?.evidence || (notApplicable
        ? 'Not applicable: this is a services / software / financial business, so there is no physical capacity or plant to fill. Never counted as pending.'
        : stoppedDisclosing
        ? `${comparison!.previous?.raw} in ${comparison!.previous_period}, and not disclosed in ${comparison!.current_period}. `
          + 'The figure was on file and has stopped being published. That is a decision, not an oversight, '
          + 'and it is recorded here rather than counted as a pass.'
        : silencePasses
        ? `The documents read disclose no ${(VAR_LABEL[tv.key] || tv.key).toLowerCase()}. For this variable that is the check passing: the condition "${tv.invalidatedWhen || 'it would have been disclosed'}" did not fire on anything that was read.`
        : graderMissing && GRADER_AVAILABLE.has(tv.key) && input.evidenceReviewed
          ? 'This company has no graded or screener row on file, and none of the documents read prints the figure on its results page. A results filing that states it — or a graded row — will fill this; a transcript alone will not.'
          : input.evidenceReviewed
            ? 'A document was read and is silent on this. Absence is evidence — a company that stops disclosing a figure has told you something — but it is never counted against the thesis.'
            : 'No evidence document has been read for this holding yet.'),
      invalidation: fired ? tv.invalidatedWhen : null,
      state: 'FOUND' as EvidenceState, stateReason: (v?.unjudged ?? null) as string | null,
      readings: readingsOf(v, comparison), silence: silencePasses,
      // The four absences are different facts and only one of them is fixable
      // by pressing a button. A grader-available variable that is still blank
      // after the row was loaded means the source simply did not carry it.
      absence: v || silencePasses ? null
        : notApplicable ? 'not_applicable'
        // A fetch that failed is not a company that was silent. (zzz765)
        : input.sourceUnavailable && !input.evidenceReviewed ? 'source_unavailable'
        : graderMissing && GRADER_AVAILABLE.has(tv.key) && input.evidenceReviewed ? 'no_grader_row'
          : input.evidenceReviewed ? 'not_disclosed'
            : GRADER_AVAILABLE.has(tv.key) ? 'not_disclosed' : 'not_read',
    };
  });
  // ── THE EVIDENCE STATE OF EVERY VARIABLE.                        (zzz770)
  for (const c of checked) {
    if (c.verdict !== 'unknown') {
      c.state = c.unjudged ? 'UNCLEAR' : 'FOUND';
      c.stateReason = c.unjudged ?? null;
    } else {
      c.state = stateOfAbsence(c.absence, !!input.retrievalFailed);
      c.stateReason = c.state === 'NOT_APPLICABLE' ? 'services / software / financial business — no physical capacity to fill'
        : c.absence === 'no_grader_row' ? 'no graded or screener row on file, and no document read prints it'
          : c.comparison?.change_type === 'NOT_DISCLOSED' && c.comparison.previous
            ? `was ${c.comparison.previous.raw} in ${c.comparison.previous_period}; not disclosed since` : null;
    }
  }
  // What cannot apply is never part of the thesis being judged. (zzz770)
  const applicable = checked.filter((c) => c.state !== 'NOT_APPLICABLE');

  // Silence is not a disclosure: a risk variable nobody mentioned "carried
  // evidence" on the old count, so a card with one real row and two silent
  // risks read "3 of 13 variables could be read". (zzz771)
  const disclosed = checked.filter((c) => c.verdict !== 'unknown' && !c.silence);
  // Thesis-critical = everything this ledger weights 3 or 4. The denominator
  // of the evidence matrix, and the only honest answer to "how much of this
  // thesis has been examined". The tallies keep N/A visible (counted apart);
  // the judgement runs on what can apply. (zzz770)
  const criticalAll = checked.filter((c) => c.weight >= 3);
  const critical = applicable.filter((c) => c.weight >= 3);
  const core = applicable.filter((c) => c.weight === 4);
  const coreDisclosed = core.filter((c) => c.verdict !== 'unknown');
  const coreUp = coreDisclosed.filter((c) => c.verdict === 'improving');
  // ── DISCLOSED IS NOT JUDGED.                                     (zzz755)
  //
  // zzz754 introduced STATED so a figure the company published would stop
  // rendering as an absence. It then let STATED satisfy "this core variable
  // has been checked", and the green count went from 3 to 43 in one deploy:
  // AETHER reached THESIS STRENGTHENING with utilisation shown as a bare
  // 74%, order book absent, capex absent and guidance a management range.
  // A level with nothing to compare it against confirms nothing — it is
  // exactly the state the page exists to make visible. Green needs every
  // core variable to have MOVED in a direction the evidence supports.
  const coreJudged = coreDisclosed.filter((c) => c.verdict !== 'stated');
  const coreLevelOnly = coreDisclosed.filter((c) => c.verdict === 'stated');

  // ── WHICH DETERIORATIONS ARE ALLOWED TO MOVE THE STATUS.       (zzz738)
  //
  // A variable can drive WEAKENING or BROKEN only when it belongs to a
  // dimension THIS thesis says it rests on. For F · PROFIT JUMP, cash
  // conversion is the forensic test itself and counts. For an UNCLASSIFIED
  // holding with no document read, the same figure is a financial warning
  // and nothing more — the ledger has no thesis to weaken yet, and a status
  // that says "weakening" on a thesis nobody has stated is a verdict without
  // a subject. Once a document has been read, the ledger has been examined
  // and the same deterioration may set the status.
  const requiredDims = new Set(thesis.requiresConfirmationIn);
  const mayMoveStatus = (c: { key: VarKey }) =>
    requiredDims.has(VAR_DIMENSION[c.key])
    && (c.key !== 'cash_conversion' || cashCritical)
    && (input.evidenceReviewed === true || thesis.pattern !== 'UNCLASSIFIED');
  const coreDown = coreDisclosed.filter((c) => c.verdict === 'deteriorating' && mayMoveStatus(c));
  const supportDown = checked.filter((c) => c.weight === 3 && c.verdict === 'deteriorating' && mayMoveStatus(c));
  // ── CASH IS CORE ONLY WHERE THE LEDGER SAYS SO.                 (zzz765c)
  //
  // F, G and the unclassified ledger weight cash conversion 4: there a bad
  // reading may move the status, to WEAKENING at most. A and B weight it 2 —
  // context, shown as a warning so it is never hidden, and never a mover.
  // ── CASH IS THESIS-CRITICAL ONLY FOR F AND G.                    (zzz770)
  // The owner's rule. The unclassified ledger weighted it 4 and CUPID /
  // LLOYDSENGG sat at WEAKENING on one annual screener ratio. Elsewhere a weak
  // reading is a FINANCIAL WARNING: shown in red, never a status mover.
  const financialWarning = checked
    .filter((c) => c.verdict === 'deteriorating'
      && ((c.weight >= 3 && !mayMoveStatus(c)) || (c.key === 'cash_conversion' && !cashCritical)))
    .map((c) => ({ label: c.label, value: c.delta || c.after || 'deteriorating',
      note: c.key === 'cash_conversion' && !cashCritical
        ? `cash conversion is not thesis-critical for ${thesis.pattern === 'UNCLASSIFIED' ? 'a holding with no classified strategy' : `strategy ${thesis.pattern}`} — shown as a warning, status unchanged`
        : 'not part of this thesis\'s required evidence — shown as a warning, status unchanged' }));
  const guidanceDown = checked.some((c) => c.key === 'guidance' && c.verdict === 'deteriorating');

  const weighted = checked.reduce((a, c) => a + SIGN[c.verdict] * c.weight, 0);

  // ── HAS THE MECHANISM BEEN ESTABLISHED, DIMENSION BY DIMENSION? (zzz723)
  //
  // A dimension is CONFIRMED when at least one of its variables improved,
  // CONTRADICTED when one deteriorated and none improved, and UNESTABLISHED
  // when nobody has looked. Financial output being confirmed says the quarter
  // was good; it says nothing about why, and "why" is the thesis.
  const dimensions = thesis.requiresConfirmationIn.map((dim) => {
    const inDim = checked.filter((c) => VAR_DIMENSION[c.key] === dim);
    const up = inDim.filter((c) => c.verdict === 'improving');
    const down = inDim.filter((c) => c.verdict === 'deteriorating');
    const state: 'confirmed' | 'contradicted' | 'unestablished' =
      up.length ? 'confirmed' : down.length ? 'contradicted' : 'unestablished';
    return {
      dimension: dim, label: DIMENSION_LABEL[dim], state,
      by: (up.length ? up : down).map((c) => c.label),
    };
  });
  const unestablished = dimensions.filter((d) => d.state === 'unestablished');
  const allDimsConfirmed = dimensions.every((d) => d.state === 'confirmed');

  // Any supporting-or-better variable moving the wrong way is a reason to
  // look, whatever else is fine. JINDRILL read "NO MATERIAL CHANGE" with
  // earnings −28.7% on the same card, which is not a defensible sentence.
  const anyMaterialDown = checked.some((c) => c.weight >= 3 && c.verdict === 'deteriorating' && mayMoveStatus(c));

  // ── STRUCTURAL MECHANISM, FROM EACH VARIABLE'S OWN EVIDENCE.    (zzz765c)
  //
  // A structural variable is confirmed only by its own row: a fact (never a
  // management claim) that improved. Financial output can never stand in for
  // one. The single exception is a risk variable whose silence is a pass —
  // three documents read and no material one-off is the F forensic check
  // clearing, and it counts as cleared, never as improving.
  const structuralKeys = new Set<VarKey>(STRATEGY_STRUCTURAL[thesis.pattern] || []);
  const structuralVars = applicable.filter((c) => structuralKeys.has(c.key)
    && !isFinancialOutput(c.key, c.source));
  // The silence pass is SILENCE: a one-off that WAS disclosed (MOREPENLAB's
  // ₹25.83 Cr exceptional item) is not a cleared forensic check. (zzz770)
  //
  // ── PASSING A GATE IS NOT BEING CONFIRMED.                        (zzz771)
  // Two predicates where there was one. `passesStructuralGate` is the gate
  // test and keeps the silence pass the code has always allowed for a risk
  // variable. `structurallyEvidenced` is what may be COUNTED and PRINTED as
  // confirmed: a fact of its own that improved. Silence is neither counted
  // nor printed as "checked, nothing material" — that sentence needs two
  // readings and silence has none.
  const structurallyEvidenced = (c: CheckedVariable): boolean =>
    c.kind !== 'claim' && !isFinancialOutput(c.key, c.source) && c.state !== 'UNCLEAR' && c.verdict === 'improving';
  const passesStructuralGate = (c: CheckedVariable): boolean =>
    structurallyEvidenced(c)
    || (c.kind !== 'claim' && !isFinancialOutput(c.key, c.source) && c.state !== 'UNCLEAR'
      && c.verdict === 'flat' && c.silence && SILENCE_IS_A_PASS.has(c.key) && !!input.evidenceReviewed);
  // Required = what the ledger weights 3+. Grader operating leverage is
  // excluded above, so A's gate is the physical one: utilisation and volume.
  const structuralRequired = structuralVars.filter((c) => c.weight >= 3);
  const structuralConfirmedVars = structuralVars.filter(structurallyEvidenced);
  const missingRequired = structuralRequired.filter((c) => !passesStructuralGate(c));
  // ── THE GATE IS THE X/Y ON THE CARD, NOT JUST THE WEIGHTED ROWS. (zzz771)
  // ANTELOPUS, JAMNAAUTO and NRBBEARING passed the gate on a single annual
  // cash ratio — the unclassified ledger's only weight-3 row — and printed
  // "THESIS STRENGTHENING … Structural evidence reviewed: 1/5". The owner's
  // rule is about that printed ratio: incomplete structural evidence is not
  // a strengthening thesis. So the gate also needs at least half of the
  // structural variables confirmed from their own evidence, and at least one
  // of them must be an operating mechanism — a cash-conversion ratio is a
  // quality check on profit, it does not say WHY the business improved.
  // "Half" is measured on the printed ratio (structural ∪ evidenced drivers)
  // once the drivers are known — see printedHalf below.
  const mechanismBeyondCash = structuralConfirmedVars.some((c) => c.key !== 'cash_conversion');
  const structuralGate = structuralRequired.length > 0 && missingRequired.length === 0
    && structuralConfirmedVars.length > 0 && mechanismBeyondCash;

  // ── OUTPUT, SAID SEPARATELY.                                    (zzz765c)
  const outputRows = OUTPUT_SHORT.map(([k, name]) => ({ k, name, v: found[k] || null }));
  const outputSummary = outputRows
    .filter((r) => r.v && r.v.verdict !== 'unknown' && (r.v.delta || r.v.after))
    .map((r) => `${r.name} ${r.v!.delta || r.v!.after}${r.v!.verdict === 'stated' && !r.v!.delta ? ' (level)' : ''}`)
    .join(' · ') || 'not on file';
  const outputVars = (Object.keys(found) as VarKey[]).filter((k) => VAR_DIMENSION[k] === 'financial').map((k) => found[k]!);
  const outputImproved = outputVars.some((v) => v.verdict === 'improving')
    && !checked.some((c) => c.weight >= 3 && VAR_DIMENSION[c.key] === 'financial' && c.verdict === 'deteriorating');
  const structuralLine = `Structural evidence reviewed: ${structuralConfirmedVars.length}/${structuralVars.length} variables confirmed.`;
  const notEstablished = missingRequired.length
    ? ` Not yet established: ${missingRequired.map((c) => `${c.label.toLowerCase()}${c.state === 'UNCLEAR' ? ' (unclear — validation required)'
      : c.key === 'cash_conversion' && !cashCritical && c.verdict === 'deteriorating' ? ' (weak — shown as a financial warning, not thesis-critical here)'
        : c.verdict === 'stated' ? ' (level only)' : c.verdict === 'unknown' ? ` (${c.state === 'NOT_SEARCHED' ? 'not searched' : 'not disclosed'})` : ` (${c.verdict})`}`).join(', ')}.`
    : '';

  // ── STRUCTURAL DRIVERS, FROM ANY FILING ROW.                     (zzz765)
  //
  // One rule for every name. Green needs a document read, output improving,
  // nothing thesis-critical falling, and at least ONE structural driver the
  // filing itself evidences — a physical or commercial reason for the numbers
  // (utilisation or volume up, capacity added, order book up, capex already
  // earning, working capital improving, or a stated margin driver such as mix
  // or operating leverage). Cash conversion alone is earnings QUALITY, not a
  // mechanism, so it can no longer turn a card green by itself; and a core
  // figure the company does not disclose (or gives only as a target) no
  // longer blocks green when another driver is evidenced — it is listed as
  // what the next quarter must still confirm.
  const DRIVER_KEYS = new Set<VarKey>(['utilisation', 'volume', 'capacity', 'capacity_addition', 'order_book', 'order_intake',
    'book_to_bill', 'new_customer', 'capex_earning', 'working_capital', 'product_mix', 'margin_driver', 'exports',
    'commissioning', 'qualification', 'regulatory_approval', 'price'] as VarKey[]);
  const STRUCTURAL_WORDS = /mix|value[- ]add|premium|operating leverage|utili[sz]|volume|capacity|scale|pric|realis|realiz|efficien|cost (reduction|saving)|procurement|integration|new (plant|product|customer)|export/i;
  const TEMPORARY_ONLY = /one[- ]off|one[- ]time|exceptional|forex|currency|inventory gain|refund|write[- ]?back|reversal|raw material (price )?spike|provision/i;
  const isDriver = (v: StructuralVar): boolean => {
    if (!DRIVER_KEYS.has(v.key) || v.source !== 'filing' || v.kind === 'claim' || v.unjudged) return false;
    if (v.statement && v.statement !== 'ACTUAL') return false;
    if (v.verdict !== 'improving') return false;
    if (v.key === 'margin_driver') {
      const t = `${v.after || ''} ${v.evidence || ''}`;
      return STRUCTURAL_WORDS.test(t) && !(TEMPORARY_ONLY.test(t) && !STRUCTURAL_WORDS.test(t.replace(TEMPORARY_ONLY, '')));
    }
    return true;
  };
  // F · PROFIT JUMP asks WHY PROFIT jumped: only a driver that explains a
  // margin or volume move counts there — an order book or an approval does
  // not explain this quarter's profit.
  // Each strategy counts the drivers that explain ITS mechanism: an approval
  // does not explain an operating inflection, and capacity does not explain
  // a demand explosion.
  const STRATEGY_DRIVERS: Record<string, VarKey[]> = {
    A: ['utilisation', 'volume', 'capacity', 'capacity_addition', 'margin_driver', 'product_mix', 'price', 'capex_earning', 'commissioning', 'working_capital'] as VarKey[],
    B: ['order_book', 'order_intake', 'book_to_bill', 'new_customer', 'qualification', 'regulatory_approval', 'exports', 'capex_earning'] as VarKey[],
    F: ['margin_driver', 'product_mix', 'volume', 'utilisation', 'capacity_addition', 'capex_earning', 'price'] as VarKey[],
    G: ['working_capital', 'margin_driver', 'capex_earning', 'product_mix', 'price', 'volume'] as VarKey[],
  };
  const allowed = STRATEGY_DRIVERS[thesis.pattern] ? new Set<VarKey>(STRATEGY_DRIVERS[thesis.pattern]) : null;
  const drivers = (input.variables || []).filter(isDriver).filter((v) => !allowed || allowed.has(v.key));
  // A company still losing money is not a confirmed thesis, however fast the
  // loss is shrinking (EXICOM: margin −19% → −7%). (zzz765)
  const lossMaking = /^\s*-/.test(String(found.margin?.after || '')) || /^\s*-/.test(String(found.earnings_growth?.after || ''));
  const structuralDown = checked.some((c) => structuralKeys.has(c.key) && c.verdict === 'deteriorating' && mayMoveStatus(c));
  const oneOffsCleared = !found.one_offs || found.one_offs.verdict === 'flat' || !!found.one_offs.unjudged
    || (found.one_offs.verdict === 'stated');
  const cashOk = !found.cash_conversion || found.cash_conversion.verdict !== 'deteriorating';
  // ── A CORE MECHANISM NOBODY HAS SEEN CANNOT BE "CONFIRMED".     (zzz770)
  // GOLDIAM read green on a mix story with capacity utilisation — core to an
  // operating-inflection thesis — never disclosed. A silent core mechanism
  // variable blocks green unless a driver of the SAME mechanism is evidenced
  // (volume or capacity for absorption; intake or book-to-bill for an order
  // book). A disclosed target or level is not silence (MANINDS).
  const coreMechanismGaps = core.filter((c) => {
    const subs = MECH_SUBSTITUTES[c.key];
    if (!subs || isFinancialOutput(c.key, c.source)) return false;
    if (c.state === 'FOUND' || c.state === 'UNCLEAR') return false;
    return !drivers.some((d) => subs.includes(d.key)) && !structuralConfirmedVars.some((x) => subs.includes(x.key));
  });
  // ── STRICT GREEN.                                                  (zzz771)
  //
  // One evidenced driver was enough for green, which is how EMCURE, E2E, AZAD
  // and MANINDS printed "THESIS STRENGTHENING … 1/5 confirmed". The owner's
  // verdict: incomplete structural evidence ≠ strengthening thesis. Green now
  // needs the strategy's structural gate passed, OR at least two DISTINCT
  // evidenced drivers of that strategy's mechanism together with at least
  // half of the APPLICABLE core mechanism variables confirmed from their own
  // evidence (N/A and financial-output variables are outside the
  // denominator; silence and levels are outside the numerator). Everything
  // that used to be green on one driver is CONFIRMATION REQUIRED, and says
  // exactly what is confirmed and what is still open.
  const coreMechanism = core.filter((c) => !isFinancialOutput(c.key, c.source));
  // Cash conversion is thesis-critical only for F/G (spec §4): elsewhere it is a
  // quality check on profit, not a mechanism, so it neither fills nor blocks
  // the two-driver coverage test (INNOVACAP: 5/9 evidenced, blocked only by a
  // single annual cash ratio). (zzz771)
  const coreForCoverage = cashCritical ? coreMechanism : coreMechanism.filter((c) => c.key !== 'cash_conversion');
  const coreMechanismConfirmed = coreMechanism.filter(structurallyEvidenced);
  const distinctDrivers = new Set<VarKey>(drivers.map((d) => d.key));
  const coreCoverageOk = coreForCoverage.filter(structurallyEvidenced).length * 2 >= coreForCoverage.length;
  // ── ONE RATIO: THE ONE THE CARD PRINTS.                          (zzz771)
  // The card reads "Structural evidence reviewed: x/y" over the strategy's
  // structural variables plus any evidenced driver. The gate, the verdict and
  // the coverage chip all use that same x/y, so a card can never say 1/5 above
  // a green label, nor "1/1 confirmed" beside "4/7".
  const printedKeys = new Set<VarKey>([...structuralVars.map((c) => c.key), ...drivers.map((d) => d.key)]);
  const printedConfirmed = new Set<VarKey>([...structuralConfirmedVars.map((c) => c.key), ...drivers.map((d) => d.key)]);
  const printedHalf = printedKeys.size > 0 && printedConfirmed.size * 2 >= printedKeys.size
    && [...printedConfirmed].some((k) => k !== 'cash_conversion');
  const strictGreen = printedHalf && (structuralGate || (distinctDrivers.size >= 2 && coreCoverageOk));
  const outputOnlyPositive = !!input.evidenceReviewed && outputImproved && !anyMaterialDown && !structuralDown
    && drivers.length >= 1 && !lossMaking && (thesis.pattern !== 'F' || (oneOffsCleared && cashOk))
    && coreMechanismGaps.length === 0;
  const greenByDrivers = outputOnlyPositive && strictGreen;
  /** VAR_LABEL is the single source of the human name (zzz719); a row's own
   *  label is the fallback only. (zzz771) */
  const nm = (c: { key: VarKey; label: string }): string => VAR_LABEL[c.key] || c.label;
  /** The state of an unconfirmed variable, in words the card can print. */
  const openState = (c: CheckedVariable): string =>
    c.state === 'UNCLEAR' ? `unclear — validation required: ${c.after || c.before}`
      : c.state === 'NOT_APPLICABLE' ? 'not applicable'
      : c.verdict === 'unknown' ? (c.state === 'NOT_SEARCHED' ? 'not searched' : 'not disclosed')
      : c.verdict === 'stated' ? `${(c as any).statement === 'TARGET' || (c as any).statement === 'GUIDANCE' ? 'target only' : 'level only'}: ${c.after || c.before}`
      : c.verdict === 'flat' && c.silence ? 'not mentioned in the documents read — silence, not a reading'
      : c.verdict === 'flat' && c.readings < 2 ? `single reading: ${c.after || c.before}`
      : c.verdict === 'flat' ? `unchanged: ${c.before && c.after ? `${c.before} → ${c.after}` : c.after || c.before || c.delta}`
      : c.kind === 'claim' ? `management statement, not a filed figure: ${c.after || c.before}`
      : c.verdict;
  const stillToConfirm = core.filter((c) => !isFinancialOutput(c.key, c.source)
    && c.verdict !== 'improving' && !(c.verdict === 'flat' && SILENCE_IS_A_PASS.has(c.key)))
    .map((c) => `${nm(c).toLowerCase()} (${openState(c)})`);
  const driverText = (v: StructuralVar) => {
    const val = v.delta && v.before ? `${v.before} → ${v.after} (${v.delta})` : (v.after || '');
    const label = v.key === 'capex_earning' ? 'capex earning' : v.label.toLowerCase();
    if (val && val.length <= 60) return `${label} ${val}`;
    // The clause of a long statement that names the mechanism, never a
    // bare "(stated in the filing)". (zzz770)
    const clauses = String(val).split(/[;.]\s+/).map((x) => x.trim()).filter(Boolean);
    const pick = clauses.find((x) => STRUCTURAL_WORDS.test(x) && !TEMPORARY_ONLY.test(x)) || clauses[0] || '';
    return pick ? `${label}: ${pick.length > 90 ? `${pick.slice(0, 89)}…` : pick}` : `${label} (stated in the filing)`;
  };

  // ── THE STATUS LADDER, most severe first. ──────────────────────────────
  let status: ThesisStatus;
  let because: string;

  // ── BROKEN REQUIRES A NAMED CONDITION TO HAVE FIRED.            (zzz727)
  //
  // The old rule was arithmetic — two core variables down, or one plus weak
  // guidance — and produced EXICOM as "THESIS BROKEN" on the sentence "cash
  // conversion deteriorated with 2 supporting variables down". That is a
  // reason to investigate. It is not the thesis-break condition this ledger
  // WROTE DOWN, and a red status that cannot name the condition it met is not
  // auditable. A weak quarter is not a broken thesis; that distinction is the
  // entire reason this page exists.
  //
  // So BROKEN now requires that a CORE variable's own stated invalidation
  // condition has fired, and the card prints that condition verbatim. The
  // arithmetic cases that used to reach red now reach WEAKENING, which is
  // what they always were.
  const coreTriggered = checked.filter((c) => c.weight === 4 && c.invalidation && mayMoveStatus(c));
  // ── ONE CASH READING IS A REVIEW, NEVER A BREAK.                 (zzz765c)
  //
  // Every cash condition in the ledger is written over time ("for two
  // quarters"), and the figure on file is a single reading — often last full
  // year's screener ratio sitting on this quarter's card. TI (PAT −30%, CFO
  // negative) must read WEAKENING: the cash condition counts towards review,
  // never towards the break arithmetic.
  const breakTriggered = coreTriggered.filter((c) => c.key !== 'cash_conversion');
  if (breakTriggered.length >= 2 || (breakTriggered.length === 1 && guidanceDown)) {
    status = 'BROKEN';
    because = `Thesis-break condition met — ${breakTriggered.map((c) => `"${c.invalidation}"`).join(' AND ')}`
      + `${guidanceDown && breakTriggered.length === 1 ? ', alongside management reducing its own forward expectations' : ''}. `
      + `Evidence: ${breakTriggered.map((c) => `${c.label} ${c.delta || c.after || 'down'}`).join('; ')}.`;
  } else if (input.promiseGap?.gap && input.promiseGap.plan && input.promiseGap.actual) {
    // Ranked BELOW a break and ABOVE weakening: a company can be delivering
    // fine in absolute terms while missing what it told you, and that is a
    // different problem needing a different response.
    status = input.promiseGap.direction === 'ahead'
      ? 'POSITIVE_EXPECTATION_GAP' : 'NEGATIVE_EXPECTATION_GAP';
    because = `Plan: ${input.promiseGap.plan} · Actual: ${input.promiseGap.actual}`
      + `${input.promiseGap.variance ? ` · Variance: ${input.promiseGap.variance}` : ''}. `
      + input.promiseGap.detail;
  } else if (coreDown.length >= 1 || supportDown.length >= 2 || supportDown.some(isMaterialDown)) {
    status = 'WEAKENING';
    const downAll = checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating' && mayMoveStatus(c));
    // ── SAY PRECISELY WHAT IS WEAKENING, AND WHAT IS NOT.          (zzz770)
    // MOREPENLAB: earnings +409%, margin up, no mechanism confirmed, cash
    // 0.34×. For a profit jump cash conversion IS the forensic test, so the
    // status stays WEAKENING — but the card must not read as thesis failure.
    const onlyCash = downAll.length > 0 && downAll.every((c) => c.key === 'cash_conversion');
    const cashRow = downAll.find((c) => c.key === 'cash_conversion');
    because = (onlyCash && outputImproved
      ? `Financial output improved (${outputSummary}), but the structural mechanism is not established `
        + `(${structuralConfirmedVars.length} of ${structuralVars.length} structural variables confirmed) — this is not thesis failure. `
        + `WEAKENING because cash conversion, thesis-critical for ${thesis.pattern === 'F' ? 'a profit jump (the forensic test)' : 'this strategy'}, reads ${cashRow!.after || cashRow!.delta}: `
        + 'reported profit is not yet converting into operating cash. '
      : `Thesis-critical mechanism deteriorating — `
        + `${downAll.map((c) => `${c.label.toLowerCase()} ${c.delta || c.after || ''}`.trim()).join(', ')}. `)
      + (coreTriggered.length
        ? `The condition "${coreTriggered[0].invalidation}" has fired once; a break needs it confirmed or a second core condition alongside it. `
        : 'No stated thesis-break condition has been met. ')
      + (coreTriggered.some((c) => c.key === 'cash_conversion')
        ? 'A single cash-conversion reading is a review prompt and never a break on its own. ' : '')
      + 'A weak quarter is not a broken thesis — this is a prompt to look, not to act.';
  } else if (outputOnlyPositive && !strictGreen) {
    // ── GOOD OUTPUT, ONE DRIVER, MECHANISM NOT FULLY CONFIRMED.     (zzz771)
    // Everything that used to be green on a single driver lands here, in the
    // owner's own words, with the confirmed count and the open variables and
    // their states — so "1/5 confirmed" can never sit under a green badge.
    status = 'CONFIRMATION_REQUIRED';
    const unionKeys = new Set<VarKey>([...structuralVars.map((c) => c.key), ...drivers.map((d) => d.key)]);
    const unionConfirmed = new Set<VarKey>([...structuralConfirmedVars.map((c) => c.key), ...drivers.map((d) => d.key)]);
    const confirmedNames = [...unionConfirmed].map((k) => (VAR_LABEL[k] || checked.find((c) => c.key === k)?.label || k).toLowerCase());
    const open = [...unionKeys].filter((k) => !unionConfirmed.has(k))
      .map((k) => checked.find((c) => c.key === k)).filter((c): c is CheckedVariable => !!c)
      .map((c) => `${nm(c).toLowerCase()} (${openState(c)})`);
    const openAll = [...new Set([...open, ...stillToConfirm])];
    because = `${OUTPUT_STRENGTHENING_BECAUSE.replace('{x}', String(unionConfirmed.size)).replace('{y}', String(unionKeys.size)).replace('{confirmed}', confirmedNames.join(', ') || 'none')}`
      + (openAll.length ? ` Still to confirm: ${openAll.join('; ')}.` : ' Still to confirm: the strategy\'s remaining core mechanism variables.')
      + ` Financial output: ${outputSummary}.`;
  } else if (greenByDrivers) {
    status = 'STRENGTHENING';
    // The count names what was actually evidenced: the strategy's own
    // structural variables plus any other filing-evidenced driver, so a green
    // card never reads "0/4 confirmed … mechanism confirmed".
    const unionKeys = new Set<VarKey>([...structuralVars.map((c) => c.key), ...drivers.map((d) => d.key)]);
    const unionConfirmed = new Set<VarKey>([...structuralConfirmedVars.map((c) => c.key), ...drivers.map((d) => d.key)]);
    // A one-off is "checked, not material" only when an item was disclosed
    // and judged; silence is named as silence. (zzz771)
    const oneOffText = !found.one_offs ? 'none disclosed in the documents read (silence, not a confirmation)'
      : found.one_offs.unjudged ? 'shown, not material to the call'
        : found.one_offs.verdict === 'flat' ? 'checked, not material'
          : 'disclosed; materiality not established';
    because = `${STRENGTHENING_BECAUSE}Structural evidence reviewed: ${unionConfirmed.size}/${unionKeys.size} variables confirmed. Financial output: ${outputSummary}. `
      + `Structural driver${drivers.length > 1 ? 's' : ''} evidenced in the filings: ${drivers.slice(0, 4).map(driverText).join('; ')}.`
      + (thesis.pattern === 'F' ? ` Forensics: one-offs ${oneOffText}; cash conversion ${found.cash_conversion?.after || 'not deteriorating'}.` : '')
      + (stillToConfirm.length ? ` Still to confirm next quarter: ${stillToConfirm.join(', ')}.` : '');
  } else if (input.evidenceReviewed && coreDisclosed.length < core.length
      && core.every((c) => c.verdict !== 'unknown' || c.absence === 'not_disclosed')) {
    // ── READ, AND THE COMPANY SAID NOTHING.                        (zzz757)
    //
    // Every core variable was either read or searched for and not found.
    // "EVIDENCE NOT YET REVIEWED" was the wrong sentence on fifty of the
    // owner's cards: three documents had been read on each, and the gap was
    // the company's silence, not his. Silence cannot confirm a mechanism —
    // so this is CONFIRMATION REQUIRED, not a green verdict and not a
    // request to press the read button again.
    const silent = core.filter((c) => c.verdict === 'unknown').map((c) => c.label.toLowerCase());
    status = 'CONFIRMATION_REQUIRED';
    because = (outputImproved ? `${OUTPUT_ONLY_SENTENCE} ` : '')
      + `The documents were read and disclose nothing about ${silent.join(' or ')} — core to this thesis, so `
      + `${silent.length === 1 ? 'it is' : 'they are'} UNKNOWN. `
      + 'Unknown, not negative: silence is never counted against the thesis, and never confirms its mechanism either'
      + (drivers.length ? ` — the ${drivers.slice(0, 2).map(driverText).join('; ')} evidenced does not establish the same mechanism.` : '.');
  } else if (coreDisclosed.length < core.length
      && core.some((c) => c.absence === 'no_grader_row')) {
    // No graded row AND no results filing with the figure on its first page.
    // Since zzz762 the filing's headline block fills these; the remaining
    // cases are holdings whose documents read were transcripts and decks
    // only, or were read before the headline was asked for.
    const gm = core.filter((c) => c.absence === 'no_grader_row').map((c) => c.label.toLowerCase());
    status = 'EVIDENCE_INCOMPLETE';
    because = INCOMPLETE_BECAUSE + `${gm.join(' and ').replace(/^./, (x) => x.toUpperCase())} ${gm.length === 1 ? 'is' : 'are'} not on file: this company has no graded or screener row, `
      + 'and none of the documents read prints the figure on its results page. '
      + `A results filing that states ${gm.length === 1 ? 'it' : 'them'} — re-read once the quarterly results are on file — fills this; `
      + 'a transcript or a deck alone does not.';
  } else if (!core.length || disclosed.length < 2) {
    // ── TWO WAYS TO REACH A VERDICT YOU HAVE NOT EARNED.          (zzz719)
    //
    // 1. A thesis with NO core variable (the UNCLASSIFIED ledger, before it
    //    was given one) made `coreDisclosed.length < core.length` read
    //    `0 < 0` — false — so it fell straight through to NEUTRAL and printed
    //    "All 0 core variables checked", which is both meaningless and a
    //    claim of completeness.
    // 2. A holding with ZERO variables disclosed did the same: "NO MATERIAL
    //    CHANGE" on a holding nobody has read anything about. Thirty of the
    //    owner's fifty-one sat there. Nothing had been shown to change
    //    because nothing had been looked at, and those are not the same
    //    statement.
    //
    // Both now land at EVIDENCE INCOMPLETE, which is what they are.
    status = 'EVIDENCE_INCOMPLETE';
    // JAMNAAUTO printed "Nothing has been read for this holding — no graded
    // result, no screener row, no filing" on a card whose own header said
    // "3 documents read · 8 facts". The sentence has to branch on whether a
    // document was actually read. (zzz757)
    because = INCOMPLETE_BECAUSE + (disclosed.length
      ? `Only ${disclosed.length} of ${checked.length} variables could be read, and none of them is decisive. `
        + 'Too little has been looked at to call this either way.'
      : input.evidenceReviewed
        ? 'Documents were read, but nothing in them maps to a variable this thesis rests on, '
          + 'and there is no graded or screener row to supply the financial ones. '
          + 'The filings are on file; the thesis variables are not in them.'
        : 'Nothing has been read for this holding — no graded result, no screener row, no filing. '
          + 'This is an unchecked holding, not a quiet one.');
  } else if (coreDisclosed.length < core.length) {
    // Nothing is deteriorating, and the thesis has not been fully checked. A
    // positive verdict is not available here, and neither is a comfortable
    // "no material change" — both would claim more than has been looked at.
    const missing = core.filter((c) => c.verdict === 'unknown').map((c) => c.label.toLowerCase());
    status = 'EVIDENCE_INCOMPLETE';
    because = INCOMPLETE_BECAUSE + `${coreDisclosed.length}/${core.length} core variables checked. `
      + `Missing: ${missing.join(', ')}. `
      + (!disclosed.length && !input.evidenceReviewed
        ? 'Nothing has been read for this holding at all.'
        : input.evidenceReviewed
          ? 'No deterioration is visible in what was read. These remain open because no source so far has carried them.'
          : 'No deterioration is visible in the evidence reviewed so far; remaining thesis-critical variables have not yet been reviewed.');
  } else if (coreJudged.length < core.length) {
    // Every core variable was disclosed, but at least one is a LEVEL with
    // no comparison basis. Better than unread — the figure is on the card
    // and next quarter turns it into a direction — and still not a
    // confirmed mechanism.
    status = 'CONFIRMATION_REQUIRED';
    // A figure that is deliberately not judged says WHY; a bare level says
    // it is a level. EXICOM's "cash conversion (0.32×) was disclosed as a
    // level with nothing to compare against" was neither true nor the reason.
    const reasoned = coreLevelOnly.filter((c) => c.unjudged);
    const bareLevel = coreLevelOnly.filter((c) => !c.unjudged);
    const parts: string[] = [];
    if (reasoned.length) parts.push(reasoned.map((c) => `${c.label.toLowerCase()} (${c.after || c.before}) is not read either way — ${c.unjudged}`).join('; '));
    if (bareLevel.length) parts.push(`${bareLevel.map((c) => `${c.label.toLowerCase()} (${c.after || c.before})`).join(' and ')} `
      + `${bareLevel.length === 1 ? 'was' : 'were'} disclosed as a level with nothing in the document to compare against, `
      + 'so the direction is unknown. The figure is recorded; next quarter turns it into a trend.');
    because = parts.join('. ') + (reasoned.length && !bareLevel.length ? '. The numbers stand; the mechanism is neither confirmed nor contradicted by them.' : '');
  } else if (input.evidenceReviewed && !outputImproved && critical.length > 0
      && critical.every((c) => c.verdict === 'flat') && critical.every(flatOnTwoReadings)) {
    // ── NO MATERIAL CHANGE IS A HIGH BAR.                          (zzz770)
    // Every thesis-critical variable that can apply was reviewed and read as
    // unchanged. Not "nothing negative found": a level with nothing to
    // compare against, or an unread variable, never reaches this branch.
    // ── AND "UNCHANGED" NEEDS TWO READINGS.                        (zzz771)
    // A figure read once is a level; a risk nobody mentioned is silence.
    // Neither is "did not move". Silence on a risk variable may still pass
    // (the code says so), but it is printed as not mentioned, never as flat.
    status = 'NEUTRAL';
    const read = critical.filter((c) => c.readings === 2);
    const denied = critical.filter((c) => !c.silence && c.readings < 2);
    const silent = critical.filter((c) => c.silence);
    because = `All ${read.length} thesis-critical variables that were disclosed were read on two readings and none moved materially: `
      + `${read.map((c) => `${c.label.toLowerCase()}${c.before && c.after ? ` ${c.before} → ${c.after}` : c.after ? ` ${c.after}` : ''}`).join(', ')}.`
      + (denied.length ? ` Stated as none by the company (a statement, not a reading): ${denied.map((c) => c.label.toLowerCase()).join(', ')}.` : '')
      + (silent.length ? ` Not mentioned in the documents read (silence, not a reading): ${silent.map((c) => c.label.toLowerCase()).join(', ')}.` : '');
  } else if (input.evidenceReviewed && !outputImproved && critical.length > 0
      && critical.every((c) => c.verdict === 'flat')) {
    // Every thesis-critical variable reads flat, but at least one on a SINGLE
    // reading: a level, not "unchanged". Neither strengthening nor neutral —
    // the next read turns the level into a direction. (zzz771)
    status = 'CONFIRMATION_REQUIRED';
    const once = critical.filter((c) => c.verdict === 'flat' && !c.silence && c.readings < 2);
    because = `Nothing moved in what was read, but ${once.map((c) => `${nm(c).toLowerCase()} (${c.after || c.before || 'stated'})`).join(', ')} `
      + `${once.length === 1 ? 'is' : 'are'} a single reading with no earlier figure to compare against — a level, not "unchanged". `
      + '"No material change" needs two readings on every thesis-critical variable.';
  } else if (coreUp.length >= 1 && weighted >= 6 && allDimsConfirmed && input.evidenceReviewed
      && structuralGate && outputImproved && coreMechanismGaps.length === 0) {
    // ── THE ONLY PATH TO GREEN.                                   (zzz723)
    //
    // Three gates, and the third is the one the owner caught. AETHER reached
    // STRENGTHENING on revenue +27.2% and cash 2.25× with capacity, order
    // book, capex, customers and guidance all untouched — because its ledger
    // happens to be the unclassified one, whose required dimensions are both
    // answerable from a grader row. The dimension gate alone therefore let a
    // good number produce a green status with NO document read, which is
    // precisely the rule it was built to enforce.
    //
    // So green also requires that an evidence document was actually read.
    // "The mechanism is confirmed" is a claim about what a filing, concall or
    // announcement said; it cannot be made from a row of ratios.
    //
    // ── AND THE STRATEGY'S OWN MECHANISM, FROM ITS OWN EVIDENCE.  (zzz765c)
    // Every structural variable the ledger weights 3+ must be confirmed by
    // its own row, and the output must have improved with nothing
    // thesis-critical in it falling. The card prints `action — because`, so
    // the sentence opens exactly as the owner specified.
    status = 'STRENGTHENING';
    // Only evidenced (improving) variables are listed as confirmed; a risk
    // variable that passed by silence is named as silence. (zzz771)
    const silentPassed = structuralRequired.filter((c) => c.silence);
    because = `${STRENGTHENING_BECAUSE}${structuralLine} Financial output: ${outputSummary}. Confirmed: `
      + `${structuralConfirmedVars.map((c) => {
        const v = c.delta || c.after;
        return `${c.label.toLowerCase()} ${v && v.length <= 32 ? v : '(confirmed in the documents read)'}`;
      }).join(', ')}.`
      + (silentPassed.length ? ` Not mentioned in the documents read (silence passes the gate, and is not a confirmation): ${silentPassed.map((c) => c.label.toLowerCase()).join(', ')}.` : '');
  } else if (outputImproved && input.evidenceReviewed && !unestablished.length && !anyMaterialDown
      && !structuralGate) {
    // ── GOOD NUMBERS, THE STRATEGY'S MECHANISM NOT YET SHOWN.     (zzz765c)
    // Every dimension carries something, but the variables this strategy
    // actually rests on have not each been confirmed from their own evidence.
    status = 'CONFIRMATION_REQUIRED';
    because = `${OUTPUT_ONLY_SENTENCE} ${structuralLine}${notEstablished} Financial output: ${outputSummary}.`;
  } else if (unestablished.length) {
    // ── THE NEW MIDDLE. Good numbers, unproven mechanism.         (zzz723)
    //
    // This is the status AETHER and ANTELOPUS should have had: revenue and
    // cash improving, and capacity, orders, capex, customers and guidance all
    // untouched. Calling that STRENGTHENING told the owner his operating
    // thesis was confirmed when only its output had been observed.
    status = 'CONFIRMATION_REQUIRED';
    because = (outputImproved ? `${OUTPUT_ONLY_SENTENCE} ` : '')
      + `${unestablished.map((d) => d.label.charAt(0).toUpperCase() + d.label.slice(1)).join(' and ')} `
      + `${unestablished.length === 1 ? 'has' : 'have'} not been established. ${structuralLine}${notEstablished} `
      + 'A good result is the OUTPUT of this thesis, not evidence that the mechanism behind it is intact.';
  } else if (anyMaterialDown) {
    // Only a SMALL move (a margin dip under the materiality line) reaches
    // here; a material one is WEAKENING above. The label's meaning holds:
    // output moved up, the cause is unestablished, and the dip is named.
    status = 'CONFIRMATION_REQUIRED';
    const down = checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating' && mayMoveStatus(c));
    const ups = OUTPUT_SHORT.filter(([k]) => found[k]?.verdict === 'improving').map(([k, n]) => `${n} ${found[k]!.delta || found[k]!.after}`);
    because = (ups.length ? `Financial output improved (${ups.join(' · ')}), but the structural cause has not yet been established. ` : '')
      + `${down.map((c) => `${c.label} ${c.delta || c.after || ''}`.trim()).join(', ')} moved the wrong way — `
      + `below the ${MARGIN_MATERIAL_PP}pp materiality line, so it is shown and does not weaken the thesis on its own.`;
  } else if (!input.evidenceReviewed) {
    // Good numbers, every core variable checked, and no document read. That
    // is not "nothing changed" and it is certainly not confirmation — it is a
    // result whose cause is unexamined.
    status = 'CONFIRMATION_REQUIRED';
    because = coreUp.length
      ? (outputImproved ? `${OUTPUT_ONLY_SENTENCE} ` : '')
        + `${coreUp.map((c) => c.label.toLowerCase()).join(' and ')} improved on the reported figures, `
        + 'but no filing, concall or announcement has been read — so nothing establishes WHY, '
        + 'and a result without a cause is not a confirmed thesis.'
      : 'Every variable available without reading a document has been checked and none is decisive. '
        + 'No filing, concall or announcement has been read, so "nothing changed" is not a claim this page can make yet.';
  } else if (critical.some((c) => c.verdict === 'improving')) {
    // Something improved and the mechanism gate was not passed: that is a
    // result awaiting its cause, never "no material change". (zzz770)
    status = 'CONFIRMATION_REQUIRED';
    because = `${outputImproved ? `${OUTPUT_ONLY_SENTENCE} ` : ''}${structuralLine}${notEstablished} Financial output: ${outputSummary}.`;
  } else if (critical.length > 0 && critical.every(flatOnTwoReadings)) {
    status = 'NEUTRAL';
    because = `Every dimension this thesis rests on was reviewed and ${disclosed.length} of ${checked.length} `
      + 'variables carried evidence; no thesis-critical variable improved or deteriorated.';
  } else {
    // Nothing improved, nothing deteriorated, and at least one thesis-critical
    // variable is a level, a single reading or unread: "no material change"
    // would claim a comparison nobody has. (zzz771)
    status = 'CONFIRMATION_REQUIRED';
    const open = critical.filter((c) => !flatOnTwoReadings(c));
    because = 'Nothing thesis-critical improved or deteriorated in what was read, but '
      + `${open.map((c) => `${nm(c).toLowerCase()} (${openState(c)})`).join(', ')} `
      + `${open.length === 1 ? 'has' : 'have'} no two readings to compare — "no material change" is not a claim this evidence supports.`;
  }

  // ── OLD EVIDENCE CANNOT CONFIRM TODAY'S MECHANISM.               (zzz769)
  //
  // MINDSPACE's only evidence on file was Q4 FY24 — "newer document seen, not
  // yet read" — and it sat at THESIS STRENGTHENING on two-year-old structural
  // drivers. A driver describes the business in the period it was read for.
  // Where that period is more than two quarters behind the one every company
  // should have published by now, a positive status is capped: the drivers
  // are shown, and the card asks for the latest filing instead of vouching
  // for a mechanism nobody has looked at since.
  const staleBy = quartersBehind(input.evidencePeriod, input.expectedPeriod);
  const staleEvidence = staleBy != null && staleBy > STALE_EVIDENCE_QUARTERS;
  if (staleEvidence && (status === 'STRENGTHENING' || status === 'NEUTRAL' || status === 'POSITIVE_EXPECTATION_GAP')) {
    status = 'CONFIRMATION_REQUIRED';
    because = `The evidence on file is ${input.evidencePeriod} — too old to confirm this quarter's mechanism; read the latest filing. `
      + `${input.expectedPeriod} is the latest period due, ${staleBy} quarters later. What the ${input.evidencePeriod} evidence showed: ${because}`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // THE VERDICT — THREE QUESTIONS, NEVER ONE LABEL.                  (zzz771)
  //
  // "No thesis action triggered" answered question 1 and was read as an
  // answer to question 2. They are kept apart here:
  //   1. Did a break trigger fire?         breakTrigger — the fired
  //      invalidation conditions, verbatim; a break is BROKEN, a single
  //      condition is a review.
  //   2. Which way is the thesis moving?   direction — STRENGTHENING only when
  //      the strict green rule passed; WEAKENING on a deterioration or a
  //      break; UNCHANGED only when every critical variable was read twice
  //      and did not move; otherwise UNKNOWN, and it says why. Output alone
  //      never calls a direction.
  //   3. Has the mechanism been checked?   evidence — what the documents
  //      established about the CORE MECHANISM: confirmed, partly, not
  //      contradicted, contradicted, incomplete, or simply unchecked.
  // Question 3 does not answer question 2: "evidence merely failed to
  // contradict" is NOT_CONTRADICTED + UNKNOWN, never strengthening.
  // ═════════════════════════════════════════════════════════════════════════
  const verdict: ThesisVerdict = (() => {
    const firedRows = checked.filter((c) => c.invalidation).sort((a, b) => b.weight - a.weight);
    const fired = firedRows.map((c) => c.invalidation as string);
    // A condition on a variable this strategy does not rest on (cash for A or
    // B) is a FINANCIAL WARNING: it fired, and it cannot move toward a break.
    // Saying "a break needs a second condition" about it would overstate it. (zzz771)
    const critFired = firedRows.filter((c) => mayMoveStatus(c)).map((c) => c.invalidation as string);
    const warnFired = firedRows.filter((c) => !mayMoveStatus(c)).map((c) => c.invalidation as string);
    const q = (xs: string[], j: string) => xs.map((c) => `"${c}"`).join(j);
    const breakTrigger = {
      fired: fired.length > 0,
      conditions: fired,
      text: !fired.length ? 'None fired'
        : status === 'BROKEN' ? `Fired: ${q(critFired.length ? critFired : fired, ' AND ')} — thesis-break condition met.`
          : [critFired.length ? `Fired: ${q(critFired, '; ')} — ${critFired.length === 1 ? 'one condition' : 'conditions'} on a single reading; a break needs a second core condition or confirmation next quarter.` : '',
            warnFired.length ? `${critFired.length ? 'Also fired' : 'Fired'} (financial warning only — not thesis-critical for this strategy, cannot move toward a break): ${q(warnFired, '; ')}.` : '',
          ].filter(Boolean).join(' '),
    };
    const mechX = printedConfirmed.size, mechY = printedKeys.size;
    const missing = [...printedKeys].filter((k) => !printedConfirmed.has(k))
      .map((k) => VAR_LABEL[k] || checked.find((c) => c.key === k)?.label || k);
    const coreContradicted = coreDown.length > 0 || structuralDown;
    const anyConfirmed = mechX > 0 || drivers.length > 0;
    const coreOpen = coreMechanism.filter((c) => c.verdict === 'unknown' || c.state === 'UNCLEAR');

    let evidence: ThesisVerdict['evidence'];
    let evidenceWhy: string;
    if (!input.evidenceReviewed) {
      evidence = 'UNCHECKED';
      evidenceWhy = 'No filing, concall or announcement has been read for this holding; the core mechanism has not been looked at.';
    } else if (coreContradicted) {
      evidence = 'CONTRADICTED';
      const down = checked.filter((c) => c.verdict === 'deteriorating' && mayMoveStatus(c) && (c.weight === 4 || structuralKeys.has(c.key)));
      evidenceWhy = `A core mechanism variable moved the wrong way: ${down.map((c) => `${c.label.toLowerCase()} ${c.delta || c.after || ''}`.trim()).join(', ')}.`;
    } else if (strictGreen && !staleEvidence) {
      evidence = 'CONFIRMED';
      evidenceWhy = structuralGate
        ? `The strategy's structural gate passed: ${structuralConfirmedVars.map((c) => nm(c).toLowerCase()).join(', ')} confirmed from their own evidence.`
        : `${distinctDrivers.size} distinct mechanism drivers evidenced (${[...distinctDrivers].map((k) => (VAR_LABEL[k] || k).toLowerCase()).join(', ')}) and ${mechX}/${mechY} structural variables confirmed.`;
    } else if (anyConfirmed) {
      evidence = 'PARTIALLY_CONFIRMED';
      evidenceWhy = `${mechX}/${mechY} structural variables confirmed`
        + (drivers.length ? `; driver${drivers.length > 1 ? 's' : ''} evidenced: ${[...distinctDrivers].map((k) => (VAR_LABEL[k] || k).toLowerCase()).join(', ')}` : '')
        + (missing.length ? `; still open: ${missing.map((l) => l.toLowerCase()).join(', ')}` : '')
        + (staleEvidence ? `; the evidence is ${input.evidencePeriod}, too old to confirm this quarter` : '')
        + (anyMaterialDown
          // TI: WEAKENING on margin and earnings, while no core MECHANISM
          // variable moved — say where the deterioration is. (zzz771)
          ? `. No core mechanism variable contradicted; the deterioration is in financial output: ${checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating' && mayMoveStatus(c)).map((c) => `${nm(c).toLowerCase()} ${c.delta || c.after || ''}`.trim()).join(', ')}.`
          : '. Nothing contradicted.');
    } else if (coreOpen.length) {
      evidence = 'INCOMPLETE';
      evidenceWhy = `Documents were read, but ${coreOpen.map((c) => `${nm(c).toLowerCase()} (${openState(c)})`).join(', ')} — core to this thesis — ${coreOpen.length === 1 ? 'is' : 'are'} unknown. Unknown is not neutral evidence.`;
    } else {
      evidence = 'NOT_CONTRADICTED';
      evidenceWhy = mechY
        ? `Documents were read; ${coreMechanism.map((c) => `${nm(c).toLowerCase()} (${openState(c)})`).join(', ')} neither confirm nor contradict the mechanism.`
        : 'Documents were read; this ledger has no core mechanism variable to confirm, and nothing read contradicts the thesis.';
    }

    let direction: ThesisVerdict['direction'];
    let directionWhy: string;
    if (status === 'STRENGTHENING') {
      direction = 'STRENGTHENING';
      directionWhy = `Mechanism confirmed (${evidenceWhy.replace(/\.$/, '')}) and financial output supports it (${outputSummary}).`;
    } else if (status === 'WEAKENING' || status === 'BROKEN' || status === 'NEGATIVE_EXPECTATION_GAP') {
      direction = 'WEAKENING';
      directionWhy = status === 'BROKEN' ? 'A stated thesis-break condition is met.'
        : status === 'NEGATIVE_EXPECTATION_GAP' ? `Behind management's own documented plan: ${input.promiseGap?.plan ?? ''} vs actual ${input.promiseGap?.actual ?? ''}.`
          : `Thesis-critical evidence deteriorated: ${checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating' && mayMoveStatus(c)).map((c) => `${c.label.toLowerCase()} ${c.delta || c.after || ''}`.trim()).join(', ') || 'see the status line'}.`;
    } else if (status === 'NEUTRAL') {
      direction = 'UNCHANGED';
      directionWhy = 'Every thesis-critical variable was read on two readings and none moved materially.';
    } else {
      direction = 'UNKNOWN';
      directionWhy = !input.evidenceReviewed
        ? (outputImproved ? `output improved (${outputSummary}); no document read — direction cannot be called from output alone` : 'no document read and nothing decisive in the figures on file')
        : staleEvidence && strictGreen
          ? `the mechanism was confirmed on ${input.evidencePeriod} evidence, ${staleBy} quarters old — it cannot call this quarter's direction`
          : status === 'POSITIVE_EXPECTATION_GAP'
            ? `ahead of management's own plan on output; mechanism ${mechX}/${mechY} confirmed — direction cannot be called from output alone`
            : outputImproved
              ? `output improved (${outputSummary}); mechanism ${mechX}/${mechY} confirmed — direction cannot be called from output alone`
              : outputSummary === 'not on file'
                ? `no financial figures on file for this period; mechanism ${mechX}/${mechY} confirmed`
                : `output did not improve (${outputSummary}); mechanism ${mechX}/${mechY} confirmed — nothing read calls a direction`;
    }
    return { breakTrigger, direction, directionWhy, evidence, evidenceWhy,
      coverage: { confirmed: mechX, applicable: mechY, missing } };
  })();
  // The words "THESIS STRENGTHENING" require both answers. By construction
  // they agree; if a future branch breaks that, the label yields, never the
  // verdict — the card must not print green over unconfirmed evidence. (zzz771)
  if (status === 'STRENGTHENING' && !(verdict.evidence === 'CONFIRMED' && verdict.direction === 'STRENGTHENING')) {
    status = 'CONFIRMATION_REQUIRED';
    verdict.direction = 'UNKNOWN';
    verdict.directionWhy = `mechanism evidence is ${verdict.evidence}, so the direction cannot be called: ${verdict.evidenceWhy}`;
    because = `${OUTPUT_STRENGTHENING_BECAUSE.replace('{x}', String(verdict.coverage.confirmed)).replace('{y}', String(verdict.coverage.applicable)).replace('{confirmed}', [...printedConfirmed].map((k) => (VAR_LABEL[k] || k).toLowerCase()).join(', ') || 'none')} `
      + `Still to confirm: ${verdict.coverage.missing.map((l) => l.toLowerCase()).join(', ') || 'none'}. ${because}`;
  }


  // ── A CARD MUST NOT CONTRADICT ITSELF IN TWO LINES.              (zzz761)
  //
  // Eighteen holdings read "EVIDENCE NOT YET REVIEWED" above a sentence that
  // said "Everything that COULD be read has been." Both came from the same
  // status: EVIDENCE_INCOMPLETE carries one action label, and that label is
  // right for a holding nobody has opened and wrong for one where three
  // documents were read and the gap is a missing graded row. The status is
  // correct — reading more cannot fill it — so the ACTION changes instead.
  const blockedOnGrader = status === 'EVIDENCE_INCOMPLETE'
    && core.some((c) => c.absence === 'no_grader_row');
  // The badge says EVIDENCE INCOMPLETE; the sentence must not open with a
  // different status name. (zzz764)
  const action: ThesisAssessment['action'] = blockedOnGrader
    ? 'EVIDENCE INCOMPLETE — RESULTS FIGURES NOT ON FILE'
    : ACTION[status];

  const triggered = checked
    .filter((c) => c.invalidation)
    .map((c) => ({ condition: c.invalidation as string, weight: c.weight, evidence: c.evidence }))
    .sort((a, b) => b.weight - a.weight);

  // ── THE DYNAMIC INVALIDATION LIST. This is what replaces the sentence
  //    that used to be identical on every card: the conditions that would end
  //    THIS thesis, ranked by how much of the thesis each one carries, each
  //    marked with whether the latest evidence has fired it, is close to it,
  //    or could not check it at all.
  const invalidationConditions = thesis.variables
    .filter((tv) => !!tv.invalidatedWhen)
    .map((tv) => {
      const c = checked.find((x) => x.key === tv.key)!;
      const st: 'ok' | 'watch' | 'fired' | 'unknown' =
        c.verdict === 'deteriorating' ? 'fired'
          : c.verdict === 'unknown' || c.verdict === 'stated' ? 'unknown'
            : c.verdict === 'flat' ? 'watch' : 'ok';
      return { condition: tv.invalidatedWhen, weight: tv.weight, status: st };
    })
    .sort((a, b) => b.weight - a.weight);

  // ── WHAT TO LOOK FOR, NAMED AND NUMBERED.                        (zzz758)
  //
  // "Utilisation — not disclosed this time" told the owner nothing he could
  // act on. Where the ledger holds a previous figure, the next confirmation
  // states the number to beat and the basis it will be read on, so next
  // quarter's read is a test with a pass mark rather than another look.
  const nextConfirmation = checked
    .filter((c) => c.weight >= 3 && (c.verdict === 'unknown' || c.verdict === 'flat' || c.verdict === 'stated'))
    .slice(0, 4)
    .map((c) => {
      const k = c.comparison;
      const known = k?.current?.raw || c.after || c.before;
      if (k?.change_type === 'NOT_DISCLOSED' && k.previous) {
        return `${c.label} — last disclosed at ${k.previous.raw} in ${k.previous_period} and absent since. `
          + 'Whether the next filing restores it is the test; continued silence on a figure that used to be published is itself the answer.';
      }
      if (c.state === 'UNCLEAR') {
        return `${c.label} — UNCLEAR (${c.stateReason || 'not judgeable as read'}). The next read has to state it in a form that can be judged.`;
      }
      if (c.verdict === 'stated' && known && (!/\d/.test(known) || known.length > 40)) {
        return `${c.label} — stated in words, with nothing earlier to compare against. The next read has to show which way it is moving.`;
      }
      if (c.verdict === 'stated' && known) {
        return `${c.label} — ${known} recorded with no earlier figure on file. `
          + `Next period's read turns it into a direction: above ${known} confirms, below it contradicts.`;
      }
      if (c.verdict === 'flat' && SILENCE_IS_A_PASS.has(c.key)) {
        return `${c.label} — ${known ? `${known} on file` : 'none found in the documents read'}. The next read has to confirm it does not recur.`;
      }
      if (c.verdict === 'flat' && known) {
        return `${c.label} — flat at ${known}${k?.basis && k.basis !== 'NONE' ? ` ${BASIS_LABEL[k.basis]}` : ''}. `
          + 'It has to turn before the thesis can be called intact.';
      }
      if (c.verdict === 'unknown') {
        return `${c.label} — not disclosed this time and no earlier figure on file. Whether it is disclosed next quarter is itself information.`;
      }
      return `${c.label} — ${c.verdict}. Next period's figure settles it.`;
    });

  // ── WHY THE STATUS MOVED.                                        (zzz758)
  //
  // A status that changes without a reason is a number that changed its mind.
  // The reason is assembled from the comparisons that actually carry a
  // direction, so it names evidence rather than restating the verdict.
  const movers = checked
    .filter((c) => c.comparison && (c.comparison.change_type === 'INCREASED' || c.comparison.change_type === 'DECREASED' || c.comparison.change_type === 'NOT_DISCLOSED'))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
  const statusChangeReason = input.previousStatus && input.previousStatus.status !== status
    ? `${input.previousStatus.status} → ${status} since ${input.previousStatus.period}`
      + (movers.length
        ? ` — ${movers.map((m) => (m.comparison!.change_type === 'NOT_DISCLOSED'
          ? `${m.label.toLowerCase()} stopped being disclosed (was ${m.comparison!.previous?.raw})`
          : `${m.label.toLowerCase()} ${m.comparison!.previous?.raw} → ${m.comparison!.current?.raw}${m.comparison!.change ? ` (${m.comparison!.change})` : ''}`)).join('; ')}.`
        : ' — no single variable moved; the change comes from what was and was not read.')
    : null;

  // ── THE CHANGE LOG THE CARD RENDERS. ────────────────────────────────────
  const changes = checked
    .filter((c) => c.comparison && c.comparison.change_type !== 'NEW')
    .map((c) => c.comparison as MetricComparison)
    .sort((a, b) => {
      const rank = (x: MetricComparison) => (x.change_type === 'DECREASED' || x.change_type === 'NOT_DISCLOSED' ? 0 : x.change_type === 'INCREASED' ? 1 : 2);
      return rank(a) - rank(b);
    });

  const causeSummary = {
    structural: changes.filter((c) => c.cause?.persistence === 'STRUCTURAL').length,
    temporary: changes.filter((c) => c.cause?.persistence === 'TEMPORARY').length,
    unclassified: changes.filter((c) => c.cause?.persistence === 'UNCLASSIFIED').length,
    none: changes.filter((c) => (c.change_type === 'INCREASED' || c.change_type === 'DECREASED') && !c.cause).length,
  };

  // ── THE STRUCTURAL CHANGE DETECTOR.                            (zzz717)
  //
  // The spec's point: the output should be "OPERATING LEVERAGE CONFIRMED",
  // not "earnings beat". A mechanism is a chain of links, and a chain is only
  // confirmed when every link it can be checked on holds. One unchecked link
  // leaves the whole mechanism UNCONFIRMED — it does not average out to
  // "mostly confirmed", because a chain with an unexamined link is not a
  // chain you have examined.
  //
  // ── OUTPUT IS NOT A LINK.                                       (zzz765c)
  // The chain used to be every weight-3+ variable, revenue and margin
  // included, so a good print "held" most links by itself. Links are now the
  // non-output, non-forward thesis-critical variables, each judged on its own
  // row by the same test the STRENGTHENING gate uses.
  // Cash is a mechanism link only where it is thesis-critical, and a driver
  // that turned the card green is a link the evidence confirmed — so the
  // chain can never say "NOT YET CONFIRMED" under a green badge. (zzz770)
  const mechanismCheck: ThesisAssessment['mechanismCheck'] = critical
    .filter((c) => !isFinancialOutput(c.key, c.source) && VAR_DIMENSION[c.key] !== 'forward'
      && (c.key !== 'cash_conversion' || cashCritical))
    // A link holds only on its own evidence. Silence on a risk variable
    // passes the gate but is not a link that "holds" — it stays unchecked
    // so a green card lists it as still to confirm. (zzz771)
    .map((c) => ({
      link: c.label,
      state: (structurallyEvidenced(c) && !staleEvidence ? 'confirmed'
        : c.state === 'UNCLEAR' ? 'unclear'
          : c.verdict === 'deteriorating' ? 'contradicted' : 'unchecked') as 'confirmed' | 'contradicted' | 'unchecked' | 'unclear',
    }));
  if (status === 'STRENGTHENING' && !staleEvidence) {
    for (const d of drivers) {
      const lbl = d.key === 'capex_earning' ? 'Capex earning' : (d.label || VAR_LABEL[d.key]);
      const at = mechanismCheck.find((m) => m.link === lbl);
      if (at) at.state = 'confirmed'; else mechanismCheck.push({ link: lbl, state: 'confirmed' });
    }
  }
  const confirmedLinks = mechanismCheck.filter((m) => m.state === 'confirmed').length;
  const contradicted = mechanismCheck.filter((m) => m.state === 'contradicted');
  const unchecked = mechanismCheck.filter((m) => m.state === 'unchecked');
  const mechanismVerdict = staleEvidence && !contradicted.length
    ? `${thesis.name} NOT YET CONFIRMED — the evidence on file is ${input.evidencePeriod}, ${staleBy} quarters behind ${input.expectedPeriod}; it cannot confirm the mechanism today.`
    : !mechanismCheck.length && status === 'STRENGTHENING'
    ? `${thesis.name} — no classified strategy mechanism to confirm; the ledger's own required evidence holds${structuralConfirmedVars.length ? `: ${structuralConfirmedVars.map((c) => c.label.toLowerCase()).join(', ')}` : ''}.`
    : !mechanismCheck.length
    ? `${thesis.name} NOT YET CONFIRMED — this ledger has no thesis-critical structural variable; financial output alone cannot confirm a mechanism.`
    : contradicted.length
    ? `${thesis.name} CONTRADICTED — ${contradicted.map((m) => m.link.toLowerCase()).join(', ')} moving the wrong way.`
    : unchecked.length && status === 'STRENGTHENING'
      ? `${thesis.name} CONFIRMED BY THE EVIDENCED DRIVERS — ${confirmedLinks} of ${mechanismCheck.length} links hold; `
        + `${unchecked.map((m) => m.link.toLowerCase()).join(', ')} still to confirm next quarter.`
    : unchecked.length || mechanismCheck.some((m) => m.state === 'unclear')
      ? `${thesis.name} NOT YET CONFIRMED — ${confirmedLinks} of ${mechanismCheck.length} links hold; `
        + `${[...unchecked, ...mechanismCheck.filter((m) => m.state === 'unclear')].map((m) => `${m.link.toLowerCase()}${m.state === 'unclear' ? ' (unclear)' : ''}`).join(', ')} still open.`
      : `${thesis.name} CONFIRMED — all ${mechanismCheck.length} links of the mechanism hold on this evidence.`;

  const headline = status === 'STRENGTHENING' ? STRENGTHENING_SENTENCE
    : status === 'CONFIRMATION_REQUIRED' && because.startsWith(OUTPUT_ONLY_SENTENCE) ? CONFIRMATION_SENTENCE
      : status === 'CONFIRMATION_REQUIRED' && because.startsWith('Evidence incomplete — financial output strengthening') ? OUTPUT_STRENGTHENING_SENTENCE
      : status === 'EVIDENCE_INCOMPLETE' ? INCOMPLETE_SENTENCE
        : STATUS_META[status].label;

  // ── THE THESIS LOGIC CHAIN.                                      (zzz770)
  // Built only from what was read. A step with nothing behind it says so.
  const NE = 'not established';
  const logicChain: ThesisAssessment['logicChain'] = (() => {
    const out: ThesisAssessment['logicChain'] = [];
    out.push(outputSummary !== 'not on file'
      ? { step: 'OBSERVATION', text: `Financial output: ${outputSummary}.`, established: true }
      : { step: 'OBSERVATION', text: `${NE} — no financial figures on file for this period.`, established: false });
    const md = found.margin_driver;
    const statedCauses = changes.filter((c) => c.cause).slice(0, 2).map((c) => `${c.label.toLowerCase()}: ${c.cause!.text}`);
    const causeText = drivers.length ? drivers.slice(0, 3).map(driverText).join('; ')
      : md && md.after && md.kind !== 'claim' ? `margin driver stated: ${md.after}`
        : statedCauses.length ? statedCauses.join('; ') : '';
    out.push(causeText
      ? { step: 'CAUSE', text: causeText.length > 300 ? `${causeText.slice(0, 297)}…` : causeText, established: true }
      : { step: 'CAUSE', text: `${NE} — no document read states why the output moved.`, established: false });
    const causeBlob = [causeText, md?.after || '', md?.evidence || ''].join(' ');
    const structural = STRUCTURAL_WORDS.test(causeBlob) || causeSummary.structural > 0;
    const temporary = TEMPORARY_ONLY.test(causeBlob) || causeSummary.temporary > 0
      || (!!found.one_offs && found.one_offs.verdict !== 'flat' && !!found.one_offs.after);
    const oneOffTxt = found.one_offs && found.one_offs.verdict !== 'flat' && found.one_offs.after ? ` (one-off on file: ${found.one_offs.after})` : '';
    out.push(!causeText && !temporary
      ? { step: 'STRUCTURAL / TEMPORARY', text: `${NE} — the cause is not known, so whether it repeats is not known.`, established: false }
      : structural && temporary
        ? { step: 'STRUCTURAL / TEMPORARY', text: `MIXED — a structural cause is stated alongside a temporary one${oneOffTxt}; only the structural part repeats.`, established: true }
        : structural
          ? { step: 'STRUCTURAL / TEMPORARY', text: 'STRUCTURAL — the stated cause is operational (mix, volume, capacity, pricing or efficiency) and can repeat.', established: true }
          : temporary
            ? { step: 'STRUCTURAL / TEMPORARY', text: `TEMPORARY — the stated cause is one-off or cyclical${oneOffTxt}; it does not repeat on its own.`, established: true }
            : { step: 'STRUCTURAL / TEMPORARY', text: `${NE} — a cause is stated but not classifiable as structural or temporary.`, established: false });
    const impact: Record<ThesisStatus, string> = {
      STRENGTHENING: 'Mechanism established and output supports it — the thesis is strengthening.',
      CONFIRMATION_REQUIRED: outputImproved
        ? 'Output improved; the thesis mechanism is not established — neither confirmed nor contradicted.'
        : 'The thesis mechanism is not established by the evidence read.',
      WEAKENING: `A thesis-critical variable is deteriorating (${checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating' && mayMoveStatus(c)).map((c) => c.label.toLowerCase()).join(', ') || 'see above'}) — review, not exit.`,
      BROKEN: `A stated break condition is met — ${triggered.slice(0, 2).map((t) => t.condition).join(' / ')}.`,
      NEUTRAL: 'Every thesis-critical variable reviewed; nothing moved materially.',
      NEGATIVE_EXPECTATION_GAP: `Behind management's own earlier plan — ${input.promiseGap?.plan ?? ''} vs actual ${input.promiseGap?.actual ?? ''}.`,
      POSITIVE_EXPECTATION_GAP: `Ahead of management's own earlier plan — ${input.promiseGap?.plan ?? ''} vs actual ${input.promiseGap?.actual ?? ''}.`,
      EVIDENCE_INCOMPLETE: `${NE} — required thesis variables are unreviewed; unknown, not bad.`,
    };
    out.push({ step: 'THESIS IMPACT', text: impact[status], established: status !== 'EVIDENCE_INCOMPLETE' });
    const g = found.guidance || found.management_target;
    const gTxt = g ? (g.plan ? `${g.plan.type === 'TARGET' ? 'target' : 'guidance'} ${g.plan.value}` : String(g.after ?? '').replace(/\s*\((?:target|guidance)\)\s*$/i, '')) || null : null;
    out.push(gTxt && !/^not (stated|disclosed)/i.test(gTxt)
      ? { step: 'FORWARD', text: `${g!.label}: ${gTxt}${g!.statement === 'GUIDANCE' || g!.statement === 'TARGET' || g!.kind === 'claim' ? ' (management statement, not a result)' : ''}.`, established: true }
      : { step: 'FORWARD', text: `${NE} — no guidance or target on file.`, established: false });
    return out;
  })();

  return {
    verdict,
    status, thesis, checked, triggered, invalidationConditions, nextConfirmation, because, financialWarning,
    logicChain, coreMechanismGaps: coreMechanismGaps.map((c) => c.label),
    mechanismCheck, mechanismVerdict, dimensions,
    structural: {
      confirmed: structuralConfirmedVars.length, total: structuralVars.length,
      confirmedLabels: structuralConfirmedVars.map((c) => c.label),
      required: structuralRequired.map((c) => c.label),
      missingRequired: missingRequired.map((c) => c.label),
      gatePassed: structuralGate,
    },
    outputSummary, headline, actionLine: `${action} — ${lcFirst(because)}`,
    changes, causeSummary, statusChangeReason,
    historyDepth: input.historyDepth ?? 0,
    coverage: {
      checked: checked.length, disclosed: disclosed.length,
      corePossible: core.length, coreDisclosed: coreDisclosed.length,
      criticalTotal: criticalAll.length,
      criticalConfirmed: critical.filter((c) => c.verdict === 'improving').length,
      criticalPending: critical.filter((c) => c.verdict === 'unknown').length,
      criticalContradicted: critical.filter((c) => c.verdict === 'deteriorating').length,
      // OUTPUT is anything a grader row can supply — revenue, margin,
      // earnings, leverage, AND cash conversion / ROCE. MECHANISM is what
      // only a document can supply. The dividing line is the data source,
      // because that is exactly the line the "4 confirmed" bug crossed.
      output: tally(criticalAll.filter((c) => isOutput(c.key))),
      mechanism: tally(criticalAll.filter((c) => !isOutput(c.key) && VAR_DIMENSION[c.key] !== 'forward')),
      forward: tally(criticalAll.filter((c) => VAR_DIMENSION[c.key] === 'forward')),
      missingCore: core.filter((c) => c.verdict === 'unknown').map((c) => c.label),
      levelOnlyCore: coreLevelOnly.filter((c) => !c.unjudged).map((c) => c.label),
      unjudgedCore: coreLevelOnly.filter((c) => c.unjudged).map((c) => `${c.label} — ${c.unjudged}`),
      missingNeedsFiling: checked
        .filter((c) => c.verdict === 'unknown' && c.weight >= 3 && !GRADER_AVAILABLE.has(c.key))
        .map((c) => c.label),
    },
    action,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WHY A HOLDING IS ON THE EXIT RADAR — NEVER A PRICE.              (zzz770)
//
// The radar surfaces only these reasons. Each is read off the assessment's
// own evidence; there is no price, drawdown, market-cap or technical input
// anywhere in this engine to read (a static test enforces it).
// ═══════════════════════════════════════════════════════════════════════════
export type ExitReason =
  | 'THESIS INVALIDATION' | 'BREAK CONDITION MET' | 'EXECUTION FAILURE'
  | 'GUIDANCE FAILURE' | 'CUSTOMER LOSS' | 'STRUCTURAL DETERIORATION';
export const EXIT_REASONS: readonly ExitReason[] = [
  'THESIS INVALIDATION', 'BREAK CONDITION MET', 'EXECUTION FAILURE', 'GUIDANCE FAILURE', 'CUSTOMER LOSS', 'STRUCTURAL DETERIORATION',
];
const EXECUTION_KEYS = new Set<VarKey>(['execution_delay', 'commissioning', 'capacity_bottleneck', 'supply_bottleneck', 'shutdown', 'capex_earning']);

/** The radar reason for an assessment, or null when it does not belong on
 *  the radar at all (every non-deteriorated status). */
export function exitReasonOf(a: Pick<ThesisAssessment, 'status' | 'checked' | 'triggered'>): ExitReason | null {
  if (a.status === 'BROKEN') return a.triggered.length ? 'BREAK CONDITION MET' : 'THESIS INVALIDATION';
  if (a.status === 'NEGATIVE_EXPECTATION_GAP') return 'GUIDANCE FAILURE';
  if (a.status !== 'WEAKENING') return null;
  const down = a.checked.filter((c) => c.verdict === 'deteriorating').sort((x, y) => y.weight - x.weight);
  if (down.some((c) => c.key === 'customer_loss')) return 'CUSTOMER LOSS';
  if (down.some((c) => c.key === 'guidance' || c.key === 'management_target' || c.key === 'promise_vs_actual')) return 'GUIDANCE FAILURE';
  if (down.some((c) => EXECUTION_KEYS.has(c.key))) return 'EXECUTION FAILURE';
  return 'STRUCTURAL DETERIORATION';
}
