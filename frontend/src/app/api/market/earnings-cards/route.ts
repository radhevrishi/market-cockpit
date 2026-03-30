import { NextResponse } from 'next/server';
import {
  nseApiFetch,
  fetchNifty50,
  fetchNiftySmallcap250,
  fetchNifty500,
  fetchStockQuote,
  fetchFinancialResults,
  fetchLatestFinancialResults,
  normalizeSector,
} from '@/lib/nse';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ══════════════════════════════════════════════
// EARNINGS CARDS API — Full P&L with YoY/QoQ
// Strategy:
//   1. Fetch existing /api/market/earnings for company list
//   2. Fetch financial results from NSE + Render proxy
//   3. Build cards with actual Revenue/PAT/EPS + YoY/QoQ
// ══════════════════════════════════════════════

interface FinancialQuarter {
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
  period: string;
}

interface EarningsCard {
  symbol: string;
  company: string;
  resultDate: string;
  quarter: string;
  reportType: string;
  current: FinancialQuarter;
  prevQ: FinancialQuarter | null;
  yoyQ: FinancialQuarter | null;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;
  mcap: number | null;
  pe: number | null;
  cmp: number | null;
  priceChange: number | null;
  sector: string;
  industry: string;
  marketCap: string;
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  signalScore: number;
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
  opmTrend: number
): { grade: EarningsCard['grade']; color: string; score: number } {
  let score = 50;
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
  if (opmTrend > 2) score += 10;
  else if (opmTrend > -2) score += 0;
  else score -= 10;

  score = Math.max(0, Math.min(100, score));
  if (score >= 75) return { grade: 'STRONG', color: '#00C853', score };
  if (score >= 55) return { grade: 'GOOD', color: '#4CAF50', score };
  if (score >= 35) return { grade: 'OK', color: '#FFD600', score };
  return { grade: 'BAD', color: '#F44336', score };
}

function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.results && Array.isArray(data.results)) return data.results;
  if (data?.Table && Array.isArray(data.Table)) return data.Table;
  for (const key of Object.keys(data || {})) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key];
  }
  return [];
}

