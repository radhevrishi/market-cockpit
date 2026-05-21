'use client';

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-VALUATION (PATCH 0637)
//
// Upload multiple documents (Excel financial sheet + concall PDFs + investor
// presentations) → page auto-extracts everything needed and runs all valuation
// calculators without any user input.
//
// Pipeline:
//   1. Parse .xlsx (e.g. MTAR Technologies financial workbook) → historical
//      Sales / Operating Profit / PAT / EPS / Price for last 10 years from
//      the 'Data Sheet'.
//   2. Parse .pdf (concall transcript + investor PPT) → forward FY27/FY28
//      revenue / EBITDA / PAT / margin guidance via lib/forward-guidance-extractor.
//   3. Auto-fetch ticker quote (price + market cap + shares) from
//      /api/market/quotes via lib/valuation-calculators.
//   4. Resolve sector → pick appropriate calculator (P/E for industrials, P/S
//      for growth, EV/EBITDA for cyclicals) from SECTOR_CALCULATOR_MAP.
//   5. Run all three calculators with bull/base/bear bands.
//   6. Display unified institutional report — no questions asked.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  calculatePS, calculatePE, calculateEvEbitda,
  fetchQuoteAutofill, saveValuation,
  SECTOR_CALCULATOR_MAP,
  type CalculatorResult, type QuoteAutoFill,
} from '@/lib/valuation-calculators';
import { extractGuidance, type GuidanceItem, metricLabel, formatGuidanceValue } from '@/lib/forward-guidance-extractor';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

// ─── Types ──────────────────────────────────────────────────────────────
interface ExcelFinancials {
  source: string;
  ticker?: string;
  company?: string;
  fyLabels: string[];           // ['Mar 2016', 'Mar 2017', …, 'TTM']
  sales: (number | null)[];
  operatingProfit: (number | null)[];
  netProfit: (number | null)[];
  eps: (number | null)[];
  price: (number | null)[];
  opmAvg?: number;              // 5yr avg OPM
  netMargin?: number;           // latest net margin
  // Derived growth rates
  salesCagr5y?: number;
  patCagr5y?: number;
  latestSales?: number;
  latestPAT?: number;
  latestEBITDA?: number;        // operating profit + depreciation if available
}

interface ParsedDoc {
  name: string;
  size: number;
  type: 'excel' | 'pdf' | 'unknown';
  status: 'parsing' | 'done' | 'error';
  message?: string;
  excelData?: ExcelFinancials;
  pdfText?: string;
  guidance?: GuidanceItem[];
}

interface AutoValuationReport {
  ticker?: string;
  company?: string;
  sector?: string;
  quote?: QuoteAutoFill;
  excelData?: ExcelFinancials;
  guidance: GuidanceItem[];
  forwardYear?: string;        // 'FY27' / 'FY28' — picked from guidance
  forwardRevenue?: number;
  forwardEBITDA?: number;
  forwardPAT?: number;
  inferredMargin?: number;     // EBITDA margin from guidance OR historical
  // Calculator outputs
  peResult?: CalculatorResult;
  psResult?: CalculatorResult;
  evResult?: CalculatorResult;
  recommendation: 'BUY' | 'WATCH' | 'WAIT' | 'AVOID' | 'NEED_MORE_DATA';
  rationale: string[];
}

// ─── PDF extraction (CDN pdf.js — same pattern as earnings-analysis) ────
async function loadPdfJs(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('pdf.js CDN load failed'));
    document.head.appendChild(s);
  });
  const pdfjsLib = (window as any).pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return pdfjsLib;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await loadPdfJs();
  if (!pdfjsLib) return '';
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const totalPages = doc.numPages;
  // Cap at first 80 pages for budget
  const pagesToRead = Math.min(totalPages, 80);
  let all = '';
  for (let p = 1; p <= pagesToRead; p++) {
    try {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: any[] = content.items;
      all += items.map((it: any) => it.str).join(' ') + '\n';
      if (all.length > 200_000) break; // hard cap
    } catch {}
  }
  return all;
}

