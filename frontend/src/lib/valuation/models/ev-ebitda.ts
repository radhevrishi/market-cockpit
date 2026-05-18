// ═══════════════════════════════════════════════════════════════════════════
// EV / EBITDA FORWARD MULTIPLE
//
// Project EBITDA 1 year forward (using growth rate × margin scenario),
// apply exit multiple, subtract net debt, divide by shares.
//   FairValue = (FwdEBITDA × exitEvEbitda − NetDebt) / shares
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import type { ScenarioSet } from '../scenario';

export function evEbitdaModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  if (!inp.salesCr || inp.salesCr <= 0) {
    return { modelId: 'EV_EBITDA', label: 'EV/EBITDA Forward', applicable: false, reason: 'no revenue' };
  }
  if (!inp.sharesCr || inp.sharesCr <= 0) {
    return { modelId: 'EV_EBITDA', label: 'EV/EBITDA Forward', applicable: false, reason: 'shares not derivable' };
  }
  if (sc.exitEvEbitda.base === 0) {
    return { modelId: 'EV_EBITDA', label: 'EV/EBITDA Forward', applicable: false, reason: 'sector uses P/B-ROE not EV/EBITDA' };
  }

  const netDebt = inp.netDebtCr ?? 0;
  function priceAt(growth: number, margin: number, exitMult: number): number {
    const fwdSales = inp.salesCr! * (1 + growth);
    const fwdEbitda = fwdSales * margin;
    const ev = fwdEbitda * exitMult;
    return Math.max(0, (ev - netDebt) / inp.sharesCr!);
  }

  const bear = priceAt(sc.growth5y.bear, sc.ebitdaMargin.bear, sc.exitEvEbitda.bear);
  const base = priceAt(sc.growth5y.base, sc.ebitdaMargin.base, sc.exitEvEbitda.base);
  const bull = priceAt(sc.growth5y.bull, sc.ebitdaMargin.bull, sc.exitEvEbitda.bull);
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'EV_EBITDA',
    label: 'EV/EBITDA Forward',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `FwdEBITDA × ${sc.exitEvEbitda.base.toFixed(0)}× exit · Margin ${(sc.ebitdaMargin.base*100).toFixed(0)}%`,
    assumptionsUsed: {
      growth_pct: +(sc.growth5y.base * 100).toFixed(1),
      ebitda_margin_pct: +(sc.ebitdaMargin.base * 100).toFixed(1),
      exit_ev_ebitda: +sc.exitEvEbitda.base.toFixed(1),
    },
  };
}
