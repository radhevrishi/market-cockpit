'use client';

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET INTEL (zzz243)
// Reads Indian Union Budget documents (Budget-at-a-Glance, Budget Highlights,
// Expenditure Statement, Explanatory Memorandum) in PDF format and produces
// an institutional-grade allocation brief:
//   • Ministry-level YoY winners & losers (BE next FY vs Actuals prior FY,
//     and vs current-year Revised Estimates)
//   • Fiscal headline chips (Total Exp, CapEx, Fiscal Deficit)
//   • Sector-play matrix mapping ministry allocation shifts → listed Indian
//     stocks that historically ride those shifts
//   • Narrative theme extractor (reforms, PLI, defence indigenisation,
//     rural, infrastructure keywords)
//   • Multi-file support — upload Budget-at-a-Glance + Highlights + any
//     supporting deck and everything gets merged into one brief
//
// Parsing is 100% client-side using pdfjs-dist loaded from CDN at runtime
// (no npm dep change, no build regeneration). DOC/PPT uploads are surfaced
// with a "paste text" fallback because desktop-office formats can't be
// parsed reliably in the browser.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────
type MinistryRow = {
  ministry: string;
  actualsPrev: number | null;  // FY24-25 Actuals (or whatever the prior FY column is)
  bePrev: number | null;       // FY25-26 BE
  rePrev: number | null;       // FY25-26 RE
  beNew: number | null;        // FY26-27 BE
  yoyVsRE: number | null;      // % change: beNew vs rePrev
  yoyVsActual: number | null;  // % change: beNew vs actualsPrev
};
type FiscalHeadline = {
  totalExpBE: number | null;
  totalExpRE: number | null;
  totalCapExBE: number | null;
  totalCapExRE: number | null;
  effectiveCapExBE: number | null;
  interestPayments: number | null;
  fiscalDeficit: number | null;
  yearNew: string;
  yearPrev: string;
};
type SectorPlay = {
  sector: string;
  ministries: string[];
  direction: 'up' | 'down' | 'flat';
  yoyPct: number;
  stocks: { ticker: string; name: string; rationale: string }[];
};

