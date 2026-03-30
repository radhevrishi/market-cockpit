import { NextResponse } from 'next/server';
import { nseApiFetch, fetchNifty50, fetchNiftyMidcap50, fetchNiftyMidcap100, fetchNiftySmallcap250 } from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

interface OrdersTicker {
  symbol: string;
  company: string;
  sector: string;
  price: number;
  changePct: number;
  change: number;
  volume: number;
  volumeAvgRatio: number;
  ordersCount: number;
  newsCount: number;
  hasHighSignal: boolean;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
}

interface OrdersGroup {
  name: string;
  label: string;
  tickers: OrdersTicker[];
}

interface OrdersResponse {
  groups: OrdersGroup[];
  deals: {
    block: any[];
    bulk: any[];
  };
  summary: {
    totalStocks: number;
    totalOrders: number;
    totalNews: number;
    highSignalCount: number;
  };
  updatedAt: string;
}

// Default watchlist
const DEFAULT_WATCHLIST = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'BAJFINANCE', 'TATAMOTORS', 'LT', 'SBIN', 'AXISBANK',
  'SUNPHARMA', 'TITAN', 'WIPRO', 'MARUTI', 'HCLTECH',
];

/**
 * Map NSE stock data to OrdersTicker format
 */
function mapStockData(item: any, sector: string = ''): OrdersTicker {
  return {
    symbol: item.symbol || '',
    company: item.meta?.companyName || item.companyName || item.symbol || '',
    sector: sector || item.meta?.industry || '',
    price: item.lastPrice || item.ltP || 0,
    changePct: item.pChange || item.per || 0,
    change: item.change || item.netP || 0,
    volume: item.totalTradedVolume || item.trdVol || 0,
    volumeAvgRatio: 0, // Calculated after
    ordersCount: 0,     // Enriched later
    newsCount: 0,       // Enriched later
    hasHighSignal: false,
    dayHigh: item.dayHigh || item.high || 0,
    dayLow: item.dayLow || item.low || 0,
    previousClose: item.previousClose || item.prevCls || 0,
  };
}

/**
 * Fetch block and bulk deals from NSE
 */
async function fetchDeals(): Promise<{ block: any[]; bulk: any[] }> {
  const [blockData, bulkData] = await Promise.all([
    nseApiFetch('/api/block-deal', 60000),
    nseApiFetch('/api/bulk-deal', 60000),
  ]);

  const block = (blockData?.data || []).map((d: any) => ({
    symbol: d.symbol || d.BD_SYMBOL || '',
    clientName: d.clientName || d.BD_CLIENT_NAME || '',
    quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
    tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
    buyOrSell: (d.buySell || d.BD_BUY_SELL || '').trim(),
    dealDate: d.dealDate || d.BD_DT_DATE || '',
    type: 'Block' as const,
  }));

  const bulk = (bulkData?.data || []).map((d: any) => ({
    symbol: d.symbol || d.BD_SYMBOL || '',
    clientName: d.clientName || d.BD_CLIENT_NAME || '',
    quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
    tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
    buyOrSell: (d.buySell || d.BD_BUY_SELL || '').trim(),
    dealDate: d.dealDate || d.BD_DT_DATE || '',
    type: 'Bulk' as const,
  }));

  return { block, bulk };
}

/**
 * Fetch news counts per symbol from company-news API
 */
