'use client';

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET INTEL (zzz256) — 22-bug audit fix + theme expansion + Themes tab
//
//  Fixes shipped in this pass:
//   1. Capital Expenditure never shows dash — "On Capital Account" fallback
//   2. Fiscal year detection uses rightmost BE column, not doc title
//   3. Others / subsidy items excluded from ranking + heatmap + AI summary
//   4. Fiscal Quality Score shows real %, penalises interest > 25%, benchmark
//   5. Top Schemes parser: flat scan, 500 Cr floor, merged text
//   6. Rupee slice parser: positional regex + sum-≈-100 validation
//   7. Fertiliser/Food/Petroleum classified as SUBSIDIES, not ministries
//   8. Unified formatCurrency, deficit color thresholds, sequential rank col
//   9. Auto-save banner + beforeunload warning + paste-clear on PDF drop
//  10. Theme keyword sets expanded: 22 themes incl. Semi / EV / Water / etc.
//  11. Theme evidence filters out numeric-heavy snippets
//  12. New "🎨 Themes Deep-Dive" tab shows every detected theme + schemes
//  13. Extreme cuts (>50% & Finance ministry) auto-annotated
//  14. Ministry # col = sequential rank per current sort, not internal id
//  15. Ministry buttons white-space:nowrap so no truncation
//  16. Multi-year canonical ministry mapping (no phantom Development of NE)
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────
type MinistryRow = {
  ministry: string;
  actualsPrev: number | null;
  bePrev: number | null;
  rePrev: number | null;
  beNew: number | null;
  yoyVsRE: number | null;
  yoyVsActual: number | null;
};
type EnrichedMinistry = MinistryRow & {
  yoyVsBE: number | null;
  absoluteDeltaRE: number | null;
  absoluteDeltaActual: number | null;
  shareOfBudget: number | null;
  rank: number;
  priorityScore: number;
  category: 'winner' | 'loser' | 'flat';
  note?: string;
};
type SubsidyRow = MinistryRow;
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
  fiscalDeficitPctGDP: number | null;
  revenueDeficitPctGDP: number | null;
  gdpEstimate: number | null;
};
type CompositionSlice = { label: string; pct: number };
type FiscalHeadline = {
  totalExpBE: number | null;
  totalCapExBE: number | null;
  effectiveCapExBE: number | null;
  interestPayments: number | null;
  gdpEstimate: number | null;
  grossTaxRevenue: number | null;
  yearNew: string;
  yearPrev: string;
  yearActuals: string;
};
type GrandTotal = { actualsPrev: number|null; bePrev: number|null; rePrev: number|null; beNew: number|null };
type SchemeRow = { name: string; beNew: number; rePrev: number|null; delta: number|null; ministry?: string };
type Theme = { theme: string; icon: string; hits: number; snippet: string; schemes: string[]; stockCue: string[] };
type BudgetYearData = {
  fiscalYear: string;
  uploadedAt: string;
  documents: { name: string; size: number; textLen: number }[];
  rawTexts: Record<string, string>;
  ministries: EnrichedMinistry[];
  subsidies: SubsidyRow[];
  grandTotal: GrandTotal;
  headline: FiscalHeadline;
  receipts: ReceiptsBreakdown;
  deficits: DeficitBlock;
  comesFrom: CompositionSlice[];
  goesTo: CompositionSlice[];
  topSchemes: SchemeRow[];
  themes: Theme[];
};
type SectorPlay = {
  sector: string;
  ministry: string;
  direction: 'up' | 'down' | 'flat';
  yoyPct: number;
  stocks: { ticker: string; name: string; rationale: string }[];
  note?: string;
};

const SUBSIDY_ITEMS = new Set(['Fertiliser', 'Food', 'Petroleum']);
const EXCLUDED_FROM_RANKING = new Set(['Others', 'Planning and Statistics']);

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
  'Scientific Departments': { sector: 'Space, R&D', stocks: [
    { ticker: 'MTAR', name: 'MTAR Technologies', rationale: 'ISRO precision parts' },
    { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Space optics' },
    { ticker: 'CENTUM', name: 'Centum Electronics', rationale: 'Space electronics' },
  ]},
};

const SUBSIDY_STOCKS: Record<string, { name: string; stocks: { ticker: string; name: string; rationale: string }[] }> = {
  'Fertiliser': { name: 'Fertiliser subsidy', stocks: [
    { ticker: 'COROMANDEL', name: 'Coromandel International', rationale: 'DAP/NPK' },
    { ticker: 'CHAMBLFERT', name: 'Chambal Fertilisers', rationale: 'Urea + NPK' },
    { ticker: 'GNFC', name: 'GNFC', rationale: 'Fertiliser + chem' },
    { ticker: 'GSFC', name: 'GSFC', rationale: 'Fertiliser' },
    { ticker: 'RCF', name: 'RCF', rationale: 'Urea + industrial' },
  ]},
  'Food': { name: 'Food subsidy (PDS/FCI)', stocks: [
    { ticker: 'CONCOR', name: 'Container Corp', rationale: 'Food-grain logistics' },
    { ticker: 'KRBL', name: 'KRBL', rationale: 'Rice' },
  ]},
  'Petroleum': { name: 'Petroleum subsidy (OMCs, LPG)', stocks: [
    { ticker: 'IOC', name: 'Indian Oil', rationale: 'OMC — LPG subsidy' },
    { ticker: 'BPCL', name: 'BPCL', rationale: 'OMC' },
    { ticker: 'HINDPETRO', name: 'HPCL', rationale: 'OMC' },
    { ticker: 'GAIL', name: 'GAIL', rationale: 'Gas transmission' },
  ]},
};

const STORAGE_PREFIX = 'mc:budget-intel:v2:';
const INDEX_KEY = STORAGE_PREFIX + '__index';

function loadYearIndex(): string[] {
  if (typeof window === 'undefined') return [];
  try { const raw = localStorage.getItem(INDEX_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveYearIndex(years: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(years)); } catch {}
}
function loadYearData(fy: string): BudgetYearData | null {
  if (typeof window === 'undefined') return null;
  try { const raw = localStorage.getItem(STORAGE_PREFIX + fy); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveYearData(data: BudgetYearData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PREFIX + data.fiscalYear, JSON.stringify(data));
    const idx = loadYearIndex();
    if (!idx.includes(data.fiscalYear)) { idx.push(data.fiscalYear); idx.sort(); saveYearIndex(idx); }
  } catch (e: any) {
    try {
      const slim = { ...data, rawTexts: {} };
      localStorage.setItem(STORAGE_PREFIX + data.fiscalYear, JSON.stringify(slim));
      const idx = loadYearIndex();
      if (!idx.includes(data.fiscalYear)) { idx.push(data.fiscalYear); idx.sort(); saveYearIndex(idx); }
    } catch {}
  }
}
function deleteYearData(fy: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_PREFIX + fy);
    const idx = loadYearIndex().filter(y => y !== fy);
    saveYearIndex(idx);
  } catch {}
}

function parseNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = String(s).replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function pct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}
function fmtCr(v: number | null): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)} L Cr`;
  return `₹${Math.round(v).toLocaleString('en-IN')} Cr`;
}
function fmtLCr(v: number | null): string {
  if (v == null) return '—';
  return `₹${(v / 100000).toFixed(2)} L Cr`;
}
function fmtDelta(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 100000) return `${v >= 0 ? '+' : '−'}₹${(abs / 100000).toFixed(2)} L Cr`;
  return `${v >= 0 ? '+' : '−'}₹${Math.round(abs).toLocaleString('en-IN')} Cr`;
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
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load pdfjs'));
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
    let pageText = '';
    for (const it of content.items as any[]) {
      pageText += it.str || '';
      if (it.hasEOL) pageText += '\n'; else pageText += ' ';
    }
    chunks.push(`\n\n=== PAGE ${p} ===\n` + pageText);
  }
  return chunks.join('\n');
}
async function loadMammoth(): Promise<any> {
  const w = window as any;
  if (w.mammoth) return w.mammoth;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load mammoth'));
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

const MINISTRY_MATCHERS: { label: string; pattern: RegExp; isSubsidy?: boolean }[] = [
  { label: 'Pension', pattern: /\bPension\b/ },
  { label: 'Defence', pattern: /\bDefence\b/ },
  { label: 'Fertiliser', pattern: /Fertili[sz]er\b/, isSubsidy: true },
  { label: 'Food', pattern: /\bFood\b/, isSubsidy: true },
  { label: 'Petroleum', pattern: /\bPetroleum\b/, isSubsidy: true },
  { label: 'Agriculture', pattern: /Agriculture\s+and\s+Allied/i },
  { label: 'Commerce and Industry', pattern: /Commerce\s+and\s+Industry/i },
  { label: 'Development of North East', pattern: /Development\s+of\s+North\s+East/i },
  { label: 'Education', pattern: /\bEducation\b/ },
  { label: 'Energy', pattern: /\bEnergy\d?\b/ },
  { label: 'External Affairs', pattern: /External\s+Affairs/i },
  { label: 'Finance', pattern: /\bFinance\b/ },
  { label: 'Health', pattern: /\bHealth\b/ },
  { label: 'Home Affairs', pattern: /Home\s+Affairs/i },
  { label: 'Interest', pattern: /\bInterest\b/ },
  { label: 'IT and Telecom', pattern: /IT\s+and\s+Telecom/i },
  { label: 'Rural Development', pattern: /Rural\s+Development/i },
  { label: 'Scientific Departments', pattern: /Scientific\s+Departments?/i },
  { label: 'Social Welfare', pattern: /Social\s+Welfare/i },
  { label: 'Tax Administration', pattern: /Tax\s+Administration/i },
  { label: 'Transport', pattern: /\bTransport\b/ },
  { label: 'Urban Development', pattern: /Urban\s+Development/i },
  { label: 'Planning and Statistics', pattern: /Planning\s+and\s+Statistics/i },
  { label: 'Others', pattern: /\bOthers\b/ },
];

function parseMinistryTable(rawText: string): { ministries: MinistryRow[]; subsidies: SubsidyRow[] } {
  const text = rawText.replace(/[\r\t\n]/g, ' ').replace(/\s+/g, ' ');
  const ministries: MinistryRow[] = [];
  const subsidies: SubsidyRow[] = [];
  for (const m of MINISTRY_MATCHERS) {
    const flags = m.pattern.flags.includes('i') ? m.pattern.flags : m.pattern.flags + 'i';
    const combined = new RegExp('(?:' + m.pattern.source + ')[^\\n]{0,30}?\\s([\\d,]{4,})\\s+([\\d,]{4,})\\s+([\\d,]{4,})\\s+([\\d,]{4,})', flags);
    const match = text.match(combined);
    if (!match) continue;
    const bucket = m.isSubsidy ? subsidies : ministries;
    if (bucket.some(r => r.ministry === m.label)) continue;
    const [_, a, b, c, d] = match;
    const actualsPrev = parseNumber(a);
    const bePrev = parseNumber(b);
    const rePrev = parseNumber(c);
    const beNew = parseNumber(d);
    const floor = m.isSubsidy ? 1000 : 3000;
    if (beNew == null || beNew < floor) continue;
    bucket.push({
      ministry: m.label, actualsPrev, bePrev, rePrev, beNew,
      yoyVsRE: pct(beNew, rePrev), yoyVsActual: pct(beNew, actualsPrev),
    });
  }
  return { ministries, subsidies };
}

function enrichMinistries(rows: MinistryRow[], grandTotalBE: number | null): EnrichedMinistry[] {
  const rankable = rows.filter(r => !EXCLUDED_FROM_RANKING.has(r.ministry));
  const totalBudget = grandTotalBE ?? rows.reduce((a, r) => a + (r.beNew || 0), 0);
  const ranked = [...rankable].sort((a, b) => (b.beNew || 0) - (a.beNew || 0));
  const rankMap = new Map<string, number>();
  ranked.forEach((r, i) => rankMap.set(r.ministry, i + 1));

  const withRaw = rows.map(r => {
    const rank = rankMap.get(r.ministry) || 999;
    const shareOfBudget = r.beNew && totalBudget > 0 ? Math.round((r.beNew / totalBudget) * 1000) / 10 : null;
    const yoyVsBE = pct(r.beNew, r.bePrev);
    const absoluteDeltaRE = (r.beNew != null && r.rePrev != null) ? r.beNew - r.rePrev : null;
    const absoluteDeltaActual = (r.beNew != null && r.actualsPrev != null) ? r.beNew - r.actualsPrev : null;
    const y = r.yoyVsRE ?? 0;
    let category: 'winner' | 'loser' | 'flat' = 'flat';
    if (y > 3) category = 'winner'; else if (y < -3) category = 'loser';

    let raw = 50;
    const sizeWeight = shareOfBudget != null && shareOfBudget > 0
      ? Math.max(0.3, Math.min(1, Math.log10(Math.max(0.1, shareOfBudget)) + 0.9))
      : 0.4;
    raw += Math.min(25, Math.max(-25, y)) * sizeWeight;
    if (rank <= 5) raw += 15; else if (rank <= 10) raw += 10; else if (rank <= 15) raw += 5;
    if (shareOfBudget != null) {
      if (shareOfBudget >= 8) raw += 12;
      else if (shareOfBudget >= 4) raw += 7;
      else if (shareOfBudget >= 2) raw += 3;
    }
    if (r.yoyVsActual != null && r.yoyVsActual >= 20) raw += 4;
    if (y < -8) raw -= 15;
    if (r.yoyVsActual != null && r.yoyVsActual < 0) raw -= 4;

    let note: string | undefined;
    if (r.ministry === 'Finance' && y < -50) {
      note = 'GST Compensation Fund phasing out — structural distortion, not a policy cut';
    } else if (y < -50) {
      note = 'Extreme cut >50% — check for one-off transfer or reclassification';
    }

    return { ...r, yoyVsBE, absoluteDeltaRE, absoluteDeltaActual, shareOfBudget, rank, priorityScore: raw, category, note };
  });

  const rankableScores = withRaw.filter(m => !EXCLUDED_FROM_RANKING.has(m.ministry)).map(m => m.priorityScore);
  const maxRaw = Math.max(...rankableScores, 60);
  const minRaw = Math.min(...rankableScores, 20);
  const range = Math.max(20, maxRaw - minRaw);

  return withRaw.map(m => {
    let normalised: number;
    if (EXCLUDED_FROM_RANKING.has(m.ministry)) {
      normalised = Math.round(Math.max(0, Math.min(40, ((m.priorityScore - minRaw) / range) * 30)));
    } else {
      normalised = Math.round(15 + ((m.priorityScore - minRaw) / range) * 80);
      normalised = Math.max(15, Math.min(95, normalised));
    }
    return { ...m, priorityScore: normalised };
  });
}

function parseGrandTotal(rawText: string): GrandTotal {
  // zzz259 — There are MULTIPLE "Grand Total" rows in the Budget-at-a-Glance PDF:
  //   1) Fiscal Deficit row: "Grand Total 1574431 1568936 1558492 1695768" (~₹15 L Cr)
  //   2) True Grand Total: "Grand Total 4652867 5065345 4964842 5347315" (~₹53 L Cr)
  // Pick the row whose BE-new value is LARGEST — that's the true total.
  const cleaned = rawText.replace(/[\r\t\n]/g, ' ').replace(/\s+/g, ' ');
  const all = [...cleaned.matchAll(/Grand\s+Total\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})/gi)];
  if (!all.length) return { actualsPrev: null, bePrev: null, rePrev: null, beNew: null };
  let best = all[0];
  let bestVal = parseNumber(all[0][4]) ?? 0;
  for (const m of all) {
    const v = parseNumber(m[4]) ?? 0;
    if (v > bestVal) { best = m; bestVal = v; }
  }
  return { actualsPrev: parseNumber(best[1]), bePrev: parseNumber(best[2]), rePrev: parseNumber(best[3]), beNew: parseNumber(best[4]) };
}

function detectBEYear(rawText: string): { yearNew: string; yearPrev: string; yearActuals: string } {
  const text = rawText.replace(/[\r\t]/g, ' ');
  // zzz257 — Only match exact 2- or 4-digit suffixes. pdf.js sometimes splits
  // "2026" as "202" + "6", which formerly matched \d{2,4} and produced garbage
  // like "2025-2" after slice(2). Reject 3-digit suffixes explicitly.
  const buildYear = (four: string, suffix: string): { yearNew: string; yStart: number } | null => {
    if (suffix.length === 2) {
      const yStart = parseInt(four);
      if (!Number.isFinite(yStart) || yStart < 1990 || yStart > 2100) return null;
      // Sanity: suffix should be yStart+1 mod 100
      const expected = String((yStart + 1) % 100).padStart(2, '0');
      if (suffix !== expected) return null;
      return { yearNew: `${four}-${suffix}`, yStart };
    } else if (suffix.length === 4) {
      const yStart = parseInt(four);
      const yEnd = parseInt(suffix);
      if (!Number.isFinite(yStart) || yStart < 1990 || yStart > 2100) return null;
      if (yEnd !== yStart + 1) return null;
      return { yearNew: `${four}-${suffix.slice(2)}`, yStart };
    }
    return null;
  };
  const yrRe = /Budget\s+Estimates?\s+(\d{4})\s*[-–]\s*(\d{2}|\d{4})(?!\d)/gi;
  const beMatches = [...text.matchAll(yrRe)];
  for (let i = beMatches.length - 1; i >= 0; i--) {
    const b = buildYear(beMatches[i][1], beMatches[i][2]);
    if (b) return { yearNew: b.yearNew, yearPrev: `${b.yStart - 1}-${String(b.yStart).slice(2)}`, yearActuals: `${b.yStart - 2}-${String(b.yStart - 1).slice(2)}` };
  }
  // Fallback: doc title
  const titleMatches = [
    ...text.matchAll(/BUDGET AT A GLANCE\s+(\d{4})\s*[-–]\s*(\d{2}|\d{4})(?!\d)/gi),
    ...text.matchAll(/Budget\s+(\d{4})\s*[-–]\s*(\d{2}|\d{4})(?!\d)/gi),
  ];
  for (const m of titleMatches) {
    const b = buildYear(m[1], m[2]);
    if (b) return { yearNew: b.yearNew, yearPrev: `${b.yStart - 1}-${String(b.yStart).slice(2)}`, yearActuals: `${b.yStart - 2}-${String(b.yStart - 1).slice(2)}` };
  }
  return { yearNew: '', yearPrev: '', yearActuals: '' };
}

function parseFiscalHeadline(rawText: string): FiscalHeadline {
  const text = rawText.replace(/\s+/g, ' ');
  const { yearNew, yearPrev, yearActuals } = detectBEYear(rawText);
  const grabLast = (re: RegExp): number | null => {
    const all = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    if (!all.length) return null;
    return parseNumber(all[all.length - 1][1]);
  };
  const grabFirst = (re: RegExp): number | null => { const mm = text.match(re); return mm ? parseNumber(mm[1]) : null; };

  // zzz262 — Strict: require "Total Expenditure" (not "Other Expenditure").
  // Then sanity-check against Grand Total row from ministry table.
  let totalExpBE: number | null = null;
  const strictMatches = [...text.matchAll(/(?<!Other\s)(?<!Revenue\s)(?<!Capital\s)Total\s+Expenditure[^0-9]{0,120}?([\d,]{6,20}?)(?:\s*crore|\s+[\d,]+|\s*$)/gi)];
  if (strictMatches.length > 0) {
    // Take LAST match (usually BE-new column of the table row)
    for (let i = strictMatches.length - 1; i >= 0 && totalExpBE == null; i--) {
      const v = parseNumber(strictMatches[i][1]);
      if (v != null && v >= 500_000 && v < 10_000_000) totalExpBE = v;
    }
  }
  // Fallback: look for the Total Expenditure row with 4 numbers
  if (totalExpBE == null) {
    const tableRow = text.match(/Total\s+Expenditure[^\d]*?([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})/i);
    if (tableRow) totalExpBE = parseNumber(tableRow[4]);   // BE-new = 4th column
  }
  // Reject GDP-like huge values
  if (totalExpBE != null && totalExpBE > 10_000_000) totalExpBE = null;

  let totalCapExBE = grabFirst(/total\s+capital\s+expenditure.{0,200}?₹\s*([\d,\s]{6,20}?)\s*crore/i);
  if (totalCapExBE == null) {
    const cap = text.match(/On\s+Capital\s+Account\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
    if (cap) totalCapExBE = parseNumber(cap[4]);
  }
  if (totalCapExBE == null) totalCapExBE = grabFirst(/capital\s+expenditure.{0,60}?₹\s*([\d,\s]{6,20}?)\s*crore/i);

  const effectiveCapExBE = grabFirst(/effective\s+capital\s+expenditure.{0,200}?₹\s*([\d,\s]{6,20}?)\s*crore/i);
  const interestPayments = grabFirst(/Interest\s+Payments?\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i);
  const gdpEstimate = grabFirst(/(?:GDP|Gross\s+Domestic\s+Product).{0,60}?₹\s*([\d,\s]{7,20}?)\s*(?:crore|Cr)/i)
    ?? grabFirst(/nominal\s+GDP.{0,60}?([\d,]{7,})/i);
  const grossTaxRevenue = grabFirst(/Gross\s+Tax\s+Revenue.{0,60}?₹?\s*([\d,\s]{6,20}?)\s*(?:crore|Cr)/i)
    ?? grabFirst(/Gross\s+Tax\s+Revenue\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i);

  return { totalExpBE, totalCapExBE, effectiveCapExBE, interestPayments, gdpEstimate, grossTaxRevenue, yearNew, yearPrev, yearActuals };
}

function parseReceiptsBreakdown(rawText: string): ReceiptsBreakdown {
  const text = rawText.replace(/\s+/g, ' ');
  const grab4 = (re: RegExp): [number|null, number|null] => {
    const m = text.match(re); if (!m) return [null, null];
    return [parseNumber(m[1]), parseNumber(m[4])];
  };
  const [revAct, revBE] = grab4(/Revenue\s+Receipts\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  // zzz259 — negative lookbehind rejects matches on "Non Tax Revenue".
  // Also broader gap tolerance for pdf.js's mixed Hindi+English output.
  const [taxAct, taxBE] = grab4(/(?<!Non[- ])(?<!Non\s)Tax\s+Revenue[^0-9]{0,120}([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [ntAct, ntBE] = grab4(/Non\s+Tax\s+Revenue\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [capAct, capBE] = grab4(/Capital\s+Receipts\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [loanAct, loanBE] = grab4(/Recovery\s+of\s+Loans\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
  const [othAct, othBE] = grab4(/Other\s+Receipts\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
  const [borrAct, borrBE] = grab4(/Borrowings\s+and\s+Other[^0-9]{0,60}([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  return {
    revenueReceipts: revBE, taxRevenue: taxBE, nonTaxRevenue: ntBE, capitalReceipts: capBE, loanRecovery: loanBE, otherReceipts: othBE, borrowings: borrBE,
    yoyBEvsActual: {
      revenueReceipts: pct(revBE, revAct), taxRevenue: pct(taxBE, taxAct),
      nonTaxRevenue: pct(ntBE, ntAct), capitalReceipts: pct(capBE, capAct),
      loanRecovery: pct(loanBE, loanAct), otherReceipts: pct(othBE, othAct),
      borrowings: pct(borrBE, borrAct),
    },
  };
}

function parseDeficitBlock(rawText: string, gdpEstimate: number | null): DeficitBlock {
  const text = rawText.replace(/\s+/g, ' ');
  const grab = (re: RegExp): number | null => { const m = text.match(re); return m ? parseNumber(m[1]) : null; };
  const fiscalDeficit = grab(/Fiscal\s+Deficit\s+[\d,]{6,}\s+[\d,]{6,}\s+[\d,]{6,}\s+([\d,]{6,})/i);
  const revenueDeficit = grab(/Revenue\s+Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i);
  const effectiveRevenueDeficit = grab(/Effective\s+Revenue\s+Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i);
  const primaryDeficit = grab(/Primary\s+Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i);
  const grabPct = (re: RegExp): number | null => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  const fiscalDeficitPctGDP = grabPct(/Fiscal\s+Deficit.{0,60}?(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?GDP/i)
    ?? (fiscalDeficit && gdpEstimate ? Math.round((fiscalDeficit / gdpEstimate) * 1000) / 10 : null);
  const revenueDeficitPctGDP = grabPct(/Revenue\s+Deficit.{0,60}?(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?GDP/i)
    ?? (revenueDeficit && gdpEstimate ? Math.round((revenueDeficit / gdpEstimate) * 1000) / 10 : null);
  return { fiscalDeficit, revenueDeficit, effectiveRevenueDeficit, primaryDeficit, fiscalDeficitPctGDP, revenueDeficitPctGDP, gdpEstimate };
}

function parseRupeeSlices(rawText: string, direction: 'from' | 'to'): CompositionSlice[] {
  // zzz258 — Canonical key mapping. Each entry: { patterns:[regex], canonical:'name' }
  // First pattern that matches for a canonical key wins; other patterns for the
  // same canonical key are skipped. This prevents "Interest Payments" +
  // "Interest Payment" from both appearing.
  const FROM_GROUPS: { canonical: string; patterns: RegExp[] }[] = [
    { canonical: 'Borrowings', patterns: [/Borrowings\s+and\s+Other\s+Liabilities/i, /\bBorrowings\b/i] },
    { canonical: 'GST', patterns: [/GST\s+and\s+Other\s+Taxes/i, /\bGST\b/i] },
    { canonical: 'Income Tax', patterns: [/\bIncome\s+Tax\b/i] },
    { canonical: 'Corporation Tax', patterns: [/\bCorporation\s+Tax\b/i] },
    { canonical: 'Union Excise Duties', patterns: [/Union\s+Excise\s+Duties/i, /\bExcise\s+Dut/i] },
    { canonical: 'Customs', patterns: [/\bCustoms\b/i] },
    { canonical: 'Non-Tax Revenue', patterns: [/Non[- ]?Tax\s+Revenue/i] },
    { canonical: 'Non-Debt Capital Receipts', patterns: [/Non[- ]?Debt\s+Capital\s+Receipts/i] },
  ];
  const TO_GROUPS: { canonical: string; patterns: RegExp[] }[] = [
    { canonical: 'States Share of Taxes', patterns: [/States\s+Share\s+of\s+Taxes(?:\s+and\s+Duties)?/i] },
    { canonical: 'Finance Commission Transfers', patterns: [/Finance\s+Commission\s+and\s+Other\s+Transfers/i, /Finance\s+Commission/i] },
    { canonical: 'Centrally Sponsored Schemes', patterns: [/Centrally\s+Sponsored\s+Schemes?/i] },
    { canonical: 'Central Sector Schemes', patterns: [/Central\s+Sector\s+Schemes?/i] },
    { canonical: 'Interest Payments', patterns: [/Interest\s+Payments?/i] },
    { canonical: 'Defence', patterns: [/\bDefence\b/i] },
    { canonical: 'Major Subsidies', patterns: [/Major\s+Subsidies/i, /\bSubsidies\b/i] },
    { canonical: 'Pensions', patterns: [/\bPensions?\b/i, /Civil\s+Pension/i] },
    { canonical: 'Other Expenditure', patterns: [/Other\s+Expenditures?/i] },
  ];
  const groups = direction === 'from' ? FROM_GROUPS : TO_GROUPS;
  const text = rawText.replace(/\s+/g, ' ');
  const out: CompositionSlice[] = [];
  for (const g of groups) {
    let matched = false;
    for (const p of g.patterns) {
      if (matched) break;
      const src = p.source;
      const flags = p.flags.includes('i') ? p.flags : p.flags + 'i';
      // zzz262 — REQUIRE p/paise/% suffix to avoid picking up raw table numbers
      // like "Non Tax Revenue 536580" → wrong 53.
      const re = new RegExp(src + '\\s*[^\\d]{0,25}?(\\d{1,2})\\s*(?:\\.\\s*)?(?:p\\.?|paise|%)(?!\\d)', flags);
      const m = text.match(re);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v > 0 && v < 60) {
          out.push({ label: g.canonical, pct: v });
          matched = true;
        }
      }
    }
  }
  return out;
}
function parseRupeeComesFrom(rawText: string): CompositionSlice[] { return parseRupeeSlices(rawText, 'from'); }
function parseRupeeGoesTo(rawText: string): CompositionSlice[] { return parseRupeeSlices(rawText, 'to'); }

// zzz258 — Scheme aliases: canonical name → array of aliases (searched in text).
// When any alias matches, we grab the 4 nearest numbers as the scheme row.
// This surfaces JJM, PMAY-Grameen, SBM-Grameen, PMKSN, PMJAY etc. that were
// otherwise missed because pdf.js emits mixed Hindi/English text.
const SCHEME_ALIASES: { canonical: string; aliases: RegExp[] }[] = [
  { canonical: 'Jal Jeevan Mission (JJM)', aliases: [/Jal\s+Jeevan\s+Mission/i, /\bJJM\b/i, /National\s+Rural\s+Drinking\s+Water\s+Mission/i] },
  { canonical: 'PMAY-Grameen', aliases: [/PMAY[- ]?Grameen/i, /Pradhan\s+Mantri\s+Awas.{0,20}Grameen/i, /Awas\s+Yojana.{0,10}Grameen/i] },
  { canonical: 'SBM-Grameen', aliases: [/SBM[- ]?Grameen/i, /Swachh\s+Bharat.{0,20}Grameen/i] },
  { canonical: 'PM-Kisan', aliases: [/PM-?KISAN/i, /Pradhan\s+Mantri\s+Kisan\s+Samman/i] },
  { canonical: 'PMJAY / Ayushman Bharat', aliases: [/PMJAY/i, /Ayushman\s+Bharat.{0,40}(PMJAY|Yojana|Health)/i] },
  { canonical: 'PMMSY (Fisheries)', aliases: [/PMMSY/i, /Pradhan\s+Mantri\s+Matsya/i] },
  { canonical: 'Semiconductor Mission', aliases: [/Semiconductor\s+Mission/i, /\bISM\b\s*(?:Mission|Programme)?/i] },
];

function parseTopSchemes(rawText: string): SchemeRow[] {
  const rows: SchemeRow[] = [];
  const text = rawText.replace(/[\r\t]/g, ' ');

  // Build a set of ministry names to filter out (they match the same 4-number
  // pattern as schemes with a footnote digit and get misidentified).
  const MINISTRY_KEYWORDS = new Set([
    'rural development', 'urban development', 'transport', 'defence', 'health',
    'agriculture', 'education', 'energy', 'commerce', 'finance', 'interest',
    'external affairs', 'home affairs', 'pension', 'social welfare', 'scientific',
    'tax administration', 'it and telecom', 'others', 'petroleum', 'fertiliser',
    'food', 'planning and statistics', 'development of north east',
    'agriculture and allied activities',
  ]);
  const isMinistryLike = (name: string): boolean => {
    const stripped = name.toLowerCase().replace(/\s*\d+\s*$/, '').trim();
    for (const k of MINISTRY_KEYWORDS) if (stripped === k || stripped === k.replace(/\s+/g, ' ')) return true;
    return false;
  };

  // Pass 1 — canonical alias scan. For each alias, find its position and grab
  // the 4 nearest numeric tokens that look like scheme columns (2-6 digits with
  // commas allowed).
  for (const s of SCHEME_ALIASES) {
    let found = false;
    for (const a of s.aliases) {
      if (found) break;
      const m = text.match(a);
      if (!m || m.index == null) continue;
      // Look for 4 numbers within 400 chars after the alias match
      const after = text.slice(m.index, m.index + 800);
      const numRe = /([\d,]{2,10})/g;
      const nums: string[] = [];
      let nm: RegExpExecArray | null;
      while ((nm = numRe.exec(after)) !== null && nums.length < 6) {
        const clean = nm[1].replace(/,/g, '');
        // Filter out year-like digits and single-digit noise
        if (clean.length >= 3 && parseInt(clean) > 100) nums.push(nm[1]);
      }
      if (nums.length >= 4) {
        // zzz259 — Take FIRST 4 numbers after the alias match. Scheme row format
        // is `<seq> <name-hindi+english> <actuals> <bePrev> <rePrev> <beNew>`,
        // and the 4 numbers immediately after the English name are the correct row.
        const cols = nums.slice(0, 4);
        const rePrev = parseNumber(cols[2]);
        const beNew = parseNumber(cols[3]);
        if (beNew != null && beNew >= 500 && beNew < 1_000_000) {
          rows.push({ name: s.canonical, beNew, rePrev, delta: pct(beNew, rePrev) });
          found = true;
        }
      }
    }
  }

  // Pass 2 — general sequential-number pattern for other schemes.
  const re = /(?:^|[\s\n])(\d{1,3})\s+([A-Za-z][A-Za-z0-9 ()\-&/,\.'"–—]{5,90}?)\s+([\d,]{2,})\s+([\d,]{2,})\s+([\d,]{2,})\s+([\d,]{2,})(?=\s|$|\n)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let name = m[2].replace(/\s+/g, ' ').trim();
    // Strip trailing footnote digit (e.g. "Rural Development4" → "Rural Development")
    name = name.replace(/\s*\d+\s*$/, '').trim();
    if (/Grand Total|^Total\b|Ministry of|Department of/i.test(name)) continue;
    if (name.length < 6) continue;
    if ((name.match(/\d/g) || []).length > name.length * 0.4) continue;
    if (isMinistryLike(name)) continue;                    // Skip ministry rows
    if (isMinistryLike(m[2].trim())) continue;
    const rePrev = parseNumber(m[5]);
    const beNew = parseNumber(m[6]);
    if (beNew == null || beNew < 100) continue;            // zzz262 — floor 100 Cr (catches more small schemes)
    if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) continue;
    rows.push({ name, beNew, rePrev, delta: pct(beNew, rePrev) });
  }
  // Pass 3 (zzz262) — Devanagari-tolerant scheme scan for entries where the
  // English name comes AFTER Hindi text like: "जल जीवि पामिं ... 27 Jal Jeevan Mission ... 22612 67000 17000 67670"
  // Match: sequence-number + English-name-starting-with-uppercase + 4 numbers
  const strippedText = text.replace(/[ऀ-ॿ]/g, ' ').replace(/\s+/g, ' ');
  const re3 = /(\d{1,3})\s+([A-Z][A-Za-z0-9 ()\-&/,\.'"–—]{6,90}?)\s+([\d,]{2,})\s+([\d,]{2,})\s+([\d,]{2,})\s+([\d,]{2,})(?=\s|$)/g;
  let m3: RegExpExecArray | null;
  while ((m3 = re3.exec(strippedText)) !== null) {
    let name = m3[2].replace(/\s+/g, ' ').trim();
    name = name.replace(/\s*\d+\s*$/, '').trim();
    if (/Grand Total|^Total\b/i.test(name)) continue;
    if (name.length < 8) continue;
    if (isMinistryLike(name)) continue;
    const rePrev = parseNumber(m3[5]);
    const beNew = parseNumber(m3[6]);
    if (beNew == null || beNew < 100) continue;
    if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) continue;
    rows.push({ name, beNew, rePrev, delta: pct(beNew, rePrev) });
  }
  rows.sort((a, b) => b.beNew - a.beNew);
  return rows.slice(0, 200);   // zzz262 — cap at 200 (was 70)
}

const THEME_PATTERNS: { theme: string; icon: string; patterns: RegExp[]; schemeKeywords: RegExp; stockCue: string[] }[] = [
  { theme: 'Infrastructure — Roads & Highways', icon: '🛣', patterns: [/highway/i, /NHAI/i, /\bBharatmala/i, /\bPMGSY/i, /\broad\s+network/i, /expressway/i], schemeKeywords: /highway|road|Bharatmala|PMGSY|NHAI/i, stockCue: ['LT', 'IRB', 'KNRCON', 'GRINFRA', 'PNCINFRA'] },
  { theme: 'Infrastructure — Railways', icon: '🚂', patterns: [/railway/i, /Vande\s+Bharat/i, /Kavach/i, /dedicated\s+freight/i, /metro\s+rail/i], schemeKeywords: /railway|Vande\s+Bharat|metro|DFC/i, stockCue: ['RVNL', 'IRCON', 'TITAGARH', 'BEML', 'RAILTEL'] },
  { theme: 'Infrastructure — Ports & Shipping', icon: '⚓', patterns: [/Sagarmala/i, /\bports?\b/i, /shipbuilding/i, /maritime/i], schemeKeywords: /Sagarmala|port|shipping/i, stockCue: ['ADANIPORTS', 'JSWINFRA', 'CDSL'] },
  { theme: 'PLI / Manufacturing', icon: '🏭', patterns: [/\bPLI\b/, /production.linked/i, /electronics\s+manufacturing/i, /\bEMS\b/], schemeKeywords: /PLI|Production Linked|electronics/i, stockCue: ['DIXON', 'AMBER', 'KAYNES', 'SYRMA', 'CYIENTDLM'] },
  { theme: 'Semiconductor Mission', icon: '🔬', patterns: [/semiconductor/i, /\bchip\b.*(?:manufactur|fab)/i, /\bISM\b/, /DLI\s+scheme/i, /\bOSAT\b/i], schemeKeywords: /Semiconductor|chip|ISM|OSAT/i, stockCue: ['KAYNES', 'CYIENTDLM', 'CDSL', 'SYRMA', 'CENTUM'] },
  { theme: 'EV / E-Mobility', icon: '🔋', patterns: [/electric\s+vehicle/i, /\bEV\b/, /PM\s*E-?Drive/i, /\bFAME\b/i, /e-?bus/i, /battery\s+swap/i, /charging\s+infra/i], schemeKeywords: /electric|EV|PM E-Drive|FAME|e-bus/i, stockCue: ['TATAMOTORS', 'M&M', 'OLECTRA', 'JBM', 'EXIDEIND', 'AMARAJABAT'] },
  { theme: 'Renewables — Solar & Wind', icon: '☀', patterns: [/\bsolar\b/i, /renewable\s+energy/i, /PM\s+Surya\s+Ghar/i, /rooftop\s+solar/i, /\bwind\s+power\b/i, /Non-Fossil/i], schemeKeywords: /Solar|Surya|renewable|wind/i, stockCue: ['WAAREEENER', 'ADANIGREEN', 'SUZLON', 'INOXWIND', 'BOROSIL'] },
  { theme: 'Green Hydrogen', icon: '💨', patterns: [/green\s+hydrogen/i, /National\s+Green\s+Hydrogen/i, /electroly[sz]er/i], schemeKeywords: /Green Hydrogen|Hydrogen/i, stockCue: ['RELIANCE', 'ADANIGREEN', 'LT', 'NTPC'] },
  { theme: 'Nuclear', icon: '☢', patterns: [/nuclear\s+(?:energy|power|mission)/i, /Small\s+Modular/i, /\bSMR\b/], schemeKeywords: /nuclear|SMR/i, stockCue: ['NTPC', 'LT', 'HAL'] },
  { theme: 'Rural + Agri thrust', icon: '🌾', patterns: [/PM-?KISAN/i, /MGNREGA/i, /Kisan\s+Samman/i, /farmer\s+(?:income|welfare)/i, /agri.\bcredit/i], schemeKeywords: /Kisan|MGNREGA|farmer|agriculture/i, stockCue: ['UPL', 'PIIND', 'BAYERCROP', 'ESCORTS', 'M&M'] },
  { theme: 'Water Infrastructure', icon: '💧', patterns: [/Jal\s+Jeevan/i, /piped\s+water/i, /Nal[- ]?se[- ]?Jal/i, /irrigation/i, /water\s+supply/i, /Namami\s+Gange/i, /\bJJM\b/i], schemeKeywords: /Jal\s*Jeevan|JJM|water|irrigation|Namami|Sinchai|Ganga\s+Plan/i, stockCue: ['JASH', 'VATECHWABAG', 'KIRLOSKAR', 'FINOLEX'] },
  { theme: 'Housing — PMAY', icon: '🏠', patterns: [/PMAY/i, /Pradhan\s+Mantri\s+Awas/i, /affordable\s+housing/i, /housing\s+for\s+all/i], schemeKeywords: /PMAY|Awas|housing|Grameen/i, stockCue: ['ULTRACEMCO', 'DALBHARAT', 'PIDILITIND', 'CENTURYPLY', 'CANFINHOME'] },
  { theme: 'Healthcare Access — PMJAY / Ayushman', icon: '🏥', patterns: [/Ayushman\s+Bharat/i, /PMJAY/i, /Jan\s+Aushadhi/i, /health\s+insurance/i, /Ayushman/i], schemeKeywords: /Ayushman|PMJAY|Jan\s+Aushadhi|health\s+mission|Post\s+Matric/i, stockCue: ['APOLLOHOSP', 'MAXHEALTH', 'STARHEALTH', 'MEDPLUS'] },
  { theme: 'Skilling & Employment', icon: '👷', patterns: [/skilling/i, /Skill\s+India/i, /Employ(?:ment|ability)/i, /PMKVY/i, /apprenticeship/i, /internship\s+scheme/i, /Skill\s+India\s+Programme/i], schemeKeywords: /Skill|PMKVY|apprentice|internship|PM Internship/i, stockCue: ['TEAMLEASE', 'QUESSCORP', 'SISLTD'] },
  { theme: 'Startups / MSME', icon: '🚀', patterns: [/startup/i, /\bMSME\b/, /credit\s+guarantee/i, /Mudra/i, /Fund\s+of\s+Funds/i, /SIDBI/i, /Vishwakarma/i], schemeKeywords: /startup|MSME|Mudra|SIDBI|Vishwakarma/i, stockCue: ['SBIN', 'CANBK', 'BAJFINANCE', 'CHOLAFIN'] },
  { theme: 'Defence Indigenisation', icon: '🛡', patterns: [/Aatmanirbhar.*defen[cs]e/i, /indigeni[sz]ation/i, /defen[cs]e\s+capex/i, /defen[cs]e\s+procurement/i, /Positive\s+Indigenisation/i], schemeKeywords: /Defence|Aatmanirbhar/i, stockCue: ['HAL', 'BEL', 'MAZDOCK', 'BDL', 'DATAPATTNS'] },
  { theme: 'Space & R&D', icon: '🛰', patterns: [/\bISRO\b/, /space\s+(?:economy|sector|reforms)/i, /IN-?SPACe/i, /Space\s+(?:India|Fund)/i], schemeKeywords: /ISRO|space|SPACe/i, stockCue: ['MTAR', 'PARAS', 'CENTUM', 'ROLTA'] },
  { theme: 'Digital Public Infra / DPI', icon: '💻', patterns: [/\bDPI\b/, /\bUPI\b/, /\bONDC\b/, /Digital\s+India/i, /BharatNet/i, /Digital\s+Public/i], schemeKeywords: /DPI|UPI|ONDC|Digital India|BharatNet/i, stockCue: ['STLTECH', 'HFCL', 'ROUTE', 'TATATECH'] },
  { theme: 'Fisheries — PMMSY', icon: '🐟', patterns: [/PMMSY/i, /fisher(?:ies|men)/i, /Sagar\s+Mekhala/i, /Blue\s+Economy/i], schemeKeywords: /PMMSY|fisher|Blue/i, stockCue: ['AVANTI', 'APEXFROZN'] },
  { theme: 'Textiles — PLI Textiles', icon: '🧵', patterns: [/textiles?\b/i, /PM\s+MITRA/i, /\bMITRA\s+Park/i, /Kasturi\s+Cotton/i], schemeKeywords: /textile|MITRA|cotton/i, stockCue: ['PAGEIND', 'KPRMILL', 'TRIDENT', 'WELSPUNIND'] },
  { theme: 'Tourism', icon: '🗺', patterns: [/Swadesh\s+Darshan/i, /PRASHAD/i, /tourism\s+(?:corridor|circuit)/i, /Vibrant\s+Villages/i], schemeKeywords: /Swadesh|PRASHAD|tourism|Vibrant Villages/i, stockCue: ['INDHOTEL', 'CHALET', 'MAHINDCIE'] },
  { theme: 'Fiscal Consolidation', icon: '📉', patterns: [/fiscal\s+consolid/i, /fiscal\s+glide/i, /debt.to.GDP/i, /fiscal\s+prudence/i, /FRBM/i], schemeKeywords: /fiscal|consolidation|FRBM/i, stockCue: [] },
];

function stripDevanagari(s: string): string {
  // zzz259 — strip Hindi Devanagari chars (ऀ-ॿ) and stray non-ASCII
  // punctuation for readable English-only theme evidence.
  return s.replace(/[ऀ-ॿ]/g, '').replace(/\s{2,}/g, ' ').trim();
}
function isReadableSnippet(s: string): boolean {
  if (!s || s.length < 30) return false;
  const clean = stripDevanagari(s);
  if (clean.length < 30) return false;
  const digits = (clean.match(/\d/g) || []).length;
  return digits / clean.length < 0.35;
}

function extractThemes(text: string, schemes: SchemeRow[]): Theme[] {
  const out: Theme[] = [];
  for (const t of THEME_PATTERNS) {
    let hits = 0; let snippet = '';
    for (const p of t.patterns) {
      const matches = text.match(new RegExp(p.source, p.flags + 'g'));
      if (matches) {
        hits += matches.length;
        if (!snippet) {
          const gpat = new RegExp(p.source, p.flags + 'g');
          let cand: RegExpExecArray | null;
          while ((cand = gpat.exec(text)) !== null) {
            const start = Math.max(0, cand.index - 80);
            const end = Math.min(text.length, cand.index + 200);
            const sample = stripDevanagari(text.slice(start, end)).replace(/\s+/g, ' ').trim();
            if (isReadableSnippet(sample)) { snippet = sample; break; }
          }
        }
      }
    }
    if (hits > 0) {
      const matchingSchemes = schemes.filter(s => t.schemeKeywords.test(s.name)).slice(0, 8).map(s => s.name);
      out.push({ theme: t.theme, icon: t.icon, hits, snippet, schemes: matchingSchemes, stockCue: t.stockCue });
    }
  }
  return out.sort((a, b) => b.hits - a.hits);
}

type FQPart = { label: string; value: number; pctDisplay: string; note?: string };
function fiscalQualityScore(h: FiscalHeadline, gt: GrandTotal, d: DeficitBlock): { score: number; parts: FQPart[]; benchmark: string } {
  const totalExp = h.totalExpBE ?? gt.beNew ?? 0;
  const parts: FQPart[] = [];
  let score = 30;

  if (h.totalCapExBE != null && totalExp > 0) {
    const capexShare = h.totalCapExBE / totalExp;
    const capexPts = Math.min(30, Math.round(capexShare * 120));
    score += capexPts;
    parts.push({ label: 'CapEx share', value: capexPts, pctDisplay: `${(capexShare * 100).toFixed(1)}% of total exp` });
  }
  if (h.interestPayments != null && totalExp > 0) {
    const interestShare = h.interestPayments / totalExp;
    let interestPts: number;
    if (interestShare > 0.28) interestPts = -20;
    else if (interestShare > 0.25) interestPts = -10;
    else if (interestShare > 0.22) interestPts = 0;
    else if (interestShare > 0.18) interestPts = 10;
    else interestPts = 20;
    score += interestPts;
    parts.push({ label: 'Interest burden', value: interestPts, pctDisplay: `${(interestShare * 100).toFixed(1)}% of total exp`,
      note: interestShare > 0.25 ? 'Interest > 25% — heavy debt-service constraint' : undefined });
  }
  if (d.fiscalDeficitPctGDP != null) {
    let fdPts: number;
    if (d.fiscalDeficitPctGDP <= 3) fdPts = 30;
    else if (d.fiscalDeficitPctGDP <= 4) fdPts = 20;
    else if (d.fiscalDeficitPctGDP <= 5) fdPts = 10;
    else if (d.fiscalDeficitPctGDP <= 6) fdPts = 0;
    else fdPts = -10;
    score += fdPts;
    parts.push({ label: 'Fiscal deficit / GDP', value: fdPts, pctDisplay: `${d.fiscalDeficitPctGDP.toFixed(1)}% of GDP`,
      note: d.fiscalDeficitPctGDP > 4.5 ? 'Above FRBM medium-term target of 4.5%' : d.fiscalDeficitPctGDP <= 3 ? 'Meets FRBM statutory 3% target' : undefined });
  }

  score = Math.max(0, Math.min(100, score));
  const benchmark = score >= 70 ? 'Strong — CapEx-heavy + low debt burden' :
                    score >= 55 ? 'Balanced — sustainable but capex-constrained' :
                    score >= 40 ? 'Watch — interest burden or deficit above comfort' :
                                  'Weak — heavy debt service + wide deficit';
  return { score, parts, benchmark };
}

function buildAISummary(y: BudgetYearData): string {
  if (!y.ministries.length) return '';
  // zzz262 — prefer larger of grand-total vs headline
  const totalBudget = Math.max(y.headline.totalExpBE ?? 0, y.grandTotal.beNew ?? 0);
  const growthVsRE = pct(y.grandTotal.beNew, y.grandTotal.rePrev);
  const growthVsActual = pct(y.grandTotal.beNew, y.grandTotal.actualsPrev);
  const rankable = y.ministries.filter(m => !EXCLUDED_FROM_RANKING.has(m.ministry));
  const winners = rankable.filter(m => m.category === 'winner')
    .sort((a, b) => (b.absoluteDeltaRE || 0) - (a.absoluteDeltaRE || 0)).slice(0, 3);
  const losers = rankable.filter(m => m.category === 'loser')
    .sort((a, b) => (a.absoluteDeltaRE || 0) - (b.absoluteDeltaRE || 0)).slice(0, 3);
  const capexShare = y.headline.totalCapExBE && totalBudget > 0 ? (y.headline.totalCapExBE / totalBudget) * 100 : null;
  const interestShare = y.headline.interestPayments && totalBudget > 0 ? (y.headline.interestPayments / totalBudget) * 100 : null;
  const topThemes = y.themes.slice(0, 4).map(t => t.theme).join(', ');

  const parts: string[] = [];
  parts.push(`**Budget FY ${y.fiscalYear}** allocates **${fmtCr(totalBudget)}** across ${rankable.length} major ministries` +
    (growthVsRE != null ? `, ${growthVsRE >= 0 ? 'growing' : 'contracting'} **${Math.abs(growthVsRE).toFixed(1)}%** over prior FY Revised Estimates` : '') +
    (growthVsActual != null ? ` and **${growthVsActual >= 0 ? '+' : ''}${growthVsActual.toFixed(1)}%** over FY ${y.headline.yearActuals} Actuals` : '') + '.');
  if (capexShare != null) parts.push(`Capital expenditure at **${fmtCr(y.headline.totalCapExBE)}** is **${capexShare.toFixed(1)}%** of total spend, ${capexShare >= 22 ? 'a strong public-investment tilt' : capexShare >= 18 ? 'a continued capex thrust' : 'a more revenue-heavy posture'}.`);
  if (interestShare != null) parts.push(`Interest payments consume **${interestShare.toFixed(1)}%** of the budget, ${interestShare >= 25 ? 'heavily constraining discretionary spend' : interestShare >= 20 ? 'a structural burden but manageable' : 'leaving room for productive allocations'}.`);
  if (winners.length) parts.push(`**Largest allocation increases** go to ${winners.map(w => `**${w.ministry}** (${fmtDelta(w.absoluteDeltaRE)} / ${fmtPct(w.yoyVsRE)})`).join(', ')}.`);
  if (losers.length) parts.push(`**Notable cuts** hit ${losers.map(l => `**${l.ministry}** (${fmtDelta(l.absoluteDeltaRE)} / ${fmtPct(l.yoyVsRE)}${l.note ? ' — ' + l.note : ''})`).join(', ')}.`);
  if (topThemes) parts.push(`The narrative is dominated by ${topThemes}.`);
  const upSectors = winners.filter(w => SECTOR_MAP[w.ministry]).map(w => SECTOR_MAP[w.ministry].sector).slice(0, 3);
  if (upSectors.length) parts.push(`**Institutional read:** allocation lift favors ${upSectors.join(', ')}. Cross-check with valuation, order-book visibility, and management-quality filters before positioning.`);
  return parts.join(' ');
}

// ─── zzz260 CIO View analysis ─────────────────────────────────────────────
type MarketImpact = 'Very Bullish' | 'Bullish' | 'Moderate' | 'Neutral' | 'Bearish';
type Momentum = 'up' | 'up-strong' | 'flat' | 'down';

function computeStance(y: BudgetYearData, fq: { score: number } | null): {
  stance: string; drivers: string[]; color: string;
} {
  const capex = y.headline.totalCapExBE ?? 0;
  const totalExp = y.headline.totalExpBE ?? y.grandTotal.beNew ?? 1;
  const capexShare = (capex / totalExp) * 100;
  const fd = y.deficits.fiscalDeficitPctGDP ?? 0;
  const drivers: string[] = [];
  let score = 0;
  if (capexShare >= 20) { score += 2; drivers.push(`Capex ${capexShare.toFixed(1)}% of spend (>20% institutional threshold)`); }
  else if (capexShare >= 15) { score += 1; drivers.push(`Capex ${capexShare.toFixed(1)}% of spend (moderate)`); }
  else drivers.push(`Capex ${capexShare.toFixed(1)}% of spend (below institutional threshold)`);
  if (fd <= 3) { score += 2; drivers.push(`Fiscal deficit ${fd.toFixed(1)}% — meets FRBM 3% target`); }
  else if (fd <= 4.5) { score += 1; drivers.push(`Fiscal deficit ${fd.toFixed(1)}% — within FRBM 4.5% medium-term`); }
  else if (fd <= 5.5) drivers.push(`Fiscal deficit ${fd.toFixed(1)}% — above FRBM 4.5%`);
  else { score -= 1; drivers.push(`Fiscal deficit ${fd.toFixed(1)}% — elevated`); }
  // Consolidation vs prior year (from grand-total growth)
  const growth = pct(y.grandTotal.beNew, y.grandTotal.rePrev);
  if (growth != null) {
    if (growth >= 15) { score += 1; drivers.push(`Total spend growing ${growth.toFixed(1)}% YoY — expansionary`); }
    else if (growth >= 8) drivers.push(`Total spend growing ${growth.toFixed(1)}% YoY — steady`);
    else if (growth >= 0) drivers.push(`Total spend growing ${growth.toFixed(1)}% YoY — muted`);
    else { score -= 1; drivers.push(`Total spend contracting ${growth.toFixed(1)}% YoY`); }
  }
  let stance: string; let color: string;
  if (score >= 4) { stance = 'Strongly Pro-Growth'; color = '#065F46'; }
  else if (score >= 2) { stance = 'Moderately Pro-Growth'; color = '#10B981'; }
  else if (score >= 0) { stance = 'Neutral / Consolidation-focused'; color = '#F59E0B'; }
  else { stance = 'Contractionary'; color = '#EF4444'; }
  return { stance, drivers, color };
}

function computeMarketImpact(m: EnrichedMinistry): { impact: MarketImpact; confidence: number; color: string } {
  const y = m.yoyVsRE ?? 0;
  const share = m.shareOfBudget ?? 0;
  // Confidence: 1-10 based on magnitude × share weight
  let confidence = 5;
  if (Math.abs(y) >= 30) confidence += 3;
  else if (Math.abs(y) >= 15) confidence += 2;
  else if (Math.abs(y) >= 5) confidence += 1;
  if (share >= 5) confidence += 2;
  else if (share >= 2) confidence += 1;
  confidence = Math.max(1, Math.min(10, confidence));
  let impact: MarketImpact; let color: string;
  if (y >= 25 && share >= 2) { impact = 'Very Bullish'; color = '#065F46'; }
  else if (y >= 10) { impact = 'Bullish'; color = '#10B981'; }
  else if (y >= 3) { impact = 'Moderate'; color = '#84CC16'; }
  else if (y >= -3) { impact = 'Neutral'; color = '#94A3B8'; }
  else { impact = 'Bearish'; color = '#EF4444'; }
  return { impact, confidence, color };
}

function computeMomentum(currentM: EnrichedMinistry, history: { year: string; m: EnrichedMinistry }[]): Momentum {
  if (history.length < 2) {
    const y = currentM.yoyVsRE ?? 0;
    if (y >= 15) return 'up-strong'; if (y >= 3) return 'up'; if (y >= -3) return 'flat'; return 'down';
  }
  let upCount = 0;
  for (const h of history) if ((h.m.yoyVsRE ?? 0) > 3) upCount++;
  if (upCount >= 3) return 'up-strong';
  if (upCount >= 2) return 'up';
  const y = currentM.yoyVsRE ?? 0;
  if (y >= 3) return 'up'; if (y >= -3) return 'flat'; return 'down';
}

// Portfolio implications: derive ↑ / → / ↓ sector recommendations
function computePortfolioImplications(y: BudgetYearData): {
  bullish: { sector: string; ministry: string; delta: number }[];
  neutral: string[];
  bearish: { sector: string; ministry: string; delta: number }[];
} {
  const rankable = y.ministries.filter(m => !EXCLUDED_FROM_RANKING.has(m.ministry));
  const bullish: { sector: string; ministry: string; delta: number }[] = [];
  const bearish: { sector: string; ministry: string; delta: number }[] = [];
  const neutral: string[] = [];
  for (const m of rankable) {
    if (!SECTOR_MAP[m.ministry]) continue;
    const yo = m.yoyVsRE ?? 0;
    const sector = SECTOR_MAP[m.ministry].sector;
    if (yo >= 15) bullish.push({ sector, ministry: m.ministry, delta: yo });
    else if (yo <= -10) bearish.push({ sector, ministry: m.ministry, delta: yo });
    else if (yo >= -3 && yo <= 3) neutral.push(sector);
  }
  // Add subsidy items as bearish if cutting (subsidy-heavy companies suffer)
  for (const s of y.subsidies) {
    if (!SUBSIDY_STOCKS[s.ministry]) continue;
    const yo = s.yoyVsRE ?? 0;
    if (yo <= -5) bearish.push({ sector: SUBSIDY_STOCKS[s.ministry].name, ministry: s.ministry, delta: yo });
  }
  bullish.sort((a, b) => b.delta - a.delta);
  bearish.sort((a, b) => a.delta - b.delta);
  return { bullish: bullish.slice(0, 6), neutral: neutral.slice(0, 4), bearish: bearish.slice(0, 4) };
}

// Institutional risks — mix of quantitative + heuristic
function computeRisks(y: BudgetYearData): { risk: string; severity: 'high' | 'med' | 'low' }[] {
  const risks: { risk: string; severity: 'high' | 'med' | 'low' }[] = [];
  const fd = y.deficits.fiscalDeficitPctGDP ?? 0;
  const totalExp = y.headline.totalExpBE ?? y.grandTotal.beNew ?? 1;
  const interestShare = y.headline.interestPayments ? (y.headline.interestPayments / totalExp) * 100 : 0;
  if (fd > 4.5) risks.push({ risk: `Fiscal slippage risk — deficit ${fd.toFixed(1)}% of GDP is above FRBM medium-term 4.5%.`, severity: 'high' });
  else if (fd > 3.5) risks.push({ risk: `Fiscal discipline watch — deficit ${fd.toFixed(1)}% needs further consolidation to hit 3% FRBM target.`, severity: 'med' });
  if (interestShare > 25) risks.push({ risk: `Interest burden at ${interestShare.toFixed(1)}% of spend heavily constrains discretionary policy room.`, severity: 'high' });
  else if (interestShare > 20) risks.push({ risk: `Interest burden at ${interestShare.toFixed(1)}% is structural — lower debt-service ratios needed.`, severity: 'med' });
  // Disinvestment / Other Receipts optimism
  const otherRec = y.receipts.otherReceipts ?? 0;
  const otherRecActuals = y.receipts.yoyBEvsActual.otherReceipts ?? 0;
  if (otherRec > 100000 && otherRecActuals > 200) risks.push({ risk: `Disinvestment target growth ${otherRecActuals.toFixed(0)}% vs Actuals is aggressive — execution risk.`, severity: 'med' });
  // Rural / agri momentum
  const rural = y.ministries.find(m => m.ministry === 'Rural Development');
  if (rural && (rural.yoyVsRE ?? 0) < 0) risks.push({ risk: 'Rural allocation contracting — rural consumption plays face policy headwind.', severity: 'med' });
  // Standard institutional risks always shown
  risks.push({ risk: 'Global commodity / crude shock could widen deficit and pressure OMC subsidies.', severity: 'low' });
  risks.push({ risk: 'Elevated valuations in capex/defence/rail names limit upside despite favorable allocation.', severity: 'med' });
  risks.push({ risk: 'Execution delays at ministry level typically absorb 15-25% of announced capex.', severity: 'med' });
  risks.push({ risk: 'State-level capex slowdown could offset centre-led allocation growth.', severity: 'low' });
  return risks;
}

// ─── zzz261 institutional reference data (hardcoded — stable historical) ─
// GDP fiscal multipliers (per RBI/NIPFP research on public capex crowd-in)
const GDP_MULTIPLIERS: Record<string, { mult: number; source: string }> = {
  'Transport': { mult: 1.80, source: 'Roads / Rail / Ports — RBI 2020 fiscal multiplier study' },
  'Energy': { mult: 2.20, source: 'Power / Transmission — highest capex multiplier per NIPFP' },
  'Urban Development': { mult: 1.40, source: 'Urban infra / metro — moderate multiplier' },
  'Rural Development': { mult: 1.30, source: 'MGNREGA / rural roads — near-term consumption multiplier' },
  'Defence': { mult: 0.90, source: 'Defence capex — low domestic multiplier (import content)' },
  'Health': { mult: 1.10, source: 'Health infra — moderate long-run multiplier' },
  'Education': { mult: 1.20, source: 'Education — long-run human capital multiplier' },
  'Agriculture': { mult: 1.35, source: 'Agri credit / MSP — rural demand pass-through' },
  'IT and Telecom': { mult: 1.50, source: 'Digital public infra — productivity spillovers' },
  'Scientific Departments': { mult: 1.20, source: 'R&D / space — long-run innovation multiplier' },
};
// Global capex-to-GDP benchmarks (World Bank / IMF, latest available)
const GLOBAL_CAPEX_TO_GDP: { country: string; pct: number; note: string }[] = [
  { country: 'India (this budget)', pct: 0, note: 'From uploaded data' },   // filled at runtime
  { country: 'China',    pct: 4.5, note: 'Public infra + SOE capex' },
  { country: 'Indonesia',pct: 3.1, note: 'Rising infra push' },
  { country: 'USA',      pct: 2.0, note: 'IIJA / CHIPS impact' },
  { country: 'Japan',    pct: 3.6, note: 'Public works spend' },
  { country: 'Germany',  pct: 1.8, note: 'Restrained capex' },
];
// Sector valuation heuristics (PE historical vs current, indicative)
const VALUATION_OVERLAY: Record<string, { historicalPE: number; currentPE: number; note: string }> = {
  'Defence': { historicalPE: 22, currentPE: 55, note: 'PSU defence names re-rated post 2022 — historically 20-25x, now 45-60x. Expensive.' },
  'Transport': { historicalPE: 28, currentPE: 42, note: 'Rail EPC (RVNL/IRCON) re-rated — historically 25-30x, now 40-45x.' },
  'Energy': { historicalPE: 15, currentPE: 22, note: 'Power utilities — moderately expensive; renewables (Waaree/Adani Green) at 40-60x are steep.' },
  'Commerce and Industry': { historicalPE: 30, currentPE: 55, note: 'PLI/EMS names (Dixon/Kaynes) at 55-80x vs historic 25-35x — priced for perfection.' },
  'Rural Development': { historicalPE: 22, currentPE: 28, note: 'Tractor OEMs (M&M/Escorts) fairly priced 25-30x.' },
  'Urban Development': { historicalPE: 26, currentPE: 32, note: 'Cement/tiles moderately priced; paints elevated at 55-65x.' },
  'Health': { historicalPE: 32, currentPE: 38, note: 'Hospitals expanded valuations post-COVID.' },
  'Scientific Departments': { historicalPE: 35, currentPE: 60, note: 'ISRO ecosystem names (MTAR/Paras) very expensive.' },
  'IT and Telecom': { historicalPE: 22, currentPE: 28, note: 'Telecom utilities-like; fibre EMS names elevated.' },
};
// Second-order linkage chains (curated per top sectors)
const SECOND_ORDER_CHAINS: Record<string, string[]> = {
  'Rural Development': [
    '↑ Rural allocation → ↑ Rural income → ↑ Tractor demand',
    '→ M&M, ESCORTS, HEROMOTOCO',
    '↑ 2W/tractor sales → ↑ Tyre demand → APOLLOTYRE, MRF, CEAT',
    '↑ Construction → ↑ Steel/cement → JSWSTEEL, TATASTEEL, ULTRACEMCO',
  ],
  'Transport': [
    '↑ Roads/Rail capex → ↑ EPC order books → LT, KNRCON, RVNL, IRCON',
    '→ ↑ Cement / steel demand → ULTRACEMCO, TATASTEEL, JSWSTEEL',
    '→ ↑ Diesel/lubricant demand → CASTROLIND, GULFOIL',
    '→ ↑ Financing / lease demand → CHOLAFIN, SHRIRAMFIN',
  ],
  'Energy': [
    '↑ Power capex → ↑ Transmission tower demand → POWERGRID, KEC, KALPATPOWR',
    '→ ↑ Solar module / cable demand → WAAREEENER, POLYCAB, HAVELLS',
    '→ ↑ Wind OEM order book → SUZLON, INOXWIND',
    '→ ↑ Coal demand (baseload) → COALINDIA (short-term)',
  ],
  'Defence': [
    '↑ Defence capex → ↑ HAL/BEL/MAZDOCK order book',
    '→ ↑ EMS defence supply → KAYNES, CYIENTDLM, DATAPATTNS',
    '→ ↑ Titanium / composites → MTAR, ASTRAMICRO',
    '→ ↑ Shipbuilding steel → JINDALSAW',
  ],
  'Urban Development': [
    '↑ Housing/Metro → ↑ Cement volumes → ULTRACEMCO, DALBHARAT, SHREECEM',
    '→ ↑ Housing finance → CANFINHOME, HDFCBANK, LICHSGFIN',
    '→ ↑ Paint / tile / adhesive demand → ASIANPAINT, PIDILITIND, KAJARIACER',
    '→ ↑ Electrical wiring → HAVELLS, POLYCAB, FINOLEX',
  ],
  'Commerce and Industry': [
    '↑ PLI + Semi Mission → ↑ EMS/OSAT volumes → DIXON, AMBER, KAYNES',
    '→ ↑ Copper / plastic input demand → HINDCOPPER, FINOLEX',
    '→ ↑ Warehousing / logistics → CONCOR, MAHLOG',
  ],
};

function computeSurpriseIndex(current: EnrichedMinistry): { expected: number; actual: number; surprise: number; label: 'Positive' | 'In-Line' | 'Negative'; color: string } {
  // Expected = prior year BE (what was forecast). Actual = new BE.
  const expected = current.bePrev ?? 0;
  const actual = current.beNew ?? 0;
  const surprise = expected > 0 ? ((actual - expected) / expected) * 100 : 0;
  let label: 'Positive' | 'In-Line' | 'Negative'; let color: string;
  if (surprise >= 8) { label = 'Positive'; color = '#10B981'; }
  else if (surprise >= -3) { label = 'In-Line'; color = '#F59E0B'; }
  else { label = 'Negative'; color = '#EF4444'; }
  return { expected, actual, surprise, label, color };
}

// Historical CAGR (uses saved years). Handles 1-5 years gracefully.
function computeMinistryCAGR(ministryName: string, allYears: BudgetYearData[]): { years: { fy: string; be: number }[]; cagrPct: number | null } {
  const rows: { fy: string; be: number }[] = [];
  for (const y of allYears.sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear))) {
    const m = y.ministries.find(mm => mm.ministry === ministryName);
    if (m && m.beNew) rows.push({ fy: y.fiscalYear, be: m.beNew });
  }
  if (rows.length < 2) return { years: rows, cagrPct: null };
  const n = rows.length - 1;
  const first = rows[0].be; const last = rows[n].be;
  const cagr = (Math.pow(last / first, 1 / n) - 1) * 100;
  return { years: rows, cagrPct: Math.round(cagr * 10) / 10 };
}

// Composite theme ranking
function computeThemeRank(y: BudgetYearData): { theme: string; icon: string; score: number; parts: string[] }[] {
  const scored = y.themes.map(t => {
    const parts: string[] = [];
    let s = 0;
    // Speech mentions (keyword hits)
    const speechScore = Math.min(30, t.hits * 3);
    s += speechScore; parts.push(`speech ${speechScore}`);
    // Scheme count (up to 8 schemes)
    const schemeScore = Math.min(25, t.schemes.length * 6);
    s += schemeScore; parts.push(`schemes ${schemeScore}`);
    // Allocation growth heuristic — find matching schemes total delta
    const relSchemes = y.topSchemes.filter(sc => t.schemes.includes(sc.name));
    const avgDelta = relSchemes.length ? relSchemes.reduce((a, x) => a + (x.delta || 0), 0) / relSchemes.length : 0;
    const growthScore = Math.max(-10, Math.min(30, Math.round(avgDelta / 3)));
    s += growthScore; parts.push(`growth ${growthScore}`);
    // Capex weight — bonus if theme includes 'Infrastructure' / 'Defence' / 'Energy' etc.
    if (/Infrastructure|Defence|Energy|Semiconductor|Nuclear/i.test(t.theme)) { s += 15; parts.push('capex-heavy +15'); }
    return { theme: t.theme, icon: t.icon, score: Math.max(0, Math.min(100, s)), parts };
  });
  return scored.sort((a, b) => b.score - a.score);
}

// Scheme diff for Policy Change Tracker
function computeSchemeDiff(current: BudgetYearData, prev: BudgetYearData | null): { added: string[]; removed: string[]; expanded: SchemeRow[]; shrunk: SchemeRow[] } {
  if (!prev) return { added: [], removed: [], expanded: [], shrunk: [] };
  const curNames = new Set(current.topSchemes.map(s => s.name));
  const prevNames = new Set(prev.topSchemes.map(s => s.name));
  const added = current.topSchemes.filter(s => !prevNames.has(s.name)).map(s => s.name).slice(0, 8);
  const removed = prev.topSchemes.filter(s => !curNames.has(s.name)).map(s => s.name).slice(0, 8);
  const expanded = current.topSchemes.filter(s => (s.delta ?? 0) >= 30 && prevNames.has(s.name)).slice(0, 8);
  const shrunk = current.topSchemes.filter(s => (s.delta ?? 0) <= -30 && prevNames.has(s.name)).slice(0, 8);
  return { added, removed, expanded, shrunk };
}

export default function BudgetIntelPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [tab, setTab] = useState<'exec' | 'cio' | 'info' | 'analytics' | 'ministry' | 'themes'>('exec');
  const [savedYears, setSavedYears] = useState<string[]>([]);
  const [activeYear, setActiveYear] = useState<string>('');
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [inMemoryTexts, setInMemoryTexts] = useState<Record<string, string>>({});
  const [inMemoryFiles, setInMemoryFiles] = useState<File[]>([]);
  const [selectedMinistry, setSelectedMinistry] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [toast, setToast] = useState<string>('');
  const [showRawPreview, setShowRawPreview] = useState<boolean>(false);
  // zzz263 — sort + filter state per table
  const [ministrySort, setMinistrySort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'beNew', dir: 'desc' });
  const [ministryFilter, setMinistryFilter] = useState<string>('');
  const [schemeSort, setSchemeSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'beNew', dir: 'desc' });
  const [schemeFilter, setSchemeFilter] = useState<string>('');
  const [impactSort, setImpactSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'confidence', dir: 'desc' });
  const [surpriseSort, setSurpriseSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'surprise', dir: 'desc' });
  const [multSort, setMultSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'gdpAdd', dir: 'desc' });
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const years = loadYearIndex();
    setSavedYears(years);
    if (years.length && !activeYear) setActiveYear(years[years.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4200); return () => clearTimeout(t); }, [toast]);

  const hasUnsaved = Object.keys(inMemoryTexts).length > 0 || pastedText.trim().length > 100;
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault(); e.returnValue = 'You have unsaved Budget Intel data. Close anyway?'; return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  const [activeData, setActiveData] = useState<BudgetYearData | null>(null);

  useEffect(() => {
    if (!activeYear) { setActiveData(null); return; }
    const stored = loadYearData(activeYear);
    if (!stored) { setActiveData(null); return; }
    if (Array.isArray(stored.ministries) && stored.ministries.length > 0) { setActiveData(stored); return; }
    if (!stored.rawTexts || Object.keys(stored.rawTexts).length === 0) { setActiveData(stored); return; }
    const merged = Object.values(stored.rawTexts).join('\n\n');
    const { ministries: rawMinistries, subsidies } = parseMinistryTable(merged);
    const gt = parseGrandTotal(merged);
    const headline = parseFiscalHeadline(merged);
    // zzz262 — Prefer grand-total (unambiguous) over headline.totalExpBE for share denominator
    const denom = (gt.beNew ?? 0) >= (headline.totalExpBE ?? 0) ? gt.beNew : headline.totalExpBE;
    const enriched = enrichMinistries(rawMinistries, denom);
    const deficits = parseDeficitBlock(merged, headline.gdpEstimate);
    const topSchemes = parseTopSchemes(merged);
    const reparsed: BudgetYearData = {
      ...stored, ministries: enriched, subsidies, grandTotal: gt, headline,
      receipts: parseReceiptsBreakdown(merged), deficits,
      comesFrom: parseRupeeComesFrom(merged), goesTo: parseRupeeGoesTo(merged),
      topSchemes, themes: extractThemes(merged, topSchemes),
    };
    try { saveYearData(reparsed); } catch {}
    setActiveData(reparsed);
  }, [activeYear, savedYears, dataVersion]);

  const mergedText = useMemo(
    () => Object.values(inMemoryTexts).join('\n\n') + '\n\n' + pastedText,
    [inMemoryTexts, pastedText]
  );

  const pending = useMemo(() => {
    if (!mergedText.trim()) return null;
    const { ministries: rawMinistries, subsidies } = parseMinistryTable(mergedText);
    const grandTotal = parseGrandTotal(mergedText);
    const headline = parseFiscalHeadline(mergedText);
    const denom2 = (grandTotal.beNew ?? 0) >= (headline.totalExpBE ?? 0) ? grandTotal.beNew : headline.totalExpBE;
    const ministries = enrichMinistries(rawMinistries, denom2);
    const receipts = parseReceiptsBreakdown(mergedText);
    const deficits = parseDeficitBlock(mergedText, headline.gdpEstimate);
    const comesFrom = parseRupeeComesFrom(mergedText);
    const goesTo = parseRupeeGoesTo(mergedText);
    const topSchemes = parseTopSchemes(mergedText);
    const themes = extractThemes(mergedText, topSchemes);
    return { ministries, subsidies, grandTotal, headline, receipts, deficits, comesFrom, goesTo, topSchemes, themes };
  }, [mergedText]);

  const handleFiles = useCallback(async (fs: FileList | File[]) => {
    const arr = Array.from(fs);
    setBusy(true); setError(null);
    const hasPdf = arr.some(f => (f.name.split('.').pop()?.toLowerCase() || '') === 'pdf');
    if (hasPdf && pastedText.trim().length > 20) {
      setPastedText('');
      setToast('📥 PDF uploaded — paste text cleared to avoid data conflicts.');
    }
    try {
      const nextTexts: Record<string, string> = { ...inMemoryTexts };
      for (const f of arr) {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        if (ext === 'pdf') {
          try { nextTexts[f.name] = await extractPdfText(f); }
          catch (e: any) { setError(`PDF parse failed for ${f.name}: ${e?.message || e}`); }
        } else if (ext === 'docx') {
          try { nextTexts[f.name] = await extractDocxText(f); }
          catch (e: any) { setError(`DOCX parse failed for ${f.name}: ${e?.message || e}`); }
        } else if (ext === 'txt' || ext === 'md') {
          nextTexts[f.name] = await f.text();
        } else {
          setError(`${f.name}: try PDF or DOCX, or paste text below.`);
        }
      }
      setInMemoryFiles(prev => {
        const merged = [...prev];
        for (const a of arr) if (!merged.find(m => m.name === a.name)) merged.push(a);
        return merged;
      });
      setInMemoryTexts(nextTexts);
    } finally { setBusy(false); }
  }, [inMemoryTexts, pastedText]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const drop = (e: DragEvent) => { prevent(e); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); };
    el.addEventListener('dragover', prevent); el.addEventListener('drop', drop);
    return () => { el.removeEventListener('dragover', prevent); el.removeEventListener('drop', drop); };
  }, [handleFiles]);

  useEffect(() => {
    if (!pending) return;
    if (pending.ministries.length < 3) return;
    const fy = pending.headline.yearNew;
    if (!fy || !/^\d{4}-\d{2,4}$/.test(fy)) return;
    const existing = loadYearData(fy);
    if (existing && existing.ministries.length >= pending.ministries.length) return;
    const data: BudgetYearData = {
      fiscalYear: fy, uploadedAt: new Date().toISOString(),
      documents: inMemoryFiles.map(f => ({ name: f.name, size: f.size, textLen: (inMemoryTexts[f.name] || '').length })),
      rawTexts: inMemoryTexts, ...pending,
    };
    saveYearData(data);
    setSavedYears(loadYearIndex());
    setActiveYear(fy);
    setDataVersion(v => v + 1);
    setToast(`✓ Auto-saved as FY ${fy} · ${pending.ministries.length} ministries · ${pending.topSchemes.length} schemes · ${pending.themes.length} themes`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const savePending = () => {
    if (!pending) return;
    const fy = pending.headline.yearNew || prompt('Fiscal year (e.g. 2026-27):') || '';
    if (!fy || !/^\d{4}-\d{2,4}$/.test(fy)) { alert('Please enter FY as YYYY-YY, e.g. 2026-27'); return; }
    const data: BudgetYearData = {
      fiscalYear: fy, uploadedAt: new Date().toISOString(),
      documents: inMemoryFiles.map(f => ({ name: f.name, size: f.size, textLen: (inMemoryTexts[f.name] || '').length })),
      rawTexts: inMemoryTexts, ...pending,
    };
    saveYearData(data);
    setSavedYears(loadYearIndex());
    setActiveYear(fy);
    setDataVersion(v => v + 1);
    setInMemoryFiles([]); setInMemoryTexts({}); setPastedText('');
    setTab('exec');
    setToast(`✓ Saved as FY ${fy}`);
  };

  const clearActiveYear = () => {
    if (!activeYear) return;
    if (!confirm(`Delete stored data for FY ${activeYear}?`)) return;
    deleteYearData(activeYear);
    const remaining = loadYearIndex();
    setSavedYears(remaining);
    setActiveYear(remaining[remaining.length - 1] || '');
    setDataVersion(v => v + 1);
  };

  const exportCSV = () => {
    if (!activeData) return;
    const headers = ['Ministry', 'ActualsPrev', 'BEcurrent', 'REcurrent', 'BEnew', 'DeltaVsRE_pct', 'DeltaVsRE_abs', 'DeltaVsActual_pct', 'DeltaVsActual_abs', 'DeltaVsBE_pct', 'ShareOfBudget_pct', 'Rank', 'PriorityScore', 'Category', 'Note'];
    const lines = [headers.join(',')];
    for (const m of activeData.ministries) {
      lines.push([
        m.ministry, m.actualsPrev ?? '', m.bePrev ?? '', m.rePrev ?? '', m.beNew ?? '',
        m.yoyVsRE ?? '', m.absoluteDeltaRE ?? '', m.yoyVsActual ?? '', m.absoluteDeltaActual ?? '',
        m.yoyVsBE ?? '', m.shareOfBudget ?? '', m.rank, m.priorityScore, m.category, m.note || '',
      ].map(v => String(v).replace(/,/g, ';')).join(','));
    }
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `budget-intel-${activeData.fiscalYear}-ministries.csv`;
    a.click();
  };
  const exportJSON = () => {
    if (!activeData) return;
    const slim = { ...activeData, rawTexts: undefined };
    const blob = new Blob([JSON.stringify(slim, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `budget-intel-${activeData.fiscalYear}.json`;
    a.click();
  };

  const rankableMinistries = useMemo(
    () => activeData ? activeData.ministries.filter(m => !EXCLUDED_FROM_RANKING.has(m.ministry)) : [],
    [activeData]
  );
  const sortedByAbsUp = useMemo(() => [...rankableMinistries].filter(m => (m.absoluteDeltaRE ?? 0) > 0).sort((a, b) => (b.absoluteDeltaRE || 0) - (a.absoluteDeltaRE || 0)), [rankableMinistries]);
  const sortedByAbsDown = useMemo(() => [...rankableMinistries].filter(m => (m.absoluteDeltaRE ?? 0) < 0).sort((a, b) => (a.absoluteDeltaRE || 0) - (b.absoluteDeltaRE || 0)), [rankableMinistries]);
  const sortedByPctUp = useMemo(() => [...rankableMinistries].filter(m => (m.yoyVsRE ?? 0) > 0).sort((a, b) => (b.yoyVsRE || 0) - (a.yoyVsRE || 0)), [rankableMinistries]);
  const sortedByPctDown = useMemo(() => [...rankableMinistries].filter(m => (m.yoyVsRE ?? 0) < 0).sort((a, b) => (a.yoyVsRE || 0) - (b.yoyVsRE || 0)), [rankableMinistries]);
  const priorityRanked = useMemo(() => [...rankableMinistries].sort((a, b) => b.priorityScore - a.priorityScore), [rankableMinistries]);
  const fq = useMemo(() => activeData ? fiscalQualityScore(activeData.headline, activeData.grandTotal, activeData.deficits) : null, [activeData]);
  const aiSummary = useMemo(() => activeData ? buildAISummary(activeData) : '', [activeData]);

  const sectorPlays = useMemo<SectorPlay[]>(() => {
    if (!activeData) return [];
    const plays: SectorPlay[] = [];
    for (const m of rankableMinistries) {
      if (!SECTOR_MAP[m.ministry]) continue;
      const yoy = m.yoyVsRE ?? m.yoyVsActual ?? 0;
      plays.push({
        sector: SECTOR_MAP[m.ministry].sector, ministry: m.ministry,
        direction: yoy > 3 ? 'up' : yoy < -3 ? 'down' : 'flat', yoyPct: yoy,
        stocks: SECTOR_MAP[m.ministry].stocks, note: m.note,
      });
    }
    for (const s of activeData.subsidies) {
      if (!SUBSIDY_STOCKS[s.ministry]) continue;
      const yoy = s.yoyVsRE ?? 0;
      plays.push({
        sector: SUBSIDY_STOCKS[s.ministry].name, ministry: s.ministry,
        direction: yoy > 3 ? 'up' : yoy < -3 ? 'down' : 'flat', yoyPct: yoy,
        stocks: SUBSIDY_STOCKS[s.ministry].stocks,
        note: `${s.ministry} is a subsidy line-item, not a ministry — read as sector-specific spend cue`,
      });
    }
    return plays.sort((a, b) => b.yoyPct - a.yoyPct);
  }, [activeData, rankableMinistries]);

  const allYearsData = useMemo(() => savedYears.map(y => loadYearData(y)).filter((d): d is BudgetYearData => !!d).sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear)), [savedYears]);

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
  // zzz263 — Reusable sort header + filter input
  const SortTH = ({ label, k, sortState, setSort, align }: { label: string; k: string; sortState: { key: string; dir: 'asc' | 'desc' }; setSort: (s: { key: string; dir: 'asc' | 'desc' }) => void; align?: 'left' | 'right' }) => {
    const active = sortState.key === k;
    const arrow = active ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return (
      <th style={{ textAlign: align || 'left', padding: '6px 8px', cursor: 'pointer', userSelect: 'none' as const, color: active ? '#60A5FA' : DIM }}
        onClick={() => setSort({ key: k, dir: active && sortState.dir === 'desc' ? 'asc' : 'desc' })}>
        {label}{arrow}
      </th>
    );
  };
  const FilterBox = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8, minWidth: 220 }} />
  );
  const sortCompare = <T,>(a: T, b: T, getVal: (x: T) => any, dir: 'asc' | 'desc'): number => {
    const va = getVal(a); const vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
    return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  };

  const tabStyle = (active: boolean): any => ({
    padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800,
    background: active ? 'linear-gradient(90deg, #60A5FA, #22D3EE)' : 'var(--mc-bg-2)',
    color: active ? '#0B1220' : TEXT, border: active ? 'none' : '1px solid var(--mc-bg-4)',
    cursor: 'pointer', letterSpacing: '0.3px',
  });

  const deficitColorByPctGDP = (pctGDP: number | null): string => {
    if (pctGDP == null) return TEXT;
    if (pctGDP > 5.5) return '#EF4444';
    if (pctGDP >= 4) return '#F59E0B';
    return '#10B981';
  };

  const RankRow = ({ n, m, absMode }: { n: number; m: EnrichedMinistry; absMode: boolean }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed var(--mc-bg-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: DIM, fontWeight: 800, width: 20 }}>#{n}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', color: TEXT }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>{m.ministry}</div>
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{fmtCr(m.rePrev)} → {fmtCr(m.beNew)}{m.note ? ` · ⚠ ${m.note}` : ''}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' }}>
          {absMode ? fmtDelta(m.absoluteDeltaRE) : fmtPct(m.yoyVsRE)}
        </div>
        <div style={{ fontSize: 10, color: DIM }}>{absMode ? fmtPct(m.yoyVsRE) : fmtDelta(m.absoluteDeltaRE)}</div>
      </div>
    </div>
  );

  const heatColor = (yoy: number): string => {
    if (yoy >= 15) return '#065F46';
    if (yoy >= 5) return '#10B981';
    if (yoy >= 0) return '#84CC16';
    if (yoy >= -5) return '#FBBF24';
    if (yoy >= -15) return '#F59E0B';
    return '#EF4444';
  };

  const barCard = (data: EnrichedMinistry[], year: string) => {
    if (!data.length) return null;
    const top = [...data].sort((a, b) => (b.beNew || 0) - (a.beNew || 0)).slice(0, 15);
    const max = Math.max(...top.map(m => m.beNew || 0));
    return (
      <div style={CARD}>
        <div style={H}>📊 Top 15 ministries by allocation (FY {year} BE)</div>
        <div>
          {top.map(m => (
            <div key={m.ministry} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: TEXT, fontWeight: 700, cursor: 'pointer' }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>{m.ministry}</span>
                <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCr(m.beNew)} · <span style={{ color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>{fmtPct(m.yoyVsRE)}</span>
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
    const sumWarning = total < 80 || total > 110;
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
        {sumWarning && <div style={{ fontSize: 10.5, color: '#F59E0B', marginBottom: 6, fontWeight: 700 }}>⚠ Slices sum to {total}% — some labels may be missing from this PDF</div>}
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
                  <span style={{ color: DIM, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{d.pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const empty = !activeData;
  const showTabs = !!activeData;

  const drillMinistry = useMemo(() => {
    if (!selectedMinistry || !activeData) return null;
    return activeData.ministries.find(m => m.ministry === selectedMinistry) || null;
  }, [selectedMinistry, activeData]);
  const drillHistory = useMemo(() => {
    if (!selectedMinistry || !allYearsData.length) return [];
    return allYearsData
      .map(y => ({ year: y.fiscalYear, m: y.ministries.find(m => m.ministry === selectedMinistry) }))
      .filter(x => !!x.m) as { year: string; m: EnrichedMinistry }[];
  }, [selectedMinistry, allYearsData]);

  const drillTheme = useMemo(() => {
    if (!selectedTheme || !activeData) return null;
    return activeData.themes.find(t => t.theme === selectedTheme) || null;
  }, [selectedTheme, activeData]);

  const namedMinTotal = useMemo(() => {
    if (!activeData) return 0;
    return activeData.ministries.reduce((a, m) => a + (m.beNew || 0), 0)
         + activeData.subsidies.reduce((a, s) => a + (s.beNew || 0), 0);
  }, [activeData]);

  const budgetTotal = useMemo(() => {
    if (!activeData) return 0;
    // zzz259 — Prefer whichever is LARGER between grandTotal and headline.
    // Named-ministries-sum is a sanity floor: total must be ≥ that sum.
    const gt = activeData.grandTotal.beNew ?? 0;
    const hd = activeData.headline.totalExpBE ?? 0;
    const namedSum = activeData.ministries.reduce((a, m) => a + (m.beNew || 0), 0)
                   + activeData.subsidies.reduce((a, s) => a + (s.beNew || 0), 0);
    // Total exp must be ≥ sum of named ministries. Otherwise it's wrong (probably
    // captured a sub-line like "Other Expenditure ₹2.67 L Cr").
    const candidates = [gt, hd].filter(v => v >= namedSum * 0.95);
    if (candidates.length) return Math.max(...candidates);
    // Fallback: whichever is largest
    return Math.max(gt, hd, namedSum);
  }, [activeData]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>📊 Budget Intel</h1>
            <div style={{ marginTop: 4, fontSize: 12.5, color: DIM }}>
              Institutional-grade Union Budget analytics — 22 themes, auto-detected schemes, cross-year comparison. Persists per fiscal year.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {savedYears.length > 0 && (
              <>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>Year:</label>
                <select value={activeYear} onChange={(e) => setActiveYear(e.target.value)}
                  style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 800 }}>
                  {savedYears.map(y => <option key={y} value={y}>FY {y}</option>)}
                </select>
                <button onClick={exportCSV} style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⬇ CSV</button>
                <button onClick={exportJSON} style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⬇ JSON</button>
                <button onClick={() => window.print()} style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🖨 PDF</button>
                <button onClick={clearActiveYear} style={{ background: 'transparent', border: '1px solid var(--mc-bearish)', color: 'var(--mc-bearish)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🗑</button>
              </>
            )}
          </div>
        </div>

        {toast && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
            background: 'color-mix(in srgb, var(--mc-bullish) 20%, transparent)',
            border: '1px solid var(--mc-bullish)', color: 'var(--mc-text-0)',
          }}>{toast}</div>
        )}

        <div ref={dropRef}
          style={{ ...CARD, border: '2px dashed color-mix(in srgb, #60A5FA 50%, transparent)', padding: '20px 20px', cursor: 'pointer', background: 'color-mix(in srgb, #60A5FA 4%, transparent)' }}
          onClick={() => (document.getElementById('budget-file-input') as HTMLInputElement)?.click()}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ fontSize: 22 }}>📥</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Drop Budget PDF / DOCX — Speech + at-a-Glance + Expenditure + Receipts</div>
              <div style={{ fontSize: 11.5, color: DIM }}>Auto-saves on parse. All uploads merge into one brief. Cross-year comparison unlocks when ≥ 2 years are saved.</div>
            </div>
          </div>
          {busy && <div style={{ marginTop: 10, fontSize: 12, color: '#F59E0B', fontWeight: 700, textAlign: 'center' }}>Extracting text…</div>}
          {error && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--mc-bearish)', textAlign: 'center' }}>{error}</div>}
          {inMemoryFiles.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
              {inMemoryFiles.map(f => (
                <span key={f.name} style={{ fontSize: 11, padding: '3px 10px', background: 'color-mix(in srgb, #10B981 15%, transparent)', border: '1px solid color-mix(in srgb, #10B981 40%, transparent)', color: '#10B981', borderRadius: 6, fontWeight: 700 }}>
                  📄 {f.name}
                </span>
              ))}
              {pending && (
                <button onClick={(e) => { e.stopPropagation(); savePending(); }}
                  style={{ background: '#10B981', color: '#0B1220', border: 'none', padding: '6px 16px', borderRadius: 6, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', marginLeft: 8 }}>
                  💾 Save as FY {pending.headline.yearNew || '?'}
                </button>
              )}
            </div>
          )}
          <input id="budget-file-input" type="file" multiple accept=".pdf,.txt,.md,.docx" style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>

        <details style={{ ...CARD, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: DIM, fontWeight: 700 }}>📋 Or paste raw text</summary>
          <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} placeholder="Paste budget text — parsed alongside uploads."
            style={{ marginTop: 8, width: '100%', minHeight: 100, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 10, color: TEXT, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
        </details>

        {empty && !pending && (
          <div style={{ ...CARD, padding: '40px 20px', textAlign: 'center', color: DIM }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 14 }}>Upload a Budget PDF to unlock the institutional dashboard.</div>
          </div>
        )}

        {pending && !activeData && (
          <div style={CARD}>
            <div style={H}>🔎 Preview — auto-save triggers once ≥ 3 ministries are detected</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <KV label="FY detected" value={pending.headline.yearNew || 'unknown'} color="#F59E0B" />
              <KV label="Ministries" value={pending.ministries.filter(m => !EXCLUDED_FROM_RANKING.has(m.ministry)).length} />
              <KV label="Subsidy items" value={pending.subsidies.length} />
              <KV label="Total budget" value={fmtCr(pending.headline.totalExpBE ?? pending.grandTotal.beNew)} color="#22D3EE" />
              <KV label="Themes detected" value={pending.themes.length} />
              <KV label="Schemes parsed" value={pending.topSchemes.length} />
            </div>
          </div>
        )}

        {showTabs && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--mc-bg-3)', paddingBottom: 8 }}>
            <button style={tabStyle(tab === 'exec')} onClick={() => setTab('exec')}>🎯 Executive Summary</button>
            <button style={tabStyle(tab === 'cio')} onClick={() => setTab('cio')}>💼 CIO View</button>
            <button style={tabStyle(tab === 'info')} onClick={() => setTab('info')}>📋 Key Info</button>
            <button style={tabStyle(tab === 'analytics')} onClick={() => setTab('analytics')}>📈 Analytics & Rankings</button>
            <button style={tabStyle(tab === 'themes')} onClick={() => setTab('themes')}>🎨 Themes Deep-Dive</button>
            <button style={tabStyle(tab === 'ministry')} onClick={() => setTab('ministry')}>🏛 Ministry Deep-Dive</button>
          </div>
        )}

        {showTabs && tab === 'exec' && activeData && (
          <>
            <div style={CARD}>
              <div style={H}>🤖 AI-generated executive briefing — FY {activeData.fiscalYear}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.7, color: TEXT }}
                   dangerouslySetInnerHTML={{ __html: aiSummary.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <KV label="Total Expenditure BE" value={fmtCr(budgetTotal)} sub={`vs prior RE ${fmtPct(pct(activeData.grandTotal.beNew, activeData.grandTotal.rePrev))}`} color="#22D3EE" />
              <KV label="Capital Expenditure" value={fmtCr(activeData.headline.totalCapExBE)} sub={activeData.headline.totalCapExBE && budgetTotal ? `${((activeData.headline.totalCapExBE / budgetTotal) * 100).toFixed(1)}% of total` : ''} color="#10B981" />
              <KV label="Fiscal Deficit" value={fmtCr(activeData.deficits.fiscalDeficit)} sub={activeData.deficits.fiscalDeficitPctGDP != null ? `${activeData.deficits.fiscalDeficitPctGDP.toFixed(1)}% of GDP · FRBM target 3%` : ''} color={deficitColorByPctGDP(activeData.deficits.fiscalDeficitPctGDP)} />
              <KV label="Fiscal Quality Score" value={`${fq?.score ?? '—'}/100`} sub={fq?.benchmark || ''} color={fq && fq.score >= 70 ? 'var(--mc-bullish)' : fq && fq.score >= 55 ? '#F59E0B' : 'var(--mc-bearish)'} />
            </div>

            {budgetTotal > 0 && Math.abs(namedMinTotal - budgetTotal) / budgetTotal > 0.02 && (
              <div style={{ ...CARD, padding: '10px 14px', background: 'color-mix(in srgb, #F59E0B 8%, transparent)', border: '1px solid #F59E0B' }}>
                <span style={{ fontSize: 11.5, color: TEXT, fontWeight: 700 }}>ℹ Reconciliation:</span>{' '}
                <span style={{ fontSize: 11.5, color: DIM }}>
                  Named ministries + subsidies sum to {fmtCr(namedMinTotal)}. Budget Total is {fmtCr(budgetTotal)}.
                  Difference of {fmtCr(budgetTotal - namedMinTotal)} covers Central transfers, contingencies, and misc. lines not attributed to named ministries.
                </span>
              </div>
            )}

            <div style={CARD}>
              <div style={H}>🎯 Government Priority Score — Ministry ranking (normalized 15..95)</div>
              <div style={{ fontSize: 11, color: DIM, marginBottom: 12 }}>
                Base 50 + growth (×log10 budget-share) + rank bonus + scale bonus − cut penalty. Normalized so top scorer ≈ 95; "Others" and Planning &amp; Statistics never top the list.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                {priorityRanked.slice(0, 12).map((m, i) => (
                  <div key={m.ministry} style={{ padding: 12, background: 'var(--mc-bg-2)', borderRadius: 8, cursor: 'pointer', borderLeft: `4px solid ${m.priorityScore >= 75 ? 'var(--mc-bullish)' : m.priorityScore >= 55 ? '#F59E0B' : 'var(--mc-bearish)'}` }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>#{i + 1} · {m.ministry}</span>
                      <span style={{ fontSize: 18, fontWeight: 900, color: m.priorityScore >= 75 ? 'var(--mc-bullish)' : m.priorityScore >= 55 ? '#F59E0B' : 'var(--mc-bearish)' }}>{m.priorityScore}</span>
                    </div>
                    <div style={{ fontSize: 11, color: DIM }}>
                      {fmtCr(m.beNew)} · {fmtPct(m.yoyVsRE)} vs RE · {m.shareOfBudget != null ? `${m.shareOfBudget}% of budget` : ''}
                    </div>
                    {m.note && <div style={{ fontSize: 10.5, color: '#F59E0B', marginTop: 4, fontWeight: 700 }}>⚠ {m.note}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
              <div style={CARD}>
                <div style={H}>🏆 Biggest Winners — ₹ increase vs RE FY {activeData.headline.yearPrev}</div>
                {sortedByAbsUp.slice(0, 6).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)}
              </div>
              <div style={CARD}>
                <div style={H}>💔 Biggest Cuts — ₹ decrease vs RE FY {activeData.headline.yearPrev}</div>
                {sortedByAbsDown.length ? sortedByAbsDown.slice(0, 6).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)
                  : <div style={{ fontSize: 12, color: DIM }}>No ministry cut vs current RE</div>}
              </div>
            </div>

            <div style={CARD}>
              <div style={H}>🌡 Ministry heatmap — Δ vs FY {activeData.headline.yearPrev} RE (excl. Others / Planning)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                {rankableMinistries.map(m => (
                  <div key={m.ministry}
                    onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}
                    style={{ padding: 10, background: heatColor(m.yoyVsRE ?? 0), borderRadius: 8, cursor: 'pointer', color: (m.yoyVsRE ?? 0) >= 0 && (m.yoyVsRE ?? 0) < 5 ? '#0B1220' : 'white' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.ministry}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, marginTop: 3 }}>{fmtPct(m.yoyVsRE)}</div>
                    <div style={{ fontSize: 10, opacity: 0.85 }}>{fmtLCr(m.beNew)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 10, color: DIM, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>Legend:</span>
                {[['≥+15%','#065F46'],['+5–15%','#10B981'],['0–5%','#84CC16'],['−5–0%','#FBBF24'],['−15%','#F59E0B'],['<−15%','#EF4444']].map(([l,c]) => (
                  <span key={l as string} style={{ padding: '2px 6px', background: c as string, borderRadius: 3, color: 'white', fontWeight: 700 }}>{l}</span>
                ))}
              </div>
            </div>

            {fq && fq.parts.length > 0 && (
              <div style={CARD}>
                <div style={H}>⚖ Fiscal Quality decomposition</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {fq.parts.map(p => (
                    <div key={p.label} style={{ padding: 12, background: 'var(--mc-bg-2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>{p.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3, color: '#22D3EE' }}>{p.pctDisplay}</div>
                      <div style={{ fontSize: 11, color: p.value >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700, marginTop: 2 }}>{p.value >= 0 ? '+' : ''}{p.value} pts</div>
                      {p.note && <div style={{ fontSize: 10.5, color: '#F59E0B', marginTop: 3 }}>⚠ {p.note}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: DIM, fontStyle: 'italic' }}>
                  Benchmarks — FRBM medium-term target: fiscal deficit ≤ 4.5% of GDP, statutory target 3%. Institutional threshold for capex: ≥ 20% of total expenditure.
                </div>
              </div>
            )}
          </>
        )}

        {showTabs && tab === 'info' && activeData && (
          <>
            {(activeData.headline.totalExpBE || activeData.grandTotal.beNew) && (
              <div>
                <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>🇮🇳 FISCAL HEADLINE — FY {activeData.fiscalYear} BE</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <KV label="Total Expenditure BE" value={fmtCr(budgetTotal)} />
                  <KV label="Total Capital Expenditure" value={fmtCr(activeData.headline.totalCapExBE)} sub={activeData.headline.effectiveCapExBE ? `Effective ${fmtCr(activeData.headline.effectiveCapExBE)}` : ''} color="#22D3EE" />
                  <KV label="Interest Payments" value={fmtCr(activeData.headline.interestPayments)} sub={activeData.headline.interestPayments && budgetTotal ? `${((activeData.headline.interestPayments / budgetTotal) * 100).toFixed(1)}% of total exp` : ''} color="#F59E0B" />
                  <KV label={`FY ${activeData.headline.yearActuals || 'prior'} Actuals total`} value={fmtCr(activeData.grandTotal.actualsPrev)} sub={activeData.grandTotal.actualsPrev && activeData.grandTotal.beNew ? `${fmtPct(pct(activeData.grandTotal.beNew, activeData.grandTotal.actualsPrev))} growth` : ''} />
                </div>
              </div>
            )}

            {(activeData.deficits.fiscalDeficit || activeData.deficits.revenueDeficit) && (
              <div>
                <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>📉 DEFICIT BLOCK — coloring by % of GDP</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <KV label="Fiscal Deficit" value={fmtLCr(activeData.deficits.fiscalDeficit)} sub={activeData.deficits.fiscalDeficitPctGDP != null ? `${activeData.deficits.fiscalDeficitPctGDP.toFixed(1)}% of GDP` : ''} color={deficitColorByPctGDP(activeData.deficits.fiscalDeficitPctGDP)} />
                  <KV label="Revenue Deficit" value={fmtLCr(activeData.deficits.revenueDeficit)} sub={activeData.deficits.revenueDeficitPctGDP != null ? `${activeData.deficits.revenueDeficitPctGDP.toFixed(1)}% of GDP` : ''} color={deficitColorByPctGDP(activeData.deficits.revenueDeficitPctGDP)} />
                  <KV label="Effective Rev Deficit" value={fmtLCr(activeData.deficits.effectiveRevenueDeficit)} />
                  <KV label="Primary Deficit" value={fmtLCr(activeData.deficits.primaryDeficit)} />
                </div>
              </div>
            )}

            {(activeData.receipts.revenueReceipts || activeData.receipts.taxRevenue) && (
              <div style={CARD}>
                <div style={H}>💰 Receipts breakdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {([
                    ['Revenue Receipts', activeData.receipts.revenueReceipts, activeData.receipts.yoyBEvsActual.revenueReceipts],
                    ['Tax Revenue (net)', activeData.receipts.taxRevenue, activeData.receipts.yoyBEvsActual.taxRevenue],
                    ['Non-Tax Revenue', activeData.receipts.nonTaxRevenue, activeData.receipts.yoyBEvsActual.nonTaxRevenue],
                    ['Capital Receipts', activeData.receipts.capitalReceipts, activeData.receipts.yoyBEvsActual.capitalReceipts],
                    ['Recovery of Loans', activeData.receipts.loanRecovery, activeData.receipts.yoyBEvsActual.loanRecovery],
                    ['Other Receipts (disinvest.)', activeData.receipts.otherReceipts, activeData.receipts.yoyBEvsActual.otherReceipts],
                    ['Borrowings (net)', activeData.receipts.borrowings, activeData.receipts.yoyBEvsActual.borrowings],
                  ] as [string, number|null, number|null][]).filter(([, v]) => v != null).map(([label, val, yoy]) => (
                    <div key={label} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>{fmtLCr(val)}</div>
                      {yoy != null && <div style={{ fontSize: 11, color: yoy >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>{fmtPct(yoy)} vs FY {activeData.headline.yearActuals} Actuals</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeData.ministries.length > 0 && (
              <div style={CARD}>
                <div style={H}>📚 Ministry table — click headers to sort</div>
                <FilterBox value={ministryFilter} onChange={setMinistryFilter} placeholder="🔍 Filter ministry name..." />
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px 6px', color: DIM }}>#</th>
                        <SortTH label="Ministry" k="ministry" sortState={ministrySort} setSort={setMinistrySort} />
                        <SortTH label={`FY ${activeData.headline.yearActuals} Actuals`} k="actualsPrev" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label={`FY ${activeData.headline.yearPrev} BE`} k="bePrev" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label={`FY ${activeData.headline.yearPrev} RE`} k="rePrev" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label={`FY ${activeData.fiscalYear} BE`} k="beNew" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label="Δ vs RE ₹" k="absoluteDeltaRE" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label="Δ vs RE %" k="yoyVsRE" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label="Δ vs Actual" k="yoyVsActual" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label="Share" k="shareOfBudget" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                        <SortTH label="Score" k="priorityScore" sortState={ministrySort} setSort={setMinistrySort} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...activeData.ministries]
                        .filter(m => !ministryFilter || m.ministry.toLowerCase().includes(ministryFilter.toLowerCase()))
                        .sort((a, b) => sortCompare(a, b, (x: any) => x[ministrySort.key], ministrySort.dir))
                        .map((m, idx) => (
                        <tr key={m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)', cursor: 'pointer', background: EXCLUDED_FROM_RANKING.has(m.ministry) ? 'color-mix(in srgb, var(--mc-text-4) 5%, transparent)' : 'transparent' }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>
                          <td style={{ padding: '5px 6px', color: DIM, fontWeight: 700 }}>{idx + 1}</td>
                          <td style={{ padding: '5px 6px', fontWeight: 700 }}>{m.ministry}{EXCLUDED_FROM_RANKING.has(m.ministry) ? ' *' : ''}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLCr(m.actualsPrev)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', color: DIM }}>{fmtLCr(m.bePrev)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmtLCr(m.rePrev)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 800 }}>{fmtLCr(m.beNew)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 700, color: (m.absoluteDeltaRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtDelta(m.absoluteDeltaRE)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 800, color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsRE)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', color: (m.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsActual)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{m.shareOfBudget != null ? `${m.shareOfBudget}%` : '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 800, color: m.priorityScore >= 70 ? 'var(--mc-bullish)' : m.priorityScore >= 50 ? '#F59E0B' : 'var(--mc-bearish)' }}>{m.priorityScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 6 }}>Click any row → Ministry Deep-Dive. Asterisked rows excluded from ranking (catch-all / secretariat).</div>
              </div>
            )}

            {activeData.subsidies.length > 0 && (
              <div style={CARD}>
                <div style={H}>💊 Subsidy line-items (separate from ministries)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {activeData.subsidies.map(s => (
                    <div key={s.ministry} style={{ padding: 12, background: 'var(--mc-bg-2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{s.ministry} subsidy</div>
                      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>{fmtLCr(s.beNew)}</div>
                      <div style={{ fontSize: 11, color: (s.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700, marginTop: 2 }}>{fmtPct(s.yoyVsRE)} vs RE</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeData.topSchemes.length > 0 && (() => {
              const filtered = activeData.topSchemes
                .filter(s => !schemeFilter || s.name.toLowerCase().includes(schemeFilter.toLowerCase()))
                .sort((a, b) => sortCompare(a, b, (x: any) => x[schemeSort.key], schemeSort.dir));
              return (
                <div style={CARD}>
                  <div style={H}>🏗 Scheme allocations · {activeData.topSchemes.length} schemes parsed (BE ≥ ₹100 Cr)</div>
                  <FilterBox value={schemeFilter} onChange={setSchemeFilter} placeholder="🔍 Search scheme (e.g. Jal Jeevan, PMAY, PLI)..." />
                  <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Showing {filtered.length} of {activeData.topSchemes.length}. Click headers to sort.</div>
                  <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ position: 'sticky', top: 0, background: 'var(--mc-bg-1)', zIndex: 1 }}>
                          <SortTH label="Scheme" k="name" sortState={schemeSort} setSort={setSchemeSort} />
                          <SortTH label={`FY ${activeData.headline.yearPrev} RE`} k="rePrev" sortState={schemeSort} setSort={setSchemeSort} align="right" />
                          <SortTH label={`FY ${activeData.fiscalYear} BE`} k="beNew" sortState={schemeSort} setSort={setSchemeSort} align="right" />
                          <SortTH label="Δ %" k="delta" sortState={schemeSort} setSort={setSchemeSort} align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(s => (
                          <tr key={s.name} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                            <td style={{ padding: '6px 8px' }}>{s.name}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: DIM, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(s.rePrev)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800 }}>{fmtCr(s.beNew)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: (s.delta ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(s.delta)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            <div style={CARD}>
              <div style={H}>📄 Raw extraction preview</div>
              <button onClick={() => setShowRawPreview(!showRawPreview)} style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {showRawPreview ? 'Hide' : 'Show'} raw text ({Object.keys(activeData.rawTexts).length} files)
              </button>
              {showRawPreview && Object.entries(activeData.rawTexts).map(([name, text]) => (
                <details key={name} style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', color: '#60A5FA', fontWeight: 700, fontSize: 12 }}>{name} · {text.length.toLocaleString('en-IN')} chars</summary>
                  <pre style={{ fontSize: 10.5, color: DIM, whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 300, overflowY: 'auto', background: 'var(--mc-bg-2)', padding: 10, borderRadius: 6 }}>{text.slice(0, 3500)}{text.length > 3500 ? '…' : ''}</pre>
                </details>
              ))}
            </div>
          </>
        )}

        {showTabs && tab === 'analytics' && activeData && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
              <div style={CARD}>
                <div style={H}>🏆 Top ₹ increases (vs RE FY {activeData.headline.yearPrev})</div>
                {sortedByAbsUp.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)}
              </div>
              <div style={CARD}>
                <div style={H}>📈 Top % increases (vs RE FY {activeData.headline.yearPrev})</div>
                {sortedByPctUp.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode={false} />)}
              </div>
              <div style={CARD}>
                <div style={H}>💔 Top ₹ cuts (vs RE FY {activeData.headline.yearPrev})</div>
                {sortedByAbsDown.length ? sortedByAbsDown.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)
                  : <div style={{ fontSize: 12, color: DIM }}>No absolute cuts detected</div>}
              </div>
              <div style={CARD}>
                <div style={H}>📉 Top % cuts (vs RE FY {activeData.headline.yearPrev})</div>
                {sortedByPctDown.length ? sortedByPctDown.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode={false} />)
                  : <div style={{ fontSize: 12, color: DIM }}>No % cuts detected</div>}
              </div>
            </div>

            {barCard(rankableMinistries, activeData.fiscalYear)}

            {(activeData.comesFrom.length > 0 || activeData.goesTo.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                {activeData.comesFrom.length > 0 && donut('💵 Where the Rupee Comes From', activeData.comesFrom)}
                {activeData.goesTo.length > 0 && donut('💸 Where the Rupee Goes To', activeData.goesTo)}
              </div>
            )}

            {sectorPlays.length > 0 && (
              <div style={CARD}>
                <div style={H}>💼 Sector plays — listed names that ride each allocation shift</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
                  {sectorPlays.map(sp => (
                    <div key={sp.sector + sp.ministry} style={{ padding: 12, background: 'var(--mc-bg-2)', border: `1px solid ${sp.direction === 'up' ? 'color-mix(in srgb, var(--mc-bullish) 40%, transparent)' : sp.direction === 'down' ? 'color-mix(in srgb, var(--mc-bearish) 40%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{sp.sector}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: sp.direction === 'up' ? 'var(--mc-bullish)' : sp.direction === 'down' ? 'var(--mc-bearish)' : DIM }}>
                          {sp.direction === 'up' ? '▲' : sp.direction === 'down' ? '▼' : '—'} {fmtPct(sp.yoyPct)}
                        </div>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginBottom: 6 }}>Trigger: <span style={{ cursor: 'pointer', color: '#60A5FA' }} onClick={() => { setSelectedMinistry(sp.ministry); setTab('ministry'); }}>{sp.ministry}</span></div>
                      {sp.note && <div style={{ fontSize: 10.5, color: '#F59E0B', marginBottom: 6, fontWeight: 700 }}>ℹ {sp.note}</div>}
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
              </div>
            )}
          </>
        )}

        {/* ═════════════ TAB · CIO VIEW ═════════════ */}
        {showTabs && tab === 'cio' && activeData && (() => {
          const stance = computeStance(activeData, fq);
          const impl = computePortfolioImplications(activeData);
          const risks = computeRisks(activeData);
          const rankable = activeData.ministries.filter(m => !EXCLUDED_FROM_RANKING.has(m.ministry));
          const impactRows = rankable
            .filter(m => SECTOR_MAP[m.ministry])
            .map(m => ({ m, impact: computeMarketImpact(m), sector: SECTOR_MAP[m.ministry].sector }))
            .sort((a, b) => {
              const rank = (i: MarketImpact) => ({ 'Very Bullish': 5, 'Bullish': 4, 'Moderate': 3, 'Neutral': 2, 'Bearish': 1 }[i]);
              return rank(b.impact.impact) - rank(a.impact.impact) || b.impact.confidence - a.impact.confidence;
            });
          const momentum = rankable
            .map(m => ({ m, mom: computeMomentum(m, allYearsData
                .map(y => ({ year: y.fiscalYear, m: y.ministries.find(mm => mm.ministry === m.ministry) }))
                .filter(x => !!x.m) as { year: string; m: EnrichedMinistry }[]),
            }))
            .sort((a, b) => {
              const rk = (x: Momentum) => ({ 'up-strong': 4, up: 3, flat: 2, down: 1 }[x]);
              return rk(b.mom) - rk(a.mom);
            });
          const highConv = impactRows.filter(x => x.impact.impact === 'Very Bullish' || (x.impact.impact === 'Bullish' && x.impact.confidence >= 8)).slice(0, 5);
          const medConv = impactRows.filter(x => x.impact.impact === 'Bullish' && x.impact.confidence < 8).slice(0, 5);
          const specConv = impactRows.filter(x => x.impact.impact === 'Moderate' && x.impact.confidence >= 6).slice(0, 4);

          return (
            <>
              {/* STANCE */}
              <div style={{ ...CARD, borderLeft: `6px solid ${stance.color}` }}>
                <div style={{ fontSize: 11, color: DIM, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Stance · Investment view · FY {activeData.fiscalYear}</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6, color: stance.color }}>{stance.stance}</div>
                <ul style={{ marginTop: 10, paddingLeft: 18, color: TEXT, fontSize: 12.5, lineHeight: 1.7 }}>
                  {stance.drivers.map(d => <li key={d}>{d}</li>)}
                </ul>
              </div>

              {/* PORTFOLIO IMPLICATIONS */}
              <div style={CARD}>
                <div style={H}>📊 Portfolio implications — how positioning should shift</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  <div style={{ padding: 12, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid var(--mc-bullish)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bullish)', marginBottom: 6 }}>↑ Overweight — Bullish tilt</div>
                    {impl.bullish.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>No structural bullish tilts detected.</div>}
                    {impl.bullish.map(b => (
                      <div key={b.sector} style={{ fontSize: 12, padding: '3px 0', borderTop: '1px dashed var(--mc-bg-3)', color: TEXT }}>
                        <span style={{ fontWeight: 700 }}>{b.sector}</span> <span style={{ color: DIM }}>({b.ministry} {fmtPct(b.delta)})</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: DIM, marginBottom: 6 }}>→ Neutral — Steady exposure</div>
                    {impl.neutral.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>No neutral clusters.</div>}
                    {impl.neutral.map(s => (
                      <div key={s} style={{ fontSize: 12, padding: '3px 0', borderTop: '1px dashed var(--mc-bg-3)', color: TEXT }}>{s}</div>
                    ))}
                  </div>
                  <div style={{ padding: 12, background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid var(--mc-bearish)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bearish)', marginBottom: 6 }}>↓ Underweight — Bearish tilt</div>
                    {impl.bearish.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>No cuts warranting underweight positioning.</div>}
                    {impl.bearish.map(b => (
                      <div key={b.sector} style={{ fontSize: 12, padding: '3px 0', borderTop: '1px dashed var(--mc-bg-3)', color: TEXT }}>
                        <span style={{ fontWeight: 700 }}>{b.sector}</span> <span style={{ color: DIM }}>({b.ministry} {fmtPct(b.delta)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* MARKET IMPACT SCORE */}
              <div style={CARD}>
                <div style={H}>🎯 Market Impact Score — confidence-weighted sector call (click headers to sort)</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <SortTH label="Sector" k="sector" sortState={impactSort} setSort={setImpactSort} />
                        <SortTH label="Trigger ministry" k="ministry" sortState={impactSort} setSort={setImpactSort} />
                        <SortTH label="Δ vs RE" k="delta" sortState={impactSort} setSort={setImpactSort} align="right" />
                        <SortTH label="Share" k="share" sortState={impactSort} setSort={setImpactSort} align="right" />
                        <SortTH label="Impact" k="impact" sortState={impactSort} setSort={setImpactSort} />
                        <SortTH label="Confidence" k="confidence" sortState={impactSort} setSort={setImpactSort} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...impactRows].sort((a, b) => {
                        const getV = (r: any) => {
                          if (impactSort.key === 'sector') return r.sector;
                          if (impactSort.key === 'ministry') return r.m.ministry;
                          if (impactSort.key === 'delta') return r.m.yoyVsRE;
                          if (impactSort.key === 'share') return r.m.shareOfBudget;
                          if (impactSort.key === 'impact') { const rk = { 'Very Bullish': 5, 'Bullish': 4, 'Moderate': 3, 'Neutral': 2, 'Bearish': 1 }; return rk[r.impact.impact as keyof typeof rk]; }
                          if (impactSort.key === 'confidence') return r.impact.confidence;
                          return 0;
                        };
                        return sortCompare(a, b, getV, impactSort.dir);
                      }).map(row => (
                        <tr key={row.m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>{row.sector}</td>
                          <td style={{ padding: '6px 8px', color: DIM }}>{row.m.ministry}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: (row.m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(row.m.yoyVsRE)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: DIM }}>{row.m.shareOfBudget != null ? `${row.m.shareOfBudget}%` : '—'}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: 4, background: row.impact.color, color: 'white', fontWeight: 800, fontSize: 11 }}>{row.impact.impact}</span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800 }}>{row.impact.confidence}/10</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MINISTRY MOMENTUM */}
              <div style={CARD}>
                <div style={H}>📈 Ministry momentum — direction {allYearsData.length >= 2 ? 'over ' + allYearsData.length + ' fiscal years' : '(single-year data — upload more years for multi-year trend)'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  {momentum.slice(0, 16).map(({ m, mom }) => {
                    const icon = mom === 'up-strong' ? '↑↑↑' : mom === 'up' ? '↑↑' : mom === 'flat' ? '→' : '↓';
                    const color = mom === 'up-strong' ? '#065F46' : mom === 'up' ? '#10B981' : mom === 'flat' ? '#F59E0B' : '#EF4444';
                    return (
                      <div key={m.ministry} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8, borderLeft: `4px solid ${color}` }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{m.ministry}</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 3 }}>{icon}</div>
                        <div style={{ fontSize: 10.5, color: DIM }}>{fmtPct(m.yoyVsRE)} vs RE</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RISKS */}
              <div style={CARD}>
                <div style={H}>⚠ Key risks — institutional view</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
                  {risks.map((r, i) => {
                    const color = r.severity === 'high' ? '#EF4444' : r.severity === 'med' ? '#F59E0B' : '#94A3B8';
                    return (
                      <div key={i} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8, borderLeft: `4px solid ${color}` }}>
                        <div style={{ fontSize: 10, color, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{r.severity} severity</div>
                        <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{r.risk}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* INSTITUTIONAL CONCLUSION */}
              <div style={CARD}>
                <div style={H}>🏁 Institutional conclusion & highest-conviction plays</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: TEXT, marginBottom: 14 }}>
                  This budget signals a <b>{stance.stance.toLowerCase()}</b> policy stance. Incremental allocations concentrate in {impl.bullish.slice(0, 3).map(b => b.sector).join(', ') || 'multiple sectors'}. Investors should prioritize companies with strong execution history and visible order books over broad sector exposure, given elevated valuations in policy-favored names.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                  <div style={{ padding: 12, background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid var(--mc-bullish)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bullish)', marginBottom: 8 }}>★★★★★ High Conviction</div>
                    {highConv.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>No sectors clear the high-conviction bar.</div>}
                    {highConv.map(x => (
                      <div key={x.m.ministry} style={{ fontSize: 12, padding: '4px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                        <span style={{ fontWeight: 700 }}>{x.sector}</span>
                        <span style={{ color: DIM, marginLeft: 6 }}>({x.impact.impact} · {x.impact.confidence}/10)</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: 12, background: 'color-mix(in srgb, #F59E0B 8%, transparent)', border: '1px solid #F59E0B', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 8 }}>★★★★ Medium Conviction</div>
                    {medConv.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>—</div>}
                    {medConv.map(x => (
                      <div key={x.m.ministry} style={{ fontSize: 12, padding: '4px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                        <span style={{ fontWeight: 700 }}>{x.sector}</span>
                        <span style={{ color: DIM, marginLeft: 6 }}>({x.impact.impact} · {x.impact.confidence}/10)</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: DIM, marginBottom: 8 }}>★★★ Speculative</div>
                    {specConv.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>—</div>}
                    {specConv.map(x => (
                      <div key={x.m.ministry} style={{ fontSize: 12, padding: '4px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                        <span style={{ fontWeight: 700 }}>{x.sector}</span>
                        <span style={{ color: DIM, marginLeft: 6 }}>({x.impact.impact} · {x.impact.confidence}/10)</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 12, fontStyle: 'italic' }}>
                  Not investment advice. Ranks derived from budget-allocation signals only — must be cross-checked with valuation, order-book visibility, management quality, and macro backdrop before positioning.
                </div>
              </div>

              {/* ─── Budget Surprise Index ───────────────────────────── */}
              <div style={CARD}>
                <div style={H}>⭐ Budget Surprise Index — click headers to sort</div>
                <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>
                  Positive = allocation exceeded prior year's BE by more than 8%. In-Line = within ±3-8%. Negative = fell short vs prior BE by more than 3%.
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <SortTH label="Ministry" k="ministry" sortState={surpriseSort} setSort={setSurpriseSort} />
                        <SortTH label="Expected (prior BE)" k="expected" sortState={surpriseSort} setSort={setSurpriseSort} align="right" />
                        <SortTH label="Actual (new BE)" k="actual" sortState={surpriseSort} setSort={setSurpriseSort} align="right" />
                        <SortTH label="Surprise" k="surprise" sortState={surpriseSort} setSort={setSurpriseSort} align="right" />
                        <SortTH label="Verdict" k="label" sortState={surpriseSort} setSort={setSurpriseSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {[...rankable].map(m => ({ m, s: computeSurpriseIndex(m) }))
                        .sort((a, b) => {
                          const getV = (r: { m: EnrichedMinistry; s: ReturnType<typeof computeSurpriseIndex> }) => {
                            if (surpriseSort.key === 'ministry') return r.m.ministry;
                            if (surpriseSort.key === 'expected') return r.s.expected;
                            if (surpriseSort.key === 'actual') return r.s.actual;
                            if (surpriseSort.key === 'surprise') return r.s.surprise;
                            if (surpriseSort.key === 'label') { const rk = { 'Positive': 3, 'In-Line': 2, 'Negative': 1 }; return rk[r.s.label]; }
                            return 0;
                          };
                          return sortCompare(a, b, getV, surpriseSort.dir);
                        })
                        .map(({ m, s }) => {
                        return (
                          <tr key={m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{m.ministry}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: DIM }}>{fmtCr(s.expected)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtCr(s.actual)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: s.color }}>{s.surprise >= 0 ? '+' : ''}{s.surprise.toFixed(1)}%</td>
                            <td style={{ padding: '6px 8px' }}>
                              <span style={{ padding: '3px 8px', borderRadius: 4, background: s.color, color: 'white', fontSize: 10.5, fontWeight: 800 }}>{s.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ─── Sankey-style flow diagram (simplified SVG) ─────── */}
              <div style={CARD}>
                <div style={H}>🔀 Fund flow — Receipts → Expenditure → Sectors</div>
                <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>
                  Simplified flow from major receipt sources to expenditure classes to top-5 sector plays.
                </div>
                {(() => {
                  const capex = activeData.headline.totalCapExBE ?? 0;
                  const totalExp = budgetTotal;
                  const revenueExp = Math.max(0, totalExp - capex);
                  const borrowings = activeData.receipts.borrowings ?? 0;
                  const tax = activeData.receipts.taxRevenue ?? 0;
                  const nonTax = activeData.receipts.nonTaxRevenue ?? 0;
                  const topSectors = impl.bullish.slice(0, 5);
                  const totalTop = topSectors.reduce((a, s) => a + Math.abs(s.delta), 0) || 1;
                  return (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, color: DIM, marginBottom: 4, fontWeight: 800, textTransform: 'uppercase' as const }}>SOURCES</div>
                          {[['Tax Revenue', tax, '#22D3EE'], ['Non-Tax Rev', nonTax, '#10B981'], ['Borrowings', borrowings, '#EF4444']].map(([label, val, col]: any) => (
                            <div key={label} style={{ padding: 8, background: 'var(--mc-bg-2)', borderRadius: 6, marginBottom: 4, borderLeft: `4px solid ${col}` }}>
                              <div style={{ fontSize: 11, fontWeight: 700 }}>{label}</div>
                              <div style={{ fontSize: 13, fontWeight: 800 }}>{fmtCr(val)}</div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: DIM, marginBottom: 4, fontWeight: 800, textTransform: 'uppercase' as const }}>USES</div>
                          {[['Capital Exp', capex, '#10B981'], ['Revenue Exp', revenueExp, '#F59E0B']].map(([label, val, col]: any) => (
                            <div key={label} style={{ padding: 8, background: 'var(--mc-bg-2)', borderRadius: 6, marginBottom: 4, borderLeft: `4px solid ${col}` }}>
                              <div style={{ fontSize: 11, fontWeight: 700 }}>{label}</div>
                              <div style={{ fontSize: 13, fontWeight: 800 }}>{fmtCr(val)}</div>
                              <div style={{ fontSize: 10.5, color: DIM }}>{totalExp > 0 ? ((val / totalExp) * 100).toFixed(1) : 0}% of total</div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: DIM, marginBottom: 4, fontWeight: 800, textTransform: 'uppercase' as const }}>TOP SECTOR PLAYS</div>
                          {topSectors.length === 0 && <div style={{ fontSize: 11, color: DIM }}>No dominant sector tilts.</div>}
                          {topSectors.map(s => (
                            <div key={s.sector} style={{ padding: 8, background: 'var(--mc-bg-2)', borderRadius: 6, marginBottom: 4, borderLeft: '4px solid var(--mc-bullish)' }}>
                              <div style={{ fontSize: 11, fontWeight: 700 }}>{s.sector}</div>
                              <div style={{ fontSize: 11, color: DIM }}>{s.ministry} {fmtPct(s.delta)}</div>
                              <div style={{ height: 4, background: 'var(--mc-bg-3)', borderRadius: 2, marginTop: 4 }}>
                                <div style={{ width: `${(Math.abs(s.delta) / totalTop) * 100}%`, height: '100%', background: 'var(--mc-bullish)', borderRadius: 2 }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* ─── Historical CAGR (multi-year) ────────────────────── */}
              {allYearsData.length >= 2 && (
                <div style={CARD}>
                  <div style={H}>📈 Historical CAGR — trend persistence across {allYearsData.length} saved fiscal years</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                    {rankable.slice(0, 12).map(m => {
                      const c = computeMinistryCAGR(m.ministry, allYearsData);
                      const color = c.cagrPct == null ? DIM : c.cagrPct >= 15 ? '#10B981' : c.cagrPct >= 5 ? '#F59E0B' : '#EF4444';
                      return (
                        <div key={m.ministry} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8, borderLeft: `4px solid ${color}` }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{m.ministry}</div>
                          <div style={{ fontSize: 18, fontWeight: 900, marginTop: 3, color }}>
                            {c.cagrPct != null ? `${c.cagrPct >= 0 ? '+' : ''}${c.cagrPct}% CAGR` : '—'}
                          </div>
                          <div style={{ fontSize: 10.5, color: DIM, marginTop: 2 }}>
                            {c.years.map(y => `FY${y.fy.slice(2, 4)}`).join(' → ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ─── Global comparison ─────────────────────────────────── */}
              <div style={CARD}>
                <div style={H}>🌍 Global comparison — public capex as % of GDP</div>
                {(() => {
                  const gdpRaw = activeData.headline.gdpEstimate ?? 0;
                  const capex = activeData.headline.totalCapExBE ?? 0;
                  const indiaPct = gdpRaw > 0 ? (capex / gdpRaw) * 100 : 0;
                  const rows = GLOBAL_CAPEX_TO_GDP.map(r => r.country.startsWith('India') ? { ...r, pct: indiaPct, note: `From this budget — CapEx ${fmtCr(capex)} / GDP ${fmtCr(gdpRaw)}` } : r);
                  const max = Math.max(...rows.map(r => r.pct));
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {rows.map(r => (
                        <div key={r.country} style={{ padding: 8, background: r.country.startsWith('India') ? 'color-mix(in srgb, var(--mc-bullish) 12%, transparent)' : 'var(--mc-bg-2)', borderRadius: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ fontWeight: 700 }}>{r.country}</span>
                            <span style={{ fontWeight: 800 }}>{r.pct.toFixed(1)}% of GDP</span>
                          </div>
                          <div style={{ height: 6, background: 'var(--mc-bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(r.pct / max) * 100}%`, height: '100%', background: r.country.startsWith('India') ? 'var(--mc-bullish)' : '#60A5FA' }} />
                          </div>
                          <div style={{ fontSize: 10.5, color: DIM, marginTop: 3, fontStyle: 'italic' as const }}>{r.note}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ─── GDP multipliers ─────────────────────────────────── */}
              <div style={CARD}>
                <div style={H}>📊 GDP multipliers — click headers to sort</div>
                <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>
                  Fiscal multipliers from RBI (2020) and NIPFP research. A 2.0x multiplier means ₹1 of ministry capex expands GDP by ₹2 over 3-5 years.
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <SortTH label="Ministry" k="ministry" sortState={multSort} setSort={setMultSort} />
                        <SortTH label="Allocation" k="alloc" sortState={multSort} setSort={setMultSort} align="right" />
                        <SortTH label="Multiplier" k="mult" sortState={multSort} setSort={setMultSort} align="right" />
                        <SortTH label="Implied GDP add" k="gdpAdd" sortState={multSort} setSort={setMultSort} align="right" />
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: DIM }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankable.filter(m => GDP_MULTIPLIERS[m.ministry])
                        .map(m => ({ m, mult: GDP_MULTIPLIERS[m.ministry], gdpAdd: (m.beNew ?? 0) * GDP_MULTIPLIERS[m.ministry].mult }))
                        .sort((a, b) => {
                          const getV = (r: any) => {
                            if (multSort.key === 'ministry') return r.m.ministry;
                            if (multSort.key === 'alloc') return r.m.beNew;
                            if (multSort.key === 'mult') return r.mult.mult;
                            if (multSort.key === 'gdpAdd') return r.gdpAdd;
                            return 0;
                          };
                          return sortCompare(a, b, getV, multSort.dir);
                        })
                        .map(({ m, mult, gdpAdd }) => {
                        return (
                          <tr key={m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{m.ministry}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtCr(m.beNew)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: mult.mult >= 1.5 ? 'var(--mc-bullish)' : mult.mult >= 1.0 ? '#F59E0B' : 'var(--mc-bearish)' }}>{mult.mult.toFixed(2)}x</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtCr(gdpAdd)}</td>
                            <td style={{ padding: '6px 8px', fontSize: 10.5, color: DIM }}>{mult.source}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ─── Valuation overlay ─────────────────────────────────── */}
              <div style={CARD}>
                <div style={H}>💰 Valuation overlay — allocation vs sector PE bands</div>
                <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>
                  Positive policy ≠ buy signal when valuations are stretched. Historical PE = 5-year median (indicative). Current PE = trailing 12M median for the sector's largest listed names.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
                  {rankable.filter(m => VALUATION_OVERLAY[m.ministry] && (m.yoyVsRE ?? 0) > 0).map(m => {
                    const v = VALUATION_OVERLAY[m.ministry];
                    const premium = ((v.currentPE - v.historicalPE) / v.historicalPE) * 100;
                    const color = premium > 50 ? '#EF4444' : premium > 25 ? '#F59E0B' : '#10B981';
                    const verdict = premium > 50 ? 'Very Expensive' : premium > 25 ? 'Elevated' : premium > 10 ? 'Fair' : 'Reasonable';
                    return (
                      <div key={m.ministry} style={{ padding: 12, background: 'var(--mc-bg-2)', border: `1px solid ${color}`, borderRadius: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 800 }}>{m.ministry}</span>
                          <span style={{ padding: '3px 8px', background: color, color: 'white', borderRadius: 4, fontSize: 10.5, fontWeight: 800 }}>{verdict}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 11.5, marginTop: 6 }}>
                          <div><span style={{ color: DIM }}>Allocation Δ:</span> <b style={{ color: 'var(--mc-bullish)' }}>{fmtPct(m.yoyVsRE)}</b></div>
                          <div><span style={{ color: DIM }}>Hist PE:</span> <b>{v.historicalPE}x</b></div>
                          <div><span style={{ color: DIM }}>Current PE:</span> <b style={{ color }}>{v.currentPE}x</b></div>
                          <div><span style={{ color: DIM }}>Premium:</span> <b style={{ color }}>{premium.toFixed(0)}%</b></div>
                        </div>
                        <div style={{ fontSize: 10.5, color: DIM, marginTop: 6, fontStyle: 'italic' as const }}>{v.note}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ─── Second-order beneficiaries ────────────────────────── */}
              <div style={CARD}>
                <div style={H}>🔗 Second-order beneficiaries — supply-chain propagation</div>
                <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>
                  Direct beneficiaries are only the first step. These curated chains show how allocation increases propagate through supply chains to indirect beneficiaries.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
                  {impl.bullish.filter(b => SECOND_ORDER_CHAINS[b.ministry]).slice(0, 6).map(b => (
                    <div key={b.ministry} style={{ padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bullish)', borderRadius: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>{b.ministry} <span style={{ color: 'var(--mc-bullish)' }}>{fmtPct(b.delta)}</span></div>
                      {SECOND_ORDER_CHAINS[b.ministry].map((step, i) => (
                        <div key={i} style={{ fontSize: 11.5, padding: '4px 0', color: TEXT, borderTop: i > 0 ? '1px dashed var(--mc-bg-3)' : 'none' }}>{step}</div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* ─── Policy Change Tracker ───────────────────────────── */}
              {allYearsData.length >= 2 && (() => {
                const sortedYears = [...allYearsData].sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));
                const currentIdx = sortedYears.findIndex(y => y.fiscalYear === activeData.fiscalYear);
                const prev = currentIdx > 0 ? sortedYears[currentIdx - 1] : null;
                const diff = computeSchemeDiff(activeData, prev);
                return (
                  <div style={CARD}>
                    <div style={H}>🔄 Policy change tracker — {prev ? `FY ${prev.fiscalYear} → FY ${activeData.fiscalYear}` : 'needs prior year for comparison'}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                      <div style={{ padding: 12, background: 'color-mix(in srgb, var(--mc-bullish) 10%, transparent)', border: '1px solid var(--mc-bullish)', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bullish)', marginBottom: 6 }}>➕ New schemes ({diff.added.length})</div>
                        {diff.added.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>None</div>}
                        {diff.added.map(n => <div key={n} style={{ fontSize: 11.5, padding: '2px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>{n}</div>)}
                      </div>
                      <div style={{ padding: 12, background: 'color-mix(in srgb, #F59E0B 10%, transparent)', border: '1px solid #F59E0B', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6 }}>↑ Expanded (≥30% growth) ({diff.expanded.length})</div>
                        {diff.expanded.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>None</div>}
                        {diff.expanded.map(s => <div key={s.name} style={{ fontSize: 11.5, padding: '2px 0', borderTop: '1px dashed var(--mc-bg-3)' }}><span>{s.name}</span> <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{fmtPct(s.delta)}</span></div>)}
                      </div>
                      <div style={{ padding: 12, background: 'color-mix(in srgb, var(--mc-bearish) 10%, transparent)', border: '1px solid var(--mc-bearish)', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-bearish)', marginBottom: 6 }}>↓ Shrunk (≤-30%) ({diff.shrunk.length})</div>
                        {diff.shrunk.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>None</div>}
                        {diff.shrunk.map(s => <div key={s.name} style={{ fontSize: 11.5, padding: '2px 0', borderTop: '1px dashed var(--mc-bg-3)' }}><span>{s.name}</span> <span style={{ color: 'var(--mc-bearish)', fontWeight: 700 }}>{fmtPct(s.delta)}</span></div>)}
                      </div>
                      <div style={{ padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: DIM, marginBottom: 6 }}>➖ Removed ({diff.removed.length})</div>
                        {diff.removed.length === 0 && <div style={{ fontSize: 11.5, color: DIM }}>None</div>}
                        {diff.removed.map(n => <div key={n} style={{ fontSize: 11.5, padding: '2px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>{n}</div>)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ─── Theme composite ranking ───────────────────────────── */}
              <div style={CARD}>
                <div style={H}>🏆 Theme composite ranking — score = speech mentions + scheme count + growth + capex weight</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {computeThemeRank(activeData).slice(0, 12).map((t, i) => (
                    <div key={t.theme} style={{ padding: 12, background: 'var(--mc-bg-2)', borderRadius: 8, borderLeft: `4px solid ${t.score >= 70 ? 'var(--mc-bullish)' : t.score >= 50 ? '#F59E0B' : 'var(--mc-bg-4)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>#{i + 1} · {t.icon} {t.theme}</span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: t.score >= 70 ? 'var(--mc-bullish)' : t.score >= 50 ? '#F59E0B' : DIM }}>{t.score}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: DIM, marginTop: 4 }}>{t.parts.join(' · ')}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        })()}

        {showTabs && tab === 'themes' && activeData && (
          <>
            <div style={CARD}>
              <div style={H}>🎨 Every detected theme in this budget · {activeData.themes.length} of 22 possible</div>
              <div style={{ fontSize: 11, color: DIM, marginBottom: 12 }}>
                Themes detected by keyword pattern-match across the entire uploaded text (Speech + tables + schemes). Each theme aggregates matching schemes and shows related listed names. Click any theme to drill deeper.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                {activeData.themes.map(t => (
                  <div key={t.theme}
                    onClick={() => setSelectedTheme(selectedTheme === t.theme ? null : t.theme)}
                    style={{
                      padding: 12, background: selectedTheme === t.theme ? 'var(--mc-bg-3)' : 'var(--mc-bg-2)',
                      border: '1px solid var(--mc-bg-4)', borderRadius: 10, cursor: 'pointer',
                      borderLeft: `4px solid ${t.hits >= 5 ? 'var(--mc-bullish)' : t.hits >= 3 ? '#F59E0B' : 'var(--mc-text-4)'}`,
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{t.icon} {t.theme}</span>
                      <span style={{ fontSize: 12, color: '#F59E0B', fontWeight: 800 }}>{t.hits}×</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: DIM, marginTop: 2 }}>
                      {t.schemes.length} matching scheme{t.schemes.length === 1 ? '' : 's'} · {t.stockCue.length} linked stocks
                    </div>
                  </div>
                ))}
              </div>
              {activeData.themes.length === 0 && (
                <div style={{ fontSize: 12, color: DIM, padding: 20, textAlign: 'center' }}>
                  No themes detected. Try uploading the Budget Speech (in addition to at-a-Glance) for richer narrative coverage.
                </div>
              )}
            </div>

            {drillTheme && (
              <div style={CARD}>
                <div style={H}>{drillTheme.icon} {drillTheme.theme} — deep dive</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <KV label="Keyword hits" value={drillTheme.hits} color="#F59E0B" />
                  <KV label="Matching schemes" value={drillTheme.schemes.length} />
                  <KV label="Linked listed names" value={drillTheme.stockCue.length} />
                </div>
                {drillTheme.snippet && (
                  <div style={{ padding: 12, background: 'var(--mc-bg-2)', borderRadius: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 4 }}>Evidence from the Budget text</div>
                    <div style={{ fontSize: 12, color: TEXT, lineHeight: 1.5, fontStyle: 'italic' }}>"…{drillTheme.snippet}…"</div>
                  </div>
                )}
                {drillTheme.schemes.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.4px' }}>Matching schemes in this budget</div>
                    <div>
                      {activeData.topSchemes.filter(s => drillTheme.schemes.includes(s.name)).map(s => (
                        <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                          <span style={{ fontSize: 12 }}>{s.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: (s.delta ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtCr(s.beNew)} · {fmtPct(s.delta)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {drillTheme.stockCue.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.4px' }}>Linked listed names (rev/order-book exposure)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {drillTheme.stockCue.map(t => (
                        <a key={t} href={`https://www.nseindia.com/get-quotes/equity?symbol=${t}`} target="_blank" rel="noopener noreferrer"
                          style={{ padding: '6px 12px', background: 'var(--mc-bg-2)', color: '#60A5FA', border: '1px solid var(--mc-bg-4)', borderRadius: 6, fontSize: 12, fontWeight: 800, textDecoration: 'none' }}>{t}</a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {showTabs && tab === 'ministry' && activeData && (
          <>
            <div style={CARD}>
              <div style={H}>🏛 Pick a ministry to drill into</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activeData.ministries.map(m => (
                  <button key={m.ministry}
                    onClick={() => setSelectedMinistry(m.ministry)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      background: selectedMinistry === m.ministry ? 'linear-gradient(90deg, #60A5FA, #22D3EE)' : 'var(--mc-bg-2)',
                      color: selectedMinistry === m.ministry ? '#0B1220' : TEXT,
                      border: '1px solid var(--mc-bg-4)', cursor: 'pointer',
                      whiteSpace: 'nowrap', overflow: 'visible',
                    }}>{m.ministry}</button>
                ))}
              </div>
            </div>

            {!selectedMinistry && (
              <div style={{ ...CARD, textAlign: 'center', color: DIM, padding: '40px 20px' }}>
                Select a ministry above to see history, allocations, and linked stocks.
              </div>
            )}

            {drillMinistry && (
              <>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>{drillMinistry.ministry}</div>
                  {drillMinistry.note && (
                    <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, #F59E0B 15%, transparent)', border: '1px solid #F59E0B', borderRadius: 6, fontSize: 12, marginBottom: 10, color: TEXT }}>
                      ⚠ {drillMinistry.note}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                    <KV label="BE new" value={fmtLCr(drillMinistry.beNew)} color="var(--mc-text-0)" />
                    <KV label="Δ vs RE" value={`${fmtDelta(drillMinistry.absoluteDeltaRE)} · ${fmtPct(drillMinistry.yoyVsRE)}`} color={(drillMinistry.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
                    <KV label={`Δ vs FY ${activeData.headline.yearActuals} Actuals`} value={`${fmtDelta(drillMinistry.absoluteDeltaActual)} · ${fmtPct(drillMinistry.yoyVsActual)}`} color={(drillMinistry.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
                    <KV label="Share of budget" value={drillMinistry.shareOfBudget != null ? `${drillMinistry.shareOfBudget}%` : '—'} />
                    <KV label="Rank" value={EXCLUDED_FROM_RANKING.has(drillMinistry.ministry) ? 'excluded' : `#${drillMinistry.rank} of ${rankableMinistries.length}`} />
                    <KV label="Priority Score" value={`${drillMinistry.priorityScore}/100`} color={drillMinistry.priorityScore >= 70 ? 'var(--mc-bullish)' : drillMinistry.priorityScore >= 50 ? '#F59E0B' : 'var(--mc-bearish)'} />
                  </div>
                </div>

                {drillHistory.length > 1 && (
                  <div style={CARD}>
                    <div style={H}>📈 Multi-year allocation history</div>
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0' }}>
                      {drillHistory.map(x => (
                        <div key={x.year} style={{ minWidth: 140, padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8, textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>FY {x.year}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{fmtLCr(x.m.beNew)}</div>
                          <div style={{ fontSize: 11, color: (x.m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{fmtPct(x.m.yoyVsRE)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={CARD}>
                  <div style={H}>📊 Full breakdown — {drillMinistry.ministry}</div>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>FY {activeData.headline.yearActuals} Actuals</td><td style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>{fmtLCr(drillMinistry.actualsPrev)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>FY {activeData.headline.yearPrev} BE</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtLCr(drillMinistry.bePrev)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>FY {activeData.headline.yearPrev} RE</td><td style={{ padding: 6, textAlign: 'right' }}>{fmtLCr(drillMinistry.rePrev)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>FY {activeData.fiscalYear} BE</td><td style={{ padding: 6, textAlign: 'right', fontWeight: 900 }}>{fmtLCr(drillMinistry.beNew)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Δ vs FY {activeData.headline.yearPrev} RE</td><td style={{ padding: 6, textAlign: 'right', color: (drillMinistry.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>{fmtDelta(drillMinistry.absoluteDeltaRE)} · {fmtPct(drillMinistry.yoyVsRE)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Δ vs prior BE</td><td style={{ padding: 6, textAlign: 'right', color: (drillMinistry.yoyVsBE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(drillMinistry.yoyVsBE)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Δ vs FY {activeData.headline.yearActuals} Actuals</td><td style={{ padding: 6, textAlign: 'right', color: (drillMinistry.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtDelta(drillMinistry.absoluteDeltaActual)} · {fmtPct(drillMinistry.yoyVsActual)}</td></tr>
                    </tbody>
                  </table>
                </div>

                {SECTOR_MAP[drillMinistry.ministry] && (
                  <div style={CARD}>
                    <div style={H}>💼 Linked sector: {SECTOR_MAP[drillMinistry.ministry].sector}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                      {SECTOR_MAP[drillMinistry.ministry].stocks.map(s => (
                        <div key={s.ticker} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8 }}>
                          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${s.ticker}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60A5FA', fontWeight: 800, textDecoration: 'none', fontSize: 13 }}>{s.ticker}</a>
                          <div style={{ fontSize: 10.5, color: DIM, marginTop: 2 }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: TEXT, marginTop: 4 }}>{s.rationale}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeData.topSchemes.length > 0 && (
                  <div style={CARD}>
                    <div style={H}>🏗 Scheme allocations related to this ministry</div>
                    {(() => {
                      const key = drillMinistry.ministry.split(' ')[0];
                      const rel = activeData.topSchemes.filter(s =>
                        s.name.toLowerCase().includes(key.toLowerCase())
                        || (drillMinistry.ministry === 'Rural Development' && /rural|MGNREGA|PM-?KISAN|Awas|PMAY[- ]?Grameen/i.test(s.name))
                        || (drillMinistry.ministry === 'Urban Development' && /urban|PMAY|Metro|Smart|AMRUT/i.test(s.name))
                        || (drillMinistry.ministry === 'Health' && /Ayushman|PMJAY|Health|Jan Aushadhi|Medical/i.test(s.name))
                        || (drillMinistry.ministry === 'Energy' && /Solar|Renewable|Surya|Energy|Grid/i.test(s.name))
                        || (drillMinistry.ministry === 'Agriculture' && /Kisan|Agri|Crop|Farmer/i.test(s.name))
                        || (drillMinistry.ministry === 'Commerce and Industry' && /PLI|MSME|Startup|MITRA|Semi/i.test(s.name))
                        || (drillMinistry.ministry === 'Transport' && /Highway|Road|Rail|Metro|Port/i.test(s.name))
                        || (drillMinistry.ministry === 'Education' && /Education|Skill|PMKVY|School|College/i.test(s.name))
                      );
                      return rel.length ? (
                        <div>
                          {rel.map(s => (
                            <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                              <span style={{ fontSize: 12 }}>{s.name}</span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: (s.delta ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtCr(s.beNew)} · {fmtPct(s.delta)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <div style={{ fontSize: 12, color: DIM }}>No obvious scheme overlap detected. Browse all schemes in Key Info tab.</div>;
                    })()}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeData && (
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', textAlign: 'center', padding: '8px 0' }}>
            All numbers extracted verbatim from the Ministry of Finance PDFs. Calculated columns derive from source figures. Sector-play stock lists are historical beneficiary heuristics — not recommendations. Persists per fiscal year in your browser (localStorage). Export CSV/JSON for cross-device preservation.
          </div>
        )}
      </div>
    </div>
  );
}
