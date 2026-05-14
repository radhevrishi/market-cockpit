// PATCH 0370 — Turnaround scoring engine.
//
// Specialised 7-dimension scoring for distressed-to-recovery setups.
// Different from regular multibagger scoring because:
//   - It's looking for INFLECTION (negative -> positive), not sustained quality
//   - It weights concall narrative as 15% (vs ~0% for regular multibagger)
//   - It scores from a low base (loss-making years count as POSITIVE signal,
//     not red flag, when paired with recovery)
//   - Stage classifier determines BUY-ZONE vs HOLD vs EXIT
//
// 7 Dimensions (total 100 points):
//   1. Earnings Trajectory Reversal     (25 pts) — PAT/Revenue/EPS inflection
//   2. Operational Reset                (15 pts) — OPM expansion, ROCE turn, op-leverage
//   3. Balance Sheet Repair             (15 pts) — D/E trend, interest coverage, debt reduction
//   4. Concall/Guidance Quality         (15 pts) — paste-text auto-parse (KEY signal)
//   5. Industry Tailwind                (10 pts) — sector momentum proxy
//   6. Management/Governance            (10 pts) — promoter buying, pledge reduction
//   7. Valuation Rerating Setup         (10 pts) — PE vs 5y median, EV/EBITDA vs sector
//
// Stage Classifier:
//   🚫 DISTRESS       — Don't buy yet
//   🌱 EARLY-SHOOTS   — BUY-ZONE 1 (small initial)
//   📈 PATTERN        — BUY-ZONE 2 (add to position)
//   ✅ CONFIRMED      — Hold, trim if up >40%
//   🌅 MATURE         — Exit fully

export interface TurnaroundRow {
  symbol: string;
  company: string;
  sector?: string;
  exchange?: string;
  // Spot
  cmp?: number;
  marketCapCr?: number;
  pe?: number;
  pe5yMedian?: number;
  evEbitda?: number;
  evEbitdaSectorMedian?: number;
  // Quarterly (last 4 quarters Q-1 = most recent)
  salesQ1?: number; salesQ2?: number; salesQ3?: number; salesQ4?: number;
  opProfitQ1?: number; opProfitQ2?: number; opProfitQ3?: number; opProfitQ4?: number;
  opmQ1?: number; opmQ2?: number; opmQ3?: number; opmQ4?: number;
  patQ1?: number; patQ2?: number; patQ3?: number; patQ4?: number;
  epsQ1?: number; epsQ2?: number; epsQ3?: number; epsQ4?: number;
  // Year-ago quarters (for YoY)
  patQ1Yoy?: number;     // PAT same quarter prior year
  salesQ1Yoy?: number;
  opmQ1Yoy?: number;
  // Annual 5y (Y-1 = most recent FY)
  salesY1?: number; salesY2?: number; salesY3?: number; salesY4?: number; salesY5?: number;
  patY1?: number; patY2?: number; patY3?: number; patY4?: number; patY5?: number;
  opmY1?: number; opmY2?: number; opmY3?: number; opmY4?: number; opmY5?: number;
  // PATCH 0373 — 5-year median OPM (Screener's "5Yr OPM %") used as
  // baseline for current OPM expansion signal.
  opm5yMedian?: number;
  // Annualised metrics
  revenueGrowth1y?: number;     // most recent FY revenue growth
  revenueGrowth3y?: number;     // 3y CAGR
  revenueGrowth5y?: number;     // 5y CAGR
  patGrowth1y?: number;
  patGrowth3y?: number;
  // Loss-making years count
  lossMakingYears5y?: number;
  // Balance sheet trajectory
  debtCurr?: number;       // most recent
  debt3yBack?: number;
  debt5yBack?: number;
  de?: number;             // current D/E
  interestCoverage?: number;
  interestCoverage3yBack?: number;
  workingCapitalDays?: number;
  workingCapitalDays3yBack?: number;
  // Returns
  roce?: number;
  roce3yBack?: number;
  roe?: number;
  // Governance
  promoterHolding?: number;
  promoterHolding3yBack?: number;
  promoterPledgePct?: number;
  auditorChangesLast5y?: number;
  // CEO/management change flag (optional, manually marked)
  managementChangeYear?: number;
  // Sector / cycle context
  sectorCycleScore?: number;  // 0-100 from user OR auto-derived
  // Concall narrative — paste-text
  concallText?: string;
  // 1y price perf — context
  perf1y?: number;
}

export type TurnaroundStage = 'DISTRESS' | 'SETUP' | 'EARLY-SHOOTS' | 'PATTERN' | 'CONFIRMED' | 'MATURE' | 'NOT-TURNAROUND';

// PATCH 0374 — Archetype = high-level "what IS this stock" classifier.
// User mostly uploads turnaround candidates but the dataset always includes
// mis-categorised stocks (growth stocks, quality compounders, value traps,
// declining businesses). The archetype tag tells them in one phrase
// whether the row belongs on THIS tab or somewhere else.
export type TurnaroundArchetype =
  | 'TURNAROUND'       // 🔄 Real turnaround setup — act on it
  | 'GROWTH'           // 🚀 Growth stock — wrong tab (use Multibagger)
  | 'QUALITY'          // 💎 Quality compounder — wrong tab
  | 'VALUE-TRAP'       // 🧊 Deep distress, no recovery — avoid
  | 'DECLINING'        // 📉 Revenue + profit both falling — avoid
  | 'WAIT'             // ⏸ Distress visible, no signal yet — watch
  | 'NEUTRAL';         // ❓ No strong thesis either way

export interface TurnaroundResult extends TurnaroundRow {
  // Dimension scores (raw)
  earningsScore: number;       // 0-25
  operationalScore: number;    // 0-15
  balanceSheetScore: number;   // 0-15
  concallScore: number;        // 0-15
  industryScore: number;       // 0-10
  governanceScore: number;     // 0-10
  valuationScore: number;      // 0-10
  // Composite
  totalScore: number;          // 0-100
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  stage: TurnaroundStage;
  stageColor: string;
  stageEmoji: string;
  inBuyZone: boolean;
  // PATCH 0374 — Archetype tag with explainer note
  archetype: TurnaroundArchetype;
  archetypeLabel: string;      // user-facing label with emoji
  archetypeNote: string;       // one-line rationale
  archetypeColor: string;
  // Diagnostics
  strengths: string[];
  risks: string[];
  concallPhrases: string[];    // detected institutional phrases
  inflectionSignals: string[]; // narrative description of the turn
  coverage: number;            // 0-100 how complete the data is
  missingFields: string[];     // PATCH 0374 — what's missing from this row's data
}

