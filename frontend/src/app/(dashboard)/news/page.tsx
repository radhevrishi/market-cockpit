'use client';

import ChokeThemesPanel from '@/components/news/ChokeThemesPanel';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { RefreshCw, Filter, X, AlertCircle, Zap, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
// PATCH 0129 — strategy filter helper
import { articleMatchesStrategy } from '@/components/news/NewsCard';
// PATCH 0214 — semantic color tokens (state / semantic / severity orthogonal)
import { TOKENS } from '@/lib/design-tokens';
// PATCH 0232 — Source-tier visuals for Evidence Panel
import { sourceQualityWeight } from '@/lib/source-tiers';
import { annotateArticle, clusterByCanonical, confidenceBand } from '@/lib/news/event-detectors';
// PATCH 0579 — TheWrap alternate-data detectors
// PATCH 0455 CLEANUP-3 — Centralized vocab.
 // zzz526 — ticker chip → Stock Passport
import { getConvictionTickers } from '@/lib/conviction-beats';
// PATCH 0545 — AUDIT #95 debounced LS writes for thesis-notebook autosave.

// PATCH 0212 — Reusable panel-freshness chip.
// PATCH 0274 — Extracted into a shared component @/components/PanelFreshness
// so every dashboard surface gets the same chip semantics. Kept the import
// re-export here for back-compat with the inline references on this page.
import { PanelFreshness } from '@/components/PanelFreshness';
import { ArticleDetail } from './ArticleDetail';
import { BottleneckDashboard } from './BottleneckDashboard';
import { BottleneckDrilldown } from './BottleneckDrilldown';
import { NewsCard } from './NewsCard';
import { SavedViewsControl } from './SavedViewsControl';
import { PanelStaleStrip } from './components';
import { BOOK_PRIORITY_BOOST, REGIONS, TYPES, SOURCES, SIGNAL_FILTERS, LAYER_CONFIG, BOTTLENECK_DRILLDOWN } from './constants';
import { getArticleLayer, useNews, useMustRead, useCalendar, useAnomalies, filterArticles, useInPlay, useBottleneckDashboard, useTransformationalPreview, usePersistentBottlenecks, getTickerSymbols, getTitle, getSource, getUrl, typeColor, normalizeSentiment, safeRelative, isMarketRelevant } from './helpers';
import { type NewsArticle, type FeedLayer, type PersistentBottleneckItem } from './types';

export default function NewsFeedPage() {
  // PATCH 0218 — URL-persistent filter state.
  // Filters hydrate from `searchParams` on mount and write back on change so:
  //   1. Refresh keeps the user's view.
  //   2. Users can bookmark e.g. /news?lc=LIVE_WARM&region=IN&type=BOTTLENECK.
  //   3. Filter combos can be shared via link.
  // First step toward the 'Saved Views' feature from the institutional review.
  const router = useRouter();
  const pathname = usePathname();
  const initialParams = useSearchParams();
  const initParam = (key: string, fallback: string) =>
    (typeof initialParams?.get === 'function' && initialParams.get(key)) || fallback;

  const [region,        setRegion]        = useState<'ALL' | 'IN' | 'US'>(initParam('region','ALL') as any);
  const [articleType,   setArticleType]   = useState<string>(initParam('type','ALL'));
  const [sourceName,    setSourceName]    = useState<string>(initParam('source','ALL'));
  const [signalFilter,  setSignalFilter]  = useState<string>(initParam('signal','ALL')); // 'ALL' = HIGH+MEDIUM (hides noise), 'HIGH' = only high, 'MEDIUM' = only medium
  // PATCH 0453 P1-16 — Audit found these 3 sub-filters weren't URL-hydrated
  // even though all the other filters were. Bookmarked URLs lost the
  // bottleneck-level refinement. Now they hydrate from + write back to URL.
  const [bottleneckLevel, setBottleneckLevel] = useState<string>(initParam('blevel','ALL')); // Bottleneck sub-filter: ALL, CRITICAL_BOTTLENECK, BOTTLENECK, WATCH, RESOLVED_EASING
  const [bottleneckCategory, setBottleneckCategory] = useState<string>(initParam('bcat','ALL')); // Sub-tag: MEMORY_STORAGE, INTERCONNECT_PHOTONICS, etc.
  const [structuralOnly, setStructuralOnly] = useState<boolean>(initParam('struct','0') === '1'); // Show only synthetic/structural signals
  const [sortBy,        setSortBy]        = useState<'impact' | 'time'>(initParam('sort','impact') as any); // Default: impact-based sort
  // PATCH 0213 — Lifecycle filter. Defaults to 'LIVE_WARM' (last 48h) so
  // STALE / PERSISTENT items don't pollute the LIVE feed. Tabs let the user
  // explicitly request the older buckets when they want them.
  //   LIVE_WARM : published_at within 48h
  //   STALE     : 48h to 7d
  //   PERSISTENT: older than 7d AND flagged structural / persistent_theme
  //   ALL       : no lifecycle filter (legacy behaviour)
  const [lifecycleFilter, setLifecycleFilter] = useState<'LIVE_WARM'|'STALE'|'PERSISTENT'|'ALL'>(initParam('lc','LIVE_WARM') as any);
  const [search,        setSearch]        = useState(initParam('q',''));

  // PATCH 0218 — Reflect filter state back to the URL (without adding history
  // entries — replaceState keeps Back button intuitive). Debounced via
  // useEffect dependencies; only writes when any filter actually changes.
  useEffect(() => {
    const params = new URLSearchParams();
    const setIf = (k: string, v: string, def: string) => { if (v && v !== def) params.set(k, v); };
    setIf('region', region, 'ALL');
    setIf('type', articleType, 'ALL');
    setIf('source', sourceName, 'ALL');
    setIf('signal', signalFilter, 'ALL');
    setIf('sort', sortBy, 'impact');
    setIf('lc', lifecycleFilter, 'LIVE_WARM');
    // PATCH 0453 P1-16 — bottleneck sub-filter URL writeback
    setIf('blevel', bottleneckLevel, 'ALL');
    setIf('bcat', bottleneckCategory, 'ALL');
    if (structuralOnly) params.set('struct', '1');
    if (search) params.set('q', search);
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    // Avoid pushing if URL is already equal (prevents extra history entries
    // and re-render loops).
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== newUrl) {
      router.replace(newUrl, { scroll: false });
    }
  }, [region, articleType, sourceName, signalFilter, sortBy, lifecycleFilter, search, bottleneckLevel, bottleneckCategory, structuralOnly, pathname, router]);

  // ── Book/bench-aware ranking overlay ───────────────────────────────────────
  // Build the uppercased union of names the user actually holds / benches /
  // watches so their filings rank above equal-importance strangers. Mirrors the
  // conviction-overlay pattern used across the app: derive once, then refresh on
  // the same cross-tab events the writers fire ('storage', 'conviction-beats:
  // updated', 'mc:watchlist:updated'). Three separate sets are kept so the card
  // chip can note WHICH bucket matched.
  const [book, setBook] = useState<{ held: Set<string>; bench: Set<string>; watch: Set<string>; all: Set<string> }>(
    () => ({ held: new Set(), bench: new Set(), watch: new Set(), all: new Set() })
  );
  useEffect(() => {
    const build = () => {
      const held = new Set<string>();
      const bench = new Set<string>();
      const watch = new Set<string>();
      const addUpper = (set: Set<string>, raw: unknown) => {
        const sym = (raw ?? '').toString().trim().toUpperCase();
        if (sym) set.add(sym);
      };
      // Held — localStorage 'mc_portfolio_holdings' → array of { symbol }
      try {
        const arr = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]');
        if (Array.isArray(arr)) for (const h of arr) addUpper(held, h?.symbol);
      } catch {}
      // Bench — conviction beats (getConvictionTickers self-invalidates its
      // module cache on the same events, so we always read fresh here).
      try { for (const t of getConvictionTickers()) addUpper(bench, t); } catch {}
      // Watchlist — localStorage 'mc_watchlist_tickers' → string[]
      try {
        const arr = JSON.parse(localStorage.getItem('mc_watchlist_tickers') || '[]');
        if (Array.isArray(arr)) for (const t of arr) addUpper(watch, t);
      } catch {}
      const all = new Set<string>([...held, ...bench, ...watch]);
      setBook({ held, bench, watch, all });
    };
    build();
    window.addEventListener('storage', build);
    window.addEventListener('conviction-beats:updated', build);
    window.addEventListener('mc:watchlist:updated', build);
    return () => {
      window.removeEventListener('storage', build);
      window.removeEventListener('conviction-beats:updated', build);
      window.removeEventListener('mc:watchlist:updated', build);
    };
  }, []);

  const [showFilters,   setShowFilters]   = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  // PATCH 0121 — IMP-08: Q4 FY26 earnings season quick-filter.
  // null = no date window applied.  When active, both article_type and the
  // published_at window are forced to the earnings season.
  const [earningsSeasonActive, setEarningsSeasonActive] = useState<boolean>(false);
  const EARNINGS_WINDOW_START = new Date('2026-04-01').getTime();
  const EARNINGS_WINDOW_END   = new Date('2026-07-31').getTime();
  // PATCH 0129 — IMP: strategy filter chips ([MB] / [BN] / [RR]) layered on
  // top of existing region/type/signal filters.  'ALL' shows everything.
  const [strategyFilter, setStrategyFilter] = useState<'ALL' | 'MB' | 'BN' | 'RR'>('ALL');
  // "My Book only" — when on, restrict the feed to items whose ticker is in the
  // book overlay Set (held ∪ bench ∪ watch) computed above. Reuses `book.all`;
  // does not rebuild the set.
  const [bookOnly, setBookOnly] = useState<boolean>(false);
  const [drilldownSubTag, setDrilldownSubTag] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [groupByLayer,  setGroupByLayer]  = useState(true); // Group articles by layer
  const filterPanelRef = useRef<HTMLDivElement>(null);

  // ESC key closes filter panel
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFilters(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showFilters]);

  // Outside click closes filter panel
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    // Delay to avoid the click that opened the panel from immediately closing it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [showFilters]);

  // PATCH 0463 — debounce the search input so each keystroke doesn't fire a
  // separate /api/v1/news?search= request. Previously typing "nvidia" fired
  // 6 fetches against a paginated route; the worst was a slow series of
  // overlapping requests cancelling each other. 250ms is short enough that
  // the user perceives instant results but coalesces typing bursts.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  // Fetch ALL articles once — filters applied client-side for instant switching
  const { data: allArticles, isLoading: rawIsLoading, error, refetch, dataUpdatedAt } = useNews(debouncedSearch);
  // PATCH 0693 — hard timeout guard. The useQuery skeleton would otherwise
  // sit there indefinitely on a hung backend (the QA BUG-03 symptom:
  // skeleton forever, lifecycle counters all 0). When 25s elapses
  // without data, flip newsTimeout=true; the UI then shows a terminal
  // error + Retry button instead of the shimmer.
  const [newsTimeout, setNewsTimeout] = useState(false);
  useEffect(() => {
    if (allArticles || error) { setNewsTimeout(false); return; }
    if (!rawIsLoading) return;
    const t = setTimeout(() => setNewsTimeout(true), 25_000);
    return () => clearTimeout(t);
  }, [rawIsLoading, allArticles, error]);
  const isLoading = rawIsLoading && !newsTimeout; // PATCH 0693 — drop skeleton after timeout
  // Format the last-fetched time for display
  const newsFetchedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })  /* zzz382 */
    : null;
  const { data: rawInPlay, isLoading: inPlayLoading, refetch: refetchInPlay, dataUpdatedAt: inPlayUpdatedAt, isFetching: inPlayFetching, isError: inPlayError } = useInPlay();
  // Phase 1.3 / 1.5 / 2.5: Must Read + Forward Calendar + Anomaly hooks
  const { data: mustRead } = useMustRead();
  const { data: calendar } = useCalendar();
  // PATCH 0068: 6-month Transformational Contracts preview band
  const { data: transformationalPreview } = useTransformationalPreview();
  // PATCH 0228 — Mobile-aware default for the Transformational Contracts panel.
  const [showTransformational, setShowTransformational] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth > 768;
  });
  // PATCH 0079: Persistent Bottleneck Reading
  const { data: persistentBottlenecks } = usePersistentBottlenecks();
  // PATCH 0228 — Mobile-aware default. On viewports ≤768px the Persistent
  // Bottleneck panel is dense (L1-L6 transmission, multi-region ticker
  // grids), so default it collapsed; desktop stays expanded.
  const [showPersistent, setShowPersistent] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth > 768;
  });
  const { data: anomalies } = useAnomalies();
  const [showCalendar, setShowCalendar] = useState(false);

  // ── Market Bias: computed from last 24h articles ────────────────────────────
  const marketBias = useMemo(() => {
    if (!allArticles || allArticles.length === 0) return null;
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const recent = allArticles.filter(a => {
      try { return new Date(a.published_at).getTime() > cutoff; } catch { return false; }
    });
    if (recent.length === 0) return null;
    const bullish = recent.filter(a => normalizeSentiment(a.sentiment) === 'BULLISH').length;
    const bearish = recent.filter(a => normalizeSentiment(a.sentiment) === 'BEARISH').length;
    const neutral = recent.length - bullish - bearish;
    const highImpact = recent.filter(a => (a.investment_tier || 0) === 1).length;
    const net = bullish - bearish;
    const bias = net > 3 ? 'Bullish' : net < -3 ? 'Bearish' : 'Neutral';
    // Top types in last 24h
    const typeCounts: Record<string,number> = {};
    for (const a of recent) typeCounts[a.article_type] = (typeCounts[a.article_type] || 0) + 1;
    const topType = Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])[0];
    // Hot tickers: most mentioned in last 24h
    const tickerCounts: Record<string,number> = {};
    for (const a of recent) {
      for (const t of getTickerSymbols(a)) {
        // PATCH 0454 P2-27 — bumped 7 → 12 so India 10-char tickers like
        // BAJAJFINSV / BAJAJ-AUTO / IDFCFIRSTB / TATACONSUM stop dropping.
        if (t.length >= 2 && t.length <= 12) tickerCounts[t] = (tickerCounts[t] || 0) + 1;
      }
    }
    const hotTickers = Object.entries(tickerCounts)
      .filter(([,c]) => c >= 2)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 12)
      .map(([ticker, count]) => ({ ticker, count }));
    return { total: recent.length, bullish, bearish, neutral, highImpact, bias, topType, hotTickers };
  }, [allArticles]);

  // ── Filtering engine: memoized multi-dimensional filter + sort ──────────────
  // Combines: region × article_type × signal × source × bottleneck_level ×
  //           bottleneck_category × structural_only × search-stale filter.
  // Sort: 'impact' (importance_score + structural boost) or 'time' (published_at desc).
  const STALE_MS = 48 * 60 * 60 * 1000; // 48 hours

  // PATCH 1097 — Off-topic noise filter. Aggregator feeds (Mint, ET, BS, etc.)
  // routinely include sports live-stream guides, exam result notifications,
  // Bollywood box-office, and lifestyle filler that have no place in a
  // financial dashboard. Drop these unless the article is structural (synthetic
  // thesis or persistent theme). Hard filter, no UI toggle — false positives
  // are easier to fix by trimming the regex than by adding another setting.
  const OFF_TOPIC_RX = /\b(?:fifa|world cup|premier league|epl|la liga|champions league|champions trophy|playing xi|kick[- ]?off|how to watch|ipl |bcci|t20 |ranji|cricket\s+(?:match|score|live)|football\s+(?:match|score|live)|live[- ]?stream(?:ing)?\s+(?:of\s+|the\s+)?(?:match|tv|online|.*\bvs\s)|bollywood|hollywood|box office|movie review|film review|web series|trailer launch|album launch|concert tour|msbte|neet result|jee main|jee advanced|upsc (?:result|prelims|mains)|ssc (?:cgl|chsl|result)|cbse (?:result|class\s+(?:10|12))|icse result|(?:10th|12th|diploma)\s+result|admit card|hall ticket|answer key|merit list|cut[- ]?off list|direct link.*download|horoscope|astrology|lottery|jackpot|recipe)\b/i;

  const articles = useMemo(() => {
    const now = Date.now();
    // PATCH 0121 — IMP-08: Q4 FY26 earnings season chip forces article_type=EARNINGS
    const effectiveType = earningsSeasonActive ? 'EARNINGS' : articleType;
    const base = filterArticles(allArticles || [], region, effectiveType, signalFilter, sourceName);

    const filtered = base.filter(a => {
      if (!isMarketRelevant(a)) return false;
      // PATCH 1097 — drop off-topic noise (sports / entertainment / exam results
      // / lifestyle). Structural / synthetic / persistent items bypass this.
      {
        const isStructuralOrPersistent = !!a.is_synthetic
          || a.feed_layer === 'STRUCTURAL_ALPHA'
          || (a as any).freshness_layer === 'PERSISTENT_THEME';
        if (!isStructuralOrPersistent) {
          const blob = `${a.title || ''} ${a.headline || ''} ${a.summary || ''}`;
          if (OFF_TOPIC_RX.test(blob)) return false;
        }
      }
      // PATCH 0121 — IMP-08: when the Q4 FY26 chip is on, restrict to the
      // Apr 1 → Jul 31 2026 window (Indian Q4 results season).
      if (earningsSeasonActive) {
        const pub = new Date(a.published_at || a.ingested_at || 0).getTime();
        if (!(pub >= EARNINGS_WINDOW_START && pub <= EARNINGS_WINDOW_END)) return false;
      }
      // PATCH 0129 — strategy filter ([MB] / [BN] / [RR])
      if (strategyFilter !== 'ALL') {
        if (!articleMatchesStrategy(a as any, strategyFilter)) return false;
      }
      // "My Book only" — keep only items whose ticker is in the book overlay Set
      // (held ∪ bench ∪ watch). Reuses the already-computed `book.all`.
      if (bookOnly && book.all.size) {
        const inBookNow = getTickerSymbols(a).some(sym => book.all.has(sym.toUpperCase()));
        if (!inBookNow) return false;
      }
      // Bottleneck level sub-filter (only active when viewing BOTTLENECK)
      if (bottleneckLevel !== 'ALL' && articleType === 'BOTTLENECK') {
        if (a.bottleneck_level !== bottleneckLevel) return false;
      }
      // Bottleneck category sub-filter (sub-tag: MEMORY_STORAGE etc.)
      if (bottleneckCategory !== 'ALL' && articleType === 'BOTTLENECK') {
        if (a.bottleneck_sub_tag !== bottleneckCategory) return false;
      }
      // Structural-only toggle: keep only synthetic/structural-pinned signals
      if (structuralOnly) {
        const isStructural = !!a.is_synthetic
          || a.feed_layer === 'STRUCTURAL_ALPHA'
          || a.structural_status === 'CRITICAL'
          || a.structural_status === 'ELEVATED';
        if (!isStructural) return false;
      }
      // When HIGH signal selected, exclude stale articles
      if (signalFilter === 'HIGH') {
        const pubTime = new Date(a.published_at || a.ingested_at || 0).getTime();
        if (now - pubTime > STALE_MS) return false;
      }
      // PATCH 0213 — Lifecycle filter
      if (lifecycleFilter !== 'ALL') {
        const pubTime = new Date(a.published_at || a.ingested_at || 0).getTime();
        const age = now - pubTime;
        const LIVE_WARM_MS = 48 * 3600_000;     // ≤ 48h
        const STALE_END_MS = 7 * 24 * 3600_000; // 48h → 7d
        const isPersistentTheme = (a as any).freshness_layer === 'PERSISTENT_THEME'
          || (a as any).is_synthetic
          || (a as any).feed_layer === 'STRUCTURAL_ALPHA';
        if (lifecycleFilter === 'LIVE_WARM' && age > LIVE_WARM_MS && !isPersistentTheme) return false;
        if (lifecycleFilter === 'STALE' && !(age > LIVE_WARM_MS && age <= STALE_END_MS)) return false;
        if (lifecycleFilter === 'PERSISTENT' && !(age > STALE_END_MS && isPersistentTheme)) return false;
      }
      return true;
    });

    // Sort: impact uses importance_score with structural + severity boost;
    // time uses published_at desc.
    const SEVERITY_BOOST: Record<string, number> = {
      CRITICAL_BOTTLENECK: 3,
      BOTTLENECK: 2,
      WATCH: 1,
      RESOLVED_EASING: 0,
    };

    // PATCH 0220 — Surface the priority score on every card.
    // Components: importance, bottleneck severity, structural boost, recency.
    // Annotated onto the article so NewsCard can render a 'P N' badge with
    // a per-component tooltip — institutional rank transparency.
    const scoreOf = (a: NewsArticle): { total: number; parts: Record<string, number> } => {
      const imp = a.importance_score || 0;
      const sev = SEVERITY_BOOST[a.bottleneck_level || ''] || 0;
      const structural = (a.is_synthetic || a.feed_layer === 'STRUCTURAL_ALPHA') ? 2 : 0;
      // PATCH 1096a — sharper additive recency: 8 pts <6h, decaying to 0 at 36h.
      // Previous curve (3 pts over 72h) let high-importance 3-day-old items
      // outrank fresh medium-importance ones. Combined with the multiplicative
      // ageDecay below, this gives clearly active news a real edge while
      // structural / persistent themes stay exempt.
      const recency = (() => {
        try {
          const age = (Date.now() - new Date(a.published_at).getTime()) / (1000 * 60 * 60);
          if (age <= 6) return 8;
          if (age <= 24) return Math.max(2, 8 - (age - 6) * (6 / 18));  // 8 → 2 over 18h
          if (age <= 36) return Math.max(0, 2 - (age - 24) * (2 / 12)); // 2 → 0 over 12h
          return 0;
        } catch { return 0; }
      })();
      const parts = {
        importance:    Math.round(imp * 2 * 10) / 10,
        severity:      Math.round(sev * 1.5 * 10) / 10,
        structural,
        recency:       Math.round(recency * 10) / 10,
      };
      return { total: parts.importance + parts.severity + parts.structural + parts.recency, parts };
    };

    // PATCH 0449 NEWS-1/4 — Multiply priority by source-quality weight AND
    // aggregator-noise quality multiplier. PRIMARY exchange filings now
    // consistently outrank ET/Mint rewrites of the same news. Listicle
    // headlines and pure speculation drop to the bottom.
    for (const a of filtered) {
      const { total, parts } = scoreOf(a);
      const srcW = sourceQualityWeight(a.source_name || a.source, a.source_url || a.url);
      const noise = annotateArticle({ title: a.title, headline: a.headline, summary: a.summary }).noise;
      // PATCH 1096a — multiplicative age decay so truly old non-structural items
      // fall well below fresh ones globally. Structural / synthetic items are
      // exempt — they ARE the long-running thesis and re-stamp each cycle.
      const ageHours = (() => {
        try { return (Date.now() - new Date(a.published_at).getTime()) / 3.6e6; }
        catch { return 0; }
      })();
      const isStructuralOrPersistent = a.is_synthetic
        || a.feed_layer === 'STRUCTURAL_ALPHA'
        || (a as any).freshness_layer === 'PERSISTENT_THEME';
      // PATCH 1096a (refined) — softened from /24 to /36 to avoid the abrupt
      // 24h cliff. Now 1.0 @ 0h, 0.51 @ 24h, 0.26 @ 48h, 0.13 @ 72h. A 23h
      // article and a 25h article look much more similar than before, while
      // truly old non-structural items still fall off.
      const ageDecay = isStructuralOrPersistent ? 1 : Math.exp(-ageHours / 36);
      const adjusted = total * srcW * noise.qualityMultiplier * ageDecay;
      // Book/bench-aware boost: additive on the FINAL priority (after the
      // multiplicative source/noise/age chain) so it participates directly in
      // the sort below and can't be decayed away for an older filing on a name
      // the user actually holds. Bounded by BOOK_PRIORITY_BOOST.
      let matchHeld = false, matchBench = false, matchWatch = false;
      if (book.all.size) {
        for (const sym of getTickerSymbols(a)) {
          const u = sym.toUpperCase();
          if (book.held.has(u)) matchHeld = true;
          if (book.bench.has(u)) matchBench = true;
          if (book.watch.has(u)) matchWatch = true;
        }
      }
      const inBook = matchHeld || matchBench || matchWatch;
      const bookBoost = inBook ? BOOK_PRIORITY_BOOST : 0;
      (a as any).__inBook = inBook;
      (a as any).__bookMatch = inBook
        ? [matchHeld && 'Held', matchBench && 'Bench', matchWatch && 'Watchlist'].filter(Boolean).join(' · ')
        : '';
      (a as any).__priority = Math.round((adjusted + bookBoost) * 10) / 10;
      (a as any).__priorityParts = { ...parts, source_weight: srcW, noise_mult: noise.qualityMultiplier, age_decay: Math.round(ageDecay * 100) / 100, book_boost: bookBoost };
      (a as any).__sourceWeight = srcW;
      (a as any).__isListicle = noise.isListicle;
      (a as any).__isSpeculation = noise.isSpeculation;
    }

    if (sortBy === 'impact') {
      filtered.sort((a, b) => ((b as any).__priority || 0) - ((a as any).__priority || 0));
    } else {
      filtered.sort((a, b) => {
        try {
          return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
        } catch { return 0; }
      });
    }

    // PATCH 0449 NEWS-2 — Event canonicalization. Group duplicate stories
    // (same ticker + event_type + ISO-week) under one master article. The
    // master is the highest-source-quality + most-recent in each cluster.
    // Old dedup matched only on headline string; canonical key also collapses
    // rewrites that paraphrase the same filing.
    const clusters = clusterByCanonical(filtered, {
      weightFn: (a: any) => (a.__sourceWeight ?? 0.4),
    });
    // Stable order: keep the sort we already applied by masters.
    clusters.sort((c1, c2) => ((c2.master as any).__priority || 0) - ((c1.master as any).__priority || 0));
    const deduped: NewsArticle[] = clusters.map(c => {
      // Stamp cluster metadata so NewsCard can render the "+N more" chip.
      (c.master as any).__clusterSize = c.cluster_size;
      (c.master as any).__clusterSources = c.duplicates.map((d: any) =>
        d.source_name || d.source || 'source'
      ).slice(0, 5);
      // PATCH 0454 TIER1-B — Corroboration TIMESTAMPS, not just count. A
      // 5-min-apart cluster ≠ a 6h-apart cluster — the former is genuinely
      // breaking, the latter is rewrites. Stamp the master's published_at
      // plus each duplicate's so the chip can render a mini-timeline.
      (c.master as any).__clusterTimes = [c.master, ...c.duplicates]
        .map((x: any) => Date.parse(x?.published_at || x?.pub_date || ''))
        .filter((t: number) => Number.isFinite(t))
        .sort((a: number, b: number) => a - b);
      // PATCH 0449 NEWS-3 — Confidence band derived from source quality +
      // corroboration count (cluster size - 1).
      const cb = confidenceBand((c.master as any).__sourceWeight ?? 0.4, c.cluster_size - 1);
      (c.master as any).__confidence = cb;
      return c.master;
    });

    return deduped;
  }, [
    allArticles,
    region,
    articleType,
    signalFilter,
    sourceName,
    bottleneckLevel,
    bottleneckCategory,
    structuralOnly,
    sortBy,
    lifecycleFilter,  // PATCH 0213
    book,             // book/bench-aware boost recomputes when holdings change
    bookOnly,         // "My Book only" filter
  ]);

  // PATCH 0226 — Count how many STALE items are being hidden by the
  // lifecycle filter. Surface them as a collapsed "Recent" strip beneath
  // the main feed so they're never silently deleted from the user's view.
  const staleHiddenCount = useMemo(() => {
    if (lifecycleFilter !== 'LIVE_WARM') return 0;
    if (!allArticles) return 0;
    const now = Date.now();
    const LIVE_WARM_MS = 48 * 3600_000;
    const STALE_END_MS = 7 * 24 * 3600_000;
    const base = filterArticles(allArticles, region, earningsSeasonActive ? 'EARNINGS' : articleType, signalFilter, sourceName);
    let count = 0;
    for (const a of base) {
      if (!isMarketRelevant(a)) continue;
      const pubTime = new Date(a.published_at || a.ingested_at || 0).getTime();
      const age = now - pubTime;
      const isPersistentTheme = (a as any).freshness_layer === 'PERSISTENT_THEME'
        || (a as any).is_synthetic
        || (a as any).feed_layer === 'STRUCTURAL_ALPHA';
      // STALE bucket: 48h to 7d, not promoted to persistent
      if (age > LIVE_WARM_MS && age <= STALE_END_MS && !isPersistentTheme) count++;
    }
    return count;
  }, [allArticles, lifecycleFilter, region, articleType, signalFilter, sourceName, earningsSeasonActive]);

  // AUDIT_100 #31 — count-by-lifecycle so chip rail shows "LIVE+WARM (47)"
  // instead of forcing the user to click a chip to discover it's empty.
  const lifecycleCounts = useMemo(() => {
    const out = { LIVE_WARM: 0, STALE: 0, PERSISTENT: 0, ALL: 0 };
    if (!allArticles) return out;
    const now = Date.now();
    const LIVE_WARM_MS = 48 * 3600_000;
    const STALE_END_MS = 7 * 24 * 3600_000;
    const base = filterArticles(allArticles, region, earningsSeasonActive ? 'EARNINGS' : articleType, signalFilter, sourceName);
    for (const a of base) {
      if (!isMarketRelevant(a)) continue;
      out.ALL++;
      const pubTime = new Date(a.published_at || a.ingested_at || 0).getTime();
      const age = now - pubTime;
      const isPersistentTheme = (a as any).freshness_layer === 'PERSISTENT_THEME'
        || (a as any).is_synthetic
        || (a as any).feed_layer === 'STRUCTURAL_ALPHA';
      if (age <= LIVE_WARM_MS || isPersistentTheme && age <= LIVE_WARM_MS) out.LIVE_WARM++;
      else if (age > LIVE_WARM_MS && age <= STALE_END_MS && !isPersistentTheme) out.STALE++;
      else if (age > STALE_END_MS && isPersistentTheme) out.PERSISTENT++;
    }
    return out;
  }, [allArticles, region, articleType, signalFilter, sourceName, earningsSeasonActive]);

  // PATCH 0720 — Memoize the per-tier and per-layer counters so the
  // signals summary bar + layered-view header don't re-walk the 200-500
  // article array on every keystroke / hover / panel-toggle. Previously
  // ran three independent .filter() passes inline at lines 3675/3678/3767;
  // each was O(N) and re-ran on every render of the page (which happens
  // on every chip-select / lifecycle change / refetch).
  const tierCounts = useMemo(() => {
    const t1: number[] = [], t2: number[] = [];
    if (!articles) return { high: 0, medium: 0 };
    let high = 0, medium = 0;
    for (const a of articles) {
      const tier = a.investment_tier || 0;
      if (tier === 1) high++;
      else if (tier === 2) medium++;
    }
    // suppress unused-var warning from t1/t2 — kept to make the intent obvious
    void t1; void t2;
    return { high, medium };
  }, [articles]);

  // PATCH — tier-3 (noise) count over the same region/type/source scope so the
  // hidden low-signal stories are discoverable from the signal summary bar.
  const noiseCount = useMemo(() => {
    if (!allArticles) return 0;
    return filterArticles(allArticles, region, earningsSeasonActive ? 'EARNINGS' : articleType, 'LOW', sourceName).length;
  }, [allArticles, region, articleType, sourceName, earningsSeasonActive]);

  const layerArticleMap = useMemo(() => {
    const out: Record<FeedLayer, NewsArticle[]> = {
      MACRO_REGIME: [], STRUCTURAL: [], COMPANY_ALPHA: [], GENERAL: [],
    };
    if (!articles) return out;
    for (const a of articles) {
      out[getArticleLayer(a)].push(a);
    }
    return out;
  }, [articles]);

  // PATCH 0693 — auto-fallback from LIVE_WARM to ALL when the live bucket
  // is empty but the broader feed has content. Prevents the QA BUG-03
  // symptom where the lifecycle default of LIVE_WARM silently hid every
  // article and the feed read "0 articles" indefinitely. Fires once per
  // dataset and only if user hasn't manually overridden the filter.
  const autoFallbackFiredRef = useRef(false);
  useEffect(() => {
    if (autoFallbackFiredRef.current) return;
    if (!allArticles || allArticles.length === 0) return;
    if (lifecycleFilter !== 'LIVE_WARM') return;
    if (lifecycleCounts.LIVE_WARM === 0 && lifecycleCounts.ALL > 0) {
      autoFallbackFiredRef.current = true;
      setLifecycleFilter('ALL');
    }
  }, [allArticles, lifecycleFilter, lifecycleCounts]);
  // PATCH 0210 — Dedupe IN PLAY TODAY by ticker.
  // Root cause of the DEEDEV×2, INOXINDIA×2, CEINSYS×2 rendering: rawInPlay
  // returns one row per (article × ticker mention). Multiple articles
  // mentioning the same ticker produce duplicate rail cards. Group by
  // primary-ticker; keep the article with the most recent published_at;
  // expose mention count downstream for an "N mentions" affordance.
  const inPlay = (() => {
    const relevant = (rawInPlay || []).filter(isMarketRelevant);
    const byTicker = new Map<string, { article: typeof relevant[number]; count: number }>();
    const untickered: typeof relevant = [];
    for (const art of relevant) {
      const syms = getTickerSymbols(art);
      const key = syms[0]?.toUpperCase();
      if (!key) {
        untickered.push(art);
        continue;
      }
      const existing = byTicker.get(key);
      if (!existing) {
        byTicker.set(key, { article: art, count: 1 });
      } else {
        existing.count += 1;
        // Prefer the most recently published article
        const aTs = new Date((art as any).published_at || (art as any).pub_date || 0).getTime();
        const bTs = new Date((existing.article as any).published_at || (existing.article as any).pub_date || 0).getTime();
        if (aTs > bTs) existing.article = art;
      }
    }
    // Annotate the kept article with its mention count so the renderer can show it
    const merged = Array.from(byTicker.values()).map(({ article, count }) => {
      (article as any).__mentionCount = count;
      return article;
    });
    return [...merged, ...untickered];
  })();
  const { data: bnDashboard, isLoading: bnLoading, refetch: refetchBn, dataUpdatedAt: bnUpdatedAt, isFetching: bnFetching } = useBottleneckDashboard(articleType === 'BOTTLENECK', region);
  const showBottleneckDashboard = articleType === 'BOTTLENECK';

  // PATCH 0223 — Replace the previous 3-shot polling (refetch at 0s + 8s + 20s)
  // with a deterministic single-refetch contract:
  //   1. Trigger backend ingestion; wait up to 12s for the POST to return.
  //   2. Once the POST returns, fire ONE coordinated refetch of all panels.
  //   3. Show 'still ingesting' overlay for a max of 30s OR until the new
  //      data arrives (whichever comes first). No silent extra refetches.
  // Cleaner contract than 'guess and re-poll'. The backend ideally returns a
  // job_id and the client polls a /jobs/:id endpoint for completion — that
  // change is on the backend backlog. Until then this is at least
  // observable and bounded.
  const handleRefresh = async () => {
    setIsRefreshing(true);
    const refetchAll = () => Promise.all([
      refetch(),
      refetchInPlay(),
      ...(showBottleneckDashboard ? [refetchBn()] : []),
    ]);
    try {
      // Wait for backend to confirm ingestion was kicked off
      await api.post('/news/refresh', {}, { timeout: 12_000 });
    } catch (e) {
      console.warn('News refresh trigger failed:', e);
    }
    // One coordinated refetch — no second/third surprise polls
    try {
      await refetchAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div style={{ padding: '12px 20px', maxWidth: 'none', margin: '0', width: '100%', fontSize: 14 }}>

      {/* ── MARKET BIAS HEADER ────────────────────────────────────────── */}
      {marketBias && !isLoading && (
        <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '10px 14px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: marketBias.hotTickers.length > 0 ? '8px' : '0' }}>
            {/* Bias pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-4)', letterSpacing: '0.5px' }}>TODAY</span>
              <span style={{
                fontSize: '11px', fontWeight: '800', padding: '3px 10px', borderRadius: '6px',
                backgroundColor: marketBias.bias === 'Bullish' ? 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)' : marketBias.bias === 'Bearish' ? 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                color: marketBias.bias === 'Bullish' ? 'var(--mc-bullish)' : marketBias.bias === 'Bearish' ? 'var(--mc-bearish)' : 'var(--mc-warn)',
                border: `1px solid ${marketBias.bias === 'Bullish' ? 'color-mix(in srgb, var(--mc-bullish) 19%, transparent)' : marketBias.bias === 'Bearish' ? 'color-mix(in srgb, var(--mc-bearish) 19%, transparent)' : 'color-mix(in srgb, var(--mc-warn) 19%, transparent)'}`,
              }}>
                {marketBias.bias === 'Bullish' ? '↑' : marketBias.bias === 'Bearish' ? '↓' : '→'} {marketBias.bias}
              </span>
            </div>
            {/* Sentiment bars */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--mc-text-4)', flexShrink: 0 }}>
              <span style={{ color: 'var(--mc-bullish)', fontWeight: '700' }}>↑{marketBias.bullish}</span>
              <span style={{ color: 'var(--mc-text-4)' }}>·</span>
              <span style={{ color: 'var(--mc-text-4)' }}>→{marketBias.neutral}</span>
              <span style={{ color: 'var(--mc-text-4)' }}>·</span>
              <span style={{ color: 'var(--mc-bearish)', fontWeight: '700' }}>↓{marketBias.bearish}</span>
              <span style={{ color: 'var(--mc-border-2)', marginLeft: '4px' }}>|</span>
              <span style={{ color: 'var(--mc-text-4)' }}>{marketBias.total} stories</span>
              {marketBias.highImpact > 0 && (
                <><span style={{ color: 'var(--mc-border-2)', marginLeft: '4px' }}>|</span>
                <span style={{ color: 'var(--mc-bearish)', fontWeight: '700' }}>{marketBias.highImpact} HIGH signal</span></>
              )}
            </div>
            {/* Dominant type */}
            {marketBias.topType && (
              <span style={{
                fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '5px',
                backgroundColor: typeColor(marketBias.topType[0]) + '18',
                color: typeColor(marketBias.topType[0]),
                border: `1px solid ${typeColor(marketBias.topType[0])}30`,
              }}>
                📌 {marketBias.topType[0].replace(/_/g,' ')} ({marketBias.topType[1]})
              </span>
            )}
            {/* Live indicator */}
            <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--mc-text-4)', flexShrink: 0 }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--mc-bullish)', marginRight: '4px', animation: 'pulse 2s infinite' }} />
              24H INTELLIGENCE
            </span>
          </div>
          {/* Hot Tickers strip */}
          {marketBias.hotTickers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }} className="scrollbar-hide">
              <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--mc-text-4)', letterSpacing: '0.5px', flexShrink: 0 }}>HOT:</span>
              {marketBias.hotTickers.map(({ ticker, count }) => (
                <button
                  key={ticker}
                  onClick={() => setSearch(ticker)}
                  style={{
                    fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '5px',
                    backgroundColor: count >= 5 ? 'color-mix(in srgb, var(--mc-bearish) 9%, transparent)' : count >= 3 ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'color-mix(in srgb, var(--mc-accent) 8%, transparent)',
                    color: count >= 5 ? 'var(--mc-bearish)' : count >= 3 ? 'var(--mc-warn)' : 'var(--mc-accent)',
                    border: `1px solid ${count >= 5 ? 'color-mix(in srgb, var(--mc-bearish) 19%, transparent)' : count >= 3 ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'color-mix(in srgb, var(--mc-accent) 19%, transparent)'}`,
                    cursor: 'pointer', flexShrink: 0, transition: 'opacity 0.15s',
                  }}
                  title={`${ticker} mentioned ${count}× in last 24h — click to filter`}
                >
                  {ticker}
                  <span style={{ fontSize: '8px', marginLeft: '3px', opacity: 0.7 }}>×{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PATCH 0230 — global stale strip when ANY critical panel is very stale */}
      {/* PATCH 0453 P1-14 — Audit found Math.min(... || Date.now()) reset the
          age clock to FRESH when one of the two panels hadn't loaded yet.
          Filter to only non-zero values so a single loaded panel's age is
          the source of truth. */}
      <PanelStaleStrip
        dataUpdatedAt={(() => {
          const ts = [inPlayUpdatedAt, dataUpdatedAt].filter((t): t is number => typeof t === 'number' && t > 0);
          return ts.length === 0 ? Date.now() : Math.min(...ts);
        })()}
        staleAfterMs={5 * 60_000}
        label="news"
        onRefresh={handleRefresh}
      />

      {/* zzz1174 — 🔥 Choke-Point Themes (AI on click; last run otherwise) */}
      <ChokeThemesPanel />

      {/* ── IN PLAY TODAY bar ─────────────────────────────────────────── */}
      {!inPlayLoading && (
        <div
          style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '10px 12px', marginBottom: '12px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '10px' }}
          className="scrollbar-hide mobile-scroll"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: '700', color: 'var(--mc-warn)', flexShrink: 0 }}>
            <Zap style={{ width: '10px', height: '10px' }} /> IN PLAY TODAY
          </span>
          {/* PATCH 0212 — freshness indicator */}
          <PanelFreshness dataUpdatedAt={inPlayUpdatedAt} isFetching={inPlayFetching} staleAfterMs={3 * 60_000} />

          {(inPlay?.length ?? 0) > 0 ? (
            inPlay!.map(art => {
              const syms = getTickerSymbols(art);
              const mentionCount = (art as any).__mentionCount as number | undefined;
              return (
                <a
                  key={art.id}
                  href={getUrl(art) !== '#' ? getUrl(art) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={mentionCount && mentionCount > 1 ? `${mentionCount} articles mention ${syms[0]} today — open the latest` : undefined}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '12px', cursor: 'pointer', verticalAlign: 'middle', flexShrink: 0, textDecoration: 'none', color: 'inherit' }}
                >
                  {syms[0] && (
                    <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)', color: 'var(--mc-bearish)', padding: '1px 5px', borderRadius: '4px', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)' }}>
                      {syms[0]}
                      {mentionCount && mentionCount > 1 && (
                        <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.85, fontWeight: 600 }}>×{mentionCount}</span>
                      )}
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: 'var(--mc-text-2)' }}>
                    {getTitle(art).slice(0, 70)}{getTitle(art).length > 70 ? '…' : ''}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{getSource(art)}</span>
                </a>
              );
            })
          ) : inPlayError ? (
            // PATCH 0215 — explicit error state with retry, never silent
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <AlertCircle style={{ width: 12, height: 12, color: TOKENS.semantic.bearish.solid }} />
              <span style={{ color: TOKENS.semantic.bearish.solid }}>Couldn't load IN PLAY items.</span>
              <button
                onClick={() => refetchInPlay()}
                style={{
                  background: 'none', border: `1px solid ${TOKENS.semantic.bearish.border}`,
                  color: TOKENS.semantic.bearish.solid, padding: '2px 8px', borderRadius: 4,
                  fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}
              >Retry</button>
            </span>
          ) : (
            <span style={{ fontSize: '11px', color: 'var(--mc-text-4)', fontStyle: 'italic' }}>
              No high-importance stories in the last 12 hours
            </span>
          )}
        </div>
      )}

      {/* Loading shimmer for IN PLAY bar */}
      {inPlayLoading && (
        <div style={{ height: '36px', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '12px', marginBottom: '16px' }} className="animate-shimmer" />
      )}

      {/* ── PHASE 1.3: MUST READ — Curated top 5 ─────────────────────── */}
      {mustRead && mustRead.length > 0 && (
        <div style={{
          backgroundColor: '#0F1B2E', border: '1px solid var(--mc-border-2)',
          borderLeft: '3px solid var(--mc-warn)', borderRadius: '12px',
          padding: '12px 14px', marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mc-warn)', letterSpacing: '0.8px' }}>
              ★ MUST READ
            </span>
            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>
              Top 10 institutional reads — US + India mix · consequence × source × ticker × recency
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mustRead.slice(0, 10).map((art, idx) => {
              const syms = getTickerSymbols(art);
              const url = getUrl(art);
              const time = safeRelative(art.published_at);
              return (
                <a
                  key={art.id || idx}
                  href={url !== '#' ? url : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 8px', borderRadius: '6px',
                    backgroundColor: 'rgba(245, 158, 11, 0.04)',
                    cursor: url !== '#' ? 'pointer' : 'default',
                    textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mc-warn)', minWidth: '14px' }}>
                    {idx + 1}
                  </span>
                  {syms[0] && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)', padding: '1px 5px', borderRadius: '3px', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)' }}>
                      {syms[0]}
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: 'var(--mc-text-1)', flex: 1, lineHeight: 1.4 }}>
                    {getTitle(art)}
                  </span>
                  {(art as any).specific_impact?.label && (
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', padding: '1px 6px', borderRadius: '3px', border: '1px solid color-mix(in srgb, var(--mc-accent) 19%, transparent)' }}>
                      {(art as any).specific_impact.label}
                    </span>
                  )}
                  <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', flexShrink: 0 }}>{time}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}


      {/* ── PATCH 0068: TRANSFORMATIONAL CONTRACTS — 6-month rolling band
              PATCH 0085: typography + card padding doubled to match the larger
              persistent-bottleneck panel above. ── */}
      {transformationalPreview && transformationalPreview.count > 0 && (
        <div style={{
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)',
          borderLeft: '4px solid var(--mc-state-persistent)',
          borderRadius: '14px', padding: '16px 20px', marginBottom: '16px',
        }}>
          <button
            onClick={() => setShowTransformational(s => !s)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, margin: 0, width: '100%',
              color: 'inherit', textAlign: 'left',
            }}
          >
            {/* PATCH 0085: section header 10 → 15 */}
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--mc-state-persistent)', letterSpacing: '0.8px' }}>
              🌟 TRANSFORMATIONAL CONTRACTS
            </span>
            <span style={{ fontSize: '13px', color: 'var(--mc-text-4)' }}>
              {transformationalPreview.total_in_ledger || transformationalPreview.count} qualifying contracts in last {transformationalPreview.window_days || 180} days · newest first
              {(() => {
                const ts = transformationalPreview.summary?.newest_recorded_at || transformationalPreview.articles?.[0]?.published_at;
                const d = ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null;
                return d === null || !Number.isFinite(d) ? '' : ` · latest ${d <= 0 ? 'today' : `${d}d ago`}`;
              })()}
            </span>
            <a
              href="/strategic-visibility"
              onClick={(e) => e.stopPropagation()}
              style={{
                marginLeft: 8, fontSize: '13px', fontWeight: 700, color: 'var(--mc-cyan)',
                textDecoration: 'none', backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 5, padding: '3px 10px',
                letterSpacing: '0.4px',
              }}
            >
              FULL LEDGER →
            </a>
            <span style={{ fontSize: '13px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>
              {showTransformational ? '▼ collapse' : '▶ expand'}
            </span>
          </button>
          {showTransformational && (
            // PATCH 0085: card minWidth 360 → 520, gap 8 → 14
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 14 }}>
              {transformationalPreview.articles.slice(0, 6).map((a) => (
                <a
                  key={a.id}
                  href={a.source_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    // PATCH 0085: card padding 8/10 → 14/18, radius 8 → 12
                    backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)',
                    borderRadius: 12, padding: '14px 18px',
                    textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    {(a.ticker_symbols ?? []).slice(0, 2).map((t) => (
                      // PATCH 0085: ticker chips 9 → 13
                      <span key={t} style={{ fontSize: 13, fontWeight: 700, color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)', padding: '3px 8px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)' }}>
                        {t}
                      </span>
                    ))}
                    {a.strategic_visibility.contract_value_usd_m && (
                      // PATCH 0085: $ value 9 → 14
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-bullish)' }}>
                        {a.strategic_visibility.contract_value_usd_m >= 1000
                          ? `$${(a.strategic_visibility.contract_value_usd_m / 1000).toFixed(1)}B`
                          : `$${a.strategic_visibility.contract_value_usd_m.toFixed(0)}M`}
                      </span>
                    )}
                    {a.strategic_visibility.visibility_years && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-warn)' }}>
                        {a.strategic_visibility.visibility_years}y
                      </span>
                    )}
                    {(a as any).contract_to_mcap_pct != null && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text-2)' }} title="Contract value ÷ the company's market value">
                        ≈{(a as any).contract_to_mcap_pct}% of mkt cap
                      </span>
                    )}
                    {(a.strategic_visibility as any).value_not_stated && (
                      <span style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>value not stated</span>
                    )}
                    {a.strategic_visibility.flags.includes('STRATEGIC_CHOKEPOINT') && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-state-persistent)' }}>🔒</span>
                    )}
                    {a.strategic_visibility.flags.includes('POLICY_BACKED') && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-cyan)' }}>🧭</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mc-text-3)', fontWeight: 600 }}>
                      {a.published_at ? new Date(a.published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : '—'}
                    </span>
                  </div>
                  {/* PATCH 0085: title 11 → 16 */}
                  <div style={{ fontSize: 16, color: 'var(--mc-text-1)', lineHeight: 1.4, fontWeight: 500 }}>
                    {a.title}
                  </div>
                  {/* PATCH 0085: counterparty meta 9 → 13 */}
                  <div style={{ fontSize: 13, color: 'var(--mc-text-4)', marginTop: 8 }}>
                    {a.strategic_visibility.counterparty_name || '—'} · {a.source_name}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PHASE 1.5: FORWARD CALENDAR — collapsible ────────────────── */}
      {calendar && (calendar.tomorrow.length + calendar.this_week.length + calendar.this_month.length) > 0 && (
        <div style={{
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)',
          borderRadius: '12px', padding: '10px 12px', marginBottom: '12px',
        }}>
          <button
            onClick={() => setShowCalendar(s => !s)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, margin: 0, width: '100%',
              color: 'inherit', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mc-bullish)', letterSpacing: '0.8px' }}>
              📅 FORWARD CALENDAR
            </span>
            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>
              Tomorrow: {calendar.tomorrow.length} · This week: {calendar.this_week.length} · This month: {calendar.this_month.length}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>
              {/* PATCH 0435 BUG-022/034 — distinct label so user can tell these
                  two stacked expand controls apart */}
              {showCalendar ? '▼ Hide Calendar' : '▶ Show Calendar'}
            </span>
          </button>
          {showCalendar && (
            <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              {(['tomorrow', 'this_week', 'this_month'] as const).map(bucket => (
                <div key={bucket}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mc-text-3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
                    {bucket === 'tomorrow' ? '⏰ Tomorrow' : bucket === 'this_week' ? '📅 This Week' : '🗓️ This Month'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                    {(calendar[bucket] || []).slice(0, 12).map((ev, i) => (
                      <div key={i} style={{
                        fontSize: '10px', padding: '4px 6px', borderRadius: '4px',
                        backgroundColor: ev.importance === 'high' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)',
                        borderLeft: `2px solid ${ev.importance === 'high' ? 'var(--mc-bearish)' : 'var(--mc-text-4)'}`,
                      }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                          <span style={{ color: 'var(--mc-text-3)', fontFamily: 'monospace', flexShrink: 0 }}>
                            {ev.date.slice(5)}
                          </span>
                          {ev.region && (
                            <span style={{ color: ev.region === 'IN' ? 'var(--mc-warn)' : '#7dd3fc', fontSize: '9px' }}>
                              {ev.region === 'IN' ? '🇮🇳' : ev.region === 'US' ? '🇺🇸' : '🌐'}
                            </span>
                          )}
                          <span style={{ color: 'var(--mc-text-1)', lineHeight: 1.3 }}>
                            {ev.title}
                          </span>
                        </div>
                      </div>
                    ))}
                    {(calendar[bucket] || []).length === 0 && (
                      <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontStyle: 'italic' }}>
                        Nothing scheduled
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PATCH 0050: EMERGING STRESS SIGNALS — institutional anomaly box ── */}
      {anomalies && ((anomalies.themes_v2?.length || 0) > 0 || (anomalies.tickers_v2?.length || 0) > 0) && (
        <div style={{
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)',
          borderLeft: '3px solid var(--mc-bearish)',
          borderRadius: '12px', padding: '12px 14px', marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--mc-bearish)', letterSpacing: '0.8px' }}>
              🚨 {anomalies.section_title || 'Emerging Stress Signals'}
            </span>
            <span style={{ fontSize: '10px', color: '#6677AA' }}>
              {anomalies.section_subtitle || 'Themes & names with article concentration above baseline'}
            </span>
          </div>
          {(anomalies.themes_v2 || []).slice(0, 4).map((t: any) => {
            const stateColor = t.deviation === 'DOMINANT' ? '#EF4444' : t.deviation === 'ESCALATING' ? '#F59E0B' : '#10B981';
            return (
              <div key={t.display_name} style={{ marginBottom: '6px', fontSize: '11px', lineHeight: 1.5 }}>
                <span style={{ color: stateColor, fontWeight: 700, marginRight: '6px' }}>
                  {t.deviation === 'DOMINANT' ? '●●●' : t.deviation === 'ESCALATING' ? '●●' : '●'}
                </span>
                <strong style={{ color: 'var(--mc-text-0)' }}>{t.display_name}</strong>
                <span style={{ color: 'var(--mc-text-4)', marginLeft: '6px' }}>×{t.count} (baseline ~{t.baseline_count})</span>
                <div style={{ color: 'var(--mc-text-3)', marginLeft: '24px', marginTop: '2px', fontSize: '10px' }}>
                  → {t.why_it_matters}
                </div>
              </div>
            );
          })}
          {(anomalies.tickers_v2 || []).slice(0, 5).length > 0 && (
            <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--mc-border-1)' }}>
              <span style={{ fontSize: '10px', color: '#6677AA', marginRight: '8px' }}>Names clustering:</span>
              {(anomalies.tickers_v2 || []).slice(0, 5).map((tk: any) => {
                const tkColor = tk.deviation === 'DOMINANT' ? '#EF4444' : tk.deviation === 'ESCALATING' ? '#F59E0B' : '#10B981';
                return (
                  <span key={tk.display_name} style={{ marginRight: '10px', fontSize: '10px' }}>
                    <strong style={{ color: tkColor }}>{tk.display_name}</strong>
                    <span style={{ color: 'var(--mc-text-4)' }}> ×{tk.count}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--mc-text-0)', margin: 0 }}>News Feed</h1>
            {/* PATCH 0212 — consolidated freshness indicator */}
            <PanelFreshness dataUpdatedAt={dataUpdatedAt} isFetching={isLoading} staleAfterMs={5 * 60_000} />
          </div>
        </div>
        {/* PATCH 0213 — Lifecycle filter row (separate from other filter pills
            so it always stands at the top of the controls). Defaults to
            'Live + Warm' so the main feed never shows soup. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, fontSize: 10, color: '#6B7B8C', fontWeight: 700, letterSpacing: '0.5px' }}>
          <span>LIFECYCLE:</span>
          {/* PATCH 0569 (UX #2) — Tooltip hints expanded so the meaning of
              each lifecycle bucket is unambiguous on hover. */}
          {([
            { key: 'LIVE_WARM',  label: '● Live + Warm',  hint: 'Live + Warm — articles published in the last 48 hours. Default feed: most actionable, recency-weighted ranking.', bg: '#10B98120', border: '#10B981', text: '#10B981' },
            { key: 'STALE',      label: '◐ Stale',        hint: 'Stale — 48 hours to 7 days old. Still useful for context but losing market relevance; check timestamp before acting.', bg: '#F59E0B20', border: '#F59E0B', text: '#F59E0B' },
            { key: 'PERSISTENT', label: '◑ Persistent',   hint: 'Persistent — older than 7 days but flagged as a structural / ongoing theme worth re-reading (e.g. multi-quarter bottlenecks).', bg: '#A78BFA20', border: '#A78BFA', text: '#A78BFA' },
            { key: 'ALL',        label: '○ All',          hint: 'All — no lifecycle filter. Shows every article regardless of age.', bg: '#1E2D45',   border: '#1E2D45', text: '#8A95A3' },
          ] as const).map(f => {
            const active = lifecycleFilter === f.key;
            // AUDIT_100 #31 — chip count badge so users see bucket size before clicking.
            const n = lifecycleCounts[f.key as keyof typeof lifecycleCounts] ?? 0;
            return (
              <button
                key={f.key}
                onClick={() => setLifecycleFilter(f.key)}
                title={f.hint}
                style={{
                  backgroundColor: active ? f.bg : 'transparent',
                  border: `1px solid ${active ? f.border : 'var(--mc-border-1)'}`,
                  color: active ? f.text : '#6B7B8C',
                  borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
                }}
              >{f.label} <span style={{ opacity: 0.7, fontWeight: 600 }}>({n})</span></button>
            );
          })}
          {/* PATCH 0225 — Named Saved Views (localStorage-backed) on top of
              the URL-persistent state from Patch 0218. */}
          <SavedViewsControl />
        </div>
        {/* Controls row — horizontally scrollable on mobile.
            Patch 0556 (BUG-AUDIT-1): position:relative + zIndex so the
            Filters button click cannot bleed through to underlying
            article links. */}
        <div className="scrollbar-hide mobile-scroll" style={{ display: 'flex', gap: '8px', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px', position: 'relative', zIndex: 20 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search news…"
            style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '8px', padding: '7px 12px', color: 'var(--mc-text-0)', fontSize: '14px', minWidth: '160px', width: '200px', outline: 'none', flexShrink: 0 }}
          />
          <button
            onClick={() => { setArticleType(articleType === 'BOTTLENECK' ? 'ALL' : 'BOTTLENECK'); setBottleneckLevel('ALL'); setBottleneckCategory('ALL'); setStructuralOnly(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: articleType === 'BOTTLENECK' ? 'color-mix(in srgb, var(--mc-bearish) 13%, transparent)' : 'var(--mc-bg-2)', border: `1px solid ${articleType === 'BOTTLENECK' ? 'var(--mc-bearish)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: articleType === 'BOTTLENECK' ? 'var(--mc-bearish)' : 'var(--mc-text-3)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show critical bottleneck news (GPU, Memory, Photonics, Power, etc.)"
          >
            BOTTLENECKS
          </button>
          <button
            onClick={() => setRegion(region === 'IN' ? 'ALL' : 'IN')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: region === 'IN' ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'var(--mc-bg-2)', border: `1px solid ${region === 'IN' ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: region === 'IN' ? 'var(--mc-accent)' : 'var(--mc-text-3)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show only India news"
          >
            🇮🇳 India
          </button>
          <button
            onClick={() => setRegion(region === 'US' ? 'ALL' : 'US')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: region === 'US' ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'var(--mc-bg-2)', border: `1px solid ${region === 'US' ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: region === 'US' ? 'var(--mc-accent)' : 'var(--mc-text-3)', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show only US news"
          >
            🇺🇸 US
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowFilters(f => !f); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: showFilters ? 'var(--mc-accent)' : 'var(--mc-bg-2)', border: `1px solid ${showFilters ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: 'var(--mc-text-0)', fontSize: '12px', cursor: 'pointer', flexShrink: 0, minHeight: '36px', position: 'relative', zIndex: 21 }}
          >
            <Filter style={{ width: '12px', height: '12px' }} /> Filters
            {(region !== 'ALL' || articleType !== 'ALL' || signalFilter !== 'ALL' || sourceName !== 'ALL' || search) && (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--mc-warn)', display: 'inline-block', marginLeft: '2px' }} />
            )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '8px', padding: '7px 10px', color: isRefreshing ? 'var(--mc-accent)' : 'var(--mc-text-4)', cursor: isRefreshing ? 'wait' : 'pointer', opacity: isRefreshing ? 0.7 : 1, flexShrink: 0, minHeight: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={isRefreshing ? 'Fetching latest news from sources…' : 'Refresh news from RSS feeds'}
          >
            <RefreshCw style={{ width: '12px', height: '12px', animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────── */}
      {showFilters && (
        <div ref={filterPanelRef} style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '14px', padding: '14px', marginBottom: '12px', position: 'relative' }}>
          {/* Close button */}
          <button
            onClick={() => setShowFilters(false)}
            style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Close filters (Esc)"
          >
            <X style={{ width: '14px', height: '14px' }} />
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>REGION</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {REGIONS.map(r => (
                  <button key={r} onClick={() => setRegion(r)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${region === r ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: region === r ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', color: region === r ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}>
                    {r === 'IN' ? '🇮🇳 India' : r === 'US' ? '🇺🇸 US' : 'All'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>CATEGORY</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {TYPES.map(t => (
                  <button key={t} onClick={() => setArticleType(t)}
                    style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${articleType === t ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: articleType === t ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', color: articleType === t ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}>
                    {t === 'ALL' ? 'All' : t.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
            {/* PATCH 0121 — IMP-08: Q4 FY26 Earnings Season quick filter */}
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>EARNINGS SEASON</p>
              <button onClick={() => setEarningsSeasonActive(v => !v)}
                style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${earningsSeasonActive ? 'var(--mc-bullish)' : 'var(--mc-border-1)'}`, backgroundColor: earningsSeasonActive ? 'color-mix(in srgb, var(--mc-bullish) 13%, transparent)' : 'transparent', color: earningsSeasonActive ? 'var(--mc-bullish)' : 'var(--mc-text-3)' }}
                title="Filter to Q4 FY26 results window (Apr 1 → Jul 31 2026), category locked to EARNINGS">
                📊 Q4 FY26 Earnings {earningsSeasonActive ? '✓' : ''}
              </button>
            </div>
            {/* PATCH 0129 — Strategy filter ([MB] / [BN] / [RR]) */}
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>STRATEGY</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {([
                  { v: 'ALL', label: 'All', color: '#8A95A3' },
                  { v: 'MB',  label: '⭐ MB · Multibagger',  color: '#FACC15' },
                  { v: 'BN',  label: '🛑 BN · Bottleneck',   color: '#F87171' },
                  { v: 'RR',  label: '↗ RR · Re-rating',     color: '#A78BFA' },
                ] as const).map((s) => (
                  <button key={s.v} onClick={() => setStrategyFilter(s.v as any)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${strategyFilter === s.v ? s.color : 'var(--mc-border-1)'}`, backgroundColor: strategyFilter === s.v ? s.color + '20' : 'transparent', color: strategyFilter === s.v ? s.color : 'var(--mc-text-3)' }}
                    title={`Show only articles tagged ${s.label}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {/* "My Book only" — filter to held ∪ bench ∪ watch (reuses book.all) */}
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>MY BOOK</p>
              <button onClick={() => setBookOnly(v => !v)}
                style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${bookOnly ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: bookOnly ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', color: bookOnly ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}
                title={`Show only news for names you hold, bench, or watch (${book.all.size} tickers)`}>
                📓 My Book only{bookOnly ? ' ✓' : ''}{book.all.size ? ` · ${book.all.size}` : ''}
              </button>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>SIGNAL STRENGTH</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {SIGNAL_FILTERS.map(s => (
                  <button key={s.value} onClick={() => setSignalFilter(s.value)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${signalFilter === s.value ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: signalFilter === s.value ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', color: signalFilter === s.value ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>SOURCE</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {SOURCES.map(s => (
                  <button key={s} onClick={() => setSourceName(s)}
                    style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${sourceName === s ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: sourceName === s ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', color: sourceName === s ? 'var(--mc-accent)' : 'var(--mc-text-3)' }}>
                    {s === 'ALL' ? 'All' : s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              // PATCH 0460 — also reset lifecycleFilter + sortBy so "Clear
              // filters" actually returns the user to the default view.
              // Previously these two were not cleared and a confused user
              // still saw a filtered list. The useEffect that writes URL
              // state will sync the URL automatically.
              setRegion('ALL');
              setArticleType('ALL');
              setSourceName('ALL');
              setSignalFilter('ALL');
              setBottleneckLevel('ALL');
              setBottleneckCategory('ALL');
              setStructuralOnly(false);
              setSearch('');
              setEarningsSeasonActive(false);
              setStrategyFilter('ALL');
              setLifecycleFilter('LIVE_WARM');
              setSortBy('impact');
            }}
            style={{ marginTop: '12px', fontSize: '11px', color: 'var(--mc-text-4)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <X style={{ width: '10px', height: '10px' }} /> Clear filters
          </button>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {/* PATCH 0693 — show error OR explicit timeout state. Last-scan
          timestamp surfaces what we know so the user doesn't think the
          UI is frozen. */}
      {(error || newsTimeout) && !isLoading && (
        <div style={{ backgroundColor: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle style={{ width: '16px', height: '16px', color: 'var(--mc-bearish)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: '13px', color: '#fca5a5' }}>
              {newsTimeout && !error
                ? '⚠ Upstream slow — news feed did not respond in 25s'
                : 'Could not load news — check that the backend is running'}
            </span>
            {newsFetchedAt && (
              <span style={{ fontSize: 11, color: '#7d8a99' }}>Last scan: {newsFetchedAt} IST</span>
            )}
          </div>
          <button
            onClick={() => { setNewsTimeout(false); refetch(); handleRefresh(); }}
            disabled={isRefreshing}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--mc-bearish)', borderRadius: 6, padding: '4px 12px', color: 'var(--mc-bearish)', cursor: isRefreshing ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 700 }}
          >
            {isRefreshing ? 'Refreshing…' : '↻ Retry'}
          </button>
        </div>
      )}

      {/* ── BOTTLENECK ARTICLES (shown at TOP when BOTTLENECK mode is active) ── */}
      {showBottleneckDashboard && !isLoading && (
        <div style={{ marginBottom: '16px' }}>
          {/* Sticky header+filter bar */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderRadius: '12px',
            padding: '12px 16px', marginBottom: '10px',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--mc-bearish)', letterSpacing: '0.5px' }}>BOTTLENECK ARTICLES</span>
              <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
                {articles.length} articles{region !== 'ALL' ? ` · ${region === 'IN' ? '🇮🇳 India' : '🇺🇸 US'}` : ''}
              </span>
              <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
                {/* Sort toggle */}
                <button
                  onClick={() => setSortBy(sortBy === 'impact' ? 'time' : 'impact')}
                  style={{
                    fontSize: '10px', fontWeight: '600', padding: '4px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: `1px solid ${sortBy === 'impact' ? 'color-mix(in srgb, var(--mc-warn) 38%, transparent)' : 'var(--mc-border-1)'}`,
                    backgroundColor: sortBy === 'impact' ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'transparent',
                    color: sortBy === 'impact' ? 'var(--mc-warn)' : 'var(--mc-text-3)',
                  }}
                  title="Toggle sort order"
                >
                  {sortBy === 'impact' ? '▲ By Impact' : '🕒 By Time'}
                </button>
                {/* Structural-only toggle */}
                <button
                  onClick={() => setStructuralOnly(v => !v)}
                  style={{
                    fontSize: '10px', fontWeight: '600', padding: '4px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: `1px solid ${structuralOnly ? 'color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)' : 'var(--mc-border-1)'}`,
                    backgroundColor: structuralOnly ? 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)' : 'transparent',
                    color: structuralOnly ? 'var(--mc-state-persistent)' : 'var(--mc-text-3)',
                  }}
                  title="Show only structural (non-news) signals"
                >
                  {structuralOnly ? '● Structural Only' : '○ Structural Only'}
                </button>
              </div>
            </div>
            {/* ── Bottleneck Level Sub-Filters ── */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {([
                { value: 'ALL', label: 'All', color: '#8A95A3', bg: '#111B35', border: '#1E2D45', icon: '' },
                { value: 'CRITICAL_BOTTLENECK', label: 'Critical', color: '#EF4444', bg: '#EF444418', border: '#EF444440', icon: '🔴' },
                { value: 'BOTTLENECK', label: 'Bottleneck', color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B30', icon: '🟠' },
                { value: 'WATCH', label: 'Watch', color: '#3B82F6', bg: '#3B82F615', border: '#3B82F630', icon: '🔵' },
                { value: 'RESOLVED_EASING', label: 'Resolved / Easing', color: '#10B981', bg: '#10B98115', border: '#10B98130', icon: '🟢' },
              ] as const).map(lvl => {
                const isActive = bottleneckLevel === lvl.value;
                // Count respects region + category + structural toggles for a meaningful live count
                const count = lvl.value === 'ALL'
                  ? articles.length
                  : (allArticles || []).filter(a => {
                      if (a.article_type !== 'BOTTLENECK') return false;
                      if (a.bottleneck_level !== lvl.value) return false;
                      if (region !== 'ALL' && a.region !== region && a.region !== 'GLOBAL') return false;
                      if (bottleneckCategory !== 'ALL' && a.bottleneck_sub_tag !== bottleneckCategory) return false;
                      return true;
                    }).length;
                return (
                  <button
                    key={lvl.value}
                    onClick={() => setBottleneckLevel(lvl.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600',
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? lvl.color : 'var(--mc-border-1)'}`,
                      backgroundColor: isActive ? lvl.bg : 'transparent',
                      color: isActive ? lvl.color : 'var(--mc-text-3)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {lvl.icon && <span style={{ fontSize: '8px' }}>{lvl.icon}</span>}
                    {lvl.label}
                    <span style={{
                      fontSize: '9px', fontWeight: '700',
                      padding: '1px 5px', borderRadius: '4px',
                      backgroundColor: isActive ? `${lvl.color}20` : 'color-mix(in srgb, var(--mc-border-1) 50%, transparent)',
                      color: isActive ? lvl.color : 'var(--mc-text-4)',
                      marginLeft: '2px',
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* ── Bottleneck Category (sub-tag) Filters ── */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {([
                { value: 'ALL', label: 'All Categories', icon: '' },
                { value: 'MEMORY_STORAGE', label: 'Memory', icon: '🧠' },
                { value: 'INTERCONNECT_PHOTONICS', label: 'Photonics', icon: '💡' },
                { value: 'FABRICATION_PACKAGING', label: 'Packaging', icon: '🏭' },
                { value: 'COMPUTE_SCALING', label: 'Compute', icon: '⚡' },
                { value: 'POWER_GRID', label: 'Power', icon: '🔌' },
                { value: 'NUCLEAR_ENERGY', label: 'Nuclear', icon: '☢️' },
                { value: 'THERMAL_COOLING', label: 'Cooling', icon: '❄️' },
                { value: 'MATERIALS_SUPPLY', label: 'Materials', icon: '⛏️' },
                { value: 'QUANTUM_CRYOGENICS', label: 'Quantum', icon: '🧊' },
              ] as const).map(cat => {
                const isActive = bottleneckCategory === cat.value;
                const canDrill = cat.value !== 'ALL' && BOTTLENECK_DRILLDOWN[cat.value];
                const count = cat.value === 'ALL'
                  ? articles.length
                  : (allArticles || []).filter(a => {
                      if (a.article_type !== 'BOTTLENECK') return false;
                      if (a.bottleneck_sub_tag !== cat.value) return false;
                      if (region !== 'ALL' && a.region !== region && a.region !== 'GLOBAL') return false;
                      if (bottleneckLevel !== 'ALL' && a.bottleneck_level !== bottleneckLevel) return false;
                      return true;
                    }).length;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setBottleneckCategory(cat.value)}
                    onDoubleClick={() => { if (canDrill) setDrilldownSubTag(cat.value); }}
                    title={canDrill ? 'Click to filter · Double-click to open drilldown' : ''}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '4px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600',
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? 'var(--mc-state-persistent)' : 'var(--mc-border-1)'}`,
                      backgroundColor: isActive ? 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)' : 'transparent',
                      color: isActive ? 'var(--mc-state-persistent)' : 'var(--mc-text-3)',
                    }}
                  >
                    {cat.icon && <span style={{ fontSize: '9px' }}>{cat.icon}</span>}
                    {cat.label}
                    <span style={{
                      fontSize: '9px', fontWeight: '700',
                      padding: '1px 4px', borderRadius: '3px',
                      backgroundColor: isActive ? 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)' : 'color-mix(in srgb, var(--mc-border-1) 50%, transparent)',
                      color: isActive ? 'var(--mc-state-persistent)' : 'var(--mc-text-4)',
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Drilldown launch bar when category is selected */}
          {bottleneckCategory !== 'ALL' && BOTTLENECK_DRILLDOWN[bottleneckCategory] && (
            <button
              onClick={() => setDrilldownSubTag(bottleneckCategory)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)',
                borderRadius: '10px', padding: '10px 14px', marginBottom: '10px',
                cursor: 'pointer', textAlign: 'left', color: 'var(--mc-text-2)',
              }}
            >
              <span style={{ fontSize: '20px' }}>{BOTTLENECK_DRILLDOWN[bottleneckCategory].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--mc-state-persistent)' }}>
                  {BOTTLENECK_DRILLDOWN[bottleneckCategory].label} · Analysis
                </div>
                <div style={{ fontSize: '10px', color: 'var(--mc-text-3)' }}>
                  Click for supply/demand breakdown and listed companies impacted
                </div>
              </div>
              <ChevronRight style={{ width: '14px', height: '14px', color: 'var(--mc-state-persistent)' }} />
            </button>
          )}

          {/* Articles list OR empty state */}
          {articles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '12px' }}>
              <p style={{ fontSize: '28px', marginBottom: '10px' }}>🔎</p>
              <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 6px' }}>
                No bottleneck articles match your filters
              </p>
              <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: '0 0 14px', lineHeight: '1.5' }}>
                Try clearing the level, category, or structural-only filters.
              </p>
              <button
                onClick={() => { setBottleneckLevel('ALL'); setBottleneckCategory('ALL'); setStructuralOnly(false); }}
                style={{ backgroundColor: 'var(--mc-accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
              >
                Reset Bottleneck Filters
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* PATCH 1094 — bottleneck-list card gap 8→10 */}
              {articles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
            </div>
          )}

          {articles.length > 0 && (
            <div style={{ textAlign: 'center', padding: '12px 0 4px', fontSize: '11px', color: 'var(--mc-text-4)' }}>
              Showing {articles.length} bottleneck articles
              {bottleneckLevel !== 'ALL' ? ` · Level: ${bottleneckLevel.replace(/_/g, ' ')}` : ''}
              {bottleneckCategory !== 'ALL' ? ` · Category: ${bottleneckCategory.replace(/_/g, ' ')}` : ''}
              {structuralOnly ? ' · Structural Only' : ''}
              {' · Sort: '}{sortBy === 'impact' ? 'Impact' : 'Time'}
              {' · Includes persistent signals up to 90 days'}
            </div>
          )}
        </div>
      )}

      {/* ── Bottleneck Dashboard (category intelligence below articles) */}
      {showBottleneckDashboard && (
        <div style={{ marginBottom: '16px' }}>
          <BottleneckDashboard
            dashboard={bnDashboard}
            isLoading={bnLoading}
            onOpenDrilldown={setDrilldownSubTag}
            bottleneckLevel={bottleneckLevel}
            bottleneckCategory={bottleneckCategory}
          />
        </div>
      )}

      {/* ── Signal summary bar ─────────────────────────────────────── */}
      {!isLoading && articles?.length > 0 && !showBottleneckDashboard && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', padding: '8px 12px', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', fontWeight: '700', color: '#6A7B8C', letterSpacing: '0.5px' }}>SIGNALS</span>
          <span style={{ fontSize: '11px', color: 'var(--mc-bearish)', fontWeight: '600' }}>
            {/* PATCH 0720 — read from memoized tierCounts */}
            🔴 {tierCounts.high} High
          </span>
          <span style={{ fontSize: '11px', color: 'var(--mc-warn)', fontWeight: '600' }}>
            🟡 {tierCounts.medium} Medium
          </span>
          <button
            onClick={() => setSignalFilter(signalFilter === 'LOW' ? 'ALL' : 'LOW')}
            title="Low/Noise (tier-3) stories are hidden from the default feed. Click to view only them; click again to return."
            style={{ fontSize: '11px', fontWeight: '600', cursor: 'pointer', borderRadius: '6px', padding: '1px 7px', backgroundColor: signalFilter === 'LOW' ? 'color-mix(in srgb, var(--mc-text-3) 9%, transparent)' : 'transparent', border: `1px solid ${signalFilter === 'LOW' ? 'color-mix(in srgb, var(--mc-text-3) 38%, transparent)' : 'transparent'}`, color: 'var(--mc-text-3)' }}
          >
            ⚪ {noiseCount} Low
          </button>
          <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
            {articles.length} total
          </span>
          {/* PATCH 0227 — Visible sort chip with click-to-toggle. Previously
              the impact/time sort was only exposed in the bottleneck dashboard
              header; the main feed had no UI for it. */}
          <button
            onClick={() => setSortBy(sortBy === 'impact' ? 'time' : 'impact')}
            style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: '700', cursor: 'pointer', borderRadius: '6px', padding: '3px 9px',
              backgroundColor: sortBy === 'impact' ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)',
              border: `1px solid ${sortBy === 'impact' ? 'color-mix(in srgb, var(--mc-warn) 38%, transparent)' : 'color-mix(in srgb, var(--mc-cyan) 38%, transparent)'}`,
              color: sortBy === 'impact' ? 'var(--mc-warn)' : 'var(--mc-cyan)',
              letterSpacing: '0.4px',
            }}
            title={sortBy === 'impact'
              ? 'Sorted by Priority score (see the P N badge on each card). Click to switch to chronological.'
              : 'Sorted chronologically (newest first). Click to switch to Priority sort.'}
          >
            SORT: {sortBy === 'impact' ? '▲ PRIORITY' : '🕒 TIME'}
          </button>
          {/* Layer grouping toggle */}
          <button
            onClick={() => setGroupByLayer(g => !g)}
            style={{ fontSize: '10px', fontWeight: '600', color: groupByLayer ? 'var(--mc-accent)' : 'var(--mc-text-4)', background: 'none', border: `1px solid ${groupByLayer ? 'color-mix(in srgb, var(--mc-accent) 25%, transparent)' : 'var(--mc-border-1)'}`, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}
          >
            {groupByLayer ? 'Grouped' : 'Timeline'}
          </button>
        </div>
      )}

      {/* ── Articles list (non-bottleneck modes, or loading state) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: '80px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '14px' }} className="animate-shimmer" />
          ))
        ) : !articles?.length ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: '32px', marginBottom: '12px' }}>📰</p>
            <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 8px' }}>No articles match your filters</p>
            <p style={{ fontSize: '13px', color: 'var(--mc-text-4)', margin: '0 0 16px' }}>
              {/* PATCH 0215 — explicit guidance about which filter likely caused this */}
              {lifecycleFilter !== 'ALL'
                ? `Lifecycle filter set to "${lifecycleFilter === 'LIVE_WARM' ? 'Live + Warm (≤48h)' : lifecycleFilter}". Try widening to "All" or selecting a different bucket.`
                : (search || region !== 'ALL' || articleType !== 'ALL' || sourceName !== 'ALL'
                    ? 'Try clearing the search box or relaxing your region / type / source filters'
                    : 'No articles in the feed yet — they refresh every 90 seconds')}
            </p>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              {lifecycleFilter !== 'ALL' && (
                <button
                  onClick={() => setLifecycleFilter('ALL')}
                  style={{ backgroundColor: 'transparent', color: TOKENS.surface.text, border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: '8px', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}
                >Clear lifecycle filter</button>
              )}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                style={{ backgroundColor: 'var(--mc-accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', cursor: isRefreshing ? 'wait' : 'pointer', opacity: isRefreshing ? 0.7 : 1 }}
              >
                {isRefreshing ? 'Fetching news…' : 'Refresh Now'}
              </button>
            </div>
          </div>
        ) : showBottleneckDashboard && articles?.length > 0 ? (
          // Bottleneck articles already shown at top — don't duplicate
          null
        ) : groupByLayer && !showBottleneckDashboard && articleType === 'ALL' ? (
          // ── Layered view: group articles by institutional hierarchy ──
          <>
            {/* PATCH 0720 — read layered articles from the memoized map
                instead of walking the full array N times per render. */}
            {(['MACRO_REGIME', 'STRUCTURAL', 'COMPANY_ALPHA', 'GENERAL'] as FeedLayer[]).map(layer => {
              const layerArticles = layerArticleMap[layer];
              if (layerArticles.length === 0) return null;
              const config = LAYER_CONFIG[layer];
              return (
                <div key={layer}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', marginTop: '12px', paddingBottom: '6px', borderBottom: `1px solid ${config.color}30` }}>
                    <div style={{ width: '3px', height: '16px', borderRadius: '2px', backgroundColor: config.color }} />
                    <span style={{ fontSize: '11px', fontWeight: '700', color: config.color, letterSpacing: '0.8px' }}>{config.label}</span>
                    <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{config.description}</span>
                    <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>{layerArticles.length}</span>
                  </div>
                  {/* PATCH 1094 — wrap grouped layer cards in flex column so
                      they don't stack edge-to-edge (was the biggest tightness
                      driver in grouped view, the default). */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {layerArticles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
                  </div>
                </div>
              );
            })}
            <div style={{ textAlign: 'center', padding: '16px 0 8px', fontSize: '12px', color: 'var(--mc-text-4)' }}>
              {/* PATCH 0720 — count layers from the memoized map (was a
                  nested filter+some that was O(N×4) on every render). */}
              Showing {articles.length} articles across {(['MACRO_REGIME', 'STRUCTURAL', 'COMPANY_ALPHA', 'GENERAL'] as FeedLayer[]).filter(l => layerArticleMap[l].length > 0).length} layers
            </div>
          </>
        ) : (
          // ── Timeline view: chronological ──
          <>
            {/* PATCH 1094 — same flex-column gap fix for timeline view. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {articles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
            </div>
            <div style={{ textAlign: 'center', padding: '16px 0 8px', fontSize: '12px', color: 'var(--mc-text-4)' }}>
              Showing {articles.length} articles
            </div>
          </>
        )}

        {/* PATCH 0226 — Demoted stale strip. When lifecycleFilter='LIVE_WARM'
            (default) AND the dataset contains stale items the user would have
            seen with 'ALL', surface them as a compact strip beneath the feed
            so they're never invisible — just visually demoted. */}
        {staleHiddenCount > 0 && lifecycleFilter === 'LIVE_WARM' && !isLoading && (
          <button
            onClick={() => setLifecycleFilter('STALE')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', marginTop: 8, padding: '10px 14px',
              backgroundColor: 'color-mix(in srgb, var(--mc-warn) 4%, transparent)',
              border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)',
              borderRadius: 8, cursor: 'pointer',
              color: 'var(--mc-warn)', fontSize: 12, fontWeight: 600,
              textAlign: 'left', fontFamily: 'inherit',
            }}
            title="Switch the lifecycle filter to STALE to view these"
          >
            <span>◐ Recent (48h–7d) — {staleHiddenCount} stale {staleHiddenCount === 1 ? 'item' : 'items'} hidden by current filter</span>
            <span style={{ fontSize: 11, opacity: 0.8 }}>View stale →</span>
          </button>
        )}
      {/* ── PATCH 0079: PERSISTENT BOTTLENECK READING — auto-detected from
              accumulated evidence with per-domain decay (90d structural,
              14d cyclical). Surfaces HBM/CoWoS/grid/HALEU even when no
              fresh news today. ── */}
      {persistentBottlenecks && persistentBottlenecks.count > 0 && (() => {
        // PATCH 0086: split items into India / Global panels.  Each card carries
        // a region tag from the API; default to GLOBAL when missing so legacy
        // cached responses keep working.
        // PATCH 0088: within each region, sort latest-first (is_latest === true
        // first, by ascending first_seen_age_days), so newly-emerged bottlenecks
        // surface at the top for 10 days then drop back into the normal sort.
        const sortLatestFirst = (a: PersistentBottleneckItem, b: PersistentBottleneckItem) => {
          const aLatest = a.is_latest ? 1 : 0;
          const bLatest = b.is_latest ? 1 : 0;
          if (aLatest !== bLatest) return bLatest - aLatest;
          if (aLatest && bLatest) {
            return (a.first_seen_age_days ?? 999) - (b.first_seen_age_days ?? 999);
          }
          return 0;  // preserve server-side confidence/structural sort
        };
        const allItems = persistentBottlenecks.items;
        const indiaItems = allItems.filter((i) => i.region === 'IN').slice().sort(sortLatestFirst);
        const globalItems = allItems.filter((i) => i.region !== 'IN').slice().sort(sortLatestFirst);
        const newInLast10dIN = indiaItems.filter((i) => i.is_latest).length;
        const newInLast10dGL = globalItems.filter((i) => i.is_latest).length;
        const totalLatest = newInLast10dIN + newInLast10dGL;

        // PATCH 0086: liveness pill — green ≤10min, amber ≤24h, red older.
        const lastUpdatedIso = persistentBottlenecks.last_updated;
        const ageMin = lastUpdatedIso
          ? Math.max(0, Math.round((Date.now() - new Date(lastUpdatedIso).getTime()) / 60000))
          : null;
        const liveColor = ageMin == null ? '#6B7A8D'
          : ageMin <= 10 ? '#10B981'
          : ageMin <= 24 * 60 ? '#F59E0B'
          : '#EF4444';
        const liveLabel = ageMin == null ? 'live'
          : ageMin < 1 ? 'live · just now'
          : ageMin < 60 ? `live · ${ageMin}m ago`
          : ageMin < 24 * 60 ? `live · ${Math.round(ageMin / 60)}h ago`
          : `stale · ${Math.round(ageMin / 1440)}d ago`;

        // Build a flat list with region-divider sentinels so one .map() can
        // render headers + cards. Avoids duplicating the (large) card JSX.
        const flatList: any[] = [];
        if (indiaItems.length > 0) {
          flatList.push({ __divider: 'IN', count: indiaItems.length, newCount: newInLast10dIN });
          flatList.push(...indiaItems);
        }
        if (globalItems.length > 0) {
          flatList.push({ __divider: 'GLOBAL', count: globalItems.length, newCount: newInLast10dGL });
          flatList.push(...globalItems);
        }

        return (
        <div style={{
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)',
          borderLeft: '4px solid var(--mc-bearish)',
          // PATCH 0085: doubled padding so the section breathes at larger card sizes
          borderRadius: '14px', padding: '16px 20px', marginBottom: '16px',
        }}>
          <button
            onClick={() => setShowPersistent(s => !s)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, margin: 0, width: '100%',
              color: 'inherit', textAlign: 'left',
            }}
          >
            {/* PATCH 0085: section header doubled — 10px → 15px */}
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--mc-bearish)', letterSpacing: '0.8px' }}>
              🚧 PERSISTENT BOTTLENECK READING
            </span>
            <span style={{ fontSize: '13px', color: 'var(--mc-text-4)' }}>
              🇮🇳 {indiaItems.length} India · 🌐 {globalItems.length} Global · auto-detected from accumulated evidence
            </span>
            {/* PATCH 0212 — freshness chip for bottleneck dashboard */}
            <PanelFreshness dataUpdatedAt={bnUpdatedAt} isFetching={bnFetching} staleAfterMs={5 * 60_000} />
            {/* PATCH 0088: 'Latest' pill — bottlenecks first seen in the last 10 days */}
            {totalLatest > 0 && (
              <span
                title={`${totalLatest} bottleneck${totalLatest === 1 ? '' : 's'} first detected in the last 10 days. They surface at the top of each region panel for 10 days, then drop back into normal confidence/structural ranking.`}
                style={{
                  fontSize: 12, fontWeight: 800, letterSpacing: '0.5px',
                  color: 'var(--mc-bg-0)',
                  border: '1px solid var(--mc-warn)',
                  backgroundColor: 'var(--mc-warn)',
                  padding: '2px 8px', borderRadius: 4,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              >
                🆕 LATEST · {totalLatest} new in 10d
              </span>
            )}
            {/* PATCH 0086: liveness pill — proves the panel is live, not stale */}
            <span
              title={lastUpdatedIso ? `Server-side last_updated: ${lastUpdatedIso}\nAuto-refresh every 5 min` : 'Live data'}
              style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                color: liveColor, border: `1px solid ${liveColor}50`,
                backgroundColor: `${liveColor}15`,
                padding: '2px 8px', borderRadius: 4,
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: liveColor, boxShadow: `0 0 6px ${liveColor}` }} />
              {liveLabel.toUpperCase()}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--mc-text-4)' }}>
              {/* PATCH 0435 BUG-034 — distinct label vs Forward Calendar expand */}
              {showPersistent ? '▼ Hide Bottleneck Reading' : '▶ Show Bottleneck Reading'}
            </span>
          </button>
          {showPersistent && (
            // PATCH 0085: doubled card width (280→440) and gap so larger cards
            // don't crush each other.
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: 14 }}>
              {flatList.map((rowAny: any, idx: number) => {
                // PATCH 0086: region divider sentinel — full-width sub-header
                if (rowAny && rowAny.__divider) {
                  const isIN = rowAny.__divider === 'IN';
                  const accent = isIN ? '#FBBF24' : '#22D3EE';
                  return (
                    <div
                      key={`__div_${rowAny.__divider}_${idx}`}
                      style={{
                        gridColumn: '1 / -1',
                        display: 'flex', alignItems: 'center', gap: 10,
                        marginTop: idx === 0 ? 0 : 12,
                        paddingBottom: 6,
                        borderBottom: `1px dashed ${accent}50`,
                      }}
                    >
                      <span style={{ fontSize: 16, fontWeight: 800, color: accent, letterSpacing: '0.6px' }}>
                        {isIN ? '🇮🇳 INDIA' : '🌐 GLOBAL'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>
                        {rowAny.count} {rowAny.count === 1 ? 'bottleneck' : 'bottlenecks'} · {isIN
                          ? 'NSE-listed beneficiaries only — Indian sources / ₹ / PSU patterns'
                          : 'global L1–L6 roster — US / EU / Japan / Taiwan / Korea names'}
                      </span>
                      {/* PATCH 0088: per-region 'new in last 10 days' counter */}
                      {rowAny.newCount > 0 && (
                        <span
                          title={`${rowAny.newCount} ${isIN ? 'Indian' : 'global'} bottleneck${rowAny.newCount === 1 ? '' : 's'} first detected in the last 10 days — sorted to top of this panel.`}
                          style={{
                            marginLeft: 'auto',
                            fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                            color: 'var(--mc-bg-0)',
                            backgroundColor: 'var(--mc-warn)',
                            border: '1px solid var(--mc-warn)',
                            padding: '2px 8px', borderRadius: 4,
                          }}
                        >
                          🆕 {rowAny.newCount} new in 10d
                        </span>
                      )}
                    </div>
                  );
                }
                // Type-narrow back to PersistentBottleneckItem for the card render
                const b = rowAny as PersistentBottleneckItem;
                const trendColor = b.trend === 'rising' ? '#EF4444'
                  : b.trend === 'steady' ? '#F59E0B'
                  : b.trend === 'falling' ? '#22D3EE'
                  : '#6B7A8D';
                const trendIcon = b.trend === 'rising' ? '↑' : b.trend === 'steady' ? '→' : b.trend === 'falling' ? '↓' : '·';
                // PATCH 0080: prefer best specialist sample over most-recent
                const bestSample = b.best_specialist_sample || b.top_samples[0];
                const showLabel = b.label || b.node.replace(/_/g, ' ');
                return (
                  // PATCH 0085: card padding 8/10 → 14/18, radius 8 → 12
                  <div key={b.node} style={{
                    backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)',
                    borderRadius: 12, padding: '14px 18px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      {/* PATCH 0085: card title 11 → 17 */}
                      <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--mc-text-0)', letterSpacing: '0.3px' }}>
                        {showLabel}
                      </span>
                      {b.is_structural && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-state-persistent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-state-persistent) 6%, transparent)', padding: '2px 6px', borderRadius: 4 }}>
                          STRUCTURAL
                        </span>
                      )}
                      {/* PATCH 0088: LATEST pill — bottleneck first detected ≤10d ago */}
                      {b.is_latest && (
                        <span
                          title={`First detected ${b.first_seen_age_days ?? '?'} day${b.first_seen_age_days === 1 ? '' : 's'} ago. Surfaces at top of panel for the first 10 days, then drops to confidence/structural ranking.`}
                          style={{
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.4px',
                            color: 'var(--mc-bg-0)',
                            backgroundColor: 'var(--mc-warn)',
                            border: '1px solid var(--mc-warn)',
                            padding: '2px 7px', borderRadius: 4,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          🆕 LATEST · {b.first_seen_age_days ?? 0}d
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: trendColor }}>
                        {trendIcon} {b.trend}
                      </span>
                    </div>
                    {b.sub && (
                      // PATCH 0085: sub 10 → 14
                      <div style={{ fontSize: 14, color: 'var(--mc-text-3)', lineHeight: 1.4, marginBottom: 8 }}>
                        {b.sub}
                      </div>
                    )}
                    {/* PATCH 0085: meta row 10 → 13 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13, color: 'var(--mc-text-3)' }}>
                      <span style={{ color: 'var(--mc-bullish)', fontWeight: 700 }}>{b.confidence_pct}% conf</span>
                      <span>·</span>
                      <span>{b.sample_count} articles</span>
                      <span>·</span>
                      <span>{b.age_days}d ago</span>
                    </div>
                    {bestSample && (
                      // PATCH 0085: top signal 9 → 12
                      <div style={{ fontSize: 12, color: 'var(--mc-text-4)', lineHeight: 1.5, borderTop: '1px solid var(--mc-bg-4)', paddingTop: 8 }}>
                        <span style={{ color: 'var(--mc-cyan)', fontWeight: 700 }}>Top signal:</span>{' '}
                        <span style={{ color: 'var(--mc-text-2)' }}>{bestSample.title.slice(0, 110)}</span>
                        <br/>
                        <span style={{ color: 'var(--mc-text-4)' }}>{bestSample.source} · {bestSample.tier}</span>
                      </div>
                    )}
                    {/* PATCH 0081 + 0082: ARCHITECTURAL BENEFICIARIES — second-order winners
                        PATCH 0085: typography all bumped ~70% larger so the card actually reads
                        at desk distance. */}
                    {b.architectural_adaptations && b.architectural_adaptations.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--mc-bg-4)' }}>
                        <div style={{ fontSize: 12, color: 'var(--mc-warn)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 8 }}>
                          ↪ ARCHITECTURAL BENEFICIARIES (2nd-order)
                        </div>
                        {b.architectural_adaptations.map((adapt) => {
                          // PATCH 0082: duration badge color
                          const durColor = adapt.duration === 'MULTI_YEAR_STRUCTURAL' ? '#10B981'
                            : adapt.duration === 'SECULAR' ? '#22D3EE'
                            : adapt.duration === 'CYCLICAL' ? '#F59E0B'
                            : adapt.duration === 'POLICY_SENSITIVE' ? '#8B5CF6'
                            : '#6B7A8D';
                          const durLabel = adapt.duration === 'MULTI_YEAR_STRUCTURAL' ? 'Multi-year structural'
                            : adapt.duration === 'SECULAR' ? 'Secular'
                            : adapt.duration === 'CYCLICAL' ? 'Cyclical'
                            : adapt.duration === 'POLICY_SENSITIVE' ? 'Policy-sensitive'
                            : adapt.duration === 'TRADING' ? 'Trading'
                            : '';
                          return (
                            <div key={adapt.adaptation} style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                <span style={{ color: 'var(--mc-bullish)', fontWeight: 700, fontSize: 14 }}>· {adapt.label}</span>
                                {durLabel && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, letterSpacing: '0.3px',
                                    color: durColor, border: `1px solid ${durColor}40`,
                                    backgroundColor: `${durColor}10`,
                                    padding: '2px 6px', borderRadius: 3,
                                  }}>
                                    {durLabel.toUpperCase()}
                                  </span>
                                )}
                              </div>
                              {/* PATCH 0482 — ticker chips removed (user: "anyway incorrect").
                                   Show clean prose rationale + a count indicator instead so the
                                   sub-theme + duration tag still convey the actionable shape
                                   without surfacing speculative ticker-tagging. */}
                              <div style={{ color: 'var(--mc-text-2)', fontSize: 12, lineHeight: 1.5, marginTop: 4 }} title={adapt.rationale}>
                                {adapt.rationale}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ── PATCH 0085 / PATCH 0482 — TRANSMISSION SUB-THEMES ──
                          User feedback: ticker rosters at L1-L6 were "anyway incorrect" and
                          made the panel look noisy. Replaced ticker chips with clean
                          sub-theme rows so the institutional layer-label remains useful
                          (Direct Scarcity Capture → Compute Substitutes → Edge → ...)
                          without speculative ticker-tagging. T0-T4 transmission cascade
                          below is unchanged. */}
                    {b.layered_beneficiaries && b.layered_beneficiaries.fired_layers.length > 0 && (() => {
                      const lb = b.layered_beneficiaries;
                      const LAYER_META: Record<string, { icon: string; label: string; tag: string; color: string }> = {
                        L1: { icon: '🧱', label: 'Direct Scarcity Capture',     tag: 'Input pricing power',                  color: '#F59E0B' },
                        L2: { icon: '⚙️', label: 'Compute Substitutes',          tag: 'GPU / CPU / ARM substitution',         color: '#8B5CF6' },
                        L3: { icon: '🌐', label: 'Edge Distribution',            tag: 'CDN / latency / bandwidth',             color: '#38BDF8' },
                        L4: { icon: '🧪', label: 'Transmission Winners',         tag: 'Sterlite-type pass-through',            color: '#10B981' },
                        L5: { icon: '🏢', label: 'Platform Beneficiaries',       tag: 'Hyperscaler demand aggregators',        color: '#3B82F6' },
                        L6: { icon: '⚡', label: 'Infrastructure / Efficiency',  tag: 'Power, thermal, perf-per-watt',         color: '#D946EF' },
                      };
                      return (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--mc-bg-4)' }}>
                          <div style={{ fontSize: 12, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 8 }}>
                            🔁 TRANSMISSION SUB-THEMES (L1–L6)
                          </div>
                          {lb.fired_layers.map((L) => {
                            const meta = LAYER_META[L];
                            if (!meta) return null;
                            return (
                              <div key={L} style={{
                                display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6, flexWrap: 'wrap',
                                paddingLeft: 8, borderLeft: `2px solid ${meta.color}80`,
                              }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 700,
                                  color: meta.color,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  minWidth: 28,
                                }}>
                                  {L}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mc-text-1)' }}>
                                  {meta.icon} {meta.label}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>{meta.tag}</span>
                              </div>
                            );
                          })}
                          {/* Transmission cascade T0 → T4 */}
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--mc-bg-4)' }}>
                            <div style={{ fontSize: 11, color: 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Transmission cascade</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                              {([
                                ['T0', 'now',    lb.transmission.T0, '#22D3EE'],
                                ['T1', '0–1Q',   lb.transmission.T1, '#38BDF8'],
                                ['T2', '1–3Q',   lb.transmission.T2, '#10B981'],
                                ['T3', '3–6Q',   lb.transmission.T3, '#F59E0B'],
                                ['T4', '6–12Q',  lb.transmission.T4, '#D946EF'],
                              ] as const).map(([t, q, txt, color]) => (
                                <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                  <span style={{ color, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minWidth: 22 }}>{t}</span>
                                  <span style={{ color: 'var(--mc-text-4)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minWidth: 50 }}>{q}</span>
                                  <span style={{ color: 'var(--mc-text-2)', lineHeight: 1.45 }}>{txt}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })()}
      </div>

      {/* ── Article detail overlay ─────────────────────────────────── */}
      {selectedArticle && (
        <ArticleDetail article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}

      {/* ── Bottleneck drilldown overlay ───────────────────────────── */}
      {drilldownSubTag && (
        <BottleneckDrilldown
          subTag={drilldownSubTag}
          articles={allArticles || []}
          onClose={() => setDrilldownSubTag(null)}
          onSelectArticle={a => { setDrilldownSubTag(null); setSelectedArticle(a); }}
        />
      )}
    </div>
  );
}
