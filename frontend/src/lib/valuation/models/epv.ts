// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS POWER VALUE (Bruce Greenwald)
//
// EPV strips growth assumptions entirely — values just the existing
// franchise's no-growth earnings power.
//   EPV = (normalized EBIT × (1 − tax)) / WACC
// Subtract net debt, divide by shares. Useful for cyclicals where DCF
// growth assumptions are unreliable.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import type { ScenarioSet } from '../scenario';

export function epvModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  let ebit = inp.ebitCr;
  // Fall back: derive EBIT from OPM × Sales (proxy — actual EBIT excludes D&A)
  if (ebit === undefined && inp.salesCr && inp.opm) {
    // EBIT ≈ Sales × OPM × 0.9 (account for D&A drag — rough adjustment)
    ebit = inp.salesCr * (inp.opm / 100) * 0.9;
  }
  if (!ebit || ebit <= 0) {
    return { modelId: 'EPV', label: 'EPV (Greenwald)', applicable: false, reason: 'no positive EBIT' };
  }
  if (!inp.sharesCr || inp.sharesCr <= 0) {
    return { modelId: 'EPV', label: 'EPV (Greenwald)', applicable: false, reason: 'shares not derivable' };
  }

  const taxedEbit = ebit * (1 - sc.taxRate);
  const netDebt = inp.netDebtCr ?? 0;

  // EPV doesn't vary by growth scenario — only by WACC and the
  // normalization band. Use ±20% on EBIT for bull/bear normalization.
  function epvAt(ebitVal: number, wacc: number): number {
    const equity = (ebitVal * (1 - sc.taxRate)) / wacc - netDebt;
    return Math.max(0, equity / inp.sharesCr!);
  }

  const bear = epvAt(ebit * 0.8, sc.wacc.bear);
  const base = epvAt(ebit, sc.wacc.base);
  const bull = epvAt(ebit * 1.2, sc.wacc.bull);
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'EPV',
    label: 'EPV (Greenwald)',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `(EBIT × ${(1-sc.taxRate).toFixed(2)}) ÷ WACC ${(sc.wacc.base*100).toFixed(1)}% · no growth`,
    assumptionsUsed: {
      ebit_cr: +ebit.toFixed(0),
      wacc_pct: +(sc.wacc.base * 100).toFixed(1),
      tax_pct: +(sc.taxRate * 100).toFixed(1),
    },
  };
}
