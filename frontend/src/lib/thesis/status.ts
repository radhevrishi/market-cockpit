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
import { VAR_LABEL, GRADER_AVAILABLE, SILENCE_IS_A_PASS, VAR_DIMENSION, DIMENSION_LABEL, type VarKey, type VarDimension, type AbsenceReason } from './taxonomy';

/** A variable the grader can fill without a document is OUTPUT. (zzz738) */
const isOutput = (k: VarKey): boolean => VAR_DIMENSION[k] === 'financial' || GRADER_AVAILABLE.has(k);

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
    | 'EVIDENCE NOT YET REVIEWED' | 'CONFIRMATION REQUIRED'
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
    meaning: 'New evidence supports the reason you own this. Nothing to do.' },
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
  /** True when a graded or screener row exists for this company. Without one,
   *  revenue growth / earnings / margin / cash conversion / ROCE can never be
   *  filled by reading a filing, and the card must say so instead of asking
   *  for another read. (zzz757) */
  hasGraderRow?: boolean;
}

export function assessThesis(input: AssessInput): ThesisAssessment {
  const thesis = thesisFor(input.pattern);
  const found = byKey(input.variables);

  const graderMissing = input.hasGraderRow === false;
  const checked: CheckedVariable[] = thesis.variables.map((tv: ThesisVariable) => {
    const v = found[tv.key];
    // ── SILENCE ON A RISK IS A CHECK THAT PASSED.                  (zzz757)
    //
    // Three documents read and no one-off found is the forensic test
    // passing, not a gap in the evidence. Recorded as flat: checked, and
    // nothing found. Never improving — absence is not a positive finding.
    const silencePasses = !v && !!input.evidenceReviewed && SILENCE_IS_A_PASS.has(tv.key);
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
      evidence: v?.evidence || (silencePasses
        ? `The documents read disclose no ${(VAR_LABEL[tv.key] || tv.key).toLowerCase()}. For this variable that is the check passing: the condition "${tv.invalidatedWhen || 'it would have been disclosed'}" did not fire on anything that was read.`
        : graderMissing && GRADER_AVAILABLE.has(tv.key) && input.evidenceReviewed
          ? 'This figure is computed from the filed statements by the grading engine, and this company has no graded or screener row on file. Reading more filings cannot produce it.'
          : input.evidenceReviewed
            ? 'A document was read and is silent on this. Absence is evidence — a company that stops disclosing a figure has told you something — but it is never counted against the thesis.'
            : 'No evidence document has been read for this holding yet.'),
      invalidation: fired ? tv.invalidatedWhen : null,
      // The four absences are different facts and only one of them is fixable
      // by pressing a button. A grader-available variable that is still blank
      // after the row was loaded means the source simply did not carry it.
      absence: v || silencePasses ? null
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
  const financialWarning = checked
    .filter((c) => c.weight >= 3 && c.verdict === 'deteriorating' && !mayMoveStatus(c))
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
  if (coreTriggered.length >= 2 || (coreTriggered.length === 1 && guidanceDown)) {
    status = 'BROKEN';
    because = `Thesis-break condition met — ${coreTriggered.map((c) => `"${c.invalidation}"`).join(' AND ')}`
      + `${guidanceDown && coreTriggered.length === 1 ? ', alongside management reducing its own forward expectations' : ''}. `
      + `Evidence: ${coreTriggered.map((c) => `${c.label} ${c.delta || c.after || 'down'}`).join('; ')}.`;
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
    because = `The documents were read and disclose nothing about ${silent.join(' or ')}. `
      + 'Silence is evidence about disclosure, never confirmation of a mechanism — '
      + 'so the numbers stand and the reason behind them remains unestablished.';
  } else if (coreDisclosed.length < core.length
      && core.some((c) => c.absence === 'no_grader_row')) {
    // The one absence no amount of reading can fix.
    const gm = core.filter((c) => c.absence === 'no_grader_row').map((c) => c.label.toLowerCase());
    status = 'EVIDENCE_INCOMPLETE';
    because = `${gm.join(' and ')} ${gm.length === 1 ? 'is' : 'are'} computed from the filed statements by the grading engine, `
      + 'and this company has no graded or screener row on file. Reading more filings cannot fill '
      + `${gm.length === 1 ? 'it' : 'them'} — the name has to enter the graded universe first. `
      + 'Everything that COULD be read has been.';
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
    because = `${coreLevelOnly.map((c) => `${c.label.toLowerCase()} (${c.after || c.before})`).join(' and ')} `
      + `${coreLevelOnly.length === 1 ? 'was' : 'were'} disclosed as a level with nothing in the document to compare against, `
      + 'so the direction is unknown. The figure is recorded; next quarter turns it into a trend.';
  } else if (coreUp.length >= 1 && weighted >= 6 && allDimsConfirmed && input.evidenceReviewed) {
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
    status = 'STRENGTHENING';
    because = `${coreUp.map((c) => c.label.toLowerCase()).join(' and ')} improved, `
      + `and the mechanism is established in every dimension this thesis rests on — `
      + `${dimensions.map((d) => `${d.label} (${d.by[0]?.toLowerCase() || 'confirmed'})`).join(', ')}.`;
  } else if (unestablished.length) {
    // ── THE NEW MIDDLE. Good numbers, unproven mechanism.         (zzz723)
    //
    // This is the status AETHER and ANTELOPUS should have had: revenue and
    // cash improving, and capacity, orders, capex, customers and guidance all
    // untouched. Calling that STRENGTHENING told the owner his operating
    // thesis was confirmed when only its output had been observed.
    status = 'CONFIRMATION_REQUIRED';
    because = `The numbers improved, but ${unestablished.map((d) => d.label).join(' and ')} `
      + `${unestablished.length === 1 ? 'has' : 'have'} not been established. `
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
      ? `${coreUp.map((c) => c.label.toLowerCase()).join(' and ')} improved on the reported figures, `
        + 'but no filing, concall or announcement has been read — so nothing establishes WHY, '
        + 'and a result without a cause is not a confirmed thesis.'
      : 'Every variable available without reading a document has been checked and none is decisive. '
        + 'No filing, concall or announcement has been read, so "nothing changed" is not a claim this page can make yet.';
  } else {
    status = 'NEUTRAL';
    because = `Every dimension this thesis rests on was reviewed and ${disclosed.length} of ${checked.length} `
      + 'variables carried evidence. None of it moves the thesis either way.';
  }

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

  const nextConfirmation = checked
    .filter((c) => c.weight >= 3 && (c.verdict === 'unknown' || c.verdict === 'flat' || c.verdict === 'stated'))
    .slice(0, 3)
    .map((c) => c.verdict === 'unknown'
      ? `${c.label} — not disclosed this time. Whether it is disclosed next quarter is itself information.`
      : c.verdict === 'stated'
        ? `${c.label} — disclosed as a level (${c.after || c.before}) with nothing to compare against. Next quarter's figure turns it into a direction.`
        : `${c.label} — flat. It has to turn before the thesis can be called intact.`);

  // ── THE STRUCTURAL CHANGE DETECTOR.                            (zzz717)
  //
  // The spec's point: the output should be "OPERATING LEVERAGE CONFIRMED",
  // not "earnings beat". A mechanism is a chain of links, and a chain is only
  // confirmed when every link it can be checked on holds. One unchecked link
  // leaves the whole mechanism UNCONFIRMED — it does not average out to
  // "mostly confirmed", because a chain with an unexamined link is not a
  // chain you have examined.
  const mechanismCheck = thesis.variables
    .filter((tv) => tv.weight >= 3)
    .map((tv) => {
      const c = checked.find((x) => x.key === tv.key)!;
      return {
        link: c.label,
        state: (c.verdict === 'improving' ? 'confirmed'
          : c.verdict === 'deteriorating' ? 'contradicted'
            : c.verdict === 'flat' ? 'unchecked' : 'unchecked') as 'confirmed' | 'contradicted' | 'unchecked',
      };
    });
  const confirmedLinks = mechanismCheck.filter((m) => m.state === 'confirmed').length;
  const contradicted = mechanismCheck.filter((m) => m.state === 'contradicted');
  const unchecked = mechanismCheck.filter((m) => m.state === 'unchecked');
  const mechanismVerdict = contradicted.length
    ? `${thesis.name} CONTRADICTED — ${contradicted.map((m) => m.link.toLowerCase()).join(', ')} moving the wrong way.`
    : unchecked.length
      ? `${thesis.name} NOT YET CONFIRMED — ${confirmedLinks} of ${mechanismCheck.length} links hold; `
        + `${unchecked.map((m) => m.link.toLowerCase()).join(', ')} still open.`
      : `${thesis.name} CONFIRMED — all ${mechanismCheck.length} links of the mechanism hold on this evidence.`;

  return {
    status, thesis, checked, triggered, invalidationConditions, nextConfirmation, because, financialWarning,
    mechanismCheck, mechanismVerdict, dimensions,
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
      levelOnlyCore: coreLevelOnly.map((c) => c.label),
      missingNeedsFiling: checked
        .filter((c) => c.verdict === 'unknown' && c.weight >= 3 && !GRADER_AVAILABLE.has(c.key))
        .map((c) => c.label),
    },
    action: ACTION[status],
  };
}