async function fetchNewsCounts(symbols: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  try {
    // Batch symbols to avoid URL length limits
    const batchSize = 30;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      const data = await nseApiFetch(
        `/api/corporates-announcements?index=equities&from_date=${getDateDaysAgo(30)}&to_date=${getTodayDate()}`,
        300000
      );

      if (data) {
        const items = Array.isArray(data) ? data : (data?.data || []);
        for (const item of items) {
          const sym = item.symbol || '';
          if (batch.includes(sym)) {
            counts.set(sym, (counts.get(sym) || 0) + 1);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Orders] Error fetching news counts:', e);
  }

  return counts;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function getTodayDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

/**
 * Main GET handler
 */
export async function GET(request: Request): Promise<NextResponse<OrdersResponse>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const watchlistParam = searchParams.get('watchlist');
    const days = parseInt(searchParams.get('days') || '30');

    // 1. Get watchlist
    let watchlist: string[] = DEFAULT_WATCHLIST;
    if (watchlistParam) {
      watchlist = watchlistParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    }

    console.log(`[Orders] Fetching data for ${watchlist.length} watchlist stocks + indices`);

    // 2. Fetch all data in parallel
    const [nifty50Data, midcap50Data, midcap100Data, smallcap250Data, deals] = await Promise.all([
      fetchNifty50(),
      fetchNiftyMidcap50(),
      fetchNiftyMidcap100(),
      fetchNiftySmallcap250(),
      fetchDeals(),
    ]);

    // 3. Build stock maps from index data
    const allStocksMap = new Map<string, { data: any; source: string }>();

    // Process Nifty 50
    const n50Stocks = nifty50Data?.data || [];
    for (const item of n50Stocks) {
      if (item.symbol) {
        allStocksMap.set(item.symbol, { data: item, source: 'nifty50' });
      }
    }

    // Process Midcap 150 (Midcap 50 + Midcap 100)
    const mid50 = midcap50Data?.data || [];
    const mid100 = midcap100Data?.data || [];
    const midcapStocks = [...mid50, ...mid100];
    for (const item of midcapStocks) {
      if (item.symbol && !allStocksMap.has(item.symbol)) {
        allStocksMap.set(item.symbol, { data: item, source: 'midcap150' });
      }
    }

    // Process Smallcap 250
    const sc250 = smallcap250Data?.data || [];
    for (const item of sc250) {
      if (item.symbol && !allStocksMap.has(item.symbol)) {
        allStocksMap.set(item.symbol, { data: item, source: 'smallcap250' });
      }
    }

    // 4. Build deal counts per symbol
    const dealCounts = new Map<string, number>();
    const allDeals = [...deals.block, ...deals.bulk];
    for (const deal of allDeals) {
      if (deal.symbol) {
        dealCounts.set(deal.symbol, (dealCounts.get(deal.symbol) || 0) + 1);
      }
    }

    // 5. Build groups with strict priority deduplication
    const seen = new Set<string>();

    // Group 1: Watchlist
    const watchlistTickers: OrdersTicker[] = [];
    for (const sym of watchlist) {
      if (seen.has(sym)) continue;
      seen.add(sym);

      const stockInfo = allStocksMap.get(sym);
      if (stockInfo) {
        const ticker = mapStockData(stockInfo.data);
        ticker.ordersCount = dealCounts.get(sym) || 0;
        ticker.hasHighSignal = ticker.ordersCount > 0 || Math.abs(ticker.changePct) > 3;
        watchlistTickers.push(ticker);
      } else {
        // Watchlist stock not in any index — add with minimal data
        watchlistTickers.push({
          symbol: sym,
          company: sym,
          sector: '',
          price: 0,
          changePct: 0,
          change: 0,
          volume: 0,
          volumeAvgRatio: 0,
          ordersCount: dealCounts.get(sym) || 0,
          newsCount: 0,
          hasHighSignal: false,
          dayHigh: 0,
          dayLow: 0,
          previousClose: 0,
        });
      }
    }

    // Group 2: Nifty 50 (excluding watchlist)
    const nifty50Tickers: OrdersTicker[] = [];
    for (const item of n50Stocks) {
      const sym = item.symbol;
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      const ticker = mapStockData(item);
      ticker.ordersCount = dealCounts.get(sym) || 0;
      ticker.hasHighSignal = ticker.ordersCount > 0 || Math.abs(ticker.changePct) > 3;
      nifty50Tickers.push(ticker);
    }

    // Group 3: Midcap 150 (excluding above)
    const midcap150Tickers: OrdersTicker[] = [];
    for (const item of midcapStocks) {
      const sym = item.symbol;
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      const ticker = mapStockData(item);
      ticker.ordersCount = dealCounts.get(sym) || 0;
      ticker.hasHighSignal = ticker.ordersCount > 0 || Math.abs(ticker.changePct) > 4;
      midcap150Tickers.push(ticker);
    }

    // Group 4: Smallcap 250 (excluding above)
    const smallcap250Tickers: OrdersTicker[] = [];
    for (const item of sc250) {
      const sym = item.symbol;
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      const ticker = mapStockData(item);
      ticker.ordersCount = dealCounts.get(sym) || 0;
      ticker.hasHighSignal = ticker.ordersCount > 0 || Math.abs(ticker.changePct) > 5;
      smallcap250Tickers.push(ticker);
    }

    // 6. Sort each group by ordersCount desc, then changePct desc
    const sortGroup = (arr: OrdersTicker[]) =>
      arr.sort((a, b) => {
        if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
        return Math.abs(b.changePct) - Math.abs(a.changePct);
      });

    sortGroup(watchlistTickers);
    sortGroup(nifty50Tickers);
    sortGroup(midcap150Tickers);
    sortGroup(smallcap250Tickers);

    const groups: OrdersGroup[] = [
      { name: 'watchlist', label: 'My Watchlist', tickers: watchlistTickers },
      { name: 'nifty50', label: 'Nifty 50', tickers: nifty50Tickers },
      { name: 'midcap150', label: 'Nifty Midcap 150', tickers: midcap150Tickers },
      { name: 'smallcap250', label: 'Nifty Smallcap 250', tickers: smallcap250Tickers },
    ];

    const totalStocks = groups.reduce((sum, g) => sum + g.tickers.length, 0);
    const totalOrders = allDeals.length;
    const highSignalCount = groups.reduce((sum, g) => sum + g.tickers.filter(t => t.hasHighSignal).length, 0);

    const response: OrdersResponse = {
      groups,
      deals: {
        block: deals.block.slice(0, 50),
        bulk: deals.bulk.slice(0, 50),
      },
      summary: {
        totalStocks,
        totalOrders,
        totalNews: 0,
        highSignalCount,
      },
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[Orders] Success: ${totalStocks} stocks, ${totalOrders} deals in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Orders] Fatal error after ${duration}ms:`, error);

    return NextResponse.json({
      groups: [],
      deals: { block: [], bulk: [] },
      summary: { totalStocks: 0, totalOrders: 0, totalNews: 0, highSignalCount: 0 },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
