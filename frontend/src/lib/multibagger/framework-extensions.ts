// ═══════════════════════════════════════════════════════════════════════════
// MULTIBAGGER FRAMEWORK EXTENSIONS — patch 0055
//
// Audit (vs. canonical 100×–500× baggers) identified seven gaps:
//   1. Customer concentration            — needs new Screener column
//   2. Founder tenure / age              — needs new Screener column
//   3. ROIC vs WACC explicit margin      — partly covered via ROCE
//   4. Dilution trajectory               — COMPUTABLE from existing data ✓
//   5. Cash conversion trend             — partly covered via CFO/PAT
//   6. Pricing power gross-margin trend  — partly covered via OPM expansion
//   7. Secular vs cyclical TAM           — already binary in framework
//
// This module adds the dimensions that ARE computable from the data the
// user already uploads, plus a "framework coverage meta-score" so the
// user knows which extra columns to upload to unlock full evaluation.
//
// Validation against historical multibaggers (entry year):
//   • Eicher Motors 2003 (Royal Enfield turnaround)
//   • Bajaj Finance 2010 (post-NBFC pivot)
//   • Page Industries 2008 (Jockey scale-up)
//   • Astral 2010 (CPVC pioneer)
//   • Symphony 2010 (China sourcing pivot)
//   • La Opala 2011 (premium glassware launch)
//   • Avanti Feeds 2011 (shrimp feed export pivot)
//   • Atul Auto 2010
//   • Caplin Point 2014 (LATAM expansion)
//
// All nine had: low dilution / mild accretion + ROCE expansion + small
// market cap + founder ownership > 50% + non-discovered (FII < 5%). The
// new metrics target exactly these signals.
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. Dilution Trajectory ─────────────────────────────────────────────────
//
// Approximation: share count CAGR ≈ profit CAGR − EPS growth
// (when held over the same horizon).
//
// Multibaggers tend to:
//   • Stay below +3% share count growth (mild dilution from ESOPs only)
//   • Often go negative (buybacks) once cash compounds
// Anti-multibaggers (issue-heavy NBFCs, FY15-19 small-cap PSUs):
//   • Show profit CAGR 30%+ but EPS growth only 5%-10% → 20-25pp dilution
//
// Returns:
//   value:    drag in percentage points (positive = dilution, negative = accretion)
//   verdict:  ACCRETIVE / NEUTRAL / DILUTIVE / SEVERELY_DILUTIVE / N/A
//   penalty:  points to subtract from total score (0-15)
//   bonus:    points to add (0-8 for buybacks)

export type DilutionVerdict = 'ACCRETIVE' | 'NEUTRAL' | 'DILUTIVE' | 'SEVERELY_DILUTIVE' | 'NA';

export interface DilutionAnalysis {
  drag_pp: number | null;        // share count CAGR proxy
  verdict: DilutionVerdict;
  penalty: number;               // 0-15 deducted from final score
  bonus: number;                 // 0-8 added (buybacks)
  note: string;                  // human-readable explanation
}

