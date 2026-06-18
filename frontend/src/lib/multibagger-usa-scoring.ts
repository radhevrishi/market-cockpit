// PATCH 0728 — Multibagger USA scoring engine extracted from page.tsx.
// Pure code move: usaSerialDate + USARow type + USA_BENCH + getUSABench +
// svUS + scoreUSARow + applyUSARanking. No logic changes.
// scoreUSARow reuses getSectorTailwind from the India scoring lib (sector
// tailwind taxonomy is shared India/USA — same sector → same tailwind score).
import { getSectorTailwind } from '@/lib/multibagger-india-scoring';

export function usaSerialDate(v: unknown): string | undefined {
  if (!v || v === '') return undefined;
  const s = String(v).trim();
  const num = parseFloat(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    // Excel serial: days since Jan 1 1900 (JS epoch adjustment = -25569 days)
    const d = new Date(Math.round((num - 25569) * 86400000));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return s || undefined; // Already a readable string
}

export interface USARow {
  symbol: string; company: string; sector: string; exchange: string;
  marketCapUsd?: number;          // Market capitalization (USD)
  revenueGrowthQtr?: number;      // Revenue growth %, Quarterly YoY
  revenueGrowthAnn?: number;      // Revenue growth %, Annual YoY
  revGrowth3yr?: number;          // Revenue growth %, 3-year CAGR (sustained growth check)
  grossMarginAnn?: number;        // Gross margin %, Annual (GPM)
  grossMarginTtm?: number;        // Gross margin %, TTM (more current, for expansion check)
  fcfMarginAnn?: number;          // Free cash flow margin %, Annual
  grossProfitGrowthQtr?: number;  // Gross profit growth %, Quarterly YoY
  pe?: number;                    // Price to earnings ratio
  forwardPe?: number;             // Forward non-GAAP PE, Annual
  peg?: number;                   // PEG ratio (P/E ÷ growth rate)
  netDebtUsd?: number;            // Net debt, Annual (USD)
  evEbitda?: number;              // EV/EBITDA, TTM
  evRevenue?: number;             // EV/Revenue, TTM
  ps?: number;                    // Price to sales
  opmTtm?: number;                // Operating margin %, TTM
  pb?: number;                    // Price to book
  roe?: number;                   // Return on equity %, TTM
  cashUsd?: number;               // Cash & equivalents, Annual (USD)
  ltDebtUsd?: number;             // Long-term debt, Annual (USD)
  nextEarnings?: string;
  // Optional — user may add from TradingView
  epsGrowth?: number;             // EPS diluted growth %, TTM YoY
  roic?: number;                  // Return on invested capital %, Annual
  de?: number;                    // Debt / equity ratio
  netProfitMargin?: number;       // Net profit margin %, TTM
  perf1y?: number;                // 1-year performance %
  pctFrom52wHigh?: number;        // Change from 52-week high, %
  insiderOwnership?: number;      // (not in TradingView — kept for future use)
  analystCount?: number;          // (not in TradingView — kept for future use)
  forwardRevGrowth?: number;      // (not in TradingView standard — kept for future use)
  analystRating?: string;         // TradingView "Analyst Rating": Strong buy/Buy/Neutral/Sell
  rsi14?: number;                 // TradingView "Relative strength index, 14"
  pFcf?: number;                  // TradingView "Price to free cash flow, TTM"
  // ── PATCH 0341: NEW FORENSIC COLUMNS (TradingView confirmed available) ─────
  piotroskiFScore?: number;       // "Piotroski F-score, Annual" — 0-9 quality score
  altmanZScore?: number;          // "Altman Z-score, Annual" — bankruptcy predictor (SPARSE — only ~5% have it)
  sloanRatio?: number;            // "Sloan ratio %, TTM" — earnings quality / accrual measure
  sharesBuybackRatio?: number;    // "Shares buyback ratio %, Annual" — positive=buyback, negative=dilution
  buybackYield?: number;          // "Buyback yield %" — capital return signal
  rdRatio?: number;               // "Research and development ratio, TTM" — innovation reinvestment
  interestCoverage?: number;      // "Interest coverage, Annual" — distress / leverage health
  netDebtEbitda?: number;         // "Net debt to EBITDA ratio, TTM"
  cashStInvest?: number;          // "Cash and short-term investments, Annual" (USD)
  revPerEmployee?: number;        // "Revenue per employee, Annual" (USD)
  sustainableGrowth?: number;     // "Sustainable growth rate, Annual" — reinvestment-driven growth ceiling
  freeFloatPct?: number;          // "Free float %"
  fcfPerEmployee?: number;        // "Free cash flow per employee, Annual" (USD)
  fcfAnnUsd?: number;             // "Free cash flow, Annual" (USD, absolute) — for runway calc
  fcfTtmUsd?: number;             // "Free cash flow, TTM" (USD, absolute) — fresher than Annual
  totalSharesOutstanding?: number;// "Total common shares outstanding"
  numEmployees?: number;          // "Number of employees, Annual"
  ebitdaPerEmployee?: number;     // "EBITDA per employee, Annual" (USD)
  fcfPerShareTtm?: number;        // PATCH 0342: "Free cash flow per share, TTM" (USD) — fallback for files w/o absolute FCF
  roce?: number;                  // "Return on capital employed %, Annual" (TTM was retired)
  // Derived
  revenueAccel?: number;          // revenueGrowthQtr - revenueGrowthAnn
  accelSignal?: 'ACCELERATING'|'STABLE'|'DECELERATING';
  marketCapB?: number;            // marketCapUsd / 1e9 (in billions)
  ruleOf40?: number;              // revenueGrowthAnn + fcfMarginAnn (≥40 = excellent)
  grossMarginExpansion?: number;  // grossMarginTtm - grossMarginAnn (positive = expanding)
  runwayMonths?: number;          // PATCH 0341: cashStInvest / (annual FCF burn) × 12 — for distress flag
  // PATCH 0577 — Liquidity intelligence
  price?: number;                 // Last close (USD), from TradingView "Price" / "Last" column
  avgVolume30d?: number;          // Average daily share volume, 30-day (TradingView "Average Volume (30 day)")
  avgDailyValueUsdM?: number;     // Derived: (avgVolume30d × price) / 1e6 — average daily $ traded, in millions
  // PATCH 1101qq — New TradingView fields user added.
  perf3m?: number;                // "Performance %, 3 months" — medium momentum
  perf6m?: number;                // "Performance %, 6 months" — medium-long momentum
  epsEstimateAnnual?: number;     // "Earnings per share estimate, Annual" — forward EPS
  beta5y?: number;                // "Beta, 5 years" — market sensitivity
  ebitdaMargin?: number;          // "EBITDA margin %, TTM" — alternative profitability
  capexPerShareTtm?: number;      // "Capital expenditures per share, TTM" — reinvestment intensity
  epsGrowthQtr?: number;          // "Earnings per share diluted growth %, Quarterly YoY" — EPS quarterly accel
  targetPrice1y?: number;         // "Target price, 1 year" — analyst mean target
  ema50?: number;                 // "Exponential moving average, 50, 1 day"
  ema200?: number;                // "Exponential moving average, 200, 1 day"
  // Derived
  rsRating?: number;              // O'Neil-style 1-99 composite (3-horizon weighted)
  impliedUpsidePct?: number;      // (targetPrice1y - price) / price * 100
  forwardPeg?: number;            // Forward P/E ÷ forward EPS growth
  epsAcceleration?: number;       // epsGrowthQtr - epsGrowth (positive = accel)
  capexIntensityPct?: number;     // capexPerShareTtm / fcfPerShareTtm equivalent
  stage2?: boolean;               // Price > EMA200 AND EMA50 > EMA200 AND 1Y perf > 0
}
export type USAGrade = 'A+'|'A'|'B+'|'B'|'C'|'D';

// US Sector benchmarks: [p25, median, p75]
export const USA_BENCH: Record<string, { gm: number[]; opm: number[]; fcf: number[]; revGrowth: number[]; evEbitda: number[] }> = {
  'Electronic technology': { gm:[45,58,72], opm:[15,25,38], fcf:[10,22,35], revGrowth:[10,20,40], evEbitda:[20,35,60] },
  'Technology services':   { gm:[60,72,85], opm:[15,22,34], fcf:[12,20,32], revGrowth:[15,25,45], evEbitda:[25,40,70] },
  'Health technology':     { gm:[50,65,80], opm:[10,18,30], fcf:[8,16,28],  revGrowth:[8,15,28],  evEbitda:[18,28,50] },
  'Finance':               { gm:[30,45,60], opm:[20,30,42], fcf:[10,18,28], revGrowth:[8,15,25],  evEbitda:[12,20,35] },
  'Consumer durables':     { gm:[30,42,55], opm:[10,18,28], fcf:[6,14,24],  revGrowth:[8,15,28],  evEbitda:[15,25,40] },
  DEFAULT:                 { gm:[35,50,65], opm:[10,20,32], fcf:[8,16,28],  revGrowth:[10,20,35], evEbitda:[18,30,50] },
};
export function getUSABench(sector: string) {
  const s = sector.toLowerCase();
  if (s.includes('electronic') || s.includes('semiconductor')) return USA_BENCH['Electronic technology'];
  if (s.includes('tech')) return USA_BENCH['Technology services'];
  if (s.includes('health') || s.includes('pharma') || s.includes('bio')) return USA_BENCH['Health technology'];
  if (s.includes('finance') || s.includes('bank') || s.includes('insur')) return USA_BENCH['Finance'];
  if (s.includes('consumer') || s.includes('retail')) return USA_BENCH['Consumer durables'];
  return USA_BENCH.DEFAULT;
}

// PATCH 1101ii — Market-cap tier helper. Same scoring for AAOI ($13B large)
// vs ENVX ($2B small) is wrong: a large cap burning cash is a bigger red flag
// than a small cap doing the same (small cap is allowed to be early-stage).
// Tiers chosen to match institutional convention:
//   Micro <$500M  · early discovery, max risk, max upside
//   Small $500M-$2B · still building, growth tolerance high
//   Mid $2B-$10B  · sweet spot (institutional eligibility)
//   Large $10B-$100B · mature, must generate cash
//   Mega >$100B   · franchise; lower growth, higher quality bar
export type CapTier = 'MICRO' | 'SMALL' | 'MID' | 'LARGE' | 'MEGA';
export function getCapTier(mcapB?: number): CapTier {
  if (mcapB === undefined) return 'MID';
  if (mcapB < 0.5) return 'MICRO';
  if (mcapB < 2)   return 'SMALL';
  if (mcapB < 10)  return 'MID';
  if (mcapB < 100) return 'LARGE';
  return 'MEGA';
}
// Per-tier thresholds. Lower R40 ok for small (early stage). Higher
// growth required for small (can't justify risk without 25%+). FCF margin
// floor: small can burn, large/mega MUST be FCF positive.
export const CAP_TIER_RULES: Record<CapTier, {
  r40Min: number;          // R40 strict gate (below this → cap at C)
  r40Pass: number;         // R40 "institutional pass" (below this → cap at B+)
  growthMin: number;       // revenue growth filter (below this → growth penalty)
  fcfMarginFloor: number;  // FCF margin floor (below → harsh penalty)
  roceTarget: number;      // ROCE expectation
  label: string;
}> = {
  MICRO: { r40Min: -50, r40Pass: 20, growthMin: 30, fcfMarginFloor: -25, roceTarget: 12, label: 'Micro <$500M' },
  SMALL: { r40Min: -30, r40Pass: 25, growthMin: 25, fcfMarginFloor: -15, roceTarget: 15, label: 'Small $500M-$2B' },
  MID:   { r40Min:   0, r40Pass: 40, growthMin: 20, fcfMarginFloor:   0, roceTarget: 18, label: 'Mid $2B-$10B' },
  LARGE: { r40Min:  10, r40Pass: 40, growthMin: 15, fcfMarginFloor:   5, roceTarget: 22, label: 'Large $10B-$100B' },
  MEGA:  { r40Min:  15, r40Pass: 35, growthMin: 10, fcfMarginFloor:  10, roceTarget: 25, label: 'Mega >$100B' },
};

export function svUS(v: number|undefined, bench: number[], hiGood=true): number {
  if (v===undefined||v===null||isNaN(v as number)) return 0;
  const [lo,mid,hi] = hiGood ? bench : bench.map(x=>-x);
  const val = hiGood ? v : -v;
  if (val>=hi) return Math.min(100, 88+(val-hi)*0.4);
  if (val>=mid) return 72+((val-mid)/(hi-mid))*16;
  if (val>=lo) return 50+((val-lo)/(mid-lo))*22;
  return Math.max(0, 30+Math.max(0,val)/Math.max(lo,1)*20);
}

export function scoreUSARow(row: USARow): USARow & { score: number; grade: USAGrade; coverage: number; strengths: string[]; risks: string[]; pillarScores: {id:string;label:string;score:number;color:string}[]; fcfOpDivergence?: boolean; postRunStretched?: boolean; earningsProximityDays?: number; suggestedMaxPositionPct?: number } {
  const b = getUSABench(row.sector);
  const strengths: string[] = [];
  const risks: string[] = [];

  // PATCH 1101ii — Compute market-cap tier and surface it. Used downstream
  // for tier-specific R40 gates, growth filters, FCF margin floors, ROCE
  // expectations. Defaults to MID when mcap unknown (neutral).
  const capTier = getCapTier(row.marketCapB);
  const tierRules = CAP_TIER_RULES[capTier];
  (row as any).capTier = capTier;
  strengths.push(`📊 Cap tier: ${tierRules.label}`);

  // ── QUALITY (30%): Gross Margin, FCF Margin, OPM, ROE ──────────────────────
  let qualS=0, qualC=0;
  // Use TTM as primary gross margin (TradingView now provides TTM; Annual is fallback)
  const effectiveGM = row.grossMarginTtm ?? row.grossMarginAnn;
  if (effectiveGM !== undefined) {
    const s=svUS(effectiveGM,b.gm); qualS+=s; qualC++;
    const label = row.grossMarginTtm !== undefined ? 'TTM' : 'Annual';
    if (s>=80) strengths.push(`Gross margin ${effectiveGM.toFixed(1)}% (${label}) — pricing power, durable moat`);
    else if (s<45) risks.push(`Gross margin ${effectiveGM.toFixed(1)}% (${label}) — thin, limited pricing power`);
  }
  if (row.fcfMarginAnn !== undefined) {
    let s = row.fcfMarginAnn>=25?92:row.fcfMarginAnn>=15?82:row.fcfMarginAnn>=8?65:row.fcfMarginAnn>=0?45:20;
    // PATCH 1101ii — Cap-aware FCF margin floor.
    // A large cap with negative FCF margin is a much bigger red flag than a
    // micro cap with the same negative FCF. Mature franchises must generate
    // cash; early-stage allowed to burn during growth phase.
    if (row.fcfMarginAnn < tierRules.fcfMarginFloor) {
      const gapPp = tierRules.fcfMarginFloor - row.fcfMarginAnn;
      // Penalty scales with both gap AND cap tier — larger tier means harsher.
      const tierMultiplier = capTier === 'MEGA' ? 1.5 : capTier === 'LARGE' ? 1.3 : capTier === 'MID' ? 1.0 : capTier === 'SMALL' ? 0.7 : 0.5;
      const penalty = Math.min(40, Math.round(gapPp * tierMultiplier));
      s = Math.max(5, s - penalty);
      risks.push(`🛑 FCF margin ${row.fcfMarginAnn.toFixed(1)}% below ${tierRules.fcfMarginFloor}% floor for ${tierRules.label} (−${penalty}). ${capTier === 'LARGE' || capTier === 'MEGA' ? 'Mature companies must generate cash — burning $1B+ at this scale is unforgivable.' : 'Cash burn acceptable only with hyper-growth justification.'}`);
    }
    // PATCH 0753 — single-source FCF rule. When DNA bonus is GOING to fire
    // below (which awards +6 explicitly crediting FCF margin), AND the FCF
    // margin is already extreme (≥20%), the Quality pillar's FCF
    // contribution is partially double-counting the same signal at the
    // composite level. P0349 surgically patched PAYS via the FCF/Op
    // divergence detector, but didn't address the general case where a
    // legit-but-FCF-dominant name gets +qualS:92 + DNA:+6 stacked.
    // Fix: when DNA will fire AND FCF margin ≥ 20%, halve the FCF Quality
    // contribution (92 → 46) so the row scores from MULTIPLE quality signals,
    // not just FCF amplified. Doesn't affect names where FCF is a minor
    // contributor or where DNA doesn't fire. Net effect: a ~3-5 point
    // reduction on FCF-stacked rows, no change elsewhere.
    const dnaWillFire =
         ((row.ruleOf40 ?? 0) >= 40 && (row.fcfMarginAnn ?? 0) >= 10 && ((row.grossMarginTtm ?? row.grossMarginAnn ?? 0) >= 60) && ((row.revenueGrowthAnn ?? 0) >= 20))
      || ((row.roe ?? 0) >= 18 && (row.roic ?? 0) >= 15 && (row.fcfMarginAnn ?? 0) >= 15 && ((row.de ?? 99) < 0.5) && ((row.revenueGrowthAnn ?? 0) >= 12));
    if (dnaWillFire && row.fcfMarginAnn >= 20) {
      s = Math.round(s * 0.5);
    }
    qualS+=s; qualC++;
    // PATCH 0575 — Don't push the standalone "FCF margin X% — strong cash
    // generation" bullet when R40 or DNA bonus will also fire below. They
    // already cite the same FCF number, so the standalone bullet creates
    // triple-counting in the strengths list (PAYS post-mortem root cause).
    // We suppress the standalone bullet anticipatorily by checking the same
    // gates we'd use later; the upside is that R40 + DNA bullets are richer
    // (composite + multi-signal) so the user sees the FCF signal in better
    // context. Negative FCF still surfaces as a risk regardless.
    const willFireR40Bullet = (row.ruleOf40 ?? 0) >= 40;
    const willFireDnaBullet =
         ((row.ruleOf40 ?? 0) >= 40 && (row.fcfMarginAnn ?? 0) >= 10)
      || ((row.roe ?? 0) >= 18 && (row.roic ?? 0) >= 15 && (row.fcfMarginAnn ?? 0) >= 15);
    if (row.fcfMarginAnn>=15 && !willFireR40Bullet && !willFireDnaBullet) {
      strengths.push(`FCF margin ${row.fcfMarginAnn.toFixed(1)}% — strong cash generation`);
    } else if (row.fcfMarginAnn<0) {
      risks.push(`Negative FCF margin — burning cash`);
    }
  }
  if (row.opmTtm !== undefined) {
    const s=svUS(row.opmTtm,b.opm); qualS+=s; qualC++;
    if (s>=80) strengths.push(`Operating margin ${row.opmTtm.toFixed(1)}% — operational excellence`);
  }
  if (row.roe !== undefined) {
    const s=svUS(row.roe,[10,18,28]); qualS+=s; qualC++;
    if (s>=80) strengths.push(`ROE ${row.roe.toFixed(1)}% — strong returns on equity`);
  }
  if (row.roic !== undefined) {
    const s=row.roic>=25?90:row.roic>=18?80:row.roic>=12?65:row.roic>=8?45:25;
    qualS+=s; qualC++;
    if (row.roic>=20) strengths.push(`ROIC ${row.roic.toFixed(1)}% — above cost of capital, durable value creation`);
    else if (row.roic<10) risks.push(`ROIC ${row.roic.toFixed(1)}% — below WACC, capital not productive`);
  }
  // PATCH 1101hh — ROCE (was parsed but never used). Buffett's #1 capital
  // efficiency metric. ROCE measures returns on the ENTIRE capital base
  // (equity + debt) so it strips out leverage games. >25% = elite franchise.
  if (row.roce !== undefined) {
    const s=row.roce>=25?92:row.roce>=18?82:row.roce>=12?65:row.roce>=8?45:25;
    qualS+=s; qualC++;
    if (row.roce>=25) strengths.push(`ROCE ${row.roce.toFixed(1)}% — Buffett-grade capital efficiency (>25%)`);
    else if (row.roce<10) risks.push(`ROCE ${row.roce.toFixed(1)}% — capital base not productive (<10%)`);
  }
  if (row.netProfitMargin !== undefined) {
    const s=svUS(row.netProfitMargin,[5,12,22]); qualS+=s*0.6; qualC+=0.6;
  }
  // Gross margin expansion scoring (TTM vs Annual — direction > absolute level)
  // GPM expansion = pricing power improving = moat strengthening = institutional buy signal
  if (row.grossMarginExpansion !== undefined) {
    if (row.grossMarginExpansion > 5) {
      qualS += 16; qualC += 0.6;
      strengths.push(`Gross margin expanding +${row.grossMarginExpansion.toFixed(1)}pp (TTM vs Annual) — pricing power confirming moat`);
    } else if (row.grossMarginExpansion > 2) {
      qualS += 8; qualC += 0.3;
      strengths.push(`Gross margin expanding +${row.grossMarginExpansion.toFixed(1)}pp — margins trending right`);
    } else if (row.grossMarginExpansion < -4) {
      qualS -= 12;
      risks.push(`Gross margin compressing −${Math.abs(row.grossMarginExpansion).toFixed(1)}pp — competitive pressure or cost inflation`);
    } else if (row.grossMarginExpansion < -2) {
      qualS -= 6;
      risks.push(`Gross margin declining −${Math.abs(row.grossMarginExpansion).toFixed(1)}pp — watch pricing power`);
    }
  }
  // Rule of 40 — SaaS/tech benchmark (narrative only, NOT added to pillars to prevent double-counting)
  // Revenue growth scored in GROWTH pillar; FCF margin scored in QUALITY above.
  // Rule of 40 here just surfaces the combined number as a strength/risk label.
  // PATCH 0705 — FCF triple-count de-dup phase 2. The R40-elite bullet (≥60)
  // cites the FCF margin verbatim, and the DNA bonus below also cites FCF
  // margin in its own bullet. When DNA fires the elite-R40 phrasing becomes
  // redundant — suppress and let the richer DNA bullet carry the signal.
  // (Same pattern P0575 used for the standalone Qual FCF bullet.)
  // PATCH 1101gg — Always calculate R40 when CSV doesn't provide it.
  // User insight: revenue growth + FCF margin = R40, both fields are usually
  // present, so we can always compute it. Previously stocks without explicit
  // ruleOf40 column escaped the R40 caps entirely.
  if (row.ruleOf40 === undefined
      && typeof row.revenueGrowthAnn === 'number'
      && typeof (row.fcfMarginAnn ?? row.fcfMarginTtm) === 'number') {
    (row as any).ruleOf40 = (row.revenueGrowthAnn ?? 0) + (row.fcfMarginAnn ?? row.fcfMarginTtm ?? 0);
  }
  const ruleOf40 = row.ruleOf40;
  if (ruleOf40 !== undefined) {
    const willFireDnaAtCap =
         ((row.ruleOf40 ?? 0) >= 40 && (effectiveGM ?? 0) >= 60 && (row.revenueGrowthAnn ?? 0) >= 20 && (row.fcfMarginAnn ?? 0) >= 10)
      || ((row.roe ?? 0) >= 18 && (row.roic ?? 0) >= 15 && (row.fcfMarginAnn ?? 0) >= 15 && (row.de ?? 99) < 0.5 && (row.revenueGrowthAnn ?? 0) >= 12);
    if (ruleOf40 >= 60 && !willFireDnaAtCap) strengths.push(`🏆 Rule of 40: ${ruleOf40.toFixed(0)} — elite (Rev ${(row.revenueGrowthAnn??0).toFixed(0)}% + FCF ${(row.fcfMarginAnn??0).toFixed(0)}%)`);
    else if (ruleOf40 >= 40 && !willFireDnaAtCap) strengths.push(`✅ Rule of 40: ${ruleOf40.toFixed(0)} — passes institutional benchmark (≥40)`);
    else if (ruleOf40 < 20) risks.push(`⚠️ Rule of 40: ${ruleOf40.toFixed(0)} — below threshold (need ≥40 for premium multiple)`);
  }

  // ── GROWTH (25%): Revenue Annual + Quarterly + 3yr CAGR ──────────────────────
  let growS=0, growC=0;
  if (row.revenueGrowthAnn !== undefined) {
    const s=svUS(row.revenueGrowthAnn,b.revGrowth); growS+=s; growC++;
    if (s>=80) strengths.push(`Revenue growth ${row.revenueGrowthAnn.toFixed(1)}% YoY — strong compounding`);
    // 🚨 PATCH 1101ii — CAP-AWARE Growth Quality Filter.
    // Different growth expectations per cap tier. Micro/small must grow fast
    // (no other reason to own them); large/mega get a pass at 15%/10% because
    // mature franchises don't grow at hyper rates and that's OK.
    if (row.revenueGrowthAnn < tierRules.growthMin) {
      const gapPp = tierRules.growthMin - row.revenueGrowthAnn;
      const penalty = gapPp > 20 ? 25 : gapPp > 10 ? 18 : 10;
      growS = Math.max(0, growS - penalty);
      risks.push(`🚨 Growth filter (${tierRules.label}): ${row.revenueGrowthAnn.toFixed(1)}% below ${tierRules.growthMin}% threshold for this cap tier (−${penalty})`);
    }
  }
  // 3-year CAGR consistency check — spike vs sustained
  if (row.revGrowth3yr !== undefined) {
    const s = svUS(row.revGrowth3yr, b.revGrowth); growS += s * 0.8; growC += 0.8;
    if (row.revenueGrowthAnn !== undefined && row.revGrowth3yr < row.revenueGrowthAnn * 0.5) {
      growS -= 12; risks.push(`Revenue spike risk: ${row.revenueGrowthAnn.toFixed(0)}% annual vs ${row.revGrowth3yr.toFixed(0)}% 3yr CAGR — recent surge may not be sustained`);
    } else if (row.revGrowth3yr > 25) {
      strengths.push(`Sustained growth: ${row.revGrowth3yr.toFixed(1)}% 3yr CAGR — not a one-year spike`);
    }
  }
  if (row.epsGrowth !== undefined) {
    const s=svUS(row.epsGrowth,[10,25,45]); growS+=s; growC++;
    if (s>=80) strengths.push(`EPS growth ${row.epsGrowth.toFixed(1)}% — earnings compounding faster than revenue (op leverage)`);
  }
  if (row.grossProfitGrowthQtr !== undefined && row.revenueGrowthQtr !== undefined) {
    if (row.grossProfitGrowthQtr > row.revenueGrowthQtr + 5) {
      growS += 10; growC += 0.4;
      strengths.push(`Gross profit +${row.grossProfitGrowthQtr.toFixed(0)}% vs revenue +${row.revenueGrowthQtr.toFixed(0)}% — margins expanding`);
    }
  }

  // ── ACCELERATION (20%): Quarterly growth vs Annual growth ─────────────────
  let accelS=50;
  const revAccel = row.revenueAccel ?? (row.revenueGrowthQtr !== undefined && row.revenueGrowthAnn !== undefined ? row.revenueGrowthQtr - row.revenueGrowthAnn : undefined);
  if (revAccel !== undefined) {
    // 5pp threshold (not 8): A QoQ 20% vs Ann 14% (+6pp) IS accelerating — don't miss it
    const signal = revAccel >= 5 ? 'ACCELERATING' : revAccel <= -5 ? 'DECELERATING' : 'STABLE';
    accelS = signal==='ACCELERATING' ? Math.min(100, 78 + revAccel * 0.6) : signal==='DECELERATING' ? Math.max(15, 50 + revAccel) : 55;
    if (signal==='ACCELERATING') strengths.push(`Revenue ACCELERATING: +${row.revenueGrowthQtr?.toFixed(0)}% QoQ YoY vs +${row.revenueGrowthAnn?.toFixed(0)}% Annual (+${revAccel.toFixed(0)}pp)`);
    if (signal==='DECELERATING') risks.push(`Revenue DECELERATING: ${row.revenueGrowthQtr?.toFixed(0)}% QoQ vs ${row.revenueGrowthAnn?.toFixed(0)}% Annual (${revAccel.toFixed(0)}pp)`);
  }

  // ── VALUATION (15%): EV/EBITDA, P/E, Forward P/E, P/S ────────────────────
  const valComponents: number[] = [];
  if (row.evEbitda !== undefined && row.evEbitda > 0) {
    valComponents.push(svUS(row.evEbitda,b.evEbitda,false));
    if (row.evEbitda < b.evEbitda[0]) strengths.push(`EV/EBITDA ${row.evEbitda.toFixed(1)}× — cheap on enterprise value`);
    else if (row.evEbitda > b.evEbitda[2]*1.5) risks.push(`EV/EBITDA ${row.evEbitda.toFixed(1)}× — very expensive`);
  }
  if (row.forwardPe !== undefined && row.forwardPe > 0) {
    const fpS = row.forwardPe<15?90:row.forwardPe<25?80:row.forwardPe<40?65:row.forwardPe<60?48:row.forwardPe<100?32:18;
    valComponents.push(fpS);
    if (row.forwardPe<20) strengths.push(`Forward P/E ${row.forwardPe.toFixed(1)}× — attractive growth-adjusted valuation`);
  } else if (row.pe !== undefined && row.pe > 0) {
    valComponents.push(svUS(row.pe,[15,30,55],false));
  }
  if (row.ps !== undefined && row.ps > 0) {
    valComponents.push(svUS(row.ps,[2,5,12],false));
    if (row.ps < 2) strengths.push(`P/S ${row.ps.toFixed(1)}× — value zone for the franchise`);
    else if (row.ps > 25) risks.push(`P/S ${row.ps.toFixed(1)}× — extreme valuation, depends entirely on sustained hyper-growth`);
  }
  // PATCH 1101hh — Price-to-Book (was parsed but never used in scoring).
  // P/B < 1 = deep value (asset coverage), P/B 1-3 = reasonable, > 5 = quality premium,
  // > 10 = stretched. Adds a value-floor signal especially for capital-intensive sectors.
  if (row.pb !== undefined && row.pb > 0) {
    const pbS = row.pb < 1 ? 88 : row.pb < 3 ? 72 : row.pb < 5 ? 58 : row.pb < 10 ? 42 : 28;
    valComponents.push(pbS);
    if (row.pb < 1) strengths.push(`P/B ${row.pb.toFixed(2)}× — trades below book value (asset-backed value)`);
    else if (row.pb > 10) risks.push(`P/B ${row.pb.toFixed(1)}× — extreme premium to book; valuation hyper-dependent on intangibles`);
  }
  // PATCH 1101hh — EV/Revenue (was parsed but never used). Best valuation metric
  // for pre-profit / low-margin companies where P/E and EV/EBITDA are not meaningful.
  if (row.evRevenue !== undefined && row.evRevenue > 0) {
    const evrS = row.evRevenue < 1 ? 90 : row.evRevenue < 3 ? 72 : row.evRevenue < 8 ? 55 : row.evRevenue < 15 ? 38 : 22;
    valComponents.push(evrS);
    if (row.evRevenue > 25) risks.push(`EV/Revenue ${row.evRevenue.toFixed(1)}× — narrative-driven valuation; needs hyper-growth + 50%+ margins to justify`);
  }
  // PEG ratio — best growth-adjusted valuation check
  if (row.peg !== undefined && row.peg > 0) {
    const pegS = row.peg<0.8?92:row.peg<1.2?82:row.peg<2.0?65:row.peg<3.0?45:25;
    valComponents.push(pegS);
    if (row.peg<1.0) strengths.push(`PEG ${row.peg.toFixed(2)} — undervalued relative to growth rate`);
    else if (row.peg>3.0) risks.push(`PEG ${row.peg.toFixed(2)} — expensive relative to growth rate`);
  } else if (row.peg !== undefined && row.peg <= 0) {
    // PATCH 0461 — PEG ≤ 0 is a red flag, not a skip. Negative PEG means
    // negative growth or loss-making. Either way the growth-adjusted
    // valuation pillar should be penalised, not silently ignored.
    valComponents.push(35);
    risks.push(`PEG ${row.peg.toFixed(2)} — negative (loss-making or contracting); valuation pillar penalised`);
  }
  // Forward revenue growth — visibility premium
  if (row.forwardRevGrowth !== undefined) {
    if (row.forwardRevGrowth >= 25) { valComponents.push(78); strengths.push(`Forward revenue growth ${row.forwardRevGrowth.toFixed(0)}% FY1 — analysts see continued acceleration`); }
    else if (row.forwardRevGrowth >= 15) valComponents.push(62);
    else if (row.forwardRevGrowth < 10) { valComponents.push(35); risks.push(`Forward revenue growth ${row.forwardRevGrowth.toFixed(0)}% — analysts expect slowdown`); }
  }
  // PATCH 1101dd — Missing valuation data penalty (was: silent default 50).
  // Rows with P/E "—" AND EV/EBITDA "—" should not be treated as neutral.
  // We can't assess valuation = downside risk. 40 (below-neutral) is more
  // honest and feeds through to a lower final score. This catches early-stage
  // / pre-revenue stocks that previously coasted at C grade.
  const valS = valComponents.length > 0
    ? valComponents.reduce((a,b)=>a+b,0)/valComponents.length
    : 40;
  if (valComponents.length === 0) {
    risks.push(`⚠️ No valuation metrics (P/E, Fwd P/E, EV/EBITDA, PEG all missing) — can't assess valuation. Pillar defaulted to 40 (below-neutral penalty).`);
  }

  // ── MARKET (10%): Market cap discovery + sector tailwind + insider ──────────
  let mktS=50;
  if (row.marketCapB !== undefined) {
    // Tighter bands: US multibaggers typically emerge from $1-50B range
    mktS = row.marketCapB<0.5?92:row.marketCapB<2?86:row.marketCapB<10?78:row.marketCapB<50?65:row.marketCapB<150?50:row.marketCapB<500?38:26;
    if (row.marketCapB<2)   strengths.push(`Market cap $${row.marketCapB.toFixed(1)}B — micro/small cap, maximum runway`);
    else if (row.marketCapB<10) strengths.push(`Market cap $${row.marketCapB.toFixed(1)}B — small cap, strong multibagger runway`);
    else if (row.marketCapB>150) risks.push(`Market cap $${row.marketCapB.toFixed(0)}B — large cap, limited 100× potential from here`);
  }
  // Insider ownership — US promoter proxy (high = skin in game)
  if (row.insiderOwnership !== undefined) {
    const insS = row.insiderOwnership>=20?85:row.insiderOwnership>=10?72:row.insiderOwnership>=5?58:40;
    mktS = (mktS + insS) / 2;
    if (row.insiderOwnership >= 15) strengths.push(`Insider ownership ${row.insiderOwnership.toFixed(1)}% — management has skin in game`);
    else if (row.insiderOwnership < 2) risks.push(`Insider ownership ${row.insiderOwnership.toFixed(1)}% — very low management alignment`);
  }
  // Analyst count — low coverage = undiscovered (like SQGLP "S" for India)
  if (row.analystCount !== undefined) {
    if (row.analystCount <= 5)  { mktS = Math.min(100, mktS+8);  strengths.push(`Only ${row.analystCount} analysts covering — undiscovered, institutional re-rating ahead`); }
    else if (row.analystCount <= 12) { mktS = Math.min(100, mktS+4); }
    else if (row.analystCount > 30) { mktS = Math.max(0, mktS-5); risks.push(`${row.analystCount} analysts covering — well-covered, limited discovery premium`); }
  }
  if (row.pctFrom52wHigh !== undefined) {
    if (row.pctFrom52wHigh >= -5) { mktS = Math.min(100, mktS+10); strengths.push(`Near 52W high (${row.pctFrom52wHigh.toFixed(0)}%) — price confirming thesis`); }
    else if (row.pctFrom52wHigh < -40) mktS = Math.max(0, mktS-10);
  }
  // PATCH 0705 — 1Y perf de-dup. Previously this added +6 to mktS pillar
  // AND pushed a standalone momentum bullet on the same data point.
  // When perf1y > 50 the analyst-after-run logic (Womack 1996) already cites
  // the same +X% run in its discounted-rating bullet, so this becomes the
  // third mention of one data point. Also suppress the post-cap-binding case
  // (perf1y > 100) — the STRETCHED risk bullet at the cap section names the
  // same run with a more honest framing. Net rule: bullet fires only when
  // perf1y is in the "healthy momentum" zone (20-50%) where neither the
  // analyst-discount nor the post-run cap logic will repeat it.
  if (row.perf1y !== undefined && row.perf1y > 20) {
    mktS = Math.min(100, mktS+6);
    const willAnalystAfterRunCite = (row.perf1y > 50) && !!row.analystRating
      && /buy/i.test(row.analystRating) && !/sell/i.test(row.analystRating);
    const willPostRunCapCite = row.perf1y > 100
      && ((row.forwardPe !== undefined && row.forwardPe > 25)
       || (row.pe !== undefined && row.pe > 30));
    if (!willAnalystAfterRunCite && !willPostRunCapCite) {
      strengths.push(`+${row.perf1y.toFixed(0)}% past year — momentum confirming fundamentals`);
    }
  }
  const tailwind = getSectorTailwind(row.sector);
  if (tailwind.score >= 70) { mktS = Math.min(100, mktS+6); strengths.push(`Sector tailwind (${tailwind.label}): ${tailwind.drivers.slice(0,50)}`); }

  // ── Analyst Rating (TradingView consensus) ───────────────────────────────
  // PATCH 0349c — Analyst-after-run discount. When 1yr return > 50%, analyst
  // Buy/Strong Buy carries near-zero predictive value (Womack 1996, Stickel
  // 1995). Analysts upgrade AFTER run-ups — the rating is a lagging signal
  // with career-risk biases. Halve the Market-pillar boost in that regime.
  if (row.analystRating) {
    const rating = row.analystRating.toLowerCase().trim();
    const afterRun = (row.perf1y ?? 0) > 50;
    if (rating.includes('strong buy')) {
      const boost = afterRun ? 4 : 8;
      mktS = Math.min(100, mktS + boost);
      if (afterRun) strengths.push(`Analyst consensus: Strong Buy — discounted to +${boost} (vs +8) — lagging after +${row.perf1y?.toFixed(0)}% run (Womack 1996: post-run upgrades have near-zero predictive value)`);
      else strengths.push(`Analyst consensus: Strong Buy — institutional conviction signal`);
    } else if (rating.includes('buy')) {
      const boost = afterRun ? 2 : 4;
      mktS = Math.min(100, mktS + boost);
      if (afterRun) strengths.push(`Analyst consensus: Buy — discounted to +${boost} (vs +4) — lagging after +${row.perf1y?.toFixed(0)}% run`);
      else strengths.push(`Analyst consensus: Buy — positive professional outlook`);
    } else if (rating.includes('strong sell')) {
      mktS = Math.max(0, mktS - 10);
      risks.push(`Analyst consensus: Strong Sell — professional community broadly negative`);
    } else if (rating.includes('sell')) {
      mktS = Math.max(0, mktS - 5);
      risks.push(`Analyst consensus: Sell — analysts see downside risk`);
    }
    // Neutral / Hold → no adjustment (no signal)
  }

  // PATCH 1101hh — Net-Cash Bonus (parsed cashUsd / ltDebtUsd but never used).
  // Net-cash balance sheet = optionality + buyback firepower + survival in downturns.
  // Cash > LT debt AND > 5% of mcap = meaningful net-cash position.
  if (row.cashUsd !== undefined && row.ltDebtUsd !== undefined && row.marketCapUsd !== undefined) {
    const netCash = row.cashUsd - row.ltDebtUsd;
    const netCashPctMcap = (netCash / row.marketCapUsd) * 100;
    if (netCash > 0 && netCashPctMcap >= 10) {
      mktS = Math.min(100, mktS + 8);
      strengths.push(`Net cash $${(netCash/1e9).toFixed(1)}B (${netCashPctMcap.toFixed(0)}% of mcap) — optionality and downturn survival`);
    } else if (netCash > 0 && netCashPctMcap >= 5) {
      mktS = Math.min(100, mktS + 4);
    } else if (row.ltDebtUsd > 0 && netCash < -row.marketCapUsd * 0.25) {
      mktS = Math.max(0, mktS - 8);
      risks.push(`Heavy leverage: LT debt $${(row.ltDebtUsd/1e9).toFixed(1)}B exceeds 25% of mcap — refinancing risk`);
    }
  } else if (row.cashStInvest !== undefined && row.marketCapUsd !== undefined && row.ltDebtUsd !== undefined) {
    // Fallback when explicit cashUsd is missing — use Cash and short-term investments.
    const netCash = row.cashStInvest - row.ltDebtUsd;
    const netCashPctMcap = (netCash / row.marketCapUsd) * 100;
    if (netCash > 0 && netCashPctMcap >= 10) {
      mktS = Math.min(100, mktS + 8);
      strengths.push(`Net cash + ST investments $${(netCash/1e9).toFixed(1)}B (${netCashPctMcap.toFixed(0)}% of mcap) — fortress balance sheet`);
    }
  }

  // PATCH 1101hh — Free Float % (parsed but never used). High free float =
  // institutional liquidity for size buyers. Low free float = micro-illiquid
  // (price subject to manipulation, hard to exit large positions). India
  // promoter holding uses inverse logic; for USA, FF<25% is the warning sign.
  if (row.freeFloatPct !== undefined) {
    if (row.freeFloatPct < 25) {
      mktS = Math.max(0, mktS - 6);
      risks.push(`Free float ${row.freeFloatPct.toFixed(0)}% — low public float (illiquid, manipulation risk for institutional sizers)`);
    } else if (row.freeFloatPct >= 70 && row.freeFloatPct <= 95) {
      mktS = Math.min(100, mktS + 3);
    }
  }

  // ── RSI Momentum (TradingView "Relative strength index, 14") ─────────────
  if (row.rsi14 !== undefined) {
    if (row.rsi14 >= 55 && row.rsi14 <= 75) {
      mktS = Math.min(100, mktS + 5);
      strengths.push(`RSI ${row.rsi14.toFixed(0)} — uptrend momentum zone (not overbought)`);
    } else if (row.rsi14 > 80) {
      risks.push(`RSI ${row.rsi14.toFixed(0)} — overbought, potential short-term pullback`);
    } else if (row.rsi14 < 35) {
      if (row.accelSignal === 'ACCELERATING') {
        strengths.push(`RSI ${row.rsi14.toFixed(0)} — oversold with accelerating fundamentals (potential entry)`);
      } else {
        risks.push(`RSI ${row.rsi14.toFixed(0)} — oversold, momentum broken`);
      }
    }
  }

  // ── P/FCF Valuation (TradingView "Price to free cash flow, TTM") ─────────
  if (row.pFcf !== undefined && row.pFcf > 0) {
    const pfcfScore = row.pFcf < 15 ? 90 : row.pFcf < 25 ? 78 : row.pFcf < 40 ? 62 : row.pFcf < 60 ? 44 : 25;
    valComponents.push(pfcfScore * 0.8); // slightly less weight than P/E but highly credible
    if (row.pFcf < 20) strengths.push(`P/FCF ${row.pFcf.toFixed(0)}× — cheap on free cash flow basis (Buffett preferred metric)`);
    else if (row.pFcf > 60) risks.push(`P/FCF ${row.pFcf.toFixed(0)}× — expensive relative to free cash flow`);
  }

  // ── LEVERAGE CHECK ────────────────────────────────────────────────────────
  if (row.de !== undefined && row.de > 2.0) risks.push(`D/E ${row.de.toFixed(2)}× — significant leverage`);
  if (row.netDebtUsd !== undefined && row.marketCapUsd !== undefined && row.marketCapUsd > 0) {
    const netDebtToMcap = row.netDebtUsd / row.marketCapUsd * 100;
    if (netDebtToMcap > 50) risks.push(`Net debt ${netDebtToMcap.toFixed(0)}% of market cap — heavy balance sheet`);
    else if (row.netDebtUsd < 0) strengths.push(`Net cash position — no debt risk`);
  }

  // ── PILLARS & FINAL SCORE ─────────────────────────────────────────────────
  const qual  = qualC>0 ? qualS/qualC : 50;
  const growth= growC>0 ? growS/growC : 50;
  const accel = accelS;
  const val   = valS;
  const mkt   = mktS;

  const filledFields = [effectiveGM, row.fcfMarginAnn, row.opmTtm, row.roe, row.evEbitda,
    row.pe||row.forwardPe, row.marketCapUsd, row.netDebtUsd, row.revenueGrowthQtr,
    row.revenueGrowthAnn, row.epsGrowth, row.roic, row.peg, row.revGrowth3yr,
    row.analystRating ? 1 : undefined].filter(v=>v!==undefined).length;
  const coverage = Math.min(100, Math.round(filledFields/15*100));

  const raw = qual*0.30 + growth*0.25 + accel*0.20 + val*0.15 + mkt*0.10;
  let score = Math.max(0, Math.min(100, Math.round(raw/5)*5));

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0341 — FORENSIC COLUMN INTEGRATION (TradingView institutional scores)
  // These rules apply BEFORE the cap section because some of them push score
  // adjustments (positive or negative) that should flow into the cap logic.
  // ═══════════════════════════════════════════════════════════════════════════
  let forensicAdj = 0;
  let forensicCap: number | undefined;
  const isTechSector = /TECHNOLOGY|SOFTWARE|SAAS|INTERNET|SEMICONDUCT|ELECTRONIC/i.test(row.sector || '');

  // (A) PIOTROSKI F-SCORE (0-9). The institutional 9-point quality screen.
  //     F≥7 = top-quality, F≤2 = distress, mid = neutral. Annual data.
  if (typeof row.piotroskiFScore === 'number') {
    if (row.piotroskiFScore >= 7) {
      forensicAdj += 5;
      strengths.push(`Piotroski F-score ${row.piotroskiFScore}/9 — top-quality institutional screen (≥7 is the Greenblatt/Piotroski elite tier).`);
    } else if (row.piotroskiFScore <= 2) {
      forensicCap = Math.min(forensicCap ?? 100, 50);
      risks.push(`🛑 Piotroski F-score ${row.piotroskiFScore}/9 — distress zone (≤2). Profitability + leverage + efficiency all failing. Cap at 50.`);
    } else if (row.piotroskiFScore <= 4) {
      forensicAdj -= 3;
      risks.push(`Piotroski F-score ${row.piotroskiFScore}/9 — weak (need ≥5 for clean compounder).`);
    }
  }

  // (B) ALTMAN Z-SCORE (SOFT GATE — sparse data: ~5% of stocks have it).
  //     Z<1.8 = distress zone. Apply SOFT penalty (-5) not hard cap,
  //     because most stocks don't publish this and we can't penalize absence.
  if (typeof row.altmanZScore === 'number') {
    if (row.altmanZScore < 1.8) {
      forensicAdj -= 5;
      risks.push(`⚠ Altman Z-score ${row.altmanZScore.toFixed(2)} — distress zone (<1.8) per Altman 1968. Bankruptcy risk elevated. −5 rerating.`);
    } else if (row.altmanZScore >= 3.0) {
      forensicAdj += 2;
      strengths.push(`Altman Z-score ${row.altmanZScore.toFixed(2)} — financial-health safe zone (≥3.0).`);
    }
  }

  // (C) SLOAN RATIO. Earnings-quality measure. |Sloan| > 25% = high accruals
  //     = earnings driven by non-cash items (manipulation risk per Sloan 1996).
  if (typeof row.sloanRatio === 'number' && Math.abs(row.sloanRatio) > 25) {
    forensicAdj -= 4;
    risks.push(`Sloan ratio ${row.sloanRatio.toFixed(1)}% — extreme accruals (>${Math.abs(row.sloanRatio).toFixed(0)}%). Sloan 1996 study: high-accrual firms underperform 10%/yr.`);
  }

  // (D) SHARES BUYBACK RATIO. Positive = net buyback (shareholder-friendly),
  //     negative = net dilution. Annual data is the right frequency.
  if (typeof row.sharesBuybackRatio === 'number') {
    if (row.sharesBuybackRatio <= -5) {
      // Heavy dilution — HIGH structural red flag equivalent
      forensicCap = Math.min(forensicCap ?? 100, 60);
      risks.push(`🛑 Share count growing ${Math.abs(row.sharesBuybackRatio).toFixed(1)}%/yr — heavy dilution funding growth. Cap at 60.`);
    } else if (row.sharesBuybackRatio <= -2) {
      forensicAdj -= 4;
      risks.push(`Net dilution ${Math.abs(row.sharesBuybackRatio).toFixed(1)}%/yr — per-share value being diluted.`);
    } else if (row.sharesBuybackRatio >= 3) {
      forensicAdj += 4;
      strengths.push(`Net buyback ${row.sharesBuybackRatio.toFixed(1)}%/yr — shareholder-friendly capital allocation.`);
    } else if (row.sharesBuybackRatio >= 1) {
      forensicAdj += 2;
    }
  }

  // (E) BUYBACK YIELD. Direct capital-return signal. ≥3% sustained + FCF
  //     positive = Buffett-tier capital allocation discipline.
  if (typeof row.buybackYield === 'number' && row.buybackYield >= 3
      && (row.fcfMarginAnn ?? 0) > 0) {
    forensicAdj += 3;
    strengths.push(`Buyback yield ${row.buybackYield.toFixed(1)}% + FCF positive — Buffett-tier capital return discipline.`);
  }

  // (F) R&D / REVENUE RATIO. Innovation reinvestment signal. In tech sector,
  //     <5% = coasting (no future pipeline); ≥15% = strong reinvestment.
  if (typeof row.rdRatio === 'number' && isTechSector) {
    if (row.rdRatio < 5) {
      forensicAdj -= 5;
      risks.push(`R&D only ${row.rdRatio.toFixed(1)}% of revenue in tech sector — no future product pipeline, coasting on legacy.`);
    } else if (row.rdRatio >= 15) {
      forensicAdj += 2;
      strengths.push(`R&D ${row.rdRatio.toFixed(1)}% of revenue — strong innovation reinvestment for tech.`);
    }
  }

  // (G) INTEREST COVERAGE (Annual). Same tier as India:
  //     ICR < 1.5 = CRITICAL distress (cap 38)
  //     ICR 1.5-3 = HIGH structural (cap 60)
  //     ICR ≥ 15 = trivial debt service (+2 bonus)
  if (typeof row.interestCoverage === 'number' && row.interestCoverage > 0) {
    if (row.interestCoverage < 1.5) {
      forensicCap = Math.min(forensicCap ?? 100, 38);
      risks.push(`🛑 CRITICAL: Interest coverage ${row.interestCoverage.toFixed(1)}× — distress, can't service debt from operating income.`);
    } else if (row.interestCoverage < 3) {
      forensicCap = Math.min(forensicCap ?? 100, 60);
      risks.push(`Interest coverage ${row.interestCoverage.toFixed(1)}× — leverage tight, EBIT barely covers interest.`);
    } else if (row.interestCoverage >= 15) {
      forensicAdj += 2;
      strengths.push(`Interest coverage ${row.interestCoverage.toFixed(0)}× — debt service trivial relative to operating income.`);
    }
  }

  // (H) NET DEBT / EBITDA. Investment-grade health: <2 safe, 3-5 stretched,
  //     >5 = leverage tight, >7 = distress.
  if (typeof row.netDebtEbitda === 'number') {
    if (row.netDebtEbitda > 7) {
      forensicCap = Math.min(forensicCap ?? 100, 50);
      risks.push(`Net debt/EBITDA ${row.netDebtEbitda.toFixed(1)}× — leverage distress zone. Cap at 50.`);
    } else if (row.netDebtEbitda > 5) {
      forensicAdj -= 5;
      risks.push(`Net debt/EBITDA ${row.netDebtEbitda.toFixed(1)}× — stretched leverage, refinancing risk.`);
    } else if (row.netDebtEbitda < 0) {
      forensicAdj += 2;
      strengths.push(`Net cash position (net debt/EBITDA ${row.netDebtEbitda.toFixed(1)}) — no debt risk.`);
    }
  }

  // (I) CASH RUNWAY. For burning growth names, runway < 18 months at current
  //     burn = CRITICAL distress (analog to "speculative pre-revenue" cap).
  if (typeof row.runwayMonths === 'number') {
    if (row.runwayMonths < 12) {
      forensicCap = Math.min(forensicCap ?? 100, 35);
      risks.push(`🛑 CRITICAL: Cash runway only ${row.runwayMonths} months at current burn rate. Forced dilution or distress imminent.`);
    } else if (row.runwayMonths < 24) {
      forensicAdj -= 8;
      risks.push(`Cash runway ${row.runwayMonths} months — needs to raise capital within ~2 years.`);
    } else if (row.runwayMonths >= 60) {
      forensicAdj += 2;
      strengths.push(`Cash runway ${row.runwayMonths > 200 ? '5+ years' : `${Math.round(row.runwayMonths/12)} years`} — financially resilient through downcycles.`);
    }
  }

  // (J) REVENUE PER EMPLOYEE — "real software economics" gate.
  //     Tech sector: <$200K/emp = labor-intensive (not real SaaS); ≥$500K = elite.
  if (typeof row.revPerEmployee === 'number' && isTechSector) {
    if (row.revPerEmployee < 200000) {
      forensicAdj -= 4;
      risks.push(`Revenue per employee $${(row.revPerEmployee/1000).toFixed(0)}K — labor-intensive for tech sector. Not real software economics.`);
    } else if (row.revPerEmployee >= 800000) {
      forensicAdj += 3;
      strengths.push(`Revenue per employee $${(row.revPerEmployee/1000).toFixed(0)}K — elite operational leverage (NVDA/AAPL tier).`);
    } else if (row.revPerEmployee >= 500000) {
      forensicAdj += 1;
    }
  }

  // (K) SUSTAINABLE GROWTH RATE vs ACTUAL GROWTH.
  //     When actual revenue growth >> sustainable growth rate for multiple
  //     years, growth is being funded by external capital (dilution/debt).
  //     Sustainable growth = ROE × (1 - payout); reflects what can be funded
  //     organically.
  if (typeof row.sustainableGrowth === 'number'
      && row.sustainableGrowth > 0
      && row.revenueGrowthAnn !== undefined
      && row.revenueGrowthAnn > row.sustainableGrowth * 2.5
      && row.sustainableGrowth < 15) {
    forensicAdj -= 4;
    risks.push(`Actual growth ${row.revenueGrowthAnn.toFixed(0)}% >> sustainable ${row.sustainableGrowth.toFixed(0)}% (organic ceiling). Excess being funded externally (dilution/debt risk).`);
  }

  // Apply forensic adjustments to score before caps
  score = Math.max(0, Math.min(100, score + forensicAdj));
  if (forensicCap !== undefined) score = Math.min(score, forensicCap);

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0340 — US-SPECIFIC SCORE CAPS & DNA BONUS
  // Inspired by the India scoring discipline (patches 0335-0339): disqualify
  // operator/speculative/hype names first, then rank the clean universe.
  // US-specific DNA differs from India:
  //   - High GPM (>50%) is the moat signature (vs India's ROCE >25%)
  //   - Rule of 40 ≥40 is the SaaS/tech premium gate (no India equivalent)
  //   - Negative R40 = burning cash with no growth justification → speculative
  //   - Stratospheric multiples (FwdPE>100, EV/EBITDA>100) = bubble pricing
  //   - Hyper-base-effect arithmetic (QoQ>200%, Ann<100%) = low-base illusion
  //   - OTC listings = lower disclosure quality vs NYSE/NASDAQ
  // ═══════════════════════════════════════════════════════════════════════════

  // (1) SPECULATIVE PRE-REVENUE / NEGATIVE-R40 CAP.
  // Names like LWLG, HGRAF, ASTS, ONDS, RCAT, HUT, AMPX, POET were scoring
  // B+/B despite massively negative R40 and pre-profit status. Cap at 45 (D-grade
  // ceiling) when R40 deeply negative + market cap >$200M (institutional radar).
  if (row.ruleOf40 !== undefined && row.ruleOf40 < -50
      && (row.marketCapB ?? 0) > 0.2) {
    score = Math.min(score, 45);
    risks.push(`Speculative cap: R40 ${row.ruleOf40.toFixed(0)} (deeply negative) + mcap $${(row.marketCapB ?? 0).toFixed(1)}B — burning cash without growth justification → capped at 45.`);
  }
  // (1b) R40 < 0 (but not catastrophic) = HIGH cyclical equivalent → cap 62.
  else if (row.ruleOf40 !== undefined && row.ruleOf40 < 0
           && (row.fcfMarginAnn ?? 0) < -15) {
    score = Math.min(score, 62);
    risks.push(`R40 ${row.ruleOf40.toFixed(0)} + FCF margin ${(row.fcfMarginAnn ?? 0).toFixed(0)}% — sub-zero growth-vs-economics → capped at 62.`);
  }

  // (2) STRATOSPHERIC MULTIPLE CAP.
  // SITM Fwd P/E 108× EV/EBITDA 4351×, OSS Fwd P/E 1555×, SEDG Fwd P/E 4712×
  // were scoring B/C despite obvious bubble pricing. Cap at 60 unless R40 ≥ 60
  // (genuinely premium-justified by elite growth-plus-economics).
  const elitePremium = (row.ruleOf40 ?? 0) >= 60;
  if (!elitePremium && (
        (row.forwardPe !== undefined && row.forwardPe > 100)
        || (row.evEbitda !== undefined && row.evEbitda > 100)
        || (row.pe !== undefined && row.pe > 150)
      )) {
    score = Math.min(score, 60);
    risks.push(`Stratospheric multiple cap: ${row.forwardPe ? `FwdPE ${row.forwardPe.toFixed(0)}×` : ''}${row.evEbitda && row.evEbitda > 100 ? ` EV/EBITDA ${row.evEbitda.toFixed(0)}×` : ''} without elite R40 → capped at 60.`);
  }

  // (3) HYPER-BASE-EFFECT DETECTOR.
  // POET "QoQ +1075% Ann +2495%", T1 Energy "R40:25574", SNDK "QoQ +251% Ann +10%"
  // are arithmetic illusions, not real acceleration. When QoQ >200% AND
  // annual <100%, the QoQ is base-effect noise. Don't credit ACCELERATING signal.
  const baseEffect = (row.revenueGrowthQtr ?? 0) > 200 && (row.revenueGrowthAnn ?? 999) < 100;
  if (baseEffect) {
    score = Math.min(score, 65);
    risks.push(`Base-effect arithmetic: QoQ ${row.revenueGrowthQtr?.toFixed(0)}% + Annual ${row.revenueGrowthAnn?.toFixed(0)}% — QoQ surge is low-base math, not real acceleration → capped at 65.`);
  }

  // (4) OTC LISTING PENALTY.
  // HGRAF, AEGXF, NSKFF, ATZAF, ABXXF, PRBZF, DAIUF, CPXWF are OTC-listed
  // (often foreign or ADRs). Lower disclosure quality vs NYSE/NASDAQ. Cap at 78.
  const isOTC = (row.exchange || '').toUpperCase().includes('OTC');
  if (isOTC) {
    score = Math.min(score, 78);
    risks.push(`OTC listing: lower disclosure quality vs NYSE/NASDAQ → capped at 78. Verify foreign-filing equivalents (20-F, 6-K).`);
  }

  // (5) TECH/SOFTWARE-WITHOUT-MARGIN CAP.
  // Software/tech companies should have GPM > 40% (real software co). When
  // GPM < 30% in a tech-classified sector, it's not a real SaaS/software co —
  // it's hardware-services or reseller masquerading as tech. Cap at 65.
  const isTech = /TECHNOLOGY|SOFTWARE|SAAS|INTERNET|SEMICONDUCT/i.test(row.sector || '');
  const effGM = row.grossMarginTtm ?? row.grossMarginAnn;
  if (isTech && effGM !== undefined && effGM < 30 && (row.marketCapB ?? 0) > 0.5) {
    score = Math.min(score, 65);
    risks.push(`Tech without margin: sector=${row.sector} but GPM ${effGM.toFixed(0)}% — not a real software economics co → capped at 65.`);
  }

  // (6) LOW-COVERAGE CAP.
  // When coverage <60% AND score >70, don't over-credit incomplete data.
  // HGRAF, ABXXF, OTC names often have 40-50% coverage.
  if (coverage < 60 && score > 70) {
    score = Math.min(score, 70);
    risks.push(`Low data coverage ${coverage}% — score capped at 70 until more columns added (need GPM, ROIC, FCF margin minimum).`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // (7) US 100-BAGGER DNA BONUS — Phelps/Mayer canonical pattern.
  // Tom Phelps "100 to 1 in the Stock Market" + Christopher Mayer "100 Baggers":
  // every US 100-bagger had this DNA at its setup point. Two flavors:
  //
  //   SaaS PREMIUM DNA (NVDA early, CRM early, NOW, MSFT):
  //     Rule of 40 ≥ 40  +  GPM ≥ 60  +  Rev growth ≥ 20  +  FCF margin ≥ 10
  //
  //   BUFFETT COMPOUNDER DNA (BRK, JNJ, KO, COST, HD long-run):
  //     ROE ≥ 18  +  ROIC ≥ 15  +  FCF margin ≥ 15  +  D/E < 0.5  +  Rev growth ≥ 12
  //
  // Either flavor → +6 reratingBonus equivalent (apply as score boost).
  // Gate: no speculative/stratospheric/base-effect cap fired above.
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0349a — FCF / OPERATING-INCOME DIVERGENCE DETECTOR.
  // When FCF margin >> Operating margin (ratio > 2.0×) AND net margin < 15%,
  // FCF is almost certainly inflated by working-capital release, SBC add-back,
  // or deferred-revenue / customer-prepayment swing — not sustainable economics.
  // Real-world failure: PAYS scored 90 A+ with FCF margin 54% on Op margin 9%
  // (6× ratio) and dropped 16% after Q1 earnings. The SaaS DNA bonus + Elite
  // R40 bonus were both awarded to a row where FCF was an accrual artifact.
  // Action: suppress R40 / DNA bonuses (via noSpeculativeCap gate) AND cap
  // composite at 70 at the end of the cap chain.
  // ═══════════════════════════════════════════════════════════════════════════
  const fcfOpDivergence = (
       row.fcfMarginAnn !== undefined && row.fcfMarginAnn > 0
    && row.opmTtm !== undefined && row.opmTtm > 0
    && row.fcfMarginAnn / Math.max(row.opmTtm, 1) > 2.0
    && (row.netProfitMargin ?? 0) < 15
  );
  if (fcfOpDivergence) {
    const ratio = (row.fcfMarginAnn! / Math.max(row.opmTtm!, 1)).toFixed(1);
    risks.push(`🚨 FCF/Op-Income divergence: FCF margin ${row.fcfMarginAnn!.toFixed(0)}% but Op margin ${row.opmTtm!.toFixed(0)}% (ratio ${ratio}×) — FCF likely inflated by working-capital release / SBC add-back / deferred revenue, not sustainable from operations. R40 / DNA bonuses suppressed. Capped at 70.`);
  }

  const noSpeculativeCap = !(row.ruleOf40 !== undefined && row.ruleOf40 < -50)
                        && !baseEffect
                        && !(row.forwardPe !== undefined && row.forwardPe > 100 && !elitePremium)
                        && !fcfOpDivergence;
  const saasDna =
       (row.ruleOf40 ?? 0) >= 40
    && (effGM ?? 0) >= 60
    && (row.revenueGrowthAnn ?? 0) >= 20
    && (row.fcfMarginAnn ?? 0) >= 10;
  const buffettDna =
       (row.roe ?? 0) >= 18
    && (row.roic ?? 0) >= 15
    && (row.fcfMarginAnn ?? 0) >= 15
    && (row.de ?? 99) < 0.5
    && (row.revenueGrowthAnn ?? 0) >= 12;
  if (noSpeculativeCap && (saasDna || buffettDna)) {
    score = Math.min(100, score + 6);
    if (saasDna) strengths.push(`💎 SaaS PREMIUM DNA: R40 ${row.ruleOf40?.toFixed(0)} + GPM ${effGM?.toFixed(0)}% + Rev growth ${row.revenueGrowthAnn?.toFixed(0)}% + FCF margin ${row.fcfMarginAnn?.toFixed(0)}% — NVDA/CRM/NOW canonical setup. +6 DNA bonus.`);
    if (buffettDna && !saasDna) strengths.push(`💎 BUFFETT COMPOUNDER DNA: ROE ${row.roe?.toFixed(0)}% + ROIC ${row.roic?.toFixed(0)}% + FCF margin ${row.fcfMarginAnn?.toFixed(0)}% + D/E ${row.de?.toFixed(2)} + growth ${row.revenueGrowthAnn?.toFixed(0)}% — Berkshire/JNJ/KO long-compounder setup. +6 DNA bonus.`);
  } else if (noSpeculativeCap && (
              ((row.ruleOf40 ?? 0) >= 30 && (effGM ?? 0) >= 50 && (row.revenueGrowthAnn ?? 0) >= 15)
              || ((row.roe ?? 0) >= 15 && (row.roic ?? 0) >= 12 && (row.fcfMarginAnn ?? 0) >= 10)
            )) {
    score = Math.min(100, score + 3);
    strengths.push(`Strong DNA partial-match: 4/5 quality signals aligned → +3 bonus.`);
  }

  // (8) ELITE-R40 BONUS — overrides stratospheric cap when truly premium.
  // R40 ≥ 80 = elite (NVDA, PLTR-style hypergrowth-with-economics). Soft +5
  // bonus even past caps. ASTERA LABS, PLTR-quality names.
  // PATCH 0612 — FCF triple-count de-dup. SaaS/Buffett DNA both gate on
  // fcfMarginAnn and award +6; Elite R40 implicitly uses FCF via the
  // R40 = growth + FCF formula. Letting both fire stacks +11 on the same
  // FCF data point (PAYS pattern: 54% FCF → +6 DNA + +5 R40 + qual pillar).
  // When DNA already fired we either skip Elite R40 entirely or halve it.
  if ((row.ruleOf40 ?? 0) >= 80 && (effGM ?? 0) >= 40 && noSpeculativeCap) {
    if (saasDna || buffettDna) {
      // Already credited via DNA bonus. Soft +2 acknowledgement only
      // (gives a touch of premium for genuinely elite R40 ≥ 90).
      if ((row.ruleOf40 ?? 0) >= 90) {
        score = Math.min(100, score + 2);
        strengths.push(`Elite R40 ${row.ruleOf40?.toFixed(0)} — +2 acknowledgement on top of DNA bonus (de-dup: FCF margin already credited).`);
      }
    } else {
      score = Math.min(100, score + 5);
      strengths.push(`Elite R40 ${row.ruleOf40?.toFixed(0)} with ${effGM?.toFixed(0)}% GPM — top-decile growth-plus-economics. +5 bonus.`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0343 — FINAL ENFORCEMENT CAPS (applied AFTER bonuses to bind hard).
  // Audit of deployed output found multiple operator/sub-multibagger-DNA names
  // scoring A+/A despite obvious failure on the core growth-multibagger gates.
  // ═══════════════════════════════════════════════════════════════════════════

  // (9) RULE OF 40 TIERED HARD CAPS.
  // For a US multibagger engine, R40 is THE primary growth-stock-economics
  // gate. Old code only warned when R40<20; the deployed output showed
  // CXW R40=15→80A+, GCT R40=25→85A+, VMD R40=25→80A+, TER R40=27→80A+,
  // STRL R40=32→80A+, ELA R40=34→85A+, UAN R40=32→85A+. All wrong for
  // multibagger thesis. Tiered hard caps:
  //   R40 < 10  → cap 55 (B max)
  //   R40 < 20  → cap 65 (B/B+ boundary)
  //   R40 < 30  → cap 72 (B+ ceiling, no A grades)
  //   R40 < 40  → cap 78 (A ceiling, no A+ grades)
  // Names with elite R40 (≥80) bypass these caps via the elite-R40 bonus.
  // PATCH 1101dd — extend cap to negative R40 territory. User feedback:
  // stocks with R40 -3000 (ABSI) still grading D-only at 25, but stocks with
  // R40 -500 (PLUG, RIOT) were sitting at 45 (C). Negative R40 = burning cash
  // faster than growing — should be progressively harder caps.
  if (row.ruleOf40 !== undefined) {
    if (row.ruleOf40 < -200)      score = Math.min(score, 15);  // NEVER BUY territory
    else if (row.ruleOf40 < -50)  score = Math.min(score, 25);  // D floor
    else if (row.ruleOf40 < 0)    score = Math.min(score, 40);  // C/D boundary
    else if (row.ruleOf40 < 10)   score = Math.min(score, 55);
    else if (row.ruleOf40 < 20)   score = Math.min(score, 65);
    else if (row.ruleOf40 < 30)   score = Math.min(score, 72);
    else if (row.ruleOf40 < 40)   score = Math.min(score, 78);
    if (row.ruleOf40 < -50) risks.push(`🛑 Rule of 40: ${row.ruleOf40.toFixed(0)} — catastrophic (burning cash >${Math.abs(row.ruleOf40).toFixed(0)}% faster than growing). NEVER BUY territory.`);
  }

  // (9b) PATCH 1101dd — REVENUE-INFLATION ARCHETYPE (USA C7 equivalent).
  // Signature: massive annual growth (>200%) + no profit + huge mcap. This
  // catches ASTS (Ann +1505%, $51B mcap, 0% profit), reverse-merger pumps,
  // pre-revenue SPACs trading on narrative. India's C7 rule (PATCH 1101j)
  // has caught Rajesh Exports etc. for years; USA lacked the equivalent.
  const isRevInflationRisk =
       (row.revenueGrowthAnn ?? 0) > 200
    && (row.marketCapB ?? 0) > 10
    && ((row.netProfitMargin ?? 0) <= 0 || (row.opmTtm ?? row.opmAnn ?? 0) < 5);
  if (isRevInflationRisk) {
    score = Math.min(score, 35);
    risks.push(`🛑 NEVER BUY: Revenue-inflation archetype — ${(row.revenueGrowthAnn ?? 0).toFixed(0)}% growth · $${(row.marketCapB ?? 0).toFixed(0)}B mcap · NPM ${(row.netProfitMargin ?? 0).toFixed(1)}% · OPM ${(row.opmTtm ?? row.opmAnn ?? 0).toFixed(1)}%. Classic ASTS / Rajesh-Exports pattern — narrative-driven mcap on unprofitable growth. Cap 35.`);
  }

  // (9c) PATCH 1101dd — CFO/PAT EARNINGS-WITHOUT-CASH (USA C1 equivalent).
  // Crypto miners (PLUG, RIOT, CLSK) report revenue but burn cash. India's
  // C1 rule catches CFO/PAT < -0.3 as critical fraud signal. USA lacked it
  // because we don't always have cfoToPat in TradingView export — use FCF
  // margin + net margin divergence as a proxy when cfoToPat is missing.
  // FCF margin <<< Net profit margin (gap >15pp with NPM >0) = accrual quality concern.
  if (typeof (row as any).cfoToPat === 'number') {
    const cp = (row as any).cfoToPat as number;
    if (cp < -0.3) {
      score = Math.min(score, 35);
      risks.push(`🛑 CFO/PAT ${cp.toFixed(2)} — earnings without cash (operating cash flow strongly negative vs reported PAT). Critical fraud signal. Cap 35.`);
    } else if (cp < 0.3 && (row.revenueGrowthAnn ?? 0) > 20) {
      risks.push(`⚠️ CFO/PAT ${cp.toFixed(2)} weak vs ${(row.revenueGrowthAnn ?? 0).toFixed(0)}% revenue growth — working capital may be inflating; growth quality suspect.`);
    }
  } else if (
       (row.netProfitMargin ?? 0) > 0
    && ((row.fcfMarginAnn ?? row.fcfMarginTtm ?? 999) < 0)
    && ((row.fcfMarginAnn ?? row.fcfMarginTtm ?? 999) < (row.netProfitMargin ?? 0) - 25)
  ) {
    // PATCH 1101gg — Relaxed FCF-vs-NPM divergence cap. Previous threshold
    // (gap >15pp) was firing on capital-intensive sectors (shipping, capex,
    // utilities) where FCF margin is structurally lower than NPM due to
    // sustained capex. LPG (Dorian) dropped 90→60 incorrectly. Now require
    // BOTH (a) FCF margin is actually NEGATIVE (real cash burn) AND
    // (b) gap >25pp from NPM. Cap raised 60→75 (still a warning, not a kill).
    score = Math.min(score, 75);
    risks.push(`⚠️ FCF-margin proxy: NPM ${(row.netProfitMargin ?? 0).toFixed(1)}% but FCF margin ${(row.fcfMarginAnn ?? row.fcfMarginTtm ?? 0).toFixed(1)}% NEGATIVE (gap >25pp) — reported profit not converting to cash. Accrual quality concern. Cap 75.`);
  }

  // (10) GROWTH-RATE HARD CAPS.
  // Multibagger thesis fundamentally requires meaningful base growth (15-20%+
  // sustained). Below 15% annual = "value pick" not multibagger. Below 10% =
  // mature/declining. Don't let momentum or quality push these to A+.
  //   Growth < 10% → cap 55 (B max)
  //   Growth < 15% → cap 70 (B+ ceiling)
  if (row.revenueGrowthAnn !== undefined) {
    if (row.revenueGrowthAnn < 10)       score = Math.min(score, 55);
    else if (row.revenueGrowthAnn < 15)  score = Math.min(score, 70);
  }

  // (11) CYCLE-PEAK SPIKE DETECTOR (US equivalent of India 0337).
  // When annual revenue growth > 1.5× the 3yr CAGR AND 3yr CAGR <15%, the
  // recent growth is a cyclical spike from a low base — not sustainable
  // compounding. Cap at 72 (B+ ceiling). Catches ELA (34% annual vs 16% 3yr),
  // STRL (18% vs 0% 3yr), WDC (51% vs -11% 3yr), TER (13% vs 0% 3yr).
  if (row.revenueGrowthAnn !== undefined && row.revGrowth3yr !== undefined
      && row.revGrowth3yr < 15
      && row.revenueGrowthAnn > row.revGrowth3yr * 1.8
      && row.revenueGrowthAnn > 15) {
    score = Math.min(score, 72);
    risks.push(`Cycle-peak / base-effect cap: annual growth ${row.revenueGrowthAnn.toFixed(0)}% is ${(row.revenueGrowthAnn/Math.max(row.revGrowth3yr,1)).toFixed(1)}× the 3yr CAGR ${row.revGrowth3yr.toFixed(0)}% — recent surge unlikely to sustain. Capped at 72.`);
  }

  // (12) SELL / STRONG SELL ANALYST RATING — HARD CAP at 50.
  // Old code only -10 mktS; that's insufficient for a US engine. Analyst
  // "Sell" or "Strong Sell" reflects professional community broadly negative.
  // Cap composite at 50 (C/D boundary). Caught: FCEL (Sell rating + R40 -50
  // but still scored 60 B+ — that's wrong).
  if (row.analystRating) {
    const rt = row.analystRating.toLowerCase();
    if (rt.includes('strong sell')) {
      score = Math.min(score, 38);
      risks.push(`Analyst consensus 'Strong Sell' — composite hard-capped at 38 (D-grade). Professional community broadly negative.`);
    } else if (rt.includes('sell')) {
      score = Math.min(score, 50);
      risks.push(`Analyst consensus 'Sell' — composite hard-capped at 50 (C-grade). Professional community sees downside risk.`);
    }
  }

  // (13) ABSOLUTE OTC CAP — re-apply at the end so elite-R40 bonus can't
  // bypass it. Deployed output showed ATZAF (OTC) scored 80A+ despite cap 78.
  if (isOTC) score = Math.min(score, 78);

  // (14) ABSOLUTE GOVERNANCE CRITICAL CAPS — re-apply after bonuses.
  // R40 catastrophic (< -50) speculative cap (set in section 1) and CRITICAL
  // ICR (set in forensic section) must bind absolutely. If they were set,
  // we already applied them in those sections; re-apply here in case any
  // subsequent bonus pushed score back up.
  if (row.ruleOf40 !== undefined && row.ruleOf40 < -50
      && (row.marketCapB ?? 0) > 0.2) {
    score = Math.min(score, 45);
  }
  if (typeof row.interestCoverage === 'number' && row.interestCoverage > 0
      && row.interestCoverage < 1.5) {
    score = Math.min(score, 38);
  }
  if (typeof row.runwayMonths === 'number' && row.runwayMonths < 12) {
    score = Math.min(score, 35);
  }
  if (typeof row.piotroskiFScore === 'number' && row.piotroskiFScore <= 2) {
    score = Math.min(score, 50);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0349a — ABSOLUTE FCF/OP-INCOME DIVERGENCE CAP (re-apply post bonus).
  // Even with all bonuses applied, a row with inflated FCF cannot score above 70.
  // ═══════════════════════════════════════════════════════════════════════════
  if (fcfOpDivergence) score = Math.min(score, 70);

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0349b — POST-RUN REVERSAL CAP.
  // When 1yr return > 100% AND forward P/E > 25 (or P/E > 30 absent forward),
  // stock is priced for perfection. Any disappointment → 15-20% retrace.
  // Mean-reversion drag historically -15% to -20% from these setups. Caught:
  // PAYS (+138% past year, FwdPE 28×, dropped 16% post-earnings). The engine
  // was treating "+138% past year — momentum confirming fundamentals" as a
  // STRENGTH; it's actually a setup for mean reversion.
  // ═══════════════════════════════════════════════════════════════════════════
  const effPEForCap = row.forwardPe ?? row.pe;
  const postRunStretched =
       (row.perf1y ?? 0) > 100
    && effPEForCap !== undefined
    && effPEForCap > (row.forwardPe !== undefined ? 25 : 30);
  if (postRunStretched) {
    score = Math.min(score, 75);
    risks.push(`🌡 STRETCHED post-run: +${row.perf1y!.toFixed(0)}% in 12mo at ${row.forwardPe !== undefined ? `FwdPE ${row.forwardPe.toFixed(0)}×` : `P/E ${row.pe!.toFixed(0)}×`} — priced for perfection. Mean-reversion drag historically -15-20% from this setup. Capped at 75.`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0349d — EARNINGS-PROXIMITY WARNING (display + risk bullet).
  // If next earnings is within 7 calendar days, raise an EARNINGS WEEK risk.
  // Institutional desks routinely halve position size in this window because
  // gap risk is structurally elevated. Doesn't change score, just surfaces the
  // timing risk so the user can decide to wait for the print.
  // ═══════════════════════════════════════════════════════════════════════════
  let earningsProximityDays: number | undefined;
  if (row.nextEarnings) {
    const d = new Date(row.nextEarnings);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      // Compare at day granularity to avoid hour-of-day flutter
      const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const nDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      earningsProximityDays = Math.round((dDate.getTime() - nDate.getTime()) / 86400000);
    }
  }
  if (earningsProximityDays !== undefined && earningsProximityDays >= 0 && earningsProximityDays <= 7) {
    risks.push(`⚠ EARNINGS in ${earningsProximityDays} day${earningsProximityDays===1?'':'s'} (${row.nextEarnings}) — gap risk elevated; institutional desks halve position size in this window. Consider waiting for the print.`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0754 — STALE-FUNDAMENTALS-VS-FRESH-PRICE DETECTOR.
  // When the company's earnings date has passed (the CSV was downloaded before
  // the next earnings release) AND the price has moved materially (>15% in
  // either direction over the last year), the row's fundamentals are likely
  // out-of-sync with the current price. Surface as a risk + soft composite
  // cap so a stale-data row doesn't grade A+ on outdated metrics.
  //
  // The user explicitly called this out: "Stale-fundamentals-vs-fresh-price
  // detector" (CLAUDE.md §10.10 open work). Doesn't fail safe — just nudges
  // the user to re-upload current CSV.
  // ═══════════════════════════════════════════════════════════════════════════
  if (earningsProximityDays !== undefined && earningsProximityDays < 0) {
    const movedMaterially = Math.abs(row.perf1y ?? 0) >= 15;
    const daysStale = Math.abs(earningsProximityDays);
    if (movedMaterially && daysStale >= 30) {
      risks.push(`🕒 STALE DATA: nextEarnings date ${row.nextEarnings} was ${daysStale}d ago AND 1Y perf ${row.perf1y!.toFixed(0)}% — CSV likely reflects pre-results figures, not current state. Re-upload from TradingView before sizing.`);
      score = Math.min(score, 75);
    } else if (movedMaterially) {
      // Not yet 30d stale, just a soft warning
      risks.push(`⏱ Verify freshness: nextEarnings date ${row.nextEarnings} has passed and price moved ${row.perf1y!.toFixed(0)}% over 1Y — confirm CSV is post-results before sizing.`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH 0349e — POSITION-SIZE GUIDANCE (display only, no score impact).
  // Microcap volatility is structurally 2-3× large-cap. A "score 90" microcap
  // and "score 90" megacap are NOT equivalent risk-adjusted bets. Render a
  // suggested max position size based on market cap so position-sizing is
  // visible alongside conviction.
  // ═══════════════════════════════════════════════════════════════════════════
  let suggestedMaxPositionPct: number | undefined;
  const mcapBForPos = row.marketCapUsd !== undefined ? row.marketCapUsd / 1e9 : row.marketCapB;
  if (mcapBForPos !== undefined) {
    if (mcapBForPos < 0.5)       suggestedMaxPositionPct = 1.5;
    else if (mcapBForPos < 1.0)  suggestedMaxPositionPct = 2.5;
    else if (mcapBForPos < 5.0)  suggestedMaxPositionPct = 5.0;
    else if (mcapBForPos < 20.0) suggestedMaxPositionPct = 8.0;
    else                          suggestedMaxPositionPct = 15.0;
    // PATCH 1101rr — LIQUIDITY-AWARE ADJUSTMENT. Reduce Max % when average
    // daily $ volume is too low for the implied position to be filled without
    // slippage. Institutional rule: position size ≤ 5% of 30-day ADV implies
    // ~5 days to fill without market impact.
    if (typeof row.avgDailyValueUsdM === 'number' && row.avgDailyValueUsdM > 0) {
      let adv = row.avgDailyValueUsdM;
      let liqCap: number | undefined;
      if (adv < 1)      liqCap = 0.5;
      else if (adv < 5)  liqCap = 1.5;
      else if (adv < 20) liqCap = 3.0;
      else if (adv < 50) liqCap = 5.0;
      else if (adv < 200) liqCap = 8.0;
      if (liqCap !== undefined && liqCap < suggestedMaxPositionPct) {
        const wasOriginal = suggestedMaxPositionPct;
        suggestedMaxPositionPct = liqCap;
        risks.push(`💧 Liquidity-capped: avg daily $ volume only $${adv.toFixed(1)}M → max position reduced ${wasOriginal}% → ${liqCap}% (5%-of-ADV rule).`);
      }
    }
    // PATCH 1101rr — BETA-AWARE ADJUSTMENT. High-beta names get smaller max.
    if (typeof row.beta5y === 'number' && row.beta5y >= 1.5) {
      const betaFactor = 1 / Math.sqrt(row.beta5y);
      const adjusted = Math.max(1.0, Math.round(suggestedMaxPositionPct * betaFactor * 10) / 10);
      if (adjusted < suggestedMaxPositionPct) {
        suggestedMaxPositionPct = adjusted;
      }
    }
  }

  // PATCH 0344 — Use Math.floor(score/5)*5 instead of Math.round(score/5)*5.
  // Old Math.round meant cap=78 would round UP to 80 (jumping the A-grade
  // boundary at >=80), bypassing the cap. Visible bugs in deployed output:
  //   ATZAF (OTC cap 78) → 80 A+
  //   UAN, STRL (R40<40 cap 78) → 80 A+
  //   VMD (R40<30 cap 72) → 70 (correct) but grade A+ shows (stale render?)
  //   Cap 72 was nondeterministically rounding to 70 or 75
  // Math.floor ensures caps bind exactly. 78 stays 75. 72 stays 70.
  score = Math.max(0, Math.min(100, Math.floor(score/5)*5));

  // Grade
  const grade: USAGrade = score>=90?'A+':score>=80?'A':score>=68?'B+':score>=55?'B':score>=42?'C':'D';

  // Recompute derived fields every time — fixes stale localStorage data where
  // these were undefined because they were added after the original upload.
  //
  // PATCH 0346 — Rule of 40 now uses QUARTERLY revenue growth (QoQ YoY) +
  // FCF margin, per user spec. This is the forward-looking R40 variant used
  // by SaaS investors: gives a more current run-rate view than annual.
  // Falls back to annual if quarterly is missing.
  const r40RevInput = row.revenueGrowthQtr ?? row.revenueGrowthAnn;
  const computedRuleOf40 = (r40RevInput !== undefined && row.fcfMarginAnn !== undefined)
    ? Math.round(r40RevInput + row.fcfMarginAnn)
    : row.ruleOf40;
  // Gross margin expansion: TTM vs Annual. If user only has TTM (new CSV format),
  // expansion can't be computed — returns undefined (handled gracefully in scoring).
  const computedGMExpansion = (row.grossMarginTtm !== undefined && row.grossMarginAnn !== undefined
                                && row.grossMarginTtm !== row.grossMarginAnn)
    ? Math.round((row.grossMarginTtm - row.grossMarginAnn) * 10) / 10
    : row.grossMarginExpansion;

  // PATCH 1101qq — derived metrics from new TV fields.
  // RS RATING (O'Neil-style 1-99) — weighted 3-horizon momentum.
  // Weights: 40% × 6M + 30% × 3M + 30% × 1Y. Then normalize to 1-99 scale.
  let rsRating: number | undefined = undefined;
  if (typeof row.perf3m === 'number' || typeof row.perf6m === 'number' || typeof row.perf1y === 'number') {
    const p3 = row.perf3m ?? row.perf1y ?? 0;
    const p6 = row.perf6m ?? row.perf1y ?? 0;
    const p12 = row.perf1y ?? 0;
    const composite = 0.30 * p3 + 0.40 * p6 + 0.30 * p12;
    // Map roughly: -50% → 1, 0% → 30, 50% → 70, 100%+ → 90+
    const rs = Math.max(1, Math.min(99, Math.round(50 + composite * 0.5)));
    rsRating = rs;
    if (rs >= 80) strengths.push(`🚀 RS Rating ${rs} — top 20% momentum (3M ${p3.toFixed(0)}% · 6M ${p6.toFixed(0)}% · 1Y ${p12.toFixed(0)}%)`);
    else if (rs <= 20) risks.push(`⚠️ RS Rating ${rs} — bottom 20% momentum, name is being sold`);
    score = Math.round(score + Math.min(6, Math.max(-6, (rs - 50) / 10)));
  }
  // FORWARD PEG — Forward P/E ÷ forward EPS growth %
  let forwardPeg: number | undefined = undefined;
  if (row.forwardPe && row.forwardPe > 0 && row.epsEstimateAnnual !== undefined) {
    // Need current EPS to compute forward growth
    const currentEps = row.pe && row.price ? row.price / row.pe : undefined;
    if (currentEps && currentEps > 0) {
      const fwdGrowth = ((row.epsEstimateAnnual - currentEps) / currentEps) * 100;
      if (fwdGrowth > 0) {
        forwardPeg = Math.round((row.forwardPe / fwdGrowth) * 100) / 100;
        if (forwardPeg < 1) strengths.push(`Forward PEG ${forwardPeg.toFixed(2)} — undervalued vs expected EPS growth ${fwdGrowth.toFixed(0)}%`);
        else if (forwardPeg > 3) risks.push(`Forward PEG ${forwardPeg.toFixed(2)} — expensive vs expected growth`);
      }
    }
  }
  // IMPLIED UPSIDE % from target price
  let impliedUpsidePct: number | undefined = undefined;
  if (row.targetPrice1y && row.price && row.price > 0) {
    impliedUpsidePct = Math.round(((row.targetPrice1y - row.price) / row.price) * 100);
    if (impliedUpsidePct >= 30) strengths.push(`🎯 Analyst target ${impliedUpsidePct}% above current — institutional consensus bullish`);
    else if (impliedUpsidePct <= -10) risks.push(`Analyst target ${impliedUpsidePct}% below current — consensus thinks it's overpriced`);
  }
  // EPS ACCELERATION — Quarterly EPS growth vs Annual EPS growth
  let epsAcceleration: number | undefined = undefined;
  if (typeof row.epsGrowthQtr === 'number' && typeof row.epsGrowth === 'number') {
    epsAcceleration = Math.round(row.epsGrowthQtr - row.epsGrowth);
    if (epsAcceleration >= 20) strengths.push(`⚡ EPS Q-accel +${epsAcceleration}pp vs annual — earnings inflection accelerating`);
    else if (epsAcceleration <= -20) risks.push(`EPS Q-decel ${epsAcceleration}pp — earnings momentum stalling`);
  }
  // STAGE 2 TREND DETECTOR (Weinstein) — Price > EMA200 AND EMA50 > EMA200 AND 1Y perf > 0
  let stage2: boolean | undefined = undefined;
  if (row.price && row.ema50 && row.ema200) {
    stage2 = row.price > row.ema200 && row.ema50 > row.ema200 && (row.perf1y ?? 0) > 0;
    if (stage2) strengths.push(`📈 Stage 2 uptrend confirmed (Price > EMA200 · EMA50 > EMA200 · 1Y+)`);
  }
  // BETA-ADJUSTED MAX % — scale suggested max position by 1/sqrt(beta)
  // High beta → smaller position. Beta 1.0 → no adjustment. Beta 2.0 → 70% of base.
  if (typeof row.beta5y === 'number' && row.beta5y > 0) {
    if (row.beta5y >= 2.0) risks.push(`⚠️ Beta ${row.beta5y.toFixed(1)} — 2× market volatility, halve normal position size`);
    else if (row.beta5y <= 0.7) strengths.push(`Beta ${row.beta5y.toFixed(1)} — low market sensitivity, defensive`);
  }
  // EBITDA MARGIN BOOST for capital-intensive sectors where FCF is structurally low.
  if (typeof row.ebitdaMargin === 'number') {
    if (row.ebitdaMargin >= 30) strengths.push(`EBITDA margin ${row.ebitdaMargin.toFixed(0)}% — elite operational leverage`);
    else if (row.ebitdaMargin < 10) risks.push(`EBITDA margin ${row.ebitdaMargin.toFixed(0)}% — thin operational profitability`);
  }
  // CAPEX INTENSITY — Capex/Revenue or Capex/FCF check
  let capexIntensityPct: number | undefined = undefined;
  if (typeof row.capexPerShareTtm === 'number' && typeof row.fcfPerShareTtm === 'number'
      && row.fcfPerShareTtm > 0) {
    capexIntensityPct = Math.round((row.capexPerShareTtm / (row.capexPerShareTtm + row.fcfPerShareTtm)) * 100);
    // High capex+positive FCF = growth investment (good).
    // High capex+negative FCF = capital destruction (bad - already handled elsewhere).
    if (capexIntensityPct > 40 && row.fcfPerShareTtm > 0) {
      strengths.push(`Capex intensity ${capexIntensityPct}% — heavy reinvestment with positive FCF = growth phase`);
    }
  }
  return {
    ...row,
    score, grade, coverage,
    ruleOf40: computedRuleOf40,
    grossMarginExpansion: computedGMExpansion,
    revenueAccel: revAccel,
    accelSignal: revAccel !== undefined ? (revAccel>=5?'ACCELERATING':revAccel<=-5?'DECELERATING':'STABLE') : row.accelSignal,
    rsRating,
    forwardPeg,
    impliedUpsidePct,
    epsAcceleration,
    stage2,
    capexIntensityPct,
    marketCapB: row.marketCapUsd !== undefined ? Math.round(row.marketCapUsd/1e9*100)/100 : row.marketCapB,
    strengths, risks,
    // PATCH 0349 — surfaced flags for chip rendering in JSX
    fcfOpDivergence,
    postRunStretched,
    earningsProximityDays,
    suggestedMaxPositionPct,
    pillarScores: [
      {id:'QUALITY',   label:'Quality',    score:Math.round(qual),   color:'#a78bfa'},
      {id:'GROWTH',    label:'Growth',     score:Math.round(growth), color:'#38bdf8'},
      {id:'ACCEL',     label:'Accel',      score:Math.round(accel),  color:'#10b981'},
      {id:'VALUATION', label:'Valuation',  score:Math.round(val),    color:'#f59e0b'},
      {id:'MARKET',    label:'Market',     score:Math.round(mkt),    color:'#f97316'},
    ],
  };
}

export type USAResult = ReturnType<typeof scoreUSARow>;

export function applyUSARanking(results: USAResult[]): USAResult[] {
  if (!results.length) return results;
  // PATCH 0344 — REWRITTEN. Old logic reassigned grade by percentile rank
  // ("top 10% always A+"), which OVERROAD the score-based grade computed in
  // scoreUSARow. Visible bugs in deployed output:
  //   VMD at score 70 displayed as A+ (top 10% by rank, but score is B+ territory)
  //   UAN, ATZAF at score 80 displayed as A+ (rank-pushed past score)
  //   PLTR at score 95 displayed as B+ (mcap>150B downgrade was forcing this)
  //
  // New: use the SCORE-BASED grade (which already respects all the caps from
  // Patch 0340-0343). Apply only hard-cap grade adjustments for cases where
  // we want to demote regardless of pillar score: mega-cap (limited 100x
  // runway from here), sub-10% growth, decelerating revenue.
  // PATCH 0453 P1-17 — Audit found these downgrade rules didn't compound:
  // each cap only triggered on A+/A, so a stock that's mega-cap AND
  // sub-10% growth AND decelerating only got demoted once (to B+).
  // Now each rule walks the grade down one step, so triple-flag rows
  // land at B or C as intended.
  const GRADE_ORDER: USAGrade[] = ['A+', 'A', 'B+', 'B', 'C', 'D'];
  const downgrade = (g: USAGrade, steps: number): USAGrade => {
    const idx = GRADE_ORDER.indexOf(g);
    if (idx < 0) return g;
    return GRADE_ORDER[Math.min(GRADE_ORDER.length - 1, idx + steps)];
  };

  // PATCH 1101dd — FORCED PERCENTILE RANKING (parity with India scorer).
  // OLD: only categorical demotions (mega-cap, sub-10% growth, decel). Result:
  // 450-stock cohort clustered as B (214), C (147), B+ (41) — only 11 stocks
  // in the entire A/A+ band. Distribution did not match India (which uses
  // forced ranking → bell curve).
  // NEW: enforce same percentile bands India uses:
  //   A+ ≤ 10%, A ≤ 28%, B+ ≤ 55%, B ≤ 75%, C ≤ 88%, D > 88%
  // This is applied ON TOP OF the absolute-score grade; we take the WORSE of
  // the two so a score-cap (e.g., R40 < -200 forces D at score 15) is never
  // un-done by percentile rank.
  const sorted = [...results]
    .map((r, idx) => ({ r, idx, s: r.score ?? 0 }))
    .sort((a, b) => b.s - a.s);
  const n = sorted.length;
  const cutA_PLUS = Math.floor(n * 0.10);
  const cutA      = Math.floor(n * 0.28);
  const cutBPLUS  = Math.floor(n * 0.55);
  const cutB      = Math.floor(n * 0.75);
  const cutC      = Math.floor(n * 0.88);

  const rankGradeByIdx = new Map<number, USAGrade>();
  sorted.forEach((entry, rank) => {
    let g: USAGrade;
    if (rank < cutA_PLUS)      g = 'A+';
    else if (rank < cutA)      g = 'A';
    else if (rank < cutBPLUS)  g = 'B+';
    else if (rank < cutB)      g = 'B';
    else if (rank < cutC)      g = 'C';
    else                       g = 'D';
    rankGradeByIdx.set(entry.idx, g);
  });

  return results.map((r, idx) => {
    const scoreGrade: USAGrade = r.grade;
    const rankGrade: USAGrade = rankGradeByIdx.get(idx) ?? r.grade;
    // Take the WORSE of the two so caps from scoreUSARow are never undone.
    const scoreRank = GRADE_ORDER.indexOf(scoreGrade);
    const rankRank = GRADE_ORDER.indexOf(rankGrade);
    let grade: USAGrade = GRADE_ORDER[Math.max(scoreRank, rankRank)] ?? scoreGrade;

    // Hard-cap demotions remain (mega-cap, sub-10% growth, decel).
    let demoteSteps = 0;
    // PATCH 1101gg — softer mega-cap penalty. Previously NVDA / MU / SNDK class
    // names got -1 for >$150B AND ANOTHER -1 for >$500B, knocking $1T+ stocks
    // 2 grades down (A → B). User correctly observed that an A-quality $1T name
    // is still A-quality; mega-cap dampens 10x odds, not 2-3x odds. Now: ONE
    // step max regardless of size — the rank-based percentile already handles
    // most of the absolute-cap concerns.
    if (r.marketCapB !== undefined && r.marketCapB > 150) demoteSteps += 1;
    if (r.revenueGrowthAnn !== undefined && r.revenueGrowthAnn < 10) demoteSteps += 1;
    if (r.accelSignal === 'DECELERATING') demoteSteps += 1;

    // PATCH 1101gg+1101ii — CAP-AWARE R40 STRICT GATE. Same R40 number means
    // different things at different cap sizes:
    //   - LARGE/MEGA: R40 = 10 is awful (mature should hit 40+). Cap at C.
    //   - MICRO/SMALL: R40 = 10 is fine for early stage. Cap at B+ only.
    // Use per-tier r40Min (D/C cap) and r40Pass (B+ cap) from CAP_TIER_RULES.
    const r40 = (r as any).ruleOf40;
    const tier: CapTier = (r as any).capTier ?? getCapTier(r.marketCapB);
    const rules = CAP_TIER_RULES[tier];
    if (typeof r40 === 'number') {
      if (r40 < rules.r40Min && (grade === 'A+' || grade === 'A' || grade === 'B+' || grade === 'B')) {
        grade = 'C';
      } else if (r40 < (rules.r40Min + rules.r40Pass) / 2 && (grade === 'A+' || grade === 'A' || grade === 'B+')) {
        grade = 'B';
      } else if (r40 < rules.r40Pass && (grade === 'A+' || grade === 'A')) {
        grade = 'B+';
      }
    }

    if (demoteSteps > 0 && (grade === 'A+' || grade === 'A' || grade === 'B+')) {
      grade = downgrade(grade, demoteSteps);
    }
    return { ...r, grade };
  });
}
