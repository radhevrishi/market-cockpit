// Yahoo Finance API utility for server-side data fetching
// Uses the v8 chart API and v7 quote API

const YF_BASE = 'https://query1.finance.yahoo.com';
const YF_BASE2 = 'https://query2.finance.yahoo.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// In-memory cache
const cache = new Map<string, { data: any; ts: number }>();

function getCached(key: string, ttlMs: number): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
  // Prevent unbounded growth
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) cache.delete(oldest[i][0]);
  }
}

// Fetch a single quote using v8 chart API
export async function fetchChart(symbol: string, range = '1d', interval = '1d') {
  const cacheKey = `chart:${symbol}:${range}:${interval}`;
  const cached = getCached(cacheKey, 5 * 60 * 1000); // 5 min cache
  if (cached) return cached;

  try {
    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const data = {
      symbol: meta.symbol,
      shortName: meta.shortName || meta.symbol,
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose || meta.chartPreviousClose,
      change: meta.regularMarketPrice - (meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice),
      changePercent: meta.previousClose
        ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100
        : 0,
      volume: meta.regularMarketVolume || 0,
      marketCap: 0, // not available in chart API
      timestamps: result.timestamp || [],
      closes: result.indicators?.quote?.[0]?.close || [],
    };

    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

// Batch fetch quotes using v7 quote API (more efficient for multiple symbols)
export async function fetchQuotes(symbols: string[]): Promise<any[]> {
  if (symbols.length === 0) return [];

  const cacheKey = `quotes:${symbols.sort().join(',')}`;
  const cached = getCached(cacheKey, 5 * 60 * 1000);
  if (cached) return cached;

  try {
    // Split into chunks of 20 to avoid URL length limits
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += 20) {
      chunks.push(symbols.slice(i, i + 20));
    }

    const allResults: any[] = [];
    for (const chunk of chunks) {
      const symbolStr = chunk.join(',');
      const url = `${YF_BASE2}/v7/finance/quote?symbols=${encodeURIComponent(symbolStr)}`;
      const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } });
      if (res.ok) {
        const json = await res.json();
        const results = json?.quoteResponse?.result || [];
        allResults.push(...results);
      }
    }

    setCache(cacheKey, allResults);
    return allResults;
  } catch {
    return [];
  }
}

// Fetch quotes with fallback to chart API
export async function fetchQuotesWithFallback(symbols: string[]): Promise<any[]> {
  // Try batch v7 first
  let results = await fetchQuotes(symbols);

  if (results.length > 0) return results;

  // Fallback: fetch individually via chart API (slower but more reliable)
  const promises = symbols.map(async (sym) => {
    const chart = await fetchChart(sym);
    if (!chart) return null;
    return {
      symbol: chart.symbol,
      shortName: chart.shortName,
      regularMarketPrice: chart.regularMarketPrice,
      regularMarketChange: chart.change,
      regularMarketChangePercent: chart.changePercent,
      regularMarketVolume: chart.volume,
      regularMarketPreviousClose: chart.previousClose,
      marketCap: 0,
    };
  });

  const individual = await Promise.all(promises);
  return individual.filter(Boolean);
}

