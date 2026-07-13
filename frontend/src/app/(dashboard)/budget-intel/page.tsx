'use client';

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET INTEL (zzz244) — Two-tab redesign
//   Tab 1 · KEY INFO        — verbatim extraction: fiscal headline, deficit
//                             block, receipts breakdown, full ministry table
//                             (Grand Total row included), top schemes, raw
//                             text preview per document
//   Tab 2 · ANALYTICS       — winners/losers, ministry bar chart, receipts +
//                             expenditure donuts, sector plays with mapped
//                             listed stocks, narrative theme extractor
//
// PARSER CHANGES vs zzz243:
//   • Ministry table scoping — anchor on "Expenditure of Major Items" and
//     stop at "Grand Total". Prevents sub-scheme rows from later pages from
//     being mis-read as ministries.
//   • Scale gate — BE-new figure must be ≥ ₹5000 Cr. Sub-scheme rows at
//     ₹1000-3000 Cr are filtered out.
//   • Receipts breakdown parser for Revenue/Tax/Non-tax/Capital/Borrowings.
//   • Deficit block parser (Fiscal/Revenue/Effective/Primary).
//   • Rupee-comes-from + Rupee-goes-to composition parser.
//   • Top-scheme parser for the analytical side.
//
// Client-side PDF (pdf.js CDN) + DOCX (mammoth CDN). No npm changes.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

type MinistryRow = {
  ministry: string;
  actualsPrev: number | null;
  bePrev: number | null;
  rePrev: number | null;
  beNew: number | null;
  yoyVsRE: number | null;
  yoyVsActual: number | null;
};
type ReceiptsBreakdown = {
  revenueReceipts: number | null;
  taxRevenue: number | null;
  nonTaxRevenue: number | null;
  capitalReceipts: number | null;
  loanRecovery: number | null;
  otherReceipts: number | null;
  borrowings: number | null;
  yoyBEvsActual: Record<string, number | null>;
};
type DeficitBlock = {
  fiscalDeficit: number | null;
  revenueDeficit: number | null;
  effectiveRevenueDeficit: number | null;
  primaryDeficit: number | null;
};
type CompositionSlice = { label: string; pct: number };
type FiscalHeadline = {
  totalExpBE: number | null;
  totalCapExBE: number | null;
  effectiveCapExBE: number | null;
  interestPayments: number | null;
  yearNew: string;
  yearPrev: string;
};

