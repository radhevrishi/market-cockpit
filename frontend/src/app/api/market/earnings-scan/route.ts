import { NextResponse } from 'next/server';
import { fetchCompanyFinancialResults, fetchStockQuote } from '@/lib/nse';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ══════════════════════════════════════════════
// EARNINGS SCAN API — 3-Layer Data Pipeline
// Layer 1: NSE/BSE (primary) → metadata + result dates
// Layer 2: screener.in (structured) → quarterly P&L numbers
// Layer 3: Persistent cache → store & serve fresh data
//
// Returns: Revenue, Operating Profit, OPM, PAT, NPM, EPS
// with YoY/QoQ calculations for the latest 3-4 quarters
// Banking stock detection & special handling included
// ══════════════════════════════════════════════

// No hardcoded default — symbols must come from the request (frontend sends from API/localStorage watchlist)
const DEFAULT_WATCHLIST: string[] = [];

// NSE symbol → screener.in symbol mapping (where they differ)
// Discovered via screener.in search API: /api/company/search/?q=XXX
const SCREENER_SYMBOL_MAP: Record<string, string> = {
  'TATAMOTORS': 'TMCV',
  'M&M': 'MM',
  'M&MFIN': 'MMFIN',
  'L&TFH': 'LTFH',
  'BAJAJ-AUTO': 'BAJAJ_AUTO',
};

/** Get screener.in symbol for a given NSE symbol */
function getScreenerSymbol(nseSymbol: string): string {
  return SCREENER_SYMBOL_MAP[nseSymbol] || nseSymbol;
}

// ── Global Data Persistence Store ───────────────

interface StoredEarnings {
  symbol: string;
  quarters: QuarterFinancials[];
  companyName: string;
  mcap: number | null;
  pe: number | null;
  currentPrice: number | null;
  sector: string;
  isBanking: boolean; // Flag for banking/NBFC companies
  source: 'nse' | 'screener.in' | 'trendlyne';
  fetchedAt: number;
  validatedAt: number;
}

// Initialize global store if not present
function getGlobalStore(): Map<string, StoredEarnings> {
  if (!(globalThis as any).__MC_EARNINGS_STORE__) {
    (globalThis as any).__MC_EARNINGS_STORE__ = new Map<string, StoredEarnings>();
  }
  return (globalThis as any).__MC_EARNINGS_STORE__;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const KV_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours in Redis (slightly longer than memory TTL)

function isDataFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < CACHE_TTL_MS;
}

/** KV key for earnings cache */
function earningsKvKey(symbol: string): string {
  return `earnings:${symbol}`;
}

/** Try to load earnings data from KV store (Redis) */
async function kvLoadEarnings(symbol: string): Promise<StoredEarnings | null> {
  try {
    const data = await kvGet<StoredEarnings>(earningsKvKey(symbol));
    if (data && data.symbol && data.quarters && data.quarters.length > 0) {
      return data;
    }
  } catch (e) {
    console.warn(`[Earnings Cache] KV load failed for ${symbol}:`, e);
  }
  return null;
}

/** Save earnings data to KV store (Redis) + in-memory */
async function kvSaveEarnings(symbol: string, data: StoredEarnings): Promise<void> {
  // Always save to in-memory
  const store = getGlobalStore();
  store.set(symbol, data);

  // Also persist to KV (Redis) with TTL
  try {
    await kvSet(earningsKvKey(symbol), data, KV_CACHE_TTL_SECONDS);
  } catch (e) {
    console.warn(`[Earnings Cache] KV save failed for ${symbol}:`, e);
  }
}

// ── Types ────────────────────────────────────

interface QuarterColumn {
  label: string;   // "Dec 2025", "Sep 2025", etc.
  index: number;
}

interface QuarterFinancials {
  period: string;        // "Dec 2025"
  revenue: number;       // Sales in Cr
  operatingProfit: number;
  opm: number;           // Operating Profit Margin %
  pat: number;           // Net Profit
  npm: number;           // Net Profit Margin %
  eps: number;
  nii?: number;          // Net Interest Income (for banking stocks)
}

interface ScreenerData {
  symbol: string;
  companyName: string;
  consolidated: QuarterFinancials[];
  standalone: QuarterFinancials[];
  mcap: number | null;
  pe: number | null;
  currentPrice: number | null;
  bookValue: number | null;
  sector: string;
  isBanking: boolean;
}

