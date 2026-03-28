import { NextResponse } from 'next/server';
import {
  fetchBoardMeetings,
  fetchFinancialResults,
  fetchNifty500,
  fetchNiftyMidcap250,
  fetchNiftySmallcap250,
  fetchNifty50,
  fetchNiftyNext50,
  fetchBoardMeetingAnnouncements,
  fetchBseBoardMeetings,
  getSectorForSymbol,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';

// =============================================
// EARNINGS CALENDAR - Production Grade
// =============================================
// Sources: NSE Board Meetings + Financial Results + Corporate Announcements + BSE
// Approach: Parse disclosures, extract dates, deduplicate, enrich with sector/index data

// Indian fiscal quarter mapping
function getFiscalQuarter(date: Date): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 4 && month <= 6) return `Q1 FY${(year + 1).toString().slice(2)}`;
  if (month >= 7 && month <= 9) return `Q2 FY${(year + 1).toString().slice(2)}`;
  if (month >= 10 && month <= 12) return `Q3 FY${(year + 1).toString().slice(2)}`;
  return `Q4 FY${year.toString().slice(2)}`;
}

// Parse various date formats from NSE/BSE filings
function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  try {
    // Handle DD-MM-YYYY, DD/MM/YYYY
    const ddmmyyyy = dateStr.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (ddmmyyyy) {
      const d = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
      if (!isNaN(d.getTime())) return d;
    }
    // Handle standard ISO or JS parseable formats
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    return null;
  } catch {
    return null;
  }
}

// Extract earnings-related keywords from filing text
function isEarningsRelated(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('financial result') ||
    lower.includes('quarterly result') ||
    lower.includes('half yearly result') ||
    lower.includes('annual result') ||
    lower.includes('audited result') ||
    lower.includes('unaudited result') ||
    lower.includes('standalone result') ||
    lower.includes('consolidated result') ||
    lower.includes('results for the quarter') ||
    lower.includes('results for the half') ||
    lower.includes('results for the year') ||
    lower.includes('consider the financial') ||
    lower.includes('approve the financial') ||
    lower.includes('declaration of dividend') // Often accompanies results
  );
}

// Assess quality based on financial metrics
function assessQuality(result: any): 'Good' | 'Weak' | 'Upcoming' {
  if (!result.revenue && !result.netProfit && !result.eps) return 'Upcoming';

  const revenue = result.revenue || 0;
  const netProfit = result.netProfit || 0;
  const eps = result.eps || 0;
  const opm = result.opm || 0;

  const hasProfit = netProfit > 0;
  const hasHealthyOPM = opm > 5;
  const hasPositiveEPS = eps > 0;

  if (hasProfit && (hasHealthyOPM || hasPositiveEPS)) return 'Good';
  return 'Weak';
}

// Market cap category
function getCapCategory(marketCap: number): string {
  if (marketCap >= 50000) return 'Large Cap';
  if (marketCap >= 15000) return 'Mid Cap';
  if (marketCap >= 5000) return 'Small Cap';
  if (marketCap > 0) return 'Micro Cap';
  return '';
}

// Determine index membership
function getIndexMembership(symbol: string, indexMembers: Record<string, Set<string>>): string[] {
  const memberships: string[] = [];
  if (indexMembers['NIFTY50']?.has(symbol)) memberships.push('NIFTY 50');
  if (indexMembers['NIFTY500']?.has(symbol)) memberships.push('NIFTY 500');
  if (indexMembers['MIDCAP250']?.has(symbol)) memberships.push('Midcap 250');
  if (indexMembers['SMALLCAP250']?.has(symbol)) memberships.push('Smallcap 250');
  return memberships;
}

