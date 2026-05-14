'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
// PATCH 0055: Multibagger framework extensions — dilution / reinvestment /
// coverage / historical reference panel.
// PATCH 0058: also archetype matcher
// PATCH 0066: ROIC vs WACC + missing-dimensions
import {
  analyzeDilution, computeReinvestmentEngine, computeFrameworkCoverage,
  computeArchetypeMatch, analyzeRoicVsWacc, buildMissingDimensions,
  HISTORICAL_MULTIBAGGERS, type DilutionAnalysis, type ReinvestmentEngine,
  type FrameworkCoverage, type ArchetypeMatch,
  type RoicWaccSpread, type MissingDimension,
} from '@/lib/multibagger/framework-extensions';
// PATCH 0272 — Conviction Beats overlay on Multibagger results.
import { getConvictionTickers } from '@/lib/conviction-beats';
import { getDecision, setDecision, clearDecision, subscribeDecisions, DECISION_META, type DecisionStatus } from '@/lib/decisions';
// PATCH 0367 — Export toolbar (TradingView + Screener.in) reused from earnings Scan
import TickerExportToolbar from '@/components/TickerExportToolbar';
// PATCH 0370 — Turnaround scoring engine
import { scoreTurnaroundRow, parseTurnaroundRow, type TurnaroundResult, type TurnaroundStage, type TurnaroundArchetype } from '@/lib/turnaround';

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

