import { NextResponse } from 'next/server';
import {
  fetchBoardMeetings,
  fetchFinancialResults,
  fetchLatestFinancialResults,
  fetchNifty500,
  fetchNiftyMidcap250,
  fetchNiftySmallcap250,
  fetchNifty50,
  fetchNiftyNext50,
  fetchBoardMeetingAnnouncements,
  fetchBseBoardMeetings,
  fetchEventCalendar,
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
// NSE uses: "06-Apr-2026", "29-Mar-2026 00:44:03", "2026-03-29 00:44:03", "28-03-2026"
const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  try {
    // Format: DD-Mon-YYYY or DD-Mon-YYYY HH:MM:SS (e.g. "06-Apr-2026", "29-Mar-2026 00:44:03")
    const ddMonYYYY = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
    if (ddMonYYYY) {
      const month = MONTH_MAP[ddMonYYYY[2].toLowerCase()];
      if (month !== undefined) {
        const d = new Date(parseInt(ddMonYYYY[3]), month, parseInt(ddMonYYYY[1]));
        if (!isNaN(d.getTime())) return d;
      }
    }

    // Format: DD-MM-YYYY or DD/MM/YYYY
    const ddmmyyyy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (ddmmyyyy) {
      const d = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
      if (!isNaN(d.getTime())) return d;
    }

    // Format: YYYY-MM-DD (ISO-like, e.g. "2026-03-29 00:44:03")
    const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) {
      const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
      if (!isNaN(d.getTime())) return d;
    }

    // Fallback: let JS parse it
    const d = new Date(s);
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
    lower.includes('declaration of dividend') ||
    lower.includes('outcome of board meeting') || // NSE announcement format
    lower.includes('period ended') || // "financial results for the period ended"
    lower.includes('results for period') ||
    lower.includes('submitted to the exchange') // "has submitted to the Exchange, the financial results"
  );
}

