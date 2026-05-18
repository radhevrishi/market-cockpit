// ═══════════════════════════════════════════════════════════════════════════
// GRAHAM NUMBER
//
//   GN = √(22.5 × EPS × Book Value per Share)
//
// Ben Graham's defensive-investor floor. Mathematically the price below
// which a stock is cheap on both earnings and book. NOT a growth lens —
// will give "N/A" for high-growth names where book value lags earnings.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';

export function grahamModel(inp: ValuationInputs): ModelOutput {
  if (!inp.eps || inp.eps <= 0) {
    return { modelId: 'GRAHAM', label: 'Graham Number', applicable: false, reason: 'EPS ≤ 0 (loss-making)' };
  }
  if (!inp.bookValuePerShare || inp.bookValuePerShare <= 0) {
    return { modelId: 'GRAHAM', label: 'Graham Number', applicable: false, reason: 'no book value' };
  }
  // PATCH 0477 — Graham himself explicitly excludes growth stocks. The
  // formula assumes "defensive investor" / mean-revert. For high-growth
  // names (>20% sales CAGR) it gives nonsensically low FV. Skip cleanly
  // rather than drag the consensus median.
  const g = inp.salesGrowth3y ?? inp.profitGrowth3y;
  if (g !== undefined && g > 20) {
    return { modelId: 'GRAHAM', label: 'Graham Number', applicable: false, reason: `growth ${g.toFixed(0)}% — Graham excludes growth stocks` };
  }
  // High-ROE compounders also fail Graham — their economic value massively
  // exceeds book × earnings × 22.5.
  if (inp.roe !== undefined && inp.roe > 25) {
    return { modelId: 'GRAHAM', label: 'Graham Number', applicable: false, reason: `ROE ${inp.roe.toFixed(0)}% — compounder, Graham understates` };
  }
  const gn = Math.sqrt(22.5 * inp.eps * inp.bookValuePerShare);
  const mos = inp.cmp ? ((gn - inp.cmp) / inp.cmp) * 100 : undefined;
  // Graham doesn't yield bull/bear — it's a single defensive value.
  // We surface as base only and let the consensus weight it accordingly.
  return {
    modelId: 'GRAHAM',
    label: 'Graham Number',
    applicable: true,
    base: gn,
    marginOfSafety: mos,
    detail: `√(22.5 × ${inp.eps.toFixed(1)} × ${inp.bookValuePerShare.toFixed(0)}) = ₹${gn.toFixed(0)}`,
    assumptionsUsed: {
      eps: +inp.eps.toFixed(2),
      bvps: +inp.bookValuePerShare.toFixed(2),
    },
  };
}
