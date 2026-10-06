'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { InstitutionalReport } from '@/components/earnings/InstitutionalReport';
import { IndiaInstitutionalReport } from '@/components/earnings/IndiaInstitutionalReport';
import { buildSnapshot, FinancialsInput, EstimatesInput, HistoryInput } from '@/lib/earnings/build';
import { buildIndiaSnapshot } from '@/lib/earnings/india-build';
import type { EarningsSnapshot } from '@/lib/earnings/snapshot';
import { saveConcallSnapshot } from '@/lib/concall-snapshot-store';
// PATCH 0681 — inline valuation panel rendered at the bottom of the Concall AI page
import InlineValuationPanel from '@/components/InlineValuationPanel';
import type { AutoValuationReport } from '@/app/(dashboard)/auto-valuation/engine';
import { BG, CARD, CARD2, BORDER, TEXT, MUTED, ACCENT, GREEN, RED, ORANGE, YELLOW, PURPLE, F } from './constants';
import { extractPDFText } from './helpers';
import { sanitizeMetrics, detectNarrativeThemes, parseEarnings } from './helpers2';
import { baseCaseUpsideFromReport, scoreAccountingQuality, scoreEarningsReaction, scoreNarrative, formatCurrency, n, pct, growth, loadHist2, saveHist2 } from './helpers3';
import { type RawFinancials, type EngineOutput, type ThemeDetection, type HistEntry2 } from './types';

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function EarningsAnalysisPage() {
  // ── API Keys ──────────────────────────────────────────────────────────────
  // FMP_KEY and AV_KEY removed from client — both were hardcoded and
  // shipping to browser JS. FMP calls go through /api/earnings/fmp-proxy;
  // Alpha Vantage calls go through /api/earnings/av-proxy. Both routes
  // hold the keys server-side and rate-limit per IP.

  // Helper that calls FMP's legacy v3 endpoints via the server proxy.
  // Returns a Response. Caller calls .ok and .json() — but .json() returns
  // the proxy envelope { ok, data }; the page code already destructures via
  // `safeEst` helpers that handle both shapes via `j?.data ?? j ?? []`.
  // For sites that consumed the array directly we wrap with unwrapFmp().
  function fmpFetch(endpoint: string, ticker: string, params: Record<string, string> = {}): Promise<Response> {
    const qs = new URLSearchParams({ endpoint, ticker, ...params });
    return fetch(`/api/earnings/fmp-proxy?${qs.toString()}`);
  }
  // Helper to unwrap the proxy envelope { ok, data } back to the raw array
  // shape that the existing destructuring code expects. Returns [] on error.
  async function unwrapFmpJson(res: Response): Promise<any[]> {
    if (!res.ok) return [];
    const j = await res.json().catch(() => null);
    return j?.data ?? (Array.isArray(j) ? j : []);
  }

  // Consensus estimates data — enriched from FMP (primary) or AV (fallback)
  interface AVData {
    symbol: string; name: string; sector: string; industry: string;
    dataSource: 'FMP' | 'AlphaVantage' | 'manual';
    // Estimates — these are the ONLY fields we use from market data providers
    epsEstNextQ: number|null;
    epsEstCurrentYear: number|null;
    revenueEstNextQ: number|null;       // $ Mn — FMP provides this!
    revenueEstCurrentYear: number|null; // $ Mn — FMP provides full year
    grossMarginEst: number|null;        // % — FMP analyst estimates
    analystTargetPrice: number|null;
    numAnalysts: number|null;
    // EPS surprise track record (last 8 quarters)
    quarterlyEarnings: {
      fiscalDateEnding: string;
      period: string;
      reportedEPS: number|null;
      estimatedEPS: number|null;
      surprise: number|null;
      surprisePct: number|null;
      // Revenue actuals + estimates (FMP provides these)
      reportedRevenue: number|null;
      estimatedRevenue: number|null;
      revSurprisePct: number|null;
    }[];
  }
  const [avData, setAvData] = useState<AVData|null>(null);
  const [avLoading, setAvLoading] = useState(false);
  const [avTicker, setAvTicker] = useState('');
  const [manualRevEst, setManualRevEst] = useState('');
  const [manualGMEst, setManualGMEst] = useState('');
  const [manualGuidance, setManualGuidance] = useState('');
  const [showOverrides, setShowOverrides] = useState(false);

  // ── PRIMARY: Financial Modeling Prep ─────────────────────────────────────────
  // FMP provides: earnings history + analyst estimates + revenue estimates + margins
  async function fetchFMPData(ticker: string): Promise<boolean> {
    try {
      const sym = ticker.toUpperCase();
      // FMP endpoints we use:
      // /earnings-surprises: EPS actual vs estimate with revenue actual vs estimate
      // /analyst-estimates: forward revenue, EPS, gross margin estimates
      // /profile: company name, sector, industry
      const [surpriseRes, estimatesRes, profileRes] = await Promise.allSettled([
        fmpFetch('earnings-surprises', sym),
        fmpFetch('analyst-estimates', sym, { period: 'quarterly', limit: '4' }),
        fmpFetch('profile', sym),
      ]);

      const surprises: any[] = surpriseRes.status === 'fulfilled' ? await unwrapFmpJson(surpriseRes.value) : [];
      const estimates: any[] = estimatesRes.status === 'fulfilled' ? await unwrapFmpJson(estimatesRes.value) : [];
      const profiles: any[] = profileRes.status === 'fulfilled' ? await unwrapFmpJson(profileRes.value) : [];

      if (!surprises.length && !estimates.length) return false;

      const profile = profiles[0] ?? {};
      const nextEst = estimates[0] ?? {};

      // Build quarterly earnings with both EPS and revenue surprises
      const quarterly = surprises.slice(0, 8).map((s: any) => {
        // FMP provides: actualEarningResult, estimatedEarning, actualRevenue, estimatedRevenue
        const eps = parseFloat(s.actualEarningResult ?? s.actualEps) || null;
        const epsEst = parseFloat(s.estimatedEarning ?? s.estimatedEps) || null;
        const rev = parseFloat(s.actualRevenue) || null;
        const revEst = parseFloat(s.estimatedRevenue) || null;
        const epsSurprise = eps !== null && epsEst !== null && epsEst !== 0
          ? Math.round(((eps - epsEst) / Math.abs(epsEst)) * 10000) / 100 : null;
        const revSurprise = rev !== null && revEst !== null && revEst !== 0
          ? Math.round(((rev - revEst) / Math.abs(revEst)) * 10000) / 100 : null;
        return {
          fiscalDateEnding: s.date || '',
          period: s.period || s.date?.slice(0, 7) || '',
          reportedEPS: eps,
          estimatedEPS: epsEst,
          surprise: eps !== null && epsEst !== null ? Math.round((eps - epsEst) * 100) / 100 : null,
          surprisePct: epsSurprise,
          // Revenue — FMP provides these, AV doesn't
          reportedRevenue: rev !== null ? Math.round(rev / 1e6 * 10) / 10 : null,  // → $ Mn
          estimatedRevenue: revEst !== null ? Math.round(revEst / 1e6 * 10) / 10 : null,
          revSurprisePct: revSurprise,
        };
      });

      // Forward estimates (next quarter / current year) from FMP analyst-estimates
      setAvData({
        symbol: sym,
        name: profile.companyName || '',
        sector: profile.sector || '',
        industry: profile.industry || '',
        dataSource: 'FMP',
        epsEstNextQ:          parseFloat(nextEst.estimatedEpsAvg)     || null,
        epsEstCurrentYear:    parseFloat(nextEst.estimatedEpsAvg)     || null,
        revenueEstNextQ:      nextEst.estimatedRevenueAvg ? Math.round(parseFloat(nextEst.estimatedRevenueAvg) / 1e6 * 10) / 10 : null,
        revenueEstCurrentYear: null,
        grossMarginEst:       nextEst.estimatedGrossProfit && nextEst.estimatedRevenueAvg
          ? Math.round((parseFloat(nextEst.estimatedGrossProfit) / parseFloat(nextEst.estimatedRevenueAvg)) * 10000) / 100
          : null,
        analystTargetPrice:   parseFloat(profile.price) || null,
        numAnalysts:          parseInt(nextEst.numberAnalysts) || null,
        quarterlyEarnings:    quarterly,
      });
      return true;
    } catch (e) {
      console.error('FMP fetch failed:', e);
      return false;
    }
  }

  // ── FALLBACK: Alpha Vantage ───────────────────────────────────────────────────
  async function fetchAVData(ticker: string) {
    if (!ticker.trim()) return;
    setAvLoading(true);
    // Try FMP first (provides revenue estimates + EPS)
    const fmpOk = await fetchFMPData(ticker);
    if (fmpOk) { setAvLoading(false); return; }

    // FMP failed → fall back to AV via server-side proxy (key kept server-only)
    try {
      const sym = encodeURIComponent(ticker.toUpperCase());
      const [earRes, ovRes] = await Promise.allSettled([
        fetch(`/api/earnings/av-proxy?function=EARNINGS&symbol=${sym}`),
        fetch(`/api/earnings/av-proxy?function=OVERVIEW&symbol=${sym}`),
      ]);
      const earJson = earRes.status === 'fulfilled' && earRes.value.ok ? await earRes.value.json() : null;
      const ovJson  = ovRes.status  === 'fulfilled' && ovRes.value.ok  ? await ovRes.value.json()  : null;
      const ear = earJson?.data || {};
      const ov  = ovJson?.data || {};
      const quarterly = (ear.quarterlyEarnings || []).slice(0, 8).map((q: any) => ({
        fiscalDateEnding: q.fiscalDateEnding || '', period: q.fiscalDateEnding?.slice(0,7) || '',
        reportedEPS:  parseFloat(q.reportedEPS) || null,
        estimatedEPS: parseFloat(q.estimatedEPS) || null,
        surprise:     parseFloat(q.surprise) || null,
        surprisePct:  parseFloat(q.surprisePercentage) || null,
        reportedRevenue: null, estimatedRevenue: null, revSurprisePct: null,
      }));
      setAvData({
        symbol: ticker.toUpperCase(), name: ov.Name || '', sector: ov.Sector || '',
        industry: ov.Industry || '', dataSource: 'AlphaVantage',
        epsEstNextQ: parseFloat(ov.EPSEstimateNextQuarter) || null,
        epsEstCurrentYear: parseFloat(ov.EPSEstimateCurrentYear) || null,
        revenueEstNextQ: null, revenueEstCurrentYear: null, grossMarginEst: null,
        analystTargetPrice: parseFloat(ov.AnalystTargetPrice) || null,
        numAnalysts: null, quarterlyEarnings: quarterly,
      });
    } catch (e) { console.error('AV fallback failed:', e); }
    setAvLoading(false);
  }

  const [mode, setMode] = useState<'ticker'|'upload'|'paste'|'url'>('ticker');
  const [tickerInput, setTickerInput] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [result, setResult] = useState<{ d: RawFinancials; q: EngineOutput; r: EngineOutput; nar: ReturnType<typeof scoreNarrative> }|null>(null);
  // PATCH — auto-valuation report lifted up from InlineValuationPanel so the
  // concall (accounting-quality) score can weight base-case valuation upside.
  const [valReport, setValReport] = useState<AutoValuationReport | null>(null);
  const [snapshot, setSnapshot] = useState<EarningsSnapshot | null>(null);
  const [reportView, setReportView] = useState<'institutional' | 'legacy'>('institutional');
  // Last EDGAR enrichment payload (sicDescription, businessText, exchange) — used by buildSnapshot
  const lastEdgarPayloadRef = useRef<any>(null);
  // Cached India snapshot inputs so the user can re-run with a pasted concall
  // transcript without re-fetching Screener / FMP.
  const indiaSnapshotInputsRef = useRef<{
    ticker: string;
    filingType: string;
    screenerJson: any;
    fmpProfile: any;
  } | null>(null);
  // Cached US snapshot inputs — same idea, for the InstitutionalReport's
  // concall upload button. We keep the FinancialsInput, estimates, and
  // history JSON so the build runs locally without re-fetching FMP.
  const usSnapshotInputsRef = useRef<{
    finIn: any;
    estJson: any;
    histJson: any;
  } | null>(null);
  const [concallProcessing, setConcallProcessing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistEntry2[]>(() => loadHist2());
  const [expandedSignals, setExpandedSignals] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // ── TICKER-FIRST: Correct source hierarchy ─────────────────────────────────
  // US stocks:  1. SEC EDGAR XBRL (deterministic, 100% accurate)
  //             2. FMP financial statements (fallback)
  // India:      1. FMP with .NS/.BO suffix
  //             2. Suggest NSE/BSE PDF upload if FMP fails
  // Estimates from FMP for all markets (both paths)
  //
  // CRITICAL: LLM interprets structured truth — never reconstructs it from PDFs.

  // ── SEC EDGAR XBRL via server-side proxy ───────────────────────────────────
  // Browsers cannot fetch SEC EDGAR directly: SEC has no CORS headers, and
  // browsers block setting User-Agent (a forbidden header). We hit our own
  // /api/earnings/edgar route which runs server-side and returns clean JSON.
  async function fetchFromEDGARXBRL(ticker: string): Promise<RawFinancials | null> {
    let payload: any = null;
    try {
      const res = await fetch(`/api/earnings/edgar?ticker=${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(20000),
      });
      payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) return null;
    } catch {
      return null;
    }
    // Stash full payload for buildSnapshot enrichment
    lastEdgarPayloadRef.current = payload;

    const SCALE = 1e-6; // server returns absolute USD → display in $ Mn
    const sc = (v: number | null | undefined): number | null =>
      v === null || v === undefined ? null : Math.round(v * SCALE * 100) / 100;

    const revenue = sc(payload.revenue);
    const revPrior = sc(payload.revenuePrior);
    const grossProfit = sc(payload.grossProfit);
    const grossMargin =
      revenue && grossProfit && revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null;
    const ebitVal = sc(payload.operatingIncome);
    const daVal = sc(payload.da);
    const patVal = sc(payload.netIncome);
    const cfoVal = sc(payload.cfo);
    const capexAbs = payload.capex !== null && payload.capex !== undefined ? Math.abs(payload.capex) : null;
    const capexVal = capexAbs !== null ? sc(-capexAbs) : null;

    let ebitda: number | null = null;
    if (ebitVal !== null && daVal !== null) {
      ebitda = Math.round((ebitVal + Math.abs(daVal)) * 1000) / 1000;
    }

    const cash = sc(payload.cash);
    const totalDebt = sc(payload.totalDebt);
    const equity = sc(payload.equity);
    const totalAssets = sc(payload.totalAssets);

    const themes = detectNarrativeThemes(`${payload.company || ticker}`);

    return {
      company: payload.company || ticker,
      ticker: (payload.ticker || ticker).toUpperCase(),
      period: payload.period || 'Latest',
      periodType: payload.periodType || 'quarterly',
      filingType: payload.filingType || 'SEC 10-Q (EDGAR)',
      currency: 'USD',
      scaleLabel: '$ Mn',
      scaleFactor: SCALE,
      revenue,
      revPrior,
      grossProfit,
      grossMargin,
      ebit: ebitVal,
      ebitMargin:
        ebitVal && revenue && revenue > 0 ? Math.round((ebitVal / revenue) * 10000) / 100 : null,
      ebitda,
      ebitdaMargin:
        ebitda && revenue && revenue > 0 ? Math.round((ebitda / revenue) * 10000) / 100 : null,
      opex: null,
      pat: patVal,
      patPrior: sc(payload.netIncomePrior),
      patMargin:
        patVal && revenue && revenue > 0 ? Math.round((patVal / revenue) * 10000) / 100 : null,
      eps: payload.eps ?? null,
      epsPrior: payload.epsPrior ?? null,
      rnd: sc(payload.rnd),
      sga: sc(payload.sga),
      da: daVal,
      interestExpense: sc(payload.interestExpense),
      pbt: sc(payload.pbt),
      tax: sc(payload.tax),
      otherIncome: null,
      cash,
      totalDebt,
      equity,
      totalAssets,
      netDebt: totalDebt !== null && cash !== null ? Math.round((totalDebt - cash) * 100) / 100 : null,
      capex: capexVal,
      ar: null,
      inventory: null,
      cfo: cfoVal,
      fcf:
        cfoVal !== null && capexAbs !== null
          ? Math.round((cfoVal - sc(capexAbs)!) * 100) / 100
          : null,
      deRatio:
        totalDebt !== null && equity && equity > 0 ? Math.round((totalDebt / equity) * 100) / 100 : null,
      cfoPat:
        cfoVal !== null && patVal !== null && patVal !== 0
          ? Math.round((cfoVal / patVal) * 100) / 100
          : null,
      roce: ebitVal && equity && equity > 0 ? Math.round((ebitVal / equity) * 10000) / 100 : null,
      roe: patVal && equity && equity > 0 ? Math.round((patVal / equity) * 10000) / 100 : null,
      roa:
        patVal && totalAssets && totalAssets > 0
          ? Math.round((patVal / totalAssets) * 10000) / 100
          : null,
      orderBook: null,
      backlog: null,
      headcount: null,
      guidance: [],
      keyMetrics: [],
      forwardStatements: [],
      themes,
      mgmtTone: 'neutral',
      validationWarnings: [`Source: SEC EDGAR XBRL (CIK ${payload.cik}) — deterministic, no OCR`],
      hardFailures: [],
      isDataReliable: true,
      parseState: 'verified',
      parseConfidence: 97,
      revenueSource: 'sec_edgar_xbrl',
      discontinuedIncome: null,
      continuingRevenue: revenue,
      continuingPAT: patVal,
      continuingOpsDetected: false,
    } as RawFinancials;
  }

  // ── India primary path via /api/earnings/india-screener ───────────────────
  // The screener route runs NSE-primary internally (NSE corporates-financial
  // -results) with Screener.in fallback. It returns Cr-denominated quarterly
  // P&L plus TTM ratios. We map it to RawFinancials so the rest of the
  // pipeline (FMP estimates, snapshot builder) works unchanged.
  async function fetchFromScreenerIndia(ticker: string): Promise<RawFinancials | null> {
    let payload: any = null;
    try {
      const res = await fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(20000),
      });
      payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) return null;
    } catch {
      return null;
    }

    const latest = payload.latest;
    if (!latest) return null;

    // Screener returns values in ₹ Cr. Internal canonical is ₹ Mn (10× Cr).
    const crToMn = (v: number | null | undefined): number | null =>
      v === null || v === undefined ? null : Math.round(v * 10 * 100) / 100;

    const revenue = crToMn(latest.revenue);
    const revPrior = crToMn(payload.yoyPriorQuarter?.revenue);
    const ebitVal = crToMn(latest.operatingProfit);
    const patVal = crToMn(latest.netIncome);
    const daVal = crToMn(latest.depreciation);
    const opmPct = latest.ebitdaMargin ?? null;

    let ebitda: number | null = null;
    if (ebitVal !== null && daVal !== null) {
      ebitda = Math.round((ebitVal + Math.abs(daVal)) * 1000) / 1000;
    }

    const themes = detectNarrativeThemes(
      `${payload.company || ticker} ${payload.about || ''} ${payload.industry || ''} ${payload.sector || ''}`,
    );

    const usedNse = payload.source === 'nse_primary' || payload.source === 'nse_primary_screener_unavailable';
    const sourceLabel = usedNse
      ? 'NSE Quarterly Results (filing data)'
      : 'Screener.in Quarterly Results';

    return {
      company: payload.company || ticker,
      ticker: (payload.ticker || ticker).toUpperCase(),
      period: latest.period || 'Latest',
      periodType: 'quarterly',
      filingType: usedNse ? 'NSE Quarterly Results' : 'Quarterly Results (Screener.in)',
      currency: 'INR',
      scaleLabel: '₹ Mn',
      scaleFactor: 1, // values stored in ₹ Mn (matches NSE/FMP path conventions)
      revenue,
      revPrior,
      grossProfit: null,
      grossMargin: null,
      ebit: ebitVal,
      ebitMargin:
        ebitVal && revenue && revenue > 0 ? Math.round((ebitVal / revenue) * 10000) / 100 : opmPct,
      ebitda,
      ebitdaMargin:
        ebitda && revenue && revenue > 0 ? Math.round((ebitda / revenue) * 10000) / 100 : opmPct,
      opex: null,
      pat: patVal,
      patPrior: crToMn(payload.yoyPriorQuarter?.netIncome),
      patMargin:
        patVal && revenue && revenue > 0 ? Math.round((patVal / revenue) * 10000) / 100 : (latest.netMargin ?? null),
      eps: latest.eps ?? null,
      epsPrior: payload.yoyPriorQuarter?.eps ?? null,
      rnd: null,
      sga: null,
      da: daVal,
      interestExpense: crToMn(latest.interestExpense),
      pbt: crToMn(latest.pbt),
      tax: null,
      otherIncome: crToMn(latest.otherIncome),
      cash: null,
      totalDebt: null,
      equity: null,
      totalAssets: null,
      netDebt: null,
      capex: null,
      ar: null,
      inventory: null,
      cfo: null,
      fcf: null,
      deRatio: payload.topMetrics?.debtToEquity ?? null,
      cfoPat: null,
      roce: payload.topMetrics?.roce ?? null,
      roe: payload.topMetrics?.roe ?? null,
      roa: null,
      orderBook: null,
      backlog: null,
      headcount: null,
      guidance: [],
      keyMetrics: [],
      forwardStatements: [],
      themes,
      mgmtTone: 'neutral',
      validationWarnings: [`Source: ${sourceLabel} — values in ₹ Cr`],
      hardFailures: [],
      isDataReliable: revenue !== null,
      parseState: revenue !== null ? 'verified' : 'partial',
      parseConfidence: revenue !== null ? (usedNse ? 95 : 88) : 60,
      revenueSource: usedNse ? 'nse_quarterly_results' : 'screener_in',
      discontinuedIncome: null,
      continuingRevenue: revenue,
      continuingPAT: patVal,
      continuingOpsDetected: false,
    } as RawFinancials;
  }

  // ── NSE/BSE via server-side proxy (India tickers) — TERTIARY fallback ─────
  // Used only if /api/earnings/india-screener returns nothing. Hits the
  // narrower /api/earnings/india endpoint which only checks NSE/BSE direct
  // financial-results endpoints (recent IPOs may not yet be listed there).
  async function fetchFromIndiaExchanges(ticker: string): Promise<RawFinancials | null> {
    let payload: any = null;
    try {
      const res = await fetch(`/api/earnings/india?ticker=${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(20000),
      });
      payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) return null;
    } catch {
      return null;
    }

    // NSE/BSE proxy returns values already in ₹ Mn (no further scaling needed).
    const SCALE = 1; // display unit IS storage unit
    const round2 = (v: number | null | undefined): number | null =>
      v === null || v === undefined ? null : Math.round(v * 100) / 100;

    const revenue = round2(payload.revenue);
    const revPrior = round2(payload.revenuePrior);
    const grossProfit = round2(payload.grossProfit);
    const grossMargin =
      revenue && grossProfit && revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null;
    const ebitVal = round2(payload.operatingIncome);
    const daVal = round2(payload.da);
    const patVal = round2(payload.netIncome);

    let ebitda: number | null = null;
    if (ebitVal !== null && daVal !== null) {
      ebitda = Math.round((ebitVal + Math.abs(daVal)) * 1000) / 1000;
    }

    const themes = detectNarrativeThemes(`${payload.company || ticker}`);
    const isBSE = payload.source === 'bse_financial_results';
    const filingType = payload.filingType || (isBSE ? 'BSE Result Filing' : 'NSE Quarterly Results');

    return {
      company: payload.company || ticker,
      ticker: (payload.ticker || ticker).toUpperCase(),
      period: payload.period || 'Latest',
      periodType: payload.periodType || 'quarterly',
      filingType,
      currency: 'INR',
      scaleLabel: '₹ Mn',
      scaleFactor: SCALE,
      revenue,
      revPrior,
      grossProfit,
      grossMargin,
      ebit: ebitVal,
      ebitMargin:
        ebitVal && revenue && revenue > 0 ? Math.round((ebitVal / revenue) * 10000) / 100 : null,
      ebitda,
      ebitdaMargin:
        ebitda && revenue && revenue > 0 ? Math.round((ebitda / revenue) * 10000) / 100 : null,
      opex: null,
      pat: patVal,
      patPrior: round2(payload.netIncomePrior),
      patMargin:
        patVal && revenue && revenue > 0 ? Math.round((patVal / revenue) * 10000) / 100 : null,
      eps: payload.eps ?? null,
      epsPrior: payload.epsPrior ?? null,
      rnd: round2(payload.rnd),
      sga: round2(payload.sga),
      da: daVal,
      interestExpense: round2(payload.interestExpense),
      pbt: round2(payload.pbt),
      tax: round2(payload.tax),
      otherIncome: null,
      cash: round2(payload.cash),
      totalDebt: round2(payload.totalDebt),
      equity: round2(payload.equity),
      totalAssets: round2(payload.totalAssets),
      netDebt: null,
      capex: round2(payload.capex),
      ar: null,
      inventory: null,
      cfo: round2(payload.cfo),
      fcf: null,
      deRatio: null,
      cfoPat: null,
      roce: null,
      roe: null,
      roa: null,
      orderBook: null,
      backlog: null,
      headcount: null,
      guidance: [],
      keyMetrics: [],
      forwardStatements: [],
      themes,
      mgmtTone: 'neutral',
      validationWarnings: [
        isBSE
          ? `Source: BSE filings (scripcode ${payload.scripcode}) — line items may need PDF parsing`
          : `Source: NSE Quarterly Results — values in ₹ Mn (NSE files in Lakhs)`,
        ...(payload.warning ? [payload.warning] : []),
      ],
      hardFailures: [],
      isDataReliable: revenue !== null,
      parseState: revenue !== null ? 'verified' : 'partial',
      parseConfidence: revenue !== null ? 92 : 60,
      revenueSource: payload.source || 'nse_financial_results',
      discontinuedIncome: null,
      continuingRevenue: revenue,
      continuingPAT: patVal,
      continuingOpsDetected: false,
    } as RawFinancials;
  }

  async function fetchFromFMP(ticker: string): Promise<RawFinancials | null> {
    const [incRes, bsRes, cfRes, profRes] = await Promise.allSettled([
      fmpFetch('income-statement', ticker, { period: 'quarterly', limit: '5' }),
      fmpFetch('balance-sheet-statement', ticker, { period: 'quarterly', limit: '2' }),
      fmpFetch('cash-flow-statement', ticker, { period: 'quarterly', limit: '2' }),
      fmpFetch('profile', ticker),
    ]);
    const safe = async (r: PromiseSettledResult<Response>) =>
      r.status === 'fulfilled' ? unwrapFmpJson(r.value) : [];
    const [inc, bs, cf, profiles] = await Promise.all([safe(incRes), safe(bsRes), safe(cfRes), safe(profRes)]);

    const profile = (profiles as any[])[0] ?? {};
    const cur = (inc as any[])[0] ?? {};
    const prev = (inc as any[])[1] ?? {};
    const bsCur = (bs as any[])[0] ?? {};
    const cfCur = (cf as any[])[0] ?? {};

    if (!cur.revenue) return null;

    const isIndia = ticker.endsWith('.NS') || ticker.endsWith('.BO');
    const currency = isIndia ? 'INR' as const : 'USD' as const;
    const SCALE = 1e-6;
    const s = (v: any): number|null => { const n=parseFloat(v); return isNaN(n)?null:Math.round(n*SCALE*100)/100; };

    // PATCH 0445 BUG-041 — FMP /stable/ endpoint uses different field shapes
    // than legacy /v3/. NVDA was showing '—' for EBITDA/Margins/FCF because
    // the field names had drifted. Try every known FMP shape per metric.
    const pick = (obj: any, keys: string[]): any => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    const revenue = s(pick(cur, ['revenue', 'totalRevenue']));
    const revPrior = s(pick(prev, ['revenue', 'totalRevenue']));
    const grossProfit = s(pick(cur, ['grossProfit', 'gross_profit']));
    const grossMargin = revenue && grossProfit && revenue > 0 ? Math.round((grossProfit/revenue)*10000)/100 : null;
    const ebit = s(pick(cur, ['operatingIncome', 'operating_income', 'ebit', 'operatingProfit']));
    const patVal = s(pick(cur, ['netIncome', 'net_income', 'netIncomeApplicableToCommonShares']));
    const cfoVal = s(pick(cfCur, ['operatingCashFlow', 'netCashProvidedByOperatingActivities', 'operating_cash_flow', 'cashflowFromOperations']));
    const capexV = s(pick(cfCur, ['capitalExpenditure', 'capital_expenditure', 'investmentsInPropertyPlantAndEquipment', 'capex']));
    const daVal = s(pick(cur, ['depreciationAndAmortization', 'depreciation_and_amortization', 'depreciation']));
    let ebitda = s(pick(cur, ['ebitda', 'EBITDA']));
    if (!ebitda && ebit !== null && daVal !== null) ebitda = Math.round((ebit + Math.abs(daVal)) * 1000) / 1000;
    // Direct FCF from FMP if it exposes one
    const fcfDirect = s(pick(cfCur, ['freeCashFlow', 'free_cash_flow', 'fcf']));

    return {
      company: profile.companyName || ticker,
      ticker: ticker.toUpperCase(),
      period: cur.period || cur.date?.slice(0,7) || 'Latest',
      periodType: 'quarterly',
      filingType: isIndia ? 'Quarterly Results (FMP)' : 'SEC 10-Q (FMP)',
      currency, scaleLabel: currency === 'INR' ? '₹ Mn' : '$ Mn', scaleFactor: SCALE,
      revenue, revPrior, grossProfit, grossMargin,
      ebit, ebitMargin: ebit&&revenue&&revenue>0?Math.round((ebit/revenue)*10000)/100:null,
      ebitda, ebitdaMargin: ebitda&&revenue&&revenue>0?Math.round((ebitda/revenue)*10000)/100:null,
      opex: null,
      pat: patVal, patPrior: s(prev.netIncome),
      patMargin: patVal&&revenue&&revenue>0?Math.round((patVal/revenue)*10000)/100:null,
      eps: parseFloat(cur.eps)||null, epsPrior: parseFloat(prev.eps)||null,
      rnd: s(cur.researchAndDevelopmentExpenses), sga: s(cur.sellingGeneralAndAdministrativeExpenses),
      da: daVal, interestExpense: s(cur.interestExpense), pbt: s(cur.incomeBeforeTax), tax: s(cur.incomeTaxExpense),
      otherIncome: null,
      cash: s(bsCur.cashAndCashEquivalents), totalDebt: s(bsCur.totalDebt),
      equity: s(bsCur.totalStockholdersEquity ?? bsCur.totalEquity), totalAssets: s(bsCur.totalAssets),
      netDebt: bsCur.totalDebt && bsCur.cashAndCashEquivalents ? s(parseFloat(bsCur.totalDebt)-parseFloat(bsCur.cashAndCashEquivalents)) : null,
      capex: capexV, ar: null, inventory: null, cfo: cfoVal,
      // PATCH 0445 BUG-041 — Prefer FMP's direct freeCashFlow when available
      // (more accurate than CFO minus capex when FMP reports them separately).
      fcf: fcfDirect ?? (cfoVal !== null && capexV !== null ? cfoVal - Math.abs(capexV) : null),
      deRatio: null, cfoPat: cfoVal&&patVal&&patVal!==0?Math.round((cfoVal/patVal)*100)/100:null,
      roce: null, roe: null, roa: null,
      orderBook: null, backlog: null, headcount: profile.fullTimeEmployees||null,
      guidance: [], keyMetrics: [], forwardStatements: [],
      themes: detectNarrativeThemes(`${profile.companyName||ticker} ${profile.sector||''} ${profile.industry||''} ${profile.description||''}`),
      mgmtTone: 'neutral',
      validationWarnings: ['Source: FMP structured API'],
      hardFailures: [], isDataReliable: true,
      parseState: 'verified', parseConfidence: 88, revenueSource: 'fmp_api',
      discontinuedIncome: null, continuingRevenue: revenue, continuingPAT: patVal, continuingOpsDetected: false,
    } as RawFinancials;
  }

  async function fetchFromTicker(sym: string) {
    if (!sym.trim()) { setError('Enter a ticker symbol'); return; }
    const ticker = sym.trim().toUpperCase();
    setLoading(true); setError(''); setLoadingPct(5);
    const isIndia = ticker.endsWith('.NS') || ticker.endsWith('.BO') || ticker.endsWith('.BSE');

    try {
      let financials: RawFinancials | null = null;

      if (!isIndia) {
        // ── US stocks: SEC EDGAR XBRL is PRIMARY (deterministic, 100% accurate) ──
        setLoadingMsg(`Looking up ${ticker} on SEC EDGAR…`);
        setLoadingPct(10);
        try {
          financials = await fetchFromEDGARXBRL(ticker);
          if (financials) {
            setLoadingMsg(`Found ${ticker} on EDGAR XBRL — fetching analyst estimates…`);
            setLoadingPct(40);
          }
        } catch (edgarErr) {
          console.warn('EDGAR XBRL lookup failed, trying FMP:', edgarErr);
        }
      } else {
        // ── India stocks: PRIMARY = /api/earnings/india-screener ──
        // Internally NSE-first (corporates-financial-results), then Screener
        // fallback. Covers recent IPOs (ACMESOLAR) and BSE-only midcaps that
        // the narrower /api/earnings/india endpoint can't resolve.
        setLoadingMsg(`Looking up ${ticker} on NSE/BSE/Screener…`);
        setLoadingPct(10);
        try {
          financials = await fetchFromScreenerIndia(ticker);
          if (financials) {
            setLoadingMsg(`Found ${ticker} on ${financials.filingType} — fetching analyst estimates…`);
            setLoadingPct(40);
          }
        } catch (scrErr) {
          console.warn('Screener-india lookup failed, trying NSE direct:', scrErr);
        }

        // Tertiary: narrower NSE/BSE-only endpoint (kept for tickers Screener
        // doesn't index but NSE does, e.g. fresh listings before Screener
        // updates its slug map).
        if (!financials) {
          setLoadingMsg(`${ticker} not on Screener — trying NSE/BSE direct…`);
          setLoadingPct(15);
          try {
            financials = await fetchFromIndiaExchanges(ticker);
            if (financials) {
              setLoadingMsg(`Found ${ticker} on ${financials.filingType} — fetching analyst estimates…`);
              setLoadingPct(40);
            }
          } catch (inErr) {
            console.warn('NSE/BSE direct lookup failed, trying FMP:', inErr);
          }
        }
      }

      if (!financials) {
        // FMP final fallback: US tickers not on EDGAR; India tickers not on
        // NSE/BSE/Screener.
        setLoadingMsg(
          isIndia ? `${ticker} not on NSE/BSE/Screener — trying FMP…` : `${ticker} not on EDGAR — trying FMP…`,
        );
        setLoadingPct(20);
        financials = await fetchFromFMP(ticker);
        if (financials) setLoadingPct(45);
      }

      // ── Bare-symbol India auto-fallback (SWIGGY / ZOMATO / RELIANCE) ──
      // If the user typed a bare symbol with no .NS / .BO suffix and US
      // sources came back empty, try the India pipeline before giving up.
      // Many recent listings (Swiggy IPO Nov-2024) get flagged as US
      // because they lack a suffix.
      if (!financials && !isIndia) {
        setLoadingMsg(`${ticker} not on US sources — trying NSE/BSE/Screener as ${ticker}.NS…`);
        setLoadingPct(25);
        try {
          financials = await fetchFromScreenerIndia(`${ticker}.NS`);
          if (financials) {
            setLoadingPct(45);
          }
        } catch {
          // ignore
        }
      }

      if (!financials) {
        if (isIndia) {
          setError(`No data found for "${ticker}" on NSE, BSE, Screener.in, or FMP. Verify the ticker symbol — try without the .NS / .BO suffix, or use the BSE 6-digit scrip code if it's BSE-only.`);
        } else {
          setError(
            `No data found for "${ticker}" on EDGAR / FMP / NSE / BSE / Screener.in. ` +
            `If this is an Indian stock, try with a .NS suffix (e.g. ${ticker}.NS or ${ticker}.BO). ` +
            `For very small US caps not on EDGAR, try PDF upload.`,
          );
        }
        setLoading(false); return;
      }

      // ── Fetch FMP analyst estimates + surprise history in parallel (all markets) ──
      setLoadingMsg('Fetching analyst estimates and earnings surprise history…');
      setLoadingPct(60);
      const [surpriseRes, estRes] = await Promise.allSettled([
        fmpFetch('earnings-surprises', ticker),
        fmpFetch('analyst-estimates', ticker, { period: 'quarterly', limit: '4' }),
      ]);
      const safeEst = async (r: PromiseSettledResult<Response>) =>
        r.status === 'fulfilled' ? unwrapFmpJson(r.value) : [];
      const [surprises, ests] = await Promise.all([safeEst(surpriseRes), safeEst(estRes)]);
      const nextEst = (ests as any[])[0] ?? {};

      const quarterly = (surprises as any[]).slice(0, 8).map((q: any) => ({
        fiscalDateEnding: q.date || '',
        period: q.date?.slice(0, 7) || '',
        reportedEPS: parseFloat(q.actualEarningResult ?? q.actualEps) || null,
        estimatedEPS: parseFloat(q.estimatedEarning ?? q.estimatedEps) || null,
        surprise: null,
        surprisePct: (() => { const a = parseFloat(q.actualEarningResult ?? q.actualEps); const e = parseFloat(q.estimatedEarning ?? q.estimatedEps); return !isNaN(a) && !isNaN(e) && e !== 0 ? Math.round(((a - e) / Math.abs(e)) * 10000) / 100 : null; })(),
        reportedRevenue: parseFloat(q.actualRevenue) ? Math.round(parseFloat(q.actualRevenue) / 1e6 * 10) / 10 : null,
        estimatedRevenue: parseFloat(q.estimatedRevenue) ? Math.round(parseFloat(q.estimatedRevenue) / 1e6 * 10) / 10 : null,
        revSurprisePct: (() => { const a = parseFloat(q.actualRevenue); const e = parseFloat(q.estimatedRevenue); return !isNaN(a) && !isNaN(e) && e !== 0 ? Math.round(((a - e) / Math.abs(e)) * 10000) / 100 : null; })(),
      }));

      setAvData({
        symbol: ticker,
        name: financials.company,
        sector: '', industry: '',
        dataSource: 'FMP',
        epsEstNextQ: parseFloat(nextEst.estimatedEpsAvg) || null,
        epsEstCurrentYear: parseFloat(nextEst.estimatedEpsAvg) || null,
        revenueEstNextQ: nextEst.estimatedRevenueAvg ? Math.round(parseFloat(nextEst.estimatedRevenueAvg) / 1e6 * 10) / 10 : null,
        revenueEstCurrentYear: null,
        grossMarginEst: null,
        analystTargetPrice: null,
        numAnalysts: parseInt(nextEst.numberAnalysts) || null,
        quarterlyEarnings: quarterly,
      });
      setAvTicker(ticker);

      setLoadingMsg('Building analysis…');
      setLoadingPct(85);

      // Run validation and scoring
      const d = financials;
      const sanitizationIssues = sanitizeMetrics(d);
      d.hardFailures = sanitizationIssues;
      d.isDataReliable = sanitizationIssues.filter(s => !s.includes('verify')).length === 0;

      const q = scoreAccountingQuality(d, baseCaseUpsideFromReport(valReport));
      const r = scoreEarningsReaction(d);
      const nar = scoreNarrative(d);
      setResult({ d, q, r, nar });
      setLoadingPct(100);

      // ── Build institutional snapshot in parallel with FMP estimates + history ──
      setLoadingMsg('Building institutional snapshot…');
      // Re-classify based on the ACTUAL data the lookup returned. The ticker
      // might have come in bare (e.g. SWIGGY) and resolved via the India
      // fallback — in which case d.currency is 'INR' and we want the India
      // pipeline, not the US one.
      const dataIsIndia = isIndia || d.currency === 'INR';
      try {
        if (dataIsIndia) {
          // ── INDIA PIPELINE: Screener.in + FMP profile ──
          // Don't call FMP estimates/history — they're premium-blocked for India.
          // Don't call EDGAR — India tickers aren't on SEC.
          // For bare-symbol India fallback (e.g. SWIGGY), pass ${ticker}.NS
          // so the screener route searches with the suffix that works.
          const indiaTicker = isIndia ? ticker : `${ticker}.NS`;
          const [screenerRes, profileRes] = await Promise.allSettled([
            fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(indiaTicker)}`, { signal: AbortSignal.timeout(20000) }),
            fetch(`/api/earnings/estimates?ticker=${encodeURIComponent(indiaTicker)}`, { signal: AbortSignal.timeout(15000) }),
          ]);
          const screenerJson: any = screenerRes.status === 'fulfilled' && screenerRes.value.ok
            ? await screenerRes.value.json().catch(() => null)
            : null;
          const fmpJson: any = profileRes.status === 'fulfilled' && profileRes.value.ok
            ? await profileRes.value.json().catch(() => null)
            : null;
          const fmpProfile = fmpJson?.profile || null;
          // Cache so the user can later re-run with a concall transcript
          indiaSnapshotInputsRef.current = {
            ticker: d.ticker,
            filingType: d.filingType,
            screenerJson,
            fmpProfile,
          };
          const snap = buildIndiaSnapshot(
            d.ticker,
            d.filingType,
            screenerJson,
            fmpProfile,
            '',
          );
          setSnapshot(snap);
        } else {
          // ── US PIPELINE: SEC EDGAR + FMP estimates/history ──
          const [estRes, histRes] = await Promise.allSettled([
            fetch(`/api/earnings/estimates?ticker=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(15000) }),
            fetch(`/api/earnings/history?ticker=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(15000) }),
          ]);
          const estJson: EstimatesInput | null = estRes.status === 'fulfilled' && estRes.value.ok
            ? await estRes.value.json().catch(() => null)
            : null;
          const histJson: HistoryInput | null = histRes.status === 'fulfilled' && histRes.value.ok
            ? await histRes.value.json().catch(() => null)
            : null;
          const edgarP = lastEdgarPayloadRef.current;
          const finIn: FinancialsInput = {
            company: d.company,
            ticker: d.ticker,
            period: d.period,
            filingType: d.filingType,
            currency: d.currency,
            scaleLabel: d.scaleLabel,
            scaleFactor: d.scaleFactor,
            revenue: d.revenue, revPrior: d.revPrior,
            grossProfit: d.grossProfit, grossMargin: d.grossMargin,
            ebit: d.ebit, ebitMargin: d.ebitMargin,
            ebitda: d.ebitda, ebitdaMargin: d.ebitdaMargin,
            pat: d.pat, patPrior: d.patPrior, patMargin: d.patMargin,
            eps: d.eps, epsPrior: d.epsPrior,
            cfo: d.cfo, fcf: d.fcf,
            cash: d.cash, totalDebt: d.totalDebt, netDebt: d.netDebt, equity: d.equity,
            themes: d.themes, validationWarnings: d.validationWarnings, revenueSource: d.revenueSource,
            // SEC enrichment (when EDGAR was used)
            sicDescription: edgarP?.sicDescription ?? null,
            exchange: edgarP?.exchange ?? null,
            category: edgarP?.category ?? null,
            businessText: edgarP?.businessText ?? null,
          };
          usSnapshotInputsRef.current = { finIn, estJson, histJson };
          const snap = buildSnapshot(finIn, estJson, histJson, '');
          setSnapshot(snap);
        }
      } catch (snapErr) {
        console.warn('Snapshot build failed:', snapErr);
        setSnapshot(null);
      }

      // Save to history
      const entry: HistEntry2 = {
        id: Date.now().toString(), company: d.company, period: d.period,
        q: q.score, r: r.score, n: nar.score, color: r.color, summary: r.summary,
        at: new Date().toISOString(),
      };
      const upd = [entry, ...history.filter(h => h.company !== d.company || h.period !== d.period)];
      setHistory(upd); saveHist2(upd);

    } catch (e: any) {
      setError(`Failed to fetch data for "${ticker}": ${e.message}`);
    }
    setLoading(false); setLoadingMsg(''); setLoadingPct(0);
  }

  const process = useCallback((text: string) => {
    setError('');
    if (!text.trim()) { setError('No text to analyze.'); return; }
    setLoadingMsg('Running extraction engine…');
    setTimeout(() => {
      try {
        const d = parseEarnings(text);
        const q = scoreAccountingQuality(d, baseCaseUpsideFromReport(valReport));
        const r = scoreEarningsReaction(d);
        const nar = scoreNarrative(d);
        setResult({ d, q, r, nar });
        // Build a snapshot from parsed text (no FMP estimates available for paste path)
        try {
          const finIn: FinancialsInput = {
            company: d.company, ticker: d.ticker, period: d.period, filingType: d.filingType,
            currency: d.currency, scaleLabel: d.scaleLabel, scaleFactor: d.scaleFactor,
            revenue: d.revenue, revPrior: d.revPrior, grossProfit: d.grossProfit, grossMargin: d.grossMargin,
            ebit: d.ebit, ebitMargin: d.ebitMargin, ebitda: d.ebitda, ebitdaMargin: d.ebitdaMargin,
            pat: d.pat, patPrior: d.patPrior, patMargin: d.patMargin, eps: d.eps, epsPrior: d.epsPrior,
            cfo: d.cfo, fcf: d.fcf, cash: d.cash, totalDebt: d.totalDebt, netDebt: d.netDebt, equity: d.equity,
            themes: d.themes, validationWarnings: d.validationWarnings, revenueSource: d.revenueSource,
          };
          setSnapshot(buildSnapshot(finIn, null, null, text));
        } catch { setSnapshot(null); }
        const entry: HistEntry2 = {
          id: Date.now().toString(), company: d.company, period: d.period,
          q: q.score, r: r.score, n: nar.score,
          color: r.color, summary: r.summary, at: new Date().toISOString(),
        };
        const upd = [entry, ...history.filter(h => h.company !== d.company || h.period !== d.period)];
        setHistory(upd); saveHist2(upd);
      } catch (e: any) { setError('Analysis failed: ' + e.message); }
      setLoading(false); setLoadingMsg(''); setLoadingPct(0);
    }, 10);
  }, [history]);

  // PATCH — when the InlineValuationPanel (re)computes or clears its report, the
  // base-case valuation upside changes. Re-run the accounting-quality scorer so
  // the concall score picks up the ±8 valuation contribution without the user
  // having to re-paste / re-fetch. Bails out (returns prev) when the recomputed
  // score is unchanged to avoid needless re-renders / loops.
  useEffect(() => {
    setResult(prev => {
      if (!prev) return prev;
      const q = scoreAccountingQuality(prev.d, baseCaseUpsideFromReport(valReport));
      if (q.score === prev.q.score && q.signals.length === prev.q.signals.length) return prev;
      return { ...prev, q };
    });
  }, [valReport]);

  async function handleFile(files: FileList|null) {
    if (!files?.length) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase()||'';
    setLoading(true); setError(''); setLoadingPct(0);
    if (ext === 'pdf') {
      const {text, error: e, pagesRead, totalPages, pageRanges} = await extractPDFText(file, (pct, msg) => { setLoadingPct(pct); setLoadingMsg(msg); });
      if (e || !text.trim()) { setError(e||'No text extracted. Try Paste mode.'); setLoading(false); return; }
      // AUDIT_100 #85 — log honest page-coverage notice. We log to console since
      // the in-page error state is reset by process(); a permanent banner needs
      // a separate state field but would require >30 lines to wire.
      if (pagesRead && totalPages && pagesRead < totalPages) {
        console.info(`[earnings-analysis] Analyzed pages ${pageRanges} (${pagesRead} of ${totalPages}) — large PDFs are sampled by section.`);
      }
      process(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      setLoadingMsg('Parsing Excel…');
      try {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, {type:'array'});
        const txt = wb.SheetNames.map(n => `=== ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
        process(txt);
      } catch (e:any) { setError('Excel error: '+e.message); setLoading(false); }
    } else {
      setLoadingMsg('Reading…');
      const txt = await file.text().catch(()=>'');
      if (!txt) { setError('Cannot read file.'); setLoading(false); return; }
      process(txt);
    }
  }

  async function handleURL() {
    if (!urlInput.trim()) { setError('Enter a URL'); return; }
    setLoading(true); setError(''); setLoadingPct(0); setLoadingMsg('Fetching…');
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(urlInput.trim())}`, {signal: AbortSignal.timeout(20000)});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type')||'';
      if (ct.includes('pdf')) {
        const blob = await res.blob();
        const f = new File([blob],'report.pdf',{type:'application/pdf'});
        const {text,error:e} = await extractPDFText(f,(pct,msg)=>{setLoadingPct(pct);setLoadingMsg(msg);});
        if (e||!text) throw new Error(e||'Empty PDF');
        process(text);
      } else {
        const html = await res.text();
        const div = document.createElement('div'); div.innerHTML = html;
        process(div.innerText||div.textContent||html.replace(/<[^>]*>/g,' '));
      }
    } catch(e:any) { setError('Fetch failed: '+e.message); setLoading(false); setLoadingMsg(''); }
  }

  const reset = () => {
    setResult(null);
    setSnapshot(null);
    lastEdgarPayloadRef.current = null;
    indiaSnapshotInputsRef.current = null;
    usSnapshotInputsRef.current = null;
    setError('');
    setPasteText('');
    setUrlInput('');
  };

  // Re-run buildIndiaSnapshot with a concall transcript so guidance / tone /
  // theme detection get filled in. Cached inputs from the original fetch are
  // reused so we don't hammer Screener / FMP again.
  // Also auto-archive the extraction to /api/concall/history so the
  // Concall Intel tab populates with credibility data over multiple
  // quarters.
  const handleIndiaConcallText = useCallback((text: string) => {
    const inputs = indiaSnapshotInputsRef.current;
    if (!inputs) return;
    setConcallProcessing(true);
    try {
      const snap = buildIndiaSnapshot(
        inputs.ticker,
        inputs.filingType,
        inputs.screenerJson,
        inputs.fmpProfile,
        text,
      );
      setSnapshot(snap);
      // PATCH 0650 — client-side persistence keyed by ticker so reopening
      // the same company shows the saved snapshot without re-upload.
      try {
        const concallExtras: any = snap.indiaExtras?.concall;
        const toneSignals: string[] | undefined = Array.isArray(concallExtras?.toneSignals)
          ? concallExtras.toneSignals.map((t: any) => typeof t === 'string' ? t : (t?.phrase || ''))
              .filter((s: string) => !!s)
          : undefined;
        saveConcallSnapshot({
          ticker: inputs.ticker,
          company: snap.company || inputs.ticker,
          sector: snap.sector ?? undefined,
          period: snap.quarter ?? undefined,
          concallScore: concallExtras?.concallScore,
          concallGrade: concallExtras?.concallGrade,
          toneSignals,
          topQuotes: concallExtras?.topQuotes,
          guidanceDirection: snap.guidance?.direction,
          guidanceCommentary: snap.guidance?.commentary,
          docSnapshots: [{
            name: 'concall.pdf', size: text.length, uploadedAt: new Date().toISOString(),
          }],
        });
      } catch (e) { /* non-fatal */ }
      // Fire-and-forget archive so future Concall Intel tab can compare
      // guidance vs outcome across quarters.
      const concall = snap.indiaExtras?.concall;
      if (concall) {
        const archive = {
          ticker: inputs.ticker,
          snapshot: {
            period: snap.quarter,
            capturedAt: new Date().toISOString(),
            concallScore: concall.concallScore,
            concallGrade: concall.concallGrade,
            positiveCount: concall.positiveCount,
            negativeCount: concall.negativeCount,
            cautiousCount: concall.cautiousCount,
            guidanceDirection: snap.guidance.direction,
            guidanceCommentary: snap.guidance.commentary || [],
            topQuotes: concall.topQuotes,
          },
        };
        fetch('/api/concall/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(archive),
        }).catch(() => null);
      }
    } finally {
      setConcallProcessing(false);
    }
  }, []);

  const handleUsConcallText = useCallback((text: string) => {
    const inputs = usSnapshotInputsRef.current;
    if (!inputs) return;
    setConcallProcessing(true);
    try {
      const snap = buildSnapshot(inputs.finIn, inputs.estJson, inputs.histJson, text);
      setSnapshot(snap);
    } finally {
      setConcallProcessing(false);
    }
  }, []);

  // Copy a deterministic plain-text summary from the snapshot
  const copySnapshotSummary = (snap: EarningsSnapshot) => {
    const lines: string[] = [];
    lines.push(`${snap.company} (${snap.ticker}) — ${snap.quarter} · ${snap.filingType}`);
    lines.push(`Source: ${snap.sources.financials} · estimates: ${snap.sources.estimates}`);
    lines.push('');
    lines.push('EARNINGS SCORECARD');
    const m = snap.metrics;
    const fnum = (v: number | null, p = 2) => v === null ? '—' : v.toFixed(p);
    lines.push(`Revenue:          ${fnum(m.revenue.actual, 1)} vs ${fnum(m.revenue.estimate, 1)} est (${m.revenue.surprisePct === null ? '—' : (m.revenue.surprisePct >= 0 ? '+' : '') + m.revenue.surprisePct.toFixed(1) + '%'})`);
    lines.push(`EPS:              ${fnum(m.eps.actual, 2)} vs ${fnum(m.eps.estimate, 2)} est`);
    lines.push(`EBITDA:           ${fnum(m.ebitda.actual, 1)} vs ${fnum(m.ebitda.estimate, 1)} est`);
    lines.push(`Gross Margin:     ${fnum(m.grossMargin.actual, 1)}% (YoY ${m.grossMargin.yoyBps === null ? '—' : (m.grossMargin.yoyBps >= 0 ? '+' : '') + Math.round(m.grossMargin.yoyBps) + ' bps'})`);
    lines.push(`EBITDA Margin:    ${fnum(m.ebitdaMargin.actual, 1)}% vs ${fnum(m.ebitdaMargin.estimate, 1)}% est`);
    lines.push(`Operating Margin: ${fnum(m.operatingMargin.actual, 1)}%`);
    lines.push(`Net Income:       ${fnum(m.netIncome.actual, 1)}`);
    lines.push(`FCF:              ${fnum(m.fcf.actual, 1)}`);
    lines.push('');
    lines.push(`Reaction Score:   ${snap.scores.reaction.score ?? '—'} (${snap.scores.reaction.grade}) — expected ${snap.reactionProbability.expected}`);
    lines.push(`Accounting:       ${snap.scores.accounting.score} (${snap.scores.accounting.grade})`);
    lines.push(`Narrative:        ${snap.scores.narrative.score} (${snap.scores.narrative.grade})`);
    lines.push(`JAT:              ${snap.scores.jat.score ?? '—'} (${snap.scores.jat.grade}) — ${snap.scores.jat.direction}`);
    if (snap.qualitative.keyTakeaways.length > 0) {
      lines.push('');
      lines.push('KEY TAKEAWAYS');
      snap.qualitative.keyTakeaways.forEach(t => lines.push(`• ${t}`));
    }
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  };

  // ── Loading UI ──────────────────────────────────────────────────────────
  const LoadingUI = () => (
    <div style={{textAlign:'center',padding:'40px 20px'}}>
      <div style={{width:56,height:56,borderRadius:'50%',border:`4px solid var(--mc-bg-3)`,borderTopColor:ACCENT,animation:'spin 0.9s linear infinite',margin:'0 auto 20px'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:'100%',maxWidth:360,height:6,backgroundColor:'var(--mc-bg-3)',borderRadius:3,overflow:'hidden',margin:'0 auto 12px'}}>
        <div style={{height:'100%',width:`${loadingPct}%`,background:`linear-gradient(90deg,${ACCENT},${PURPLE})`,borderRadius:3,transition:'width 0.3s'}}/>
      </div>
      <div style={{fontSize:F.md,fontWeight:600,color:ACCENT,marginBottom:4}}>{loadingMsg||'Processing…'}</div>
      {loadingPct > 0 && <div style={{fontSize:10,color:MUTED}}>{loadingPct}%</div>}
    </div>
  );

  // ── Score Wheel (mini) ──────────────────────────────────────────────────
  const ScoreWheel = ({ eng, size=80 }: { eng: EngineOutput; size?: number }) => {
    const r = size/2 - 6;
    const circ = 2*Math.PI*r;
    const dash = (eng.score/100)*circ;
    return (
      <div style={{textAlign:'center',flexShrink:0}}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={5}/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={eng.color} strokeWidth={5}
            strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`}/>
          <text x={size/2} y={size/2-4} textAnchor="middle" fill={eng.color} fontSize={size*0.22} fontWeight={900}>{eng.score}</text>
          <text x={size/2} y={size/2+10} textAnchor="middle" fill={MUTED} fontSize={size*0.11}>{eng.grade}</text>
        </svg>
        <div style={{fontSize:9,color:MUTED,marginTop:2,fontWeight:600,letterSpacing:'0.3px'}}>{eng.label.toUpperCase()}</div>
      </div>
    );
  };

  // ── Metric Row ──────────────────────────────────────────────────────────
  const MetRow = ({ label, cur, prior, d, isPct, isEps, highlight }: {
    label: string; cur: number|null; prior?: number|null; d: RawFinancials;
    isPct?: boolean; isEps?: boolean; highlight?: boolean;
  }) => {
    if (cur === null && !highlight) return null;
    const gb = prior !== undefined ? growth(cur, prior??null) : null;
    const val = isEps ? (cur !== null ? `${d.currency==='USD'?'$':'₹'}${cur.toFixed(2)}` : '—')
                      : isPct ? `${cur?.toFixed(1)}%` : n(cur, d);
    return (
      <tr style={{backgroundColor: highlight ? 'rgba(56,189,248,0.05)' : 'transparent'}}>
        <td style={{padding:'5px 8px',fontSize:F.xs,color: highlight ? TEXT : MUTED, fontWeight: highlight ? 700 : 400, borderLeft: highlight ? `2px solid ${ACCENT}` : '2px solid transparent'}}>{label}</td>
        <td style={{padding:'5px 8px',fontSize:F.sm,fontWeight: highlight ? 700 : 400,color: cur !== null && cur < 0 ? RED : highlight ? TEXT : MUTED, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{val}</td>
        <td style={{padding:'5px 8px',textAlign:'right'}}>
          {gb && <span style={{fontSize:10,fontWeight:700,color:gb.col}}>{gb.text}</span>}
        </td>
      </tr>
    );
  };

  // ── Results dashboard ────────────────────────────────────────────────────
  // ── Institutional view: deterministic, schema-first, fixed layout ──────
  // Branch on currency: India tickers route to the dedicated India component
  // which uses fundamentals-only mode (QoQ/YoY trajectory, sector KPIs,
  // working capital cycle, promoter trend — no fake consensus grades).
  if (result && snapshot && reportView === 'institutional') {
    const isIndia = snapshot.currency === 'INR' || !!snapshot.indiaExtras;
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1280, margin: '0 auto', padding: '12px 20px 0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{
              fontSize: 10,
              padding: '4px 10px',
              borderRadius: 4,
              background: isIndia ? 'rgba(251,191,36,0.15)' : 'rgba(125,211,252,0.10)',
              color: isIndia ? 'var(--mc-warn)' : '#7dd3fc',
              border: `1px solid ${isIndia ? 'color-mix(in srgb, var(--mc-warn) 25%, transparent)' : '#7dd3fc40'}`,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}>
              {isIndia ? '🇮🇳 India · Fundamentals Mode' : '🇺🇸 US · Full Consensus Mode'}
            </span>
          </div>
          <button onClick={() => setReportView('legacy')}
            style={{ fontSize: 10, padding: '4px 10px', background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 4, cursor: 'pointer' }}>
            Switch to legacy view
          </button>
        </div>
        {isIndia ? (
          <IndiaInstitutionalReport
            snapshot={snapshot}
            onReset={reset}
            onCopy={() => copySnapshotSummary(snapshot)}
            onConcallText={handleIndiaConcallText}
            concallProcessing={concallProcessing}
          />
        ) : (
          <InstitutionalReport
            snapshot={snapshot}
            onReset={reset}
            onCopy={() => copySnapshotSummary(snapshot)}
            onConcallText={handleUsConcallText}
            concallProcessing={concallProcessing}
          />
        )}
        {/* PATCH 0687 — InlineValuationPanel is also mounted at the bottom of
            the legacy render path (line ~4232), but this branch early-returns
            for India / US Fundamentals + Consensus modes. Mounting it here
            too ensures the Auto-Valuation P/E + P/S + EV/EBITDA report shows
            up regardless of which institutional view the user is in. */}
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px' }}>
          <InlineValuationPanel onReport={setValReport} />
        </div>
      </div>
    );
  }

  if (result) {
    const { d, q, r, nar } = result;

    // Resolve ticker for AV lookup (use parsed ticker or let user input)
    // Helpers for the earnings scorecard
    const surpriseColor = (pct: number|null) => pct === null ? MUTED : pct >= 5 ? GREEN : pct >= 0 ? '#10b981aa' : pct >= -5 ? YELLOW : RED;
    const beatMissLabel = (actual: number|null, est: number|null): {text:string;col:string}|null => {
      if (actual === null || est === null) return null;
      const delta = actual - est;
      const pct = est !== 0 ? (delta / Math.abs(est)) * 100 : 0;
      if (pct >= 5) return { text: `↑ BEAT +${pct.toFixed(0)}%`, col: GREEN };
      if (pct >= 0) return { text: `↑ MET +${pct.toFixed(1)}%`, col: '#10b981aa' };
      if (pct >= -5) return { text: `↓ MISS ${pct.toFixed(1)}%`, col: YELLOW };
      return { text: `↓ MISS ${pct.toFixed(0)}%`, col: RED };
    };

    // Most recent quarter from AV (for EPS comparison)
    const latestQ = avData?.quarterlyEarnings[0] ?? null;
    const latestEpsEst = latestQ?.estimatedEPS ?? avData?.epsEstNextQ ?? null;
    const latestEpsActual = latestQ?.reportedEPS ?? d.eps ?? null;
    const epsBM = beatMissLabel(latestEpsActual, latestEpsEst);

    // FMP provides revenue estimates — use those as primary, then manual override
    // Revenue est from FMP is in $ Mn; compare with d.revenue (also in $ Mn from our scaler)
    const fmpRevEst = avData?.revenueEstNextQ ?? null;
    const fmpRevActual = latestQ?.reportedRevenue ?? null;   // $ Mn from FMP
    const fmpRevEstQ = latestQ?.estimatedRevenue ?? null;    // $ Mn from FMP

    // Use FMP's quarterly revenue actual/estimate if available, else fall back
    // d.revenue is in display units (Mn or Cr); fmpRevActual is in $ Mn
    const revActualDisplay = d.revenue; // from parsed PDF
    const revEstDisplay = manualRevEst
      ? parseFloat(manualRevEst.replace(/[^0-9.-]/g,''))
      : (fmpRevEst !== null ? fmpRevEst : null); // FMP estimate in $ Mn

    const revEstNum = revEstDisplay;
    const gmEstNum = manualGMEst
      ? parseFloat(manualGMEst.replace(/[^0-9.-]/g,''))
      : (avData?.grossMarginEst ?? null);

    // Revenue surprise from FMP's own historical data (if available)
    const fmpRevSurprise = latestQ?.revSurprisePct ?? null;

    // Has ANY estimate source?
    const hasEstimates = latestEpsEst !== null || revEstNum !== null || gmEstNum !== null;

    return (
      <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif',padding:'20px 16px',maxWidth:1800,margin:'0 auto'}}>

        {/* ══════════════════════════════════════════════════════════════════════
            COMPANY IDENTITY + EARNINGS SCORECARD
            Design: company name, ticker, period at top.
            Then: ACTUAL vs ESTIMATE comparison (the hero metric).
            Then: EPS beat/miss track record.
            NO market data grid — user gets all financial data from the report below.
            ══════════════════════════════════════════════════════════════════════ */}
        <div style={{backgroundColor:'#0a0a14',border:`1px solid ${BORDER}`,borderRadius:14,padding:'20px 22px',marginBottom:14,boxShadow:'0 4px 24px rgba(0,0,0,0.4)'}}>

          {/* Company identity + fetch row */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14,flexWrap:'wrap',marginBottom:14}}>
            <div>
              <h1 style={{fontSize:26,fontWeight:900,color:TEXT,margin:'0 0 4px',letterSpacing:'-0.5px'}}>
                {avData?.name || d.company}
              </h1>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {/*
                 * PATCH 0965 BUG #6 — Ticker badge truncates .NS suffix.
                 * Root cause: the badge inherited an implicit width clamp
                 * (parent flex row + padding) and the original `whiteSpace`
                 * wasn't pinned, so long Indian tickers like KIRLOSKAR.NS or
                 * BHARTIARTL.NS rendered "KIRLOSKAR.N" with the trailing 'S'
                 * clipped. Pin whiteSpace:'nowrap', overflow:'visible',
                 * minWidth:'fit-content' so any ticker length displays in full.
                 */}
                {(avData?.symbol || d.ticker) && (
                  <span style={{
                    fontSize:12,fontWeight:800,color:ACCENT,backgroundColor:ACCENT+'18',
                    padding:'2px 9px',borderRadius:4,letterSpacing:'0.5px',
                    whiteSpace:'nowrap',overflow:'visible',minWidth:'fit-content',
                    display:'inline-block',
                  }}>
                    {avData?.symbol || d.ticker}
                  </span>
                )}
                {avData?.sector && <><span style={{fontSize:10,color:MUTED}}>{avData.sector}</span><span style={{color:'var(--mc-border-2)',fontSize:10}}>›</span></>}
                {avData?.industry && <span style={{fontSize:10,color:MUTED}}>{avData.industry}</span>}
                <span style={{fontSize:10,color:'var(--mc-border-2)'}}>·</span>
                <span style={{fontSize:10,color:MUTED}}>{d.period} · {d.filingType} · {d.scaleLabel}</span>
                {avData?.analystTargetPrice && (
                  /* PATCH 0965 BUG #5 — Analyst Target Price was hardcoded "$". */
                  <span style={{fontSize:10,color:YELLOW}}>🎯 Target {formatCurrency(avData.analystTargetPrice, avData?.symbol || d.ticker, { decimals: 2 })}</span>
                )}
              </div>
            </div>
            {/* Compact fetch button */}
            <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
              <input value={avTicker} onChange={e => setAvTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && fetchAVData(avTicker || d.ticker)}
                placeholder={d.ticker || 'Ticker'}
                style={{width:90,backgroundColor:'#0d1117',border:`1px solid ${BORDER}`,borderRadius:6,padding:'5px 8px',color:TEXT,fontSize:11,outline:'none'}}
              />
              <button onClick={() => fetchAVData(avTicker || d.ticker)} disabled={avLoading}
                style={{padding:'5px 12px',backgroundColor:avData?ACCENT+'20':ACCENT,border:avData?`1px solid ${ACCENT}`:' none',borderRadius:6,color:avData?ACCENT:'#000',fontWeight:700,fontSize:11,cursor:'pointer',opacity:avLoading?0.6:1}}
              >
                {avLoading ? '⏳' : avData ? '↻ Re-fetch' : '📡 Fetch estimates'}
              </button>
              <span style={{fontSize:8,color:MUTED}}>{avData?.dataSource === 'FMP' ? '📊 FMP' : avData?.dataSource === 'AlphaVantage' ? 'AV fallback' : 'FMP primary'}</span>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              ACTUALS AND MARKET EXPECTATIONS
              Design rules per spec:
              1. Renamed from "ACTUAL vs ESTIMATE" → "Actuals and market expectations"
              2. Per-metric availability badges show data source
              3. Estimate columns hidden when no source available
              4. Analyst overrides behind a toggle button
              5. Coverage note at bottom
              ═══════════════════════════════════════════════════════════════ */}
          <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:14,marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:12,flexWrap:'wrap'}}>
              <div>
                <span style={{fontSize:9,fontWeight:800,color:MUTED,letterSpacing:'1px'}}>
                  ACTUALS AND MARKET EXPECTATIONS — {d.period}
                </span>
              </div>
              {/* Change 4: Analyst overrides behind button */}
              <button
                onClick={() => setShowOverrides(v => !v)}
                style={{
                  fontSize:9, padding:'3px 10px', borderRadius:5, cursor:'pointer',
                  backgroundColor: showOverrides ? YELLOW+'18' : 'transparent',
                  border: `1px solid ${showOverrides ? YELLOW+'50' : BORDER}`,
                  color: showOverrides ? YELLOW : MUTED, fontWeight:700,
                }}
              >
                {showOverrides ? '▲' : '▼'} Analyst override
              </button>
            </div>

            {/* Scorecard — cleaner table, badges, hide missing estimates */}
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${BORDER}`}}>
                    <th style={{padding:'4px 8px',fontSize:9,fontWeight:700,color:MUTED,textAlign:'left',letterSpacing:'0.5px',width:'28%'}}>METRIC</th>
                    <th style={{padding:'4px 8px',fontSize:9,fontWeight:700,color:MUTED,textAlign:'right',width:'20%'}}>ACTUAL</th>
                    {/* Only show ESTIMATE column when there's something to show */}
                    {hasEstimates && (
                      <th style={{padding:'4px 8px',fontSize:9,fontWeight:700,color:MUTED,textAlign:'right',width:'18%'}}>ESTIMATE</th>
                    )}
                    {hasEstimates && (
                      <th style={{padding:'4px 8px',fontSize:9,fontWeight:700,color:MUTED,textAlign:'right',width:'16%'}}>vs EST</th>
                    )}
                    <th style={{padding:'4px 8px',fontSize:9,fontWeight:700,color:MUTED,textAlign:'right',width:'18%'}}>vs PRIOR</th>
                  </tr>
                </thead>
                <tbody>

                  {/* Revenue row — actual from report, estimate from FMP/manual */}
                  {d.parseState !== 'failed' && d.revenue !== null && (
                    <tr style={{borderBottom:`1px solid ${BORDER}15`}}>
                      <td style={{padding:'8px 8px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:F.xs,fontWeight:600,color:MUTED}}>Revenue</span>
                          <span style={{fontSize:7,fontWeight:700,padding:'1px 5px',borderRadius:3,
                            backgroundColor: revEstNum ? GREEN+'18' : ACCENT+'14',
                            color: revEstNum ? GREEN : ACCENT, letterSpacing:'0.3px'}}>
                            {revEstNum ? `ACTUAL vs ${avData?.dataSource==='FMP'?'FMP':'CONSENSUS'}` : 'ACTUAL ONLY'}
                          </span>
                        </div>
                      </td>
                      <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.sm,fontWeight:900,color:TEXT}}>{n(d.revenue,d)}</td>
                      {hasEstimates && (
                        <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.xs,color:revEstNum?MUTED:'var(--mc-bg-3)'}}>
                          {revEstNum !== null ? (
                            <span title={avData?.dataSource === 'FMP' ? 'Source: Financial Modeling Prep' : 'Manual override'}>
                              {n(revEstNum, d)}
                              {avData?.dataSource === 'FMP' && <span style={{fontSize:7,color:'#60a5fa',marginLeft:3}}>FMP</span>}
                            </span>
                          ) : <span style={{color:'var(--mc-bg-3)'}}>—</span>}
                        </td>
                      )}
                      {hasEstimates && (
                        <td style={{padding:'8px 8px',textAlign:'right'}}>
                          {revEstNum && d.revenue ? (() => {
                            const bm = beatMissLabel(d.revenue, revEstNum);
                            const fmpS = fmpRevSurprise !== null
                              ? <span style={{fontSize:8,color:surpriseColor(fmpRevSurprise),marginLeft:4}}>({fmpRevSurprise>=0?'+':''}{fmpRevSurprise.toFixed(1)}% rev surprise)</span>
                              : null;
                            return bm ? <span style={{fontSize:F.xs,fontWeight:800,color:bm.col}}>{bm.text}{fmpS}</span> : null;
                          })() : <span style={{color:'var(--mc-bg-3)',fontSize:9}}>—</span>}
                        </td>
                      )}
                      <td style={{padding:'8px 8px',textAlign:'right'}}>
                        {(() => { const g=growth(d.revenue,d.revPrior); return g?<span style={{fontSize:F.xs,fontWeight:700,color:g.col}}>{g.text} YoY</span>:<span style={{color:MUTED,fontSize:F.xs}}>—</span>; })()}
                      </td>
                    </tr>
                  )}

                  {/* EPS row — actual from report + estimate from Alpha Vantage */}
                  {(d.eps !== null || latestEpsActual !== null) && (
                    <tr style={{borderBottom:`1px solid ${BORDER}15`}}>
                      <td style={{padding:'8px 8px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:F.xs,fontWeight:600,color:MUTED}}>EPS</span>
                          <span style={{fontSize:7,fontWeight:700,padding:'1px 5px',borderRadius:3,
                            backgroundColor: latestEpsEst !== null ? GREEN+'18' : ACCENT+'14',
                            color: latestEpsEst !== null ? GREEN : ACCENT, letterSpacing:'0.3px'}}>
                            {latestEpsEst !== null ? 'ACTUAL vs CONSENSUS' : 'ACTUAL ONLY'}
                          </span>
                        </div>
                      </td>
                      <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.sm,fontWeight:900,
                        color:latestEpsActual!==null?latestEpsActual>=0?GREEN:RED:d.eps!==null?d.eps>=0?GREEN:RED:MUTED}}>
                        {/* PATCH 0965 BUG #5 — EPS was hardcoded "$"; now uses currency-aware helper. */}
                        {(() => { const e=latestEpsActual??d.eps; return e!==null?formatCurrency(e, d.ticker, { decimals: 2 }):' —'; })()}
                      </td>
                      {hasEstimates && (
                        <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.xs,color:MUTED}}>
                          {/* PATCH 0965 BUG #5 — EPS estimate was hardcoded "$"; now currency-aware. */}
                          {latestEpsEst!==null?formatCurrency(latestEpsEst, d.ticker, { decimals: 2 }):
                           <span style={{color:'var(--mc-bg-3)'}}>—</span>}
                        </td>
                      )}
                      {hasEstimates && (
                        <td style={{padding:'8px 8px',textAlign:'right'}}>
                          {epsBM?<span style={{fontSize:F.xs,fontWeight:800,color:epsBM.col}}>{epsBM.text}</span>:<span style={{color:'var(--mc-bg-3)',fontSize:9}}>—</span>}
                        </td>
                      )}
                      <td style={{padding:'8px 8px',textAlign:'right'}}>
                        {latestQ?.surprisePct!=null?<span style={{fontSize:F.xs,fontWeight:700,color:surpriseColor(latestQ.surprisePct)}}>{latestQ.surprisePct>=0?'+':''}{latestQ.surprisePct.toFixed(1)}% surprise</span>:<span style={{color:MUTED,fontSize:F.xs}}>—</span>}
                      </td>
                    </tr>
                  )}

                  {/* Gross Margin — actual only (no consensus from AV) */}
                  {d.grossMargin !== null && d.parseState !== 'failed' && (
                    <tr style={{borderBottom:`1px solid ${BORDER}15`}}>
                      <td style={{padding:'8px 8px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:F.xs,fontWeight:600,color:MUTED}}>Gross Margin</span>
                          <span style={{fontSize:7,fontWeight:700,padding:'1px 5px',borderRadius:3,
                            backgroundColor: gmEstNum ? GREEN+'18' : ACCENT+'14',
                            color: gmEstNum ? GREEN : ACCENT, letterSpacing:'0.3px'}}>
                            {gmEstNum ? 'ACTUAL vs OVERRIDE' : 'ACTUAL ONLY'}
                          </span>
                        </div>
                      </td>
                      <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.sm,fontWeight:900,color:TEXT}}>
                        {d.grossMargin.toFixed(1)}%
                      </td>
                      {hasEstimates && (
                        <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.xs,color:MUTED}}>
                          {gmEstNum?`${gmEstNum.toFixed(1)}%`:<span style={{color:'var(--mc-bg-3)'}}>—</span>}
                        </td>
                      )}
                      {hasEstimates && (
                        <td style={{padding:'8px 8px',textAlign:'right'}}>
                          {gmEstNum&&d.grossMargin!==null?(() => { const delta=d.grossMargin-gmEstNum; const c=delta>=0?GREEN:RED; return <span style={{fontSize:F.xs,fontWeight:800,color:c}}>{delta>=0?'↑':'↓'} {Math.abs(delta).toFixed(1)}pp</span>; })():<span style={{color:'var(--mc-bg-3)',fontSize:9}}>—</span>}
                        </td>
                      )}
                      <td style={{padding:'8px 8px',textAlign:'right',fontSize:F.xs,color:MUTED}}>—</td>
                    </tr>
                  )}

                  {/* Guidance — company-issued */}
                  {manualGuidance && (
                    <tr>
                      <td style={{padding:'8px 8px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:F.xs,fontWeight:600,color:MUTED}}>Guidance</span>
                          <span style={{fontSize:7,fontWeight:700,padding:'1px 5px',borderRadius:3,backgroundColor:YELLOW+'14',color:YELLOW,letterSpacing:'0.3px'}}>COMPANY-ISSUED</span>
                        </div>
                      </td>
                      <td colSpan={4} style={{padding:'8px 8px',fontSize:F.xs,color:YELLOW,fontStyle:'italic'}}>{manualGuidance}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Change 5: Coverage note */}
            <div style={{marginTop:8,fontSize:8,color:'#334155',lineHeight:1.5}}>
              Consensus coverage varies by metric and source. EPS estimates from Alpha Vantage when ticker fetched.
              Revenue and margin estimates require analyst override below.
            </div>

            {/* Change 4: Override inputs behind toggle */}
            {showOverrides && (
              <div style={{marginTop:10,padding:'10px 12px',backgroundColor:'#0d1117',borderRadius:8,border:`1px solid ${YELLOW}25`,animation:'fadeIn 0.15s ease'}}>
                <div style={{fontSize:9,fontWeight:700,color:YELLOW,marginBottom:8}}>
                  ✏️ ANALYST OVERRIDE — Enter estimates from sell-side reports, StreetAccount, or consensus notes
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
                  <div>
                    <div style={{fontSize:8,color:MUTED,marginBottom:2}}>Revenue est ({d.scaleLabel})</div>
                    <input value={manualRevEst} onChange={e => setManualRevEst(e.target.value)}
                      placeholder={d.revenue ? (d.revenue * 0.95).toFixed(1) : 'e.g. 30.5'}
                      style={{width:96,backgroundColor:'#111',border:`1px solid ${BORDER}`,borderRadius:5,padding:'5px 8px',color:TEXT,fontSize:11,outline:'none'}}
                    />
                  </div>
                  <div>
                    <div style={{fontSize:8,color:MUTED,marginBottom:2}}>Gross margin est (%)</div>
                    <input value={manualGMEst} onChange={e => setManualGMEst(e.target.value)}
                      placeholder={d.grossMargin ? (d.grossMargin - 2).toFixed(0) : 'e.g. 45'}
                      style={{width:76,backgroundColor:'#111',border:`1px solid ${BORDER}`,borderRadius:5,padding:'5px 8px',color:TEXT,fontSize:11,outline:'none'}}
                    />
                  </div>
                  <div style={{flex:1,minWidth:180}}>
                    <div style={{fontSize:8,color:MUTED,marginBottom:2}}>Guidance commentary</div>
                    <input value={manualGuidance} onChange={e => setManualGuidance(e.target.value)}
                      placeholder="e.g. FY26 Rev +23% vs Est +21% — raised"
                      style={{width:'100%',backgroundColor:'#111',border:`1px solid ${BORDER}`,borderRadius:5,padding:'5px 8px',color:TEXT,fontSize:11,outline:'none'}}
                    />
                  </div>
                  {(manualRevEst || manualGMEst || manualGuidance) && (
                    <button onClick={() => { setManualRevEst(''); setManualGMEst(''); setManualGuidance(''); }}
                      style={{padding:'5px 10px',backgroundColor:'transparent',border:`1px solid ${BORDER}`,borderRadius:5,color:MUTED,fontSize:10,cursor:'pointer'}}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── EPS BEAT/MISS TRACK RECORD ── */}
          {avData && avData.quarterlyEarnings.length > 0 && (
            <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:12}}>
              <div style={{fontSize:9,fontWeight:700,color:MUTED,letterSpacing:'0.8px',marginBottom:8}}>
                📊 EPS {'&'} REVENUE BEAT/MISS HISTORY (last {avData.quarterlyEarnings.length} quarters · source: {avData.dataSource})
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {avData.quarterlyEarnings.map((eq,i) => {
                  const spct = eq.surprisePct;
                  const sCol = surpriseColor(spct);
                  const isBeat = spct !== null && spct >= 0;
                  return (
                    <div key={i} style={{
                      backgroundColor:'#0d1117',
                      border:`1px solid ${sCol}35`,
                      borderLeft:`3px solid ${sCol}`,
                      borderRadius:7, padding:'7px 10px', minWidth:86,
                    }}>
                      <div style={{fontSize:8,color:MUTED,marginBottom:3,letterSpacing:'0.3px'}}>{eq.fiscalDateEnding?.slice(0,7)}</div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:4}}>
                        <span style={{fontSize:13,fontWeight:900,color:sCol,lineHeight:1}}>
                          {/* PATCH 0965 BUG #5 — Beat/Miss history EPS hardcoded "$". */}
                          {eq.reportedEPS !== null ? formatCurrency(eq.reportedEPS, d.ticker, { decimals: 2 }) : '—'}
                        </span>
                        {spct !== null && (
                          <span style={{fontSize:9,fontWeight:800,color:sCol}}>
                            {isBeat?'+':''}{spct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div style={{fontSize:8,color:MUTED,marginTop:2}}>
                        {/* PATCH 0965 BUG #5 — Beat/Miss EPS estimate hardcoded "$". */}
                        EPS est {eq.estimatedEPS !== null ? formatCurrency(eq.estimatedEPS, d.ticker, { decimals: 2 }) : '—'}
                      </div>
                      {/* Revenue actual vs estimate — FMP provides this */}
                      {(eq.reportedRevenue !== null || eq.estimatedRevenue !== null) && (
                        <div style={{fontSize:7,color:MUTED,marginTop:1,borderTop:`1px solid ${BORDER}30`,paddingTop:2}}>
                          {/* PATCH 0965 BUG #5 — Revenue actual/est hardcoded "$"+"M".
                              For Indian tickers the FMP value is in millions of INR; convert
                              to absolute and let formatCurrency render Cr. */}
                          {(() => {
                            const tk = d.ticker || '';
                            const isIndian = /(\.NS|\.BO)$/i.test(tk);
                            const renderRev = (v: number | null) => {
                              if (v === null) return '?';
                              if (isIndian) return formatCurrency(v * 1e6, tk, { decimals: 0 });
                              return `$${v.toFixed(0)}M`;
                            };
                            return (
                              <span style={{color:eq.revSurprisePct!==null?surpriseColor(eq.revSurprisePct):MUTED}}>
                                Rev {renderRev(eq.reportedRevenue)}
                                {eq.estimatedRevenue!==null?` vs est ${renderRev(eq.estimatedRevenue)}`:''}
                                {eq.revSurprisePct!==null?` (${eq.revSurprisePct>=0?'+':''}${eq.revSurprisePct.toFixed(0)}%)` : ''}
                              </span>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:8,fontSize:9,color:MUTED,lineHeight:1.5}}>
                💡 Consistent beats drive re-rating. Institutional reaction = <em>surprise vs expectations</em>, not just absolute numbers.
              </div>
            </div>
          )}

          {!avData && (
            <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:10,fontSize:10,color:MUTED}}>
              Enter a stock ticker above to load EPS beat/miss history and consensus estimates from Alpha Vantage.
              Actuals come from the uploaded earnings document.
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            PARSE STATE BANNER — the most important signal before any scores
            Shows clearly whether the extraction can be trusted.
            ══════════════════════════════════════════════════════════════════════ */}
        {(() => {
          const ps = d.parseState;
          const pc = d.parseConfidence;
          const config = {
            verified: {
              color: GREEN, icon: '✅', title: 'EXTRACTION VERIFIED',
              msg: `Key metrics extracted successfully (confidence ${pc}%). Scores and ratios are calculated from validated numbers.`,
              bg: GREEN + '0e', border: GREEN + '40',
            },
            partial: {
              color: YELLOW, icon: '⚠️', title: 'PARTIAL EXTRACTION',
              msg: `Revenue found but ${d.hardFailures.length} metric(s) failed validation (confidence ${pc}%). Scores shown with reduced confidence. Verify marked fields manually.`,
              bg: YELLOW + '0a', border: YELLOW + '35',
            },
            failed: {
              color: RED, icon: '🚫', title: 'EXTRACTION FAILED',
              msg: `Revenue or core metrics could not be reliably extracted (confidence ${pc}%). SCORES ARE SUPPRESSED. Only text analysis (themes, management language) is shown below. Try Paste mode for better results.`,
              bg: RED + '0c', border: RED + '40',
            },
          }[ps];
          return (
            <div style={{backgroundColor:config.bg, border:`2px solid ${config.border}`, borderRadius:10, padding:'12px 16px', marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:18}}>{config.icon}</span>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                    <span style={{fontSize:11,fontWeight:800,color:config.color,letterSpacing:'0.8px'}}>{config.title}</span>
                    {/* Confidence bar */}
                    <div style={{flex:1,maxWidth:120,height:4,backgroundColor:'var(--mc-bg-3)',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${pc}%`,backgroundColor:config.color,borderRadius:2}}/>
                    </div>
                    <span style={{fontSize:9,color:config.color,fontWeight:700}}>{pc}% confidence</span>
                  </div>
                  <div style={{fontSize:10,color:config.color+'dd',lineHeight:1.5}}>{config.msg}</div>
                  {ps === 'failed' && d.hardFailures.length > 0 && (
                    <div style={{marginTop:6,fontSize:9,color:MUTED}}>
                      Failures: {d.hardFailures.slice(0,2).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── COMPANY HEADER (Three-engine scores + themes + warnings) ── */}
        <div style={{backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:14,padding:'18px 20px',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                <span style={{fontSize:11,color:MUTED}}>{d.period}</span>
                <span style={{fontSize:11,color:MUTED}}>·</span>
                <span style={{fontSize:11,color:MUTED}}>{d.filingType}</span>
                <span style={{fontSize:11,color:MUTED}}>·</span>
                <span style={{fontSize:11,color:MUTED}}>{d.scaleLabel}</span>
                <span style={{fontSize:11,color:MUTED}}>·</span>
                <span style={{fontSize:11,fontWeight:700,color:d.mgmtTone==='bullish'?GREEN:d.mgmtTone==='cautious'?ORANGE:MUTED}}>
                  Mgmt tone: {d.mgmtTone}
                </span>
                {d.continuingOpsDetected && <span style={{fontSize:10,fontWeight:700,color:YELLOW,backgroundColor:YELLOW+'14',padding:'2px 8px',borderRadius:4}}>⚠ Discontinued Ops</span>}
              </div>

              {/* Theme badges */}
              {/* Theme badges with confidence tiers */}
              {(nar as any).themeDetections?.length > 0 && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                  {((nar as any).themeDetections as ThemeDetection[]).map((td: ThemeDetection)=>(
                    <span key={td.theme.tag} style={{
                      fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,
                      backgroundColor:td.theme.color+'18',color:td.theme.color,
                      border:`1px solid ${td.theme.color}${td.tier==='core'?'60':td.tier==='adjacent'?'35':'20'}`,
                      opacity: td.tier==='weak'?0.5:1,
                    }} title={`${td.tier.toUpperCase()} — ${td.confidence}% confidence`}>
                      {td.theme.emoji} {td.theme.label}
                      <span style={{fontSize:8,marginLeft:4,opacity:0.7}}>{td.confidence}%</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Validation warnings — distinguish hard failures from soft warnings */}
              {d.validationWarnings.length > 0 && (
                <div>
                  {/* Hard failures (sanitization) */}
                  {d.validationWarnings.filter(w => !w.includes('inferred') && !w.includes('verify')).length > 0 && (
                    <div style={{backgroundColor:RED+'0c',border:`1px solid ${RED}30`,borderRadius:8,padding:'8px 12px',marginBottom:6}}>
                      <div style={{fontSize:10,fontWeight:700,color:RED,marginBottom:3}}>🚫 Extraction Failures — Affected Metrics Suppressed</div>
                      {d.validationWarnings.filter(w => !w.includes('inferred') && !w.includes('verify')).map((w,i)=>(
                        <div key={i} style={{fontSize:9,color:RED+'cc',marginTop:2}}>• {w}</div>
                      ))}
                    </div>
                  )}
                  {/* Soft warnings */}
                  {d.validationWarnings.filter(w => w.includes('inferred') || w.includes('verify')).length > 0 && (
                    <div style={{backgroundColor:YELLOW+'0a',border:`1px solid ${YELLOW}25`,borderRadius:8,padding:'7px 10px'}}>
                      <div style={{fontSize:9,fontWeight:700,color:YELLOW,marginBottom:2}}>⚠ Extraction Notes</div>
                      {d.validationWarnings.filter(w => w.includes('inferred') || w.includes('verify')).map((w,i)=>(
                        <div key={i} style={{fontSize:9,color:MUTED,marginTop:1}}>• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Three score wheels */}
            <div style={{display:'flex',gap:16,alignItems:'center',flexShrink:0,flexWrap:'wrap'}}>
              <ScoreWheel eng={q} />
              <ScoreWheel eng={r} />
              <ScoreWheel eng={nar} />
            </div>
          </div>

          {/* Summary verdicts */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:8,marginTop:12}}>
            {[q,r,nar].map(eng=>(
              <div key={eng.label} style={{padding:'8px 12px',backgroundColor:eng.color+'0c',border:`1px solid ${eng.color}25`,borderRadius:7,borderLeft:`3px solid ${eng.color}`}}>
                <div style={{fontSize:9,fontWeight:800,color:eng.color,marginBottom:3,letterSpacing:'0.5px'}}>{eng.label.toUpperCase()}</div>
                <div style={{fontSize:F.xs,color:TEXT,lineHeight:1.5}}>{eng.summary}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            INSTITUTIONAL EARNINGS OUTPUT
            Format: Actuals → Surprise → Guidance → JAT → Score
            US:  Consensus-driven, guidance-heavy, JAT = revision trajectory
            India: Trend-driven, execution-heavy, JAT = operational momentum
            ═══════════════════════════════════════════════════════════════ */}

        {/* ── SECTION 1: ACTUALS vs CONSENSUS ─────────────────────────────── */}
        {d.parseState !== 'failed' && (
          <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'18px 20px',marginBottom:10}}>
            <div style={{fontSize:9,fontWeight:800,color:MUTED,letterSpacing:'1.2px',marginBottom:12}}>
              ACTUALS vs CONSENSUS — {d.period}
            </div>

            {/* Column headers */}
            <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr 1fr 1fr',gap:4,marginBottom:6,paddingBottom:6,borderBottom:`1px solid ${BORDER}`}}>
              {['METRIC','ACTUAL','ESTIMATE','vs EST','vs PRIOR'].map(h=>(
                <div key={h} style={{fontSize:8,fontWeight:700,color:MUTED,letterSpacing:'0.8px',textAlign:h==='METRIC'?'left':'right'}}>{h}</div>
              ))}
            </div>

            {/* Revenue row */}
            <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr 1fr 1fr',gap:4,padding:'8px 0',borderBottom:`1px solid ${BORDER}20`}}>
              <div style={{fontSize:F.xs,color:MUTED}}>Revenue</div>
              <div style={{textAlign:'right',fontSize:F.sm,fontWeight:800,color:TEXT}}>{n(d.revenue,d)}</div>
              <div style={{textAlign:'right',fontSize:F.xs,color:revEstNum?TEXT:MUTED}}>{revEstNum?n(revEstNum,d):'—'}</div>
              <div style={{textAlign:'right'}}>
                {revEstNum&&d.revenue ? (() => {
                  const bm=beatMissLabel(d.revenue,revEstNum);
                  return bm ? <span style={{fontSize:F.xs,fontWeight:800,color:bm.col}}>{bm.text}</span> : null;
                })() : <span style={{fontSize:F.xs,color:MUTED}}>—</span>}
              </div>
              <div style={{textAlign:'right'}}>
                {(() => { const g=growth(d.revenue,d.revPrior); return g ? <span style={{fontSize:F.xs,fontWeight:700,color:g.col}}>{g.text} YoY</span> : <span style={{fontSize:F.xs,color:MUTED}}>—</span>; })()}
              </div>
            </div>

            {/* EPS row */}
            {(latestEpsActual !== null || d.eps !== null) && (
              <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr 1fr 1fr',gap:4,padding:'8px 0',borderBottom:`1px solid ${BORDER}20`}}>
                <div style={{fontSize:F.xs,color:MUTED}}>EPS</div>
                <div style={{textAlign:'right',fontSize:F.sm,fontWeight:800,color:(() => { const e=latestEpsActual??d.eps; return e!==null?e>=0?GREEN:RED:MUTED; })()}}>
                  {/* PATCH 0965 BUG #5 — EPS hardcoded "$" in legacy view; use currency-aware helper. */}
                  {(() => { const e=latestEpsActual??d.eps; return e!==null?formatCurrency(e, d.ticker, { decimals: 2 }):' —'; })()}
                </div>
                <div style={{textAlign:'right',fontSize:F.xs,color:MUTED}}>
                  {/* PATCH 0965 BUG #5 — EPS estimate hardcoded "$" in legacy view. */}
                  {latestEpsEst!==null?formatCurrency(latestEpsEst, d.ticker, { decimals: 2 }):' —'}
                </div>
                <div style={{textAlign:'right'}}>
                  {epsBM ? <span style={{fontSize:F.xs,fontWeight:800,color:epsBM.col}}>{epsBM.text}</span> : <span style={{fontSize:F.xs,color:MUTED}}>—</span>}
                </div>
                <div style={{textAlign:'right'}}>
                  {latestQ?.surprisePct!=null ? <span style={{fontSize:F.xs,fontWeight:700,color:surpriseColor(latestQ.surprisePct)}}>{latestQ.surprisePct>=0?'+':''}{latestQ.surprisePct.toFixed(1)}% surprise</span> : <span style={{fontSize:F.xs,color:MUTED}}>—</span>}
                </div>
              </div>
            )}

            {/* Gross Margin row */}
            {d.grossMargin !== null && (
              <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr 1fr 1fr',gap:4,padding:'8px 0',borderBottom:`1px solid ${BORDER}20`}}>
                <div style={{fontSize:F.xs,color:MUTED}}>Gross Margin</div>
                <div style={{textAlign:'right',fontSize:F.sm,fontWeight:800,color:TEXT}}>{d.grossMargin.toFixed(1)}%</div>
                <div style={{textAlign:'right',fontSize:F.xs,color:MUTED}}>{gmEstNum?`${gmEstNum.toFixed(1)}%`:'—'}</div>
                <div style={{textAlign:'right'}}>
                  {gmEstNum&&d.grossMargin!==null ? (() => { const delta=d.grossMargin-gmEstNum; return <span style={{fontSize:F.xs,fontWeight:800,color:delta>=0?GREEN:RED}}>{delta>=0?'↑':'↓'} {Math.abs(delta).toFixed(1)}pp</span>; })() : <span style={{fontSize:F.xs,color:MUTED}}>—</span>}
                </div>
                <div style={{textAlign:'right',fontSize:F.xs,color:MUTED}}>—</div>
              </div>
            )}

            {/* EBITDA Margin row */}
            {d.ebitdaMargin !== null && (
              <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr 1fr 1fr',gap:4,padding:'8px 0'}}>
                <div style={{fontSize:F.xs,color:MUTED}}>EBITDA Margin</div>
                <div style={{textAlign:'right',fontSize:F.sm,fontWeight:800,color:TEXT}}>{d.ebitdaMargin.toFixed(1)}%</div>
                <div style={{textAlign:'right',fontSize:F.xs,color:MUTED}}>—</div>
                <div style={{textAlign:'right',fontSize:F.xs,color:MUTED}}>—</div>
                <div style={{textAlign:'right',fontSize:F.xs,color:MUTED}}>—</div>
              </div>
            )}

            {/* Estimate inputs — inline, compact */}
            <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${BORDER}`,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:8,color:MUTED}}>Analyst est. override:</span>
              <input value={manualRevEst} onChange={e=>setManualRevEst(e.target.value)} placeholder={`Rev (${d.scaleLabel})`}
                style={{width:80,backgroundColor:'#0d1117',border:`1px solid ${BORDER}`,borderRadius:4,padding:'3px 6px',color:TEXT,fontSize:10,outline:'none'}}/>
              <input value={manualGMEst} onChange={e=>setManualGMEst(e.target.value)} placeholder="GM %"
                style={{width:56,backgroundColor:'#0d1117',border:`1px solid ${BORDER}`,borderRadius:4,padding:'3px 6px',color:TEXT,fontSize:10,outline:'none'}}/>
              <input value={manualGuidance} onChange={e=>setManualGuidance(e.target.value)} placeholder="Guidance commentary..."
                style={{flex:1,minWidth:160,backgroundColor:'#0d1117',border:`1px solid ${BORDER}`,borderRadius:4,padding:'3px 6px',color:TEXT,fontSize:10,outline:'none'}}/>
              {!avData && <button onClick={()=>fetchAVData(avTicker||d.ticker)} disabled={avLoading}
                style={{padding:'3px 10px',backgroundColor:ACCENT,border:'none',borderRadius:4,color:'#000',fontWeight:700,fontSize:9,cursor:'pointer',opacity:avLoading?0.6:1}}>
                {avLoading?'⏳':'📡 Fetch FMP'}
              </button>}
            </div>
          </div>
        )}

        {/* ── SECTION 2: SURPRISE ──────────────────────────────────────────── */}
        {d.parseState !== 'failed' && (latestQ?.surprisePct !== null || revEstNum !== null) && (() => {
          const epsSurp = latestQ?.surprisePct ?? null;
          const revSurp = revEstNum && d.revenue ? ((d.revenue - revEstNum) / Math.abs(revEstNum)) * 100 : null;
          const gmSurp = gmEstNum && d.grossMargin ? d.grossMargin - gmEstNum : null;

          // Surprise level classification
          const avgSurp = [epsSurp, revSurp].filter(v=>v!==null) as number[];
          const avgAbs = avgSurp.length > 0 ? avgSurp.reduce((s,v)=>s+Math.abs(v),0)/avgSurp.length : 0;
          const surpLevel = avgAbs >= 20 ? 'Exceptional' : avgAbs >= 10 ? 'Very Strong' : avgAbs >= 5 ? 'Strong' : avgAbs >= 2 ? 'Mild' : 'Inline';
          const surpColor = avgSurp.every(v=>v>=0) ? (avgAbs >= 10 ? GREEN : '#10b98199') : avgSurp.every(v=>v<0) ? RED : YELLOW;

          return (
            <div style={{backgroundColor:surpColor+'0c',border:`1px solid ${surpColor}30`,borderRadius:12,padding:'14px 20px',marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:800,color:MUTED,letterSpacing:'1.2px',marginBottom:10}}>SURPRISE</div>
              <div style={{display:'flex',gap:20,flexWrap:'wrap',alignItems:'flex-end'}}>
                {revSurp !== null && (
                  <div>
                    <div style={{fontSize:9,color:MUTED,marginBottom:2}}>Revenue Surprise</div>
                    <div style={{fontSize:18,fontWeight:900,color:revSurp>=0?GREEN:RED}}>{revSurp>=0?'+':''}{revSurp.toFixed(1)}%</div>
                  </div>
                )}
                {epsSurp !== null && (
                  <div>
                    <div style={{fontSize:9,color:MUTED,marginBottom:2}}>EPS Surprise</div>
                    <div style={{fontSize:18,fontWeight:900,color:epsSurp>=0?GREEN:RED}}>{epsSurp>=0?'+':''}{epsSurp.toFixed(1)}%</div>
                  </div>
                )}
                {gmSurp !== null && (
                  <div>
                    <div style={{fontSize:9,color:MUTED,marginBottom:2}}>Gross Margin Surprise</div>
                    <div style={{fontSize:18,fontWeight:900,color:gmSurp>=0?GREEN:RED}}>{gmSurp>=0?'+':''}{gmSurp.toFixed(1)} bps</div>
                  </div>
                )}
                <div style={{marginLeft:'auto',textAlign:'right'}}>
                  <div style={{fontSize:9,color:MUTED,marginBottom:2}}>Surprise Level</div>
                  <div style={{fontSize:F.lg,fontWeight:900,color:surpColor}}>{surpLevel}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── SECTION 3: GUIDANCE ──────────────────────────────────────────── */}
        {(d.guidance.length > 0 || manualGuidance || avData?.epsEstCurrentYear != null) && (
          <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'14px 20px',marginBottom:10}}>
            <div style={{fontSize:9,fontWeight:800,color:MUTED,letterSpacing:'1.2px',marginBottom:10}}>GUIDANCE</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>

              {/* User-provided guidance commentary */}
              {manualGuidance && (
                <div style={{display:'flex',gap:10,alignItems:'flex-start',padding:'6px 0',borderBottom:`1px solid ${BORDER}20`}}>
                  <span style={{fontSize:F.sm,fontWeight:700,color:YELLOW,minWidth:120}}>Mgmt Commentary</span>
                  <span style={{fontSize:F.xs,color:TEXT,flex:1}}>{manualGuidance}</span>
                </div>
              )}

              {/* EPS forward estimate from FMP */}
              {avData?.epsEstCurrentYear != null && (
                <div style={{display:'flex',gap:10,alignItems:'baseline',padding:'4px 0'}}>
                  <span style={{fontSize:F.xs,color:MUTED,minWidth:120}}>EPS (Current FY)</span>
                  <span style={{fontSize:F.sm,fontWeight:700,color:TEXT}}>
                    {/* PATCH 0965 BUG #5 — Forward-EPS hardcoded "$". */}
                    {formatCurrency(avData?.epsEstCurrentYear ?? 0, avData?.symbol || d.ticker, { decimals: 2 })} est
                    {avData?.numAnalysts ? <span style={{fontSize:9,color:MUTED,marginLeft:6}}>({avData.numAnalysts} analysts)</span> : null}
                  </span>
                  {avData?.analystTargetPrice && (
                    /* PATCH 0965 BUG #5 — Price Target hardcoded "$". */
                    <span style={{fontSize:F.xs,color:YELLOW,marginLeft:10}}>Price Target: {formatCurrency(avData.analystTargetPrice, avData?.symbol || d.ticker, { decimals: 2 })}</span>
                  )}
                </div>
              )}

              {/* Revenue forward estimate from FMP */}
              {avData?.revenueEstNextQ != null && (
                <div style={{display:'flex',gap:10,alignItems:'baseline',padding:'4px 0'}}>
                  <span style={{fontSize:F.xs,color:MUTED,minWidth:120}}>Revenue (Next Q)</span>
                  {/* PATCH 0965 BUG #5 — Revenue Next Q hardcoded "$"+"M"; for Indian tickers
                      show as "₹X Cr" using formatCurrency (raw value is in absolute units). */}
                  <span style={{fontSize:F.sm,fontWeight:700,color:TEXT}}>
                    {(() => {
                      const v = avData?.revenueEstNextQ ?? 0;
                      const tk = avData?.symbol || d.ticker || '';
                      const isIndian = /(\.NS|\.BO)$/i.test(tk);
                      if (isIndian) return formatCurrency(v * 1e6, tk, { decimals: 0 }) + ' est';
                      return `$${v.toFixed(0)}M est`;
                    })()}
                  </span>
                  {d.revenue && (avData?.revenueEstNextQ ?? 0) > 0 && (
                    <span style={{fontSize:F.xs,color:MUTED,marginLeft:8}}>
                      implying {(((avData?.revenueEstNextQ ?? 0) / d.revenue - 1) * 100).toFixed(1)}% QoQ
                    </span>
                  )}
                </div>
              )}

              {/* Management guidance extracted from PDF */}
              {d.guidance.slice(0,3).map((g,i)=>(
                <div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'4px 0',borderTop:i>0?`1px solid ${BORDER}10`:'none'}}>
                  <span style={{fontSize:9,color:'#334155',flexShrink:0,marginTop:1}}>›</span>
                  <span style={{fontSize:F.xs,color:MUTED,lineHeight:1.6,fontStyle:'italic'}}>"{g}"</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SECTION 4: JAT — JUST AHEAD TRAJECTORY ───────────────────────── */}
        {d.parseState !== 'failed' && (() => {
          // Compute JAT signals from parsed data
          const revGrowth = d.revenue && d.revPrior && d.revPrior > 0
            ? ((d.revenue - d.revPrior) / d.revPrior) * 100 : null;
          const gmTrend = d.grossMargin !== null
            ? d.grossMargin >= 40 ? 'Positive' : d.grossMargin >= 25 ? 'Neutral' : 'Negative'
            : null;
          const revTraj = revGrowth !== null
            ? revGrowth >= 25 ? 'Accelerating' : revGrowth >= 10 ? 'Stable' : revGrowth >= 0 ? 'Slowing' : 'Decelerating'
            : null;
          const epsTraj = latestQ?.surprisePct !== null && latestQ?.surprisePct !== undefined
            ? latestQ.surprisePct >= 10 ? 'Upward revision path' : latestQ.surprisePct >= 0 ? 'Flat' : 'Downward pressure'
            : null;
          const themes = (nar as any).themeDetections?.filter((t:any)=>t.tier==='core') ?? [];
          const trendCol = (s:string) => /Accelerating|Positive|Upward|Strong|Increasing/.test(s) ? GREEN : /Decelerating|Negative|Downward|Weak/.test(s) ? RED : YELLOW;

          const rows = [
            { label:'Revenue',      value: revTraj ?? '—', icon: revGrowth!==null ? (revGrowth>=10?'↑':revGrowth>=0?'→':'↓') : '·' },
            { label:'Margins',      value: gmTrend ?? '—', icon: gmTrend==='Positive'?'↑':gmTrend==='Negative'?'↓':'→' },
            { label:'EPS',          value: epsTraj ?? '—', icon: epsTraj?.startsWith('Upward')?'↑':epsTraj?.startsWith('Downward')?'↓':'→' },
            { label:'Theme Exposure',value: themes.length>=2?'Increasing':themes.length===1?'Stable':'Declining', icon: themes.length>=2?'↑':themes.length===1?'→':'↓' },
          ].filter(r=>r.value!=='—');

          if (rows.length === 0) return null;

          return (
            <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:12,padding:'14px 20px',marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:800,color:MUTED,letterSpacing:'1.2px',marginBottom:10}}>
                JAT — JUST AHEAD TRAJECTORY
                <span style={{fontSize:8,fontWeight:400,marginLeft:8,color:'#334155'}}>
                  {d.currency==='USD' ? '(guidance + revision trajectory)' : '(execution + operational momentum)'}
                </span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8}}>
                {rows.map(({label,value,icon})=>(
                  <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 10px',backgroundColor:'#0d1117',borderRadius:7,border:`1px solid ${BORDER}`}}>
                    <span style={{fontSize:F.xs,color:MUTED}}>{label}</span>
                    <span style={{fontSize:F.xs,fontWeight:800,color:trendCol(value)}}>
                      {icon} {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── SECTION 5: FINAL SCORE ───────────────────────────────────────── */}
        {d.parseState !== 'failed' && (
          <div style={{backgroundColor:'#0a0a12',border:`1px solid ${r.color}30`,borderRadius:12,padding:'16px 20px',marginBottom:14}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
              {/* Overall score */}
              <div style={{textAlign:'center',flexShrink:0}}>
                <div style={{fontSize:40,fontWeight:900,color:r.color,lineHeight:1}}>{r.score}</div>
                <div style={{width:64,height:4,backgroundColor:'var(--mc-bg-3)',borderRadius:2,margin:'6px 0 2px',overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${r.score}%`,backgroundColor:r.color,borderRadius:2}}/>
                </div>
                <div style={{fontSize:8,color:MUTED,letterSpacing:'0.5px'}}>REACTION SCORE</div>
              </div>

              {/* Score breakdown */}
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:9,fontWeight:800,color:MUTED,marginBottom:8,letterSpacing:'0.8px'}}>
                  SCORE BREAKDOWN {d.currency==='USD'?'(US WEIGHTS)':'(INDIA WEIGHTS)'}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {(d.currency==='USD' ? [
                    {label:'Guidance + JAT',  weight:40, eng:r},
                    {label:'Margins',          weight:25, eng:q},
                    {label:'Revenue Surprise', weight:20, eng:r},
                    {label:'Narrative/Themes', weight:10, eng:nar},
                    {label:'Accounting Quality',weight:5, eng:q},
                  ] : [
                    {label:'Margin Trend',     weight:35, eng:q},
                    {label:'Revenue Growth',   weight:25, eng:r},
                    {label:'Execution/Orders', weight:20, eng:r},
                    {label:'Guidance/Commentary',weight:15, eng:r},
                    {label:'Narrative Theme',  weight:5, eng:nar},
                  ]).map(({label,weight,eng})=>(
                    <div key={label} style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:8,color:MUTED,width:140,flexShrink:0}}>{label}</span>
                      <span style={{fontSize:8,color:'#334155',width:28,flexShrink:0}}>{weight}%</span>
                      <div style={{flex:1,height:4,backgroundColor:'var(--mc-bg-3)',borderRadius:2,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.min(100,eng.score)}%`,backgroundColor:eng.color,borderRadius:2,opacity:0.7}}/>
                      </div>
                      <span style={{fontSize:8,fontWeight:700,color:eng.color,width:24,textAlign:'right'}}>{eng.grade}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Verdict */}
              <div style={{flex:1,minWidth:180}}>
                <div style={{padding:'10px 14px',backgroundColor:r.color+'10',border:`1px solid ${r.color}30`,borderRadius:8,marginBottom:8}}>
                  <div style={{fontSize:9,fontWeight:800,color:r.color,marginBottom:3}}>VERDICT</div>
                  <div style={{fontSize:F.xs,color:TEXT,lineHeight:1.6}}>{r.summary}</div>
                </div>
                {/* Narrative themes compact */}
                {(nar as any).themeDetections?.length > 0 && (
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {((nar as any).themeDetections as any[]).filter((t:any)=>t.tier==='core').slice(0,4).map((td:any)=>(
                      <span key={td.theme.tag} style={{fontSize:8,fontWeight:700,padding:'2px 7px',borderRadius:4,backgroundColor:td.theme.color+'14',color:td.theme.color}}>
                        {td.theme.emoji} {td.theme.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIONS ── */}
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button onClick={()=>{
            const sym = d.currency==='USD'?'$':'₹';
            const txt=[
              `${d.company} | ${d.period} | ${d.filingType}`,
              `Reaction Score: ${r.score} | Accounting: ${q.score} | Narrative: ${nar.score}`,
              '',
              'ACTUALS vs CONSENSUS:',
              `  Revenue: ${n(d.revenue,d)}${revEstNum?` vs Est ${n(revEstNum,d)}`:''} | YoY: ${growth(d.revenue,d.revPrior)?.text??'—'}`,
              `  Gross Margin: ${pct(d.grossMargin)}${gmEstNum?` vs Est ${gmEstNum.toFixed(1)}%`:''}`,
              `  EPS: ${d.eps!==null?`${sym}${d.eps.toFixed(2)}`:'—'}${latestEpsEst!==null?` vs Est ${sym}${latestEpsEst.toFixed(2)}`:''}`,
              manualGuidance ? `Guidance: ${manualGuidance}` : '',
              '',
              'THEMES: '+(((nar as any).themeDetections??[]) as any[]).filter((t:any)=>t.tier==='core').map((t:any)=>t.theme.label).join(', '),
            ].filter(Boolean).join('\n');
            navigator.clipboard.writeText(txt).catch(()=>{});
          }} style={{padding:'9px 18px',backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:8,color:TEXT,fontSize:F.sm,cursor:'pointer'}}>
            📋 Copy Summary
          </button>
          <button onClick={reset} style={{padding:'9px 18px',backgroundColor:'transparent',border:`1px solid ${BORDER}`,borderRadius:8,color:MUTED,fontSize:F.sm,cursor:'pointer'}}>
            🔄 Analyze Another
          </button>
          {snapshot && (
            <button onClick={() => setReportView('institutional')} style={{padding:'9px 18px',backgroundColor:'transparent',border:`1px solid ${ACCENT}`,borderRadius:8,color:ACCENT,fontSize:F.sm,cursor:'pointer'}}>
              ← Back to institutional view
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── INPUT PAGE ──────────────────────────────────────────────────────────────
  return (
    <div style={{background:BG,minHeight:'100vh',color:TEXT,fontFamily:'system-ui,-apple-system,sans-serif',padding:'24px 20px',maxWidth:1140,margin:'0 auto'}}>

      {/* Header */}
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:24,fontWeight:900,color:ACCENT,margin:'0 0 4px'}}>📊 Earnings Intelligence</h1>
        <p style={{fontSize:F.xs,color:MUTED,margin:0}}>
          Enter a ticker for instant analysis from FMP structured data · or upload a PDF for manual filings
        </p>
      </div>

      {/* PATCH 0680 — Bridge to Auto-Valuation. User wanted both analyses
          merged into one page; full inline merge needs sizeable refactor of
          buildReport into a shared lib. For now, prominent cross-link so the
          user knows the next tab over runs the same documents through the
          P/E + P/S + EV/EBITDA pipeline. */}
      {/* PATCH 0719 — Replace hardcoded dark-only gradient with the
          CARD2 token + cyan accent border so the bridge card stays legible
          when the global light-mode filter inverts it (the literal #0d2030
          → near-white #f2dfcf was washing the chip out below 60% opacity). */}
      <a href="/auto-valuation" style={{
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:14,
        marginBottom:20, padding:'14px 18px',
        background: CARD2,
        border:'1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', borderRadius:10,
        textDecoration:'none', cursor:'pointer',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{fontSize:28}}>🤖</div>
          <div>
            <div style={{fontSize:F.md,fontWeight:800,color:'var(--mc-cyan)',marginBottom:2}}>
              Need a full valuation report on these documents?
            </div>
            <div style={{fontSize:F.xs,color:MUTED,lineHeight:1.55}}>
              Auto-Valuation runs the SAME PDFs + your Excel through P/E + P/S + EV/EBITDA calculators automatically.
              Single upload, three calculators, BUY / WATCH / WAIT / AVOID call with confidence chips and override panel.
            </div>
          </div>
        </div>
        <div style={{
          fontSize:F.sm, fontWeight:800, color:'#0a0a0f', background:'var(--mc-cyan)',
          padding:'8px 16px', borderRadius:6, whiteSpace:'nowrap', letterSpacing:'0.3px',
        }}>
          OPEN AUTO-VAL →
        </div>
      </a>

      {/* Mode tabs — Ticker is default and PRIMARY */}
      <div style={{display:'flex',borderBottom:`1px solid ${BORDER}`,marginBottom:20}}>
        {([
          {id:'ticker', icon:'🔍', label:'Ticker Lookup', sub:'FMP · SEC · NSE · BSE'},
          {id:'upload', icon:'📁', label:'Upload File',   sub:'PDF, Excel, CSV'},
          {id:'paste',  icon:'📋', label:'Paste Text',    sub:'Copy from document'},
          {id:'url',    icon:'🔗', label:'URL',           sub:'SEC EDGAR filing'},
        ] as const).map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{
            padding:'10px 18px',border:'none',cursor:'pointer',background:'transparent',
            color:mode===m.id?ACCENT:MUTED,fontWeight:mode===m.id?700:400,fontSize:F.sm,
            borderBottom:mode===m.id?`2px solid ${ACCENT}`:'2px solid transparent',
            marginBottom:-1,transition:'all 0.15s',flexShrink:0,
          }}>
            {m.icon} {m.label}
            <div style={{fontSize:8,color:mode===m.id?ACCENT+'99':'#334155',fontWeight:400}}>{m.sub}</div>
          </button>
        ))}
      </div>

      {loading ? <LoadingUI /> : (
        <>
          {/* ── TICKER MODE — PRIMARY ─────────────────────────────────────── */}
          {mode === 'ticker' && (
            <div>
              <div style={{marginBottom:12,fontSize:F.sm,color:MUTED,lineHeight:1.7}}>
                Enter any stock ticker. The system fetches structured financials from FMP automatically —
                no PDF needed. Use exchange suffix for Indian stocks: <code style={{color:ACCENT}}>AEROFLEX.NS</code> or <code style={{color:ACCENT}}>AEROFLEX.BO</code>
              </div>
              <div style={{display:'flex',gap:10,alignItems:'stretch',flexWrap:'wrap',marginBottom:16}}>
                <input
                  value={tickerInput}
                  onChange={e => setTickerInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && fetchFromTicker(tickerInput)}
                  placeholder="e.g. FSLY · OSS · AEROFLEX.NS · BAJAJCON · TSLA"
                  autoFocus
                  style={{
                    flex:1, minWidth:240, backgroundColor:CARD, border:`2px solid ${ACCENT}40`,
                    borderRadius:10, padding:'12px 16px', color:TEXT, fontSize:F.md,
                    outline:'none', letterSpacing:'0.5px', fontWeight:600,
                  }}
                />
                <button
                  onClick={() => fetchFromTicker(tickerInput)}
                  disabled={!tickerInput.trim()}
                  style={{
                    padding:'12px 28px', backgroundColor:ACCENT, border:'none', borderRadius:10,
                    color:'#000', fontWeight:800, fontSize:F.md, cursor:'pointer',
                    opacity:!tickerInput.trim()?0.5:1, letterSpacing:'0.5px',
                  }}
                >
                  🔍 Analyze
                </button>
              </div>

              {/* Quick examples */}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}>
                <span style={{fontSize:9,color:MUTED}}>Quick examples:</span>
                {[
                  {sym:'FSLY', label:'Fastly (US CDN)'},
                  {sym:'OSS', label:'One Stop Systems (Defense AI)'},
                  {sym:'NVDA', label:'Nvidia'},
                  {sym:'TSLA', label:'Tesla'},
                  {sym:'AEROFLEX.NS', label:'Aeroflex (India)'},
                  {sym:'BAJAJCON.NS', label:'Bajaj Consumer (India)'},
                  {sym:'TCS.NS', label:'TCS (India IT)'},
                ].map(({sym, label}) => (
                  <button key={sym} onClick={() => { setTickerInput(sym); setTimeout(() => fetchFromTicker(sym), 50); }}
                    style={{
                      fontSize:9, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer',
                      backgroundColor:CARD2, border:`1px solid ${BORDER}`, color:MUTED,
                    }}
                    title={label}
                  >
                    {sym}
                  </button>
                ))}
              </div>

              <div style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:10,padding:'12px 16px',fontSize:F.xs,color:MUTED,lineHeight:1.8}}>
                <div style={{fontWeight:700,color:TEXT,marginBottom:4}}>What gets fetched:</div>
                <div>📊 <strong>Income statement</strong> — Revenue, Gross Profit, EBIT, EBITDA, PAT, EPS (current + prior quarters)</div>
                <div>🏛️ <strong>Balance sheet</strong> — Cash, Debt, Equity, Total Assets</div>
                <div>💰 <strong>Cash flow</strong> — CFO, Capex, FCF</div>
                <div>🎯 <strong>Earnings surprises</strong> — EPS actual vs estimate, Revenue actual vs estimate (last 8 quarters)</div>
                <div>📈 <strong>Forward estimates</strong> — Revenue, EPS, analyst count from FMP consensus</div>
                <div>🌐 <strong>Company profile</strong> — Name, sector, industry, employees</div>
              </div>
            </div>
          )}

          {mode === 'upload' && (
            <div style={{border:`2px dashed ${BORDER}`,borderRadius:14,padding:'44px 24px',textAlign:'center',cursor:'pointer',backgroundColor:CARD,transition:'border-color 0.2s'}}
              onClick={()=>fileRef.current?.click()}
              onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files);}}
              onDragOver={e=>e.preventDefault()}
            >
              <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" style={{display:'none'}} onChange={e=>handleFile(e.target.files)}/>
              <div style={{fontSize:44,marginBottom:14}}>📂</div>
              <div style={{fontSize:F.lg,fontWeight:700,color:TEXT,marginBottom:6}}>Drop file here or click to browse</div>
              <div style={{fontSize:F.sm,color:MUTED,marginBottom:16}}>PDF (10-K/10-Q/Annual Report), Excel, CSV, TXT</div>
              <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
                {['.PDF','.XLSX','.XLS','.CSV','.TXT'].map(e=>(
                  <span key={e} style={{fontSize:10,fontWeight:700,color:ACCENT,backgroundColor:ACCENT+'14',border:`1px solid ${ACCENT}30`,padding:'3px 10px',borderRadius:4}}>{e}</span>
                ))}
              </div>
            </div>
          )}

          {mode === 'paste' && (
            <div>
              <div style={{fontSize:F.sm,color:MUTED,marginBottom:8}}>
                Open PDF → <kbd style={{background:'var(--mc-bg-3)',padding:'1px 5px',borderRadius:3,fontSize:10}}>Ctrl+A</kbd> → <kbd style={{background:'var(--mc-bg-3)',padding:'1px 5px',borderRadius:3,fontSize:10}}>Ctrl+C</kbd> → paste:
              </div>
              <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} rows={14}
                placeholder={`Paste any earnings document text here.\n\nExample (SEC 10-K):\nRevenue: Product $30,498,162 $20,867,800\n32,215,500 24,558,809\nGross profit 15,982,483 622,924\nNet income 5,087,694 (13,634,333)\n\nExample (Indian ₹ Cr):\nRevenue from Operations 2,345 1,983\nEBITDA 668 534\nPAT 345 267`}
                style={{width:'100%',backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:'14px',color:TEXT,fontSize:12,resize:'vertical',boxSizing:'border-box',lineHeight:1.7,fontFamily:'monospace'}}
              />
              <div style={{display:'flex',gap:10,marginTop:12}}>
                <button onClick={()=>{setLoading(true);process(pasteText);}} disabled={!pasteText.trim()}
                  style={{padding:'10px 24px',backgroundColor:ACCENT,border:'none',borderRadius:8,color:'#000',fontWeight:800,fontSize:F.md,cursor:'pointer',opacity:!pasteText.trim()?0.5:1}}>
                  🔍 Analyze
                </button>
                {pasteText && <button onClick={()=>setPasteText('')} style={{padding:'10px 14px',backgroundColor:'transparent',border:`1px solid ${BORDER}`,borderRadius:8,color:MUTED,fontSize:F.sm,cursor:'pointer'}}>Clear</button>}
              </div>
            </div>
          )}

          {mode === 'url' && (
            <div>
              <div style={{fontSize:F.sm,color:MUTED,marginBottom:8}}>Direct link to an earnings filing (SEC EDGAR, NSE/BSE PDF):</div>
              <div style={{display:'flex',gap:10}}>
                <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleURL()}
                  placeholder="https://www.sec.gov/Archives/..."
                  style={{flex:1,backgroundColor:CARD,border:`1px solid ${BORDER}`,borderRadius:8,padding:'10px 14px',color:TEXT,fontSize:F.sm,outline:'none'}}
                />
                <button onClick={handleURL} disabled={!urlInput.trim()}
                  style={{padding:'10px 20px',backgroundColor:ACCENT,border:'none',borderRadius:8,color:'#000',fontWeight:700,fontSize:F.sm,cursor:'pointer',whiteSpace:'nowrap',opacity:!urlInput.trim()?0.5:1}}>
                  🔍 Fetch
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{backgroundColor:RED+'14',border:`1px solid ${RED}40`,borderRadius:8,padding:'10px 14px',marginTop:14,color:RED,fontSize:F.sm}}>
              ⚠ {error}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div style={{marginTop:28}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:F.sm,fontWeight:700,color:MUTED}}>📚 RECENT ANALYSES</div>
                <button onClick={()=>{setHistory([]);saveHist2([]);}} style={{fontSize:10,color:MUTED,background:'none',border:'none',cursor:'pointer'}}>Clear</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10}}>
                {history.slice(0,9).map(h=>(
                  <div key={h.id} style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderLeft:`3px solid ${h.color}`,borderRadius:10,padding:'12px 14px'}}>
                    <div style={{fontSize:F.sm,fontWeight:700,color:TEXT,marginBottom:3}}>{h.company}</div>
                    <div style={{display:'flex',gap:6,marginBottom:4,flexWrap:'wrap'}}>
                      <span style={{fontSize:10,color:ACCENT}}>{h.period}</span>
                      <span style={{fontSize:9,color:MUTED}}>Q:{h.q}</span>
                      <span style={{fontSize:9,color:h.color}}>R:{h.r}</span>
                      <span style={{fontSize:9,color:PURPLE}}>N:{h.n}</span>
                    </div>
                    <div style={{fontSize:10,color:MUTED,lineHeight:1.5}}>{h.summary.slice(0,60)}…</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {history.length === 0 && (
            <div style={{marginTop:28,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
              {[
                {icon:'📄',title:'SEC 10-K / 10-Q',desc:'Upload PDF directly from SEC EDGAR. Company, period, and all financials extracted automatically.'},
                {icon:'📊',title:'NSE/BSE Results', desc:'Quarterly results PDF or Excel. ₹ Cr format detected automatically with full P&L.'},
                {icon:'📋',title:'Paste from PDF',  desc:'Open PDF → Ctrl+A → Ctrl+C → Paste mode. Works for any earnings document worldwide.'},
                {icon:'🎯',title:'3 Separate Scores',desc:'Quality (long-term), Reaction (event-driven), Narrative (thematic). Each scored independently.'},
              ].map(({icon,title,desc})=>(
                <div key={title} style={{backgroundColor:CARD2,border:`1px solid ${BORDER}`,borderRadius:10,padding:16}}>
                  <div style={{fontSize:28,marginBottom:8}}>{icon}</div>
                  <div style={{fontSize:F.sm,fontWeight:700,color:TEXT,marginBottom:4}}>{title}</div>
                  <div style={{fontSize:10,color:MUTED,lineHeight:1.6}}>{desc}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* PATCH 0681 — Inline Auto-Valuation panel: drop same docs to also
          get a P/E + P/S + EV/EBITDA report on the same page. */}
      <InlineValuationPanel onReport={setValReport} />
    </div>
  );
}