// ─── Ministry → sector-play mapping ────────────────────────────────────────
// Every listed name here is a well-known Indian mid/large cap that the market
// has historically re-rated on the direction of that ministry's outlay.
const SECTOR_MAP: Record<string, { sector: string; stocks: { ticker: string; name: string; rationale: string }[] }> = {
  'Defence': {
    sector: 'Defence & Aerospace',
    stocks: [
      { ticker: 'HAL', name: 'Hindustan Aeronautics', rationale: 'Fighter engines, Tejas MK-1A order book' },
      { ticker: 'BEL', name: 'Bharat Electronics', rationale: 'Radar, avionics, missile electronics' },
      { ticker: 'MAZDOCK', name: 'Mazagon Dock Shipbuilders', rationale: 'Submarines, warships' },
      { ticker: 'BDL', name: 'Bharat Dynamics', rationale: 'Missiles, torpedoes' },
      { ticker: 'ASTRAMICRO', name: 'Astra Microwave', rationale: 'Radar sub-systems' },
      { ticker: 'DATAPATTNS', name: 'Data Patterns', rationale: 'Electronic warfare, radar' },
      { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Optics, drones' },
    ],
  },
  'Transport': {
    sector: 'Roads, Rail, Ports, Logistics',
    stocks: [
      { ticker: 'LT', name: 'Larsen & Toubro', rationale: 'Bellwether infra EPC' },
      { ticker: 'IRB', name: 'IRB Infra', rationale: 'BOT road toll operator' },
      { ticker: 'KNRCON', name: 'KNR Constructions', rationale: 'Roads EPC pure-play' },
      { ticker: 'GRINFRA', name: 'G R Infra', rationale: 'HAM roads' },
      { ticker: 'IRCON', name: 'Ircon International', rationale: 'Railway construction' },
      { ticker: 'RVNL', name: 'Rail Vikas Nigam', rationale: 'Railway EPC arm' },
      { ticker: 'TITAGARH', name: 'Titagarh Rail', rationale: 'Wagon + metro' },
      { ticker: 'BEML', name: 'BEML Ltd', rationale: 'Metro coaches, defence vehicles' },
      { ticker: 'CONCOR', name: 'Container Corp', rationale: 'Rail logistics beneficiary' },
      { ticker: 'JSWINFRA', name: 'JSW Infrastructure', rationale: 'Ports capacity build-out' },
      { ticker: 'ADANIPORTS', name: 'Adani Ports & SEZ', rationale: 'Largest listed port operator' },
    ],
  },
  'Rural Development': {
    sector: 'Rural, Agri, Tractors, Consumer',
    stocks: [
      { ticker: 'M&M', name: 'Mahindra & Mahindra', rationale: 'Tractors + rural SUV' },
      { ticker: 'ESCORTS', name: 'Escorts Kubota', rationale: 'Tractors pure-play' },
      { ticker: 'HEROMOTOCO', name: 'Hero MotoCorp', rationale: 'Rural 2W leader' },
      { ticker: 'DABUR', name: 'Dabur India', rationale: 'Rural FMCG' },
      { ticker: 'HINDUNILVR', name: 'Hindustan Unilever', rationale: 'FMCG rural mix' },
      { ticker: 'JYOTHYLAB', name: 'Jyothy Labs', rationale: 'Rural detergents' },
      { ticker: 'COROMANDEL', name: 'Coromandel Intl', rationale: 'Fertiliser subsidy' },
    ],
  },
  'Agriculture': {
    sector: 'Agri Inputs, Irrigation, Food',
    stocks: [
      { ticker: 'UPL', name: 'UPL Ltd', rationale: 'Agrochemicals' },
      { ticker: 'BAYERCROP', name: 'Bayer CropScience', rationale: 'Seeds + crop protection' },
      { ticker: 'PIIND', name: 'PI Industries', rationale: 'Contract manufacturing agri' },
      { ticker: 'DHANUKA', name: 'Dhanuka Agritech', rationale: 'Domestic agrochem' },
      { ticker: 'KRBL', name: 'KRBL Ltd', rationale: 'Basmati exports' },
      { ticker: 'JAINSTUDIO', name: 'Jain Irrigation', rationale: 'Micro-irrigation' },
    ],
  },
  'Urban Development': {
    sector: 'Housing, Cement, Building Materials',
    stocks: [
      { ticker: 'ULTRACEMCO', name: 'UltraTech Cement', rationale: 'Cement leader' },
      { ticker: 'DALBHARAT', name: 'Dalmia Bharat', rationale: 'Cement — south/east' },
      { ticker: 'SHREECEM', name: 'Shree Cement', rationale: 'Cement north' },
      { ticker: 'PIDILITIND', name: 'Pidilite', rationale: 'Adhesives — construction beneficiary' },
      { ticker: 'ASIANPAINT', name: 'Asian Paints', rationale: 'Housing paint demand' },
      { ticker: 'KAJARIACER', name: 'Kajaria Ceramics', rationale: 'Tiles — housing' },
      { ticker: 'HAVELLS', name: 'Havells India', rationale: 'Consumer electricals' },
    ],
  },
  'Health': {
    sector: 'Healthcare, Hospitals, Pharma',
    stocks: [
      { ticker: 'APOLLOHOSP', name: 'Apollo Hospitals', rationale: 'Hospital chain' },
      { ticker: 'MAXHEALTH', name: 'Max Healthcare', rationale: 'Hospitals' },
      { ticker: 'FORTIS', name: 'Fortis Healthcare', rationale: 'Hospitals' },
      { ticker: 'CIPLA', name: 'Cipla', rationale: 'Domestic pharma' },
      { ticker: 'DRREDDY', name: "Dr Reddy's Labs", rationale: 'Domestic + US pharma' },
      { ticker: 'ERIS', name: 'Eris Lifesciences', rationale: 'Domestic branded pharma' },
      { ticker: 'THYROCARE', name: 'Thyrocare', rationale: 'Diagnostics' },
    ],
  },
  'Education': {
    sector: 'Education, EdTech, Skilling',
    stocks: [
      { ticker: 'NAVNETEDUL', name: 'Navneet Education', rationale: 'Textbooks + stationery' },
      { ticker: 'MTEDUCARE', name: 'MT Educare', rationale: 'Test prep' },
      { ticker: 'CAREERP', name: 'Career Point', rationale: 'Coaching' },
      { ticker: 'ZEELEARN', name: 'Zee Learn', rationale: 'K-12 chain' },
    ],
  },
  'Energy': {
    sector: 'Power, Renewables, Transmission',
    stocks: [
      { ticker: 'POWERGRID', name: 'Power Grid Corp', rationale: 'Transmission monopoly' },
      { ticker: 'NTPC', name: 'NTPC', rationale: 'Thermal + renewable IPP' },
      { ticker: 'NHPC', name: 'NHPC', rationale: 'Hydro' },
      { ticker: 'ADANIGREEN', name: 'Adani Green', rationale: 'Solar/wind IPP' },
      { ticker: 'TATAPOWER', name: 'Tata Power', rationale: 'Integrated utility + EV' },
      { ticker: 'SUZLON', name: 'Suzlon Energy', rationale: 'Wind OEM' },
      { ticker: 'WAAREEENER', name: 'Waaree Energies', rationale: 'Solar modules' },
    ],
  },
  'IT and Telecom': {
    sector: 'Telecom, Data, Digital Public Infra',
    stocks: [
      { ticker: 'BHARTIARTL', name: 'Bharti Airtel', rationale: 'Telecom + digital' },
      { ticker: 'VODAFONE', name: 'Vodafone Idea', rationale: 'Telecom (govt liab)' },
      { ticker: 'RCOM', name: 'Reliance Comm', rationale: 'Legacy telecom' },
      { ticker: 'STLTECH', name: 'STL Tech', rationale: 'Optical fibre' },
      { ticker: 'HFCL', name: 'HFCL Ltd', rationale: 'Fibre + defence electronics' },
    ],
  },
  'Home Affairs': {
    sector: 'Homeland Security, Border, Small Arms',
    stocks: [
      { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Border surveillance' },
      { ticker: 'ASTRAMICRO', name: 'Astra Microwave', rationale: 'Radar' },
    ],
  },
  'Commerce and Industry': {
    sector: 'PLI beneficiaries, Manufacturing, Exports',
    stocks: [
      { ticker: 'DIXON', name: 'Dixon Technologies', rationale: 'PLI electronics manufacturing' },
      { ticker: 'AMBER', name: 'Amber Enterprises', rationale: 'PLI ACs' },
      { ticker: 'KAYNES', name: 'Kaynes Technology', rationale: 'PLI EMS + semiconductor OSAT' },
      { ticker: 'SYRMA', name: 'Syrma SGS', rationale: 'PLI EMS' },
      { ticker: 'CYIENTDLM', name: 'Cyient DLM', rationale: 'EMS defence/aerospace' },
      { ticker: 'CENTUM', name: 'Centum Electronics', rationale: 'EMS defence + industrial' },
    ],
  },
  'Fertiliser': {
    sector: 'Fertiliser (subsidy beneficiaries)',
    stocks: [
      { ticker: 'COROMANDEL', name: 'Coromandel International', rationale: 'DAP/NPK' },
      { ticker: 'CHAMBLFERT', name: 'Chambal Fertilisers', rationale: 'Urea + NPK' },
      { ticker: 'GNFC', name: 'GNFC', rationale: 'Fertiliser + chemicals' },
      { ticker: 'GSFC', name: 'GSFC', rationale: 'Fertiliser' },
      { ticker: 'RCF', name: 'Rashtriya Chemicals', rationale: 'Urea + industrial chem' },
      { ticker: 'NFL', name: 'National Fertilizers', rationale: 'Urea' },
    ],
  },
  'Food': {
    sector: 'PDS, FCI, Warehousing',
    stocks: [
      { ticker: 'CONCOR', name: 'Container Corp', rationale: 'Food-grain logistics' },
      { ticker: 'KRBL', name: 'KRBL Ltd', rationale: 'Rice' },
      { ticker: 'ADANIAGRO', name: 'Adani Agri Logistics', rationale: 'Grain silos' },
    ],
  },
  'Petroleum': {
    sector: 'Oil Marketing, Cooking Fuel Subsidy',
    stocks: [
      { ticker: 'IOC', name: 'Indian Oil', rationale: 'OMC — LPG subsidy incidence' },
      { ticker: 'BPCL', name: 'BPCL', rationale: 'OMC' },
      { ticker: 'HINDPETRO', name: 'HPCL', rationale: 'OMC' },
      { ticker: 'GAIL', name: 'GAIL India', rationale: 'Gas transmission' },
    ],
  },
  'Scientific Departments': {
    sector: 'Space, Nuclear, R&D',
    stocks: [
      { ticker: 'MTAR', name: 'MTAR Technologies', rationale: 'ISRO + nuclear precision parts' },
      { ticker: 'PARAS', name: 'Paras Defence', rationale: 'Space optics' },
      { ticker: 'CENTUM', name: 'Centum Electronics', rationale: 'Space electronics' },
    ],
  },
};

// ─── Number parsing helpers ────────────────────────────────────────────────
function parseNumber(s: string): number | null {
  if (!s) return null;
  // Remove commas, whitespace, currency, weird unicode punctuation
  const cleaned = String(s).replace(/[₹Rs.,  ]/g, '').replace(/[ -⁯]/g, '');
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

// ─── PDF extraction via pdfjs-dist (CDN) ────────────────────────────────────
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

// ─── DOCX extraction via mammoth.js from CDN ────────────────────────────────
// Handles the Finance Minister's Budget Speech which comes as .docx from
// finmin.nic.in. Mammoth extracts the raw text — narrative themes flow into
// the theme extractor same as the Highlights PDF.
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

// ─── Parser — Expenditure of Major Items table ─────────────────────────────
// Recognises the standard 5-column Indian Budget-at-a-Glance row shape:
//   <Ministry name (Hindi + English)>  <ActualsPrev>  <BEcurrent>  <REcurrent>  <BEnew>
// The Hindi text is preserved intact, we only trigger off the English label.
const MINISTRY_MATCHERS: { label: string; pattern: RegExp }[] = [
  { label: 'Pension',                 pattern: /Pension\b/ },
  { label: 'Defence',                 pattern: /\bDefence\b/ },
  { label: 'Fertiliser',              pattern: /Fertili[sz]er\b/ },
  { label: 'Food',                    pattern: /\bFood\b/ },
  { label: 'Petroleum',               pattern: /\bPetroleum\b/ },
  { label: 'Agriculture',             pattern: /Agriculture and Allied|Agriculture &? Allied|^Agriculture$/i },
  { label: 'Commerce and Industry',   pattern: /Commerce and Industry|Commerce &? Industry/i },
  { label: 'Development of North East', pattern: /North\s?East/i },
  { label: 'Education',               pattern: /\bEducation\b/ },
  { label: 'Energy',                  pattern: /\bEnergy\b/ },
  { label: 'External Affairs',        pattern: /External Affairs/i },
  { label: 'Finance',                 pattern: /^Finance\b/ },
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

// Extract the ministry table by scanning for lines matching each label +
// four trailing numeric groups. Very tolerant of Hindi prefix noise.
function parseMinistryTable(rawText: string): MinistryRow[] {
  // Collapse whitespace so numbers are separated by exactly one space
  const text = rawText.replace(/[\r\t]/g, ' ').replace(/ /g, ' ');
  const lines = text.split(/\n+/);
  const rows: MinistryRow[] = [];
  for (const line of lines) {
    // Find a line that has 4 large numbers at its tail
    const numMatch = line.match(/([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s+([\d,]{4,})\s*$/);
    if (!numMatch) continue;
    // Which ministry label appears in the line?
    let matched: { label: string } | null = null;
    for (const m of MINISTRY_MATCHERS) {
      if (m.pattern.test(line)) { matched = { label: m.label }; break; }
    }
    if (!matched) continue;
    // Guard: skip totals ("Grand Total") — we want the per-ministry rows
    if (/Grand Total|कुल\s?जोड़|Total Expenditure/i.test(line)) continue;
    // Guard: dedupe (first hit per label wins — table rows are unique)
    if (rows.some(r => r.ministry === matched!.label)) continue;
    const [_, a, b, c, d] = numMatch;
    const actualsPrev = parseNumber(a);
    const bePrev = parseNumber(b);
    const rePrev = parseNumber(c);
    const beNew = parseNumber(d);
    rows.push({
      ministry: matched.label,
      actualsPrev, bePrev, rePrev, beNew,
      yoyVsRE: pct(beNew, rePrev),
      yoyVsActual: pct(beNew, actualsPrev),
    });
  }
  return rows;
}

// ─── Parser — Fiscal headline numbers ──────────────────────────────────────
function parseFiscalHeadline(rawText: string): FiscalHeadline {
  const text = rawText.replace(/\s+/g, ' ');
  const grab = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m) return null;
    return parseNumber(m[1]);
  };
  // year strings
  const yr = text.match(/BUDGET AT A GLANCE\s+(\d{4}-\d{4})/);
  const yearNew = yr ? yr[1] : '';
  const yearPrev = yearNew ? `${parseInt(yearNew.slice(0, 4)) - 1}-${parseInt(yearNew.slice(5, 9)) - 1}` : '';
  // Values from the "Budget at a Glance" table are already extracted by
  // parseMinistryTable via Grand Total etc. Here we look for narrative:
  //   "total expenditure … estimated at ₹53,47,315 crore"
  //   "total capital expenditure is ₹12,21,821 crore"
  //   "effective capital expenditure is ₹17,14,523 crore"
  const totalExpBE = grab(/total expenditure[^0-9]{0,60}₹?\s*([\d,]{5,})/i);
  const totalCapExBE = grab(/total capital expenditure[^0-9]{0,40}₹?\s*([\d,]{5,})/i);
  const effectiveCapExBE = grab(/effective capital expenditure[^0-9]{0,40}₹?\s*([\d,]{5,})/i);
  const interestPayments = grab(/Interest Payments?\s+([\d,]{5,})/);
  return {
    totalExpBE, totalExpRE: null,
    totalCapExBE, totalCapExRE: null,
    effectiveCapExBE,
    interestPayments,
    fiscalDeficit: null,
    yearNew, yearPrev,
  };
}

// ─── Narrative theme extractor ─────────────────────────────────────────────
const THEME_PATTERNS: { theme: string; icon: string; patterns: RegExp[] }[] = [
  { theme: 'Infrastructure push', icon: '🏗',
    patterns: [/infrastructure\b/i, /\bcapex\b/i, /public investment/i, /roads?\b/i, /highways?/i] },
  { theme: 'Defence indigenisation', icon: '🛡',
    patterns: [/indigeni[sz]ation/i, /Make in India.*defen[cs]e/i, /Aatmanirbhar.*defen[cs]e/i, /defen[cs]e.*procurement/i] },
  { theme: 'PLI / manufacturing', icon: '🏭',
    patterns: [/PLI\b/i, /production.linked/i, /electronics manufacturing/i, /semiconductor/i, /EMS\b/] },
  { theme: 'Rural + agri thrust', icon: '🌾',
    patterns: [/rural\b/i, /agriculture/i, /farmer/i, /MSP\b/, /PM-?KISAN/i, /Fasal Bima/i] },
  { theme: 'Renewable energy', icon: '⚡',
    patterns: [/renewable/i, /solar/i, /green hydrogen/i, /green energy/i, /battery storage/i] },
  { theme: 'Fiscal consolidation', icon: '📉',
    patterns: [/fiscal deficit.*(?:reduc|consolid|lower|glide)/i, /fiscal prudence/i, /fiscal glide path/i] },
  { theme: 'Tax simplification', icon: '📋',
    patterns: [/GST simplification/i, /new tax regime/i, /rate rationali[sz]ation/i, /tax reform/i] },
  { theme: 'Digital public infra', icon: '💻',
    patterns: [/digital public infrastructure/i, /DPI\b/, /Aadhaar/i, /UPI\b/, /ONDC\b/, /Digital India/i] },
  { theme: 'Housing / urban', icon: '🏠',
    patterns: [/PMAY\b/, /affordable housing/i, /urban develop/i, /Amrit\b/i] },
  { theme: 'Skilling & jobs', icon: '👷',
    patterns: [/skilling/i, /employ(?:ment|ability)/i, /Skill India/i, /ITI\b/, /apprentic/i] },
  { theme: 'Healthcare access', icon: '🏥',
    patterns: [/Ayushman/i, /Jan Aushadhi/i, /health insurance/i, /medical college/i] },
  { theme: 'Startups / MSME credit', icon: '🚀',
    patterns: [/startup/i, /\bMSME\b/i, /credit guarantee/i, /Mudra\b/i] },
];
function extractThemes(text: string): { theme: string; icon: string; hits: number; snippet: string }[] {
  const out: { theme: string; icon: string; hits: number; snippet: string }[] = [];
  for (const t of THEME_PATTERNS) {
    let hits = 0;
    let snippet = '';
    for (const p of t.patterns) {
      const matches = text.match(new RegExp(p.source, p.flags + 'g'));
      if (matches) {
        hits += matches.length;
        if (!snippet) {
          const m = text.match(p);
          if (m && m.index != null) {
            const start = Math.max(0, m.index - 80);
            const end = Math.min(text.length, m.index + 140);
            snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
          }
        }
      }
    }
    if (hits > 0) out.push({ theme: t.theme, icon: t.icon, hits, snippet });
  }
  return out.sort((a, b) => b.hits - a.hits);
}

// ─── React component ───────────────────────────────────────────────────────
export default function BudgetIntelPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rawTexts, setRawTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  // Merge all extracted text so parsing runs across every uploaded doc
  const mergedText = useMemo(() => Object.values(rawTexts).join('\n\n') + '\n\n' + pastedText,
    [rawTexts, pastedText]);

  const ministries = useMemo(() => parseMinistryTable(mergedText), [mergedText]);
  const headline = useMemo(() => parseFiscalHeadline(mergedText), [mergedText]);
  const themes = useMemo(() => extractThemes(mergedText), [mergedText]);

  const sectorPlays = useMemo<SectorPlay[]>(() => {
    const out: SectorPlay[] = [];
    for (const m of ministries) {
      const map = SECTOR_MAP[m.ministry];
      if (!map) continue;
      const yoy = m.yoyVsRE ?? m.yoyVsActual ?? 0;
      out.push({
        sector: map.sector,
        ministries: [m.ministry],
        direction: yoy > 3 ? 'up' : yoy < -3 ? 'down' : 'flat',
        yoyPct: yoy,
        stocks: map.stocks,
      });
    }
    return out.sort((a, b) => b.yoyPct - a.yoyPct);
  }, [ministries]);

  const winners = useMemo(() => ministries.filter(m => (m.yoyVsRE ?? 0) > 0).sort((a, b) => (b.yoyVsRE || 0) - (a.yoyVsRE || 0)), [ministries]);
  const losers = useMemo(() => ministries.filter(m => (m.yoyVsRE ?? 0) < 0).sort((a, b) => (a.yoyVsRE || 0) - (b.yoyVsRE || 0)), [ministries]);

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
        } else if (ext === 'doc' || ext === 'ppt' || ext === 'pptx') {
          setError(`${f.name}: legacy ${ext.toUpperCase()} format — please save as PDF or DOCX and re-upload, or paste text below.`);
        } else {
          setError(`${f.name}: unsupported file type — try PDF, DOCX, or paste text below.`);
        }
      }
      setFiles(arr);
      setRawTexts(next);
    } finally { setBusy(false); }
  }, [rawTexts]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const drop = (e: DragEvent) => {
      prevent(e);
      const dt = e.dataTransfer;
      if (dt?.files && dt.files.length) handleFiles(dt.files);
    };
    el.addEventListener('dragover', prevent);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragover', prevent);
      el.removeEventListener('drop', drop);
    };
  }, [handleFiles]);

  // ─ Styling ──────────────────────────────────────────────────────────────
  const BG = 'var(--mc-bg-0)';
  const TEXT = 'var(--mc-text-0)';
  const DIM = 'var(--mc-text-3)';
  const CARD = { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 12, padding: '18px 20px' };
  const H = { fontSize: 12, fontWeight: 800, color: '#60A5FA', letterSpacing: '0.5px', marginBottom: 12, textTransform: 'uppercase' as const };

  const KV = ({ label, value, sub, color }: any) => (
    <div style={{ ...CARD, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, color: DIM, fontWeight: 700, letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || TEXT, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const empty = ministries.length === 0 && themes.length === 0;

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* HEADER */}
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: TEXT }}>📊 Budget Intel</h1>
          <div style={{ marginTop: 4, fontSize: 12.5, color: DIM }}>
            Drop the Union Budget PDFs (Budget-at-a-Glance, Highlights, Speech, Expenditure Statement) — get a ministry-wise winner/loser brief, sector plays, and narrative themes in seconds. Fully client-side, no upload leaves your browser.
          </div>
        </div>

        {/* UPLOAD ZONE */}
        <div
          ref={dropRef}
          style={{
            ...CARD,
            border: '2px dashed color-mix(in srgb, #60A5FA 50%, transparent)',
            padding: '32px 20px',
            textAlign: 'center' as const,
            cursor: 'pointer',
            background: 'color-mix(in srgb, #60A5FA 4%, transparent)',
          }}
          onClick={() => (document.getElementById('budget-file-input') as HTMLInputElement)?.click()}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📥</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>
            Drop PDF, PPT, or DOC files here — or click to pick
          </div>
          <div style={{ fontSize: 12, color: DIM, marginTop: 6 }}>
            Multiple files supported. PDF is parsed live; DOC/PPT: export to PDF or paste text below.
          </div>
          {busy && <div style={{ marginTop: 12, fontSize: 12, color: '#F59E0B', fontWeight: 700 }}>Extracting text…</div>}
          {error && <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--mc-bearish)' }}>{error}</div>}
          {files.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {files.map(f => (
                <span key={f.name} style={{ fontSize: 11, padding: '3px 10px', background: 'color-mix(in srgb, #10B981 15%, transparent)', border: '1px solid color-mix(in srgb, #10B981 40%, transparent)', color: '#10B981', borderRadius: 6, fontWeight: 700 }}>
                  📄 {f.name} · {Math.round(f.size / 1024)} KB
                </span>
              ))}
            </div>
          )}
          <input
            id="budget-file-input"
            type="file"
            multiple
            accept=".pdf,.txt,.md,.ppt,.pptx,.doc,.docx"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* PASTE FALLBACK */}
        <details style={{ ...CARD, padding: '12px 16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: DIM, fontWeight: 700 }}>
            📋 Or paste text from PPT / DOC / speech (fallback for non-PDF sources)
          </summary>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="Paste any budget-related text — the parser reads it alongside uploaded PDFs."
            style={{ marginTop: 8, width: '100%', minHeight: 100, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: 10, color: TEXT, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </details>

        {empty && (
          <div style={{ ...CARD, padding: '40px 20px', textAlign: 'center' as const, color: DIM }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 14 }}>Upload a Budget PDF above to unlock allocation heat-map, sector plays, and narrative themes.</div>
          </div>
        )}

        {/* HEADLINE FISCAL CHIPS */}
        {(headline.totalExpBE || headline.totalCapExBE) && (
          <div>
            <div style={{ fontSize: 10.5, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>
              🇮🇳 FISCAL HEADLINE {headline.yearNew && `— BE ${headline.yearNew}`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <KV label="Total Expenditure BE" value={fmtCr(headline.totalExpBE)} color="var(--mc-text-0)" />
              <KV label="Total Capital Expenditure BE" value={fmtCr(headline.totalCapExBE)}
                  sub={headline.effectiveCapExBE ? `Effective ${fmtCr(headline.effectiveCapExBE)}` : ''} color="#22D3EE" />
              <KV label="Interest Payments" value={fmtCr(headline.interestPayments)}
                  sub={headline.totalExpBE && headline.interestPayments ? `${((headline.interestPayments / headline.totalExpBE) * 100).toFixed(1)}% of total` : ''} color="#F59E0B" />
              <KV label="Prior year for comparison" value={headline.yearPrev || '—'} color="var(--mc-text-2)" />
            </div>
          </div>
        )}

        {/* MINISTRY WINNERS / LOSERS */}
        {ministries.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <div style={CARD}>
              <div style={H}>📈 Allocation winners (BE new vs current RE)</div>
              {winners.length ? winners.slice(0, 12).map(m => (
                <div key={m.ministry} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--mc-bg-3)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{m.ministry}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{fmtCr(m.rePrev)} → {fmtCr(m.beNew)} · vs Actual {fmtPct(m.yoyVsActual)}</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' as const }}>
                    {fmtPct(m.yoyVsRE)}
                  </div>
                </div>
              )) : <div style={{ fontSize: 12, color: DIM }}>None identified</div>}
            </div>

            <div style={CARD}>
              <div style={H}>📉 Allocation losers (BE new vs current RE)</div>
              {losers.length ? losers.slice(0, 12).map(m => (
                <div key={m.ministry} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--mc-bg-3)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{m.ministry}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>{fmtCr(m.rePrev)} → {fmtCr(m.beNew)} · vs Actual {fmtPct(m.yoyVsActual)}</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' as const }}>
                    {fmtPct(m.yoyVsRE)}
                  </div>
                </div>
              )) : <div style={{ fontSize: 12, color: DIM }}>None identified</div>}
            </div>
          </div>
        )}

        {/* SECTOR PLAYS */}
        {sectorPlays.length > 0 && (
          <div style={CARD}>
            <div style={H}>💼 Institutional sector plays — stocks that ride each allocation shift</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              {sectorPlays.map(sp => (
                <div key={sp.sector} style={{ padding: 12, background: 'var(--mc-bg-2)', border: `1px solid ${sp.direction === 'up' ? 'color-mix(in srgb, var(--mc-bullish) 40%, transparent)' : sp.direction === 'down' ? 'color-mix(in srgb, var(--mc-bearish) 40%, transparent)' : 'var(--mc-bg-4)'}`, borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{sp.sector}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: sp.direction === 'up' ? 'var(--mc-bullish)' : sp.direction === 'down' ? 'var(--mc-bearish)' : DIM }}>
                      {sp.direction === 'up' ? '▲' : sp.direction === 'down' ? '▼' : '—'} {fmtPct(sp.yoyPct)}
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginBottom: 8 }}>
                    Trigger: {sp.ministries.join(', ')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sp.stocks.slice(0, 8).map(s => (
                      <div key={s.ticker} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
                        <a
                          href={`https://www.nseindia.com/get-quotes/equity?symbol=${s.ticker}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: '#60A5FA', fontWeight: 700, textDecoration: 'none', minWidth: 100 }}
                        >{s.ticker}</a>
                        <span style={{ color: DIM, flex: 1 }}>{s.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 12 }}>
              Stock lists are historical beneficiaries — not investment recommendations. Cross-check with your own thesis, valuation, and management-quality filters before acting.
            </div>
          </div>
        )}

        {/* THEMES */}
        {themes.length > 0 && (
          <div style={CARD}>
            <div style={H}>🔍 Narrative themes detected across all uploaded docs</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {themes.map(t => (
                <div key={t.theme} style={{ padding: 12, background: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{t.icon} {t.theme}</div>
                    <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 800 }}>{t.hits}×</div>
                  </div>
                  {t.snippet && (
                    <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' as const, lineHeight: 1.4 }}>
                      "…{t.snippet}…"
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FULL MINISTRY TABLE */}
        {ministries.length > 0 && (
          <div style={CARD}>
            <div style={H}>📚 Full ministry allocation table</div>
            <div style={{ overflowX: 'auto' as const }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr style={{ color: DIM, textAlign: 'right' as const }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Ministry</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Actuals prev</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>BE current</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>RE current</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>BE new</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Δ vs RE</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700 }}>Δ vs Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {ministries.map(m => (
                    <tr key={m.ministry} style={{ borderTop: '1px dashed var(--mc-bg-3)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: TEXT }}>{m.ministry}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(m.actualsPrev)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: DIM }}>{fmtCr(m.bePrev)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCr(m.rePrev)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 800, color: TEXT }}>{fmtCr(m.beNew)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' as const, fontWeight: 800, color: (m.yoyVsRE ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsRE)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' as const, color: (m.yoyVsActual ?? 0) >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(m.yoyVsActual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* FOOTER DISCLAIMER */}
        {(ministries.length > 0 || themes.length > 0) && (
          <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', textAlign: 'center' as const, padding: '8px 0' }}>
            Analysis is derived from the exact text of the uploaded document(s) via regex matching. Numbers are quoted from the Ministry of Finance tables verbatim. Sector-play stock lists are historical beneficiary heuristics, not recommendations.
          </div>
        )}

      </div>
    </div>
  );
}
