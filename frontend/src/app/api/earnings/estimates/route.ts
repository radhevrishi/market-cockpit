import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// FMP consensus / sell-side server-side aggregator (NEW /stable/ API)
// ─────────────────────────────────────────────────────────────────────────────
// FMP deprecated all /api/v3/ legacy endpoints on Aug 31, 2025. This route
// uses the new /stable/?symbol=X query-param API.
//
// Free-tier coverage map:
//   ALWAYS works (any ticker):
//     /stable/profile, /stable/quote, /stable/income-statement,
//     /stable/balance-sheet-statement, /stable/cash-flow-statement,
//     /stable/key-metrics-ttm, /stable/analyst-estimates?period=annual
//   Works for liquid names:
//     /stable/earnings (limit ≤5), /stable/price-target-summary,
//     /stable/grades, /stable/earnings-surprises
//   Premium-only:
//     /stable/analyst-estimates?period=quarter,
//     /stable/earnings?limit>5, /stable/ratings-historical?limit>1
// ─────────────────────────────────────────────────────────────────────────────

const FMP_KEY = process.env.FMP_KEY || 'SywZSfKoRQ9JmcUZ1w98MT78rrVvHGng';
const STABLE = 'https://financialmodelingprep.com/stable';

async function safeJson<T = any>(url: string, timeoutMs = 8000): Promise<{ data: T | null; ok: boolean; reason?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { data: null, ok: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    // FMP returns "Premium Query Parameter:" or "Error Message" as plain text/JSON
    if (text.startsWith('Premium') || text.includes('"Error Message"')) {
      return { data: null, ok: false, reason: 'premium_or_error' };
    }
    try {
      const parsed = JSON.parse(text);
      return { data: parsed as T, ok: true };
    } catch {
      return { data: null, ok: false, reason: 'parse_error' };
    }
  } catch (err: any) {
    return { data: null, ok: false, reason: err?.message || 'network_error' };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }
  const t = encodeURIComponent(ticker);

  const debug: { hit: string[]; failed: { endpoint: string; reason: string }[] } = { hit: [], failed: [] };

  // Issue all calls in parallel
  const [
    profileRes,
    quoteRes,
    earningsRes,           // limit=5: gives next-Q estimate + last 4 surprises
    estAnnualRes,          // annual estimates (free tier)
    targetRes,             // price target summary (sometimes premium for small caps)
    gradesRes,             // analyst ratings actions
    keyMetricsRes,         // TTM ratios
    surprisesRes,          // historical surprises (alt endpoint)
  ] = await Promise.all([
    safeJson<any[]>(`${STABLE}/profile?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/quote?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/earnings?symbol=${t}&limit=5&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/analyst-estimates?symbol=${t}&period=annual&limit=4&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/price-target-summary?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/grades?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/key-metrics-ttm?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${STABLE}/earnings-surprises?symbol=${t}&apikey=${FMP_KEY}`),
  ]);

  const track = (name: string, r: { ok: boolean; reason?: string }) => {
    if (r.ok) debug.hit.push(name);
    else debug.failed.push({ endpoint: name, reason: r.reason || 'unknown' });
  };
  track('profile', profileRes);
  track('quote', quoteRes);
  track('earnings', earningsRes);
  track('analyst-estimates-annual', estAnnualRes);
  track('price-target-summary', targetRes);
  track('grades', gradesRes);
  track('key-metrics-ttm', keyMetricsRes);
  track('earnings-surprises', surprisesRes);

  const profileObj = (profileRes.data || [])[0] || null;
  const quoteObj = (quoteRes.data || [])[0] || null;
  const targetObj = (targetRes.data || [])[0] || null;
  const ttm = (keyMetricsRes.data || [])[0] || null;

  // ── Earnings array: [next, last_reported, ...older] ────────────────────
  const earningsArr = earningsRes.data || [];
  // First row whose actual is null AND date is in the future = next-Q estimate
  const today = Date.now();
  const upcoming = earningsArr.find((e: any) =>
    (e.epsActual === null || e.revenueActual === null) &&
    new Date(e.date).getTime() >= today - 7 * 86400000,
  );
  const lastReported = earningsArr.find((e: any) =>
    e.epsActual !== null && e.revenueActual !== null,
  );

  // ── Annual estimates (free tier) ───────────────────────────────────────
  const estFY = (estAnnualRes.data || [])[0] || null;
  // Build a quarterly-ish "next" estimate by dividing FY by 4 (rough proxy)
  // We prefer the upcoming-quarter from /earnings when available; fall back to
  // FY/4 when only annual estimates exist.
  const fyToQ = (fy: any) =>
    fy
      ? {
          revenueAvg: fy.revenueAvg ? Math.round(fy.revenueAvg / 4) : null,
          epsAvg: fy.epsAvg ? Math.round((fy.epsAvg / 4) * 100) / 100 : null,
          ebitdaAvg: fy.ebitdaAvg ? Math.round(fy.ebitdaAvg / 4) : null,
          ebitAvg: fy.ebitAvg ? Math.round(fy.ebitAvg / 4) : null,
          netIncomeAvg: fy.netIncomeAvg ? Math.round(fy.netIncomeAvg / 4) : null,
          numAnalysts: fy.numAnalystsRevenue || fy.numberAnalystsEstimatedRevenue || null,
        }
      : null;

  let consensusNextQ: any = null;
  if (upcoming) {
    consensusNextQ = {
      date: upcoming.date,
      revenueAvg: upcoming.revenueEstimated || null,
      revenueLow: null,
      revenueHigh: null,
      epsAvg: upcoming.epsEstimated || null,
      epsLow: null,
      epsHigh: null,
      ebitdaAvg: null,
      ebitAvg: null,
      netIncomeAvg: null,
      numAnalysts: null,
    };
  } else if (estFY) {
    consensusNextQ = { date: estFY.date, ...(fyToQ(estFY) || {}), revenueLow: null, revenueHigh: null, epsLow: null, epsHigh: null };
  }

  // ── Last reported surprise ─────────────────────────────────────────────
  let lastReportedSurprise: any = null;
  if (lastReported) {
    lastReportedSurprise = {
      date: lastReported.date,
      actualEps: lastReported.epsActual,
      estimateEps: lastReported.epsEstimated,
      actualRevenue: lastReported.revenueActual,
      estimateRevenue: lastReported.revenueEstimated,
    };
  }

  // ── Surprise history — combine /earnings + /earnings-surprises ─────────
  const histFromEarnings = (earningsRes.data || [])
    .filter((e: any) => e.epsActual !== null)
    .slice(0, 8)
    .map((e: any) => ({
      date: e.date,
      actualEps: e.epsActual,
      estimateEps: e.epsEstimated,
      actualRevenue: e.revenueActual,
      estimateRevenue: e.revenueEstimated,
    }));
  const histFromSurprises = (surprisesRes.data || [])
    .slice(0, 8)
    .map((s: any) => ({
      date: s.date,
      actualEps: s.epsActual ?? null,
      estimateEps: s.epsEstimated ?? null,
      actualRevenue: null,
      estimateRevenue: null,
    }));
  const surpriseHistory = histFromEarnings.length > 0 ? histFromEarnings : histFromSurprises;

  // ── Sell-side: bucket /grades by action+grade ─────────────────────────
  type Bucket = { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
  const bucket: Bucket = { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 };
  const cutoff = Date.now() - 90 * 86400000;
  let recentUpgrades30d = 0;
  let recentDowngrades30d = 0;
  const cutoff30 = Date.now() - 30 * 86400000;

  (gradesRes.data || []).forEach((r: any) => {
    const ts = new Date(r.date || 0).getTime();
    if (ts < cutoff) return;
    const grade = String(r.newGrade || '').toLowerCase();
    if (/strong\s*buy|outperform|overweight/.test(grade)) bucket.strongBuy++;
    else if (/buy|positive/.test(grade)) bucket.buy++;
    else if (/hold|neutral|equal\s*weight|market\s*perform/.test(grade)) bucket.hold++;
    else if (/strong\s*sell|underperform|underweight/.test(grade)) bucket.strongSell++;
    else if (/sell|negative/.test(grade)) bucket.sell++;

    if (ts >= cutoff30) {
      const action = String(r.action || '').toLowerCase();
      if (/upgrade|raise/.test(action)) recentUpgrades30d++;
      else if (/downgrade|lower|cut/.test(action)) recentDowngrades30d++;
    }
  });
  const total = bucket.strongBuy + bucket.buy + bucket.hold + bucket.sell + bucket.strongSell;

  // ── Target price: prefer summary, fallback to grades' priceTarget if present ─
  let consensusTargetPrice: number | null = null;
  let targetHigh: number | null = null;
  let targetLow: number | null = null;
  let targetMedian: number | null = null;
  if (targetObj) {
    consensusTargetPrice = targetObj.lastQuarterAvgPriceTarget || targetObj.lastYearAvgPriceTarget || null;
    targetHigh = targetObj.targetHigh ?? null;
    targetLow = targetObj.targetLow ?? null;
    targetMedian = targetObj.targetMedian ?? null;
  }

  // ── Revision trajectory ────────────────────────────────────────────────
  let revisionBias: 'up' | 'down' | 'flat' | 'na' = 'na';
  let revisionMagnitudePct: number | null = null;
  const annualEsts = estAnnualRes.data || [];
  if (annualEsts.length >= 2) {
    const cur = annualEsts[0]?.revenueAvg;
    const prev = annualEsts[1]?.revenueAvg;
    if (cur && prev && prev > 0) {
      const pct = ((cur - prev) / prev) * 100;
      revisionMagnitudePct = Math.round(pct * 100) / 100;
      if (pct > 1) revisionBias = 'up';
      else if (pct < -1) revisionBias = 'down';
      else revisionBias = 'flat';
    }
  }

  return NextResponse.json({
    ok: true,
    ticker,
    source: 'fmp_stable',
    profile: profileObj
      ? {
          companyName: profileObj.companyName,
          sector: profileObj.sector,
          industry: profileObj.industry,
          description: profileObj.description, // ← CRITICAL for theme engine
          ceo: profileObj.ceo,
          fullTimeEmployees: profileObj.fullTimeEmployees,
          mktCap: profileObj.marketCap, // new API uses marketCap not mktCap
          enterpriseValue: null,
          beta: profileObj.beta,
          exchange: profileObj.exchange,
          country: profileObj.country,
          ipoDate: profileObj.ipoDate,
        }
      : null,
    quote: quoteObj
      ? {
          price: quoteObj.price,
          change: quoteObj.change,
          changePct: quoteObj.changePercentage,
          marketCap: quoteObj.marketCap,
          eps: quoteObj.eps,
          pe: quoteObj.pe,
          dayLow: quoteObj.dayLow,
          dayHigh: quoteObj.dayHigh,
          yearLow: quoteObj.yearLow,
          yearHigh: quoteObj.yearHigh,
          volume: quoteObj.volume,
          avgVolume: quoteObj.priceAvg50 ? null : null,
          earningsAnnouncement: quoteObj.earningsAnnouncement,
          sharesOutstanding: quoteObj.sharesOutstanding,
        }
      : null,
    consensusNextQ,
    consensusFY: estFY
      ? {
          date: estFY.date,
          revenueAvg: estFY.revenueAvg || null,
          epsAvg: estFY.epsAvg || null,
          ebitdaAvg: estFY.ebitdaAvg || null,
          netIncomeAvg: estFY.netIncomeAvg || null,
          numAnalysts: estFY.numAnalystsRevenue || null,
        }
      : null,
    lastReportedSurprise,
    surpriseHistory,
    sellSide: {
      bucket,
      total,
      recentUpgrades30d,
      recentDowngrades30d,
      consensusTargetPrice,
      targetHigh,
      targetLow,
      targetMedian,
    },
    revisionTrajectory: {
      bias: revisionBias,
      magnitudePct: revisionMagnitudePct,
    },
    ttm: ttm
      ? {
          peRatioTTM: ttm.peRatioTTM ?? null,
          pbRatioTTM: ttm.priceToBookRatioTTM ?? null,
          enterpriseValueTTM: ttm.enterpriseValueTTM ?? null,
          evToOperatingCashFlowTTM: ttm.evToOperatingCashFlowTTM ?? null,
          evToFreeCashFlowTTM: ttm.evToFreeCashFlowTTM ?? null,
          evToEBITDATTM: ttm.evToEBITDATTM ?? null,
          roeTTM: ttm.returnOnEquityTTM ?? null,
          roicTTM: ttm.returnOnCapitalEmployedTTM ?? null,
          debtToEquityTTM: ttm.debtToEquityTTM ?? null,
          netDebtToEBITDATTM: ttm.netDebtToEBITDATTM ?? null,
          freeCashFlowYieldTTM: ttm.freeCashFlowYieldTTM ?? null,
          dividendYieldTTM: ttm.dividendYieldTTM ?? null,
          payoutRatioTTM: ttm.payoutRatioTTM ?? null,
        }
      : null,
    debug,
  });
}
