// NSE India API scraper - fetches live data directly from NSE website
// NSE requires cookies from the main page before API calls work

const NSE_BASE = 'https://www.nseindia.com';

// Cache for cookies and data
let nseCookies: string = '';
let cookieExpiry: number = 0;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.nseindia.com/',
  'Connection': 'keep-alive',
};

// In-memory data cache
const dataCache = new Map<string, { data: any; ts: number }>();

function getCached(key: string, ttlMs: number): any | null {
  const entry = dataCache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}

function setCache(key: string, data: any) {
  dataCache.set(key, { data, ts: Date.now() });
  if (dataCache.size > 500) {
    const oldest = [...dataCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) dataCache.delete(oldest[i][0]);
  }
}

// Step 1: Get NSE cookies by visiting the homepage
async function refreshCookies(): Promise<string> {
  if (nseCookies && Date.now() < cookieExpiry) return nseCookies;

  try {
    const res = await fetch(NSE_BASE, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    const cookies = res.headers.getSetCookie?.() || [];
    nseCookies = cookies.map((c: string) => c.split(';')[0]).join('; ');
    cookieExpiry = Date.now() + 10 * 60 * 1000; // 10 min
    return nseCookies;
  } catch {
    return '';
  }
}

// Generic NSE API fetch with cookie handling
async function nseApiFetch(path: string, cacheTtl = 60000): Promise<any> {
  const cacheKey = `nse:${path}`;
  const cached = getCached(cacheKey, cacheTtl);
  if (cached) return cached;

  const cookies = await refreshCookies();

  try {
    const res = await fetch(`${NSE_BASE}${path}`, {
      headers: {
        ...HEADERS,
        Cookie: cookies,
      },
    });

    if (!res.ok) {
      // If 403/401, refresh cookies and retry once
      if (res.status === 403 || res.status === 401) {
        nseCookies = '';
        cookieExpiry = 0;
        const newCookies = await refreshCookies();
        const retry = await fetch(`${NSE_BASE}${path}`, {
          headers: { ...HEADERS, Cookie: newCookies },
        });
        if (retry.ok) {
          const data = await retry.json();
          setCache(cacheKey, data);
          return data;
        }
      }
      return null;
    }

    const data = await res.json();
    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

// ======= PUBLIC API FUNCTIONS =======

// Fetch NIFTY 50 stocks with live prices
export async function fetchNifty50() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%2050', 60000);
}

// Fetch NIFTY Bank stocks
export async function fetchNiftyBank() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20BANK', 60000);
}

// Fetch NIFTY Next 50 stocks
export async function fetchNiftyNext50() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20NEXT%2050', 60000);
}

// Fetch NIFTY Midcap 50
export async function fetchNiftyMidcap50() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20MIDCAP%2050', 60000);
}

// Fetch NIFTY 200
export async function fetchNifty200() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20200', 60000);
}

// Fetch NIFTY 500 stocks (broad market)
export async function fetchNifty500() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20500', 60000);
}

// Fetch NIFTY Midcap 250
export async function fetchNiftyMidcap250() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20MIDCAP%20250', 60000);
}

// Fetch NIFTY Smallcap 250
export async function fetchNiftySmallcap250() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20SMALLCAP%20250', 60000);
}

// Fetch all indices
export async function fetchAllIndices() {
  return nseApiFetch('/api/allIndices', 60000);
}

// Fetch top gainers
export async function fetchGainers() {
  return nseApiFetch('/api/live-analysis-variations?index=gainers', 60000);
}

// Fetch top losers
export async function fetchLosers() {
  return nseApiFetch('/api/live-analysis-variations?index=losers', 60000);
}

// Fetch current IPOs
export async function fetchCurrentIPOs() {
  return nseApiFetch('/api/ipo-current-issue', 300000); // 5 min cache
}

// Fetch upcoming IPOs
export async function fetchUpcomingIPOs() {
  return nseApiFetch('/api/ipo-upcoming-issue', 300000);
}

// Fetch past IPOs
export async function fetchPastIPOs() {
  return nseApiFetch('/api/ipo-past-issue', 600000); // 10 min cache
}

