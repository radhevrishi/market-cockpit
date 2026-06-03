// ═══════════════════════════════════════════════════════════════════════════
// AUTO-VALUATION ENGINE (PATCH 0682)
//
// Extracted from auto-valuation/page.tsx so the Concall AI page (and any
// other consumer) can import buildReport + extractors without violating
// Next.js page-export rules.
//
// This file is a regular module (not a route), so named exports are fine.
// page.tsx imports the same functions for its own UI.
// ═══════════════════════════════════════════════════════════════════════════

import { extractGuidance, type GuidanceItem } from '@/lib/forward-guidance-extractor';
import {
  calculatePS, calculatePE, calculateEvEbitda,
  SECTOR_CALCULATOR_MAP,
  fetchQuoteAutofill,
  type CalculatorResult, type QuoteAutoFill,
} from '@/lib/valuation-calculators';

// ─── Types ──────────────────────────────────────────────────────────────
// PATCH 0681 — Next.js page files don't allow named exports. The Concall AI
// page imports buildReport from the sibling engine.ts (which has a duplicate
// of these functions). Plan: dedupe by importing from engine.ts here too.
export interface ExcelFinancials {
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
  // PATCH 0664 — margin hierarchy: latest-year and median-3yr expose
  // more representative margins than the 5yr-avg which gets dragged
  // down by a single weak year. buildReport picks in priority order.
  opmLatest?: number;           // latest-year OPM (best when growth is normal)
  opmMedian3y?: number;         // median of last 3 years (smoothes outliers)
  netMargin?: number;           // latest net margin
  // Derived growth rates
  salesCagr5y?: number;
  patCagr5y?: number;
  latestSales?: number;
  latestPAT?: number;
  latestEBITDA?: number;        // operating profit + depreciation if available
  // PATCH 0641 — META block (MTAR template rows 6-9)
  sharesOutstandingCr?: number; // 'Number of shares' divided by 1 Cr
  currentPriceFromSheet?: number;
  currentMarketCapCrFromSheet?: number;
}

export interface ParsedDoc {
  name: string;
  size: number;
  type: 'excel' | 'pdf' | 'unknown';
  status: 'parsing' | 'done' | 'error';
  message?: string;
  excelData?: ExcelFinancials;
  pdfText?: string;
  guidance?: GuidanceItem[];
}

