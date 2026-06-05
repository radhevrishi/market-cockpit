// PATCH 0728 — Multibagger India scoring engine extracted from page.tsx.
// Pure code move: types + constants + helpers + scoreExcelRow + applyForcedRanking.
// No logic changes vs the original page.tsx code; future scoring fixes happen here.
import {
  analyzeDilution, computeReinvestmentEngine, computeFrameworkCoverage,
  computeArchetypeMatch, analyzeRoicVsWacc, buildMissingDimensions,
  type DilutionAnalysis, type ReinvestmentEngine,
  type FrameworkCoverage, type ArchetypeMatch,
  type RoicWaccSpread, type MissingDimension,
} from '@/lib/multibagger/framework-extensions';
import { MNC_ALLOWLIST_IN } from '@/lib/multibagger-allowlists';

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'NR';

// Minimal NewsArticle type for guidance scoring (full type lives in bottleneck-intel)
export interface NewsArticle {
  id?: string; title?: string; headline?: string; summary?: string;
  ticker_symbols?: string[]; article_type?: string; published_at?: string;
  source_name?: string; importance_score?: number;
}
export const GRADE_COLOR: Record<Grade, string> = {
  'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444','NR':'#64748b',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST — 37 criteria from SQGLP (MOSL 100x) + Fisher 100-Bagger + Framework
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number; source: string;
  autoField?: keyof ExcelRow; autoPass?: (v: number, row?: ExcelRow) => boolean;
  autoFormat?: (v: number, row?: ExcelRow) => string;
}

export const CHECKLIST: ChecklistItem[] = [
  // ── QUALITY / MOAT (Q in SQGLP) ───────────────────────────────────────────
  { id:'roce', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'MOSL SQGLP + Fisher',
    label:'ROCE ≥ 20% — above cost of capital', target:'> 20% elite; > 15% acceptable; < 12% avoid',
    why:'Sure-fire test of Economic Moat per MOSL: ROCE above industry average = sustained competitive advantage.',
    autoField:'roce', autoPass:v=>v>=18, autoFormat:v=>`ROCE ${v.toFixed(1)}%` },
  { id:'roe', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Fisher + MOSL',
    label:'ROE ≥ 15% consistently (3yr average)', target:'> 20% for compounders; > 15% minimum',
    why:'High sustained ROE without leverage = genuine earnings power. Buffett filter #1.',
    autoField:'roe', autoPass:v=>v>=15, autoFormat:v=>`ROE ${v.toFixed(1)}%` },
  { id:'incremental_roic', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Fisher 100-Bagger',
    label:'Incremental ROIC ≥ existing ROIC (expansion not dilutive)', target:'New capital earns ≥ legacy ROIC; no ROIC degradation on growth',
    why:"If new capital earns 10% but legacy earns 25%, growth destroys value. Fisher's key test: does reinvestment compound?" },
  { id:'opm', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'MOSL + Framework',
    label:'OPM stable or expanding (margin direction > absolute level)', target:'Expanding trend signals pricing power; contracting = danger',
    why:'Expanding OPM = operating leverage + pricing power. Margin compression is early warning of moat erosion.',
    autoField:'opm', autoPass:v=>v>=10, autoFormat:v=>`OPM ${v.toFixed(1)}%` },
  { id:'cfo', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'MOSL + Fisher',
    label:'CFO/PAT > 0.8 — earnings backed by cash', target:'> 1.0 excellent; > 0.8 good; < 0.5 danger',
    why:'Profit without cash = creative accounting. 100-baggers convert earnings to cash consistently. Governance signal.',
    autoField:'cfoToPat', autoPass:v=>v>=0.8, autoFormat:v=>`CFO/PAT ${v.toFixed(2)}x` },
  { id:'fcf_positive', pillar:'QUALITY', pillarColor:'#a78bfa', weight:5, source:'Fisher + Framework',
    label:'Free Cash Flow positive and growing', target:'FCF > 0; ideally FCF/Revenue > 5%',
    why:'FCF-generating companies self-fund growth without dilution. One of Fisher\'s key holding conditions.',
    autoField:'fcfAbsolute', autoPass:v=>v>0, autoFormat:v=>`FCF ₹${v.toFixed(0)}Cr` },
  { id:'moat_type', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Fisher 100-Bagger',
    label:'Moat type: network effects / switching cost / ecosystem (Tier 1) OR distribution/brand/scale (Tier 2)', target:'Tier 1 preferred; Tier 3 (cost only) = weak moat',
    why:"Fisher: market share stable/rising over 5-10 years = moat verified. Don't assume moat from narrative — verify from market share data." },
  { id:'no_rpt', pillar:'QUALITY', pillarColor:'#a78bfa', weight:4, source:'Fisher 100-Bagger',
    label:'No significant related-party transactions (< 5% revenue)', target:'Minimal RPT; no promoter-owned suppliers; no parallel businesses',
    why:"Fisher's structural integrity check: value leakage via RPT = even great business → poor shareholder returns." },

  // ── GROWTH (G in SQGLP) ───────────────────────────────────────────────────
  { id:'rev_cagr', pillar:'GROWTH', pillarColor:'#38bdf8', weight:8, source:'MOSL SQGLP',
    label:'Revenue CAGR ≥ 15% (3-5yr)', target:'> 20% for high-multiple justification; > 15% minimum',
    why:"MOSL: Growth is never by chance — it's the multiplicative interplay of Volume × Price × Operating Lever × Financial Lever.",
    autoField:'revCagr', autoPass:v=>v>=15, autoFormat:v=>`Sales CAGR ${v.toFixed(1)}%` },
  { id:'profit_cagr', pillar:'GROWTH', pillarColor:'#38bdf8', weight:8, source:'MOSL SQGLP + Framework',
    label:'PAT CAGR ≥ 20% AND faster than revenue (operating leverage proof)', target:'PAT CAGR > Revenue CAGR × 1.5 = magic multiplier',
    why:"Framework: Revenue +30% → EBITDA +60% → PAT +90% = operating leverage visible. This is Earnings Growth = Volume × Price Lever × Operating Lever × Financial Lever.",
    autoField:'profitCagr', autoPass:v=>v>=20, autoFormat:v=>`Profit CAGR ${v.toFixed(1)}%` },
  { id:'op_leverage', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7, source:'Framework.docx',
    label:'Operating leverage: PAT growth ≥ 1.5× Revenue growth (profit scales faster)', target:'PAT CAGR / Revenue CAGR > 1.5 = significant operating leverage',
    why:"Framework's #1 mandatory signal: profit growing materially faster than revenue proves fixed-cost absorption and scalable business model.",
    autoField:'profitCagr', autoPass:(v,row)=>row?.revCagr&&row.revCagr>0?v/row.revCagr>=1.3:v>=20,
    autoFormat:(v,row)=>row?.revCagr?`${(v/row.revCagr).toFixed(1)}x leverage (P:${v.toFixed(0)}%/R:${row.revCagr.toFixed(0)}%)`:`PAT CAGR ${v.toFixed(1)}%` },
  { id:'yoy_accel', pillar:'GROWTH', pillarColor:'#38bdf8', weight:6, source:'Framework.docx',
    label:'Revenue growth ACCELERATING quarter-over-quarter (trend improving)', target:'YOY quarterly growth > historical CAGR = acceleration signal',
    why:'Framework: Most critical distinction — revenue accelerating (18%→26%→38%→52%) vs high but decelerating. The trend is the alpha, not the level.',
    autoField:'yoySalesGrowth', autoPass:v=>v>=12, autoFormat:v=>`YOY Sales ${v.toFixed(1)}%` },
  { id:'yoy_profit', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5, source:'Framework.docx',
    label:'YOY quarterly profit growth > 10% (no earnings deterioration)', target:'Latest quarter: PAT not declining QoQ',
    why:'Profit deceleration is the earliest warning signal per Framework. Even a beat with declining trajectory = red flag.',
    autoField:'yoyProfitGrowth', autoPass:v=>v>=10, autoFormat:v=>`YOY Profit ${v.toFixed(1)}%` },
  { id:'rev_accel', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'Framework.docx — MANDATORY',
    label:'RECENT revenue > historical CAGR (business ACCELERATING, not decelerating)', target:'Latest quarter YOY % > 3-5yr CAGR = acceleration. Deceleration = REJECT immediately.',
    why:"Framework #1 non-negotiable: 'Sequential acceleration in YoY growth: 18%→26%→38%→52% = buy. High growth but decelerating = reject.' Absence of 2+ primary signals → reject.",
    autoField:'accelSignal' as unknown as keyof ExcelRow,
    autoPass:(_v,row)=>row?.accelSignal==='ACCELERATING',
    autoFormat:(_v,row)=>row?.accelSignal?`${row.accelSignal}: recent ${row.yoySalesGrowth?.toFixed(0)}% vs CAGR ${row.revCagr?.toFixed(0)}% (${(row.revenueAcceleration??0)>=0?'+':''}${row.revenueAcceleration?.toFixed(0)}pp)`:'' },
  { id:'profit_accel', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7, source:'Framework.docx',
    label:'RECENT profit growth > historical (PAT also accelerating)', target:'YOY quarterly profit growth > PAT CAGR = earnings quality improving',
    why:"Framework: Both revenue AND profit must accelerate. 'PAT +140% vs Revenue +43% = operating leverage visible.' Profit deceleration while revenue grows = margin warning.",
    autoField:'profitAcceleration' as unknown as keyof ExcelRow,
    autoPass:(_v,row)=>row!==undefined&&(row.profitAcceleration??-999)>=0,
    autoFormat:(_v,row)=>row?.profitAcceleration!==undefined?`Profit accel ${(row.profitAcceleration)>=0?'+':''}${row.profitAcceleration?.toFixed(0)}pp vs historical`:'' },
  { id:'recent_oplev', pillar:'GROWTH', pillarColor:'#38bdf8', weight:6, source:'Framework.docx',
    label:'Recent quarter operating leverage ≥ 1.5× (PAT growing 1.5× faster than sales this quarter)', target:'YOY profit / YOY sales ratio ≥ 1.5 this quarter = real-time margin expansion',
    why:"Framework: 'Revenue +30%, EBITDA +60%, PAT +90%' = operating leverage firing NOW, not just in historical CAGR. This is the real-time proof of operating leverage.",
    autoField:'recentOpLev' as unknown as keyof ExcelRow,
    autoPass:(_v,row)=>row!==undefined&&(row.recentOpLev??0)>=1.3,
    autoFormat:(_v,row)=>row?.recentOpLev!==undefined?`Recent op lev ${row.recentOpLev.toFixed(1)}× (P:${row.yoyProfitGrowth?.toFixed(0)}%/S:${row.yoySalesGrowth?.toFixed(0)}%)`:'' },
  { id:'new_engine', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5, source:'Framework.docx',
    label:'New growth engine already contributing (not just announced)', target:'New product / new geography / new segment already in revenue',
    why:"Framework mandatory check: 'At least one must be visible + monetizing.' Announcements without revenue = narrative trap." },
  { id:'order_book', pillar:'GROWTH', pillarColor:'#38bdf8', weight:4, source:'Framework.docx',
    label:'Order book ≥ 2-3× annual revenue (capital goods / industrials)', target:'Order book / pipeline visibility ≥ 2× revenue; strong ARR for SaaS',
    why:"Framework: 'Order book not converting to revenue' = #1 rejection filter for industrials. Execution catching up with backlog = rerating trigger." },
  { id:'eps_twin', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5, source:'Fisher 100-Bagger',
    label:'EPS growing ≥ 20% + PE not contracting (Twin Engine check)', target:'EPS growth × stable/expanding PE = compounding setup. Fisher: this is HOW 100-baggers happen.',
    why:"Fisher Twin Engine: EPS +20% × PE stable = 20% return. EPS +20% × PE rises = explosive. The PE expansion is the second engine most miss.",
    autoField:'epsGrowth', autoPass:v=>v>=15, autoFormat:v=>`EPS growth ${v.toFixed(1)}%` },

  // ── LONGEVITY (L in SQGLP) — 100-bagger element most frameworks miss ───────
  { id:'cap_5yr', pillar:'LONGEVITY', pillarColor:'#06b6d4', weight:7, source:'MOSL SQGLP',
    label:'Competitive Advantage Period (CAP) visible for 5+ years', target:'Is there a clear reason why ROCE stays high for 5+ more years? Assess CAP.',
    why:"MOSL: 'L' in SQGLP = longevity of both quality and growth. Without longevity, you get a 3-5× not a 100×. The CAP must be intact — growth shouldn't be reverting to mean." },
  { id:'not_peak_cycle', pillar:'LONGEVITY', pillarColor:'#06b6d4', weight:6, source:'Fisher 100-Bagger',
    label:'Industry NOT at peak margin cycle (near trough = opportunity)', target:'Near trough margins preferred entry. Avoid peak-margin industries.',
    why:"Fisher: 'You buy great companies at the right cycle point.' Peak margins mean reversion ahead. Trough margins mean expansion ahead — that's the Longevity window." },
  { id:'model_reclassify', pillar:'LONGEVITY', pillarColor:'#06b6d4', weight:6, source:'Framework.docx',
    label:'Business model reclassification underway (cyclical→compounder / domestic→global)', target:'Market shifting perception from cyclical to compounder = multiple expansion + earnings upgrade',
    why:'Framework: "Critical Rerating Trigger" — when market reclassifies a business, you get BOTH earnings upgrade AND PE expansion simultaneously = twin engine firing.' },
  { id:'tam_growth', pillar:'LONGEVITY', pillarColor:'#06b6d4', weight:5, source:'Fisher 100-Bagger',
    label:'TAM growing ≥ 10% annually (industry structural tailwind)', target:'TAM CAGR ≥ 15% ideal; ≥ 10% acceptable; < 8% = reject for 100×',
    why:"Fisher Stage 1 filter (80% fail here): 'If industry grows slowly, company must take market share — harder. 100-baggers ride tailwinds + execution, not execution alone.'" },
  { id:'value_migration', pillar:'LONGEVITY', pillarColor:'#06b6d4', weight:5, source:'MOSL SQGLP',
    label:'Value migration beneficiary (global→India / public→private / unorganised→organised)', target:'MOSL: Value migration = most predictable 100× opportunity',
    why:"MOSL 100× study: 19 of 47 enduring 100-baggers were value migration stories. IT (offshore), Pharma (CDMO), Banking (private vs PSU), Organised retail vs kirana." },
  { id:'repeat_growth', pillar:'LONGEVITY', pillarColor:'#06b6d4', weight:4, source:'Framework.docx',
    label:'Growth repeatable for next 4-6 quarters (not a one-quarter spike)', target:'Can this quarter\'s performance structurally repeat? Framework: "Final filter most important"',
    why:"Framework: 'Did this earnings result materially increase the probability of higher earnings over next 2-4 quarters?' YES = investigate deeply. NO = ignore even if results look strong." },

  // ── FINANCIAL STRENGTH ────────────────────────────────────────────────────
  { id:'de', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:6, source:'Fisher + MOSL',
    label:'Debt/Equity ≤ 0.5 (low financial leverage = resilience)', target:'D/E < 0.5 preferred; < 1.0 acceptable for capital-intensive',
    why:'Low D/E = resilience in downturns, no dilution risk. Financial leverage amplifies both gains and losses — 100-baggers rarely need it.',
    autoField:'de', autoPass:v=>v<=0.5, autoFormat:v=>`D/E ${v.toFixed(2)}x` },
  { id:'net_debt_ebitda', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:6, source:'Fisher 100-Bagger',
    label:'Net Debt/EBITDA < 1.5 (Fisher survival filter)', target:'< 1.0 clean; < 1.5 acceptable; > 3.0 = CRITICAL danger zone',
    why:"Fisher Stage 6 survival filter: Net Debt/EBITDA > 3 is how companies go bankrupt in downturns. Even great businesses collapse if over-leveraged — Infra 2011 case study.",
    autoField:'netDebtEbitda', autoPass:v=>v<1.5, autoFormat:v=>`ND/EBITDA ${v.toFixed(1)}x` },
  { id:'promoter', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:6, source:'MOSL + Fisher',
    label:'Promoter holding ≥ 40%, stable or rising', target:'> 50% excellent; > 40% good; < 25% = concern; declining trend = red flag',
    why:'Promoter buying own shares = skin in the game. Consistent selling = promoter exiting before market knows.',
    autoField:'promoter', autoPass:v=>v>=40, autoFormat:v=>`Promoter ${v.toFixed(1)}%` },
  { id:'pledge', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:5, source:'Fisher + MOSL',
    label:'Pledged shares = 0% (zero pledge = clean governance)', target:'0% ideal; < 5% acceptable; > 25% = HIGH risk; > 50% = CRITICAL',
    why:'Pledge = promoter borrowing against shares. In a market correction, lenders force-sell creating downward spiral. Fisher: pledge = governance failure signal.',
    autoField:'pledge', autoPass:v=>v<=5, autoFormat:v=>`Pledge ${v.toFixed(1)}%` },
  { id:'promoter_change', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:4, source:'Fisher + Framework',
    label:'Promoter holding stable or increasing QoQ (not declining)', target:'Consistent increase = bullish; consistent decrease = watch carefully',
    why:"Fisher Scuttlebutt: 'Track promoter behavior — they know the business better than anyone. Consistent selling = they see something the market doesn't.'",
    autoField:'changeInPromoter', autoPass:v=>v>=0, autoFormat:v=>`Δ Promoter ${v>0?'+':''}${v.toFixed(1)}% this qtr` },
  { id:'icr', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:3, source:'Fisher 100-Bagger',
    label:'Interest Coverage Ratio > 6x (Fisher threshold)', target:'> 6-8x Fisher threshold; > 3x minimum; < 1.5x = CRITICAL',
    why:"Fisher Stage 6 exact threshold: ICR > 6-8. Below 2× means earnings barely cover interest — any earnings decline = existential risk." },

  // ── VALUATION (P in SQGLP — Price) ────────────────────────────────────────
  { id:'mcap_zone', pillar:'VALUATION', pillarColor:'#f59e0b', weight:7, source:'MOSL SQGLP',
    label:'SQGLP "S": Market cap ₹500–₹10,000 Cr (small + undiscovered)', target:'MOSL: Avg market cap of 100× stocks at purchase = ₹250Cr. < ₹10,000Cr today for 100× potential.',
    why:"MOSL 100× study: 'Sheer size militates against great growth.' Low-base effect — a ₹500Cr company can 100× to ₹50,000Cr. A ₹50,000Cr company needs to become ₹50L Cr.",
    autoField:'marketCapCr', autoPass:v=>v>=200&&v<=10000, autoFormat:v=>`₹${v.toLocaleString()}Cr` },
  { id:'undiscovered', pillar:'VALUATION', pillarColor:'#f59e0b', weight:6, source:'MOSL SQGLP',
    label:'FII + DII holding < 25% = undiscovered (institutional discovery ahead)', target:'< 10% total institutional = maximum undiscovered; < 25% = still early',
    why:"MOSL 'S' element: Low institutional holding + low analyst coverage = stock not yet on radar. Institutional DISCOVERY is the catalyst for 100× price rerating.",
    autoField:'fiiPlusDii', autoPass:v=>v<25, autoFormat:v=>`FII+DII ${v.toFixed(1)}%` },
  { id:'peg', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5, source:'Fisher 100-Bagger',
    label:'PEG Ratio < 1.5 (growth at a reasonable price)', target:'< 0.8 = excellent; 0.8–1.5 = fair GARP; > 2.5 = expensive for growth',
    why:"Fisher PEG check: paying 50× P/E for 50% growth = fair (PEG=1). Paying 50× for 10% growth = expensive (PEG=5). Fisher Stage 7: 'Avoid PE > 60 without extreme growth.'",
    autoField:'peg', autoPass:v=>v>0&&v<1.5, autoFormat:v=>`PEG ${v.toFixed(2)}` },
  { id:'intrinsic', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5, source:'MOSL',
    label:'Price ≤ Intrinsic Value — margin of safety present', target:'Buying below intrinsic value = MOSL\'s foundation of wealth creation',
    why:"MOSL: 'Buy businesses at price substantially lower than intrinsic/expected value. The lower market value vs intrinsic value, the higher the wealth creation.'",
    autoField:'marginOfSafety', autoPass:v=>v>=0, autoFormat:v=>`MoS ${v>0?'+':''}${v.toFixed(0)}%` },
  { id:'pe_rerate', pillar:'VALUATION', pillarColor:'#f59e0b', weight:4, source:'MOSL SQGLP + Fisher',
    label:'Room for PE re-rating (not already at premium; stock not fully priced)', target:'SQGLP "P": Enough room for valuation multiple to expand with earnings',
    why:"MOSL: The P in SQGLP = favorable valuation with room to re-rate. Fisher Twin Engine: EPS+20% × PE stable = 20% return. EPS+20% × PE expands = explosive return.",
    autoField:'pe', autoPass:v=>v<50, autoFormat:v=>`P/E ${v.toFixed(1)}x` },

  // ── MARKET / MOMENTUM ─────────────────────────────────────────────────────
  { id:'momentum', pillar:'MARKET', pillarColor:'#f97316', weight:5, source:'MOSL',
    label:'Price above DMA200 — uptrend intact', target:'Price > DMA200; within 30% of 52W high',
    why:"MOSL: 100× stocks rarely give entry below DMA200 for long. Strong price action validates the business reality. 'When the 100× idea dawns on you, simply buy the stock.'",
    autoField:'aboveDMA200', autoPass:v=>v>=0, autoFormat:v=>`${v>0?'+':''}${v.toFixed(1)}% vs DMA200` },
  { id:'return1m', pillar:'MARKET', pillarColor:'#f97316', weight:3, source:'MOSL',
    label:'1-month return not deeply negative (> -15%)', target:'Not in free-fall; technical context supporting business narrative',
    why:'Deeply negative recent return without fundamental reason = market seeing something not visible in backward-looking data.',
    autoField:'return1m', autoPass:v=>v>=-15, autoFormat:v=>`${v>0?'+':''}${v.toFixed(1)}% 1M` },
  { id:'sector_tailwind', pillar:'MARKET', pillarColor:'#f97316', weight:5, source:'MOSL + Fisher',
    label:'Sector structural tailwind — not peak cyclical (Fisher: "right cycle point")', target:'Defense, EMS, capital goods, pharma CDMO, specialty chem, private banks, organized retail',
    why:"Fisher Stage 1 + MOSL: Both say invest in structural growth industries, not cyclical peaks. 'Industry is 9%, management is 90%, other 1%' — but only for companies IN the right industry." },
];

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL SCORING ENGINE — SQGLP + Fisher + Framework fields
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExcelRow {
  // VALUATION-A — raw CSV row passthrough so the valuation engine can
  // read columns we don't promote to first-class fields.
  _raw?: Record<string, unknown>;
  symbol: string; company: string; sector: string;
  // Quality
  roce?: number; roe?: number; opm?: number; cfoToPat?: number;
  promoter?: number; pledge?: number; fcfAbsolute?: number;
  // Growth
  revCagr?: number; profitCagr?: number;
  yoySalesGrowth?: number; yoyProfitGrowth?: number;
  epsGrowth?: number; eps?: number;
  salesGrowth3y?: number;
  // Financial strength
  de?: number; icr?: number; netDebt?: number; ebitda?: number;
  changeInPromoter?: number;
  // Valuation — SQGLP Price
  pe?: number; pb?: number; peg?: number;
  marketCapCr?: number; intrinsicValue?: number; price?: number;
  fii?: number; dii?: number;
  // Market/momentum
  dma200?: number; return1m?: number; return1w?: number;
  // ── Kill-switch metrics ──────────────────────────────────────────────────
  gpm?: number;   // Gross Profit Margin % (Screener "Gross profit margin" or custom)
  roic?: number;  // Return on Invested Capital % (Screener "Return on invested capital")
  // ── NEW: Incremental / trend fields (Gap 1-3, 5, 7) ──────────────────────
  roce3yr?: number;      // ROCE 3 years ago → incremental ROCE signal (Gap 1)
  opm3yr?: number;       // OPM 3 years ago — custom Screener ratio (Gap 2)
  opmPrev?: number;      // OPM last year (Screener "OPM last year") → 1yr margin change (Gap 2)
  opm5y?: number;        // PATCH 1026: OPM 5 years ago (Screener "OPM 5Year") → 5y margin trend proxy
  high52w?: number;      // 52-week High price (Screener "High price") (Gap 7)

  // ── PATCH 0317: Additional institutional metrics ─────────────────────────
  // These are optional and scoring rules skip gracefully when undefined.
  // User pulls these from Screener.in into their export and the model picks
  // them up automatically. Mapping doc lives in METRICS_TO_ADD.md.
  debtorDays?: number;            // Screener "Debtor Days" — receivable buildup detection
  inventoryDays?: number;         // Screener "Inventory Days" — demand-slowdown leading indicator
  creditorDays?: number;          // Screener "Creditor Days" — supplier financing
  workingCapitalDays?: number;    // = debtor + inventory - creditor; if direct Screener field
  debtorDays3y?: number;          // PATCH 0332 — Screener "Debtor days 3years back" — trend
  workingCapitalDays3y?: number;  // PATCH 0332 — Screener "Average Working Capital Days 3years"
  interestCoverage?: number;      // Screener "Interest Coverage Ratio" — EBIT / Interest
  effectiveTaxRate?: number;      // Screener "Tax Rate %" or computed 3yr avg
  capex3yr?: number;              // Screener "Capex 3Yrs" (cumulative absolute capex)
  // Multi-quarter ownership history. Order: oldest first → latest. Any length OK.
  promoterHistory?: number[];     // last 4 quarters of promoter %
  fiiHistory?: number[];          // last 4 quarters of FII %
  diiHistory?: number[];          // last 4 quarters of DII %
  dividendYield?: number;         // Screener "Dividend Yield" — already referenced via (row as any)
  // Free-float / liquidity (optional; defaults skip)
  avgDailyValueCr?: number;       // average daily traded value in ₹ Cr (last 30d)

  // ── PATCH 0322: Forensic pump-detection fields ──────────────────────────
  // These detect operator-pumped names with surface-clean fundamentals.
  // MosChip / RIR Power pattern: reported sales jumps + clean profit margins
  // BUT underlying signals show other-income inflation, dilution-funded
  // growth, related-party revenue, suspicious share-count expansion, etc.
  otherIncomePctPbt?: number;     // Other Income / PBT × 100 — > 25% is non-operating PBT
  cashAndEq?: number;             // Cash + Cash Equivalents ₹ Cr (current)
  cashAndEqPrev?: number;         // Cash 1Y ago — to detect cash decline despite profits
  numSharesNow?: number;          // Number of equity shares (current, Cr)
  numShares3y?: number;           // Number of equity shares 3Y ago (Cr) — dilution trail
  rptRevenuePct?: number;         // Related-party transactions as % of revenue
  auditorChangesLast3y?: number;  // Count of auditor changes last 3Y (Screener flags it)
  subsidiaryCount?: number;       // Number of subsidiaries (multi-layer structure check)
  freeFloatPct?: number;          // Free-float % (100 - promoter - locked-in)
  highLowRangePct?: number;       // 52w (high - low) / low × 100 — extreme volatility check
  promoterEntityCount?: number;   // Count of promoter group entities — restructuring sniff

  // Derived
  marginOfSafety?: number;
  aboveDMA200?: number;
  netDebtEbitda?: number;
  fiiPlusDii?: number;
  opLeverageRatio?: number;    // profitCagr / revCagr (historical)
  evEbitda?: number;           // (MCap + NetDebt) / EBITDA → enterprise value check (Gap 5)
  fcfYield?: number;           // FCF / MCap × 100% → cash return on market cap (Gap 5)
  roceExpansion?: number;      // roce − roce3yr → is new capital productive? (Gap 1)
  opmExpansion?: number;       // opm − opm3yr → pricing power / margin quality (Gap 2)
  pctFrom52wHigh?: number;     // (price − high52w) / high52w × 100 → technical RS proxy (Gap 7)
  // ── RECENT / ACCELERATION — Framework.docx Core Signal ────────────────────
  // Derived by comparing latest quarter (YOY) vs historical CAGR
  revenueAcceleration?: number;   // yoySalesGrowth - revCagr → positive = accelerating
  profitAcceleration?: number;    // yoyProfitGrowth - profitCagr → positive = accelerating
  recentOpLev?: number;           // yoyProfitGrowth / yoySalesGrowth (recent operating leverage)
  accelSignal?: 'ACCELERATING' | 'STABLE' | 'DECELERATING'; // composite trend signal
  // ── PATCH 0055: framework extensions ─────────────────────────────────────
  // Dilution trajectory (shareCount CAGR ≈ profitCagr − epsGrowth)
  dilution?: DilutionAnalysis;
  // Reinvestment engine score (combines incremental ROCE + profit growth − dilution)
  reinvestment?: ReinvestmentEngine;
  // Framework coverage (% of ideal data present)
  framework_coverage?: FrameworkCoverage;
  // ── PATCH 0058: archetype match (auto-encoded historical lessons) ────────
  archetype?: ArchetypeMatch;
  // ── PATCH 0066: ROIC vs WACC spread + missing dimensions ─────────────────
  roic_vs_wacc?: RoicWaccSpread;
  missing_dimensions?: MissingDimension[];
}

