// ─────────────────────────────────────────────────────────────────────────────
// Snapshot assembler — combines financials + FMP estimates + 8Q history into a
// single deterministic EarningsSnapshot.
//
// Hardening pass:
//  - Confidence scoring per section
//  - Explicit unavailableReason strings (never silent "—" upstream)
//  - Denominator sanity guards (no Net Debt / EBITDA = 48x absurdity)
//  - Weight renormalization in reaction score
//  - Theme corpus enriched from SEC submissions + FMP profile + sector + industry
// ─────────────────────────────────────────────────────────────────────────────

import {
  EarningsSnapshot,
  buildMetric,
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

export interface FinancialsInput {
  company: string;
  ticker: string;
  period: string;
  filingType: string;
  currency: 'USD' | 'INR' | 'EUR' | 'unknown';
  scaleLabel: string;
  scaleFactor: number;
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

  // Enriched fields from SEC EDGAR submissions
  sicDescription?: string | null;
  exchange?: string | null;
  category?: string | null;
  businessText?: string | null;
}

export interface EstimatesInput {
  ok?: boolean;
  profile?: any;
  quote?: any;
  consensusNextQ?: {
    revenueAvg: number | null;
    revenueLow?: number | null;
    revenueHigh?: number | null;
    epsAvg: number | null;
    epsLow?: number | null;
    epsHigh?: number | null;
    ebitdaAvg: number | null;
    ebitAvg?: number | null;
    netIncomeAvg: number | null;
    numAnalysts: number | null;
  } | null;
  consensusFY?: any;
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
  const sf = fin.scaleFactor || 1e-6;
  const endpointsHit: string[] = [];
  const endpointsFailed: string[] = [];
  const fallbacksUsed: string[] = [];

  endpointsHit.push(fin.revenueSource || 'unknown');
  if (estimates?.ok) endpointsHit.push('fmp_estimates'); else endpointsFailed.push('fmp_estimates');
  if (history?.ok) endpointsHit.push('fmp_history'); else endpointsFailed.push('fmp_history');

  // ── Consensus extraction ───────────────────────────────────────────────
  const consNext = estimates?.consensusNextQ || null;
  const lastSurp = estimates?.lastReportedSurprise || null;

  // Hoisted history slice — used both for QoQ (later) and as an EPS / EBITDA
  // fallback when the EDGAR XBRL parser doesn't fill those fields (GOOG
  // pre-2026 shows EPS as '—' in scorecard otherwise).
  const histQ = (history?.quarters || []).slice();

  const lastRevEst = lastSurp?.estimateRevenue !== null && lastSurp?.estimateRevenue !== undefined
    ? Math.round(lastSurp.estimateRevenue * sf * 100) / 100
    : null;
  const lastEpsEst = lastSurp?.estimateEps ?? null;
  const lastRevAct = lastSurp?.actualRevenue !== null && lastSurp?.actualRevenue !== undefined
    ? Math.round(lastSurp.actualRevenue * sf * 100) / 100
    : null;

  const revenueActual = fin.revenue;
  const revenueEstimate = lastRevEst ?? (consNext?.revenueAvg !== null && consNext?.revenueAvg !== undefined
    ? Math.round(consNext.revenueAvg * sf * 100) / 100
    : null);
  if (revenueEstimate !== null && lastRevEst === null) fallbacksUsed.push('next-Q revenue est used as proxy for last reported');

  // EPS source priority: FMP earnings-surprises actualEps FIRST so the
  // scorecard "Actual" matches the consensus convention used in
  // estimateEps (typically non-GAAP). Then fin.eps (EDGAR XBRL basic GAAP),
  // then history[0].eps as a last-resort fallback. Some companies (GOOG
  // pre-2026) don't carry EarningsPerShareBasic in XBRL — only diluted,
  // or only as Class A / Class C splits — so without the history fallback
  // the scorecard EPS row went '—' even though the trend had values.
  const epsActual = lastSurp?.actualEps ?? fin.eps ?? histQ[0]?.eps ?? null;
  const epsEstimate = lastEpsEst ?? consNext?.epsAvg ?? null;

  const ebitdaEst = consNext?.ebitdaAvg !== null && consNext?.ebitdaAvg !== undefined
    ? Math.round(consNext.ebitdaAvg * sf * 100) / 100
    : null;
  const netIncomeEst = consNext?.netIncomeAvg !== null && consNext?.netIncomeAvg !== undefined
    ? Math.round(consNext.netIncomeAvg * sf * 100) / 100
    : null;
  const ebitdaMarginEst = ebitdaEst !== null && revenueEstimate !== null && revenueEstimate > 0
    ? Math.round((ebitdaEst / revenueEstimate) * 10000) / 100
    : null;

  // ── QoQ from history (histQ already hoisted above for EPS fallback) ──
  const qoq = histQ[1] || null;
  const qoqRev = qoq?.revenue !== null && qoq?.revenue !== undefined ? Math.round(qoq.revenue * sf * 100) / 100 : null;
  // YoY = same fiscal quarter one year ago (4 quarters back in the history
  // array). When fin.* doesn't carry priors (e.g. EDGAR XBRL only filled
  // current quarter) we fall back to history[4].
  const yoyHist = histQ[4] || null;
  const yoyRevFromHist =
    yoyHist?.revenue !== null && yoyHist?.revenue !== undefined
      ? Math.round(yoyHist.revenue * sf * 100) / 100
      : null;
  const yoyEpsFromHist = yoyHist?.eps ?? null;

  const metrics = {
    revenue: buildMetric({
      metric: 'Revenue', unit: 'currency',
      actual: revenueActual,
      estimate: revenueEstimate,
      prior: fin.revPrior ?? yoyRevFromHist,
      qoqPrior: qoqRev,
    }),
    eps: buildMetric({
      metric: 'EPS', unit: 'count',
      actual: epsActual,
      estimate: epsEstimate,
      prior: fin.epsPrior ?? yoyEpsFromHist,
      qoqPrior: qoq?.eps ?? null,
    }),
    ebitda: buildMetric({
      metric: 'EBITDA', unit: 'currency',
      // history rows don't carry raw EBITDA — they have ebitdaMargin instead.
      // If EDGAR didn't supply EBITDA, derive from ebitdaMargin × revenue.
      actual: fin.ebitda ?? (
        histQ[0]?.ebitdaMargin != null && fin.revenue != null
          ? Math.round((histQ[0].ebitdaMargin / 100) * fin.revenue * 100) / 100
          : null
      ),
      estimate: ebitdaEst,
      prior: null, qoqPrior: null,
    }),
    grossMargin: buildMetric({
      metric: 'Gross Margin', unit: 'percent',
      actual: fin.grossMargin ?? histQ[0]?.grossMargin ?? null,
      estimate: null, prior: null,
      qoqPrior: qoq?.grossMargin ?? null,
    }),
    ebitdaMargin: buildMetric({
      metric: 'EBITDA Margin', unit: 'percent',
      actual: fin.ebitdaMargin ?? histQ[0]?.ebitdaMargin ?? null,
      estimate: ebitdaMarginEst,
      prior: null,
      qoqPrior: qoq?.ebitdaMargin ?? null,
    }),
    operatingMargin: buildMetric({
      metric: 'Operating Margin', unit: 'percent',
      actual: fin.ebitMargin,
      estimate: null, prior: null,
      qoqPrior: qoq?.operatingMargin ?? null,
    }),
    netIncome: buildMetric({
      metric: 'Net Income', unit: 'currency',
      actual: fin.pat,
      estimate: netIncomeEst,
      prior: fin.patPrior,
      qoqPrior: null,
    }),
    fcf: buildMetric({
      metric: 'Free Cash Flow', unit: 'currency',
      actual: fin.fcf,
      estimate: null, prior: null,
      qoqPrior: qoq?.fcf !== null && qoq?.fcf !== undefined ? Math.round(qoq.fcf * sf * 100) / 100 : null,
    }),
  };

  // ── Theme detection — feed it RICH text ────────────────────────────────
  // Order matters: we put high-signal text first (filing description, SIC) so
  // first-match keywords come from authoritative sources.
  const textCorpus = [
    fin.businessText || '',
    fin.sicDescription || '',
    estimates?.profile?.description || '',
    estimates?.profile?.industry || '',
    estimates?.profile?.sector || '',
    fin.company || '',
    rawText || '',
    (fin.themes || []).join(' '),
  ].filter(Boolean).join(' · ');

  const themeRes = detectThemes(textCorpus);
  const themes = themeRes.themes;

  const toneRes = classifyMgmtTone(rawText || '');

  // ── Guidance (text-based; explicit signals only) ───────────────────────
  const guidance = inferGuidance(rawText);

  // ── Accounting indicators with sanity guards ───────────────────────────
  const cfoOverPat =
    fin.cfo !== null && fin.pat !== null && Math.abs(fin.pat) >= 0.1
      ? Math.round((fin.cfo / fin.pat) * 100) / 100
      : null;

  const q0 = histQ[0] || null;
  const q3 = histQ[3] || null;
  const arGrowthPp = computeGrowthDeltaPp(q0?.receivables, q3?.receivables, q0?.revenue, q3?.revenue);
  const invGrowthPp = computeGrowthDeltaPp(q0?.inventory, q3?.inventory, q0?.revenue, q3?.revenue);
  const sbcIntensity =
    q0?.sbc != null && q0?.revenue != null && q0.revenue > 0
      ? Math.round((q0.sbc / q0.revenue) * 1000) / 1000
      : null;

  // EBITDA sanity gate for debt/EBITDA: only compute if EBITDA is meaningful
  // (≥3% of revenue OR ≥$5M absolute, in raw currency)
  const rawEbitda = fin.ebitda !== null ? fin.ebitda / sf : null;
  const rawRevenue = fin.revenue !== null ? fin.revenue / sf : null;
  const rawNetDebt = fin.netDebt !== null ? fin.netDebt / sf : null;
  const ebitdaMeaningful =
    rawEbitda !== null && (
      Math.abs(rawEbitda) >= 5_000_000 ||
      (rawRevenue !== null && rawRevenue > 0 && Math.abs(rawEbitda / rawRevenue) >= 0.03)
    );
  const debtToEbitda =
    rawNetDebt !== null && rawEbitda !== null && ebitdaMeaningful && Math.abs(rawEbitda) >= 1
      ? Math.round((rawNetDebt / rawEbitda) * 10) / 10
      : null;
  if (rawNetDebt !== null && rawEbitda !== null && !ebitdaMeaningful) {
    fallbacksUsed.push('Net Debt / EBITDA suppressed: EBITDA below sanity threshold');
  }

  const fcfMargin =
    fin.fcf !== null && fin.revenue !== null && fin.revenue > 0
      ? Math.round((fin.fcf / fin.revenue) * 1000) / 1000
      : null;

  const gmSeries = histQ.slice(0, 4).map((q) => q.grossMargin).filter((v): v is number => v !== null);
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
    ebitda: rawEbitda,
    revenue: rawRevenue,
    fcfMargin,
    grossMarginStability: gmStability,
  });

  // ── Reaction score ─────────────────────────────────────────────────────
  const partial = {
    metrics,
    qualitative: { mgmtTone: toneRes.tone, toneConfidence: toneRes.confidence, themes, keyTakeaways: [] },
    guidance,
  };
  const reactionRes = computeReactionScore(partial as any);
  const narrativeRes = computeNarrativeScore(themes, themeRes.confidence);

  // ── JAT signals ─────────────────────────────────────────────────────────
  const jatSignals: JatSignal[] = [];
  if ((history?.streak?.revenueAttempts ?? 0) >= 3) {
    const winRate = history!.streak!.revenueBeat / history!.streak!.revenueAttempts;
    jatSignals.push({ name: 'Revenue beat streak', direction: winRate >= 0.6 ? 'improving' : winRate >= 0.4 ? 'stable' : 'deteriorating', weight: 1.5 });
  }
  if ((history?.streak?.epsAttempts ?? 0) >= 3) {
    const winRate = history!.streak!.epsBeat / history!.streak!.epsAttempts;
    jatSignals.push({ name: 'EPS beat streak', direction: winRate >= 0.6 ? 'improving' : winRate >= 0.4 ? 'stable' : 'deteriorating', weight: 1.0 });
  }
  if (q0?.ebitdaMargin != null && q3?.ebitdaMargin != null) {
    const delta = q0.ebitdaMargin - q3.ebitdaMargin;
    jatSignals.push({ name: 'EBITDA margin YoY', direction: delta >= 0.5 ? 'improving' : delta <= -0.5 ? 'deteriorating' : 'stable', weight: 1.5 });
  }
  if (q0?.grossMargin != null && q3?.grossMargin != null) {
    const delta = q0.grossMargin - q3.grossMargin;
    jatSignals.push({ name: 'Gross margin YoY', direction: delta >= 0.5 ? 'improving' : delta <= -0.5 ? 'deteriorating' : 'stable', weight: 1.0 });
  }
  const revBias = estimates?.revisionTrajectory?.bias;
  if (revBias && revBias !== 'na') {
    jatSignals.push({ name: 'Sell-side estimate revisions', direction: revBias === 'up' ? 'improving' : revBias === 'down' ? 'deteriorating' : 'stable', weight: 2.0 });
  }
  const ss = estimates?.sellSide;
  if (ss && ss.total > 0) {
    const bullish = ss.bucket.strongBuy + ss.bucket.buy;
    const bearish = ss.bucket.sell + ss.bucket.strongSell;
    const skew = (bullish - bearish) / ss.total;
    jatSignals.push({ name: 'Sell-side bullish skew', direction: skew >= 0.3 ? 'improving' : skew <= -0.1 ? 'deteriorating' : 'stable', weight: 0.7 });
  }
  if (ss && (ss.recentUpgrades30d + ss.recentDowngrades30d) >= 2) {
    const net = ss.recentUpgrades30d - ss.recentDowngrades30d;
    jatSignals.push({ name: 'Recent rating actions (30d)', direction: net >= 1 ? 'improving' : net <= -1 ? 'deteriorating' : 'stable', weight: 0.5 });
  }
  const jatRes = computeJatScore(jatSignals);

  // ── Sell-side aggregate ────────────────────────────────────────────────
  const currentPrice = estimates?.quote?.price ?? null;
  const targetPrice = estimates?.sellSide?.consensusTargetPrice ?? null;
  const upsidePct =
    targetPrice !== null && currentPrice !== null && currentPrice > 0
      ? Math.round(((targetPrice - currentPrice) / currentPrice) * 1000) / 10
      : null;
  const sellSideOut = estimates?.sellSide
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

  // ── History rows scaled for display ────────────────────────────────────
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

  // ── Reaction probability uses confidence to avoid over-confident projection ─
  const reactionProb = computeReactionProbability(reactionRes.score, reactionRes.confidence);

  // ── Section status (drives empty-state UX) ─────────────────────────────
  const estAvail = !!(consNext?.revenueAvg || consNext?.epsAvg || lastSurp?.estimateRevenue || lastSurp?.estimateEps);
  const ssTotal = estimates?.sellSide?.total ?? 0;
  const sellSideAvail = ssTotal > 0 || (estimates?.sellSide?.consensusTargetPrice ?? 0) > 0;
  const histAvail = histQ.length > 0;
  const themesAvail = themes.length > 0;
  const guidanceAvail = guidance.direction !== 'na';

  const sectionStatus = {
    estimates: {
      available: estAvail,
      confidence: estAvail ? (consNext?.numAnalysts && consNext.numAnalysts >= 3 ? 90 : 65) : 0,
      reason: estAvail ? null : (consNext?.numAnalysts != null && consNext.numAnalysts < 3
        ? `Coverage insufficient (<3 analysts) for ${fin.ticker}`
        : `No FMP analyst coverage available for ${fin.ticker} — small-cap or thin coverage`),
    },
    sellSide: {
      available: sellSideAvail,
      confidence: ssTotal >= 5 ? 85 : ssTotal >= 2 ? 60 : 0,
      reason: sellSideAvail ? null : `No sell-side coverage data available from FMP for ${fin.ticker}`,
    },
    history: {
      available: histAvail,
      confidence: histQ.length >= 4 ? 90 : histQ.length >= 2 ? 60 : 0,
      reason: histAvail ? null : `No quarterly income statement history available from FMP for ${fin.ticker}`,
    },
    themes: {
      available: themesAvail,
      confidence: themeRes.confidence,
      reason: themeRes.unavailableReason,
    },
    guidance: {
      available: guidanceAvail,
      confidence: guidanceAvail ? 60 : 0,
      reason: guidanceAvail ? null : 'No explicit guidance language detected in available text. Upload press release or paste prepared remarks for guidance extraction.',
    },
  };

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
    exchange: estimates?.profile?.exchange ?? fin.exchange ?? null,
    sector: estimates?.profile?.sector ?? null,
    industry: estimates?.profile?.industry ?? fin.sicDescription ?? null,
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
    sellSide: sellSideOut,
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
      accounting: { score: acctQ.score, grade: acctQ.grade, confidence: acctQ.confidence, flags: acctQ.flags },
      narrative: narrativeRes,
      jat: jatRes,
    },
    reactionProbability: reactionProb,
    sectionStatus,
    debug: {
      endpointsHit,
      endpointsFailed,
      fallbacksUsed,
      corpusChars: themeRes.corpusChars,
    },
    sources: {
      financials: fin.revenueSource,
      estimates: estimates?.ok ? 'fmp_consensus' : 'unavailable',
      history: history?.ok ? 'fmp_history' : 'unavailable',
    },
    analysisMode: 'us_full_consensus',
    validationWarnings: fin.validationWarnings || [],
    generatedAt: new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function computeGrowthDeltaPp(
  cur: number | null | undefined,
  prior: number | null | undefined,
  curRev: number | null | undefined,
  priorRev: number | null | undefined,
): number | null {
  if (cur == null || prior == null || curRev == null || priorRev == null) return null;
  if (Math.abs(prior) < 1 || Math.abs(priorRev) < 1) return null; // denominator sanity
  const itemGrowth = ((cur - prior) / Math.abs(prior)) * 100;
  const revGrowth = ((curRev - priorRev) / Math.abs(priorRev)) * 100;
  return Math.round((itemGrowth - revGrowth) * 10) / 10;
}

