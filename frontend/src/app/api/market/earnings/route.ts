import { NextResponse } from 'next/server';
import {
  fetchBoardMeetings,
  fetchNifty500,
  fetchNiftySmallcap250,
  fetchNifty50,
  fetchNiftyNext50,
  fetchCorporateAnnouncementsPaginated,
  fetchBoardMeetingsForDateRange,
  fetchFinancialResults,
  fetchLatestFinancialResults,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// =============================================
// EARNINGS CALENDAR - Matching EarningsPulse.ai
// =============================================
// Strategy (hybrid):
//   1. Try NSE Financial Results API first (actual filed results)
//   2. Fallback: Board meetings + announcement outcomes
//   3. STRICT quarter filter: only show results for the EXPECTED quarter
//      (Jan-Mar filings → Q3 FY26, Apr-Jun → Q4, etc.)
//   4. STRICT outcome matching: "Financial Results" must appear in attachment text
//   5. UPCOMING: Future board meetings with "Financial Results" purpose
//
// Quality: Good / Weak / Upcoming (3-tier, matching earningspulse.ai)

// ── Quarter Logic ──

function getFiscalQuarter(date: Date): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 4 && month <= 6) return `Q1 FY${(year + 1).toString().slice(2)}`;
  if (month >= 7 && month <= 9) return `Q2 FY${(year + 1).toString().slice(2)}`;
  if (month >= 10 && month <= 12) return `Q3 FY${(year + 1).toString().slice(2)}`;
  return `Q4 FY${year.toString().slice(2)}`;
}

// Get the EXPECTED results quarter for a given filing month
// This is the quarter that companies SHOULD be reporting if filing in this month
function getExpectedQuarter(filingDate: Date): string {
  const m = filingDate.getMonth() + 1;
  const y = filingDate.getFullYear();
  // Jan-Mar filings → Q3 (Oct-Dec previous year)
  if (m >= 1 && m <= 3) return `Q3 FY${y.toString().slice(2)}`;
  // Apr-Jun filings → Q4 (Jan-Mar same year)
  if (m >= 4 && m <= 6) return `Q4 FY${y.toString().slice(2)}`;
  // Jul-Sep filings → Q1 (Apr-Jun same year)
  if (m >= 7 && m <= 9) return `Q1 FY${(y + 1).toString().slice(2)}`;
  // Oct-Dec filings → Q2 (Jul-Sep same year)
  return `Q2 FY${(y + 1).toString().slice(2)}`;
}

function getResultsQuarter(meetingDate: Date, desc: string): string {
  const lower = desc.toLowerCase();

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

  // Fallback to expected quarter
  return getExpectedQuarter(meetingDate);
}

