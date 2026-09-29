// zzz837 — THE PRIOR QUARTER'S VERDICT PER VARIABLE.
// A break condition written over time ("two consecutive quarters") fires only
// when this quarter AND the prior one both read deteriorating. The prior
// quarter is assessed here from ITS OWN summary and the ledger as it stood
// then — never from this quarter's results row (a prior row is not on file, so
// grader-computed variables of the prior quarter stay unknown, and unknown is
// never read as deteriorating). Null when no prior period with a read exists.

import { assessThesis, type AssessInput } from './status';
import { buildComparisons, historyDepth } from './comparison';
import { extractVariables } from './variables';
import { periodOrdinal, type CompanyLedger } from './evidence-ledger';
import type { VarKey } from './taxonomy';
import type { VarVerdict } from './variables';

export function priorVerdictsOf(
  ledger: CompanyLedger | null | undefined,
  base: Pick<AssessInput, 'pattern' | 'patternFit' | 'indiaDisclosure' | 'business' | 'financialKind'>,
): Partial<Record<VarKey, VarVerdict>> | null {
  try {
    const { periods } = historyDepth(ledger || null);
    if (!ledger || periods.length < 2) return null;
    const priorKey = periods[periods.length - 2];
    const pr = ledger.periods[priorKey];
    if (!pr?.summary) return null;
    const kept: CompanyLedger['periods'] = {};
    for (const k of periods) if (periodOrdinal(k) <= periodOrdinal(priorKey)) kept[k] = ledger.periods[k];
    const pl: CompanyLedger = { ...ledger, periods: kept, latest_period: priorKey };
    const comps = buildComparisons(pl);
    const vars = extractVariables(null, pr.summary, comps, { period: priorKey, documents: pr.documents || null, ledger: pl });
    const a = assessThesis({
      ...base, variables: vars, comparisons: comps, historyDepth: Object.keys(kept).length, previousStatus: null,
      evidenceReviewed: true, hasGraderRow: false, priorVerdicts: null,
    } as AssessInput);
    const out: Partial<Record<VarKey, VarVerdict>> = {};
    for (const c of a.checked || []) if (c.verdict && c.verdict !== 'unknown') out[c.key] = c.verdict;
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