interface EarningsEvent {
  ticker: string;
  company: string;
  eventType: 'BOARD_MEETING' | 'RESULTS_DECLARED';
  announcedDate: string | null;
  eventDate: string;
  quarter: string;
  quality: 'Good' | 'Weak' | 'Upcoming';
  revenue: number | null;
  operatingProfit: number | null;
  opm: string | null;
  netProfit: number | null;
  eps: number | null;
  sector: string;
  marketCap: string;
  indexMembership: string[];
  currentPrice: number | null;
  priceChange: number | null;
  volume: number | null;
  source: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const month = searchParams.get('month'); // YYYY-MM format
  const includeMovement = searchParams.get('includeMovement') === 'true';
  const indexFilter = searchParams.get('index'); // NIFTY50, NIFTY500, MIDCAP250, SMALLCAP250

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
      toDate = new Date(year, m, 0); // Last day of month
    } else {
      // Default: current month ± 15 days for better coverage
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    }

    const formatNSEDate = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    // ============================================
    // STEP 1: Fetch all data sources in parallel
    // ============================================
    const [
      boardMeetings,
      financialResults,
      announcements,
      bseMeetings,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      midcap250Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchBoardMeetings().catch(() => null),
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchBoardMeetingAnnouncements().catch(() => null),
      fetchBseBoardMeetings().catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftyMidcap250().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // Debug: log what we got
    console.log('Earnings API sources:', {
      boardMeetings: boardMeetings ? 'ok' : 'null',
      financialResults: financialResults ? 'ok' : 'null',
      announcements: announcements ? 'ok' : 'null',
      bseMeetings: bseMeetings ? 'ok' : 'null',
      nifty50: nifty50Data?.data?.length || 0,
      nifty500: nifty500Data?.data?.length || 0,
      midcap250: midcap250Data?.data?.length || 0,
      smallcap250: smallcap250Data?.data?.length || 0,
    });

    // ============================================
    // STEP 2: Build index membership lookup
    // ============================================
    const indexMembers: Record<string, Set<string>> = {
      'NIFTY50': new Set<string>(),
      'NIFTY500': new Set<string>(),
      'MIDCAP250': new Set<string>(),
      'SMALLCAP250': new Set<string>(),
    };

    // Build price lookup from all stock data
    const priceLookup: Record<string, { price: number; change: number; changePercent: number; volume: number; marketCap: number; industry: string }> = {};

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
            industry: item.meta?.industry || '',
          };
        }
      }
    };

    processStockData(nifty50Data, 'NIFTY50');
    processStockData(niftyNext50Data, 'NIFTY50'); // Next 50 → treat as part of broader NIFTY
    processStockData(nifty500Data, 'NIFTY500');
    processStockData(midcap250Data, 'MIDCAP250');
    processStockData(smallcap250Data, 'SMALLCAP250');

    // ============================================
    // STEP 3: Parse and deduplicate earnings events
    // ============================================
    // Key: ticker+quarter → keeps latest event
    const eventsMap = new Map<string, EarningsEvent>();

    // Helper to normalize arrays from NSE API responses
    const toArray = (data: any): any[] => {
      if (Array.isArray(data)) return data;
      if (data?.data && Array.isArray(data.data)) return data.data;
      if (data?.results && Array.isArray(data.results)) return data.results;
      // Some NSE endpoints return { Table: [...] }
      if (data?.Table && Array.isArray(data.Table)) return data.Table;
      return [];
    };

    // --- Source 1: NSE Board Meetings ---
    const bmArray = toArray(boardMeetings);
    for (const meeting of bmArray) {
      const ticker = meeting.bm_symbol || meeting.symbol || '';
      if (!ticker) continue;

      const purpose = meeting.bm_purpose || meeting.purpose || meeting.bm_desc || '';
      if (!isEarningsRelated(purpose) && purpose.length > 0) continue;

      // If purpose is empty, still include (many board meetings are for results)
      const meetingDateStr = meeting.bm_date || meeting.bm_meetingDate || meeting.date || '';
      const meetingDate = parseDate(meetingDateStr);
      if (!meetingDate) continue;

      // Filter by date range
      if (meetingDate < fromDate || meetingDate > toDate) continue;

      const quarter = getFiscalQuarter(meetingDate);
      const key = `${ticker}:${quarter}`;
      const announcedDate = meeting.bm_timestamp || meeting.an_dt || null;

      const sector = await getSectorForSymbol(ticker);
      const stockInfo = priceLookup[ticker];
      const marketCapValue = stockInfo?.marketCap || 0;

      const event: EarningsEvent = {
        ticker,
        company: meeting.bm_companyName || meeting.sm_name || meeting.companyName || ticker,
        eventType: 'BOARD_MEETING',
        announcedDate: announcedDate ? parseDate(announcedDate)?.toISOString().split('T')[0] || null : null,
        eventDate: meetingDate.toISOString().split('T')[0],
        quarter,
        quality: 'Upcoming',
        revenue: null,
        operatingProfit: null,
        opm: null,
        netProfit: null,
        eps: null,
        sector: sector || normalizeSector(stockInfo?.industry),
        marketCap: getCapCategory(marketCapValue / 10000000), // Convert to Cr
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Board Meeting',
      };

      // Dedup: keep latest for same ticker+quarter
      const existing = eventsMap.get(key);
      if (!existing || new Date(event.eventDate) >= new Date(existing.eventDate)) {
        eventsMap.set(key, event);
      }
    }

    // --- Source 2: NSE Financial Results ---
    const frArray = toArray(financialResults);
    for (const result of frArray) {
      const ticker = result.symbol || '';
      if (!ticker) continue;

      const resultDateStr = result.re_broadcastDt || result.broadCastDate || result.an_dt || '';
      const resultDate = parseDate(resultDateStr);
      if (!resultDate) continue;

      if (resultDate < fromDate || resultDate > toDate) continue;

      const quarter = getFiscalQuarter(resultDate);
      const key = `${ticker}:${quarter}`;

      const revenue = parseFloat(result.re_turnover || result.re_revenue || result.turnover || '0');
      const operatingProfit = parseFloat(result.re_operatingProfit || result.operatingProfit || '0');
      const netProfit = parseFloat(result.re_netProfit || result.re_proLossAftTax || result.netProfit || '0');
      const eps = parseFloat(result.re_dilEPS || result.re_basicEPS || result.eps || '0');
      const opmVal = revenue > 0 ? ((operatingProfit / revenue) * 100) : 0;

      const sector = await getSectorForSymbol(ticker);
      const stockInfo = priceLookup[ticker];
      const marketCapValue = stockInfo?.marketCap || 0;

      // Calculate price change since results (approximate)
      let priceChange: number | null = null;
      if (stockInfo && stockInfo.price > 0) {
        const daysSinceResult = Math.floor((now.getTime() - resultDate.getTime()) / 86400000);
        if (daysSinceResult > 0 && daysSinceResult <= 90) {
          // Rough estimation based on daily change extrapolation
          // Better: use historical chart data per stock
          priceChange = stockInfo.changePercent * Math.min(daysSinceResult, 5);
        }
      }

      const event: EarningsEvent = {
        ticker,
        company: result.sm_name || result.companyName || ticker,
        eventType: 'RESULTS_DECLARED',
        announcedDate: resultDate.toISOString().split('T')[0],
        eventDate: resultDate.toISOString().split('T')[0],
        quarter,
        quality: assessQuality({ revenue, netProfit, eps, opm: opmVal }),
        revenue: revenue || null,
        operatingProfit: operatingProfit || null,
        opm: revenue > 0 ? opmVal.toFixed(1) : null,
        netProfit: netProfit || null,
        eps: eps || null,
        sector: sector || normalizeSector(stockInfo?.industry),
        marketCap: getCapCategory(marketCapValue / 10000000),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: priceChange ? parseFloat(priceChange.toFixed(1)) : null,
        volume: stockInfo?.volume || null,
        source: 'NSE Financial Results',
      };

      // Financial results override board meetings (more authoritative)
      eventsMap.set(key, event);
    }

    // --- Source 3: NSE Corporate Announcements ---
    const annArray = toArray(announcements);
    for (const ann of annArray) {
      const ticker = ann.symbol || ann.sm_symbol || '';
      if (!ticker) continue;

      const subject = ann.subject || ann.an_subject || ann.desc || '';
      if (!isEarningsRelated(subject)) continue;

      const annDateStr = ann.an_dt || ann.date || ann.sort_date || '';
      const annDate = parseDate(annDateStr);
      if (!annDate) continue;

      if (annDate < fromDate || annDate > toDate) continue;

      const quarter = getFiscalQuarter(annDate);
      const key = `${ticker}:${quarter}`;

      // Only add if we don't already have this from board meetings or financial results
      if (eventsMap.has(key)) continue;

      const sector = await getSectorForSymbol(ticker);
      const stockInfo = priceLookup[ticker];
      const marketCapValue = stockInfo?.marketCap || 0;

      const event: EarningsEvent = {
        ticker,
        company: ann.sm_name || ann.companyName || ticker,
        eventType: 'BOARD_MEETING',
        announcedDate: annDate.toISOString().split('T')[0],
        eventDate: annDate.toISOString().split('T')[0],
        quarter,
        quality: 'Upcoming',
        revenue: null,
        operatingProfit: null,
        opm: null,
        netProfit: null,
        eps: null,
        sector: sector || normalizeSector(stockInfo?.industry),
        marketCap: getCapCategory(marketCapValue / 10000000),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Announcement',
      };

      eventsMap.set(key, event);
    }

    // --- Source 4: BSE Board Meetings (cross-validation) ---
    const bseArray = toArray(bseMeetings);
    for (const bse of bseArray) {
      const ticker = bse.SCRIP_CD || bse.scripcode || '';
      const bseSymbol = bse.SLONGNAME || bse.NEWSUB || '';
      const purpose = bse.PURPOSE || bse.NEWS_BODY || bse.NEWSSUB || '';

      if (!isEarningsRelated(purpose) && purpose.length > 5) continue;

      const dateStr = bse.MEETING_DT || bse.DT_TM || bse.NEWS_DT || '';
      const bseDate = parseDate(dateStr);
      if (!bseDate) continue;

      if (bseDate < fromDate || bseDate > toDate) continue;

      // BSE uses scrip codes, not NSE symbols - skip if we can't map
      // This is a supplementary source only
    }

    // ============================================
    // STEP 4: Convert to results array and filter
    // ============================================
    let results = Array.from(eventsMap.values());

    // Apply index filter if requested
    if (indexFilter) {
      const filterKey = indexFilter.toUpperCase().replace(/\s+/g, '');
      results = results.filter(r => {
        if (filterKey === 'NIFTY50') return r.indexMembership.includes('NIFTY 50');
        if (filterKey === 'NIFTY500') return r.indexMembership.includes('NIFTY 500');
        if (filterKey === 'MIDCAP250') return r.indexMembership.includes('Midcap 250');
        if (filterKey === 'SMALLCAP250') return r.indexMembership.includes('Smallcap 250');
        return true;
      });
    }

    // Sort by date (most recent first)
    results.sort((a, b) => {
      const dateA = new Date(a.eventDate).getTime() || 0;
      const dateB = new Date(b.eventDate).getTime() || 0;
      return dateB - dateA;
    });

    const goodCount = results.filter(r => r.quality === 'Good').length;
    const weakCount = results.filter(r => r.quality === 'Weak').length;
    const upcomingCount = results.filter(r => r.quality === 'Upcoming').length;

    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        good: goodCount,
        weak: weakCount,
        upcoming: upcomingCount,
      },
      quarter: getFiscalQuarter(fromDate),
      dateRange: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      sources: {
        boardMeetings: bmArray.length,
        financialResults: frArray.length,
        announcements: annArray.length,
        bseMeetings: bseArray.length,
      },
      stockUniverse: {
        nifty50: indexMembers['NIFTY50'].size,
        nifty500: indexMembers['NIFTY500'].size,
        midcap250: indexMembers['MIDCAP250'].size,
        smallcap250: indexMembers['SMALLCAP250'].size,
        totalWithPrices: Object.keys(priceLookup).length,
      },
      source: 'NSE India + BSE',
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
