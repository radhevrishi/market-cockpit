// ═══════════════════════════════════════════════════════════════════════════
// JUSTIFIED P/E (Gordon Growth)
//
//   JustifiedPE = (1 − retention) × (1 + g) / (r − g)
// where:
//   retention = 1 − payout = g / ROE  (sustainable growth identity)
//   r = cost of equity
//   g = long-term growth
//
// Compare to actual market P/E — if actual P/E ≫ justified, the stock is
// mathematically expensive even before any cash-flow analysis.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import { getAssumptions } from '../assumptions';
import type { ScenarioSet } from '../scenario';

export function justifiedPeModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  if (!inp.eps || inp.eps <= 0) {
    return { modelId: 'JUSTIFIED_PE', label: 'Justified P/E', applicable: false, reason: 'EPS ≤ 0' };
  }
  const roe = inp.roe ?? inp.roce;  // ROE preferred; ROCE as fallback
  if (!roe || roe <= 0) {
    return { modelId: 'JUSTIFIED_PE', label: 'Justified P/E', applicable: false, reason: 'no ROE/ROCE' };
  }
  // PATCH 0478 — Gordon Growth Model fundamentally breaks when growth
  // approaches cost of equity (denominator → 0). For high-growth names
  // (>18% sales/profit CAGR) the model has to cap growth at near-terminal
  // levels, which gives unrealistically low fair P/E. The model is
  // designed for stable / mature businesses. Skip for growth names.
  const g = inp.salesGrowth3y ?? inp.profitGrowth3y;
  if (g !== undefined && g > 18) {
    return { modelId: 'JUSTIFIED_PE', label: 'Justified P/E', applicable: false, reason: `growth ${g.toFixed(0)}% — Gordon model breaks above 18% growth` };
  }
  const a = getAssumptions(inp.sector);
  const r = a.costOfEquity;
  const tg = sc.terminalGrowth;

  function justified(growth: number, costEq: number): number {
    // Cap growth strictly below cost of equity for Gordon model stability
    const g = Math.min(growth, costEq - 0.015);
    const retention = Math.max(0, Math.min(1, g / (roe! / 100)));
    const payout = 1 - retention;
    const num = payout * (1 + g);
    const den = costEq - g;
    if (den <= 0.001) return 0;
    const pe = num / den;
    return Math.max(0, pe * inp.eps!);
  }

  const bear = justified(tg, sc.wacc.bear);
  const base = justified(Math.min(sc.growth5y.base, tg + 0.08), r);  // long-term sustainable
  const bull = justified(Math.min(sc.growth5y.base + 0.02, tg + 0.10), sc.wacc.bull);
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'JUSTIFIED_PE',
    label: 'Justified P/E (Gordon)',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `ROE ${roe.toFixed(0)}% · r ${(r*100).toFixed(1)}% · g_lt ${(tg*100).toFixed(1)}%`,
    assumptionsUsed: {
      roe_pct: +roe.toFixed(1),
      cost_of_equity_pct: +(r * 100).toFixed(1),
      terminal_g_pct: +(tg * 100).toFixed(1),
    },
  };
}