interface EarningsScanCard {
  symbol: string;
  company: string;
  period: string;         // Latest quarter label e.g. "Dec 2025"
  resultDate: string;     // Approximate
  reportType: 'Consolidated' | 'Standalone';

  // Financial table (last 3 quarters)
  quarters: QuarterFinancials[];

  // YoY and QoQ for latest quarter
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;

  // Composite score
  fundamentalsScore: number;
  priceScore: number;
  totalScore: number;
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  dataQuality: 'FULL' | 'PARTIAL' | 'PRICE_ONLY';
  dataAge: 'fresh' | 'stale' | 'missing';

  // Valuation
  mcap: number | null;
  pe: number | null;
  cmp: number | null;

  // Banking flag
  isBanking: boolean;

  // Links
  screenerUrl: string;
  nseUrl: string;
}

// ── Data Validation ─────────────────────────

function validateQuarterlyData(quarters: QuarterFinancials[], symbol: string): { valid: boolean; reason?: string } {
  if (!quarters || quarters.length < 2) {
    return { valid: false, reason: `${symbol}: Less than 2 quarters of data` };
  }

  const hasPositiveRevenue = quarters.some(q => q.revenue > 0);
  if (!hasPositiveRevenue) {
    return { valid: false, reason: `${symbol}: No positive revenue found` };
  }

  // Check for unreasonable spikes (single quarter revenue > 10x previous)
  for (let i = 1; i < quarters.length; i++) {
    const current = quarters[i].revenue;
    const previous = quarters[i - 1].revenue;
    if (previous > 0 && current / previous > 10) {
      return { valid: false, reason: `${symbol}: Unreasonable revenue spike detected` };
    }
  }

  return { valid: true };
}

// ── Helper: Fetch NSE Financials ─────────────

async function fetchNSEFinancials(symbol: string): Promise<QuarterFinancials[] | null> {
  try {
    const data = await fetchCompanyFinancialResults(symbol);
    if (!data) return null;

    // NSE financial results API returns filing metadata
    // Try to extract quarterly data from response if available
    // The structure may vary, so be flexible in parsing
    // Return null if no usable quarterly data found
    // Note: NSE API may not have full P&L tables, so this is best-effort

    console.log(`[Earnings Scan] NSE financials for ${symbol}: attempt to parse`);
    // Placeholder: actual parsing depends on NSE API response format
    // For now, return null to fall through to screener.in
    return null;
  } catch (err) {
    console.warn(`[Earnings Scan] NSE financials failed for ${symbol}:`, (err as Error).message);
    return null;
  }
}

// ── Multi-Source Data Fetcher ────────────────

/**
 * Try multiple sources for quarterly financial data.
 * Priority: NSE → screener.in → trendlyne → tickertape
 * Returns raw HTML from whichever source works.
 */
