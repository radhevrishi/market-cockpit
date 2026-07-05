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
// 7 Dimensions (total 100 points) — PATCH 0380 rebalanced for playbook:
//   1. Earnings Trajectory Reversal     (20 pts) — PAT/Revenue/EPS inflection
//   2. Operational Reset                (10 pts) — OPM expansion, ROCE turn, op-leverage
//   3. Balance Sheet Repair             (15 pts) — D/E trend, interest coverage, debt reduction
//   4. Concall/Guidance Quality         (25 pts) — paste-text NLP (PRIMARY per playbook)
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
  // Dimension scores (raw) — PATCH 0380 rebalanced for playbook
  earningsScore: number;       // 0-20 (was 25)
  operationalScore: number;    // 0-10 (was 15)
  balanceSheetScore: number;   // 0-15
  concallScore: number;        // 0-25 (PATCH 0380 — primary signal per playbook)
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

  // PATCH 0381 — Institutional upgrades per Turnaround_Investor_Master_Playbook
  turnaroundType: TurnaroundType;     // CYCLICAL / OPERATIONAL / DISTRESSED / UNKNOWN
  turnaroundTypeNote: string;         // one-line rationale
  phase: TurnaroundPhase;             // 1=Collapse / 2=Stabilisation / 3=Inflection BUY / 4=Re-rating
  phaseLabel: string;                 // 'Phase 3 INFLECTION' etc
  phaseAction: string;                // 'AVOID' / 'WATCH' / 'BUY-ZONE' / 'HOLD/TRIM'
  survivalScore: number;              // 0-8 (playbook Ch.4 gate filter)
  survivalChecks: Array<{ label: string; pass: boolean; note: string }>;
  killers: string[];                  // Top-10 killers from playbook PART VII
  suggestedPositionPct: number;       // Position size guidance, e.g. 2 / 5 / 8 (max %)
  isBestCandidate: boolean;           // Convenience: passes the institutional 'good only' filter
}

export type TurnaroundType = 'CYCLICAL' | 'OPERATIONAL' | 'DISTRESSED' | 'UNKNOWN';
export type TurnaroundPhase = 1 | 2 | 3 | 4;

