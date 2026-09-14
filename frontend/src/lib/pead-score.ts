// ═══════════════════════════════════════════════════════════════════════════
// USER-REQ — PEAD (Post-Earnings Announcement Drift) score
//
// Derived from Vivek Mashrani's PEAD strategy deck + the two PEAD Checklist
// docs the user uploaded. Strategy distilled:
//   - Explosive earnings beat (Sales / PAT / EPS YoY)
//   - PAT growing faster than Sales => margin expansion / op leverage
//   - All three legs positive => earnings quality confirmation
//   - Time-decay window: 5-30d drift zone is sweet spot; 30-60d saturation;
//     60+ exhaustion. Pre-5d == reaction, slightly demoted.
//   - Tier (BLOCKBUSTER/STRONG) and composite_score act as the
//     under-the-radar / multi-factor confirmation backstop.
//
// Per user instruction: NO daily price-action factor. Pure earnings drift.
// Output: integer 0-100.
// ═══════════════════════════════════════════════════════════════════════════

import type { ConvictionEntry } from './conviction-beats';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface PeadBreakdown {
  score: number;          // 0-100
  raw: number;            // pre-decay weighted base
  sales_norm: number;
  pat_norm: number;
  eps_norm: number;
  op_leverage_bonus: number;
  quality_signal: number;
  tier_bonus: number;
  drift_phase: 'REACTION' | 'DRIFT' | 'SATURATION' | 'EXHAUSTION';
  days_since_filing: number;
  drift_decay: number;    // multiplier 0.4-1.0
  // Whether the market's answer to the print was available. When it is not,
  // the score rests on the print alone and must be read as a weaker signal —
  // a drift model without a reaction is half a drift model, and the tooltip
  // says so rather than letting the two look identical.
  reaction_known: boolean;
  d1_norm: number | null;
  gap_norm: number | null;
}

/**
 * Compute PEAD score for a single conviction entry.
 * Returns score (0-100) and the full breakdown for tooltips.
 */
