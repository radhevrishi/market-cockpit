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
import { VAR_LABEL, GRADER_AVAILABLE, SILENCE_IS_A_PASS, VAR_DIMENSION, DIMENSION_LABEL, type VarKey, type VarDimension, type AbsenceReason } from './taxonomy';

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

export const OUTPUT_ONLY_SENTENCE =
  'Financial output improved, but the structural mechanism is not yet fully established.';
export const STRENGTHENING_SENTENCE =
  'THESIS STRENGTHENING — structural mechanism confirmed and supporting output confirmed.';

/** Three counts, never a fraction. (zzz738) */
// Five counts that ADD UP to the total. "2 confirmed · 0 pending · 1
// contradicted · of 4" left one variable unaccounted for on every card —
// the flat one — and a reader cannot audit a sum that does not sum. (zzz754)
function tally(vs: Array<{ verdict: string }>): { confirmed: number; pending: number; contradicted: number; stated: number; flat: number; total: number } {
  return {
    confirmed: vs.filter((c) => c.verdict === 'improving').length,
    pending: vs.filter((c) => c.verdict === 'unknown').length,
    contradicted: vs.filter((c) => c.verdict === 'deteriorating').length,
    stated: vs.filter((c) => c.verdict === 'stated').length,
    flat: vs.filter((c) => c.verdict === 'flat').length,
    total: vs.length,
  };
}

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

