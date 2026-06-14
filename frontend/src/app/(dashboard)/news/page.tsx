'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Filter, X, ExternalLink, AlertCircle, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
// PATCH 0129 — strategy filter helper
import { articleMatchesStrategy } from '@/components/news/NewsCard';
// PATCH 0214 — semantic color tokens (state / semantic / severity orthogonal)
import { TOKENS, chipStyle } from '@/lib/design-tokens';
// PATCH 0232 — Source-tier visuals for Evidence Panel
import { classifySource, TIER_VISUAL, sourceQualityWeight } from '@/lib/source-tiers';
import { annotateArticle, clusterByCanonical, confidenceBand, CONFIDENCE_VISUAL } from '@/lib/news/event-detectors';
// PATCH 0579 — TheWrap alternate-data detectors
import { detectAllTheWrap } from '@/lib/thewrap-detectors';
// PATCH 0455 CLEANUP-3 — Centralized vocab.
import { JUNK_TICKERS, TICKER_ALIASES } from '@/lib/news/ticker-vocab';
import { isInReadingList, toggleReadingList } from '@/lib/reading-list';
// PATCH 0545 — AUDIT #95 debounced LS writes for thesis-notebook autosave.
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NewsArticle {
  id: string;
  headline: string;
  title: string;
  source_name: string;
  source: string;
  source_url: string;
  url: string;
  published_at: string;
  ingested_at?: string;
  importance_score: number;
  tickers: Array<{ ticker: string; exchange: string; confidence?: number } | string>;
  ticker_symbols: string[];
  region: string;
  article_type: string;
  summary?: string;
  sentiment?: string;
  themes?: string[];
  investment_tier?: number;
  relevance_tags?: string[];
  impact_statement?: string;
  bottleneck_sub_tag?: string;
  bottleneck_level?: string;
  is_synthetic?: boolean;
  structural_status?: string;
  feed_layer?: string;
  // PATCH 0455 CLEANUP-1 — Pre-annotation fields stamped by the server-side
  // pipeline (event-detectors / source-quality / canonical clustering).
  // Promoted from `(article as any).__*` so type-checking catches misuse.
  __priority?: number;
  __priorityParts?: Record<string, number>;
  __sourceWeight?: number;
  __isListicle?: boolean;
  __isSpeculation?: boolean;
  __clusterSize?: number;
  __clusterSources?: string[];
  __clusterTimes?: number[];
  __confidence?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  __creditStress?: any;
  __promoter?: any;
  __workingCapital?: any;
  __orderQuality?: any;
  __noise?: { isListicle: boolean; isSpeculation: boolean; qualityMultiplier: number };
  __expectation?: any;
}

// Bottleneck dashboard types
interface BnSignalArticle {
  id: string;
  headline: string;
  source_name: string;
  source_url: string;
  published_at: string;
  importance_score: number;
  sentiment: string;
}

interface BnSignal {
  headline: string;
  summary: string;
  evidence_count: number;
  sources: string[];
  latest_at: string;
  tickers: string[];
  articles: BnSignalArticle[];
}

interface BnBucket {
  bucket_id: string;
  label: string;
  description: string;
  severity: number;
  severity_label: string;
  severity_color: string;
  severity_icon: string;
  signal_count: number;
  article_count: number;
  key_tickers: string[];
  signals: BnSignal[];
}

