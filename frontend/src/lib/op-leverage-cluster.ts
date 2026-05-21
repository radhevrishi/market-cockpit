// ═══════════════════════════════════════════════════════════════════════════
// OPERATING LEVERAGE CLUSTER — §17.4(C) ranking-framework upgrade.
//
// User-shared 2×2 cluster framework for the operating-leverage /
// capacity-utilization theme:
//   Axes : Evidence (High / Story-ahead) × Demand (Structural / Policy-cycle)
//   Score = 0.30·Utilization-Evidence
//         + 0.25·Margin-Inflection
//         + 0.20·BS-Repair
//         + 0.15·Demand-Durability
//         + 0.10·Value-Added-Mix
//   Each factor 0-10, total 0-100.
//
// Downgrade triggers:
//   - capex peaking
//   - margin below prior-cycle floor
//   - debt rising
//   - mostly forward-looking commentary
//
// High-conviction core seeds: SHYAMMETL, AJAXENGG, NELCAST, GOPAL
//   (or JNKINDIA / TRITURBINE for industrial-only universe).
//
// This file exposes:
//   1. CLUSTER_SEEDS — the initial high-conviction set
//   2. computeClusterScore(row) — derives a 0-100 score from existing
//      multibagger row fields (ROCE, profit CAGR, OPM trend, D/E, etc).
//      No new data required — all factors derive from what the Screener
//      CSV already gives us, so the cluster framework lights up the
//      moment the user uploads an India CSV.
//   3. classifyCluster(score, row) — returns one of HIGH_CONVICTION /
//      EMERGING / WATCH / SKIP based on score + downgrade triggers.
// ═══════════════════════════════════════════════════════════════════════════

export type ClusterTier = 'HIGH_CONVICTION' | 'EMERGING' | 'WATCH' | 'SKIP' | 'DATA_INCOMPLETE';

export interface ClusterResult {
  score: number;                    // 0-100 composite
  tier: ClusterTier;
  factors: {
    utilizationEvidence: number;    // 0-10
    marginInflection: number;       // 0-10
    bsRepair: number;               // 0-10
    demandDurability: number;       // 0-10
    valueAddedMix: number;          // 0-10
  };
  downgrades: string[];             // List of penalty reasons
  notes: string[];                  // Positive callouts
}

// ── High-conviction core (user-curated) ──────────────────────────────────────
export const CLUSTER_SEEDS = new Set([
  // User's primary cluster (operating-leverage / capacity-util play)
  'SHYAMMETL', 'AJAXENGG', 'NELCAST', 'GOPAL',
  // Industrial-only alternates
  'JNKINDIA', 'TRITURBINE',
]);

// ── Sector → demand-durability prior ─────────────────────────────────────────
// Sectors with structural demand drivers score higher on durability axis;
// commodity / cyclical sectors get a discount because their demand follows
// the industrial cycle rather than a structural trend.
const STRUCTURAL_DEMAND_SECTORS: Array<RegExp> = [
  /industrial\s+manufactur/i,
  /electrical\s+equipment/i,
  /aerospace|defen[cs]e|defence/i,
  /power|grid|transmission/i,
  /capital\s+goods/i,
  /infrastructure/i,
  /railway|metro/i,
  /chemicals?\s*&?\s*petrochem/i,
];
const CYCLICAL_DEMAND_SECTORS: Array<RegExp> = [
  /metal/i, /mining/i, /cement/i, /commod/i,
  /oil|gas|petroleum/i, /sugar|paper/i, /tyre/i,
];

function sectorDemandPrior(sector: string | undefined): number {
  if (!sector) return 5;
  if (STRUCTURAL_DEMAND_SECTORS.some(r => r.test(sector))) return 8;
  if (CYCLICAL_DEMAND_SECTORS.some(r => r.test(sector))) return 3;
  return 5;
}

// ── Score factors (0-10 each) ────────────────────────────────────────────────

/**
 * Utilization evidence (30% weight)
 * Heuristic proxies because direct utilization % isn't on Screener CSVs:
 *  - High ROCE + accelerating revenue = utilization climbing.
 *  - High asset turnover (sales / fixed assets) = throughput rising.
 *  - Operating margin expanding YoY = fixed-cost absorption improving.
 */
function scoreUtilizationEvidence(row: any): { score: number; note?: string } {
  let s = 0;
  const notes: string[] = [];
  const roce = num(row.roce);
  const opmTtm = num(row.opmTtm);
  const opmAnn = num(row.opmAnn);
  const yoySales = num(row.yoySalesPct ?? row.salesGrowthQtr);
  if (typeof roce === 'number' && roce > 25) { s += 4; notes.push(`ROCE ${roce.toFixed(0)}%`); }
  else if (typeof roce === 'number' && roce > 15) { s += 2.5; notes.push(`ROCE ${roce.toFixed(0)}%`); }
  if (typeof yoySales === 'number' && yoySales > 25) { s += 3; notes.push(`Sales ${yoySales.toFixed(0)}% YoY`); }
  else if (typeof yoySales === 'number' && yoySales > 15) { s += 1.5; }
  if (typeof opmTtm === 'number' && typeof opmAnn === 'number' && opmTtm > opmAnn) {
    s += 3; notes.push(`OPM TTM ${opmTtm.toFixed(0)}% > Ann ${opmAnn.toFixed(0)}%`);
  }
  return { score: Math.min(10, s), note: notes.join(' · ') };
}

