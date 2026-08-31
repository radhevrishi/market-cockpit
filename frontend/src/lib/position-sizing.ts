// ═══════════════════════════════════════════════════════════════════════════
// POSITION SIZING — turn the Conviction Beats bench into an allocation plan.
//
// Pure, transparent sizing math (no React, no DOM) so the formula is testable
// and the page can render it verbatim. Consumed by
//   frontend/src/app/(dashboard)/position-sizing/page.tsx
//
// Pipeline (documented on the page):
//   1. blended conviction score = composite_score
//        × tier weight (BLOCKBUSTER > STRONG)
//        × (1 + PEAD tilt + ROCE tilt)          ← gentle quality tilts
//   2. optional market-cap HAIRCUT applied to the score used for sizing
//        (larger cap → size larger; micro-cap → size smaller). Heuristic.
//   3. rank by blended score, take the top N.
//   4. weights ∝ sizing score, then water-fill CAP at the max single-position %
//        (excess above the cap is redistributed to the uncapped names).
// ═══════════════════════════════════════════════════════════════════════════

import type { ConvictionEntry } from '@/lib/conviction-beats';

// ── tunables (documented on the page) ───────────────────────────────────────
export const SIZING = {
  TIER_WEIGHT: { BLOCKBUSTER: 1.15, STRONG: 1.0 } as Record<string, number>,
  PEAD_TILT_MAX: 0.1,   // up to +10% score for a full PEAD score
  PEAD_FULL: 100,       // pead_score treated on a 0–100 scale
  ROCE_TILT_MAX: 0.08,  // up to +8% score for strong ROCE
  ROCE_FULL: 40,        // ROCE % that earns the full tilt
} as const;

// ── market-cap risk buckets (heuristic size haircut) ────────────────────────
export interface CapBucket { label: string; haircut: number; minCr: number; }
export const CAP_BUCKETS: CapBucket[] = [
  { label: 'Large',  haircut: 1.0,  minCr: 20000 },
  { label: 'Mid',    haircut: 0.95, minCr: 5000 },
  { label: 'Small',  haircut: 0.85, minCr: 1000 },
  { label: 'Micro',  haircut: 0.7,  minCr: 0 },
];
export const CAP_UNKNOWN_HAIRCUT = 0.9;

export function capBucketFor(marketCapCr: number | null | undefined): CapBucket | null {
  if (marketCapCr == null || !Number.isFinite(marketCapCr) || marketCapCr <= 0) return null;
  for (const b of CAP_BUCKETS) if (marketCapCr >= b.minCr) return b;
  return CAP_BUCKETS[CAP_BUCKETS.length - 1];
}
export function capHaircut(marketCapCr: number | null | undefined): number {
  const b = capBucketFor(marketCapCr);
  return b ? b.haircut : CAP_UNKNOWN_HAIRCUT;
}

// ── blended conviction score ────────────────────────────────────────────────
export function blendedScore(e: ConvictionEntry): number {
  const base = Number.isFinite(e.composite_score) ? e.composite_score : 0;
  if (base <= 0) return 0;
  const tier = SIZING.TIER_WEIGHT[e.tier] ?? 1.0;
  const pead = e.pead_score != null && Number.isFinite(e.pead_score)
    ? Math.max(0, Math.min(1, e.pead_score / SIZING.PEAD_FULL)) * SIZING.PEAD_TILT_MAX
    : 0;
  const roce = e.roce != null && Number.isFinite(e.roce)
    ? Math.max(0, Math.min(1, e.roce / SIZING.ROCE_FULL)) * SIZING.ROCE_TILT_MAX
    : 0;
  return base * tier * (1 + pead + roce);
}

// ── water-fill capping ──────────────────────────────────────────────────────
// weights ∝ score, then cap each at `cap` (fraction), redistributing the
// excess to the uncapped names in proportion to their score. Iterative and
// convergent; returns weights that sum to min(1, N·cap).
export function capAndRedistribute(scores: number[], cap: number): number[] {
  const n = scores.length;
  const w = new Array(n).fill(0);
  if (n === 0) return w;
  const fixed = new Array(n).fill(false);
  let remaining = 1; // fraction of the book still to place

  for (let iter = 0; iter < n + 2; iter++) {
    let activeSum = 0;
    for (let i = 0; i < n; i++) if (!fixed[i]) activeSum += Math.max(0, scores[i]);
    if (activeSum <= 0) break;

    for (let i = 0; i < n; i++) {
      if (!fixed[i]) w[i] = remaining * (Math.max(0, scores[i]) / activeSum);
    }

    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!fixed[i] && w[i] > cap + 1e-12) { w[i] = cap; fixed[i] = true; changed = true; }
    }
    if (!changed) break;

    let fixedSum = 0;
    for (let i = 0; i < n; i++) if (fixed[i]) fixedSum += w[i];
    remaining = 1 - fixedSum;
    if (remaining <= 1e-12) break;
  }
  return w;
}