// ── Date Parsing ──

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
        return new Date(parseInt(ddMonYYYY[3]), month, parseInt(ddMonYYYY[1]));
      }
    }
    const ddmmyyyy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (ddmmyyyy) {
      return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
    }
    const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) {
      return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
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

// ── Filtering ──

// STRICT: Check if an "Outcome of Board Meeting" announcement is for quarterly results
function isOutcomeForResults(ann: any): boolean {
  const attText = (ann.attchmntText || '').toLowerCase();
  const desc = (ann.desc || '').toLowerCase();

  // Must be "Outcome of Board Meeting"
  const isOutcome = desc.includes('outcome of board meeting') ||
    desc.includes('outcome of the board meeting') ||
    desc.includes('outcome of bm');

  if (!isOutcome) return false;

  // STRICT: attchmntText MUST contain "financial result" (the exact phrase)
  // This excludes board meeting outcomes about dividends, buybacks, fund raising etc.
  if (!attText.includes('financial result')) return false;

  // Extra validation: should mention a period/quarter ended
  // This confirms it's about actual quarterly/annual results, not just mentioning "financial results" in passing
  const hasPeriod = attText.includes('quarter ended') ||
    attText.includes('period ended') ||
    attText.includes('year ended') ||
    attText.includes('half year ended') ||
    attText.includes('nine months ended') ||
    attText.includes('submitted to the exchange');

  if (!hasPeriod) return false;

  // EXCLUDE: outcomes that are primarily about non-result items
  // If the primary topic is dividend/buyback/fund raising and results are just mentioned in passing
  const isMainlyNonResult =
    (attText.includes('buy back') || attText.includes('buyback')) && !attText.includes('approved the financial result');

  if (isMainlyNonResult) return false;

  return true;
}

// Check if board meeting is for financial results (UPCOMING events only)
function isBoardMeetingForResults(meeting: any): boolean {
  const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
  const desc = (meeting.bm_desc || meeting.desc || '').toLowerCase();

  // Purpose must explicitly mention financial results
  if (purpose.includes('financial result')) return true;

  // Description must have clear financial results language
  if (desc.includes('quarterly result') || desc.includes('unaudited financial result') ||
      desc.includes('audited financial result')) return true;

  // "inter alia" patterns - only if combined with "financial results"
  if ((desc.includes('inter alia') || desc.includes('inter-alia')) &&
      desc.includes('financial result')) return true;

  // Reject: purpose says only "Dividend" without "result"
  return false;
}

// Market cap category
function getCapCategory(marketCapCr: number): string {
  if (marketCapCr >= 50000) return 'L';
  if (marketCapCr >= 15000) return 'M';
  if (marketCapCr >= 5000) return 'S';
  if (marketCapCr > 0) return 'Micro';
  return '';
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
  const month = searchParams.get('month');
  const indexFilter = searchParams.get('index');
  const debug = searchParams.get('debug') === 'true';

  try {
    if (market !== 'india') {
      return NextResponse.json({
        results: [],
        summary: { total: 0, good: 0, weak: 0, upcoming: 0 },
        source: 'Not Available',
      });
    }

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

    const expectedQuarter = getExpectedQuarter(fromDate);

    const formatNSEDate = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    // Board meetings: fetch from 60 days before
    const bmFetchFrom = new Date(fromDate);
    bmFetchFrom.setDate(bmFetchFrom.getDate() - 60);

    // ============================================
    // STEP 1: Fetch all data in parallel
    // ============================================
    const [
      financialResults,
      latestResults,
      boardMeetings,
      boardMeetingsRange,
      announcementsPaginated,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchFinancialResults(formatNSEDate(fromDate), formatNSEDate(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetings().catch(() => null),
      fetchBoardMeetingsForDateRange(formatNSEDate(bmFetchFrom), formatNSEDate(toDate)).catch(() => null),
      // Fetch MORE pages of announcements for better coverage
      fetchCorporateAnnouncementsPaginated(formatNSEDate(fromDate), formatNSEDate(toDate), 5).catch(() => []),
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
    // STEP 3: Try Financial Results API (primary)
    // ============================================
    const frArray = toArray(financialResults);
    const latestFrArray = toArray(latestResults);
    const frResultsByTicker = new Map<string, any>();

    for (const fr of [...frArray, ...latestFrArray]) {
      const ticker = fr.symbol || fr.re_symbol || '';
      if (!ticker || frResultsByTicker.has(ticker)) continue;

      const filingDate = parseDate(
        fr.re_broadcastDt || fr.broadcastDate || fr.re_date || fr.date || fr.re_submissionDate || ''
      );
      if (!filingDate || filingDate < fromDate || filingDate > toDate) continue;

      frResultsByTicker.set(ticker, { ...fr, _filingDate: filingDate });
    }

    // ============================================
    // STEP 4: Build confirmed outcomes from announcements
    // ============================================
    const annArray = Array.isArray(announcementsPaginated) ? announcementsPaginated : toArray(announcementsPaginated);
    const confirmedOutcomes = new Map<string, any>();
    let outcomeMatchCount = 0;
    let outcomeFilteredCount = 0;

    for (const ann of annArray) {
      const ticker = ann.symbol || ann.sm_symbol || '';
      if (!ticker) continue;

      if (!isOutcomeForResults(ann)) {
        // Track how many we're filtering out
        const desc = (ann.desc || '').toLowerCase();
        if (desc.includes('outcome')) outcomeFilteredCount++;
        continue;
      }

      outcomeMatchCount++;

      const annDateStr = ann.sort_date || ann.an_dt || '';
      const annDate = parseDate(annDateStr);
      if (!annDate || annDate < fromDate || annDate > toDate) continue;

      if (!confirmedOutcomes.has(ticker)) {
        confirmedOutcomes.set(ticker, { ...ann, _annDate: annDate });
      }
    }

    // ============================================
    // STEP 5: Build board meetings list
    // ============================================
    const bmArray1 = toArray(boardMeetings);
    const bmArray2 = toArray(boardMeetingsRange);
    const bmSeen = new Set<string>();
    const bmCombined: any[] = [];

    for (const bm of [...bmArray1, ...bmArray2]) {
      const ticker = bm.bm_symbol || bm.symbol || '';
      const key = `${ticker}:${bm.bm_date || bm.date}`;
      if (!ticker || bmSeen.has(key)) continue;
      bmSeen.add(key);
      bmCombined.push(bm);
    }

    // ============================================
    // STEP 6: Build events — board-meeting-first, confirmed by outcomes
    // ============================================
    const eventsMap = new Map<string, EarningsEvent>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // A) Start from board meetings with "Financial Results" purpose
    for (const meeting of bmCombined) {
      const ticker = meeting.bm_symbol || meeting.symbol || '';
      if (!ticker || eventsMap.has(ticker)) continue;
      if (!isBoardMeetingForResults(meeting)) continue;

      const meetingDateStr = meeting.bm_date || meeting.bm_meetingDate || meeting.date || '';
      const meetingDate = parseDate(meetingDateStr);
      if (!meetingDate || meetingDate < fromDate || meetingDate > toDate) continue;

      const desc = meeting.bm_desc || meeting.desc || '';
      const quarter = getResultsQuarter(meetingDate, desc);

      // *** KEY FILTER: Only include results for the EXPECTED quarter ***
      // This eliminates late filers (Q2 results filed in March etc.)
      if (quarter !== expectedQuarter && meetingDate < today) continue;

      const isPast = meetingDate < today;
      const hasOutcome = confirmedOutcomes.has(ticker);
      const hasFR = frResultsByTicker.has(ticker);

      // For PAST meetings: must have a confirmed outcome OR financial result filing
      if (isPast && !hasOutcome && !hasFR) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      if (isPast) {
        // CONFIRMED result
        const changePct = stockInfo?.changePercent || 0;
        eventsMap.set(ticker, {
          ticker,
          company: meeting.bm_companyName || meeting.sm_name || ticker,
          resultDate: meetingDate.toISOString().split('T')[0],
          quarter,
          quality: changePct >= -5 ? 'Good' : 'Weak',
          sector: normalizeSector(stockInfo?.industry) || '',
          industry: stockInfo?.industry || '',
          marketCap: getCapCategory(marketCapCr),
          edp: null,
          cmp: stockInfo?.price || null,
          priceMove: null,
          source: 'NSE',
        });
      } else {
        // UPCOMING
        eventsMap.set(ticker, {
          ticker,
          company: meeting.bm_companyName || meeting.sm_name || ticker,
          resultDate: meetingDate.toISOString().split('T')[0],
          quarter,
          quality: 'Upcoming',
          sector: normalizeSector(stockInfo?.industry) || '',
          industry: stockInfo?.industry || '',
          marketCap: getCapCategory(marketCapCr),
          edp: null,
          cmp: stockInfo?.price || null,
          priceMove: null,
          source: 'NSE',
        });
      }
    }

    // B) Also add companies from confirmed outcomes that may not have board meeting records
    for (const [ticker, ann] of confirmedOutcomes) {
      if (eventsMap.has(ticker)) continue;

      const annDate = ann._annDate as Date;
      const attText = ann.attchmntText || '';
      const quarter = getResultsQuarter(annDate, attText);

      // Quarter filter for non-board-meeting entries too
      if (quarter !== expectedQuarter) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;
      const changePct = stockInfo?.changePercent || 0;

      eventsMap.set(ticker, {
        ticker,
        company: ann.sm_name || ticker,
        resultDate: annDate.toISOString().split('T')[0],
        quarter,
        quality: changePct >= -5 ? 'Good' : 'Weak',
        sector: normalizeSector(stockInfo?.industry) || '',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null,
        cmp: stockInfo?.price || null,
        priceMove: null,
        source: 'NSE',
      });
    }

    // C) Add from Financial Results API if available
    for (const [ticker, fr] of frResultsByTicker) {
      if (eventsMap.has(ticker)) continue;

      const filingDate = fr._filingDate as Date;
      const periodEnded = fr.re_toDate || fr.toDate || fr.re_periodEnded || '';
      const quarter = getResultsQuarter(filingDate, `period ended ${periodEnded}`);

      if (quarter !== expectedQuarter) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      // Use actual profit data for quality if available
      const profitStr = fr.re_netProfit || fr.netProfit || fr.re_proLossAftTax || '';
      const profit = parseFloat(String(profitStr).replace(/,/g, ''));
      let quality: 'Good' | 'Weak' = 'Good';
      if (!isNaN(profit) && profit < 0) quality = 'Weak';
      else if (stockInfo && stockInfo.changePercent < -5) quality = 'Weak';

      eventsMap.set(ticker, {
        ticker,
        company: fr.re_companyName || fr.companyName || ticker,
        resultDate: filingDate.toISOString().split('T')[0],
        quarter,
        quality,
        sector: normalizeSector(stockInfo?.industry) || '',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null,
        cmp: stockInfo?.price || null,
        priceMove: null,
        source: 'NSE',
      });
    }

    // ============================================
    // STEP 6.5: Fetch BSE-only results via proxy
    // ============================================
    // BSE API is blocked from Vercel — use mc-pulse-bots Render service as proxy
    let bseResultsCount = 0;
    try {
      const monthStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
      const bseRes = await fetch(
        `https://mc-pulse-bots.onrender.com/api/bse/earnings?month=${monthStr}`,
        { signal: AbortSignal.timeout(8000) } // 8s timeout — don't block if Render is sleeping
      );

      if (bseRes.ok) {
        const bseData = await bseRes.json();

        // Add BSE-only results (companies not already in our NSE results)
        for (const r of (bseData.results || [])) {
          const nseSymbol = r.nseSymbol || '';
          const company = r.company || '';
          const headline = (r.headline || '').toLowerCase();

          // Skip if already have this company from NSE
          if (nseSymbol && eventsMap.has(nseSymbol)) continue;

          // Must be about financial results
          if (!headline.includes('financial result') && !headline.includes('quarterly result')) continue;

          // Parse the result date
          const resultDate = parseDate(r.date);
          if (!resultDate || resultDate < fromDate || resultDate > toDate) continue;

          // Use scrip code or company name as ticker for BSE-only companies
          const ticker = nseSymbol || r.scripCode || company.split(' ')[0].toUpperCase();
          if (eventsMap.has(ticker)) continue;

          eventsMap.set(ticker, {
            ticker,
            company,
            resultDate: resultDate.toISOString().split('T')[0],
            quarter: expectedQuarter,
            quality: 'Good', // Default — will refine later
            sector: '',
            industry: '',
            marketCap: '',
            edp: null,
            cmp: null,
            priceMove: null,
            source: 'BSE',
          });
          bseResultsCount++;
        }

        // Add BSE upcoming board meetings
        for (const bm of (bseData.upcoming || [])) {
          const nseSymbol = bm.nseSymbol || '';
          const company = bm.company || '';
          const ticker = nseSymbol || bm.scripCode || company.split(' ')[0].toUpperCase();
          if (eventsMap.has(ticker)) continue;
          if (nseSymbol && eventsMap.has(nseSymbol)) continue;

          const meetingDate = parseDate(bm.date);
          if (!meetingDate || meetingDate < today || meetingDate > toDate) continue;

          eventsMap.set(ticker, {
            ticker,
            company,
            resultDate: meetingDate.toISOString().split('T')[0],
            quarter: expectedQuarter,
            quality: 'Upcoming',
            sector: '',
            industry: '',
            marketCap: '',
            edp: null,
            cmp: null,
            priceMove: null,
            source: 'BSE',
          });
          bseResultsCount++;
        }
      }
    } catch (bseErr) {
      // BSE proxy failed (Render sleeping, timeout, etc.) — continue with NSE data only
      console.log('BSE proxy unavailable:', String(bseErr));
    }

    // ============================================
    // STEP 7: Enrich quality via Render proxy (NSE financial results)
    // ============================================
    // NSE financial results API doesn't work from Vercel — route through Render
    const confirmedTickers = Array.from(eventsMap.entries())
      .filter(([, e]) => e.quality !== 'Upcoming')
      .map(([ticker]) => ticker);

    let qualityEnrichedCount = 0;
    if (confirmedTickers.length > 0 && confirmedTickers.length <= 30) {
      try {
        const symbolsStr = confirmedTickers.join(',');
        const frRes = await fetch(
          `https://mc-pulse-bots.onrender.com/api/nse/financial-results?symbols=${encodeURIComponent(symbolsStr)}`,
          { signal: AbortSignal.timeout(15000) } // 15s timeout for per-company fetching
        );

        if (frRes.ok) {
          const frData = await frRes.json();
          const resultsBySymbol: Record<string, any[]> = frData.results || {};

          for (const [ticker, frArr] of Object.entries(resultsBySymbol)) {
            if (!Array.isArray(frArr) || frArr.length === 0) continue;
            const event = eventsMap.get(ticker);
            if (!event || event.quality === 'Upcoming') continue;

            const latest = frArr[0];

            // Extract financial metrics
            const profit = parseFloat(
              String(latest.re_netProfit || latest.netProfit || latest.re_proLossAftTax || latest.proLossAftTax || '0').replace(/,/g, '')
            );
            const revenue = parseFloat(
              String(latest.re_revenue || latest.revenue || latest.income || latest.totalIncome || '0').replace(/,/g, '')
            );

            // Previous quarter for growth comparison
            const prev = frArr.length > 1 ? frArr[1] : null;
            let revenueGrowth = 0;
            let profitGrowth = 0;

            if (prev) {
              const prevRevenue = parseFloat(
                String(prev.re_revenue || prev.revenue || prev.income || prev.totalIncome || '0').replace(/,/g, '')
              );
              const prevProfit = parseFloat(
                String(prev.re_netProfit || prev.netProfit || prev.re_proLossAftTax || prev.proLossAftTax || '0').replace(/,/g, '')
              );

              if (prevRevenue > 0 && revenue > 0) revenueGrowth = ((revenue - prevRevenue) / prevRevenue) * 100;
              if (prevProfit !== 0 && profit !== 0) {
                profitGrowth = prevProfit > 0 ? ((profit - prevProfit) / prevProfit) * 100 : (profit > 0 ? 100 : -100);
              }
            }

            // Quality: Good if profitable with growth, Weak if loss or decline
            let quality: 'Good' | 'Weak' = 'Good';
            if (profit < 0) {
              quality = 'Weak';
            } else if (prev && revenueGrowth < 0 && profitGrowth < 0) {
              quality = 'Weak';
            }

            event.quality = quality;
            qualityEnrichedCount++;
          }
        }
      } catch (frErr) {
        console.log('Quality proxy unavailable:', String(frErr));
      }
    }

    console.log('Earnings processing:', {
      bmTotal: bmCombined.length,
      announcementsTotal: annArray.length,
      outcomeMatches: outcomeMatchCount,
      outcomeFiltered: outcomeFilteredCount,
      confirmedOutcomes: confirmedOutcomes.size,
      financialResults: frResultsByTicker.size,
      bseResults: bseResultsCount,
      qualityEnriched: qualityEnrichedCount,
      expectedQuarter,
      finalEvents: eventsMap.size,
    });

    // ============================================
    // STEP 8: Filter and sort
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
        expectedQuarter,
        processing: {
          bmTotal: bmCombined.length,
          announcementsTotal: annArray.length,
          outcomeMatches: outcomeMatchCount,
          outcomeFiltered: outcomeFilteredCount,
          confirmedOutcomes: confirmedOutcomes.size,
          financialResults: frResultsByTicker.size,
          bseResults: bseResultsCount,
          qualityEnriched: qualityEnrichedCount,
          finalEvents: eventsMap.size,
        },
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
      quarter: expectedQuarter,
      dateRange: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      stockUniverse: Object.keys(priceLookup).length,
      source: bseResultsCount > 0 ? 'NSE + BSE India (Live)' : 'NSE India (Live)',
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
