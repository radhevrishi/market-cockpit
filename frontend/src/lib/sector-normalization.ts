// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0411 — SECTOR-NORMALIZED SCORING
//
// User insight: "Capital goods companies naturally use 'order book / capex
// / exports' — every industrial sounds bullish in a keyword model. Need
// sector-relative scoring. 'Capacity expansion' in chemicals = meaningful;
// in cables = common."
//
// This module applies sector-specific weights to tags. Tags that are
// EXPECTED in a sector get down-weighted (low signal). Tags that are
// RARE-BUT-INFORMATIVE in a sector get up-weighted (high signal). Plus a
// per-sector RED_FLAG_SENSITIVITY: working-capital stress is more
// diagnostic in cap-goods than in software services.
// ═══════════════════════════════════════════════════════════════════════════

import type { SectorOverlayResult } from './concall-sector-overlays';

type Sector = SectorOverlayResult['sector'];

// Tag weight maps per sector. Default = 1.0. Values < 1.0 down-weight
// (expected language). Values > 1.0 up-weight (rare-but-informative).
interface SectorWeights {
  tagWeights: Record<string, number>;   // tag → multiplier
  numericBonus?: number;                // bonus to apply when numeric anchor count is high (sector cares about hard numbers)
  red_flag_sensitivity?: number;        // multiplier on blocker weights (1.0 = default)
}

const SECTOR_WEIGHT_MAP: Partial<Record<string, SectorWeights>> = {
  // ─── Capital Goods / Industrials ─────────────────────────────────────
  // Order book / capex / exports / capacity are STANDARD vocabulary here.
  // Don't reward generic mention. Reward Tier-1 (margin, ROCE, utilization)
  // and Tier-3 (quantified guidance) instead.
  CYCLICAL_INDUSTRIAL: {
    tagWeights: {
      'Order book':         0.45,
      'Capacity':           0.45,
      'Capacity expansion': 0.50,
      'Capex':              0.55,
      'Export':             0.65,
      'Margin':             1.20,
      'Margin expansion':   1.30,
      'Premiumization':     1.10,
      'Utilization (IT/Mfg)': 1.40,
      'New customer / order': 1.20,
      'Guidance':           1.30,
      'Cash Flow':          1.30,
      'Deleveraging':       1.40,
    },
    red_flag_sensitivity: 1.20,
  },

  // ─── Chemicals / Specialty Chem ──────────────────────────────────────
  // Capacity expansion + capex are MEANINGFUL — they tie to specific
  // products and qualification cycles. Down-weight generic export.
  // Reward spreads, realizations, value-added mix, downstream.
  CHEMICAL: {
    tagWeights: {
      'Capacity':           1.30,
      'Capacity expansion': 1.40,
      'Premiumization':     1.50,        // "specialty mix", "value-added"
      'Margin':             1.30,
      'Margin expansion':   1.40,
      'Export':             0.85,
      'Demand':             0.90,
      'Guidance':           1.30,
      'New customer / order': 1.25,
      'China':              1.30,        // China+1 thesis specific to chem
    },
    red_flag_sensitivity: 1.30,
  },

  // ─── Banks / NBFC ─────────────────────────────────────────────────────
  // Different vocab entirely — NIM, GNPA, credit cost, AUM. Order book /
  // capacity / capex are largely irrelevant signals.
  BANK: {
    tagWeights: {
      'Order book':           0.20,
      'Capacity':             0.25,
      'Capex':                0.30,
      'Margin':               1.50,      // NIM expansion = the signal
      'Margin expansion':     1.60,
      'Premiumization':       0.50,
      'Guidance':             1.30,
      'Market Share':         1.30,
      'Deleveraging':         0.40,      // ironic in lender context
      'New customer / order': 0.80,
    },
    red_flag_sensitivity: 1.40,          // asset-quality red flags hit harder
  },

  // ─── IT Services ──────────────────────────────────────────────────────
  // Deal wins + utilization + attrition matter; order book is a different
  // beast (deal TCV, not the cap-goods sense).
  IT: {
    tagWeights: {
      'Order book':           1.10,      // here = TCV/deal pipeline = good
      'Capex':                0.30,
      'Capacity':             0.40,
      'Utilization (IT/Mfg)': 1.50,      // headcount utilization = THE metric
      'Margin':               1.30,
      'Margin expansion':     1.40,
      'New customer / order': 1.30,
      'AI':                   0.70,      // very common, generally hollow
    },
    red_flag_sensitivity: 1.10,
  },

  // ─── Pharma ───────────────────────────────────────────────────────────
  PHARMA: {
    tagWeights: {
      'Order book':           0.50,
      'Capacity':             1.20,      // FDA-approved capacity = scarce
      'Capacity expansion':   1.30,
      'Margin':               1.30,
      'Premiumization':       1.20,
      'Export':               1.20,
      'New customer / order': 1.10,
    },
    red_flag_sensitivity: 1.30,          // regulatory red flags
  },
};