export function peadScore(entry: ConvictionEntry, now: Date = new Date()): PeadBreakdown {
  const sales = entry.sales_yoy_pct ?? 0;
  const pat = entry.net_profit_yoy_pct ?? 0;
  const eps = entry.eps_yoy_pct ?? 0;
  const composite = entry.composite_score ?? 0;

  // ═══ TWO THINGS WERE WRONG WITH THIS SCORE  (zzz627) ═══════════════════════
  //
  // 1. IT MEASURED THE WRONG QUANTITY. Post-earnings drift, in the literature
  //    it is named after, is what happens after a SURPRISE — it is built on the
  //    gap between the print and what was expected, and on the market's first
  //    reaction to it. This score used neither. It was a weighted sum of YoY
  //    growth, which answers "how big were the numbers", not "how much drift is
  //    left in this one". A company that grew profit 150% when 200% was
  //    expected falls; this scored it near the top of the scale.
  //
  //    The earlier note "per user instruction: no daily price-action factor" was
  //    read too broadly. The instruction was to keep the DAY'S chart out of an
  //    earnings score, and that still holds — nothing here reads today's candle.
  //    The gap and the day-one close ARE the earnings event: they are how the
  //    market answered the print, and they are the single most predictive input
  //    a drift model has. The US side has always used them, which is why its
  //    scores spread properly across 29-80 while these bunched around 40.
  //
  // 2. THE SCALE MADE ITS OWN GREEN BAND UNREACHABLE. Normalisation was linear
  //    against caps of +100% sales, +150% profit and +100% EPS. A genuinely
  //    excellent Indian quarter — sales +25%, profit +40%, EPS +38% — scored
  //    about 49 out of 100, below the 50 that colours the chip amber, while the
  //    green band at 70 needed all three legs at once at roughly triple that.
  //    Every real company was compressed into a narrow grey-amber band and the
  //    score could not rank them against each other, which is the only job a
  //    0-100 number has.
  //
  // Both are fixed the same way the US grader does it: BANDED thresholds set at
  // levels Indian prints actually reach, over the four inputs that matter —
  // the market's reaction, the gap, the profit surprise, and revenue. India has
  // no 20-day volume ratio on these rows, so unlike the US model there is no
  // volume leg and the remaining weights are renormalised rather than a
  // constant being invented to stand in for it.
  const band = (v: number | null | undefined, ranges: [number, number][]): number | null => {
    if (v == null || !Number.isFinite(v)) return null;
    for (const [thr, pts] of ranges) if (v >= thr) return pts;
    return 0;
  };

  // The market's answer to the print. Day one carries most of it; the gap is
  // the opening judgement before the day's trade reshapes it.
  const d1S  = band(entry.d1_pct,  [[8, 100], [5, 85], [3, 70], [1, 50], [0, 30], [-2, 15]]);
  const gapS = band(entry.gap_pct, [[3, 100], [1, 75], [0, 55], [-1, 30]]);
  // The print itself. Profit is the more predictive leg, revenue the sturdier.
  const patS   = band(pat,   [[100, 100], [50, 80], [25, 60], [10, 40], [0, 25]]) ?? 0;
  const salesS = band(sales, [[50, 100], [25, 80], [15, 60], [5, 40], [0, 25]]) ?? 0;
  const epsS   = band(eps,   [[75, 100], [40, 80], [20, 60], [8, 40], [0, 25]]) ?? 0;

  // Where the reaction is unknown — and on this bench it often is, because
  // older entries predate the price fields — the score falls back to the print
  // alone and says so, rather than scoring a missing reaction as a bad one.
  const haveReaction = d1S != null || gapS != null;
  let raw: number;
  if (haveReaction) {
    // Reaction 50% · profit surprise 30% · revenue 12% · EPS 8%.
    const reaction = (d1S != null && gapS != null) ? d1S * 0.7 + gapS * 0.3 : (d1S ?? gapS ?? 0);
    raw = reaction * 0.50 + patS * 0.30 + salesS * 0.12 + epsS * 0.08;
  } else {
    // NOT KNOWING MUST NOT SCORE BETTER THAN KNOWING SOMETHING LUKEWARM.
    // Scored straight, the print-only path came out at 84 for a quarter whose
    // reaction was unknown, against 69 for the identical quarter the market
    // visibly shrugged at — so a row with missing data outranked a row with
    // real, disappointing data. Absence of evidence is not evidence of a pop,
    // so the print-only path is scaled down and capped below the range a
    // confirmed reaction can reach.
    raw = Math.min(70, (patS * 0.50 + salesS * 0.30 + epsS * 0.20) * 0.82);
  }

  // Op-leverage: profit growing half again as fast as revenue is margin
  // expansion, and margin expansion is what makes a drift persist.
  const op_leverage_bonus = (sales > 0 && pat > sales * 1.5) ? 8 : 0;
  // All three legs positive — the print holds together rather than resting on
  // one line item.
  const quality_signal = (sales > 0 && pat > 0 && eps > 0) ? 5 : 0;
  const tier_bonus = entry.tier === 'BLOCKBUSTER' ? 5 : 0;

  // Time decay — Checklist (F):
  //   0-5d   REACTION (mild demotion — gap risk, position crowding unclear)
  //   5-30d  DRIFT (full strength — best zone)
  //   30-60d SATURATION (linear decay)
  //   60+    EXHAUSTION (floor 0.4)
  const filingMs = Date.parse(entry.filing_date + 'T09:30:00+05:30');
  const days_since = Number.isFinite(filingMs)
    ? Math.max(0, (now.getTime() - filingMs) / 86400000)
    : 30;

  let drift_decay = 1;
  let drift_phase: PeadBreakdown['drift_phase'] = 'DRIFT';
  if (days_since < 5) {
    drift_decay = 0.85;
    drift_phase = 'REACTION';
  } else if (days_since <= 30) {
    drift_decay = 1.0;
    drift_phase = 'DRIFT';
  } else if (days_since <= 60) {
    drift_decay = 1.0 - ((days_since - 30) / 30) * 0.4;
    drift_phase = 'SATURATION';
  } else {
    drift_decay = clamp(0.6 - ((days_since - 60) / 60) * 0.2, 0.4, 0.6);
    drift_phase = 'EXHAUSTION';
  }

  const score = Math.round(
    clamp((raw + op_leverage_bonus + quality_signal + tier_bonus) * drift_decay, 0, 100)
  );

  return {
    score,
    raw: Math.round(raw),
    sales_norm: Math.round(salesS),
    pat_norm: Math.round(patS),
    eps_norm: Math.round(epsS),
    op_leverage_bonus,
    quality_signal,
    tier_bonus,
    drift_phase,
    days_since_filing: Math.round(days_since),
    drift_decay: Math.round(drift_decay * 100) / 100,
    reaction_known: haveReaction,
    d1_norm: d1S,
    gap_norm: gapS,
  };
}

/** Color band for the chip — ≥70 green, 50-69 amber, <50 grey */
export function peadColor(score: number): string {
  if (score >= 70) return '#10B981';
  if (score >= 50) return '#F59E0B';
  return '#6B7A8D';
}

/** Short human label */
export function peadLabel(score: number): string {
  if (score >= 80) return 'EXPLOSIVE';
  if (score >= 70) return 'STRONG';
  if (score >= 50) return 'MODERATE';
  if (score >= 30) return 'MILD';
  return 'WEAK';
}
