import { NextResponse } from 'next/server';
import { nseApiFetch } from '@/lib/nse';

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

interface ResponseData {
  deals: Deal[];
  summary: Summary;
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

// Get the last N working days as date strings (DD-MM-YYYY) for fallback
function getLastWorkingDays(n: number = 5): string[] {
  const dates: string[] = [];
  const now = new Date();
  let d = new Date(now);
  while (dates.length < n) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) { // Skip weekends
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      dates.push(`${dd}-${mm}-${d.getFullYear()}`);
    }
  }
  return dates;
}

export async function GET() {
  try {
    // Fetch both bulk and block deals from NSE
    // NSE returns current day's deals — empty on weekends/holidays
    const [bulkData, blockData] = await Promise.all([
      nseApiFetch('/api/bulk-deal', 60000),
      nseApiFetch('/api/block-deal', 60000),
    ]);

    // If no deals (weekend/holiday), try fetching recent trading day data
    const bulkArr = Array.isArray(bulkData) ? bulkData : (bulkData?.data || []);
    const blockArr = Array.isArray(blockData) ? blockData : (blockData?.data || []);

    if (bulkArr.length === 0 && blockArr.length === 0) {
      // Try historical bulk/block deals for recent trading days
      const recentDays = getLastWorkingDays(3);
      for (const dateStr of recentDays) {
        const [histBulk, histBlock] = await Promise.all([
          nseApiFetch(`/api/historical/bulk-deal?from=${dateStr}&to=${dateStr}`, 300000).catch(() => null),
          nseApiFetch(`/api/historical/block-deal?from=${dateStr}&to=${dateStr}`, 300000).catch(() => null),
        ]);

        const hBulk = extractDeals(Array.isArray(histBulk) ? histBulk : (histBulk?.data || []), 'Bulk');
        const hBlock = extractDeals(Array.isArray(histBlock) ? histBlock : (histBlock?.data || []), 'Block');

        if (hBulk.length > 0 || hBlock.length > 0) {
          const allDeals = sortByDateDescending([...hBulk, ...hBlock]);
          const summary: Summary = {
            total: allDeals.length, bulk: hBulk.length, block: hBlock.length,
            institutional: allDeals.filter(d => d.quality === 'Institutional').length,
            retail: allDeals.filter(d => d.quality === 'Retail').length,
          };
          return NextResponse.json({ deals: allDeals, summary, dataDate: dateStr, isHistorical: true });
        }
      }
      // Nothing found even historically — return empty
      return NextResponse.json({ deals: [], summary: { total: 0, bulk: 0, block: 0, institutional: 0, retail: 0 }, isHistorical: false });
    }

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
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Smart money API error:', error);
    return NextResponse.json(
      {
        deals: [],
        summary: { total: 0, bulk: 0, block: 0, institutional: 0, retail: 0 },
        error: error instanceof Error ? error.message : 'Failed to fetch smart money data',
      },
      { status: 500 }
    );
  }
}
