import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// 8-quarter income-statement history (NEW /stable/ FMP API)
// ─────────────────────────────────────────────────────────────────────────────
// Free-tier limit: max 5 quarters per call. So we cap at 5Q, not 8Q.
// Pairs each row with /stable/earnings to get actual+estimate revenue/EPS.
// ─────────────────────────────────────────────────────────────────────────────

const FMP_KEY = process.env.FMP_KEY || 'SywZSfKoRQ9JmcUZ1w98MT78rrVvHGng';
const STABLE = 'https://financialmodelingprep.com/stable';

async function safeJson<T = any>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.startsWith('Premium') || text.includes('"Error Message"')) return null;
    try { return JSON.parse(text) as T; } catch { return null; }
  } catch {
    return null;
  }
}

function pct(num: number | null, den: number | null): number | null {
  if (num === null || den === null || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 10000) / 100;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }
  const t = encodeURIComponent(ticker);

  const [income, cashflow, balance, earnings, surprises] = await Promise.all([
    safeJson<any[]>(`${STABLE}/income-statement?symbol=${t}&period=quarter&limit=5&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/cash-flow-statement?symbol=${t}&period=quarter&limit=5&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/balance-sheet-statement?symbol=${t}&period=quarter&limit=5&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/earnings?symbol=${t}&limit=5&apikey=${FMP_KEY}`),
    // /earnings-surprises is the canonical "actual vs consensus" feed.
    // For some tickers (Tesla being the obvious example) /stable/earnings
    // returns GAAP basic EPS while /stable/earnings-surprises returns the
    // non-GAAP figure consensus is built around — pulling both lets us
    // prefer the consensus-comparable value so the trend table matches the
    // scorecard's headline EPS.
    safeJson<any[]>(`${STABLE}/earnings-surprises?symbol=${t}&apikey=${FMP_KEY}`),
  ]);

  if (!income || income.length === 0) {
    return NextResponse.json({
      ok: false,
      ticker,
      error: `No quarterly income statement available from FMP for ${ticker} (small-cap or thin coverage)`,
      reason: income === null ? 'endpoint_blocked_or_premium' : 'empty_response',
    }, { status: 404 });
  }

  const cfByDate = new Map<string, any>();
  (cashflow || []).forEach((c: any) => c.date && cfByDate.set(c.date, c));
  const bsByDate = new Map<string, any>();
  (balance || []).forEach((b: any) => b.date && bsByDate.set(b.date, b));
  const earnByDate = new Map<string, any>();
  (earnings || []).forEach((e: any) => e.date && earnByDate.set(e.date, e));
  const surpByDate = new Map<string, any>();
  (surprises || []).forEach((s: any) => s.date && surpByDate.set(s.date, s));

  const quarters = income.slice(0, 5).map((row: any) => {
    const date = row.date;
    const cf = cfByDate.get(date) || {};
    const bs = bsByDate.get(date) || {};
    // Earnings rows are dated by REPORT date, not period-end. Match nearest.
    let earnRow: any = earnByDate.get(date);
    if (!earnRow && earnings) {
      // Find the earnings row whose date is within ±60 days of period end
      const targetTs = new Date(date).getTime();
      earnRow = earnings.find((e: any) => {
        const dt = new Date(e.date).getTime();
        return !isNaN(dt) && Math.abs(dt - targetTs) < 60 * 86400000;
      });
    }

    const revenue = parseFloat(row.revenue) || null;
    const grossProfit = parseFloat(row.grossProfit) || null;
    const opIncome = parseFloat(row.operatingIncome) || null;
    const ebitda = parseFloat(row.ebitda) || null;
    const netIncome = parseFloat(row.netIncome) || null;
    const cfo = parseFloat(cf.operatingCashFlow ?? cf.netCashProvidedByOperatingActivities) || null;
    const capex = parseFloat(cf.capitalExpenditure) || null;
    const fcf = cfo !== null && capex !== null ? Math.round((cfo - Math.abs(capex)) * 100) / 100 : null;

    // Match a /earnings-surprises row by date or the nearest report (±60d)
    let surpRow: any = surpByDate.get(date);
    if (!surpRow && surprises) {
      const targetTs = new Date(date).getTime();
      surpRow = surprises.find((s: any) => {
        const dt = new Date(s.date).getTime();
        return !isNaN(dt) && Math.abs(dt - targetTs) < 60 * 86400000;
      });
    }

    const calEstRev = surpRow?.revenueEstimated ?? earnRow?.revenueEstimated ?? null;
    // Prefer earnings-surprises actuals — same convention as the scorecard's
    // lastReportedSurprise, ensuring trend EPS matches the headline scorecard.
    const calEstEps = surpRow?.epsEstimated ?? earnRow?.epsEstimated ?? null;
    const calActRev = surpRow?.revenueActual ?? earnRow?.revenueActual ?? revenue;
    const calActEps = surpRow?.epsActual ?? earnRow?.epsActual ?? parseFloat(row.eps) ?? null;

    const revSurprisePct =
      calActRev !== null && calEstRev !== null && calEstRev > 0
        ? Math.round(((calActRev - calEstRev) / calEstRev) * 10000) / 100
        : null;
    const epsSurprisePct =
      calActEps !== null && calEstEps !== null && calEstEps !== 0
        ? Math.round(((calActEps - calEstEps) / Math.abs(calEstEps)) * 10000) / 100
        : null;

    return {
      date,
      period: row.period || row.fiscalYear ? `${row.period} ${row.fiscalYear}` : row.date,
      calendarYear: row.fiscalYear,
      revenue,
      revenueEstimate: calEstRev,
      revenueSurprisePct: revSurprisePct,
      grossProfit,
      grossMargin: pct(grossProfit, revenue),
      operatingIncome: opIncome,
      operatingMargin: pct(opIncome, revenue),
      ebitda,
      ebitdaMargin: pct(ebitda, revenue),
      netIncome,
      netMargin: pct(netIncome, revenue),
      // Use calActEps (consensus-comparable, prefers /earnings-surprises)
      // instead of raw income-statement EPS so the trend column matches the
      // headline scorecard EPS.
      eps: calActEps,
      epsEstimate: calEstEps,
      epsSurprisePct,
      cfo,
      capex,
      fcf,
      cash: parseFloat(bs.cashAndCashEquivalents) || null,
      totalDebt: parseFloat(bs.totalDebt) || null,
      equity: parseFloat(bs.totalStockholdersEquity ?? bs.totalEquity) || null,
      receivables: parseFloat(bs.netReceivables) || null,
      inventory: parseFloat(bs.inventory) || null,
      sbc: parseFloat(cf.stockBasedCompensation) || null,
    };
  });

  const revBeats = quarters.filter((q) => q.revenueSurprisePct !== null && q.revenueSurprisePct > 0).length;
  const revWithEst = quarters.filter((q) => q.revenueSurprisePct !== null).length;
  const epsBeats = quarters.filter((q) => q.epsSurprisePct !== null && q.epsSurprisePct > 0).length;
  const epsWithEst = quarters.filter((q) => q.epsSurprisePct !== null).length;
  const avgRevSurprise =
    revWithEst > 0
      ? Math.round(
          (quarters.reduce((s, q) => s + (q.revenueSurprisePct ?? 0), 0) / revWithEst) * 100,
        ) / 100
      : null;
  const avgEpsSurprise =
    epsWithEst > 0
      ? Math.round((quarters.reduce((s, q) => s + (q.epsSurprisePct ?? 0), 0) / epsWithEst) * 100) / 100
      : null;

  return NextResponse.json({
    ok: true,
    ticker,
    source: 'fmp_stable_history',
    quarters,
    streak: {
      revenueBeat: revBeats,
      revenueAttempts: revWithEst,
      epsBeat: epsBeats,
      epsAttempts: epsWithEst,
      avgRevenueSurprise: avgRevSurprise,
      avgEpsSurprise: avgEpsSurprise,
    },
  });
}
