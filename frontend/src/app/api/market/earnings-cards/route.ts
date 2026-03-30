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
// EARNINGS CARDS API — Full P&L with YoY/QoQ
// Directly fetches NSE data (no internal API call)
// then enriches with Render proxy for P&L numbers
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

function parseNum(val: any): number {
  if (val === null || val === undefined || val === '' || val === '-') return 0;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : null;
  return parseFloat((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function marginCalc(profit: number, revenue: number): number {
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
  revenueYoY: number | null, patYoY: number | null,
  epsYoY: number | null, opmTrend: number
): { grade: EarningsCard['grade']; color: string; score: number } {
  let score = 50;
  if (revenueYoY !== null) { score += revenueYoY > 15 ? 15 : revenueYoY > 5 ? 8 : revenueYoY > -5 ? 0 : -15; }
  if (patYoY !== null) { score += patYoY > 25 ? 15 : patYoY > 10 ? 8 : patYoY > 0 ? 3 : -15; }
  if (epsYoY !== null) { score += epsYoY > 20 ? 10 : epsYoY > 5 ? 5 : epsYoY > -5 ? 0 : -10; }
  score += opmTrend > 2 ? 10 : opmTrend > -2 ? 0 : -10;
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
  for (const key of Object.keys(data || {})) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key];
  }
  return [];
}

function formatPeriod(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return dateStr || ''; }
}

const MONTH_MAP: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  try {
    const ddMon = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
    if (ddMon) { const m = MONTH_MAP[ddMon[2].toLowerCase()]; if (m !== undefined) return new Date(parseInt(ddMon[3]), m, parseInt(ddMon[1])); }
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
  if (m >= 7 && m <= 9) return `Q1 FY${(y+1).toString().slice(2)}`;
  return `Q2 FY${(y+1).toString().slice(2)}`;
}

