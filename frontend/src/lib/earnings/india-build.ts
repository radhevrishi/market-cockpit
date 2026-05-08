// ─────────────────────────────────────────────────────────────────────────────
// India snapshot builder — schema-first, fundamentals-only mode aware
// ─────────────────────────────────────────────────────────────────────────────
// India earnings differ from US in critical ways:
//   - No reliable analyst consensus on free-tier APIs
//   - Standard unit is ₹ Crores, not millions
//   - Sectoral KPIs differ (CASA / GNPA for banks, Volume Growth for FMCG)
//   - Filing prose is sparse compared to US 10-K MD&A
// So this builder produces an EarningsSnapshot configured for "fundamentals
// only" rendering: no fake reaction probability, no bogus consensus surprise,
// instead rich quarterly trend + sector KPI checklist + working capital
// indicators.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EarningsSnapshot,
  buildMetric,
  IndiaExtras,
} from './snapshot';
import { detectIndiaThemes, classifyMgmtToneIndia } from './india-themes';
import {
  computeAccountingQuality,
  computeNarrativeScore,
  computeJatScore,
  JatSignal,
} from './scoring';
import { classifyIndiaSector, INDIA_SECTOR_TEMPLATES, IndiaSector } from './india-sectors';

// ── Inputs ────────────────────────────────────────────────────────────────
export interface ScreenerInput {
  ok?: boolean;
  ticker: string;
  company?: string | null;
  sector?: string | null;
  subIndustry?: string | null;
  industry?: string | null;
  about?: string | null;
  unit?: string;
  source?: string;
  provenance?: {
    financials?: string;
    history?: string;
    ratios?: string;
    topMetrics?: string;
    sector?: string;
    annual?: string;
    balanceSheet?: string;
    cashFlow?: string;
    shareholding?: string;
  };
  topMetrics?: {
    marketCap: number | null;        // ₹ Cr
    currentPrice: number | null;
    peRatio: number | null;
    bookValue: number | null;
    dividendYieldPct: number | null;
    roce: number | null;
    roe: number | null;
    faceValue: number | null;
    promoterHoldingPct: number | null;
    debtToEquity: number | null;
  };
  latest?: any;
  yoyPriorQuarter?: any;
  qoqPriorQuarter?: any;
  quarterly?: Array<{
    period: string;
    sales: number | null;
    expenses: number | null;
    operatingProfit: number | null;
    opmPct: number | null;
    otherIncome: number | null;
    interest: number | null;
    depreciation: number | null;
    pbt: number | null;
    taxPct: number | null;
    netProfit: number | null;
    eps: number | null;
    netMargin: number | null;
  }>;
  annual?: any[];
  balanceSheet?: any[];
  cashFlow?: any[];
  ratios?: Array<{
    period: string;
    debtorDays: number | null;
    inventoryDays: number | null;
    daysPayable: number | null;
    cashConversionCycle: number | null;
    workingCapitalDays: number | null;
    roce: number | null;
  }>;
  shareholding?: Array<{
    period: string;
    promoters: number | null;
    fii: number | null;
    dii: number | null;
    public: number | null;
  }>;
}

export interface FmpProfileInput {
  symbol?: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  description?: string;
  marketCap?: number;
  exchange?: string;
  currency?: string;
}

