// ════════════════════════════════════════════════════════════════════════════
// JOURNEY MONTE CARLO — pure simulation engine (no React, no DOM)
//
// A probabilistic version of the deterministic wealth-journey in
// `app/(dashboard)/journey/page.tsx`. That page models MY real plan as a single
// lumpy return PATH (₹43 L seed in 2025, +₹20 L top-up end-2028, 2025→2035) that
// deterministically lands at ~₹10.8 cr. Here we replace that one line with a
// distribution: N random paths drawn from a lognormal annual-return model with
// the journey's implied CAGR and a user-set volatility, same seed / horizon /
// top-ups. Everything below is deterministic given a seed, so the page can
// reproduce a run.
// ════════════════════════════════════════════════════════════════════════════

// ─── Journey constants, extracted from journey/page.tsx (do not invent) ──────
// JOURNEY_START_CR = 0.43 (₹43 L seed, 2025); JOURNEY_CONTRIB = {2028: 0.20}.
// JOURNEY_PATH years 2025..2035 (11 calendar entries → 10 compounding steps).
export const JOURNEY_START_CR = 0.43;               // ₹43 L
export const JOURNEY_TOPUP_CR = 0.20;               // ₹20 L, end of 2028
export const JOURNEY_START_YEAR = 2025;
// Return % per year, exactly as in journey/page.tsx JOURNEY_PATH.
export const JOURNEY_PATH_RET = [0, 110, -20, 5, 200, -10, 5, 50, 5, 120, 15];
// Compounding steps = entries − 1 (the 2025 seed year is r=0). = 10.
export const JOURNEY_YEARS = JOURNEY_PATH_RET.length - 1; // 10
// Top-up map keyed by YEAR INDEX (0 = seed year). 2028 is index 3, applied at
// the END of that year — matches JOURNEY_CONTRIB in the source model.
export const JOURNEY_TOPUPS: Record<number, number> = { 3: JOURNEY_TOPUP_CR };
// The journey's stated ~₹10 cr goal (deterministic base case lands ~₹10.8 cr).
export const JOURNEY_TARGET_CR = 10;

// Implied CAGR of the deterministic path = geometric mean of the annual growth
// factors over the 10 compounding steps. Computed, not hard-coded.
export function journeyImpliedCagrPct(): number {
  let gross = 1;
  let steps = 0;
  for (let i = 1; i < JOURNEY_PATH_RET.length; i++) {
    gross *= 1 + JOURNEY_PATH_RET[i] / 100;
    steps += 1;
  }
  return (Math.pow(gross, 1 / steps) - 1) * 100; // ≈ 34.9%
}

// The deterministic journey wealth path (₹cr), seed → terminal, WITH top-ups.
// Used as the reference "base case" line/marker on the fan chart. Length = 11.
export function journeyDeterministicPath(): number[] {
  const out: number[] = [];
  let v = JOURNEY_START_CR;
  out.push(v);
  for (let i = 1; i < JOURNEY_PATH_RET.length; i++) {
    v = v * (1 + JOURNEY_PATH_RET[i] / 100);
    if (JOURNEY_TOPUPS[i]) v += JOURNEY_TOPUPS[i];
    out.push(v);
  }
  return out; // terminal ≈ 10.83 cr
}

// ─── PRNG + Box–Muller ───────────────────────────────────────────────────────
// mulberry32 — small, fast, seedable. Gives reproducible runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box–Muller, drawing from the supplied uniform generator.
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng(); // avoid log(0)
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Percentile helper (nearest-rank on a sorted copy) ───────────────────────
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

// ─── Tax model ───────────────────────────────────────────────────────────────
// India LTCG on equity ≈ 12.5% on realized gains, applied ONCE at the end on the
// gain above own invested capital (a clearly-labelled terminal-realization
// approximation — no annual churn, no ₹1.25 L exemption modelled). Top-ups add
// to cost basis, so tax is on (terminal − totalInvested).
function applyTerminalTax(terminal: number, invested: number, rate: number): number {
  const gain = terminal - invested;
  if (gain <= 0) return terminal; // no tax on a loss
  return terminal - gain * rate;
}

// ─── Engine ──────────────────────────────────────────────────────────────────
export interface MCParams {
  startCr: number;                 // starting capital, ₹cr
  years: number;                   // number of compounding years to simulate
  cagrPct: number;                 // expected (arithmetic-mean) annual return %
  volPct: number;                  // annual volatility (σ of log-returns) %
  sims: number;                    // number of simulated paths
  topups: Record<number, number>;  // yearIndex (1..years) → ₹cr added at END of that year
  taxOn: boolean;                  // apply terminal LTCG
  taxRatePct: number;              // LTCG rate %
  targetCr: number;                // wealth goal, ₹cr
  seed: number;                    // PRNG seed (reproducible)
}

export interface MCBands {
  p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[];
}