// ─── CONCALL PHRASE LEXICON (15 pts max) ─────────────────────────────────────
// Positive institutional phrases that signal real turnaround narrative.
const CONCALL_POSITIVE: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Operational recovery
  { pattern: /capacity\s+(?:expansion|addition|ramp)/i,        weight: 1.2, label: 'capacity expansion' },
  { pattern: /margin\s+(?:expansion|recovery|improvement)/i,    weight: 1.5, label: 'margin recovery' },
  { pattern: /operating\s+leverage/i,                           weight: 1.0, label: 'operating leverage' },
  { pattern: /cost\s+(?:optimization|optimisation|reduction)/i, weight: 1.0, label: 'cost optimisation' },
  { pattern: /(?:operational|operating)\s+turnaround/i,         weight: 1.8, label: 'operational turnaround' },
  // Financial repair
  { pattern: /(?:deleverag|debt\s+reduc|debt\s+(?:free|reduction)\s+plan)/i, weight: 1.5, label: 'deleveraging' },
  { pattern: /(?:free\s+cash\s+flow|fcf)\s+positive/i,         weight: 1.3, label: 'FCF positive' },
  { pattern: /asset\s+(?:monetisation|sale|divestment)/i,       weight: 1.0, label: 'asset monetisation' },
  // Demand / outlook
  { pattern: /(?:demand|order)\s+recovery/i,                    weight: 1.3, label: 'demand recovery' },
  { pattern: /strong\s+order\s+(?:book|inflow|pipeline)/i,      weight: 1.2, label: 'strong order book' },
  { pattern: /record\s+(?:order|revenue|quarter)/i,             weight: 1.3, label: 'record quarter' },
  { pattern: /(?:positive|favorable|favourable)\s+outlook/i,    weight: 1.0, label: 'positive outlook' },
  { pattern: /guidance\s+(?:raised|upgraded|increased)/i,       weight: 1.5, label: 'guidance raised' },
  { pattern: /(?:double|triple)\s+digit\s+growth/i,             weight: 1.2, label: 'double-digit growth' },
  // Strategic
  { pattern: /(?:new|fresh)\s+(?:product|launch|client|order)/i, weight: 0.9, label: 'new product/client' },
  { pattern: /strategic\s+(?:pivot|restructur|focus)/i,          weight: 1.4, label: 'strategic restructuring' },
  { pattern: /(?:greenfield|brownfield|commission)/i,            weight: 1.0, label: 'capex commissioning' },
  { pattern: /(?:tailwind|secular)\s+(?:growth)?/i,              weight: 0.9, label: 'sector tailwind' },
  // Management confidence
  { pattern: /confident|optimistic/i,                            weight: 0.7, label: 'mgmt confidence' },
  { pattern: /well\s+positioned/i,                               weight: 0.8, label: 'well positioned' },
];

// Negative phrases that REDUCE confidence in turnaround narrative
const CONCALL_NEGATIVE: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /muted|subdued|sluggish|weak/i,                     weight: -0.8, label: 'muted/weak' },
  { pattern: /headwind|challenging|tough\s+environment/i,        weight: -0.9, label: 'headwinds' },
  { pattern: /margin\s+(?:compression|contraction|pressure)/i,   weight: -1.2, label: 'margin compression' },
  { pattern: /demand\s+(?:slowdown|weakness|decline)/i,          weight: -1.1, label: 'demand slowdown' },
  { pattern: /(?:cautious|conservative|guarded)\s+(?:outlook|guidance)/i, weight: -0.9, label: 'cautious outlook' },
  { pattern: /downgrade|guidance\s+(?:cut|lowered|reduced)/i,    weight: -1.5, label: 'guidance cut' },
  { pattern: /uncertainty|unpredictab/i,                         weight: -0.5, label: 'uncertainty' },
  { pattern: /one[-\s]?time|exceptional\s+item/i,                weight: -0.5, label: 'one-time item' },
];

function pct(curr: number | undefined, prev: number | undefined): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ────────────────────────────────────────────────────────────────────────────
// SCORING — DIMENSION BY DIMENSION
// ────────────────────────────────────────────────────────────────────────────

function scoreEarningsTrajectory(row: TurnaroundRow, signals: string[]): number {
  let s = 0;

  // PAT inflection (most important — 10 pts max)
  // Pattern A: latest PAT positive AND prior 2 quarters negative -> classic turn
  if (row.patQ1 != null && row.patQ1 > 0) {
    let priorNegCount = 0;
    if (row.patQ2 != null && row.patQ2 <= 0) priorNegCount++;
    if (row.patQ3 != null && row.patQ3 <= 0) priorNegCount++;
    if (row.patQ4 != null && row.patQ4 <= 0) priorNegCount++;
    if (priorNegCount >= 2) {
      s += 10;
      signals.push(`PAT inflection: ₹${row.patQ1.toFixed(0)} Cr this quarter after ${priorNegCount} negative quarters`);
    } else if (priorNegCount >= 1) {
      s += 6;
      signals.push(`PAT turning positive: ₹${row.patQ1.toFixed(0)} Cr after recent losses`);
    }
  }

  // Pattern B: PAT YoY huge improvement
  const patYoY = pct(row.patQ1, row.patQ1Yoy);
  if (patYoY != null) {
    if (patYoY >= 100)      { s += 4; signals.push(`PAT YoY +${patYoY.toFixed(0)}%`); }
    else if (patYoY >= 50)  { s += 3; signals.push(`PAT YoY +${patYoY.toFixed(0)}%`); }
    else if (patYoY >= 25)  s += 2;
    else if (patYoY >= 0)   s += 1;
    else if (patYoY <= -25) s -= 2;
  }

  // Pattern C: Sequential PAT improvement (Q1 > Q2 > Q3 trend)
  const seqPos =
    row.patQ1 != null && row.patQ2 != null && row.patQ3 != null &&
    row.patQ1 > row.patQ2 && row.patQ2 > row.patQ3 && row.patQ1 > 0;
  if (seqPos) {
    s += 4;
    signals.push(`Sequential PAT growth Q3→Q2→Q1 each better`);
  } else if (row.patQ1 != null && row.patQ2 != null && row.patQ1 > row.patQ2 && row.patQ1 > 0) {
    s += 2;
  }

  // Revenue stabilization / recovery
  const revYoY = pct(row.salesQ1, row.salesQ1Yoy);
  if (revYoY != null) {
    if (revYoY >= 20)      { s += 3; signals.push(`Revenue YoY +${revYoY.toFixed(0)}%`); }
    else if (revYoY >= 5)  s += 2;
    else if (revYoY >= 0)  s += 1;
  } else if (row.salesQ1 != null && row.salesQ4 != null && row.salesQ1 > row.salesQ4 * 1.05) {
    s += 2;  // sequential revenue uptick
  }

  // Annual PAT recovery from loss
  const annualLossRecovery =
    row.patY1 != null && row.patY1 > 0 &&
    (row.patY2 != null && row.patY2 <= 0 || row.patY3 != null && row.patY3 <= 0);
  if (annualLossRecovery) {
    s += 4;
    signals.push(`Annual PAT positive after recent loss year(s)`);
  }

  return Math.min(25, Math.max(0, s));
}

