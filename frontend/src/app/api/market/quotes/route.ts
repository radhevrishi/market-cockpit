import { NextResponse } from 'next/server';
import { fetchNifty50, fetchNiftyNext50, fetchNifty500, fetchNifty200, fetchNiftyMidcap50, fetchNiftyMidcap100, fetchNiftyMidcap250, fetchNiftySmallcap50, fetchNiftySmallcap100, fetchNiftySmallcap250, fetchNiftyMicrocap250, fetchNiftyTotalMarket, fetchGainers, fetchLosers, buildDynamicSectorMap, normalizeSector, NIFTY50_SECTORS } from '@/lib/nse';
import { fetchQuotesWithFallback, US_TOP } from '@/lib/yahoo';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const index = searchParams.get('index'); // Optional: 'midsmall50' for heatmap

  try {
    if (market === 'india') {
      if (index === 'midsmall50') {
        return await fetchMidSmall50Data();
      }
      if (index === 'smallcap150') {
        return await fetchSmallcap150Data();
      }
      if (index === 'midcap150') {
        return await fetchMidcap150Data();
      }
      if (index === 'nifty50') {
        return await fetchNifty50Data();
      }
      return await fetchIndianData();
    } else {
      return await fetchUSData();
    }
  } catch (error) {
    console.error('Market quotes error:', error);
    return NextResponse.json({ error: 'Failed to fetch market data', stocks: [], gainers: [], losers: [], summary: { total: 0, gainersCount: 0, losersCount: 0, avgChange: 0, sectors: 0 } }, { status: 500 });
  }
}