export interface AutoValuationReport {
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
  // Calculator outputs (Year 1 - typically FY27 with 18mo horizon)
  peResult?: CalculatorResult;
  psResult?: CalculatorResult;
  evResult?: CalculatorResult;
  // PATCH 0657 — Year 2 (FY28, 30mo horizon) — same growth/margin applied
  // one more year forward. Lets the user compare 1yr vs 2yr end states.
  forwardYearY2?: string;
  forwardRevenueY2?: number;
  forwardEBITDAY2?: number;
  forwardPATY2?: number;
  peResultY2?: CalculatorResult;
  psResultY2?: CalculatorResult;
  evResultY2?: CalculatorResult;
  recommendation: 'BUY' | 'WATCH' | 'WAIT' | 'AVOID' | 'NEED_MORE_DATA';
  rationale: string[];
  // PATCH 1017 — surface market cap on the report so the page header can show
  // it (the page was reading quote.currentMarketCapCr directly and ignoring the
  // Excel fallback, leading to 'MCap ₹0 Cr' when Yahoo's chart API didn't
  // return mcap for the symbol — common for Indian stocks).
  currentMarketCapCr?: number;
  // PATCH 0664 — per-calc confidence so the UI can dim low-confidence cards
  peConfidence?: 'HIGH' | 'MED' | 'LOW';
  psConfidence?: 'HIGH' | 'MED' | 'LOW';
  evConfidence?: 'HIGH' | 'MED' | 'LOW';
  // PATCH 0678 — explicit reason next to each confidence chip so user knows
  // exactly WHICH input came from guidance vs historical fallback
  peReason?: string;
  psReason?: string;
  evReason?: string;
  // PATCH 0851 — institutional chips computed from excelData
  marginInflectionChip?: {
    fired: boolean;
    latestQ: number;
    trailingAvg: number;
    gapPp: number;
    direction: 'EXPANSION' | 'COMPRESSION' | 'STABLE';
    interpretation: string;
  };
  forensicPumpChip?: {
    pumpScore: number;          // 0-11
    severity: 'CLEAN' | 'WATCH' | 'HIGH' | 'CRITICAL';
    flags: string[];            // list of triggered signals
  };
  dnaMatchChip?: {
    matched: number;            // 0-9
    criteria: string[];         // which criteria matched
    pass: boolean;              // ≥7/9
  };
  salesAccelChip?: {
    latestYoY: number;
    cagr5y: number;
    delta: number;              // latestYoY - cagr5y (positive = accelerating)
    state: 'ACCELERATING' | 'STABLE' | 'DECELERATING';
  };
  cashConversionChip?: {
    cfoToPat?: number;          // if available — computed when CFO row found
    note: string;
  };
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

export async function extractPdfText(file: File): Promise<string> {
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
// PATCH 0641 — validated against MTAR Technologies template (Indian standard
// Screener / value-investor sheet format):
//   Row 1  COMPANY NAME (col B)
//   Row 6  Number of shares
//   Row 8  Current Price
//   Row 9  Market Capitalization
//   Row 16 Report Date (year columns)
//   Row 17 Sales
//   Row 18-24 Expense rows (raw material, power, employee, S&A, other)
//   Row 25 Other Income
//   Row 26 Depreciation
//   Row 28 Profit before tax
//   Row 30 Net profit
// Operating Profit = Sales - sum(Expenses); EBITDA = OP + Depreciation.
export async function extractExcelFinancials(file: File): Promise<ExcelFinancials | null> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetNames = wb.SheetNames;
  const dataSheetName = sheetNames.find(s => /data\s*sheet/i.test(s)) || sheetNames[0];
  const ws = wb.Sheets[dataSheetName];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

  // PATCH 0849 — robust matcher: exact > prefix > includes, AND reject
  // rows whose label is a modified-metric variant ('Sales Growth %', 'PAT Margin',
  // 'CAGR', 'YoY', etc) when we're trying to find the bare metric row.
  const findRow = (labels: string[]) => {
    const isModified = (s: string) => /\b(growth|margin|cagr|yoy|qoq|ratio|change|%|trend|trailing|annualized)\b/i.test(s);
    const norm = (s: string) => s.trim().toLowerCase();
    const matchTier = (label: string, first: string) => {
      const L = norm(label);
      const F = norm(first);
      if (F === L) return 3;                              // exact match
      if (F.startsWith(L + ' ') || F.startsWith(L + ':') || F === L + 's') return 2;  // prefix
      if (F.includes(L) && !isModified(F)) return 1;      // safe includes — not a modified variant
      return 0;
    };
    // Score every row × every label; return the best non-modified match.
    let bestRow: any = null;
    let bestScore = 0;
    for (let i = 0; i < rows.length; i++) {
      const first = String(rows[i]?.[0] || '').trim();
      if (!first) continue;
      for (const lab of labels) {
        const sc = matchTier(lab, first);
        if (sc > bestScore) { bestScore = sc; bestRow = rows[i]; }
        if (sc === 3) return rows[i];                     // exact match — early exit
      }
    }
    return bestRow;
  };

  const headerRow = findRow(['Report Date', 'Period', 'Year']) || rows.find((r) => Array.isArray(r) && r.some((c: any) => typeof c === 'string' && /Mar|Dec|FY|20[12][0-9]/.test(c))) || [];
  // PATCH 0641 — header values can be Date objects (MTAR template). Normalize to 'Mar 2024' format.
  const fyLabels = (headerRow || []).slice(1).filter((x: any) => x !== null).map((x: any) => {
    if (x instanceof Date) return x.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return String(x);
  });

  const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return null;
    const n = Number(String(v).replace(/[,₹$\s%]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const extractRow = (row: any[] | null): (number | null)[] => {
    if (!row) return [];
    return row.slice(1).map(toNum);
  };

  // PATCH 0849 — expanded row-label matching for diverse report formats
  // (Screener, Trendlyne, Annual-Report extracts, IPO prospectuses, etc.)
  const salesRow = findRow([
    'Sales', 'Revenue', 'Total Revenue', 'Net Sales', 'Revenue from Operations',
    'Total Income', 'Income from Operations', 'Gross Sales', 'Net Revenue', 'Turnover',
  ]);
  const opRowExplicit = findRow([
    'Operating Profit', 'EBITDA', 'EBIT', 'Operating Income',
    'Profit before Interest', 'PBIT', 'Operating EBITDA',
  ]);
  const netProfitRow = findRow([
    'Net profit', 'PAT', 'Profit after tax', 'Profit for the year', 'Profit/(Loss)',
    'Profit after Tax', 'Net Profit after Tax', 'Profit for the Period',
    'Net Income', 'Net Earnings', 'Bottomline',
  ]);
  const epsRow = findRow([
    'EPS', 'Earnings per share', 'EPS (Basic)', 'Basic EPS', 'Diluted EPS',
  ]);
  const priceRow = findRow([
    'Price', 'CMP', 'Current Price', 'Share Price', 'Closing Price',
  ]);
  const depRow = findRow([
    'Depreciation', 'Depreciation & Amortisation', 'Depreciation and Amortization',
    'D&A', 'Depreciation/Amortisation',
  ]);

  // Operating profit — fall back to Sales minus all expense rows when not explicit
  let opRow = opRowExplicit;
  if (!opRow && salesRow) {
    const expenseRowLabels = ['Raw Material Cost', 'Change in Inventory', 'Power and Fuel',
      'Other Mfr', 'Employee Cost', 'Selling and admin', 'Other Expenses'];
    const expRows = expenseRowLabels.map(l => findRow([l])).filter(Boolean) as any[][];
    if (expRows.length > 0) {
      const computed: any[] = [null];
      for (let col = 1; col < salesRow.length; col++) {
        const sales = toNum(salesRow[col]);
        if (sales === null) { computed.push(null); continue; }
        let totalExp = 0; let anyExp = false;
        for (const er of expRows) {
          const v = toNum(er[col]);
          if (v !== null) { totalExp += v; anyExp = true; }
        }
        computed.push(anyExp ? sales - totalExp : null);
      }
      opRow = computed;
    }
  }

  // Company name — explicit row 1 col B (MTAR template) or first non-empty string
  let company: string | undefined;
  let ticker: string | undefined;
  const companyRow = findRow(['COMPANY NAME', 'Company Name']);
  if (companyRow) {
    const v = String(companyRow[1] || '').trim();
    if (v && v.length > 2) company = v;
  }
  if (!company) {
    for (let r = 0; r < Math.min(rows.length, 5); r++) {
      for (let c = 1; c < Math.min((rows[r] || []).length, 5); c++) {
        const v = String(rows[r]?.[c] || '').trim();
        if (v && v.length > 2 && v.length < 80 && /[A-Za-z]/.test(v) && !/Date|Period|Year/i.test(v)) {
          if (!company) { company = v; break; }
        }
      }
      if (company) break;
    }
  }
  // Ticker — try ticker label or filename
  const tickerRow = findRow(['Ticker', 'NSE Symbol', 'BSE Code']);
  if (tickerRow) {
    const v = String(tickerRow[1] || '').trim().toUpperCase();
    if (v && /^[A-Z]{2,12}$/.test(v)) ticker = v;
  }
  if (!ticker) {
    // PATCH 0642 — pick first WORD from filename, not first 4-12 chars of joined string.
    // 'MTAR Technologie.xlsx' -> ['MTAR', 'Technologie'] -> 'MTAR'
    // 'KAYNES-Q4FY26.pdf' -> ['KAYNES', 'Q4FY26'] -> 'KAYNES'
    const fn = file.name.replace(/\.[a-z]+$/i, '');
    const words = fn.split(/[^A-Za-z]+/).filter(w => w.length >= 3 && w.length <= 12);
    if (words.length > 0) {
      const upper = words[0].toUpperCase();
      // Exclude obvious non-ticker words
      if (!/^(THE|FOR|FROM|WITH|ANNUAL|INVESTOR|EARNINGS|TRANSCRIPT|REPORT|PRESENTATION|TECHNOLOGIE|LIMITED|INDIA)$/i.test(upper)) {
        ticker = upper;
      }
    }
  }

  // PATCH 0641 — META block extraction (MTAR template rows 6/8/9)
  const sharesRow = findRow(['Number of shares']);
  const currentPriceRow = findRow(['Current Price']);
  const marketCapRow = findRow(['Market Capitalization', 'Market Cap']);
  const numShares = sharesRow ? toNum(sharesRow[1]) : null;
  const currentPriceFromSheet = currentPriceRow ? toNum(currentPriceRow[1]) : undefined;
  const currentMarketCapCrFromSheet = marketCapRow ? toNum(marketCapRow[1]) : undefined;
  // Indian templates store shares as raw count (e.g. 30,750,000). Convert to crores.
  const sharesOutstandingCr = numShares ? numShares / 1e7 : undefined;

  const fin: ExcelFinancials = {
    source: file.name,
    company, ticker,
    fyLabels,
    sales: extractRow(salesRow),
    operatingProfit: extractRow(opRow),
    netProfit: extractRow(netProfitRow),
    eps: extractRow(epsRow),
    price: extractRow(priceRow),
    sharesOutstandingCr,
    currentPriceFromSheet: currentPriceFromSheet ?? undefined,
    currentMarketCapCrFromSheet: currentMarketCapCrFromSheet ?? undefined,
  };

  // Derived metrics
  const lastN = (arr: (number | null)[], n: number): number[] => {
    const clean = arr.filter((x): x is number => typeof x === 'number');
    return clean.slice(-n);
  };
  // PATCH 1016 — true 5y CAGR uses 5 INTERVALS = 6 data points (FY21→FY26),
  // not lastN(5)=5 points / 4 intervals (FY22→FY26). The latter under/over-states
  // CAGR depending on year-on-year smoothness (Sandhar test: reported 20.2/37.4
  // when real 5y CAGR is 21.1/28.0). Take 6 points → length-1 = 5 intervals so
  // the label "5y CAGR" actually means a 5-year span.
  const sales5 = lastN(fin.sales, 6);
  const pat5 = lastN(fin.netProfit, 6);
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
  // PATCH 0665 — EBITDA-aware OPM. In some Indian Screener templates the
  // "Operating Profit" row is actually EBIT (post-depreciation), not EBITDA.
  // When a Depreciation row exists, EBITDA = OP + Dep is the proper number
  // to use for valuation. Symptom that caught the bug: MTAR showing OPM 7%
  // while PAT margin = 10.8% — mathematically impossible.
  const depValues = depRow ? extractRow(depRow) : [];
  const opmList = fin.operatingProfit.map((op, i) => {
    const s = fin.sales[i];
    const dep = depValues[i];
    if (typeof op === 'number' && typeof s === 'number' && s > 0) {
      const ebitda = (typeof dep === 'number' && dep > 0) ? op + dep : op;
      return (ebitda / s) * 100;
    }
    return null;
  }).filter((x): x is number => typeof x === 'number');
  if (opmList.length > 0) fin.opmAvg = opmList.slice(-5).reduce((a, b) => a + b, 0) / Math.min(opmList.length, 5);
  // PATCH 0664 — expose latest-year OPM and median-3yr OPM for a smarter
  // margin hierarchy in buildReport.
  if (opmList.length > 0) fin.opmLatest = opmList[opmList.length - 1];
  if (opmList.length >= 3) {
    const last3 = opmList.slice(-3).slice().sort((a, b) => a - b);
    fin.opmMedian3y = last3[1];   // middle value of last 3
  }

  // PATCH 0641 — proper EBITDA = Operating Profit + Depreciation (when both present).
  // Otherwise fall back to OP alone (Indian Screener convention).
  const opSeries = fin.operatingProfit.filter((x): x is number => typeof x === 'number');
  const latestOP = opSeries.slice(-1)[0];
  const depSeries = depRow ? extractRow(depRow).filter((x): x is number => typeof x === 'number') : [];
  const latestDep = depSeries.slice(-1)[0];
  fin.latestEBITDA = (typeof latestOP === 'number' && typeof latestDep === 'number')
    ? latestOP + latestDep
    : latestOP;

  // PATCH 0665 — Sanity check: PAT margin can't exceed EBITDA margin.
  // PATCH 0666 — Tightened threshold to 1.3× PAT margin. For industrial /
  // manufacturing names, EBITDA margin is structurally ≥1.3× PAT margin
  // because depreciation + interest + tax sum to typically 30%+ of EBITDA.
  // If our parsed OPM is closer than that, the OP row is mis-mapped (maybe
  // pointing at EBIT or some sub-component instead of true EBITDA). In that
  // case, infer EBITDA margin from PAT × 1.6 conversion. Also override
  // fin.latestEBITDA so the downstream EBITDA→PAT conversion uses sensible
  // numbers (otherwise conv = latestPAT/badEBITDA = ~1.0, breaking PAT scaling).
  // PATCH 0667 — MUST run AFTER the latestEBITDA assignment above, else
  // that line silently overwrites the sanity-check override. (Found via
  // MTAR run showing PAT ₹277 = EBITDA ₹279, confirming conv ~= 1.0.)
  const latestPATForCheck = pat5[pat5.length - 1];
  const latestSalesForCheck = sales5[sales5.length - 1];
  if (latestPATForCheck && latestSalesForCheck && latestSalesForCheck > 0) {
    const patMargin = (latestPATForCheck / latestSalesForCheck) * 100;
    const requiredMinOPM = patMargin * 1.3;
    if (fin.opmLatest !== undefined && fin.opmLatest < requiredMinOPM) {
      // OP row appears mis-mapped. Infer EBITDA margin: PAT × ~1.6x
      // conversion is the industrial standard.
      const inferredOpm = Math.min(patMargin * 1.6, 35);
      fin.opmLatest = inferredOpm;
      fin.opmMedian3y = inferredOpm;
      fin.opmAvg = inferredOpm;
      // Override latestEBITDA to match inferred margin so the downstream
      // PAT-conversion math doesn't keep using the broken parsed value.
      fin.latestEBITDA = latestSalesForCheck * (inferredOpm / 100);
    }
  }

  // PATCH 0643 — unit auto-detection. Indian Screener exports default to Cr,
  // but some templates (Tijori) use Lakh. Heuristic: if latest sales > 1e5
  // (₹100,000 Cr is unrealistic for a typical name in the sheet), assume the
  // numbers are in lakh and scale down by 100.
  if (fin.latestSales && fin.latestSales > 100_000) {
    const scale = 1 / 100;
    fin.sales = fin.sales.map(v => v !== null ? v * scale : null);
    fin.operatingProfit = fin.operatingProfit.map(v => v !== null ? v * scale : null);
    fin.netProfit = fin.netProfit.map(v => v !== null ? v * scale : null);
    fin.latestSales = fin.latestSales * scale;
    if (fin.latestPAT) fin.latestPAT = fin.latestPAT * scale;
    if (fin.latestEBITDA) fin.latestEBITDA = fin.latestEBITDA * scale;
    if (fin.currentMarketCapCrFromSheet && fin.currentMarketCapCrFromSheet > 1e7) {
      fin.currentMarketCapCrFromSheet = fin.currentMarketCapCrFromSheet * scale;
    }
  }

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

// PATCH 0653 — pick (bear, base, bull) per institutional convention:
//   bear  = low bound  (most conservative)
//   base  = midpoint   (analyst consensus)
//   bull  = high bound (management's stretch goal)
// When guidance is a point (single number), all three return the same value.
function pickGuidanceScenarios(g: GuidanceItem | undefined): { bear?: number; base?: number; bull?: number } {
  if (!g) return {};
  if (g.low !== undefined && g.high !== undefined) {
    return {
      bear: g.low,
      base: (g.low + g.high) / 2,
      bull: g.high,
    };
  }
  const v = pickGuidanceValue(g);
  return { bear: v, base: v, bull: v };
}

// ─── Sector inference ───────────────────────────────────────────────────
// PATCH 0679 — Score-weighted sector inference.
//
// Old logic: first regex hit wins. Single mention of "defence" in a Kirloskar
// Oil Engines concall (where defence is <15% of revenue) → tagged the whole
// company as Defence → wrong 10× P/S, 40× P/E multiples → fake BUY +151%.
//
// New logic: count keyword occurrences per sector, weight by SPECIFICITY,
// require the dominant sector to clearly beat the runner-up. Defence is
// only assigned if it dominates 2:1 over Industrials (because pure-play
// defence names — HAL/BEL/BDL/MAZDOCK — saturate the PDF with defence
// vocabulary, while diversified industrials only sprinkle it occasionally).
function inferSector(text: string, company?: string): string | undefined {
  const t = (text + ' ' + (company || '')).toLowerCase();
  // [sector, [keyword, weight] pairs]
  // Higher weight = more specific signal. Generic words like "engineering"
  // get 1 point; sector-defining phrases like "USFDA approval" get 5.
  const sectors: Array<[string, Array<[RegExp, number]>]> = [
    ['Defence', [
      [/\bdefence\b|\bdefense\b/g, 2],
      [/\baerospace\b/g, 3],
      [/\bnuclear\b/g, 3],
      [/\bspace launch\b|\bsatellite\b/g, 3],
      [/\bmissile\b|\bsubmarine\b|\bwarship\b|\bfighter\b/g, 5],
      [/\bministry of defence\b|\bMOD\b/gi, 4],
      [/\bDRDO\b|\bISRO\b|\bHAL\b/gi, 4],
      [/\border book.{0,30}defence\b/gi, 3],
    ]],
    ['Pharmaceuticals', [
      [/\bpharma(?:ceutical)?\b/g, 3],
      [/\bformulation\b|\bAPI\b|\bdrug\b/g, 2],
      [/\bUSFDA\b|\bEU GMP\b|\bWHO GMP\b/g, 5],
      [/\bANDA\b|\bDMF\b|\binjectable\b/g, 4],
      // PATCH 0877 — Animal health / Veterinary API also belongs here.
      // NGL Fine Chem (95% Animal API, WHO-GMP) was getting mis-routed
      // to Industrials / Capital Goods because the only matches were
      // generic 'capex' and 'manufacturing'. Veterinary API is a
      // pharma sub-segment, not industrials.
      [/\bveterinar(?:y|ian)\b/g, 5],
      [/\banimal\s+health\b/g, 5],
      [/\banimal\s+api\b/g, 5],
      [/\banimal\s+(?:healthcare|pharma)\b/g, 5],
      [/\banthelmintics?\b|\bectoparasiticides?\b|\bantiprotozoals?\b/g, 5],
      [/\bbiosimilars?\b|\bvaccines?\b/g, 3],
      [/\bcGMP\b/g, 3],
    ]],
    ['Specialty Chemicals', [
      [/\bspecialty chemicals?\b/g, 5],
      [/\bCDMO\b|\bCRDMO\b/g, 4],
      [/\bagrochem\b|\bcrop protection\b/g, 4],
      [/\bfluoro(?:chemical|polymer)\b/g, 4],
    ]],
    ['Power / Transmission', [
      [/\btransformer\b/g, 4],
      [/\bswitchgear\b/g, 4],
      [/\btransmission line\b|\bT&D\b/g, 4],
      [/\bsubstation\b|\bgrid\b/g, 2],
    ]],
    ['Auto Components', [
      [/\bauto component\b|\bautomotive\b/g, 3],
      [/\btyres?\b|\btires?\b/g, 3],
      [/\bforging\b|\bgearbox\b|\bdriveline\b/g, 4],
      [/\bOEM\b/g, 1],
    ]],
    ['AI Infrastructure (India)', [
      [/\bESDM\b|\belectronics manufacturing services\b/g, 5],
      [/\bdata cent(?:er|re)\b/g, 4],
      [/\bserver\b.{0,20}\bGPU\b/g, 5],
      [/\bsemiconductor\b/g, 3],
    ]],
    ['Financial Services / NBFC', [
      [/\bNBFC\b/g, 5],
      [/\bbank\b/g, 2],
      [/\basset management\b/g, 3],
      [/\binsurance\b/g, 3],
      [/\bAUM\b|\bloan book\b/g, 4],
    ]],
    ['IT / Tech Services', [
      [/\bIT services\b/g, 4],
      [/\bsoftware services\b/g, 4],
      [/\bdigital transformation\b|\bcloud services\b/g, 3],
      [/\bUSD revenue\b|\bbillable hours\b/g, 4],
    ]],
    ['Consumer Durables / FMCG', [
      [/\bFMCG\b/g, 5],
      [/\bconsumer durables?\b/g, 4],
      [/\bjewell?ery\b/g, 4],
      [/\bbrand premium\b|\bdistribution reach\b/g, 3],
    ]],
    ['SaaS / Software (US)', [
      [/\bSaaS\b/g, 5],
      [/\bARR\b|\bannual recurring revenue\b/g, 5],
      [/\bsubscription revenue\b/g, 4],
      [/\bcloud platform\b/g, 3],
    ]],
    ['Industrials / Capital Goods', [
      [/\bindustrial\b/g, 1],
      [/\bcapital goods\b/g, 4],
      [/\bcapex\b/g, 1],
      [/\bengineering\b/g, 1],
      [/\bmachinery\b|\bequipment\b/g, 2],
      [/\bdiesel engine\b|\bgenerator\b|\bgenset\b/g, 5],
      [/\bpump\b|\bcompressor\b|\bturbine\b/g, 4],
      [/\bfabrication\b|\bplant\b/g, 1],
    ]],
    // PATCH 0849 — 20+ new sectors covering most NSE-listed industries
    // so any uploaded earnings report routes to a meaningful valuation
    // template instead of falling through to Industrials.
    ['Breweries / Distilleries', [
      [/\bbrewer(?:y|ies)\b/g, 5],
      [/\bdistiller(?:y|ies)\b/g, 5],
      [/\balcohol(?:ic)?\s+beverages?\b/g, 5],
      [/\bliquor\b|\bspirits\b|\bwhisk(?:e)?y\b|\brum\b|\bvodka\b|\bbeer\b/g, 4],
      [/\bIMFL\b|\bIndian made foreign liquor\b/g, 5],
      [/\bENA\b|\bextra neutral alcohol\b|\bgrain alcohol\b/g, 4],
      [/\bcountry liquor\b|\bbottling\b/g, 3],
    ]],
    ['Cement', [
      [/\bcement\b/g, 5],
      [/\bclinker\b/g, 5],
      [/\bgrinding unit\b|\bcement plant\b/g, 4],
      [/\bMTPA\b.{0,30}cement/gi, 4],
      [/\bOPC\b|\bPPC\b|\bportland\b/g, 3],
    ]],
    ['Hotels & Hospitality', [
      [/\bhotels?\b/g, 3],
      [/\bhospitality\b/g, 4],
      [/\bRevPAR\b|\bADR\b|\boccupancy rate\b/g, 5],
      [/\bresort\b|\bbanquet\b|\brestaurant\b/g, 2],
      [/\bF&B\b.{0,20}revenue/gi, 3],
    ]],
    ['Aviation', [
      [/\baviation\b|\bairline\b/g, 5],
      [/\baircraft\b/g, 3],
      [/\bload factor\b|\bASK\b|\bRPK\b|\bCASK\b|\bRASK\b/g, 5],
      [/\bfleet\b.{0,20}aircraft/gi, 3],
    ]],
    ['Logistics & Warehousing', [
      [/\blogistics\b/g, 4],
      [/\b3PL\b|\bthird party logistics\b/g, 5],
      [/\bwarehous(?:e|ing)\b/g, 4],
      [/\bfreight\b|\btrucking\b|\bsupply chain solutions\b/g, 3],
      [/\bcontainer\b.{0,20}terminal/gi, 4],
    ]],
    ['Sugar / Agri Processing', [
      [/\bsugar mill\b|\bsugar refinery\b|\bsugar industry\b/g, 5],
      [/\bcane crushing\b|\bsugarcane\b/g, 4],
      [/\bethanol\b/g, 3],
      [/\bmolasses\b|\bbagasse\b/g, 4],
    ]],
    ['Steel & Metals', [
      [/\bsteel\b/g, 3],
      [/\baluminum\b|\baluminium\b/g, 4],
      [/\bcopper\b.{0,20}(?:smelt|cathode|refinery)/gi, 5],
      [/\bzinc\b.{0,20}smelter\b/gi, 5],
      [/\bblast furnace\b|\bHRC\b|\bCRC\b|\blong products\b/g, 4],
      [/\bferrochrome\b|\bferroalloy\b/g, 4],
    ]],
    ['Mining', [
      [/\bmining\b/g, 4],
      [/\biron ore\b|\bcoal mining\b|\bbauxite\b/g, 5],
      [/\bmineral processing\b/g, 3],
      [/\bopen.cast\b|\bunderground mine\b/g, 3],
    ]],
    ['Textiles & Apparel', [
      [/\btextile\b/g, 4],
      [/\byarn\b|\bspinning\b|\bweaving\b|\bfabric\b/g, 3],
      [/\bapparel\b|\bgarment\b/g, 4],
      [/\bdenim\b|\bcotton mill\b/g, 4],
    ]],
    ['Real Estate / Construction', [
      [/\breal estate\b/g, 5],
      [/\bresidential project\b|\bcommercial project\b/g, 4],
      [/\bbookings\b.{0,30}(?:saleable|carpet|sq\.?\s*ft)/gi, 4],
      [/\bdeveloper\b|\bbuilder\b/g, 2],
      [/\bcollections\b.{0,30}real estate/gi, 4],
    ]],
    ['Telecom', [
      [/\btelecom\b|\btelecommunication\b/g, 4],
      [/\bARPU\b/g, 5],
      [/\bsubscriber base\b|\bnet adds\b.{0,20}subscribers?\b/g, 4],
      [/\bspectrum\b|\b5G rollout\b|\b4G\b|\btower\b/g, 3],
    ]],
    ['Hospitals / Healthcare Services', [
      [/\bhospital\b/g, 4],
      [/\bbed capacity\b|\boccupancy.{0,15}bed/gi, 5],
      [/\bARPOB\b|\baverage revenue per occupied bed\b/g, 5],
      [/\bclinical services\b|\bsurger(?:y|ies)\b/g, 3],
    ]],
    ['Diagnostics & Pathology', [
      [/\bdiagnostics?\b/g, 5],
      [/\bpathology\b|\bpath lab\b/g, 5],
      [/\bradiology\b|\bimaging\b/g, 3],
      [/\btest count\b|\bbillable tests\b/g, 4],
    ]],
    ['Power Utility (Generation)', [
      [/\bpower generation\b|\bpower plant\b/g, 4],
      [/\bthermal power\b|\bcoal-based power\b/g, 4],
      [/\bhydro(?:electric)?\b/g, 3],
      [/\bPLF\b|\bplant load factor\b/g, 5],
      [/\bPPA\b|\bpower purchase agreement\b/g, 4],
    ]],
    ['Renewable Energy', [
      [/\brenewable energy\b|\bsolar power\b|\bwind power\b/g, 5],
      [/\bsolar EPC\b|\bwind EPC\b/g, 5],
      [/\bMW capacity\b.{0,40}(?:solar|wind|renewable)/gi, 4],
      [/\bmodule manufacturing\b/g, 4],
    ]],
    ['Insurance', [
      [/\binsurance\b/g, 3],
      [/\bAPE\b|\bannualized premium equivalent\b|\bnew business premium\b/g, 5],
      [/\bVNB\b|\bvalue of new business\b/g, 5],
      [/\blife insurance\b|\bgeneral insurance\b|\bhealth insurance\b/g, 4],
      [/\bclaims ratio\b|\bcombined ratio\b/g, 4],
    ]],
    ['Oil & Gas — Upstream', [
      [/\bcrude oil\b|\bnatural gas\b/g, 3],
      [/\bE&P\b|\bupstream\b|\bdrilling\b/g, 4],
      [/\boil block\b|\bproduction sharing contract\b/g, 5],
      [/\bbpd\b|\bbarrels per day\b|\bmmscfd\b/g, 4],
    ]],
    ['Oil & Gas — Refining & Marketing', [
      [/\brefiner(?:y|ies)\b/g, 5],
      [/\bGRM\b|\bgross refining margin\b/g, 5],
      [/\bdiesel\b.{0,20}retail\b/gi, 3],
      [/\bpetrol pumps?\b|\bfuel retail\b/g, 3],
    ]],
    ['Gas Distribution / CGD', [
      [/\bCGD\b|\bcity gas distribution\b/g, 5],
      [/\bPNG\b|\bCNG\b/g, 4],
      [/\bgas pipeline\b|\bgas transmission\b/g, 3],
    ]],
    ['Media / Print / Broadcasting', [
      [/\bprint media\b|\bnewspaper\b|\bperiodical\b/g, 4],
      [/\bbroadcasting\b|\bTV channels?\b|\bDTH\b/g, 4],
      [/\bcirculation revenue\b|\badvertising revenue\b/g, 4],
    ]],
    ['Tobacco / Cigarettes', [
      [/\btobacco\b/g, 5],
      [/\bcigarette\b/g, 5],
      [/\bsmokeless\b/g, 3],
    ]],
    ['Plantations / Tea / Coffee', [
      [/\btea\s+(?:plantation|estate|garden|crop)\b/g, 5],
      [/\bcoffee\s+(?:plantation|estate|crop)\b/g, 5],
      [/\brubber\s+plantation\b/g, 5],
      [/\bestate\b.{0,15}(?:hectare|acre)\b/gi, 3],
    ]],
    ['Retail & E-Commerce', [
      [/\bretail\s+(?:stores?|chain|business)\b/g, 4],
      [/\bsame[- ]store\s+sales\s+growth\b|\bSSSG\b/g, 5],
      [/\bgross merchandise value\b|\bGMV\b/g, 5],
      [/\be-commerce\b|\bonline retail\b/g, 4],
      [/\bstore count\b/g, 3],
    ]],
    ['Education / Edtech', [
      [/\beducation\s+services\b|\bedtech\b/g, 5],
      [/\bcoaching institute\b|\btest preparation\b/g, 4],
      [/\bstudent enrollment\b|\benrollments\b/g, 4],
      [/\bonline learning\b|\be-learning\b/g, 3],
    ]],
    ['Agrochemicals & Crop Protection', [
      [/\bagrochemical\b|\bcrop protection\b/g, 5],
      [/\bpesticide\b|\bherbicide\b|\bfungicide\b|\binsecticide\b/g, 4],
      [/\bactive ingredient\b.{0,15}agro/gi, 4],
    ]],
    ['API / Bulk Drugs', [
      [/\bactive pharmaceutical ingredient\b|\bAPI manufacturing\b/g, 5],
      [/\bbulk drugs?\b/g, 5],
      [/\bintermediates?\b.{0,15}pharma/gi, 4],
    ]],
  ];

  const scores: Array<{ sector: string; score: number }> = sectors.map(([sector, kws]) => {
    let s = 0;
    for (const [rx, w] of kws) {
      const matches = t.match(rx);
      if (matches) s += matches.length * w;
    }
    return { sector, score: s };
  });
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];

  // No signal at all → default industrial
  if (!top || top.score === 0) return 'Industrials / Capital Goods';

  // PATCH 0679 — Defence requires DOMINANT score (2× runner-up). A diesel
  // engines maker with a small defence vertical (KOEL pattern) should NOT
  // be tagged Defence. Pure-play defence names (HAL/BEL/MAZDOCK/BDL)
  // saturate the PDF and clear this hurdle.
  if (top.sector === 'Defence' && (!second || top.score < second.score * 2)) {
    return second?.score > 0 ? second.sector : 'Industrials / Capital Goods';
  }

  return top.sector;
}

// ─── Build the report ───────────────────────────────────────────────────
export async function buildReport(docs: ParsedDoc[]): Promise<AutoValuationReport> {
  // Aggregate data across all parsed docs
  const excelDoc = docs.find(d => d.excelData);
  const excelData = excelDoc?.excelData;
  const allText = docs.map(d => d.pdfText || '').join('\n\n');
  const allGuidance = docs.flatMap(d => d.guidance || []);

  // Resolve company + ticker
  let company = excelData?.company;
  let ticker = excelData?.ticker;

  // PATCH 0643 — PDF text patterns for ticker + company
  if (!ticker) {
    const patterns = [
      /\bNSE Symbol[:\s]+([A-Z]{2,12})\b/,
      /\bBSE Scrip Code[:\s]+(\d{5,6})\b/,
      /\bNSE:\s*([A-Z]{2,12})\b/,
      /\bBSE:\s*([A-Z]{2,12})\b/,
      /\(NSE:\s*([A-Z]{2,12})\)/,
      /\bSymbol[:\s]+([A-Z]{2,12})\b/,
      /\bTicker[:\s]+([A-Z]{2,12})\b/,
    ];
    for (const re of patterns) {
      const m = allText.match(re);
      if (m && m[1]) { ticker = m[1]; break; }
    }
  }
  // Company name from PDF: 'XYZ Technologies Limited' / 'XYZ Industries Ltd'
  // PATCH 0677 — Reject exchange/regulator names that frequently appear in
  // SEBI cover letters before the actual company name (e.g., "National Stock
  // Exchange of India Limited", "BSE Limited"). Also prefer the "For COMPANY
  // LIMITED" pattern at the bottom of cover letters — that's where the actual
  // filer signs off.
  if (!company) {
    const blacklist = /^(?:National Stock Exchange|Bombay Stock Exchange|BSE|NSE|Securities and Exchange Board|SEBI|Stock Exchange|Listing Department|Department of Corporate Services|General Manager)/i;
    // First try: explicit "For COMPANY LIMITED" sign-off pattern (most reliable)
    const signoff = allText.match(/\bFor\s+([A-Z][A-Z &]{4,50}(?:LIMITED|LTD\.?|CORPORATION|INC\.?))\b/);
    if (signoff && signoff[1] && !blacklist.test(signoff[1])) {
      company = signoff[1].trim();
    }
    // Second try: generic Title Case "XYZ Industries Limited" pattern, but skip blacklist
    if (!company) {
      const re = /\b([A-Z][A-Za-z &]{4,40}(?:Technologies|Industries|Limited|Ltd\.?|Corp\.?|Capital|Pharma|Solutions|Systems|Group|Holdings))\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(allText)) !== null) {
        if (!blacklist.test(m[1])) {
          company = m[1].trim();
          break;
        }
      }
    }
  }
  // Heuristic from filename — first WORD, not joined chars
  if (!ticker) {
    for (const d of docs) {
      const fn = d.name.replace(/\.[a-z]+$/i, '');
      const words = fn.split(/[^A-Za-z]+/).filter(w => w.length >= 3 && w.length <= 12);
      if (words.length === 0) continue;
      const upper = words[0].toUpperCase();
      if (/^(THE|FOR|FROM|WITH|ANNUAL|INVESTOR|EARNINGS|TRANSCRIPT|REPORT|PRESENTATION|TECHNOLOGIE|LIMITED|INDIA)$/i.test(upper)) continue;
      ticker = upper; break;
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
  // PATCH 0849 — FY26 dropped from the search list. Today is May 2026, so FY26 is
  // a REPORTED year (mostly), not a forward year. If guidance mentions FY26 it's
  // usually a retrospective phrase ('our FY26 revenue grew 18%'), not forward.
  // Project from FY27 onwards; the fallback below uses 'FY27 (projected)' when
  // no FY-tagged guidance is found.
  const fyOrder = ['FY27', 'FY28', 'FY29'];
  let forwardYear: string | undefined;
  let forwardRevenue: number | undefined;
  let forwardEBITDA: number | undefined;
  let forwardPAT: number | undefined;
  let inferredMargin: number | undefined;

  // PATCH 0653 — scenario-aware projections.
  // Each metric carries a (bear, base, bull) triplet so the downstream
  // calculators don't only vary the multiple — they also vary the
  // underlying forward value. For MTAR's "50% to 80% growth" range:
  //   bear = 50% growth, base = 65% growth, bull = 80% growth.
  let revScen: { bear?: number; base?: number; bull?: number } = {};
  let ebitdaScen: { bear?: number; base?: number; bull?: number } = {};
  let patScen: { bear?: number; base?: number; bull?: number } = {};
  let marginScen: { bear?: number; base?: number; bull?: number } = {};
  let growthScen: { bear?: number; base?: number; bull?: number } = {};
  let inferredGrowth: number | undefined;
  for (const fy of fyOrder.slice().reverse()) {  // start with FY29 going down
    const yearGuidance = allGuidance.filter(g => g.fiscalYear === fy);
    if (yearGuidance.length > 0) {
      const rev = yearGuidance.find(g => g.metric === 'REVENUE');
      const ebitda = yearGuidance.find(g => g.metric === 'EBITDA');
      const pat = yearGuidance.find(g => g.metric === 'PAT');
      const margin = yearGuidance.find(g => g.metric === 'EBITDA_MARGIN');
      const growth = yearGuidance.find(g => g.metric === 'GROWTH');
      if (rev || ebitda || pat || growth || margin) {
        forwardYear = fy;
        revScen = pickGuidanceScenarios(rev);
        ebitdaScen = pickGuidanceScenarios(ebitda);
        patScen = pickGuidanceScenarios(pat);
        marginScen = pickGuidanceScenarios(margin);
        growthScen = pickGuidanceScenarios(growth);
        forwardRevenue = revScen.base;
        forwardEBITDA = ebitdaScen.base;
        forwardPAT = patScen.base;
        inferredMargin = marginScen.base;
        inferredGrowth = growthScen.base;
        break;
      }
    }
  }

  // PATCH 0849 — Guidance vs historical sanity check. If extracted REVENUE
  // guidance is > 10× latest sales OR < 0.2× latest sales for a 1-yr horizon,
  // the extraction is almost certainly wrong (caught a different metric, market-
  // research industry-size number, etc). Reject the guidance value and fall
  // back to GROWTH-based or CAGR-based projection downstream.
  const _latestSalesGuard = excelData?.latestSales || 0;
  if (_latestSalesGuard > 0 && revScen.base !== undefined) {
    const _maxPlausible = _latestSalesGuard * 10;  // 10× allows 5-yr peak guidance
    // PATCH 1019 — tightened from 0.2× to 0.5×. The 0.2× bound let Rubicon's
    // bogus FY29 Revenue ₹500 Cr through (latest ₹1754 → 0.28× ratio passed).
    // Real forward guidance is virtually never below 50% of latest revenue;
    // anything lower is almost certainly a unit/metric confusion in the PDF.
    const _minPlausible = _latestSalesGuard * 0.5;
    if (revScen.base > _maxPlausible || revScen.base < _minPlausible) {
      console.warn(`[auto-val] Guidance sanity-clamp: REVENUE ₹${revScen.base.toFixed(0)} Cr implausible vs latest ₹${_latestSalesGuard.toFixed(0)} Cr — rejecting and falling back.`);
      revScen = {};
      forwardRevenue = undefined;
    }
  }
  // Same plausibility check for EBITDA / PAT relative to latest values
  if (excelData?.latestEBITDA && excelData.latestEBITDA > 0 && ebitdaScen.base !== undefined) {
    if (ebitdaScen.base > excelData.latestEBITDA * 15 || ebitdaScen.base < excelData.latestEBITDA * 0.1) {
      console.warn(`[auto-val] Guidance sanity-clamp: EBITDA ₹${ebitdaScen.base.toFixed(0)} Cr implausible vs latest ₹${excelData.latestEBITDA.toFixed(0)} Cr — rejecting.`);
      ebitdaScen = {};
      forwardEBITDA = undefined;
    }
  }
  if (excelData?.latestPAT && excelData.latestPAT > 0 && patScen.base !== undefined) {
    // PATCH 1019 — tightened floor 0.05× → 0.4× (extractor noise often grabs
    // small standalone numbers like '0.5 Cr capex' and tags them as PAT).
    if (patScen.base > excelData.latestPAT * 20 || patScen.base < excelData.latestPAT * 0.4) {
      console.warn(`[auto-val] Guidance sanity-clamp: PAT ₹${patScen.base.toFixed(0)} Cr implausible vs latest ₹${excelData.latestPAT.toFixed(0)} Cr — rejecting.`);
      patScen = {};
      forwardPAT = undefined;
    }
  }
  // PATCH 1019 — cross-validate forward PAT vs forward Revenue. PAT margin
  // > 50% is essentially impossible for any operating company (even pharma
  // majors peak at ~25%). Rubicon test: extractor assigned ₹500 Cr to BOTH
  // Revenue AND PAT, an obvious double-attribution bug. Reject PAT when it
  // exceeds 50% of forward Revenue (or equals Revenue).
  if (revScen.base !== undefined && patScen.base !== undefined && patScen.base >= revScen.base * 0.5) {
    console.warn(`[auto-val] Guidance sanity-clamp: PAT ₹${patScen.base.toFixed(0)} Cr >= 50% of Revenue ₹${revScen.base.toFixed(0)} Cr — almost certainly mis-attributed. Rejecting PAT, falling back to EBITDA→PAT chain.`);
    patScen = {};
    forwardPAT = undefined;
  }

  // PATCH 0653 — apply guided GROWTH% per scenario to latest sales when
  // no absolute revenue guidance was given. Each scenario picks the
  // corresponding growth bound.
  const latestSales = excelData?.latestSales || 0;
  if (!revScen.base && growthScen.base && latestSales > 0) {
    revScen = {
      bear: growthScen.bear !== undefined ? latestSales * (1 + growthScen.bear / 100) : undefined,
      base: latestSales * (1 + growthScen.base / 100),
      bull: growthScen.bull !== undefined ? latestSales * (1 + growthScen.bull / 100) : undefined,
    };
    forwardRevenue = revScen.base;
  }

  // PATCH 0653 — Scenario-aware derivation. The triplet flows from
  // revenue → EBITDA (via margin scenarios) → PAT (via historical
  // conversion). For each scenario, if absolute guidance is missing,
  // fall back to historical-CAGR / margin / conversion proxies.
  // PATCH 0664 — margin hierarchy: pick the best historical proxy, in priority:
  //   1. opmLatest  (latest fiscal year — best when growth has been normal)
  //   2. opmMedian3y (median of last 3 — smoothes outliers)
  //   3. opmAvg (5yr average — only when 1+2 unavailable)
  // ChatGPT critique: a single weak year was pulling MTAR's average to 7%
  // when latest-year + median both sit in the 22-25% range.
  const opmAvg = (() => {
    if (excelData?.opmLatest && excelData.opmLatest > 0) return excelData.opmLatest;
    if (excelData?.opmMedian3y && excelData.opmMedian3y > 0) return excelData.opmMedian3y;
    if (excelData?.opmAvg && excelData.opmAvg > 0) return excelData.opmAvg;
    return undefined;
  })();
  const opmSource: 'latest' | 'median3y' | '5yr-avg' | undefined =
    excelData?.opmLatest ? 'latest' :
    excelData?.opmMedian3y ? 'median3y' :
    excelData?.opmAvg ? '5yr-avg' : undefined;
  const yearsAhead = forwardYear === 'FY28' ? 2 : 1;

  // Step 1: ensure revScen has bear/base/bull populated.
  // PATCH 0849 — DECLINING-SALES GUARD. The original logic only fired for
  // positive CAGR; when 5y CAGR was negative OR latest year showed decline,
  // revScen stayed empty so the P/S calculator silently fell back to a
  // 10× P/S × latest sales — producing the Associated Alcohols +631% absurd.
  // Now: when no guidance found, always emit a fallback revScen, but
  //   - positive CAGR → project forward
  //   - negative/zero CAGR → flat (no growth) bear/base; mild recovery for bull
  if (!revScen.base && latestSales > 0) {
    const cagr = excelData?.salesCagr5y ?? 0;
    const safeCagr = Math.min(cagr, 50);  // P0845 clamp at 50% max (IPO stubs)
    if (safeCagr > 0) {
      const v = latestSales * Math.pow(1 + safeCagr / 100, yearsAhead);
      revScen = { bear: v * 0.85, base: v, bull: v * 1.15 };
    } else {
      // Declining business — no growth projection without guidance.
      // Bear assumes continued decline (5%/yr), base flat, bull mild recovery (5%/yr).
      revScen = {
        bear: latestSales * Math.pow(0.95, yearsAhead),
        base: latestSales,
        bull: latestSales * Math.pow(1.05, yearsAhead),
      };
    }
    if (!forwardYear) forwardYear = 'FY27 (projected)';
  }
  // Backfill missing scenario bounds from base when only one side exists.
  if (revScen.base !== undefined) {
    if (revScen.bear === undefined) revScen.bear = revScen.base;
    if (revScen.bull === undefined) revScen.bull = revScen.base;
  }

  // Step 2: derive EBITDA scenarios.
  // PATCH 0662 — track WHERE the margin came from so the rationale
  // honestly says "historical fallback" vs "guidance".
  const marginIsFromGuidance = marginScen.base !== undefined;
  const marginBear = marginScen.bear ?? marginScen.base ?? opmAvg;
  const marginBase = marginScen.base ?? opmAvg;
  const marginBull = marginScen.bull ?? marginScen.base ?? opmAvg;
  if (!ebitdaScen.base && revScen.base && marginBase) {
    ebitdaScen = {
      bear: revScen.bear !== undefined && marginBear ? revScen.bear * (marginBear / 100) : undefined,
      base: revScen.base * (marginBase / 100),
      bull: revScen.bull !== undefined && marginBull ? revScen.bull * (marginBull / 100) : undefined,
    };
  }
  // PATCH 0849 — Port P0845 EBITDA-margin sanity clamp from page.tsx into engine.ts
  // so the Concall AI InlineValuationPanel (which uses engine.ts) also benefits.
  // Triggered by Senores Pharma case: 385% Branded Generics revenue growth was
  // caught as EBITDA growth → 75% implied margin. The clamp forces a re-derive
  // from historical OPM when implied margin exceeds the sector-typical ceiling.
  if (ebitdaScen.base && revScen.base) {
    const impliedMargin = (ebitdaScen.base / revScen.base) * 100;
    const isFinancial = sector === 'Financial Services / NBFC' || sector === 'Insurance';
    const upperBound = isFinancial ? 80 : 50;  // banks/NBFCs/insurance can have higher
    if (impliedMargin > upperBound && opmAvg && opmAvg > 0 && opmAvg < upperBound) {
      const correctedBase = revScen.base * (opmAvg / 100);
      const correctedBear = (revScen.bear || revScen.base) * (opmAvg / 100);
      const correctedBull = (revScen.bull || revScen.base) * (opmAvg / 100);
      ebitdaScen = { bear: correctedBear, base: correctedBase, bull: correctedBull };
      console.warn(`[auto-val engine] EBITDA sanity-clamp fired: implied margin ${impliedMargin.toFixed(0)}% > ${upperBound}%, using opmAvg ${opmAvg.toFixed(1)}%`);
    }
  }
  // PATCH 0849 — PAT-margin > EBITDA-margin sanity. If our derived ebitdaScen
  // is internally inconsistent (very rare but possible when the extractor caught
  // a tabular PAT number), don't propagate. Just log a warning; the conversion
  // step below already uses historical EBITDA→PAT ratio safely.
  if (ebitdaScen.base !== undefined) {
    if (ebitdaScen.bear === undefined) ebitdaScen.bear = ebitdaScen.base;
    if (ebitdaScen.bull === undefined) ebitdaScen.bull = ebitdaScen.base;
  }

  // Step 3: derive PAT scenarios via historical EBITDA→PAT conversion.
  if (!patScen.base && ebitdaScen.base && excelData) {
    const latestEBITDA = excelData.latestEBITDA;
    const latestPAT = excelData.latestPAT;
    if (latestEBITDA && latestEBITDA > 0 && latestPAT) {
      const conv = latestPAT / latestEBITDA;
      if (conv > 0.1 && conv < 1.0) {
        patScen = {
          bear: ebitdaScen.bear !== undefined ? ebitdaScen.bear * conv : undefined,
          base: ebitdaScen.base * conv,
          bull: ebitdaScen.bull !== undefined ? ebitdaScen.bull * conv : undefined,
        };
      }
    }
  }
  // Final historical-CAGR fallback for PAT when EBITDA-conversion path failed.
  if (!patScen.base && excelData?.latestPAT && excelData?.patCagr5y && excelData.patCagr5y > 0) {
    const v = excelData.latestPAT * Math.pow(1 + excelData.patCagr5y / 100, yearsAhead);
    patScen = { bear: v, base: v, bull: v };
  }
  if (patScen.base !== undefined) {
    if (patScen.bear === undefined) patScen.bear = patScen.base;
    if (patScen.bull === undefined) patScen.bull = patScen.base;
  }

  // Sync the legacy single-value fields used downstream / in the saved report.
  forwardRevenue = revScen.base;
  forwardEBITDA = ebitdaScen.base;
  forwardPAT = patScen.base;
  if (!inferredMargin && marginBase) inferredMargin = marginBase;

  // Round for display.
  const roundScen = (s: typeof revScen) => ({
    bear: s.bear !== undefined ? Math.round(s.bear) : undefined,
    base: s.base !== undefined ? Math.round(s.base) : undefined,
    bull: s.bull !== undefined ? Math.round(s.bull) : undefined,
  });
  revScen = roundScen(revScen);
  ebitdaScen = roundScen(ebitdaScen);
  patScen = roundScen(patScen);
  if (forwardRevenue) forwardRevenue = Math.round(forwardRevenue);
  if (forwardEBITDA) forwardEBITDA = Math.round(forwardEBITDA);
  if (forwardPAT) forwardPAT = Math.round(forwardPAT);
  if (inferredMargin) inferredMargin = Math.round(inferredMargin * 10) / 10;

  // PATCH 1017 — Sector-typed secondary bands for non-preferred metrics.
  // Without this, when sector is e.g. Auto Components (EV/EBITDA preferred),
  // the P/E and P/S bands stay at generic 25x / 3.5x — producing the misleading
  // '+380% P/S upside' for stocks that actually trade at ~1x P/S. Secondary
  // bands are derived from the preferred multiple's midpoint using empirical
  // sector conversion ratios.
  function deriveSecondaryBands(
    primary: 'PE' | 'PS' | 'EV_EBITDA',
    primaryMid: number,
    sec: string
  ): { PE?: { bear: number; base: number; bull: number }; PS?: { bear: number; base: number; bull: number }; EV_EBITDA?: { bear: number; base: number; bull: number } } {
    const out: { PE?: any; PS?: any; EV_EBITDA?: any } = {};
    const rnd = (n: number, d = 1): number => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    if (primary === 'EV_EBITDA') {
      out.PE = { bear: rnd(primaryMid * 1.0), base: rnd(primaryMid * 1.4), bull: rnd(primaryMid * 1.9) };
      out.PS = { bear: rnd(primaryMid * 0.08, 2), base: rnd(primaryMid * 0.12, 2), bull: rnd(primaryMid * 0.18, 2) };
    } else if (primary === 'PE') {
      const psFactor = /Defence|FMCG|Insurance|Pharma|AI Infra|Rail/i.test(sec) ? 0.22 : 0.14;
      out.EV_EBITDA = { bear: rnd(primaryMid * 0.50), base: rnd(primaryMid * 0.70), bull: rnd(primaryMid * 0.95) };
      out.PS = { bear: rnd(primaryMid * psFactor * 0.7, 2), base: rnd(primaryMid * psFactor, 2), bull: rnd(primaryMid * psFactor * 1.6, 2) };
    } else {
      out.PE = { bear: rnd(primaryMid * 5), base: rnd(primaryMid * 8), bull: rnd(primaryMid * 15) };
      out.EV_EBITDA = { bear: rnd(primaryMid * 3), base: rnd(primaryMid * 5), bull: rnd(primaryMid * 8) };
    }
    return out;
  }

  // Sector → multiple lookup
  const sectorConf = sector ? SECTOR_CALCULATOR_MAP[sector] : undefined;
  // PATCH 0849 — sector-aware defaults. The old 5/10/18 P/S default was
  // wildly inappropriate for sectors with sub-3× P/S norms (liquor,
  // textiles, sugar, refining, mining, oil&gas upstream). Use far more
  // conservative defaults; sector-specific bands kick in below when
  // sectorConf is found.
  const _salesDecliningHere = (excelData?.salesCagr5y ?? 0) < 0;
  const defaults = {
    PE:        { bear: 18, base: 25, bull: 35 },
    PS:        _salesDecliningHere
                 ? { bear: 0.8, base: 1.5, bull: 2.5 }     // declining → P/S compressed
                 : { bear: 2,   base: 3.5, bull: 6 },       // generic conservative default
    EV_EBITDA: { bear: 10, base: 14, bull: 20 },
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
      // PATCH 1017 — derive secondary bands so all 3 calculators are sector-tuned
      const secondary = deriveSecondaryBands(sectorConf.calc, mid, sector || '');
      if (secondary.PE && sectorConf.calc !== 'PE') defaults.PE = secondary.PE;
      if (secondary.PS && sectorConf.calc !== 'PS') defaults.PS = secondary.PS;
      if (secondary.EV_EBITDA && sectorConf.calc !== 'EV_EBITDA') defaults.EV_EBITDA = secondary.EV_EBITDA;
    }
  }

  // PATCH 0641 — fallback chain for market cap / price / shares:
  //   1. Live quote from /api/market/quotes
  //   2. Excel template META block (rows 6-9)
  //   3. (manual) — user can adjust on /valuation-calc later
  const currentMarketCapCr = quote?.currentMarketCapCr
    || excelData?.currentMarketCapCrFromSheet
    || 0;
  const currentPrice = quote?.currentPrice || excelData?.currentPriceFromSheet;
  const sharesOutstandingCr = quote?.sharesOutstandingCr || excelData?.sharesOutstandingCr;
  const horizonMonths = 18;
  const baseCalcInput = {
    ticker,
    company,
    currentMarketCapCr,
    horizonMonths,
    currentPrice,
    sharesOutstandingCr,
    currency: '₹' as const,
  };

  // PATCH 0653 — scenario-aware calculator runs. Each calc runs three
  // times — once per scenario value — and we pick the matching case
  // from each. Result: BEAR uses (low forward × low multiple), BASE
  // uses (mid × mid), BULL uses (high × high). This is the proper
  // institutional bear/base/bull layering.
  const mergeScenarioCalc = <T extends CalculatorResult>(
    runner: (forward: number, multBear: number, multBase: number, multBull: number) => T,
    scen: { bear?: number; base?: number; bull?: number },
    multBear: number,
    multBase: number,
    multBull: number,
  ): T | undefined => {
    if (scen.base === undefined) return undefined;
    const bearRun = runner(scen.bear ?? scen.base, multBear, multBase, multBull);
    const baseRun = runner(scen.base, multBear, multBase, multBull);
    const bullRun = runner(scen.bull ?? scen.base, multBear, multBase, multBull);
    const cases = [
      bearRun.cases.find(c => c.label === 'BEAR')!,
      baseRun.cases.find(c => c.label === 'BASE')!,
      bullRun.cases.find(c => c.label === 'BULL')!,
    ];
    return { ...baseRun, cases };
  };

  const peResult = patScen.base && currentMarketCapCr > 0
    ? mergeScenarioCalc(
        (f, mb, m, mu) => calculatePE({ ...baseCalcInput, forwardPATCr: f, bearPE: mb, basePE: m, bullPE: mu }),
        patScen,
        defaults.PE.bear, defaults.PE.base, defaults.PE.bull,
      )
    : undefined;
  const psResult = revScen.base && currentMarketCapCr > 0
    ? mergeScenarioCalc(
        (f, mb, m, mu) => calculatePS({ ...baseCalcInput, forwardRevenueCr: f, bearPS: mb, basePS: m, bullPS: mu }),
        revScen,
        defaults.PS.bear, defaults.PS.base, defaults.PS.bull,
      )
    : undefined;
  const evResult = ebitdaScen.base && currentMarketCapCr > 0
    ? mergeScenarioCalc(
        (f, mb, m, mu) => calculateEvEbitda({ ...baseCalcInput, forwardEBITDACr: f, bearMultiple: mb, baseMultiple: m, bullMultiple: mu }),
        ebitdaScen,
        defaults.EV_EBITDA.bear, defaults.EV_EBITDA.base, defaults.EV_EBITDA.bull,
      )
    : undefined;

  // PATCH 0657 — Year 2 projections (FY28). Apply guided growth one more
  // year on top of FY27 (or whichever forwardYear was picked). Margins
  // assumed to hold flat at the guided rate. Horizon is 30 months (2.5 yr
  // entry-to-target window typical for institutional 2-yr models).
  const horizonMonthsY2 = 30;
  const growthBear = growthScen.bear ?? (excelData?.salesCagr5y);
  const growthBase = growthScen.base ?? (excelData?.salesCagr5y);
  const growthBull = growthScen.bull ?? (excelData?.salesCagr5y);
  // Year 2 scenario triplets — apply growth once more to Y1 values.
  const revScenY2 = {
    bear: revScen.bear !== undefined && growthBear ? Math.round(revScen.bear * (1 + growthBear / 100)) : undefined,
    base: revScen.base !== undefined && growthBase ? Math.round(revScen.base * (1 + growthBase / 100)) : undefined,
    bull: revScen.bull !== undefined && growthBull ? Math.round(revScen.bull * (1 + growthBull / 100)) : undefined,
  };
  const marginBaseY2 = marginScen.base ?? opmAvg;
  const ebitdaScenY2 = {
    bear: revScenY2.bear !== undefined && (marginScen.bear ?? opmAvg) ? Math.round(revScenY2.bear * ((marginScen.bear ?? opmAvg)! / 100)) : undefined,
    base: revScenY2.base !== undefined && marginBaseY2 ? Math.round(revScenY2.base * (marginBaseY2 / 100)) : undefined,
    bull: revScenY2.bull !== undefined && (marginScen.bull ?? opmAvg) ? Math.round(revScenY2.bull * ((marginScen.bull ?? opmAvg)! / 100)) : undefined,
  };
  // PAT via same EBITDA→PAT conversion ratio used for Y1
  const conv = (excelData?.latestEBITDA && excelData.latestEBITDA > 0 && excelData?.latestPAT)
    ? excelData.latestPAT / excelData.latestEBITDA
    : undefined;
  const validConv = (conv !== undefined && conv > 0.1 && conv < 1.0) ? conv : undefined;
  const patScenY2 = {
    bear: ebitdaScenY2.bear !== undefined && validConv ? Math.round(ebitdaScenY2.bear * validConv) : undefined,
    base: ebitdaScenY2.base !== undefined && validConv ? Math.round(ebitdaScenY2.base * validConv) : undefined,
    bull: ebitdaScenY2.bull !== undefined && validConv ? Math.round(ebitdaScenY2.bull * validConv) : undefined,
  };
  // Compute the FY label (FY28 if Y1 was FY27, FY29 if Y1 was FY28, etc.)
  const forwardYearY2 = (() => {
    if (!forwardYear) return undefined;
    const m = forwardYear.match(/FY(\d+)/);
    if (!m) return forwardYear + ' +1y';
    return `FY${parseInt(m[1], 10) + 1}`;
  })();

  const calcInputY2 = { ...baseCalcInput, horizonMonths: horizonMonthsY2 };
  const peResultY2 = patScenY2.base && currentMarketCapCr > 0
    ? mergeScenarioCalc(
        (f, mb, m, mu) => calculatePE({ ...calcInputY2, forwardPATCr: f, bearPE: mb, basePE: m, bullPE: mu }),
        patScenY2,
        defaults.PE.bear, defaults.PE.base, defaults.PE.bull,
      )
    : undefined;
  const psResultY2 = revScenY2.base && currentMarketCapCr > 0
    ? mergeScenarioCalc(
        (f, mb, m, mu) => calculatePS({ ...calcInputY2, forwardRevenueCr: f, bearPS: mb, basePS: m, bullPS: mu }),
        revScenY2,
        defaults.PS.bear, defaults.PS.base, defaults.PS.bull,
      )
    : undefined;
  const evResultY2 = ebitdaScenY2.base && currentMarketCapCr > 0
    ? mergeScenarioCalc(
        (f, mb, m, mu) => calculateEvEbitda({ ...calcInputY2, forwardEBITDACr: f, bearMultiple: mb, baseMultiple: m, bullMultiple: mu }),
        ebitdaScenY2,
        defaults.EV_EBITDA.bear, defaults.EV_EBITDA.base, defaults.EV_EBITDA.bull,
      )
    : undefined;

  // PATCH 0664 — Weighted recommendation. Per ChatGPT critique:
  //   P/S  = 45% weight (most reliable for growth/scale-up names; rev guidance is the most credible input)
  //   P/E  = 35% weight (decent but PAT depends on EBITDA chain quality)
  //   EV/EBITDA = 20% weight (most sensitive to margin extraction accuracy)
  // Per-calc confidence is HIGH when guidance was found, LOW when fallback used.
  const psBase = psResult?.cases.find(c => c.label === 'BASE')?.upsidePct;
  const peBase = peResult?.cases.find(c => c.label === 'BASE')?.upsidePct;
  const evBase = evResult?.cases.find(c => c.label === 'BASE')?.upsidePct;
  const revFromGuidance = !!revScen.base && (allGuidance.some(g => g.metric === 'REVENUE' || g.metric === 'GROWTH'));
  const patFromGuidance = !!patScen.base && (allGuidance.some(g => g.metric === 'PAT'));
  const evValid = marginIsFromGuidance || (opmSource === 'latest' || opmSource === 'median3y');
  const psConfidence: 'HIGH' | 'MED' | 'LOW' = revFromGuidance ? 'HIGH' : 'MED';
  const peConfidence: 'HIGH' | 'MED' | 'LOW' = patFromGuidance ? 'HIGH' : (revFromGuidance ? 'MED' : 'LOW');
  const evConfidence: 'HIGH' | 'MED' | 'LOW' = marginIsFromGuidance ? 'HIGH' : (evValid ? 'MED' : 'LOW');
  // PATCH 0678 — explicit per-calc reason. Build a one-line "why this confidence"
  // from the source flags so the UI can render it under each chip.
  const psReason = revFromGuidance
    ? `Forward Revenue ₹${revScen.base?.toFixed(0) || '?'} Cr from PDF guidance — high signal.`
    : `Forward Revenue ₹${revScen.base?.toFixed(0) || '?'} Cr derived from historical ${excelData?.salesCagr5y?.toFixed(0) || '?'}% sales CAGR — no PDF guidance found.`;
  const peReason = patFromGuidance
    ? `Forward PAT ₹${patScen.base?.toFixed(0) || '?'} Cr from explicit PDF guidance.`
    : revFromGuidance
      ? `Forward PAT ₹${patScen.base?.toFixed(0) || '?'} Cr derived from guided revenue × historical EBITDA→PAT conversion (no direct PAT guidance).`
      : `Forward PAT ₹${patScen.base?.toFixed(0) || '?'} Cr derived from historical CAGR + EBITDA chain (no guidance found).`;
  const evReason = marginIsFromGuidance
    ? `Forward EBITDA ₹${ebitdaScen.base?.toFixed(0) || '?'} Cr — margin ${inferredMargin?.toFixed(0) || '?'}% from PDF guidance.`
    : opmSource === 'latest'
      ? `Forward EBITDA ₹${ebitdaScen.base?.toFixed(0) || '?'} Cr — margin ${inferredMargin?.toFixed(0) || '?'}% from latest-year historical OPM (no guidance).`
      : opmSource === 'median3y'
        ? `Forward EBITDA ₹${ebitdaScen.base?.toFixed(0) || '?'} Cr — margin ${inferredMargin?.toFixed(0) || '?'}% from 3-yr median OPM (no guidance).`
        : `Forward EBITDA ₹${ebitdaScen.base?.toFixed(0) || '?'} Cr — margin ${inferredMargin?.toFixed(0) || '?'}% from 5-yr avg OPM (no guidance).`;
  const weighted: Array<{ w: number; v: number }> = [];
  if (psBase !== undefined) weighted.push({ w: 0.45 * (psConfidence === 'HIGH' ? 1 : psConfidence === 'MED' ? 0.7 : 0.3), v: psBase });
  if (peBase !== undefined) weighted.push({ w: 0.35 * (peConfidence === 'HIGH' ? 1 : peConfidence === 'MED' ? 0.7 : 0.3), v: peBase });
  if (evBase !== undefined) weighted.push({ w: 0.20 * (evConfidence === 'HIGH' ? 1 : evConfidence === 'MED' ? 0.7 : 0.3), v: evBase });
  const sumW = weighted.reduce((a, b) => a + b.w, 0);
  // PATCH 0849 — NaN/Infinity guards. Bad sectorConf or zero currentMarketCapCr
  // can produce NaN upsides that silently propagate to BUY recommendation.
  const _rawAvg = sumW > 0 ? weighted.reduce((a, b) => a + b.w * b.v, 0) / sumW : 0;
  const avgBaseUpside = Number.isFinite(_rawAvg) ? _rawAvg : 0;
  const baseUpsides = [peResult, psResult, evResult]
    .filter((r): r is CalculatorResult => !!r)
    .map(r => r.cases.find(c => c.label === 'BASE')?.upsidePct ?? 0);

  let recommendation: AutoValuationReport['recommendation'] = 'NEED_MORE_DATA';
  const rationale: string[] = [];
  // PATCH 0849 — sanity checks before issuing recommendation
  const salesDeclining = (excelData?.salesCagr5y ?? 0) < 0;
  const latestPATNegative = (excelData?.latestPAT ?? 0) < 0;
  const extremeUpside = Math.abs(avgBaseUpside) > 250;
  const extremeUpsideDirection = avgBaseUpside > 250 ? 'UP' : avgBaseUpside < -75 ? 'DOWN' : 'OK';
  if (baseUpsides.length === 0) {
    rationale.push('Insufficient data — need both forward guidance and a live quote (or ticker hit on /api/market/quotes) to produce a valuation.');
  } else {
    if (avgBaseUpside >= 50) { recommendation = 'BUY'; rationale.push(`Base-case upside ${avgBaseUpside.toFixed(0)}% across ${baseUpsides.length} calculator(s) — strong buy zone.`); }
    else if (avgBaseUpside >= 25) { recommendation = 'WATCH'; rationale.push(`Base-case upside ${avgBaseUpside.toFixed(0)}% — solid but not exceptional. Wait for a better entry.`); }
    else if (avgBaseUpside >= 0) { recommendation = 'WAIT'; rationale.push(`Base-case upside only ${avgBaseUpside.toFixed(0)}% — fairly valued. Need re-rating catalyst or earnings surprise.`); }
    else { recommendation = 'AVOID'; rationale.push(`Base-case implies DOWNSIDE ${avgBaseUpside.toFixed(0)}% — multiples already stretched.`); }

    // SANITY DOWNGRADE 1 — declining sales + BUY → max WATCH
    if (recommendation === 'BUY' && salesDeclining) {
      recommendation = 'WATCH';
      rationale.unshift(`⚠ DECLINING-SALES SANITY: 5y sales CAGR ${(excelData?.salesCagr5y ?? 0).toFixed(0)}% (negative). BUY downgraded to WATCH — wait for revenue turnaround before chasing.`);
    }
    // SANITY DOWNGRADE 2 — extreme upside (>250%) → max WATCH; flag model artifact
    if (extremeUpsideDirection === 'UP' && (recommendation === 'BUY')) {
      recommendation = 'WATCH';
      rationale.unshift(`⚠ EXTREME-UPSIDE SANITY: ${avgBaseUpside.toFixed(0)}% upside is almost certainly a model artifact (aggressive multiples × IPO-stub CAGR × margin extraction error). Downgraded to WATCH. Cross-check sector multiple band, OPM proxy, and forward growth rate manually.`);
    }
    // SANITY DOWNGRADE 3 — negative latest PAT + BUY → max WATCH
    if (recommendation === 'BUY' && latestPATNegative) {
      recommendation = 'WATCH';
      rationale.unshift(`⚠ LOSS-MAKING SANITY: Latest PAT ₹${(excelData?.latestPAT ?? 0).toFixed(0)} Cr (negative). BUY downgraded to WATCH — wait for profitability inflection.`);
    }
  }
  if (excelData?.salesCagr5y && excelData.salesCagr5y > 20) rationale.push(`Strong 5yr sales CAGR ${excelData.salesCagr5y.toFixed(0)}%.`);
  if (excelData?.opmAvg && excelData.opmAvg > 18) rationale.push(`Healthy 5yr avg OPM ${excelData.opmAvg.toFixed(0)}%.`);
  if (sector) rationale.push(`Sector: ${sector} → ${sectorConf?.calc === 'EV_EBITDA' ? 'EV/EBITDA' : sectorConf?.calc || 'P/E'} preferred; multiple ${sectorConf?.multipleHint || 'sector default'}.`);
  if (forwardYear) rationale.push(`Forward year used: ${forwardYear}. Revenue ₹${forwardRevenue?.toFixed(0) || '?'} Cr · EBITDA ₹${forwardEBITDA?.toFixed(0) || '?'} Cr · PAT ₹${forwardPAT?.toFixed(0) || '?'} Cr.`);
  // PATCH 0652 — surface what guidance was actually applied so the
  // user can see whether management's growth/margin guidance flowed
  // through to the projection.
  if (inferredGrowth) rationale.push(`Applied guided revenue growth: ${inferredGrowth.toFixed(0)}% → forward revenue.`);
  // PATCH 0662 — honest source label: guidance vs historical fallback.
  // PATCH 0664 — refined: name the specific historical source used.
  if (inferredMargin) {
    if (marginIsFromGuidance) {
      rationale.push(`Applied GUIDED EBITDA margin: ${inferredMargin.toFixed(0)}% → forward EBITDA.`);
    } else {
      const sourceLabel = opmSource === 'latest' ? 'latest-year OPM'
        : opmSource === 'median3y' ? '3-yr median OPM'
        : '5-yr average OPM';
      rationale.push(`⚠ Margin guidance NOT found in PDFs. Used ${sourceLabel} ${inferredMargin.toFixed(1)}% as fallback. If management guided expansion (concall mentions "margins of X%" / "margin expansion"), use the Override panel below to set the right margin.`);
    }
  }
  // PATCH 0657 — surface Y2 projection so user knows the 2yr view is computed
  if (forwardYearY2 && revScenY2.base) {
    rationale.push(`Year-2 (${forwardYearY2}): Revenue ₹${revScenY2.base.toFixed(0)} Cr · EBITDA ₹${ebitdaScenY2.base?.toFixed(0) || '?'} Cr · PAT ₹${patScenY2.base?.toFixed(0) || '?'} Cr (toggle in calc panel).`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PATCH 0851 — Institutional chips computed from excelData
  // ════════════════════════════════════════════════════════════════════════
  let marginInflectionChip: AutoValuationReport['marginInflectionChip'];
  let forensicPumpChip: AutoValuationReport['forensicPumpChip'];
  let dnaMatchChip: AutoValuationReport['dnaMatchChip'];
  let salesAccelChip: AutoValuationReport['salesAccelChip'];
  let cashConversionChip: AutoValuationReport['cashConversionChip'];

  if (excelData) {
    // Re-derive opmList for chip computation
    const opmList = excelData.operatingProfit.map((op, i) => {
      const s = excelData.sales[i];
      if (op != null && s != null && s > 0) return (op / s) * 100;
      return null;
    }).filter((v): v is number => v != null);

    // ── 1. Margin inflection chip (P0851 #2)
    if (opmList.length >= 4) {
      const latestQ = (typeof excelData.opmLatest === 'number') ? excelData.opmLatest : opmList[opmList.length - 1];
      const trailing3 = opmList.slice(-4, -1);
      const trailingAvg = (typeof excelData.opmMedian3y === 'number') ? excelData.opmMedian3y : (trailing3.reduce((a, b) => a + b, 0) / trailing3.length);
      const gapPp = latestQ - trailingAvg;
      const direction = gapPp > 2 ? 'EXPANSION' : gapPp < -2 ? 'COMPRESSION' : 'STABLE';
      const interpretation =
        direction === 'EXPANSION' ? `⚡ Margin inflection: latest OPM ${latestQ.toFixed(1)}% vs 3-yr avg ${trailingAvg.toFixed(1)}% (+${gapPp.toFixed(1)}pp). Operating-leverage story.` :
        direction === 'COMPRESSION' ? `▼ Margin compression: latest OPM ${latestQ.toFixed(1)}% vs 3-yr avg ${trailingAvg.toFixed(1)}% (${gapPp.toFixed(1)}pp). Cost pressure or cycle peak rolled off.` :
        `Margin stable: latest ${latestQ.toFixed(1)}% vs 3-yr ${trailingAvg.toFixed(1)}%.`;
      marginInflectionChip = { fired: direction === 'EXPANSION', latestQ, trailingAvg, gapPp, direction, interpretation };
    }

    // ── 2. Sales acceleration chip
    if (excelData.salesCagr5y !== undefined && excelData.sales.length >= 2) {
      const lastIdx = excelData.sales.length - 1;
      const lastSales = excelData.sales[lastIdx] || 0;
      const prevSales = excelData.sales[lastIdx - 1] || 0;
      if (lastSales > 0 && prevSales > 0) {
        const latestYoY = ((lastSales - prevSales) / prevSales) * 100;
        const delta = latestYoY - excelData.salesCagr5y;
        const state = delta > 5 ? 'ACCELERATING' : delta < -5 ? 'DECELERATING' : 'STABLE';
        salesAccelChip = { latestYoY, cagr5y: excelData.salesCagr5y, delta, state };
      }
    }

    // ── 3. Cash conversion (rough heuristic — CFO row often not parsed; flag for now)
    cashConversionChip = {
      cfoToPat: undefined,
      note: 'Cash conversion (CFO/PAT) requires Screener "Cash from Operating Activity" column. Add to upload for full picture.',
    };

    // ── 4. Forensic pump-score (P0851 #3) — adapted lightweight from multibagger lib
    const flags: string[] = [];
    let pumpScore = 0;
    const latestSales_ = excelData.latestSales || 0;
    const latestPAT_ = excelData.latestPAT || 0;
    const mcapNow = (quote?.currentMarketCapCr) || excelData.currentMarketCapCrFromSheet || 0;
    // (a) Microcap with extreme sales surge + weak CFO conversion (story-stock pattern)
    if (mcapNow > 0 && mcapNow < 3000) {
      if ((excelData.salesCagr5y || 0) > 35 && latestPAT_ > 0) {
        flags.push('Microcap + >35% sales CAGR — verify cash conversion');
        pumpScore += 1;
      }
    }
    // (b) Margin compression with growth-deceleration combo (cycle peak passed)
    if (marginInflectionChip?.direction === 'COMPRESSION' && salesAccelChip?.state === 'DECELERATING') {
      flags.push('Margin compression + sales decel — cycle peak passed');
      pumpScore += 2;
    }
    // (c) IPO-stub CAGR (5y CAGR > 80% almost always a recent listing distortion)
    if ((excelData.salesCagr5y || 0) > 80) {
      flags.push('5y CAGR >80% — IPO-stub distortion likely');
      pumpScore += 1;
    }
    // (d) Microcap + below-floor share count (<3 Cr shares = 30M shares = manipulable)
    if (mcapNow > 0 && mcapNow < 1000 && (excelData.sharesOutstandingCr || 99) < 3) {
      flags.push('<3 Cr shares + microcap — thin float');
      pumpScore += 2;
    }
    // (e) PAT margin > EBITDA margin impossibility (extractor mishap or accrual abuse)
    const _opmAvg = excelData.opmLatest || excelData.opmAvg || 0;
    if (latestSales_ > 0 && latestPAT_ > 0) {
      const _patMargin = (latestPAT_ / latestSales_) * 100;
      if (_patMargin > _opmAvg && _opmAvg > 0) {
        flags.push(`PAT margin ${_patMargin.toFixed(1)}% > EBITDA margin ${_opmAvg.toFixed(1)}% — accounting anomaly`);
        pumpScore += 2;
      }
    }
    const severity: 'CLEAN' | 'WATCH' | 'HIGH' | 'CRITICAL' =
      pumpScore >= 5 ? 'CRITICAL' :
      pumpScore >= 3 ? 'HIGH' :
      pumpScore >= 1 ? 'WATCH' : 'CLEAN';
    forensicPumpChip = { pumpScore, severity, flags };

    // ── 5. 500-bagger DNA matcher (lightweight — 6 criteria we can check from Excel alone)
    const dnaCriteria: string[] = [];
    let dnaMatched = 0;
    if (_opmAvg >= 20) { dnaMatched++; dnaCriteria.push(`ROCE-proxy OPM ${_opmAvg.toFixed(0)}% ≥ 20%`); }
    if ((excelData.salesCagr5y || 0) >= 18) { dnaMatched++; dnaCriteria.push(`5y Sales CAGR ${(excelData.salesCagr5y || 0).toFixed(0)}% ≥ 18%`); }
    if ((excelData.patCagr5y || 0) >= 18) { dnaMatched++; dnaCriteria.push(`5y PAT CAGR ${(excelData.patCagr5y || 0).toFixed(0)}% ≥ 18%`); }
    if (forensicPumpChip.severity === 'CLEAN') { dnaMatched++; dnaCriteria.push('No forensic pump flags'); }
    if (salesAccelChip && salesAccelChip.state === 'ACCELERATING') { dnaMatched++; dnaCriteria.push('Sales accelerating'); }
    if (marginInflectionChip && marginInflectionChip.direction === 'EXPANSION') { dnaMatched++; dnaCriteria.push('Margin inflection (expansion)'); }
    const dnaTotal = 6;
    dnaMatchChip = { matched: dnaMatched, criteria: dnaCriteria, pass: dnaMatched >= dnaTotal - 2 };

    // Surface margin inflection in rationale
    if (marginInflectionChip?.fired) {
      rationale.unshift(`⚡ MARGIN INFLECTION DETECTED: ${marginInflectionChip.interpretation}`);
    }
    if (forensicPumpChip.severity === 'HIGH' || forensicPumpChip.severity === 'CRITICAL') {
      rationale.unshift(`🚨 FORENSIC PUMP WATCH (${forensicPumpChip.pumpScore}/11 flags, ${forensicPumpChip.severity}): ${forensicPumpChip.flags.slice(0, 2).join(' · ')}`);
    }
  }

  // PATCH 0877 — Filter the DISPLAYED guidance items through the same
  // plausibility gate that 0849 already applies to the valuation chain.
  // Previously the panel "📋 Forward Guidance Extracted (N)" showed every
  // item the regex matched — including page numbers (`14 NGL Fine-Chem`)
  // and footer noise that the valuation engine had already discarded.
  // For NGL Fine Chem this surfaced "Revenue FY22 ₹14 Cr" repeatedly when
  // the real revenue was ₹500 Cr. Apply the same min/max bounds here.
  const _lsales = excelData?.latestSales || 0;
  const _lebitda = excelData?.latestEBITDA || 0;
  const _lpat = excelData?.latestPAT || 0;
  const _step1: GuidanceItem[] = allGuidance.filter((g) => {
    // Always keep non-monetary metrics (margins, growth %, days, units, bps)
    if (g.unit !== '₹ Cr') return true;
    const v = g.point ?? g.high ?? g.low ?? 0;
    if (v <= 0) return true; // can't validate, let it through
    if (g.metric === 'REVENUE' || g.metric === 'PEAK_REVENUE') {
      if (_lsales > 0 && (v > _lsales * 10 || v < _lsales * 0.2)) return false;
    } else if (g.metric === 'EBITDA') {
      if (_lebitda > 0 && (v > _lebitda * 15 || v < _lebitda * 0.1)) return false;
    } else if (g.metric === 'PAT') {
      if (_lpat > 0 && (v > _lpat * 20 || v < _lpat * 0.05)) return false;
    }
    return true;
  });
  // PATCH 0880 — Duplicate-value dedup. When the extractor finds the same
  // numeric value attached to 4+ different FYs for the same metric, that's
  // almost always a single noise-match being attributed to every FY token
  // found in the document (the NGL Fine Chem case: "Capacity Ramp 10% × 5
  // years"). Real guidance varies year-over-year. Drop those clusters.
  const _valueCount = new Map<string, number>();
  for (const g of _step1) {
    const v = g.point ?? g.high ?? g.low ?? 0;
    if (v <= 0) continue;
    const key = `${g.metric}::${v.toFixed(2)}`;
    _valueCount.set(key, (_valueCount.get(key) || 0) + 1);
  }
  const guidanceFiltered: GuidanceItem[] = _step1.filter((g) => {
    const v = g.point ?? g.high ?? g.low ?? 0;
    if (v <= 0) return true;
    const key = `${g.metric}::${v.toFixed(2)}`;
    // 4+ identical values for the same metric = noise pattern. Drop all.
    return (_valueCount.get(key) || 0) < 4;
  });
  const guidanceRejectedCount = allGuidance.length - guidanceFiltered.length;
  if (guidanceRejectedCount > 0) {
    rationale.push(`Guidance filter: ${guidanceRejectedCount} extractor matches dropped as implausible vs latest reported numbers (page-number noise / wrong-metric matches).`);
  }

  return {
    ticker, company, sector,
    quote: quote || undefined,
    excelData,
    guidance: guidanceFiltered,
    forwardYear, forwardRevenue, forwardEBITDA, forwardPAT, inferredMargin,
    peResult, psResult, evResult,
    // PATCH 0657 — Y2 projections
    forwardYearY2,
    forwardRevenueY2: revScenY2.base,
    forwardEBITDAY2: ebitdaScenY2.base,
    forwardPATY2: patScenY2.base,
    peResultY2, psResultY2, evResultY2,
    recommendation, rationale,
    // PATCH 1017 — surface MCap on report (page header was reading quote-only)
    currentMarketCapCr: currentMarketCapCr || undefined,
    peConfidence, psConfidence, evConfidence,
    peReason, psReason, evReason,
    // PATCH 0851 — institutional chips
    marginInflectionChip,
    forensicPumpChip,
    dnaMatchChip,
    salesAccelChip,
    cashConversionChip,
  };
}