function scoreOperationalReset(row: TurnaroundRow, signals: string[]): number {
  let s = 0;

  // OPM expansion 3pp+ YoY (5 pts)
  const opmYoY = (row.opmQ1 != null && row.opmQ1Yoy != null) ? row.opmQ1 - row.opmQ1Yoy : null;
  if (opmYoY != null) {
    if (opmYoY >= 5)      { s += 5; signals.push(`OPM expanded +${opmYoY.toFixed(1)}pp YoY`); }
    else if (opmYoY >= 3) { s += 4; signals.push(`OPM expanded +${opmYoY.toFixed(1)}pp YoY`); }
    else if (opmYoY >= 1) s += 2;
    else if (opmYoY <= -2) s -= 2;
  }

  // PATCH 0373 — Sequential OPM improvement using Q-1 vs Q-2 (works without Q-3).
  // Three-quarter sustained trend = extra bonus when Q-3 also available.
  if (row.opmQ1 != null && row.opmQ2 != null) {
    const delta = row.opmQ1 - row.opmQ2;
    if (delta >= 4)      { s += 3; signals.push(`OPM sequential up: ${row.opmQ2.toFixed(0)}% → ${row.opmQ1.toFixed(0)}% (+${delta.toFixed(1)}pp Q/Q)`); }
    else if (delta >= 2) { s += 2; signals.push(`OPM Q/Q +${delta.toFixed(1)}pp`); }
    else if (delta >= 0.5) s += 1;
    else if (delta <= -3) s -= 2;
    // Bonus for sustained 3-quarter trend if Q-3 available
    if (row.opmQ3 != null && row.opmQ1 > row.opmQ2 && row.opmQ2 > row.opmQ3) {
      s += 1;
    }
  }

  // PATCH 0373 — Annual OPM expansion vs 5-year baseline. Tells us whether
  // current OPM is at a structurally NEW high vs distress-era median.
  // Strong signal when OPM Ann > OPM Prev Ann > 5Y median.
  if (row.opmY1 != null && row.opm5yMedian != null) {
    const above5y = row.opmY1 - row.opm5yMedian;
    if (above5y >= 5)      { s += 3; signals.push(`Annual OPM ${row.opmY1.toFixed(0)}% is ${above5y.toFixed(1)}pp ABOVE 5y median ${row.opm5yMedian.toFixed(0)}% — structural margin shift`); }
    else if (above5y >= 2) { s += 2; signals.push(`Annual OPM expanding from 5y baseline (+${above5y.toFixed(1)}pp)`); }
    else if (above5y <= -3) s -= 1;
  }
  if (row.opmY1 != null && row.opmY2 != null) {
    const yoyDelta = row.opmY1 - row.opmY2;
    if (yoyDelta >= 3)      s += 2;  // already may have captured via quarterly path, soft cap below
    else if (yoyDelta >= 1) s += 1;
    else if (yoyDelta <= -2) s -= 1;
  }

  // ROCE inflection — 3yr improvement
  if (row.roce != null && row.roce3yBack != null) {
    const roceDelta = row.roce - row.roce3yBack;
    if (roceDelta >= 10)      { s += 4; signals.push(`ROCE up ${roceDelta.toFixed(0)}pp over 3 years`); }
    else if (roceDelta >= 5)  { s += 3; signals.push(`ROCE up ${roceDelta.toFixed(0)}pp over 3 years`); }
    else if (roceDelta >= 2)  s += 2;
    else if (roceDelta <= -3) s -= 2;
  }

  // Operating leverage: PAT growth > revenue growth
  const patY = pct(row.patQ1, row.patQ1Yoy);
  const salesY = pct(row.salesQ1, row.salesQ1Yoy);
  if (patY != null && salesY != null && patY > salesY && patY > 0) {
    const leverage = patY - salesY;
    if (leverage >= 50)      { s += 3; signals.push(`Op leverage: PAT +${patY.toFixed(0)}% vs Revenue +${salesY.toFixed(0)}%`); }
    else if (leverage >= 20) s += 2;
    else if (leverage >= 10) s += 1;
  }

  return Math.min(15, Math.max(0, s));
}

function scoreBalanceSheetRepair(row: TurnaroundRow, signals: string[]): number {
  let s = 0;

  // Debt reduction 3y
  if (row.debtCurr != null && row.debt3yBack != null && row.debt3yBack > 0) {
    const debtChange = ((row.debtCurr - row.debt3yBack) / row.debt3yBack) * 100;
    if (debtChange <= -30)      { s += 5; signals.push(`Debt down ${Math.abs(debtChange).toFixed(0)}% over 3y`); }
    else if (debtChange <= -15) { s += 3; signals.push(`Debt down ${Math.abs(debtChange).toFixed(0)}% over 3y`); }
    else if (debtChange <= -5)  s += 2;
    else if (debtChange >= 50)  s -= 3;
  }

  // Interest coverage improvement
  if (row.interestCoverage != null && row.interestCoverage3yBack != null) {
    if (row.interestCoverage >= 5 && row.interestCoverage > row.interestCoverage3yBack + 2) {
      s += 4;
      signals.push(`Interest coverage ${row.interestCoverage.toFixed(1)}x (was ${row.interestCoverage3yBack.toFixed(1)}x)`);
    } else if (row.interestCoverage >= 3) {
      s += 2;
    } else if (row.interestCoverage < 1.5) {
      s -= 3;
    }
  } else if (row.interestCoverage != null) {
    if (row.interestCoverage >= 5)      s += 3;
    else if (row.interestCoverage >= 3) s += 2;
    else if (row.interestCoverage < 1.5) s -= 3;
  }

  // Current D/E
  if (row.de != null) {
    if (row.de < 0.3)      s += 3;
    else if (row.de < 0.7) s += 2;
    else if (row.de < 1.5) s += 1;
    else if (row.de > 3)   s -= 3;
  }

  // Working capital days improvement
  if (row.workingCapitalDays != null && row.workingCapitalDays3yBack != null) {
    const wcDelta = row.workingCapitalDays - row.workingCapitalDays3yBack;
    if (wcDelta <= -30) { s += 3; signals.push(`Working capital days improved by ${Math.abs(wcDelta).toFixed(0)}d`); }
    else if (wcDelta <= -10) s += 1;
    else if (wcDelta >= 30) s -= 2;
  }

  return Math.min(15, Math.max(0, s));
}

