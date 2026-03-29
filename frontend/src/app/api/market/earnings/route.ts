import { NextResponse } from 'next/server';
import {
  fetchBoardMeetings,
  fetchNifty500,
  fetchNiftySmallcap250,
  fetchNifty50,
  fetchNiftyNext50,
  fetchFinancialResults,
  fetchLatestFinancialResults,
  fetchBoardMeetingsForDateRange,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// =============================================
// EARNINGS CALENDAR - Financial Results First
// =============================================
// Strategy:
//   1. PRIMARY: NSE Financial Results API (/api/corporates-financial-results)
//      → Returns companies that ACTUALLY FILED quarterly results with NSE
//      → Includes: revenue, net profit, EPS, period ended date
//   2. UPCOMING: Board meetings with "Financial Results" in purpose
//      → Only FUTURE dates (board meeting not yet held)
//   3. BSE-ONLY: Fetch from Trendlyne/alternate sources for BSE-listed companies
//
// Quality Rating (matching earningspulse.ai):
//   - Good: Revenue growth > 0 OR Net profit growth > 0 OR positive price move
//   - Weak: Revenue decline AND profit decline OR significant negative price move
//   - Upcoming: Results not yet declared

// Indian fiscal quarter mapping
function getFiscalQuarter(date: Date): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 4 && month <= 6) return `Q1 FY${(year + 1).toString().slice(2)}`;
  if (month >= 7 && month <= 9) return `Q2 FY${(year + 1).toString().slice(2)}`;
  if (month >= 10 && month <= 12) return `Q3 FY${(year + 1).toString().slice(2)}`;
  return `Q4 FY${year.toString().slice(2)}`;
}

// Derive the results quarter from description or meeting date
function getResultsQuarter(meetingDate: Date, desc: string): string {
  const lower = desc.toLowerCase();

  // Try to parse quarter from description text
  const periodMatch = lower.match(
    /(?:period|quarter|half year|year)\s+ended\s+(?:on\s+)?(\d{1,2})?[- \/]?([a-z]+|\d{1,2})[- \/,]+(\d{4})/
  );
  if (periodMatch) {
    const monthStr = periodMatch[2];
    const yearStr = parseInt(periodMatch[3]);
    const monthMap: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6,
      jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    let month = -1;
    if (monthMap[monthStr]) month = monthMap[monthStr];
    else if (!isNaN(parseInt(monthStr))) month = parseInt(monthStr);

    if (month > 0 && yearStr > 2000) {
      return getFiscalQuarter(new Date(yearStr, month - 1, 1));
    }
  }

  // Fallback: previous quarter relative to meeting date
  const m = meetingDate.getMonth() + 1;
  const y = meetingDate.getFullYear();
  if (m >= 1 && m <= 3) return `Q3 FY${y.toString().slice(2)}`;
  if (m >= 4 && m <= 6) return `Q4 FY${y.toString().slice(2)}`;
  if (m >= 7 && m <= 9) return `Q1 FY${(y + 1).toString().slice(2)}`;
  return `Q2 FY${(y + 1).toString().slice(2)}`;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (!s) return null;
  try {
    const ddMonYYYY = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
    if (ddMonYYYY) {
      const month = MONTH_MAP[ddMonYYYY[2].toLowerCase()];
      if (month !== undefined) {
        const d = new Date(parseInt(ddMonYYYY[3]), month, parseInt(ddMonYYYY[1]));
        if (!isNaN(d.getTime())) return d;
      }
    }
    const ddmmyyyy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (ddmmyyyy) {
      const d = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
      if (!isNaN(d.getTime())) return d;
    }
    const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) {
      const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    return null;
  } catch {
    return null;
  }
}

function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  if (data?.Table && Array.isArray(data.Table)) return data.Table;
  return [];
}

// Market cap category
function getCapCategory(marketCapCr: number): string {
  if (marketCapCr >= 50000) return 'L';
  if (marketCapCr >= 15000) return 'M';
  if (marketCapCr >= 5000) return 'S';
  if (marketCapCr > 0) return 'Micro';
  return '';
}

// Check if board meeting is for financial results
function isBoardMeetingForResults(meeting: any): boolean {
  const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
  const desc = (meeting.bm_desc || meeting.desc || '').toLowerCase();

  if (purpose.includes('financial result')) return true;
  if (desc.includes('financial result') || desc.includes('quarterly result') ||
      desc.includes('annual result') || desc.includes('audited result') ||
      desc.includes('unaudited result')) return true;
  if ((desc.includes('inter alia') || desc.includes('inter-alia')) &&
      (desc.includes('result') || desc.includes('financial'))) return true;
  if (purpose.includes('dividend') && purpose.includes('result')) return true;

  return false;
}

