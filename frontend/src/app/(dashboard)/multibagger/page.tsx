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
  opLeverageRatio?: number; // profitCagr / revCagr
}

interface ExcelResult extends ExcelRow {
  score: number; grade: Grade;
  pillarScores: { id: string; label: string; score: number; color: string; weight: number }[];
  redFlags: { label: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM'; source: string }[];
  strengths: string[]; risks: string[];
  coverage: number;
}

// Sector benchmarks: [p25, median, p75]
const SBENCH: Record<string, { roce: number[]; opm: number[]; pe: number[]; rg: number[] }> = {
  TECHNOLOGY:   { roce:[20,28,38], opm:[18,25,35], pe:[25,35,55], rg:[12,20,30] },
  PHARMA:       { roce:[15,22,32], opm:[15,22,30], pe:[20,30,45], rg:[10,15,22] },
  BANKING_FIN:  { roce:[12,16,22], opm:[20,30,40], pe:[12,18,28], rg:[12,18,25] },
  INDUSTRIALS:  { roce:[14,20,28], opm:[8,12,18],  pe:[18,26,40], rg:[10,16,24] },
  CONSUMER:     { roce:[16,24,34], opm:[10,16,22], pe:[22,32,50], rg:[8,15,22]  },
  CHEMICALS:    { roce:[15,22,30], opm:[12,18,25], pe:[18,28,42], rg:[10,18,28] },
  AUTO:         { roce:[14,20,28], opm:[8,12,18],  pe:[15,22,35], rg:[8,14,22]  },
  DEFAULT:      { roce:[14,20,28], opm:[10,15,22], pe:[18,26,42], rg:[10,16,24] },
};

function getSectorKey(s: string): string {
  const u = s.toUpperCase();
  if (/TECH|SOFTWARE|IT |COMPUTER/.test(u)) return 'TECHNOLOGY';
  if (/PHARMA|DRUG|HEALTH|BIOTECH/.test(u)) return 'PHARMA';
  if (/BANK|FINANCE|NBFC|INSURANCE|LENDING/.test(u)) return 'BANKING_FIN';
  if (/CHEM|SPECIALTY/.test(u)) return 'CHEMICALS';
  if (/AUTO|VEHICLE/.test(u)) return 'AUTO';
  if (/CONSUMER|FMCG|RETAIL|PERSONAL/.test(u)) return 'CONSUMER';
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

function scoreExcelRow(row: ExcelRow): ExcelResult {
  const b = SBENCH[getSectorKey(row.sector)] ?? SBENCH.DEFAULT;
  const strengths: string[] = [];
  const risks: string[] = [];
  const redFlags: { label:string; severity:'CRITICAL'|'HIGH'|'MEDIUM'; source:string }[] = [];

  let qualS=0,qualC=0, growS=0,growC=0, longS=0,longC=0, finS=0,finC=0, valS=0,valC=0, mktS=50,mktC=1;

  // ── QUALITY (25%) ─────────────────────────────────────────────────────────
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

  // ── GROWTH (25%) ─────────────────────────────────────────────────────────
  if (row.revCagr!==undefined) {
    const s=sv(row.revCagr,[8,15,25]); growS+=s; growC++;
    if (s>=80) strengths.push(`Revenue CAGR ${row.revCagr.toFixed(1)}% — excellent growth engine`);
  }
  if (row.profitCagr!==undefined) {
    const s=sv(row.profitCagr,[10,20,30]); growS+=s; growC++;
    // Operating leverage check
    if (row.revCagr!==undefined && row.revCagr>0) {
      const ratio = row.profitCagr / row.revCagr;
      if (ratio>=1.5) strengths.push(`Op leverage ${ratio.toFixed(1)}× — PAT ${row.profitCagr.toFixed(0)}% vs Rev ${row.revCagr.toFixed(0)}%`);
      else if (ratio<0.8 && row.profitCagr<row.revCagr) risks.push(`Weak op leverage ${ratio.toFixed(1)}× — profit not scaling`);
      // Bonus for strong operating leverage
      if (ratio>=1.5) { growS+=10; growC+=0.3; }
    }
    if (s>=85) strengths.push(`Profit CAGR ${row.profitCagr.toFixed(1)}% — compounding`);
  }
  if (row.yoySalesGrowth!==undefined)  { growS+=sv(row.yoySalesGrowth,[5,12,25]);  growC++; }
  if (row.yoyProfitGrowth!==undefined) {
    growS+=sv(row.yoyProfitGrowth,[5,15,30]); growC++;
    if (row.yoyProfitGrowth<0) risks.push(`YOY profit −${Math.abs(row.yoyProfitGrowth).toFixed(0)}% — earnings deteriorating`);
  }
  if (row.epsGrowth!==undefined) { growS+=sv(row.epsGrowth,[10,20,35]); growC++; }

  // ── LONGEVITY (15%) — SQGLP "L" ──────────────────────────────────────────
  // Proxy using: ROE trend proxy, market cap (small=more runway), non-peak sector
  if (row.roce!==undefined && row.revCagr!==undefined) {
    // High ROIC + high growth = Fisher 100× profile = longevity signal
    const longevityScore = (row.roce>=20 && row.revCagr>=15) ? 85 :
                           (row.roce>=15 && row.revCagr>=10) ? 65 : 45;
    longS+=longevityScore; longC++;
  }
  if (row.marketCapCr!==undefined) {
    // Small = more runway for compounding (MOSL SQGLP "S")
    const s = row.marketCapCr<500?90:row.marketCapCr<2000?82:row.marketCapCr<5000?72:row.marketCapCr<10000?60:40;
    longS+=s; longC++;
    if (row.marketCapCr<500) strengths.push(`Market cap ₹${row.marketCapCr.toFixed(0)}Cr — maximum runway for 100×`);
    else if (row.marketCapCr>20000) risks.push(`Market cap ₹${row.marketCapCr.toLocaleString()}Cr — limited room for 100×`);
  }
  if (row.fiiPlusDii!==undefined) {
    // Low institutional = undiscovered = longevity of opportunity
    const s = row.fiiPlusDii<10?90:row.fiiPlusDii<20?78:row.fiiPlusDii<35?62:45;
    longS+=s; longC++;
    if (row.fiiPlusDii<10) strengths.push(`FII+DII ${row.fiiPlusDii.toFixed(1)}% — largely undiscovered`);
    else if (row.fiiPlusDii>40) risks.push(`FII+DII ${row.fiiPlusDii.toFixed(1)}% — heavily institutionally held`);
  }

  // ── FINANCIAL STRENGTH (15%) ──────────────────────────────────────────────
  if (row.de!==undefined) {
    finS+=sv(row.de,[0.5,1.0,2.0],false); finC++;
    if (row.de>3.0) redFlags.push({label:`D/E ${row.de.toFixed(2)}× — CRITICAL debt level`,severity:'CRITICAL',source:'Fisher'});
    else if (row.de>2.0) redFlags.push({label:`D/E ${row.de.toFixed(2)}× — high leverage`,severity:'HIGH',source:'Fisher'});
    if (row.de<=0.1) strengths.push(`D/E ${row.de.toFixed(2)}× — virtually debt-free`);
  }
  if (row.netDebtEbitda!==undefined) {
    const s = row.netDebtEbitda<0?95:row.netDebtEbitda<0.5?88:row.netDebtEbitda<1.5?72:row.netDebtEbitda<3?45:20;
    finS+=s; finC++;
    if (row.netDebtEbitda>3.0) redFlags.push({label:`Net Debt/EBITDA ${row.netDebtEbitda.toFixed(1)}× — Fisher survival filter FAIL`,severity:'CRITICAL',source:'Fisher Stage 6'});
    else if (row.netDebtEbitda>1.5) redFlags.push({label:`Net Debt/EBITDA ${row.netDebtEbitda.toFixed(1)}× — above Fisher threshold`,severity:'HIGH',source:'Fisher Stage 6'});
    if (row.netDebtEbitda<0) strengths.push(`Net cash company — zero debt risk`);
  }
  if (row.pledge!==undefined) {
    finS+=sv(row.pledge,[2,10,25],false); finC++;
    if (row.pledge>50) redFlags.push({label:`Pledge ${row.pledge.toFixed(0)}% — CRITICAL forced selling risk`,severity:'CRITICAL',source:'Fisher'});
    else if (row.pledge>25) redFlags.push({label:`Pledge ${row.pledge.toFixed(0)}% — material risk`,severity:'HIGH',source:'Fisher'});
    if (row.pledge<1) strengths.push(`Zero pledge — clean promoter structure`);
  }
  if (row.changeInPromoter!==undefined) {
    const s = row.changeInPromoter>1?85:row.changeInPromoter>0?72:row.changeInPromoter>-1?55:30;
    finS+=s; finC++;
    if (row.changeInPromoter<-2) redFlags.push({label:`Promoter sold ${Math.abs(row.changeInPromoter).toFixed(1)}% this quarter`,severity:'MEDIUM',source:'Fisher Scuttlebutt'});
    if (row.changeInPromoter>1) strengths.push(`Promoter bought +${row.changeInPromoter.toFixed(1)}% — insider conviction`);
  }
  if (row.icr!==undefined) {
    finS+=sv(row.icr,[2,5,10]); finC++;
    if (row.icr<1.5) redFlags.push({label:`ICR ${row.icr.toFixed(1)}× — dangerously low`,severity:'CRITICAL',source:'Fisher'});
  }

  // ── VALUATION (15%) — SQGLP "P" Price ────────────────────────────────────
  if (row.pe!==undefined) { valS+=sv(row.pe,b.pe,false); valC++; if (row.pe>120) redFlags.push({label:`P/E ${row.pe.toFixed(0)}× — extreme valuation`,severity:'MEDIUM',source:'Fisher'}); }
  if (row.peg!==undefined && row.peg>0) {
    const s=row.peg<0.8?92:row.peg<1.5?74:row.peg<2.5?50:22;
    valS+=s; valC++;
    if (row.peg<0.8) strengths.push(`PEG ${row.peg.toFixed(2)} — undervalued for growth`);
    if (row.peg>2.5) risks.push(`PEG ${row.peg.toFixed(2)} — expensive for growth rate`);
  }
  if (row.marginOfSafety!==undefined) {
    const s=row.marginOfSafety>30?90:row.marginOfSafety>10?76:row.marginOfSafety>0?62:row.marginOfSafety>-20?44:22;
    valS+=s; valC++;
    if (row.marginOfSafety>20) strengths.push(`${row.marginOfSafety.toFixed(0)}% below intrinsic value — MOSL margin of safety`);
    if (row.marginOfSafety<-35) risks.push(`Price ${Math.abs(row.marginOfSafety).toFixed(0)}% above intrinsic value`);
  }

  // ── MARKET/MOMENTUM (5%) ─────────────────────────────────────────────────
  if (row.aboveDMA200!==undefined) {
    mktS=row.aboveDMA200>10?85:row.aboveDMA200>0?72:row.aboveDMA200>-15?52:28; mktC=1;
    if (row.aboveDMA200<-30) risks.push(`${Math.abs(row.aboveDMA200).toFixed(0)}% below DMA200 — deep drawdown`);
  }
  if (row.return1m!==undefined) {
    const s=row.return1m>10?80:row.return1m>0?65:row.return1m>-15?50:28;
    mktS=(mktS*mktC+s)/(mktC+1); mktC++;
  }

  // ── COMPOSITE (SQGLP-weighted) ────────────────────────────────────────────
  const qual  = qualC>0?qualS/qualC:50;
  const growth= growC>0?growS/growC:50;
  const longe = longC>0?longS/longC:50;
  const fin   = finC>0?finS/finC:50;
  const val   = valC>0?valS/valC:50;
  const mkt   = mktS;

  const filledFields=[row.roce,row.roe,row.opm,row.cfoToPat,row.promoter,row.de,
    row.netDebtEbitda,row.revCagr,row.profitCagr,row.yoySalesGrowth,row.yoyProfitGrowth,
    row.pe,row.peg,row.marketCapCr,row.marginOfSafety,row.fiiPlusDii,row.fcfAbsolute].filter(v=>v!==undefined).length;
  const coverage=Math.min(100,Math.round((filledFields/17)*100));
  const coverageRatio=coverage/100;

  // SQGLP weights: S=Size(in Longevity), Q=Quality, G=Growth, L=Longevity, P=Price(Valuation)
  const raw = qual*0.25 + growth*0.25 + longe*0.15 + fin*0.15 + val*0.15 + mkt*0.05;
  const penalized = raw*(0.5+coverageRatio*0.5);

  const hasCrit=redFlags.some(f=>f.severity==='CRITICAL');
  const highCnt=redFlags.filter(f=>f.severity==='HIGH').length;
  let score=Math.round(penalized/5)*5;
  if (hasCrit)       score=Math.min(score,40);
  else if (highCnt>=2) score=Math.min(score,50);
  else if (highCnt>=1) score=Math.min(score,62);
  score=Math.max(0,Math.min(100,score));

  const grade:Grade=score>=80?'A+':score>=72?'A':score>=63?'B+':score>=54?'B':score>=42?'C':'D';

  return {
    ...row, score, grade, coverage, strengths, risks, redFlags,
    pillarScores:[
      {id:'QUALITY',    label:'Quality (Q)',    score:Math.round(qual),  color:'#a78bfa', weight:25},
      {id:'GROWTH',     label:'Growth (G)',     score:Math.round(growth),color:'#38bdf8', weight:25},
      {id:'LONGEVITY',  label:'Longevity (L)',  score:Math.round(longe), color:'#06b6d4', weight:15},
      {id:'FIN_STR',    label:'Fin Strength',   score:Math.round(fin),   color:'#10b981', weight:15},
      {id:'VALUATION',  label:'Valuation (P)',  score:Math.round(val),   color:'#f59e0b', weight:15},
      {id:'MARKET',     label:'Market',         score:Math.round(mkt),   color:'#f97316', weight:5},
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
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL COMPARE TAB — institutional scale UI
// ═══════════════════════════════════════════════════════════════════════════════

function ExcelCompare({ rows, setRows }: { rows: ExcelResult[]; setRows:(r:ExcelResult[])=>void }) {
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expRow, setExpRow] = useState<string|null>(null);
  const [gradeFilter, setGradeFilter] = useState('ALL');
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
      const seen=new Set<string>();
      const merged:ExcelRow[]=[];
      for (const file of arr) {
        const raw=await parseSingleFile(file,XLSX);
        if(!raw.length) continue;
        const cm=buildColMap(raw[0] as Record<string,unknown>);
        if(!cm['symbol']) continue;
        for (const r of raw) {
          const row=rawRowToExcelRow(r as Record<string,unknown>,cm);
          if(!row||seen.has(row.symbol)) continue;
          seen.add(row.symbol);
          merged.push(row);
        }
      }
      if(!merged.length){setParseError('No valid rows found. Ensure files have NSE Code column.');setLoading(false);return;}
      const scored=merged.map(r=>scoreExcelRow(r)).sort((a,b)=>b.score-a.score);
      setRows(scored);
      setFileName(arr.length===1?arr[0].name:`${arr.length} files · ${merged.length} stocks merged`);
    } catch(e:unknown){setParseError(`Error: ${e instanceof Error?e.message:String(e)}`);}
    setLoading(false);
  }

  const GRADES:Grade[]=['A+','A','B+','B','C','D'];
  const filtered=gradeFilter==='ALL'?rows:rows.filter(r=>r.grade===gradeFilter);
  const topPicks=rows.filter(r=>['A+','A','B+'].includes(r.grade));

  const METRICS: [keyof ExcelRow, string, string][] = [
    ['roce','ROCE %','Quality'],['roe','ROE %','Quality'],['opm','OPM %','Quality'],
    ['cfoToPat','CFO/PAT x','Quality'],['fcfAbsolute','FCF ₹Cr','Quality'],
    ['revCagr','Sales CAGR %','Growth'],['profitCagr','Profit CAGR %','Growth'],
    ['opLeverageRatio','Op Leverage x','Growth'],
    ['yoySalesGrowth','YOY Sales %','Growth'],['yoyProfitGrowth','YOY Profit %','Growth'],
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
          Export any Screener.in screen as CSV and upload here. All fields auto-detected. Multiple files merged automatically.
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

      {rows.length>0&&(
        <>
          {/* Summary */}
          <div style={{display:'flex',gap:14,marginBottom:18,flexWrap:'wrap'}}>
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
              {(['ALL',...GRADES] as const).map(g=>(
                <button key={g} onClick={()=>setGradeFilter(g)} style={{fontSize:F.sm,fontWeight:700,padding:'8px 14px',borderRadius:8,border:`1px solid ${gradeFilter===g?(GRADE_COLOR[g as Grade]||PURPLE)+'60':BORDER}`,background:gradeFilter===g?`${GRADE_COLOR[g as Grade]||PURPLE}18`:'transparent',color:gradeFilter===g?(GRADE_COLOR[g as Grade]||PURPLE):MUTED,cursor:'pointer'}}>
                  {g}{g!=='ALL'&&` (${rows.filter(r=>r.grade===g).length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'120px 160px 70px 70px 1fr 110px',gap:10,padding:'10px 14px',fontSize:F.sm,fontWeight:700,letterSpacing:'0.6px',color:MUTED,borderBottom:`1px solid ${BORDER}`}}>
            <span>TICKER</span><span>COMPANY</span><span>SCORE</span><span>GRADE</span><span>SQGLP PILLARS</span><span>DATA / FLAGS</span>
          </div>

          {filtered.map((r,idx)=>{
            const isExp=expRow===r.symbol;
            const hasCrit=r.redFlags.some(f=>f.severity==='CRITICAL');
            return (
              <div key={r.symbol+idx} style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <button onClick={()=>setExpRow(isExp?null:r.symbol)} style={{width:'100%',background:isExp?CARD_BG:'transparent',border:'none',cursor:'pointer',textAlign:'left',padding:'14px 14px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'120px 160px 70px 70px 1fr 110px',gap:10,alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:F.lg,fontWeight:800,color:hasCrit?RED:TEXT}}>{r.symbol}</span>
                      {idx<3&&<span style={{fontSize:F.md}}>⭐</span>}
                    </div>
                    <span style={{fontSize:F.sm,color:MUTED,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company||r.sector}</span>
                    <span style={{fontSize:F.h2,fontWeight:900,color:GRADE_COLOR[r.grade]??MUTED}}>{r.score}</span>
                    <span style={{fontSize:F.md,fontWeight:800,padding:'4px 8px',borderRadius:6,color:GRADE_COLOR[r.grade],backgroundColor:`${GRADE_COLOR[r.grade]}18`,border:`1px solid ${GRADE_COLOR[r.grade]}30`,textAlign:'center'}}>{r.grade}</span>
                    {/* SQGLP pillar bars */}
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      {r.pillarScores.map(p=>(
                        <div key={p.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,minWidth:38}}>
                          <span style={{fontSize:F.sm,fontWeight:700,color:p.color}}>{p.score}</span>
                          <div style={{width:32,height:6,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:3,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${p.score}%`,backgroundColor:p.color}}/>
                          </div>
                          <span style={{fontSize:F.xs,color:MUTED}}>{p.label.split(' ')[0].slice(0,5)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      <span style={{fontSize:F.sm,color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE}}>{r.coverage}% data</span>
                      {r.redFlags.length>0&&<span style={{fontSize:F.sm,color:hasCrit?RED:ORANGE}}>⚠ {r.redFlags.length} flag{r.redFlags.length>1?'s':''}</span>}
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
                      Sector: {r.sector} · Data: {r.coverage}% · Framework: SQGLP (MOSL 100×) + Fisher 100-Bagger + Multibagger Framework
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
      const val=excelStock[item.autoField] as number|undefined;
      if(val===undefined||val===null) continue;
      const pass=item.autoPass(val,excelStock);
      const note=`Auto from Excel: ${item.autoFormat?item.autoFormat(val,excelStock):val.toFixed(2)} → ${pass?'✅ PASS':'❌ FAIL'}`;
      result[item.id]={pass,note};
    }
    return result;
  },[excelStock]);

  const pillars=[...new Set(CHECKLIST.map(i=>i.pillar))];
  const completed=CHECKLIST.filter(i=>autoChecks[i.id]?.pass||checks[i.id]).length;
  const autoPassed=Object.values(autoChecks).filter(v=>v?.pass).length;
  const pct=Math.round((completed/CHECKLIST.length)*100);
  const grade:Grade=pct>=85?'A+':pct>=72?'A':pct>=58?'B+':pct>=44?'B':pct>=30?'C':'D';

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

export default function MultibaggerPage() {
  const [activeTab,setActiveTab]=useState<'excel'|'checklist'>('excel');
  const [excelRows,setExcelRows]=useState<ExcelResult[]>([]);

  return (
    <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif'}}>
      {/* Header */}
      <div style={{backgroundColor:'#13131a',borderBottom:'1px solid rgba(255,255,255,0.08)',padding:'20px 24px 0'}}>
        <div style={{maxWidth:1100,margin:'0 auto'}}>
          <div style={{marginBottom:16}}>
            <h1 style={{fontSize:F.h1,fontWeight:900,color:PURPLE,margin:0}}>🚀 Multibagger Research Engine</h1>
            <p style={{fontSize:F.md,color:MUTED,margin:'5px 0 0'}}>
              SQGLP (MOSL 100×) · Fisher 100-Bagger Checklist · Multibagger Framework · Upload Screener.in → instant institutional scoring
            </p>
          </div>
          <div style={{display:'flex',gap:0}}>
            {([
              {id:'excel',    label:'📤 Excel Score & Rank', desc:'Upload CSVs → 5-pillar SQGLP scoring'},
              {id:'checklist',label:'📋 Research Checklist',  desc:`37 criteria · ${excelRows.length?`${excelRows.length} stocks loaded`:'auto-checks from Excel'}`},
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

      {activeTab==='excel'     &&<ExcelCompare rows={excelRows} setRows={setExcelRows}/>}
      {activeTab==='checklist' &&<MultibaggerChecklist excelRows={excelRows}/>}
    </div>
  );
}
