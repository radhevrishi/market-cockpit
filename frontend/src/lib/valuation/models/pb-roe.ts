// ═══════════════════════════════════════════════════════════════════════════
// P/B × ROE (Banks & NBFCs)
//
//   JustifiedPB = (ROE − g) / (CostOfEquity − g)
// Fair price = JustifiedPB × Book Value per Share
//
// DCF doesn't apply to banks (FCF is meaningless for leveraged book-value
// businesses). P/B-ROE is the standard institutional approach.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import { getAssumptions } from '../assumptions';
import type { ScenarioSet } from '../scenario';

export function pbRoeModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  const a = getAssumptions(inp.sector);
  if (!a.pbRoeApplicable) {
    return { modelId: 'PB_ROE', label: 'P/B × ROE', applicable: false, reason: 'non-bank/NBFC sector' };
  }
  if (!inp.bookValuePerShare || inp.bookValuePerShare <= 0) {
    return { modelId: 'PB_ROE', label: 'P/B × ROE', applicable: false, reason: 'no book value' };
  }
  if (!inp.roe || inp.roe <= 0) {
    return { modelId: 'PB_ROE', label: 'P/B × ROE', applicable: false, reason: 'no ROE' };
  }

  const r = a.costOfEquity;
  const tg = sc.terminalGrowth;

  function pbAt(roe: number, costEq: number, growth: number): number {
    const g = Math.min(growth, costEq - 0.015);
    const justifiedPb = (roe / 100 - g) / (costEq - g);
    return Math.max(0, justifiedPb * inp.bookValuePerShare!);
  }

  const bear = pbAt(inp.roe * 0.85, sc.wacc.bear, tg);
  const base = pbAt(inp.roe, r, Math.min(sc.growth5y.base, tg + 0.06));
  const bull = pbAt(inp.roe * 1.10, sc.wacc.bull, Math.min(sc.growth5y.base + 0.02, tg + 0.08));
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'PB_ROE',
    label: 'P/B × ROE (Banks)',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `BVPS ₹${inp.bookValuePerShare.toFixed(0)} · ROE ${inp.roe.toFixed(0)}% · r ${(r*100).toFixed(1)}%`,
    assumptionsUsed: {
      bvps: +inp.bookValuePerShare.toFixed(2),
      roe_pct: +inp.roe.toFixed(1),
      cost_of_equity_pct: +(r * 100).toFixed(1),
    },
  };
}