function scoreExcelRow(row: ExcelRow): ExcelResult {
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
  const MNC_ALLOWLIST = new Set<string>([
    'KENNAMET','CARRARO','NITTAGELA','GRINDWELL','BOSCHLTD','ABB','SIEMENS',
    '3MINDIA','HONAUT','CASTROLIND','CASTROL','NESTLEIND','HUL','HINDUNILVR',
    'COLPAL','GILLETTE','GSK','SANOFI','PFIZER','PROCTER','PGHH','PROCTERG',
    'WHIRLPOOL','ASTRAZEN','THOMASCOOK','TIMKEN','SKFINDIA','FAGBEAR','MAHSCOOTER',
    'CUMMINSIND','SCHAEFFLER','CASTROL','SULZER','LINDEINDIA','ESABINDIA',
  ]);
  const isMNC = MNC_ALLOWLIST.has((row.symbol || '').toUpperCase());

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
  if ((row.aboveDMA200 ?? 0) < -25
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
  if (typeof row.interestCoverage === 'number' && row.interestCoverage > 0) {
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

  let score = Math.round((penalized - redFlagPenalty + totalBonus) / 5) * 5;

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
    valuation: { pass:((row.peg??99)<1.5&&(row.peg??0)>0)||((row.marginOfSafety??-99)>0), label:'Value', detail:row.peg?`PEG ${row.peg.toFixed(1)}`:row.marginOfSafety!==undefined?`MoS ${row.marginOfSafety.toFixed(0)}%`:'No data' },
    discovery: { pass:(row.fiiPlusDii??100)<25, label:'Discovery', detail:row.fiiPlusDii!==undefined?`FII+DII ${row.fiiPlusDii.toFixed(0)}%`:'No data' },
    technical: { pass:(row.aboveDMA200??-100)>=0&&(row.return1m??-100)>=-15, label:'Technical', detail:row.aboveDMA200!==undefined?`${row.aboveDMA200>=0?'+':''}${row.aboveDMA200.toFixed(0)}% vs DMA`:'No data' },
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
    hasGpm5yTrend: false,               // would need custom 5y ratio
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
    else if (o==='BSE Code'||o==='BSE code')                       m['bseCode']=col;
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
    // ── PATCH 0317 / 0332: New institutional metrics ────────────────────────
    // Aliases align with the actual Screener.in export column names
    // (see sample upload analysis). Includes both Screener's "Debtor days"
    // and the alternate "Days Receivable Outstanding" naming.
    else if (o==='Debtor Days'||o==='Debtor days'||o==='Days sales outstanding'||o==='DSO'||
             o==='Days Receivable Outstanding')
      m['debtorDays']=col;
    else if (o==='Inventory Days'||o==='Inventory days'||o==='Days inventory outstanding'||
             o==='Days Inventory Outstanding'||o==='DIO')
      m['inventoryDays']=col;
    else if (o==='Creditor Days'||o==='Creditor days'||o==='Days payable outstanding'||
             o==='Days Payable Outstanding'||o==='DPO')
      m['creditorDays']=col;
    else if (o==='Working Capital Days'||o==='Working capital days'||o==='WC Days'||
             o==='Cash Conversion Cycle'||o==='CCC')
      m['workingCapitalDays']=col;
    // PATCH 0332 — Trend metrics from Screener
    else if (o==='Debtor days 3years back'||o==='Debtor Days 3Y back')
      m['debtorDays3y']=col;
    else if (o==='Average Working Capital Days 3years'||o==='Working Capital Days 3Y avg')
      m['workingCapitalDays3y']=col;
    // PATCH 0332 — Other Income raw (Screener exposes as "Other income" ₹ Cr)
    // We use it directly when % vs PBT isn't separately available.
    else if (o==='Other income'||o==='Other Income')
      m['otherIncome']=col;
    // PATCH 0332 — 5Y high/low for volatility range computation
    else if (o==='Low price all time'||o==='Low Price All Time')
      m['lowPriceAllTime']=col;
    else if (o==='High price all time'||o==='High Price All Time')
      m['highPriceAllTime']=col;
    // PATCH 0332 — Equity capital → share count proxy (Equity capital ₹ Cr / par value 10 = share count Cr)
    else if (o==='Equity capital'||o==='Equity Capital'||o==='Equity Share Capital')
      m['equityCapital']=col;
    // PATCH 0334 — Ownership-change-3Years columns from Screener. These let us
    // synthesize multi-period history from a 3Y delta instead of needing 4
    // separate quarter-back columns.
    else if (o==='Change in promoter holding 3Years'||o==='Change in Promoter Holding 3Years'||o==='Promoter holding change 3Y')
      m['changeInPromoter3y']=col;
    else if (o==='Change in FII holding'||o==='Change in FII Holding'||o==='FII change 1Y')
      m['changeInFii1y']=col;
    else if (o==='Change in FII holding 3Years'||o==='Change in FII Holding 3Years'||o==='FII change 3Y')
      m['changeInFii3y']=col;
    else if (o==='Change in DII holding'||o==='Change in DII Holding'||o==='DII change 1Y')
      m['changeInDii1y']=col;
    else if (o==='Change in DII holding 3Years'||o==='Change in DII Holding 3Years'||o==='DII change 3Y')
      m['changeInDii3y']=col;
    else if (o==='Interest Coverage Ratio'||o==='Interest Coverage'||o==='Interest coverage'||o==='ICR')
      m['interestCoverage']=col;
    else if (o==='Tax rate %'||o==='Tax Rate %'||o==='Effective Tax Rate'||o==='Effective tax rate')
      m['effectiveTaxRate']=col;
    else if (o==='Capex 3Yrs'||o==='Capex 3Years'||o==='Capex 3 Years'||o==='Capex 3yr')
      m['capex3yr']=col;
    else if (o==='Dividend Yield'||o==='Dividend yield'||o==='Div Yield'||o==='DY')
      m['dividendYield']=col;
    // Promoter / FII / DII multi-quarter history. Screener export style:
    // "Promoter holding 1 quarters back", "Promoter holding 2 quarters back" …
    else if (/^Promoter holding\s+(\d+)\s+quarters?\s+back$/i.test(o))
      m['promoterHistory_'+o.match(/^Promoter holding\s+(\d+)/i)![1]]=col;
    else if (/^FII\s+holding\s+(\d+)\s+quarters?\s+back$/i.test(o))
      m['fiiHistory_'+o.match(/^FII\s+holding\s+(\d+)/i)![1]]=col;
    else if (/^DII\s+holding\s+(\d+)\s+quarters?\s+back$/i.test(o))
      m['diiHistory_'+o.match(/^DII\s+holding\s+(\d+)/i)![1]]=col;
    else if (o==='Avg traded value'||o==='Average Daily Volume'||o==='ADV'||o==='Avg Daily Value (Cr)')
      m['avgDailyValueCr']=col;
    // ── PATCH 0322: Forensic pump-detection columns ──────────────────────────
    else if (o==='Other Income'||o==='Other income'||o==='Other Inc')
      m['otherIncome']=col;  // raw value; we compute the % ourselves if PBT is available
    else if (o==='Other Income / PBT %'||o==='Other Income % of PBT'||o==='Other Income to PBT')
      m['otherIncomePctPbt']=col;
    else if (o==='Cash and equivalents'||o==='Cash & Equivalents'||o==='Cash Equivalents'||o==='Cash')
      m['cashAndEq']=col;
    else if (o==='Cash and equivalents preceding year'||o==='Cash 1Y ago'||o==='Cash Preceding Year')
      m['cashAndEqPrev']=col;
    else if (o==='Number of equity shares'||o==='Equity Shares'||o==='Shares Outstanding')
      m['numSharesNow']=col;
    else if (o==='Number of equity shares preceding 3 years'||o==='Equity Shares 3Y ago'||o==='Shares 3Y back')
      m['numShares3y']=col;
    else if (o==='Related Party Transactions %'||o==='RPT % Revenue'||o==='Related Party % Revenue')
      m['rptRevenuePct']=col;
    else if (o==='Auditor Changes Last 3Y'||o==='Auditor changes')
      m['auditorChangesLast3y']=col;
    else if (o==='Number of Subsidiaries'||o==='Subsidiary Count'||o==='Subsidiaries')
      m['subsidiaryCount']=col;
    else if (o==='Free Float %'||o==='Free Float'||o==='Public Float %')
      m['freeFloatPct']=col;
    else if (o==='52 Week Range %'||o==='High Low Range %'||o==='52W Range Pct')
      m['highLowRangePct']=col;
    else if (o==='Promoter Group Entities'||o==='Promoter Entities Count')
      m['promoterEntityCount']=col;
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
  // Prefer NSE Code; fall back to BSE Code for BSE-only listings (e.g. AXTEL).
  // If both are empty, derive a sanitized symbol from the company name so we
  // don't silently drop institutionally-relevant rows.
  let sym=String(row[m['symbol']]??'').trim().toUpperCase();
  if (!sym && m['bseCode']) {
    const bse = String(row[m['bseCode']]??'').trim();
    if (bse) sym = `BSE:${bse}`;
  }
  if (!sym) {
    const name = String(row[m['company']??'']??'').trim();
    if (name) sym = name.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12);
  }
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
    // ── PATCH 0317: Additional institutional metrics ──
    debtorDays: n(m['debtorDays']?row[m['debtorDays']]:undefined),
    inventoryDays: n(m['inventoryDays']?row[m['inventoryDays']]:undefined),
    creditorDays: n(m['creditorDays']?row[m['creditorDays']]:undefined),
    workingCapitalDays: n(m['workingCapitalDays']?row[m['workingCapitalDays']]:undefined),
    debtorDays3y: n(m['debtorDays3y']?row[m['debtorDays3y']]:undefined),
    workingCapitalDays3y: n(m['workingCapitalDays3y']?row[m['workingCapitalDays3y']]:undefined),
    interestCoverage: n(m['interestCoverage']?row[m['interestCoverage']]:undefined),
    effectiveTaxRate: n(m['effectiveTaxRate']?row[m['effectiveTaxRate']]:undefined),
    capex3yr: n(m['capex3yr']?row[m['capex3yr']]:undefined),
    dividendYield: n(m['dividendYield']?row[m['dividendYield']]:undefined),
    avgDailyValueCr: n(m['avgDailyValueCr']?row[m['avgDailyValueCr']]:undefined),
    // Multi-quarter history — collected from m['promoterHistory_N'] entries.
    // Sorted oldest first (highest N back) → latest (1 quarter back / current).
    // PATCH 0334 — fall back to synthesizing a 2-point history from
    // "Change in promoter holding 3Years" + current promoter when 4Q
    // columns aren't present (most users don't add all 4 quarters).
    promoterHistory: (() => {
      const entries: Array<[number, number]> = [];
      for (const k of Object.keys(m)) {
        if (k.startsWith('promoterHistory_')) {
          const qBack = parseInt(k.slice('promoterHistory_'.length), 10);
          const v = n(row[m[k]]);
          if (v !== undefined && Number.isFinite(qBack)) entries.push([qBack, v]);
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => b[0] - a[0]); // oldest (highest N) → newest
        return entries.map(([, v]) => v);
      }
      // PATCH 0334 — synthesize [3Y-ago, current] from change-3Y delta
      const current = n(m['promoter']?row[m['promoter']]:undefined);
      const change3y = n(m['changeInPromoter3y']?row[m['changeInPromoter3y']]:undefined);
      if (current !== undefined && change3y !== undefined) {
        return [current - change3y, current];
      }
      return undefined;
    })(),
    fiiHistory: (() => {
      const entries: Array<[number, number]> = [];
      for (const k of Object.keys(m)) {
        if (k.startsWith('fiiHistory_')) {
          const qBack = parseInt(k.slice('fiiHistory_'.length), 10);
          const v = n(row[m[k]]);
          if (v !== undefined && Number.isFinite(qBack)) entries.push([qBack, v]);
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => b[0] - a[0]);
        return entries.map(([, v]) => v);
      }
      // PATCH 0334 — synthesize 3-point [3Y-ago, 1Y-ago, current] when
      // Change-1Y + Change-3Y are present. Otherwise just 2 points.
      const current = n(m['fii']?row[m['fii']]:undefined);
      const change1y = n(m['changeInFii1y']?row[m['changeInFii1y']]:undefined);
      const change3y = n(m['changeInFii3y']?row[m['changeInFii3y']]:undefined);
      if (current !== undefined && change3y !== undefined && change1y !== undefined) {
        const oneYearAgo = current - change1y;
        const threeYearsAgo = current - change3y;
        return [threeYearsAgo, oneYearAgo, current];
      }
      if (current !== undefined && change3y !== undefined) {
        return [current - change3y, current];
      }
      return undefined;
    })(),
    diiHistory: (() => {
      const entries: Array<[number, number]> = [];
      for (const k of Object.keys(m)) {
        if (k.startsWith('diiHistory_')) {
          const qBack = parseInt(k.slice('diiHistory_'.length), 10);
          const v = n(row[m[k]]);
          if (v !== undefined && Number.isFinite(qBack)) entries.push([qBack, v]);
        }
      }
      if (entries.length > 0) {
        entries.sort((a, b) => b[0] - a[0]);
        return entries.map(([, v]) => v);
      }
      // PATCH 0334 — synthesize from Change-1Y + Change-3Y for DII too.
      const current = n(m['dii']?row[m['dii']]:undefined);
      const change1y = n(m['changeInDii1y']?row[m['changeInDii1y']]:undefined);
      const change3y = n(m['changeInDii3y']?row[m['changeInDii3y']]:undefined);
      if (current !== undefined && change3y !== undefined && change1y !== undefined) {
        const oneYearAgo = current - change1y;
        const threeYearsAgo = current - change3y;
        return [threeYearsAgo, oneYearAgo, current];
      }
      if (current !== undefined && change3y !== undefined) {
        return [current - change3y, current];
      }
      return undefined;
    })(),
    // PATCH 0322: Forensic fields
    otherIncomePctPbt: (() => {
      // Prefer explicit % column.
      const explicit = n(m['otherIncomePctPbt']?row[m['otherIncomePctPbt']]:undefined);
      if (explicit !== undefined) return explicit;
      // PATCH 0332 — derive from raw "Other Income" (₹ Cr) + EPS + Equity Capital.
      // Net Profit ≈ EPS × share_count (where share_count = EqCap / 10).
      // PBT ≈ Net Profit / (1 - tax_rate); use 0.25 as the standard Indian rate.
      const otherInc = n(m['otherIncome']?row[m['otherIncome']]:undefined);
      const epsVal = n(m['eps']?row[m['eps']]:undefined);
      const eqCap = n(m['equityCapital']?row[m['equityCapital']]:undefined);
      if (otherInc !== undefined && epsVal !== undefined && eqCap !== undefined && eqCap > 0) {
        const shares = eqCap * 10; // crore shares at ₹10 par
        const netProfit = epsVal * shares; // ₹ Cr
        if (netProfit <= 0) return undefined;
        const pbtApprox = netProfit / (1 - 0.25);
        if (pbtApprox <= 0) return undefined;
        return (otherInc / pbtApprox) * 100;
      }
      return undefined;
    })(),
    cashAndEq: n(m['cashAndEq']?row[m['cashAndEq']]:undefined),
    cashAndEqPrev: n(m['cashAndEqPrev']?row[m['cashAndEqPrev']]:undefined),
    numSharesNow: (() => {
      // PATCH 0332 — derive from Equity Capital (₹ Cr) ÷ par value (10 INR default)
      // when Screener doesn't expose share count directly.
      const explicit = n(m['numSharesNow']?row[m['numSharesNow']]:undefined);
      if (explicit !== undefined) return explicit;
      const eqCap = n(m['equityCapital']?row[m['equityCapital']]:undefined);
      if (eqCap !== undefined) return eqCap * 10; // crore shares assuming ₹10 face value (most common)
      return undefined;
    })(),
    numShares3y: n(m['numShares3y']?row[m['numShares3y']]:undefined),
    rptRevenuePct: n(m['rptRevenuePct']?row[m['rptRevenuePct']]:undefined),
    auditorChangesLast3y: n(m['auditorChangesLast3y']?row[m['auditorChangesLast3y']]:undefined),
    subsidiaryCount: n(m['subsidiaryCount']?row[m['subsidiaryCount']]:undefined),
    freeFloatPct: (() => {
      // PATCH 0332 — derive from promoter holding: free float = 100 - promoter - pledged
      const explicit = n(m['freeFloatPct']?row[m['freeFloatPct']]:undefined);
      if (explicit !== undefined) return explicit;
      const prom = n(m['promoter']?row[m['promoter']]:undefined);
      const plg = n(m['pledge']?row[m['pledge']]:undefined);
      if (prom !== undefined) {
        // promoter's pledged shares are also locked, but conservatively
        // subtract only the unpledged promoter % to get effective public float
        return Math.max(0, 100 - prom);
      }
      return undefined;
    })(),
    highLowRangePct: (() => {
      // PATCH 0332 — compute from High price all time / Low price all time if available.
      const explicit = n(m['highLowRangePct']?row[m['highLowRangePct']]:undefined);
      if (explicit !== undefined) return explicit;
      const hi = n(m['highPriceAllTime']?row[m['highPriceAllTime']]:undefined);
      const lo = n(m['lowPriceAllTime']?row[m['lowPriceAllTime']]:undefined);
      if (hi !== undefined && lo !== undefined && lo > 0) {
        return ((hi - lo) / lo) * 100;
      }
      return undefined;
    })(),
    promoterEntityCount: n(m['promoterEntityCount']?row[m['promoterEntityCount']]:undefined),
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
    // PATCH 0055: framework extension getters — computed from data already collected
    get dilution(): DilutionAnalysis {
      return analyzeDilution({
        profitCagr: n(m['profitCagr']?row[m['profitCagr']]:undefined),
        epsGrowth:  n(m['epsGrowth']?row[m['epsGrowth']]:undefined),
      });
    },
    get reinvestment(): ReinvestmentEngine {
      const d = analyzeDilution({
        profitCagr: n(m['profitCagr']?row[m['profitCagr']]:undefined),
        epsGrowth:  n(m['epsGrowth']?row[m['epsGrowth']]:undefined),
      });
      const roce_cur=n(m['roce']?row[m['roce']]:undefined);
      const roce3yr_v=n(m['roce3yr']?row[m['roce3yr']]:undefined);
      const expansion = (roce_cur!==undefined && roce3yr_v!==undefined)
        ? Math.round((roce_cur-roce3yr_v)*10)/10 : undefined;
      return computeReinvestmentEngine({
        roceExpansion: expansion,
        profitCagr: n(m['profitCagr']?row[m['profitCagr']]:undefined),
        dilutionDragPp: d.drag_pp,
      });
    },
    get framework_coverage(): FrameworkCoverage {
      // Build a flat object of present field values for the coverage check
      const flat: Record<string, unknown> = {};
      for (const k of ['roce','opm','cfoToPat','fcfAbsolute','gpm','roic',
                       'revCagr','profitCagr','epsGrowth','yoySalesGrowth',
                       'roce3yr','opm3yr','de','netDebt','ebitda','icr',
                       'promoter','pledge','fii','dii','changeInPromoter',
                       'pe','peg','high52w','marketCapCr']) {
        const col = m[k];
        flat[k] = col ? row[col] : undefined;
      }
      return computeFrameworkCoverage(flat);
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
  // PATCH 0127 — sector dropdown so the analyst can rank within a single
  // industry (e.g. compare HBLENGINE only against Defence peers, not all 84).
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [accelOnly, setAccelOnly] = useState(false);
  const [fcfOnly, setFcfOnly] = useState(false);
  const [discoveryOnly, setDiscoveryOnly] = useState(false);
  const [inflectionOnly, setInflectionOnly] = useState(false);
  // P/E and PEG range filters — 'ALL' means no filter
  const [peMax, setPeMax] = useState<'ALL'|15|25|40|60|100>('ALL');
  const [pegMax, setPegMax] = useState<'ALL'|0.8|1.0|1.5|2.0>('ALL');
  // PATCH 0345 — India institutional-quality composite filters (analogs of USA R40/Piotroski/GPM):
  // "Quality of 50": ROCE + Profit CAGR ≥ threshold — India equivalent of Rule of 40.
  // Captures both moat (ROCE) and growth in one metric.
  const [indQualityMin, setIndQualityMin] = useState<'ALL'|50|75|100>('ALL');
  // ROCE filter standalone — moat signature (>25% = elite, >20% = strong)
  const [indRoceMin, setIndRoceMin] = useState<'ALL'|20|25|30>('ALL');
  // Cash conversion — CFO/PAT ≥ 1.0 = earnings fully cash-backed (≥0.8 = clean, ≥1.0 = elite)
  const [indCfoMin, setIndCfoMin] = useState<'ALL'|0.8|1.0>('ALL');
  // PATCH 0347 — Decision filter (filter India rows by user's logbook status)
  const [indDecisionFilter, setIndDecisionFilter] = useState<'ALL'|'WITH'|'NONE'|DecisionStatus>('ALL');
  // PATCH 0347 — Bump to force re-render when decisions change (cross-tab/edit sync)
  const [decisionsVersion, setDecisionsVersion] = useState(0);
  const bumpDecisions = useCallback(() => setDecisionsVersion(v => v + 1), []);
  useEffect(() => subscribeDecisions(() => bumpDecisions()), [bumpDecisions]);
  // Guidance tier filter — only applies when guidanceMode is ON
  type GuidanceTier = 'ALL'|'STRONG'|'POS'|'NEUTRAL'|'NEG'|'WEAK';
  const [guidanceTier, setGuidanceTier] = useState<GuidanceTier>('ALL');

  // ── GUIDANCE MODE ──────────────────────────────────────────────────────────
  // When ON: fetches recent earnings/guidance news, scores each company
  // by guidance quality (0.0-1.0), re-scores and re-sorts.
  // When OFF: no change to existing scores.
  const [guidanceMode, setGuidanceMode] = useState(false);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidanceScores, setGuidanceScores] = useState<Record<string, number>>({}); // symbol → 0.0-1.0
  const [guidanceArticleCounts, setGuidanceArticleCounts] = useState<Record<string, number>>({});

  // PATCH 0272 — Conviction Beats overlay. Subscribes to the institutional
  // bench so we can mark rows that have already passed the BLOCKBUSTER /
  // STRONG earnings filter on /earnings-opportunities. Cross-tab sync via
  // the storage event + the 'conviction-beats:updated' custom event.
  const [convictionSet, setConvictionSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase())); }
    catch { return new Set(); }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setConvictionSet(new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase()))); }
      catch {}
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);
  // Conviction-only filter chip in the toolbar.
  const [convictionOnly, setConvictionOnly] = useState(false);

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

    // PATCH 0336 — Re-apply red-flag structural/cyclical caps after guidance.
    // Without this, a +3 guidance bonus could push a "1 HIGH structural · cap 60"
    // stock to 63, contradicting the audit-panel claim that the cap was binding.
    // Visible symptom (post-0335 deployment): Tips Music score=63 with audit
    // "Active cap: 60 (binding)"; Skipper score=51 with audit "Active cap: 48
    // (binding)". The audit count is correct; the score evaluation also caps
    // correctly inside computeOne(), but applyGuidance() runs afterward and
    // bypasses the structural/cyclical caps. Re-apply them here.
    const critG = r.redFlags.some(f => f.severity === 'CRITICAL');
    const structHighG = r.redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
    const cycHighG    = r.redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
    if (critG)                       newScore = Math.min(newScore, 38);
    else if (structHighG >= 2)       newScore = Math.min(newScore, 48);
    else if (structHighG >= 1)       newScore = Math.min(newScore, 60);
    else if (cycHighG >= 2)          newScore = Math.min(newScore, 62);
    else if (cycHighG >= 1)          newScore = Math.min(newScore, 72);
    // Re-apply governance watch cap (Patch 0313)
    if ((r as any).governanceWatch)  newScore = Math.min(newScore, 65);
    // Re-apply decelerating + monitor bucket caps
    if (r.accelSignal === 'DECELERATING') newScore = Math.min(newScore, 52);
    if (r.bucket === 'MONITOR')           newScore = Math.min(newScore, 45);

    // PATCH 0337 — Mirror the new op-lev <1.0 and cyclical-peak caps so
    // guidance bonus can't slip an A-grade past them.
    if (r.recentOpLev !== undefined && r.recentOpLev < 1.0
        && (r.yoySalesGrowth ?? 0) > 15) {
      newScore = Math.min(newScore, 75);
    }
    const b2cyc = (r.sector || '').match(/METAL|CHEMICAL|TEXTILE|OIL|SHIPPING|CEMENT|TIRE|RUBBER|PAPER/i) !== null;
    if (b2cyc && r.opm !== undefined && (b2.opm?.[2] ?? 0) > 0
        && r.opm > b2.opm[2] * 1.5
        && (r.profitCagr ?? 0) > 40
        && !(r as any).isCyclicRecovery) {
      newScore = Math.min(newScore, 80);
    }

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

  // ── SORTABLE COLUMNS ──────────────────────────────────────────────────────
  type IndiaSort = 'score'|'pe'|'peg'|'roce'|'revCagr'|'profitCagr'|'marketCapCr'|'revenueAcceleration'|'opm'|'cfoToPat';
  const [sortField, setSortField] = useState<IndiaSort>('score');
  const [sortAsc,   setSortAsc]   = useState(false);
  function handleSort(field: IndiaSort) {
    if (sortField === field) { setSortAsc(v => !v); return; }
    // Default direction: ascending is "better" for PE/PEG/MCap (lower = better); descending for everything else
    setSortField(field);
    setSortAsc(['pe','peg','marketCapCr'].includes(field));
  }
  // Sort indicator helper
  const sortIcon = (f: IndiaSort) => sortField===f ? (sortAsc?' ▲':' ▼') : '';

  // ── SCORE CHANGE (vs prev upload baseline) ────────────────────────────────
  const PREV_SCORES_KEY = 'mb_india_prev_scores_v1';
  const prevScoreMap = useMemo<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem(PREV_SCORES_KEY)||'{}'); } catch { return {}; }
  }, []); // read once on mount

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

      // PATCH 0347 — Cross-market detection on India upload (peek first file)
      if (arr.length > 0) {
        const peekBuf = await arr[0].arrayBuffer();
        const peekWb = XLSX.read(peekBuf, { type:'array' });
        const peekRaw = XLSX.utils.sheet_to_json<Record<string,unknown>>(peekWb.Sheets[peekWb.SheetNames[0]], { defval:'' });
        if (peekRaw.length > 0) {
          const headers = Object.keys(peekRaw[0]);
          const detected = detectCsvMarket(headers);
          if (detected === 'US') {
            const proceed = window.confirm(
              `⚠️ This CSV looks like a USA TradingView export (found USA-specific columns like Forward non-GAAP P/E, Piotroski F-score, Altman Z-score).\n\nYou're currently on the India tab.\n\nClick OK to switch to USA Multibagger tab and upload there.\nClick Cancel to upload here anyway (may produce empty/wrong scores).`
            );
            if (proceed) {
              window.dispatchEvent(new CustomEvent('mc:switch-multibagger-tab', { detail: { tab: 'usa' } }));
              setLoading(false);
              return;
            }
          }
        }
      }

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
      const merged = [...rows, ...newScored].sort((a,b) => b.score - a.score);
      const allScored = applyForcedRanking(merged);
      setRows(allScored);
      // Save score baseline so score-change indicator works on next load
      try { localStorage.setItem(PREV_SCORES_KEY, JSON.stringify(Object.fromEntries(allScored.map(r=>[r.symbol,r.score])))); } catch {}

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
  // PATCH 0127 — sector filter: institutional users want to compare within
  // sector (e.g. all Defence stocks ranked together, not all 84 mixed).
  if (sectorFilter !== 'ALL') baseRows = baseRows.filter(r => r.sector === sectorFilter);
  if (accelOnly)      baseRows = baseRows.filter(r => r.decisionStrip.acceleration.pass);
  if (fcfOnly)        baseRows = baseRows.filter(r => (r.fcfAbsolute ?? -1) > 0 || (r.cfoToPat ?? 0) >= 0.8);
  if (discoveryOnly)   baseRows = baseRows.filter(r => (r.fiiPlusDii ?? 100) < 15);
  if (inflectionOnly)  baseRows = baseRows.filter(r => r.inflectionSignal || r.triggerBonus >= 10);
  // PATCH 0272 — Conviction-only filter. When ON, narrows the universe to
  // tickers already on the Conviction Beats bench (synced from /earnings-opportunities).
  if (convictionOnly) baseRows = baseRows.filter(r => convictionSet.has((r.symbol || '').toUpperCase()));
  // P/E and PEG filters — only apply when data is available for a stock
  if (peMax  !== 'ALL') baseRows = baseRows.filter(r => r.pe  !== undefined && r.pe  > 0 && r.pe  <= peMax);
  if (pegMax !== 'ALL') baseRows = baseRows.filter(r => r.peg !== undefined && r.peg > 0 && r.peg <= pegMax);
  // PATCH 0345 — India institutional-quality composite filters (AND-style).
  // "Quality of 50": ROCE + Profit CAGR ≥ threshold — India equivalent of USA Rule of 40.
  if (indQualityMin !== 'ALL') baseRows = baseRows.filter(r => {
    const score = (r.roce ?? 0) + (r.profitCagr ?? 0);
    return score >= indQualityMin;
  });
  if (indRoceMin !== 'ALL') baseRows = baseRows.filter(r => (r.roce ?? 0) >= indRoceMin);
  if (indCfoMin !== 'ALL')  baseRows = baseRows.filter(r => (r.cfoToPat ?? 0) >= indCfoMin);
  // PATCH 0347 — decision filter
  if (indDecisionFilter !== 'ALL') {
    baseRows = baseRows.filter(r => {
      const d = getDecision(r.symbol);
      if (indDecisionFilter === 'WITH') return !!d;
      if (indDecisionFilter === 'NONE') return !d;
      return d?.status === indDecisionFilter;
    });
  }
  // Guidance tier filter — only meaningful when guidance mode is ON
  if (guidanceTier !== 'ALL' && guidanceMode) {
    baseRows = baseRows.filter(r => {
      const gs = guidanceScores[r.symbol];
      if (gs === undefined || gs === -1) return false;
      if (guidanceTier === 'STRONG')  return gs >= 0.70;
      if (guidanceTier === 'POS')     return gs >= 0.55 && gs < 0.70;
      if (guidanceTier === 'NEUTRAL') return gs > 0.45 && gs < 0.55;
      if (guidanceTier === 'NEG')     return gs > 0.30 && gs <= 0.45;
      if (guidanceTier === 'WEAK')    return gs <= 0.30;
      return true;
    });
  }
  const baseFiltered = gradeFilter.has('ALL') ? baseRows : baseRows.filter(r => gradeFilter.has(r.grade));
  // Apply guidance re-scoring when active
  const guidanceApplied = guidanceMode && Object.keys(guidanceScores).length > 0
    ? [...baseFiltered.map(r => applyGuidance(r))] : baseFiltered;
  // Apply sortable column sort (default: score descending — same as before)
  const filtered = [...guidanceApplied].sort((a, b) => {
    const getV = (r: ExcelResult): number => {
      switch(sortField) {
        case 'pe':                  return r.pe ?? (sortAsc ? 999 : -1);
        case 'peg':                 return r.peg ?? (sortAsc ? 999 : -1);
        case 'roce':                return r.roce ?? (sortAsc ? -1 : 999);
        case 'revCagr':             return r.revCagr ?? (sortAsc ? -1 : 999);
        case 'profitCagr':          return r.profitCagr ?? (sortAsc ? -1 : 999);
        case 'marketCapCr':         return r.marketCapCr ?? (sortAsc ? 999999 : -1);
        case 'revenueAcceleration': return r.revenueAcceleration ?? (sortAsc ? -999 : 999);
        case 'opm':                 return r.opm ?? (sortAsc ? -1 : 999);
        case 'cfoToPat':            return r.cfoToPat ?? (sortAsc ? -1 : 999);
        default:                    return r.score; // 'score'
      }
    };
    const av = getV(a), bv = getV(b);
    return sortAsc ? av - bv : bv - av;
  });
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
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
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
            {/* PATCH 0127 — Sector filter dropdown */}
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>SECTOR:</span>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              style={{fontSize:F.xs,fontWeight:700,padding:'5px 8px',borderRadius:7,border:`1px solid ${sectorFilter==='ALL'?BORDER:'#22D3EE60'}`,background:sectorFilter==='ALL'?'transparent':'#22D3EE15',color:sectorFilter==='ALL'?MUTED:'#22D3EE',cursor:'pointer'}}>
              <option value="ALL">All sectors</option>
              {(() => {
                const counts: Record<string, number> = {};
                for (const r of rows) counts[r.sector] = (counts[r.sector] ?? 0) + 1;
                return Object.entries(counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, c]) => (
                    <option key={s} value={s}>{s} ({c})</option>
                  ));
              })()}
            </select>
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>QUICK:</span>
            {[
              {key:'accel',  label:'🚀 Accelerating', active:accelOnly,  toggle:()=>setAccelOnly(v=>!v),  count:rows.filter(r=>r.decisionStrip.acceleration.pass).length},
              {key:'fcf',    label:'💰 FCF+',         active:fcfOnly,    toggle:()=>setFcfOnly(v=>!v),    count:rows.filter(r=>(r.fcfAbsolute??-1)>0||(r.cfoToPat??0)>=0.8).length},
              {key:'disc',    label:'🔍 Discovery <15%', active:discoveryOnly,  toggle:()=>setDiscoveryOnly(v=>!v),  count:rows.filter(r=>(r.fiiPlusDii??100)<15).length},
      {key:'inflect', label:'💥 Inflection',     active:inflectionOnly, toggle:()=>setInflectionOnly(v=>!v), count:rows.filter(r=>r.inflectionSignal||r.triggerBonus>=10).length},
      // PATCH 0272 — Conviction-only chip. Counts how many uploaded rows
      // intersect the Conviction Beats bench so users can see at a glance
      // which of their multibagger candidates ALSO just printed a BLOCKBUSTER/STRONG.
      {key:'cb',     label:'🏆 Conviction',     active:convictionOnly, toggle:()=>setConvictionOnly(v=>!v), count:rows.filter(r=>convictionSet.has((r.symbol||'').toUpperCase())).length},
      // Guidance button — separate from regular toggles, has its own fetch action
            ].map(f=>(
              <button key={f.key} onClick={f.toggle} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${f.active?ACCENT+'60':BORDER}`,background:f.active?ACCENT+'14':'transparent',color:f.active?ACCENT:MUTED,cursor:'pointer'}}>
                {f.label} ({f.count})
              </button>
            ))}
            {/* PATCH 0345 — India "Quality of 50" composite filter (analog of USA R40).
                ROCE + Profit CAGR ≥ threshold. ≥50 = passes (MOSL elite baseline);
                ≥75 = strong compounder; ≥100 = 100-bagger DNA tier.
                Composes AND-style with all other filters. */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'#a78bfa',fontWeight:700,letterSpacing:'0.5px'}}>Q50:</span>
            {(['ALL',50,75,100] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndQualityMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indQualityMin===v?'#a78bfa60':BORDER}`,background:indQualityMin===v?'#a78bfa14':'transparent',color:indQualityMin===v?'#a78bfa':MUTED,cursor:'pointer'}}
                title={v==='ALL'?'No quality filter':`ROCE + Profit CAGR ≥ ${v}${v===100?' = 100-bagger DNA tier':v===75?' = strong compounder':' = MOSL elite baseline'}`}>
                {v==='ALL'?'All':`≥${v}${v===100?' 🏆':''}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.roce??0)+(r.profitCagr??0)>=v).length})`}
              </button>
            ))}
            {/* PATCH 0345 — ROCE filter standalone (moat signature) */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'#10b981',fontWeight:700,letterSpacing:'0.5px'}}>ROCE:</span>
            {(['ALL',20,25,30] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndRoceMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indRoceMin===v?'#10b98160':BORDER}`,background:indRoceMin===v?'#10b98114':'transparent',color:indRoceMin===v?'#10b981':MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`≥${v}%${v===30?' 💎':''}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.roce??0)>=v).length})`}
              </button>
            ))}
            {/* PATCH 0345 — CFO/PAT filter (cash conversion / earnings quality) */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:'#34d399',fontWeight:700,letterSpacing:'0.5px'}}>CFO/PAT:</span>
            {(['ALL',0.8,1.0] as const).map(v=>(
              <button key={String(v)} onClick={()=>setIndCfoMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                border:`1px solid ${indCfoMin===v?'#34d39960':BORDER}`,background:indCfoMin===v?'#34d39914':'transparent',color:indCfoMin===v?'#34d399':MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`≥${v.toFixed(1)}${v===1.0?'× 💎':'×'}`}
                {v!=='ALL' && ` (${rows.filter(r=>(r.cfoToPat??0)>=v).length})`}
              </button>
            ))}
            {/* Guidance tier filter — only shown when guidance mode is ON */}
            {guidanceMode && <>
              <div style={{width:1,background:BORDER,height:20}}/>
              <span style={{fontSize:F.xs,color:'#F59E0B',fontWeight:700,letterSpacing:'0.5px'}}>GUIDANCE:</span>
              {([
                {k:'ALL' as GuidanceTier,    label:'All',        col:MUTED},
                {k:'STRONG' as GuidanceTier, label:'▲ Strong',   col:GREEN},
                {k:'POS' as GuidanceTier,    label:'↑ Positive', col:'#34d399'},
                {k:'NEUTRAL' as GuidanceTier,label:'→ Neutral',  col:MUTED},
                {k:'NEG' as GuidanceTier,    label:'↓ Negative', col:ORANGE},
                {k:'WEAK' as GuidanceTier,   label:'▼ Weak',     col:RED},
              ] as const).map(({k,label,col})=>(
                <button key={k} onClick={()=>setGuidanceTier(prev=>prev===k?'ALL':k)}
                  style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${guidanceTier===k?col+'60':BORDER}`,background:guidanceTier===k?col+'18':'transparent',color:guidanceTier===k?col:MUTED,cursor:'pointer'}}>
                  {label}
                </button>
              ))}
            </>}
            {/* P/E filter */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>P/E:</span>
            {(['ALL',15,25,40,60,100] as const).map(v=>(
              <button key={v} onClick={()=>setPeMax(prev=>prev===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,
                border:`1px solid ${peMax===v?YELLOW+'60':BORDER}`,background:peMax===v?`${YELLOW}14`:'transparent',color:peMax===v?YELLOW:MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`<${v}×`}
              </button>
            ))}
            {/* PEG filter */}
            <div style={{width:1,background:BORDER,height:20}}/>
            <span style={{fontSize:F.xs,color:MUTED,fontWeight:700,letterSpacing:'0.5px'}}>PEG:</span>
            {(['ALL',0.8,1.0,1.5,2.0] as const).map(v=>(
              <button key={v} onClick={()=>setPegMax(prev=>prev===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 10px',borderRadius:7,
                border:`1px solid ${pegMax===v?GREEN+'60':BORDER}`,background:pegMax===v?`${GREEN}14`:'transparent',color:pegMax===v?GREEN:MUTED,cursor:'pointer'}}>
                {v==='ALL'?'All':`<${v}`}
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

            {/* ── CSV EXPORT ── */}
            {filtered.length > 0 && (
              <button
                title="Export as CSV (Excel-compatible)"
                onClick={async () => {
                  const XLSX = await import('xlsx');
                  const data = filtered.map(r => ({
                    Symbol: r.symbol, Company: r.company, Score: r.score, Grade: r.grade,
                    Bucket: r.bucket, Sector: r.sector,
                    'ROCE %': r.roce, 'ROE %': r.roe, 'OPM %': r.opm, 'CFO/PAT': r.cfoToPat,
                    'FCF Cr': r.fcfAbsolute, 'Rev CAGR %': r.revCagr, 'Profit CAGR %': r.profitCagr,
                    'YOY Sales %': r.yoySalesGrowth, 'YOY Profit %': r.yoyProfitGrowth,
                    'D/E': r.de, 'Pledge %': r.pledge, 'Promoter %': r.promoter, 'Δ Promoter': r.changeInPromoter,
                    'P/E': r.pe, 'PEG': r.peg, 'MCap Cr': r.marketCapCr, 'MoS %': r.marginOfSafety,
                    'FII+DII %': r.fiiPlusDii, 'GPM %': r.gpm, 'ROIC %': r.roic,
                    'Rev Accel pp': r.revenueAcceleration, 'Profit Accel pp': r.profitAcceleration,
                    'Accel Signal': r.accelSignal, 'EV/EBITDA': r.evEbitda, 'FCF Yield %': r.fcfYield,
                    'ROCE Δ 3yr': r.roceExpansion, 'OPM Δ': r.opmExpansion,
                    'KS Pass': (r.killSwitch??[]).filter(t=>t.pass&&t.checks.some(c=>c.pass!==null)).length + '/' +
                              (r.killSwitch??[]).filter(t=>t.checks.some(c=>c.pass!==null)).length,
                    'Rerating': r.reratingBonus, Coverage: r.coverage,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'India');
                  XLSX.writeFile(wb, `india-multibagger-${new Date().toISOString().slice(0,10)}.csv`, { bookType: 'csv' });
                }}
                style={{ fontSize:F.xs, fontWeight:700, padding:'5px 12px', borderRadius:7, cursor:'pointer', border:`1px solid ${BORDER}`, background:'transparent', color:'#06b6d4' }}
              >⬇ CSV</button>
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

          {/* PATCH 0367 — India export toolbar. Filtered tickers from `filtered`.
              Builds ticker -> company map for Screener.in name-based matching
              (NSE symbols like '360ONE' don't match Screener fuzzy search;
              'Three Sixty One Capital' / '360 ONE WAM Ltd' does). */}
          {filtered.length > 0 && (() => {
            const tickerCompanyMap: Record<string, string> = {};
            for (const r of filtered) {
              if (r.symbol && r.company) tickerCompanyMap[r.symbol.toUpperCase()] = r.company;
            }
            return (
              <div style={{ margin: '10px 0' }}>
                <TickerExportToolbar
                  tickers={filtered.map(r => r.symbol).filter(Boolean)}
                  exchange="NSE"
                  filenameHint="multibagger-india"
                  tickerCompanyMap={tickerCompanyMap}
                  compact
                />
              </div>
            );
          })()}

          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'130px 130px 65px 65px 96px 86px 120px 1fr 76px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            {/* Clickable sort headers */}
            <span>TICKER</span><span>COMPANY</span>
            <span onClick={()=>handleSort('score')} style={{cursor:'pointer',userSelect:'none',color:sortField==='score'?ACCENT:MUTED}}>SCORE{sortIcon('score')}</span>
            <span>GRADE</span>
            <span onClick={()=>handleSort('pe')} style={{cursor:'pointer',userSelect:'none',color:sortField==='pe'||sortField==='peg'?YELLOW:MUTED}}>P/E{sortIcon('pe')} · <span onClick={e=>{e.stopPropagation();handleSort('peg')}} style={{cursor:'pointer'}}>PEG{sortIcon('peg')}</span></span>
            <span style={{color:guidanceMode?'#F59E0B':MUTED}}>GUIDANCE{!guidanceMode&&<span style={{fontSize:9,fontWeight:400}}> ↑📡</span>}</span>
            <span>DECISION STRIP</span>
            <span onClick={()=>handleSort('revenueAcceleration')} style={{cursor:'pointer',userSelect:'none',color:sortField==='revenueAcceleration'?GREEN:MUTED}}>SQGLP PILLARS{sortIcon('revenueAcceleration')}</span>
            <span onClick={()=>handleSort('marketCapCr')} style={{cursor:'pointer',userSelect:'none',color:sortField==='marketCapCr'?'#f97316':MUTED}}>COV{sortIcon('marketCapCr')}</span>
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
                        {/* PATCH 0272 — Conviction Beats overlay badge. Amber 🏆 means
                            this ticker is on the institutional Conviction Beats bench
                            (synced from /earnings-opportunities BLOCKBUSTER/STRONG output). */}
                        {convictionSet.has((r.symbol || '').toUpperCase()) && (
                          <span
                            title="On Conviction Beats bench (BLOCKBUSTER/STRONG earnings)"
                            style={{
                              fontSize: 9, fontWeight: 800, color: '#F59E0B',
                              border: '1px solid #F59E0B60', backgroundColor: 'rgba(245,158,11,0.10)',
                              padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
                            }}
                          >🏆 CB</span>
                        )}
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
                      {/* PATCH 0313 — Governance Watch badge. Fires when the
                          pump-and-dump fingerprint is present (promoter ≤25%,
                          FII+DII ≤5%, mcap <₹2000Cr). Composite score is
                          capped at 65 in this state. */}
                      {(r as any).governanceWatch && (
                        <span
                          title={`GOVERNANCE WATCH: classic operator-driven small-cap setup (low promoter + zero institutional + small mcap). Score capped at 65 regardless of fundamentals because the financial quality itself can't be independently verified without institutional auditor pressure.`}
                          style={{
                            fontSize: 9, fontWeight: 800, color: '#EF4444',
                            border: '1px solid #EF444460',
                            backgroundColor: 'rgba(239,68,68,0.12)',
                            padding: '1px 4px', borderRadius: 3, width: 'fit-content',
                            letterSpacing: 0.3,
                          }}
                        >🛑 GOV⚠</span>
                      )}
                      {/* PATCH 0326 — Forensic pump-score chip. Visible on
                          row when forensic signals fire. Hover shows the
                          individual flags. Red ≥5 = CRITICAL, orange ≥3 =
                          HIGH, yellow ≥1 = soft signal. */}
                      {(r as any).pumpScore > 0 && (() => {
                        const ps = (r as any).pumpScore;
                        const flags = ((r as any).pumpFlags as string[]) || [];
                        const tone = ps >= 5 ? '#EF4444' : ps >= 3 ? '#F97316' : '#F59E0B';
                        const label = ps >= 5 ? `🔥 PUMP ${ps}` : ps >= 3 ? `⚠ PUMP ${ps}` : `· pump ${ps}`;
                        return (
                          <span
                            title={`Forensic pump-detector: ${ps} signals fired. ${flags.length > 0 ? '\n\n' + flags.slice(0, 6).map(f => '• ' + f).join('\n') : ''}`}
                            style={{
                              fontSize: 9, fontWeight: 800, color: tone,
                              border: `1px solid ${tone}60`,
                              backgroundColor: `${tone}14`,
                              padding: '1px 4px', borderRadius: 3, width: 'fit-content',
                              letterSpacing: 0.3,
                            }}
                          >{label}</span>
                        );
                      })()}
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
                          {/* PATCH 0166 — MC-Efficiency = rev_growth × ROCE / log10(MCap_Cr)
                              Higher = small company growing fast at high ROCE = great compounding setup.
                              ROCE/FCF Quality = ROCE / (FCF/Revenue) — high ROCE backed by strong FCF wins. */}
                          {(() => {
                            const roce = (r as any).roce as number | undefined;
                            const revG = (r as any).revenue_growth as number | undefined ?? (r as any).rev_g as number | undefined;
                            const fcf = (r as any).fcfAbsolute as number | undefined;
                            const rev = (r as any).revenue_cr as number | undefined ?? (r as any).sales as number | undefined;
                            if (roce != null && revG != null && mcap != null && mcap > 0) {
                              const denom = Math.log10(Math.max(mcap, 10));
                              const mcEff = (revG * roce) / denom;
                              const col = mcEff >= 200 ? GREEN : mcEff >= 100 ? YELLOW : mcEff >= 50 ? ORANGE : MUTED;
                              return (
                                <span title={`MC-Efficiency = revG × ROCE / log(MCap). ${mcEff.toFixed(0)} (rev growth ${revG.toFixed(0)}% × ROCE ${roce.toFixed(0)}% / log MCap ${denom.toFixed(2)}).`}
                                  style={{fontSize:9, color: col, fontWeight: 700, marginTop: 2}}>
                                  MC-Eff {mcEff.toFixed(0)}
                                </span>
                              );
                            }
                            return null;
                          })()}
                          {(() => {
                            const roce = (r as any).roce as number | undefined;
                            const fcf = (r as any).fcfAbsolute as number | undefined;
                            const rev = (r as any).revenue_cr as number | undefined ?? (r as any).sales as number | undefined;
                            if (roce != null && fcf != null && rev != null && rev > 0) {
                              const fcfPct = (fcf / rev) * 100;
                              const ratio = fcfPct > 0 ? roce / fcfPct : 0;
                              const col = fcfPct >= 8 ? GREEN : fcfPct >= 3 ? YELLOW : RED;
                              return (
                                <span title={`ROCE/FCF Quality. ROCE ${roce.toFixed(0)}%, FCF/Rev ${fcfPct.toFixed(1)}% → ratio ${ratio.toFixed(2)} (closer-to-1 = high-quality earnings backed by cash).`}
                                  style={{fontSize:9, color: col, fontWeight: 700}}>
                                  ROCE/FCF {fcfPct.toFixed(1)}%
                                </span>
                              );
                            }
                            return null;
                          })()}
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

                    {/* Coverage + kill-switch + score delta */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {r.redFlags.length>0&&<span style={{fontSize:F.xs,color:hasCrit?RED:ORANGE}}>⚠{r.redFlags.length}</span>}
                      {/* Kill-switch badge — N/8 tests pass */}
                      {(() => {
                        const ks = r.killSwitch ?? [];
                        const tested = ks.filter(t => t.checks.some(c=>c.pass!==null));
                        if (tested.length < 4) return null;
                        const passed = tested.filter(t=>t.pass).length;
                        const col = passed>=6?GREEN:passed>=4?YELLOW:ORANGE;
                        return <span title="Kill-switch: N/8 tests pass" style={{fontSize:9,fontWeight:700,color:col}}>🛡{passed}/{tested.length}</span>;
                      })()}
                      {/* PATCH 0056: Reinvestment Engine verdict (data from patch 0055) */}
                      {r.reinvestment && r.reinvestment.verdict !== 'NA' && (() => {
                        const verdict = r.reinvestment.verdict;
                        const score = r.reinvestment.score;
                        const col = verdict === 'COMPOUNDING' ? GREEN
                                  : verdict === 'BUILDING' ? '#22d3ee'
                                  : verdict === 'STALLING' ? RED
                                  : MUTED;
                        const icon = verdict === 'COMPOUNDING' ? '⚙' : verdict === 'BUILDING' ? '↗' : verdict === 'STALLING' ? '✗' : '·';
                        const lbl = verdict === 'COMPOUNDING' ? 'COMP' : verdict === 'BUILDING' ? 'BUILD' : verdict === 'STALLING' ? 'STALL' : 'ord';
                        return (
                          <span title={`Reinvestment Engine ${score}/100 — ${r.reinvestment.note}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {lbl} {score}
                          </span>
                        );
                      })()}
                      {/* PATCH 0056: Dilution verdict (data from patch 0055) */}
                      {r.dilution && r.dilution.verdict !== 'NA' && r.dilution.verdict !== 'NEUTRAL' && (() => {
                        const v = r.dilution.verdict;
                        const drag = r.dilution.drag_pp;
                        const col = v === 'SEVERELY_DILUTIVE' ? RED
                                  : v === 'DILUTIVE' ? ORANGE
                                  : GREEN;
                        const icon = v === 'SEVERELY_DILUTIVE' || v === 'DILUTIVE' ? '⤓' : '⤒';
                        const lbl = v === 'SEVERELY_DILUTIVE' ? 'DIL!!' : v === 'DILUTIVE' ? 'DIL' : 'ACCR';
                        return (
                          <span title={`Dilution: ${r.dilution.note}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {lbl} {drag !== null ? (drag > 0 ? '+' : '') + drag.toFixed(1) + 'pp' : ''}
                          </span>
                        );
                      })()}
                      {/* PATCH 0056: Framework data coverage indicator */}
                      {r.framework_coverage && (() => {
                        const conf = r.framework_coverage.confidence;
                        const pct = r.framework_coverage.coverage_pct;
                        const col = conf === 'HIGH' ? GREEN : conf === 'MEDIUM' ? YELLOW : ORANGE;
                        return (
                          <span title={`Framework coverage: ${pct}% of ideal data present. ${r.framework_coverage.note}`}
                                style={{fontSize:9,fontWeight:600,color:col,opacity:0.85}}>
                            ◔ {pct}%
                          </span>
                        );
                      })()}
                      {/* PATCH 0058: Archetype match badge — most important addition */}
                      {r.archetype && r.archetype.strength !== 'NO_MATCH' && (() => {
                        const s = r.archetype.strength;
                        const col = s === 'STRONG' ? PURPLE : s === 'PARTIAL' ? '#22d3ee' : MUTED;
                        const icon = s === 'STRONG' ? '🎯' : s === 'PARTIAL' ? '◓' : '○';
                        const archShort = (r.archetype.closest_archetype ?? '').replace(/\s\d+$/, '');
                        return (
                          <span title={`Closest historical 100× archetype: ${r.archetype.closest_archetype} (${r.archetype.ten_year_return_x}×). Match strength ${s}. Score ${r.archetype.match_score}/100.\n\n${r.archetype.verdict}`}
                                style={{fontSize:9,fontWeight:700,color:col}}>
                            {icon} {archShort.length > 14 ? archShort.slice(0, 12) + '…' : archShort} ({r.archetype.match_score})
                          </span>
                        );
                      })()}
                      {/* PATCH 0327 — Score-change vs prev upload, upgraded to
                          institutional-visible chip. Shows prior score in
                          hover tooltip. "NEW" chip for stocks with no prior. */}
                      {(() => {
                        const prev = prevScoreMap[r.symbol];
                        if (prev === undefined) {
                          return (
                            <span
                              title="No prior score on file — this is a new entry since the last Multibagger upload."
                              style={{
                                fontSize: 9, fontWeight: 700, color: PURPLE,
                                border: `1px solid ${PURPLE}60`,
                                backgroundColor: `${PURPLE}14`,
                                padding: '1px 5px', borderRadius: 3,
                                letterSpacing: 0.3,
                              }}
                            >NEW</span>
                          );
                        }
                        const delta = r.score - prev;
                        if (delta === 0) {
                          return (
                            <span
                              title={`Score unchanged from prior upload (${prev}).`}
                              style={{ fontSize: 9, fontWeight: 700, color: MUTED }}
                            >=</span>
                          );
                        }
                        const tone = delta > 0 ? GREEN : RED;
                        const arrow = delta > 0 ? '▲' : '▼';
                        return (
                          <span
                            title={`Score changed from ${prev} → ${r.score} since prior upload (${delta > 0 ? '+' : ''}${delta} pts).`}
                            style={{
                              fontSize: 10, fontWeight: 800, color: tone,
                              border: `1px solid ${tone}60`,
                              backgroundColor: `${tone}14`,
                              padding: '1px 6px', borderRadius: 3,
                              letterSpacing: 0.3,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >{arrow} {delta > 0 ? '+' : ''}{delta}</span>
                        );
                      })()}
                    </div>
                  </div>
                </button>

                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    {/* PATCH 0347 — Decision logbook bar (per-stock BUY/WATCH/NEUTRAL/REJECTED + reason) */}
                    <DecisionBar symbol={r.symbol} company={r.company} market="IN" score={r.score} grade={r.grade} bump={bumpDecisions} />
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
                      {/* PATCH 0316 — SCORING AUDIT BREAKDOWN. Shows the caps
                          that fired and the count of each severity tier so
                          the user can see at-a-glance why a stock landed at
                          its score (e.g. "1 STRUCTURAL HIGH → cap 60"). */}
                      {(() => {
                        const crit = r.redFlags.filter(f => f.severity === 'CRITICAL').length;
                        const structHigh = r.redFlags.filter(f => f.severity === 'HIGH' && (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL').length;
                        const cycHigh = r.redFlags.filter(f => f.severity === 'HIGH' && f.kind === 'CYCLICAL').length;
                        const meds = r.redFlags.filter(f => f.severity === 'MEDIUM').length;
                        const cap = crit > 0 ? 38
                          : structHigh >= 2 ? 48
                          : structHigh >= 1 ? 60
                          : cycHigh >= 2 ? 62
                          : cycHigh >= 1 ? 72
                          : 100;
                        const govWatch = (r as any).governanceWatch;
                        return (
                          <div style={{marginBottom:12,padding:'10px 12px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:8}}>
                            <div style={{fontSize:F.xs,fontWeight:800,letterSpacing:'0.7px',color:ACCENT,marginBottom:8}}>📋 SCORE AUDIT — WHY {r.score}?</div>
                            <div style={{display:'flex',flexWrap:'wrap',gap:8,fontSize:F.xs}}>
                              <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${BORDER}`,color:TEXT}}>Composite: <strong>{r.score}</strong> · Grade <strong style={{color:GRADE_COLOR[r.grade]}}>{r.grade}</strong></span>
                              {crit > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,backgroundColor:`${RED}14`,color:RED,fontWeight:700}}>{crit} CRITICAL · cap 38</span>}
                              {structHigh > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ORANGE}60`,backgroundColor:`${ORANGE}14`,color:ORANGE,fontWeight:700}}>{structHigh} HIGH structural · cap {structHigh>=2?48:60}</span>}
                              {cycHigh > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${YELLOW}60`,backgroundColor:`${YELLOW}14`,color:YELLOW,fontWeight:700}}>{cycHigh} HIGH cyclical · cap {cycHigh>=2?62:72}</span>}
                              {meds > 0 && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${MUTED}60`,color:MUTED,fontWeight:700}}>{meds} MEDIUM · −{meds*5}</span>}
                              {govWatch && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,backgroundColor:`${RED}14`,color:RED,fontWeight:700}}>🛑 GOVERNANCE WATCH · cap 65</span>}
                              {r.accelSignal === 'DECELERATING' && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${RED}60`,color:RED,fontWeight:700}}>DECELERATING · cap 52</span>}
                              {r.bucket === 'MONITOR' && <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${MUTED}60`,color:MUTED,fontWeight:700}}>MONITOR bucket · cap 45</span>}
                              {cap < 100 && (
                                <span style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${ACCENT}60`,backgroundColor:`${ACCENT}14`,color:ACCENT,fontWeight:700}}>
                                  Active cap: {cap}{r.score < cap ? '' : ' (binding)'}
                                </span>
                              )}
                              {cap === 100 && r.redFlags.length === 0 && (
                                <span style={{padding:'2px 8px',borderRadius:4,color:GREEN,fontWeight:700}}>No red-flag caps active — score is uncapped</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
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
                          {r.redFlags.map((f,i)=>{
                            const isStruct = (f.kind ?? 'STRUCTURAL') === 'STRUCTURAL';
                            const cost = f.severity === 'CRITICAL' ? -25 : f.severity === 'HIGH' ? (isStruct ? -12 : -6) : -5;
                            return (
                              <div key={i} style={{fontSize:F.md,color:f.severity==='CRITICAL'?RED:ORANGE,padding:'3px 0'}}>
                                ⛔ {f.label}
                                <span style={{fontSize:F.xs,color:f.severity==='CRITICAL'?RED:ORANGE,fontWeight:700,marginLeft:6}}>{cost} pts</span>
                                <span style={{fontSize:F.xs,color:MUTED,marginLeft:6}}>[{f.severity} · {isStruct?'structural':'cyclical'} · {f.source}]</span>
                              </div>
                            );
                          })}
                        </>}

                        {/* ── PATCH 0056+0058: MULTIBAGGER FRAMEWORK PANEL ── */}
                        {(r.dilution || r.reinvestment || r.framework_coverage || r.archetype) && (
                          <div style={{marginTop:16,borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
                            <div style={{fontSize:F.sm,fontWeight:800,letterSpacing:'0.8px',color:'#22d3ee',marginBottom:10}}>
                              🧬 MULTIBAGGER FRAMEWORK ANALYSIS
                            </div>
                            {/* PATCH 0058: Archetype card — featured first */}
                            {r.archetype && r.archetype.strength !== 'NO_MATCH' && (() => {
                              const s = r.archetype.strength;
                              const col = s === 'STRONG' ? PURPLE : s === 'PARTIAL' ? '#22d3ee' : MUTED;
                              return (
                                <div style={{marginBottom:8,padding:'10px 12px',backgroundColor:`${col}10`,border:`1px solid ${col}40`,borderLeft:`3px solid ${col}`,borderRadius:7}}>
                                  <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:6}}>
                                    <span style={{fontSize:F.sm,fontWeight:800,color:col,letterSpacing:'0.5px'}}>
                                      🎯 ARCHETYPE MATCH: {s}
                                    </span>
                                    <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{r.archetype.closest_archetype}</span>
                                    <span style={{fontSize:F.xs,color:GREEN,fontWeight:700}}>{r.archetype.ten_year_return_x}× in 10y</span>
                                    <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>match score {r.archetype.match_score}/100</span>
                                  </div>
                                  <div style={{fontSize:F.xs,color:TEXT,lineHeight:1.5,marginBottom:8}}>{r.archetype.verdict}</div>
                                  {r.archetype.matching_dimensions.length > 0 && (
                                    <div style={{marginBottom:6}}>
                                      <div style={{fontSize:9,color:GREEN,fontWeight:700,marginBottom:3}}>✓ MATCHING DIMENSIONS</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {r.archetype.matching_dimensions.map((d,i) => (
                                          <span key={i} style={{fontSize:9,padding:'2px 6px',backgroundColor:`${GREEN}15`,color:GREEN,border:`1px solid ${GREEN}30`,borderRadius:4}}>{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {r.archetype.missing_dimensions.length > 0 && (
                                    <div>
                                      <div style={{fontSize:9,color:ORANGE,fontWeight:700,marginBottom:3}}>⚠ MISSING vs ARCHETYPE</div>
                                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                                        {r.archetype.missing_dimensions.map((d,i) => (
                                          <span key={i} style={{fontSize:9,padding:'2px 6px',backgroundColor:`${ORANGE}15`,color:ORANGE,border:`1px solid ${ORANGE}30`,borderRadius:4}}>{d}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {r.archetype && r.archetype.strength === 'NO_MATCH' && (
                              <div style={{marginBottom:8,padding:'10px 12px',backgroundColor:`${MUTED}10`,border:`1px solid ${MUTED}40`,borderLeft:`3px solid ${MUTED}`,borderRadius:7}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:MUTED,marginBottom:4}}>○ NO ARCHETYPE MATCH</div>
                                <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.5}}>{r.archetype.verdict}</div>
                              </div>
                            )}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:8}}>
                              {/* PATCH 0066: ROIC vs sector WACC */}
                              {r.roic_vs_wacc && r.roic_vs_wacc.verdict !== 'NA' && (() => {
                                const v = r.roic_vs_wacc.verdict;
                                const col = v==='VALUE_CREATING'?GREEN:v==='VALUE_DESTROYING'?RED:MUTED;
                                const label = v.replace('_',' ').toLowerCase();
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>📈 ROIC vs WACC</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{label}</span>
                                      {r.roic_vs_wacc.spread_pp !== null && (
                                        <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>
                                          {r.roic_vs_wacc.spread_pp >= 0 ? '+' : ''}{r.roic_vs_wacc.spread_pp.toFixed(1)}pp
                                        </span>
                                      )}
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.roic_vs_wacc.note}</div>
                                  </div>
                                );
                              })()}
                              {r.reinvestment && r.reinvestment.verdict !== 'NA' && (() => {
                                const v = r.reinvestment.verdict;
                                const col = v==='COMPOUNDING'?GREEN:v==='BUILDING'?'#22d3ee':v==='STALLING'?RED:MUTED;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>⚙ Reinvestment Engine</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{v}</span>
                                      <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{r.reinvestment.score}/100</span>
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.reinvestment.note}</div>
                                  </div>
                                );
                              })()}
                              {r.dilution && r.dilution.verdict !== 'NA' && (() => {
                                const v = r.dilution.verdict;
                                const col = v==='SEVERELY_DILUTIVE'?RED:v==='DILUTIVE'?ORANGE:v==='ACCRETIVE'?GREEN:MUTED;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>{v.includes('DILUTIVE')?'⤓':'⤒'} Dilution Trajectory</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{v.replace('_',' ')}</span>
                                      {r.dilution.drag_pp !== null && (
                                        <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>
                                          {r.dilution.drag_pp > 0 ? '+' : ''}{r.dilution.drag_pp.toFixed(1)}pp drag
                                        </span>
                                      )}
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4}}>{r.dilution.note}</div>
                                  </div>
                                );
                              })()}
                              {r.framework_coverage && (() => {
                                const c = r.framework_coverage;
                                const col = c.confidence==='HIGH'?GREEN:c.confidence==='MEDIUM'?YELLOW:ORANGE;
                                return (
                                  <div style={{backgroundColor:CARD2,border:`1px solid ${col}30`,borderLeft:`3px solid ${col}`,borderRadius:7,padding:'8px 10px'}}>
                                    <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:4}}>
                                      <span style={{fontSize:F.xs,fontWeight:700,color:TEXT}}>◔ Framework Coverage</span>
                                      <span style={{fontSize:F.xs,fontWeight:800,color:col}}>{c.confidence}</span>
                                      <span style={{fontSize:F.xs,color:MUTED,marginLeft:'auto'}}>{c.coverage_pct}%</span>
                                    </div>
                                    <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.4,marginBottom:4}}>{c.note}</div>
                                    {c.missing.length > 0 && c.missing.length <= 6 && (
                                      <div style={{fontSize:9,color:'#64748b',lineHeight:1.4}}>
                                        Missing: {c.missing.join(', ')}
                                      </div>
                                    )}
                                    {c.missing.length > 6 && (
                                      <div style={{fontSize:9,color:'#64748b',lineHeight:1.4}}>
                                        Missing {c.missing.length} fields incl. {c.missing.slice(0,3).join(', ')}…
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* PATCH 0066: Missing Dimensions panel — honest signaling
                                of what the framework CAN'T see for this stock. Shows
                                which qualitative dimensions (founder tenure, customer
                                concentration, etc.) need manual verification. */}
                            {r.missing_dimensions && r.missing_dimensions.length > 0 && (
                              <div style={{marginTop:10,padding:'10px 12px',backgroundColor:`${MUTED}08`,border:`1px solid ${MUTED}30`,borderLeft:`3px solid ${MUTED}`,borderRadius:7}}>
                                <div style={{fontSize:F.xs,fontWeight:700,color:'#94A3B8',marginBottom:6,letterSpacing:'0.4px'}}>
                                  🔍 FRAMEWORK BOUNDARY — DIMENSIONS NOT MEASURED
                                </div>
                                <div style={{fontSize:9,color:MUTED,marginBottom:8,lineHeight:1.5}}>
                                  These qualitative dimensions matter for multibagger outcomes but cannot be measured from Screener export alone. Verify manually for high-conviction picks.
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:6}}>
                                  {r.missing_dimensions.map((d, i) => {
                                    const col = d.status === 'MEASURED' ? GREEN : d.status === 'PROXY' ? YELLOW : ORANGE;
                                    const icon = d.status === 'MEASURED' ? '✓' : d.status === 'PROXY' ? '~' : '?';
                                    return (
                                      <div key={i} style={{padding:'6px 8px',backgroundColor:CARD2,borderRadius:5,fontSize:9,lineHeight:1.4}}>
                                        <div style={{display:'flex',alignItems:'baseline',gap:4,marginBottom:2}}>
                                          <span style={{color:col,fontWeight:700}}>{icon}</span>
                                          <span style={{color:TEXT,fontWeight:700}}>{d.dimension}</span>
                                          <span style={{color:col,fontSize:8,marginLeft:'auto',fontWeight:700}}>{d.status}</span>
                                        </div>
                                        <div style={{color:MUTED,fontSize:9}}>{d.explanation}</div>
                                        {d.upload_hint && d.status !== 'MEASURED' && (
                                          <div style={{color:'#22d3ee',fontSize:8,marginTop:3,fontStyle:'italic'}}>→ {d.upload_hint}</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

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
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
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

function scoreUSARow(row: USARow): USARow & { score: number; grade: USAGrade; coverage: number; strengths: string[]; risks: string[]; pillarScores: {id:string;label:string;score:number;color:string}[]; fcfOpDivergence?: boolean; postRunStretched?: boolean; earningsProximityDays?: number; suggestedMaxPositionPct?: number } {
  const b = getUSABench(row.sector);
  const strengths: string[] = [];
  const risks: string[] = [];

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
  if ((row.ruleOf40 ?? 0) >= 80 && (effGM ?? 0) >= 40 && noSpeculativeCap) {
    score = Math.min(100, score + 5);
    strengths.push(`Elite R40 ${row.ruleOf40?.toFixed(0)} with ${effGM?.toFixed(0)}% GPM — top-decile growth-plus-economics. +5 bonus.`);
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
  if (row.ruleOf40 !== undefined) {
    if (row.ruleOf40 < 10)      score = Math.min(score, 55);
    else if (row.ruleOf40 < 20) score = Math.min(score, 65);
    else if (row.ruleOf40 < 30) score = Math.min(score, 72);
    else if (row.ruleOf40 < 40) score = Math.min(score, 78);
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

  return {
    ...row,
    score, grade, coverage,
    ruleOf40: computedRuleOf40,
    grossMarginExpansion: computedGMExpansion,
    revenueAccel: revAccel,
    accelSignal: revAccel !== undefined ? (revAccel>=5?'ACCELERATING':revAccel<=-5?'DECELERATING':'STABLE') : row.accelSignal,
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

type USAResult = ReturnType<typeof scoreUSARow>;

function applyUSARanking(results: USAResult[]): USAResult[] {
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
  return results.map(r => {
    // Score-based grade is the source of truth (computed in scoreUSARow)
    let grade: USAGrade = r.grade;

    // Mega-cap downgrade: >$150B mcap cannot reasonably 100× — limit to B+ tier
    if (r.marketCapB !== undefined && r.marketCapB > 150 && (grade === 'A+' || grade === 'A')) {
      grade = 'B+';
    }
    // Mega-mega-cap downgrade: >$500B mcap can't realistically be a multibagger pick
    if (r.marketCapB !== undefined && r.marketCapB > 500 && grade === 'B+') {
      grade = 'B';
    }
    // Sub-10% growth in multibagger engine = not the thesis
    if (r.revenueGrowthAnn !== undefined && r.revenueGrowthAnn < 10 && (grade === 'A+' || grade === 'A')) {
      grade = 'B+';
    }
    // Decelerating revenue = momentum broken
    if (r.accelSignal === 'DECELERATING' && (grade === 'A+' || grade === 'A')) {
      grade = 'B+';
    }
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
  // PATCH 0342: TradingView exports use "Cash and equivalents" (with "and"),
  // not "Cash & equivalents" (with ampersand). Old parser missed this column.
  const cashRaw = n(
    row['Cash and equivalents, Annual'] ??
    row['Cash & equivalents, Annual'] ??
    row['Cash and equivalents']
  );
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
    // Gross margin: use TTM (TradingView now provides Trailing 12 months) OR Annual as fallback
    grossMarginAnn:   n(row['Gross margin %, Annual'] ??
                        row['Gross margin %, Trailing 12 months']),  // TTM = primary if Annual missing
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
    // ── TradingView fields (confirmed to exist) ──────────────────────────────
    // 5-year CAGR (TradingView column: "Revenue growth %, 5 year CAGR")
    revGrowth3yr: n(
      row['Revenue growth %, 5 year CAGR'] ??  // TradingView exact name
      row['Revenue growth %, 3-year CAGR'] ??  // fallback for old exports
      row['Revenue 3-year CAGR, %'] ??
      row['Revenue growth %, 3 year CAGR']
    ),
    // Gross margin TTM (TradingView: "Gross margin %, Trailing 12 months")
    grossMarginTtm: n(
      row['Gross margin %, Trailing 12 months'] ??  // TradingView exact
      row['Gross margin %, TTM']
    ),
    // PEG ratio TTM (TradingView: "Price to earning to growth, Trailing 12 months")
    peg: n(
      row['Price to earning to growth, Trailing 12 months'] ??  // TradingView exact
      row['Price to earnings growth ratio'] ??
      row['PEG ratio'] ??
      row['PEG']
    ),
    // Analyst Rating (TradingView: "Analyst Rating" — string: Strong buy/Buy/Neutral/Sell)
    analystRating: (() => {
      const v = String(row['Analyst Rating'] ?? row['Analyst rating'] ?? '').trim();
      return v || undefined;
    })(),
    // RSI (TradingView: "Relative strength index, 14")
    rsi14: n(
      row['Relative strength index, 14'] ??
      row['RSI, 14'] ??
      row['RSI']
    ),
    // P/FCF (TradingView: "Price to free cash flow, TTM")
    pFcf: n(
      row['Price to free cash flow, TTM'] ??
      row['Price to free cash flow ratio, TTM'] ??
      row['P/FCF']
    ),
    // ── PATCH 0341: NEW FORENSIC COLUMNS (TradingView confirmed names) ───────
    piotroskiFScore: n(
      row['Piotroski F-score, Annual'] ??
      row['Piotroski F-score, Trailing 12 months'] ??
      row['Piotroski F-score']
    ),
    altmanZScore: n(
      row['Altman Z-score, Annual'] ??
      row['Altman Z-score, Trailing 12 months'] ??  // PATCH 0342: NVDIA-format file uses TTM
      row['Altman Z-score']
    ),
    sloanRatio: n(
      row['Sloan ratio %, Trailing 12 months'] ??
      row['Sloan ratio %, Annual'] ??
      row['Sloan ratio %']
    ),
    sharesBuybackRatio: n(
      row['Shares buyback ratio %, Annual'] ??
      row['Shares buyback ratio %, Quarterly'] ??
      row['Shares buyback ratio %']
    ),
    buybackYield: n(row['Buyback yield %']),
    rdRatio: n(
      row['Research and development ratio, Trailing 12 months'] ??
      row['Research and development ratio, Annual'] ??
      row['Research and development ratio'] ??
      row['Research & development to revenue ratio %']
    ),
    interestCoverage: n(
      row['Interest coverage, Annual'] ??
      row['Interest coverage, Trailing 12 months'] ??
      row['Interest coverage']
    ),
    netDebtEbitda: n(
      row['Net debt to EBITDA ratio, Trailing 12 months'] ??
      row['Net debt to EBITDA ratio, Annual'] ??
      row['Net debt to EBITDA ratio']
    ),
    cashStInvest: n(
      row['Cash and short-term investments, Annual'] ??
      row['Cash and short-term investments, Quarterly'] ??
      row['Cash and short-term investments']
    ),
    revPerEmployee: n(
      row['Revenue per employee, Annual'] ??
      row['Revenue per employee']
    ),
    sustainableGrowth: n(
      row['Sustainable growth rate, Annual'] ??
      row['Sustainable growth rate']
    ),
    freeFloatPct: n(row['Free float %']),
    fcfPerEmployee: n(
      row['Free cash flow per employee, Annual'] ??
      row['Free cash flow per employee']
    ),
    fcfAnnUsd: n(row['Free cash flow, Annual']),
    fcfTtmUsd: n(
      row['Free cash flow, Trailing 12 months'] ??
      row['Free cash flow, TTM']
    ),
    totalSharesOutstanding: n(
      row['Total common shares outstanding'] ??
      row['Total common shares outstanding, Quarterly'] ??
      row['Shares outstanding']
    ),
    numEmployees: n(
      row['Number of employees, Annual'] ??
      row['Number of employees']
    ),
    ebitdaPerEmployee: n(
      row['EBITDA per employee, Annual'] ??
      row['EBITDA per employee']
    ),
    // PATCH 0342: FCF per share TTM (NVDIA-style export has this instead
    // of absolute FCF). Wired as a separate signal — positive value is a
    // clean cash-generation signal even without absolute FCF.
    fcfPerShareTtm: n(
      row['Free cash flow per share, Trailing 12 months'] ??
      row['Free cash flow per share, TTM'] ??
      row['Free cash flow per share']
    ),
    roce: n(
      row['Return on capital employed %, Annual'] ??
      row['Return on capital employed %, Trailing 12 months'] ??
      row['Return on capital employed %']
    ),
    // ── Kept for forward compatibility but not standard in TradingView ───────
    insiderOwnership: n(row['Insider ownership, %'] ?? row['Insider ownership %']),
    analystCount:     n(row['Number of analyst estimates'] ?? row['Analysts']),
    forwardRevGrowth: n(row['Forward revenue growth %, FY1'] ?? row['Revenue growth %, next year']),
    // Derived at parse time
    revenueAccel: (revQtr !== undefined && revAnn !== undefined) ? Math.round(revQtr - revAnn) : undefined,
    accelSignal: (revQtr !== undefined && revAnn !== undefined)
      ? (revQtr - revAnn >= 5 ? 'ACCELERATING' : revQtr - revAnn <= -5 ? 'DECELERATING' : 'STABLE')
      : undefined,
    // Rule of 40 = revenue growth + FCF margin (≥40 = institutional benchmark)
    // PATCH 0346 — R40 uses Quarterly Rev + FCF margin (more current view).
    // Falls back to Annual when Quarterly missing.
    ruleOf40: ((revQtr ?? revAnn) !== undefined && n(row['Free cash flow margin %, Annual']) !== undefined)
      ? Math.round(((revQtr ?? revAnn) as number) + (n(row['Free cash flow margin %, Annual']) as number))
      : undefined,
    // Gross margin expansion = TTM vs Annual (positive = improving pricing power)
    grossMarginExpansion: (() => {
      const ttm = n(row['Gross margin %, TTM'] ?? row['Gross margin %, Trailing 12 months']);
      const ann = n(row['Gross margin %, Annual']);
      return (ttm !== undefined && ann !== undefined) ? Math.round((ttm - ann) * 10) / 10 : undefined;
    })(),
    // PATCH 0341: RUNWAY MONTHS = cash / (annual FCF burn rate, only meaningful when FCF<0)
    runwayMonths: (() => {
      const cash = n(row['Cash and short-term investments, Annual'])
                ?? n(row['Cash and short-term investments, Quarterly']);
      const fcfTtm = n(row['Free cash flow, Trailing 12 months'])
                  ?? n(row['Free cash flow, TTM']);
      const fcfAnn = n(row['Free cash flow, Annual']);
      const fcf = fcfTtm ?? fcfAnn;
      if (cash === undefined || fcf === undefined || fcf >= 0) return undefined;
      const annualBurn = Math.abs(fcf);
      return Math.round(cash / annualBurn * 12); // months of runway at current burn
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
  // Re-score from localStorage so ALL derived fields (ruleOf40, grossMarginExpansion,
  // accelSignal etc.) are always current — fixes autoStatus returning null for old data.
  const usaRows = (() => {
    try {
      const saved = localStorage.getItem('mb_usa_scored_v1');
      if (!saved) return [];
      const parsed = JSON.parse(saved) as USAResult[];
      return parsed.map(r => scoreUSARow(r as unknown as USARow));
    } catch { return []; }
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
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
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
  const [usPeMax,       setUsPeMax]       = React.useState<'ALL'|15|25|40|60|100>('ALL');
  const [usPegMax,      setUsPegMax]      = React.useState<'ALL'|0.8|1.0|1.5|2.0>('ALL');
  const [usFcfOnly,     setUsFcfOnly]     = React.useState(false);
  const [usRatingFilter,setUsRatingFilter]= React.useState<'ALL'|'BUY'|'STRONG_BUY'>('ALL');
  // PATCH 0345 — Rule of 40 tiered filter. R40 is the canonical SaaS/growth
  // institutional benchmark. ≥40 = passes; ≥60 = strong; ≥80 = elite (NVDA/PLTR tier).
  const [usR40Min,      setUsR40Min]      = React.useState<'ALL'|40|60|80>('ALL');
  // PATCH 0345 — Piotroski quality filter (≥7 = elite Greenblatt/Piotroski tier)
  const [usPiotroskiMin,setUsPiotroskiMin]= React.useState<'ALL'|5|7>('ALL');
  // PATCH 0345 — GPM quality filter (≥50% = real moat; ≥70% = elite SaaS)
  const [usGpmMin,      setUsGpmMin]      = React.useState<'ALL'|40|60|70>('ALL');
  // PATCH 0347 — Decision filter for USA tab
  const [usDecisionFilter, setUsDecisionFilter] = React.useState<'ALL'|'WITH'|'NONE'|DecisionStatus>('ALL');
  const [usDecisionsV, setUsDecisionsV] = React.useState(0);
  const bumpUsDecisions = React.useCallback(() => setUsDecisionsV(v => v + 1), []);
  React.useEffect(() => subscribeDecisions(() => bumpUsDecisions()), [bumpUsDecisions]);
  // Touch usDecisionsV so it's read on render (avoids unused-var lint)
  void usDecisionsV;
  // USA sortable columns
  type USASort = 'score'|'fwdPe'|'peg'|'revGrowthAnn'|'ruleOf40'|'fcfMargin'|'marketCapB'|'grossMargin';
  const [usSortField, setUsSortField] = React.useState<USASort>('score');
  const [usSortAsc,   setUsSortAsc]   = React.useState(false);
  function handleUSASort(field: USASort) {
    if (usSortField===field) { setUsSortAsc(v=>!v); return; }
    setUsSortField(field);
    setUsSortAsc(['fwdPe','peg','marketCapB'].includes(field));
  }
  const usSortIcon = (f: USASort) => usSortField===f ? (usSortAsc?' ▲':' ▼') : '';
  // USA score baseline
  const USA_PREV_KEY = 'mb_usa_prev_scores_v1';
  const usPrevScores = React.useMemo<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem(USA_PREV_KEY)||'{}'); } catch { return {}; }
  }, []);

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
      // PATCH 0347 — Cross-market detection on USA upload
      const allHeaders: string[] = [];
      for (const file of arr) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet, { defval:'' });
        if (raw.length > 0) allHeaders.push(...Object.keys(raw[0]));
        for (const r of raw) {
          const parsed = parseUSARow(r as Record<string,unknown>);
          if (!parsed || seenSymbols.has(parsed.symbol)) continue;
          seenSymbols.add(parsed.symbol);
          allRows.push(parsed);
        }
      }
      const detectedMarket = detectCsvMarket(allHeaders);
      if (detectedMarket === 'IN') {
        const proceed = window.confirm(
          `⚠️ This CSV looks like an INDIA Screener.in export (found Indian-specific columns like Promoter holding, ROCE, Sales growth).\n\nYou're currently on the USA tab.\n\nClick OK to switch to India Multibagger tab and upload there.\nClick Cancel to upload here anyway (may produce empty/wrong scores).`
        );
        if (proceed) {
          // Dispatch a custom event the parent page can listen to
          window.dispatchEvent(new CustomEvent('mc:switch-multibagger-tab', { detail: { tab: 'excel' } }));
          setLoading(false);
          return;
        }
      }
      if (!allRows.length) { setParseError('No valid rows found. Ensure the file has a Symbol column.'); setLoading(false); return; }
      const scored = allRows.map(r => scoreUSARow(r));
      const merged = [...rows, ...scored].sort((a,b)=>b.score-a.score);
      setRows(merged);
      // Save USA score baseline
      try { localStorage.setItem(USA_PREV_KEY, JSON.stringify(Object.fromEntries(merged.map(r=>[r.symbol,r.score])))); } catch {}
      setFileName(`${arr.length} file${arr.length>1?'s':''} · ${merged.length} stocks`);
    } catch(e) { setParseError(`Error: ${e instanceof Error?e.message:String(e)}`); }
    setLoading(false);
  }

  const GRADES: USAGrade[] = ['A+','A','B+','B','C','D'];
  const GRADE_COLOR_US: Record<USAGrade,string> = {'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444'};
  let filtered = gradeFilter.has('ALL') ? rows : rows.filter(r=>gradeFilter.has(r.grade));
  if (accelOnly)        filtered = filtered.filter(r=>r.accelSignal==='ACCELERATING');
  if (usFcfOnly)        filtered = filtered.filter(r=>(r.fcfMarginAnn ?? -99) >= 10);
  // PATCH 0345 — Rule of 40 / Piotroski / GPM filters compose AND-style
  if (usR40Min !== 'ALL')       filtered = filtered.filter(r=>(r.ruleOf40 ?? -999) >= usR40Min);
  if (usPiotroskiMin !== 'ALL') filtered = filtered.filter(r=>(r.piotroskiFScore ?? -1) >= usPiotroskiMin);
  if (usGpmMin !== 'ALL')       filtered = filtered.filter(r=>{
    const gm = r.grossMarginTtm ?? r.grossMarginAnn;
    return gm !== undefined && gm >= usGpmMin;
  });
  // PATCH 0347 — decision filter for USA
  if (usDecisionFilter !== 'ALL') {
    filtered = filtered.filter(r => {
      const d = getDecision(r.symbol);
      if (usDecisionFilter === 'WITH') return !!d;
      if (usDecisionFilter === 'NONE') return !d;
      return d?.status === usDecisionFilter;
    });
  }
  // Analyst Rating filter
  if (usRatingFilter === 'BUY')       filtered = filtered.filter(r => r.analystRating?.toLowerCase().includes('buy'));
  if (usRatingFilter === 'STRONG_BUY')filtered = filtered.filter(r => r.analystRating?.toLowerCase().includes('strong buy'));
  // P/E filter uses forwardPe first (more forward-looking), falls back to trailing P/E
  if (usPeMax  !== 'ALL') filtered = filtered.filter(r=>{
    const pe = r.forwardPe && r.forwardPe > 0 ? r.forwardPe : r.pe;
    return pe !== undefined && pe > 0 && pe <= usPeMax;
  });
  if (usPegMax !== 'ALL') filtered = filtered.filter(r=>r.peg !== undefined && r.peg > 0 && r.peg <= usPegMax);
  // Apply USA sort
  filtered = [...filtered].sort((a,b) => {
    const getV = (r: USAResult): number => {
      switch(usSortField) {
        case 'fwdPe':       return (r.forwardPe&&r.forwardPe>0?r.forwardPe:r.pe) ?? (usSortAsc?999:-1);
        case 'peg':         return r.peg ?? (usSortAsc?999:-1);
        case 'revGrowthAnn':return r.revenueGrowthAnn ?? (usSortAsc?-1:999);
        case 'ruleOf40':    return r.ruleOf40 ?? (usSortAsc?-1:999);
        case 'fcfMargin':   return r.fcfMarginAnn ?? (usSortAsc?-1:999);
        case 'marketCapB':  return r.marketCapB ?? (usSortAsc?999:-1);
        case 'grossMargin': return (r.grossMarginTtm??r.grossMarginAnn) ?? (usSortAsc?-1:999);
        default:            return r.score;
      }
    };
    const av=getV(a), bv=getV(b);
    return usSortAsc ? av-bv : bv-av;
  });

  return (
    <div style={{maxWidth:1800,margin:'0 auto',padding:'28px 20px'}}>
      {/* Header */}
      <div style={{marginBottom:20,padding:'18px 20px',backgroundColor:CARD_BG,border:`1px solid ${BORDER}`,borderRadius:12}}>
        <div style={{fontSize:F.lg,fontWeight:800,color:'#38bdf8',marginBottom:8}}>🇺🇸 USA Multibagger — TradingView Export</div>
        <div style={{fontSize:F.md,color:MUTED,lineHeight:1.8,marginBottom:12}}>
          Export from TradingView Screener as CSV and upload. All columns auto-detected.
          <span style={{color:YELLOW}}> Recommended extra columns to add:</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
          {[
            // ── Base export (always present in TradingView) ──────────────────
            {field:'Gross margin %, Trailing 12 months', why:'GPM TTM — pricing power & moat ✅ confirmed in TradingView'},
            {field:'Free cash flow margin %, Annual', why:'FCF quality ✅ confirmed in TradingView'},
            {field:'Operating margin %, Trailing 12 months', why:'Operational efficiency ✅ in TradingView'},
            {field:'Return on equity %, Trailing 12 months', why:'Returns quality ✅ in TradingView'},
            // ── Add these — confirmed to exist in TradingView ────────────────
            {field:'Earnings per share diluted growth %, TTM YoY', why:'EPS growth — Fisher Twin Engine ✅ added'},
            {field:'Return on invested capital %, Annual', why:'ROIC — capital efficiency ✅ added'},
            {field:'Debt to equity ratio, Quarterly', why:'Leverage ✅ added'},
            {field:'Net margin %, Trailing 12 months', why:'Net profitability ✅ added'},
            {field:'Performance % 1 year', why:'1-year momentum ✅ added'},
            {field:'Revenue growth %, 5 year CAGR', why:'Sustained growth vs spike check ✅ added'},
            {field:'Price to earning to growth, Trailing 12 months', why:'PEG — growth-adjusted valuation ✅ added'},
            {field:'Analyst Rating', why:'Buy/Strong Buy/Sell — consensus signal ✅ added'},
            // ── Still to add — exist in TradingView ──────────────────────────
            {field:'Relative strength index, 14', why:'🆕 RSI momentum — overbought/oversold signal'},
            {field:'Price to free cash flow, TTM', why:'🆕 P/FCF — Buffett preferred valuation metric'},
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
              <button onClick={()=>setUsFcfOnly(v=>!v)} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${usFcfOnly?'#38bdf8'+'60':BORDER}`,background:usFcfOnly?`${'#38bdf8'}14`:'transparent',color:usFcfOnly?'#38bdf8':MUTED,cursor:'pointer'}}>
                💰 FCF≥10% ({rows.filter(r=>(r.fcfMarginAnn??-99)>=10).length})
              </button>

              {/* PATCH 0345 — Rule of 40 tiered filter (composes AND-style with others) */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#a78bfa',fontWeight:700}}>R40:</span>
              {(['ALL',40,60,80] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsR40Min(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usR40Min===v?'#a78bfa60':BORDER}`,background:usR40Min===v?'#a78bfa14':'transparent',color:usR40Min===v?'#a78bfa':MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`≥${v}${v===80?' 🏆':''}`}
                  {v!=='ALL' && ` (${rows.filter(r=>(r.ruleOf40 ?? -999) >= v).length})`}
                </button>
              ))}

              {/* PATCH 0345 — Piotroski F-score filter (≥5 clean, ≥7 elite) */}
              {rows.some(r=>r.piotroskiFScore !== undefined) && <>
                <div style={{width:1,background:BORDER,height:18}}/>
                <span style={{fontSize:F.xs,color:'#10b981',fontWeight:700}}>Piotroski:</span>
                {(['ALL',5,7] as const).map(v=>(
                  <button key={String(v)} onClick={()=>setUsPiotroskiMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                    border:`1px solid ${usPiotroskiMin===v?'#10b98160':BORDER}`,background:usPiotroskiMin===v?'#10b98114':'transparent',color:usPiotroskiMin===v?'#10b981':MUTED,cursor:'pointer'}}>
                    {v==='ALL'?'All':`≥${v}${v===7?'/9 💎':''}`}
                    {v!=='ALL' && ` (${rows.filter(r=>(r.piotroskiFScore ?? -1) >= v).length})`}
                  </button>
                ))}
              </>}

              {/* PATCH 0345 — Gross margin filter (moat signature) */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#34d399',fontWeight:700}}>GPM:</span>
              {(['ALL',40,60,70] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsGpmMin(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usGpmMin===v?'#34d39960':BORDER}`,background:usGpmMin===v?'#34d39914':'transparent',color:usGpmMin===v?'#34d399':MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`≥${v}%`}
                  {v!=='ALL' && ` (${rows.filter(r=>{const gm=r.grossMarginTtm??r.grossMarginAnn;return gm!==undefined && gm>=v;}).length})`}
                </button>
              ))}

              {/* PATCH 0347 — Decision logbook filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:'#38bdf8',fontWeight:700}}>📒 Decision:</span>
              {([
                {k:'ALL' as const, label:'All', col:MUTED},
                {k:'BUY' as const, label:'✅ BUY', col:'#10b981'},
                {k:'WATCH' as const, label:'👁 WATCH', col:'#f59e0b'},
                {k:'NEUTRAL' as const, label:'⚪ NEUTRAL', col:'#94a3b8'},
                {k:'REJECTED' as const, label:'❌ REJECTED', col:'#ef4444'},
              ]).map(({k,label,col})=>(
                <button key={k} onClick={()=>setUsDecisionFilter(p=>p===k?'ALL':k)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usDecisionFilter===k?col+'60':BORDER}`,background:usDecisionFilter===k?col+'18':'transparent',color:usDecisionFilter===k?col:MUTED,cursor:'pointer'}}>
                  {label} {k!=='ALL' && `(${rows.filter(r=>getDecision(r.symbol)?.status===k).length})`}
                </button>
              ))}

              {/* Analyst Rating filter — only shown when data has ratings */}
              {rows.some(r=>r.analystRating) && <>
                <div style={{width:1,background:BORDER,height:18}}/>
                <span style={{fontSize:F.xs,color:'#F59E0B',fontWeight:700}}>ANALYST:</span>
                {([
                  {k:'ALL' as const, label:'All', col:MUTED},
                  {k:'BUY' as const, label:'Buy+', col:GREEN},
                  {k:'STRONG_BUY' as const, label:'Strong Buy', col:'#10b981'},
                ] as const).map(({k,label,col})=>(
                  <button key={k} onClick={()=>setUsRatingFilter(p=>p===k?'ALL':k)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                    border:`1px solid ${usRatingFilter===k?col+'60':BORDER}`,background:usRatingFilter===k?col+'18':'transparent',color:usRatingFilter===k?col:MUTED,cursor:'pointer'}}>
                    {label} {k!=='ALL'&&`(${rows.filter(r=>k==='BUY'?r.analystRating?.toLowerCase().includes('buy'):r.analystRating?.toLowerCase().includes('strong buy')).length})`}
                  </button>
                ))}
              </>}

              {/* Fwd P/E filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>Fwd P/E:</span>
              {(['ALL',15,25,40,60,100] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsPeMax(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usPeMax===v?YELLOW+'60':BORDER}`,background:usPeMax===v?`${YELLOW}14`:'transparent',color:usPeMax===v?YELLOW:MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`<${v}×`}
                </button>
              ))}

              {/* PEG filter */}
              <div style={{width:1,background:BORDER,height:18}}/>
              <span style={{fontSize:F.xs,color:MUTED,fontWeight:700}}>PEG:</span>
              {(['ALL',0.8,1.0,1.5,2.0] as const).map(v=>(
                <button key={String(v)} onClick={()=>setUsPegMax(p=>p===v?'ALL':v)} style={{fontSize:F.xs,fontWeight:700,padding:'4px 9px',borderRadius:6,
                  border:`1px solid ${usPegMax===v?GREEN+'60':BORDER}`,background:usPegMax===v?`${GREEN}14`:'transparent',color:usPegMax===v?GREEN:MUTED,cursor:'pointer'}}>
                  {v==='ALL'?'All':`<${v}`}
                </button>
              ))}

              <button onClick={()=>{setExpandAll(v=>!v);setExpRow(null);}} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,cursor:'pointer',border:`1px solid ${expandAll?ACCENT+'60':BORDER}`,background:expandAll?ACCENT+'14':'transparent',color:expandAll?ACCENT:MUTED}}>
                {expandAll?'⊟ Collapse All':'⊞ Expand All'}
              </button>
              <span style={{fontSize:F.xs,color:MUTED}}>{filtered.length} showing</span>
              {/* CSV Export USA */}
              {filtered.length > 0 && (
                <button onClick={async ()=>{
                  const XLSX = await import('xlsx');
                  const data = filtered.map(r=>({
                    Symbol:r.symbol, Company:r.company, Score:r.score, Grade:r.grade,
                    Sector:r.sector, Exchange:r.exchange, 'MCap $B':r.marketCapB,
                    'Rev Growth Ann %':r.revenueGrowthAnn, 'Rev Growth Qtr %':r.revenueGrowthQtr,
                    'Gross Margin %':r.grossMarginTtm??r.grossMarginAnn, 'FCF Margin %':r.fcfMarginAnn,
                    'OPM %':r.opmTtm, 'Net Margin %':r.netProfitMargin,
                    ROE:r.roe, ROIC:r.roic, 'EPS Growth %':r.epsGrowth,
                    'Fwd P/E':r.forwardPe, 'P/E':r.pe, 'PEG':r.peg,
                    'EV/EBITDA':r.evEbitda, 'P/S':r.ps,
                    'Rule of 40':r.ruleOf40, 'Accel Signal':r.accelSignal,
                    'Net Debt $':r.netDebtUsd, 'D/E':r.de,
                    '1Y Perf %':r.perf1y, 'Analyst Rating':r.analystRating,
                    'RSI 14':r.rsi14, 'P/FCF':r.pFcf, 'Next Earnings':r.nextEarnings,
                  }));
                  const ws = XLSX.utils.json_to_sheet(data);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'USA');
                  XLSX.writeFile(wb, `usa-multibagger-${new Date().toISOString().slice(0,10)}.csv`, {bookType:'csv'});
                }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${BORDER}`,background:'transparent',color:'#06b6d4',cursor:'pointer'}}>
                  ⬇ CSV
                </button>
              )}
              <button onClick={()=>{ if(window.confirm(`Clear all ${rows.length} stocks?`)){setRowsState([]);localStorage.removeItem(USA_STORAGE_KEY);setFileName('');} }} style={{fontSize:F.xs,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${RED}40`,background:`${RED}10`,color:RED,cursor:'pointer'}}>
                🗑 Clear
              </button>
            </div>
          </div>

          {/* PATCH 0367 — USA export toolbar. NSE/NYSE/NASDAQ tickers go to
              TradingView with the exchange prefix. Screener.in is India-only
              so no company-name remap here — TradingView handles it natively
              for US listings. Screener button still works (bare ticker
              fallback) but is mostly unused for US workflow. */}
          {filtered.length > 0 && (() => {
            // Use the first row's exchange to pick the TradingView prefix.
            // Most USA rows are NASDAQ; NYSE is the only common alternative.
            const firstExch = (filtered[0]?.exchange || '').toUpperCase();
            const tvExchange: 'NASDAQ' | 'NYSE' = firstExch.includes('NYSE') ? 'NYSE' : 'NASDAQ';
            return (
              <div style={{ margin: '10px 0' }}>
                <TickerExportToolbar
                  tickers={filtered.map(r => r.symbol).filter(Boolean)}
                  exchange={tvExchange}
                  filenameHint="multibagger-usa"
                  compact
                />
              </div>
            );
          })()}

          {/* Table Header — sortable */}
          {/* PATCH 0346 — Added dedicated R40 column (Quarterly Rev + FCF margin),
              made sortable. Grid now has 9 columns instead of 8. */}
          <div style={{display:'grid',gridTemplateColumns:'120px 140px 60px 55px 90px 100px 70px 1fr 60px',gap:8,padding:'10px 14px',fontSize:F.xs,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span>
            <span onClick={()=>handleUSASort('score')} style={{cursor:'pointer',color:usSortField==='score'?ACCENT:MUTED}}>SCORE{usSortIcon('score')}</span>
            <span>GRADE</span>
            <span onClick={()=>handleUSASort('fwdPe')} style={{cursor:'pointer',color:usSortField==='fwdPe'||usSortField==='peg'?YELLOW:MUTED}}>VAL{usSortIcon('fwdPe')}</span>
            <span onClick={()=>handleUSASort('revGrowthAnn')} style={{cursor:'pointer',color:usSortField==='revGrowthAnn'?GREEN:MUTED}}>ACCEL{usSortIcon('revGrowthAnn')}</span>
            <span onClick={()=>handleUSASort('ruleOf40')} style={{cursor:'pointer',color:usSortField==='ruleOf40'?'#a78bfa':MUTED}} title="Rule of 40 = Quarterly Rev Growth + FCF Margin (≥40 = institutional benchmark)">R40{usSortIcon('ruleOf40')}</span>
            <span onClick={()=>handleUSASort('grossMargin')} style={{cursor:'pointer',color:usSortField==='grossMargin'||usSortField==='fcfMargin'?'#a78bfa':MUTED}}>PILLARS{usSortIcon('grossMargin')}</span>
            <span onClick={()=>handleUSASort('marketCapB')} style={{cursor:'pointer',color:usSortField==='marketCapB'?ORANGE:MUTED}}>COV{usSortIcon('marketCapB')}</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expandAll||expRow===r.symbol;
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'12px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'120px 140px 60px 55px 90px 100px 70px 1fr 60px',gap:8,alignItems:'center'}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:5}}>
                        <span style={{fontSize:F.lg,fontWeight:800,color:TEXT}}>{r.symbol}</span>
                        {idx<3&&<span style={{fontSize:F.md}}>⭐</span>}
                      </div>
                      <span style={{fontSize:F.xs,color:MUTED}}>{r.exchange}</span>
                      {/* PATCH 0349 — risk + position-size chips, surfaced inline */}
                      {r.earningsProximityDays !== undefined && r.earningsProximityDays >= 0 && r.earningsProximityDays <= 7 && (
                        <div title={`Earnings in ${r.earningsProximityDays} day${r.earningsProximityDays===1?'':'s'} (${r.nextEarnings}). Gap risk elevated — institutional desks halve position size in this window.`}
                             style={{fontSize:9,fontWeight:800,color:RED,background:`${RED}18`,border:`1px solid ${RED}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          ⚠ EARNINGS {r.earningsProximityDays}d
                        </div>
                      )}
                      {r.postRunStretched && (
                        <div title={`+${r.perf1y?.toFixed(0)}% past year at FwdPE ${(r.forwardPe ?? r.pe)?.toFixed(0)}× — priced for perfection. Mean-reversion drag historically -15% to -20% from this setup.`}
                             style={{fontSize:9,fontWeight:800,color:YELLOW,background:`${YELLOW}18`,border:`1px solid ${YELLOW}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          🌡 STRETCHED
                        </div>
                      )}
                      {r.fcfOpDivergence && (
                        <div title={`FCF margin ${r.fcfMarginAnn?.toFixed(0)}% vs Op margin ${r.opmTtm?.toFixed(0)}% — FCF likely inflated by working-capital release / SBC add-back / deferred revenue, not sustainable from operations.`}
                             style={{fontSize:9,fontWeight:800,color:RED,background:`${RED}18`,border:`1px solid ${RED}40`,padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          🚨 FCF SUSPECT
                        </div>
                      )}
                      {r.suggestedMaxPositionPct !== undefined && (
                        <div title={`Position-size guidance based on market cap. Microcap volatility is structurally 2-3× large-cap, so size should reflect liquidity, not just composite score.`}
                             style={{fontSize:9,fontWeight:700,color:'#94a3b8',background:'rgba(148,163,184,0.10)',border:'1px solid rgba(148,163,184,0.25)',padding:'1px 5px',borderRadius:4,marginTop:2,display:'inline-block'}}>
                          MAX {r.suggestedMaxPositionPct}%
                        </div>
                      )}
                      {r.nextEarnings&&<div style={{fontSize:9,color:'#f59e0b'}}>📅 {r.nextEarnings}</div>}
                      {r.analystRating && (() => {
                        const rating = r.analystRating.toLowerCase();
                        const col = rating.includes('strong buy') ? GREEN : rating.includes('buy') ? '#34d399' : rating.includes('strong sell') ? RED : rating.includes('sell') ? ORANGE : MUTED;
                        return <div style={{fontSize:9,fontWeight:700,color:col}}>{r.analystRating}</div>;
                      })()}
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
                    {/* ACCEL cell — signal + QoQ/Annual % only (R40 moved to own column) */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.xs,fontWeight:700,color:r.accelSignal==='ACCELERATING'?GREEN:r.accelSignal==='DECELERATING'?RED:MUTED}}>
                        {r.accelSignal??'—'}
                      </span>
                      {r.revenueGrowthQtr !== undefined && <span style={{fontSize:10,color:MUTED}}>QoQ +{r.revenueGrowthQtr.toFixed(0)}%</span>}
                      {r.revenueGrowthAnn !== undefined && <span style={{fontSize:10,color:MUTED}}>Ann +{r.revenueGrowthAnn.toFixed(0)}%</span>}
                    </div>
                    {/* PATCH 0346 — R40 dedicated column: big number + tier color + composition */}
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                      {r.ruleOf40 !== undefined ? (
                        <>
                          <span style={{fontSize:F.lg,fontWeight:900,
                            color:r.ruleOf40>=80?GREEN:r.ruleOf40>=60?'#34d399':r.ruleOf40>=40?YELLOW:r.ruleOf40>=20?ORANGE:RED}}>
                            {r.ruleOf40}
                          </span>
                          <span style={{fontSize:9,color:MUTED}}>
                            {r.ruleOf40>=80?'🏆 elite':r.ruleOf40>=60?'strong':r.ruleOf40>=40?'passes':r.ruleOf40>=20?'weak':'fail'}
                          </span>
                          {r.revenueGrowthQtr !== undefined && r.fcfMarginAnn !== undefined && (
                            <span style={{fontSize:9,color:`${MUTED}90`}} title={`R40 = Qtr Rev ${r.revenueGrowthQtr.toFixed(0)}% + FCF ${r.fcfMarginAnn.toFixed(0)}%`}>
                              {r.revenueGrowthQtr.toFixed(0)}+{r.fcfMarginAnn.toFixed(0)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{fontSize:F.xs,color:`${MUTED}60`}}>—</span>
                      )}
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
                    {/* COV + score delta */}
                    <div style={{display:'flex',flexDirection:'column',gap:2}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}%</span>
                      {(() => {
                        const prev = usPrevScores[r.symbol];
                        if (prev===undefined) return null;
                        const d = r.score - prev;
                        if (d===0) return null;
                        return <span style={{fontSize:9,fontWeight:700,color:d>0?GREEN:RED}}>{d>0?`↑${d}`:`↓${Math.abs(d)}`}</span>;
                      })()}
                    </div>
                  </div>
                </button>
                {isExp&&(
                  <div style={{padding:'16px 14px 20px',backgroundColor:`${CARD_BG}CC`,borderTop:`1px solid ${BORDER}`}}>
                    {/* PATCH 0347 — Decision logbook bar (USA) */}
                    <DecisionBar symbol={r.symbol} company={r.company} market="US" score={r.score} grade={r.grade} bump={bumpUsDecisions} />
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

const STORAGE_KEY = 'mb_excel_scored_v2';
const STORAGE_META = 'mb_excel_meta_v2';

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0347 — DECISION BAR COMPONENT
// Used in both India and USA expanded rows.
// Shows 4 status buttons (BUY/WATCH/NEUTRAL/REJECTED) + reason input.
// Persists to localStorage via lib/decisions.ts — survives data clears.
// ═══════════════════════════════════════════════════════════════════════════
function DecisionBar({ symbol, company, market, score, grade, bump }: {
  symbol: string; company?: string; market: 'IN' | 'US';
  score?: number; grade?: string; bump: () => void;
}) {
  const existing = getDecision(symbol);
  const [reason, setReason] = React.useState(existing?.reason ?? '');
  const [status, setStatus] = React.useState<DecisionStatus | undefined>(existing?.status);
  React.useEffect(() => {
    // Re-sync when symbol changes
    const e = getDecision(symbol);
    setReason(e?.reason ?? '');
    setStatus(e?.status);
  }, [symbol]);

  const apply = (newStatus: DecisionStatus) => {
    setStatus(newStatus);
    setDecision({
      symbol, market, status: newStatus, reason,
      company, scoreAtDecision: score, gradeAtDecision: grade,
    });
    bump();
  };
  const onSaveReason = () => {
    if (!status) return;
    setDecision({
      symbol, market, status, reason,
      company, scoreAtDecision: score, gradeAtDecision: grade,
    });
    bump();
  };
  const onClear = () => {
    clearDecision(symbol);
    setStatus(undefined);
    setReason('');
    bump();
  };

  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px',
      backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.7px', color: '#38bdf8' }}>
          📒 DECISION LOG{existing && ` · last updated ${new Date(existing.date).toLocaleDateString()}`}
        </span>
        {(['BUY', 'WATCH', 'NEUTRAL', 'REJECTED'] as DecisionStatus[]).map(s => {
          const meta = DECISION_META[s];
          const active = status === s;
          return (
            <button key={s} onClick={() => apply(s)}
              style={{
                fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${active ? meta.color + 'AA' : '#1e293b'}`,
                background: active ? `${meta.color}25` : 'transparent',
                color: active ? meta.color : '#94a3b8',
              }}>
              {meta.emoji} {meta.label}
            </button>
          );
        })}
        {status && (
          <button onClick={onClear} style={{
            fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid #1e293b', background: 'transparent', color: '#94a3b8', marginLeft: 'auto',
          }} title="Remove this decision">
            ✕ Clear
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={onSaveReason}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSaveReason(); } }}
          placeholder="Why? Add your reason — saved permanently even if you clear the list"
          style={{
            flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6,
            background: '#0a1124', border: '1px solid #1e293b', color: '#e2e8f0', outline: 'none',
          }}
        />
        <button onClick={onSaveReason}
          style={{
            fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #38bdf860', background: '#38bdf818', color: '#38bdf8',
          }}>
          💾 Save
        </button>
      </div>
      {existing && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#64748b' }}>
          Decision recorded when score was <strong style={{ color: '#94a3b8' }}>{existing.scoreAtDecision ?? '—'} {existing.gradeAtDecision ?? ''}</strong>.
          This persists even after you clear your upload — useful as a personal logbook.
        </div>
      )}
    </div>
  );
}

// Compact decision badge for collapsed rows
function DecisionBadge({ symbol }: { symbol: string }) {
  const d = getDecision(symbol);
  if (!d) return null;
  const meta = DECISION_META[d.status];
  return (
    <span
      title={`${meta.label}${d.reason ? ' — ' + d.reason : ''} · ${new Date(d.date).toLocaleDateString()}`}
      style={{
        fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
        color: meta.color, background: meta.color + '20', border: `1px solid ${meta.color}50`,
      }}>
      {meta.emoji} {meta.label}
    </span>
  );
}

// PATCH 0347 — Cross-market upload detection.
// USA TradingView CSV has these unique headers; India Screener CSV does not.
function detectCsvMarket(headers: string[]): 'IN' | 'US' | 'UNKNOWN' {
  const h = headers.map(x => x.toLowerCase());
  // USA-specific TradingView column names
  const usaSignals = ['forward non-gaap', 'piotroski f-score', 'altman z-score', 'free cash flow margin', 'analyst rating'];
  // India-specific Screener.in column names
  const indiaSignals = ['promoter holding', 'promoter %', 'sales growth', 'roce', 'pledged', 'change in promoter'];
  const usaHits = usaSignals.filter(s => h.some(x => x.includes(s))).length;
  const indiaHits = indiaSignals.filter(s => h.some(x => x.includes(s))).length;
  if (usaHits >= 2 && usaHits > indiaHits) return 'US';
  if (indiaHits >= 2 && indiaHits > usaHits) return 'IN';
  return 'UNKNOWN';
}

export default function MultibaggerPage() {
  const [activeTab, setActiveTab] = useState<'excel'|'usa'|'turnaround'|'usa-checklist'|'checklist'|'capital-alloc'|'reference'>('excel');
  // PATCH 0347 — Listen for cross-market tab-switch events fired from upload handlers
  React.useEffect(() => {
    const onSwitch = (e: Event) => {
      const ce = e as CustomEvent<{ tab: 'excel' | 'usa' }>;
      if (ce.detail?.tab === 'usa' || ce.detail?.tab === 'excel') setActiveTab(ce.detail.tab);
    };
    window.addEventListener('mc:switch-multibagger-tab', onSwitch);
    return () => window.removeEventListener('mc:switch-multibagger-tab', onSwitch);
  }, []);

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
        <div style={{maxWidth:1800,margin:'0 auto'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,gap:12}}>
            <div>
              <h1 style={{fontSize:F.h1,fontWeight:900,color:PURPLE,margin:0}}>🚀 Multibagger Research Engine</h1>
              <p style={{fontSize:F.md,color:MUTED,margin:'5px 0 0'}}>
                SQGLP (MOSL 100×) · Fisher 100-Bagger · Multibagger Framework · Upload Screener.in → instant institutional scoring
              </p>
            </div>
            {/* Tab-specific clear buttons — India and USA are independent datasets */}
            {(activeTab==='excel'||activeTab==='checklist') && excelRows.length > 0 && (
              <button
                onClick={() => { if (window.confirm(`Clear all ${excelRows.length} India stocks? This cannot be undone.`)) clearExcelRows(); }}
                style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
              >
                🗑 Clear India Data ({excelRows.length})
              </button>
            )}
            {(activeTab==='usa'||activeTab==='usa-checklist') && (() => {
              try {
                const d = JSON.parse(localStorage.getItem('mb_usa_scored_v1')||'[]');
                const count = Array.isArray(d) ? d.length : 0;
                if (count === 0) return null;
                return (
                  <button
                    onClick={() => { if (window.confirm(`Clear all ${count} USA stocks? This cannot be undone.`)) { localStorage.removeItem('mb_usa_scored_v1'); window.location.reload(); } }}
                    style={{padding:'8px 16px',backgroundColor:`${RED}14`,border:`1px solid ${RED}40`,borderRadius:8,color:RED,fontSize:F.sm,fontWeight:700,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}
                  >
                    🗑 Clear USA Data ({count})
                  </button>
                );
              } catch { return null; }
            })()}
          </div>
          <div style={{display:'flex',gap:0}}>
            {([
              {id:'excel',    label:'🇮🇳 India Multibagger Ranking'},
              {id:'usa',           label:'🇺🇸 USA Multibagger'},
              // PATCH 0370 — Turnaround tab (specialized scoring for distressed-to-recovery setups)
              {id:'turnaround',    label:'🔄 Turnarounds'},
              {id:'usa-checklist', label:'🇺🇸 USA Checklist'},
              {id:'checklist',label:`📋 Research Checklist${excelRows.length?` (${excelRows.length} loaded)`:''}`},
              {id:'capital-alloc', label:'💰 Capital Allocation'},
              {id:'reference',     label:'📚 Multibagger Reference'},
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
      {activeTab==='turnaround'    && <TurnaroundCompare />}
      {activeTab==='usa-checklist'&& <USAChecklist />}
      {activeTab==='checklist' && <MultibaggerChecklist excelRows={excelRows} />}
      {activeTab==='capital-alloc' && <CapitalAllocationPanel />}
      {activeTab==='reference'     && <MultibaggerReference excelRows={excelRows} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0370 — TURNAROUND COMPARE TAB
//
// Specialised view for distressed-to-recovery setups. Different from
// regular Multibagger because:
//   - 7-dimension scoring (earnings inflection / op reset / balance sheet
//     repair / concall narrative / industry tailwind / governance / valuation)
//   - Stage classifier: DISTRESS → EARLY-SHOOTS → PATTERN → CONFIRMED → MATURE
//   - BUY-ZONE filter highlights Early-Shoots + Pattern stages (the alpha
//     window before consensus arrives)
//   - Concall paste-text per row contributes to scoring (15 of 100 pts)
// ═══════════════════════════════════════════════════════════════════════════

const TURNAROUND_STORAGE_KEY = 'mb_turnaround_scored_v1';
const TURNAROUND_CONCALLS_KEY = 'mb_turnaround_concalls_v1';

function TurnaroundCompare() {
  const [rows, setRows] = useState<TurnaroundResult[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(TURNAROUND_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      // Re-score on load so any code changes apply
      return parsed.map((r: any) => scoreTurnaroundRow(r)).sort((a, b) => b.totalScore - a.totalScore);
    } catch { return []; }
  });
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [expRow, setExpRow] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<TurnaroundStage | 'BUY-ZONE' | 'ALL'>('ALL');
  // PATCH 0374 — Archetype filter so user can hide growth/quality/value-trap rows
  const [archetypeFilter, setArchetypeFilter] = useState<TurnaroundArchetype | 'ALL'>('ALL');
  const [showOnlyHighConcall, setShowOnlyHighConcall] = useState(false);
  const [showLossRecovery, setShowLossRecovery] = useState(false);
  // Concall map: ticker -> pasted text
  const [concallMap, setConcallMap] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(TURNAROUND_CONCALLS_KEY) || '{}'); } catch { return {}; }
  });

  // Persist concall map and trigger re-score when concall changes for a symbol
  const updateConcall = useCallback((symbol: string, text: string) => {
    setConcallMap(prev => {
      const next = { ...prev, [symbol]: text };
      try { localStorage.setItem(TURNAROUND_CONCALLS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    // Re-score this row
    setRows(prev => prev.map(r => {
      if (r.symbol !== symbol) return r;
      return scoreTurnaroundRow({ ...r, concallText: text });
    }).sort((a, b) => b.totalScore - a.totalScore));
  }, []);

  // PATCH 0374 — Multi-CSV upload: APPEND new rows to existing, dedupe by symbol
  // (most recent upload wins). User typically has several Screener screens
  // (e.g. 'Loss recovery candidates', 'Sector turnaround', 'Microcap turnaround')
  // and wants to pool them into one analysis.
  const handleFile = async (file: File) => {
    setParseError(null);
    try {
      const text = await file.text();
      const parsed = parseCsvFlexible(text);
      if (parsed.length === 0) throw new Error('No rows parsed from CSV');
      const tRows = parsed
        .map(r => parseTurnaroundRow(r))
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map(r => ({ ...r, concallText: concallMap[r.symbol] || '' }));
      if (tRows.length === 0) throw new Error('No valid tickers found in CSV');
      const newScored = tRows.map(scoreTurnaroundRow);

      // Dedupe: build a map by symbol, new CSV wins
      const merged = new Map<string, TurnaroundResult>();
      for (const r of rows) merged.set(r.symbol, r);  // existing
      for (const r of newScored) merged.set(r.symbol, r);  // new overrides
      const finalRows = Array.from(merged.values()).sort((a, b) => b.totalScore - a.totalScore);

      setRows(finalRows);
      const fileList = fileName ? `${fileName}, ${file.name}` : file.name;
      setFileName(fileList);
      try { localStorage.setItem(TURNAROUND_STORAGE_KEY, JSON.stringify(finalRows)); } catch {}
    } catch (e: any) {
      setParseError(e?.message || 'CSV parse failed');
    }
  };

  // Filter chain
  const filtered = useMemo(() => {
    let out = rows;
    if (stageFilter === 'BUY-ZONE') {
      out = out.filter(r => r.inBuyZone);
    } else if (stageFilter !== 'ALL') {
      out = out.filter(r => r.stage === stageFilter);
    }
    // PATCH 0374 — archetype filter
    if (archetypeFilter !== 'ALL') {
      out = out.filter(r => r.archetype === archetypeFilter);
    }
    if (showOnlyHighConcall) {
      out = out.filter(r => r.concallScore >= 8);
    }
    if (showLossRecovery) {
      out = out.filter(r =>
        (r.lossMakingYears5y ?? 0) >= 1 &&
        r.patQ1 != null && r.patQ1 > 0
      );
    }
    return out;
  }, [rows, stageFilter, archetypeFilter, showOnlyHighConcall, showLossRecovery]);

  // Stage + archetype counts
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, 'BUY-ZONE': 0, DISTRESS: 0, SETUP: 0, 'EARLY-SHOOTS': 0, PATTERN: 0, CONFIRMED: 0, MATURE: 0 };
    for (const r of rows) {
      c[r.stage]++;
      if (r.inBuyZone) c['BUY-ZONE']++;
    }
    return c;
  }, [rows]);

  // PATCH 0374 — Archetype counts for the new filter rail
  const archetypeCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length, TURNAROUND: 0, GROWTH: 0, QUALITY: 0, 'VALUE-TRAP': 0, DECLINING: 0, WAIT: 0, NEUTRAL: 0 };
    for (const r of rows) c[r.archetype]++;
    return c;
  }, [rows]);

  // Company-name map for Screener export
  const tickerCompanyMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of filtered) {
      if (r.symbol && r.company) m[r.symbol.toUpperCase()] = r.company;
    }
    return m;
  }, [filtered]);

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: F.h2, fontWeight: 800, color: '#22D3EE', margin: 0, marginBottom: 5 }}>
          🔄 Turnaround Research Engine
        </h2>
        <p style={{ fontSize: F.sm, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Earnings power restoration scoring · 7 dimensions · Stage classifier · Concall narrative weighted heavily.
          Upload Screener.in CSV with quarterly P&L columns. Paste concall narrative per row to unlock the full 15-point Concall dimension.
        </p>
      </div>

      {/* PATCH 0374 — Upload + Add Another CSV (multi-file pool) */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', backgroundColor: rows.length === 0 ? '#22D3EE' : '#A78BFA', color: '#0A0E1A', borderRadius: 8, fontWeight: 800, fontSize: F.sm, cursor: 'pointer' }}>
          📁 {rows.length === 0 ? 'Upload Screener.in CSV' : `+ Add another CSV (pool with ${rows.length} existing)`}
          <input type="file" accept=".csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.target.value = ''; } }} style={{ display: 'none' }} />
        </label>
        {fileName && <span style={{ fontSize: F.xs, color: MUTED }}>{fileName} · {rows.length} unique rows</span>}
        {parseError && <span style={{ fontSize: F.xs, color: RED, fontWeight: 700 }}>⚠ {parseError}</span>}
        {rows.length > 0 && (
          <button
            onClick={() => { if (window.confirm(`Clear all ${rows.length} turnaround rows?`)) { setRows([]); localStorage.removeItem(TURNAROUND_STORAGE_KEY); setFileName(''); } }}
            style={{ marginLeft: 'auto', padding: '6px 14px', backgroundColor: `${RED}14`, border: `1px solid ${RED}40`, borderRadius: 6, color: RED, fontSize: F.xs, fontWeight: 700, cursor: 'pointer' }}>
            🗑 Clear All
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div style={{ padding: 24, border: '1px dashed #1A2840', borderRadius: 10, color: MUTED, fontSize: F.sm, lineHeight: 1.6 }}>
          <strong style={{ color: '#22D3EE' }}>How to use:</strong>
          <ol style={{ marginTop: 8, paddingLeft: 22 }}>
            <li>Build a Screener.in custom screen (e.g. "PAT growth &gt; 50%" or "Loss making years &gt; 0 AND latest qtr PAT &gt; 0")</li>
            <li>Export columns to CSV — see <strong style={{ color: '#FBBF24' }}>📚 Required Fields</strong> below</li>
            <li>Upload here — every row gets scored across 7 dimensions and classified into a stage</li>
            <li>BUY-ZONE = Early-Shoots + Pattern stages. These are the alpha entries before consensus arrives.</li>
            <li>Expand any row to paste concall narrative (unlocks 15-pt Concall dimension)</li>
          </ol>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#FBBF24', fontWeight: 700 }}>📚 Screener.in column names (use these exact strings in 'Edit Columns')</summary>
            <div style={{ marginTop: 10, fontSize: F.xs, lineHeight: 1.6 }}>
              <p><strong style={{ color: '#10B981' }}>✅ AVAILABLE in Screener — add these (engine-critical):</strong></p>
              <ul style={{ margin: '4px 0 8px 18px', padding: 0 }}>
                <li><strong>Quarterly trail:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>Sales Qtr Rs.Cr. · Sales Prev Qtr Rs.Cr. · Sales 2Qtr Bk Rs.Cr. · Sales 3Qtr Bk Rs.Cr.</code></li>
                <li><strong>PAT trail:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>PAT Qtr Rs.Cr. · PAT Prev Qtr Rs.Cr. · NP 2Qtr Bk Rs.Cr. · NP 3Qtr Bk Rs.Cr.</code></li>
                <li><strong>YoY signals:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>Qtr Profit Var % · Qtr Sales Var % · Profit Var 3Yrs % · Sales Var 3Yrs %</code></li>
                <li><strong>Operating:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>OPM % · OPM Qtr % · ROCE % · ROCE 3Yr % · ROIC % · CFO/PAT</code></li>
                <li><strong>Balance sheet:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>Debt Rs.Cr. · Debt / Eq · Int Coverage · WC Days · WC Days 3yrs</code></li>
                <li><strong>Governance:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>Prom. Hold. % · Chg in Prom Hold 3Yr % · Pledged % · FII Hold % · DII Hold %</code></li>
                <li><strong>Valuation:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>P/E · PEG · EV / EBITDA · From 52w high · Ind PE · CMP / BV</code></li>
                <li><strong>Returns:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>1Yr return %</code></li>
                <li><strong>Annual:</strong> <code style={{ fontSize: 10, color: '#94A3B8' }}>Sales Rs.Cr. · Mar Cap Rs.Cr. · EPS 12M Rs. · Free Cash Flow Rs.Cr. · Sales growth % · Profit growth %</code></li>
              </ul>

              <p style={{ marginTop: 10 }}><strong style={{ color: '#F59E0B' }}>⚠️ NOT in Screener (engine scores 0 for these dimensions — that's OK):</strong></p>
              <ul style={{ margin: '4px 0 8px 18px', padding: 0, color: MUTED }}>
                <li><code style={{ fontSize: 10 }}>OPM Prev Qtr / OPM 2Qtr Bk / OPM 3Qtr Bk</code> — Screener only exposes current quarter OPM. Sequential OPM trend signal (3 pts) will be 0.</li>
                <li><code style={{ fontSize: 10 }}>EPS Prev Qtr / EPS 2Qtr Bk / EPS 3Qtr Bk</code> — same, EPS trail not available.</li>
                <li><code style={{ fontSize: 10 }}>Loss making years</code> — Screener may have this; check 'Edit Columns' search. If not, add manually for distressed candidates.</li>
                <li><code style={{ fontSize: 10 }}>PE 5Yrs Median</code> — Screener has this internally but may not export. Falls back to absolute-PE buckets.</li>
                <li><code style={{ fontSize: 10 }}>Debt 3yrs back / Interest Coverage 3yrs back</code> — debt-reduction trajectory degrades. Can still score from current values.</li>
                <li><code style={{ fontSize: 10 }}>Sales/PAT 5Yr back annual values</code> — annual 5y trail not in Screener export.</li>
                <li><code style={{ fontSize: 10 }}>Auditor changes</code> — not exposed by Screener; manual flag only.</li>
              </ul>

              <p style={{ marginTop: 10 }}><strong style={{ color: '#22D3EE' }}>Smart aliases:</strong> the parser already maps your real column names — just upload the CSV as-is from Screener and the engine will recognise everything.</p>
            </div>
          </details>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Total', value: rows.length, color: '#94A3B8' },
              { label: 'BUY-ZONE', value: stageCounts['BUY-ZONE'], color: '#10B981' },
              { label: '🚫 DISTRESS', value: stageCounts.DISTRESS, color: '#EF4444' },
              { label: '🌱 EARLY-SHOOTS', value: stageCounts['EARLY-SHOOTS'], color: '#F59E0B' },
              { label: '📈 PATTERN', value: stageCounts.PATTERN, color: '#22D3EE' },
              { label: '✅ CONFIRMED', value: stageCounts.CONFIRMED, color: '#10B981' },
              { label: '🌅 MATURE', value: stageCounts.MATURE, color: '#94A3B8' },
            ].map(s => (
              <div key={s.label} style={{ padding: '8px 14px', backgroundColor: '#13131a', border: `1px solid ${s.color}40`, borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.4px' }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* PATCH 0374 — Archetype filter rail (TOP — most useful for user
              who mostly uploads turnarounds but wants to spot mis-categorised
              rows like growth stocks, quality compounders, value traps). */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, marginRight: 4 }}>ARCHETYPE:</span>
            {([
              { id: 'ALL',         label: 'All',           color: '#94A3B8' },
              { id: 'TURNAROUND',  label: '🔄 Turnaround', color: '#F59E0B' },
              { id: 'GROWTH',      label: '🚀 Growth',     color: '#10B981' },
              { id: 'QUALITY',     label: '💎 Quality',    color: '#22D3EE' },
              { id: 'WAIT',        label: '⏸ Wait',        color: '#94A3B8' },
              { id: 'VALUE-TRAP',  label: '🧊 Value trap', color: '#EF4444' },
              { id: 'DECLINING',   label: '📉 Declining',  color: '#EF4444' },
              { id: 'NEUTRAL',     label: '❓ Neutral',    color: '#6B7A8D' },
            ] as const).map(a => {
              const active = archetypeFilter === a.id;
              return (
                <button key={a.id} onClick={() => setArchetypeFilter(a.id)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? a.color : BORDER}`, background: active ? `${a.color}20` : 'transparent', color: active ? a.color : MUTED, cursor: 'pointer' }}>
                  {a.label} · {archetypeCounts[a.id] ?? 0}
                </button>
              );
            })}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: F.xs, color: MUTED, fontWeight: 700, marginRight: 4 }}>STAGE:</span>
            {(['ALL', 'BUY-ZONE', 'EARLY-SHOOTS', 'PATTERN', 'CONFIRMED', 'MATURE', 'SETUP', 'DISTRESS'] as const).map(s => {
              const active = stageFilter === s;
              const color = s === 'BUY-ZONE' ? '#10B981' : s === 'EARLY-SHOOTS' ? '#F59E0B' : s === 'PATTERN' ? '#22D3EE' : s === 'CONFIRMED' ? '#10B981' : s === 'SETUP' ? '#A78BFA' : s === 'MATURE' ? '#94A3B8' : s === 'DISTRESS' ? '#EF4444' : '#94A3B8';
              return (
                <button key={s} onClick={() => setStageFilter(s)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${active ? color : BORDER}`, background: active ? `${color}20` : 'transparent', color: active ? color : MUTED, cursor: 'pointer' }}>
                  {s} {stageCounts[s] !== undefined && `· ${stageCounts[s]}`}
                </button>
              );
            })}
            <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
            <button onClick={() => setShowOnlyHighConcall(v => !v)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showOnlyHighConcall ? '#A78BFA' : BORDER}`, background: showOnlyHighConcall ? '#A78BFA20' : 'transparent', color: showOnlyHighConcall ? '#A78BFA' : MUTED, cursor: 'pointer' }}>
              🎙 High Concall {showOnlyHighConcall ? '✓' : ''}
            </button>
            <button onClick={() => setShowLossRecovery(v => !v)} style={{ fontSize: F.xs, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: `1px solid ${showLossRecovery ? '#FBBF24' : BORDER}`, background: showLossRecovery ? '#FBBF2420' : 'transparent', color: showLossRecovery ? '#FBBF24' : MUTED, cursor: 'pointer' }}>
              💎 Loss→Profit recovery {showLossRecovery ? '✓' : ''}
            </button>
            <span style={{ marginLeft: 'auto', fontSize: F.xs, color: MUTED }}>{filtered.length} showing</span>
          </div>

          {/* Export toolbar */}
          {filtered.length > 0 && (
            <div style={{ margin: '10px 0' }}>
              <TickerExportToolbar
                tickers={filtered.map(r => r.symbol).filter(Boolean)}
                exchange="NSE"
                filenameHint="turnarounds"
                tickerCompanyMap={tickerCompanyMap}
                compact
              />
            </div>
          )}

          {/* Rows */}
          <div style={{ marginTop: 6 }}>
            {filtered.map((r) => {
              const isExp = expRow === r.symbol;
              return (
                <div key={r.symbol} style={{ borderBottom: `1px solid rgba(255,255,255,0.05)`, background: isExp ? '#13131a' : 'transparent' }}>
                  <button onClick={() => setExpRow(isExp ? null : r.symbol)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 14px', color: 'inherit' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 70px 1fr 110px 70px', gap: 10, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: F.md, fontWeight: 800, color: TEXT }}>{r.symbol}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>{r.exchange}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: F.sm, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
                        <div style={{ fontSize: 9, color: MUTED }}>{r.sector || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: F.h2, fontWeight: 900, color: '#A78BFA' }}>{r.totalScore}</div>
                        <div style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{r.grade}</div>
                      </div>
                      <div>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 4, background: `${r.stageColor}20`, color: r.stageColor, border: `1px solid ${r.stageColor}40` }}>
                          {r.stageEmoji} {r.stage}
                        </span>
                        {r.inBuyZone && <div style={{ fontSize: 9, fontWeight: 800, color: '#10B981', marginTop: 3 }}>🎯 BUY-ZONE</div>}
                        {/* PATCH 0374 — Archetype badge */}
                        <div title={r.archetypeNote}
                          style={{ fontSize: 9, fontWeight: 800, color: r.archetypeColor, marginTop: 3, padding: '1px 5px', display: 'inline-block', borderRadius: 3, background: `${r.archetypeColor}15`, border: `1px solid ${r.archetypeColor}40` }}>
                          {r.archetypeLabel}
                        </div>
                      </div>
                      {/* Dimension bars */}
                      <div style={{ display: 'flex', gap: 5 }}>
                        {[
                          { label: 'EARN', val: r.earningsScore, max: 25, color: '#10B981' },
                          { label: 'OPS', val: r.operationalScore, max: 15, color: '#22D3EE' },
                          { label: 'BAL', val: r.balanceSheetScore, max: 15, color: '#A78BFA' },
                          { label: 'CC', val: r.concallScore, max: 15, color: '#F59E0B' },
                          { label: 'IND', val: r.industryScore, max: 10, color: '#34d399' },
                          { label: 'GOV', val: r.governanceScore, max: 10, color: '#fbbf24' },
                          { label: 'VAL', val: r.valuationScore, max: 10, color: '#f97316' },
                        ].map(d => {
                          const pct = (d.val / d.max) * 100;
                          return (
                            <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 30 }}>
                              <span style={{ fontSize: 10, fontWeight: 800, color: d.color }}>{Math.round(d.val)}</span>
                              <div style={{ width: 24, height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                                <div style={{ height: '100%', width: `${pct}%`, backgroundColor: d.color, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 8, color: MUTED }}>{d.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>
                        <div style={{ color: r.pe != null ? TEXT : MUTED }}>PE {r.pe?.toFixed(0) ?? '—'}</div>
                        <div>ROCE {r.roce?.toFixed(0) ?? '—'}</div>
                      </div>
                      <div style={{ fontSize: 10, color: r.coverage >= 70 ? GREEN : r.coverage >= 50 ? '#FBBF24' : '#EF4444', textAlign: 'center', fontWeight: 700 }}>
                        {r.coverage}%
                      </div>
                    </div>
                  </button>
                  {isExp && (
                    <div style={{ padding: '4px 14px 16px', background: '#13131a' }}>
                      {/* PATCH 0374 — Archetype diagnostic block: tells the user
                          IMMEDIATELY whether this row belongs in the Turnaround
                          tab, and if not, what it actually is. */}
                      <div style={{ marginBottom: 12, padding: '10px 12px', background: `${r.archetypeColor}10`, border: `1px solid ${r.archetypeColor}40`, borderRadius: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: r.archetypeColor, letterSpacing: '0.4px', marginBottom: 3 }}>
                          {r.archetypeLabel} — verdict
                        </div>
                        <div style={{ fontSize: 11, color: '#C9D4E0', lineHeight: 1.5 }}>{r.archetypeNote}</div>
                      </div>
                      {/* PATCH 0374 — Missing-fields hint when coverage is low */}
                      {r.coverage < 70 && r.missingFields.length > 0 && (
                        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#F59E0B12', border: '1px solid #F59E0B40', borderRadius: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#F59E0B', letterSpacing: '0.4px', marginBottom: 4 }}>
                            ⚠ DATA COVERAGE {r.coverage}% — {r.missingFields.length} fields missing
                          </div>
                          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
                            Not in this CSV: <strong style={{ color: '#C9D4E0' }}>{r.missingFields.join(' · ')}</strong>
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                        {/* Inflection Signals */}
                        <div>
                          <div style={{ fontSize: 10, color: '#10B981', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>📈 INFLECTION SIGNALS</div>
                          {r.inflectionSignals.length > 0 ? r.inflectionSignals.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: '#C9D4E0', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No earnings inflection detected yet</div>}
                        </div>
                        {/* Quarterly trail */}
                        <div>
                          <div style={{ fontSize: 10, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>📊 QUARTERLY TRAIL</div>
                          <div style={{ fontSize: 10, color: MUTED, fontFamily: 'ui-monospace, monospace' }}>
                            <div>Sales: {r.salesQ4?.toFixed(0) ?? '—'} → {r.salesQ3?.toFixed(0) ?? '—'} → {r.salesQ2?.toFixed(0) ?? '—'} → <span style={{ color: TEXT }}>{r.salesQ1?.toFixed(0) ?? '—'}</span></div>
                            <div>OPM: {r.opmQ4?.toFixed(0) ?? '—'}% → {r.opmQ3?.toFixed(0) ?? '—'}% → {r.opmQ2?.toFixed(0) ?? '—'}% → <span style={{ color: TEXT }}>{r.opmQ1?.toFixed(0) ?? '—'}%</span></div>
                            <div>PAT: {r.patQ4?.toFixed(0) ?? '—'} → {r.patQ3?.toFixed(0) ?? '—'} → {r.patQ2?.toFixed(0) ?? '—'} → <span style={{ color: (r.patQ1 ?? 0) > 0 ? '#10B981' : '#EF4444' }}>{r.patQ1?.toFixed(0) ?? '—'}</span></div>
                            <div>EPS: {r.epsQ4?.toFixed(1) ?? '—'} → {r.epsQ3?.toFixed(1) ?? '—'} → {r.epsQ2?.toFixed(1) ?? '—'} → <span style={{ color: TEXT }}>{r.epsQ1?.toFixed(1) ?? '—'}</span></div>
                          </div>
                        </div>
                        {/* Concall paste */}
                        <div>
                          <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>🎙 CONCALL NARRATIVE — paste to unlock score</div>
                          <textarea
                            value={concallMap[r.symbol] || ''}
                            onChange={(e) => updateConcall(r.symbol, e.target.value)}
                            placeholder="Paste recent concall transcript / Q&A / management commentary. Engine auto-detects institutional phrases (capacity expansion, margin recovery, deleveraging, demand recovery, etc.) and scores up to 15 points."
                            style={{ width: '100%', minHeight: 90, padding: '6px 9px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 4, color: '#E6EDF3', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                          />
                          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
                            Concall score: <span style={{ color: r.concallScore >= 8 ? '#10B981' : r.concallScore >= 4 ? '#F59E0B' : MUTED, fontWeight: 700 }}>{r.concallScore.toFixed(1)} / 15</span>
                            {r.concallPhrases.length > 0 && <> · phrases: {r.concallPhrases.join(', ')}</>}
                          </div>
                        </div>
                      </div>

                      {/* Strengths + Risks */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 10, color: '#10B981', fontWeight: 800, marginBottom: 5 }}>✅ STRENGTHS</div>
                          {r.strengths.length > 0 ? r.strengths.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: '#C9D4E0', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No notable strengths captured yet</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: '#EF4444', fontWeight: 800, marginBottom: 5 }}>⚠️ RISKS</div>
                          {r.risks.length > 0 ? r.risks.map((s, i) => (
                            <div key={i} style={{ fontSize: 11, color: '#C9D4E0', padding: '2px 0' }}>› {s}</div>
                          )) : <div style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>No specific risks flagged</div>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Lightweight CSV parser used by TurnaroundCompare. Handles quoted commas, BOM, trimming.
function parseCsvFlexible(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0057 — HISTORICAL MULTIBAGGER REFERENCE PANEL
//
// Renders HISTORICAL_MULTIBAGGERS[] as cards so users can compare their
// uploaded stocks against canonical 100×–500× winners at the moment they
// were buyable. Includes pattern-matching: which canonical stock looks
// most similar to each upload.
// ═══════════════════════════════════════════════════════════════════════════

function MultibaggerReference({ excelRows }: { excelRows: ExcelResult[] }) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [filterMatch, setFilterMatch] = useState(false);

  // Pattern-match each canonical stock against the user's uploads
  const matches: Record<string, ExcelResult[]> = useMemo(() => {
    const out: Record<string, ExcelResult[]> = {};
    for (const hist of HISTORICAL_MULTIBAGGERS) {
      const matched = excelRows.filter(r => {
        // Multibagger archetype scoring — how closely does this stock match
        // the historical pattern at its entry point?
        let pts = 0;
        // Market cap proximity (within 3x band)
        if (r.marketCapCr !== undefined) {
          const ratio = r.marketCapCr / hist.market_cap_cr;
          if (ratio >= 0.3 && ratio <= 5) pts += 2;
        }
        // ROCE within ±8pp
        if (r.roce !== undefined && Math.abs(r.roce - hist.roce_pct) <= 8) pts += 2;
        // Profit CAGR within ±15pp
        if (r.profitCagr !== undefined && Math.abs(r.profitCagr - hist.profit_cagr_pct) <= 15) pts += 2;
        // Dilution drag similar (within ±3pp)
        if (r.dilution?.drag_pp !== null && r.dilution?.drag_pp !== undefined &&
            Math.abs(r.dilution.drag_pp - hist.dilution_drag_pp) <= 3) pts += 1;
        // Promoter holding within ±15pp
        if (r.promoter !== undefined && Math.abs(r.promoter - hist.promoter_pct) <= 15) pts += 2;
        // FII+DII within ±10pp
        if (r.fiiPlusDii !== undefined && Math.abs(r.fiiPlusDii - hist.fii_dii_pct) <= 10) pts += 1;
        return pts >= 5; // need a meaningful number of matching dimensions
      });
      out[hist.ticker] = matched;
    }
    return out;
  }, [excelRows]);

  return (
    <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:F.h2,fontWeight:800,color:TEXT,margin:'0 0 6px'}}>
          📚 Historical 100×–500× Reference
        </h2>
        <p style={{fontSize:F.md,color:MUTED,margin:0,lineHeight:1.5}}>
          Each canonical multibagger profiled at the moment it was buyable. Compare against your
          uploaded stocks to see which historical pattern your candidates resemble. The framework
          uses these to validate scoring calibration — every one of these scored
          {' '}<span style={{color:GREEN,fontWeight:600}}>BUILDING or COMPOUNDING (76-87)</span>{' '}
          on the patch 0055 reinvestment engine at their entry year.
        </p>
        {excelRows.length > 0 && (
          <label style={{display:'flex',alignItems:'center',gap:6,marginTop:10,fontSize:F.md,color:MUTED,cursor:'pointer'}}>
            <input
              type="checkbox"
              checked={filterMatch}
              onChange={e => setFilterMatch(e.target.checked)}
            />
            <span>Show only canonical stocks with at least one match in your {excelRows.length} uploaded stocks</span>
          </label>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))',gap:14}}>
        {HISTORICAL_MULTIBAGGERS
          .filter(h => !filterMatch || (matches[h.ticker]?.length ?? 0) > 0)
          .map(h => {
            const isOpen = expandedCard === h.ticker;
            const matchedStocks = matches[h.ticker] ?? [];
            return (
              <div key={h.ticker} style={{
                backgroundColor:CARD_BG,
                border:`1px solid ${BORDER}`,
                borderLeft:`3px solid ${PURPLE}`,
                borderRadius:10,
                padding:'12px 14px',
              }}>
                <div
                  onClick={() => setExpandedCard(isOpen ? null : h.ticker)}
                  style={{cursor:'pointer'}}
                >
                  <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8,marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                      <span style={{fontSize:F.h2,fontWeight:800,color:TEXT}}>{h.name}</span>
                      <span style={{fontSize:F.xs,color:MUTED}}>{h.entry_year}</span>
                    </div>
                    <span style={{fontSize:F.h2,fontWeight:900,color:GREEN}}>
                      {h.ten_year_return_x}×
                    </span>
                  </div>
                  <div style={{fontSize:F.xs,color:MUTED,marginBottom:8,lineHeight:1.4}}>
                    {h.inflection}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,fontSize:9}}>
                    <div>
                      <div style={{color:MUTED}}>MCap</div>
                      <div style={{color:TEXT,fontWeight:700}}>₹{h.market_cap_cr}Cr</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>ROCE</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.roce_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Promoter</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.promoter_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Rev CAGR</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.revenue_cagr_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Profit CAGR</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.profit_cagr_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>FII+DII</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.fii_dii_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>EPS Growth</div>
                      <div style={{color:TEXT,fontWeight:700}}>{h.eps_growth_pct}%</div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Dilution drag</div>
                      <div style={{color:h.dilution_drag_pp <= 0 ? GREEN : TEXT,fontWeight:700}}>
                        {h.dilution_drag_pp > 0 ? '+' : ''}{h.dilution_drag_pp}pp
                      </div>
                    </div>
                    <div>
                      <div style={{color:MUTED}}>Matches</div>
                      <div style={{color:matchedStocks.length>0?GREEN:MUTED,fontWeight:700}}>
                        {matchedStocks.length} stock{matchedStocks.length===1?'':'s'}
                      </div>
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${BORDER}`}}>
                    <div style={{fontSize:F.xs,fontWeight:700,color:'#22d3ee',marginBottom:6,letterSpacing:'0.6px'}}>
                      FRAMEWORK SIGNALS THAT WOULD HAVE CAUGHT IT
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
                      {h.framework_signals.map((s,i) => (
                        <span key={i} style={{
                          fontSize:9,padding:'3px 7px',borderRadius:4,
                          backgroundColor:`${PURPLE}20`,color:PURPLE,
                          border:`1px solid ${PURPLE}40`,fontWeight:600,
                        }}>{s}</span>
                      ))}
                    </div>
                    {matchedStocks.length > 0 && (
                      <>
                        <div style={{fontSize:F.xs,fontWeight:700,color:GREEN,marginBottom:6,letterSpacing:'0.6px'}}>
                          🎯 YOUR STOCKS WITH SIMILAR ARCHETYPE
                        </div>
                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                          {matchedStocks.slice(0,8).map(s => (
                            <div key={s.symbol} style={{
                              display:'flex',alignItems:'center',gap:8,
                              padding:'6px 8px',backgroundColor:CARD2,borderRadius:5,fontSize:F.xs,
                            }}>
                              <span style={{fontWeight:700,color:TEXT,minWidth:80}}>{s.symbol}</span>
                              <span style={{color:MUTED,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                {s.company}
                              </span>
                              <span style={{
                                color: s.score>=80?GREEN:s.score>=68?'#22d3ee':s.score>=55?YELLOW:ORANGE,
                                fontWeight:700,minWidth:30,textAlign:'right',
                              }}>{s.score}</span>
                              <span style={{color:MUTED,minWidth:60,textAlign:'right'}}>
                                ₹{s.marketCapCr ? (s.marketCapCr >= 1000 ? (s.marketCapCr/1000).toFixed(1)+'k Cr' : s.marketCapCr+'Cr') : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div style={{
                  marginTop:8,fontSize:9,color:MUTED,textAlign:'center',cursor:'pointer',
                }}
                  onClick={() => setExpandedCard(isOpen ? null : h.ticker)}
                >
                  {isOpen ? '▲ collapse' : '▼ click to expand'}
                </div>
              </div>
            );
          })}
      </div>

      <div style={{
        marginTop:24,padding:'12px 14px',backgroundColor:`${PURPLE}0A`,
        border:`1px solid ${PURPLE}30`,borderLeft:`3px solid ${PURPLE}`,borderRadius:8,
      }}>
        <div style={{fontSize:F.sm,fontWeight:700,color:PURPLE,marginBottom:6}}>
          📖 How to use this reference
        </div>
        <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.6}}>
          1. Toggle <strong style={{color:TEXT}}>'Show only canonical stocks with matches'</strong> to focus on patterns relevant to your uploads.<br/>
          2. Click any card to see which of your stocks match the historical archetype + which framework signals would have caught it.<br/>
          3. Match thresholds: cap within 0.3-5×, ROCE ±8pp, Profit CAGR ±15pp, Promoter ±15pp, FII+DII ±10pp. Need 5+ matching dimensions.<br/>
          4. A high match doesn't guarantee multibagger outcome — these are NECESSARY characteristics, not sufficient. Sector tailwind, founder execution, and reinvestment runway determine the rest.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CAPITAL ALLOCATION PANEL — embedded inside Multibagger as a sub-tab.
// Per-ticker scorecard: capex efficiency (ΔEBIT / cumulative capex),
// ROCE shift, equity dilution, buyback quality, dividend rationality,
// reinvestment runway. Computed from /api/earnings/india-screener annual
// data (no new pipeline). Composite score 0-100 with grade A-F.
// ─────────────────────────────────────────────────────────────────────────
interface CapAllocAnalysis {
  ticker: string; company: string;
  capexEfficiency: { value: number | null; grade: string; label: string };
  roceShift: { before: number | null; after: number | null; delta: number | null };
  dilution: { sharesYoYPct: number | null; verdict: string };
  buybackQuality: { sharesRepurchasedPct: number | null; verdict: string };
  dividendRationality: { payoutPct: number | null; epsGrowthPct: number | null; verdict: string };
  reinvestmentRunway: { years: number | null; verdict: string };
  overall: { score: number; grade: string; label: string };
}

async function analyseCapAlloc(ticker: string): Promise<CapAllocAnalysis | null> {
  const norm = ticker.includes('.') ? ticker : `${ticker}.NS`;
  const res = await fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(norm)}`);
  const json = await res.json().catch(() => null);
  if (!json?.ok) return null;
  const annual: any[] = json.annual || [];
  const cf: any[] = json.cashFlow || [];
  const bs: any[] = json.balanceSheet || [];
  const recent = annual.slice(-3);
  const recentCf = cf.slice(-3);
  const capexSum = recentCf.reduce((s: number, q: any) => {
    const inv = q.fromInvesting ?? 0;
    return s + (typeof inv === 'number' && inv < 0 ? Math.abs(inv) : 0);
  }, 0);
  const ebitStart = recent[0]?.operatingProfit ?? null;
  const ebitEnd = recent[recent.length - 1]?.operatingProfit ?? null;
  const ebitDelta = ebitStart != null && ebitEnd != null ? ebitEnd - ebitStart : null;
  const capexEff = capexSum > 0 && ebitDelta != null ? Math.round((ebitDelta / capexSum) * 10000) / 100 : null;
  let capexGrade = 'C';
  let capexLabel = 'Capex deployed but EBIT lift unclear';
  if (capexEff !== null) {
    if (capexEff >= 50) { capexGrade = 'A'; capexLabel = `Each Rs 1 of capex generated Rs ${(capexEff / 100).toFixed(2)} of incremental EBIT — excellent`; }
    else if (capexEff >= 25) { capexGrade = 'B'; capexLabel = `Reasonable capex returns (${capexEff.toFixed(0)}% incremental EBIT/capex)`; }
    else if (capexEff >= 10) { capexGrade = 'C'; capexLabel = `Modest returns (${capexEff.toFixed(0)}%) — capex deploying but EBIT lagging`; }
    else if (capexEff >= 0) { capexGrade = 'D'; capexLabel = `Weak returns (${capexEff.toFixed(0)}%) — capex not translating to EBIT`; }
    else { capexGrade = 'F'; capexLabel = 'Negative incremental EBIT despite capex — value destruction'; }
  }
  const ratios: any[] = json.ratios || [];
  const roceArr = ratios.map((r) => r.roce).filter((r: any) => r !== null && r !== undefined);
  const roceBefore = roceArr.length >= 3 ? roceArr[Math.max(0, roceArr.length - 3)] : null;
  const roceAfter = roceArr.length >= 1 ? roceArr[roceArr.length - 1] : null;
  const roceDelta = roceBefore != null && roceAfter != null ? Math.round((roceAfter - roceBefore) * 100) / 100 : null;
  const equityArr = bs.map((b: any) => b.equityCapital).filter((v: any) => v != null);
  const dilutionPct = equityArr.length >= 2 && equityArr[0] !== 0
    ? Math.round(((equityArr[equityArr.length - 1] - equityArr[0]) / equityArr[0]) * 10000) / 100
    : null;
  let dilutionVerdict = 'Share count steady';
  if (dilutionPct !== null) {
    if (dilutionPct > 10) dilutionVerdict = `Heavy dilution +${dilutionPct.toFixed(1)}% — value-destructive unless deployed accretively`;
    else if (dilutionPct > 3) dilutionVerdict = `Moderate dilution +${dilutionPct.toFixed(1)}%`;
    else if (dilutionPct < -3) dilutionVerdict = `Buybacks shrinking float ${dilutionPct.toFixed(1)}% — shareholder-friendly`;
  }
  const lastEps = recent[recent.length - 1]?.eps ?? null;
  const firstEps = recent[0]?.eps ?? null;
  const epsGrowth = firstEps != null && lastEps != null && firstEps !== 0 ? Math.round(((lastEps - firstEps) / Math.abs(firstEps)) * 10000) / 100 : null;
  const div = (json.topMetrics?.dividendYieldPct ?? null);
  const pe = (json.topMetrics?.peRatio ?? null);
  const payoutPct = div != null && pe != null ? Math.round(div * pe * 100) / 100 : null;
  let divVerdict = 'No dividend data';
  if (payoutPct !== null) {
    if (payoutPct < 15 && epsGrowth !== null && epsGrowth > 15) divVerdict = `Low payout (${payoutPct.toFixed(0)}%) + strong EPS growth — reinvesting well`;
    else if (payoutPct > 60 && epsGrowth !== null && epsGrowth < 5) divVerdict = `High payout (${payoutPct.toFixed(0)}%) + weak EPS growth — over-distributing`;
    else if (payoutPct > 80) divVerdict = `Very high payout (${payoutPct.toFixed(0)}%) — limited reinvestment`;
    else divVerdict = `Payout ${payoutPct.toFixed(0)}% — ${epsGrowth !== null ? `EPS ${epsGrowth >= 0 ? '+' : ''}${epsGrowth.toFixed(0)}% over period` : 'EPS context unclear'}`;
  }
  const lastReserves = bs[bs.length - 1]?.reserves ?? null;
  const lastCapex = recentCf[recentCf.length - 1]?.fromInvesting ? Math.abs(recentCf[recentCf.length - 1].fromInvesting) : null;
  const reinvestYears = lastReserves != null && lastCapex && lastCapex > 0 ? Math.round((lastReserves / lastCapex) * 10) / 10 : null;
  const reinvestVerdict = reinvestYears == null ? 'No data'
    : reinvestYears >= 8 ? `${reinvestYears.toFixed(1)} years of capex covered by reserves — long runway`
    : reinvestYears >= 3 ? `${reinvestYears.toFixed(1)}y runway — adequate`
    : `${reinvestYears.toFixed(1)}y runway — short, may need external funding`;
  const gradeMap: Record<string, number> = { A: 90, B: 75, C: 55, D: 35, F: 15 };
  const overall = Math.round(
    (gradeMap[capexGrade] || 50) * 0.4 +
    (roceDelta !== null ? Math.max(0, Math.min(100, 60 + roceDelta * 5)) : 50) * 0.2 +
    (dilutionPct !== null ? (dilutionPct < 0 ? 80 : dilutionPct < 3 ? 70 : dilutionPct < 10 ? 50 : 25) : 60) * 0.15 +
    (payoutPct !== null && epsGrowth !== null
      ? (epsGrowth > 15 ? 80 : epsGrowth > 5 ? 65 : epsGrowth > 0 ? 50 : 35)
      : 55) * 0.15 +
    (reinvestYears !== null
      ? (reinvestYears >= 8 ? 90 : reinvestYears >= 3 ? 70 : 45)
      : 60) * 0.10
  );
  let overallGrade = 'F'; let overallLabel = '';
  if (overall >= 80) { overallGrade = 'A'; overallLabel = 'Disciplined capital allocator — capex returns + clean balance sheet'; }
  else if (overall >= 65) { overallGrade = 'B'; overallLabel = 'Solid capital allocation, minor inefficiencies'; }
  else if (overall >= 50) { overallGrade = 'C'; overallLabel = 'Mixed — capex deploying but returns not yet visible'; }
  else if (overall >= 35) { overallGrade = 'D'; overallLabel = 'Capital deployment outpacing incremental returns'; }
  else { overallGrade = 'F'; overallLabel = 'Material capital-allocation concerns'; }
  return {
    ticker: norm, company: json.company || norm,
    capexEfficiency: { value: capexEff, grade: capexGrade, label: capexLabel },
    roceShift: { before: roceBefore, after: roceAfter, delta: roceDelta },
    dilution: { sharesYoYPct: dilutionPct, verdict: dilutionVerdict },
    buybackQuality: { sharesRepurchasedPct: dilutionPct !== null && dilutionPct < 0 ? -dilutionPct : null, verdict: dilutionPct !== null && dilutionPct < -1 ? `Buyback of ~${(-dilutionPct).toFixed(1)}% of float` : 'No material buybacks' },
    dividendRationality: { payoutPct, epsGrowthPct: epsGrowth, verdict: divVerdict },
    reinvestmentRunway: { years: reinvestYears, verdict: reinvestVerdict },
    overall: { score: overall, grade: overallGrade, label: overallLabel },
  };
}

function CapitalAllocationPanel() {
  const [ticker, setTicker] = useState('');
  const [analysis, setAnalysis] = useState<CapAllocAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onSubmit = async () => {
    if (!ticker.trim()) return;
    setLoading(true); setError(''); setAnalysis(null);
    try {
      const a = await analyseCapAlloc(ticker.trim().toUpperCase());
      if (!a) setError('No data — verify ticker (e.g. RELIANCE.NS, BAJAJCON.NS)');
      else setAnalysis(a);
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    }
    setLoading(false);
  };
  return (
    <div style={{ padding: '24px', maxWidth: 1800, margin: '0 auto' }}>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 1.5 }}>
        How disciplined is management with shareholder capital? Capex efficiency · ROCE shift · dilution · buybacks · dividend rationality · reinvestment runway. Computed from Screener annual data.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
          placeholder="e.g. RELIANCE.NS"
          style={{ flex: 1, padding: '10px 14px', background: '#13131a', color: TEXT, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 6, fontSize: 13 }}
        />
        <button onClick={onSubmit} disabled={loading || !ticker.trim()}
          style={{ padding: '10px 18px', background: PURPLE, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          {loading ? 'Analysing…' : 'Analyse'}
        </button>
      </div>
      {error && <div style={{ color: '#fb923c', fontSize: 12, marginBottom: 12 }}>WARN: {error}</div>}
      {analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderLeft: `3px solid ${PURPLE}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{analysis.company}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{analysis.ticker}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Capital Allocation Score</div>
                <div style={{ fontSize: 36, fontWeight: 800, fontFamily: 'ui-monospace,monospace', color: analysis.overall.score >= 70 ? '#10b981' : analysis.overall.score >= 50 ? '#fbbf24' : '#fb923c' }}>
                  {analysis.overall.score}<span style={{ fontSize: 14, color: MUTED }}>/100</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Grade {analysis.overall.grade}</div>
              </div>
              <div style={{ flex: 1, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{analysis.overall.label}</div>
            </div>
          </div>
          {[
            { title: 'Capex Efficiency', value: analysis.capexEfficiency.value !== null ? `${analysis.capexEfficiency.value.toFixed(1)}% EBIT/capex` : '-', grade: analysis.capexEfficiency.grade, body: analysis.capexEfficiency.label },
            { title: 'ROCE Shift (3y)', value: analysis.roceShift.delta !== null ? `${analysis.roceShift.delta >= 0 ? '+' : ''}${analysis.roceShift.delta.toFixed(1)} pp` : '-', grade: '', body: `Before: ${analysis.roceShift.before?.toFixed(1) ?? '-'}%   |   After: ${analysis.roceShift.after?.toFixed(1) ?? '-'}%` },
            { title: 'Equity Dilution', value: analysis.dilution.sharesYoYPct !== null ? `${analysis.dilution.sharesYoYPct >= 0 ? '+' : ''}${analysis.dilution.sharesYoYPct.toFixed(1)}%` : '-', grade: '', body: analysis.dilution.verdict },
            { title: 'Buyback Quality', value: analysis.buybackQuality.sharesRepurchasedPct !== null ? `${analysis.buybackQuality.sharesRepurchasedPct.toFixed(1)}%` : '-', grade: '', body: analysis.buybackQuality.verdict },
            { title: 'Dividend Rationality', value: analysis.dividendRationality.payoutPct !== null ? `Payout ${analysis.dividendRationality.payoutPct.toFixed(0)}%` : '-', grade: '', body: analysis.dividendRationality.verdict },
            { title: 'Reinvestment Runway', value: analysis.reinvestmentRunway.years !== null ? `${analysis.reinvestmentRunway.years.toFixed(1)} years` : '-', grade: '', body: analysis.reinvestmentRunway.verdict },
          ].map((row) => (
            <div key={row.title} style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{row.title}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{row.value}</div>
                {row.grade && <div style={{ fontSize: 11, fontWeight: 700, color: row.grade === 'A' ? '#10b981' : row.grade === 'F' ? '#ef4444' : '#fbbf24' }}>Grade {row.grade}</div>}
              </div>
              <div style={{ flex: 1, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{row.body}</div>
            </div>
          ))}
        </div>
      )}
      {!analysis && !loading && !error && (
        <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 20, fontSize: 12, color: MUTED }}>
          Enter an Indian ticker and we will compute capex efficiency, ROCE shift, equity dilution, buyback quality, dividend rationality, and reinvestment runway from Screener annual data.
        </div>
      )}
    </div>
  );
}
