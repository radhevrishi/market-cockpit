import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// 8-quarter income-statement history (with computed margins) for trend tiles
// ─────────────────────────────────────────────────────────────────────────────

const FMP_KEY = process.env.FMP_KEY || 'SywZSfKoRQ9JmcUZ1w98MT78rrVvHGng';
const FMP = 'https://financialmodelingprep.com/api/v3';

async function safeJson<T = any>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function pct(num: number | null, den: number | null): number | null {
  if (num === null || den === null || !Number.isFinite(num) || !Number.isFinite(den) || den === 0)
    return null;
  return Math.round((num / den) * 10000) / 100;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }
  const t = encodeURIComponent(ticker);

  const [income, cashflow, balance, calendar] = await Promise.all([
    safeJson<any[]>(`${FMP}/income-statement/${t}?period=quarter&limit=12&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/cash-flow-statement/${t}?period=quarter&limit=12&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/balance-sheet-statement/${t}?period=quarter&limit=12&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/historical/earning_calendar/${t}?apikey=${FMP_KEY}`),
  ]);

  // ── Index calendar entries by reporting quarter ────────────────────────
  const calByDate = new Map<string, any>();
  (calendar || []).forEach((c: any) => {
    if (c.date) calByDate.set(c.date, c);
    if (c.fiscalDateEnding) calByDate.set(c.fiscalDateEnding, c);
  });

  // ── Index cashflow / balance sheet by date ─────────────────────────────
  const cfByDate = new Map<string, any>();
  (cashflow || []).forEach((c: any) => c.date && cfByDate.set(c.date, c));
  const bsByDate = new Map<string, any>();
  (balance || []).forEach((b: any) => b.date && bsByDate.set(b.date, b));

  // Build last 8 quarters with computed margins + matched estimates
  const quarters = (income || []).slice(0, 8).map((row: any) => {
    const date = row.date;
    const cf = cfByDate.get(date) || {};
    const bs = bsByDate.get(date) || {};
    const cal = calByDate.get(date) || calByDate.get(row.fillingDate) || {};

    const revenue = parseFloat(row.revenue) || null;
    const grossProfit = parseFloat(row.grossProfit) || null;
    const opIncome = parseFloat(row.operatingIncome) || null;
    const ebitda = parseFloat(row.ebitda) || null;
    const netIncome = parseFloat(row.netIncome) || null;
    const cfo = parseFloat(cf.operatingCashFlow ?? cf.netCashProvidedByOperatingActivities) || null;
    const capex = parseFloat(cf.capitalExpenditure) || null;
    const fcf =
      cfo !== null && capex !== null ? Math.round((cfo - Math.abs(capex)) * 100) / 100 : null;

    const calEstRev = parseFloat(cal.estimatedRevenue) || null;
    const calEstEps = parseFloat(cal.estimatedEarning ?? cal.epsEstimated) || null;
    const calActRev = parseFloat(cal.actualRevenue) || revenue;
    const calActEps = parseFloat(cal.actualEarningResult ?? cal.eps) || parseFloat(row.eps) || null;

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
      period: row.period,
      calendarYear: row.calendarYear,
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
      eps: parseFloat(row.eps) || null,
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

  // ── Beat streak summary (last 8Q where estimate available) ─────────────
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
      ? Math.round((quarters.reduce((s, q) => s + (q.epsSurprisePct ?? 0), 0) / epsWithEst) * 100) /
        100
      : null;

  return NextResponse.json({
    ok: true,
    ticker,
    source: 'fmp_history',
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
