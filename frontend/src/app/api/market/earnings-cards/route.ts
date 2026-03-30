import { NextResponse } from 'next/server';
import {
  nseApiFetch,
  fetchNifty50,
  fetchNiftySmallcap250,
  fetchNifty500,
  fetchStockQuote,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ══════════════════════════════════════════════
// EARNINGS CARDS API — Full P&L with YoY/QoQ
// Returns EarningsPulse-style financial data cards
// ══════════════════════════════════════════════

interface FinancialQuarter {
  revenue: number;       // Total Income in Cr
  operatingProfit: number;
  opm: number;           // Operating Profit Margin %
  pat: number;           // Profit After Tax
  npm: number;           // Net Profit Margin %
  eps: number;
  period: string;        // "Dec 2025"
}

interface EarningsCard {
  symbol: string;
  company: string;
  resultDate: string;
  quarter: string;          // "Q3 FY26"
  reportType: string;       // "Consolidated" | "Standalone"

  // Current quarter financials
  current: FinancialQuarter;
  // Previous quarter (QoQ)
  prevQ: FinancialQuarter | null;
  // Year-ago quarter (YoY)
  yoyQ: FinancialQuarter | null;

  // Growth percentages
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;

  // Stock info
  mcap: number | null;     // in Cr
  pe: number | null;
  cmp: number | null;
  priceChange: number | null;
  sector: string;
  industry: string;
  marketCap: string;        // L/M/S/Micro

  // Grade
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  signalScore: number;

  // Links
  resultLink: string | null;
  xbrlLink: string | null;
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function parseNum(val: any): number {
  if (val === null || val === undefined || val === '' || val === '-') return 0;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : null;
  return parseFloat((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function margin(profit: number, revenue: number): number {
  if (revenue === 0) return 0;
  return parseFloat(((profit / revenue) * 100).toFixed(1));
}

function getCapCategory(mcapCr: number): string {
  if (mcapCr >= 50000) return 'L';
  if (mcapCr >= 15000) return 'M';
  if (mcapCr >= 5000) return 'S';
  if (mcapCr > 0) return 'Micro';
  return '';
}

function gradeEarnings(
  revenueYoY: number | null,
  patYoY: number | null,
  epsYoY: number | null,
  opmTrend: number // current OPM - prev OPM
): { grade: EarningsCard['grade']; color: string; score: number } {
  // Weighted score: Revenue 30%, PAT 30%, EPS 20%, Margin 20%
  let score = 50; // baseline

  if (revenueYoY !== null) {
    if (revenueYoY > 15) score += 15;
    else if (revenueYoY > 5) score += 8;
    else if (revenueYoY > -5) score += 0;
    else score -= 15;
  }

  if (patYoY !== null) {
    if (patYoY > 25) score += 15;
    else if (patYoY > 10) score += 8;
    else if (patYoY > 0) score += 3;
    else score -= 15;
  }

  if (epsYoY !== null) {
    if (epsYoY > 20) score += 10;
    else if (epsYoY > 5) score += 5;
    else if (epsYoY > -5) score += 0;
    else score -= 10;
  }

  // Margin trend
  if (opmTrend > 2) score += 10;
  else if (opmTrend > -2) score += 0;
  else score -= 10;

  // Clamp score 0-100
  score = Math.max(0, Math.min(100, score));

  if (score >= 75) return { grade: 'STRONG', color: '#00C853', score };
  if (score >= 55) return { grade: 'GOOD', color: '#4CAF50', score };
  if (score >= 35) return { grade: 'OK', color: '#FFD600', score };
  return { grade: 'BAD', color: '#F44336', score };
}

// ══════════════════════════════════════════════
// DATE HELPERS
// ══════════════════════════════════════════════

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

function formatPeriod(dateStr: string): string {
  const d = parseDate(dateStr);
  if (!d) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getFiscalQuarter(endDate: Date): string {
  const month = endDate.getMonth() + 1;
  const year = endDate.getFullYear();
  if (month >= 1 && month <= 3) return `Q4 FY${year.toString().slice(2)}`;
  if (month >= 4 && month <= 6) return `Q1 FY${(year + 1).toString().slice(2)}`;
  if (month >= 7 && month <= 9) return `Q2 FY${(year + 1).toString().slice(2)}`;
  return `Q3 FY${(year + 1).toString().slice(2)}`;
}

function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  if (data?.Table && Array.isArray(data.Table)) return data.Table;
  // Try any array-valued key
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key];
  }
  return [];
}

// ══════════════════════════════════════════════
// PARSE NSE FINANCIAL RESULT INTO QUARTER DATA
// ══════════════════════════════════════════════

function parseFinancialResult(fr: any): {
  symbol: string;
  company: string;
  broadcastDate: Date | null;
  toDate: Date | null;
  fromDate: Date | null;
  reportType: string;
  revenue: number;
  expenditure: number;
  operatingProfit: number;
  pat: number;
  eps: number;
  xbrlLink: string | null;
} | null {
  const symbol = fr.symbol || fr.re_symbol || '';
  if (!symbol) return null;

  const company = fr.re_companyName || fr.companyName || fr.sm_name || symbol;
  const broadcastDate = parseDate(fr.re_broadcastDt || fr.broadcastDate || fr.re_date || '');
  const toDate = parseDate(fr.re_toDate || fr.toDate || fr.re_periodEnded || '');
  const fromDate = parseDate(fr.re_fromDate || fr.fromDate || '');

  // Determine if consolidated or standalone
  const audited = (fr.re_audited || fr.audited || '').toLowerCase();
  const reportType = (fr.re_xbrl || fr.xbrl || '').toLowerCase().includes('consol') ? 'Consolidated' :
    audited.includes('consol') ? 'Consolidated' : 'Standalone';

  // Revenue = Total Income from Operations
  const revenue = parseNum(fr.re_revenue || fr.revenue || fr.totalIncome || fr.income || fr.re_incomeFromOperations);
  // Expenditure = Total Expenditure
  const expenditure = parseNum(fr.re_expenditure || fr.expenditure || fr.totalExpenditure);
  // Operating Profit
  const operatingProfit = parseNum(fr.re_operProfit || fr.operatingProfit || fr.re_profitBeforeTax)
    || (revenue - expenditure);
  // PAT
  const pat = parseNum(fr.re_netProfit || fr.netProfit || fr.re_proLossAftTax || fr.proLossAftTax);
  // EPS
  const eps = parseNum(fr.re_eps || fr.eps || fr.re_dilutedEps || fr.dilutedEps);
  // XBRL link
  const xbrlLink = fr.re_xbrl || fr.xbrl || null;

  return { symbol, company, broadcastDate, toDate, fromDate, reportType, revenue, expenditure, operatingProfit, pat, eps, xbrlLink };
}

// ══════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const symbolsParam = searchParams.get('symbols');
  const indexFilter = searchParams.get('index');
  const debug = searchParams.get('debug') === 'true';

  try {
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

    // Also fetch previous 2 quarters for YoY/QoQ comparison
    const prevQFrom = new Date(fromDate);
    prevQFrom.setMonth(prevQFrom.getMonth() - 3);
    const prevQTo = new Date(toDate);
    prevQTo.setMonth(prevQTo.getMonth() - 3);

    const yoyFrom = new Date(fromDate);
    yoyFrom.setFullYear(yoyFrom.getFullYear() - 1);
    const yoyTo = new Date(toDate);
    yoyTo.setFullYear(yoyTo.getFullYear() - 1);

    const fmt = (d: Date) => {
      const dd = d.getDate().toString().padStart(2, '0');
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    };

    const fmtMon = (d: Date) => {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${d.getDate().toString().padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    };

    console.log(`[Earnings Cards] Fetching for ${fmt(fromDate)} to ${fmt(toDate)}`);

    // ═══════════════════════════════════════════
    // STEP 1: Fetch financial results (current + historical)
    // ═══════════════════════════════════════════
    const [
      currentResults,
      latestResults,
      nifty50Data,
      nifty500Data,
      smallcap250Data,
    ] = await Promise.all([
      // Current period - try multiple formats
      nseApiFetch(`/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${fmtMon(fromDate)}&to_date=${fmtMon(toDate)}`, 600000).catch(() => null),
      // Latest without date filter (gets most recent filings)
      nseApiFetch('/api/corporates-financial-results?index=equities', 600000).catch(() => null),
      fetchNifty50().catch(() => null),
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // Also try with DD-MM-YYYY format
    let altResults: any = null;
    const currentArr = toArray(currentResults);
    if (currentArr.length === 0) {
      altResults = await nseApiFetch(
        `/api/corporates-financial-results?index=equities&from_date=${fmt(fromDate)}&to_date=${fmt(toDate)}`,
        600000
      ).catch(() => null);
    }

    // Combine all financial results
    const allResults = [...toArray(currentResults), ...toArray(latestResults), ...toArray(altResults)];
    console.log(`[Earnings Cards] Total financial results fetched: ${allResults.length}`);

    if (debug && allResults.length > 0) {
      console.log(`[Earnings Cards] Sample result keys:`, Object.keys(allResults[0]));
    }

    // ═══════════════════════════════════════════
    // STEP 2: Build price/sector lookup from indices
    // ═══════════════════════════════════════════
    const priceLookup: Record<string, {
      price: number; change: number; changePercent: number;
      volume: number; marketCap: number; industry: string;
      previousClose: number; pe: number;
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
            pe: item.pe || 0,
          };
        }
      }
    };

    processStockData(nifty50Data, 'NIFTY50');
    processStockData(nifty500Data, 'NIFTY500');
    processStockData(smallcap250Data, 'SMALLCAP250');

    // ═══════════════════════════════════════════
    // STEP 3: Group results by symbol, sort by period
    // ═══════════════════════════════════════════
    const resultsBySymbol = new Map<string, any[]>();

    for (const fr of allResults) {
      const parsed = parseFinancialResult(fr);
      if (!parsed || !parsed.symbol) continue;
      if (!resultsBySymbol.has(parsed.symbol)) {
        resultsBySymbol.set(parsed.symbol, []);
      }
      resultsBySymbol.get(parsed.symbol)!.push({ ...parsed, _raw: fr });
    }

    // Sort each company's results by toDate descending (most recent first)
    for (const [, results] of resultsBySymbol) {
      results.sort((a: any, b: any) => {
        const aDate = a.toDate?.getTime() || 0;
        const bDate = b.toDate?.getTime() || 0;
        return bDate - aDate;
      });
    }

    // ═══════════════════════════════════════════
    // STEP 4: Filter to companies that filed THIS month
    // ═══════════════════════════════════════════
    const symbolsFilter = symbolsParam
      ? new Set(symbolsParam.split(',').map(s => s.trim().toUpperCase()))
      : null;

    const cards: EarningsCard[] = [];

    for (const [symbol, results] of resultsBySymbol) {
      // Check if this company filed in the target month
      const currentFiling = results.find((r: any) => {
        if (!r.broadcastDate) return false;
        return r.broadcastDate >= fromDate && r.broadcastDate <= toDate;
      });

      if (!currentFiling) continue;

      // Symbol filter
      if (symbolsFilter && !symbolsFilter.has(symbol)) continue;

      // Skip penny stocks
      const stockInfo = priceLookup[symbol];
      if (stockInfo && stockInfo.price < 2) continue;

      // Get current, previous quarter, and year-ago quarter
      const current = currentFiling;
      // Previous quarter = the next result in the list (sorted by toDate desc)
      const currentIdx = results.indexOf(current);
      const prevQ = results.length > currentIdx + 1 ? results[currentIdx + 1] : null;
      // Year-ago quarter = find result where toDate is ~12 months before current toDate
      let yoyQ = null;
      if (current.toDate) {
        const targetDate = new Date(current.toDate);
        targetDate.setFullYear(targetDate.getFullYear() - 1);
        yoyQ = results.find((r: any) => {
          if (!r.toDate) return false;
          const diff = Math.abs(r.toDate.getTime() - targetDate.getTime());
          return diff < 45 * 24 * 60 * 60 * 1000; // Within 45 days
        }) || null;
      }

      // Build quarter data
      const buildQuarter = (r: any): FinancialQuarter => ({
        revenue: r.revenue,
        operatingProfit: r.operatingProfit,
        opm: margin(r.operatingProfit, r.revenue),
        pat: r.pat,
        npm: margin(r.pat, r.revenue),
        eps: r.eps,
        period: r.toDate ? formatPeriod(r.toDate.toISOString()) : '',
      });

      const currentQ = buildQuarter(current);
      const previousQ = prevQ ? buildQuarter(prevQ) : null;
      const yearAgoQ = yoyQ ? buildQuarter(yoyQ) : null;

      // Calculate growth %
      const revenueYoY = yearAgoQ ? pctChange(currentQ.revenue, yearAgoQ.revenue) : null;
      const revenueQoQ = previousQ ? pctChange(currentQ.revenue, previousQ.revenue) : null;
      const opProfitYoY = yearAgoQ ? pctChange(currentQ.operatingProfit, yearAgoQ.operatingProfit) : null;
      const opProfitQoQ = previousQ ? pctChange(currentQ.operatingProfit, previousQ.operatingProfit) : null;
      const patYoY = yearAgoQ ? pctChange(currentQ.pat, yearAgoQ.pat) : null;
      const patQoQ = previousQ ? pctChange(currentQ.pat, previousQ.pat) : null;
      const epsYoY = yearAgoQ ? pctChange(currentQ.eps, yearAgoQ.eps) : null;
      const epsQoQ = previousQ ? pctChange(currentQ.eps, previousQ.eps) : null;

      // OPM trend for grading
      const opmTrend = previousQ ? currentQ.opm - previousQ.opm : 0;

      // Grade
      const { grade, color: gradeColor, score: signalScore } = gradeEarnings(
        revenueYoY, patYoY, epsYoY, opmTrend
      );

      // Market cap and PE
      const mcapCr = stockInfo ? stockInfo.marketCap / 10000000 : null;
      const pe = stockInfo?.pe || (currentQ.eps > 0 && stockInfo?.price ? parseFloat((stockInfo.price / currentQ.eps).toFixed(1)) : null);

      // Result date
      const resultDate = current.broadcastDate
        ? current.broadcastDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';

      // Quarter string
      const quarter = current.toDate ? getFiscalQuarter(current.toDate) : '';

      cards.push({
        symbol,
        company: current.company,
        resultDate,
        quarter,
        reportType: current.reportType,
        current: currentQ,
        prevQ: previousQ,
        yoyQ: yearAgoQ,
        revenueYoY, revenueQoQ,
        opProfitYoY, opProfitQoQ,
        patYoY, patQoQ,
        epsYoY, epsQoQ,
        mcap: mcapCr ? parseFloat(mcapCr.toFixed(0)) : null,
        pe,
        cmp: stockInfo?.price || null,
        priceChange: stockInfo?.changePercent || null,
        sector: normalizeSector(stockInfo?.industry),
        industry: stockInfo?.industry || '',
        marketCap: mcapCr ? getCapCategory(mcapCr) : '',
        grade, gradeColor, signalScore,
        resultLink: current.xbrlLink || null,
        xbrlLink: current.xbrlLink || null,
      });
    }

    // ═══════════════════════════════════════════
    // STEP 5: Try Render proxy for enrichment if we got few results
    // ═══════════════════════════════════════════
    if (cards.length < 5) {
      try {
        const monthStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
        const renderRes = await fetch(
          `https://mc-pulse-bots.onrender.com/api/nse/earnings-cards?month=${monthStr}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (renderRes.ok) {
          const renderData = await renderRes.json();
          const renderCards = renderData.cards || [];
          const existingSymbols = new Set(cards.map(c => c.symbol));
          for (const rc of renderCards) {
            if (!existingSymbols.has(rc.symbol)) {
              cards.push(rc);
            }
          }
        }
      } catch (e) {
        console.log('[Earnings Cards] Render proxy unavailable:', String(e));
      }
    }

    // ═══════════════════════════════════════════
    // STEP 6: Index filter
    // ═══════════════════════════════════════════
    let filteredCards = cards;
    if (indexFilter) {
      const fk = indexFilter.toUpperCase().replace(/\s+/g, '');
      filteredCards = cards.filter(c => {
        if (fk === 'NIFTY50') return indexMembers['NIFTY50'].has(c.symbol);
        if (fk === 'NIFTY500') return indexMembers['NIFTY500'].has(c.symbol);
        if (fk === 'SMALLCAP250') return indexMembers['SMALLCAP250'].has(c.symbol);
        if (fk === 'MIDCAP') return c.marketCap === 'M';
        if (fk === 'SMALLCAP') return c.marketCap === 'S' || c.marketCap === 'Micro';
        return true;
      });
    }

    // Sort by result date (most recent first), then by signal score
    filteredCards.sort((a, b) => {
      const dateA = parseDate(a.resultDate)?.getTime() || 0;
      const dateB = parseDate(b.resultDate)?.getTime() || 0;
      if (dateB !== dateA) return dateB - dateA;
      return b.signalScore - a.signalScore;
    });

    // Grade summary
    const summary = {
      total: filteredCards.length,
      strong: filteredCards.filter(c => c.grade === 'STRONG').length,
      good: filteredCards.filter(c => c.grade === 'GOOD').length,
      ok: filteredCards.filter(c => c.grade === 'OK').length,
      bad: filteredCards.filter(c => c.grade === 'BAD').length,
      avgScore: filteredCards.length > 0
        ? parseFloat((filteredCards.reduce((s, c) => s + c.signalScore, 0) / filteredCards.length).toFixed(1))
        : 0,
    };

    console.log(`[Earnings Cards] Returning ${filteredCards.length} cards, avg score: ${summary.avgScore}`);

    return NextResponse.json({
      cards: filteredCards,
      summary,
      dateRange: { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] },
      source: 'NSE India (Live)',
      updatedAt: new Date().toISOString(),
      ...(debug ? {
        debug: true,
        totalResults: allResults.length,
        uniqueSymbols: resultsBySymbol.size,
        priceUniverse: Object.keys(priceLookup).length,
        sampleKeys: allResults.length > 0 ? Object.keys(allResults[0]) : [],
      } : {}),
    });

  } catch (error) {
    console.error('[Earnings Cards] Error:', error);
    return NextResponse.json({
      cards: [],
      summary: { total: 0, strong: 0, good: 0, ok: 0, bad: 0, avgScore: 0 },
      error: String(error),
    }, { status: 500 });
  }
}
