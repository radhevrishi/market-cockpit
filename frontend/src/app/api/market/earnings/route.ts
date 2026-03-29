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
  fetchStockQuote,
  normalizeSector,
  nseApiFetch,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// =============================================
// EARNINGS CALENDAR v4 — Strict, Accurate
// =============================================
// Sources (priority order):
//   1. NSE Financial Results API — actual filed quarterly results
//   2. NSE Results-Specific Corporate Filings — sub_category=Financial Results
//   3. "Outcome of Board Meeting" announcements — cross-referenced only
//   4. Board meetings (UPCOMING only) — future dates with Financial Results purpose
//   5. BSE proxy via Render — BSE-only companies
//
// Strict Exclusions:
//   ✗ Dividend-only outcomes (no financial results)
//   ✗ Buyback / Buy-back outcomes
//   ✗ Rights issue / Preferential allotment / Fund raising
//   ✗ AGM / EGM notices
//   ✗ Scheme of arrangement / Debenture
//   ✗ Investor calls / Earnings calls (not the result itself)
//   ✗ Clarifications / Corrections / Revisions of old results
//   ✗ Late filers (wrong quarter for the filing month)
//
// Dedup: One event per company — primary earnings event only

// ════════════════════════════════════
// BLOCKLIST — terms that indicate non-earnings events
// ════════════════════════════════════
const NON_RESULT_BLOCKLIST = [
  'rights issue',
  'preferential allotment',
  'preferential issue',
  'fund rais',
  'fundrais',
  'scheme of arrangement',
  'scheme of amalgamation',
  'debenture',
  'warrant',
  'investor call',
  'earnings call',
  'analyst call',
  'conference call',
  'clarification',
  'correction',
  'revised',
  'corrigendum',
  'addendum',
  'erratum',
  'name change',
  'change of name',
  'delisting',
  'suspension',
  'trading halt',
  'board reconstitution',
  'change in director',
  'resignation',
  'appointment of',
  'cessation of',
  'disclosure under',
  'reg 29',
  'reg 30',
  'credit rating',
  'rating action',
  'cirp',
  'insolvency',
  'resolution plan',
  'nclt',
  'liquidation',
  'winding up',
  'suspended',
  'trading halt',
  'recommencement',
  'regularization',
  'regularisation',
  'delayed',
];

// These are OK *only if* "financial result" also appears
const CONDITIONAL_BLOCKLIST = [
  'dividend',
  'buyback',
  'buy back',
  'buy-back',
  'agm',
  'egm',
  'annual general meeting',
  'extraordinary general meeting',
  'general meeting',
  'bonus',
  'stock split',
  'sub-division',
  'subdivision',
];

function containsBlockedTerm(text: string): boolean {
  for (const term of NON_RESULT_BLOCKLIST) {
    if (text.includes(term)) return true;
  }
  return false;
}

function containsConditionalBlock(text: string): boolean {
  for (const term of CONDITIONAL_BLOCKLIST) {
    if (text.includes(term)) return true;
  }
  return false;
}

// ════════════════════════════════════
// QUARTER LOGIC
// ════════════════════════════════════

function getFiscalQuarter(date: Date): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 4 && month <= 6) return `Q1 FY${(year + 1).toString().slice(2)}`;
  if (month >= 7 && month <= 9) return `Q2 FY${(year + 1).toString().slice(2)}`;
  if (month >= 10 && month <= 12) return `Q3 FY${(year + 1).toString().slice(2)}`;
  return `Q4 FY${year.toString().slice(2)}`;
}

function getExpectedQuarter(filingDate: Date): string {
  const m = filingDate.getMonth() + 1;
  const y = filingDate.getFullYear();
  if (m >= 1 && m <= 3) return `Q3 FY${y.toString().slice(2)}`;
  if (m >= 4 && m <= 6) return `Q4 FY${y.toString().slice(2)}`;
  if (m >= 7 && m <= 9) return `Q1 FY${(y + 1).toString().slice(2)}`;
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
  return getExpectedQuarter(meetingDate);
}

// ════════════════════════════════════
// DATE PARSING
// ════════════════════════════════════

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
      if (month !== undefined) return new Date(parseInt(ddMonYYYY[3]), month, parseInt(ddMonYYYY[1]));
    }
    const ddmmyyyy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (ddmmyyyy) return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
    const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  if (data?.Table && Array.isArray(data.Table)) return data.Table;
  return [];
}

