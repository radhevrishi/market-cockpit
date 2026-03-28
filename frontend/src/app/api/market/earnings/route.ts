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
  fetchCorporateAnnouncementsPaginated,
  fetchBoardMeetingsForDateRange,
  fetchBseBoardMeetings,
  fetchEventCalendar,
  getSectorForSymbol,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60s for Vercel

// =============================================
// EARNINGS CALENDAR - Production Grade
// =============================================
// Sources: NSE Board Meetings + Financial Results + Corporate Announcements + BSE
// Approach: Parse ALL board meeting data, extract dates, deduplicate, enrich

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
const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (!s) return null;
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

    // Format: YYYY-MM-DD (ISO-like)
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

// Helper to normalize arrays from NSE API responses
function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  if (data?.Table && Array.isArray(data.Table)) return data.Table;
  return [];
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
    lower.includes('outcome of board meeting') ||
    lower.includes('period ended') ||
    lower.includes('results for period') ||
    lower.includes('submitted to the exchange') ||
    lower.includes('inter alia') || // "inter alia, to consider..."
    lower.includes('financial statements') ||
    lower.includes('quarterly earnings') ||
    lower.includes('profit and loss') ||
    lower.includes('profit & loss') ||
    lower.includes('balance sheet')
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
    isEarningsRelated(ann.bm_desc || '') ||
    isEarningsRelated(ann.purpose || '') ||
    isEarningsRelated(ann.smIndustry || '')
  );
}

// Board meetings from NSE often have a purpose field. If it mentions financial results, it's earnings.
// But many board meetings have purpose = "Financial Results/Dividend" or similar.
// We should be INCLUSIVE - accept the meeting if purpose contains "result" OR "financial" OR "dividend"
function isBoardMeetingEarningsRelated(meeting: any): boolean {
  // Check all possible purpose/description fields
  const fields = [
    meeting.bm_purpose, meeting.purpose, meeting.bm_desc, meeting.desc,
    meeting.subject, meeting.attchmntText, meeting.sm_name,
  ].filter(Boolean);

  for (const field of fields) {
    const lower = field.toLowerCase();
    if (
      lower.includes('result') ||
      lower.includes('financial') ||
      lower.includes('dividend') ||
      lower.includes('earning') ||
      lower.includes('quarter') ||
      lower.includes('annual') ||
      lower.includes('interim') ||
      lower.includes('accounts') ||
      lower.includes('audit')
    ) {
      return true;
    }
  }
  return false;
}

