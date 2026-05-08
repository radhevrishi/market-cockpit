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

// ─────────────────────────────────────────────────────────────────────────
// EDGAR fallback — pulls 8 quarters of revenue, NI, EBIT, EPS, GP from
// SEC companyfacts when FMP has no coverage (small caps like OSS).
// ─────────────────────────────────────────────────────────────────────────
const EDGAR_HEADERS = {
  'User-Agent': 'Market Cockpit research@market-cockpit.local',
  Accept: 'application/json',
};

async function lookupEdgarCik(ticker: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: EDGAR_HEADERS,
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const u = ticker.toUpperCase();
    const arr = Object.values(json) as Array<{ ticker: string; cik_str: number }>;
    const hit = arr.find((r) => r.ticker?.toUpperCase() === u);
    return hit ? String(hit.cik_str).padStart(10, '0') : null;
  } catch {
    return null;
  }
}

interface EdgarQuarterRow {
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
}

function poolQuarterly(gaap: any, concepts: string[]): EdgarQuarterRow[] {
  const rows: EdgarQuarterRow[] = [];
  for (const c of concepts) {
    const units: any[] = gaap?.[c]?.units?.USD ?? gaap?.[c]?.units?.['USD/shares'] ?? [];
    for (const u of units) {
      if (u.val === undefined || u.val === null) continue;
      if (u.form !== '10-Q' && u.form !== '10-K') continue;
      if (!u.start || !u.end) continue;
      const days = (new Date(u.end).getTime() - new Date(u.start).getTime()) / 86400000;
      if (days < 80 || days > 105) continue; // single-quarter only
      rows.push({ end: u.end, val: u.val, fy: u.fy, fp: u.fp, form: u.form });
    }
  }
  // dedupe by end date — prefer latest filed value
  const byEnd = new Map<string, EdgarQuarterRow>();
  for (const r of rows) {
    const prev = byEnd.get(r.end);
    if (!prev) byEnd.set(r.end, r);
  }
  return Array.from(byEnd.values()).sort(
    (a, b) => new Date(b.end).getTime() - new Date(a.end).getTime(),
  );
}

async function fetchEdgarQuarterlyHistory(ticker: string): Promise<any[] | null> {
  const cik = await lookupEdgarCik(ticker);
  if (!cik) return null;
  let facts: any = null;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: EDGAR_HEADERS,
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    facts = await res.json();
  } catch {
    return null;
  }
  const gaap = facts?.facts?.['us-gaap'] ?? {};
  const revs = poolQuarterly(gaap, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomer',
    'TotalRevenues',
    'OperatingRevenue',
  ]);
  if (revs.length === 0) return null;

  const ebits = poolQuarterly(gaap, ['OperatingIncomeLoss']);
  const nis = poolQuarterly(gaap, ['NetIncomeLoss']);
  const gps = poolQuarterly(gaap, ['GrossProfit']);
  const epss = poolQuarterly(gaap, ['EarningsPerShareBasic', 'EarningsPerShareDiluted']);

  const byEnd = (arr: EdgarQuarterRow[], end: string) =>
    arr.find((r) => r.end === end) || null;

  // Take 8 most recent quarters; compute YoY by looking 4 quarters back.
  const top8 = revs.slice(0, 8);
  const allEnds = revs.map((r) => r.end);

  const findFourQuartersBack = (idx: number): string | null => {
    // Quarter ends are roughly 90 days apart; look for an end ~365 days earlier.
    const target = new Date(top8[idx].end).getTime() - 365 * 86400000;
    let best: string | null = null;
    let bestDelta = Infinity;
    for (const e of allEnds) {
      const delta = Math.abs(new Date(e).getTime() - target);
      if (delta < bestDelta && delta < 45 * 86400000) {
        bestDelta = delta;
        best = e;
      }
    }
    return best;
  };

  const fyQuarter = (end: string, fp?: string): string => {
    if (fp && /^Q[1-4]$/i.test(fp)) {
      const fy = revs.find((r) => r.end === end)?.fy;
      return fy ? `${fp.toUpperCase()} ${fy}` : `${fp.toUpperCase()} ${end.slice(0, 4)}`;
    }
    const d = new Date(end);
    const m = d.getMonth();
    const q = m < 3 ? 'Q1' : m < 6 ? 'Q2' : m < 9 ? 'Q3' : 'Q4';
    return `${q} ${d.getFullYear()}`;
  };

  return top8.map((r, idx) => {
    const yoyEnd = findFourQuartersBack(idx);
    const revYoY = yoyEnd ? byEnd(revs, yoyEnd)?.val ?? null : null;
    const ebitCur = byEnd(ebits, r.end)?.val ?? null;
    const niCur = byEnd(nis, r.end)?.val ?? null;
    const gpCur = byEnd(gps, r.end)?.val ?? null;
    const epsCur = byEnd(epss, r.end)?.val ?? null;
    const ebitdaCur = ebitCur; // fallback approximation

    const margin = (n: number | null) =>
      n !== null && r.val ? Math.round((n / r.val) * 10000) / 100 : null;

    const revSurprise =
      revYoY !== null && revYoY !== 0
        ? Math.round(((r.val - revYoY) / Math.abs(revYoY)) * 10000) / 100
        : null;

    return {
      date: r.end,
      period: fyQuarter(r.end, r.fp),
      calendarYear: r.fy,
      revenue: r.val,
      revenueEstimate: null,
      revenueSurprisePct: null, // no consensus from EDGAR
      yoyRevenuePct: revSurprise,
      grossProfit: gpCur,
      grossMargin: margin(gpCur),
      operatingIncome: ebitCur,
      operatingMargin: margin(ebitCur),
      ebitda: ebitdaCur,
      ebitdaMargin: margin(ebitdaCur),
      netIncome: niCur,
      netMargin: margin(niCur),
      eps: epsCur,
      epsEstimate: null,
      epsSurprisePct: null,
      cfo: null,
      capex: null,
      fcf: null,
      cash: null,
      totalDebt: null,
      equity: null,
      receivables: null,
      inventory: null,
      sbc: null,
    };
  });
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
    // ── EDGAR fallback for small-caps with no FMP coverage ──
    // OSS, micro/small caps, and recent IPOs often have no FMP income data.
    // EDGAR companyfacts has 8+ quarters of revenue/EPS/NI from filed 10-Qs.
    const edgarQuarters = await fetchEdgarQuarterlyHistory(ticker).catch(() => null);
    if (edgarQuarters && edgarQuarters.length >= 2) {
      const revBeats = 0;
      const epsBeats = 0;
      return NextResponse.json({
        ok: true,
        ticker,
        source: 'sec_edgar_xbrl_history',
        quarters: edgarQuarters,
        streak: {
          revenueBeat: revBeats,
          revenueAttempts: 0,
          epsBeat: epsBeats,
          epsAttempts: 0,
          avgRevenueSurprise: null,
          avgEpsSurprise: null,
        },
        notice:
          'FMP had no quarterly history for this ticker — fell back to SEC EDGAR XBRL companyfacts. ' +
          'Surprise % is not available (no consensus to compare against), but the YoY/QoQ trajectory is real.',
      });
    }
    return NextResponse.json({
      ok: false,
      ticker,
      error: `No quarterly income statement available from FMP for ${ticker} (small-cap or thin coverage). EDGAR fallback also returned no data.`,
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
