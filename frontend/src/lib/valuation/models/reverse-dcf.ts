// ═══════════════════════════════════════════════════════════════════════════
// REVERSE DCF
//
// Solve for the FCF growth rate the market is implicitly pricing in at the
// current market cap. If implied growth ≫ realistic guidance → expensive.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import { getAssumptions } from '../assumptions';
import type { ScenarioSet } from '../scenario';

/** Bisection: find growth rate g that produces fair value ≈ CMP. */
function solveImpliedG(targetEquity: number, fcf0: number, wacc: number, terminalG: number, netDebt: number): number {
  function fv(g: number): number {
    let pv = 0, fcf = fcf0;
    for (let y = 1; y <= 5; y++) {
      fcf *= (1 + g);
      pv += fcf / Math.pow(1 + wacc, y);
    }
    const terminalFcf = fcf * (1 + terminalG);
    const tv = terminalFcf / (wacc - terminalG);
    pv += tv / Math.pow(1 + wacc, 5);
    return pv - netDebt;
  }
  let lo = -0.10, hi = 0.60;
  // Safety: if even the upper bound undershoots target, market is pricing >60% growth
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < targetEquity) lo = mid;
    else hi = mid;
    if (Math.abs(hi - lo) < 1e-4) break;
  }
  return (lo + hi) / 2;
}

export function reverseDcfModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  const a = getAssumptions(inp.sector);
  if (!a.dcfApplicable) {
    return { modelId: 'REV_DCF', label: 'Reverse DCF', applicable: false, reason: 'sector-not-dcf' };
  }
  if (!inp.fcfCr || inp.fcfCr <= 0 || !inp.marketCapCr) {
    return { modelId: 'REV_DCF', label: 'Reverse DCF', applicable: false, reason: 'no FCF or MCap' };
  }
  const targetEquity = inp.marketCapCr;  // we're solving for fair value = current MCap
  const netDebt = inp.netDebtCr ?? 0;
  const g = solveImpliedG(targetEquity, inp.fcfCr, sc.wacc.base, sc.terminalGrowth, netDebt);

  // Reverse DCF doesn't have B/B/B values like other models — its output is
  // "implied growth vs realistic growth". We surface that as bear/base/bull
  // by comparing implied g against guidance/historical.
  const realisticBase = sc.growth5y.base * 100;
  const implied = g * 100;

  // What CMP would be at realistic growth scenarios:
  // Use the DCF formula to back-compute fair value at bear/base/bull g.
  function priceAtG(growth: number, wacc: number): number {
    let pv = 0, fcf = inp.fcfCr!;
    for (let y = 1; y <= 5; y++) {
      fcf *= (1 + growth);
      pv += fcf / Math.pow(1 + wacc, y);
    }
    const terminalFcf = fcf * (1 + sc.terminalGrowth);
    const tv = terminalFcf / (wacc - sc.terminalGrowth);
    pv += tv / Math.pow(1 + wacc, 5);
    return (pv - netDebt) / inp.sharesCr!;
  }

  const safe = (w: number) => Math.max(w, sc.terminalGrowth + 0.02);
  const bear = priceAtG(Math.max(sc.growth5y.bear, sc.terminalGrowth + 0.01), safe(sc.wacc.bear));
  const base = priceAtG(Math.max(sc.growth5y.base, sc.terminalGrowth + 0.01), safe(sc.wacc.base));
  const bull = priceAtG(Math.max(sc.growth5y.bull, sc.terminalGrowth + 0.01), safe(sc.wacc.bull));
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'REV_DCF',
    label: 'Reverse DCF',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `Market prices in g=${implied.toFixed(1)}% · Realistic g=${realisticBase.toFixed(1)}% · ${implied > realisticBase + 4 ? 'STRETCHED' : implied < realisticBase - 4 ? 'CONSERVATIVE' : 'IN-LINE'}`,
    assumptionsUsed: {
      implied_g_pct: +implied.toFixed(2),
      realistic_g_pct: +realisticBase.toFixed(2),
      gap_pct: +(implied - realisticBase).toFixed(2),
    },
  };
}