// ── OWNERSHIP INTELLIGENCE LAYER ─────────────────────────────────────────────
// Replaces flat "promoter < 35% = penalty" with context-aware ownership scoring.
// Promoter holding alone is meaningless without knowing who else holds the stock.
export type OwnershipCategory = 'FOUNDER_CONTROLLED' | 'INSTITUTIONALIZING' | 'MATURE' | 'OWNERSHIP_VACUUM';

export const OWNERSHIP_CONFIG: Record<OwnershipCategory, { label: string; color: string; icon: string; strategy: string; allocation: string }> = {
  FOUNDER_CONTROLLED: {
    label:'Founder-Controlled',  color:'#10b981', icon:'🏛',
    strategy:'Accumulate early — institutional re-rating ahead',
    allocation:'30–40% of portfolio allocation',
  },
  INSTITUTIONALIZING: {
    label:'Institutionalizing',  color:'#a78bfa', icon:'📈',
    strategy:'Highest conviction zone — 5–10x moves with lower risk than early stage',
    allocation:'40–50% of portfolio allocation',
  },
  MATURE: {
    label:'Fully Institutionalized', color:'#38bdf8', icon:'🏦',
    strategy:'Use for stability — lower multibagger upside, de-risked',
    allocation:'10–20% of portfolio allocation',
  },
  OWNERSHIP_VACUUM: {
    label:'Ownership Vacuum',    color:'#f97316', icon:'⚠️',
    strategy:'Only enter with strong cash flow + high growth. Size: 1–3% max',
    allocation:'< 10% of portfolio allocation',
  },
};

export function classifyOwnership(promoter?: number, fiiDii?: number, changeInPromoter?: number): OwnershipCategory {
  const p  = promoter ?? 0;
  const f  = fiiDii   ?? 0;
  const dp = changeInPromoter ?? 0; // delta promoter this quarter

  // Ownership Vacuum: neither founder nor institutions own meaningfully
  if (p < 30 && f < 12) return 'OWNERSHIP_VACUUM';

  // Founder-Controlled: founder has majority, institutions haven't discovered yet
  if (p >= 50 && f < 18) return 'FOUNDER_CONTROLLED';

  // Mature: institutions heavily owned, founder no longer dominant
  if (f >= 32 || (f >= 25 && p < 45)) return 'MATURE';

  // Institutionalizing: mixed but trending right direction
  // Strong signal: promoter 30-60% AND FII/DII rising (15%+) — sweet spot
  return 'INSTITUTIONALIZING';
}

// ── BUCKET TYPES ──────────────────────────────────────────────────────────────
export type Bucket = 'CORE_COMPOUNDER' | 'EMERGING_MULTIBAGGER' | 'HIGH_RISK' | 'MONITOR';
export const BUCKET_CONFIG: Record<Bucket, { label: string; color: string; icon: string; desc: string }> = {
  CORE_COMPOUNDER:     { label: 'Core Compounder',      color: '#10b981', icon: '🏆', desc: 'High quality + consistent growth + clean balance sheet' },
  EMERGING_MULTIBAGGER:{ label: 'Emerging Multibagger',  color: '#a78bfa', icon: '🚀', desc: 'Accelerating growth + early discovery + rerating potential' },
  HIGH_RISK:           { label: 'High-Risk Accel',       color: '#f97316', icon: '⚡', desc: 'Fast growth but balance sheet or quality concerns' },
  MONITOR:             { label: 'Monitor / Watch',       color: '#64748b', icon: '👁', desc: 'Fails hard filters — watch only, not for active sizing' },
};

// ── DECISION STRIP — 5 pass/fail checks shown on every row ───────────────────
export interface DecisionCheck { pass: boolean; label: string; detail: string; }
export interface DecisionStrip {
  survival: DecisionCheck;    // No CRITICAL flags, debt OK, promoter OK
  acceleration: DecisionCheck;// Revenue accelerating vs historical
  valuation: DecisionCheck;   // PEG < 1.5 or below intrinsic value
  discovery: DecisionCheck;   // FII+DII < 25% (undiscovered)
  technical: DecisionCheck;   // Above DMA200, not in deep drawdown
}

// ── 8-TEST KILL-SWITCH LAYER ─────────────────────────────────────────────────
// Each test has 2-3 automated checks. pass=true|false|null (null = insufficient data).
// Test passes if majority (≥ half of non-null) checks pass.
export interface KSCheck {
  label: string;
  pass: boolean | null;   // null = no data for this check
  detail: string;
}
export interface KSTest {
  id: string;
  icon: string;
  label: string;
  checks: KSCheck[];
  pass: boolean;          // majority of non-null checks pass
  failCount: number;      // how many automated checks failed
}