// NIFTY 50 constituents with sectors
export const NIFTY50: { ticker: string; company: string; sector: string }[] = [
  { ticker: 'RELIANCE.NS', company: 'Reliance Industries', sector: 'Energy' },
  { ticker: 'TCS.NS', company: 'Tata Consultancy Services', sector: 'IT' },
  { ticker: 'HDFCBANK.NS', company: 'HDFC Bank', sector: 'Banking' },
  { ticker: 'INFY.NS', company: 'Infosys', sector: 'IT' },
  { ticker: 'ICICIBANK.NS', company: 'ICICI Bank', sector: 'Banking' },
  { ticker: 'HINDUNILVR.NS', company: 'Hindustan Unilever', sector: 'FMCG' },
  { ticker: 'ITC.NS', company: 'ITC', sector: 'FMCG' },
  { ticker: 'SBIN.NS', company: 'State Bank of India', sector: 'Banking' },
  { ticker: 'BHARTIARTL.NS', company: 'Bharti Airtel', sector: 'Telecom' },
  { ticker: 'KOTAKBANK.NS', company: 'Kotak Mahindra Bank', sector: 'Banking' },
  { ticker: 'LT.NS', company: 'Larsen & Toubro', sector: 'Capital Goods' },
  { ticker: 'HCLTECH.NS', company: 'HCL Technologies', sector: 'IT' },
  { ticker: 'AXISBANK.NS', company: 'Axis Bank', sector: 'Banking' },
  { ticker: 'ASIANPAINT.NS', company: 'Asian Paints', sector: 'Consumer Durables' },
  { ticker: 'MARUTI.NS', company: 'Maruti Suzuki', sector: 'Auto' },
  { ticker: 'SUNPHARMA.NS', company: 'Sun Pharma', sector: 'Pharma' },
  { ticker: 'TITAN.NS', company: 'Titan Company', sector: 'Consumer Durables' },
  { ticker: 'BAJFINANCE.NS', company: 'Bajaj Finance', sector: 'Financial Services' },
  { ticker: 'DMART.NS', company: 'Avenue Supermarts', sector: 'Retail' },
  { ticker: 'ULTRACEMCO.NS', company: 'UltraTech Cement', sector: 'Cement' },
  { ticker: 'NTPC.NS', company: 'NTPC', sector: 'Power' },
  { ticker: 'ONGC.NS', company: 'ONGC', sector: 'Energy' },
  { ticker: 'NESTLEIND.NS', company: 'Nestle India', sector: 'FMCG' },
  { ticker: 'WIPRO.NS', company: 'Wipro', sector: 'IT' },
  { ticker: 'M&M.NS', company: 'Mahindra & Mahindra', sector: 'Auto' },
  { ticker: 'JSWSTEEL.NS', company: 'JSW Steel', sector: 'Metals' },
  { ticker: 'POWERGRID.NS', company: 'Power Grid Corp', sector: 'Power' },
  { ticker: 'TATASTEEL.NS', company: 'Tata Steel', sector: 'Metals' },
  { ticker: 'TATAMOTORS.NS', company: 'Tata Motors', sector: 'Auto' },
  { ticker: 'ADANIENT.NS', company: 'Adani Enterprises', sector: 'Diversified' },
  { ticker: 'ADANIPORTS.NS', company: 'Adani Ports', sector: 'Infrastructure' },
  { ticker: 'DIVISLAB.NS', company: 'Divis Laboratories', sector: 'Pharma' },
  { ticker: 'COALINDIA.NS', company: 'Coal India', sector: 'Mining' },
  { ticker: 'BAJAJFINSV.NS', company: 'Bajaj Finserv', sector: 'Financial Services' },
  { ticker: 'TECHM.NS', company: 'Tech Mahindra', sector: 'IT' },
  { ticker: 'DRREDDY.NS', company: "Dr Reddy's Labs", sector: 'Pharma' },
  { ticker: 'CIPLA.NS', company: 'Cipla', sector: 'Pharma' },
  { ticker: 'BRITANNIA.NS', company: 'Britannia Industries', sector: 'FMCG' },
  { ticker: 'APOLLOHOSP.NS', company: 'Apollo Hospitals', sector: 'Healthcare' },
  { ticker: 'EICHERMOT.NS', company: 'Eicher Motors', sector: 'Auto' },
  { ticker: 'TATACONSUM.NS', company: 'Tata Consumer Products', sector: 'FMCG' },
  { ticker: 'GRASIM.NS', company: 'Grasim Industries', sector: 'Cement' },
  { ticker: 'INDUSINDBK.NS', company: 'IndusInd Bank', sector: 'Banking' },
  { ticker: 'BPCL.NS', company: 'BPCL', sector: 'Energy' },
  { ticker: 'HEROMOTOCO.NS', company: 'Hero MotoCorp', sector: 'Auto' },
  { ticker: 'SBILIFE.NS', company: 'SBI Life Insurance', sector: 'Insurance' },
  { ticker: 'HDFCLIFE.NS', company: 'HDFC Life Insurance', sector: 'Insurance' },
  { ticker: 'BAJAJ-AUTO.NS', company: 'Bajaj Auto', sector: 'Auto' },
  { ticker: 'HINDALCO.NS', company: 'Hindalco Industries', sector: 'Metals' },
  { ticker: 'SHRIRAMFIN.NS', company: 'Shriram Finance', sector: 'Financial Services' },
];