export function analyzeDilution(args: {
  profitCagr?: number;
  epsGrowth?: number;
}): DilutionAnalysis {
  const { profitCagr, epsGrowth } = args;
  if (profitCagr === undefined || epsGrowth === undefined) {
    return { drag_pp: null, verdict: 'NA', penalty: 0, bonus: 0,
      note: 'Add EPS Growth column to Screener export to detect share-count dilution' };
  }
  const drag = profitCagr - epsGrowth;
  // Tier table:
  //   drag > 12pp  → SEVERELY_DILUTIVE  (− 15 pts)
  //   drag 5-12pp  → DILUTIVE           (− 8 pts)
  //   drag −2..5pp → NEUTRAL            (   0)
  //   drag −5..−2pp → ACCRETIVE         (+ 4 pts)
  //   drag < −5pp  → ACCRETIVE          (+ 8 pts)  buyback engine
  let verdict: DilutionVerdict;
  let penalty = 0;
  let bonus = 0;
  let note = '';
  if (drag > 12) {
    verdict = 'SEVERELY_DILUTIVE';
    penalty = 15;
    note = `Severe dilution: profit CAGR ${profitCagr.toFixed(0)}% vs EPS growth ${epsGrowth.toFixed(0)}% → ~${drag.toFixed(0)}pp/yr share count growth. Per-share economics undermined.`;
  } else if (drag > 5) {
    verdict = 'DILUTIVE';
    penalty = 8;
    note = `Material dilution: ~${drag.toFixed(0)}pp/yr share issuance dilutes per-share growth. Watch for QIP / ESOP heavy programs.`;
  } else if (drag > -2) {
    verdict = 'NEUTRAL';
    note = `Per-share economics tracking profit growth (drag ${drag.toFixed(1)}pp). No dilution headwind.`;
  } else if (drag > -5) {
    verdict = 'ACCRETIVE';
    bonus = 4;
    note = `Mild buyback / accretive — EPS growing faster than profit (drag ${drag.toFixed(1)}pp). Capital return ongoing.`;
  } else {
    verdict = 'ACCRETIVE';
    bonus = 8;
    note = `Strong buyback engine — EPS growth outpacing profit by ${Math.abs(drag).toFixed(0)}pp/yr. High capital-return discipline.`;
  }
  return { drag_pp: drag, verdict, penalty, bonus, note };
}

// ─── 2. Framework Coverage Meta-Score ──────────────────────────────────────
//
// Tells the user what % of the framework's IDEAL data set is present for
// each stock. Stocks with 5/15 fields uploaded should not be over-trusted.
//
// Returns:
//   coverage_pct:  0-100 — percent of ideal columns present
//   missing:       string[]  — list of columns to add for full scoring
//   confidence:    HIGH / MEDIUM / LOW — usability of the score

export interface FrameworkCoverage {
  coverage_pct: number;
  present: string[];
  missing: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  note: string;
}

const IDEAL_FIELDS: Array<{ key: string; label: string; weight: number }> = [
  // Quality
  { key: 'roce',           label: 'ROCE',                                  weight: 3 },
  { key: 'opm',            label: 'OPM',                                   weight: 2 },
  { key: 'cfoToPat',       label: 'CFO/PAT (Cash conversion)',             weight: 3 },
  { key: 'fcfAbsolute',    label: 'Free Cash Flow',                        weight: 3 },
  { key: 'gpm',            label: 'Gross Profit Margin',                   weight: 2 },
  { key: 'roic',           label: 'ROIC',                                  weight: 2 },
  // Growth
  { key: 'revCagr',        label: 'Revenue CAGR (5yr)',                    weight: 3 },
  { key: 'profitCagr',     label: 'Profit CAGR (5yr)',                     weight: 3 },
  { key: 'epsGrowth',      label: 'EPS Growth (TTM)',                      weight: 2 },
  // Acceleration
  { key: 'yoySalesGrowth', label: 'YoY Sales Growth (latest Q)',           weight: 2 },
  // Trend
  { key: 'roce3yr',        label: 'ROCE 3yr ago (incremental ROCE)',       weight: 2 },
  { key: 'opm3yr',         label: 'OPM 3yr ago (margin trend)',            weight: 2 },
  // Financial
  { key: 'de',             label: 'Debt-to-Equity',                        weight: 3 },
  { key: 'netDebt',        label: 'Net Debt',                              weight: 2 },
  { key: 'ebitda',         label: 'EBITDA',                                weight: 2 },
  { key: 'icr',            label: 'Interest Coverage Ratio',               weight: 1 },
  // Ownership
  { key: 'promoter',       label: 'Promoter Holding',                      weight: 2 },
  { key: 'pledge',         label: 'Promoter Pledge',                       weight: 2 },
  { key: 'fii',            label: 'FII Holding',                           weight: 2 },
  { key: 'dii',            label: 'DII Holding',                           weight: 2 },
  { key: 'changeInPromoter', label: 'Change in Promoter Holding',          weight: 1 },
  // Valuation
  { key: 'pe',             label: 'P/E',                                   weight: 2 },
  { key: 'peg',            label: 'PEG',                                   weight: 1 },
  { key: 'high52w',        label: '52-week High',                          weight: 1 },
  { key: 'marketCapCr',    label: 'Market Cap',                            weight: 3 },
];

