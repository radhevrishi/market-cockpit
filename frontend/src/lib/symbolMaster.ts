/**
 * SymbolMaster — Canonical ticker resolver for Market Cockpit
 *
 * Single source of truth for:
 * - NSE symbol → screener.in symbol mapping
 * - Known bad ticker overrides (e.g. SMLMAH → SMLISUZU)
 * - Company name → screener.in slug generation
 * - NSE CSV-backed full symbol catalog (Redis-cached)
 * - Multi-source fallback resolution
 * - ISIN ↔ NSE symbol mapping
 *
 * All pipelines (earnings-scan, guidance-ingest, intelligence) must use
 * resolveScreenerSymbol() instead of raw NSE tickers.
 */

import { kvGet, kvSet } from './kv';

// ── Redis Keys ───────────────────────────────────────────────────────────────
const MASTER_KEY = 'symbolmaster:catalog';     // Full catalog from NSE CSV
const MASTER_META_KEY = 'symbolmaster:meta';   // Last refresh timestamp + stats
const MASTER_TTL = 86400;                       // 24 hours

// ── Types ────────────────────────────────────────────────────────────────────

export interface SymbolEntry {
  symbol: string;          // NSE trading symbol (canonical)
  isin: string;            // ISIN code
  companyName: string;     // Full company name
  series: string;          // EQ, BE, SM, etc.
  listingDate?: string;    // dd-MMM-yyyy
  faceValue?: number;
  industry?: string;       // MACRO industry from NSE
  screenerSymbol?: string; // Override if different from NSE symbol
}

export interface SymbolMasterCatalog {
  entries: Record<string, SymbolEntry>;   // keyed by NSE symbol
  isinMap: Record<string, string>;        // ISIN → NSE symbol
  nameIndex: Record<string, string>;      // lowercase company name → NSE symbol
  updatedAt: number;
  symbolCount: number;
}

export interface SymbolMasterMeta {
  lastRefresh: number;
  symbolCount: number;
  source: 'nse_csv' | 'fallback';
  error?: string;
}

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
  'SMLMAH':     'SMLISUZU',
  // Payment / fintech edge cases
  'PAYTM':      'ONEPAYTM',
  // BSE numeric codes that show up in portfolios
  '532067':     'BLACKBIO',
  // Additional discovered mappings
  'J&KBANK':    'JKBANK',
  'L&T-TECH':   'LTTS',
  'PAGE-IND':   'PAGEIND',
};

// ── Overrides for fully wrong NSE codes ──────────────────────────────────────
export const NSE_TICKER_OVERRIDES: Record<string, string> = {
  'SMLMAH': 'SMLISUZU',
};

// ── Sector fallback map for common tickers ────────────────────────────────────
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

// ── In-memory cache (process lifetime) ───────────────────────────────────────
let memCatalog: SymbolMasterCatalog | null = null;
let memCatalogLoadedAt = 0;
const MEM_CACHE_TTL = 600_000; // 10 minutes

// ── Core resolver functions ───────────────────────────────────────────────────

/**
 * Resolve NSE symbol to screener.in compatible symbol.
 * Checks: static overrides → catalog overrides → passthrough
 */
export function resolveScreenerSymbol(nseSymbol: string): string {
  const normalized = nseSymbol.trim().toUpperCase();
  // Static override first
  if (SCREENER_SYMBOL_MAP[normalized]) return SCREENER_SYMBOL_MAP[normalized];
  // Catalog override if loaded
  if (memCatalog?.entries[normalized]?.screenerSymbol) {
    return memCatalog.entries[normalized].screenerSymbol!;
  }
  return normalized;
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
 * Checks: catalog → static map → 'Other'
 */
export function getSymbolSector(symbol: string): string {
  const upper = symbol.toUpperCase();
  // Catalog industry first
  if (memCatalog?.entries[upper]?.industry) {
    return memCatalog.entries[upper].industry!;
  }
  return SYMBOL_SECTORS[upper] || 'Other';
}

/**
 * Generate a screener.in URL slug from a company name.
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

// ═══════════════════════════════════════════════════════════════════════════════
// NSE CSV CATALOG — Full symbol list from NSE India
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * NSE publishes equity lists as CSVs. We fetch, parse, and cache in Redis.
 * Primary: https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
 * Fallback: https://www.nseindia.com/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O
 *
 * CSV columns: SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
 */

const NSE_CSV_URLS = [
  'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
  'https://archives.nseindia.com/content/equities/EQUITY_L.csv',
];

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/csv,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
};

