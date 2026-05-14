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

export type TurnaroundStage = 'DISTRESS' | 'EARLY-SHOOTS' | 'PATTERN' | 'CONFIRMED' | 'MATURE';

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
  // Diagnostics
  strengths: string[];
  risks: string[];
  concallPhrases: string[];    // detected institutional phrases
  inflectionSignals: string[]; // narrative description of the turn
  coverage: number;            // 0-100 how complete the data is
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

  // Sequential OPM improvement
  if (row.opmQ1 != null && row.opmQ2 != null && row.opmQ3 != null) {
    if (row.opmQ1 > row.opmQ2 && row.opmQ2 > row.opmQ3) {
      s += 3;
      signals.push(`OPM trending up: ${row.opmQ3.toFixed(0)}% → ${row.opmQ2.toFixed(0)}% → ${row.opmQ1.toFixed(0)}%`);
    } else if (row.opmQ1 > row.opmQ2) {
      s += 1;
    }
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

  if (consecNegative >= 3 && !justTurnedPositive) {
    return { stage: 'DISTRESS', color: '#EF4444', emoji: '🚫', inBuyZone: false };
  }
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
  return { stage: 'DISTRESS', color: '#EF4444', emoji: '🚫', inBuyZone: false };
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

  const { stage, color, emoji, inBuyZone } = classifyStage(row);

  // Grade by composite
  const grade: TurnaroundResult['grade'] =
    totalScore >= 80 ? 'A+' :
    totalScore >= 70 ? 'A' :
    totalScore >= 60 ? 'B+' :
    totalScore >= 45 ? 'B' :
    totalScore >= 30 ? 'C' : 'D';

  // Coverage: how many critical fields were populated?
  const criticalFields: Array<keyof TurnaroundRow> = [
    'patQ1', 'patQ2', 'patQ3', 'salesQ1', 'opmQ1', 'roce', 'de', 'pe',
    'debtCurr', 'interestCoverage', 'promoterHolding', 'concallText',
  ];
  const filledCritical = criticalFields.filter((f) => row[f] != null && row[f] !== '').length;
  const coverage = Math.round((filledCritical / criticalFields.length) * 100);

  return {
    ...row,
    earningsScore, operationalScore, balanceSheetScore,
    concallScore, industryScore, governanceScore, valuationScore,
    totalScore: Math.round(totalScore * 10) / 10,
    grade,
    stage, stageColor: color, stageEmoji: emoji, inBuyZone,
    strengths,
    risks,
    concallPhrases: phrases,
    inflectionSignals,
    coverage,
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

export function parseTurnaroundRow(row: Record<string, unknown>): TurnaroundRow | null {
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
    cmp: num(row['Current Price'] || row['CMP'] || row['Price']),
    marketCapCr: num(row['Market Capitalization'] || row['Market Cap'] || row['Mar Cap']),
    pe: num(row['Price to Earning'] || row['P/E'] || row['PE']),
    pe5yMedian: num(row['Median PE 5Y'] || row['PE 5Y median'] || row['5Y median PE']),
    evEbitda: num(row['EV / EBITDA'] || row['EV/EBITDA']),
    evEbitdaSectorMedian: num(row['Sector EV/EBITDA'] || row['Sector median EV/EBITDA']),

    // Quarterly
    salesQ1: num(row['Sales latest quarter'] || row['Sales Q-1'] || row['Sales last quarter'] || row['Sales']),
    salesQ2: num(row['Sales Q-2'] || row['Sales preceding quarter'] || row['Sales 2 quarter back']),
    salesQ3: num(row['Sales Q-3'] || row['Sales 3 quarter back']),
    salesQ4: num(row['Sales Q-4'] || row['Sales 4 quarter back']),
    opProfitQ1: num(row['Operating Profit latest quarter'] || row['OpProfit Q-1'] || row['Op Profit']),
    opProfitQ2: num(row['OpProfit Q-2'] || row['Operating profit preceding quarter']),
    opProfitQ3: num(row['OpProfit Q-3']),
    opProfitQ4: num(row['OpProfit Q-4']),
    opmQ1: num(row['OPM latest quarter'] || row['OPM Q-1'] || row['OPM']),
    opmQ2: num(row['OPM Q-2'] || row['OPM preceding quarter']),
    opmQ3: num(row['OPM Q-3']),
    opmQ4: num(row['OPM Q-4']),
    patQ1: num(row['Net Profit latest quarter'] || row['PAT Q-1'] || row['Profit after tax']),
    patQ2: num(row['PAT Q-2'] || row['Net profit preceding quarter']),
    patQ3: num(row['PAT Q-3']),
    patQ4: num(row['PAT Q-4']),
    epsQ1: num(row['EPS latest quarter'] || row['EPS Q-1'] || row['EPS']),
    epsQ2: num(row['EPS Q-2']),
    epsQ3: num(row['EPS Q-3']),
    epsQ4: num(row['EPS Q-4']),
    patQ1Yoy: num(row['PAT Q-1 YoY'] || row['Net profit YoY same quarter'] || row['PAT YoY quarter']),
    salesQ1Yoy: num(row['Sales Q-1 YoY'] || row['Sales YoY quarter']),
    opmQ1Yoy: num(row['OPM Q-1 YoY']),

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
    opmY1: num(row['OPM last year'] || row['OPM Y-1']),
    opmY2: num(row['OPM 2 year back'] || row['OPM Y-2']),
    opmY3: num(row['OPM 3 year back'] || row['OPM Y-3']),

    revenueGrowth1y: num(row['Sales growth'] || row['Sales growth %']),
    revenueGrowth3y: num(row['Sales growth 3Years'] || row['Sales 3Y CAGR']),
    revenueGrowth5y: num(row['Sales growth 5Years'] || row['Sales 5Y CAGR']),
    patGrowth1y: num(row['Profit growth'] || row['PAT growth']),
    patGrowth3y: num(row['Profit growth 3Years'] || row['PAT 3Y CAGR']),

    lossMakingYears5y: num(row['Loss making years'] || row['Loss years 5Y']),

    debtCurr: num(row['Debt'] || row['Total Debt']),
    debt3yBack: num(row['Debt 3 year back'] || row['Debt 3Y back']),
    debt5yBack: num(row['Debt 5 year back'] || row['Debt 5Y back']),
    de: num(row['Debt to equity'] || row['D/E'] || row['Debt / Equity']),
    interestCoverage: num(row['Interest Coverage Ratio'] || row['Interest coverage'] || row['Interest cover']),
    interestCoverage3yBack: num(row['Interest coverage 3Y back']),
    workingCapitalDays: num(row['Working Capital Days'] || row['Working capital days']),
    workingCapitalDays3yBack: num(row['Working capital days 3Y back']),

    roce: num(row['Return on capital employed'] || row['ROCE']),
    roce3yBack: num(row['ROCE 3 year back'] || row['ROCE 3Y back']),
    roe: num(row['Return on equity'] || row['ROE']),

    promoterHolding: num(row['Promoter holding'] || row['Promoter holding %']),
    promoterHolding3yBack: num(row['Promoter holding 3 year back'] || row['Change in promoter holding 3Years']),
    promoterPledgePct: num(row['Promoter Pledged percentage'] || row['Pledged percentage'] || row['Promoter pledge']),
    auditorChangesLast5y: num(row['Auditor changes'] || row['Auditor changes 5Y']),

    sectorCycleScore: num(row['Sector cycle score']),
    perf1y: num(row['Return over 1year'] || row['1Y Return']),

    concallText: '',  // populated by user via paste field in UI
  };
}