export interface ExcelResult extends ExcelRow {
  score: number; grade: Grade;
  bucket: Bucket;
  decisionStrip: DecisionStrip;
  pillarScores: { id: string; label: string; score: number; color: string; weight: number }[];
  // PATCH 0315 — `kind` distinguishes STRUCTURAL (governance / leverage /
  // capital-allocation / pattern) from CYCLICAL (single-quarter or mean-
  // revertable concern). Caps differ: STRUCTURAL HIGH → 60, CYCLICAL HIGH → 72.
  redFlags: { label: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM'; source: string; kind?: 'STRUCTURAL'|'CYCLICAL' }[];
  strengths: string[]; risks: string[];
  coverage: number;
  reratingBonus: number;
  ownershipCategory: OwnershipCategory;
  // New: trajectory and trigger signals
  trajectoryScore: number;  // (recent − historical) for sales + profit — change direction
  triggerBonus: number;     // proxy for turnaround / new engine / inflection
  inflectionSignal: boolean;// early-phase: low→high profit growth
  killSwitch: KSTest[];     // 8-test final kill-switch layer
  // PATCH 0987 — Screener provenance: file names this stock appeared in.
  // Populated by upload handler; legacy rows have undefined.
  _screeners?: string[];
  // PATCH 1049 — Haiku AI Forward Guidance overlay (from /api/v1/haiku/forward-guidance).
  // Populated client-side from localStorage cache or on user-triggered fetch.
  // Distinct from the existing news-keyword guidanceScore (0.0–1.0) on this row —
  // this is the signed concall-transcript score in [-1, +1] from the earnings pipeline.
  aiGuidanceScore?: number;
  aiGuidanceTier?: 'EXCELLENT'|'POSITIVE'|'NEUTRAL'|'CAUTIOUS'|'NEGATIVE'|'NOGUIDANCE'|null;
  aiGuidanceSummary?: string;
  aiGuidancePeriod?: string;
  aiGuidanceFetchedAt?: number; // epoch ms, for cache TTL + stale highlight
}

// Sector benchmarks: [p25, median, p75]
// ── SECTOR BENCHMARKS — sector-appropriate, NOT normalized across all ────────
// Capital-light sectors (IT, asset-light) have naturally higher ROCE — their
// benchmark p75 is set higher so 60% ROCE in IT doesn't score 100 automatically.
// Capital-intensive sectors (Infra, Solar, Steel, Auto) have lower ROCE expectations.
// This gives credit to a manufacturing company achieving 25% ROCE vs IT company at 60%.
export const SBENCH: Record<string, { roce: number[]; opm: number[]; pe: number[]; rg: number[]; deMax: number }> = {
  // Capital-light / software — high ROCE is expected; set thresholds high
  TECHNOLOGY:   { roce:[28,40,58], opm:[18,26,36], pe:[24,34,54], rg:[12,20,30], deMax:0.3 },
  // Pharma / Healthcare — medium capex, strong IP-based margins
  PHARMA:       { roce:[16,24,34], opm:[16,23,32], pe:[20,30,46], rg:[10,15,22], deMax:0.5 },
  // Banking/NBFC — ROCE concept is different (NIM/ROA-based), use loose thresholds
  BANKING_FIN:  { roce:[12,16,22], opm:[22,32,44], pe:[11,17,27], rg:[12,18,26], deMax:8.0 },
  // Capital goods, industrial manufacturing — moderate ROCE is genuinely good
  INDUSTRIALS:  { roce:[13,18,26], opm:[8,12,18],  pe:[17,25,40], rg:[10,16,24], deMax:0.7 },
  // Consumer brands / FMCG — asset-light distribution, high ROCE expected
  CONSUMER:     { roce:[20,30,44], opm:[10,17,24], pe:[22,32,52], rg:[8,15,22],  deMax:0.4 },
  // Specialty chemicals — process industry, moderate-high ROCE
  CHEMICALS:    { roce:[14,22,32], opm:[12,18,26], pe:[17,27,42], rg:[10,18,28], deMax:0.6 },
  // Automobiles / auto ancillary — capital-intensive, lower ROCE acceptable
  AUTO:         { roce:[11,17,25], opm:[7,11,17],  pe:[14,21,34], rg:[8,14,22],  deMax:0.8 },
  // Infra / Power / Solar / Renewables / Capital goods — very high capex, low ROCE normal
  // WEBELSOLAR, power companies etc. belong here — ROCE of 15-20% is genuinely strong
  INFRA:        { roce:[8,14,22],  opm:[9,14,20],  pe:[14,22,36], rg:[8,15,22],  deMax:1.5 },
  // Metals / Mining / Commodities — cyclical, capital intensive
  METALS:       { roce:[8,13,22],  opm:[8,14,22],  pe:[8,14,24],  rg:[5,12,22],  deMax:1.0 },
  DEFAULT:      { roce:[13,20,28], opm:[10,15,22], pe:[17,25,42], rg:[10,16,24], deMax:0.7 },
};

export function getSectorKey(s: string): string {
  const u = s.toUpperCase();
  // Capital-light / Technology
  if (/TECH|SOFTWARE|IT |COMPUTER|SAAS|IT-|SERVICES.*TECH/.test(u)) return 'TECHNOLOGY';
  // Pharma / Healthcare
  if (/PHARMA|DRUG|HEALTH|BIOTECH|MEDIC|HOSPITAL|DIAGNOSTIC/.test(u)) return 'PHARMA';
  // Banking / Finance
  if (/BANK|FINANCE|NBFC|INSURANCE|LENDING|MFI|MICROFI/.test(u)) return 'BANKING_FIN';
  // Specialty Chemicals
  if (/CHEM|SPECIALTY|AGROCH|PESTICIDE|FERTILISER|FERTILIZER/.test(u)) return 'CHEMICALS';
  // Auto / Vehicles
  if (/AUTO|VEHICLE|ANCILLAR|TYRE|BEARING/.test(u)) return 'AUTO';
  // Consumer / FMCG
  if (/CONSUMER|FMCG|RETAIL|PERSONAL|BEVERAG|FOOD|APPAREL|FASHION/.test(u)) return 'CONSUMER';
  // Metals / Mining
  if (/METAL|STEEL|IRON|ALUMIN|COPPER|MINING|MINERAL|ZINC|CEMENT/.test(u)) return 'METALS';
  // Infra / Power / Solar / Renewable — MOST IMPORTANT: Solar companies like WEBELSOLAR
  if (/INFRA|CONSTRUCT|REAL.*ESTATE|POWER|ENERGY|SOLAR|RENEW|EPC|GRID|TRANSMISSION|GENERAT|UTILITY|ELECT.*EQUIPMENT/.test(u)) return 'INFRA';
  return 'INDUSTRIALS';
}

export function sv(v: number|undefined, bench: number[], hiGood=true): number {
  if (v===undefined||v===null||isNaN(v as number)) return 0;
  const [lo,mid,hi] = hiGood ? bench : bench.map(x=>-x);
  const val = hiGood ? v : -v;
  if (val>=hi) return Math.min(100, 88+(val-hi)*0.4);
  if (val>=mid) return 72+((val-mid)/(hi-mid))*16;
  if (val>=lo) return 50+((val-lo)/(mid-lo))*22;
  return Math.max(0, 30+Math.max(0,val)/Math.max(lo,1)*20);
}


// ── CYCLICAL SECTOR DETECTION ─────────────────────────────────────────────────
// PEG and P/E are unreliable for cyclicals — earnings spike at cycle peak, not structural.
// For these sectors: skip PEG benefit, apply mean-reversion penalty.
export function isCyclicalSector(sector: string): boolean {
  const s = sector.toUpperCase();
  return /METAL|STEEL|IRON|ALUMIN|COPPER|ZINC|CEMENT|MINING|MINERAL|COMMODITY|OIL|GAS|CRUDE|PETRO|SUGAR|COTTON|TEXTILE.*SPIN|FERTILISER|FERTILIZER|CAST.*FORG|FORG.*CAST|SHIPPING|BULK/.test(s);
}

// ── INDUSTRY TAILWIND ENGINE (Gap 3) ─────────────────────────────────────────
// Structural industry tailwind score (0-100) based on policy, demand cycle, global shift.
// Sources: MOSL sector studies, PLI notifications, DPIIT data, RBI credit flows.
// "Invest in right industry at right cycle point" — Fisher Stage 1 + MOSL core principle.
export function getSectorTailwind(sector: string): { score: number; label: 'HIGH'|'MEDIUM-HIGH'|'MEDIUM'|'LOW'; drivers: string } {
  const s = sector.toUpperCase();
  // HIGH TAILWIND (75–100) — structural multi-year growth + strong policy support
  if (/DEFENCE|AERO|AEROSPACE|MILITARY|ORDNANCE|DEFENCE.*MFG/.test(s))
    return { score:95, label:'HIGH', drivers:'Indigenisation mandate + export push + PLI scheme' };
  if (/EMS|ELECTRONICS.*MFG|ELEC.*COMPONENT|PCB|CIRCUIT.*BOARD/.test(s))
    return { score:90, label:'HIGH', drivers:'PLI scheme + Apple/Samsung supply chain + China+1' };
  if (/DATA.*CENT|AI.*INFRA|CLOUD.*INFRA/.test(s))
    return { score:88, label:'HIGH', drivers:'AI infrastructure build-out, secular multi-decade growth' };
  if (/RAILWAY|METRO|BULLET.*TRAIN|FREIGHT.*CORR/.test(s))
    return { score:85, label:'HIGH', drivers:'₹2.5L Cr capex cycle, dedicated freight corridor' };
  if (/SOLAR|WIND.*POWER|GREEN.*HYDROGEN|RENEW.*ENERGY|CLEAN.*ENERGY/.test(s))
    return { score:83, label:'HIGH', drivers:'500 GW target, ISTS waiver, favourable policy' };
  if (/CDMO|CONTRACT.*MFG.*PHARMA|CONTRACT.*RESEARCH|CRO.*PHARMA/.test(s))
    return { score:82, label:'HIGH', drivers:'China+1 API diversification, global pharma outsourcing' };
  if (/LOGISTIC|WAREHOU|3PL|SUPPLY.*CHAIN|COLD.*CHAIN/.test(s))
    return { score:76, label:'HIGH', drivers:'Organised logistics growth, e-comm + GST formalisation' };
  // MEDIUM-HIGH (55–74)
  if (/SPECIALTY.*CHEM|SPEC.*CHEM|FLUOROCHEM|FINE.*CHEM/.test(s))
    return { score:68, label:'MEDIUM-HIGH', drivers:'China+1, import substitution, global specialty demand' };
  if (/CAPITAL.*GOOD|HEAVY.*ENGG|MACHINE.*TOOL|POWER.*EQUIP/.test(s))
    return { score:66, label:'MEDIUM-HIGH', drivers:'Capex supercycle, PLI, MSME formalisation' };
  if (/HOSPITAL|DIAGNOSTICS|HEALTH.*SERVICE|MEDTECH|MED.*DEVICE/.test(s))
    return { score:62, label:'MEDIUM-HIGH', drivers:'Under-penetrated healthcare, insurance expansion' };
  if (/SMALL.*FIN|MICRO.*FIN|NBFC|PRIV.*BANK/.test(s))
    return { score:60, label:'MEDIUM-HIGH', drivers:'Credit growth, banking formalisation, India consumption' };
  // MEDIUM (40–54)
  if (/TECH|SOFTWARE|IT |SAAS|INTERNET/.test(s))
    return { score:50, label:'MEDIUM', drivers:'Steady IT spend; near-term pressure from AI commoditisation' };
  if (/CONSUMER|FMCG|RETAIL.*BRAND|D2C|FOOD.*BEVER/.test(s))
    return { score:50, label:'MEDIUM', drivers:'Middle class + premiumisation; volume growth moderate' };
  if (/PHARMA|GENERIC.*DRUG|FORMULATION/.test(s))
    return { score:46, label:'MEDIUM', drivers:'US generic pricing pressure, USFDA compliance costs' };
  if (/AUTO.*ANC|COMPONENT|BEARING|TYRE/.test(s))
    return { score:44, label:'MEDIUM', drivers:'ICE→EV transition uncertainty on component mix' };
  // LOW (0–39) — structural headwinds or peak-cycle risk
  if (/METAL|STEEL|IRON|ALUMIN|COPPER|ZINC|CEMENT/.test(s))
    return { score:28, label:'LOW', drivers:'Commodity cycle, China oversupply risk, mean reversion' };
  if (/TEXTILE|COTTON|YARN|APPAREL|GARMENT|WEAV|DENIM/.test(s))
    return { score:30, label:'LOW', drivers:'Competition from Bangladesh/Vietnam, low pricing power' };
  if (/OIL|GAS|CRUDE|PETRO|REFIN/.test(s))
    return { score:25, label:'LOW', drivers:'Energy transition risk, volatile crude, margin pressure' };
  if (/SUGAR|TOBACCO|ALCOHOL|LIQUOR|GAMING/.test(s))
    return { score:22, label:'LOW', drivers:'Regulatory headwinds, excise risk, demand uncertainty' };
  return { score:50, label:'MEDIUM', drivers:'Sector-specific factors; no strong policy signal' };
}

// ── 8-TEST KILL-SWITCH ENGINE ─────────────────────────────────────────────────
// Converts quantitative metrics into 8 institutional-grade decision tests.
// Each check: pass=true (✅) | false (❌) | null (⬜ = insufficient data).
// A test PASSES when the majority of non-null automated checks pass.
export function computeKillSwitch(row: ExcelRow): KSTest[] {
  const b = SBENCH[getSectorKey(row.sector)] ?? SBENCH.DEFAULT;
  const cyclical = isCyclicalSector(row.sector);
  const tailwind = getSectorTailwind(row.sector);
  // ROIC: use direct field if available, else proxy from ROCE (ROIC ≈ ROCE × 0.75 post-tax)
  const roicEff = row.roic ?? (row.roce !== undefined ? Math.round(row.roce * 0.75 * 10) / 10 : undefined);
  const ks = (label: string, pass: boolean | null, detail: string): KSCheck => ({ label, pass, detail });
  const mkTest = (id: string, icon: string, label: string, checks: KSCheck[]): KSTest => {
    const nonNull = checks.filter(c => c.pass !== null);
    const passed  = nonNull.filter(c => c.pass === true).length;
    const failed  = nonNull.filter(c => c.pass === false).length;
    return { id, icon, label, checks, pass: nonNull.length === 0 ? false : passed >= Math.ceil(nonNull.length / 2), failCount: failed };
  };

  return [
    // ── 1. MOAT TEST ────────────────────────────────────────────────────────────
    mkTest('moat', '🧠', 'Moat Test', [
      // Pricing power: GPM > 30% OR (OPM above sector median AND expanding)
      ks('Pricing power',
        row.gpm !== undefined ? row.gpm > 30 :
        (row.opm !== undefined ? row.opm >= b.opm[1] && (row.opmExpansion ?? 0) >= 0 : null),
        row.gpm !== undefined ? `GPM ${row.gpm.toFixed(1)}% (>30% = pricing power)` :
        row.opm !== undefined ? `OPM ${row.opm.toFixed(1)}% vs sector median ${b.opm[1]}%` : 'No gross margin data'),
      // Switching cost / moat strength: ROCE sustained above cost of capital
      ks('Sustainable returns',
        roicEff !== undefined ? roicEff >= 15 : (row.roce !== undefined ? row.roce >= 18 : null),
        roicEff !== undefined ? `ROIC ${roicEff.toFixed(1)}% — ${roicEff >= 20 ? 'well above WACC (durable moat)' : roicEff >= 15 ? 'above WACC' : 'near WACC (weak moat)'}` :
        'No ROIC/ROCE data'),
      // Earnings quality as governance/moat proxy
      ks('Earnings quality',
        row.cfoToPat !== undefined ? row.cfoToPat >= 0.8 : null,
        row.cfoToPat !== undefined ? `CFO/PAT ${row.cfoToPat.toFixed(2)}× — ${row.cfoToPat >= 0.8 ? 'earnings cash-backed' : 'earnings not fully cash-backed'}` : 'No CFO/PAT data'),
    ]),

    // ── 2. MARKET RUNWAY TEST ───────────────────────────────────────────────────
    mkTest('runway', '🌍', 'Market Runway Test', [
      // TAM supports 5-10x: company needs to be small enough (MCap < ₹10k Cr)
      ks('Small-base potential',
        row.marketCapCr !== undefined ? row.marketCapCr < 10000 : null,
        row.marketCapCr !== undefined ? `MCap ₹${row.marketCapCr >= 1000 ? (row.marketCapCr/1000).toFixed(1)+'k' : row.marketCapCr.toFixed(0)}Cr — ${row.marketCapCr < 2000 ? '✓ micro-cap, maximum runway' : row.marketCapCr < 10000 ? '✓ small-cap, good runway' : '× large-cap, limited 10× potential'}` : 'No MCap data'),
      // Company share < 10% of industry: FII+DII < 25% = undiscovered = early innings
      ks('Undiscovered',
        row.fiiPlusDii !== undefined ? row.fiiPlusDii < 25 : null,
        row.fiiPlusDii !== undefined ? `FII+DII ${row.fiiPlusDii.toFixed(1)}% — ${row.fiiPlusDii < 10 ? '✓ largely undiscovered' : row.fiiPlusDii < 25 ? '✓ early institutional' : '× well-owned, re-rating already priced'}` : 'No FII/DII data'),
      // Structural tailwind exists
      ks('Structural tailwind',
        tailwind.score >= 60,
        `${tailwind.label} (${tailwind.score}/100) — ${tailwind.drivers.slice(0, 50)}`),
    ]),

    // ── 3. REVENUE QUALITY TEST ─────────────────────────────────────────────────
    mkTest('rev_quality', '🔁', 'Revenue Quality Test', [
      // Not cyclical spike: sustained growth across multiple years
      ks('Not cyclical spike',
        row.salesGrowth3y !== undefined ? !cyclical && row.salesGrowth3y > 10 :
        (row.revCagr !== undefined ? !cyclical && row.revCagr > 12 : null),
        row.salesGrowth3y !== undefined ? `3yr CAGR ${row.salesGrowth3y.toFixed(1)}% — ${cyclical ? '⚠ cyclical sector, spike risk' : !cyclical && row.salesGrowth3y > 10 ? '✓ sustained' : '× low sustained growth'}` :
        row.revCagr !== undefined ? `Rev CAGR ${row.revCagr.toFixed(1)}%, ${cyclical ? 'cyclical sector' : 'non-cyclical'}` : 'No growth data'),
      // Cash-backed revenue (not paper revenue)
      ks('Cash-backed revenue',
        row.cfoToPat !== undefined ? row.cfoToPat >= 0.7 : null,
        row.cfoToPat !== undefined ? `CFO/PAT ${row.cfoToPat.toFixed(2)}× — ${row.cfoToPat >= 0.7 ? '✓ cash-backed' : '× revenue not converting to cash'}` : 'No CFO data'),
      // Margin quality: not thin-margin commodity business
      ks('Margin quality',
        row.gpm !== undefined ? row.gpm > 20 : (row.opm !== undefined ? row.opm >= b.opm[0] : null),
        row.gpm !== undefined ? `GPM ${row.gpm.toFixed(1)}%` :
        row.opm !== undefined ? `OPM ${row.opm.toFixed(1)}% vs sector p25 ${b.opm[0]}%` : 'No margin data'),
    ]),

    // ── 4. CAPITAL ALLOCATION TEST ──────────────────────────────────────────────
    mkTest('capital', '💰', 'Capital Allocation Test', [
      // No excessive dilution: promoter not selling significantly
      ks('No dilution',
        row.changeInPromoter !== undefined ? row.changeInPromoter >= -2 : null,
        row.changeInPromoter !== undefined ? `Promoter ${row.changeInPromoter >= 0 ? '+' : ''}${row.changeInPromoter.toFixed(1)}% — ${row.changeInPromoter >= 0.5 ? '✓ buying (conviction)' : row.changeInPromoter >= -1 ? '✓ stable' : '× selling (watch)'}` : 'No promoter change data'),
      // Capex creating returns > ROCE: incremental ROCE stable/rising
      ks('Capex creating returns',
        row.roceExpansion !== undefined ? row.roceExpansion >= 0 : null,
        row.roceExpansion !== undefined ? `Incremental ROCE ${row.roceExpansion >= 0 ? '+' : ''}${row.roceExpansion.toFixed(1)}pp — ${row.roceExpansion >= 3 ? '✓ capex highly productive' : row.roceExpansion >= 0 ? '✓ capex stable' : '× capex diluting returns'}` : 'No ROCE 3yr data'),
      // Efficient reinvestment: ROIC > 12% and FCF positive
      ks('Reinvests efficiently',
        roicEff !== undefined && row.fcfAbsolute !== undefined ? roicEff >= 12 && row.fcfAbsolute > 0 :
        roicEff !== undefined ? roicEff >= 12 : null,
        roicEff !== undefined ? `ROIC ${roicEff.toFixed(1)}%${row.fcfAbsolute !== undefined ? ` · FCF ${row.fcfAbsolute > 0 ? '+' : ''}₹${row.fcfAbsolute.toFixed(0)}Cr` : ''}` : 'No ROIC data'),
    ]),

    // ── 5. COMPETITIVE STABILITY TEST ──────────────────────────────────────────
    mkTest('competitive', '⚔️', 'Competitive Stability Test', [
      // Margins stable across cycles: OPM not collapsing
      ks('Margins stable',
        row.opmExpansion !== undefined ? row.opmExpansion >= -4 :
        (row.opm !== undefined ? row.opm >= b.opm[0] : null),
        row.opmExpansion !== undefined ? `OPM trend ${row.opmExpansion >= 0 ? '+' : ''}${row.opmExpansion.toFixed(1)}pp (${row.opm3yr !== undefined ? '3yr' : '1yr'}) — ${row.opmExpansion >= 0 ? '✓ expanding' : row.opmExpansion >= -4 ? '→ stable' : '× compressing'}` :
        row.opm !== undefined ? `OPM ${row.opm.toFixed(1)}% vs sector p25 ${b.opm[0]}%` : 'No OPM trend data'),
      // No structural commoditization: not in cyclical sector AND ROCE holding
      ks('No commoditization',
        !cyclical && (roicEff === undefined || roicEff >= 12),
        cyclical ? `⚠ Cyclical sector (${row.sector}) — earnings mean-revert` :
        roicEff !== undefined ? `Non-cyclical · ROIC ${roicEff.toFixed(1)}%` : `Non-cyclical sector`),
      // GPM stability as moat durability check
      ks('Gross margin durability',
        row.gpm !== undefined ? row.gpm > 25 : (row.roce !== undefined ? row.roce >= 15 : null),
        row.gpm !== undefined ? `GPM ${row.gpm.toFixed(1)}% — ${row.gpm > 40 ? '✓ strong moat (hard to commoditize)' : row.gpm > 25 ? '✓ sustainable margins' : '× thin gross margins'}` :
        row.roce !== undefined ? `ROCE ${row.roce.toFixed(1)}% (proxy for durability)` : 'No GPM/ROCE data'),
    ]),

    // ── 6. GOVERNANCE TEST ─────────────────────────────────────────────────────
    mkTest('governance', '🏛', 'Governance Test', [
      // Clean earnings: CFO/PAT ≥ 0.8 = auditor hasn't flagged revenue manipulation
      ks('Clean earnings (CFO/PAT)',
        row.cfoToPat !== undefined ? row.cfoToPat >= 0.8 : null,
        row.cfoToPat !== undefined ? `CFO/PAT ${row.cfoToPat.toFixed(2)}× — ${row.cfoToPat >= 1.0 ? '✓ excellent (earnings + depreciation)' : row.cfoToPat >= 0.8 ? '✓ clean' : row.cfoToPat >= 0.5 ? '→ partial (watch)' : '× earnings not cash-backed'}` : 'No CFO/PAT data'),
      // No pledge = no hidden leverage via promoter shares
      ks('No pledge/hidden leverage',
        row.pledge !== undefined ? row.pledge <= 5 : null,
        row.pledge !== undefined ? `Pledge ${row.pledge.toFixed(1)}% — ${row.pledge === 0 ? '✓ zero pledge (clean governance)' : row.pledge <= 5 ? '✓ minimal' : row.pledge <= 25 ? '→ watch (forced-sell risk if market falls)' : '× high pledge, forced-sell risk'}` : 'No pledge data'),
      // No off-balance sheet risk: ND/EBITDA < 2.5 and D/E < 1.5
      ks('No hidden leverage',
        row.netDebtEbitda !== undefined || row.de !== undefined ?
          (row.netDebtEbitda ?? 0) < 2.5 && (row.de ?? 0) < 1.5 : null,
        row.netDebtEbitda !== undefined ? `ND/EBITDA ${row.netDebtEbitda.toFixed(1)}× · D/E ${(row.de??0).toFixed(2)}×` :
        row.de !== undefined ? `D/E ${row.de.toFixed(2)}×` : 'No leverage data'),
    ]),

    // ── 7. REINVESTMENT ENGINE TEST ────────────────────────────────────────────
    mkTest('reinvest', '🔄', 'Reinvestment Engine Test', [
      // Incremental ROCE stable or rising (new capital as productive as legacy)
      ks('Incremental ROCE stable/rising',
        row.roceExpansion !== undefined ? row.roceExpansion >= -3 :
        (row.roce !== undefined ? row.roce >= 15 : null),
        row.roceExpansion !== undefined ? `ROCE Δ ${row.roceExpansion >= 0 ? '+' : ''}${row.roceExpansion.toFixed(1)}pp — ${row.roceExpansion >= 5 ? '✓ compounding' : row.roceExpansion >= 0 ? '✓ stable' : row.roceExpansion >= -3 ? '→ slight dilution (monitor)' : '× reinvestment destroying value'}` :
        row.roce !== undefined ? `ROCE ${row.roce.toFixed(1)}% — proxy for reinvestment quality` : 'No ROCE data'),
      // FCF + growth: self-funding = no dilution needed
      ks('Self-funding growth',
        row.fcfAbsolute !== undefined && row.revCagr !== undefined ?
          row.fcfAbsolute > 0 && row.revCagr > 10 : null,
        row.fcfAbsolute !== undefined ? `FCF ₹${row.fcfAbsolute.toFixed(0)}Cr · Rev CAGR ${(row.revCagr??0).toFixed(0)}% — ${row.fcfAbsolute > 0 && (row.revCagr??0) > 10 ? '✓ high-growth AND self-funded' : row.fcfAbsolute > 0 ? '→ FCF+ but growth slow' : '× FCF negative (capex-intensive phase)'}` : 'No FCF data'),
    ]),

    // ── 8. DOWNSIDE STRESS TEST ────────────────────────────────────────────────
    mkTest('stress', '⚠️', 'Downside Stress Test', [
      // Survives 30-50% earnings decline: low leverage = can survive
      ks('Leverage buffer',
        row.de !== undefined ? row.de < 0.8 : null,
        row.de !== undefined ? `D/E ${row.de.toFixed(2)}× — ${row.de <= 0.1 ? '✓ debt-free, max resilience' : row.de < 0.5 ? '✓ low leverage' : row.de < 0.8 ? '→ moderate (survives 30% decline)' : '× high leverage, existential risk in downturn'}` : 'No D/E data'),
      // No existential liquidity risk: ND/EBITDA < 2 or net cash
      ks('No liquidity risk',
        row.netDebtEbitda !== undefined ? row.netDebtEbitda < 2.0 :
        (row.icr !== undefined ? row.icr > 4 : null),
        row.netDebtEbitda !== undefined ? `ND/EBITDA ${row.netDebtEbitda.toFixed(1)}× — ${row.netDebtEbitda < 0 ? '✓ net cash' : row.netDebtEbitda < 1 ? '✓ minimal net debt' : row.netDebtEbitda < 2 ? '→ manageable' : '× high debt load (liquidity risk)'}` :
        row.icr !== undefined ? `ICR ${row.icr.toFixed(1)}× — ${row.icr > 6 ? '✓ strong coverage' : row.icr > 3 ? '→ adequate' : '× weak coverage'}` : 'No debt/ICR data'),
      // Earnings cushion via growth rate: high compounders survive better
      ks('Earnings cushion',
        row.profitCagr !== undefined && row.cfoToPat !== undefined ?
          row.profitCagr > 15 && row.cfoToPat >= 0.7 : null,
        row.profitCagr !== undefined ? `PAT CAGR ${row.profitCagr.toFixed(0)}% · CFO/PAT ${(row.cfoToPat??0).toFixed(2)}× — ${row.profitCagr > 20 && (row.cfoToPat??0) >= 0.8 ? '✓ strong cushion' : '→ moderate cushion'}` : 'No earnings data'),
    ]),
  ];
}

// ── FORCED RANKING — institutional grade distribution ─────────────────────────
// Converts absolute score into a relative rank. Top 10% = A+, not every stock >80.
// This matches how institutional funds actually construct watchlists:
// only the top 5-10% of a screen is actionable; the rest is monitor-only.
export function applyForcedRanking(results: ExcelResult[]): ExcelResult[] {
  if (results.length === 0) return results;
  const n = results.length;
  return results.map((r, idx) => {
    // idx=0 is highest score (already sorted descending)
    const pct = idx / n;
    let grade: Grade;
    if      (pct < 0.10) grade = 'A+'; // top 10%
    else if (pct < 0.28) grade = 'A';  // next 18%
    else if (pct < 0.55) grade = 'B+'; // next 27%
    else if (pct < 0.75) grade = 'B';  // next 20%
    else if (pct < 0.88) grade = 'C';  // next 13%
    else                 grade = 'D';  // bottom 12%

    // ── GRADE CONSISTENCY GATE ───────────────────────────────────────────────
    // "Score/grade inconsistency with risk text creates trust friction" — fix:
    // A+ requires ALL survival signals to be reasonably clean. If the risk panel
    // shows serious flaws, the grade must not say A+.

    const hasCrit  = r.redFlags.some(f => f.severity === 'CRITICAL');
    const highCnt  = r.redFlags.filter(f => f.severity === 'HIGH').length;
    // Count how many hard-penalty items appear in risks
    const hardPenaltyCount = r.risks.filter(s => s.startsWith('Hard ')).length;

    // CRITICAL flag → never A+ or A (trust-breaking inconsistency)
    if (hasCrit && (grade === 'A+' || grade === 'A')) grade = 'B+';

    // 2+ HIGH flags → never A+ (multiple structural failures)
    if (highCnt >= 2 && grade === 'A+') grade = 'A';

    // 3+ hard penalties → never A+ (too many structural issues to be top pick)
    if (hardPenaltyCount >= 3 && grade === 'A+') grade = 'A';

    // Missing FCF data + A+ grade → inconsistency: we don't know if self-funded
    // (FCF is in the A+ gate, but if not in data, can't confirm gate passed)
    // Note: already handled by A+ gate in scoreExcelRow — this is a safety net

    // ── BAD RERATE: Specific structural issues that override rank position ───────
    // These catch cases where a stock ranks high by score but has a disqualifying
    // structural issue that the rank algorithm doesn't see directly.

    // Ownership vacuum in top picks → never A+ (no meaningful owner backing)
    // DRC Systems pattern: 20% promoter + 0% FII/DII = neither founder nor institutional conviction
    if (r.ownershipCategory === 'OWNERSHIP_VACUUM' && grade === 'A+') {
      grade = 'A';
    }

    // Below DMA200 + A+ = price contradicts fundamental strength claim
    // "Top pick" should have price action confirming the thesis
    if ((r.aboveDMA200 ?? 0) < -8 && grade === 'A+') {
      grade = 'A';
    }

    // STABLE acceleration in Emerging Multibagger bucket + A+ = contradiction
    // An "Emerging Multibagger" getting A+ with STABLE growth hasn't emerged yet
    if (r.bucket === 'EMERGING_MULTIBAGGER' && r.accelSignal !== 'ACCELERATING' && grade === 'A+') {
      grade = 'A';
    }

    // ── GOOD RERATE: Confirm genuinely clean stocks deserve their grade ───────────
    // A stock that passes ALL of these simultaneously is a genuine top-tier candidate
    // and should not be penalised for being in a non-Core bucket.
    // (This won't promote beyond what rank already gave, but ensures no spurious demotion)
    const isGenuinelyClean = r.decisionStrip.survival.pass &&
      r.decisionStrip.acceleration.pass &&
      r.decisionStrip.discovery.pass &&
      r.redFlags.length === 0 &&
      (r.cfoToPat ?? 0) >= 0.8 &&
      (r.de ?? 0) <= 0.5 &&
      (r.promoter ?? 0) >= 40 &&
      r.accelSignal === 'ACCELERATING';
    // If genuinely clean and got demoted by bucket override, hold at A minimum
    if (isGenuinelyClean && (grade === 'B+' || grade === 'B') && r.bucket !== 'MONITOR') {
      grade = 'A';
    }

    // ── EXTREME GROWTH FALSE POSITIVE RULE ──────────────────────────────────
    // Silkflex pattern: Sales +200%, FCF negative, D/E > 1 = classic small-cap spike risk
    // The model rewards growth but misses fragility when multiple risk factors compound.
    const GRADE_DOWN: Record<Grade, Grade> = {'A+':'A','A':'B+','B+':'B','B':'C','C':'D','D':'D','NR':'NR'};
    if ((r.revCagr ?? 0) > 150 && (r.fcfAbsolute ?? 1) < 0 && (r.de ?? 0) > 1.0) {
      grade = GRADE_DOWN[grade] as Grade; // forced 1-tier downgrade
    }

    // Bucket overrides: MONITOR → max B, HIGH_RISK → max A (rank-independent)
    if (r.bucket === 'MONITOR'   && !['C','D'].includes(grade))  grade = 'B';
    if (r.bucket === 'HIGH_RISK' && grade === 'A+')               grade = 'A';

    // ── MARKET CAP FILTER ────────────────────────────────────────────────────
    // A ₹1L Cr company cannot 100x. Mathematical impossibility filter.
    // MCap > ₹20,000 Cr → max B (still worth owning, but not a 100-bagger from here)
    if ((r.marketCapCr ?? 0) > 20000 && ['A+','A','B+'].includes(grade)) {
      grade = 'B';
    }

    // ── SPECULATIVE JUNK FILTER ───────────────────────────────────────────────
    // RHETAN TMT pattern: P/E 276, ROCE 4.5%, MoS -92%
    // High PE + no real earnings power + wildly overvalued = speculative trap
    if ((r.pe ?? 0) > 150 && (r.roce ?? 99) < 12 && (r.marginOfSafety ?? 0) < -75) {
      if (['A+','A','B+','B'].includes(grade)) grade = 'C';
    }

    // ── QUALITY SANCTUARY ────────────────────────────────────────────────────
    // SIGMA SOLVE pattern: ROCE 40%+, FCF+, D/E < 0.3, small-cap, cheap PE
    // These are businesses worth accumulating on weakness — rescue from monitor/red
    const isQualitySanctuary = (r.roce ?? 0) > 40 &&
      (r.fcfAbsolute ?? -1) > 0 &&
      (r.de ?? 99) < 0.3 &&
      (r.marketCapCr ?? 99999) < 5000 &&
      (r.pe ?? 999) < 25;
    if (isQualitySanctuary && ['D','C'].includes(grade)) grade = 'B';

    // ── ABSOLUTE FINAL ENFORCEMENT ───────────────────────────────────────────
    // These caps cannot be bypassed by ANY prior step (rank, good rerate, bucket override).
    // Order: CFO → D/E → MoS → profitAccel (each can only lower, never raise)

    // CFO/PAT < 0.8 → max B+ (earnings quality too weak for A-tier conviction)
    // Note: undefined cfoToPat is treated as unknown, so cap does NOT fire (data gap ≠ bad quality)
    if (r.cfoToPat !== undefined && r.cfoToPat >= 0 && r.cfoToPat < 0.8) {
      if (grade === 'A+' || grade === 'A') grade = 'B+';
    }

    // D/E > 1.0 → max B (leverage risk incompatible with 100-bagger profile)
    if (r.de !== undefined && r.de > 1.0) {
      if (['A+','A','B+'].includes(grade)) grade = 'B';
    }

    // MoS worse than -50% → no A grades (structural overvaluation vs intrinsic)
    if (r.marginOfSafety !== undefined && r.marginOfSafety < -50) {
      if (grade === 'A+' || grade === 'A') grade = 'B+';
    }

    // Profit deceleration worse than -25pp → cap at B (momentum destroyed)
    if (r.profitAcceleration !== undefined && r.profitAcceleration < -25) {
      if (['A+','A','B+'].includes(grade)) grade = 'B';
    }

    // ── KILL-SWITCH GRADE CAP ─────────────────────────────────────────────────
    // If the 8-test kill-switch shows structural failures, cap accordingly.
    // Tests with insufficient data (all checks null) are excluded from the count.
    const ksTests = r.killSwitch ?? [];
    const ksTestedCount = ksTests.filter(t => t.checks.some(c => c.pass !== null)).length;
    if (ksTestedCount >= 4) {
      const ksFailed = ksTests.filter(t => !t.pass && t.checks.some(c => c.pass !== null)).length;
      // 4+ tests fail → max B+ (structural concerns, not investment-grade picks)
      if (ksFailed >= 4 && ['A+','A'].includes(grade)) grade = 'B+';
      // 5+ tests fail → max B (too many fundamental failures for conviction)
      if (ksFailed >= 5 && grade === 'B+') grade = 'B';
    }

    // ─────────────────────────────────────────────────────────────────────
    // PATCH 0116 — BUG-06: explicit hard-threshold grade rules.
    // The percentile-based ranking above can hand A+ to mediocre stocks in
    // weak universes (10 stocks → top 1 gets A+ even if margins are flat).
    // These are absolute gates — A+ requires PROVING margin expansion
    // AND earnings acceleration AND reasonable valuation.
    //   A+ : opmExpansion ≥ 3pp AND eps_growth ≥ 30% AND peg ≤ 1.5
    //   A  : opmExpansion ≥ 1pp AND eps_growth ≥ 20% AND peg ≤ 2.5
    //   ≤B : decelerating (profitAcceleration < 0)
    //   ≤C : decelerating AND margin contracting
    // Rules only fire when the relevant fields are populated — data-gap
    // safety: missing field cannot block, but also cannot promote.
    // ─────────────────────────────────────────────────────────────────────
    const opmExp = r.opmExpansion;
    const epsG   = r.epsGrowth;
    const peg    = r.peg;
    const pa     = r.profitAcceleration;

    if (grade === 'A+') {
      // A+ HARD GATE — three-way confirmation required
      const aplusOPM  = opmExp !== undefined ? opmExp >= 3   : null;
      const aplusEPS  = epsG   !== undefined ? epsG   >= 30  : null;
      const aplusPEG  = peg    !== undefined ? peg    <= 1.5 : null;
      // any explicit FAIL drops to A (any null is treated as 'unknown, allow')
      if (aplusOPM === false || aplusEPS === false || aplusPEG === false) {
        grade = 'A';
      }
    }
    if (grade === 'A') {
      const aOPM = opmExp !== undefined ? opmExp >= 1  : null;
      const aEPS = epsG   !== undefined ? epsG   >= 20 : null;
      const aPEG = peg    !== undefined ? peg    <= 2.5 : null;
      if (aOPM === false || aEPS === false || aPEG === false) {
        grade = 'B+';
      }
    }
    // Decelerating profit caps everything below A
    if (pa !== undefined && pa < 0) {
      if (['A+','A','B+'].includes(grade)) grade = 'B';
      // decel + margin contracting = no rerate setup, cap at C
      if (opmExp !== undefined && opmExp < 0 && !['D'].includes(grade)) {
        grade = 'C';
      }
    }

    return { ...r, grade };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 1044 — FRAUD RISK DNA LAYER
// ═══════════════════════════════════════════════════════════════════════════
// Encodes 6 CRITICAL + 7 HIGH + 5 MEDIUM fraud signatures distilled from 80
// historical Indian/global fraud cases (Satyam, Manpasand, Vakrangee, DHFL,
// Wirecard, Luckin, Coffee Day, Zee, Reliance Communications, etc.).
// Each rule sector-exempted where the metric is structurally meaningless
// (banks have de > 5 by design, REITs have low FCF by design, etc.).
// Output is pushed into redFlags BEFORE the hasCritFinal recompute, so the
// existing cap chain (CRITICAL→38 / 2×HIGH→48 / 1×HIGH→60) does the binding.
function computeFraudRiskFlags(
  row: ExcelRow
): Array<{label:string; severity:'CRITICAL'|'HIGH'|'MEDIUM'; source:string; kind?:'STRUCTURAL'|'CYCLICAL'}> {
  const flags: Array<{label:string; severity:'CRITICAL'|'HIGH'|'MEDIUM'; source:string; kind?:'STRUCTURAL'|'CYCLICAL'}> = [];
  const _sector = (row.sector || '').toLowerCase();
  const _isFinSector = /bank|insurance|finance|capital markets|asset management|reit|invit/.test(_sector);
  const _isRetailSector = /retail|consumer|trading/.test(_sector);
  const _isHighGrowthExempt = /tech|software|it services|pharma|biotech|healthcare/.test(_sector);
  const cfoToPat=row.cfoToPat, profitCagr=row.profitCagr, revCagr=row.revCagr, fcf=row.fcfAbsolute;
  const pledge=row.pledge, de=row.de, dProm=row.changeInPromoter, promoter=row.promoter;
  const pe=row.pe, peg=row.peg, pctFrom52w=row.pctFrom52wHigh, mcap=row.marketCapCr;
  const fpd=row.fiiPlusDii, icr=row.icr, debtorDays=row.debtorDays;
  const yoySales=row.yoySalesGrowth, yoyProfit=row.yoyProfitGrowth, roce=row.roce, evEbitda=row.evEbitda;
  const fired: Record<string, boolean> = {};
  // ── CRITICAL (each caps composite at 38) ──
  if (!_isFinSector && cfoToPat!==undefined && cfoToPat<0.5 && profitCagr!==undefined && profitCagr>15 && fcf!==undefined && fcf<0) {
    flags.push({label:`Earnings without cash (CFO/PAT ${cfoToPat.toFixed(2)} · profit CAGR ${profitCagr.toFixed(0)}% · FCF negative)`,severity:'CRITICAL',source:'fraud:C1-earnings-without-cash',kind:'STRUCTURAL'}); fired['C1']=true;
  }
  if (pledge!==undefined && pledge>50 && ((de!==undefined && de>1.5) || (dProm!==undefined && dProm<-2))) {
    flags.push({label:`Pledge cascade (pledge ${pledge.toFixed(0)}% with leverage/exit amplifier)`,severity:'CRITICAL',source:'fraud:C2-pledge-cascade',kind:'STRUCTURAL'}); fired['C2']=true;
  }
  if (dProm!==undefined && dProm<-5 && pe!==undefined && pe>40 && pctFrom52w!==undefined && pctFrom52w>-20) {
    flags.push({label:`Smart-money exit at premium (Δpromoter ${dProm.toFixed(1)}pp · PE ${pe.toFixed(0)} · ${pctFrom52w.toFixed(0)}% from 52w high)`,severity:'CRITICAL',source:'fraud:C3-smart-money-exit',kind:'STRUCTURAL'}); fired['C3']=true;
  }
  if (promoter!==undefined && promoter<15 && mcap!==undefined && mcap<1000 && fpd!==undefined && fpd<5) {
    flags.push({label:`Operator/shell setup (promoter ${promoter.toFixed(0)}% · mcap ₹${mcap.toFixed(0)}Cr · FII+DII ${fpd.toFixed(1)}%)`,severity:'CRITICAL',source:'fraud:C4-operator-shell',kind:'STRUCTURAL'}); fired['C4']=true;
  }
  if (!_isFinSector && roce!==undefined && roce>25 && fcf!==undefined && fcf<0 && de!==undefined && de>1.5) {
    flags.push({label:`Ghost ROCE / leverage trap (ROCE ${roce.toFixed(0)}% claimed · FCF negative · D/E ${de.toFixed(1)})`,severity:'CRITICAL',source:'fraud:C5-ghost-roce',kind:'STRUCTURAL'}); fired['C5']=true;
  }
  if (_isFinSector && dProm!==undefined && dProm<-3 && pe!==undefined && pe<15 && pctFrom52w!==undefined && pctFrom52w>-50) {
    flags.push({label:`Banking NPA proxy (financial sector · Δpromoter ${dProm.toFixed(1)}pp at PE ${pe.toFixed(0)} · only ${pctFrom52w.toFixed(0)}% off high)`,severity:'CRITICAL',source:'fraud:C6-banking-npa-proxy',kind:'STRUCTURAL'}); fired['C6']=true;
  }
  // ── HIGH STRUCTURAL (cap at 60 single / 48 double) ──
  if (!_isFinSector && cfoToPat!==undefined && cfoToPat>=0.5 && cfoToPat<0.8 && profitCagr!==undefined && profitCagr>20) {
    flags.push({label:`CFO/PAT ${cfoToPat.toFixed(2)} below profit CAGR ${profitCagr.toFixed(0)}% — cash conversion gap`,severity:'HIGH',source:'fraud:H1-cfo-gap',kind:'STRUCTURAL'});
  }
  if (pledge!==undefined && pledge>=25 && pledge<=50) {
    flags.push({label:`Pledge ${pledge.toFixed(0)}% (25–50% danger zone)`,severity:'HIGH',source:'fraud:H2-pledge-mid',kind:'STRUCTURAL'});
  }
  if (dProm!==undefined && dProm<=-2 && dProm>-5) {
    flags.push({label:`Promoter selling ${dProm.toFixed(1)}pp over 3y (sustained distribution)`,severity:'HIGH',source:'fraud:H3-promoter-selling',kind:'STRUCTURAL'});
  }
  if (!_isFinSector && !_isRetailSector && debtorDays!==undefined && debtorDays>120) {
    flags.push({label:`Debtor days ${debtorDays.toFixed(0)} (>120 — receivable buildup / channel stuffing risk)`,severity:'HIGH',source:'fraud:H4-debtor-buildup',kind:'STRUCTURAL'});
  }
  if (!_isFinSector && revCagr!==undefined && revCagr>35 && cfoToPat!==undefined && cfoToPat<0.8) {
    flags.push({label:`Acquirer-rollup proxy (rev CAGR ${revCagr.toFixed(0)}% · CFO/PAT ${cfoToPat.toFixed(2)})`,severity:'HIGH',source:'fraud:H5-rollup',kind:'STRUCTURAL'});
  }
  if (!_isFinSector && icr!==undefined && icr<2.0 && de!==undefined && de>1.5) {
    flags.push({label:`ICR ${icr.toFixed(1)} with D/E ${de.toFixed(1)} (debt service fragile)`,severity:'HIGH',source:'fraud:H6-icr-leverage',kind:'STRUCTURAL'});
  }
  if (!_isFinSector && mcap!==undefined && mcap<3000 && yoySales!==undefined && yoySales>60 && cfoToPat!==undefined && cfoToPat<0.7) {
    flags.push({label:`Microcap aggressive growth without cash (mcap ₹${mcap.toFixed(0)}Cr · YoY sales ${yoySales.toFixed(0)}% · CFO/PAT ${cfoToPat.toFixed(2)})`,severity:'HIGH',source:'fraud:H7-microcap-growth',kind:'STRUCTURAL'});
  }
  // ── MEDIUM (−5 each via existing penalty layer) ──
  if (cfoToPat!==undefined && cfoToPat>=0.8 && cfoToPat<1.0 && yoyProfit!==undefined && yoyProfit>40) {
    flags.push({label:`CFO/PAT ${cfoToPat.toFixed(2)} with YoY profit ${yoyProfit.toFixed(0)}% (mild cash gap)`,severity:'MEDIUM',source:'fraud:M1-mild-cash-gap'});
  }
  if (peg!==undefined && peg>5) {
    flags.push({label:`PEG ${peg.toFixed(1)} (>5 — valuation detached from growth)`,severity:'MEDIUM',source:'fraud:M2-peg-extreme'});
  }
  if (dProm!==undefined && dProm<=-1 && dProm>-2) {
    flags.push({label:`Promoter mild trim ${dProm.toFixed(1)}pp over 3y`,severity:'MEDIUM',source:'fraud:M3-promoter-trim'});
  }
  if (!_isFinSector && icr!==undefined && icr>=2.0 && icr<4.0) {
    flags.push({label:`ICR ${icr.toFixed(1)} (heavy interest burden)`,severity:'MEDIUM',source:'fraud:M4-icr-burden'});
  }
  if (!_isFinSector && !_isHighGrowthExempt && evEbitda!==undefined && evEbitda>40) {
    flags.push({label:`EV/EBITDA ${evEbitda.toFixed(0)} (>40 outside high-growth sector)`,severity:'MEDIUM',source:'fraud:M5-ev-ebitda-extreme'});
  }
  // ── COMPOUND NEVER-BUY guard ──
  const critFromLayer = flags.filter(f => f.severity === 'CRITICAL').length;
  const isPledgeExitArchetype = fired['C2'] && fired['C3'];
  const isPhantomEarningsArchetype = fired['C1'] && fired['C5'];
  if (isPledgeExitArchetype || isPhantomEarningsArchetype || critFromLayer >= 3) {
    flags.push({label:'NEVER BUY: Compound fraud-pattern (multiple fraud archetypes firing)',severity:'CRITICAL',source:'fraud:NEVERBUY-compound',kind:'STRUCTURAL'});
  }
  return flags;
}

export function scoreExcelRow(row: ExcelRow): ExcelResult {
  const b = SBENCH[getSectorKey(row.sector)] ?? SBENCH.DEFAULT;
  const cyclical = isCyclicalSector(row.sector);
  const strengths: string[] = [];
  const risks: string[] = [];
  const redFlags: { label:string; severity:'CRITICAL'|'HIGH'|'MEDIUM'; source:string; kind?: 'STRUCTURAL'|'CYCLICAL' }[] = [];

  // PRE-BUCKET: rough classification used to relax thresholds for Emerging bucket
  // (Full bucket classification happens after scoring)
  const isLikelyEmerging =
    (row.accelSignal === 'ACCELERATING' || (row.yoySalesGrowth ?? 0) >= 25) &&
    (row.marketCapCr ?? 99999) <= 10000;

  let qualS=0,qualC=0, growS=0,growC=0, accelS=50,accelC=1,
      longS=0,longC=0, finS=0,finC=0, valS=0, mktS=50,mktC=1;

  // PATCH 0717 — India DNA bullet de-dup (mirror of USA P0575/P0612/P0705).
  // The 500-bagger DNA bullet (line ~2339) cites Promoter+ROCE+CFO/PAT+FCF+D/E
  // +CAGR in one composite line. The standalone per-metric strength bullets
  // for these same data points (ROCE/CFO/promoter/FCF/D/E/CAGR) would then
  // create a triple-count in the strengths list. Compute the same DNA gate
  // up-front so the per-metric bullets can suppress themselves when the
  // richer DNA line will fire. Score-side weights are unchanged (pillars +
  // DNA bonus stay) — only the visible bullets are de-duplicated.
  const _dnaWillLikelyFire =
       (row.promoter ?? 0) >= 50 && (row.promoter ?? 0) <= 75
    && (row.roce ?? 0) > 25
    && (row.cfoToPat ?? 0) > 1.0
    && (row.fcfAbsolute ?? -1) > 0
    && (row.de ?? 99) < 0.3
    && !cyclical
    && (row.revCagr ?? 0) >= 18
    && (row.pledge ?? 0) === 0
    && (row.changeInPromoter ?? 0) >= -1;
  // Approximation: we don't yet know if any HIGH-structural red flag will
  // fire, so this gate is best-effort. Worst case if a flag fires later: the
  // DNA bonus is skipped and the standalone bullets are missing — acceptable
  // because the QUAL pillar still credits the underlying scores.

  // ── QUALITY (feeds qual pillar) ───────────────────────────────────────────
  if (row.roce!==undefined) {
    const s=sv(row.roce,b.roce); qualS+=s; qualC++;
    if (s>=80 && !_dnaWillLikelyFire) strengths.push(`ROCE ${row.roce.toFixed(1)}% — above sector, moat confirmed`); // PATCH 0717
    else if (s<45) risks.push(`ROCE ${row.roce.toFixed(1)}% — below sector benchmark`);
  }
  if (row.roe!==undefined)  { qualS+=sv(row.roe,[12,18,26]); qualC++; }
  if (row.opm!==undefined)  { qualS+=sv(row.opm,b.opm); qualC++; }
  if (row.cfoToPat!==undefined) {
    const s = row.cfoToPat>=1.0?90:row.cfoToPat>=0.8?78:row.cfoToPat>=0.5?55:row.cfoToPat>=0?32:15;
    qualS+=s; qualC++;
    if (row.cfoToPat>=1.0 && !_dnaWillLikelyFire) strengths.push(`CFO/PAT ${row.cfoToPat.toFixed(2)}x — excellent earnings quality`); // PATCH 0717
    if (row.cfoToPat<0) {
      risks.push(`Negative CFO/PAT — earnings not backed by cash`);
      // PATCH 1027: banks/insurance/NBFC operating cash flow is structurally lumpy due to loan disbursements
      const _s = (row.sector||'').toLowerCase();
      const _isFin = /bank|insurance|finance|capital markets|asset management/.test(_s);
      if (!_isFin) redFlags.push({label:'Negative cash flow from operations',severity:'HIGH',source:'Fisher'});
    }
  }
  if (row.fcfAbsolute!==undefined) {
    const s = row.fcfAbsolute>0?80:50;
    qualS+=s; qualC++;
    if (row.fcfAbsolute>0 && !_dnaWillLikelyFire) strengths.push(`FCF positive ₹${row.fcfAbsolute.toFixed(0)}Cr — self-funding growth`); // PATCH 0717
    else if (row.fcfAbsolute<=0) risks.push(`FCF negative — dependent on external capital`);
  }
  if (row.promoter!==undefined) {
    qualS+=sv(row.promoter,[20,40,60]); qualC++;
    if (row.promoter<20) {
      // PATCH 1027: Exchanges (BSE/MCX), PSU banks, widely-held insurance structurally have no promoter
      const _s2 = (row.sector||'').toLowerCase();
      // PATCH 1059 — Expand widely-held exemption to ALL financial sectors.
      // NBFCs, Finance companies, AMCs, REITs, InvITs all structurally have
      // <20% (or 0%) promoter holding because they're public-investor businesses.
      // Pre-1059 only `bank|capital markets|insurance` were exempt — NORTHARC
      // (sector="Finance"), SGFIN (sector="Finance"), AYE (NBFC) all false-
      // fired this HIGH flag. Now matches the same regex used for D/E and ICR.
      const _widelyHeld = /capital markets|insurance|^bank|finance|asset management|nbfc|reit|invit/.test(_s2);
      if (!_widelyHeld) redFlags.push({label:`Promoter ${row.promoter.toFixed(0)}% — very low`,severity:'HIGH',source:'MOSL+Fisher'});
    }
    if (row.promoter>=55 && !_dnaWillLikelyFire) strengths.push(`Promoter ${row.promoter.toFixed(0)}% — strong alignment`); // PATCH 0717
  }

  // ── GPM (Gross Profit Margin) — pricing power & moat signal ─────────────────
  // GPM > OPM gap shows operating leverage potential; high GPM = pricing power
  if (row.gpm !== undefined) {
    // Sector-aware GPM benchmarks: consumer/pharma expect >50%, industrial >25%
    const gpmBench = getSectorKey(row.sector) === 'TECHNOLOGY' ? [40,55,70] :
                     getSectorKey(row.sector) === 'PHARMA'     ? [45,58,72] :
                     getSectorKey(row.sector) === 'CONSUMER'   ? [30,45,60] :
                     getSectorKey(row.sector) === 'CHEMICALS'  ? [25,38,55] : [20,32,50];
    const gpmScore = sv(row.gpm, gpmBench);
    qualS += gpmScore * 0.7; qualC += 0.7; // weighted less than ROCE, but meaningful
    if (gpmScore >= 80) strengths.push(`GPM ${row.gpm.toFixed(1)}% — strong gross margin, pricing power confirmed`);
    else if (gpmScore < 40) risks.push(`GPM ${row.gpm.toFixed(1)}% — thin gross margins, limited pricing power`);
  }

  // ── ROIC (Return on Invested Capital) — true capital efficiency test ──────────
  // ROIC > WACC = value creation. ROIC > 15% = strong business. < 10% = destroys value.
  // If ROIC not provided, use ROCE as proxy (ROIC ≈ ROCE × 0.75 for typical tax rates)
  const roicEffective = row.roic ?? (row.roce !== undefined ? row.roce * 0.75 : undefined);
  if (roicEffective !== undefined) {
    const roicScore = roicEffective >= 25 ? 92 : roicEffective >= 18 ? 82 : roicEffective >= 12 ? 65 :
                      roicEffective >= 8  ? 48 : 28;
    qualS += roicScore * 0.8; qualC += 0.8;
    if (roicEffective >= 20) strengths.push(`ROIC ${roicEffective.toFixed(1)}% — well above cost of capital, durable value creation`);
    else if (roicEffective < 10) {
      // PATCH 1059 — For financial sectors (banks/NBFCs/AMCs) ROIC is the
      // wrong metric: their COGS is interest expense, the right metric is
      // ROE (typically 12-18% for healthy lenders). Use ROE<12 instead of
      // ROIC<WACC for those sectors. Prevents NORTHARC/MAHABANK/SURYODAY
      // from getting hit with HIGH structural flag when their fundamentals
      // are normal NBFC fundamentals, not industrial value destruction.
      const _isFinROIC = /bank|insurance|finance|capital markets|asset management|nbfc|reit|invit/.test((row.sector||'').toLowerCase());
      if (_isFinROIC) {
        if ((row.roe ?? 99) < 12) {
          risks.push(`ROE ${(row.roe ?? 0).toFixed(1)}% — below healthy-NBFC threshold of 12%`);
          redFlags.push({ label: `ROE ${(row.roe ?? 0).toFixed(1)}% — below NBFC standard`, severity: 'HIGH', source: 'Fisher ROE-for-finance' });
        }
      } else {
        risks.push(`ROIC ${roicEffective.toFixed(1)}% — below typical WACC (10%), capital allocation destroying value`);
        redFlags.push({ label: `ROIC ${roicEffective.toFixed(1)}% — below WACC`, severity: 'HIGH', source: 'Fisher ROIC' });
      }
    }
  }

  // ── GAP 1: INCREMENTAL ROCE — capital productivity on new investments ──────
  // "Does new capital earn at least as much as legacy capital?"
  // Rising ROCE = reinvestment is value-accretive (Fisher key test).
  // Falling ROCE despite high absolute level = growth is diluting returns (value trap).
  if (row.roceExpansion !== undefined) {
    if (row.roceExpansion > 8) {
      qualS += 18; qualC += 0.7;
      strengths.push(`Incremental ROCE +${row.roceExpansion.toFixed(1)}pp (3yr) — new capital highly productive`);
    } else if (row.roceExpansion > 3) {
      qualS += 10; qualC += 0.4;
      strengths.push(`ROCE expanding +${row.roceExpansion.toFixed(1)}pp — capital efficiency improving`);
    } else if (row.roceExpansion < -8) {
      qualS -= 12;
      risks.push(`Incremental ROCE −${Math.abs(row.roceExpansion).toFixed(1)}pp — growth diluting capital returns (value trap signal)`);
    } else if (row.roceExpansion < -3) {
      qualS -= 6;
      risks.push(`ROCE contracting −${Math.abs(row.roceExpansion).toFixed(1)}pp — watch capital allocation discipline`);
    }
  }

  // ── GAP 2: OPM EXPANSION — pricing power / revenue quality signal ──────────
  // "Revenue quality = can the company expand margins as it grows?"
  // OPM rising vs prior = structural pricing power, not just volume/inflation.
  // OPM falling = moat eroding, competition intensifying.
  if (row.opmExpansion !== undefined) {
    // Label period: 3yr if opm3yr data available, otherwise 1yr (opmPrev / "OPM last year")
    const opmPeriod = row.opm3yr !== undefined ? '3yr' : '1yr';
    if (row.opmExpansion > 5) {
      qualS += 14; qualC += 0.5;
      strengths.push(`OPM expanded +${row.opmExpansion.toFixed(1)}pp (${opmPeriod}) — pricing power confirmed, revenue quality high`);
    } else if (row.opmExpansion > 2) {
      qualS += 7; qualC += 0.25;
      strengths.push(`OPM improving +${row.opmExpansion.toFixed(1)}pp (${opmPeriod}) — margins trending right`);
    } else if (row.opmExpansion < -5) {
      qualS -= 10;
      risks.push(`OPM compressed −${Math.abs(row.opmExpansion).toFixed(1)}pp (${opmPeriod}) — pricing power eroding`);
    } else if (row.opmExpansion < -2) {
      qualS -= 5;
      risks.push(`OPM declining −${Math.abs(row.opmExpansion).toFixed(1)}pp (${opmPeriod}) — margin pressure, watch competitive dynamics`);
    }
  }

  // ── GAP 4: PROMOTER GOVERNANCE DEPTH (beyond holding %) ──────────────────
  // Pledge % already scored in FIN_STRENGTH — but compound pledge + low promoter = danger
  if (row.pledge !== undefined && row.promoter !== undefined) {
    if (row.pledge > 30 && row.promoter < 50) {
      redFlags.push({ label: `Pledge ${row.pledge.toFixed(0)}% + Promoter ${row.promoter.toFixed(0)}% — forced-sell spiral risk`, severity: 'HIGH', source: 'Fisher governance' });
      risks.push(`Governance risk: high pledge (${row.pledge.toFixed(0)}%) on already-modest holding (${row.promoter.toFixed(0)}%) = lender control risk`);
    }
  }

  // ── GROWTH (historical trajectory) ───────────────────────────────────────
  if (row.revCagr!==undefined) {
    const s=sv(row.revCagr,[8,15,25]); growS+=s; growC++;
    if (s>=80 && !_dnaWillLikelyFire) strengths.push(`Revenue CAGR ${row.revCagr.toFixed(1)}% — excellent growth engine`); // PATCH 0717
  }
  if (row.profitCagr!==undefined) {
    const s=sv(row.profitCagr,[10,20,30]); growS+=s; growC++;
    if (s>=85) strengths.push(`Profit CAGR ${row.profitCagr.toFixed(1)}% — compounding`);
  }
  if (row.epsGrowth!==undefined) { growS+=sv(row.epsGrowth,[10,20,35]); growC++; }

  // FIX #5: ROCE direction — low ROCE rising fast = early winner; high ROCE stagnating = late trap
  if (row.roce!==undefined && row.profitCagr!==undefined) {
    if (row.roce < 15 && row.profitCagr > 40) {
      growS += 8; growC += 0.4;
      strengths.push(`Low ROCE (${row.roce.toFixed(0)}%) + high profit growth (${row.profitCagr.toFixed(0)}%) = early compounder phase`);
    } else if (row.roce > 25 && (row.revCagr ?? 0) < 10) {
      growS -= 6; // late-stage, growth slowing despite quality
      risks.push(`High ROCE (${row.roce.toFixed(0)}%) but slow revenue growth (${(row.revCagr??0).toFixed(0)}%) — mature, limited re-rating ahead`);
    }
  }

  // ── ACCELERATION PILLAR (independent — most important for 100-baggers) ────
  // FIX #1+#2: Acceleration is its own pillar, not a sub-variable inside Growth.
  // This is the Framework Core Signal — trajectory change > static level.
  accelS = 50; accelC = 1;

  // Base acceleration from revenue trend
  if (row.accelSignal !== undefined) {
    const base = { 'ACCELERATING': 85, 'STABLE': 55, 'DECELERATING': 18 }[row.accelSignal];
    accelS = base + Math.min(10, (row.revenueAcceleration ?? 0) * 0.3);
    if (row.accelSignal === 'ACCELERATING') {
      strengths.push(`Revenue ACCELERATING: +${row.yoySalesGrowth?.toFixed(0)}% vs CAGR ${row.revCagr?.toFixed(0)}% (+${row.revenueAcceleration?.toFixed(0)}pp) — Framework Core Signal`);
    } else if (row.accelSignal === 'DECELERATING') {
      risks.push(`Revenue DECELERATING: ${row.yoySalesGrowth?.toFixed(0)}% vs CAGR ${row.revCagr?.toFixed(0)}% (${row.revenueAcceleration?.toFixed(0)}pp) — Framework rejection filter`);
      redFlags.push({ label: `Revenue decelerating`, severity: 'HIGH', source: 'Framework', kind: 'CYCLICAL' });
    }
  }
  // FIX #2+#3: Operating leverage as primary scored input in acceleration pillar
  // OpLev = YOY Profit / YOY Sales — this is THE multibagger inflection signal
  if (row.recentOpLev !== undefined && row.yoySalesGrowth !== undefined && row.yoySalesGrowth > 0) {
    const opLevScore = row.recentOpLev >= 2.0 ? 95 : row.recentOpLev >= 1.5 ? 85 : row.recentOpLev >= 1.0 ? 65 : 30;
    accelS = (accelS + opLevScore) / 2; // blend with acceleration signal
    accelC++;
    if (row.recentOpLev >= 2.0) strengths.push(`Op leverage ${row.recentOpLev.toFixed(1)}× — breakout phase (PAT ${row.yoyProfitGrowth?.toFixed(0)}% vs Sales ${row.yoySalesGrowth.toFixed(0)}%)`);
    else if (row.recentOpLev >= 1.5) strengths.push(`Op leverage ${row.recentOpLev.toFixed(1)}× — scaling well`);
    else if (row.recentOpLev < 1.0) risks.push(`Op leverage ${row.recentOpLev.toFixed(1)}× — costs growing faster than revenue`);
  }
  // Profit acceleration bonus
  if (row.profitAcceleration !== undefined) {
    if (row.profitAcceleration >= 15) { accelS = Math.min(100, accelS + 8); strengths.push(`Profit ACCELERATING +${row.profitAcceleration.toFixed(0)}pp above CAGR`); }
    else if (row.profitAcceleration <= -20) { accelS = Math.max(0, accelS - 8); risks.push(`Profit growth collapsing ${row.profitAcceleration.toFixed(0)}pp`); }
  }
  accelS = Math.max(0, Math.min(100, accelS));

  // Fix 5: Low-margin businesses can't sustain op leverage cycles.
  // Reduce acceleration pillar score by 20% if OPM below 12%.
  // Prevents commodity-thin businesses from scoring high on acceleration alone.
  if (row.opm !== undefined && row.opm < 12) {
    const penalty = accelS * 0.20;
    accelS = Math.max(0, accelS - penalty);
    risks.push(`Acceleration discounted 20%: OPM ${row.opm.toFixed(1)}% < 12% — low margins limit op leverage sustainability`);
  }

  // ── LONGEVITY — SQGLP "L" ─────────────────────────────────────────────────
  if (row.roce!==undefined && row.revCagr!==undefined) {
    const ls = (row.roce>=20 && row.revCagr>=15)?85:(row.roce>=15 && row.revCagr>=10)?65:45;
    longS+=ls; longC++;
  }
  // FIX #9: Nonlinear market cap scoring — tighter bands with more granularity at small end
  if (row.marketCapCr!==undefined) {
    const s = row.marketCapCr<300?98:row.marketCapCr<500?95:row.marketCapCr<1000?90:
              row.marketCapCr<2000?85:row.marketCapCr<5000?72:row.marketCapCr<10000?60:
              row.marketCapCr<25000?45:30;
    longS+=s; longC++;
    if (row.marketCapCr<500) strengths.push(`Market cap ₹${row.marketCapCr.toFixed(0)}Cr — maximum small-base runway`);
    else if (row.marketCapCr>25000) risks.push(`Market cap ₹${row.marketCapCr.toLocaleString()}Cr — large base limits upside`);
  }
  if (row.fiiPlusDii!==undefined) {
    const s = row.fiiPlusDii<10?90:row.fiiPlusDii<20?78:row.fiiPlusDii<35?62:45;
    longS+=s; longC++;
    if (row.fiiPlusDii<10) strengths.push(`FII+DII ${row.fiiPlusDii.toFixed(1)}% — largely undiscovered`);
    else if (row.fiiPlusDii>40) risks.push(`FII+DII ${row.fiiPlusDii.toFixed(1)}% — heavily institutionalised`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // PATCH 0116 — BUG-07: Long/Mark sub-scores use real discriminating
  // inputs.  Existing FII+DII level signal alone is too coarse — many
  // stocks share 5-15% institutional holding.  Add three more inputs:
  //   (a) acceleration bonus — ACCELERATING + low FII+DII is the
  //       early-discovery setup (institutional gap before they pile in)
  //   (b) founder conviction — promoter ≥45% AND changeInPromoter ≥ 0
  //       is the long-term-aligned operator pattern
  //   (c) track-record gate — revCagr ≥ 12% over published history
  //       proves the business actually compounds, not a one-quarter pop
  // Each fires only when data is present; missing fields don't count.
  // ─────────────────────────────────────────────────────────────────────
  if (row.accelSignal === 'ACCELERATING' && (row.fiiPlusDii ?? 50) < 15) {
    longS += 88; longC++;
    strengths.push(`Early-discovery setup: ACCELERATING growth + FII+DII ${(row.fiiPlusDii ?? 0).toFixed(1)}% — institutional gap`);
  } else if (row.accelSignal === 'DECELERATING') {
    longS += 30; longC++;
    risks.push(`Longevity downgraded — DECELERATING growth signal`);
  }
  if (row.promoter !== undefined && row.changeInPromoter !== undefined) {
    if (row.promoter >= 45 && row.changeInPromoter >= 0) {
      longS += 85; longC++;
      if (row.changeInPromoter > 0) strengths.push(`Long-term operator pattern: promoter ${row.promoter.toFixed(0)}% +${row.changeInPromoter.toFixed(1)}pp (buying)`);
    } else if (row.promoter < 30 && row.changeInPromoter < 0) {
      longS += 25; longC++;
      risks.push(`Operator pattern weak: promoter ${row.promoter.toFixed(0)}% selling ${row.changeInPromoter.toFixed(1)}pp`);
    }
  }
  if (row.revCagr !== undefined) {
    const trackScore = row.revCagr >= 25 ? 95 :
                       row.revCagr >= 18 ? 82 :
                       row.revCagr >= 12 ? 68 :
                       row.revCagr >= 6  ? 48 : 25;
    longS += trackScore; longC++;
    if (row.revCagr >= 18) strengths.push(`Track record: rev CAGR ${row.revCagr.toFixed(1)}% — proven compounding`);
    else if (row.revCagr < 6) risks.push(`Track record weak: rev CAGR ${row.revCagr.toFixed(1)}% — not a compounder yet`);
  }

  // ── FINANCIAL STRENGTH ────────────────────────────────────────────────────
  if (row.de!==undefined) {
    finS+=sv(row.de,[0.5,1.0,2.0],false); finC++;
    // PATCH 1029: banks/insurance/NBFC/AMC/capital-markets/REIT/InvIT carry 5-15× D/E structurally — leverage IS the business model.
    const _isFinLev1029de = /bank|insurance|finance|capital markets|asset management|reit|invit/.test((row.sector||'').toLowerCase());
    if (row.de>3.0 && !_isFinLev1029de) redFlags.push({label:`D/E ${row.de.toFixed(2)}× — CRITICAL debt`,severity:'CRITICAL',source:'Fisher'});
    else if (row.de>2.0 && !_isFinLev1029de) redFlags.push({label:`D/E ${row.de.toFixed(2)}× — high leverage`,severity:'HIGH',source:'Fisher'});
    if (row.de<=0.1 && !_dnaWillLikelyFire) strengths.push(`D/E ${row.de.toFixed(2)}× — debt-free`); // PATCH 0717
  }
  if (row.netDebtEbitda!==undefined) {
    const s = row.netDebtEbitda<0?95:row.netDebtEbitda<0.5?88:row.netDebtEbitda<1.5?72:row.netDebtEbitda<3?45:20;
    finS+=s; finC++;
    // PATCH 1029: ND/EBITDA meaningless for banks/insurance (EBITDA doesn't capture net interest income); same exclusion as D/E.
    const _isFinLev1029nd = /bank|insurance|finance|capital markets|asset management|reit|invit/.test((row.sector||'').toLowerCase());
    if (row.netDebtEbitda>3.0 && !_isFinLev1029nd) redFlags.push({label:`ND/EBITDA ${row.netDebtEbitda.toFixed(1)}× — Fisher FAIL`,severity:'CRITICAL',source:'Fisher'});
    else if (row.netDebtEbitda>1.5 && !_isFinLev1029nd) redFlags.push({label:`ND/EBITDA ${row.netDebtEbitda.toFixed(1)}× — above Fisher threshold`,severity:'HIGH',source:'Fisher'});
    if (row.netDebtEbitda<0) strengths.push(`Net cash company`);
  }
  if (row.pledge!==undefined) {
    finS+=sv(row.pledge,[2,10,25],false); finC++;
    if (row.pledge>50) redFlags.push({label:`Pledge ${row.pledge.toFixed(0)}% — CRITICAL`,severity:'CRITICAL',source:'Fisher'});
    else if (row.pledge>25) redFlags.push({label:`Pledge ${row.pledge.toFixed(0)}% — risky`,severity:'HIGH',source:'Fisher'});
    if (row.pledge<1 && !_dnaWillLikelyFire) strengths.push(`Zero pledge`); // PATCH 0717
  }
  if (row.changeInPromoter!==undefined) {
    const s = row.changeInPromoter>1?85:row.changeInPromoter>0?72:row.changeInPromoter>-1?55:30;
    finS+=s; finC++;
    if (row.changeInPromoter<-2) redFlags.push({label:`Promoter sold −${Math.abs(row.changeInPromoter).toFixed(1)}%`,severity:'MEDIUM',source:'Fisher'});
    if (row.changeInPromoter>1) {
      if ((row.promoter??0)>=40) strengths.push(`Promoter bought +${row.changeInPromoter.toFixed(1)}% (${row.promoter?.toFixed(0)}%) — insider conviction`);
      else risks.push(`Promoter bought but holding (${row.promoter?.toFixed(0)}%) still below 40%`);
    }
  }
  if (row.icr!==undefined) {
    finS+=sv(row.icr,[2,5,10]); finC++;
    // PATCH 1029: banks/insurance/NBFC structurally have low ICR — interest is COGS, not coverage stress.
    const _isFinLev1029icr = /bank|insurance|finance|capital markets|asset management|reit|invit/.test((row.sector||'').toLowerCase());
    if (row.icr<1.5 && !_isFinLev1029icr) redFlags.push({label:`ICR ${row.icr.toFixed(1)}× — dangerously low`,severity:'CRITICAL',source:'Fisher'});
  }

  // ── VALUATION — (PEG + PE-percentile + MoS) / 3 ──────────────────────────
  // FIX #6: Relax valuation strictness for high-growth companies.
  // All true multibaggers look "expensive" at entry. PEG penalty removed if rev growth >25%.
  // PATCH 1051 — Tightened: the isHighGrowth bypass must NOT apply when PEG > 3.
  // Pre-1051 bug: HARDWYN had revCagr ~50% AND PEG 7.98 → isHighGrowth=true → PE/PEG
  // extreme-value flags suppressed → scored 55 B+. The bypass should only protect
  // names where growth justifies the multiple. PEG > 3 means even the growth
  // doesn't justify the price — don't grant the high-growth pass.
  const isHighGrowth = ((row.revCagr ?? 0) > 25 || (row.yoySalesGrowth ?? 0) > 25)
                       && ((row.peg ?? 0) <= 3 || (row.peg ?? 0) <= 0); // PEG≤0 means no PEG data; let it through

  const valComponents: number[] = [];

  if (row.pe!==undefined) {
    const peScore = sv(row.pe, b.pe, false);
    valComponents.push(peScore);
    // FIX #6: Only flag extreme PE if NOT in high-growth acceleration
    if (row.pe > 120 && !isHighGrowth) redFlags.push({label:`P/E ${row.pe.toFixed(0)}× — extreme, not justified by growth`,severity:'MEDIUM',source:'Fisher'});
    if (row.pe > 120 && isHighGrowth) risks.push(`P/E ${row.pe.toFixed(0)}× — high but growth justifies it (growth >25%)`); // note, not a flag
    if (peScore < 35) risks.push(`P/E ${row.pe.toFixed(1)}x — expensive vs sector`);
    // PATCH 1051 — Bubble-territory PE: ≥200× with PEG > 2.5 (or undefined growth)
    // and NOT in true high-growth → CRITICAL structural flag (caps composite at 38).
    // Catches NIBE PE 404×, STLTECH 577×, SEIL 499×, PTCIL 280×, RHETAN 238×, NEOGEN
    // 172×, POWERINDIA 162×, APOLLO 132×, NETWEB 127×, WOCKPHARMA 123×.
    if (row.pe >= 200 && !isHighGrowth && ((row.peg ?? 99) > 2.5 || (row.peg ?? 99) <= 0)) {
      redFlags.push({label:`Bubble PE ${row.pe.toFixed(0)}× + PEG ${(row.peg ?? 0) <= 0 ? 'N/A' : row.peg?.toFixed(1)} — extreme valuation`,severity:'CRITICAL',kind:'STRUCTURAL',source:'Valuation'});
    }
  }
  // PEG: skipped entirely for cyclical sectors — earnings at cycle peak inflate denominator
  if (row.peg!==undefined && row.peg>0 && !cyclical) {
    // PATCH 1029: PEG < 0.1 is almost always a low-base artifact (SATIN PEG 0.02 = ₹2cr historical PAT exploding to large CAGR denominator). Score neutral, not as "undervalued growth" strength.
    if (row.peg < 0.1) {
      valComponents.push(50);
      risks.push(`PEG ${row.peg.toFixed(2)} — suspect low-base artifact, valuation pillar reset to neutral`);
    } else {
      // PATCH 1051 — Steep PEG ladder extension. Pre-1051 the score floor was 22
      // for any PEG > 2.5 — so PEG 3.4 (HAPPYFORGE), 5.9 (NESTLE), 7.98 (HARDWYN),
      // 8.31 (GRINDWELL), 8.64 (SAREGAMA), 9.96 (RHETAN), 11.25 (ARFIN), 11.77
      // (CGPOWER), 16.04 (NIBE), 18.51 (IOLCP), 24.41 (SEIL), 27.53 (ANGELONE)
      // all collapsed to the same 22 score. Now graded:
      //   2.5 - 5   → 22 (already-expensive)
      //   5 - 10    → 10 (severely overvalued vs growth)
      //   10 - 20   → 4  (bubble territory)
      //   > 20      → 0  (mathematically impossible to justify)
      const pegScore = row.peg<0.8?92:row.peg<1.0?84:row.peg<1.5?74:row.peg<2.0?58:row.peg<2.5?42:row.peg<5?22:row.peg<10?10:row.peg<20?4:0;
      valComponents.push(pegScore);
      if (row.peg<0.8) strengths.push(`PEG ${row.peg.toFixed(2)} — undervalued growth`);
      if (row.peg>2.5 && !isHighGrowth) risks.push(`PEG ${row.peg.toFixed(2)} — expensive for growth rate`);
      if (row.peg>2.5 && isHighGrowth)  risks.push(`PEG ${row.peg.toFixed(2)} — high but growth >25% may justify`);
      // PATCH 1051 — PEG > 5 with no genuine high-growth justification → HIGH
      // structural flag (caps composite at 60). Severity escalates at PEG > 10
      // to CRITICAL (caps at 38). Bypass when isHighGrowth (revCagr/yoy > 25%
      // AND PEG ≤ 3 — see new isHighGrowth definition above).
      if (row.peg > 10 && !isHighGrowth) {
        redFlags.push({label:`PEG ${row.peg.toFixed(1)} — bubble valuation`,severity:'CRITICAL',kind:'STRUCTURAL',source:'Valuation'});
      } else if (row.peg > 5 && !isHighGrowth) {
        redFlags.push({label:`PEG ${row.peg.toFixed(1)} — severely overvalued for growth`,severity:'HIGH',kind:'STRUCTURAL',source:'Valuation'});
      }
    }
  } else if (cyclical && row.peg!==undefined) {
    risks.push(`PEG ${row.peg.toFixed(2)} excluded — cyclical earnings unreliable for growth-adjusted valuation`);
  } else if (row.peg!==undefined && row.peg<=0 && !cyclical) {
    // PATCH 0461 — PEG ≤ 0 is NOT a free pass. Negative PEG means either
    // negative earnings (P/E undefined) OR negative growth. Both are red
    // flags, not "skip valuation". Previously unprofitable names with
    // PEG=-1 quietly avoided the entire valuation pillar — that's a
    // free pass for the riskiest names in the universe.
    valComponents.push(35);
    risks.push(`PEG ${row.peg.toFixed(2)} — negative (loss-making or negative growth); valuation pillar penalised`);
  }
  if (row.marginOfSafety!==undefined) {
    const mosScore = row.marginOfSafety>30?92:row.marginOfSafety>15?80:row.marginOfSafety>0?66:row.marginOfSafety>-15?48:row.marginOfSafety>-30?34:18;
    valComponents.push(mosScore);
    if (row.marginOfSafety>20) strengths.push(`${row.marginOfSafety.toFixed(0)}% below intrinsic value — margin of safety`);
    if (row.marginOfSafety<-30) risks.push(`Price ${Math.abs(row.marginOfSafety).toFixed(0)}% above intrinsic value`);
  }
  // ── GAP 5: EV/EBITDA — enterprise value vs operating earnings ──────────────
  // More robust than PE for capital-structure-neutral comparison.
  // Works for companies with significant debt or cash (PE would distort).
  if (row.evEbitda !== undefined && row.evEbitda > 0) {
    const skey = getSectorKey(row.sector);
    const evBench = skey==='TECHNOLOGY'?[18,28,46] : skey==='PHARMA'?[14,21,34] :
                    skey==='CONSUMER'?[16,26,42]   : skey==='INFRA'?[7,13,20]   :
                    skey==='METALS'?[5,9,15]        : [10,16,26];
    const evScore = sv(row.evEbitda, evBench, false); // lower EV/EBITDA = better
    valComponents.push(evScore * 0.85); // slight discount vs PE — additional datapoint
    if (row.evEbitda < evBench[0]) strengths.push(`EV/EBITDA ${row.evEbitda.toFixed(1)}× — cheap on enterprise value`);
    else if (row.evEbitda > evBench[2] * 1.5) risks.push(`EV/EBITDA ${row.evEbitda.toFixed(1)}× — expensive vs operating earnings`);
  }

  // ── GAP 5: FCF YIELD — real cash return relative to market cap ─────────────
  // Buffett's preferred metric: cash the business generates per rupee of market cap.
  // FCF yield > 4% = attractively priced; > 6% = cheap; < 1% = expensive in cash terms.
  if (row.fcfYield !== undefined) {
    if (row.fcfYield > 6) {
      valComponents.push(90);
      strengths.push(`FCF yield ${row.fcfYield.toFixed(1)}% — generating exceptional cash vs market cap`);
    } else if (row.fcfYield > 3) {
      valComponents.push(72);
      strengths.push(`FCF yield ${row.fcfYield.toFixed(1)}% — solid cash return on market cap`);
    } else if (row.fcfYield > 1) {
      valComponents.push(55);
    } else if (row.fcfYield < 0) {
      valComponents.push(28);
      risks.push(`Negative FCF yield ${row.fcfYield.toFixed(1)}% — burning cash relative to market cap`);
    }
  }

  if (valComponents.length > 0) {
    valS = valComponents.reduce((a,b)=>a+b, 0) / valComponents.length;
  }

  // ── MARKET / TECHNICAL ────────────────────────────────────────────────────
  if (row.aboveDMA200!==undefined) {
    mktS=row.aboveDMA200>10?85:row.aboveDMA200>0?72:row.aboveDMA200>-15?52:28; mktC=1;
    if (row.aboveDMA200<-30) risks.push(`${Math.abs(row.aboveDMA200).toFixed(0)}% below DMA200 — deep drawdown`);
  }
  if (row.return1m!==undefined) {
    const s=row.return1m>10?80:row.return1m>0?65:row.return1m>-15?50:28;
    mktS=(mktS*mktC+s)/(mktC+1); mktC++;
  }
  // FIX #7: Re-rating signal — price above DMA200 AND growth accelerating = confirmation
  if (row.aboveDMA200 !== undefined && row.aboveDMA200 > 0 && row.accelSignal === 'ACCELERATING') {
    mktS = Math.min(100, mktS + 8);
    strengths.push(`Price above DMA200 (+${row.aboveDMA200.toFixed(0)}%) AND revenue accelerating — re-rating in progress`);
  }

  // ── GAP 7: 52-WEEK HIGH PROXIMITY — relative strength proxy ──────────────
  // Near 52W high = institutional buying confirmed, trend intact.
  // Far below 52W high = price has rejected/broken down — thesis needs re-validation.
  // Used as RS proxy since index-relative data isn't in Screener exports.
  if (row.pctFrom52wHigh !== undefined) {
    if (row.pctFrom52wHigh >= -5) {
      // At or near 52W high — trend confirmation
      mktS = Math.min(100, mktS + 10);
      if (row.accelSignal === 'ACCELERATING') {
        strengths.push(`Near 52W high (${row.pctFrom52wHigh.toFixed(0)}%) + accelerating fundamentals — breakout setup`);
      } else {
        strengths.push(`Near 52W high (${row.pctFrom52wHigh.toFixed(0)}%) — institutional buying confirmed`);
      }
    } else if (row.pctFrom52wHigh >= -20) {
      mktS = Math.min(100, mktS + 4); // moderate pullback from high — healthy
    } else if (row.pctFrom52wHigh < -40) {
      // Significant drawdown — either opportunity (if fundamentals strong) or breakdown
      mktS = Math.max(0, mktS - 12);
      if (row.accelSignal === 'ACCELERATING') {
        strengths.push(`${Math.abs(row.pctFrom52wHigh).toFixed(0)}% off 52W high — deep pullback with accelerating fundamentals (potential entry)`);
      } else {
        risks.push(`${Math.abs(row.pctFrom52wHigh).toFixed(0)}% below 52W high + no fundamental acceleration — capital destruction risk`);
      }
    } else if (row.pctFrom52wHigh < -25) {
      mktS = Math.max(0, mktS - 6);
    }
  }

  // ── PILLAR AVERAGES ───────────────────────────────────────────────────────
  const qual  = qualC>0?qualS/qualC:50;
  const growth= growC>0?growS/growC:50;
  const accel = accelS; // already a single score
  const longe = longC>0?longS/longC:50;
  const fin   = finC>0?finS/finC:50;
  let val     = valComponents.length>0?valS:50;
  const mkt   = mktS;

  // PATCH 0265 — Valuation cap when 'PEG illusion' detected: cheap on PEG but
  // ROIC < WACC AND margin-of-safety < −50%. Cap valuation score at 45 to
  // prevent the framework rewarding cheap-looking growth on poor economics.
  if (
    row.marginOfSafety !== undefined && row.marginOfSafety < -50 &&
    row.roic !== undefined && row.roic < 10
  ) {
    if (val > 45) {
      risks.push(`Valuation capped at 45: MoS ${row.marginOfSafety.toFixed(0)}% < −50% AND ROIC ${row.roic.toFixed(1)}% < WACC — DCF says expensive even if PEG looks cheap`);
      val = 45;
    }
  }

  // PATCH 0269 — Cap Quality and Longevity pillars at 60 when ROIC < WACC.
  // Per Fisher: 'a business reinvesting at sub-WACC returns is not a
  // long-term quality business no matter how good the OPM looks today'.
  // Without trailing 3-yr data we apply on current-period ROIC.
  // Limits the framework from blessing weak-economics names as 'high quality'.
  let qualCapped = qual;
  let longeCapped = longe;
  if (row.roic !== undefined && row.roic < 10) {
    if (qualCapped > 60) {
      risks.push(`Quality capped at 60: ROIC ${row.roic.toFixed(1)}% < WACC — sub-par capital allocation overrides margin/balance-sheet strength`);
      qualCapped = 60;
    }
    if (longeCapped > 60) {
      risks.push(`Longevity capped at 60: ROIC ${row.roic.toFixed(1)}% < WACC — durable moat unlikely without value-add reinvestment`);
      longeCapped = 60;
    }
  }

  // PATCH 0265 — Growth Quality offset: reward inflection on already-high
  // economics. Even with modest historical CAGR, if ROCE>20% AND CFO/PAT>1
  // AND FCF>0 AND recent YoY growth>25%, add +5 to growth pillar.
  let growthFinal = growth;
  const isOnBaseInflection = (
    (row.roce ?? 0) > 20 &&
    (row.cfoToPat ?? 0) > 1.0 &&
    (row.fcfAbsolute ?? 0) > 0 &&
    (row.yoySalesGrowth ?? 0) > 25
  );
  if (isOnBaseInflection) {
    growthFinal = Math.min(100, growth + 5);
    strengths.push('Growth Quality +5: inflection on already-high economics (ROCE>20%, CFO/PAT>1, FCF+)');
  }

  const filledFields=[row.roce,row.roe,row.opm,row.cfoToPat,row.promoter,row.de,
    row.netDebtEbitda,row.revCagr,row.profitCagr,row.yoySalesGrowth,row.yoyProfitGrowth,
    row.pe,row.peg,row.marketCapCr,row.marginOfSafety,row.fiiPlusDii,row.fcfAbsolute].filter(v=>v!==undefined).length;
  const coverage=Math.min(100,Math.round((filledFields/17)*100));
  const coverageRatio=coverage/100;

  // ── FIX #10: TRAJECTORY SCORE — change direction, not just level ───────────
  // "100-baggers are CHANGING companies, not just good companies"
  // Trajectory = (recent - historical) for sales + profit — purely about direction
  // PATCH 1028: only compute trajectory when both yoy AND cagr are defined;
  // PATCH 1027 clamps CAGR to undefined on low-base explosions (Raymond Realty,
  // IBULLS, etc.). With the old `?? 0` fallback, undefined CAGR became 0, leaving
  // raw YoY (e.g. 888%) to dominate trajectory — producing T+7502pp nonsense.
  const salesTrajectory  = (row.yoySalesGrowth  !== undefined && row.revCagr    !== undefined) ? (row.yoySalesGrowth  - row.revCagr)    : 0;
  const profitTrajectory = (row.yoyProfitGrowth !== undefined && row.profitCagr !== undefined) ? (row.yoyProfitGrowth - row.profitCagr) : 0;
  // Defense-in-depth: cap final trajectory at ±300pp — anything beyond is base-rate noise
  const trajectoryScore  = Math.max(-300, Math.min(300, salesTrajectory + profitTrajectory));
  const trajectoryBonus  = trajectoryScore > 40 ? 12 : trajectoryScore > 20 ? 7 : trajectoryScore > 0 ? 3 : trajectoryScore < -30 ? -12 : trajectoryScore < -15 ? -7 : 0;
  if (trajectoryScore > 30) strengths.push(`Strong positive trajectory: +${trajectoryScore.toFixed(0)}pp above historical trend`);
  if (trajectoryScore < -20) risks.push(`Negative trajectory: ${trajectoryScore.toFixed(0)}pp below historical trend`);

  // ── FIX #1+#3+#4: TRIGGER SCORE — proxy for demerger/turnaround/new engine ──
  // Can't detect these directly from Screener, but can proxy via metric patterns:
  let triggerBonus = 0;
  const inflectionSignal =
    (row.yoyProfitGrowth ?? 0) > 50 &&
    (row.profitCagr ?? 0) < 20 &&
    (row.opm ?? 0) > (b.opm[0]); // OPM above sector floor

  // Turnaround: profit growth >50% from low historical base
  if (inflectionSignal) {
    triggerBonus += 8;
    strengths.push(`Early inflection: profit growth ${row.yoyProfitGrowth?.toFixed(0)}% from low base (CAGR ${row.profitCagr?.toFixed(0)}%) — turnaround phase`);
  }
  // New growth engine: YOY acceleration + both sales and profit accelerating together
  if (row.accelSignal === 'ACCELERATING' && (row.profitAcceleration ?? 0) > 20 && (row.revenueAcceleration ?? 0) > 15) {
    triggerBonus += 6;
    strengths.push(`New growth engine firing: sales +${row.revenueAcceleration?.toFixed(0)}pp AND profit +${row.profitAcceleration?.toFixed(0)}pp above historical`);
  }
  // Industry tailwind signal: multi-quarter revenue acceleration + op leverage together
  if ((row.revenueAcceleration ?? 0) > 15 && (row.recentOpLev ?? 0) > 1.5) {
    triggerBonus += 5;
    strengths.push(`Industry tailwind + op leverage: acceleration ${row.revenueAcceleration?.toFixed(0)}pp + leverage ${row.recentOpLev?.toFixed(1)}×`);
  }
  // Operating leverage breakout (standalone — CG Power / KPIT pattern)
  if ((row.recentOpLev ?? 0) >= 2.0 && (row.yoySalesGrowth ?? 0) > 20) {
    triggerBonus += 4;
    strengths.push(`Breakout op leverage ${row.recentOpLev?.toFixed(1)}× — Lloyds/CG Power pattern`);
  }
  triggerBonus = Math.min(20, triggerBonus); // cap at +20

  // ── HARD PENALTIES ────────────────────────────────────────────────────────
  let hardPenalty = 0;

  // FIX #8: Relax thresholds for Emerging bucket companies
  const promoterThreshold = isLikelyEmerging ? 35 : 40;
  const cfoThreshold      = isLikelyEmerging ? 0.6 : 0.7;
  const deThreshold       = isLikelyEmerging ? b.deMax * 1.5 : b.deMax;

  // Context-aware ownership penalty: promoter alone is insufficient signal.
  // A low-promoter stock where institutions have already validated it (FII+DII > 20%)
  // is materially different from one with no institutional backing at all.
  if (row.promoter !== undefined && row.promoter < promoterThreshold) {
    const fiiDii = row.fiiPlusDii ?? 0;
    if (fiiDii >= 20) {
      // Institutional confidence compensates — neutral, no penalty (e.g. CEAT)
      // Institutions have done their own diligence; low promoter is structural, not a risk
    } else if (fiiDii >= 10) {
      // Partial institutional backing — half penalty
      hardPenalty += 5;
      risks.push(`Ownership gap −5: Promoter ${row.promoter.toFixed(1)}% low, FII+DII ${fiiDii.toFixed(0)}% partial cover`);
    } else {
      // Ownership vacuum — full penalty (e.g. DRC Systems: 20% promoter, <1% FII)
      hardPenalty += 10;
      risks.push(`Ownership vacuum −10: Promoter ${row.promoter.toFixed(1)}% + FII+DII ${fiiDii.toFixed(0)}% — no meaningful ownership anchor`);
    }
  }
  // Fix 2: DOUBLE PENALTY on poor cash conversion.
  // CFO/PAT < 0.5 = profit is largely paper — major red flag for compounders.
  if (row.cfoToPat !== undefined && row.cfoToPat < 0.5 && row.cfoToPat >= 0) {
    hardPenalty += 20; // doubled from 10
    risks.push(`Hard −20: CFO/PAT ${row.cfoToPat.toFixed(2)}x < 0.5 — severely poor cash conversion (profit mostly paper)`);
  } else if (row.cfoToPat !== undefined && row.cfoToPat < cfoThreshold && row.cfoToPat >= 0) {
    hardPenalty += 10;
    risks.push(`Hard −10: CFO/PAT ${row.cfoToPat.toFixed(2)}x < ${cfoThreshold}`);
  }
  if (row.de !== undefined && row.de > deThreshold) {
    hardPenalty += 10;
    risks.push(`Hard −10: D/E ${row.de.toFixed(2)}x above ${isLikelyEmerging ? 'relaxed ' : ''}sector threshold (${deThreshold.toFixed(1)}x)`);
  }
  if ((row.profitAcceleration ?? 0) < -25) {
    // PATCH 1059 — Clean cash-conversion shield. When CFO/PAT > 1.0 (excellent
    // cash conversion) AND CFO is positive, the profit deceleration is most
    // likely a real one-quarter miss on a genuine compounder (CRAFTSMAN
    // pattern) rather than a fade. Soften −15 to −8 because the cash IS
    // converting. Cash-quality is the durability filter the engine trusts
    // more than reported-profit trajectory.
    const _cleanCash = (row.cfoToPat ?? 0) > 1.0;
    if (_cleanCash) {
      hardPenalty += 8;
      risks.push(`Soft −8: Profit deceleration ${row.profitAcceleration?.toFixed(0)}pp — but CFO/PAT ${row.cfoToPat?.toFixed(2)} clean cash conversion (penalty halved)`);
    } else {
      hardPenalty += 15;
      risks.push(`Hard −15: Profit deceleration ${row.profitAcceleration?.toFixed(0)}pp — severe collapse`);
    }
  }
  if (row.opm !== undefined && row.opm < b.opm[0]) {
    hardPenalty += 5;
    risks.push(`Hard −5: OPM ${row.opm.toFixed(1)}% below sector p25 (${b.opm[0]}%)`);
  }
  // PATCH 0265 — Soften op leverage penalty.
  // Original: −10 if opLev<1.0, −5 if opLev<1.5 (both with growth>15%).
  // The −5 was firing on cases like 1.3× lev with 31% growth, which is
  // perfectly acceptable (profit growing faster than sales). User spec:
  //   Reserve hard −5 for growth>25% AND opLev≤1.0 (already covered by −10)
  //   or multi-year margin trend clearly declining.
  // For 1.0 ≤ opLev < 1.5 with growing PAT, apply only a soft −1.
  if (row.recentOpLev !== undefined && row.yoySalesGrowth !== undefined && row.yoySalesGrowth > 15) {
    if (row.recentOpLev < 1.0) {
      hardPenalty += 10;
      risks.push(`Hard −10: Op leverage ${row.recentOpLev.toFixed(2)}x < 1.0 — costs growing faster than revenue`);
    } else if (row.recentOpLev < 1.5 && row.yoyProfitGrowth !== undefined && row.yoyProfitGrowth < row.yoySalesGrowth) {
      // Only penalise if profit actually grew SLOWER than sales (margin compression)
      hardPenalty += 1;
      risks.push(`Soft −1: Op leverage ${row.recentOpLev.toFixed(2)}x — PAT growth (${row.yoyProfitGrowth.toFixed(0)}%) trails sales (${row.yoySalesGrowth.toFixed(0)}%)`);
    }
    // 1.3-1.5× with PAT > sales = healthy operating leverage; no penalty.
  }

  // PATCH 0265 — ROIC < WACC kill switch. Stacked penalty when growth is being
  // funded by leverage on sub-WACC returns AND no cash generation.
  // 'Textbook growth-that-destroys-value' per Fisher.
  if (
    row.roic !== undefined && row.roic < 10 &&        // sub-WACC
    (row.fcfAbsolute ?? 0) < 0 &&                      // burning cash
    (row.de ?? 0) >= 0.5 &&                            // leveraged
    (row.yoySalesGrowth ?? 0) > 25                     // hiding behind growth
  ) {
    hardPenalty += 10;
    risks.push(`Hard −10: KILL SWITCH — ROIC ${row.roic.toFixed(1)}% < WACC, FCF negative, D/E ${(row.de ?? 0).toFixed(2)}, growth ${row.yoySalesGrowth?.toFixed(0)}% masking value destruction`);
  }

  // ── CAPITAL ALLOCATION QUALITY ───────────────────────────────────────────────
  // Aurum Proptech pattern: strong growth but destroying capital via debt + negative FCF.
  // "Many high-growth stories destroy capital" — Fisher 100-Bagger Ch.4
  // PATCH 1059 — Financial-sector exemption + clean-cash-conversion shield.
  // Capital-trap and Capital-efficiency penalties were industrial-company
  // rules being mis-applied to:
  //   (a) NBFCs/banks where D/E 3-12× is STRUCTURAL not stress
  //   (b) Compounders with CFO/PAT > 1 in a capex-heavy year (CRAFTSMAN
  //       has FCF negative because of new-plant capex, not "borrowing to
  //       fund losses" — the cash IS converting)
  const _isFinCap = /bank|insurance|finance|capital markets|asset management|nbfc|reit|invit/.test((row.sector||'').toLowerCase());
  const _cleanCashTrap = (row.cfoToPat ?? 0) > 1.0;
  if ((row.fcfAbsolute ?? 0) < 0 && (row.de ?? 0) > 0.7 && !_isFinCap && !_cleanCashTrap) {
    hardPenalty += 8;
    risks.push(`Capital trap −8: negative FCF + D/E ${row.de?.toFixed(2)}x — borrowing to fund losses`);
  }
  if ((row.roce ?? 99) < 12 && (row.de ?? 0) > 0.5 && !_isFinCap) {
    hardPenalty += 5;
    risks.push(`Capital efficiency −5: ROCE ${row.roce?.toFixed(0)}% below cost of capital with D/E ${row.de?.toFixed(2)}x`);
  }
  // Reinvestment quality: high growth + negative FCF = growth not self-funded
  if ((row.revCagr ?? 0) > 20 && (row.fcfAbsolute ?? 1) < 0 && (row.cfoToPat ?? 1) < 0.5) {
    hardPenalty += 6;
    risks.push(`Reinvestment risk −6: ${(row.revCagr??0).toFixed(0)}% growth but FCF negative + CFO/PAT < 0.5`);
  }

  // ── REVENUE CONSISTENCY (cyclical / one-off detection) ───────────────────────
  // Disa India / Pricol pattern: acceleration from commodity upcycle, not structural.
  // If 3yr CAGR available AND single-period CAGR is 2.5x+ the 3yr → likely spike.
  if (row.salesGrowth3y !== undefined) {
    if (row.salesGrowth3y < 12 && (row.revCagr ?? 0) > 20) {
      hardPenalty += 6;
      risks.push(`Consistency risk −6: 3yr CAGR only ${row.salesGrowth3y.toFixed(0)}% vs recent ${(row.revCagr??0).toFixed(0)}% — likely cyclical spike`);
    } else if (row.revCagr !== undefined && row.revCagr > row.salesGrowth3y * 2.5 && row.salesGrowth3y > 0) {
      hardPenalty += 4;
      risks.push(`One-off spike risk −4: recent CAGR ${row.revCagr.toFixed(0)}% is ${(row.revCagr/row.salesGrowth3y).toFixed(1)}x the 3yr trend (${row.salesGrowth3y.toFixed(0)}%)`);
    }
  }

  // ── 🚨 GROWTH QUALITY FILTER — 100-bagger base requirement ──────────────────
  // MOSL 100× study: every enduring 100-bagger had ≥15% revenue CAGR.
  // Without this base growth rate, compounding to 100× in <20 yrs is mathematically
  // near-impossible. This is the first filter Warren Buffett / MOSL apply.
  // Nuance: if recent YOY ≥ 25% (company inflecting), penalty halved — growth may
  // be emerging even if historical CAGR was low (turnaround / new product).
  if (row.revCagr !== undefined && row.revCagr < 15) {
    const isInflecting = (row.yoySalesGrowth ?? 0) >= 25;
    if (isInflecting) {
      hardPenalty += 15;
      risks.push(`Growth Quality Filter −15: Sales CAGR ${row.revCagr.toFixed(1)}% < 15% (but recent YOY ${(row.yoySalesGrowth??0).toFixed(0)}% suggests inflection — half penalty)`);
    } else {
      hardPenalty += 30;
      risks.push(`🚨 Growth Quality Filter −30: Sales CAGR ${row.revCagr.toFixed(1)}% < 15% — insufficient base growth for 100-bagger thesis (MOSL: every 100× had ≥15% CAGR)`);
    }
  }

  // ── CYCLICAL SECTOR PENALTY ──────────────────────────────────────────────────
  // PEG/PE unreliable at earnings peaks in cyclicals. Earnings will mean-revert.
  // For cyclicals: PEG benefit is removed in valuation section (see below),
  // plus a direct hard penalty for cycle risk.
  if (cyclical) {
    hardPenalty += 4;
    risks.push(`Cyclical risk −4: sector (${row.sector}) = mean-reverting margins, PEG/PE unreliable`);
  }

  // ── GAP 1+2 PENALTIES: Incremental ROCE contraction + OPM compression ─────
  if (row.roceExpansion !== undefined && row.roceExpansion < -10) {
    hardPenalty += 10;
    risks.push(`Hard −10: ROCE fell ${Math.abs(row.roceExpansion).toFixed(0)}pp over 3yr — new capital earning less than legacy (value destruction)`);
  }
  if (row.opmExpansion !== undefined && row.opmExpansion < -6) {
    hardPenalty += 7;
    risks.push(`Hard −7: OPM compressed ${Math.abs(row.opmExpansion).toFixed(0)}pp (${row.opm3yr !== undefined ? '3yr' : '1yr'}) — moat eroding, pricing power weakening`);
  }

  // ── TECHNICAL GATE (DMA200 enforcement) ─────────────────────────────────────
  // "Only overweight stocks above 200 DMA AND earnings acceleration" — institutional rule.
  // Below DMA200 = capital currently trapped. Combined with deceleration = avoid.
  if (row.aboveDMA200 !== undefined) {
    if (row.aboveDMA200 < -15 && row.accelSignal === 'DECELERATING') {
      hardPenalty += 10;
      risks.push(`Technical gate −10: below DMA200 (${row.aboveDMA200.toFixed(0)}%) AND fundamentals decelerating — worst combo`);
    } else if (row.aboveDMA200 < -10 && row.accelSignal !== 'ACCELERATING') {
      hardPenalty += 5;
      risks.push(`Technical gate −5: below DMA200 (${row.aboveDMA200.toFixed(0)}%) without earnings acceleration — capital inefficiency`);
    }
    // Bonus: above DMA200 + accelerating = trend confirmation (add to market pillar)
  }

  // ── BUCKET CLASSIFICATION (7-pillar weights) ──────────────────────────────
  const hasCrit  = redFlags.some(f=>f.severity==='CRITICAL');
  const highCnt  = redFlags.filter(f=>f.severity==='HIGH').length;
  const medCnt   = redFlags.filter(f=>f.severity==='MEDIUM').length;
  // PATCH 0315 — structural-vs-cyclical split used by both bucket logic and
  // final score caps. Bucket hard-fail should require structural failures,
  // not single-quarter cyclical noise.
  const highStructPre = redFlags.filter(f=>f.severity==='HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;

  const isHardFail = hasCrit || highStructPre>=2 || (row.accelSignal==='DECELERATING'&&highStructPre>=1) || (row.de??0)>2.5 || (row.pledge??0)>40;
  const isCoreCompounder = !isHardFail && (row.roce??0)>=18 && (row.cfoToPat??0)>=0.8 && (row.de??999)<=0.5 && (row.revCagr??0)>=15 && (row.promoter??0)>=40 && highStructPre===0;
  const isEmergingMultibagger = !isHardFail && !isCoreCompounder && (row.accelSignal==='ACCELERATING'||(row.yoySalesGrowth??0)>=25) && (row.recentOpLev??0)>=1.0 && (row.marketCapCr??99999)<=10000 && highStructPre<=1;
  const bucket: Bucket = isHardFail?'MONITOR':isCoreCompounder?'CORE_COMPOUNDER':isEmergingMultibagger?'EMERGING_MULTIBAGGER':'HIGH_RISK';

  // 7-pillar weight sets [qual, growth, accel, longe, fin, val, mkt]
  let bw: number[];
  if (bucket === 'CORE_COMPOUNDER') {
    // Quality and fin strength dominate — consistency over momentum
    bw = [0.25, 0.18, 0.08, 0.14, 0.20, 0.10, 0.05];
  } else if (bucket === 'EMERGING_MULTIBAGGER') {
    // Acceleration is #1 — discovery + small base matter most
    // FIX #9: Market cap size upweighted to 25% of Longevity for Emerging
    bw = [0.12, 0.18, 0.25, 0.20, 0.10, 0.10, 0.05];
  } else {
    // Default SQGLP (High-Risk / Monitor)
    bw = [0.20, 0.20, 0.18, 0.12, 0.15, 0.10, 0.05];
  }
  // ── QUALITY SURVIVAL COEFFICIENT ─────────────────────────────────────────────
  // Acceleration cannot dominate when survival quality is weak.
  // Each survival failure proportionally reduces the Acceleration pillar contribution.
  // This stops "story velocity" (Jeena Sikho, Silkflex, DRC pattern) from overriding
  // "survival quality" (CFO/PAT, FCF, promoter, debt).
  let qualitySurvivalCoeff = 1.0;
  if (row.cfoToPat !== undefined && row.cfoToPat < 0.7 && row.cfoToPat >= 0) qualitySurvivalCoeff -= 0.15;
  if ((row.fcfAbsolute ?? 0) < 0)                                              qualitySurvivalCoeff -= 0.10;
  if (row.promoter !== undefined && row.promoter < 40)                         qualitySurvivalCoeff -= 0.10;
  if (row.de !== undefined && row.de > b.deMax)                                qualitySurvivalCoeff -= 0.08;
  if ((row.roce ?? 99) < 12)                                                   qualitySurvivalCoeff -= 0.07;
  qualitySurvivalCoeff = Math.max(0.45, qualitySurvivalCoeff); // floor: never below 45% credit

  const effectiveAccel = accel * qualitySurvivalCoeff;
  const raw = qual*bw[0] + growth*bw[1] + effectiveAccel*bw[2] + longe*bw[3] + fin*bw[4] + val*bw[5] + mkt*bw[6];

  // ── RERATING BONUS — only truly ADDITIVE signals not already in pillars ────────
  // REMOVED to prevent double-counting:
  //   • PEG < 0.8 bonus → already captured in Valuation pillar components
  //   • MoS > 20% bonus → already captured in Valuation pillar components
  //   • accelSignal=ACCELERATING bonus → already captured in Acceleration pillar (25%)
  //   • profitAcceleration bonus → already captured in Acceleration pillar
  //   • aboveDMA200 + accelerating bonus → already in Market + Acceleration pillars
  //
  // KEPT — signals genuinely NOT captured elsewhere:
  //   • Institutional discovery (FII+DII) — longevity pillar uses this but not fully
  //   • Promoter buying — pure insider signal, not in pillars
  //   • Capital trap compound (FCF- + debt) — structural red flag compound
  //   • Crowded trade penalty — purely a forward-looking positioning risk
  //   • Decel + expensive — compound signal (both already penalised individually)
  let reratingBonus = 0;

  // Discovery premium — institutional ownership not yet arrived (not double-counted:
  // longevity uses FII/DII for runway, but rerating uses it for future demand catalyst)
  // PATCH 0313 — Discovery bonus REQUIRES meaningful promoter holding. Without
  // it, "zero institutional" is the operator-driven small-cap setup, not the
  // pre-institutional discovery zone — they look identical on FII+DII alone.
  // Gate: promoter ≥ 40% is the minimum for "founder skin in the game".
  const promoterAnchorOK = (row.promoter ?? 0) >= 40;
  if (promoterAnchorOK) {
    if ((row.fiiPlusDii??100)<5)       reratingBonus+=8;  // essentially zero institutional
    else if ((row.fiiPlusDii??100)<12) reratingBonus+=5;  // very early institutional
    else if ((row.fiiPlusDii??100)<22) reratingBonus+=2;  // early discovery
  }
  // When promoter < 40% AND FII+DII < 5%, the OWNERSHIP_VACUUM / GOVERNANCE_WATCH
  // penalties already apply below — this just denies the offsetting bonus.

  // Promoter buying is pure insider conviction signal (not in any pillar)
  if ((row.changeInPromoter??0) > 2 && (row.promoter??0) >= 40)  reratingBonus+=4;

  // FCF triple-quality (FCF positive + CFO/PAT > 1 + low debt) — extreme quality combo
  if ((row.fcfAbsolute??-1)>0 && (row.cfoToPat??0)>1.0 && (row.de??99)<0.3) reratingBonus+=3;

  // Crowding penalty — alpha already realised by institutions
  if ((row.fiiPlusDii??0)>55)        reratingBonus-=8;  // >55% = crowded
  else if ((row.fiiPlusDii??0)>42)   reratingBonus-=4;  // getting crowded

  // Capital trap compound (FCF negative + meaningful debt)
  if ((row.fcfAbsolute??1)<0 && (row.de??0)>0.7)        reratingBonus-=6;

  // PATCH 0055: Dilution trajectory — penalty for share-count growth that
  // dilutes per-share economics, bonus for buyback / accretive companies.
  // Both signals NOT captured by any existing pillar.
  if (row.dilution) {
    reratingBonus -= row.dilution.penalty;
    reratingBonus += row.dilution.bonus;
    if (row.dilution.verdict === 'SEVERELY_DILUTIVE') {
      risks.push(`Dilution −15: ${row.dilution.note}`);
    } else if (row.dilution.verdict === 'DILUTIVE') {
      risks.push(`Dilution −8: ${row.dilution.note}`);
    } else if (row.dilution.verdict === 'ACCRETIVE' && row.dilution.bonus >= 8) {
      // Show as positive trigger (we already pushed it as bonus above)
    }
  }
  // PATCH 0055: Reinvestment Engine — small additive bonus when stock is
  // genuinely compounding (incremental ROCE + profit growth + low dilution)
  if (row.reinvestment && row.reinvestment.verdict === 'COMPOUNDING') {
    reratingBonus += 5;
  } else if (row.reinvestment && row.reinvestment.verdict === 'BUILDING') {
    reratingBonus += 2;
  } else if (row.reinvestment && row.reinvestment.verdict === 'STALLING') {
    reratingBonus -= 5;
  }

  // Expensive + decelerating = dangerous combination
  if (row.accelSignal==='DECELERATING' && (row.pe??0)>40) reratingBonus-=8;

  // Overvalued vs intrinsic even with momentum (trap)
  if ((row.marginOfSafety??0)<-50)                        reratingBonus-=5;

  // High PE without earnings power to justify (separate from PEG which is in valuation)
  if ((row.pe??0)>80 && (row.profitCagr??0)<20 && !isHighGrowth) reratingBonus-=5;

  // PEG illusion: cheap PEG but massively above intrinsic value
  const rawRevDecel  = (row.yoySalesGrowth  !== undefined && row.revCagr    !== undefined) ? row.yoySalesGrowth  - row.revCagr    : undefined;
  const rawProfDecel = (row.yoyProfitGrowth !== undefined && row.profitCagr !== undefined) ? row.yoyProfitGrowth - row.profitCagr : undefined;
  if ((row.marginOfSafety??0) < -50 && (row.peg??99) < 1.5 && (row.peg??0) > 0 && !cyclical) {
    reratingBonus -= 6;
    risks.push(`PEG illusion: PEG ${row.peg?.toFixed(2)} but price is ${Math.abs(row.marginOfSafety??0).toFixed(0)}% above intrinsic value`);
  }

  // ── OWNERSHIP INTELLIGENCE BONUS/PENALTY ─────────────────────────────────────
  const ownershipCategory = classifyOwnership(row.promoter, row.fiiPlusDii, row.changeInPromoter);
  // Ownership category adjusts the rerating bonus — it's a forward-looking positioning signal
  if (ownershipCategory === 'FOUNDER_CONTROLLED') {
    reratingBonus += 4; // best zone: founder skin + institutional re-rating ahead
    strengths.push(`Ownership: Founder-Controlled (${row.promoter?.toFixed(0)}% promoter, ${(row.fiiPlusDii??0).toFixed(0)}% FII+DII) — pre-institutional discovery zone`);
  } else if (ownershipCategory === 'INSTITUTIONALIZING') {
    reratingBonus += 2; // sweet spot: institutional validation in progress
    strengths.push(`Ownership: Institutionalizing — institutions entering while founder-backed`);
  } else if (ownershipCategory === 'OWNERSHIP_VACUUM') {
    reratingBonus -= 5; // danger: no strong ownership anchor
    risks.push(`Ownership vacuum: Promoter ${row.promoter?.toFixed(0)}% + FII+DII ${(row.fiiPlusDii??0).toFixed(0)}% — position size max 1-3%`);
  }
  // MATURE gets no bonus/penalty — already priced in by institutions

  // ── PATCH 0313: GOVERNANCE WATCH — pump-and-dump pattern detector ─────────
  //
  // The specific combo of (low promoter + zero institutional + microcap)
  // is the classic Indian operator-driven small-cap setup. Vakrangee,
  // Manpasand, PC Jeweller, et al. all carried this fingerprint pre-collapse:
  //   - promoter ≤ 25% (operators dump easily into the float)
  //   - FII+DII ≤ 5% (no independent due diligence done)
  //   - mcap < ₹2000 Cr (institutional radar starts here)
  //
  // Strong reported financials INCREASE the suspicion here, not decrease it:
  // operator-run companies present the cleanest possible recent numbers
  // before the pump. Without institutional auditor pressure the financials
  // can't be trusted on face value.
  //
  // When this fires:
  //   - Cap composite score at 65 (cannot be A+/A regardless of magnitude)
  //   - Apply -8 reratingBonus on top of OWNERSHIP_VACUUM
  //   - Add explicit risk note
  //   - Set row.governanceWatch flag for the UI badge
  const p = row.promoter ?? 100;
  const fd = row.fiiPlusDii ?? 100;
  const mcap = row.marketCapCr ?? 0;

  // PATCH 0338 — MNC / Foreign-parent allowlist. These tickers have foreign
  // parent governance (US/UK/Japan/EU-listed parent companies) and are
  // exempt from the institutional-vacuum and governance-watch penalties.
  // Their low Indian-institutional ownership is structural (parent holds
  // majority) and does NOT reflect a diligence-failure. Adding them keeps
  // genuinely clean MNC subs (Kennametal India, Carraro India, Nitta
  // Gelatin's foreign-anchored variant) from being penalized.
  // PATCH 0614 — MNC_ALLOWLIST now lives in lib/multibagger-allowlists.ts
  const isMNC = MNC_ALLOWLIST_IN.has((row.symbol || '').toUpperCase());

  // PATCH 0338 — Governance Watch tiering. Old code was a single bucket
  // (cap 65). Now split:
  //   EXTREME — promoter ≤20 AND FII+DII ≤3 AND mcap <1000 Cr → CRITICAL
  //             red flag (cap 38). This is the unambiguous operator-driven
  //             microcap fingerprint (Vakrangee / Manpasand / PC Jeweller).
  //   STANDARD — promoter ≤25 AND FII+DII ≤5 AND mcap <2000 Cr → cap 65
  //             (unchanged from Patch 0313).
  // MNC-allowlist tickers are exempt.
  //
  // PATCH 0339 — Widened EXTREME to catch DRCSYSTEMS pattern (P=20.6,
  // FII+DII=0.4, MCap=₹215Cr) that just-missed the P≤20 gate. Three
  // independent ways to qualify EXTREME:
  //   (a) Original: P≤20 + FII+DII≤3 + mcap<1000
  //   (b) Ultra-micro: P≤25 + FII+DII≤3 + mcap<500    ← catches DRC
  //   (c) Zero-inst micro: P≤30 + FII+DII≤1 + mcap<300
  const extremeGov = !isMNC && mcap > 0 && (
    (p <= 20 && fd <= 3 && mcap < 1000) ||
    (p <= 25 && fd <= 3 && mcap < 500) ||
    (p <= 30 && fd <= 1 && mcap < 300)
  );
  const governanceWatch = !isMNC && p <= 25 && fd <= 5 && mcap > 0 && mcap < 2000;
  if (extremeGov) {
    redFlags.push({
      label: `Governance Watch EXTREME: P ${p.toFixed(0)}% + Inst ${fd.toFixed(1)}% + ₹${mcap.toFixed(0)} Cr`,
      severity: 'CRITICAL', kind: 'STRUCTURAL', source: 'Operator setup'
    });
    risks.push(
      `🛑 GOVERNANCE WATCH EXTREME: Promoter ${p.toFixed(0)}% + FII+DII ${fd.toFixed(1)}% + MCap ₹${mcap.toFixed(0)} Cr — classic Vakrangee/Manpasand operator setup. Trust reported numbers minimally.`
    );
  } else if (governanceWatch) {
    reratingBonus -= 8;
    risks.push(
      `GOVERNANCE WATCH: Promoter ${p.toFixed(0)}% + FII+DII ${fd.toFixed(1)}% + MCap ₹${mcap.toFixed(0)} Cr — classic operator-driven small-cap setup. Strong reported numbers without institutional scrutiny carry pump-and-dump risk. Score capped at 65.`
    );
  }
  (row as any).governanceWatch = governanceWatch;
  (row as any).extremeGov = extremeGov;

  // PATCH 0338 — MNC governance boost. Foreign-parent subsidiaries get a
  // small +3 reratingBonus because parent's listing-exchange governance
  // (US 10-K, UK Listing Rules, Japan TSE disclosure, etc.) is a stronger
  // backstop than typical Indian small-cap promoter accountability.
  if (isMNC) {
    reratingBonus += 3;
    strengths.push(`MNC governance: foreign-listed parent provides Tier-1 disclosure/audit backstop.`);
  }
  (row as any).mncSubsidiary = isMNC;

  // ── PATCH 0313: Institutional-vacuum demerit for mid-caps that institutions
  // had a chance to discover and passed on. Below ₹500 Cr the absence is
  // explained by size; above ₹500 Cr it's a deliberate institutional pass.
  //
  // PATCH 0338 — Exemption for (a) MNC subsidiaries, (b) clean compounders
  // with 8/8 survival + ROCE >20 + CFO/PAT >1 (institutions haven't reached
  // these YET — they aren't "passing", they're "not yet aware"). Catches
  // INA, Borana, InfoBeans type names that look "passed-over" by the raw
  // metric but are genuinely under-the-radar quality.
  const instVacuumExempt =
    isMNC
    || ((row.cfoToPat ?? 0) > 1.0 && (row.roce ?? 0) > 20 && (row.fcfAbsolute ?? -1) > 0
        && redFlags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length === 0);
  if (fd <= 1 && mcap >= 500 && mcap < 5000 && !instVacuumExempt) {
    reratingBonus -= 5;
    risks.push(
      `Institutional vacuum at ₹${mcap.toFixed(0)} Cr mcap — institutions had access and passed. Diligence gap.`
    );
  } else if (fd <= 1 && mcap >= 500 && mcap < 5000 && instVacuumExempt && !isMNC) {
    strengths.push(`Genuinely undiscovered: low institutional but clean cash conversion + ROCE — likely pre-discovery quality compounder, not a passed-over name.`);
  }

  // ── PATCH 0314: INSTITUTIONAL RED FLAGS — six additional detectors ─────────
  //
  // The model already catches blunt failures (deceleration, ROIC<WACC, ownership
  // vacuum). These six are the more subtle institutional checks that
  // distinguish "real compounder" from "growth at any cost / cycle peak /
  // earnings-managed" pattern.

  // (1) STORY-STOCK PATTERN — top-line growth without cash backing.
  //     Operator playbook: aggressive revenue recognition, weak collections,
  //     constant capital raises. Hard cap at composite ≤ 60 via HIGH red flag.
  //
  // PATCH 0337 — Threshold widened to catch Jeena Sikho / Insolation Energy
  // pattern: 90% sales growth with CFO/PAT 0.76, FCF negative, microcap, and
  // promoter declining 2-4pp over 3Y. The old gate (YoY > 80% AND CFO/PAT < 0.5)
  // missed the more common variant where cash conversion is merely weak (not
  // catastrophic) but combined with capital burn + microcap = same operator
  // setup. Two-tier detector:
  //   Severe — YoY > 80% AND CFO/PAT < 0.5         → HIGH structural (cap 60)
  //   Pattern — YoY > 50% AND CFO/PAT < 0.8 AND FCF < 0 AND mcap < ₹10000 Cr
  //              → HIGH structural (cap 60)
  const sevStory = (row.yoySalesGrowth ?? 0) > 80 && (row.cfoToPat ?? 99) < 0.5;
  const patternStory = !sevStory
    && (row.yoySalesGrowth ?? 0) > 50
    && (row.cfoToPat ?? 99) < 0.8
    && (row.fcfAbsolute ?? 1) < 0
    && (row.marketCapCr ?? 99999) < 10000;
  if (sevStory) {
    redFlags.push({
      label: 'Story stock',
      severity: 'HIGH', kind: 'STRUCTURAL',
      source: `Sales +${row.yoySalesGrowth?.toFixed(0)}% YoY but CFO/PAT only ${row.cfoToPat?.toFixed(2)} — revenue isn't converting to cash, classic operator pattern.`,
    });
  } else if (patternStory) {
    redFlags.push({
      label: 'Story-stock pattern',
      severity: 'HIGH', kind: 'STRUCTURAL',
      source: `Sales +${row.yoySalesGrowth?.toFixed(0)}% + CFO/PAT ${row.cfoToPat?.toFixed(2)} + FCF negative + microcap ₹${(row.marketCapCr ?? 0).toFixed(0)} Cr — growth without cash backing on capital-burning microcap.`,
    });
  }

  // (2) CYCLICAL-PEAK MARGINS — OPM running well above sector p75 in
  //     commodity-leaning sectors typically reverts on input-cost reset.
  //     Penalize the rerating bonus and flag the asymmetry. The decay
  //     filter catches this AFTER reversal; this catches it BEFORE.
  if (row.opm !== undefined && b.opm[2] > 0
      && row.opm > b.opm[2] * 1.7
      && (row.profitCagr ?? 0) > 60
      && cyclical) {
    reratingBonus -= 6;
    risks.push(
      `Cycle-peak margins: OPM ${row.opm.toFixed(1)}% is ${(row.opm / b.opm[2]).toFixed(1)}× sector p75 (${b.opm[2]}%) — typical commodity boom margin spike, mean-reverts on input reset.`
    );
  }

  // (3) CAPEX BURN WITHOUT ROCE RETURN — Fisher value-destroying-reinvestment
  //     red flag. Heavy negative FCF (capex-intensive) WITHOUT incremental
  //     ROCE expansion = capital is being deployed but not earning a return.
  if ((row.fcfAbsolute ?? 1) < 0
      && (row.roceExpansion ?? 0) < -1
      && (row.de ?? 0) > 0.3) {
    reratingBonus -= 7;
    risks.push(
      `Capex burn without ROCE return: FCF negative, ROCE ${(row.roceExpansion ?? 0).toFixed(1)}pp lower than 3yr avg, D/E ${row.de?.toFixed(2)} — capital is being deployed at sub-return rates.`
    );
  }

  // (4) PLEDGE SEVERITY TIERING — existing logic flags pledge > 25% as HIGH.
  //     Add CRITICAL at pledge ≥ 50% (operator margin-call risk imminent),
  //     and a separate distress-trend flag when pledge is rising. The Excel
  //     export only carries the current snapshot; trend handling requires
  //     row.pledge history (not always present).
  if ((row.pledge ?? 0) >= 50) {
    redFlags.push({
      label: 'Pledge ≥50%',
      severity: 'CRITICAL',
      source: `Promoter pledge ${row.pledge?.toFixed(0)}% — extreme distress signal; margin-call risk dominates fundamental thesis.`,
    });
  } else if ((row.pledge ?? 0) >= 35) {
    redFlags.push({
      label: 'Pledge 35-50%',
      severity: 'HIGH',
      source: `Promoter pledge ${row.pledge?.toFixed(0)}% — financial-stress signal; track quarterly.`,
    });
  }

  // (5) FALLING-KNIFE + EXPENSIVE COMBO — Stage 4 (below 200 DMA AND down >25%)
  //     with PEG > 2.5 is "catching a knife at premium valuation". Each piece
  //     is penalized in its own pillar, but the combo amplifies risk.
  // PATCH 0445 BUG-031 — Explicit PEG>0 guard so a negative PEG (negative
  // earnings growth) doesn't accidentally bypass the > 2.5 test on undefined
  // coercion or pass through unrelated paths.
  if ((row.aboveDMA200 ?? 0) < -25
      && (row.peg ?? 0) > 0
      && (row.peg ?? 0) > 2.5
      && (row.return1m ?? 0) < -10) {
    reratingBonus -= 8;
    risks.push(
      `Falling knife at premium valuation: ${row.aboveDMA200?.toFixed(0)}% below 200-DMA, 1m return ${row.return1m?.toFixed(0)}%, PEG ${row.peg?.toFixed(2)} — trend and valuation both unfavourable.`
    );
  }

  // (6) DIVIDEND-ABSENCE WITH FREE CASH — when a company has +ve FCF for years
  //     yet pays zero dividend AND has no clear reinvestment story (ROCE flat
  //     or down), the cash is going somewhere unaccounted for. Soft signal.
  //     Note: row.dividendYield is often available from Screener.
  const divYield = row.dividendYield ?? (row as any).dividendYield;
  if (typeof divYield === 'number' && divYield === 0
      && (row.fcfAbsolute ?? -1) > 0
      && (row.roceExpansion ?? 0) < 0
      && (row.marketCapCr ?? 0) > 200) {
    reratingBonus -= 3;
    risks.push(
      `Zero dividend despite +FCF and ROCE not expanding — cash being deployed without visible return. Check related-party transactions and capital allocation.`
    );
  }

  // ── PATCH 0317: NEW-METRIC SCORING RULES ────────────────────────────────────
  // Each rule runs only when the corresponding field is present in the row.
  // When missing, the rule contributes nothing (no penalty, no bonus). The
  // mapping from Screener columns is documented in METRICS_TO_ADD.md.

  // (A) WORKING-CAPITAL STRAIN — receivables piling up. This is the single best
  //     pre-blowup earnings-quality indicator in Indian small-caps.
  if (typeof row.debtorDays === 'number') {
    if (row.debtorDays > 180) {
      redFlags.push({
        label: `Debtor days ${row.debtorDays.toFixed(0)} — extreme`,
        severity: 'HIGH', source: 'Working Capital', kind: 'STRUCTURAL',
      });
    } else if (row.debtorDays > 120) {
      reratingBonus -= 5;
      risks.push(`Working capital strain: Debtor days ${row.debtorDays.toFixed(0)} — receivables piling up faster than collections.`);
    } else if (row.debtorDays < 30 && (row.sector || '').match(/CONSUMER|TECHNOLOGY/i)) {
      reratingBonus += 2;
      strengths.push(`Tight working capital: Debtor days ${row.debtorDays.toFixed(0)} — strong collection discipline.`);
    }
  }
  if (typeof row.inventoryDays === 'number') {
    if (row.inventoryDays > 240) {
      redFlags.push({
        label: `Inventory days ${row.inventoryDays.toFixed(0)} — pile-up`,
        severity: 'HIGH', source: 'Working Capital', kind: 'CYCLICAL',
      });
    } else if (row.inventoryDays > 150) {
      reratingBonus -= 3;
      risks.push(`Inventory days ${row.inventoryDays.toFixed(0)} — demand-slowdown leading indicator or seasonality?`);
    }
  }
  if (typeof row.workingCapitalDays === 'number') {
    if (row.workingCapitalDays < 0) {
      // Negative WC is only positive for consumer/retail/SaaS — for industrials it's unpaid bills.
      if ((row.sector || '').match(/CONSUMER|TECHNOLOGY|PHARMA/i)) {
        reratingBonus += 3;
        strengths.push(`Negative working capital ${row.workingCapitalDays.toFixed(0)}d — supplier-funded growth (Asian Paints-style).`);
      } else {
        reratingBonus -= 2;
        risks.push(`Negative working capital ${row.workingCapitalDays.toFixed(0)}d in a non-consumer sector — verify supplier-payable accumulation isn't masking stress.`);
      }
    }
  }
  // PATCH 0332 — Working-capital TREND signal (Screener 3yr-back columns).
  // If debtor days or WC days have grown materially from 3y-ago, that's a
  // multi-year deterioration — much more meaningful than a single quarter.
  if (typeof row.debtorDays === 'number' && typeof row.debtorDays3y === 'number') {
    const delta = row.debtorDays - row.debtorDays3y;
    // PATCH 0337 — Multi-year receivables deterioration is a top-3 institutional
    // blowup predictor. Kwality Pharma pattern (55d → 152d over 3Y) was only a
    // soft −5 rerating penalty; should be HIGH structural cap-60 because the
    // trend is the signal even if current value is still under the 180d HIGH
    // threshold (which applies to single-snapshot extreme).
    if (delta > 60 && row.debtorDays > 90) {
      redFlags.push({
        label: `Debtor days ${row.debtorDays3y.toFixed(0)}d→${row.debtorDays.toFixed(0)}d over 3Y`,
        severity: 'HIGH', source: 'Working capital trend', kind: 'STRUCTURAL',
      });
    } else if (delta > 40 && row.debtorDays > 90) {
      reratingBonus -= 5;
      risks.push(`Debtor days deteriorating: ${row.debtorDays3y.toFixed(0)}d → ${row.debtorDays.toFixed(0)}d over 3Y (+${delta.toFixed(0)}d). Multi-year receivables buildup.`);
    } else if (delta < -20 && row.debtorDays3y > 60) {
      reratingBonus += 2;
      strengths.push(`Debtor days improving: ${row.debtorDays3y.toFixed(0)}d → ${row.debtorDays.toFixed(0)}d over 3Y — collection discipline strengthening.`);
    }
  }
  if (typeof row.workingCapitalDays === 'number' && typeof row.workingCapitalDays3y === 'number') {
    const wcDelta = row.workingCapitalDays - row.workingCapitalDays3y;
    if (wcDelta > 60 && row.workingCapitalDays > 90) {
      reratingBonus -= 4;
      risks.push(`Working capital expanding: ${row.workingCapitalDays3y.toFixed(0)}d → ${row.workingCapitalDays.toFixed(0)}d over 3Y. Capital efficiency degrading.`);
    }
  }

  // (B) INTEREST COVERAGE — below 3× is leverage distress regardless of D/E.
  // PATCH 1059 — Apply the same financial-sector exemption that PATCH 1029
  // added to the OLD ICR rule (line ~1314). This NEW PATCH 0317 ICR rule
  // bypassed the exemption entirely — that's why SURYODAY (Banks, ICR 1.2),
  // MAHABANK (Banks, ICR 1.5), VERTIS, SGFIN all caught CRITICAL/HIGH ICR
  // flags. For banks/NBFCs/AMCs interest IS the cost of goods sold, not a
  // coverage stress signal.
  const _isFinICR = /bank|insurance|finance|capital markets|asset management|nbfc|reit|invit/.test((row.sector||'').toLowerCase());
  if (typeof row.interestCoverage === 'number' && row.interestCoverage > 0 && !_isFinICR) {
    if (row.interestCoverage < 1.5) {
      redFlags.push({
        label: `ICR ${row.interestCoverage.toFixed(1)}× — distress`,
        severity: 'CRITICAL', source: 'Leverage', kind: 'STRUCTURAL',
      });
    } else if (row.interestCoverage < 3) {
      redFlags.push({
        label: `ICR ${row.interestCoverage.toFixed(1)}× — leverage tight`,
        severity: 'HIGH', source: 'Leverage', kind: 'STRUCTURAL',
      });
    } else if (row.interestCoverage > 15) {
      reratingBonus += 2;
      strengths.push(`Interest coverage ${row.interestCoverage.toFixed(0)}× — debt service trivial.`);
    }
  }

  // (C) EFFECTIVE TAX RATE — sustained <15% in non-SEZ-eligible sectors flags
  //     aggressive accounting. ~25% is statutory; <15% needs SEZ / R&D justification.
  if (typeof row.effectiveTaxRate === 'number') {
    const inSEZSector = /TECHNOLOGY|PHARMA|EXPORT|SEZ/i.test(row.sector || '');
    if (row.effectiveTaxRate < 12 && !inSEZSector) {
      reratingBonus -= 4;
      risks.push(`Effective tax rate ${row.effectiveTaxRate.toFixed(1)}% in non-SEZ sector — investigate sustainability and accounting policy.`);
    } else if (row.effectiveTaxRate > 30) {
      reratingBonus -= 1; // mild — high tax = no shelters but also no inflated post-tax PAT
    }
  }

  // (D) CAPEX EFFICIENCY (3yr) — capital deployed should earn a return.
  //     Capex3yr / Revenue3yr > 30% with ROCE expansion < 0 = burning capital.
  if (typeof row.capex3yr === 'number' && row.capex3yr > 0 && (row.revCagr ?? 0) > 0) {
    // Approximate revenue base from current revenue / capex ratio
    const approxRevenue3yrBase = (row.marketCapCr ?? 0) * 2; // rough: revenue ≈ 0.5× mcap as floor
    const capexIntensity = approxRevenue3yrBase > 0 ? (row.capex3yr / approxRevenue3yrBase) * 100 : 0;
    if (capexIntensity > 30 && (row.roceExpansion ?? 0) < 0) {
      reratingBonus -= 5;
      risks.push(`Capex burn: 3yr capex ~${capexIntensity.toFixed(0)}% of revenue base with ROCE declining ${(row.roceExpansion ?? 0).toFixed(1)}pp — value-destroying reinvestment.`);
    }
  }

  // (E) PROMOTER TREND — steady decline over 3Y is the cleanest operator-exit
  //     signal. PATCH 0334 — also accepts the 2-point synthesized history
  //     from "Change in promoter holding 3Years" since it's the same signal
  //     at lower resolution.
  if (Array.isArray(row.promoterHistory) && row.promoterHistory.length >= 2) {
    const oldest = row.promoterHistory[0];
    const latest = row.promoterHistory[row.promoterHistory.length - 1];
    const decline = oldest - latest;
    const horizonLabel = row.promoterHistory.length >= 4 ? '4Q' : row.promoterHistory.length === 3 ? '3-point' : '3Y';
    // PATCH 0339 — Threshold raised from 4pp to 7pp for HIGH structural.
    // Rationale: many genuine compounders see 4-7pp promoter decline over 3Y
    // due to ESOP grants, family settlements, dynastic transitions, partial
    // OFS — none of which signal operator exit. >7pp over 3Y is the real
    // exit pattern. Skipper (-5.4pp) drops out of HIGH structural and into
    // -5 rerating only; Tips Music (-10.8pp), GE Vernova (-24pp), SJS (-29pp),
    // Acutaas (-6.8pp wait — also drops out, but Acutaas has other issues)
    // continue to trigger.
    if (decline > 7) {
      redFlags.push({
        label: `Promoter holding fell ${decline.toFixed(1)}pp over ${horizonLabel}`,
        severity: 'HIGH', source: 'Ownership trend', kind: 'STRUCTURAL',
      });
    } else if (decline > 4) {
      reratingBonus -= 5;
      risks.push(`Promoter holding declining ${decline.toFixed(1)}pp over ${horizonLabel}: ${row.promoterHistory.map(v => v.toFixed(1)).join('% → ')}% — meaningful sell-down, track closely.`);
    } else if (decline > 2) {
      reratingBonus -= 3;
      risks.push(`Promoter holding declining ${decline.toFixed(1)}pp over ${horizonLabel}: ${row.promoterHistory.map(v => v.toFixed(1)).join('% → ')}% — minor sell-down, monitor.`);
    } else if (decline < -2) {
      // Promoter ADDING — buyback or pref allotment
      reratingBonus += 4;
      strengths.push(`Promoter accumulating ${Math.abs(decline).toFixed(1)}pp over ${horizonLabel}: ${row.promoterHistory.map(v => v.toFixed(1)).join('% → ')}% — insider conviction signal.`);
    }
  }

  // (F) FII+DII TREND — smart-money walking away. PATCH 0334 — also accepts
  //     the 2-point synthesized history from Change in FII/DII holding 3Y.
  if (Array.isArray(row.fiiHistory) && Array.isArray(row.diiHistory)
      && row.fiiHistory.length >= 2 && row.diiHistory.length >= 2) {
    const fiiOld = row.fiiHistory[0]; const fiiNew = row.fiiHistory[row.fiiHistory.length - 1];
    const diiOld = row.diiHistory[0]; const diiNew = row.diiHistory[row.diiHistory.length - 1];
    const fiiDelta = fiiNew - fiiOld;
    const diiDelta = diiNew - diiOld;
    const totalDelta = fiiDelta + diiDelta;
    if (totalDelta < -3) {
      reratingBonus -= 5;
      const horizon = row.fiiHistory.length >= 4 ? `${row.fiiHistory.length}Q` : row.fiiHistory.length === 3 ? '3-point' : '3Y';
      risks.push(`Institutions exiting: FII ${fiiDelta.toFixed(1)}pp + DII ${diiDelta.toFixed(1)}pp over ${horizon} — smart money walking away.`);
    } else if (totalDelta > 4) {
      reratingBonus += 4;
      strengths.push(`Institutions accumulating: FII +${fiiDelta.toFixed(1)}pp + DII +${diiDelta.toFixed(1)}pp — institutional discovery in progress.`);
    }
  }

  // (G) FREE-FLOAT LIQUIDITY — below ₹50L/day = essentially untradeable.
  if (typeof row.avgDailyValueCr === 'number') {
    if (row.avgDailyValueCr < 0.5) {
      reratingBonus -= 3;
      risks.push(`Illiquid: avg daily traded value ₹${(row.avgDailyValueCr * 100).toFixed(0)}L — institutional sizing impossible.`);
    } else if (row.avgDailyValueCr < 1) {
      reratingBonus -= 1;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PATCH 0322: FORENSIC PUMP DETECTOR (MosChip / RIR Power pattern)
  // ══════════════════════════════════════════════════════════════════════════
  // These checks identify operator-pumped microcaps where clean reported
  // fundamentals mask underlying manipulation. The pattern is real
  // accounting tricks (other-income inflation, dilution-funded growth,
  // related-party revenue, sudden share-count expansion, treasury gains
  // booked as PAT) that bypass standard quality screens like CFO/PAT.
  //
  // Track a "pump score" 0-100 — number of forensic signals triggered.
  // When pump score ≥ 3, fire a HIGH structural redflag (cap 60). When
  // ≥ 5, fire CRITICAL (cap 38). All under-microcap (mcap < ₹3000 Cr).
  let pumpScore = 0;
  const pumpFlags: string[] = [];
  const isMicrocapPump = (row.marketCapCr ?? 0) < 3000 && (row.marketCapCr ?? 0) > 0;

  if (isMicrocapPump) {
    // (1) Other Income > 25% of PBT — non-operating gains pumping bottom line.
    //     Detected when otherIncomePctPbt is directly provided OR when CFO/PAT
    //     is suspiciously high (>1.3) without explanation in a non-cash-rich
    //     sector (cash-rich = SaaS, asset-light services).
    if (typeof row.otherIncomePctPbt === 'number' && row.otherIncomePctPbt > 25) {
      pumpScore += 2;
      pumpFlags.push(`Other Income ${row.otherIncomePctPbt.toFixed(0)}% of PBT — operating PBT is inflated by non-recurring items`);
    }

    // (2) Cash declining despite reported profits — paper profits not converting.
    if (typeof row.cashAndEq === 'number' && typeof row.cashAndEqPrev === 'number'
        && row.cashAndEqPrev > 0
        && (row.cashAndEq - row.cashAndEqPrev) / row.cashAndEqPrev < -0.3
        && (row.profitCagr ?? 0) > 20) {
      pumpScore += 2;
      pumpFlags.push(`Cash declined ${(((row.cashAndEqPrev - row.cashAndEq) / row.cashAndEqPrev) * 100).toFixed(0)}% YoY despite ${row.profitCagr?.toFixed(0)}% profit growth — earnings not converting to cash on balance sheet`);
    }

    // (3) Sudden share-count expansion — dilution-funded growth pattern.
    //     If shares grew >25% over 3Y, the reported "EPS growth" is partly
    //     fictional (revenue growth funded by capital infusion, not earnings).
    if (typeof row.numSharesNow === 'number' && typeof row.numShares3y === 'number'
        && row.numShares3y > 0) {
      const dilutionPct = ((row.numSharesNow - row.numShares3y) / row.numShares3y) * 100;
      if (dilutionPct > 50) {
        pumpScore += 3; // very aggressive dilution
        pumpFlags.push(`Share count grew ${dilutionPct.toFixed(0)}% over 3Y — growth funded by capital infusion, not earnings`);
      } else if (dilutionPct > 25) {
        pumpScore += 2;
        pumpFlags.push(`Share count grew ${dilutionPct.toFixed(0)}% over 3Y — meaningful equity dilution`);
      }
    }

    // (4) Related-party transactions > 5% of revenue — value-transfer risk.
    if (typeof row.rptRevenuePct === 'number') {
      if (row.rptRevenuePct > 20) {
        pumpScore += 3;
        pumpFlags.push(`Related-party transactions ${row.rptRevenuePct.toFixed(0)}% of revenue — extreme related-party dependence`);
      } else if (row.rptRevenuePct > 10) {
        pumpScore += 2;
        pumpFlags.push(`Related-party transactions ${row.rptRevenuePct.toFixed(0)}% of revenue — material related-party exposure`);
      } else if (row.rptRevenuePct > 5) {
        pumpScore += 1;
      }
    }

    // (5) Auditor changes — frequent rotation = governance flag.
    if (typeof row.auditorChangesLast3y === 'number' && row.auditorChangesLast3y >= 2) {
      pumpScore += 2;
      pumpFlags.push(`${row.auditorChangesLast3y} auditor changes in 3Y — frequent rotation correlates with governance issues`);
    } else if (row.auditorChangesLast3y === 1) {
      pumpScore += 1;
    }

    // (6) Subsidiary structure complexity — multi-layer = value-extraction.
    if (typeof row.subsidiaryCount === 'number' && row.subsidiaryCount >= 10
        && (row.marketCapCr ?? 0) < 1000) {
      pumpScore += 2;
      pumpFlags.push(`${row.subsidiaryCount} subsidiaries on a sub-₹1000Cr microcap — multi-layer structure favored by operator-driven schemes`);
    }

    // (7) Extreme 52-week price range — operator-induced volatility.
    if (typeof row.highLowRangePct === 'number' && row.highLowRangePct > 200) {
      pumpScore += 2;
      pumpFlags.push(`52w range ${row.highLowRangePct.toFixed(0)}% (high vs low) — extreme volatility consistent with operator activity`);
    } else if (row.highLowRangePct !== undefined && row.highLowRangePct > 120) {
      pumpScore += 1;
    }

    // (8) Free float < 15% — operators can move thin floats easily.
    if (typeof row.freeFloatPct === 'number' && row.freeFloatPct < 15) {
      pumpScore += 1;
      pumpFlags.push(`Free float ${row.freeFloatPct.toFixed(0)}% — thin float vulnerable to coordinated activity`);
    }

    // (9) Sales growth >> Industry growth by sustained margin = either real
    //     winner or accounting acrobatics. Without a sector-growth field,
    //     we use the proxy: yoySales > 60% AND revCagr > 35% (i.e., the
    //     surge is sustained over multiple years).
    if ((row.yoySalesGrowth ?? 0) > 60 && (row.revCagr ?? 0) > 35
        && (row.cfoToPat ?? 99) < 0.7) {
      pumpScore += 2;
      pumpFlags.push(`Reported sales surging >35% CAGR with CFO/PAT only ${row.cfoToPat?.toFixed(2)} — growth not converting to cash`);
    }

    // (10) Promoter holding < 30% AND price 5×+ over 5Y — classic pump signature.
    //      Hard to detect without 5Y return; we use return1m > 30 as proxy.
    if ((row.promoter ?? 100) < 30 && (row.return1m ?? 0) > 30) {
      pumpScore += 2;
      pumpFlags.push(`Promoter ${row.promoter?.toFixed(0)}% + 1m return ${row.return1m?.toFixed(0)}% — low-promoter + sharp move = pump pattern signature`);
    }

    // (11) Promoter group entity count high — group restructuring obfuscation.
    if (typeof row.promoterEntityCount === 'number' && row.promoterEntityCount >= 15) {
      pumpScore += 1;
      pumpFlags.push(`${row.promoterEntityCount} entities in promoter group — complex group structure makes stake-tracking opaque`);
    }
  }

  // Expose pump score on the row so the UI can render a chip without
  // having to re-run the detector logic. (Patch 0326)
  (row as any).pumpScore = pumpScore;
  (row as any).pumpFlags = pumpFlags;

  // PATCH 0338 — Forensic pump-detector thresholds tightened. The deployed
  // output showed multiple "pump 2" tagged stocks (Dolphin Offshore, Garuda,
  // Prostarm, Yash Highvoltage, Vincofe, Sigma Solve at pumpScore=2) scoring
  // mid-table C-grade because the detector only fired HIGH at ≥3 and CRITICAL
  // at ≥5. In an operator-heavy market, pumpScore ≥2 is already enough
  // independent signals to warrant HIGH structural treatment. Lowered:
  //   ≥4 = CRITICAL (cap 38)   ← was ≥5
  //   ≥2 = HIGH structural (cap 60)   ← was ≥3
  //   1  = MEDIUM (−2 rerating)        ← unchanged
  if (pumpScore >= 4) {
    redFlags.push({
      label: `Forensic pump signals: ${pumpScore} red flags`,
      severity: 'CRITICAL',
      source: 'Forensic detector',
      kind: 'STRUCTURAL',
    });
    risks.push(`🚨 FORENSIC ALERT — Multiple operator-pump signals detected: ${pumpFlags.slice(0, 5).join(' · ')}. Treat reported fundamentals with extreme skepticism.`);
  } else if (pumpScore >= 2) {
    redFlags.push({
      label: `Forensic pump signals: ${pumpScore} flags`,
      severity: 'HIGH',
      source: 'Forensic detector',
      kind: 'STRUCTURAL',
    });
    risks.push(`Forensic flags: ${pumpFlags.join(' · ')}. Surface fundamentals may not reflect underlying reality.`);
  } else if (pumpScore >= 1) {
    reratingBonus -= 2;
    if (pumpFlags.length > 0) {
      risks.push(`Forensic signal: ${pumpFlags[0]}`);
    }
  }

  // Delta signal: promoter buying from high base = strongest insider signal
  if ((row.changeInPromoter??0) > 2 && ownershipCategory === 'FOUNDER_CONTROLLED') {
    reratingBonus += 3; // founder buying more when already >50% = very high conviction
    strengths.push(`Insider accumulation: promoter bought +${row.changeInPromoter?.toFixed(1)}% from strong base`);
  } else if ((row.changeInPromoter??0) < -3 && (row.promoter??0) > 40) {
    reratingBonus -= 4; // significant promoter selling = watch closely
    risks.push(`Insider selling: promoter sold ${Math.abs(row.changeInPromoter??0).toFixed(1)}% — exit signal if trend continues`);
  }
  // PATCH 0313 — Stronger penalty when promoter is ALREADY low and still
  // selling. Cumulative dilution from a low base is the most predictive
  // operator-exit signal in Indian small-caps.
  if ((row.changeInPromoter??0) < -2 && (row.promoter??0) <= 30) {
    reratingBonus -= 10;
    risks.push(`Promoter exit pattern: ${row.promoter?.toFixed(0)}% holding declining by ${Math.abs(row.changeInPromoter??0).toFixed(1)}pp — operator may be cashing out into retail float.`);
  }

  // ── PATCH 0338: 500-BAGGER DNA BONUS ───────────────────────────────────────
  // Mining the archetypes already in the engine (Page Industries 2008, Astral
  // Pipes 2010, Avanti Feeds 2011, Caplin Point 2014, Symphony 2010, Bajaj
  // Finance 2010, Eicher Motors 2003), every single one had this exact DNA at
  // its 100x setup point:
  //
  //   (1) Promoter 50-75% — sweet spot. Below 50 = operator risk. Above 85 =
  //       sleepy holding, no float for institutional re-rating.
  //   (2) ROCE > 25% sustained — pricing power confirmed.
  //   (3) CFO/PAT > 1.0 — earnings fully cash-backed.
  //   (4) FCF positive — self-funding growth (no dilution).
  //   (5) D/E < 0.3 — clean balance sheet (or zero for asset-light).
  //   (6) Non-cyclical sector — durable economics.
  //   (7) Sales CAGR > 18% — meaningful base growth runway.
  //
  // When ALL seven align, this is the canonical setup. Add +6 reratingBonus
  // (substantial — comparable to a tier-1 sector tailwind). This is the
  // "looks like Page Industries 2008" signature reward.
  //
  // Critical: if ANY operator/governance red flag fires (CRITICAL or HIGH
  // structural), this bonus does NOT apply — clean people first, then DNA.
  const hasHighStructEarly = redFlags.some(f =>
    f.severity === 'CRITICAL' ||
    (f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL')
  );
  const dnaPromoter   = (row.promoter ?? 0) >= 50 && (row.promoter ?? 0) <= 75;
  const dnaRoce       = (row.roce ?? 0) > 25;
  const dnaCfo        = (row.cfoToPat ?? 0) > 1.0;
  const dnaFcf        = (row.fcfAbsolute ?? -1) > 0;
  const dnaDe         = (row.de ?? 99) < 0.3;
  const dnaNonCyclic  = !cyclical;
  const dnaGrowth     = (row.revCagr ?? 0) >= 18;
  const dnaPledgeZero = (row.pledge ?? 0) === 0;
  const dnaPromoterStable = (row.changeInPromoter ?? 0) >= -1; // not declining materially
  const dnaCount = [dnaPromoter, dnaRoce, dnaCfo, dnaFcf, dnaDe, dnaNonCyclic, dnaGrowth, dnaPledgeZero, dnaPromoterStable].filter(Boolean).length;

  if (dnaCount >= 8 && !hasHighStructEarly) {
    reratingBonus += 6;
    strengths.push(`💎 500-BAGGER DNA (${dnaCount}/9): Promoter ${row.promoter?.toFixed(0)}% + ROCE ${row.roce?.toFixed(0)}% + CFO/PAT ${row.cfoToPat?.toFixed(2)} + FCF+ + D/E ${row.de?.toFixed(2)} + non-cyclical + CAGR ${row.revCagr?.toFixed(0)}% — canonical Page/Astral/Avanti compounder setup.`);
  } else if (dnaCount >= 7 && !hasHighStructEarly) {
    reratingBonus += 3;
    strengths.push(`Strong DNA (${dnaCount}/9): matches multibagger archetype on most dimensions.`);
  }

  // ── PATCH 0338: NICHE PRICING POWER (non-cyclical premium-margin bonus) ──
  // 500-baggers have OPM > sector p75 SUSTAINED — that's the durable-moat
  // signature (Page, Astral, Caplin, Avanti). In a cyclical sector, premium
  // OPM is a peak-earnings warning. In a non-cyclical sector, it's a moat.
  // Add +4 reratingBonus when (OPM > 1.3× sector p75) + non-cyclical + 3yr
  // profit CAGR >25%. Distinguishes "real pricing power" from "cycle peak".
  if (!cyclical && row.opm !== undefined && b.opm[2] > 0
      && row.opm > b.opm[2] * 1.3
      && (row.profitCagr ?? 0) > 25
      && !hasHighStructEarly) {
    reratingBonus += 4;
    strengths.push(`Niche pricing power: OPM ${row.opm.toFixed(1)}% is ${(row.opm / b.opm[2]).toFixed(1)}× sector p75 in non-cyclical — durable moat signature, not cycle peak.`);
  }

  // ── PATCH 0338: CYCLICAL-RECOVERY DISTINGUISHER ─────────────────────────
  // Override the cyclical-peak cap (added in Patch 0337) when the pattern is
  // recovery-from-low-base, not peak-earnings. Telltale: revCagr < 15%
  // (multi-year flat/declining base) but recent YoY > 40% (sharp recovery
  // year). This is Mayur Uniquoters / CEAT-style cyclical recovery, NOT the
  // peak-earnings setup that mean-reverts.
  // We can't override the cap here directly (it's applied later), so we set
  // a row flag that the cap section reads.
  const isCyclicRecovery = cyclical
    && (row.revCagr ?? 0) < 15
    && (row.yoySalesGrowth ?? 0) > 40
    && (row.cfoToPat ?? 0) > 0.8
    && (row.fcfAbsolute ?? -1) > 0
    && !hasHighStructEarly;
  (row as any).isCyclicRecovery = isCyclicRecovery;
  if (isCyclicRecovery) {
    strengths.push(`Cyclical recovery (not peak): revCagr ${row.revCagr?.toFixed(0)}% with sharp YoY ${row.yoySalesGrowth?.toFixed(0)}% rebound — recovery year off low base, not earnings peak.`);
  }

  // ── GAP 3: INDUSTRY TAILWIND BONUS ──────────────────────────────────────────
  // Structural sector tailwind is a forward-looking signal not captured in any pillar.
  // Fisher Stage 1: "Is the industry growing? If not, can the company take market share?"
  // Defence/EMS/Solar/Railway get bonus; Metals/Textiles/Oil get penalty.
  const tailwind = getSectorTailwind(row.sector);
  const tailwindBonus = tailwind.score >= 80 ? 8 : tailwind.score >= 65 ? 5 :
                        tailwind.score >= 50 ? 2 : tailwind.score < 30 ? -7 : 0;
  if (tailwind.score >= 80) strengths.push(`Sector tailwind (${tailwind.label}): ${tailwind.drivers}`);
  else if (tailwind.score < 35) risks.push(`Sector headwind (${tailwind.label}): ${tailwind.drivers}`);
  reratingBonus += tailwindBonus;

  // ── GAP 1+2: INCREMENTAL ROCE + OPM BONUS to reratingBonus ────────────────
  // ROCE expanding + OPM expanding together = compounding moat setup (Fisher enduring quality)
  if ((row.roceExpansion ?? -99) > 5 && (row.opmExpansion ?? -99) > 3) {
    reratingBonus += 4;
    strengths.push(`Double quality compounder: ROCE +${row.roceExpansion?.toFixed(1)}pp + OPM +${row.opmExpansion?.toFixed(1)}pp — moat strengthening`);
  }

  reratingBonus = Math.max(-18, Math.min(18, reratingBonus));

  // ── FINAL SCORE ───────────────────────────────────────────────────────────
  const rawAfterPenalty = Math.max(0, raw - hardPenalty);
  const penalized = rawAfterPenalty * (0.5 + coverageRatio * 0.5);
  // PATCH 0315 — HIGH severity is now tier-split. Structural HIGH (governance,
  // leverage, capital-allocation) carries full -12 penalty + cap 60. Cyclical
  // HIGH (single-quarter margin slip, revenue decel) carries -6 penalty + cap 72.
  // Lets fundamentally strong names that ran into one mean-revertable issue
  // still grade B+ instead of getting flattened to B.
  //
  // PATCH 0335 — CRITICAL BUG FIX. Previously read highStructPre (the
  // bucket-classification snapshot taken at line ~1572 before the rule
  // blocks at lines 1762-2146 had run). After Patches 0317/0322/0334 added
  // many late-stage red-flag pushes (ICR, working-capital, ownership-trend,
  // forensic pump signals), the cap never bound because the count was stale.
  // Visible symptom: SCORE AUDIT panel showed "2 HIGH structural · cap 48 ·
  // Active cap: 48 (binding)" but the actual score landed at 89. Recompute
  // freshly here over the FINAL redFlags array so caps actually bind.
  // PATCH 1044 — append fraud risk flags so cap chain binds CRITICAL→38, etc.
  redFlags.push(...computeFraudRiskFlags(row));
  const hasCritFinal      = redFlags.some(f => f.severity === 'CRITICAL');
  const highStructuralCnt = redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
  const highCyclicalCnt   = redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
  const medCntFinal       = redFlags.filter(f => f.severity === 'MEDIUM').length;
  const redFlagPenalty = (hasCritFinal?25:0) + (highStructuralCnt*12) + (highCyclicalCnt*6) + (medCntFinal*5);

  // Block trigger bonuses entirely when in deceleration phase.
  // Op leverage 3.7x on a decelerating stock is a LAGGING signal, not a forward one.
  const isDecelerating = (rawRevDecel !== undefined && rawRevDecel < -5) || row.accelSignal === 'DECELERATING';
  const effectiveTriggerBonus = isDecelerating ? 0 : triggerBonus;

  // Total bonus includes: rerating + trajectory + trigger signals
  const totalBonus = reratingBonus + trajectoryBonus + effectiveTriggerBonus;

  // PATCH 0460 — Math.floor (not Math.round) so caps actually bind. With
  // Math.round, a raw score of 77.5 became 80 and silently jumped the A-grade
  // boundary — the same bug we fixed in patch 0344 on the USA side. Now the
  // India side uses the same floor-quantize discipline.
  let score = Math.floor((penalized - redFlagPenalty + totalBonus) / 5) * 5;

  // ── STANDARD RED FLAG CAPS (PATCH 0315 — kind-aware, PATCH 0335 — fresh counts) ───
  if (hasCritFinal)                     score = Math.min(score, 38);
  else if (highStructuralCnt >= 2)      score = Math.min(score, 48);   // 2+ structural flags = structural failure
  else if (highStructuralCnt >= 1)      score = Math.min(score, 60);   // 1 structural flag = ceiling at B
  else if (highCyclicalCnt >= 2)        score = Math.min(score, 62);   // 2+ cyclical flags = clear pressure
  else if (highCyclicalCnt >= 1)        score = Math.min(score, 72);   // 1 cyclical flag = still B+ ceiling
  // Mixed case (1 of each) hits the structural cap first (60) since structural dominates.
  if (row.accelSignal === 'DECELERATING') score = Math.min(score, 52);
  if (bucket === 'MONITOR') score = Math.min(score, 45);

  // ── PATCH 0313: GOVERNANCE WATCH SCORE CAP ───────────────────────────────
  // The pump-and-dump fingerprint caps composite at 65 regardless of
  // financial-quality magnitude. Setup risk dominates fundamental quality
  // when the fundamentals themselves can't be independently verified.
  if (governanceWatch) {
    score = Math.min(score, 65);
  }

  // ── PATCH 0337: OP-LEVERAGE <1.0 COMPOSITE CAP ────────────────────────────
  // 3B Blackbio pattern: op-lev 0.6 with great growth/quality pillars still
  // scored 89 because the −10 hardPenalty wasn't enough to override the
  // pillar magnitude. Costs growing faster than revenue means the company is
  // scaling its way to lower returns — even great fundamentals don't justify
  // A-grade if unit economics are deteriorating. Cap composite at 75 when
  // op-lev < 1.0 with meaningful growth (excludes flat businesses).
  if (row.recentOpLev !== undefined && row.recentOpLev < 1.0
      && (row.yoySalesGrowth ?? 0) > 15) {
    score = Math.min(score, 75);
  }

  // ── PATCH 0337: CYCLICAL-PEAK MARGINS COMPOSITE CAP ───────────────────────
  // CEAT / Disa India pattern: cyclical sectors at margin peaks score A-grade
  // because pillars don't discount for mean-reversion risk. The reratingBonus
  // already takes −4 (cyclical) + −6 (cycle-peak) but pillar magnitude can
  // still push past 80. Cap composite at 80 when (cyclical sector + OPM ≥ 1.5×
  // sector p75 + profit CAGR > 40%) — the textbook "looks great at the peak"
  // setup that mean-reverts.
  //
  // PATCH 0338 — Exemption for cyclical-recovery pattern (Mayur Uniquoters
  // style): recovery from low base is NOT peak earnings, so don't cap.
  if (cyclical
      && row.opm !== undefined && b.opm[2] > 0
      && row.opm > b.opm[2] * 1.5
      && (row.profitCagr ?? 0) > 40
      && !(row as any).isCyclicRecovery) {
    score = Math.min(score, 80);
  }

  // ── DECAY FILTER — binding caps from RAW numbers, not derived fields ─────────
  // These fire even when accelSignal/profitAcceleration failed to compute (column mapping issue).
  // "Past winners" must be eliminated. A stock scoring A+ on 145% historical CAGR
  // while current acceleration is -13pp and profit decel is -48pp is a FADING MULTIBAGGER.

  // Revenue deceleration > 10pp below CAGR → hard cap at 55
  if (rawRevDecel !== undefined && rawRevDecel < -10) {
    score = Math.min(score, 55);
    if (rawRevDecel < -10) risks.push(`Decay filter: revenue decel ${rawRevDecel.toFixed(0)}pp below CAGR → capped at 55`);
  }

  // Profit deceleration > 25pp below CAGR → hard cap at 50
  //
  // PATCH 0339 — Clean-compounder exemption. When all major quality signals
  // are intact (8/8 kill-switch + Fin pillar >75 + ROIC > WACC + no
  // CRITICAL/HIGH-structural red flags + COMP reinvestment signal), a single
  // quarter of profit deceleration is most likely cyclical/macro/one-time
  // (client timing, FX, base effect) — NOT structural decay. Raise the cap
  // from 50 to 70 so these names can hold B+. Catches InfoBeans pattern:
  // bootstrapped, founder-led, COMP 95, 8/8 survival, Fin 85, but one
  // bad quarter dropped it to C-grade.
  if (rawProfDecel !== undefined && rawProfDecel < -25) {
    const cleanCompounder =
      (row.cfoToPat ?? 0) > 0.9
      && (row.roic ?? 0) > 12
      && (row.fcfAbsolute ?? -1) > 0
      && (row.de ?? 99) < 0.4
      && redFlags.filter(f =>
           f.severity === 'CRITICAL' ||
           (f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL')
         ).length === 0
      && rawProfDecel > -50; // genuinely catastrophic decel still capped at 50
    const cap = cleanCompounder ? 70 : 50;
    score = Math.min(score, cap);
    if (cleanCompounder) {
      risks.push(`Decay filter (clean-compounder lenience): profit decel ${rawProfDecel.toFixed(0)}pp on otherwise-pristine company → capped at 70 (vs 50 default). One quarter of profit miss, not structural decay.`);
    } else {
      risks.push(`Decay filter: profit decel ${rawProfDecel.toFixed(0)}pp below CAGR → capped at 50`);
    }
  }

  // BOTH decelerating (combined trajectory < -40pp) → hard cap at 45 + additional penalty
  const rawTrajectory = (rawRevDecel !== undefined && rawProfDecel !== undefined) ? rawRevDecel + rawProfDecel : undefined;
  if (rawTrajectory !== undefined && rawTrajectory < -40) {
    score = Math.min(score, 45);
    risks.push(`Decay filter: combined trajectory ${rawTrajectory.toFixed(0)}pp → "fading multibagger" → capped at 45`);
  }

  // Massively overvalued + decelerating → never above 50
  if ((row.marginOfSafety ?? 0) < -60 && isDecelerating) {
    score = Math.min(score, 48);
  }

  // ── QUALITY CAP — Fix 1 ──────────────────────────────────────────────────────
  // "Real compounders vs temporary growth spikes" — Fisher/MOSL core principle.
  // Strong growth + weak quality = cyclical spike, NOT a 100-bagger.
  const hasQualityWeakness =
    (row.cfoToPat !== undefined && row.cfoToPat < 0.6) ||   // poor cash conversion
    (row.opm !== undefined && row.opm < b.opm[0]) ||        // below sector p25
    (row.roce !== undefined && row.roce < 15);              // below minimum ROCE

  if (hasQualityWeakness) {
    score = Math.min(score, 85);
    // Strongest quality failures cap even lower
    if (row.cfoToPat !== undefined && row.cfoToPat < 0.5) {
      score = Math.min(score, 80); // CFO/PAT < 0.5 = earnings are largely paper profit
    }
  }

  // ── VALUATION REALITY CHECK — Fix 3 ──────────────────────────────────────────
  // "Every true multibagger looks expensive — but not MASSIVELY overvalued vs IV"
  if ((row.marginOfSafety ?? 0) < -50) score = Math.min(score, 80);
  else if ((row.marginOfSafety ?? 0) < -30) score = Math.min(score, 90);

  // ── A+ RARITY GATE — requires ALL quality gates simultaneously ───────────────
  // A+ (≥90) requires evidence of genuine quality, not just growth/acceleration.
  if (score >= 90) {
    const passesAplusGate =
      (row.cfoToPat ?? 0) > 1.0 &&     // earnings fully backed by cash (and more)
      (row.roce ?? 0) > 20 &&           // above-average return on capital
      (row.fcfAbsolute ?? -1) > 0 &&    // generating real free cash flow
      (row.promoter ?? 0) > 50;         // promoter majority stake
    if (!passesAplusGate) {
      score = Math.min(score, 89); // cap at 89 = A range (A+ requires ≥90)
      risks.push(`A+ gate failed: need CFO/PAT>1.0 + ROCE>20 + FCF positive + Promoter>50. Capped at 89.`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  // Institutional grade distribution: A+ = top 5-10%, A = next 10-15%, etc.
  // Raised thresholds to prevent A+ inflation (was 80 → now 90).
  const grade:Grade = score>=90?'A+':score>=80?'A':score>=68?'B+':score>=55?'B':score>=42?'C':'D';

  // ── DECISION STRIP ────────────────────────────────────────────────────────
  const decisionStrip: DecisionStrip = {
    survival: { pass:!hasCrit&&highCnt===0&&(row.pledge??0)<=25&&(row.de??0)<=(b.deMax*1.5), label:'Survival', detail:hasCrit?'CRITICAL flag':highCnt>0?`${highCnt} HIGH flag(s)`:(row.pledge??0)>25?`Pledge ${row.pledge?.toFixed(0)}%`:'Clean' },
    acceleration: { pass:row.accelSignal==='ACCELERATING'||(row.yoySalesGrowth??0)>=20, label:'Accel', detail:row.accelSignal??(row.yoySalesGrowth!==undefined?`YOY ${row.yoySalesGrowth.toFixed(0)}%`:'No data') },
    // PATCH 0436 BUG-031 — PEG guard. When trailing EPS growth is negative,
    // Screener.in returns a negative PEG which is mathematically nonsensical
    // for valuation use. Show 'PEG N/A (neg growth)' instead of a misleading
    // negative number.
    valuation: { pass:((row.peg??99)<1.5&&(row.peg??0)>0)||((row.marginOfSafety??-99)>0), label:'Value', detail:row.peg!==undefined&&row.peg>0?`PEG ${row.peg.toFixed(1)}`:row.peg!==undefined&&row.peg<0?`PEG N/A (neg growth)`:row.marginOfSafety!==undefined?`MoS ${row.marginOfSafety.toFixed(0)}%`:'No data' },
    discovery: { pass:(row.fiiPlusDii??100)<25, label:'Discovery', detail:row.fiiPlusDii!==undefined?`FII+DII ${row.fiiPlusDii.toFixed(0)}%`:'No data' },
    // PATCH 0440 BUG-031 — When 'No data' shows, hint the user that this is
    // a CSV-column gap (Screener.in '200 DMA' / 'Current Price' missing for
    // this row), not a system failure. Helps user know how to fix it.
    technical: { pass:(row.aboveDMA200??-100)>=0&&(row.return1m??-100)>=-15, label:'Technical', detail:row.aboveDMA200!==undefined?`${row.aboveDMA200>=0?'+':''}${row.aboveDMA200.toFixed(0)}% vs DMA`:'No data (add 200 DMA col)' },
  };

  // Compute kill-switch AFTER all scoring is settled
  const killSwitch = computeKillSwitch(row);

  // PATCH 0058: Auto-compute archetype match — encodes historical lessons.
  // This pulls together the bucket assignment + dilution + acceleration to
  // tell the user which canonical multibagger this stock most resembles.
  const archetype = computeArchetypeMatch({
    marketCapCr: row.marketCapCr,
    roce: row.roce,
    profitCagr: row.profitCagr,
    epsGrowth: row.epsGrowth,
    promoter: row.promoter,
    fiiPlusDii: row.fiiPlusDii,
    dilutionDragPp: row.dilution?.drag_pp ?? null,
    accelSignal: row.accelSignal,
    bucket,
  });

  // PATCH 0066: ROIC vs sector-default WACC spread (computable from existing data)
  const roicVsWacc = analyzeRoicVsWacc({
    roic: row.roic,
    roce: row.roce,
    sector: getSectorKey(row.sector),
  });

  // PATCH 0066: Missing dimensions panel — honest signaling of gaps
  // (we can't measure customer concentration, founder tenure, etc., from
  // Screener exports alone, but we tell the user explicitly so they can
  // manually verify the high-stakes ones).
  const missingDimensions = buildMissingDimensions({
    hasGpm: row.gpm !== undefined,
    hasRoic: row.roic !== undefined,
    hasFcfTrend: false,                 // single-year only in Screener default
    hasCustomerConcentration: false,    // not in standard export
    hasFounderTenure: false,            // not in standard export
    hasGpm5yTrend: row.opm5y !== undefined,  // PATCH 1026: OPM 5Y as margin-trend proxy
  });

  return {
    ...row, score, grade, bucket, ownershipCategory, decisionStrip, reratingBonus, trajectoryScore, triggerBonus, inflectionSignal, coverage, strengths, risks, redFlags, killSwitch,
    archetype,
    roic_vs_wacc: roicVsWacc,
    missing_dimensions: missingDimensions,
    pillarScores: [
      {id:'QUALITY',    label:'Quality',      score:Math.round(qualCapped),  color:'#a78bfa', weight:Math.round(bw[0]*100)},
      {id:'GROWTH',     label:'Growth',       score:Math.round(growthFinal), color:'#38bdf8', weight:Math.round(bw[1]*100)},
      {id:'ACCEL',      label:'Accel',        score:Math.round(accel),       color:'#10b981', weight:Math.round(bw[2]*100)},
      {id:'LONGEVITY',  label:'Longevity',    score:Math.round(longeCapped), color:'#06b6d4', weight:Math.round(bw[3]*100)},
      {id:'FIN_STR',    label:'Fin Str',      score:Math.round(fin),         color:'#34d399', weight:Math.round(bw[4]*100)},
      {id:'VALUATION',  label:'Valuation',    score:Math.round(val),         color:'#f59e0b', weight:Math.round(bw[5]*100)},
      {id:'MARKET',     label:'Market',       score:Math.round(mkt),         color:'#f97316', weight:Math.round(bw[6]*100)},
    ],
  };
}
