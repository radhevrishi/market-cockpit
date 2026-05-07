'use client';

import React, { useState, useRef, useCallback } from 'react';

// ── Design tokens
const BG      = '#0a0a0f';
const CARD    = '#13131a';
const CARD2   = '#191926';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#e2e8f0';
const MUTED   = '#64748b';
const ACCENT  = '#38bdf8';
const GREEN   = '#10b981';
const RED     = '#ef4444';
const ORANGE  = '#f97316';
const YELLOW  = '#f59e0b';
const PURPLE  = '#a78bfa';
const F       = { xs:11, sm:13, md:15, lg:17, h2:20, h3:17 };

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL EXTRACTION ENGINE v2
// Handles: SEC 10-K/10-Q (USD absolute), Indian BSE/NSE (₹ Cr/Lakh),
//          Annual reports, Investor presentations, Quarterly results
// ═══════════════════════════════════════════════════════════════════════════

interface FinancialData {
  // Identity
  company: string;
  ticker: string;
  period: string;       // "FY2025", "Q3FY25", "9M FY25"
  periodType: 'annual'|'quarterly'|'halfyear'|'9month'|'unknown';
  filingType: string;   // "10-K", "10-Q", "Results", "Annual Report"
  currency: 'USD'|'INR'|'EUR'|'unknown';
  scale: number;        // multiplier to get millions: 1 for Mn, 0.001 for actual$, 100 for ₹Cr
  scaleLabel: string;   // "$ Mn", "₹ Cr", "$"

  // P&L
  revenue: number|null;
  revenuePrior: number|null;
  costOfRevenue: number|null;
  grossProfit: number|null;
  grossMargin: number|null;
  ebitda: number|null;
  ebitdaMargin: number|null;
  opex: number|null;
  operatingIncome: number|null;     // EBIT
  operatingMargin: number|null;
  interestExpense: number|null;
  otherIncome: number|null;
  pbt: number|null;
  tax: number|null;
  pat: number|null;
  patPrior: number|null;
  patMargin: number|null;
  eps: number|null;
  epsPrior: number|null;
  depreciation: number|null;
  rnd: number|null;
  sga: number|null;

  // Balance Sheet
  cash: number|null;
  shortTermInvestments: number|null;
  totalCurrentAssets: number|null;
  totalAssets: number|null;
  totalDebt: number|null;
  longTermDebt: number|null;
  equity: number|null;
  netDebt: number|null;
  capex: number|null;
  inventory: number|null;
  accountsReceivable: number|null;

  // Cash Flow
  cfo: number|null;
  cfi: number|null;
  cff: number|null;
  fcf: number|null;

  // Returns
  roce: number|null;
  roe: number|null;
  roa: number|null;

  // Business metrics
  orderBook: number|null;
  backlog: number|null;
  headcount: number|null;

  // Guidance & commentary
  guidance: string[];
  keyPoints: string[];

