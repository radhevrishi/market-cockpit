// ─────────────────────────────────────────────────────────────────────────────
// Snapshot assembler — combines financials + FMP estimates + 8Q history into a
// single deterministic EarningsSnapshot. The institutional UI renders ONLY from
// this object (no ad-hoc inference).
// ─────────────────────────────────────────────────────────────────────────────

import {
  EarningsSnapshot,
  buildMetric,
  classifySurprisePct,
} from './snapshot';
import { detectThemes, classifyMgmtTone } from './themes';
import {
  computeReactionScore,
  computeAccountingQuality,
  computeNarrativeScore,
  computeJatScore,
  computeReactionProbability,
  JatSignal,
} from './scoring';

// Subset of RawFinancials we actually need (keeps this lib decoupled from the page)
export interface FinancialsInput {
  company: string;
  ticker: string;
  period: string;
  filingType: string;
  currency: 'USD' | 'INR' | 'EUR' | 'unknown';
  scaleLabel: string;
  scaleFactor: number; // e.g. 1e-6 for $→Mn
  revenue: number | null;
  revPrior: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  ebit: number | null;
  ebitMargin: number | null;
  ebitda: number | null;
  ebitdaMargin: number | null;
  pat: number | null;
  patPrior: number | null;
  patMargin: number | null;
  eps: number | null;
  epsPrior: number | null;
  cfo: number | null;
  fcf: number | null;
  cash: number | null;
  totalDebt: number | null;
  netDebt: number | null;
  equity: number | null;
  themes: string[];
  validationWarnings: string[];
  revenueSource: string;
}

export interface EstimatesInput {
  ok?: boolean;
  profile?: any;
  quote?: any;
  consensusNextQ?: {
    revenueAvg: number | null;
    epsAvg: number | null;
    ebitdaAvg: number | null;
    netIncomeAvg: number | null;
    numAnalysts: number | null;
  } | null;
  lastReportedSurprise?: {
    actualEps: number | null;
    estimateEps: number | null;
    actualRevenue: number | null;
    estimateRevenue: number | null;
  } | null;
  surpriseHistory?: Array<{
    date: string;
    actualEps: number | null;
    estimateEps: number | null;
    actualRevenue: number | null;
    estimateRevenue: number | null;
  }>;
  sellSide?: {
    bucket: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
    total: number;
    recentUpgrades30d: number;
    recentDowngrades30d: number;
    consensusTargetPrice: number | null;
    targetHigh: number | null;
    targetLow: number | null;
  } | null;
  revisionTrajectory?: { bias: 'up' | 'down' | 'flat' | 'na'; magnitudePct: number | null };
  ttm?: any;
}

export interface HistoryInput {
  ok?: boolean;
  quarters?: Array<{
    date: string;
    period: string;
    revenue: number | null;
    revenueEstimate: number | null;
    revenueSurprisePct: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    ebitdaMargin: number | null;
    netMargin: number | null;
    eps: number | null;
    epsEstimate: number | null;
    epsSurprisePct: number | null;
    fcf: number | null;
    receivables: number | null;
    inventory: number | null;
    sbc: number | null;
  }>;
  streak?: {
    revenueBeat: number;
    revenueAttempts: number;
    epsBeat: number;
    epsAttempts: number;
    avgRevenueSurprise: number | null;
    avgEpsSurprise: number | null;
  };
}

