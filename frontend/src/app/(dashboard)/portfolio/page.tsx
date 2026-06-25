'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, Download, Upload, ArrowUpDown, Edit3, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { normalizeTicker } from '@/lib/tickers';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
// PATCH 0300 — Shared freshness chip for the quote refresh state.
import { PanelFreshness } from '@/components/PanelFreshness';
import FundamentalsAnalyzerPage from '../fundamentals/page';
import TickerExportToolbar from '@/components/TickerExportToolbar';

/* ── Types ──────────────────────────────────────────────────────────── */

interface StockQuote {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  price: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  indexGroup?: string;   // PATCH 1100 — cap bucket (Large/Mid/Small/Micro) from quotes universe
  marketCap?: number;    // PATCH 1100 — est. market cap (₹, may be 0 on weekends)
}

interface PortfolioHolding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

interface Signal {
  symbol: string;
  weightedScore: number;
  action: string; // BUY | ADD | HOLD | TRIM | EXIT | AVOID
  sectorTrend: string; // Bullish | Neutral | Bearish
}

interface PortfolioRow {
  symbol: string;
  company: string;
  sector: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  cmp: number;
  change: number;
  changePercent: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  dayPnl: number;
  notes?: string;
  score?: number;
  sectorTrend?: string;
  decision?: string;
  cap?: string;          // PATCH 1100 — Large/Mid/Small/Micro
  marketCap?: number;    // PATCH 1100
}

type SortField = 'symbol' | 'company' | 'sector' | 'entryPrice' | 'quantity' | 'cmp' | 'changePercent' | 'pnlPercent' | 'weight' | 'investedValue' | 'currentValue' | 'score' | 'decision';
type SortOrder = 'asc' | 'desc';

/* ── Constants ─────────────────────────────────────────────────────── */

const STORAGE_KEY = 'mc_portfolio_holdings';

/* ── Helpers ───────────────────────────────────────────────────────── */

const getStoredHoldings = (): PortfolioHolding[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
};

const setStoredHoldings = (h: PortfolioHolding[]) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch {}
};

/*
 * PATCH 0965 BUG #1 — Portfolio CMPs show N/A silently
 * --------------------------------------------------
 * ROOT CAUSE: Both fetchStockQuotes and fetchIndividualQuotes used a
 * try/catch that swallowed every error and returned []. fetchData
 * therefore NEVER hit its outer catch — the user saw 43 rows of "N/A"
 * with no banner explaining why, and Best/Worst pinned to the first
 * alphabetic holding (HFCL) at +0.00%.
 *
 * FIX: Bubble fetch failures up to fetchData as typed exceptions so the
 * outer catch can render a red banner with a Retry button. We also:
 *   - bump per-request timeout to AbortSignal.timeout(60_000)  // PATCH zzz90 (EO5)
 *   - distinguish "network/timeout" vs "200 with malformed shape"
 *   - log malformed payloads to console so users can self-diagnose
 *   - expose `QuotesShapeError` so fetchData can surface a distinct
 *     "Price data malformed — check console" banner.
 */
class QuotesShapeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'QuotesShapeError'; }
}

// AUDIT_100 #3 — fetch BOTH India + US bulk feeds and merge.
// Users hold mixed portfolios (NVDA + RELIANCE in one watchlist).
// Previously only India quotes were fetched → US holdings showed cmp=0.
const fetchStockQuotes = async (): Promise<StockQuote[]> => {
  const mapQuote = (s: any): StockQuote => ({
    ticker: s.ticker, company: s.company || s.ticker, sector: s.sector || '—',
    industry: s.industry || '—', price: s.price || 0, change: s.change || 0,
    changePercent: s.changePercent || 0, dayHigh: s.dayHigh || s.price || 0,
    dayLow: s.dayLow || s.price || 0,
    indexGroup: s.indexGroup || s.cap || '', marketCap: s.marketCap || 0, // PATCH 1100
  });
  const fetchOne = async (market: 'india' | 'us'): Promise<StockQuote[]> => {
    // PATCH 0965 BUG #1 — AbortSignal.timeout(60_000)  // PATCH zzz90 (EO5) replaces the bespoke
    // AbortController, and we now THROW rather than return [] on failure
    // so the caller can render a visible error banner.
    const res = await fetch(`/api/market/quotes?market=${market}`, {
      signal: AbortSignal.timeout(60_000)  // PATCH zzz90 (EO5),
    });
    if (!res.ok) {
      throw new Error(`/api/market/quotes?market=${market} → HTTP ${res.status}`);
    }
    let data: any;
    try { data = await res.json(); }
    catch (e) {
      throw new QuotesShapeError(`market=${market}: response was not valid JSON`);
    }
    if (!Array.isArray(data?.stocks)) {
      // eslint-disable-next-line no-console
      console.error(`[portfolio] /api/market/quotes?market=${market} returned unexpected shape:`, data);
      throw new QuotesShapeError(`market=${market}: payload.stocks is not an array`);
    }
    return data.stocks.map(mapQuote);
  };
  // PATCH 0965 BUG #1 — Promise.allSettled so a single-market outage
  // doesn't blank both feeds. If BOTH fail we re-throw the first error
  // so fetchData shows the banner; if at least one succeeds we surface
  // a non-fatal console warning for the other.
  const settled = await Promise.allSettled([fetchOne('india'), fetchOne('us')]);
  const india = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const us = settled[1].status === 'fulfilled' ? settled[1].value : null;
  // PATCH 1032 — an empty fulfilled array is just as useless as null. Without this,
  // a slow India feed (rejected by AbortSignal) combined with an empty US feed
  // silently returns [] and every CMP renders '—' with no banner.
  const indiaUsable = india && india.length > 0 ? india : null;
  const usUsable = us && us.length > 0 ? us : null;
  if (indiaUsable === null && usUsable === null) {
    const firstReason = settled[0].status === 'rejected' ? settled[0].reason : settled[1].status === 'rejected' ? settled[1].reason : new Error('unknown');
    throw firstReason instanceof Error ? firstReason : new Error(String(firstReason));
  }
  if (india === null && settled[0].status === 'rejected') {
    // eslint-disable-next-line no-console
    console.warn('[portfolio] India quotes failed, continuing with US only:', settled[0].reason);
  }
  if (us === null && settled[1].status === 'rejected') {
    // eslint-disable-next-line no-console
    console.warn('[portfolio] US quotes failed, continuing with India only:', settled[1].reason);
  }
  return [...(indiaUsable ?? []), ...(usUsable ?? [])];
};

const fetchIndividualQuotes = async (symbols: string[]): Promise<StockQuote[]> => {
  if (symbols.length === 0) return [];
  try {
    const results: StockQuote[] = [];
    // PATCH zzz92 — per-symbol endpoint can't handle 17+ at once (returns 0 stocks).
    // Smaller batches (3) succeed where 20-batches fail entirely.
    for (let i = 0; i < symbols.length; i += 3) {
      const batch = symbols.slice(i, i + 3);
      // Normalize tickers and URL-encode them to handle special chars like &
      const normalizedBatch = batch.map(s => encodeURIComponent(normalizeTicker(s)));
      // PATCH 0465 — per-batch 10s timeout (matches watchlist pattern)
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch(`/api/market/quote?symbols=${normalizedBatch.join(',')}`, { signal: ctl.signal });
      } catch {
        clearTimeout(timer);
        continue;
      }
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      results.push(...(data.stocks || []).map((s: any) => ({
        ticker: s.ticker, company: s.company || s.ticker, sector: s.sector || '—', indexGroup: s.indexGroup || s.cap || '', marketCap: s.marketCap || 0, // PATCH 1100
        industry: s.industry || '—', price: s.price || 0, change: s.change || 0,
        changePercent: s.changePercent || 0, dayHigh: s.dayHigh || s.price || 0,
        dayLow: s.dayLow || s.price || 0,
      })));
    }
    return results;
  } catch { return []; }
};

const fmt = (n: number) => n >= 10000000 ? `₹${(n / 10000000).toFixed(2)} Cr` : n >= 100000 ? `₹${(n / 100000).toFixed(2)} L` : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/* ── Helpers ────────────────────────────────────────────────────────── */

/** Weighted return across all holdings.
 *  Returns { value, mode, years } where:
 *   - mode='CAGR'  = value is annualized (only when avgYears >= 1)
 *   - mode='TOTAL' = value is raw total return (when avgYears < 1)
 *
 *  PATCH 1101zzz7 — Reported bug: portfolio held since May 2026 (~1.5 months)
 *  showed CAGR +1269%. The math (1+ret)^(1/years) was correct but meaningless
 *  for sub-annual holdings — a 30% gain over 1.5 months annualizes to 800%+.
 *  Industry convention (CFA/GIPS): do not annualize returns < 1 year. Show the
 *  raw total return and label it as such; switch to CAGR once avgYears >= 1.
 */
function computePortfolioCagr(rows: PortfolioRow[], holdings: PortfolioHolding[]):
  { value: number; mode: 'CAGR' | 'TOTAL'; years: number } | null {
  const now = Date.now();
  let weightedYears = 0;
  let totalInvested = 0;
  for (const row of rows) {
    const h = holdings.find(h => h.symbol === row.symbol);
    if (!h?.addedAt) continue;
    const addedMs = new Date(h.addedAt).getTime();
    if (isNaN(addedMs)) continue;
    const years = (now - addedMs) / (365.25 * 24 * 3600 * 1000);
    if (years < 0.01) continue; // skip positions added today
    weightedYears += years * row.investedValue;
    totalInvested += row.investedValue;
  }
  if (totalInvested === 0) return null;
  const avgYears = weightedYears / totalInvested;
  if (avgYears < 0.01) return null;

  const totalCurrent = rows.reduce((s, r) => s + r.currentValue, 0);
  const totalInv = rows.reduce((s, r) => s + r.investedValue, 0);
  if (totalInv <= 0 || totalCurrent <= 0) return null;
  const totalReturnPct = (totalCurrent / totalInv - 1) * 100;
  // Hold-period < 1 year: do NOT annualize. Show raw return.
  if (avgYears < 1) {
    return { value: parseFloat(totalReturnPct.toFixed(2)), mode: 'TOTAL', years: avgYears };
  }
  const cagr = (Math.pow(totalCurrent / totalInv, 1 / avgYears) - 1) * 100;
  return { value: parseFloat(cagr.toFixed(1)), mode: 'CAGR', years: avgYears };
}

/** Returns top sector and its weight% */
// PATCH 1101zzz11 — TOP SECTOR honesty. Was returning "Other 50%" because
// "Other" was treated as a real sector. "Other" is what the data feed returns
// when sector enrichment fails — surfacing it as the user's top sector is
// misleading noise. Skip Other / unknown / dash, and ALSO return null when
// the leading "real" sector covers under 10% of the portfolio (any number
// below that is a tied-many-sectors signal, not a concentration insight).
function topSector(rows: PortfolioRow[]): { sector: string; pct: number; mappedPct: number } | null {
  const totalValue = rows.reduce((s, r) => s + r.currentValue, 0);
  if (totalValue === 0) return null;
  const SKIP = new Set(['', '—', 'Other', 'other', 'Unknown', 'unknown', 'N/A', 'n/a']);
  const bySector: Record<string, number> = {};
  let mappedTotal = 0;
  for (const r of rows) {
    if (!r.sector || SKIP.has(r.sector)) continue;
    bySector[r.sector] = (bySector[r.sector] ?? 0) + r.currentValue;
    mappedTotal += r.currentValue;
  }
  const entries = Object.entries(bySector).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return {
    sector: entries[0][0],
    pct: (entries[0][1] / totalValue) * 100,
    mappedPct: totalValue > 0 ? (mappedTotal / totalValue) * 100 : 0,
  };
}

