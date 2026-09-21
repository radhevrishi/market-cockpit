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
// FIVE STATUSES, from the spec, and no more. The instruction was explicit:
// "Don't create 50 scores."
//
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
import { byKey, type StructuralVar, type VarKey, type VarVerdict } from './variables';

export type ThesisStatus =
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
  coverage: { checked: number; disclosed: number; corePossible: number; coreDisclosed: number };
  /** The action the OWNER takes. Never a trade. */
  action: 'Hold — no action' | 'Watch' | 'Review' | 'EXIT REVIEW' | 'Re-underwrite expectations';
}

const ACTION: Record<ThesisStatus, ThesisAssessment['action']> = {
  STRENGTHENING: 'Hold — no action',
  NEUTRAL: 'Watch',
  WEAKENING: 'Review',
  BROKEN: 'EXIT REVIEW',
  EXPECTATION_GAP: 'Re-underwrite expectations',
};

export const STATUS_META: Record<ThesisStatus, { label: string; color: string; dot: string; meaning: string }> = {
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
      key: tv.key, label: v?.label || tv.key, weight: tv.weight, why: tv.why,
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
  } else if (coreUp.length >= 1 && weighted >= 6) {
    status = 'STRENGTHENING';
    because = `${coreUp.map((c) => c.label.toLowerCase()).join(' and ')} improved, with nothing core moving against it.`;
  } else if (!disclosed.length) {
    status = 'NEUTRAL';
    because = 'No structural variable was disclosed in the latest evidence. Nothing has been shown to change.';
  } else {
    status = 'NEUTRAL';
    because = `${disclosed.length} variables read, none of them decisive either way.`;
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

  return {
    status, thesis, checked, triggered, invalidationConditions, nextConfirmation, because,
    coverage: {
      checked: checked.length, disclosed: disclosed.length,
      corePossible: core.length, coreDisclosed: coreDisclosed.length,
    },
    action: ACTION[status],
  };
}