function formatPeriod(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return dateStr; }
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
    const monthStr = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    console.log(`[Earnings Cards] Fetching for month=${monthStr}`);

    // ═══════════════════════════════════════════
    // STEP 1: Get company list from existing earnings API
    // ═══════════════════════════════════════════
    const API_BASE = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://market-cockpit.vercel.app';

    let earningsResults: any[] = [];
    try {
      const earningsRes = await fetch(
        `${API_BASE}/api/market/earnings?market=india&month=${monthStr}`,
        { signal: AbortSignal.timeout(25000) }
      );
      if (earningsRes.ok) {
        const earningsData = await earningsRes.json();
        earningsResults = earningsData.results || [];
      }
    } catch (e) {
      console.log('[Earnings Cards] Failed to fetch earnings API:', String(e));
    }

    console.log(`[Earnings Cards] Got ${earningsResults.length} companies from earnings API`);

    if (earningsResults.length === 0) {
      return NextResponse.json({
        cards: [], summary: { total: 0, strong: 0, good: 0, ok: 0, bad: 0, avgScore: 0 },
        dateRange: { from: `${monthStr}-01`, to: `${monthStr}-28` },
        source: 'NSE India (Live)', updatedAt: new Date().toISOString(),
        ...(debug ? { debug: true, earningsCount: 0 } : {}),
      });
    }

    // ═══════════════════════════════════════════
    // STEP 2: Fetch financial results from Render proxy
    // ═══════════════════════════════════════════
    const symbols = earningsResults.map((r: any) => r.ticker).filter(Boolean);
    const symbolsStr = symbols.join(',');

    let financialResultsBySymbol: Record<string, any[]> = {};
    let renderWorked = false;

    // Try Render proxy first (has parsed financial data)
    try {
      const frRes = await fetch(
        `https://mc-pulse-bots.onrender.com/api/nse/financial-results?symbols=${encodeURIComponent(symbolsStr)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (frRes.ok) {
        const frData = await frRes.json();
        financialResultsBySymbol = frData.results || {};
        renderWorked = Object.keys(financialResultsBySymbol).length > 0;
        console.log(`[Earnings Cards] Render proxy: ${Object.keys(financialResultsBySymbol).length} companies with data`);
      }
    } catch (e) {
      console.log('[Earnings Cards] Render proxy unavailable:', String(e));
    }

    // ═══════════════════════════════════════════
    // STEP 2B: Also try NSE financial results directly
    // ═══════════════════════════════════════════
    let nseFinancialResults: any[] = [];
    try {
      const [fr1, fr2] = await Promise.all([
        fetchLatestFinancialResults().catch(() => null),
        nseApiFetch('/api/corporates-financial-results?index=equities', 600000).catch(() => null),
      ]);
      nseFinancialResults = [...toArray(fr1), ...toArray(fr2)];
      console.log(`[Earnings Cards] NSE direct financial results: ${nseFinancialResults.length}`);
      if (nseFinancialResults.length > 0) {
        console.log(`[Earnings Cards] NSE FR sample keys: ${Object.keys(nseFinancialResults[0]).join(',')}`);
      }
    } catch {}

    // Group NSE results by symbol
    const nseResultsBySymbol = new Map<string, any[]>();
    for (const fr of nseFinancialResults) {
      const sym = fr.symbol || fr.re_symbol || '';
      if (!sym) continue;
      if (!nseResultsBySymbol.has(sym)) nseResultsBySymbol.set(sym, []);
      nseResultsBySymbol.get(sym)!.push(fr);
    }

    // ═══════════════════════════════════════════
    // STEP 3: Build cards by combining earnings + financial data
    // ═══════════════════════════════════════════
    const cards: EarningsCard[] = [];

    for (const earning of earningsResults) {
      const symbol = earning.ticker;
      if (!symbol) continue;

      // Symbol filter
      if (symbolsParam) {
        const allowed = new Set(symbolsParam.split(',').map(s => s.trim().toUpperCase()));
        if (!allowed.has(symbol)) continue;
      }

      // Get financial results for this company
      const renderResults = financialResultsBySymbol[symbol] || [];
      const nseResults = nseResultsBySymbol.get(symbol) || [];

      // Parse financial data from either source
      let current: FinancialQuarter | null = null;
      let prevQ: FinancialQuarter | null = null;
      let yoyQ: FinancialQuarter | null = null;
      let reportType = 'Standalone';
      let xbrlLink: string | null = null;

      if (renderResults.length > 0) {
        // Render proxy has parsed results sorted by period
        const parseRenderResult = (r: any): FinancialQuarter => {
          const revenue = parseNum(r.re_revenue || r.revenue || r.totalIncome || r.income);
          const expenditure = parseNum(r.re_expenditure || r.expenditure || r.totalExpenditure);
          const operatingProfit = parseNum(r.re_operProfit || r.operatingProfit || r.re_profitBeforeTax) || (revenue - expenditure);
          const pat = parseNum(r.re_netProfit || r.netProfit || r.re_proLossAftTax || r.proLossAftTax);
          const eps = parseNum(r.re_eps || r.eps || r.re_dilutedEps);
          const toDate = r.re_toDate || r.toDate || r.re_periodEnded || '';
          return {
            revenue, operatingProfit,
            opm: margin(operatingProfit, revenue),
            pat, npm: margin(pat, revenue), eps,
            period: formatPeriod(toDate),
          };
        };

        current = parseRenderResult(renderResults[0]);
        if (renderResults.length > 1) prevQ = parseRenderResult(renderResults[1]);
        if (renderResults.length > 4) yoyQ = parseRenderResult(renderResults[4]); // ~4 quarters back = YoY
        else if (renderResults.length > 3) yoyQ = parseRenderResult(renderResults[3]);

        reportType = (renderResults[0].re_xbrl || '').toLowerCase().includes('consol') ? 'Consolidated' : 'Standalone';
        xbrlLink = renderResults[0].re_xbrl || null;

      } else if (nseResults.length > 0) {
        // Direct NSE results
        const parseNSEResult = (r: any): FinancialQuarter => {
          const revenue = parseNum(r.re_revenue || r.revenue || r.totalIncome || r.income || r.re_incomeFromOperations);
          const expenditure = parseNum(r.re_expenditure || r.expenditure || r.totalExpenditure);
          const operatingProfit = parseNum(r.re_operProfit || r.operatingProfit || r.re_profitBeforeTax) || (revenue - expenditure);
          const pat = parseNum(r.re_netProfit || r.netProfit || r.re_proLossAftTax || r.proLossAftTax);
          const eps = parseNum(r.re_eps || r.eps || r.re_dilutedEps || r.dilutedEps);
          const toDate = r.re_toDate || r.toDate || r.re_periodEnded || '';
          return {
            revenue, operatingProfit,
            opm: margin(operatingProfit, revenue),
            pat, npm: margin(pat, revenue), eps,
            period: formatPeriod(toDate),
          };
        };

        current = parseNSEResult(nseResults[0]);
        if (nseResults.length > 1) prevQ = parseNSEResult(nseResults[1]);
        if (nseResults.length > 4) yoyQ = parseNSEResult(nseResults[4]);
        else if (nseResults.length > 3) yoyQ = parseNSEResult(nseResults[3]);

        reportType = (nseResults[0].re_xbrl || '').toLowerCase().includes('consol') ? 'Consolidated' : 'Standalone';
        xbrlLink = nseResults[0].re_xbrl || null;
      }

      // If no financial data, create a basic card from earnings data
      if (!current) {
        current = {
          revenue: 0, operatingProfit: 0, opm: 0,
          pat: 0, npm: 0, eps: 0, period: '',
        };
      }

      // Calculate growth %
      const revenueYoY = yoyQ && yoyQ.revenue > 0 ? pctChange(current.revenue, yoyQ.revenue) : null;
      const revenueQoQ = prevQ && prevQ.revenue > 0 ? pctChange(current.revenue, prevQ.revenue) : null;
      const opProfitYoY = yoyQ && yoyQ.operatingProfit !== 0 ? pctChange(current.operatingProfit, yoyQ.operatingProfit) : null;
      const opProfitQoQ = prevQ && prevQ.operatingProfit !== 0 ? pctChange(current.operatingProfit, prevQ.operatingProfit) : null;
      const patYoY = yoyQ && yoyQ.pat !== 0 ? pctChange(current.pat, yoyQ.pat) : null;
      const patQoQ = prevQ && prevQ.pat !== 0 ? pctChange(current.pat, prevQ.pat) : null;
      const epsYoY = yoyQ && yoyQ.eps !== 0 ? pctChange(current.eps, yoyQ.eps) : null;
      const epsQoQ = prevQ && prevQ.eps !== 0 ? pctChange(current.eps, prevQ.eps) : null;

      // OPM trend
      const opmTrend = prevQ ? current.opm - prevQ.opm : 0;

      // Grade
      const { grade, color: gradeColor, score: signalScore } = gradeEarnings(revenueYoY, patYoY, epsYoY, opmTrend);

      // Market data from earnings result
      const mcapCr = earning.cmp && earning.marketCap === 'S' ? null : null; // Use from stock data
      const pe = earning.cmp && current.eps > 0
        ? parseFloat((earning.cmp / (current.eps * 4)).toFixed(1)) // Annualize quarterly EPS
        : null;

      cards.push({
        symbol,
        company: earning.company || symbol,
        resultDate: earning.resultDate || '',
        quarter: earning.quarter || '',
        reportType,
        current,
        prevQ,
        yoyQ,
        revenueYoY, revenueQoQ,
        opProfitYoY, opProfitQoQ,
        patYoY, patQoQ,
        epsYoY, epsQoQ,
        mcap: null, // Will be enriched
        pe,
        cmp: earning.cmp || null,
        priceChange: earning.priceMove || null,
        sector: earning.sector || '',
        industry: earning.industry || '',
        marketCap: earning.marketCap || '',
        grade, gradeColor, signalScore,
        resultLink: xbrlLink,
        xbrlLink,
      });
    }

    // ═══════════════════════════════════════════
    // STEP 4: Enrich with stock quotes for mcap/PE
    // ═══════════════════════════════════════════
    const needsEnrich = cards.filter(c => c.cmp && !c.mcap).slice(0, 15);
    if (needsEnrich.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < needsEnrich.length; i += batchSize) {
        const batch = needsEnrich.slice(i, i + batchSize);
        const quotes = await Promise.all(
          batch.map(c => fetchStockQuote(c.symbol).catch(() => null))
        );
        for (let j = 0; j < batch.length; j++) {
          const quote = quotes[j];
          if (!quote) continue;
          const card = batch[j];
          const priceInfo = quote.priceInfo || {};
          const secInfo = quote.securityInfo || {};
          const lastPrice = priceInfo.lastPrice || 0;
          if (lastPrice > 0) card.cmp = lastPrice;
          if (secInfo.issuedSize && lastPrice) {
            card.mcap = parseFloat(((secInfo.issuedSize * lastPrice) / 10000000).toFixed(0));
          }
          const industry = quote.info?.industry || quote.metadata?.industry || '';
          if (industry) {
            card.sector = normalizeSector(industry);
            card.industry = industry;
          }
        }
        if (i + batchSize < needsEnrich.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    // ═══════════════════════════════════════════
    // STEP 5: Index filter
    // ═══════════════════════════════════════════
    let filteredCards = cards;
    if (indexFilter) {
      const fk = indexFilter.toUpperCase().replace(/\s+/g, '');
      filteredCards = cards.filter(c => {
        if (fk === 'MIDCAP') return c.marketCap === 'M';
        if (fk === 'SMALLCAP') return c.marketCap === 'S' || c.marketCap === 'Micro';
        if (fk === 'NIFTY50') return c.marketCap === 'L';
        return true;
      });
    }

    // Sort: by result date desc, then signal score desc
    filteredCards.sort((a, b) => {
      const dateA = new Date(a.resultDate).getTime() || 0;
      const dateB = new Date(b.resultDate).getTime() || 0;
      if (dateB !== dateA) return dateB - dateA;
      return b.signalScore - a.signalScore;
    });

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

    console.log(`[Earnings Cards] Returning ${filteredCards.length} cards (${renderWorked ? 'Render' : 'NSE'} enriched)`);

    return NextResponse.json({
      cards: filteredCards,
      summary,
      dateRange: { from: `${monthStr}-01`, to: `${monthStr}-28` },
      source: renderWorked ? 'NSE + Render Proxy (Live)' : 'NSE India (Live)',
      updatedAt: new Date().toISOString(),
      ...(debug ? {
        debug: true,
        earningsCount: earningsResults.length,
        renderSymbols: Object.keys(financialResultsBySymbol).length,
        nseDirectResults: nseFinancialResults.length,
        enrichedCards: needsEnrich.length,
      } : {}),
    });

  } catch (error) {
    console.error('[Earnings Cards] Error:', error);
    return NextResponse.json({
      cards: [], summary: { total: 0, strong: 0, good: 0, ok: 0, bad: 0, avgScore: 0 },
      error: String(error),
    }, { status: 500 });
  }
}
