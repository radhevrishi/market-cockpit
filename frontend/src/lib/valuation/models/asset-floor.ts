// ═══════════════════════════════════════════════════════════════════════════
// ASSET FLOOR (P/B-based)
//
// Bear   = 1.0× Book Value (liquidation reference)
// Base   = 1.5× Book Value (modest premium for going-concern)
// Bull   = 2.5× Book Value (premium for high-ROE franchise)
//
// Only meaningful for asset-heavy / cyclical / mature businesses.
// For 30%+ ROE compounders this model badly understates value — we mark
// applicable=true but the consensus weighting de-emphasises it.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';

export function assetFloorModel(inp: ValuationInputs): ModelOutput {
  if (!inp.bookValuePerShare || inp.bookValuePerShare <= 0) {
    return { modelId: 'ASSET_FLOOR', label: 'Asset Floor (P/B)', applicable: false, reason: 'no book value' };
  }
  // PATCH 0477 — Asset value is irrelevant for high-ROE compounders and
  // hyper-growth businesses. The economic value vastly exceeds book × P/B.
  // Include only when ROE is "industrial-normal" (<22%) and growth is modest
  // (<20%). Otherwise this model just provides a floor reference, not a
  // valuation vote.
  if (inp.roe !== undefined && inp.roe > 22) {
    return { modelId: 'ASSET_FLOOR', label: 'Asset Floor (P/B)', applicable: false, reason: `ROE ${inp.roe.toFixed(0)}% — book understates compounder` };
  }
  const g = inp.salesGrowth3y ?? inp.profitGrowth3y;
  if (g !== undefined && g > 20) {
    return { modelId: 'ASSET_FLOOR', label: 'Asset Floor (P/B)', applicable: false, reason: `growth ${g.toFixed(0)}% — asset model unfit for growth` };
  }
  const bvps = inp.bookValuePerShare;

  // ROE-tilted: high-ROE → wider premium band
  const roe = inp.roe ?? inp.roce ?? 15;
  const baseMult = roe > 25 ? 3.0 : roe > 18 ? 2.0 : roe > 12 ? 1.5 : 1.2;
  const bearMult = Math.max(0.8, baseMult * 0.6);
  const bullMult = baseMult * 1.4;

  const bear = bvps * bearMult;
  const base = bvps * baseMult;
  const bull = bvps * bullMult;
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'ASSET_FLOOR',
    label: 'Asset Floor (P/B)',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `BVPS ₹${bvps.toFixed(0)} × ${baseMult.toFixed(1)}× (ROE ${roe.toFixed(0)}%)`,
    assumptionsUsed: {
      bvps: +bvps.toFixed(2),
      pb_base_mult: baseMult,
      roe_pct: +roe.toFixed(1),
    },
  };
}