// Fetch event calendar
export async function fetchEventCalendar() {
  return nseApiFetch('/api/event-calendar', 300000);
}

// Fetch corporate actions (dividends, bonuses, splits)
export async function fetchCorporateActions(from: string, to: string) {
  return nseApiFetch(`/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}`, 300000);
}

// Fetch market status
export async function fetchMarketStatus() {
  return nseApiFetch('/api/marketStatus', 60000);
}

// Fetch sector indices performance
export async function fetchSectorIndices() {
  return nseApiFetch('/api/allIndices', 60000);
}

// Fetch pre-open market data
export async function fetchPreOpen() {
  return nseApiFetch('/api/market-data-pre-open?key=NIFTY', 60000);
}

// ======= EARNINGS & FINANCIAL DATA =======

// Fetch board meetings (earnings announcement dates)
export async function fetchBoardMeetings() {
  return nseApiFetch('/api/corporate-board-meetings?index=equities', 3600000); // 1hr cache
}

// Fetch quarterly financial results
export async function fetchFinancialResults(fromDate: string, toDate: string) {
  return nseApiFetch(`/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${fromDate}&to_date=${toDate}`, 3600000);
}

// Fetch individual stock detailed quote
export async function fetchStockQuote(symbol: string) {
  return nseApiFetch(`/api/quote-equity?symbol=${encodeURIComponent(symbol)}`, 300000);
}

// Fetch stock chart data for historical prices
export async function fetchStockChart(symbol: string) {
  return nseApiFetch(`/api/chart-databyindex?index=${encodeURIComponent(symbol)}EQN`, 300000);
}

// Fetch corporate announcements for a company
export async function fetchCorporateAnnouncements(symbol: string) {
  return nseApiFetch(`/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`, 1800000);
}

// ======= SECTOR NORMALIZATION =======

// Normalize granular NSE industry names to broad sectors
export function normalizeSector(industry: string | undefined): string {
  if (!industry) return 'Other';
  const i = industry.toLowerCase();
  
  // Banking & Finance
  if (i.includes('bank') || i.includes('housing finance') || i.includes('nbfc') || i.includes('micro finance')) return 'Banking';
  if (i.includes('insurance')) return 'Insurance';
  if (i.includes('asset management') || i.includes('stock exchange') || i.includes('exchange and data') || i.includes('fintech') || i.includes('financial') || i.includes('capital market')) return 'Financial Services';
  
  // Technology
  if (i.includes('it ') || i.includes('software') || i.includes('computer') || i.includes('digital') || i.includes('technology') || i === 'it') return 'IT';
  if (i.includes('telecom') || i.includes('communication')) return 'Telecom';
  
  // Healthcare & Pharma  
  if (i.includes('pharma') || i.includes('drug') || i.includes('healthcare') || i.includes('hospital') || i.includes('diagnostic') || i.includes('medical')) return 'Healthcare';
  
  // Energy & Power
  if (i.includes('oil') || i.includes('gas') || i.includes('refiner') || i.includes('petroleum') || i.includes('lng')) return 'Energy';
  if (i.includes('power') || i.includes('electric') || i.includes('renewable') || i.includes('solar') || i.includes('wind') || i.includes('energy')) return 'Power';
  
  // Materials & Metals
  if (i.includes('steel') || i.includes('metal') || i.includes('iron') || i.includes('aluminium') || i.includes('copper') || i.includes('zinc') || i.includes('mining') || i.includes('coal')) return 'Metals & Mining';
  if (i.includes('cement') || i.includes('building material') || i.includes('construction material')) return 'Cement';
  if (i.includes('chemical') || i.includes('fertilizer') || i.includes('pesticide') || i.includes('agrochemical') || i.includes('petrochemical')) return 'Chemicals';
  
  // Consumer
  if (i.includes('fmcg') || i.includes('food') || i.includes('beverage') || i.includes('personal care') || i.includes('tobacco') || i.includes('consumer food')) return 'FMCG';
  if (i.includes('retail') || i.includes('e-commerce') || i.includes('e-retail') || i.includes('departmental')) return 'Retail';
  if (i.includes('textile') || i.includes('apparel') || i.includes('readymade') || i.includes('footwear')) return 'Textiles';
  if (i.includes('hotel') || i.includes('restaurant') || i.includes('tourism') || i.includes('hospitality')) return 'Hospitality';
  if (i.includes('media') || i.includes('entertainment') || i.includes('broadcasting') || i.includes('printing') || i.includes('film')) return 'Media';
  
  // Auto & Transport
  if (i.includes('auto') || i.includes('car') || i.includes('vehicle') || i.includes('tyre') || i.includes('tire') || i.includes('tractor')) return 'Auto';
  if (i.includes('railway') || i.includes('logistics') || i.includes('shipping') || i.includes('transport') || i.includes('airline') || i.includes('port')) return 'Transport & Logistics';
  
  // Industrial  
  if (i.includes('capital good') || i.includes('engineering') || i.includes('industrial') || i.includes('compressor') || i.includes('bearing') || i.includes('electrode') || i.includes('abrasive')) return 'Capital Goods';
  if (i.includes('infra') || i.includes('construction') || i.includes('road') || i.includes('civil')) return 'Infrastructure';
  if (i.includes('defence') || i.includes('defense') || i.includes('aerospace') || i.includes('ship building')) return 'Defence';
  
  // Real Estate
  if (i.includes('real estate') || i.includes('realty') || i.includes('housing') && !i.includes('finance')) return 'Real Estate';
  
  // Diversified/Conglomerate
  if (i.includes('diversified') || i.includes('conglomerate') || i.includes('holding')) return 'Diversified';
  
  // If none matched, return original but capitalized
  return 'Other';
}

