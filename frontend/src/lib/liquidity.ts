// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDITY GUARDRAILS — PATCH 0459 IMP-4
//
// Filters out illiquid / operator-driven / pledged names from
// Special Situations / Multibagger / Re-rating leaderboards. Audit found
// the dashboards were happily ranking ₹50cr-mcap microcaps with 80%
// promoter pledge as Tier-1 catalysts — institutional users can't actually
// trade those.
//
// Three guardrails:
//   1. Average Daily Value traded (₹ Cr) — institutional desk min ₹5 Cr / day
//   2. Free float — institutional min 15% of total shares
//   3. Promoter pledge ratio — flag > 50% as 'unsafe', > 35% as 'caution'
//
// Each guardrail returns a label + severity so the UI can chip the row.
// ═══════════════════════════════════════════════════════════════════════════

export type LiquidityGrade = 'INSTITUTIONAL' | 'RETAIL_OK' | 'CAUTION' | 'AVOID';

export interface LiquidityProfile {
  grade: LiquidityGrade;
  reasons: string[];
  adv_cr?: number;            // average daily value in ₹ Cr
  free_float_pct?: number;
  pledge_ratio_pct?: number;
}

export interface LiquidityInputs {
  /** Average daily value traded — ₹ Cr (or convert from $M for US tickers). */
  avg_daily_value_cr?: number;
  /** % of shares freely traded (1 - promoter holding - DII/FII locked). */
  free_float_pct?: number;
  /** % of promoter holding that's pledged. 0 = no pledge, 100 = fully pledged. */
  promoter_pledge_pct?: number;
}

export function classifyLiquidity(i: LiquidityInputs): LiquidityProfile {
  const reasons: string[] = [];
  let grade: LiquidityGrade = 'INSTITUTIONAL' as LiquidityGrade;

  // ADV gate
  if (typeof i.avg_daily_value_cr === 'number') {
    if (i.avg_daily_value_cr < 0.5) {
      grade = 'AVOID';
      reasons.push(`ADV < ₹0.5 Cr/day — operator-trap risk`);
    } else if (i.avg_daily_value_cr < 2) {
      if (grade !== 'AVOID') grade = 'CAUTION';
      reasons.push(`ADV ₹${i.avg_daily_value_cr.toFixed(2)} Cr/day — thin liquidity`);
    } else if (i.avg_daily_value_cr < 5) {
      if (grade === 'INSTITUTIONAL') grade = 'RETAIL_OK';
      reasons.push(`ADV ₹${i.avg_daily_value_cr.toFixed(1)} Cr/day — retail-size only`);
    }
  }

  // Free-float gate
  if (typeof i.free_float_pct === 'number') {
    if (i.free_float_pct < 10) {
      grade = 'AVOID';
      reasons.push(`Free float < 10% — extreme illiquidity`);
    } else if (i.free_float_pct < 15) {
      if (grade !== 'AVOID') grade = 'CAUTION';
      reasons.push(`Free float ${i.free_float_pct.toFixed(0)}% — thin`);
    }
  }

  // Promoter pledge gate
  if (typeof i.promoter_pledge_pct === 'number') {
    if (i.promoter_pledge_pct > 50) {
      grade = 'AVOID';
      reasons.push(`Promoter pledge ${i.promoter_pledge_pct.toFixed(0)}% — forced-sale risk`);
    } else if (i.promoter_pledge_pct > 35) {
      if (grade !== 'AVOID') grade = 'CAUTION';
      reasons.push(`Promoter pledge ${i.promoter_pledge_pct.toFixed(0)}% — leveraged promoter`);
    } else if (i.promoter_pledge_pct > 15) {
      if (grade === 'INSTITUTIONAL') grade = 'RETAIL_OK';
      reasons.push(`Promoter pledge ${i.promoter_pledge_pct.toFixed(0)}%`);
    }
  }

  return {
    grade,
    reasons,
    adv_cr: i.avg_daily_value_cr,
    free_float_pct: i.free_float_pct,
    pledge_ratio_pct: i.promoter_pledge_pct,
  };
}

/** Visual styling for chips per liquidity grade. */
export const LIQUIDITY_VISUAL: Record<LiquidityGrade, { color: string; label: string; emoji: string }> = {
  INSTITUTIONAL: { color: '#10B981', label: 'INSTITUTIONAL', emoji: '✓' },
  RETAIL_OK:     { color: '#22D3EE', label: 'RETAIL OK',     emoji: '○' },
  CAUTION:       { color: '#F59E0B', label: 'CAUTION',       emoji: '⚠' },
  AVOID:         { color: '#EF4444', label: 'AVOID',         emoji: '🚫' },
};

/** One-line summary used in tooltips. */
export function liquiditySummary(p: LiquidityProfile): string {
  const parts: string[] = [];
  if (typeof p.adv_cr === 'number') parts.push(`ADV ₹${p.adv_cr.toFixed(1)} Cr`);
  if (typeof p.free_float_pct === 'number') parts.push(`Free float ${p.free_float_pct.toFixed(0)}%`);
  if (typeof p.pledge_ratio_pct === 'number' && p.pledge_ratio_pct > 0) parts.push(`Pledge ${p.pledge_ratio_pct.toFixed(0)}%`);
  return parts.length > 0 ? parts.join(' · ') : 'No liquidity data';
}