// Assess quality based on financial metrics
function assessQuality(result: any): 'Good' | 'Weak' | 'Upcoming' {
  if (!result.revenue && !result.netProfit && !result.eps) return 'Upcoming';

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
function getCapCategory(marketCapCr: number): string {
  if (marketCapCr >= 50000) return 'Large Cap';
  if (marketCapCr >= 15000) return 'Mid Cap';
  if (marketCapCr >= 5000) return 'Small Cap';
  if (marketCapCr > 0) return 'Micro Cap';
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
      toDate = new Date(year, m, 0); // Last day of month
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    }

    const formatNSEDate = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    // For board meetings: fetch intimations from 90 days BEFORE target month
    // because meetings scheduled for March were intimated in Jan/Feb
    const bmFetchFrom = new Date(fromDate);
    bmFetchFrom.setDate(bmFetchFrom.getDate() - 90);

    // For announcements: fetch for the target month (results declared in this month)
    const annFetchFrom = new Date(fromDate);
    annFetchFrom.setDate(annFetchFrom.getDate() - 7); // 1 week before for overlap

    // ============================================
    // STEP 1: Fetch all data sources in parallel
    // ============================================
    const [
      boardMeetings,
      boardMeetingsDateRange,
      financialResults,
      latestFinancialResults,
      announcements,
      announcementsPaginated,
      bseMeetings,
      eventCalendar,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      midcap250Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchBoardMeetings().catch(() => null),
      // Fetch board meetings intimated in past 90 days (captures meetings scheduled for target month)
      fetchBoardMeetingsForDateRange(formatNSEDate(bmFetchFrom), formatNSEDate(toDate)).catch(() => null),
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetingAnnouncements().catch(() => null),
      // Fetch announcements for target month
      fetchCorporateAnnouncementsPaginated(formatNSEDate(annFetchFrom), formatNSEDate(toDate), 10).catch(() => []),
      fetchBseBoardMeetings().catch(() => null),
      fetchEventCalendar().catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftyMidcap250().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // Normalize all data sources to arrays
    const bmArray1 = toArray(boardMeetings);
    const bmArray2 = toArray(boardMeetingsDateRange);
    const frArray = toArray(financialResults);
    const latestFrArray = toArray(latestFinancialResults);
    const annArray1 = toArray(announcements);
    const annArray2 = Array.isArray(announcementsPaginated) ? announcementsPaginated : toArray(announcementsPaginated);
    const bseArray = toArray(bseMeetings);
    const eventCalArray = toArray(eventCalendar);

    // Combine and deduplicate board meetings
    const bmSeen = new Set<string>();
    const bmCombined: any[] = [];
    for (const bm of [...bmArray1, ...bmArray2]) {
      const key = `${bm.bm_symbol || bm.symbol}:${bm.bm_date || bm.date}`;
      if (!bmSeen.has(key)) {
        bmSeen.add(key);
        bmCombined.push(bm);
      }
    }

    // Combine and deduplicate announcements
    const annSeen = new Set<string>();
    const annCombined: any[] = [];
    for (const ann of [...annArray1, ...annArray2]) {
      const key = `${ann.symbol || ann.sm_symbol}:${ann.seq_id || ann.an_dt || ann.sort_date || ''}`;
      if (!annSeen.has(key)) {
        annSeen.add(key);
        annCombined.push(ann);
      }
    }

    console.log('Earnings API sources:', {
      boardMeetings: bmCombined.length,
      bmArray1: bmArray1.length,
      bmArray2: bmArray2.length,
      financialResults: frArray.length,
      latestFinancialResults: latestFrArray.length,
      announcements: annCombined.length,
      annArray1: annArray1.length,
      annArray2: annArray2.length,
      bseMeetings: bseArray.length,
      eventCalendar: eventCalArray.length,
      nifty50: nifty50Data?.data?.length || 0,
      nifty500: nifty500Data?.data?.length || 0,
      midcap250: midcap250Data?.data?.length || 0,
      smallcap250: smallcap250Data?.data?.length || 0,
    });

    if (debug) {
      // Return raw samples for debugging
      // Count how many board meetings have bm_date in target month
      const bmInMonth = bmCombined.filter(bm => {
        const d = parseDate(bm.bm_date || bm.date || '');
        return d && d >= fromDate && d <= toDate;
      });
      const bmEarningsInMonth = bmInMonth.filter(bm => isBoardMeetingEarningsRelated(bm));

      return NextResponse.json({
        debug: true,
        dateRange: { from: formatNSEDate(fromDate), to: formatNSEDate(toDate) },
        bmFetchRange: { from: formatNSEDate(bmFetchFrom), to: formatNSEDate(toDate) },
        bmInTargetMonth: bmInMonth.length,
        bmEarningsInTargetMonth: bmEarningsInMonth.length,
        counts: {
          bmArray1: bmArray1.length,
          bmArray2: bmArray2.length,
          bmCombined: bmCombined.length,
          frArray: frArray.length,
          latestFrArray: latestFrArray.length,
          annArray1: annArray1.length,
          annArray2: annArray2.length,
          annCombined: annCombined.length,
          bseArray: bseArray.length,
          eventCalArray: eventCalArray.length,
        },
        samples: {
          boardMeetingsAll: bmCombined.slice(0, 3),
          boardMeetingsInMonth: bmInMonth.slice(0, 10),
          boardMeetingsEarningsInMonth: bmEarningsInMonth.slice(0, 10),
          financialResults: frArray.slice(0, 5),
          latestFinancialResults: latestFrArray.slice(0, 5),
          announcementsEarnings: annCombined.filter(a => isAnnouncementEarningsRelated(a)).slice(0, 10),
          bseMeetings: bseArray.slice(0, 5),
          eventCalendarEarnings: eventCalArray.filter(e => {
            const d = (e.bm_desc || e.desc || '').toLowerCase();
            const p = (e.purpose || '').toLowerCase();
            return d.includes('result') || d.includes('financial') || d.includes('dividend') || p.includes('result') || p.includes('financial');
          }).slice(0, 10),
        },
        rawStructure: {
          boardMeetings: boardMeetings ? { type: typeof boardMeetings, isArray: Array.isArray(boardMeetings), topKeys: typeof boardMeetings === 'object' && !Array.isArray(boardMeetings) ? Object.keys(boardMeetings).slice(0, 10) : null } : null,
          financialResults: financialResults ? { type: typeof financialResults, isArray: Array.isArray(financialResults), topKeys: typeof financialResults === 'object' && !Array.isArray(financialResults) ? Object.keys(financialResults).slice(0, 10) : null } : null,
          announcements: announcements ? { type: typeof announcements, isArray: Array.isArray(announcements), topKeys: typeof announcements === 'object' && !Array.isArray(announcements) ? Object.keys(announcements).slice(0, 10) : null } : null,
          latestFinancialResults: latestFinancialResults ? { type: typeof latestFinancialResults, isArray: Array.isArray(latestFinancialResults), topKeys: typeof latestFinancialResults === 'object' && !Array.isArray(latestFinancialResults) ? Object.keys(latestFinancialResults).slice(0, 10) : null } : null,
          eventCalendar: eventCalendar ? { type: typeof eventCalendar, isArray: Array.isArray(eventCalendar), topKeys: typeof eventCalendar === 'object' && !Array.isArray(eventCalendar) ? Object.keys(eventCalendar).slice(0, 10) : null } : null,
        },
      });
    }

    // ============================================
    // STEP 2: Build index membership & price lookup
    // ============================================
    const indexMembers: Record<string, Set<string>> = {
      'NIFTY50': new Set<string>(),
      'NIFTY500': new Set<string>(),
      'MIDCAP250': new Set<string>(),
      'SMALLCAP250': new Set<string>(),
    };

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
            industry: item.meta?.industry || item.industry || '',
          };
        }
      }
    };

    processStockData(nifty50Data, 'NIFTY50');
    processStockData(niftyNext50Data, 'NIFTY50');
    processStockData(nifty500Data, 'NIFTY500');
    processStockData(midcap250Data, 'MIDCAP250');
    processStockData(smallcap250Data, 'SMALLCAP250');

    // Pre-batch sector lookups for all tickers we'll encounter
    const allTickers = new Set<string>();
    for (const bm of bmCombined) allTickers.add(bm.bm_symbol || bm.symbol || '');
    for (const fr of frArray) allTickers.add(fr.symbol || '');
    for (const fr of latestFrArray) allTickers.add(fr.symbol || '');
    for (const ann of annCombined) allTickers.add(ann.symbol || ann.sm_symbol || '');
    allTickers.delete('');

    // Batch sector lookup (single await instead of N sequential awaits)
    const sectorMap: Record<string, string> = {};
    const tickerArr = Array.from(allTickers);
    const sectorResults = await Promise.all(tickerArr.map(t => getSectorForSymbol(t)));
    tickerArr.forEach((t, i) => { sectorMap[t] = sectorResults[i]; });

    // Helper to get sector
    const getSector = (ticker: string, industry?: string): string => {
      return sectorMap[ticker] || normalizeSector(industry) || 'Other';
    };

    // ============================================
    // STEP 3: Parse and deduplicate earnings events
    // ============================================
    const eventsMap = new Map<string, EarningsEvent>();

    // --- Source 1: NSE Board Meetings ---
    // Key insight: bm_date is the MEETING date, but we fetched by INTIMATION date (90 days back).
    // We must filter by bm_date being within the target month.
    for (const meeting of bmCombined) {
      const ticker = meeting.bm_symbol || meeting.symbol || '';
      if (!ticker) continue;

      // Check if this board meeting is earnings-related
      // Be INCLUSIVE: accept if purpose/desc mentions results/financial/dividend or if purpose is empty/short
      const isRelated = isBoardMeetingEarningsRelated(meeting);
      const purpose = meeting.bm_purpose || meeting.purpose || '';
      const desc = meeting.bm_desc || meeting.desc || '';
      // Only skip if we have a clear non-financial purpose AND desc doesn't mention financial
      if (!isRelated && purpose.length > 10 && !isBoardMeetingEarningsRelated({ bm_desc: desc })) continue;

      const meetingDateStr = meeting.bm_date || meeting.bm_meetingDate || meeting.date || '';
      const meetingDate = parseDate(meetingDateStr);
      if (!meetingDate) continue;

      // Filter by MEETING DATE being within the target month
      if (meetingDate < fromDate || meetingDate > toDate) continue;

      const quarter = getFiscalQuarter(meetingDate);
      const key = `${ticker}:${quarter}`;
      const announcedDate = meeting.bm_timestamp || meeting.an_dt || null;
      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

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
        sector: getSector(ticker, stockInfo?.industry),
        marketCap: getCapCategory(marketCapCr),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Board Meeting',
      };

      const existing = eventsMap.get(key);
      if (!existing || new Date(event.eventDate) >= new Date(existing.eventDate)) {
        eventsMap.set(key, event);
      }
    }

    // --- Source 2: NSE Financial Results ---
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
      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

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
        sector: getSector(ticker, stockInfo?.industry),
        marketCap: getCapCategory(marketCapCr),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Financial Results',
      };

      // Financial results override board meetings (more authoritative)
      eventsMap.set(key, event);
    }

    // --- Source 3: NSE Corporate Announcements ---
    for (const ann of annCombined) {
      const ticker = ann.symbol || ann.sm_symbol || '';
      if (!ticker) continue;

      if (!isAnnouncementEarningsRelated(ann)) continue;

      const annDateStr = ann.sort_date || ann.an_dt || ann.date || '';
      const annDate = parseDate(annDateStr);
      if (!annDate) continue;
      if (annDate < fromDate || annDate > toDate) continue;

      const quarter = getFiscalQuarter(annDate);
      const key = `${ticker}:${quarter}`;

      // Only add if we don't already have a RESULTS_DECLARED for this ticker+quarter
      if (eventsMap.has(key) && eventsMap.get(key)!.eventType === 'RESULTS_DECLARED') continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

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
        quality: isOutcome ? 'Upcoming' : 'Upcoming',
        revenue: null,
        operatingProfit: null,
        opm: null,
        netProfit: null,
        eps: null,
        sector: getSector(ticker, stockInfo?.industry),
        marketCap: getCapCategory(marketCapCr),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Announcement',
      };

      eventsMap.set(key, event);
    }

    // --- Source 4: Latest Financial Results (no date filter) ---
    for (const result of latestFrArray) {
      const ticker = result.symbol || '';
      if (!ticker) continue;

      const resultDateStr = result.re_broadcastDt || result.broadCastDate || result.an_dt || '';
      const resultDate = parseDate(resultDateStr);
      if (!resultDate) continue;
      if (resultDate < fromDate || resultDate > toDate) continue;

      const quarter = getFiscalQuarter(resultDate);
      const key = `${ticker}:${quarter}`;
      if (eventsMap.has(key) && eventsMap.get(key)!.eventType === 'RESULTS_DECLARED') continue;

      const revenue = parseFloat(result.re_turnover || result.re_revenue || '0');
      const operatingProfit = parseFloat(result.re_operatingProfit || '0');
      const netProfit = parseFloat(result.re_netProfit || result.re_proLossAftTax || '0');
      const eps = parseFloat(result.re_dilEPS || result.re_basicEPS || '0');
      const opmVal = revenue > 0 ? ((operatingProfit / revenue) * 100) : 0;
      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      eventsMap.set(key, {
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
        sector: getSector(ticker, stockInfo?.industry),
        marketCap: getCapCategory(marketCapCr),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Latest Results',
      });
    }

    // --- Source 5: NSE Event Calendar ---
    // Event calendar has purpose + bm_desc fields. Check BOTH for earnings keywords.
    for (const evt of eventCalArray) {
      const category = (evt.bm_category || evt.category || evt.purpose || '').toLowerCase();
      const evtDesc = (evt.bm_desc || evt.desc || '').toLowerCase();
      const isEvtEarnings = category.includes('result') || category.includes('earning') || category.includes('financial') ||
        evtDesc.includes('result') || evtDesc.includes('financial') || evtDesc.includes('dividend') ||
        evtDesc.includes('quarter') || evtDesc.includes('annual') || evtDesc.includes('audit') ||
        evtDesc.includes('inter alia') || evtDesc.includes('period ended');
      if (!isEvtEarnings) continue;

      const ticker = evt.symbol || evt.bm_symbol || '';
      if (!ticker) continue;

      const dateStr = evt.bm_date || evt.date || evt.event_date || '';
      const eventDate = parseDate(dateStr);
      if (!eventDate) continue;
      if (eventDate < fromDate || eventDate > toDate) continue;

      const quarter = getFiscalQuarter(eventDate);
      const key = `${ticker}:${quarter}`;
      if (eventsMap.has(key)) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      eventsMap.set(key, {
        ticker,
        company: evt.sm_name || evt.companyName || ticker,
        eventType: 'BOARD_MEETING',
        announcedDate: null,
        eventDate: eventDate.toISOString().split('T')[0],
        quarter,
        quality: 'Upcoming',
        revenue: null, operatingProfit: null, opm: null, netProfit: null, eps: null,
        sector: getSector(ticker, stockInfo?.industry),
        marketCap: getCapCategory(marketCapCr),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'NSE Event Calendar',
      });
    }

    // --- Source 6: BSE Board Meetings (cross-validation) ---
    for (const bse of bseArray) {
      const purpose = bse.PURPOSE || bse.NEWS_BODY || bse.NEWSSUB || '';
      if (!isEarningsRelated(purpose) && purpose.length > 10) continue;

      const dateStr = bse.MEETING_DT || bse.DT_TM || bse.NEWS_DT || '';
      const bseDate = parseDate(dateStr);
      if (!bseDate) continue;
      if (bseDate < fromDate || bseDate > toDate) continue;

      // BSE uses scrip codes - try to use NSESYMBOL if available
      const ticker = bse.NSESYMBOL || bse.SCRIP_CD || '';
      if (!ticker) continue;

      const quarter = getFiscalQuarter(bseDate);
      const key = `${ticker}:${quarter}`;
      if (eventsMap.has(key)) continue; // NSE data takes priority

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      eventsMap.set(key, {
        ticker,
        company: bse.SLONGNAME || bse.NEWSUB || ticker,
        eventType: 'BOARD_MEETING',
        announcedDate: null,
        eventDate: bseDate.toISOString().split('T')[0],
        quarter,
        quality: 'Upcoming',
        revenue: null, operatingProfit: null, opm: null, netProfit: null, eps: null,
        sector: getSector(ticker, stockInfo?.industry),
        marketCap: getCapCategory(marketCapCr),
        indexMembership: getIndexMembership(ticker, indexMembers),
        currentPrice: stockInfo?.price || null,
        priceChange: null,
        volume: stockInfo?.volume || null,
        source: 'BSE',
      });
    }

    // ============================================
    // STEP 4: Convert to results array and filter
    // ============================================
    let results = Array.from(eventsMap.values());

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

    // Sort by date (earliest first for calendar display)
    results.sort((a, b) => {
      const dateA = new Date(a.eventDate).getTime() || 0;
      const dateB = new Date(b.eventDate).getTime() || 0;
      return dateA - dateB;
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
        boardMeetings: bmCombined.length,
        financialResults: frArray.length,
        latestResults: latestFrArray.length,
        announcements: annCombined.length,
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