// ─── Excel extraction (XLSX) ────────────────────────────────────────────
async function extractExcelFinancials(file: File): Promise<ExcelFinancials | null> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetNames = wb.SheetNames;
  // Identify the 'Data Sheet' or fallback to first sheet
  const dataSheetName = sheetNames.find(s => /data\s*sheet/i.test(s)) || sheetNames[0];
  const ws = wb.Sheets[dataSheetName];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

  // Find rows by label
  const findRow = (labels: string[]) => {
    for (let i = 0; i < rows.length; i++) {
      const first = String(rows[i]?.[0] || '').trim().toLowerCase();
      for (const lab of labels) {
        if (first === lab.toLowerCase() || first.includes(lab.toLowerCase())) return rows[i];
      }
    }
    return null;
  };

  // Header row for year labels
  const headerRow = findRow(['Report Date', 'Period', 'Year']) || rows.find((r) => Array.isArray(r) && r.some((c: any) => typeof c === 'string' && /Mar|Dec|FY|20[12][0-9]/.test(c))) || [];
  const fyLabels = (headerRow || []).slice(1).filter((x: any) => x !== null).map((x: any) => String(x));

  const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[,₹$\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const extractRow = (row: any[] | null): (number | null)[] => {
    if (!row) return [];
    return row.slice(1).map(toNum);
  };

  const salesRow = findRow(['Sales', 'Revenue', 'Total Revenue', 'Net Sales']);
  const opRow = findRow(['Operating Profit', 'EBITDA']);
  const netProfitRow = findRow(['Net profit', 'Net Profit', 'PAT', 'Profit after tax']);
  const epsRow = findRow(['EPS', 'Earnings per share']);
  const priceRow = findRow(['Price', 'CMP']);

  // Company / ticker — look in cell B1 or anywhere
  let company: string | undefined;
  let ticker: string | undefined;
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    for (let c = 0; c < Math.min((rows[r] || []).length, 5); c++) {
      const v = String(rows[r]?.[c] || '');
      if (v && v.length > 2 && v.length < 80 && /[A-Z]/.test(v) && !/Date|Period|Year|Sales|Revenue|Profit/i.test(v)) {
        if (!company) company = v;
      }
      const m = v.match(/^[A-Z]{2,10}$/);
      if (m && !ticker) ticker = m[0];
    }
  }

  const fin: ExcelFinancials = {
    source: file.name,
    company, ticker,
    fyLabels,
    sales: extractRow(salesRow),
    operatingProfit: extractRow(opRow),
    netProfit: extractRow(netProfitRow),
    eps: extractRow(epsRow),
    price: extractRow(priceRow),
  };

  // Derived metrics
  const lastN = (arr: (number | null)[], n: number): number[] => {
    const clean = arr.filter((x): x is number => typeof x === 'number');
    return clean.slice(-n);
  };
  const sales5 = lastN(fin.sales, 5);
  const pat5 = lastN(fin.netProfit, 5);
  if (sales5.length >= 2) {
    const first = sales5[0]; const last = sales5[sales5.length - 1];
    if (first > 0 && last > 0) fin.salesCagr5y = (Math.pow(last / first, 1 / (sales5.length - 1)) - 1) * 100;
    fin.latestSales = last;
  }
  if (pat5.length >= 2) {
    const first = pat5[0]; const last = pat5[pat5.length - 1];
    if (first > 0 && last > 0) fin.patCagr5y = (Math.pow(last / first, 1 / (pat5.length - 1)) - 1) * 100;
    fin.latestPAT = last;
  }
  // OPM avg
  const opmList = fin.operatingProfit.map((op, i) => {
    const s = fin.sales[i];
    if (typeof op === 'number' && typeof s === 'number' && s > 0) return (op / s) * 100;
    return null;
  }).filter((x): x is number => typeof x === 'number');
  if (opmList.length > 0) fin.opmAvg = opmList.slice(-5).reduce((a, b) => a + b, 0) / Math.min(opmList.length, 5);
  fin.latestEBITDA = fin.operatingProfit.filter((x): x is number => typeof x === 'number').slice(-1)[0];

  return fin;
}

