'use client';

import { useState, useMemo, useRef } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG      = '#0a0a0f';
const CARD_BG = '#13131a';
const BORDER  = 'rgba(255,255,255,0.06)';
const TEXT    = '#e2e8f0';
const MUTED   = '#64748b';
const PURPLE  = '#a78bfa';
const ACCENT  = '#38bdf8';
const GREEN   = '#10b981';
const RED     = '#ef4444';
const ORANGE  = '#f97316';
const YELLOW  = '#f59e0b';

type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'NR';
const GRADE_COLOR: Record<Grade, string> = {
  'A+': '#10b981', 'A': '#34d399', 'B+': '#f59e0b', 'B': '#f97316', 'C': '#fb923c', 'D': '#ef4444', 'NR': '#64748b',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST — 25 criteria (all Screener.in fields utilised)
// ═══════════════════════════════════════════════════════════════════════════════

interface ChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number;
  // Which ExcelResult field to auto-check and what threshold passes
  autoField?: keyof ExcelRow; autoPass?: (v: number) => boolean; autoFormat?: (v: number) => string;
}

const CHECKLIST: ChecklistItem[] = [
  // QUALITY (30%)
  { id:'roce', pillar:'QUALITY', pillarColor:'#a78bfa', weight:7,
    label:'ROCE ≥ 20% (sector-relative)', target:'> 20% for most sectors',
    why:'Return on Capital Employed is the #1 quality filter. High ROCE = pricing power + moat.',
    autoField:'roce', autoPass:v => v >= 18, autoFormat:v => `ROCE ${v.toFixed(1)}%` },
  { id:'roe', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6,
    label:'ROE ≥ 15% consistently', target:'> 15% consistently; > 20% for compounders',
    why:'ROE measures management ability to generate returns from equity.',
    autoField:'roe', autoPass:v => v >= 15, autoFormat:v => `ROE ${v.toFixed(1)}%` },
  { id:'opm', pillar:'QUALITY', pillarColor:'#a78bfa', weight:6,
    label:'OPM stable or expanding (sector-relative)', target:'Trending up matters more than absolute level',
    why:'Expanding OPM = pricing power. Contracting = competitive pressure.',
    autoField:'opm', autoPass:v => v >= 12, autoFormat:v => `OPM ${v.toFixed(1)}%` },
  { id:'cfo', pillar:'QUALITY', pillarColor:'#a78bfa', weight:5,
    label:'CFO/PAT > 0.8 (earnings quality)', target:'Cash Flow from Operations > 80% of reported profit',
    why:'Profit without cash = accounting fiction. High CFO/PAT confirms earnings quality.',
    autoField:'cfoToPat', autoPass:v => v >= 0.8, autoFormat:v => `CFO/PAT ${v.toFixed(2)}x` },
  { id:'owner_op', pillar:'QUALITY', pillarColor:'#a78bfa', weight:4,
    label:'Promoter holding ≥ 40% and not declining', target:'> 40%; consistent or rising',
    why:"Promoters with large stakes are aligned with shareholders.",
    autoField:'promoter', autoPass:v => v >= 40, autoFormat:v => `Promoter ${v.toFixed(1)}%` },
  { id:'moat', pillar:'QUALITY', pillarColor:'#a78bfa', weight:4,
    label:'Economic moat: pricing power / brand / switching cost', target:'Can they raise prices without losing volume?',
    why:'Moats compound. Without one, ROCE will revert to mean.' },
  { id:'capital_alloc', pillar:'QUALITY', pillarColor:'#a78bfa', weight:3,
    label:'No value-destructive M&A or excessive dilution', target:'Organic reinvestment preferred; debt-funded diversification = red flag',
    why:'Bad capital allocators destroy shareholder value even with good operations.' },

  // GROWTH (25%)
  { id:'rev_cagr', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7,
    label:'Sales growth ≥ 15% (3-5yr CAGR)', target:'> 15%; > 20% for high-multiple justification',
    why:'Revenue growth is the engine. Profit growth without revenue growth is unsustainable.',
    autoField:'revCagr', autoPass:v => v >= 15, autoFormat:v => `Sales CAGR ${v.toFixed(1)}%` },
  { id:'profit_cagr', pillar:'GROWTH', pillarColor:'#38bdf8', weight:7,
    label:'Profit growth ≥ 20% (faster than revenue = leverage)', target:'> 20%; ideally > revenue growth',
    why:'Profit CAGR > revenue CAGR signals operating leverage.',
    autoField:'profitCagr', autoPass:v => v >= 20, autoFormat:v => `Profit CAGR ${v.toFixed(1)}%` },
  { id:'yoy_growth', pillar:'GROWTH', pillarColor:'#38bdf8', weight:6,
    label:'YOY quarterly sales growth > 10% (recent momentum)', target:'Latest quarter showing positive growth',
    why:'Current quarter momentum confirms thesis is still live.',
    autoField:'yoySalesGrowth', autoPass:v => v >= 10, autoFormat:v => `YOY Sales ${v.toFixed(1)}%` },
  { id:'yoy_profit', pillar:'GROWTH', pillarColor:'#38bdf8', weight:5,
    label:'YOY quarterly profit growth > 10%', target:'Latest quarter profit not deteriorating',
    why:'Profit growth deceleration is an early warning sign.',
    autoField:'yoyProfitGrowth', autoPass:v => v >= 10, autoFormat:v => `YOY Profit ${v.toFixed(1)}%` },

  // FINANCIAL STRENGTH (20%)
  { id:'de', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:6,
    label:'Debt/Equity ≤ 0.5 (or net cash)', target:'D/E < 0.5; < 1.0 for capital-intensive sectors',
    why:'Low D/E = resilience in downturns.',
    autoField:'de', autoPass:v => v <= 0.5, autoFormat:v => `D/E ${v.toFixed(2)}x` },
  { id:'pledge', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:5,
    label:'Pledged shares ≤ 5% (ideally zero)', target:'< 5%; > 25% = CRITICAL red flag',
    why:'Pledged shares = promoter borrowing against shares. Forced selling risk if stock falls.',
    autoField:'pledge', autoPass:v => v <= 5, autoFormat:v => `Pledge ${v.toFixed(1)}%` },
  { id:'cfo_confirm', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:4,
    label:'CFO consistently positive (> 0 for 3+ years)', target:'Negative CFO for multiple years = structural problem',
    why:'Companies burning cash need constant external financing — dilution or debt risk.',
    autoField:'cfoToPat', autoPass:v => v > 0, autoFormat:v => `CFO/PAT ${v.toFixed(2)}x` },
  { id:'icr', pillar:'FIN_STRENGTH', pillarColor:'#10b981', weight:3,
    label:'Interest Coverage Ratio ≥ 5x', target:'> 5x; > 3x minimum',
    why:'ICR measures ability to service debt. < 2x = earnings barely cover interest.' },

  // VALUATION (15%)
  { id:'peg', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5,
    label:'PEG Ratio < 1.5 (growth at a reasonable price)', target:'< 0.8 = excellent; 0.8–1.5 = fair; > 2 = expensive',
    why:'PEG normalises P/E for growth. Paying 50× P/E for 50% growth is fair; for 10% growth is not.',
    autoField:'peg', autoPass:v => v > 0 && v < 1.5, autoFormat:v => `PEG ${v.toFixed(2)}` },
  { id:'intrinsic', pillar:'VALUATION', pillarColor:'#f59e0b', weight:5,
    label:'Price ≤ Intrinsic Value (margin of safety)', target:'Current Price < Intrinsic Value = buy zone',
    why:'Screener.in intrinsic value = DCF-based estimate. Below = margin of safety.',
    autoField:'marginOfSafety', autoPass:v => v >= 0, autoFormat:v => `MoS ${v > 0 ? '+' : ''}${v.toFixed(0)}%` },
  { id:'pe', pillar:'VALUATION', pillarColor:'#f59e0b', weight:3,
    label:'P/E ≤ 1.5× sector median', target:'Not paying 3× sector for average business',
    why:'Relative valuation matters more than absolute.',
    autoField:'pe', autoPass:v => v < 50, autoFormat:v => `P/E ${v.toFixed(1)}x` },
  { id:'mcap_zone', pillar:'VALUATION', pillarColor:'#f59e0b', weight:4,
    label:'Market cap ₹500Cr–₹15,000Cr (sweet spot)', target:'Small/mid-cap with room to grow 10×',
    why:'A ₹500Cr company can 10× to ₹5,000Cr. Math of multibaggers requires starting small.',
    autoField:'marketCapCr', autoPass:v => v >= 500 && v <= 15000, autoFormat:v => `₹${v.toLocaleString()}Cr` },

  // MARKET / MOMENTUM (10%)
  { id:'momentum', pillar:'MARKET', pillarColor:'#f97316', weight:5,
    label:'Price above DMA200 (not in deep drawdown)', target:'Price > DMA200; not more than 30% below 52W high',
    why:"Money flows toward strength. Stocks deep in bear territory need a catalyst to reverse.",
    autoField:'aboveDMA200', autoPass:v => v >= 0, autoFormat:v => `${v > 0 ? '+' : ''}${v.toFixed(1)}% vs DMA200` },
  { id:'return1m', pillar:'MARKET', pillarColor:'#f97316', weight:3,
    label:'1-month return positive or not deeply negative', target:'> -10% over last month',
    why:'Deep recent losses often signal fundamental deterioration, not just volatility.',
    autoField:'return1m', autoPass:v => v >= -10, autoFormat:v => `${v > 0 ? '+' : ''}${v.toFixed(1)}% 1M` },
  { id:'tailwind', pillar:'MARKET', pillarColor:'#f97316', weight:5,
    label:'Sector structural tailwind (not cyclical headwind)', target:'Defense, EMS, capital goods, pharma API, specialty chem',
    why:'Tailwinds lift all boats. Being right on the stock in the wrong sector is painful.' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL SCORING ENGINE — full Screener.in field support
// ═══════════════════════════════════════════════════════════════════════════════

interface ExcelRow {
  symbol: string; company: string; sector: string;
  // Quality
  roce?: number; roe?: number; opm?: number; cfoToPat?: number;
  promoter?: number; pledge?: number;
  // Growth
  revCagr?: number; profitCagr?: number;
  yoySalesGrowth?: number; yoyProfitGrowth?: number;
  // Fin strength
  de?: number; icr?: number;
  // Valuation
  pe?: number; pb?: number; peg?: number;
  marketCapCr?: number; intrinsicValue?: number; price?: number;
  // Market/momentum
  dma200?: number; return1m?: number; return1w?: number;
  // Derived
  marginOfSafety?: number;  // (intrinsicValue - price) / price * 100
  aboveDMA200?: number;     // (price - dma200) / dma200 * 100
}

interface ExcelResult extends ExcelRow {
  score: number; grade: Grade;
  pillarScores: { id: string; label: string; score: number; color: string }[];
  redFlags: { label: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' }[];
  strengths: string[]; risks: string[];
  coverage: number; // 0-100% of fields filled
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

function sv(v: number | undefined, bench: number[], hiGood = true): number {
  if (v === undefined || v === null || isNaN(v as number)) return 0;
  const [lo, mid, hi] = hiGood ? bench : bench.map(x => -x);
  const val = hiGood ? v : -v;
  if (val >= hi) return Math.min(100, 88 + (val - hi) * 0.4);
  if (val >= mid) return 72 + ((val - mid) / (hi - mid)) * 16;
  if (val >= lo) return 50 + ((val - lo) / (mid - lo)) * 22;
  return Math.max(0, 30 + Math.max(0, val) / Math.max(lo, 1) * 20);
}

function scoreExcelRow(row: ExcelRow): ExcelResult {
  const b = SBENCH[getSectorKey(row.sector)] ?? SBENCH.DEFAULT;
  const strengths: string[] = [];
  const risks: string[] = [];
  const redFlags: { label: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM' }[] = [];

  let qualS = 0, qualC = 0;
  let growS = 0, growC = 0;
  let finS  = 0, finC  = 0;
  let valS  = 0, valC  = 0;
  let mktS  = 50, mktC = 1;

  // ── QUALITY ─────────────────────────────────────────────────────────────
  if (row.roce !== undefined) {
    const s = sv(row.roce, b.roce); qualS += s; qualC++;
    if (s >= 78) strengths.push(`ROCE ${row.roce.toFixed(1)}% — strong`);
    else if (s < 50) risks.push(`ROCE ${row.roce.toFixed(1)}% — below sector`);
  }
  if (row.roe  !== undefined) { qualS += sv(row.roe, [12,18,26]); qualC++; }
  if (row.opm  !== undefined) { qualS += sv(row.opm, b.opm);     qualC++; }
  if (row.cfoToPat !== undefined) {
    const s = row.cfoToPat >= 0.8 ? 82 : row.cfoToPat >= 0.5 ? 62 : row.cfoToPat >= 0 ? 42 : 20;
    qualS += s; qualC++;
    if (row.cfoToPat >= 1.0) strengths.push(`CFO/PAT ${row.cfoToPat.toFixed(2)}x — excellent cash conversion`);
    if (row.cfoToPat < 0) risks.push(`Negative CFO/PAT — earnings not backed by cash`);
  }
  if (row.promoter !== undefined) {
    qualS += sv(row.promoter, [25,40,60]); qualC++;
    if (row.promoter < 20) redFlags.push({ label:`Promoter ${row.promoter.toFixed(0)}% — very low`, severity:'HIGH' });
    if (row.promoter >= 50) strengths.push(`Promoter ${row.promoter.toFixed(0)}% — strong alignment`);
  }

  // ── GROWTH ───────────────────────────────────────────────────────────────
  if (row.revCagr    !== undefined) {
    const s = sv(row.revCagr, [8,15,25]); growS += s; growC++;
    if (s >= 80) strengths.push(`Sales CAGR ${row.revCagr.toFixed(1)}% — excellent`);
  }
  if (row.profitCagr !== undefined) {
    const s = sv(row.profitCagr, [10,20,30]); growS += s; growC++;
    if (s >= 85) strengths.push(`Profit CAGR ${row.profitCagr.toFixed(1)}% — compounding`);
  }
  if (row.yoySalesGrowth  !== undefined) { growS += sv(row.yoySalesGrowth,  [5,12,25]); growC++; }
  if (row.yoyProfitGrowth !== undefined) {
    const s = sv(row.yoyProfitGrowth, [5,15,30]); growS += s; growC++;
    if (row.yoyProfitGrowth < 0) risks.push(`YOY profit growth ${row.yoyProfitGrowth.toFixed(0)}% — declining`);
  }

  // ── FINANCIAL STRENGTH ───────────────────────────────────────────────────
  if (row.de !== undefined) {
    finS += sv(row.de, [0.5,1.0,2.0], false); finC++;
    if (row.de > 3.0) redFlags.push({ label:`D/E ${row.de.toFixed(2)}x — CRITICAL debt`, severity:'CRITICAL' });
    else if (row.de > 2.0) redFlags.push({ label:`D/E ${row.de.toFixed(2)}x — high debt`, severity:'HIGH' });
    if (row.de <= 0.1) strengths.push(`D/E ${row.de.toFixed(2)}x — virtually debt-free`);
  }
  if (row.pledge !== undefined) {
    finS += sv(row.pledge, [5,15,30], false); finC++;
    if (row.pledge > 50) redFlags.push({ label:`Pledge ${row.pledge.toFixed(0)}% — CRITICAL`, severity:'CRITICAL' });
    else if (row.pledge > 25) redFlags.push({ label:`Pledge ${row.pledge.toFixed(0)}% — risky`, severity:'HIGH' });
    if (row.pledge < 1) strengths.push(`Zero pledge — clean promoter structure`);
  }
  if (row.icr !== undefined) { finS += sv(row.icr, [1.5,4,8]); finC++; if (row.icr < 1.5) redFlags.push({ label:`ICR ${row.icr.toFixed(1)}x — dangerously low`, severity:'CRITICAL' }); }

  // ── VALUATION ────────────────────────────────────────────────────────────
  if (row.pe !== undefined) {
    valS += sv(row.pe, b.pe, false); valC++;
    if (row.pe > 150) redFlags.push({ label:`P/E ${row.pe.toFixed(0)}x — extreme`, severity:'MEDIUM' });
  }
  if (row.peg !== undefined && row.peg > 0) {
    const s = row.peg < 0.8 ? 92 : row.peg < 1.5 ? 72 : row.peg < 2.5 ? 50 : 25;
    valS += s; valC++;
    if (row.peg < 0.8) strengths.push(`PEG ${row.peg.toFixed(2)} — undervalued for growth`);
    if (row.peg > 2.5) risks.push(`PEG ${row.peg.toFixed(2)} — expensive for growth`);
  }
  if (row.marginOfSafety !== undefined) {
    const s = row.marginOfSafety > 30 ? 90 : row.marginOfSafety > 10 ? 75 : row.marginOfSafety > 0 ? 62 : row.marginOfSafety > -20 ? 45 : 25;
    valS += s; valC++;
    if (row.marginOfSafety > 20) strengths.push(`Margin of safety ${row.marginOfSafety.toFixed(0)}% — below intrinsic value`);
    if (row.marginOfSafety < -30) risks.push(`Price ${Math.abs(row.marginOfSafety).toFixed(0)}% above intrinsic value`);
  }
  if (row.marketCapCr !== undefined) {
    const inZone = row.marketCapCr >= 500 && row.marketCapCr <= 15000;
    valS += inZone ? 80 : row.marketCapCr < 200 ? 50 : row.marketCapCr > 50000 ? 40 : 60; valC++;
    if (inZone) strengths.push(`Market cap ₹${row.marketCapCr.toLocaleString()}Cr — sweet spot`);
  }

  // ── MARKET/MOMENTUM ──────────────────────────────────────────────────────
  if (row.aboveDMA200 !== undefined) {
    mktS = row.aboveDMA200 > 10 ? 85 : row.aboveDMA200 > 0 ? 72 : row.aboveDMA200 > -15 ? 52 : 28;
    mktC = 1;
    if (row.aboveDMA200 < -30) risks.push(`${Math.abs(row.aboveDMA200).toFixed(0)}% below DMA200 — deep drawdown`);
  }
  if (row.return1m !== undefined) {
    const s = row.return1m > 10 ? 80 : row.return1m > 0 ? 65 : row.return1m > -10 ? 50 : 30;
    mktS = (mktS * mktC + s) / (mktC + 1); mktC++;
  }

  // ── COMPOSITE ────────────────────────────────────────────────────────────
  const qual   = qualC > 0 ? qualS / qualC : 50;
  const growth = growC > 0 ? growS / growC : 50;
  const fin    = finC  > 0 ? finS  / finC  : 50;
  const val    = valC  > 0 ? valS  / valC  : 50;
  const mkt    = mktS;

  const filledFields = [row.roce, row.roe, row.opm, row.cfoToPat, row.promoter, row.de,
    row.revCagr, row.profitCagr, row.yoySalesGrowth, row.yoyProfitGrowth,
    row.pe, row.peg, row.marketCapCr, row.marginOfSafety].filter(v => v !== undefined).length;
  const coverage = Math.min(100, Math.round((filledFields / 14) * 100));
  const coverageRatio = coverage / 100;

  const raw = qual*0.30 + growth*0.25 + fin*0.20 + val*0.15 + mkt*0.10;
  const penalized = raw * (0.55 + coverageRatio * 0.45);

  const hasCrit  = redFlags.some(f => f.severity === 'CRITICAL');
  const highCnt  = redFlags.filter(f => f.severity === 'HIGH').length;
  let score = Math.round(penalized / 5) * 5;
  if (hasCrit)       score = Math.min(score, 40);
  else if (highCnt >= 2) score = Math.min(score, 50);
  else if (highCnt >= 1) score = Math.min(score, 62);

  const grade: Grade = score >= 80 ? 'A+' : score >= 72 ? 'A' : score >= 63 ? 'B+' : score >= 54 ? 'B' : score >= 42 ? 'C' : 'D';

  return {
    ...row, score, grade, coverage, strengths, risks, redFlags,
    pillarScores: [
      { id:'QUALITY',      label:'Quality',     score:Math.round(qual),   color:'#a78bfa' },
      { id:'GROWTH',       label:'Growth',      score:Math.round(growth), color:'#38bdf8' },
      { id:'FIN_STRENGTH', label:'Fin Str',     score:Math.round(fin),    color:'#10b981' },
      { id:'VALUATION',    label:'Valuation',   score:Math.round(val),    color:'#f59e0b' },
      { id:'MARKET',       label:'Market',      score:Math.round(mkt),    color:'#f97316' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLUMN DETECTION — Screener.in + generic formats, any column order
// ═══════════════════════════════════════════════════════════════════════════════

function buildColMap(sampleRow: Record<string, unknown>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const col of Object.keys(sampleRow)) {
    const c = col.trim().toLowerCase().replace(/[^a-z0-9%]/g, '');
    const o = col.trim();
    // Screener.in exact names
    if (o === 'NSE Code' || o === 'NSE code')                        m['symbol'] = col;
    else if (o === 'Name')                                           m['company'] = col;
    else if (o === 'Industry')                    { if (!m['sector']) m['sector'] = col; }
    else if (o === 'Industry Group')             { if (!m['sector']) m['sector'] = col; }
    else if (o === 'Return on capital employed')                      m['roce'] = col;
    else if (o === 'Return on equity')                               m['roe'] = col;
    else if (o === 'Return on invested capital') { if (!m['roe'])    m['roe'] = col; }
    else if (o === 'OPM')                                            m['opm'] = col;
    else if (o === 'CFO to PAT')                                     m['cfoToPat'] = col;
    else if (o === 'Debt to equity')                                 m['de'] = col;
    else if (o === 'Sales growth')                                   m['revCagr'] = col;
    else if (o === 'Profit growth')                                  m['profitCagr'] = col;
    else if (o === 'YOY Quarterly sales growth')                     m['yoySalesGrowth'] = col;
    else if (o === 'YOY Quarterly profit growth')                    m['yoyProfitGrowth'] = col;
    else if (o === 'Promoter holding')                               m['promoter'] = col;
    else if (o === 'Price to Earning')                               m['pe'] = col;
    else if (o === 'PEG Ratio')                                      m['peg'] = col;
    else if (o === 'Market Capitalization')                          m['marketCapCr'] = col;
    else if (o === 'Intrinsic Value')                                m['intrinsicValue'] = col;
    else if (o === 'Current Price')                                  m['price'] = col;
    else if (o === 'DMA 200')                                        m['dma200'] = col;
    else if (o === 'Return over 1month')                             m['return1m'] = col;
    else if (o === 'Return over 1week')                              m['return1w'] = col;
    // Generic fallbacks
    else if (!m['symbol'] && (c.includes('nsecode')||c.includes('symbol')||c.includes('ticker'))) m['symbol'] = col;
    else if (!m['company'] && c.includes('name') && !c.includes('sector')) m['company'] = col;
    else if (!m['sector'] && (c.includes('sector')||c.includes('industry'))) m['sector'] = col;
    else if (!m['roce'] && (c==='roce'||c.includes('returnoncap'))) m['roce'] = col;
    else if (!m['roe'] && (c==='roe'||c.includes('returnonequit'))) m['roe'] = col;
    else if (!m['opm'] && (c==='opm'||c.includes('operatingmargin'))) m['opm'] = col;
    else if (!m['cfoToPat'] && (c.includes('cfotopat')||c.includes('cashflowpat'))) m['cfoToPat'] = col;
    else if (!m['de'] && (c.includes('debttoequit')||c==='de')) m['de'] = col;
    else if (!m['revCagr'] && (c.includes('salescagr')||c.includes('revcagr'))) m['revCagr'] = col;
    else if (!m['profitCagr'] && (c.includes('profitcagr')||c.includes('patcagr'))) m['profitCagr'] = col;
    else if (!m['yoySalesGrowth'] && c.includes('yoysales')) m['yoySalesGrowth'] = col;
    else if (!m['yoyProfitGrowth'] && c.includes('yoyprofit')) m['yoyProfitGrowth'] = col;
    else if (!m['promoter'] && c.includes('promoter') && !c.includes('pledge')) m['promoter'] = col;
    else if (!m['pledge'] && c.includes('pledge')) m['pledge'] = col;
    else if (!m['icr'] && (c.includes('icr')||c.includes('interestcoverage'))) m['icr'] = col;
    else if (!m['pe'] && (c==='pe'||c.includes('priceearning'))) m['pe'] = col;
    else if (!m['peg'] && c.includes('peg')) m['peg'] = col;
    else if (!m['pb'] && (c==='pb'||c.includes('pricebook'))) m['pb'] = col;
    else if (!m['marketCapCr'] && c.includes('marketcap')) m['marketCapCr'] = col;
    else if (!m['intrinsicValue'] && (c.includes('intrinsic')||c.includes('fairvalue'))) m['intrinsicValue'] = col;
    else if (!m['price'] && c.includes('currentprice')) m['price'] = col;
    else if (!m['dma200'] && (c.includes('dma200')||c.includes('200dma'))) m['dma200'] = col;
    else if (!m['return1m'] && (c.includes('return1m')||c.includes('1month')||c.includes('1mreturn'))) m['return1m'] = col;
  }
  return m;
}

function rawRowToExcelRow(row: Record<string, unknown>, m: Record<string, string>): ExcelRow | null {
  const n = (val: unknown): number | undefined => {
    if (val===''||val===null||val===undefined) return undefined;
    const v = parseFloat(String(val).replace(/[%,₹ ]/g,''));
    return isNaN(v) ? undefined : v;
  };
  const sym = String(row[m['symbol']] ?? '').trim().toUpperCase();
  if (!sym) return null;
  const price = n(m['price'] ? row[m['price']] : undefined);
  const iv    = n(m['intrinsicValue'] ? row[m['intrinsicValue']] : undefined);
  const dma   = n(m['dma200'] ? row[m['dma200']] : undefined);
  return {
    symbol: sym,
    company: String(row[m['company']??'']??'').trim(),
    sector:  String(row[m['sector']??'']??'INDUSTRIALS').trim() || 'INDUSTRIALS',
    roce:         n(m['roce']          ? row[m['roce']]          : undefined),
    roe:          n(m['roe']           ? row[m['roe']]           : undefined),
    opm:          n(m['opm']           ? row[m['opm']]           : undefined),
    cfoToPat:     n(m['cfoToPat']      ? row[m['cfoToPat']]      : undefined),
    de:           n(m['de']            ? row[m['de']]            : undefined),
    pledge:       n(m['pledge']        ? row[m['pledge']]        : undefined),
    icr:          n(m['icr']           ? row[m['icr']]           : undefined),
    revCagr:      n(m['revCagr']       ? row[m['revCagr']]       : undefined),
    profitCagr:   n(m['profitCagr']    ? row[m['profitCagr']]    : undefined),
    yoySalesGrowth:  n(m['yoySalesGrowth']  ? row[m['yoySalesGrowth']]  : undefined),
    yoyProfitGrowth: n(m['yoyProfitGrowth'] ? row[m['yoyProfitGrowth']] : undefined),
    pe:           n(m['pe']            ? row[m['pe']]            : undefined),
    pb:           n(m['pb']            ? row[m['pb']]            : undefined),
    peg:          n(m['peg']           ? row[m['peg']]           : undefined),
    promoter:     n(m['promoter']      ? row[m['promoter']]      : undefined),
    marketCapCr:  n(m['marketCapCr']   ? row[m['marketCapCr']]   : undefined),
    intrinsicValue: iv,
    price,
    dma200: dma,
    return1m: n(m['return1m'] ? row[m['return1m']] : undefined),
    return1w: n(m['return1w'] ? row[m['return1w']] : undefined),
    // Derived
    marginOfSafety: (iv !== undefined && price !== undefined && price > 0)
      ? Math.round((iv - price) / price * 100) : undefined,
    aboveDMA200: (dma !== undefined && price !== undefined && dma > 0)
      ? Math.round((price - dma) / dma * 100) : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL COMPARE TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ExcelCompare({ rows, setRows }: { rows: ExcelResult[]; setRows: (r: ExcelResult[]) => void }) {
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expRow, setExpRow] = useState<string | null>(null);
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const fileRef = useRef<HTMLInputElement>(null);

  async function parseSingleFile(file: File, XLSX: typeof import('xlsx')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array' });
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval:'' });
  }

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setLoading(true); setParseError('');
    try {
      const XLSX = await import('xlsx');
      const seen = new Set<string>();
      const merged: ExcelRow[] = [];
      for (const file of arr) {
        const raw = await parseSingleFile(file, XLSX);
        if (!raw.length) continue;
        const colMap = buildColMap(raw[0] as Record<string, unknown>);
        if (!colMap['symbol']) continue;
        for (const r of raw) {
          const row = rawRowToExcelRow(r as Record<string, unknown>, colMap);
          if (!row || seen.has(row.symbol)) continue;
          seen.add(row.symbol);
          merged.push(row);
        }
      }
      if (!merged.length) { setParseError('No valid rows found. Ensure files have NSE Code column.'); setLoading(false); return; }
      const scored = merged.map(r => scoreExcelRow(r)).sort((a,b) => b.score - a.score);
      setRows(scored);
      setFileName(arr.length === 1 ? arr[0].name : `${arr.length} files merged · ${merged.length} stocks`);
    } catch (e: unknown) {
      setParseError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  const GRADES: Grade[] = ['A+','A','B+','B','C','D'];
  const filtered = gradeFilter === 'ALL' ? rows : rows.filter(r => r.grade === gradeFilter);
  const topPicks = rows.filter(r => ['A+','A','B+'].includes(r.grade));

  const FIELD_LABELS: Partial<Record<keyof ExcelRow, string>> = {
    roce:'ROCE%', roe:'ROE%', opm:'OPM%', cfoToPat:'CFO/PAT',
    de:'D/E', pledge:'Pledge%', revCagr:'Sales CAGR%', profitCagr:'Profit CAGR%',
    yoySalesGrowth:'YOY Sales%', yoyProfitGrowth:'YOY Profit%',
    promoter:'Promoter%', pe:'P/E', peg:'PEG', marketCapCr:'MCap Cr',
    marginOfSafety:'MoS%', aboveDMA200:'vs DMA200%', return1m:'Ret 1M%',
  };

  return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:'20px 16px' }}>
      {/* Upload zone */}
      <div style={{ marginBottom:16, padding:'14px 16px', backgroundColor:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:10 }}>
        <div style={{ fontSize:13, fontWeight:700, color:PURPLE, marginBottom:6 }}>
          📊 Upload Screener.in exports — all fields auto-detected, any column order
        </div>
        <div style={{ fontSize:10, color:MUTED, lineHeight:1.7 }}>
          <strong style={{color:TEXT}}>Screener.in:</strong> Export any screen as CSV · all fields detected automatically including CFO/PAT, PEG, Intrinsic Value, DMA200, Return 1M<br/>
          <strong style={{color:TEXT}}>Multiple files:</strong> Select all CSVs at once — duplicates merged, highest-quality data kept
        </div>
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
        style={{ marginBottom:16, padding:'24px 20px', border:`2px dashed ${PURPLE}40`, borderRadius:12, textAlign:'center', cursor:'pointer', backgroundColor:`${PURPLE}05` }}
      >
        <div style={{ fontSize:28, marginBottom:8 }}>{loading ? '⏳' : '📁'}</div>
        <div style={{ fontSize:14, fontWeight:700, color:PURPLE }}>
          {loading ? 'Scoring...' : fileName ? `✅ ${fileName}` : 'Click or drag & drop — multiple files OK'}
        </div>
        <div style={{ fontSize:11, color:MUTED, marginTop:4 }}>
          .xlsx · .csv · any Screener.in export · all {Object.keys(FIELD_LABELS).length} fields scored automatically
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" multiple style={{ display:'none' }}
          onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); }} />
      </div>

      {parseError && <div style={{ marginBottom:12, padding:'10px 14px', backgroundColor:`${RED}10`, border:`1px solid ${RED}30`, borderRadius:8, fontSize:12, color:RED }}>{parseError}</div>}

      {rows.length > 0 && (
        <>
          {/* Summary strip */}
          <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            {[
              { label:'Scored', value:rows.length, color:PURPLE },
              { label:'Top Picks (B+)', value:topPicks.length, color:GREEN },
              { label:'Best', value:rows[0]?.score??0, color:rows[0]?.score>=72?GREEN:YELLOW },
              { label:'Avg', value:Math.round(rows.reduce((a,r)=>a+r.score,0)/rows.length), color:MUTED },
            ].map(({label,value,color}) => (
              <div key={label} style={{ padding:'8px 14px', backgroundColor:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:8, textAlign:'center' }}>
                <div style={{ fontSize:20, fontWeight:900, color }}>{value}</div>
                <div style={{ fontSize:9, color:MUTED }}>{label}</div>
              </div>
            ))}
            <div style={{ display:'flex', gap:4, alignItems:'center', marginLeft:'auto', flexWrap:'wrap' }}>
              {(['ALL',...GRADES] as const).map(g => (
                <button key={g} onClick={() => setGradeFilter(g)} style={{ fontSize:10, fontWeight:700, padding:'4px 10px', borderRadius:7, border:`1px solid ${gradeFilter===g?(GRADE_COLOR[g as Grade]||PURPLE)+'60':BORDER}`, background:gradeFilter===g?`${GRADE_COLOR[g as Grade]||PURPLE}18`:'transparent', color:gradeFilter===g?(GRADE_COLOR[g as Grade]||PURPLE):MUTED, cursor:'pointer' }}>
                  {g}{g!=='ALL' && ` (${rows.filter(r=>r.grade===g).length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div style={{ display:'grid', gridTemplateColumns:'90px 130px 52px 52px 1fr 90px', gap:8, padding:'6px 10px', fontSize:9, fontWeight:700, letterSpacing:'0.8px', color:MUTED, borderBottom:`1px solid ${BORDER}` }}>
            <span>TICKER</span><span>COMPANY</span><span>SCORE</span><span>GRADE</span><span>PILLARS</span><span>COV / FLAGS</span>
          </div>

          {filtered.map((r, idx) => {
            const isExp = expRow === r.symbol;
            const hasCrit = r.redFlags.some(f=>f.severity==='CRITICAL');
            return (
              <div key={r.symbol+idx} style={{ borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                <button onClick={() => setExpRow(isExp ? null : r.symbol)} style={{ width:'100%', background:isExp?CARD_BG:'transparent', border:'none', cursor:'pointer', textAlign:'left', padding:'10px 10px' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'90px 130px 52px 52px 1fr 90px', gap:8, alignItems:'center' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <span style={{ fontSize:13, fontWeight:800, color:hasCrit?RED:TEXT }}>{r.symbol}</span>
                      {idx < 3 && <span style={{ fontSize:10 }}>⭐</span>}
                    </div>
                    <span style={{ fontSize:10, color:MUTED, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.company || r.sector}</span>
                    <span style={{ fontSize:16, fontWeight:900, color:GRADE_COLOR[r.grade]??MUTED }}>{r.score}</span>
                    <span style={{ fontSize:11, fontWeight:800, padding:'2px 6px', borderRadius:5, color:GRADE_COLOR[r.grade], backgroundColor:`${GRADE_COLOR[r.grade]}18`, border:`1px solid ${GRADE_COLOR[r.grade]}30`, textAlign:'center' }}>{r.grade}</span>
                    {/* Pillar mini-bars */}
                    <div style={{ display:'flex', gap:3, alignItems:'center' }}>
                      {r.pillarScores.map(p => (
                        <div key={p.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1, minWidth:26 }}>
                          <span style={{ fontSize:8, fontWeight:700, color:p.color }}>{p.score}</span>
                          <div style={{ width:20, height:4, backgroundColor:'rgba(255,255,255,0.07)', borderRadius:2, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${p.score}%`, backgroundColor:p.color }} />
                          </div>
                          <span style={{ fontSize:7, color:MUTED }}>{p.label.slice(0,4)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      <span style={{ fontSize:9, color:r.coverage>=70?GREEN:r.coverage>=50?YELLOW:ORANGE }}>{r.coverage}% data</span>
                      {r.redFlags.length > 0 && (
                        <span style={{ fontSize:8, color:hasCrit?RED:ORANGE }}>⚠ {r.redFlags.length} flag{r.redFlags.length>1?'s':''}</span>
                      )}
                    </div>
                  </div>
                </button>

                {isExp && (
                  <div style={{ padding:'10px 10px 14px', backgroundColor:`${CARD_BG}80`, borderTop:`1px solid ${BORDER}` }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12 }}>
                      {/* All metrics */}
                      <div>
                        <div style={{ fontSize:9, color:MUTED, fontWeight:700, letterSpacing:'0.8px', marginBottom:5 }}>ALL METRICS</div>
                        {(Object.entries(FIELD_LABELS) as [keyof ExcelRow, string][]).map(([field, label]) => {
                          const v = r[field];
                          if (v === undefined || v === null) return null;
                          const num = v as number;
                          return (
                            <div key={field} style={{ display:'flex', justifyContent:'space-between', fontSize:10, padding:'2px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                              <span style={{ color:MUTED }}>{label}</span>
                              <span style={{ color:TEXT, fontWeight:600 }}>{field.includes('Cr') ? `₹${num.toLocaleString()}` : num.toFixed(field==='peg'||field==='de'||field==='cfoToPat'?2:1)}{field.includes('%')||field.includes('Growth')||field.includes('Cagr')||field.includes('opm')||field.includes('roe')||field.includes('roce')||field.includes('promoter')||field.includes('pledge')||field.includes('return')||field.includes('Safety')||field==='aboveDMA200'?'%':field==='pe'||field==='peg'||field==='de'||field==='cfoToPat'?'x':''}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Strengths / Risks / Flags */}
                      <div>
                        {r.strengths.length > 0 && <>
                          <div style={{ fontSize:9, color:GREEN, fontWeight:700, letterSpacing:'0.8px', marginBottom:4 }}>✅ STRENGTHS</div>
                          {r.strengths.map((s,i) => <div key={i} style={{ fontSize:10, color:MUTED, padding:'2px 0' }}>› {s}</div>)}
                        </>}
                        {r.risks.length > 0 && <>
                          <div style={{ fontSize:9, color:ORANGE, fontWeight:700, letterSpacing:'0.8px', marginTop:8, marginBottom:4 }}>⚠️ RISKS</div>
                          {r.risks.map((s,i) => <div key={i} style={{ fontSize:10, color:MUTED, padding:'2px 0' }}>› {s}</div>)}
                        </>}
                        {r.redFlags.length > 0 && <>
                          <div style={{ fontSize:9, color:RED, fontWeight:700, letterSpacing:'0.8px', marginTop:8, marginBottom:4 }}>🚨 RED FLAGS</div>
                          {r.redFlags.map((f,i) => <div key={i} style={{ fontSize:10, color:f.severity==='CRITICAL'?RED:ORANGE, padding:'2px 0' }}>⛔ {f.label}</div>)}
                        </>}
                      </div>
                    </div>
                    <div style={{ fontSize:9, color:MUTED, borderTop:`1px solid ${BORDER}`, paddingTop:6, marginTop:8 }}>
                      Sector: {r.sector} · Data coverage: {r.coverage}% of {Object.keys(FIELD_LABELS).length} fields
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {!rows.length && !loading && !parseError && (
        <div style={{ textAlign:'center', padding:40, color:MUTED }}>
          <div style={{ fontSize:36 }}>📤</div>
          <div style={{ fontSize:13, color:TEXT, fontWeight:600, marginTop:10 }}>Upload your Screener.in exports to score all stocks</div>
          <div style={{ fontSize:11, color:MUTED, marginTop:4 }}>All {Object.keys(FIELD_LABELS).length} fields scored · CFO/PAT · PEG · Intrinsic Value · Momentum · Coverage % shown per stock</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKLIST TAB — auto-checks from uploaded Excel, manual override
// ═══════════════════════════════════════════════════════════════════════════════

function MultibaggerChecklist({ excelRows }: { excelRows: ExcelResult[] }) {
  const [symbol, setSymbol] = useState('');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [savedSymbols, setSavedSymbols] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  function loadSymbol(sym: string) {
    setActiveSymbol(sym);
    try { setChecks(JSON.parse(localStorage.getItem(`mb2_checks_${sym}`) || '{}')); } catch { setChecks({}); }
    try { setNotes(JSON.parse(localStorage.getItem(`mb2_notes_${sym}`)  || '{}')); } catch { setNotes({}); }
  }
  function addSymbol() {
    const s = symbol.trim().toUpperCase();
    if (!s || savedSymbols.includes(s)) return;
    const next = [...savedSymbols, s];
    setSavedSymbols(next);
    localStorage.setItem('mb2_symbols', JSON.stringify(next));
    loadSymbol(s); setSymbol('');
  }
  function removeSymbol(sym: string) {
    const next = savedSymbols.filter(x => x !== sym);
    setSavedSymbols(next);
    localStorage.setItem('mb2_symbols', JSON.stringify(next));
    if (activeSymbol === sym) { setActiveSymbol(next[0]??''); setChecks({}); setNotes({}); }
  }
  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    if (activeSymbol) localStorage.setItem(`mb2_checks_${activeSymbol}`, JSON.stringify(next));
  }
  function setNote(id: string, val: string) {
    const next = { ...notes, [id]: val };
    setNotes(next);
    if (activeSymbol) localStorage.setItem(`mb2_notes_${activeSymbol}`, JSON.stringify(next));
  }

  // Restore saved symbols on mount
  useMemo(() => {
    try {
      const syms = JSON.parse(localStorage.getItem('mb2_symbols') || '[]') as string[];
      setSavedSymbols(syms);
      if (syms.length > 0 && !activeSymbol) loadSymbol(syms[0]);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-checks from uploaded Excel data
  const excelStock = excelRows.find(r => r.symbol.toUpperCase() === activeSymbol.toUpperCase());
  const autoChecks = useMemo((): Record<string, { pass: boolean; note: string } | null> => {
    if (!excelStock) return {};
    const result: Record<string, { pass: boolean; note: string } | null> = {};
    for (const item of CHECKLIST) {
      if (!item.autoField || !item.autoPass) continue;
      const val = excelStock[item.autoField] as number | undefined;
      if (val === undefined || val === null) continue;
      const pass = item.autoPass(val);
      const note = `Auto from Excel: ${item.autoFormat ? item.autoFormat(val) : val.toFixed(2)} → ${pass ? '✅ Pass' : '❌ Fail'}`;
      result[item.id] = { pass, note };
    }
    return result;
  }, [excelStock]);

  const pillars = [...new Set(CHECKLIST.map(i => i.pillar))];
  const completed = CHECKLIST.filter(i => autoChecks[i.id]?.pass || checks[i.id]).length;
  const autoPassed = Object.values(autoChecks).filter(v => v?.pass).length;
  const pct = Math.round((completed / CHECKLIST.length) * 100);
  const grade: Grade = pct >= 85 ? 'A+' : pct >= 72 ? 'A' : pct >= 58 ? 'B+' : pct >= 44 ? 'B' : pct >= 30 ? 'C' : 'D';

  return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:'20px 16px' }}>
      {excelRows.length > 0 && (
        <div style={{ marginBottom:12, padding:'8px 14px', backgroundColor:`${GREEN}08`, border:`1px solid ${GREEN}20`, borderRadius:8, fontSize:11, color:GREEN }}>
          🤖 {excelRows.length} stocks loaded from Excel — select any to auto-verify criteria · {autoPassed > 0 ? `${autoPassed} items already auto-verified` : 'type a ticker below'}
        </div>
      )}

      {/* Ticker bar */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key==='Enter'&&addSymbol()}
          placeholder="Add ticker (e.g. HBLENGINE)" maxLength={20}
          style={{ flex:'0 0 200px', padding:'8px 12px', backgroundColor:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:8, color:TEXT, fontSize:13, fontWeight:600, outline:'none' }} />
        <button onClick={addSymbol} style={{ padding:'8px 14px', backgroundColor:`${PURPLE}20`, border:`1px solid ${PURPLE}40`, borderRadius:8, color:PURPLE, fontSize:12, fontWeight:700, cursor:'pointer' }}>Add</button>
        {/* Quick-add from Excel */}
        {excelRows.slice(0,8).map(r => (
          <button key={r.symbol} onClick={() => {
            if (!savedSymbols.includes(r.symbol)) { const n=[...savedSymbols,r.symbol]; setSavedSymbols(n); localStorage.setItem('mb2_symbols',JSON.stringify(n)); }
            loadSymbol(r.symbol);
          }} style={{ padding:'4px 10px', borderRadius:6, border:`1px solid ${activeSymbol===r.symbol?GRADE_COLOR[r.grade]:BORDER}`, background:activeSymbol===r.symbol?`${GRADE_COLOR[r.grade]}15`:'transparent', color:activeSymbol===r.symbol?GRADE_COLOR[r.grade]:MUTED, fontSize:10, fontWeight:700, cursor:'pointer' }}>
            {r.symbol} <span style={{ color:GRADE_COLOR[r.grade] }}>{r.grade}</span>
          </button>
        ))}
        {savedSymbols.map(s => (
          <div key={s} style={{ display:'flex', borderRadius:8, border:`1px solid ${activeSymbol===s?`${PURPLE}60`:BORDER}`, overflow:'hidden' }}>
            <button onClick={() => loadSymbol(s)} style={{ padding:'6px 12px', background:activeSymbol===s?`${PURPLE}20`:'transparent', border:'none', cursor:'pointer', color:activeSymbol===s?PURPLE:MUTED, fontSize:12, fontWeight:700 }}>{s}</button>
            <button onClick={() => removeSymbol(s)} style={{ padding:'6px 8px', background:'none', border:'none', borderLeft:`1px solid ${BORDER}`, cursor:'pointer', color:MUTED, fontSize:11 }}>×</button>
          </div>
        ))}
      </div>

      {!activeSymbol ? (
        <div style={{ textAlign:'center', padding:48, color:MUTED }}>
          <div style={{ fontSize:36 }}>📋</div>
          <div style={{ fontSize:14, color:TEXT, fontWeight:600, marginTop:12 }}>Add a ticker or click any Excel score above</div>
          <div style={{ fontSize:11, color:MUTED, marginTop:6 }}>25 criteria · 5 pillars · auto-verified from your uploaded data · manual override for judgment calls</div>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div style={{ marginBottom:16, padding:'12px 16px', backgroundColor:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <div>
                <span style={{ fontSize:15, fontWeight:800, color:TEXT }}>{activeSymbol}</span>
                {excelStock && <span style={{ fontSize:11, color:MUTED, marginLeft:8 }}>{excelStock.company} · {excelStock.sector} · Score {excelStock.score} {excelStock.grade}</span>}
              </div>
              <div style={{ textAlign:'right' }}>
                <span style={{ fontSize:22, fontWeight:900, color:GRADE_COLOR[grade]??MUTED }}>{grade}</span>
                <span style={{ fontSize:11, color:MUTED, marginLeft:6 }}>{completed}/{CHECKLIST.length} ({pct}%)</span>
              </div>
            </div>
            <div style={{ height:8, backgroundColor:'rgba(255,255,255,0.07)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${pct}%`, background:pct>=70?GREEN:pct>=50?YELLOW:RED, borderRadius:4, transition:'width 0.3s' }} />
            </div>
            <div style={{ display:'flex', gap:16, marginTop:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:10, color:GREEN }}>✅ {completed} passed</span>
              <span style={{ fontSize:10, color:ACCENT }}>🤖 {autoPassed} auto from Excel</span>
              <span style={{ fontSize:10, color:MUTED }}>{CHECKLIST.length - completed} remaining</span>
              {!excelStock && excelRows.length > 0 && <span style={{ fontSize:10, color:YELLOW }}>⚠ {activeSymbol} not in uploaded Excel — upload to enable auto-checks</span>}
            </div>
          </div>

          {/* Checklist */}
          {pillars.map(pillar => {
            const items = CHECKLIST.filter(i => i.pillar === pillar);
            const pc = items[0].pillarColor;
            const passed = items.filter(i => autoChecks[i.id]?.pass || checks[i.id]).length;
            return (
              <div key={pillar} style={{ marginBottom:18 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:10, fontWeight:700, letterSpacing:'1px', color:pc }}>{pillar.replace('_',' ')}</span>
                  <span style={{ fontSize:9, color:MUTED }}>({passed}/{items.length})</span>
                  <div style={{ flex:1, height:1, backgroundColor:`${pc}20` }} />
                </div>
                {items.map(item => {
                  const auto = autoChecks[item.id];
                  const isChecked = auto?.pass || checks[item.id];
                  const isFail = auto && !auto.pass;
                  const isAuto = !!auto;
                  return (
                    <div key={item.id} style={{ marginBottom:6, borderRadius:8, border:`1px solid ${isChecked?`${pc}28`:isFail?`${RED}28`:BORDER}`, backgroundColor:isChecked?`${pc}06`:isFail?`${RED}04`:CARD_BG, overflow:'hidden' }}>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px' }}>
                        <button onClick={() => !isAuto && toggleCheck(item.id)} style={{ background:'none', border:`1.5px solid ${isChecked?pc:isFail?RED:MUTED}`, borderRadius:4, width:18, height:18, cursor:isAuto?'default':'pointer', flexShrink:0, marginTop:1, display:'flex', alignItems:'center', justifyContent:'center', color:isChecked?pc:isFail?RED:'transparent', fontSize:11, fontWeight:900 }}>
                          {isChecked?'✓':isFail?'✗':''}
                        </button>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2, flexWrap:'wrap' }}>
                            <span style={{ fontSize:12, color:TEXT, fontWeight:500 }}>{item.label}</span>
                            {isAuto && <span style={{ fontSize:8, fontWeight:800, color:ACCENT, border:`1px solid ${ACCENT}30`, padding:'0 4px', borderRadius:3 }}>AUTO</span>}
                            <span style={{ fontSize:9, color:pc, marginLeft:'auto', fontWeight:600 }}>wt {item.weight}%</span>
                          </div>
                          <div style={{ fontSize:10, color:MUTED }}><strong>Target:</strong> {item.target}</div>
                          {auto?.note && <div style={{ fontSize:10, color:auto.pass?GREEN:RED, marginTop:2 }}>{auto.note}</div>}
                          {!isAuto && (
                            <input value={notes[item.id]||''} onChange={e => setNote(item.id, e.target.value)}
                              placeholder="Your research note…"
                              style={{ width:'100%', marginTop:6, padding:'4px 8px', backgroundColor:'rgba(255,255,255,0.04)', border:`1px solid ${BORDER}`, borderRadius:5, color:MUTED, fontSize:10, outline:'none', boxSizing:'border-box' }} />
                          )}
                        </div>
                      </div>
                      <div style={{ padding:'0 12px 8px 40px', fontSize:10, color:`${MUTED}90` }}>{item.why}</div>
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
// MAIN PAGE — Excel Compare + Checklist only
// ═══════════════════════════════════════════════════════════════════════════════

export default function MultibaggerPage() {
  const [activeTab, setActiveTab] = useState<'excel' | 'checklist'>('excel');
  // Shared Excel results between both tabs so Checklist can auto-check
  const [excelRows, setExcelRows] = useState<ExcelResult[]>([]);

  return (
    <div style={{ background:BG, minHeight:'100vh', color:TEXT, fontFamily:'system-ui,-apple-system,sans-serif' }}>
      {/* Header */}
      <div style={{ backgroundColor:'#13131a', borderBottom:'1px solid rgba(255,255,255,0.06)', padding:'16px 20px 0' }}>
        <div style={{ maxWidth:900, margin:'0 auto' }}>
          <div style={{ marginBottom:14 }}>
            <h1 style={{ fontSize:20, fontWeight:900, color:PURPLE, margin:0 }}>🚀 Multibagger</h1>
            <p style={{ fontSize:11, color:MUTED, margin:'3px 0 0' }}>5-pillar scoring · 25-point checklist · Upload your Screener.in data — no scraping</p>
          </div>
          <div style={{ display:'flex' }}>
            {([
              { id:'excel',     label:'📤 Excel Compare',   desc:'Upload CSVs → instant 5-pillar scoring' },
              { id:'checklist', label:'📋 Checklist',        desc:`25-point research checklist${excelRows.length?` · ${excelRows.length} stocks ready`:''}` },
            ] as const).map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding:'9px 18px', border:'none', cursor:'pointer', backgroundColor:'transparent', color:active?PURPLE:MUTED, fontSize:13, fontWeight:active?700:400, borderBottom:active?`2px solid ${PURPLE}`:'2px solid transparent', marginBottom:-1, flexShrink:0, transition:'all 0.15s' }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab === 'excel'     && <ExcelCompare rows={excelRows} setRows={setExcelRows} />}
      {activeTab === 'checklist' && <MultibaggerChecklist excelRows={excelRows} />}
    </div>
  );
}
