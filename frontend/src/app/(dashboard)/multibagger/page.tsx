'use client';

import { useState, useMemo, useRef } from 'react';

// ── Design tokens — institutional scale ───────────────────────────────────────
const BG      = '#0a0a0f';
const CARD_BG = '#13131a';
const CARD2   = '#191926';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#e2e8f0';
const MUTED   = '#64748b';
const PURPLE  = '#a78bfa';
const ACCENT  = '#38bdf8';
const GREEN   = '#10b981';
const RED     = '#ef4444';
const ORANGE  = '#f97316';
const YELLOW  = '#f59e0b';

// Font scale — institutional / terminal grade
const F = { xs:11, sm:13, md:15, lg:17, xl:20, h1:24, h2:20, h3:17 };

type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'NR';

// Minimal NewsArticle type for guidance scoring (full type lives in bottleneck-intel)
interface NewsArticle {
  id?: string; title?: string; headline?: string; summary?: string;
  ticker_symbols?: string[]; article_type?: string; published_at?: string;
  source_name?: string; importance_score?: number;
}
const GRADE_COLOR: Record<Grade, string> = {
  'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444','NR':'#64748b',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST — 37 criteria from SQGLP (MOSL 100x) + Fisher 100-Bagger + Framework
// ═══════════════════════════════════════════════════════════════════════════════

interface ChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number; source: string;
  autoField?: keyof ExcelRow; autoPass?: (v: number, row?: ExcelRow) => boolean;
  autoFormat?: (v: number, row?: ExcelRow) => string;
}