export interface ThesisAssessment {
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
  financialWarning: Array<{ label: string; value: string }>;
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
    output: { confirmed: number; pending: number; contradicted: number; stated: number; flat: number; total: number };
    mechanism: { confirmed: number; pending: number; contradicted: number; stated: number; flat: number; total: number };
    forward: { confirmed: number; pending: number; contradicted: number; stated: number; flat: number; total: number };
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
    | 'EVIDENCE NOT YET REVIEWED' | 'CONFIRMATION REQUIRED' | 'RESULTS FIGURES NOT ON FILE'
    | 'NO THESIS ACTION TRIGGERED' | 'MONITORING — NO THESIS INVALIDATION'
    | 'THESIS WEAKENING — REVIEW EVIDENCE' | 'EXIT REVIEW'
    | 'RE-UNDERWRITE — RUNNING BEHIND STATED PLAN'
    | 'RE-UNDERWRITE — RUNNING AHEAD OF STATED PLAN';
  /** Per required dimension: has the mechanism been established there? */
  dimensions: Array<{ dimension: VarDimension; label: string;
    state: 'confirmed' | 'contradicted' | 'unestablished'; by: string[] }>;
  /** Each link of the thesis mechanism, and whether the evidence confirms it.
   *  The spec's "OPERATING LEVERAGE CONFIRMED", rather than "earnings beat". */
  mechanismCheck: Array<{ link: string; state: 'confirmed' | 'contradicted' | 'unchecked' }>;
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
const ACTION: Record<ThesisStatus, ThesisAssessment['action']> = {
  EVIDENCE_INCOMPLETE: 'EVIDENCE NOT YET REVIEWED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION REQUIRED',
  STRENGTHENING: 'NO THESIS ACTION TRIGGERED',
  NEUTRAL: 'MONITORING — NO THESIS INVALIDATION',
  WEAKENING: 'THESIS WEAKENING — REVIEW EVIDENCE',
  BROKEN: 'EXIT REVIEW',
  NEGATIVE_EXPECTATION_GAP: 'RE-UNDERWRITE — RUNNING BEHIND STATED PLAN',
  POSITIVE_EXPECTATION_GAP: 'RE-UNDERWRITE — RUNNING AHEAD OF STATED PLAN',
};

export const STATUS_META: Record<ThesisStatus, { label: string; color: string; dot: string; meaning: string }> = {
  EVIDENCE_INCOMPLETE: { label: 'EVIDENCE INCOMPLETE', color: '#64748B', dot: '○',
    meaning: 'The core variables this thesis rests on have not been checked yet. The financial trend is shown for what it is; no verdict is claimed on top of it.' },
  STRENGTHENING: { label: 'THESIS STRENGTHENING', color: '#10B981', dot: '🟢',
    meaning: 'Structural mechanism confirmed and supporting output confirmed. No thesis-specific break condition fired.' },
  NEUTRAL: { label: 'NO MATERIAL CHANGE', color: '#94A3B8', dot: '⚪',
    meaning: 'Nothing in the latest evidence moves the thesis either way.' },
  WEAKENING: { label: 'THESIS WEAKENING', color: '#F59E0B', dot: '🟠',
    meaning: 'Important evidence deteriorated. This is a prompt to look, not to sell.' },
  BROKEN: { label: 'THESIS BROKEN', color: '#EF4444', dot: '🔴',
    meaning: 'A core assumption behind owning this has been invalidated by the evidence.' },
  CONFIRMATION_REQUIRED: { label: 'CONFIRMATION REQUIRED', color: '#FBBF24', dot: '🟡',
    meaning: 'The numbers improved, but the operating mechanism behind them has not been established. Good results are the RESULT of a thesis, never proof that it is intact.' },
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
}

export function assessThesis(input: AssessInput): ThesisAssessment {
  const thesis = thesisFor(input.pattern);
  const found = byKey(input.variables);
  const cmp = input.comparisons || {};

  const graderMissing = input.hasGraderRow === false;
  const checked: CheckedVariable[] = thesis.variables.map((tv: ThesisVariable) => {
    const v = found[tv.key];
    // ── SILENCE ON A RISK IS A CHECK THAT PASSED.                  (zzz757)
    //
    // Three documents read and no one-off found is the forensic test
    // passing, not a gap in the evidence. Recorded as flat: checked, and
    // nothing found. Never improving — absence is not a positive finding.
    const comparison = cmp[tv.key] || null;
    // ── A VARIABLE THAT STOPPED BEING DISCLOSED IS NOT SILENCE.    (zzz758)
    //
    // The pass-on-silence rule was written for risks nobody mentioned. It must
    // not absolve a company that disclosed a figure for four quarters and has
    // now gone quiet on it — that is a disclosure DECISION, and the card says
    // so with the last known value beside it.
    const stoppedDisclosing = !v && comparison?.change_type === 'NOT_DISCLOSED';
    const silencePasses = !v && !stoppedDisclosing && !!input.evidenceReviewed && SILENCE_IS_A_PASS.has(tv.key);
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
      evidence: v?.evidence || (stoppedDisclosing
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
      // The four absences are different facts and only one of them is fixable
      // by pressing a button. A grader-available variable that is still blank
      // after the row was loaded means the source simply did not carry it.
      absence: v || silencePasses ? null
        // A fetch that failed is not a company that was silent. (zzz765)
        : input.sourceUnavailable && !input.evidenceReviewed ? 'source_unavailable'
        : graderMissing && GRADER_AVAILABLE.has(tv.key) && input.evidenceReviewed ? 'no_grader_row'
          : input.evidenceReviewed ? 'not_disclosed'
            : GRADER_AVAILABLE.has(tv.key) ? 'not_disclosed' : 'not_read',
    };
  });

  const disclosed = checked.filter((c) => c.verdict !== 'unknown');
  // Thesis-critical = everything this ledger weights 3 or 4. The denominator
  // of the evidence matrix, and the only honest answer to "how much of this
  // thesis has been examined".
  const critical = checked.filter((c) => c.weight >= 3);
  const core = checked.filter((c) => c.weight === 4);
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
    && (input.evidenceReviewed === true || thesis.pattern !== 'UNCLASSIFIED');
  const coreDown = coreDisclosed.filter((c) => c.verdict === 'deteriorating' && mayMoveStatus(c));
  const supportDown = checked.filter((c) => c.weight === 3 && c.verdict === 'deteriorating' && mayMoveStatus(c));
  // ── CASH IS CORE ONLY WHERE THE LEDGER SAYS SO.                 (zzz765c)
  //
  // F, G and the unclassified ledger weight cash conversion 4: there a bad
  // reading may move the status, to WEAKENING at most. A and B weight it 2 —
  // context, shown as a warning so it is never hidden, and never a mover.
  const cashCore = checked.some((c) => c.key === 'cash_conversion' && c.weight === 4);
  const financialWarning = checked
    .filter((c) => c.verdict === 'deteriorating'
      && ((c.weight >= 3 && !mayMoveStatus(c)) || (c.key === 'cash_conversion' && !cashCore)))
    .map((c) => ({ label: c.label, value: c.delta || c.after || 'deteriorating' }));
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
  const structuralVars = checked.filter((c) => structuralKeys.has(c.key)
    && !isFinancialOutput(c.key, c.source));
  const structurallyConfirmed = (c: CheckedVariable): boolean =>
    c.kind !== 'claim' && !isFinancialOutput(c.key, c.source)
    && (c.verdict === 'improving' || (c.verdict === 'flat' && SILENCE_IS_A_PASS.has(c.key) && !!input.evidenceReviewed));
  // Required = what the ledger weights 3+. Grader operating leverage is
  // excluded above, so A's gate is the physical one: utilisation and volume.
  const structuralRequired = structuralVars.filter((c) => c.weight >= 3);
  const structuralConfirmedVars = structuralVars.filter(structurallyConfirmed);
  const missingRequired = structuralRequired.filter((c) => !structurallyConfirmed(c));
  const structuralGate = structuralRequired.length > 0 && missingRequired.length === 0
    && structuralConfirmedVars.some((c) => c.verdict === 'improving');

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
    ? ` Not yet established: ${missingRequired.map((c) => `${c.label.toLowerCase()}${c.verdict === 'stated' ? ' (level only)' : c.verdict === 'unknown' ? ' (not disclosed)' : ` (${c.verdict})`}`).join(', ')}.`
    : '';

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
  } else if (coreDown.length >= 1 || supportDown.length >= 2) {
    status = 'WEAKENING';
    const downAll = checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating');
    because = `Thesis-critical mechanism deteriorating — `
      + `${downAll.map((c) => `${c.label.toLowerCase()} ${c.delta || c.after || ''}`.trim()).join(', ')}. `
      + (coreTriggered.length
        ? `The condition "${coreTriggered[0].invalidation}" has fired once; a break needs it confirmed or a second core condition alongside it. `
        : 'No stated thesis-break condition has been met. ')
      + (coreTriggered.some((c) => c.key === 'cash_conversion')
        ? 'A single cash-conversion reading is a review prompt and never a break on its own. ' : '')
      + 'A weak quarter is not a broken thesis — this is a prompt to look, not to act.';
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
      + `The documents were read and disclose nothing about ${silent.join(' or ')}. `
      + 'Silence is evidence about disclosure, never confirmation of a mechanism — '
      + 'so the numbers stand and the reason behind them remains unestablished.';
  } else if (coreDisclosed.length < core.length
      && core.some((c) => c.absence === 'no_grader_row')) {
    // No graded row AND no results filing with the figure on its first page.
    // Since zzz762 the filing's headline block fills these; the remaining
    // cases are holdings whose documents read were transcripts and decks
    // only, or were read before the headline was asked for.
    const gm = core.filter((c) => c.absence === 'no_grader_row').map((c) => c.label.toLowerCase());
    status = 'EVIDENCE_INCOMPLETE';
    because = `${gm.join(' and ')} ${gm.length === 1 ? 'is' : 'are'} not on file: this company has no graded or screener row, `
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
    because = disclosed.length
      ? `Only ${disclosed.length} of ${checked.length} variables could be read, and none of them is decisive. `
        + 'Too little has been looked at to call this either way.'
      : input.evidenceReviewed
        ? 'Documents were read, but nothing in them maps to a variable this thesis rests on, '
          + 'and there is no graded or screener row to supply the financial ones. '
          + 'The filings are on file; the thesis variables are not in them.'
        : 'Nothing has been read for this holding — no graded result, no screener row, no filing. '
          + 'This is an unchecked holding, not a quiet one.';
  } else if (coreDisclosed.length < core.length) {
    // Nothing is deteriorating, and the thesis has not been fully checked. A
    // positive verdict is not available here, and neither is a comfortable
    // "no material change" — both would claim more than has been looked at.
    const missing = core.filter((c) => c.verdict === 'unknown').map((c) => c.label.toLowerCase());
    status = 'EVIDENCE_INCOMPLETE';
    because = `${coreDisclosed.length}/${core.length} core variables checked. `
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
  } else if (coreUp.length >= 1 && weighted >= 6 && allDimsConfirmed && input.evidenceReviewed
      && structuralGate && outputImproved) {
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
    because = `no thesis-specific break condition fired. ${structuralLine} Financial output: ${outputSummary}. `
      + `${STRENGTHENING_SENTENCE.replace(/\.$/, '')} — `
      + `${structuralConfirmedVars.map((c) => {
        const v = c.delta || c.after;
        return `${c.label.toLowerCase()} ${c.verdict === 'flat' ? '(checked, nothing material)'
          : v && v.length <= 32 ? v : '(confirmed in the documents read)'}`;
      }).join(', ')}.`;
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
    status = 'CONFIRMATION_REQUIRED';
    const down = checked.filter((c) => c.weight >= 3 && c.verdict === 'deteriorating');
    because = `${down.map((c) => c.label.toLowerCase()).join(', ')} moved the wrong way. `
      + 'Not enough to call the thesis weakening, too much to call it unchanged.';
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
  } else {
    status = 'NEUTRAL';
    because = `Every dimension this thesis rests on was reviewed and ${disclosed.length} of ${checked.length} `
      + 'variables carried evidence. None of it moves the thesis either way.';
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
    ? 'RESULTS FIGURES NOT ON FILE'
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
      if (c.verdict === 'stated' && known) {
        return `${c.label} — ${known} recorded with no earlier figure on file. `
          + `Next period's read turns it into a direction: above ${known} confirms, below it contradicts.`;
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
  const mechanismCheck = checked
    .filter((c) => c.weight >= 3 && !isFinancialOutput(c.key, c.source) && VAR_DIMENSION[c.key] !== 'forward')
    .map((c) => ({
      link: c.label,
      state: (structurallyConfirmed(c) ? 'confirmed'
        : c.verdict === 'deteriorating' ? 'contradicted' : 'unchecked') as 'confirmed' | 'contradicted' | 'unchecked',
    }));
  const confirmedLinks = mechanismCheck.filter((m) => m.state === 'confirmed').length;
  const contradicted = mechanismCheck.filter((m) => m.state === 'contradicted');
  const unchecked = mechanismCheck.filter((m) => m.state === 'unchecked');
  const mechanismVerdict = !mechanismCheck.length
    ? `${thesis.name} NOT YET CONFIRMED — this ledger has no thesis-critical structural variable; financial output alone cannot confirm a mechanism.`
    : contradicted.length
    ? `${thesis.name} CONTRADICTED — ${contradicted.map((m) => m.link.toLowerCase()).join(', ')} moving the wrong way.`
    : unchecked.length
      ? `${thesis.name} NOT YET CONFIRMED — ${confirmedLinks} of ${mechanismCheck.length} links hold; `
        + `${unchecked.map((m) => m.link.toLowerCase()).join(', ')} still open.`
      : `${thesis.name} CONFIRMED — all ${mechanismCheck.length} links of the mechanism hold on this evidence.`;

  const headline = status === 'STRENGTHENING' ? STRENGTHENING_SENTENCE
    : status === 'CONFIRMATION_REQUIRED' && because.startsWith(OUTPUT_ONLY_SENTENCE)
      ? `CONFIRMATION REQUIRED — ${OUTPUT_ONLY_SENTENCE.charAt(0).toLowerCase()}${OUTPUT_ONLY_SENTENCE.slice(1)}`
      : STATUS_META[status].label;

  return {
    status, thesis, checked, triggered, invalidationConditions, nextConfirmation, because, financialWarning,
    mechanismCheck, mechanismVerdict, dimensions,
    structural: {
      confirmed: structuralConfirmedVars.length, total: structuralVars.length,
      confirmedLabels: structuralConfirmedVars.map((c) => c.label),
      required: structuralRequired.map((c) => c.label),
      missingRequired: missingRequired.map((c) => c.label),
      gatePassed: structuralGate,
    },
    outputSummary, headline, actionLine: `${action} — ${because}`,
    changes, causeSummary, statusChangeReason,
    historyDepth: input.historyDepth ?? 0,
    coverage: {
      checked: checked.length, disclosed: disclosed.length,
      corePossible: core.length, coreDisclosed: coreDisclosed.length,
      criticalTotal: critical.length,
      criticalConfirmed: critical.filter((c) => c.verdict === 'improving').length,
      criticalPending: critical.filter((c) => c.verdict === 'unknown').length,
      criticalContradicted: critical.filter((c) => c.verdict === 'deteriorating').length,
      // OUTPUT is anything a grader row can supply — revenue, margin,
      // earnings, leverage, AND cash conversion / ROCE. MECHANISM is what
      // only a document can supply. The dividing line is the data source,
      // because that is exactly the line the "4 confirmed" bug crossed.
      output: tally(critical.filter((c) => isOutput(c.key))),
      mechanism: tally(critical.filter((c) => !isOutput(c.key) && VAR_DIMENSION[c.key] !== 'forward')),
      forward: tally(critical.filter((c) => VAR_DIMENSION[c.key] === 'forward')),
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