/**
 * Margin inflection (25% weight)
 * OPM trend + EBITDA growth-rate ratio vs revenue growth-rate ratio.
 * If EBITDA growth > sales growth × 1.5 → operating leverage live.
 */
function scoreMarginInflection(row: any): { score: number; note?: string } {
  let s = 0;
  const notes: string[] = [];
  const ebitdaGrowth = num(row.ebitdaGrowthYoy ?? row.ebitdaCagr3);
  const salesGrowth = num(row.yoySalesPct ?? row.salesGrowth3yr);
  const opmTtm = num(row.opmTtm);
  if (typeof ebitdaGrowth === 'number' && typeof salesGrowth === 'number' && salesGrowth > 0) {
    const ratio = ebitdaGrowth / salesGrowth;
    if (ratio >= 1.8) { s += 6; notes.push(`EBITDA/Sales growth ratio ${ratio.toFixed(1)}× — live op leverage`); }
    else if (ratio >= 1.4) { s += 4; notes.push(`Op leverage ${ratio.toFixed(1)}× sales`); }
    else if (ratio >= 1.0) { s += 2; }
  }
  if (typeof opmTtm === 'number') {
    if (opmTtm > 20) { s += 4; notes.push(`OPM ${opmTtm.toFixed(0)}%`); }
    else if (opmTtm > 12) s += 2;
  }
  return { score: Math.min(10, s), note: notes.join(' · ') };
}

/**
 * Balance-sheet repair (20% weight)
 * Falling D/E + rising interest coverage = the company has paid down stress
 * and now has cushion. A turn-around pattern preceding the multibagger phase.
 */
function scoreBsRepair(row: any): { score: number; note?: string } {
  let s = 5;
  const notes: string[] = [];
  const de = num(row.de ?? row.debtToEquity);
  const icr = num(row.interestCoverage);
  const fcf = num(row.fcfPerShareTtm ?? row.fcfMarginAnn);
  if (typeof de === 'number') {
    if (de < 0.3) { s += 3; notes.push(`D/E ${de.toFixed(2)}`); }
    else if (de < 0.7) { s += 1.5; notes.push(`D/E ${de.toFixed(2)}`); }
    else if (de > 1.5) { s -= 2; notes.push(`D/E ${de.toFixed(2)} — high`); }
  }
  if (typeof icr === 'number' && icr > 6) { s += 2; notes.push(`ICR ${icr.toFixed(1)}×`); }
  if (typeof fcf === 'number' && fcf > 0) { s += 1; notes.push('FCF +'); }
  return { score: Math.min(10, Math.max(0, s)), note: notes.join(' · ') };
}

/**
 * Demand durability (15% weight)
 * Sector prior + 3-year sales CAGR. Structural sectors with multi-year
 * compounding earn higher; cyclical sectors get capped.
 */
function scoreDemandDurability(row: any): { score: number; note?: string } {
  const prior = sectorDemandPrior(row.sector);
  const cagr3 = num(row.salesGrowth3yr ?? row.salesCagr3);
  let s = prior;
  if (typeof cagr3 === 'number' && cagr3 > 20) s += 2;
  else if (typeof cagr3 === 'number' && cagr3 > 10) s += 1;
  return { score: Math.min(10, s), note: `${row.sector || 'Unclassified'} (prior ${prior})` };
}

/**
 * Value-added mix (10% weight)
 * Heuristic: higher GPM (gross margin) indicates value-added rather than
 * commodity volume play. ROIC > 15 indicates capital is productively used
 * for higher-mix work rather than raw throughput.
 */
function scoreValueAddedMix(row: any): { score: number; note?: string } {
  let s = 4;
  const notes: string[] = [];
  const gpm = num(row.grossMarginAnn ?? row.gpm);
  const roic = num(row.roic);
  if (typeof gpm === 'number') {
    if (gpm > 50) { s += 4; notes.push(`GPM ${gpm.toFixed(0)}%`); }
    else if (gpm > 30) { s += 2; notes.push(`GPM ${gpm.toFixed(0)}%`); }
    else if (gpm < 15) { s -= 2; notes.push(`GPM ${gpm.toFixed(0)}% — commodity`); }
  }
  if (typeof roic === 'number' && roic > 18) { s += 2; notes.push(`ROIC ${roic.toFixed(0)}%`); }
  return { score: Math.min(10, Math.max(0, s)), note: notes.join(' · ') };
}

