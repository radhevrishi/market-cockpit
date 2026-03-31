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
  orderValue: number | null; // in Crores, if parseable
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

/** Robust date parser for NSE dates (DD-Mon-YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.) */
function parseNSEDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  // DD-Mon-YYYY (e.g. "31-Mar-2026 09:15")
  const monMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (monMatch) {
    const d = new Date(`${monMatch[2]} ${monMatch[1]}, ${monMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // DD-MM-YYYY
  const ddmmyyyy = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (ddmmyyyy) {
    const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
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
 * Parse order value from description (in Crores)
 * Looks for patterns like "Rs. 500 crore", "₹1,200 Cr", "INR 50 Mn" etc.
 */
function parseOrderValue(text: string): number | null {
  if (!text) return null;
  const combined = text.toLowerCase();

  // Pattern: Rs/₹/INR followed by number and unit
  const crMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr)/i);
  if (crMatch) return parseFloat(crMatch[1].replace(/,/g, ''));

  const lMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lMatch) return parseFloat(lMatch[1].replace(/,/g, '')) / 100; // Convert lakh to Cr

  // USD million — e.g. "USD 100M deal", "$50 million"
  const usdMnMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (usdMnMatch) {
    const val = parseFloat(usdMnMatch[1].replace(/,/g, ''));
    return val * 8.5; // ~85 INR/USD, then /10 for Cr
  }

  // INR million — e.g. "Rs. 500 million"
  const inrMnMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (inrMnMatch) {
    const val = parseFloat(inrMnMatch[1].replace(/,/g, ''));
    return val / 10; // INR million to Cr
  }

  // USD billion — e.g. "USD 2 Bn"
  const usdBnMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (usdBnMatch) {
    const val = parseFloat(usdBnMatch[1].replace(/,/g, ''));
    return val * 8500; // ~85 INR/USD * 100 for Cr
  }

  // INR billion — e.g. "Rs. 10 Bn"
  const inrBnMatch = combined.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (inrBnMatch) {
    const val = parseFloat(inrBnMatch[1].replace(/,/g, ''));
    return val * 100; // INR billion to Cr
  }

  // Plain USD with no unit — e.g. "USD 500" (assume millions if > 1)
  const plainUsdMatch = combined.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\b/i);
  if (plainUsdMatch) {
    const val = parseFloat(plainUsdMatch[1].replace(/,/g, ''));
    if (val >= 1000) return val * 0.085; // Likely in millions already (USD to Cr)
  }

  return null;
}

/**
 * HYBRID IMPORTANCE SCORING
 * Score = f(value, keywords, deal characteristics)
 * Uses a points-based system for nuanced classification:
 *   - Order value (if parseable): 0-50 points
 *   - Strategic keywords: 0-30 points
 *   - Business keywords: 0-20 points
 *   - Noise keywords: negative points
 *
 * Final: HIGH ≥ 40pts, MEDIUM ≥ 20pts, LOW < 20pts
 */
function calculateImportance(subject: string, description: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const combined = `${subject} ${description}`.toLowerCase();
  let score = 0;

  // ── Layer 1: Order Value (0-50 points) ──
  const orderValue = parseOrderValue(combined);
  if (orderValue !== null) {
    if (orderValue >= 500) score += 50;       // ₹500 Cr+ = massive
    else if (orderValue >= 100) score += 40;  // ₹100 Cr+ = large
    else if (orderValue >= 50) score += 30;   // ₹50 Cr+
    else if (orderValue >= 10) score += 20;   // ₹10 Cr+
    else score += 5;                           // Small but quantified
  }

  // ── Layer 2: Strategic Keywords (0-30 points) ──
  const strategicHigh: [string, number][] = [
    ['strategic', 15],
    ['multi-year', 15],
    ['multi year', 15],
    ['defence', 15],
    ['defense', 15],
    ['exclusive', 12],
    ['large order', 12],
    ['bagging/receiving of orders', 12],
    ['awarded', 10],
    ['secured', 10],
    ['won', 8],
    ['government', 10],
    ['railway', 10],
    ['export order', 10],
    ['international', 8],
    ['acquisition', 10],
    ['repeat order', 8],
    ['follow-on', 8],
    ['rate contract', 8],
  ];

  let strategicScore = 0;
  for (const [keyword, points] of strategicHigh) {
    if (combined.includes(keyword)) {
      strategicScore += points;
    }
  }
  score += Math.min(strategicScore, 30); // Cap at 30

  // ── Layer 3: Business Keywords (0-20 points) ──
  const businessKeywords: [string, number][] = [
    ['order', 8],
    ['contract', 8],
    ['loi', 6],
    ['letter of intent', 6],
    ['partnership', 6],
    ['jv', 5],
    ['joint venture', 6],
    ['supply', 5],
    ['mandate', 5],
    ['work order', 8],
    ['purchase order', 8],
    ['deal', 6],
  ];

  let businessScore = 0;
  for (const [keyword, points] of businessKeywords) {
    if (combined.includes(keyword)) {
      businessScore += points;
    }
  }
  score += Math.min(businessScore, 20); // Cap at 20

  // ── Layer 4: Noise / Negative Signals ──
  const noiseKeywords: [string, number][] = [
    ['rumour verification', -15],
    ['regulation 30', -10],
    ['action(s) taken', -8],
    ['action(s) initiated', -8],
    ['clarification', -5],
    ['disclosure', -3],
    ['update', -2],
    ['amendment', -3],
    ['addendum', -3],
  ];

  for (const [keyword, penalty] of noiseKeywords) {
    if (combined.includes(keyword)) {
      score += penalty; // negative
    }
  }

  // ── Layer 5: Undisclosed value signals ──
  // If no numeric value found but strong contextual clues
  if (orderValue === null) {
    if (combined.includes('undisclosed') || combined.includes('significant')) score += 8;
    if (combined.includes('crore') || combined.includes('million') || combined.includes('billion')) score += 5;
  }

  // ── Final Classification ──
  if (score >= 40) return 'HIGH';
  if (score >= 20) return 'MEDIUM';
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

      const combinedText = `${subject} ${description}`;
      return {
        symbol: item.symbol || '',
        company: item.companyName || item.company || item.symbol || '',
        subject: subject,
        description: description,
        date: item.date || item.exDate || item.expiryDate || new Date().toISOString().split('T')[0],
        orderType: classifyOrderType(subject, description),
        importance: calculateImportance(subject, description),
        orderValue: parseOrderValue(combinedText),
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
      const key = `${order.symbol}:${order.subject || order.description}:${order.date}`;
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
      const dateA = parseNSEDate(a.date);
      const dateB = parseNSEDate(b.date);
      return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
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
