import { NextResponse } from 'next/server';
import {
  nseApiFetch,
  fetchBoardMeetings,
  fetchBoardMeetingsForDateRange,
  fetchFinancialResults,
  fetchLatestFinancialResults,
  fetchCorporateAnnouncementsPaginated,
  fetchNifty50,
  fetchNiftyNext50,
  fetchNifty500,
  fetchNiftySmallcap250,
  fetchStockQuote,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ══════════════════════════════════════════════
// EARNINGS CARDS API v4 — Future-proof 2-Layer Schema
//
// Layer 1: Event Intelligence (WORKING NOW)
//   - result_date, company, quality_score, price reaction, excess return
//
// Layer 2: Fundamentals (FUTURE SLOT)
//   - revenue, EBIT, PAT, EPS, margins, YoY/QoQ
//   - Empty now → MUST exist in schema for forward compatibility
//
// Data quality is explicitly labeled: FULL | PARTIAL | NONE
// Single canonical pipeline — Telegram + UI consume identical output
// ══════════════════════════════════════════════

// ── Type Definitions (2-Layer Schema) ────────

type Grade = 'STRONG' | 'GOOD' | 'OK' | 'BAD';
type DataQuality = 'FULL' | 'PARTIAL' | 'NONE';

interface PriceReaction {
  cmp: number;                    // Current Market Price
  prevClose: number | null;       // Previous close
  edp: number | null;             // Earnings Day Price
  changePct: number;              // Raw price change %
  excessReturn: number | null;    // stock_return - index_return (Bloomberg-level normalization)
  indexReturn: number | null;     // Nifty 50 return on same day for context
}

interface Financials {
  // Current quarter
  revenue: number | null;
  operatingProfit: number | null;
  opm: number | null;
  pat: number | null;
  npm: number | null;
  eps: number | null;
  // YoY growth
  revenueYoY: number | null;
  opProfitYoY: number | null;
  patYoY: number | null;
  epsYoY: number | null;
  marginTrendYoY: number | null;  // OPM change in bps
  // QoQ growth
  revenueQoQ: number | null;
  opProfitQoQ: number | null;
  patQoQ: number | null;
  epsQoQ: number | null;
  // Historical quarters (for card display)
  prevQ: QuarterData | null;
  yoyQ: QuarterData | null;
}

interface QuarterData {
  period: string;        // "Sep 2025", "Dec 2024"
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
}

interface EarningsCard {
  // Identity
  symbol: string;
  company: string;
  period: string;        // "Q3 FY26"
  resultDate: string;
  reportType: string;    // "Standalone" | "Consolidated"

  // Classification
  sector: string;
  industry: string;
  marketCap: string;     // "L" | "M" | "S" | "Micro"

  // Layer 1: Event Intelligence (ALWAYS POPULATED)
  qualityScore: number;  // 0-100
  grade: Grade;
  gradeColor: string;

  price: PriceReaction;

  // Layer 2: Fundamentals (FUTURE-FILLABLE)
  financials: Financials;

  // Meta
  dataQuality: DataQuality;
  source: string;

  // Valuation (from stock quote when available)
  pe: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  mcap: number | null;       // in Cr
  yearHigh: number | null;
  yearLow: number | null;

  // Links
  resultLink: string | null;
  nseLink: string;
}

// ── Helpers ──────────────────────────────────

function parseNum(val: any): number {
  if (val === null || val === undefined || val === '' || val === '-') return 0;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : null;
  return parseFloat((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function getCapCategory(mcapCr: number): string {
  if (mcapCr >= 50000) return 'L';
  if (mcapCr >= 15000) return 'M';
  if (mcapCr >= 5000) return 'S';
  if (mcapCr > 0) return 'Micro';
  return '';
}

function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  for (const key of Object.keys(data || {})) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key];
  }
  return [];
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  try {
    const ddMon = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
    if (ddMon) {
      const m = MONTH_MAP[ddMon[2].toLowerCase()];
      if (m !== undefined) return new Date(parseInt(ddMon[3]), m, parseInt(ddMon[1]));
    }
    const ddmm = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (ddmm) return new Date(parseInt(ddmm[3]), parseInt(ddmm[2]) - 1, parseInt(ddmm[1]));
    const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function getExpectedQuarter(d: Date): string {
  const m = d.getMonth() + 1, y = d.getFullYear();
  if (m >= 1 && m <= 3) return `Q3 FY${y.toString().slice(2)}`;
  if (m >= 4 && m <= 6) return `Q4 FY${y.toString().slice(2)}`;
  if (m >= 7 && m <= 9) return `Q1 FY${(y + 1).toString().slice(2)}`;
  return `Q2 FY${(y + 1).toString().slice(2)}`;
}

function getResultsQuarter(meetingDate: Date, desc: string): string {
  const lower = desc.toLowerCase();
  const match = lower.match(/(?:period|quarter|half year|year)\s+ended\s+(?:on\s+)?(\d{1,2})?[- \/]?([a-z]+|\d{1,2})[- \/,]+(\d{4})/);
  if (match) {
    const mStr = match[2]; const yr = parseInt(match[3]);
    const monthMap: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12,
    };
    const month = monthMap[mStr] || parseInt(mStr);
    if (month > 0 && yr > 2000) {
      const fy = month >= 4 ? yr + 1 : yr;
      if (month >= 4 && month <= 6) return `Q1 FY${fy.toString().slice(2)}`;
      if (month >= 7 && month <= 9) return `Q2 FY${fy.toString().slice(2)}`;
      if (month >= 10 && month <= 12) return `Q3 FY${fy.toString().slice(2)}`;
      return `Q4 FY${yr.toString().slice(2)}`;
    }
  }
  return getExpectedQuarter(meetingDate);
}

// ── Grading Engine ──────────────────────────

// Grade from financials when available (weighted scoring)
// Revenue 30%, PAT 30%, EPS 20%, Margin trend 20%
function gradeFromFinancials(fin: Financials): { grade: Grade; color: string; score: number } {
  let score = 50; // base
  let factors = 0;

  if (fin.revenueYoY !== null) {
    factors++;
    if (fin.revenueYoY > 15) score += 15;
    else if (fin.revenueYoY > 5) score += 8;
    else if (fin.revenueYoY > 0) score += 3;
    else if (fin.revenueYoY > -10) score -= 5;
    else score -= 15;
  }

  if (fin.patYoY !== null) {
    factors++;
    if (fin.patYoY > 20) score += 15;
    else if (fin.patYoY > 5) score += 8;
    else if (fin.patYoY > 0) score += 3;
    else if (fin.patYoY > -15) score -= 5;
    else score -= 15;
  }

  if (fin.epsYoY !== null) {
    factors++;
    if (fin.epsYoY > 20) score += 10;
    else if (fin.epsYoY > 5) score += 5;
    else if (fin.epsYoY > 0) score += 2;
    else score -= 10;
  }

  if (fin.marginTrendYoY !== null) {
    factors++;
    if (fin.marginTrendYoY > 200) score += 10; // 200bps improvement
    else if (fin.marginTrendYoY > 0) score += 5;
    else if (fin.marginTrendYoY > -200) score -= 3;
    else score -= 10;
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  return scoreToGrade(score);
}

// Grade from price move (fallback when no financials)
function gradeFromPriceMove(pct: number): { grade: Grade; color: string; score: number } {
  if (pct > 5) return { grade: 'STRONG', color: '#00C853', score: 85 };
  if (pct > 2) return { grade: 'GOOD', color: '#4CAF50', score: 70 };
  if (pct > -2) return { grade: 'OK', color: '#FFD600', score: 50 };
  if (pct > -5) return { grade: 'OK', color: '#FFD600', score: 40 };
  return { grade: 'BAD', color: '#F44336', score: 20 };
}

// Grade from excess return (normalized — Bloomberg-level)
function gradeFromExcessReturn(excessPct: number): { grade: Grade; color: string; score: number } {
  if (excessPct > 4) return { grade: 'STRONG', color: '#00C853', score: 85 };
  if (excessPct > 1.5) return { grade: 'GOOD', color: '#4CAF50', score: 70 };
  if (excessPct > -1.5) return { grade: 'OK', color: '#FFD600', score: 50 };
  if (excessPct > -4) return { grade: 'OK', color: '#FFD600', score: 35 };
  return { grade: 'BAD', color: '#F44336', score: 20 };
}

function scoreToGrade(score: number): { grade: Grade; color: string; score: number } {
  if (score >= 75) return { grade: 'STRONG', color: '#00C853', score };
  if (score >= 55) return { grade: 'GOOD', color: '#4CAF50', score };
  if (score >= 35) return { grade: 'OK', color: '#FFD600', score };
  return { grade: 'BAD', color: '#F44336', score };
}

// ── Empty Financials (future slot) ──────────

function emptyFinancials(): Financials {
  return {
    revenue: null, operatingProfit: null, opm: null,
    pat: null, npm: null, eps: null,
    revenueYoY: null, opProfitYoY: null, patYoY: null,
    epsYoY: null, marginTrendYoY: null,
    revenueQoQ: null, opProfitQoQ: null, patQoQ: null, epsQoQ: null,
    prevQ: null, yoyQ: null,
  };
}

// ══════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const indexFilter = searchParams.get('index');
  const debug = searchParams.get('debug') === 'true';

  try {
    const now = new Date();
    let fromDate: Date, toDate: Date;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      fromDate = new Date(y, m - 1, 1);
      toDate = new Date(y, m, 0);
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const expectedQtr = getExpectedQuarter(fromDate);
    const fmt = (d: Date) => `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;

    const bmFrom = new Date(fromDate);
    bmFrom.setDate(bmFrom.getDate() - 60);

    console.log(`[Earnings Cards v4] ${fmt(fromDate)} to ${fmt(toDate)}, expected ${expectedQtr}`);

    // ═══════════════════════════════════════════
    // STEP 1: Fetch all NSE data sources + Nifty 50 index return
    // ═══════════════════════════════════════════
    const [
      financialResults,
      latestResults,
      boardMeetings,
      boardMeetingsRange,
      announcements,
      resultsFilings,
      nifty50Data,
      niftyNext50,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      fetchFinancialResults(fmt(fromDate), fmt(toDate)).catch(() => null),
      fetchLatestFinancialResults().catch(() => null),
      fetchBoardMeetings().catch(() => null),
      fetchBoardMeetingsForDateRange(fmt(bmFrom), fmt(toDate)).catch(() => null),
      fetchCorporateAnnouncementsPaginated(fmt(fromDate), fmt(toDate), 3).catch(() => []),
      nseApiFetch(`/api/corporate-announcements?index=equities&from_date=${fmt(fromDate)}&to_date=${fmt(toDate)}&sub_category=Financial%20Results`, 600000).catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNiftyNext50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // ═══════════════════════════════════════════
    // STEP 2: Extract Nifty 50 index return for excess return calc
    // ═══════════════════════════════════════════
    let niftyReturn = 0;
    if (nifty50Data?.metadata) {
      const meta = nifty50Data.metadata;
      const lastVal = parseNum(meta.last || meta.lastPrice);
      const prevVal = parseNum(meta.previousClose);
      if (lastVal > 0 && prevVal > 0) {
        niftyReturn = parseFloat(((lastVal - prevVal) / prevVal * 100).toFixed(2));
      }
    }
    // Fallback: use pChange from index data
    if (niftyReturn === 0 && nifty50Data?.data?.[0]) {
      // Index-level change from advance/decline data
      niftyReturn = parseNum(nifty50Data.advance?.advances) > 0 ? 0.5 : -0.5; // rough approx
    }

    console.log(`[Earnings Cards v4] Nifty 50 day return: ${niftyReturn}%`);

    // ═══════════════════════════════════════════
    // STEP 3: Build price/sector lookup from index data
    // ═══════════════════════════════════════════
    const priceLookup: Record<string, {
      price: number; change: number; pct: number; volume: number;
      mcap: number; industry: string; prevClose: number;
    }> = {};

    const processIdx = (data: any) => {
      if (!data?.data) return;
      for (const item of data.data) {
        if (!item.symbol || priceLookup[item.symbol]) continue;
        priceLookup[item.symbol] = {
          price: item.lastPrice || 0, change: item.change || 0, pct: item.pChange || 0,
          volume: item.totalTradedVolume || 0, mcap: item.ffmc || item.totalMarketCap || 0,
          industry: item.meta?.industry || item.industry || '', prevClose: item.previousClose || 0,
        };
      }
    };
    processIdx(nifty50Data);
    processIdx(niftyNext50);
    processIdx(nifty500Data);
    processIdx(smallcap250Data);

    // ═══════════════════════════════════════════
    // STEP 4: Identify companies that filed results
    // ═══════════════════════════════════════════
    const confirmedTickers = new Map<string, {
      company: string; date: Date; quarter: string;
      source: string; xbrlLink: string | null;
      revenue: number; pat: number; eps: number;
    }>();

    // Source 1: NSE financial results API (HAS P&L from XBRL fields)
    for (const fr of [...toArray(financialResults), ...toArray(latestResults)]) {
      const sym = fr.symbol || fr.re_symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const filed = parseDate(fr.re_broadcastDt || fr.broadcastDate || fr.re_date || '');
      if (!filed || filed < fromDate || filed > toDate) continue;
      const period = fr.re_toDate || fr.toDate || fr.re_periodEnded || '';
      const revenue = parseNum(fr.re_revenue || fr.revenue || fr.totalIncome || fr.re_incomeFromOperations);
      const pat = parseNum(fr.re_netProfit || fr.netProfit || fr.re_proLossAftTax || fr.proLossAftTax);
      const eps = parseNum(fr.re_eps || fr.eps || fr.re_dilutedEps);
      confirmedTickers.set(sym, {
        company: fr.re_companyName || fr.companyName || sym,
        date: filed,
        quarter: getResultsQuarter(filed, `period ended ${period}`),
        source: 'financial-results',
        xbrlLink: fr.re_xbrl || fr.xbrl || null,
        revenue, pat, eps,
      });
    }

    // Source 2: Results-specific filings
    for (const rf of toArray(resultsFilings)) {
      const sym = rf.symbol || rf.sm_symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const desc = (rf.desc || rf.attchmntText || '').toLowerCase();
      if (!desc.includes('financial result') && !desc.includes('quarterly result')) continue;
      const filed = parseDate(rf.sort_date || rf.an_dt || '');
      if (!filed || filed < fromDate || filed > toDate) continue;
      confirmedTickers.set(sym, {
        company: rf.sm_name || sym, date: filed,
        quarter: getResultsQuarter(filed, desc),
        source: 'results-filing', xbrlLink: null,
        revenue: 0, pat: 0, eps: 0,
      });
    }

    // Source 3: Outcome of Board Meeting announcements
    for (const ann of (Array.isArray(announcements) ? announcements : toArray(announcements))) {
      const sym = ann.symbol || ann.sm_symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const desc = (ann.desc || '').toLowerCase();
      const att = (ann.attchmntText || '').toLowerCase();
      if (!desc.includes('outcome') || !att.includes('financial result')) continue;
      const filed = parseDate(ann.sort_date || ann.an_dt || '');
      if (!filed || filed < fromDate || filed > toDate) continue;
      confirmedTickers.set(sym, {
        company: ann.sm_name || sym, date: filed,
        quarter: getResultsQuarter(filed, att),
        source: 'outcome', xbrlLink: null,
        revenue: 0, pat: 0, eps: 0,
      });
    }

    // Source 4: Board meetings (upcoming + recent)
    for (const bm of [...toArray(boardMeetings), ...toArray(boardMeetingsRange)]) {
      const sym = bm.bm_symbol || bm.symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const purpose = (bm.bm_purpose || bm.purpose || '').toLowerCase();
      if (!purpose.includes('financial result') && !purpose.includes('quarterly result')) continue;
      const meetDate = parseDate(bm.bm_date || bm.date || '');
      if (!meetDate || meetDate < fromDate || meetDate > toDate) continue;
      confirmedTickers.set(sym, {
        company: bm.bm_companyName || bm.sm_name || sym, date: meetDate,
        quarter: getResultsQuarter(meetDate, bm.bm_desc || bm.desc || ''),
        source: 'board-meeting', xbrlLink: null,
        revenue: 0, pat: 0, eps: 0,
      });
    }

    console.log(`[Earnings Cards v4] ${confirmedTickers.size} companies identified`);

    // ═══════════════════════════════════════════
    // STEP 5: Expand universe — fetch quotes for unknown tickers
    // ═══════════════════════════════════════════
    const inPriceUniverse: string[] = [];
    const notInPriceUniverse: string[] = [];
    for (const sym of confirmedTickers.keys()) {
      if (priceLookup[sym]) inPriceUniverse.push(sym);
      else notInPriceUniverse.push(sym);
    }

    const quoteFetchSymbols = notInPriceUniverse.slice(0, 15);
    let quotesEnriched = 0;

    if (quoteFetchSymbols.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < quoteFetchSymbols.length; i += batchSize) {
        const batch = quoteFetchSymbols.slice(i, i + batchSize);
        const quotes = await Promise.all(
          batch.map(sym => fetchStockQuote(sym).catch(() => null))
        );
        for (let j = 0; j < batch.length; j++) {
          const q = quotes[j];
          if (!q) continue;
          const sym = batch[j];
          const pi = q.priceInfo || {};
          const si = q.securityInfo || {};
          const info = q.info || {};
          const lastPrice = pi.lastPrice || pi.close || 0;
          if (lastPrice <= 0) continue;
          priceLookup[sym] = {
            price: lastPrice,
            change: pi.change || 0,
            pct: pi.pChange || 0,
            volume: 0,
            mcap: si.issuedSize ? (si.issuedSize * lastPrice) : 0,
            industry: info.industry || '',
            prevClose: pi.previousClose || 0,
          };
          quotesEnriched++;
        }
        if (i + batchSize < quoteFetchSymbols.length) await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`[Earnings Cards v4] ${inPriceUniverse.length} in index + ${quotesEnriched} enriched`);

    // ═══════════════════════════════════════════
    // STEP 6: Build cards with 2-layer schema
    // ═══════════════════════════════════════════
    const cards: EarningsCard[] = [];

    for (const [symbol, info] of confirmedTickers) {
      const stock = priceLookup[symbol];
      if (!stock) continue;
      if (stock.price < 2) continue; // Skip penny stocks

      const mcapCr = stock.mcap / 10000000; // Convert to Cr

      // ── Layer 1: Event Intelligence ──
      const rawPriceMove = stock.pct;
      const excessReturn = parseFloat((rawPriceMove - niftyReturn).toFixed(2));

      // ── Layer 2: Fundamentals (populate from XBRL when available) ──
      const hasXbrlData = info.revenue > 0 || info.pat !== 0;
      const financials: Financials = emptyFinancials();

      if (hasXbrlData) {
        financials.revenue = info.revenue || null;
        financials.pat = info.pat || null;
        financials.eps = info.eps || null;
        // OPM/NPM can be derived if we have revenue
        if (info.revenue > 0 && info.pat !== 0) {
          financials.npm = parseFloat(((info.pat / info.revenue) * 100).toFixed(1));
        }
      }

      // ── Determine data quality ──
      let dataQuality: DataQuality = 'NONE';
      if (hasXbrlData && financials.revenue && financials.pat && financials.eps) {
        dataQuality = 'FULL';
      } else if (hasXbrlData) {
        dataQuality = 'PARTIAL';
      }

      // ── Grading: Use best available data ──
      let grading;
      if (dataQuality === 'FULL') {
        grading = gradeFromFinancials(financials);
      } else {
        // Use excess return for grade (market-reaction normalized)
        grading = gradeFromExcessReturn(excessReturn);
      }

      const resultDate = info.date.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      });

      cards.push({
        symbol,
        company: info.company,
        period: info.quarter,
        resultDate,
        reportType: 'Standalone',
        sector: normalizeSector(stock.industry),
        industry: stock.industry,
        marketCap: getCapCategory(mcapCr),

        // Layer 1: Event Intelligence
        qualityScore: grading.score,
        grade: grading.grade,
        gradeColor: grading.color,
        price: {
          cmp: stock.price,
          prevClose: stock.prevClose || null,
          edp: stock.prevClose || null,
          changePct: parseFloat(rawPriceMove.toFixed(1)),
          excessReturn,
          indexReturn: niftyReturn,
        },

        // Layer 2: Fundamentals
        financials,
        dataQuality,

        // Valuation
        pe: null,
        bookValue: null,
        dividendYield: null,
        mcap: mcapCr > 0 ? parseFloat(mcapCr.toFixed(0)) : null,
        yearHigh: null,
        yearLow: null,

        // Links
        resultLink: info.xbrlLink,
        nseLink: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
        source: info.source,
      });
    }

    // ═══════════════════════════════════════════
    // STEP 7: Sort and filter
    // ═══════════════════════════════════════════
    let filtered = cards;
    if (indexFilter) {
      const fk = indexFilter.toUpperCase().replace(/\s+/g, '');
      filtered = cards.filter(c => {
        if (fk === 'NIFTY50') return c.marketCap === 'L';
        if (fk === 'NIFTY500') return c.marketCap === 'L' || c.marketCap === 'M' || c.marketCap === 'S';
        if (fk === 'MIDCAP') return c.marketCap === 'M';
        if (fk === 'SMALLCAP') return c.marketCap === 'S' || c.marketCap === 'Micro';
        return true;
      });
    }

    // Sort: result date desc, then score desc
    filtered.sort((a, b) => {
      const da = new Date(a.resultDate).getTime() || 0;
      const db = new Date(b.resultDate).getTime() || 0;
      return db !== da ? db - da : b.qualityScore - a.qualityScore;
    });

    const summary = {
      total: filtered.length,
      strong: filtered.filter(c => c.grade === 'STRONG').length,
      good: filtered.filter(c => c.grade === 'GOOD').length,
      ok: filtered.filter(c => c.grade === 'OK').length,
      bad: filtered.filter(c => c.grade === 'BAD').length,
      avgScore: filtered.length > 0
        ? parseFloat((filtered.reduce((s, c) => s + c.qualityScore, 0) / filtered.length).toFixed(1))
        : 0,
      withFinancials: filtered.filter(c => c.dataQuality !== 'NONE').length,
      dataQualityBreakdown: {
        full: filtered.filter(c => c.dataQuality === 'FULL').length,
        partial: filtered.filter(c => c.dataQuality === 'PARTIAL').length,
        none: filtered.filter(c => c.dataQuality === 'NONE').length,
      },
      niftyReturn,
    };

    console.log(`[Earnings Cards v4] ${filtered.length} cards, ${summary.withFinancials} with financials`);

    return NextResponse.json({
      cards: filtered,
      summary,
      dateRange: { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] },
      source: 'NSE India (Live)',
      updatedAt: new Date().toISOString(),
      schemaVersion: 2,
      ...(debug ? {
        debug: true,
        confirmedTickers: confirmedTickers.size,
        inPriceUniverse: inPriceUniverse.length,
        quotesEnriched,
        totalCards: cards.length,
        niftyReturn,
      } : {}),
    });

  } catch (error) {
    console.error('[Earnings Cards v4] Error:', error);
    return NextResponse.json({
      cards: [],
      summary: {
        total: 0, strong: 0, good: 0, ok: 0, bad: 0, avgScore: 0,
        withFinancials: 0,
        dataQualityBreakdown: { full: 0, partial: 0, none: 0 },
        niftyReturn: 0,
      },
      error: String(error),
      schemaVersion: 2,
    }, { status: 500 });
  }
}
