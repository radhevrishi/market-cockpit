'use client';

import React, { useState, useMemo, useRef } from 'react';

// Shared API base — respects NEXT_PUBLIC_API_URL env var so all fetch() calls
// resolve consistently when the base URL changes (fixes #13: mixed /api/v1 vs /api)
const API_BASE = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || '/api/v1';

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
  // ── Kill-switch metrics ──────────────────────────────────────────────────
  gpm?: number;   // Gross Profit Margin % (Screener "Gross profit margin" or custom)
  roic?: number;  // Return on Invested Capital % (Screener "Return on invested capital")
  // ── NEW: Incremental / trend fields (Gap 1-3, 5, 7) ──────────────────────
  roce3yr?: number;      // ROCE 3 years ago → incremental ROCE signal (Gap 1)
  opm3yr?: number;       // OPM 3 years ago — custom Screener ratio (Gap 2)
  opmPrev?: number;      // OPM last year (Screener "OPM last year") → 1yr margin change (Gap 2)
  high52w?: number;      // 52-week High price (Screener "High price") (Gap 7)
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

// ── 8-TEST KILL-SWITCH LAYER ─────────────────────────────────────────────────
// Each test has 2-3 automated checks. pass=true|false|null (null = insufficient data).
// Test passes if majority (≥ half of non-null) checks pass.
interface KSCheck {
  label: string;
  pass: boolean | null;   // null = no data for this check
  detail: string;
}
interface KSTest {
  id: string;
  icon: string;
  label: string;
  checks: KSCheck[];
  pass: boolean;          // majority of non-null checks pass
  failCount: number;      // how many automated checks failed
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
  killSwitch: KSTest[];     // 8-test final kill-switch layer
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

// ── INDUSTRY TAILWIND ENGINE (Gap 3) ─────────────────────────────────────────
// Structural industry tailwind score (0-100) based on policy, demand cycle, global shift.
// Sources: MOSL sector studies, PLI notifications, DPIIT data, RBI credit flows.
// "Invest in right industry at right cycle point" — Fisher Stage 1 + MOSL core principle.
function getSectorTailwind(sector: string): { score: number; label: 'HIGH'|'MEDIUM-HIGH'|'MEDIUM'|'LOW'; drivers: string } {
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
function computeKillSwitch(row: ExcelRow): KSTest[] {
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
      risks.push(`ROIC ${roicEffective.toFixed(1)}% — below typical WACC (10%), capital allocation destroying value`);
      redFlags.push({ label: `ROIC ${roicEffective.toFixed(1)}% — below WACC`, severity: 'HIGH', source: 'Fisher ROIC' });
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

  // Compute kill-switch AFTER all scoring is settled
  const killSwitch = computeKillSwitch(row);

  return {
    ...row, score, grade, bucket, ownershipCategory, decisionStrip, reratingBonus, trajectoryScore, triggerBonus, inflectionSignal, coverage, strengths, risks, redFlags, killSwitch,
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
    else if (o==='Pledged percentage'||o==='Pledged Percentage')   m['pledge']=col;
    // ── Kill-switch metrics ──
    else if (o==='Gross profit margin'||o==='Gross Profit Margin'||o==='GPM'||o==='Gross Margin') m['gpm']=col;
    else if (o==='Return on invested capital'||o==='ROIC'||o==='Return on Invested Capital') m['roic']=col;
    // ── GAP 2: OPM comparison — Screener "OPM last year" or custom "OPM 3Years" ──
    else if (o==='OPM last year'||o==='OPM preceding year')        m['opmPrev']=col;
    else if (o==='OPM 3Years'||o==='OPM 3 Years'||o==='Operating Profit Margin 3Years')
      m['opm3yr']=col;
    // ── GAP 1: ROCE history — requires custom Screener ratio ──
    else if (o==='Return on capital employed 3Years'||o==='ROCE 3Years'||o==='ROCE 3 Years'||o==='Return on capital employed 3 Years')
      m['roce3yr']=col;
    // ── GAP 7: 52W High — Screener calls it "High price" ──
    else if (o==='High price'||o==='52 Week High'||o==='52W High'||o==='52wk High')
      m['high52w']=col;
    // ── GAP 7: % from 52W High — Screener already computes this ("From 52W High") ──
    else if (o==='From 52W High'||o==='From 52 week high'||o==='from 52W High')
      m['pctFrom52wHighDirect']=col;
    // ── GAP 5: EV/EBITDA direct — user added as custom ratio ("EV / EBITDA") ──
    else if (o==='EV / EBITDA'||o==='EV/EBITDA'||o==='Enterprise Value/EBITDA'||o==='EV to EBITDA')
      m['evEbitdaDirect']=col;
    // ── GAP 5: FCF Yield direct — user added as custom ratio ("FCF Yield") ──
    else if (o==='FCF Yield'||o==='FCF Yield %'||o==='Free cash flow yield'||o==='FCF yield')
      m['fcfYieldDirect']=col;
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
    else if (!m['roce3yr']&&(c.includes('roce')||c.includes('returnoncap'))&&(c.includes('3yr')||c.includes('3year')||c.includes('3y')&&c.includes('ago'))) m['roce3yr']=col;
    else if (!m['opm3yr']&&(c.includes('opm')||c.includes('operatingmargin'))&&(c.includes('3yr')||c.includes('3year'))) m['opm3yr']=col;
    else if (!m['opmPrev']&&(c.includes('opm')||c.includes('operatingmargin'))&&(c.includes('lastyear')||c.includes('preceding')||c.includes('prevyr')||c.includes('lastyear'))) m['opmPrev']=col;
    else if (!m['high52w']&&(c.includes('highprice')||c.includes('52whigh')||(c.includes('52')&&c.includes('high')))) m['high52w']=col;
    else if (!m['pctFrom52wHighDirect']&&(c.includes('from52w')||c.includes('from52week'))) m['pctFrom52wHighDirect']=col;
    else if (!m['evEbitdaDirect']&&(c.includes('evebitda')||c.includes('evtoebitda')||(c.includes('ev')&&c.includes('ebitda')))) m['evEbitdaDirect']=col;
    else if (!m['fcfYieldDirect']&&(c.includes('fcfyield')||c.includes('freecashflowyield'))) m['fcfYieldDirect']=col;
    else if (!m['gpm']&&(c.includes('grossprofit')&&c.includes('margin')||c==='gpm'||c.includes('grossmargin'))) m['gpm']=col;
    else if (!m['roic']&&(c.includes('returnoninvested')||c==='roic')) m['roic']=col;
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
  const mcap=n(m['marketCapCr']?row[m['marketCapCr']]:undefined);
  const fcfAbs=n(m['fcfAbsolute']?row[m['fcfAbsolute']]:undefined);
  const roce_cur=n(m['roce']?row[m['roce']]:undefined);
  const opm_cur=n(m['opm']?row[m['opm']]:undefined);
  const roce3yr=n(m['roce3yr']?row[m['roce3yr']]:undefined);
  const opm3yr=n(m['opm3yr']?row[m['opm3yr']]:undefined);
  const opmPrev=n(m['opmPrev']?row[m['opmPrev']]:undefined);  // Screener "OPM last year"
  const high52w=n(m['high52w']?row[m['high52w']]:undefined);  // Screener "High price"
  // Direct columns (user-added custom ratios from Screener):
  const pctFrom52wHighDirect=n(m['pctFrom52wHighDirect']?row[m['pctFrom52wHighDirect']]:undefined);
  const evEbitdaDirect=n(m['evEbitdaDirect']?row[m['evEbitdaDirect']]:undefined);
  const fcfYieldDirect=n(m['fcfYieldDirect']?row[m['fcfYieldDirect']]:undefined);
  // Determine which OPM comparison base is available: prefer 3yr, fall back to 1yr
  const opmBase = opm3yr ?? opmPrev;  // undefined if neither available
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
    // ── New raw fields ──
    gpm: n(m['gpm']?row[m['gpm']]:undefined),
    roic: n(m['roic']?row[m['roic']]:undefined),
    roce3yr,
    opm3yr,
    opmPrev,
    high52w,
    // Derived
    marginOfSafety:(iv!==undefined&&price!==undefined&&price>0)?Math.round((iv-price)/price*100):undefined,
    aboveDMA200:(dma!==undefined&&price!==undefined&&dma>0)?Math.round((price-dma)/dma*100):undefined,
    netDebtEbitda:(netDebt!==undefined&&ebitda!==undefined&&ebitda>0)?Math.round(netDebt/ebitda*10)/10:undefined,
    fiiPlusDii:(fii!==undefined&&dii!==undefined)?Math.round((fii+dii)*10)/10:fii!==undefined?fii:undefined,
    opLeverageRatio:(n(m['profitCagr']?row[m['profitCagr']]:undefined)!==undefined&&n(m['revCagr']?row[m['revCagr']]:undefined)!==undefined&&(n(m['revCagr']?row[m['revCagr']]:undefined) as number)>0)?(n(m['profitCagr']?row[m['profitCagr']]:undefined) as number)/(n(m['revCagr']?row[m['revCagr']]:undefined) as number):undefined,
    // ── NEW DERIVED FIELDS ────────────────────────────────────────────────────
    // Gap 5: EV/EBITDA — prefer direct Screener column ("EV / EBITDA"), fallback = computed
    evEbitda: evEbitdaDirect ??
      ((mcap!==undefined&&netDebt!==undefined&&ebitda!==undefined&&ebitda>0)?
        Math.round((mcap+netDebt)/ebitda*10)/10 : undefined),
    // Gap 5: FCF Yield — prefer direct Screener column ("FCF Yield"), fallback = computed
    // Direct value is already in %; computed: FCF(Cr)/MCap(Cr)*100
    fcfYield: fcfYieldDirect ??
      ((fcfAbs!==undefined&&mcap!==undefined&&mcap>0)?
        Math.round(fcfAbs/mcap*1000)/10 : undefined),
    // Gap 1: Incremental ROCE = current ROCE − ROCE 3 years ago (+ve = new capital productive)
    roceExpansion:(roce_cur!==undefined&&roce3yr!==undefined)?
      Math.round((roce_cur-roce3yr)*10)/10 : undefined,
    // Gap 2: OPM expansion — current vs best available historical (3yr preferred, 1yr fallback)
    // opmBase = opm3yr (custom ratio) ?? opmPrev (Screener "OPM last year")
    opmExpansion:(opm_cur!==undefined&&opmBase!==undefined)?
      Math.round((opm_cur-opmBase)*10)/10 : undefined,
    // Gap 7: % from 52W High — prefer "From 52W High" column (already %) else compute
    pctFrom52wHigh: pctFrom52wHighDirect ??
      ((price!==undefined&&high52w!==undefined&&high52w>0)?
        Math.round((price-high52w)/high52w*100) : undefined),
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
        fetch(`${API_BASE}/news?limit=500&importance_min=1&article_type=EARNINGS`),
        fetch(`${API_BASE}/news?limit=300&importance_min=1&article_type=CORPORATE`),
        fetch(`${API_BASE}/news?limit=200&importance_min=1&article_type=RATING_CHANGE`),
        fetch(`${API_BASE}/news?limit=200&importance_min=2&article_type=GENERAL`),
        fetch(`${API_BASE}/news?limit=100&importance_min=2&article_type=BOTTLENECK`),
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
          // NO NEWS FOUND — use earnings trajectory as proxy for ALL stocks.
          // For Indian small-caps there is often zero press coverage; the trajectory
          // from quarterly numbers IS the forward signal. Score capped at 0.65.
          // Key fix: STABLE = 0.50 (neutral, not "no data"). ACCELERATING = ≥0.55
          // even when delta is small, because accelSignal itself is meaningful.
          const revAccel  = stock.revenueAcceleration;
          const profAccel = stock.profitAcceleration;
          const trajectory = (revAccel ?? 0) + (profAccel ?? 0);
          const accel = stock.accelSignal;
          const hasMetrics = revAccel !== undefined || profAccel !== undefined ||
                             stock.revCagr !== undefined || stock.profitCagr !== undefined;

          if (accel === 'ACCELERATING') {
            // ACCELERATING signal is meaningful by itself — trajectory shows magnitude
            if (trajectory > 60)      scores[sym] = 0.65;
            else if (trajectory > 30) scores[sym] = 0.60;
            else if (trajectory > 10) scores[sym] = 0.57;
            else                      scores[sym] = 0.55; // low-delta ACCELERATING still positive
          } else if (accel === 'STABLE') {
            // STABLE = performing as expected, no upgrade/downgrade signal
            // Show 0.50 (neutral) NOT -1 — "no surprise" IS information
            scores[sym] = 0.50;
          } else if (accel === 'DECELERATING') {
            if (trajectory < -40)      scores[sym] = 0.25;
            else if (trajectory < -20) scores[sym] = 0.35;
            else                       scores[sym] = 0.40;
          } else if (hasMetrics) {
            // accelSignal undefined (e.g. missing YOY data) but some metrics exist
            scores[sym] = 0.50; // neutral default
          } else {
            scores[sym] = -1;   // truly no information at all
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
    ['pctFrom52wHigh','vs 52W High %','Market'],
    ['evEbitda','EV/EBITDA x','Valuation'],['fcfYield','FCF Yield %','Valuation'],
    ['roceExpansion','ROCE Δ 3yr pp','Quality'],['opmExpansion','OPM Δ 3yr pp','Quality'],
    ['gpm','GPM %','Quality'],['roic','ROIC %','Quality'],
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
            {field:'Free Cash Flow',why:'Fisher FCF filter + FCF yield'},
            {field:'Net Debt',why:'Fisher survival: ND/EBITDA < 1.5'},
            {field:'EBITDA',why:'ND/EBITDA + EV/EBITDA valuation'},
            {field:'FII Holding',why:'MOSL SQGLP "S" undiscovered'},
            {field:'DII Holding',why:'Institutional coverage check'},
            {field:'Change in promoter holding',why:'Insider trend signal'},
            {field:'EPS growth',why:'Fisher Twin Engine check'},
            {field:'OPM last year',why:'Gap 2: 1yr OPM expansion / margin quality'},
            {field:'From 52W High',why:'Gap 7: % from 52W high (already computed by Screener)'},
            {field:'High price',why:'Gap 7: 52W high price (Screener standard field)'},
            {field:'EV / EBITDA',why:'Gap 5: enterprise value vs EBITDA (custom ratio)'},
            {field:'FCF Yield',why:'Gap 5: FCF as % of market cap (custom ratio)'},
            {field:'Gross profit margin',why:'Kill-switch: GPM → pricing power & moat test'},
            {field:'Return on invested capital',why:'Kill-switch: ROIC → capital efficiency & reinvestment engine'},
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

            {/* ── DOWNLOAD DOCX ── */}
            {filtered.length > 0 && (
              <button
                title="Download full report as Word document"
                onClick={async () => {
                  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
                    HeadingLevel, AlignmentType, WidthType, BorderStyle: BS, ShadingType, LevelFormat } = await import('docx');
                  const border = { style: BS.SINGLE, size: 1, color: 'CCCCCC' };
                  const borders = { top: border, bottom: border, left: border, right: border };
                  const cm = { top: 80, bottom: 80, left: 120, right: 120 };
                  const fmtVal = (field: keyof ExcelRow, label: string, v: number) => {
                    if (label.includes('Cr')) return `₹${v.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
                    if (label.endsWith(' x')) return `${v.toFixed(2)}×`;
                    return `${v.toFixed(1)}${label.includes('%') || label.includes('pp') ? '%' : ''}`;
                  };
                  const children: any[] = [
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: '📊 Multibagger Research Report', bold: true, size: 36 })] }),
                    new Paragraph({ children: [new TextRun({ text: `Generated: ${new Date().toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}  |  Stocks: ${filtered.length}  |  Framework: SQGLP + Fisher 100-Bagger`, size: 20, color: '666666' })] }),
                    new Paragraph({ children: [new TextRun('')] }),
                    // Grade summary table
                    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [1560,1560,1560,1560,1560,1560], rows: [
                      new TableRow({ children: ['A+','A','B+','B','C','D'].map(g => new TableCell({ borders, margins: cm, width: { size: 1560, type: WidthType.DXA }, shading: { fill: g==='A+'?'E8F5E9':g==='A'?'F1F8E9':g==='B+'?'FFF8E1':g==='B'?'FFF3E0':'FAFAFA', type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: g, bold: true })] })] })) }),
                      new TableRow({ children: ['A+','A','B+','B','C','D'].map(g => new TableCell({ borders, margins: cm, width: { size: 1560, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(filtered.filter(r=>r.grade===g).length), bold: true, size: 24 })] })] })) }),
                    ]}),
                    new Paragraph({ children: [new TextRun('')] }),
                  ];
                  for (const r of filtered) {
                    const gs = guidanceScores[r.symbol];
                    children.push(
                      new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: children.length > 10, children: [new TextRun({ text: `${r.symbol}  —  ${r.company || r.sector}`, bold: true })] }),
                      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2340,2340,2340,2340], rows: [
                        new TableRow({ children: [
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, shading: { fill: 'F5F5F5', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: `Score: ${r.score} | Grade: ${r.grade}`, bold: true })] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(`Bucket: ${r.bucket.replace(/_/g,' ')}`)] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(`Ownership: ${r.ownershipCategory.replace(/_/g,' ')}`)] })] }),
                          new TableCell({ borders, margins: cm, width: { size: 2340, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun(gs !== undefined && gs !== -1 ? `Guidance: ${gs.toFixed(1)}` : 'Guidance: —')] })] }),
                        ]}),
                      ]}),
                    );
                    // Metrics table
                    const metricRows = METRICS.filter(([f]) => r[f] !== undefined && r[f] !== null);
                    if (metricRows.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: 'Metrics', bold: true, size: 22 })] }));
                      const half = Math.ceil(metricRows.length / 2);
                      for (let i = 0; i < half; i++) {
                        const left = metricRows[i], right = metricRows[i + half];
                        children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2600,2080,2600,2080], rows: [
                          new TableRow({ children: [
                            new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, shading: { fill: 'F9F9F9', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: left[1], size: 18 })] })] }),
                            new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtVal(left[0], left[1], r[left[0]] as number), bold: true, size: 18 })] })] }),
                            ...(right ? [
                              new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, shading: { fill: 'F9F9F9', type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: right[1], size: 18 })] })] }),
                              new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmtVal(right[0], right[1], r[right[0]] as number), bold: true, size: 18 })] })] }),
                            ] : [
                              new TableCell({ borders, margins: cm, width: { size: 2600, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
                              new TableCell({ borders, margins: cm, width: { size: 2080, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
                            ]),
                          ]}),
                        ]}));
                      }
                    }
                    // Strengths
                    if (r.strengths.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: '✅ Strengths', bold: true, size: 22, color: '1B7F4F' })] }));
                      r.strengths.forEach(s => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `• ${s}`, size: 18 })] })));
                    }
                    // Risks
                    if (r.risks.length > 0 || r.redFlags.length > 0) {
                      children.push(new Paragraph({ children: [new TextRun({ text: '⚠ Risks & Flags', bold: true, size: 22, color: 'B91C1C' })] }));
                      r.redFlags.forEach(f => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `🚩 [${f.severity}] ${f.label}`, size: 18, color: 'B91C1C' })] })));
                      r.risks.filter(s => !s.startsWith('Hard ')).forEach(s => children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `• ${s}`, size: 18 })] })));
                    }
                    children.push(new Paragraph({ children: [new TextRun({ text: `Sector: ${r.sector}  |  Data: ${r.coverage}%  |  Pillar weights: ${r.pillarScores.map(p=>`${p.label} ${p.weight}%`).join(' · ')}`, size: 16, color: '888888' })] }));
                    children.push(new Paragraph({ children: [new TextRun('')] }));
                  }
                  const doc = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }] });
                  const blob = await Packer.toBlob(doc);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `multibagger-${new Date().toISOString().slice(0,10)}.docx`; a.click(); URL.revokeObjectURL(url);
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'#a78bfa' }}
              >⬇ DOCX</button>
            )}

            {/* ── DOWNLOAD PDF ── */}
            {filtered.length > 0 && (
              <button
                title="Download full report as PDF"
                onClick={async () => {
                  const { jsPDF } = await import('jspdf');
                  const autoTable = (await import('jspdf-autotable')).default;
                  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                  const pageW = doc.internal.pageSize.getWidth();
                  const margin = 14;
                  const contentW = pageW - margin * 2;
                  const fmtV = (label: string, v: number) => {
                    if (label.includes('Cr')) return `₹${v.toLocaleString('en-IN',{maximumFractionDigits:1})}`;
                    if (label.endsWith(' x')) return `${v.toFixed(2)}×`;
                    return `${v.toFixed(1)}${label.includes('%')||label.includes('pp')?'%':''}`;
                  };
                  // Cover page
                  doc.setFontSize(22); doc.setFont('helvetica','bold');
                  doc.text('Multibagger Research Report', pageW/2, 40, { align: 'center' });
                  doc.setFontSize(11); doc.setFont('helvetica','normal');
                  doc.text(`SQGLP · Fisher 100-Bagger · ${filtered.length} stocks · ${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}`, pageW/2, 50, { align: 'center' });
                  // Grade summary
                  const gradeSummary = ['A+','A','B+','B','C','D'].map(g => [g, String(filtered.filter(r=>r.grade===g).length)]);
                  autoTable(doc, { startY: 60, margin: { left: margin }, head: [['A+','A','B+','B','C','D']], body: [gradeSummary.map(([,n])=>n)], theme: 'grid', headStyles: { fillColor: [88,28,135], textColor: 255, fontStyle: 'bold', halign: 'center' }, bodyStyles: { halign: 'center', fontStyle: 'bold', fontSize: 13 }, tableWidth: contentW });
                  for (let i = 0; i < filtered.length; i++) {
                    const r = filtered[i];
                    doc.addPage();
                    const gs = guidanceScores[r.symbol];
                    // Stock header
                    doc.setFillColor(15, 23, 42); doc.rect(0, 0, pageW, 22, 'F');
                    doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont('helvetica','bold');
                    doc.text(`${r.symbol}  —  ${r.company || r.sector}`, margin, 10);
                    doc.setFontSize(9); doc.setFont('helvetica','normal');
                    const gradeColor: Record<string,[number,number,number]> = {'A+':[16,185,129],'A':[52,211,153],'B+':[245,158,11],'B':[249,115,22],'C':[251,146,60],'D':[239,68,68]};
                    const gc = gradeColor[r.grade] || [100,100,100];
                    doc.setTextColor(...gc); doc.setFontSize(18); doc.setFont('helvetica','bold');
                    doc.text(r.grade, pageW - margin - 10, 13, { align: 'right' });
                    doc.setTextColor(200,200,200); doc.setFontSize(9); doc.setFont('helvetica','normal');
                    doc.text(`Score: ${r.score}  |  ${r.bucket.replace(/_/g,' ')}  |  ${r.ownershipCategory.replace(/_/g,' ')}  |  Guidance: ${gs !== undefined && gs !== -1 ? gs.toFixed(1) : '—'}`, margin, 18);
                    doc.setTextColor(0,0,0);
                    // Metrics table
                    const metricRows = METRICS.filter(([f]) => r[f] !== undefined && r[f] !== null)
                      .map(([f,label]) => [label, fmtV(label, r[f] as number)]);
                    const half = Math.ceil(metricRows.length / 2);
                    const leftCol = metricRows.slice(0, half);
                    const rightCol = metricRows.slice(half);
                    const tableBody = leftCol.map((row, i) => [...row, ...(rightCol[i] || ['',''])]);
                    autoTable(doc, { startY: 26, margin: { left: margin }, head: [['Metric','Value','Metric','Value']], body: tableBody, theme: 'striped', headStyles: { fillColor: [30,41,59], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7.5 }, columnStyles: { 0: { cellWidth: contentW*0.32 }, 1: { cellWidth: contentW*0.18, halign:'right' }, 2: { cellWidth: contentW*0.32 }, 3: { cellWidth: contentW*0.18, halign:'right' } }, tableWidth: contentW });
                    const afterMetrics = (doc as any).lastAutoTable?.finalY || 80;
                    // Strengths
                    if (r.strengths.length > 0) {
                      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(27,127,79);
                      doc.text('✅ STRENGTHS', margin, afterMetrics + 6);
                      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(40,40,40);
                      let y = afterMetrics + 11;
                      for (const s of r.strengths.slice(0,12)) {
                        const lines = doc.splitTextToSize(`• ${s}`, contentW - 4);
                        doc.text(lines, margin + 2, y); y += lines.length * 4;
                        if (y > 260) break;
                      }
                      // Risks
                      if (r.risks.length > 0 || r.redFlags.length > 0) {
                        doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(185,28,28);
                        doc.text('⚠ RISKS', margin, y + 4);
                        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(60,40,40);
                        y += 9;
                        for (const f of r.redFlags.slice(0,5)) {
                          const lines = doc.splitTextToSize(`🚩 [${f.severity}] ${f.label}`, contentW - 4);
                          doc.text(lines, margin + 2, y); y += lines.length * 4;
                          if (y > 275) break;
                        }
                        for (const s of r.risks.filter(x=>!x.startsWith('Hard ')).slice(0,8)) {
                          const lines = doc.splitTextToSize(`• ${s}`, contentW - 4);
                          doc.text(lines, margin + 2, y); y += lines.length * 4;
                          if (y > 275) break;
                        }
                      }
                    }
                    // Footer
                    doc.setFontSize(7); doc.setTextColor(140,140,140);
                    doc.text(`Sector: ${r.sector}  |  Data: ${r.coverage}%  |  ${i+1}/${filtered.length}`, margin, 289);
                  }
                  doc.save(`multibagger-${new Date().toISOString().slice(0,10)}.pdf`);
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'#f97316' }}
              >⬇ PDF</button>
            )}
          </div>

          {/* ── GAP 6: PORTFOLIO CONSTRUCTION PANEL ─────────────────────────── */}
          {(() => {
            // Grade → position size recommendation (SQGLP-based, risk-adjusted)
            const sizeMap: Record<Grade,string> = {'A+':'8–12%','A':'5–8%','B+':'3–5%','B':'1–3%','C':'0%','D':'0%','NR':'0%'};
            const actionMap: Record<Grade,string> = {'A+':'Core position','A':'Standard position','B+':'Pilot / accumulate on dips','B':'Watchlist only','C':'Avoid','D':'Avoid','NR':'No data'};
            const actionColor: Record<Grade,string> = {'A+':GREEN,'A':'#34d399','B+':YELLOW,'B':MUTED,'C':RED,'D':RED,'NR':MUTED};
            // Bucket allocation caps
            const bucketCaps: Record<Bucket, { maxPct: number; label: string; color: string }> = {
              CORE_COMPOUNDER:      { maxPct:40, label:'Core (≤40% total)', color:GREEN },
              EMERGING_MULTIBAGGER: { maxPct:35, label:'Emerging (≤35% total)', color:PURPLE },
              HIGH_RISK:            { maxPct:15, label:'High-Risk (≤15% total)', color:ORANGE },
              MONITOR:              { maxPct:5,  label:'Monitor (≤5% total)', color:MUTED },
            };
            const actionableRows = rows.filter(r => ['A+','A','B+'].includes(r.grade) && r.bucket !== 'MONITOR');
            // Sector concentration
            const sectorCounts = actionableRows.reduce((acc, r) => {
              acc[r.sector] = (acc[r.sector] || 0) + 1;
              return acc;
            }, {} as Record<string,number>);
            const concentratedSectors = Object.entries(sectorCounts).filter(([,c]) => c >= 3);
            // Bucket breakdowns of actionable picks
            const bucketGroups = (['CORE_COMPOUNDER','EMERGING_MULTIBAGGER','HIGH_RISK'] as Bucket[]).map(b => ({
              b, cfg: bucketCaps[b],
              stocks: actionableRows.filter(r => r.bucket === b),
            }));
            return (
              <details style={{marginBottom:16}} open={false}>
                <summary style={{cursor:'pointer',padding:'12px 16px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,
                  fontSize:F.md,fontWeight:700,color:PURPLE,userSelect:'none',
                  display:'flex',gap:10,alignItems:'center',listStyle:'none'}}>
                  📐 Portfolio Construction (Gap 6)
                  <span style={{fontSize:F.xs,fontWeight:400,color:MUTED,marginLeft:4}}>
                    {actionableRows.length} actionable picks — allocation guide, sizing, concentration check
                  </span>
                </summary>
                <div style={{padding:'18px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderTop:'none',borderRadius:'0 0 10px 10px'}}>
                  {/* Position sizing by grade */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:F.sm,fontWeight:800,color:MUTED,letterSpacing:'0.5px',marginBottom:10}}>POSITION SIZING BY GRADE</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {(['A+','A','B+','B'] as Grade[]).map(g => {
                        const cnt = actionableRows.filter(r => r.grade === g).length;
                        return (
                          <div key={g} style={{padding:'12px 18px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${GRADE_COLOR[g]}30`,minWidth:140}}>
                            <div style={{display:'flex',gap:8,alignItems:'baseline',marginBottom:4}}>
                              <span style={{fontSize:F.xl,fontWeight:900,color:GRADE_COLOR[g]}}>{g}</span>
                              <span style={{fontSize:F.xs,color:MUTED}}>{cnt} stocks</span>
                            </div>
                            <div style={{fontSize:F.md,fontWeight:700,color:TEXT}}>{sizeMap[g]}</div>
                            <div style={{fontSize:F.xs,color:actionColor[g],marginTop:3}}>{actionMap[g]}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Bucket allocation limits */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:F.sm,fontWeight:800,color:MUTED,letterSpacing:'0.5px',marginBottom:10}}>BUCKET ALLOCATION CAPS</div>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {bucketGroups.map(({b, cfg, stocks}) => (
                        <div key={b} style={{padding:'12px 16px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${cfg.color}30`,flex:'1 1 160px'}}>
                          <div style={{fontSize:F.xs,fontWeight:700,color:cfg.color,marginBottom:4}}>{BUCKET_CONFIG[b].icon} {BUCKET_CONFIG[b].label}</div>
                          <div style={{fontSize:F.lg,fontWeight:800,color:TEXT,marginBottom:2}}>{stocks.length} picks</div>
                          <div style={{fontSize:F.xs,color:MUTED}}>{cfg.label}</div>
                          {stocks.slice(0,3).map(s => (
                            <div key={s.symbol} style={{fontSize:F.xs,color:MUTED,marginTop:3}}>
                              <span style={{color:GRADE_COLOR[s.grade],fontWeight:700}}>{s.grade}</span> {s.symbol} ({sizeMap[s.grade]})
                            </div>
                          ))}
                          {stocks.length > 3 && <div style={{fontSize:F.xs,color:MUTED,marginTop:2}}>+{stocks.length-3} more</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Sector concentration warning */}
                  {concentratedSectors.length > 0 && (
                    <div style={{padding:'12px 16px',backgroundColor:`${ORANGE}10`,border:`1px solid ${ORANGE}30`,borderRadius:8,marginBottom:16}}>
                      <div style={{fontSize:F.sm,fontWeight:800,color:ORANGE,marginBottom:6}}>⚠️ Sector Concentration Risk</div>
                      {concentratedSectors.map(([sector, cnt]) => (
                        <div key={sector} style={{fontSize:F.xs,color:TEXT,marginBottom:3}}>
                          <strong>{sector}</strong>: {cnt} picks in top grades — consider capping at 2 per sector for diversification
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Ownership allocation guidance */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
                    {(['FOUNDER_CONTROLLED','INSTITUTIONALIZING','MATURE','OWNERSHIP_VACUUM'] as OwnershipCategory[]).map(cat => {
                      const cfg = OWNERSHIP_CONFIG[cat];
                      const cnt = actionableRows.filter(r => r.ownershipCategory === cat).length;
                      return (
                        <div key={cat} style={{padding:'10px 14px',backgroundColor:CARD_BG,borderRadius:8,border:`1px solid ${cfg.color}20`}}>
                          <div style={{fontSize:F.xs,fontWeight:700,color:cfg.color}}>{cfg.icon} {cfg.label}</div>
                          <div style={{fontSize:F.xs,color:MUTED,marginTop:2}}>{cnt} picks · {cfg.allocation}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            );
          })()}

          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 65px 96px 86px 120px 1fr 76px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span><span>SCORE</span><span>GRADE</span>
            <span style={{color:YELLOW}}>P/E · PEG</span>
            <span style={{color:guidanceMode?'#F59E0B':MUTED}}>GUIDANCE{!guidanceMode&&<span style={{fontSize:9,fontWeight:400}}> ↑📡</span>}</span>
            <span>DECISION STRIP</span><span>SQGLP PILLARS</span><span>COV</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expandAll || expRow===r.symbol;
            const hasCrit=r.redFlags.some(f=>f.severity==='CRITICAL');
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 65px 96px 86px 120px 1fr 76px',gap:8,alignItems:'center'}}>
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

                    {/* P/E + PEG — always visible for every stock */}
                    {(() => {
                      const pe = r.pe;
                      const peg = r.peg;
                      const mcap = r.marketCapCr;
                      // P/E color: sector-appropriate. Green < sector mid, Orange = mid-high, Red > 2× sector p75
                      const b2 = SBENCH[getSectorKey(r.sector)] ?? SBENCH.DEFAULT;
                      const peColor = pe === undefined ? MUTED :
                        pe < b2.pe[1]   ? GREEN :
                        pe < b2.pe[2]   ? YELLOW :
                        pe > b2.pe[2]*1.5 ? RED : ORANGE;
                      // PEG color: < 1 = green (cheap growth), 1-1.5 = yellow, > 2 = red
                      const pegColor = peg === undefined || peg <= 0 ? MUTED :
                        peg < 1.0 ? GREEN : peg < 1.5 ? YELLOW : peg < 2.5 ? ORANGE : RED;
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:3}}>
                          {pe !== undefined
                            ? <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                                <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>PE</span>
                                <span style={{fontSize:F.md,fontWeight:800,color:peColor}}>{pe.toFixed(0)}×</span>
                              </div>
                            : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>PE —</span>
                          }
                          {peg !== undefined && peg > 0
                            ? <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                                <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>PEG</span>
                                <span style={{fontSize:F.md,fontWeight:800,color:pegColor}}>{peg.toFixed(2)}</span>
                              </div>
                            : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>PEG —</span>
                          }
                          {mcap !== undefined &&
                            <span style={{fontSize:9,color:MUTED}}>
                              {mcap >= 100000 ? `₹${(mcap/100000).toFixed(1)}L Cr` :
                               mcap >= 1000   ? `₹${(mcap/1000).toFixed(1)}k Cr`  :
                                                `₹${mcap.toFixed(0)}Cr`}
                            </span>
                          }
                        </div>
                      );
                    })()}

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

                        {/* ── 8-TEST KILL-SWITCH PANEL ── */}
                        {r.killSwitch && r.killSwitch.length > 0 && (() => {
                          const tested = r.killSwitch.filter(t => t.checks.some(c => c.pass !== null));
                          if (tested.length === 0) return null;
                          const passed = tested.filter(t => t.pass).length;
                          const failed = tested.filter(t => !t.pass).length;
                          const pColor = passed >= 6 ? GREEN : passed >= 4 ? YELLOW : ORANGE;
                          return (
                            <div style={{marginTop:16,borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
                              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                                <span style={{fontSize:F.sm,fontWeight:800,letterSpacing:'0.8px',color:PURPLE}}>🛡 8-TEST KILL-SWITCH</span>
                                <span style={{fontSize:F.xs,color:pColor,fontWeight:700}}>{passed}/{tested.length} pass</span>
                                {failed > 0 && <span style={{fontSize:F.xs,color:failed>=5?RED:ORANGE}}>· {failed} fail{failed>=4?' (grade capped)':''}</span>}
                              </div>
                              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
                                {r.killSwitch.map(t => {
                                  const hasTested = t.checks.some(c => c.pass !== null);
                                  const tColor = !hasTested ? MUTED : t.pass ? GREEN : ORANGE;
                                  const passedC = t.checks.filter(c=>c.pass===true).length;
                                  const failedC = t.checks.filter(c=>c.pass===false).length;
                                  return (
                                    <details key={t.id} style={{backgroundColor:CARD2,border:`1px solid ${tColor}30`,borderLeft:`3px solid ${tColor}`,borderRadius:7,padding:'8px 10px'}}>
                                      <summary style={{cursor:'pointer',listStyle:'none',display:'flex',alignItems:'center',gap:6,userSelect:'none'}}>
                                        <span style={{fontSize:14}}>{t.icon}</span>
                                        <span style={{fontSize:F.xs,fontWeight:700,color:TEXT,flex:1}}>{t.label}</span>
                                        <span style={{fontSize:F.xs,fontWeight:700,color:tColor}}>
                                          {!hasTested ? '⬜ No data' : t.pass ? `✅ ${passedC}/${t.checks.filter(c=>c.pass!==null).length}` : `❌ ${passedC}/${t.checks.filter(c=>c.pass!==null).length}`}
                                        </span>
                                      </summary>
                                      <div style={{marginTop:8,borderTop:`1px solid ${BORDER}`,paddingTop:6}}>
                                        {t.checks.map((c,ci)=>(
                                          <div key={ci} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'3px 0'}}>
                                            <span style={{fontSize:12,flexShrink:0,marginTop:1}}>
                                              {c.pass===true?'✅':c.pass===false?'❌':'⬜'}
                                            </span>
                                            <div>
                                              <div style={{fontSize:F.xs,fontWeight:600,color:c.pass===true?GREEN:c.pass===false?RED:MUTED}}>{c.label}</div>
                                              <div style={{fontSize:10,color:`${MUTED}CC`,lineHeight:1.4}}>{c.detail}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </details>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
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
    // Load saved checks
    let savedChecks: Record<string,boolean> = {};
    try{ savedChecks = JSON.parse(localStorage.getItem(`mb3_checks_${sym}`)||'{}'); } catch{}
    // Auto-tick items where autoPass fires for this stock
    const stock = excelRows.find(r => r.symbol.toUpperCase() === sym.toUpperCase());
    if (stock) {
      for (const item of CHECKLIST) {
        if (item.autoField && item.autoPass) {
          const val = stock[item.autoField as keyof ExcelResult];
          if (val !== undefined) {
            savedChecks[item.id] = item.autoPass(val as number, stock);
          }
        }
      }
      localStorage.setItem(`mb3_checks_${sym}`, JSON.stringify(savedChecks));
    }
    setChecks(savedChecks);
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
// USA MULTIBAGGER SYSTEM — TradingView CSV format
// Framework: Revenue Acceleration + Gross Margin + FCF Quality + US Valuation
// ═══════════════════════════════════════════════════════════════════════════════

// Excel serial date → readable string (TradingView exports dates as serial numbers)
function usaSerialDate(v: unknown): string | undefined {
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

interface USARow {
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
  insiderOwnership?: number;      // Insider ownership % — US promoter proxy
  analystCount?: number;          // Number of analyst estimates — low = undiscovered
  forwardRevGrowth?: number;      // Forward revenue growth %, FY1 — visibility
  // Derived
  revenueAccel?: number;          // revenueGrowthQtr - revenueGrowthAnn
  accelSignal?: 'ACCELERATING'|'STABLE'|'DECELERATING';
  marketCapB?: number;            // marketCapUsd / 1e9 (in billions)
  ruleOf40?: number;              // revenueGrowthAnn + fcfMarginAnn (≥40 = excellent)
  grossMarginExpansion?: number;  // grossMarginTtm - grossMarginAnn (positive = expanding)
}
type USAGrade = 'A+'|'A'|'B+'|'B'|'C'|'D';

// US Sector benchmarks: [p25, median, p75]
const USA_BENCH: Record<string, { gm: number[]; opm: number[]; fcf: number[]; revGrowth: number[]; evEbitda: number[] }> = {
  'Electronic technology': { gm:[45,58,72], opm:[15,25,38], fcf:[10,22,35], revGrowth:[10,20,40], evEbitda:[20,35,60] },
  'Technology services':   { gm:[60,72,85], opm:[15,22,34], fcf:[12,20,32], revGrowth:[15,25,45], evEbitda:[25,40,70] },
  'Health technology':     { gm:[50,65,80], opm:[10,18,30], fcf:[8,16,28],  revGrowth:[8,15,28],  evEbitda:[18,28,50] },
  'Finance':               { gm:[30,45,60], opm:[20,30,42], fcf:[10,18,28], revGrowth:[8,15,25],  evEbitda:[12,20,35] },
  'Consumer durables':     { gm:[30,42,55], opm:[10,18,28], fcf:[6,14,24],  revGrowth:[8,15,28],  evEbitda:[15,25,40] },
  DEFAULT:                 { gm:[35,50,65], opm:[10,20,32], fcf:[8,16,28],  revGrowth:[10,20,35], evEbitda:[18,30,50] },
};
function getUSABench(sector: string) {
  const s = sector.toLowerCase();
  if (s.includes('electronic') || s.includes('semiconductor')) return USA_BENCH['Electronic technology'];
  if (s.includes('tech')) return USA_BENCH['Technology services'];
  if (s.includes('health') || s.includes('pharma') || s.includes('bio')) return USA_BENCH['Health technology'];
  if (s.includes('finance') || s.includes('bank') || s.includes('insur')) return USA_BENCH['Finance'];
  if (s.includes('consumer') || s.includes('retail')) return USA_BENCH['Consumer durables'];
  return USA_BENCH.DEFAULT;
}

function svUS(v: number|undefined, bench: number[], hiGood=true): number {
  if (v===undefined||v===null||isNaN(v as number)) return 0;
  const [lo,mid,hi] = hiGood ? bench : bench.map(x=>-x);
  const val = hiGood ? v : -v;
  if (val>=hi) return Math.min(100, 88+(val-hi)*0.4);
  if (val>=mid) return 72+((val-mid)/(hi-mid))*16;
  if (val>=lo) return 50+((val-lo)/(mid-lo))*22;
  return Math.max(0, 30+Math.max(0,val)/Math.max(lo,1)*20);
}

function scoreUSARow(row: USARow): USARow & { score: number; grade: USAGrade; coverage: number; strengths: string[]; risks: string[]; pillarScores: {id:string;label:string;score:number;color:string}[] } {
  const b = getUSABench(row.sector);
  const strengths: string[] = [];
  const risks: string[] = [];

  // ── QUALITY (30%): Gross Margin, FCF Margin, OPM, ROE ──────────────────────
  let qualS=0, qualC=0;
  if (row.grossMarginAnn !== undefined) {
    const s=svUS(row.grossMarginAnn,b.gm); qualS+=s; qualC++;
    if (s>=80) strengths.push(`Gross margin ${row.grossMarginAnn.toFixed(1)}% — pricing power, durable moat`);
    else if (s<45) risks.push(`Gross margin ${row.grossMarginAnn.toFixed(1)}% — thin, limited pricing power`);
  }
  if (row.fcfMarginAnn !== undefined) {
    const s = row.fcfMarginAnn>=25?92:row.fcfMarginAnn>=15?82:row.fcfMarginAnn>=8?65:row.fcfMarginAnn>=0?45:20;
    qualS+=s; qualC++;
    if (row.fcfMarginAnn>=15) strengths.push(`FCF margin ${row.fcfMarginAnn.toFixed(1)}% — strong cash generation`);
    else if (row.fcfMarginAnn<0) risks.push(`Negative FCF margin — burning cash`);
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
  const ruleOf40 = row.ruleOf40;
  if (ruleOf40 !== undefined) {
    if (ruleOf40 >= 60) strengths.push(`🏆 Rule of 40: ${ruleOf40.toFixed(0)} — elite (Rev ${(row.revenueGrowthAnn??0).toFixed(0)}% + FCF ${(row.fcfMarginAnn??0).toFixed(0)}%)`);
    else if (ruleOf40 >= 40) strengths.push(`✅ Rule of 40: ${ruleOf40.toFixed(0)} — passes institutional benchmark (≥40)`);
    else if (ruleOf40 < 20) risks.push(`⚠️ Rule of 40: ${ruleOf40.toFixed(0)} — below threshold (need ≥40 for premium multiple)`);
  }

  // ── GROWTH (25%): Revenue Annual + Quarterly + 3yr CAGR ──────────────────────
  let growS=0, growC=0;
  if (row.revenueGrowthAnn !== undefined) {
    const s=svUS(row.revenueGrowthAnn,b.revGrowth); growS+=s; growC++;
    if (s>=80) strengths.push(`Revenue growth ${row.revenueGrowthAnn.toFixed(1)}% YoY — strong compounding`);
    // 🚨 Growth Quality Filter — ≥20% for US multibaggers
    if (row.revenueGrowthAnn < 20) {
      const penalty = row.revenueGrowthAnn < 10 ? 25 : 12;
      growS = Math.max(0, growS - penalty);
      risks.push(`🚨 Growth filter: ${row.revenueGrowthAnn.toFixed(1)}% annual revenue growth${row.revenueGrowthAnn < 10 ? ' — very low for US multibagger (−25)' : ' — below 20% threshold (−12)'}`);
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
  }
  // PEG ratio — best growth-adjusted valuation check
  if (row.peg !== undefined && row.peg > 0) {
    const pegS = row.peg<0.8?92:row.peg<1.2?82:row.peg<2.0?65:row.peg<3.0?45:25;
    valComponents.push(pegS);
    if (row.peg<1.0) strengths.push(`PEG ${row.peg.toFixed(2)} — undervalued relative to growth rate`);
    else if (row.peg>3.0) risks.push(`PEG ${row.peg.toFixed(2)} — expensive relative to growth rate`);
  }
  // Forward revenue growth — visibility premium
  if (row.forwardRevGrowth !== undefined) {
    if (row.forwardRevGrowth >= 25) { valComponents.push(78); strengths.push(`Forward revenue growth ${row.forwardRevGrowth.toFixed(0)}% FY1 — analysts see continued acceleration`); }
    else if (row.forwardRevGrowth >= 15) valComponents.push(62);
    else if (row.forwardRevGrowth < 10) { valComponents.push(35); risks.push(`Forward revenue growth ${row.forwardRevGrowth.toFixed(0)}% — analysts expect slowdown`); }
  }
  const valS = valComponents.length > 0 ? valComponents.reduce((a,b)=>a+b,0)/valComponents.length : 50;

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
  if (row.perf1y !== undefined && row.perf1y > 20) { mktS = Math.min(100, mktS+6); strengths.push(`+${row.perf1y.toFixed(0)}% past year — momentum confirming fundamentals`); }
  const tailwind = getSectorTailwind(row.sector);
  if (tailwind.score >= 70) { mktS = Math.min(100, mktS+6); strengths.push(`Sector tailwind (${tailwind.label}): ${tailwind.drivers.slice(0,50)}`); }

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

  const filledFields = [row.revenueGrowthAnn, row.grossMarginAnn, row.fcfMarginAnn, row.opmTtm, row.roe, row.evEbitda, row.pe||row.forwardPe, row.marketCapUsd, row.netDebtUsd, row.revenueGrowthQtr, row.epsGrowth, row.roic, row.ruleOf40].filter(v=>v!==undefined).length;
  const coverage = Math.min(100, Math.round(filledFields/13*100));

  const raw = qual*0.30 + growth*0.25 + accel*0.20 + val*0.15 + mkt*0.10;
  let score = Math.max(0, Math.min(100, Math.round(raw/5)*5));

  // Grade
  const grade: USAGrade = score>=90?'A+':score>=80?'A':score>=68?'B+':score>=55?'B':score>=42?'C':'D';

  // Recompute derived fields every time — fixes stale localStorage data where
  // these were undefined because they were added after the original upload.
  const computedRuleOf40 = (row.revenueGrowthAnn !== undefined && row.fcfMarginAnn !== undefined)
    ? Math.round(row.revenueGrowthAnn + row.fcfMarginAnn)
    : row.ruleOf40;
  const computedGMExpansion = (row.grossMarginTtm !== undefined && row.grossMarginAnn !== undefined)
    ? Math.round((row.grossMarginTtm - row.grossMarginAnn) * 10) / 10
    : row.grossMarginExpansion;

  return {
    ...row,
    score, grade, coverage,
    ruleOf40: computedRuleOf40,
    grossMarginExpansion: computedGMExpansion,
    revenueAccel: revAccel,
    accelSignal: revAccel !== undefined ? (revAccel>=5?'ACCELERATING':revAccel<=-5?'DECELERATING':'STABLE') : row.accelSignal,
    marketCapB: row.marketCapUsd !== undefined ? Math.round(row.marketCapUsd/1e9*100)/100 : row.marketCapB,
    strengths, risks,
    pillarScores: [
      {id:'QUALITY',   label:'Quality',    score:Math.round(qual),   color:'#a78bfa'},
      {id:'GROWTH',    label:'Growth',     score:Math.round(growth), color:'#38bdf8'},
      {id:'ACCEL',     label:'Accel',      score:Math.round(accel),  color:'#10b981'},
      {id:'VALUATION', label:'Valuation',  score:Math.round(val),    color:'#f59e0b'},
      {id:'MARKET',    label:'Market',     score:Math.round(mkt),    color:'#f97316'},
    ],
  };
}

type USAResult = ReturnType<typeof scoreUSARow>;

function applyUSARanking(results: USAResult[]): USAResult[] {
  if (!results.length) return results;
  const n = results.length;
  return results.map((r, idx) => {
    const pct = idx / n;
    let grade: USAGrade =
      pct < 0.10 ? 'A+' : pct < 0.28 ? 'A' : pct < 0.55 ? 'B+' : pct < 0.75 ? 'B' : pct < 0.88 ? 'C' : 'D';
    // Hard caps — mathematically derived
    // $150B+ = cannot 100× realistically (PLTR $349B, NVDA $3T etc.)
    if (r.marketCapB !== undefined && r.marketCapB > 150 && ['A+','A'].includes(grade)) grade = 'B+';
    if (r.marketCapB !== undefined && r.marketCapB > 500 && grade === 'B+') grade = 'B';
    if (r.revenueGrowthAnn !== undefined && r.revenueGrowthAnn < 10 && ['A+','A'].includes(grade)) grade = 'B+';
    if (r.accelSignal === 'DECELERATING' && ['A+','A'].includes(grade)) grade = 'B+';
    return { ...r, grade };
  });
}

function parseUSARow(row: Record<string,unknown>): USARow | null {
  const n = (v: unknown): number|undefined => {
    if (v===''||v===null||v===undefined) return undefined;
    const parsed = parseFloat(String(v).replace(/[,$%]/g,''));
    return isNaN(parsed) ? undefined : parsed;
  };
  const sym = String(row['Symbol']??'').trim().toUpperCase();
  if (!sym) return null;
  const mcapRaw = n(row['Market capitalization']);
  const cashRaw = n(row['Cash & equivalents, Annual']);
  const ltDebtRaw = n(row['Long term debt, Annual']);
  const netDebtRaw = n(row['Net debt, Annual']);
  const revQtr = n(row['Revenue growth %, Quarterly YoY']);
  const revAnn = n(row['Revenue growth %, Annual YoY']);
  return {
    symbol: sym,
    company: String(row['Description']??'').trim(),
    sector:  String(row['Sector']??'').trim() || 'Technology services',
    exchange: String(row['Exchange']??'').trim(),
    marketCapUsd: mcapRaw,
    marketCapB: mcapRaw !== undefined ? Math.round(mcapRaw/1e9*100)/100 : undefined,
    revenueGrowthQtr: revQtr,
    revenueGrowthAnn: revAnn,
    grossMarginAnn:   n(row['Gross margin %, Annual']),
    fcfMarginAnn:     n(row['Free cash flow margin %, Annual']),
    grossProfitGrowthQtr: n(row['Gross profit growth %, Quarterly YoY']),
    pe:          n(row['Price to earnings ratio']),
    forwardPe:   n(row['Forward non-GAAP price to earnings, Annual']),
    netDebtUsd:  netDebtRaw,
    evEbitda:    n(row['Enterprise value to EBITDA ratio, Trailing 12 months']),
    evRevenue:   n(row['Enterprise value to revenue ratio, Trailing 12 months']),
    ps:          n(row['Price to sales ratio']),
    opmTtm:      n(row['Operating margin %, Trailing 12 months']),
    pb:          n(row['Price to book ratio']),
    roe:         n(row['Return on equity %, Trailing 12 months']),
    cashUsd:     cashRaw,
    ltDebtUsd:   ltDebtRaw,
    // Fix: TradingView exports dates as Excel serial numbers (e.g. 46148.08 = May 4 2026)
    nextEarnings: usaSerialDate(row['Upcoming earnings date']),
    // Optional extra fields — maps both TradingView exact names AND common variants
    epsGrowth: n(
      row['Earnings per share diluted growth %, TTM YoY'] ??   // TradingView exact
      row['EPS diluted growth %, TTM YoY'] ??
      row['EPS growth %, TTM YoY']
    ),
    roic: n(
      row['Return on invested capital %, Annual'] ??            // TradingView exact
      row['ROIC']
    ),
    de: n(
      row['Debt to equity ratio, Quarterly'] ??                 // TradingView exact
      row['Debt / equity ratio'] ??
      row['Debt to equity ratio']
    ),
    netProfitMargin: n(
      row['Net margin %, Trailing 12 months'] ??                // TradingView exact
      row['Net profit margin %, TTM'] ??
      row['Net profit margin %, Annual']
    ),
    perf1y: n(
      row['Performance % 1 year'] ??                            // TradingView exact
      row['Performance, 1 Year %'] ??
      row['1-year performance %'] ??
      row['Perf.Y']
    ),
    pctFrom52wHigh: n(
      row['Change from 52-week high, %'] ??
      row['% from 52W high'] ??
      row['Change from 52W High']
    ),
    // New fields — add these in TradingView for better scoring
    revGrowth3yr: n(
      row['Revenue growth %, 3-year CAGR'] ??
      row['Revenue 3-year CAGR, %'] ??
      row['Revenue growth %, 3 year CAGR']
    ),
    grossMarginTtm: n(
      row['Gross margin %, TTM'] ??
      row['Gross margin %, Trailing 12 months']
    ),
    peg: n(
      row['Price to earnings growth ratio'] ??
      row['PEG ratio'] ??
      row['PEG']
    ),
    insiderOwnership: n(
      row['Insider ownership, %'] ??
      row['Insider ownership %'] ??
      row['Insider Ownership, %']
    ),
    analystCount: n(
      row['Number of analyst estimates'] ??
      row['Analyst ratings'] ??
      row['Analysts']
    ),
    forwardRevGrowth: n(
      row['Forward revenue growth %, FY1'] ??
      row['Revenue growth %, next year'] ??
      row['Revenue growth est., next fiscal year, %']
    ),
    // Derived at parse time
    revenueAccel: (revQtr !== undefined && revAnn !== undefined) ? Math.round(revQtr - revAnn) : undefined,
    accelSignal: (revQtr !== undefined && revAnn !== undefined)
      ? (revQtr - revAnn >= 5 ? 'ACCELERATING' : revQtr - revAnn <= -5 ? 'DECELERATING' : 'STABLE')
      : undefined,
    // Rule of 40 = revenue growth + FCF margin (≥40 = institutional benchmark)
    ruleOf40: (revAnn !== undefined && n(row['Free cash flow margin %, Annual']) !== undefined)
      ? Math.round(revAnn + (n(row['Free cash flow margin %, Annual']) as number))
      : undefined,
    // Gross margin expansion = TTM vs Annual (positive = improving pricing power)
    grossMarginExpansion: (() => {
      const ttm = n(row['Gross margin %, TTM'] ?? row['Gross margin %, Trailing 12 months']);
      const ann = n(row['Gross margin %, Annual']);
      return (ttm !== undefined && ann !== undefined) ? Math.round((ttm - ann) * 10) / 10 : undefined;
    })(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// USA RESEARCH CHECKLIST — 28 criteria covering US multibagger framework
// Fisher 100-Bagger + MOSL SQGLP adapted for US growth stocks + Rule of 40
// ═══════════════════════════════════════════════════════════════════════════════

interface USAChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number; source: string;
}

const USA_CHECKLIST: USAChecklistItem[] = [
  // ── QUALITY / MOAT ────────────────────────────────────────────────────────
  { id:'us_gm', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'Fisher + SaaS benchmark',
    label:'Gross Margin ≥ 60% (software) or ≥ 50% (semis/hardware)', target:'Software: >65% elite · Hardware: >50% · <35% = weak moat',
    why:'Gross margin is the first test of pricing power. High GM = durable competitive advantage. Google 55%, NVDA 74%, AAPL 46%. Below 35% = no moat.' },
  { id:'us_gm_expand', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Institutional standard',
    label:'Gross Margin expanding QoQ / TTM vs Annual (direction > absolute)', target:'TTM GM > Annual GM = pricing power strengthening',
    why:'A rising GM trend proves the moat is durably improving, not just high. The direction is more important than the level for predicting future multiples.' },
  { id:'us_fcf', pillar:'QUALITY', pillarColor:'#a78bfa', weight:8, source:'Fisher + Buffett',
    label:'FCF Margin ≥ 15% AND positive (free cash machine)', target:'>25% = excellent · >15% = good · <0% = risk',
    why:'US tech multibaggers are defined by FCF generation. NVDA 55% FCF margin, MSFT 29%. FCF funds buybacks, R&D, M&A without dilution.' },
  { id:'us_roe', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Buffett',
    label:'ROE ≥ 20% consistently (without excessive leverage)', target:'>30% = exceptional · >20% = good · <10% = weak',
    why:'Buffett rule: ROE > 20% without leverage = true earnings power. With leverage = false signal.' },
  { id:'us_roic', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7, source:'Fisher ROIC test',
    label:'ROIC ≥ 15% AND stable or rising (not diluting from new investments)', target:'>20% = moat confirmed · 10–20% = acceptable · <10% = below WACC',
    why:"Fisher key test: 'Does new capital earn at least as much as legacy capital?' Rising ROIC = each dollar invested creates more value than before." },
  { id:'us_r40', pillar:'QUALITY', pillarColor:'#a78bfa', weight:9, source:'SaaS/tech institutional benchmark',
    label:'Rule of 40: (Revenue growth% + FCF margin%) ≥ 40', target:'≥60 = elite · ≥40 = investment grade · <20 = value trap for SaaS',
    why:'The primary institutional benchmark for evaluating tech/SaaS companies. Combines growth + profitability into one number. Palantir at 78, NVDA at ~100+. BELOW 20 = no premium multiple justified.' },
  { id:'us_moat_type', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6, source:'Fisher 100-Bagger',
    label:'Moat type: network effects / switching cost / ecosystem (Tier 1)', target:'Network > Switching > Brand > Cost > Regulatory (weakest)',
    why:'Fisher: verify moat type matters more than gross margin. A 90% gross margin with zero switching costs (commoditizable) is not a moat.' },
  // ── GROWTH ────────────────────────────────────────────────────────────────
  { id:'us_revgrowth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'MOSL adapted',
    label:'Revenue CAGR ≥ 20% (3-year or annual)', target:'>30% = hypergrowth · >20% = multibagger zone · <15% = insufficient',
    why:'US multibaggers need higher base growth than India. NVDA 3yr CAGR 90%+. Palantir 24%. Rule: if a company cannot grow 20%+ annually, it cannot 10× in 5 years.' },
  { id:'us_rev_accel', pillar:'GROWTH', pillarColor:'#38bdf8', weight:9, source:'Framework core signal',
    label:'Revenue ACCELERATING: Quarterly YoY > Annual YoY (+5pp threshold)', target:'QoQ YoY % > Annual % by ≥5pp = structural acceleration',
    why:'MOST important signal for entry timing. NVDA went from 20% growth to 200% in 2023 before consensus caught on. Catch this inflection, not after.' },
  { id:'us_eps_growth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7, source:'Fisher Twin Engine',
    label:'EPS growth ≥ 20% AND faster than revenue (op leverage proof)', target:'EPS CAGR > Revenue CAGR × 1.3 = operating leverage firing',
    why:'Fisher Twin Engine: EPS growth + stable/expanding PE = compounding. EPS growing faster than revenue = operating leverage visible.' },
  { id:'us_growth_sustained', pillar:'GROWTH', pillarColor:'#38bdf8', weight:6, source:'MOSL consistency check',
    label:'3-year CAGR ≥ 15% (not a one-year spike)', target:'3yr CAGR ≥ 15% confirms sustainability. Annual/3yr ratio < 2× = not a spike.',
    why:'COVID-reopening, one-off contracts, and AI hype create fake spikes. 3yr CAGR confirms the growth is structural, not cyclical.' },
  { id:'us_gp_expansion', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5, source:'Operating leverage',
    label:'Gross profit growing faster than revenue (margin expansion real-time)', target:'Gross profit growth QoQ % > Revenue growth QoQ % = live margin expansion',
    why:'If GP grows faster than revenue, OPM will expand next quarter. Lead indicator of upcoming profitability improvement.' },
  // ── VALUATION ─────────────────────────────────────────────────────────────
  { id:'us_peg', pillar:'VALUATION', pillarColor:'#f59e0b', weight:7, source:'Fisher PEG adapted',
    label:'PEG Ratio < 1.5 (growth at reasonable price)', target:'<0.8 = exceptional · 0.8–1.5 = fair GARP · >2.5 = expensive growth',
    why:'Fisher: PEG adjusts P/E for growth rate. Paying 40× PE for 40% growth = fair (PEG=1). Paying 40× for 10% growth = expensive (PEG=4).' },
  { id:'us_ev_ebitda', pillar:'VALUATION', pillarColor:'#f59e0b', weight:6, source:'Institutional standard',
    label:'EV/EBITDA < sector median (enterprise value discipline)', target:'Tech: <35× fair · <20× cheap · >80× very expensive',
    why:'EV/EBITDA is capital-structure neutral — works even with buybacks, debt, or net-cash. More reliable than P/E for comparing companies.' },
  { id:'us_fwd_pe', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5, source:'Growth investing',
    label:'Forward P/E < 40× (or justified by growth trajectory)', target:'<25× = cheap · 25–40× = fair growth premium · >80× = requires exceptional execution',
    why:'Forward PE anchors valuation to expected earnings. NVDA at 25× fwd PE in 2023 was cheap for 400% EPS growth ahead. Context matters.' },
  { id:'us_mcap', pillar:'VALUATION', pillarColor:'#f59e0b', weight:8, source:'MOSL SQGLP adapted',
    label:'Market Cap $1B–$50B = multibagger runway zone', target:'$1–5B = maximum runway · $5–50B = solid runway · >$150B = limited 10× potential',
    why:'MOSL: sheer size militates against great growth. A $1B company can 100× to $100B. A $300B company needs to become $30T. Focus on $1–50B.' },
  // ── BALANCE SHEET ─────────────────────────────────────────────────────────
  { id:'us_debt', pillar:'BALANCE SHEET', pillarColor:'#10b981', weight:6, source:'Fisher survival filter',
    label:'D/E ≤ 0.5 (low leverage = resilience in downturns)', target:'D/E < 0.5 = clean · <1.0 = acceptable · >2.0 = existential risk in rate hikes',
    why:'US tech cycles can be brutal. High leverage during 2022 rate cycle destroyed companies. D/E < 0.5 = survives any cycle.' },
  { id:'us_net_cash', pillar:'BALANCE SHEET', pillarColor:'#10b981', weight:5, source:'Buffett',
    label:'Net cash position OR ND/EBITDA < 1.5', target:'Net cash = maximum flexibility · ND/EBITDA < 1.0 = safe · >3.0 = CRITICAL',
    why:'Net cash = can fund growth internally, return capital, make acquisitions. Best companies self-fund.' },
  // ── DISCOVERY / SQGLP "S" ─────────────────────────────────────────────────
  { id:'us_discovery', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:8, source:'MOSL SQGLP "S" adapted',
    label:'Analyst coverage ≤ 10 (undiscovered = institutional re-rating ahead)', target:'≤5 = essentially undiscovered · ≤12 = early · >30 = fully discovered, alpha gone',
    why:'MOSL: low institutional holding = undiscovered. US equivalent = low analyst coverage. When Goldman/MS initiate coverage, the re-rating happens. Be there first.' },
  { id:'us_insider', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:6, source:'Fisher insider signal',
    label:'Insider ownership ≥ 10% (management skin in game)', target:'>20% = strong alignment · 10–20% = good · <2% = watch carefully',
    why:'Fisher Scuttlebutt: insiders who own significant equity behave differently. Founder-led companies with 15%+ insider ownership consistently outperform.' },
  { id:'us_fwd_growth', pillar:'DISCOVERY', pillarColor:'#06b6d4', weight:5, source:'Forward visibility',
    label:'Forward revenue growth ≥ 20% FY1 (analysts confirm acceleration continues)', target:'>25% = analysts highly confident · <10% = slowdown expected',
    why:'Forward guidance from management + analyst consensus. If consensus sees 25%+ growth ahead, institutional money will follow.' },
  // ── TECHNICAL / MARKET ────────────────────────────────────────────────────
  { id:'us_technical', pillar:'TECHNICAL', pillarColor:'#f97316', weight:5, source:'MOSL price action',
    label:'Price above DMA200 OR within 20% (trend not broken)', target:'Above = uptrend intact · 0 to -20% = consolidating · >-30% = wait for reversal',
    why:'Price action validates fundamental thesis. 100-baggers rarely give long entry windows below DMA200.' },
  { id:'us_52wk', pillar:'TECHNICAL', pillarColor:'#f97316', weight:4, source:'Relative strength',
    label:'Near 52-week high (within 10%) = price confirming thesis', target:'0 to -10% = institutional buying confirmed · <-40% = requires deep dive',
    why:'When fundamentals are accelerating AND price is making new highs, institutions are actively buying. Breakout patterns precede the biggest moves.' },
  { id:'us_perf1y', pillar:'TECHNICAL', pillarColor:'#f97316', weight:3, source:'Momentum',
    label:'1-year performance > 20% (momentum confirming fundamentals)', target:'>50% = exceptional momentum · >20% = positive · Negative = wait for catalyst',
    why:'Price reflects accumulated fundamental insight. Strong 1-year performance with accelerating fundamentals = thesis intact, market agreeing.' },
  // ── SECTOR / TAILWIND ────────────────────────────────────────────────────
  { id:'us_tailwind', pillar:'SECTOR', pillarColor:'#8b5cf6', weight:7, source:'Fisher Stage 1',
    label:'Sector structural tailwind — NOT at cyclical peak', target:'AI infra · Defence · Healthcare IT · Fintech · Space tech = HIGH tailwind',
    why:"Fisher: 'Buy the right industry at the right cycle point.' 100-baggers ride tailwinds + execution, not execution alone. Semiconductor in AI build-out = tailwind. Crypto at peak = cyclical trap." },
  { id:'us_not_cyclical', pillar:'SECTOR', pillarColor:'#8b5cf6', weight:5, source:'Fisher Stage 1',
    label:'Not at peak cyclical moment (avoid sector top)', target:'Avoid: energy at high prices · semis at peak cycle · banks at credit peak',
    why:'Fisher: peak cyclical earnings = P/E looks cheap but earnings will collapse. Cyclical peaks are value traps disguised as value buys.' },
  // ── CATALYSTS ────────────────────────────────────────────────────────────
  { id:'us_catalyst', pillar:'CATALYST', pillarColor:'#ec4899', weight:6, source:'Framework mandatory',
    label:'Visible catalyst for re-rating in next 4–8 quarters', target:'New product launch / margin improvement / market share gain / international expansion',
    why:'Without a visible catalyst, a fundamentally good company can stay cheap for years. Identify the specific trigger that will move valuation.' },
  { id:'us_repeat', pillar:'CATALYST', pillarColor:'#ec4899', weight:5, source:'Framework final filter',
    label:'Growth repeatable for next 4–6 quarters (not one-quarter wonder)', target:"'Did this quarter materially increase probability of higher future earnings?' YES = buy",
    why:'The most important question: can this quarter structurally repeat? Framework: final filter before conviction sizing.' },
];

const USA_CHECKLIST_STORAGE = 'mb_usa_checklist_v1';

function USAChecklist() {
  const usaRows = (() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_scored_v1')||'[]') as USAResult[]; } catch { return []; }
  })();
  const [checks, setChecks] = React.useState<Record<string,boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(USA_CHECKLIST_STORAGE)||'{}'); } catch { return {}; }
  });
  const [selectedTicker, setSelectedTicker] = React.useState('');
  const [notes, setNotes] = React.useState<Record<string,string>>(() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_notes_v1')||'{}'); } catch { return {}; }
  });

  const selRow = usaRows.find(r => r.symbol === selectedTicker);

  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    localStorage.setItem(USA_CHECKLIST_STORAGE, JSON.stringify(next));
  }
  function updateNote(id: string, v: string) {
    const next = { ...notes, [id]: v };
    setNotes(next);
    localStorage.setItem('mb_usa_notes_v1', JSON.stringify(next));
  }

  const pillars = [...new Set(USA_CHECKLIST.map(c=>c.pillar))];
  const passed = USA_CHECKLIST.filter(c=>checks[c.id]).length;
  const total  = USA_CHECKLIST.length;
  const weightedPass = USA_CHECKLIST.filter(c=>checks[c.id]).reduce((s,c)=>s+c.weight,0);
  const weightedTotal = USA_CHECKLIST.reduce((s,c)=>s+c.weight,0);

  // Auto-check from scored data when ticker selected
  // Returns true/false for items with data, null for missing columns or qualitative items.
  // CRITICAL: optional fields (user hasn't added column) MUST return null not false.
  const autoStatus = (r: USAResult, id: string): boolean | null => {
    switch(id) {
      // ── Always available in base TradingView export ───────────────────────
      case 'us_gm':        return r.grossMarginAnn !== undefined ? r.grossMarginAnn >= 50 : null;
      case 'us_fcf':       return r.fcfMarginAnn !== undefined ? r.fcfMarginAnn >= 15 : null;
      case 'us_revgrowth': return r.revenueGrowthAnn !== undefined ? r.revenueGrowthAnn >= 20 : null;
      case 'us_rev_accel': return r.accelSignal !== undefined ? r.accelSignal === 'ACCELERATING' : null;
      case 'us_ev_ebitda': return r.evEbitda !== undefined ? r.evEbitda < 40 : null;
      case 'us_fwd_pe':    return r.forwardPe !== undefined && r.forwardPe > 0 ? r.forwardPe < 45 : null;
      case 'us_mcap':      return r.marketCapB !== undefined ? r.marketCapB < 50 : null;
      case 'us_net_cash':  return r.netDebtUsd !== undefined ? r.netDebtUsd <= 0 : null;
      // ── Computed from base export (recomputed in scoreUSARow now) ─────────
      case 'us_r40':       return r.ruleOf40 !== undefined ? r.ruleOf40 >= 40 : null;
      case 'us_gm_expand': return r.grossMarginExpansion !== undefined ? r.grossMarginExpansion > 0 : null;
      case 'us_gp_expand': return (r.grossProfitGrowthQtr !== undefined && r.revenueGrowthQtr !== undefined)
                               ? r.grossProfitGrowthQtr > r.revenueGrowthQtr : null;
      // ── Optional: user must add column to TradingView export ─────────────
      case 'us_roe':       return r.roe !== undefined ? r.roe >= 20 : null;
      case 'us_roic':      return r.roic !== undefined ? r.roic >= 15 : null;
      case 'us_eps_growth': return r.epsGrowth !== undefined ? r.epsGrowth >= 20 : null;
      case 'us_growth_sustained': return r.revGrowth3yr !== undefined ? r.revGrowth3yr >= 15 : null;
      case 'us_peg':       return r.peg !== undefined && r.peg > 0 ? r.peg < 1.5 : null;
      case 'us_debt':      return r.de !== undefined ? r.de <= 0.5 : null;
      case 'us_discovery': return r.analystCount !== undefined ? r.analystCount <= 10 : null;
      case 'us_insider':   return r.insiderOwnership !== undefined ? r.insiderOwnership >= 10 : null;
      case 'us_fwd_growth': return r.forwardRevGrowth !== undefined ? r.forwardRevGrowth >= 20 : null;
      case 'us_technical': return r.pctFrom52wHigh !== undefined ? r.pctFrom52wHigh >= -20 : null;
      case 'us_52wk':      return r.pctFrom52wHigh !== undefined ? r.pctFrom52wHigh >= -10 : null;
      case 'us_perf1y':    return r.perf1y !== undefined ? r.perf1y >= 20 : null;
      // ── Qualitative — user must assess manually ───────────────────────────
      default: return null;
    }
  };

  // Auto-tick all auto-determinable items when ticker changes
  // FIX: "if auto-pass it should be ticked already" — auto-pass = auto-check
  const applyAutoChecks = (row: USAResult) => {
    const autoUpdates: Record<string, boolean> = {};
    for (const item of USA_CHECKLIST) {
      const result = autoStatus(row, item.id);
      if (result !== null) autoUpdates[item.id] = result; // tick=true for pass, untick=false for fail
    }
    setChecks(prev => {
      // Qualitative items (result===null) keep manual state; auto items get overridden
      const merged = { ...prev, ...autoUpdates };
      localStorage.setItem(USA_CHECKLIST_STORAGE, JSON.stringify(merged));
      return merged;
    });
  };

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:F.h2,fontWeight:800,color:'#38bdf8',marginBottom:4}}>🇺🇸 USA Research Checklist</div>
          <div style={{fontSize:F.md,color:MUTED}}>{total} criteria · Fisher 100-Bagger + MOSL SQGLP adapted + Rule of 40</div>
        </div>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          {usaRows.length > 0 && (
            <select value={selectedTicker} onChange={e=>{
              const ticker = e.target.value;
              setSelectedTicker(ticker);
              if (ticker) {
                const row = usaRows.find(r => r.symbol === ticker);
                if (row) applyAutoChecks(row);
              }
            }}
              style={{padding:'8px 14px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:8,color:TEXT,fontSize:F.sm,cursor:'pointer'}}>
              <option value=''>Select stock — auto-ticks all checkable items...</option>
              {usaRows.slice(0,20).map(r=><option key={r.symbol} value={r.symbol}>{r.symbol} — {r.grade} ({r.score})</option>)}
            </select>
          )}
          <div style={{padding:'10px 18px',backgroundColor:passed>=20?`${GREEN}18`:passed>=12?`${YELLOW}18`:`${RED}18`,border:`1px solid ${passed>=20?GREEN:passed>=12?YELLOW:RED}30`,borderRadius:10,textAlign:'center'}}>
            <div style={{fontSize:F.h2,fontWeight:900,color:passed>=20?GREEN:passed>=12?YELLOW:RED}}>{passed}/{total}</div>
            <div style={{fontSize:F.xs,color:MUTED}}>checked · {Math.round(weightedPass/weightedTotal*100)}% weighted</div>
          </div>
        </div>
      </div>

      {pillars.map(pillar => {
        const items = USA_CHECKLIST.filter(c=>c.pillar===pillar);
        const pPassed = items.filter(c=>checks[c.id]).length;
        const pColor = items[0].pillarColor;
        return (
          <div key={pillar} style={{marginBottom:24}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,borderBottom:`1px solid ${BORDER}`,paddingBottom:8}}>
              <span style={{fontSize:F.md,fontWeight:800,color:pColor,letterSpacing:'0.5px'}}>{pillar}</span>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:600}}>{pPassed}/{items.length} checked</span>
              <div style={{flex:1,height:4,backgroundColor:`rgba(255,255,255,0.06)`,borderRadius:2}}>
                <div style={{height:'100%',width:`${pPassed/items.length*100}%`,backgroundColor:pColor,borderRadius:2,transition:'width 0.3s'}}/>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(460px,1fr))',gap:10}}>
              {items.map(item => {
                const auto = selRow ? autoStatus(selRow, item.id) : null;
                const checked = checks[item.id] ?? false;
                const note = notes[item.id] ?? '';
                return (
                  <div key={item.id} style={{
                    padding:'14px 16px',backgroundColor:checked?`${pColor}08`:CARD_BG,
                    border:`1px solid ${checked?pColor+'40':BORDER}`,
                    borderLeft:`3px solid ${checked?pColor:auto===true?`${pColor}60`:auto===false?`${RED}40`:BORDER}`,
                    borderRadius:8,transition:'all 0.15s',
                  }}>
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <button onClick={()=>toggleCheck(item.id)} style={{
                        width:22,height:22,borderRadius:5,border:`2px solid ${checked?pColor:BORDER}`,
                        backgroundColor:checked?pColor:'transparent',flexShrink:0,marginTop:2,cursor:'pointer',
                        display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:14,
                      }}>{checked?'✓':''}</button>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{fontSize:F.md,fontWeight:700,color:checked?TEXT:`${TEXT}CC`}}>{item.label}</span>
                          <span style={{fontSize:F.xs,color:MUTED}}>w:{item.weight}</span>
                          {auto !== null && (
                            <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:10,
                              backgroundColor:auto?`${GREEN}18`:`${RED}18`,color:auto?GREEN:RED}}>
                              {auto?'✅ data confirms':'❌ data fails'}
                            </span>
                          )}
                          {auto === null && selRow && (
                            <span style={{fontSize:10,color:MUTED,padding:'2px 6px',borderRadius:10,backgroundColor:`${MUTED}10`}}>
                              ⬜ no data / qualitative
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:F.xs,color:YELLOW,marginBottom:4}}>🎯 {item.target}</div>
                        <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{item.why}</div>
                        <div style={{fontSize:F.xs,color:`${MUTED}70`,marginTop:3}}>Source: {item.source}</div>
                        <textarea
                          value={note}
                          onChange={e=>updateNote(item.id,e.target.value)}
                          placeholder="Your notes..."
                          rows={1}
                          style={{width:'100%',marginTop:6,backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:6,padding:'6px 10px',color:MUTED,fontSize:F.xs,resize:'none',boxSizing:'border-box'}}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const USA_STORAGE_KEY = 'mb_usa_scored_v1';

function USACompare() {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [rows, setRowsState] = React.useState<USAResult[]>(() => {
    try {
      const saved = localStorage.getItem(USA_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as USAResult[];
        const rescored = parsed.map(r => scoreUSARow(r as unknown as USARow));
        return applyUSARanking(rescored.sort((a,b)=>b.score-a.score));
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = React.useState(false);
  const [parseError, setParseError] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [expRow, setExpRow] = React.useState<string|null>(null);
  const [expandAll, setExpandAll] = React.useState(false);
  const [gradeFilter, setGradeFilter] = React.useState<Set<string>>(new Set(['ALL']));
  const [accelOnly, setAccelOnly] = React.useState(false);

  function setRows(r: USAResult[]) {
    const ranked = applyUSARanking(r);
    setRowsState(ranked);
    try { localStorage.setItem(USA_STORAGE_KEY, JSON.stringify(ranked)); } catch {}
  }

  async function handleFiles(files: FileList | File[]) {
    setParseError(''); setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const arr = Array.from(files);
      const allRows: USARow[] = [];
      const seenSymbols = new Set(rows.map(r=>r.symbol));
      for (const file of arr) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:'array' });
        const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]], { defval:'' });
        for (const r of raw) {
          const parsed = parseUSARow(r as Record<string,unknown>);
          if (!parsed || seenSymbols.has(parsed.symbol)) continue;
          seenSymbols.add(parsed.symbol);
          allRows.push(parsed);
        }
      }
      if (!allRows.length) { setParseError('No valid rows found. Ensure the file has a Symbol column.'); setLoading(false); return; }
      const scored = allRows.map(r => scoreUSARow(r));
      const merged = [...rows, ...scored].sort((a,b)=>b.score-a.score);
      setRows(merged);
      setFileName(`${arr.length} file${arr.length>1?'s':''} · ${merged.length} stocks`);
    } catch(e) { setParseError(`Error: ${e instanceof Error?e.message:String(e)}`); }
    setLoading(false);
  }

  const GRADES: USAGrade[] = ['A+','A','B+','B','C','D'];
  const GRADE_COLOR_US: Record<USAGrade,string> = {'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444'};
  let filtered = gradeFilter.has('ALL') ? rows : rows.filter(r=>gradeFilter.has(r.grade));
  if (accelOnly) filtered = filtered.filter(r=>r.accelSignal==='ACCELERATING');

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px'}}>
      {/* Header */}
      <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
        <div style={{fontSize:F.lg,fontWeight:800,color:'#38bdf8',marginBottom:8}}>🇺🇸 USA Multibagger — TradingView Export</div>
        <div style={{fontSize:F.md,color:MUTED,lineHeight:1.8,marginBottom:12}}>
          Export from TradingView Screener as CSV and upload. All columns auto-detected.
          <span style={{color:YELLOW}}> Recommended extra columns to add:</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
          {[
            {field:'EPS diluted growth %, TTM YoY', why:'Profit growth — Fisher Twin Engine ✅ added'},
            {field:'Return on invested capital %, Annual', why:'ROIC — capital efficiency ✅ added'},
            {field:'Debt to equity ratio, Quarterly', why:'Leverage ✅ added'},
            {field:'Net margin %, Trailing 12 months', why:'Net profitability ✅ added'},
            {field:'Performance % 1 year', why:'Momentum ✅ added'},
            {field:'Revenue growth %, 3-year CAGR', why:'🆕 Sustained growth vs spike check'},
            {field:'Gross margin %, TTM', why:'🆕 Margin expansion signal (TTM vs Annual)'},
            {field:'Price to earnings growth ratio', why:'🆕 PEG — growth-adjusted valuation'},
            {field:'Insider ownership, %', why:'🆕 US promoter proxy — management skin in game'},
            {field:'Number of analyst estimates', why:'🆕 Discovery: low count = undiscovered'},
            {field:'Forward revenue growth %, FY1', why:'🆕 Visibility: analyst forward estimates'},
            {field:'Change from 52-week high, %', why:'🆕 Technical RS proxy'},
          ].map(({field,why})=>(
            <div key={field} style={{padding:'8px 12px',backgroundColor:CARD2,borderRadius:6,border:`1px solid ${BORDER}`}}>
              <div style={{fontSize:F.sm,fontWeight:700,color:ACCENT}}>{field}</div>
              <div style={{fontSize:F.xs,color:MUTED}}>{why}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upload */}
      <div
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}
        style={{marginBottom:20,padding:'32px 24px',border:`2px dashed #38bdf840`,borderRadius:14,textAlign:'center',cursor:'pointer',backgroundColor:'#38bdf805'}}
      >
        <div style={{fontSize:40,marginBottom:10}}>{loading?'⏳':'📁'}</div>
        <div style={{fontSize:F.xl,fontWeight:700,color:'#38bdf8'}}>
          {loading?'Scoring...' : fileName?`✅ ${fileName}` : 'Upload TradingView CSV'}
        </div>
        <div style={{fontSize:F.md,color:MUTED,marginTop:6}}>Export any TradingView screen · .csv · all columns auto-detected</div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" multiple style={{display:'none'}}
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);}} />
      </div>
      {parseError && <div style={{marginBottom:14,padding:'12px',backgroundColor:`${RED}10`,border:`1px solid ${RED}30`,borderRadius:10,fontSize:F.md,color:RED}}>{parseError}</div>}

      {rows.length>0&&(
        <>
          {/* Summary */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap',alignItems:'stretch'}}>
            {[
              {label:'Scored',value:rows.length,color:'#38bdf8'},
              {label:'Top Picks (B+)',value:rows.filter(r=>['A+','A','B+'].includes(r.grade)).length,color:GREEN},
              {label:'Best Score',value:rows[0]?.score??0,color:rows[0]?.score>=72?GREEN:YELLOW},
              {label:'Avg Score',value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length),color:MUTED},
            ].map(({label,value,color})=>(
              <div key={label} style={{padding:'14px 22px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:10,textAlign:'center'}}>
                <div style={{fontSize:F.h1,fontWeight:900,color}}>{value}</div>
                <div style={{fontSize:F.sm,color:MUTED,marginTop:2}}>{label}</div>
              </div>
            ))}
            <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto',flexWrap:'wrap'}}>
              {(['ALL',...GRADES] as const).map(g=>{
                const active=gradeFilter.has(g);
                const col=GRADE_COLOR_US[g as USAGrade]||'#38bdf8';
                return <button key={g} onClick={()=>{
                  if(g==='ALL'){setGradeFilter(new Set(['ALL']));return;}
                  setGradeFilter(prev=>{const n=new Set(prev);n.delete('ALL');if(n.has(g)){n.delete(g);if(n.size===0)n.add('ALL');}else n.add(g);return n;});
                }} style={{fontSize:F.sm,fontWeight:700,padding:'7px 12px',borderRadius:8,border:`1px solid ${active?col+'60':BORDER}`,background:active?col+'18':'transparent',color:active?col:MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>;
              })}
              <button onClick={()=>setAccelOnly(v=>!v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${accelOnly?GREEN+'60':BORDER}`,background:accelOnly?`${GREEN}14`:'transparent',color:accelOnly?GREEN:MUTED,cursor:'pointer'}}>
                🚀 Accelerating ({rows.filter(r=>r.accelSignal==='ACCELERATING').length})
              </button>
              <button onClick={()=>{setExpandAll(v=>!v);setExpRow(null);}} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,cursor:'pointer',border:`1px solid ${expandAll?ACCENT+'60':BORDER}`,background:expandAll?ACCENT+'14':'transparent',color:expandAll?ACCENT:MUTED}}>
                {expandAll?'⊟ Collapse All':'⊞ Expand All'}
              </button>
              <span style={{fontSize:F.xs,color:MUTED}}>{filtered.length} showing</span>
              <button onClick={()=>{ if(window.confirm(`Clear all ${rows.length} stocks?`)){setRowsState([]);localStorage.removeItem(USA_STORAGE_KEY);setFileName('');} }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${RED}40`,background:`${RED}10`,color:RED,cursor:'pointer'}}>
                🗑 Clear
              </button>
            </div>
          </div>

          {/* Table Header */}
          <div style={{display:'grid',gridTemplateColumns:'120px 150px 65px 65px 100px 110px 1fr 70px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span><span>SCORE</span><span>GRADE</span>
            <span style={{color:YELLOW}}>VALUATION</span>
            <span>ACCEL</span><span>PILLARS</span><span>COV</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expandAll||expRow===r.symbol;
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'120px 150px 65px 65px 100px 110px 1fr 70px',gap:8,alignItems:'center'}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:TEXT}}>{r.symbol}</span>
                        {idx<3&&<span style={{fontSize:F.md}}>⭐</span>}
                      </div>
                      <span style={{fontSize:F.xs,color:MUTED}}>{r.exchange}</span>
                      {r.nextEarnings&&<div style={{fontSize:9,color:'#f59e0b'}}>📅 {r.nextEarnings}</div>}
                    </div>
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company}</span>
                    <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR_US[r.grade]}}>{r.score}</span>
                    <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR_US[r.grade],backgroundColor:`${GRADE_COLOR_US[r.grade]}18`,border:`1px solid ${GRADE_COLOR_US[r.grade]}30`,textAlign:'center'}}>{r.grade}</span>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      {r.forwardPe !== undefined && r.forwardPe > 0
                        ? <div style={{display:'flex',alignItems:'baseline',gap:3}}><span style={{fontSize:F.xs,color:MUTED}}>Fwd P/E</span><span style={{fontSize:F.md,fontWeight:800,color:r.forwardPe<25?GREEN:r.forwardPe<50?YELLOW:ORANGE}}>{r.forwardPe.toFixed(0)}×</span></div>
                        : r.pe !== undefined && r.pe > 0
                        ? <div style={{display:'flex',alignItems:'baseline',gap:3}}><span style={{fontSize:F.xs,color:MUTED}}>P/E</span><span style={{fontSize:F.md,fontWeight:800,color:r.pe<25?GREEN:r.pe<50?YELLOW:ORANGE}}>{r.pe.toFixed(0)}×</span></div>
                        : <span style={{fontSize:F.xs,color:`${MUTED}60`}}>P/E —</span>
                      }
                      {r.evEbitda !== undefined && r.evEbitda > 0
                        ? <span style={{fontSize:10,color:MUTED}}>EV/EBITDA {r.evEbitda.toFixed(0)}×</span>
                        : null}
                      {r.marketCapB !== undefined && <span style={{fontSize:9,color:MUTED}}>${r.marketCapB >= 1 ? r.marketCapB.toFixed(1)+'B' : (r.marketCapB*1000).toFixed(0)+'M'}</span>}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.xs,fontWeight:700,color:r.accelSignal==='ACCELERATING'?GREEN:r.accelSignal==='DECELERATING'?RED:MUTED}}>
                        {r.accelSignal??'—'}
                      </span>
                      {r.revenueGrowthQtr !== undefined && <span style={{fontSize:10,color:MUTED}}>QoQ +{r.revenueGrowthQtr.toFixed(0)}%</span>}
                      {r.revenueGrowthAnn !== undefined && <span style={{fontSize:10,color:MUTED}}>Ann +{r.revenueGrowthAnn.toFixed(0)}%</span>}
                    </div>
                    <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                      {r.pillarScores.map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:32}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:26,height:5,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:9,color:MUTED}}>{p.label.slice(0,4)}</span>
                        </div>
                      ))}
                    </div>
                    <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                  </div>
                </button>
                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
                      <div>
                        <div style={{fontSize:F.sm,color:MUTED,fontWeight:700,letterSpacing:'0.8px',marginBottom:8}}>KEY METRICS</div>
                        {[
                          ['Rev Growth (Ann)','revenueGrowthAnn','%'],['Rev Growth (Qtr YoY)','revenueGrowthQtr','%'],
                          ['Gross Margin','grossMarginAnn','%'],['FCF Margin','fcfMarginAnn','%'],
                          ['Operating Margin','opmTtm','%'],['Net Profit Margin','netProfitMargin','%'],
                          ['ROE','roe','%'],['ROIC','roic','%'],
                          ['P/E','pe','×'],['Forward P/E','forwardPe','×'],['EV/EBITDA','evEbitda','×'],['P/S','ps','×'],
                          ['Market Cap','marketCapB','$B'],['D/E','de','×'],['EPS Growth','epsGrowth','%'],
                          ['1Y Performance','perf1y','%'],['vs 52W High','pctFrom52wHigh','%'],
                        ].filter(([,f])=>(r as any)[f]!==undefined).map(([label,field,unit])=>{
                          const v=(r as any)[field] as number;
                          return (
                            <div key={String(field)} style={{display:'flex',justifyContent:'space-between',fontSize:F.md,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <span style={{color:MUTED}}>{label}</span>
                              <span style={{color:TEXT,fontWeight:700}}>{unit==='$B'?`$${v.toFixed(1)}B`:unit==='%'?`${v.toFixed(1)}%`:`${v.toFixed(1)}×`}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        {r.strengths.length>0&&<>
                          <div style={{fontSize:F.sm,color:GREEN,fontWeight:700,marginBottom:6}}>✅ STRENGTHS</div>
                          {r.strengths.map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        {r.risks.length>0&&<>
                          <div style={{fontSize:F.sm,color:ORANGE,fontWeight:700,marginTop:12,marginBottom:6}}>⚠️ RISKS</div>
                          {r.risks.map((s,i)=><div key={i} style={{fontSize:F.md,color:MUTED,padding:'3px 0'}}>› {s}</div>)}
                        </>}
                        <div style={{fontSize:F.sm,color:MUTED,marginTop:12,borderTop:`1px solid ${BORDER}`,paddingTop:8}}>
                          {r.sector} · {r.exchange} · Data: {r.coverage}% · {r.nextEarnings&&`Next earnings: ${r.nextEarnings}`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      {!rows.length&&!loading&&(
        <div style={{textAlign:'center',padding:56,color:MUTED}}>
          <div style={{fontSize:48}}>🇺🇸</div>
          <div style={{fontSize:F.h2,color:TEXT,fontWeight:700,marginTop:14}}>Upload TradingView CSV to score US stocks</div>
          <div style={{fontSize:F.md,color:MUTED,marginTop:8}}>Go to TradingView Screener → add the columns above → Export CSV → upload here</div>
        </div>
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
  const [activeTab, setActiveTab] = useState<'excel'|'usa'|'usa-checklist'|'checklist'>('excel');

  // Lazy-init from localStorage — data survives navigation and page refresh.
  // Only cleared when user explicitly clicks "Clear All Data".
  const [excelRows, setExcelRowsState] = useState<ExcelResult[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ExcelResult[];
        // RE-SCORE on every load — ExcelResult extends ExcelRow, so all raw fields
        // are preserved in localStorage. Re-running scoreExcelRow picks up any
        // scoring formula changes (e.g. new -30 growth filter) without re-upload.
        const rescored = parsed.map(r => scoreExcelRow(r as unknown as ExcelRow));
        const sorted = rescored.sort((a, b) => b.score - a.score);
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
              {id:'excel',    label:'🇮🇳 India Multibagger Ranking'},
              {id:'usa',           label:'🇺🇸 USA Multibagger'},
              {id:'usa-checklist', label:'🇺🇸 USA Checklist'},
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
      {activeTab==='usa'          && <USACompare />}
      {activeTab==='usa-checklist'&& <USAChecklist />}
      {activeTab==='checklist' && <MultibaggerChecklist excelRows={excelRows} />}
    </div>
  );
}
