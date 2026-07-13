'use client';

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET INTEL (zzz245) — Institutional rewrite
//
//   Four tabs:
//     🎯 Executive Summary  — Priority scores + fiscal quality + AI narrative
//                             + biggest winners / losers / % movers + heatmap
//     📋 Key Info           — verbatim extraction (headline, deficit, receipts,
//                             ministry table, top schemes, raw preview)
//     📈 Analytics          — 4 ranking tables, sector plays, themes, charts
//     🏛 Ministry Deep-Dive — pick any ministry to see history + capex split
//                             + sector plays + linked stocks
//
//   Persistence — localStorage keyed by fiscal year. Uploads survive refresh.
//   Cross-year support — upload multiple years; year picker at top switches
//   the view. Cross-year comparisons unlock when ≥ 2 years are stored.
//
//   Rich calculated columns per ministry:
//     • Absolute Δ vs RE, vs Actuals, vs prior BE
//     • % Δ vs RE, vs Actuals, vs prior BE
//     • Share of total budget (%)
//     • Rank (1-N)
//     • Government Priority Score (0-100 composite)
//     • Category (Winner / Loser / Flat)
//
//   Client-side PDF (pdf.js CDN) + DOCX (mammoth CDN). Zero npm changes.
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
type GrandTotal = { actualsPrev: number|null; bePrev: number|null; rePrev: number|null; beNew: number|null };
type SchemeRow = { name: string; beNew: number; rePrev: number|null; delta: number|null };
type Theme = { theme: string; icon: string; hits: number; snippet: string };
type BudgetYearData = {
  fiscalYear: string;
  uploadedAt: string;
  documents: { name: string; size: number; textLen: number }[];
  rawTexts: Record<string, string>;
  ministries: EnrichedMinistry[];
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
};

// ─── Ministry → sector-play mapping (curated) ──────────────────────────────
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

// ─── Storage layer ─────────────────────────────────────────────────────────
const STORAGE_PREFIX = 'mc:budget-intel:v1:';
const INDEX_KEY = STORAGE_PREFIX + '__index';

