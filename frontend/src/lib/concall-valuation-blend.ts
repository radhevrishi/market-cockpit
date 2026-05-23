// ═══════════════════════════════════════════════════════════════════════════
// CONCALL × VALUATION BLENDED SCORE (PATCH 0752)
//
// Long-pending follow-up from P0681 (per CLAUDE.md §17.13). The Concall AI
// surface produces a concallScore on a 0–100 scale derived from regex/lexicon
// over the call transcript (forward signals, tone, guidance density). The
// InlineValuationPanel produces 3 valuation calculators (P/E, P/S, EV/EBITDA)
// each with a per-scenario upside%. Neither view considers the other.
//
// This helper blends the two: 90% concall × 10% valuation. The 10% weight is
// deliberately small — concall language is the primary signal; valuation
// upside is a tie-breaker that nudges a marginal name up when fundamentals are
// already cheap, or down when management bullishness is priced in.
//
// Mapping rules (valuation → 0..100 score):
//   • upside ≥ +50%  → 90
//   • upside ≥ +30%  → 75
//   • upside ≥ +15%  → 60
//   • upside ≥   0%  → 50  (neutral)
//   • upside ≥ -15%  → 35
//   • upside ≥ -30%  → 20
//   • upside <  -30% → 10  (richly priced, expects a drawdown)
//
// Returns a {blendedScore, valuationContribution} so the UI can show the
// transparency: "82 concall + valuation +2 = 84 blended".
// ═══════════════════════════════════════════════════════════════════════════

export interface BlendInputs {
  concallScore: number;            // 0..100 from Concall AI
  valuationUpsidePct: number;      // can be negative
}

export interface BlendResult {
  blendedScore: number;            // 0..100, rounded
  valuationScore: number;          // 0..100 mapped from upside%
  valuationContribution: number;   // signed delta vs pure concall
  weight: number;                  // 0.10 by default
}

export function mapUpsideToScore(upsidePct: number): number {
  if (upsidePct >= 50) return 90;
  if (upsidePct >= 30) return 75;
  if (upsidePct >= 15) return 60;
  if (upsidePct >= 0)  return 50;
  if (upsidePct >= -15) return 35;
  if (upsidePct >= -30) return 20;
  return 10;
}

export function blendConcallWithValuation(inputs: BlendInputs, weight = 0.10): BlendResult {
  const w = Math.max(0, Math.min(0.30, weight)); // safety: cap weight 0-30%
  const concallScore = Math.max(0, Math.min(100, inputs.concallScore || 0));
  const valuationScore = mapUpsideToScore(inputs.valuationUpsidePct);
  const blended = concallScore * (1 - w) + valuationScore * w;
  return {
    blendedScore: Math.round(blended),
    valuationScore,
    valuationContribution: Math.round(blended - concallScore),
    weight: w,
  };
}

export function formatBlendBadge(r: BlendResult): string {
  const sign = r.valuationContribution >= 0 ? '+' : '';
  return `${r.blendedScore} (valuation ${sign}${r.valuationContribution})`;
}
