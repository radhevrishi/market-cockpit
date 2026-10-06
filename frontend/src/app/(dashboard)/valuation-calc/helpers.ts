// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React from 'react';
import { type SavedValuation, type CalculatorResult, calculatePS, calculatePE, calculateEvEbitda } from '@/lib/valuation-calculators';
import { type EnrichedSaved } from './types';

export function enrichSaved(v: SavedValuation): EnrichedSaved {
  let result: CalculatorResult | null = null;
  try {
    if (v.calcKind === 'PS') result = calculatePS(v.inputs);
    else if (v.calcKind === 'PE') result = calculatePE(v.inputs);
    else result = calculateEvEbitda(v.inputs);
  } catch { /* keep result null; row still renders without live chip */ }
  const base = result?.cases.find(c => c.label === 'BASE');
  const currency: '₹' | '$' = (v.inputs as any)?.currency === '$' ? '$' : '₹';
  return {
    v,
    fairValue: base?.targetPrice,
    priceAtSave: typeof (v.inputs as any)?.currentPrice === 'number' ? (v.inputs as any).currentPrice : undefined,
    savedUpside: base?.upsidePct,
    currency,
    isUS: currency === '$',
  };
}
// ═══════════════════════════════════════════════════════════════════════════
// zzz499 — FORWARD FAIR VALUE (Excel-driven P&L waterfall).
// Upload a Screener.in "Data Sheet" export → auto-fill the latest-year P&L →
// set the forward target (revenue, OPM, other income, dep, interest, tax) →
// forward PBT → PAT → EPS → apply a peer-derived P/E band → target price band,
// upside vs current price, and implied N-year CAGR. All client-side, all editable.
// This is exactly the by-hand method: Sales × OPM = Op Profit; + Other Income
// − Depreciation − Interest = PBT; × (1−tax) = PAT; ÷ shares = EPS; × P/E = price.
// ═══════════════════════════════════════════════════════════════════════════
export const r1 = (v: number) => Math.round((Number(v) || 0) * 10) / 10;
export const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
export const crFmt = (v: number) => Number.isFinite(v) ? `₹${(Math.abs(v) >= 100 ? Math.round(v) : r1(v)).toLocaleString('en-IN')} Cr` : '—';
export const rsFmt = (v: number) => Number.isFinite(v) ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—';
export const epsFmt = (v: number) => Number.isFinite(v) ? `₹${v.toFixed(1)}` : '—';
export const chipBtn = (color: string): React.CSSProperties => ({
  fontSize: 11, padding: '4px 10px',
  background: `${color}15`, border: `1px solid ${color}50`,
  color, borderRadius: 4, cursor: 'pointer', fontWeight: 700,
});
// PATCH 0661 — slugify company name to give each example a URL-fragment ID
export function exSlug(c: string): string {
  return 'ex-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
// ═══════════════════════════════════════════════════════════════════════════
// REVERSE-DCF / FUTURE-P/E CALCULATOR (PATCH 0701)
//
// Two lenses on the same question — "is today's price asking too much?"
//   1. Reverse-DCF: hold the current market cap fixed, solve (bisection) for the
//      FCF growth rate the market is IMPLYING. Compare to what you actually
//      expect. Implied << expected  ⇒  cheap;  implied >> expected  ⇒  priced
//      for perfection.
//   2. Future P/E: project EPS forward at your growth, apply an exit multiple
//      band (bear/base/bull), and see the CAGR — decomposed into how much comes
//      from earnings vs re-rating. Kills the "great company, terrible entry"
//      trap.
// Fully client-side; auto-fill pulls live price + market cap like the others.
// ═══════════════════════════════════════════════════════════════════════════

// Two-stage DCF present value for a given high-growth rate g.
export function twoStageDcfValue(fcf0: number, g: number, r: number, gt: number, years: number): number {
  if (r <= gt) return Infinity; // terminal formula degenerate
  let pv = 0;
  let fcf = fcf0;
  for (let t = 1; t <= years; t++) {
    fcf = fcf * (1 + g);
    pv += fcf / Math.pow(1 + r, t);
  }
  // terminal value at end of year N, then discounted back
  const terminalFcf = fcf * (1 + gt);
  const terminalValue = terminalFcf / (r - gt);
  pv += terminalValue / Math.pow(1 + r, years);
  return pv;
}
// Solve for the implied high-growth rate that makes DCF value == target mcap.
export function solveImpliedGrowth(targetMcap: number, fcf0: number, r: number, gt: number, years: number): number | null {
  if (fcf0 <= 0 || targetMcap <= 0) return null;
  let lo = -0.5;  // -50%
  let hi = 1.5;   // +150%
  // Value is monotonic increasing in g; make sure target is bracketed.
  const vLo = twoStageDcfValue(fcf0, lo, r, gt, years);
  const vHi = twoStageDcfValue(fcf0, hi, r, gt, years);
  if (targetMcap < vLo) return lo; // even -50% overshoots — market pricing < that
  if (targetMcap > vHi) return hi; // needs > 150% — off the chart
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = twoStageDcfValue(fcf0, mid, r, gt, years);
    if (v > targetMcap) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
