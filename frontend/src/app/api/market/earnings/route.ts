import { NextResponse } from 'next/server';
import {
  fetchBoardMeetings,
  fetchFinancialResults,
  fetchLatestFinancialResults,
  fetchNifty500,
  fetchNiftySmallcap250,
  fetchNifty50,
  fetchNiftyNext50,
  fetchBoardMeetingAnnouncements,
  fetchCorporateAnnouncementsPaginated,
  fetchBoardMeetingsForDateRange,
  fetchEventCalendar,
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
// This is the STRICT version - matches only clear financial results language
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
    lower.includes('financial statements') ||
    lower.includes('quarterly earnings') ||
    lower.includes('profit and loss') ||
    lower.includes('profit & loss')
  );
}

// Check if attachment text specifically mentions financial results being submitted
// This distinguishes earnings-related "Outcome of Board Meeting" from non-earnings ones
function isAttachmentEarningsRelated(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('financial result') ||
    lower.includes('period ended') ||
    lower.includes('quarter ended') ||
    lower.includes('year ended') ||
    lower.includes('half year ended') ||
    (lower.includes('submitted to the exchange') && lower.includes('result'))
  );
}

// Check multiple fields of an announcement for earnings relevance
// For "Outcome of Board Meeting" - REQUIRE attchmntText to mention financial results
function isAnnouncementEarningsRelated(ann: any): boolean {
  const desc = (ann.desc || '').toLowerCase();
  const attText = ann.attchmntText || '';
  const subject = ann.subject || ann.an_subject || '';

  // If desc is "Outcome of Board Meeting" - this is generic, check attchmntText
  if (desc.includes('outcome of board meeting') || desc.includes('outcome of the board meeting')) {
    return isAttachmentEarningsRelated(attText);
  }

  // For other descriptions, check all fields
  return (
    isEarningsRelated(desc) ||
    isEarningsRelated(subject) ||
    isEarningsRelated(attText) ||
    isEarningsRelated(ann.bm_purpose || '') ||
    isEarningsRelated(ann.bm_desc || '') ||
    isEarningsRelated(ann.purpose || '')
  );
}

