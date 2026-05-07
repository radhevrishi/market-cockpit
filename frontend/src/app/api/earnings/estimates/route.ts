import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// FMP consensus / estimates / sell-side sentiment server-side aggregator
// ─────────────────────────────────────────────────────────────────────────────
// Pulls in parallel from FMP and returns ONE consolidated JSON the page can
// build an EarningsSnapshot from. Server-side so we can keep the API key off
// the client, share aggressive caching, and avoid CORS for any FMP redirect.
// ─────────────────────────────────────────────────────────────────────────────

const FMP_KEY = process.env.FMP_KEY || 'SywZSfKoRQ9JmcUZ1w98MT78rrVvHGng';
const FMP = 'https://financialmodelingprep.com/api/v3';
const FMP_V4 = 'https://financialmodelingprep.com/api/v4';

async function safeJson<T = any>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: 3600 }, // 1h ISR cache
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'Missing ticker parameter' }, { status: 400 });
  }
  const t = encodeURIComponent(ticker);

  const [
    estQuarterly,
    estAnnual,
    surpriseHist,
    profile,
    quote,
    rating,
    upgradeDowngrade,
    targetConsensus,
    keyMetricsTtm,
  ] = await Promise.all([
    safeJson<any[]>(`${FMP}/analyst-estimates/${t}?period=quarter&limit=8&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/analyst-estimates/${t}?period=annual&limit=4&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/earnings-surprises/${t}?apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/profile/${t}?apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/quote/${t}?apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP_V4}/grade?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP_V4}/upgrades-downgrades?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP_V4}/price-target-consensus?symbol=${t}&apikey=${FMP_KEY}`),
    safeJson<any[]>(`${FMP}/key-metrics-ttm/${t}?apikey=${FMP_KEY}`),
  ]);

  // ── Next-quarter consensus (the row whose date is in the future) ───────
  const today = Date.now();
  const upcoming = (estQuarterly || []).find((e: any) => {
    const d = new Date(e.date).getTime();
    return !Number.isNaN(d) && d >= today;
  });
  const nextQ = upcoming || (estQuarterly || [])[0] || null;

  // ── Most recent reported quarter from earnings-surprises ───────────────
  const lastReported = (surpriseHist || [])[0] || null;

  // ── Sell-side rating distribution (from /grade endpoint, last 90 days) ─
  type Bucket = { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
  const bucket: Bucket = { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 };
  const cutoff = Date.now() - 90 * 86400000;
  (rating || []).forEach((r: any) => {
    const ts = new Date(r.date || 0).getTime();
    if (ts < cutoff) return;
    const g = String(r.newGrade || '').toLowerCase();
    if (/strong\s*buy|outperform|overweight/.test(g)) bucket.strongBuy++;
    else if (/buy|positive/.test(g)) bucket.buy++;
    else if (/hold|neutral|equal\s*weight|market\s*perform/.test(g)) bucket.hold++;
    else if (/strong\s*sell|underperform|underweight/.test(g)) bucket.strongSell++;
    else if (/sell|negative/.test(g)) bucket.sell++;
  });
  const totalAnalysts =
    bucket.strongBuy + bucket.buy + bucket.hold + bucket.sell + bucket.strongSell;

  // ── Recent up/down-grades count (last 30 days) ─────────────────────────
  const cutoff30 = Date.now() - 30 * 86400000;
  let recentUpgrades = 0;
  let recentDowngrades = 0;
  (upgradeDowngrade || []).forEach((u: any) => {
    const ts = new Date(u.publishedDate || u.date || 0).getTime();
    if (ts < cutoff30) return;
    const action = String(u.action || u.gradeChange || '').toLowerCase();
    if (/upgrad|raise/.test(action)) recentUpgrades++;
    else if (/downgrad|cut|lower/.test(action)) recentDowngrades++;
  });

  const profileObj = (profile || [])[0] || null;
  const quoteObj = (quote || [])[0] || null;
  const targetObj = (targetConsensus || [])[0] || null;
  const ttm = (keyMetricsTtm || [])[0] || null;

  // ── Estimate revisions trajectory (compare current vs prior year same-Q) ─
  // Heuristic: if we have ≥2 quarterly estimates, compare est avg vs older
  let revisionBias: 'up' | 'down' | 'flat' | 'na' = 'na';
  let revisionMagnitudePct: number | null = null;
  if ((estQuarterly || []).length >= 2 && nextQ) {
    const older = estQuarterly!.find(
      (e: any) => new Date(e.date).getTime() < new Date(nextQ.date).getTime() - 60 * 86400000,
    );
    if (older?.estimatedRevenueAvg && nextQ.estimatedRevenueAvg) {
      const olderRev = parseFloat(older.estimatedRevenueAvg);
      const newRev = parseFloat(nextQ.estimatedRevenueAvg);
      if (olderRev > 0) {
        const pct = ((newRev - olderRev) / olderRev) * 100;
        revisionMagnitudePct = Math.round(pct * 100) / 100;
        if (pct > 1) revisionBias = 'up';
        else if (pct < -1) revisionBias = 'down';
        else revisionBias = 'flat';
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ticker,
    source: 'fmp',
    profile: profileObj
      ? {
          companyName: profileObj.companyName,
          sector: profileObj.sector,
          industry: profileObj.industry,
          description: profileObj.description,
          ceo: profileObj.ceo,
          fullTimeEmployees: profileObj.fullTimeEmployees,
          mktCap: profileObj.mktCap,
          enterpriseValue: profileObj.enterpriseValue ?? null,
          beta: profileObj.beta,
          exchange: profileObj.exchangeShortName,
          country: profileObj.country,
          image: profileObj.image,
          ipoDate: profileObj.ipoDate,
        }
      : null,
    quote: quoteObj
      ? {
          price: quoteObj.price,
          change: quoteObj.change,
          changePct: quoteObj.changesPercentage,
          marketCap: quoteObj.marketCap,
          eps: quoteObj.eps,
          pe: quoteObj.pe,
          dayLow: quoteObj.dayLow,
          dayHigh: quoteObj.dayHigh,
          yearLow: quoteObj.yearLow,
          yearHigh: quoteObj.yearHigh,
          volume: quoteObj.volume,
          avgVolume: quoteObj.avgVolume,
          earningsAnnouncement: quoteObj.earningsAnnouncement,
          sharesOutstanding: quoteObj.sharesOutstanding,
        }
      : null,
    consensusNextQ: nextQ
      ? {
          date: nextQ.date,
          revenueAvg: parseFloat(nextQ.estimatedRevenueAvg) || null,
          revenueLow: parseFloat(nextQ.estimatedRevenueLow) || null,
          revenueHigh: parseFloat(nextQ.estimatedRevenueHigh) || null,
          epsAvg: parseFloat(nextQ.estimatedEpsAvg) || null,
          epsLow: parseFloat(nextQ.estimatedEpsLow) || null,
          epsHigh: parseFloat(nextQ.estimatedEpsHigh) || null,
          ebitdaAvg: parseFloat(nextQ.estimatedEbitdaAvg) || null,
          ebitAvg: parseFloat(nextQ.estimatedEbitAvg) || null,
          netIncomeAvg: parseFloat(nextQ.estimatedNetIncomeAvg) || null,
          numAnalysts: parseInt(nextQ.numberAnalystsEstimatedRevenue || nextQ.numberAnalysts) || null,
        }
      : null,
    consensusFY: estAnnual && estAnnual[0]
      ? {
          date: estAnnual[0].date,
          revenueAvg: parseFloat(estAnnual[0].estimatedRevenueAvg) || null,
          epsAvg: parseFloat(estAnnual[0].estimatedEpsAvg) || null,
          ebitdaAvg: parseFloat(estAnnual[0].estimatedEbitdaAvg) || null,
          netIncomeAvg: parseFloat(estAnnual[0].estimatedNetIncomeAvg) || null,
          numAnalysts: parseInt(estAnnual[0].numberAnalystsEstimatedRevenue) || null,
        }
      : null,
    lastReportedSurprise: lastReported
      ? {
          date: lastReported.date,
          actualEps: parseFloat(lastReported.actualEarningResult ?? lastReported.actualEps) || null,
          estimateEps: parseFloat(lastReported.estimatedEarning ?? lastReported.estimatedEps) || null,
          actualRevenue: parseFloat(lastReported.actualRevenue) || null,
          estimateRevenue: parseFloat(lastReported.estimatedRevenue) || null,
        }
      : null,
    surpriseHistory: (surpriseHist || []).slice(0, 12).map((q: any) => ({
      date: q.date,
      actualEps: parseFloat(q.actualEarningResult ?? q.actualEps) || null,
      estimateEps: parseFloat(q.estimatedEarning ?? q.estimatedEps) || null,
      actualRevenue: parseFloat(q.actualRevenue) || null,
      estimateRevenue: parseFloat(q.estimatedRevenue) || null,
    })),
    sellSide: {
      bucket,
      total: totalAnalysts,
      recentUpgrades30d: recentUpgrades,
      recentDowngrades30d: recentDowngrades,
      consensusTargetPrice: targetObj?.targetConsensus ?? null,
      targetHigh: targetObj?.targetHigh ?? null,
      targetLow: targetObj?.targetLow ?? null,
      targetMedian: targetObj?.targetMedian ?? null,
    },
    revisionTrajectory: {
      bias: revisionBias,
      magnitudePct: revisionMagnitudePct,
    },
    ttm: ttm
      ? {
          peRatioTTM: ttm.peRatioTTM,
          pegRatioTTM: ttm.pegRatioTTM,
          pbRatioTTM: ttm.pbRatioTTM,
          enterpriseValueTTM: ttm.enterpriseValueTTM,
          evToOperatingCashFlowTTM: ttm.evToOperatingCashFlowTTM,
          evToFreeCashFlowTTM: ttm.evToFreeCashFlowTTM,
          roeTTM: ttm.roeTTM,
          roicTTM: ttm.roicTTM,
          debtToEquityTTM: ttm.debtToEquityTTM,
          netDebtToEBITDATTM: ttm.netDebtToEBITDATTM,
          freeCashFlowYieldTTM: ttm.freeCashFlowYieldTTM,
          dividendYieldTTM: ttm.dividendYieldTTM,
          payoutRatioTTM: ttm.payoutRatioTTM,
        }
      : null,
  });
}