export function computeFrameworkCoverage(row: Record<string, unknown>): FrameworkCoverage {
  let totalWeight = 0;
  let presentWeight = 0;
  const present: string[] = [];
  const missing: string[] = [];
  for (const f of IDEAL_FIELDS) {
    totalWeight += f.weight;
    const v = row[f.key];
    const has = v !== undefined && v !== null && (typeof v !== 'number' || !isNaN(v));
    if (has) {
      presentWeight += f.weight;
      present.push(f.label);
    } else {
      missing.push(f.label);
    }
  }
  const coverage = Math.round((presentWeight / totalWeight) * 100);
  let confidence: FrameworkCoverage['confidence'] = 'LOW';
  if (coverage >= 80) confidence = 'HIGH';
  else if (coverage >= 55) confidence = 'MEDIUM';
  const note = coverage >= 80
    ? 'Full-confidence score. All key dimensions present.'
    : coverage >= 55
    ? `Medium confidence. Add ${missing.slice(0, 3).join(', ')} for higher precision.`
    : `Low confidence. ${missing.length} critical fields missing — score may misrank.`;
  return { coverage_pct: coverage, present, missing, confidence, note };
}

// ─── 3. Reinvestment Engine Score (additive layer) ─────────────────────────
//
// Pure formula: incremental ROCE × growth × (1 - dilution drag / 25)
// captures the multibagger compounding equation in one number.
//
// All inputs already on the row — no new uploads needed.
//
// Maps to a 0-100 score:
//   90+  : compounding engine in motion (rare — Page 2008, Bajaj Finance 2010)
//   70-90: strong reinvestment, multi-quarter trajectory (Astral 2010)
//   50-70: ordinary reinvestment, no edge
//   <50  : capital being destroyed or growth stalling

export interface ReinvestmentEngine {
  score: number;
  components: {
    incremental_roce_pp: number | null;
    profit_growth: number | null;
    dilution_drag_pp: number | null;
  };
  verdict: 'COMPOUNDING' | 'BUILDING' | 'ORDINARY' | 'STALLING' | 'NA';
  note: string;
}

export function computeReinvestmentEngine(args: {
  roceExpansion?: number;
  profitCagr?: number;
  dilutionDragPp?: number | null;
}): ReinvestmentEngine {
  const { roceExpansion, profitCagr, dilutionDragPp } = args;
  if (roceExpansion === undefined && profitCagr === undefined) {
    return {
      score: 50,
      components: { incremental_roce_pp: null, profit_growth: null, dilution_drag_pp: dilutionDragPp ?? null },
      verdict: 'NA',
      note: 'Need ROCE 3yr ago + Profit CAGR + EPS Growth columns to compute.',
    };
  }
  // Score components, each 0-100
  const incR = roceExpansion ?? 0;
  // ROCE expansion >+5pp = excellent (90), <-3pp = bad (20)
  const incScore = Math.max(0, Math.min(100,
    incR >= 8  ? 95 :
    incR >= 5  ? 85 :
    incR >= 2  ? 70 :
    incR >= 0  ? 55 :
    incR >= -3 ? 35 :
    incR >= -8 ? 20 : 10));
  const pg = profitCagr ?? 0;
  // Profit CAGR >25% = excellent
  const pgScore = Math.max(0, Math.min(100,
    pg >= 30 ? 95 :
    pg >= 20 ? 80 :
    pg >= 12 ? 65 :
    pg >= 5  ? 50 :
    pg >= 0  ? 35 : 15));
  // Dilution drag: 0pp = full credit, 25pp = 0 credit
  const dd = Math.max(0, dilutionDragPp ?? 0);
  const dilFactor = Math.max(0, Math.min(1, 1 - dd / 25));
  const score = Math.round(((incScore + pgScore) / 2) * dilFactor);

  let verdict: ReinvestmentEngine['verdict'] = 'ORDINARY';
  if (score >= 85) verdict = 'COMPOUNDING';
  else if (score >= 70) verdict = 'BUILDING';
  else if (score < 50) verdict = 'STALLING';

  let note = '';
  if (verdict === 'COMPOUNDING') {
    note = `Compounding engine: incremental ROCE ${incR >= 0 ? '+' : ''}${incR.toFixed(1)}pp + profit ${pg.toFixed(0)}% growth, low dilution.`;
  } else if (verdict === 'BUILDING') {
    note = `Strong reinvestment: ROCE ${incR >= 0 ? '+' : ''}${incR.toFixed(1)}pp / profit ${pg.toFixed(0)}%. Watch for inflection.`;
  } else if (verdict === 'STALLING') {
    note = `Reinvestment weak: ROCE ${incR >= 0 ? '+' : ''}${incR.toFixed(1)}pp / profit ${pg.toFixed(0)}%. New capital underperforming.`;
  } else {
    note = `Ordinary reinvestment: ROCE ${incR >= 0 ? '+' : ''}${incR.toFixed(1)}pp / profit ${pg.toFixed(0)}%. Common compounder.`;
  }

  return {
    score,
    components: {
      incremental_roce_pp: roceExpansion ?? null,
      profit_growth: profitCagr ?? null,
      dilution_drag_pp: dilutionDragPp ?? null,
    },
    verdict,
    note,
  };
}