/* ── Summary Cards ─────────────────────────────────────────────────── */

// PATCH 1101zzz9 — Since-Inception tracking. Two extra fields the user
// asked for: an editable INITIAL CAPITAL (deposit ₹) and an inception
// DATE (when that capital was first committed). From those + current
// portfolio value we derive:
//   • TOTAL RETURN since inception (₹ gain and %)
//   • CAGR since inception (annualized — meaningful because >1y of data)
//
// Defaults: ₹35,40,000 deposited Aug 2022 (user-supplied). User can edit
// inline; values persist in localStorage so a refresh doesn't reset them.
const INCEPTION_CAPITAL_KEY = 'mc_portfolio_inception_capital_v1';
const INCEPTION_DATE_KEY = 'mc_portfolio_inception_date_v1';
const DEFAULT_INCEPTION_CAPITAL = 3540000;
const DEFAULT_INCEPTION_DATE = '2022-08-01';

// PATCH 1101zzz10 — Cash positions. Multiple labelled buckets (Savings,
// Liquid Fund, FD, etc.) so the dashboard reflects TOTAL WEALTH (equities +
// cash), not just equity value. Every summary metric — current value, total
// P&L, since-inception return, CAGR, allocation — now folds cash in.
const CASH_POSITIONS_KEY = 'mc_portfolio_cash_positions_v1';
interface CashPosition {
  id: string;
  label: string;
  amount: number;
  addedAt: string;
}
const loadCashPositions = (): CashPosition[] => {
  try {
    const raw = localStorage.getItem(CASH_POSITIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((c: any) =>
      c && typeof c.id === 'string' && typeof c.label === 'string' &&
      typeof c.amount === 'number' && isFinite(c.amount) && c.amount >= 0
    );
  } catch { return []; }
};
const saveCashPositions = (positions: CashPosition[]): void => {
  try { localStorage.setItem(CASH_POSITIONS_KEY, JSON.stringify(positions)); } catch {}
};

function PortfolioSummary({ rows, holdings }: { rows: PortfolioRow[]; holdings: PortfolioHolding[] }) {
  // Hooks must run unconditionally — keep them above the empty-rows guard.
  const [inceptionCapital, setInceptionCapital] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(INCEPTION_CAPITAL_KEY);
      const n = saved ? parseFloat(saved) : NaN;
      return isFinite(n) && n > 0 ? n : DEFAULT_INCEPTION_CAPITAL;
    } catch { return DEFAULT_INCEPTION_CAPITAL; }
  });
  const [inceptionDate, setInceptionDate] = useState<string>(() => {
    try { return localStorage.getItem(INCEPTION_DATE_KEY) || DEFAULT_INCEPTION_DATE; }
    catch { return DEFAULT_INCEPTION_DATE; }
  });
  const [editingInception, setEditingInception] = useState(false);
  const [tmpCapital, setTmpCapital] = useState<string>(String(inceptionCapital));
  const [tmpDate, setTmpDate] = useState<string>(inceptionDate);

  const saveInception = () => {
    const n = parseFloat(tmpCapital);
    if (!isFinite(n) || n <= 0) { toast.error('Initial capital must be > 0'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tmpDate)) { toast.error('Date must be YYYY-MM-DD'); return; }
    setInceptionCapital(n);
    setInceptionDate(tmpDate);
    try {
      localStorage.setItem(INCEPTION_CAPITAL_KEY, String(n));
      localStorage.setItem(INCEPTION_DATE_KEY, tmpDate);
    } catch {}
    setEditingInception(false);
    toast.success('Inception updated');
  };
  const cancelInception = () => {
    setTmpCapital(String(inceptionCapital));
    setTmpDate(inceptionDate);
    setEditingInception(false);
  };

  // PATCH 1101zzz10 — Cash positions state.
  const [cashPositions, setCashPositions] = useState<CashPosition[]>(() => loadCashPositions());
  const [addingCash, setAddingCash] = useState(false);
  const [newCashLabel, setNewCashLabel] = useState('');
  const [newCashAmount, setNewCashAmount] = useState('');

  const persistCash = (next: CashPosition[]) => {
    setCashPositions(next);
    saveCashPositions(next);
  };
  const addCashPosition = () => {
    const label = newCashLabel.trim();
    const amount = parseFloat(newCashAmount);
    if (!label) { toast.error('Cash label required (e.g. Savings, Liquid Fund)'); return; }
    if (!isFinite(amount) || amount <= 0) { toast.error('Amount must be > 0'); return; }
    const pos: CashPosition = {
      id: `cash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label, amount, addedAt: new Date().toISOString(),
    };
    persistCash([...cashPositions, pos]);
    setNewCashLabel(''); setNewCashAmount(''); setAddingCash(false);
    toast.success(`Added cash position: ${label}`);
  };
  const removeCashPosition = (id: string) => {
    const pos = cashPositions.find(p => p.id === id);
    persistCash(cashPositions.filter(p => p.id !== id));
    if (pos) toast.success(`Removed ${pos.label}`);
  };
  const updateCashAmount = (id: string, amount: number) => {
    if (!isFinite(amount) || amount < 0) return;
    persistCash(cashPositions.map(p => p.id === id ? { ...p, amount } : p));
  };

  const totalCash = cashPositions.reduce((s, c) => s + c.amount, 0);

  if (rows.length === 0 && cashPositions.length === 0) return null;

  const totalInvested = rows.reduce((s, r) => s + r.investedValue, 0);
  // Holdings without a live price must not pretend zero P&L — aggregate only priced rows.
  const priced = rows.filter(r => isFinite(r.cmp) && r.cmp > 0);
  const pricedInvested = priced.reduce((s, r) => s + r.investedValue, 0);
  const totalCurrent = priced.reduce((s, r) => s + r.currentValue, 0);
  const totalPnl = totalCurrent - pricedInvested;
  const totalPnlPct = pricedInvested > 0 ? (totalPnl / pricedInvested) * 100 : 0;
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const gainers = rows.filter(r => r.cmp > 0 && r.pnl > 0).length;
  const losers = rows.filter(r => r.cmp > 0 && r.pnl < 0).length;
  const noData = rows.filter(r => r.cmp === 0).length;

  const best = priced.length >= 2 ? priced.reduce((a, b) => a.pnlPercent > b.pnlPercent ? a : b) : null;
  const worst = priced.length >= 2 ? priced.reduce((a, b) => a.pnlPercent < b.pnlPercent ? a : b) : null;
  const cagr = computePortfolioCagr(rows, holdings);
  const top = topSector(rows);

  // PATCH 1101zzz27 — Stale-feed guard. When the quote feed is temporarily
  // down (e.g. NSE refresh in progress, network blip), > 50% of holdings come
  // back with cmp=0. The naive calculation then reports TOTAL WEALTH = cash
  // only and Since-Inception drops to -97%, which looks catastrophic but is
  // just a refresh artifact. Detect that and fall back to last-good cached
  // numbers (only updated when priceCoverage >= 70%) so user sees their REAL
  // wealth with a "Refreshing prices..." indicator instead of red panic.
  const LAST_GOOD_KEY = 'mc_portfolio_last_good_summary_v1';
  const priceCoverage = rows.length > 0 ? priced.length / rows.length : 1;
  const feedIsStale = rows.length > 0 && priceCoverage < 0.5;
  type LastGoodSummary = {
    capturedAt: string;
    totalCurrent: number;
    totalPnl: number;
    totalPnlPct: number;
    dayPnl: number;
    gainersCount: number;
    losersCount: number;
  };
  let lastGood: LastGoodSummary | null = null;
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LAST_GOOD_KEY) : null;
    if (raw) lastGood = JSON.parse(raw);
  } catch {}
  // Write fresh data to cache when feed is healthy.
  if (typeof window !== 'undefined' && rows.length > 0 && priceCoverage >= 0.7) {
    try {
      const next: LastGoodSummary = {
        capturedAt: new Date().toISOString(),
        totalCurrent, totalPnl, totalPnlPct, dayPnl,
        gainersCount: gainers, losersCount: losers,
      };
      localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(next));
    } catch {}
  }
  // Use last-good values when feed is stale; live values otherwise.
  const effectiveTotalCurrent = feedIsStale && lastGood?.totalCurrent ? lastGood.totalCurrent : totalCurrent;
  const effectiveTotalPnl = feedIsStale && lastGood?.totalPnl !== undefined ? lastGood.totalPnl : totalPnl;
  const effectiveTotalPnlPct = feedIsStale && lastGood?.totalPnlPct !== undefined ? lastGood.totalPnlPct : totalPnlPct;
  const effectiveDayPnl = feedIsStale && lastGood?.dayPnl !== undefined ? lastGood.dayPnl : dayPnl;
  const effectiveGainers = feedIsStale && lastGood?.gainersCount !== undefined ? lastGood.gainersCount : gainers;
  const effectiveLosers = feedIsStale && lastGood?.losersCount !== undefined ? lastGood.losersCount : losers;
  const showingStale = feedIsStale && !!lastGood;
  // PATCH 1101zzz35 — When feed is stale AND we have NO last-good cache
  // yet (first visit since deploy, or cache cleared), the Since-Inception
  // math falls through to totalWealth = cash only and reports a ~-97%
  // catastrophe even though the real portfolio is fine — we just haven't
  // loaded prices yet. Suppress ALL wealth-dependent cards entirely in
  // that window. They reappear automatically once either prices arrive
  // or a healthy refresh populates the cache.
  const noUsableWealthData = feedIsStale && !lastGood;

  // PATCH 1101zzz9 + zzz10 — TOTAL WEALTH = equity current + cash.
  const totalWealth = effectiveTotalCurrent + totalCash;
  const hasWealthData =
    !noUsableWealthData && (effectiveTotalCurrent > 0 || totalCash > 0);
  const inceptionMs = new Date(inceptionDate + 'T00:00:00Z').getTime();
  const yearsSince = isFinite(inceptionMs)
    ? (Date.now() - inceptionMs) / (365.25 * 24 * 3600 * 1000)
    : NaN;
  const sinceInceptionGain = hasWealthData ? totalWealth - inceptionCapital : NaN;
  const sinceInceptionPct = hasWealthData && inceptionCapital > 0
    ? ((totalWealth / inceptionCapital) - 1) * 100
    : NaN;
  const sinceInceptionCagr = hasWealthData && inceptionCapital > 0 && yearsSince >= 1 && totalWealth > 0
    ? (Math.pow(totalWealth / inceptionCapital, 1 / yearsSince) - 1) * 100
    : NaN;
  const yearsLabel = isFinite(yearsSince) && yearsSince > 0
    ? `${yearsSince.toFixed(1)}y · since ${new Date(inceptionDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
    : 'set inception →';
  const equityPct = totalWealth > 0 ? (totalCurrent / totalWealth) * 100 : 0;
  const cashPct = totalWealth > 0 ? (totalCash / totalWealth) * 100 : 0;

  const cards = [
    // Since-inception cards lead — they're the user's primary "how am I doing overall" view.
    { label: 'INITIAL CAPITAL', value: fmt(inceptionCapital), sub: `deposited ${new Date(inceptionDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`, color: '#F5F7FA' },
    ...(isFinite(sinceInceptionGain) ? [{
      label: 'TOTAL RETURN (since inception)',
      value: `${sinceInceptionGain < 0 ? '-' : ''}${fmt(Math.abs(sinceInceptionGain))} (${fmtPct(sinceInceptionPct)})`,
      sub: noData > 0 ? `${noData} unpriced · ${totalCash > 0 ? 'incl. cash · ' : ''}indicative` : (totalCash > 0 ? `incl. ${fmt(totalCash)} cash · ${yearsLabel}` : yearsLabel),
      color: sinceInceptionGain >= 0 ? '#10B981' : '#EF4444',
    }] : []),
    ...(isFinite(sinceInceptionCagr) ? [{
      label: 'CAGR (since inception)',
      value: fmtPct(sinceInceptionCagr),
      sub: totalCash > 0 ? `${yearsLabel} · incl. cash` : yearsLabel,
      color: sinceInceptionCagr >= 0 ? '#10B981' : '#EF4444',
    }] : []),
    // PATCH 1101zzz10 + zzz35 — TOTAL WEALTH = equities + cash. Suppress
    // when feed stale + no cache, so we don't show the misleading
    // "₹97K wealth on a ₹62L portfolio" snapshot.
    ...(totalCash > 0 && !noUsableWealthData ? [{
      label: 'TOTAL WEALTH',
      value: fmt(totalWealth),
      sub: `${equityPct.toFixed(0)}% equity · ${cashPct.toFixed(0)}% cash`,
      color: '#60A5FA',
    }] : []),
    ...(totalCash > 0 ? [{
      label: 'CASH BALANCE',
      value: fmt(totalCash),
      sub: cashPositions.length === 1 ? cashPositions[0].label : `${cashPositions.length} buckets`,
      color: '#FBBF24',
    }] : []),
    // PATCH 1101zzz35 — Refreshing placeholder card. When feed is stale
    // AND no last-good cache exists, surface a single explicit "loading"
    // card so the user sees WHY all wealth metrics are hidden, instead
    // of mistaking the suppression for missing portfolio data.
    ...(noUsableWealthData ? [{
      label: 'WEALTH (loading)',
      value: '🔄 …',
      sub: 'Prices loading — refresh manually or wait ~30s',
      color: '#FBBF24',
    }] : []),
    { label: 'INVESTED VALUE', value: fmt(totalInvested), color: '#F5F7FA' },
    { label: 'CURRENT VALUE (equity)',
      // PATCH 1101zzz27 — show last-good when feed stale, with refresh indicator.
      value: priced.length > 0 ? fmt(totalCurrent) : (showingStale && lastGood ? fmt(lastGood.totalCurrent) : '—'),
      sub: showingStale ? '🔄 refreshing prices…' : undefined,
      color: '#F5F7FA',
    },
    priced.length > 0
      ? {
          label: 'TOTAL P&L',
          value: `${totalPnl < 0 ? '-' : ''}${fmt(Math.abs(totalPnl))} (${fmtPct(totalPnlPct)})`,
          // PATCH 1101zzz11 — flag equity-only when cash exists so user
          // doesn't compare it to wealth-level numbers above.
          // PATCH 1101zzz27 — use effective values + stale indicator.
          sub: showingStale ? '🔄 refreshing prices…' : (totalCash > 0 ? 'equity only' : undefined),
          value: `${effectiveTotalPnl < 0 ? '-' : ''}${fmt(Math.abs(effectiveTotalPnl))} (${fmtPct(effectiveTotalPnlPct)})`,
          color: effectiveTotalPnl >= 0 ? '#10B981' : '#EF4444',
        }
      : showingStale && lastGood
        ? {
            label: 'TOTAL P&L',
            value: `${lastGood.totalPnl < 0 ? '-' : ''}${fmt(Math.abs(lastGood.totalPnl))} (${fmtPct(lastGood.totalPnlPct)})`,
            sub: '🔄 refreshing prices…',
            color: lastGood.totalPnl >= 0 ? '#10B981' : '#EF4444',
          }
        : { label: 'TOTAL P&L', value: '—', sub: 'prices unavailable', color: '#F5F7FA' },
    // PATCH 1101zzz7 — Honest label: TOTAL RETURN when held <1y, CAGR when >=1y.
    // The number is the same compounded gain; the LABEL prevents the misread
    // that a 1.5-month +30% means a sustainable +1269% annual run-rate.
    // PATCH 1101zzz11 — sub-label honesty: cagr.years is computed from
    // holding.addedAt, which is "when added to the tracker", NOT the real
    // purchase date. A user importing a 4-year portfolio yesterday gets
    // years=0.0027 here. Rename to "since added to tracker" so the period
    // isn't misread as actual holding time.
    ...(cagr !== null
      ? (() => {
          const monthsTracked = cagr.years * 12;
          const periodLabel =
            monthsTracked < 1
              ? `~${(cagr.years * 365).toFixed(0)} days in tracker`
              : monthsTracked < 12
                ? `~${monthsTracked.toFixed(1)} months in tracker`
                : `${cagr.years.toFixed(1)}y in tracker`;
          return [{
            label: cagr.mode === 'TOTAL' ? 'WEIGHTED RETURN' : 'WEIGHTED CAGR',
            value: fmtPct(cagr.value),
            sub: cagr.mode === 'TOTAL' ? periodLabel : `${periodLabel} · per-holding`,
            color: cagr.value >= 0 ? '#10B981' : '#EF4444',
          }];
        })()
      : []),
    {
      label: 'DAY P&L',
      // PATCH 1101zzz27 — effective + stale indicator.
      value: `${effectiveDayPnl < 0 ? '-' : ''}${fmt(Math.abs(effectiveDayPnl))}`,
      sub: showingStale ? '🔄 refreshing prices…' : (totalCash > 0 ? 'equity only' : undefined),
      color: effectiveDayPnl >= 0 ? '#10B981' : '#EF4444',
    },
    { label: 'HOLDINGS',
      value: `${rows.length}`,
      // PATCH 1101zzz27 — show effective gainers/losers + refresh hint.
      sub: showingStale
        ? `🔄 refreshing prices… (${rows.length} held)`
        : `${effectiveGainers} ↑  ${effectiveLosers} ↓${noData > 0 ? `  ${noData} N/A` : ''}`,
      color: '#F5F7FA',
    },
    // PATCH 1101zzz11 — TOP SECTOR honest sub-label: "% of mapped" so user
    // sees that a chunk of the portfolio has no sector mapping. If <60%
    // of value has a real sector, also flag "low coverage" so the user
    // knows the leader is from a small base.
    ...(top ? [{
      label: 'TOP SECTOR',
      value: top.sector,
      sub: `${top.pct.toFixed(0)}% of total${top.mappedPct < 60 ? ` · ${top.mappedPct.toFixed(0)}% of holdings mapped` : ''}`,
      color: '#60A5FA',
    }] : []),
    { label: 'BEST PERFORMER', value: best ? best.symbol : '—', sub: best ? fmtPct(best.pnlPercent) : 'needs 2+ priced holdings', color: '#10B981' },
    { label: 'WORST PERFORMER', value: worst ? worst.symbol : '—', sub: worst ? fmtPct(worst.pnlPercent) : 'needs 2+ priced holdings', color: '#EF4444' },
  ];

  return (
    <>
      {/* Inception editor — collapsed by default, opens on click. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
        padding: '8px 12px', backgroundColor: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-2)', borderRadius: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', letterSpacing: '0.5px' }}>📍 INCEPTION:</span>
        {!editingInception ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 700 }}>
              {fmt(inceptionCapital)} · {new Date(inceptionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => { setTmpCapital(String(inceptionCapital)); setTmpDate(inceptionDate); setEditingInception(true); }}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-2)', cursor: 'pointer' }}>
              <Edit3 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Edit
            </button>
          </>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>Capital ₹</label>
            <input value={tmpCapital} onChange={e => setTmpCapital(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ fontSize: 13, padding: '4px 8px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
                borderRadius: 5, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, monospace', width: 130 }}
              placeholder="3540000" />
            <label style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>Date</label>
            <input type="date" value={tmpDate} onChange={e => setTmpDate(e.target.value)}
              style={{ fontSize: 13, padding: '4px 8px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
                borderRadius: 5, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, monospace' }} />
            <button onClick={saveInception}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: '#10B981', border: 'none', color: 'white', cursor: 'pointer' }}>
              <Check size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Save
            </button>
            <button onClick={cancelInception}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-2)', cursor: 'pointer' }}>
              <X size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Cancel
            </button>
          </>
        )}
      </div>

      {/* PATCH 1101zzz10 — Cash positions bar. Mirrors the inception bar's
          visual language so the two read as a pair. List inline; add via
          the "+ Add Cash" button which expands two compact inputs. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '8px 12px', backgroundColor: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-2)', borderRadius: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', letterSpacing: '0.5px' }}>💵 CASH:</span>
        {cashPositions.length === 0 && !addingCash && (
          <span style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>none — track savings, liquid funds, FDs so wealth + CAGR include them</span>
        )}
        {cashPositions.map(c => (
          <span key={c.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)',
            background: 'var(--mc-bg-1)', padding: '4px 8px', borderRadius: 5,
            border: '1px solid var(--mc-border-2)',
          }}>
            <span style={{ color: '#FBBF24' }}>{c.label}</span>
            <input
              type="number"
              value={c.amount}
              onChange={e => updateCashAmount(c.id, parseFloat(e.target.value) || 0)}
              style={{ width: 100, fontSize: 12, fontWeight: 700, padding: '2px 6px',
                background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)',
                borderRadius: 3, color: 'var(--mc-text-1)',
                fontFamily: 'ui-monospace, monospace' }}
              title={`Editable. Added ${new Date(c.addedAt).toLocaleDateString('en-IN')}`}
            />
            <button onClick={() => removeCashPosition(c.id)} title="Remove"
              style={{ background: 'transparent', border: 'none', color: '#EF4444',
                cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center' }}>
              <Trash2 size={12} />
            </button>
          </span>
        ))}
        {addingCash ? (
          <>
            <input value={newCashLabel} onChange={e => setNewCashLabel(e.target.value)}
              placeholder="Label (Savings, Liquid Fund...)"
              style={{ fontSize: 12, padding: '4px 8px', background: 'var(--mc-bg-1)',
                border: '1px solid var(--mc-border-2)', borderRadius: 5,
                color: 'var(--mc-text-1)', width: 180 }} />
            <input value={newCashAmount} onChange={e => setNewCashAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Amount ₹"
              style={{ fontSize: 12, padding: '4px 8px', background: 'var(--mc-bg-1)',
                border: '1px solid var(--mc-border-2)', borderRadius: 5,
                color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, monospace', width: 110 }} />
            <button onClick={addCashPosition}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: '#10B981', border: 'none', color: 'white', cursor: 'pointer' }}>
              <Check size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Save
            </button>
            <button onClick={() => { setAddingCash(false); setNewCashLabel(''); setNewCashAmount(''); }}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid var(--mc-border-2)',
                color: 'var(--mc-text-2)', cursor: 'pointer' }}>
              <X size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setAddingCash(true)}
            style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
              background: 'transparent', border: '1px solid #FBBF24', color: '#FBBF24', cursor: 'pointer' }}>
            <Plus size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Add Cash
          </button>
        )}
        {!addingCash && cashPositions.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-3)' }}>
            = {fmt(totalCash)}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {cards.map(c => (
          <div key={c.label} style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>{c.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: c.color }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: '11px', color: 'var(--mc-text-4)', marginTop: '2px' }}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Add Holding Modal ─────────────────────────────────────────────── */

function AddHoldingForm({ onAdd, onCancel, quotes }: { onAdd: (h: PortfolioHolding) => void; onCancel: () => void; quotes: StockQuote[] }) {
  const [symbol, setSymbol] = useState('');
  const [company, setCompany] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    const sym = symbol.trim().toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '');
    if (!sym || !/^[A-Z0-9&-]+$/.test(sym)) { toast.error('Invalid symbol'); return; }
    if (!entryPrice || Number(entryPrice) <= 0) { toast.error('Enter valid entry price'); return; }
    if (!quantity || Number(quantity) <= 0) { toast.error('Enter valid quantity'); return; }

    onAdd({
      symbol: sym,
      entryPrice: Number(entryPrice),
      quantity: Number(quantity),
      weight: 0,
      addedAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
    });
  };

  const searchSuggestions = useMemo((): TickerSuggestion[] =>
    quotes.map(q => ({ ticker: q.ticker, company: q.company || q.ticker, sector: q.sector || '—', price: q.price || 0, changePercent: q.changePercent || 0 })),
    [quotes]
  );

  const inputStyle = {
    backgroundColor: '#1A2B3C', border: '1px solid #2A3B4C', borderRadius: '8px',
    padding: '10px 14px', color: '#F5F7FA', fontSize: '14px', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
      <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--mc-text-0)', marginBottom: '16px' }}>Add Holding</div>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>SEARCH STOCK</label>
        <TickerSearch
          onSelect={(ticker, sug) => {
            setSymbol(ticker);
            if (sug) {
              setCompany(sug.company);
              if (sug.price > 0 && !entryPrice) setEntryPrice(sug.price.toFixed(2));
            }
          }}
          quotes={searchSuggestions}
          placeholder="Search by company name or ticker..."
          clearOnSelect={false}
        />
        {symbol && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--mc-bullish)', fontWeight: 600 }}>
            Selected: {symbol} {company && company !== symbol ? `— ${company}` : ''}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>ENTRY PRICE (₹)</label>
          {/* PATCH 0454 P2-29 — inputMode='decimal' so mobile users get the
              numeric keyboard instead of the full keyboard. */}
          <input type="number" inputMode="decimal" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} placeholder="1250.00" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>QUANTITY</label>
          <input type="number" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--mc-text-3)', fontWeight: '600', display: 'block', marginBottom: '4px' }}>NOTES (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Long-term hold" style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--mc-border-2)', backgroundColor: 'transparent', color: 'var(--mc-text-3)', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Cancel</button>
        <button onClick={handleSubmit} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--mc-bullish)', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Add to Portfolio</button>
      </div>
    </div>
  );
}