function getCapCategory(marketCapCr: number): string {
  if (marketCapCr >= 50000) return 'L';
  if (marketCapCr >= 15000) return 'M';
  if (marketCapCr >= 5000) return 'S';
  if (marketCapCr > 0) return 'Micro';
  return '';
}

// ════════════════════════════════════
// STRICT FILTERS
// ════════════════════════════════════

// Is this "Outcome of Board Meeting" announcement specifically about quarterly results?
function isOutcomeForResults(ann: any, expectedQtr?: string): boolean {
  const attText = (ann.attchmntText || '').toLowerCase();
  const desc = (ann.desc || '').toLowerCase();

  // MUST be "Outcome of Board Meeting"
  const isOutcome = desc.includes('outcome of board meeting') ||
    desc.includes('outcome of the board meeting') ||
    desc.includes('outcome of bm');
  if (!isOutcome) return false;

  // MUST contain "financial result" (exact phrase)
  if (!attText.includes('financial result')) return false;

  // MUST mention a reporting period
  const hasPeriod = attText.includes('quarter ended') ||
    attText.includes('period ended') ||
    attText.includes('year ended') ||
    attText.includes('half year ended') ||
    attText.includes('nine months ended') ||
    attText.includes('submitted to the exchange');
  if (!hasPeriod) return false;

  // HARD EXCLUDE: non-result terms (absolute blocklist)
  if (containsBlockedTerm(attText)) return false;
  if (containsBlockedTerm(desc)) return false;

  // QUARTER VALIDATION: If we can extract the period, verify it matches expected quarter
  if (expectedQtr) {
    const annDate = parseDate(ann.sort_date || ann.an_dt || '');
    if (annDate) {
      const extractedQtr = getResultsQuarter(annDate, attText);
      if (extractedQtr !== expectedQtr) return false;
    }
  }

  // CONDITIONAL EXCLUDE: dividend/buyback/AGM etc.
  if (containsConditionalBlock(attText)) {
    const mainlyDividend = (attText.includes('dividend') || attText.includes('buyback') || attText.includes('buy back')) &&
      !attText.match(/approved.*financial result|financial result.*approved|consider.*financial result/);
    if (mainlyDividend) return false;
  }

  return true;
}

// Is this board meeting for financial results? (UPCOMING only)
function isBoardMeetingForResults(meeting: any): boolean {
  const purpose = (meeting.bm_purpose || meeting.purpose || '').toLowerCase();
  const desc = (meeting.bm_desc || meeting.desc || '').toLowerCase();
  const combined = `${purpose} ${desc}`;

  // HARD EXCLUDE: blocklisted terms
  if (containsBlockedTerm(combined)) return false;

  // Purpose must explicitly mention financial results
  if (!purpose.includes('financial result') && !purpose.includes('quarterly result')) {
    // Check description but require strong signal
    if (!desc.includes('financial result') && !desc.includes('quarterly result') &&
        !desc.includes('unaudited financial result') && !desc.includes('audited financial result')) {
      return false;
    }
  }

  // CONDITIONAL: if purpose ALSO mentions dividend/AGM/buyback without "result"
  // being the clear primary purpose, exclude
  if (purpose.includes('agm') || purpose.includes('egm') ||
      purpose.includes('annual general') || purpose.includes('extraordinary general')) {
    // AGM/EGM meetings — exclude even if they mention results
    // These are general meetings, not earnings events
    return false;
  }

  // Dividend-only: if purpose is just "Dividend" or "Interim Dividend" without "Financial Result"
  if (purpose.includes('dividend') && !purpose.includes('financial result') && !purpose.includes('result')) {
    return false;
  }

  // Fund raising / rights / buyback primary purpose
  if (purpose.includes('fund rais') || purpose.includes('rights issue') ||
      purpose.includes('buyback') || purpose.includes('buy back') ||
      purpose.includes('preferential')) {
    if (!purpose.includes('financial result')) return false;
  }

  return true;
}