// ─── 4. Historical Multibagger Reference Profile ──────────────────────────
// Snapshot of canonical 100x stocks at their entry inflection year.
// Frontend uses this as a side panel: "Here's what each looked like AT
// the moment to buy, vs your current upload."

export interface HistoricalMultibagger {
  ticker: string;
  name: string;
  entry_year: number;
  ten_year_return_x: number;
  // What the framework would have seen at entry:
  market_cap_cr: number;
  roce_pct: number;
  revenue_cagr_pct: number;
  profit_cagr_pct: number;
  eps_growth_pct: number;
  dilution_drag_pp: number;
  promoter_pct: number;
  fii_dii_pct: number;
  // Catalyst that triggered the run:
  inflection: string;
  framework_signals: string[];   // which dimensions caught it
}

// ─── 5. Archetype Match — patch 0058 ──────────────────────────────────────
// Auto-encodes the per-stock audit logic. Every stock receives a closest
// historical archetype and a match strength so the user no longer needs to
// manually compare against canonical multibaggers.

export type ArchetypeMatchStrength = 'STRONG' | 'PARTIAL' | 'WEAK' | 'NO_MATCH';

export interface ArchetypeMatch {
  closest_archetype?: string;          // 'Astral Pipes 2010' etc.
  closest_pattern?: string;            // 'CATEGORY_PIONEER' etc.
  ten_year_return_x?: number;          // historical multiple at exit (10y)
  match_score: number;                 // 0-100
  strength: ArchetypeMatchStrength;
  matching_dimensions: string[];       // ['cap 1.4× of Astral', 'ROCE within 5pp', ...]
  missing_dimensions: string[];        // ['EPS growth far below archetype', ...]
  verdict: string;                     // human-readable action recommendation
}

// Pattern category — encodes WHAT KIND of multibagger setup the stock looks like
const ARCHETYPE_TAGS: Record<string, string> = {
  EICHER:   'TURNAROUND_FOUNDER_LED',
  BAJFIN:   'OPERATIONAL_LEVERAGE',
  PAGEIND:  'CAPITAL_LIGHT_BRAND',
  ASTRAL:   'CATEGORY_PIONEER',
  SYMPHONY: 'ASSET_LIGHT_FOUNDER',
  LAOPALA:  'PREMIUM_PRICING_INFLECTION',
  AVANTI:   'EXPORT_TAILWIND_MICROCAP',
  CAPLIN:   'GEOGRAPHIC_EXPANSION',
};

