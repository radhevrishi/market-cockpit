'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown, RefreshCw, Download, Upload, ArrowUpDown, Edit3 } from 'lucide-react';
import toast from 'react-hot-toast';
import { normalizeTicker } from '@/lib/tickers';
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
// PATCH 0300 — Shared freshness chip for the quote refresh state.
import { PanelFreshness } from '@/components/PanelFreshness';
import FundamentalsAnalyzerPage from '../fundamentals/page';
import PortfolioEarningsTab from '../watchlists/PortfolioEarningsTab'; // zzz285
import TickerExportToolbar from '@/components/TickerExportToolbar';
import ReturnVsIndexCard from '@/components/ReturnVsIndexCard';
import CockpitHero from '@/components/CockpitHero'; // zzz533 — premium market-context band
import { isPricedRow, bookTotals, unpricedNote, neutralSignalLabel } from '@/lib/book-totals'; // zzz898
import { openPassport } from '@/lib/engines';
import { PortfolioAnalytics, capBadge } from './PortfolioAnalytics';
import { PortfolioRegimeExposure } from './PortfolioRegimeExposure';
import { PortfolioSummary } from './PortfolioSummary';
import { CAP_COLORS } from './constants';
import { getStoredHoldings, setStoredHoldings, fetchStockQuotes, fetchIndividualQuotes, normCapBucket, fmt, fmtPct } from './helpers';
import { AddHoldingForm, EditableCell, EditHoldingRow } from './holding-forms';
import { type PortfolioHolding, type StockQuote, type Signal, type SortField, type SortOrder, type PortfolioRow } from './types';

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  /** The symbol whose row is open for editing, if any. (zzz756) */
  const [editSymbol, setEditSymbol] = useState<string | null>(null);
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
  const [viewTab, setViewTab] = useState<'holdings' | 'analytics' | 'regime' | 'fundamentals' | 'earnings'>('holdings'); // PATCH 1100 + zzz285 + PATCH 1103
  const [capFilter, setCapFilter] = useState<'all' | 'large' | 'mid' | 'small' | 'micro'>('all'); // PATCH 1100
  // zzz311 — tier filter driven from Analytics tier-mix chips. '' = no filter.
  const [tierFilter, setTierFilter] = useState<'' | 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID' | 'NONE'>('');
  // zzz311 — read the earnings-tab cache once for the ticker->tier map used by the filter.
  const tickerToTier = useMemo<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem('mc:portfolio-earnings-tab:v1');
      if (!raw) return {};
      const c = JSON.parse(raw);
      if (!c || !c.grades) return {};
      const map: Record<string, string> = {};
      for (const k in c.grades) {
        const g = c.grades[k];
        map[k.toUpperCase()] = (g && g.tier) || 'NONE';
      }
      return map;
    } catch { return {}; }
  }, [viewTab]);
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
            // ── THE SERVER IS A UNION PARTNER, NOT A REPLACEMENT. (zzz756)
            //
            // The old line took the server list wholesale and wrote it
            // over localStorage. Any position added while the server was
            // unreachable was destroyed on the next load — silently, and
            // by the code that was supposed to be restoring it. Both
            // lists are now merged by symbol, and the LOCAL row wins on a
            // conflict because it is the one the user edited most
            // recently on this device.
            const local = getStoredHoldings();
            const byId = new Map<string, PortfolioHolding>();
            for (const h of data.holdings as PortfolioHolding[]) {
              if (h?.symbol) byId.set(String(h.symbol).toUpperCase(), h);
            }
            const localOnly: string[] = [];
            for (const h of local) {
              if (!h?.symbol) continue;
              const k = String(h.symbol).toUpperCase();
              if (!byId.has(k)) localOnly.push(h.symbol);
              byId.set(k, h);
            }
            const merged = Array.from(byId.values());
            setHoldings(merged);
            setStoredHoldings(merged);
            if (localOnly.length) {
              // Push the un-synced rows up so the two copies converge.
              void syncToAPI(merged);
            }
            return;
          }
        }
      } catch (e) { console.error('Portfolio API fetch failed:', e); }
      setHoldings(getStoredHoldings());
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch live quotes — bulk first, then individual for missing
  const slowAtRef = useRef(0);   // zzz883: when signals + trend were last fetched
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

      // zzz883: signals and trend change slowly — fetched together (not one after the other) and at most every 15 minutes;
      // prices keep their 60-second refresh.
      if (Date.now() - slowAtRef.current >= 15 * 60_000) {
        slowAtRef.current = Date.now();
        const loadIntel = async () => {
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

        };
        const loadTrend = async () => {
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

        };
        await Promise.allSettled([loadIntel(), loadTrend()]);
      }
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
        // PATCH zzz100 — fixed misleading "45s" message + auto-retry once after 5s.
        setFetchError(`Price data unavailable — Railway is slow right now (last attempt ${stamp}). Auto-retrying in 5s.`);
        setTimeout(() => { try { fetchData(); } catch {} }, 5_000);
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
  // ── A WRITE THAT DID NOT LAND MUST NOT TOAST "ADDED".          (zzz756)
  //
  // THE BUG: "I can't add new positions." The add handler worked — it set
  // state, wrote localStorage, POSTed, and showed a green toast. The POST
  // was fire-and-forget with a console.error on failure, and the server
  // store has been unavailable for long stretches (the Upstash quota
  // exhaustion of Day-6 is the documented case). So the row appeared,
  // the toast said success, and on the next page load `init()` read the
  // server list, found it non-empty, and called BOTH setHoldings AND
  // setStoredHoldings with it — overwriting the local copy that actually
  // had the new position. The holding vanished with no error anywhere.
  //
  // Now: localStorage is written first and is authoritative, the POST is
  // awaited, and a failure is SAID OUT LOUD. The position is still saved
  // on this device — that is true and worth knowing — but the user is
  // told it has not reached the server.
  const syncToAPI = useCallback(async (h: PortfolioHolding[]): Promise<boolean> => {
    setStoredHoldings(h);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      let r: Response;
      try {
        r = await fetch('/api/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: CHAT_ID, secret: BOT_SECRET, action: 'set', holdings: h }),
          signal: ctl.signal,
        });
      } finally { clearTimeout(timer); }
      if (!r.ok) {
        toast.error(`Saved on this device only — server refused the write (HTTP ${r.status}). It will not appear on your other devices yet.`);
        return false;
      }
      return true;
    } catch (e: any) {
      toast.error(`Saved on this device only — could not reach the server (${String(e?.message || e).slice(0, 60)}).`);
      return false;
    }
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
      // zzz296 — also try base ticker (strip NSE trading-segment suffix)
      const upperNoSuffix = upperSym.replace(/-(BE|BZ|BL|EQ|SM|T)$/i, '');
      const quote = quotes.find(q => {
        const qt = String(q.ticker || '').toUpperCase();
        return qt === upperSym || qt === upperNorm || (upperNoSuffix !== upperSym && qt === upperNoSuffix);
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
    // Second pass: weight by current value (proper risk weighting).
    // zzz378 — denominator = priced holdings only; an unpriced holding valued at cost
    // was diluting every real weight and could trip false over/under-weight flags.
    const totalCurrent = rawRows.reduce((s, r) => s + ((r.cmp || 0) > 0 ? r.currentValue : 0), 0);
    return rawRows.map(r => ({ ...r, weight: (totalCurrent > 0 && (r.cmp || 0) > 0) ? (r.currentValue / totalCurrent) * 100 : 0 }));
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
      // zzz378 — coerce nullish numerics and push them to the END regardless of
      // direction (undefined − number = NaN → undefined ordering, e.g. SCORE column
      // on a partially-scored book).
      const av = (typeof aVal === 'number' && Number.isFinite(aVal)) ? aVal : (sortOrder === 'asc' ? Infinity : -Infinity);
      const bv = (typeof bVal === 'number' && Number.isFinite(bVal)) ? bVal : (sortOrder === 'asc' ? Infinity : -Infinity);
      return sortOrder === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [rows, sortField, sortOrder]);

  // PATCH 1100 — cap normalization + cap-filtered view for the holdings table.
  const displayRows = useMemo(() => {
    let out = capFilter === 'all' ? sortedRows : sortedRows.filter(r => normCapBucket(r.cap) === capFilter);
    if (tierFilter) {
      out = out.filter(r => (tickerToTier[String(r.symbol).toUpperCase()] || 'NONE') === tierFilter);
    }
    return out;
  }, [sortedRows, capFilter, tierFilter, tickerToTier]);

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
  const handleAdd = async (h: PortfolioHolding) => {
    const exists = holdings.find(x => x.symbol === h.symbol);
    if (exists) {
      // Average in
      const totalQty = exists.quantity + h.quantity;
      const avgPrice = ((exists.entryPrice * exists.quantity) + (h.entryPrice * h.quantity)) / totalQty;
      const updated = holdings.map(x => x.symbol === h.symbol ? { ...x, entryPrice: avgPrice, quantity: totalQty } : x);
      setHoldings(updated);
      const ok = await syncToAPI(updated);
      if (ok) toast.success(`${h.symbol} averaged in — ${totalQty} shares @ ₹${avgPrice.toFixed(2)}`);
    } else {
      const updated = [...holdings, h];
      setHoldings(updated);
      const ok = await syncToAPI(updated);
      if (ok) toast.success(`${h.symbol} added to portfolio`);
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

  // ── EDIT A WHOLE POSITION, NOT ONE CELL AT A TIME.             (zzz756)
  //
  // Entry price and quantity were already editable, but only by clicking a
  // dashed underline that nothing announced, and `notes` could be set when
  // the position was created and never afterwards. One EDIT button per row
  // opens all three together and saves them in one write.
  const handleSaveRow = async (symbol: string, patch: { entryPrice: number; quantity: number; notes: string }) => {
    if (!(patch.entryPrice > 0)) { toast.error('Entry price must be greater than zero'); return; }
    if (!(patch.quantity > 0)) { toast.error('Quantity must be greater than zero'); return; }
    const updated = holdings.map(h => h.symbol === symbol
      ? { ...h, entryPrice: patch.entryPrice, quantity: patch.quantity, notes: patch.notes.trim() || undefined }
      : h);
    setHoldings(updated);
    setEditSymbol(null);
    const ok = await syncToAPI(updated);
    if (ok) toast.success(`${symbol} updated`);
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
      'CMP': r.cmp > 0 ? r.cmp : '',   // zzz883: no quote = blank, never 0
      // zzz898: no price = blank cells, never 0
      'Day Change %': isPricedRow(r) && Number.isFinite(r.changePercent) && r.changePercent !== 0 ? parseFloat(r.changePercent.toFixed(2)) : '' as any,
      'Invested': Math.round(r.investedValue),
      'Current Value': isPricedRow(r) ? Math.round(r.currentValue) : '' as any,
      'P&L': isPricedRow(r) ? Math.round(r.pnl) : '' as any,
      'P&L %': isPricedRow(r) ? parseFloat(r.pnlPercent.toFixed(2)) : '' as any,
      'Score': r.score !== undefined ? parseFloat(r.score.toFixed(0)) : '',
      'Trend': r.sectorTrend || '',
      // zzz883: the book never tells you to buy or sell — the column is the evidence signal, in neutral words
      'Signal': neutralSignalLabel(r.decision),
    }));

    // Add summary row
    // zzz898 — totals cover priced holdings only; unpriced ones are counted, not valued at cost
    const bt = bookTotals(sortedRows);
    data.push({
      '#': 0, 'Symbol': '', 'Company': bt.unpricedCount > 0 ? `TOTAL (priced only — ${unpricedNote(bt.unpricedCount)})` : 'TOTAL', 'Sector': '',
      'Entry Price': '' as any, 'Qty': '' as any, 'Weight %': 100,
      'CMP': '', 'Day Change %': '' as any,
      'Invested': Math.round(bt.pricedInvested),
      'Current Value': bt.pricedCount > 0 ? Math.round(bt.current) : '' as any,
      'P&L': bt.pnl !== null ? Math.round(bt.pnl) : '' as any,
      'P&L %': bt.pnlPct !== null ? parseFloat(bt.pnlPct.toFixed(2)) : '' as any,
      'Score': '', 'Trend': '', 'Signal': '',
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
      <div className="mc-stack-mobile" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', gap: 12 }}>
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
            {/* zzz999 — every holding's chart patterns and distance to the 21 / 50 / 200-day averages (Pine Screener) */}
            <a href="/pine-screener?view=portfolio&market=IN" title="Every holding: chart patterns (daily / weekly / monthly) and how far the close is from the 21, 50 and 200-day averages"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Chart check</a>
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

      {/* zzz533 — premium market-context band */}
      <div style={{ marginBottom: 16 }}><CockpitHero /></div>

      {/* ── Summary ─────────────────────────────────────────────────── */}
      <PortfolioSummary rows={sortedRows} holdings={holdings} />
      <div style={{ marginTop: 16 }}><ReturnVsIndexCard /></div>{/* zzz514 */}

      {/* PATCH 1100 — view tabs + market-cap filter */}
      {!loading && holdings.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '8px 0 14px' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)', borderRadius: 10, padding: 4 }}>
            {(['holdings', 'analytics', 'regime', 'fundamentals', 'earnings'] as const).map(t => (
              <button key={t} onClick={() => setViewTab(t)} style={{
                padding: '7px 16px', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, letterSpacing: '0.3px',
                background: viewTab === t ? '#1D4ED8' : 'transparent', color: viewTab === t ? '#fff' : 'var(--mc-text-3)',
              }}>{t === 'holdings' ? '\ud83d\udc0b Holdings' : t === 'analytics' ? '\ud83d\udcca Analytics' : t === 'regime' ? '\ud83c\udf00 Regime' : t === 'fundamentals' ? 'Fundamentals' : '\ud83d\udcc8 Earnings'}</button>
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
      {!loading && holdings.length > 0 && viewTab === 'earnings' && <PortfolioEarningsTab tickers={holdings.map(h => h.symbol)} />}
        {!loading && holdings.length > 0 && viewTab === 'analytics' && (
        <PortfolioAnalytics rows={sortedRows}
          onSelectCap={(c) => { setCapFilter(c as any); setViewTab('holdings'); }}
          onSelectTier={(t) => { setTierFilter(t as any); setViewTab('holdings'); }}
          selectedTier={tierFilter}
        />
      )}

      {/* PATCH 1103 — Regime exposure view */}
      {!loading && holdings.length > 0 && viewTab === 'regime' && (
        <PortfolioRegimeExposure rows={sortedRows} />
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
            <table className="mc-sticky-first" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
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
                    { key: 'changePercent' as SortField, label: 'DAY%', align: 'right' },
                    { key: 'symbol' as SortField, label: 'EDIT', align: 'right', noSort: true },
                  ].map((col, i) => (
                    // AUDIT_100 #8 — stable composite key on table headers.
                    <th key={`${col.key}|${col.label}|${i}`} onClick={() => !col.noSort && handleSort(col.key)} style={{
                      padding: '10px 12px', textAlign: col.align as any, fontSize: '10px', fontWeight: '700',
                      color: 'var(--mc-text-3)', letterSpacing: '0.5px', cursor: col.noSort ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      ...(col.label === 'EDIT' ? { position: 'sticky' as const, right: 0, zIndex: 2, backgroundColor: 'var(--mc-bg-1)' } : {}),
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
                  const row = (
                    <tr key={r.symbol} style={{ borderBottom: idx < displayRows.length - 1 ? '1px solid var(--mc-bg-2)' : 'none', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td onClick={() => openPassport(r.symbol)} title="Open Stock Passport" style={{ padding: '10px 12px', color: 'var(--mc-info)', fontWeight: '700', cursor: 'pointer' }}>{r.symbol}</td>
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
                          <span title="not available — no live price for this holding" style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', backgroundColor: 'rgba(251,191,36,0.1)', color: 'var(--mc-warn)' }}>
                            —
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
                          // zzz898: no price = no weight (left out of totals), never 0%
                          if (!isPricedRow(r)) return <span title="not available — no live price" style={{ color: 'var(--mc-text-4)' }}>—</span>;
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
                        {r.cmp > 0 ? fmt(r.currentValue) : <span title="not available — no live price">—</span>}
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
                        ) : <span title="not available — no live price">—</span>}
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
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{
                          display: 'inline-block', padding: '3px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                          backgroundColor: hasQuote
                            ? (r.changePercent >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)')
                            : 'rgba(100,116,139,0.1)',
                          color: dayColor, fontVariantNumeric: 'tabular-nums',
                        }}
                        title={!hasQuote ? 'not available — no live quote' : undefined}>
                          {hasQuote ? fmtPct(r.changePercent) : '—'}
                        </span>
                      </td>
                      <td data-testid={`edit-cell-${r.symbol}`} style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', position: 'sticky', right: 0, zIndex: 1, backgroundColor: 'var(--mc-bg-0, var(--mc-bg-1))', boxShadow: '-6px 0 8px -6px rgba(0,0,0,0.25)' }}>
                        {/* zzz838: a visible, labelled Edit button on EVERY holding (was a dim icon-only button that sat off-screen on a wide table). Sticky at the right edge so it is always reachable. */}
                        <button data-testid={`edit-btn-${r.symbol}`} onClick={() => setEditSymbol(editSymbol === r.symbol ? null : r.symbol)}
                          title={`Edit ${r.symbol} — entry price, quantity, notes`}
                          aria-label={`Edit ${r.symbol}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: editSymbol === r.symbol ? 'rgba(34,211,238,0.15)' : 'transparent', border: '1px solid var(--mc-info)', color: 'var(--mc-info)', cursor: 'pointer', padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 800, marginRight: 6 }}>
                          <Edit3 style={{ width: '12px', height: '12px' }} />Edit
                        </button>
                        <button data-testid={`remove-btn-${r.symbol}`} onClick={() => handleRemove(r.symbol)} title="Remove from portfolio" aria-label={`Remove ${r.symbol}`}
                          style={{ background: 'none', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-3)', cursor: 'pointer', padding: '3px 6px', borderRadius: 6 }}>
                          <Trash2 style={{ width: '13px', height: '13px' }} />
                        </button>
                      </td>
                    </tr>
                  );
                  return editSymbol === r.symbol
                    ? (<React.Fragment key={r.symbol}>{row}<EditHoldingRow row={r} colSpan={15} onSave={(patch) => handleSaveRow(r.symbol, patch)} onCancel={() => setEditSymbol(null)} /></React.Fragment>)
                    : row;
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