interface BnDashboard {
  success: boolean;
  total_articles: number;
  buckets: BnBucket[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIONS = ['ALL', 'IN', 'US'] as const;
const TYPES   = ['ALL', 'BOTTLENECK', 'EARNINGS', 'RATING_CHANGE', 'MACRO', 'GEOPOLITICAL', 'TARIFF', 'CORPORATE', 'GENERAL'] as const;
const SOURCES = [
  'ALL',
  // India
  'ET Markets', 'ET Industry', 'ET Economy', 'MoneyControl', 'LiveMint', 'Business Standard', 'BS Economy',
  'Yahoo Finance IN', 'PIB India', 'ElectronicsB2B', 'IBEF',
  // US / Global Macro
  'Yahoo Finance US', 'Yahoo Finance US Financials', 'CNBC', 'CNBC Tech', 'MarketWatch', 'Bloomberg', 'Reuters Finance',
  // Semiconductor & Supply Chain
  'SemiAnalysis', 'DigiTimes', 'EE Times', 'Semiconductor Engineering', 'IEEE Spectrum', 'Evertiq', 'SEMI',
  'Yahoo Tech Semis', 'Yahoo Data Center',
  // Hyperscaler / AI Infra
  'The Register', 'ServeTheHome', 'The Information', 'Techmeme',
  // Policy & Geopolitics
  'CSIS', 'Brookings',
] as const;
// Signal filter: maps to investment_tier (1=HIGH, 2=MEDIUM, 3=NOISE)
const SIGNAL_FILTERS = [
  { value: 'ALL', label: 'All Signals', icon: '' },
  { value: 'HIGH', label: '🔴 High', icon: '🔴' },
  { value: 'MEDIUM', label: '🟡 Medium', icon: '🟡' },
  { value: 'LOW', label: '⚪ Low/Noise', icon: '⚪' },
] as const;

// Layer classification for institutional hierarchy
type FeedLayer = 'MACRO_REGIME' | 'STRUCTURAL' | 'COMPANY_ALPHA' | 'GENERAL';
const LAYER_CONFIG: Record<FeedLayer, { label: string; color: string; description: string }> = {
  MACRO_REGIME: { label: 'MACRO REGIME', color: '#DC2626', description: 'Liquidity, rates, commodities, geopolitical' },
  STRUCTURAL: { label: 'STRUCTURAL THEMES', color: '#8B5CF6', description: 'AI infrastructure, defense, energy, semiconductors' },
  COMPANY_ALPHA: { label: 'COMPANY ALPHA', color: '#0F7ABF', description: 'Earnings, contracts, guidance, M&A' },
  GENERAL: { label: 'MARKET INTEL', color: '#4A5B6C', description: 'Industry news & analysis' },
};

function getArticleLayer(article: NewsArticle): FeedLayer {
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
function useNews(search: string) {
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
function useMustRead() {
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

// ── Phase 1.5: Forward Calendar ─────────────────────────────────────
interface CalendarEvent {
  date: string;
  type: string;
  region: string;
  title: string;
  ticker?: string;
  importance: 'high' | 'medium';
}
function useCalendar() {
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

// ── Phase 2.5: Anomaly detector ──────────────────────────────────────
// PATCH 0050: enriched response includes themes_v2 / tickers_v2 with
// display names + why_it_matters explanations.
type AnomalySignal = {
  display_name: string;
  count: number;
  baseline_count: number;
  deviation: 'EMERGING' | 'ESCALATING' | 'DOMINANT';
  why_it_matters: string;
};
type AnomalyResponse = {
  tickers: [string, number][];
  themes: [string, number][];
  section_title?: string;
  section_subtitle?: string;
  themes_v2?: AnomalySignal[];
  tickers_v2?: AnomalySignal[];
};
function useAnomalies() {
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
function filterArticles(
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

function useInPlay() {
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

// PATCH 0212 — Reusable panel-freshness chip.
// PATCH 0274 — Extracted into a shared component @/components/PanelFreshness
// so every dashboard surface gets the same chip semantics. Kept the import
// re-export here for back-compat with the inline references on this page.
import { PanelFreshness } from '@/components/PanelFreshness';

// PATCH 0230 — Hard-stale strip.
// Companion to PanelFreshness: when data is older than staleAfterMs × 3 we
// render a full-width amber strip across the top of the panel so the user
// can't miss that they're looking at very-old data. Click-to-refresh.
function PanelStaleStrip({
  dataUpdatedAt,
  staleAfterMs,
  onRefresh,
  label = 'data',
}: {
  dataUpdatedAt: number;
  staleAfterMs: number;
  onRefresh?: () => void;
  label?: string;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!dataUpdatedAt) return null;
  const age = Date.now() - dataUpdatedAt;
  const veryStaleAfterMs = staleAfterMs * 3;
  if (age <= veryStaleAfterMs) return null;
  const d = new Date(dataUpdatedAt);
  const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const ageMin = Math.floor(age / 60_000);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 14px', marginBottom: 8,
        backgroundColor: '#F59E0B14',
        border: '1px solid #F59E0B40',
        borderRadius: 8,
        color: 'var(--mc-warn)',
        fontSize: 11, fontWeight: 600,
      }}
      title={`This panel's data is from ${d.toLocaleString()} — refresh to pull fresh.`}
    >
      <span>⚠ Showing {label} as of {hhmm} ({ageMin} min ago). Older than the freshness window.</span>
      {onRefresh && (
        <button
          onClick={onRefresh}
          style={{
            marginLeft: 'auto',
            backgroundColor: 'transparent',
            border: '1px solid var(--mc-warn)',
            color: 'var(--mc-warn)',
            borderRadius: 5, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >REFRESH</button>
      )}
    </div>
  );
}

function useBottleneckDashboard(enabled: boolean, region: string) {
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

// PATCH 0068: 6-month Transformational Contracts ledger — for the
// main-news preview band. Shows top 6 by rank.
interface TransformationalPreviewItem {
  id: string;
  title: string;
  source_name: string;
  source_url: string;
  published_at: string;
  region: string;
  ticker_symbols?: string[];
  primary_ticker?: string | null;
  strategic_visibility: {
    qualifies: boolean;
    theme: string;
    counterparty_tier: string;
    counterparty_name?: string;
    contract_value_usd_m?: number;
    visibility_years?: number;
    flags: string[];
    reason: string;
  };
  sv_signal_quality_tier?: string | null;
  sv_dependency_score?: number | null;
}
interface TransformationalPreviewResp {
  count: number;
  total_in_ledger?: number;
  window_days?: number;
  articles: TransformationalPreviewItem[];
}
function useTransformationalPreview() {
  return useQuery<TransformationalPreviewResp>({
    queryKey: ['news', 'transformational-preview'],
    queryFn: async () => {
      // PATCH 0070: 365d preview window — matches strategic-visibility default
      const { data } = await api.get('/news?transformational=1&window_days=365&limit=8');
      return data;
    },
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

// PATCH 0079 + 0080: Persistent Bottleneck Reading hook
interface PersistentBottleneckSample {
  article_id: string;
  title: string;
  source: string;
  tier: string;
  recorded_at?: string;
}
// PATCH 0081 + 0082: architectural beneficiary entry with institutional dims
interface AdaptationBeneficiary {
  ticker: string;
  score: number;
  sample_count: number;
  // PATCH 0082
  exposure_intensity?: 'DIRECT' | 'STRONG' | 'MEDIUM' | 'INDIRECT' | 'STRATEGIC';
  exposure_score?: number;
  economic_capture?: 'MASSIVE' | 'HIGH' | 'MODERATE' | 'MARGINAL' | 'STRATEGIC_ONLY';
  capture_score?: number;
  size_class?: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
  rationale?: string;
  composite_score?: number;
}
interface StructuralLoserItem {
  ticker: string;
  rationale: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}
interface ArchitecturalAdaptation {
  adaptation: string;
  label: string;
  rationale: string;
  duration?: 'MULTI_YEAR_STRUCTURAL' | 'SECULAR' | 'CYCLICAL' | 'POLICY_SENSITIVE' | 'TRADING';
  beneficiaries: AdaptationBeneficiary[];
  structural_losers?: StructuralLoserItem[];
}

// PATCH 0085: 6-layer beneficiary engine on the persistent-bottleneck panel
interface LayerTickerLite {
  ticker: string;
  rationale: string;
  pricing_leverage: 'STRONG' | 'MEDIUM' | 'WEAK';
  size: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
  mandatory?: boolean;
  sub_layer?: 'GPU_SUB' | 'CPU_CYCLE';   // PATCH 0087 — only meaningful for L2
}
interface LayeredBeneficiariesLite {
  bottleneck: string;
  bottleneck_label: string;
  fired_layers: string[];
  layers: Record<string, LayerTickerLite[]>;
  transmission: { T0: string; T1: string; T2: string; T3: string; T4: string };
}

interface PersistentBottleneckItem {
  node: string;
  label?: string;        // PATCH 0080: rich label
  sub?: string;          // PATCH 0080: context line
  confidence_pct: number;
  cumulative_score: number;
  sample_count: number;
  last_seen: string;
  age_days: number;
  trend: 'rising' | 'steady' | 'falling' | 'cooling';
  is_structural: boolean;
  top_samples: PersistentBottleneckSample[];
  best_specialist_sample?: PersistentBottleneckSample | null;  // PATCH 0080
  architectural_adaptations?: ArchitecturalAdaptation[];        // PATCH 0081
  layered_beneficiaries?: LayeredBeneficiariesLite;             // PATCH 0085
  region?: 'IN' | 'GLOBAL';                                     // PATCH 0086
  first_seen?: string;                                          // PATCH 0088
  first_seen_age_days?: number;                                 // PATCH 0088
  is_latest?: boolean;                                          // PATCH 0088 — first_seen_age_days <= 10
}
interface PersistentBottlenecksResp {
  section_title: string;
  section_subtitle: string;
  count: number;
  items: PersistentBottleneckItem[];
  last_updated?: string;                                        // PATCH 0086 — server-side ISO timestamp for liveness pill
}
function usePersistentBottlenecks() {
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
const decodeHtml = (html: string): string => {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.documentElement.textContent || html;
};

// Tickers that are almost always false positives from NLP extraction
// 'A' removed — it is Agilent Technologies, a real ticker. 'ON' kept (ambiguous). 'AI' kept (C3.ai).
// PATCH 0455 CLEANUP-3 — JUNK_TICKERS moved to /lib/news/ticker-vocab.ts

// Works whether the schema sent ticker_symbols (preferred) or raw tickers dicts
function getTickerSymbols(article: NewsArticle): string[] {
  const raw = article.ticker_symbols?.length
    ? article.ticker_symbols
    : (article.tickers ?? []).map(t =>
        typeof t === 'string' ? t : (t as { ticker: string }).ticker ?? ''
      ).filter(Boolean);
  // Strip known false-positive tickers
  return raw.filter(t => !JUNK_TICKERS.has(t.toUpperCase()));
}

// Prefer the alias `title`, fall back to `headline` — also decode HTML entities
const getTitle = (a: NewsArticle) => decodeHtml(a.title || a.headline || '(no title)');
const getSource = (a: NewsArticle) => a.source || a.source_name || '';
const getUrl = (a: NewsArticle) => cleanUrl(a.url || a.source_url || '#');

// Clean URL: strip CDATA wrappers, ensure absolute, prevent double-domain
const cleanUrl = (raw: string): string => {
  if (!raw || raw === '#') return '#';
  let u = raw.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
  // If URL starts with http inside another domain (double-domain bug), extract the real URL
  const httpIdx = u.indexOf('http', 1);
  if (httpIdx > 0 && u.startsWith('http')) u = u.slice(httpIdx);
  return u;
};

const importanceDot = (s: number) =>
  s >= 5 ? '#EF4444' : s >= 4 ? '#F59E0B' : s >= 3 ? '#0F7ABF' : '#4A5B6C';
const tierBadge = (tier?: number) => {
  if (tier === 1) return { label: '🔴 HIGH', bg: '#EF444418', color: '#EF4444', border: '#EF444440' };
  if (tier === 2) return { label: '🟡 MEDIUM', bg: '#F59E0B12', color: '#F59E0B', border: '#F59E0B30' };
  if (tier === 3) return { label: '⚪ LOW', bg: '#6B7B8C12', color: '#8A95A3', border: '#6B7B8C30' }; // visible only in the Low/Noise view
  return null;
};
const typeColor = (t: string) =>
  ({ BOTTLENECK: '#EF4444', EARNINGS: '#10B981', RATING_CHANGE: '#F59E0B', MACRO: '#8B5CF6', GEOPOLITICAL: '#DC2626', TARIFF: '#EA580C', CORPORATE: '#06B6D4', GENERAL: '#4A5B6C' })[t] ?? '#4A5B6C';
const regionFlag = (r: string) => r === 'IN' ? '🇮🇳' : r === 'US' ? '🇺🇸' : '🌐';
// sentiment can now be either:
//   - legacy string ('BULLISH' / 'BEARISH' / 'NEUTRAL')
//   - new object { direction: 'positive'|'negative'|'neutral', magnitude: 1-10 }
// Normalise to a string so the existing badge code keeps working.
function normalizeSentiment(s: any): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  if (typeof s === 'object' && s.direction) {
    if (s.direction === 'positive') return 'BULLISH';
    if (s.direction === 'negative') return 'BEARISH';
    return 'NEUTRAL';
  }
  return '';
}
const sentimentBadge = (sentiment?: any) => {
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
function safeDate(iso: string | undefined | null): Date | null {
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
function formatRelativeTight(d: Date): string {
  const nowMs = Date.now();
  const ts = d.getTime();
  const deltaMs = nowMs - ts;
  // Future dates → absolute
  if (deltaMs < 0) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
           ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
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
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...yearOpt });
}

/** Absolute "tooltip" form — used when the caller wants hover detail. */
function formatAbsoluteTooltip(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function safeRelative(iso: string | undefined | null): string {
  const d = safeDate(iso);
  if (!d) return '';
  try { return formatRelativeTight(d); } catch { return ''; }
}
const timeAgo = (iso: string) => {
  try {
    const d = safeDate(iso);
    if (!d) return '—';
    return formatRelativeTight(d);
  } catch { return ''; }
};

// ── Junk Filter ─────────────────────────────────────────────────────────────
// Filter out personal finance advice, political fluff, lifestyle, and clickbait
// that adds no value to an institutional-grade market dashboard.

const JUNK_HEADLINE_PATTERNS = [
  // Personal finance / advice columns / family money
  /\bmy (friend|wife|husband|partner|adviser|advisor|dad|mom|brother|sister|boss|relative|daughter|son|parent)\b/i,
  /\b(should i buy|can i trust|is it worth|how much should|how to save|retirement plan|nest egg)\b/i,
  /\b(feels slimy|i'm worried|dear moneyist|ask an expert|money etiquette|who'?s right)\b/i,
  /\b(personal finance|side hustle|budgeting tip|credit score|credit card reward|savings account)\b/i,
  /\b(financial adviser|financial advisor|financial planner)\b/i,
  /\b(social security|medicare|medicaid)\s+(benefit|check|payment|tip|stolen)/i,
  /\bhas congress.*(stolen|raided).*social security/i,
  /\b(best (credit card|savings|cd rate|mortgage|insurance))\b/i,
  /\b(an? older relative|give my (daughter|son)|said no\. who)/i,

  // Stock-picking clickbait / promotion
  /\b(top .* analysts? like these dividend)\b/i,
  /\b(like these dividend stocks|solid returns)\b/i,
  /\bgot \$[\d,]+\?.*stocks?\b/i,                          // "Got $5,000? 2 Stocks..."
  /\bwall street is sleeping on\b/i,                        // "Wall Street Is Sleeping on This $13 Stock"
  /\bthe only stock .* (buying|selling)\b/i,                // "The Only Stock Buffett Is Buying"
  /\bcould handily outperform\b/i,
  /\bbuy it now\.?\s*$/i,                                   // headlines ending with "Buy It Now."
  /\b(is|are) built to profit\b/i,                          // "These 3 Energy Stocks Are Built to Profit"
  /\band that'?s your opportunity\b/i,                      // "and That's Your Opportunity"
  /\b(actually worth holding|worth holding\??)\b/i,         // "Is Vanguard's VOT Actually Worth Holding?"
  /\b(it'?s not too late to buy)\b/i,

  // ETF / fund promotion
  /\bthis .* etf is up \d+%/i,                             // "This Vanguard ETF Is up 33% YTD"
  /\b(massive upside|still has massive|has massive upside)\b/i,
  /\b\$[\d.]+ billion in assets and a [\d.]+% fee\b/i,     // "$31.7 Billion in Assets and a 0.05% Fee"
  /\bvanguard'?s (vo[a-z]|vt[a-z]|vf[a-z]|vs[a-z])\b/i,  // Vanguard ETF tickers like VOT, VTI etc.

  // Political fluff not market-related
  /\b(state rep|congressman|senator|governor|mayor)\s+(talk|speak|say|slam|push|defend)/i,
  /\bstaying disciplined on the issues\b/i,
  /\b(campaign trail|election rally|political rally|town hall meeting)\b/i,
  /\b(democrat|republican|gop|liberal|conservative)\s+(slam|attack|defend|push)/i,

  // Non-market news — science, NASA, lifestyle, sports
  /\bnasa\s+(prepares?|launches?|announces?|plans?)\b/i,
  /\b(celebrity|kardashian|oscars|grammy|super bowl|nfl draft|bachelor|bachelorette)\b/i,
  /\b(recipe|cooking tip|travel destination|vacation spot|weight loss|diet plan)\b/i,
  /\b(vibe coding|coding bootcamp|learn to code)\b/i,

  // Clickbait / hindsight / hypothetical returns
  /\b(you won't believe|shocking truth|one weird trick|doctors hate|this changes everything)\b/i,
  /\b(\d+ (things|ways|tips|reasons|secrets|mistakes))\s+(you|to|that|about)/i,
  /\b(ridiculously easy|simple trick|beat the .* experts?)\b/i,
  /\b(if you('d| had| would have)? (bought|invested))\b/i,
  /\b(would have made|could have made|you'd have made|you'd have today)\b/i,
  /\b(return you would|gains you missed|wish you had bought)\b/i,
  /\b(it might make you cry|spoiler:)\b/i,
  /\bhere'?s how much you'?d have\b/i,

  // Parenting / lifestyle / self-help disguised as news
  /\b(i've studied over \d+ kids|skill parents|parenting tip|teach kids)\b/i,
  /\b(no\.?\s*1 skill|number one skill|top skill)\s*(parents|kids|children)/i,
  /\b(can't look away|the case against social media)\b/i,
  /\b(work-life balance|quiet quitting|hustle culture|morning routine)\b/i,

  // Generic "3 big things" / roundups
  /\b\d+ big things we'?re watching\b/i,

  // "Investment opportunities in X" — generic filler
  /\binvestment opportunities in\b/i,
  // Restoration/trust in Congress — political
  /\brestore trust.*congress\b/i,
  /\bdecision making here in congress\b/i,
  // Visa vs Mastercard type comparison articles
  /\bvisa vs\.?\s*mastercard\b/i,
  /\b(which one to own|here'?s which one)\b/i,
  // "Thinking Small" motivational / Jeff Bezos quotes
  /\b(self-fulfilling prophecy|overestimate risk|underestimate opportunity)\b/i,
  // Generic Warren Buffett clickbait
  /\bwarren buffett\b.*\b(buying|selling|loaded up|dumped|poured)\b/i,

  // Retail tips / penny stock noise (India-specific)
  /\b(under ₹|under rs\.?\s*)\d+/i,
  /\bpenny stock/i,
  /\bstocks? to (buy|sell|watch) (on|this) (monday|tuesday|wednesday|thursday|friday)/i,
  /\bjewellery stock to watch/i,
  /\brecommends? (three|two|five|3|2|5) stocks?\b/i,
  // Removed: /\b(buy or sell):?\s/i — killed legitimate analyst rating articles

  // Listicle investing clickbait with specific % claims
  // NOTE: removed "soars/surge/jump X%" — this killed legitimate news like
  // "TSMC revenue surges 35%". Kept only specific clickbait patterns.
  /\b\d+ (supercharged|unstoppable|incredible|explosive) .* stock/i,
  /\bultra-high-yielding dividend/i,
  /\bload up on these \d/i,
  /\bbetter (space|tech|ai) stock:/i,

  // Bank holidays / calendar filler
  /\bbank holiday/i,

  // Lifestyle / trivia
  /\b(pokémon|pokemon|logan paul)\b/i,
  /\bviral food trend/i,

  // PATCH 0289 — Block consumer-deal noise (audit IMP-01). Tom's Hardware
  // bundle deals were leaking into the BOTTLENECK feed and destroying trust.
  /\bsave \$[\d,]+\s+on\b/i,                               // 'Save $210 on...'
  /\b(bundle|combo)\s+(deal|offer|that includes)/i,         // bundle deals
  /\b(coupon code|promo code|discount code|use code)\b/i,
  /\b(prime day|black friday|cyber monday|cyber week)\b/i,
  /\b(best buy|deal of the day|today'?s deal)\b/i,
  /\b\d+%\s+off\b/i,                                        // '25% off'
  /\bgrab .* (for|at) \$[\d,]+/i,                           // 'grab a... for $X'
  /\b(samsung|corsair|logitech|sandisk|wd|western digital)\s+(ssd|nvme|ram|memory|keyboard|mouse|monitor)\s+(bundle|deal|discount)/i,
];

const JUNK_SOURCE_PATTERNS = [
  /moneyist/i,
  // Removed: yahoo finance us financials, yahoo tech semis — killed entire sources
];

function isMarketRelevant(article: NewsArticle): boolean {
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

// ── Components ────────────────────────────────────────────────────────────────

// AUDIT_100 #58 — Read-it-later button. Inline component so we don't have to
// extract NewsCard into its own file.
function ReadingListButton({ id }: { id: string }) {
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    setMarked(isInReadingList(id));
    const onUpdate = () => setMarked(isInReadingList(id));
    window.addEventListener('mc:reading-list:updated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('mc:reading-list:updated', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [id]);
  if (!id) return null;
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMarked(toggleReadingList(id)); }}
      style={{
        background: marked ? '#22D3EE15' : 'none',
        border: `1px solid ${marked ? '#22D3EE60' : 'var(--mc-border-1)'}`,
        borderRadius: '10px',
        color: marked ? 'var(--mc-cyan)' : 'var(--mc-text-4)',
        cursor: 'pointer', padding: '10px', flexShrink: 0,
        display: 'flex', alignItems: 'center', minWidth: '40px', minHeight: '40px',
        justifyContent: 'center', fontSize: 14,
      }}
      title={marked ? 'Saved to Read it later — click to remove' : 'Save to Read it later'}
    >
      {marked ? '★' : '☆'}
    </button>
  );
}

// PATCH 0569 (UX #4) — Inline +Watch button on news cards. Adds the first
// ticker symbol on the article to `mc_watchlist_tickers` so the user can go
// from a news headline to a tracked ticker without leaving the page. We
// only wire the *first* symbol to keep the click cheap; multi-symbol adds
// stay the watchlist page's job.
// PATCH 0571 — Preserve the raw array form on write so untouched tickers
// keep their original case. Earlier Patch-0569 version round-tripped
// everything through a uppercased Set, silently normalising the entire
// watchlist on every click; harmless functionally but surprising for any
// downstream reader that depended on the user's original casing.
const NEWS_WATCHLIST_KEY = 'mc_watchlist_tickers';
function readRawWatchlistTickers(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NEWS_WATCHLIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(t => String(t)) : [];
  } catch { return []; }
}
function writeRawWatchlistTickers(arr: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(NEWS_WATCHLIST_KEY, JSON.stringify(arr));
    window.dispatchEvent(new Event('mc:watchlist:updated'));
  } catch {}
}
function hasTickerCI(arr: string[], upper: string): boolean {
  return arr.some(t => String(t).toUpperCase() === upper);
}
function WatchlistButton({ ticker }: { ticker: string | null | undefined }) {
  const upper = (ticker || '').toUpperCase();
  const [inList, setInList] = useState(false);
  useEffect(() => {
    if (!upper) return;
    setInList(hasTickerCI(readRawWatchlistTickers(), upper));
    const onUpdate = () => setInList(hasTickerCI(readRawWatchlistTickers(), upper));
    window.addEventListener('mc:watchlist:updated', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('mc:watchlist:updated', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, [upper]);
  if (!upper) return null;
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = readRawWatchlistTickers();
    const present = hasTickerCI(raw, upper);
    const next = present
      ? raw.filter(t => String(t).toUpperCase() !== upper)
      : [...raw, upper];
    writeRawWatchlistTickers(next);
    setInList(!present);
  };
  return (
    <button
      onClick={onClick}
      title={inList ? `${upper} is in your Watchlist — click to remove` : `Add ${upper} to your Watchlist`}
      style={{
        background: inList ? '#10B98115' : 'none',
        border: `1px solid ${inList ? '#10B98160' : 'var(--mc-border-1)'}`,
        borderRadius: '10px',
        color: inList ? 'var(--mc-bullish)' : 'var(--mc-text-4)',
        cursor: 'pointer', padding: '6px 10px', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', minHeight: '32px',
        justifyContent: 'center', fontSize: 11, fontWeight: 700, letterSpacing: '0.3px',
      }}
    >
      {inList ? `✓ ${upper}` : `+ Watch`}
    </button>
  );
}

function NewsCard({ article, onSelect }: { article: NewsArticle; onSelect: (a: NewsArticle) => void }) {
  const symbols = getTickerSymbols(article);
  const title = getTitle(article);
  const source = getSource(article);
  const url = getUrl(article);
  const sentiment = sentimentBadge(article.sentiment);
  const tier = tierBadge(article.investment_tier);

  const isStale = (() => {
    try {
      const d = new Date(article.published_at);
      const daysSince = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince > 7;
    } catch { return false; }
  })();

  const isPersistent = isPersistentSignal(article);
  const isStructural = !!article.is_synthetic
    || article.feed_layer === 'STRUCTURAL_ALPHA'
    || article.structural_status === 'CRITICAL'
    || article.structural_status === 'ELEVATED';

  // PATCH 0434 BUG-019 — Structural alerts had no URL → became dead <div>s.
  // For structural alerts, link to the Bottleneck Workbench page (filter
  // by theme if we can extract one from tags/title). Otherwise, the card
  // still calls onSelect to show details.
  const structuralLink: string | null = isStructural ? (() => {
    const a = article as any;
    const tagTheme = (a.tags as string[] | undefined)?.find(t => /^theme:/i.test(t))?.replace(/^theme:/i, '');
    const theme = tagTheme || a.bottleneck_theme || a.theme_id || '';
    return theme
      ? `/bottleneck-workbench?theme=${encodeURIComponent(theme)}`
      : '/bottleneck-workbench';
  })() : null;

  const handleCardClick = (e: React.MouseEvent) => {
    // If clicking inner buttons, don't navigate
    if ((e.target as HTMLElement).closest('button')) return;
    if (url && url !== '#') {
      // Use <a> navigation below, don't handle here
      return;
    }
    onSelect(article);
  };

  const CardWrapper = url && url !== '#' ? 'a' : (structuralLink ? 'a' : 'div');
  const cardProps = url && url !== '#'
    ? { href: url, target: '_blank' as const, rel: 'noopener noreferrer' }
    : (structuralLink ? { href: structuralLink } : {});

  return (
    <CardWrapper
      {...cardProps}
      className="news-card"
      style={{ display: 'block', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '14px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s', opacity: (isStale && !isPersistent && !isStructural) ? 0.55 : 1, textDecoration: 'none', color: 'inherit' }}
      onClick={handleCardClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: importanceDot(article.importance_score), flexShrink: 0, marginTop: '7px' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', color: 'var(--mc-text-4)' }}>{regionFlag(article.region)}</span>
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
              backgroundColor: typeColor(article.article_type) + '22',
              color: typeColor(article.article_type),
              border: `1px solid ${typeColor(article.article_type)}40`,
            }}>
              {article.article_type?.replace(/_/g, ' ')}
            </span>
            {isStale && !isPersistent && (
              <span style={chipStyle(TOKENS.state.stale)} title="Published 48 hours to 7 days ago">
                STALE
              </span>
            )}
            {isPersistent && (
              <span style={chipStyle(TOKENS.state.persistent)} title="Older than 7 days; persistent structural theme">
                PERSISTENT
              </span>
            )}
            {isStructural && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: '#6366F115', color: '#818CF8', border: '1px solid #6366F140',
                letterSpacing: '0.3px',
              }}>
                STRUCTURAL
              </span>
            )}
            {tier && (
              <span style={{
                fontSize: '9px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: tier.bg, color: tier.color,
                border: `1px solid ${tier.border}`, letterSpacing: '0.3px',
              }}>
                {tier.label}
              </span>
            )}
            {/* PATCH 0455 TIER1-F — "Why ranked here?" priority badge.
                Tooltip shows the score breakdown: importance × severity ×
                structural × recency × source-weight × noise-multiplier. */}
            {(() => {
              const pri = (article as any).__priority;
              const parts = (article as any).__priorityParts;
              if (typeof pri !== 'number') return null;
              const tip = parts
                ? `Priority ${pri.toFixed(1)} = importance ${parts.importance?.toFixed?.(1) ?? '—'} + severity ${parts.severity?.toFixed?.(1) ?? '—'} + structural ${parts.structural?.toFixed?.(1) ?? '—'} + recency ${parts.recency?.toFixed?.(1) ?? '—'} × source-weight ${parts.source_weight?.toFixed?.(2) ?? '—'} × noise ${parts.noise_mult?.toFixed?.(2) ?? '—'}`
                : `Priority score ${pri.toFixed(1)} — combines impact, severity, source quality, and recency`;
              return (
                <span title={tip} style={{
                  fontSize: '9px', fontWeight: '800', padding: '3px 7px', borderRadius: '5px',
                  backgroundColor: '#22D3EE15', color: 'var(--mc-cyan)',
                  border: '1px solid #22D3EE40', letterSpacing: '0.3px',
                  cursor: 'help', fontFamily: 'ui-monospace, monospace',
                }}>
                  P {pri.toFixed(0)}
                </span>
              );
            })()}
            {sentiment && (
              <span style={{
                fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
                backgroundColor: sentiment.bg,
                color: sentiment.color,
                border: `1px solid ${sentiment.border}`,
              }}>
                {sentiment.icon} {sentiment.label}
              </span>
            )}
            {symbols.slice(0, 3).map(t => (
              <span key={t} style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '5px', backgroundColor: '#0F7ABF18', color: 'var(--mc-accent)', border: '1px solid #0F7ABF30' }}>
                {t}
              </span>
            ))}
            {article.themes?.slice(0, 2).map(th => (
              <span key={th} style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: '#EF444415', color: '#F87171', border: '1px solid #EF444430', letterSpacing: '0.3px' }}>
                {th.replace(/_/g, ' ')}
              </span>
            ))}
            {/* PATCH 0449 — Institutional detector chips. Each fires only
                when its regex matches; otherwise the card stays as-is.
                PATCH 0452 P0-5 — Prefer pre-annotated fields stamped by
                the server (cheap path); fall back to client-side compute
                for articles cached before the server-side wiring landed. */}
            {(() => {
              const pre = article as any;
              const ann = (pre.__creditStress !== undefined || pre.__noise !== undefined)
                ? {
                    creditStress: pre.__creditStress ?? null,
                    promoter: pre.__promoter ?? null,
                    workingCapital: pre.__workingCapital ?? null,
                    orderQuality: pre.__orderQuality ?? null,
                    noise: pre.__noise ?? { isListicle: false, isSpeculation: false, qualityMultiplier: 1 },
                    expectation: pre.__expectation ?? null,
                  }
                : annotateArticle({ title: article.title, headline: article.headline, summary: article.summary });
              const chips: React.ReactNode[] = [];
              if (ann.creditStress) chips.push(
                <span key="cs" title={`Credit stress: ${ann.creditStress.label} — matched "${ann.creditStress.evidence}"`}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.creditStress.color + '15', color: ann.creditStress.color, border: `1px solid ${ann.creditStress.color}40`, letterSpacing: '0.3px' }}>
                  {ann.creditStress.emoji} {ann.creditStress.label}
                </span>
              );
              if (ann.promoter) chips.push(
                <span key="pb" title={`Promoter behavior: ${ann.promoter.label} — matched "${ann.promoter.evidence}"`}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.promoter.color + '15', color: ann.promoter.color, border: `1px solid ${ann.promoter.color}40`, letterSpacing: '0.3px' }}>
                  {ann.promoter.emoji} {ann.promoter.label}
                </span>
              );
              if (ann.workingCapital) chips.push(
                <span key="wc" title={`Working-capital stress: ${ann.workingCapital.label} — matched "${ann.workingCapital.evidence}"`}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.workingCapital.color + '15', color: ann.workingCapital.color, border: `1px solid ${ann.workingCapital.color}40`, letterSpacing: '0.3px' }}>
                  {ann.workingCapital.emoji} {ann.workingCapital.label}
                </span>
              );
              if (ann.expectation) chips.push(
                <span key="eg" title={ann.expectation.label}
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: ann.expectation.color + '15', color: ann.expectation.color, border: `1px solid ${ann.expectation.color}40`, letterSpacing: '0.3px' }}>
                  {ann.expectation.emoji} {ann.expectation.label}
                </span>
              );
              if (ann.orderQuality) {
                const oq = ann.orderQuality;
                const lab = [
                  oq.hasPassThrough ? 'pass-through' : null,
                  oq.isGovernment ? 'govt' : oq.isPrivate ? 'private' : null,
                  oq.durationLabel,
                  oq.marginHint,
                  oq.concentrationRisk ? '⚠ concentration' : null,
                ].filter(Boolean).join(' · ');
                if (lab) chips.push(
                  <span key="oq" title={`Order-book quality signals: ${lab}`}
                    style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: '#0F7ABF15', color: 'var(--mc-cyan)', border: '1px solid #0F7ABF40', letterSpacing: '0.3px' }}>
                    📋 {lab}
                  </span>
                );
              }
              if (ann.noise.isListicle) chips.push(
                <span key="lst" title="Aggregator listicle — '5 stocks to watch'-style headline. Heavy noise penalty applied to ranking."
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: '#94A3B815', color: 'var(--mc-text-3)', border: '1px solid #94A3B840', letterSpacing: '0.3px' }}>
                  📋 LISTICLE
                </span>
              );
              if (ann.noise.isSpeculation) chips.push(
                <span key="spc" title="Speculative headline — 'could acquire' / 'in talks' / 'reportedly'. Penalty applied to ranking."
                  style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: '#F59E0B15', color: 'var(--mc-warn)', border: '1px solid #F59E0B40', letterSpacing: '0.3px' }}>
                  💭 SPECULATION
                </span>
              );
              // Confidence band — derived in the parent useMemo from source-weight + cluster size.
              const cb = (article as any).__confidence as keyof typeof CONFIDENCE_VISUAL | undefined;
              if (cb && CONFIDENCE_VISUAL[cb]) {
                const v = CONFIDENCE_VISUAL[cb];
                chips.push(
                  <span key="cb" title={v.description}
                    style={{ fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: v.color + '15', color: v.color, border: `1px solid ${v.color}40`, letterSpacing: '0.3px' }}>
                    {v.emoji} {v.label}
                  </span>
                );
              }
              // Cluster size chip — "+N sources" PLUS a corroboration timeline.
              // PATCH 0454 TIER1-B — When the cluster has timestamps, render
              // a 60px-wide row of tick marks proportional to time-span. A
              // 5-min-apart cluster shows ticks tightly clustered (high
              // conviction breaking news); a 6h-apart cluster shows ticks
              // spread out (echo chamber rewrites). The eye reads conviction
              // density at a glance.
              const clusterSize = (article as any).__clusterSize as number | undefined;
              const clusterTimes = (article as any).__clusterTimes as number[] | undefined;
              if (clusterSize && clusterSize > 1) {
                const renderTimeline = () => {
                  if (!clusterTimes || clusterTimes.length < 2) return null;
                  const min = clusterTimes[0];
                  const max = clusterTimes[clusterTimes.length - 1];
                  const span = Math.max(1, max - min);
                  const spanMin = Math.round(span / 60_000);
                  const spanLabel = spanMin < 60 ? `${spanMin}m` : spanMin < 1440 ? `${Math.round(spanMin / 60)}h` : `${Math.round(spanMin / 1440)}d`;
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4 }}
                      title={`Corroboration span: ${spanLabel}. Tight clusters (<30m) = breaking; wide clusters (>4h) = echo chamber rewrites.`}>
                      <span style={{
                        position: 'relative', width: 60, height: 8,
                        borderLeft: '1px solid #10B98140', borderRight: '1px solid #10B98140',
                      }}>
                        {clusterTimes.map((t, i) => {
                          const left = ((t - min) / span) * 100;
                          return (
                            <span key={i} style={{
                              position: 'absolute', left: `${left}%`, top: 0,
                              width: 1.5, height: 8,
                              background: 'var(--mc-bullish)',
                              transform: 'translateX(-50%)',
                            }} />
                          );
                        })}
                      </span>
                      <span style={{ fontSize: 8, color: 'var(--mc-bullish)', fontWeight: 700 }}>{spanLabel}</span>
                    </span>
                  );
                };
                chips.push(
                  <span key="cl"
                    title={`This event also reported by ${clusterSize - 1} other source${clusterSize === 2 ? '' : 's'} — clustered under one master article.`}
                    style={{ display: 'inline-flex', alignItems: 'center', fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px', backgroundColor: '#10B98115', color: 'var(--mc-bullish)', border: '1px solid #10B98140', letterSpacing: '0.3px' }}>
                    🔗 +{clusterSize - 1} sources
                    {renderTimeline()}
                  </span>
                );
              }
              // PATCH 0579 — TheWrap detector chips. Each chip surfaces an
              // alternate-data signal (Order-Book / Strategic-Hire /
              // Marquee-Capital / Marketing-Auth) the standard news feed
              // would otherwise bury. Pure regex over headline + summary;
              // no backend required.
              try {
                const blob = `${article.title || ''} ${article.headline || ''} ${article.summary || ''}`;
                const wrapSignals = detectAllTheWrap(blob);
                for (const sig of wrapSignals) {
                  chips.push(
                    <span key={`tw-${sig.label}`}
                      title={`${sig.evidence}\n\nTheWrap alternate-data detector — heuristic regex match. Verify in the source article before acting.`}
                      style={{
                        fontSize: '9px', fontWeight: '700', padding: '3px 7px', borderRadius: '5px',
                        backgroundColor: sig.color + '15', color: sig.color,
                        border: `1px solid ${sig.color}40`, letterSpacing: '0.3px',
                      }}>
                      {sig.emoji} {sig.label}
                    </span>
                  );
                }
              } catch { /* defensive: never let a detector regex crash a card */ }
              return chips;
            })()}
          </div>
          <p style={{ fontSize: '17px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.55' }}>{title}</p>
          {article.impact_statement && (
            <p style={{ fontSize: '18px', color: 'var(--mc-warn)', margin: '0 0 6px', lineHeight: '1.5', fontWeight: '500', fontStyle: 'italic' }}>
              Impact: {article.impact_statement}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '17px', color: '#6A7B8C', fontWeight: '500' }}>{source}</span>
            <span style={{ fontSize: '17px', color: '#2A3B4C' }}>·</span>
            <span style={{ fontSize: '17px', color: 'var(--mc-text-4)' }}>{timeAgo(article.published_at)}</span>
            {url && url !== '#' && (
              <ExternalLink style={{ width: '11px', height: '11px', color: '#3A4B5C' }} />
            )}
          </div>
        </div>
        {/* PATCH 0569 (UX #4) — Inline +Watch button. Uses the first
            ticker on the article — multi-symbol adds stay the watchlist
            page's job. Hidden when no ticker is attached. */}
        <WatchlistButton ticker={symbols[0] || null} />
        {/* AUDIT_100 #58 — Read-it-later toggle. Saves the article id to
            localStorage 'mc:reading-list:v1' for later retrieval. */}
        <ReadingListButton id={article.id} />
        {/* Info button to open detail overlay */}
        {/* PATCH 0441 BUG-006 — Add preventDefault so clicking 'View details'
            inside an <a href> card opens the drawer instead of navigating to
            the external article URL. Audit reported clicking 'View details'
            destroyed app state by hard-navigating away. */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(article); }}
          style={{ background: 'none', border: '1px solid var(--mc-border-1)', borderRadius: '10px', color: 'var(--mc-text-4)', cursor: 'pointer', padding: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', minWidth: '40px', minHeight: '40px', justifyContent: 'center' }}
          title="View details (opens drawer — does not leave app)"
        >
          <ChevronRight style={{ width: '14px', height: '14px' }} />
        </button>
      </div>
    </CardWrapper>
  );
}