export function buildSnapshot(
  fin: FinancialsInput,
  estimates: EstimatesInput | null,
  history: HistoryInput | null,
  rawText: string = '',
): EarningsSnapshot {
  // ── Pull raw consensus values (may be in absolute currency from FMP) ───
  // FMP reports revenue/EBITDA in absolute units; we display in Mn.
  // fin.scaleFactor is e.g. 1e-6 for USD raw → $ Mn display.
  // Revenue est from consensusNextQ is absolute USD → multiply by scaleFactor.
  const sf = fin.scaleFactor || 1e-6;

  const consNext = estimates?.consensusNextQ || null;
  const lastSurp = estimates?.lastReportedSurprise || null;

  // Use last reported surprise as the "actual quarter" reference (since it's
  // already paired with consensus). Fall back to consensusNextQ's revenueAvg for
  // estimates. Only apply scale conversion when needed.
  // Reasoning: lastReportedSurprise.actualRevenue is in absolute currency, same as
  // FMP raw values. Convert to display units via sf.
  const lastRevEst = lastSurp?.estimateRevenue !== null && lastSurp?.estimateRevenue !== undefined
    ? Math.round(lastSurp.estimateRevenue * sf * 100) / 100
    : null;
  const lastEpsEst = lastSurp?.estimateEps ?? null;
  const lastRevAct = lastSurp?.actualRevenue !== null && lastSurp?.actualRevenue !== undefined
    ? Math.round(lastSurp.actualRevenue * sf * 100) / 100
    : null;
  const lastEpsAct = lastSurp?.actualEps ?? null;

  // Prefer parsed financials revenue (XBRL-deterministic) over FMP actualRevenue
  // but use FMP estimateRevenue when our parsed financials lack one.
  const revenueActual = fin.revenue;
  const revenueEstimate = lastRevEst ?? (consNext?.revenueAvg !== null && consNext?.revenueAvg !== undefined ? Math.round(consNext.revenueAvg * sf * 100) / 100 : null);
  const epsActual = fin.eps !== null ? fin.eps : lastEpsAct;
  const epsEstimate = lastEpsEst ?? consNext?.epsAvg ?? null;

  const grossMarginActual = fin.grossMargin;
  const opMarginActual = fin.ebitMargin;
  const ebitdaMarginActual = fin.ebitdaMargin;

  // Estimate gross/op/ebitda margins from absolute estimate components when we have them
  const ebitdaEst = consNext?.ebitdaAvg !== null && consNext?.ebitdaAvg !== undefined
    ? Math.round(consNext.ebitdaAvg * sf * 100) / 100
    : null;
  const netIncomeEst = consNext?.netIncomeAvg !== null && consNext?.netIncomeAvg !== undefined
    ? Math.round(consNext.netIncomeAvg * sf * 100) / 100
    : null;
  const ebitdaMarginEst = ebitdaEst !== null && revenueEstimate !== null && revenueEstimate > 0
    ? Math.round((ebitdaEst / revenueEstimate) * 10000) / 100
    : null;

  // QoQ from history (q[0] is most recent already-reported quarter)
  const histQ = (history?.quarters || []).slice();
  const qoq = histQ[1] || null; // last reported quarter from FMP, prev quarter
  const qoqRev = qoq?.revenue !== null && qoq?.revenue !== undefined ? Math.round(qoq.revenue * sf * 100) / 100 : null;
  const qoqGm = qoq?.grossMargin ?? null;
  const qoqEbitdaM = qoq?.ebitdaMargin ?? null;
  const qoqOpM = qoq?.operatingMargin ?? null;
  const qoqEps = qoq?.eps ?? null;
  const qoqFcf = qoq?.fcf !== null && qoq?.fcf !== undefined ? Math.round(qoq.fcf * sf * 100) / 100 : null;

  // ── Build the 8 metric lines ───────────────────────────────────────────
  const metrics = {
    revenue: buildMetric({
      metric: 'Revenue',
      unit: 'currency',
      actual: revenueActual,
      estimate: revenueEstimate,
      prior: fin.revPrior,
      qoqPrior: qoqRev,
    }),
    eps: buildMetric({
      metric: 'EPS',
      unit: 'count',
      actual: epsActual,
      estimate: epsEstimate,
      prior: fin.epsPrior,
      qoqPrior: qoqEps,
    }),
    ebitda: buildMetric({
      metric: 'EBITDA',
      unit: 'currency',
      actual: fin.ebitda,
      estimate: ebitdaEst,
      prior: null,
      qoqPrior: null,
    }),
    grossMargin: buildMetric({
      metric: 'Gross Margin',
      unit: 'percent',
      actual: grossMarginActual,
      estimate: null,
      prior: null,
      qoqPrior: qoqGm,
    }),
    ebitdaMargin: buildMetric({
      metric: 'EBITDA Margin',
      unit: 'percent',
      actual: ebitdaMarginActual,
      estimate: ebitdaMarginEst,
      prior: null,
      qoqPrior: qoqEbitdaM,
    }),
    operatingMargin: buildMetric({
      metric: 'Operating Margin',
      unit: 'percent',
      actual: opMarginActual,
      estimate: null,
      prior: null,
      qoqPrior: qoqOpM,
    }),
    netIncome: buildMetric({
      metric: 'Net Income',
      unit: 'currency',
      actual: fin.pat,
      estimate: netIncomeEst,
      prior: fin.patPrior,
      qoqPrior: null,
    }),
    fcf: buildMetric({
      metric: 'Free Cash Flow',
      unit: 'currency',
      actual: fin.fcf,
      estimate: null,
      prior: null,
      qoqPrior: qoqFcf,
    }),
  };

  // ── Themes & tone (from any text we have) ──────────────────────────────
  const textCorpus = [
    fin.company,
    estimates?.profile?.description || '',
    estimates?.profile?.industry || '',
    estimates?.profile?.sector || '',
    rawText,
    (fin.themes || []).join(' '),
  ].join(' ');
  const themes = detectThemes(textCorpus);
  const toneRes = classifyMgmtTone(rawText || '');

  // ── Guidance — placeholder unless rawText contains explicit guide language ─
  const guidance = inferGuidance(rawText);

  // ── Accounting quality inputs ──────────────────────────────────────────
  const cfoOverPat =
    fin.cfo !== null && fin.pat !== null && fin.pat !== 0
      ? Math.round((fin.cfo / fin.pat) * 100) / 100
      : null;

  // AR & inventory growth vs revenue: compare Q[0] vs Q[3] from history (4Q YoY)
  const q0 = histQ[0] || null;
  const q3 = histQ[3] || null;
  const arGrowthPp =
    q0?.receivables && q3?.receivables && q0?.revenue && q3?.revenue
      ? Math.round(
          (((q0.receivables - q3.receivables) / Math.abs(q3.receivables)) * 100 -
            ((q0.revenue - q3.revenue) / Math.abs(q3.revenue)) * 100) *
            10,
        ) / 10
      : null;
  const invGrowthPp =
    q0?.inventory && q3?.inventory && q0?.revenue && q3?.revenue
      ? Math.round(
          (((q0.inventory - q3.inventory) / Math.abs(q3.inventory)) * 100 -
            ((q0.revenue - q3.revenue) / Math.abs(q3.revenue)) * 100) *
            10,
        ) / 10
      : null;
  const sbcIntensity =
    q0?.sbc && q0?.revenue && q0.revenue > 0 ? Math.round((q0.sbc / q0.revenue) * 1000) / 1000 : null;

  const debtToEbitda =
    fin.netDebt !== null && fin.ebitda !== null && fin.ebitda !== 0
      ? Math.round((fin.netDebt / fin.ebitda) * 10) / 10
      : null;
  const fcfMargin =
    fin.fcf !== null && fin.revenue !== null && fin.revenue > 0
      ? Math.round((fin.fcf / fin.revenue) * 1000) / 1000
      : null;

  // Gross margin stability — stddev of last 4 reported GM values
  const gmSeries = histQ
    .slice(0, 4)
    .map((q) => q.grossMargin)
    .filter((v): v is number => v !== null);
  const gmStability =
    gmSeries.length >= 3
      ? Math.round(
          Math.sqrt(
            gmSeries.reduce((s, v) => {
              const mean = gmSeries.reduce((a, b) => a + b, 0) / gmSeries.length;
              return s + (v - mean) ** 2;
            }, 0) / gmSeries.length,
          ) * 10,
        ) / 10
      : null;

  const acctQ = computeAccountingQuality({
    cfoOverPat,
    arGrowthVsRevenuePct: arGrowthPp,
    inventoryGrowthVsRevenuePct: invGrowthPp,
    sbcIntensity,
    debtToEbitda,
    fcfMargin,
    grossMarginStability: gmStability,
  });

  // ── Reaction score (uses metrics + tone + guidance + themes) ───────────
  const partialSnap = {
    metrics,
    qualitative: { mgmtTone: toneRes.tone, toneConfidence: toneRes.confidence, themes, keyTakeaways: [] },
    guidance,
  };
  const reactionRes = computeReactionScore(partialSnap as any);
  const narrativeRes = computeNarrativeScore(themes);

  // ── JAT signals ─────────────────────────────────────────────────────────
  const jatSignals: JatSignal[] = [];
  // Revenue trajectory (8Q surprise streak)
  if ((history?.streak?.revenueAttempts ?? 0) >= 3) {
    const winRate = history!.streak!.revenueBeat / history!.streak!.revenueAttempts;
    jatSignals.push({
      name: 'Revenue beat streak',
      direction: winRate >= 0.6 ? 'improving' : winRate >= 0.4 ? 'stable' : 'deteriorating',
      weight: 1.5,
    });
  }
  if ((history?.streak?.epsAttempts ?? 0) >= 3) {
    const winRate = history!.streak!.epsBeat / history!.streak!.epsAttempts;
    jatSignals.push({
      name: 'EPS beat streak',
      direction: winRate >= 0.6 ? 'improving' : winRate >= 0.4 ? 'stable' : 'deteriorating',
      weight: 1.0,
    });
  }
  // Margin trajectory (Q0 vs Q3 ebitda margin)
  if (q0?.ebitdaMargin !== undefined && q3?.ebitdaMargin !== undefined && q0.ebitdaMargin !== null && q3.ebitdaMargin !== null) {
    const delta = q0.ebitdaMargin - q3.ebitdaMargin;
    jatSignals.push({
      name: 'EBITDA margin YoY',
      direction: delta >= 0.5 ? 'improving' : delta <= -0.5 ? 'deteriorating' : 'stable',
      weight: 1.5,
    });
  }
  // Gross margin trajectory
  if (q0?.grossMargin !== undefined && q3?.grossMargin !== undefined && q0.grossMargin !== null && q3.grossMargin !== null) {
    const delta = q0.grossMargin - q3.grossMargin;
    jatSignals.push({
      name: 'Gross margin YoY',
      direction: delta >= 0.5 ? 'improving' : delta <= -0.5 ? 'deteriorating' : 'stable',
      weight: 1.0,
    });
  }
  // Estimate revisions bias
  const revBias = estimates?.revisionTrajectory?.bias;
  if (revBias && revBias !== 'na') {
    jatSignals.push({
      name: 'Sell-side estimate revisions',
      direction: revBias === 'up' ? 'improving' : revBias === 'down' ? 'deteriorating' : 'stable',
      weight: 2.0,
    });
  }
  // Rating distribution skew
  const ss = estimates?.sellSide;
  if (ss && ss.total > 0) {
    const bullish = ss.bucket.strongBuy + ss.bucket.buy;
    const bearish = ss.bucket.sell + ss.bucket.strongSell;
    const skew = (bullish - bearish) / ss.total;
    jatSignals.push({
      name: 'Sell-side bullish skew',
      direction: skew >= 0.3 ? 'improving' : skew <= -0.1 ? 'deteriorating' : 'stable',
      weight: 0.7,
    });
  }
  // Recent up/downgrades net
  if (ss && (ss.recentUpgrades30d + ss.recentDowngrades30d) >= 2) {
    const net = ss.recentUpgrades30d - ss.recentDowngrades30d;
    jatSignals.push({
      name: 'Recent rating actions (30d)',
      direction: net >= 1 ? 'improving' : net <= -1 ? 'deteriorating' : 'stable',
      weight: 0.5,
    });
  }
  const jatRes = computeJatScore(jatSignals);

  // ── Sell-side aggregated ───────────────────────────────────────────────
  const currentPrice = estimates?.quote?.price ?? null;
  const targetPrice = estimates?.sellSide?.consensusTargetPrice ?? null;
  const upsidePct =
    targetPrice !== null && currentPrice !== null && currentPrice > 0
      ? Math.round(((targetPrice - currentPrice) / currentPrice) * 1000) / 10
      : null;

  const sellSide = estimates?.sellSide
    ? {
        ...estimates.sellSide.bucket,
        total: estimates.sellSide.total,
        consensusTargetPrice: targetPrice,
        currentPrice,
        upsidePct,
        recentUpgrades30d: estimates.sellSide.recentUpgrades30d,
        recentDowngrades30d: estimates.sellSide.recentDowngrades30d,
      }
    : null;

  // ── History rows for trend section (apply scale to currency fields) ────
  const historyRows = histQ.slice(0, 8).map((q) => ({
    date: q.date,
    period: q.period,
    revenue: q.revenue !== null ? Math.round(q.revenue * sf * 100) / 100 : null,
    revenueEstimate: q.revenueEstimate !== null ? Math.round(q.revenueEstimate * sf * 100) / 100 : null,
    revenueSurprisePct: q.revenueSurprisePct,
    grossMargin: q.grossMargin,
    operatingMargin: q.operatingMargin,
    ebitdaMargin: q.ebitdaMargin,
    netMargin: q.netMargin,
    eps: q.eps,
    epsEstimate: q.epsEstimate,
    epsSurprisePct: q.epsSurprisePct,
    fcf: q.fcf !== null ? Math.round(q.fcf * sf * 100) / 100 : null,
  }));

  // ── Reaction probability ───────────────────────────────────────────────
  const hasEstimates = revenueEstimate !== null || epsEstimate !== null;
  const reactionProb = computeReactionProbability(reactionRes.score, hasEstimates);

  // ── Key takeaways (deterministic, derived from metric classes) ─────────
  const takeaways: string[] = [];
  if (metrics.revenue.surpriseClass !== 'na' && metrics.revenue.surpriseClass !== 'inline') {
    const dir = (metrics.revenue.surprisePct ?? 0) >= 0 ? 'beat' : 'missed';
    takeaways.push(`Revenue ${dir} consensus by ${(metrics.revenue.surprisePct ?? 0).toFixed(1)}%`);
  }
  if (metrics.eps.surpriseClass !== 'na' && metrics.eps.surpriseClass !== 'inline') {
    const dir = (metrics.eps.surprisePct ?? 0) >= 0 ? 'beat' : 'missed';
    takeaways.push(`EPS ${dir} consensus by ${(metrics.eps.surprisePct ?? 0).toFixed(1)}%`);
  }
  if (metrics.revenue.yoyPct !== null) {
    const dir = metrics.revenue.yoyPct >= 0 ? 'grew' : 'contracted';
    takeaways.push(`Revenue ${dir} ${metrics.revenue.yoyPct.toFixed(1)}% YoY`);
  }
  if (metrics.ebitdaMargin.yoyBps !== null && Math.abs(metrics.ebitdaMargin.yoyBps) >= 100) {
    const dir = metrics.ebitdaMargin.yoyBps >= 0 ? 'expanded' : 'compressed';
    takeaways.push(`EBITDA margin ${dir} ${Math.abs(metrics.ebitdaMargin.yoyBps)} bps YoY`);
  }
  if (acctQ.flags.length > 0) takeaways.push(acctQ.flags[0]);
  if (themes.length > 0 && themes[0].strength === 'high') {
    takeaways.push(`Strong thematic exposure: ${themes[0].theme}`);
  }

  return {
    ticker: fin.ticker,
    company: fin.company,
    quarter: fin.period,
    filingType: fin.filingType,
    exchange: estimates?.profile?.exchange ?? null,
    sector: estimates?.profile?.sector ?? null,
    industry: estimates?.profile?.industry ?? null,
    marketCap: estimates?.profile?.mktCap ?? estimates?.quote?.marketCap ?? null,
    enterpriseValue: estimates?.profile?.enterpriseValue ?? null,
    reportTime: 'unknown',
    currency: fin.currency,
    scaleLabel: fin.scaleLabel,
    metrics,
    guidance,
    qualitative: {
      mgmtTone: toneRes.tone,
      toneConfidence: toneRes.confidence,
      themes,
      keyTakeaways: takeaways,
    },
    history: historyRows,
    streak: {
      revenueBeats: history?.streak?.revenueBeat ?? 0,
      revenueAttempts: history?.streak?.revenueAttempts ?? 0,
      epsBeats: history?.streak?.epsBeat ?? 0,
      epsAttempts: history?.streak?.epsAttempts ?? 0,
      avgRevenueSurprise: history?.streak?.avgRevenueSurprise ?? null,
      avgEpsSurprise: history?.streak?.avgEpsSurprise ?? null,
    },
    sellSide,
    accountingQuality: {
      cfoOverPat,
      arGrowthVsRevenuePct: arGrowthPp,
      inventoryGrowthVsRevenuePct: invGrowthPp,
      sbcIntensity,
      debtToEbitda,
      fcfMargin,
      flags: acctQ.flags,
    },
    scores: {
      reaction: reactionRes,
      accounting: { score: acctQ.score, grade: acctQ.grade, flags: acctQ.flags },
      narrative: narrativeRes,
      jat: jatRes,
    },
    reactionProbability: reactionProb,
    sources: {
      financials: fin.revenueSource,
      estimates: estimates?.ok ? 'fmp_consensus' : 'unavailable',
      history: history?.ok ? 'fmp_history' : 'unavailable',
    },
    validationWarnings: fin.validationWarnings || [],
    generatedAt: new Date().toISOString(),
  };
}