// ─── Ministry → sector-play mapping ────────────────────────────────────────
const SECTOR_MAP: Record<string, { sector: string; stocks: { ticker: string; name: string; rationale: string }[] }> = {
  'Defence': { sector: 'Defence & Aerospace', stocks: [
    { ticker: 'HAL', name: 'Hindustan Aeronautics', rationale: 'Tejas MK-1A, engines' },
    { ticker: 'BEL', name: 'Bharat Electronics', rationale: 'Radar, avionics, missiles' },
    { ticker: 'MAZDOCK', name: 'Mazagon Dock', rationale: 'Submarines, warships' },
    { ticker: 'BDL', name: 'Bharat Dynamics', rationale: 'Missiles, torpedoes' },
    { ticker: 'ASTRAMICRO', name: 'Astra Microwave', rationale: 'Radar sub-systems' },
    { ticker: 'DATAPATTNS', name: 'Data Patterns', rationale: 'Electronic warfare' },
    { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Optics, drones' },
    { ticker: 'ZENTEC', name: 'Zen Technologies', rationale: 'Combat simulators' },
    { ticker: 'MTAR', name: 'MTAR Technologies', rationale: 'Precision components' },
  ]},
  'Transport': { sector: 'Roads, Rail, Ports, Logistics', stocks: [
    { ticker: 'LT', name: 'Larsen & Toubro', rationale: 'Bellwether infra EPC' },
    { ticker: 'IRB', name: 'IRB Infra', rationale: 'BOT road toll operator' },
    { ticker: 'KNRCON', name: 'KNR Constructions', rationale: 'Roads EPC pure-play' },
    { ticker: 'GRINFRA', name: 'G R Infra', rationale: 'HAM roads' },
    { ticker: 'IRCON', name: 'Ircon International', rationale: 'Railway construction' },
    { ticker: 'RVNL', name: 'Rail Vikas Nigam', rationale: 'Railway EPC arm' },
    { ticker: 'TITAGARH', name: 'Titagarh Rail', rationale: 'Wagon + metro' },
    { ticker: 'BEML', name: 'BEML Ltd', rationale: 'Metro coaches' },
    { ticker: 'JSWINFRA', name: 'JSW Infrastructure', rationale: 'Ports capacity' },
    { ticker: 'ADANIPORTS', name: 'Adani Ports & SEZ', rationale: 'Largest port operator' },
  ]},
  'Rural Development': { sector: 'Rural, Tractors, Consumer', stocks: [
    { ticker: 'M&M', name: 'Mahindra & Mahindra', rationale: 'Tractors + rural SUV' },
    { ticker: 'ESCORTS', name: 'Escorts Kubota', rationale: 'Tractors pure-play' },
    { ticker: 'HEROMOTOCO', name: 'Hero MotoCorp', rationale: 'Rural 2W leader' },
    { ticker: 'DABUR', name: 'Dabur India', rationale: 'Rural FMCG' },
    { ticker: 'HINDUNILVR', name: 'HUL', rationale: 'FMCG rural mix' },
    { ticker: 'JYOTHYLAB', name: 'Jyothy Labs', rationale: 'Rural detergents' },
  ]},
  'Agriculture': { sector: 'Agri Inputs, Seeds, Irrigation', stocks: [
    { ticker: 'UPL', name: 'UPL Ltd', rationale: 'Agrochemicals' },
    { ticker: 'BAYERCROP', name: 'Bayer CropScience', rationale: 'Seeds' },
    { ticker: 'PIIND', name: 'PI Industries', rationale: 'Contract mfg agri' },
    { ticker: 'DHANUKA', name: 'Dhanuka Agritech', rationale: 'Domestic agrochem' },
    { ticker: 'KRBL', name: 'KRBL', rationale: 'Basmati exports' },
  ]},
  'Urban Development': { sector: 'Housing, Cement, Materials', stocks: [
    { ticker: 'ULTRACEMCO', name: 'UltraTech Cement', rationale: 'Cement leader' },
    { ticker: 'DALBHARAT', name: 'Dalmia Bharat', rationale: 'Cement south/east' },
    { ticker: 'SHREECEM', name: 'Shree Cement', rationale: 'Cement north' },
    { ticker: 'PIDILITIND', name: 'Pidilite', rationale: 'Adhesives' },
    { ticker: 'ASIANPAINT', name: 'Asian Paints', rationale: 'Housing paint' },
    { ticker: 'KAJARIACER', name: 'Kajaria Ceramics', rationale: 'Tiles' },
    { ticker: 'HAVELLS', name: 'Havells', rationale: 'Electricals' },
  ]},
  'Health': { sector: 'Healthcare, Hospitals, Pharma', stocks: [
    { ticker: 'APOLLOHOSP', name: 'Apollo Hospitals', rationale: 'Hospital chain' },
    { ticker: 'MAXHEALTH', name: 'Max Healthcare', rationale: 'Hospitals' },
    { ticker: 'FORTIS', name: 'Fortis Healthcare', rationale: 'Hospitals' },
    { ticker: 'CIPLA', name: 'Cipla', rationale: 'Domestic pharma' },
    { ticker: 'DRREDDY', name: "Dr Reddy's", rationale: 'Pharma' },
    { ticker: 'ERIS', name: 'Eris Lifesciences', rationale: 'Branded pharma' },
    { ticker: 'THYROCARE', name: 'Thyrocare', rationale: 'Diagnostics' },
  ]},
  'Education': { sector: 'Education, EdTech, Skilling', stocks: [
    { ticker: 'NAVNETEDUL', name: 'Navneet Education', rationale: 'Textbooks' },
    { ticker: 'CAREERP', name: 'Career Point', rationale: 'Coaching' },
    { ticker: 'ZEELEARN', name: 'Zee Learn', rationale: 'K-12 chain' },
  ]},
  'Energy': { sector: 'Power, Renewables, Transmission', stocks: [
    { ticker: 'POWERGRID', name: 'Power Grid Corp', rationale: 'Transmission monopoly' },
    { ticker: 'NTPC', name: 'NTPC', rationale: 'Thermal + renewable IPP' },
    { ticker: 'NHPC', name: 'NHPC', rationale: 'Hydro' },
    { ticker: 'ADANIGREEN', name: 'Adani Green', rationale: 'Solar/wind IPP' },
    { ticker: 'TATAPOWER', name: 'Tata Power', rationale: 'Integrated utility' },
    { ticker: 'SUZLON', name: 'Suzlon Energy', rationale: 'Wind OEM' },
    { ticker: 'WAAREEENER', name: 'Waaree Energies', rationale: 'Solar modules' },
  ]},
  'IT and Telecom': { sector: 'Telecom, Data, Fibre', stocks: [
    { ticker: 'BHARTIARTL', name: 'Bharti Airtel', rationale: 'Telecom' },
    { ticker: 'STLTECH', name: 'STL Tech', rationale: 'Optical fibre' },
    { ticker: 'HFCL', name: 'HFCL', rationale: 'Fibre + defence' },
  ]},
  'Home Affairs': { sector: 'Homeland Security', stocks: [
    { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Border surveillance' },
    { ticker: 'ASTRAMICRO', name: 'Astra Microwave', rationale: 'Radar' },
  ]},
  'Commerce and Industry': { sector: 'PLI Manufacturing, EMS', stocks: [
    { ticker: 'DIXON', name: 'Dixon Technologies', rationale: 'PLI electronics' },
    { ticker: 'AMBER', name: 'Amber Enterprises', rationale: 'PLI ACs' },
    { ticker: 'KAYNES', name: 'Kaynes Technology', rationale: 'EMS + OSAT' },
    { ticker: 'SYRMA', name: 'Syrma SGS', rationale: 'EMS' },
    { ticker: 'CYIENTDLM', name: 'Cyient DLM', rationale: 'EMS defence/aero' },
    { ticker: 'CENTUM', name: 'Centum Electronics', rationale: 'EMS defence' },
  ]},
  'Fertiliser': { sector: 'Fertiliser (subsidy)', stocks: [
    { ticker: 'COROMANDEL', name: 'Coromandel International', rationale: 'DAP/NPK' },
    { ticker: 'CHAMBLFERT', name: 'Chambal Fertilisers', rationale: 'Urea + NPK' },
    { ticker: 'GNFC', name: 'GNFC', rationale: 'Fertiliser + chem' },
    { ticker: 'GSFC', name: 'GSFC', rationale: 'Fertiliser' },
    { ticker: 'RCF', name: 'RCF', rationale: 'Urea + industrial' },
  ]},
  'Food': { sector: 'PDS, FCI, Warehousing', stocks: [
    { ticker: 'CONCOR', name: 'Container Corp', rationale: 'Food-grain logistics' },
    { ticker: 'KRBL', name: 'KRBL', rationale: 'Rice' },
    { ticker: 'ADANIAGRO', name: 'Adani Agri Logistics', rationale: 'Grain silos' },
  ]},
  'Petroleum': { sector: 'OMCs, LPG', stocks: [
    { ticker: 'IOC', name: 'Indian Oil', rationale: 'OMC — LPG subsidy' },
    { ticker: 'BPCL', name: 'BPCL', rationale: 'OMC' },
    { ticker: 'HINDPETRO', name: 'HPCL', rationale: 'OMC' },
    { ticker: 'GAIL', name: 'GAIL', rationale: 'Gas transmission' },
  ]},
  'Scientific Departments': { sector: 'Space, R&D', stocks: [
    { ticker: 'MTAR', name: 'MTAR Technologies', rationale: 'ISRO precision parts' },
    { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Space optics' },
    { ticker: 'CENTUM', name: 'Centum Electronics', rationale: 'Space electronics' },
  ]},
};

function parseNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = String(s).replace(/[₹Rs.,  ]/g, '').replace(/[ -⁯]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function pct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}
function fmtCr(v: number | null): string {
  if (v == null) return '—';
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)} L Cr`;
  return `₹${Math.round(v).toLocaleString('en-IN')} Cr`;
}
function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

async function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return w.pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pdfjs'));
    document.head.appendChild(s);
  });
  const pdfjsLib = w.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return pdfjsLib;
}
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuf }).promise;
  const chunks: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => it.str);
    chunks.push(`\n\n=== PAGE ${p} ===\n` + strings.join(' '));
  }
  return chunks.join('\n');
}
async function loadMammoth(): Promise<any> {
  const w = window as any;
  if (w.mammoth) return w.mammoth;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load mammoth'));
    document.head.appendChild(s);
  });
  return (window as any).mammoth;
}
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await loadMammoth();
  const arrayBuf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuf });
  return result.value || '';
}

// Locate the ministry section only, avoiding sub-scheme pollution
function extractMinistrySection(rawText: string): string {
  const anchor = /Expenditure of Major Items/i;
  const endAnchor = /Grand Total/i;
  const start = rawText.search(anchor);
  if (start < 0) return '';
  const rest = rawText.slice(start);
  const end = rest.search(endAnchor);
  if (end < 0) return rest.slice(0, 6000);
  return rest.slice(0, end + 300);
}

const MINISTRY_MATCHERS: { label: string; pattern: RegExp }[] = [
  { label: 'Pension',                 pattern: /\bPension\b/ },
  { label: 'Defence',                 pattern: /\bDefence\b/ },
  { label: 'Fertiliser',              pattern: /Fertili[sz]er\b/ },
  { label: 'Food',                    pattern: /\bFood\b/ },
  { label: 'Petroleum',               pattern: /\bPetroleum\b/ },
  { label: 'Agriculture',             pattern: /Agriculture and Allied|Agriculture &? Allied/i },
  { label: 'Commerce and Industry',   pattern: /Commerce and Industry|Commerce &? Industry/i },
  { label: 'Development of North East', pattern: /North\s?East/i },
  { label: 'Education',               pattern: /\bEducation\b/ },
  { label: 'Energy',                  pattern: /\bEnergy\b/ },
  { label: 'External Affairs',        pattern: /External Affairs/i },
  { label: 'Finance',                 pattern: /\bFinance\b/ },
  { label: 'Health',                  pattern: /\bHealth\b/ },
  { label: 'Home Affairs',            pattern: /Home Affairs/i },
  { label: 'Interest',                pattern: /\bInterest\b/ },
  { label: 'IT and Telecom',          pattern: /IT and Telecom|IT &? Telecom/i },
  { label: 'Rural Development',       pattern: /Rural Development/i },
  { label: 'Scientific Departments',  pattern: /Scientific Departments?/i },
  { label: 'Social Welfare',          pattern: /Social Welfare/i },
  { label: 'Tax Administration',      pattern: /Tax Administration/i },
  { label: 'Transport',               pattern: /\bTransport\b/ },
  { label: 'Urban Development',       pattern: /Urban Development/i },
  { label: 'Others',                  pattern: /\bOthers\b/ },
];

function parseMinistryTable(rawText: string): MinistryRow[] {
  const section = extractMinistrySection(rawText);
  if (!section) return [];
  const text = section.replace(/[\r\t]/g, ' ').replace(/ /g, ' ');
  const lines = text.split(/\n+/);
  const rows: MinistryRow[] = [];
  for (const line of lines) {
    if (/Grand Total|कुल\s?जोड़/.test(line)) continue;
    const numMatch = line.match(/([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s*$/);
    if (!numMatch) continue;
    let matched: { label: string } | null = null;
    for (const m of MINISTRY_MATCHERS) {
      if (m.pattern.test(line)) { matched = { label: m.label }; break; }
    }
    if (!matched) continue;
    if (rows.some(r => r.ministry === matched!.label)) continue;
    const [_, a, b, c, d] = numMatch;
    const actualsPrev = parseNumber(a);
    const bePrev = parseNumber(b);
    const rePrev = parseNumber(c);
    const beNew = parseNumber(d);
    if (beNew == null || beNew < 5000) continue;  // scale gate
    rows.push({
      ministry: matched.label, actualsPrev, bePrev, rePrev, beNew,
      yoyVsRE: pct(beNew, rePrev), yoyVsActual: pct(beNew, actualsPrev),
    });
  }
  return rows;
}

function parseGrandTotal(rawText: string): { actualsPrev: number|null; bePrev: number|null; rePrev: number|null; beNew: number|null } {
  const m = rawText.replace(/[\r\t]/g, ' ').match(/Grand Total\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})/i);
  if (!m) return { actualsPrev: null, bePrev: null, rePrev: null, beNew: null };
  return {
    actualsPrev: parseNumber(m[1]), bePrev: parseNumber(m[2]),
    rePrev: parseNumber(m[3]), beNew: parseNumber(m[4]),
  };
}

function parseFiscalHeadline(rawText: string): FiscalHeadline {
  const text = rawText.replace(/\s+/g, ' ');
  const grab = (re: RegExp): number | null => {
    const mm = text.match(re);
    return mm ? parseNumber(mm[1]) : null;
  };
  const yr = text.match(/BUDGET AT A GLANCE\s+(\d{4}-\d{4})/);
  const yearNew = yr ? yr[1] : '';
  const yearPrev = yearNew ? `${parseInt(yearNew.slice(0, 4)) - 1}-${parseInt(yearNew.slice(5, 9)) - 1}` : '';
  const totalExpBE = grab(/total expenditure[^0-9]{0,80}₹?\s*([\d,]{6,})/i);
  const totalCapExBE = grab(/total capital expenditure[^0-9]{0,50}₹?\s*([\d,]{6,})/i);
  const effectiveCapExBE = grab(/effective capital expenditure[^0-9]{0,50}₹?\s*([\d,]{6,})/i);
  const interestPayments = grab(/Interest Payments?\s+[\d,]{6,}\s+[\d,]{6,}\s+[\d,]{6,}\s+([\d,]{6,})/);
  return { totalExpBE, totalCapExBE, effectiveCapExBE, interestPayments, yearNew, yearPrev };
}

function parseReceiptsBreakdown(rawText: string): ReceiptsBreakdown {
  const text = rawText.replace(/\s+/g, ' ');
  const grab4 = (re: RegExp): [number|null, number|null] => {
    const m = text.match(re);
    if (!m) return [null, null];
    return [parseNumber(m[1]), parseNumber(m[4])];
  };
  const [revAct, revBE]   = grab4(/Revenue Receipts\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [taxAct, taxBE]   = grab4(/Tax Revenue[^0-9]*([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [ntAct, ntBE]     = grab4(/Non Tax Revenue\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [capAct, capBE]   = grab4(/Capital Receipts\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [loanAct, loanBE] = grab4(/Recovery of Loans\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
  const [othAct, othBE]   = grab4(/Other\s+Receipts\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
  const [borrAct, borrBE] = grab4(/Borrowings and Other[^0-9]*([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  return {
    revenueReceipts: revBE, taxRevenue: taxBE, nonTaxRevenue: ntBE,
    capitalReceipts: capBE, loanRecovery: loanBE, otherReceipts: othBE, borrowings: borrBE,
    yoyBEvsActual: {
      revenueReceipts: pct(revBE, revAct),
      taxRevenue: pct(taxBE, taxAct),
      nonTaxRevenue: pct(ntBE, ntAct),
      capitalReceipts: pct(capBE, capAct),
      loanRecovery: pct(loanBE, loanAct),
      otherReceipts: pct(othBE, othAct),
      borrowings: pct(borrBE, borrAct),
    },
  };
}

function parseDeficitBlock(rawText: string): DeficitBlock {
  const text = rawText.replace(/\s+/g, ' ');
  const grab = (re: RegExp): number | null => {
    const m = text.match(re);
    return m ? parseNumber(m[1]) : null;
  };
  return {
    fiscalDeficit: grab(/Fiscal Deficit\s+[\d,]{6,}\s+[\d,]{6,}\s+[\d,]{6,}\s+([\d,]{6,})/i),
    revenueDeficit: grab(/Revenue Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i),
    effectiveRevenueDeficit: grab(/Effective Revenue Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i),
    primaryDeficit: grab(/Primary Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i),
  };
}

function parseRupeeComesFrom(rawText: string): CompositionSlice[] {
  const labels = ['Corporation Tax', 'Income Tax', 'Customs', 'Union Excise Duties', 'GST', 'Non Tax Revenue', 'Non Debt Capital Receipts', 'Borrowings'];
  const out: CompositionSlice[] = [];
  const text = rawText.replace(/\s+/g, ' ');
  for (const l of labels) {
    const re = new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^0-9]{0,25}(\\d{1,3})\\b');
    const m = text.match(re);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > 0 && v < 60) out.push({ label: l, pct: v });
    }
  }
  return out;
}
function parseRupeeGoesTo(rawText: string): CompositionSlice[] {
  const labels = ['States Share of Taxes', 'Finance Commission', 'Centrally Sponsored', 'Interest Payment', 'Defence', 'Major Subsidies', 'Central Sector Scheme', 'Civil Pension', 'Other Expenditures'];
  const out: CompositionSlice[] = [];
  const text = rawText.replace(/\s+/g, ' ');
  for (const l of labels) {
    const re = new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^0-9]{0,25}(\\d{1,3})\\b');
    const m = text.match(re);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > 0 && v < 60) out.push({ label: l, pct: v });
    }
  }
  return out;
}

type SchemeRow = { name: string; beNew: number; rePrev: number|null; delta: number|null };
function parseTopSchemes(rawText: string): SchemeRow[] {
  const rows: SchemeRow[] = [];
  const lines = rawText.split(/\n+/);
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const m = line.match(/^\d{1,3}\s+([A-Za-z][A-Za-z0-9 ()\-&/,\.']{5,80})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/);
    if (!m) continue;
    const name = m[1].replace(/\s+/g, ' ').trim();
    const rePrev = parseNumber(m[4]);
    const beNew = parseNumber(m[5]);
    if (beNew == null || beNew < 1000) continue;
    if (/Grand Total|Total\s/i.test(name)) continue;
    rows.push({ name, beNew, rePrev, delta: pct(beNew, rePrev) });
  }
  rows.sort((a, b) => b.beNew - a.beNew);
  const seen = new Set<string>();
  return rows.filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; }).slice(0, 25);
}

const THEME_PATTERNS: { theme: string; icon: string; patterns: RegExp[] }[] = [
  { theme: 'Infrastructure push', icon: '🏗', patterns: [/infrastructure\b/i, /\bcapex\b/i, /public investment/i, /highways?/i] },
  { theme: 'Defence indigenisation', icon: '🛡', patterns: [/indigeni[sz]ation/i, /Aatmanirbhar.*defen[cs]e/i, /defen[cs]e.*procurement/i] },
  { theme: 'PLI / manufacturing', icon: '🏭', patterns: [/PLI\b/, /production.linked/i, /electronics manufacturing/i, /semiconductor/i] },
  { theme: 'Rural + agri thrust', icon: '🌾', patterns: [/rural\b/i, /\bagriculture/i, /farmer/i, /MSP\b/, /PM-?KISAN/i] },
  { theme: 'Renewable energy', icon: '⚡', patterns: [/renewable/i, /\bsolar\b/i, /green hydrogen/i, /battery storage/i] },
  { theme: 'Fiscal consolidation', icon: '📉', patterns: [/fiscal deficit.*(?:reduc|consolid|lower|glide)/i, /fiscal prudence/i] },
  { theme: 'Tax simplification', icon: '📋', patterns: [/GST simplification/i, /new tax regime/i, /rate rationali[sz]ation/i] },
  { theme: 'Digital public infra', icon: '💻', patterns: [/DPI\b/, /\bUPI\b/, /\bONDC\b/, /Digital India/i] },
  { theme: 'Housing / urban', icon: '🏠', patterns: [/PMAY\b/, /affordable housing/i, /urban develop/i] },
  { theme: 'Skilling & jobs', icon: '👷', patterns: [/skilling/i, /employ(?:ment|ability)/i, /Skill India/i] },
  { theme: 'Healthcare access', icon: '🏥', patterns: [/Ayushman/i, /Jan Aushadhi/i, /health insurance/i] },
  { theme: 'Startups / MSME credit', icon: '🚀', patterns: [/startup/i, /\bMSME\b/, /credit guarantee/i, /Mudra\b/i] },
];
function extractThemes(text: string): { theme: string; icon: string; hits: number; snippet: string }[] {
  const out: { theme: string; icon: string; hits: number; snippet: string }[] = [];
  for (const t of THEME_PATTERNS) {
    let hits = 0; let snippet = '';
    for (const p of t.patterns) {
      const matches = text.match(new RegExp(p.source, p.flags + 'g'));
      if (matches) {
        hits += matches.length;
        if (!snippet) {
          const m = text.match(p);
          if (m && m.index != null) {
            const start = Math.max(0, m.index - 60);
            const end = Math.min(text.length, m.index + 160);
            snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
          }
        }
      }
    }
    if (hits > 0) out.push({ theme: t.theme, icon: t.icon, hits, snippet });
  }
  return out.sort((a, b) => b.hits - a.hits);
}

export default function BudgetIntelPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rawTexts, setRawTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [tab, setTab] = useState<'info' | 'analytics'>('info');
  const dropRef = useRef<HTMLDivElement>(null);

  const mergedText = useMemo(
    () => Object.values(rawTexts).join('\n\n') + '\n\n' + pastedText,
    [rawTexts, pastedText]
  );

  const ministries = useMemo(() => parseMinistryTable(mergedText), [mergedText]);
  const grandTotal = useMemo(() => parseGrandTotal(mergedText), [mergedText]);
  const headline = useMemo(() => parseFiscalHeadline(mergedText), [mergedText]);
  const receipts = useMemo(() => parseReceiptsBreakdown(mergedText), [mergedText]);
  const deficits = useMemo(() => parseDeficitBlock(mergedText), [mergedText]);
  const comesFrom = useMemo(() => parseRupeeComesFrom(mergedText), [mergedText]);
  const goesTo = useMemo(() => parseRupeeGoesTo(mergedText), [mergedText]);
  const topSchemes = useMemo(() => parseTopSchemes(mergedText), [mergedText]);
  const themes = useMemo(() => extractThemes(mergedText), [mergedText]);

  const winners = useMemo(() => ministries.filter(m => (m.yoyVsRE ?? 0) > 0).sort((a, b) => (b.yoyVsRE || 0) - (a.yoyVsRE || 0)), [ministries]);
  const losers = useMemo(() => ministries.filter(m => (m.yoyVsRE ?? 0) < 0).sort((a, b) => (a.yoyVsRE || 0) - (b.yoyVsRE || 0)), [ministries]);

  const sectorPlays = useMemo(() => {
    return ministries
      .filter(m => SECTOR_MAP[m.ministry])
      .map(m => {
        const yoy = m.yoyVsRE ?? m.yoyVsActual ?? 0;
        return {
          sector: SECTOR_MAP[m.ministry].sector,
          ministry: m.ministry,
          direction: yoy > 3 ? 'up' : yoy < -3 ? 'down' : 'flat',
          yoyPct: yoy,
          stocks: SECTOR_MAP[m.ministry].stocks,
        };
      })
      .sort((a, b) => b.yoyPct - a.yoyPct);
  }, [ministries]);

  const handleFiles = useCallback(async (fs: FileList | File[]) => {
    const arr = Array.from(fs);
    setBusy(true); setError(null);
    try {
      const next: Record<string, string> = { ...rawTexts };
      for (const f of arr) {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        if (ext === 'pdf') {
          try { next[f.name] = await extractPdfText(f); }
          catch (e: any) { setError(`PDF parse failed for ${f.name}: ${e?.message || e}`); }
        } else if (ext === 'docx') {
          try { next[f.name] = await extractDocxText(f); }
          catch (e: any) { setError(`DOCX parse failed for ${f.name}: ${e?.message || e}`); }
        } else if (ext === 'txt' || ext === 'md') {
          next[f.name] = await f.text();
        } else {
          setError(`${f.name}: try PDF or DOCX, or paste text below.`);
        }
      }
      setFiles(prev => {
        const merged = [...prev];
        for (const a of arr) if (!merged.find(m => m.name === a.name)) merged.push(a);
        return merged;
      });
      setRawTexts(next);
    } finally { setBusy(false); }
  }, [rawTexts]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const drop = (e: DragEvent) => {
      prevent(e);
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    };
    el.addEventListener('dragover', prevent);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragover', prevent);
      el.removeEventListener('drop', drop);
    };
  }, [handleFiles]);

  const BG = 'var(--mc-bg-0)';
  const TEXT = 'var(--mc-text-0)';
  const DIM = 'var(--mc-text-3)';
  const CARD = { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 12, padding: '18px 20px' };
  const H = { fontSize: 12, fontWeight: 800, color: '#60A5FA', letterSpacing: '0.5px', marginBottom: 12, textTransform: 'uppercase' as const };

  const KV = ({ label, value, sub, color }: any) => (
    <div style={{ ...CARD, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, color: DIM, fontWeight: 700, letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || TEXT, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const tabStyle = (active: boolean): any => ({
    padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 800,
    background: active ? 'linear-gradient(90deg, #60A5FA, #22D3EE)' : 'var(--mc-bg-2)',
    color: active ? '#0B1220' : TEXT,
    border: active ? 'none' : '1px solid var(--mc-bg-4)',
    cursor: 'pointer', letterSpacing: '0.3px',
  });

  const empty = ministries.length === 0 && themes.length === 0 && files.length === 0 && !pastedText;
  const yearLabel = headline.yearNew || (grandTotal.beNew ? '2026-27' : '');

  const barCard = (data: MinistryRow[]) => {
    if (!data.length) return null;
    const top = [...data].sort((a, b) => (b.beNew || 0) - (a.beNew || 0)).slice(0, 15);
    const max = Math.max(...top.map(m => m.beNew || 0));
    return (
      <div style={CARD}>
        <div style={H}>📊 Top 15 ministries by allocation ({yearLabel} BE)</div>
        <div>
          {top.map(m => (
            <div key={m.ministry} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: TEXT, fontWeight: 700 }}>{m.ministry}</span>
                <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' as const }}>
                  {fmtCr(m.beNew)}
                  <span style={{ color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', marginLeft: 8, fontWeight: 800 }}>{fmtPct(m.yoyVsRE)}</span>
                </span>
              </div>
              <div style={{ height: 7, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${((m.beNew || 0) / max) * 100}%`, background: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const donut = (title: string, data: CompositionSlice[]) => {
    if (!data.length) return null;
    const total = data.reduce((a, b) => a + b.pct, 0);
    const colors = ['#F59E0B', '#22D3EE', '#A78BFA', '#EF4444', '#10B981', '#60A5FA', '#F472B6', '#FBBF24', '#94A3B8'];
    let angle = 0;
    const size = 160, r = 60, cx = size / 2, cy = size / 2;
    const arcs = data.map((d, i) => {
      const startAngle = angle;
      angle += (d.pct / total) * 2 * Math.PI;
      const x1 = cx + r * Math.cos(startAngle - Math.PI / 2);
      const y1 = cy + r * Math.sin(startAngle - Math.PI / 2);
      const x2 = cx + r * Math.cos(angle - Math.PI / 2);
      const y2 = cy + r * Math.sin(angle - Math.PI / 2);
      const large = (angle - startAngle) > Math.PI ? 1 : 0;
      return <path key={d.label} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={colors[i % colors.length]} opacity={0.9} />;
    });
    return (
      <div style={CARD}>
        <div style={H}>{title}</div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <svg width={size} height={size}>
            {arcs}
            <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--mc-bg-1)" />
          </svg>
          <div style={{ flex: 1, minWidth: 180 }}>
            {[...data].sort((a, b) => b.pct - a.pct).map((d) => {
              const idx = data.findIndex(x => x.label === d.label);
              return (
                <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                  <span style={{ color: TEXT, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[idx % colors.length] }} />
                    {d.label}
                  </span>
                  <span style={{ color: DIM, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const }}>{d.pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>📊 Budget Intel</h1>
            <div style={{ marginTop: 4, fontSize: 12.5, color: DIM }}>
              Union Budget PDF/DOCX in → institutional brief out. Parses ministry allocations, receipts composition, deficit block, and narrative themes fully client-side.
            </div>
          </div>
          {yearLabel && (
            <div style={{ fontSize: 12, padding: '6px 12px', background: 'color-mix(in srgb, #F59E0B 15%, transparent)', border: '1px solid color-mix(in srgb, #F59E0B 40%, transparent)', color: '#F59E0B', borderRadius: 6, fontWeight: 800 }}>
              Budget FY {yearLabel}
            </div>
          )}
        </div>

        <div
          ref={dropRef}
          style={{ ...CARD, border: '2px dashed color-mix(in srgb, #60A5FA 50%, transparent)', padding: '24px 20px', textAlign: 'center' as const, cursor: 'pointer', background: 'color-mix(in srgb, #60A5FA 4%, transparent)' }}
          onClick={() => (document.getElementById('budget-file-input') as HTMLInputElement)?.click()}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>📥</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Drop PDF / DOCX — or click to pick</div>
          <div style={{ fontSize: 11.5, color: DIM, marginTop: 4 }}>
            Budget-at-a-Glance + Highlights + Speech together give best output. Multiple files supported.
          </div>
          {busy && <div style={{ marginTop: 10, fontSize: 12, color: '#F59E0B', fontWeight: 700 }}>Extracting text…</div>}
          {error && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--mc-bearish)' }}>{error}</div>}
          {files.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {files.map(f => (
                <span key={f.name} style={{ fontSize: 11, padding: '3px 10px', background: 'color-mix(in srgb, #10B981 15%, transparent)', border: '1px solid color-mix(in srgb, #10B981 40%, transparent)', color: '#10B981', borderRadius: 6, fontWeight: 700 }}>
                  📄 {f.name} · {Math.round(f.size / 1024)} KB
                </span>
              ))}
            </div>
          )}
          <input id="budget-file-input" type="file" multiple accept=".pdf,.txt,.md,.docx" style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>

        <details style={{ ...CARD, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: DIM, fontWeight: 700 }}>📋 Or paste raw text from PPT/DOC/speech</summary>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="Paste any budget-related text — parsed alongside uploaded files."
            style={{ marginTop: 8, width: '100%', minHeight: 100, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 10, color: TEXT, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </details>

        {empty && (
          <div style={{ ...CARD, padding: '40px 20px', textAlign: 'center' as const, color: DIM }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 14 }}>Upload the Budget PDFs above to unlock Key Info + Analytics tabs.</div>
          </div>
        )}

        {!empty && (
          <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--mc-bg-3)', paddingBottom: 8 }}>
            <button style={tabStyle(tab === 'info')} onClick={() => setTab('info')}>📋 Key Info Extraction</button>
            <button style={tabStyle(tab === 'analytics')} onClick={() => setTab('analytics')}>📈 Budget Analytics</button>
          </div>
        )}

        {!empty && tab === 'info' && (
          <>
            {(headline.totalExpBE || grandTotal.beNew) && (
              <div>
                <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>🇮🇳 FISCAL HEADLINE — {yearLabel} BE</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <KV label="Total Expenditure BE" value={fmtCr(headline.totalExpBE ?? grandTotal.beNew)} />
                  <KV label="Total Capital Expenditure" value={fmtCr(headline.totalCapExBE)} sub={headline.effectiveCapExBE ? `Effective ${fmtCr(headline.effectiveCapExBE)}` : ''} color="#22D3EE" />
                  <KV label="Interest Payments" value={fmtCr(headline.interestPayments)} sub={(headline.totalExpBE || grandTotal.beNew) && headline.interestPayments ? `${((headline.interestPayments / (headline.totalExpBE || grandTotal.beNew || 1)) * 100).toFixed(1)}% of total` : ''} color="#F59E0B" />
                  <KV label="Prior year total (Actuals)" value={fmtCr(grandTotal.actualsPrev)} sub={grandTotal.actualsPrev && grandTotal.beNew ? `${fmtPct(pct(grandTotal.beNew, grandTotal.actualsPrev))} growth` : ''} />
                </div>
              </div>
            )}

            {(deficits.fiscalDeficit || deficits.revenueDeficit) && (
              <div>
                <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>📉 DEFICIT BLOCK — {yearLabel} BE</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <KV label="Fiscal Deficit" value={fmtCr(deficits.fiscalDeficit)} color="#EF4444" sub="Total exp − total receipts (excl. debt cap)" />
                  <KV label="Revenue Deficit" value={fmtCr(deficits.revenueDeficit)} color="#F59E0B" sub="Rev exp − rev receipts" />
                  <KV label="Effective Rev Deficit" value={fmtCr(deficits.effectiveRevenueDeficit)} sub="Rev def − grants for capital assets" />
                  <KV label="Primary Deficit" value={fmtCr(deficits.primaryDeficit)} sub="Fiscal def − interest payments" />
                </div>
              </div>
            )}

            {(receipts.revenueReceipts || receipts.taxRevenue) && (
              <div style={CARD}>
                <div style={H}>💰 Receipts breakdown ({yearLabel} BE vs prior FY Actuals)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {([
                    ['Revenue Receipts', receipts.revenueReceipts, receipts.yoyBEvsActual.revenueReceipts],
                    ['Tax Revenue (net)', receipts.taxRevenue, receipts.yoyBEvsActual.taxRevenue],
                    ['Non-Tax Revenue', receipts.nonTaxRevenue, receipts.yoyBEvsActual.nonTaxRevenue],
                    ['Capital Receipts', receipts.capitalReceipts, receipts.yoyBEvsActual.capitalReceipts],
                    ['Recovery of Loans', receipts.loanRecovery, receipts.yoyBEvsActual.loanRecovery],
                    ['Other Receipts (disinvest.)', receipts.otherReceipts, receipts.yoyBEvsActual.otherReceipts],
                    ['Borrowings (net)', receipts.borrowings, receipts.yoyBEvsActual.borrowings],
                  ] as [string, number|null, number|null][]).filter(([, v]) => v != null).map(([label, val, yoy]) => (
                    <div key={label} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>{fmtCr(val)}</div>
                      {yoy != null && <div style={{ fontSize: 11, color: yoy >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>{fmtPct(yoy)} vs Actuals</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ministries.length > 0 && (
              <div style={CARD}>
                <div style={H}>📚 Expenditure of Major Items — every ministry, verbatim</div>
                <div style={{ overflowX: 'auto' as const }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' as const }}>
                    <thead>
                      <tr style={{ color: DIM }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Ministry</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>Actuals prev FY</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>BE current FY</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>RE current FY</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>BE new FY</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>Δ vs RE</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>Δ vs Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ministries.map(m => (
                        <tr key={m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>{m.ministry}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(m.actualsPrev)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: DIM }}>{fmtCr(m.bePrev)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(m.rePrev)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 800 }}>{fmtCr(m.beNew)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontWeight: 800, color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsRE)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, color: (m.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsActual)}</td>
                        </tr>
                      ))}
                      {grandTotal.beNew && (
                        <tr style={{ borderTop: '2px solid var(--mc-bg-4)', background: 'var(--mc-bg-2)' }}>
                          <td style={{ padding: '8px', fontWeight: 900 }}>Grand Total</td>
                          <td style={{ padding: '8px', textAlign: 'right' as const, fontWeight: 900 }}>{fmtCr(grandTotal.actualsPrev)}</td>
                          <td style={{ padding: '8px', textAlign: 'right' as const, fontWeight: 800, color: DIM }}>{fmtCr(grandTotal.bePrev)}</td>
                          <td style={{ padding: '8px', textAlign: 'right' as const, fontWeight: 900 }}>{fmtCr(grandTotal.rePrev)}</td>
                          <td style={{ padding: '8px', textAlign: 'right' as const, fontWeight: 900 }}>{fmtCr(grandTotal.beNew)}</td>
                          <td colSpan={2} style={{ padding: '8px', textAlign: 'right' as const, fontWeight: 800, color: 'var(--mc-bullish)' }}>
                            {fmtPct(pct(grandTotal.beNew, grandTotal.rePrev))} vs RE · {fmtPct(pct(grandTotal.beNew, grandTotal.actualsPrev))} vs Actual
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {topSchemes.length > 0 && (
              <div style={CARD}>
                <div style={H}>🏗 Top scheme allocations (sub-ministry level, top 25 by BE)</div>
                <div style={{ overflowX: 'auto' as const }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' as const }}>
                    <thead>
                      <tr style={{ color: DIM }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Scheme</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>RE current</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>BE new</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' as const }}>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSchemes.map(s => (
                        <tr key={s.name} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                          <td style={{ padding: '6px 8px' }}>{s.name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, color: DIM, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(s.rePrev)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontWeight: 800, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(s.beNew)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontWeight: 800, color: (s.delta ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(s.delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {Object.keys(rawTexts).length > 0 && (
              <div style={CARD}>
                <div style={H}>📄 Raw extraction preview (per uploaded document)</div>
                {Object.entries(rawTexts).map(([name, text]) => (
                  <details key={name} style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: 'pointer', color: '#60A5FA', fontWeight: 700, fontSize: 12 }}>{name} · {text.length.toLocaleString('en-IN')} chars</summary>
                    <pre style={{ fontSize: 10.5, color: DIM, whiteSpace: 'pre-wrap' as const, marginTop: 6, maxHeight: 300, overflowY: 'auto' as const, background: 'var(--mc-bg-2)', padding: 10, borderRadius: 6 }}>{text.slice(0, 3500)}{text.length > 3500 ? '…' : ''}</pre>
                  </details>
                ))}
              </div>
            )}
          </>
        )}

        {!empty && tab === 'analytics' && (
          <>
            {ministries.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                <div style={CARD}>
                  <div style={H}>📈 Winners — allocation raised vs current RE</div>
                  {winners.length ? winners.slice(0, 12).map(m => (
                    <div key={m.ministry} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed var(--mc-bg-3)' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{m.ministry}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{fmtCr(m.rePrev)} → {fmtCr(m.beNew)} · vs Actual {fmtPct(m.yoyVsActual)}</div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' as const }}>{fmtPct(m.yoyVsRE)}</div>
                    </div>
                  )) : <div style={{ fontSize: 12, color: DIM }}>None identified</div>}
                </div>
                <div style={CARD}>
                  <div style={H}>📉 Losers — allocation cut vs current RE</div>
                  {losers.length ? losers.slice(0, 12).map(m => (
                    <div key={m.ministry} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed var(--mc-bg-3)' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{m.ministry}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{fmtCr(m.rePrev)} → {fmtCr(m.beNew)} · vs Actual {fmtPct(m.yoyVsActual)}</div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' as const }}>{fmtPct(m.yoyVsRE)}</div>
                    </div>
                  )) : <div style={{ fontSize: 12, color: DIM }}>None identified</div>}
                </div>
              </div>
            )}

            {barCard(ministries)}

            {(comesFrom.length > 0 || goesTo.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                {comesFrom.length > 0 && donut('💵 Where the Rupee Comes From', comesFrom)}
                {goesTo.length > 0 && donut('💸 Where the Rupee Goes To', goesTo)}
              </div>
            )}

            {sectorPlays.length > 0 && (
              <div style={CARD}>
                <div style={H}>💼 Institutional sector plays — listed names that ride each allocation shift</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
                  {sectorPlays.map(sp => (
                    <div key={sp.sector} style={{ padding: 12, background: 'var(--mc-bg-2)', border: `1px solid ${sp.direction === 'up' ? 'color-mix(in srgb, var(--mc-bullish) 40%, transparent)' : sp.direction === 'down' ? 'color-mix(in srgb, var(--mc-bearish) 40%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{sp.sector}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: sp.direction === 'up' ? 'var(--mc-bullish)' : sp.direction === 'down' ? 'var(--mc-bearish)' : DIM }}>
                          {sp.direction === 'up' ? '▲' : sp.direction === 'down' ? '▼' : '—'} {fmtPct(sp.yoyPct)}
                        </div>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginBottom: 8 }}>Trigger: {sp.ministry}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {sp.stocks.slice(0, 9).map(s => (
                          <div key={s.ticker} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
                            <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${s.ticker}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60A5FA', fontWeight: 700, textDecoration: 'none', minWidth: 100 }}>{s.ticker}</a>
                            <span style={{ color: DIM, flex: 1 }}>{s.rationale}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 12 }}>Historical beneficiary heuristics — not recommendations.</div>
              </div>
            )}

            {themes.length > 0 && (
              <div style={CARD}>
                <div style={H}>🔍 Narrative themes across every uploaded document</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                  {themes.map(t => (
                    <div key={t.theme} style={{ padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{t.icon} {t.theme}</div>
                        <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 800 }}>{t.hits}×</div>
                      </div>
                      {t.snippet && <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' as const, lineHeight: 1.4 }}>"…{t.snippet}…"</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!empty && (
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', textAlign: 'center' as const, padding: '8px 0' }}>
            All numbers extracted verbatim from the Ministry of Finance PDFs via anchor-scoped regex. Sector-play stock lists are historical beneficiary heuristics, not recommendations.
          </div>
        )}

      </div>
    </div>
  );
}
