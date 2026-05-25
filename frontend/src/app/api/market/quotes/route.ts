import { NextResponse } from 'next/server';
import { fetchNifty50, fetchNiftyNext50, fetchNifty500, fetchNifty200, fetchNiftyMidcap50, fetchNiftyMidcap100, fetchNiftyMidcap250, fetchNiftySmallcap50, fetchNiftySmallcap100, fetchNiftySmallcap250, fetchNiftyMicrocap250, fetchNiftyTotalMarket, fetchGainers, fetchLosers, buildDynamicSectorMap, normalizeSector, NIFTY50_SECTORS } from '@/lib/nse';
import { fetchQuotesWithFallback, US_TOP } from '@/lib/yahoo';
// PATCH 0782 — KV blob primary source (populated by GH Actions scraper).
import { kvGet } from '@/lib/kv';
// PATCH 0812 — during market hours we want live Yahoo prices, not EOD blob.
import { isIndianMarketOpen } from '@/lib/market-hours';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // PATCH 0789 — Yahoo bulk for ~2000 tickers (NSE master) needs up to 60s

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
  // ─── Live NSE primary path (tried FIRST) ────────────────────────────
  // When NSE upstream is healthy (weekdays), this returns ~750 stocks
  // with live intraday pChange + full cap classification. When NSE
  // fails (weekends, rate limiting), we fall through to the KV ticker
  // blob + Vercel-side Yahoo price fetch below.
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

  // ─── PATCH 0786 — KV ticker-universe blob → Yahoo prices ────────────
  // When live NSE returned <50 stocks (broad indices blocked / rate-limited),
  // try the GH-Actions-populated ticker→cap blob. NSE constituent CSVs from
  // archives.nseindia.com ARE accessible from GH IPs (confirmed in run #3).
  // We use that ticker list + Yahoo for prices (Vercel→Yahoo works fine,
  // proven by /api/market/quote endpoint). Result: 500+ stocks with proper
  // cap labels (Large/Mid/Small) and real last-close % moves.
  if (stocks.length < 100) {
    try {
      const universeBlob = await kvGet<any>('nse-ticker-universe:v1:latest');
      const tickers: Array<any> = universeBlob?.tickers || [];
      // PATCH 0798 — also read rolling-stats blob for vol20D/mom1M/52w% enrichment.
      // Optional — engine degrades gracefully if blob missing or stale.
      const rollingBlob = await kvGet<any>('nse-rolling-stats:v1:latest').catch(() => null);
      const rollingStats: Record<string, any> = rollingBlob?.stats || {};
      // PATCH 0800 — fundamentals are stored per-ticker (not a single blob).
      // We DON'T pre-fetch all 2000 here — too many KV reads. Instead the
      // ticker payload includes a hasFundamentals flag, and downstream
      // consumers (home page client, stock-sheet) can fetch the per-ticker
      // key on demand for the few rows they care about.
      if (tickers.length >= 100) {
        const universeAgeMs = Date.now() - new Date(universeBlob?.generatedAt || 0).getTime();
        const universeAgeStr = `${Math.round(universeAgeMs / 60_000)}m old`;
        // PATCH 0790 — KV blob now carries EOD prices (BHAVCOPY). Use those
        // directly; skip Yahoo entirely. Yahoo enrichment only fires for
        // tickers without embedded prices (rare, ~0 after BHAVCOPY phase
        // runs successfully).
        // PATCH 0812 — during Indian market hours, the BHAVCOPY price in the
        // blob is yesterday's close (T-1). Force Yahoo enrichment for the
        // 100 largecap names every request so the top of the page is live
        // intraday. Smallcap/midcap continue to use blob EOD to stay within
        // Yahoo rate limits + Vercel maxDuration.
        // PATCH 0814: top-500-by-turnover live refresh.
        // P0813 only covered cap='Large' (100 names), which left ~2,200 smallcap
        // names showing yesterday's BHAVCOPY close even when market was open.
        // Now we sort by today's turnoverLacs and live-refresh the top 500 most
        // liquid names — that captures both the largecap leaders AND the
        // smallcap movers (LAXMIDENTL, RAMCOSYS, SPARC class) that drive the
        // /movers page. 500 names ÷ 50/batch × 1.5s = ~15s, comfortably under
        // the 60s Vercel budget.
        const marketOpen = isIndianMarketOpen();
        const pricedFromBlob = tickers.filter((t: any) => t.hasPrice && (t.price ?? 0) > 0);
        // Build live-refresh list: top 500 by turnoverLacs + ALL largecaps
        // (so even no-volume largecaps like ITC during quiet hours stay live)
        const liveSyms: string[] = [];
        if (marketOpen) {
          const topByTurnover = tickers
            .slice()
            .sort((a: any, b: any) => (b.turnoverLacs || 0) - (a.turnoverLacs || 0))
            .slice(0, 500);
          for (const t of topByTurnover) liveSyms.push(`${t.ticker}.NS`);
          for (const t of tickers) {
            if ((t.cap || '').toLowerCase() === 'large') liveSyms.push(`${t.ticker}.NS`);
          }
        }
        const unpricedSyms = tickers.filter((t: any) => !t.hasPrice).map((t: any) => `${t.ticker}.NS`);
        // Combine, dedupe, cap.
        const yahooSymsSet = new Set<string>([...liveSyms, ...unpricedSyms]);
        const yahooSyms = Array.from(yahooSymsSet);
        let yahooMap = new Map<string, any>();
        if (yahooSyms.length > 0) {
          // PATCH 0791/0812: Yahoo enrichment for unpriced + live-largecap.
          // At CONC=4 × ~25 batches × 1.5s = ~40s for 100 largecaps;
          // total budget bounded by Vercel maxDuration=60s.
          const cap = Math.min(yahooSyms.length, 1500);
          try {
            const quotes = await fetchQuotesWithFallback(yahooSyms.slice(0, cap));
            for (const q of quotes) {
              const raw = (q?.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
              if (raw) yahooMap.set(raw, q);
            }
          } catch { /* Yahoo failure tolerated — we have blob prices */ }
        }

        const mergedStocks: any[] = [];
        for (const t of tickers) {
          let price = 0, prevClose = 0, change = 0, changePercent = 0;
          let volume = 0, marketCap = 0, open = 0, dayHigh = 0, dayLow = 0, yearHigh = 0, yearLow = 0;
          let companyFromYahoo = '';

          // PATCH 0812 — prefer LIVE Yahoo over blob EOD when market open
          const liveQ = marketOpen ? yahooMap.get(t.ticker) : null;
          if (liveQ && liveQ.regularMarketPrice > 0) {
            // Live intraday from Yahoo during market hours
            price = liveQ.regularMarketPrice || 0;
            prevClose = liveQ.regularMarketPreviousClose || t.previousClose || 0;
            const reportedChg = Number.isFinite(liveQ.regularMarketChange) ? liveQ.regularMarketChange : 0;
            const reportedPct = Number.isFinite(liveQ.regularMarketChangePercent) ? liveQ.regularMarketChangePercent : 0;
            const computedChg = (price > 0 && prevClose > 0) ? (price - prevClose) : 0;
            const computedPct = (price > 0 && prevClose > 0) ? ((price - prevClose) / prevClose) * 100 : 0;
            change = reportedChg !== 0 ? reportedChg : computedChg;
            changePercent = reportedPct !== 0 ? reportedPct : computedPct;
            volume = liveQ.regularMarketVolume || t.volume || 0;
            marketCap = liveQ.marketCap || 0;
            open = liveQ.regularMarketOpen || t.open || 0;
            dayHigh = liveQ.regularMarketDayHigh || t.dayHigh || 0;
            dayLow = liveQ.regularMarketDayLow || t.dayLow || 0;
            yearHigh = liveQ.fiftyTwoWeekHigh || 0;
            yearLow = liveQ.fiftyTwoWeekLow || 0;
            companyFromYahoo = liveQ.shortName || '';
          } else if (t.hasPrice && (t.price ?? 0) > 0) {
            // EOD from BHAVCOPY (canonical NSE source) — when market closed
            price = t.price;
            prevClose = t.previousClose || 0;
            change = t.change || 0;
            changePercent = t.changePercent || 0;
            volume = t.volume || 0;
            open = t.open || 0;
            dayHigh = t.dayHigh || 0;
            dayLow = t.dayLow || 0;
          } else {
            // Yahoo enrichment for missing prices
            const q = yahooMap.get(t.ticker);
            if (!q || !(q.regularMarketPrice > 0)) continue;
            price = q.regularMarketPrice || 0;
            prevClose = q.regularMarketPreviousClose || 0;
            const reportedChg = Number.isFinite(q.regularMarketChange) ? q.regularMarketChange : 0;
            const reportedPct = Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : 0;
            const computedChg = (price > 0 && prevClose > 0) ? (price - prevClose) : 0;
            const computedPct = (price > 0 && prevClose > 0) ? ((price - prevClose) / prevClose) * 100 : 0;
            change = reportedChg !== 0 ? reportedChg : computedChg;
            changePercent = reportedPct !== 0 ? reportedPct : computedPct;
            volume = q.regularMarketVolume || 0;
            marketCap = q.marketCap || 0;
            open = q.regularMarketOpen || 0;
            dayHigh = q.regularMarketDayHigh || 0;
            dayLow = q.regularMarketDayLow || 0;
            yearHigh = q.fiftyTwoWeekHigh || 0;
            yearLow = q.fiftyTwoWeekLow || 0;
            companyFromYahoo = q.shortName || '';
          }

          const sector = sectorMap[t.ticker] || normalizeSector(t.industry || '') || NIFTY50_SECTORS[t.ticker] || 'Other';
          // Cap derivation: index-canonical first; for 'Other' use mcap if available
          let cap = t.cap;
          if (cap === 'Other' || !cap) {
            const mcapCr = marketCap ? marketCap / 1e7 : 0;
            if (mcapCr > 50_000)      cap = 'Large';
            else if (mcapCr > 15_000) cap = 'Mid';
            else if (mcapCr > 2_000)  cap = 'Small';
            else                       cap = 'Micro';
          }
          // PATCH 0798: merge rolling stats if available
          const rs = rollingStats[t.ticker];
          mergedStocks.push({
            ticker: t.ticker,
            company: t.company || companyFromYahoo || t.ticker,
            sector,
            industry: t.industry || '',
            price,
            change,
            changePercent,
            volume,
            marketCap,
            previousClose: prevClose,
            open,
            dayHigh,
            dayLow,
            yearHigh: yearHigh || rs?.high52w || 0,
            yearLow: yearLow || rs?.low52w || 0,
            indexGroup: cap,
            // PATCH 0797: delivery + turnover
            deliveryPct: (t as any).deliveryPct ?? null,
            turnoverLacs: (t as any).turnoverLacs ?? 0,
            // PATCH 0798: rolling stats (null when blob not yet populated)
            vol20DAvg: rs?.vol20DAvg ?? null,
            volMultiple: rs?.volMultiple ?? null,
            mom1M: rs?.mom1M ?? null,
            pctOf52wHigh: rs?.pctOf52wHigh ?? null,
          });
        }
        // Lower threshold from 100 to 30 — partial result is better than NIFTY-50
        // last-resort which is also Yahoo-dependent.
        if (mergedStocks.length >= 30) {
          const gainers = [...mergedStocks].sort((a, b) => b.changePercent - a.changePercent).filter((s: any) => s.changePercent > 0).slice(0, 30);
          const losers  = [...mergedStocks].sort((a, b) => a.changePercent - b.changePercent).filter((s: any) => s.changePercent < 0).slice(0, 30);
          return {
            stocks: mergedStocks,
            gainers,
            losers,
            summary: {
              total: mergedStocks.length,
              gainersCount: gainers.length,
              losersCount: losers.length,
              avgChange: mergedStocks.length ? mergedStocks.reduce((s: number, x: any) => s + (x.changePercent || 0), 0) / mergedStocks.length : 0,
              sectors: new Set(mergedStocks.map((s: any) => s.sector)).size,
            },
            source: `NSE-universe (KV ${universeAgeStr}) + BHAVCOPY/${universeBlob.pricedCount || 0} + Yahoo ${marketOpen ? 'LIVE' : 'enrich'}/${yahooMap.size}${marketOpen ? ' (top-500 + largecaps live)' : ''}`,
            updatedAt: new Date().toISOString(),
          };
        }
      }
    } catch { /* fall through to NIFTY 50 Yahoo last-resort */ }
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