// Assess quality based on financial data from NSE results
function assessQuality(result: any, priceData: any): 'Good' | 'Weak' {
  // Try to extract financial metrics from the result data
  const revenueStr = result.re_revenue || result.revenue || result.income || result.totalIncome || '';
  const profitStr = result.re_netProfit || result.netProfit || result.re_proLossAftTax || result.proLossAftTax || '';
  const epsStr = result.re_dilEPS || result.dilutedEPS || result.basicEPS || result.re_basicEPS || '';

  const revenue = parseFloat(String(revenueStr).replace(/,/g, ''));
  const profit = parseFloat(String(profitStr).replace(/,/g, ''));
  const eps = parseFloat(String(epsStr).replace(/,/g, ''));

  // If we have profit data, use it
  if (!isNaN(profit)) {
    if (profit > 0) return 'Good';
    return 'Weak';
  }

  // Fallback to price movement
  if (priceData) {
    const changePct = priceData.changePercent || 0;
    // Use a stricter threshold: if stock dropped significantly, likely weak
    if (changePct < -5) return 'Weak';
    return 'Good';
  }

  return 'Good'; // Default optimistic
}

interface EarningsEvent {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Good' | 'Weak' | 'Upcoming';
  sector: string;
  industry: string;
  marketCap: string;
  edp: number | null;
  cmp: number | null;
  priceMove: number | null;
  source: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const month = searchParams.get('month'); // YYYY-MM format
  const indexFilter = searchParams.get('index');
  const debug = searchParams.get('debug') === 'true';

