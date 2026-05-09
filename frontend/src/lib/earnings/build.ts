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
    // Press-release / announcement date from FMP /stable/earnings.
    // Used by the cross-provider quarter-mismatch reconciliation log
    // to surface which calendar quarter FMP is reporting (vs the
    // EDGAR-reported fin.period). Optional because older snapshot
    // sources may not populate it.
    date?: string;
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

  // ── CANONICAL QUARTER RECONCILIATION ──────────────────────────────────
  // Two providers give us the latest quarter from different ingest
  // pipelines:
  //   - EDGAR XBRL (fin.revenue / fin.eps / fin.period) — slow ingest;
  //     can lag the company's actual report by 4–8 weeks because XBRL
  //     extraction depends on SEC's full-text indexing
  //   - FMP /stable/earnings (lastSurp.{actual,estimate}Revenue/Eps) —
  //     usually within hours of the press release
  //
  // When EDGAR is behind, our pipeline previously used:
  //     fin.revenue        ← Q3 actual (EDGAR, stale)
  //     lastSurp.estRev    ← Q4 estimate (FMP, current)
  // That produced a fake -13.8% Severe Miss for NVDA in May 2026 (EDGAR
  // had Q3 FY26 = $57B; FMP already had Q4 FY26 actual $68.1B vs
  // estimate $66.1B = +3% real beat).
  //
  // The closed-pair guard (lastSurpIsClosed) is necessary but not
  // sufficient: it correctly rejects FORWARD rows where actual is null,
  // but it does NOT detect period drift between two different closed
  // sources. We need a structural guard that compares fin.revenue to
  // lastSurp.actualRevenue and, when they differ by more than 5%,
  // declares a quarter mismatch and prefers FMP's closed pair (which
  // is internally consistent because actual + estimate come from the
  // same row, same period).
  // ─────────────────────────────────────────────────────────────────────
  const lastSurpIsClosed = lastSurp?.actualRevenue != null && lastSurp?.estimateRevenue != null;
  const lastSurpEpsIsClosed = lastSurp?.actualEps != null && lastSurp?.estimateEps != null;

  // Detect cross-provider period drift in a DIRECTIONAL way. Two
  // possible mismatches:
  //   (a) FMP > EDGAR by 5%+ → FMP has the newer quarter, EDGAR
  //       ingest is lagging. Common case (NVDA May-2026: EDGAR
  //       has Q3 $57B, FMP has Q4 $68B). We switch to FMP.
  //   (b) EDGAR > FMP by 5%+ → very rare; would imply FMP missed
  //       an earnings entirely. We do NOT switch; stick with EDGAR.
  // The asymmetric guard prevents false-positives where both sources
  // have the SAME quarter but FMP's number is the press-release figure
  // while EDGAR has a slightly-restated 10-Q value (typical < 1% diff).
  const finRev = fin.revenue;
  const fmpAct = lastRevAct;
  const quarterMismatch =
    lastSurpIsClosed &&
    finRev != null &&
    fmpAct != null &&
    (fmpAct - finRev) / Math.max(Math.abs(fmpAct), 1) > 0.05;

  if (quarterMismatch) {
    const msg =
      `Quarter reconciliation: EDGAR XBRL last-parsed period ${fin.period} ` +
      `reports rev ${finRev?.toFixed(0)} (scaled units) but FMP closed pair ` +
      `(date ${lastSurp?.date}) reports rev ${fmpAct?.toFixed(0)}. ` +
      `Diff > 5% with FMP newer → EDGAR is ingest-lagging. Scorecard ` +
      `switched to FMP closed pair to keep actual + estimate from the ` +
      `same period.`;
    fallbacksUsed.push(msg);
  }

  // SCORECARD CONSENSUS RULE — period-matched closed pair only.
  //   - When quarterMismatch: use FMP actual + FMP estimate (guaranteed
  //     same row, same period) — this is the institutionally correct
  //     surprise pair for the latest reported quarter.
  //   - When aligned: use EDGAR actual (more authoritative GAAP source)
  //     but only emit estimate if FMP's closed pair is present.
  //   - When FMP has no closed pair: don't compute a surprise at all
  //     (rather than back-fill with a forward-row estimate that would
  //     create a fake beat/miss).
  const revenueActual = quarterMismatch ? fmpAct : finRev;
  let revenueEstimate = lastSurpIsClosed ? lastRevEst : null;
  let revenueEstimateSource: 'consensus' | 'prior_quarter_proxy' = 'consensus';

  // EPS uses the same priority. Note: EPS displayed already preferred
  // FMP's actualEps (line ~193 in the prior version) because FMP's EPS
  // matches the non-GAAP consensus convention. We keep that behavior
  // and add the same period-mismatch logic for the estimate side.
  const epsActual = quarterMismatch
    ? (lastSurp?.actualEps ?? null)
    : (lastSurp?.actualEps ?? fin.eps ?? histQ[0]?.eps ?? null);
  let epsEstimate = lastSurpEpsIsClosed ? lastEpsEst : null;
  let epsEstimateSource: 'consensus' | 'prior_quarter_proxy' = 'consensus';

  // Prior-quarter proxy fallback for Revenue / EPS estimate is applied
  // AFTER qoq / qoqRev are computed below — see the block right after
  // those definitions.

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

  // ── PRIOR-QUARTER PROXY FALLBACK (US small caps only) ────────────────
  // Cascade for revenue/EPS estimate:
  //   1. FMP closed pair (lastSurp.{revenue,eps}Estimate) — already
  //      assigned above when lastSurpIsClosed
  //   2. NASDAQ.com fallback — folded into lastSurp by the estimates
  //      route's fetchNasdaqSmallCap when FMP returned empty
  //   3. PRIOR QUARTER ACTUAL as proxy estimate. Only when steps 1+2
  //      produced nothing AND ticker is US AND we have a qoqPrior to
  //      substitute. Effectively a sequential-growth read framed as
  //      a surprise — labelled with estimateSource='prior_quarter_proxy'
  //      so the UI surfaces a "(prior Q)" badge and institutional
  //      readers know it's not a real beat/miss vs street.
  //
  // India is excluded — the India pipeline (india-build.ts) already
  // doesn't surface a Consensus column and uses its own QoQ/YoY-driven
  // verdict; adding a proxy here would be redundant.
  const isUS = fin.currency === 'USD';
  if (isUS && revenueEstimate === null && qoqRev !== null && qoqRev !== 0) {
    revenueEstimate = qoqRev;
    revenueEstimateSource = 'prior_quarter_proxy';
    fallbacksUsed.push(
      `Prior-quarter proxy used for Revenue: no consensus available (FMP/NASDAQ ` +
      `both empty for ${fin.ticker}); compared to prior quarter actual ` +
      `${qoqRev.toFixed(0)} as fallback.`
    );
  }
  if (isUS && epsEstimate === null && qoq?.eps != null && qoq.eps !== 0) {
    epsEstimate = qoq.eps;
    epsEstimateSource = 'prior_quarter_proxy';
    fallbacksUsed.push(
      `Prior-quarter proxy used for EPS: no consensus available; compared to ` +
      `prior quarter EPS ${qoq.eps.toFixed(2)} as fallback.`
    );
  }

  // YoY = same fiscal quarter one year ago. Don't blindly use histQ[4] —
  // some companies have Q4-skipping (10-K replaces 10-Q for Q4), so
  // histQ[4] could be 5 quarters back. Match by PERIOD LABEL instead.
  // NVDA fix: current Q3 2026, want Q3 2025 (one fiscal year earlier),
  // not histQ[4] which would be Q2 2025 due to the trend-table sequence
  // Q3-Q2-Q1 then skip Q4 to next year.
  const findYoyMatchingHistory = (currentPeriod: string | null): typeof histQ[number] | null => {
    if (!currentPeriod) return histQ[4] || null;
    // Period format from FMP: e.g. "Q3 2026" / "Q1 2025" / similar
    const m = currentPeriod.match(/Q([1-4])\s+(\d{4})/);
    if (!m) return histQ[4] || null;
    const targetQ = `Q${m[1]}`;
    const targetY = parseInt(m[2], 10) - 1; // one fiscal year prior
    const target = `${targetQ} ${targetY}`;
    const found = histQ.find((q) => (q.period || '').includes(target));
    return found ?? histQ[4] ?? null;
  };
  // When quarterMismatch is true, EDGAR (fin.*) is for the prior quarter
  // and history[0] from FMP is for the current quarter. We want the
  // SCORECARD to reflect the current quarter, so derived metrics
  // (EBITDA / margins / NetIncome / FCF) should source from history[0]
  // when the period drift is detected. When aligned, prefer the EDGAR
  // values which are authoritative GAAP.
  //
  // The findYoyMatchingHistory lookup also flips: when mismatched, the
  // EDGAR period label can't be trusted as the "current" anchor —
  // history[0].period is the right anchor for "one year ago" search.
  const currentPeriodLabel = quarterMismatch ? (histQ[0]?.period ?? fin.period) : fin.period;
  const yoyHist = findYoyMatchingHistory(currentPeriodLabel);
  const yoyRevFromHist =
    yoyHist?.revenue !== null && yoyHist?.revenue !== undefined
      ? Math.round(yoyHist.revenue * sf * 100) / 100
      : null;
  const yoyEpsFromHist = yoyHist?.eps ?? null;

  // Derived-metric handling under quarter mismatch:
  //
  // FMP /stable/earnings (the source of lastReportedSurprise) ingests
  // earnings releases within hours. FMP /stable/income-statement (the
  // source of /api/earnings/history → histQ) ingests on a slower cycle
  // and CAN STILL BE BEHIND by a quarter when /stable/earnings is
  // current. Verified May 2026 NVDA: /stable/earnings has Q4 FY26
  // closed pair, but /stable/income-statement only has up to Q3 FY26.
  // EDGAR XBRL is also stuck at Q3.
  //
  // So when quarterMismatch fires, NEITHER fin.* (EDGAR) NOR histQ[0]
  // (FMP income-statement) is reliable for the FMP-current quarter —
  // they're both for the prior quarter. The only fields we trust on
  // mismatch are Revenue and EPS from lastSurp directly.
  //
  // Other metrics get NULL'd out so the scorecard shows '—' instead of
  // labeling Q3 margins as Q4 margins. The validationWarnings banner
  // tells the user why.
  const grossMarginActual = quarterMismatch
    ? null
    : (fin.grossMargin ?? histQ[0]?.grossMargin ?? null);
  const ebitdaMarginActual = quarterMismatch
    ? null
    : (fin.ebitdaMargin ?? histQ[0]?.ebitdaMargin ?? null);
  const operatingMarginActual = quarterMismatch
    ? null
    : (fin.ebitMargin ?? histQ[0]?.operatingMargin ?? null);
  const ebitdaActual = quarterMismatch
    ? null
    : (fin.ebitda ?? (
        histQ[0]?.ebitdaMargin != null && fin.revenue != null
          ? Math.round((histQ[0].ebitdaMargin / 100) * fin.revenue * 100) / 100
          : null
      ));
  const netIncomeActual = quarterMismatch ? null : fin.pat;
  const fcfActual = quarterMismatch ? null : fin.fcf;

  const metrics = {
    revenue: buildMetric({
      metric: 'Revenue', unit: 'currency',
      actual: revenueActual,
      estimate: revenueEstimate,
      estimateSource: revenueEstimateSource,
      prior: quarterMismatch ? yoyRevFromHist : (fin.revPrior ?? yoyRevFromHist),
      qoqPrior: qoqRev,
    }),
    eps: buildMetric({
      metric: 'EPS', unit: 'count',
      actual: epsActual,
      estimate: epsEstimate,
      estimateSource: epsEstimateSource,
      prior: quarterMismatch ? yoyEpsFromHist : (fin.epsPrior ?? yoyEpsFromHist),
      qoqPrior: qoq?.eps ?? null,
    }),
    ebitda: buildMetric({
      metric: 'EBITDA', unit: 'currency',
      actual: ebitdaActual,
      estimate: ebitdaEst,
      prior: null, qoqPrior: null,
    }),
    grossMargin: buildMetric({
      metric: 'Gross Margin', unit: 'percent',
      actual: grossMarginActual,
      estimate: null, prior: null,
      qoqPrior: qoq?.grossMargin ?? null,
    }),
    ebitdaMargin: buildMetric({
      metric: 'EBITDA Margin', unit: 'percent',
      actual: ebitdaMarginActual,
      estimate: ebitdaMarginEst,
      prior: null,
      qoqPrior: qoq?.ebitdaMargin ?? null,
    }),
    operatingMargin: buildMetric({
      metric: 'Operating Margin', unit: 'percent',
      actual: operatingMarginActual,
      estimate: null, prior: null,
      qoqPrior: qoq?.operatingMargin ?? null,
    }),
    netIncome: buildMetric({
      metric: 'Net Income', unit: 'currency',
      actual: netIncomeActual,
      estimate: netIncomeEst,
      prior: quarterMismatch ? null : fin.patPrior,
      qoqPrior: null,
    }),
    fcf: buildMetric({
      metric: 'Free Cash Flow', unit: 'currency',
      actual: fcfActual,
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
    // Avoid claiming "beat consensus" when the comparison is actually vs
    // prior quarter (no consensus available). Re-frame as sequential growth.
    const anchor = metrics.revenue.estimateSource === 'prior_quarter_proxy'
      ? 'prior quarter'
      : 'consensus';
    takeaways.push(`Revenue ${dir} ${anchor} by ${(metrics.revenue.surprisePct ?? 0).toFixed(1)}%`);
  }
  if (metrics.eps.surpriseClass !== 'na' && metrics.eps.surpriseClass !== 'inline') {
    const dir = (metrics.eps.surprisePct ?? 0) >= 0 ? 'beat' : 'missed';
    const anchor = metrics.eps.estimateSource === 'prior_quarter_proxy'
      ? 'prior quarter'
      : 'consensus';
    takeaways.push(`EPS ${dir} ${anchor} by ${(metrics.eps.surprisePct ?? 0).toFixed(1)}%`);
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
    // Period label tracks the canonical reconciled quarter. When the
    // EDGAR XBRL ingest is stale, we surface the FMP-current period
    // (e.g. NVDA "Q4 2026" instead of stale "Q3 2026") so the header
    // matches the values shown in the scorecard.
    quarter: currentPeriodLabel,
    filingType: quarterMismatch ? `${fin.filingType} (FMP-reconciled — EDGAR ingest pending)` : fin.filingType,
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
    validationWarnings: [
      ...(fin.validationWarnings || []),
      ...(quarterMismatch
        ? [
            `EDGAR ingest lag detected — FMP reports newer closed quarter ` +
              `(${lastSurp?.date}) than our XBRL pipeline parsed (${fin.period}). ` +
              `Scorecard reconciled to FMP closed pair to avoid period-mismatch ` +
              `surprise miscalculation.`,
          ]
        : []),
    ],
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