function scoreConcallNarrative(row: TurnaroundRow, signals: string[], phrasesOut: string[]): number {
  const text = (row.concallText || '').toLowerCase();
  if (!text.trim()) return 0;

  let raw = 0;
  for (const { pattern, weight, label } of CONCALL_POSITIVE) {
    if (pattern.test(text)) {
      raw += weight;
      phrasesOut.push(label);
    }
  }
  for (const { pattern, weight, label } of CONCALL_NEGATIVE) {
    if (pattern.test(text)) {
      raw += weight;  // weight is negative
      phrasesOut.push(`⚠ ${label}`);
    }
  }
  // Cap raw at ~15 with diminishing returns: above 8, log-compress
  let pts: number;
  if (raw <= 8) pts = raw;
  else pts = 8 + Math.log2(raw - 7) * 2;
  pts = Math.max(0, Math.min(15, pts));

  if (pts >= 8) signals.push(`Strong concall narrative (${phrasesOut.length} institutional phrases)`);
  else if (pts >= 4) signals.push(`Moderate concall narrative (${phrasesOut.length} phrases)`);

  return pts;
}

function scoreIndustryTailwind(row: TurnaroundRow, signals: string[]): number {
  let s = 0;
  // If user/data provides a sector cycle score, use it directly
  if (row.sectorCycleScore != null) {
    if (row.sectorCycleScore >= 80)      { s += 10; signals.push(`Sector in strong upcycle (${row.sectorCycleScore})`); }
    else if (row.sectorCycleScore >= 60) { s += 7;  signals.push(`Sector cycle favourable (${row.sectorCycleScore})`); }
    else if (row.sectorCycleScore >= 40) s += 4;
    else if (row.sectorCycleScore < 20)  s -= 2;
  } else {
    // Heuristic: large 1y price perf with PAT recovery suggests sector tailwind
    if (row.perf1y != null && row.perf1y > 50 && row.patQ1 != null && row.patQ1 > 0) {
      s += 5;
      signals.push(`Price action +${row.perf1y.toFixed(0)}% suggests sector tailwind`);
    } else if (row.perf1y != null && row.perf1y > 25) {
      s += 3;
    } else if (row.perf1y != null && row.perf1y < -25) {
      s -= 1;
    }
  }
  return Math.min(10, Math.max(0, s));
}

function scoreGovernance(row: TurnaroundRow, signals: string[]): number {
  let s = 0;

  // Promoter holding increase
  if (row.promoterHolding != null && row.promoterHolding3yBack != null) {
    const delta = row.promoterHolding - row.promoterHolding3yBack;
    if (delta >= 3)      { s += 4; signals.push(`Promoters buying: +${delta.toFixed(1)}pp over 3y`); }
    else if (delta >= 1) s += 2;
    else if (delta <= -3) s -= 2;
  }

  // Pledge — low/zero is good, high is bad
  if (row.promoterPledgePct != null) {
    if (row.promoterPledgePct === 0)       s += 3;
    else if (row.promoterPledgePct < 10)   s += 1;
    else if (row.promoterPledgePct >= 50)  s -= 4;
    else if (row.promoterPledgePct >= 25)  s -= 2;
  }

  // Auditor changes
  if (row.auditorChangesLast5y != null) {
    if (row.auditorChangesLast5y === 0)      s += 1;
    else if (row.auditorChangesLast5y >= 2)  s -= 2;
  }

  // Recent management change (within last 3y)
  if (row.managementChangeYear != null) {
    const yrsSince = new Date().getFullYear() - row.managementChangeYear;
    if (yrsSince >= 0 && yrsSince <= 3) {
      s += 3;
      signals.push(`Management change ${yrsSince}y ago — fresh leadership signal`);
    }
  }

  return Math.min(10, Math.max(0, s));
}

function scoreValuationRerating(row: TurnaroundRow, signals: string[]): number {
  let s = 0;

  // PE below 5y median (compressed during distress)
  if (row.pe != null && row.pe5yMedian != null && row.pe5yMedian > 0) {
    const peRatio = row.pe / row.pe5yMedian;
    if (peRatio < 0.5)     { s += 5; signals.push(`PE ${row.pe.toFixed(0)}× is ${(peRatio * 100).toFixed(0)}% of 5y median — deep value`); }
    else if (peRatio < 0.7) { s += 4; signals.push(`PE compressed vs 5y median`); }
    else if (peRatio < 0.9) s += 2;
    else if (peRatio > 1.5) s -= 2;
  } else if (row.pe != null) {
    // Fallback: absolute PE buckets
    if (row.pe < 12)      s += 3;
    else if (row.pe < 20) s += 2;
    else if (row.pe > 60) s -= 2;
  }

  // EV/EBITDA vs sector
  if (row.evEbitda != null && row.evEbitdaSectorMedian != null && row.evEbitdaSectorMedian > 0) {
    const ratio = row.evEbitda / row.evEbitdaSectorMedian;
    if (ratio < 0.7)      { s += 3; signals.push(`EV/EBITDA below sector median`); }
    else if (ratio < 0.9) s += 1;
    else if (ratio > 1.5) s -= 1;
  }

  // Loss-making years history — depressed base is the OPPORTUNITY (counter to regular scoring)
  if (row.lossMakingYears5y != null && row.lossMakingYears5y > 0) {
    if (row.patQ1 != null && row.patQ1 > 0) {
      // Loss history + current profit = textbook turnaround base
      if (row.lossMakingYears5y >= 3) {
        s += 2;
        signals.push(`${row.lossMakingYears5y}/5 prior years loss-making — depressed base for recovery`);
      } else if (row.lossMakingYears5y >= 1) {
        s += 1;
      }
    }
  }

  return Math.min(10, Math.max(0, s));
}

// ────────────────────────────────────────────────────────────────────────────
// STAGE CLASSIFIER
// ────────────────────────────────────────────────────────────────────────────

