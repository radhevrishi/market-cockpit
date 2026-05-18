// ═══════════════════════════════════════════════════════════════════════════
// 2-STAGE DCF
//
// Stage 1: project FCF growing at the chosen growth rate for 5 years.
// Stage 2: fade to terminal growth, capitalize via Gordon Growth.
// Discount all cash flows at WACC. Net debt subtracted. Per-share value.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import { getAssumptions } from '../assumptions';
import type { ScenarioSet } from '../scenario';

function runDcf(
  fcf0: number, growth: number, wacc: number, terminalG: number,
  netDebt: number, sharesCr: number, fadePeriod = 5
): number {
  let pv = 0;
  let fcf = fcf0;
  for (let year = 1; year <= fadePeriod; year++) {
    fcf = fcf * (1 + growth);
    pv += fcf / Math.pow(1 + wacc, year);
  }
  // Terminal: capitalize at exit; discount back to today
  const terminalFcf = fcf * (1 + terminalG);
  const tv = terminalFcf / (wacc - terminalG);
  pv += tv / Math.pow(1 + wacc, fadePeriod);
  const equity = pv - netDebt;
  return equity / sharesCr;  // ₹ per share
}

export function dcfModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  const a = getAssumptions(inp.sector);
  if (!a.dcfApplicable) {
    return { modelId: 'DCF', label: '2-Stage DCF', applicable: false, reason: 'sector-not-dcf (banks/financials use P/B-ROE)' };
  }
  if (!inp.fcfCr || inp.fcfCr <= 0) {
    return { modelId: 'DCF', label: '2-Stage DCF', applicable: false, reason: 'no positive FCF' };
  }
  if (!inp.sharesCr || inp.sharesCr <= 0) {
    return { modelId: 'DCF', label: '2-Stage DCF', applicable: false, reason: 'shares not derivable' };
  }
  const netDebt = inp.netDebtCr ?? 0;
  const f0 = inp.fcfCr;
  const tg = sc.terminalGrowth;

  // Ensure wacc > terminal_g to avoid divide-by-near-zero
  const safe = (w: number) => Math.max(w, tg + 0.02);

  const bear = runDcf(f0, Math.max(sc.growth5y.bear, tg + 0.01), safe(sc.wacc.bear), tg, netDebt, inp.sharesCr);
  const base = runDcf(f0, Math.max(sc.growth5y.base, tg + 0.01), safe(sc.wacc.base), tg, netDebt, inp.sharesCr);
  const bull = runDcf(f0, Math.max(sc.growth5y.bull, tg + 0.01), safe(sc.wacc.bull), tg, netDebt, inp.sharesCr);

  const mos = inp.cmp && base ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;
  return {
    modelId: 'DCF',
    label: '2-Stage DCF',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `g=${(sc.growth5y.base*100).toFixed(0)}% · WACC=${(sc.wacc.base*100).toFixed(1)}% · TG=${(tg*100).toFixed(1)}%`,
    assumptionsUsed: {
      growth_base_pct: +(sc.growth5y.base * 100).toFixed(1),
      wacc_base_pct: +(sc.wacc.base * 100).toFixed(1),
      terminal_g_pct: +(tg * 100).toFixed(1),
      fcf0_cr: +f0.toFixed(0),
      net_debt_cr: +netDebt.toFixed(0),
    },
  };
}
