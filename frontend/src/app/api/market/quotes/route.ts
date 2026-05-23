import { NextResponse } from 'next/server';
import { fetchNifty50, fetchNiftyNext50, fetchNifty500, fetchNifty200, fetchNiftyMidcap50, fetchNiftyMidcap100, fetchNiftyMidcap250, fetchNiftySmallcap50, fetchNiftySmallcap100, fetchNiftySmallcap250, fetchNiftyMicrocap250, fetchNiftyTotalMarket, fetchGainers, fetchLosers, buildDynamicSectorMap, normalizeSector, NIFTY50_SECTORS } from '@/lib/nse';
import { fetchQuotesWithFallback, US_TOP } from '@/lib/yahoo';
// PATCH 0768 — Trading calendar + KV snapshot for "NEVER show empty movers".
import { getEffectiveTradingDate, isMarketOpenNow, effectiveDateLabel } from '@/lib/trading-calendar';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// Response-level cache (avoids re-assembly on rapid polls)
const responseCache = new Map<string, { data: any; ts: number }>();
const RESPONSE_TTL = 30_000; // 30s cache for assembled response

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const index = searchParams.get('index'); // Optional: 'midsmall50' for heatmap

  // Build cache key based on market and index
  const cacheKey = `quotes:${market}:${index || 'all'}`;

  // Check response cache
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESPONSE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    let responseData: any;

    if (market === 'india') {
      if (index === 'midsmall50') {
        responseData = await fetchMidSmall50DataWithCache();
      } else if (index === 'smallcap150') {
        responseData = await fetchSmallcap150DataWithCache();
      } else if (index === 'midcap150') {
        responseData = await fetchMidcap150DataWithCache();
      } else if (index === 'nifty50') {
        responseData = await fetchNifty50DataWithCache();
      } else {
        responseData = await fetchIndianDataWithCache();
      }
    } else {
      responseData = await fetchUSDataWithCache();
    }

    // Cache the response before returning
    responseCache.set(cacheKey, { data: responseData, ts: Date.now() });
    // Evict old entries if cache grows too large
    if (responseCache.size > 20) {
      const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      responseCache.delete(oldest[0]);
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Market quotes error:', error);
    return NextResponse.json({ error: 'Failed to fetch market data', stocks: [], gainers: [], losers: [], summary: { total: 0, gainersCount: 0, losersCount: 0, avgChange: 0, sectors: 0 } }, { status: 500 });
  }
}

