import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';

export const dynamic = 'force-dynamic';

interface DealEvent {
  type: 'Block' | 'Bulk';
  clientName: string;
  quantity: number;
  tradePrice: number;
  buyOrSell: string;
  dealDate: string;
  quality: 'Institutional' | 'Retail';
}

interface NewsEvent {
  headline: string;
  category: string;
  date: string;
  importance: 'high' | 'medium' | 'low';
}

interface TickerDetailResponse {
  symbol: string;
  orders: DealEvent[];
  news: NewsEvent[];
  relatedIntel: string[];
  updatedAt: string;
}

const INSTITUTIONAL_KEYWORDS = [
  'mutual fund', 'insurance', 'fii', 'dii', 'bank', 'capital',
  'securities', 'amc', 'pension', 'hedge', 'sovereign',
  'sbi', 'hdfc', 'icici', 'lic', 'kotak', 'axis',
  'goldman', 'morgan', 'blackrock', 'vanguard', 'fidelity',
];

function classifyClient(name: string): 'Institutional' | 'Retail' {
  const lower = name.toLowerCase();
  return INSTITUTIONAL_KEYWORDS.some(kw => lower.includes(kw)) ? 'Institutional' : 'Retail';
}

export async function GET(
  request: Request,
  { params }: { params: { symbol: string } }
): Promise<NextResponse<TickerDetailResponse>> {
  const symbol = params.symbol.toUpperCase();

  try {
    // Fetch deals and announcements in parallel
    const [blockData, bulkData, announcementsData] = await Promise.all([
      nseApiFetch('/api/block-deal', 60000),
      nseApiFetch('/api/bulk-deal', 60000),
      nseApiFetch(`/api/corporates-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`, 300000),
    ]);

    // Filter deals for this symbol
    const orders: DealEvent[] = [];

    for (const d of (blockData?.data || [])) {
      const sym = d.symbol || d.BD_SYMBOL || '';
      if (sym === symbol) {
        orders.push({
          type: 'Block',
          clientName: d.clientName || d.BD_CLIENT_NAME || '',
          quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
          tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
          buyOrSell: (d.buySell || d.BD_BUY_SELL || '').trim(),
          dealDate: d.dealDate || d.BD_DT_DATE || '',
          quality: classifyClient(d.clientName || d.BD_CLIENT_NAME || ''),
        });
      }
    }

    for (const d of (bulkData?.data || [])) {
      const sym = d.symbol || d.BD_SYMBOL || '';
      if (sym === symbol) {
        orders.push({
          type: 'Bulk',
          clientName: d.clientName || d.BD_CLIENT_NAME || '',
          quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
          tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
          buyOrSell: (d.buySell || d.BD_BUY_SELL || '').trim(),
          dealDate: d.dealDate || d.BD_DT_DATE || '',
          quality: classifyClient(d.clientName || d.BD_CLIENT_NAME || ''),
        });
      }
    }

    // Process announcements
    const news: NewsEvent[] = [];
    const announcementItems = announcementsData?.data || (Array.isArray(announcementsData) ? announcementsData : []);

    const NOISE = ['trading window', 'lodr', 'compliance', 'notice', 'reminder', 'intimation'];

    for (const item of announcementItems.slice(0, 20)) {
      const headline = item.sub || item.desc || '';
      if (!headline) continue;

      const lower = headline.toLowerCase();
      if (NOISE.some(n => lower.includes(n))) continue;

      let category = 'Corporate Update';
      let importance: 'high' | 'medium' | 'low' = 'low';

      if (/result|earning|quarter|q[1-4]|fy/i.test(lower)) {
        category = 'Financial Results';
        importance = 'high';
      } else if (/order|contract|award/i.test(lower)) {
        category = 'Orders & Contracts';
        importance = 'high';
      } else if (/acqui|merger|amalga/i.test(lower)) {
        category = 'M&A';
        importance = 'high';
      } else if (/dividend/i.test(lower)) {
        category = 'Dividend';
        importance = 'medium';
      } else if (/fund raising|qip|rights/i.test(lower)) {
        category = 'Fund Raising';
        importance = 'medium';
      } else if (/board meeting|board outcome/i.test(lower)) {
        category = 'Board Meeting';
        importance = 'medium';
      } else if (/appoint|resign|cess|director|ceo/i.test(lower)) {
        category = 'Management Change';
        importance = 'medium';
      } else if (/rating/i.test(lower)) {
        category = 'Credit Rating';
        importance = 'medium';
      } else if (/buyback/i.test(lower)) {
        category = 'Buyback';
        importance = 'medium';
      }

      const dateStr = item.an_dt || item.dt || '';
      let dateFormatted = '';
      try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) dateFormatted = d.toISOString().split('T')[0];
      } catch {}

      news.push({ headline, category, date: dateFormatted, importance });
    }

    // Sort orders by date desc, news by importance then date
    orders.sort((a, b) => new Date(b.dealDate).getTime() - new Date(a.dealDate).getTime());
    news.sort((a, b) => {
      const impOrder = { high: 0, medium: 1, low: 2 };
      if (impOrder[a.importance] !== impOrder[b.importance]) return impOrder[a.importance] - impOrder[b.importance];
      return b.date.localeCompare(a.date);
    });

    return NextResponse.json({
      symbol,
      orders,
      news,
      relatedIntel: [],
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[Orders Detail] Error for ${symbol}:`, error);
    return NextResponse.json({
      symbol,
      orders: [],
      news: [],
      relatedIntel: [],
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