// ─── Guidance value normalizer ──────────────────────────────────────────
function pickGuidanceValue(g: GuidanceItem): number | undefined {
  if (g.point !== undefined) return g.point;
  if (g.low !== undefined && g.high !== undefined) return (g.low + g.high) / 2;
  if (g.high !== undefined) return g.high;
  if (g.low !== undefined) return g.low;
  return undefined;
}

// ─── Sector inference ───────────────────────────────────────────────────
function inferSector(text: string, company?: string): string | undefined {
  const t = (text + ' ' + (company || '')).toLowerCase();
  if (/precision|cnc|aerospace|defence|defense|nuclear|space launch/.test(t)) return 'Defence';
  if (/transmission|transformer|switchgear|grid|t&d/.test(t)) return 'Power / Transmission';
  if (/pharma|formulation|api |drug|usfda/.test(t)) return 'Pharmaceuticals';
  if (/specialty chemical|cdmo|crdmo|agrochem/.test(t)) return 'Specialty Chemicals';
  if (/auto component|tire|tyre|forging|gearbox/.test(t)) return 'Auto Components';
  if (/data center|server|esdm|electronics/.test(t)) return 'AI Infrastructure (India)';
  if (/bank|nbfc|asset management|insurance/.test(t)) return 'Financial Services / NBFC';
  if (/it services|software services|consulting/.test(t)) return 'IT / Tech Services';
  if (/fmcg|consumer|jewell|durable|premium/.test(t)) return 'Consumer Durables / FMCG';
  if (/saas|subscription|cloud|platform/.test(t)) return 'SaaS / Software (US)';
  if (/capital goods|industrial|capex|engineering|machinery/.test(t)) return 'Industrials / Capital Goods';
  return 'Industrials / Capital Goods';
}