// Lightweight endpoint for heatmap: only NIFTY Midcap 50 + Smallcap 50
async function fetchMidSmall50DataWithCache() {
  const [sectorMap, midcap50Data, smallcap50Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNiftyMidcap50().catch(() => null),
    fetchNiftySmallcap50().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any, indexLabel: string) => {
    const symbol = item.symbol || '';
    const rawIndustry = item.meta?.industry || item.industry || '';
    const sector = sectorMap[symbol] || normalizeSector(rawIndustry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      industry: rawIndustry,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      // PATCH 0445 BUG-020/037 — optional columns (Watchlist column chooser)
      week52High: item.yearHigh ?? item.fiftyTwoWeekHigh ?? null,
      week52Low: item.yearLow ?? item.fiftyTwoWeekLow ?? null,
      peRatio: item.pe ?? item.peRatio ?? null,
      avgVolume: item.totalTradedVolume30Day ?? item.averageDailyVolume3Month ?? null,
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

  return {
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
  };
}

async function fetchSmallcap150DataWithCache() {
  const [sectorMap, sc50Data, sc100Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNiftySmallcap50().catch(() => null),
    fetchNiftySmallcap100().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any, indexLabel: string) => {
    const symbol = item.symbol || '';
    const rawIndustry = item.meta?.industry || item.industry || '';
    const sector = sectorMap[symbol] || normalizeSector(rawIndustry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      industry: rawIndustry,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      // PATCH 0445 BUG-020/037 — optional columns (Watchlist column chooser)
      week52High: item.yearHigh ?? item.fiftyTwoWeekHigh ?? null,
      week52Low: item.yearLow ?? item.fiftyTwoWeekLow ?? null,
      peRatio: item.pe ?? item.peRatio ?? null,
      avgVolume: item.totalTradedVolume30Day ?? item.averageDailyVolume3Month ?? null,
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

  return {
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
  };
}

async function fetchMidcap150DataWithCache() {
  const [sectorMap, mc50Data, mc100Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNiftyMidcap50().catch(() => null),
    fetchNiftyMidcap100().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any, indexLabel: string) => {
    const symbol = item.symbol || '';
    const rawIndustry = item.meta?.industry || item.industry || '';
    const sector = sectorMap[symbol] || normalizeSector(rawIndustry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      industry: rawIndustry,
      price: item.lastPrice || item.ltP || 0,
      change: typeof item.change === 'number' ? item.change : 0,
      changePercent: item.pChange || 0,
      volume: item.totalTradedVolume || item.trdVol || 0,
      marketCap: ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000),
      previousClose: item.previousClose || item.prevClose || 0,
      // PATCH 0445 BUG-020/037 — optional columns (Watchlist column chooser)
      week52High: item.yearHigh ?? item.fiftyTwoWeekHigh ?? null,
      week52Low: item.yearLow ?? item.fiftyTwoWeekLow ?? null,
      peRatio: item.pe ?? item.peRatio ?? null,
      avgVolume: item.totalTradedVolume30Day ?? item.averageDailyVolume3Month ?? null,
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

  return {
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
  };
}

async function fetchNifty50DataWithCache() {
  const [sectorMap, n50Data] = await Promise.all([
    buildDynamicSectorMap(),
    fetchNifty50().catch(() => null),
  ]);

  const stocks: any[] = [];
  const tickerSet = new Set<string>();

  const mapStock = (item: any) => {
    const symbol = item.symbol || '';
    const rawIndustry = item.meta?.industry || item.industry || '';
    const sector = sectorMap[symbol] || normalizeSector(rawIndustry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      industry: rawIndustry,
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

  return {
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
  };
}

async function fetchIndianDataWithCache() {
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
    const rawIndustry = item.meta?.industry || item.industry || '';
    const sector = sectorMap[symbol] || normalizeSector(rawIndustry) || NIFTY50_SECTORS[symbol] || 'Other';
    const ffmc = item.ffmc || item.freeFloatMktCap || 0;
    const estimatedMcap = ffmc > 0 ? ffmc : Math.round((item.lastPrice || 0) * (item.totalTradedVolume || 1) / 10000);
    // Cap classification: use index membership first, then market cap thresholds
    // PATCH 0452 P1-10 — Audit found the fallback returned 'Large' for ANY
    // ticker not in the index-cap map, even tiny smallcaps with no ffmc.
    // The third branch had a typo defaulting to 'Large' instead of 'Small'.
    // This silently corrupted heatmap, movers, and every cap-aware filter.
    const cap = tickerCapMap.get(symbol)
      || (ffmc > 500_000_000_000 ? 'Large'
        : ffmc > 100_000_000_000 ? 'Mid'
        : ffmc > 5_000_000_000   ? 'Small'
        : 'Micro');

    return {
      ticker: symbol,
      company: item.meta?.companyName || item.identifier || symbol,
      sector,
      industry: rawIndustry,
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
  // PATCH 0764 — Also trigger Yahoo fallback when NSE returned the stocks
  // list but all changePercent values are 0. NSE's index endpoints on
  // weekends/holidays return last-close prices but pChange=0 (no intraday
  // moves), which makes the route's downstream gainers/losers derivation
  // produce empty arrays. Yahoo's regularMarketChangePercent reflects the
  // LAST trading day's % move even on weekends, which is what users want
  // when they open the dashboard on a Saturday.
  const allZeroChange = stocks.length > 0 && stocks.every(s => !s.changePercent || s.changePercent === 0);
  if (stocks.length === 0 || allZeroChange) {
    const { NIFTY50, fetchQuotesWithFallback: yhFetch } = await import('@/lib/yahoo');
    const symbols = stocks.length === 0
      ? NIFTY50.map(s => s.ticker)
      // Enrichment path: ask Yahoo for changePercent on the existing tickers
      : stocks.slice(0, 200).map(s => s.ticker + '.NS');
    try {
      const quotes = await yhFetch(symbols);
      if (stocks.length === 0) {
        // Hard fallback: build the stock list entirely from Yahoo.
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
      } else {
        // Enrichment path: keep NSE's classification but overlay Yahoo's
        // last-close changePercent so weekend movers show real data.
        const yhMap = new Map<string, any>();
        for (const q of quotes) {
          const sym = (q?.symbol || '').replace('.NS', '').toUpperCase();
          if (sym) yhMap.set(sym, q);
        }
        let enriched = 0;
        for (const s of stocks) {
          const yh = yhMap.get((s.ticker || '').toUpperCase());
          if (yh && Number.isFinite(yh.regularMarketChangePercent) && yh.regularMarketChangePercent !== 0) {
            s.changePercent = yh.regularMarketChangePercent;
            if (Number.isFinite(yh.regularMarketChange)) s.change = yh.regularMarketChange;
            enriched++;
          }
        }
        // If Yahoo too returned all zeros (rare — maybe consecutive holidays),
        // leave as-is. The render path will still show prices + a closed banner.
        if (enriched === 0 && stocks.length > 0) {
          // Skip the assignment of gainers/losers and let downstream handle.
        }
      }
    } catch {
      // Yahoo fallback failed — keep NSE data as-is.
    }
  }

  // Derive gainers/losers
  let gainers: any[] = [];
  let losers: any[] = [];
  if (stocks.length > 0) {
    gainers = [...stocks].sort((a, b) => b.changePercent - a.changePercent).filter((s: any) => s.changePercent > 0).slice(0, 30);
    losers = [...stocks].sort((a, b) => a.changePercent - b.changePercent).filter((s: any) => s.changePercent < 0).slice(0, 30);
  }

  const validStocks = stocks.filter(s => s.price > 0);

  // PATCH 0768 — Trading Calendar + KV Snapshot Fallback.
  // User mandate: "Top Movers module must ALWAYS show the latest valid
  // trading-session data. NEVER show 'No movers data available'."
  //
  // Pipeline:
  //   1. If we have non-empty gainers + losers AND market is open OR within
  //      30min of close → WRITE snapshot to KV keyed by effective trading date.
  //   2. If we have empty gainers/losers (weekend cold + Yahoo also empty)
  //      → READ snapshot for the effective trading date from KV.
  const effectiveDate = getEffectiveTradingDate('NSE');
  const marketOpen = isMarketOpenNow('NSE');
  const haveLiveData = gainers.length > 0 || losers.length > 0;
  const SNAPSHOT_KEY = `movers-snapshot:v1:NSE:${effectiveDate}`;

  if (haveLiveData && isRedisAvailable()) {
    // Write-through: keep snapshot fresh whenever we successfully assembled live data.
    // 7-day TTL is plenty — by then a fresh trading day's data will be cached anyway.
    try {
      const trimGainers = gainers.slice(0, 30);
      const trimLosers = losers.slice(0, 30);
      await kvSet(SNAPSHOT_KEY, {
        exchange: 'NSE',
        trading_date: effectiveDate,
        gainers: trimGainers,
        losers: trimLosers,
        stocksSample: validStocks.slice(0, 200), // keep top 200 by index for sector views
        summary: {
          total: validStocks.length,
          gainersCount: trimGainers.length,
          losersCount: trimLosers.length,
          avgChange: validStocks.length > 0 ? validStocks.reduce((s, st) => s + st.changePercent, 0) / validStocks.length : 0,
          sectors: [...new Set(validStocks.map(s => s.sector))].length,
        },
        generated_at: new Date().toISOString(),
      }, 7 * 86400);
    } catch { /* non-fatal */ }
  }

  if (!haveLiveData) {
    // FALLBACK: try the snapshot for the effective trading date
    try {
      const snap: any = await kvGet(SNAPSHOT_KEY);
      if (snap?.gainers && snap.gainers.length > 0) {
        const dateLabel = effectiveDateLabel(effectiveDate, 'NSE');
        return {
          stocks: snap.stocksSample || validStocks,
          gainers: snap.gainers,
          losers: snap.losers || [],
          summary: snap.summary || {
            total: 0, gainersCount: 0, losersCount: 0, avgChange: 0, sectors: 0,
          },
          source: 'KV Snapshot · ' + dateLabel,
          source_fallback: true,
          effectiveTradingDate: effectiveDate,
          effectiveTradingLabel: dateLabel,
          updatedAt: snap.generated_at || new Date().toISOString(),
        };
      }
    } catch { /* fall through to normal empty */ }
  }

  return {
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
    marketOpen,
    effectiveTradingDate: effectiveDate,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchUSDataWithCache() {
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
      // PATCH 0445 BUG-020/037 — optional columns
      week52High: q?.fiftyTwoWeekHigh ?? null,
      week52Low: q?.fiftyTwoWeekLow ?? null,
      peRatio: q?.trailingPE ?? null,
      avgVolume: q?.averageDailyVolume3Month ?? null,
    };
  }).filter(s => s.price > 0);

  const sorted = [...stocks].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.filter(s => s.changePercent > 0);
  const losers = sorted.filter(s => s.changePercent < 0).reverse();

  return {
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
  };
}
