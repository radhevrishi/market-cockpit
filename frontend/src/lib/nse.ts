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
export async function nseApiFetch(path: string, cacheTtl = 60000): Promise<any> {
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

// Fetch NIFTY Microcap 250
export async function fetchNiftyMicrocap250() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20MICROCAP%20250', 60000);
}

// Fetch NIFTY Total Market
export async function fetchNiftyTotalMarket() {
  return nseApiFetch('/api/equity-stockIndices?index=NIFTY%20TOTAL%20MARKET', 60000);
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
// NSE returns recent board meeting intimations
export async function fetchBoardMeetings() {
  return nseApiFetch('/api/corporate-board-meetings?index=equities', 600000); // 10min cache
}

// Helper: convert DD-MM-YYYY to DD-Mon-YYYY (NSE's preferred format)
function toNSEMonthDate(ddmmyyyy: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return ddmmyyyy;
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return ddmmyyyy;
  return `${parts[0]}-${months[monthIdx]}-${parts[2]}`;
}

// Fetch quarterly financial results
// Try multiple date format patterns and periods
export async function fetchFinancialResults(fromDate: string, toDate: string) {
  // NSE financial results API uses DD-Mon-YYYY format (e.g., "01-Mar-2026")
  const fromMon = toNSEMonthDate(fromDate);
  const toMon = toNSEMonthDate(toDate);

  // Try DD-Mon-YYYY format with Quarterly period
  const result = await nseApiFetch(`/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${fromMon}&to_date=${toMon}`, 600000);
  if (result && (Array.isArray(result) ? result.length > 0 : result?.data?.length > 0)) {
    return result;
  }
  // Try DD-Mon-YYYY without period filter
  const result2 = await nseApiFetch(`/api/corporates-financial-results?index=equities&from_date=${fromMon}&to_date=${toMon}`, 600000);
  if (result2 && (Array.isArray(result2) ? result2.length > 0 : result2?.data?.length > 0)) {
    return result2;
  }
  // Fallback: try DD-MM-YYYY format
  const result3 = await nseApiFetch(`/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${fromDate}&to_date=${toDate}`, 600000);
  if (result3 && (Array.isArray(result3) ? result3.length > 0 : result3?.data?.length > 0)) {
    return result3;
  }
  const result4 = await nseApiFetch(`/api/corporates-financial-results?index=equities&from_date=${fromDate}&to_date=${toDate}`, 600000);
  return result4;
}

// Fetch financial results for broader coverage - try different endpoints
export async function fetchLatestFinancialResults() {
  // This endpoint might return the most recent results without date filter
  return nseApiFetch('/api/corporates-financial-results?index=equities', 600000);
}

// Fetch financial results for a specific company (for enriching announcements)
export async function fetchCompanyFinancialResults(symbol: string) {
  return nseApiFetch(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}`, 300000);
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

// Fetch corporate announcements filtered by category (Board Meetings with Financial Results)
export async function fetchBoardMeetingAnnouncements(index: string = 'equities') {
  // NSE corporate-announcements endpoint - default returns latest 20
  return nseApiFetch(`/api/corporate-announcements?index=${encodeURIComponent(index)}`, 600000); // 10 min cache
}

// Fetch corporate announcements with pagination - NSE returns pages of results
// from_date/to_date in DD-MM-YYYY format
export async function fetchCorporateAnnouncementsPaginated(fromDate: string, toDate: string, pages: number = 5): Promise<any[]> {
  const allResults: any[] = [];

  for (let page = 0; page < pages; page++) {
    const data = await nseApiFetch(
      `/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}&page=${page}`,
      600000
    );
    if (!data) break;
    const arr = Array.isArray(data) ? data : (data?.data || []);
    if (arr.length === 0) break;
    allResults.push(...arr);
    // If we got fewer than 20, likely no more pages
    if (arr.length < 20) break;
  }

  return allResults;
}

// Fetch board meetings for specific date range
export async function fetchBoardMeetingsForDateRange(fromDate: string, toDate: string) {
  return nseApiFetch(`/api/corporate-board-meetings?index=equities&from_date=${fromDate}&to_date=${toDate}`, 600000);
}

// Fetch from BSE corporate announcements for cross-validation
export async function fetchBseBoardMeetings() {
  const url = '/BseIndiaAPI/api/AnnGetData/w?strCat=Board%20Meeting&strPrevDate=&strScrip=&strSearch=P&strToDate=&strType=C';
  const cacheKey = `bse:board-meetings`;
  const cached = getCached(cacheKey, 600000);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.bseindia.com${url}`, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': 'application/json',
        'Referer': 'https://www.bseindia.com/',
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

// BSE Results Announcements (companies that have declared results)
export async function fetchBseResults() {
  return bseApiFetch('/AnnGetData/w?strCat=Result&strPrevDate=&strScrip=&strSearch=P&strToDate=&strType=C', 600000);
}

// BSE Forthcoming Results (upcoming results calendar)
export async function fetchBseForthcomingResults() {
  return bseApiFetch('/Forth_Results/GetForthData?flag=0', 600000);
}

// BSE Board Meetings with date range
export async function fetchBseBoardMeetingsDateRange(fromDate: string, toDate: string) {
  return bseApiFetch(`/AnnGetData/w?strCat=Board+Meeting&strPrevDate=${encodeURIComponent(fromDate)}&strScrip=&strSearch=P&strToDate=${encodeURIComponent(toDate)}&strType=C`, 600000);
}

// BSE Corporate Announcements - Results category with date range
export async function fetchBseResultsDateRange(fromDate: string, toDate: string) {
  return bseApiFetch(`/AnnGetData/w?strCat=Result&strPrevDate=${encodeURIComponent(fromDate)}&strScrip=&strSearch=P&strToDate=${encodeURIComponent(toDate)}&strType=C`, 600000);
}

// ======= SECTOR NORMALIZATION =======

// Normalize granular NSE industry names to ~12 broad sectors
// This keeps the sector count manageable for heatmap, movers, and RRG displays
export function normalizeSector(industry: string | undefined): string {
  if (!industry) return 'Other';
  const i = industry.toLowerCase();

  // Banking & Finance (banks, NBFC, insurance, asset management, fintech)
  if (i.includes('bank') || i.includes('housing finance') || i.includes('nbfc') || i.includes('micro finance') || i.includes('insurance') || i.includes('asset management') || i.includes('stock exchange') || i.includes('exchange and data') || i.includes('fintech') || i.includes('financial') || i.includes('capital market')) return 'Banking & Finance';

  // IT & Technology
  if (i.includes('it ') || i.includes('software') || i.includes('computer') || i.includes('digital') || i.includes('technology') || i === 'it') return 'IT';

  // Healthcare & Pharma
  if (i.includes('pharma') || i.includes('drug') || i.includes('healthcare') || i.includes('hospital') || i.includes('diagnostic') || i.includes('medical')) return 'Healthcare';

  // Energy (oil, gas, power, renewables)
  if (i.includes('oil') || i.includes('gas') || i.includes('refiner') || i.includes('petroleum') || i.includes('lng') || i.includes('power') || i.includes('electric') || i.includes('renewable') || i.includes('solar') || i.includes('wind') || i.includes('energy')) return 'Energy';

  // Metals & Mining (steel, metals, cement, chemicals)
  if (i.includes('steel') || i.includes('metal') || i.includes('iron') || i.includes('aluminium') || i.includes('copper') || i.includes('zinc') || i.includes('mining') || i.includes('coal') || i.includes('cement') || i.includes('building material') || i.includes('construction material')) return 'Metals & Mining';
  if (i.includes('chemical') || i.includes('fertilizer') || i.includes('pesticide') || i.includes('agrochemical') || i.includes('petrochemical')) return 'Metals & Mining';

  // FMCG (food, beverages, personal care, consumer staples)
  if (i.includes('fmcg') || i.includes('food') || i.includes('beverage') || i.includes('personal care') || i.includes('tobacco') || i.includes('consumer food')) return 'FMCG';

  // Consumer (retail, textiles, hospitality, durables, media)
  if (i.includes('retail') || i.includes('e-commerce') || i.includes('textile') || i.includes('apparel') || i.includes('footwear') || i.includes('hotel') || i.includes('restaurant') || i.includes('hospitality') || i.includes('consumer durable') || i.includes('consumer disc')) return 'Consumer';

  // Media & Telecom
  if (i.includes('media') || i.includes('entertainment') || i.includes('broadcasting') || i.includes('film') || i.includes('telecom') || i.includes('communication')) return 'Media & Telecom';

  // Auto
  if (i.includes('auto') || i.includes('car') || i.includes('vehicle') || i.includes('tyre') || i.includes('tire') || i.includes('tractor')) return 'Auto';

  // Capital Goods & Industrials (engineering, defence, transport)
  if (i.includes('capital good') || i.includes('engineering') || i.includes('industrial') || i.includes('compressor') || i.includes('bearing') || i.includes('defence') || i.includes('defense') || i.includes('aerospace') || i.includes('railway') || i.includes('logistics') || i.includes('shipping') || i.includes('transport') || i.includes('airline') || i.includes('port')) return 'Capital Goods';

  // Infrastructure & Real Estate
  if (i.includes('infra') || i.includes('construction') || i.includes('road') || i.includes('civil') || i.includes('real estate') || i.includes('realty')) return 'Infrastructure';

  // Diversified
  if (i.includes('diversified') || i.includes('conglomerate') || i.includes('holding')) return 'Diversified';

  return 'Other';
}

// ======= DYNAMIC SECTOR MAPPING =======

// Build sector mapping dynamically from NSE sector indices
// Consolidated to ~12 broad sectors for clean heatmap/movers display
const sectorIndexMap: Record<string, string> = {
  'NIFTY IT': 'IT',
  'NIFTY BANK': 'Banking & Finance',
  'NIFTY FINANCIAL SERVICES': 'Banking & Finance',
  'NIFTY PSU BANK': 'Banking & Finance',
  'NIFTY PHARMA': 'Healthcare',
  'NIFTY HEALTHCARE INDEX': 'Healthcare',
  'NIFTY AUTO': 'Auto',
  'NIFTY METAL': 'Metals & Mining',
  'NIFTY ENERGY': 'Energy',
  'NIFTY OIL & GAS': 'Energy',
  'NIFTY FMCG': 'FMCG',
  'NIFTY REALTY': 'Real Estate',
  'NIFTY MEDIA': 'Media & Telecom',
  'NIFTY PSE': 'Capital Goods',
  'NIFTY CPSE': 'Capital Goods',
  'NIFTY INFRA': 'Infrastructure',
  'NIFTY COMMODITIES': 'Metals & Mining',
  'NIFTY CONSUMER DURABLES': 'Consumer',
  'NIFTY CONSUMPTION': 'Consumer',
  'NIFTY MNC': 'Diversified',
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

// Static sector mapping using consolidated ~12 broad sectors
// Used as fallback when dynamic sector map is unavailable
export const NIFTY50_SECTORS: Record<string, string> = {
  // NIFTY 50 stocks
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
  // NIFTY Next 50 and extended stocks
  'ADANIGREEN': 'Energy', 'ADANIPOWER': 'Energy', 'AMBUJACEM': 'Metals & Mining',
  'BANKBARODA': 'Banking & Finance', 'BERGEPAINT': 'Consumer', 'BOSCHLTD': 'Auto',
  'CANBK': 'Banking & Finance', 'CHOLAFIN': 'Banking & Finance', 'COLPAL': 'FMCG',
  'DABUR': 'FMCG', 'DLF': 'Infrastructure', 'GODREJCP': 'FMCG',
  'HAVELLS': 'Consumer', 'ICICIPRULI': 'Banking & Finance', 'IDFC': 'Banking & Finance',
  'INDHOTEL': 'Consumer', 'IOC': 'Energy', 'IRCTC': 'Capital Goods',
  'JINDALSTEL': 'Metals & Mining', 'LICHSGFIN': 'Banking & Finance', 'LICI': 'Banking & Finance',
  'LODHA': 'Infrastructure', 'LUPIN': 'Healthcare', 'MARICO': 'FMCG',
  'MOTHERSON': 'Auto', 'NAUKRI': 'IT', 'NHPC': 'Energy',
  'OBEROIRLTY': 'Infrastructure', 'OFSS': 'IT', 'PEL': 'Banking & Finance',
  'PERSISTENT': 'IT', 'PETRONET': 'Energy', 'PIDILITIND': 'Metals & Mining',
  'PNB': 'Banking & Finance', 'POLYCAB': 'Consumer', 'SRF': 'Metals & Mining',
  'TATACOMM': 'Media & Telecom', 'TATAPOWER': 'Energy', 'TORNTPHARM': 'Healthcare',
  'TRENT': 'Consumer', 'UNIONBANK': 'Banking & Finance', 'UNITDSPR': 'FMCG',
  'VEDL': 'Metals & Mining', 'ZOMATO': 'Consumer', 'ZYDUSLIFE': 'Healthcare',
  'ABB': 'Capital Goods', 'ACC': 'Metals & Mining', 'ATGL': 'Energy',
  'AUROPHARMA': 'Healthcare', 'BHEL': 'Capital Goods', 'BIOCON': 'Healthcare',
  'CGPOWER': 'Capital Goods', 'CONCOR': 'Capital Goods', 'CUMMINSIND': 'Capital Goods',
  'DELHIVERY': 'Capital Goods', 'ESCORTS': 'Auto', 'GAIL': 'Energy',
  'GMRINFRA': 'Infrastructure', 'HAL': 'Capital Goods', 'ICICIGI': 'Banking & Finance',
  'IDEA': 'Media & Telecom', 'IGL': 'Energy', 'IPCALAB': 'Healthcare',
  'IRFC': 'Banking & Finance', 'JIOFIN': 'Banking & Finance', 'MAXHEALTH': 'Healthcare',
  'MPHASIS': 'IT', 'MUTHOOTFIN': 'Banking & Finance', 'PAGEIND': 'Consumer',
  'PIIND': 'Metals & Mining', 'RECLTD': 'Banking & Finance', 'SAIL': 'Metals & Mining',
  'SIEMENS': 'Capital Goods', 'SJVN': 'Energy', 'SOLARINDS': 'Metals & Mining',
  'SUPREMEIND': 'Metals & Mining', 'TATAELXSI': 'IT', 'TIINDIA': 'Auto',
  'TORNTPOWER': 'Energy', 'UPL': 'Metals & Mining', 'VOLTAS': 'Consumer',
};