const CHECKLIST: ChecklistItem[] = [
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

interface ExcelRow {
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
  // Derived
  marginOfSafety?: number;
  aboveDMA200?: number;
  netDebtEbitda?: number;
  fiiPlusDii?: number;
  opLeverageRatio?: number;    // profitCagr / revCagr (historical)
  // ── RECENT / ACCELERATION — Framework.docx Core Signal ────────────────────
  // Derived by comparing latest quarter (YOY) vs historical CAGR
  revenueAcceleration?: number;   // yoySalesGrowth - revCagr → positive = accelerating
  profitAcceleration?: number;    // yoyProfitGrowth - profitCagr → positive = accelerating
  recentOpLev?: number;           // yoyProfitGrowth / yoySalesGrowth (recent operating leverage)
  accelSignal?: 'ACCELERATING' | 'STABLE' | 'DECELERATING'; // composite trend signal
}

// ── OWNERSHIP INTELLIGENCE LAYER ─────────────────────────────────────────────
// Replaces flat "promoter < 35% = penalty" with context-aware ownership scoring.
// Promoter holding alone is meaningless without knowing who else holds the stock.
type OwnershipCategory = 'FOUNDER_CONTROLLED' | 'INSTITUTIONALIZING' | 'MATURE' | 'OWNERSHIP_VACUUM';

const OWNERSHIP_CONFIG: Record<OwnershipCategory, { label: string; color: string; icon: string; strategy: string; allocation: string }> = {
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

function classifyOwnership(promoter?: number, fiiDii?: number, changeInPromoter?: number): OwnershipCategory {
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
type Bucket = 'CORE_COMPOUNDER' | 'EMERGING_MULTIBAGGER' | 'HIGH_RISK' | 'MONITOR';
const BUCKET_CONFIG: Record<Bucket, { label: string; color: string; icon: string; desc: string }> = {
  CORE_COMPOUNDER:     { label: 'Core Compounder',      color: '#10b981', icon: '🏆', desc: 'High quality + consistent growth + clean balance sheet' },
  EMERGING_MULTIBAGGER:{ label: 'Emerging Multibagger',  color: '#a78bfa', icon: '🚀', desc: 'Accelerating growth + early discovery + rerating potential' },
  HIGH_RISK:           { label: 'High-Risk Accel',       color: '#f97316', icon: '⚡', desc: 'Fast growth but balance sheet or quality concerns' },
  MONITOR:             { label: 'Monitor / Watch',       color: '#64748b', icon: '👁', desc: 'Fails hard filters — watch only, not for active sizing' },
};

// ── DECISION STRIP — 5 pass/fail checks shown on every row ───────────────────
interface DecisionCheck { pass: boolean; label: string; detail: string; }
interface DecisionStrip {
  survival: DecisionCheck;    // No CRITICAL flags, debt OK, promoter OK
  acceleration: DecisionCheck;// Revenue accelerating vs historical
  valuation: DecisionCheck;   // PEG < 1.5 or below intrinsic value
  discovery: DecisionCheck;   // FII+DII < 25% (undiscovered)
  technical: DecisionCheck;   // Above DMA200, not in deep drawdown
}

interface ExcelResult extends ExcelRow {
  score: number; grade: Grade;
  bucket: Bucket;
  decisionStrip: DecisionStrip;
  pillarScores: { id: string; label: string; score: number; color: string; weight: number }[];
  redFlags: { label: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM'; source: string }[];
  strengths: string[]; risks: string[];
  coverage: number;
  reratingBonus: number;
  ownershipCategory: OwnershipCategory;
  // New: trajectory and trigger signals
  trajectoryScore: number;  // (recent − historical) for sales + profit — change direction
  triggerBonus: number;     // proxy for turnaround / new engine / inflection
  inflectionSignal: boolean;// early-phase: low→high profit growth
}

// Sector benchmarks: [p25, median, p75]
// ── SECTOR BENCHMARKS — sector-appropriate, NOT normalized across all ────────
// Capital-light sectors (IT, asset-light) have naturally higher ROCE — their
// benchmark p75 is set higher so 60% ROCE in IT doesn't score 100 automatically.
// Capital-intensive sectors (Infra, Solar, Steel, Auto) have lower ROCE expectations.
// This gives credit to a manufacturing company achieving 25% ROCE vs IT company at 60%.
const SBENCH: Record<string, { roce: number[]; opm: number[]; pe: number[]; rg: number[]; deMax: number }> = {
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

function getSectorKey(s: string): string {
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

function sv(v: number|undefined, bench: number[], hiGood=true): number {
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
function isCyclicalSector(sector: string): boolean {
  const s = sector.toUpperCase();
  return /METAL|STEEL|IRON|ALUMIN|COPPER|ZINC|CEMENT|MINING|MINERAL|COMMODITY|OIL|GAS|CRUDE|PETRO|SUGAR|COTTON|TEXTILE.*SPIN|FERTILISER|FERTILIZER|CAST.*FORG|FORG.*CAST|SHIPPING|BULK/.test(s);
}

// ── FORCED RANKING — institutional grade distribution ─────────────────────────
// Converts absolute score into a relative rank. Top 10% = A+, not every stock >80.
// This matches how institutional funds actually construct watchlists:
// only the top 5-10% of a screen is actionable; the rest is monitor-only.
function applyForcedRanking(results: ExcelResult[]): ExcelResult[] {
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

    // ── EXTREME GROWTH FALSE POSITIVE RULE ──────────────────────────────────
    // Silkflex pattern: Sales +200%, FCF negative, D/E > 1 = classic small-cap spike risk
    // The model rewards growth but misses fragility when multiple risk factors compound.
    const GRADE_DOWN: Record<Grade, Grade> = {'A+':'A','A':'B+','B+':'B','B':'C','C':'D','D':'D','NR':'NR'};
    if ((r.revCagr ?? 0) > 150 && (r.fcfAbsolute ?? 1) < 0 && (r.de ?? 0) > 1.0) {
      grade = GRADE_DOWN[grade] as Grade; // forced 1-tier downgrade
    }

    // ── HARD METRIC GRADE CAPS (absolute, rank-independent) ──────────────────
    // These ensure score and grade tell the same story. A stock with a serious
    // structural flaw cannot appear in top picks regardless of other strengths.

    // CFO/PAT < 0.8 → max B+ (earnings quality too weak for A-tier)
    if ((r.cfoToPat ?? 1) < 0.8 && (r.cfoToPat ?? 1) >= 0) {
      if (grade === 'A+' || grade === 'A') grade = 'B+';
    }

    // D/E > 1.0 → max B (leverage too high for investment-grade picks)
    if ((r.de ?? 0) > 1.0) {
      if (grade === 'A+' || grade === 'A' || grade === 'B+') grade = 'B';
    }

    // MoS worse than -50% → no A grades (overvalued vs intrinsic)
    if ((r.marginOfSafety ?? 0) < -50) {
      if (grade === 'A+' || grade === 'A') grade = 'B+';
    }

    // Profit deceleration worse than -25pp → never in top picks
    if ((r.profitAcceleration ?? 0) < -25) {
      if (grade === 'A+' || grade === 'A' || grade === 'B+') grade = 'B';
    }

    // Bucket overrides: MONITOR → max B, HIGH_RISK → max A (rank-independent)
    if (r.bucket === 'MONITOR'   && !['C','D'].includes(grade))  grade = 'B';
    if (r.bucket === 'HIGH_RISK' && grade === 'A+')               grade = 'A';

    return { ...r, grade };
  });
}

function scoreExcelRow(row: ExcelRow): ExcelResult {
  const b = SBENCH[getSectorKey(row.sector)] ?? SBENCH.DEFAULT;
  const cyclical = isCyclicalSector(row.sector);
  const strengths: string[] = [];
  const risks: string[] = [];
  const redFlags: { label:string; severity:'CRITICAL'|'HIGH'|'MEDIUM'; source:string }[] = [];

  // PRE-BUCKET: rough classification used to relax thresholds for Emerging bucket
  // (Full bucket classification happens after scoring)
  const isLikelyEmerging =
    (row.accelSignal === 'ACCELERATING' || (row.yoySalesGrowth ?? 0) >= 25) &&
    (row.marketCapCr ?? 99999) <= 10000;

  let qualS=0,qualC=0, growS=0,growC=0, accelS=50,accelC=1,
      longS=0,longC=0, finS=0,finC=0, valS=0, mktS=50,mktC=1;

  // ── QUALITY (feeds qual pillar) ───────────────────────────────────────────
  if (row.roce!==undefined) {
    const s=sv(row.roce,b.roce); qualS+=s; qualC++;
    if (s>=80) strengths.push(`ROCE ${row.roce.toFixed(1)}% — above sector, moat confirmed`);
    else if (s<45) risks.push(`ROCE ${row.roce.toFixed(1)}% — below sector benchmark`);
  }
  if (row.roe!==undefined)  { qualS+=sv(row.roe,[12,18,26]); qualC++; }
  if (row.opm!==undefined)  { qualS+=sv(row.opm,b.opm); qualC++; }
  if (row.cfoToPat!==undefined) {
    const s = row.cfoToPat>=1.0?90:row.cfoToPat>=0.8?78:row.cfoToPat>=0.5?55:row.cfoToPat>=0?32:15;
    qualS+=s; qualC++;
    if (row.cfoToPat>=1.0) strengths.push(`CFO/PAT ${row.cfoToPat.toFixed(2)}x — excellent earnings quality`);
    if (row.cfoToPat<0) { risks.push(`Negative CFO/PAT — earnings not backed by cash`); redFlags.push({label:'Negative cash flow from operations',severity:'HIGH',source:'Fisher'}); }
  }
  if (row.fcfAbsolute!==undefined) {
    const s = row.fcfAbsolute>0?80:50;
    qualS+=s; qualC++;
    if (row.fcfAbsolute>0) strengths.push(`FCF positive ₹${row.fcfAbsolute.toFixed(0)}Cr — self-funding growth`);
    else risks.push(`FCF negative — dependent on external capital`);
  }
  if (row.promoter!==undefined) {
    qualS+=sv(row.promoter,[20,40,60]); qualC++;
    if (row.promoter<20) redFlags.push({label:`Promoter ${row.promoter.toFixed(0)}% — very low`,severity:'HIGH',source:'MOSL+Fisher'});
    if (row.promoter>=55) strengths.push(`Promoter ${row.promoter.toFixed(0)}% — strong alignment`);
  }

  // ── GROWTH (historical trajectory) ───────────────────────────────────────
  if (row.revCagr!==undefined) {
    const s=sv(row.revCagr,[8,15,25]); growS+=s; growC++;
    if (s>=80) strengths.push(`Revenue CAGR ${row.revCagr.toFixed(1)}% — excellent growth engine`);
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
      redFlags.push({ label: `Revenue decelerating`, severity: 'HIGH', source: 'Framework' });
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

  // ── FINANCIAL STRENGTH ────────────────────────────────────────────────────
  if (row.de!==undefined) {
    finS+=sv(row.de,[0.5,1.0,2.0],false); finC++;
    if (row.de>3.0) redFlags.push({label:`D/E ${row.de.toFixed(2)}× — CRITICAL debt`,severity:'CRITICAL',source:'Fisher'});
    else if (row.de>2.0) redFlags.push({label:`D/E ${row.de.toFixed(2)}× — high leverage`,severity:'HIGH',source:'Fisher'});
    if (row.de<=0.1) strengths.push(`D/E ${row.de.toFixed(2)}× — debt-free`);
  }
  if (row.netDebtEbitda!==undefined) {
    const s = row.netDebtEbitda<0?95:row.netDebtEbitda<0.5?88:row.netDebtEbitda<1.5?72:row.netDebtEbitda<3?45:20;
    finS+=s; finC++;
    if (row.netDebtEbitda>3.0) redFlags.push({label:`ND/EBITDA ${row.netDebtEbitda.toFixed(1)}× — Fisher FAIL`,severity:'CRITICAL',source:'Fisher'});
    else if (row.netDebtEbitda>1.5) redFlags.push({label:`ND/EBITDA ${row.netDebtEbitda.toFixed(1)}× — above Fisher threshold`,severity:'HIGH',source:'Fisher'});
    if (row.netDebtEbitda<0) strengths.push(`Net cash company`);
  }
  if (row.pledge!==undefined) {
    finS+=sv(row.pledge,[2,10,25],false); finC++;
    if (row.pledge>50) redFlags.push({label:`Pledge ${row.pledge.toFixed(0)}% — CRITICAL`,severity:'CRITICAL',source:'Fisher'});
    else if (row.pledge>25) redFlags.push({label:`Pledge ${row.pledge.toFixed(0)}% — risky`,severity:'HIGH',source:'Fisher'});
    if (row.pledge<1) strengths.push(`Zero pledge`);
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
    if (row.icr<1.5) redFlags.push({label:`ICR ${row.icr.toFixed(1)}× — dangerously low`,severity:'CRITICAL',source:'Fisher'});
  }

  // ── VALUATION — (PEG + PE-percentile + MoS) / 3 ──────────────────────────
  // FIX #6: Relax valuation strictness for high-growth companies.
  // All true multibaggers look "expensive" at entry. PEG penalty removed if rev growth >25%.
  const isHighGrowth = (row.revCagr ?? 0) > 25 || (row.yoySalesGrowth ?? 0) > 25;
  const valComponents: number[] = [];

  if (row.pe!==undefined) {
    const peScore = sv(row.pe, b.pe, false);
    valComponents.push(peScore);
    // FIX #6: Only flag extreme PE if NOT in high-growth acceleration
    if (row.pe > 120 && !isHighGrowth) redFlags.push({label:`P/E ${row.pe.toFixed(0)}× — extreme, not justified by growth`,severity:'MEDIUM',source:'Fisher'});
    if (row.pe > 120 && isHighGrowth) risks.push(`P/E ${row.pe.toFixed(0)}× — high but growth justifies it (growth >25%)`); // note, not a flag
    if (peScore < 35) risks.push(`P/E ${row.pe.toFixed(1)}x — expensive vs sector`);
  }
  // PEG: skipped entirely for cyclical sectors — earnings at cycle peak inflate denominator
  if (row.peg!==undefined && row.peg>0 && !cyclical) {
    const pegScore = row.peg<0.8?92:row.peg<1.0?84:row.peg<1.5?74:row.peg<2.0?58:row.peg<2.5?42:22;
    valComponents.push(pegScore);
    if (row.peg<0.8) strengths.push(`PEG ${row.peg.toFixed(2)} — undervalued growth`);
    if (row.peg>2.5 && !isHighGrowth) risks.push(`PEG ${row.peg.toFixed(2)} — expensive for growth rate`);
    if (row.peg>2.5 && isHighGrowth)  risks.push(`PEG ${row.peg.toFixed(2)} — high but growth >25% may justify`);
  } else if (cyclical && row.peg!==undefined) {
    risks.push(`PEG ${row.peg.toFixed(2)} excluded — cyclical earnings unreliable for growth-adjusted valuation`);
  }
  if (row.marginOfSafety!==undefined) {
    const mosScore = row.marginOfSafety>30?92:row.marginOfSafety>15?80:row.marginOfSafety>0?66:row.marginOfSafety>-15?48:row.marginOfSafety>-30?34:18;
    valComponents.push(mosScore);
    if (row.marginOfSafety>20) strengths.push(`${row.marginOfSafety.toFixed(0)}% below intrinsic value — margin of safety`);
    if (row.marginOfSafety<-30) risks.push(`Price ${Math.abs(row.marginOfSafety).toFixed(0)}% above intrinsic value`);
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

  // ── PILLAR AVERAGES ───────────────────────────────────────────────────────
  const qual  = qualC>0?qualS/qualC:50;
  const growth= growC>0?growS/growC:50;
  const accel = accelS; // already a single score
  const longe = longC>0?longS/longC:50;
  const fin   = finC>0?finS/finC:50;
  const val   = valComponents.length>0?valS:50;
  const mkt   = mktS;

  const filledFields=[row.roce,row.roe,row.opm,row.cfoToPat,row.promoter,row.de,
    row.netDebtEbitda,row.revCagr,row.profitCagr,row.yoySalesGrowth,row.yoyProfitGrowth,
    row.pe,row.peg,row.marketCapCr,row.marginOfSafety,row.fiiPlusDii,row.fcfAbsolute].filter(v=>v!==undefined).length;
  const coverage=Math.min(100,Math.round((filledFields/17)*100));
  const coverageRatio=coverage/100;

  // ── FIX #10: TRAJECTORY SCORE — change direction, not just level ───────────
  // "100-baggers are CHANGING companies, not just good companies"
  // Trajectory = (recent - historical) for sales + profit — purely about direction
  const salesTrajectory  = (row.yoySalesGrowth  ?? 0) - (row.revCagr    ?? 0);
  const profitTrajectory = (row.yoyProfitGrowth ?? 0) - (row.profitCagr ?? 0);
  const trajectoryScore  = salesTrajectory + profitTrajectory; // combined pp above historical
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
    hardPenalty += 15;
    risks.push(`Hard −15: Profit deceleration ${row.profitAcceleration?.toFixed(0)}pp — severe collapse`);
  }
  if (row.opm !== undefined && row.opm < b.opm[0]) {
    hardPenalty += 5;
    risks.push(`Hard −5: OPM ${row.opm.toFixed(1)}% below sector p25 (${b.opm[0]}%)`);
  }
  if (row.recentOpLev !== undefined && row.yoySalesGrowth !== undefined && row.yoySalesGrowth > 15) {
    if (row.recentOpLev < 1.0) { hardPenalty += 10; risks.push(`Hard −10: Op leverage ${row.recentOpLev.toFixed(2)}x < 1.0 — costs growing faster than revenue`); }
    else if (row.recentOpLev < 1.5) { hardPenalty += 5; risks.push(`Hard −5: Op leverage ${row.recentOpLev.toFixed(2)}x weak despite ${row.yoySalesGrowth.toFixed(0)}% growth`); }
  }

  // ── CAPITAL ALLOCATION QUALITY ───────────────────────────────────────────────
  // Aurum Proptech pattern: strong growth but destroying capital via debt + negative FCF.
  // "Many high-growth stories destroy capital" — Fisher 100-Bagger Ch.4
  if ((row.fcfAbsolute ?? 0) < 0 && (row.de ?? 0) > 0.7) {
    hardPenalty += 8;
    risks.push(`Capital trap −8: negative FCF + D/E ${row.de?.toFixed(2)}x — borrowing to fund losses`);
  }
  if ((row.roce ?? 99) < 12 && (row.de ?? 0) > 0.5) {
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

  // ── CYCLICAL SECTOR PENALTY ──────────────────────────────────────────────────
  // PEG/PE unreliable at earnings peaks in cyclicals. Earnings will mean-revert.
  // For cyclicals: PEG benefit is removed in valuation section (see below),
  // plus a direct hard penalty for cycle risk.
  if (cyclical) {
    hardPenalty += 4;
    risks.push(`Cyclical risk −4: sector (${row.sector}) = mean-reverting margins, PEG/PE unreliable`);
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

  const isHardFail = hasCrit || highCnt>=2 || (row.accelSignal==='DECELERATING'&&highCnt>=1) || (row.de??0)>2.5 || (row.pledge??0)>40;
  const isCoreCompounder = !isHardFail && (row.roce??0)>=18 && (row.cfoToPat??0)>=0.8 && (row.de??999)<=0.5 && (row.revCagr??0)>=15 && (row.promoter??0)>=40 && highCnt===0;
  const isEmergingMultibagger = !isHardFail && !isCoreCompounder && (row.accelSignal==='ACCELERATING'||(row.yoySalesGrowth??0)>=25) && (row.recentOpLev??0)>=1.0 && (row.marketCapCr??99999)<=10000 && highCnt<=1;
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
  if ((row.fiiPlusDii??100)<5)       reratingBonus+=8;  // essentially zero institutional
  else if ((row.fiiPlusDii??100)<12) reratingBonus+=5;  // very early institutional
  else if ((row.fiiPlusDii??100)<22) reratingBonus+=2;  // early discovery

  // Promoter buying is pure insider conviction signal (not in any pillar)
  if ((row.changeInPromoter??0) > 2 && (row.promoter??0) >= 40)  reratingBonus+=4;

  // FCF triple-quality (FCF positive + CFO/PAT > 1 + low debt) — extreme quality combo
  if ((row.fcfAbsolute??-1)>0 && (row.cfoToPat??0)>1.0 && (row.de??99)<0.3) reratingBonus+=3;

  // Crowding penalty — alpha already realised by institutions
  if ((row.fiiPlusDii??0)>55)        reratingBonus-=8;  // >55% = crowded
  else if ((row.fiiPlusDii??0)>42)   reratingBonus-=4;  // getting crowded

  // Capital trap compound (FCF negative + meaningful debt)
  if ((row.fcfAbsolute??1)<0 && (row.de??0)>0.7)        reratingBonus-=6;

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

  // Delta signal: promoter buying from high base = strongest insider signal
  if ((row.changeInPromoter??0) > 2 && ownershipCategory === 'FOUNDER_CONTROLLED') {
    reratingBonus += 3; // founder buying more when already >50% = very high conviction
    strengths.push(`Insider accumulation: promoter bought +${row.changeInPromoter?.toFixed(1)}% from strong base`);
  } else if ((row.changeInPromoter??0) < -3 && (row.promoter??0) > 40) {
    reratingBonus -= 4; // significant promoter selling = watch closely
    risks.push(`Insider selling: promoter sold ${Math.abs(row.changeInPromoter??0).toFixed(1)}% — exit signal if trend continues`);
  }

  reratingBonus = Math.max(-18, Math.min(18, reratingBonus));

  // ── FINAL SCORE ───────────────────────────────────────────────────────────
  const rawAfterPenalty = Math.max(0, raw - hardPenalty);
  const penalized = rawAfterPenalty * (0.5 + coverageRatio * 0.5);
  const redFlagPenalty = (hasCrit?25:0) + (highCnt*12) + (medCnt*5);

  // Block trigger bonuses entirely when in deceleration phase.
  // Op leverage 3.7x on a decelerating stock is a LAGGING signal, not a forward one.
  const isDecelerating = (rawRevDecel !== undefined && rawRevDecel < -5) || row.accelSignal === 'DECELERATING';
  const effectiveTriggerBonus = isDecelerating ? 0 : triggerBonus;

  // Total bonus includes: rerating + trajectory + trigger signals
  const totalBonus = reratingBonus + trajectoryBonus + effectiveTriggerBonus;

  let score = Math.round((penalized - redFlagPenalty + totalBonus) / 5) * 5;

  // ── STANDARD RED FLAG CAPS ─────────────────────────────────────────────────
  if (hasCrit)            score = Math.min(score, 38);
  else if (highCnt >= 2)  score = Math.min(score, 48);
  else if (highCnt >= 1)  score = Math.min(score, 60);
  if (row.accelSignal === 'DECELERATING') score = Math.min(score, 52);
  if (bucket === 'MONITOR') score = Math.min(score, 45);

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
  if (rawProfDecel !== undefined && rawProfDecel < -25) {
    score = Math.min(score, 50);
    risks.push(`Decay filter: profit decel ${rawProfDecel.toFixed(0)}pp below CAGR → capped at 50`);
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
    valuation: { pass:((row.peg??99)<1.5&&(row.peg??0)>0)||((row.marginOfSafety??-99)>0), label:'Value', detail:row.peg?`PEG ${row.peg.toFixed(1)}`:row.marginOfSafety!==undefined?`MoS ${row.marginOfSafety.toFixed(0)}%`:'No data' },
    discovery: { pass:(row.fiiPlusDii??100)<25, label:'Discovery', detail:row.fiiPlusDii!==undefined?`FII+DII ${row.fiiPlusDii.toFixed(0)}%`:'No data' },
    technical: { pass:(row.aboveDMA200??-100)>=0&&(row.return1m??-100)>=-15, label:'Technical', detail:row.aboveDMA200!==undefined?`${row.aboveDMA200>=0?'+':''}${row.aboveDMA200.toFixed(0)}% vs DMA`:'No data' },
  };

  return {
    ...row, score, grade, bucket, ownershipCategory, decisionStrip, reratingBonus, trajectoryScore, triggerBonus, inflectionSignal, coverage, strengths, risks, redFlags,
    pillarScores: [
      {id:'QUALITY',    label:'Quality',      score:Math.round(qual),  color:'#a78bfa', weight:Math.round(bw[0]*100)},
      {id:'GROWTH',     label:'Growth',       score:Math.round(growth),color:'#38bdf8', weight:Math.round(bw[1]*100)},
      {id:'ACCEL',      label:'Accel',        score:Math.round(accel), color:'#10b981', weight:Math.round(bw[2]*100)},
      {id:'LONGEVITY',  label:'Longevity',    score:Math.round(longe), color:'#06b6d4', weight:Math.round(bw[3]*100)},
      {id:'FIN_STR',    label:'Fin Str',      score:Math.round(fin),   color:'#34d399', weight:Math.round(bw[4]*100)},
      {id:'VALUATION',  label:'Valuation',    score:Math.round(val),   color:'#f59e0b', weight:Math.round(bw[5]*100)},
      {id:'MARKET',     label:'Market',       score:Math.round(mkt),   color:'#f97316', weight:Math.round(bw[6]*100)},
    ],
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// COLUMN DETECTION — Screener.in + extra custom fields
// ═══════════════════════════════════════════════════════════════════════════════

function buildColMap(sampleRow: Record<string,unknown>): Record<string,string> {
  const m: Record<string,string> = {};
  for (const col of Object.keys(sampleRow)) {
    const c=col.trim().toLowerCase().replace(/[^a-z0-9%]/g,'');
    const o=col.trim();
    // Screener.in exact names
    if (o==='NSE Code'||o==='NSE code')                            m['symbol']=col;
    else if (o==='Name')                                           m['company']=col;
    else if (o==='Industry')          {if(!m['sector'])            m['sector']=col;}
    else if (o==='Industry Group')    {if(!m['sector'])            m['sector']=col;}
    else if (o==='Return on capital employed')                     m['roce']=col;
    else if (o==='Return on equity')                               m['roe']=col;
    else if (o==='Return on invested capital'){if(!m['roe'])       m['roe']=col;}
    else if (o==='OPM')                                            m['opm']=col;
    else if (o==='CFO to PAT')                                     m['cfoToPat']=col;
    else if (o==='Debt to equity')                                 m['de']=col;
    else if (o==='Sales growth')                                   m['revCagr']=col;
    else if (o==='Sales growth 3Years'||o==='Sales growth 3 Years')m['salesGrowth3y']=col;
    else if (o==='Profit growth')                                  m['profitCagr']=col;
    else if (o==='YOY Quarterly sales growth')                     m['yoySalesGrowth']=col;
    else if (o==='YOY Quarterly profit growth')                    m['yoyProfitGrowth']=col;
    else if (o==='Promoter holding')                               m['promoter']=col;
    else if (o==='Change in promoter holding')                     m['changeInPromoter']=col;
    else if (o==='Price to Earning')                               m['pe']=col;
    else if (o==='PEG Ratio')                                      m['peg']=col;
    else if (o==='Market Capitalization')                          m['marketCapCr']=col;
    else if (o==='Intrinsic Value')                                m['intrinsicValue']=col;
    else if (o==='Current Price')                                  m['price']=col;
    else if (o==='DMA 200')                                        m['dma200']=col;
    else if (o==='Return over 1month')                             m['return1m']=col;
    else if (o==='Return over 1week')                              m['return1w']=col;
    // New fields users may add
    else if (o==='FII Holding'||o==='FII holding')                 m['fii']=col;
    else if (o==='DII Holding'||o==='DII holding')                 m['dii']=col;
    else if (o==='Free Cash Flow'||o==='FCF')                      m['fcfAbsolute']=col;
    else if (o==='EBITDA')                                         m['ebitda']=col;
    else if (o==='Net Debt'||o==='Net debt')                       m['netDebt']=col;
    else if (o==='EPS'||o==='EPS (TTM)')                           m['eps']=col;
    else if (o==='EPS growth'||o==='EPS Growth')                   m['epsGrowth']=col;
    // Generic fallbacks
    else if (!m['symbol']&&(c.includes('nsecode')||c.includes('symbol')||c.includes('ticker'))) m['symbol']=col;
    else if (!m['company']&&c.includes('name')&&!c.includes('sector')) m['company']=col;
    else if (!m['sector']&&(c.includes('sector')||c.includes('industry'))) m['sector']=col;
    else if (!m['roce']&&(c==='roce'||c.includes('returnoncap'))) m['roce']=col;
    else if (!m['roe']&&(c==='roe'||c.includes('returnonequit'))) m['roe']=col;
    else if (!m['opm']&&(c==='opm'||c.includes('operatingmargin'))) m['opm']=col;
    else if (!m['cfoToPat']&&(c.includes('cfotopat')||c.includes('cashflowpat'))) m['cfoToPat']=col;
    else if (!m['de']&&(c.includes('debttoequit')||c==='de')) m['de']=col;
    else if (!m['revCagr']&&(c.includes('salescagr')||c.includes('salesgrowth'))) m['revCagr']=col;
    else if (!m['profitCagr']&&(c.includes('profitcagr')||c.includes('profitgrowth')||c.includes('patcagr'))) m['profitCagr']=col;
    else if (!m['promoter']&&c.includes('promoter')&&!c.includes('pledge')&&!c.includes('change')) m['promoter']=col;
    else if (!m['changeInPromoter']&&c.includes('promoter')&&c.includes('change')) m['changeInPromoter']=col;
    else if (!m['pledge']&&c.includes('pledge')) m['pledge']=col;
    else if (!m['icr']&&(c.includes('icr')||c.includes('interestcoverage'))) m['icr']=col;
    else if (!m['pe']&&(c==='pe'||c.includes('priceearning'))) m['pe']=col;
    else if (!m['peg']&&c.includes('peg')) m['peg']=col;
    else if (!m['pb']&&(c==='pb'||c.includes('pricebook'))) m['pb']=col;
    else if (!m['marketCapCr']&&c.includes('marketcap')) m['marketCapCr']=col;
    else if (!m['intrinsicValue']&&(c.includes('intrinsic')||c.includes('fairvalue'))) m['intrinsicValue']=col;
    else if (!m['price']&&c.includes('currentprice')) m['price']=col;
    else if (!m['dma200']&&(c.includes('dma200')||c.includes('200dma'))) m['dma200']=col;
    else if (!m['fii']&&c.includes('fii')&&!c.includes('change')) m['fii']=col;
    else if (!m['dii']&&c.includes('dii')&&!c.includes('change')) m['dii']=col;
    else if (!m['fcfAbsolute']&&(c.includes('freecash')||c==='fcf')) m['fcfAbsolute']=col;
    else if (!m['ebitda']&&c==='ebitda') m['ebitda']=col;
    else if (!m['netDebt']&&(c.includes('netdebt')||c.includes('borrowing'))) m['netDebt']=col;
    else if (!m['epsGrowth']&&c.includes('epsgrowth')) m['epsGrowth']=col;
    else if (!m['eps']&&(c==='eps'||c.includes('earningspershare'))) m['eps']=col;
    else if (!m['return1m']&&(c.includes('1month')||c.includes('1mreturn'))) m['return1m']=col;
  }
  return m;
}

function rawRowToExcelRow(row: Record<string,unknown>, m: Record<string,string>): ExcelRow|null {
  const n=(val: unknown): number|undefined => {
    if(val===''||val===null||val===undefined) return undefined;
    const v=parseFloat(String(val).replace(/[%,₹ ]/g,''));
    return isNaN(v)?undefined:v;
  };
  const sym=String(row[m['symbol']]??'').trim().toUpperCase();
  if(!sym) return null;
  const price=n(m['price']?row[m['price']]:undefined);
  const iv=n(m['intrinsicValue']?row[m['intrinsicValue']]:undefined);
  const dma=n(m['dma200']?row[m['dma200']]:undefined);
  const netDebt=n(m['netDebt']?row[m['netDebt']]:undefined);
  const ebitda=n(m['ebitda']?row[m['ebitda']]:undefined);
  const fii=n(m['fii']?row[m['fii']]:undefined);
  const dii=n(m['dii']?row[m['dii']]:undefined);
  return {
    symbol:sym,
    company:String(row[m['company']??'']??'').trim(),
    sector:String(row[m['sector']??'']??'INDUSTRIALS').trim()||'INDUSTRIALS',
    roce:n(m['roce']?row[m['roce']]:undefined),
    roe:n(m['roe']?row[m['roe']]:undefined),
    opm:n(m['opm']?row[m['opm']]:undefined),
    cfoToPat:n(m['cfoToPat']?row[m['cfoToPat']]:undefined),
    de:n(m['de']?row[m['de']]:undefined),
    pledge:n(m['pledge']?row[m['pledge']]:undefined),
    icr:n(m['icr']?row[m['icr']]:undefined),
    revCagr:n(m['revCagr']?row[m['revCagr']]:n(m['salesGrowth3y']?row[m['salesGrowth3y']]:undefined)),
    profitCagr:n(m['profitCagr']?row[m['profitCagr']]:undefined),
    yoySalesGrowth:n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined),
    yoyProfitGrowth:n(m['yoyProfitGrowth']?row[m['yoyProfitGrowth']]:undefined),
    epsGrowth:n(m['epsGrowth']?row[m['epsGrowth']]:undefined),
    eps:n(m['eps']?row[m['eps']]:undefined),
    promoter:n(m['promoter']?row[m['promoter']]:undefined),
    changeInPromoter:n(m['changeInPromoter']?row[m['changeInPromoter']]:undefined),
    pe:n(m['pe']?row[m['pe']]:undefined),
    pb:n(m['pb']?row[m['pb']]:undefined),
    peg:n(m['peg']?row[m['peg']]:undefined),
    marketCapCr:n(m['marketCapCr']?row[m['marketCapCr']]:undefined),
    intrinsicValue:iv,
    price,
    dma200:dma,
    fii,
    dii,
    netDebt,
    ebitda,
    fcfAbsolute:n(m['fcfAbsolute']?row[m['fcfAbsolute']]:undefined),
    return1m:n(m['return1m']?row[m['return1m']]:undefined),
    return1w:n(m['return1w']?row[m['return1w']]:undefined),
    // Derived
    marginOfSafety:(iv!==undefined&&price!==undefined&&price>0)?Math.round((iv-price)/price*100):undefined,
    aboveDMA200:(dma!==undefined&&price!==undefined&&dma>0)?Math.round((price-dma)/dma*100):undefined,
    netDebtEbitda:(netDebt!==undefined&&ebitda!==undefined&&ebitda>0)?Math.round(netDebt/ebitda*10)/10:undefined,
    fiiPlusDii:(fii!==undefined&&dii!==undefined)?Math.round((fii+dii)*10)/10:fii!==undefined?fii:undefined,
    opLeverageRatio:(n(m['profitCagr']?row[m['profitCagr']]:undefined)!==undefined&&n(m['revCagr']?row[m['revCagr']]:undefined)!==undefined&&(n(m['revCagr']?row[m['revCagr']]:undefined) as number)>0)?(n(m['profitCagr']?row[m['profitCagr']]:undefined) as number)/(n(m['revCagr']?row[m['revCagr']]:undefined) as number):undefined,
    // ── ACCELERATION SIGNALS (Framework.docx Core Signal) ────────────────────
    // Compare latest quarter YOY vs historical CAGR to detect trend direction.
    // If recent (YOY) > historical (CAGR): business is ACCELERATING — key buy signal.
    // If recent < historical: DECELERATING — key rejection filter.
    get revenueAcceleration() {
      const yoy=n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined);
      const cagr=n(m['revCagr']?row[m['revCagr']]:undefined);
      return (yoy!==undefined&&cagr!==undefined)?Math.round(yoy-cagr):undefined;
    },
    get profitAcceleration() {
      const yoy=n(m['yoyProfitGrowth']?row[m['yoyProfitGrowth']]:undefined);
      const cagr=n(m['profitCagr']?row[m['profitCagr']]:undefined);
      return (yoy!==undefined&&cagr!==undefined)?Math.round(yoy-cagr):undefined;
    },
    get recentOpLev() {
      const yoyP=n(m['yoyProfitGrowth']?row[m['yoyProfitGrowth']]:undefined);
      const yoyS=n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined);
      return (yoyP!==undefined&&yoyS!==undefined&&yoyS>0)?Math.round(yoyP/yoyS*10)/10:undefined;
    },
    get accelSignal(): 'ACCELERATING'|'STABLE'|'DECELERATING'|undefined {
      const yoy=n(m['yoySalesGrowth']?row[m['yoySalesGrowth']]:undefined);
      const cagr=n(m['revCagr']?row[m['revCagr']]:undefined);
      if(yoy===undefined||cagr===undefined) return undefined;
      const delta=yoy-cagr;
      if(delta>=5) return 'ACCELERATING';
      if(delta<=-5) return 'DECELERATING';
      return 'STABLE';
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL COMPARE TAB — institutional scale UI
// ═══════════════════════════════════════════════════════════════════════════════

function ExcelCompare({ rows, setRows }: { rows: ExcelResult[]; setRows:(r:ExcelResult[])=>void }) {
  const [fileName, setFileName] = useState(() => {
    // Restore last session's file label from meta
    try {
      const meta = JSON.parse(localStorage.getItem(STORAGE_META) || '{}');
      if (meta.count && meta.savedAt) {
        const d = new Date(meta.savedAt);
        return `${meta.count} stocks · saved ${d.toLocaleString()}`;
      }
    } catch {}
    return '';
  });
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expRow, setExpRow] = useState<string|null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set(['ALL']));
  const [goodOnly, setGoodOnly] = useState(false);
  const [bucketFilter, setBucketFilter] = useState<Bucket|'ALL'>('ALL');
  const [accelOnly, setAccelOnly] = useState(false);
  const [fcfOnly, setFcfOnly] = useState(false);
  const [discoveryOnly, setDiscoveryOnly] = useState(false);
  const [inflectionOnly, setInflectionOnly] = useState(false);

  // ── GUIDANCE MODE ──────────────────────────────────────────────────────────
  // When ON: fetches recent earnings/guidance news, scores each company
  // by guidance quality (0.0-1.0), re-scores and re-sorts.
  // When OFF: no change to existing scores.
  const [guidanceMode, setGuidanceMode] = useState(false);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidanceScores, setGuidanceScores] = useState<Record<string, number>>({}); // symbol → 0.0-1.0
  const [guidanceArticleCounts, setGuidanceArticleCounts] = useState<Record<string, number>>({});

  const GUIDANCE_POSITIVE = ['raised guidance','guidance upgrade','raised outlook','beats estimates','above estimates','record quarter','record revenue','strong beat','raised earnings','margin expansion','strong growth','upgraded','rerating','guidance raised'];
  const GUIDANCE_NEGATIVE = ['cut guidance','lowered guidance','below estimates','disappointing','warning','cautious','revenue miss','profit miss','guidance cut','margin pressure','revised down','lowered outlook'];

  async function fetchGuidanceScores() {
    if (rows.length === 0) return;
    setGuidanceLoading(true);
    try {
      // For Indian small-caps, earnings coverage in news is sparse.
      // Strategy: fetch ALL recent articles broadly (not type-filtered),
      // try multiple matching approaches, then fall back to trajectory proxy.
      const fetches = await Promise.all([
        fetch('/api/v1/news?limit=500&importance_min=1&article_type=EARNINGS'),
        fetch('/api/v1/news?limit=300&importance_min=1&article_type=CORPORATE'),
        fetch('/api/v1/news?limit=200&importance_min=1&article_type=RATING_CHANGE'),
        fetch('/api/v1/news?limit=200&importance_min=2&article_type=GENERAL'),
        fetch('/api/v1/news?limit=100&importance_min=2&article_type=BOTTLENECK'),
      ]);
      const datas = await Promise.all(fetches.map(r => r.ok ? r.json().catch(()=>[]) : Promise.resolve([])));
      const all = (datas.flat() as NewsArticle[]);
      // Deduplicate by id
      const seen = new Set<string>();
      const articles = all.filter(a => {
        const id = a.id ?? (a.title ?? '') + (a.published_at ?? '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const scores: Record<string, number> = {};
      const counts: Record<string, number> = {};

      // Pre-process articles for fast matching
      const articleTexts = articles.map(a => ({
        a,
        full: ((a.title ?? '') + ' ' + (a.headline ?? '') + ' ' + (a.summary ?? '')).toLowerCase(),
        tickers: ((a.ticker_symbols ?? []) as string[]).map((t: string) =>
          t.toUpperCase().replace(/\.NS$|\.BO$|^NSE:|^BSE:/i, '')
        ),
      }));

      for (const stock of rows) {
        const sym = stock.symbol.toUpperCase().replace(/\.NS$|\.BO$/i, '');

        // Build company name search tokens — multiple strategies for Indian names
        const companyRaw = (stock.company || '').toLowerCase();
        // Remove noise words
        const cleanCompany = companyRaw
          .replace(/\b(ltd|limited|pvt|private|india|industries|solutions|tech|technologies|systems|services|enterprises|group|engineering|energy|power|chemicals|pharma|pharmaceuticals|finance|capital|holdings|infra|infrastructure)\b/gi, '')
          .replace(/[()]/g, '').trim();
        const companyWords = cleanCompany.split(/\s+/).filter(w => w.length >= 4).slice(0, 2);
        // Also try: first 6 chars of symbol as a text match (e.g. "SKIPPER" in article)
        const symShort = sym.toLowerCase().slice(0, 6);

        // Match strategies (OR logic - any match counts)
        const relevant = articleTexts.filter(({ full, tickers }) => {
          // 1. Ticker match (exact, stripping exchange suffixes)
          if (tickers.some(t => t === sym || t.includes(sym.slice(0,6)))) return true;
          // 2. Symbol text appears in article (e.g. "SKIPPER reported...")
          if (full.includes(sym.toLowerCase()) || (symShort.length >= 4 && full.includes(symShort))) return true;
          // 3. Company name keywords (ALL significant words must appear)
          if (companyWords.length >= 2 && companyWords.every(w => full.includes(w))) return true;
          if (companyWords.length === 1 && companyWords[0].length >= 6 && full.includes(companyWords[0])) return true;
          return false;
        }).map(({ a }) => a);

        counts[sym] = relevant.length;

        if (relevant.length > 0) {
          // Score from actual news articles
          let score = 0.5;
          for (const a of relevant.slice(0, 8)) {
            const text = ((a.title ?? '') + ' ' + (a.headline ?? '') + ' ' + (a.summary ?? '')).toLowerCase();
            const isPositive = GUIDANCE_POSITIVE.some(kw => text.includes(kw));
            const isNegative = GUIDANCE_NEGATIVE.some(kw => text.includes(kw));
            if (isPositive && !isNegative)      score = Math.min(1.0, score + 0.15);
            else if (isNegative && !isPositive) score = Math.max(0.0, score - 0.15);
            else if (isPositive && isNegative)  score = Math.min(0.75, score + 0.04);
          }
          scores[sym] = Math.round(score * 10) / 10;
        } else {
          // NO NEWS FOUND — use earnings trajectory as proxy signal.
          // For Indian small-caps with no press coverage, the latest quarterly numbers
          // ARE the guidance signal. Score is capped at 0.65 max (vs 1.0 for real news)
          // and bonus is halved vs news-based, to prevent double-counting.
          const trajectory = (stock.revenueAcceleration ?? 0) + (stock.profitAcceleration ?? 0);
          const accel = stock.accelSignal;
          if (accel === 'ACCELERATING' && trajectory > 60) {
            scores[sym] = 0.65; // very strong — both sales and profit beating history significantly
          } else if (accel === 'ACCELERATING' && trajectory > 30) {
            scores[sym] = 0.60; // solid acceleration
          } else if (accel === 'ACCELERATING' && trajectory > 10) {
            scores[sym] = 0.55; // mild positive signal
          } else if (accel === 'DECELERATING' && trajectory < -40) {
            scores[sym] = 0.25; // strong decel warning
          } else if (accel === 'DECELERATING') {
            scores[sym] = 0.38; // mild decel
          } else {
            scores[sym] = -1;   // STABLE or no clear signal — no adjustment
          }
          counts[sym] = 0; // mark as proxy (no actual articles)
        }
      }

      setGuidanceScores(scores);
      setGuidanceArticleCounts(counts);
    } catch (e) {
      console.error('Guidance fetch failed:', e);
    }
    setGuidanceLoading(false);
  }

  function guidanceBonus(sym: string): number {
    const g = guidanceScores[sym];
    if (g === undefined || g === -1) return 0; // no data = no adjustment
    if (g >= 0.85) return 14;  // multiple raises / strong guidance upgrade
    if (g >= 0.70) return 8;   // single raise or beat
    if (g >= 0.55) return 3;   // mildly positive
    if (g <= 0.15) return -14; // multiple cuts or misses
    if (g <= 0.30) return -8;  // guidance cut or miss
    if (g <= 0.45) return -3;  // mildly negative
    return 0; // neutral (0.5)
  }

  function applyGuidance(r: ExcelResult): ExcelResult & { guidanceScore?: number; guidanceAdj?: number } {
    if (!guidanceMode || Object.keys(guidanceScores).length === 0) return r;
    const gs = guidanceScores[r.symbol];
    // -1 = no data found, don't adjust score
    if (gs === -1) return { ...r, guidanceScore: -1, guidanceAdj: 0 };
    const adj = guidanceBonus(r.symbol);
    let newScore = Math.max(0, Math.min(100, r.score + adj));

    // Re-apply quality and valuation caps — guidance cannot bypass these hard limits.
    // A company with poor cash flow or overvalued vs intrinsic value should not
    // jump past its quality-capped ceiling even with great earnings news.
    const b2 = SBENCH[getSectorKey(r.sector)] ?? SBENCH.DEFAULT;
    const hasQualWeakness = (r.cfoToPat !== undefined && r.cfoToPat < 0.6) ||
                            (r.opm !== undefined && r.opm < b2.opm[0]) ||
                            (r.roce !== undefined && r.roce < 15);
    if (hasQualWeakness)                              newScore = Math.min(newScore, 85);
    if ((r.cfoToPat ?? 1) < 0.5)                     newScore = Math.min(newScore, 80);
    if ((r.marginOfSafety ?? 0) < -50)               newScore = Math.min(newScore, 80);
    else if ((r.marginOfSafety ?? 0) < -30)          newScore = Math.min(newScore, 90);
    // Re-apply A+ gate — guidance articles cannot grant A+ if quality gates fail
    if (newScore >= 90) {
      const passGate = (r.cfoToPat ?? 0) > 1.0 && (r.roce ?? 0) > 20 &&
                       (r.fcfAbsolute ?? -1) > 0 && (r.promoter ?? 0) > 50;
      if (!passGate) newScore = Math.min(newScore, 89);
    }

    let newGrade: Grade = newScore>=90?'A+':newScore>=80?'A':newScore>=68?'B+':newScore>=55?'B':newScore>=42?'C':'D';

    // ── GUIDANCE TIER PROMOTION ───────────────────────────────────────────────
    // Guidance upgrades can move stocks 10–30% in weeks (market behavior).
    // Binary trigger: if guidance strongly positive AND stock is accelerating →
    // promote one full grade tier. This is the "forward visibility" premium.
    const guidanceScore = guidanceScores[r.symbol];
    const GRADE_UP_MAP: Record<Grade, Grade> = {'D':'C','C':'B','B':'B+','B+':'A','A':'A+','A+':'A+','NR':'NR'};
    const GRADE_DOWN_MAP: Record<Grade, Grade> = {'A+':'A','A':'B+','B+':'B','B':'C','C':'D','D':'D','NR':'NR'};

    if (guidanceScore !== undefined && guidanceScore !== -1) {
      if (guidanceScore >= 0.7 && r.accelSignal === 'ACCELERATING') {
        newGrade = GRADE_UP_MAP[newGrade] as Grade;
      } else if (guidanceScore <= 0.3 && r.accelSignal === 'DECELERATING') {
        newGrade = GRADE_DOWN_MAP[newGrade] as Grade;
      }
    }
    // Consistency gate: guidance promotion cannot create A+ if stock has flags
    const hasCritForG = r.redFlags.some(f => f.severity === 'CRITICAL');
    const highCntForG = r.redFlags.filter(f => f.severity === 'HIGH').length;
    if (hasCritForG && (newGrade === 'A+' || newGrade === 'A')) newGrade = 'B+';
    if (highCntForG >= 2 && newGrade === 'A+') newGrade = 'A';

    return { ...r, score: newScore, grade: newGrade, guidanceScore: guidanceScores[r.symbol], guidanceAdj: adj };
  }

  const fileRef = useRef<HTMLInputElement>(null);

  async function parseSingleFile(file:File, XLSX: typeof import('xlsx')) {
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    return XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
  }

  async function handleFiles(files:FileList|File[]) {
    const arr=Array.from(files);
    setLoading(true); setParseError('');
    try {
      const XLSX=await import('xlsx');
      // Start with existing rows — new uploads MERGE in, never replace
      const existingSymbols = new Set(rows.map(r => r.symbol));
      const newRows: ExcelRow[] = [];
      const seenNew = new Set<string>();

      for (const file of arr) {
        const raw=await parseSingleFile(file,XLSX);
        if(!raw.length) continue;
        const cm=buildColMap(raw[0] as Record<string,unknown>);
        if(!cm['symbol']) continue;
        for (const r of raw) {
          const row=rawRowToExcelRow(r as Record<string,unknown>,cm);
          if(!row||existingSymbols.has(row.symbol)||seenNew.has(row.symbol)) continue;
          seenNew.add(row.symbol);
          newRows.push(row);
        }
      }

      if(!newRows.length && rows.length > 0) {
        setParseError(`All stocks in these files already exist in the current dataset (${rows.length} stocks). No new entries added.`);
        setLoading(false); return;
      }
      if(!newRows.length) {
        setParseError('No valid rows found. Ensure files have NSE Code column.');
        setLoading(false); return;
      }

      // Score new rows and merge with existing
      const newScored = newRows.map(r => scoreExcelRow(r));
      // Sort by score, then apply forced ranking to compress grades institutionally
      const merged = [...rows, ...newScored].sort((a,b) => b.score - a.score);
      const allScored = applyForcedRanking(merged);
      setRows(allScored);

      const addedCount = newRows.length;
      const totalCount = allScored.length;
      setFileName(rows.length > 0
        ? `+${addedCount} new stocks added · ${totalCount} total`
        : `${arr.length} file${arr.length>1?'s':''} · ${totalCount} stocks`
      );
    } catch(e:unknown){setParseError(`Error: ${e instanceof Error?e.message:String(e)}`);}
    setLoading(false);
  }

  const GRADES:Grade[]=['A+','A','B+','B','C','D'];
  // "Good companies only" = passes all hard survival criteria
  const goodCompanies = rows.filter(r =>
    r.decisionStrip.survival.pass &&
    r.accelSignal !== 'DECELERATING' &&
    r.bucket !== 'MONITOR' &&
    r.score >= 60
  );

  // Apply all active filters in order
  let baseRows = goodOnly ? goodCompanies : rows;
  if (bucketFilter !== 'ALL') baseRows = baseRows.filter(r => r.bucket === bucketFilter);
  if (accelOnly)      baseRows = baseRows.filter(r => r.decisionStrip.acceleration.pass);
  if (fcfOnly)        baseRows = baseRows.filter(r => (r.fcfAbsolute ?? -1) > 0 || (r.cfoToPat ?? 0) >= 0.8);
  if (discoveryOnly)   baseRows = baseRows.filter(r => (r.fiiPlusDii ?? 100) < 15);
  if (inflectionOnly)  baseRows = baseRows.filter(r => r.inflectionSignal || r.triggerBonus >= 10);
  const baseFiltered = gradeFilter.has('ALL') ? baseRows : baseRows.filter(r => gradeFilter.has(r.grade));
  // Apply guidance re-scoring and re-sort when guidance mode is active
  const filtered = guidanceMode && Object.keys(guidanceScores).length > 0
    ? [...baseFiltered.map(r => applyGuidance(r))].sort((a, b) => b.score - a.score)
    : baseFiltered;
  const topPicks = rows.filter(r => ['A+','A','B+'].includes(r.grade) && r.bucket !== 'MONITOR');

  const METRICS: [keyof ExcelRow, string, string][] = [
    ['roce','ROCE %','Quality'],['roe','ROE %','Quality'],['opm','OPM %','Quality'],
    ['cfoToPat','CFO/PAT x','Quality'],['fcfAbsolute','FCF ₹Cr','Quality'],
    ['revCagr','Sales CAGR %','Growth'],['profitCagr','Profit CAGR %','Growth'],
    ['opLeverageRatio','Op Leverage x','Growth'],
    ['yoySalesGrowth','YOY Sales %','Growth'],['yoyProfitGrowth','YOY Profit %','Growth'],
    ['revenueAcceleration','Rev Accel pp','Recent'],['profitAcceleration','Profit Accel pp','Recent'],
    ['recentOpLev','Recent Op Lev x','Recent'],
    ['epsGrowth','EPS Growth %','Growth'],
    ['de','D/E x','Fin Str'],['netDebtEbitda','ND/EBITDA x','Fin Str'],
    ['promoter','Promoter %','Fin Str'],['pledge','Pledge %','Fin Str'],
    ['changeInPromoter','Δ Promoter %','Fin Str'],['icr','ICR x','Fin Str'],
    ['pe','P/E x','Valuation'],['peg','PEG','Valuation'],['pb','P/B x','Valuation'],
    ['marketCapCr','MCap ₹Cr','Valuation'],['marginOfSafety','MoS %','Valuation'],
    ['fiiPlusDii','FII+DII %','SQGLP-S'],['fii','FII %','SQGLP-S'],['dii','DII %','SQGLP-S'],
    ['aboveDMA200','vs DMA200 %','Market'],['return1m','Ret 1M %','Market'],
  ];

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px'}}>
      {/* Header info */}
      <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
        <div style={{fontSize:F.lg,fontWeight:800,color:PURPLE,marginBottom:8}}>
          📊 Upload Screener.in exports — SQGLP + Fisher + Framework scoring
        </div>
        <div style={{fontSize:F.md,color:MUTED,lineHeight:1.8,marginBottom:12}}>
          Export any Screener.in screen as CSV and upload here. All fields auto-detected. Multiple files merged.
          New uploads <strong style={{color:GREEN}}>add to existing data</strong> — never replace. Only <strong style={{color:RED}}>Clear All Data</strong> removes it.
          {rows.length > 0 && <span style={{color:GREEN}}> ✅ {rows.length} stocks currently loaded.</span>}
          <span style={{color:YELLOW}}> Add these extra columns</span> to unlock full scoring:
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
          {[
            {field:'Free Cash Flow',why:'Fisher FCF filter'},
            {field:'Net Debt',why:'Fisher survival: ND/EBITDA < 1.5'},
            {field:'EBITDA',why:'ND/EBITDA calculation'},
            {field:'FII Holding',why:'MOSL SQGLP "S" undiscovered'},
            {field:'DII Holding',why:'Institutional coverage check'},
            {field:'Change in promoter holding',why:'Insider trend signal'},
            {field:'EPS growth',why:'Fisher Twin Engine check'},
          ].map(({field,why})=>(
            <div key={field} style={{padding:'8px 12px',backgroundColor:CARD2,borderRadius:6,border:`1px solid ${BORDER}`}}>
              <div style={{fontSize:F.sm,fontWeight:700,color:ACCENT}}>{field}</div>
              <div style={{fontSize:F.xs,color:MUTED}}>{why}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload zone */}
      <div
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}
        style={{marginBottom:20,padding:'32px 24px',border:`2px dashed ${PURPLE}40`,borderRadius:14,textAlign:'center',cursor:'pointer',backgroundColor:`${PURPLE}05`}}
      >
        <div style={{fontSize:40,marginBottom:10}}>{loading?'⏳':'📁'}</div>
        <div style={{fontSize:F.xl,fontWeight:700,color:PURPLE}}>
          {loading?'Scoring...'  :fileName?`✅ ${fileName}`:'Click or drag & drop — multiple files OK'}
        </div>
        <div style={{fontSize:F.md,color:MUTED,marginTop:6}}>
          .xlsx · .csv · Screener.in format · all columns auto-detected · duplicates merged
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" multiple style={{display:'none'}}
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}} />
      </div>

      {parseError&&<div style={{marginBottom:14,padding:'12px 16px',backgroundColor:`${RED}10`,border:`1px solid ${RED}30`,borderRadius:10,fontSize:F.md,color:RED}}>{parseError}</div>}

      {/* ── GUIDANCE BUTTON — always visible, prominent ─────────────────────────
          Fetches recent earnings/guidance news and re-scores all loaded stocks.
          Shows disabled state when no data is loaded yet. */}
      <div style={{marginBottom:20,display:'flex',alignItems:'center',gap:14,padding:'16px 20px',backgroundColor:CARD_BG,border:`2px solid ${guidanceMode?'#F59E0B':'#F59E0B40'}`,borderRadius:12,flexWrap:'wrap'}}>
        <button
          onClick={() => {
            if (rows.length === 0) return;
            if (guidanceMode) {
              setGuidanceMode(false);
              setGuidanceScores({});
            } else {
              setGuidanceMode(true);
              fetchGuidanceScores();
            }
          }}
          style={{
            padding:'14px 28px', borderRadius:10,
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            border:`2px solid ${guidanceMode?'#F59E0B':'#F59E0B60'}`,
            background: guidanceMode ? '#F59E0B30' : '#F59E0B10',
            color: rows.length === 0 ? '#F59E0B50' : '#F59E0B',
            display:'flex', alignItems:'center', gap:10,
            opacity: rows.length === 0 ? 0.5 : 1,
            transition:'all 0.15s',
          }}
        >
          <span style={{fontSize:26}}>{guidanceLoading ? '⏳' : '📡'}</span>
          <div>
            <div style={{fontSize:F.lg,fontWeight:900,letterSpacing:'-0.3px'}}>
              {guidanceLoading ? 'Fetching guidance…' : guidanceMode ? 'Guidance: ON' : 'Guidance'}
            </div>
            <div style={{fontSize:F.xs,fontWeight:400,marginTop:2,color:'#F59E0B99'}}>
              {rows.length === 0 ? 'Upload data first, then click to score with guidance' :
               guidanceMode ? `${Object.keys(guidanceScores).length} stocks re-scored · click again to reset` :
               `Re-score ${rows.length} stocks using live earnings & guidance news`}
            </div>
          </div>
          {guidanceMode && <span style={{fontSize:F.sm,fontWeight:700,color:'#F59E0B',marginLeft:8}}>✓ ACTIVE</span>}
        </button>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:F.sm,color:MUTED,lineHeight:1.6}}>
            Fetches latest earnings results + guidance upgrades/cuts from live news feed.
            Re-ranks all stocks: <span style={{color:GREEN}}>raised guidance = +14 pts</span> · <span style={{color:RED}}>cut guidance = −14 pts</span> · shows guidance score (0.0–1.0) per stock.
          </div>
        </div>
        {guidanceMode && !guidanceLoading && Object.keys(guidanceScores).length > 0 && (
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            {[
              {label:'Strong ▲',  count:Object.values(guidanceScores).filter(v=>v>=0.7).length,           color:GREEN},
              {label:'Positive',  count:Object.values(guidanceScores).filter(v=>v>=0.55&&v<0.7).length,   color:'#34d399'},
              {label:'Neutral',   count:Object.values(guidanceScores).filter(v=>v>0.45&&v<0.55).length,   color:MUTED},
              {label:'Negative',  count:Object.values(guidanceScores).filter(v=>v>0.3&&v<=0.45).length,   color:ORANGE},
              {label:'Weak ▼',   count:Object.values(guidanceScores).filter(v=>v>=0&&v<=0.3).length,      color:RED},
              {label:'No data',  count:Object.values(guidanceScores).filter(v=>v===-1).length,             color:MUTED},
            ].map(({label,count,color})=>(
              <div key={label} style={{padding:'6px 10px',backgroundColor:`${color}14`,border:`1px solid ${color}30`,borderRadius:7,textAlign:'center',minWidth:60}}>
                <div style={{fontSize:F.md,fontWeight:800,color}}>{count}</div>
                <div style={{fontSize:F.xs,color:MUTED}}>{label}</div>
              </div>
            ))}
            {/* Legend */}
            <div style={{fontSize:F.xs,color:MUTED,marginLeft:8,lineHeight:1.5}}>
              <span style={{color:GREEN}}>News-based</span> = from earnings articles ·&nbsp;
              <span style={{color:ACCENT}}>📊 proxy</span> = trajectory signal (no news coverage) ·&nbsp;
              <span style={{color:MUTED}}>— no data</span> = no signal available
            </div>
          </div>
        )}
      </div>

      {rows.length>0&&(
        <>
          {/* Summary + GUIDANCE button on same row */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap',alignItems:'stretch'}}>
            {[
              {label:'Scored',value:rows.length,color:PURPLE},
              {label:'Top Picks (B+)',value:topPicks.length,color:GREEN},
              {label:'Best Score',value:rows[0]?.score??0,color:rows[0]?.score>=72?GREEN:YELLOW},
              {label:'Avg Score',value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length),color:MUTED},
            ].map(({label,value,color})=>(
              <div key={label} style={{padding:'14px 22px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,textAlign:'center'}}>
                <div style={{fontSize:F.h1,fontWeight:900,color}}>{value}</div>
                <div style={{fontSize:F.sm,color:MUTED,marginTop:2}}>{label}</div>
              </div>
            ))}

            <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto',flexWrap:'wrap'}}>
              {/* Good Companies Only */}
              <button onClick={()=>setGoodOnly(v=>!v)} style={{fontSize:F.sm,fontWeight:800,padding:'8px 16px',borderRadius:8,border:`2px solid ${goodOnly?GREEN+'80':BORDER}`,background:goodOnly?`${GREEN}18`:'transparent',color:goodOnly?GREEN:MUTED,cursor:'pointer'}}>
                {goodOnly?`✅ Good Only (${goodCompanies.length})`:`🔍 Good Only`}
              </button>
              <div style={{width:1,background:BORDER,height:24}}/>
              {/* Grade filter */}
              {(['ALL',...GRADES] as const).map(g=>{
                const active = gradeFilter.has(g);
                const col = GRADE_COLOR[g as Grade] || PURPLE;
                return (
                <button key={g} onClick={()=>{
                  if (g === 'ALL') { setGradeFilter(new Set(['ALL'])); return; }
                  setGradeFilter(prev => {
                    const next = new Set(prev);
                    next.delete('ALL'); // clear ALL when selecting specific grades
                    if (next.has(g)) { next.delete(g); if (next.size === 0) next.add('ALL'); }
                    else next.add(g);
                    return next;
                  });
                }} style={{fontSize:F.sm,fontWeight:700,padding:'7px 12px',borderRadius:8,border:`1px solid ${active?col+'60':BORDER}`,background:active?col+'18':'transparent',color:active?col:MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>
                );})}
            </div>
          </div>
          {/* Bucket + quick filters row */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>BUCKET:</span>
            {(['ALL','CORE_COMPOUNDER','EMERGING_MULTIBAGGER','HIGH_RISK','MONITOR'] as const).map(b=>{
              const cfg = b==='ALL' ? {label:'All',color:MUTED,icon:'',count:rows.length} :
                {...BUCKET_CONFIG[b], count:rows.filter(r=>r.bucket===b).length};
              return (
                <button key={b} onClick={()=>setBucketFilter(b)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${bucketFilter===b?cfg.color+'60':BORDER}`,background:bucketFilter===b?cfg.color+'18':'transparent',color:bucketFilter===b?cfg.color:MUTED,cursor:'pointer'}}>
                  {cfg.icon && `${cfg.icon} `}{'label' in cfg ? cfg.label : b} ({cfg.count})
                </button>
              );
            })}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>QUICK:</span>
            {[
              {key:'accel',  label:'🚀 Accelerating', active:accelOnly,  toggle:()=>setAccelOnly(v=>!v),  count:rows.filter(r=>r.decisionStrip.acceleration.pass).length},
              {key:'fcf',    label:'💰 FCF+',         active:fcfOnly,    toggle:()=>setFcfOnly(v=>!v),    count:rows.filter(r=>(r.fcfAbsolute??-1)>0||(r.cfoToPat??0)>=0.8).length},
              {key:'disc',    label:'🔍 Discovery <15%', active:discoveryOnly,  toggle:()=>setDiscoveryOnly(v=>!v),  count:rows.filter(r=>(r.fiiPlusDii??100)<15).length},
      {key:'inflect', label:'💥 Inflection',     active:inflectionOnly, toggle:()=>setInflectionOnly(v=>!v), count:rows.filter(r=>r.inflectionSignal||r.triggerBonus>=10).length},
      // Guidance button — separate from regular toggles, has its own fetch action
            ].map(f=>(
              <button key={f.key} onClick={f.toggle} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${f.active?ACCENT+'60':BORDER}`,background:f.active?ACCENT+'14':'transparent',color:f.active?ACCENT:MUTED,cursor:'pointer'}}>
                {f.label} ({f.count})
              </button>
            ))}
            <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{filtered.length} showing</span>
            <button
              onClick={() => { setExpandAll(v => !v); setExpRow(null); }}
              style={{
                fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer',
                border:`1px solid ${expandAll ? ACCENT+'60' : BORDER}`,
                background: expandAll ? ACCENT+'14' : 'transparent',
                color: expandAll ? ACCENT : MUTED,
              }}
            >
              {expandAll ? '⊟ Collapse All' : '⊞ Expand All'}
            </button>
          </div>

          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'130px 150px 70px 70px 90px 130px 1fr 90px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span><span>SCORE</span><span>GRADE</span>
            <span style={{color:guidanceMode?'#F59E0B':MUTED}}>GUIDANCE{!guidanceMode&&<span style={{fontSize:9,fontWeight:400}}> ↑click 📡</span>}</span>
            <span>DECISION STRIP</span><span>SQGLP PILLARS</span><span>COV</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expandAll || expRow===r.symbol;
            const hasCrit=r.redFlags.some(f=>f.severity==='CRITICAL');
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'130px 150px 70px 70px 90px 130px 1fr 90px',gap:8,alignItems:'center'}}>
                    {/* Ticker + bucket + accel badge */}
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:hasCrit?RED:r.bucket==='MONITOR'?MUTED:TEXT}}>{r.symbol}</span>
                        {idx<3&&r.bucket!=='MONITOR'&&<span style={{fontSize:F.md}}>⭐</span>}
                      </div>
                      {/* Bucket badge */}
                      <span style={{fontSize:F.xs,fontWeight:700,color:BUCKET_CONFIG[r.bucket].color,border:`1px solid ${BUCKET_CONFIG[r.bucket].color}40`,padding:'1px 5px',borderRadius:3,width:'fit-content'}}>
                        {BUCKET_CONFIG[r.bucket].icon} {BUCKET_CONFIG[r.bucket].label.split(' ').slice(0,2).join(' ')}
                      </span>
                      {/* Ownership category badge */}
                      {r.ownershipCategory && (
                        <span title={OWNERSHIP_CONFIG[r.ownershipCategory].strategy} style={{fontSize:9,fontWeight:700,color:OWNERSHIP_CONFIG[r.ownershipCategory].color,border:`1px solid ${OWNERSHIP_CONFIG[r.ownershipCategory].color}40`,padding:'1px 4px',borderRadius:3,width:'fit-content'}}>
                          {OWNERSHIP_CONFIG[r.ownershipCategory].icon} {r.ownershipCategory === 'FOUNDER_CONTROLLED' ? 'Founder' : r.ownershipCategory === 'INSTITUTIONALIZING' ? 'Institutnlzg' : r.ownershipCategory === 'MATURE' ? 'Mature' : 'Vac⚠'}
                        </span>
                      )}
                      {/* Signals: inflection/trigger/trajectory/rerating */}
                      <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:2}}>
                        {r.inflectionSignal&&<span title="Early inflection phase: low-base high profit growth" style={{fontSize:9,fontWeight:800,color:'#F59E0B',border:'1px solid #F59E0B40',padding:'0 4px',borderRadius:3}}>💥 INFLECT</span>}
                        {r.triggerBonus>=10&&<span title={`Trigger bonus +${r.triggerBonus}: turnaround/new engine/industry shift proxy`} style={{fontSize:9,fontWeight:700,color:'#10B981',border:'1px solid #10B98140',padding:'0 4px',borderRadius:3}}>⚡+{r.triggerBonus}</span>}
                        {r.trajectoryScore>20&&<span title={`Trajectory +${r.trajectoryScore.toFixed(0)}pp above historical`} style={{fontSize:9,fontWeight:700,color:'#38bdf8',border:'1px solid #38bdf840',padding:'0 4px',borderRadius:3}}>↑T+{r.trajectoryScore.toFixed(0)}</span>}
                        {r.trajectoryScore<-20&&<span title={`Trajectory ${r.trajectoryScore.toFixed(0)}pp below historical`} style={{fontSize:9,color:RED}}>↓T{r.trajectoryScore.toFixed(0)}</span>}
                        {r.reratingBonus!==0&&<span style={{fontSize:9,color:r.reratingBonus>0?GREEN:RED}}>{r.reratingBonus>0?'↑':'↓'}{Math.abs(r.reratingBonus)}r</span>}
                      </div>
                    </div>

                    {/* Company */}
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company||r.sector}</span>

                    {/* Score */}
                    <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR[r.grade]??MUTED}}>{r.score}</span>

                    {/* Grade */}
                    <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR[r.grade],backgroundColor:`${GRADE_COLOR[r.grade]}18`,border:`1px solid ${GRADE_COLOR[r.grade]}30`,textAlign:'center'}}>{r.grade}</span>

                    {/* Guidance column — always shown, populated when guidance mode active */}
                    {!guidanceMode
                      ? <div style={{fontSize:F.xs,color:MUTED,textAlign:'center'}}>—</div>
                      : (() => {
                      const rAny = r as ExcelResult & { guidanceScore?: number; guidanceAdj?: number };
                      const gs = rAny.guidanceScore;
                      const adj = rAny.guidanceAdj ?? 0;
                      const articleCount = guidanceArticleCounts[r.symbol] ?? 0;
                      // -1 = no matching articles found
                      if (gs === undefined || gs === -1) {
                        return <div style={{fontSize:F.xs,color:MUTED,fontStyle:'italic'}}>—<br/><span style={{fontSize:9}}>no data</span></div>;
                      }
                      const gColor = gs >= 0.7 ? GREEN : gs <= 0.3 ? RED : gs >= 0.55 ? '#34d399' : gs <= 0.45 ? ORANGE : MUTED;
                      const gLabel = gs >= 0.85 ? '▲ Strong' : gs >= 0.70 ? '▲ Positive' : gs >= 0.55 ? '↑ Mild +' : gs <= 0.15 ? '▼ Weak' : gs <= 0.30 ? '▼ Negative' : gs <= 0.45 ? '↓ Mild −' : '→ Neutral';
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:2}}>
                          <div style={{display:'flex',alignItems:'center',gap:4}}>
                            <div style={{width:32,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${Math.round(gs*100)}%`,backgroundColor:gColor,borderRadius:2}}/>
                            </div>
                            <span style={{fontSize:F.xs,fontWeight:700,color:gColor}}>{gs.toFixed(1)}</span>
                          </div>
                          <span style={{fontSize:9,color:gColor,fontWeight:600}}>{gLabel}{adj !== 0 ? ` (${adj>0?'+':''}${adj}pts)` : ''}</span>
                          <span style={{fontSize:9,color:MUTED}}>
                            {articleCount > 0 ? `${articleCount} article${articleCount!==1?'s':''}` : '📊 trajectory proxy'}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Decision strip */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      {([
                        {key:'survival',   s:r.decisionStrip.survival},
                        {key:'acceleration',s:r.decisionStrip.acceleration},
                        {key:'valuation',  s:r.decisionStrip.valuation},
                        {key:'discovery',  s:r.decisionStrip.discovery},
                        {key:'technical',  s:r.decisionStrip.technical},
                      ] as const).map(({key,s})=>(
                        <div key={key} title={`${s.label}: ${s.detail}`} style={{display:'flex',alignItems:'center',gap:4}}>
                          <div style={{width:10,height:10,borderRadius:2,backgroundColor:s.pass?GREEN:RED,flexShrink:0}}/>
                          <span style={{fontSize:10,color:s.pass?`${GREEN}CC`:`${RED}CC`,fontWeight:600}}>{s.label}</span>
                          <span style={{fontSize:9,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:60}}>{s.detail}</span>
                        </div>
                      ))}
                    </div>

                    {/* SQGLP pillar bars */}
                    <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {r.pillarScores.map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:26,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:9,color:MUTED}}>{p.label.split(' ')[0].slice(0,4)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Coverage + flags */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {r.redFlags.length>0&&<span style={{fontSize:F.xs,color:hasCrit?RED:ORANGE}}>⚠{r.redFlags.length}</span>}
                    </div>
                  </div>
                </button>

                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
                      {/* Metrics by group */}
                      <div>
                        <div style={{fontSize:F.sm,color:MUTED,fontWeight:700,letterSpacing:'0.8px',marginBottom:8}}>ALL METRICS</div>
                        {METRICS.filter(([field])=>(r[field]!==undefined&&r[field]!==null)).map(([field,label,group])=>{
                          const v=r[field] as number;
                          const isPercent=label.includes('%');
                          const isX=label.includes('x')||label.includes('x');
                          const isCr=label.includes('Cr');
                          return (
                            <div key={String(field)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:F.md,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <span style={{color:MUTED}}>{label}<span style={{fontSize:F.xs,color:`${MUTED}70`,marginLeft:4}}>[{group}]</span></span>
                              <span style={{color:TEXT,fontWeight:700}}>{isCr?`₹${v.toLocaleString()}`:isX?`${v.toFixed(field==='de'||field==='cfoToPat'||field==='peg'||field==='netDebtEbitda'||field==='opLeverageRatio'?2:1)}×`:`${v.toFixed(1)}%`}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Analysis */}
                      <div>
                        {r.strengths.length>0&&<>
                          <div style={{fontSize:F.sm,color:GREEN,fontWeight:700,letterSpacing:'0.8px',marginBottom:6}}>✅ STRENGTHS</div>
                          {r.strengths.map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        {r.risks.length>0&&<>
                          <div style={{fontSize:F.sm,color:ORANGE,fontWeight:700,letterSpacing:'0.8px',marginTop:12,marginBottom:6}}>⚠️ RISKS</div>
                          {r.risks.map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        {r.redFlags.length>0&&<>
                          <div style={{fontSize:F.sm,color:RED,fontWeight:700,letterSpacing:'0.8px',marginTop:12,marginBottom:6}}>🚨 RED FLAGS</div>
                          {r.redFlags.map((f,i)=><div key={i} style={{fontSize:F.md,color:f.severity==='CRITICAL'?RED:ORANGE,padding:'3px 0'}}>⛔ {f.label} <span style={{fontSize:F.xs,color:MUTED}}>[{f.source}]</span></div>)}
                        </>}
                      </div>
                    </div>
                    <div style={{fontSize:F.sm,color:MUTED,borderTop:`1px solid ${BORDER}`,paddingTop:8,marginTop:12}}>
                      <span>Sector: {r.sector}</span> · <span>Data: {r.coverage}%</span> ·
                      <span style={{color:BUCKET_CONFIG[r.bucket].color}}>{BUCKET_CONFIG[r.bucket].icon} {BUCKET_CONFIG[r.bucket].label}</span> ·
                      {r.reratingBonus!==0&&<span style={{color:r.reratingBonus>0?GREEN:RED}}>Rerating {r.reratingBonus>0?'+':''}{r.reratingBonus}pts</span>}
                      {r.ownershipCategory&&<span style={{color:OWNERSHIP_CONFIG[r.ownershipCategory].color,fontWeight:700}}>{OWNERSHIP_CONFIG[r.ownershipCategory].icon} {OWNERSHIP_CONFIG[r.ownershipCategory].label}: {OWNERSHIP_CONFIG[r.ownershipCategory].strategy}</span>}
                      {guidanceMode && (() => {
                        const rAny = r as ExcelResult & { guidanceScore?: number; guidanceAdj?: number };
                        if (rAny.guidanceScore === undefined) return null;
                        const gColor = (rAny.guidanceScore ?? 0.5) >= 0.7 ? GREEN : (rAny.guidanceScore ?? 0.5) <= 0.3 ? RED : '#F59E0B';
                        return <span style={{color:gColor}}>Guidance {rAny.guidanceScore?.toFixed(1)} → score adj {rAny.guidanceAdj && rAny.guidanceAdj>0?'+':''}{rAny.guidanceAdj}pts</span>;
                      })()}
                      <span style={{color:MUTED,fontSize:F.xs}}>Wts: Q{r.pillarScores[0].weight}% G{r.pillarScores[1].weight}% L{r.pillarScores[2].weight}% F{r.pillarScores[3].weight}% V{r.pillarScores[4].weight}%</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {!rows.length&&!loading&&!parseError&&(
        <div style={{textAlign:'center',padding:56,color:MUTED}}>
          <div style={{fontSize:48}}>📤</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:14}}>Upload Screener.in exports to score all stocks</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8,lineHeight:1.8}}>
            SQGLP framework (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework<br/>
            All {METRICS.length} fields scored · New: LONGEVITY pillar · Operating Leverage · Net Debt/EBITDA · FII/DII undiscovered check
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST TAB — 37 criteria, institutional scale, auto-checks from Excel data
// ═══════════════════════════════════════════════════════════════════════════════

function MultibaggerChecklist({excelRows}:{excelRows:ExcelResult[]}) {
  const [symbol,setSymbol]=useState('');
  const [activeSymbol,setActiveSymbol]=useState('');
  const [savedSymbols,setSavedSymbols]=useState<string[]>([]);
  const [checks,setChecks]=useState<Record<string,boolean>>({});
  const [notes,setNotes]=useState<Record<string,string>>({});

  function loadSymbol(sym:string){
    setActiveSymbol(sym);
    try{setChecks(JSON.parse(localStorage.getItem(`mb3_checks_${sym}`)||'{}'));}catch{setChecks({});}
    try{setNotes(JSON.parse(localStorage.getItem(`mb3_notes_${sym}`)||'{}'));}catch{setNotes({});}
  }
  function addSymbol(){
    const s=symbol.trim().toUpperCase();
    if(!s||savedSymbols.includes(s)) return;
    const next=[...savedSymbols,s];
    setSavedSymbols(next);
    localStorage.setItem('mb3_symbols',JSON.stringify(next));
    loadSymbol(s);setSymbol('');
  }
  function removeSymbol(sym:string){
    const next=savedSymbols.filter(x=>x!==sym);
    setSavedSymbols(next);
    localStorage.setItem('mb3_symbols',JSON.stringify(next));
    if(activeSymbol===sym){setActiveSymbol(next[0]??'');setChecks({});setNotes({});}
  }
  function toggleCheck(id:string){
    const next={...checks,[id]:!checks[id]};
    setChecks(next);
    if(activeSymbol) localStorage.setItem(`mb3_checks_${activeSymbol}`,JSON.stringify(next));
  }
  function setNote(id:string,val:string){
    const next={...notes,[id]:val};
    setNotes(next);
    if(activeSymbol) localStorage.setItem(`mb3_notes_${activeSymbol}`,JSON.stringify(next));
  }

  useMemo(()=>{
    try{
      const syms=JSON.parse(localStorage.getItem('mb3_symbols')||'[]') as string[];
      setSavedSymbols(syms);
      if(syms.length>0&&!activeSymbol)loadSymbol(syms[0]);
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const excelStock=excelRows.find(r=>r.symbol.toUpperCase()===activeSymbol.toUpperCase());
  const autoChecks=useMemo(():Record<string,{pass:boolean;note:string}|null>=>{
    if(!excelStock) return {};
    const result:Record<string,{pass:boolean;note:string}|null>={};
    for (const item of CHECKLIST){
      if(!item.autoField||!item.autoPass) continue;
      // Handle both numeric fields and derived non-numeric fields (accelSignal etc.)
      const rawVal=excelStock[item.autoField as keyof ExcelResult];
      // For string-type fields (accelSignal), pass 0 as numeric placeholder — autoPass uses row
      const numVal = typeof rawVal === 'number' ? rawVal : (rawVal !== undefined ? 0 : undefined);
      if(numVal===undefined && rawVal===undefined) continue;
      const pass=item.autoPass(numVal??0, excelStock);
      const formatted = item.autoFormat ? item.autoFormat(numVal??0, excelStock) : (typeof rawVal==='number'?rawVal.toFixed(2):String(rawVal??''));
      if(!formatted) continue; // skip if format returns empty (derived field not available)
      const note=`Auto: ${formatted} → ${pass?'✅ PASS':'❌ FAIL'}`;
      result[item.id]={pass,note};
    }
    return result;
  },[excelStock]);

  const pillars=[...new Set(CHECKLIST.map(i=>i.pillar))];
  const completed=CHECKLIST.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
  const autoPassed=Object.values(autoChecks).filter(v=>v?.pass).length;
  const pct=Math.round((completed/CHECKLIST.length)*100);
  const grade:Grade=pct>=90?'A+':pct>=80?'A':pct>=68?'B+':pct>=55?'B':pct>=42?'C':'D';

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px'}}>
      {excelRows.length>0&&(
        <div style={{marginBottom:14,padding:'12px 18px',backgroundColor:`${GREEN}08`,border:`1px solid ${GREEN}20`,borderRadius:10,fontSize:F.md,color:GREEN}}>
          🤖 {excelRows.length} stocks from uploaded Excel — click any to auto-verify {CHECKLIST.filter(i=>i.autoField).length} criteria · {autoPassed>0?`${autoPassed} already verified for ${activeSymbol||'selected stock'}`:'select a stock below'}
        </div>
      )}

      {/* Ticker selector */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&addSymbol()}
          placeholder="Add ticker (e.g. HBLENGINE, APARINDS)" maxLength={20}
          style={{flex:'0 0 260px',padding:'10px 14px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,color:TEXT,fontSize:F.md,fontWeight:600,outline:'none'}}/>
        <button onClick={addSymbol} style={{padding:'10px 18px',backgroundColor:`${PURPLE}20`,border:`1px solid ${PURPLE}40`,borderRadius:10,color:PURPLE,fontSize:F.md,fontWeight:700,cursor:'pointer'}}>Add</button>
        {/* Quick buttons from top Excel scores */}
        {excelRows.slice(0,10).map(r=>(
          <button key={r.symbol} onClick={()=>{
            if(!savedSymbols.includes(r.symbol)){const n=[...savedSymbols,r.symbol];setSavedSymbols(n);localStorage.setItem('mb3_symbols',JSON.stringify(n));}
            loadSymbol(r.symbol);
          }} style={{padding:'8px 14px',borderRadius:8,border:`1px solid ${activeSymbol===r.symbol?GRADE_COLOR[r.grade]:BORDER}`,background:activeSymbol===r.symbol?`${GRADE_COLOR[r.grade]}15`:'transparent',color:activeSymbol===r.symbol?GRADE_COLOR[r.grade]:MUTED,fontSize:F.sm,fontWeight:700,cursor:'pointer'}}>
            {r.symbol} <span style={{color:GRADE_COLOR[r.grade]}}>{r.grade}</span>
          </button>
        ))}
        {savedSymbols.map(s=>(
          <div key={s} style={{display:'flex',borderRadius:10,border:`1px solid ${activeSymbol===s?`${PURPLE}60`:BORDER}`,overflow:'hidden'}}>
            <button onClick={()=>loadSymbol(s)} style={{padding:'8px 14px',background:activeSymbol===s?`${PURPLE}20`:'transparent',border:'none',cursor:'pointer',color:activeSymbol===s?PURPLE:MUTED,fontSize:F.md,fontWeight:700}}>{s}</button>
            <button onClick={()=>removeSymbol(s)} style={{padding:'8px 10px',background:'none',border:'none',borderLeft:`1px solid ${BORDER}`,cursor:'pointer',color:MUTED,fontSize:F.md}}>×</button>
          </div>
        ))}
      </div>

      {!activeSymbol?(
        <div style={{textAlign:'center',padding:60,color:MUTED}}>
          <div style={{fontSize:52}}>📋</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:16}}>37 criteria from SQGLP + Fisher + Framework</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8,lineHeight:1.8}}>
            Add a ticker above or click any scored stock · Auto-verification from uploaded Excel data<br/>
            Sources: MOSL 100× (SQGLP) · Philip Fisher 100-Bagger · Multibagger Framework
          </div>
        </div>
      ):(
        <>
          {/* Progress header */}
          <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div>
                <span style={{fontSize:F.h2,fontWeight:800,color:TEXT}}>{activeSymbol}</span>
                {excelStock&&<span style={{fontSize:F.md,color:MUTED,marginLeft:12}}>{excelStock.company} · {excelStock.sector} · Excel Score: <strong style={{color:GRADE_COLOR[excelStock.grade]}}>{excelStock.score} {excelStock.grade}</strong></span>}
              </div>
              <div style={{textAlign:'right'}}>
                <span style={{fontSize:F.h1,fontWeight:900,color:GRADE_COLOR[grade]??MUTED}}>{grade}</span>
                <span style={{fontSize:F.md,color:MUTED,marginLeft:8}}>{completed}/{CHECKLIST.length} criteria ({pct}%)</span>
              </div>
            </div>
            <div style={{height:10,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:5,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:pct>=70?GREEN:pct>=50?YELLOW:RED,borderRadius:5,transition:'width 0.3s'}}/>
            </div>
            <div style={{display:'flex',gap:20,marginTop:8,flexWrap:'wrap'}}>
              <span style={{fontSize:F.sm,color:GREEN}}>✅ {completed} passed</span>
              <span style={{fontSize:F.sm,color:ACCENT}}>🤖 {autoPassed} auto-verified from Excel</span>
              <span style={{fontSize:F.sm,color:MUTED}}>{CHECKLIST.length-completed} remaining</span>
              {!excelStock&&excelRows.length>0&&<span style={{fontSize:F.sm,color:YELLOW}}>⚠ Upload {activeSymbol} in Excel to enable auto-checks</span>}
            </div>
          </div>

          {/* Checklist by pillar */}
          {pillars.map(pillar=>{
            const items=CHECKLIST.filter(i=>i.pillar===pillar);
            const pc=items[0].pillarColor;
            const passed=items.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
            return (
              <div key={pillar} style={{marginBottom:24}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                  <span style={{fontSize:F.md,fontWeight:800,letterSpacing:'1px',color:pc}}>{pillar.replace('_',' ')}</span>
                  <span style={{fontSize:F.sm,color:MUTED}}>({passed}/{items.length} passed)</span>
                  <div style={{flex:1,height:1,backgroundColor:`${pc}25`}}/>
                </div>
                {items.map(item=>{
                  const auto=autoChecks[item.id];
                  const isChecked=auto?.pass||checks[item.id];
                  const isFail=auto&&!auto.pass;
                  const isAuto=!!auto;
                  return (
                    <div key={item.id} style={{marginBottom:8,borderRadius:10,border:`1px solid ${isChecked?`${pc}35`:isFail?`${RED}30`:BORDER}`,backgroundColor:isChecked?`${pc}07`:isFail?`${RED}05`:CARD_BG,overflow:'hidden'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px'}}>
                        <button onClick={()=>!isAuto&&toggleCheck(item.id)} style={{background:'none',border:`2px solid ${isChecked?pc:isFail?RED:MUTED}`,borderRadius:5,width:22,height:22,cursor:isAuto?'default':'pointer',flexShrink:0,marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',color:isChecked?pc:isFail?RED:'transparent',fontSize:F.md,fontWeight:900}}>
                          {isChecked?'✓':isFail?'✗':''}
                        </button>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                            <span style={{fontSize:F.md,color:TEXT,fontWeight:600}}>{item.label}</span>
                            {isAuto&&<span style={{fontSize:F.xs,fontWeight:800,color:ACCENT,border:`1px solid ${ACCENT}30`,padding:'1px 6px',borderRadius:4}}>AUTO</span>}
                            <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>wt {item.weight}% · {item.source}</span>
                          </div>
                          <div style={{fontSize:F.sm,color:MUTED,marginBottom:4}}><strong>Target:</strong> {item.target}</div>
                          {auto?.note&&<div style={{fontSize:F.sm,color:auto.pass?GREEN:RED,marginBottom:4,fontWeight:600}}>{auto.note}</div>}
                          {!isAuto&&(
                            <input value={notes[item.id]||''} onChange={e=>setNote(item.id,e.target.value)}
                              placeholder="Your research note / evidence…"
                              style={{width:'100%',marginTop:6,padding:'6px 10px',backgroundColor:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,borderRadius:6,color:MUTED,fontSize:F.sm,outline:'none',boxSizing:'border-box'}}/>
                          )}
                        </div>
                      </div>
                      <div style={{padding:'0 16px 10px 50px',fontSize:F.sm,color:`${MUTED}90`,lineHeight:1.6}}>{item.why}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'mb_excel_scored_v2';
const STORAGE_META = 'mb_excel_meta_v2';

export default function MultibaggerPage() {
  const [activeTab, setActiveTab] = useState<'excel'|'checklist'>('excel');

  // Lazy-init from localStorage — data survives navigation and page refresh.
  // Only cleared when user explicitly clicks "Clear All Data".
  const [excelRows, setExcelRowsState] = useState<ExcelResult[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ExcelResult[];
        // Always apply forced ranking on load — ensures grade distribution is correct
        // even when data was saved before forced ranking was implemented
        const sorted = [...parsed].sort((a, b) => b.score - a.score);
        return applyForcedRanking(sorted);
      }
    } catch {}
    return [];
  });

  // Wrapper: always applies forced ranking before saving/setting state
  function setExcelRows(rows: ExcelResult[]) {
    const ranked = applyForcedRanking(rows); // sort already done by caller
    setExcelRowsState(ranked);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ranked));
      localStorage.setItem(STORAGE_META, JSON.stringify({
        savedAt: new Date().toISOString(),
        count: ranked.length,
      }));
    } catch {}
  }

  // Clear all data — explicit user action only
  function clearExcelRows() {
    setExcelRowsState([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_META);
    } catch {}
  }

  return (
    <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif'}}>
      {/* Header */}
      <div style={{backgroundColor:'#13131a',borderBottom:'1px solid rgba(255,255,255,0.08)',padding:'20px 24px 0'}}>
        <div style={{maxWidth:1100,margin:'0 auto'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:12}}>
            <div>
              <h1 style={{fontSize:F.h1,fontWeight:900,color:PURPLE,margin:0}}>🚀 Multibagger Research Engine</h1>
              <p style={{fontSize:F.md,color:MUTED,margin:'5px 0 0'}}>
                SQGLP (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework · Upload Screener.in → instant institutional scoring
              </p>
            </div>
            {excelRows.length > 0 && (
              <button
                onClick={() => { if (window.confirm(`Clear all ${excelRows.length} stocks? This cannot be undone.`)) clearExcelRows(); }}
                style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
              >
                🗑 Clear All Data ({excelRows.length})
              </button>
            )}
          </div>
          <div style={{display:'flex',gap:0}}>
            {([
              {id:'excel',    label:'📤 Excel Score & Rank'},
              {id:'checklist',label:`📋 Research Checklist${excelRows.length?` (${excelRows.length} loaded)`:''}`},
            ] as const).map(tab=>{
              const active=activeTab===tab.id;
              return (
                <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{padding:'12px 22px',border:'none',cursor:'pointer',backgroundColor:'transparent',color:active?PURPLE:MUTED,fontSize:F.md,fontWeight:active?700:400,borderBottom:active?`2px solid ${PURPLE}`:'2px solid transparent',marginBottom:-1,flexShrink:0,transition:'all 0.15s'}}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab==='excel'     && <ExcelCompare rows={excelRows} setRows={setExcelRows} />}
      {activeTab==='checklist' && <MultibaggerChecklist excelRows={excelRows} />}
    </div>
  );
}
