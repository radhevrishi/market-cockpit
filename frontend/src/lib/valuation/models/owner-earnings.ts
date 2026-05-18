// ═══════════════════════════════════════════════════════════════════════════
// OWNER EARNINGS (Buffett)
//
//   Owner Earnings ≈ FCF (rough proxy; ideally PAT + D&A − maintenance capex)
//   FairPrice = OwnerEarnings × (1 + growth) × exit_multiple ÷ shares
//
// We use FCF directly as the owner-earnings proxy. Lower multiple than
// P/E to reflect that owner-earnings is more conservative.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModelOutput, ValuationInputs } from '../types';
import type { ScenarioSet } from '../scenario';

export function ownerEarningsModel(inp: ValuationInputs, sc: ScenarioSet): ModelOutput {
  if (!inp.fcfCr || inp.fcfCr <= 0) {
    return { modelId: 'OWNER_EARN', label: 'Owner Earnings', applicable: false, reason: 'no positive FCF' };
  }
  if (!inp.sharesCr || inp.sharesCr <= 0) {
    return { modelId: 'OWNER_EARN', label: 'Owner Earnings', applicable: false, reason: 'shares not derivable' };
  }

  // Per-share FCF × forward multiple. Exit multiple ~ 80% of P/E exit (more conservative).
  const fcfPerShare = inp.fcfCr / inp.sharesCr;
  const exitMultBase = sc.exitPe.base * 0.8;
  const exitMultBear = sc.exitPe.bear * 0.8;
  const exitMultBull = sc.exitPe.bull * 0.85;

  const bear = fcfPerShare * (1 + sc.growth5y.bear) * exitMultBear;
  const base = fcfPerShare * (1 + sc.growth5y.base) * exitMultBase;
  const bull = fcfPerShare * (1 + sc.growth5y.bull) * exitMultBull;
  const mos = inp.cmp ? ((base - inp.cmp) / inp.cmp) * 100 : undefined;

  return {
    modelId: 'OWNER_EARN',
    label: 'Owner Earnings',
    applicable: true,
    bear, base, bull,
    marginOfSafety: mos,
    detail: `FCF/share ₹${fcfPerShare.toFixed(1)} × Fwd × ${exitMultBase.toFixed(0)}× exit`,
    assumptionsUsed: {
      fcf_per_share: +fcfPerShare.toFixed(2),
      exit_mult_owner_earn: +exitMultBase.toFixed(1),
    },
  };
}
