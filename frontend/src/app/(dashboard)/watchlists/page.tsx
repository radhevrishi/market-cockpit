'use client';

import { resolveFyYear } from '@/lib/calendar-dates';   // zzz897 — two-digit FY → nearest century (was `yy < 50 ? 20yy : 19yy`, wrong from 2050)
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation'; // PATCH 0914 — read ?tab=conviction
import { RefreshCw, Download, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { canonicalTicker } from '@/lib/ticker-normalize'; // PATCH 0721
import { CHAT_ID, BOT_SECRET } from '@/lib/config';
import { getConvictionList, removeConviction, syncFromEarningsOps, getBenchSince, setBenchSince, clearConvictionBeats, replaceConvictionFields, readConvictionBeats, type ConvictionEntry } from '@/lib/conviction-beats';
// zzz811 — the Conviction Beats filter lives in one module, shared with Portfolio Catalysts.
import { mergeCbEntries, serverBenchToCbEntries } from '@/lib/conviction-filter-india';
// zzz827 — words not numbers, EO growth text, the hidden-names report, the stale-tier re-sync, the PC snapshot.
import { cbServerReconcile } from '@/lib/india-cb-view';
// zzz823 — the SAME selection Portfolio Catalysts makes (book overlap + bench), and the saved-holdings book.

// zzz811 — resolveSector / NSE_SECTOR_MAP moved to lib/conviction-filter-india.ts.
import FundamentalsAnalyzerPage from '../fundamentals/page';
import PortfolioEarningsTab from './PortfolioEarningsTab'; // zzz283
import DecayWatch from '@/components/DecayWatch'; // zzz525 — 🪪 passport from bench rows // zzz514
// PATCH 0557 — BUG-AUDIT-2: backend-degraded banner.
import DegradedBanner from '@/components/DegradedBanner';
import { ConvictionBeatsPanel } from './ConvictionBeatsPanel';
import { EIEliteTab } from './EIEliteTab';
import { SummaryBar, WatchlistTable, EmptyState } from './components';
import { setStoredTickers, getStoredTickers, fetchStockQuotes, fetchIndividualQuotes } from './helpers';
import { type StockQuote, type SortField, type SortOrder } from './types';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function WatchlistsPage() {
  const [wlLight, toggleWlLight] = useWorkspaceLight(true);   // zzz954: shared white / dark choice (white by default)
  const [tickers, setTickers] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [tickerInput, setTickerInput] = useState('');
  const [sortField, setSortField] = useState<SortField>('ticker');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [watchlistFlags, setWatchlistFlags] = useState<Record<string, string>>({});

  // PATCH 0186 — Tab switcher: 'main' (existing user watchlist) vs 'conviction'
  // (auto-populated from Earnings Ops BLOCKBUSTER + STRONG cards).
  // PATCH 0914 — Honor ?tab=conviction in the URL so the Home Quick Access
  // chip "🏆 Conviction Beats" lands on the bench tab directly instead of
  // dropping users on the Main watchlist tab. User feedback: "even when
  // selecting conviction betas short cut its going to watchlist only why".
  const searchParams = useSearchParams();
  const initialTab: 'main' | 'conviction' =
    searchParams?.get('tab') === 'conviction' ? 'conviction' : 'main';
  const [activeTab, setActiveTab] = useState<'main' | 'conviction' | 'fundamentals' | 'ei-elite' | 'portfolio-earnings'>(initialTab);
  // Also react to URL changes mid-session (e.g. user clicks the chip again
  // from another page → SPA nav). Without this, the activeTab state from
  // the first render would stay on whatever tab was active.
  useEffect(() => {
    const t = searchParams?.get('tab');
    if (t === 'conviction' && activeTab !== 'conviction') setActiveTab('conviction');
    if (t === 'main' && activeTab !== 'main') setActiveTab('main');
    // Intentionally not depending on activeTab to avoid clobbering manual
    // tab clicks that don't update the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // PATCH 0874 — Init to empty array instead of reading LS in lazy-init.
  // The lazy-init reads localStorage which is unavailable during SSR,
  // returning [] on the server but the user's actual list on the client →
  // hydration mismatch on the conviction count and chip rail. The
  // existing useEffect below already hydrates from LS on mount.
  const [convictionEntries, setConvictionEntries] = useState<ConvictionEntry[]>([]);
  // zzz426 — hold the SERVER bench in state and merge it at render time so the
  // tab ALWAYS shows every server-confirmed BLOCKBUSTER/STRONG (e.g. RUBICON),
  // regardless of local scan history, prune bin, or sync quirks. The cron-
  // maintained 60-day server bench is authoritative for membership.
  const [serverBench, setServerBench] = useState<ConvictionEntry[]>([]);
  const [benchSince, setBenchSinceState] = useState<string | null>(null);   // zzz867
  const [rebuilding, setRebuilding] = useState(false);
  useEffect(() => {
    const r = () => setBenchSinceState(getBenchSince());
    r(); window.addEventListener('conviction-beats:updated', r); window.addEventListener('storage', r);
    return () => { window.removeEventListener('conviction-beats:updated', r); window.removeEventListener('storage', r); };
  }, []);
  const sinceOk = useCallback((e: any) => !benchSince || String(e?.filing_date || '') >= benchSince, [benchSince]);
  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v1/bench', { cache: 'no-store' });
        if (!r.ok) return;
        const j: any = await r.json();
        const ents: any[] = Array.isArray(j?.entries) ? j.entries : [];
        if (cancelled) return;
        // zzz811 — same mapping Portfolio Catalysts uses (lib/conviction-filter-india).
        const mapped: ConvictionEntry[] = serverBenchToCbEntries(ents);
        if (!cancelled) setServerBench(mapped);
        // zzz879 — grey (never delete) this browser's names the server no longer lists; only when the server sent a real list
        if (!cancelled && mapped.length >= 20) {
          try {
            const local = Object.entries(readConvictionBeats()).filter(([k]) => !k.includes('@')).map(([, v]) => v);
            const patches = cbServerReconcile(local, mapped.map((m) => m.ticker));
            if (patches.length) replaceConvictionFields(patches);
          } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  // Re-read on mount + listen for cross-tab updates
  useEffect(() => {
    setConvictionEntries(getConvictionList());
    if (typeof window === 'undefined') return;
    const refresh = () => setConvictionEntries(getConvictionList());
    window.addEventListener('conviction-beats:updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('conviction-beats:updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // zzz305 — Auto-populate CB bench from recent server graded data.
  // Bug: syncFromEarningsOps only fired when user visited /earnings-opportunities
  // for a specific date. New BLOCKBUSTER/STRONG entries for dates the user
  // never visited never landed. Fix: on /watchlists mount + every 10min,
  // pull last 14 days of graded data and sync any BB/ST. Dedupe logic in
  // syncFromEarningsOps handles same-filing upserts safely.
  const scanRef = useRef<null | (() => Promise<void>)>(null);
  const scannedDaysRef = useRef<Set<string>>(new Set());   // zzz883: past days already read in this visit
  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      const today = new Date();
      const dates: string[] = [];
      const sinceDay = getBenchSince();   // zzz867: no point reading days before the bench start date
      const span = sinceDay ? Math.min(45, Math.max(1, Math.ceil((today.getTime() - Date.parse(sinceDay + 'T00:00:00Z')) / 86400_000) + 1)) : 45;
      for (let i = 0; i < span; i++) {  // zzz421 — was 14; scan the full season so older BLOCKBUSTER/STRONG (RUBICON etc.) auto-populate
        const d = new Date(today.getTime() - i * 86400_000);
        dates.push(d.toISOString().slice(0, 10));
      }
      const entries: Array<any> = [];
      // zzz883 speed: a finished day never changes, so each past day is read once per visit (was every 10 minutes, one by one);
      // the last 2 days are re-read; reads go 6 at a time; nothing runs while the tab is hidden. The server bench (/api/v1/bench,
      // merged below) stays the complete record.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const recent = new Set(dates.slice(0, 2));
      const todo = dates.filter((d) => recent.has(d) || !scannedDaysRef.current.has(d));
      const payloads: Array<{ dstr: string; j: any }> = [];
      for (let i = 0; i < todo.length; i += 6) {
        if (cancelled) return;
        const got = await Promise.all(todo.slice(i, i + 6).map(async (dstr) => {
          try { const r = await fetch('/api/v1/earnings/graded?date=' + dstr); if (!r.ok) return null; return { dstr, j: await r.json() }; } catch { return null; }
        }));
        for (const g of got) if (g) { payloads.push(g); scannedDaysRef.current.add(g.dstr); }
      }
      for (const { j } of payloads) {
        if (cancelled) return;
        try {
          for (const tier of ['BLOCKBUSTER', 'STRONG'] as const) {
            for (const c of (j?.by_tier?.[tier] || [])) {
              let qParsed: 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined;
              let fyParsed: number | undefined;
              if (typeof c.quarter === 'string') {
                const qm = c.quarter.match(/Q([1-4])/i);
                if (qm) qParsed = ('Q' + qm[1]) as any;
                const fm = c.quarter.match(/FY\s?(\d{2})/i);
                if (fm) { const yy = parseInt(fm[1], 10); fyParsed = resolveFyYear(yy); }
              }
              entries.push({
                ticker: c.ticker, company: c.company, tier,
                composite_score: c.composite_score,
                sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
                filing_date: c.filing_date, sector: c.sector, market_cap_bucket: c.market_cap_bucket,
                market_cap_cr: (c as any).market_cap_cr ?? null,
                source_url: c.filing_url,
                ...(qParsed ? { quarter: qParsed } : {}),
                ...(fyParsed ? { fiscal_year: fyParsed } : {}),
                d1_pct: typeof (c as any).d1_pct === 'number' ? (c as any).d1_pct : null,
                gap_pct: typeof (c as any).gap_pct === 'number' ? (c as any).gap_pct : null,
                pead_score: typeof (c as any).pead_score === 'number' ? (c as any).pead_score : null,
                is_elite: (c as any).is_elite === true,
                multibagger_setup: (c as any).multibagger_setup === true,
                opm_pct: typeof (c as any).opm_pct === 'number' ? (c as any).opm_pct : null,
                opm_prev_pct: typeof (c as any).opm_prev_pct === 'number' ? (c as any).opm_prev_pct : null,
                pe: typeof (c as any).pe === 'number' ? (c as any).pe : null,
                cfo_to_pat_ratio: typeof (c as any).cfo_to_pat_ratio === 'number' ? (c as any).cfo_to_pat_ratio : null, // zzz304
                // QUALITY × INFLECTION — the second axis. Carried through this
                // mapper too, otherwise a bench row refreshed by THIS scan would
                // lose the quadrant the graded route just computed for it.
                quality_score: typeof (c as any).quality_score === 'number' ? (c as any).quality_score : null,
                inflection_score: typeof (c as any).inflection_score === 'number' ? (c as any).inflection_score : null,
                quadrant: typeof (c as any).quadrant === 'string' ? (c as any).quadrant : null,
              });
            }
          }
        } catch {}
      }
      if (cancelled || entries.length === 0) return;
      try { syncFromEarningsOps(entries); } catch {}
    };
    scanRef.current = scan;
    scan();
    const interval = setInterval(scan, 30 * 60 * 1000);   // zzz883: 30 min (was 10); only the last 2 days are re-read
    return () => { cancelled = true; scanRef.current = null; clearInterval(interval); };
  }, []);

  // zzz422 — merge the SERVER-authoritative Conviction bench (/api/v1/bench).
  // The client self-scan above only catches dates THIS browser happened to
  // open while they were healthy; the server bench is cron-maintained over 60
  // days (refresh-bench) and holds every BLOCKBUSTER/STRONG the pipeline graded.
  // Reading it here makes the tab complete regardless of local scan history
  // (this is why RUBICON etc. were missing). Detail fields backfill from the
  // graded self-scan on the same filing_date.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v1/bench', { cache: 'no-store' });
        if (!r.ok) return;
        const j: any = await r.json();
        const ents: any[] = Array.isArray(j?.entries) ? j.entries : [];
        if (cancelled || ents.length === 0) return;
        const mapped = ents
          .filter((e: any) => e && e.ticker && (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG'))
          .map((e: any) => {
            let qParsed: 'Q1'|'Q2'|'Q3'|'Q4'|undefined; let fyParsed: number|undefined;
            if (typeof e.quarter === 'string') {
              const qm = e.quarter.match(/Q([1-4])/i); if (qm) qParsed = ('Q'+qm[1]) as any;
              const fm = e.quarter.match(/FY\s?(\d{2})/i); if (fm) { const yy = parseInt(fm[1],10); fyParsed = resolveFyYear(yy); }
            }
            return {
              ticker: e.ticker, company: e.company || e.ticker, tier: e.tier,
              composite_score: e.composite_score ?? 0,
              sales_yoy_pct: null, net_profit_yoy_pct: null, eps_yoy_pct: null,
              filing_date: e.filing_date, sector: e.sector ?? null,
              market_cap_cr: e.market_cap_cr ?? null, move_pct: e.move_pct ?? null,
              ...(qParsed ? { quarter: qParsed } : {}), ...(fyParsed ? { fiscal_year: fyParsed } : {}),
            };
          });
        if (!cancelled && mapped.length) { try { syncFromEarningsOps(mapped as any); } catch {} }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const convictionCount = (() => {
    const set = new Set<string>();
    for (const e of convictionEntries) { if (!sinceOk(e)) continue; const t = String(e.ticker || '').toUpperCase(); if (t) set.add(t); }
    for (const e of serverBench) { if (!sinceOk(e)) continue; const t = String(e.ticker || '').toUpperCase(); if (t) set.add(t); }
    return set.size;
  })();  // zzz426 — count includes server-bench members

  // Flag cycle: ⚪ → 🟢 → 🟠 → 🔴 → ⚪
  // PATCH 0297 — Functional setState so rapid double-clicks always read the
  // latest flag state. The previous closure read `watchlistFlags[ticker]`
  // captured at render time, which could race when two clicks fired
  // back-to-back before re-render.
  const handleToggleFlag = useCallback(async (ticker: string) => {
    const cycle = ['', '🟢', '🟠', '🔴'];
    let nextFlag = '';
    setWatchlistFlags(prev => {
      const current = prev[ticker] || '';
      const idx = cycle.indexOf(current);
      nextFlag = cycle[(idx + 1) % cycle.length];
      return { ...prev, [ticker]: nextFlag };
    });
    // Persist to API — fire after state update; reads `nextFlag` from the
    // closure populated inside the setState callback above.
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: CHAT_ID, action: 'set-flag', symbol: ticker, flag: nextFlag }),
      });
    } catch {}
  }, []);

  // Initialize tickers from API first, fallback to localStorage
  useEffect(() => {
    const initTickers = async () => {
      // Try to sync with shared watchlist (remote is source of truth)
      // PATCH 0716 — 8s timeout + safe JSON parse + array shape guard.
      try {
        const _syncCtl = new AbortController();
        const _syncTimer = setTimeout(() => _syncCtl.abort(), 25_000); // PATCH 1037
        let syncData: any = {};
        try {
          const syncRes = await fetch(`/api/watchlist?chatId=${CHAT_ID}`, { signal: _syncCtl.signal });
          clearTimeout(_syncTimer);
          if (syncRes.ok) {
            try { syncData = await syncRes.json(); } catch { syncData = {}; }
          }
        } finally { clearTimeout(_syncTimer); }
        if (syncData && Array.isArray(syncData.watchlist) && syncData.watchlist.length > 0) {
          // Remote wins: use it as the authoritative source
          setTickers(syncData.watchlist);
          setStoredTickers(syncData.watchlist);
          // Load flags from API
          if (syncData.flags) setWatchlistFlags(syncData.flags);
          return;
        }
      } catch (e) {
        console.error('Failed to sync watchlist:', e);
      }

      // Fallback to localStorage if remote fetch failed or returned empty
      const stored = getStoredTickers();
      setTickers(stored);
    };

    initTickers();
  }, []);

  // Fetch quotes — bulk first, then individual for missing tickers
  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // AUDIT_100 #3 — fetch BOTH markets in parallel so US holdings
      // (NVDA / TSM / RKLB etc.) get live quotes alongside Indian names.
      const [india, us] = await Promise.all([
        fetchStockQuotes('india'),
        fetchStockQuotes('us'),
      ]);
      const bulkQuotes = [...india, ...us];

      // Step 2: Find tickers NOT in bulk response
      const bulkTickers = new Set(bulkQuotes.map(q => q.ticker));
      const missingTickers = tickers.filter(t => !bulkTickers.has(t));

      // Step 3: Fetch individual quotes for missing tickers (small/micro-cap)
      let allQuotes = bulkQuotes;
      if (missingTickers.length > 0) {
        console.log(`[Watchlist] Fetching ${missingTickers.length} individual quotes: ${missingTickers.join(', ')}`);
        const individualQuotes = await fetchIndividualQuotes(missingTickers);
        allQuotes = [...bulkQuotes, ...individualQuotes];
      }

      setQuotes(allQuotes);
      setLastRefresh(new Date());
      setLoading(false);
    } catch (error) {
      console.error('Error fetching quotes:', error);
      toast.error('Failed to fetch stock quotes');
      setLoading(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [tickers]);

  // Fetch data whenever tickers change (fixes race condition with async init)
  useEffect(() => {
    if (tickers.length > 0) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [tickers, fetchData]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (tickers.length === 0) return;

    // AUDIT_100 #7 — skip poll when tab is hidden
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchData();
    }, 60000);

    return () => clearInterval(interval);
  }, [tickers, fetchData]);

  // Build watchlist items — show ALL tickers, even without live quotes
  // PATCH 0690 — case-insensitive ticker lookup. Watchlist stored values
  // may be 'reliance' / 'NSE:RELIANCE' / 'RELIANCE'; the quotes API always
  // returns upper-case bare symbols. Normalize both sides before .find().
  // PATCH 0691 — Company column now resolves quote.company → quote.name →
  // ticker fallback; sector reads quote.sector with em-dash fallback. The
  // quotes API was updated in P0690 to return both `company` and `name`,
  // so older shapes still work via the chained fallback.
  const normalize = canonicalTicker; // PATCH 0721 — also strips .NS/.BO suffix now (was prefix-only)
  /*
   * PATCH 0965 BUG #7 — Volume + 52W High columns always rendered "—".
   *
   * Root cause: `fetchStockQuotes` (and `fetchIndividualQuotes`) correctly
   * pull `volume`, `week52High`, `week52Low`, `marketCap`, `peRatio`,
   * `avgVolume` from `/api/market/quotes` and tack them onto each
   * StockQuote. However the per-row `watchlistItems` mapping below only
   * forwarded a subset of fields (ticker, company, sector, price, change,
   * changePercent, dayHigh, dayLow, flag), DROPPING every optional
   * column. The WatchlistTable optional-column renderer then read
   * `(item as any)[c.id]` → undefined → '—' for all 70 stocks regardless
   * of how many times the user toggled the chooser. Fix: forward every
   * field the WatchlistItem type already declares.
   */
  const watchlistItems = useMemo(() => {
    return tickers.map(ticker => {
      const norm = normalize(ticker);
      const quote = quotes.find(q => normalize(q.ticker) === norm);
      return {
        ticker,
        company: quote?.company || (quote as any)?.name || ticker, // PATCH 0691
        sector: quote?.sector || '—', // PATCH 0691
        price: quote?.price || 0,
        change: quote?.change || 0,
        changePercent: quote?.changePercent || 0,
        dayHigh: quote?.dayHigh || 0,
        dayLow: quote?.dayLow || 0,
        flag: watchlistFlags[ticker] || null,
        // PATCH 0965 BUG #7 — forward optional columns from the quote so
        // the chooser actually surfaces them. Use `?? null` so a missing
        // value falls through to the "—" renderer rather than crashing.
        volume: (quote as any)?.volume ?? null,
        marketCap: (quote as any)?.marketCap ?? null,
        week52High: (quote as any)?.week52High ?? null,
        week52Low: (quote as any)?.week52Low ?? null,
        peRatio: (quote as any)?.peRatio ?? null,
        avgVolume: (quote as any)?.avgVolume ?? null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers, quotes, watchlistFlags]);

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...watchlistItems];
    sorted.sort((a, b) => {
      let aVal: any = (a as any)[sortField];
      let bVal: any = (b as any)[sortField];

      // zzz378 — string branch keyed on aVal only could call bVal.toLowerCase() on a
      // non-string; and null/NaN numerics compared with </> ordered blank-metric rows
      // arbitrarily. Guard both: strings compared case-insensitively, nullish sunk to end.
      if (typeof aVal === 'string' || typeof bVal === 'string') {
        const as = (aVal ?? '').toString().toLowerCase();
        const bs = (bVal ?? '').toString().toLowerCase();
        if (as < bs) return sortOrder === 'asc' ? -1 : 1;
        if (as > bs) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      }
      const an = (typeof aVal === 'number' && Number.isFinite(aVal)) ? aVal : (sortOrder === 'asc' ? Infinity : -Infinity);
      const bn = (typeof bVal === 'number' && Number.isFinite(bVal)) ? bVal : (sortOrder === 'asc' ? Infinity : -Infinity);
      if (an < bn) return sortOrder === 'asc' ? -1 : 1;
      if (an > bn) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [watchlistItems, sortField, sortOrder]);

  // Handle add ticker — supports comma/space separated, strips exchange prefixes, bulk paste
  const handleAddTicker = useCallback(() => {
    const raw = tickerInput.trim();
    if (!raw) return;

    // Split by comma, space, newline, semicolon — handle "NSE:CCL", "BOM:532067" prefixes
    const parsed = raw
      .toUpperCase()
      .split(/[\s,;\n\r]+/)
      .map(t => t.replace(/^(NSE|BSE|BOM|MCX):/, '').trim())
      .filter(t => t.length > 0 && t.length < 30 && /^[A-Z0-9&-]+$/.test(t));

    if (parsed.length === 0) {
      toast.error('No valid ticker symbols found');
      setTickerInput('');
      return;
    }

    // Deduplicate against existing AND within the input itself
    const existing = new Set(tickers);
    const seen = new Set<string>();
    const toAdd: string[] = [];
    const skipped: string[] = [];

    for (const t of parsed) {
      if (existing.has(t) || seen.has(t)) {
        skipped.push(t);
      } else {
        toAdd.push(t);
        seen.add(t);
      }
    }

    if (toAdd.length === 0) {
      toast.error(`All ${parsed.length} tickers already in watchlist`);
      setTickerInput('');
      return;
    }

    const prevTickers = [...tickers]; // snapshot for rollback
    const newTickers = [...tickers, ...toAdd];
    setTickers(newTickers);
    setStoredTickers(newTickers);
    setTickerInput('');

    const msg = skipped.length > 0
      ? `Added ${toAdd.length}, skipped ${skipped.length} (already in list). Total: ${newTickers.length}`
      : `${toAdd.length} ticker${toAdd.length > 1 ? 's' : ''} added. Total: ${newTickers.length}`;
    toast.success(msg);

    // Sync FULL list to shared API — roll back on failure
    fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
    })
      .then(res => {
        if (!res.ok) {
          setTickers(prevTickers); setStoredTickers(prevTickers);
          toast.error('Failed to save — changes reverted');
        }
      })
      .catch(() => {
        setTickers(prevTickers); setStoredTickers(prevTickers);
        toast.error('Network error — changes reverted');
      });

    setTimeout(() => fetchData(), 500);
  }, [tickerInput, tickers, fetchData]);

  // Handle ticker search selection (single ticker from autocomplete)
  const handleSearchSelect = useCallback((rawTicker: string, suggestion?: TickerSuggestion) => {
    // If it looks like bulk paste (has commas), delegate to bulk handler
    if (rawTicker.includes(',') || rawTicker.includes(' ') || rawTicker.includes('\n')) {
      setTickerInput(rawTicker);
      // Trigger bulk add after state update
      setTimeout(() => {
        const parsed = rawTicker.toUpperCase().split(/[\s,;\n\r]+/)
          .map(t => t.replace(/^(NSE|BSE|BOM|MCX):/, '').trim())
          .filter(t => t.length > 0 && t.length < 30 && /^[A-Z0-9&-]+$/.test(t));
        const existing = new Set(tickers);
        const toAdd = parsed.filter(t => !existing.has(t));
        if (toAdd.length === 0) { toast.error('All tickers already in watchlist'); return; }
        const newTickers = [...tickers, ...toAdd];
        setTickers(newTickers);
        setStoredTickers(newTickers);
        toast.success(`${toAdd.length} ticker${toAdd.length > 1 ? 's' : ''} added. Total: ${newTickers.length}`);
        fetch('/api/watchlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
        }).catch(console.error);
        setTimeout(() => fetchData(), 500);
      }, 0);
      return;
    }

    // Single ticker add
    const symbol = rawTicker.toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '').trim();
    if (!symbol || !/^[A-Z0-9&-]+$/.test(symbol)) { toast.error('Invalid ticker'); return; }
    if (tickers.includes(symbol)) { toast.error(`${symbol} already in watchlist`); return; }

    const prevTickers = [...tickers];
    const newTickers = [...tickers, symbol];
    setTickers(newTickers);
    setStoredTickers(newTickers);
    toast.success(`${symbol} added to watchlist. Total: ${newTickers.length}`);
    // AUDIT_100 #27 — scroll the new row into view. With 60+ stocks the user
    // has to manually search for what they just added; data-ticker attribute
    // on each row lets us find + scroll the freshly-inserted one.
    setTimeout(() => {
      try {
        const el = document.querySelector(`[data-watchlist-ticker="${symbol}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {}
    }, 600);

    fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
    })
      .then(res => {
        if (!res.ok) { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error(`${symbol} — save failed, reverted`); }
      })
      .catch(() => { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error('Network error — reverted'); });
    setTimeout(() => fetchData(), 500);
  }, [tickers, fetchData]);

  // Build suggestions from quotes for autocomplete
  const searchSuggestions = useMemo((): TickerSuggestion[] => {
    return quotes.map(q => ({
      ticker: q.ticker,
      company: q.company || q.ticker,
      sector: q.sector || '—',
      price: q.price || 0,
      changePercent: q.changePercent || 0,
    }));
  }, [quotes]);

  // Handle remove ticker — with rollback on failure
  const handleRemoveTicker = useCallback((ticker: string) => {
    const prevTickers = [...tickers];
    const newTickers = tickers.filter(t => t !== ticker);
    setTickers(newTickers);
    setStoredTickers(newTickers);
    toast.success(`${ticker} removed from watchlist`);

    fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID, watchlist: newTickers, secret: BOT_SECRET }),
    })
      .then(res => {
        if (!res.ok) { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error(`${ticker} — remove failed, reverted`); }
      })
      .catch(() => { setTickers(prevTickers); setStoredTickers(prevTickers); toast.error('Network error — reverted'); });
  }, [tickers]);

  // Handle sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField, sortOrder]);

  // Handle export XLSX
  const handleExportXLSX = useCallback(async () => {
    if (sortedItems.length === 0) {
      toast.error('No items to export');
      return;
    }
    const XLSX = await import('xlsx');

    const data = sortedItems.map((item, i) => ({
      '#': i + 1,
      'Ticker': item.ticker,
      'Company': item.company,
      'Sector': item.sector,
      'CMP (₹)': item.price,
      'Change %': parseFloat(item.changePercent.toFixed(2)),
      'Day High': item.dayHigh,
      'Day Low': item.dayLow,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 16 },
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Watchlist');
    XLSX.writeFile(wb, `watchlist_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Exported watchlist to XLSX');
  }, [sortedItems]);

  return (
    <div className={workspaceThemeClass(wlLight, true)} style={{ padding: '24px', background: 'var(--mc-bg-0)', minHeight: '100%' }}>
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* PATCH 0557 — backend-degraded banner. */}
      <DegradedBanner />
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          {activeTab !== 'conviction' && (<>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 4px' }}>Watchlist</h1>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>Tracking universe · Observation only · No P&L</p>
          </>)}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <WorkspaceThemeToggle light={wlLight} onToggle={toggleWlLight} style={{ borderRadius: 10, padding: '10px 14px', fontWeight: 600 }} />
          <button
            onClick={() => fetchData()}
            disabled={isRefreshing}
            title="Refresh data"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--mc-bg-2)',
              border: '1px solid var(--mc-border-2)',
              borderRadius: '10px',
              padding: '10px 14px',
              color: 'var(--mc-text-3)',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'all 0.2s',
              opacity: isRefreshing ? 0.6 : 1,
            }}
            onMouseEnter={e => !isRefreshing && (e.currentTarget.style.backgroundColor = '#2A3B4C')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1A2B3C')}
          >
            <RefreshCw style={{ width: '14px', height: '14px', transform: isRefreshing ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.6s linear' }} />
            Refresh
          </button>
          <button
            onClick={handleExportXLSX}
            disabled={sortedItems.length === 0}
            title="Export to XLSX"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--mc-bg-2)',
              border: '1px solid var(--mc-border-2)',
              borderRadius: '10px',
              padding: '10px 14px',
              color: 'var(--mc-text-3)',
              cursor: sortedItems.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'all 0.2s',
              opacity: sortedItems.length === 0 ? 0.4 : 1,
            }}
            onMouseEnter={e => sortedItems.length > 0 && (e.currentTarget.style.backgroundColor = '#2A3B4C')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#1A2B3C')}
          >
            <Download style={{ width: '14px', height: '14px' }} />
            Export
          </button>
        </div>
      </div>

      {/* ── Tab switcher (PATCH 0186) ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--mc-border-2)', marginBottom: '20px' }}>
        <button onClick={() => setActiveTab('main')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'main' ? 'var(--mc-cyan)' : 'transparent'}`,
            color: activeTab === 'main' ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          📋 My Watchlist
          <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{tickers.length}</span>
        </button>
        <button onClick={() => setActiveTab('fundamentals')} style={{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid ' + (activeTab === 'fundamentals' ? '#39d0d8' : 'transparent'), color: activeTab === 'fundamentals' ? '#39d0d8' : 'var(--mc-text-3)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>📈 Fundamentals</button>
            <button onClick={() => setActiveTab('conviction')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'conviction' ? 'var(--mc-warn)' : 'transparent'}`,
            color: activeTab === 'conviction' ? 'var(--mc-warn)' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          <Award style={{ width: 13, height: 13 }} />
          Conviction Beats
          <span style={{
            fontSize: 10, fontWeight: 800,
            padding: '1px 6px', borderRadius: 8,
            backgroundColor: convictionCount > 0 ? 'color-mix(in srgb, var(--mc-warn) 13%, transparent)' : 'var(--mc-bg-2)',
            color: convictionCount > 0 ? 'var(--mc-warn)' : 'var(--mc-text-4)',
          }}>{convictionCount}</span>
        </button>
        {/* zzz261 — EI Elite tab: EXCELLENT+STRONG from Earnings Intelligence, auto-synced */}
        <button onClick={() => setActiveTab('ei-elite')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'ei-elite' ? '#8B5CF6' : 'transparent'}`,
            color: activeTab === 'ei-elite' ? '#8B5CF6' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          🎖️ EI Elite
        </button>
        {/* zzz283 — Portfolio Earnings tab */}
        <button onClick={() => setActiveTab('portfolio-earnings')}
          style={{
            padding: '10px 16px', background: 'none',
            border: 'none', borderBottom: `2px solid ${activeTab === 'portfolio-earnings' ? '#22C55E' : 'transparent'}`,
            color: activeTab === 'portfolio-earnings' ? '#22C55E' : 'var(--mc-text-3)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          💼 Portfolio Earnings
        </button>
      </div>

      {activeTab === 'portfolio-earnings' ? <PortfolioEarningsTab /> : activeTab === 'ei-elite' ? <EIEliteTab /> : activeTab === 'fundamentals' ? <FundamentalsAnalyzerPage scope="watchlist" /> : activeTab === 'conviction' ? (
        <>
        <ConvictionBeatsPanel
          entries={mergeCbEntries(convictionEntries, serverBench).filter(sinceOk) /* zzz426 merge server bench — zzz811: shared with Portfolio Catalysts */}
          onRemove={(t) => { removeConviction(t); setConvictionEntries(getConvictionList()); }}
          /* PATCH zzz99 — bulk Clear All for Conviction Beats. Iterates the
             current list and removes each ticker via the same per-entry API
             so the storage layer, the 'conviction-beats:updated' event, and
             any cross-tab listeners all fire exactly as they do on × clicks.
             Snapshot ticker list first because removeConviction mutates the
             source the snapshot is derived from. */
          benchSince={benchSince}
          seasonBusy={rebuilding}
          onClearAll={() => {
            // zzz867: wipe the local bench AND set the start date to today, so the 45-day self-scan and the 60-day server bench cannot put old names back
            try { clearConvictionBeats(); } catch {}
            try { if (typeof window !== 'undefined') { window.localStorage.removeItem('mc:conviction-beats'); window.localStorage.removeItem('conviction-beats'); } } catch {}
            setBenchSince(isoDaysAgo(0));
            setConvictionEntries(getConvictionList());
          }}
          onRebuild={async (days: number) => {
            // zzz867: start a new earnings season: wipe, set the start date to N days ago, then read just those days again
            setRebuilding(true);
            try {
              try { clearConvictionBeats(); } catch {}
              setBenchSince(isoDaysAgo(days));
              setConvictionEntries(getConvictionList());
              await scanRef.current?.();
            } finally { setConvictionEntries(getConvictionList()); setRebuilding(false); }
          }}
          onShowAll={() => { setBenchSince(null); scanRef.current?.(); }}
        />
        <DecayWatch />{/* zzz514 — moved below the panel per request */}
        </>
      ) : (
      <>
      {/* ── Add Ticker Search ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <TickerSearch
            onSelect={handleSearchSelect}
            quotes={searchSuggestions}
            existingTickers={tickers}
            placeholder="Search company name or ticker... (or paste bulk: INFY, TCS, RELIANCE)"
            allowBulk={true}
            clearOnSelect={true}
          />
        </div>
      </div>

      {/* ── Summary ───────────────────────────────────────────────────────── */}
      {tickers.length > 0 && <SummaryBar items={sortedItems} />}

      {/* ── Loading State ─────────────────────────────────────────────────── */}
      {loading && tickers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              style={{
                height: '48px',
                backgroundColor: 'var(--mc-bg-2)',
                border: '1px solid var(--mc-border-2)',
                borderRadius: '10px',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
          ))}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!loading && tickers.length > 0 && (
        <div>
          <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>
              {sortedItems.length} stocks · Last refreshed: {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
            </p>
          </div>
          <WatchlistTable
            items={sortedItems}
            sortField={sortField}
            sortOrder={sortOrder}
            onSort={handleSort}
            onRemove={handleRemoveTicker}
            onToggleFlag={handleToggleFlag}
          />
        </div>
      )}

      {/* ── Empty State ───────────────────────────────────────────────────── */}
      {!loading && tickers.length === 0 && <EmptyState />}

      {/* ── Telegram Sync Info ────────────────────────────────────────────── */}
      {tickers.length > 0 && (
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '10px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'var(--mc-text-3)', margin: 0 }}>
            💬 Your watchlist syncs with <span style={{ fontWeight: '600', color: 'var(--mc-info)' }}>@mc_watchlist_pulse_bot</span>
          </p>
        </div>
      )}
      </>
      )}

      {/* ── CSS Animation ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
    </div>
  );
}