// ─── CONCALL PHRASE LEXICON (25 pts max — PATCH 0380, playbook primary signal) ──
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

  // PATCH 0380 — Rescaled from 25 → 20 to make room for Concall 15 → 25
  return Math.min(20, Math.max(0, s * (20 / 25)));
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

  // PATCH 0380 — Rescaled 15 → 10 to make room for Concall 15 → 25
  return Math.min(10, Math.max(0, s * (10 / 15)));
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
  // PATCH 0380 — Concall dimension reweighted from 15 → 25 max.
  // Per Turnaround_Investor_Master_Playbook: "Institutional turnaround
  // investing is heavily narrative-driven. This dimension should be 25-30%
  // of total score." So concall now carries the dominant signal weight.
  // Diminishing returns from 12 upward (log-compress).
  let pts: number;
  if (raw <= 12) pts = raw * (25 / 15);  // scale to /25
  else pts = 20 + Math.log2(raw - 11) * 2;
  pts = Math.max(0, Math.min(25, pts));

  if (pts >= 15) signals.push(`Strong concall narrative (${phrasesOut.length} institutional phrases) — playbook PRIMARY signal`);
  else if (pts >= 7) signals.push(`Moderate concall narrative (${phrasesOut.length} phrases)`);

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
  // PATCH 0380 — Rebuild per Turnaround_Investor_Master_Playbook.docx.
  // The previous classifier (Patches 0377-0379) was over-classifying
  // "cheap + weak + cyclical" as TURNAROUND. Per the playbook, a real
  // turnaround requires FIVE things simultaneously:
  //   1. Prior damage (loss yrs, ROCE collapse, debt stress, etc.)
  //   2. Evidence the damage is reversing (PAT inflection, OPM expansion)
  //   3. Management capability (Form 4 buying, credible plan)
  //   4. Balance sheet survival (debt manageable, runway >12mo)
  //   5. Scalable earnings engine post-recovery
  // Our static-data engine can score #1, #2, #4 properly. We mark #3 and
  // #5 as data-pending and lower confidence accordingly.
  // The classifier now applies HARD PRE-SCREENING (operator pumps, recent
  // IPOs, secular decline) BEFORE looking at the archetype gates.

  const patQ1 = row.patQ1;
  const patY1 = row.patY1;
  const patY2 = row.patY2;
  const pe = row.pe ?? null;
  const positiveLatestPAT = (patQ1 != null && patQ1 > 0) || (patY1 != null && patY1 > 0) || (pe != null && pe > 0);
  const negLatestPAT = (patQ1 != null && patQ1 < 0) ||
                       (patQ1 == null && patY1 != null && patY1 < 0) ||
                       (patQ1 == null && patY1 == null && pe == null);
  const lossYears = row.lossMakingYears5y ?? 0;
  const roce = row.roce ?? null;
  const roce3y = row.roce3yBack ?? null;
  const revG3y = row.revenueGrowth3y ?? null;
  const patG3y = row.patGrowth3y ?? null;
  const revG1y = row.revenueGrowth1y ?? null;
  const patG1y = row.patGrowth1y ?? null;
  const de = row.de ?? null;
  const promoter = row.promoterHolding ?? null;
  const mcapCr = row.marketCapCr ?? null;
  const opmYoYQ = (row.opmQ1 != null && row.opmQ2 != null) ? row.opmQ1 - row.opmQ2 : null;
  const debtReduction3y = (row.debtCurr != null && row.debt3yBack != null && row.debt3yBack > 0)
    ? (row.debt3yBack - row.debtCurr) / row.debt3yBack : null;
  const patQQYoY = (row.patQ1 != null && row.patQ1Yoy != null && row.patQ1Yoy !== 0)
    ? (row.patQ1 - row.patQ1Yoy) / Math.abs(row.patQ1Yoy) * 100 : null;

  // ───────────────────────────────────────────────────────────────────────
  // STEP 1: HARD PRE-SCREENING (playbook PART VIII: Pre-Screening Filter)
  // These disqualify before any archetype gate. Per playbook:
  //   "These eliminate 80% of bad candidates."
  // ───────────────────────────────────────────────────────────────────────

  // OPERATOR PUMP — microcap + low promoter + zero institutional accountability
  // Per playbook killers #6 (Platform irrelevance) + general microcap risk
  const isOperatorPump = (
    mcapCr != null && mcapCr < 500 &&
    promoter != null && promoter < 30 &&
    (row.promoterPledgePct == null || row.promoterPledgePct === 0)  // not even pledge data
  );
  if (isOperatorPump) {
    return {
      archetype: 'VALUE-TRAP',
      label: '🧊 OPERATOR PUMP',
      note: `Microcap ${mcapCr?.toFixed(0)}Cr + promoter ${promoter?.toFixed(0)}% — operator-driven, no institutional accountability. NOT a turnaround (playbook Killer #6).`,
      color: '#EF4444',
    };
  }

  // RECENT IPO NORMALIZATION — high PE on a small-cap with low ROCE
  // = post-listing valuation reset, not a turnaround. Per user feedback:
  // "Yatharth, Entero, Blackbuck are not turnarounds, they are post-listing
  //  growth normalization phases."
  const hasQuarterlyDamage =
    (row.patQ2 != null && row.patQ2 < 0) ||
    (row.patQ3 != null && row.patQ3 < 0) ||
    (row.patQ4 != null && row.patQ4 < 0) ||
    (patG1y != null && patG1y <= -50);
  const isLikelyRecentIPO = (
    pe != null && pe >= 30 &&
    roce != null && roce < 18 &&
    mcapCr != null && mcapCr < 5000 &&
    lossYears === 0 &&
    !hasQuarterlyDamage  // zzz218 — real damage ≠ IPO normalization
  );
  if (isLikelyRecentIPO) {
    return {
      archetype: 'NEUTRAL',
      label: '🆕 RECENT IPO',
      note: `Likely post-IPO normalization — PE ${pe?.toFixed(0)} + ROCE ${roce?.toFixed(0)}% + mcap ${mcapCr?.toFixed(0)}Cr. Valuation reset, not a turnaround (playbook: false signal).`,
      color: '#A78BFA',
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 2: PRIOR DAMAGE EVIDENCE — PATCH 0383 tightened.
  // User feedback: GANESHHOU (RE franchise ROCE 44), KSCL (agri),
  // SAFARI (luggage growth), JYOTI CNC (capex growth) are NOT turnarounds.
  // Engine was over-firing 'damage' on weak signals (perf1y price drop,
  // small pledge, WC stretch history). A growth stock that corrected 30%
  // is NOT damaged. A franchise with 5% historical pledge is NOT damaged.
  // Only HARD damage counts now — real impairment events that the
  // company had to recover from.
  // ───────────────────────────────────────────────────────────────────────
  const priorDamage: string[] = [];
  // HARD damage — any one = real impairment
  if (lossYears >= 2) priorDamage.push(`${lossYears}/5 loss yrs`);
  if (negLatestPAT) priorDamage.push('current losses');
  // zzz218 — quarterly-loss damage: the auto-synced screens carry 4 quarters
  // of PAT but no annual history. A loss in ANY of the last 3 prior quarters
  // is hard impairment evidence (the exact base a turnaround recovers from).
  const recentLossQuarters = [row.patQ2, row.patQ3, row.patQ4].filter(v => v != null && v < 0).length;
  if (recentLossQuarters >= 1) priorDamage.push(`${recentLossQuarters} loss qtr${recentLossQuarters > 1 ? 's' : ''} in last year`);
  // zzz218 — PAT crashed >80% over the last year (incl. profit→loss = <-100%)
  if (patG1y != null && patG1y <= -80) priorDamage.push(`PAT 1y crashed ${patG1y.toFixed(0)}%`);
  // zzz218 — standalone severe stress markers (no compounder ever shows these)
  if (row.interestCoverage != null && row.interestCoverage < 1.5 && de != null && de > 0.3) priorDamage.push(`int-cov ${row.interestCoverage.toFixed(1)}x (debt stress)`);
  if (roce != null && roce < 4) priorDamage.push(`ROCE ${roce.toFixed(1)}% (returns collapsed)`);
  if (patY2 != null && patY2 < 0) priorDamage.push('neg PAT prev yr');
  if (row.patY3 != null && row.patY3 < 0) priorDamage.push('neg PAT 3yr ago');
  if (roce != null && roce3y != null && roce3y < 3 && roce - roce3y >= 8) priorDamage.push(`ROCE was ${roce3y.toFixed(0)}% (severe collapse)`);
  if (patG3y != null && patG3y < -50) priorDamage.push(`PAT 3y crashed ${patG3y.toFixed(0)}%`);
  if (row.promoterPledgePct != null && row.promoterPledgePct >= 25) priorDamage.push(`heavy pledge ${row.promoterPledgePct.toFixed(0)}%`);
  // Severe leverage stress (BOTH D/E and interest coverage together)
  if (de != null && de > 1.5 && row.interestCoverage != null && row.interestCoverage < 2) {
    priorDamage.push(`leverage stress D/E ${de.toFixed(1)} + int-cov ${row.interestCoverage.toFixed(1)}x`);
  }
  // Severe price collapse — only when combined with another distress marker
  // (price drop alone is NOT damage; growth correction ≠ turnaround)
  if (row.perf1y != null && row.perf1y < -50 && (lossYears >= 1 || (de ?? 0) > 1.5 || (row.promoterPledgePct ?? 0) >= 10)) {
    priorDamage.push(`1y price ${row.perf1y.toFixed(0)}% + stress markers`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 3: RECOVERY PROOF (playbook Ch.5 Factor 2 — Earnings Inflection)
  // Per playbook: "Recovery requires at least 3 of: EBITDA margin improving
  // 3 quarters, CFO positive, debt falling, interest coverage improving,
  // promoter buying, utilization improving, guidance upgraded, order book
  // improving, export recovery, operating leverage visible."
  // ───────────────────────────────────────────────────────────────────────
  const recoveryProof: string[] = [];
  if (opmYoYQ != null && opmYoYQ >= 3) recoveryProof.push(`OPM +${opmYoYQ.toFixed(1)}pp Q/Q`);
  if (patQ1 != null && patQ1 > 0 && row.patQ2 != null && row.patQ2 <= 0) recoveryProof.push('Qtr PAT inflected positive');
  if (patY1 != null && patY1 > 0 && patY2 != null && patY2 <= 0) recoveryProof.push('Annual PAT inflected positive');
  if (debtReduction3y != null && debtReduction3y >= 0.15) recoveryProof.push(`Debt -${(debtReduction3y*100).toFixed(0)}% 3y`);
  if (roce != null && roce3y != null && roce - roce3y >= 5 && roce >= 8) recoveryProof.push(`ROCE +${(roce - roce3y).toFixed(0)}pp 3y`);
  if (patG3y != null && patG3y >= 30 && positiveLatestPAT) recoveryProof.push(`PAT 3y +${patG3y.toFixed(0)}%`);
  if (patQQYoY != null && patQQYoY >= 50 && positiveLatestPAT) recoveryProof.push(`Qtr PAT YoY +${patQQYoY.toFixed(0)}%`);
  if (row.interestCoverage != null && row.interestCoverage3yBack != null &&
      row.interestCoverage > row.interestCoverage3yBack * 1.5 && row.interestCoverage >= 2) {
    recoveryProof.push('Int coverage improving');
  }
  if (row.workingCapitalDays != null && row.workingCapitalDays3yBack != null &&
      row.workingCapitalDays < row.workingCapitalDays3yBack - 15) {
    recoveryProof.push('WC days improving');
  }

  // PATCH 0382 — IMPLICIT RECOVERY signal. The user's static CSV lacks
  // most quarterly/historical trend columns needed to prove explicit
  // recovery (patY2, debt3yBack, opmQ2, ROCE 3y back). But a row with
  // PRIOR DAMAGE + currently positive earnings + decent ROCE has clearly
  // emerged from problems even if we can't see the exact trajectory.
  // This catches the playbook's named examples: INOX WIND (ROCE 12 from
  // negative), TI Tilaknagar (ROCE 28 post-restructuring), Suzlon (ROCE
  // 33 from deep losses), Kamat Hotels (ROCE 16 post-COVID), JYOTI CNC
  // (ROCE 24 from prior cycle).
  const implicitRecoveryFromCurrent = positiveLatestPAT && roce != null && roce >= 8;
  if (implicitRecoveryFromCurrent && priorDamage.length >= 1) {
    recoveryProof.push(`current ROCE ${roce!.toFixed(0)}% + profitable (recovered from damage)`);
  }
  // Concall narrative paste-text counts as a recovery proof — playbook says
  // narrative is 25-30% of the institutional signal.
  if ((row.concallText || '').trim().length > 50) {
    // Score the concall narrative inline (mirrored from scoreConcallNarrative)
    // to count it as a recovery signal regardless of paste size.
    let ccPositive = 0;
    const t = (row.concallText || '').toLowerCase();
    for (const { pattern, weight } of CONCALL_POSITIVE) {
      if (pattern.test(t)) ccPositive += weight;
    }
    if (ccPositive >= 6) recoveryProof.push('Strong concall narrative');
    else if (ccPositive >= 3) recoveryProof.push('Moderate concall narrative');
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 4: TURNAROUND GATE per playbook
  // PATCH 0385 — Bring back legitimate recovering turnarounds that 0383
  // over-restricted. Per user: 'best opportunity zone = Late Phase 2 →
  // Early Phase 3 — after distress peaks but BEFORE consensus recognises
  // normalisation.' If we only count CURRENT hard damage, we miss every
  // recovering name once it shows initial signs (Inox Wind, Tilaknagar,
  // Kamat Hotels disappeared after 0383). Solution: SECONDARY gate that
  // recognises 'recovery zone' (ROCE 8-18 = company climbing back from
  // low base, not at quality tier yet) combined with ANY weak history
  // hint. Tight enough to exclude steady compounders, loose enough to
  // capture mid-recovery names.
  // ───────────────────────────────────────────────────────────────────────

  // Strict gate (preferred — hard damage + clear recovery)
  if (priorDamage.length >= 1 && recoveryProof.length >= 1) {
    return {
      archetype: 'TURNAROUND',
      label: '🔄 TURNAROUND',
      note: `Turnaround — prior damage (${priorDamage.slice(0, 2).join(', ')}) + recovery (${recoveryProof.slice(0, 2).join(', ')}). Paste concall narrative on row to upgrade confidence.`,
      color: '#F59E0B',
    };
  }

  // PATCH 0385 — Recovery-zone gate. ROCE 8-18 = the "climbing back from
  // low base" band. A company at ROCE 12 is NOT a steady compounder
  // (those are 18+); it's mid-recovery. Combine with ANY soft historical
  // hint to confirm.
  const inRecoveryZone = positiveLatestPAT && roce != null && roce >= 8 && roce < 18;
  const softHistoryHints: string[] = [];
  if (lossYears === 1) softHistoryHints.push('1/5 loss yr (light damage)');
  if (row.perf1y != null && row.perf1y < -25) softHistoryHints.push(`1y price ${row.perf1y.toFixed(0)}% (correction)`);
  if (row.promoterPledgePct != null && row.promoterPledgePct >= 10 && row.promoterPledgePct < 25) softHistoryHints.push(`pledge ${row.promoterPledgePct.toFixed(0)}%`);
  if (de != null && de > 1) softHistoryHints.push(`D/E ${de.toFixed(1)} (leverage hist)`);
  if (row.workingCapitalDays != null && row.workingCapitalDays > 100) softHistoryHints.push(`WC ${row.workingCapitalDays.toFixed(0)} days (stretched)`);

  // Governance gate — block operator-driven microcaps from the
  // recovery-zone path (per user: Arihant Super / Vintage Coffee false
  // positives, want stronger governance filters)
  const isWeakGovernance = (
    mcapCr != null && mcapCr < 1500 &&
    (promoter ?? 0) < 40 &&
    (row.promoterPledgePct ?? 0) < 5  // no pledge data is suspicious for microcaps
  );

  if (inRecoveryZone && softHistoryHints.length >= 1 && !isWeakGovernance) {
    return {
      archetype: 'TURNAROUND',
      label: '🔄 TURNAROUND',
      note: `Recovery zone — ROCE ${roce!.toFixed(0)}% (8-18 band, climbing back) + ${softHistoryHints.slice(0, 2).join(', ')}. Mid-cycle recovery candidate; verify with concall.`,
      color: '#F59E0B',
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 5: NON-TURNAROUND ARCHETYPES
  // ───────────────────────────────────────────────────────────────────────

  // 💎 QUALITY COMPOUNDER — high ROCE 18+, no damage
  if (positiveLatestPAT && lossYears === 0 && (roce ?? 0) >= 18 && (de ?? 0) <= 1.5 && priorDamage.length === 0) {
    const growthHint = revG3y != null
      ? ` (rev 3y +${revG3y.toFixed(0)}%)`
      : revG1y != null
        ? ` (rev 1y +${revG1y.toFixed(0)}%)`
        : '';
    return {
      archetype: 'QUALITY',
      label: '💎 QUALITY',
      note: `Established compounder — ROCE ${roce?.toFixed(0)}%${growthHint}, no damage history. Not a turnaround setup.`,
      color: '#22D3EE',
    };
  }

  // 🚀 GROWTH STOCK — strong growth + decent ROCE, no damage
  const strongGrowth = (
    (revG3y != null && revG3y >= 25) ||
    (patG3y != null && patG3y >= 25) ||
    (revG1y != null && revG1y >= 25 && patG1y != null && patG1y >= 25)
  );
  if (positiveLatestPAT && lossYears === 0 && (roce ?? 0) >= 15 && strongGrowth && priorDamage.length === 0) {
    const bestGrowth = patG3y ?? patG1y ?? patQQYoY ?? 0;
    return {
      archetype: 'GROWTH',
      label: '🚀 GROWTH',
      note: `Growth stock — PAT +${bestGrowth.toFixed(0)}%, ROCE ${roce?.toFixed(0)}%. Not a turnaround. Use India Multibagger tab.`,
      color: '#10B981',
    };
  }

  // ❓ MID-QUALITY / CYCLICAL — ROCE 10-18 + positive PAT + no damage history.
  // Per user feedback: "Sansera, Muthootfin, Aegislog, Navnet, Hatsun are NOT
  // turnarounds — they're mid-quality stable businesses or cyclicals at
  // mid-cycle. Engine should not call them turnarounds."
  if (positiveLatestPAT && (roce ?? 0) >= 10 && (roce ?? 0) < 18 && lossYears === 0 && priorDamage.length === 0) {
    return {
      archetype: 'NEUTRAL',
      label: '❓ MID-QUALITY',
      note: `Mid-quality business — ROCE ${roce?.toFixed(0)}% (decent, not elite), no damage history. Cyclical or stable mid-cap. NOT a turnaround setup.`,
      color: '#6B7A8D',
    };
  }

  // 🧊 VALUE TRAP — distressed without recovery proof
  if ((lossYears >= 3 || (roce != null && roce < 0)) && negLatestPAT && (de ?? 0) > 1.5) {
    return {
      archetype: 'VALUE-TRAP',
      label: '🧊 VALUE TRAP',
      note: `Deep distress: ${lossYears}/5 loss yrs, D/E ${de?.toFixed(1)}, ROCE ${roce?.toFixed(0) ?? '—'}%. No recovery proof — capital trap risk (playbook Killer #1/#3).`,
      color: '#EF4444',
    };
  }

  // 📉 DECLINING — both top + bottom line falling
  if ((revG1y ?? 0) < -5 && (patG1y ?? 0) < -10) {
    return {
      archetype: 'DECLINING',
      label: '📉 DECLINING',
      note: `Revenue ${revG1y?.toFixed(0)}% YoY, PAT ${patG1y?.toFixed(0)}% YoY — accelerating decline, not turnaround material. Could be secular (playbook Killer #2).`,
      color: '#EF4444',
    };
  }

  // ⏸ WAIT — damage visible but no recovery proof yet (PHASE 1/2 per playbook)
  // PATCH 0383: split into DEEP DISTRESS (bimodal outcome, special situations
  // territory per user feedback on PC Jeweller) vs ordinary WAIT.
  if (priorDamage.length >= 1) {
    const isDeepDistress = priorDamage.length >= 2 || negLatestPAT || lossYears >= 3 ||
      (row.promoterPledgePct ?? 0) >= 25;
    if (isDeepDistress) {
      return {
        archetype: 'WAIT',
        label: '🆘 DEEP DISTRESS',
        note: `Special-situations / deep-distress — bimodal outcome (5-10× or permanent impairment). Signals: ${priorDamage.slice(0, 3).join(', ')}. Different asset class from ordinary turnaround; tiny position only.`,
        color: '#EF4444',
      };
    }
    return {
      archetype: 'WAIT',
      label: '⏸ WAIT',
      note: `Damaged (${priorDamage.slice(0, 2).join(', ')}) but no recovery proof yet. Phase 1/2 per playbook — build watchlist, don't buy. Watch for OPM Q/Q +3pp, PAT inflection, debt falling.`,
      color: '#94A3B8',
    };
  }

  // ❓ NEUTRAL — nothing fires
  return {
    archetype: 'NEUTRAL',
    label: '❓ NEUTRAL',
    note: `Insufficient signal — ROCE ${roce?.toFixed(0) ?? '—'}%, PE ${pe?.toFixed(0) ?? '—'}, rev 1y ${revG1y?.toFixed(0) ?? '—'}%. Could be cyclical mid-cycle or data-poor row. Not a turnaround.`,
    color: '#6B7A8D',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// PATCH 0381 — INSTITUTIONAL CLASSIFIERS per playbook Parts I, IV, VII
// ────────────────────────────────────────────────────────────────────────────

// Ch.1 Type Classifier — CYCLICAL / OPERATIONAL / DISTRESSED
function classifyTurnaroundType(row: TurnaroundRow): { type: TurnaroundType; note: string } {
  const de = row.de ?? null;
  const lossYears = row.lossMakingYears5y ?? 0;
  const roce = row.roce ?? null;
  const mcap = row.marketCapCr ?? null;
  const debt = row.debtCurr ?? null;
  const pledge = row.promoterPledgePct ?? 0;
  const interestCov = row.interestCoverage ?? null;

  // DISTRESSED — capital structure broken
  // Per playbook Killer #3: mcap < ~15% of EV means creditors own the recovery.
  // Approximate EV = mcap + debt (no cash data); if mcap/(mcap+debt) < 0.2 → distressed.
  if (mcap != null && debt != null && debt > 0) {
    const equityShare = mcap / (mcap + debt);
    if (equityShare < 0.2) {
      return { type: 'DISTRESSED', note: `mcap ${(equityShare*100).toFixed(0)}% of EV — creditors own the recovery (Killer #3)` };
    }
  }
  if (de != null && de >= 2.5) {
    return { type: 'DISTRESSED', note: `D/E ${de.toFixed(1)} — capital structure stress` };
  }
  if (pledge >= 30) {
    return { type: 'DISTRESSED', note: `promoter pledge ${pledge.toFixed(0)}% — financial distress signal` };
  }
  if (interestCov != null && interestCov < 1.5) {
    return { type: 'DISTRESSED', note: `interest coverage ${interestCov.toFixed(1)}x — covenant breach risk` };
  }

  // OPERATIONAL — business itself broken (chronic underperformance)
  if (lossYears >= 3) {
    return { type: 'OPERATIONAL', note: `${lossYears}/5 loss yrs — operational broken, needs internal fix` };
  }
  if (roce != null && roce < 5 && (row.patY1 ?? 0) <= 0) {
    return { type: 'OPERATIONAL', note: `ROCE ${roce.toFixed(0)}% + negative PAT — sustained operational weakness` };
  }

  // CYCLICAL — business intact, crushed by macro/sector cycle
  // This is the default for survivable companies with some distress markers
  if (lossYears >= 1 || (roce != null && roce < 12)) {
    return { type: 'CYCLICAL', note: 'Macro/sector-driven setback, business franchise intact — playbook base-rate 70%' };
  }

  return { type: 'UNKNOWN', note: 'Insufficient distress markers to classify' };
}

// Ch.2 Phase Classifier — 1 COLLAPSE / 2 STABILISATION / 3 INFLECTION (BUY ★) / 4 RE-RATING
function classifyPhase(
  recoveryCount: number,
  damageCount: number,
  row: TurnaroundRow
): { phase: TurnaroundPhase; label: string; action: string } {
  const perf1y = row.perf1y ?? null;
  const roce = row.roce ?? null;
  const positivePAT = (row.patQ1 ?? 0) > 0 || (row.patY1 ?? 0) > 0 || (row.pe ?? 0) > 0;

  // Phase 4 — RE-RATING (recovery confirmed, multiple expansion happening)
  // Per playbook: stock already up 40%+ from base + multiple recovery signals
  if (recoveryCount >= 3 && perf1y != null && perf1y >= 40) {
    return { phase: 4, label: 'Phase 4 RE-RATING', action: 'HOLD / TRIM' };
  }
  // Phase 3 — INFLECTION (BUY ZONE ★)
  // PATCH 0382: relaxed recoveryCount >= 2 → >= 1 (was unreachable for
  // data-poor rows). Still requires damage history + positive PAT.
  if (recoveryCount >= 1 && positivePAT && damageCount >= 1) {
    return { phase: 3, label: 'Phase 3 INFLECTION ★', action: 'BUY-ZONE — stage in' };
  }
  // Phase 2 — STABILISATION (rate of deterioration slowing)
  if (damageCount >= 1 && positivePAT) {
    return { phase: 2, label: 'Phase 2 STABILISATION', action: 'WATCH — research deeply' };
  }
  // Phase 1 — COLLAPSE
  if (damageCount >= 1) {
    return { phase: 1, label: 'Phase 1 COLLAPSE', action: 'AVOID — watchlist only' };
  }
  // Not in turnaround — default to Phase 4 (no action needed)
  return { phase: 4, label: 'Not in turnaround', action: '—' };
}

// Ch.4 Survival Filter — 8 checks, all must pass for buy candidate
function scoreSurvival(row: TurnaroundRow): {
  score: number;
  checks: Array<{ label: string; pass: boolean; note: string }>;
} {
  const de = row.de ?? null;
  const interestCov = row.interestCoverage ?? null;
  const mcap = row.marketCapCr ?? null;
  const debt = row.debtCurr ?? null;
  const pledge = row.promoterPledgePct ?? null;
  const pe = row.pe ?? null;
  const debtReduction3y = (debt != null && row.debt3yBack != null && row.debt3yBack > 0)
    ? (row.debt3yBack - debt) / row.debt3yBack : null;
  const checks: Array<{ label: string; pass: boolean; note: string }> = [];

  // 1. Debt maturity — proxy via D/E < 1.5 (no maturity data in Screener)
  checks.push({
    label: 'Manageable leverage',
    pass: de == null || de < 1.5,
    note: de == null ? 'D/E unknown' : `D/E ${de.toFixed(1)}`,
  });
  // 2. Interest coverage > 2x on trough
  checks.push({
    label: 'Interest coverage >2x',
    pass: interestCov == null || interestCov >= 2,
    note: interestCov == null ? 'unknown' : `${interestCov.toFixed(1)}x`,
  });
  // 3. Market cap >= 20% of EV (proxy: mcap/(mcap+debt))
  let equityShare: number | null = null;
  if (mcap != null && debt != null) {
    equityShare = debt > 0 ? mcap / (mcap + debt) : 1;
    checks.push({
      label: 'Equity ≥ 20% of EV',
      pass: equityShare >= 0.2,
      note: `${(equityShare * 100).toFixed(0)}% equity share`,
    });
  } else {
    checks.push({ label: 'Equity ≥ 20% of EV', pass: true, note: 'data unavailable' });
  }
  // 4. No active pledge stress
  checks.push({
    label: 'No pledge stress',
    pass: pledge == null || pledge < 25,
    note: pledge == null ? 'unknown' : `${pledge.toFixed(0)}% pledged`,
  });
  // 5. Capital market access — positive PE signals access
  checks.push({
    label: 'Capital market access',
    pass: pe != null && pe > 0 && pe < 200,
    note: pe == null ? 'no PE / loss-maker' : `PE ${pe.toFixed(0)}`,
  });
  // 6. Debt trajectory — falling or stable
  checks.push({
    label: 'Debt trajectory OK',
    pass: debtReduction3y == null || debtReduction3y >= -0.1,
    note: debtReduction3y == null ? 'unknown' : debtReduction3y >= 0 ? `−${(debtReduction3y*100).toFixed(0)}%` : `+${(-debtReduction3y*100).toFixed(0)}%`,
  });
  // 7. ROCE not deeply negative
  const roce = row.roce ?? null;
  checks.push({
    label: 'ROCE survivable',
    pass: roce == null || roce >= -5,
    note: roce == null ? 'unknown' : `${roce.toFixed(0)}%`,
  });
  // 8. Microcap operator risk
  checks.push({
    label: 'Institutional ownership',
    pass: !(mcap != null && mcap < 500 && (row.promoterHolding ?? 100) < 30),
    note: mcap != null && mcap < 500 ? 'microcap — verify' : 'OK',
  });

  const score = checks.filter(c => c.pass).length;
  return { score, checks };
}

// Part VII — Top 10 Killers detection (red flag risk markers)
function detectKillers(row: TurnaroundRow): string[] {
  const killers: string[] = [];
  const mcap = row.marketCapCr ?? null;
  const debt = row.debtCurr ?? null;
  const de = row.de ?? null;
  const interestCov = row.interestCoverage ?? null;
  const pledge = row.promoterPledgePct ?? 0;
  const lossYears = row.lossMakingYears5y ?? 0;
  const roce = row.roce ?? null;
  const pe = row.pe ?? null;
  const revG3y = row.revenueGrowth3y ?? null;
  const revG1y = row.revenueGrowth1y ?? null;
  const patG1y = row.patGrowth1y ?? null;

  // Killer #1: Debt cannot be refinanced — interest coverage <1.5x
  if (interestCov != null && interestCov < 1.5) {
    killers.push(`#1 debt-refinance risk (int-cov ${interestCov.toFixed(1)}x)`);
  }
  // Killer #2: Secular decline mistaken for cyclical — 3y AND 1y both negative
  if (revG3y != null && revG3y < -10 && revG1y != null && revG1y < -10) {
    killers.push(`#2 secular decline risk (rev 3y ${revG3y.toFixed(0)}%, 1y ${revG1y.toFixed(0)}%)`);
  }
  // Killer #3: Market cap vs EV trap — equity < 15% of EV
  if (mcap != null && debt != null && debt > 0 && mcap / (mcap + debt) < 0.15) {
    killers.push(`#3 creditors own upside (mcap ${(mcap/(mcap+debt)*100).toFixed(0)}% of EV)`);
  }
  // Killer #7: Pension/legal tail (proxy: very high pledge OR D/E)
  if (de != null && de > 3) {
    killers.push(`#7 obligations exceed equity (D/E ${de.toFixed(1)})`);
  }
  if (pledge >= 50) {
    killers.push(`#7 promoter pledge ${pledge.toFixed(0)}% — control risk`);
  }
  // Killer #10: Commodity recovery thesis — sector check would need explicit tagging
  // Proxy via ultra-cyclical sectors with negative ROCE
  if (roce != null && roce < 0 && pe == null && lossYears >= 2) {
    killers.push(`#10 unhedged cycle exposure (ROCE ${roce.toFixed(0)}%, ${lossYears}y losses)`);
  }
  // Generic operator-pump red flag
  if (mcap != null && mcap < 300 && (row.promoterHolding ?? 100) < 25) {
    killers.push(`operator-pump pattern (mcap ${mcap.toFixed(0)}Cr, promoter ${(row.promoterHolding ?? 0).toFixed(0)}%)`);
  }
  // Fake signal: cheap-on-current-earnings without growth
  if (pe != null && pe < 8 && patG1y != null && patG1y < -20) {
    killers.push(`fake-signal: cheap PE on declining PAT (-${(-patG1y).toFixed(0)}%)`);
  }

  return killers;
}

// Ch.6 Position Sizing
function suggestPositionSize(type: TurnaroundType, survivalScore: number, killers: number): number {
  // Per playbook Ch.6:
  //   Cyclical: 8-10% with confirmation
  //   Operational: 5-7%
  //   Distressed: 2-3% max
  let max: number;
  if (type === 'DISTRESSED') max = 2.5;
  else if (type === 'OPERATIONAL') max = 6;
  else if (type === 'CYCLICAL') max = 9;
  else max = 4;
  // Penalize for failed survival checks
  if (survivalScore <= 4) max *= 0.5;
  else if (survivalScore <= 6) max *= 0.75;
  // Penalize for killers
  if (killers >= 2) max *= 0.5;
  else if (killers === 1) max *= 0.75;
  return Math.round(max * 10) / 10;
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

  let totalScore = earningsScore + operationalScore + balanceSheetScore +
                     concallScore + industryScore + governanceScore + valuationScore;
  // zzz218 — EX-CONCALL NORMALIZATION. The concall dimension is 25/100 pts
  // but auto-synced rows have no pasted narrative, so every stock was capped
  // at 75 and graded D. When no concall text exists, rebase the composite to
  // an ex-concall 100 so grades stay comparable. Pasting a concall switches
  // the row back to the full 100-pt basis (and usually scores higher).
  const hasConcallText = (row.concallText || '').trim().length > 50;
  if (!hasConcallText) totalScore = (totalScore / 75) * 100;

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

  // PATCH 0381 — Institutional classifiers (Type/Phase/Survival/Killers)
  const typeInfo = classifyTurnaroundType(row);
  // Count recovery and damage signals (matches the local logic in
  // classifyArchetype; recomputed here for phase classification).
  const _damageCount = (() => {
    let n = 0;
    if ((row.lossMakingYears5y ?? 0) >= 1) n++;
    if ((row.patQ1 ?? 0) < 0) n++;
    if ((row.patY2 ?? 0) < 0) n++;
    if ((row.patY3 ?? 0) < 0) n++;
    if (row.roce != null && row.roce3yBack != null && row.roce3yBack < 5 && row.roce - row.roce3yBack >= 5) n++;
    if ((row.perf1y ?? 0) < -30) n++;
    if ((row.promoterPledgePct ?? 0) >= 5) n++;
    return n;
  })();
  const _recoveryCount = (() => {
    let n = 0;
    if (row.opmQ1 != null && row.opmQ2 != null && row.opmQ1 - row.opmQ2 >= 3) n++;
    if ((row.patQ1 ?? 0) > 0 && (row.patQ2 ?? 1) <= 0) n++;
    if ((row.patY1 ?? 0) > 0 && (row.patY2 ?? 1) <= 0) n++;
    if (row.debtCurr != null && row.debt3yBack != null && row.debt3yBack > 0 &&
        (row.debt3yBack - row.debtCurr) / row.debt3yBack >= 0.15) n++;
    if (row.roce != null && row.roce3yBack != null && row.roce - row.roce3yBack >= 5 && row.roce >= 8) n++;
    if ((row.patGrowth3y ?? -99) >= 30 && ((row.patQ1 ?? 0) > 0 || (row.patY1 ?? 0) > 0)) n++;
    // PATCH 0382 — implicit recovery (mirrors classifyArchetype)
    const _posPAT = (row.patQ1 ?? 0) > 0 || (row.patY1 ?? 0) > 0 || (row.pe ?? 0) > 0;
    if (_posPAT && (row.roce ?? 0) >= 8) n++;
    if ((row.concallText || '').trim().length > 50) n++;
    return n;
  })();
  const phaseInfo = classifyPhase(_recoveryCount, _damageCount, row);
  const survival = scoreSurvival(row);
  const killers = detectKillers(row);
  const suggestedPositionPct = suggestPositionSize(typeInfo.type, survival.score, killers.length);

  // "Best candidate" = institutional buy-zone filter (like Multibagger BLOCKBUSTER)
  // PATCH 0382: relaxed totalScore floor 50 → 40 since dimensions are sparser
  // when concall paste hasn't been added yet.
  const isBestCandidate =
    arche.archetype === 'TURNAROUND' &&
    phaseInfo.phase === 3 &&
    survival.score >= 6 &&
    killers.length === 0 &&
    // zzz218 — 35 on the ex-concall basis (annual-history columns are absent
    // from the auto-synced screens, which depresses EARN/BAL ceilings too)
    totalScore >= (hasConcallText ? 40 : 35);

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
    // PATCH 0381 institutional fields
    turnaroundType: typeInfo.type,
    turnaroundTypeNote: typeInfo.note,
    phase: phaseInfo.phase,
    phaseLabel: phaseInfo.label,
    phaseAction: phaseInfo.action,
    survivalScore: survival.score,
    survivalChecks: survival.checks,
    killers,
    suggestedPositionPct,
    isBestCandidate,
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
    pe5yMedian: num(row['5Yrs PE'] || row['PE 5Yrs Median'] || row['Historical PE 5Years'] || row['Median PE 5Y']),
    evEbitda: num(row['EV / EBITDA'] || row['EV/EBITDA'] || row['EVEBITDA']),
    evEbitdaSectorMedian: num(row['Sector EV/EBITDA'] || row['Sector median EV/EBITDA'] || row['Ind PE']),

    // PATCH 0372 — actual Screener.in column names (the user's real export
    // headers). Each field now lists Screener's canonical name FIRST,
    // followed by older guesses for backwards compatibility.
    salesQ1: num(row['Sales Qtr Rs.Cr.'] || row['Sales Qtr'] || row['Sales latest quarter'] || row['Sales Q-1']),
    salesQ2: num(row['Sales Prev Qtr Rs.Cr.'] || row['Sales Prev Qtr'] || row['Sales preceding quarter'] || row['Sales Q-2']),
    salesQ3: num(row['Sales 2Qtr Bk Rs.Cr.'] || row['Sales 2Qtr Bk'] || row['Sales 2 quarter back'] || row['Sales 2quarters back'] || row['Sales Q-3']),
    salesQ4: num(row['Sales 3Qtr Bk Rs.Cr.'] || row['Sales 3Qtr Bk'] || row['Sales 3 quarter back'] || row['Sales 3quarters back'] || row['Sales Q-4']),
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
    opmQ2: num(row['OPM Prev Qtr %'] || row['OPM Prev Qtr'] || row['OPM preceding quarter']),
    opmQ3: num(row['OPM 2Qtr Bk %'] || row['OPM 2Qtr Bk']),
    opmQ4: num(row['OPM 3Qtr Bk %'] || row['OPM 3Qtr Bk']),
    // PAT quarterly — Screener uses 'PAT Qtr' / 'PAT Prev Qtr' / 'NP 2Qtr Bk' / 'NP 3Qtr Bk'
    patQ1: num(row['PAT Qtr Rs.Cr.'] || row['PAT Qtr'] || row['Net Profit latest quarter'] || row['Profit after tax latest quarter'] || row['PAT Q-1']),
    patQ2: num(row['PAT Prev Qtr Rs.Cr.'] || row['PAT Prev Qtr'] || row['Net profit preceding quarter'] || row['Profit after tax preceding quarter'] || row['PAT Q-2']),
    patQ3: num(row['NP 2Qtr Bk Rs.Cr.'] || row['NP 2Qtr Bk'] || row['PAT 2Qtr Bk'] || row['Net profit 2quarters back'] || row['PAT Q-3']),
    patQ4: num(row['NP 3Qtr Bk Rs.Cr.'] || row['NP 3Qtr Bk'] || row['PAT 3Qtr Bk'] || row['Net profit 3quarters back'] || row['PAT Q-4']),
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
      const cur = num(row['PAT Qtr Rs.Cr.'] || row['PAT Qtr'] || row['Profit after tax latest quarter']);
      const varPct = num(row['Qtr Profit Var %'] || row['Qtr Profit Var'] || row['YOY Quarterly profit growth']);
      if (cur != null && varPct != null && varPct !== -100) return cur / (1 + varPct / 100);
      return num(row['PAT Q-1 YoY'] || row['Net profit YoY same quarter']);
    })(),
    salesQ1Yoy: (() => {
      const cur = num(row['Sales Qtr Rs.Cr.'] || row['Sales Qtr'] || row['Sales latest quarter']);
      const varPct = num(row['Qtr Sales Var %'] || row['Qtr Sales Var'] || row['YOY Quarterly sales growth']);
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
    opmY2: num(row['OPM Prev Ann %'] || row['OPM 2 year back'] || row['OPM preceding year'] || row['OPM Y-2']),
    opmY3: num(row['OPM 3 year back'] || row['OPM Y-3']),
    opm5yMedian: num(row['5Yr OPM %'] || row['OPM 5Y median'] || row['5Yrs OPM %'] || row['OPM 5Year']),

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
    debt3yBack: num(row['Debt 3Yrs Rs.Cr.'] || row['Debt 3 year back'] || row['Debt 3Years back'] || row['Debt 3Yr back']),
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