const DEFAULT_WEIGHTS: SectorWeights = { tagWeights: {}, red_flag_sensitivity: 1.0 };

/**
 * Apply sector-normalized weights to a list of tag points.
 * Input: rawPoints by tag, sector
 * Output: adjusted total points + per-tag multipliers map for transparency
 */
export function applySectorNormalization(
  rawPoints: Record<string, number>,
  sector: Sector,
): { adjustedTotal: number; perTag: Record<string, { raw: number; weight: number; adjusted: number }>; redFlagMultiplier: number } {
  const cfg = SECTOR_WEIGHT_MAP[sector] || DEFAULT_WEIGHTS;
  const perTag: Record<string, { raw: number; weight: number; adjusted: number }> = {};
  let adjustedTotal = 0;
  for (const [tag, raw] of Object.entries(rawPoints)) {
    const w = cfg.tagWeights[tag] ?? 1.0;
    const adjusted = raw * w;
    perTag[tag] = { raw, weight: w, adjusted };
    adjustedTotal += adjusted;
  }
  return {
    adjustedTotal,
    perTag,
    redFlagMultiplier: cfg.red_flag_sensitivity ?? 1.0,
  };
}

/**
 * Sector-specific numeric anchor patterns — recognized as Tier-1 financial
 * evidence in addition to the generic patterns. Used by evidence-hierarchy.
 */
export const SECTOR_NUMERIC_PATTERNS: Partial<Record<string, RegExp[]>> = {
  BANK: [
    /\bnim\s+(?:expanded|improved|at|of)\s+\d/i,
    /\bgnpa\s+(?:at|of|down to|fell to|improved to)\s+\d/i,
    /\bnnpa\s+(?:at|of|down to)\s+\d/i,
    /\bcredit\s+cost\s+(?:at|of|fell to)\s+\d/i,
    /\baum\s+(?:grew|rose|at|reached)\s+(?:to\s+)?(?:rs\.?\s*|₹\s*)?\d/i,
    /\bcasa\s+(?:ratio\s+)?(?:at|of)\s+\d/i,
    /\bcollection\s+efficiency\s+(?:at|of)\s+\d/i,
  ],
  CHEMICAL: [
    /\bspread\s+(?:expanded|widened|at|of)\s+\d/i,
    /\brealization\s+(?:per\s+kg|per\s+ton|at)\s+(?:rs\.?\s*|₹\s*)?\d/i,
    /\bvalue[- ]added\s+share\s+(?:at|of|grew to)\s+\d/i,
    /\bspeciality?\s+(?:mix|share)\s+(?:at|of)\s+\d/i,
  ],
  IT: [
    /\bdeal\s+(?:tcv|wins?)\s+(?:of|at)\s+(?:usd\s*|\$\s*)?\d/i,
    /\battrition\s+(?:at|of|down to|fell to)\s+\d/i,
    /\butilization\s+(?:at|of)\s+\d{2}/i,
    /\bheadcount\s+(?:added|grew|at)\s+\d/i,
  ],
  PHARMA: [
    /\banda\s+(?:filings?|approvals?)\s+(?:of|at|stood at)\s+\d/i,
    /\busfda\s+(?:approvals?|inspection)/i,
    /\bgenerics?\s+(?:market\s+share|launch)/i,
  ],
};

export function sectorSpecificNumericCount(text: string, sector: Sector): number {
  const patterns = SECTOR_NUMERIC_PATTERNS[sector] || [];
  let count = 0;
  for (const re of patterns) {
    if (re.test(text)) count++;
  }
  return count;
}
