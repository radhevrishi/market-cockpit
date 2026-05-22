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
// PATCH 0649 — per-company persistence
import {
  saveAutoValuation, loadAutoValuation, deleteAutoValuation, listAutoValuations, appendDocsToSaved,
  type SavedAutoValuation, type SavedDocSnapshot,
} from '@/lib/auto-valuation-store';

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
  // PATCH 0664 — per-calc confidence so the UI can dim low-confidence cards
  peConfidence?: 'HIGH' | 'MED' | 'LOW';
  psConfidence?: 'HIGH' | 'MED' | 'LOW';
  evConfidence?: 'HIGH' | 'MED' | 'LOW';
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
async function extractExcelFinancials(file: File): Promise<ExcelFinancials | null> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetNames = wb.SheetNames;
  const dataSheetName = sheetNames.find(s => /data\s*sheet/i.test(s)) || sheetNames[0];
  const ws = wb.Sheets[dataSheetName];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

  const findRow = (labels: string[]) => {
    for (let i = 0; i < rows.length; i++) {
      const first = String(rows[i]?.[0] || '').trim().toLowerCase();
      for (const lab of labels) {
        if (first === lab.toLowerCase() || first.includes(lab.toLowerCase())) return rows[i];
      }
    }
    return null;
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

  const salesRow = findRow(['Sales', 'Revenue', 'Total Revenue', 'Net Sales']);
  const opRowExplicit = findRow(['Operating Profit', 'EBITDA']);
  const netProfitRow = findRow(['Net profit', 'PAT', 'Profit after tax']);
  const epsRow = findRow(['EPS', 'Earnings per share']);
  const priceRow = findRow(['Price', 'CMP', 'Current Price']);
  const depRow = findRow(['Depreciation']);

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
  const fyOrder = ['FY26', 'FY27', 'FY28', 'FY29'];
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
  if (!revScen.base && latestSales > 0 && excelData?.salesCagr5y && excelData.salesCagr5y > 0) {
    const v = latestSales * Math.pow(1 + excelData.salesCagr5y / 100, yearsAhead);
    revScen = { bear: v, base: v, bull: v };
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
  const weighted: Array<{ w: number; v: number }> = [];
  if (psBase !== undefined) weighted.push({ w: 0.45 * (psConfidence === 'HIGH' ? 1 : psConfidence === 'MED' ? 0.7 : 0.3), v: psBase });
  if (peBase !== undefined) weighted.push({ w: 0.35 * (peConfidence === 'HIGH' ? 1 : peConfidence === 'MED' ? 0.7 : 0.3), v: peBase });
  if (evBase !== undefined) weighted.push({ w: 0.20 * (evConfidence === 'HIGH' ? 1 : evConfidence === 'MED' ? 0.7 : 0.3), v: evBase });
  const sumW = weighted.reduce((a, b) => a + b.w, 0);
  const avgBaseUpside = sumW > 0 ? weighted.reduce((a, b) => a + b.w * b.v, 0) / sumW : 0;
  const baseUpsides = [peResult, psResult, evResult]
    .filter((r): r is CalculatorResult => !!r)
    .map(r => r.cases.find(c => c.label === 'BASE')?.upsidePct ?? 0);

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

  return {
    ticker, company, sector,
    quote: quote || undefined,
    excelData,
    guidance: allGuidance,
    forwardYear, forwardRevenue, forwardEBITDA, forwardPAT, inferredMargin,
    peResult, psResult, evResult,
    // PATCH 0657 — Y2 projections
    forwardYearY2,
    forwardRevenueY2: revScenY2.base,
    forwardEBITDAY2: ebitdaScenY2.base,
    forwardPATY2: patScenY2.base,
    peResultY2, psResultY2, evResultY2,
    recommendation, rationale,
    peConfidence, psConfidence, evConfidence,
  };
}

// ─── UI components ──────────────────────────────────────────────────────
function CalcResultMini({ label, result, confidence }: { label: string; result?: CalculatorResult; confidence?: 'HIGH' | 'MED' | 'LOW' }) {
  if (!result) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '14px 16px', opacity: 0.5 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: DIM, letterSpacing: '0.5px' }}>{label}</div>
        <div style={{ fontSize: 11, color: DIM, marginTop: 6, fontStyle: 'italic' }}>Not enough data for this calculator.</div>
      </div>
    );
  }
  // PATCH 0664 — visual confidence flag. LOW dims the card so the user
  // sees this output is less reliable than the others.
  const confColor = confidence === 'HIGH' ? '#10B981' : confidence === 'MED' ? '#F59E0B' : confidence === 'LOW' ? '#EF4444' : DIM;
  const cardOpacity = confidence === 'LOW' ? 0.7 : 1;
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '14px 16px', opacity: cardOpacity }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.5px' }}>{label}</div>
        {confidence && (
          <span style={{ fontSize: 9, padding: '2px 7px', background: `${confColor}20`, color: confColor, border: `1px solid ${confColor}50`, borderRadius: 3, fontWeight: 800, letterSpacing: '0.5px' }} title={confidence === 'HIGH' ? 'Direct guidance from PDF' : confidence === 'MED' ? 'Partial guidance, some historical fallback' : 'Mostly historical fallback — verify margin manually'}>
            {confidence} CONFIDENCE
          </span>
        )}
      </div>
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
  // PATCH 0657 — toggle between Year 1 (FY27, 18mo) and Year 2 (FY28, 30mo)
  const [viewYear, setViewYear] = useState<'Y1' | 'Y2'>('Y1');
  // PATCH 0662 — manual override state. When user knows the right margin /
  // revenue / multiple, plug it in and recompute. Useful when extractor
  // misses guidance (e.g. MTAR's "EBITDA margin 24%" missed but live PDF text differs).
  const [overrideMargin, setOverrideMargin] = useState<string>('');     // % e.g. "24"
  const [overrideRevenue, setOverrideRevenue] = useState<string>('');   // ₹ Cr
  const [overridePE, setOverridePE] = useState<string>('');             // multiple
  const [overridePS, setOverridePS] = useState<string>('');             // multiple
  const [overrideEV, setOverrideEV] = useState<string>('');             // multiple
  const [overrideResult, setOverrideResult] = useState<null | {
    revenue: number; ebitda: number; pat: number;
    pe?: any; ps?: any; ev?: any;
  }>(null);
  // PATCH 0649 — saved-companies state
  const [savedList, setSavedList] = useState<SavedAutoValuation[]>(() => {
    if (typeof window === 'undefined') return [];
    return listAutoValuations();
  });
  const refreshSaved = useCallback(() => setSavedList(listAutoValuations()), []);
  useEffect(() => {
    const h = () => refreshSaved();
    window.addEventListener('mc:auto-val:updated', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener('mc:auto-val:updated', h);
      window.removeEventListener('storage', h);
    };
  }, [refreshSaved]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newDocs: ParsedDoc[] = Array.from(files).map(f => ({
      name: f.name,
      size: f.size,
      type: /\.xlsx?$/i.test(f.name) ? 'excel' : /\.pdf$/i.test(f.name) ? 'pdf' : 'unknown',
      status: 'parsing',
    }));
    // PATCH 0663 — capture starting index from the functional setState
    // BEFORE the append, so the indexing into the per-file parsing loop
    // is correct even when multiple uploads happen back-to-back. The old
    // code used closure-captured docs.length which goes stale.
    let startIdx = 0;
    setDocs(prev => {
      startIdx = prev.length;
      return [...prev, ...newDocs];
    });

    // Snapshot files array since FileList becomes invalid after async work
    const fileList = Array.from(files);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const docIdx = startIdx + i;
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
  }, []);

  // Re-build report whenever docs change
  useEffect(() => {
    if (docs.length === 0) { setReport(null); return; }
    const allDone = docs.every(d => d.status !== 'parsing');
    if (!allDone) return;
    setBuilding(true);
    buildReport(docs).then(r => {
      setReport(r);
      setBuilding(false);
      // PATCH 0649 — auto-persist whenever we have a usable report
      if (r.ticker && (r.peResult || r.psResult || r.evResult)) {
        try {
          saveAutoValuation({
            ticker: r.ticker,
            company: r.company,
            sector: r.sector,
            forwardYear: r.forwardYear,
            forwardRevenue: r.forwardRevenue,
            forwardEBITDA: r.forwardEBITDA,
            forwardPAT: r.forwardPAT,
            inferredMargin: r.inferredMargin,
            recommendation: r.recommendation,
            rationale: r.rationale,
            docSnapshots: docs.filter(d => d.status === 'done').map(d => ({
              name: d.name, size: d.size, type: d.type,
              message: d.message, guidanceCount: d.guidance?.length,
              uploadedAt: new Date().toISOString(),
            })),
            excelSummary: r.excelData ? {
              latestSales: r.excelData.latestSales,
              latestPAT: r.excelData.latestPAT,
              latestEBITDA: r.excelData.latestEBITDA,
              opmAvg: r.excelData.opmAvg,
              salesCagr5y: r.excelData.salesCagr5y,
              patCagr5y: r.excelData.patCagr5y,
              sharesOutstandingCr: r.excelData.sharesOutstandingCr,
              currentPriceFromSheet: r.excelData.currentPriceFromSheet,
              currentMarketCapCrFromSheet: r.excelData.currentMarketCapCrFromSheet,
            } : undefined,
            guidance: r.guidance.map(g => ({ ...g })),
            peResult: r.peResult,
            psResult: r.psResult,
            evResult: r.evResult,
            // PATCH 0657 — persist Y2 so reopening shows the toggle
            forwardYearY2: r.forwardYearY2,
            forwardRevenueY2: r.forwardRevenueY2,
            forwardEBITDAY2: r.forwardEBITDAY2,
            forwardPATY2: r.forwardPATY2,
            peResultY2: r.peResultY2,
            psResultY2: r.psResultY2,
            evResultY2: r.evResultY2,
          });
          refreshSaved();
        } catch (e) { console.warn('auto-val save failed', e); }
      }
    });
  }, [docs, refreshSaved]);

  // PATCH 0649 — Load a saved report directly (no re-upload needed)
  const handleLoadSaved = useCallback((s: SavedAutoValuation) => {
    setDocs(s.docSnapshots.map(snap => ({
      name: snap.name, size: snap.size, type: snap.type,
      status: 'done' as const, message: snap.message,
    })));
    // Reconstruct report shape from saved
    const reconstructed: AutoValuationReport = {
      ticker: s.ticker,
      company: s.company,
      sector: s.sector,
      guidance: (s.guidance || []) as any,
      forwardYear: s.forwardYear,
      forwardRevenue: s.forwardRevenue,
      forwardEBITDA: s.forwardEBITDA,
      forwardPAT: s.forwardPAT,
      inferredMargin: s.inferredMargin,
      peResult: s.peResult,
      psResult: s.psResult,
      evResult: s.evResult,
      // PATCH 0657 — restore Y2 fields
      forwardYearY2: s.forwardYearY2,
      forwardRevenueY2: s.forwardRevenueY2,
      forwardEBITDAY2: s.forwardEBITDAY2,
      forwardPATY2: s.forwardPATY2,
      peResultY2: s.peResultY2,
      psResultY2: s.psResultY2,
      evResultY2: s.evResultY2,
      recommendation: s.recommendation,
      rationale: s.rationale,
    };
    setReport(reconstructed);
  }, []);

  const handleClearSaved = useCallback((ticker: string) => {
    if (!confirm(`Clear saved Auto-Valuation for ${ticker}? You'll need to re-upload reports to recompute.`)) return;
    deleteAutoValuation(ticker);
    refreshSaved();
    setReport(null);
    setDocs([]);
  }, [refreshSaved]);

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
            onChange={(e) => {
              handleFiles(e.target.files);
              // PATCH 0663 — reset value so the same file can be re-selected
              // without browsers silently dropping the onChange event.
              e.target.value = '';
            }}
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

        {/* PATCH 0649 — Saved Companies panel */}
        {savedList.length > 0 && (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid #10B981', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#10B981', letterSpacing: '0.4px' }}>
                💾 SAVED COMPANIES ({savedList.length})
              </span>
              <span style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }}>persists in browser · auto-saved on each report</span>
            </div>
            <div style={{ fontSize: 11, color: DIM, marginBottom: 10, lineHeight: 1.5 }}>
              Reports you&apos;ve already generated. Click <b style={{ color: '#22D3EE' }}>Open</b> to view without re-uploading. <b style={{ color: '#F59E0B' }}>Add docs</b> appends new files (e.g. next quarter&apos;s PDFs). <b style={{ color: '#EF4444' }}>Clear</b> wipes and lets you start fresh.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {savedList.map((s) => {
                const recColor = s.recommendation === 'BUY' ? '#10B981' : s.recommendation === 'WATCH' ? '#22D3EE' : s.recommendation === 'WAIT' ? '#F59E0B' : s.recommendation === 'AVOID' ? '#EF4444' : '#94A3B8';
                const ageHours = (Date.now() - new Date(s.savedAt).getTime()) / 3600_000;
                const ageLabel = ageHours < 1 ? 'just now' : ageHours < 24 ? `${Math.round(ageHours)}h ago` : `${Math.round(ageHours / 24)}d ago`;
                return (
                  <div key={s.ticker} style={{
                    background: '#0A1422', border: `1px solid ${BORDER}`, borderRadius: 5,
                    padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 11, color: recColor, fontWeight: 900, background: `${recColor}22`, padding: '2px 7px', borderRadius: 3, letterSpacing: '0.5px', minWidth: 50, textAlign: 'center' }}>
                      {s.recommendation}
                    </span>
                    <span style={{ fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 80 }}>
                      {s.ticker}
                    </span>
                    <span style={{ fontSize: 12, color: TEXT, fontWeight: 600, flex: 1, minWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.company || '—'}
                    </span>
                    {s.sector && (
                      <span style={{ fontSize: 9, color: '#22D3EE', background: '#22D3EE15', padding: '2px 7px', borderRadius: 3, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {s.sector}
                      </span>
                    )}
                    {s.forwardYear && (
                      <span style={{ fontSize: 9, color: '#A78BFA', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                        {s.forwardYear}: ₹{s.forwardPAT ?? '?'} Cr PAT
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                      {s.docSnapshots.length} doc(s) · {ageLabel}
                    </span>
                    <button onClick={() => handleLoadSaved(s)} style={{
                      fontSize: 10, padding: '4px 10px', background: '#22D3EE15', border: '1px solid #22D3EE50',
                      color: '#22D3EE', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
                    }}>OPEN</button>
                    <label htmlFor={`add-${s.ticker}`} style={{
                      fontSize: 10, padding: '4px 10px', background: '#F59E0B15', border: '1px solid #F59E0B50',
                      color: '#F59E0B', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
                    }}>+ DOCS</label>
                    <input id={`add-${s.ticker}`} type="file" multiple accept=".xlsx,.xls,.pdf"
                      onChange={(e) => {
                        if (!e.target.files || e.target.files.length === 0) return;
                        // Append doc snapshots to saved record + also feed into current upload flow
                        const snaps: SavedDocSnapshot[] = Array.from(e.target.files).map(f => ({
                          name: f.name, size: f.size,
                          type: /\.xlsx?$/i.test(f.name) ? 'excel' : /\.pdf$/i.test(f.name) ? 'pdf' : 'unknown',
                          uploadedAt: new Date().toISOString(),
                        }));
                        appendDocsToSaved(s.ticker, snaps);
                        refreshSaved();
                        // Also trigger normal upload flow to recompute the report
                        handleLoadSaved(s);
                        handleFiles(e.target.files);
                        e.target.value = '';
                      }}
                      style={{ display: 'none' }} />
                    <button onClick={() => handleClearSaved(s.ticker)} style={{
                      fontSize: 10, padding: '4px 8px', background: '#EF444415', border: '1px solid #EF444450',
                      color: '#EF4444', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
                    }}>× CLEAR</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

            {/* PATCH 0657 — Year toggle. Lets user compare FY27 (18mo) vs FY28 (30mo). */}
            {report.peResultY2 || report.psResultY2 || report.evResultY2 ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.4px' }}>VIEW:</span>
                {(['Y1', 'Y2'] as const).map(y => {
                  const label = y === 'Y1'
                    ? `${report.forwardYear || 'Y1'} · 18mo`
                    : `${report.forwardYearY2 || 'Y2'} · 30mo`;
                  const active = viewYear === y;
                  return (
                    <button
                      key={y}
                      onClick={() => setViewYear(y)}
                      style={{
                        background: active ? '#22D3EE' : 'transparent',
                        color: active ? '#0a0a0f' : DIM,
                        border: `1px solid ${active ? '#22D3EE' : BORDER}`,
                        borderRadius: 5,
                        padding: '5px 12px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        letterSpacing: '0.4px',
                      }}
                    >{label}</button>
                  );
                })}
                {viewYear === 'Y2' && (
                  <span style={{ marginLeft: 8, color: '#F59E0B', fontSize: 10, fontStyle: 'italic' }}>
                    Year-2 = growth applied one more year. Rev ₹{report.forwardRevenueY2?.toLocaleString('en-IN') || '?'} Cr · PAT ₹{report.forwardPATY2?.toLocaleString('en-IN') || '?'} Cr.
                  </span>
                )}
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
              <CalcResultMini label="📈 P/E Valuation" result={viewYear === 'Y2' ? report.peResultY2 : report.peResult} confidence={report.peConfidence} />
              <CalcResultMini label="💰 P/S Valuation" result={viewYear === 'Y2' ? report.psResultY2 : report.psResult} confidence={report.psConfidence} />
              <CalcResultMini label="🏭 EV/EBITDA Valuation" result={viewYear === 'Y2' ? report.evResultY2 : report.evResult} confidence={report.evConfidence} />
            </div>

            {/* PATCH 0662 — Manual Override Panel. When extractor misses guidance,
                let user plug in correct values and recompute. */}
            <div style={{ background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', letterSpacing: '0.5px', marginBottom: 4 }}>
                🛠 OVERRIDE INPUTS — adjust when the extractor missed something
              </div>
              <div style={{ fontSize: 11, color: DIM, marginBottom: 12, lineHeight: 1.5 }}>
                Plug in the values you know from reading the concall yourself. Leave blank to keep the auto-extracted number.
                Forward Revenue and EBITDA Margin are the two that matter most — they flow into all 3 calculators.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
                {[
                  { label: 'Forward Revenue (₹ Cr)', val: overrideRevenue, set: setOverrideRevenue, hint: `auto: ${report.forwardRevenue ?? '?'}` },
                  { label: 'EBITDA Margin (%)', val: overrideMargin, set: setOverrideMargin, hint: `auto: ${report.inferredMargin?.toFixed(1) ?? '?'}` },
                  { label: 'P/E multiple (base)', val: overridePE, set: setOverridePE, hint: 'sector default' },
                  { label: 'P/S multiple (base)', val: overridePS, set: setOverridePS, hint: 'sector default' },
                  { label: 'EV/EBITDA multiple (base)', val: overrideEV, set: setOverrideEV, hint: 'sector default' },
                ].map((f, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 10, color: DIM, marginBottom: 3, letterSpacing: '0.4px', fontWeight: 700 }}>{f.label}</div>
                    <input
                      type="number"
                      value={f.val}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.hint}
                      style={{
                        width: '100%', padding: '7px 10px', fontSize: 13, color: TEXT,
                        background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 4,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => {
                  const rev = parseFloat(overrideRevenue) || report.forwardRevenue || 0;
                  const margin = parseFloat(overrideMargin) || report.inferredMargin || 0;
                  if (!rev || !margin) {
                    alert('Need both forward revenue and EBITDA margin to recompute.');
                    return;
                  }
                  const ebitda = rev * (margin / 100);
                  // Estimate PAT via historical EBITDA→PAT conversion
                  const conv = (report.excelData?.latestEBITDA && report.excelData.latestEBITDA > 0 && report.excelData.latestPAT)
                    ? report.excelData.latestPAT / report.excelData.latestEBITDA : 0.4;
                  const pat = ebitda * conv;
                  const mcap = report.quote?.currentMarketCapCr || report.excelData?.currentMarketCapCrFromSheet || 0;
                  const baseInput = {
                    ticker: report.ticker,
                    company: report.company,
                    currentMarketCapCr: mcap,
                    horizonMonths: 18,
                    currentPrice: report.quote?.currentPrice || report.excelData?.currentPriceFromSheet,
                    sharesOutstandingCr: report.quote?.sharesOutstandingCr || report.excelData?.sharesOutstandingCr,
                    currency: '₹' as const,
                  };
                  const peBase = parseFloat(overridePE) || 40;
                  const psBase = parseFloat(overridePS) || 10;
                  const evBase = parseFloat(overrideEV) || 18;
                  const pe = mcap > 0 ? calculatePE({ ...baseInput, forwardPATCr: Math.round(pat), bearPE: peBase * 0.75, basePE: peBase, bullPE: peBase * 1.25 }) : undefined;
                  const ps = mcap > 0 ? calculatePS({ ...baseInput, forwardRevenueCr: Math.round(rev), bearPS: psBase * 0.75, basePS: psBase, bullPS: psBase * 1.4 }) : undefined;
                  const ev = mcap > 0 ? calculateEvEbitda({ ...baseInput, forwardEBITDACr: Math.round(ebitda), bearMultiple: evBase * 0.75, baseMultiple: evBase, bullMultiple: evBase * 1.4 }) : undefined;
                  setOverrideResult({ revenue: Math.round(rev), ebitda: Math.round(ebitda), pat: Math.round(pat), pe, ps, ev });
                }} style={{
                  fontSize: 12, padding: '8px 16px', background: '#F59E0B', border: 'none',
                  color: '#0A0E1A', borderRadius: 5, cursor: 'pointer', fontWeight: 800,
                }}>↻ RECALCULATE WITH OVERRIDES</button>
                {overrideResult && (
                  <button onClick={() => {
                    setOverrideResult(null);
                    setOverrideMargin(''); setOverrideRevenue(''); setOverridePE(''); setOverridePS(''); setOverrideEV('');
                  }} style={{
                    fontSize: 11, padding: '8px 14px', background: 'transparent', border: `1px solid ${BORDER}`,
                    color: DIM, borderRadius: 5, cursor: 'pointer', fontWeight: 700,
                  }}>Clear</button>
                )}
              </div>

              {overrideResult && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #F59E0B40' }}>
                  <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 800, marginBottom: 8 }}>
                    ✓ OVERRIDE SCENARIO — Revenue ₹{overrideResult.revenue.toLocaleString('en-IN')} Cr · EBITDA ₹{overrideResult.ebitda.toLocaleString('en-IN')} Cr · PAT ₹{overrideResult.pat.toLocaleString('en-IN')} Cr
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
                    <CalcResultMini label="📈 P/E (override)" result={overrideResult.pe} />
                    <CalcResultMini label="💰 P/S (override)" result={overrideResult.ps} />
                    <CalcResultMini label="🏭 EV/EBITDA (override)" result={overrideResult.ev} />
                  </div>
                </div>
              )}
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
