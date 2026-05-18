// ═══════════════════════════════════════════════════════════════════════════
// SECTOR P/E BAND (relative valuation)
//
// Fair price = sector_PE × current_EPS, with bull/bear bands at ±25% of
// the sector benchmark. Uses Industry PE from Screener when available;
// falls back to sector default exit P/E from assumptions.
//
// Also serves as the "what's the market paying for peers" reality check.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import type { ScenarioSet } from '../scenario';

export function sectorPeBandModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  if (!inp.eps || inp.eps <= 0) {
    return { modelId: 'SECTOR_PE', label: 'Sector P/E Band', applicable: false, reason: 'EPS ≤ 0' };
  }
  // Prefer Industry PE from Screener; fall back to historical 5y own P/E;
  // ultimately fall back to sector exit P/E.
  const ipe = inp.industryPe;
  const hpe = inp.historicalPe5y;
  let benchPe: number;
  let source: string;
  if (ipe && ipe > 5 && ipe < 100) {
    benchPe = ipe;
    source = 'Industry PE';
  } else if (hpe && hpe > 5 && hpe < 100) {
    benchPe = hpe;
    source = 'Own 5y median';
  } else {
    benchPe = sc.exitPe.base;
    source = 'Sector default';
  }

  const bear = inp.eps * benchPe * 0.75;
  const base = inp.eps * benchPe;
  const bull = inp.eps * benchPe * 1.25;
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'SECTOR_PE',
    label: 'Sector P/E Band',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `Bench P/E ${benchPe.toFixed(0)}× (${source}) · EPS ₹${inp.eps.toFixed(1)}`,
    assumptionsUsed: {
      bench_pe: +benchPe.toFixed(1),
      eps: +inp.eps.toFixed(2),
      source,
    },
  };
}
