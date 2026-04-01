import { NextResponse } from 'next/server';
import { fetchCompanyFinancialResults, fetchStockQuote } from '@/lib/nse';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { resolveScreenerSymbol as masterResolveScreenerSymbol } from '@/lib/symbolMaster';

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
  // Ampersand / special char tickers → screener.in names
  'M&M': 'MM',
  'M&MFIN': 'MMFIN',
  'L&TFH': 'LTFH',
  'L&T': 'LT',
  'S&SPOWER': 'SSPOWER',
  // Hyphenated tickers
  'BAJAJ-AUTO': 'BAJAJAUTO',
  // Known mismatches between NSE and Screener
  'TATAMOTORS': 'TATAMOTORS',
  'HDFCBANK': 'HDFCBANK',
  'ICICIBANK': 'ICICIBANK',
  'SBIN': 'SBIN',
  'RELIANCE': 'RELIANCE',
  'TCS': 'TCS',
  'INFY': 'INFY',
  'HINDUNILVR': 'HINDUNILVR',
  'ITC': 'ITC',
  'KOTAKBANK': 'KOTAKBANK',
  'AXISBANK': 'AXISBANK',
  'MARUTI': 'MARUTI',
  'SUNPHARMA': 'SUNPHARMA',
  'TITAN': 'TITAN',
  'ASIANPAINT': 'ASIANPAINT',
  'WIPRO': 'WIPRO',
  'HCLTECH': 'HCLTECH',
  'ADANIENT': 'ADANIENT',
  'ADANIPORTS': 'ADANIPORTS',
  'ULTRACEMCO': 'ULTRACEMCO',
  'JSWSTEEL': 'JSWSTEEL',
  'TATASTEEL': 'TATASTEEL',
  'POWERGRID': 'POWERGRID',
  'NTPC': 'NTPC',
  'ONGC': 'ONGC',
  'COALINDIA': 'COALINDIA',
  'BAJFINANCE': 'BAJFINANCE',
  'BAJAJFINSV': 'BAJAJFINSV',
  'DRREDDY': 'DRREDDY',
  'CIPLA': 'CIPLA',
  'DIVISLAB': 'DIVISLAB',
  'BHARTIARTL': 'BHARTIARTL',
  'TECHM': 'TECHM',
  'NESTLEIND': 'NESTLEIND',
  'BRITANNIA': 'BRITANNIA',
  'HEROMOTOCO': 'HEROMOTOCO',
  'EICHERMOT': 'EICHERMOT',
  'INDUSINDBK': 'INDUSINDBK',
  'SBILIFE': 'SBILIFE',
  'HDFCLIFE': 'HDFCLIFE',
  'GRASIM': 'GRASIM',
  'TATACONSUM': 'TATACONSUM',
  'APOLLOHOSP': 'APOLLOHOSP',
  'LTIM': 'LTIM',
  'VEDL': 'VEDL',
  'HAL': 'HAL',
  'BEL': 'BEL',
  'BHEL': 'BHEL',
  'IRCTC': 'IRCTC',
  'ZOMATO': 'ZOMATO',
  'PAYTM': 'ONEPAYTM',
  'DMART': 'DMART',
  'TRENT': 'TRENT',
  // BSE numeric codes → screener.in names
  '532067': 'BLACKBIO',
};

/** Get screener.in symbol for a given NSE symbol — delegates to SymbolMaster, falls back to local map */
function getScreenerSymbol(nseSymbol: string): string {
  // Use the master resolver first (handles all known overrides)
  const masterResult = masterResolveScreenerSymbol(nseSymbol);
  if (masterResult !== nseSymbol) return masterResult;
  // Fall back to local map (for identity mappings and route-specific overrides)
  return SCREENER_SYMBOL_MAP[nseSymbol] || nseSymbol;
}

// ── Global Data Persistence Store ───────────────

interface GuidanceData {
  guidance: 'Positive' | 'Neutral' | 'Negative';
  sentimentScore: number;        // -1 to +1
  revenueOutlook: 'Up' | 'Flat' | 'Down' | 'Unknown';
  marginOutlook: 'Expanding' | 'Stable' | 'Contracting' | 'Unknown';
  capexSignal: 'Expanding' | 'Stable' | 'Reducing' | 'Unknown';
  demandSignal: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
  keyPhrasesPositive: string[];
  keyPhrasesNegative: string[];
  prosText: string;              // Raw Pros section text
  consText: string;              // Raw Cons section text
  divergence: 'StrongEarnings_WeakGuidance' | 'WeakEarnings_StrongGuidance' | 'None';
}

interface StoredEarnings {
  symbol: string;
  quarters: QuarterFinancials[];
  companyName: string;
  mcap: number | null;
  pe: number | null;
  currentPrice: number | null;
  sector: string;
  isBanking: boolean; // Flag for banking/NBFC companies
  source: 'nse' | 'screener.in' | 'trendlyne' | 'moneycontrol';
  sourceConfidence: number;      // 0-100 confidence in data quality
  dataStatus: 'FULL' | 'PARTIAL' | 'ESTIMATED' | 'MISSING';
  failureReasons?: string[];     // Why other sources failed
  fetchedAt: number;
  validatedAt: number;
  guidance?: GuidanceData;       // Forward-looking sentiment from screener.in Pros/Cons
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

// ══════════════════════════════════════════════
// FETCH RESILIENCE HELPERS
// ══════════════════════════════════════════════

/**
 * Wraps a fetch call with a timeout and optional retry logic
 * @param fn - async function that returns a Promise
 * @param timeoutMs - abort timeout in milliseconds (default: 6000)
 * @param retries - number of retries on failure (default: 1)
 * @returns the result of the function, or null if all attempts fail
 */
async function fetchWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = 6000,
  retries: number = 1
): Promise<T | null> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fn(controller.signal);
        clearTimeout(timeoutId);
        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 200)); // brief delay before retry
      }
    }
  }
  console.warn(`[Fetch Timeout] Failed after ${retries + 1} attempts:`, lastError?.message);
  return null;
}

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
  grade: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  dataQuality: 'FULL' | 'PARTIAL' | 'PRICE_ONLY';
  dataAge: 'fresh' | 'stale' | 'missing';

  // Valuation
  mcap: number | null;
  pe: number | null;
  cmp: number | null;

  // Banking flag
  isBanking: boolean;

  // Guidance & Sentiment (forward-looking)
  guidance?: 'Positive' | 'Neutral' | 'Negative';
  sentimentScore?: number;        // -1 to +1
  revenueOutlook?: 'Up' | 'Flat' | 'Down' | 'Unknown';
  marginOutlook?: 'Expanding' | 'Stable' | 'Contracting' | 'Unknown';
  capexSignal?: 'Expanding' | 'Stable' | 'Reducing' | 'Unknown';
  demandSignal?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
  keyPhrasesPositive?: string[];
  keyPhrasesNegative?: string[];
  divergence?: 'StrongEarnings_WeakGuidance' | 'WeakEarnings_StrongGuidance' | 'None';

  // Source attribution
  source: 'nse' | 'screener.in' | 'trendlyne' | 'moneycontrol' | 'none';
  sourceConfidence: number;      // 0-100
  dataStatus: 'FULL' | 'PARTIAL' | 'ESTIMATED' | 'MISSING';
  failureReasons?: string[];

  // Links
  screenerUrl: string;
  nseUrl: string;
}

// ── Data Validation ─────────────────────────