// Is this a results-specific corporate filing?
function isResultsFiling(ann: any): boolean {
  const desc = (ann.desc || ann.subject || '').toLowerCase();
  const attText = (ann.attchmntText || '').toLowerCase();
  const combined = `${desc} ${attText}`;

  // Must mention financial results
  if (!combined.includes('financial result') && !combined.includes('quarterly result')) return false;

  // Blocklist check
  if (containsBlockedTerm(combined)) return false;

  // Must have period reference
  const hasPeriod = combined.includes('quarter ended') ||
    combined.includes('period ended') ||
    combined.includes('year ended') ||
    combined.includes('submitted to the exchange');

  return hasPeriod;
}

// ════════════════════════════════════
// TIMING — determine if result was declared before or after market hours
// ════════════════════════════════════

function getResultTiming(ann: any): string {
  // NSE announcements have a time field (exchdisstime or an_dt)
  const timeStr = ann.exchdisstime || ann.an_dt || ann.sort_date || '';
  // If time available, check if before 9:15 AM or after 3:30 PM IST → pre-market (🌙)
  // Otherwise post-market (☀️)
  if (timeStr) {
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      if (hour >= 15 || hour < 9) return 'pre'; // After market or before market → next day pre-market
      return 'post'; // During market hours
    }
  }
  // Default: if the meeting date is a weekday and results filed same day → post market (🌙)
  return 'pre'; // Default to pre-market (most results are announced after hours)
}

// ════════════════════════════════════
// TYPES
// ════════════════════════════════════

interface EarningsEvent {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Good' | 'Weak' | 'Upcoming' | 'Preview';
  sector: string;
  industry: string;
  marketCap: string;
  edp: number | null;
  cmp: number | null;
  priceMove: number | null;
  timing: string; // 'pre' (🌙) or 'post' (☀️)
  source: string;
}

