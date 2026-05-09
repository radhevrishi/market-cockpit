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
import { classifyIndiaSector, INDIA_SECTOR_TEMPLATES, IndiaSector, WC_BENCHMARKS, assessValuation } from './india-sectors';
import { inferGuidance } from './build';
import { extractIndiaConcallInsights } from './india-concall';

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
  staleness?: {
    monthsOld: number | null;
    isStale: boolean;
    latestPeriod: string | null;
  };
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
  // Use ONLY the curated Screener.in classification fields. Do NOT pass
  // FMP's free-text description into the classifier — FMP descriptions
  // enumerate every end-use industry the company's products touch, e.g.
  // AEROFLEX (industrial flexible-hose manufacturer) describes products
  // as "used in aerospace and defense, semiconductors, robotics, hydrogen,
  // electric mobility, natural gas, steel, petrochemicals, solar,
  // chemicals, food and pharmaceuticals, paper and pulp, HVAC". The word
  // "pharmaceutical" inside that end-use list previously caused the
  // pharma regex to fire and tag Aeroflex as a pharma company.
  //
  // Source-of-truth priority for sector / industry:
  //   1. Screener.in sector + industry (authoritative classification)
  //   2. Screener.in subIndustry (when available)
  //   3. FMP industry field (NOT description) — only used when Screener
  //      industry is missing entirely
  // FMP description is reserved for the theme corpus only (see below)
  // and is NEVER used for taxonomic sector mapping.
  const sectorStr = screener?.sector || '';
  const industryStr = screener?.industry || fmpProfile?.industry || '';
  const subIndStr = screener?.subIndustry || '';
  const classifyText = [sectorStr, subIndStr].filter(Boolean).join(' ');
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
  // CRITICAL: do NOT inject sectorTemplate.themes into the corpus. Doing
  // so creates a self-fulfilling prophecy where a misclassified sector
  // pushes its own theme keywords ("US generics pricing", "CDMO", "GLP-1",
  // etc.) into the corpus, and the detector "rediscovers" them as
  // evidence. AEROFLEX exhibited this: pharma misclassification fed
  // pharma themes into the corpus, which then triggered the Pharma
  // theme as "high" with `cdmo / us generics / ipm growth` listed as
  // evidence — even though the company's actual concall and description
  // contain none of those phrases.
  //
  // Also exclude FMP description from theme corpus: it enumerates every
  // end-use industry which spuriously triggers themes that don't apply
  // to the issuer (semiconductor / pharma / aerospace exposure on a
  // generic flex-hose manufacturer).
  //
  // Theme evidence MUST come from external authored text only:
  //   - Screener company about (curated paragraph, not end-use list)
  //   - Industry/sector labels (taxonomic, short)
  //   - Concall transcript (rawText) — what management actually said
  const themeCorpus = [
    screener?.about || '',
    industryStr,
    sectorStr,
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
    rawText,
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
    guidance: rawText && rawText.trim().length > 50
      ? inferGuidance(rawText)
      : {
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
      guidance: (() => {
        if (!rawText || rawText.trim().length <= 50) {
          return {
            available: false, confidence: 0,
            reason: 'Upload concall transcript or investor presentation for tone + guidance extraction',
          };
        }
        const g = inferGuidance(rawText);
        const hasDirection = g.direction !== 'na';
        const hasCommentary = g.commentary.length > 0;
        return {
          available: hasDirection || hasCommentary,
          confidence: hasDirection ? 75 : hasCommentary ? 50 : 0,
          reason: hasDirection
            ? null
            : hasCommentary
              ? 'Commentary extracted but no clear direction (raised / lowered / maintained)'
              : 'Concall text uploaded but no guidance language matched',
        };
      })(),
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
  rawText?: string;
}): IndiaExtras {
  const { screener, sector, sectorTemplate, sectorStr, industryStr, subIndStr, quarters, cfoOverPat, rawText } = opts;

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
  // Sector-aware working capital thresholds. Pulled from WC_BENCHMARKS
  // keyed off the classified sector — so a 122-day inventory cycle reads
  // green for capital goods (normal) and red for FMCG (alarming).
  const wcBench = WC_BENCHMARKS[sector];
  const workingCapital = {
    debtorDays: recentRatios?.debtorDays ?? null,
    inventoryDays: recentRatios?.inventoryDays ?? null,
    daysPayable: recentRatios?.daysPayable ?? null,
    cashConversionCycle: recentRatios?.cashConversionCycle ?? null,
    workingCapitalDays: recentRatios?.workingCapitalDays ?? null,
    cfoOverPat,
    interestCoverage: null,
    asOfPeriod: recentRatios?.period ?? null,
    benchmarks: {
      ...wcBench,
      sectorLabel: sectorTemplate.displayName,
    },
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

  // ── PROMOTER TRUST SCORE ─────────────────────────────────────────────
  // Composite 0-100 governance signal. Inputs:
  //   - Stability      40%  (promoter % YoY change)
  //   - Pledge         30%  (level + trend; mostly null on Screener free tier)
  //   - Consistency    15%  (8Q standard deviation of promoter holding)
  //   - Institutional  15%  (FII / DII confirming flows)
  const trustScore = (() => {
    let stabilityRaw = 50;
    let stabilityReason = 'Promoter holding data missing';
    if (promoterChangeYoY !== null) {
      if (promoterChangeYoY <= -5) { stabilityRaw = 10; stabilityReason = `Promoter holding ↓${Math.abs(promoterChangeYoY).toFixed(2)}pp YoY — material dilution`; }
      else if (promoterChangeYoY <= -2) { stabilityRaw = 30; stabilityReason = `Promoter holding ↓${Math.abs(promoterChangeYoY).toFixed(2)}pp YoY — meaningful dilution`; }
      else if (promoterChangeYoY <= -0.5) { stabilityRaw = 55; stabilityReason = `Promoter holding ↓${Math.abs(promoterChangeYoY).toFixed(2)}pp YoY — modest decline`; }
      else if (promoterChangeYoY < 0.5) { stabilityRaw = 75; stabilityReason = 'Promoter holding flat YoY — stable'; }
      else if (promoterChangeYoY < 2) { stabilityRaw = 90; stabilityReason = `Promoter holding ↑${promoterChangeYoY.toFixed(2)}pp YoY — accumulation`; }
      else { stabilityRaw = 100; stabilityReason = `Promoter holding ↑${promoterChangeYoY.toFixed(2)}pp YoY — strong accumulation`; }
    }

    // Pledge — Screener free tier rarely fills this. Default to neutral (60).
    // When BSE/NSE pledge filings are wired in (future patch), this will
    // pick up the actual percentage.
    const pledgeLevel: number | null = (screener as any)?.topMetrics?.pledgePct ?? null;
    let pledgeRaw = 60;
    let pledgeReason = 'Pledge data not reported on Screener';
    if (pledgeLevel !== null && pledgeLevel !== undefined) {
      const pl: number = pledgeLevel;
      if (pl > 50) { pledgeRaw = 0; pledgeReason = `${pl.toFixed(1)}% of promoter holding pledged — severe stress`; }
      else if (pl > 20) { pledgeRaw = 25; pledgeReason = `${pl.toFixed(1)}% pledged — elevated risk`; }
      else if (pl > 5) { pledgeRaw = 60; pledgeReason = `${pl.toFixed(1)}% pledged — moderate`; }
      else { pledgeRaw = 100; pledgeReason = `${pl.toFixed(1)}% pledged — clean`; }
    }

    // Consistency — std-dev of promoter holding over the trailing 8 quarters
    let consistencyRaw = 70;
    let consistencyReason = 'Insufficient history for stability check';
    if (sh.length >= 4) {
      const series = sh.slice(-8).map((s: any) => s.promoters).filter((v: any): v is number => typeof v === 'number');
      if (series.length >= 3) {
        const mean = series.reduce((a, b) => a + b, 0) / series.length;
        const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length;
        const sd = Math.sqrt(variance);
        if (sd < 0.5) { consistencyRaw = 100; consistencyReason = `Promoter % near-perfectly stable (sd ${sd.toFixed(2)}pp)`; }
        else if (sd < 1) { consistencyRaw = 85; consistencyReason = `Promoter % consistent (sd ${sd.toFixed(2)}pp)`; }
        else if (sd < 2) { consistencyRaw = 60; consistencyReason = `Promoter % wobbly (sd ${sd.toFixed(2)}pp over 8Q)`; }
        else { consistencyRaw = 25; consistencyReason = `Promoter % volatile (sd ${sd.toFixed(2)}pp over 8Q) — large swings`; }
      }
    }

    // Institutional confirmation
    let instRaw = 50;
    let instReason = 'No clear institutional flow signal';
    if (fiiChangeQoQ !== null && diiChangeQoQ !== null) {
      const fiiPos = fiiChangeQoQ >= 0.5;
      const diiPos = diiChangeQoQ >= 0.5;
      const fiiNeg = fiiChangeQoQ <= -0.5;
      const diiNeg = diiChangeQoQ <= -0.5;
      if (fiiPos && diiPos) { instRaw = 100; instReason = 'Both FII and DII increasing stake QoQ'; }
      else if (fiiPos || diiPos) { instRaw = 75; instReason = `${fiiPos ? 'FII' : 'DII'} increasing stake QoQ`; }
      else if (fiiNeg && diiNeg) { instRaw = 15; instReason = 'Both FII and DII reducing stake — broad distribution'; }
      else if (fiiNeg || diiNeg) { instRaw = 35; instReason = `${fiiNeg ? 'FII' : 'DII'} reducing stake QoQ`; }
    }

    const overallTrust = Math.round(
      stabilityRaw * 0.40 +
      pledgeRaw * 0.30 +
      consistencyRaw * 0.15 +
      instRaw * 0.15,
    );

    let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'F';
    let verdict = '';
    if (overallTrust >= 85) { grade = 'A'; verdict = 'Promoter actions align with shareholders'; }
    else if (overallTrust >= 70) { grade = 'B'; verdict = 'Stable promoter behaviour, no material flags'; }
    else if (overallTrust >= 50) { grade = 'C'; verdict = 'Mixed governance signals — monitor closely'; }
    else if (overallTrust >= 30) { grade = 'D'; verdict = 'Multiple governance concerns'; }
    else { grade = 'F'; verdict = 'Material governance risk — investigate before adding'; }

    return {
      score: overallTrust,
      grade,
      verdict,
      breakdown: {
        stability: { score: Math.round(stabilityRaw), reason: stabilityReason },
        pledge: { score: Math.round(pledgeRaw), reason: pledgeReason },
        consistency: { score: Math.round(consistencyRaw), reason: consistencyReason },
        institutional: { score: Math.round(instRaw), reason: instReason },
      },
    };
  })();
  // Helper alias used by trustScore IIFE above — pledgePct field will be null
  // until we wire a pledge data source. Defined here for hoist.
  function _placeholder() {}

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
    trustScore,
  };

  // Quarterly trend with QoQ + YoY computed
  const pctChange = (cur: number | null | undefined, base: number | null | undefined): number | null =>
    cur != null && base != null && base !== 0
      ? Math.round(((cur - base) / Math.abs(base)) * 10000) / 100
      : null;
  const bpsChange = (cur: number | null | undefined, base: number | null | undefined): number | null =>
    cur != null && base != null ? Math.round((cur - base) * 100) : null;

  // Skip quarters with no revenue — usually appear when NSE-primary returned
  // fewer than 8 quarters and Screener's older periods got dropped during
  // the merge. Empty rows clutter the trend table without adding signal.
  const validQuarters = quarters.filter((q) => q.sales !== null);
  const qtrendBase = validQuarters.slice(-8).map((q, idx, arr) => {
    const prevQ = idx > 0 ? arr[idx - 1] : null;
    const yoyQ = idx >= 4 ? arr[idx - 4] : null;
    return {
      period: q.period,
      revenue: q.sales,
      operatingProfit: q.operatingProfit,
      opmPct: q.opmPct,
      netProfit: q.netProfit,
      netMarginPct: q.netMargin,
      eps: q.eps,
      qoqRevenuePct: pctChange(q.sales, prevQ?.sales),
      qoqProfitPct: pctChange(q.netProfit, prevQ?.netProfit),
      yoyRevenuePct: pctChange(q.sales, yoyQ?.sales),
      yoyProfitPct: pctChange(q.netProfit, yoyQ?.netProfit),
      yoyOpmBps: bpsChange(q.opmPct, yoyQ?.opmPct),
      // ── Additional deltas surfaced in Latest Quarter summary table ──────
      qoqOpProfitPct: pctChange(q.operatingProfit, prevQ?.operatingProfit),
      yoyOpProfitPct: pctChange(q.operatingProfit, yoyQ?.operatingProfit),
      qoqOpmBps: bpsChange(q.opmPct, prevQ?.opmPct),
      qoqEpsPct: pctChange(q.eps, prevQ?.eps),
      yoyEpsPct: pctChange(q.eps, yoyQ?.eps),
      qoqNetMarginBps: bpsChange(q.netMargin, prevQ?.netMargin),
      yoyNetMarginBps: bpsChange(q.netMargin, yoyQ?.netMargin),
    };
  });

  // ── Concall extraction (only when transcript was supplied) ──
  const concallInsights =
    rawText && rawText.trim().length >= 50
      ? extractIndiaConcallInsights(rawText, sectorTemplate)
      : null;

  // Sector KPI checklist — mark which we have data for
  const concallKpiByLabel = new Map<string, string>();
  for (const hit of concallInsights?.sectorKpiHits || []) {
    concallKpiByLabel.set(hit.label, hit.quote);
  }

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
      // Concall transcript override — if the user pasted a transcript and it
      // mentions this KPI, mark tracked even if we had no quantitative value.
      if (!tracked && concallKpiByLabel.has(k.label)) {
        tracked = true;
        value = 'mentioned in concall';
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
  // Sector-aware working capital score. The previous fixed 120-day CCC
  // anchor punished capital-goods / defense / real-estate companies for
  // running structurally long cycles even when they were mid-of-pack
  // for their peer set. AEROFLEX (Iron & Steel Products) had CCC 112d,
  // scoring 7/100 on the universal scale — but 112d is roughly mid-cycle
  // for industrial flexible-hose manufacturers. Using the sector
  // benchmark band [good, mid, bad] from WC_BENCHMARKS the score
  // becomes linear from bad_floor → good_max.
  const wcBenchCCC = wcBench.cashConvCycle; // [good, mid, bad]
  const workingCapitalScore =
    workingCapital.cashConversionCycle !== null
      ? score01(-workingCapital.cashConversionCycle, -wcBenchCCC[2], -wcBenchCCC[0])
      : 50;
  // Promoter signal — sliding scale recalibrated.
  //
  // OLD logic: score01(promoterChangeQoQ, -1.0, 1.0) which mapped a
  // 1.52 pp decline to score 0/100 — that's "severe governance risk"
  // territory and is excessively punitive. A 1-2 pp drop on a single
  // quarter could be OFS / institutional placement / family
  // structuring / ESOP dilution — NOT automatically a sell signal.
  //
  // NEW: wider band so small declines don't slam to floor.
  //   -3 pp QoQ → ~0   (severe — large drop, governance flag)
  //   -2 pp QoQ → ~25
  //   -1.5 pp   → ~37  (AEROFLEX case)
  //   -1   pp   → ~50
  //   -0.5 pp   → ~62
  //    0   pp   → ~75
  //   +1   pp   → ~100 (accumulation)
  // Combined with promoter_holding floor (>= 50% → +5 bias) and trust
  // breakdown items (pledge / consistency / institutional flow).
  const promoterScore = (() => {
    if (promoterChangeQoQ === null) {
      return (governance.promoterHoldingPct !== null && governance.promoterHoldingPct >= 50 ? 65 : 50);
    }
    const base = score01(promoterChangeQoQ, -3.0, 1.0);
    // Add small floor bonus when absolute holding is high (>= 60%)
    // since strong baseline holding partially offsets a single QoQ tick.
    const floorBonus = (governance.promoterHoldingPct ?? 0) >= 60 ? 5 : 0;
    return Math.min(100, Math.round(base + floorBonus));
  })();
  // CFO/PAT score also sector-aware. Anchor: mid threshold scores ~50,
  // good threshold scores ~90, well above good caps at 100.
  const cfoBench = wcBench.cfoOverPat;
  const cashConversionScore =
    cfoOverPat !== null
      ? score01(cfoOverPat, cfoBench.mid - 0.3, cfoBench.good + 0.5)
      : 50;

  // ── FORWARD OUTLOOK COMPONENT ────────────────────────────────────────
  // Sixth component, only populated when a concall transcript is available.
  // Map concallScore (0-100) directly, with a small adjustment from explicit
  // guidance direction (raised → +10, lowered → −15, introduced/maintained
  // neutral). Capped at 0-100.
  const guidanceDirRaw = rawText && rawText.trim().length > 50
    ? inferGuidance(rawText).direction
    : 'na';
  const forwardScore = (() => {
    if (!concallInsights || concallInsights.charsAnalyzed === 0) return null;
    let base = concallInsights.concallScore;
    if (guidanceDirRaw === 'raised') base += 10;
    else if (guidanceDirRaw === 'lowered') base -= 15;
    return Math.max(0, Math.min(100, Math.round(base)));
  })();

  // ── COMPOSITE ────────────────────────────────────────────────────────
  // When forward is present, give it ~25% weight and re-weight the others.
  // When absent, fall back to original 5-component weighting.
  const overall = forwardScore !== null
    ? Math.round(
        growthScore * 0.22 +
        marginScore * 0.20 +
        workingCapitalScore * 0.12 +
        promoterScore * 0.10 +
        cashConversionScore * 0.11 +
        forwardScore * 0.25,
      )
    : Math.round(
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

  // Forward outlook tilts the direction even when current-state composite
  // is middling — a very-positive concall pushes neutral fundamentals into
  // 'improving'; a weak concall does the opposite.
  let direction: 'improving' | 'stable' | 'deteriorating' =
    overall >= 65 ? 'improving' : overall <= 40 ? 'deteriorating' : 'stable';
  if (forwardScore !== null) {
    if (forwardScore >= 75 && overall >= 50) direction = 'improving';
    else if (forwardScore <= 30 && overall <= 60) direction = 'deteriorating';
  }

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
      ...(forwardScore !== null
        ? { forward: { score: forwardScore, label: labelFor(forwardScore) } }
        : {}),
    },
    direction,
    confidence,
  };

  // ── ONE-LINE INSTITUTIONAL VERDICT ─────────────────────────────────────
  // Rule-based summary: combines revenue/margin direction, accounting flags,
  // sector classification, FundamentalScore, and guidance direction into
  // a single actionable line.
  const guidanceDir = rawText && rawText.trim().length > 50
    ? inferGuidance(rawText).direction
    : 'na';
  // ── Valuation discipline ─────────────────────────────────────────────
  // Sector-aware fair-P/E assessment. Caps the verdict tier when P/E is
  // meaningfully above the sector's typical band so a 105x P/E
  // industrial like AEROFLEX never emits a bullish verdict purely on
  // fundamentals. The valuation tier flows into buildTopLineVerdict via
  // valuationCap and surfaces in IndiaExtras.valuation for the UI.
  // EPS growth — 4Q YoY trailing average from the quarterly trend.
  // Passed into assessValuation so the PEG-aware logic can downgrade
  // "bubble" → "stretched" when growth justifies the multiple.
  // For AEROFLEX (Q1-Q4 FY26 EPS YoY 52% avg, P/E 105 → PEG ~2.0 →
  // tier becomes 'stretched' instead of 'bubble').
  const epsYoYWindow = qtrendBase
    .slice(-4)
    .map((q) => q.yoyEpsPct ?? null)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const epsGrowthAvg = epsYoYWindow.length >= 1
    ? epsYoYWindow.reduce((s, v) => s + v, 0) / epsYoYWindow.length
    : null;
  const valuationAssessment = assessValuation(topMetrics.peRatio, sector, epsGrowthAvg);

  const topLine = buildTopLineVerdict({
    fundamentalScore,
    quarterlyTrend: qtrendBase,
    workingCapital,
    governance,
    accountingFlags: opts.screener?.ok ? [] : [], // flags carried via accountingQuality elsewhere
    sectorTemplate,
    cfoOverPat,
    concall: concallInsights,
    guidanceDirection: guidanceDir,
    valuationTier: valuationAssessment.tier,
  });

  return {
    topMetrics,
    workingCapital,
    governance,
    quarterlyTrend: qtrendBase,
    sector: sectorBlock,
    fundamentalScore,
    topLine,
    concall: concallInsights || undefined,
    staleness: opts.screener?.staleness,
    valuation: {
      tier: valuationAssessment.tier,
      pe: valuationAssessment.pe,
      fairLow: valuationAssessment.band.fairLow,
      fairHigh: valuationAssessment.band.fairHigh,
      stretched: valuationAssessment.band.stretched,
      bubble: valuationAssessment.band.bubble,
      label: valuationAssessment.label,
      vsSectorMidX: valuationAssessment.vsSectorMidX,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// One-line verdict generator — deterministic, no LLM
// ─────────────────────────────────────────────────────────────────────────
function buildTopLineVerdict(args: {
  fundamentalScore: IndiaExtras['fundamentalScore'];
  quarterlyTrend: IndiaExtras['quarterlyTrend'];
  workingCapital: IndiaExtras['workingCapital'];
  governance: IndiaExtras['governance'];
  accountingFlags: string[];
  sectorTemplate: typeof INDIA_SECTOR_TEMPLATES[IndiaSector];
  cfoOverPat: number | null;
  concall?: NonNullable<IndiaExtras['concall']> | null;
  guidanceDirection?: 'raised' | 'lowered' | 'maintained' | 'introduced' | 'na';
  // Sector-aware fair-P/E tier. 'stretched' caps the verdict at HOLD;
  // 'bubble' caps at AVOID. Prevents 105x P/E names from emitting BUY
  // signals on fundamentals alone.
  valuationTier?: 'fair' | 'premium' | 'stretched' | 'bubble' | 'na';
}): NonNullable<IndiaExtras['topLine']> {
  const { fundamentalScore: fs, quarterlyTrend, workingCapital, governance, sectorTemplate, cfoOverPat, concall, guidanceDirection } = args;
  const last = quarterlyTrend.at(-1);
  const revYoY = last?.yoyRevenuePct ?? null;
  const profitYoY = last?.yoyProfitPct ?? null;
  const opmYoY = last?.yoyOpmBps ?? null;
  const revQoQ = last?.qoqRevenuePct ?? null;
  const profitQoQ = last?.qoqProfitPct ?? null;

  // ── Verdict from FundamentalScore + direction ────────────────────────
  let verdict: NonNullable<IndiaExtras['topLine']>['verdict'] = 'NEUTRAL';
  if (fs.overall >= 80) {
    verdict = fs.direction === 'improving' ? 'BUY' : 'ACCUMULATE';
  } else if (fs.overall >= 65) {
    verdict = fs.direction === 'improving' ? 'ACCUMULATE' : 'HOLD';
  } else if (fs.overall >= 45) {
    verdict = fs.direction === 'deteriorating' ? 'AVOID' : 'NEUTRAL';
  } else if (fs.overall >= 30) {
    verdict = 'AVOID';
  } else {
    verdict = 'SELL';
  }

  // ── FORWARD-OUTLOOK TIER SHIFT ───────────────────────────────────────
  // A very-positive concall pulls verdict up one tier (NEUTRAL→HOLD,
  // HOLD→ACCUMULATE, AVOID→NEUTRAL). A weak concall pulls it down one.
  // Pinned at the extremes — BUY can't go higher, SELL can't go lower.
  const fwdScore = (fs.components as any).forward?.score as number | undefined;
  // WATCHLIST sits between AVOID and NEUTRAL — used when fundamentals are
  // strong but valuation is so rich that an institutional reader should
  // wait for entry rather than enter immediately. AVOID stays reserved
  // for actual fundamental deterioration.
  const tiers: NonNullable<IndiaExtras['topLine']>['verdict'][] = [
    'SELL', 'AVOID', 'WATCHLIST', 'NEUTRAL', 'HOLD', 'ACCUMULATE', 'BUY',
  ];
  if (typeof fwdScore === 'number') {
    const idx = tiers.indexOf(verdict);
    if (fwdScore >= 80 && idx >= 0 && idx < tiers.length - 1) {
      verdict = tiers[idx + 1];
    } else if (fwdScore <= 25 && idx > 0) {
      verdict = tiers[idx - 1];
    }
  }

  // ── PROMOTER TRUST TIER SHIFT ────────────────────────────────────────
  // Governance is a hard veto in institutional analysis. Trust < D (sub-30)
  // pulls the verdict down one tier; very-high trust does NOT lift verdict
  // (positive governance is necessary but not sufficient for a buy).
  const trust = args.governance.trustScore;
  if (trust && trust.score <= 30) {
    const idx = tiers.indexOf(verdict);
    if (idx > 0) verdict = tiers[idx - 1];
  }

  // ── VALUATION DISCIPLINE CAP (5-dimension aware) ─────────────────────
  // Old logic forced AVOID at "bubble" P/E regardless of fundamentals.
  // That collapsed business quality + earnings momentum + valuation
  // into one tag and produced the AEROFLEX contradiction:
  //   AVOID + FORWARD STRONG + Health 85 + Concall 93 — internally
  //   inconsistent for a buy-side reader.
  //
  // New logic separates fundamental strength (fs.overall) from valuation
  // tier and only forces AVOID when fundamentals ALSO support it.
  //
  // Quality-aware cap matrix:
  //                 Strong fundamentals    Weak fundamentals
  //                 (fs.overall >= 70)     (fs.overall < 70)
  //   stretched     cap at ACCUMULATE      cap at HOLD
  //   bubble        cap at WATCHLIST       cap at AVOID
  //
  // WATCHLIST = "high quality, valuation premium is the risk — wait for
  // entry" — institutionally honest framing for an expensive but
  // fundamentally-improving issuer.
  const valuationTier = args.valuationTier ?? 'na';
  if (valuationTier === 'stretched' || valuationTier === 'bubble') {
    const fundamentalsStrong = fs.overall >= 70;
    let capLabel: NonNullable<IndiaExtras['topLine']>['verdict'];
    if (valuationTier === 'bubble') {
      capLabel = fundamentalsStrong ? 'WATCHLIST' : 'AVOID';
    } else {
      capLabel = fundamentalsStrong ? 'ACCUMULATE' : 'HOLD';
    }
    const capIdx = tiers.indexOf(capLabel);
    const curIdx = tiers.indexOf(verdict);
    if (curIdx > capIdx) verdict = tiers[capIdx];
  }

  // ── Headline: directional movement ───────────────────────────────────
  const parts: string[] = [];
  if (revYoY != null && profitYoY != null) {
    if (revYoY >= 10 && profitYoY >= 10) {
      parts.push('Strong YoY growth across revenue and profit');
    } else if (revYoY >= 10 && profitYoY < 0) {
      parts.push('Revenue growing but profit contracting YoY');
    } else if (revYoY < 0 && profitYoY < 0) {
      parts.push('Revenue and profit both contracting YoY');
    } else if (revYoY >= 5 && Math.abs(profitYoY) < 5) {
      parts.push('Steady revenue growth, profit roughly flat YoY');
    } else if (revYoY < 0 && profitYoY > 0) {
      parts.push('Revenue softening but profit holding up — margin tailwind');
    } else if (revQoQ != null && revQoQ >= 5 && revYoY < 0) {
      parts.push(`QoQ rebound (+${revQoQ.toFixed(1)}%) after weak YoY trend`);
    } else if (revYoY >= 5) {
      parts.push(`Mid-single-digit YoY revenue growth (${revYoY.toFixed(1)}%)`);
    } else {
      parts.push('Mixed quarterly performance');
    }
  } else if (revYoY != null) {
    parts.push(revYoY >= 0 ? `Revenue +${revYoY.toFixed(1)}% YoY` : `Revenue ${revYoY.toFixed(1)}% YoY`);
  } else {
    parts.push(`${sectorTemplate.displayName} midcap`);
  }

  // ── Margin trajectory note ───────────────────────────────────────────
  if (opmYoY != null) {
    if (opmYoY <= -200) parts.push(`OPM compressed ${Math.abs(opmYoY)} bps YoY`);
    else if (opmYoY >= 200) parts.push(`OPM expanded ${opmYoY} bps YoY`);
  }

  // ── Risk overlay — pick the single most material flag ────────────────
  let primaryRisk: string | null = null;
  if (cfoOverPat !== null && cfoOverPat < 0.5) {
    primaryRisk = `cash conversion weak (CFO/PAT ${cfoOverPat.toFixed(2)}x)`;
  } else if (workingCapital.cashConversionCycle !== null && workingCapital.cashConversionCycle > 120) {
    primaryRisk = `working capital stretched (${workingCapital.cashConversionCycle.toFixed(0)} day CCC)`;
  } else if (governance.promoterChangeYoY !== null && governance.promoterChangeYoY < -3) {
    primaryRisk = `promoter holding ↓${Math.abs(governance.promoterChangeYoY).toFixed(1)} pp YoY`;
  } else if (opmYoY !== null && opmYoY <= -300) {
    primaryRisk = `margin pressure deepening (-${Math.abs(opmYoY)} bps YoY)`;
  }

  const headline = parts.join(' · ');

  // ── Rationale clause for the verdict ─────────────────────────────────
  // Quality-aware: text reflects ACTUAL fundamentals, not just the
  // verdict label. AEROFLEX (Health 85, Concall 93, Forward Strong)
  // capped at WATCHLIST by valuation must NOT read "deteriorating
  // fundamentals" — the fundamentals are improving; valuation is the
  // single risk. We branch on fs.overall + valuation tier to pick
  // the institutionally-honest framing.
  const rationale = (() => {
    const valTier = args.valuationTier ?? 'na';
    const valNote =
      valTier === 'bubble' ? 'multiple disconnected from sector norms'
      : valTier === 'stretched' ? 'multiple stretched vs sector'
      : valTier === 'premium' ? 'premium valuation'
      : '';

    // WATCHLIST is exclusively quality + expensive. Frame it as such.
    if (verdict === 'WATCHLIST') {
      return `Quality fundamentals (Health ${fs.overall}/100) — ${valNote || 'valuation rich'}; watchlist for entry on correction or execution confirmation`;
    }
    if (verdict === 'BUY') return 'Fundamentals improving across growth, margin, and cash conversion';
    if (verdict === 'ACCUMULATE') {
      // Strong fundamentals + (possibly) stretched valuation — reflect both.
      if (valTier === 'stretched') return `Quality fundamentals; valuation stretched — accumulate on dips, not at all-time highs`;
      return 'Quality fundamentals — accumulate on dips';
    }
    if (verdict === 'HOLD') {
      // HOLD can come from neutral fundamentals OR strong fund + stretched val.
      // Distinguish by fs.overall:
      if (fs.overall >= 70 && (valTier === 'stretched' || valTier === 'premium')) {
        return `Strong fundamentals but ${valNote} — wait for valuation reset`;
      }
      return 'Fundamentals stable but no near-term catalyst — hold and monitor';
    }
    if (verdict === 'NEUTRAL') return primaryRisk ? `Mixed signals; primary concern: ${primaryRisk}` : 'Mixed signals — wait for clearer trend';
    if (verdict === 'AVOID') {
      // AVOID is now reserved for actual deterioration. If fs.overall
      // is high and only valuation triggered the cap, it should have
      // been WATCHLIST — but defensively hand back honest text.
      if (fs.overall >= 70 && valTier === 'bubble') {
        return `Quality fundamentals but ${valNote}; valuation risk dominant — defer entry`;
      }
      return primaryRisk ? `Deteriorating fundamentals; key issue: ${primaryRisk}` : 'Deteriorating fundamentals — wait for stabilisation';
    }
    return primaryRisk ? `Multiple deteriorating signals; key issue: ${primaryRisk}` : 'Material deterioration across fundamentals';
  })();

  // ── Watch points: top 3 critical sector KPIs ─────────────────────────
  const watchPoints = sectorTemplate.kpis
    .filter((k) => k.importance === 'critical')
    .slice(0, 3)
    .map((k) => k.label);

  // ── FORWARD-LOOKING SIGNAL ───────────────────────────────────────────
  // Combines explicit guidance direction (raised / lowered / maintained /
  // introduced) with concall tone signal counts to produce a six-class
  // outlook grade. Skipped entirely if no concall was uploaded AND the
  // standalone guidance language inference also returned 'na'.
  const positiveCount = concall?.positiveCount ?? 0;
  const negativeCount = concall?.negativeCount ?? 0;
  const cautiousCount = concall?.cautiousCount ?? 0;
  const totalToneSignals = positiveCount + negativeCount + cautiousCount;
  const dir = guidanceDirection ?? 'na';
  const hasConcall = !!concall && concall.charsAnalyzed > 0;

  let forwardLook: NonNullable<NonNullable<IndiaExtras['topLine']>['forwardLook']> | undefined;
  if (hasConcall || dir !== 'na') {
    let grade: NonNullable<NonNullable<IndiaExtras['topLine']>['forwardLook']>['grade'] = 'mixed';
    if (dir === 'raised' || (dir === 'introduced' && positiveCount >= 3 && negativeCount <= 1)) {
      grade = 'very_positive';
    } else if (dir === 'lowered') {
      grade = 'weak';
    } else if (dir === 'introduced' || dir === 'maintained') {
      if (positiveCount >= 2 && positiveCount > negativeCount + cautiousCount) grade = 'positive';
      else if (negativeCount > positiveCount + cautiousCount) grade = 'weak';
      else if (cautiousCount > positiveCount) grade = 'cautious';
      else grade = positiveCount >= negativeCount ? 'positive' : 'mixed';
    } else if (hasConcall) {
      // No explicit direction — use tone counts alone
      if (positiveCount >= 5 && negativeCount === 0) grade = 'very_positive';
      else if (positiveCount >= 3 && positiveCount > negativeCount + cautiousCount) grade = 'positive';
      else if (negativeCount >= 3 && negativeCount > positiveCount) grade = 'weak';
      else if (cautiousCount > positiveCount && cautiousCount >= 2) grade = 'cautious';
      else if (totalToneSignals === 0) grade = 'not_provided';
      else grade = 'mixed';
    } else {
      grade = 'not_provided';
    }

    const labelMap: Record<typeof grade, string> = {
      very_positive: 'STRONG',
      positive: 'POSITIVE',
      mixed: 'MIXED',
      cautious: 'CAUTIOUS',
      weak: 'WEAK',
      not_provided: 'N/A',
    };

    // Evidence: top topical mentions that signal forward direction
    const evidenceTopics = (concall?.keyMentions || [])
      .map((m) => m.topic)
      .filter((t) => ['capex', 'capacity', 'launches', 'guidance', 'demand', 'operating_leverage', 'customer_wins'].includes(t));
    const evidenceLabels: Record<string, string> = {
      capex: 'capacity / capex expansion',
      capacity: 'capacity ramp',
      launches: 'new launches',
      guidance: 'forward guidance',
      demand: 'demand outlook',
      operating_leverage: 'operating leverage',
      customer_wins: 'customer wins',
    };
    const evidence = (() => {
      if (dir === 'raised') return 'guidance raised by management';
      if (dir === 'lowered') return 'guidance lowered by management';
      if (evidenceTopics.length > 0) {
        return evidenceTopics.slice(0, 3).map((t) => evidenceLabels[t]).join(' + ');
      }
      if (negativeCount > positiveCount) return `${negativeCount} cautionary signals in commentary`;
      if (positiveCount > 0) return `${positiveCount} positive signals in commentary`;
      return 'no forward-looking commentary detected';
    })();

    if (grade !== 'not_provided') {
      forwardLook = { grade, label: labelMap[grade], evidence };
    }
  }

  return { headline, verdict, rationale, watchPoints, forwardLook };
}