/** Full-screen article detail overlay — shows when user clicks a news card. */
// PATCH 0233 — Thesis Notebooks v0.
// Free-text notes saved per article in localStorage under
// 'mc:notes:v1:<article_id>'. Survives page refresh, syncs cross-tab.
// Real version (per-user notebooks server-side, @-mentions, version history)
// requires Auth + notes table — frontend-only v0 here.
const NOTE_KEY_PREFIX = 'mc:notes:v1:';
// PATCH 0551 — AUDIT_100 #9 bounded growth.  Sidecar index tracking last-write
// per note id so we can evict oldest when count exceeds the cap.  Without
// this, mc:notes:v1:<id> grew unbounded across every news article the user
// ever opened, eventually blowing past the 5 MB localStorage quota and
// silently breaking subsequent writes across the app.
const NOTE_META_KEY = 'mc:notes:meta:v1';
const NOTE_MAX = 200;
function readNoteMeta(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(NOTE_META_KEY) || '{}'); } catch { return {}; }
}
function writeNoteMeta(m: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(NOTE_META_KEY, JSON.stringify(m)); } catch {}
}
function loadNote(articleId: string): string {
  if (typeof window === 'undefined') return '';
  // PATCH 0545 — race-aware read so an autosave-in-flight read returns the
  // freshly-typed text instead of the last-flushed LS value.
  try { return getItemSync(NOTE_KEY_PREFIX + articleId) || ''; } catch { return ''; }
}
function saveNote(articleId: string, text: string) {
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

function ArticleDetail({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  const symbols = getTickerSymbols(article);
  const title = getTitle(article);
  const source = getSource(article);
  const url = getUrl(article);
  const sentiment = sentimentBadge(article.sentiment);
  // PATCH 0233 — Per-article notebook
  const [noteText, setNoteText] = useState(() => loadNote(article.id));
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  // Debounced autosave
  useEffect(() => {
    const id = setTimeout(() => {
      saveNote(article.id, noteText);
      setNoteSavedAt(Date.now());
    }, 600);
    return () => clearTimeout(id);
  }, [noteText, article.id]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '0px', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '0px', width: '100%', maxWidth: '700px', height: '100vh', maxHeight: '100vh', overflowY: 'auto', padding: '20px 16px' }}
        className="article-detail-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', fontSize: '18px', padding: '4px 8px' }}>
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Tags row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{regionFlag(article.region)}</span>
          <span style={{
            fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
            backgroundColor: typeColor(article.article_type) + '22',
            color: typeColor(article.article_type),
            border: `1px solid ${typeColor(article.article_type)}40`,
          }}>
            {article.article_type?.replace(/_/g, ' ')}
          </span>
          {sentiment && (
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
              backgroundColor: sentiment.bg, color: sentiment.color, border: `1px solid ${sentiment.border}`,
            }}>
              {sentiment.icon} {sentiment.label}
            </span>
          )}
          <span style={{
            fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
            backgroundColor: importanceDot(article.importance_score) + '22',
            color: importanceDot(article.importance_score),
            border: `1px solid ${importanceDot(article.importance_score)}40`,
          }}>
            Importance: {article.importance_score}/5
          </span>
        </div>

        {/* Headline */}
        <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--mc-text-0)', margin: '0 0 12px', lineHeight: '1.4' }}>
          {title}
        </h2>

        {/* Source & time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--mc-accent)' }}>{source}</span>
          <span style={{ fontSize: '12px', color: '#2A3B4C' }}>·</span>
          <span style={{ fontSize: '12px', color: 'var(--mc-text-4)' }}>{timeAgo(article.published_at)}</span>
        </div>

        {/* Bottleneck themes */}
        {article.themes && article.themes.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>BOTTLENECK CATEGORIES</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {article.themes.map(th => (
                <span key={th} style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#EF444418', color: '#F87171', border: '1px solid #EF444430' }}>
                  {th.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tickers */}
        {symbols.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>RELATED TICKERS</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {symbols.map(t => (
                <span key={t} style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '6px', backgroundColor: '#0F7ABF18', color: 'var(--mc-accent)', border: '1px solid #0F7ABF30' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {article.summary ? (
          <div style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: '20px', marginBottom: '20px' }}>
            <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 10px', letterSpacing: '0.5px' }}>SUMMARY</p>
            <p style={{ fontSize: '14px', color: '#C9D4E0', margin: 0, lineHeight: '1.7' }}>
              {article.summary}
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: '20px', marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--mc-text-4)', fontStyle: 'italic', margin: 0 }}>
              No summary available for this article.
            </p>
          </div>
        )}

        {/* PATCH 0232 — Evidence Panel v0 section. Surfaces the data the
            article payload already carries so users can audit a signal's
            provenance without leaving the page. Real evidence chain (with
            classifier feature traces + cross-article corroboration timeline)
            lands once the SignalEvidence schema is in place. */}
        <div style={{
          marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--mc-border-1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-cyan)', letterSpacing: '0.6px', marginBottom: 10 }}>
            EVIDENCE & PROVENANCE
          </div>
          {/* Source tier */}
          {(() => {
            const tier = classifySource(article.source_name ?? article.source, article.source_url ?? article.url);
            const v = TIER_VISUAL[tier];
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>SOURCE TIER</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  backgroundColor: v.tone.bg, color: v.tone.solid,
                  border: `1px solid ${v.tone.border}`,
                  padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  fontFamily: 'ui-monospace, monospace',
                }}>{v.glyph} {v.label}</span>
                <span style={{ fontSize: 11, color: '#8A95A3' }}>{v.description}</span>
              </div>
            );
          })()}
          {/* Corroboration */}
          {(article as any).also_reported_by_count > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>CORROBORATED</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#C9D4E0', marginBottom: 4 }}>
                  By {(article as any).also_reported_by_count} other source{(article as any).also_reported_by_count === 1 ? '' : 's'}:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(((article as any).also_reported_sources || []) as string[]).map((s, i) => (
                    <span key={`${s}-${i}`} style={{
                      backgroundColor: '#0A1422', border: '1px solid var(--mc-border-1)',
                      borderRadius: 4, padding: '2px 6px', fontSize: 10, color: '#8A95A3',
                    }}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Severity contributors (what fields drove the rank) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>WHY RANKED</span>
            <div style={{ flex: 1, fontSize: 11, color: '#C9D4E0', fontFamily: 'ui-monospace, monospace', lineHeight: 1.6 }}>
              <div>  importance: {article.importance_score ?? '—'} / 5</div>
              {article.bottleneck_level && <div>  bottleneck:  {article.bottleneck_level.replace(/_/g, ' ')}</div>}
              {(article as any).investment_tier && <div>  tier:        {(article as any).investment_tier}</div>}
              {(article as any).structural_relevance?.score != null && (
                <div>  structural:  {(article as any).structural_relevance.score} ({(article as any).structural_relevance.tier_label})</div>
              )}
              {(article as any).signal_confidence?.confidence_pct != null && (
                <div>  confidence:  {(article as any).signal_confidence.confidence_pct}%</div>
              )}
              <div style={{ marginTop: 4, color: '#6B7B8C', fontFamily: 'inherit' }}>
                Full classifier feature trace lands once the SignalEvidence schema ships (P0 follow-up).
              </div>
            </div>
          </div>
          {/* Lifecycle */}
          {(() => {
            const ts = new Date(article.published_at || (article as any).ingested_at || 0).getTime();
            const age = Date.now() - ts;
            const ageH = age / 3600_000;
            const bucket = ageH <= 24 ? 'LIVE' : ageH <= 48 ? 'WARM' : ageH <= 168 ? 'STALE' : 'PERSISTENT';
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#6B7B8C', fontWeight: 600, minWidth: 88 }}>LIFECYCLE</span>
                <span style={{ fontSize: 11, color: '#C9D4E0' }}>
                  {bucket} · published {article.published_at ? new Date(article.published_at).toLocaleString() : '—'}
                </span>
              </div>
            );
          })()}
        </div>

        {/* PATCH 0233 — Thesis Notebook v0 (per-article notes, localStorage) */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--mc-border-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-cyan)', letterSpacing: '0.6px' }}>
              📝 ANALYST NOTE
            </span>
            <span style={{ fontSize: 9, color: '#6B7B8C', fontFamily: 'ui-monospace, monospace' }}>
              {noteSavedAt ? `saved ${new Date(noteSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'autosaves to this browser'}
            </span>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Thesis, decision rationale, ticker tags, follow-ups…  (Markdown supported. Local to this browser until Notebooks server-side ships.)"
            style={{
              width: '100%', minHeight: 96, resize: 'vertical',
              backgroundColor: '#0A1422', border: '1px solid var(--mc-border-1)',
              borderRadius: 6, padding: '8px 10px', color: 'var(--mc-text-0)',
              fontSize: 12, fontFamily: 'ui-monospace, monospace',
              lineHeight: 1.5, outline: 'none',
            }}
          />
          {noteText.trim().length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#6B7B8C' }}>{noteText.length} chars</span>
              <button
                onClick={() => { if (window.confirm('Delete this note?')) setNoteText(''); }}
                style={{
                  marginLeft: 'auto', background: 'none', border: '1px solid var(--mc-border-1)',
                  color: '#6B7B8C', borderRadius: 4, padding: '2px 8px',
                  fontSize: 10, cursor: 'pointer',
                }}
              >Clear</button>
            </div>
          )}
        </div>

        {/* External link */}
        {url && url !== '#' && (
          <a
            href={url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', fontWeight: '600', color: 'var(--mc-accent)', textDecoration: 'none',
              padding: '8px 16px', borderRadius: '8px', border: '1px solid #0F7ABF40',
              backgroundColor: '#0F7ABF10', marginTop: 16,
            }}
          >
            Open original article <ExternalLink style={{ width: '12px', height: '12px' }} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Bottleneck Dashboard ──────────────────────────────────────────────────────

function BottleneckDashboard({
  dashboard,
  isLoading,
  onOpenDrilldown,
  bottleneckLevel = 'ALL',
  bottleneckCategory = 'ALL',
}: {
  dashboard?: BnDashboard;
  isLoading: boolean;
  onOpenDrilldown?: (subTag: string) => void;
  bottleneckLevel?: string;
  bottleneckCategory?: string;
}) {
  // All buckets expanded by default
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());

  // Filter buckets by the active level/category sub-filters so the dashboard
  // stays consistent with the top article list.
  const filteredBuckets = useMemo(() => {
    if (!dashboard?.buckets) return [];
    const levelToSeverity: Record<string, (sev: number) => boolean> = {
      CRITICAL_BOTTLENECK: sev => sev >= 5,
      BOTTLENECK: sev => sev === 4,
      WATCH: sev => sev <= 3 && sev >= 2,
      RESOLVED_EASING: sev => sev <= 1,
    };
    return dashboard.buckets.filter(b => {
      if (bottleneckLevel !== 'ALL') {
        const pred = levelToSeverity[bottleneckLevel];
        if (pred && !pred(b.severity)) return false;
      }
      if (bottleneckCategory !== 'ALL' && b.bucket_id !== bottleneckCategory) return false;
      return true;
    });
  }, [dashboard, bottleneckLevel, bottleneckCategory]);

  // Compat: expandedBuckets derived from collapsedBuckets (inverted logic)
  const expandedBuckets = useMemo(() => {
    if (!filteredBuckets.length) return new Set<string>();
    const all = new Set(filteredBuckets.map(b => b.bucket_id));
    for (const id of collapsedBuckets) all.delete(id);
    return all;
  }, [filteredBuckets, collapsedBuckets]);

  const toggleBucket = (id: string) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSignal = (id: string) => {
    setExpandedSignals(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: '100px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '14px' }} className="animate-shimmer" />
        ))}
      </div>
    );
  }

  if (!dashboard?.buckets?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <p style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</p>
        <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 8px' }}>No active bottleneck signals</p>
        <p style={{ fontSize: '13px', color: 'var(--mc-text-4)', margin: 0 }}>Bottleneck signals will appear when supply-chain constraint articles are detected</p>
      </div>
    );
  }

  if (!filteredBuckets.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '12px' }}>
        <p style={{ fontSize: '28px', marginBottom: '10px' }}>🔎</p>
        <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--mc-text-0)', margin: '0 0 6px' }}>No dashboard buckets match current filters</p>
        <p style={{ fontSize: '12px', color: 'var(--mc-text-4)', margin: 0 }}>Try clearing the level or category filter to see the full intelligence grid.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary bar */}
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--mc-bearish)', letterSpacing: '0.5px' }}>BOTTLENECK INTELLIGENCE</span>
        <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
          {filteredBuckets.length} categories · {filteredBuckets.reduce((s, b) => s + b.signal_count, 0)} signals · {filteredBuckets.reduce((s, b) => s + b.article_count, 0)} evidence articles
        </span>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          {[
            { label: 'CRITICAL', count: filteredBuckets.filter(b => b.severity >= 5).length, color: '#EF4444' },
            { label: 'HIGH', count: filteredBuckets.filter(b => b.severity === 4).length, color: '#F59E0B' },
            { label: 'ELEVATED', count: filteredBuckets.filter(b => b.severity === 3).length, color: '#3B82F6' },
            { label: 'WATCH', count: filteredBuckets.filter(b => b.severity <= 2).length, color: '#6B7280' },
          ].filter(s => s.count > 0).map(s => (
            <span key={s.label} style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', backgroundColor: s.color + '15', color: s.color, border: `1px solid ${s.color}30` }}>
              {s.count} {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Bucket cards */}
      {filteredBuckets.map(bucket => {
        const isExpanded = expandedBuckets.has(bucket.bucket_id);
        return (
          <div key={bucket.bucket_id} style={{ backgroundColor: 'var(--mc-bg-2)', border: `1px solid ${bucket.severity >= 4 ? bucket.severity_color + '40' : 'var(--mc-border-1)'}`, borderRadius: '14px', overflow: 'hidden' }}>
            {/* Bucket header */}
            <div
              onClick={() => toggleBucket(bucket.bucket_id)}
              style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              {/* Severity indicator */}
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: bucket.severity_color + '18', border: `1px solid ${bucket.severity_color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                {bucket.severity_icon}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--mc-text-0)' }}>{bucket.label}</span>
                  <span style={{
                    fontSize: '9px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px',
                    backgroundColor: bucket.severity_color + '20', color: bucket.severity_color,
                    border: `1px solid ${bucket.severity_color}40`, letterSpacing: '0.5px',
                  }}>
                    {bucket.severity_label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
                    {bucket.signal_count} signal{bucket.signal_count !== 1 ? 's' : ''} · {bucket.article_count} article{bucket.article_count !== 1 ? 's' : ''}
                  </span>
                  {bucket.key_tickers.slice(0, 4).map(t => (
                    <span key={t} style={{ fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#0F7ABF15', color: 'var(--mc-accent)', border: '1px solid #0F7ABF25' }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {onOpenDrilldown && BOTTLENECK_DRILLDOWN[bucket.bucket_id] && (
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenDrilldown(bucket.bucket_id); }}
                  style={{
                    fontSize: '10px', fontWeight: '700', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer',
                    border: '1px solid #8B5CF640', backgroundColor: '#8B5CF615', color: 'var(--mc-state-persistent)',
                    flexShrink: 0, letterSpacing: '0.3px',
                  }}
                  title="Open supply/demand drilldown"
                >
                  DEEP DIVE
                </button>
              )}
              {isExpanded
                ? <ChevronDown style={{ width: '16px', height: '16px', color: 'var(--mc-text-4)', flexShrink: 0 }} />
                : <ChevronRight style={{ width: '16px', height: '16px', color: 'var(--mc-text-4)', flexShrink: 0 }} />
              }
            </div>

            {/* Expanded: show signals */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--mc-border-1)', padding: '4px 0' }}>
                {/* Description */}
                <p style={{ fontSize: '12px', color: '#6B7280', margin: '10px 18px 12px', lineHeight: '1.5' }}>
                  {bucket.description}
                </p>

                {bucket.signals.map((signal, idx) => {
                  const signalKey = `${bucket.bucket_id}-${idx}`;
                  const signalExpanded = expandedSignals.has(signalKey);
                  return (
                    <div key={signalKey} style={{ margin: '0 12px 8px', backgroundColor: '#0D1B2E', borderRadius: '10px', border: '1px solid var(--mc-bg-4)' }}>
                      {/* Signal header */}
                      <div
                        onClick={() => toggleSignal(signalKey)}
                        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '10px' }}
                      >
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: bucket.severity_color, flexShrink: 0, marginTop: '6px' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {signal.articles?.[0]?.source_url ? (
                            <a
                              href={signal.articles[0].source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4', display: 'block', textDecoration: 'none' }}
                            >
                              {decodeHtml(signal.headline)}
                              <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', marginLeft: '6px', display: 'inline' }} />
                            </a>
                          ) : (
                            <p style={{ fontSize: '13px', fontWeight: '600', color: '#E8EDF2', margin: '0 0 4px', lineHeight: '1.4' }}>
                              {decodeHtml(signal.headline)}
                            </p>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>
                              {signal.sources.join(', ')}
                            </span>
                            {signal.evidence_count > 1 && (
                              <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-warn)', backgroundColor: '#F59E0B15', padding: '1px 6px', borderRadius: '3px' }}>
                                +{signal.evidence_count - 1} related
                              </span>
                            )}
                            {signal.tickers.slice(0, 3).map(t => (
                              <span key={t} style={{ fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#0F7ABF12', color: 'var(--mc-accent)', border: '1px solid #0F7ABF20' }}>
                                {t}
                              </span>
                            ))}
                            <span style={{ fontSize: '10px', color: '#3A4B5C' }}>
                              {timeAgo(signal.latest_at)}
                            </span>
                          </div>
                        </div>
                        {signal.evidence_count > 1 && (
                          signalExpanded
                            ? <ChevronDown style={{ width: '14px', height: '14px', color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '2px' }} />
                            : <ChevronRight style={{ width: '14px', height: '14px', color: 'var(--mc-text-4)', flexShrink: 0, marginTop: '2px' }} />
                        )}
                      </div>

                      {/* Expanded: evidence articles */}
                      {signalExpanded && signal.evidence_count > 1 && (
                        <div style={{ borderTop: '1px solid var(--mc-bg-4)', padding: '8px 14px 10px', paddingLeft: '30px' }}>
                          <p style={{ fontSize: '9px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 6px', letterSpacing: '0.5px' }}>EVIDENCE ARTICLES</p>
                          {signal.articles.map((art, aidx) => (
                            <a
                              key={aidx}
                              href={art.source_url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', textDecoration: 'none', borderBottom: aidx < signal.articles.length - 1 ? '1px solid #15213a' : 'none' }}
                            >
                              <span style={{ fontSize: '11px', color: '#C9D4E0', flex: 1 }}>
                                {/* PATCH 0267 — defend against null headline */}
                                {decodeHtml((art.headline || '')).slice(0, 90)}{(art.headline || '').length > 90 ? '…' : ''}
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--mc-text-4)', flexShrink: 0 }}>{art.source_name}</span>
                              <ExternalLink style={{ width: '10px', height: '10px', color: '#3A4B5C', flexShrink: 0 }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Drilldown knowledge base ─────────────────────────────────────────────────
// Maps bottleneck sub-tags to institutional narrative: why it's a bottleneck,
// supply vs demand dynamics, and listed company winners/losers.

type DrilldownEntry = {
  label: string;
  icon: string;
  why: string;
  supply: string;
  demand: string;
  winners: Array<{ ticker: string; thesis: string }>;
  losers: Array<{ ticker: string; thesis: string }>;
};

const BOTTLENECK_DRILLDOWN: Record<string, DrilldownEntry> = {
  MEMORY_STORAGE: {
    label: 'Memory & Storage',
    icon: '🧠',
    why: 'HBM and enterprise DRAM/NAND capacity is sold out through 2026. Every hyperscaler GPU needs 6-8 stacks of HBM3E; capacity additions lag GPU demand by 18-24 months.',
    supply: 'Only 3 HBM producers (SK Hynix, Samsung, Micron). Capex cycles are 2-3 years. Yield on HBM3E is structurally below DDR5.',
    demand: 'Every Blackwell GPU consumes 8× HBM3E stacks. Inference clusters need 3-5× the memory footprint of training. Demand growing ~60% YoY.',
    winners: [
      { ticker: '000660.KS', thesis: 'SK Hynix: HBM share leader, 50%+ of supply' },
      { ticker: 'MU', thesis: 'Micron: HBM3E ramp, capex leverage' },
      { ticker: '005930.KS', thesis: 'Samsung: HBM3E qualification gating catch-up' },
    ],
    losers: [
      { ticker: 'NVDA', thesis: 'Margin pressure as HBM costs stay elevated' },
      { ticker: 'META', thesis: 'Capex inflation on memory-heavy training clusters' },
    ],
  },
  INTERCONNECT_PHOTONICS: {
    label: 'Interconnect & Photonics',
    icon: '💡',
    why: 'Copper interconnects hit bandwidth walls at 224 Gbps SerDes. Co-packaged optics and silicon photonics are the only path to 1.6T/3.2T fabrics for future AI factories.',
    supply: 'CPO supply chain immature: lasers, modulators, couplers bottlenecked at a handful of vendors. TSMC/Intel photonics integration still ramping.',
    demand: 'Every rack-scale AI system (NVL72, Trainium3) needs 10-100× more optical transceivers than prior generations. Hyperscaler buys locked through 2027.',
    winners: [
      { ticker: 'COHR', thesis: 'Coherent: datacenter transceivers, VCSEL supply' },
      { ticker: 'LITE', thesis: 'Lumentum: indium phosphide lasers for CPO' },
      { ticker: 'AVGO', thesis: 'Broadcom: Tomahawk 5 switches + CPO reference design' },
      { ticker: 'MRVL', thesis: 'Marvell: 800G/1.6T DSPs, custom silicon' },
    ],
    losers: [],
  },
  FABRICATION_PACKAGING: {
    label: 'Advanced Fabrication & Packaging',
    icon: '🏭',
    why: 'CoWoS advanced packaging at TSMC is the single-point bottleneck for every leading-edge AI accelerator. Capacity doubles every 18 months but demand outpaces it.',
    supply: 'TSMC CoWoS-L/S capacity: ~35K wpm in 2024, ~70K wpm targeted 2026. Intel Foveros and Samsung I-Cube still sub-scale. ASML High-NA EUV gating N2/A16 ramp.',
    demand: 'Nvidia alone consumes 60%+ of CoWoS. AMD MI300/MI350, AWS Trainium, Google TPU all share remaining supply. Demand growing 80%+ YoY.',
    winners: [
      { ticker: 'TSM', thesis: 'TSMC: monopoly on advanced packaging, CoWoS pricing power' },
      { ticker: 'ASML', thesis: 'ASML: sole EUV/High-NA supplier, 2-year backlog' },
      { ticker: 'AMAT', thesis: 'Applied Materials: advanced packaging tools' },
      { ticker: 'LRCX', thesis: 'Lam Research: etch and deposition for N2/A16' },
    ],
    losers: [
      { ticker: 'INTC', thesis: 'Intel Foundry behind on advanced packaging ramp' },
    ],
  },
  COMPUTE_SCALING: {
    label: 'Compute & GPU Allocation',
    icon: '⚡',
    why: 'GPU supply remains rationed by Nvidia. H100/H200 allocation is relationship-driven, Blackwell ramp gated by CoWoS. Tier-2 clouds and enterprises wait 6-12 months.',
    supply: 'Nvidia ships what TSMC packages. MI300X/MI325X are the only meaningful alternative; TPU/Trainium captive to respective hyperscalers.',
    demand: 'Hyperscaler AI capex ~$300B/yr, projected $450B+ in 2026. Sovereign AI funds, neoclouds, enterprise inference all competing for allocation.',
    winners: [
      { ticker: 'NVDA', thesis: 'Nvidia: allocation monopoly, 75%+ gross margin' },
      { ticker: 'AMD', thesis: 'AMD: MI series captures tier-2 demand' },
      { ticker: 'AVGO', thesis: 'Broadcom: custom ASIC (Google TPU, Meta MTIA)' },
    ],
    losers: [
      { ticker: 'CRWV', thesis: 'Neoclouds dependent on NVDA allocation' },
    ],
  },
  POWER_GRID: {
    label: 'Power & Grid Constraints',
    icon: '🔌',
    why: 'Data center power demand outpaces grid interconnect timelines by 3-7 years. Transformer, switchgear, and HV cable lead times are 80-130 weeks.',
    supply: 'Only 3 major transformer OEMs globally. Grain-oriented electrical steel (GOES) constrained. Utility interconnect queues span 5-10 years in PJM/ERCOT.',
    demand: 'AI data center nameplate demand: 50 GW US by 2030 (Goldman, EPRI). Hyperscaler site selection now power-first, real-estate second.',
    winners: [
      { ticker: 'GEV', thesis: 'GE Vernova: grid equipment, transformers' },
      { ticker: 'ETN', thesis: 'Eaton: switchgear, UPS, electrical backbone' },
      { ticker: 'VRT', thesis: 'Vertiv: power/cooling for data centers' },
      { ticker: 'ABB.SW', thesis: 'ABB: transformers, HV switchgear' },
      { ticker: 'SU.PA', thesis: 'Schneider Electric: grid + DC power distribution' },
    ],
    losers: [],
  },
  NUCLEAR_ENERGY: {
    label: 'Nuclear Energy',
    icon: '☢️',
    why: 'Hyperscalers pivoting to nuclear PPAs for 24/7 carbon-free baseload. SMRs and restart of retired plants are the only gigawatt-scale path this decade.',
    supply: 'Enriched uranium supply constrained post-Russia sanctions. Centrus and Urenco ramping HALEU slowly. SMR deployments 2028-2032.',
    demand: 'MSFT/Three Mile Island, AMZN/Talen, GOOG/Kairos, META/SMR RFP — every hyperscaler has inked nuclear deals. India targeting 100 GW by 2047.',
    winners: [
      { ticker: 'CCJ', thesis: 'Cameco: uranium mining leader' },
      { ticker: 'LEU', thesis: 'Centrus: HALEU enrichment monopoly' },
      { ticker: 'VST', thesis: 'Vistra: nuclear fleet + AI hyperscaler PPAs' },
      { ticker: 'CEG', thesis: 'Constellation: Three Mile Island restart, MSFT PPA' },
      { ticker: 'TLN', thesis: 'Talen: Susquehanna nuclear + AWS deal' },
      { ticker: 'NPCIL', thesis: 'NPCIL (India): 100 GW target by 2047' },
    ],
    losers: [],
  },
  THERMAL_COOLING: {
    label: 'Thermal & Cooling',
    icon: '❄️',
    why: 'Blackwell and beyond require direct-to-chip liquid cooling. Retrofit is impractical; new builds are 100% liquid-cooled. CDU and cold-plate supply sold out.',
    supply: 'CoolIT, Motivair, Boyd, Asetek are the main CDU vendors. Cold plate supply concentrated in Taiwan.',
    demand: 'NVL72 racks = 120+ kW/rack. Every new AI data center must deploy liquid cooling. Retrofit-ability is becoming CIO top-3 concern.',
    winners: [
      { ticker: 'VRT', thesis: 'Vertiv: liquid cooling + power thermal management' },
      { ticker: 'SMCI', thesis: 'Supermicro: liquid-cooled rack integration' },
      { ticker: 'ETN', thesis: 'Eaton: thermal electrical infrastructure' },
    ],
    losers: [],
  },
  MATERIALS_SUPPLY: {
    label: 'Critical Materials',
    icon: '⛏️',
    why: 'Gallium, germanium, neon, rare earths, and high-purity quartz gating semi and defense supply chains. China export controls accelerating bifurcation.',
    supply: 'China controls 80%+ of gallium/germanium processing, 90%+ of rare earth refining. Alternative supply 3-7 years out.',
    demand: 'AI, defense, EV, and renewable electrification all drawing from same materials stack. Demand growing 2-3× by 2030.',
    winners: [
      { ticker: 'MP', thesis: 'MP Materials: US rare earth independence' },
      { ticker: 'LYC.AX', thesis: 'Lynas: ex-China rare earth processing' },
    ],
    losers: [],
  },
  QUANTUM_CRYOGENICS: {
    label: 'Quantum & Cryogenics',
    icon: '🧊',
    why: 'Quantum hardware gated by dilution refrigerators, helium-3, and cryo electronics. Scale-up of logical qubits is the decade-long bottleneck.',
    supply: 'Bluefors, Oxford Instruments dominate dilution fridges. Helium-3 supply constrained by tritium decay chain.',
    demand: 'Sovereign quantum programs (US DOE, EU, China, India) + hyperscaler R&D (IBM, Google, MSFT, AMZN). Demand inelastic in near term.',
    winners: [
      { ticker: 'IBM', thesis: 'IBM: largest gate-based quantum fleet' },
      { ticker: 'RGTI', thesis: 'Rigetti: superconducting qubit IP' },
      { ticker: 'IONQ', thesis: 'IonQ: trapped-ion roadmap' },
    ],
    losers: [],
  },
};

// Persistent signal threshold: articles older than this but still ranked
// represent structural (non-news) constraints that won't resolve quickly.
const PERSISTENT_DAYS = 30;
const PERSISTENT_MS = PERSISTENT_DAYS * 24 * 60 * 60 * 1000;

function isPersistentSignal(article: NewsArticle): boolean {
  try {
    const pubTime = new Date(article.published_at).getTime();
    if (!Number.isFinite(pubTime)) return false;
    return Date.now() - pubTime > PERSISTENT_MS;
  } catch { return false; }
}

// ── Drilldown Panel ──────────────────────────────────────────────────────────

function BottleneckDrilldown({
  subTag,
  articles,
  onClose,
  onSelectArticle,
}: {
  subTag: string;
  articles: NewsArticle[];
  onClose: () => void;
  onSelectArticle: (a: NewsArticle) => void;
}) {
  const entry = BOTTLENECK_DRILLDOWN[subTag];
  const relatedArticles = useMemo(
    () => articles.filter(a => a.bottleneck_sub_tag === subTag).slice(0, 15),
    [articles, subTag],
  );

  if (!entry) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.65)' }}
        onClick={onClose}
      >
        <div
          style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', width: '100%', maxWidth: '700px', height: '100vh', overflowY: 'auto', padding: '20px 16px' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', color: 'var(--mc-text-0)', margin: 0 }}>{subTag.replace(/_/g, ' ')}</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer' }}>
              <X style={{ width: '18px', height: '18px' }} />
            </button>
          </div>
          <p style={{ fontSize: '13px', color: '#8A95A3' }}>No drilldown available for this category yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', width: '100%', maxWidth: '720px', height: '100vh', overflowY: 'auto', padding: '20px 16px' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer' }}>
            <X style={{ width: '18px', height: '18px' }} />
          </button>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '32px' }}>{entry.icon}</div>
          <div>
            <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bearish)', letterSpacing: '0.8px', marginBottom: '2px' }}>STRUCTURAL BOTTLENECK</div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--mc-text-0)', margin: 0 }}>{entry.label}</h2>
          </div>
        </div>

        {/* Why it's a bottleneck */}
        <section style={{ marginBottom: '18px' }}>
          <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bearish)', margin: '0 0 8px', letterSpacing: '0.5px' }}>WHY IT'S A BOTTLENECK</p>
          <p style={{ fontSize: '13px', color: '#C9D4E0', lineHeight: '1.6', margin: 0 }}>{entry.why}</p>
        </section>

        {/* Supply vs Demand */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
          <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-warn)', margin: '0 0 6px', letterSpacing: '0.5px' }}>SUPPLY</p>
            <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.55', margin: 0 }}>{entry.supply}</p>
          </div>
          <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '10px', padding: '12px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bullish)', margin: '0 0 6px', letterSpacing: '0.5px' }}>DEMAND</p>
            <p style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.55', margin: 0 }}>{entry.demand}</p>
          </div>
        </div>

        {/* Winners */}
        {entry.winners.length > 0 && (
          <section style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bullish)', margin: '0 0 8px', letterSpacing: '0.5px' }}>▲ LISTED COMPANIES — WINNERS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entry.winners.map(w => (
                <div key={w.ticker} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', backgroundColor: '#10B98108', border: '1px solid #10B98130', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--mc-bullish)', backgroundColor: '#10B98120', padding: '2px 7px', borderRadius: '4px', flexShrink: 0, minWidth: '70px', textAlign: 'center' }}>
                    {w.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.45' }}>{w.thesis}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Losers */}
        {entry.losers.length > 0 && (
          <section style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-bearish)', margin: '0 0 8px', letterSpacing: '0.5px' }}>▼ LISTED COMPANIES — UNDER PRESSURE</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entry.losers.map(l => (
                <div key={l.ticker} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', backgroundColor: '#EF444408', border: '1px solid #EF444430', borderRadius: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--mc-bearish)', backgroundColor: '#EF444420', padding: '2px 7px', borderRadius: '4px', flexShrink: 0, minWidth: '70px', textAlign: 'center' }}>
                    {l.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: '#C9D4E0', lineHeight: '1.45' }}>{l.thesis}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Related articles */}
        {relatedArticles.length > 0 && (
          <section style={{ borderTop: '1px solid var(--mc-border-1)', paddingTop: '16px' }}>
            <p style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-4)', margin: '0 0 10px', letterSpacing: '0.5px' }}>RECENT EVIDENCE ({relatedArticles.length})</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {relatedArticles.map(a => (
                <button
                  key={a.id}
                  onClick={() => onSelectArticle(a)}
                  style={{ textAlign: 'left', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)', borderRadius: '8px', padding: '10px 12px', cursor: 'pointer', color: '#C9D4E0', fontSize: '12px', lineHeight: '1.45' }}
                >
                  <div style={{ fontWeight: '600', color: '#E8EDF2', marginBottom: '3px' }}>{getTitle(a)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>{getSource(a)} · {timeAgo(a.published_at)}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// PATCH 0225 — Named Saved Views.
// Sits on top of Patch 0218 (URL-persistent filter state). The full URL
// query string IS the view; we just give the user a way to name it and
// jump back via localStorage. No backend, no schema migration.
interface SavedView { id: string; name: string; query: string; createdAt: number; }
const SAVED_VIEWS_KEY = 'mc:saved-views:v1';

function loadSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function persistSavedViews(views: SavedView[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views)); } catch {}
}

// PATCH 0569 (UX #1) — Auto-name a Saved View from its query string so the
// user can save with one click (no modal). Pulls the most semantically
// meaningful filters (type / region / lifecycle / signal / bottleneck
// subfilters / search) and appends a short date so a re-saved version
// doesn't collide. User can still rename via the ✎ pencil.
function autoNameSavedView(query: string): string {
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

function SavedViewsControl() {
  const router = useRouter();
  const pathname = usePathname();
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews());
  const [open, setOpen] = useState(false);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_VIEWS_KEY) setViews(loadSavedViews());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const currentQuery = typeof window !== 'undefined' ? window.location.search : '';
  const isDefault = !currentQuery || currentQuery === '?' || currentQuery === '';
  const alreadySaved = views.find(v => v.query === currentQuery);

  const onSave = () => {
    if (isDefault) {
      alert('No filters are active. Set at least one filter before saving the view.');
      return;
    }
    if (alreadySaved) {
      alert(`This filter combo is already saved as "${alreadySaved.name}".`);
      return;
    }
    // PATCH 0569 (UX #1) — One-click save. Auto-name from active filters
    // (e.g. "BOTTLENECK · India · May 21"). User can rename via ✎ later.
    const name = autoNameSavedView(currentQuery).slice(0, 60);
    const next: SavedView = { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name, query: currentQuery, createdAt: Date.now() };
    const updated = [next, ...views];
    setViews(updated);
    persistSavedViews(updated);
  };

  const onApply = (v: SavedView) => {
    router.replace(pathname + v.query, { scroll: false });
    setOpen(false);
  };

  const onRename = (v: SavedView) => {
    const name = window.prompt('Rename view:', v.name);
    if (!name?.trim()) return;
    const updated = views.map(x => x.id === v.id ? { ...x, name: name.trim().slice(0, 60) } : x);
    setViews(updated);
    persistSavedViews(updated);
  };

  const onDelete = (v: SavedView) => {
    if (!window.confirm(`Delete saved view "${v.name}"?`)) return;
    const updated = views.filter(x => x.id !== v.id);
    setViews(updated);
    persistSavedViews(updated);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      <button
        onClick={onSave}
        title={alreadySaved ? `Already saved as "${alreadySaved.name}"` : isDefault ? 'Apply filters first, then save the view' : 'Save the current filter combination as a named view'}
        style={{
          backgroundColor: alreadySaved ? '#22D3EE20' : 'transparent',
          border: `1px solid ${alreadySaved ? 'var(--mc-cyan)' : 'var(--mc-border-1)'}`,
          color: alreadySaved ? 'var(--mc-cyan)' : '#6B7B8C',
          borderRadius: 5, padding: '4px 8px', cursor: isDefault ? 'not-allowed' : 'pointer',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
          opacity: isDefault ? 0.5 : 1,
        }}
      >{alreadySaved ? '★ SAVED' : '☆ SAVE VIEW'}</button>
      <button
        onClick={() => setOpen(v => !v)}
        title={`${views.length} saved view${views.length === 1 ? '' : 's'}`}
        style={{
          backgroundColor: open ? '#22D3EE20' : 'transparent',
          border: `1px solid ${open ? 'var(--mc-cyan)' : 'var(--mc-border-1)'}`,
          color: open ? 'var(--mc-cyan)' : '#6B7B8C',
          borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
        }}
      >VIEWS ({views.length}) {open ? '▴' : '▾'}</button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50,
            backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: 8,
            padding: 6, minWidth: 280, maxWidth: 360, maxHeight: 320, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {views.length === 0 ? (
            <div style={{ padding: '12px 10px', fontSize: 11, color: '#6B7B8C' }}>
              No saved views yet. Apply some filters and click ☆ SAVE VIEW.
            </div>
          ) : (
            views.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 4, borderRadius: 5 }}>
                <button
                  onClick={() => onApply(v)}
                  style={{
                    flex: 1, textAlign: 'left',
                    backgroundColor: 'transparent', border: 'none',
                    color: 'var(--mc-text-0)', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', padding: '4px 6px',
                  }}
                  title={`Apply view\n${v.query || '(default)'}`}
                >
                  <div>{v.name}</div>
                  <div style={{ fontSize: 9, color: '#6B7B8C', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                    {v.query.length > 50 ? v.query.slice(0, 48) + '…' : v.query || '(default)'}
                  </div>
                </button>
                <button onClick={() => onRename(v)} title="Rename" style={{ background: 'none', border: 'none', color: '#6B7B8C', fontSize: 11, cursor: 'pointer', padding: '2px 4px' }}>✎</button>
                <button onClick={() => onDelete(v)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--mc-bearish)', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}>✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

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
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
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

  const articles = useMemo(() => {
    const now = Date.now();
    // PATCH 0121 — IMP-08: Q4 FY26 earnings season chip forces article_type=EARNINGS
    const effectiveType = earningsSeasonActive ? 'EARNINGS' : articleType;
    const base = filterArticles(allArticles || [], region, effectiveType, signalFilter, sourceName);

    const filtered = base.filter(a => {
      if (!isMarketRelevant(a)) return false;
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
      const recency = (() => {
        try {
          const age = (Date.now() - new Date(a.published_at).getTime()) / (1000 * 60 * 60);
          return Math.max(0, 3 - age / 24); // 3 points today, 0 after ~3 days
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
      const adjusted = total * srcW * noise.qualityMultiplier;
      (a as any).__priority = Math.round(adjusted * 10) / 10;
      (a as any).__priorityParts = { ...parts, source_weight: srcW, noise_mult: noise.qualityMultiplier };
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
        <div style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '10px 14px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: marketBias.hotTickers.length > 0 ? '8px' : '0' }}>
            {/* Bias pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--mc-text-4)', letterSpacing: '0.5px' }}>TODAY</span>
              <span style={{
                fontSize: '11px', fontWeight: '800', padding: '3px 10px', borderRadius: '6px',
                backgroundColor: marketBias.bias === 'Bullish' ? '#10B98120' : marketBias.bias === 'Bearish' ? '#EF444420' : '#F59E0B14',
                color: marketBias.bias === 'Bullish' ? 'var(--mc-bullish)' : marketBias.bias === 'Bearish' ? 'var(--mc-bearish)' : 'var(--mc-warn)',
                border: `1px solid ${marketBias.bias === 'Bullish' ? '#10B98130' : marketBias.bias === 'Bearish' ? '#EF444430' : '#F59E0B30'}`,
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
              <span style={{ color: '#2A3B4C', marginLeft: '4px' }}>|</span>
              <span style={{ color: 'var(--mc-text-4)' }}>{marketBias.total} stories</span>
              {marketBias.highImpact > 0 && (
                <><span style={{ color: '#2A3B4C', marginLeft: '4px' }}>|</span>
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
                    backgroundColor: count >= 5 ? '#EF444418' : count >= 3 ? '#F59E0B14' : '#0F7ABF14',
                    color: count >= 5 ? 'var(--mc-bearish)' : count >= 3 ? 'var(--mc-warn)' : 'var(--mc-accent)',
                    border: `1px solid ${count >= 5 ? '#EF444430' : count >= 3 ? '#F59E0B30' : '#0F7ABF30'}`,
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

      {/* ── IN PLAY TODAY bar ─────────────────────────────────────────── */}
      {!inPlayLoading && (
        <div
          style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '12px', padding: '10px 12px', marginBottom: '12px', overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '10px' }}
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
                    <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#EF444420', color: 'var(--mc-bearish)', padding: '1px 5px', borderRadius: '4px', border: '1px solid #EF444440' }}>
                      {syms[0]}
                      {mentionCount && mentionCount > 1 && (
                        <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.85, fontWeight: 600 }}>×{mentionCount}</span>
                      )}
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: '#C9D4E0' }}>
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
        <div style={{ height: '36px', backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '12px', marginBottom: '16px' }} className="animate-shimmer" />
      )}

      {/* ── PHASE 1.3: MUST READ — Curated top 5 ─────────────────────── */}
      {mustRead && mustRead.length > 0 && (
        <div style={{
          backgroundColor: '#0F1B2E', border: '1px solid #2A3B4C',
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
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', padding: '1px 5px', borderRadius: '3px', border: '1px solid #0F7ABF40' }}>
                      {syms[0]}
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: 'var(--mc-text-1)', flex: 1, lineHeight: 1.4 }}>
                    {getTitle(art)}
                  </span>
                  {(art as any).specific_impact?.label && (
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#38A9E8', backgroundColor: '#0F7ABF15', padding: '1px 6px', borderRadius: '3px', border: '1px solid #0F7ABF30' }}>
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
          backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)',
          borderLeft: '4px solid #8B5CF6',
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
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#8B5CF6', letterSpacing: '0.8px' }}>
              🌟 TRANSFORMATIONAL CONTRACTS
            </span>
            <span style={{ fontSize: '13px', color: 'var(--mc-text-4)' }}>
              {transformationalPreview.total_in_ledger || transformationalPreview.count} qualifying contracts in last {transformationalPreview.window_days || 180} days
            </span>
            <a
              href="/strategic-visibility"
              onClick={(e) => e.stopPropagation()}
              style={{
                marginLeft: 8, fontSize: '13px', fontWeight: 700, color: 'var(--mc-cyan)',
                textDecoration: 'none', backgroundColor: '#22D3EE15',
                border: '1px solid #22D3EE40', borderRadius: 5, padding: '3px 10px',
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
                    backgroundColor: '#0A1422', border: '1px solid var(--mc-bg-4)',
                    borderRadius: 12, padding: '14px 18px',
                    textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    {(a.ticker_symbols ?? []).slice(0, 2).map((t) => (
                      // PATCH 0085: ticker chips 9 → 13
                      <span key={t} style={{ fontSize: 13, fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', padding: '3px 8px', borderRadius: 4, border: '1px solid #0F7ABF40' }}>
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
                    {a.strategic_visibility.flags.includes('STRATEGIC_CHOKEPOINT') && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#8B5CF6' }}>🔒</span>
                    )}
                    {a.strategic_visibility.flags.includes('POLICY_BACKED') && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-cyan)' }}>🧭</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mc-text-3)', fontWeight: 600 }}>
                      {a.published_at ? new Date(a.published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
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
          backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)',
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
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#8899AA', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
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
                          <span style={{ color: '#8899AA', fontFamily: 'monospace', flexShrink: 0 }}>
                            {ev.date.slice(5)}
                          </span>
                          {ev.region && (
                            <span style={{ color: ev.region === 'IN' ? '#fbbf24' : '#7dd3fc', fontSize: '9px' }}>
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
          backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)',
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
                <div style={{ color: '#8899AA', marginLeft: '24px', marginTop: '2px', fontSize: '10px' }}>
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
            style={{ backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '8px', padding: '7px 12px', color: 'var(--mc-text-0)', fontSize: '14px', minWidth: '160px', width: '200px', outline: 'none', flexShrink: 0 }}
          />
          <button
            onClick={() => { setArticleType(articleType === 'BOTTLENECK' ? 'ALL' : 'BOTTLENECK'); setBottleneckLevel('ALL'); setBottleneckCategory('ALL'); setStructuralOnly(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: articleType === 'BOTTLENECK' ? '#EF444420' : 'var(--mc-bg-2)', border: `1px solid ${articleType === 'BOTTLENECK' ? 'var(--mc-bearish)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: articleType === 'BOTTLENECK' ? 'var(--mc-bearish)' : '#8A95A3', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show critical bottleneck news (GPU, Memory, Photonics, Power, etc.)"
          >
            BOTTLENECKS
          </button>
          <button
            onClick={() => setRegion(region === 'IN' ? 'ALL' : 'IN')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: region === 'IN' ? '#0F7ABF20' : 'var(--mc-bg-2)', border: `1px solid ${region === 'IN' ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: region === 'IN' ? 'var(--mc-accent)' : '#8A95A3', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
            title="Show only India news"
          >
            🇮🇳 India
          </button>
          <button
            onClick={() => setRegion(region === 'US' ? 'ALL' : 'US')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: region === 'US' ? '#0F7ABF20' : 'var(--mc-bg-2)', border: `1px solid ${region === 'US' ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, borderRadius: '8px', padding: '7px 12px', color: region === 'US' ? 'var(--mc-accent)' : '#8A95A3', fontSize: '12px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, minHeight: '36px' }}
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
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${region === r ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: region === r ? '#0F7ABF20' : 'transparent', color: region === r ? 'var(--mc-accent)' : '#8A95A3' }}>
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
                    style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${articleType === t ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: articleType === t ? '#0F7ABF20' : 'transparent', color: articleType === t ? 'var(--mc-accent)' : '#8A95A3' }}>
                    {t === 'ALL' ? 'All' : t.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
            {/* PATCH 0121 — IMP-08: Q4 FY26 Earnings Season quick filter */}
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>EARNINGS SEASON</p>
              <button onClick={() => setEarningsSeasonActive(v => !v)}
                style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${earningsSeasonActive ? 'var(--mc-bullish)' : 'var(--mc-border-1)'}`, backgroundColor: earningsSeasonActive ? '#10B98120' : 'transparent', color: earningsSeasonActive ? 'var(--mc-bullish)' : '#8A95A3' }}
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
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${strategyFilter === s.v ? s.color : 'var(--mc-border-1)'}`, backgroundColor: strategyFilter === s.v ? s.color + '20' : 'transparent', color: strategyFilter === s.v ? s.color : '#8A95A3' }}
                    title={`Show only articles tagged ${s.label}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--mc-text-4)', margin: '0 0 8px', letterSpacing: '0.5px' }}>SIGNAL STRENGTH</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                {SIGNAL_FILTERS.map(s => (
                  <button key={s.value} onClick={() => setSignalFilter(s.value)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${signalFilter === s.value ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: signalFilter === s.value ? '#0F7ABF20' : 'transparent', color: signalFilter === s.value ? 'var(--mc-accent)' : '#8A95A3' }}>
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
                    style={{ padding: '5px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600', cursor: 'pointer', border: `1px solid ${sourceName === s ? 'var(--mc-accent)' : 'var(--mc-border-1)'}`, backgroundColor: sourceName === s ? '#0F7ABF20' : 'transparent', color: sourceName === s ? 'var(--mc-accent)' : '#8A95A3' }}>
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
            backgroundColor: '#0D1B2E', border: '1px solid #EF444440', borderRadius: '12px',
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
                    border: `1px solid ${sortBy === 'impact' ? '#F59E0B60' : 'var(--mc-border-1)'}`,
                    backgroundColor: sortBy === 'impact' ? '#F59E0B15' : 'transparent',
                    color: sortBy === 'impact' ? 'var(--mc-warn)' : '#8A95A3',
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
                    border: `1px solid ${structuralOnly ? '#8B5CF660' : 'var(--mc-border-1)'}`,
                    backgroundColor: structuralOnly ? '#8B5CF615' : 'transparent',
                    color: structuralOnly ? '#8B5CF6' : '#8A95A3',
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
                      color: isActive ? lvl.color : '#8A95A3',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {lvl.icon && <span style={{ fontSize: '8px' }}>{lvl.icon}</span>}
                    {lvl.label}
                    <span style={{
                      fontSize: '9px', fontWeight: '700',
                      padding: '1px 5px', borderRadius: '4px',
                      backgroundColor: isActive ? `${lvl.color}20` : '#1E2D4580',
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
                      border: `1px solid ${isActive ? '#8B5CF6' : 'var(--mc-border-1)'}`,
                      backgroundColor: isActive ? '#8B5CF615' : 'transparent',
                      color: isActive ? '#8B5CF6' : '#8A95A3',
                    }}
                  >
                    {cat.icon && <span style={{ fontSize: '9px' }}>{cat.icon}</span>}
                    {cat.label}
                    <span style={{
                      fontSize: '9px', fontWeight: '700',
                      padding: '1px 4px', borderRadius: '3px',
                      backgroundColor: isActive ? '#8B5CF620' : '#1E2D4580',
                      color: isActive ? '#8B5CF6' : 'var(--mc-text-4)',
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
                backgroundColor: '#8B5CF610', border: '1px solid #8B5CF640',
                borderRadius: '10px', padding: '10px 14px', marginBottom: '10px',
                cursor: 'pointer', textAlign: 'left', color: '#C9D4E0',
              }}
            >
              <span style={{ fontSize: '20px' }}>{BOTTLENECK_DRILLDOWN[bottleneckCategory].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#8B5CF6' }}>
                  {BOTTLENECK_DRILLDOWN[bottleneckCategory].label} · Analysis
                </div>
                <div style={{ fontSize: '10px', color: '#8A95A3' }}>
                  Click for supply/demand breakdown and listed companies impacted
                </div>
              </div>
              <ChevronRight style={{ width: '14px', height: '14px', color: '#8B5CF6' }} />
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', padding: '8px 12px', backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderRadius: '10px', flexWrap: 'wrap' }}>
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
            style={{ fontSize: '11px', fontWeight: '600', cursor: 'pointer', borderRadius: '6px', padding: '1px 7px', backgroundColor: signalFilter === 'LOW' ? '#8A95A318' : 'transparent', border: `1px solid ${signalFilter === 'LOW' ? '#8A95A360' : 'transparent'}`, color: '#8A95A3' }}
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
              backgroundColor: sortBy === 'impact' ? '#F59E0B15' : '#22D3EE15',
              border: `1px solid ${sortBy === 'impact' ? '#F59E0B60' : '#22D3EE60'}`,
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
            style={{ fontSize: '10px', fontWeight: '600', color: groupByLayer ? 'var(--mc-accent)' : 'var(--mc-text-4)', background: 'none', border: `1px solid ${groupByLayer ? '#0F7ABF40' : 'var(--mc-border-1)'}`, borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}
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
                  {layerArticles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
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
            {articles.map(art => <NewsCard key={art.id} article={art} onSelect={setSelectedArticle} />)}
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
              backgroundColor: '#F59E0B0A',
              border: '1px solid #F59E0B30',
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
          backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)',
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
                  color: '#0A1422',
                  border: '1px solid #FBBF24',
                  backgroundColor: '#FBBF24',
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
                            color: '#0A1422',
                            backgroundColor: '#FBBF24',
                            border: '1px solid #FBBF24',
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
                    backgroundColor: '#0A1422', border: '1px solid var(--mc-bg-4)',
                    borderRadius: 12, padding: '14px 18px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      {/* PATCH 0085: card title 11 → 17 */}
                      <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--mc-text-0)', letterSpacing: '0.3px' }}>
                        {showLabel}
                      </span>
                      {b.is_structural && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#8B5CF6', border: '1px solid #8B5CF640', backgroundColor: '#8B5CF610', padding: '2px 6px', borderRadius: 4 }}>
                          STRUCTURAL
                        </span>
                      )}
                      {/* PATCH 0088: LATEST pill — bottleneck first detected ≤10d ago */}
                      {b.is_latest && (
                        <span
                          title={`First detected ${b.first_seen_age_days ?? '?'} day${b.first_seen_age_days === 1 ? '' : 's'} ago. Surfaces at top of panel for the first 10 days, then drops to confidence/structural ranking.`}
                          style={{
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.4px',
                            color: '#0A1422',
                            backgroundColor: '#FBBF24',
                            border: '1px solid #FBBF24',
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