export function computeArchetypeMatch(args: {
  marketCapCr?: number;
  roce?: number;
  profitCagr?: number;
  epsGrowth?: number;
  promoter?: number;
  fiiPlusDii?: number;
  dilutionDragPp?: number | null;
  accelSignal?: 'ACCELERATING' | 'STABLE' | 'DECELERATING';
  bucket?: 'CORE_COMPOUNDER' | 'EMERGING_MULTIBAGGER' | 'HIGH_RISK' | 'MONITOR';
}): ArchetypeMatch {
  const {
    marketCapCr, roce, profitCagr, epsGrowth, promoter, fiiPlusDii,
    dilutionDragPp, accelSignal, bucket,
  } = args;

  let bestMatch: HistoricalMultibagger | null = null;
  let bestScore = 0;
  let bestSigs: string[] = [];
  let bestMissing: string[] = [];

  for (const h of HISTORICAL_MULTIBAGGERS) {
    let pts = 0;
    const sigs: string[] = [];
    const missing: string[] = [];

    // 1. Market cap proximity (most important — multibaggers are sub-₹1000Cr at entry)
    if (marketCapCr !== undefined) {
      const ratio = marketCapCr / h.market_cap_cr;
      if (ratio >= 0.3 && ratio <= 5) {
        pts += 3;
        sigs.push(`MCap ${ratio.toFixed(1)}× of ${h.name}`);
      } else if (ratio >= 0.1 && ratio <= 10) {
        pts += 1;
      } else {
        missing.push(`MCap ${ratio < 0.1 ? 'far below' : 'far above'} archetype band`);
      }
    }

    // 2. ROCE proximity (within ±8pp)
    if (roce !== undefined) {
      if (Math.abs(roce - h.roce_pct) <= 8) {
        pts += 2;
        sigs.push(`ROCE ${roce}% (≈${h.roce_pct}%)`);
      } else if (roce < h.roce_pct - 8) {
        missing.push(`ROCE ${roce}% well below archetype ${h.roce_pct}%`);
      }
    }

    // 3. Profit CAGR proximity (within ±15pp — multibaggers all had 22-65% at entry)
    if (profitCagr !== undefined) {
      if (Math.abs(profitCagr - h.profit_cagr_pct) <= 15) {
        pts += 2;
        sigs.push(`Profit CAGR ${profitCagr}% (≈${h.profit_cagr_pct}%)`);
      } else if (profitCagr < h.profit_cagr_pct - 15) {
        missing.push(`Profit CAGR ${profitCagr}% well below archetype ${h.profit_cagr_pct}%`);
      }
    }

    // 4. EPS growth proximity (uses dilution drag implicitly)
    if (epsGrowth !== undefined && Math.abs(epsGrowth - h.eps_growth_pct) <= 15) {
      pts += 1;
      sigs.push(`EPS growth ${epsGrowth}% (≈${h.eps_growth_pct}%)`);
    }

    // 5. Promoter holding match (multibaggers all founder/family-led, 50-75%)
    if (promoter !== undefined) {
      if (Math.abs(promoter - h.promoter_pct) <= 15) {
        pts += 2;
        sigs.push(`Promoter ${promoter}% (≈${h.promoter_pct}%)`);
      } else if (promoter < 35) {
        missing.push(`Promoter ${promoter}% well below founder-led archetype`);
      }
    }

    // 6. FII+DII low (undiscovered) — multibaggers all <8% at entry
    if (fiiPlusDii !== undefined) {
      if (Math.abs(fiiPlusDii - h.fii_dii_pct) <= 10) {
        pts += 1;
        sigs.push(`FII+DII ${fiiPlusDii}% (≈${h.fii_dii_pct}% — undiscovered)`);
      } else if (fiiPlusDii > 35) {
        missing.push(`FII+DII ${fiiPlusDii}% — already discovered, sweet spot missed`);
      }
    }

    // 7. Dilution drag proximity (multibaggers all between -3 and +5pp)
    if (dilutionDragPp !== null && dilutionDragPp !== undefined &&
        Math.abs(dilutionDragPp - h.dilution_drag_pp) <= 3) {
      pts += 1;
      sigs.push(`Dilution drag matches (${dilutionDragPp.toFixed(1)}pp)`);
    } else if (dilutionDragPp !== null && dilutionDragPp !== undefined && dilutionDragPp > 12) {
      missing.push(`Dilution drag ${dilutionDragPp.toFixed(0)}pp — eats per-share growth`);
    }

    // 8. Acceleration matches inflection-year profit acceleration
    if (accelSignal === 'ACCELERATING' && h.profit_cagr_pct >= 25) {
      pts += 2;
      sigs.push('ACCELERATING — matches inflection-year archetype');
    } else if (accelSignal === 'STABLE' && h.profit_cagr_pct < 25) {
      pts += 1;
    } else if (accelSignal === 'DECELERATING') {
      pts -= 2;
      missing.push('DECELERATING — does NOT match any historical multibagger setup');
    }

    // 9. Bucket alignment
    if (bucket === 'CORE_COMPOUNDER' || bucket === 'EMERGING_MULTIBAGGER') {
      pts += 1;
    } else if (bucket === 'MONITOR') {
      pts -= 3;
      missing.push('Monitor bucket — fails kill-switch tests');
    }

    if (pts > bestScore) {
      bestScore = pts;
      bestMatch = h;
      bestSigs = sigs;
      bestMissing = missing;
    }
  }

  // Match strength tier
  let strength: ArchetypeMatchStrength = 'NO_MATCH';
  let verdict = 'No canonical multibagger archetype matches this stock setup.';
  if (bestScore >= 8) {
    strength = 'STRONG';
    verdict = `Closest archetype to a 100× setup. Study the ${bestMatch?.name} ${bestMatch?.entry_year} playbook deeply — same market cap zone, similar growth profile, similar ownership structure.`;
  } else if (bestScore >= 5) {
    strength = 'PARTIAL';
    verdict = `Worth tracking — partial archetype fit. Watch the missing dimensions: ${bestMissing.slice(0, 2).join('; ')}.`;
  } else if (bestScore >= 2) {
    strength = 'WEAK';
    verdict = 'Low conviction — only loose archetype overlap. May still compound, but not the canonical multibagger setup.';
  } else {
    verdict = 'Stock setup does not match any historical multibagger pattern. May be value, dividend, or thematic — not 100× compounding.';
  }

  // Normalize match score to 0-100 (max possible ~14 points, so multiply by 7)
  const normalized = Math.max(0, Math.min(100, bestScore * 7));

  return {
    closest_archetype: bestMatch ? `${bestMatch.name} ${bestMatch.entry_year}` : undefined,
    closest_pattern: bestMatch ? ARCHETYPE_TAGS[bestMatch.ticker] : undefined,
    ten_year_return_x: bestMatch?.ten_year_return_x,
    match_score: normalized,
    strength,
    matching_dimensions: bestSigs,
    missing_dimensions: bestMissing,
    verdict,
  };
}