// ── full plan build ─────────────────────────────────────────────────────────
export interface PlanInput {
  bench: ConvictionEntry[];
  capital: number;                 // total ₹ to deploy
  maxSinglePct: number;            // e.g. 8  (%)
  numNames: number;                // top N to hold
  applyCapTilt: boolean;           // market-cap haircut on/off
  heldWeights: Map<string, number>;// symbol(upper) → current weight FRACTION (0–1)
  heldSymbols: Set<string>;        // symbols the user owns (upper)
}

export type Action = 'BUY' | 'ADD' | 'TRIM' | 'HOLD';

export interface PlanRow {
  rank: number;
  ticker: string;
  company: string;
  tier: ConvictionEntry['tier'];
  sector: string;
  compositeScore: number;
  blended: number;                 // blended conviction score (pre-haircut)
  sizingScore: number;             // blended × cap haircut (post-tilt)
  marketCapCr: number | null;
  capBucket: string | null;
  haircut: number;
  targetWeight: number;            // fraction 0–1
  targetAmount: number;            // ₹
  held: boolean;
  currentWeight: number | null;    // fraction 0–1 (null if not held)
  deltaPct: number | null;         // targetWeight − currentWeight in POINTS (%)
  action: Action;
}

export interface SectorAgg { sector: string; weight: number; }

export interface Plan {
  rows: PlanRow[];
  totalTargetWeight: number;       // fraction (≤1); <1 → some cash left
  cashWeight: number;              // 1 − totalTargetWeight
  top5Weight: number;              // fraction
  sectors: SectorAgg[];            // sorted desc
  buyCount: number;
  rebalanceCount: number;          // held names in the plan
  droppedHeld: string[];           // held symbols NOT in the plan (candidates to exit)
}

const DELTA_EPS = 0.5; // ± points inside which a held name is HOLD, not ADD/TRIM

export function normTicker(s: string): string {
  return String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
}

export function buildPlan(input: PlanInput): Plan {
  const { bench, capital, maxSinglePct, numNames, applyCapTilt, heldWeights, heldSymbols } = input;
  const cap = Math.max(0.001, maxSinglePct / 100);
  const N = Math.max(1, Math.floor(numNames));

  // 1–2. score every bench name, dedupe by ticker keeping the highest score
  const byTicker = new Map<string, { e: ConvictionEntry; blended: number; sizing: number; hc: number }>();
  for (const e of bench) {
    if (!e || !e.ticker) continue;
    const blended = blendedScore(e);
    if (blended <= 0) continue;
    const hc = applyCapTilt ? capHaircut(e.market_cap_cr) : 1;
    const sizing = blended * hc;
    const key = normTicker(e.ticker);
    const prev = byTicker.get(key);
    if (!prev || sizing > prev.sizing) byTicker.set(key, { e, blended, sizing, hc });
  }

  // 3. rank by sizing score, take top N
  const ranked = [...byTicker.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.sizing - a.sizing);
  const picked = ranked.slice(0, N);

  // 4. water-fill cap on the sizing scores
  const weights = capAndRedistribute(picked.map((p) => p.sizing), cap);

  const rows: PlanRow[] = picked.map((p, i) => {
    const w = weights[i];
    const held = heldSymbols.has(p.key);
    const cw = held ? (heldWeights.get(p.key) ?? 0) : null;
    const deltaPct = cw != null ? (w - cw) * 100 : null;
    let action: Action;
    if (!held) action = 'BUY';
    else if (deltaPct != null && deltaPct > DELTA_EPS) action = 'ADD';
    else if (deltaPct != null && deltaPct < -DELTA_EPS) action = 'TRIM';
    else action = 'HOLD';
    return {
      rank: i + 1,
      ticker: p.key,
      company: p.e.company || p.key,
      tier: p.e.tier,
      sector: p.e.sector || 'Unknown',
      compositeScore: p.e.composite_score ?? 0,
      blended: p.blended,
      sizingScore: p.sizing,
      marketCapCr: p.e.market_cap_cr ?? null,
      capBucket: capBucketFor(p.e.market_cap_cr)?.label ?? null,
      haircut: p.hc,
      targetWeight: w,
      targetAmount: w * capital,
      held,
      currentWeight: cw,
      deltaPct,
      action,
    };
  });

  const totalTargetWeight = rows.reduce((a, r) => a + r.targetWeight, 0);
  const top5Weight = rows.slice(0, 5).reduce((a, r) => a + r.targetWeight, 0);

  const secMap = new Map<string, number>();
  for (const r of rows) secMap.set(r.sector, (secMap.get(r.sector) || 0) + r.targetWeight);
  const sectors = [...secMap.entries()]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);

  const plannedSet = new Set(rows.map((r) => r.ticker));
  const droppedHeld = [...heldSymbols].filter((s) => !plannedSet.has(s));

  return {
    rows,
    totalTargetWeight,
    cashWeight: Math.max(0, 1 - totalTargetWeight),
    top5Weight,
    sectors,
    buyCount: rows.filter((r) => !r.held).length,
    rebalanceCount: rows.filter((r) => r.held).length,
    droppedHeld,
  };
}
