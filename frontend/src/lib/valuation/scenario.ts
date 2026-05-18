// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — Bull/Base/Bear scenario builder
//
// For each numeric assumption used across models, derive a 3-point
// distribution so all models share the same scenario worldview.
// ═══════════════════════════════════════════════════════════════════════════

import { getAssumptions } from './assumptions';
import type { ValuationInputs } from './types';

export interface ScenarioSet {
  growth5y: { bear: number; base: number; bull: number };       // decimal (0.20 = 20%)
  ebitdaMargin: { bear: number; base: number; bull: number };   // decimal
  wacc: { bear: number; base: number; bull: number };           // decimal
  exitPe: { bear: number; base: number; bull: number };
  exitEvEbitda: { bear: number; base: number; bull: number };
  terminalGrowth: number;                                       // shared
  taxRate: number;                                              // shared
}

/** Build all assumption scenarios for one stock. */
export function buildScenarios(inp: ValuationInputs): ScenarioSet {
  const a = getAssumptions(inp.sector);

  // ── Growth ──────────────────────────────────────────────────────────────
  // Base: 3y CAGR (more stable than TTM YOY)
  // Bear: 0.5× 3y CAGR (mean revert)
  // Bull: max(guidance, max(3y, YOY)) × 1.1 — caps at 50% as floor sanity
  const sales3y = (inp.salesGrowth3y ?? inp.salesGrowthTtm ?? 12) / 100;
  const yoy = (inp.yoySalesGrowth ?? sales3y * 100) / 100;
  const guidance = inp.guidanceGrowth !== undefined ? inp.guidanceGrowth / 100 : undefined;

  // PATCH 0477 — base case now uses MAX(3y CAGR, guidance) instead of MIN.
  // Previous behaviour systematically pulled fair value down whenever
  // guidance happened to be lower than realized historical growth, which
  // is the wrong direction for forward valuation. Bull-case growth ceiling
  // also bumped 50% → 70% to accommodate hyper-growth small-caps.
  const baseG = guidance !== undefined ? Math.max(guidance, sales3y) : sales3y;
  const bearG = Math.max(sales3y * 0.5, 0.05);   // floor 5%
  const bullG = Math.min(
    Math.max(guidance ?? sales3y, yoy) * 1.15,
    0.70  // institutional bull-case ceiling
  );

  // ── EBITDA margin ───────────────────────────────────────────────────────
  // Prefer 5y avg; bull = 5y + 2pp (or guidance + 1pp if higher);
  // bear = 5y × 0.8 (mean revert lower).
  const margin5y = (inp.opm5y ?? inp.opm ?? inp.opmPrev ?? 15) / 100;
  const guidanceMargin = inp.guidanceEbitdaMargin !== undefined ? inp.guidanceEbitdaMargin / 100 : undefined;

  const baseM = guidanceMargin !== undefined ? Math.max(margin5y, guidanceMargin * 0.95) : margin5y;
  const bearM = Math.max(margin5y * 0.8, 0.05);
  const bullM = Math.min(
    Math.max(margin5y + 0.02, (guidanceMargin ?? margin5y) + 0.01),
    0.5  // cap absurd 50% margin assumption
  );

  // ── WACC ────────────────────────────────────────────────────────────────
  const waccBase = a.wacc;
  const waccBear = a.wacc + 0.02;   // discount more in bear
  const waccBull = Math.max(a.wacc - 0.01, 0.08);

  // ── Exit multiples ──────────────────────────────────────────────────────
  // PATCH 0477 — growth-tilted exit P/E. The original sector default (22-30×)
  // dramatically understates fair value for 30%+ growers. We now tilt the
  // exit multiple based on the stock's growth profile:
  //   growth > 40% → 1.6× sector default
  //   growth > 25% → 1.3× sector default
  //   growth > 15% → 1.1× sector default
  //   growth < 15% → 0.85× sector default
  // When a 5-year historical P/E is available (older stock), we use it
  // directly as the base (subject to a cap of sector × 1.6).
  const pe5y = inp.historicalPe5y;
  const sectorPe = a.exitPe;
  const growthMult =
    baseG >= 0.40 ? 1.6 :
    baseG >= 0.25 ? 1.3 :
    baseG >= 0.15 ? 1.1 :
    0.85;
  const exitPeBase = pe5y && pe5y > 5 && pe5y < 100
    ? Math.min(pe5y, sectorPe * 1.8)  // cap at 1.8× sector to avoid hyper-bubble multiples
    : sectorPe * growthMult;
  // Same growth-tilt for EV/EBITDA
  const exitEvBase = a.exitEvEbitda * Math.max(0.85, growthMult * 0.95);

  return {
    growth5y:        { bear: bearG, base: baseG, bull: bullG },
    ebitdaMargin:    { bear: bearM, base: baseM, bull: bullM },
    wacc:            { bear: waccBear, base: waccBase, bull: waccBull },
    exitPe:          { bear: exitPeBase * 0.8, base: exitPeBase, bull: exitPeBase * 1.30 },
    exitEvEbitda:    { bear: exitEvBase * 0.8, base: exitEvBase, bull: exitEvBase * 1.30 },
    terminalGrowth:  a.terminalGrowth,
    taxRate:         (inp.effectiveTaxRate ?? 25) / 100,
  };
}