// ── Guidance inference (text-based; explicit hits only) ───────────────────
function inferGuidance(rawText: string): EarningsSnapshot['guidance'] {
  const t = (rawText || '').toLowerCase();
  let direction: EarningsSnapshot['guidance']['direction'] = 'na';
  if (/raise(d)?\s+(full[\s-]year\s+)?guidance|increased\s+guidance|guiding\s+(higher|up)/i.test(t)) direction = 'raised';
  else if (/lower(ed)?\s+guidance|reduced\s+guidance|cut(ting)?\s+guidance|guiding\s+(lower|down)/i.test(t)) direction = 'lowered';
  else if (/maintain(ing)?\s+guidance|reaffirm(ed|s|ing)?\s+guidance|reiterat(ing|e[sd]?)\s+guidance/i.test(t)) direction = 'maintained';
  else if (/initial\s+guidance|introduc(ing|e[sd]?)\s+guidance|providing\s+initial/i.test(t)) direction = 'introduced';

  const commentary: string[] = [];
  const sentences = (rawText || '').split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if (/guidance|outlook|expect|guide|projects?/i.test(s) && s.length < 280) {
      commentary.push(s.trim());
      if (commentary.length >= 5) break;
    }
  }

  return {
    direction,
    revenue: null,
    eps: null,
    ebitda: null,
    commentary,
  };
}