// ─── Build the report ───────────────────────────────────────────────────
async function buildReport(docs: ParsedDoc[]): Promise<AutoValuationReport> {
  // Aggregate data across all parsed docs
  const excelDoc = docs.find(d => d.excelData);
  const excelData = excelDoc?.excelData;
  const allText = docs.map(d => d.pdfText || '').join('\n\n');
  const allGuidance = docs.flatMap(d => d.guidance || []);

  // Resolve company + ticker
  let company = excelData?.company;
  let ticker = excelData?.ticker;
  // Try to extract ticker from PDF text
  if (!ticker) {
    const m = allText.match(/\b(?:NSE Symbol|BSE Scrip Code|Symbol|Ticker)[:\s]+([A-Z]{2,10})\b/);
    if (m) ticker = m[1];
  }
  // Heuristic from filename
  if (!ticker) {
    for (const d of docs) {
      const fn = d.name.toUpperCase();
      const m = fn.match(/\b([A-Z]{3,10})\b/);
      if (m && !['LIMITED', 'INDIA'].includes(m[1])) { ticker = m[1]; break; }
    }
  }

  // Quote auto-fill
  let quote: QuoteAutoFill | null = null;
  if (ticker) {
    quote = await fetchQuoteAutofill(ticker, 'india');
    if (quote?.company && !company) company = quote.company;
  }

  // Sector inference
  const sector = inferSector(allText + ' ' + (company || ''), company);

  // Pick a forward year — prefer FY27, then FY28
  const fyOrder = ['FY26', 'FY27', 'FY28', 'FY29'];
  let forwardYear: string | undefined;
  let forwardRevenue: number | undefined;
  let forwardEBITDA: number | undefined;
  let forwardPAT: number | undefined;
  let inferredMargin: number | undefined;

  for (const fy of fyOrder.slice().reverse()) {  // start with FY29 going down
    const yearGuidance = allGuidance.filter(g => g.fiscalYear === fy);
    if (yearGuidance.length > 0) {
      const rev = yearGuidance.find(g => g.metric === 'REVENUE');
      const ebitda = yearGuidance.find(g => g.metric === 'EBITDA');
      const pat = yearGuidance.find(g => g.metric === 'PAT');
      const margin = yearGuidance.find(g => g.metric === 'EBITDA_MARGIN');
      if (rev || ebitda || pat) {
        forwardYear = fy;
        forwardRevenue = rev ? pickGuidanceValue(rev) : undefined;
        forwardEBITDA = ebitda ? pickGuidanceValue(ebitda) : undefined;
        forwardPAT = pat ? pickGuidanceValue(pat) : undefined;
        inferredMargin = margin ? pickGuidanceValue(margin) : undefined;
        break;
      }
    }
  }

  // If we have revenue + margin guidance but no EBITDA explicitly, derive it
  if (forwardRevenue && inferredMargin && !forwardEBITDA) {
    forwardEBITDA = forwardRevenue * (inferredMargin / 100);
  }
  // Derive PAT from EBITDA via historical conversion (rough heuristic: PAT ≈ EBITDA × 0.45)
  if (forwardEBITDA && !forwardPAT && excelData) {
    const latestEBITDA = excelData.latestEBITDA;
    const latestPAT = excelData.latestPAT;
    if (latestEBITDA && latestEBITDA > 0 && latestPAT) {
      const conv = latestPAT / latestEBITDA;
      if (conv > 0.1 && conv < 1.0) forwardPAT = forwardEBITDA * conv;
    }
  }
  // Fallback: project from historical CAGR
  if (!forwardRevenue && excelData?.latestSales && excelData?.salesCagr5y && excelData.salesCagr5y > 0) {
    const yearsAhead = forwardYear === 'FY28' ? 2 : 1;
    forwardRevenue = excelData.latestSales * Math.pow(1 + excelData.salesCagr5y / 100, yearsAhead);
    if (!forwardYear) forwardYear = 'FY27 (projected)';
  }
  if (!forwardPAT && excelData?.latestPAT && excelData?.patCagr5y && excelData.patCagr5y > 0) {
    const yearsAhead = forwardYear === 'FY28' ? 2 : 1;
    forwardPAT = excelData.latestPAT * Math.pow(1 + excelData.patCagr5y / 100, yearsAhead);
  }

  // Sector → multiple lookup
  const sectorConf = sector ? SECTOR_CALCULATOR_MAP[sector] : undefined;
  // Default multiple bands per calc
  const defaults = {
    PE:        { bear: 20, base: 30, bull: 45 },
    PS:        { bear: 5,  base: 10, bull: 18 },
    EV_EBITDA: { bear: 12, base: 18, bull: 25 },
  };
  // Parse multipleHint to refine the band when sector is known
  if (sectorConf) {
    const hint = sectorConf.multipleHint;
    const m = hint.match(/(\d+)\s*-\s*(\d+)/);
    if (m) {
      const lo = parseInt(m[1], 10);
      const hi = parseInt(m[2], 10);
      const mid = Math.round((lo + hi) / 2);
      if (sectorConf.calc === 'PE') defaults.PE = { bear: lo, base: mid, bull: hi };
      if (sectorConf.calc === 'PS') defaults.PS = { bear: lo, base: mid, bull: hi };
      if (sectorConf.calc === 'EV_EBITDA') defaults.EV_EBITDA = { bear: lo, base: mid, bull: hi };
    }
  }

  const currentMarketCapCr = quote?.currentMarketCapCr || 0;
  const horizonMonths = 18;
  const baseCalcInput = {
    ticker,
    company,
    currentMarketCapCr,
    horizonMonths,
    currentPrice: quote?.currentPrice,
    sharesOutstandingCr: quote?.sharesOutstandingCr,
    currency: '₹' as const,
  };

  const peResult = forwardPAT && currentMarketCapCr > 0
    ? calculatePE({ ...baseCalcInput, forwardPATCr: forwardPAT, bearPE: defaults.PE.bear, basePE: defaults.PE.base, bullPE: defaults.PE.bull })
    : undefined;
  const psResult = forwardRevenue && currentMarketCapCr > 0
    ? calculatePS({ ...baseCalcInput, forwardRevenueCr: forwardRevenue, bearPS: defaults.PS.bear, basePS: defaults.PS.base, bullPS: defaults.PS.bull })
    : undefined;
  const evResult = forwardEBITDA && currentMarketCapCr > 0
    ? calculateEvEbitda({ ...baseCalcInput, forwardEBITDACr: forwardEBITDA, bearMultiple: defaults.EV_EBITDA.bear, baseMultiple: defaults.EV_EBITDA.base, bullMultiple: defaults.EV_EBITDA.bull })
    : undefined;

  // Recommendation
  const baseUpsides = [peResult, psResult, evResult]
    .filter((r): r is CalculatorResult => !!r)
    .map(r => r.cases.find(c => c.label === 'BASE')?.upsidePct ?? 0);
  const avgBaseUpside = baseUpsides.length > 0 ? baseUpsides.reduce((a, b) => a + b, 0) / baseUpsides.length : 0;

  let recommendation: AutoValuationReport['recommendation'] = 'NEED_MORE_DATA';
  const rationale: string[] = [];
  if (baseUpsides.length === 0) {
    rationale.push('Insufficient data — need both forward guidance and a live quote (or ticker hit on /api/market/quotes) to produce a valuation.');
  } else {
    if (avgBaseUpside >= 50) { recommendation = 'BUY'; rationale.push(`Base-case upside ${avgBaseUpside.toFixed(0)}% across ${baseUpsides.length} calculator(s) — strong buy zone.`); }
    else if (avgBaseUpside >= 25) { recommendation = 'WATCH'; rationale.push(`Base-case upside ${avgBaseUpside.toFixed(0)}% — solid but not exceptional. Wait for a better entry.`); }
    else if (avgBaseUpside >= 0) { recommendation = 'WAIT'; rationale.push(`Base-case upside only ${avgBaseUpside.toFixed(0)}% — fairly valued. Need re-rating catalyst or earnings surprise.`); }
    else { recommendation = 'AVOID'; rationale.push(`Base-case implies DOWNSIDE ${avgBaseUpside.toFixed(0)}% — multiples already stretched.`); }
  }
  if (excelData?.salesCagr5y && excelData.salesCagr5y > 20) rationale.push(`Strong 5yr sales CAGR ${excelData.salesCagr5y.toFixed(0)}%.`);
  if (excelData?.opmAvg && excelData.opmAvg > 18) rationale.push(`Healthy 5yr avg OPM ${excelData.opmAvg.toFixed(0)}%.`);
  if (sector) rationale.push(`Sector: ${sector} → ${sectorConf?.calc === 'EV_EBITDA' ? 'EV/EBITDA' : sectorConf?.calc || 'P/E'} preferred; multiple ${sectorConf?.multipleHint || 'sector default'}.`);
  if (forwardYear) rationale.push(`Forward year used: ${forwardYear}. Revenue ₹${forwardRevenue?.toFixed(0) || '?'} Cr · EBITDA ₹${forwardEBITDA?.toFixed(0) || '?'} Cr · PAT ₹${forwardPAT?.toFixed(0) || '?'} Cr.`);

  return {
    ticker, company, sector,
    quote: quote || undefined,
    excelData,
    guidance: allGuidance,
    forwardYear, forwardRevenue, forwardEBITDA, forwardPAT, inferredMargin,
    peResult, psResult, evResult,
    recommendation, rationale,
  };
}