/* ── Inline Edit Cell ──────────────────────────────────────────────── */

function EditableCell({ value, onSave, type = 'price' }: { value: number; onSave: (v: number) => void; type?: 'price' | 'qty' }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));

  if (!editing) {
    return (
      <span style={{ cursor: 'pointer', borderBottom: '1px dashed var(--mc-text-4)' }} onClick={() => { setVal(String(value)); setEditing(true); }}>
        {type === 'price' ? `₹${value.toFixed(2)}` : String(Math.round(value))}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
      {/* PATCH 0454 P2-29 — inputMode='decimal' for mobile keyboard. */}
      <input type="number" inputMode={type === 'qty' ? 'numeric' : 'decimal'} value={val} onChange={e => setVal(e.target.value)}
        style={{ width: '80px', padding: '2px 6px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-info)', borderRadius: '4px', color: 'var(--mc-text-0)', fontSize: '12px', outline: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(Number(val)); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
      <button onClick={() => { onSave(Number(val)); setEditing(false); }} style={{ background: 'none', border: 'none', color: 'var(--mc-bullish)', cursor: 'pointer', padding: '2px' }}>
        <Check style={{ width: '12px', height: '12px' }} />
      </button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--mc-bearish)', cursor: 'pointer', padding: '2px' }}>
        <X style={{ width: '12px', height: '12px' }} />
      </button>
    </span>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

/* ── PATCH 1100 — Market-cap helpers + Portfolio Analytics ──────────── */

const CAP_COLORS: Record<string, string> = { all: '#8BA3C1', large: '#60A5FA', mid: '#A78BFA', small: '#34D399', micro: '#FBBF24', other: '#64748B' };

function normCapBucket(c?: string): 'large' | 'mid' | 'small' | 'micro' | 'other' {
  const x = (c || '').toLowerCase();
  if (x === 'large') return 'large';
  if (x === 'mid') return 'mid';
  if (x === 'small') return 'small';
  if (x === 'micro') return 'micro';
  return 'other';
}

function capBadge(c?: string) {
  const b = normCapBucket(c);
  if (b === 'other') return <span style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>—</span>;
  const col = CAP_COLORS[b];
  const label = b.charAt(0).toUpperCase() + b.slice(1);
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 800, background: `${col}22`, color: col, letterSpacing: '0.3px' }}>{label}</span>;
}

function PortfolioAnalytics({ rows, onSelectCap }: { rows: PortfolioRow[]; onSelectCap?: (cap: string) => void }) {
  const fmtRs = (v: number) => '₹' + Math.round(v || 0).toLocaleString('en-IN');
  const pctTxt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const totalCur = rows.reduce((a, r) => a + (r.currentValue || 0), 0) || 1;
  const totalInv = rows.reduce((a, r) => a + (r.investedValue || 0), 0) || 1;
  const totalPnl = rows.reduce((a, r) => a + (r.pnl || 0), 0);
  const dayPnl = rows.reduce((a, r) => a + (r.dayPnl || 0), 0);

  // Cap allocation (value-weighted % AND counts)
  const capOrder: Array<'large' | 'mid' | 'small' | 'micro' | 'other'> = ['large', 'mid', 'small', 'micro', 'other'];
  const capLabel: Record<string, string> = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap', micro: 'Micro cap', other: 'Unclassified' };
  const capStats = capOrder.map(k => {
    const rs = rows.filter(r => normCapBucket(r.cap) === k);
    const value = rs.reduce((a, r) => a + (r.currentValue || 0), 0);
    const pnl = rs.reduce((a, r) => a + (r.pnl || 0), 0);
    const inv = rs.reduce((a, r) => a + (r.investedValue || 0), 0);
    return { k, count: rs.length, value, pnl, retPct: inv > 0 ? (pnl / inv) * 100 : 0, valPct: (value / totalCur) * 100 };
  }).filter(x => x.count > 0);

  // Sector allocation
  const secMap = new Map<string, { value: number; count: number; pnl: number }>();
  for (const r of rows) {
    const sec = r.sector && r.sector !== '—' ? r.sector : 'Unclassified';
    const cur = secMap.get(sec) || { value: 0, count: 0, pnl: 0 };
    cur.value += r.currentValue || 0; cur.count += 1; cur.pnl += r.pnl || 0;
    secMap.set(sec, cur);
  }
  const sectors = [...secMap.entries()].map(([sector, v]) => ({ sector, ...v, valPct: (v.value / totalCur) * 100 })).sort((a, b) => b.value - a.value);

  // Concentration
  const byVal = [...rows].sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
  const top5pct = (byVal.slice(0, 5).reduce((a, r) => a + (r.currentValue || 0), 0) / totalCur) * 100;
  const largest = byVal[0] ? { sym: byVal[0].symbol, pct: ((byVal[0].currentValue || 0) / totalCur) * 100 } : null;
  const hhi = rows.reduce((a, r) => { const w = (r.currentValue || 0) / totalCur; return a + w * w; }, 0) * 10000; // Herfindahl (0-10000)

  // Performance / risk
  const priced = rows.filter(r => r.cmp > 0);
  const winners = priced.filter(r => (r.pnl || 0) > 0);
  const losers = priced.filter(r => (r.pnl || 0) < 0);
  const best = [...priced].sort((a, b) => (b.pnlPercent || 0) - (a.pnlPercent || 0))[0];
  const worst = [...priced].sort((a, b) => (a.pnlPercent || 0) - (b.pnlPercent || 0))[0];
  const wtdRet = (totalPnl / totalInv) * 100;

  // Quality overlay — Conviction Beats tier + Multibagger score
  let cbMap: Record<string, any> = {};
  try { cbMap = JSON.parse(typeof window !== 'undefined' ? (localStorage.getItem('mc:conviction-beats:v1') || '{}') : '{}') || {}; } catch {}
  const tierOf = (sym: string) => cbMap[(sym || '').toUpperCase()]?.tier as string | undefined;
  const tierColors: Record<string, string> = { BLOCKBUSTER: '#F59E0B', STRONG: '#10B981', MIXED: '#94A3B8', AVOID: '#EF4444' };
  const tierCounts: Record<string, number> = {};
  let onCB = 0;
  for (const r of rows) { const t = tierOf(r.symbol); if (t) { onCB++; tierCounts[t] = (tierCounts[t] || 0) + 1; } }
  const scored = rows.filter(r => typeof r.score === 'number');
  const avgScore = scored.length ? scored.reduce((a, r) => a + (r.score || 0), 0) / scored.length : null;

  const card: any = { background: '#0D1B2E', border: '1px solid #2A3B4C', borderRadius: 12, padding: '16px 18px' };
  const h: any = { fontSize: 12, fontWeight: 800, color: '#60A5FA', letterSpacing: '0.5px', marginBottom: 12, textTransform: 'uppercase' };
  const Bar = ({ label, sub, pct, count, color, valueTxt, pnl }: any) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--mc-text-0)', fontWeight: 700 }}>{label} {count != null && <span style={{ color: 'var(--mc-text-4)', fontWeight: 600, fontSize: 11 }}>· {count}</span>}</span>
        <span style={{ color: 'var(--mc-text-2)', fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%{valueTxt ? <span style={{ color: 'var(--mc-text-4)', marginLeft: 6, fontSize: 11 }}>{valueTxt}</span> : null}{pnl != null ? <span style={{ color: pnl >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', marginLeft: 6, fontSize: 11 }}>{pctTxt(pnl)}</span> : null}</span>
      </div>
      <div style={{ height: 7, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 4 }} />
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const Stat = ({ label, value, color, sub }: any) => (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || 'var(--mc-text-0)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Stat label="CURRENT VALUE" value={fmtRs(totalCur)} />
        <Stat label="TOTAL P&L" value={`${fmtRs(Math.abs(totalPnl))} (${pctTxt(wtdRet)})`} color={totalPnl >= 0 ? '#10B981' : '#EF4444'} />
        <Stat label="DAY P&L" value={fmtRs(Math.abs(dayPnl))} color={dayPnl >= 0 ? '#10B981' : '#EF4444'} />
        <Stat label="WINNERS / LOSERS" value={`${winners.length} / ${losers.length}`} sub={`${priced.length} priced`} />
        <Stat label="TOP-5 CONCENTRATION" value={`${top5pct.toFixed(0)}%`} sub={largest ? `largest ${largest.sym} ${largest.pct.toFixed(0)}%` : ''} color={top5pct > 60 ? '#FBBF24' : '#F5F7FA'} />
        <Stat label="DIVERSIFICATION (HHI)" value={Math.round(hhi).toLocaleString('en-IN')} sub={hhi > 2500 ? 'concentrated' : hhi > 1500 ? 'moderate' : 'well spread'} color={hhi > 2500 ? '#FBBF24' : '#34D399'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* Cap allocation */}
        <div style={card}>
          <div style={h}>Market-cap allocation</div>
          {capStats.length === 0 ? <div style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>No cap data yet — refresh to pull live quotes.</div> :
            capStats.map(c => (
              <div key={c.k} onClick={() => onSelectCap?.(c.k)} title={`Show the ${c.count} ${capLabel[c.k]} holding${c.count === 1 ? '' : 's'}`} style={{ cursor: 'pointer' }}>
                <Bar label={capLabel[c.k]} count={c.count} pct={c.valPct} color={CAP_COLORS[c.k]} valueTxt={fmtRs(c.value)} pnl={c.retPct} />
              </div>
            ))}
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 4 }}>% = share of current value · count = holdings · last figure = return on that bucket · <span style={{ color: '#60A5FA' }}>click a bar to see those companies</span></div>
        </div>

        {/* Sector allocation */}
        <div style={card}>
          <div style={h}>Sector allocation</div>
          {sectors.slice(0, 10).map(sct => (
            <Bar key={sct.sector} label={sct.sector} count={sct.count} pct={sct.valPct} color="#22D3EE" valueTxt={fmtRs(sct.value)} pnl={sct.value > 0 ? (sct.pnl / (sct.value - sct.pnl || 1)) * 100 : 0} />
          ))}
        </div>

        {/* Performance & risk */}
        <div style={card}>
          <div style={h}>Performance &amp; risk</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Best performer</span><span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{best ? `${best.symbol} ${pctTxt(best.pnlPercent)}` : '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Worst performer</span><span style={{ color: 'var(--mc-bearish)', fontWeight: 700 }}>{worst ? `${worst.symbol} ${pctTxt(worst.pnlPercent)}` : '—'}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Value-weighted return</span><span style={{ color: wtdRet >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>{pctTxt(wtdRet)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--mc-text-3)' }}>Invested → Current</span><span style={{ color: 'var(--mc-text-0)', fontWeight: 700 }}>{fmtRs(totalInv)} → {fmtRs(totalCur)}</span></div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 4 }}>Win rate</div>
              <div style={{ height: 8, background: 'var(--mc-bg-2)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                <div style={{ height: '100%', width: `${priced.length ? (winners.length / priced.length) * 100 : 0}%`, background: 'var(--mc-bullish)' }} />
                <div style={{ height: '100%', flex: 1, background: 'var(--mc-bearish)' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2 }}>{priced.length ? Math.round((winners.length / priced.length) * 100) : 0}% of priced holdings in profit</div>
            </div>
          </div>
        </div>

        {/* Top winners & losers — 10 each */}
        <div style={card}>
          <div style={h}>Top winners &amp; losers</div>
          {(() => {
            const w = [...priced].filter(r => (r.pnl || 0) > 0).sort((a, b) => (b.pnlPercent || 0) - (a.pnlPercent || 0)).slice(0, 10);
            const l = [...priced].filter(r => (r.pnl || 0) < 0).sort((a, b) => (a.pnlPercent || 0) - (b.pnlPercent || 0)).slice(0, 10);
            const Row = ({ r, up }: any) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
                <span style={{ color: 'var(--mc-text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{r.symbol}</span>
                <span style={{ color: up ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pctTxt(r.pnlPercent || 0)}</span>
              </div>
            );
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>▲ TOP {w.length} WINNERS</div>
                  {w.length ? w.map(r => <Row key={r.symbol} r={r} up />) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>No winners</div>}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--mc-bearish)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>▼ TOP {l.length} LOSERS</div>
                  {l.length ? l.map(r => <Row key={r.symbol} r={r} up={false} />) : <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>No losers</div>}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Quality overlay */}
        <div style={card}>
          <div style={h}>Quality overlay</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 10 }}>
            <span style={{ color: 'var(--mc-text-3)' }}>On Conviction Beats</span>
            <span style={{ color: 'var(--mc-warn)', fontWeight: 800 }}>{onCB} / {rows.length}</span>
          </div>
          {Object.keys(tierCounts).length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(tierCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <span key={t} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: `${tierColors[t] || 'var(--mc-text-4)'}22`, color: tierColors[t] || 'var(--mc-text-3)' }}>{t} · {n}</span>
              ))}
            </div>
          ) : <div style={{ fontSize: 11.5, color: 'var(--mc-text-4)', marginBottom: 10 }}>None of your holdings are on the Conviction Beats bench yet.</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--mc-text-3)' }}>Avg quality score</span>
            <span style={{ color: avgScore != null ? (avgScore >= 70 ? 'var(--mc-bullish)' : avgScore >= 50 ? 'var(--mc-warn)' : 'var(--mc-bearish)') : 'var(--mc-text-4)', fontWeight: 800 }}>{avgScore != null ? avgScore.toFixed(0) : '—'} <span style={{ color: 'var(--mc-text-4)', fontWeight: 600, fontSize: 11 }}>({scored.length} scored)</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [intelligence, setIntelligence] = useState<Map<string, Signal>>(new Map());
  // PATCH 0445 BUG-021 — Per-symbol RRG trend label cache (LEADING /
  // IMPROVING / WEAKENING / LAGGING) from the new /api/portfolio/trend
  // endpoint. Hydrates the TREND column when the intelligence service
  // doesn't carry sectorTrend (the common case for portfolio holdings).
  const [trendMap, setTrendMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [sortField, setSortField] = useState<SortField>('weight');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewTab, setViewTab] = useState<'holdings' | 'analytics' | 'fundamentals'>('holdings'); // PATCH 1100
  const [capFilter, setCapFilter] = useState<'all' | 'large' | 'mid' | 'small' | 'micro'>('all'); // PATCH 1100
  const [capMap, setCapMap] = useState<Record<string, string>>({}); // PATCH 1101 — ticker -> cap (Large/Mid/Small/Micro)

  // Init: load from API, fallback to localStorage
  useEffect(() => {
    const init = async () => {
      // PATCH 0716 — 8s timeout + safe JSON parse + shape guards.
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8_000);
        let res: Response;
        try { res = await fetch(`/api/portfolio?chatId=${CHAT_ID}`, { signal: ctl.signal }); }
        finally { clearTimeout(timer); }
        if (res.ok) {
          let data: any = {};
          try { data = await res.json(); } catch { data = {}; }
          if (Array.isArray(data?.holdings) && data.holdings.length > 0) {
            setHoldings(data.holdings);
            setStoredHoldings(data.holdings);
            return;
          }
        }
      } catch (e) { console.error('Portfolio API fetch failed:', e); }
      setHoldings(getStoredHoldings());
    };
    init();
  }, []);

  // Fetch live quotes — bulk first, then individual for missing
  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    setFetchError(null);
    try {
      const bulkQuotes = await fetchStockQuotes();
      const bulkTickers = new Set(bulkQuotes.map(q => q.ticker));
      const holdingSymbols = holdings.map(h => h.symbol);
      // PATCH zzz90 (EO5) — also fall back when bulk HAS ticker but price <= 0
      // (handles the case where /api/market/quotes?market=india aborted under cold-build
      // and Promise.allSettled kept the US-only success bucket → all 17 IN holdings missing prices)
      const bulkByTicker = new Map(bulkQuotes.map((q: any) => [String(q.ticker).toUpperCase(), q]));
      const missing = holdingSymbols.filter((s: string) => {
        const q = bulkByTicker.get(s.toUpperCase()) || bulkByTicker.get(normalizeTicker(s).toUpperCase());
        return !q || !(Number(q.price) > 0);
      });

      let allQuotes = bulkQuotes;
      if (missing.length > 0) {
        // PATCH zzz92 — when bulk had many holdings missing, retry bulk India ONCE
        // before falling to per-symbol (per-symbol can't handle batches reliably).
        if (missing.length >= 5) {
          try {
            const retryRes = await fetch(`/api/market/quotes?market=india&_=${Date.now()}`, {
              signal: AbortSignal.timeout(60_000)
            });
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const retryStocks = Array.isArray(retryData?.stocks) ? retryData.stocks : [];
              console.log(`[portfolio] zzz92 retry bulk India returned ${retryStocks.length} stocks`);
              if (retryStocks.length > 0) {
                const mapped = retryStocks.map((s: any) => ({
                  ticker: s.ticker, company: s.company || s.ticker, sector: s.sector || '—',
                  industry: s.industry || '—', price: s.price || 0, change: s.change || 0,
                  changePercent: s.changePercent || 0, dayHigh: s.dayHigh || s.price || 0,
                  dayLow: s.dayLow || s.price || 0,
                  indexGroup: s.indexGroup || s.cap || '', marketCap: s.marketCap || 0,
                }));
                // Merge unique by ticker
                const seen = new Set(bulkQuotes.map(q => q.ticker.toUpperCase()));
                for (const q of mapped) {
                  if (!seen.has(q.ticker.toUpperCase()) && (Number(q.price) || 0) > 0) {
                    bulkQuotes.push(q);
                    seen.add(q.ticker.toUpperCase());
                  }
                }
                // Recompute missing after retry
                const bulkByTicker2 = new Map(bulkQuotes.map((q: any) => [String(q.ticker).toUpperCase(), q]));
                const stillMissing = missing.filter((s: string) => {
                  const q = bulkByTicker2.get(s.toUpperCase()) || bulkByTicker2.get(normalizeTicker(s).toUpperCase());
                  return !q || !(Number(q.price) > 0);
                });
                missing.length = 0;
                missing.push(...stillMissing);
                console.log(`[portfolio] zzz92 after retry, still missing: ${missing.length}`);
              }
            }
          } catch (e) {
            console.warn('[portfolio] zzz92 retry bulk failed:', e);
          }
        }
        if (missing.length > 0) {
          const individual = await fetchIndividualQuotes(missing);
          allQuotes = [...bulkQuotes, ...individual];
        } else {
          allQuotes = bulkQuotes;
        }
      }

      setQuotes(allQuotes);

      // Fetch intelligence signals
      // PATCH 0465 — 15s timeout so a slow intelligence pipeline doesn't
      // block the whole portfolio refresh loop.
      try {
        const intelCtl = new AbortController();
        const intelTimer = setTimeout(() => intelCtl.abort(), 15_000);
        let intelRes: Response;
        try {
          intelRes = await fetch('/api/market/intelligence?days=90', { signal: intelCtl.signal });
        } finally { clearTimeout(intelTimer); }
        if (intelRes.ok) {
          const intelData = await intelRes.json();
          const signalMap = new Map<string, Signal>();
          if (intelData.signals && Array.isArray(intelData.signals)) {
            // Build map from first/highest-scored signal per symbol
            for (const signal of intelData.signals) {
              if (!signalMap.has(signal.symbol)) {
                signalMap.set(signal.symbol, signal);
              }
            }
          }
          setIntelligence(signalMap);
        }
      } catch (e) { console.error('Intelligence fetch failed:', e); }

      // PATCH 0445 BUG-021 — fetch RRG trend labels in parallel.
      // PATCH 0465 — bounded with 15s timeout (trend endpoint can be slow).
      try {
        const syms = holdings.map(h => h.symbol).filter(Boolean);
        if (syms.length > 0) {
          const trendCtl = new AbortController();
          const trendTimer = setTimeout(() => trendCtl.abort(), 15_000);
          let trendRes: Response;
          try {
            trendRes = await fetch(`/api/portfolio/trend?symbols=${syms.join(',')}`, { signal: trendCtl.signal });
          } finally { clearTimeout(trendTimer); }
          if (trendRes.ok) {
            const j = await trendRes.json();
            const m = new Map<string, string>();
            for (const r of (j.rows || [])) {
              if (r?.ticker && r?.label) m.set(String(r.ticker).toUpperCase(), r.label);
            }
            setTrendMap(m);
          }
        }
      } catch (e) { console.error('Trend fetch failed:', e); }

      setLastRefresh(new Date());
      setLoading(false);
    } catch (e: any) {
      setLoading(false);
      // PATCH 0965 BUG #1 — distinguish malformed payload from network/timeout
      // so the banner tells the user WHY the fetch failed. The fetchStockQuotes
      // helper now throws (rather than silently returning []) so this branch
      // actually runs when the quote feed is broken.
      const stamp = new Date().toLocaleTimeString();
      if (e?.name === 'QuotesShapeError') {
        setFetchError(`Price data malformed — check console for /api/market/quotes payload (last attempt ${stamp}).`);
      } else if (e?.name === 'TimeoutError' || /abort|timeout/i.test(String(e?.message || ''))) {
        setFetchError(`Price data unavailable — fetch timed out after 45s (last attempt ${stamp}). Click Retry.`);
      } else {
        setFetchError(`Price data unavailable — last attempt failed at ${stamp}. ${e?.message ? `(${e.message})` : ''} Click Retry.`);
      }
      // PATCH 0435 BUG-032 — Always stamp lastRefresh even on error so the
      // header shows "Last refreshed: HH:MM:SS" instead of permanent "—".
      // Indicates last attempt time, not last successful fetch.
      setLastRefresh(new Date());
    }
    finally { setIsRefreshing(false); }
  }, [holdings]);

  useEffect(() => { if (holdings.length > 0) fetchData(); else setLoading(false); }, [holdings, fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (holdings.length === 0) return;
    // AUDIT_100 #7 — skip poll when tab is hidden
    const i = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchData();
    }, 60000);
    return () => clearInterval(i);
  }, [holdings.length, fetchData]);

  // PATCH 0446 BUG-053 — Belt-and-braces auto-fetch on mount + a backup
  // poll after 2.5s. The primary useEffect above re-derives fetchData when
  // holdings change which sometimes left a window where the first quote
  // fetch never fired (Strict Mode double-mount + dep churn). This guarantees
  // the user lands on the Portfolio page and prices appear without having
  // to click Refresh.
  useEffect(() => {
    const t1 = setTimeout(() => {
      if (holdings.length > 0 && !lastRefresh) {
        fetchData();
      }
    }, 200);
    const t2 = setTimeout(() => {
      if (holdings.length > 0 && !lastRefresh) {
        fetchData();
      }
    }, 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.length]);

  // Sync holdings to API
  const syncToAPI = useCallback((h: PortfolioHolding[]) => {
    setStoredHoldings(h);
    fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, secret: BOT_SECRET, action: 'set', holdings: h }),
    }).then(r => { if (!r.ok) console.error('Portfolio sync failed'); }).catch(console.error);
  }, []);

  // PATCH 0446 BUG-021 v2 — Predicate used inside the row mapper to gate
  // the intraday-tone fallback for the TREND column. Lives above the
  // memoization block so we don't re-declare it 43 times per render.
  const hasQuoteFor = (cp: number) => typeof cp === 'number' && Number.isFinite(cp) && cp !== 0;

  // Build portfolio rows with P&L and intelligence
  const rows = useMemo((): PortfolioRow[] => {
    // First pass: compute currentValue for each holding
    const rawRows = holdings.map(h => {
      // PATCH 0690 — case-insensitive ticker lookup. h.symbol stored as
      // typed by user (sometimes lowercase / with prefix); quotes API
      // always returns upper-case bare symbols. Normalize both sides.
      const normalized = normalizeTicker(h.symbol);
      const upperSym = String(h.symbol || '').toUpperCase();
      const upperNorm = String(normalized || '').toUpperCase();
      const quote = quotes.find(q => {
        const qt = String(q.ticker || '').toUpperCase();
        return qt === upperSym || qt === upperNorm;
      });
      const cmp = quote?.price || 0;
      const change = quote?.change || 0;
      const changePercent = quote?.changePercent || 0;
      const investedValue = h.entryPrice * h.quantity;
      const currentValue = cmp > 0 ? cmp * h.quantity : investedValue; // fallback to invested if no live price
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
      // Correct: day P&L = (changePercent/100) × current_market_value
      // Old formula (change × qty) was wrong: absolute price change varies across stocks
      const dayPnl = cmp > 0 ? (changePercent / 100) * currentValue : 0;
      const signal = intelligence.get(h.symbol) || intelligence.get(normalized);
      // PATCH 0437 BUG-021 — fallback Score from Multibagger localStorage when
      // intelligence signal is missing. Reads mb_excel_scored_v2 (India) and
      // mb_usa_scored_v1 (USA) caches. Same wire-up logic as Conviction Beats.
      let fallbackScore: number | undefined = undefined;
      let fallbackDecision: string | undefined = undefined;
      if (signal?.weightedScore === undefined && typeof window !== 'undefined') {
        try {
          const ind = JSON.parse(window.localStorage.getItem('mb_excel_scored_v2') || '[]');
          const usa = JSON.parse(window.localStorage.getItem('mb_usa_scored_v1') || '[]');
          const found = [...ind, ...usa].find((r: any) => (r.symbol || '').toUpperCase() === (h.symbol || '').toUpperCase());
          if (found) {
            fallbackScore = found.composite ?? found.score;
            fallbackDecision = found.grade === 'A+' || found.grade === 'A' ? 'BUY'
                            : found.grade === 'B+' || found.grade === 'B' ? 'WATCH'
                            : found.grade === 'C+' || found.grade === 'C' ? 'NEUTRAL'
                            : found.grade === 'D' ? 'AVOID' : undefined;
          }
        } catch {}
      }
      // PATCH 0445 BUG-021 — Fall back to the RRG trend label when the
      // intelligence service didn't supply sectorTrend. Map LEADING /
      // IMPROVING / WEAKENING / LAGGING into Bullish / Neutral / Bearish
      // tones so the existing badge colors still work.
      const rrgRaw = trendMap.get(h.symbol.toUpperCase());
      const rrgTone = rrgRaw === 'LEADING' ? 'Bullish'
                    : rrgRaw === 'IMPROVING' ? 'Bullish'
                    : rrgRaw === 'WEAKENING' ? 'Neutral'
                    : rrgRaw === 'LAGGING' ? 'Bearish'
                    : undefined;
      // PATCH 0446 BUG-021 v2 — Last-resort fallback: classify by today's
      // changePercent vs market when neither intelligence nor RRG produced a
      // signal. Yahoo's /chart endpoint often rate-limits for India .NS
      // tickers so the trend endpoint can return UNKNOWN for hours. This
      // ensures the TREND column never permanently shows '—' for an active
      // holding — at minimum it reflects today's price move.
      const intradayTone = !rrgTone && hasQuoteFor(changePercent)
        ? changePercent > 1.5 ? 'Bullish'
        : changePercent < -1.5 ? 'Bearish'
        : 'Neutral'
        : undefined;
      // PATCH 0569 (UX #3) — Final price-based trend fallback. When the
      // intelligence signal, RRG endpoint, and intraday quote are all
      // missing (e.g. weekend, frozen ticker, rate-limited Yahoo chart),
      // use the holding's own price history vs the entry price as a
      // direction proxy. This keeps the TREND column from ever showing
      // '—' for an active, fully-priced position. A proper 50DMA would
      // be nicer but requires a new API surface; cmp vs entry uses data
      // we already have on every row.
      const positionTone = !signal?.sectorTrend && !rrgTone && !intradayTone
        && cmp > 0 && h.entryPrice > 0
        ? cmp > h.entryPrice * 1.05 ? 'Bullish'
        : cmp < h.entryPrice * 0.95 ? 'Bearish'
        : 'Neutral'
        : undefined;
      return { symbol: h.symbol, company: quote?.company || h.symbol, sector: quote?.sector || '—',
        entryPrice: h.entryPrice, quantity: h.quantity, cmp, change, changePercent,
        investedValue, currentValue, pnl, pnlPercent, dayPnl, notes: h.notes, weight: 0,
        score: signal?.weightedScore ?? fallbackScore,
        sectorTrend: signal?.sectorTrend ?? rrgTone ?? intradayTone ?? positionTone,
        decision: signal?.action ?? fallbackDecision,
        cap: capMap[upperSym] || capMap[upperNorm] || quote?.indexGroup || '', marketCap: quote?.marketCap || 0 }; // PATCH 1100/1101
    });
    // Second pass: weight by current value (proper risk weighting)
    const totalCurrent = rawRows.reduce((s, r) => s + r.currentValue, 0);
    return rawRows.map(r => ({ ...r, weight: totalCurrent > 0 ? (r.currentValue / totalCurrent) * 100 : 0 }));
  }, [holdings, quotes, intelligence, trendMap, capMap]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [rows, sortField, sortOrder]);

  // PATCH 1100 — cap normalization + cap-filtered view for the holdings table.
  const displayRows = useMemo(() => {
    if (capFilter === 'all') return sortedRows;
    return sortedRows.filter(r => normCapBucket(r.cap) === capFilter);
  }, [sortedRows, capFilter]);

  // PATCH 1101 — Market-cap is the user's #1 requirement and must never be empty.
  // The per-ticker quote endpoint that prices small/mid holdings returns NO cap,
  // so we pull cap labels from the FULL NSE universe blob (every ticker carries
  // indexGroup). The universe can be cold on first hit (returns a 49-name
  // fallback); retry a few times until it returns the full set, then build a
  // ticker -> cap map used to tag every holding regardless of how it was priced.
  useEffect(() => {
    let cancelled = false;
    // PATCH 1102 — cache the cap map locally (6h) so we DON'T re-read the ~1MB
    // universe on every portfolio open. This was driving up KV read volume.
    const CACHE_KEY = 'mc:cap-map:v1';
    const TTL_MS = 6 * 3600 * 1000;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.map && (Date.now() - (cached.ts || 0)) < TTL_MS && Object.keys(cached.map).length >= 500) {
        setCapMap(cached.map);
        return; // fresh local cache — skip the network/KV read entirely
      }
    } catch {}
    const loadCaps = async (attempt = 0) => {
      try {
        const r = await fetch(`/api/market/quotes?market=india&_=${Date.now()}`);
        const j = await r.json();
        const st: any[] = Array.isArray(j?.stocks) ? j.stocks : [];
        const withCap = st.filter(x => x && x.indexGroup);
        if (withCap.length >= 500) {
          const m: Record<string, string> = {};
          for (const x of withCap) m[String(x.ticker || '').toUpperCase()] = x.indexGroup;
          if (!cancelled) { setCapMap(m); try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), map: m })); } catch {} }
          return;
        }
      } catch { /* fall through to retry */ }
      if (attempt < 4 && !cancelled) setTimeout(() => loadCaps(attempt + 1), 4000);
    };
    loadCaps();
    return () => { cancelled = true; };
  }, []);

  // AUDIT_100 #28 — bulk CSV import. Pastes / drops a broker-export CSV with
  // columns symbol,price,quantity[,notes]. Header row is optional (auto-detect).
  // Existing holdings are averaged in; new symbols appended. Pure client-side
  // parser, no new API surface.
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportCsv = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) { toast.error('Empty file'); return; }
        // Detect header
        const first = lines[0].toLowerCase();
        const hasHeader = /symbol|ticker|qty|quantity|price/.test(first);
        const dataLines = hasHeader ? lines.slice(1) : lines;
        const parsed: PortfolioHolding[] = [];
        const skipped: string[] = [];
        for (const line of dataLines) {
          const parts = line.split(/[,\t;]/).map(p => p.trim().replace(/^"|"$/g, ''));
          if (parts.length < 3) { skipped.push(line); continue; }
          const sym = parts[0].toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '');
          const px = Number(parts[1]);
          const qty = Number(parts[2]);
          const notes = parts[3] || '';
          if (!/^[A-Z0-9&-]+$/.test(sym) || !isFinite(px) || px <= 0 || !isFinite(qty) || qty <= 0) {
            skipped.push(line); continue;
          }
          parsed.push({ symbol: sym, entryPrice: px, quantity: qty, weight: 0, addedAt: new Date().toISOString(), notes: notes || undefined });
        }
        if (parsed.length === 0) { toast.error(`No valid rows. Expected: symbol,price,quantity[,notes]`); return; }
        // Merge with existing holdings (average in)
        const byId = new Map(holdings.map(h => [h.symbol, h]));
        for (const h of parsed) {
          const ex = byId.get(h.symbol);
          if (ex) {
            const totalQty = ex.quantity + h.quantity;
            const avgPrice = ((ex.entryPrice * ex.quantity) + (h.entryPrice * h.quantity)) / totalQty;
            byId.set(h.symbol, { ...ex, entryPrice: avgPrice, quantity: totalQty });
          } else {
            byId.set(h.symbol, h);
          }
        }
        const merged = Array.from(byId.values());
        setHoldings(merged);
        syncToAPI(merged);
        toast.success(`Imported ${parsed.length} rows${skipped.length ? ` (${skipped.length} skipped)` : ''}`);
        setTimeout(fetchData, 500);
      } catch (err) {
        console.error('CSV import failed', err);
        toast.error('CSV import failed — check format');
      }
    };
    reader.readAsText(file);
  }, [holdings]);

  // Handlers
  const handleAdd = (h: PortfolioHolding) => {
    const exists = holdings.find(x => x.symbol === h.symbol);
    if (exists) {
      // Average in
      const totalQty = exists.quantity + h.quantity;
      const avgPrice = ((exists.entryPrice * exists.quantity) + (h.entryPrice * h.quantity)) / totalQty;
      const updated = holdings.map(x => x.symbol === h.symbol ? { ...x, entryPrice: avgPrice, quantity: totalQty } : x);
      setHoldings(updated);
      syncToAPI(updated);
      toast.success(`${h.symbol} averaged in — ${totalQty} shares @ ₹${avgPrice.toFixed(2)}`);
    } else {
      const updated = [...holdings, h];
      setHoldings(updated);
      syncToAPI(updated);
      toast.success(`${h.symbol} added to portfolio`);
    }
    setShowAdd(false);
    setTimeout(fetchData, 500);
  };

  const handleRemove = (symbol: string) => {
    if (!confirm(`Remove ${symbol} from portfolio? This cannot be undone.`)) return;
    const updated = holdings.filter(h => h.symbol !== symbol);
    setHoldings(updated);
    syncToAPI(updated);
    toast.success(`${symbol} removed from portfolio`);
  };

  const handleUpdateField = (symbol: string, field: 'entryPrice' | 'quantity', value: number) => {
    if (value <= 0) return;
    const updated = holdings.map(h => h.symbol === symbol ? { ...h, [field]: value } : h);
    setHoldings(updated);
    syncToAPI(updated);
    toast.success(`${symbol} ${field === 'entryPrice' ? 'entry price' : 'quantity'} updated`);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('desc'); }
  };

  const handleExportXLSX = async () => {
    if (sortedRows.length === 0) return;
    const XLSX = await import('xlsx');

    const data = sortedRows.map((r, i) => ({
      '#': i + 1,
      'Symbol': r.symbol,
      'Company': r.company,
      'Sector': r.sector,
      'Entry Price': r.entryPrice,
      'Qty': r.quantity,
      'Weight %': parseFloat(r.weight.toFixed(1)),
      'CMP': r.cmp,
      'Day Change %': parseFloat(r.changePercent.toFixed(2)),
      'Invested': Math.round(r.investedValue),
      'Current Value': Math.round(r.currentValue),
      'P&L': Math.round(r.pnl),
      'P&L %': parseFloat(r.pnlPercent.toFixed(2)),
      'Score': r.score !== undefined ? parseFloat(r.score.toFixed(0)) : '',
      'Trend': r.sectorTrend || '',
      'Decision': r.decision || '',
    }));

    // Add summary row
    const totalInvested = sortedRows.reduce((s, r) => s + r.investedValue, 0);
    const totalCurrent = sortedRows.reduce((s, r) => s + r.currentValue, 0);
    const totalPnl = totalCurrent - totalInvested;
    data.push({
      '#': 0, 'Symbol': '', 'Company': 'TOTAL', 'Sector': '',
      'Entry Price': 0, 'Qty': 0, 'Weight %': 100,
      'CMP': 0, 'Day Change %': 0,
      'Invested': Math.round(totalInvested),
      'Current Value': Math.round(totalCurrent),
      'P&L': Math.round(totalPnl),
      'P&L %': totalInvested > 0 ? parseFloat(((totalPnl / totalInvested) * 100).toFixed(2)) : 0,
      'Score': '', 'Trend': '', 'Decision': '',
    });

    const ws = XLSX.utils.json_to_sheet(data);
    // Column widths
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 16 },
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 12 },
      { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
      { wch: 8 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio');
    XLSX.writeFile(wb, `portfolio_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Exported portfolio to XLSX');
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown style={{ width: '10px', height: '10px', opacity: 0.4 }} />;
    return sortOrder === 'asc' ? <TrendingUp style={{ width: '10px', height: '10px' }} /> : <TrendingDown style={{ width: '10px', height: '10px' }} />;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-text-0)', margin: 0 }}>Portfolio</h1>
            {/* PATCH 0300 — Quote freshness chip from existing lastRefresh state. */}
            <PanelFreshness
              dataUpdatedAt={lastRefresh ? lastRefresh.getTime() : 0}
              isFetching={isRefreshing}
              staleAfterMs={5 * 60_000}
              label="quotes"
            />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: '4px 0 0' }}>Active holdings · Capital deployed · P&L tracking</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setShowAdd(!showAdd)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: 'var(--mc-bullish)', border: 'none', borderRadius: '10px',
            padding: '10px 16px', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
          }}>
            <Plus style={{ width: '14px', height: '14px' }} /> Add Holding
          </button>
          {/* AUDIT_100 #28 — bulk CSV import. Pastes a broker-export CSV. */}
          <button
            onClick={() => importInputRef.current?.click()}
            title="Import a CSV: symbol,price,quantity[,notes]"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px',
              padding: '10px 14px', color: 'var(--mc-text-3)', cursor: 'pointer',
              fontSize: '13px', fontWeight: '600',
            }}
          >
            <Upload style={{ width: '14px', height: '14px' }} /> Import CSV
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportCsv(f);
              if (importInputRef.current) importInputRef.current.value = '';
            }}
          />
          <button onClick={fetchData} disabled={isRefreshing} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px',
            padding: '10px 14px', color: 'var(--mc-text-3)', cursor: isRefreshing ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '600', opacity: isRefreshing ? 0.6 : 1,
          }}>
            <RefreshCw style={{ width: '14px', height: '14px' }} /> Refresh
          </button>
          <button onClick={handleExportXLSX} disabled={sortedRows.length === 0} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px',
            padding: '10px 14px', color: 'var(--mc-text-3)', cursor: sortedRows.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '600', opacity: sortedRows.length === 0 ? 0.4 : 1,
          }}>
            <Download style={{ width: '14px', height: '14px' }} /> Export
          </button>
        </div>
      </div>

      {/* ── Add Form ────────────────────────────────────────────────── */}
      {showAdd && <AddHoldingForm onAdd={handleAdd} onCancel={() => setShowAdd(false)} quotes={quotes} />}

      {/* ── Summary ─────────────────────────────────────────────────── */}
      <PortfolioSummary rows={sortedRows} holdings={holdings} />

      {/* PATCH 1100 — view tabs + market-cap filter */}
      {!loading && holdings.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '8px 0 14px' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)', borderRadius: 10, padding: 4 }}>
            {(['holdings', 'analytics', 'fundamentals'] as const).map(t => (
              <button key={t} onClick={() => setViewTab(t)} style={{
                padding: '7px 16px', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, letterSpacing: '0.3px',
                background: viewTab === t ? '#1D4ED8' : 'transparent', color: viewTab === t ? '#fff' : 'var(--mc-text-3)',
              }}>{t === 'holdings' ? '\ud83d\udc0b Holdings' : t === 'analytics' ? '\ud83d\udcca Analytics' : 'Fundamentals'}</button>
            ))}
          
          </div>
          {viewTab === 'holdings' && holdings.length > 0 && (<div style={{ marginBottom: 12 }}><TickerExportToolbar tickers={displayRows.map((r) => r.symbol)} /></div>)}
              {viewTab === 'holdings' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 800, letterSpacing: '0.5px' }}>MKT CAP</span>
              {([['all', 'All'], ['large', 'Large'], ['mid', 'Mid'], ['small', 'Small'], ['micro', 'Micro']] as const).map(([k, lbl]) => {
                const cnt = k === 'all' ? sortedRows.length : sortedRows.filter(r => normCapBucket(r.cap) === k).length;
                const active = capFilter === k;
                const col = CAP_COLORS[k] || '#8BA3C1';
                return (
                  <button key={k} onClick={() => setCapFilter(k)} style={{
                    padding: '5px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                    border: `1px solid ${active ? col : 'var(--mc-border-2)'}`, background: active ? `${col}22` : 'transparent', color: active ? col : 'var(--mc-text-3)',
                  }}>{lbl} <span style={{ opacity: 0.7, fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>{cnt}</span></button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PATCH 1100 — Analytics view */}
      {!loading && holdings.length > 0 && viewTab === 'fundamentals' && <FundamentalsAnalyzerPage scope="portfolio" />}
        {!loading && holdings.length > 0 && viewTab === 'analytics' && (
        <PortfolioAnalytics rows={sortedRows} onSelectCap={(c) => { setCapFilter(c as any); setViewTab('holdings'); }} />
      )}

      {/* ── Fetch error banner ──────────────────────────────────────── */}
      {fetchError && !loading && (
        <div style={{ backgroundColor: '#1A1212', border: '1px solid #7F1D1D', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#FCA5A5' }}>⚠ {fetchError}</span>
          <button onClick={() => { setFetchError(null); fetchData(); }} style={{ padding: '5px 12px', borderRadius: '5px', border: '1px solid #7F1D1D', backgroundColor: '#7F1D1D30', color: '#FCA5A5', cursor: 'pointer', fontSize: '11px', fontWeight: '700', flexShrink: 0 }}>
            ↻ Retry
          </button>
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────── */}
      {loading && holdings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ height: '44px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px', animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px' }}>
              <div style={{ width: '60px', height: '14px', backgroundColor: 'var(--mc-border-2)', borderRadius: '4px' }} />
              <div style={{ flex: 1, height: '10px', backgroundColor: 'var(--mc-border-2)', borderRadius: '4px' }} />
              <div style={{ width: '50px', height: '14px', backgroundColor: 'var(--mc-border-2)', borderRadius: '4px' }} />
              <div style={{ width: '50px', height: '14px', backgroundColor: 'var(--mc-border-2)', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────── */}
      {!loading && holdings.length > 0 && viewTab === 'holdings' && (
        <>
          <div style={{ marginBottom: '12px' }}>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>
              {displayRows.length}{capFilter !== 'all' ? ` of ${sortedRows.length}` : ''}{displayRows.length === 1 && capFilter === 'all' ? ' holding' : ' holdings'} · Last refreshed: {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
            </p>
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--mc-border-2)', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--mc-border-2)', backgroundColor: 'var(--mc-bg-1)' }}>
                  {[
                    { key: 'symbol' as SortField, label: 'SYMBOL', align: 'left' },
                    { key: 'company' as SortField, label: 'COMPANY', align: 'left' },
                    { key: 'sector' as SortField, label: 'SECTOR', align: 'left' },
                    { key: 'symbol' as SortField, label: 'MKT CAP', align: 'left', noSort: true },
                    { key: 'cmp' as SortField, label: 'CMP (₹)', align: 'right' },
                    { key: 'entryPrice' as SortField, label: 'ENTRY (₹)', align: 'right' },
                    { key: 'quantity' as SortField, label: 'QTY', align: 'right' },
                    { key: 'weight' as SortField, label: 'WEIGHT%', align: 'right' },
                    { key: 'investedValue' as SortField, label: 'INVESTED', align: 'right' },
                    { key: 'currentValue' as SortField, label: 'CURRENT', align: 'right' },
                    { key: 'pnlPercent' as SortField, label: 'P&L', align: 'right' },
                    { key: 'score' as SortField, label: 'SCORE', align: 'right' },
                    { key: 'symbol' as SortField, label: 'TREND', align: 'right', noSort: true },
                    { key: 'decision' as SortField, label: 'DECISION', align: 'right' },
                    { key: 'changePercent' as SortField, label: 'DAY%', align: 'right' },
                    { key: 'symbol' as SortField, label: '', align: 'right', noSort: true },
                  ].map((col, i) => (
                    // AUDIT_100 #8 — stable composite key on table headers.
                    <th key={`${col.key}|${col.label}|${i}`} onClick={() => !col.noSort && handleSort(col.key)} style={{
                      padding: '10px 12px', textAlign: col.align as any, fontSize: '10px', fontWeight: '700',
                      color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: col.noSort ? 'default' : 'pointer', whiteSpace: 'nowrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start', gap: '4px' }}>
                        {col.label} {!col.noSort && <SortIcon field={col.key} />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, idx) => {
                  const pnlColor = r.pnl >= 0 ? '#10B981' : '#EF4444';
                  // BUG-03 fix: null/undefined changePercent should be neutral grey, not green/red
                  const hasQuote = r.cmp > 0 && r.changePercent != null;
                  const dayColor = hasQuote ? (r.changePercent >= 0 ? '#10B981' : '#EF4444') : '#64748B';
                  /*
                   * PATCH 0965 BUG #1 — per-row STALE indicator.
                   * Quotes are fetched in one bulk request per refresh cycle,
                   * so per-row freshness is derived from the page-level
                   * lastRefresh stamp. If the row HAS a price but the last
                   * successful refresh was > 5 min ago, we annotate the
                   * CMP cell with a small "STALE" badge. Rows without a
                   * quote keep their existing "N/A" treatment.
                   */
                  const isStale = hasQuote && lastRefresh
                    ? (Date.now() - lastRefresh.getTime()) > 5 * 60_000
                    : false;
                  return (
                    <tr key={r.symbol} style={{ borderBottom: idx < displayRows.length - 1 ? '1px solid var(--mc-bg-2)' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--mc-info)', fontWeight: '700' }}>{r.symbol}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--mc-text-0)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--mc-text-3)', fontSize: '11px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sector}</td>
                      <td style={{ padding: '10px 12px' }}>{capBadge(r.cap)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.cmp > 0 ? (
                          <span>
                            ₹{r.cmp.toFixed(2)}
                            {/* PATCH 0965 BUG #1 — per-row STALE badge when last refresh > 5min ago. */}
                            {isStale && (
                              <span
                                title={`Price last refreshed ${lastRefresh?.toLocaleTimeString()} (> 5 min ago)`}
                                style={{ marginLeft: 6, display: 'inline-block', padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, backgroundColor: 'rgba(251,191,36,0.15)', color: 'var(--mc-warn)', letterSpacing: 0.4 }}
                              >STALE</span>
                            )}
                          </span>
                        ) : (
                          <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', backgroundColor: 'rgba(251,191,36,0.1)', color: 'var(--mc-warn)' }}>
                            N/A
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                        <EditableCell value={r.entryPrice} onSave={v => handleUpdateField(r.symbol, 'entryPrice', v)} />
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                        <EditableCell value={r.quantity} onSave={v => handleUpdateField(r.symbol, 'quantity', v)} type="qty" />
                      </td>
                      {/* PATCH 0455 TIER1-D — Rebalancing overlay. Read
                          Multibagger USA suggestedMaxPositionPct from LS;
                          if current weight > 2× recommended, flag the cell
                          red. Use 2x as 'overweight' threshold. */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {(() => {
                          const sym = r.symbol.toUpperCase();
                          let recommendedMax: number | undefined;
                          try {
                            const raw = typeof window !== 'undefined' ? localStorage.getItem('mb_usa_scored_v1') : null;
                            if (raw) {
                              const rows = JSON.parse(raw);
                              if (Array.isArray(rows)) {
                                const hit = rows.find((x: any) => String(x?.symbol || x?.ticker || '').toUpperCase() === sym);
                                if (hit && typeof hit.suggestedMaxPositionPct === 'number') recommendedMax = hit.suggestedMaxPositionPct;
                              }
                            }
                            // India side: derive from market-cap-bucket heuristic if available.
                            if (recommendedMax === undefined) {
                              const inRaw = typeof window !== 'undefined' ? localStorage.getItem('mb_excel_scored_v2') : null;
                              if (inRaw) {
                                const rows = JSON.parse(inRaw);
                                if (Array.isArray(rows)) {
                                  const hit = rows.find((x: any) => String(x?.symbol || x?.ticker || '').toUpperCase() === sym);
                                  const mcapCr: number | undefined = hit?.marketCapCr;
                                  if (typeof mcapCr === 'number' && mcapCr > 0) {
                                    // India tiered position sizing: <500cr → 1%, <2000cr → 2.5%,
                                    // <10000cr → 5%, <50000cr → 8%, else 15%.
                                    recommendedMax = mcapCr < 500 ? 1
                                      : mcapCr < 2000 ? 2.5
                                      : mcapCr < 10000 ? 5
                                      : mcapCr < 50000 ? 8 : 15;
                                  }
                                }
                              }
                            }
                          } catch {}
                          if (recommendedMax === undefined) {
                            return <span style={{ color: 'var(--mc-text-3)' }}>{r.weight.toFixed(1)}%</span>;
                          }
                          const overweight = r.weight > recommendedMax * 2;
                          const warn = r.weight > recommendedMax && !overweight;
                          const color = overweight ? '#EF4444' : warn ? '#F59E0B' : '#10B981';
                          return (
                            <div title={`Recommended max ${recommendedMax}% (per Multibagger sizing). You're at ${r.weight.toFixed(1)}%.`}
                              style={{ color }}>
                              {r.weight.toFixed(1)}%
                              <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 600 }}>
                                {overweight ? `⚠ ${(r.weight / recommendedMax).toFixed(1)}× max` : warn ? `⚠ over ${recommendedMax}%` : `✓ ≤ ${recommendedMax}%`}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mc-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(r.investedValue)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mc-text-0)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.cmp > 0 ? fmt(r.currentValue) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.cmp > 0 ? (
                          <div>
                            <span style={{ color: pnlColor, fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>
                              {r.pnl >= 0 ? '+' : '-'}{fmt(Math.abs(r.pnl))}
                            </span>
                            <div style={{ fontSize: '10px', color: pnlColor, fontVariantNumeric: 'tabular-nums' }}>
                              {fmtPct(r.pnlPercent)}
                            </div>
                          </div>
                        ) : '—'}
                      </td>
                      {/* Score */}
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.score !== undefined ? (
                          <span style={{
                            display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            backgroundColor: r.score >= 70 ? 'rgba(16,185,129,0.1)' : r.score >= 40 ? 'rgba(251,191,36,0.1)' : 'rgba(100,116,139,0.1)',
                            color: r.score >= 70 ? 'var(--mc-bullish)' : r.score >= 40 ? 'var(--mc-warn)' : 'var(--mc-text-4)',
                            fontVariantNumeric: 'tabular-nums',
                          }}>
                            {r.score.toFixed(0)}
                          </span>
                        ) : '—'}
                      </td>
                      {/* Trend */}
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.sectorTrend ? (
                          <span style={{
                            display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            backgroundColor: r.sectorTrend === 'Bullish' ? 'rgba(16,185,129,0.1)' : r.sectorTrend === 'Bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(251,191,36,0.1)',
                            color: r.sectorTrend === 'Bullish' ? 'var(--mc-bullish)' : r.sectorTrend === 'Bearish' ? 'var(--mc-bearish)' : 'var(--mc-warn)',
                          }}>
                            {r.sectorTrend}
                          </span>
                        ) : '—'}
                      </td>
                      {/* Decision */}
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {r.decision ? (
                          <span style={{
                            display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            backgroundColor: r.decision === 'BUY' ? 'rgba(16,185,129,0.15)' : r.decision === 'ADD' ? 'rgba(5,150,105,0.15)' : r.decision === 'HOLD' ? 'rgba(251,191,36,0.15)' : r.decision === 'TRIM' ? 'rgba(249,115,22,0.15)' : r.decision === 'EXIT' ? 'rgba(239,68,68,0.15)' : 'rgba(100,116,139,0.15)',
                            color: r.decision === 'BUY' ? 'var(--mc-bullish)' : r.decision === 'ADD' ? '#059669' : r.decision === 'HOLD' ? 'var(--mc-warn)' : r.decision === 'TRIM' ? 'var(--mc-warn)' : r.decision === 'EXIT' ? 'var(--mc-bearish)' : 'var(--mc-text-4)',
                          }}>
                            {r.decision}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                          backgroundColor: hasQuote
                            ? (r.changePercent >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)')
                            : 'rgba(100,116,139,0.1)',
                          color: dayColor, fontVariantNumeric: 'tabular-nums',
                        }}
                        title={!hasQuote ? 'Quote unavailable' : undefined}>
                          {hasQuote ? fmtPct(r.changePercent) : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <button onClick={() => handleRemove(r.symbol)} title="Remove from portfolio"
                          style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#EF4444'; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#4A5B6C'; }}>
                          <Trash2 style={{ width: '14px', height: '14px' }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Empty State ─────────────────────────────────────────────── */}
      {!loading && holdings.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💼</div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 8px' }}>Your portfolio is empty</h2>
          <p style={{ fontSize: '14px', color: 'var(--mc-text-3)', margin: '0 0 24px' }}>Add your holdings with entry price and quantity to track P&L in real-time.</p>
          <button onClick={() => setShowAdd(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            backgroundColor: 'var(--mc-bullish)', border: 'none', borderRadius: '10px',
            padding: '12px 24px', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600',
          }}>
            <Plus style={{ width: '16px', height: '16px' }} /> Add Your First Holding
          </button>
        </div>
      )}

      {/* ── Sync Info ───────────────────────────────────────────────── */}
      {holdings.length > 0 && (
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>
            💼 Portfolio synced to your account · Entry price & quantity are editable inline (click to edit)
          </p>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}
