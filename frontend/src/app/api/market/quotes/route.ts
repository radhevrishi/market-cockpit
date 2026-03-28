import { NextResponse } from 'next/server';
import { fetchNifty50, fetchNiftyNext50, fetchNifty500, fetchNifty200, fetchNiftyMidcap250, fetchNiftySmallcap250, buildDynamicSectorMap, normalizeSector, NIFTY50_SECTORS } from '@/lib/nse';
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
  const [sectorMap, nifty500Data, midcap250Data, smallcap250Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNifty500().catch(() => null),
    fetchNiftyMidcap250().catch(() => null),
    fetchNiftySmallcap250().catch(() => null),
  ]);

  let stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any) => {
    const symbol = item.symbol || '';
    // Priority: dynamic sector map > normalized industry > static map
    const sector = sectorMap[symbol] || normalizeSector(item.meta?.industry || item.industry) || NIFTY50_SECTORS[symbol] || 'Other';
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

  // Process NIFTY 500 first (largest coverage)
  if (nifty500Data && nifty500Data.data) {
    for (const item of nifty500Data.data) {
      const mapped = mapStock(item);
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  // Add unique stocks from Midcap 250
  if (midcap250Data && midcap250Data.data) {
    for (const item of midcap250Data.data) {
      const mapped = mapStock(item);
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  // Add unique stocks from Smallcap 250
  if (smallcap250Data && smallcap250Data.data) {
    for (const item of smallcap250Data.data) {
      const mapped = mapStock(item);
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  // If no broad index data, try NIFTY 50 + Next 50 as fallback
  if (stocks.length < 50) {
    const [nifty50Data, niftyNext50Data] = await Promise.all([
      fetchNifty50(),
      fetchNiftyNext50(),
    ]);

    stocks = [];
    tickerSet.clear();
    if (nifty50Data && nifty50Data.data) {
      for (const item of nifty50Data.data) {
        const mapped = mapStock(item);
        if (mapped.ticker && mapped.price > 0) { stocks.push(mapped); tickerSet.add(mapped.ticker); }
      }
    }
    if (niftyNext50Data && niftyNext50Data.data) {
      for (const item of niftyNext50Data.data) {
        const mapped = mapStock(item);
        if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) { stocks.push(mapped); tickerSet.add(mapped.ticker); }
      }
    }
  }

  // Yahoo Finance as last resort
  if (stocks.length === 0) {
    const { NIFTY50 } = await import('@/lib/yahoo');
    const symbols = NIFTY50.map(s => s.ticker);
    const quotes = await fetchQuotesWithFallback(symbols);
    stocks = NIFTY50.map(stock => {
      const q = quotes.find((quote: any) => quote.symbol === stock.ticker || quote.symbol === stock.ticker.replace('.NS', ''));
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

  // Derive gainers/losers
  let gainers: any[] = [];
  let losers: any[] = [];
  if (stocks.length > 0) {
    gainers = [...stocks].sort((a, b) => b.changePercent - a.changePercent).filter((s: any) => s.changePercent > 0).slice(0, 30);
    losers = [...stocks].sort((a, b) => a.changePercent - b.changePercent).filter((s: any) => s.changePercent < 0).slice(0, 30);
  }

  const validStocks = stocks.filter(s => s.price > 0);

  return NextResponse.json({
    stocks: validStocks,
    gainers,
    losers,
    summary: {
      total: validStocks.length,
      gainersCount: validStocks.filter(s => s.changePercent > 0).length,
      losersCount: validStocks.filter(s => s.changePercent < 0).length,
      avgChange: validStocks.length > 0 ? validStocks.reduce((sum, s) => sum + s.changePercent, 0) / validStocks.length : 0,
      sectors: [...new Set(validStocks.map(s => s.sector))].length,
    },
    source: nifty500Data?.data ? 'NSE India' : 'Yahoo Finance',
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