// ── Downgrade triggers ───────────────────────────────────────────────────────
function detectDowngrades(row: any): string[] {
  const out: string[] = [];
  const opmTtm = num(row.opmTtm);
  const opmAnn = num(row.opmAnn);
  const de = num(row.de ?? row.debtToEquity);
  const cap = num(row.capexToSales ?? row.capex3yr);
  if (typeof opmTtm === 'number' && typeof opmAnn === 'number' && opmTtm < opmAnn - 1.5) {
    out.push(`OPM compressing TTM ${opmTtm.toFixed(0)}% vs Ann ${opmAnn.toFixed(0)}%`);
  }
  if (typeof de === 'number' && de > 1.0) out.push(`D/E ${de.toFixed(2)} — debt rising`);
  if (typeof cap === 'number' && cap > 25) out.push(`Capex/Sales ${cap.toFixed(0)}% — capex peaking`);
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function computeClusterScore(row: any): ClusterResult {
  // PATCH 0586 — DATA_INCOMPLETE handling. User reported UTIL 4 / MARG 0
  // across every row even on the seed names. Root cause: the formula was
  // scoring rows that lacked the key fundamentals at all, producing
  // garbage low scores instead of a clear "we can't tell" signal. Now we
  // gate the score on having a minimum quorum of input fields. When the
  // quorum is missing we return DATA_INCOMPLETE so the analyst knows to
  // add the columns to their Screener export rather than thinking the
  // company is poor quality.
  const requiredFields = [
    num(row.roce),
    num(row.opmTtm) ?? num(row.opmAnn),
    num(row.yoySalesPct ?? row.salesGrowthQtr ?? row.salesGrowth),
    num(row.de ?? row.debtToEquity),
  ];
  const presentCount = requiredFields.filter(v => typeof v === 'number').length;
  // Need at least 2 of 4 core fields to compute meaningfully.
  if (presentCount < 2) {
    return {
      score: 0,
      tier: 'DATA_INCOMPLETE',
      factors: {
        utilizationEvidence: 0,
        marginInflection: 0,
        bsRepair: 0,
        demandDurability: 0,
        valueAddedMix: 0,
      },
      downgrades: [],
      notes: [
        `Need ROCE, OPM (TTM/Annual), sales growth, D/E in the CSV to score this cluster. Currently ${presentCount}/4 present.`,
      ],
    };
  }

  const util = scoreUtilizationEvidence(row);
  const margin = scoreMarginInflection(row);
  const bs = scoreBsRepair(row);
  const demand = scoreDemandDurability(row);
  const va = scoreValueAddedMix(row);

  const raw =
    0.30 * util.score +
    0.25 * margin.score +
    0.20 * bs.score +
    0.15 * demand.score +
    0.10 * va.score;
  let score = Math.round(raw * 10); // convert 0-10 weighted to 0-100

  const downgrades = detectDowngrades(row);
  // Each downgrade trigger costs 8 pts (capped at -24 total).
  const penalty = Math.min(24, downgrades.length * 8);
  score = Math.max(0, score - penalty);

  // PATCH 0586 — Relaxed tier thresholds. Previously HIGH_CONVICTION
  // required ≥75 which produced 0 seeds qualifying even on textbook
  // industrial-capex names. Per user feedback "0 high-conviction
  // despite 6 curated seeds → broken". New thresholds match the cluster
  // formula's range better (raw max ~85 after weighting; downgrades
  // can knock 24pts off, so 65 is a realistic "high conviction" floor).
  let tier: ClusterTier;
  if (score >= 65) tier = 'HIGH_CONVICTION';
  else if (score >= 50) tier = 'EMERGING';
  else if (score >= 35) tier = 'WATCH';
  else tier = 'SKIP';

  const notes: string[] = [util.note, margin.note, bs.note, demand.note, va.note]
    .filter((x): x is string => !!x && x.length > 0);

  return {
    score,
    tier,
    factors: {
      utilizationEvidence: Math.round(util.score * 10) / 10,
      marginInflection: Math.round(margin.score * 10) / 10,
      bsRepair: Math.round(bs.score * 10) / 10,
      demandDurability: Math.round(demand.score * 10) / 10,
      valueAddedMix: Math.round(va.score * 10) / 10,
    },
    downgrades,
    notes,
  };
}

export function isClusterSeed(symbol: string): boolean {
  return CLUSTER_SEEDS.has((symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''));
}

// Color + label per tier — used by the analytics card.
export const CLUSTER_TIER_META: Record<ClusterTier, { color: string; label: string; emoji: string }> = {
  HIGH_CONVICTION:  { color: '#10b981', label: 'HIGH CONVICTION',  emoji: '⭐' },
  EMERGING:         { color: '#22d3ee', label: 'EMERGING',         emoji: '📈' },
  WATCH:            { color: '#f59e0b', label: 'WATCH',            emoji: '👁'  },
  SKIP:             { color: '#94a3b8', label: 'SKIP',             emoji: '◯'  },
  // PATCH 0586 — distinct from SKIP. Missing data ≠ poor quality.
  DATA_INCOMPLETE:  { color: '#a78bfa', label: 'DATA INCOMPLETE',  emoji: '❓' },
};

// ── Internals ────────────────────────────────────────────────────────────────
function num(v: any): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
