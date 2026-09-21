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
import { VAR_LABEL, GRADER_AVAILABLE, type VarKey } from './taxonomy';

export type ThesisStatus =
  | 'EVIDENCE_INCOMPLETE'
  | 'STRENGTHENING' | 'NEUTRAL' | 'WEAKENING' | 'BROKEN' | 'EXPECTATION_GAP';

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
  /** How much of the thesis could be checked at all. */
  coverage: {
    checked: number; disclosed: number; corePossible: number; coreDisclosed: number;
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
  action: 'Hold — no action' | 'Watch' | 'Review' | 'EXIT REVIEW' | 'Re-underwrite expectations' | 'Read the filing';
  /** Each link of the thesis mechanism, and whether the evidence confirms it.
   *  The spec's "OPERATING LEVERAGE CONFIRMED", rather than "earnings beat". */
  mechanismCheck: Array<{ link: string; state: 'confirmed' | 'contradicted' | 'unchecked' }>;
  mechanismVerdict: string;
}

const ACTION: Record<ThesisStatus, ThesisAssessment['action']> = {
  EVIDENCE_INCOMPLETE: 'Read the filing',
  STRENGTHENING: 'Hold — no action',
  NEUTRAL: 'Watch',
  WEAKENING: 'Review',
  BROKEN: 'EXIT REVIEW',
  EXPECTATION_GAP: 'Re-underwrite expectations',
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
  EXPECTATION_GAP: { label: 'EXPECTATION GAP', color: '#A78BFA', dot: '🟣',
    meaning: 'The business is running materially away from what management implied. Neither good nor bad — re-underwrite.' },
};

const SIGN: Record<VarVerdict, number> = { improving: 1, flat: 0, deteriorating: -1, unknown: 0 };

export interface AssessInput {
  pattern: AbfgPattern | null | undefined;
  variables: StructuralVar[];
  /** From guidance-ledger: a promise made earlier that this quarter can be
   *  checked against. Absent on the first quarter a holding is tracked. */
  promiseGap?: { gap: boolean; detail: string } | null;
}

export function assessThesis(input: AssessInput): ThesisAssessment {
  const thesis = thesisFor(input.pattern);
  const found = byKey(input.variables);

  const checked: CheckedVariable[] = thesis.variables.map((tv: ThesisVariable) => {
    const v = found[tv.key];
    // A variable the company did not disclose is UNKNOWN, never deteriorating.
    const verdict: VarVerdict = v ? v.verdict : 'unknown';
    const fired = !!tv.invalidatedWhen && verdict === 'deteriorating';
    return {
      // An undisclosed variable has no extracted row, so `v` is null and the
      // label used to fall back to the raw KEY — the page printed
      // "○ one_offs" and "○ cash_conversion" next to properly-named ones.
      // VAR_LABEL is the single source of the human name. (zzz719)
      key: tv.key, label: v?.label || VAR_LABEL[tv.key] || tv.key, weight: tv.weight, why: tv.why,
      verdict,
      before: v?.before ?? null, after: v?.after ?? null, delta: v?.delta ?? null,
      evidence: v?.evidence || 'Not disclosed in the latest filing — this is silence, not bad news.',
      invalidation: fired ? tv.invalidatedWhen : null,
    };
  });

  const disclosed = checked.filter((c) => c.verdict !== 'unknown');
  const core = checked.filter((c) => c.weight === 4);
  const coreDisclosed = core.filter((c) => c.verdict !== 'unknown');
  const coreDown = coreDisclosed.filter((c) => c.verdict === 'deteriorating');
  const coreUp = coreDisclosed.filter((c) => c.verdict === 'improving');
  const supportDown = checked.filter((c) => c.weight === 3 && c.verdict === 'deteriorating');
  const guidanceDown = checked.some((c) => c.key === 'guidance' && c.verdict === 'deteriorating');

  const weighted = checked.reduce((a, c) => a + SIGN[c.verdict] * c.weight, 0);

  // ── THE STATUS LADDER, most severe first. ──────────────────────────────
  let status: ThesisStatus;
  let because: string;

  if (coreDown.length >= 2) {
    status = 'BROKEN';
    because = `Two core variables deteriorated together — ${coreDown.map((c) => c.label.toLowerCase()).join(' and ')}. `
      + 'The mechanism that justified owning this is not working.';
  } else if (coreDown.length === 1 && guidanceDown) {
    status = 'BROKEN';
    because = `${coreDown[0].label} deteriorated AND management reduced its own forward expectations. `
      + 'The company agrees the mechanism has stopped.';
  } else if (coreDown.length === 1 && supportDown.length >= 2) {
    status = 'BROKEN';
    because = `${coreDown[0].label} deteriorated with ${supportDown.length} supporting variables down alongside it — `
      + 'not one weak quarter, a pattern across the mechanism.';
  } else if (input.promiseGap?.gap) {
    // Ranked BELOW a break and ABOVE weakening: a company can be delivering
    // fine in absolute terms while missing what it told you, and that is a
    // different problem needing a different response.
    status = 'EXPECTATION_GAP';
    because = input.promiseGap.detail;
  } else if (coreDown.length === 1 || supportDown.length >= 2) {
    status = 'WEAKENING';
    because = coreDown.length === 1
      ? `${coreDown[0].label} deteriorated. One core variable down is a reason to look, not to act — `
        + 'a single weak quarter is exactly what this ledger exists to stop you selling into.'
      : `${supportDown.length} supporting variables deteriorated (${supportDown.map((c) => c.label.toLowerCase()).join(', ')}).`;
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
    because = disclosed.length
      ? `Only ${disclosed.length} of ${checked.length} variables could be read, and none of them is decisive. `
        + 'Too little has been looked at to call this either way.'
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
      + (disclosed.length
        ? 'Nothing read so far is deteriorating, but a positive verdict is not available on variables nobody has looked at.'
        : 'Nothing has been read for this holding at all.');
  } else if (coreUp.length >= 1 && weighted >= 6) {
    status = 'STRENGTHENING';
    because = `${coreUp.map((c) => c.label.toLowerCase()).join(' and ')} improved, `
      + `and every core variable of this thesis was checked — ${core.map((c) => c.label.toLowerCase()).join(', ')}.`;
  } else {
    status = 'NEUTRAL';
    because = `All ${core.length} core variable${core.length === 1 ? '' : 's'} checked and `
      + `${disclosed.length} of ${checked.length} variables read — none of them decisive either way.`;
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
          : c.verdict === 'unknown' ? 'unknown'
            : c.verdict === 'flat' ? 'watch' : 'ok';
      return { condition: tv.invalidatedWhen, weight: tv.weight, status: st };
    })
    .sort((a, b) => b.weight - a.weight);

  const nextConfirmation = checked
    .filter((c) => c.weight >= 3 && (c.verdict === 'unknown' || c.verdict === 'flat'))
    .slice(0, 3)
    .map((c) => c.verdict === 'unknown'
      ? `${c.label} — not disclosed this time. Whether it is disclosed next quarter is itself information.`
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
    status, thesis, checked, triggered, invalidationConditions, nextConfirmation, because,
    mechanismCheck, mechanismVerdict,
    coverage: {
      checked: checked.length, disclosed: disclosed.length,
      corePossible: core.length, coreDisclosed: coreDisclosed.length,
      missingCore: core.filter((c) => c.verdict === 'unknown').map((c) => c.label),
      missingNeedsFiling: checked
        .filter((c) => c.verdict === 'unknown' && c.weight >= 3 && !GRADER_AVAILABLE.has(c.key))
        .map((c) => c.label),
    },
    action: ACTION[status],
  };
}