// ─── UI components ──────────────────────────────────────────────────────
function CalcResultMini({ label, result }: { label: string; result?: CalculatorResult }) {
  if (!result) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '14px 16px', opacity: 0.5 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: DIM, letterSpacing: '0.5px' }}>{label}</div>
        <div style={{ fontSize: 11, color: DIM, marginTop: 6, fontStyle: 'italic' }}>Not enough data for this calculator.</div>
      </div>
    );
  }
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.5px', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#C9D4E0', marginBottom: 8, lineHeight: 1.5 }}>{result.baseSummary}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {result.cases.map((c) => (
          <div key={c.label} style={{ background: '#0A1422', border: `1px solid ${c.color}50`, borderRadius: 4, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: c.color, letterSpacing: '1px' }}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: TEXT, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              ₹{Math.round(c.marketCapCr).toLocaleString('en-IN')} Cr
            </div>
            {c.targetPrice !== undefined && (
              <div style={{ fontSize: 11, color: c.color, fontWeight: 700, marginTop: 2 }}>
                ₹{c.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })} <span style={{ color: DIM, fontSize: 9 }}>from ₹{c.currentPrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4 }}>
              <span style={{ color: DIM }}>upside</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.upsidePct >= 0 ? '+' : ''}{c.upsidePct.toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: DIM }}>CAGR</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.annualizedPct >= 0 ? '+' : ''}{c.annualizedPct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AutoValuationPage() {
  const [docs, setDocs] = useState<ParsedDoc[]>([]);
  const [report, setReport] = useState<AutoValuationReport | null>(null);
  const [building, setBuilding] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newDocs: ParsedDoc[] = Array.from(files).map(f => ({
      name: f.name,
      size: f.size,
      type: /\.xlsx?$/i.test(f.name) ? 'excel' : /\.pdf$/i.test(f.name) ? 'pdf' : 'unknown',
      status: 'parsing',
    }));
    setDocs(prev => [...prev, ...newDocs]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const docIdx = docs.length + i;
      try {
        if (/\.xlsx?$/i.test(file.name)) {
          const data = await extractExcelFinancials(file);
          setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'done', excelData: data || undefined, message: data ? `Parsed ${data.fyLabels.length} years` : 'No financial rows detected' } : d));
        } else if (/\.pdf$/i.test(file.name)) {
          const text = await extractPdfText(file);
          const guidance = extractGuidance(text);
          setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'done', pdfText: text, guidance, message: `${text.length.toLocaleString()} chars · ${guidance.length} guidance items` } : d));
        } else {
          setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'error', message: 'Unsupported file type' } : d));
        }
      } catch (e: any) {
        setDocs(prev => prev.map((d, idx) => idx === docIdx ? { ...d, status: 'error', message: e?.message || 'parse failed' } : d));
      }
    }
  }, [docs.length]);

  // Re-build report whenever docs change
  useEffect(() => {
    if (docs.length === 0) { setReport(null); return; }
    const allDone = docs.every(d => d.status !== 'parsing');
    if (!allDone) return;
    setBuilding(true);
    buildReport(docs).then(r => { setReport(r); setBuilding(false); });
  }, [docs]);

  const recColor = (r?: string) =>
    r === 'BUY' ? '#10B981' : r === 'WATCH' ? '#22D3EE' : r === 'WAIT' ? '#F59E0B' : r === 'AVOID' ? '#EF4444' : '#94A3B8';

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>🤖 Auto-Valuation</h1>
            <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55, maxWidth: 760 }}>
              Drop your financial sheet + concall PDFs. The portal extracts historical financials, forward guidance, current quote — then runs P/E + P/S + EV/EBITDA automatically and tells you BUY / WATCH / WAIT / AVOID. No manual entry.
            </div>
          </div>
          <Link href="/valuation-calc" style={{ fontSize: 11, color: '#22D3EE', textDecoration: 'none' }}>Open manual calculator →</Link>
        </div>

        {/* Upload */}
        <div style={{
          background: CARD, border: `2px dashed #22D3EE60`, borderRadius: 8, padding: '28px 24px',
          textAlign: 'center',
        }}>
          <input
            id="auto-val-files"
            type="file"
            multiple
            accept=".xlsx,.xls,.pdf"
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: 'none' }}
          />
          <label htmlFor="auto-val-files" style={{
            display: 'inline-block', fontSize: 13, padding: '10px 22px',
            background: '#22D3EE', border: 'none', color: '#0A0E1A',
            borderRadius: 6, cursor: 'pointer', fontWeight: 800, letterSpacing: '0.3px',
          }}>
            ➕ ADD FILES — Excel (financial workbook) + PDFs (concall / investor PPT)
          </label>
          <div style={{ marginTop: 10, fontSize: 11, color: DIM }}>
            Accepts .xlsx · .pdf · multiple files. Excel parsed for Data Sheet rows. PDF parsed for forward FY27/FY28 guidance.
          </div>
        </div>

        {/* Parsed docs */}
        {docs.length > 0 && (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 8 }}>UPLOADED ({docs.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {docs.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: '#0A1422', borderRadius: 4 }}>
                  <span style={{ fontSize: 10, color: d.type === 'excel' ? '#10B981' : '#22D3EE', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 40 }}>
                    {d.type === 'excel' ? 'XLSX' : d.type === 'pdf' ? 'PDF' : '?'}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 10, color: DIM }}>{(d.size / 1024).toFixed(0)} KB</span>
                  <span style={{ fontSize: 10, color: d.status === 'done' ? '#10B981' : d.status === 'error' ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>
                    {d.status === 'parsing' ? '⏳ parsing…' : d.status === 'done' ? '✓ ' + (d.message || 'done') : '✗ ' + (d.message || 'error')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Report */}
        {building && (
          <div style={{ fontSize: 13, color: DIM, fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>📡 Building auto-valuation report…</div>
        )}
        {report && !building && (
          <>
            <div style={{
              background: `linear-gradient(180deg, ${recColor(report.recommendation)}15 0%, transparent 100%)`,
              border: `1px solid ${recColor(report.recommendation)}50`,
              borderLeft: `4px solid ${recColor(report.recommendation)}`,
              borderRadius: 8, padding: '18px 22px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>RECOMMENDATION</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: recColor(report.recommendation), letterSpacing: '-0.5px', marginTop: 4 }}>
                    {report.recommendation}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{report.company || '—'}</div>
                  <div style={{ fontSize: 11, color: DIM, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>
                    {report.ticker || '—'} {report.quote ? `· ₹${report.quote.currentPrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} · MCap ₹${Math.round(report.quote.currentMarketCapCr || 0).toLocaleString('en-IN')} Cr` : ''}
                  </div>
                  {report.sector && <div style={{ fontSize: 10, color: '#22D3EE', marginTop: 4, fontWeight: 700 }}>{report.sector}</div>}
                </div>
              </div>
              <ul style={{ margin: '12px 0 0 22px', padding: 0, fontSize: 12.5, color: TEXT, lineHeight: 1.65 }}>
                {report.rationale.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
              <CalcResultMini label="📈 P/E Valuation" result={report.peResult} />
              <CalcResultMini label="💰 P/S Valuation" result={report.psResult} />
              <CalcResultMini label="🏭 EV/EBITDA Valuation" result={report.evResult} />
            </div>

            {/* Save to bench */}
            {(report.peResult || report.psResult || report.evResult) && (
              <button onClick={() => {
                const first = report.peResult || report.psResult || report.evResult!;
                const kind = report.peResult ? 'PE' : report.psResult ? 'PS' : 'EV_EBITDA';
                saveValuation({
                  calcKind: kind as any,
                  ticker: report.ticker,
                  company: report.company,
                  inputs: first.inputs,
                  baseSummary: first.baseSummary,
                  notes: `Auto-Valuation · ${report.recommendation} · ${report.forwardYear || ''} guidance from ${docs.filter(d => d.type === 'pdf').length} PDF(s) + ${docs.filter(d => d.type === 'excel').length} Excel`,
                });
                alert('Saved to your valuation bench ✓');
              }} style={{
                fontSize: 12, padding: '10px 18px', background: '#10B981', border: 'none',
                color: '#0A0E1A', borderRadius: 6, cursor: 'pointer', fontWeight: 800,
                alignSelf: 'flex-start',
              }}>
                💾 SAVE TO VALUATION BENCH
              </button>
            )}

            {/* Forward guidance extracted */}
            {report.guidance.length > 0 && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#A78BFA', letterSpacing: '0.5px', marginBottom: 8 }}>
                  📋 GUIDANCE EXTRACTED ({report.guidance.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {report.guidance.slice(0, 20).map((g, i) => (
                    <span key={i} title={g.rawPhrase} style={{
                      fontSize: 11, padding: '4px 9px', background: '#1A2540', borderRadius: 4,
                      color: TEXT, fontFamily: 'ui-monospace, monospace', fontWeight: 600,
                    }}>
                      <b style={{ color: '#22D3EE' }}>{g.fiscalYear}</b> · {metricLabel(g.metric)} · {formatGuidanceValue(g)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Historical (from Excel) */}
            {report.excelData && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#10B981', letterSpacing: '0.5px', marginBottom: 8 }}>
                  📊 HISTORICAL FINANCIALS (from {report.excelData.source})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
                  {report.excelData.latestSales && (
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>LATEST SALES</div><div style={{ fontSize: 14, color: TEXT, fontWeight: 800 }}>₹{report.excelData.latestSales.toFixed(0)} Cr</div></div>
                  )}
                  {report.excelData.latestPAT && (
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>LATEST PAT</div><div style={{ fontSize: 14, color: TEXT, fontWeight: 800 }}>₹{report.excelData.latestPAT.toFixed(0)} Cr</div></div>
                  )}
                  {report.excelData.opmAvg && (
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>5YR AVG OPM</div><div style={{ fontSize: 14, color: TEXT, fontWeight: 800 }}>{report.excelData.opmAvg.toFixed(1)}%</div></div>
                  )}
                  {report.excelData.salesCagr5y !== undefined && (
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>5YR SALES CAGR</div><div style={{ fontSize: 14, color: '#10B981', fontWeight: 800 }}>{report.excelData.salesCagr5y.toFixed(1)}%</div></div>
                  )}
                  {report.excelData.patCagr5y !== undefined && (
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>5YR PAT CAGR</div><div style={{ fontSize: 14, color: '#10B981', fontWeight: 800 }}>{report.excelData.patCagr5y.toFixed(1)}%</div></div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: DIM }}>Parsed {report.excelData.fyLabels.length} fiscal-year columns.</div>
              </div>
            )}
          </>
        )}

        {docs.length === 0 && (
          <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '20px 22px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>HOW IT WORKS</div>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 12.5, color: TEXT, lineHeight: 1.65 }}>
              <li>Drop one or more files — Excel financial workbook (Screener / Trendlyne format), concall PDF, investor presentation PDF.</li>
              <li>Excel: parses the &apos;Data Sheet&apos; rows (Sales, Operating Profit, Net Profit, EPS, Price) automatically.</li>
              <li>PDFs: extracted text scanned for forward FY27/FY28 revenue / EBITDA / PAT / margin guidance.</li>
              <li>Ticker auto-resolved from filename + content; current price + market cap pulled from /api/market/quotes.</li>
              <li>Sector inferred from PDF text; appropriate multiple band picked from the Sector Lookup library.</li>
              <li>P/E + P/S + EV/EBITDA all run; bull/base/bear projected; recommendation rendered.</li>
              <li>One click to save to your valuation bench — visible in /valuation-calc Analytics tab.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