  // Computed ratios
  debtToEquity: number|null;
  currentRatio: number|null;
  cfoPat: number|null;
  grossToRevenue: number|null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Detect filing format + currency + scale
// ─────────────────────────────────────────────────────────────────────────────

function detectFormat(text: string): { currency: FinancialData['currency']; scale: number; scaleLabel: string; filingType: string } {
  const t = text.toLowerCase();

  // Filing type
  let filingType = 'Earnings Document';
  if (/form 10-k|annual report on form 10-k/.test(t)) filingType = 'SEC 10-K (Annual)';
  else if (/form 10-q|quarterly report on form 10-q/.test(t)) filingType = 'SEC 10-Q (Quarterly)';
  else if (/form 20-f/.test(t)) filingType = 'SEC 20-F (Foreign Annual)';
  else if (/results of operations|quarterly results|q[1-4] fy/.test(t)) filingType = 'Quarterly Results';
  else if (/annual report/.test(t)) filingType = 'Annual Report';
  else if (/investor presentation|earnings presentation/.test(t)) filingType = 'Investor Presentation';

  // Currency & scale detection - order matters (most specific first)
  // Indian: ₹ Cr
  if (/\(₹ in crore|\(rs\. in crore|in crores?[^a-z]|₹ crore|amounts in crore/.test(t))
    return { currency: 'INR', scale: 1, scaleLabel: '₹ Cr', filingType };
  // Indian: ₹ Lakh
  if (/\(₹ in lakh|\(rs\. in lakh|in lakhs?[^a-z]|amounts in lakh/.test(t))
    return { currency: 'INR', scale: 0.01, scaleLabel: '₹ Lakh', filingType };
  // USD in thousands
  if (/in thousands|thousands of dollars|\(\$\s*in thousands/.test(t))
    return { currency: 'USD', scale: 0.001, scaleLabel: '$ Thousands', filingType };
  // USD in millions
  if (/in millions|millions of dollars|\(\$\s*in millions|expressed in millions/.test(t))
    return { currency: 'USD', scale: 1, scaleLabel: '$ Mn', filingType };
  // USD in billions
  if (/in billions|\(\$\s*in billions/.test(t))
    return { currency: 'USD', scale: 1000, scaleLabel: '$ Bn', filingType };
  // EUR
  if (/€|euro|eur\b/.test(t))
    return { currency: 'EUR', scale: 1, scaleLabel: '€ Mn', filingType };

  // Detect from actual numbers in the text:
  // If we see lots of 7-9 digit numbers with $ → likely absolute USD
  const largeAbsolute = (text.match(/\$\s*\d{1,3},\d{3},\d{3}/g) || []).length;
  const smallMn = (text.match(/\$\s*\d{1,5}\.\d{1,3}/g) || []).length;
  if (largeAbsolute > 3) return { currency: 'USD', scale: 0.000001, scaleLabel: '$ (raw)', filingType }; // will be normalized
  if (/\$|dollar|usd/.test(t)) return { currency: 'USD', scale: 1, scaleLabel: '$ Mn', filingType };
  if (/₹|rupee|inr/.test(t)) return { currency: 'INR', scale: 1, scaleLabel: '₹ Cr', filingType };

  return { currency: 'unknown', scale: 1, scaleLabel: 'units', filingType };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Smart number parser
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a raw string like "30,498,162" or "30.5" or "(3,086,538)" → number */
function parseRaw(s: string): number {
  if (!s) return NaN;
  const negative = /^\(.*\)$/.test(s.trim()); // accounting negatives like (3,086)
  const cleaned = s.replace(/[,$\(\)\s]/g, '');
  const n = parseFloat(cleaned);
  return negative ? -Math.abs(n) : n;
}

/** Given a list of [label-pattern, raw-value], find the first matching value */
function findValue(blocks: [RegExp, string][], patterns: RegExp[]): number | null {
  for (const pat of patterns) {
    for (const [labelPat, rawVal] of blocks) {
      if (pat.test(labelPat.source) || labelPat.test('')) {
        const n = parseRaw(rawVal);
        if (!isNaN(n)) return n;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Parse financial table rows from text
// Extracts (label, col1_value, col2_value) from columnar financial statements
// ─────────────────────────────────────────────────────────────────────────────

interface TableRow { label: string; values: (number|null)[] }

function parseFinancialTable(text: string): TableRow[] {
  const rows: TableRow[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // Match lines that look like: "Revenue  30,498,162  24,558,809"
    // or: "Net income (loss) $ (3,097,848) $ (15,168,287)"
    // or: "Total revenue 32,215 24,558"

    // Extract all number-like tokens from the line
    const numTokens = trimmed.match(/\(?\$?\s*[\d,]+(?:\.\d+)?\)?/g);
    if (!numTokens || numTokens.length === 0) continue;

    // Extract the label (everything before the first number)
    const firstNumIdx = trimmed.search(/\(?\$?\s*[\d,]+/);
    if (firstNumIdx <= 0) continue;

    const label = trimmed.slice(0, firstNumIdx).replace(/\$|%/g, '').trim().toLowerCase();
    if (!label || label.length < 2) continue;

    // Parse the first two numeric values (current year, prior year)
    const values: (number|null)[] = numTokens.slice(0, 3).map(tok => {
      const n = parseRaw(tok);
      return isNaN(n) ? null : n;
    });

    if (values[0] !== null) {
      rows.push({ label, values });
    }
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: Find value from parsed rows by label patterns
// ─────────────────────────────────────────────────────────────────────────────

function findInRows(rows: TableRow[], patterns: string[], colIndex = 0): number | null {
  for (const pat of patterns) {
    const re = new RegExp(pat, 'i');
    for (const row of rows) {
      if (re.test(row.label)) {
        const v = row.values[colIndex];
        if (v !== null && !isNaN(v)) return v;
      }
    }
  }
  return null;
}

// Find the BEST match for revenue - needs to pick the total, not a sub-item
function findRevenue(rows: TableRow[]): { current: number|null; prior: number|null } {
  // Priority order: total revenue > net sales > revenue (product + services summed)
  const candidates = [
    'total revenue', 'net revenue', 'total net revenue', 'revenue$',
    'revenue from operations', 'net sales', 'total net sales',
    'total revenues', 'revenues', 'net revenues',
  ];

  for (const pat of candidates) {
    const re = new RegExp(`^${pat}$`, 'i');
    for (const row of rows) {
      if (re.test(row.label.trim())) {
        if (row.values[0] !== null) {
          return { current: row.values[0], prior: row.values[1] ?? null };
        }
      }
    }
  }

  // Fuzzy match
  const fuzzy = ['total revenue', 'net sales', 'revenue from', 'total net revenue'];
  for (const pat of fuzzy) {
    const re = new RegExp(pat, 'i');
    for (const row of rows) {
      if (re.test(row.label)) {
        if (row.values[0] !== null && row.values[0] > 0) {
          return { current: row.values[0], prior: row.values[1] ?? null };
        }
      }
    }
  }

  return { current: null, prior: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Normalize scale (convert absolute USD → millions if needed)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeScale(rows: TableRow[], scaleLabel: string): { rows: TableRow[]; normLabel: string; normScale: number } {
  // Check if values look like absolute (7-9 digit) or millions (4-6 digit) or thousands
  const sampleValues = rows.flatMap(r => r.values).filter(v => v !== null && v > 0) as number[];
  if (sampleValues.length === 0) return { rows, normLabel: scaleLabel, normScale: 1 };

  const median = sampleValues.sort((a,b)=>a-b)[Math.floor(sampleValues.length/2)];

  if (scaleLabel === '$ (raw)' || (median > 500_000)) {
    // Numbers are absolute dollars → convert to millions
    const factor = 1 / 1_000_000;
    const normed = rows.map(r => ({ ...r, values: r.values.map(v => v !== null ? Math.round(v * factor * 100) / 100 : null) }));
    return { rows: normed, normLabel: '$ Mn', normScale: factor };
  }

  if (median > 500 && median < 500_000) {
    // Numbers are in thousands → convert to millions
    const factor = 1 / 1_000;
    const normed = rows.map(r => ({ ...r, values: r.values.map(v => v !== null ? Math.round(v * factor * 100) / 100 : null) }));
    return { rows: normed, normLabel: '$ Mn (from $K)', normScale: factor };
  }

  return { rows, normLabel: scaleLabel, normScale: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: Extract periods from text
// ─────────────────────────────────────────────────────────────────────────────

function extractPeriod(text: string): { period: string; periodType: FinancialData['periodType'] } {
  // SEC annual: "fiscal year ended December 31, 2025"
  const annual = text.match(/fiscal year ended\s+([A-Z][a-z]+ \d+,?\s*\d{4})|for the year ended\s+([A-Z][a-z]+ \d+,?\s*\d{4})/i);
  if (annual) return { period: `FY${(annual[1]||annual[2]).match(/\d{4}/)?.[0] || ''}`, periodType: 'annual' };

  // SEC quarterly: "quarter ended September 30, 2025"
  const quarterly = text.match(/(?:three months|quarter) ended\s+([A-Z][a-z]+ \d+,?\s*\d{4})/i);
  if (quarterly) {
    const yr = quarterly[1].match(/\d{4}/)?.[0] || '';
    const mo = quarterly[1].match(/[A-Z][a-z]+/)?.[0] || '';
    const QN: Record<string,string> = { March:'Q4',June:'Q1',September:'Q2',December:'Q3',Mar:'Q4',Jun:'Q1',Sep:'Q2',Dec:'Q3' };
    return { period: `${QN[mo] || 'Q?'}FY${yr}`, periodType: 'quarterly' };
  }

  // Indian quarterly: Q2FY25, Q3 FY26
  const indQ = text.match(/\b(Q[1-4])\s*[-–]?\s*(?:FY\s*)?(\d{2,4})\b/i);
  if (indQ) return { period: `${indQ[1].toUpperCase()}FY${indQ[2]}`, periodType: 'quarterly' };

  // Nine months: "nine months ended"
  if (/nine months ended|9 months ended/.test(text.toLowerCase()))
    return { period: `9M ${text.match(/\d{4}/)?.[0] || ''}`, periodType: '9month' };

  // Half year
  if (/six months ended|half year ended|h[12] fy/.test(text.toLowerCase()))
    return { period: `H1 ${text.match(/\d{4}/)?.[0] || ''}`, periodType: 'halfyear' };

  // Just a year
  const yr = text.match(/\b(20\d{2})\b/)?.[1];
  if (yr) return { period: `FY${yr}`, periodType: 'annual' };

  return { period: 'Latest Period', periodType: 'unknown' };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7: Extract company name
// ─────────────────────────────────────────────────────────────────────────────

function extractCompany(text: string): { company: string; ticker: string } {
  // SEC filing: look for exact name and trading symbol
  const secName = text.match(/\(Exact name of Registrant.*?\)\s*\n([^\n]{5,80})\n/);
  if (secName) return { company: secName[1].trim(), ticker: text.match(/Trading\s+Symbol.*?\n([A-Z]{1,5})\b/)?.[1] || '' };

  const tradingSym = text.match(/Trading.*Symbol[^\n]*\n([A-Z]{1,6})\b/);
  const ticker = tradingSym?.[1] || '';

  // "Exact name" label
  const exact = text.match(/exact name of registrant[^\n]*\n\s*([^\n]{5,80})/i);
  if (exact) return { company: exact[1].trim(), ticker };

  // Company name at start of document
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 4);
  for (const line of lines.slice(0, 15)) {
    if (/(?:Inc|Corp|Ltd|Limited|LLC|plc|GmbH|Holdings|Group|Systems|Technologies|Pharmaceuticals|Energy|Power|Finance|Bank)\b/i.test(line) && line.length < 100) {
      return { company: line, ticker };
    }
  }

  // "Company:" label
  const label = text.match(/(?:Company|Issuer|Entity|Registrant)\s*[:\|]\s*([^\n]{5,80})/i);
  if (label) return { company: label[1].trim(), ticker };

  return { company: 'Unknown Company', ticker };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8: Extract guidance & key management statements
// ─────────────────────────────────────────────────────────────────────────────

function extractGuidance(text: string): { guidance: string[]; keyPoints: string[] } {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 40 && s.length < 400);

  const GUIDANCE_KWS = ['guidance', 'outlook', 'target', 'expect', 'forecast', 'anticipate', 'plan to', 'going forward', 'next year', 'next quarter', 'fy20', 'will grow', 'margin expansion', 'pipeline of'];
  const KEYPOINT_KWS = ['increased', 'decreased', 'growth of', 'higher', 'lower', 'improved', 'declined', 'record', 'highest', 'year-over-year', 'as compared', 'compared to'];

  const guidance = sentences.filter(s => {
    const sl = s.toLowerCase();
    return GUIDANCE_KWS.some(kw => sl.includes(kw)) && /\b(we|our|company|management)\b/i.test(s);
  }).slice(0, 5);

  const keyPoints = sentences.filter(s => {
    const sl = s.toLowerCase();
    return KEYPOINT_KWS.some(kw => sl.includes(kw)) && /\d/.test(s) && s.length < 200;
  }).slice(0, 6);

  return { guidance, keyPoints };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXTRACTION: orchestrates all steps
// ─────────────────────────────────────────────────────────────────────────────

function extractFinancials(rawText: string): FinancialData {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Step 1: Format detection
  const { currency, scale: rawScale, scaleLabel: rawScaleLabel, filingType } = detectFormat(text);

  // Step 2+3: Parse all financial table rows
  let rows = parseFinancialTable(text);

  // Step 5: Normalize scale
  const { rows: normRows, normLabel: scaleLabel } = normalizeScale(rows, rawScaleLabel);
  rows = normRows;

  // Step 6: Period
  const { period, periodType } = extractPeriod(text);

  // Step 7: Company
  const { company, ticker } = extractCompany(text);

  // Step 8: Guidance
  const { guidance, keyPoints } = extractGuidance(text);

  // ── P&L ──────────────────────────────────────────────────────────────────
  const { current: revenue, prior: revenuePrior } = findRevenue(rows);

  const grossProfit = findInRows(rows, ['gross profit', 'gross margin']) ??
    findInRows(rows, ['total gross profit', 'gross earnings']);

  const costOfRevenue = findInRows(rows, ['cost of revenue', 'cost of goods sold', 'cost of products', 'cost of sales', 'total cost of revenue']);

  // Gross margin
  const grossMargin = grossProfit && revenue && revenue > 0
    ? Math.round((grossProfit / revenue) * 10000) / 100
    : (() => {
        const gm = findInRows(rows, ['gross margin', 'gross profit margin', 'gross profit %']);
        return gm && Math.abs(gm) <= 100 ? gm : null;
      })();

  // Operating income
  const operatingIncome = findInRows(rows, [
    'income from operations', 'loss from operations', 'income.*operations$', 'operating income',
    'loss.*operations$', 'total operating', 'ebit$',
  ]);
  const operatingMargin = operatingIncome && revenue && revenue > 0
    ? Math.round((operatingIncome / revenue) * 10000) / 100 : null;

  // Operating expenses
  const opex = findInRows(rows, ['total operating expenses', 'total operating expense', 'total opex', 'operating expenses']);

  // R&D
  const rnd = findInRows(rows, ['research and development', 'r&d expense', 'r&d', 'research & development']);
  const sga = findInRows(rows, ['selling.*general.*admin', 'general.*administrative', 'selling.*marketing', 'sg&a', 's,g&a']);

  // EBITDA: try direct, then compute from Operating Income + D&A
  let ebitda = findInRows(rows, ['ebitda', 'adjusted ebitda', 'operating ebitda']);
  const depreciation = findInRows(rows, [
    'depreciation and amortization', 'depreciation.*amortization', 'depreciation',
    'amortization', 'd&a', 'da$',
  ]);
  if (!ebitda && operatingIncome !== null && depreciation !== null) {
    ebitda = operatingIncome + Math.abs(depreciation);
  }
  // Also try: Gross Profit - Opex + D&A
  if (!ebitda && grossProfit !== null && opex !== null && depreciation !== null) {
    ebitda = grossProfit - opex + Math.abs(depreciation);
  }
  const ebitdaMargin = ebitda && revenue && revenue > 0
    ? Math.round((ebitda / revenue) * 10000) / 100 : null;

  // Interest
  const interestExpense = findInRows(rows, ['interest expense', 'finance costs', 'interest cost', 'borrowing cost']);
  const otherIncome = findInRows(rows, ['other income', 'other income.*net', 'non-operating income']);

  // PBT
  const pbt = findInRows(rows, [
    'income.*before.*tax', 'loss.*before.*tax', 'profit before tax', 'pbt$',
    'earnings before.*tax', 'loss.*income.*tax',
  ]);

  const tax = findInRows(rows, ['provision for income tax', 'income tax', 'tax expense', 'provision.*tax']);

  // PAT / Net Income
  const pat = findInRows(rows, [
    'net income$', 'net loss$', 'net income.*loss', 'net loss.*income',
    'profit after tax', 'pat$', 'net profit', 'profit for the', 'loss from continuing',
    'net income.*loss.*$',
  ]);
  const patPrior = pat !== null ? (rows.find(r => /net income|net loss|net profit|pat$/.test(r.label))?.values[1] ?? null) : null;
  const patMargin = pat && revenue && revenue > 0 ? Math.round((pat / revenue) * 10000) / 100 : null;

  const eps = findInRows(rows, ['basic.*eps', 'diluted.*eps', 'earnings per share', 'loss per share', 'eps$']);
  const epsPrior = eps !== null ? (rows.find(r => /eps|earnings per share|loss per share/.test(r.label))?.values[1] ?? null) : null;

  // ── Balance Sheet ──────────────────────────────────────────────────────────
  const cash = findInRows(rows, ['cash and cash equivalents', 'cash.*equivalents', 'cash and short.*invest']);
  const shortTermInvestments = findInRows(rows, ['short.*term invest', 'marketable securities', 'investments$']);
  const totalCurrentAssets = findInRows(rows, ['total current assets']);
  const totalAssets = findInRows(rows, ['total assets$', 'total.*assets$']);
  const longTermDebt = findInRows(rows, ['long.*term.*debt', 'long.*term.*borrow', 'notes payable', 'term loan']);
  const totalDebt = findInRows(rows, ['total.*debt', 'total.*borrow', 'total.*indebtedness']) ?? longTermDebt;
  const equity = findInRows(rows, [
    "total stockholders.*equity", "total shareholders.*equity", "total equity$",
    "net worth", "stockholders equity", "shareholders equity",
  ]);
  const netDebt = (totalDebt !== null && cash !== null) ? totalDebt - cash : null;
  const capex = findInRows(rows, ['capital expenditure', 'capex', 'purchase.*property.*plant', 'additions.*fixed', 'payments.*acquisition.*assets']);
  const inventory = findInRows(rows, ['inventory', 'inventories', 'stock in trade']);
  const accountsReceivable = findInRows(rows, ['accounts receivable', 'trade receivable', 'debtors']);

  // ── Cash Flow ──────────────────────────────────────────────────────────────
  const cfo = findInRows(rows, [
    'net cash.*operating activities', 'cash.*operating activities', 'operating activities$',
    'cash used in.*operating', 'cash provided.*operating', 'cash generated from operations',
  ]);
  const cfi = findInRows(rows, ['net cash.*investing', 'investing activities$', 'cash.*investing activities']);
  const cff = findInRows(rows, ['net cash.*financing', 'financing activities$', 'cash.*financing activities']);
  const fcf = cfo !== null && capex !== null ? cfo - Math.abs(capex) : null;

  // ── Returns ────────────────────────────────────────────────────────────────
  let roce = findInRows(rows, ['return on capital employed', 'roce$', 'return on ce']);
  let roe = findInRows(rows, ['return on equity', 'roe$', 'return on net worth', 'ronw']);
  let roa = findInRows(rows, ['return on assets', 'roa$', 'return on total assets']);

  // Compute if not found
  if (!roce && operatingIncome && equity && equity > 0)
    roce = Math.round((operatingIncome / equity) * 10000) / 100;
  if (!roe && pat && equity && equity > 0)
    roe = Math.round((pat / equity) * 10000) / 100;
  if (!roa && pat && totalAssets && totalAssets > 0)
    roa = Math.round((pat / totalAssets) * 10000) / 100;

  // ── Business metrics ──────────────────────────────────────────────────────
  const orderBook = findInRows(rows, ['order book', 'order backlog', 'backlog', 'pipeline']);
  const backlog = orderBook;
  const headcount = (() => {
    const m = rawText.match(/(\d[\d,]+)\s*(?:employees|full-time|FTEs)/i);
    return m ? parseRaw(m[1]) : null;
  })();

  // ── Computed ratios ────────────────────────────────────────────────────────
  const debtToEquity = totalDebt !== null && equity && equity > 0 ? Math.round((totalDebt / equity) * 100) / 100 : null;
  const currentRatio: number | null = (() => {
    if (totalCurrentAssets === null) return null;
    const tcl = findInRows(rows, ['total current liabilities']);
    return tcl && tcl > 0 ? Math.round((totalCurrentAssets / tcl) * 100) / 100 : null;
  })();
  const cfoPat = cfo !== null && pat !== null && pat !== 0 ? Math.round((cfo / pat) * 100) / 100 : null;

  return {
    company, ticker, period, periodType, filingType, currency, scale: rawScale, scaleLabel,
    revenue, revenuePrior, costOfRevenue, grossProfit, grossMargin,
    ebitda, ebitdaMargin, opex, operatingIncome, operatingMargin,
    interestExpense, otherIncome, pbt, tax, pat, patPrior, patMargin,
    eps, epsPrior, depreciation, rnd, sga,
    cash, shortTermInvestments, totalCurrentAssets, totalAssets,
    totalDebt, longTermDebt, equity, netDebt, capex, inventory, accountsReceivable,
    cfo, cfi, cff, fcf,
    roce, roe, roa, orderBook, backlog, headcount,
    guidance, keyPoints,
    debtToEquity, currentRatio: currentRatio ?? null, cfoPat, grossToRevenue: grossMargin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS + VERDICT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

interface Signal { type: 'positive'|'negative'|'neutral'|'warning'; label: string; detail: string; importance: 'high'|'medium'|'low' }

function analyzeSignals(d: FinancialData): { signals: Signal[]; score: number; verdict: string; color: string } {
  const signals: Signal[] = [];
  let score = 50;
  const { revenue, revenuePrior, pat, patPrior, grossMargin, ebitdaMargin, ebitda,
          operatingIncome, cfo, fcf, debtToEquity, roce, roe, cfoPat, eps, epsPrior,
          cash, totalDebt, orderBook } = d;

  // ── REVENUE GROWTH ────────────────────────────────────────────────────────
  if (revenue && revenuePrior && revenuePrior > 0) {
    const g = ((revenue - revenuePrior) / revenuePrior) * 100;
    if (g >= 25)      { signals.push({ type:'positive', label:'Strong Revenue Growth', detail:`+${g.toFixed(1)}% YoY — exceeds 25% high-growth threshold`, importance:'high' }); score += 12; }
    else if (g >= 15) { signals.push({ type:'positive', label:'Good Revenue Growth', detail:`+${g.toFixed(1)}% YoY`, importance:'high' }); score += 7; }
    else if (g >= 5)  { signals.push({ type:'neutral',  label:'Moderate Revenue Growth', detail:`+${g.toFixed(1)}% YoY — below growth threshold`, importance:'medium' }); }
    else if (g < 0)   { signals.push({ type:'negative', label:'Revenue Declined', detail:`${g.toFixed(1)}% YoY — top-line contraction`, importance:'high' }); score -= 12; }
    else              { signals.push({ type:'warning',  label:'Revenue Stagnant', detail:`+${g.toFixed(1)}% YoY — negligible growth`, importance:'medium' }); score -= 3; }
  }

  // ── PAT / NET INCOME ──────────────────────────────────────────────────────
  if (pat !== null) {
    if (pat < 0) {
      signals.push({ type:'negative', label:'Net Loss', detail:`Loss of ${Math.abs(pat).toFixed(2)} ${d.scaleLabel} — company not yet profitable`, importance:'high' }); score -= 15;
    } else if (patPrior && patPrior !== 0) {
      const pg = ((pat - patPrior) / Math.abs(patPrior)) * 100;
      if (pg >= 30) { signals.push({ type:'positive', label:'Profit Surge', detail:`+${pg.toFixed(1)}% YoY profit growth`, importance:'high' }); score += 10; }
      else if (pg < -20) { signals.push({ type:'negative', label:'Profit Decline', detail:`${pg.toFixed(1)}% YoY — earnings falling`, importance:'high' }); score -= 10; }
    }
  }

  // ── GROSS MARGIN ──────────────────────────────────────────────────────────
  if (grossMargin !== null) {
    if (grossMargin >= 50)      { signals.push({ type:'positive', label:'Premium Gross Margin', detail:`${grossMargin.toFixed(1)}% gross margin — exceptional pricing power`, importance:'high' }); score += 10; }
    else if (grossMargin >= 30) { signals.push({ type:'positive', label:'Healthy Gross Margin', detail:`${grossMargin.toFixed(1)}% gross margin`, importance:'medium' }); score += 5; }
    else if (grossMargin < 10)  { signals.push({ type:'negative', label:'Very Thin Gross Margin', detail:`${grossMargin.toFixed(1)}% — minimal room for error`, importance:'high' }); score -= 8; }
  }

  // ── EBITDA MARGIN ─────────────────────────────────────────────────────────
  if (ebitdaMargin !== null) {
    if (ebitdaMargin >= 25)     { signals.push({ type:'positive', label:'High EBITDA Margin', detail:`${ebitdaMargin.toFixed(1)}% — strong operating efficiency`, importance:'medium' }); score += 6; }
    else if (ebitdaMargin < 0)  { signals.push({ type:'negative', label:'Negative EBITDA', detail:`${ebitdaMargin.toFixed(1)}% — operating losses`, importance:'high' }); score -= 10; }
  } else if (operatingIncome !== null && revenue && revenue > 0) {
    const om = (operatingIncome / revenue) * 100;
    if (om < 0) { signals.push({ type:'negative', label:'Operating Loss', detail:`Operating margin ${om.toFixed(1)}%`, importance:'high' }); score -= 10; }
    else if (om >= 15) { signals.push({ type:'positive', label:'Strong Operating Margin', detail:`${om.toFixed(1)}% operating margin`, importance:'medium' }); score += 5; }
  }

  // ── BALANCE SHEET ─────────────────────────────────────────────────────────
  if (debtToEquity !== null) {
    if (debtToEquity <= 0.1)    { signals.push({ type:'positive', label:'Virtually Debt-Free', detail:`D/E = ${debtToEquity.toFixed(2)}x — fortress balance sheet`, importance:'high' }); score += 10; }
    else if (debtToEquity <= 0.5) { signals.push({ type:'positive', label:'Low Leverage', detail:`D/E = ${debtToEquity.toFixed(2)}x — conservative capital structure`, importance:'medium' }); score += 5; }
    else if (debtToEquity > 2.0) { signals.push({ type:'negative', label:'High Leverage', detail:`D/E = ${debtToEquity.toFixed(2)}x — elevated financial risk`, importance:'high' }); score -= 10; }
    else if (debtToEquity > 1.0) { signals.push({ type:'warning',  label:'Moderate Leverage', detail:`D/E = ${debtToEquity.toFixed(2)}x — watch interest coverage`, importance:'medium' }); }
  }

  if (cash !== null && totalDebt !== null) {
    if (cash > totalDebt) { signals.push({ type:'positive', label:'Net Cash Position', detail:`Cash ≥ Total Debt — self-funding business`, importance:'high' }); score += 8; }
  }

  // ── CASH FLOW ─────────────────────────────────────────────────────────────
  if (cfo !== null) {
    if (cfo < 0) { signals.push({ type:'negative', label:'Negative Operating Cash Flow', detail:`CFO = ${cfo.toFixed(2)} ${d.scaleLabel} — burning cash`, importance:'high' }); score -= 8; }
  }
  if (cfoPat !== null && pat && pat > 0) {
    if (cfoPat >= 1.0) { signals.push({ type:'positive', label:'Excellent Cash Conversion', detail:`CFO/PAT = ${cfoPat.toFixed(2)}x — earnings fully backed by cash`, importance:'high' }); score += 10; }
    else if (cfoPat >= 0.7) { signals.push({ type:'positive', label:'Good Cash Quality', detail:`CFO/PAT = ${cfoPat.toFixed(2)}x`, importance:'medium' }); score += 5; }
    else if (cfoPat < 0.3) { signals.push({ type:'warning', label:'Low Cash Conversion', detail:`CFO/PAT = ${cfoPat.toFixed(2)}x — earnings not converting to cash`, importance:'high' }); score -= 6; }
  }
  if (fcf !== null) {
    if (fcf > 0) { signals.push({ type:'positive', label:'Free Cash Flow Positive', detail:`FCF = ${fcf.toFixed(2)} ${d.scaleLabel}`, importance:'medium' }); score += 5; }
    else { signals.push({ type:'warning', label:'Negative Free Cash Flow', detail:`FCF = ${fcf.toFixed(2)} — investing phase or cash burn`, importance:'medium' }); score -= 5; }
  }

  // ── RETURNS ───────────────────────────────────────────────────────────────
  if (roce !== null) {
    if (roce >= 20) { signals.push({ type:'positive', label:'Strong ROCE', detail:`${roce.toFixed(1)}% — above 20% moat threshold`, importance:'medium' }); score += 6; }
    else if (roce < 10) { signals.push({ type:'warning', label:'Below-Average ROCE', detail:`${roce.toFixed(1)}% — may be below cost of capital`, importance:'medium' }); score -= 4; }
  }
  if (roe !== null && roe >= 15) { signals.push({ type:'positive', label:'High ROE', detail:`${roe.toFixed(1)}%`, importance:'medium' }); score += 4; }

  // ── EPS GROWTH ────────────────────────────────────────────────────────────
  if (eps !== null && epsPrior !== null && epsPrior !== 0) {
    const eg = ((eps - epsPrior) / Math.abs(epsPrior)) * 100;
    if (eg >= 20) { signals.push({ type:'positive', label:'EPS Acceleration', detail:`EPS grew ${eg.toFixed(1)}% YoY`, importance:'medium' }); score += 6; }
    else if (eg < -20) { signals.push({ type:'negative', label:'EPS Deterioration', detail:`EPS fell ${eg.toFixed(1)}% YoY`, importance:'medium' }); score -= 6; }
  }

  // ── ORDER BOOK ────────────────────────────────────────────────────────────
  if (orderBook && revenue && revenue > 0) {
    const obr = orderBook / (revenue * (d.periodType === 'quarterly' ? 4 : 1));
    if (obr >= 2)   { signals.push({ type:'positive', label:'Strong Order Visibility', detail:`${obr.toFixed(1)}x revenue in order book — multi-year runway`, importance:'high' }); score += 8; }
    else if (obr >= 1) { signals.push({ type:'positive', label:'Healthy Pipeline', detail:`${obr.toFixed(1)}x revenue visibility`, importance:'medium' }); score += 4; }
  }

  // Score clamp
  score = Math.max(10, Math.min(96, score));

  const pos = signals.filter(s => s.type === 'positive').length;
  const neg = signals.filter(s => s.type === 'negative').length;
  let verdict: string, color: string;
  if (score >= 75)      { verdict = `Strong ${d.filingType} — ${pos} positives, ${neg} concerns. Thesis intact.`; color = GREEN; }
  else if (score >= 60) { verdict = `Decent result — ${pos} positives vs ${neg} concerns. Monitor key metrics.`; color = '#10b981aa'; }
  else if (score >= 45) { verdict = `Mixed result — balanced signals. Watch next quarter closely.`; color = YELLOW; }
  else if (score >= 30) { verdict = `Weak result — ${neg} concerns dominate. Re-assess thesis.`; color = ORANGE; }
  else                  { verdict = `Concerning — significant deterioration detected.`; color = RED; }

  return { signals, score, verdict, color };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF TEXT EXTRACTION (browser-side via PDF.js CDN)
// ─────────────────────────────────────────────────────────────────────────────

async function extractPDFText(file: File): Promise<{ text: string; error: string }> {
  try {
    // Load PDF.js from CDN if not already loaded
    if (!(window as any).pdfjsLib) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('PDF.js CDN load failed'));
        document.head.appendChild(script);
      });
    }
    const pdfjsLib = (window as any).pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let allText = '';
    const MAX_PAGES = 80; // 10-K can be 200+ pages; focus on key financial sections
    const totalPages = Math.min(pdf.numPages, MAX_PAGES);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      // Reconstruct lines preserving tabular structure
      const items: any[] = content.items;
      let lastY: number | null = null;
      let line = '';
      for (const item of items) {
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          allText += line.trimEnd() + '\n';
          line = '';
        }
        line += item.str + ' ';
        lastY = y;
      }
      if (line.trim()) allText += line.trimEnd() + '\n';
      allText += '\n';
    }
    return { text: allText, error: '' };
  } catch (e: any) {
    return { text: '', error: e.message || 'PDF extraction failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null, d: FinancialData): string {
  if (v === null) return '—';
  const s = d.scaleLabel;
  const abs = Math.abs(v);
  let numStr: string;
  if (abs >= 1000) numStr = (v / 1000).toFixed(1) + 'K';
  else if (abs >= 1)  numStr = v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  else               numStr = v.toFixed(3);
  return v < 0 ? `(${numStr}) ${s}` : `${numStr} ${s}`;
}
function fmtPct(v: number | null): string { return v === null ? '—' : `${v.toFixed(1)}%`; }
function growthBadge(cur: number | null, prior: number | null): { text: string; color: string } | null {
  if (cur === null || prior === null || prior === 0) return null;
  const g = ((cur - prior) / Math.abs(prior)) * 100;
  return { text: `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`, color: g >= 0 ? GREEN : RED };
}
function numColor(v: number | null, goodIfPositive = true): string {
  if (v === null) return MUTED;
  if (goodIfPositive) return v >= 0 ? TEXT : RED;
  return v <= 0 ? GREEN : RED;
}
function metricColor(v: number | null, good: number, warn: number): string {
  if (v === null) return MUTED;
  if (v >= good) return GREEN;
  if (v >= warn) return YELLOW;
  return RED;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL STORAGE HISTORY
// ─────────────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string; company: string; ticker: string; period: string; score: number;
  color: string; verdict: string; revenue: number|null; pat: number|null;
  scaleLabel: string; analyzedAt: string;
}
const HISTORY_KEY = 'ea_history_v1';
function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(entries: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 30))); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function EarningsAnalysisPage() {
  const [mode, setMode] = useState<'paste'|'upload'|'url'>('upload');
  const [rawText, setRawText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [data, setData] = useState<FinancialData|null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [score, setScore] = useState(0);
  const [verdict, setVerdict] = useState('');
  const [verdictColor, setVerdictColor] = useState(MUTED);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [expandedSec, setExpandedSec] = useState<string|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useCallback((text: string, source: string) => {
    if (!text.trim()) { setError('No text to analyze'); return; }
    setError('');
    setLoadingMsg('Extracting financial data...');
    // Small timeout to allow UI to update
    setTimeout(() => {
      try {
        const d = extractFinancials(text);
        const { signals: sigs, score: sc, verdict: vd, color: vc } = analyzeSignals(d);
        setData(d);
        setSignals(sigs);
        setScore(sc);
        setVerdict(vd);
        setVerdictColor(vc);
        // Save to history
        const entry: HistoryEntry = {
          id: Date.now().toString(), company: d.company, ticker: d.ticker,
          period: d.period, score: sc, color: vc, verdict: vd,
          revenue: d.revenue, pat: d.pat, scaleLabel: d.scaleLabel,
          analyzedAt: new Date().toISOString(),
        };
        const updated = [entry, ...history.filter(h => h.company !== d.company || h.period !== d.period)];
        setHistory(updated);
        saveHistory(updated);
      } catch (e: any) {
        setError('Analysis failed: ' + e.message);
      }
      setLoading(false); setLoadingMsg('');
    }, 10);
  }, [history]);

  async function handleFile(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    setLoading(true); setError('');

    if (ext === 'pdf') {
      setLoadingMsg(`Parsing PDF: ${file.name} (this may take 10-20s)...`);
      const { text, error: pdfErr } = await extractPDFText(file);
      if (pdfErr || !text.trim()) {
        setError(`PDF extraction issue: ${pdfErr || 'Empty text'}. Try "Paste Text" mode — open the PDF, Ctrl+A, Ctrl+C, paste here.`);
        setLoading(false); setLoadingMsg(''); return;
      }
      run(text, `PDF: ${file.name}`);
    } else if (ext === 'xlsx' || ext === 'xls') {
      setLoadingMsg('Parsing Excel...');
      try {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const txt = wb.SheetNames.map(n => `=== ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
        run(txt, `Excel: ${file.name}`);
      } catch (e: any) {
        setError('Excel parse failed: ' + e.message); setLoading(false); setLoadingMsg('');
      }
    } else {
      setLoadingMsg('Reading file...');
      const txt = await file.text().catch(() => '');
      if (!txt) { setError('Could not read file.'); setLoading(false); setLoadingMsg(''); return; }
      run(txt, `File: ${file.name}`);
    }
  }

  async function handleURL() {
    const url = urlInput.trim();
    if (!url) { setError('Enter a URL'); return; }
    setLoading(true); setError(''); setLoadingMsg('Fetching document...');
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('pdf')) {
        const blob = await res.blob();
        const file = new File([blob], 'report.pdf', { type: 'application/pdf' });
        const { text, error: e } = await extractPDFText(file);
        if (e || !text) throw new Error(e || 'Empty PDF');
        run(text, `URL: ${url}`);
      } else {
        const html = await res.text();
        const div = document.createElement('div'); div.innerHTML = html;
        const plain = div.innerText || div.textContent || html.replace(/<[^>]*>/g, ' ');
        run(plain, `URL: ${url}`);
      }
    } catch (e: any) {
      setError(`URL fetch failed: ${e.message}. Download the file and use Upload mode.`);
      setLoading(false); setLoadingMsg('');
    }
  }

  function reset() { setData(null); setError(''); setRawText(''); setUrlInput(''); }

  const CARD_S: React.CSSProperties = { backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 };

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, fontFamily: 'system-ui,-apple-system,sans-serif', padding: '24px 20px', maxWidth: 1140, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: ACCENT, margin: '0 0 6px' }}>
          📊 Earnings Intelligence
        </h1>
        <p style={{ fontSize: F.sm, color: MUTED, margin: 0, lineHeight: 1.6 }}>
          Upload any earnings filing — SEC 10-K/10-Q, NSE/BSE quarterly results, annual report PDF, Excel or CSV.
          The engine extracts all financial numbers and delivers an institutional-grade assessment.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {['SEC 10-K / 10-Q', 'NSE/BSE Quarterly Results', 'Annual Report PDF', 'Investor Presentation', 'Balance Sheet Excel'].map(l => (
            <span key={l} style={{ fontSize: 10, color: MUTED, backgroundColor: CARD2, border: `1px solid ${BORDER}`, padding: '3px 9px', borderRadius: 20 }}>{l}</span>
          ))}
        </div>
      </div>

      {!data ? (
        <>
          {/* ── Mode Tabs ── */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, marginBottom: 20 }}>
            {([
              { id:'upload', icon:'📁', label:'Upload File', sub:'PDF, Excel, CSV, TXT' },
              { id:'paste',  icon:'📋', label:'Paste Text',  sub:'Copy from any source' },
              { id:'url',    icon:'🔗', label:'URL / Link',  sub:'SEC EDGAR, NSE, BSE' },
            ] as const).map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                padding: '10px 20px', border: 'none', cursor: 'pointer', background: 'transparent',
                color: mode === m.id ? ACCENT : MUTED, fontWeight: mode === m.id ? 700 : 400,
                fontSize: F.sm, borderBottom: mode === m.id ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: -1, transition: 'all 0.15s',
              }}>
                {m.icon} {m.label}
                <div style={{ fontSize: 9, color: mode === m.id ? ACCENT + '99' : '#334155', fontWeight: 400 }}>{m.sub}</div>
              </button>
            ))}
          </div>

          {/* ── Upload Mode ── */}
          {mode === 'upload' && (
            <div
              style={{ border: `2px dashed ${BORDER}`, borderRadius: 14, padding: '44px 24px', textAlign: 'center', cursor: 'pointer', backgroundColor: CARD, transition: 'border-color 0.2s' }}
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files); }}
              onDragOver={e => e.preventDefault()}
            >
              <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" style={{ display: 'none' }} onChange={e => handleFile(e.target.files)} />
              {loading ? (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
                  <div style={{ fontSize: F.md, color: ACCENT }}>{loadingMsg}</div>
                  <div style={{ fontSize: F.sm, color: MUTED, marginTop: 6 }}>Large PDFs (100+ pages) may take 20–30s…</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 44, marginBottom: 14 }}>📂</div>
                  <div style={{ fontSize: F.lg, fontWeight: 700, color: TEXT, marginBottom: 6 }}>Drop file here or click to browse</div>
                  <div style={{ fontSize: F.sm, color: MUTED, marginBottom: 16 }}>
                    PDF, Excel (.xlsx/.xls), CSV, TXT — all earnings formats supported
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {['.PDF', '.XLSX', '.XLS', '.CSV', '.TXT'].map(ext => (
                      <span key={ext} style={{ fontSize: 10, fontWeight: 700, color: ACCENT, backgroundColor: ACCENT + '14', border: `1px solid ${ACCENT}30`, padding: '3px 10px', borderRadius: 4 }}>{ext}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Paste Mode ── */}
          {mode === 'paste' && (
            <div>
              <div style={{ fontSize: F.sm, color: MUTED, marginBottom: 8 }}>
                Open the earnings document → <kbd style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>Ctrl+A</kbd> → <kbd style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>Ctrl+C</kbd> → paste here:
              </div>
              <textarea value={rawText} onChange={e => setRawText(e.target.value)} rows={14}
                placeholder={`Paste any earnings document text here.\n\nExample (SEC 10-K format):\n\nRevenue:\n  Product  $30,498,162  $20,867,800\n  Services  1,717,338   3,691,009\nTotal revenue  32,215,500  24,558,809\nCost of revenue  16,233,017  23,935,885\nGross profit  15,982,483  622,924\nNet income (loss)  5,087,694  (13,634,333)\n\nExample (Indian format - ₹ Cr):\n\nRevenue from Operations  2,345  1,983\nEBITDA  668  534\nPAT  345  267\nEPS  14.50  11.20`}
                style={{ width: '100%', backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px', color: TEXT, fontSize: 12, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.7, fontFamily: 'monospace' }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button onClick={() => { setLoading(true); run(rawText, 'Pasted text'); }} disabled={loading || !rawText.trim()}
                  style={{ padding: '10px 24px', backgroundColor: ACCENT, border: 'none', borderRadius: 8, color: '#000', fontWeight: 800, fontSize: F.md, cursor: 'pointer', opacity: loading || !rawText.trim() ? 0.5 : 1 }}>
                  {loading ? `⏳ ${loadingMsg}` : '🔍 Analyze'}
                </button>
                {rawText && <button onClick={() => setRawText('')} style={{ padding: '10px 14px', backgroundColor: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, color: MUTED, fontSize: F.sm, cursor: 'pointer' }}>Clear</button>}
              </div>
            </div>
          )}

          {/* ── URL Mode ── */}
          {mode === 'url' && (
            <div>
              <div style={{ fontSize: F.sm, color: MUTED, marginBottom: 8 }}>
                Enter a direct link to an earnings document (SEC EDGAR, NSE/BSE PDF filings):
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleURL()}
                  placeholder="https://www.sec.gov/Archives/... or NSE/BSE direct PDF link"
                  style={{ flex: 1, backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 14px', color: TEXT, fontSize: F.sm, outline: 'none' }}
                />
                <button onClick={handleURL} disabled={loading || !urlInput.trim()}
                  style={{ padding: '10px 20px', backgroundColor: ACCENT, border: 'none', borderRadius: 8, color: '#000', fontWeight: 700, fontSize: F.sm, cursor: 'pointer', whiteSpace: 'nowrap', opacity: !urlInput.trim() ? 0.5 : 1 }}>
                  {loading ? '⏳' : '🔍 Fetch & Analyze'}
                </button>
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 8 }}>
                💡 Works best with HTML filings and direct PDF links. For login-gated documents, download and upload instead.
              </div>
            </div>
          )}

          {error && (
            <div style={{ backgroundColor: RED + '14', border: `1px solid ${RED}40`, borderRadius: 8, padding: '10px 14px', marginTop: 14, color: RED, fontSize: F.sm }}>
              ⚠ {error}
            </div>
          )}

          {/* ── History ── */}
          {history.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: F.sm, fontWeight: 700, color: MUTED }}>📚 RECENT ANALYSES</div>
                <button onClick={() => { setHistory([]); saveHistory([]); }} style={{ fontSize: 10, color: MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>Clear history</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
                {history.slice(0, 9).map(h => (
                  <div key={h.id} style={{ backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${h.color}`, borderRadius: 10, padding: '12px 14px', cursor: 'default' }}>
                    <div style={{ fontSize: F.sm, fontWeight: 700, color: TEXT }}>{h.company}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                      <span style={{ fontSize: 10, color: ACCENT }}>{h.period}</span>
                      <span style={{ fontSize: 10, color: MUTED }}>·</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: h.color }}>Score {h.score}</span>
                    </div>
                    {h.revenue !== null && (
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>Revenue: {h.revenue.toFixed(1)} {h.scaleLabel}</div>
                    )}
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{h.verdict.slice(0, 55)}…</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Empty state tips ── */}
          {history.length === 0 && (
            <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {[
                { icon: '📄', title: 'SEC 10-K / 10-Q', desc: 'Upload the PDF directly from SEC EDGAR — company, period, and all financials extracted automatically.' },
                { icon: '📊', title: 'NSE/BSE Results', desc: 'Upload the quarterly results PDF from NSE or BSE announcements. ₹ Cr format detected automatically.' },
                { icon: '📑', title: 'Annual Report', desc: 'Full year P&L, balance sheet and cash flow from any company annual report PDF.' },
                { icon: '📋', title: 'Paste from PDF', desc: 'Open any PDF in Chrome → Ctrl+A → Ctrl+C → Paste Text mode → instant analysis.' },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: F.sm, fontWeight: 700, color: TEXT, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ═══════════════════ RESULTS DASHBOARD ═══════════════════════════ */
        <div>
          {/* ── Company Header ── */}
          <div style={{ ...CARD_S, borderLeft: `4px solid ${verdictColor}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, marginBottom: 4 }}>{data.company}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {data.ticker && <span style={{ fontSize: 10, fontWeight: 800, color: ACCENT, backgroundColor: ACCENT + '18', padding: '2px 8px', borderRadius: 4 }}>{data.ticker}</span>}
                  <span style={{ fontSize: 10, color: MUTED }}>{data.period}</span>
                  <span style={{ fontSize: 10, color: MUTED }}>· {data.filingType}</span>
                  <span style={{ fontSize: 10, color: MUTED }}>· {data.scaleLabel}</span>
                  <span style={{ fontSize: 10, color: MUTED }}>· {data.currency}</span>
                </div>
                <div style={{ marginTop: 10, padding: '9px 12px', backgroundColor: verdictColor + '12', border: `1px solid ${verdictColor}30`, borderRadius: 7 }}>
                  <span style={{ fontSize: F.sm, fontWeight: 600, color: verdictColor }}>📋 {verdict}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 34, fontWeight: 900, color: verdictColor }}>{score}</div>
                <div style={{ width: 64, height: 5, backgroundColor: '#1e293b', borderRadius: 3, margin: '4px 0', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${score}%`, backgroundColor: verdictColor, borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 9, color: MUTED }}>QUALITY SCORE / 100</div>
              </div>
            </div>
          </div>

          {/* ── Key Metrics Hero Row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Revenue', value: fmt(data.revenue, data), growth: growthBadge(data.revenue, data.revenuePrior), col: ACCENT },
              { label: 'Gross Margin', value: fmtPct(data.grossMargin), growth: null, col: metricColor(data.grossMargin, 40, 20) },
              { label: 'EBITDA Margin', value: fmtPct(data.ebitdaMargin), growth: null, col: metricColor(data.ebitdaMargin, 20, 10) },
              { label: 'PAT / Net Income', value: fmt(data.pat, data), growth: growthBadge(data.pat, data.patPrior), col: numColor(data.pat) },
              { label: 'EPS', value: data.eps !== null ? `${data.scaleLabel.includes('$') ? '$' : '₹'}${data.eps.toFixed(2)}` : '—', growth: growthBadge(data.eps, data.epsPrior), col: numColor(data.eps) },
              { label: 'D/E Ratio', value: data.debtToEquity !== null ? `${data.debtToEquity.toFixed(2)}x` : '—', growth: null, col: metricColor(data.debtToEquity !== null ? 1 - data.debtToEquity : null, 0.5, 0) },
              { label: 'ROCE', value: fmtPct(data.roce), growth: null, col: metricColor(data.roce, 20, 12) },
              { label: 'Cash / Debt', value: data.cash !== null ? fmt(data.cash, data) : '—', growth: null, col: data.cash !== null && data.totalDebt !== null && data.cash > data.totalDebt ? GREEN : MUTED },
            ].map(({ label, value, growth, col }) => (
              <div key={label} style={{ backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: MUTED, marginBottom: 4, letterSpacing: '0.5px' }}>{label}</div>
                <div style={{ fontSize: F.lg, fontWeight: 800, color: col }}>{value}</div>
                {growth && <div style={{ fontSize: 10, fontWeight: 700, color: growth.color, marginTop: 2 }}>{growth.text} YoY</div>}
              </div>
            ))}
          </div>

          {/* ── 3-column detail grid ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>

            {/* Income Statement */}
            <div style={CARD_S}>
              <div style={{ fontSize: F.sm, fontWeight: 800, color: PURPLE, marginBottom: 12, letterSpacing: '0.5px' }}>📈 INCOME STATEMENT</div>
              {[
                { label: 'Revenue', cur: data.revenue, prior: data.revenuePrior, highlight: true },
                { label: 'Cost of Revenue', cur: data.costOfRevenue, prior: null },
                { label: 'Gross Profit', cur: data.grossProfit, prior: null, extra: fmtPct(data.grossMargin) },
                { label: 'R&D Expense', cur: data.rnd, prior: null },
                { label: 'SG&A', cur: data.sga, prior: null },
                { label: 'Operating Expenses', cur: data.opex, prior: null },
                { label: 'Operating Income (EBIT)', cur: data.operatingIncome, prior: null, extra: fmtPct(data.operatingMargin) },
                { label: 'EBITDA', cur: data.ebitda, prior: null, extra: fmtPct(data.ebitdaMargin) },
                { label: 'Interest Expense', cur: data.interestExpense, prior: null },
                { label: 'Other Income', cur: data.otherIncome, prior: null },
                { label: 'PBT', cur: data.pbt, prior: null },
                { label: 'Tax', cur: data.tax, prior: null },
                { label: 'Net Income / PAT', cur: data.pat, prior: data.patPrior, highlight: true, extra: fmtPct(data.patMargin) },
                { label: 'EPS', cur: data.eps, prior: data.epsPrior, isEps: true },
              ].map(({ label, cur, prior, highlight, extra, isEps }) => {
                if (cur === null && !highlight) return null;
                const gb = growthBadge(cur, prior);
                return (
                  <div key={label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: highlight ? '5px 8px' : '3px 0',
                    backgroundColor: highlight ? '#0f0f1a' : 'transparent',
                    borderRadius: 6, borderLeft: highlight ? `2px solid ${ACCENT}` : 'none',
                    paddingLeft: highlight ? 8 : 0, marginBottom: 2,
                  }}>
                    <span style={{ fontSize: F.xs, color: highlight ? TEXT : MUTED }}>{label}</span>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: F.sm, fontWeight: highlight ? 700 : 400, color: cur !== null && cur < 0 ? RED : highlight ? TEXT : MUTED }}>
                        {isEps ? (cur !== null ? `${data.scaleLabel.includes('$') ? '$' : '₹'}${cur.toFixed(2)}` : '—') : fmt(cur, data)}
                      </span>
                      {extra !== '—' && <span style={{ fontSize: 9, color: MUTED, marginLeft: 5 }}>({extra})</span>}
                      {gb && <span style={{ fontSize: 9, fontWeight: 700, color: gb.color, marginLeft: 5 }}>{gb.text}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Balance Sheet + Returns */}
            <div style={CARD_S}>
              <div style={{ fontSize: F.sm, fontWeight: 800, color: YELLOW, marginBottom: 12, letterSpacing: '0.5px' }}>🏛️ BALANCE SHEET</div>
              {[
                { label: 'Cash & Equivalents', v: data.cash, good: true },
                { label: 'Short-term Investments', v: data.shortTermInvestments, good: true },
                { label: 'Accounts Receivable', v: data.accountsReceivable },
                { label: 'Inventory', v: data.inventory },
                { label: 'Total Current Assets', v: data.totalCurrentAssets, bold: true },
                { label: 'Total Assets', v: data.totalAssets, bold: true },
                { label: 'Long-term Debt', v: data.longTermDebt, bad: true },
                { label: 'Total Debt / Borrowings', v: data.totalDebt, bad: true },
                { label: 'Net Debt', v: data.netDebt, bad: data.netDebt !== null && data.netDebt > 0 },
                { label: 'Equity / Net Worth', v: data.equity, bold: true },
                { label: 'Capex', v: data.capex },
              ].map(({ label, v, good, bad, bold }) => {
                if (v === null) return null;
                return (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ fontSize: F.xs, color: MUTED }}>{label}</span>
                    <span style={{ fontSize: F.sm, fontWeight: bold ? 700 : 400, color: good ? GREEN : bad ? (v < 0 ? GREEN : v > 0 ? ORANGE : MUTED) : TEXT }}>
                      {fmt(v, data)}
                    </span>
                  </div>
                );
              })}
              {/* Computed ratios */}
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, marginTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: PURPLE, marginBottom: 8 }}>RETURN & LEVERAGE METRICS</div>
                {[
                  { label: 'Debt / Equity', value: data.debtToEquity !== null ? `${data.debtToEquity.toFixed(2)}x` : '—', color: metricColor(data.debtToEquity !== null ? (1 - Math.min(data.debtToEquity, 2)) : null, 0.5, 0) },
                  { label: 'Current Ratio', value: data.currentRatio !== null ? `${data.currentRatio.toFixed(2)}x` : '—', color: metricColor(data.currentRatio, 2, 1) },
                  { label: 'ROCE', value: fmtPct(data.roce), color: metricColor(data.roce, 20, 12) },
                  { label: 'ROE', value: fmtPct(data.roe), color: metricColor(data.roe, 15, 10) },
                  { label: 'ROA', value: fmtPct(data.roa), color: metricColor(data.roa, 10, 5) },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ fontSize: F.xs, color: MUTED }}>{label}</span>
                    <span style={{ fontSize: F.sm, fontWeight: 700, color }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cash Flow + Business */}
            <div style={CARD_S}>
              <div style={{ fontSize: F.sm, fontWeight: 800, color: GREEN, marginBottom: 12, letterSpacing: '0.5px' }}>💰 CASH FLOW</div>
              {[
                { label: 'Operating Cash Flow (CFO)', v: data.cfo, key: 'cfo' },
                { label: 'Investing Cash Flow (CFI)', v: data.cfi, key: 'cfi' },
                { label: 'Financing Cash Flow (CFF)', v: data.cff, key: 'cff' },
                { label: 'Capex', v: data.capex ? -Math.abs(data.capex) : null, key: 'capex' },
                { label: 'Free Cash Flow (FCF)', v: data.fcf, key: 'fcf' },
              ].map(({ label, v }) => {
                if (v === null) return null;
                return (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ fontSize: F.xs, color: MUTED }}>{label}</span>
                    <span style={{ fontSize: F.sm, color: v >= 0 ? GREEN : RED }}>{fmt(v, data)}</span>
                  </div>
                );
              })}

              {/* CFO/PAT quality */}
              {data.cfoPat !== null && data.pat !== null && data.pat !== 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', backgroundColor: '#0f0f1a', borderRadius: 7, border: `1px solid ${data.cfoPat >= 0.8 ? GREEN + '30' : RED + '30'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: F.xs, color: MUTED }}>CFO / PAT (cash quality)</span>
                    <span style={{ fontSize: F.sm, fontWeight: 700, color: data.cfoPat >= 0.8 ? GREEN : data.cfoPat >= 0.5 ? YELLOW : RED }}>
                      {data.cfoPat.toFixed(2)}x {data.cfoPat >= 1 ? '✅' : data.cfoPat >= 0.7 ? '✓' : '⚠'}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>
                    {data.cfoPat >= 1 ? 'Excellent — earnings fully cash-backed' : data.cfoPat >= 0.7 ? 'Good cash conversion' : 'Low cash conversion — watch receivables'}
                  </div>
                </div>
              )}

              {/* Order Book */}
              {data.orderBook !== null && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT, marginBottom: 6 }}>📋 ORDER BOOK / BACKLOG</div>
                  <div style={{ fontSize: F.md, fontWeight: 700, color: TEXT }}>{fmt(data.orderBook, data)}</div>
                  {data.revenue && (
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                      {(data.orderBook / (data.revenue * (data.periodType === 'quarterly' ? 4 : 1))).toFixed(1)}x annualised revenue coverage
                    </div>
                  )}
                </div>
              )}

              {/* Headcount */}
              {data.headcount !== null && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginBottom: 3 }}>👥 EMPLOYEES</div>
                  <div style={{ fontSize: F.md, fontWeight: 700, color: TEXT }}>{data.headcount.toLocaleString()}</div>
                </div>
              )}
            </div>
          </div>

          {/* ── Quality Signals ── */}
          <div style={CARD_S}>
            <div style={{ fontSize: F.sm, fontWeight: 800, color: TEXT, marginBottom: 12, letterSpacing: '0.5px' }}>
              🎯 QUALITY SIGNALS &nbsp;
              <span style={{ fontSize: 10, fontWeight: 400, color: MUTED }}>
                {signals.filter(s => s.type === 'positive').length} positive ·{' '}
                {signals.filter(s => s.type === 'negative' || s.type === 'warning').length} concerns
              </span>
            </div>
            {signals.length === 0 ? (
              <div style={{ fontSize: F.sm, color: MUTED }}>
                Insufficient financial data for signal generation.
                Add more detail in the filing (EBITDA, CFO, debt levels) for deeper analysis.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                {[...signals].sort((a, b) => {
                  const pri: Record<string, number> = { positive: 0, negative: 1, warning: 2, neutral: 3 };
                  return (pri[a.type] ?? 3) - (pri[b.type] ?? 3) || (b.importance === 'high' ? 1 : -1);
                }).map((sig, i) => (
                  <div key={i} style={{
                    padding: '9px 12px', borderRadius: 8,
                    backgroundColor: sig.type === 'positive' ? GREEN + '0f' : sig.type === 'negative' ? RED + '0f' : sig.type === 'warning' ? YELLOW + '0a' : CARD,
                    border: `1px solid ${sig.type === 'positive' ? GREEN + '30' : sig.type === 'negative' ? RED + '30' : sig.type === 'warning' ? YELLOW + '25' : BORDER}`,
                    borderLeft: `3px solid ${sig.type === 'positive' ? GREEN : sig.type === 'negative' ? RED : sig.type === 'warning' ? YELLOW : MUTED}`,
                  }}>
                    <div style={{ fontSize: F.xs, fontWeight: 700, color: sig.type === 'positive' ? GREEN : sig.type === 'negative' ? RED : sig.type === 'warning' ? YELLOW : MUTED, marginBottom: 3 }}>
                      {sig.type === 'positive' ? '✅' : sig.type === 'negative' ? '❌' : sig.type === 'warning' ? '⚠️' : 'ℹ️'} {sig.label}
                      {sig.importance === 'high' && <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.6 }}>HIGH</span>}
                    </div>
                    <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>{sig.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Key Points from MD&A ── */}
          {data.keyPoints.length > 0 && (
            <div style={CARD_S}>
              <div style={{ fontSize: F.sm, fontWeight: 800, color: ACCENT, marginBottom: 10, letterSpacing: '0.5px' }}>📌 KEY POINTS FROM MANAGEMENT DISCUSSION</div>
              {data.keyPoints.map((kp, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: i < data.keyPoints.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                  <span style={{ fontSize: 10, color: ACCENT, flexShrink: 0 }}>›</span>
                  <span style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.6 }}>{kp}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Management Guidance ── */}
          {data.guidance.length > 0 && (
            <div style={CARD_S}>
              <div style={{ fontSize: F.sm, fontWeight: 800, color: YELLOW, marginBottom: 10, letterSpacing: '0.5px' }}>💬 GUIDANCE & FORWARD-LOOKING STATEMENTS</div>
              {data.guidance.map((g, i) => (
                <div key={i} style={{ padding: '8px 12px', marginBottom: 6, backgroundColor: '#0f0f1a', borderRadius: 6, borderLeft: '2px solid #f59e0b50', fontSize: F.xs, color: MUTED, lineHeight: 1.7 }}>
                  "{g}"
                </div>
              ))}
            </div>
          )}

          {/* ── Expandable sections ── */}
          {[
            { id: 'snapshot', title: '📐 Full Key Ratios Snapshot', content: (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                {[
                  ['Gross Margin', fmtPct(data.grossMargin), metricColor(data.grossMargin, 40, 20)],
                  ['EBITDA Margin', fmtPct(data.ebitdaMargin), metricColor(data.ebitdaMargin, 20, 10)],
                  ['Operating Margin', fmtPct(data.operatingMargin), metricColor(data.operatingMargin, 15, 5)],
                  ['PAT Margin', fmtPct(data.patMargin), metricColor(data.patMargin, 10, 5)],
                  ['ROCE', fmtPct(data.roce), metricColor(data.roce, 20, 12)],
                  ['ROE', fmtPct(data.roe), metricColor(data.roe, 15, 10)],
                  ['ROA', fmtPct(data.roa), metricColor(data.roa, 8, 4)],
                  ['D/E Ratio', data.debtToEquity !== null ? `${data.debtToEquity.toFixed(2)}x` : '—', metricColor(data.debtToEquity !== null ? 1 - data.debtToEquity : null, 0.5, 0)],
                  ['CFO/PAT', data.cfoPat !== null ? `${data.cfoPat.toFixed(2)}x` : '—', metricColor(data.cfoPat, 0.8, 0.5)],
                  ['EPS', data.eps !== null ? `${data.scaleLabel.includes('$') ? '$' : '₹'}${data.eps.toFixed(2)}` : '—', numColor(data.eps)],
                  ['FCF', fmt(data.fcf, data), numColor(data.fcf)],
                  ['Current Ratio', data.currentRatio !== null ? `${data.currentRatio.toFixed(2)}x` : '—', metricColor(data.currentRatio, 2, 1)],
                ].map(([lbl, val, col]) => (
                  <div key={lbl as string} style={{ backgroundColor: '#0f0f1a', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: MUTED, marginBottom: 3 }}>{lbl}</div>
                    <div style={{ fontSize: F.lg, fontWeight: 800, color: val === '—' ? '#334155' : col as string }}>{val}</div>
                  </div>
                ))}
              </div>
            )},
          ].map(({ id, title, content }) => (
            <div key={id} style={{ ...CARD_S, marginBottom: 10 }}>
              <button onClick={() => setExpandedSec(expandedSec === id ? null : id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: F.sm, fontWeight: 700, color: MUTED }}>{title}</span>
                <span style={{ color: MUTED, fontSize: 12 }}>{expandedSec === id ? '▲' : '▼'}</span>
              </button>
              {expandedSec === id && <div style={{ marginTop: 14 }}>{content}</div>}
            </div>
          ))}

          {/* ── Actions ── */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <button onClick={() => {
              const lines = [
                `EARNINGS ANALYSIS — ${data.company} | ${data.period} | ${data.filingType}`,
                `Quality Score: ${score}/100`,
                `Verdict: ${verdict}`,
                '', 'KEY METRICS:',
                `  Revenue: ${fmt(data.revenue, data)}${data.revenuePrior ? ' (' + (((data.revenue!-data.revenuePrior)/Math.abs(data.revenuePrior))*100).toFixed(1) + '% YoY)' : ''}`,
                `  Gross Margin: ${fmtPct(data.grossMargin)}`,
                `  EBITDA Margin: ${fmtPct(data.ebitdaMargin)}`,
                `  Net Income/PAT: ${fmt(data.pat, data)}`,
                `  EPS: ${data.eps !== null ? `${data.scaleLabel.includes('$') ? '$' : '₹'}${data.eps.toFixed(2)}` : '—'}`,
                `  D/E: ${data.debtToEquity !== null ? data.debtToEquity.toFixed(2) + 'x' : '—'}`,
                `  ROCE: ${fmtPct(data.roce)}  |  ROE: ${fmtPct(data.roe)}`,
                `  CFO/PAT: ${data.cfoPat !== null ? data.cfoPat.toFixed(2) + 'x' : '—'}`,
                '', 'SIGNALS:',
                ...signals.map(s => `  ${s.type === 'positive' ? '✅' : s.type === 'negative' ? '❌' : '⚠️'} ${s.label}: ${s.detail}`),
              ].join('\n');
              navigator.clipboard.writeText(lines).catch(() => {});
            }} style={{ padding: '9px 18px', backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontSize: F.sm, cursor: 'pointer' }}>
              📋 Copy Full Summary
            </button>
            <button onClick={reset} style={{ padding: '9px 18px', backgroundColor: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, color: MUTED, fontSize: F.sm, cursor: 'pointer' }}>
              🔄 Analyze Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
