'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown, Zap } from 'lucide-react';
// PATCH 0284 — Shared freshness chip.
import { PanelFreshness } from '@/components/PanelFreshness';
// Holiday-aware IST market-hours check for honest LIVE/last-close labels.
import { isIndianMarketOpen } from '@/lib/market-hours';
// PATCH 0544 — AUDIT #76 shared quote fetch (dedupe + 60s module cache).
import { fetchQuotesShared } from '@/lib/hooks/useMarketQuotes';
// Institutional event-attribution engine (same one that powers the home page
// Top Movers). Wired into the Movers tab so the tab named after attribution
// actually shows attribution — "why it moved" + confidence + scope + circuit /
// tier / anomaly badges.
import {
  attributeMovers,
  moverTier,
  isCircuitMove,
  anomalyTag,
  ANOMALY_COLOR,
  CONFIDENCE_COLOR,
  CATALYST_GLYPH,
  cleanMoverLabel,
  type MoverAttribution,
  type Confidence,
  type Scope,
} from '@/lib/movers-attribution';
// User's "book" — conviction bench. Held + watchlist come from localStorage.
import { getConvictionTickers } from '@/lib/conviction-beats';

interface Stock {
  ticker: string;
  company: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  previousClose: number;
  cap: string; // 'Large' | 'Mid' | 'Small'
}

type CapFilter = 'All' | 'Large' | 'Mid' | 'Small' | 'Mid & Small';
type MoveToken = '+2%' | '+4%' | '+6%' | '-2%' | '-4%' | '-6%';
type SortKey = 'ticker' | 'sector' | 'cap' | 'price' | 'changePercent' | 'volume';
type SortDir = 'asc' | 'desc';
interface SortState { key: SortKey; dir: SortDir }

const BG = '#0A0E1A', CARD = '#0D1623', BORDER = '#1A2840', ACCENT = '#0F7ABF';
const GREEN = '#10B981', RED = '#EF4444', TEXT1 = '#F5F7FA', TEXT2 = '#8A95A3', TEXT3 = '#4A5B6C';

function formatVol(v: number): string {
  if (v >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v || 0);
}

function formatTime(d: Date | null): string {
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--';
}

function classifyCap(s: { indexGroup?: string; marketCap?: number }): string {
  if (s.indexGroup === 'Large' || s.indexGroup === 'Mid' || s.indexGroup === 'Small') return s.indexGroup;
  const mcap = s.marketCap || 0;
  if (mcap >= 1_000_000_000_000) return 'Large'; // 1000B (1 lakh crore)
  if (mcap >= 250_000_000_000) return 'Mid'; // 250B-1000B
  return 'Small'; // Below 250B
}

function isValidStock(s: { ticker?: string; price?: number }): boolean {
  const t = s.ticker || '';
  if (t.includes(' ') || t.startsWith('NIFTY') || t.startsWith('NIFTY_')) return false;
  if (!t || (s.price || 0) <= 0) return false;
  return true;
}

function passesMoveFilter(pct: number, active: Set<MoveToken>): boolean {
  if (active.size === 0) return true;
  for (const token of active) {
    switch (token) {
      case '+2%': if (pct >= 2) return true; break;
      case '+4%': if (pct >= 4) return true; break;
      case '+6%': if (pct >= 6) return true; break;
      case '-2%': if (pct <= -2) return true; break;
      case '-4%': if (pct <= -4) return true; break;
      case '-6%': if (pct <= -6) return true; break;
    }
  }
  return false;
}

// AUDIT_100 #44 — explain composability of the move chips to the user.
// They compose as OR (any active token that passes wins), so selecting
// both +4% and +6% behaves like +4% alone. Surface that to the chip rail.
function summarizeMoveFilter(active: Set<MoveToken>): string {
  if (active.size === 0) return '';
  const ups = ['+2%','+4%','+6%'].filter(t => active.has(t as MoveToken)) as MoveToken[];
  const downs = ['-2%','-4%','-6%'].filter(t => active.has(t as MoveToken)) as MoveToken[];
  const parts: string[] = [];
  // OR-union semantics: the LOOSEST threshold defines the inclusion floor.
  if (ups.length) {
    const minUp = Math.min(...ups.map(u => Number(u.replace('%','').replace('+',''))));
    parts.push(`up ≥ +${minUp}%`);
  }
  if (downs.length) {
    const minDown = Math.max(...downs.map(d => Number(d.replace('%',''))));
    parts.push(`down ≤ ${minDown}%`);
  }
  return parts.length ? `Showing ${parts.join(' or ')}` : '';
}