// ════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'india';
  const month = searchParams.get('month');
  const indexFilter = searchParams.get('index');
  const debug = searchParams.get('debug') === 'true';

  try {
    if (market !== 'india') {
      return NextResponse.json({ results: [], summary: { total: 0, good: 0, weak: 0, upcoming: 0 }, source: 'Not Available' });
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

    const fmt = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    const bmFetchFrom = new Date(fromDate);
    bmFetchFrom.setDate(bmFetchFrom.getDate() - 60);

    // ═══════════════════════════════════════════
    // STEP 1: Fetch all data sources in parallel
    // ═══════════════════════════════════════════
    const [
      financialResults,
      latestResults,
      boardMeetings,
      boardMeetingsRange,
      announcementsPaginated,
      // NEW: Results-specific corporate filings
      resultsFilings,
      nifty50Data,
      niftyNext50Data,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchFinancialResults(fmt(fromDate), fmt(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetings().catch(() => null),
      fetchBoardMeetingsForDateRange(fmt(bmFetchFrom), fmt(toDate)).catch(() => null),
      fetchCorporateAnnouncementsPaginated(fmt(fromDate), fmt(toDate), 5).catch(() => []),
      // NSE results-specific filings: sub_category filter
      nseApiFetch(`/api/corporate-announcements?index=equities&from_date=${fmt(fromDate)}&to_date=${fmt(toDate)}&sub_category=Financial%20Results`, 600000).catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // ═══════════════════════════════════════════
    // STEP 2: Price/sector lookup
    // ═══════════════════════════════════════════
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

    // ═══════════════════════════════════════════
    // STEP 3: Build confirmed results set from ALL sources
    // ═══════════════════════════════════════════

    // Source A: NSE Financial Results API
    const frArray = toArray(financialResults);
    const latestFrArray = toArray(latestResults);
    const frResultsByTicker = new Map<string, any>();
    for (const fr of [...frArray, ...latestFrArray]) {
      const ticker = fr.symbol || fr.re_symbol || '';
      if (!ticker || frResultsByTicker.has(ticker)) continue;
      const filingDate = parseDate(fr.re_broadcastDt || fr.broadcastDate || fr.re_date || fr.date || fr.re_submissionDate || '');
      if (!filingDate || filingDate < fromDate || filingDate > toDate) continue;
      frResultsByTicker.set(ticker, { ...fr, _filingDate: filingDate });
    }

    // Source B: Results-specific corporate filings (sub_category=Financial Results)
    const resultsFilingsArr = toArray(resultsFilings);
    const resultsFilingsByTicker = new Map<string, any>();
    let resultsFilingsMatchCount = 0;
    for (const rf of resultsFilingsArr) {
      const ticker = rf.symbol || rf.sm_symbol || '';
      if (!ticker || resultsFilingsByTicker.has(ticker)) continue;

      // Apply our strict filter even on "Financial Results" filings
      if (!isResultsFiling(rf)) continue;

      const rfDate = parseDate(rf.sort_date || rf.an_dt || '');
      if (!rfDate || rfDate < fromDate || rfDate > toDate) continue;

      resultsFilingsMatchCount++;
      resultsFilingsByTicker.set(ticker, { ...rf, _filingDate: rfDate });
    }

    // Source C: "Outcome of Board Meeting" announcements (strict filter)
    const annArray = Array.isArray(announcementsPaginated) ? announcementsPaginated : toArray(announcementsPaginated);
    const confirmedOutcomes = new Map<string, any>();
    let outcomeMatchCount = 0;
    let outcomeFilteredCount = 0;

    for (const ann of annArray) {
      const ticker = ann.symbol || ann.sm_symbol || '';
      if (!ticker) continue;

      if (!isOutcomeForResults(ann, expectedQuarter)) {
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

    // ═══════════════════════════════════════════
    // STEP 4: Board meetings (upcoming + confirmed cross-ref)
    // ═══════════════════════════════════════════
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

    // ═══════════════════════════════════════════
    // STEP 5: Build events — ONE per company, primary event only
    // ═══════════════════════════════════════════
    const eventsMap = new Map<string, EarningsEvent>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Helper to check if a ticker has confirmation from ANY source
    const isConfirmed = (ticker: string) =>
      confirmedOutcomes.has(ticker) || frResultsByTicker.has(ticker) || resultsFilingsByTicker.has(ticker);

    // A) Board meetings with "Financial Results" purpose
    for (const meeting of bmCombined) {
      const ticker = meeting.bm_symbol || meeting.symbol || '';
      if (!ticker || eventsMap.has(ticker)) continue;
      if (!isBoardMeetingForResults(meeting)) continue;

      const meetingDateStr = meeting.bm_date || meeting.bm_meetingDate || meeting.date || '';
      const meetingDate = parseDate(meetingDateStr);
      if (!meetingDate || meetingDate < fromDate || meetingDate > toDate) continue;

      const desc = meeting.bm_desc || meeting.desc || '';
      const quarter = getResultsQuarter(meetingDate, desc);

      // Quarter filter: only expected quarter for past events
      if (quarter !== expectedQuarter && meetingDate < today) continue;

      const isPast = meetingDate < today;

      // Past meetings MUST have confirmation from outcomes/filings
      if (isPast && !isConfirmed(ticker)) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      // Determine timing from the confirmed outcome announcement
      const outcomeAnn = confirmedOutcomes.get(ticker);
      const timing = outcomeAnn ? getResultTiming(outcomeAnn) : 'pre';

      eventsMap.set(ticker, {
        ticker,
        company: meeting.bm_companyName || meeting.sm_name || ticker,
        resultDate: meetingDate.toISOString().split('T')[0],
        quarter,
        quality: isPast ? (stockInfo && stockInfo.changePercent < -5 ? 'Weak' : 'Good') : 'Upcoming',
        sector: normalizeSector(stockInfo?.industry) || '',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null,
        cmp: stockInfo?.price || null,
        priceMove: null,
        timing,
        source: 'NSE',
      });
    }

    // B) Results-specific filings — ONLY used as confirmation for board meetings
    //    These do NOT create standalone events (too many false positives).
    //    They're already used via isConfirmed() in Step A above.

    // C) Confirmed outcomes — these ARE strong enough to create standalone events
    //    because isOutcomeForResults() is very strict (requires "Outcome of Board Meeting"
    //    + "financial result" + period reference + quarter validation + blocklist checks)
    for (const [ticker, ann] of confirmedOutcomes) {
      if (eventsMap.has(ticker)) continue;

      const annDate = ann._annDate as Date;
      const attText = ann.attchmntText || '';
      const quarter = getResultsQuarter(annDate, attText);
      if (quarter !== expectedQuarter) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

      eventsMap.set(ticker, {
        ticker,
        company: ann.sm_name || ticker,
        resultDate: annDate.toISOString().split('T')[0],
        quarter,
        quality: stockInfo && stockInfo.changePercent < -5 ? 'Weak' : 'Good',
        sector: normalizeSector(stockInfo?.industry) || '',
        industry: stockInfo?.industry || '',
        marketCap: getCapCategory(marketCapCr),
        edp: null,
        cmp: stockInfo?.price || null,
        priceMove: null,
        timing: getResultTiming(ann),
        source: 'NSE',
      });
    }

    // D) Financial Results API entries not yet in eventsMap
    for (const [ticker, fr] of frResultsByTicker) {
      if (eventsMap.has(ticker)) continue;

      const filingDate = fr._filingDate as Date;
      const periodEnded = fr.re_toDate || fr.toDate || fr.re_periodEnded || '';
      const quarter = getResultsQuarter(filingDate, `period ended ${periodEnded}`);
      if (quarter !== expectedQuarter) continue;

      const stockInfo = priceLookup[ticker];
      const marketCapCr = (stockInfo?.marketCap || 0) / 10000000;

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
        timing: 'pre',
        source: 'NSE',
      });
    }

    // ═══════════════════════════════════════════
    // STEP 6: BSE proxy (Render)
    // ═══════════════════════════════════════════
    let bseResultsCount = 0;
    try {
      const monthStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
      const bseRes = await fetch(
        `https://mc-pulse-bots.onrender.com/api/bse/earnings?month=${monthStr}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (bseRes.ok) {
        const bseData = await bseRes.json();

        for (const r of (bseData.results || [])) {
          const nseSymbol = r.nseSymbol || '';
          const company = r.company || '';
          const headline = (r.headline || '').toLowerCase();

          if (nseSymbol && eventsMap.has(nseSymbol)) continue;
          if (!headline.includes('financial result') && !headline.includes('quarterly result')) continue;
          // Apply blocklist to BSE results too
          if (containsBlockedTerm(headline)) continue;

          const resultDate = parseDate(r.date);
          if (!resultDate || resultDate < fromDate || resultDate > toDate) continue;

          const ticker = nseSymbol || r.scripCode || company.split(' ')[0].toUpperCase();
          if (eventsMap.has(ticker)) continue;

          eventsMap.set(ticker, {
            ticker, company,
            resultDate: resultDate.toISOString().split('T')[0],
            quarter: expectedQuarter, quality: 'Good',
            sector: '', industry: '', marketCap: '',
            edp: null, cmp: null, priceMove: null, timing: 'pre', source: 'BSE',
          });
          bseResultsCount++;
        }

        for (const bm of (bseData.upcoming || [])) {
          const nseSymbol = bm.nseSymbol || '';
          const company = bm.company || '';
          const ticker = nseSymbol || bm.scripCode || company.split(' ')[0].toUpperCase();
          if (eventsMap.has(ticker)) continue;

          const meetingDate = parseDate(bm.date);
          if (!meetingDate || meetingDate < today || meetingDate > toDate) continue;

          eventsMap.set(ticker, {
            ticker, company,
            resultDate: meetingDate.toISOString().split('T')[0],
            quarter: expectedQuarter, quality: 'Upcoming',
            sector: '', industry: '', marketCap: '',
            edp: null, cmp: null, priceMove: null, timing: '', source: 'BSE',
          });
          bseResultsCount++;
        }
      }
    } catch (bseErr) {
      console.log('BSE proxy unavailable:', String(bseErr));
    }

    // ═══════════════════════════════════════════
    // STEP 6.5: Enrich missing price/sector/cap via individual stock quotes
    // ═══════════════════════════════════════════
    const tickersNeedingQuotes = Array.from(eventsMap.entries())
      .filter(([, e]) => e.cmp === null && e.source === 'NSE')
      .map(([ticker]) => ticker);

    let quotesEnrichedCount = 0;
    if (tickersNeedingQuotes.length > 0) {
      // Fetch up to 15 quotes in parallel (rate limit friendly)
      const batchSize = 5;
      for (let i = 0; i < Math.min(tickersNeedingQuotes.length, 30); i += batchSize) {
        const batch = tickersNeedingQuotes.slice(i, i + batchSize);
        const quoteResults = await Promise.all(
          batch.map(ticker => fetchStockQuote(ticker).catch(() => null))
        );
        for (let j = 0; j < batch.length; j++) {
          const ticker = batch[j];
          const quote = quoteResults[j];
          if (!quote) continue;

          const priceInfo = quote.priceInfo || {};
          const info = quote.info || {};
          const metadata = quote.metadata || {};
          const securityInfo = quote.securityInfo || {};

          const lastPrice = priceInfo.lastPrice || priceInfo.close || 0;
          const previousClose = priceInfo.previousClose || 0;
          const change = priceInfo.change || 0;
          const pChange = priceInfo.pChange || 0;
          const industry = info.industry || metadata.industry || '';
          const isin = info.isin || '';
          const ffmc = securityInfo.issuedSize
            ? (securityInfo.issuedSize * lastPrice) / 10000000 // Approx market cap in Cr
            : 0;

          const event = eventsMap.get(ticker);
          if (event) {
            event.cmp = lastPrice || null;
            event.sector = normalizeSector(industry) || event.sector;
            event.industry = industry || event.industry;
            event.marketCap = getCapCategory(ffmc) || event.marketCap;
            // Better quality heuristic with actual price data
            if (event.quality !== 'Upcoming' && pChange < -5) {
              event.quality = 'Weak';
            }
            quotesEnrichedCount++;
          }

          // Also update priceLookup for any later use
          if (lastPrice > 0) {
            priceLookup[ticker] = {
              price: lastPrice,
              change,
              changePercent: pChange,
              volume: 0,
              marketCap: ffmc * 10000000,
              industry,
              previousClose,
            };
          }
        }
        // Small delay between batches for rate limiting
        if (i + batchSize < tickersNeedingQuotes.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    // ═══════════════════════════════════════════
    // STEP 7: Quality enrichment via Render proxy
    // ═══════════════════════════════════════════
    const confirmedTickers = Array.from(eventsMap.entries())
      .filter(([, e]) => e.quality !== 'Upcoming')
      .map(([ticker]) => ticker);

    let qualityEnrichedCount = 0;
    if (confirmedTickers.length > 0 && confirmedTickers.length <= 30) {
      try {
        const symbolsStr = confirmedTickers.join(',');
        const frRes = await fetch(
          `https://mc-pulse-bots.onrender.com/api/nse/financial-results?symbols=${encodeURIComponent(symbolsStr)}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (frRes.ok) {
          const frData = await frRes.json();
          const resultsBySymbol: Record<string, any[]> = frData.results || {};

          for (const [ticker, frArr] of Object.entries(resultsBySymbol)) {
            if (!Array.isArray(frArr) || frArr.length === 0) continue;
            const event = eventsMap.get(ticker);
            if (!event || event.quality === 'Upcoming') continue;

            const latest = frArr[0];
            const profit = parseFloat(String(latest.re_netProfit || latest.netProfit || latest.re_proLossAftTax || latest.proLossAftTax || '0').replace(/,/g, ''));
            const revenue = parseFloat(String(latest.re_revenue || latest.revenue || latest.income || latest.totalIncome || '0').replace(/,/g, ''));

            const prev = frArr.length > 1 ? frArr[1] : null;
            let revenueGrowth = 0, profitGrowth = 0;
            if (prev) {
              const prevRevenue = parseFloat(String(prev.re_revenue || prev.revenue || prev.income || prev.totalIncome || '0').replace(/,/g, ''));
              const prevProfit = parseFloat(String(prev.re_netProfit || prev.netProfit || prev.re_proLossAftTax || prev.proLossAftTax || '0').replace(/,/g, ''));
              if (prevRevenue > 0 && revenue > 0) revenueGrowth = ((revenue - prevRevenue) / prevRevenue) * 100;
              if (prevProfit !== 0 && profit !== 0) profitGrowth = prevProfit > 0 ? ((profit - prevProfit) / prevProfit) * 100 : (profit > 0 ? 100 : -100);
            }

            let quality: 'Good' | 'Weak' = 'Good';
            if (profit < 0) quality = 'Weak';
            else if (prev && revenueGrowth < 0 && profitGrowth < 0) quality = 'Weak';

            event.quality = quality;
            qualityEnrichedCount++;
          }
        }
      } catch (frErr) {
        console.log('Quality proxy unavailable:', String(frErr));
      }
    }

    // ═══════════════════════════════════════════
    // STEP 7.5: Calculate EDP and priceMove for all events
    // ═══════════════════════════════════════════
    // EDP = Earnings Day Price (close price on the day results were declared)
    // For recent results, we use previousClose as approximation
    // priceMove = ((CMP - EDP) / EDP) * 100
    for (const [ticker, event] of eventsMap) {
      if (event.quality === 'Upcoming' || event.quality === 'Preview') continue;
      const stockInfo = priceLookup[ticker];
      if (!stockInfo || !event.cmp) continue;

      // Use previousClose as EDP approximation for most recent result
      // For results declared today/yesterday, previousClose ~ EDP
      const resultDate = new Date(event.resultDate);
      const daysSinceResult = Math.floor((today.getTime() - resultDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSinceResult <= 1) {
        // Result was today/yesterday — previousClose is close to EDP
        event.edp = stockInfo.previousClose || null;
      } else {
        // Older results — estimate EDP from CMP and daily change history
        // Best approximation: CMP / (1 + cumulative change since result)
        // Since we don't have historical data, use CMP as-is and set edp = null
        // except if we have the quote's previousClose
        event.edp = stockInfo.previousClose || null;
      }

      if (event.edp && event.cmp && event.edp > 0) {
        event.priceMove = parseFloat((((event.cmp - event.edp) / event.edp) * 100).toFixed(1));

        // Use priceMove for better quality assessment
        if (event.priceMove < -10) {
          event.quality = 'Weak';
        }
      }
    }

    // ═══════════════════════════════════════════
    // STEP 8: Filter and sort
    // ═══════════════════════════════════════════
    let results = Array.from(eventsMap.values());

    if (indexFilter) {
      const fk = indexFilter.toUpperCase().replace(/\s+/g, '');
      results = results.filter(r => {
        if (fk === 'NIFTY50') return indexMembers['NIFTY50'].has(r.ticker);
        if (fk === 'NIFTY500') return indexMembers['NIFTY500'].has(r.ticker);
        if (fk === 'SMALLCAP250') return indexMembers['SMALLCAP250'].has(r.ticker);
        if (fk === 'MIDCAP') return r.marketCap === 'M';
        if (fk === 'SMALLCAP') return r.marketCap === 'S' || r.marketCap === 'Micro';
        return true;
      });
    }

    results.sort((a, b) => new Date(b.resultDate).getTime() - new Date(a.resultDate).getTime());

    const goodCount = results.filter(r => r.quality === 'Good').length;
    const weakCount = results.filter(r => r.quality === 'Weak').length;
    const upcomingCount = results.filter(r => r.quality === 'Upcoming').length;

    const processing = {
      bmTotal: bmCombined.length,
      announcementsTotal: annArray.length,
      resultsFilingsRaw: resultsFilingsArr.length,
      resultsFilingsMatched: resultsFilingsMatchCount,
      outcomeMatches: outcomeMatchCount,
      outcomeFiltered: outcomeFilteredCount,
      confirmedOutcomes: confirmedOutcomes.size,
      financialResults: frResultsByTicker.size,
      bseResults: bseResultsCount,
      quotesEnriched: quotesEnrichedCount,
      qualityEnriched: qualityEnrichedCount,
      expectedQuarter,
      finalEvents: eventsMap.size,
    };

    console.log('Earnings processing:', processing);

    if (debug) {
      return NextResponse.json({ debug: true, dateRange: { from: fmt(fromDate), to: fmt(toDate) }, ...processing, results });
    }

    return NextResponse.json({
      results,
      summary: { total: results.length, good: goodCount, weak: weakCount, upcoming: upcomingCount },
      quarter: expectedQuarter,
      dateRange: { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] },
      stockUniverse: Object.keys(priceLookup).length,
      source: bseResultsCount > 0 ? 'NSE + BSE India (Live)' : 'NSE India (Live)',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Earnings API error:', error);
    return NextResponse.json({
      results: [], summary: { total: 0, good: 0, weak: 0, upcoming: 0 },
      source: 'Error', error: String(error),
    }, { status: 500 });
  }
}