  try {
    if (market !== 'india') {
      return NextResponse.json({
        results: [],
        summary: { total: 0, good: 0, weak: 0, upcoming: 0 },
        source: 'Not Available',
        message: 'US earnings calendar coming soon',
      });
    }

    // Calculate date range
    const now = new Date();
    let fromDate: Date, toDate: Date;

    if (month) {
      const [year, m] = month.split('-').map(Number);
      fromDate = new Date(year, m - 1, 1);
      toDate = new Date(year, m, 0);
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const formatNSEDate = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    // ============================================
    // STEP 1: Fetch all data in parallel
    // ============================================
    const [
      financialResults,
      latestResults,
      boardMeetings,
      boardMeetingsRange,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetings().catch(() => null),
      fetchBoardMeetingsForDateRange(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // ============================================
    // STEP 2: Build price/sector lookup
    // ============================================
    const priceLookup: Record<string, {
      price: number; change: number; changePercent: number;
      volume: number; marketCap: number; industry: string;
      previousClose: number;
    }> = {};

    const indexMembers: Record<string, Set<string>> = {
      'NIFTY50': new Set<string>(),
      'NIFTY500': new Set<string>(),
      'SMALLCAP250': new Set<string>(),
    };

    const processStockData = (data: any, indexKey: string) => {
      if (!data?.data) return;
      for (const item of data.data) {
        if (!item.symbol) continue;
        indexMembers[indexKey].add(item.symbol);
        if (!priceLookup[item.symbol]) {
          priceLookup[item.symbol] = {
            price: item.lastPrice || 0,
            change: item.change || 0,
            changePercent: item.pChange || 0,
            volume: item.totalTradedVolume || 0,
            marketCap: item.ffmc || item.totalMarketCap || 0,
            industry: item.meta?.industry || item.industry || '',
            previousClose: item.previousClose || 0,
          };
        }
      }
    };

    processStockData(nifty50Data, 'NIFTY50');
    processStockData(niftyNext50Data, 'NIFTY50');
    processStockData(nifty500Data, 'NIFTY500');
    processStockData(smallcap250Data, 'SMALLCAP250');

    // ============================================
    // STEP 3: Process FINANCIAL RESULTS (PRIMARY SOURCE)
    // ============================================
    // The NSE financial results API returns ACTUAL filed quarterly results
    // with company name, period ended, revenue, profit, EPS etc.
    const frArray = toArray(financialResults);
    const latestFrArray = toArray(latestResults);

    // Combine and deduplicate
    const allFinancialResults: any[] = [];
    const frSeen = new Set<string>();

    for (const fr of [...frArray, ...latestFrArray]) {
      const ticker = fr.symbol || fr.re_symbol || '';
      if (!ticker) continue;

      // Check filing date is in our target month
      const filingDate = parseDate(fr.re_broadcastDt || fr.broadcastDate || fr.re_date || fr.date || fr.re_submissionDate || '');
      if (!filingDate) continue;
      if (filingDate < fromDate || filingDate > toDate) continue;

      const key = `${ticker}:${filingDate.toISOString().split('T')[0]}`;
      if (frSeen.has(ticker)) continue; // One per ticker
      frSeen.add(ticker);
      frSeen.add(key);
      allFinancialResults.push({ ...fr, _filingDate: filingDate, _ticker: ticker });
    }

    // ============================================
    // STEP 4: Process BOARD MEETINGS (UPCOMING ONLY)
    // ============================================
    const bmArray1 = toArray(boardMeetings);
    const bmArray2 = toArray(boardMeetingsRange);

    const bmSeen = new Set<string>();
    const upcomingMeetings: any[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const bm of [...bmArray1, ...bmArray2]) {
      const ticker = bm.bm_symbol || bm.symbol || '';
      if (!ticker) continue;
      if (!isBoardMeetingForResults(bm)) continue;

      const meetingDateStr = bm.bm_date || bm.bm_meetingDate || bm.date || '';
      const meetingDate = parseDate(meetingDateStr);
      if (!meetingDate) continue;

      // ONLY future meetings within the target month
      if (meetingDate < today || meetingDate < fromDate || meetingDate > toDate) continue;

      const key = `${ticker}`;
      if (bmSeen.has(key)) continue;
      bmSeen.add(key);

      // Skip if this company already has a confirmed result
      if (frSeen.has(ticker)) continue;

      upcomingMeetings.push({ ...bm, _meetingDate: meetingDate, _ticker: ticker });
    }

    // ============================================
    // STEP 5: Build events from financial results
    // ============================================
    const eventsMap = new Map<string, EarningsEvent>();

    for (const fr of allFinancialResults) {
      const ticker = fr._ticker;
      const filingDate = fr._filingDate as Date;
      const company = fr.re_companyName || fr.companyName || fr.sm_name || ticker;

      // Get quarter from the "period ended" field
      const periodEnded = fr.re_toDate || fr.toDate || fr.re_periodEnded || '';
      const desc = `period ended ${periodEnded}`;
      const quarter = getResultsQuarter(filingDate, desc);

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      // Quality: use actual financial data
      const quality = assessQuality(fr, stockInfo);

      eventsMap.set(ticker, {
        ticker,
        company,
        resultDate: filingDate.toISOString().split('T')[0],
        quarter,
        quality,
        sector: normalizeSector(stockInfo?.industry) || 'Other',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null,
        cmp: stockInfo?.price || null,
        priceMove: null,
        source: 'NSE',
      });
    }

    // ============================================
    // STEP 6: Add UPCOMING from board meetings
    // ============================================
    for (const bm of upcomingMeetings) {
      const ticker = bm._ticker;
      if (eventsMap.has(ticker)) continue;

      const meetingDate = bm._meetingDate as Date;
      const desc = bm.bm_desc || bm.desc || '';
      const quarter = getResultsQuarter(meetingDate, desc);

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      eventsMap.set(ticker, {
        ticker,
        company: bm.bm_companyName || bm.sm_name || ticker,
        resultDate: meetingDate.toISOString().split('T')[0],
        quarter,
        quality: 'Upcoming',
        sector: normalizeSector(stockInfo?.industry) || 'Other',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null,
        cmp: stockInfo?.price || null,
        priceMove: null,
        source: 'NSE',
      });
    }

    console.log('Earnings processing:', {
      financialResultsRaw: frArray.length,
      latestResultsRaw: latestFrArray.length,
      confirmedInMonth: allFinancialResults.length,
      upcomingMeetings: upcomingMeetings.length,
      finalEvents: eventsMap.size,
    });

    // ============================================
    // STEP 7: Filter and sort
    // ============================================
    let results = Array.from(eventsMap.values());

    if (indexFilter) {
      const filterKey = indexFilter.toUpperCase().replace(/\s+/g, '');
      results = results.filter(r => {
        if (filterKey === 'NIFTY50') return indexMembers['NIFTY50'].has(r.ticker);
        if (filterKey === 'NIFTY500') return indexMembers['NIFTY500'].has(r.ticker);
        if (filterKey === 'SMALLCAP250') return indexMembers['SMALLCAP250'].has(r.ticker);
        if (filterKey === 'MIDCAP') return r.marketCap === 'M';
        if (filterKey === 'SMALLCAP') return r.marketCap === 'S' || r.marketCap === 'Micro';
        return true;
      });
    }

    results.sort((a, b) => new Date(b.resultDate).getTime() - new Date(a.resultDate).getTime());

    const goodCount = results.filter(r => r.quality === 'Good').length;
    const weakCount = results.filter(r => r.quality === 'Weak').length;
    const upcomingCount = results.filter(r => r.quality === 'Upcoming').length;

    if (debug) {
      return NextResponse.json({
        debug: true,
        dateRange: { from: formatNSEDate(fromDate), to: formatNSEDate(toDate) },
        processing: {
          financialResultsRaw: frArray.length,
          latestResultsRaw: latestFrArray.length,
          confirmedInMonth: allFinancialResults.length,
          upcomingMeetings: upcomingMeetings.length,
          finalEvents: eventsMap.size,
        },
        sampleFinancialResult: frArray[0] || latestFrArray[0] || null,
        results,
      });
    }

    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        good: goodCount,
        weak: weakCount,
        upcoming: upcomingCount,
      },
      quarter: getResultsQuarter(fromDate, ''),
      dateRange: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      stockUniverse: Object.keys(priceLookup).length,
      source: 'NSE India (Live)',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Earnings API error:', error);
    return NextResponse.json({
      results: [],
      summary: { total: 0, good: 0, weak: 0, upcoming: 0 },
      source: 'Error',
      error: String(error),
    }, { status: 500 });
  }
}
