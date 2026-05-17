// ═══════════════════════════════════════════════════════════════════════════
// CENTRAL TICKER VOCABULARY — PATCH 0455 CLEANUP-3
//
// Single source of truth for ticker aliases (used in news search expansion)
// and the junk-ticker denylist (filters tokens that look like tickers but
// are common English words). Previously inlined per-page in news/page.tsx,
// orders/page.tsx, and others — drift between copies was already starting.
// ═══════════════════════════════════════════════════════════════════════════

/** Common English words / abbreviations that masquerade as tickers in NLP
 *  classifiers. Used to filter title-extracted ticker candidates. */
export const JUNK_TICKERS = new Set<string>([
  // 2-3 letter common English / abbreviations
  'ON', 'IT', 'ALL', 'AN', 'IS', 'ARE', 'OR', 'SO', 'GO', 'DO', 'HE', 'WE', 'AI',
  'BE', 'BY', 'NO', 'NEW', 'OLD', 'TOP', 'NEXT', 'OVER', 'UNDER',
  // SEC form codes that look like tickers
  'EPC', 'IPO', 'MW', 'GW', 'KW', 'MWH', 'GWH', 'SPV', 'PPA', 'BESS', 'HBM', 'AMC', 'AGM',
  'CSR', 'ESG', 'DAE', 'NCLT', 'SEBI', 'RBI',
]);

/** When the user searches for a ticker, also search for these aliases. */
export const TICKER_ALIASES: Record<string, string[]> = {
  // US tech
  'NVDA': ['nvidia', 'jensen huang', 'blackwell', 'h100', 'h200', 'b200'],
  'AAPL': ['apple'],
  'MSFT': ['microsoft', 'azure', 'satya nadella'],
  'GOOGL': ['alphabet', 'google', 'deepmind', 'sundar pichai'],
  'AMZN': ['amazon', 'aws'],
  'META': ['meta platforms', 'facebook', 'zuckerberg'],
  'TSLA': ['tesla', 'elon musk'],
  'AMD': ['amd', 'lisa su'],
  'INTC': ['intel'],
  'TSM': ['tsmc', 'taiwan semiconductor'],
  'AVGO': ['broadcom'],
  'MU': ['micron'],
  'ASML': ['asml'],
  'LRCX': ['lam research'],
  'KLAC': ['kla'],
  'AMAT': ['applied materials'],
  // India megacaps
  'RELIANCE': ['reliance', 'mukesh ambani'],
  'TCS': ['tata consultancy', 'tcs'],
  'INFY': ['infosys'],
  'HDFCBANK': ['hdfc bank'],
  'ICICIBANK': ['icici bank'],
  'WIPRO': ['wipro'],
  'TATAMOTORS': ['tata motors'],
  'TATASTEEL': ['tata steel'],
  'ADANIENT': ['adani enterprises', 'adani group', 'gautam adani'],
  'BHARTIARTL': ['bharti airtel'],
  'KOTAKBANK': ['kotak mahindra'],
  'SBIN': ['state bank of india'],
  'LT': ['larsen', 'l&t'],
  'HUL': ['hindustan unilever'],
  'AXISBANK': ['axis bank'],
  'MARUTI': ['maruti suzuki'],
  // Defence / aerospace
  'HAL': ['hindustan aeronautics'],
  'BEL': ['bharat electronics'],
  'BHARATFORG': ['bharat forge'],
  'BDL': ['bharat dynamics'],
  'MAZDOCK': ['mazagon dock'],
  // Banks / financials
  'BAJFINANCE': ['bajaj finance'],
  'BAJAJFINSV': ['bajaj finserv'],
  // Energy
  'NTPC': ['ntpc'],
  'POWERGRID': ['power grid corporation'],
  'COALINDIA': ['coal india'],
  'ONGC': ['ongc'],
};
