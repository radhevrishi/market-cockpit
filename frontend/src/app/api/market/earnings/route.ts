import { NextResponse } from 'next/server';
import {
  fetchBoardMeetings,
  fetchNifty500,
  fetchNiftySmallcap250,
  fetchNifty50,
  fetchNiftyNext50,
  fetchCorporateAnnouncementsPaginated,
  fetchBoardMeetingsForDateRange,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// =============================================
// EARNINGS CALENDAR - Matching EarningsPulse.ai
// =============================================
// Strategy:
//   1. CONFIRMED RESULTS: "Outcome of Board Meeting" announcements where
//      attchmntText mentions "submitted to the Exchange" + "financial results"
//      → These are companies that ACTUALLY declared quarterly results
//   2. UPCOMING: Future board meetings with "Financial Results" in purpose
//      → These are scheduled but results not yet out
//   3. Everything else is EXCLUDED
//
// Quality: Good / Weak / Upcoming (3-tier, matching earningspulse.ai)
//   - Good: Net profit > 0 OR positive post-earnings price move
//   - Weak: Net profit <= 0 OR negative post-earnings price move
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

// Also return the "results quarter" — the quarter the results are FOR
// e.g. if board meeting is in March 2026, results are typically for Q3 FY26 (Oct-Dec 2025)
function getResultsQuarter(meetingDate: Date, desc: string): string {
  const lower = desc.toLowerCase();

  // Try to parse quarter from description
  // "period ended December 31, 2025" → Q3 FY26
  // "period ended March 31, 2026" → Q4 FY26
  // "quarter ended 31-Dec-2025" → Q3 FY26
  const periodMatch = lower.match(/(?:period|quarter|half year|year)\s+ended\s+(?:on\s+)?(\d{1,2})?[- \/]?([a-z]+|[\d]{1,2})[- \/,]+(\d{4})/);
  if (periodMatch) {
    const monthStr = periodMatch[2];
    const yearStr = parseInt(periodMatch[3]);
    let month = -1;
    const monthMap: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6,
      jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    if (monthMap[monthStr]) month = monthMap[monthStr];
    else if (!isNaN(parseInt(monthStr))) month = parseInt(monthStr);

    if (month > 0 && yearStr > 2000) {
      const d = new Date(yearStr, month - 1, 1);
      return getFiscalQuarter(d);
    }
  }

  // Fallback: the previous quarter relative to meeting date
  // If meeting is in Jan-Mar → results are for Q3 (Oct-Dec previous)
  // If meeting is in Apr-Jun → results are for Q4 (Jan-Mar)
  // If meeting is in Jul-Sep → results are for Q1 (Apr-Jun)
  // If meeting is in Oct-Dec → results are for Q2 (Jul-Sep)
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

// Check if an "Outcome of Board Meeting" announcement is for financial results
function isOutcomeForResults(ann: any): boolean {
  const attText = (ann.attchmntText || '').toLowerCase();
  const desc = (ann.desc || '').toLowerCase();
  const subject = (ann.subject || ann.an_subject || '').toLowerCase();

  // Must be an "Outcome of Board Meeting"
  const isOutcome = desc.includes('outcome of board meeting') ||
    desc.includes('outcome of the board meeting') ||
    desc.includes('outcome of bm');

  if (!isOutcome) {
    // Also accept direct financial result submissions
    if (desc.includes('financial result') || desc.includes('quarterly result') ||
        desc.includes('half yearly result') || desc.includes('annual result')) {
      // Check attchmntText confirms submission
      if (attText.includes('submitted to the exchange') || attText.includes('financial result') ||
          attText.includes('period ended') || attText.includes('quarter ended')) {
        return true;
      }
    }
    return false;
  }

  // For Outcome of Board Meeting, check attchmntText for financial results evidence
  return (
    attText.includes('financial result') ||
    attText.includes('period ended') ||
    attText.includes('quarter ended') ||
    attText.includes('year ended') ||
    attText.includes('half year ended') ||
    (attText.includes('submitted to the exchange') && (
      attText.includes('result') || attText.includes('financial')
    ))
  );
}

// Check if board meeting purpose indicates financial results
function isBoardMeetingForResults(meeting: any): boolean {
  const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
  const desc = (meeting.bm_desc || meeting.desc || '').toLowerCase();

  // Direct financial results purpose
  if (purpose.includes('financial result')) return true;

  // Check description for clear financial results language
  if (desc.includes('financial result') || desc.includes('quarterly result') ||
      desc.includes('annual result') || desc.includes('audited result') ||
      desc.includes('unaudited result')) return true;

  // "inter alia, to consider and approve the financial results"
  if (desc.includes('inter alia') && (desc.includes('result') || desc.includes('financial'))) return true;
  if (desc.includes('inter-alia') && (desc.includes('result') || desc.includes('financial'))) return true;

  // "to consider Dividend" — often comes with results
  if (purpose.includes('dividend') && desc.includes('result')) return true;

  // Don't include pure dividend meetings without results mention
  return false;
}

// Market cap category
function getCapCategory(marketCapCr: number): string {
  if (marketCapCr >= 50000) return 'L';   // Large
  if (marketCapCr >= 15000) return 'M';   // Mid
  if (marketCapCr >= 5000) return 'S';    // Small
  if (marketCapCr > 0) return 'Micro';
  return '';
}

interface EarningsEvent {
  ticker: string;
  company: string;
  resultDate: string;       // Date results were/will be declared
  quarter: string;          // The quarter results are FOR (e.g. Q3 FY26)
  quality: 'Good' | 'Weak' | 'Upcoming';
  sector: string;
  industry: string;
  marketCap: string;
  edp: number | null;       // Earnings Day Price (price on result date)
  cmp: number | null;       // Current Market Price
  priceMove: number | null;  // % change from EDP to CMP
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

    // Calculate date range — EXACTLY the target month
    const now = new Date();
    let fromDate: Date, toDate: Date;

    if (month) {
      const [year, m] = month.split('-').map(Number);
      fromDate = new Date(year, m - 1, 1);
      toDate = new Date(year, m, 0); // Last day of month
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
    }

    const formatNSEDate = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    // Board meetings: fetch from 60 days before (intimations come early)
    const bmFetchFrom = new Date(fromDate);
    bmFetchFrom.setDate(bmFetchFrom.getDate() - 60);

    // ============================================
    // STEP 1: Fetch data sources in parallel
    // ============================================
    const [
      boardMeetings,
      boardMeetingsDateRange,
      announcementsPaginated,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchBoardMeetings().catch(() => null),
      fetchBoardMeetingsForDateRange(formatNSEDate(bmFetchFrom), formatNSEDate(toDate)).catch(() => null),
      fetchCorporateAnnouncementsPaginated(formatNSEDate(fromDate), formatNSEDate(toDate), 5).catch(() => []),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // Normalize arrays
    const bmArray1 = toArray(boardMeetings);
    const bmArray2 = toArray(boardMeetingsDateRange);
    const annArray = Array.isArray(announcementsPaginated) ? announcementsPaginated : toArray(announcementsPaginated);

    // Deduplicate board meetings
    const bmSeen = new Set<string>();
    const bmCombined: any[] = [];
    for (const bm of [...bmArray1, ...bmArray2]) {
      const key = `${bm.bm_symbol || bm.symbol}:${bm.bm_date || bm.date}`;
      if (!bmSeen.has(key)) {
        bmSeen.add(key);
        bmCombined.push(bm);
      }
    }

    // ============================================
    // STEP 2: Build price lookup from stock indices
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
    // STEP 3: Extract CONFIRMED results from announcements
    // ============================================
    // Only "Outcome of Board Meeting" with financial results attachment text
    const eventsMap = new Map<string, EarningsEvent>();
    const confirmedTickers = new Set<string>();

    let outcomeCount = 0;
    let filteredOutcomeCount = 0;

    for (const ann of annArray) {
      const ticker = ann.symbol || ann.sm_symbol || '';
      if (!ticker) continue;

      outcomeCount++;

      // STRICT: Only include actual financial results submissions
      if (!isOutcomeForResults(ann)) continue;

      filteredOutcomeCount++;

      const annDateStr = ann.sort_date || ann.an_dt || ann.date || '';
      const annDate = parseDate(annDateStr);
      if (!annDate) continue;
      if (annDate < fromDate || annDate > toDate) continue;

      const attText = ann.attchmntText || '';
      const quarter = getResultsQuarter(annDate, attText);
      const key = `${ticker}:${quarter}`;

      // Skip duplicates — keep the first (most recent) one
      if (eventsMap.has(key)) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;
      const cmp = stockInfo?.price || null;

      // For quality: use daily price change as proxy for post-earnings reaction
      // since we don't have actual EDP data from NSE
      // Good = positive change or small decline (>= -2%)
      // Weak = significant decline (< -2%)
      let quality: 'Good' | 'Weak' | 'Upcoming' = 'Upcoming';
      if (annDate <= now) {
        // Results already declared — assess quality
        // Simple heuristic: use current price vs previous close change
        const changePct = stockInfo?.changePercent || 0;
        // More generous threshold: if the stock hasn't crashed, mark as Good
        quality = changePct >= -2 ? 'Good' : 'Weak';
      }

      confirmedTickers.add(ticker);

      eventsMap.set(key, {
        ticker,
        company: ann.sm_name || ann.companyName || ticker,
        resultDate: annDate.toISOString().split('T')[0],
        quarter,
        quality,
        sector: normalizeSector(stockInfo?.industry) || 'Other',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null, // We don't have historical price data
        cmp,
        priceMove: null,
        source: 'NSE',
      });
    }

    // ============================================
    // STEP 4: Add UPCOMING from board meetings
    // ============================================
    // Only future board meetings with "Financial Results" in purpose
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let bmEarningsCount = 0;

    for (const meeting of bmCombined) {
      const ticker = meeting.bm_symbol || meeting.symbol || '';
      if (!ticker) continue;

      // Only include if specifically for financial results
      if (!isBoardMeetingForResults(meeting)) continue;

      bmEarningsCount++;

      const meetingDateStr = meeting.bm_date || meeting.bm_meetingDate || meeting.date || '';
      const meetingDate = parseDate(meetingDateStr);
      if (!meetingDate) continue;

      // Must be within the target month
      if (meetingDate < fromDate || meetingDate > toDate) continue;

      // Only include FUTURE meetings as "Upcoming"
      // For PAST meetings, only include if we don't already have a confirmed result
      const desc = meeting.bm_desc || meeting.desc || '';
      const quarter = getResultsQuarter(meetingDate, desc);
      const key = `${ticker}:${quarter}`;

      if (eventsMap.has(key)) continue; // Already have confirmed result

      if (meetingDate < today) {
        // Past meeting without confirmed result — this means results were likely declared
        // but we missed the announcement. Include it but mark based on price data.
        const stockInfo = priceLookup[ticker];
        const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;
        const cmp = stockInfo?.price || null;

        eventsMap.set(key, {
          ticker,
          company: meeting.bm_companyName || meeting.sm_name || meeting.companyName || ticker,
          resultDate: meetingDate.toISOString().split('T')[0],
          quarter,
          quality: 'Good', // Default past unconfirmed to Good
          sector: normalizeSector(stockInfo?.industry) || 'Other',
          industry: stockInfo?.industry || '',
          marketCap: getCapCategory(marketCapCr),
          edp: null,
          cmp,
          priceMove: null,
          source: 'NSE',
        });
      } else {
        // Future meeting — Upcoming
        const stockInfo = priceLookup[ticker];
        const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

        eventsMap.set(key, {
          ticker,
          company: meeting.bm_companyName || meeting.sm_name || meeting.companyName || ticker,
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
    }

    console.log('Earnings processing:', {
      totalAnnouncements: annArray.length,
      outcomeAnnouncements: outcomeCount,
      confirmedResults: filteredOutcomeCount,
      bmTotal: bmCombined.length,
      bmEarningsRelated: bmEarningsCount,
      finalEvents: eventsMap.size,
    });

    // ============================================
    // STEP 5: Filter and sort
    // ============================================
    let results = Array.from(eventsMap.values());

    // Apply index filter
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

    // Sort by date descending (most recent first, like earningspulse)
    results.sort((a, b) => {
      return new Date(b.resultDate).getTime() - new Date(a.resultDate).getTime();
    });

    const goodCount = results.filter(r => r.quality === 'Good').length;
    const weakCount = results.filter(r => r.quality === 'Weak').length;
    const upcomingCount = results.filter(r => r.quality === 'Upcoming').length;

    if (debug) {
      return NextResponse.json({
        debug: true,
        dateRange: { from: formatNSEDate(fromDate), to: formatNSEDate(toDate) },
        processing: {
          totalAnnouncements: annArray.length,
          outcomeAnnouncements: outcomeCount,
          confirmedResults: filteredOutcomeCount,
          bmTotal: bmCombined.length,
          bmEarningsRelated: bmEarningsCount,
          finalEvents: eventsMap.size,
        },
        results,
        samples: {
          // Show first 5 announcements that passed the filter
          confirmedAnnouncements: annArray.filter(a => isOutcomeForResults(a)).slice(0, 5).map(a => ({
            symbol: a.symbol,
            desc: a.desc,
            attchmntText: a.attchmntText,
            date: a.sort_date || a.an_dt,
          })),
        },
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