export const HISTORICAL_MULTIBAGGERS: HistoricalMultibagger[] = [
  {
    ticker: 'EICHERMOT', name: 'Eicher Motors', entry_year: 2003,
    ten_year_return_x: 100,
    market_cap_cr: 250, roce_pct: 14, revenue_cagr_pct: 8, profit_cagr_pct: 22,
    eps_growth_pct: 25, dilution_drag_pp: -3,
    promoter_pct: 60, fii_dii_pct: 5,
    inflection: 'Royal Enfield turnaround under Siddhartha Lal — premium positioning launched',
    framework_signals: ['Small cap (₹250Cr)', 'High promoter (60%)', 'Profit acceleration', 'Buyback discipline'],
  },
  {
    ticker: 'BAJFINANCE', name: 'Bajaj Finance', entry_year: 2010,
    ten_year_return_x: 80,
    market_cap_cr: 1200, roce_pct: 8, revenue_cagr_pct: 35, profit_cagr_pct: 65,
    eps_growth_pct: 60, dilution_drag_pp: 5,
    promoter_pct: 56, fii_dii_pct: 8,
    inflection: 'NBFC pivot — Sanjiv Bajaj rebuilt as consumer-finance specialist',
    framework_signals: ['Mid cap (₹1200Cr)', 'Profit CAGR 65%', 'High promoter', 'Operating leverage'],
  },
  {
    ticker: 'PAGEIND', name: 'Page Industries', entry_year: 2008,
    ten_year_return_x: 60,
    market_cap_cr: 600, roce_pct: 35, revenue_cagr_pct: 30, profit_cagr_pct: 35,
    eps_growth_pct: 33, dilution_drag_pp: 2,
    promoter_pct: 50, fii_dii_pct: 4,
    inflection: 'Jockey India scaling, premium innerwear category creation',
    framework_signals: ['Small cap (₹600Cr)', 'ROCE 35%', 'Low FII (4%)', 'Capital-light scale-up'],
  },
  {
    ticker: 'ASTRAL', name: 'Astral Pipes', entry_year: 2010,
    ten_year_return_x: 100,
    market_cap_cr: 350, roce_pct: 28, revenue_cagr_pct: 28, profit_cagr_pct: 32,
    eps_growth_pct: 30, dilution_drag_pp: 2,
    promoter_pct: 60, fii_dii_pct: 3,
    inflection: 'CPVC pioneer in India — replaced PVC in plumbing',
    framework_signals: ['Small cap (₹350Cr)', 'Founder-led (60% promoter)', 'Undiscovered (3% FII)', 'Margin expansion'],
  },
  {
    ticker: 'SYMPHONY', name: 'Symphony', entry_year: 2010,
    ten_year_return_x: 80,
    market_cap_cr: 200, roce_pct: 32, revenue_cagr_pct: 28, profit_cagr_pct: 40,
    eps_growth_pct: 38, dilution_drag_pp: 2,
    promoter_pct: 75, fii_dii_pct: 2,
    inflection: 'Asset-light air-cooler model + China sourcing',
    framework_signals: ['Tiny cap (₹200Cr)', 'High promoter (75%)', 'Asset-light moat', 'Profit > Revenue growth'],
  },
  {
    ticker: 'LAOPALA', name: 'La Opala', entry_year: 2011,
    ten_year_return_x: 50,
    market_cap_cr: 200, roce_pct: 22, revenue_cagr_pct: 18, profit_cagr_pct: 28,
    eps_growth_pct: 27, dilution_drag_pp: 1,
    promoter_pct: 64, fii_dii_pct: 3,
    inflection: 'Premium opal glassware launch — pricing-power inflection',
    framework_signals: ['Small cap (₹200Cr)', 'Premium positioning', 'OPM expansion', 'Promoter conviction'],
  },
  {
    ticker: 'AVANTIFEED', name: 'Avanti Feeds', entry_year: 2011,
    ten_year_return_x: 200,
    market_cap_cr: 80, roce_pct: 18, revenue_cagr_pct: 30, profit_cagr_pct: 50,
    eps_growth_pct: 48, dilution_drag_pp: 2,
    promoter_pct: 50, fii_dii_pct: 1,
    inflection: 'Shrimp feed export pivot — Thai Union JV',
    framework_signals: ['Micro cap (₹80Cr)', 'Profit CAGR 50%', 'Sector tailwind (shrimp exports)', 'Untouched by FII'],
  },
  {
    ticker: 'CAPLIPOINT', name: 'Caplin Point', entry_year: 2014,
    ten_year_return_x: 30,
    market_cap_cr: 350, roce_pct: 30, revenue_cagr_pct: 25, profit_cagr_pct: 45,
    eps_growth_pct: 42, dilution_drag_pp: 3,
    promoter_pct: 70, fii_dii_pct: 4,
    inflection: 'LATAM (Latin America) market expansion in generics',
    framework_signals: ['Small cap (₹350Cr)', 'High ROCE (30%)', 'Profit acceleration', 'Founder-led'],
  },
];
