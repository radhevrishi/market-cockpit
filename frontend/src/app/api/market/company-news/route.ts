import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

interface NewsItem {
  id: string;
  ticker: string;
  company: string;
  headline: string;
  description: string;
  category: string;
  date: string;
  importance: 'high' | 'medium' | 'low';
  source: string;
}

interface AnnouncementData {
  news: NewsItem[];
  summary: {
    totalItems: number;
    companiesCovered: number;
    topCategories: string[];
  };
  updatedAt: string;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Financial Results': ['financial result', 'quarterly result', 'q1', 'q2', 'q3', 'q4', 'fy', 'result', 'earnings'],
  'Orders & Contracts': ['order', 'contract', 'awarded', 'awarded contract', 'secured order'],
  'M&A': ['acquisition', 'merger', 'amalgamation', 'business combination', 'strategic acquisition'],
  'Dividend': ['dividend', 'special dividend', 'interim dividend', 'final dividend'],
  'Buyback': ['buyback', 'buy back', 'share buyback', 'stock buyback'],
  'Fund Raising': ['fund raising', 'qip', 'rights issue', 'capital raising', 'public issue', 'ipo'],
  'Board Meeting': ['board meeting', 'board outcome', 'board decision', 'board approval'],
  'Credit Rating': ['credit rating', 'rating upgrade', 'rating downgrade', 'rating change'],
  'Management Change': ['appointment', 'resignation', 'cessation', 'md', 'ceo', 'director', 'chief executive'],
  'Corporate Action': ['stock split', 'bonus', 'sub-division', 'share split', 'stock bonus'],
};

const NOISE_KEYWORDS = [
  'trading window',
  'lodr',
  'regulatory filing',
  'investor presentation',
  'compliance',
  'notice',
  'information',
  'reminder',
  'intimation',
  'announcement of meeting',
];

const IMPORTANCE_HIGH_KEYWORDS = [
  'financial result',
  'order',
  'contract',
  'acquisition',
  'merger',
  'amalgamation',
  'fund raising',
  'qip',
  'rights issue',
];

/**
 * Categorize announcement based on content
 */
function categorizeAnnouncement(headline: string, description: string = ''): string {
  const text = (headline + ' ' + description).toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      return category;
    }
  }

  return 'Corporate Update';
}

/**
 * Check if announcement is noise
 */
