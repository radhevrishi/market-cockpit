'use client';

import { resolveFyYear } from '@/lib/calendar-dates';   // zzz897 — two-digit FY → nearest century (was `yy < 50 ? 20yy : 19yy`, wrong from 2050)
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; // PATCH 0914 — read ?tab=conviction
import { RefreshCw, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import TickerSearch, { type TickerSuggestion } from '@/components/TickerSearch';
import { canonicalTicker } from '@/lib/ticker-normalize'; // PATCH 0721
import { quoteNumbers } from '@/lib/watchlist-export';
import { CHAT_ID } from '@/lib/config';
import { findInList, buildMembershipIndex, membershipsFor, isBulkQuery } from '@/lib/watchlist-find'; // zzz972
import { CHART_WATCHLISTS_KEY } from '@/lib/chart-watchlist'; // zzz972 — read-only: which chart lists hold a company
import { getConvictionTickers, getConvictionList, removeConviction, syncFromEarningsOps, getBenchSince, setBenchSince, clearConvictionBeats, replaceConvictionFields, readConvictionBeats, type ConvictionEntry } from '@/lib/conviction-beats';
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
import { ConvictionAnalytics } from '@/components/conviction-analytics/ConvictionAnalytics';
import { EIEliteTab } from './EIEliteTab';
import { SummaryBar, WatchlistTable, EmptyState, WatchlistExportControl, SaveStatusStrip } from './components';
import { buildWatchlistExport, type ExportScope } from '@/lib/watchlist-export';
import { writeReviewQueue } from '@/lib/screener/workflow';
import { STANDALONE_WATCHLIST_ID, chartReviewUrl, watchlistReviewItems } from '@/lib/watchlist-chart-handoff';
import { setStoredTickers, getStoredTickers, fetchStockQuotes, fetchIndividualQuotes } from './helpers';
import { type StockQuote, type SortField, type SortOrder, type WatchlistItem } from './types';
import { useWorkspaceLight, workspaceThemeClass } from '@/lib/workspace-theme';
import WorkspaceThemeToggle from '@/components/WorkspaceThemeToggle';
import { WLP_CSS } from './watchlists-css';
// zzz1044c — save logic for this list (F08 empty list is the truth, F09 checked flag saves, F10 one write at a time).
import { decideInitialWatchlist, WatchlistMutationQueue, FlagSync, flagView, EMPTY_LIST_SNAPSHOT, type ListSyncSnapshot, type FlagState, type WatchlistReadResult } from '@/lib/watchlist-sync';
import { postWatchlistList, postWatchlistFlag, describeListOp } from './watchlist-save';
// zzz1045d — list source + compare with chart lists, quote time vs last refreshed, no-quote names, changes since review
import { standaloneSource } from '@/lib/watchlist-compare';
import { indexAverages, pctFrom, screenerKey, type AvgRow } from '@/lib/watchlist-averages';
import { quoteTimeOf, quoteTimeSummary, unresolvedSymbols, tradedValue, buildReview, changesSinceReview, loadReview, saveReview, DEFAULT_REVIEW_THRESHOLD, type ReviewSnapshot } from '@/lib/watchlist-review';
import { ComparePanel } from './ComparePanel';
import { parseListSymbol, resolveListQuote } from '@/lib/instrument-id';   // zzz1076 (B01)
import { fmtClock } from './components';
import nextDynamic from 'next/dynamic';
import { chartListOptions } from '@/lib/alerts/chart-lists';
// zzz1054 — "Create alert on My Watchlist" (dialog loaded only when opened)
const CreateAlertDialog = nextDynamic(() => import('@/components/alerts/CreateAlertDialog'), { ssr: false });

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function WatchlistsPage() {
  const [wlLight, toggleWlLight] = useWorkspaceLight(true);   // zzz954: shared white / dark choice (white by default)
  // zzz1044c (F10) — the list lives in one save queue: what you see = last saved list + changes still saving.
  const [listSync, setListSync] = useState<ListSyncSnapshot>(EMPTY_LIST_SNAPSHOT);
  const [listQueue] = useState(() => new WatchlistMutationQueue({
    send: postWatchlistList,
    onChange: (snap) => { setListSync(snap); setStoredTickers(snap.tickers); },
    onFailed: (ops, error) => toast.error(`${ops.map(describeListOp).join(', ')} — not saved (${error}), undone`),
  }));
  const tickers = listSync.tickers;
  // zzz1045d — where the list on screen was read from (server, or this browser's copy when the read failed) and when
  const [listOrigin, setListOrigin] = useState<{ readFrom: 'server' | 'browser-copy' | null; reason: string | null; readAt: number | null }>({ readFrom: null, reason: null, readAt: null });
  const [compareOpen, setCompareOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);   // zzz1054
  const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewPct, setReviewPct] = useState<number>(DEFAULT_REVIEW_THRESHOLD);
  useEffect(() => {   // browser storage is read after mount (no SSR mismatch)
    const t = setTimeout(() => { const r = loadReview(); if (r) setReview(r); }, 0);
    return () => clearTimeout(t);
  }, []);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [tickerInput, setTickerInput] = useState('');
  const [findQuery, setFindQuery] = useState(''); // zzz972 — the search box also narrows the rows already in the list
  const [sortField, setSortField] = useState<SortField>('ticker');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // zzz1044c (F09) — flags: next value worked out outside React's updater, the server's answer checked.
  const [flagState, setFlagState] = useState<FlagState>({});
  const [flagSync] = useState(() => new FlagSync({
    send: postWatchlistFlag,
    onChange: setFlagState,
    onFailed: (t) => toast.error(`${t} flag not saved — click ⚠ to retry`),
  }));

  // PATCH 0186 — Tab switcher: 'main' (existing user watchlist) vs 'conviction'
  // (auto-populated from Earnings Ops BLOCKBUSTER + STRONG cards).
  // PATCH 0914 — Honor ?tab=conviction in the URL so the Home Quick Access
  // chip "🏆 Conviction Beats" lands on the bench tab directly instead of
  // dropping users on the Main watchlist tab. User feedback: "even when
  // selecting conviction betas short cut its going to watchlist only why".
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab: 'main' | 'conviction' | 'cb-analytics' =
    searchParams?.get('tab') === 'conviction' ? 'conviction' : searchParams?.get('tab') === 'cb-analytics' ? 'cb-analytics' : 'main';
  const [activeTab, setActiveTab] = useState<'main' | 'conviction' | 'cb-analytics' | 'fundamentals' | 'ei-elite' | 'portfolio-earnings'>(initialTab);
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
  // zzz1044c (F09) — was: next flag written to a variable inside a setState updater (React does not promise it ran
  // before the request was built), response.ok ignored, errors swallowed. Now FlagSync works the next flag out from
  // the visible one, saves one at a time per company, and on failure puts the last saved flag back and marks the row.
  const handleToggleFlag = useCallback((ticker: string) => { flagSync.click(ticker); }, [flagSync]);
  const handleRetryFlag = useCallback((ticker: string) => { flagSync.retry(ticker); }, [flagSync]);

  // Initialize tickers from API first, fallback to localStorage
  // zzz1044c (F08) — a successful empty list is the truth (a deliberate clear stays cleared). This browser's copy is
  // used only when the read failed (network / HTTP error / unreadable / wrong shape) or the server has no record.
  useEffect(() => {
    const initTickers = async () => {
      let read: WatchlistReadResult;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000); // PATCH 1037
      try {
        const res = await fetch(`/api/watchlist?chatId=${CHAT_ID}`, { signal: ctl.signal, cache: 'no-store' });
        let body: unknown = undefined; let parseFailed = false;
        try { body = await res.json(); } catch { parseFailed = true; }
        read = { kind: 'response', ok: res.ok, status: res.status, body, parseFailed };
      } catch (error) {
        read = { kind: 'error', error };
      } finally { clearTimeout(timer); }
      const decision = decideInitialWatchlist(read);
      if (decision.use === 'remote') {
        listQueue.reset(decision.tickers);
        flagSync.loadServer(decision.flags);
        setListOrigin({ readFrom: 'server', reason: null, readAt: Date.now() });
        return;
      }
      if (decision.reason !== 'no-record') console.warn(`[Watchlist] shared list not read (${decision.reason}) — showing this browser's copy`);
      listQueue.reset(getStoredTickers());
      setListOrigin({ readFrom: 'browser-copy', reason: decision.reason, readAt: Date.now() });
    };

    initTickers();
  }, [listQueue, flagSync]);

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
      const bulkTickers = new Set(bulkQuotes.map(q => `${q.market || 'IN'}:${q.ticker}`));
      // zzz1076 (B01) — a "US:X" name is never sent to the NSE single-quote fallback; a bare name is missing only when
      // neither market has it
      const missingTickers = tickers.filter(t => {
        const i = parseListSymbol(t);
        if (i.m === 'US') return false;
        return !bulkTickers.has(`IN:${i.t}`) && (i.m === 'IN' || !bulkTickers.has(`US:${i.t}`));
      }).map(t => parseListSymbol(t).t);

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
  // zzz1045 — the daily 50 / 200-day averages of the listed names (stock screener snapshot, a few KB per market)
  const [avgs, setAvgs] = useState<Record<string, AvgRow>>({});
  const avgKey = tickers.map(screenerKey).sort().join(',');
  useEffect(() => {
    if (!avgKey) return;
    const ctrl = new AbortController();
    const list = avgKey.split(',').slice(0, 400).join(',');
    Promise.all((['IN', 'US'] as const).map((m) => fetch(`/api/v1/stock-screener?market=${m}&tickers=${encodeURIComponent(list)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j && Array.isArray(j.rows) ? { m, rows: j.rows as AvgRow[] } : null)).catch(() => null)))
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const next: Record<string, AvgRow> = {};
        for (const x of res) if (x) for (const [k, v] of Object.entries(indexAverages(x.rows))) next[`${x.m}:${k}`] = v;
        setAvgs(next);
      });
    return () => ctrl.abort();
  }, [avgKey]);
  const watchlistItems = useMemo(() => {
    return tickers.map(ticker => {
      // zzz1076 (B01) — by instrument: "US:HAL" takes only the USA quote, "NSE:HAL" only the India one; a bare name quoted
      // in BOTH markets shows the India quote (as before) and is marked "market unclear"
      const res = resolveListQuote(ticker, quotes, normalize);
      const quote = res.quote;
      return {
        ticker,
        marketAmbiguous: res.ambiguous,
        company: quote?.company || (quote as any)?.name || ticker, // PATCH 0691
        sector: quote?.sector || '—', // PATCH 0691
        // zzz1000 (CW-01) — unknown numbers stay null ('—' on screen, blank in the export); a real 0% change stays 0
        ...quoteNumbers(quote),
        market: res.ambiguous ? quote?.market : (res.market ?? quote?.market),
        flag: flagView(flagState, ticker).flag || null,
        flagStatus: flagView(flagState, ticker).status,   // zzz1044c (F09) — saving / not saved
        flagFailed: flagView(flagState, ticker).failedFlag,
        // PATCH 0965 BUG #7 — forward optional columns from the quote so
        // the chooser actually surfaces them. Use `?? null` so a missing
        // value falls through to the "—" renderer rather than crashing.
        volume: (quote as any)?.volume ?? null,
        marketCap: (quote as any)?.marketCap ?? null,
        week52High: (quote as any)?.week52High ?? null,
        week52Low: (quote as any)?.week52Low ?? null,
        peRatio: (quote as any)?.peRatio ?? null,
        avgVolume: (quote as any)?.avgVolume ?? null,
        // zzz1045d — when the price is from; traded value = price × volume of the same quote
        quoteTime: quote?.quoteTime ?? null,
        priceSource: quote?.priceSource ?? null,
        staleEOD: quote?.staleEOD ?? null,
        tradedValue: tradedValue(quoteNumbers(quote).price, (quote as any)?.volume ?? null),
        ...(() => {
          const a = avgs[`${quote?.market === 'US' ? 'US' : 'IN'}:${screenerKey(ticker)}`];
          const p = quoteNumbers(quote).price;
          return { pct50: pctFrom(p, a?.sma50), pct200: pctFrom(p, a?.sma200) };
        })(),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers, quotes, flagState, avgs]);

  // zzz1045d — "changes since last review": rows that moved by at least reviewPct % since "Mark reviewed"
  const reviewDiff = useMemo(() => changesSinceReview(watchlistItems, review, reviewPct), [watchlistItems, review, reviewPct]);
  const reviewedItems = useMemo(() => watchlistItems.map((it): WatchlistItem => {
    const c = reviewDiff.changed[it.ticker];
    return c ? { ...it, reviewPct: c.pct } : it;
  }), [watchlistItems, reviewDiff]);
  const reviewCount = Object.keys(reviewDiff.changed).length;
  const markReviewed = useCallback(() => {
    const snap = buildReview(watchlistItems, Date.now());
    setReview(snap);
    setReviewOnly(false);
    if (saveReview(snap)) toast.success(`Marked ${Object.keys(snap.prices).length} prices as reviewed`);
    else toast.error('Reviewed for this visit only — this browser did not let the page save it');
  }, [watchlistItems]);
  const unresolved = useMemo(() => (quotes.length ? unresolvedSymbols(watchlistItems) : []), [quotes.length, watchlistItems]);
  const quoteSummary = useMemo(() => quoteTimeSummary(watchlistItems.map((i) => quoteTimeOf({ price: i.price, quoteTime: i.quoteTime, priceSource: i.priceSource, staleEOD: i.staleEOD }, fmtClock)), fmtClock), [watchlistItems]);
  // zzz1076 (B01) — the market a name was priced in; undefined when it is not known or quoted in both markets (never guessed)
  const marketOf = useCallback((t: string) => { const i = watchlistItems.find((x) => x.ticker === t); return i && !(i as any).marketAmbiguous ? i.market : undefined; }, [watchlistItems]);
  const sourceLine = standaloneSource({ ...listOrigin, savedAt: listSync.savedAt ?? null }, fmtClock);

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...reviewedItems];
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
  }, [reviewedItems, sortField, sortOrder]);

  // Handle add ticker — supports comma/space separated, strips exchange prefixes, bulk paste
  const handleAddTicker = useCallback(() => {
    const raw = tickerInput.trim();
    if (!raw) return;

    // Split by comma, space, newline, semicolon — handle "NSE:CCL", "BOM:532067" prefixes
    const parsed = raw
      .toUpperCase()
      .split(/[\s,;\n\r]+/)
      .map(t => t.replace(/^(NSE|BSE|BOM|MCX):/, '').trim())
      // zzz1076 (B01) — a USA prefix keeps the market: NYSE:HAL / NASDAQ:X / AMEX:X / US:X are stored as "US:X"
      .map(t => t.replace(/^(NYSE|NASDAQ|AMEX|ARCA|US):/, 'US:'))
      .filter(t => t.length > 0 && t.length < 33 && /^(US:)?[A-Z0-9&.-]+$/.test(t));

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

    // zzz1044c (F10) — one queued change; a failed save undoes only this change (later ones stay).
    const total = tickers.length + toAdd.length;
    listQueue.enqueue('add', toAdd);
    setTickerInput('');

    const msg = skipped.length > 0
      ? `Added ${toAdd.length}, skipped ${skipped.length} (already in list). Total: ${total}`
      : `${toAdd.length} ticker${toAdd.length > 1 ? 's' : ''} added. Total: ${total}`;
    toast.success(msg);

    setTimeout(() => fetchData(), 500);
  }, [tickerInput, tickers, fetchData, listQueue]);

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
        const current = listQueue.snapshot().tickers;   // zzz1044c — the latest list, not this render's copy
        const existing = new Set(current);
        const toAdd = [...new Set(parsed.filter(t => !existing.has(t)))];
        if (toAdd.length === 0) { toast.error('All tickers already in watchlist'); return; }
        listQueue.enqueue('add', toAdd);   // zzz1044c (F10) — was fire-and-forget with no rollback
        toast.success(`${toAdd.length} ticker${toAdd.length > 1 ? 's' : ''} added. Total: ${current.length + toAdd.length}`);
        setTimeout(() => fetchData(), 500);
      }, 0);
      return;
    }

    // Single ticker add
    const symbol = rawTicker.toUpperCase().replace(/^(NSE|BSE|BOM|MCX):/, '').trim();
    if (!symbol || !/^[A-Z0-9&-]+$/.test(symbol)) { toast.error('Invalid ticker'); return; }
    if (tickers.includes(symbol)) { toast.error(`${symbol} already in watchlist`); return; }

    listQueue.enqueue('add', [symbol]);   // zzz1044c (F10)
    toast.success(`${symbol} added to watchlist. Total: ${tickers.length + 1}`);
    // AUDIT_100 #27 — scroll the new row into view. With 60+ stocks the user
    // has to manually search for what they just added; data-ticker attribute
    // on each row lets us find + scroll the freshly-inserted one.
    setTimeout(() => {
      try {
        const el = document.querySelector(`[data-watchlist-ticker="${symbol}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {}
    }, 600);

    setTimeout(() => fetchData(), 500);
  }, [tickers, fetchData, listQueue]);

  // Build suggestions from quotes for autocomplete
  const searchSuggestions = useMemo((): TickerSuggestion[] => {
    return quotes.map(q => ({
      ticker: q.ticker,
      company: q.company || q.ticker,
      sector: q.sector || '—',
      price: q.price ?? 0,
      changePercent: q.changePercent ?? 0,
    }));
  }, [quotes]);

  // zzz972 — rows matching the search box (ticker or company); empty box = all rows.
  const findActive = findQuery.trim().length > 0 && !isBulkQuery(findQuery);
  const visibleItems = useMemo(() => {
    const found = findInList(sortedItems, findQuery);
    return reviewOnly ? found.filter((i) => i.reviewPct != null) : found;   // zzz1045d
  }, [sortedItems, findQuery, reviewOnly]);

  // zzz972 — which lists already hold a suggested company. Read-only, re-read from this browser while typing.
  const membershipIndex = useMemo(() => {
    const readJson = (key: string): unknown => {
      try { const r = window.localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
    };
    if (typeof window === 'undefined' || !findActive) return buildMembershipIndex({});
    let conviction: string[] = [];
    try { conviction = [...getConvictionTickers(), ...convictionEntries.map((e) => String(e.ticker || '')), ...serverBench.map((e) => String(e.ticker || ''))]; } catch { conviction = []; }
    return buildMembershipIndex({
      watchlist: tickers,
      chartStore: readJson(CHART_WATCHLISTS_KEY),
      portfolio: readJson('mc_portfolio_holdings'),
      conviction,
    });
  }, [findActive, tickers, serverBench, convictionEntries]);   // built when a search starts; lists rarely change mid-typing
  const membershipFor = useCallback((t: string) => membershipsFor(membershipIndex, t), [membershipIndex]);

  // Handle remove ticker — with rollback on failure
  // zzz1044c (F10) — queued; a failed save puts back only this company, later changes stay.
  const handleRemoveTicker = useCallback((ticker: string) => {
    listQueue.enqueue('remove', [ticker]);
    toast.success(`${ticker} removed from watchlist`);
  }, [listQueue]);

  // Handle sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField, sortOrder]);

  // zzz1000 (CW-04) — Export says which rows it writes: the filtered rows on screen, or the whole list. With a search on,
  // the default is the filtered rows; the whole list stays one explicit click away. A second sheet records the scope.
  const handleExportXLSX = useCallback(async (scope: ExportScope) => {
    const out = buildWatchlistExport(sortedItems, visibleItems, scope, { search: findActive ? findQuery : '', sortField, sortOrder, quotesAt: lastRefresh });
    if (out.count === 0) {
      toast.error('No rows to export');
      return;
    }
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(out.rows);   // null → empty cell (unknown is not zero)
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 16 },
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Watchlist');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...out.info]), 'Export info');
    XLSX.writeFile(wb, `watchlist_${scope === 'filtered' ? 'filtered_' : ''}${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(scope === 'filtered' ? `Exported ${out.count} of ${out.total} rows (filtered)` : `Exported all ${out.total} rows`);
  }, [sortedItems, visibleItems, findActive, findQuery, sortField, sortOrder, lastRefresh]);

  // zzz1000 (improvement 2) — open the rows on screen (search applied, table order) as a chart review queue
  const openInCharts = useCallback(() => {
    const items = watchlistReviewItems(visibleItems);
    if (!items.length) { toast.error('No rows to open'); return; }
    writeReviewQueue(findActive ? `My Watchlist · matching “${findQuery.trim()}”` : 'My Watchlist', items, '/watchlists', { source: 'watchlist', listId: STANDALONE_WATCHLIST_ID });
    router.push(chartReviewUrl(items[0]));
  }, [visibleItems, findActive, findQuery, router]);

  // zzz1013 — one tab list, one accent: the active tab is ink with an accent underline (each tab used its own colour before)
  const tabs: Array<{ id: typeof activeTab; label: string; icon?: React.ReactNode; count?: number; hot?: boolean }> = [
    { id: 'main', label: 'My Watchlist', count: tickers.length },
    { id: 'fundamentals', label: 'Fundamentals' },
    { id: 'conviction', label: 'Conviction Beats', icon: <Award style={{ width: 13, height: 13 }} />, count: convictionCount, hot: convictionCount > 0 },
    { id: 'cb-analytics', label: '📊 Conviction Analytics' },   // zzz1192
    { id: 'ei-elite', label: 'EI Elite' },
    { id: 'portfolio-earnings', label: 'Portfolio Earnings' },
  ];
  return (
    <div className={`wlp wlp-pad ${workspaceThemeClass(wlLight, true)}`} style={{ padding: '22px 24px', background: 'var(--mc-bg-0)', minHeight: '100%' }}>
    <style>{WLP_CSS}</style>
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* PATCH 0557 — backend-degraded banner. */}
      <DegradedBanner />
      {alertOpen && <CreateAlertDialog onClose={() => setAlertOpen(false)} initialTarget={{ kind: activeTab === 'conviction' ? 'cb-in' : 'watchlist' }} chartLists={chartListOptions()} />}
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="wlp-head">
        <div>
          {activeTab !== 'conviction' && activeTab !== 'cb-analytics' && (<>
            <h1 className="wlp-title">Watchlist</h1>
            <p className="wlp-lede">Tracking universe, observation only, no P&amp;L</p>
            {activeTab === 'main' && (
              <p className="wlp-src" data-testid="watchlist-source" data-source={sourceLine.kind} title={sourceLine.detail}>
                <b>My Watchlist</b> · {sourceLine.label}
              </p>
            )}
          </>)}
        </div>
        <div className="wlp-actions">
          <WorkspaceThemeToggle light={wlLight} onToggle={toggleWlLight} className="wlp-btn" />
          <button type="button" className="wlp-btn" data-testid="watchlists-create-alert" onClick={() => setAlertOpen(true)} title="Price alert on My Watchlist (or another list / one ticker)">🔔 Create alert</button>
          <button type="button" className="wlp-btn" onClick={() => fetchData()} disabled={isRefreshing} title="Refresh data">
            <RefreshCw className={isRefreshing ? 'wlp-spin' : undefined} style={{ width: '14px', height: '14px' }} />
            Refresh
          </button>
          {activeTab === 'main' && (
            <WatchlistExportControl filterActive={findActive || reviewOnly} filteredCount={visibleItems.length} totalCount={sortedItems.length} onExport={handleExportXLSX} />
          )}
        </div>
      </div>

      {/* ── Tab switcher (PATCH 0186) ──────────────────────────────────────── */}
      <div className="wlp-tabs" role="tablist" aria-label="Watchlist views">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id} className="wlp-tab" onClick={() => setActiveTab(t.id)}>
            {t.icon}{t.label}
            {t.count != null && <span className={`wlp-count${t.hot && activeTab !== t.id ? ' hot' : ''}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {activeTab === 'cb-analytics' ? <ConvictionAnalytics market="IN" entries={mergeCbEntries(convictionEntries, serverBench).filter(sinceOk)} /> : activeTab === 'portfolio-earnings' ? <PortfolioEarningsTab /> : activeTab === 'ei-elite' ? <EIEliteTab /> : activeTab === 'fundamentals' ? <FundamentalsAnalyzerPage scope="watchlist" /> : activeTab === 'conviction' ? (
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
            placeholder="Find in list or add: company name or ticker... (or paste bulk: INFY, TCS, RELIANCE)"
            allowBulk={true}
            clearOnSelect={true}
            onQueryChange={setFindQuery}
            dropdownLabel="Add to list"
            membershipFor={membershipFor}
          />
        </div>
      </div>

      {/* zzz1044c (F10) — changes not yet saved / not saved */}
      <SaveStatusStrip pending={listSync.pending} failed={listSync.failed} onRetry={(id) => listQueue.retry(id)} onDismiss={(id) => listQueue.dismiss(id)} />

      {/* ── Summary ───────────────────────────────────────────────────────── */}
      {tickers.length > 0 && <SummaryBar items={sortedItems} />}

      {/* zzz1045d — compare with the chart lists (preview; copies only on click) */}
      {compareOpen && (
        <ComparePanel tickers={tickers} marketOf={marketOf} onClose={() => setCompareOpen(false)}
          onAddToStandalone={(add) => {
            const have = new Set(listQueue.snapshot().tickers);
            const toAdd = add.filter((t) => !have.has(t));
            if (toAdd.length) { listQueue.enqueue('add', toAdd); setTimeout(() => fetchData(), 500); }
          }} />
      )}

      {/* ── Loading State ─────────────────────────────────────────────────── */}
      {loading && tickers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} aria-busy="true" aria-label="Loading quotes">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="wlp-skel" />)}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!loading && tickers.length > 0 && (
        <div>
          <div className="wlp-meta">
            <p style={{ margin: 0 }}>
              {findActive
                ? <><strong style={{ color: 'var(--mc-text-1)' }}>In this list ({visibleItems.length})</strong> matching “{findQuery.trim()}” · {sortedItems.length} stocks in all</>
                : <>{sortedItems.length} stocks</>}
              {' '}· <span title="When this page last read the quotes">Last refreshed: {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}</span>
              {' '}· <span title="When the quote source says the prices are from (can be older than the refresh)">{quoteSummary}</span>
            </p>
            <button type="button" className="wlp-btn" onClick={() => setCompareOpen((v) => !v)} aria-expanded={compareOpen}
              title="See which names are only here, only in a chart list, or in both. Nothing is copied until you click.">
              Compare with chart lists…
            </button>
            <button type="button" onClick={openInCharts} disabled={visibleItems.length === 0}
              title={`Open ${findActive ? `the ${visibleItems.length} matching rows` : `all ${visibleItems.length} rows`} on Charts, in this table's order; ↑ / ↓ on the chart step through them`}
              className="wlp-btn accent">
              Open {findActive ? `${visibleItems.length} shown` : 'this list'} in Charts ↗
            </button>
          </div>
          {/* zzz1045d — changes since last review */}
          <div className="wlp-review" role="group" aria-label="Changes since last review">
            <button type="button" className="wlp-btn" onClick={markReviewed} title="Save today's price of every row; later you can see which ones moved since">Mark reviewed</button>
            {review ? <span>Reviewed {fmtClock(review.at)}</span> : <span>Not reviewed yet</span>}
            <label>
              <input type="checkbox" checked={reviewOnly} disabled={!review} onChange={(e) => setReviewOnly(e.target.checked)} />
              Only rows that moved ≥
            </label>
            <input type="number" min={0.5} max={100} step={0.5} value={reviewPct} aria-label="Move in percent since the review"
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setReviewPct(v); }} />
            <span>% since review{review ? ` (${reviewCount})` : ''}</span>
            {review && reviewDiff.notReviewed.length > 0 && <span title={reviewDiff.notReviewed.join(', ')}>· {reviewDiff.notReviewed.length} added since the review</span>}
          </div>
          {/* zzz1045d — names with no quote: listed for a manual check (old or demerged symbol?); never remapped */}
          {unresolved.length > 0 && (
            <p className="wlp-unres" role="note" data-testid="watchlist-unresolved">
              No quote for {unresolved.length} symbol{unresolved.length === 1 ? '' : 's'}: <b>{unresolved.join(', ')}</b>. Check each one by hand (an old or demerged symbol?). They are kept as typed and never swapped for another symbol.
            </p>
          )}
          {findActive && visibleItems.length === 0 && (
            <p style={{ fontSize: '13px', color: 'var(--mc-text-3)', margin: '0 0 12px' }}>
              Not in this list. Pick it from “Add to list” to add it.
            </p>
          )}
          {reviewOnly && visibleItems.length === 0 && (
            <p style={{ fontSize: '13px', color: 'var(--mc-text-3)', margin: '0 0 12px' }}>No row moved {reviewPct}% or more since the review.</p>
          )}
          {(visibleItems.length > 0 || !(findActive || reviewOnly)) && <WatchlistTable
            items={visibleItems}
            sortField={sortField}
            sortOrder={sortOrder}
            onSort={handleSort}
            onRemove={handleRemoveTicker}
            onToggleFlag={handleToggleFlag}
            onRetryFlag={handleRetryFlag}
          />}
        </div>
      )}

      {/* ── Empty State ───────────────────────────────────────────────────── */}
      {!loading && tickers.length === 0 && <EmptyState />}

      {/* ── Telegram Sync Info ────────────────────────────────────────────── */}
      {tickers.length > 0 && (
        <div className="wlp-note">
          Your watchlist syncs with <span style={{ fontWeight: 650, color: 'var(--mc-text-1)' }}>@mc_watchlist_pulse_bot</span> on Telegram.
        </div>
      )}
      </>
      )}

    </div>
    </div>
  );
}
