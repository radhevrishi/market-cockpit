// ═══════════════════════════════════════════════════════════════════════════
// zzz1232 — RETURN MATH for the multibagger method (owner, 8 Nov 2026: "an
// investment return simulator — EPS growth, initial P/E, final P/E, years →
// P/E drift, annual return, total multiple, ₹1 lakh becomes — and more
// calculators like it"). Pure: every number on /return-simulator comes from here (lib/return-math.ts is the older Learn-tab maths).
//
// Price = EPS × P/E, so a share's return is EPS growth and P/E change
// multiplied: (1 + annual return) = (1 + EPS growth) × (1 + annual P/E drift).
// ═══════════════════════════════════════════════════════════════════════════

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Annual change of a multiple that moves from `from` to `to` over `years`. */
export function annualDrift(from: number, to: number, years: number): number | null {
  if (!(from > 0) || !(to > 0) || !(years > 0)) return null;
  return Math.pow(to / from, 1 / years) - 1;
}

export interface SimResult {
  peDrift: number;        // per year
  annualReturn: number;   // per year
  multiple: number;       // over the whole period
  endValue: number;       // what `invest` becomes
  epsMultiple: number; peMultiple: number;
}
/** The owner's simulator. growth / returns as fractions (0.25 = 25%). */
export function simulate(epsGrowth: number, peStart: number, peEnd: number, years: number, invest = 100_000): SimResult | null {
  const d = annualDrift(peStart, peEnd, years);
  if (d == null || !fin(epsGrowth) || epsGrowth <= -1) return null;
  const annualReturn = (1 + epsGrowth) * (1 + d) - 1;
  const multiple = Math.pow(1 + annualReturn, years);
  return { peDrift: d, annualReturn, multiple, endValue: invest * multiple, epsMultiple: Math.pow(1 + epsGrowth, years), peMultiple: peEnd / peStart };
}

/** EPS growth needed for a target annual return, given where the P/E starts and ends. */
export function requiredGrowth(targetReturn: number, peStart: number, peEnd: number, years: number): number | null {
  const d = annualDrift(peStart, peEnd, years);
  if (d == null || !fin(targetReturn)) return null;
  return (1 + targetReturn) / (1 + d) - 1;
}

/** The most you can pay today for a target return: EPS × (1+g)^N × exit P/E, discounted at the target return. */
export function buyBelow(eps: number, growth: number, years: number, exitPe: number, targetReturn: number, price?: number | null): { futureEps: number; futurePrice: number; maxPrice: number; marginOfSafety: number | null; impliedReturn: number | null } | null {
  if (!(eps > 0) || !(years > 0) || !(exitPe > 0) || !fin(growth) || !fin(targetReturn) || targetReturn <= -1) return null;
  const futureEps = eps * Math.pow(1 + growth, years);
  const futurePrice = futureEps * exitPe;
  const maxPrice = futurePrice / Math.pow(1 + targetReturn, years);
  const p = fin(price) && price > 0 ? price : null;
  return { futureEps, futurePrice, maxPrice, marginOfSafety: p ? 1 - p / maxPrice : null, impliedReturn: p ? Math.pow(futurePrice / p, 1 / years) - 1 : null };
}

/** Years to reach a multiple at a return, and the return needed for a multiple in given years. */
export function yearsToMultiple(multiple: number, annual: number): number | null {
  if (!(multiple > 1) || !(annual > 0)) return null;
  return Math.log(multiple) / Math.log(1 + annual);
}
export function cagrFor(multiple: number, years: number): number | null {
  if (!(multiple > 0) || !(years > 0)) return null;
  return Math.pow(multiple, 1 / years) - 1;
}

/** Guidance → price: a revenue target × net margin ÷ shares × P/E. Revenue and market cap in the same unit (₹ crore); shares in crore. */
export function guidanceToPrice(revenue: number, netMargin: number, sharesCr: number, pe: number, price?: number | null, years?: number | null): { pat: number; eps: number; marketCap: number; targetPrice: number; upside: number | null; annual: number | null } | null {
  if (!(revenue > 0) || !fin(netMargin) || !(sharesCr > 0) || !(pe > 0)) return null;
  const pat = revenue * netMargin;
  const eps = pat / sharesCr;
  const marketCap = pat * pe;
  const targetPrice = eps * pe;
  const p = fin(price) && price > 0 ? price : null;
  const upside = p ? targetPrice / p - 1 : null;
  return { pat, eps, marketCap, targetPrice, upside, annual: p && years && years > 0 ? Math.pow(targetPrice / p, 1 / years) - 1 : null };
}

/** P/E a growth rate earns at a chosen PEG (growth in %, e.g. PEG 1 at 25% growth = P/E 25), and how far the current P/E is from it. */
export function pegFair(growthPct: number, peg: number, currentPe?: number | null): { fairPe: number; gap: number | null } | null {
  if (!(growthPct > 0) || !(peg > 0)) return null;
  const fairPe = growthPct * peg;
  return { fairPe, gap: fin(currentPe) && currentPe > 0 ? currentPe / fairPe - 1 : null };
}

/** Grid for the simulator: annual return for each EPS growth (rows) × exit P/E (columns). */
export function sensitivity(growths: number[], exitPes: number[], peStart: number, years: number): Array<Array<number | null>> {
  return growths.map((g) => exitPes.map((pe) => simulate(g, peStart, pe, years)?.annualReturn ?? null));
}

/** Dilution: the share-count growth a company can afford before EPS growth falls below a bar. */
export function epsAfterDilution(profitGrowth: number, shareGrowth: number): number | null {
  if (!fin(profitGrowth) || !fin(shareGrowth) || shareGrowth <= -1) return null;
  return (1 + profitGrowth) / (1 + shareGrowth) - 1;
}