async function fetchFinancialPageHTML(symbol: string, type: 'consolidated' | 'standalone'): Promise<{ html: string; source: string } | null> {
  const screenerSym = getScreenerSymbol(symbol);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Source 1: screener.in (use mapped symbol)
  try {
    const suffix = type === 'consolidated' ? 'consolidated/' : '';
    const url = `https://www.screener.in/company/${screenerSym}/${suffix}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const html = await res.text();
      if (html.includes('Quarterly Results') || html.includes('id="quarters"')) {
        console.log(`[Earnings Scan] ${symbol}: screener.in OK (${type})`);
        return { html, source: 'screener.in' };
      }
    }

    // If 404, try discovering via screener.in search API
    if (res.status === 404 || !res.ok) {
      try {
        const searchUrl = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}&v=3&fts=1`;
        const searchRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (searchRes.ok) {
          const results = await searchRes.json();
          const match = Array.isArray(results) ? results.find((r: any) => r.url && r.name && !r.name.includes('DVR') && r.id) : null;
          if (match?.url) {
            const discoveredSym = match.url.replace('/company/', '').replace('/consolidated/', '').replace('/', '');
            console.log(`[Earnings Scan] ${symbol}: discovered screener symbol = ${discoveredSym}`);
            // Add to map for future use
            SCREENER_SYMBOL_MAP[symbol] = discoveredSym;
            const discoverUrl = `https://www.screener.in${match.url}${match.url.includes('consolidated') ? '' : (suffix || '')}`;
            const discoverRes = await fetch(discoverUrl, { headers, signal: AbortSignal.timeout(10000) });
            if (discoverRes.ok) {
              const discoverHtml = await discoverRes.text();
              if (discoverHtml.includes('Quarterly Results') || discoverHtml.includes('id="quarters"')) {
                console.log(`[Earnings Scan] ${symbol}: screener.in discovered OK (${type})`);
                return { html: discoverHtml, source: 'screener.in' };
              }
            }
          }
        }
      } catch (searchErr) {
        console.warn(`[Earnings Scan] screener.in search fallback failed for ${symbol}:`, (searchErr as Error).message);
      }
    }
  } catch (err) {
    console.warn(`[Earnings Scan] screener.in failed for ${symbol}:`, (err as Error).message);
  }

  // Source 2: trendlyne.com
  try {
    const url = `https://trendlyne.com/fundamentals/quarterly-results/${symbol}/`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const html = await res.text();
      if (html.includes('Sales') || html.includes('Revenue') || html.includes('quarterly')) {
        console.log(`[Earnings Scan] ${symbol}: trendlyne OK`);
        return { html, source: 'trendlyne' };
      }
    }
  } catch (err) {
    console.warn(`[Earnings Scan] trendlyne failed for ${symbol}:`, (err as Error).message);
  }

  // Source 3: tickertape.in
  try {
    const url = `https://www.tickertape.in/stocks/${symbol.toLowerCase()}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const html = await res.text();
      if (html.length > 5000) {
        console.log(`[Earnings Scan] ${symbol}: tickertape OK`);
        return { html, source: 'tickertape' };
      }
    }
  } catch (err) {
    console.warn(`[Earnings Scan] tickertape failed for ${symbol}:`, (err as Error).message);
  }

  return null;
}

/** Legacy wrapper for backward compatibility */
async function fetchScreenerData(symbol: string, type: 'consolidated' | 'standalone'): Promise<string | null> {
  const result = await fetchFinancialPageHTML(symbol, type);
  return result?.html || null;
}

function parseNumber(str: string): number {
  if (!str || str.trim() === '' || str.trim() === '-') return 0;
  // Remove commas, handle negative
  const clean = str.replace(/,/g, '').trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function isBankingStock(html: string): boolean {
  // Detect banking stocks by looking for banking-specific terms
  return html.includes('Financing Profit') ||
         html.includes('Net Interest Income') ||
         html.includes('NII') ||
         html.includes('Financing Margin');
}

function parseQuarterlyResults(html: string): {
  quarters: QuarterFinancials[];
  companyName: string;
  mcap: number | null;
  pe: number | null;
  currentPrice: number | null;
  bookValue: number | null;
  isBanking: boolean;
} {
  const quarters: QuarterFinancials[] = [];
  const isBanking = isBankingStock(html);

  // Extract company name from title
  const titleMatch = html.match(/<title>([^<]+)/);
  const companyName = titleMatch
    ? titleMatch[1].replace(/\s*share price.*$/i, '').replace(/\s*\|.*$/, '').trim()
    : '';

  // Extract key metrics from the top section
  let mcap: number | null = null;
  let pe: number | null = null;
  let currentPrice: number | null = null;
  let bookValue: number | null = null;

  const mcapMatch = html.match(/Market Cap[^₹]*₹\s*([\d,]+(?:\.\d+)?)\s*Cr/i);
  if (mcapMatch) mcap = parseNumber(mcapMatch[1]);

  const peMatch = html.match(/Stock P\/E[^>]*>\s*([\d.]+)/i);
  if (peMatch) pe = parseFloat(peMatch[1]);

  const priceMatch = html.match(/Current Price[^₹]*₹\s*([\d,]+(?:\.\d+)?)/i);
  if (priceMatch) currentPrice = parseNumber(priceMatch[1]);

  const bvMatch = html.match(/Book Value[^₹]*₹\s*([\d,]+(?:\.\d+)?)/i);
  if (bvMatch) bookValue = parseNumber(bvMatch[1]);

  // Find the quarterly results section
  // Pattern: "Quarterly Results" followed by table data
  // The quarterly data is in a section with id="quarters"

  // Extract the quarterly results table
  // Look for the table after "Quarterly Results"
  const quartersSection = html.match(/id="quarters"[\s\S]*?<table[\s\S]*?<\/table>/i);
  if (!quartersSection) {
    // Try alternative: look for "Quarterly Results" text
    const altSection = html.match(/Quarterly Results[\s\S]*?<table[^>]*class="[^"]*data-table[^"]*"[\s\S]*?<\/table>/i);
    if (!altSection) {
      console.warn('[Earnings Scan] No quarterly results table found');
      return { quarters, companyName, mcap, pe, currentPrice, bookValue, isBanking };
    }
  }

  const tableHtml = quartersSection ? quartersSection[0] : html;

  // Extract column headers (quarter labels)
  // Pattern: <th>Dec 2025</th> or similar
  const headerMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
  const columnLabels: string[] = [];

  if (headerMatch) {
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    while ((thMatch = thRegex.exec(headerMatch[0])) !== null) {
      const label = thMatch[1].replace(/<[^>]+>/g, '').trim();
      if (label && /^[A-Z][a-z]{2}\s+\d{4}$/.test(label)) {
        columnLabels.push(label);
      }
    }
  }

  if (columnLabels.length === 0) {
    // Try parsing from text content directly
    // Look for quarter patterns like "Dec 2025 Sep 2025 Dec 2024"
    const qtrPattern = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/g;
    const textContent = tableHtml.replace(/<[^>]+>/g, ' ');
    const qtrMatches = textContent.match(qtrPattern);
    if (qtrMatches) {
      // Take only the first occurrence of each unique quarter
      const seen = new Set<string>();
      for (const q of qtrMatches) {
        if (!seen.has(q)) {
          columnLabels.push(q);
          seen.add(q);
        }
      }
    }
  }

  console.log(`[Earnings Scan] Found ${columnLabels.length} quarter columns: ${columnLabels.slice(0, 5).join(', ')}`);

  // Extract row data
  // Rows: Sales, Expenses, Operating Profit, OPM %, Other Income, Interest, Depreciation, PBT, Tax %, Net Profit, EPS
  const rows: Record<string, number[]> = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    if (cells.length < 2) continue;

    const rowLabel = cells[0].replace(/\+/g, '').trim();
    const values = cells.slice(1).map(c => parseNumber(c));

    // Map row labels to our keys
    // Banking companies use: Revenue (not Sales), Net Interest Income / Financing Profit (not Operating Profit),
    // Financing Margin (not OPM), EPS in Rs (not EPS)
    if (rowLabel.match(/^Sales/i) || rowLabel.match(/^Revenue/i)) rows['sales'] = values;
    else if (rowLabel.match(/^Operating Profit/i) || rowLabel.match(/^Financing Profit/i)) rows['operatingProfit'] = values;
    else if (rowLabel.match(/^OPM/i) || rowLabel.match(/^Financing Margin/i) || rowLabel.match(/^Operating Margin/i)) rows['opm'] = values;
    else if (rowLabel.match(/^Net Profit/i) || rowLabel.match(/^Profit after tax/i)) rows['pat'] = values;
    else if (rowLabel.match(/^Net Interest Income/i) || rowLabel.match(/^NII/i)) rows['nii'] = values;
    else if (rowLabel.match(/^EPS/i)) rows['eps'] = values;
  }

  // Build quarter objects (take last N columns matching our headers)
  const numQuarters = Math.min(columnLabels.length, 5); // Last 5 quarters max

  for (let i = 0; i < numQuarters; i++) {
    const colIdx = columnLabels.length - numQuarters + i;
    const dataIdx = (rows['sales']?.length || 0) - numQuarters + i;

    if (dataIdx < 0) continue;

    const revenue = rows['sales']?.[dataIdx] || 0;
    const operatingProfit = rows['operatingProfit']?.[dataIdx] || 0;
    const opmRaw = rows['opm']?.[dataIdx];
    const pat = rows['pat']?.[dataIdx] || 0;
    const eps = rows['eps']?.[dataIdx] || 0;
    const nii = rows['nii']?.[dataIdx] || undefined;

    // Calculate margins
    // For banking stocks: set OPM to NPM (margin = net profit margin)
    let opm: number;
    if (isBanking) {
      opm = revenue > 0 ? parseFloat(((pat / revenue) * 100).toFixed(1)) : 0;
    } else {
      opm = opmRaw || (revenue > 0 ? parseFloat(((operatingProfit / revenue) * 100).toFixed(1)) : 0);
    }
    const npm = revenue > 0 ? parseFloat(((pat / revenue) * 100).toFixed(1)) : 0;

    const quarter: QuarterFinancials = {
      period: columnLabels[colIdx] || `Q${i}`,
      revenue,
      operatingProfit: isBanking ? 0 : operatingProfit,
      opm,
      pat,
      npm,
      eps,
    };

    if (nii !== undefined) {
      quarter.nii = nii;
    }

    quarters.push(quarter);
  }

  // Reverse so latest is first
  quarters.reverse();

  return { quarters, companyName, mcap, pe, currentPrice, bookValue, isBanking };
}

// ── Growth Calculations ─────────────────────

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current > 0) return 999.9; // Cap at 999.9%
    if (current < 0) return -999.9;
    return null;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  // Cap extreme values
  return parseFloat(Math.max(-999.9, Math.min(999.9, pct)).toFixed(1));
}

// ── Scoring Engine ──────────────────────────

// Fundamentals score: 0-100
// Revenue YoY: 30%, PAT YoY: 30%, EPS YoY: 20%, Margin trend: 20%
// For banking stocks: use revenue growth + PAT growth + EPS growth only (skip OPM metrics)
function computeFundamentalsScore(card: {
  revenueYoY: number | null;
  patYoY: number | null;
  epsYoY: number | null;
  opmCurrent: number;
  opmPrevYear: number;
  isBanking?: boolean;
}): number {
  let score = 50; // neutral base

  // Revenue YoY (weight: 30%)
  if (card.revenueYoY !== null) {
    if (card.revenueYoY > 20) score += 15;
    else if (card.revenueYoY > 10) score += 10;
    else if (card.revenueYoY > 0) score += 5;
    else if (card.revenueYoY > -10) score -= 5;
    else score -= 15;
  }

  // PAT YoY (weight: 30%)
  if (card.patYoY !== null) {
    if (card.patYoY > 25) score += 15;
    else if (card.patYoY > 10) score += 10;
    else if (card.patYoY > 0) score += 5;
    else if (card.patYoY > -15) score -= 5;
    else score -= 15;
  }

  // EPS YoY (weight: 20%)
  if (card.epsYoY !== null) {
    if (card.epsYoY > 25) score += 10;
    else if (card.epsYoY > 10) score += 7;
    else if (card.epsYoY > 0) score += 3;
    else score -= 10;
  }

  // Margin trend (weight: 20%) — skip for banking stocks
  if (!card.isBanking) {
    const marginDelta = card.opmCurrent - card.opmPrevYear;
    if (marginDelta > 2) score += 10;    // >200bps expansion
    else if (marginDelta > 0) score += 5; // mild expansion
    else if (marginDelta > -2) score -= 3; // mild contraction
    else score -= 10;                       // >200bps contraction
  }

  return Math.max(0, Math.min(100, score));
}

// Price score: 0-100 (based on recent price performance)
function computePriceScore(pct: number): number {
  if (pct > 5) return 85;
  if (pct > 2) return 70;
  if (pct > 0) return 60;
  if (pct > -2) return 50;
  if (pct > -5) return 35;
  return 20;
}

function gradeFromScore(score: number): { grade: EarningsScanCard['grade']; color: string } {
  if (score >= 75) return { grade: 'STRONG', color: '#00C853' };
  if (score >= 60) return { grade: 'GOOD', color: '#4CAF50' };
  if (score >= 40) return { grade: 'OK', color: '#FFD600' };
  return { grade: 'BAD', color: '#F44336' };
}

// ── Fetch & Build Card for a Symbol ─────────

async function buildEarningsCard(symbol: string): Promise<EarningsScanCard | null> {
  const store = getGlobalStore();
  let dataAge: 'fresh' | 'stale' | 'missing' = 'missing';

  // Step 0: Check in-memory store first (fastest)
  let stored = store.get(symbol) || null;
  if (stored && isDataFresh(stored.fetchedAt)) {
    console.log(`[Earnings Scan] ${symbol}: Using fresh in-memory cache (${Math.round((Date.now() - stored.fetchedAt) / 60000)}min old)`);
    dataAge = 'fresh';
    const card = buildCardFromStoredData(stored);
    if (card) {
      card.dataAge = dataAge;
      return card;
    }
  }

  // Step 0.5: Check KV store (Redis) — survives cold starts
  if (!stored || !isDataFresh(stored?.fetchedAt || 0)) {
    const kvData = await kvLoadEarnings(symbol);
    if (kvData && isDataFresh(kvData.fetchedAt)) {
      console.log(`[Earnings Scan] ${symbol}: Using fresh KV cache (${Math.round((Date.now() - kvData.fetchedAt) / 60000)}min old)`);
      // Hydrate in-memory store from KV
      store.set(symbol, kvData);
      stored = kvData;
      dataAge = 'fresh';
      const card = buildCardFromStoredData(kvData);
      if (card) {
        card.dataAge = dataAge;
        return card;
      }
    } else if (kvData) {
      // KV has stale data — keep as fallback
      stored = kvData;
      store.set(symbol, kvData);
    }
  }

  // Step 2: Try NSE financial results API
  console.log(`[Earnings Scan] Fetching ${symbol}: trying NSE`);
  let nseQuarters = await fetchNSEFinancials(symbol);
  if (nseQuarters && nseQuarters.length > 0) {
    const validation = validateQuarterlyData(nseQuarters, symbol);
    if (validation.valid) {
      console.log(`[Earnings Scan] ${symbol}: NSE data valid, storing`);
      const storedData: StoredEarnings = {
        symbol,
        quarters: nseQuarters,
        companyName: symbol,
        mcap: null,
        pe: null,
        currentPrice: null,
        sector: '',
        isBanking: false,
        source: 'nse',
        fetchedAt: Date.now(),
        validatedAt: Date.now(),
      };
      await kvSaveEarnings(symbol, storedData);
      const card = buildCardFromStoredData(storedData);
      if (card) {
        card.dataAge = 'fresh';
        return card;
      }
    }
  }

  // Step 3: Fallback to screener.in scraping
  console.log(`[Earnings Scan] Fetching ${symbol}: trying screener.in`);

  let html = await fetchScreenerData(symbol, 'consolidated');
  let reportType: 'Consolidated' | 'Standalone' = 'Consolidated';

  if (!html) {
    html = await fetchScreenerData(symbol, 'standalone');
    reportType = 'Standalone';
  }

  if (!html) {
    // Step 5: Circuit breaker — return stale cached data if available
    if (stored) {
      console.warn(`[Earnings Scan] ${symbol}: No fresh data, using stale cache (${Math.round((Date.now() - stored.fetchedAt) / 60000)}min old)`);
      dataAge = 'stale';
      const card = buildCardFromStoredData(stored);
      if (card) {
        card.dataAge = dataAge;
        return card;
      }
    }
    console.warn(`[Earnings Scan] No data for ${symbol}`);
    return null;
  }

  const parsed = parseQuarterlyResults(html);

  if (parsed.quarters.length === 0) {
    // Step 5: Circuit breaker — return stale cached data if available
    if (stored) {
      console.warn(`[Earnings Scan] ${symbol}: No quarters parsed, using stale cache`);
      dataAge = 'stale';
      const card = buildCardFromStoredData(stored);
      if (card) {
        card.dataAge = dataAge;
        return card;
      }
    }
    console.warn(`[Earnings Scan] No quarterly data parsed for ${symbol}`);
    return null;
  }

  // Step 4: Validate parsed data
  const validation = validateQuarterlyData(parsed.quarters, symbol);
  if (!validation.valid) {
    console.warn(`[Earnings Scan] Data validation failed: ${validation.reason}`);
    // Still try to use it with a warning, but mark as stale if available
    if (stored) {
      console.warn(`[Earnings Scan] ${symbol}: Validation failed, using stale cache`);
      dataAge = 'stale';
      const card = buildCardFromStoredData(stored);
      if (card) {
        card.dataAge = dataAge;
        return card;
      }
    }
  }

  // Store in persistent cache (KV + in-memory)
  const storedData: StoredEarnings = {
    symbol,
    quarters: parsed.quarters,
    companyName: parsed.companyName || symbol,
    mcap: parsed.mcap,
    pe: parsed.pe,
    currentPrice: parsed.currentPrice,
    sector: '',
    isBanking: parsed.isBanking,
    source: 'screener.in',
    fetchedAt: Date.now(),
    validatedAt: Date.now(),
  };
  await kvSaveEarnings(symbol, storedData);

  dataAge = 'fresh';
  return buildCardFromStoredData(storedData);
}

function buildCardFromStoredData(data: StoredEarnings): EarningsScanCard | null {
  return buildCardFromData({
    symbol: data.symbol,
    companyName: data.companyName,
    consolidated: data.quarters,
    standalone: [],
    mcap: data.mcap,
    pe: data.pe,
    currentPrice: data.currentPrice,
    bookValue: null,
    sector: data.sector,
    isBanking: data.isBanking,
  });
}

function buildCardFromData(data: ScreenerData): EarningsScanCard | null {
  // Use consolidated if available, else standalone
  const quarters = data.consolidated.length > 0 ? data.consolidated : data.standalone;
  const reportType: 'Consolidated' | 'Standalone' = data.consolidated.length > 0 ? 'Consolidated' : 'Standalone';

  if (quarters.length === 0) return null;

  const latest = quarters[0]; // Most recent quarter
  const prevQ = quarters[1] || null;

  // Find year-ago quarter (same quarter name, previous year)
  const latestMonth = latest.period.split(' ')[0]; // "Dec"
  const latestYear = parseInt(latest.period.split(' ')[1]); // 2025
  const yoyQ = quarters.find(q => {
    const m = q.period.split(' ')[0];
    const y = parseInt(q.period.split(' ')[1]);
    return m === latestMonth && y === latestYear - 1;
  }) || null;

  // Compute YoY and QoQ
  const revenueYoY = yoyQ ? pctChange(latest.revenue, yoyQ.revenue) : null;
  const revenueQoQ = prevQ ? pctChange(latest.revenue, prevQ.revenue) : null;
  const opProfitYoY = yoyQ ? pctChange(latest.operatingProfit, yoyQ.operatingProfit) : null;
  const opProfitQoQ = prevQ ? pctChange(latest.operatingProfit, prevQ.operatingProfit) : null;
  const patYoY = yoyQ ? pctChange(latest.pat, yoyQ.pat) : null;
  const patQoQ = prevQ ? pctChange(latest.pat, prevQ.pat) : null;
  const epsYoY = yoyQ ? pctChange(latest.eps, yoyQ.eps) : null;
  const epsQoQ = prevQ ? pctChange(latest.eps, prevQ.eps) : null;

  // Data quality
  const hasRevenue = latest.revenue > 0;
  const hasPAT = latest.pat !== 0;
  const hasEPS = latest.eps !== 0;
  const dataQuality: EarningsScanCard['dataQuality'] =
    (hasRevenue && hasPAT && hasEPS) ? 'FULL' :
    (hasRevenue || hasPAT) ? 'PARTIAL' : 'PRICE_ONLY';

  // Scoring
  const fundamentalsScore = computeFundamentalsScore({
    revenueYoY, patYoY, epsYoY,
    opmCurrent: latest.opm,
    opmPrevYear: yoyQ?.opm || latest.opm,
    isBanking: data.isBanking,
  });

  // Price score: use a neutral 50 since we don't have intraday price data here
  const priceScore = 50;

  // Composite: 60% fundamentals + 40% price
  const totalScore = dataQuality !== 'PRICE_ONLY'
    ? Math.round(0.6 * fundamentalsScore + 0.4 * priceScore)
    : priceScore;

  const { grade, color: gradeColor } = gradeFromScore(totalScore);

  // Take last 3 quarters for display + year-ago quarter
  const displayQuarters = quarters.slice(0, 3);
  if (yoyQ && !displayQuarters.find(q => q.period === yoyQ.period)) {
    displayQuarters.push(yoyQ); // Add year-ago if not already in display
  }

  return {
    symbol: data.symbol,
    company: data.companyName,
    period: latest.period,
    resultDate: `${latest.period.split(' ')[0]} ${latest.period.split(' ')[1]}`,
    reportType,
    quarters: displayQuarters,
    revenueYoY, revenueQoQ,
    opProfitYoY, opProfitQoQ,
    patYoY, patQoQ,
    epsYoY, epsQoQ,
    fundamentalsScore,
    priceScore,
    totalScore,
    grade, gradeColor,
    dataQuality,
    dataAge: 'fresh', // Will be overridden by caller
    mcap: data.mcap,
    pe: data.pe,
    cmp: data.currentPrice,
    isBanking: data.isBanking || false,
    screenerUrl: `https://www.screener.in/company/${data.symbol}/consolidated/`,
    nseUrl: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(data.symbol)}`,
  };
}

// ══════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols');
  const watchlistOnly = searchParams.get('watchlist') === 'true';
  const debug = searchParams.get('debug') === 'true';

  try {
    // Determine which symbols to scan
    let symbols: string[];

    if (symbolsParam) {
      symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else if (watchlistOnly) {
      // Use default watchlist
      symbols = DEFAULT_WATCHLIST;
    } else {
      symbols = DEFAULT_WATCHLIST;
    }

    // Cap at 20 symbols to stay within Vercel timeout
    symbols = symbols.slice(0, 20);

    console.log(`[Earnings Scan] Scanning ${symbols.length} symbols: ${symbols.join(', ')}`);

    // Fetch in batches of 5 with 500ms delay between batches to avoid rate-limiting
    const cards: EarningsScanCard[] = [];
    const failed: string[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(sym => buildEarningsCard(sym).catch((err) => {
          console.warn(`[Earnings Scan] ${sym} failed:`, err);
          return null;
        }))
      );

      for (let j = 0; j < batch.length; j++) {
        if (batchResults[j]) {
          cards.push(batchResults[j]!);
        } else {
          failed.push(batch[j]);
        }
      }

      // Delay between batches to avoid screener.in rate-limiting
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Retry failed symbols one at a time with higher timeout
    if (failed.length > 0) {
      console.log(`[Earnings Scan] Retrying ${failed.length} failed symbols: ${failed.join(', ')}`);
      const retryFailed: string[] = [];
      for (const sym of failed) {
        await new Promise(r => setTimeout(r, 300));
        try {
          const card = await buildEarningsCard(sym);
          if (card) {
            cards.push(card);
          } else {
            retryFailed.push(sym);
          }
        } catch {
          retryFailed.push(sym);
        }
      }
      failed.length = 0;
      failed.push(...retryFailed);
    }

    // Sort by totalScore descending
    cards.sort((a, b) => b.totalScore - a.totalScore);

    const summary = {
      total: cards.length,
      strong: cards.filter(c => c.grade === 'STRONG').length,
      good: cards.filter(c => c.grade === 'GOOD').length,
      ok: cards.filter(c => c.grade === 'OK').length,
      bad: cards.filter(c => c.grade === 'BAD').length,
      avgScore: cards.length > 0
        ? parseFloat((cards.reduce((s, c) => s + c.totalScore, 0) / cards.length).toFixed(1))
        : 0,
      dataQualityBreakdown: {
        full: cards.filter(c => c.dataQuality === 'FULL').length,
        partial: cards.filter(c => c.dataQuality === 'PARTIAL').length,
        priceOnly: cards.filter(c => c.dataQuality === 'PRICE_ONLY').length,
      },
      dataAgeBreakdown: {
        fresh: cards.filter(c => c.dataAge === 'fresh').length,
        stale: cards.filter(c => c.dataAge === 'stale').length,
        missing: cards.filter(c => c.dataAge === 'missing').length,
      },
    };

    console.log(`[Earnings Scan] ${cards.length} cards built, ${failed.length} failed`);

    return NextResponse.json({
      cards,
      summary,
      source: 'nse + screener.in + cache',
      cacheBackend: isRedisAvailable() ? 'redis' : 'memory',
      updatedAt: new Date().toISOString(),
      ...(debug ? { debug: true, requestedSymbols: symbols, failed } : {}),
    });

  } catch (error) {
    console.error('[Earnings Scan] Error:', error);
    return NextResponse.json({
      cards: [],
      summary: { total: 0, strong: 0, good: 0, ok: 0, bad: 0, avgScore: 0, dataQualityBreakdown: { full: 0, partial: 0, priceOnly: 0 }, dataAgeBreakdown: { fresh: 0, stale: 0, missing: 0 } },
      error: String(error),
    }, { status: 500 });
  }
}