function isNoise(headline: string, description: string = ''): boolean {
  const text = (headline + ' ' + description).toLowerCase();
  return NOISE_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Score importance of announcement
 */
function scoreImportance(
  headline: string,
  category: string,
  description: string = ''
): 'high' | 'medium' | 'low' {
  const text = (headline + ' ' + description).toLowerCase();

  // High importance categories
  if (['Financial Results', 'M&A', 'Orders & Contracts'].includes(category)) {
    return 'high';
  }

  // Check for large fund raising amounts
  if (category === 'Fund Raising') {
    const amountMatch = text.match(/₹[\s]?([\d,]+)\s*(cr|crore|lakh)/i);
    if (amountMatch) {
      const amount = parseInt(amountMatch[1].replace(/,/g, ''));
      if (amount >= 100) return 'high';
    }
    return 'medium';
  }

  // Medium importance categories
  if (['Dividend', 'Buyback', 'Management Change', 'Credit Rating'].includes(category)) {
    return 'medium';
  }

  // Default to low
  return 'low';
}

/**
 * Parse NSE date format - handles multiple formats
 */
function parseNSEDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Try standard JS date parsing first (handles ISO, "28-Mar-2026 17:30:00", etc.)
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) return date;
  // Try DD-MM-YYYY
  const ddmmyyyy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (ddmmyyyy) {
    date = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Format date as DD-Mon-YYYY for NSE API
 */
function formatNSEDate(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Process a raw NSE announcement item into a NewsItem
 */
function processAnnouncement(item: any, idx: number): NewsItem | null {
  // NSE has many different response formats across endpoints:
  // corporate-announcements: sub, desc, an_dt, dt, symbol, company, attchmntText, cat
  // board-meetings: symbol, companyName, bm_purpose, bm_desc, bm_date, purpose, meetingDate
  // financial-results: symbol, companyName, relatingTo, broadcastDtTime, xbrl
  const symbol = item.symbol || item.companySymbol || item.SYMBOL || '';
  const companyName = item.company || item.companyName || item.COMPANY || symbol;
  const headline = item.sub || item.desc || item.bm_purpose || item.bm_desc || item.meetingInfo || item.purpose || item.relatingTo || item.subject || '';
  const description = item.desc || item.attchmntText || item.bm_desc || item.description || '';
  const dateStr = item.an_dt || item.dt || item.bm_date || item.meetingDate || item.broadcastDtTime || item.date || '';

  if (!symbol || !headline) return null;

  const itemDate = parseNSEDate(dateStr);
  if (!itemDate) return null;

  if (isNoise(headline, description)) return null;

  const category = categorizeAnnouncement(headline, description);
  const importance = scoreImportance(headline, category, description);
  const id = `${symbol}-${itemDate.toISOString().split('T')[0]}-${idx}`;

  return {
    id,
    ticker: symbol,
    company: companyName,
    headline: headline.length > 300 ? headline.slice(0, 300) + '...' : headline,
    description: description.length > 500 ? description.slice(0, 500) + '...' : description,
    category,
    date: itemDate.toISOString().split('T')[0],
    importance,
    source: 'NSE',
  };
}

/**
 * Fetch bulk corporate announcements from NSE (paginated)
 * This is more reliable than per-symbol fetching
 */
async function fetchBulkAnnouncements(
  symbolsFilter: Set<string> | null,
  daysBack: number,
  maxItems: number
): Promise<NewsItem[]> {
  const news: NewsItem[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const fromDate = formatNSEDate(cutoffDate);
  const toDate = formatNSEDate(new Date());

  console.log(`[Company News] Fetching bulk announcements from ${fromDate} to ${toDate}`);

  // Strategy: Try multiple endpoints for maximum coverage
  const endpoints = [
    // 1. Board meetings - most reliable, returns meeting dates & purposes
    `/api/corporate-board-meetings?index=equities`,
    // 2. Latest corporate announcements (no date filter)
    `/api/corporate-announcements?index=equities`,
    // 3. Corporate announcements with date range
    `/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}`,
    // 4. Financial results
    `/api/corporates-financial-results?index=equities`,
  ];

  const seenIds = new Set<string>();

  for (const endpoint of endpoints) {
    if (news.length >= maxItems) break;

    try {
      // Fetch up to 3 pages from paginated endpoint
      const maxPages = endpoint.includes('from_date') ? 3 : 1;

      for (let page = 0; page < maxPages; page++) {
        const pageSuffix = endpoint.includes('from_date') ? `&page=${page}` : '';
        const data = await nseApiFetch(`${endpoint}${pageSuffix}`, 300000);

        if (!data) {
          console.warn(`[Company News] No data from ${endpoint} page ${page}`);
          break;
        }

        // Handle many possible response structures from NSE
        let items: any[] = [];
        if (Array.isArray(data)) {
          items = data;
        } else if (data?.data && Array.isArray(data.data)) {
          items = data.data;
        } else if (data?.result && Array.isArray(data.result)) {
          items = data.result;
        } else {
          // Log the actual keys we received for debugging
          const keys = Object.keys(data || {}).join(',');
          console.warn(`[Company News] Unknown structure from ${endpoint}: keys=[${keys}], type=${typeof data}`);
          // Try all array-valued properties
          for (const key of Object.keys(data || {})) {
            if (Array.isArray(data[key]) && data[key].length > 0) {
              items = data[key];
              console.log(`[Company News] Found items in key '${key}': ${items.length} items`);
              break;
            }
          }
        }

        if (items.length === 0) {
          console.warn(`[Company News] Empty items from ${endpoint} page ${page}`);
          break;
        }

        console.log(`[Company News] Got ${items.length} items from ${endpoint} page ${page}, first item keys: ${Object.keys(items[0] || {}).join(',')}`);


        console.log(`[Company News] Got ${items.length} items from ${endpoint} page ${page}`);

        let idx = news.length;
        for (const item of items) {
          const processed = processAnnouncement(item, idx++);
          if (!processed) continue;

          // Date filter
          const itemDate = new Date(processed.date);
          if (itemDate < cutoffDate) continue;

          // Symbol filter (if specified)
          if (symbolsFilter && !symbolsFilter.has(processed.ticker)) continue;

          // Dedup
          const dedupKey = `${processed.ticker}-${processed.headline.slice(0, 50)}-${processed.date}`;
          if (seenIds.has(dedupKey)) continue;
          seenIds.add(dedupKey);

          news.push(processed);
        }

        // If fewer than 20 items, likely no more pages
        if (items.length < 20) break;
      }
    } catch (error) {
      console.error(`[Company News] Error fetching ${endpoint}:`, error);
    }
  }

  // If we still got nothing from bulk endpoints, try per-symbol as last resort
  if (news.length === 0 && symbolsFilter && symbolsFilter.size <= 10) {
    console.log(`[Company News] Bulk failed, trying per-symbol for ${symbolsFilter.size} symbols`);
    const symbols = [...symbolsFilter];

    for (const symbol of symbols.slice(0, 5)) {
      try {
        const data = await nseApiFetch(
          `/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`,
          300000
        );
        if (!data) continue;
        const items = Array.isArray(data) ? data : (data?.data || []);
        let idx = news.length;
        for (const item of items.slice(0, 10)) {
          const processed = processAnnouncement(item, idx++);
          if (!processed) continue;
          const itemDate = new Date(processed.date);
          if (itemDate < cutoffDate) continue;
          news.push(processed);
        }
      } catch {}
    }
  }

  return news;
}

/**
 * Validate and parse query parameters
 */
function parseQueryParams(searchParams: URLSearchParams) {
  let symbols: string[] = [];
  const symbolsParam = searchParams.get('symbols') || '';

  if (symbolsParam.trim()) {
    symbols = symbolsParam
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z0-9&-]+$/.test(s));
  }

  let days = parseInt(searchParams.get('days') || '30');
  days = Math.min(Math.max(days, 1), 90); // Clamp between 1-90

  let limit = parseInt(searchParams.get('limit') || '10');
  limit = Math.min(Math.max(limit, 1), 50); // Clamp between 1-50

  return { symbols, days, limit };
}

/**
 * Main GET handler
 */
export async function GET(request: Request): Promise<NextResponse<AnnouncementData>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const { symbols, days, limit } = parseQueryParams(searchParams);

    console.log(`[Company News] Query: symbols=${symbols.length > 0 ? symbols.join(',') : 'ALL'}, days=${days}, limit=${limit}`);

    // Strategy: If specific symbols requested, fetch per-symbol FIRST (more reliable),
    // then fill remaining from bulk. If no symbols, just use bulk (all companies).
    const symbolsFilter = symbols.length > 0 ? new Set(symbols) : null;
    const maxItems = symbols.length > 0 ? symbols.length * limit : 200;

    let allNews: NewsItem[] = [];

    if (symbols.length > 0) {
      // Per-symbol fetch is primary strategy when watchlist is specified
      // Bulk NSE endpoints return random recent filings, rarely matching specific stocks
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Fetch per-symbol announcements for up to 10 watchlist stocks
      const batchSize = 3;
      for (let i = 0; i < Math.min(symbols.length, 10); i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (symbol) => {
            try {
              const data = await nseApiFetch(
                `/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`,
                300000
              );
              if (!data) return [];
              const items = Array.isArray(data) ? data : (data?.data || []);
              const processed: NewsItem[] = [];
              let idx = allNews.length + processed.length;
              for (const item of items.slice(0, 15)) {
                const p = processAnnouncement(item, idx++);
                if (!p) continue;
                const itemDate = new Date(p.date);
                if (itemDate < cutoffDate) continue;
                processed.push(p);
              }
              return processed;
            } catch {
              return [];
            }
          })
        );
        allNews.push(...results.flat());
        if (i + batchSize < symbols.length) await new Promise(r => setTimeout(r, 200));
      }

      console.log(`[Company News] Per-symbol fetch: ${allNews.length} items for ${symbols.length} symbols`);

      // If per-symbol gave nothing, try bulk as fallback (without symbol filter)
      if (allNews.length === 0) {
        console.log(`[Company News] Per-symbol empty, falling back to bulk (unfiltered)`);
        allNews = await fetchBulkAnnouncements(null, days, maxItems);
      }
    } else {
      // No symbols specified — fetch all corporate news in bulk
      allNews = await fetchBulkAnnouncements(null, days, maxItems);
    }

    // Aggregate by company
    const newsByCompany = new Map<string, NewsItem[]>();
    for (const item of allNews) {
      const key = item.ticker;
      if (!newsByCompany.has(key)) {
        newsByCompany.set(key, []);
      }
      newsByCompany.get(key)!.push(item);
    }

    // Limit per company and sort by date
    const limitedNews: NewsItem[] = [];
    for (const companyNews of newsByCompany.values()) {
      const sorted = companyNews.sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      limitedNews.push(...sorted.slice(0, limit));
    }

    // Final sort by date (most recent first)
    limitedNews.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Build category summary
    const categoryCounts: Record<string, number> = {};
    for (const item of limitedNews) {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }

    // Sort categories by count
    const sortedCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => cat);

    const response: AnnouncementData = {
      news: limitedNews,
      summary: {
        totalItems: limitedNews.length,
        companiesCovered: newsByCompany.size,
        topCategories: sortedCategories,
      },
      updatedAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    console.log(`[Company News] Success: ${response.news.length} items from ${response.summary.companiesCovered} companies in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Company News] Fatal error after ${duration}ms:`, error);

    return NextResponse.json(
      {
        news: [],
        summary: {
          totalItems: 0,
          companiesCovered: 0,
          topCategories: [],
        },
        updatedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * POST handler for batch requests
 * Body: { symbols: string[], days?: number, limit?: number }
 */
export async function POST(request: Request): Promise<NextResponse<AnnouncementData>> {
  try {
    const body = await request.json();
    const { symbols = [], days = 30, limit = 10 } = body;
    const validSymbols = (Array.isArray(symbols) ? symbols : [])
      .map((s: string) => String(s).trim().toUpperCase())
      .filter((s: string) => /^[A-Z0-9&-]+$/.test(s));
    const validDays = Math.min(Math.max(parseInt(String(days)) || 30, 1), 90);
    const validLimit = Math.min(Math.max(parseInt(String(limit)) || 10, 1), 50);

    const symbolsFilter = validSymbols.length > 0 ? new Set(validSymbols) : null;
    const allNews = await fetchBulkAnnouncements(symbolsFilter, validDays, validSymbols.length * validLimit || 200);

    // Aggregate, limit, sort
    const newsByCompany = new Map<string, NewsItem[]>();
    for (const item of allNews) {
      if (!newsByCompany.has(item.ticker)) newsByCompany.set(item.ticker, []);
      newsByCompany.get(item.ticker)!.push(item);
    }
    const limitedNews: NewsItem[] = [];
    for (const companyNews of newsByCompany.values()) {
      companyNews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      limitedNews.push(...companyNews.slice(0, validLimit));
    }
    limitedNews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const categoryCounts: Record<string, number> = {};
    for (const item of limitedNews) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;

    return NextResponse.json({
      news: limitedNews,
      summary: {
        totalItems: limitedNews.length,
        companiesCovered: newsByCompany.size,
        topCategories: Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Company News POST] Error:', error);
    return NextResponse.json({
      news: [],
      summary: { totalItems: 0, companiesCovered: 0, topCategories: [] },
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