// ── Responsive hook ──────────────────────────────────────────────────────
// PATCH 0874 — SSR-safe rewrite. Previous version initialised state from
// `window.innerWidth` (or 1024 on server), then `useEffect` set the real
// width on client. The first client render therefore differed from the
// server-rendered HTML whenever the viewport wasn't 1024px → hydration
// mismatch warning + isMobile/isTablet branches rendered wrong layout
// on initial paint. Now we always start at 1024 on BOTH server and
// client, then update post-hydration. Avoids the mismatch entirely.
function useWindowWidth() {
  const [width, setWidth] = useState<number>(1024);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWidth(window.innerWidth);
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

let __moversRetryCount = 0;

export default function MoversPage() {
  const [allStocks, setAllStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);

  const [capFilter, setCapFilter] = useState<CapFilter>('All');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [moveTokens, setMoveTokens] = useState<Set<MoveToken>>(new Set());
  const [gainerSort, setGainerSort] = useState<SortState>({ key: 'changePercent', dir: 'desc' });
  const [loserSort, setLoserSort] = useState<SortState>({ key: 'changePercent', dir: 'asc' });
  const [earningsTickers, setEarningsTickers] = useState<Map<string, { quality: string; quarter: string }>>(new Map());
  // AUDIT_100 #65 — earnings-day movers filter. Toggle limits the table to
  // symbols in earningsTickers (recent reporters), which is the highest-
  // signal subset most users want to watch on result days.
  const [earningsOnly, setEarningsOnly] = useState<boolean>(false);

  // ── "My Book" — union of held (localStorage 'mc_portfolio_holdings'),
  // bench (getConvictionTickers), and watchlist (localStorage
  // 'mc_watchlist_tickers'). Client-only: loaded post-mount to avoid an
  // SSR/hydration mismatch, refreshed on cross-tab storage + CB events.
  const [bookSet, setBookSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    const up = (t: string) => (t || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
    const load = () => {
      const s = new Set<string>();
      try { (JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]') || []).forEach((h: any) => { if (h?.symbol) s.add(up(h.symbol)); }); } catch { /* ignore */ }
      try { getConvictionTickers().forEach((t) => s.add(up(t))); } catch { /* ignore */ }
      try { (JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]') || []).forEach((t: string) => s.add(up(t))); } catch { /* ignore */ }
      setBookSet(s);
    };
    load();
    window.addEventListener('storage', load);
    window.addEventListener('conviction-beats:updated', load);
    return () => {
      window.removeEventListener('storage', load);
      window.removeEventListener('conviction-beats:updated', load);
    };
  }, []);

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;
  const isTablet = windowWidth >= 640 && windowWidth < 1024;

  const toggleSort = useCallback((table: 'gainer' | 'loser', key: SortKey) => {
    const setter = table === 'gainer' ? setGainerSort : setLoserSort;
    const defaultDir = table === 'gainer' ? 'desc' : 'asc';
    setter(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      const dir = key === 'ticker' || key === 'sector' || key === 'cap' ? 'asc' : defaultDir;
      return { key, dir };
    });
  }, []);

  const toggleMove = useCallback((token: MoveToken) => {
    setMoveTokens(prev => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setCapFilter('All');
    setSectorFilter('All');
    setMoveTokens(new Set());
    setEarningsOnly(false);
  }, []);

  const hasActiveFilters = capFilter !== 'All' || sectorFilter !== 'All' || moveTokens.size > 0 || earningsOnly;

  const fetchData = useCallback(async (force = false) => {
    // PATCH 1015 — 15s -> 35s. The full ~2,341-stock universe build takes ~25s
    // on a cold cache (no Yahoo on weekends; the cost is the blob read + build),
    // so a 15s abort guaranteed a timeout on the first load. 35s lets the cold
    // build finish; warm loads return in <1s from the 120s response cache.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60_000);
    try {
      setError(null);
      setIsRefreshing(true);
      // PATCH 0544 — Shared quote fetch dedupes with /heatmap when user
      // toggles inside /market-snapshot within the 60s cache window.
      const json = await fetchQuotesShared({ market: 'india', signal: ctl.signal, force });

      const stocks: Stock[] = ((json as { stocks?: Record<string, unknown>[] }).stocks || [])
        .filter(isValidStock)
        .map((s: Record<string, unknown>) => ({
          ticker: s.ticker as string,
          company: (s.company as string) || (s.ticker as string),
          sector: (s.sector as string) || 'Other',
          price: (s.price as number) || 0,
          change: (s.change as number) || 0,
          changePercent: (s.changePercent as number) || 0,
          volume: (s.volume as number) || 0,
          marketCap: (s.marketCap as number) || 0,
          previousClose: (s.previousClose as number) || 0,
          cap: classifyCap({ indexGroup: s.indexGroup as string, marketCap: s.marketCap as number }),
        }));

      // AUDIT_100 #86 — compare-by-cheap-hash before triggering re-render.
      // Polling fetches were re-setting state every 60s even when the upstream
      // payload was byte-identical, causing the whole table tree to re-render.
      setAllStocks(prev => {
        const sig = (arr: Stock[]) => arr.length + '|' + arr.slice(0, 50).map(s => `${s.ticker}:${s.price}:${s.changePercent}`).join(',');
        return sig(prev) === sig(stocks) ? prev : stocks;
      });
      setLastUpdated(new Date()); __moversRetryCount = 0;
      setMarketOpen(isIndianMarketOpen());
    } catch (err: any) {
      setError(err?.name === 'AbortError' ? 'Movers fetch timed out' : (err instanceof Error ? err.message : 'Failed to fetch data'));
      if (allStocks.length === 0 && __moversRetryCount < 3) { __moversRetryCount += 1; setTimeout(() => { fetchData(); }, 2500); }
    } finally {
      clearTimeout(timer);
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Fetch recent earnings for badges
  // PATCH 0966 — Pattern C: earnings fetches had no AbortSignal timeout, so
  // a hung backend would leave them pending and the earnings-only filter chip
  // would never appear. 15s ceiling matches fetchData above.
  const fetchEarnings = useCallback(async () => {
    try {
      const now = new Date();
      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30_000);
      const [curRes, prevRes] = await Promise.all([
        fetch(`/api/market/earnings?market=india&month=${curMonth}`, { signal: ctl.signal }).catch(() => null),
        fetch(`/api/market/earnings?market=india&month=${prevMonth}`, { signal: ctl.signal }).catch(() => null),
      ]);
      clearTimeout(timer);
      const map = new Map<string, { quality: string; quarter: string }>();
      for (const res of [curRes, prevRes]) {
        if (res && res.ok) {
          const json = await res.json();
          for (const r of (json.results || [])) {
            if (r.quality !== 'Upcoming' && r.quality !== 'Preview' && !map.has(r.ticker)) {
              map.set(r.ticker, { quality: r.quality, quarter: r.quarter });
            }
          }
        }
      }
      setEarningsTickers(map);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchData(); fetchEarnings(); }, [fetchData, fetchEarnings]);
  // PATCH 0516 — Visibility-gated polling. Skip when tab hidden to save quota.
  useEffect(() => {
    const i = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchData();
    }, 60000);
    return () => clearInterval(i);
  }, [fetchData]);
  // PATCH — immediate refetch when the tab becomes visible again with stale
  // data (laptop reopen / overnight tab). The 60s poll above is visibility-
  // gated, so without this a tab hidden since yesterday shows day-old movers
  // for up to 60s after return — and indefinitely if the tick was missed.
  useEffect(() => {
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchData();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [fetchData]);

  const filtered = useMemo(() => {
    // PATCH 0796 — volume filter: only consider stocks with ≥5 lakh shares
    // traded today (user spec). Drops illiquid noise from /movers display.
    const MIN_VOLUME = 500_000;
    return allStocks.filter(s => {
      if ((s.volume || 0) < MIN_VOLUME) return false;
      if (capFilter === 'Mid & Small' && s.cap === 'Large') return false;
      if (capFilter !== 'All' && capFilter !== 'Mid & Small' && s.cap !== capFilter) return false;
      if (sectorFilter !== 'All' && s.sector !== sectorFilter) return false;
      if (!passesMoveFilter(s.changePercent, moveTokens)) return false;
      // AUDIT_100 #65 — earnings-day filter narrows to recent reporters only.
      if (earningsOnly && !earningsTickers.has(s.ticker)) return false;
      return true;
    });
  }, [allStocks, capFilter, sectorFilter, moveTokens, earningsOnly, earningsTickers]);

  const sortStocks = useCallback((stocks: Stock[], sort: SortState): Stock[] => {
    const mult = sort.dir === 'asc' ? 1 : -1;
    return [...stocks].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'ticker': cmp = a.ticker.localeCompare(b.ticker); break;
        case 'sector': cmp = a.sector.localeCompare(b.sector); break;
        case 'cap': {
          const order: Record<string, number> = { Large: 0, Mid: 1, Small: 2 };
          cmp = (order[a.cap] ?? 3) - (order[b.cap] ?? 3);
          break;
        }
        case 'price': cmp = a.price - b.price; break;
        case 'changePercent': cmp = a.changePercent - b.changePercent; break;
        case 'volume': cmp = a.volume - b.volume; break;
      }
      return cmp * mult;
    });
  }, []);

  const gainers = useMemo(() => {
    const base = filtered.filter(s => s.changePercent > 0);
    return sortStocks(base, gainerSort).slice(0, 30);
  }, [filtered, gainerSort, sortStocks]);

  const losers = useMemo(() => {
    const base = filtered.filter(s => s.changePercent < 0);
    return sortStocks(base, loserSort).slice(0, 30);
  }, [filtered, loserSort, sortStocks]);

  // ── My Book Movers — book names that moved today, computed off the FULL
  // universe (allStocks) so they bypass the volume floor and the top-N slice.
  // A big move on a name you actually hold is never dropped by the ≥5L-volume
  // filter or drowned in the 60-row list.
  const bookMovers = useMemo(() => {
    if (bookSet.size === 0) return [] as Stock[];
    return allStocks
      .filter(s => bookSet.has(s.ticker.toUpperCase()) && Math.abs(s.changePercent) > 0)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 20);
  }, [allStocks, bookSet]);

  // ── Attribution — run the institutional engine over the rows we actually
  // render (gainers + losers + book movers, deduped). Sector aggregates +
  // index avg come from the FULL universe so SECTOR_WIDE detection is honest.
  // The page doesn't fetch filings/news, so those indices are empty and the
  // engine falls through to its lower-confidence sector / momentum tiers —
  // which is the honest behaviour per the engine's design.
  const attribution = useMemo(() => {
    const byTicker: Record<string, Stock> = {};
    for (const s of [...gainers, ...losers, ...bookMovers]) byTicker[s.ticker.toUpperCase()] = s;
    const rows = Object.values(byTicker);
    if (rows.length === 0) return {} as Record<string, MoverAttribution>;

    const secAgg: Record<string, { sum: number; count: number }> = {};
    let idxSum = 0, idxCount = 0;
    for (const s of allStocks) {
      const cp = s.changePercent;
      if (!Number.isFinite(cp)) continue;
      const sec = s.sector || 'Other';
      (secAgg[sec] ||= { sum: 0, count: 0 });
      secAgg[sec].sum += cp; secAgg[sec].count += 1;
      idxSum += cp; idxCount += 1;
    }
    const sectorAggregates: Record<string, { avgChangePct: number; stockCount: number }> = {};
    for (const [sec, a] of Object.entries(secAgg)) {
      if (a.count >= 2) sectorAggregates[sec] = { avgChangePct: a.sum / a.count, stockCount: a.count };
    }
    const indexAvgChangePct = idxCount > 0 ? idxSum / idxCount : undefined;

    // Partial earnings index from the recent-reporters map the page already
    // fetches. It carries no filing_date / YoY metrics, so the engine's 7-day
    // EARNINGS tier won't fire on it — it's passed for completeness and the
    // engine gracefully ignores what it can't use.
    const earningsByTicker: Record<string, { ticker: string; tier: string; quarter?: string }> = {};
    earningsTickers.forEach((info, tk) => {
      earningsByTicker[tk.toUpperCase()] = { ticker: tk, tier: info.quality, quarter: info.quarter };
    });

    return attributeMovers({
      movers: rows.map(s => ({
        ticker: s.ticker,
        sector: s.sector,
        changePercent: s.changePercent,
        indexGroup: s.cap,
        marketCap: s.marketCap,
        volume: s.volume,
        previousClose: s.previousClose,
        price: s.price,
      })),
      filingsBySymbol: {},
      newsByTicker: {},
      earningsByTicker,
      sectorAggregates,
      indexAvgChangePct,
      filingsFeedHealthy: false,
      newsFeedHealthy: false,
    });
  }, [gainers, losers, bookMovers, allStocks, earningsTickers]);

  const attrFor = useCallback(
    (ticker: string) => attribution[(ticker || '').toUpperCase()],
    [attribution],
  );

  const sectors = useMemo(() => {
    const sectorSet = new Set(allStocks.map(s => s.sector));
    return ['All', ...[...sectorSet].sort()];
  }, [allStocks]);

  const sectorPerf = useMemo(() => {
    const base = capFilter === 'All' ? allStocks
      : capFilter === 'Mid & Small' ? allStocks.filter(s => s.cap !== 'Large')
      : allStocks.filter(s => s.cap === capFilter);
    const map = new Map<string, { total: number; count: number }>();
    for (const s of base) {
      const e = map.get(s.sector) || { total: 0, count: 0 };
      e.total += s.changePercent;
      e.count += 1;
      map.set(s.sector, e);
    }
    return [...map.entries()]
      .map(([sector, { total, count }]) => ({ sector, avg: total / count, count }))
      .sort((a, b) => b.avg - a.avg);
  }, [allStocks, capFilter]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const gCount = filtered.filter(s => s.changePercent > 0).length;
    const lCount = filtered.filter(s => s.changePercent < 0).length;
    const avg = total > 0 ? filtered.reduce((sum, s) => sum + s.changePercent, 0) / total : 0;
    const sectorCount = new Set(filtered.map(s => s.sector)).size;
    return { total, gainersCount: gCount, losersCount: lCount, avgChange: avg, sectors: sectorCount };
  }, [filtered]);

  const capCounts = useMemo(() => {
    const large = allStocks.filter(s => s.cap === 'Large').length;
    const mid = allStocks.filter(s => s.cap === 'Mid').length;
    const small = allStocks.filter(s => s.cap === 'Small').length;
    return { large, mid, small };
  }, [allStocks]);

  // --- UI Components ---

  const CapPill = ({ label, value, count }: { label: string; value: CapFilter; count: number }) => (
    <button onClick={() => setCapFilter(value)} style={{
      padding: isMobile ? '5px 9px' : '5px 12px',
      borderRadius: '6px', border: 'none',
      fontSize: isMobile ? '10px' : '11px', fontWeight: '500',
      backgroundColor: capFilter === value ? ACCENT : 'transparent',
      color: capFilter === value ? '#fff' : TEXT2,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
      display: 'flex', alignItems: 'center', gap: '3px',
    }}>
      {label}
      {!isMobile && <span style={{ fontSize: '9px', opacity: 0.7 }}>({count})</span>}
    </button>
  );

  const MoveChip = ({ token, label, color }: { token: MoveToken; label: string; color: string }) => {
    const active = moveTokens.has(token);
    return (
      <button onClick={() => toggleMove(token)} style={{
        padding: '4px 9px', borderRadius: '5px', fontSize: '11px', fontWeight: '600',
        border: active ? `1.5px solid ${color}` : `1px solid ${BORDER}`,
        backgroundColor: active ? `${color}18` : 'transparent',
        color: active ? color : TEXT3,
        cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
        letterSpacing: '0.3px',
      }}>
        {label}
      </button>
    );
  };

  // Earnings badge component
  const EarningsBadge = ({ ticker }: { ticker: string }) => {
    const info = earningsTickers.get(ticker);
    if (!info) return null;
    const qColor = info.quality === 'Excellent' || info.quality === 'Great' ? GREEN
      : info.quality === 'Good' ? '#81C784'
      : info.quality === 'OK' ? '#F59E0B'
      : RED;
    return (
      <span style={{
        fontSize: '8px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px', marginLeft: '4px',
        backgroundColor: `${qColor}20`, color: qColor, verticalAlign: 'middle',
        display: 'inline-flex', alignItems: 'center', gap: '2px',
      }}>
        <Zap size={7} />{info.quarter || 'Q'}
      </span>
    );
  };

  // ── Attribution + circuit/tier/anomaly badge helpers ──────────────────────
  const confChipStyle = (conf: Confidence): React.CSSProperties => ({
    fontSize: '8px', fontWeight: 800, padding: '1px 4px', borderRadius: '3px',
    backgroundColor: `${CONFIDENCE_COLOR[conf]}22`, color: CONFIDENCE_COLOR[conf],
    letterSpacing: '0.3px', whiteSpace: 'nowrap',
  });
  const scopeChipStyle = (scope: Scope): React.CSSProperties => {
    const isStock = scope === 'STOCK_SPECIFIC';
    const col = isStock ? '#818CF8' : '#22D3EE';
    return {
      fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
      backgroundColor: `${col}18`, color: col, whiteSpace: 'nowrap',
    };
  };
  const scopeLabel = (scope: Scope) =>
    scope === 'STOCK_SPECIFIC' ? 'STOCK-SPECIFIC' : scope === 'SECTOR_WIDE' ? 'SECTOR-WIDE' : 'INDEX-WIDE';

  // "Why it moved" line: engine label + HIGH/MEDIUM/LOW confidence chip +
  // STOCK_SPECIFIC vs SECTOR_WIDE scope badge (mirrors the home page).
  const AttributionLine = ({ stock, compact }: { stock: Stock; compact?: boolean }) => {
    const attr = attrFor(stock.ticker);
    if (!attr) return null;
    const label = cleanMoverLabel(attr) || attr.catalyst;
    if (!label) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
        <span title={attr.detail || label} style={{
          fontSize: compact ? '9px' : '10px', color: TEXT2, fontWeight: 500,
          maxWidth: compact ? '150px' : '230px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {CATALYST_GLYPH[attr.catalystType]} {label}
        </span>
        <span style={confChipStyle(attr.confidence)}>{attr.confidence}</span>
        <span style={scopeChipStyle(attr.scope)}>{scopeLabel(attr.scope)}</span>
      </div>
    );
  };

  // Circuit / tier / anomaly badges. A circuit-locked move (e.g. +9.98% upper
  // circuit) gets a distinct red 🔒 badge so it never looks like a genuine
  // re-rate; the anomaly badge intentionally skips CIRCUIT (already surfaced).
  const RowBadges = ({ stock }: { stock: Stock }) => {
    const attr = attrFor(stock.ticker);
    const pct = stock.changePercent;
    const tier = moverTier(pct);
    const circuit = isCircuitMove(pct);
    const anom = anomalyTag({ changePercent: pct, attribution: attr, tier });
    return (
      <>
        {circuit && (
          <span title="Within 0.15% of an NSE circuit limit (±5/10/20%) — likely circuit-locked, not free price discovery. Not tradeable like a genuine re-rate."
            style={{ fontSize: '8px', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', backgroundColor: 'rgba(239,68,68,0.18)', color: RED, whiteSpace: 'nowrap' }}>
            🔒 circuit
          </span>
        )}
        {tier !== 'MINOR' && (
          <span title={`${tier} move (|Δ| ${tier === 'EXTREME' ? '≥10%' : '5–10%'})`}
            style={{
              fontSize: '8px', fontWeight: 800, padding: '1px 4px', borderRadius: '3px',
              backgroundColor: tier === 'EXTREME' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
              color: tier === 'EXTREME' ? RED : 'var(--mc-warn)', whiteSpace: 'nowrap',
            }}>
            {tier}
          </span>
        )}
        {anom && anom !== 'CIRCUIT' && (
          <span title={`Anomaly: ${anom}`} style={{
            fontSize: '8px', fontWeight: 800, padding: '1px 4px', borderRadius: '3px',
            backgroundColor: `${ANOMALY_COLOR[anom]}22`, color: ANOMALY_COLOR[anom], whiteSpace: 'nowrap',
          }}>
            {anom === 'NEWS_GAP' ? '📰 gap' : anom === 'UNEXPLAINED' ? '⚠ unexplained' : anom}
          </span>
        )}
      </>
    );
  };

  const BookChip = () => (
    <span title="In your book — held, conviction bench, or watchlist" style={{
      fontSize: '8px', fontWeight: 800, padding: '1px 5px', borderRadius: '3px',
      backgroundColor: 'rgba(16,185,129,0.16)', color: GREEN, whiteSpace: 'nowrap', letterSpacing: '0.3px',
    }}>
      💼 IN YOUR BOOK
    </span>
  );

  // Mobile card row — compact, no Sector/Vol columns
  const MobileRow = ({ stock, rank, up, inBook }: { stock: Stock; rank: number; up: boolean; inBook?: boolean }) => (
    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
      <td style={{ padding: '8px 6px', color: TEXT3, fontSize: '11px', width: '24px' }}>{rank}</td>
      <td style={{ padding: '8px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '700', fontSize: '12px', color: ACCENT }}>{stock.ticker}</span>
          <EarningsBadge ticker={stock.ticker} />
          {inBook && <BookChip />}
          <RowBadges stock={stock} />
        </div>
        <div style={{ fontSize: '9px', color: TEXT3, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stock.company}</div>
        <AttributionLine stock={stock} compact />
      </td>
      <td style={{ padding: '8px 4px', textAlign: 'right', fontSize: '12px', color: TEXT1, fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
        ₹{stock.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </td>
      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: '700', color: up ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
          {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(1)}%
        </div>
        <div style={{ fontSize: '9px', color: TEXT3, textAlign: 'right', marginTop: '1px' }}>
          <span style={{
            fontSize: '8px', fontWeight: '600', padding: '1px 4px', borderRadius: '2px',
            backgroundColor: stock.cap === 'Large' ? 'rgba(99,102,241,0.15)' : stock.cap === 'Mid' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
            color: stock.cap === 'Large' ? '#818CF8' : stock.cap === 'Mid' ? '#60A5FA' : 'var(--mc-warn)',
          }}>{stock.cap === 'Large' ? 'LRG' : stock.cap === 'Mid' ? 'MID' : 'SML'}</span>
        </div>
      </td>
    </tr>
  );

  // Desktop full row
  const Row = ({ stock, rank, up, inBook }: { stock: Stock; rank: number; up: boolean; inBook?: boolean }) => (
    <tr style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#111B35')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
      <td style={{ padding: '10px 12px', color: TEXT3, fontSize: '12px', width: '36px' }}>{rank}</td>
      <td style={{ padding: '10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '600', fontSize: '13px', color: ACCENT }}>{stock.ticker}</span>
          <EarningsBadge ticker={stock.ticker} />
          {inBook && <BookChip />}
          <RowBadges stock={stock} />
          {/* PATCH 0291 — 'Why moving?' shortcut. Opens /news with this
              ticker pre-filtered so the analyst can see what's driving the move. */}
          <a
            href={`/news?search=${encodeURIComponent(stock.ticker)}`}
            onClick={(e) => e.stopPropagation()}
            title={`Open news feed filtered to ${stock.ticker}`}
            style={{
              fontSize: 9, color: TEXT3, padding: '1px 4px', borderRadius: 3,
              border: `1px solid ${BORDER}`, textDecoration: 'none', cursor: 'pointer',
            }}
          >📰</a>
        </div>
        <div style={{ fontSize: '10px', color: TEXT3, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stock.company}</div>
        <AttributionLine stock={stock} />
      </td>
      {!isTablet && <td style={{ padding: '10px 8px', fontSize: '12px', color: TEXT2 }}>{stock.sector}</td>}
      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
        {/* PATCH 0291 — Cap chip now also shows the ₹Cr market cap inline so
            users get an actual size signal, not just S/M/L. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{
            fontSize: '9px', fontWeight: '600', padding: '2px 6px', borderRadius: '3px',
            backgroundColor: stock.cap === 'Large' ? 'rgba(99,102,241,0.15)' : stock.cap === 'Mid' ? 'rgba(59,130,246,0.15)' : 'rgba(234,179,8,0.15)',
            color: stock.cap === 'Large' ? '#818CF8' : stock.cap === 'Mid' ? '#60A5FA' : 'var(--mc-warn)',
          }}>{stock.cap === 'Large' ? 'LRG' : stock.cap === 'Mid' ? 'MID' : 'SML'}</span>
          {stock.marketCap > 0 && (
            <span style={{ fontSize: 9, color: TEXT3, fontVariantNumeric: 'tabular-nums' }}>
              {stock.marketCap >= 100000 ? `₹${(stock.marketCap / 100000).toFixed(1)}L Cr` :
               stock.marketCap >= 1000   ? `₹${(stock.marketCap / 1000).toFixed(1)}k Cr` :
                                            `₹${Math.round(stock.marketCap)}Cr`}
            </span>
          )}
        </div>
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: '13px', color: TEXT1, fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
        ₹{stock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '13px', fontWeight: '700', color: up ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
        </div>
      </td>
      {!isTablet && <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: '12px', color: TEXT3, fontVariantNumeric: 'tabular-nums' }}>{formatVol(stock.volume)}</td>}
    </tr>
  );

  // Desktop column definitions
  const desktopColumns: { label: string; key: SortKey | null; align: 'left' | 'center' | 'right' }[] = [
    { label: '#', key: null, align: 'left' },
    { label: 'Stock', key: 'ticker', align: 'left' },
    ...(!isTablet ? [{ label: 'Sector', key: 'sector' as SortKey, align: 'left' as const }] : []),
    { label: 'Cap', key: 'cap', align: 'center' },
    { label: 'Price', key: 'price', align: 'right' },
    { label: 'Change', key: 'changePercent', align: 'right' },
    ...(!isTablet ? [{ label: 'Vol', key: 'volume' as SortKey, align: 'right' as const }] : []),
  ];

  // Mobile column definitions (no sector/vol)
  const mobileColumns: { label: string; key: SortKey | null; align: 'left' | 'center' | 'right' }[] = [
    { label: '#', key: null, align: 'left' },
    { label: 'Stock', key: 'ticker', align: 'left' },
    { label: 'Price', key: 'price', align: 'right' },
    { label: 'Chg%', key: 'changePercent', align: 'right' },
  ];

  const columns = isMobile ? mobileColumns : desktopColumns;

  const SortableHeader = ({ col, sort, table }: { col: typeof columns[0]; sort: SortState; table: 'gainer' | 'loser' }) => {
    const active = col.key !== null && sort.key === col.key;
    return (
      <th
        onClick={col.key ? () => toggleSort(table, col.key!) : undefined}
        style={{
          padding: isMobile ? '6px 4px' : '8px',
          textAlign: col.align,
          fontSize: isMobile ? '9px' : '10px',
          color: active ? ACCENT : TEXT3,
          fontWeight: active ? '700' : '500', textTransform: 'uppercase', letterSpacing: '0.5px',
          position: 'sticky', top: 0, backgroundColor: BG, zIndex: 1,
          cursor: col.key ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          {col.label}
          {active && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
        </span>
      </th>
    );
  };

  const px = isMobile ? '10px 12px' : '16px 20px';

  return (
    <div style={{ backgroundColor: BG, color: TEXT1, minHeight: '100vh', padding: px }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? '8px' : '0',
        marginBottom: '14px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px' }}>
              Market Movers
            </h1>
            {/* PATCH 0284 — Freshness chip from the lastUpdated stamp. */}
            <PanelFreshness
              dataUpdatedAt={lastUpdated ? lastUpdated.getTime() : 0}
              isFetching={isRefreshing}
              staleAfterMs={10 * 60_000}
              ageOverride={marketOpen ? undefined : (lastUpdated && Date.now() - lastUpdated.getTime() < 18 * 3600_000 ? 'closed' : undefined)}
            />
          </div>
          <p style={{ fontSize: '11px', color: TEXT3, margin: '2px 0 0' }}>
            NIFTY 500 + Midcap 250 + Smallcap 250 — {marketOpen ? 'Live from NSE' : 'Last close from NSE'}
            {!isMobile && allStocks.length > 0 && (
              <span style={{ marginLeft: '8px', color: TEXT2 }}>
                ({capCounts.large} Large · {capCounts.mid} Mid · {capCounts.small} Small)
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {isMobile && allStocks.length > 0 && (
            <span style={{ fontSize: '10px', color: TEXT3 }}>
              {capCounts.large}L · {capCounts.mid}M · {capCounts.small}S
            </span>
          )}
          <button onClick={() => fetchData(true)} disabled={isRefreshing} style={{
            padding: '6px 12px', borderRadius: '6px', border: `1px solid ${BORDER}`, backgroundColor: CARD, color: ACCENT,
            cursor: isRefreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
            opacity: isRefreshing ? 0.5 : 1, transition: 'all 0.2s',
          }}>
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {!isMobile && 'Refresh'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: TEXT3 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: GREEN, animation: 'pulse 2s ease infinite' }} />
            {formatTime(lastUpdated)}
          </div>
        </div>
      </div>

      {/* Summary Cards — 3 cols on mobile, 5 on desktop */}
      {!loading && allStocks.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)',
          gap: isMobile ? '6px' : '10px',
          marginBottom: '14px',
        }}>
          {[
            { l: 'Total', v: summary.total, c: TEXT1 },
            { l: 'Gainers', v: summary.gainersCount, c: GREEN },
            { l: 'Losers', v: summary.losersCount, c: RED },
            { l: 'Avg', v: `${summary.avgChange > 0 ? '+' : ''}${summary.avgChange.toFixed(2)}%`, c: summary.avgChange >= 0 ? GREEN : RED },
            { l: 'Sectors', v: summary.sectors, c: ACCENT },
          ].map((card, i) => (
            <div key={i} style={{
              backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px',
              padding: isMobile ? '8px 10px' : '12px',
              // On mobile, last card wraps to next row spanning full width? No — just show all 5 in 3+2 layout
              // Actually we'll let the last two flow naturally at 3-col
            }}>
              <div style={{ fontSize: isMobile ? '9px' : '10px', color: TEXT3, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.l}</div>
              <div style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: '700', color: card.c, fontVariantNumeric: 'tabular-nums' }}>{card.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters — scrollable row on mobile */}
      {!loading && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            display: 'flex', gap: '8px', alignItems: 'center',
            overflowX: 'auto', paddingBottom: '4px',
            // Hide scrollbar visually
            msOverflowStyle: 'none', scrollbarWidth: 'none',
          }} className="scrollbar-hide">
            {/* Cap filter */}
            <div style={{
              display: 'flex', gap: '2px', backgroundColor: CARD, padding: '3px',
              borderRadius: '8px', border: `1px solid ${BORDER}`, flexShrink: 0,
            }}>
              <CapPill label="All" value="All" count={allStocks.length} />
              <CapPill label="Large" value="Large" count={capCounts.large} />
              <CapPill label="Mid" value="Mid" count={capCounts.mid} />
              <CapPill label="Small" value="Small" count={capCounts.small} />
              {!isMobile && <CapPill label="Mid & Small" value="Mid & Small" count={capCounts.mid + capCounts.small} />}
            </div>

            <div style={{ width: '1px', height: '24px', backgroundColor: BORDER, flexShrink: 0 }} />

            {/* Move filters */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '9px', color: TEXT3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Up</span>
              <MoveChip token="+2%" label="+2%" color={GREEN} />
              <MoveChip token="+4%" label="+4%" color={GREEN} />
              {!isMobile && <MoveChip token="+6%" label="+6%" color={GREEN} />}
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '9px', color: TEXT3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dn</span>
              <MoveChip token="-2%" label="-2%" color={RED} />
              <MoveChip token="-4%" label="-4%" color={RED} />
              {!isMobile && <MoveChip token="-6%" label="-6%" color={RED} />}
            </div>

            {/* AUDIT_100 #44 — surface OR-union semantics inline so the user
                sees "Showing up ≥ +4%" instead of being confused about why
                selecting +4% AND +6% behaves like +4% alone. */}
            {moveTokens.size > 0 && (
              <span title="Move filters compose as OR — the loosest threshold defines the floor"
                    style={{ fontSize: '10px', color: TEXT3, fontStyle: 'italic', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {summarizeMoveFilter(moveTokens)}
              </span>
            )}

            {/* Sector dropdown */}
            <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} style={{
              padding: '5px 8px', backgroundColor: CARD, color: TEXT2, border: `1px solid ${BORDER}`,
              borderRadius: '8px', fontSize: '11px', outline: 'none', cursor: 'pointer', flexShrink: 0,
              maxWidth: isMobile ? '130px' : 'none',
            }}>
              {sectors.map(s => <option key={s} value={s}>{s === 'All' ? 'All Sectors' : s}</option>)}
            </select>

            {/* AUDIT_100 #65 — Earnings-day movers filter. Pivots the table to
                symbols that recently reported (earningsTickers map). */}
            {earningsTickers.size > 0 && (
              <button
                onClick={() => setEarningsOnly(v => !v)}
                title="Limit movers to symbols that recently reported earnings"
                style={{
                  padding: '5px 10px', borderRadius: '8px',
                  border: `1px solid ${earningsOnly ? 'var(--mc-warn)' : BORDER}`,
                  backgroundColor: earningsOnly ? 'rgba(245,158,11,0.12)' : CARD,
                  color: earningsOnly ? 'var(--mc-warn)' : TEXT3, fontSize: '11px',
                  cursor: 'pointer', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >📊 Earnings only ({earningsTickers.size})</button>
            )}

            {/* Clear button */}
            {hasActiveFilters && (
              <button onClick={clearAllFilters} style={{
                padding: '5px 10px', borderRadius: '6px', border: `1px solid ${BORDER}`,
                backgroundColor: 'rgba(239,68,68,0.08)', color: RED, fontSize: '11px',
                cursor: 'pointer', fontWeight: '500', flexShrink: 0, whiteSpace: 'nowrap',
              }}>Clear</button>
            )}
          </div>
        </div>
      )}

      {/* Sector Heatbar */}
      {!loading && sectorPerf.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }} className="scrollbar-hide">
            {sectorPerf.map(sp => (
              <button key={sp.sector} onClick={() => setSectorFilter(sectorFilter === sp.sector ? 'All' : sp.sector)} style={{
                flexShrink: 0,
                padding: isMobile ? '6px 10px' : '8px 14px',
                borderRadius: '8px', border: 'none',
                backgroundColor: sp.avg >= 0
                  ? `rgba(16,185,129,${Math.min(0.6, Math.abs(sp.avg) * 0.1 + 0.1)})`
                  : `rgba(239,68,68,${Math.min(0.6, Math.abs(sp.avg) * 0.1 + 0.1)})`,
                cursor: 'pointer', transition: 'all 0.15s',
                outline: sectorFilter === sp.sector ? `2px solid ${ACCENT}` : 'none', outlineOffset: '1px',
              }}>
                <div style={{ fontSize: isMobile ? '10px' : '11px', fontWeight: '600', color: TEXT1, whiteSpace: 'nowrap', marginBottom: '2px' }}>{sp.sector}</div>
                <div style={{ fontSize: isMobile ? '11px' : '13px', fontWeight: '700', color: sp.avg >= 0 ? GREEN : RED }}>{sp.avg > 0 ? '+' : ''}{sp.avg.toFixed(1)}%</div>
                {!isMobile && <div style={{ fontSize: '9px', color: TEXT3 }}>{sp.count} stocks</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
          <div style={{ width: '36px', height: '36px', border: '3px solid var(--mc-bg-4)', borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 14px', color: RED, fontSize: '13px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <span>⚠ {error}</span>
          <button onClick={() => { setError(null); }} style={{ padding: '5px 12px', borderRadius: '5px', border: '1px solid rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.12)', color: RED, cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
            ↻ Retry
          </button>
        </div>
      )}
      {/* Empty state when data fails entirely */}
      {!loading && !error && allStocks.length === 0 && (
        <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '48px 20px', textAlign: 'center', marginBottom: '16px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
          <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 6px' }}>No market data available</p>
          <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: '0 0 16px' }}>NSE data may be unavailable outside market hours or the backend is not running.</p>
        </div>
      )}

      {/* My Book Movers — pinned above the main list, computed off the FULL
          universe so book names bypass the volume floor + top-N slice. */}
      {!loading && allStocks.length > 0 && (
        <div style={{ marginBottom: '14px', backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: isMobile ? '13px' : '14px', fontWeight: '700' }}>💼 In Your Book</span>
            {bookMovers.length > 0 && (
              <span style={{ fontSize: '10px', color: GREEN, backgroundColor: 'rgba(16,185,129,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{bookMovers.length}</span>
            )}
            {!isMobile && (
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: TEXT3 }}>held · bench · watchlist — bypasses the volume floor</span>
            )}
          </div>
          {bookMovers.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: '11px', color: TEXT3 }}>
              {bookSet.size === 0
                ? 'No book yet — add holdings, conviction bench, or watchlist names to pin their moves here.'
                : 'No book names moving today.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: isMobile ? '340px' : '420px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {columns.map(col => (
                      <th key={col.label} style={{
                        padding: isMobile ? '6px 4px' : '8px', textAlign: col.align,
                        fontSize: isMobile ? '9px' : '10px', color: TEXT3, fontWeight: 500,
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        position: 'sticky', top: 0, backgroundColor: BG, zIndex: 1, whiteSpace: 'nowrap',
                      }}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookMovers.map((s, i) => isMobile
                    ? <MobileRow key={s.ticker} stock={s} rank={i + 1} up={s.changePercent >= 0} inBook />
                    : <Row key={s.ticker} stock={s} rank={i + 1} up={s.changePercent >= 0} inBook />
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Gainers / Losers tables */}
      {!loading && allStocks.length > 0 && (
        <div style={{
          display: 'grid',
          // Stack vertically on mobile and tablet
          gridTemplateColumns: isMobile ? '1fr' : isTablet ? '1fr' : '1fr 1fr',
          gap: '14px',
        }}>
          {/* Gainers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={15} color={GREEN} />
              <span style={{ fontSize: isMobile ? '13px' : '14px', fontWeight: '600' }}>Top Gainers</span>
              <span style={{ fontSize: '10px', color: GREEN, backgroundColor: 'rgba(16,185,129,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{gainers.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: GREEN, fontWeight: '700', backgroundColor: 'rgba(16,185,129,0.15)', padding: '2px 8px', borderRadius: '3px' }}>{marketOpen ? 'LIVE' : 'LAST CLOSE'}</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: isMobile ? '400px' : '550px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {columns.map(col => <SortableHeader key={col.label} col={col} sort={gainerSort} table="gainer" />)}
                  </tr>
                </thead>
                <tbody>
                  {gainers.map((s, i) => isMobile
                    ? <MobileRow key={s.ticker} stock={s} rank={i + 1} up={true} />
                    : <Row key={s.ticker} stock={s} rank={i + 1} up={true} />
                  )}
                  {gainers.length === 0 && <tr><td colSpan={columns.length} style={{ padding: '28px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No gainers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Losers */}
          <div style={{ backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingDown size={15} color={RED} />
              <span style={{ fontSize: isMobile ? '13px' : '14px', fontWeight: '600' }}>Top Losers</span>
              <span style={{ fontSize: '10px', color: RED, backgroundColor: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: '3px', fontWeight: '600' }}>{losers.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '9px', color: RED, fontWeight: '700', backgroundColor: 'rgba(239,68,68,0.15)', padding: '2px 8px', borderRadius: '3px' }}>{marketOpen ? 'LIVE' : 'LAST CLOSE'}</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: isMobile ? '400px' : '550px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: BG }}>
                    {columns.map(col => <SortableHeader key={col.label} col={col} sort={loserSort} table="loser" />)}
                  </tr>
                </thead>
                <tbody>
                  {losers.map((s, i) => isMobile
                    ? <MobileRow key={s.ticker} stock={s} rank={i + 1} up={false} />
                    : <Row key={s.ticker} stock={s} rank={i + 1} up={false} />
                  )}
                  {losers.length === 0 && <tr><td colSpan={columns.length} style={{ padding: '28px', textAlign: 'center', color: TEXT3, fontSize: '13px' }}>No losers match filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
