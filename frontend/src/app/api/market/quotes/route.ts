import { NextResponse } from 'next/server';
import { fetchNifty50, fetchNiftyNext50, fetchNifty500, fetchNifty200, buildDynamicSectorMap, NIFTY50_SECTORS } from '@/lib/nse';
import { fetchQuotesWithFallback, US_TOP } from '@/lib/yahoo';

export const dynamic = 'force-dynamic';

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
  // Build dynamic sector map in parallel with stock data
  const [sectorMap, stocksResponse] = await Promise.all([
    buildDynamicSectorMap(),
    // Try NIFTY 500 first, fallback chain to smaller indices
    fetchNifty500()
      .then(data => {
        if (data && data.data && data.data.length > 50) return data;
        throw new Error('NIFTY 500 insufficient');
      })
      .catch(() => fetchNifty200()
        .then(data => {
          if (data && data.data && data.data.length > 50) return data;
          throw new Error('NIFTY 200 insufficient');
        })
        .catch(() => null)
      ),
  ]);

  let stocks: any[] = [];

  const mapStock = (item: any) => {
    const symbol = item.symbol || '';
    // Derive sector dynamically - fallback to static map
    const sector = sectorMap[symbol] || NIFTY50_SECTORS[symbol] || item.meta?.industry || 'Other';
    // Use free-float market cap from NSE if available, otherwise estimate
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    const estimatedMcap = ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000);

    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: estimatedMcap,
      previousClose: item.previousClose || item.prevClose || 0,
      open: item.open || 0,
      dayHigh: item.dayHigh || 0,
      dayLow: item.dayLow || 0,
      yearHigh: item.yearHigh || 0,
      yearLow: item.yearLow || 0,
    };
  };

  if (stocksResponse && stocksResponse.data) {
    stocks = stocksResponse.data.map(mapStock).filter((s: any) => s.ticker && s.price > 0);
  }

  // If broad index failed, try NIFTY 50 + Next 50 as final fallback
  if (stocks.length < 50) {
    const [nifty50Data, niftyNext50Data] = await Promise.all([
      fetchNifty50(),
      fetchNiftyNext50(),
    ]);

    stocks = [];
    if (nifty50Data && nifty50Data.data) {
      stocks = nifty50Data.data.map(mapStock).filter((s: any) => s.ticker && s.price > 0);
    }
    if (niftyNext50Data && niftyNext50Data.data) {
      const tickerSet = new Set(stocks.map(s => s.ticker));
      const next50 = niftyNext50Data.data.map(mapStock).filter((s: any) => s.ticker && s.price > 0 && !tickerSet.has(s.ticker));
      stocks = [...stocks, ...next50];
    }
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

  // Derive gainers/losers from the complete stocks array
  let gainers: any[] = [];
  let losers: any[] = [];

  if (stocks.length > 0) {
    const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
    gainers = sorted.filter((s: any) => s.changePercent > 0).slice(0, 30);
    losers = [...stocks].sort((a, b) => a.changePercent - b.changePercent).filter((s: any) => s.changePercent < 0).slice(0, 30);
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
    source: stocksResponse?.data ? 'NSE India' : 'Yahoo Finance',
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