// Lightweight endpoint for heatmap: only NIFTY Midcap 50 + Smallcap 50
async function fetchMidSmall50Data() {
  const [sectorMap, midcap50Data, smallcap50Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNiftyMidcap50().catch(() => null),
    fetchNiftySmallcap50().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any, indexLabel: string) => {
    const symbol = item.symbol || '';
    const sector = sectorMap[symbol] || normalizeSector(item.meta?.industry || item.industry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      indexGroup: indexLabel,
    };
  };

  if (midcap50Data && midcap50Data.data) {
    for (const item of midcap50Data.data) {
      const mapped = mapStock(item, 'Midcap 50');
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  if (smallcap50Data && smallcap50Data.data) {
    for (const item of smallcap50Data.data) {
      const mapped = mapStock(item, 'Smallcap 50');
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  const validStocks = stocks.filter(s => s.price > 0);
  const gainers = [...validStocks].sort((a, b) => b.changePercent - a.changePercent).filter(s => s.changePercent > 0).slice(0, 30);
  const losers = [...validStocks].sort((a, b) => a.changePercent - b.changePercent).filter(s => s.changePercent < 0).slice(0, 30);

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
    source: 'NSE India (Midcap 50 + Smallcap 50)',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchSmallcap150Data() {
  const [sectorMap, sc50Data, sc100Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNiftySmallcap50().catch(() => null),
    fetchNiftySmallcap100().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any, indexLabel: string) => {
    const symbol = item.symbol || '';
    const sector = sectorMap[symbol] || normalizeSector(item.meta?.industry || item.industry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      indexGroup: indexLabel,
    };
  };

  if (sc50Data && sc50Data.data) {
    for (const item of sc50Data.data) {
      const mapped = mapStock(item, 'Smallcap 50');
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  if (sc100Data && sc100Data.data) {
    for (const item of sc100Data.data) {
      const mapped = mapStock(item, 'Smallcap 100');
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  const validStocks = stocks.filter(s => s.price > 0);
  const gainers = [...validStocks].sort((a, b) => b.changePercent - a.changePercent).filter(s => s.changePercent > 0).slice(0, 30);
  const losers = [...validStocks].sort((a, b) => a.changePercent - b.changePercent).filter(s => s.changePercent < 0).slice(0, 30);

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
    source: 'NSE India (Smallcap 150)',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchMidcap150Data() {
  const [sectorMap, mc50Data, mc100Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNiftyMidcap50().catch(() => null),
    fetchNiftyMidcap100().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any, indexLabel: string) => {
    const symbol = item.symbol || '';
    const sector = sectorMap[symbol] || normalizeSector(item.meta?.industry || item.industry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      indexGroup: indexLabel,
    };
  };

  if (mc50Data && mc50Data.data) {
    for (const item of mc50Data.data) {
      const mapped = mapStock(item, 'Midcap 50');
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  if (mc100Data && mc100Data.data) {
    for (const item of mc100Data.data) {
      const mapped = mapStock(item, 'Midcap 100');
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  const validStocks = stocks.filter(s => s.price > 0);
  const gainers = [...validStocks].sort((a, b) => b.changePercent - a.changePercent).filter(s => s.changePercent > 0).slice(0, 30);
  const losers = [...validStocks].sort((a, b) => a.changePercent - b.changePercent).filter(s => s.changePercent < 0).slice(0, 30);

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
    source: 'NSE India (Midcap 150)',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchNifty50Data() {
  const [sectorMap, n50Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNifty50().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any) => {
    const symbol = item.symbol || '';
    const sector = sectorMap[symbol] || normalizeSector(item.meta?.industry || item.industry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      indexGroup: 'NIFTY 50',
    };
  };

  if (n50Data && n50Data.data) {
    for (const item of n50Data.data) {
      const mapped = mapStock(item);
      if (mapped.ticker && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  }

  const validStocks = stocks.filter(s => s.price > 0);
  const gainers = [...validStocks].sort((a, b) => b.changePercent - a.changePercent).filter(s => s.changePercent > 0).slice(0, 30);
  const losers = [...validStocks].sort((a, b) => a.changePercent - b.changePercent).filter(s => s.changePercent < 0).slice(0, 30);

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
    source: 'NSE India (NIFTY 50)',
    updatedAt: new Date().toISOString(),
  });
}

async function fetchIndianData() {
  // Build dynamic sector map in parallel with stock data
  const [sectorMap, nifty500Data, midcap250Data, smallcap250Data, microcap250Data, totalMarketData, nseGainers, nseLosers] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNifty500().catch(() => null),
    fetchNiftyMidcap250().catch(() => null),
    fetchNiftySmallcap250().catch(() => null),
    fetchNiftyMicrocap250().catch(() => null),
    fetchNiftyTotalMarket().catch(() => null),
    fetchGainers().catch(() => null),
    fetchLosers().catch(() => null),
  ]);

  let stocks: any[] = [];
  const tickerSet = new Set<string>();
  // Track which cap category each ticker belongs to (first match wins)
  const tickerCapMap = new Map<string, string>();

  // Build cap membership from index data (most reliable classification)
  // Nifty 50 + Next 50 = Large, Midcap 250 = Mid, Smallcap 250 + Microcap = Small
  const buildCapMap = (data: any, cap: string) => {
    if (!data?.data) return;
    for (const item of data.data) {
      const sym = item.symbol || '';
      if (sym && !sym.includes(' ') && !tickerCapMap.has(sym)) {
        tickerCapMap.set(sym, cap);
      }
    }
  };

  // Set cap from specific indices (order matters — midcap/smallcap override nifty500)
  buildCapMap(midcap250Data, 'Mid');
  buildCapMap(smallcap250Data, 'Small');
  buildCapMap(microcap250Data, 'Small');

  const mapStock = (item: any) => {
    const symbol = item.symbol || '';
    // Skip index header rows
    if (!symbol || symbol.includes(' ')) return null;
    // Priority: dynamic sector map > normalized industry > static map
    const sector = sectorMap[symbol] || normalizeSector(item.meta?.industry || item.industry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    const estimatedMcap = ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000);
    // Cap classification: use index membership first, then market cap thresholds
    const cap = tickerCapMap.get(symbol) || (ffmc > 500_000_000_000 ? 'Large' : ffmc > 100_000_000_000 ? 'Mid' : 'Large');

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
      indexGroup: cap,
    };
  };

  const addStocks = (data: any) => {
    if (!data?.data) return;
    for (const item of data.data) {
      const mapped = mapStock(item);
      if (mapped && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  };

  // Process all index data
  addStocks(nifty500Data);
  addStocks(midcap250Data);
  addStocks(smallcap250Data);
  addStocks(microcap250Data);
  addStocks(totalMarketData);

  // Add unique stocks from NSE live gainers/losers (covers ALL NSE equities)
  const addLiveAnalysis = (liveData: any) => {
    if (!liveData || !liveData.NIFTY) return;
    const allItems = [...(liveData.NIFTY?.data || []), ...(liveData.allSec?.data || [])];
    for (const item of allItems) {
      const mapped = mapStock(item);
      if (mapped && mapped.price > 0 && !tickerSet.has(mapped.ticker)) {
        stocks.push(mapped);
        tickerSet.add(mapped.ticker);
      }
    }
  };
  addLiveAnalysis(nseGainers);
  addLiveAnalysis(nseLosers);

  // If no broad index data, try NIFTY 50 + Next 50 as fallback
  if (stocks.length < 50) {
    const [nifty50Data, niftyNext50Data] = await Promise.all([
      fetchNifty50(),
      fetchNiftyNext50(),
    ]);

    stocks = [];
    tickerSet.clear();
    addStocks(nifty50Data);
    addStocks(niftyNext50Data);
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