export interface MCResult {
  years: number;
  totalInvested: number;           // own capital in = start + Σ top-ups
  bands: MCBands;                   // per-year pre-tax (mark-to-market), length years+1
  terminal: {                      // AFTER-TAX terminal corpus percentiles, ₹cr
    p10: number; p25: number; p50: number; p75: number; p90: number; mean: number;
  };
  probTargetPct: number;           // P(after-tax terminal ≥ target)
  probLossPct: number;             // P(after-tax terminal < own capital invested)
  medianMaxDrawdownPct: number;    // median across paths of each path's peak-to-trough
  worstCaseTerminalCr: number;     // P10 after-tax terminal (worst 1-in-10)
  determPath: number[];            // deterministic journey base-case path, ₹cr (len 11)
  determTerminalCr: number;        // its terminal (₹10.8 cr region), after tax if taxOn
  medianTerminalMultiple: number;  // p50 terminal / own capital invested
}

export function runMonteCarlo(params: MCParams): MCResult {
  const years = Math.max(1, Math.round(params.years));
  const sims = Math.max(1, Math.round(params.sims));
  const rng = mulberry32(params.seed || 1);

  // Lognormal calibration: annual growth g = exp(muLog + sigmaLog·Z).
  // sigmaLog = vol; muLog set so E[g] = 1 + cagr (expected return is the
  // arithmetic mean of annual returns). The median compound path therefore sits
  // BELOW the naive (1+cagr)^n line — the volatility drag Monte Carlo exists to
  // reveal. Lognormal also guarantees a single year can never lose > 100%.
  const sigmaLog = params.volPct / 100;
  const muLog = Math.log(1 + params.cagrPct / 100) - 0.5 * sigmaLog * sigmaLog;

  const totalInvested =
    params.startCr + Object.values(params.topups).reduce((s, v) => s + (v || 0), 0);

  // year index → column of every path's value at that year end (for percentiles)
  const cols: number[][] = Array.from({ length: years + 1 }, () => new Array(sims));
  const terminalNet = new Array<number>(sims);
  const maxDrawdown = new Array<number>(sims);

  for (let s = 0; s < sims; s++) {
    let v = params.startCr;
    cols[0][s] = v;
    let peak = v;
    let dd = 0;
    for (let y = 1; y <= years; y++) {
      const g = Math.exp(muLog + sigmaLog * gaussian(rng));
      v = v * g;
      const tu = params.topups[y];
      if (tu) v += tu; // fresh capital at year end (after that year's return)
      cols[y][s] = v;
      if (v > peak) peak = v;
      const cur = peak > 0 ? (peak - v) / peak : 0;
      if (cur > dd) dd = cur;
    }
    maxDrawdown[s] = dd * 100;
    terminalNet[s] = params.taxOn
      ? applyTerminalTax(v, totalInvested, params.taxRatePct / 100)
      : v;
  }

  // per-year pre-tax bands
  const bands: MCBands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  for (let y = 0; y <= years; y++) {
    const sorted = cols[y].slice().sort((a, b) => a - b);
    bands.p10.push(percentile(sorted, 10));
    bands.p25.push(percentile(sorted, 25));
    bands.p50.push(percentile(sorted, 50));
    bands.p75.push(percentile(sorted, 75));
    bands.p90.push(percentile(sorted, 90));
  }

  const termSorted = terminalNet.slice().sort((a, b) => a - b);
  const ddSorted = maxDrawdown.slice().sort((a, b) => a - b);
  const meanTerm = terminalNet.reduce((a, b) => a + b, 0) / sims;

  const hits = terminalNet.reduce((c, v) => c + (v >= params.targetCr ? 1 : 0), 0);
  const losses = terminalNet.reduce((c, v) => c + (v < totalInvested ? 1 : 0), 0);

  // deterministic journey base case (from the extracted PATH), taxed to match
  const determPath = journeyDeterministicPath();
  const determInvested = JOURNEY_START_CR + JOURNEY_TOPUP_CR;
  const determTerm = params.taxOn
    ? applyTerminalTax(determPath[determPath.length - 1], determInvested, params.taxRatePct / 100)
    : determPath[determPath.length - 1];

  const p50Term = percentile(termSorted, 50);

  return {
    years,
    totalInvested,
    bands,
    terminal: {
      p10: percentile(termSorted, 10),
      p25: percentile(termSorted, 25),
      p50: p50Term,
      p75: percentile(termSorted, 75),
      p90: percentile(termSorted, 90),
      mean: meanTerm,
    },
    probTargetPct: (hits / sims) * 100,
    probLossPct: (losses / sims) * 100,
    medianMaxDrawdownPct: percentile(ddSorted, 50),
    worstCaseTerminalCr: percentile(termSorted, 10),
    determPath,
    determTerminalCr: determTerm,
    medianTerminalMultiple: totalInvested > 0 ? p50Term / totalInvested : 0,
  };
}
