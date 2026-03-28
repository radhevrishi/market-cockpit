import { NextResponse } from 'next/server';
import { fetchNifty50, fetchNiftyNext50, NIFTY50_SECTORS } from '@/lib/nse';
import { fetchQuotesWithFallback, US_TOP } from '@/lib/yahoo';

export const dynamic = 'force-dynamic';

// Approximate market cap lookup for top Indian stocks (in crores)
const APPROX_MCAP: Record<string, number> = {
  'RELIANCE': 1800000, 'TCS': 1400000, 'HDFCBANK': 1300000, 'ICICIBANK': 900000,
  'BHARTIARTL': 850000, 'INFY': 700000, 'SBIN': 700000, 'ITC': 600000,
  'LT': 550000, 'HINDUNILVR': 550000, 'BAJFINANCE': 500000, 'HCLTECH': 450000,
  'MARUTI': 400000, 'KOTAKBANK': 380000, 'SUNPHARMA': 370000, 'TITAN': 350000,
  'AXISBANK': 340000, 'ONGC': 320000, 'NTPC': 310000, 'ADANIENT': 300000,
  'WIPRO': 280000, 'TATAMOTORS': 270000, 'ADANIPORTS': 260000, 'M&M': 250000,
  'POWERGRID': 240000, 'ULTRACEMCO': 230000, 'NESTLEIND': 220000, 'COALINDIA': 210000,
  'JSWSTEEL': 200000, 'TATASTEEL': 190000, 'TECHM': 170000, 'BAJAJFINSV': 160000,
  'GRASIM': 150000, 'BAJAJ-AUTO': 145000, 'INDUSINDBK': 140000, 'HINDALCO': 135000,
  'CIPLA': 130000, 'DRREDDY': 125000, 'EICHERMOT': 120000, 'BRITANNIA': 115000,
  'APOLLOHOSP': 110000, 'TATACONSUM': 105000, 'BPCL': 100000, 'HEROMOTOCO': 95000,
  'SBILIFE': 90000, 'HDFCLIFE': 85000, 'DIVISLAB': 80000, 'SHRIRAMFIN': 75000,
  'DMART': 350000, 'LICI': 600000, 'HAL': 300000, 'IRFC': 200000,
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';

  try {
    if (market === 'india') {
      return await fetchIndianData();
    } else {
      return await fetchUSData();
    }
  } catch (error) {
    console.error('Market quotes error:', error);
    return NextResponse.json({ error: 'Failed to fetch market data', stocks: [], gainers: [], losers: [], summary: { total: 0, gainersCount: 0, losersCount: 0, avgChange: 0, sectors: 0 } }, { status: 500 });
  }
}

