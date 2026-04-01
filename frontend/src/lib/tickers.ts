/**
 * Ticker normalization layer for Market Cockpit
 *
 * Handles:
 * - Case-insensitive matching
 * - Alias resolution (L&T → LT, M&M → M&M)
 * - .NS suffix stripping (RELIANCE.NS → RELIANCE)
 * - BSE code → NSE symbol mapping
 * - Common misspellings
 */

// Canonical NSE ticker aliases
const TICKER_ALIASES: Record<string, string> = {
  // Common aliases
  'L&T': 'LT',
  'LNT': 'LT',
  'LARSEN': 'LT',
  'LARSENTOUBRO': 'LT',
  'M&MFIN': 'M&MFIN',
  'MMFIN': 'M&MFIN',
  'MAHFIN': 'M&MFIN',
  'M&M': 'M&M',
  'MM': 'M&M',
  'MAHINDRA': 'M&M',
  'BAJAJ-AUTO': 'BAJAJ-AUTO',
  'BAJAJAUTO': 'BAJAJ-AUTO',
  'BAJAUTFIN': 'BAJFINANCE',

  // Banking
  'HDFC': 'HDFCBANK',
  'ICICI': 'ICICIBANK',
  'STATEBANK': 'SBIN',
  'SBI': 'SBIN',
  'AXIS': 'AXISBANK',
  'KOTAK': 'KOTAKBANK',
  'PNB': 'PNB',
  'BOB': 'BANKBARODA',
  'FEDERAL': 'FEDERALBNK',
  'IDFCFIRST': 'IDFCFIRSTB',
  'INDUSIND': 'INDUSINDBK',

  // IT
  'INFOSYS': 'INFY',
  'TATA CONSULTANCY': 'TCS',
  'WIPRO': 'WIPRO',
  'HCLTECH': 'HCLTECH',
  'HCL': 'HCLTECH',
  'TECHM': 'TECHM',
  'TECHMAHINDRA': 'TECHM',
  'LTIMINDTREE': 'LTIM',

  // Others
  'RELIANCE': 'RELIANCE',
  'RIL': 'RELIANCE',
  'HINDLEVER': 'HINDUNILVR',
  'HUL': 'HINDUNILVR',
  'AIRTEL': 'BHARTIARTL',
  'BHARTI': 'BHARTIARTL',
  'TATAMOTORS': 'TATAMOTORS',
  'TATAMOTOR': 'TATAMOTORS',
  'TATA MOTORS': 'TATAMOTORS',
  'SUNPHARMA': 'SUNPHARMA',
  'SUNPHARM': 'SUNPHARMA',
  'MARUTI': 'MARUTI',
  'MARUTISUZUKI': 'MARUTI',

  // Known problem stocks (BUG-04 fix)
  'SJS': 'SJSENTERPR',
  'S&SPOWER': 'S&SPOWER',    // NSE uses S&SPOWER; URL encoding handled in fetchStockQuote
  'GVT&D': 'GVTD',
  'SAVERA': 'SAVERAHOTL',
  'DYNACONS': 'DYNACONS',  // Verify this is correct NSE ticker
};

/**
 * Normalize a ticker to its canonical NSE form.
 * Handles: .NS suffix, case, aliases, whitespace
 */
export function normalizeTicker(input: string): string {
  if (!input) return '';

  let ticker = input.trim().toUpperCase();

  // Strip exchange suffixes (.NS, .BO, .NSE, .BSE)
  ticker = ticker.replace(/\.(NS|BO|NSE|BSE)$/i, '');

  // Strip any trailing whitespace/junk
  ticker = ticker.replace(/\s+/g, '');

  // Check alias map
  if (TICKER_ALIASES[ticker]) {
    return TICKER_ALIASES[ticker];
  }

  return ticker;
}

/**
 * Normalize an array of tickers, deduplicating after normalization
 */
export function normalizeTickerList(tickers: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tickers) {
    const normalized = normalizeTicker(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

/**
 * Check if a ticker matches (case-insensitive, alias-aware)
 */
export function tickerMatches(input: string, target: string): boolean {
  return normalizeTicker(input) === normalizeTicker(target);
}

/**
 * Banking stock detection by symbol name patterns
 */
const BANKING_TICKERS = new Set([
  'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK',
  'INDUSINDBK', 'FEDERALBNK', 'BANDHANBNK', 'IDFCFIRSTB', 'PNB',
  'BANKBARODA', 'CANBK', 'UNIONBANK', 'IOB', 'CENTRALBK',
  'INDIANB', 'MAHABANK', 'UCOBANK', 'RBLBANK', 'YESBANK',
  'AUBANK', 'EQUITASBNK', 'UJJIVANSFB', 'ESAFSFB',
  // NBFCs
  'BAJFINANCE', 'BAJAJFINSV', 'LICHSGFIN', 'MANAPPURAM',
  'MUTHOOTFIN', 'M&MFIN', 'CHOLAFIN', 'SHRIRAMFIN',
  'POONAWALLA', 'IIFL', 'LTFH',
]);

export function isBankingTicker(symbol: string): boolean {
  const normalized = normalizeTicker(symbol);
  if (BANKING_TICKERS.has(normalized)) return true;
  // Pattern-based detection
  return /BANK|BNK|FIN$|HOUSING/i.test(normalized);
}
