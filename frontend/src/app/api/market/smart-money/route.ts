import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';
import { rateLimitResponse } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Deal {
  symbol: string;
  clientName: string;
  dealDate: string;
  quantity: number;
  tradePrice: number;
  buyOrSell: string;
  tradeType: 'Bulk' | 'Block';
  quality: 'Institutional' | 'Retail';
}

interface Summary {
  total: number;
  bulk: number;
  block: number;
  institutional: number;
  retail: number;
}

interface MarketStatus {
  open: boolean;
  lastTradingDay: string;
}

interface ResponseData {
  deals: Deal[];
  summary: Summary;
  marketStatus: MarketStatus;
}

// List of institutional identifiers for quality rating
const INSTITUTIONAL_KEYWORDS = [
  'mutual fund',
  'insurance',
  'fii',
  'dii',
  'bank',
  'capital',
  'securities',
  'investments',
  'asset management',
  'amc',
  'pension',
  'sovereign',
  'endowment',
  'hedge',
  'provident',
  'sbi',
  'hdfc',
  'icici',
  'lic',
  'kotak',
  'axis',
  'goldman',
  'morgan',
  'jp morgan',
  'blackrock',
  'vanguard',
  'fidelity',
];

function isInstitutional(clientName: string): boolean {
  const lower = clientName.toLowerCase();
  return INSTITUTIONAL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function extractDeals(data: any, tradeType: 'Bulk' | 'Block'): Deal[] {
  if (!data || !Array.isArray(data)) return [];

  return data
    .map((item: any) => {
      // Handle both bulk and block deal field names
      const symbol = item.symbol || item.scripCode || '';
      const clientName = item.clientName || item.client || '';
      const dealDate = item.dealDate || item.date || '';
      const quantity = item.quantity || item.qty || 0;
      const tradePrice = item.tradePrice || item.price || 0;
      const buyOrSell = item.buyOrSell || item.side || '';

      if (!symbol || !clientName || !dealDate) return null;

      return {
        symbol: String(symbol).toUpperCase(),
        clientName: String(clientName),
        dealDate: String(dealDate),
        quantity: Number(quantity) || 0,
        tradePrice: Number(tradePrice) || 0,
        buyOrSell: String(buyOrSell).toUpperCase(),
        tradeType,
        quality: isInstitutional(clientName) ? 'Institutional' : 'Retail',
      };
    })
    .filter((deal): deal is Deal => deal !== null);
}

function sortByDateDescending(deals: Deal[]): Deal[] {
  return deals.sort((a, b) => {
    // Parse dates - handle various formats
    const dateA = parseDate(a.dealDate);
    const dateB = parseDate(b.dealDate);
    return dateB.getTime() - dateA.getTime();
  });
}

function parseDate(dateStr: string): Date {
  // Try to parse DD-MM-YYYY, DD/MM/YYYY, or ISO formats
  const formats = [
    /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
    /(\d{2})\/(\d{2})\/(\d{4})/, // DD/MM/YYYY
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD (ISO)
  ];

  for (const regex of formats) {
    const match = dateStr.match(regex);
    if (match) {
      if (match[3].length === 4) {
        // Year is in position 3
        if (match[1].length === 4) {
          // YYYY-MM-DD
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        } else {
          // DD-MM-YYYY or DD/MM/YYYY
          return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
        }
      }
    }
  }

  // Fallback to Date constructor
  return new Date(dateStr);
}

// PATCH 1013 — IST-aware market hours. Railway runs UTC; the old getHours()
// check would return open=true at 16:30 IST (= 11:00 UTC) even though NSE
// closed at 15:30 IST. Now we explicitly shift to IST (+5:30) so the gate
// matches the actual exchange clock and the last-trading-day rollover is
// correct around midnight UTC.
function isMarketOpen(): { open: boolean; lastTradingDay: string } {
  const now = new Date();
  // Build IST wall-clock view of `now` (India = UTC+5:30, no DST).
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60_000);
  const istDow = ist.getUTCDay();           // 0=Sun..6=Sat on the IST-shifted date
  const istHour = ist.getUTCHours();
  const istMin  = ist.getUTCMinutes();
  const minutesIST = istHour * 60 + istMin;
  const OPEN_MIN  = 9 * 60 + 15;            // 09:15 IST
  const CLOSE_MIN = 15 * 60 + 30;           // 15:30 IST
  const isWeekend = istDow === 0 || istDow === 6;
  const inSession = !isWeekend && minutesIST >= OPEN_MIN && minutesIST <= CLOSE_MIN;
  // Last trading day: walk IST-date back to nearest weekday. If today is a
  // weekend OR before market open, the last trading session was a prior day.
  const d = new Date(ist.getTime());
  d.setUTCHours(0, 0, 0, 0);
  if (isWeekend || minutesIST < OPEN_MIN) {
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  }
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const lastDay = `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return { open: inSession, lastTradingDay: lastDay };
}

export async function GET(request: Request) {
  const limited = rateLimitResponse(request, 60, 60_000);
  if (limited) return limited;
  try {
    const marketStatus = isMarketOpen();

    // Fetch both bulk and block deals from NSE
    const [bulkData, blockData] = await Promise.all([
      nseApiFetch('/api/bulk-deal', 60000),
      nseApiFetch('/api/block-deal', 60000),
    ]);

    // Extract and process deals
    const bulkDeals = extractDeals(bulkData, 'Bulk');
    const blockDeals = extractDeals(blockData, 'Block');

    // Combine and sort
    const allDeals = sortByDateDescending([...bulkDeals, ...blockDeals]);

    // Calculate summary
    const summary: Summary = {
      total: allDeals.length,
      bulk: bulkDeals.length,
      block: blockDeals.length,
      institutional: allDeals.filter((d) => d.quality === 'Institutional').length,
      retail: allDeals.filter((d) => d.quality === 'Retail').length,
    };

    const response: ResponseData = {
      deals: allDeals,
      summary,
      marketStatus,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Smart money API error:', error);
    return NextResponse.json(
      {
        deals: [],
        summary: { total: 0, bulk: 0, block: 0, institutional: 0, retail: 0 },
        marketStatus: { open: false, lastTradingDay: '' },
        error: error instanceof Error ? error.message : 'Failed to fetch smart money data',
      },
      { status: 500 }
    );
  }
}