async function fetchIndianData() {
  // Fetch NIFTY 50 and NIFTY Next 50 to get ~100 stocks
  const [nifty50Data, niftyNext50Data] = await Promise.all([
    fetchNifty50(),
    fetchNiftyNext50(),
  ]);

  let stocks: any[] = [];

  // Process NIFTY 50 data
  if (nifty50Data && nifty50Data.data) {
    stocks = nifty50Data.data.map((item: any) => ({
      ticker: item.symbol || '',
      company: item.meta?.companyName || item.identifier || item.symbol || '',
      sector: NIFTY50_SECTORS[item.symbol] || 'Other',
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: APPROX_MCAP[item.symbol] || Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 100000),
      previousClose: item.previousClose || item.prevClose || 0,
      open: item.open || 0,
      dayHigh: item.dayHigh || 0,
      dayLow: item.dayLow || 0,
      yearHigh: item.yearHigh || 0,
      yearLow: item.yearLow || 0,
    })).filter((s: any) => s.ticker && s.price > 0);
  }

  // Process NIFTY Next 50 data and merge with NIFTY 50
  if (niftyNext50Data && niftyNext50Data.data) {
    const next50Stocks = niftyNext50Data.data.map((item: any) => ({
      ticker: item.symbol || '',
      company: item.meta?.companyName || item.identifier || item.symbol || '',
      sector: NIFTY50_SECTORS[item.symbol] || 'Other',
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: APPROX_MCAP[item.symbol] || Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 100000),
      previousClose: item.previousClose || item.prevClose || 0,
      open: item.open || 0,
      dayHigh: item.dayHigh || 0,
      dayLow: item.dayLow || 0,
      yearHigh: item.yearHigh || 0,
      yearLow: item.yearLow || 0,
    })).filter((s: any) => s.ticker && s.price > 0);

    // Merge arrays and deduplicate by symbol
    const tickerSet = new Set(stocks.map(s => s.ticker));
    const uniqueNext50 = next50Stocks.filter((s: any) => !tickerSet.has(s.ticker));
    stocks = [...stocks, ...uniqueNext50];
  }

  // If NSE data unavailable, try Yahoo Finance as fallback
  if (stocks.length === 0) {
    const { NIFTY50 } = await import('@/lib/yahoo');
    const symbols = NIFTY50.map(s => s.ticker);
    const quotes = await fetchQuotesWithFallback(symbols);

    stocks = NIFTY50.map(stock => {
      const q = quotes.find((quote: any) =>
        quote.symbol === stock.ticker || quote.symbol === stock.ticker.replace('.NS', '')
      );
      return {
        ticker: stock.ticker.replace('.NS', ''),
        company: q?.shortName || stock.company,
        sector: stock.sector,
        price: q?.regularMarketPrice || 0,
        change: q?.regularMarketChange || 0,
        changePercent: q?.regularMarketChangePercent || 0,
        volume: q?.regularMarketVolume || 0,
        marketCap: q?.marketCap || 0,
        previousClose: q?.regularMarketPreviousClose || 0,
      };
    }).filter(s => s.price > 0);
  }

  // Always derive gainers/losers from the complete stocks array
  // This ensures we always have both lists with full data (price, change, volume)
  // The dedicated NSE gainers/losers API is unreliable after market hours
  let gainers: any[] = [];
  let losers: any[] = [];

  if (stocks.length > 0) {
    const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
    gainers = sorted.filter((s: any) => s.changePercent > 0).slice(0, 25);
    losers = sorted.filter((s: any) => s.changePercent < 0).slice(0, 25); // already sorted worst first by reverse order
    // Re-sort losers so worst is first
    losers = [...stocks].sort((a, b) => a.changePercent - b.changePercent).filter((s: any) => s.changePercent < 0).slice(0, 25);
  }

  const validStocks = stocks.filter(s => s.price > 0);

  return NextResponse.json({
    stocks: validStocks,
    gainers,
    losers,
    summary: {
      total: validStocks.length,
      gainersCount: gainers.length || validStocks.filter(s => s.changePercent > 0).length,
      losersCount: losers.length || validStocks.filter(s => s.changePercent < 0).length,
      avgChange: validStocks.length > 0
        ? validStocks.reduce((sum, s) => sum + s.changePercent, 0) / validStocks.length
        : 0,
      sectors: [...new Set(validStocks.map(s => s.sector))].length,
    },
    source: nifty50Data?.data ? 'NSE India' : 'Yahoo Finance',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchUSData() {
  const symbols = US_TOP.map(s => s.ticker);
  const quotes = await fetchQuotesWithFallback(symbols);

  const stocks = US_TOP.map(stock => {
    const q = quotes.find((quote: any) => quote.symbol === stock.ticker);
    return {
      ticker: stock.ticker,
      company: q?.shortName || stock.company,
      sector: stock.sector,
      price: q?.regularMarketPrice || 0,
      change: q?.regularMarketChange || 0,
      changePercent: q?.regularMarketChangePercent || 0,
      volume: q?.regularMarketVolume || 0,
      marketCap: q?.marketCap || 0,
      previousClose: q?.regularMarketPreviousClose || 0,
    };
  }).filter(s => s.price > 0);

  const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.filter(s => s.changePercent > 0);
  const losers = sorted.filter(s => s.changePercent < 0).reverse();

  return NextResponse.json({
    stocks,
    gainers,
    losers,
    summary: {
      total: stocks.length,
      gainersCount: gainers.length,
      losersCount: losers.length,
      avgChange: stocks.length > 0 ? stocks.reduce((sum, s) => sum + s.changePercent, 0) / stocks.length : 0,
      sectors: [...new Set(stocks.map(s => s.sector))].length,
    },
    source: 'Yahoo Finance',
    updatedAt: new Date().toISOString(),
  });
}
