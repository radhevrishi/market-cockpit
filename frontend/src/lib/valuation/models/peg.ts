// ═══════════════════════════════════════════════════════════════════════════
// PEG-IMPLIED FAIR PRICE
//
// FairPE = target_PEG × growth_rate
// FairPrice = FairPE × EPS
// Bull: target_PEG = 1.2 (premium acceptable); Base: 1.0 (Lynch baseline);
// Bear: target_PEG = 0.8 (deep value)
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import type { ScenarioSet } from '../scenario';

export function pegImpliedModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  if (!inp.eps || inp.eps <= 0) {
    return { modelId: 'PEG', label: 'PEG-Implied', applicable: false, reason: 'EPS ≤ 0' };
  }
  const g = (inp.epsGrowth ?? inp.profitGrowth3y ?? (sc.growth5y.base * 100));
  if (g <= 0) {
    return { modelId: 'PEG', label: 'PEG-Implied', applicable: false, reason: 'negative growth' };
  }
  // Don't let extreme growth blow up fair price — cap at 50%.
  const safeG = Math.min(g, 50);

  const bear = inp.eps * 0.8 * safeG;
  const base = inp.eps * 1.0 * safeG;
  const bull = inp.eps * 1.2 * safeG;
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'PEG',
    label: 'PEG-Implied',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `EPS ₹${inp.eps.toFixed(1)} × PEG-target × g ${safeG.toFixed(0)}%`,
    assumptionsUsed: {
      eps: +inp.eps.toFixed(2),
      growth_pct: +safeG.toFixed(1),
      target_peg_base: 1.0,
    },
  };
}