// ======= DYNAMIC SECTOR MAPPING =======

// Build sector mapping dynamically from NSE sector indices
const sectorIndexMap: Record<string, string> = {
  'NIFTY IT': 'IT',
  'NIFTY BANK': 'Banking',
  'NIFTY FINANCIAL SERVICES': 'Financial Services',
  'NIFTY PHARMA': 'Healthcare',
  'NIFTY AUTO': 'Auto',
  'NIFTY METAL': 'Metals & Mining',
  'NIFTY ENERGY': 'Energy',
  'NIFTY FMCG': 'FMCG',
  'NIFTY REALTY': 'Real Estate',
  'NIFTY MEDIA': 'Media',
  'NIFTY PSE': 'PSE',
  'NIFTY INFRA': 'Infrastructure',
  'NIFTY COMMODITIES': 'Commodities',
  'NIFTY HEALTHCARE INDEX': 'Healthcare',
  'NIFTY CONSUMER DURABLES': 'Consumer Durables',
  'NIFTY OIL & GAS': 'Energy',
  'NIFTY CPSE': 'PSE',
  'NIFTY MNC': 'MNC',
};

let dynamicSectorCache: Record<string, string> | null = null;
let sectorCacheTime = 0;

export async function buildDynamicSectorMap(): Promise<Record<string, string>> {
  // Cache for 24 hours
  if (dynamicSectorCache && Date.now() - sectorCacheTime < 86400000) {
    return dynamicSectorCache;
  }

  const sectorMap: Record<string, string> = {};

  try {
    // Fetch each sector index and map its stocks
    const sectorFetches = Object.entries(sectorIndexMap).map(async ([indexName, sectorLabel]) => {
      try {
        const data = await nseApiFetch(
          `/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`,
          86400000 // 24hr cache for sector membership
        );
        if (data && data.data) {
          for (const item of data.data) {
            if (item.symbol && !sectorMap[item.symbol]) {
              sectorMap[item.symbol] = sectorLabel;
            }
          }
        }
      } catch {}
    });

    await Promise.all(sectorFetches);
    dynamicSectorCache = sectorMap;
    sectorCacheTime = Date.now();
  } catch {}

  return sectorMap;
}