// Exported so the India pipeline can reuse the same regex set for concall
// transcripts (the language is broadly similar across markets).
export function inferGuidance(rawText: string): EarningsSnapshot['guidance'] {
  const t = (rawText || '').toLowerCase();
  let direction: EarningsSnapshot['guidance']['direction'] = 'na';
  // Explicit US-style guidance language
  if (/raise(d)?\s+(full[\s-]year\s+)?guidance|increased\s+guidance|guiding\s+(higher|up)/i.test(t)) direction = 'raised';
  else if (/lower(ed)?\s+guidance|reduced\s+guidance|cut(ting)?\s+guidance|guiding\s+(lower|down)/i.test(t)) direction = 'lowered';
  else if (/maintain(ing)?\s+guidance|reaffirm(ed|s|ing)?\s+guidance|reiterat(ing|e[sd]?)\s+guidance/i.test(t)) direction = 'maintained';
  else if (/initial\s+guidance|introduc(ing|e[sd]?)\s+guidance|providing\s+initial/i.test(t)) direction = 'introduced';

  // Indian-deck capacity / capex forward statements ("plans to scale up to X
  // skids by Q2FY27", "set up automatic welding station by Dec-26",
  // "expansion to 20 mn meters by Q2FY27"). Treat as 'introduced' direction
  // because they're concrete forward plans without explicit raise/lower
  // language.
  if (direction === 'na') {
    const planRe = /\b(plan(s|ned|ning)?\s+to|on track to|expected to|going to|target(ed|s|ing)?\s+to)\s+[a-z\s]{0,40}\bby\s+(Q[1-4]\s?FY\s?\d{2,4}|FY\s?\d{2,4}|H[12]\s?FY?\s?\d{2,4}|\d{4}|[a-z]{3,4}[- ]?\d{2,4}|next quarter|next year)/i;
    const expansionRe = /\b(expand(ed|ing|ion)?|increased?|scale up|scaling|add(ed|ing|ition)?|commission(ed|ing)?)\s+(?:its\s+)?[a-z\s]{0,30}capacity\s+to\s+[\d,]+/i;
    const setupRe = /\b(set(ting)? up|adding|adding up|to commission|new plant|brownfield|greenfield)\b[\s\S]{0,80}\b(by|in)\s+(Q[1-4]\s?FY?\s?\d{2,4}|FY\s?\d{2,4}|[a-z]{3,4}[- ]?\d{2,4}|\d{4})/i;
    // Stage-Gate / multi-year product roadmaps with explicit ₹X Cr targets
    // (Intellect Design Arena describes Stage 4 ₹1,500 Cr target). Treat as
    // 'introduced' guidance.
    const stageGateRe = /\b(Stage\s*[1-9]|Phase\s*[1-9]|Year\s*[1-9])\b[\s\S]{0,80}(₹|\bRs\.?\s|\bUSD?\s|\$)\s*[\d,]+\s*(Cr|crore|Mn|million|Bn|billion|lakh)/i;
    const multiYearTargetRe = /\b(\d[- ]year (cycle|plan|roadmap|target|horizon)|aspires? to|aspirational target|target of (₹|\bRs\.?|\$)?\s*[\d,]+)\b/i;
    if (planRe.test(t) || expansionRe.test(t) || setupRe.test(t) || stageGateRe.test(t) || multiYearTargetRe.test(t)) {
      direction = 'introduced';
    }
  }

  // Broaden commentary harvest — pull sentences with guidance, outlook,
  // capex/capacity plans, expected, on track, by Q[N]FY[YY]. Keeps the same
  // 5-sentence cap and 280-char ceiling.
  const commentary: string[] = [];
  const sentences = (rawText || '').split(/(?<=[.!?])\s+/);
  const guidanceSentenceRe = /\b(guidance|outlook|expect|guide|project(s|ed|ing)?|plan(s|ned|ning)?|on track|targeted?|aim(ing)? to|by\s+(Q[1-4]\s?FY?\s?\d{2,4}|FY\s?\d{2,4}|[a-z]{3,4}[- ]\d{2,4})|capacity (expansion|addition))\b/i;
  const seenStarts = new Set<string>();
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length > 280 || trimmed.length < 25) continue;
    if (!guidanceSentenceRe.test(trimmed)) continue;
    // dedupe near-duplicates by leading 60 chars
    const key = trimmed.slice(0, 60).toLowerCase();
    if (seenStarts.has(key)) continue;
    seenStarts.add(key);
    commentary.push(trimmed);
    if (commentary.length >= 5) break;
  }

  return {
    direction,
    revenue: null,
    eps: null,
    ebitda: null,
    commentary,
  };
}