// US S&P 500 top stocks
export const US_TOP: { ticker: string; company: string; sector: string }[] = [
  { ticker: 'AAPL', company: 'Apple', sector: 'Technology' },
  { ticker: 'MSFT', company: 'Microsoft', sector: 'Technology' },
  { ticker: 'NVDA', company: 'NVIDIA', sector: 'Technology' },
  { ticker: 'GOOGL', company: 'Alphabet', sector: 'Technology' },
  { ticker: 'AMZN', company: 'Amazon', sector: 'Consumer Cyclical' },
  { ticker: 'META', company: 'Meta Platforms', sector: 'Technology' },
  { ticker: 'TSLA', company: 'Tesla', sector: 'Auto' },
  { ticker: 'BRK-B', company: 'Berkshire Hathaway', sector: 'Financial Services' },
  { ticker: 'JPM', company: 'JPMorgan Chase', sector: 'Banking' },
  { ticker: 'V', company: 'Visa', sector: 'Financial Services' },
  { ticker: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare' },
  { ticker: 'WMT', company: 'Walmart', sector: 'Retail' },
  { ticker: 'MA', company: 'Mastercard', sector: 'Financial Services' },
  { ticker: 'PG', company: 'Procter & Gamble', sector: 'Consumer Defensive' },
  { ticker: 'UNH', company: 'UnitedHealth Group', sector: 'Healthcare' },
  { ticker: 'HD', company: 'Home Depot', sector: 'Consumer Cyclical' },
  { ticker: 'XOM', company: 'Exxon Mobil', sector: 'Energy' },
  { ticker: 'BAC', company: 'Bank of America', sector: 'Banking' },
  { ticker: 'COST', company: 'Costco', sector: 'Retail' },
  { ticker: 'AVGO', company: 'Broadcom', sector: 'Technology' },
  { ticker: 'CRM', company: 'Salesforce', sector: 'Technology' },
  { ticker: 'AMD', company: 'AMD', sector: 'Technology' },
  { ticker: 'NFLX', company: 'Netflix', sector: 'Communication' },
  { ticker: 'ADBE', company: 'Adobe', sector: 'Technology' },
  { ticker: 'DIS', company: 'Walt Disney', sector: 'Communication' },
];

// Global macro symbols
export const MACRO_INDICES = [
  { symbol: '^NSEI', name: 'NIFTY 50', region: 'India', flag: '🇮🇳' },
  { symbol: '^BSESN', name: 'SENSEX', region: 'India', flag: '🇮🇳' },
  { symbol: '^GSPC', name: 'S&P 500', region: 'US', flag: '🇺🇸' },
  { symbol: '^IXIC', name: 'NASDAQ', region: 'US', flag: '🇺🇸' },
  { symbol: '^DJI', name: 'Dow Jones', region: 'US', flag: '🇺🇸' },
  { symbol: '^FTSE', name: 'FTSE 100', region: 'Europe', flag: '🇬🇧' },
  { symbol: '^GDAXI', name: 'DAX', region: 'Europe', flag: '🇩🇪' },
  { symbol: '^FCHI', name: 'CAC 40', region: 'Europe', flag: '🇫🇷' },
  { symbol: '^N225', name: 'Nikkei 225', region: 'Asia', flag: '🇯🇵' },
  { symbol: '^HSI', name: 'Hang Seng', region: 'Asia', flag: '🇭🇰' },
  { symbol: '000001.SS', name: 'Shanghai Comp', region: 'Asia', flag: '🇨🇳' },
  { symbol: '^AXJO', name: 'ASX 200', region: 'Asia', flag: '🇦🇺' },
];

export const MACRO_CURRENCIES = [
  { symbol: 'USDINR=X', name: 'USD/INR', region: 'India', flag: '🇮🇳' },
  { symbol: 'EURINR=X', name: 'EUR/INR', region: 'India', flag: '🇪🇺' },
  { symbol: 'GBPINR=X', name: 'GBP/INR', region: 'India', flag: '🇬🇧' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', region: 'Global', flag: '🇪🇺' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', region: 'Global', flag: '🇬🇧' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', region: 'Global', flag: '🇯🇵' },
  { symbol: 'USDCNY=X', name: 'USD/CNY', region: 'Global', flag: '🇨🇳' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index', region: 'Global', flag: '🇺🇸' },
];

export const MACRO_COMMODITIES = [
  { symbol: 'GC=F', name: 'Gold', region: 'Metals', flag: '🥇' },
  { symbol: 'SI=F', name: 'Silver', region: 'Metals', flag: '🥈' },
  { symbol: 'CL=F', name: 'Crude Oil WTI', region: 'Energy', flag: '🛢️' },
  { symbol: 'BZ=F', name: 'Brent Crude', region: 'Energy', flag: '🛢️' },
  { symbol: 'NG=F', name: 'Natural Gas', region: 'Energy', flag: '🔥' },
  { symbol: 'HG=F', name: 'Copper', region: 'Metals', flag: '🔶' },
  { symbol: 'PL=F', name: 'Platinum', region: 'Metals', flag: '⬜' },
  { symbol: 'ZC=F', name: 'Corn', region: 'Agriculture', flag: '🌽' },
  { symbol: 'ZW=F', name: 'Wheat', region: 'Agriculture', flag: '🌾' },
  { symbol: 'ZS=F', name: 'Soybeans', region: 'Agriculture', flag: '🫘' },
];

export const MACRO_BONDS = [
  { symbol: '^TNX', name: 'US 10Y Treasury', region: 'US', flag: '🇺🇸' },
  { symbol: '^TYX', name: 'US 30Y Treasury', region: 'US', flag: '🇺🇸' },
  { symbol: '^FVX', name: 'US 5Y Treasury', region: 'US', flag: '🇺🇸' },
  { symbol: '^IRX', name: 'US 13W T-Bill', region: 'US', flag: '🇺🇸' },
];

// Sector ETFs for RRG
export const SECTOR_ETFS_INDIA = [
  { symbol: 'NIFTYPHARMA.NS', name: 'Pharma', color: '#10B981' },
  { symbol: 'NIFTYIT.NS', name: 'IT', color: '#3B82F6' },
  { symbol: 'BANKNIFTY.NS', name: 'Bank Nifty', color: '#F59E0B' },
  { symbol: 'NIFTYMETAL.NS', name: 'Metal', color: '#EF4444' },
  { symbol: 'NIFTYAUTO.NS', name: 'Auto', color: '#8B5CF6' },
  { symbol: 'NIFTYREALTY.NS', name: 'Realty', color: '#EC4899' },
  { symbol: 'NIFTYFMCG.NS', name: 'FMCG', color: '#14B8A6' },
  { symbol: 'NIFTYMEDIA.NS', name: 'Media', color: '#F97316' },
  { symbol: 'NIFTYENERGY.NS', name: 'Energy', color: '#06B6D4' },
  { symbol: 'NIFTYPSE.NS', name: 'PSE', color: '#84CC16' },
];