// Backwards-compatible helper - tries dynamic first, falls back to static
export async function getSectorForSymbol(symbol: string): Promise<string> {
  const map = await buildDynamicSectorMap();
  return map[symbol] || NIFTY50_SECTORS[symbol] || 'Other';
}

// ======= BSE API FUNCTIONS =======

const BSE_BASE = 'https://api.bseindia.com/BseIndiaAPI/api';

async function bseApiFetch(path: string, cacheTtl = 60000): Promise<any> {
  const cacheKey = `bse:${path}`;
  const cached = getCached(cacheKey, cacheTtl);
  if (cached) return cached;

  try {
    const res = await fetch(`${BSE_BASE}${path}`, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': 'application/json',
        'Referer': 'https://www.bseindia.com/',
        'Origin': 'https://www.bseindia.com',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

// BSE Sensex data
export async function fetchSensex() {
  return bseApiFetch('/Sensex/SensexData/?json=1', 60000);
}

// BSE Top Gainers
export async function fetchBseGainers() {
  return bseApiFetch('/MktRGainerLoser/w?GLtype=gainer&flag=0&orderby=chng', 60000);
}

// BSE Top Losers
export async function fetchBseLosers() {
  return bseApiFetch('/MktRGainerLoser/w?GLtype=loser&flag=0&orderby=chng', 60000);
}

// BSE IPO data
export async function fetchBseIPO() {
  return bseApiFetch('/IPODetail/w?type=current', 300000);
}

// ======= COMBINED FETCH HELPERS =======

// Get comprehensive NIFTY 50 data for Movers/Heatmap pages
export async function getIndianMarketData() {
  const [nifty50, gainers, losers, allIndices] = await Promise.all([
    fetchNifty50(),
    fetchGainers(),
    fetchLosers(),
    fetchAllIndices(),
  ]);

  return { nifty50, gainers, losers, allIndices };
}

// Get IPO data from both NSE and BSE
export async function getIPOData() {
  const [current, upcoming, past, bseIPO] = await Promise.all([
    fetchCurrentIPOs(),
    fetchUpcomingIPOs(),
    fetchPastIPOs(),
    fetchBseIPO(),
  ]);

  return { current, upcoming, past, bseIPO };
}

// Sector mapping for NIFTY 50 and extended stocks (NIFTY Next 50, etc.)
export const NIFTY50_SECTORS: Record<string, string> = {
  // NIFTY 50 stocks
  'RELIANCE': 'Energy',
  'TCS': 'IT',
  'HDFCBANK': 'Banking',
  'INFY': 'IT',
  'ICICIBANK': 'Banking',
  'HINDUNILVR': 'FMCG',
  'ITC': 'FMCG',
  'SBIN': 'Banking',
  'BHARTIARTL': 'Telecom',
  'KOTAKBANK': 'Banking',
  'LT': 'Capital Goods',
  'HCLTECH': 'IT',
  'AXISBANK': 'Banking',
  'ASIANPAINT': 'Consumer Durables',
  'MARUTI': 'Auto',
  'SUNPHARMA': 'Healthcare',
  'TITAN': 'Consumer Durables',
  'BAJFINANCE': 'Financial Services',
  'DMART': 'Retail',
  'ULTRACEMCO': 'Cement',
  'NTPC': 'Power',
  'ONGC': 'Energy',
  'NESTLEIND': 'FMCG',
  'WIPRO': 'IT',
  'M&M': 'Auto',
  'JSWSTEEL': 'Metals & Mining',
  'POWERGRID': 'Power',
  'TATASTEEL': 'Metals & Mining',
  'TATAMOTORS': 'Auto',
  'ADANIENT': 'Diversified',
  'ADANIPORTS': 'Infrastructure',
  'DIVISLAB': 'Healthcare',
  'COALINDIA': 'Metals & Mining',
  'BAJAJFINSV': 'Financial Services',
  'TECHM': 'IT',
  'DRREDDY': 'Healthcare',
  'CIPLA': 'Healthcare',
  'BRITANNIA': 'FMCG',
  'APOLLOHOSP': 'Healthcare',
  'EICHERMOT': 'Auto',
  'TATACONSUM': 'FMCG',
  'GRASIM': 'Cement',
  'INDUSINDBK': 'Banking',
  'BPCL': 'Energy',
  'HEROMOTOCO': 'Auto',
  'SBILIFE': 'Insurance',
  'HDFCLIFE': 'Insurance',
  'BAJAJ-AUTO': 'Auto',
  'HINDALCO': 'Metals & Mining',
  'SHRIRAMFIN': 'Financial Services',
  // NIFTY Next 50 and other extended stocks
  'ADANIGREEN': 'Energy',
  'ADANIPOWER': 'Power',
  'AMBUJACEM': 'Cement',
  'BANKBARODA': 'Banking',
  'BERGEPAINT': 'Consumer Durables',
  'BOSCHLTD': 'Auto',
  'CANBK': 'Banking',
  'CHOLAFIN': 'Financial Services',
  'COLPAL': 'FMCG',
  'DABUR': 'FMCG',
  'DLF': 'Real Estate',
  'GODREJCP': 'FMCG',
  'HAVELLS': 'Consumer Durables',
  'ICICIPRULI': 'Insurance',
  'IDFC': 'Financial Services',
  'INDHOTEL': 'Hospitality',
  'IOC': 'Energy',
  'IRCTC': 'Transport & Logistics',
  'JINDALSTEL': 'Metals & Mining',
  'LICHSGFIN': 'Financial Services',
  'LICI': 'Insurance',
  'LODHA': 'Real Estate',
  'LUPIN': 'Healthcare',
  'MARICO': 'FMCG',
  'MOTHERSON': 'Auto',
  'NAUKRI': 'IT',
  'NHPC': 'Power',
  'OBEROIRLTY': 'Real Estate',
  'OFSS': 'IT',
  'PEL': 'Financial Services',
  'PERSISTENT': 'IT',
  'PETRONET': 'Energy',
  'PIDILITIND': 'Chemicals',
  'PNB': 'Banking',
  'POLYCAB': 'Consumer Durables',
  'SRF': 'Chemicals',
  'TATACOMM': 'Telecom',
  'TATAPOWER': 'Power',
  'TORNTPHARM': 'Healthcare',
  'TRENT': 'Retail',
  'UNIONBANK': 'Banking',
  'UNITDSPR': 'FMCG',
  'VEDL': 'Metals & Mining',
  'ZOMATO': 'Consumer Services',
  'ZYDUSLIFE': 'Healthcare',
  'ABB': 'Capital Goods',
  'ACC': 'Cement',
  'ATGL': 'Energy',
  'AUROPHARMA': 'Healthcare',
  'BHEL': 'Capital Goods',
  'BIOCON': 'Healthcare',
  'CGPOWER': 'Capital Goods',
  'CONCOR': 'Transport & Logistics',
  'CUMMINSIND': 'Capital Goods',
  'DELHIVERY': 'Transport & Logistics',
  'ESCORTS': 'Auto',
  'GAIL': 'Energy',
  'GMRINFRA': 'Infrastructure',
  'HAL': 'Defence',
  'ICICIGI': 'Insurance',
  'IDEA': 'Telecom',
  'IGL': 'Energy',
  'IPCALAB': 'Healthcare',
  'IRFC': 'Financial Services',
  'JIOFIN': 'Financial Services',
  'MAXHEALTH': 'Healthcare',
  'MPHASIS': 'IT',
  'MUTHOOTFIN': 'Financial Services',
  'PAGEIND': 'Textiles',
  'PIIND': 'Chemicals',
  'RECLTD': 'Financial Services',
  'SAIL': 'Metals & Mining',
  'SIEMENS': 'Capital Goods',
  'SJVN': 'Power',
  'SOLARINDS': 'Chemicals',
  'SUPREMEIND': 'Chemicals',
  'TATAELXSI': 'IT',
  'TIINDIA': 'Auto',
  'TORNTPOWER': 'Power',
  'UPL': 'Chemicals',
  'VOLTAS': 'Consumer Durables',
};