function getResultsQuarter(meetingDate: Date, desc: string): string {
  const lower = desc.toLowerCase();
  const match = lower.match(/(?:period|quarter|half year|year)\s+ended\s+(?:on\s+)?(\d{1,2})?[- \/]?([a-z]+|\d{1,2})[- \/,]+(\d{4})/);
  if (match) {
    const mStr = match[2]; const yr = parseInt(match[3]);
    const monthMap: Record<string,number> = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
    let month = monthMap[mStr] || parseInt(mStr);
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
    const fmt = (d: Date) => `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;

    const bmFrom = new Date(fromDate);
    bmFrom.setDate(bmFrom.getDate() - 60);

    console.log(`[Earnings Cards] ${fmt(fromDate)} to ${fmt(toDate)}, expected ${expectedQtr}`);

    // ═══════════════════════════════════════════
    // STEP 1: Parallel fetch all NSE data sources + price data
    // ═══════════════════════════════════════════
    const [
      financialResults,
      latestResults,
      boardMeetings,
      boardMeetingsRange,
      announcements,
      resultsFilings,
      nifty50Data,
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
      fetchNifty500().catch(() => null),
      fetchNiftySmallcap250().catch(() => null),
    ]);

    // ═══════════════════════════════════════════
    // STEP 2: Build price lookup from indices
    // ═══════════════════════════════════════════
    const priceLookup: Record<string, { price: number; change: number; pct: number; volume: number; mcap: number; industry: string; prevClose: number }> = {};

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
    processIdx(nifty500Data);
    processIdx(smallcap250Data);

    // ═══════════════════════════════════════════
    // STEP 3: Identify companies that filed results this month
    // Uses same logic as /api/market/earnings
    // ═══════════════════════════════════════════
    const confirmedTickers = new Map<string, { company: string; date: Date; quarter: string; source: string }>();

    // From financial results API
    for (const fr of [...toArray(financialResults), ...toArray(latestResults)]) {
      const sym = fr.symbol || fr.re_symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const filed = parseDate(fr.re_broadcastDt || fr.broadcastDate || fr.re_date || '');
      if (!filed || filed < fromDate || filed > toDate) continue;
      const period = fr.re_toDate || fr.toDate || fr.re_periodEnded || '';
      confirmedTickers.set(sym, {
        company: fr.re_companyName || fr.companyName || sym,
        date: filed,
        quarter: getResultsQuarter(filed, `period ended ${period}`),
        source: 'financial-results',
      });
    }

    // From results-specific filings
    for (const rf of toArray(resultsFilings)) {
      const sym = rf.symbol || rf.sm_symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const desc = (rf.desc || rf.attchmntText || '').toLowerCase();
      if (!desc.includes('financial result') && !desc.includes('quarterly result')) continue;
      const filed = parseDate(rf.sort_date || rf.an_dt || '');
      if (!filed || filed < fromDate || filed > toDate) continue;
      confirmedTickers.set(sym, {
        company: rf.sm_name || sym,
        date: filed,
        quarter: getResultsQuarter(filed, desc),
        source: 'results-filing',
      });
    }

    // From corporate announcements (Outcome of Board Meeting with financial results)
    for (const ann of (Array.isArray(announcements) ? announcements : toArray(announcements))) {
      const sym = ann.symbol || ann.sm_symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const desc = (ann.desc || '').toLowerCase();
      const att = (ann.attchmntText || '').toLowerCase();
      if (!desc.includes('outcome') || !att.includes('financial result')) continue;
      const filed = parseDate(ann.sort_date || ann.an_dt || '');
      if (!filed || filed < fromDate || filed > toDate) continue;
      confirmedTickers.set(sym, {
        company: ann.sm_name || sym,
        date: filed,
        quarter: getResultsQuarter(filed, att),
        source: 'outcome-announcement',
      });
    }

    // From board meetings (only upcoming or confirmed)
    for (const bm of [...toArray(boardMeetings), ...toArray(boardMeetingsRange)]) {
      const sym = bm.bm_symbol || bm.symbol || '';
      if (!sym || confirmedTickers.has(sym)) continue;
      const purpose = (bm.bm_purpose || bm.purpose || '').toLowerCase();
      if (!purpose.includes('financial result') && !purpose.includes('quarterly result')) continue;
      const meetDate = parseDate(bm.bm_date || bm.date || '');
      if (!meetDate || meetDate < fromDate || meetDate > toDate) continue;
      const desc = bm.bm_desc || bm.desc || '';
      confirmedTickers.set(sym, {
        company: bm.bm_companyName || bm.sm_name || sym,
        date: meetDate,
        quarter: getResultsQuarter(meetDate, desc),
        source: 'board-meeting',
      });
    }

    // Filter to only companies in our price universe (known stocks)
    const knownTickers = new Map<string, { company: string; date: Date; quarter: string; source: string }>();
    for (const [sym, info] of confirmedTickers) {
      if (priceLookup[sym] && priceLookup[sym].price >= 2) {
        knownTickers.set(sym, info);
      }
    }
    console.log(`[Earnings Cards] ${confirmedTickers.size} total → ${knownTickers.size} in price universe`);

    // ═══════════════════════════════════════════
    // STEP 4: Fetch P&L data — per-symbol from NSE + Render proxy
    // ═══════════════════════════════════════════
    const symbols = [...knownTickers.keys()];

    // Strategy A: Render proxy (batch) — fast if warmed up
    let renderResults: Record<string, any[]> = {};
    let renderWorked = false;
    if (symbols.length > 0) {
      try {
        const symbolsStr = symbols.slice(0, 30).join(',');
        const frRes = await fetch(
          `https://mc-pulse-bots.onrender.com/api/nse/financial-results?symbols=${encodeURIComponent(symbolsStr)}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (frRes.ok) {
          const frData = await frRes.json();
          renderResults = frData.results || {};
          renderWorked = Object.keys(renderResults).length > 0;
          console.log(`[Earnings Cards] Render: ${Object.keys(renderResults).length} companies`);
        }
      } catch (e) {
        console.log('[Earnings Cards] Render unavailable:', String(e));
      }
    }

    // Strategy B: Per-symbol NSE financial results (for companies not in Render)
    const needsNSE = symbols.filter(s => !renderResults[s]).slice(0, 20);
    const nsePerSymbol: Record<string, any[]> = {};
    let nseEnriched = 0;

    if (needsNSE.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < needsNSE.length; i += batchSize) {
        const batch = needsNSE.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(sym =>
            nseApiFetch(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(sym)}`, 300000)
              .catch(() => null)
          )
        );
        for (let j = 0; j < batch.length; j++) {
          const data = results[j];
          if (!data) continue;
          const arr = toArray(data);
          if (arr.length > 0) {
            nsePerSymbol[batch[j]] = arr;
            nseEnriched++;
          }
        }
        if (i + batchSize < needsNSE.length) await new Promise(r => setTimeout(r, 200));
      }
      console.log(`[Earnings Cards] NSE per-symbol: ${nseEnriched} companies enriched`);
    }

    // ═══════════════════════════════════════════
    // STEP 5: Build cards
    // ═══════════════════════════════════════════

    const parseFR = (r: any): FinancialQuarter => {
      const rev = parseNum(r.re_revenue || r.revenue || r.totalIncome || r.income || r.re_incomeFromOperations);
      const exp = parseNum(r.re_expenditure || r.expenditure || r.totalExpenditure);
      const op = parseNum(r.re_operProfit || r.operatingProfit || r.re_profitBeforeTax) || (rev > 0 && exp > 0 ? rev - exp : 0);
      const pat = parseNum(r.re_netProfit || r.netProfit || r.re_proLossAftTax || r.proLossAftTax);
      const eps = parseNum(r.re_eps || r.eps || r.re_dilutedEps || r.dilutedEps);
      const toDate = r.re_toDate || r.toDate || r.re_periodEnded || '';
      return {
        revenue: rev, operatingProfit: op,
        opm: marginCalc(op, rev), pat, npm: marginCalc(pat, rev), eps,
        period: formatPeriod(toDate),
      };
    };

    const cards: EarningsCard[] = [];

    for (const [symbol, info] of knownTickers) {
      const stock = priceLookup[symbol];

      // Get financial results from either source
      const frArr = renderResults[symbol] || nsePerSymbol[symbol] || [];
      let current: FinancialQuarter;
      let prevQ: FinancialQuarter | null = null;
      let yoyQ: FinancialQuarter | null = null;
      let reportType = 'Standalone';
      let xbrlLink: string | null = null;

      if (frArr.length > 0) {
        current = parseFR(frArr[0]);
        if (frArr.length > 1) prevQ = parseFR(frArr[1]);
        if (frArr.length > 4) yoyQ = parseFR(frArr[4]);
        else if (frArr.length > 3) yoyQ = parseFR(frArr[3]);
        reportType = (frArr[0].re_xbrl || '').toLowerCase().includes('consol') ? 'Consolidated' : 'Standalone';
        xbrlLink = frArr[0].re_xbrl || null;
      } else {
        // No financial data yet — show card with price data only
        current = { revenue: 0, operatingProfit: 0, opm: 0, pat: 0, npm: 0, eps: 0, period: '' };
      }

      // Calculate growth
      const revenueYoY = yoyQ && yoyQ.revenue > 0 ? pctChange(current.revenue, yoyQ.revenue) : null;
      const revenueQoQ = prevQ && prevQ.revenue > 0 ? pctChange(current.revenue, prevQ.revenue) : null;
      const opProfitYoY = yoyQ && yoyQ.operatingProfit !== 0 ? pctChange(current.operatingProfit, yoyQ.operatingProfit) : null;
      const opProfitQoQ = prevQ && prevQ.operatingProfit !== 0 ? pctChange(current.operatingProfit, prevQ.operatingProfit) : null;
      const patYoY = yoyQ && yoyQ.pat !== 0 ? pctChange(current.pat, yoyQ.pat) : null;
      const patQoQ = prevQ && prevQ.pat !== 0 ? pctChange(current.pat, prevQ.pat) : null;
      const epsYoY = yoyQ && yoyQ.eps !== 0 ? pctChange(current.eps, yoyQ.eps) : null;
      const epsQoQ = prevQ && prevQ.eps !== 0 ? pctChange(current.eps, prevQ.eps) : null;

      const opmTrend = prevQ ? current.opm - prevQ.opm : 0;
      const hasFinData = current.revenue > 0 || current.pat !== 0;
      const { grade, color: gradeColor, score: signalScore } = hasFinData
        ? gradeEarnings(revenueYoY, patYoY, epsYoY, opmTrend)
        : { grade: 'OK' as const, color: '#FFD600', score: 50 };

      const mcapCr = stock ? stock.mcap / 10000000 : null;
      const pe = stock && current.eps > 0
        ? parseFloat((stock.price / (current.eps * 4)).toFixed(1))
        : null;

      const resultDate = info.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

      cards.push({
        symbol, company: info.company, resultDate,
        quarter: info.quarter, reportType,
        current, prevQ, yoyQ,
        revenueYoY, revenueQoQ, opProfitYoY, opProfitQoQ,
        patYoY, patQoQ, epsYoY, epsQoQ,
        mcap: mcapCr ? parseFloat(mcapCr.toFixed(0)) : null,
        pe, cmp: stock?.price || null, priceChange: stock?.pct || null,
        sector: normalizeSector(stock?.industry), industry: stock?.industry || '',
        marketCap: mcapCr ? getCapCategory(mcapCr) : '',
        grade, gradeColor, signalScore,
        resultLink: xbrlLink, xbrlLink,
      });
    }

    // ═══════════════════════════════════════════
    // STEP 6: Enrich cards missing stock data
    // ═══════════════════════════════════════════
    const needsQuote = cards.filter(c => !c.cmp).slice(0, 10);
    for (let i = 0; i < needsQuote.length; i += 5) {
      const batch = needsQuote.slice(i, i + 5);
      const quotes = await Promise.all(batch.map(c => fetchStockQuote(c.symbol).catch(() => null)));
      for (let j = 0; j < batch.length; j++) {
        const q = quotes[j];
        if (!q) continue;
        const c = batch[j];
        const p = q.priceInfo || {};
        const s = q.securityInfo || {};
        if (p.lastPrice) c.cmp = p.lastPrice;
        if (s.issuedSize && p.lastPrice) c.mcap = parseFloat(((s.issuedSize * p.lastPrice) / 10000000).toFixed(0));
        const ind = q.info?.industry || q.metadata?.industry || '';
        if (ind) { c.sector = normalizeSector(ind); c.industry = ind; }
      }
      if (i + 5 < needsQuote.length) await new Promise(r => setTimeout(r, 300));
    }

    // ═══════════════════════════════════════════
    // STEP 7: Filter, sort, respond
    // ═══════════════════════════════════════════
    let filtered = cards;
    if (indexFilter) {
      const fk = indexFilter.toUpperCase().replace(/\s+/g, '');
      filtered = cards.filter(c => {
        if (fk === 'NIFTY50') return c.marketCap === 'L';
        if (fk === 'MIDCAP') return c.marketCap === 'M';
        if (fk === 'SMALLCAP') return c.marketCap === 'S' || c.marketCap === 'Micro';
        return true;
      });
    }

    filtered.sort((a, b) => {
      const da = new Date(a.resultDate).getTime() || 0;
      const db = new Date(b.resultDate).getTime() || 0;
      return db !== da ? db - da : b.signalScore - a.signalScore;
    });

    const summary = {
      total: filtered.length,
      strong: filtered.filter(c => c.grade === 'STRONG').length,
      good: filtered.filter(c => c.grade === 'GOOD').length,
      ok: filtered.filter(c => c.grade === 'OK').length,
      bad: filtered.filter(c => c.grade === 'BAD').length,
      avgScore: filtered.length > 0
        ? parseFloat((filtered.reduce((s, c) => s + c.signalScore, 0) / filtered.length).toFixed(1))
        : 0,
    };

    console.log(`[Earnings Cards] ${filtered.length} cards, ${renderWorked ? 'Render enriched' : 'basic'}`);

    return NextResponse.json({
      cards: filtered, summary,
      dateRange: { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] },
      source: renderWorked ? 'NSE + Render (Live)' : 'NSE India (Live)',
      updatedAt: new Date().toISOString(),
      ...(debug ? {
        debug: true,
        confirmedTickers: confirmedTickers.size,
        knownTickers: knownTickers.size,
        renderSymbols: Object.keys(renderResults).length,
        nsePerSymbolEnriched: nseEnriched,
        priceUniverse: Object.keys(priceLookup).length,
        cardsWithFinData: cards.filter(c => c.current.revenue > 0 || c.current.pat !== 0).length,
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
