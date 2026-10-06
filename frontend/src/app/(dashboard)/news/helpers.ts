'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { TICKER_ALIASES, JUNK_TICKERS } from '@/lib/news/ticker-vocab';
import { getItemSync, debouncedSetItem } from '@/lib/debounced-storage';
import { JUNK_HEADLINE_PATTERNS, JUNK_SOURCE_PATTERNS, NEWS_WATCHLIST_KEY, NOTE_META_KEY, NOTE_KEY_PREFIX, NOTE_MAX, PERSISTENT_MS, SAVED_VIEWS_KEY } from './constants';
import { type NewsArticle, type FeedLayer, type CalendarEvent, type AnomalyResponse, type BnDashboard, type TransformationalPreviewResp, type PersistentBottlenecksResp, type SavedView } from './types';

export function getArticleLayer(article: NewsArticle): FeedLayer {
  const type = article.article_type;
  if (type === 'MACRO' || type === 'GEOPOLITICAL' || type === 'TARIFF') return 'MACRO_REGIME';
  if (type === 'BOTTLENECK') return 'STRUCTURAL';
  if (type === 'EARNINGS' || type === 'RATING_CHANGE' || type === 'CORPORATE') return 'COMPANY_ALPHA';
  // For GENERAL articles, check if they have structural theme indicators
  const text = (article.title || article.headline || '').toLowerCase();
  if (/\b(semiconductor|chip|gpu|hbm|data center|ai infrastructure|defense|energy transition)\b/.test(text)) return 'STRUCTURAL';
  if (/\b(earnings|revenue|profit|guidance|quarterly|q[1-4])\b/.test(text)) return 'COMPANY_ALPHA';
  if (/\b(oil|crude|fed|rbi|inflation|gdp|rate cut|rate hike|tariff|sanction|war|iran)\b/.test(text)) return 'MACRO_REGIME';
  return 'GENERAL';
}
// Ticker alias map for search expansion (ticker → company name keywords)
// PATCH 0455 CLEANUP-3 — TICKER_ALIASES moved to /lib/news/ticker-vocab.ts

// ── Hooks ─────────────────────────────────────────────────────────────────────

