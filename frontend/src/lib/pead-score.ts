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

  // Normalize to 0-100 — PAT is the most predictive leg (highest weight)
  const sales_norm = clamp(sales / 100, 0, 1) * 100;       // 100% YoY = max
  const pat_norm = clamp(pat / 150, 0, 1) * 100;           // 150% PAT YoY = max
  const eps_norm = clamp(eps / 100, 0, 1) * 100;           // 100% EPS YoY = max

  // Op-leverage bonus: PAT grew >1.5x Sales => margin expansion signal
  // (Checklist (C) Momentum Persistence — margin expansion factor)
  const op_leverage_bonus = (sales > 0 && pat > sales * 1.5) ? 10 : 0;

  // Earnings quality: all three legs positive (Checklist (D) Earnings Quality)
  const quality_signal = (sales > 0 && pat > 0 && eps > 0) ? 5 : 0;

  // Tier bonus: BLOCKBUSTER = institutional bench top tier
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
    // Linear 1.0 → 0.6 between day 30 and 60
    drift_decay = 1.0 - ((days_since - 30) / 30) * 0.4;
    drift_phase = 'SATURATION';
  } else {
    // Decay 0.6 down to floor 0.4 by day 120; clamp
    drift_decay = clamp(0.6 - ((days_since - 60) / 60) * 0.2, 0.4, 0.6);
    drift_phase = 'EXHAUSTION';
  }

  // Weighted base — PAT 40%, Sales 30%, EPS 20%, Composite 10%
  const raw =
    0.30 * sales_norm +
    0.40 * pat_norm +
    0.20 * eps_norm +
    0.10 * clamp(composite, 0, 100);

  const score = Math.round(
    clamp((raw + op_leverage_bonus + quality_signal + tier_bonus) * drift_decay, 0, 100)
  );

  return {
    score,
    raw: Math.round(raw),
    sales_norm: Math.round(sales_norm),
    pat_norm: Math.round(pat_norm),
    eps_norm: Math.round(eps_norm),
    op_leverage_bonus,
    quality_signal,
    tier_bonus,
    drift_phase,
    days_since_filing: Math.round(days_since),
    drift_decay: Math.round(drift_decay * 100) / 100,
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
