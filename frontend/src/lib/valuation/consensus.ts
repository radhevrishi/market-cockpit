// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — consensus across models
//
// Take median across applicable model `base` values for the headline FV.
// Take P25/P75 across all (bear+base+bull) outputs for the band — robust
// to one extreme model misbehaving.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationConsensus } from './types';

/** Weights per model — pure heuristic. DCF and EV/EBITDA carry most signal;
 *  Asset Floor (mostly a floor reference) and Graham (defensive only) less. */
const MODEL_WEIGHTS: Record<string, number> = {
  DCF: 1.20,
  REV_DCF: 0.30,        // Reverse DCF is reported but its base is reference-only (it's pricing the market)
  EV_EBITDA: 1.10,
  PE_FWD: 1.10,
  SECTOR_PE: 0.90,
  EPV: 0.80,
  JUSTIFIED_PE: 0.70,
  PEG: 0.70,
  OWNER_EARN: 0.80,
  GRAHAM: 0.40,
  ASSET_FLOOR: 0.40,
  PB_ROE: 1.20,         // For banks, this is the primary lens
};

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function weightedMedian(values: { v: number; w: number }[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const totalW = sorted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= totalW / 2) return x.v;
  }
  return sorted[sorted.length - 1].v;
}

export function buildConsensus(models: ModelOutput[], cmp?: number): ValuationConsensus {
  // Exclude reverse-DCF base from consensus — it just reflects current market price.
  let applicable = models.filter(m => m.applicable && m.base !== undefined && m.modelId !== 'REV_DCF') as Array<ModelOutput & { base: number }>;
  if (applicable.length < 2) {
    return {
      modelsBuy: 0,
      modelsApplicable: applicable.length,
      verdict: 'INSUFFICIENT_DATA',
    };
  }

  // PATCH 0478 — sanity cap. Individual models occasionally produce
  // FVs > 5× CMP for hyper-growth low-PE names (e.g. Webelsolar showing
  // +568% MoS). That's almost always noise: a high projected growth × high
  // exit multiple gives a number the market would never realistically pay.
  // We clip per-model bases to within [0.25×, 4×] CMP before consensus.
  if (cmp && cmp > 0) {
    applicable = applicable.map(m => ({
      ...m,
      base: Math.max(cmp * 0.25, Math.min(cmp * 4.0, m.base)),
      bear: m.bear !== undefined ? Math.max(cmp * 0.20, Math.min(cmp * 3.5, m.bear)) : m.bear,
      bull: m.bull !== undefined ? Math.max(cmp * 0.30, Math.min(cmp * 5.0, m.bull)) : m.bull,
    }));
  }

  // PATCH 0478 — outlier trimming. When ≥ 5 models are applicable, drop the
  // single highest and single lowest base before computing weighted median.
  // Stabilises consensus against a single rogue model output (esp. Owner
  // Earnings on FCF-poor names, or PEG-Implied on hyper-growth).
  let trimmedForMedian = applicable;
  if (applicable.length >= 5) {
    const sortedAsc = [...applicable].sort((a, b) => a.base - b.base);
    trimmedForMedian = sortedAsc.slice(1, -1);  // drop min + max
  }

  // Weighted median of bases (trimmed)
  const weighted = trimmedForMedian.map(m => ({ v: m.base, w: MODEL_WEIGHTS[m.modelId] ?? 1.0 }));
  const fvBase = weightedMedian(weighted);

  // P25 / P75 spread across all (bear+base+bull) endpoints from applicable models
  const allPoints: number[] = [];
  for (const m of applicable) {
    if (m.bear !== undefined) allPoints.push(m.bear);
    if (m.base !== undefined) allPoints.push(m.base);
    if (m.bull !== undefined) allPoints.push(m.bull);
  }
  const fvBear = percentile(allPoints, 25);
  const fvBull = percentile(allPoints, 75);

  const mos = cmp ? ((fvBase - cmp) / cmp) * 100 : undefined;
  const spreadPct = fvBase > 0 ? ((fvBull - fvBear) / fvBase) * 100 : undefined;

  const modelsBuy = cmp ? applicable.filter(m => m.base > cmp * 1.05).length : 0;

  let verdict: ValuationConsensus['verdict'];
  if (!cmp || mos === undefined) verdict = 'INSUFFICIENT_DATA';
  else if (mos >= 15) verdict = 'UNDERVALUED';
  else if (mos <= -15) verdict = 'OVERVALUED';
  else verdict = 'FAIR';

  return {
    fairValueBase: fvBase,
    fairValueBear: fvBear,
    fairValueBull: fvBull,
    marginOfSafety: mos,
    modelsBuy,
    modelsApplicable: applicable.length,
    verdict,
    spreadPct,
  };
}