function validateQuarterlyData(quarters: QuarterFinancials[], symbol: string): { valid: boolean; reason?: string } {
  if (!quarters || quarters.length === 0) {
    return { valid: false, reason: `${symbol}: No quarters of data` };
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

// ── Symbol Resolution Engine ──────────────────
// Resolves NSE symbols to symbols used by other sources (screener.in, moneycontrol)
// Uses fuzzy matching + search API + cached resolved mappings

const SYMBOL_RESOLUTION_CACHE = new Map<string, { screener: string; mcSlug: string; resolved: number }>();

/** Normalize symbol for matching: remove special chars, lowercase */
function normalizeSymbol(s: string): string {
  return s.replace(/[&\-_.\s]/g, '').toLowerCase();
}

/** Fuzzy match: checks if normalized versions are similar enough */
function fuzzyMatch(a: string, b: string): boolean {
  const na = normalizeSymbol(a);
  const nb = normalizeSymbol(b);
  if (na === nb) return true;
  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return true;
  // Levenshtein distance <= 2 for short symbols
  if (na.length <= 8 && nb.length <= 8) {
    let dist = 0;
    const longer = na.length >= nb.length ? na : nb;
    const shorter = na.length >= nb.length ? nb : na;
    for (let i = 0; i < longer.length; i++) {
      if (shorter[i] !== longer[i]) dist++;
    }
    return dist <= 2;
  }
  return false;
}

/** Resolve screener.in symbol via search API (cached) */
async function resolveScreenerSymbol(nseSymbol: string): Promise<string | null> {
  const cached = SYMBOL_RESOLUTION_CACHE.get(nseSymbol);
  if (cached && Date.now() - cached.resolved < 24 * 60 * 60 * 1000) {
    return cached.screener || null;
  }

  // Check master resolver first (single source of truth)
  const masterResult = masterResolveScreenerSymbol(nseSymbol);
  if (masterResult !== nseSymbol) return masterResult;

  // Check local static map
  if (SCREENER_SYMBOL_MAP[nseSymbol]) {
    return SCREENER_SYMBOL_MAP[nseSymbol];
  }

  // Try screener.in search API
  try {
    const searchUrl = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(nseSymbol)}&v=3&fts=1`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const results = await res.json();
      if (Array.isArray(results) && results.length > 0) {
        // Find best match: exact NSE symbol match first, then fuzzy
        const exact = results.find((r: any) => r.url && normalizeSymbol(r.url.replace('/company/', '').replace('/consolidated/', '').replace('/', '')) === normalizeSymbol(nseSymbol));
        const fuzzy = results.find((r: any) => r.url && fuzzyMatch(r.url.replace('/company/', '').replace('/consolidated/', '').replace('/', ''), nseSymbol));
        const match = exact || fuzzy || results[0];
        if (match?.url) {
          const resolved = match.url.replace('/company/', '').replace('/consolidated/', '').replace('/', '');
          // Cache the resolution
          const existing = SYMBOL_RESOLUTION_CACHE.get(nseSymbol) || { screener: '', mcSlug: '', resolved: 0 };
          existing.screener = resolved;
          existing.resolved = Date.now();
          SYMBOL_RESOLUTION_CACHE.set(nseSymbol, existing);
          SCREENER_SYMBOL_MAP[nseSymbol] = resolved;
          console.log(`[Symbol Resolve] ${nseSymbol} → screener:${resolved}`);
          return resolved;
        }
      }
    }
  } catch (e) {
    console.warn(`[Symbol Resolve] screener search failed for ${nseSymbol}:`, (e as Error).message);
  }
  return null;
}

// ── Source Confidence Scores ─────────────────
// Moneycontrol = primary (structured quarterly P&L)
// Screener = secondary (HTML scraping + guidance + metadata)
// NSE = metadata only (filing dates, not reliable P&L)
const SOURCE_CONFIDENCE: Record<string, number> = {
  'moneycontrol': 90,
  'screener.in': 82,
  'nse': 60,          // Low — NSE returns filing metadata, NOT structured P&L
  'trendlyne': 70,
  'none': 0,
};

// ── Helper: Fetch NSE Financials (REAL PARSER) ──

async function fetchNSEFinancials(symbol: string): Promise<{ quarters: QuarterFinancials[]; companyName: string; isBanking: boolean } | null> {
  try {
    const data = await fetchCompanyFinancialResults(symbol);
    if (!data) return null;

    // NSE returns array or object with financial results
    // Possible structures:
    // 1. Array of result objects directly
    // 2. { data: [...] } wrapper
    // 3. { results: [...] } wrapper
    const results = Array.isArray(data) ? data : (data?.data || data?.results || data?.content || []);
    if (!Array.isArray(results) || results.length === 0) {
      console.log(`[NSE Parser] ${symbol}: No results array in response (keys: ${Object.keys(data || {}).join(',')})`);
      // Try to parse single-object response
      if (data && typeof data === 'object' && (data.re_sales || data.re_revenue || data.SAL || data.sales)) {
        return parseNSESingleResult(data, symbol);
      }
      return null;
    }

    console.log(`[NSE Parser] ${symbol}: Got ${results.length} results, first keys: ${Object.keys(results[0] || {}).slice(0, 10).join(',')}`);

    // Parse quarterly results from NSE format
    // NSE fields vary, but commonly include:
    // re_symbol, re_companyName, re_broadCast, re_xbrl, re_ind_auditedUnAudited
    // Financial fields may be in: SAL/re_sales, OPR/re_operatingProfit, NET/re_netProfit, EPS/re_eps
    // Or in nested xbrl object with standardized field names
    const quarters: QuarterFinancials[] = [];
    let companyName = symbol;
    let isBanking = false;

    for (const row of results.slice(0, 8)) { // Last 8 quarters max
      // Detect company name
      if (row.re_companyName || row.companyName || row.company) {
        companyName = row.re_companyName || row.companyName || row.company;
      }

      // Detect banking
      if (row.re_ind || row.industry || row.sector) {
        const ind = (row.re_ind || row.industry || row.sector || '').toLowerCase();
        if (ind.includes('bank') || ind.includes('financ') || ind.includes('nbfc') || ind.includes('insurance')) {
          isBanking = true;
        }
      }

      // Extract period
      let period = '';
      if (row.re_broadCast || row.broadcastDate || row.resultDate) {
        const dateStr = row.re_broadCast || row.broadcastDate || row.resultDate || '';
        period = extractPeriodFromDate(dateStr);
      }
      if (!period && (row.re_toDate || row.toDate || row.period)) {
        period = extractPeriodFromDate(row.re_toDate || row.toDate || row.period || '');
      }
      if (!period && row.quarterEnded) {
        period = extractPeriodFromDate(row.quarterEnded);
      }

      if (!period) continue;

      // Extract financials — try multiple field name patterns
      const revenue = pickNumber(row, ['re_sales', 'SAL', 'sales', 'revenue', 'totalIncome', 'total_income', 'incomeFromOperations']);
      const operatingProfit = pickNumber(row, ['re_operatingProfit', 'OPR', 'operatingProfit', 'pbit', 'ebit']);
      const pat = pickNumber(row, ['re_netProfit', 'NET', 'netProfit', 'pat', 'profitAfterTax', 'net_profit']);
      const eps = pickNumber(row, ['re_eps', 'EPS', 'eps', 'earningsPerShare', 'dilutedEPS', 'basicEPS']);

      // Skip if no meaningful data
      if (revenue === 0 && pat === 0 && eps === 0) continue;

      const opm = revenue > 0 ? parseFloat(((operatingProfit / revenue) * 100).toFixed(1)) : 0;
      const npm = revenue > 0 ? parseFloat(((pat / revenue) * 100).toFixed(1)) : 0;

      quarters.push({ period, revenue, operatingProfit, opm, pat, npm, eps });
    }

    if (quarters.length === 0) {
      console.log(`[NSE Parser] ${symbol}: No quarters could be parsed`);
      return null;
    }

    // Sort by period (latest first) — parse "Mon YYYY" to comparable value
    quarters.sort((a, b) => periodToNum(b.period) - periodToNum(a.period));

    // Deduplicate same periods (keep first = latest filing)
    const seen = new Set<string>();
    const deduped = quarters.filter(q => {
      if (seen.has(q.period)) return false;
      seen.add(q.period);
      return true;
    });

    console.log(`[NSE Parser] ${symbol}: Parsed ${deduped.length} quarters: ${deduped.map(q => q.period).join(', ')}`);
    return { quarters: deduped, companyName, isBanking };
  } catch (err) {
    console.warn(`[NSE Parser] ${symbol} failed:`, (err as Error).message);
    return null;
  }
}

/** Parse a single NSE result object (non-array response) */
function parseNSESingleResult(data: any, symbol: string): { quarters: QuarterFinancials[]; companyName: string; isBanking: boolean } | null {
  const revenue = pickNumber(data, ['re_sales', 'SAL', 'sales', 'revenue']);
  const pat = pickNumber(data, ['re_netProfit', 'NET', 'netProfit', 'pat']);
  const eps = pickNumber(data, ['re_eps', 'EPS', 'eps']);
  if (revenue === 0 && pat === 0) return null;
  const operatingProfit = pickNumber(data, ['re_operatingProfit', 'OPR', 'operatingProfit']);
  const opm = revenue > 0 ? parseFloat(((operatingProfit / revenue) * 100).toFixed(1)) : 0;
  const npm = revenue > 0 ? parseFloat(((pat / revenue) * 100).toFixed(1)) : 0;
  const period = extractPeriodFromDate(data.re_toDate || data.toDate || data.period || new Date().toISOString());
  return {
    quarters: [{ period: period || 'Unknown', revenue, operatingProfit, opm, pat, npm, eps }],
    companyName: data.re_companyName || data.companyName || symbol,
    isBanking: false,
  };
}

/** Pick a number from an object trying multiple field names */
function pickNumber(obj: any, fields: string[]): number {
  for (const f of fields) {
    if (obj[f] !== undefined && obj[f] !== null && obj[f] !== '' && obj[f] !== '-') {
      const n = typeof obj[f] === 'number' ? obj[f] : parseFloat(String(obj[f]).replace(/,/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

/** Convert a date string to "Mon YYYY" period label */
function extractPeriodFromDate(dateStr: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Try ISO: 2025-12-31
  let m = dateStr.match(/(\d{4})-(\d{2})/);
  if (m) return `${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
  // Try DD-MM-YYYY or DD-Mon-YYYY
  m = dateStr.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${months[parseInt(m[2], 10) - 1]} ${m[3]}`;
  m = dateStr.match(/(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{4})/);
  if (m) {
    const mi = months.findIndex(mn => mn.toLowerCase() === m![2].toLowerCase());
    if (mi >= 0) return `${months[mi]} ${m[3]}`;
  }
  // Try "31 Dec 2025" or "Dec 31, 2025"
  m = dateStr.match(/([A-Za-z]{3})\w*\s+\d{1,2},?\s+(\d{4})/);
  if (m) {
    const mi = months.findIndex(mn => mn.toLowerCase() === m![1].toLowerCase().slice(0, 3));
    if (mi >= 0) return `${months[mi]} ${m[2]}`;
  }
  m = dateStr.match(/\d{1,2}\s+([A-Za-z]{3})\w*\s+(\d{4})/);
  if (m) {
    const mi = months.findIndex(mn => mn.toLowerCase() === m![1].toLowerCase().slice(0, 3));
    if (mi >= 0) return `${months[mi]} ${m[2]}`;
  }
  return '';
}

/** Convert "Mon YYYY" to sortable number (e.g., "Dec 2025" → 202512) */
function periodToNum(period: string): number {
  const months: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const parts = period.split(' ');
  if (parts.length !== 2) return 0;
  return (parseInt(parts[1]) || 0) * 100 + (months[parts[0]] || 0);
}

// ── Helper: Fetch Moneycontrol Financials ────

/** Moneycontrol symbol mapping cache — maps NSE symbol → MC page slug */
const MC_SLUG_CACHE = new Map<string, string>();

async function resolveMoneycontrolSlug(symbol: string): Promise<string | null> {
  if (MC_SLUG_CACHE.has(symbol)) return MC_SLUG_CACHE.get(symbol)!;

  try {
    // Search Moneycontrol for the company via their search suggest API
    const searchUrl = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${encodeURIComponent(symbol)}&type=1&format=json&callback=`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.moneycontrol.com/',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const text = await res.text();
    // Response might be JSONP or plain JSON
    const jsonStr = text.replace(/^[^[{]*/, '').replace(/[^}\]]*$/, '');
    const data = JSON.parse(jsonStr);

    // Find matching stock (NSE listed)
    const results = Array.isArray(data) ? data : (data?.data || []);
    for (const item of results) {
      const nseCode = item.nse_symbol || item.sc_id || '';
      const link = item.link_src || item.pclassid || '';
      if (normalizeSymbol(nseCode) === normalizeSymbol(symbol) || fuzzyMatch(nseCode, symbol)) {
        const slug = item.sc_id || link;
        if (slug) {
          MC_SLUG_CACHE.set(symbol, slug);
          console.log(`[MC Resolve] ${symbol} → mc:${slug}`);
          return slug;
        }
      }
    }
    // Fallback: use first NSE-listed result (more aggressive matching)
    if (results.length >= 1) {
      const nseResult = results.find((item: any) => {
        const hasNSE = item.nse_symbol || (item.exchange && /nse/i.test(item.exchange));
        return hasNSE && item.sc_id;
      }) || results[0];
      if (nseResult?.sc_id) {
        MC_SLUG_CACHE.set(symbol, nseResult.sc_id);
        console.log(`[MC Resolve] ${symbol} → mc:${nseResult.sc_id} (fallback match)`);
        return nseResult.sc_id;
      }
    }
  } catch (e) {
    console.warn(`[MC Resolve] Failed for ${symbol}:`, (e as Error).message);
  }
  return null;
}

async function fetchMoneycontrolFinancials(symbol: string): Promise<{ quarters: QuarterFinancials[]; companyName: string; isBanking: boolean } | null> {
  try {
    const scId = await resolveMoneycontrolSlug(symbol);
    if (!scId) {
      console.log(`[MC Parser] ${symbol}: Could not resolve MC slug`);
      return null;
    }

    // Fetch quarterly income statement
    const url = `https://www.moneycontrol.com/mc/widget/mcfinancials/getFinancialData?scId=${encodeURIComponent(scId)}&frequency=3&requestType=Q&classic=true&referenceId=income`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.moneycontrol.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.log(`[MC Parser] ${symbol}: HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();
    if (!html || html.length < 100) return null;

    // MC returns HTML table with quarterly data
    // Parse the table rows for: Net Sales, Operating Profit, OPM, PAT, EPS
    return parseMoneycontrolHTML(html, symbol);
  } catch (err) {
    console.warn(`[MC Parser] ${symbol} failed:`, (err as Error).message);
    return null;
  }
}

function parseMoneycontrolHTML(html: string, symbol: string): { quarters: QuarterFinancials[]; companyName: string; isBanking: boolean } | null {
  const quarters: QuarterFinancials[] = [];
  let isBanking = false;

  // Check for banking indicators
  if (/net interest income|NII|interest earned|financing profit/i.test(html)) {
    isBanking = true;
  }

  // Extract column headers (quarter periods)
  // MC format: "Dec 2025", "Sep 2025", etc. in <th> or header cells
  const columnLabels: string[] = [];
  const headerMatch = html.match(/<thead[\s\S]*?<\/thead>/i) || html.match(/<tr[^>]*class="[^"]*head[^"]*"[^>]*>[\s\S]*?<\/tr>/i);
  if (headerMatch) {
    const thRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let thMatch;
    while ((thMatch = thRegex.exec(headerMatch[0])) !== null) {
      const label = thMatch[1].replace(/<[^>]+>/g, '').trim();
      if (/^[A-Z][a-z]{2}\s+\d{4}$/.test(label)) {
        columnLabels.push(label);
      }
    }
  }

  // If no headers found, try to find period patterns in the whole HTML
  if (columnLabels.length === 0) {
    const qtrPattern = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/g;
    const text = html.replace(/<[^>]+>/g, ' ');
    const matches = text.match(qtrPattern);
    if (matches) {
      const seen = new Set<string>();
      for (const q of matches) {
        if (!seen.has(q)) { columnLabels.push(q); seen.add(q); }
      }
    }
  }

  if (columnLabels.length === 0) {
    console.log(`[MC Parser] ${symbol}: No quarter columns found`);
    return null;
  }

  // Extract row data
  const rows: Record<string, number[]> = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length < 2) continue;
    const label = cells[0].replace(/[+\u00a0]/g, '').trim();
    const values = cells.slice(1).map(c => parseNumber(c));

    if (/^(?:Net )?Sales|Revenue|Income from Operations/i.test(label)) rows['sales'] = values;
    else if (/^Operating Profit|EBIT|PBIT|Financing Profit/i.test(label)) rows['operatingProfit'] = values;
    else if (/^OPM|Operating.?Margin|Financing Margin/i.test(label)) rows['opm'] = values;
    else if (/^(?:Net )?Profit|PAT|Profit After Tax/i.test(label)) rows['pat'] = values;
    else if (/^EPS|Earning/i.test(label)) rows['eps'] = values;
    else if (/^Net Interest Income|NII/i.test(label)) rows['nii'] = values;
  }

  // Build quarter objects
  const numQ = Math.min(columnLabels.length, 6);
  for (let i = 0; i < numQ; i++) {
    const revenue = rows['sales']?.[i] || 0;
    const operatingProfit = rows['operatingProfit']?.[i] || 0;
    const pat = rows['pat']?.[i] || 0;
    const eps = rows['eps']?.[i] || 0;
    const opmRaw = rows['opm']?.[i];
    const opm = opmRaw || (revenue > 0 ? parseFloat(((operatingProfit / revenue) * 100).toFixed(1)) : 0);
    const npm = revenue > 0 ? parseFloat(((pat / revenue) * 100).toFixed(1)) : 0;

    if (revenue === 0 && pat === 0 && eps === 0) continue;

    quarters.push({ period: columnLabels[i], revenue, operatingProfit, opm, pat, npm, eps });
  }

  if (quarters.length === 0) return null;

  console.log(`[MC Parser] ${symbol}: Parsed ${quarters.length} quarters: ${quarters.map(q => q.period).join(', ')}`);
  return { quarters, companyName: symbol, isBanking };
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

// ── Guidance & Sentiment Extraction ─────────
// Extracts forward-looking management sentiment from screener.in Pros/Cons sections
// Uses keyword-based scoring model: -1 (very negative) to +1 (very positive)

const POSITIVE_KEYWORDS: [string, number][] = [
  // Revenue/Growth
  ['strong growth', 0.15], ['revenue growth', 0.12], ['order book', 0.12], ['order inflow', 0.12],
  ['strong demand', 0.12], ['growing demand', 0.10], ['market share gain', 0.12], ['market leadership', 0.10],
  ['new orders', 0.10], ['record revenue', 0.15], ['record order', 0.14], ['healthy pipeline', 0.10],
  ['robust growth', 0.14], ['high growth', 0.12], ['double digit growth', 0.14],
  ['volume growth', 0.10], ['improving demand', 0.10], ['strong traction', 0.10],
  // Margin/Profitability
  ['margin expansion', 0.14], ['improving margin', 0.12], ['margin improvement', 0.12],
  ['operating leverage', 0.12], ['cost efficiency', 0.10], ['cost reduction', 0.08],
  ['ebitda margin', 0.06], ['margin recovery', 0.10], ['pricing power', 0.12],
  // Capex/Expansion
  ['capacity expansion', 0.12], ['capex', 0.06], ['new plant', 0.08], ['capacity addition', 0.10],
  ['greenfield', 0.08], ['brownfield', 0.06], ['commissioning', 0.08], ['ramp up', 0.08],
  // Strategic
  ['debt reduction', 0.12], ['debt free', 0.14], ['deleveraging', 0.10], ['cash rich', 0.10],
  ['dividend increase', 0.08], ['promoter buying', 0.08], ['gaining market share', 0.12],
  ['competitive advantage', 0.10], ['strong brand', 0.08], ['export growth', 0.10],
  ['new product', 0.08], ['innovation', 0.06], ['technology leadership', 0.08],
  // Guidance-specific
  ['guided for', 0.10], ['guidance of', 0.10], ['expects growth', 0.12],
  ['positive outlook', 0.14], ['optimistic', 0.10], ['strong pipeline', 0.12],
  ['well positioned', 0.08], ['secular growth', 0.10], ['tailwind', 0.10],
];

const NEGATIVE_KEYWORDS: [string, number][] = [
  // Revenue/Demand
  ['revenue decline', -0.15], ['declining revenue', -0.14], ['weak demand', -0.12],
  ['demand slowdown', -0.12], ['order cancellation', -0.14], ['pricing pressure', -0.12],
  ['market share loss', -0.14], ['loss of market', -0.12], ['muted demand', -0.10],
  ['subdued demand', -0.10], ['volume decline', -0.10], ['top line pressure', -0.10],
  // Margin/Cost
  ['margin compression', -0.14], ['margin contraction', -0.14], ['declining margin', -0.12],
  ['cost pressure', -0.10], ['input cost', -0.08], ['raw material cost', -0.08],
  ['employee cost', -0.06], ['margin erosion', -0.12], ['negative operating leverage', -0.12],
  ['pricing headwind', -0.10],
  // Risk
  ['high debt', -0.14], ['rising debt', -0.12], ['debt concern', -0.12], ['overleveraged', -0.14],
  ['cash burn', -0.14], ['negative cash flow', -0.14], ['working capital issue', -0.10],
  ['contingent liab', -0.10], ['regulatory risk', -0.08], ['compliance issue', -0.08],
  // Guidance-specific
  ['cautious outlook', -0.12], ['challenging environment', -0.10], ['headwind', -0.10],
  ['uncertainty', -0.08], ['downgrade', -0.14], ['negative outlook', -0.14],
  ['guided lower', -0.14], ['muted outlook', -0.12], ['slower growth', -0.10],
  ['pressure on growth', -0.10], ['risk of slowdown', -0.10],
  // Strategic
  ['promoter selling', -0.10], ['promoter pledge', -0.12], ['corporate governance', -0.10],
  ['audit concern', -0.12], ['qualified opinion', -0.14], ['related party', -0.08],
  ['management concern', -0.10], ['key managerial', -0.06],
];

function parseGuidanceSentiment(html: string): GuidanceData | null {
  let prosText = '';
  let consText = '';

  // Screener.in patterns — try multiple approaches
  // Pattern 1: <div class="company-pros"> / <div class="company-cons"> (screener.in specific)
  const companyPros = html.match(/class="[^"]*company-pros[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*company-cons|<\/section|<section)/i);
  const companyCons = html.match(/class="[^"]*company-cons[^"]*"[^>]*>([\s\S]*?)(?=<\/section|<section|<div[^>]*id=)/i);

  // Pattern 2: <section with "Pros" or "Cons" text inside p/h tags
  const sectionPros = html.match(/<(?:p|h\d|div)[^>]*>\s*Pros\s*<\/(?:p|h\d|div)>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i);
  const sectionCons = html.match(/<(?:p|h\d|div)[^>]*>\s*Cons\s*<\/(?:p|h\d|div)>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i);

  // Pattern 3: Any "Pros" text followed by <ul> with <li> items within 200 chars
  const loosePros = html.match(/>\s*Pros\s*<[\s\S]{0,200}?<ul[^>]*>([\s\S]*?)<\/ul>/i);
  const looseCons = html.match(/>\s*Cons\s*<[\s\S]{0,200}?<ul[^>]*>([\s\S]*?)<\/ul>/i);

  // Pattern 4: data attribute based (some versions)
  const dataPros = html.match(/data-section="pros"[^>]*>([\s\S]*?)<\/(?:section|div)>/i);
  const dataCons = html.match(/data-section="cons"[^>]*>([\s\S]*?)<\/(?:section|div)>/i);

  // Pattern 5: Broad — look for "Pros" heading followed by list items until "Cons"
  const broadMatch = html.match(/>\s*Pros\s*<\/[^>]+>([\s\S]*?)(?=>\s*Cons\s*<\/)/i);

  // Extract Pros
  if (companyPros) prosText = companyPros[1];
  else if (sectionPros) prosText = sectionPros[1];
  else if (loosePros) prosText = loosePros[1];
  else if (dataPros) prosText = dataPros[1];
  else if (broadMatch) prosText = broadMatch[1];

  // Extract Cons
  if (companyCons) consText = companyCons[1];
  else if (sectionCons) consText = sectionCons[1];
  else if (looseCons) consText = looseCons[1];
  else if (dataCons) consText = dataCons[1];
  else {
    // Fallback: after "Cons" heading, grab next <ul>...</ul>
    const consFallback = html.match(/>\s*Cons\s*<\/[^>]+>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (consFallback) consText = consFallback[1];
  }

  // Clean HTML tags
  prosText = prosText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  consText = consText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // If neither Pros nor Cons found, try one more approach: extract all <li> items
  // from the page that look like fundamental analysis points
  if (!prosText && !consText) {
    // Last resort: look for any li items near "strength" or "weakness" keywords
    const allLis = html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    const fundamentalLis = allLis
      .map(li => li.replace(/<[^>]+>/g, '').trim())
      .filter(text => text.length > 20 && text.length < 300)
      .filter(text => /growth|margin|revenue|profit|debt|order|capex|market share|roe|roce|cash flow|expansion|decline/i.test(text));

    if (fundamentalLis.length >= 2) {
      // Split into positive and negative based on keywords
      const posLis = fundamentalLis.filter(t => /growth|increase|improve|strong|high|good|expand|gain|healthy/i.test(t));
      const negLis = fundamentalLis.filter(t => /decline|decrease|weak|low|poor|contract|loss|debt|concern|risk/i.test(t));
      prosText = posLis.join(' ');
      consText = negLis.join(' ');
    }
  }

  if (!prosText && !consText) {
    return null;
  }

  const fullText = `${prosText} ${consText}`.toLowerCase();
  const prosLower = prosText.toLowerCase();
  const consLower = consText.toLowerCase();

  // Score calculation
  let totalScore = 0;
  const keyPhrasesPositive: string[] = [];
  const keyPhrasesNegative: string[] = [];

  for (const [keyword, weight] of POSITIVE_KEYWORDS) {
    const kw = keyword.toLowerCase();
    // Check in Pros (full weight) and Cons (reduced — might be comparing negatively)
    if (prosLower.includes(kw)) {
      totalScore += weight;
      keyPhrasesPositive.push(keyword);
    } else if (consLower.includes(kw)) {
      // Positive keyword in Cons section: could be "despite strong growth, margins fell"
      // Give reduced positive weight
      totalScore += weight * 0.3;
    }
  }

  for (const [keyword, weight] of NEGATIVE_KEYWORDS) {
    const kw = keyword.toLowerCase();
    if (consLower.includes(kw)) {
      totalScore += weight; // weight is already negative
      keyPhrasesNegative.push(keyword);
    } else if (prosLower.includes(kw)) {
      // Negative keyword in Pros: could be "despite debt, company is growing"
      totalScore += weight * 0.3;
    }
  }

  // Clamp to [-1, 1]
  const sentimentScore = Math.max(-1, Math.min(1, totalScore));

  // Classify guidance (recalibrated thresholds — was too strict, compressing all into Neutral)
  let guidance: GuidanceData['guidance'];
  if (sentimentScore > 0.05) guidance = 'Positive';
  else if (sentimentScore < -0.05) guidance = 'Negative';
  else guidance = 'Neutral';

  // Revenue outlook
  let revenueOutlook: GuidanceData['revenueOutlook'] = 'Unknown';
  if (/revenue growth|strong growth|top.?line growth|sales growth|record revenue|double digit growth/i.test(prosLower)) {
    revenueOutlook = 'Up';
  } else if (/revenue decline|declining revenue|top line pressure|muted demand|weak demand/i.test(fullText)) {
    revenueOutlook = 'Down';
  } else if (/steady|stable|flat/i.test(fullText) && /revenue|sales/i.test(fullText)) {
    revenueOutlook = 'Flat';
  }

  // Margin outlook
  let marginOutlook: GuidanceData['marginOutlook'] = 'Unknown';
  if (/margin expansion|improving margin|margin improvement|operating leverage|cost efficiency/i.test(prosLower)) {
    marginOutlook = 'Expanding';
  } else if (/margin compression|margin contraction|declining margin|margin erosion|cost pressure/i.test(fullText)) {
    marginOutlook = 'Contracting';
  } else if (/stable margin|maintained margin|margin sustain/i.test(fullText)) {
    marginOutlook = 'Stable';
  }

  // Capex signal
  let capexSignal: GuidanceData['capexSignal'] = 'Unknown';
  if (/capacity expansion|capex|new plant|capacity addition|greenfield|brownfield|commissioning|ramp up/i.test(prosLower)) {
    capexSignal = 'Expanding';
  } else if (/capex reduction|reducing capex|lower capex|no capex/i.test(fullText)) {
    capexSignal = 'Reducing';
  }

  // Demand signal
  let demandSignal: GuidanceData['demandSignal'] = 'Unknown';
  if (/strong demand|growing demand|record order|order inflow|healthy pipeline|robust growth|strong traction/i.test(prosLower)) {
    demandSignal = 'Strong';
  } else if (/weak demand|demand slowdown|muted demand|subdued demand/i.test(fullText)) {
    demandSignal = 'Weak';
  } else if (/moderate demand|steady demand/i.test(fullText)) {
    demandSignal = 'Moderate';
  }

  // Post-process to remove contradictory debt tags
  let positivePhrases = keyPhrasesPositive.slice(0, 5);
  let negativePhrases = keyPhrasesNegative.slice(0, 5);

  const hasFreeOrLow = positivePhrases.some(p => /debt.?free|low.*debt|deleveraging/i.test(p));
  const hasHighDebt = negativePhrases.some(p => /high.*debt|rising.*debt|overleveraged/i.test(p));

  if (hasFreeOrLow && hasHighDebt) {
    // Remove high debt from negative phrases (keep debt free signal)
    negativePhrases = negativePhrases.filter(p => !/high.*debt|rising.*debt|overleveraged/i.test(p));
  }

  return {
    guidance,
    sentimentScore: parseFloat(sentimentScore.toFixed(3)),
    revenueOutlook,
    marginOutlook,
    capexSignal,
    demandSignal,
    keyPhrasesPositive: positivePhrases,
    keyPhrasesNegative: negativePhrases,
    prosText: prosText.slice(0, 500),  // Cap to avoid huge storage
    consText: consText.slice(0, 500),
    divergence: 'None',  // Set by caller after checking earnings performance
  };
}

/** Detect divergence between reported earnings and forward guidance */
function detectDivergence(
  fundamentalsScore: number,
  guidanceData: GuidanceData
): GuidanceData['divergence'] {
  // Strong earnings (score >= 70) + Negative guidance = alpha signal
  if (fundamentalsScore >= 70 && guidanceData.guidance === 'Negative') {
    return 'StrongEarnings_WeakGuidance';
  }
  // Weak earnings (score < 45) + Positive guidance = potential turnaround
  if (fundamentalsScore < 45 && guidanceData.guidance === 'Positive') {
    return 'WeakEarnings_StrongGuidance';
  }
  return 'None';
}

// ── Growth Calculations ─────────────────────

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current > 0) return 999.9;  // Signal "from zero base"
    if (current < 0) return -999.9;
    return null;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return parseFloat(pct.toFixed(1));
}

/** Check if two quarters are exactly 3 months apart (consecutive quarters) */
function areConsecutiveQuarters(period1: string, period2: string): boolean {
  // periods should be like "Dec 2025", "Sep 2025"
  const months: Record<string, number> = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
  };

  const parts1 = period1.trim().split(/\s+/);
  const parts2 = period2.trim().split(/\s+/);

  if (parts1.length < 2 || parts2.length < 2) return false;

  const month1 = months[parts1[0]];
  const year1 = parseInt(parts1[parts1.length - 1]);
  const month2 = months[parts2[0]];
  const year2 = parseInt(parts2[parts2.length - 1]);

  if (!month1 || !month2 || isNaN(year1) || isNaN(year2)) return false;

  // Convert to absolute month count
  const absoluteMonth1 = year1 * 12 + month1;
  const absoluteMonth2 = year2 * 12 + month2;

  // Consecutive quarters are 3 months apart
  return Math.abs(absoluteMonth1 - absoluteMonth2) === 3;
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

function gradeFromScore(score: number, card?: { revenueYoY: number | null; patYoY: number | null; epsYoY: number | null; opmCurrent: number; opmPrevYear: number; isBanking?: boolean }, guidanceData?: GuidanceData | null): { grade: EarningsScanCard['grade']; color: string } {
  // EXCELLENT: Strong fundamentals + positive forward guidance
  // Two paths to EXCELLENT:
  // Path 1 (with guidance): score >= 78, strong metrics, guidance = Positive
  // Path 2 (exceptional numbers): score >= 80, ALL metrics very strong, guidance at least Neutral/unavailable
  // CRITICAL: Guidance makes it easier to reach EXCELLENT, not impossible without it
  if (score >= 78 && card) {
    const revOk = card.revenueYoY !== null && card.revenueYoY > 10;
    const patOk = card.patYoY !== null && card.patYoY > 15;
    const epsOk = card.epsYoY !== null && card.epsYoY > 10;
    const marginOk = card.isBanking || (card.opmCurrent - card.opmPrevYear) >= -1; // Allow tiny contraction

    if (revOk && patOk && epsOk && marginOk) {
      // Path 1: Has guidance and it's positive → EXCELLENT at score 78+
      if (guidanceData && guidanceData.guidance === 'Positive') {
        return { grade: 'EXCELLENT', color: '#7C3AED' };
      }
      // Path 2: Exceptional numbers even without guidance → EXCELLENT at score 82+
      // (Rev > 20%, PAT > 25%, EPS > 20%)
      if (score >= 82 && card.revenueYoY !== null && card.revenueYoY > 20 &&
          card.patYoY !== null && card.patYoY > 25 && card.epsYoY !== null && card.epsYoY > 20) {
        return { grade: 'EXCELLENT', color: '#7C3AED' };
      }
    }
  }
  if (score >= 75) return { grade: 'STRONG', color: '#00C853' };
  if (score >= 60) return { grade: 'GOOD', color: '#4CAF50' };
  if (score >= 40) return { grade: 'OK', color: '#FFD600' };
  return { grade: 'BAD', color: '#F44336' };
}

// ── Fetch & Build Card for a Symbol ─────────

// ── Cross-Source Validation ────────────────────
interface SourceResult {
  source: 'moneycontrol' | 'screener.in' | 'nse';
  quarters: QuarterFinancials[];
  companyName: string;
  isBanking: boolean;
  mcap?: number | null;
  pe?: number | null;
  currentPrice?: number | null;
  html?: string; // For guidance extraction from screener
}

/** Compare two source results — flag mismatch if revenue/PAT deviation > 10% */
function crossValidate(primary: SourceResult, secondary: SourceResult): { valid: boolean; discrepancy?: string } {
  if (primary.quarters.length === 0 || secondary.quarters.length === 0) return { valid: true };

  const pQ = primary.quarters[0]; // Latest quarter
  const sQ = secondary.quarters[0];

  // Match by period
  if (pQ.period !== sQ.period) {
    // Different periods — can't compare
    return { valid: true };
  }

  // Revenue deviation
  if (pQ.revenue > 0 && sQ.revenue > 0) {
    const revDev = Math.abs(pQ.revenue - sQ.revenue) / Math.max(pQ.revenue, sQ.revenue) * 100;
    if (revDev > 10) {
      return { valid: false, discrepancy: `Revenue mismatch: ${primary.source}=${pQ.revenue} vs ${secondary.source}=${sQ.revenue} (${revDev.toFixed(1)}% deviation)` };
    }
  }

  // PAT deviation
  if (pQ.pat !== 0 && sQ.pat !== 0) {
    const patDev = Math.abs(pQ.pat - sQ.pat) / Math.max(Math.abs(pQ.pat), Math.abs(sQ.pat)) * 100;
    if (patDev > 15) {
      return { valid: false, discrepancy: `PAT mismatch: ${primary.source}=${pQ.pat} vs ${secondary.source}=${sQ.pat} (${patDev.toFixed(1)}% deviation)` };
    }
  }

  return { valid: true };
}

/** Pick the best source when both have data — prefer higher confidence, more quarters */
function pickBestSource(a: SourceResult, b: SourceResult): SourceResult {
  const confA = SOURCE_CONFIDENCE[a.source] || 0;
  const confB = SOURCE_CONFIDENCE[b.source] || 0;

  // Screener gets metadata bonus (mcap, pe, price) even if confidence is lower
  // But Moneycontrol is more reliable for numbers
  if (a.quarters.length >= b.quarters.length + 2) return a; // Significantly more data wins
  if (b.quarters.length >= a.quarters.length + 2) return b;
  if (confA > confB) return a;
  if (confB > confA) return b;
  return a.quarters.length >= b.quarters.length ? a : b;
}

// ── Data Freshness Layer ──────────────────────
/** Compute confidence penalty based on data age */
function freshnessPenalty(fetchedAt: number): number {
  const ageMs = Date.now() - fetchedAt;
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours < 24) return 0;       // < 1 day: no penalty
  if (ageHours < 72) return -5;      // 1-3 days: -5
  if (ageHours < 168) return -10;    // 3-7 days: -10
  return -15;                         // > 7 days: -15
}

// ── Partial Data Scoring ──────────────────────
/** Compute penalty for missing fields */
function partialDataPenalty(quarters: QuarterFinancials[]): number {
  if (quarters.length === 0) return -30;
  const latest = quarters[0];
  let penalty = 0;
  if (latest.revenue === 0) penalty -= 10;   // Missing revenue
  if (latest.pat === 0) penalty -= 10;       // Missing PAT
  if (latest.eps === 0) penalty -= 5;        // Missing EPS
  if (quarters.length < 4) penalty -= 5;     // Less than 4 quarters (no YoY possible)
  if (quarters.length < 2) penalty -= 10;    // Less than 2 quarters (no QoQ possible)
  return Math.max(-30, penalty);
}

/** Build earnings card — NEVER returns null. All symbols get a card. */
async function buildEarningsCard(symbol: string): Promise<EarningsScanCard> {
  const store = getGlobalStore();
  let dataAge: 'fresh' | 'stale' | 'missing' = 'missing';
  const failureReasons: string[] = [];

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
      store.set(symbol, kvData);
      stored = kvData;
      dataAge = 'fresh';
      const card = buildCardFromStoredData(kvData);
      if (card) {
        card.dataAge = dataAge;
        return card;
      }
    } else if (kvData) {
      stored = kvData;
      store.set(symbol, kvData);
    }
  }

  // ═══════════════════════════════════════════════════
  // MULTI-SOURCE PIPELINE (CORRECT PRIORITY)
  // 1. Moneycontrol — PRIMARY (structured financial data)
  // 2. Screener.in — SECONDARY (financial data + guidance)
  // 3. NSE — METADATA ONLY (validation, company name, dates)
  //
  // Cross-validation: if 2+ sources return data, compare them
  // ═══════════════════════════════════════════════════

  console.log(`[Earnings Scan] ${symbol}: Starting multi-source fetch`);

  // Resolve symbols for each source in parallel
  const screenerSym = await resolveScreenerSymbol(symbol) || getScreenerSymbol(symbol);

  // Run ALL sources in parallel — pick best result after
  const [mcResult, scrResult, nseResult] = await Promise.allSettled([
    fetchMoneycontrolFinancials(symbol).catch(e => { failureReasons.push(`MC: ${(e as Error).message}`); return null; }),
    (async () => {
      // Screener: try consolidated, then standalone, then original symbol
      let html = await fetchScreenerData(screenerSym, 'consolidated');
      if (!html && screenerSym !== symbol) html = await fetchScreenerData(symbol, 'consolidated');
      if (!html) html = await fetchScreenerData(screenerSym, 'standalone');
      if (!html && screenerSym !== symbol) html = await fetchScreenerData(symbol, 'standalone');
      if (!html) return null;
      const parsed = parseQuarterlyResults(html);
      if (parsed.quarters.length === 0) return null;
      return {
        quarters: parsed.quarters,
        companyName: parsed.companyName,
        isBanking: parsed.isBanking,
        mcap: parsed.mcap,
        pe: parsed.pe,
        currentPrice: parsed.currentPrice,
        html,
      };
    })().catch(e => { failureReasons.push(`Screener: ${(e as Error).message}`); return null; }),
    fetchNSEFinancials(symbol).catch(e => { failureReasons.push(`NSE: ${(e as Error).message}`); return null; }),
  ]);

  const mcData = mcResult.status === 'fulfilled' ? mcResult.value : null;
  const scrData = scrResult.status === 'fulfilled' ? scrResult.value : null;
  const nseData = nseResult.status === 'fulfilled' ? nseResult.value : null;

  if (mcResult.status === 'rejected') failureReasons.push(`MC: rejected — ${mcResult.reason}`);
  if (scrResult.status === 'rejected') failureReasons.push(`Screener: rejected — ${scrResult.reason}`);
  if (nseResult.status === 'rejected') failureReasons.push(`NSE: rejected — ${nseResult.reason}`);

  // Collect valid source results
  const validSources: SourceResult[] = [];

  if (mcData && mcData.quarters.length >= 1) {
    const v = validateQuarterlyData(mcData.quarters, symbol);
    if (v.valid) {
      validSources.push({ source: 'moneycontrol', quarters: mcData.quarters, companyName: mcData.companyName, isBanking: mcData.isBanking });
      console.log(`[Earnings Scan] ${symbol}: ✓ MC valid (${mcData.quarters.length}Q)`);
    } else {
      failureReasons.push(`MC: validation failed — ${v.reason}`);
    }
  } else {
    failureReasons.push(mcData ? `MC: insufficient quarters (${mcData.quarters.length})` : 'MC: no data returned');
  }

  if (scrData && scrData.quarters.length >= 1) {
    const v = validateQuarterlyData(scrData.quarters, symbol);
    if (v.valid || scrData.quarters.length >= 1) {
      validSources.push({
        source: 'screener.in', quarters: scrData.quarters, companyName: scrData.companyName,
        isBanking: scrData.isBanking, mcap: scrData.mcap, pe: scrData.pe, currentPrice: scrData.currentPrice,
        html: scrData.html,
      });
      console.log(`[Earnings Scan] ${symbol}: ✓ Screener valid (${scrData.quarters.length}Q)`);
    } else {
      failureReasons.push(`Screener: validation failed — ${v.reason}`);
    }
  } else {
    failureReasons.push(scrData ? `Screener: insufficient quarters (${scrData.quarters.length})` : 'Screener: no data returned');
  }

  // NSE is metadata only — only use if MC + Screener both failed
  if (nseData && nseData.quarters.length >= 1) {
    const v = validateQuarterlyData(nseData.quarters, symbol);
    if (v.valid) {
      validSources.push({ source: 'nse', quarters: nseData.quarters, companyName: nseData.companyName, isBanking: nseData.isBanking });
      console.log(`[Earnings Scan] ${symbol}: ✓ NSE valid (${nseData.quarters.length}Q) [metadata-grade]`);
    } else {
      failureReasons.push(`NSE: validation failed — ${v.reason}`);
    }
  } else {
    failureReasons.push(nseData ? `NSE: insufficient quarters (${nseData.quarters.length})` : 'NSE: no data returned');
  }

  // ── Pick winner + cross-validate ──
  if (validSources.length > 0) {
    // Sort by priority: MC > Screener > NSE
    const priorityOrder: Record<string, number> = { 'moneycontrol': 1, 'screener.in': 2, 'nse': 3 };
    validSources.sort((a, b) => (priorityOrder[a.source] || 9) - (priorityOrder[b.source] || 9));

    let winner = validSources[0];

    // Cross-validate if 2+ sources available
    if (validSources.length >= 2) {
      const xv = crossValidate(validSources[0], validSources[1]);
      if (!xv.valid) {
        console.warn(`[Earnings Scan] ${symbol}: ⚠ CROSS-VALIDATION MISMATCH: ${xv.discrepancy}`);
        failureReasons.push(`Cross-validation: ${xv.discrepancy}`);
        // Pick the higher-priority source (MC > Screener > NSE)
        winner = validSources[0]; // Already sorted by priority
      } else {
        console.log(`[Earnings Scan] ${symbol}: ✓ Cross-validation passed between ${validSources[0].source} and ${validSources[1].source}`);
      }
    }

    // Extract guidance from screener HTML if available (even if screener isn't the winner)
    let guidanceData: GuidanceData | null = null;
    const screenerSource = validSources.find(s => s.source === 'screener.in' && s.html);
    if (screenerSource?.html) {
      try {
        guidanceData = parseGuidanceSentiment(screenerSource.html);
        if (guidanceData) {
          console.log(`[Earnings Scan] ${symbol}: Guidance=${guidanceData.guidance} Score=${guidanceData.sentimentScore}`);
        }
      } catch { /* guidance is best-effort */ }
    }

    // Merge metadata from screener (mcap, pe, price) even if MC is the financial data winner
    const screenerMeta = validSources.find(s => s.source === 'screener.in');
    const mcap = screenerMeta?.mcap || null;
    const pe = screenerMeta?.pe || null;
    const currentPrice = screenerMeta?.currentPrice || null;

    // Compute data status
    const qLen = winner.quarters.length;
    const hasAllFields = winner.quarters[0]?.revenue > 0 && winner.quarters[0]?.pat !== 0 && winner.quarters[0]?.eps !== 0;
    const dataStatus: StoredEarnings['dataStatus'] = (qLen >= 4 && hasAllFields) ? 'FULL' : (qLen >= 2) ? 'PARTIAL' : 'ESTIMATED';

    // Compute confidence with freshness (data just fetched = 0 penalty)
    const baseConfidence = SOURCE_CONFIDENCE[winner.source] || 70;
    const partialPenalty = partialDataPenalty(winner.quarters);
    const finalConfidence = Math.max(10, baseConfidence + partialPenalty);

    const storedData: StoredEarnings = {
      symbol,
      quarters: winner.quarters,
      companyName: winner.companyName || screenerMeta?.companyName || symbol,
      mcap, pe, currentPrice,
      sector: '', isBanking: winner.isBanking,
      source: winner.source,
      sourceConfidence: finalConfidence,
      dataStatus,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
      fetchedAt: Date.now(), validatedAt: Date.now(),
      guidance: guidanceData || undefined,
    };
    await kvSaveEarnings(symbol, storedData);
    const card = buildCardFromStoredData(storedData);
    if (card) {
      card.dataAge = 'fresh';
      return card;
    }
  }

  // ── Stale cache fallback ──
  if (stored) {
    console.warn(`[Earnings Scan] ${symbol}: All sources failed, using stale cache (${Math.round((Date.now() - stored.fetchedAt) / 60000)}min old)`);
    const card = buildCardFromStoredData(stored);
    if (card) {
      card.dataAge = 'stale';
      card.failureReasons = failureReasons;
      // Apply freshness penalty to stale data
      const fp = freshnessPenalty(stored.fetchedAt);
      card.sourceConfidence = Math.max(5, (card.sourceConfidence || 50) + fp);
      return card;
    }
  }

  // ── LAST RESORT: Return DATA_MISSING placeholder — NEVER drop a company ──
  console.warn(`[Earnings Scan] ${symbol}: ALL SOURCES FAILED — returning DATA_MISSING placeholder`);
  return buildMissingCard(symbol, failureReasons);
}

/** Build a DATA_MISSING placeholder card — ensures every symbol appears in results */
function buildMissingCard(symbol: string, failureReasons: string[]): EarningsScanCard {
  return {
    symbol,
    company: symbol,
    period: 'N/A',
    resultDate: 'N/A',
    reportType: 'Consolidated',
    quarters: [],
    revenueYoY: null, revenueQoQ: null,
    opProfitYoY: null, opProfitQoQ: null,
    patYoY: null, patQoQ: null,
    epsYoY: null, epsQoQ: null,
    fundamentalsScore: 0, priceScore: 0, totalScore: 0,
    grade: 'BAD', gradeColor: '#F44336',
    dataQuality: 'PRICE_ONLY',
    dataAge: 'missing',
    mcap: null, pe: null, cmp: null,
    isBanking: false,
    source: 'none',
    sourceConfidence: 0,
    dataStatus: 'MISSING',
    failureReasons,
    screenerUrl: `https://www.screener.in/company/${symbol}/consolidated/#quarters`,
    nseUrl: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(symbol)}`,
  };
}

function buildCardFromStoredData(data: StoredEarnings): EarningsScanCard | null {
  const card = buildCardFromData({
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
  }, data.guidance || null);

  if (card) {
    card.source = data.source;
    card.sourceConfidence = data.sourceConfidence || SOURCE_CONFIDENCE[data.source] || 0;
    card.dataStatus = data.dataStatus || (data.quarters.length >= 4 ? 'FULL' : data.quarters.length > 0 ? 'PARTIAL' : 'MISSING');
    card.failureReasons = data.failureReasons;
  }
  return card;
}

function buildCardFromData(data: ScreenerData, guidanceData?: GuidanceData | null): EarningsScanCard | null {
  // Use consolidated if available, else standalone
  let quarters = data.consolidated.length > 0 ? data.consolidated : data.standalone;
  const reportType: 'Consolidated' | 'Standalone' = data.consolidated.length > 0 ? 'Consolidated' : 'Standalone';

  if (quarters.length === 0) return null;

  // Filter out stale quarters (>3 years old) to prevent data contamination
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-based
  quarters = quarters.filter(q => {
    const parts = q.period.split(' ');
    if (parts.length !== 2) return true; // keep if unparseable
    const year = parseInt(parts[1]);
    if (isNaN(year)) return true;
    // Reject if more than 3 years old
    return (currentYear - year) <= 3;
  });

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
  // Only compute QoQ if quarters are consecutive (exactly 3 months apart)
  const revenueQoQ = prevQ && areConsecutiveQuarters(latest.period, prevQ.period) ? pctChange(latest.revenue, prevQ.revenue) : null;
  const opProfitYoY = yoyQ ? pctChange(latest.operatingProfit, yoyQ.operatingProfit) : null;
  const opProfitQoQ = prevQ && areConsecutiveQuarters(latest.period, prevQ.period) ? pctChange(latest.operatingProfit, prevQ.operatingProfit) : null;
  const patYoY = yoyQ ? pctChange(latest.pat, yoyQ.pat) : null;
  const patQoQ = prevQ && areConsecutiveQuarters(latest.period, prevQ.period) ? pctChange(latest.pat, prevQ.pat) : null;
  const epsYoY = yoyQ ? pctChange(latest.eps, yoyQ.eps) : null;
  const epsQoQ = prevQ && areConsecutiveQuarters(latest.period, prevQ.period) ? pctChange(latest.eps, prevQ.eps) : null;

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
  // Apply partial data penalty when fields are missing
  const pdPenalty = partialDataPenalty(quarters);
  const rawScore = dataQuality !== 'PRICE_ONLY'
    ? Math.round(0.6 * fundamentalsScore + 0.4 * priceScore)
    : priceScore;
  const totalScore = Math.max(0, Math.min(100, rawScore + pdPenalty));

  // Detect divergence between reported performance and forward guidance
  if (guidanceData) {
    guidanceData.divergence = detectDivergence(fundamentalsScore, guidanceData);
  }

  const { grade, color: gradeColor } = gradeFromScore(totalScore, {
    revenueYoY, patYoY, epsYoY,
    opmCurrent: latest.opm, opmPrevYear: yoyQ?.opm || latest.opm,
    isBanking: data.isBanking,
  }, guidanceData);

  // Take last 3 quarters for display + year-ago quarter
  const displayQuarters = quarters.slice(0, 3);
  if (yoyQ && !displayQuarters.find(q => q.period === yoyQ.period)) {
    displayQuarters.push(yoyQ); // Add year-ago if not already in display
  }
  // Sort chronologically for display (oldest → newest, left to right)
  displayQuarters.sort((a, b) => periodToNum(a.period) - periodToNum(b.period));

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
    // Guidance & Sentiment fields
    guidance: guidanceData?.guidance,
    sentimentScore: guidanceData?.sentimentScore,
    revenueOutlook: guidanceData?.revenueOutlook,
    marginOutlook: guidanceData?.marginOutlook,
    capexSignal: guidanceData?.capexSignal,
    demandSignal: guidanceData?.demandSignal,
    keyPhrasesPositive: guidanceData?.keyPhrasesPositive,
    keyPhrasesNegative: guidanceData?.keyPhrasesNegative,
    divergence: guidanceData?.divergence || 'None',
    // Source attribution (defaults — overridden by caller)
    source: 'screener.in',
    sourceConfidence: SOURCE_CONFIDENCE['screener.in'],
    dataStatus: (hasRevenue && hasPAT && hasEPS && quarters.length >= 4) ? 'FULL' : (hasRevenue || hasPAT) ? 'PARTIAL' : 'MISSING',
    screenerUrl: `https://www.screener.in/company/${data.symbol}/consolidated/#quarters`,
    nseUrl: `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(data.symbol)}`,
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

    // Cap at 50 symbols — cached ones return instantly from KV, only uncached trigger scraping
    symbols = symbols.slice(0, 50);

    console.log(`[Earnings Scan] Scanning ${symbols.length} symbols: ${symbols.join(', ')}`);

    // Fetch in batches of 8 with 200ms delay between batches
    // buildEarningsCard() NEVER returns null — every symbol gets a card
    const cards: EarningsScanCard[] = [];
    const BATCH_SIZE = 8;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(sym =>
          Promise.race([
            buildEarningsCard(sym),
            // Per-symbol timeout: 12s max — prevents one slow symbol from blocking the batch
            new Promise<EarningsScanCard>((_, reject) => setTimeout(() => reject(new Error('Timeout (12s)')), 12000)),
          ]).catch((err) => {
            console.warn(`[Earnings Scan] ${sym} crashed/timed out:`, err);
            // Even on crash, return a DATA_MISSING card
            return buildMissingCard(sym, [`Crash: ${(err as Error).message}`]);
          })
        )
      );

      cards.push(...batchResults);

      // Shorter delay between batches
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Sort by totalScore descending
    cards.sort((a, b) => b.totalScore - a.totalScore);

    const cardsWithGuidance = cards.filter(c => c.guidance);
    const cardsWithData = cards.filter(c => c.dataStatus !== 'MISSING');
    const missingCards = cards.filter(c => c.dataStatus === 'MISSING');

    const summary = {
      total: cards.length,
      withData: cardsWithData.length,
      missing: missingCards.length,
      excellent: cards.filter(c => c.grade === 'EXCELLENT').length,
      strong: cards.filter(c => c.grade === 'STRONG').length,
      good: cards.filter(c => c.grade === 'GOOD').length,
      ok: cards.filter(c => c.grade === 'OK').length,
      bad: cards.filter(c => c.grade === 'BAD').length,
      avgScore: cardsWithData.length > 0
        ? parseFloat((cardsWithData.reduce((s, c) => s + c.totalScore, 0) / cardsWithData.length).toFixed(1))
        : 0,
      // Source attribution
      sourceBreakdown: {
        nse: cards.filter(c => c.source === 'nse').length,
        moneycontrol: cards.filter(c => c.source === 'moneycontrol').length,
        screener: cards.filter(c => c.source === 'screener.in').length,
        trendlyne: cards.filter(c => c.source === 'trendlyne').length,
        none: cards.filter(c => c.source === 'none').length,
      },
      avgConfidence: cardsWithData.length > 0
        ? parseFloat((cardsWithData.reduce((s, c) => s + c.sourceConfidence, 0) / cardsWithData.length).toFixed(1))
        : 0,
      // Guidance aggregation
      guidanceCoverage: cardsWithGuidance.length,
      guidancePositive: cardsWithGuidance.filter(c => c.guidance === 'Positive').length,
      guidanceNeutral: cardsWithGuidance.filter(c => c.guidance === 'Neutral').length,
      guidanceNegative: cardsWithGuidance.filter(c => c.guidance === 'Negative').length,
      avgSentiment: cardsWithGuidance.length > 0
        ? parseFloat((cardsWithGuidance.reduce((s, c) => s + (c.sentimentScore || 0), 0) / cardsWithGuidance.length).toFixed(3))
        : 0,
      divergences: cards.filter(c => c.divergence && c.divergence !== 'None').length,
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
      dataStatusBreakdown: {
        full: cards.filter(c => c.dataStatus === 'FULL').length,
        partial: cards.filter(c => c.dataStatus === 'PARTIAL').length,
        estimated: cards.filter(c => c.dataStatus === 'ESTIMATED').length,
        missing: cards.filter(c => c.dataStatus === 'MISSING').length,
      },
    };

    console.log(`[Earnings Scan] ${cards.length} cards built (${cardsWithData.length} with data, ${missingCards.length} missing)`);
    if (missingCards.length > 0) {
      console.log(`[Earnings Scan] Missing symbols: ${missingCards.map(c => c.symbol).join(', ')}`);
    }

    return NextResponse.json({
      cards,
      summary,
      source: 'multi-source: nse + moneycontrol + screener.in + cache',
      cacheBackend: isRedisAvailable() ? 'redis' : 'memory',
      updatedAt: new Date().toISOString(),
      ...(debug ? { debug: true, requestedSymbols: symbols, missingSymbols: missingCards.map(c => ({ symbol: c.symbol, reasons: c.failureReasons })) } : {}),
    });

  } catch (error) {
    console.error('[Earnings Scan] Error:', error);
    return NextResponse.json({
      cards: [],
      summary: { total: 0, excellent: 0, strong: 0, good: 0, ok: 0, bad: 0, avgScore: 0, guidanceCoverage: 0, guidancePositive: 0, guidanceNeutral: 0, guidanceNegative: 0, avgSentiment: 0, divergences: 0, dataQualityBreakdown: { full: 0, partial: 0, priceOnly: 0 }, dataAgeBreakdown: { fresh: 0, stale: 0, missing: 0 } },
      error: String(error),
    }, { status: 500 });
  }
}