function loadYearIndex(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveYearIndex(years: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(years)); } catch {}
}
function loadYearData(fy: string): BudgetYearData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + fy);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveYearData(data: BudgetYearData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PREFIX + data.fiscalYear, JSON.stringify(data));
    const idx = loadYearIndex();
    if (!idx.includes(data.fiscalYear)) {
      idx.push(data.fiscalYear); idx.sort();
      saveYearIndex(idx);
    }
  } catch (e: any) {
    // Fallback: strip rawTexts if quota exceeded
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

// ─── Number / format helpers ───────────────────────────────────────────────
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
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)} L Cr`;
  return `₹${Math.round(v).toLocaleString('en-IN')} Cr`;
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

// ─── PDF / DOCX loaders ────────────────────────────────────────────────────
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
    // zzz246 — preserve line structure via hasEOL. Previously we joined all
    // items with ' ' which collapsed the whole page into one line, so the
    // per-line ministry-row regex could never match (no end-of-line to
    // anchor on). pdfjs sets hasEOL on the last item of each visual line.
    let pageText = '';
    for (const it of content.items as any[]) {
      pageText += it.str || '';
      if (it.hasEOL) pageText += '\n';
      else pageText += ' ';
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

// ─── Parsers ───────────────────────────────────────────────────────────────

// zzz249 — Universal preprocessor. pdf.js inserts newlines/hasEOL mid-phrase
// (headings like "Expenditure of Major Items" can come out as
// "Expenditure\nof Major Items"), so literal-space regexes miss anchors.
// Also collapses multi-space runs. Applied ONCE to the merged text before
// any parser runs against it.
function preprocessBudgetText(rawText: string): string {
  return rawText
    .replace(/[\r\t]/g, ' ')
    .replace(/[ ]+/g, ' ')           // collapse only horizontal whitespace
    .replace(/\n{3,}/g, '\n\n');     // preserve single/double newlines
}

// zzz249 — Whitespace-tolerant anchors. Uses \s+ so it matches across any
// whitespace including hasEOL-inserted newlines.
function extractMinistrySection(rawText: string): string {
  const anchor = /Expenditure\s+of\s+Major\s+Items/i;
  const endAnchor = /Grand\s+Total/i;
  const start = rawText.search(anchor);
  if (start < 0) return '';
  const rest = rawText.slice(start);
  const end = rest.search(endAnchor);
  if (end < 0) return rest.slice(0, 6000);
  return rest.slice(0, end + 300);
}

// zzz249 — All multi-word labels use \s+ to survive pdf.js's mid-phrase
// newlines from hasEOL. Otherwise "Rural\nDevelopment" would miss the match.
const MINISTRY_MATCHERS: { label: string; pattern: RegExp }[] = [
  { label: 'Pension', pattern: /\bPension\b/ },
  { label: 'Defence', pattern: /\bDefence\b/ },
  { label: 'Fertiliser', pattern: /Fertili[sz]er\b/ },
  { label: 'Food', pattern: /\bFood\b/ },
  { label: 'Petroleum', pattern: /\bPetroleum\b/ },
  { label: 'Agriculture', pattern: /Agriculture\s+and\s+Allied/i },
  { label: 'Commerce and Industry', pattern: /Commerce\s+and\s+Industry/i },
  { label: 'Development of North East', pattern: /North\s+East|Development\s+of\s+North\s+East/i },
  { label: 'Education', pattern: /\bEducation\b/ },
  { label: 'Energy', pattern: /\bEnergy\d?\b/ },  // handles "Energy2" footnote digit
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
  { label: 'Others', pattern: /\bOthers\b/ },
];

// zzz247 rev-b — no aggressive number-joining. That collapsed adjacent
// column values into one giant number. pdf.js with hasEOL emits clean number
// tokens for the ministry table; the previous "broken number" cases were
// actually spaces between different table columns, not within a single number.
function parseMinistryTable(rawText: string): MinistryRow[] {
  // zzz250 — DEFENSE IN DEPTH. Do NOT require the "Expenditure of Major
  // Items" anchor. pdf.js may emit that heading with unusual whitespace or
  // characters that broke matching in previous attempts. Instead, scan the
  // ENTIRE preprocessed text for each ministry pattern followed by 4 large
  // numbers. The 4-consecutive-large-numbers signature IS what identifies
  // the table row; no anchor needed. Duplicate matches are deduped (first
  // sighting wins, which is the Expenditure table's row).
  const text = rawText.replace(/[\r\t\n]/g, ' ').replace(/\s+/g, ' ');
  const rows: MinistryRow[] = [];
  for (const m of MINISTRY_MATCHERS) {
    const flags = m.pattern.flags.includes('i') ? m.pattern.flags : m.pattern.flags + 'i';
    // zzz247 — after the ministry label, allow up to 30 non-digit chars to
    // absorb footnote digits and trailing scoping text like "Activities1"
    // that appear in the PDF between the ministry name and its number column.
    // Then require 4 numbers of 5+ digits each (₹10,000 Cr floor to skip
    // sub-scheme rows).
    // CRITICAL: wrap the label pattern in a non-capturing group so that
    // patterns using alternation ("Agriculture and Allied|Agriculture &? Allied",
    // "Commerce and Industry|...", "IT and Telecom|...") bind correctly.
    // Without this, `|` has lower precedence than the trailing regex and the
    // first alternative would match without capturing the numbers, returning
    // None for all group() calls downstream.
    // Number regex: 4+ digits (smallest ministry = North East ~₹3-6k Cr).
    // The scale gate `beNew < 5000` below still filters sub-scheme noise.
    const combined = new RegExp('(?:' + m.pattern.source + ')[^\\n]{0,30}?\\s([\\d,]{4,})\\s+([\\d,]{4,})\\s+([\\d,]{4,})\\s+([\\d,]{4,})', flags);
    const match = text.match(combined);
    if (!match) continue;
    if (rows.some(r => r.ministry === m.label)) continue;
    const [_, a, b, c, d] = match;
    const actualsPrev = parseNumber(a);
    const bePrev = parseNumber(b);
    const rePrev = parseNumber(c);
    const beNew = parseNumber(d);
    // Scale gate — 3000 Cr minimum. Catches small named ministries like
    // "Development of North East" (~₹6k Cr) while still excluding
    // sub-scheme rows that would otherwise pass label matching.
    if (beNew == null || beNew < 3000) continue;
    rows.push({
      ministry: m.label, actualsPrev, bePrev, rePrev, beNew,
      yoyVsRE: pct(beNew, rePrev), yoyVsActual: pct(beNew, actualsPrev),
    });
  }
  return rows;
}

function enrichMinistries(rows: MinistryRow[], grandTotalBE: number | null): EnrichedMinistry[] {
  const totalBudget = grandTotalBE ?? rows.reduce((a, r) => a + (r.beNew || 0), 0);
  // Rank by BE new
  const ranked = [...rows].sort((a, b) => (b.beNew || 0) - (a.beNew || 0));
  const rankMap = new Map<string, number>();
  ranked.forEach((r, i) => rankMap.set(r.ministry, i + 1));

  return rows.map(r => {
    const rank = rankMap.get(r.ministry) || rows.length;
    const shareOfBudget = r.beNew && totalBudget > 0 ? Math.round((r.beNew / totalBudget) * 1000) / 10 : null;
    const yoyVsBE = pct(r.beNew, r.bePrev);
    const absoluteDeltaRE = (r.beNew != null && r.rePrev != null) ? r.beNew - r.rePrev : null;
    const absoluteDeltaActual = (r.beNew != null && r.actualsPrev != null) ? r.beNew - r.actualsPrev : null;
    const y = r.yoyVsRE ?? 0;
    let category: 'winner' | 'loser' | 'flat' = 'flat';
    if (y > 3) category = 'winner';
    else if (y < -3) category = 'loser';

    // Priority Score composite (0-100)
    let score = 50;
    score += Math.min(20, Math.max(-20, y)); // growth impact clipped
    if (rank <= 5) score += 15;
    else if (rank <= 10) score += 10;
    else if (rank <= 15) score += 5;
    if (shareOfBudget != null) {
      if (shareOfBudget >= 8) score += 10;
      else if (shareOfBudget >= 4) score += 5;
    }
    if (r.yoyVsActual != null && r.yoyVsActual >= 20) score += 5;
    if (y < -5) score -= 15;
    if (r.yoyVsActual != null && r.yoyVsActual < 0) score -= 5;
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      ...r, yoyVsBE, absoluteDeltaRE, absoluteDeltaActual, shareOfBudget,
      rank, priorityScore: score, category,
    };
  });
}

function parseGrandTotal(rawText: string): GrandTotal {
  const cleaned = rawText.replace(/[\r\t\n]/g, ' ').replace(/\s+/g, ' ');
  const m = cleaned.match(/Grand\s+Total\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d,]{6,})/i);
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
  // zzz248 — tolerant year regex. pdf.js emits "BUDGET AT A GLANCE 2026 - 2027"
  // (spaces around the dash) so a strict \d{4}-\d{4} misses it.
  const yr = text.match(/BUDGET AT A GLANCE\s+(\d{4})\s*[-–]\s*(\d{2,4})/i)
          || text.match(/Budget\s+(\d{4})\s*[-–]\s*(\d{2,4})/i);
  const yearNew = yr ? `${yr[1]}-${yr[2].length === 2 ? yr[2] : yr[2].slice(2)}` : '';
  const yearPrev = yearNew ? `${parseInt(yearNew.slice(0, 4)) - 1}-${parseInt(yearNew.slice(5, 9)) - 1}` : '';
  // zzz249 — Bug B fix. Old [^0-9]{0,80} couldn't cross intermediate
  // digits like "2026-27" between "total expenditure" and "₹53,47,315".
  // New: .{0,200}? (lazy any) skips the year AND requires "crore" as an
  // end-anchor so we capture the correct figure. Verified against the
  // budget-at-a-glance PDF text: matches all three occurrences and picks
  // the first (BE-new-FY) via search-order.
  return {
    totalExpBE: grab(/total\s+expenditure.{0,200}?₹\s*([\d,\s]{6,20}?)\s*crore/i),
    totalCapExBE: grab(/total\s+capital\s+expenditure.{0,200}?₹\s*([\d,\s]{6,20}?)\s*crore/i),
    effectiveCapExBE: grab(/effective\s+capital\s+expenditure.{0,200}?₹\s*([\d,\s]{6,20}?)\s*crore/i),
    interestPayments: grab(/Interest\s+Payments?\s+[\d,]{6,}\s+[\d,]{6,}\s+[\d,]{6,}\s+([\d,]{6,})/i),
    yearNew, yearPrev,
  };
}

function parseReceiptsBreakdown(rawText: string): ReceiptsBreakdown {
  const text = rawText.replace(/\s+/g, ' ');
  const grab4 = (re: RegExp): [number|null, number|null] => {
    const m = text.match(re);
    if (!m) return [null, null];
    return [parseNumber(m[1]), parseNumber(m[4])];
  };
  const [revAct, revBE] = grab4(/Revenue\s+Receipts\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [taxAct, taxBE] = grab4(/Tax\s+Revenue[^0-9]{0,60}([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [ntAct, ntBE] = grab4(/Non\s+Tax\s+Revenue\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [capAct, capBE] = grab4(/Capital\s+Receipts\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  const [loanAct, loanBE] = grab4(/Recovery\s+of\s+Loans\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
  const [othAct, othBE] = grab4(/Other\s+Receipts\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})/i);
  const [borrAct, borrBE] = grab4(/Borrowings\s+and\s+Other[^0-9]{0,60}([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})\s+([\d,]{5,})/i);
  return {
    revenueReceipts: revBE, taxRevenue: taxBE, nonTaxRevenue: ntBE,
    capitalReceipts: capBE, loanRecovery: loanBE, otherReceipts: othBE, borrowings: borrBE,
    yoyBEvsActual: {
      revenueReceipts: pct(revBE, revAct), taxRevenue: pct(taxBE, taxAct),
      nonTaxRevenue: pct(ntBE, ntAct), capitalReceipts: pct(capBE, capAct),
      loanRecovery: pct(loanBE, loanAct), otherReceipts: pct(othBE, othAct),
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
    fiscalDeficit: grab(/Fiscal\s+Deficit\s+[\d,]{6,}\s+[\d,]{6,}\s+[\d,]{6,}\s+([\d,]{6,})/i),
    revenueDeficit: grab(/Revenue\s+Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i),
    effectiveRevenueDeficit: grab(/Effective\s+Revenue\s+Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i),
    primaryDeficit: grab(/Primary\s+Deficit\s+[\d,]{5,}\s+[\d,]{5,}\s+[\d,]{5,}\s+([\d,]{5,})/i),
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
  return rows.filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; }).slice(0, 30);
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
function extractThemes(text: string): Theme[] {
  const out: Theme[] = [];
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

// ─── Fiscal Quality Score ──────────────────────────────────────────────────
// 0-100 composite. Higher = healthier fiscal posture.
function fiscalQualityScore(h: FiscalHeadline, gt: GrandTotal, d: DeficitBlock, r: ReceiptsBreakdown): { score: number; parts: { label: string; value: number }[] } {
  const totalExp = h.totalExpBE ?? gt.beNew ?? 0;
  const parts: { label: string; value: number }[] = [];
  let score = 0;
  // Capex share of total exp — 0 to 30 pts (12% capex = 30 pts, linear)
  if (h.totalCapExBE != null && totalExp > 0) {
    const capexShare = h.totalCapExBE / totalExp;
    const capexPts = Math.min(30, Math.round(capexShare * 250));
    score += capexPts;
    parts.push({ label: 'CapEx share', value: capexPts });
  }
  // Interest burden — lower is better. 20% = 0 pts, 10% = +30 pts
  if (h.interestPayments != null && totalExp > 0) {
    const interestShare = h.interestPayments / totalExp;
    const interestPts = Math.round(30 * Math.max(0, Math.min(1, (0.20 - interestShare) / 0.10)));
    score += interestPts;
    parts.push({ label: 'Interest burden', value: interestPts });
  }
  // Fiscal deficit as % of total exp — lower better. 30% = 0, 20% = 20, 15% = 40
  if (d.fiscalDeficit != null && totalExp > 0) {
    const fdShare = d.fiscalDeficit / totalExp;
    const fdPts = Math.round(40 * Math.max(0, Math.min(1, (0.35 - fdShare) / 0.20)));
    score += fdPts;
    parts.push({ label: 'Fiscal deficit', value: fdPts });
  }
  return { score: Math.max(0, Math.min(100, score)), parts };
}

// ─── AI Summary (rule-based synthesis) ─────────────────────────────────────
function buildAISummary(y: BudgetYearData): string {
  if (!y.ministries.length) return '';
  const totalBudget = y.headline.totalExpBE ?? y.grandTotal.beNew ?? 0;
  const growthVsRE = pct(y.grandTotal.beNew, y.grandTotal.rePrev);
  const growthVsActual = pct(y.grandTotal.beNew, y.grandTotal.actualsPrev);
  const winners = y.ministries.filter(m => m.category === 'winner').sort((a, b) => (b.absoluteDeltaRE || 0) - (a.absoluteDeltaRE || 0)).slice(0, 3);
  const losers = y.ministries.filter(m => m.category === 'loser').sort((a, b) => (a.absoluteDeltaRE || 0) - (b.absoluteDeltaRE || 0)).slice(0, 3);
  const capexShare = y.headline.totalCapExBE && totalBudget > 0 ? (y.headline.totalCapExBE / totalBudget) * 100 : null;
  const interestShare = y.headline.interestPayments && totalBudget > 0 ? (y.headline.interestPayments / totalBudget) * 100 : null;
  const topThemes = y.themes.slice(0, 3).map(t => t.theme).join(', ');

  const parts: string[] = [];
  parts.push(`**Budget FY ${y.fiscalYear}** allocates **${fmtCr(totalBudget)}** across ${y.ministries.length} major ministries` +
    (growthVsRE != null ? `, ${growthVsRE >= 0 ? 'growing' : 'contracting'} **${Math.abs(growthVsRE).toFixed(1)}%** over the prior year's Revised Estimates` : '') +
    (growthVsActual != null ? ` and **${growthVsActual >= 0 ? '+' : ''}${growthVsActual.toFixed(1)}%** over prior FY Actuals` : '') + '.');
  if (capexShare != null) {
    parts.push(`Capital expenditure at **${fmtCr(y.headline.totalCapExBE)}** represents **${capexShare.toFixed(1)}%** of total spend, ${capexShare >= 22 ? 'indicating a strong public-investment tilt' : capexShare >= 18 ? 'signalling continued capex thrust' : 'suggesting a more revenue-heavy posture'}.`);
  }
  if (interestShare != null) {
    parts.push(`Interest payments consume **${interestShare.toFixed(1)}%** of the budget, ${interestShare >= 22 ? 'constraining discretionary spend' : 'leaving room for productive allocations'}.`);
  }
  if (winners.length) {
    parts.push(`The **largest allocation increases** go to ${winners.map(w => `**${w.ministry}** (${fmtDelta(w.absoluteDeltaRE)} / ${fmtPct(w.yoyVsRE)})`).join(', ')}.`);
  }
  if (losers.length) {
    parts.push(`**Notable cuts** hit ${losers.map(l => `**${l.ministry}** (${fmtDelta(l.absoluteDeltaRE)} / ${fmtPct(l.yoyVsRE)})`).join(', ')}.`);
  }
  if (topThemes) {
    parts.push(`The narrative is dominated by ${topThemes}.`);
  }
  // Investment takeaway
  const upSectors = winners.filter(w => SECTOR_MAP[w.ministry]).map(w => SECTOR_MAP[w.ministry].sector).slice(0, 3);
  if (upSectors.length) {
    parts.push(`**Institutional read:** allocation lift favors ${upSectors.join(', ')}. Cross-check with valuation, order-book visibility, and management-quality filters before positioning.`);
  }
  return parts.join(' ');
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function BudgetIntelPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [tab, setTab] = useState<'exec' | 'info' | 'analytics' | 'ministry'>('exec');
  const [savedYears, setSavedYears] = useState<string[]>([]);
  const [activeYear, setActiveYear] = useState<string>('');
  // zzz247 — bump on every save/delete so activeData useMemo re-reads
  // localStorage even when the year name is unchanged.
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [inMemoryTexts, setInMemoryTexts] = useState<Record<string, string>>({});
  const [inMemoryFiles, setInMemoryFiles] = useState<File[]>([]);
  const [selectedMinistry, setSelectedMinistry] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Hydrate saved-year index on mount
  useEffect(() => {
    const years = loadYearIndex();
    setSavedYears(years);
    if (years.length && !activeYear) setActiveYear(years[years.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // zzz251 — MIGRATION RE-PARSE. If a stored year has computed fields empty
  // (parser was broken when the save was made) BUT still has the raw text
  // stored, re-run the CURRENT parsers against that raw text and overwrite
  // the stale computed portion. One-time fix on every load; only touches
  // years whose ministries.length === 0 so healthy saves are untouched.
  //
  // This is the root cause of the "parser works but analytics blank" bug:
  // the diagnostic bar reads activeData.ministries.length (stored), while
  // the debug panel runs regexes against activeData.rawTexts (also stored).
  // Debug proves parser is correct; the empty-ministries save was left over
  // from an older broken parser build. Auto-save only overwrites on fresh
  // upload, so this migration is what unblocks users who already saved
  // before the parser fixes landed.
  useEffect(() => {
    if (savedYears.length === 0) return;
    let anyChanged = false;
    for (const y of savedYears) {
      try {
        const d = loadYearData(y);
        if (!d) continue;
        // Defensive: old saves might have undefined ministries
        const currentCount = Array.isArray(d.ministries) ? d.ministries.length : 0;
        if (currentCount > 0) continue;                       // healthy — skip
        if (!d.rawTexts || Object.keys(d.rawTexts).length === 0) continue;
        const merged = Object.values(d.rawTexts).join('\n\n');
        const rawMinistries = parseMinistryTable(merged);
        if (rawMinistries.length === 0) continue;
        const gt = parseGrandTotal(merged);
        const headline = parseFiscalHeadline(merged);
        const enriched = enrichMinistries(rawMinistries, headline.totalExpBE ?? gt.beNew);
        const updated: BudgetYearData = {
          ...d,
          ministries: enriched,
          grandTotal: gt,
          headline,
          receipts: parseReceiptsBreakdown(merged),
          deficits: parseDeficitBlock(merged),
          comesFrom: parseRupeeComesFrom(merged),
          goesTo: parseRupeeGoesTo(merged),
          topSchemes: parseTopSchemes(merged),
          themes: extractThemes(merged),
        };
        saveYearData(updated);
        anyChanged = true;
        try { console.log('[budget-intel] migration re-parsed FY', y, '- ministries:', enriched.length); } catch {}
      } catch (err: any) {
        try { console.error('[budget-intel] migration failed for FY', y, err); } catch {}
      }
    }
    if (anyChanged) setDataVersion(v => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedYears.length]);

  // Current active year's data (from LS). dataVersion is bumped on save/delete
  // so overwriting the same FY refreshes the view.
  const activeData = useMemo<BudgetYearData | null>(() => activeYear ? loadYearData(activeYear) : null, [activeYear, savedYears, dataVersion]);

  // In-progress parse (before save)
  const mergedText = useMemo(
    () => Object.values(inMemoryTexts).join('\n\n') + '\n\n' + pastedText,
    [inMemoryTexts, pastedText]
  );

  // Re-parse pending upload for preview
  const pending = useMemo(() => {
    if (!mergedText.trim()) return null;
    const rawMinistries = parseMinistryTable(mergedText);
    const grandTotal = parseGrandTotal(mergedText);
    const headline = parseFiscalHeadline(mergedText);
    const ministries = enrichMinistries(rawMinistries, headline.totalExpBE ?? grandTotal.beNew);
    const receipts = parseReceiptsBreakdown(mergedText);
    const deficits = parseDeficitBlock(mergedText);
    const comesFrom = parseRupeeComesFrom(mergedText);
    const goesTo = parseRupeeGoesTo(mergedText);
    const topSchemes = parseTopSchemes(mergedText);
    const themes = extractThemes(mergedText);
    return { ministries, grandTotal, headline, receipts, deficits, comesFrom, goesTo, topSchemes, themes };
  }, [mergedText]);

  const handleFiles = useCallback(async (fs: FileList | File[]) => {
    const arr = Array.from(fs);
    setBusy(true); setError(null);
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
  }, [inMemoryTexts]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const drop = (e: DragEvent) => { prevent(e); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); };
    el.addEventListener('dragover', prevent);
    el.addEventListener('drop', drop);
    return () => { el.removeEventListener('dragover', prevent); el.removeEventListener('drop', drop); };
  }, [handleFiles]);

  // zzz248 — AUTO-SAVE on successful parse. The old flow required clicking
  // a Save button, which users missed → they kept seeing stale localStorage
  // data. Now: whenever a parse produces ≥3 ministries (basic sanity check
  // that it's a real Budget doc) AND that count exceeds what's stored for
  // the detected fiscal year, we save silently. The result: uploading a
  // Budget PDF just works. First save is a fresh insert; subsequent uploads
  // of the same FY overwrite the older parse (so re-uploading after a code
  // fix immediately replaces the broken snapshot).
  useEffect(() => {
    if (!pending) return;
    if (pending.ministries.length < 3) return;  // sanity gate
    const fy = pending.headline.yearNew;
    if (!fy || !/^\d{4}-\d{2,4}$/.test(fy)) return;
    const existing = loadYearData(fy);
    // Only overwrite when the new parse contains strictly more ministries
    // (or no existing data). This avoids clobbering a good save with a
    // partial paste.
    if (existing && existing.ministries.length >= pending.ministries.length) return;
    const data: BudgetYearData = {
      fiscalYear: fy,
      uploadedAt: new Date().toISOString(),
      documents: inMemoryFiles.map(f => ({ name: f.name, size: f.size, textLen: (inMemoryTexts[f.name] || '').length })),
      rawTexts: inMemoryTexts,
      ...pending,
    };
    saveYearData(data);
    setSavedYears(loadYearIndex());
    setActiveYear(fy);
    setDataVersion(v => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const savePending = () => {
    if (!pending) return;
    const fy = pending.headline.yearNew || prompt('Fiscal year (e.g. 2026-27):') || '';
    if (!fy || !/^\d{4}-\d{2,4}$/.test(fy)) { alert('Please enter FY as YYYY-YY, e.g. 2026-27'); return; }
    const data: BudgetYearData = {
      fiscalYear: fy,
      uploadedAt: new Date().toISOString(),
      documents: inMemoryFiles.map(f => ({ name: f.name, size: f.size, textLen: (inMemoryTexts[f.name] || '').length })),
      rawTexts: inMemoryTexts,
      ...pending,
    };
    saveYearData(data);
    setSavedYears(loadYearIndex());
    setActiveYear(fy);
    setDataVersion(v => v + 1);
    setInMemoryFiles([]); setInMemoryTexts({}); setPastedText('');
    setTab('exec');
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
    const headers = ['Ministry', 'ActualsPrev', 'BEcurrent', 'REcurrent', 'BEnew', 'DeltaVsRE_pct', 'DeltaVsRE_abs', 'DeltaVsActual_pct', 'DeltaVsActual_abs', 'DeltaVsBE_pct', 'ShareOfBudget_pct', 'Rank', 'PriorityScore', 'Category'];
    const lines = [headers.join(',')];
    for (const m of activeData.ministries) {
      lines.push([
        m.ministry, m.actualsPrev ?? '', m.bePrev ?? '', m.rePrev ?? '', m.beNew ?? '',
        m.yoyVsRE ?? '', m.absoluteDeltaRE ?? '', m.yoyVsActual ?? '', m.absoluteDeltaActual ?? '',
        m.yoyVsBE ?? '', m.shareOfBudget ?? '', m.rank, m.priorityScore, m.category,
      ].join(','));
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

  // ─ Compute rankings and derived data for the ACTIVE year ────────────
  const sortedByAbsUp = useMemo(() => activeData ? [...activeData.ministries].filter(m => (m.absoluteDeltaRE ?? 0) > 0).sort((a, b) => (b.absoluteDeltaRE || 0) - (a.absoluteDeltaRE || 0)) : [], [activeData]);
  const sortedByAbsDown = useMemo(() => activeData ? [...activeData.ministries].filter(m => (m.absoluteDeltaRE ?? 0) < 0).sort((a, b) => (a.absoluteDeltaRE || 0) - (b.absoluteDeltaRE || 0)) : [], [activeData]);
  const sortedByPctUp = useMemo(() => activeData ? [...activeData.ministries].filter(m => (m.yoyVsRE ?? 0) > 0).sort((a, b) => (b.yoyVsRE || 0) - (a.yoyVsRE || 0)) : [], [activeData]);
  const sortedByPctDown = useMemo(() => activeData ? [...activeData.ministries].filter(m => (m.yoyVsRE ?? 0) < 0).sort((a, b) => (a.yoyVsRE || 0) - (b.yoyVsRE || 0)) : [], [activeData]);
  const priorityRanked = useMemo(() => activeData ? [...activeData.ministries].sort((a, b) => b.priorityScore - a.priorityScore) : [], [activeData]);
  const fq = useMemo(() => activeData ? fiscalQualityScore(activeData.headline, activeData.grandTotal, activeData.deficits, activeData.receipts) : null, [activeData]);
  const aiSummary = useMemo(() => activeData ? buildAISummary(activeData) : '', [activeData]);
  const sectorPlays = useMemo<SectorPlay[]>(() => {
    if (!activeData) return [];
    return activeData.ministries
      .filter(m => SECTOR_MAP[m.ministry])
      .map(m => {
        const yoy = m.yoyVsRE ?? m.yoyVsActual ?? 0;
        return {
          sector: SECTOR_MAP[m.ministry].sector,
          ministry: m.ministry,
          direction: yoy > 3 ? 'up' as const : yoy < -3 ? 'down' as const : 'flat' as const,
          yoyPct: yoy, stocks: SECTOR_MAP[m.ministry].stocks,
        };
      })
      .sort((a, b) => b.yoyPct - a.yoyPct);
  }, [activeData]);

  // Cross-year data
  const allYearsData = useMemo(() => savedYears.map(y => loadYearData(y)).filter((d): d is BudgetYearData => !!d).sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear)), [savedYears]);

  // ─ Styling helpers ──────────────────────────────────────────────────
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
    padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800,
    background: active ? 'linear-gradient(90deg, #60A5FA, #22D3EE)' : 'var(--mc-bg-2)',
    color: active ? '#0B1220' : TEXT, border: active ? 'none' : '1px solid var(--mc-bg-4)',
    cursor: 'pointer', letterSpacing: '0.3px',
  });

  // Ranking row display
  const RankRow = ({ n, m, absMode }: { n: number; m: EnrichedMinistry; absMode: boolean }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed var(--mc-bg-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: DIM, fontWeight: 800, width: 20 }}>#{n}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', color: TEXT }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>{m.ministry}</div>
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{fmtCr(m.rePrev)} → {fmtCr(m.beNew)}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' as const }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' as const }}>
          {absMode ? fmtDelta(m.absoluteDeltaRE) : fmtPct(m.yoyVsRE)}
        </div>
        <div style={{ fontSize: 10, color: DIM }}>{absMode ? fmtPct(m.yoyVsRE) : fmtDelta(m.absoluteDeltaRE)}</div>
      </div>
    </div>
  );

  // Heatmap cell
  const heatColor = (yoy: number): string => {
    if (yoy >= 15) return '#065F46';
    if (yoy >= 5) return '#10B981';
    if (yoy >= 0) return '#84CC16';
    if (yoy >= -5) return '#FBBF24';
    if (yoy >= -15) return '#F59E0B';
    return '#EF4444';
  };

  // Bar chart card
  const barCard = (data: EnrichedMinistry[], year: string) => {
    if (!data.length) return null;
    const top = [...data].sort((a, b) => (b.beNew || 0) - (a.beNew || 0)).slice(0, 15);
    const max = Math.max(...top.map(m => m.beNew || 0));
    return (
      <div style={CARD}>
        <div style={H}>📊 Top 15 ministries by allocation ({year} BE)</div>
        <div>
          {top.map(m => (
            <div key={m.ministry} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: TEXT, fontWeight: 700, cursor: 'pointer' }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>{m.ministry}</span>
                <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' as const }}>
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

  const empty = !activeData;
  const showTabs = !!activeData;

  // Ministry drill-down data
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

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>📊 Budget Intel</h1>
            <div style={{ marginTop: 4, fontSize: 12.5, color: DIM }}>
              Institutional-grade Union Budget analytics. Uploads persist by fiscal year in your browser — refresh doesn't lose work.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {savedYears.length > 0 && (
              <>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>Year:</label>
                <select
                  value={activeYear} onChange={(e) => setActiveYear(e.target.value)}
                  style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 800 }}
                >
                  {savedYears.map(y => <option key={y} value={y}>FY {y}</option>)}
                </select>
                <button onClick={exportCSV} style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⬇ CSV</button>
                <button onClick={exportJSON} style={{ background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', color: TEXT, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⬇ JSON</button>
                <button onClick={clearActiveYear} style={{ background: 'transparent', border: '1px solid var(--mc-bearish)', color: 'var(--mc-bearish)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🗑</button>
              </>
            )}
          </div>
        </div>

        {/* UPLOAD ZONE */}
        <div
          ref={dropRef}
          style={{ ...CARD, border: '2px dashed color-mix(in srgb, #60A5FA 50%, transparent)', padding: '20px 20px', cursor: 'pointer', background: 'color-mix(in srgb, #60A5FA 4%, transparent)' }}
          onClick={() => (document.getElementById('budget-file-input') as HTMLInputElement)?.click()}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <div style={{ fontSize: 22 }}>📥</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Drop Budget PDF / DOCX — Speech + at-a-Glance + Expenditure + Receipts</div>
              <div style={{ fontSize: 11.5, color: DIM }}>Everything merges into one brief. Uploads persist across refresh.</div>
            </div>
          </div>
          {busy && <div style={{ marginTop: 10, fontSize: 12, color: '#F59E0B', fontWeight: 700, textAlign: 'center' as const }}>Extracting text…</div>}
          {error && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--mc-bearish)', textAlign: 'center' as const }}>{error}</div>}
          {inMemoryFiles.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
              {inMemoryFiles.map(f => (
                <span key={f.name} style={{ fontSize: 11, padding: '3px 10px', background: 'color-mix(in srgb, #10B981 15%, transparent)', border: '1px solid color-mix(in srgb, #10B981 40%, transparent)', color: '#10B981', borderRadius: 6, fontWeight: 700 }}>
                  📄 {f.name}
                </span>
              ))}
              {pending && (
                <button
                  onClick={(e) => { e.stopPropagation(); savePending(); }}
                  style={{ background: '#10B981', color: '#0B1220', border: 'none', padding: '6px 16px', borderRadius: 6, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', marginLeft: 8 }}
                >
                  💾 Save as FY {pending.headline.yearNew || '?'}
                </button>
              )}
            </div>
          )}
          <input id="budget-file-input" type="file" multiple accept=".pdf,.txt,.md,.docx" style={{ display: 'none' }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>

        {/* Paste fallback */}
        <details style={{ ...CARD, padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: DIM, fontWeight: 700 }}>📋 Or paste raw text</summary>
          <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} placeholder="Paste budget text — parsed alongside uploads."
            style={{ marginTop: 8, width: '100%', minHeight: 100, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 10, color: TEXT, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
        </details>

        {empty && !pending && (
          <div style={{ ...CARD, padding: '40px 20px', textAlign: 'center' as const, color: DIM }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 14 }}>Upload a Budget PDF to unlock the institutional dashboard.</div>
          </div>
        )}

        {/* Pending upload preview */}
        {pending && !activeData && (
          <div style={CARD}>
            <div style={H}>🔎 Preview — this parse hasn't been saved yet. Click "Save as FY" above to persist.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <KV label="FY detected" value={pending.headline.yearNew || 'unknown'} color="#F59E0B" />
              <KV label="Ministries parsed" value={pending.ministries.length} />
              <KV label="Total budget" value={fmtCr(pending.headline.totalExpBE ?? pending.grandTotal.beNew)} color="#22D3EE" />
              <KV label="Themes detected" value={pending.themes.length} />
            </div>
          </div>
        )}

        {/* zzz248 — DIAGNOSTIC BAR. Prominently shows what the parser extracted
            from the active year's stored data. If any count is 0, that
            module is broken and the user knows immediately — no silent
            "everything blank because parser failed" mystery. */}
        {activeData && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, fontSize: 11 }}>
            <span style={{ color: DIM, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.4px' }}>Parsed:</span>
            {[
              ['Ministries', activeData.ministries.length],
              ['Total Exp', activeData.headline.totalExpBE || activeData.grandTotal.beNew ? '✓' : 0],
              ['Deficits', [activeData.deficits.fiscalDeficit, activeData.deficits.revenueDeficit, activeData.deficits.primaryDeficit].filter(x => x != null).length],
              ['Receipts lines', Object.values(activeData.receipts).filter(v => typeof v === 'number').length],
              ['Rupee-from slices', activeData.comesFrom.length],
              ['Rupee-to slices', activeData.goesTo.length],
              ['Top schemes', activeData.topSchemes.length],
              ['Themes', activeData.themes.length],
            ].map(([label, n]) => (
              <span key={label as string} style={{
                padding: '3px 8px', borderRadius: 4,
                background: (typeof n === 'number' && n > 0) || n === '✓' ? 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)',
                color: (typeof n === 'number' && n > 0) || n === '✓' ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
                fontWeight: 800,
              }}>
                {label}: {n}
              </span>
            ))}
          </div>
        )}

        {/* TABS */}
        {showTabs && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--mc-bg-3)', paddingBottom: 8 }}>
            <button style={tabStyle(tab === 'exec')} onClick={() => setTab('exec')}>🎯 Executive Summary</button>
            <button style={tabStyle(tab === 'info')} onClick={() => setTab('info')}>📋 Key Info</button>
            <button style={tabStyle(tab === 'analytics')} onClick={() => setTab('analytics')}>📈 Analytics & Rankings</button>
            <button style={tabStyle(tab === 'ministry')} onClick={() => setTab('ministry')}>🏛 Ministry Deep-Dive</button>
          </div>
        )}

        {/* ═════════════ TAB · EXECUTIVE SUMMARY ═════════════ */}
        {showTabs && tab === 'exec' && activeData && (
          <>
            {/* AI summary */}
            <div style={CARD}>
              <div style={H}>🤖 AI-generated executive briefing — FY {activeData.fiscalYear}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.7, color: TEXT }}
                   dangerouslySetInnerHTML={{ __html: aiSummary.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
            </div>

            {/* Score cards row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
              <KV label="Total Expenditure BE" value={fmtCr(activeData.headline.totalExpBE ?? activeData.grandTotal.beNew)} sub={`vs prior ${fmtPct(pct(activeData.grandTotal.beNew, activeData.grandTotal.rePrev))}`} color="#22D3EE" />
              <KV label="Capital Expenditure" value={fmtCr(activeData.headline.totalCapExBE)} sub={activeData.headline.totalCapExBE && (activeData.headline.totalExpBE ?? activeData.grandTotal.beNew) ? `${((activeData.headline.totalCapExBE / (activeData.headline.totalExpBE ?? activeData.grandTotal.beNew ?? 1)) * 100).toFixed(1)}% of total` : ''} color="#10B981" />
              <KV label="Fiscal Deficit" value={fmtCr(activeData.deficits.fiscalDeficit)} color="#EF4444" />
              <KV label="Fiscal Quality Score" value={`${fq?.score ?? '—'}/100`} sub={fq && fq.score >= 70 ? 'strong quality' : fq && fq.score >= 50 ? 'balanced' : 'watch'} color={fq && fq.score >= 70 ? 'var(--mc-bullish)' : fq && fq.score >= 50 ? '#F59E0B' : 'var(--mc-bearish)'} />
            </div>

            {/* Priority Score ranking */}
            <div style={CARD}>
              <div style={H}>🎯 Government Priority Score — Ministry ranking (composite)</div>
              <div style={{ fontSize: 11, color: DIM, marginBottom: 12 }}>
                Score = 50 base + growth (±20) + rank bonus (up to 15) + scale bonus (up to 10) + sustained-growth bonus − cut penalty. Higher = higher revealed priority in this Budget.
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
                  </div>
                ))}
              </div>
            </div>

            {/* Winners + Losers side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
              <div style={CARD}>
                <div style={H}>🏆 Biggest Winners — ₹ increase vs RE</div>
                {sortedByAbsUp.slice(0, 6).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)}
              </div>
              <div style={CARD}>
                <div style={H}>💔 Biggest Cuts — ₹ decrease vs RE</div>
                {sortedByAbsDown.length ? sortedByAbsDown.slice(0, 6).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)
                  : <div style={{ fontSize: 12, color: DIM }}>No ministry cut vs current RE</div>}
              </div>
            </div>

            {/* Sector heatmap */}
            <div style={CARD}>
              <div style={H}>🌡 Ministry heatmap — allocation Δ vs RE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                {activeData.ministries.map(m => (
                  <div key={m.ministry}
                    onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}
                    style={{ padding: 10, background: heatColor(m.yoyVsRE ?? 0), borderRadius: 8, cursor: 'pointer', color: (m.yoyVsRE ?? 0) >= 0 && (m.yoyVsRE ?? 0) < 5 ? '#0B1220' : 'white' }}>
                    <div style={{ fontSize: 11, fontWeight: 800 }}>{m.ministry}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, marginTop: 3 }}>{fmtPct(m.yoyVsRE)}</div>
                    <div style={{ fontSize: 10, opacity: 0.85 }}>{fmtCr(m.beNew)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 10, color: DIM, marginTop: 10, alignItems: 'center' }}>
                <span>Legend:</span>
                {[['≥+15%','#065F46'],['+5–15%','#10B981'],['0–5%','#84CC16'],['−5–0%','#FBBF24'],['−15%','#F59E0B'],['<−15%','#EF4444']].map(([l,c]) => (
                  <span key={l as string} style={{ padding: '2px 6px', background: c as string, borderRadius: 3, color: 'white', fontWeight: 700 }}>{l}</span>
                ))}
              </div>
            </div>

            {/* Fiscal Quality decomposition */}
            {fq && fq.parts.length > 0 && (
              <div style={CARD}>
                <div style={H}>⚖ Fiscal Quality decomposition</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {fq.parts.map(p => (
                    <div key={p.label} style={{ padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>{p.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, color: '#22D3EE' }}>+{p.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═════════════ TAB · KEY INFO ═════════════ */}
        {showTabs && tab === 'info' && activeData && (
          <>
            {(activeData.headline.totalExpBE || activeData.grandTotal.beNew) && (
              <div>
                <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>🇮🇳 FISCAL HEADLINE — FY {activeData.fiscalYear} BE</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <KV label="Total Expenditure BE" value={fmtCr(activeData.headline.totalExpBE ?? activeData.grandTotal.beNew)} />
                  <KV label="Total Capital Expenditure" value={fmtCr(activeData.headline.totalCapExBE)} sub={activeData.headline.effectiveCapExBE ? `Effective ${fmtCr(activeData.headline.effectiveCapExBE)}` : ''} color="#22D3EE" />
                  <KV label="Interest Payments" value={fmtCr(activeData.headline.interestPayments)} color="#F59E0B" />
                  <KV label="Prior FY Actuals total" value={fmtCr(activeData.grandTotal.actualsPrev)} sub={activeData.grandTotal.actualsPrev && activeData.grandTotal.beNew ? `${fmtPct(pct(activeData.grandTotal.beNew, activeData.grandTotal.actualsPrev))} growth` : ''} />
                </div>
              </div>
            )}

            {(activeData.deficits.fiscalDeficit || activeData.deficits.revenueDeficit) && (
              <div>
                <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>📉 DEFICIT BLOCK</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <KV label="Fiscal Deficit" value={fmtCr(activeData.deficits.fiscalDeficit)} color="#EF4444" />
                  <KV label="Revenue Deficit" value={fmtCr(activeData.deficits.revenueDeficit)} color="#F59E0B" />
                  <KV label="Effective Rev Deficit" value={fmtCr(activeData.deficits.effectiveRevenueDeficit)} />
                  <KV label="Primary Deficit" value={fmtCr(activeData.deficits.primaryDeficit)} />
                </div>
              </div>
            )}

            {(activeData.receipts.revenueReceipts || activeData.receipts.taxRevenue) && (
              <div style={CARD}>
                <div style={H}>💰 Receipts breakdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {([
                    ['Revenue\s+Receipts', activeData.receipts.revenueReceipts, activeData.receipts.yoyBEvsActual.revenueReceipts],
                    ['Tax Revenue (net)', activeData.receipts.taxRevenue, activeData.receipts.yoyBEvsActual.taxRevenue],
                    ['Non-Tax Revenue', activeData.receipts.nonTaxRevenue, activeData.receipts.yoyBEvsActual.nonTaxRevenue],
                    ['Capital Receipts', activeData.receipts.capitalReceipts, activeData.receipts.yoyBEvsActual.capitalReceipts],
                    ['Recovery of Loans', activeData.receipts.loanRecovery, activeData.receipts.yoyBEvsActual.loanRecovery],
                    ['Other Receipts (disinvest.)', activeData.receipts.otherReceipts, activeData.receipts.yoyBEvsActual.otherReceipts],
                    ['Borrowings (net)', activeData.receipts.borrowings, activeData.receipts.yoyBEvsActual.borrowings],
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

            {activeData.ministries.length > 0 && (
              <div style={CARD}>
                <div style={H}>📚 Ministry table — rich calculated view</div>
                <div style={{ overflowX: 'auto' as const }}>
                  <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' as const }}>
                    <thead>
                      <tr style={{ color: DIM }}>
                        <th style={{ textAlign: 'left', padding: '6px 6px' }}>#</th>
                        <th style={{ textAlign: 'left', padding: '6px 6px' }}>Ministry</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>Actuals</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>BE cur</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>RE cur</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>BE new</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>Δ vs RE ₹</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>Δ vs RE %</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>Δ vs Actual</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>Share</th>
                        <th style={{ padding: '6px 6px', textAlign: 'right' as const }}>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeData.ministries.map(m => (
                        <tr key={m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)', cursor: 'pointer' }} onClick={() => { setSelectedMinistry(m.ministry); setTab('ministry'); }}>
                          <td style={{ padding: '5px 6px', color: DIM }}>{m.rank}</td>
                          <td style={{ padding: '5px 6px', fontWeight: 700 }}>{m.ministry}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(m.actualsPrev)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, color: DIM }}>{fmtCr(m.bePrev)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const }}>{fmtCr(m.rePrev)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, fontWeight: 800 }}>{fmtCr(m.beNew)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, fontWeight: 700, color: (m.absoluteDeltaRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtDelta(m.absoluteDeltaRE)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, fontWeight: 800, color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsRE)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, color: (m.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsActual)}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const }}>{m.shareOfBudget != null ? `${m.shareOfBudget}%` : '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' as const, fontWeight: 800, color: m.priorityScore >= 70 ? 'var(--mc-bullish)' : m.priorityScore >= 50 ? '#F59E0B' : 'var(--mc-bearish)' }}>{m.priorityScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 6 }}>Click any row to open the Ministry Deep-Dive.</div>
              </div>
            )}

            {activeData.topSchemes.length > 0 && (
              <div style={CARD}>
                <div style={H}>🏗 Top scheme allocations (sub-ministry level, top 30 by BE)</div>
                <div style={{ overflowX: 'auto' as const }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' as const }}>
                    <thead>
                      <tr style={{ color: DIM }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Scheme</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' as const }}>RE cur</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' as const }}>BE new</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' as const }}>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeData.topSchemes.map(s => (
                        <tr key={s.name} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                          <td style={{ padding: '6px 8px' }}>{s.name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, color: DIM, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(s.rePrev)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontWeight: 800 }}>{fmtCr(s.beNew)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontWeight: 800, color: (s.delta ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(s.delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {Object.keys(activeData.rawTexts).length > 0 && (
              <div style={CARD}>
                <div style={H}>📄 Raw extraction preview</div>
                {Object.entries(activeData.rawTexts).map(([name, text]) => (
                  <details key={name} style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: 'pointer', color: '#60A5FA', fontWeight: 700, fontSize: 12 }}>{name} · {text.length.toLocaleString('en-IN')} chars</summary>
                    <pre style={{ fontSize: 10.5, color: DIM, whiteSpace: 'pre-wrap' as const, marginTop: 6, maxHeight: 300, overflowY: 'auto' as const, background: 'var(--mc-bg-2)', padding: 10, borderRadius: 6 }}>{text.slice(0, 3500)}{text.length > 3500 ? '…' : ''}</pre>
                  </details>
                ))}
              </div>
            )}

            {/* zzz250 — DEBUG PANEL. Shows what each parser saw, so any
                remaining failure is instantly visible without me guessing. */}
            {Object.keys(activeData.rawTexts).length > 0 && (
              <div style={CARD}>
                <div style={H}>🔧 Parser debug (screenshot me this if data is empty)</div>
                {(() => {
                  const fullText = Object.values(activeData.rawTexts).join('\n\n');
                  const anchorIdx = fullText.search(/Expenditure\s+of\s+Major\s+Items/i);
                  const gtIdx = fullText.search(/Grand\s+Total/i);
                  const totalExpIdx = fullText.search(/total\s+expenditure/i);
                  const fdIdx = fullText.search(/Fiscal\s+Deficit/i);
                  const rrIdx = fullText.search(/Revenue\s+Receipts/i);
                  // Sample around anchor
                  const sampleAt = (idx: number, n = 400) => idx < 0 ? '(not found)' : fullText.slice(idx, idx + n).replace(/\s+/g, ' ');
                  const testMinistry = (label: string, pat: RegExp) => {
                    const flags = pat.flags.includes('i') ? pat.flags : pat.flags + 'i';
                    const re = new RegExp('(?:' + pat.source + ')[^\\n]{0,30}?\\s([\\d,]{4,})\\s+([\\d,]{4,})\\s+([\\d,]{4,})\\s+([\\d,]{4,})', flags);
                    const flat = fullText.replace(/[\r\t\n]/g, ' ').replace(/\s+/g, ' ');
                    const m = flat.match(re);
                    return m ? `✓ ${label}: [${m[1]}, ${m[2]}, ${m[3]}, ${m[4]}]` : `✗ ${label}: NO MATCH`;
                  };
                  const rows = [
                    ['Anchor: Expenditure of Major Items', anchorIdx >= 0 ? `found @ ${anchorIdx}` : 'NOT FOUND'],
                    ['Anchor: Grand Total', gtIdx >= 0 ? `found @ ${gtIdx}` : 'NOT FOUND'],
                    ['Anchor: total expenditure', totalExpIdx >= 0 ? `found @ ${totalExpIdx}` : 'NOT FOUND'],
                    ['Anchor: Fiscal Deficit', fdIdx >= 0 ? `found @ ${fdIdx}` : 'NOT FOUND'],
                    ['Anchor: Revenue Receipts', rrIdx >= 0 ? `found @ ${rrIdx}` : 'NOT FOUND'],
                  ];
                  return (
                    <div style={{ fontSize: 11, color: DIM }}>
                      {rows.map(([k, v]) => (
                        <div key={k} style={{ padding: '3px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                          <span style={{ color: TEXT, fontWeight: 700 }}>{k}:</span>{' '}
                          <span style={{ color: String(v).includes('found') ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{v}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 8, fontWeight: 700, color: TEXT }}>Sample around "Expenditure of Major Items" anchor (400 chars):</div>
                      <pre style={{ fontSize: 10, color: DIM, whiteSpace: 'pre-wrap' as const, marginTop: 4, background: 'var(--mc-bg-2)', padding: 8, borderRadius: 4, maxHeight: 150, overflowY: 'auto' as const }}>{sampleAt(anchorIdx)}</pre>
                      <div style={{ marginTop: 8, fontWeight: 700, color: TEXT }}>Sample around "total expenditure":</div>
                      <pre style={{ fontSize: 10, color: DIM, whiteSpace: 'pre-wrap' as const, marginTop: 4, background: 'var(--mc-bg-2)', padding: 8, borderRadius: 4, maxHeight: 150, overflowY: 'auto' as const }}>{sampleAt(totalExpIdx)}</pre>
                      <div style={{ marginTop: 8, fontWeight: 700, color: TEXT }}>Per-ministry regex tests:</div>
                      <div style={{ fontSize: 10, fontFamily: 'monospace', background: 'var(--mc-bg-2)', padding: 8, borderRadius: 4, marginTop: 4 }}>
                        {testMinistry('Pension', /\bPension\b/)}<br/>
                        {testMinistry('Defence', /\bDefence\b/)}<br/>
                        {testMinistry('Rural Development', /Rural\s+Development/i)}<br/>
                        {testMinistry('IT and Telecom', /IT\s+and\s+Telecom/i)}<br/>
                        {testMinistry('Interest', /\bInterest\b/)}<br/>
                        {testMinistry('Others', /\bOthers\b/)}<br/>
                      </div>

                      {/* zzz252 — FORCE RE-PARSE button. If the automatic
                          migration on hydrate is failing silently for any
                          reason, this button runs the same logic on demand
                          with visible alerts. */}
                      <button
                        onClick={() => {
                          try {
                            if (!activeData) { alert('No active data'); return; }
                            const raw = Object.values(activeData.rawTexts || {}).join('\n\n');
                            if (!raw.trim()) { alert('❌ No raw text stored (rawTexts empty). You need to re-upload the PDF.'); return; }
                            const rawMinistries = parseMinistryTable(raw);
                            if (rawMinistries.length === 0) {
                              alert(`❌ Parser returned 0 ministries.\nRaw text length: ${raw.length}\nFirst 500 chars: ${raw.slice(0, 500)}`);
                              return;
                            }
                            const gt = parseGrandTotal(raw);
                            const headline = parseFiscalHeadline(raw);
                            const enriched = enrichMinistries(rawMinistries, headline.totalExpBE ?? gt.beNew);
                            const updated: BudgetYearData = {
                              ...activeData,
                              ministries: enriched,
                              grandTotal: gt,
                              headline,
                              receipts: parseReceiptsBreakdown(raw),
                              deficits: parseDeficitBlock(raw),
                              comesFrom: parseRupeeComesFrom(raw),
                              goesTo: parseRupeeGoesTo(raw),
                              topSchemes: parseTopSchemes(raw),
                              themes: extractThemes(raw),
                            };
                            saveYearData(updated);
                            setDataVersion(v => v + 1);
                            alert(`✓ Re-parse SUCCESS!\nMinistries: ${enriched.length}\nGrand Total BE: ${gt.beNew ?? 'null'}\nHeadline Total Exp: ${headline.totalExpBE ?? 'null'}\nDeficit: ${updated.deficits.fiscalDeficit ?? 'null'}\n\nAll tabs should now populate.`);
                          } catch (err: any) {
                            alert(`💥 EXCEPTION: ${err?.message || err}\n\nStack: ${err?.stack || 'no stack'}`);
                          }
                        }}
                        style={{
                          marginTop: 12, padding: '10px 20px', fontSize: 13, fontWeight: 800,
                          background: '#F59E0B', color: '#0B1220', border: 'none', borderRadius: 8,
                          cursor: 'pointer', letterSpacing: '0.4px',
                        }}
                      >🔄 FORCE RE-PARSE STORED TEXT NOW</button>
                      <div style={{ fontSize: 10.5, color: DIM, marginTop: 4 }}>
                        Click this if analytics tabs are empty. It runs the current parsers against your stored raw text and shows an alert with the result (or the exact exception if it fails).
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* ═════════════ TAB · ANALYTICS & RANKINGS ═════════════ */}
        {showTabs && tab === 'analytics' && activeData && (
          <>
            {/* 4 ranking blocks */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
              <div style={CARD}>
                <div style={H}>🏆 Top absolute ₹ increases (vs RE)</div>
                {sortedByAbsUp.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)}
              </div>
              <div style={CARD}>
                <div style={H}>📈 Top % increases (vs RE)</div>
                {sortedByPctUp.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode={false} />)}
              </div>
              <div style={CARD}>
                <div style={H}>💔 Top absolute ₹ cuts (vs RE)</div>
                {sortedByAbsDown.length ? sortedByAbsDown.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode />)
                  : <div style={{ fontSize: 12, color: DIM }}>No absolute cuts detected</div>}
              </div>
              <div style={CARD}>
                <div style={H}>📉 Top % cuts (vs RE)</div>
                {sortedByPctDown.length ? sortedByPctDown.slice(0, 10).map((m, i) => <RankRow key={m.ministry} n={i + 1} m={m} absMode={false} />)
                  : <div style={{ fontSize: 12, color: DIM }}>No % cuts detected</div>}
              </div>
            </div>

            {barCard(activeData.ministries, activeData.fiscalYear)}

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
                    <div key={sp.sector} style={{ padding: 12, background: 'var(--mc-bg-2)', border: `1px solid ${sp.direction === 'up' ? 'color-mix(in srgb, var(--mc-bullish) 40%, transparent)' : sp.direction === 'down' ? 'color-mix(in srgb, var(--mc-bearish) 40%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{sp.sector}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: sp.direction === 'up' ? 'var(--mc-bullish)' : sp.direction === 'down' ? 'var(--mc-bearish)' : DIM }}>
                          {sp.direction === 'up' ? '▲' : sp.direction === 'down' ? '▼' : '—'} {fmtPct(sp.yoyPct)}
                        </div>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginBottom: 8 }}>Trigger: <span style={{ cursor: 'pointer', color: '#60A5FA' }} onClick={() => { setSelectedMinistry(sp.ministry); setTab('ministry'); }}>{sp.ministry}</span></div>
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

            {activeData.themes.length > 0 && (
              <div style={CARD}>
                <div style={H}>🔍 Narrative themes</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                  {activeData.themes.map(t => (
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

        {/* ═════════════ TAB · MINISTRY DEEP-DIVE ═════════════ */}
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
                    }}>{m.ministry}</button>
                ))}
              </div>
            </div>

            {!selectedMinistry && (
              <div style={{ ...CARD, textAlign: 'center' as const, color: DIM, padding: '40px 20px' }}>
                Select a ministry above to see history, allocations, and linked stocks.
              </div>
            )}

            {drillMinistry && (
              <>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>{drillMinistry.ministry}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                    <KV label="BE new" value={fmtCr(drillMinistry.beNew)} color="var(--mc-text-0)" />
                    <KV label="Δ vs RE" value={`${fmtDelta(drillMinistry.absoluteDeltaRE)} · ${fmtPct(drillMinistry.yoyVsRE)}`} color={(drillMinistry.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
                    <KV label="Δ vs Actuals" value={`${fmtDelta(drillMinistry.absoluteDeltaActual)} · ${fmtPct(drillMinistry.yoyVsActual)}`} color={(drillMinistry.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'} />
                    <KV label="Share of budget" value={drillMinistry.shareOfBudget != null ? `${drillMinistry.shareOfBudget}%` : '—'} />
                    <KV label="Rank" value={`#${drillMinistry.rank} of ${activeData.ministries.length}`} />
                    <KV label="Priority Score" value={`${drillMinistry.priorityScore}/100`} color={drillMinistry.priorityScore >= 70 ? 'var(--mc-bullish)' : drillMinistry.priorityScore >= 50 ? '#F59E0B' : 'var(--mc-bearish)'} />
                  </div>
                </div>

                {/* Multi-year history if available */}
                {drillHistory.length > 1 && (
                  <div style={CARD}>
                    <div style={H}>📈 Multi-year allocation history</div>
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto' as const, padding: '4px 0' }}>
                      {drillHistory.map(x => (
                        <div key={x.year} style={{ minWidth: 140, padding: 10, background: 'var(--mc-bg-2)', borderRadius: 8, textAlign: 'center' as const }}>
                          <div style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>FY {x.year}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{fmtCr(x.m.beNew)}</div>
                          <div style={{ fontSize: 11, color: (x.m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{fmtPct(x.m.yoyVsRE)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detailed table */}
                <div style={CARD}>
                  <div style={H}>📊 Full breakdown — {drillMinistry.ministry}</div>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' as const }}>
                    <tbody>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Prior FY Actuals</td><td style={{ padding: 6, textAlign: 'right' as const, fontWeight: 700 }}>{fmtCr(drillMinistry.actualsPrev)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Current FY BE</td><td style={{ padding: 6, textAlign: 'right' as const }}>{fmtCr(drillMinistry.bePrev)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Current FY RE</td><td style={{ padding: 6, textAlign: 'right' as const }}>{fmtCr(drillMinistry.rePrev)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>New FY BE</td><td style={{ padding: 6, textAlign: 'right' as const, fontWeight: 900 }}>{fmtCr(drillMinistry.beNew)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Δ vs current RE</td><td style={{ padding: 6, textAlign: 'right' as const, color: (drillMinistry.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 800 }}>{fmtDelta(drillMinistry.absoluteDeltaRE)} · {fmtPct(drillMinistry.yoyVsRE)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Δ vs prior BE</td><td style={{ padding: 6, textAlign: 'right' as const, color: (drillMinistry.yoyVsBE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(drillMinistry.yoyVsBE)}</td></tr>
                      <tr style={{ borderTop: '1px dashed var(--mc-bg-3)' }}><td style={{ padding: 6, color: DIM }}>Δ vs prior Actuals</td><td style={{ padding: 6, textAlign: 'right' as const, color: (drillMinistry.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtDelta(drillMinistry.absoluteDeltaActual)} · {fmtPct(drillMinistry.yoyVsActual)}</td></tr>
                    </tbody>
                  </table>
                </div>

                {/* Sector map */}
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

                {/* Related schemes */}
                {activeData.topSchemes.length > 0 && (
                  <div style={CARD}>
                    <div style={H}>🏗 Schemes overlap (top-30 by BE, filtered by ministry keyword)</div>
                    {(() => {
                      const key = drillMinistry.ministry.split(' ')[0];
                      const rel = activeData.topSchemes.filter(s => s.name.toLowerCase().includes(key.toLowerCase()) || (drillMinistry.ministry === 'Rural Development' && /rural|MGNREGA|PM-?KISAN|Awas/i.test(s.name)) || (drillMinistry.ministry === 'Urban Development' && /urban|PMAY|Metro|Smart/i.test(s.name)));
                      return rel.length ? (
                        <div>
                          {rel.map(s => (
                            <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px dashed var(--mc-bg-3)' }}>
                              <span style={{ fontSize: 12 }}>{s.name}</span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: (s.delta ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtCr(s.beNew)} · {fmtPct(s.delta)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <div style={{ fontSize: 12, color: DIM }}>No obvious scheme overlap in top-30. Use Key Info tab to browse all schemes.</div>;
                    })()}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeData && (
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', textAlign: 'center' as const, padding: '8px 0' }}>
            All numbers extracted verbatim from the Ministry of Finance PDFs. Calculated columns derive from the source figures. Sector-play stock lists are historical beneficiary heuristics, not recommendations. Data persists in your browser (localStorage) — export CSV/JSON to preserve across devices.
          </div>
        )}

      </div>
    </div>
  );
}
