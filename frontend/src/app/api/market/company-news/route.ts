import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';

export const dynamic = 'force-dynamic';

/**
 * Company News API Endpoint
 * Scrapes and aggregates corporate announcements from NSE India
 *
 * Query Parameters:
 * - symbols: comma-separated ticker symbols (e.g., 'RELIANCE,TCS,INFY')
 * - days: number of days to look back (default: 30, max: 90)
 * - limit: max results per company (default: 10)
 *
 * Returns: Aggregated and categorized news with importance scoring
 */

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
 * Fetch announcements for a specific symbol
 */
async function fetchSymbolAnnouncements(
  symbol: string,
  limit: number,
  daysBack: number
): Promise<NewsItem[]> {
  try {
    const path = `/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`;
    const data = await nseApiFetch(path, 300000); // 5 min cache

    if (!data || !data.data || !Array.isArray(data.data)) {
      console.warn(`No announcement data for ${symbol}`);
      return [];
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const news: NewsItem[] = [];

    for (const item of data.data) {
      if (news.length >= limit) break;

      const headline = item.sub || item.desc || '';
      const description = item.desc || item.attchmntText || '';
      const dateStr = item.an_dt || item.dt || '';
      const companyName = item.company || symbol;

      if (!headline || !dateStr) continue;

      // Parse date
      let itemDate: Date;
      try {
        // Try DD-MMM-YYYY format first
        itemDate = parseNSEDate(dateStr);
      } catch {
        continue;
      }

      // Filter by date
      if (itemDate < cutoffDate) {
        continue;
      }

      // Filter noise
      if (isNoise(headline, description)) {
        continue;
      }

      // Categorize and score
      const category = categorizeAnnouncement(headline, description);
      const importance = scoreImportance(headline, category, description);

      const id = `${symbol}-${itemDate.toISOString().split('T')[0]}-${news.length}`;

      news.push({
        id,
        ticker: symbol,
        company: companyName,
        headline,
        description,
        category,
        date: itemDate.toISOString().split('T')[0],
        importance,
        source: 'NSE',
      });
    }

    return news;
  } catch (error) {
    console.error(`Error fetching announcements for ${symbol}:`, error);
    return [];
  }
}

/**
 * Parse NSE date format (DD-MMM-YYYY)
 */
function parseNSEDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  return date;
}

/**
 * Fetch all tracked equities (fallback for empty symbols)
 */
async function fetchAllEquitiesNews(limit: number, daysBack: number): Promise<NewsItem[]> {
  try {
    const path = '/api/corporate-board-meetings?index=equities';
    const data = await nseApiFetch(path, 300000); // 5 min cache

    if (!data || !data.data || !Array.isArray(data.data)) {
      console.warn('No board meetings data available');
      return [];
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const news: NewsItem[] = [];

    // Limit to recent 50 board meetings when no symbols specified
    for (let i = 0; i < Math.min(50, data.data.length); i++) {
      if (news.length >= limit * 5) break; // Reasonable upper limit

      const item = data.data[i];
      const symbol = item.symbol || item.companySymbol || '';
      const companyName = item.companyName || symbol;
      const headline = item.meetingInfo || item.purpose || 'Board Meeting';
      const dateStr = item.meetingDate || item.date || '';

      if (!symbol || !dateStr) continue;

      let itemDate: Date;
      try {
        itemDate = parseNSEDate(dateStr);
      } catch {
        continue;
      }

      if (itemDate < cutoffDate) {
        continue;
      }

      if (isNoise(headline)) {
        continue;
      }

      const category = 'Board Meeting';
      const importance = 'medium' as const;
      const id = `${symbol}-${itemDate.toISOString().split('T')[0]}-${news.length}`;

      news.push({
        id,
        ticker: symbol,
        company: companyName,
        headline,
        description: '',
        category,
        date: itemDate.toISOString().split('T')[0],
        importance,
        source: 'NSE',
      });
    }

    return news;
  } catch (error) {
    console.error('Error fetching all equities announcements:', error);
    return [];
  }
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

    let allNews: NewsItem[] = [];

    if (symbols.length === 0) {
      // Fetch for all equities (recent 50)
      console.log('[Company News] Fetching news for all tracked equities');
      allNews = await fetchAllEquitiesNews(limit, days);
    } else {
      // Fetch for specific symbols
      console.log(`[Company News] Fetching news for ${symbols.length} specific symbols`);

      const newsPromises = symbols.map(symbol =>
        fetchSymbolAnnouncements(symbol, limit, days)
          .catch(error => {
            console.error(`Error processing ${symbol}:`, error);
            return [];
          })
      );

      const results = await Promise.all(newsPromises);
      allNews = results.flat();
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

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
 * Optional POST handler for batch requests
 * Body: { symbols: string[], days?: number, limit?: number }
 */
export async function POST(request: Request): Promise<NextResponse<AnnouncementData>> {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { symbols = [], days = 30, limit = 10 } = body;

    if (!Array.isArray(symbols)) {
      return NextResponse.json(
        {
          news: [],
          summary: { totalItems: 0, companiesCovered: 0, topCategories: [] },
          updatedAt: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const validSymbols = symbols
      .map((s: string) => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
      .filter(s => /^[A-Z0-9&-]+$/.test(s));

    const validDays = Math.min(Math.max(parseInt(String(days)) || 30, 1), 90);
    const validLimit = Math.min(Math.max(parseInt(String(limit)) || 10, 1), 50);

    console.log(`[Company News POST] Query: symbols=${validSymbols.join(',')}, days=${validDays}, limit=${validLimit}`);

    let allNews: NewsItem[] = [];

    if (validSymbols.length === 0) {
      allNews = await fetchAllEquitiesNews(validLimit, validDays);
    } else {
      const newsPromises = validSymbols.map(symbol =>
        fetchSymbolAnnouncements(symbol, validLimit, validDays)
          .catch(error => {
            console.error(`Error processing ${symbol}:`, error);
            return [];
          })
      );

      const results = await Promise.all(newsPromises);
      allNews = results.flat();
    }

    // Aggregate and limit
    const newsByCompany = new Map<string, NewsItem[]>();
    for (const item of allNews) {
      const key = item.ticker;
      if (!newsByCompany.has(key)) {
        newsByCompany.set(key, []);
      }
      newsByCompany.get(key)!.push(item);
    }

    const limitedNews: NewsItem[] = [];
    for (const companyNews of newsByCompany.values()) {
      const sorted = companyNews.sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      limitedNews.push(...sorted.slice(0, validLimit));
    }

    limitedNews.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const categoryCounts: Record<string, number> = {};
    for (const item of limitedNews) {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }

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
    console.log(`[Company News POST] Success: ${response.news.length} items in ${duration}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Company News POST] Fatal error after ${duration}ms:`, error);

    return NextResponse.json(
      {
        news: [],
        summary: { totalItems: 0, companiesCovered: 0, topCategories: [] },
        updatedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
