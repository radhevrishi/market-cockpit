// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { normalizeTicker } from '@/lib/tickers';
import { bookTotals } from '@/lib/book-totals';
import { STORAGE_KEY, CASH_POSITIONS_KEY, REGIME_PHASES_PF } from './constants';
import { type PortfolioHolding, type StockQuote, type PortfolioRow, type CashPosition, type RegimeBucket } from './types';

/* ── Helpers ───────────────────────────────────────────────────────── */

export const getStoredHoldings = (): PortfolioHolding[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
};

export const setStoredHoldings = (h: PortfolioHolding[]) => {
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
export class QuotesShapeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'QuotesShapeError'; }
}

// AUDIT_100 #3 — fetch BOTH India + US bulk feeds and merge.
// Users hold mixed portfolios (NVDA + RELIANCE in one watchlist).
// Previously only India quotes were fetched → US holdings showed cmp=0.
export const fetchStockQuotes = async (): Promise<StockQuote[]> => {
  const mapQuote = (s: any): StockQuote => ({
    ticker: s.ticker, company: s.company || s.ticker, sector: s.sector || '—',
    industry: s.industry || '—', price: s.price || 0, change: s.change || 0,
    changePercent: s.changePercent || 0, dayHigh: s.dayHigh || s.price || 0,
    dayLow: s.dayLow || s.price || 0,
    indexGroup: s.indexGroup || s.cap || '', marketCap: s.marketCap || 0, // PATCH 1100
  });
  const fetchOne = async (market: 'india' | 'us'): Promise<StockQuote[]> => {
    // PATCH zzz100 — Retry-on-timeout. Bulk India API responds in <1s normally
    // but Railway cold-starts can spike to 30s+. Strategy: 20s primary attempt,
    // 25s retry, then surrender. Catches transient slowness without making
    // the user wait the full 60s before seeing data.
    const tryOnce = async (timeoutMs: number) =>
      fetch(`/api/market/quotes?market=${market}`, { signal: AbortSignal.timeout(timeoutMs) });
    let res: Response;
    try {
      res = await tryOnce(20_000);
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || /abort|timeout/i.test(String(e?.message || ''))) {
        console.warn(`[portfolio] zzz100 ${market} primary 20s timed out, retrying with 25s`);
        res = await tryOnce(25_000);
      } else { throw e; }
    }
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

export const fetchIndividualQuotes = async (symbols: string[]): Promise<StockQuote[]> => {
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

export const fmt = (n: number) => n >= 10000000 ? `₹${(n / 10000000).toFixed(2)} Cr` : n >= 100000 ? `₹${(n / 100000).toFixed(2)} L` : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

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
export function computePortfolioCagr(rows: PortfolioRow[], holdings: PortfolioHolding[]):
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

  // zzz898 — only priced holdings: an unpriced one has no current value (never valued at cost)
  const bt = bookTotals(rows);
  const totalCurrent = bt.current;
  const totalInv = bt.pricedInvested;
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
export function topSector(rows: PortfolioRow[]): { sector: string; pct: number; mappedPct: number } | null {
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

export const loadCashPositions = (): CashPosition[] => {
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

export const saveCashPositions = (positions: CashPosition[]): void => {
  try { localStorage.setItem(CASH_POSITIONS_KEY, JSON.stringify(positions)); } catch {}
};

export function normCapBucket(c?: string): 'large' | 'mid' | 'small' | 'micro' | 'other' {
  const x = (c || '').toLowerCase();
  if (x === 'large') return 'large';
  if (x === 'mid') return 'mid';
  if (x === 'small') return 'small';
  if (x === 'micro') return 'micro';
  return 'other';
}

export function classifyRegime(sector: string, phase: typeof REGIME_PHASES_PF[number]): RegimeBucket {
  const s = (sector || '').toLowerCase();
  if (!s || s === '—' || s === 'unknown') return 'NEUTRAL';
  const hitAvoid = phase.avoid.some(k => s.includes(k));
  const hitOwn = phase.own.some(k => s.includes(k));
  if (hitAvoid && !hitOwn) return 'EXPOSED';
  if (hitOwn && !hitAvoid) return 'FAVORED';
  if (hitOwn && hitAvoid) return 'NEUTRAL'; // ambiguous — count as neutral
  return 'NEUTRAL';
}