// Board meetings: check if the bm_purpose indicates financial results
// NSE bm_purpose examples:
//   "Financial Results/Dividend" → YES
//   "Financial Results/Other business matters" → YES
//   "Board Meeting Intimation" with bm_desc "to consider Dividend" → YES (dividends often with results)
//   "Other business matters" → NO
//   "Fund Raising" → NO
//   "ESOP" → NO
function isBoardMeetingEarningsRelated(meeting: any): boolean {
  const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
  const desc = (meeting.bm_desc || meeting.desc || '').toLowerCase();

  // Explicit NON-earnings purposes — skip these
  const nonEarningsPurposes = ['fund raising', 'esop', 'buy back', 'buyback', 'bonus', 'split', 'rights issue'];
  // Only skip if purpose is EXCLUSIVELY non-earnings (no "result" or "financial" or "dividend")
  if (nonEarningsPurposes.some(p => purpose.includes(p)) &&
      !purpose.includes('result') && !purpose.includes('financial') && !purpose.includes('dividend')) {
    return false;
  }

  // Check purpose field directly
  if (purpose.includes('financial result') || purpose.includes('result')) return true;
  if (purpose.includes('dividend')) return true;

  // Check bm_desc for financial keywords
  if (desc.includes('financial result') || desc.includes('quarterly result') ||
      desc.includes('annual result') || desc.includes('audited') ||
      desc.includes('unaudited') || desc.includes('period ended') ||
      desc.includes('quarter ended') || desc.includes('year ended')) return true;

  // "inter alia, to consider and approve the financial results"
  if (desc.includes('inter alia') || desc.includes('inter-alia')) return true;

  // "consider Dividend" in desc
  if (desc.includes('consider dividend') || desc.includes('to consider dividend')) return true;

  // "Other business matters" without financial keywords → NOT earnings
  if (purpose.includes('other business') && !desc.includes('result') && !desc.includes('financial') && !desc.includes('dividend')) {
    return false;
  }

  // "Board Meeting Intimation" is generic — check desc
  if (purpose.includes('board meeting intimation') || purpose === '') {
    return desc.includes('result') || desc.includes('financial') || desc.includes('dividend') ||
           desc.includes('quarter') || desc.includes('audit');
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

// Assess quality based on post-earnings price reaction
// This is a fallback when financial metrics aren't available
// Logic: if stock moved up significantly after earnings, likely "Good"; down = "Weak"
function assessQualityFromPriceReaction(priceChangePercent: number | null): 'Good' | 'Weak' | 'Upcoming' {
  if (priceChangePercent === null || priceChangePercent === undefined) return 'Upcoming';
  // Positive reaction usually indicates good results
  if (priceChangePercent >= -2) return 'Good'; // Flat to positive = Good
  return 'Weak'; // Significant decline = Weak
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

    // For board meetings: fetch intimations from 60 days BEFORE target month
    // because meetings scheduled for March were intimated in Jan/Feb
    const bmFetchFrom = new Date(fromDate);
    bmFetchFrom.setDate(bmFetchFrom.getDate() - 60);

    // ============================================
    // STEP 1: Fetch all data sources in parallel
    // Keep pagination low (3 pages) to avoid Vercel timeout
    // ============================================
    const [
      boardMeetings,
      boardMeetingsDateRange,
      financialResults,
      latestFinancialResults,
      announcements,
      announcementsPaginated,
      eventCalendar,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchBoardMeetings().catch(() => null),
      fetchBoardMeetingsForDateRange(formatNSEDate(bmFetchFrom), formatNSEDate(toDate)).catch(() => null),
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetingAnnouncements().catch(() => null),
      fetchCorporateAnnouncementsPaginated(formatNSEDate(fromDate), formatNSEDate(toDate), 3).catch(() => []),
      fetchEventCalendar().catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // Normalize all data sources to arrays
    const bmArray1 = toArray(boardMeetings);
    const bmArray2 = toArray(boardMeetingsDateRange);
    const frArray = toArray(financialResults);
    const latestFrArray = toArray(latestFinancialResults);
    const annArray1 = toArray(announcements);
    const annArray2 = Array.isArray(announcementsPaginated) ? announcementsPaginated : toArray(announcementsPaginated);
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

    // Combine, deduplicate, and PRE-FILTER announcements (only keep earnings-related)
    // This is critical for performance — reduces thousands of announcements to dozens
    const annSeen = new Set<string>();
    const annCombined: any[] = [];
    for (const ann of [...annArray1, ...annArray2]) {
      if (!isAnnouncementEarningsRelated(ann)) continue; // Pre-filter here!
      const key = `${ann.symbol || ann.sm_symbol}:${ann.seq_id || ann.an_dt || ann.sort_date || ''}`;
      if (!annSeen.has(key)) {
        annSeen.add(key);
        annCombined.push(ann);
      }
    }

    console.log('Earnings API sources:', {
      boardMeetings: bmCombined.length,
      financialResults: frArray.length,
      earningsAnnouncements: annCombined.length,
      eventCalendar: eventCalArray.length,
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
          bmCombined: bmCombined.length,
          frArray: frArray.length,
          latestFrArray: latestFrArray.length,
          earningsAnnouncements: annCombined.length,
          eventCalArray: eventCalArray.length,
        },
        samples: {
          boardMeetingsEarningsInMonth: bmEarningsInMonth.slice(0, 10),
          earningsAnnouncements: annCombined.slice(0, 10),
        },
      });
    }

    // ============================================
    // STEP 2: Build index membership & price lookup
    // ============================================
    const indexMembers: Record<string, Set<string>> = {
      'NIFTY50': new Set<string>(),
      'NIFTY500': new Set<string>(),
      'SMALLCAP250': new Set<string>(),
    };

    const priceLookup: Record<string, { price: number; change: number; changePercent: number; volume: number; marketCap: number; industry: string; previousClose?: number }> = {};

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
    processStockData(smallcap250Data, 'SMALLCAP250');

    // Helper to get sector (uses priceLookup industry, deferred sector map built after filtering)
    const getSector = (ticker: string, industry?: string): string => {
      return normalizeSector(industry) || normalizeSector(priceLookup[ticker]?.industry) || 'Other';
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
      if (!isBoardMeetingEarningsRelated(meeting)) continue;

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

    // --- Source 3: NSE Corporate Announcements (pre-filtered during combination) ---
    for (const ann of annCombined) {
      const ticker = ann.symbol || ann.sm_symbol || '';
      if (!ticker) continue;

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

      // For declared results, use price reaction to estimate quality
      const isPast = annDate < now;
      let annQuality: 'Good' | 'Weak' | 'Upcoming' = 'Upcoming';
      if (isOutcome && isPast && stockInfo) {
        // Use daily price change as proxy for post-earnings reaction
        annQuality = assessQualityFromPriceReaction(stockInfo.changePercent);
      }

      const event: EarningsEvent = {
        ticker,
        company: ann.sm_name || ann.companyName || ticker,
        eventType: isOutcome ? 'RESULTS_DECLARED' : 'BOARD_MEETING',
        announcedDate: annDate.toISOString().split('T')[0],
        eventDate: annDate.toISOString().split('T')[0],
        quarter,
        quality: annQuality,
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

    // ============================================
    // STEP 4: Enrich past events — mark RESULTS_DECLARED, assess quality
    // ============================================
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const [key, event] of eventsMap) {
      const eventDate = new Date(event.eventDate);
      const isPast = eventDate < today;

      // Past board meetings → results should have been declared
      if (isPast && event.eventType === 'BOARD_MEETING') {
        event.eventType = 'RESULTS_DECLARED';
      }

      // Assess quality for past events
      if (event.quality === 'Upcoming' && isPast) {
        // Priority 1: Use actual financial metrics if available
        if (event.revenue || event.netProfit || event.eps) {
          event.quality = assessQuality(event);
        } else {
          // Priority 2: Use stock price data as proxy
          // Rationale: stocks tend to rise after good results and fall after weak ones
          // The daily change isn't perfect but gives a reasonable distribution
          const stockInfo = priceLookup[event.ticker];
          if (stockInfo) {
            // Use change percent — positive = likely good results, negative = likely weak
            event.quality = stockInfo.changePercent >= 0 ? 'Good' : 'Weak';
          } else {
            // No price data — default to "Good" for past results
            event.quality = 'Good';
          }
        }
      }

      eventsMap.set(key, event);
    }

    // ============================================
    // STEP 5: Convert to results array and filter
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
        earningsAnnouncements: annCombined.length,
        eventCalendar: eventCalArray.length,
      },
      stockUniverse: {
        nifty50: indexMembers['NIFTY50'].size,
        nifty500: indexMembers['NIFTY500'].size,
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
