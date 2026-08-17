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
import { getDecision, DECISION_META } from '@/lib/decisions';
import { getConvictionTickers } from '@/lib/conviction-beats';
// PATCH 0649 — per-company persistence
import {
  saveAutoValuation, loadAutoValuation, deleteAutoValuation, listAutoValuations, appendDocsToSaved,
  type SavedAutoValuation, type SavedDocSnapshot,
} from '@/lib/auto-valuation-store';
// zzz394 — DEDUP: buildReport + inferSector + the shared report/doc types now
// live ONLY in the sibling engine.ts module (single source of truth; engine is
// the superset). page.tsx keeps only its own extractPdfText /
// extractExcelFinancials / loadPdfJs helpers and the React UI below.
import {
  buildReport, inferSector,
  type AutoValuationReport, type ParsedDoc, type ExcelFinancials,
} from './engine';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

// ─── Types ──────────────────────────────────────────────────────────────
// zzz394 — DEDUP: ExcelFinancials / ParsedDoc / AutoValuationReport are now
// imported from ./engine (the superset, which additionally declares
// `currentMarketCapCr`). Local copies deleted to keep one source of truth.

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


// ─── UI components ──────────────────────────────────────────────────────
function CalcResultMini({ label, result, confidence, reason }: { label: string; result?: CalculatorResult; confidence?: 'HIGH' | 'MED' | 'LOW'; reason?: string }) {
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
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.5px' }}>{label}</div>
        {confidence && (
          <span style={{ fontSize: 9, padding: '2px 7px', background: `${confColor}20`, color: confColor, border: `1px solid ${confColor}50`, borderRadius: 3, fontWeight: 800, letterSpacing: '0.5px' }}>
            {confidence} CONFIDENCE
          </span>
        )}
      </div>
      {/* PATCH 0678 — explicit reason for the confidence level. User asked
          for "why MED/LOW" to be visible, not hidden behind a tooltip. */}
      {reason && (
        <div style={{ marginBottom: 8, padding: '6px 10px', background: `${confColor}10`, borderLeft: `2px solid ${confColor}`, borderRadius: 3, fontSize: 10.5, color: 'var(--mc-text-2)', lineHeight: 1.5 }}>
          <strong style={{ color: confColor, marginRight: 4 }}>Why {confidence}:</strong>{reason}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--mc-text-2)', marginBottom: 8, lineHeight: 1.5 }}>{result.baseSummary}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {result.cases.map((c) => (
          <div key={c.label} style={{ background: 'var(--mc-bg-0)', border: `1px solid ${c.color}50`, borderRadius: 4, padding: '8px 10px' }}>
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
  // zzz391 — transient per-ticker feedback for the "↻ sector" recompute button.
  const [secNote, setSecNote] = useState<Record<string, string>>({});
  // PATCH 0855 — Live data overlays for saved bench + active report.
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [smartMoneyByTicker, setSmartMoneyByTicker] = useState<Record<string, any>>({});
  const [upcomingEarningsByTicker, setUpcomingEarningsByTicker] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    // Live quotes for stale-price flag (saved bench)
    (async () => {
      try {
        const r = await fetch('/api/market/quotes?market=india', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const map: Record<string, number> = {};
        for (const s of (j?.stocks || [])) {
          if (s.ticker && s.price) map[String(s.ticker).toUpperCase()] = Number(s.price);
        }
        if (!cancelled) setLivePrices(map);
      } catch {}
    })();
    // Smart-money rows for ticker overlay
    (async () => {
      try {
        const r = await fetch('/api/v1/super-investor-flow?days=180', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const rows = j?.rows || [];
        const map: Record<string, any> = {};
        for (const row of rows) {
          if (row?.ticker) map[String(row.ticker).toUpperCase()] = row;
        }
        if (!cancelled) setSmartMoneyByTicker(map);
      } catch {}
    })();
    // Upcoming earnings (next 14d) for earnings-soon chip
    (async () => {
      try {
        const r = await fetch('/api/v1/calendar?days=14', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const map: Record<string, string> = {};
        // Calendar buckets: { 'YYYY-MM-DD': [{ticker, ...}, ...] }
        const buckets = j?.buckets || j?.data || {};
        if (buckets && typeof buckets === 'object') {
          for (const [date, list] of Object.entries(buckets)) {
            if (!Array.isArray(list)) continue;
            for (const item of list) {
              const t = String((item as any)?.ticker || (item as any)?.symbol || '').toUpperCase();
              if (t && !map[t]) map[t] = date;  // first occurrence wins (earliest date)
            }
          }
        }
        if (!cancelled) setUpcomingEarningsByTicker(map);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
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
    // PATCH 0759 — BUG 10 fix. When a saved entry is loaded via
    // handleLoadSaved, the docs array only contains lightweight snapshots
    // (no excelData / pdfText). Running buildReport on empty docs yields
    // NEED_MORE_DATA which then OVERWRITES the reconstructed report —
    // causing the inconsistency where saved badge says BUY but inline
    // report says NEED_MORE_DATA. Skip the rebuild when no doc has raw
    // parsed data attached; the reconstructed report is the source of
    // truth in that case.
    const hasRawData = docs.some(d => d.excelData !== undefined || (d.pdfText !== undefined && d.pdfText.length > 0));
    if (!hasRawData) return;
    setBuilding(true);
    buildReport(docs).catch(err => {
      // PATCH 0849 — never silently die on a malformed PDF/Excel. Surface to
      // user via a NEED_MORE_DATA report so the upload state isn't stuck.
      console.error('[auto-val] buildReport threw:', err);
      setBuilding(false);
      setReport({
        guidance: [], rationale: [`Error building report: ${err?.message || String(err)}. Try re-uploading the file.`],
        recommendation: 'NEED_MORE_DATA',
      } as any);
      return null;
    }).then(r => {
      if (!r) return;
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
            priceAtSave: r.quote?.currentPrice ?? r.excelData?.currentPriceFromSheet,
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

  // PATCH 0843 — Clear ONLY the uploaded attachments while keeping the
  // saved report in localStorage. User asked: 'save the report, then
  // clear attachments — open later and see the whole report without
  // re-uploading.' The saved entry (lib/auto-valuation-store) already
  // persists the full report + doc snapshots. Clearing in-memory docs
  // shows just the saved report on next render.
  const handleClearAttachments = useCallback(() => {
    if (!confirm('Clear uploaded attachments? Your saved Auto-Val report stays — you can open it again from the saved-companies list below.')) return;
    setDocs([]);
    // Don't null out report — leave it on screen so user sees what was saved.
  }, []);

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
          <Link href="/valuation-calc" style={{ fontSize: 11, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Open manual calculator →</Link>
        </div>

        {/* Upload */}
        <div style={{
          background: CARD, border: `2px dashed color-mix(in srgb, var(--mc-cyan) 38%, transparent)`, borderRadius: 8, padding: '28px 24px',
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
            background: 'var(--mc-cyan)', border: 'none', color: 'var(--mc-bg-0)',
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
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid var(--mc-bullish)', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.4px' }}>
                💾 SAVED COMPANIES ({savedList.length})
              </span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                {/* zzz392 — batch-recompute every saved entry's sector with the current classifier */}
                <button
                  title="Recompute the sector for every saved company using the current classifier — fixes stale labels in bulk. No re-upload needed."
                  onClick={() => {
                    let changed = 0;
                    for (const s of listAutoValuations()) {
                      const text = [s.company || '', ...(s.guidance || []).map((g) => g.rawPhrase || ''), ...(s.rationale || [])].join(' ');
                      const next = inferSector(text, s.company);
                      if (next && next !== s.sector) { saveAutoValuation({ ...s, sector: next }); changed++; }
                    }
                    refreshSaved();
                    setSecNote((m) => ({ ...m, __all__: changed ? `↻ ${changed} updated` : 'all up to date' }));
                    setTimeout(() => setSecNote((m) => { const n = { ...m }; delete n.__all__; return n; }), 2600);
                  }}
                  style={{ fontSize: 9, padding: '3px 8px', background: 'transparent', border: `1px solid ${DIM}66`, color: DIM, borderRadius: 3, cursor: 'pointer', fontWeight: 800, whiteSpace: 'nowrap' }}
                >↻ recompute all sectors</button>
                {secNote.__all__ && <span style={{ fontSize: 9, color: secNote.__all__.startsWith('↻') ? '#10B981' : DIM, fontWeight: 700 }}>{secNote.__all__}</span>}
                <span style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }}>persists in browser · auto-saved on each report</span>
              </span>
            </div>
            <div style={{ fontSize: 11, color: DIM, marginBottom: 10, lineHeight: 1.5 }}>
              Reports you&apos;ve already generated. Click <b style={{ color: 'var(--mc-cyan)' }}>Open</b> to view without re-uploading. <b style={{ color: 'var(--mc-warn)' }}>Add docs</b> appends new files (e.g. next quarter&apos;s PDFs). <b style={{ color: 'var(--mc-bearish)' }}>Clear</b> wipes and lets you start fresh.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {savedList.map((s) => {
                const recColor = s.recommendation === 'BUY' ? '#10B981' : s.recommendation === 'WATCH' ? '#22D3EE' : s.recommendation === 'WAIT' ? '#F59E0B' : s.recommendation === 'AVOID' ? '#EF4444' : '#94A3B8';
                const ageHours = (Date.now() - new Date(s.savedAt).getTime()) / 3600_000;
                const ageLabel = ageHours < 1 ? 'just now' : ageHours < 24 ? `${Math.round(ageHours)}h ago` : `${Math.round(ageHours / 24)}d ago`;
                /*
                 * PATCH 0965 UX — Auto-valuation saved-entry display label.
                 * Root cause: rows used the raw ticker as React key and as
                 * primary text. When the user saves multiple revisions for
                 * the same ticker (different upload dates) the rows looked
                 * identical, and any downstream PDF export inherited the
                 * UUID-like ticker key as its filename ("MTAR" or worse,
                 * a hex-id when ticker auto-detect failed) instead of a
                 * human-readable "Company · YYYY-MM-DD" label.
                 * Fix: build an explicit displayLabel of the form
                 *   ${company || ticker} · ${YYYY-MM-DD}
                 * and surface it via title= so any export / share action
                 * downstream can pick it up; the underlying s.ticker is
                 * still the storage key (for delete / fetch).
                 */
                const savedDate = (s.savedAt || '').slice(0, 10);
                const primary = (s.company || s.ticker || '').trim();
                const displayLabel = primary ? `${primary} · ${savedDate}` : `Untitled · ${savedDate}`;
                return (
                  <div key={s.ticker} title={displayLabel} style={{
                    background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`, borderRadius: 5,
                    padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 11, color: recColor, fontWeight: 900, background: `${recColor}22`, padding: '2px 7px', borderRadius: 3, letterSpacing: '0.5px', minWidth: 50, textAlign: 'center' }}>
                      {s.recommendation}
                    </span>
                    <span style={{ fontSize: 12, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 80 }}>
                      {s.ticker}
                    </span>
                    <span style={{ fontSize: 12, color: TEXT, fontWeight: 600, flex: 1, minWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.company || s.ticker || 'Untitled'} <span style={{ color: DIM, fontWeight: 400 }}>· {savedDate}</span>
                    </span>
                    {s.sector && (
                      <span style={{ fontSize: 9, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', padding: '2px 7px', borderRadius: 3, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {s.sector}
                      </span>
                    )}
                    {/* zzz391 — recompute the sector from the saved guidance with the
                        current classifier, fixing stale labels from older saves. */}
                    <button
                      title="Recompute sector from saved guidance using the current classifier — fixes stale sector labels from older saves. No re-upload needed."
                      onClick={() => {
                        const text = [s.company || '', ...(s.guidance || []).map((g) => g.rawPhrase || ''), ...(s.rationale || [])].join(' ');
                        const next = inferSector(text, s.company);
                        const changed = !!next && next !== s.sector;
                        if (changed) { saveAutoValuation({ ...s, sector: next }); refreshSaved(); }
                        setSecNote((m) => ({ ...m, [s.ticker]: changed ? `→ ${next}` : (next ? 'up to date' : 'no match') }));
                        setTimeout(() => setSecNote((m) => { const n = { ...m }; delete n[s.ticker]; return n; }), 2600);
                      }}
                      style={{ fontSize: 9, padding: '3px 7px', background: 'transparent', border: `1px solid ${DIM}66`, color: DIM, borderRadius: 3, cursor: 'pointer', fontWeight: 800, whiteSpace: 'nowrap' }}
                    >↻ sector</button>
                    {secNote[s.ticker] && (
                      <span style={{ fontSize: 9, color: secNote[s.ticker].startsWith('→') ? '#10B981' : DIM, fontWeight: 700, whiteSpace: 'nowrap' }}>{secNote[s.ticker]}</span>
                    )}
                    {s.forwardYear && (
                      <span style={{ fontSize: 9, color: 'var(--mc-state-persistent)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                        {s.forwardYear}: ₹{s.forwardPAT ?? '?'} Cr PAT
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                      {s.docSnapshots.length} doc(s) · {ageLabel}
                    </span>
                    {/* PATCH 0855 — Stale-price flag: cmp moved >15% from priceAtSave */}
                    {(() => {
                      const live = livePrices[(s.ticker || '').toUpperCase()];
                      const anchor = s.priceAtSave ?? s.excelSummary?.currentPriceFromSheet;
                      if (!live || !anchor || anchor <= 0) return null;
                      const movePct = ((live - anchor) / anchor) * 100;
                      if (Math.abs(movePct) < 15) return null;
                      const c = movePct < 0 ? '#10B981' : '#F59E0B';
                      return (
                        <span title={`Saved at ₹${anchor.toFixed(0)}, now ₹${live.toFixed(0)}. Recompute valuation?`}
                          style={{ fontSize: 9, color: c, background: `${c}15`, border: `1px solid ${c}60`, padding: '2px 6px', borderRadius: 3, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          📊 {movePct > 0 ? '+' : ''}{movePct.toFixed(0)}% since save
                        </span>
                      );
                    })()}
                    <button onClick={() => handleLoadSaved(s)} style={{
                      fontSize: 10, padding: '4px 10px', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 31%, transparent)',
                      color: 'var(--mc-cyan)', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
                    }}>OPEN</button>
                    <label htmlFor={`add-${s.ticker}`} style={{
                      fontSize: 10, padding: '4px 10px', background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 31%, transparent)',
                      color: 'var(--mc-warn)', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
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
                    {/* PATCH 0760 — Log to Decision bridge (BUG 11 + IMP4).
                         One-click writes the saved Auto-Val recommendation
                         into the Decision Log keyed by ticker. Maps
                         BUY → BUY, WATCH → WATCH, AVOID → REJECTED, else
                         NEUTRAL. */}
                    <button onClick={() => {
                      try {
                        // Lazy import to avoid circular-dep risk
                        const { setDecision } = require('@/lib/decisions');
                        const statusMap: Record<string, string> = {
                          BUY: 'BUY', WATCH: 'WATCH',
                          AVOID: 'REJECTED', WAIT: 'NEUTRAL',
                        };
                        const status = statusMap[s.recommendation || ''] || 'NEUTRAL';
                        const reason = `Auto-Val ${s.recommendation || 'computed'}: ${(s.rationale || []).slice(0, 2).join(' · ')}`.slice(0, 180);
                        setDecision({
                          symbol: s.ticker,
                          market: 'IN',
                          status,
                          reason,
                          scoreAtDecision: undefined,
                          gradeAtDecision: undefined,
                        });
                        alert(`Logged to Decision Log: ${s.ticker} → ${status}`);
                      } catch (e: any) {
                        alert('Failed to log decision: ' + (e?.message || 'unknown'));
                      }
                    }} style={{
                      fontSize: 10, padding: '4px 8px', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 31%, transparent)',
                      color: 'var(--mc-cyan)', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
                    }} title="Bridge to Decision Log — writes BUY/WATCH/REJECTED with Auto-Val rationale">+ DECISION</button>
                    <button onClick={() => {
                      // PATCH 0751 — Recompute. Re-runs sector inference on the
                      // stored guidance text + company name, so saved entries
                      // with pre-P0679 sector classifications (e.g. KOEL stuck
                      // as 'Defence') get refreshed with the latest scoring
                      // logic. Doesn't require the raw PDF/Excel — uses what's
                      // already persisted.
                      const guidanceText = (s.guidance || []).map(g => `${g.metric} ${g.rawPhrase || ''}`).join(' ');
                      const recomputedSector = inferSector(guidanceText, s.company);
                      // Detect if anything actually changed before write.
                      if (recomputedSector === s.sector) {
                        // No-op feedback so the user knows the rule didn't change.
                        alert(`No change — sector still "${s.sector || '—'}" after recompute. (Sector inference rules haven't moved since this entry was saved.)`);
                        return;
                      }
                      saveAutoValuation({ ...s, sector: recomputedSector, savedAt: new Date().toISOString() });
                      refreshSaved();
                    }} style={{
                      fontSize: 10, padding: '4px 8px', background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 31%, transparent)',
                      color: 'var(--mc-state-persistent)', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
                    }} title="Re-infer sector from latest classification rules — no re-upload needed">↻ RECOMP</button>
                    <button onClick={() => handleClearSaved(s.ticker)} style={{
                      fontSize: 10, padding: '4px 8px', background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 31%, transparent)',
                      color: 'var(--mc-bearish)', borderRadius: 3, cursor: 'pointer', fontWeight: 800,
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
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: 'var(--mc-bg-0)', borderRadius: 4 }}>
                  <span style={{ fontSize: 10, color: d.type === 'excel' ? 'var(--mc-bullish)' : 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 40 }}>
                    {d.type === 'excel' ? 'XLSX' : d.type === 'pdf' ? 'PDF' : '?'}
                  </span>
                  {/* PATCH 0758 — fall back to ticker-based label when the
                       upload-time filename is a UUID (32-char hex with
                       dashes). Some browsers/file inputs strip readable
                       names when files come from app sandboxes. */}
                  <span style={{ flex: 1, fontSize: 12, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|xlsx?|docx?)$/i.test(d.name || '');
                      if (looksUuid) {
                        const ext = d.type === 'excel' ? 'Excel' : d.type === 'pdf' ? 'PDF' : 'Doc';
                        return `${ext} #${i + 1} · ${d.name}`;
                      }
                      return d.name;
                    })()}
                  </span>
                  <span style={{ fontSize: 10, color: DIM }}>{(d.size / 1024).toFixed(0)} KB</span>
                  <span style={{ fontSize: 10, color: d.status === 'done' ? 'var(--mc-bullish)' : d.status === 'error' ? 'var(--mc-bearish)' : 'var(--mc-warn)', fontWeight: 700 }}>
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
              position: 'relative' as const,
              borderRadius: 8, padding: '18px 22px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>RECOMMENDATION</div>
                  {/* PATCH 0843 — Saved indicator + Clear attachments button */}
                  {report.ticker && savedList.find(s => s.ticker === report.ticker) && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 33%, transparent)', borderRadius: 4, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 700 }}>
                        ✓ SAVED · this report is persisted; reload anytime
                      </span>
                      {docs.length > 0 && (
                        <button onClick={handleClearAttachments}
                          style={{ marginLeft: 4, padding: '2px 8px', fontSize: 10, background: 'transparent', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 33%, transparent)', borderRadius: 3, cursor: 'pointer' }}>
                          ↻ Clear attachments (keep report)
                        </button>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: 30, fontWeight: 900, color: recColor(report.recommendation), letterSpacing: '-0.5px', marginTop: 4 }}>
                    {report.recommendation}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{report.company || '—'}</div>
                  <div style={{ fontSize: 11, color: DIM, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>
                    {(() => { const _price = report.quote?.currentPrice; const _mcap = report.currentMarketCapCr || report.quote?.currentMarketCapCr || 0; const _ticker = report.ticker || '—'; const _priceStr = _price ? ` · ₹${_price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : ''; const _mcapStr = _mcap > 0 ? ` · MCap ₹${Math.round(_mcap).toLocaleString('en-IN')} Cr` : ''; return `${_ticker}${_priceStr}${_mcapStr}`; })()}
                  </div>
                  {report.sector && <div style={{ fontSize: 10, color: 'var(--mc-cyan)', marginTop: 4, fontWeight: 700 }}>{report.sector}</div>}
                </div>
              </div>
              <ul style={{ margin: '12px 0 0 22px', padding: 0, fontSize: 12.5, color: TEXT, lineHeight: 1.65 }}>
                {report.rationale.map((r, i) => <li key={i}>{r}</li>)}
              </ul>

              {/* PATCH 0851 — Institutional chip strip */}
              {(() => {
                const ticker = (report.ticker || '').toUpperCase();
                const priorDecision = ticker ? getDecision(ticker) : undefined;
                const cbSet = (typeof window !== 'undefined' ? getConvictionTickers() : new Set<string>());
                const isOnCB = ticker && cbSet.has(ticker);
                const mi = report.marginInflectionChip;
                const fp = report.forensicPumpChip;
                const sa = report.salesAccelChip;
                const dna = report.dnaMatchChip;
                const chips: React.ReactNode[] = [];
                if (priorDecision) {
                  const m = DECISION_META[priorDecision.status];
                  chips.push(<span key="dec" title={`Prior decision: ${priorDecision.status} on ${priorDecision.date.slice(0,10)} — ${priorDecision.reason || ''}`} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: `${m.color}25`, color: m.color, border: `1px solid ${m.color}60`, borderRadius: 3 }}>{m.emoji} PRIOR: {priorDecision.status}</span>);
                }
                if (isOnCB) chips.push(<span key="cb" style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 3 }}>🏆 CB</span>);
                if (mi?.fired) chips.push(<span key="mi" title={mi.interpretation} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', borderRadius: 3 }}>⚡ MARGIN INFLECTION +{mi.gapPp.toFixed(1)}pp</span>);
                else if (mi?.direction === 'COMPRESSION') chips.push(<span key="mi" title={mi.interpretation} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)', color: 'var(--mc-bearish)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)', borderRadius: 3 }}>▼ MARGIN COMPRESSION {mi.gapPp.toFixed(1)}pp</span>);
                if (fp && (fp.severity === 'HIGH' || fp.severity === 'CRITICAL')) chips.push(<span key="fp" title={fp.flags.join(' · ')} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bearish) 15%, transparent)', color: 'var(--mc-bearish)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 38%, transparent)', borderRadius: 3 }}>🚨 PUMP {fp.pumpScore}/11</span>);
                else if (fp && fp.severity === 'WATCH') chips.push(<span key="fp" title={fp.flags.join(' · ')} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 3 }}>⚠ PUMP WATCH {fp.pumpScore}</span>);
                else if (fp && fp.severity === 'CLEAN') chips.push(<span key="fp" style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', color: 'var(--mc-cyan)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 3 }}>✓ FORENSIC CLEAN</span>);
                if (sa && sa.state === 'ACCELERATING') chips.push(<span key="sa" title={`Latest YoY ${sa.latestYoY.toFixed(0)}% vs 5y CAGR ${sa.cagr5y.toFixed(0)}%`} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', borderRadius: 3 }}>⇑ SALES ACCEL +{sa.delta.toFixed(0)}pp</span>);
                else if (sa && sa.state === 'DECELERATING') chips.push(<span key="sa" title={`Latest YoY ${sa.latestYoY.toFixed(0)}% vs 5y CAGR ${sa.cagr5y.toFixed(0)}%`} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: 'color-mix(in srgb, var(--mc-warn) 15%, transparent)', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 3 }}>⇓ SALES DECEL {sa.delta.toFixed(0)}pp</span>);
                if (dna) { const dnaColor = dna.matched >= 5 ? '#10B981' : dna.matched >= 3 ? '#22D3EE' : '#94A3B8'; chips.push(<span key="dna" title={`500-bagger DNA: ${dna.criteria.join(' · ')}`} style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: `${dnaColor}25`, color: dnaColor, border: `1px solid ${dnaColor}60`, borderRadius: 3 }}>🧬 DNA {dna.matched}/6</span>); }
                // PATCH 0855 — Smart-money overlay
                const sm = smartMoneyByTicker[ticker];
                if (sm) {
                  const accent = sm.topDirection === 'ACCUM' ? '#10B981' : sm.topDirection === 'EXIT' ? '#EF4444' : '#94A3B8';
                  const arrow = sm.topDirection === 'ACCUM' ? '⬆' : sm.topDirection === 'EXIT' ? '⬇' : '◆';
                  const investors = Array.isArray(sm.investors) ? sm.investors.slice(0, 3).join(', ') : '';
                  chips.push(
                    <span key="sm" title={`Super investors ${sm.topDirection || 'active'} · ${investors || 'recent activity'} · ${sm.netActions || 0} net actions`}
                      style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: `${accent}25`, color: accent, border: `1px solid ${accent}60`, borderRadius: 3 }}>
                      {arrow} SUPER INV {sm.netActions != null ? sm.netActions : ''}
                    </span>
                  );
                }
                // PATCH 0855 — Earnings proximity chip
                const earnDate = upcomingEarningsByTicker[ticker];
                if (earnDate) {
                  const daysOut = Math.round((new Date(earnDate).getTime() - Date.now()) / 86400000);
                  if (daysOut >= 0 && daysOut <= 14) {
                    const eColor = daysOut <= 3 ? '#EF4444' : daysOut <= 7 ? '#F59E0B' : '#22D3EE';
                    chips.push(
                      <span key="earn" title={`Earnings filing expected on ${earnDate}`}
                        style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', background: `${eColor}25`, color: eColor, border: `1px solid ${eColor}60`, borderRadius: 3 }}>
                        ⏰ EARNINGS {daysOut === 0 ? 'TODAY' : daysOut === 1 ? 'TOMORROW' : `${daysOut}d`}
                      </span>
                    );
                  }
                }
                if (chips.length === 0) return null;
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12, padding: '8px 0', borderTop: `1px dashed ${BORDER}` }}>
                    {chips}
                  </div>
                );
              })()}
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
                        background: active ? 'var(--mc-cyan)' : 'transparent',
                        color: active ? '#0a0a0f' : DIM,
                        border: `1px solid ${active ? 'var(--mc-cyan)' : BORDER}`,
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
                  <span style={{ marginLeft: 8, color: 'var(--mc-warn)', fontSize: 10, fontStyle: 'italic' }}>
                    Year-2 = growth applied one more year. Rev ₹{report.forwardRevenueY2?.toLocaleString('en-IN') || '?'} Cr · PAT ₹{report.forwardPATY2?.toLocaleString('en-IN') || '?'} Cr.
                  </span>
                )}
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
              <CalcResultMini label="📈 P/E Valuation" result={viewYear === 'Y2' ? report.peResultY2 : report.peResult} confidence={report.peConfidence} reason={report.peReason} />
              <CalcResultMini label="💰 P/S Valuation" result={viewYear === 'Y2' ? report.psResultY2 : report.psResult} confidence={report.psConfidence} reason={report.psReason} />
              <CalcResultMini label="🏭 EV/EBITDA Valuation" result={viewYear === 'Y2' ? report.evResultY2 : report.evResult} confidence={report.evConfidence} reason={report.evReason} />
            </div>

            {/* PATCH 0662 — Manual Override Panel. When extractor misses guidance,
                let user plug in correct values and recompute. */}
            <div style={{ background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 4 }}>
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
                  fontSize: 12, padding: '8px 16px', background: 'var(--mc-warn)', border: 'none',
                  color: 'var(--mc-bg-0)', borderRadius: 5, cursor: 'pointer', fontWeight: 800,
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
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed color-mix(in srgb, var(--mc-warn) 25%, transparent)' }}>
                  <div style={{ fontSize: 11, color: 'var(--mc-warn)', fontWeight: 800, marginBottom: 8 }}>
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
                fontSize: 12, padding: '10px 18px', background: 'var(--mc-bullish)', border: 'none',
                color: 'var(--mc-bg-0)', borderRadius: 6, cursor: 'pointer', fontWeight: 800,
                alignSelf: 'flex-start',
              }}>
                💾 SAVE TO VALUATION BENCH
              </button>
            )}

            {/* Forward guidance extracted */}
            {report.guidance.length > 0 && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.5px', marginBottom: 8 }}>
                  📋 GUIDANCE EXTRACTED ({report.guidance.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {report.guidance.slice(0, 20).map((g, i) => (
                    <span key={i} title={g.rawPhrase} style={{
                      fontSize: 11, padding: '4px 9px', background: 'var(--mc-bg-4)', borderRadius: 4,
                      color: TEXT, fontFamily: 'ui-monospace, monospace', fontWeight: 600,
                    }}>
                      <b style={{ color: 'var(--mc-cyan)' }}>{g.fiscalYear}</b> · {metricLabel(g.metric)} · {formatGuidanceValue(g)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Historical (from Excel) */}
            {report.excelData && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.5px', marginBottom: 8 }}>
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
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>5YR SALES CAGR</div><div style={{ fontSize: 14, color: 'var(--mc-bullish)', fontWeight: 800 }}>{report.excelData.salesCagr5y.toFixed(1)}%</div></div>
                  )}
                  {report.excelData.patCagr5y !== undefined && (
                    <div><div style={{ fontSize: 9, color: DIM, fontWeight: 800 }}>5YR PAT CAGR</div><div style={{ fontSize: 14, color: 'var(--mc-bullish)', fontWeight: 800 }}>{report.excelData.patCagr5y.toFixed(1)}%</div></div>
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