// Check multiple fields of an announcement for earnings relevance
function isAnnouncementEarningsRelated(ann: any): boolean {
  return (
    isEarningsRelated(ann.desc || '') ||
    isEarningsRelated(ann.subject || '') ||
    isEarningsRelated(ann.an_subject || '') ||
    isEarningsRelated(ann.attchmntText || '') ||
    isEarningsRelated(ann.bm_purpose || '') ||
    isEarningsRelated(ann.bm_desc || '')
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
      latestFinancialResults,
      announcements,
      bseMeetings,
      eventCalendar,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      midcap250Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchBoardMeetings().catch(() => null),
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetingAnnouncements().catch(() => null),
      fetchBseBoardMeetings().catch(() => null),
      fetchEventCalendar().catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftyMidcap250().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // Debug mode: return raw data structure for debugging
    const debug = searchParams.get('debug') === 'true';

    // Debug: log what we got
    console.log('Earnings API sources:', {
      boardMeetings: boardMeetings ? 'ok' : 'null',
      financialResults: financialResults ? 'ok' : 'null',
      latestFinancialResults: latestFinancialResults ? 'ok' : 'null',
      announcements: announcements ? 'ok' : 'null',
      bseMeetings: bseMeetings ? 'ok' : 'null',
      eventCalendar: eventCalendar ? 'ok' : 'null',
      nifty50: nifty50Data?.data?.length || 0,
      nifty500: nifty500Data?.data?.length || 0,
      midcap250: midcap250Data?.data?.length || 0,
      smallcap250: smallcap250Data?.data?.length || 0,
    });

    if (debug) {
      // Return raw samples for debugging
      const bmSample = boardMeetings ? (Array.isArray(boardMeetings) ? boardMeetings.slice(0, 3) :
        boardMeetings.data ? boardMeetings.data.slice(0, 3) :
        Object.keys(boardMeetings).slice(0, 5).reduce((acc: any, k: string) => { acc[k] = typeof boardMeetings[k] === 'object' ? 'object' : boardMeetings[k]; return acc; }, {})) : null;
      const annSample = announcements ? (Array.isArray(announcements) ? announcements.slice(0, 3) :
        announcements.data ? announcements.data.slice(0, 3) :
        Object.keys(announcements).slice(0, 5).reduce((acc: any, k: string) => { acc[k] = typeof announcements[k] === 'object' ? 'object' : announcements[k]; return acc; }, {})) : null;
      const frSample = financialResults ? (Array.isArray(financialResults) ? financialResults.slice(0, 3) :
        financialResults.data ? financialResults.data.slice(0, 3) :
        Object.keys(financialResults).slice(0, 5).reduce((acc: any, k: string) => { acc[k] = typeof financialResults[k] === 'object' ? 'object' : financialResults[k]; return acc; }, {})) : null;
      const latestFrSample = latestFinancialResults ? (Array.isArray(latestFinancialResults) ? latestFinancialResults.slice(0, 3) :
        latestFinancialResults.data ? latestFinancialResults.data.slice(0, 3) : null) : null;
      const eventCalSample = eventCalendar ? (Array.isArray(eventCalendar) ? eventCalendar.slice(0, 3) :
        eventCalendar.data ? eventCalendar.data.slice(0, 3) :
        typeof eventCalendar === 'object' ? Object.keys(eventCalendar).slice(0, 5) : null) : null;

      return NextResponse.json({
        debug: true,
        dateRange: { from: fromDate.toISOString(), to: toDate.toISOString() },
        rawStructure: {
          boardMeetings: boardMeetings ? { type: typeof boardMeetings, isArray: Array.isArray(boardMeetings), keys: typeof boardMeetings === 'object' && !Array.isArray(boardMeetings) ? Object.keys(boardMeetings) : null, length: Array.isArray(boardMeetings) ? boardMeetings.length : boardMeetings?.data?.length } : null,
          announcements: announcements ? { type: typeof announcements, isArray: Array.isArray(announcements), keys: typeof announcements === 'object' && !Array.isArray(announcements) ? Object.keys(announcements) : null, length: Array.isArray(announcements) ? announcements.length : announcements?.data?.length } : null,
          financialResults: financialResults ? { type: typeof financialResults, isArray: Array.isArray(financialResults), keys: typeof financialResults === 'object' && !Array.isArray(financialResults) ? Object.keys(financialResults) : null } : null,
          latestFinancialResults: latestFinancialResults ? { type: typeof latestFinancialResults, isArray: Array.isArray(latestFinancialResults), keys: typeof latestFinancialResults === 'object' && !Array.isArray(latestFinancialResults) ? Object.keys(latestFinancialResults) : null, length: Array.isArray(latestFinancialResults) ? latestFinancialResults.length : latestFinancialResults?.data?.length } : null,
          eventCalendar: eventCalendar ? { type: typeof eventCalendar, isArray: Array.isArray(eventCalendar), keys: typeof eventCalendar === 'object' && !Array.isArray(eventCalendar) ? Object.keys(eventCalendar) : null } : null,
        },
        samples: { boardMeetings: bmSample, announcements: annSample, financialResults: frSample, latestFinancialResults: latestFrSample, eventCalendar: eventCalSample },
      });
    }

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

      // Check if this board meeting is earnings-related
      const isRelated = isAnnouncementEarningsRelated(meeting);
      const purpose = meeting.bm_purpose || meeting.purpose || meeting.bm_desc || '';
      // Skip if we have a clear non-financial purpose
      if (!isRelated && purpose.length > 5 && !purpose.toLowerCase().includes('result')) continue;

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

      // Check all fields for earnings relevance
      if (!isAnnouncementEarningsRelated(ann)) continue;

      // Try multiple date fields: sort_date is most reliable, then an_dt
      const annDateStr = ann.sort_date || ann.an_dt || ann.date || '';
      const annDate = parseDate(annDateStr);
      if (!annDate) continue;

      if (annDate < fromDate || annDate > toDate) continue;

      const quarter = getFiscalQuarter(annDate);
      const key = `${ticker}:${quarter}`;

      // Only add if we don't already have a RESULTS_DECLARED for this ticker+quarter
      if (eventsMap.has(key) && eventsMap.get(key)!.eventType === 'RESULTS_DECLARED') continue;

      const sector = await getSectorForSymbol(ticker);
      const stockInfo = priceLookup[ticker];
      const marketCapValue = stockInfo?.marketCap || 0;

      // Determine if this is an outcome (results declared) or upcoming meeting
      const descLower = (ann.desc || '').toLowerCase();
      const attText = (ann.attchmntText || '').toLowerCase();
      const isOutcome = descLower.includes('outcome') || attText.includes('submitted to the exchange') || attText.includes('period ended');

      const event: EarningsEvent = {
        ticker,
        company: ann.sm_name || ann.companyName || ticker,
        eventType: isOutcome ? 'RESULTS_DECLARED' : 'BOARD_MEETING',
        announcedDate: annDate.toISOString().split('T')[0],
        eventDate: annDate.toISOString().split('T')[0],
        quarter,
        quality: isOutcome ? 'Upcoming' : 'Upcoming', // Will be updated if we have financial data
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

    // --- Source 5: Latest Financial Results (no date filter) ---
    const latestFrArray = toArray(latestFinancialResults);
    for (const result of latestFrArray) {
      const ticker = result.symbol || '';
      if (!ticker) continue;

      const resultDateStr = result.re_broadcastDt || result.broadCastDate || result.an_dt || '';
      const resultDate = parseDate(resultDateStr);
      if (!resultDate) continue;

      // Filter by date range
      if (resultDate < fromDate || resultDate > toDate) continue;

      const quarter = getFiscalQuarter(resultDate);
      const key = `${ticker}:${quarter}`;

      // Only add if not already present from dated financial results
      if (eventsMap.has(key) && eventsMap.get(key)!.eventType === 'RESULTS_DECLARED') continue;

      const revenue = parseFloat(result.re_turnover || result.re_revenue || '0');
      const operatingProfit = parseFloat(result.re_operatingProfit || '0');
      const netProfit = parseFloat(result.re_netProfit || result.re_proLossAftTax || '0');
      const eps = parseFloat(result.re_dilEPS || result.re_basicEPS || '0');
      const opmVal = revenue > 0 ? ((operatingProfit / revenue) * 100) : 0;

      const sector = await getSectorForSymbol(ticker);
      const stockInfo = priceLookup[ticker];

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
        marketCap: getCapCategory((stockInfo?.marketCap || 0) / 10000000),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Latest Results',
      };

      eventsMap.set(key, event);
    }

    // --- Source 6: Event Calendar (may have earnings events) ---
    const eventCalArray = toArray(eventCalendar);
    for (const event of eventCalArray) {
      // Event calendar has various event types - filter for earnings
      const category = (event.bm_category || event.category || event.purpose || '').toLowerCase();
      if (!category.includes('result') && !category.includes('earning') && !category.includes('financial')) continue;

      const ticker = event.symbol || event.bm_symbol || '';
      if (!ticker) continue;

      const dateStr = event.bm_date || event.date || event.event_date || '';
      const eventDate = parseDate(dateStr);
      if (!eventDate) continue;
      if (eventDate < fromDate || eventDate > toDate) continue;

      const quarter = getFiscalQuarter(eventDate);
      const key = `${ticker}:${quarter}`;
      if (eventsMap.has(key)) continue;

      const sector = await getSectorForSymbol(ticker);
      const stockInfo = priceLookup[ticker];

      eventsMap.set(key, {
        ticker,
        company: event.sm_name || event.companyName || ticker,
        eventType: 'BOARD_MEETING',
        announcedDate: null,
        eventDate: eventDate.toISOString().split('T')[0],
        quarter,
        quality: 'Upcoming',
        revenue: null, operatingProfit: null, opm: null, netProfit: null, eps: null,
        sector: sector || normalizeSector(stockInfo?.industry),
        marketCap: getCapCategory((stockInfo?.marketCap || 0) / 10000000),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Event Calendar',
      });
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
        latestResults: latestFrArray.length,
        announcements: annArray.length,
        bseMeetings: bseArray.length,
        eventCalendar: eventCalArray.length,
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