/**
 * Parse NSE EQUITY_L.csv content into SymbolEntry array.
 * Handles: BOM, inconsistent quoting, trailing commas, empty rows
 */
function parseNseEquityCsv(csvText: string): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  // Remove BOM if present
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return entries;

  // Parse header to find column indices
  const header = lines[0].split(',').map(h => h.trim().toUpperCase().replace(/"/g, ''));
  const idx = {
    symbol: header.findIndex(h => h === 'SYMBOL'),
    name: header.findIndex(h => h.includes('NAME')),
    series: header.findIndex(h => h === 'SERIES'),
    listing: header.findIndex(h => h.includes('LISTING')),
    faceValue: header.findIndex(h => h.includes('FACE VALUE')),
    isin: header.findIndex(h => h.includes('ISIN')),
  };

  if (idx.symbol === -1) {
    console.error('[SymbolMaster] CSV header missing SYMBOL column:', header);
    return entries;
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (NSE CSVs don't have quoted commas)
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const symbol = cols[idx.symbol]?.toUpperCase();
    if (!symbol) continue;

    const entry: SymbolEntry = {
      symbol,
      isin: cols[idx.isin] || '',
      companyName: cols[idx.name] || '',
      series: cols[idx.series] || 'EQ',
      listingDate: cols[idx.listing] || undefined,
      faceValue: idx.faceValue >= 0 ? parseFloat(cols[idx.faceValue]) || undefined : undefined,
    };

    // Auto-detect screener symbol override
    if (SCREENER_SYMBOL_MAP[symbol]) {
      entry.screenerSymbol = SCREENER_SYMBOL_MAP[symbol];
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Build the catalog from parsed entries.
 */
function buildCatalog(entries: SymbolEntry[]): SymbolMasterCatalog {
  const catalog: SymbolMasterCatalog = {
    entries: {},
    isinMap: {},
    nameIndex: {},
    updatedAt: Date.now(),
    symbolCount: 0,
  };

  // Prefer EQ series over others when duplicates exist
  const seriesPriority: Record<string, number> = { 'EQ': 0, 'BE': 1, 'SM': 2, 'BZ': 3 };

  for (const entry of entries) {
    const existing = catalog.entries[entry.symbol];
    if (existing) {
      const existingPri = seriesPriority[existing.series] ?? 99;
      const newPri = seriesPriority[entry.series] ?? 99;
      if (newPri >= existingPri) continue; // Keep higher priority
    }

    catalog.entries[entry.symbol] = entry;

    if (entry.isin) {
      catalog.isinMap[entry.isin] = entry.symbol;
    }

    if (entry.companyName) {
      const nameKey = entry.companyName.toLowerCase().replace(/\s+/g, ' ').trim();
      catalog.nameIndex[nameKey] = entry.symbol;
    }
  }

  catalog.symbolCount = Object.keys(catalog.entries).length;
  return catalog;
}

/**
 * Fetch the NSE CSV and build the catalog.
 * Tries multiple URLs with timeout. Returns null on failure.
 */
async function fetchNseCsvCatalog(): Promise<SymbolMasterCatalog | null> {
  for (const url of NSE_CSV_URLS) {
    try {
      console.log(`[SymbolMaster] Fetching CSV from ${url}...`);
      const resp = await fetch(url, {
        headers: NSE_HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.warn(`[SymbolMaster] CSV fetch failed: HTTP ${resp.status} from ${url}`);
        continue;
      }

      const text = await resp.text();
      if (text.length < 100) {
        console.warn(`[SymbolMaster] CSV too small (${text.length} bytes), skipping`);
        continue;
      }

      const entries = parseNseEquityCsv(text);
      if (entries.length < 100) {
        console.warn(`[SymbolMaster] Only ${entries.length} entries parsed, likely bad CSV`);
        continue;
      }

      const catalog = buildCatalog(entries);
      console.log(`[SymbolMaster] Catalog built: ${catalog.symbolCount} symbols from ${url}`);
      return catalog;
    } catch (e: any) {
      console.warn(`[SymbolMaster] CSV fetch error from ${url}: ${e.message}`);
      continue;
    }
  }
  return null;
}

/**
 * Fallback: build catalog from NSE API index constituents.
 * Uses: NIFTY 50, NIFTY NEXT 50, NIFTY MIDCAP 100, NIFTY 500
 */
async function fetchFallbackCatalog(): Promise<SymbolMasterCatalog | null> {
  const indices = [
    'NIFTY%2050',
    'NIFTY%20NEXT%2050',
    'NIFTY%20MIDCAP%20100',
    'NIFTY%20SMALLCAP%20100',
  ];

  const allEntries: SymbolEntry[] = [];

  for (const idx of indices) {
    try {
      const url = `https://www.nseindia.com/api/equity-stockIndices?index=${idx}`;
      const resp = await fetch(url, {
        headers: {
          ...NSE_HEADERS,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) continue;
      const data = await resp.json() as any;
      if (!data?.data) continue;

      for (const item of data.data) {
        if (!item.symbol || item.symbol === 'NIFTY 50') continue;
        allEntries.push({
          symbol: item.symbol,
          isin: item.meta?.isin || '',
          companyName: item.meta?.companyName || item.symbol,
          series: 'EQ',
          industry: item.meta?.industry || undefined,
        });
      }
    } catch {
      continue;
    }
  }

  if (allEntries.length < 20) return null;

  const catalog = buildCatalog(allEntries);
  console.log(`[SymbolMaster] Fallback catalog built: ${catalog.symbolCount} symbols from NSE indices`);
  return catalog;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Refresh the symbol master catalog.
 * Fetches NSE CSV → falls back to NSE API indices → stores in Redis.
 * Returns metadata about the refresh.
 */
export async function refreshSymbolMaster(): Promise<SymbolMasterMeta> {
  const startTime = Date.now();
  let catalog: SymbolMasterCatalog | null = null;
  let source: 'nse_csv' | 'fallback' = 'nse_csv';

  // Try CSV first
  catalog = await fetchNseCsvCatalog();

  // Fallback to API indices
  if (!catalog) {
    source = 'fallback';
    catalog = await fetchFallbackCatalog();
  }

  if (!catalog) {
    const meta: SymbolMasterMeta = {
      lastRefresh: Date.now(),
      symbolCount: 0,
      source: 'fallback',
      error: 'All sources failed',
    };
    await kvSet(MASTER_META_KEY, meta, MASTER_TTL);
    return meta;
  }

  // Enrich with sector data from static map
  for (const [sym, sector] of Object.entries(SYMBOL_SECTORS)) {
    if (catalog.entries[sym] && !catalog.entries[sym].industry) {
      catalog.entries[sym].industry = sector;
    }
  }

  // Store in Redis
  await kvSet(MASTER_KEY, catalog, MASTER_TTL);

  const meta: SymbolMasterMeta = {
    lastRefresh: Date.now(),
    symbolCount: catalog.symbolCount,
    source,
  };
  await kvSet(MASTER_META_KEY, meta, MASTER_TTL);

  // Update in-memory cache
  memCatalog = catalog;
  memCatalogLoadedAt = Date.now();

  console.log(`[SymbolMaster] Refresh complete: ${catalog.symbolCount} symbols (${source}) in ${Date.now() - startTime}ms`);
  return meta;
}

/**
 * Load the catalog from Redis into memory.
 * Called lazily by resolve functions. No-op if already fresh.
 */
export async function loadCatalog(): Promise<SymbolMasterCatalog | null> {
  // Return mem cache if fresh
  if (memCatalog && (Date.now() - memCatalogLoadedAt) < MEM_CACHE_TTL) {
    return memCatalog;
  }

  try {
    const catalog = await kvGet<SymbolMasterCatalog>(MASTER_KEY);
    if (catalog && catalog.entries && catalog.symbolCount > 0) {
      memCatalog = catalog;
      memCatalogLoadedAt = Date.now();
      return catalog;
    }
  } catch (e) {
    console.warn('[SymbolMaster] Failed to load catalog from Redis:', e);
  }

  return null;
}

/**
 * Get metadata about the current catalog.
 */
export async function getSymbolMasterMeta(): Promise<SymbolMasterMeta | null> {
  return kvGet<SymbolMasterMeta>(MASTER_META_KEY);
}

// ── Resolution helpers (catalog-aware) ───────────────────────────────────────

/**
 * Look up a symbol in the catalog by NSE ticker.
 * Loads catalog from Redis if needed.
 */
export async function lookupSymbol(nseSymbol: string): Promise<SymbolEntry | null> {
  const upper = nseSymbol.trim().toUpperCase();
  // Check mem cache first
  if (memCatalog?.entries[upper]) return memCatalog.entries[upper];
  // Load from Redis
  const catalog = await loadCatalog();
  return catalog?.entries[upper] || null;
}

/**
 * Look up a symbol by ISIN code.
 */
export async function lookupByIsin(isin: string): Promise<SymbolEntry | null> {
  const upper = isin.trim().toUpperCase();
  const catalog = await loadCatalog();
  if (!catalog) return null;
  const symbol = catalog.isinMap[upper];
  return symbol ? catalog.entries[symbol] || null : null;
}

/**
 * Search symbols by partial name or ticker match.
 * Returns up to `limit` results.
 */
export async function searchSymbols(query: string, limit: number = 10): Promise<SymbolEntry[]> {
  const catalog = await loadCatalog();
  if (!catalog) return [];

  const q = query.trim().toUpperCase();
  const results: SymbolEntry[] = [];

  // Exact ticker match first
  if (catalog.entries[q]) {
    results.push(catalog.entries[q]);
  }

  // Prefix match on symbol
  for (const [sym, entry] of Object.entries(catalog.entries)) {
    if (results.length >= limit) break;
    if (sym.startsWith(q) && sym !== q) {
      results.push(entry);
    }
  }

  // Substring match on company name
  if (results.length < limit) {
    const qLower = query.trim().toLowerCase();
    for (const [name, sym] of Object.entries(catalog.nameIndex)) {
      if (results.length >= limit) break;
      if (name.includes(qLower) && !results.find(r => r.symbol === sym)) {
        const entry = catalog.entries[sym];
        if (entry) results.push(entry);
      }
    }
  }

  return results;
}

/**
 * Validate that a symbol exists in the NSE catalog.
 * Returns true if the symbol is known, false otherwise.
 */
export async function isValidNseSymbol(symbol: string): Promise<boolean> {
  const entry = await lookupSymbol(symbol);
  return entry !== null;
}

/**
 * Get all symbols from the catalog (for bulk operations).
 */
export async function getAllSymbols(): Promise<string[]> {
  const catalog = await loadCatalog();
  if (!catalog) return [];
  return Object.keys(catalog.entries);
}

/**
 * Get catalog stats (for monitoring).
 */
export async function getCatalogStats(): Promise<{
  loaded: boolean;
  symbolCount: number;
  memCacheAge: number | null;
  meta: SymbolMasterMeta | null;
}> {
  const meta = await getSymbolMasterMeta();
  return {
    loaded: memCatalog !== null,
    symbolCount: memCatalog?.symbolCount || 0,
    memCacheAge: memCatalog ? Date.now() - memCatalogLoadedAt : null,
    meta,
  };
}