// ── Builder ──────────────────────────────────────────────────────────────
export function buildIndiaSnapshot(
  ticker: string,
  filingType: string,
  screener: ScreenerInput | null,
  fmpProfile: FmpProfileInput | null,
  rawText: string = '',
): EarningsSnapshot {
  const endpointsHit: string[] = [];
  const endpointsFailed: string[] = [];
  const fallbacksUsed: string[] = [];

  // Provenance flags drive what appears in `sources` at the bottom of the page.
  // Quarterly P&L (revenue/PAT/OPM/EPS/margins/history) come from NSE filings
  // when available; Screener.in remains the source for TTM ratios and longer
  // annual history.
  const financialsSource = screener?.provenance?.financials || (screener?.ok ? 'screener_in' : 'unavailable');
  const historySource = screener?.provenance?.history || (screener?.ok ? 'screener_in' : 'unavailable');
  const usedNse = financialsSource === 'nse_quarterly_results';

  if (usedNse) endpointsHit.push('nse_corporates_financial_results');
  if (screener?.ok) endpointsHit.push('screener_in');
  else endpointsFailed.push('screener_in');
  if (fmpProfile) endpointsHit.push('fmp_profile_india');
  else endpointsFailed.push('fmp_profile_india');

  // ── Sector classification ─────────────────────────────────────────────
  // Prefer Screener's explicit sector + industry fields. Fall back to FMP
  // industry. Fall back to free-text description.
  const sectorStr = screener?.sector || '';
  const industryStr = screener?.industry || fmpProfile?.industry || '';
  const subIndStr = screener?.subIndustry || '';
  const classifyText = [sectorStr, industryStr, subIndStr, fmpProfile?.description || ''].join(' ');
  const sector: IndiaSector = classifyIndiaSector(industryStr || sectorStr, classifyText);
  const sectorTemplate = INDIA_SECTOR_TEMPLATES[sector];

  // ── Convert ₹ Cr → ₹ Mn for internal canonical (× 10) ─────────────────
  // We display in ₹ Cr to users but keep internal at ₹ Mn for cross-currency
  // comparability with the US pipeline.
  const cr = (v: number | null): number | null =>
    v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 * 100) / 100;

  const latest = screener?.latest || null;
  const qoq = screener?.qoqPriorQuarter || null;
  const yoy = screener?.yoyPriorQuarter || null;
  const quarters = screener?.quarterly || [];

  const revenue = cr(latest?.revenue ?? null);
  const revPrior = cr(yoy?.revenue ?? null);
  const opIncome = cr(latest?.operatingProfit ?? null);
  const grossMarginPct = latest?.ebitdaMargin ?? null;
  const netIncome = cr(latest?.netIncome ?? null);
  const netIncomePrior = cr(yoy?.netIncome ?? null);
  const eps = latest?.eps ?? null;
  const epsPrior = yoy?.eps ?? null;

  // QoQ
  const revQoQ = cr(qoq?.revenue ?? null);
  const opIncomeQoQ = cr(qoq?.operatingProfit ?? null);
  const ebitdaMarginQoQ = qoq?.ebitdaMargin ?? null;
  const netIncomeQoQ = cr(qoq?.netIncome ?? null);

  // Period label normalization (Screener uses "Mar 2026")
  const periodLabel = latest?.period || quarters[quarters.length - 1]?.period || 'Latest';

  // ── Metric lines (no consensus — fundamentals-only) ───────────────────
  const metrics = {
    revenue: buildMetric({
      metric: 'Revenue', unit: 'currency',
      actual: revenue, estimate: null,
      prior: revPrior, qoqPrior: revQoQ,
    }),
    eps: buildMetric({
      metric: 'EPS', unit: 'count',
      actual: eps, estimate: null,
      prior: epsPrior, qoqPrior: qoq?.eps ?? null,
    }),
    ebitda: buildMetric({
      metric: 'Operating Profit', unit: 'currency',
      actual: opIncome, estimate: null,
      prior: cr(yoy?.operatingProfit ?? null),
      qoqPrior: opIncomeQoQ,
    }),
    grossMargin: buildMetric({
      metric: 'Gross Margin', unit: 'percent',
      actual: null, estimate: null, prior: null, qoqPrior: null,
    }),
    ebitdaMargin: buildMetric({
      metric: 'OPM (Operating Margin)', unit: 'percent',
      actual: grossMarginPct, estimate: null,
      prior: yoy?.ebitdaMargin ?? null,
      qoqPrior: ebitdaMarginQoQ,
    }),
    operatingMargin: buildMetric({
      metric: 'Net Margin', unit: 'percent',
      actual: latest?.netMargin ?? null, estimate: null,
      prior: null,
      qoqPrior: qoq && qoq.revenue && qoq.netIncome ? Math.round((qoq.netIncome / qoq.revenue) * 10000) / 100 : null,
    }),
    netIncome: buildMetric({
      metric: 'Net Profit (PAT)', unit: 'currency',
      actual: netIncome, estimate: null,
      prior: netIncomePrior,
      qoqPrior: netIncomeQoQ,
    }),
    fcf: buildMetric({
      metric: 'Free Cash Flow', unit: 'currency',
      actual: null, estimate: null, prior: null, qoqPrior: null,
    }),
  };

  // ── Theme detection — INDIA macro themes (rural recovery / China+1 / etc) ─
  const themeCorpus = [
    screener?.about || '',
    fmpProfile?.description || '',
    industryStr,
    sectorTemplate.themes.join(' '),
    sectorTemplate.displayName,
    rawText || '',
  ].filter(Boolean).join(' · ');

  const themeRes = detectIndiaThemes(themeCorpus);
  const themes = themeRes.themes;
  const toneRes = classifyMgmtToneIndia(rawText || '');

  // ── Accounting quality from screener ratios ───────────────────────────
  const recentRatios = (screener?.ratios || [])
    .map((r) => r)
    .reverse()
    .find((r) => r.cashConversionCycle !== null || r.debtorDays !== null);
  const cfoFromHist = (screener?.cashFlow || []).reverse()[0];

  // CFO/PAT for India: take from latest annual cash flow
  const latestAnnualNet = (screener?.annual || []).reverse()[0]?.netProfit;
  const cfo = cfoFromHist?.fromOperating ?? null;
  const cfoOverPat = cfo && latestAnnualNet && latestAnnualNet !== 0
    ? Math.round((cfo / latestAnnualNet) * 100) / 100
    : null;

  // Debt/Equity (already reported)
  const debtToEquity = screener?.topMetrics?.debtToEquity ?? null;

  // Use D/E directly when EBITDA is ambiguous (Screener doesn't report EBITDA cleanly)
  // Skip Net Debt/EBITDA computation entirely for India.
  const acctQ = computeAccountingQuality({
    cfoOverPat,
    arGrowthVsRevenuePct: null, // We don't have YoY AR growth at this level
    inventoryGrowthVsRevenuePct: null,
    sbcIntensity: null,
    debtToEbitda: null, // Skipped for India
    ebitda: null,
    revenue: revenue !== null ? revenue * 1e5 : null, // ₹ Mn → raw ₹ for sanity (1 Mn = 1 Lakh)
    fcfMargin: null,
    grossMarginStability: null,
  });

  // Inject India-specific quality flags
  if (recentRatios?.cashConversionCycle !== null && recentRatios?.cashConversionCycle !== undefined) {
    if (recentRatios.cashConversionCycle > 90) {
      acctQ.flags.push(`Cash conversion cycle ${recentRatios.cashConversionCycle.toFixed(0)} days — working capital stretched`);
    } else if (recentRatios.cashConversionCycle < 30) {
      acctQ.flags.push(`Tight cash conversion cycle (${recentRatios.cashConversionCycle.toFixed(0)} days) — working-capital-light`);
    }
  }
  if (debtToEquity !== null && debtToEquity > 1.5) {
    acctQ.flags.push(`Debt/Equity ${debtToEquity.toFixed(2)} — elevated leverage`);
  }

  // Promoter holding trend
  const shHistory = screener?.shareholding || [];
  if (shHistory.length >= 2) {
    const cur = shHistory[shHistory.length - 1]?.promoters;
    const prior = shHistory[shHistory.length - 4]?.promoters;
    if (cur != null && prior != null) {
      const delta = cur - prior;
      if (delta < -1) acctQ.flags.push(`Promoter holding declined ${(-delta).toFixed(2)} pp over 3 quarters — review for stake dilution`);
      else if (delta > 1) acctQ.flags.push(`Promoter holding increased ${delta.toFixed(2)} pp — accumulation signal`);
    }
  }

  const narrativeRes = computeNarrativeScore(themes, themeRes.confidence);

  // ── JAT signals from quarterly trend ──────────────────────────────────
  const jatSignals: JatSignal[] = [];
  if (quarters.length >= 4) {
    const recent4 = quarters.slice(-4);
    const recentRev = recent4.map((q) => q.sales).filter((v): v is number => v !== null);
    if (recentRev.length >= 3) {
      const trend = recentRev[recentRev.length - 1] - recentRev[0];
      const pct = recentRev[0] !== 0 ? (trend / recentRev[0]) * 100 : 0;
      jatSignals.push({
        name: 'Revenue 4Q trajectory',
        direction: pct > 5 ? 'improving' : pct < -5 ? 'deteriorating' : 'stable',
        weight: 1.5,
      });
    }
    const recentMargin = recent4.map((q) => q.opmPct).filter((v): v is number => v !== null);
    if (recentMargin.length >= 3) {
      const trend = recentMargin[recentMargin.length - 1] - recentMargin[0];
      jatSignals.push({
        name: 'OPM 4Q trajectory',
        direction: trend > 1 ? 'improving' : trend < -1 ? 'deteriorating' : 'stable',
        weight: 1.5,
      });
    }
    const recentNet = recent4.map((q) => q.netProfit).filter((v): v is number => v !== null);
    if (recentNet.length >= 3) {
      const trend = recentNet[recentNet.length - 1] - recentNet[0];
      const pct = recentNet[0] !== 0 ? (trend / Math.abs(recentNet[0])) * 100 : 0;
      jatSignals.push({
        name: 'Net Profit 4Q trajectory',
        direction: pct > 10 ? 'improving' : pct < -10 ? 'deteriorating' : 'stable',
        weight: 1.0,
      });
    }
  }
  const jatRes = computeJatScore(jatSignals);

  // ── History rows for trend section (last 8 quarters) ──────────────────
  const historyRows = quarters.slice(-8).map((q) => ({
    date: q.period,
    period: q.period,
    revenue: cr(q.sales),
    revenueEstimate: null,        // No India consensus on free tier
    revenueSurprisePct: null,
    grossMargin: null,
    operatingMargin: q.opmPct,
    ebitdaMargin: q.opmPct,
    netMargin: q.netMargin,
    eps: q.eps,
    epsEstimate: null,
    epsSurprisePct: null,
    fcf: null,
  }));

  // ── Reaction score: SUPPRESSED for India (fundamentals-only mode) ─────
  // Per institutional spec: do NOT render fake reaction grades when there
  // is no consensus to surprise against.
  const reactionScore = {
    score: 50,
    grade: 'C-',
    confidence: 0,
    breakdown: {
      revenue_surprise: { score: null, weight: 0.25, reason: 'No India consensus available on free-tier providers' },
      eps_surprise: { score: null, weight: 0.25, reason: 'No India consensus available' },
      ebitda_margin_surprise: { score: null, weight: 0.15, reason: 'No India consensus available' },
      guidance: { score: null, weight: 0.20, reason: 'No structured guidance signal extracted' },
      mgmt_tone: { score: null, weight: 0.10, reason: 'No filing prose available for tone classification' },
      narrative: { score: narrativeRes.score, weight: 0.05 },
    },
    unavailableReason: 'India consensus not available — fundamentals-only mode',
  };

  // ── Reaction probability: explicit fundamentals-only ──────────────────
  const reactionProbability = {
    expected: 'flat' as const,
    confidence: 'low' as const,
    summary:
      'Consensus coverage unavailable for Indian midcap. Displaying fundamentals-only institutional analysis (no beat/miss scoring).',
  };

  // ── Key takeaways from quarterly trend ────────────────────────────────
  const takeaways: string[] = [];
  if (metrics.revenue.yoyPct !== null) {
    const dir = metrics.revenue.yoyPct >= 0 ? 'grew' : 'contracted';
    takeaways.push(`Revenue ${dir} ${metrics.revenue.yoyPct.toFixed(1)}% YoY (${periodLabel})`);
  }
  if (metrics.revenue.qoqPct !== null && Math.abs(metrics.revenue.qoqPct) >= 5) {
    const dir = metrics.revenue.qoqPct >= 0 ? 'up' : 'down';
    takeaways.push(`Revenue ${dir} ${Math.abs(metrics.revenue.qoqPct).toFixed(1)}% QoQ`);
  }
  if (metrics.ebitdaMargin.qoqBps !== null && Math.abs(metrics.ebitdaMargin.qoqBps) >= 50) {
    const dir = metrics.ebitdaMargin.qoqBps >= 0 ? 'expanded' : 'compressed';
    takeaways.push(`OPM ${dir} ${Math.abs(metrics.ebitdaMargin.qoqBps)} bps QoQ to ${grossMarginPct?.toFixed(1)}%`);
  }
  if (metrics.netIncome.yoyPct !== null) {
    const dir = metrics.netIncome.yoyPct >= 0 ? 'grew' : 'contracted';
    takeaways.push(`PAT ${dir} ${metrics.netIncome.yoyPct.toFixed(1)}% YoY`);
  }
  if (acctQ.flags.length > 0) takeaways.push(acctQ.flags[0]);
  if (themes.length > 0 && themes[0].strength === 'high') {
    takeaways.push(`Strong thematic exposure: ${themes[0].theme}`);
  }
  takeaways.push(`Sector: ${sectorTemplate.displayName} — KPIs to track: ${sectorTemplate.kpis.slice(0, 3).map((k) => k.label).join(', ')}`);

  // ── INDIA EXTRAS — fundamentals-mode dedicated payload ──────────────────
  const indiaExtras: IndiaExtras = computeIndiaExtras({
    screener,
    sector,
    sectorTemplate,
    sectorStr,
    industryStr,
    subIndStr,
    quarters,
    cfoOverPat,
  });

  return {
    ticker,
    company: screener?.company || fmpProfile?.companyName || ticker,
    quarter: periodLabel,
    filingType,
    exchange: fmpProfile?.exchange || 'NSE',
    sector: sectorTemplate.displayName,
    industry: industryStr || null,
    marketCap: screener?.topMetrics?.marketCap !== undefined && screener?.topMetrics?.marketCap !== null
      ? screener.topMetrics.marketCap * 10_000_000  // Cr → raw INR
      : (fmpProfile?.marketCap ?? null),
    enterpriseValue: null,
    reportTime: 'unknown',
    currency: 'INR',
    scaleLabel: '₹ Cr',
    metrics,
    guidance: {
      direction: 'na',
      revenue: null,
      eps: null,
      ebitda: null,
      commentary: [],
    },
    qualitative: {
      mgmtTone: toneRes.tone,
      toneConfidence: toneRes.confidence,
      themes,
      keyTakeaways: takeaways,
    },
    history: historyRows,
    streak: {
      revenueBeats: 0,
      revenueAttempts: 0,
      epsBeats: 0,
      epsAttempts: 0,
      avgRevenueSurprise: null,
      avgEpsSurprise: null,
    },
    sellSide: null,
    accountingQuality: {
      cfoOverPat,
      arGrowthVsRevenuePct: null,
      inventoryGrowthVsRevenuePct: null,
      sbcIntensity: null,
      debtToEbitda: null,
      fcfMargin: null,
      flags: acctQ.flags,
    },
    scores: {
      reaction: reactionScore as any,
      accounting: { score: acctQ.score, grade: acctQ.grade, confidence: acctQ.confidence, flags: acctQ.flags },
      narrative: narrativeRes,
      jat: jatRes,
    },
    reactionProbability,
    sectionStatus: {
      estimates: {
        available: false, confidence: 0,
        reason: 'India consensus not available on free-tier APIs (Trendlyne / Tickertape integration would be required for institutional analyst data)',
      },
      sellSide: {
        available: false, confidence: 0,
        reason: 'India sell-side ratings not available on free-tier providers',
      },
      history: {
        available: historyRows.length > 0,
        confidence: historyRows.length >= 4 ? 95 : historyRows.length >= 2 ? 60 : 0,
        reason: historyRows.length === 0 ? 'No quarterly history extracted from Screener.in' : null,
      },
      themes: {
        available: themes.length > 0,
        confidence: themeRes.confidence,
        reason: themeRes.unavailableReason,
      },
      guidance: {
        available: false, confidence: 0,
        reason: 'No guidance text available — upload concall transcript for guidance extraction',
      },
    },
    debug: {
      endpointsHit,
      endpointsFailed,
      fallbacksUsed: [
        ...fallbacksUsed,
        'India mode: fundamentals-only (no consensus, no reaction scoring)',
        `Sector classification: ${sector}`,
        usedNse
          ? 'Quarterly P&L: NSE financial-results (primary)'
          : 'Quarterly P&L: Screener.in (NSE unavailable or insufficient quarters)',
      ],
      corpusChars: themeRes.corpusChars,
    },
    sources: {
      financials: financialsSource,
      estimates: 'unavailable',
      history: historySource,
    },
    indiaExtras,
    analysisMode: 'india_fundamental_only',
    validationWarnings: [
      'India fundamentals-only mode — consensus surprise scoring suppressed',
      `Sector KPIs to track: ${sectorTemplate.kpis.filter((k) => k.importance === 'critical').map((k) => k.label).join(' · ')}`,
    ],
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeIndiaExtras — fundamentals-mode payload
// ─────────────────────────────────────────────────────────────────────────────
function computeIndiaExtras(opts: {
  screener: ScreenerInput | null;
  sector: IndiaSector;
  sectorTemplate: typeof INDIA_SECTOR_TEMPLATES[IndiaSector];
  sectorStr: string;
  industryStr: string;
  subIndStr: string;
  quarters: NonNullable<ScreenerInput['quarterly']>;
  cfoOverPat: number | null;
}): IndiaExtras {
  const { screener, sector, sectorTemplate, sectorStr, industryStr, subIndStr, quarters, cfoOverPat } = opts;

  // Top metrics passthrough
  const tm = screener?.topMetrics || ({} as any);
  const topMetrics = {
    marketCapCr: tm.marketCap ?? null,
    cmp: tm.currentPrice ?? null,
    peRatio: tm.peRatio ?? null,
    bookValue: tm.bookValue ?? null,
    dividendYieldPct: tm.dividendYieldPct ?? null,
    roce: tm.roce ?? null,
    roe: tm.roe ?? null,
    promoterHoldingPct: tm.promoterHoldingPct ?? null,
    debtToEquity: tm.debtToEquity ?? null,
  };

  // Working capital — most recent annual ratios from screener
  const ratios = screener?.ratios || [];
  const recentRatios =
    ratios
      .map((r) => r)
      .reverse()
      .find((r) => r.cashConversionCycle !== null || r.debtorDays !== null) || null;
  const workingCapital = {
    debtorDays: recentRatios?.debtorDays ?? null,
    inventoryDays: recentRatios?.inventoryDays ?? null,
    daysPayable: recentRatios?.daysPayable ?? null,
    cashConversionCycle: recentRatios?.cashConversionCycle ?? null,
    workingCapitalDays: recentRatios?.workingCapitalDays ?? null,
    cfoOverPat,
    interestCoverage: null,
    asOfPeriod: recentRatios?.period ?? null,
  };

  // Promoter trend — last 12 quarters of shareholding
  const sh = screener?.shareholding || [];
  const last = sh[sh.length - 1] || null;
  const prev = sh[sh.length - 2] || null;
  const yoy = sh.length >= 5 ? sh[sh.length - 5] : null;
  const flags: string[] = [];
  const promoterChangeQoQ =
    last?.promoters != null && prev?.promoters != null ? Math.round((last.promoters - prev.promoters) * 100) / 100 : null;
  const promoterChangeYoY =
    last?.promoters != null && yoy?.promoters != null ? Math.round((last.promoters - yoy.promoters) * 100) / 100 : null;
  const fiiChangeQoQ =
    last?.fii != null && prev?.fii != null ? Math.round((last.fii - prev.fii) * 100) / 100 : null;
  const diiChangeQoQ =
    last?.dii != null && prev?.dii != null ? Math.round((last.dii - prev.dii) * 100) / 100 : null;

  if (promoterChangeQoQ !== null && promoterChangeQoQ <= -0.5) {
    flags.push(`Promoter holding ↓ ${Math.abs(promoterChangeQoQ).toFixed(2)} pp QoQ — review for stake dilution`);
  } else if (promoterChangeQoQ !== null && promoterChangeQoQ >= 0.3) {
    flags.push(`Promoter holding ↑ ${promoterChangeQoQ.toFixed(2)} pp QoQ — accumulation signal`);
  }
  if (fiiChangeQoQ !== null && fiiChangeQoQ >= 1) {
    flags.push(`FII inflow +${fiiChangeQoQ.toFixed(2)} pp QoQ — institutional accumulation`);
  } else if (fiiChangeQoQ !== null && fiiChangeQoQ <= -1) {
    flags.push(`FII outflow ${fiiChangeQoQ.toFixed(2)} pp QoQ — institutional distribution`);
  }
  if (diiChangeQoQ !== null && diiChangeQoQ >= 1) {
    flags.push(`DII inflow +${diiChangeQoQ.toFixed(2)} pp QoQ — domestic institutional buying`);
  }

  const governance = {
    promoterHoldingPct: last?.promoters ?? topMetrics.promoterHoldingPct,
    promoterChangeQoQ,
    promoterChangeYoY,
    fiiHoldingPct: last?.fii ?? null,
    fiiChangeQoQ,
    diiHoldingPct: last?.dii ?? null,
    diiChangeQoQ,
    publicHoldingPct: last?.public ?? null,
    pledgePct: null,
    flags,
  };

  // Quarterly trend with QoQ + YoY computed
  const qtrendBase = quarters.slice(-8).map((q, idx, arr) => {
    const prevQ = idx > 0 ? arr[idx - 1] : null;
    const yoyQ = idx >= 4 ? arr[idx - 4] : null;
    const qoqRev =
      q.sales != null && prevQ?.sales != null && prevQ.sales !== 0
        ? Math.round(((q.sales - prevQ.sales) / Math.abs(prevQ.sales)) * 10000) / 100
        : null;
    const qoqProfit =
      q.netProfit != null && prevQ?.netProfit != null && prevQ.netProfit !== 0
        ? Math.round(((q.netProfit - prevQ.netProfit) / Math.abs(prevQ.netProfit)) * 10000) / 100
        : null;
    const yoyRev =
      q.sales != null && yoyQ?.sales != null && yoyQ.sales !== 0
        ? Math.round(((q.sales - yoyQ.sales) / Math.abs(yoyQ.sales)) * 10000) / 100
        : null;
    const yoyProfit =
      q.netProfit != null && yoyQ?.netProfit != null && yoyQ.netProfit !== 0
        ? Math.round(((q.netProfit - yoyQ.netProfit) / Math.abs(yoyQ.netProfit)) * 10000) / 100
        : null;
    const yoyOpmBps =
      q.opmPct != null && yoyQ?.opmPct != null
        ? Math.round((q.opmPct - yoyQ.opmPct) * 100)
        : null;
    return {
      period: q.period,
      revenue: q.sales,
      operatingProfit: q.operatingProfit,
      opmPct: q.opmPct,
      netProfit: q.netProfit,
      netMarginPct: q.netMargin,
      eps: q.eps,
      qoqRevenuePct: qoqRev,
      qoqProfitPct: qoqProfit,
      yoyRevenuePct: yoyRev,
      yoyProfitPct: yoyProfit,
      yoyOpmBps,
    };
  });

  // Sector KPI checklist — mark which we have data for
  const sectorBlock = {
    slug: sector,
    displayName: sectorTemplate.displayName,
    sectorString: sectorStr || null,
    industryString: industryStr || null,
    subIndustryString: subIndStr || null,
    kpis: sectorTemplate.kpis.map((k) => {
      // Currently we don't extract sector-specific KPIs from filings.
      // The framework is present; the data layer is the next milestone.
      // For working-capital-driven sectors, mark the WC KPIs as tracked.
      let tracked = false;
      let value: string | undefined;
      if (k.label.toLowerCase().includes('cash conversion') && workingCapital.cashConversionCycle !== null) {
        tracked = true; value = `${workingCapital.cashConversionCycle.toFixed(0)} days`;
      } else if (k.label.toLowerCase().includes('debtor') && workingCapital.debtorDays !== null) {
        tracked = true; value = `${workingCapital.debtorDays.toFixed(0)} days`;
      } else if (k.label.toLowerCase().includes('inventory') && workingCapital.inventoryDays !== null) {
        tracked = true; value = `${workingCapital.inventoryDays.toFixed(0)} days`;
      } else if (k.label.toLowerCase().includes('working capital') && workingCapital.workingCapitalDays !== null) {
        tracked = true; value = `${workingCapital.workingCapitalDays.toFixed(0)} days`;
      } else if (/op\s*-?\s*margin|opm|operating\s+profit/i.test(k.label) && qtrendBase.at(-1)?.opmPct != null) {
        tracked = true; value = `${qtrendBase.at(-1)!.opmPct!.toFixed(1)}%`;
      } else if (/net\s+margin/i.test(k.label) && qtrendBase.at(-1)?.netMarginPct != null) {
        tracked = true; value = `${qtrendBase.at(-1)!.netMarginPct!.toFixed(1)}%`;
      } else if (/d\/e|debt.{0,3}equity/i.test(k.label) && topMetrics.debtToEquity != null) {
        tracked = true; value = `${topMetrics.debtToEquity.toFixed(2)}x`;
      } else if (/roe/i.test(k.label) && topMetrics.roe != null) {
        tracked = true; value = `${topMetrics.roe.toFixed(1)}%`;
      } else if (/roce/i.test(k.label) && topMetrics.roce != null) {
        tracked = true; value = `${topMetrics.roce.toFixed(1)}%`;
      }
      return { label: k.label, description: k.description, importance: k.importance, tracked, value };
    }),
    macroThemes: sectorTemplate.themes,
    redFlags: sectorTemplate.redFlags,
  };

  // Fundamental composite — replaces "reaction score" for India
  // Components: growth (revenue YoY), margin (OPM trend), working capital,
  //             promoter (stability), cash conversion (CFO/PAT)
  const last8 = qtrendBase.slice(-8);
  const lastQuarterRow = last8.at(-1);
  const lastRevYoY = lastQuarterRow?.yoyRevenuePct ?? null;
  const lastProfitYoY = lastQuarterRow?.yoyProfitPct ?? null;
  const lastOpmYoY = lastQuarterRow?.yoyOpmBps ?? null;

  const score01 = (v: number, lo: number, hi: number) =>
    Math.max(0, Math.min(100, Math.round(((v - lo) / (hi - lo)) * 100)));

  const growthScore =
    lastRevYoY !== null
      ? score01(lastRevYoY, -10, 30)  // -10% revenue → 0; +30% → 100
      : 50;
  const marginScore =
    lastOpmYoY !== null
      ? score01(lastOpmYoY, -300, 300) // ±300 bps band
      : (lastQuarterRow?.opmPct ?? 0) > 15 ? 65 : 50;
  const workingCapitalScore =
    workingCapital.cashConversionCycle !== null
      ? score01(-workingCapital.cashConversionCycle, -120, 0) // 120d → 0; 0d → 100
      : 50;
  const promoterScore =
    promoterChangeQoQ !== null
      ? score01(promoterChangeQoQ, -1.0, 1.0)
      : (governance.promoterHoldingPct !== null && governance.promoterHoldingPct >= 50 ? 65 : 50);
  const cashConversionScore =
    cfoOverPat !== null
      ? score01(cfoOverPat, 0.4, 1.5)
      : 50;

  const overall = Math.round(
    growthScore * 0.30 +
    marginScore * 0.25 +
    workingCapitalScore * 0.15 +
    promoterScore * 0.15 +
    cashConversionScore * 0.15,
  );

  const grade =
    overall >= 85 ? 'A' :
    overall >= 75 ? 'A-' :
    overall >= 65 ? 'B+' :
    overall >= 55 ? 'B' :
    overall >= 45 ? 'C+' :
    overall >= 35 ? 'C' : 'D';

  const direction: 'improving' | 'stable' | 'deteriorating' =
    overall >= 65 ? 'improving' : overall <= 40 ? 'deteriorating' : 'stable';

  const confidence: 'high' | 'medium' | 'low' =
    last8.length >= 6 ? 'high' : last8.length >= 3 ? 'medium' : 'low';

  const labelFor = (s: number) =>
    s >= 75 ? 'strong' : s >= 60 ? 'healthy' : s >= 45 ? 'mixed' : s >= 30 ? 'soft' : 'weak';

  const fundamentalScore = {
    overall,
    grade,
    components: {
      growth: { score: growthScore, label: labelFor(growthScore) },
      margin: { score: marginScore, label: labelFor(marginScore) },
      working_capital: { score: workingCapitalScore, label: labelFor(workingCapitalScore) },
      promoter: { score: promoterScore, label: labelFor(promoterScore) },
      cash_conversion: { score: cashConversionScore, label: labelFor(cashConversionScore) },
    },
    direction,
    confidence,
  };

  return {
    topMetrics,
    workingCapital,
    governance,
    quarterlyTrend: qtrendBase,
    sector: sectorBlock,
    fundamentalScore,
  };
}
