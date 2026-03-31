import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// Order keywords to detect business orders and contracts
const ORDER_KEYWORDS = [
  'order',
  'contract',
  'awarded',
  'loi',
  'letter of intent',
  'agreement',
  'deal value',
  'capex',
  'joint venture',
  'jv',
  'partnership',
  'mou',
  'memorandum',
  'supply agreement',
  'work order',
  'purchase order',
  'mandate',
  'issued',
  'obtained',
  'signed',
];

interface CorporateOrder {
  symbol: string;
  company: string;
  subject: string;
  description: string;
  date: string;
  orderType: 'Order Win' | 'Contract' | 'Partnership/JV' | 'Capex' | 'LOI' | 'Other';
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
  isWatchlist: boolean;
  nseUrl: string;
}

interface CorporateOrdersResponse {
  orders: CorporateOrder[];
  summary: {
    total: number;
    orderWins: number;
    contracts: number;
    partnerships: number;
    watchlistHits: number;
  };
  updatedAt: string;
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
 * Classify announcement based on keywords
 */
function classifyOrderType(subject: string, description: string): 'Order Win' | 'Contract' | 'Partnership/JV' | 'Capex' | 'LOI' | 'Other' {
  const combined = `${subject} ${description}`.toLowerCase();

  if (combined.includes('letter of intent') || combined.includes('loi')) return 'LOI';
  if (combined.includes('joint venture') || combined.includes('jv') || combined.includes('partnership')) return 'Partnership/JV';
  if (combined.includes('capex') || combined.includes('capital expenditure')) return 'Capex';
  if (combined.includes('contract')) return 'Contract';
  if (combined.includes('order') || combined.includes('awarded')) return 'Order Win';

  return 'Other';
}

/**
 * Calculate importance based on keyword quality
 */
function calculateImportance(subject: string, description: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const combined = `${subject} ${description}`.toLowerCase();

  // HIGH: multiple relevant keywords or specific order mentions
  const highKeywords = ['order', 'contract', 'awarded', 'loi', 'letter of intent', 'partnership', 'jv'];
  const highMatches = highKeywords.filter(k => combined.includes(k)).length;

  if (highMatches >= 2) return 'HIGH';
  if (highMatches === 1) return 'MEDIUM';
  return 'LOW';
}

/**
 * Filter announcements for order-related keywords
 */
function filterForOrders(announcements: any[]): CorporateOrder[] {
  if (!announcements || announcements.length === 0) return [];

  return announcements
    .filter(item => {
      if (!item.symbol || (!item.desc && !item.subject)) return false;

      const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
      return ORDER_KEYWORDS.some(keyword => combined.includes(keyword));
    })
    .map(item => {
      const subject = item.subject || item.newName || '';
      const description = item.desc || item.attachmentname || '';

      return {
        symbol: item.symbol || '',
        company: item.companyName || item.company || item.symbol || '',
        subject: subject,
        description: description,
        date: item.date || item.exDate || item.expiryDate || new Date().toISOString().split('T')[0],
        orderType: classifyOrderType(subject, description),
        importance: calculateImportance(subject, description),
        isWatchlist: false, // Will be set after
        nseUrl: `https://www.nseindia.com/corporate/announcements.jsp?symbol=${encodeURIComponent(item.symbol || '')}`,
      };
    });
}

/**
 * Main GET handler
 */
export async function GET(request: Request): Promise<NextResponse<CorporateOrdersResponse>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const watchlistParam = searchParams.get('watchlist');
    const days = parseInt(searchParams.get('days') || '30');

    // 1. Parse watchlist
    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    console.log(`[CorporateOrders] Fetching corporate announcements for ${watchlist.length} watchlist stocks, last ${days} days`);

    // 2. Fetch corporate announcements for date range
    const fromDate = getDateDaysAgo(days);
    const toDate = getTodayDate();

    let allAnnouncements: any[] = [];

    // Try fetching general corporate announcements for the date range
    try {
      const generalData = await nseApiFetch(
        `/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}`,
        300000
      );

      if (generalData) {
        const arr = Array.isArray(generalData) ? generalData : (generalData?.data || []);
        allAnnouncements.push(...arr);
      }
    } catch (e) {
      console.log('[CorporateOrders] Could not fetch general announcements:', e);
    }

    // 3. Fetch per-symbol announcements for watchlist stocks
    if (watchlist.length > 0) {
      console.log(`[CorporateOrders] Fetching per-symbol announcements for watchlist: ${watchlist.join(',')}`);

      const symbolBatchSize = 3;
      for (let i = 0; i < watchlist.length; i += symbolBatchSize) {
        const batch = watchlist.slice(i, i + symbolBatchSize);

        const results = await Promise.all(
          batch.map(async sym => {
            try {
              const data = await nseApiFetch(
                `/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(sym)}`,
                300000
              );

              if (data) {
                return Array.isArray(data) ? data : (data?.data || []);
              }
              return [];
            } catch (e) {
              console.log(`[CorporateOrders] Error fetching symbol ${sym}:`, e);
              return [];
            }
          })
        );

        for (const batch of results) {
          allAnnouncements.push(...(Array.isArray(batch) ? batch : []));
        }

        // Rate limiting
        if (i + symbolBatchSize < watchlist.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // 4. Filter for orders and deduplicate
    const orders = filterForOrders(allAnnouncements);
    const seen = new Set<string>();
    const uniqueOrders: CorporateOrder[] = [];

    for (const order of orders) {
      const key = `${order.symbol}:${order.subject}:${order.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        order.isWatchlist = watchlist.includes(order.symbol);
        uniqueOrders.push(order);
      }
    }

    // 5. Sort by: watchlist first, then by date desc
    uniqueOrders.sort((a, b) => {
      if (a.isWatchlist !== b.isWatchlist) {
        return a.isWatchlist ? -1 : 1;
      }
      // Parse dates (format: DD-MM-YYYY or ISO)
      const dateA = new Date(a.date.includes('-') && !a.date.includes('T')
        ? a.date.split('-').reverse().join('-')
        : a.date);
      const dateB = new Date(b.date.includes('-') && !b.date.includes('T')
        ? b.date.split('-').reverse().join('-')
        : b.date);
      return dateB.getTime() - dateA.getTime();
    });

    // 6. Calculate summary
    const summary = {
      total: uniqueOrders.length,
      orderWins: uniqueOrders.filter(o => o.orderType === 'Order Win').length,
      contracts: uniqueOrders.filter(o => o.orderType === 'Contract').length,
      partnerships: uniqueOrders.filter(o => o.orderType === 'Partnership/JV').length,
      watchlistHits: uniqueOrders.filter(o => o.isWatchlist).length,
    };

    const response: CorporateOrdersResponse = {
      orders: uniqueOrders.slice(0, 100), // Limit to 100 orders
      summary,
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[CorporateOrders] Success: ${uniqueOrders.length} orders found in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[CorporateOrders] Fatal error after ${duration}ms:`, error);

    return NextResponse.json({
      orders: [],
      summary: { total: 0, orderWins: 0, contracts: 0, partnerships: 0, watchlistHits: 0 },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