function classifyStage(row: TurnaroundRow): { stage: TurnaroundStage; color: string; emoji: string; inBuyZone: boolean } {
  // Count consecutive quarters of improvement
  let improvingQuarters = 0;
  if (row.patQ1 != null && row.patQ2 != null && row.patQ1 > row.patQ2) improvingQuarters++;
  if (row.patQ2 != null && row.patQ3 != null && row.patQ2 > row.patQ3) improvingQuarters++;
  if (row.patQ3 != null && row.patQ4 != null && row.patQ3 > row.patQ4) improvingQuarters++;

  // Inflection signal: PAT just turned positive
  const justTurnedPositive =
    row.patQ1 != null && row.patQ1 > 0 &&
    ((row.patQ2 != null && row.patQ2 <= 0) || (row.patQ3 != null && row.patQ3 <= 0));

  // Count consecutive negative quarters (distress indicator)
  let consecNegative = 0;
  if (row.patQ1 != null && row.patQ1 < 0) consecNegative++;
  if (row.patQ2 != null && row.patQ2 < 0) consecNegative++;
  if (row.patQ3 != null && row.patQ3 < 0) consecNegative++;
  if (row.patQ4 != null && row.patQ4 < 0) consecNegative++;

  // ROCE strong + sustained profit = MATURE (recovery complete)
  const matureSignal = row.roce != null && row.roce >= 18 && improvingQuarters >= 2 &&
                       row.patQ1 != null && row.patQ1 > 0 &&
                       row.perf1y != null && row.perf1y > 80;

  // PATCH 0374 — SETUP detection: distress but with green-shoots that
  // haven't yet flipped PAT positive. Worth watching, not BUY-ZONE yet.
  // At least 2 of these fire:
  //   - Revenue Q-1 > Q-2 by 10%+ (top-line accelerating)
  //   - OPM Q-1 > Q-2 by 3pp+ (margin recovery starting)
  //   - Debt down 20%+ over 3y (balance sheet repair)
  //   - 1y price perf > 30% (market positioning ahead)
  //   - ROCE 3y delta > +5pp (returns inflecting up)
  let setupSignals = 0;
  if (row.salesQ1 != null && row.salesQ2 != null && row.salesQ2 > 0 && row.salesQ1 > row.salesQ2 * 1.10) setupSignals++;
  if (row.opmQ1 != null && row.opmQ2 != null && (row.opmQ1 - row.opmQ2) >= 3) setupSignals++;
  if (row.debtCurr != null && row.debt3yBack != null && row.debt3yBack > 0 &&
      ((row.debt3yBack - row.debtCurr) / row.debt3yBack) >= 0.20) setupSignals++;
  if ((row.perf1y ?? 0) > 30) setupSignals++;
  if (row.roce != null && row.roce3yBack != null && (row.roce - row.roce3yBack) >= 5) setupSignals++;

  if (matureSignal) {
    return { stage: 'MATURE', color: '#94A3B8', emoji: '🌅', inBuyZone: false };
  }
  if (improvingQuarters >= 3 && row.patQ1 != null && row.patQ1 > 0) {
    return { stage: 'CONFIRMED', color: '#10B981', emoji: '✅', inBuyZone: false };
  }
  if (improvingQuarters >= 2 && row.patQ1 != null && row.patQ1 > 0) {
    return { stage: 'PATTERN', color: '#22D3EE', emoji: '📈', inBuyZone: true };
  }
  if (justTurnedPositive || (improvingQuarters >= 1 && row.patQ1 != null && row.patQ1 > 0)) {
    return { stage: 'EARLY-SHOOTS', color: '#F59E0B', emoji: '🌱', inBuyZone: true };
  }
  // SETUP: distress + ≥2 green-shoots (watch-list, not BUY-ZONE yet)
  if (consecNegative >= 1 && setupSignals >= 2) {
    return { stage: 'SETUP', color: '#A78BFA', emoji: '🔥', inBuyZone: false };
  }
  return { stage: 'DISTRESS', color: '#EF4444', emoji: '🚫', inBuyZone: false };
}

