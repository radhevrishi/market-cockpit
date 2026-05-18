// ═══════════════════════════════════════════════════════════════════════════
// P/E × FORWARD EPS
//
// FairPrice = exit_PE × forward_EPS
// forward_EPS = current_EPS × (1 + growth)
// Bull / Base / Bear differ on exit P/E and on growth.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import type { ScenarioSet } from '../scenario';

export function peMultipleModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  if (!inp.eps || inp.eps <= 0) {
    return { modelId: 'PE_FWD', label: 'P/E × Fwd EPS', applicable: false, reason: 'EPS ≤ 0' };
  }
  // Use profit growth if available (better proxy for EPS growth); fall back to sales
  const epsG = inp.epsGrowth ?? inp.profitGrowth3y ?? inp.yoyProfitGrowth ?? (sc.growth5y.base * 100);

  const bearG = Math.min(epsG * 0.5, sc.growth5y.bear * 100) / 100;
  const baseG = epsG / 100;
  const bullG = Math.max(epsG * 1.1, sc.growth5y.bull * 100) / 100;

  const bear = inp.eps * (1 + bearG) * sc.exitPe.bear;
  const base = inp.eps * (1 + baseG) * sc.exitPe.base;
  const bull = inp.eps * (1 + bullG) * sc.exitPe.bull;
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'PE_FWD',
    label: 'P/E × Fwd EPS',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `FwdEPS ₹${(inp.eps * (1 + baseG)).toFixed(1)} × ${sc.exitPe.base.toFixed(0)}× exit P/E`,
    assumptionsUsed: {
      eps_growth_pct: +(baseG * 100).toFixed(1),
      exit_pe: +sc.exitPe.base.toFixed(1),
    },
  };
}