// Fetch ALL articles once — region, type, source, importance filtered CLIENT-SIDE for instant switching.
// Only search goes to server (requires ILIKE queries).
export function useNews(search: string) {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'all', search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', importance_min: '1' });

      // Expand ticker search: if user types a ticker like "NVDA", also search for "nvidia"
      let expandedSearch = search;
      if (search) {
        const upperSearch = search.toUpperCase().trim();
        const aliases = TICKER_ALIASES[upperSearch];
        if (aliases) {
          expandedSearch = `${search}|${aliases.join('|')}`;
        }
      }

      if (expandedSearch) params.set('search', expandedSearch);
      const { data } = await api.get(`/news?${params}`);
      return Array.isArray(data) ? data : [];
    },
    // PATCH 0720 — was 90s. The /news?limit=500 payload is ~250-400KB and
    // each refetch re-runs the in-page filter+sort+annotate over the full
    // article set. The Must-Read, Anomaly, Bottleneck, In-Play and Persistent
    // hooks on this same page already operate on 2-5min cadences, so the
    // 90s primary refetch was the only sub-2min poll left here and the
    // dominant network-burner. 180s is well inside dashboard freshness
    // expectations (chip turns amber after 5min via PanelFreshness anyway).
    refetchInterval: 180_000,
    staleTime: 150_000,
    retry: 1,
  });
}
// ── Phase 1.3: Must Read curated top 5 ───────────────────────────────
export function useMustRead() {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'must-read'],
    queryFn: async () => {
      const { data } = await api.get('/news?must_read=1');
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 5 * 60_000,    // 5 min
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
export function useCalendar() {
  return useQuery<{ tomorrow: CalendarEvent[]; this_week: CalendarEvent[]; this_month: CalendarEvent[] }>({
    queryKey: ['calendar', 'forward'],
    queryFn: async () => {
      const { data } = await api.get('/calendar');
      return data?.buckets || { tomorrow: [], this_week: [], this_month: [] };
    },
    refetchInterval: 30 * 60_000,   // 30 min
    staleTime: 30 * 60_000,
    retry: 1,
  });
}
export function useAnomalies() {
  return useQuery<AnomalyResponse>({
    queryKey: ['news', 'anomalies'],
    queryFn: async () => {
      const { data } = await api.get('/news?anomalies=1');
      return data || { tickers: [], themes: [] };
    },
    refetchInterval: 10 * 60_000,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
// Client-side filter for instant filter switching
export function filterArticles(
  articles: NewsArticle[],
  region: string, type: string, signalFilter: string, sourceName: string,
): NewsArticle[] {
  return articles.filter(a => {
    if (region !== 'ALL' && a.region !== region && a.region !== 'GLOBAL') return false;
    if (type !== 'ALL' && a.article_type !== type) return false;
    // Signal filter: ALL = show HIGH+MEDIUM (hide noise), HIGH = only tier 1, MEDIUM = only tier 2
    if (signalFilter === 'HIGH' && (a.investment_tier || 0) !== 1) return false;
    if (signalFilter === 'MEDIUM' && (a.investment_tier || 0) !== 2) return false;
    // PATCH — tier-3 is viewable via the explicit Low/Noise filter
    if (signalFilter === 'LOW' && (a.investment_tier || 0) !== 3) return false;
    if (signalFilter === 'ALL') {
      // Default: hide noise (tier 3) unless no tier assigned (legacy articles)
      if ((a.investment_tier || 0) === 3) return false;
    }
    if (sourceName !== 'ALL') {
      const src = a.source_name || a.source || '';
      if (src !== sourceName) return false;
    }
    return true;
  });
}
export function useInPlay() {
  return useQuery<NewsArticle[]>({
    queryKey: ['news', 'in-play'],
    queryFn: async () => {
      const { data } = await api.get('/news/in-play');
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
    retry: 1,
  });
}
export function useBottleneckDashboard(enabled: boolean, region: string) {
  return useQuery<BnDashboard>({
    queryKey: ['news', 'bottleneck-dashboard', region],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (region !== 'ALL') params.set('region', region);
      const { data } = await api.get(`/news/bottleneck-dashboard?${params}`);
      return data;
    },
    enabled,
    refetchInterval: 180_000,
    staleTime: 120_000,
    retry: 1,
  });
}
export function useTransformationalPreview() {
  return useQuery<TransformationalPreviewResp>({
    queryKey: ['news', 'transformational-preview'],
    queryFn: async () => {
      // PATCH 0070: 365d preview window — matches strategic-visibility default
      const { data } = await api.get('/news?transformational=1&window_days=365&limit=30&sort=recent');
      return data;
    },
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
export function usePersistentBottlenecks() {
  return useQuery<PersistentBottlenecksResp>({
    queryKey: ['news', 'persistent-bottlenecks'],
    queryFn: async () => {
      const { data } = await api.get('/news?persistent=1&limit=8&min_confidence=20');
      return data;
    },
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
// ── Helpers ───────────────────────────────────────────────────────────────────

// Decode HTML entities like &amp; → & , &lt; → <, etc.
export const decodeHtml = (html: string): string => {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.documentElement.textContent || html;
};
// Tickers that are almost always false positives from NLP extraction
// 'A' removed — it is Agilent Technologies, a real ticker. 'ON' kept (ambiguous). 'AI' kept (C3.ai).
// PATCH 0455 CLEANUP-3 — JUNK_TICKERS moved to /lib/news/ticker-vocab.ts

// Works whether the schema sent ticker_symbols (preferred) or raw tickers dicts
export function getTickerSymbols(article: NewsArticle): string[] {
  const raw = article.ticker_symbols?.length
    ? article.ticker_symbols
    : (article.tickers ?? []).map(t =>
        typeof t === 'string' ? t : (t as { ticker: string }).ticker ?? ''
      ).filter(Boolean);
  // Strip known false-positive tickers
  return raw.filter(t => !JUNK_TICKERS.has(t.toUpperCase()));
}
// Prefer the alias `title`, fall back to `headline` — also decode HTML entities
export const getTitle = (a: NewsArticle) => decodeHtml(a.title || a.headline || '(no title)');
export const getSource = (a: NewsArticle) => a.source || a.source_name || '';
export const getUrl = (a: NewsArticle) => cleanUrl(a.url || a.source_url || '#');
// Clean URL: strip CDATA wrappers, ensure absolute, prevent double-domain
export const cleanUrl = (raw: string): string => {
  if (!raw || raw === '#') return '#';
  let u = raw.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  // If URL starts with http inside another domain (double-domain bug), extract the real URL
  const httpIdx = u.indexOf('http', 1);
  if (httpIdx > 0 && u.startsWith('http')) u = u.slice(httpIdx);
  return u;
};
export const importanceDot = (s: number) =>
  s >= 5 ? '#EF4444' : s >= 4 ? '#F59E0B' : s >= 3 ? '#0F7ABF' : '#4A5B6C';
export const tierBadge = (tier?: number) => {
  if (tier === 1) return { label: '🔴 HIGH', bg: '#EF444418', color: '#EF4444', border: '#EF444440' };
  if (tier === 2) return { label: '🟡 MEDIUM', bg: '#F59E0B12', color: '#F59E0B', border: '#F59E0B30' };
  if (tier === 3) return { label: '⚪ LOW', bg: '#6B7B8C12', color: '#8A95A3', border: '#6B7B8C30' }; // visible only in the Low/Noise view
  return null;
};
export const typeColor = (t: string) =>
  ({ BOTTLENECK: '#EF4444', EARNINGS: '#10B981', RATING_CHANGE: '#F59E0B', MACRO: '#8B5CF6', GEOPOLITICAL: '#DC2626', TARIFF: '#EA580C', CORPORATE: '#06B6D4', GENERAL: '#4A5B6C' })[t] ?? '#4A5B6C';
export const regionFlag = (r: string) => r === 'IN' ? '🇮🇳' : r === 'US' ? '🇺🇸' : '🌐';
// sentiment can now be either:
//   - legacy string ('BULLISH' / 'BEARISH' / 'NEUTRAL')
//   - new object { direction: 'positive'|'negative'|'neutral', magnitude: 1-10 }
// Normalise to a string so the existing badge code keeps working.
export function normalizeSentiment(s: any): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  if (typeof s === 'object' && s.direction) {
    if (s.direction === 'positive') return 'BULLISH';
    if (s.direction === 'negative') return 'BEARISH';
    return 'NEUTRAL';
  }
  return '';
}
export const sentimentBadge = (sentiment?: any) => {
  const s = normalizeSentiment(sentiment);
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === 'BULLISH') {
    return { icon: '↑', label: 'Bullish', bg: '#10B98120', color: '#10B981', border: '#10B98140' };
  } else if (upper === 'BEARISH') {
    return { icon: '↓', label: 'Bearish', bg: '#EF444420', color: '#EF4444', border: '#EF444440' };
  } else if (upper === 'NEUTRAL') {
    return { icon: '●', label: 'Neutral', bg: '#4A5B6C20', color: '#4A5B6C', border: '#4A5B6C40' };
  }
  return null;
};
// Safely parse a date — handles RSS feeds (BSE / SEBI / WSJ etc.) that
// occasionally return malformed pubDate strings. Returns null on
// invalid input so callers can render "—" instead of crashing.
export function safeDate(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch { return null; }
}
// PATCH 0211 — Single time-formatting rule for the entire news feed.
// The previous mix ("about 4 hours ago" / "01:19 PM · 3 minutes ago" /
// "May 11, 12:53 PM · 1 day ago") looked inconsistent and unprofessional.
// Now one deterministic ladder:
//   < 60 sec  → "now"
//   < 60 min  → "Xm ago"
//   < 24 hr   → "Xh ago"
//   ≤ 7 days  → "Xd ago"
//   > 7 days  → "MMM D" (absolute date, current year implied)
//   > 1 year  → "MMM D, YYYY"
// Use formatRelativeTight() everywhere. The wrapper functions safeRelative
// and timeAgo are retained as adapters so callers don't need to be touched
// in this patch — but both delegate to the same rule.
export function formatRelativeTight(d: Date): string {
  const nowMs = Date.now();
  const ts = d.getTime();
  const deltaMs = nowMs - ts;
  // Future dates → absolute
  if (deltaMs < 0) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }) +
           ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });  // zzz382
  }
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day <= 7) return `${day}d ago`;
  const yearOpt = d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {};
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...yearOpt, timeZone: 'Asia/Kolkata' });  // zzz382
}
/** Absolute "tooltip" form — used when the caller wants hover detail. */
export function formatAbsoluteTooltip(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
export function safeRelative(iso: string | undefined | null): string {
  const d = safeDate(iso);
  if (!d) return '';
  try { return formatRelativeTight(d); } catch { return ''; }
}
export const timeAgo = (iso: string) => {
  try {
    const d = safeDate(iso);
    if (!d) return '—';
    return formatRelativeTight(d);
  } catch { return ''; }
};
export function isMarketRelevant(article: NewsArticle): boolean {
  const title = (article.title || article.headline || '');
  const source = (article.source_name || article.source || '');

  // Junk patterns apply to ALL articles — NO bypasses whatsoever
  // Check headline against junk patterns
  for (const pattern of JUNK_HEADLINE_PATTERNS) {
    if (pattern.test(title)) return false;
  }
  // Check source against junk source patterns
  for (const pattern of JUNK_SOURCE_PATTERNS) {
    if (pattern.test(source)) return false;
  }

  return true;
}
export function readRawWatchlistTickers(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NEWS_WATCHLIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(t => String(t)) : [];
  } catch { return []; }
}
export function writeRawWatchlistTickers(arr: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NEWS_WATCHLIST_KEY, JSON.stringify(arr));
    window.dispatchEvent(new Event('mc:watchlist:updated'));
  } catch {}
}
export function hasTickerCI(arr: string[], upper: string): boolean {
  return arr.some(t => String(t).toUpperCase() === upper);
}
export function readNoteMeta(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(NOTE_META_KEY) || '{}'); } catch { return {}; }
}
export function writeNoteMeta(m: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(NOTE_META_KEY, JSON.stringify(m)); } catch {}
}
export function loadNote(articleId: string): string {
  if (typeof window === 'undefined') return '';
  // PATCH 0545 — race-aware read so an autosave-in-flight read returns the
  // freshly-typed text instead of the last-flushed LS value.
  try { return getItemSync(NOTE_KEY_PREFIX + articleId) || ''; } catch { return ''; }
}
export function saveNote(articleId: string, text: string) {
  if (typeof window === 'undefined') return;
  try {
    // PATCH 0545 — autosave fires every 600ms while typing. We further coalesce
    // through a 250ms idle window so a 5-keystroke burst writes ONCE, not 5×.
    // Empty-text path still uses raw removeItem (small, doesn't need debounce).
    const meta = readNoteMeta();
    if (text.trim()) {
      debouncedSetItem(NOTE_KEY_PREFIX + articleId, text);
      meta[articleId] = Date.now();
      // PATCH 0551 — prune to NOTE_MAX oldest after each write.
      const ids = Object.keys(meta);
      if (ids.length > NOTE_MAX) {
        const sorted = ids.sort((a, b) => meta[a] - meta[b]);
        const toDrop = sorted.slice(0, ids.length - NOTE_MAX);
        for (const dropId of toDrop) {
          try { localStorage.removeItem(NOTE_KEY_PREFIX + dropId); } catch {}
          delete meta[dropId];
        }
      }
      writeNoteMeta(meta);
    } else {
      localStorage.removeItem(NOTE_KEY_PREFIX + articleId);
      if (articleId in meta) { delete meta[articleId]; writeNoteMeta(meta); }
    }
  } catch {}
}
export function isPersistentSignal(article: NewsArticle): boolean {
  try {
    const pubTime = new Date(article.published_at).getTime();
    if (!Number.isFinite(pubTime)) return false;
    return Date.now() - pubTime > PERSISTENT_MS;
  } catch { return false; }
}
export function loadSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
export function persistSavedViews(views: SavedView[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views)); } catch {}
}
// PATCH 0569 (UX #1) — Auto-name a Saved View from its query string so the
// user can save with one click (no modal). Pulls the most semantically
// meaningful filters (type / region / lifecycle / signal / bottleneck
// subfilters / search) and appends a short date so a re-saved version
// doesn't collide. User can still rename via the ✎ pencil.
export function autoNameSavedView(query: string): string {
  let q = query || '';
  if (q.startsWith('?')) q = q.slice(1);
  const p = new URLSearchParams(q);
  const parts: string[] = [];
  const type = p.get('type');
  if (type && type !== 'ALL') parts.push(type.replace(/_/g, ' '));
  const blevel = p.get('blevel');
  if (blevel && blevel !== 'ALL') parts.push(blevel.replace(/_/g, ' '));
  const bcat = p.get('bcat');
  if (bcat && bcat !== 'ALL') parts.push(bcat.replace(/_/g, ' '));
  const region = p.get('region');
  if (region && region !== 'ALL') {
    parts.push(region === 'IN' ? 'India' : region === 'US' ? 'US' : region);
  }
  const lc = p.get('lc');
  if (lc && lc !== 'LIVE_WARM') {
    const lcLabel = lc === 'STALE' ? 'Stale' : lc === 'PERSISTENT' ? 'Persistent' : lc === 'ALL' ? 'All Ages' : lc;
    parts.push(lcLabel);
  }
  const sig = p.get('signal');
  if (sig && sig !== 'ALL') parts.push(sig);
  if (p.get('struct') === '1') parts.push('Structural');
  const search = p.get('q');
  if (search) parts.push(`"${search.slice(0, 24)}"`);
  if (parts.length === 0) parts.push('Custom');
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${parts.join(' · ')} · ${date}`;
}