// PATCH 0374 — Archetype classifier. Tells the user what KIND of stock
// each row is, so they can spot mis-categorised uploads (growth stocks,
// quality compounders, value traps, declining businesses) vs real
// turnaround candidates.
function classifyArchetype(row: TurnaroundRow): { archetype: TurnaroundArchetype; label: string; note: string; color: string } {
  const patQ1 = row.patQ1;
  const positiveLatestPAT = patQ1 != null && patQ1 > 0;
  const negLatestPAT = patQ1 != null && patQ1 < 0;
  const lossYears = row.lossMakingYears5y ?? 0;
  const roce = row.roce ?? null;
  const roce3y = row.roce3yBack ?? null;
  const revG3y = row.revenueGrowth3y ?? null;
  const patG3y = row.patGrowth3y ?? null;
  const de = row.de ?? null;
  const opmYoYQ = (row.opmQ1 != null && row.opmQ2 != null) ? row.opmQ1 - row.opmQ2 : null;
  const debtReduction3y = (row.debtCurr != null && row.debt3yBack != null && row.debt3yBack > 0)
    ? (row.debt3yBack - row.debtCurr) / row.debt3yBack : null;

  // 🚀 GROWTH STOCK — strong revenue + profit + ROCE, no distress, positive PAT
  if (positiveLatestPAT && lossYears === 0 && (revG3y ?? 0) > 25 && (patG3y ?? -99) > 25 && (roce ?? 0) >= 18) {
    return {
      archetype: 'GROWTH',
      label: '🚀 GROWTH',
      note: `Growth stock — Rev 3y +${revG3y?.toFixed(0)}%, PAT +${patG3y?.toFixed(0)}%, ROCE ${roce?.toFixed(0)}%. Not a turnaround setup. Use Multibagger tab instead.`,
      color: '#10B981',
    };
  }

  // 💎 QUALITY COMPOUNDER — high sustained ROCE, no distress, modest growth
  if (positiveLatestPAT && lossYears === 0 && (roce ?? 0) >= 18 && (revG3y ?? 0) > 10 && (revG3y ?? 99) <= 25) {
    return {
      archetype: 'QUALITY',
      label: '💎 QUALITY',
      note: `Established compounder — ROCE ${roce?.toFixed(0)}%, ${revG3y?.toFixed(0)}% rev growth, no loss years. Not in distress, not a turnaround setup.`,
      color: '#22D3EE',
    };
  }

  // 🔄 TURNAROUND CANDIDATE — distress history + recovery signal firing
  const hasRecoverySignal = (
    (opmYoYQ != null && opmYoYQ >= 3) ||
    (positiveLatestPAT && row.patQ2 != null && row.patQ2 <= 0) ||  // PAT just turned positive
    (debtReduction3y != null && debtReduction3y >= 0.15) ||
    (roce != null && roce3y != null && (roce - roce3y) >= 5)
  );
  const hasDistressContext = lossYears >= 1 || negLatestPAT || (roce ?? 99) < 10 || (row.patQ4 ?? 1) < 0;

  if (hasDistressContext && hasRecoverySignal) {
    return {
      archetype: 'TURNAROUND',
      label: '🔄 TURNAROUND',
      note: `Real turnaround setup — distress history (loss yrs ${lossYears}, ROCE ${roce?.toFixed(0) ?? '—'}%) AND recovery signal firing. This is what the tab is for.`,
      color: '#F59E0B',
    };
  }

  // 🧊 VALUE TRAP RISK — deep distress, no recovery, high debt or no signal
  if (lossYears >= 3 && negLatestPAT && (de ?? 0) > 1.5) {
    return {
      archetype: 'VALUE-TRAP',
      label: '🧊 VALUE TRAP',
      note: `Deep distress: ${lossYears}/5 loss years, D/E ${de?.toFixed(1)}, ROCE ${roce?.toFixed(0) ?? '—'}%. No clear recovery signal yet — capital trap risk.`,
      color: '#EF4444',
    };
  }

  // 📉 DECLINING — top-line + bottom-line both falling
  if ((row.revenueGrowth1y ?? 0) < -5 && (row.patGrowth1y ?? 0) < -10) {
    return {
      archetype: 'DECLINING',
      label: '📉 DECLINING',
      note: `Revenue ${row.revenueGrowth1y?.toFixed(0)}% YoY, profit ${row.patGrowth1y?.toFixed(0)}% — accelerating decline, not turnaround material.`,
      color: '#EF4444',
    };
  }

  // ⏸ WAIT — distress visible but no signal yet
  if (hasDistressContext) {
    return {
      archetype: 'WAIT',
      label: '⏸ WAIT',
      note: `Distress visible (loss yrs ${lossYears}, current PAT ${patQ1?.toFixed(0) ?? '—'}) but no recovery signal yet — watch quarterly results for OPM Q/Q +3pp or PAT turning positive.`,
      color: '#94A3B8',
    };
  }

  // ❓ NEUTRAL — neither distress nor strong growth
  return {
    archetype: 'NEUTRAL',
    label: '❓ NEUTRAL',
    note: `Neither distressed nor strong-growth — no turnaround thesis. PAT ${patQ1?.toFixed(0) ?? '—'} Cr, ROCE ${roce?.toFixed(0) ?? '—'}%, revenue ${row.revenueGrowth1y?.toFixed(0) ?? '—'}% YoY.`,
    color: '#6B7A8D',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC: score a single row
// ────────────────────────────────────────────────────────────────────────────

export function scoreTurnaroundRow(row: TurnaroundRow): TurnaroundResult {
  const strengths: string[] = [];
  const risks: string[] = [];
  const phrases: string[] = [];
  const inflectionSignals: string[] = [];

  const earningsScore     = scoreEarningsTrajectory(row, inflectionSignals);
  const operationalScore  = scoreOperationalReset(row, strengths);
  const balanceSheetScore = scoreBalanceSheetRepair(row, strengths);
  const concallScore      = scoreConcallNarrative(row, strengths, phrases);
  const industryScore     = scoreIndustryTailwind(row, strengths);
  const governanceScore   = scoreGovernance(row, strengths);
  const valuationScore    = scoreValuationRerating(row, strengths);

  const totalScore = earningsScore + operationalScore + balanceSheetScore +
                     concallScore + industryScore + governanceScore + valuationScore;

  // Collect risks heuristically
  if (row.de != null && row.de > 2) risks.push(`High D/E ${row.de.toFixed(1)}×`);
  if (row.promoterPledgePct != null && row.promoterPledgePct >= 25) risks.push(`Pledge ${row.promoterPledgePct.toFixed(0)}%`);
  if (row.interestCoverage != null && row.interestCoverage < 1.5) risks.push(`Interest coverage ${row.interestCoverage.toFixed(1)}× — distress`);
  if (row.lossMakingYears5y != null && row.lossMakingYears5y >= 4 && (!row.patQ1 || row.patQ1 <= 0)) {
    risks.push(`${row.lossMakingYears5y}/5 loss years — value trap risk if no inflection`);
  }
  if (row.auditorChangesLast5y != null && row.auditorChangesLast5y >= 2) risks.push(`${row.auditorChangesLast5y} auditor changes in 5y`);
  if (!row.concallText || !row.concallText.trim()) {
    risks.push(`No concall narrative pasted — concall dimension scored 0`);
  }

  // PATCH 0374 — Archetype tag with one-line explainer
  const arche = classifyArchetype(row);
  // PATCH 0376 — Stage classifier respects archetype. Quality/Growth/Neutral
  // companies are NOT turnarounds, so don't apply turnaround stages to them.
  // Otherwise a great compounder like Cummins or BEL gets mislabelled as
  // 'DISTRESS' just because there's no PAT inflection visible (there's no
  // inflection because the company has been good all along).
  let stage: TurnaroundStage;
  let color: string;
  let emoji: string;
  let inBuyZone: boolean;
  if (arche.archetype === 'GROWTH' || arche.archetype === 'QUALITY' || arche.archetype === 'NEUTRAL') {
    stage = 'NOT-TURNAROUND';
    color = arche.color;
    emoji = arche.archetype === 'GROWTH' ? '🚀' : arche.archetype === 'QUALITY' ? '💎' : '❓';
    inBuyZone = false;  // Wrong tab; user should move to Multibagger India
  } else {
    // TURNAROUND / WAIT / VALUE-TRAP / DECLINING → run turnaround stage logic
    const s = classifyStage(row);
    stage = s.stage;
    color = s.color;
    emoji = s.emoji;
    inBuyZone = s.inBuyZone;
  }

  // Grade by composite
  const grade: TurnaroundResult['grade'] =
    totalScore >= 80 ? 'A+' :
    totalScore >= 70 ? 'A' :
    totalScore >= 60 ? 'B+' :
    totalScore >= 45 ? 'B' :
    totalScore >= 30 ? 'C' : 'D';

  // Coverage + missingFields list
  const criticalFields: Array<[keyof TurnaroundRow, string]> = [
    ['patQ1', 'PAT Qtr'], ['patQ2', 'PAT Prev Qtr'], ['patQ3', 'PAT 2Qtr Bk'],
    ['salesQ1', 'Sales Qtr'], ['opmQ1', 'OPM Qtr'], ['opmQ2', 'OPM Prev Qtr'],
    ['roce', 'ROCE'], ['roce3yBack', 'ROCE 3Y back'], ['de', 'D/E'], ['pe', 'P/E'],
    ['debtCurr', 'Debt'], ['debt3yBack', 'Debt 3Y back'],
    ['interestCoverage', 'Interest Coverage'],
    ['promoterHolding', 'Promoter Holding'], ['promoterHolding3yBack', 'Prom Hold 3Y change'],
    ['concallText', 'Concall narrative'],
    ['lossMakingYears5y', 'Loss making years'],
    ['perf1y', '1Yr return'],
  ];
  const missingFields: string[] = [];
  let filledCritical = 0;
  for (const [field, label] of criticalFields) {
    const v = row[field];
    if (v != null && v !== '' && !(typeof v === 'number' && isNaN(v))) {
      filledCritical++;
    } else {
      missingFields.push(label);
    }
  }
  const coverage = Math.round((filledCritical / criticalFields.length) * 100);

  return {
    ...row,
    earningsScore, operationalScore, balanceSheetScore,
    concallScore, industryScore, governanceScore, valuationScore,
    totalScore: Math.round(totalScore * 10) / 10,
    grade,
    stage, stageColor: color, stageEmoji: emoji, inBuyZone,
    archetype: arche.archetype,
    archetypeLabel: arche.label,
    archetypeNote: arche.note,
    archetypeColor: arche.color,
    strengths,
    risks,
    concallPhrases: phrases,
    inflectionSignals,
    coverage,
    missingFields,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CSV PARSE — accepts the same Screener.in export pattern, with extra columns
// ────────────────────────────────────────────────────────────────────────────

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).replace(/,/g, '').replace(/[%×]/g, '').trim();
  if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// PATCH 0374 — Resilient header lookup. Screener exports often have
// trailing whitespace ('P/E ') or subtle variations. Normalize the row's
// keys at the entry point so every lookup matches regardless of casing
// / whitespace / dots / hyphens / underscores.
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    out[k] = row[k];           // keep original
    out[k.trim()] = row[k];    // and trimmed-only
    out[norm(k)] = row[k];     // and fully-normalised (lowercase + collapsed-space)
  }
  return out;
}

export function parseTurnaroundRow(rawRow: Record<string, unknown>): TurnaroundRow | null {
  const row = normalizeRow(rawRow);
  // Symbol — try multiple common header variants
  const symbol = String(
    row['Symbol'] || row['symbol'] || row['Ticker'] || row['ticker'] || row['NSE Code'] || row['BSE Code'] || ''
  ).trim().toUpperCase();
  if (!symbol) return null;
  const company = String(row['Name'] || row['Company'] || row['Company Name'] || symbol).trim();

  return {
    symbol, company,
    sector: String(row['Industry'] || row['Sector'] || '').trim() || undefined,
    exchange: 'NSE',
    // PATCH 0372 — real Screener.in header names
    cmp: num(row['CMP Rs.'] || row['CMP'] || row['Current Price'] || row['Price']),
    marketCapCr: num(row['Mar Cap Rs.Cr.'] || row['Market Capitalization'] || row['Market Cap'] || row['Mar Cap']),
    pe: num(row['P/E'] || row['Price to Earning'] || row['PE']),
    // PATCH 0373 — actual Screener field name
    pe5yMedian: num(row['5Yrs PE'] || row['PE 5Yrs Median'] || row['Median PE 5Y']),
    evEbitda: num(row['EV / EBITDA'] || row['EV/EBITDA']),
    evEbitdaSectorMedian: num(row['Sector EV/EBITDA'] || row['Sector median EV/EBITDA'] || row['Ind PE']),

    // PATCH 0372 — actual Screener.in column names (the user's real export
    // headers). Each field now lists Screener's canonical name FIRST,
    // followed by older guesses for backwards compatibility.
    salesQ1: num(row['Sales Qtr Rs.Cr.'] || row['Sales Qtr'] || row['Sales latest quarter'] || row['Sales Q-1']),
    salesQ2: num(row['Sales Prev Qtr Rs.Cr.'] || row['Sales Prev Qtr'] || row['Sales preceding quarter'] || row['Sales Q-2']),
    salesQ3: num(row['Sales 2Qtr Bk Rs.Cr.'] || row['Sales 2Qtr Bk'] || row['Sales 2 quarter back'] || row['Sales Q-3']),
    salesQ4: num(row['Sales 3Qtr Bk Rs.Cr.'] || row['Sales 3Qtr Bk'] || row['Sales 3 quarter back'] || row['Sales Q-4']),
    // Op profit quarterly — Screener doesn't have these as separate columns
    // beyond the current quarter; we leave them as optional.
    opProfitQ1: num(row['OpProfit Qtr Rs.Cr.'] || row['Operating Profit latest quarter'] || row['Op Profit']),
    opProfitQ2: num(row['OpProfit Prev Qtr Rs.Cr.']),
    opProfitQ3: num(row['OpProfit 2Qtr Bk Rs.Cr.']),
    opProfitQ4: num(row['OpProfit 3Qtr Bk Rs.Cr.']),
    // PATCH 0373 — Screener exposes OPM Qtr % and OPM Prev Qtr %.
    // Sequential OPM trend now scores using just Q-1 + Q-2 (no longer
    // requiring Q-3 / Q-4).
    opmQ1: num(row['OPM Qtr %'] || row['OPM Qtr'] || row['OPM latest quarter'] || row['OPM Q-1']),
    opmQ2: num(row['OPM Prev Qtr %'] || row['OPM Prev Qtr']),
    opmQ3: num(row['OPM 2Qtr Bk %'] || row['OPM 2Qtr Bk']),
    opmQ4: num(row['OPM 3Qtr Bk %'] || row['OPM 3Qtr Bk']),
    // PAT quarterly — Screener uses 'PAT Qtr' / 'PAT Prev Qtr' / 'NP 2Qtr Bk' / 'NP 3Qtr Bk'
    patQ1: num(row['PAT Qtr Rs.Cr.'] || row['PAT Qtr'] || row['Net Profit latest quarter'] || row['PAT Q-1']),
    patQ2: num(row['PAT Prev Qtr Rs.Cr.'] || row['PAT Prev Qtr'] || row['Net profit preceding quarter'] || row['PAT Q-2']),
    patQ3: num(row['NP 2Qtr Bk Rs.Cr.'] || row['NP 2Qtr Bk'] || row['PAT 2Qtr Bk'] || row['PAT Q-3']),
    patQ4: num(row['NP 3Qtr Bk Rs.Cr.'] || row['NP 3Qtr Bk'] || row['PAT 3Qtr Bk'] || row['PAT Q-4']),
    epsQ1: num(row['EPS Qtr Rs.'] || row['EPS Qtr'] || row['EPS latest quarter'] || row['EPS Q-1']),
    epsQ2: num(row['EPS Prev Qtr Rs.'] || row['EPS Prev Qtr']),
    epsQ3: num(row['EPS 2Qtr Bk Rs.'] || row['EPS 2Qtr Bk']),
    epsQ4: num(row['EPS 3Qtr Bk Rs.'] || row['EPS 3Qtr Bk']),
    // PATCH 0372 — YoY signals via 'Qtr Profit Var %' / 'Qtr Sales Var %'
    // which Screener provides directly. These ARE the YoY %, so we treat
    // them as YoY change rather than absolute prior-period values.
    // The scorer reads patQ1Yoy/salesQ1Yoy as YOY ABSOLUTES — so we derive
    // them from current * (1 / (1 + var/100)).
    patQ1Yoy: (() => {
      const cur = num(row['PAT Qtr Rs.Cr.'] || row['PAT Qtr']);
      const varPct = num(row['Qtr Profit Var %'] || row['Qtr Profit Var']);
      if (cur != null && varPct != null && varPct !== -100) return cur / (1 + varPct / 100);
      return num(row['PAT Q-1 YoY'] || row['Net profit YoY same quarter']);
    })(),
    salesQ1Yoy: (() => {
      const cur = num(row['Sales Qtr Rs.Cr.'] || row['Sales Qtr']);
      const varPct = num(row['Qtr Sales Var %'] || row['Qtr Sales Var']);
      if (cur != null && varPct != null && varPct !== -100) return cur / (1 + varPct / 100);
      return num(row['Sales Q-1 YoY']);
    })(),
    opmQ1Yoy: num(row['OPM Q-1 YoY'] || row['OPM YoY change']),

    // Annual
    salesY1: num(row['Sales last year'] || row['Sales Y-1']),
    salesY2: num(row['Sales 2 year back'] || row['Sales Y-2']),
    salesY3: num(row['Sales 3 year back'] || row['Sales Y-3']),
    salesY4: num(row['Sales 4 year back'] || row['Sales Y-4']),
    salesY5: num(row['Sales 5 year back'] || row['Sales Y-5']),
    patY1: num(row['PAT last year'] || row['Net profit last year'] || row['PAT Y-1']),
    patY2: num(row['PAT 2 year back'] || row['PAT Y-2']),
    patY3: num(row['PAT 3 year back'] || row['PAT Y-3']),
    patY4: num(row['PAT 4 year back'] || row['PAT Y-4']),
    patY5: num(row['PAT 5 year back'] || row['PAT Y-5']),
    // PATCH 0373 — actual Screener fields
    opmY1: num(row['OPM Ann %'] || row['OPM last year'] || row['OPM Y-1']),
    opmY2: num(row['OPM Prev Ann %'] || row['OPM 2 year back'] || row['OPM Y-2']),
    opmY3: num(row['OPM 3 year back'] || row['OPM Y-3']),
    opm5yMedian: num(row['5Yr OPM %'] || row['OPM 5Y median'] || row['5Yrs OPM %']),

    // PATCH 0372 — match real Screener column names ('Sales growth %',
    // 'Profit growth %', 'Sales Var 3Yrs %', 'Profit Var 3Yrs %', etc.)
    revenueGrowth1y: num(row['Sales growth %'] || row['Sales growth'] || row['Sales Var %']),
    revenueGrowth3y: num(row['Sales Var 3Yrs %'] || row['Sales growth 3Years'] || row['Sales 3Y CAGR']),
    revenueGrowth5y: num(row['Sales Var 5Yrs %'] || row['Sales growth 5Years'] || row['Sales 5Y CAGR']),
    patGrowth1y: num(row['Profit growth %'] || row['Profit growth'] || row['PAT growth']),
    patGrowth3y: num(row['Profit Var 3Yrs %'] || row['Profit growth 3Years'] || row['PAT 3Y CAGR']),

    lossMakingYears5y: num(row['Loss making years'] || row['Loss years 5Y']),

    debtCurr: num(row['Debt Rs.Cr.'] || row['Debt'] || row['Total Debt']),
    // PATCH 0373 — actual Screener field name
    debt3yBack: num(row['Debt 3Yrs Rs.Cr.'] || row['Debt 3 year back'] || row['Debt 3Yr back']),
    debt5yBack: num(row['Debt 5Yrs Rs.Cr.'] || row['Debt 5 year back'] || row['Debt 5Y back']),
    de: num(row['Debt / Eq'] || row['Debt to equity'] || row['D/E']),
    interestCoverage: num(row['Int Coverage'] || row['Interest Coverage Ratio'] || row['Interest coverage']),
    interestCoverage3yBack: num(row['Int Coverage 3yrs back'] || row['Interest coverage 3Y back']),
    workingCapitalDays: num(row['WC Days'] || row['Working Capital Days']),
    workingCapitalDays3yBack: num(row['WC Days 3yrs'] || row['WC Days 3yrs back'] || row['Working capital days 3Y back']),

    roce: num(row['ROCE %'] || row['Return on capital employed'] || row['ROCE']),
    roce3yBack: num(row['ROCE 3Yr %'] || row['ROCE 3 year back'] || row['ROCE 3Y back']),
    roe: num(row['Return on equity'] || row['ROE %'] || row['ROE']),

    promoterHolding: num(row['Prom. Hold. %'] || row['Promoter holding %'] || row['Promoter holding']),
    // Screener gives a 3yr CHANGE (delta), not the 3yr-back absolute. The scorer
    // reads holding3yBack as the prior value; back-compute it from current - delta.
    promoterHolding3yBack: (() => {
      const cur = num(row['Prom. Hold. %'] || row['Promoter holding %']);
      const delta = num(row['Chg in Prom Hold 3Yr %'] || row['Change in promoter holding 3Years']);
      if (cur != null && delta != null) return cur - delta;
      return num(row['Promoter holding 3 year back']);
    })(),
    promoterPledgePct: num(row['Pledged %'] || row['Promoter Pledged percentage'] || row['Pledged percentage']),
    auditorChangesLast5y: num(row['Auditor changes'] || row['Auditor changes 5Y']),

    sectorCycleScore: num(row['Sector cycle score']),
    perf1y: num(row['1Yr return %'] || row['Return over 1year'] || row['1Y Return']),

    concallText: '',  // populated by user via paste field in UI
  };
}
