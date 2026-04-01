/**
 * SymbolMaster — Canonical ticker resolver for Market Cockpit
 *
 * Single source of truth for:
 * - NSE symbol → screener.in symbol mapping
 * - Known bad ticker overrides (e.g. SMLMAH → SMLISUZU)
 * - Company name → screener.in slug generation
 *
 * All pipelines (earnings-scan, guidance-ingest, intelligence) must use
 * resolveScreenerSymbol() instead of raw NSE tickers.
 */

// ── NSE → screener.in symbol overrides ───────────────────────────────────────
// Only add symbols where NSE ticker ≠ screener.in ticker
export const SCREENER_SYMBOL_MAP: Record<string, string> = {
  // Ampersand / special chars
  'M&M':        'MM',
  'M&MFIN':     'MMFIN',
  'L&TFH':      'LTFH',
  'L&T':        'LT',
  'S&SPOWER':   'SSPOWER',
  // Hyphenated tickers
  'BAJAJ-AUTO': 'BAJAJAUTO',
  // Known broken NSE codes (company renamed/relisted)
  'SMLMAH':     'SMLISUZU',         // SML Isuzu was listed as SMLMAH
  // Payment / fintech edge cases
  'PAYTM':      'ONEPAYTM',         // Listed as One97 Communications
  // BSE numeric codes that show up in portfolios
  '532067':     'BLACKBIO',
};

// ── Overrides for fully wrong NSE codes ──────────────────────────────────────
// When the NSE symbol itself is wrong/deprecated, map to the correct one
export const NSE_TICKER_OVERRIDES: Record<string, string> = {
  'SMLMAH': 'SMLISUZU',
};

// ── Sector fallback map for common tickers ────────────────────────────────────
// Use when NSE index API doesn't return sector info
export const SYMBOL_SECTORS: Record<string, string> = {
  'RELIANCE': 'Energy', 'TCS': 'IT', 'HDFCBANK': 'Banking & Finance', 'INFY': 'IT',
  'ICICIBANK': 'Banking & Finance', 'HINDUNILVR': 'FMCG', 'ITC': 'FMCG', 'SBIN': 'Banking & Finance',
  'BHARTIARTL': 'Media & Telecom', 'KOTAKBANK': 'Banking & Finance', 'LT': 'Capital Goods',
  'HCLTECH': 'IT', 'AXISBANK': 'Banking & Finance', 'ASIANPAINT': 'Consumer', 'MARUTI': 'Auto',
  'SUNPHARMA': 'Healthcare', 'TITAN': 'Consumer', 'BAJFINANCE': 'Banking & Finance',
  'DMART': 'Consumer', 'ULTRACEMCO': 'Metals & Mining', 'NTPC': 'Energy', 'ONGC': 'Energy',
  'NESTLEIND': 'FMCG', 'WIPRO': 'IT', 'M&M': 'Auto', 'JSWSTEEL': 'Metals & Mining',
  'POWERGRID': 'Energy', 'TATASTEEL': 'Metals & Mining', 'TATAMOTORS': 'Auto',
  'ADANIENT': 'Diversified', 'ADANIPORTS': 'Infrastructure', 'DIVISLAB': 'Healthcare',
  'COALINDIA': 'Metals & Mining', 'BAJAJFINSV': 'Banking & Finance', 'TECHM': 'IT',
  'DRREDDY': 'Healthcare', 'CIPLA': 'Healthcare', 'BRITANNIA': 'FMCG',
  'APOLLOHOSP': 'Healthcare', 'EICHERMOT': 'Auto', 'TATACONSUM': 'FMCG',
  'GRASIM': 'Metals & Mining', 'INDUSINDBK': 'Banking & Finance', 'BPCL': 'Energy',
  'HEROMOTOCO': 'Auto', 'SBILIFE': 'Banking & Finance', 'HDFCLIFE': 'Banking & Finance',
  'BAJAJ-AUTO': 'Auto', 'HINDALCO': 'Metals & Mining', 'SHRIRAMFIN': 'Banking & Finance',
  'HAL': 'Capital Goods', 'BEL': 'Capital Goods', 'BHEL': 'Capital Goods',
  'IRCTC': 'Capital Goods', 'ZOMATO': 'Consumer', 'PAYTM': 'IT',
  'TRENT': 'Consumer', 'DELHIVERY': 'Capital Goods', 'NAUKRI': 'IT',
  'PERSISTENT': 'IT', 'MPHASIS': 'IT', 'LTIM': 'IT', 'TATAELXSI': 'IT',
  'OFSS': 'IT', 'COFORGE': 'IT', 'KPITTECH': 'IT',
};

// ── Core resolver functions ───────────────────────────────────────────────────

/**
 * Resolve NSE symbol to screener.in compatible symbol.
 * Most NSE symbols work directly on screener.in, only overrides needed for exceptions.
 */
export function resolveScreenerSymbol(nseSymbol: string): string {
  const normalized = nseSymbol.trim().toUpperCase();
  return SCREENER_SYMBOL_MAP[normalized] || normalized;
}

/**
 * Normalize a raw ticker input to canonical NSE format.
 * Also applies known bad-ticker overrides.
 */
export function normalizeNSETicker(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  return NSE_TICKER_OVERRIDES[upper] || upper;
}

/**
 * Get the sector for a given symbol.
 * Returns 'Other' if unknown.
 */
export function getSymbolSector(symbol: string): string {
  return SYMBOL_SECTORS[symbol.toUpperCase()] || 'Other';
}

/**
 * Generate a screener.in URL slug from a company name.
 * e.g., "RELIANCE INDUSTRIES LTD" → "reliance-industries"
 * e.g., "HDFC Bank Limited" → "hdfc-bank"
 */
export function toScreenerSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/\s+(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|corporation|corp\.?|industries|inc\.?|co\.?)\.?(\s|$)/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+$/g, '');
}

/**
 * Normalize a list of tickers: trim, uppercase, apply overrides, deduplicate.
 */
export function normalizeTickerList(tickers: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tickers) {
    const normalized = normalizeNSETicker(t);
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Build screener.in page URL for a symbol.
 * Tries consolidated first, falls back to standalone.
 */
export function buildScreenerUrl(nseSymbol: string, type: 'consolidated' | 'standalone' | 'auto' = 'auto'): string {
  const screenerSym = resolveScreenerSymbol(nseSymbol);
  if (type === 'consolidated') return `https://www.screener.in/company/${screenerSym}/consolidated/`;
  if (type === 'standalone') return `https://www.screener.in/company/${screenerSym}/`;
  return `https://www.screener.in/company/${screenerSym}/consolidated/`;
}

/**
 * Build NSE filing URL for a symbol.
 */
export function buildNseUrl(nseSymbol: string): string {
  return `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(nseSymbol)}`;
}
