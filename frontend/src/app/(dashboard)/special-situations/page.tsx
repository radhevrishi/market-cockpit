'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL SITUATIONS — FULLY AUTOMATED (patch 0099)
//
// NO HARDCODED EVENTS.  Everything on this page is either (a) live data
// pulled from /api/v1/special-situations/feed, (b) algorithmic
// classification logic, or (c) universal investing rules / pure-math
// calculators.
//
// Removed in 0099: the 5-event CURATED_EVENTS hardcoded array (Vedanta /
// Wipro / Honeywell / QXO / Adobe).  Per-company analysis was institutional
// quality but inherently stale.
//
// Tabs:
//   ALL SITUATIONS — algorithmically tier-grouped live events
//   WHEN TO BUY/SELL — universal investing rules (not per-company)
//   POST-EVENT PLAYBOOK — universal J-curve + hold/sell rules
//   ACCEPTANCE / DEAL MATH — interactive calculators (pure formulae)
//   DISCOVER — raw RSS scanner with source health diagnostics
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { computeMergerArb, fmtPct } from '@/lib/merger-arb';
// PATCH 0328 — Wire lifecycle + playbook intelligence into event cards
import { getPlaybook } from '@/lib/specsit-playbooks';
import type { LifecycleState } from '@/lib/special-sit-lifecycle';
import { LIFECYCLE_CONFIG } from '@/lib/special-sit-lifecycle';
// PATCH 0353 — Phase 1 institutional rebuild: wire deal-probability for
// per-row prob chip + the Best Risk/Reward leaderboard at top of feed.
import { computeDealProbability } from '@/lib/deal-probability';
import type { FilingTier } from '@/lib/deal-probability';
// PATCH 0254 — Source-tier classifier (PRIMARY / SPECIALIST / SECONDARY / AGGREGATOR)
import { classifySource, TIER_VISUAL } from '@/lib/source-tiers';

/** PATCH 0258 — Next-catalyst inference. If the payload has an explicit
 *  next_catalyst field, use it. Otherwise fall back to event-type-specific
 *  conventions (open offer opens 30d after announcement, etc.).
 *  Returns null when nothing reasonable can be inferred. */
function nextCatalystFor(ev: any): { label: string; daysOut: number | null } | null {
  if (ev.next_catalyst_date) {
    try {
      const dt = new Date(ev.next_catalyst_date);
      const days = Math.round((dt.getTime() - Date.now()) / 86400_000);
      const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      if (days < 0) {
        // Date already passed — say so instead of showing a stale countdown.
        const verb = /open/i.test(ev.next_catalyst_label || '') ? 'opened' : 'passed';
        return { label: `${ev.next_catalyst_label || 'Next catalyst'}: ${verb} ${dateStr}`, daysOut: null };
      }
      return { label: `${ev.next_catalyst_label || 'Next catalyst'}: ${dateStr}`, daysOut: days };
    } catch {}
  }
  // Event-type heuristic from typical Indian/US conventions
  const map: Record<string, { label: string; days: number }> = {
    OPEN_OFFER:          { label: 'Open offer typically opens',   days: 30 },
    TENDER_OFFER:        { label: 'Tender expected to close',      days: 35 },
    BUYBACK_TENDER:      { label: 'Buyback record date typical',   days: 21 },
    BUYBACK:             { label: 'Record date typically',         days: 30 },
    GOING_PRIVATE:       { label: 'Delisting offer typical',       days: 90 },
    MERGER_DEFINITIVE:   { label: 'Regulatory review ~',           days: 180 },
    ACQUISITION_PUBLIC:  { label: 'Close target',                   days: 180 },
    SPIN_OFF:            { label: 'Record date typical',           days: 120 },
    DEMERGER_INDIA:      { label: 'NCLT + record date',            days: 120 },
    IPO_SUBSIDIARY:      { label: 'IPO typical window',            days: 90 },
    NCLT_RESOLUTION:     { label: 'NCLT decision typical',         days: 45 },
    INDEX_INCLUSION:     { label: 'Effective date',                days: 30 },
  };
  const m = map[ev.event_type];
  if (m) {
    const dt = new Date(Date.now() + m.days * 86400_000);
    return { label: `${m.label} ${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} (~${m.days}d est.)`, daysOut: m.days };
  }
  return null;
}

/** PATCH 0259 — Decay color for the age chip based on event-specific
 *  half-life. Tender offers decay fastest, mergers slowest. */
function ageColorFor(eventType: string, ageHours: number): string {
  const halfLifeDays: Record<string, number> = {
    TENDER_OFFER: 15, BUYBACK_TENDER: 15, OPEN_OFFER: 21, GOING_PRIVATE: 30,
    MERGER_DEFINITIVE: 60, ACQUISITION_PUBLIC: 60,
    SPIN_OFF: 45, DEMERGER_INDIA: 45, IPO_SUBSIDIARY: 30,
    BUYBACK: 30, NCLT_RESOLUTION: 30, INDEX_INCLUSION: 14,
    PREFERENTIAL_ALLOTMENT: 30, PROMOTER_STAKE_UP: 60,
  };
  const hl = (halfLifeDays[eventType] || 30) * 24;
  const ratio = ageHours / hl;
  if (ratio < 0.3) return '#10B981';  // fresh
  if (ratio < 0.7) return '#22D3EE';  // warm
  if (ratio < 1.0) return '#F59E0B';  // aging
  return '#EF4444';                    // expired
}

/** PATCH 0260 — India-specific sub-category refinement from headline. */
function inferIndiaSubcategory(title: string, eventType: string): string | null {
  const t = (title || '').toLowerCase();
  if (/preferential\s+allotment|preferential\s+issue/.test(t)) return 'Preferential allotment';
  if (/warrant.*convert|warrants?\s+conversion/.test(t)) return 'Warrants conversion';
  if (/\bofs\b|offer for sale/.test(t)) return 'OFS (offer for sale)';
  if (/promoter.*(stake|holding).*(increase|up|hike|rise)|promoter\s+buy/.test(t)) return 'Promoter stake hike';
  if (/(nclt|insolvency|resolution\s+plan|cirp)/.test(t)) return 'NCLT / CIRP';
  if (/delist(ing)?/.test(t)) return 'Delisting attempt';
  if (/sme\s+(migration|to\s+main)/.test(t)) return 'SME → Main Board';
  if (/(index\s+inclusion|added to|joining\s+nifty|joining\s+bse)/.test(t)) return 'Index inclusion';
  if (/(index\s+exclusion|removed from)/.test(t)) return 'Index exclusion';
  if (/holding\s+company|hold\s*co|holdco/.test(t)) return 'HoldCo discount';
  if (/sum.?of.?parts|sotp/.test(t)) return 'SoP arbitrage';
  if (/qip|qualified\s+institutional/.test(t)) return 'QIP';
  if (/rights\s+issue/.test(t)) return 'Rights issue';
  return null;
}

/** PATCH 0254 — Map an event_type to its likely institutional alpha source.
 *  Surfaced as a single inline tag so users know WHY this event is tradable
 *  before reading the full card. */
function expectedAlphaFor(eventType: string): { label: string; tone: { solid: string; bg: string; border: string }; typicalIRR?: string } | null {
  // AUDIT_100 #74 — surface historical typical-IRR per event_type for
  // institutional benchmarking. Numbers are static lookups from common
  // arbitrage research (p25/p50/p75 of net IRR after close); not live.
  const yellow = { solid: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' };
  const cyan   = { solid: '#22D3EE', bg: '#22D3EE15', border: '#22D3EE40' };
  const green  = { solid: '#10B981', bg: '#10B98115', border: '#10B98140' };
  const violet = { solid: '#A78BFA', bg: '#A78BFA15', border: '#A78BFA40' };
  const map: Record<string, { label: string; tone: typeof yellow; typicalIRR?: string }> = {
    OPEN_OFFER:           { label: 'Spread capture',         tone: cyan,   typicalIRR: '6-12-20% (p25-p50-p75)' },
    TENDER_OFFER:         { label: 'Spread capture',         tone: cyan,   typicalIRR: '5-10-18%' },
    BUYBACK_TENDER:       { label: 'Spread + odd-lot capture', tone: cyan, typicalIRR: '4-9-16%' },
    BUYBACK:              { label: 'Float reduction',        tone: green,  typicalIRR: '2-5-12% over 60-90d' },
    GOING_PRIVATE:        { label: 'Spread + forced exit',   tone: cyan,   typicalIRR: '8-15-25%' },
    MERGER_DEFINITIVE:    { label: 'Spread capture',         tone: cyan,   typicalIRR: '4-8-15%' },
    ACQUISITION_PUBLIC:   { label: 'Spread capture',         tone: cyan,   typicalIRR: '5-10-18%' },
    SPIN_OFF:             { label: 'SoP unlock + re-rating', tone: violet, typicalIRR: '12-25-45% over 6-12mo' },
    DEMERGER_INDIA:       { label: 'HoldCo discount → SoP',  tone: violet, typicalIRR: '10-20-40% over 6-12mo' },
    IPO_SUBSIDIARY:       { label: 'SoP unlock',             tone: violet, typicalIRR: '8-15-30%' },
    PREFERENTIAL_ALLOTMENT: { label: 'Conviction signal · float +', tone: yellow, typicalIRR: '5-15-35% over 12mo' },
    PROMOTER_STAKE_UP:    { label: 'Insider conviction',     tone: yellow, typicalIRR: '8-18-30% over 12mo' },
    INDEX_INCLUSION:      { label: 'Forced buying',          tone: green,  typicalIRR: '3-8-15% in 30d window' },
    INDEX_EXCLUSION:      { label: 'Forced selling',         tone: green,  typicalIRR: '-12 to -5 to -2% in 30d (mean-revert after)' },
    DELISTING:            { label: 'Forced delisting price', tone: cyan,   typicalIRR: '10-25-50% over 6-18mo' },
    NCLT_RESOLUTION:      { label: 'Distressed re-rating',   tone: violet, typicalIRR: '-50 to 30 to 150% (wide variance)' },
    REVERSE_MERGER:       { label: 'Backdoor listing',       tone: violet, typicalIRR: '10-30-70% wide variance' },
  };
  return map[eventType] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0167 — Rejected Reasons (persistent per-event notes)
// localStorage backed.  Survives every "Refresh" / "Clear" action.  Only
// removable via the explicit delete (✕) icon on the rejection chip.
// ═══════════════════════════════════════════════════════════════════════════
const REJECTED_LS_KEY = 'mc:specsit:rejected:v1';
interface RejectionRecord { reason: string; ts: number; }
type RejectionMap = Record<string, RejectionRecord>;

// PATCH 0453 P1-20 — Audit found this rejection map grew unbounded — over
// a year of usage it could blow past the 5MB localStorage cap. Prune
// entries older than 365 days on load so the user's reject decisions
// auto-expire when the event is long-gone.
const REJECTION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
function loadRejections(): RejectionMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REJECTED_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RejectionMap;
    const now = Date.now();
    const pruned: RejectionMap = {};
    let prunedAny = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (v?.ts && now - v.ts < REJECTION_MAX_AGE_MS) pruned[k] = v;
      else prunedAny = true;
    }
    // Persist the pruned map so the prune happens at most once per session.
    if (prunedAny) {
      try { window.localStorage.setItem(REJECTED_LS_KEY, JSON.stringify(pruned)); } catch {}
    }
    return pruned;
  } catch { return {}; }
}
function saveRejections(map: RejectionMap) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(REJECTED_LS_KEY, JSON.stringify(map)); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE FEED — single source of truth
// ═══════════════════════════════════════════════════════════════════════════

// PATCH 0532 — Added CAPEX (Capacity Expansion / New Ventures) and CONCALL
// (First Presentation / Concall) categories. Mirrors backend.
type Category = 'SPIN' | 'MA' | 'TURN' | 'CAP' | 'CAPEX' | 'CONCALL';

interface LiveFeedItem {
  id: string;
  title: string;
  link: string;
  source: string;
  region: 'IN' | 'US' | 'GLOBAL';
  pub_date: string;
  age_hours: number;
  category: Category;
  category_label: string;
  tickers: string[];
  description?: string;
}

// PATCH 0105: canonical event from event-intelligence pipeline
interface CanonicalEvent {
  event_id: string;
  event_type: string;
  category: Category;
  target_name?: string;
  primary_filing: LiveFeedItem;
  amendments: LiveFeedItem[];
  amendment_count: number;
  filings: LiveFeedItem[];
  catalyst_score: { raw_score: number; decay_score: number; components: Array<{ label: string; pts: number }> };
  is_tradable: boolean;
  tier: 'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE';
  tradability_rationale: string;
  why_tradable: { what_happened: string; what_matters: string; what_to_watch: string; what_breaks_thesis: string };
  lifecycle: 'rumor' | 'announced' | 'amended' | 'approved' | 'closed' | 'unknown';
  region: 'IN' | 'US' | 'GLOBAL';
  tickers: string[];
  is_fund: boolean;
  primary_source: boolean;
  age_hours: number;
}

interface LiveFeedResp {
  last_updated: string;
  total: number;
  by_category: Record<Category, LiveFeedItem[]>;
  source_status: Array<{ name: string; ok: boolean; items?: number }>;
  cached?: boolean;
  cache_age_min?: number;
  // PATCH 0105
  events?: CanonicalEvent[];
  by_tier?: Record<'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE', number>;
  // PATCH 0431 — institutional diagnostics
  coverage_diagnostic?: Array<{
    bucket: string;
    emoji: string;
    event_types: string[];
    count: number;
    note: string;
  }>;
  event_type_counts?: Record<string, number>;
}

// PATCH 0437 BUG-029 — localStorage cache prime so the page doesn't flash
// all-zeros on cold load. We store the last successful feed payload and
// serve it as initialData; React Query then refetches in background.
const SPECSIT_LS_KEY = 'mc:specsit:lastfeed:v1';

function useLiveFeed() {
  return useQuery<LiveFeedResp>({
    queryKey: ['special-situations', 'live-feed'],
    queryFn: async () => {
      const { data } = await api.get('/special-situations/feed');
      // Prime LS cache for next cold load
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(SPECSIT_LS_KEY, JSON.stringify({ data, ts: Date.now() }));
        }
      } catch {}
      return data;
    },
    initialData: (() => {
      // PATCH 0437 BUG-029 — read last known feed from LS so initial render
      // is never "all zeros". Eliminates the 5-second blank-cockpit window.
      if (typeof window === 'undefined') return undefined;
      try {
        const raw = window.localStorage.getItem(SPECSIT_LS_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        // Only use if less than 6 hours old — older than that, prefer fresh
        if (Date.now() - (parsed.ts || 0) > 6 * 3600_000) return undefined;
        return parsed.data;
      } catch { return undefined; }
    })(),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ALGORITHMIC TIER CLASSIFICATION (no hardcoding)
//
// Tier 1 (Hard catalyst): event within last 14 days AND has ≥1 ticker AND
//                         type ∈ {SPIN, MA, CAP-tender}
// Tier 2 (Watchlist):     event within 30 days (anything else)
// Archive:                older — kept for pattern reference
//
// Pure algorithmic scoring — no per-company logic.
// ═══════════════════════════════════════════════════════════════════════════

type Tier = 'TIER_1' | 'TIER_2' | 'ARCHIVE';

interface ScoredEvent extends LiveFeedItem {
  score: number;        // 0-100, algorithmic
  tier: Tier;
  freshness: 'TODAY' | 'THIS_WEEK' | 'RECENT' | 'OLDER';
}

function scoreEvent(it: LiveFeedItem): { score: number; tier: Tier; freshness: ScoredEvent['freshness'] } {
  let score = 0;
  // Freshness component (0-40)
  let freshness: ScoredEvent['freshness'] = 'OLDER';
  if (it.age_hours <= 24) { score += 40; freshness = 'TODAY'; }
  else if (it.age_hours <= 7 * 24) { score += 30; freshness = 'THIS_WEEK'; }
  else if (it.age_hours <= 30 * 24) { score += 18; freshness = 'RECENT'; }
  else { score += 5; freshness = 'OLDER'; }

  // Type component (0-30)
  if (it.category === 'SPIN') score += 30;        // hardest catalyst — fixed record date
  else if (it.category === 'MA') score += 28;     // hard cash spread / open offer
  else if (it.category === 'CAP') score += 22;    // tender buybacks have date; open-market doesn't
  else score += 15;                                // TURN — softer

  // Ticker specificity (0-20)
  score += Math.min(20, it.tickers.length * 7);

  // Source institutional weight (0-10)
  const SRC_WEIGHT: Record<string, number> = {
    'Reuters Business': 10, 'Reuters Tech': 9, 'BS Companies': 9,
    'BS Markets': 8, 'Livemint Companies': 8, 'ET Markets': 8,
    'ET Industry': 7, 'NDTV Profit': 7, 'MarketWatch Top': 7,
    'CNBC Top': 7, 'CNBC Finance': 7, 'MarketWatch Mkts': 6,
    'SeekingAlpha News': 6, 'Yahoo Finance': 5,
  };
  score += SRC_WEIGHT[it.source] ?? 5;

  // Tier assignment — pure thresholds
  let tier: Tier = 'ARCHIVE';
  const isHardCatalyst = (it.category === 'SPIN' || it.category === 'MA' || it.category === 'CAP') &&
                         it.age_hours <= 14 * 24 &&
                         it.tickers.length >= 1;
  if (isHardCatalyst) tier = 'TIER_1';
  else if (it.age_hours <= 30 * 24) tier = 'TIER_2';
  else tier = 'ARCHIVE';

  return { score, tier, freshness };
}

const CAT_META: Record<Category, { label: string; color: string; icon: string }> = {
  SPIN:    { label: 'Spin-off / Demerger',                color: '#22D3EE', icon: '🔀' },
  MA:      { label: 'M&A / Open Offer / Acquisition',     color: '#FBBF24', icon: '🤝' },
  TURN:    { label: 'Turnaround',                         color: '#10B981', icon: '↩️' },
  CAP:     { label: 'Capital Allocation / Fund Raising',  color: '#A78BFA', icon: '💰' },
  // PATCH 0532 — new categories
  CAPEX:   { label: 'Capacity Expansion / New Venture',   color: '#F97316', icon: '🏭' },
  CONCALL: { label: 'First Presentation / Concall',       color: '#60A5FA', icon: '🎙' },
};

const TIER_META: Record<Tier, { label: string; color: string; tagline: string }> = {
  TIER_1:  { label: 'Tier 1 — Hard Catalyst (≤14d, has ticker)', color: '#EF4444', tagline: 'Recent + named ticker + actionable type' },
  TIER_2:  { label: 'Tier 2 — Watchlist (≤30d)',                  color: '#F59E0B', tagline: 'Recent but lower signal' },
  ARCHIVE: { label: 'Archive (>30d)',                              color: '#6B7A8D', tagline: 'Reference / pattern catalogue' },
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

type Tab = 'all' | 'analytics' | 'timing' | 'playbook' | 'math' | 'discover';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'all',       label: 'All Situations' },
  // PATCH 0584 — Special Situations Analytics (mirrors Multibagger Analytics).
  // Wraps the existing merger-arb / deal-probability / playbook libs into a
  // single ranked dashboard: best risk/reward, break-risk flags, catalyst
  // timeline, category distribution, source-tier mix, position sizing.
  { id: 'analytics', label: '📊 Analytics' },
  { id: 'timing',    label: 'When to Buy / Sell' },
  { id: 'playbook',  label: 'Post-Event Playbook' },
  { id: 'math',      label: 'Acceptance / Deal Math' },
  { id: 'discover',  label: 'Discover (raw RSS)' },
];

export default function SpecialSituationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (searchParams?.get('tab') as Tab) || 'all';
  const [active, setActive] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'all');
  const [region, setRegion] = useState<'ALL' | 'IN' | 'US' | 'GLOBAL'>('ALL');
  // PATCH 0252 — Clickable tier/category filters. Clicking a Stat box toggles
  // the filter; multiple categories may be selected (OR semantics).
  const [tierFilter, setTierFilter] = useState<'ALL' | 'TIER_1' | 'TIER_2' | 'WATCHLIST'>('ALL');
  // AUDIT_100 #32 — show-only-monitored toggle so users can review what they
  // previously flagged-for-monitor without restoring each one. Pure UI filter,
  // reads from the same REJECTED_LS_KEY localStorage map the card uses.
  const [monitoredOnly, setMonitoredOnly] = useState<boolean>(false);
  const [monitoredMapTick, setMonitoredMapTick] = useState<number>(0);
  // Re-read rejections on tick so child-card "restore" propagates here too.
  const monitoredMap = useMemo<Record<string, { reason?: string; ts: number }>>(() => {
    void monitoredMapTick;
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(window.localStorage.getItem(REJECTED_LS_KEY) || '{}') as any; } catch { return {}; }
  }, [monitoredMapTick]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === REJECTED_LS_KEY) setMonitoredMapTick(t => t + 1); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const monitoredCount = useMemo(() => Object.keys(monitoredMap || {}).length, [monitoredMap]);
  const [catFilterSet, setCatFilterSet] = useState<Set<Category>>(new Set());
  // PATCH 0433 — Coverage-bucket filter (clickable institutional categories)
  const [coverageFilterSet, setCoverageFilterSet] = useState<Set<string>>(new Set());
  const toggleCat = (c: Category) => setCatFilterSet(prev => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  });
  const toggleCoverageBucket = (bucket: string) => setCoverageFilterSet(prev => {
    const next = new Set(prev);
    if (next.has(bucket)) next.delete(bucket); else next.add(bucket);
    return next;
  });
  const clearFilters = () => { setTierFilter('ALL'); setCatFilterSet(new Set()); setCoverageFilterSet(new Set()); };
  const anyFilterActive = tierFilter !== 'ALL' || catFilterSet.size > 0 || coverageFilterSet.size > 0;

  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/special-situations?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const { data: feed, isLoading, error, dataUpdatedAt, refetch, isFetching } = useLiveFeed();

  // PATCH 0105: PRIMARY data source is now feed.events (canonical events with
  // catalyst scoring, tradability filter, why_tradable blocks).  Old by_category
  // FeedItems are still produced for back-compat + the Discover tab.
  const canonicalEvents: CanonicalEvent[] = useMemo(() => {
    if (!feed?.events) return [];
    // PATCH 0257 — Client-side duplicate collapse. Same canonical event
    // reported by Yahoo + Reuters + Bloomberg syndicates produces N duplicate
    // rows. Group by (target_name + event_type + 7d date bucket) and keep
    // the highest-confidence row; stamp a `__source_count` on it so the
    // renderer can show '×N sources'.
    const filtered = feed.events.filter((e) => region === 'ALL' || e.region === region);
    const groups = new Map<string, CanonicalEvent[]>();
    for (const ev of filtered) {
      const pf = ev.primary_filing as any;
      const publishedAt = pf?.published_at || pf?.date || pf?.timestamp || null;
      const dateBucket = publishedAt
        ? Math.floor(new Date(publishedAt).getTime() / (7 * 86400_000))
        : 0;
      const target = (ev.target_name || ev.tickers[0] || '').trim().toLowerCase();
      const key = `${target}|${ev.event_type}|${dateBucket}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(ev);
      else groups.set(key, [ev]);
    }
    const deduped: CanonicalEvent[] = [];
    for (const bucket of groups.values()) {
      // Keep highest-score event in each bucket
      bucket.sort((a, b) => (b.catalyst_score?.decay_score ?? 0) - (a.catalyst_score?.decay_score ?? 0));
      const head = bucket[0];
      (head as any).__source_count = bucket.length;
      (head as any).__source_list = bucket.map(e => e.primary_filing?.source).filter(Boolean);
      deduped.push(head);
    }
    return deduped;
  }, [feed, region]);

  // PATCH 0433 — Map each event_type to its institutional coverage bucket
  // (mirrors lib/specsit-institutional.ts computeCoverageDiagnostic).
  const eventTypeToBucket = (et: string): string => {
    if (['TENDER_OFFER','MERGER_DEFINITIVE','MERGER_RECOMMENDATION','GOING_PRIVATE','OPEN_OFFER','ACQUISITION_PUBLIC'].includes(et)) return 'M&A / Merger Arb';
    if (['SPIN_OFF','DEMERGER_INDIA','IPO_SUBSIDIARY'].includes(et)) return 'Spin-offs / Demergers';
    if (['RIGHTS_ISSUE','RIGHTS_ISSUE_DEEP','CONVERTIBLE_PIPE','PROMOTER_BACKSTOP','QIP_PLACEMENT'].includes(et)) return 'Rights / Warrants / PIPE';
    if (['BUYBACK_TENDER','BUYBACK_OPEN_MARKET','DIVIDEND_HIKE'].includes(et)) return 'Buybacks / Capital Return';
    if (['ASSET_SALE_MONETIZATION','STAKE_SALE'].includes(et)) return 'Asset Sales / Monetization';
    if (['NCLT_IBC_ADMISSION','NCLT_IBC_RESOLUTION','TURNAROUND_OPERATING'].includes(et)) return 'NCLT / IBC / Distressed';
    if (['INDEX_INCLUSION','INDEX_EXCLUSION'].includes(et)) return 'Index Arbitrage';
    if (['HOLDCO_ARB_TRIGGER','STUB_TRADE_TRIGGER'].includes(et)) return 'HoldCo / Stub Trades';
    if (['GOVERNANCE_CRISIS','SEBI_REGULATORY_ACTION','AUDITOR_QUALIFIED','PROMOTER_PLEDGE_UNWIND'].includes(et)) return 'Governance / Regulatory';
    if (['BONUS_ISSUE','STOCK_SPLIT'].includes(et)) return 'Bonus / Split / Other';
    return '';
  };

  // PATCH 0252/0433 — Apply user-selected tier + category + coverage-bucket
  // filters before deriving tier1/tier2/watchlist lists. Counts stay computed
  // on `canonicalEvents` so the Stat boxes always show the total available;
  // only the rendered list shrinks.
  const filteredCanonicalEvents: CanonicalEvent[] = useMemo(() => {
    return canonicalEvents.filter((e) => {
      if (tierFilter !== 'ALL' && e.tier !== tierFilter) return false;
      if (catFilterSet.size > 0 && !catFilterSet.has(e.category as Category)) return false;
      if (coverageFilterSet.size > 0) {
        const bucket = eventTypeToBucket(String(e.event_type));
        if (!bucket || !coverageFilterSet.has(bucket)) return false;
      }
      // AUDIT_100 #32 — when toggled, render ONLY events the user previously
      // moved to MONITOR. Event id matches the localStorage key used by the card.
      if (monitoredOnly) {
        if (!monitoredMap[e.event_id]) return false;
      }
      return true;
    });
  }, [canonicalEvents, tierFilter, catFilterSet, coverageFilterSet, monitoredOnly, monitoredMap]);

  const tier1Canonical = filteredCanonicalEvents.filter((e) => e.tier === 'TIER_1');
  const tier2Canonical = filteredCanonicalEvents.filter((e) => e.tier === 'TIER_2');
  const watchlistCanonical = filteredCanonicalEvents.filter((e) => e.tier === 'WATCHLIST');
  // NOISE tier hidden from primary view (fund housekeeping, rumors, unclassified)

  // Legacy fallback: if events array is empty (cache pre-0105 deploy), fall back
  // to the old per-item algorithmic tier classification so the page never blanks.
  const allEvents: ScoredEvent[] = useMemo(() => {
    if (!feed || (feed.events && feed.events.length > 0)) return [];
    const flat = (Object.keys(feed.by_category) as Category[]).flatMap((c) => feed.by_category[c]);
    return flat
      .filter((it) => region === 'ALL' || it.region === region)
      .map((it) => ({ ...it, ...scoreEvent(it) }))
      .sort((a, b) => b.score - a.score);
  }, [feed, region]);

  const tier1 = allEvents.filter((e) => e.tier === 'TIER_1');
  const tier2 = allEvents.filter((e) => e.tier === 'TIER_2');
  const archive = allEvents.filter((e) => e.tier === 'ARCHIVE');

  const last = dataUpdatedAt ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60000)) : null;
  const liveColor = last == null ? '#6B7A8D'
    : last <= 30 ? '#10B981' : last <= 120 ? '#F59E0B' : '#EF4444';

  // Aggregate stats per Category for the header
  // PATCH 0109 — BUG-03 fix: badges read from canonical events when populated
  // (otherwise the top counters showed 0 while the list rendered items below).
  const catCounts: Record<Category, number> = { SPIN: 0, MA: 0, TURN: 0, CAP: 0, CAPEX: 0, CONCALL: 0 };
  // PATCH 0550 — guard against a runtime payload whose `e.category` isn't in
  // the Category union (e.g. a stale cache predating Patch 0532). Previously
  // `catCounts[unknown]++` produced NaN which then rendered as the string
  // "NaN" in chip labels.
  if (canonicalEvents.length > 0) {
    for (const e of canonicalEvents) {
      const c = e.category as Category;
      if (c in catCounts) catCounts[c]++;
    }
  } else {
    for (const e of allEvents) {
      if (e.category in catCounts) catCounts[e.category]++;
    }
  }
  // Tier counts that sync with whichever pipeline is rendering
  const tier1Count = canonicalEvents.length > 0 ? tier1Canonical.length : tier1.length;
  const tier2Count = canonicalEvents.length > 0 ? tier2Canonical.length : tier2.length;
  const tier3Count = canonicalEvents.length > 0 ? watchlistCanonical.length : archive.length;
  const tier3Label = canonicalEvents.length > 0 ? 'Watchlist' : 'Archive';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--mc-bg-0)' }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'var(--mc-bg-1)', borderBottom: '1px solid var(--mc-border-1)', padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>
            ⚡ SPECIAL SITUATIONS
          </span>
          <span style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>
            Fully automated · Live RSS discovery · Algorithmic tiering · No hardcoded events
          </span>
          <span
            title={dataUpdatedAt ? `Last refresh: ${new Date(dataUpdatedAt).toLocaleString()}` : 'Live'}
            style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', color: liveColor, border: `1px solid ${liveColor}50`, backgroundColor: `${liveColor}15`, padding: '2px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: liveColor, boxShadow: `0 0 6px ${liveColor}` }} />
            {last == null ? 'LIVE' : last === 0 ? 'LIVE · just now' : last < 60 ? `LIVE · ${last}m ago` : `${Math.round(last / 60)}h ago`}
          </span>
        </div>

        {/* Aggregate counts */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {/* PATCH 0252 — Clickable filters. Toggle on click; visual active state. */}
          {/* PATCH 0445 BUG-029 — `loading` prop drives shimmer on cold-load zeros. */}
          {/*
            PATCH 0965 UX — Tier 1/2 "why is this 0" tooltips.
            Root cause: a fresh "Tier 1: 0" with no explanation made
            users assume the page was broken when in reality it
            reflects strict eligibility (confirmed ticker + primary
            source + decay date ≤ 30d). Tooltip surfaces the exact
            gating criteria so the zero is interpretable at a glance.
          */}
          <Stat label="Tier 1 (hard catalyst)" value={tier1Count} color="#EF4444" loading={isLoading}
            active={tierFilter === 'TIER_1'}
            tooltip={tier1Count === 0
              ? 'Tier 1 requires a confirmed ticker + primary source + decay date within 30 days. 0 events currently qualify these criteria.'
              : 'Tier 1: confirmed ticker, primary-source filing, decay date within 30 days.'}
            onClick={() => setTierFilter(tierFilter === 'TIER_1' ? 'ALL' : 'TIER_1')} />
          <Stat label="Tier 2 (tradable)" value={tier2Count} color="#F59E0B" loading={isLoading}
            active={tierFilter === 'TIER_2'}
            tooltip={tier2Count === 0
              ? 'Tier 2 requires a tradable event (named ticker + recent filing) but does not need a primary source. 0 events currently qualify.'
              : 'Tier 2: tradable (named ticker + recent filing), primary source not required.'}
            onClick={() => setTierFilter(tierFilter === 'TIER_2' ? 'ALL' : 'TIER_2')} />
          <Stat label={tier3Label} value={tier3Count} color="#6B7A8D" loading={isLoading}
            active={tierFilter === 'WATCHLIST'}
            tooltip={tier3Label === 'Watchlist'
              ? 'Watchlist: events older than the tradable window or without a confirmed ticker yet.'
              : 'Archive: events older than 30 days, kept for pattern reference.'}
            onClick={() => setTierFilter(tierFilter === 'WATCHLIST' ? 'ALL' : 'WATCHLIST')} />
          <span style={{ width: 1, backgroundColor: 'var(--mc-bg-4)', margin: '4px 4px' }} />
          {(Object.keys(CAT_META) as Category[]).map((c) => (
            <Stat key={c} label={CAT_META[c].label} value={catCounts[c]} color={CAT_META[c].color} icon={CAT_META[c].icon} loading={isLoading}
              active={catFilterSet.has(c)}
              onClick={() => toggleCat(c)} />
          ))}
          {anyFilterActive && (
            <button onClick={clearFilters} style={{ marginLeft: 6, alignSelf: 'center', backgroundColor: 'transparent', border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Clear filters ×</button>
          )}
          {/* AUDIT_100 #32 — show-monitored toggle. Surfaces the items the user
              previously flagged so they can audit / restore their bench. */}
          {monitoredCount > 0 && (
            <button
              onClick={() => setMonitoredOnly(v => !v)}
              title="Show only events you previously marked MONITOR"
              style={{
                marginLeft: 6, alignSelf: 'center',
                backgroundColor: monitoredOnly ? 'rgba(148,163,184,0.15)' : 'transparent',
                border: `1px solid ${monitoredOnly ? 'var(--mc-text-3)' : 'var(--mc-bg-4)'}`,
                color: monitoredOnly ? 'var(--mc-text-1)' : 'var(--mc-text-3)',
                borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}
            >◯ {monitoredOnly ? 'Showing monitored' : 'Show monitored'} ({monitoredCount})</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--mc-text-4)', marginRight: 6 }}>Region:</span>
            {(['ALL','IN','US','GLOBAL'] as const).map((r) => {
              const isA = region === r;
              return (
                <button key={r} onClick={() => setRegion(r)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: isA ? '1px solid #38A9E860' : '1px solid var(--mc-bg-4)', backgroundColor: isA ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', color: isA ? '#38A9E8' : 'var(--mc-text-4)', cursor: 'pointer' }}>
                  {r === 'IN' ? '🇮🇳 IN' : r === 'US' ? '🇺🇸 US' : r === 'GLOBAL' ? '🌐 GL' : 'ALL'}
                </button>
              );
            })}
            <button onClick={() => refetch()} disabled={isFetching} style={{ marginLeft: 8, padding: '4px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--mc-bg-4)', color: 'var(--mc-text-3)', cursor: isFetching ? 'not-allowed' : 'pointer', backgroundColor: 'transparent', opacity: isFetching ? 0.5 : 1 }}>
              {isFetching ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* PATCH 0431 — INSTITUTIONAL COVERAGE DIAGNOSTIC.
            User asked: "if something is missing reupdate logic — 3 months
            it should show all such". This panel shows per-bucket counts
            so they can see which institutional categories the engine is
            detecting in the active window, and which categories are
            empty (= either no events occurred OR detector needs more work). */}
        {feed && (feed as any).coverage_diagnostic && (feed as any).coverage_diagnostic.length > 0 && (
          <div style={{ marginTop: 8, marginBottom: 8, padding: 10, background: 'linear-gradient(135deg, color-mix(in srgb, var(--mc-accent) 8%, transparent), color-mix(in srgb, var(--mc-warn) 6%, transparent))', border: '1px solid #38A9E840', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38A9E8', letterSpacing: '0.4px' }}>
                📋 INSTITUTIONAL COVERAGE — 9 alpha categories
                {coverageFilterSet.size > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--mc-bullish)', fontSize: 10 }}>
                    · filtering on {coverageFilterSet.size} bucket{coverageFilterSet.size === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 9, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>
                click bucket to filter list · empty = no events in window OR detector gap
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
              {((feed as any).coverage_diagnostic as Array<{ bucket: string; emoji: string; count: number; note: string }>).map((b, i) => {
                const has = b.count > 0;
                const isActive = coverageFilterSet.has(b.bucket);
                const baseColor = has ? '#10B981' : '#6B7A8D';
                const color = isActive ? '#38A9E8' : baseColor;
                const bg = isActive ? '#38A9E825' : (has ? `${baseColor}15` : '#0A0E1A');
                const border = isActive ? '#38A9E8' : `${baseColor}40`;
                return (
                  <button
                    key={'cov-' + i}
                    onClick={() => toggleCoverageBucket(b.bucket)}
                    disabled={!has}
                    title={`${b.note}${has ? ' · click to filter list' : ' · no events to filter'}`}
                    style={{
                      padding: '5px 8px',
                      background: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 6,
                      cursor: has ? 'pointer' : 'not-allowed',
                      opacity: has ? 1 : 0.55,
                      transition: 'all 0.15s ease',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 10, color: isActive ? '#FFFFFF' : (has ? 'var(--mc-text-1)' : 'var(--mc-text-4)'), fontWeight: isActive ? 800 : 500 }}>
                      {isActive ? '✓ ' : ''}{b.emoji} {b.bucket}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color }}>{b.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab nav */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--mc-bg-4)' }}>
          {TABS.map(({ id, label }) => {
            const isA = active === id;
            return (
              <button key={id} onClick={() => setActive(id)}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.4px', border: isA ? '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)' : '1px solid var(--mc-bg-4)', backgroundColor: isA ? 'color-mix(in srgb, var(--mc-warn) 9%, transparent)' : 'transparent', color: isA ? 'var(--mc-warn)' : 'var(--mc-text-3)', cursor: 'pointer' }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {active === 'all' && (
          canonicalEvents.length > 0
            ? <AllSituationsCanonical isLoading={isLoading} error={error} tier1={tier1Canonical} tier2={tier2Canonical} watchlist={watchlistCanonical} />
            : <AllSituations isLoading={isLoading} error={error} tier1={tier1} tier2={tier2} archive={archive} />
        )}
        {/* PATCH 0584 — Analytics view: unified merger-arb + deal-probability
            + playbook + lifecycle dashboard. Mirrors the Multibagger Analytics
            philosophy of "tell me what to do given everything I have". */}
        {active === 'analytics' && (
          <SpecsitAnalytics events={canonicalEvents} isLoading={isLoading} />
        )}
        {active === 'timing' && <TimingRules />}
        {active === 'playbook' && <Playbook />}
        {active === 'math' && <MathPanels />}
        {active === 'discover' && <DiscoverScanner feed={feed} isLoading={isLoading} error={error} refetch={refetch} isFetching={isFetching} region={region} setRegion={setRegion} />}
      </div>
    </div>
  );
}

function Stat({ label, value, color, icon, onClick, active, loading, tooltip }: { label: string; value: number | string; color: string; icon?: string; onClick?: () => void; active?: boolean; loading?: boolean; tooltip?: string }) {
  // PATCH 0252 — Clickable Stat boxes. When onClick is supplied, render as
  // button; active state lifts the box visually (fill + bolder border).
  // PATCH 0445 BUG-029 — When loading, render a shimmer skeleton in place
  // of the literal '0' so the cold-load doesn't flash zeros that look like
  // genuine empty results.
  /*
   * PATCH 0965 UX — Optional `tooltip` prop.
   * Root cause: tier counters routinely render "Tier 1: 0" with no
   * explanation of the gating criteria. Users misread the zero as a
   * data pipeline failure rather than a strict-eligibility result.
   * Adding an optional `tooltip` prop lets callers attach a `title=`
   * with the explicit criteria so the explanation is one hover away.
   * Rendered as native `title=` so it works on every Stat instance
   * with no extra DOM cost.
   */
  const baseStyle: React.CSSProperties = {
    backgroundColor: active ? `${color}25` : '#0A1422',
    border: `1px solid ${active ? color : `${color}30`}`,
    borderLeft: `3px solid ${color}`,
    borderRadius: 6, padding: '6px 12px',
    cursor: onClick ? 'pointer' : 'default',
    fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
    transition: 'background-color 120ms, border-color 120ms',
  };
  const shimmer = (
    <>
      <div style={{
        width: 28, height: 18, borderRadius: 3,
        background: `linear-gradient(90deg, ${color}15 0%, ${color}40 50%, ${color}15 100%)`,
        backgroundSize: '200% 100%',
        animation: 'specsitShim 1.4s linear infinite',
      }} />
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 6, fontWeight: 500 }}>{label}</div>
      <style>{`@keyframes specsitShim { 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }`}</style>
    </>
  );
  const inner = (loading && (value === 0 || value === '0')) ? shimmer : (
    <>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.1 }}>{icon ? `${icon} ` : ''}{value}</div>
      <div style={{ fontSize: 9.5, color: active ? color : 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, fontWeight: active ? 700 : 500 }}>{label}{active ? ' ✓' : ''}</div>
    </>
  );
  return onClick
    ? <button onClick={onClick} title={tooltip} style={baseStyle}>{inner}</button>
    : <div title={tooltip} style={baseStyle}>{inner}</div>;
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0353 — INSTITUTIONAL ANALYTICS HELPERS (Phase 1)
//
// Single source of truth for every per-event derived metric:
//   - filing tier (drives deal-probability)
//   - lifecycle stage (where the event is in its journey)
//   - playbook prior (typical spread + close days + success rate)
//   - synthetic spread / IRR / probability / EV (when no live quote)
//   - rankable EV score for the Best Risk/Reward leaderboard
// ═══════════════════════════════════════════════════════════════════════════

/** Maps event_type → FilingTier for the deal-probability engine. */
function inferFilingTier(eventType: string): FilingTier {
  switch (eventType) {
    case 'MERGER_DEFINITIVE':
    case 'OPEN_OFFER':
    case 'TENDER_OFFER':
    case 'BUYBACK_TENDER':
    case 'GOING_PRIVATE':
    case 'ACQUISITION_PUBLIC':
      return 'BINDING_AGREEMENT';
    case 'MERGER_RECOMMENDATION':
    case 'SPIN_OFF':
    case 'DEMERGER_INDIA':
    case 'BUYBACK_OPEN_MARKET':
    case 'IPO_SUBSIDIARY':
      return 'BOARD_APPROVED';
    case 'STAKE_SALE':
    case 'QIP_PLACEMENT':
    case 'RIGHTS_ISSUE':
      return 'PRELIMINARY_OFFER';
    case 'NEWS_RUMOR':
      return 'RUMOR';
    default:
      return 'EXPLORATORY';
  }
}

/** Heuristic: infer lifecycle state from event_type + age. The pipeline
 *  doesn't carry an explicit lifecycle column yet (Patch 0320 lib exists,
 *  but Postgres-backed lifecycle records still pending). This gets us 80%
 *  of the institutional read in the meantime. */
function inferLifecycleState(eventType: string, ageDays: number, amendmentCount: number): LifecycleState {
  switch (eventType) {
    case 'OPEN_OFFER':
    case 'TENDER_OFFER':
      return ageDays > 21 ? 'OPEN' : 'BINDING';
    case 'BUYBACK_TENDER':
      return ageDays > 14 ? 'TENDER' : 'BINDING';
    case 'MERGER_DEFINITIVE':
    case 'ACQUISITION_PUBLIC':
      return 'REGULATORY';
    case 'GOING_PRIVATE':
      return ageDays > 30 ? 'REGULATORY' : 'BINDING';
    case 'SPIN_OFF':
    case 'DEMERGER_INDIA':
      // Amendment count suggests record-date approaching → VOTE
      return amendmentCount > 0 ? 'VOTE' : 'REGULATORY';
    case 'IPO_SUBSIDIARY':
      return 'REGULATORY';
    case 'NEWS_RUMOR':
      return 'RUMOR';
    case 'MERGER_RECOMMENDATION':
      return 'BOARD_APPROVED';
    default:
      return 'BINDING';
  }
}

/** Map event_type → expected close days (best estimate when no playbook). */
function defaultCloseDays(eventType: string): number {
  switch (eventType) {
    case 'TENDER_OFFER':
    case 'BUYBACK_TENDER':
      return 35;
    case 'OPEN_OFFER':
    case 'GOING_PRIVATE':
      return 90;
    case 'MERGER_DEFINITIVE':
    case 'ACQUISITION_PUBLIC':
      return 180;
    case 'SPIN_OFF':
    case 'DEMERGER_INDIA':
    case 'IPO_SUBSIDIARY':
      return 120;
    default:
      return 60;
  }
}

interface EventAnalytics {
  filingTier: FilingTier;
  lifecycleState: LifecycleState;
  lifecycleLabel: string;
  lifecycleColor: string;
  /** Spread % — live if cmp+offer provided, else playbook prior. */
  spreadPct: number | null;
  /** Expected days to close. */
  daysToClose: number;
  /** Probability of completion (0-100) from deal-probability engine. */
  probability: number;
  probabilityLabel: string;
  probabilityColor: string;
  /** Annualized IRR (%) — null when spread is null. */
  annIRR: number | null;
  /** Probability-weighted annualized IRR (%) — null when annIRR is null. */
  expectedIRR: number | null;
  /** Single rankable scalar for the leaderboard. Combines expectedIRR
   *  (preferred) with catalyst_score fallback for non-arb events. Always
   *  finite — higher = better. */
  evScore: number;
  /** True when this event is arb-style (has spread/IRR meaning). */
  isArbEvent: boolean;
  /** True when at least one playbook prior was used (vs raw event_type heuristic). */
  hasPlaybook: boolean;
}

/** Compute the institutional analytics bundle for one event. */
function computeEventAnalytics(
  ev: { event_type: string; primary_filing?: { title?: string }; tier?: string; region?: string; amendment_count?: number; catalyst_score?: { decay_score?: number } },
  opts: { cmp?: number | null; offer?: number | null; ageDays?: number } = {},
): EventAnalytics {
  const playbook = getPlaybook(ev.event_type as any);
  const filingTier = inferFilingTier(ev.event_type);
  const ageDays = opts.ageDays ?? 0;
  const lifecycleState = inferLifecycleState(ev.event_type, ageDays, ev.amendment_count ?? 0);
  const lcCfg = LIFECYCLE_CONFIG[lifecycleState];

  // Spread: live (cmp + offer) if available, else playbook prior, else null.
  let spreadPct: number | null = null;
  if (opts.cmp != null && opts.offer != null && opts.cmp > 0) {
    spreadPct = ((opts.offer - opts.cmp) / opts.cmp) * 100;
  } else if (playbook) {
    spreadPct = playbook.typical_spread_pct;
  }

  const daysToClose = playbook ? playbook.avg_close_days : defaultCloseDays(ev.event_type);

  // Probability via deal-probability engine.
  const hurdles: any = {};
  if (ev.region === 'IN') {
    if (['MERGER_DEFINITIVE','ACQUISITION_PUBLIC','GOING_PRIVATE','OPEN_OFFER'].includes(ev.event_type)) {
      hurdles.cci = true; hurdles.sebi = true;
    }
    if (['SPIN_OFF','DEMERGER_INDIA'].includes(ev.event_type)) hurdles.nclt = true;
  }
  const probR = computeDealProbability({
    filingTier,
    spreadPct: spreadPct ?? undefined,
    daysSinceAnnounced: ageDays,
    expectedCloseDays: daysToClose,
    hurdles: Object.keys(hurdles).length ? hurdles : undefined,
  });

  const annIRR = (spreadPct != null && daysToClose > 0)
    ? spreadPct * (365 / daysToClose)
    : null;
  const expectedIRR = (annIRR != null) ? annIRR * (probR.score / 100) : null;

  // EV scalar for leaderboard ranking:
  //   - Arb-style events with computable expectedIRR: use it (typically 1-50).
  //   - Otherwise fall back to catalyst_score.decay_score / 2 so it's roughly
  //     on the same 0-50 scale.
  const isArbEvent = ['OPEN_OFFER','TENDER_OFFER','BUYBACK_TENDER','GOING_PRIVATE','MERGER_DEFINITIVE','ACQUISITION_PUBLIC'].includes(ev.event_type);
  const catalystFallback = (ev.catalyst_score?.decay_score ?? 0) / 2;
  const evScore = isArbEvent && expectedIRR != null
    ? Math.max(0, expectedIRR)
    : catalystFallback;

  return {
    filingTier,
    lifecycleState,
    lifecycleLabel: lcCfg.label,
    lifecycleColor: lcCfg.color,
    spreadPct,
    daysToClose,
    probability: probR.score,
    probabilityLabel: probR.label.replace('_', ' '),
    probabilityColor: probR.color,
    annIRR,
    expectedIRR,
    evScore,
    isArbEvent,
    hasPlaybook: !!playbook,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ALL SITUATIONS — pure data-driven event cards
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0105b: ALL SITUATIONS — canonical event rendering
// Renders events from feed.events (event-intelligence pipeline output) with
// catalyst score, amendment count, "why tradable" expandable block.
// ═══════════════════════════════════════════════════════════════════════════

const TIER_COLOR: Record<'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE', string> = {
  TIER_1: '#EF4444', TIER_2: '#F59E0B', WATCHLIST: '#94A3B8', NOISE: '#6B7A8D',
};

const TIER_LABEL: Record<'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE', { label: string; tagline: string }> = {
  TIER_1:    { label: 'Tier 1 — Hard Catalyst',  tagline: 'Definitive filing · named ticker · primary source · time-bounded' },
  TIER_2:    { label: 'Tier 2 — Tradable',         tagline: 'Hard catalyst missing one of: ticker / primary source / decay' },
  WATCHLIST: { label: 'Watchlist',                  tagline: 'Capital allocation / operating commentary — not actionable solo' },
  NOISE:     { label: 'Noise (filtered)',           tagline: 'Fund housekeeping · rumours · unclassified' },
};

const EVENT_TYPE_META: Record<string, { icon: string; color: string }> = {
  TENDER_OFFER:           { icon: '🤝', color: '#FBBF24' },
  GOING_PRIVATE:          { icon: '🔒', color: '#FBBF24' },
  MERGER_RECOMMENDATION:  { icon: '✉️', color: '#FBBF24' },
  MERGER_DEFINITIVE:      { icon: '🤝', color: '#FBBF24' },
  SPIN_OFF:               { icon: '🔀', color: '#22D3EE' },
  OPEN_OFFER:             { icon: '🤝', color: '#FBBF24' },
  BUYBACK_TENDER:         { icon: '💰', color: '#A78BFA' },
  BUYBACK_OPEN_MARKET:    { icon: '💰', color: '#A78BFA' },
  BONUS_ISSUE:            { icon: '🎁', color: '#A78BFA' },
  STOCK_SPLIT:            { icon: '✂️', color: '#A78BFA' },
  DIVIDEND_HIKE:          { icon: '💵', color: '#A78BFA' },
  RIGHTS_ISSUE:           { icon: '📜', color: '#A78BFA' },
  QIP_PLACEMENT:          { icon: '🏦', color: '#A78BFA' },
  DEMERGER_INDIA:         { icon: '🇮🇳', color: '#22D3EE' },
  IPO_SUBSIDIARY:         { icon: '🚀', color: '#22D3EE' },
  TURNAROUND_OPERATING:   { icon: '↩️', color: '#10B981' },
  TURNAROUND_NARRATIVE:   { icon: '↩️', color: '#94A3B8' },
  STAKE_SALE:             { icon: '🤝', color: '#FBBF24' },
  ACQUISITION_PUBLIC:     { icon: '🤝', color: '#FBBF24' },
  NEWS_RUMOR:             { icon: '❓', color: '#94A3B8' },
  UNCLASSIFIED:           { icon: '·',  color: '#6B7A8D' },
};

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0353 — BEST RISK/REWARD LEADERBOARD
//
// Top 5 events ranked by EV score (probability-weighted annualized IRR for
// arb events; catalyst decay-score fallback otherwise). Shows the same
// chip strip the per-row cards show (spread / IRR / prob / days / state)
// so the user can scan the top opportunities at a glance without scrolling
// the full feed.
// ═══════════════════════════════════════════════════════════════════════════

function BestRiskRewardBoard({ events }: { events: CanonicalEvent[] }) {
  const ranked = useMemo(() => {
    return events
      .map(ev => {
        const ageDays = (ev.age_hours ?? 0) / 24;
        const a = computeEventAnalytics(ev as any, { ageDays });
        return { ev, a };
      })
      // Drop events with no analytic signal at all
      .filter(({ a }) => a.evScore > 0)
      // Rank descending
      .sort((x, y) => y.a.evScore - x.a.evScore)
      .slice(0, 5);
  }, [events]);

  if (ranked.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-warn)', letterSpacing: '0.5px' }}>
          🏆 BEST RISK / REWARD
        </span>
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>
          ranked by probability-weighted annualized IRR · arb events first · catalyst-score fallback for non-arb
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
        {ranked.map(({ ev, a }, idx) => {
          const meta = EVENT_TYPE_META[ev.event_type] || EVENT_TYPE_META.UNCLASSIFIED;
          const ticker = ev.tickers[0];
          return (
            <div key={ev.event_id}
              style={{
                backgroundColor: 'var(--mc-bg-1)',
                border: '1px solid var(--mc-border-1)',
                borderLeft: `3px solid ${a.lifecycleColor}`,
                borderRadius: 8, padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--mc-warn)',
                  backgroundColor: 'color-mix(in srgb, var(--mc-warn) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)',
                  padding: '1px 6px', borderRadius: 3, fontFamily: 'ui-monospace, monospace' }}>
                  #{idx + 1}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>
                  {meta.icon} {ev.event_type.replace(/_/g, ' ')}
                </span>
                {ticker && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', padding: '1px 6px', borderRadius: 3, fontFamily: 'ui-monospace, monospace' }}>
                    {ticker}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mc-text-1)', lineHeight: 1.35, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {ev.primary_filing.title}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
                {a.expectedIRR != null && (
                  <span style={{ color: 'var(--mc-warn)', fontWeight: 800, backgroundColor: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', padding: '1px 5px', borderRadius: 3 }}
                    title={`Expected IRR = annualized IRR (${a.annIRR?.toFixed(0)}%/yr) × probability (${a.probability}%)`}>
                    EV {a.expectedIRR >= 0 ? '+' : ''}{a.expectedIRR.toFixed(1)}%/yr
                  </span>
                )}
                {a.spreadPct != null && (
                  <span style={{ color: a.spreadPct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>
                    sp {a.spreadPct >= 0 ? '+' : ''}{a.spreadPct.toFixed(1)}%
                  </span>
                )}
                <span style={{ color: a.probabilityColor, fontWeight: 700 }} title={`Deal probability: ${a.probabilityLabel}`}>
                  P {a.probability}%
                </span>
                <span style={{ color: 'var(--mc-text-3)' }}>~{a.daysToClose}d</span>
                <span style={{ color: a.lifecycleColor, fontWeight: 700, padding: '0 4px',
                  border: `1px solid ${a.lifecycleColor}40`, borderRadius: 3 }}
                  title={LIFECYCLE_CONFIG[a.lifecycleState].description}>
                  ▶ {a.lifecycleLabel}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllSituationsCanonical({ isLoading, error, tier1, tier2, watchlist }: { isLoading: boolean; error: any; tier1: CanonicalEvent[]; tier2: CanonicalEvent[]; watchlist: CanonicalEvent[] }) {
  // PATCH 0109 — BUG-04: 10-second timeout state.  If still loading after
  // 10s, surface a hint so user knows fetch is slow rather than broken.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!isLoading) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(t);
  }, [isLoading]);
  if (isLoading) return (
    <div style={{ color: 'var(--mc-text-4)', fontSize: 12, padding: 14 }}>
      Loading event-intelligence pipeline…
      {slow && (
        <div style={{ marginTop: 6, color: 'var(--mc-warn)', fontSize: 11 }}>
          ⏳ RSS fetch taking longer than expected. Click the Refresh button (top-right) to retry.
        </div>
      )}
    </div>
  );
  // PATCH 0714 — surface error message + retry hint.
  if (error) {
    const msg = (error as any)?.message || String(error || 'unknown');
    return (
      <div style={{ color: 'var(--mc-bearish)', fontSize: 12, padding: 14, lineHeight: 1.5 }}>
        ⚠ Failed to load event-intelligence pipeline: <code style={{ color: '#FCA5A5' }}>{msg}</code>.
        <div style={{ color: 'var(--mc-text-3)', marginTop: 4 }}>Try ↻ Refresh now or check System Status.</div>
      </div>
    );
  }
  if (!tier1.length && !tier2.length && !watchlist.length) {
    return (
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 10, padding: 24, color: 'var(--mc-text-4)', fontSize: 13, textAlign: 'center' }}>
        <AlertTriangle style={{ width: 20, height: 20, marginBottom: 8, color: 'var(--mc-warn)' }} />
        <div>No canonical events yet — RSS pipeline still warming up.</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>The event-intelligence engine collapses amendments under one event, scores catalysts (+30 definitive / -20 amendment), filters fund housekeeping, and auto-generates "why tradable" blocks.</div>
      </div>
    );
  }
  return (
    <>
      {/* PATCH 0353 — Top-of-feed leaderboard. Combines Tier 1 + Tier 2 so
          the best risk/reward events surface regardless of which tier the
          classifier landed them in. */}
      <BestRiskRewardBoard events={[...tier1, ...tier2]} />
      {tier1.length > 0 && <CanonicalSection meta={TIER_LABEL.TIER_1} color={TIER_COLOR.TIER_1} events={tier1} defaultExpanded />}
      {tier2.length > 0 && <CanonicalSection meta={TIER_LABEL.TIER_2} color={TIER_COLOR.TIER_2} events={tier2} defaultExpanded />}
      {watchlist.length > 0 && <CanonicalSection meta={TIER_LABEL.WATCHLIST} color={TIER_COLOR.WATCHLIST} events={watchlist} defaultExpanded={false} />}
    </>
  );
}

function CanonicalSection({ meta, color, events, defaultExpanded }: { meta: { label: string; tagline: string }; color: string; events: CanonicalEvent[]; defaultExpanded?: boolean }) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  return (
    <div>
      <button onClick={() => setCollapsed(!collapsed)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderLeft: `3px solid ${color}`, paddingLeft: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px' }}>{collapsed ? '▸' : '▾'} {meta.label} · {events.length}</div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginTop: 2 }}>{meta.tagline}</div>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.slice(0, 30).map((e) => <CanonicalEventCard key={e.event_id} ev={e} />)}
          {events.length > 30 && <div style={{ fontSize: 11, color: 'var(--mc-text-4)', textAlign: 'center' }}>Showing 30 of {events.length}.</div>}
        </div>
      )}
    </div>
  );
}

// PATCH 0128 — extract offer price / consideration from filing title text.
// Returns USD or INR amount as a number, plus currency symbol.  Crude but
// effective: regex catches '$23.50 per share', 'Rs 750', '₹1,250', '750/-'
// patterns we see in tender / open-offer titles.
function parseDealPrice(text: string): { amount: number; currency: string; unit?: string } | null {
  if (!text) return null;
  // Keep magnitude tokens (crore / lakh / billion / million) so deal VALUES
  // like '₹15,000 crore' or '$1 billion' are not shown as bare per-share prices.
  const magAfter = (src: string, m: RegExpMatchArray): string | undefined => {
    const rest = src.slice((m.index ?? 0) + m[0].length).trimStart();
    const mm = rest.match(/^[-–]?\s*(crores?|crs?\.?|lakhs?|lacs?|billions?|bn\b|b\b|millions?|mn\b|m\b)/i);
    if (!mm) return undefined;
    const r = mm[1].toLowerCase();
    if (r.startsWith('cr')) return 'Cr';
    if (r.startsWith('lakh') || r.startsWith('lac')) return 'L';
    if (r.startsWith('b')) return 'B';
    return 'M';
  };
  // USD: $XX.XX or USD XX.XX per share
  let m = text.match(/(?:\$|USD\s*)\s*([\d,]+\.?\d*)\s*(?:per\s+share|\/share)?/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 100000) return { amount: n, currency: '$', unit: magAfter(text, m) };
  }
  // INR: Rs / ₹ / INR
  m = text.match(/(?:rs\.?|₹|inr)\s*([\d,]+\.?\d*)\s*(?:per\s+share|\/-?)?/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 1000000) return { amount: n, currency: '₹', unit: magAfter(text, m) };
  }
  return null;
}

// PATCH 0128 — fetch a single quote for the first ticker on an event card.
// Reuses the same /market/quotes endpoint other tabs use.  Returns null
// when no ticker / no live quote available.
function useDealQuote(ticker: string | undefined) {
  return useQuery<{ price: number | null }>({
    queryKey: ['spec-sit', 'quote', ticker || ''],
    queryFn: async () => {
      if (!ticker) return { price: null };
      try {
        const { data } = await api.post('/market/quotes', { symbols: [ticker] });
        const px = Array.isArray(data) ? data[0]?.price : data?.[ticker]?.price ?? data?.price;
        const n = Number(px);
        return { price: Number.isFinite(n) && n > 0 ? n : null };
      } catch { return { price: null }; }
    },
    enabled: !!ticker,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

function CanonicalEventCard({ ev }: { ev: CanonicalEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = EVENT_TYPE_META[ev.event_type] || EVENT_TYPE_META.UNCLASSIFIED;
  const ageLabel = ev.age_hours < 24 ? `${ev.age_hours}h` : `${Math.round(ev.age_hours / 24)}d`;
  // PATCH 0259 — decay color, 0258 — next catalyst, 0260 — india subcat
  const ageColor = ageColorFor(ev.event_type, ev.age_hours);
  const nextCat = nextCatalystFor(ev as any);
  const indiaSubcat = ev.region === 'IN' ? inferIndiaSubcategory(ev.primary_filing?.title || '', ev.event_type) : null;
  // PATCH 0167 — Rejected reason persistence
  const [rejection, setRejection] = useState<RejectionRecord | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [draftReason, setDraftReason] = useState('');
  useEffect(() => {
    const all = loadRejections();
    setRejection(all[ev.event_id] || null);
  }, [ev.event_id]);
  const saveRejection = () => {
    const txt = draftReason.trim();
    if (!txt) return;
    const all = loadRejections();
    all[ev.event_id] = { reason: txt, ts: Date.now() };
    saveRejections(all);
    setRejection(all[ev.event_id]);
    setShowRejectInput(false);
    setDraftReason('');
  };
  const deleteRejection = () => {
    const all = loadRejections();
    delete all[ev.event_id];
    saveRejections(all);
    setRejection(null);
  };
  // PATCH 0128 — inline deal spread + annualized return strip
  const primaryTicker = ev.tickers[0];
  const dealPrice = useMemo(() => parseDealPrice(ev.primary_filing.title), [ev.primary_filing.title]);
  const { data: dealQuote } = useDealQuote(
    ev.tier === 'TIER_1' || ev.tier === 'TIER_2' ? primaryTicker : undefined
  );
  const cmp = dealQuote?.price ?? null;
  const offer = dealPrice?.amount ?? null;
  const spreadPct = offer !== null && cmp !== null && cmp > 0 && !dealPrice?.unit ? ((offer - cmp) / cmp) * 100 : null; // a unit means deal VALUE, not a per-share price
  // Crude time-to-close estimate: tender offers typically 30-60d, going-private
  // ~120d, M&A definitive ~180d.  Fallback 60d if no event_type hint.
  const daysToCloseGuess =
    ev.event_type === 'TENDER_OFFER' || ev.event_type === 'BUYBACK_TENDER' ? 35 :
    ev.event_type === 'OPEN_OFFER' || ev.event_type === 'GOING_PRIVATE'    ? 90 :
    ev.event_type === 'MERGER_DEFINITIVE' || ev.event_type === 'ACQUISITION_PUBLIC' ? 180 :
    ev.event_type === 'SPIN_OFF' || ev.event_type === 'DEMERGER_INDIA' || ev.event_type === 'IPO_SUBSIDIARY' ? 120 : 60;
  const annualizedPct = spreadPct != null ? spreadPct * (365 / daysToCloseGuess) : null;
  // PATCH 0353 — Per-row analytics bundle. Uses live CMP+offer when
  // available, falls back to playbook prior. Drives the new prob /
  // EV / lifecycle chips on the card header.
  const analytics = useMemo(() => computeEventAnalytics(ev as any, {
    cmp: cmp ?? undefined,
    offer: offer ?? undefined,
    ageDays: (ev.age_hours ?? 0) / 24,
  }), [ev, cmp, offer]);
  return (
    <div style={{
      backgroundColor: rejection ? '#1A0E10' : 'var(--mc-bg-1)',
      border: `1px solid ${rejection ? 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' : 'var(--mc-border-1)'}`,
      borderLeft: `3px solid ${rejection ? 'var(--mc-bearish)' : meta.color}`,
      borderRadius: 10,
      opacity: rejection ? 0.85 : 1,
    }}>
      {/* PATCH 0167/0254 — 'MONITOR' chip (was 'REJECTED' — softer, institutional). */}
      {rejection && (
        <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ color: 'var(--mc-text-3)', fontWeight: 800, letterSpacing: '0.4px' }}>◯ MONITOR</span>
          <span style={{ color: 'var(--mc-text-2)', flex: 1, fontStyle: 'italic' }}>{rejection.reason}</span>
          <span style={{ color: 'var(--mc-text-4)', fontSize: 10 }}>{new Date(rejection.ts).toLocaleDateString('en-IN')}</span>
          <button onClick={(e) => { e.stopPropagation(); deleteRejection(); }}
            title="Remove monitor flag"
            style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--mc-text-3) 38%, transparent)', background: 'transparent', color: 'var(--mc-text-3)', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>
            ✕
          </button>
        </div>
      )}
      {showRejectInput && (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '8px 16px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input autoFocus value={draftReason} onChange={(e) => setDraftReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRejection(); if (e.key === 'Escape') setShowRejectInput(false); }}
            placeholder="Reason for monitoring (e.g. await filing, no spread, low confidence)…  Enter to save, Esc to cancel"
            style={{ flex: 1, padding: '4px 8px', backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-text-3) 25%, transparent)', borderRadius: 4, color: 'var(--mc-text-1)', fontSize: 11, outline: 'none' }} />
          <button onClick={saveRejection} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--mc-text-3) 38%, transparent)', background: 'color-mix(in srgb, var(--mc-text-3) 8%, transparent)', color: 'var(--mc-text-3)', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>Save</button>
        </div>
      )}
      <button onClick={() => setExpanded((s) => !s)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, padding: '2px 8px', borderRadius: 4, backgroundColor: `${meta.color}18`, border: `1px solid ${meta.color}40` }}>
            {meta.icon} {ev.event_type.replace(/_/g, ' ')}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: ev.region === 'IN' ? 'var(--mc-warn)' : 'var(--mc-cyan)' }}>
            {ev.region === 'IN' ? '🇮🇳' : ev.region === 'US' ? '🇺🇸' : '🌐'}
          </span>
          {ev.target_name && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text-1)' }}>{ev.target_name}</span>
          )}
          {ev.tickers.slice(0, 4).map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 700, color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', padding: '1px 6px', borderRadius: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {t}
            </span>
          ))}
          {ev.amendment_count > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-warn)', padding: '1px 7px', borderRadius: 3, backgroundColor: 'color-mix(in srgb, var(--mc-warn) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)' }}>
              + {ev.amendment_count} amendment{ev.amendment_count > 1 ? 's' : ''}
            </span>
          )}
          {/* PATCH 0257 — '×N sources' chip when the event was deduplicated
              from multiple syndicated reports. Higher count = stronger
              corroboration. */}
          {(() => {
            const n = (ev as any).__source_count as number | undefined;
            const srcs = (ev as any).__source_list as string[] | undefined;
            if (!n || n < 2) return null;
            return (
              <span title={`Corroborated by ${n} sources: ${(srcs || []).join(', ')}`}
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-cyan)', padding: '1px 7px', borderRadius: 3, backgroundColor: 'color-mix(in srgb, var(--mc-cyan) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)' }}>
                ×{n} sources
              </span>
            );
          })()}
          {ev.lifecycle && ev.lifecycle !== 'unknown' && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-text-3)', padding: '1px 6px', borderRadius: 3, backgroundColor: 'var(--mc-bg-4)' }}>
              {ev.lifecycle}
            </span>
          )}
          {/* PATCH 0254 — Expected-alpha tag derived from event_type. Tells the
              user WHAT KIND of trade this is before they read the full card. */}
          {(() => {
            const alpha = expectedAlphaFor(ev.event_type);
            if (!alpha) return null;
            // AUDIT_100 #74 — tooltip surfaces historical p25-p50-p75 IRR
            const tip = alpha.typicalIRR
              ? `Expected alpha: ${alpha.label}. Typical net IRR: ${alpha.typicalIRR}`
              : 'Expected source of alpha for this event type';
            return (
              <span title={tip}
                style={{ fontSize: 10, fontWeight: 700,
                  color: alpha.tone.solid, backgroundColor: alpha.tone.bg,
                  border: `1px solid ${alpha.tone.border}`,
                  padding: '1px 7px', borderRadius: 3, cursor: 'help',
                }}>
                α {alpha.label}
              </span>
            );
          })()}
          {/* PATCH 0260 — India sub-category tag */}
          {indiaSubcat && (
            <span title="India-specific event sub-type inferred from headline keywords"
              style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-warn)', padding: '1px 7px', borderRadius: 3, backgroundColor: 'color-mix(in srgb, var(--mc-warn) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)' }}>
              🇮🇳 {indiaSubcat}
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--mc-text-4)' }}>
            <span title="Catalyst score (decay-adjusted)">Score {ev.catalyst_score.decay_score.toFixed(0)}</span>
            {/* PATCH 0254 — Source-tier badge (PRIMARY/SPECIALIST/SECONDARY/AGGREGATOR) */}
            {(() => {
              const src = ev.primary_filing.source || '';
              const url = (ev.primary_filing as any).url || '';
              const tier = classifySource(src, url);
              const v = TIER_VISUAL[tier];
              return (
                <span title={`${v.label} source — ${v.description}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
                    fontSize: 9, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
                    color: v.tone.solid, backgroundColor: v.tone.bg,
                    border: `1px solid ${v.tone.border}`,
                    padding: '1px 5px', borderRadius: 3, letterSpacing: '0.3px',
                  }}>{v.glyph} {v.label}</span>
              );
            })()}
            {/* PATCH 0259 — Decay-color age chip */}
            <span title={`Age vs typical half-life for ${ev.event_type}`}
              style={{ fontFamily: 'ui-monospace, monospace', color: ageColor, fontWeight: 700 }}>
              {ageLabel}
            </span>
            <span>{ev.primary_filing.source}</span>
            <ExternalLink style={{ width: 11, height: 11 }} />
          </span>
        </div>
        {/* PATCH 0258 — Next-catalyst chip on its own line for visibility */}
        {nextCat && (
          <div style={{ marginTop: 4, marginBottom: 6, fontSize: 11, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace' }}>
            <span style={{ color: 'var(--mc-cyan)', fontWeight: 700, marginRight: 6 }}>→</span>
            <span>{nextCat.label}</span>
            {nextCat.daysOut !== null && nextCat.daysOut >= 0 && (
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--mc-text-4)' }}>· {nextCat.daysOut}d away</span>
            )}
          </div>
        )}
        <div style={{ display: 'none' }}>{/* placeholder to keep JSX shape from previous code */}
        </div>
        <div style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 500, lineHeight: 1.4 }}>{ev.primary_filing.title}</div>
        {/* PATCH 0128 — Inline deal spread / annualized return strip */}
        {(offer != null || cmp != null) && (
          <div style={{ marginTop: 6, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap', color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {offer != null && (
              <span><span style={{ color: 'var(--mc-text-4)' }}>Offer:</span> <strong style={{ color: 'var(--mc-text-1)' }}>{dealPrice?.currency}{offer.toLocaleString()}{dealPrice?.unit ? (dealPrice.unit === 'B' || dealPrice.unit === 'M' ? dealPrice.unit : ' ' + dealPrice.unit) : ''}</strong></span>
            )}
            {cmp != null && (
              <span><span style={{ color: 'var(--mc-text-4)' }}>CMP:</span> <strong style={{ color: 'var(--mc-text-1)' }}>{dealPrice?.currency || (ev.region === 'IN' ? '₹' : '$')}{cmp.toLocaleString()}</strong></span>
            )}
            {spreadPct != null && (
              <span><span style={{ color: 'var(--mc-text-4)' }}>Spread:</span> <strong style={{ color: spreadPct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{spreadPct >= 0 ? '+' : ''}{spreadPct.toFixed(2)}%</strong></span>
            )}
            {annualizedPct != null && (
              <span title={`Assumes ${daysToCloseGuess}d close`}><span style={{ color: 'var(--mc-text-4)' }}>Ann:</span> <strong style={{ color: annualizedPct >= 0 ? 'var(--mc-cyan)' : 'var(--mc-bearish)' }}>{annualizedPct >= 0 ? '+' : ''}{annualizedPct.toFixed(1)}%/yr</strong></span>
            )}
            {/* PATCH 0447 IMP-2 — Break-price downside. When the deal fails,
                the stock typically reverts to its pre-announcement standalone
                value. Heuristic break = offer minus 1.5× current spread (i.e.
                if deal fails, the premium reverses + adds equal-sized
                disappointment discount). Surfaces the asymmetric payoff. */}
            {offer != null && cmp != null && spreadPct != null && (() => {
              const breakPrice = cmp - Math.abs(offer - cmp) * 1.5;
              const breakLoss = ((breakPrice - cmp) / cmp) * 100;
              return (
                <span title={`If deal fails: stock typically reverts to standalone value ≈ ₹${breakPrice.toFixed(2)} (estimated -${Math.abs(breakLoss).toFixed(1)}% from CMP). Heuristic = CMP − 1.5× current spread.`}
                  style={{ color: 'var(--mc-text-4)' }}>
                  Break: <strong style={{ color: 'var(--mc-bearish)' }}>{breakLoss.toFixed(1)}%</strong>
                </span>
              );
            })()}
            <span style={{ color: 'var(--mc-text-4)' }}>~{daysToCloseGuess}d est. close</span>
          </div>
        )}
        {/* PATCH 0353 — Institutional analytics chip strip. Always rendered
            (uses playbook priors when no live quote). Adds the per-row
            equivalent of the BestRiskRewardBoard chips: probability,
            lifecycle stage, EV. Lets the user grade an event without
            expanding it. */}
        <div style={{ marginTop: 6, display: 'flex', gap: 6, fontSize: 10, flexWrap: 'wrap', alignItems: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <span title={`Filing tier inferred from event_type: ${analytics.filingTier}. Deal-probability heuristic per lib/deal-probability.ts`}
            style={{ color: analytics.probabilityColor, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${analytics.probabilityColor}40`, backgroundColor: `${analytics.probabilityColor}12` }}>
            P {analytics.probability}% · {analytics.probabilityLabel.toLowerCase()}
          </span>
          <span title={`Inferred lifecycle stage. ${LIFECYCLE_CONFIG[analytics.lifecycleState].description}`}
            style={{ color: analytics.lifecycleColor, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${analytics.lifecycleColor}40`, backgroundColor: `${analytics.lifecycleColor}12` }}>
            ▶ {analytics.lifecycleLabel}
          </span>
          {analytics.expectedIRR != null && (
            <span title={`Expected IRR = annualized IRR (${analytics.annIRR?.toFixed(0)}%/yr) × probability (${analytics.probability}%). Uses ${analytics.spreadPct != null && cmp != null ? 'LIVE spread + CMP' : 'playbook prior typical spread'}.`}
              style={{ color: 'var(--mc-warn)', fontWeight: 800, padding: '1px 6px', borderRadius: 3,
                border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 7%, transparent)' }}>
              EV {analytics.expectedIRR >= 0 ? '+' : ''}{analytics.expectedIRR.toFixed(1)}%/yr
            </span>
          )}
          {!analytics.expectedIRR && analytics.hasPlaybook && (
            <span title="Non-arb event — using catalyst-score as EV proxy"
              style={{ color: 'var(--mc-text-3)', fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                border: '1px solid color-mix(in srgb, var(--mc-text-3) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-text-3) 7%, transparent)' }}>
              EV n/a (non-arb)
            </span>
          )}
        </div>
        {!expanded && (
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginTop: 4, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>{ev.tradability_rationale}</span>
            {!rejection && !showRejectInput && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setShowRejectInput(true); }}
                title="Mark as Monitor — defers acting on this event without deleting it"
                style={{ fontSize: 10, padding: '1px 7px', borderRadius: 3, border: '1px solid color-mix(in srgb, var(--mc-text-3) 38%, transparent)', color: 'var(--mc-text-3)', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.4px' }}>
                ◯ MONITOR
              </span>
            )}
          </div>
        )}
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* PATCH 0328 — Playbook intelligence: institutional priors for
              this event type (avg close, success rate, typical spread,
              dominant failure modes, retail-overhang flag). */}
          {(() => {
            const pb = getPlaybook(ev.event_type);
            if (!pb) return null;
            return (
              <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderLeft: '3px solid var(--mc-state-persistent)', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.4px', marginBottom: 8 }}>
                  📐 PLAYBOOK — {pb.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px' }}>AVG CLOSE</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-text-1)' }}>{pb.avg_close_days}d</div>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>p25–p75: {pb.close_days_range[0]}–{pb.close_days_range[1]}d</div>
                  </div>
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px' }}>SUCCESS RATE</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: pb.success_rate_pct >= 90 ? 'var(--mc-bullish)' : pb.success_rate_pct >= 75 ? 'var(--mc-warn)' : 'var(--mc-bearish)' }}>
                      {pb.success_rate_pct}%
                    </div>
                  </div>
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px' }}>TYPICAL SPREAD</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)' }}>{pb.typical_spread_pct >= 0 ? '+' : ''}{pb.typical_spread_pct}%</div>
                  </div>
                  <div style={{ backgroundColor: 'var(--mc-bg-1)', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px' }}>RETAIL OVERHANG</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: pb.retail_overhang === 'YES' ? 'var(--mc-bullish)' : pb.retail_overhang === 'SOMETIMES' ? 'var(--mc-warn)' : 'var(--mc-text-4)' }}>
                      {pb.retail_overhang === 'YES' ? 'YES — arb capture' : pb.retail_overhang}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--mc-text-2)', lineHeight: 1.5, marginBottom: 6 }}>
                  <strong style={{ color: 'var(--mc-cyan)' }}>Tactics:</strong> {pb.tactics}
                </div>
                {pb.failure_modes.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--mc-bearish)' }}>Failure modes:</strong> {pb.failure_modes.join(' · ')}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Why tradable */}
          <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 6 }}>WHY TRADABLE</div>
            <div style={{ fontSize: 11.5, color: 'var(--mc-text-2)', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--mc-bullish)' }}>What happened:</strong> {ev.why_tradable.what_happened}</p>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--mc-warn)' }}>What matters:</strong> {ev.why_tradable.what_matters}</p>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--mc-cyan)' }}>What to watch:</strong> {ev.why_tradable.what_to_watch}</p>
              <p style={{ margin: 0 }}><strong style={{ color: 'var(--mc-bearish)' }}>What breaks thesis:</strong> {ev.why_tradable.what_breaks_thesis}</p>
            </div>
          </div>
          {/* Catalyst score breakdown */}
          <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 6 }}>
              CATALYST SCORE — raw {ev.catalyst_score.raw_score} · decay-adjusted {ev.catalyst_score.decay_score.toFixed(1)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 }}>
              {/* AUDIT_100 #8 — stable key (label) instead of array index. */}
              {ev.catalyst_score.components.map((c) => (
                <div key={`${c.label}-${c.pts}`} style={{ color: c.pts > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{c.label}</div>
              ))}
            </div>
          </div>
          {/* Filings list */}
          {ev.filings.length > 1 && (
            <div style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-text-3)', letterSpacing: '0.4px', marginBottom: 6 }}>ALL FILINGS ({ev.filings.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ev.filings.map((f, i) => (
                  <a key={f.id} href={f.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--mc-text-2)', textDecoration: 'none', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--mc-text-4)', minWidth: 16 }}>{i + 1}.</span>
                    <span style={{ flex: 1 }}>{f.title}</span>
                    <span style={{ color: 'var(--mc-text-4)', fontSize: 10 }}>{f.source} · {f.age_hours < 24 ? `${f.age_hours}h` : `${Math.round(f.age_hours / 24)}d`}</span>
                    <ExternalLink style={{ width: 10, height: 10, color: 'var(--mc-text-4)' }} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AllSituations({ isLoading, error, tier1, tier2, archive }: { isLoading: boolean; error: any; tier1: ScoredEvent[]; tier2: ScoredEvent[]; archive: ScoredEvent[] }) {
  if (isLoading) return <div style={{ color: 'var(--mc-text-4)', fontSize: 12, padding: 14 }}>Loading live RSS feeds…</div>;
  // PATCH 0714 — surface error message + retry hint so users can diagnose.
  if (error) {
    const msg = (error as any)?.message || String(error || 'unknown');
    return (
      <div style={{ color: 'var(--mc-bearish)', fontSize: 12, padding: 14, lineHeight: 1.5 }}>
        ⚠ Failed to load corporate-action feed: <code style={{ color: '#FCA5A5' }}>{msg}</code>.
        <div style={{ color: 'var(--mc-text-3)', marginTop: 4 }}>Try ↻ Refresh now or check System Status.</div>
      </div>
    );
  }

  if (!tier1.length && !tier2.length && !archive.length) {
    return (
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 10, padding: 24, color: 'var(--mc-text-4)', fontSize: 13, textAlign: 'center' }}>
        <AlertTriangle style={{ width: 20, height: 20, marginBottom: 8, color: 'var(--mc-warn)' }} />
        <div>No corporate-action events in the live RSS pull yet.</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>The /api/v1/special-situations/feed endpoint refreshes every 30 min — stories will surface as classifiers fire on incoming RSS items.</div>
      </div>
    );
  }

  return (
    <>
      {tier1.length > 0 && <TierSection meta={TIER_META.TIER_1} events={tier1} />}
      {tier2.length > 0 && <TierSection meta={TIER_META.TIER_2} events={tier2} defaultCollapsed={false} />}
      {archive.length > 0 && <TierSection meta={TIER_META.ARCHIVE} events={archive} defaultCollapsed />}
    </>
  );
}

function TierSection({ meta, events, defaultCollapsed }: { meta: { label: string; color: string; tagline: string }; events: ScoredEvent[]; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  return (
    <div>
      <button onClick={() => setCollapsed(!collapsed)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', borderLeft: `3px solid ${meta.color}`, paddingLeft: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: meta.color, letterSpacing: '0.4px' }}>
          {collapsed ? '▸' : '▾'} {meta.label} · {events.length}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginTop: 2 }}>{meta.tagline}</div>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.slice(0, 50).map((e) => <EventRow key={e.id} ev={e} />)}
          {events.length > 50 && <div style={{ fontSize: 11, color: 'var(--mc-text-4)', textAlign: 'center' }}>Showing 50 of {events.length}.</div>}
        </div>
      )}
    </div>
  );
}

function EventRow({ ev }: { ev: ScoredEvent }) {
  const meta = CAT_META[ev.category];
  const fresh = ev.freshness === 'TODAY' || ev.freshness === 'THIS_WEEK';
  const ageLabel = ev.age_hours < 24 ? `${ev.age_hours}h` : `${Math.round(ev.age_hours / 24)}d`;
  return (
    <a href={ev.link} target="_blank" rel="noopener noreferrer" style={{ display: 'block', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: `3px solid ${meta.color}`, borderRadius: 10, padding: '12px 16px', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, padding: '2px 8px', borderRadius: 4, backgroundColor: `${meta.color}18`, border: `1px solid ${meta.color}40` }}>
          {meta.icon} {meta.label}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: ev.region === 'IN' ? 'var(--mc-warn)' : 'var(--mc-cyan)' }}>
          {ev.region === 'IN' ? '🇮🇳' : ev.region === 'US' ? '🇺🇸' : '🌐'}
        </span>
        {ev.tickers.slice(0, 5).map((t) => (
          <span key={t} style={{ fontSize: 11, fontWeight: 700, color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', padding: '2px 6px', borderRadius: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {t}
          </span>
        ))}
        {fresh && (
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-bg-0)', backgroundColor: 'var(--mc-warn)', padding: '1px 7px', borderRadius: 3 }}>
            🆕 {ageLabel}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>Score {ev.score}/100</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-text-4)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {ev.source}
          <ExternalLink style={{ width: 11, height: 11 }} />
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 500, lineHeight: 1.5 }}>{ev.title}</div>
      {ev.description && (
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.55, marginTop: 6 }}>
          {ev.description.slice(0, 200)}{ev.description.length > 200 ? '…' : ''}
        </div>
      )}
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMING RULES (universal investing logic, not per-company)
// ═══════════════════════════════════════════════════════════════════════════

function TimingRules() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RuleCard title="🔴 DEMERGERS / SPIN-OFFS — Buy BEFORE Record Date" color="#EF4444" entries={[
        { phase: 'PRE-EVENT (Best)', text: 'Buy before record date — you receive the spin-off shares FREE. This is the highest-return entry. You buy the bundle, then separate the winners.' },
        { phase: 'RISK of Pre-Buy', text: 'You receive ALL entities including weak ones. You must be prepared to sell the weak ones on listing. Without an exit plan for weak entities, pre-buying is dangerous.' },
        { phase: 'POST-EVENT Alternative', text: 'If you missed record date: wait 3-6 months. Forced institutional selling creates better risk/reward in the entity that matters. BUT: you miss the initial pop on quality entities.' },
        { phase: 'RULE', text: 'Clean balance sheet on key entity + growing industry → BUY BEFORE. Major entity is debt-heavy → consider buying AFTER listing when weak entity prices reflect leverage.' },
      ]} />
      <RuleCard title="🟡 TENDER BUYBACKS — Buy BEFORE Record Date" color="#F59E0B" entries={[
        { phase: 'HOW IT WORKS', text: 'Tender buybacks set a record date. Shareholders on record can tender shares at premium. You must OWN shares on record date to participate.' },
        { phase: 'SMALL HOLDER RULE', text: 'In India: position ≤ ₹2 lakh = RESERVED category (15% of buyback). 40-50% acceptance vs 5-7% for large holders. Position size matters enormously.' },
        { phase: 'AFTER TENDER', text: 'Non-accepted shares return at market. If the stock has intrinsic value below buyback price, the unaccepted portion is not a loss — you simply hold at a price you found attractive.' },
        { phase: 'RULE', text: 'Always check promoter participation. If promoters participate → public pool shrinks dramatically. Size to small-shareholder limit to access reserved category.' },
      ]} />
      <RuleCard title="🟡 OPEN-MARKET BUYBACKS — Buy When Stock Undervalued" color="#94A3B8" entries={[
        { phase: 'NO DEADLINE', text: 'Open-market buybacks have no record date. Company buys gradually over months. Edge is valuation, not event mechanics.' },
        { phase: 'WHEN TO BUY', text: 'Buy when: (1) stock below 15x forward P/E AND below historical average; (2) FCF growing; (3) management is NOT selling in the open market simultaneously.' },
        { phase: 'RULE', text: 'Hold 12-36 months. Return = EPS accretion (fewer shares) × earnings growth. Not a 2-month trade.' },
      ]} />
      <RuleCard title="🔴 MERGER ARB (OPEN OFFERS) — Buy When Spread is Positive" color="#EF4444" entries={[
        { phase: 'FIXED CASH DEALS', text: 'Buy below offer price, tender, capture spread. Annualize by dividing by expected deal completion months. Example: 8.4% spread over 2 months = ~50% annualised.' },
        { phase: 'FLOATING DEALS (Stock+Cash)', text: 'ALWAYS recalculate effective consideration using CURRENT acquirer stock price, not deal announcement price. Effective = (Cash%) × offer + (Stock%) × (acquirer shares × current acquirer price). Recalculate daily.' },
        { phase: 'RULE', text: 'Only enter when CURRENT effective spread ≥ +2% AND risk/reward ≥ 2:1 (potential gain vs deal-break loss). Never enter negative spread.' },
      ]} />
    </div>
  );
}

function RuleCard({ title, color, entries }: { title: string; color: string; entries: Array<{ phase: string; text: string }> }) {
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 4 }}>{e.phase}</div>
            <div style={{ fontSize: 12, color: 'var(--mc-text-2)', lineHeight: 1.55 }}>{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOK (universal J-curve + signals)
// ═══════════════════════════════════════════════════════════════════════════

function Playbook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 14 }}>Universal J-Curve — All Spin-offs / Demergers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <JCell phase="Day 1 – Month 3"  ret="−8 to −15%"        note="Forced selling · Index exclusion · ETF dumps" color="#EF4444" />
          <JCell phase="Month 3 – 9"      ret="Recovery"           note="Management refocuses · Cost cuts visible · Analyst coverage starts" color="#F59E0B" />
          <JCell phase="Month 9 – 24"     ret="+12 to +29%"        note="Above-market performance · Institutional buildup" color="#10B981" />
          <JCell phase="Month 24 – 36"    ret="+28% above market"  note="Peak rerating · M&A premium possible" color="#10B981" />
          <JCell phase="Month 36+"        ret="Diverges"           note="Winners compound · Losers plateau · Review thesis" color="#94A3B8" />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
          Source: Purdue 36-year spin-off study (1965-2000) + 2007-2017 replication study (249 spin-offs). Average spin-off outperforms parent +22% Y1, +28.5% Y3. But 38% deliver negative returns Y1 — selection matters.
        </div>
      </div>

      <PGrid title="Demerger — HOLD signals (don't sell these)" color="#10B981" items={[
        { sym: '✓', label: 'Debt-free entity in growing sector',          text: 'Hold 18-24 months. Pure-play with clean balance sheet → multiple expansion.' },
        { sym: '✓', label: 'World-class asset now independently valued',   text: 'Asset that was buried inside the conglomerate can re-rate to global peers.' },
        { sym: '✓', label: 'Management bought shares in new entity',        text: 'CEO/CFO open-market buys in first 6 months → very strong hold signal.' },
        { sym: '✓', label: 'First standalone earnings beat expectations',   text: 'Market is still applying conglomerate discount in early estimates — beats mean re-rating is coming.' },
      ]} />

      <PGrid title="Demerger — SELL signals (exit these)" color="#EF4444" items={[
        { sym: '✗', label: 'Net Debt/EBITDA > 3.5x AND declining revenue', text: 'Leverage spikes if EBITDA drops. Sell on any listing pop above +20%.' },
        { sym: '✗', label: 'Cyclical business with thin equity buffer',     text: 'One bad season wipes out equity. Sell within first month of listing.' },
        { sym: '✗', label: 'Spin-off is the "junk" parent wanted to dump',  text: 'Parent kept the best assets, spun the low-margin / declining business. Sell immediately.' },
        { sym: '✗', label: 'Management selling within 6 months of listing', text: 'CEO/insiders sell >10% of personal stake in first 6 months → exit immediately.' },
      ]} />

      <PGrid title="After Buyback Tender — Unaccepted Shares" color="#FBBF24" items={[
        { sym: '✓', label: 'If company is genuinely undervalued', text: 'HOLD unaccepted shares. The tender was just a bonus — the unaccepted portion appreciates as fundamentals recover.' },
        { sym: '✗', label: 'If buyback was PR not value',          text: 'SELL unaccepted shares over 3-6 months after buyback completes. Premium reverses if business is weak.' },
      ]} />
    </div>
  );
}

function JCell({ phase, ret, note, color }: { phase: string; ret: string; note: string; color: string }) {
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-0)', border: `1px solid ${color}40`, borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 4 }}>{phase}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color, marginBottom: 4 }}>{ret}</div>
      <div style={{ fontSize: 10.5, color: 'var(--mc-text-4)', lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}

function PGrid({ title, color, items }: { title: string; color: string; items: Array<{ sym: string; label: string; text: string }> }) {
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ color, fontWeight: 800, fontSize: 14 }}>{it.sym}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mc-text-1)' }}>{it.label}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--mc-text-3)', lineHeight: 1.55, paddingLeft: 22 }}>{it.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MATH — pure-formula calculators (acceptance ratio + floating deal)
// ═══════════════════════════════════════════════════════════════════════════

interface AcceptanceMath {
  totalTendered: number;
  generalPoolAcceptancePct: number;
  smallHolderAcceptancePct: number;
  largeHolder: { investment: number; sharesAccepted: number; premiumGain: number; returnPct: number; annualized: number };
  smallHolder: { investment: number; sharesAccepted: number; premiumGain: number; returnPct: number; annualized: number };
}

function computeAcceptance(args: { totalShares: number; buybackShares: number; smallReservePct: number; buybackPrice: number; cmp: number; promoterStakePct: number; promoterPct: number; publicPct: number; smallPositionINR: number; largePositionINR: number; monthsToComplete: number }): AcceptanceMath {
  const promoterShares = args.totalShares * (args.promoterStakePct / 100);
  const publicShares = args.totalShares - promoterShares;
  const promoterTendered = promoterShares * (args.promoterPct / 100);
  const publicTendered = publicShares * (args.publicPct / 100);
  const totalTendered = promoterTendered + publicTendered;

  const reservedShares = args.buybackShares * (args.smallReservePct / 100);
  const generalPoolShares = args.buybackShares - reservedShares;
  const generalPoolAcceptancePct = (generalPoolShares / Math.max(1, totalTendered)) * 100;

  const smallSharesEach = Math.floor(args.smallPositionINR / args.cmp);
  const eligibleHolders = 1500000;
  const smallTotalTendered = smallSharesEach * eligibleHolders;
  const smallHolderAcceptancePct = Math.min(100, (reservedShares / Math.max(1, smallTotalTendered)) * 100);

  const premium = args.buybackPrice - args.cmp;
  const largeShares = Math.floor(args.largePositionINR / args.cmp);
  const largeAccepted = (largeShares * generalPoolAcceptancePct) / 100;
  const largeGain = largeAccepted * premium;
  const largeReturn = (largeGain / args.largePositionINR) * 100;

  const smallAccepted = (smallSharesEach * smallHolderAcceptancePct) / 100;
  const smallGain = smallAccepted * premium;
  const smallReturn = (smallGain / args.smallPositionINR) * 100;

  const ann = (r: number) => (r / args.monthsToComplete) * 12;

  return {
    totalTendered, generalPoolAcceptancePct, smallHolderAcceptancePct,
    largeHolder: { investment: args.largePositionINR, sharesAccepted: largeAccepted, premiumGain: largeGain, returnPct: largeReturn, annualized: ann(largeReturn) },
    smallHolder: { investment: args.smallPositionINR, sharesAccepted: smallAccepted, premiumGain: smallGain, returnPct: smallReturn, annualized: ann(smallReturn) },
  };
}

function computeFloating(args: { statedPrice: number; cashPct: number; stockSharesPerTarget: number; acquirerCmp: number; targetCmp: number }) {
  const cashComponent = (args.cashPct / 100) * args.statedPrice;
  const stockComponent = args.stockSharesPerTarget * args.acquirerCmp;
  const stockPct = (100 - args.cashPct) / 100;
  const effectiveValue = cashComponent + stockPct * stockComponent;
  const spreadAbsolute = effectiveValue - args.targetCmp;
  const spreadPct = (spreadAbsolute / args.targetCmp) * 100;
  const breakEvenAcquirerPrice = (args.targetCmp - cashComponent) / (stockPct * args.stockSharesPerTarget);
  return { cashComponent, stockComponent, effectiveValue, spreadAbsolute, spreadPct, breakEvenAcquirerPrice };
}

function MathPanels() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SimpleArbCalc />
      <AcceptanceCalc />
      <FloatingCalc />
    </div>
  );
}

// PATCH 0305 — Simple merger-arb calculator. Wraps lib/merger-arb.ts so
// the institutional "offer / spot / close date → IRR" math has a visible
// surface inside Special Situations. Complements the existing tender-
// buyback and floating-deal calculators.
function SimpleArbCalc() {
  const [offerPrice, setOfferPrice] = useState(250);
  const [spotPrice, setSpotPrice] = useState(240);
  const [closeDate, setCloseDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 45);
    return d.toISOString().slice(0, 10);
  });
  const [probability, setProbability] = useState(85);
  const m = useMemo(() => computeMergerArb({
    offerPrice, spotPrice, expectedCloseDate: closeDate,
    probability: probability / 100,
  }), [offerPrice, spotPrice, closeDate, probability]);
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 12 }}>📐 SIMPLE MERGER-ARB CALCULATOR</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, marginBottom: 14 }}>
        <NumIn label="Offer price" value={offerPrice} onChange={setOfferPrice} step={1} />
        <NumIn label="Spot price (CMP)" value={spotPrice} onChange={setSpotPrice} step={1} />
        <div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 4 }}>EXPECTED CLOSE</div>
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--mc-border-1)', backgroundColor: '#060E1A', color: 'var(--mc-text-1)', fontSize: 13 }}
          />
        </div>
        <NumIn label="Probability %" value={probability} onChange={setProbability} step={5} />
      </div>
      {m ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          <KV label="Spread (abs)" value={`${m.spreadAbs >= 0 ? '+' : ''}${m.spreadAbs.toFixed(2)}`} />
          <KV label="Spread (%)" value={fmtPct(m.spreadPct)} color={m.tightnessColor} highlight />
          <KV label="Days to close" value={`${m.daysToClose}d`} />
          <KV label="Annualized IRR" value={fmtPct(m.annualizedIRR)} color={m.annualizedIRR && m.annualizedIRR >= 15 ? '#10B981' : '#F59E0B'} highlight />
          <KV label="Expected IRR (prob-weighted)" value={fmtPct(m.expectedIRR)} hint={`@ ${probability}% probability`} />
          <KV label="Tightness" value={m.tightness} color={m.tightnessColor} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--mc-text-4)' }}>Provide valid offer, spot, and close date.</div>
      )}
    </div>
  );
}

function AcceptanceCalc() {
  const [totalShares, setTotalShares] = useState(10472085808);
  const [buybackShares, setBuybackShares] = useState(600000000);
  const [smallReservePct, setSmallReservePct] = useState(15);
  const [buybackPrice, setBuybackPrice] = useState(250);
  const [cmp, setCmp] = useState(210);
  const [promoterStakePct, setPromoterStakePct] = useState(72.63);
  const [promoterPct, setPromoterPct] = useState(80);
  const [publicPct, setPublicPct] = useState(50);
  const [monthsToComplete, setMonthsToComplete] = useState(2);
  const [smallPositionINR, setSmallPositionINR] = useState(200000);
  const [largePositionINR, setLargePositionINR] = useState(2100000);

  const m = useMemo(() => computeAcceptance({ totalShares, buybackShares, smallReservePct, buybackPrice, cmp, promoterStakePct, promoterPct, publicPct, smallPositionINR, largePositionINR, monthsToComplete }), [totalShares, buybackShares, smallReservePct, buybackPrice, cmp, promoterStakePct, promoterPct, publicPct, smallPositionINR, largePositionINR, monthsToComplete]);

  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: '3px solid var(--mc-warn)', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 12 }}>📊 INDIAN TENDER BUYBACK CALCULATOR</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, marginBottom: 14 }}>
        <NumIn label="Total shares outstanding" value={totalShares} onChange={setTotalShares} />
        <NumIn label="Buyback shares" value={buybackShares} onChange={setBuybackShares} />
        <NumIn label="Small reserve %" value={smallReservePct} onChange={setSmallReservePct} step={1} />
        <NumIn label="Buyback price" value={buybackPrice} onChange={setBuybackPrice} step={1} />
        <NumIn label="CMP" value={cmp} onChange={setCmp} step={1} />
        <NumIn label="Promoter stake %" value={promoterStakePct} onChange={setPromoterStakePct} step={0.1} />
        <NumIn label="Promoter tender %" value={promoterPct} onChange={setPromoterPct} step={5} />
        <NumIn label="Public tender %" value={publicPct} onChange={setPublicPct} step={5} />
        <NumIn label="Months to complete" value={monthsToComplete} onChange={setMonthsToComplete} step={1} />
        <NumIn label="Small position (₹)" value={smallPositionINR} onChange={setSmallPositionINR} step={10000} />
        <NumIn label="Large position (₹)" value={largePositionINR} onChange={setLargePositionINR} step={50000} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <ResultCard title="Large Holder (general pool)" color="#EF4444" rows={[
          ['Acceptance ratio', `${m.generalPoolAcceptancePct.toFixed(2)}%`],
          ['Shares accepted',  `${m.largeHolder.sharesAccepted.toFixed(0)}`],
          ['Premium captured', `₹${m.largeHolder.premiumGain.toFixed(0)}`],
          ['Return',           `+${m.largeHolder.returnPct.toFixed(2)}%`],
          ['Annualised',       `${m.largeHolder.annualized.toFixed(1)}%`],
        ]} />
        <ResultCard title="Small Holder (≤₹2L reserved)" color="#10B981" rows={[
          ['Acceptance ratio', `${m.smallHolderAcceptancePct.toFixed(0)}%`],
          ['Shares accepted',  `${m.smallHolder.sharesAccepted.toFixed(0)}`],
          ['Premium captured', `₹${m.smallHolder.premiumGain.toFixed(0)}`],
          ['Return',           `+${m.smallHolder.returnPct.toFixed(2)}%`],
          ['Annualised',       `${m.smallHolder.annualized.toFixed(1)}%`],
        ]} />
      </div>
    </div>
  );
}

function FloatingCalc() {
  const [statedPrice, setStatedPrice] = useState(505);
  const [cashPct, setCashPct] = useState(45);
  const [stockSharesPerTarget, setStockSharesPerTarget] = useState(20.2);
  const [acquirerCmp, setAcquirerCmp] = useState(22.23);
  const [targetCmp, setTargetCmp] = useState(489);
  const m = useMemo(() => computeFloating({ statedPrice, cashPct, stockSharesPerTarget, acquirerCmp, targetCmp }), [statedPrice, cashPct, stockSharesPerTarget, acquirerCmp, targetCmp]);
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: '3px solid var(--mc-warn)', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.4px', marginBottom: 12 }}>💰 FLOATING-DEAL CALCULATOR (Stock + Cash Merger Arb)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 14 }}>
        <NumIn label="Stated price ($)" value={statedPrice} onChange={setStatedPrice} step={1} />
        <NumIn label="Cash %" value={cashPct} onChange={setCashPct} step={5} />
        <NumIn label="Acquirer shares / target" value={stockSharesPerTarget} onChange={setStockSharesPerTarget} step={0.1} />
        <NumIn label="Acquirer CMP ($)" value={acquirerCmp} onChange={setAcquirerCmp} step={0.1} />
        <NumIn label="Target CMP ($)" value={targetCmp} onChange={setTargetCmp} step={1} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <KV label="Cash component" value={`$${m.cashComponent.toFixed(2)}`} />
        <KV label="Stock component" value={`$${m.stockComponent.toFixed(2)}`} />
        <KV label="Effective consideration" value={`$${m.effectiveValue.toFixed(2)}`} highlight />
        <KV label="Spread vs target CMP" value={`${m.spreadAbsolute >= 0 ? '+' : ''}$${m.spreadAbsolute.toFixed(2)} (${m.spreadPct >= 0 ? '+' : ''}${m.spreadPct.toFixed(2)}%)`} color={m.spreadPct >= 2 ? '#10B981' : m.spreadPct < 0 ? '#EF4444' : '#F59E0B'} highlight />
        <KV label="Break-even acquirer price" value={`$${m.breakEvenAcquirerPrice.toFixed(2)}`} hint="Spread = 0" />
      </div>
    </div>
  );
}

function NumIn({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{label}</div>
      <input type="number" value={value} step={step ?? 'any'} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%', padding: '6px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-0)', color: 'var(--mc-text-1)', borderRadius: 4, outline: 'none' }} />
    </div>
  );
}

function ResultCard({ title, color, rows }: { title: string; color: string; rows: Array<[string, string]> }) {
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-0)', border: `1px solid ${color}40`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 8 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <tbody>
          {rows.map(([k, v]) => (
            // AUDIT_100 #8 — stable key (label) so React doesn't snap state across rows
            <tr key={String(k)} style={{ borderTop: '1px solid var(--mc-bg-4)' }}>
              <td style={{ padding: '5px 0', color: 'var(--mc-text-3)' }}>{k}</td>
              <td style={{ padding: '5px 0', color: 'var(--mc-text-1)', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KV({ label, value, hint, color, highlight }: { label: string; value: string; hint?: string; color?: string; highlight?: boolean }) {
  const c = color || '#E6EDF3';
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-0)', border: highlight ? '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)' : '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: 14, color: c, fontWeight: 800, marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2, fontStyle: 'italic' }}>{hint}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVER — raw RSS scanner with source-health diagnostics
// ═══════════════════════════════════════════════════════════════════════════

function DiscoverScanner({ feed, isLoading, error, refetch, isFetching, region, setRegion }: { feed?: LiveFeedResp; isLoading: boolean; error: any; refetch: () => any; isFetching: boolean; region: 'ALL'|'IN'|'US'|'GLOBAL'; setRegion: (r: 'ALL'|'IN'|'US'|'GLOBAL') => void }) {
  if (isLoading) return <div style={{ color: 'var(--mc-text-4)', fontSize: 12, padding: 14 }}>Loading…</div>;
  if (error)     return <div style={{ color: 'var(--mc-bearish)', fontSize: 12, padding: 14 }}>Failed to load.</div>;
  if (!feed)     return null;

  const filterReg = (items: LiveFeedItem[]) =>
    region === 'ALL' ? items : items.filter((i) => i.region === region);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 8 }}>🔴 LIVE FEED — Raw Discovery</div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.55, marginBottom: 8 }}>
          14 RSS feeds (ET / Livemint / BS / NDTV / Reuters / MarketWatch / SeekingAlpha / CNBC / Yahoo) hit directly with corporate-action classifiers. {feed.total} matches · {feed.source_status.filter((s)=>s.ok).length}/{feed.source_status.length} sources OK.
        </div>
        <button onClick={() => refetch()} disabled={isFetching} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--mc-bg-4)', backgroundColor: 'transparent', color: 'var(--mc-text-3)', cursor: isFetching ? 'not-allowed' : 'pointer' }}>
          {isFetching ? 'Refreshing…' : '↻ Refresh now'}
        </button>
      </div>

      {/* PATCH 0532 — include CAPEX (Capacity Expansion / New Ventures) and
          CONCALL (First Presentation / Concall) so those event types show up. */}
      {(['SPIN','MA','TURN','CAP','CAPEX','CONCALL'] as Category[]).map((cat) => {
        const items = filterReg(feed.by_category[cat] || []);
        const meta = CAT_META[cat];
        return (
          <div key={cat} style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderLeft: `3px solid ${meta.color}`, borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: meta.color, letterSpacing: '0.4px', marginBottom: 8 }}>{meta.icon} {meta.label} · {items.length}</div>
            {items.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>No matches{region !== 'ALL' && <> for {region}</>}.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.slice(0, 12).map((it) => (
                  <a key={it.id} href={it.link} target="_blank" rel="noopener noreferrer" style={{ display: 'block', backgroundColor: 'var(--mc-bg-0)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '8px 12px', textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 10 }}>{it.region === 'IN' ? '🇮🇳' : it.region === 'US' ? '🇺🇸' : '🌐'}</span>
                      {it.tickers.slice(0, 4).map((t) => (
                        <span key={t} style={{ fontSize: 10, fontWeight: 700, color: '#38A9E8', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', padding: '1px 6px', borderRadius: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{t}</span>
                      ))}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mc-text-4)' }}>{it.source} · {it.age_hours < 24 ? `${it.age_hours}h` : `${Math.round(it.age_hours/24)}d`}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mc-text-1)', lineHeight: 1.45 }}>{it.title}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Source health */}
      <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 12, padding: '10px 14px' }}>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>RSS source health</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {feed.source_status.map((s) => (
            <span key={s.name} title={s.ok ? `${s.items ?? 0} items` : 'Failed'} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, color: s.ok ? 'var(--mc-bullish)' : 'var(--mc-bearish)', backgroundColor: s.ok ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: `1px solid ${s.ok ? 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)'}` }}>
              {s.ok ? '✓' : '✗'} {s.name}{s.ok && s.items != null ? ` (${s.items})` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL SITUATIONS ANALYTICS — PATCH 0584
//
// Mirrors the Multibagger Analytics philosophy of "tell me what to do given
// everything I have". Wraps the already-shipped libraries (merger-arb,
// deal-probability, playbooks, lifecycle, source-tiers) into one ranked
// dashboard so the analyst sees:
//   • BEST RISK/REWARD — sorted by EV × probability / break-risk proxy
//   • BREAK-RISK FLAGS — high-probability of failure (regulatory / stalled)
//   • CATALYST TIMELINE — upcoming hard catalysts in 30 / 60 / 90 day windows
//   • CATEGORY DISTRIBUTION — count + tradable-share per event_type
//   • SOURCE TIER MIX — PRIMARY filings vs aggregator (institutional moat)
//   • QUALITY FILTER — surface vs noise (microcap / no-ticker / SPAC drop)
//   • POSITION SIZING — Core / Tactical / Optionality / Avoid buckets
// ═══════════════════════════════════════════════════════════════════════════

function SpecsitAnalytics({ events, isLoading }: { events: CanonicalEvent[]; isLoading: boolean }) {
  // Map raw event_type to a coarse filing-tier for the deal-probability engine.
  const filingTierFor = (ev: CanonicalEvent): FilingTier => {
    const t = (ev.event_type || '').toUpperCase();
    if (t.includes('MERGER_DEFINITIVE') || t.includes('TENDER_OFFER') || t.includes('OPEN_OFFER') || t.includes('BUYBACK_TENDER')) return 'BINDING_AGREEMENT';
    if (t.includes('ACQUISITION_PUBLIC') || t.includes('SPIN_OFF') || t.includes('DEMERGER_INDIA') || t.includes('GOING_PRIVATE')) return 'BOARD_APPROVED';
    if (t.includes('IPO_SUBSIDIARY') || t.includes('PREFERENTIAL_ALLOTMENT')) return 'PRELIMINARY_OFFER';
    if (t.includes('RUMOR') || ev.lifecycle === 'rumor') return 'RUMOR';
    return 'EXPLORATORY';
  };

  // Regulatory hurdles inferred from event_type.
  const hurdlesFor = (ev: CanonicalEvent) => {
    const t = (ev.event_type || '').toUpperCase();
    const region = ev.region;
    return {
      cci:  region === 'IN' && (t.includes('MERGER') || t.includes('ACQUISITION') || t.includes('DEMERGER')),
      sebi: region === 'IN' && (t.includes('OPEN_OFFER') || t.includes('BUYBACK_TENDER') || t.includes('PREFERENTIAL')),
      nclt: region === 'IN' && (t.includes('DEMERGER') || t.includes('NCLT') || t.includes('MERGER')),
      cross_border: t.includes('ACQUISITION_PUBLIC') && region !== 'IN',
      sectoral: t.includes('BANK') || t.includes('INSURANCE'),
    };
  };

  // Enrich every event with the libs' outputs once, then operate on the enriched set.
  const enriched = useMemo(() => events.map((ev) => {
    const tier = filingTierFor(ev);
    const prob = computeDealProbability({
      filingTier: tier,
      daysSinceAnnounced: Math.round(ev.age_hours / 24),
      hurdles: hurdlesFor(ev),
      friendliness: 'FRIENDLY',
    });
    const catalyst = nextCatalystFor(ev);
    const playbook = getPlaybook(ev.event_type);
    const lifecycle = ev.lifecycle as LifecycleState;
    const lifecycleMeta = LIFECYCLE_CONFIG[lifecycle] || null;
    const sourceTier = classifySource(ev.primary_filing?.source || '');
    const isMicrocapNoise = ev.tickers.length === 0 && (ev.target_name || '').length < 4;
    return { ev, tier, prob, catalyst, playbook, lifecycle, lifecycleMeta, sourceTier, isMicrocapNoise };
  }), [events]);

  // ── BEST RISK/REWARD ────────────────────────────────────────────────────
  // For events without a real spread we approximate EV via catalyst_score ×
  // probability / time-to-catalyst. Events ranked descending.
  const ranked = useMemo(() => {
    const scored = enriched.map((e) => {
      const cat = e.ev.catalyst_score?.raw_score ?? 0;
      const tttCat = e.catalyst?.daysOut ?? 90;
      const ttcSafe = Math.max(7, Math.abs(tttCat));
      const evScore = (cat * (e.prob.score / 100) * 365) / ttcSafe;
      return { ...e, evScore };
    });
    return [...scored].sort((a, b) => b.evScore - a.evScore);
  }, [enriched]);

  // ── BREAK-RISK FLAGS ────────────────────────────────────────────────────
  const breakRisk = useMemo(() => enriched
    .filter((e) => e.prob.label === 'LOW' || e.prob.label === 'VERY_LOW' || (e.ev.age_hours / 24) > 90)
    .sort((a, b) => a.prob.score - b.prob.score)
    .slice(0, 8),
  [enriched]);

  // ── CATALYST TIMELINE — bucket by days-to-catalyst ──────────────────────
  const timeline = useMemo(() => {
    const within = (lo: number, hi: number) => enriched.filter((e) => {
      const d = e.catalyst?.daysOut;
      return typeof d === 'number' && d >= lo && d <= hi;
    }).sort((a, b) => (a.catalyst?.daysOut ?? 0) - (b.catalyst?.daysOut ?? 0));
    return {
      next30: within(0, 30),
      next60: within(31, 60),
      next90: within(61, 90),
    };
  }, [enriched]);

  // ── CATEGORY DISTRIBUTION ───────────────────────────────────────────────
  const byType = useMemo(() => {
    const m = new Map<string, { count: number; tradable: number; avgProb: number; probSum: number }>();
    for (const e of enriched) {
      const k = e.ev.event_type || 'UNKNOWN';
      const cur = m.get(k) || { count: 0, tradable: 0, avgProb: 0, probSum: 0 };
      cur.count++;
      if (e.ev.is_tradable) cur.tradable++;
      cur.probSum += e.prob.score;
      m.set(k, cur);
    }
    return Array.from(m.entries()).map(([k, v]) => ({
      type: k,
      count: v.count,
      tradable: v.tradable,
      avgProb: Math.round(v.probSum / Math.max(1, v.count)),
    })).sort((a, b) => b.count - a.count);
  }, [enriched]);

  // ── SOURCE TIER MIX ─────────────────────────────────────────────────────
  const sourceMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of enriched) {
      const tier = e.sourceTier || 'UNKNOWN';
      m.set(tier, (m.get(tier) || 0) + 1);
    }
    const total = enriched.length || 1;
    return Array.from(m.entries()).map(([tier, count]) => ({
      tier, count, pct: Math.round((count / total) * 100),
    })).sort((a, b) => b.count - a.count);
  }, [enriched]);

  // ── QUALITY FILTER — surface vs noise ───────────────────────────────────
  const surface = useMemo(() => enriched.filter((e) => {
    if (!e.ev.is_tradable) return false;
    if (e.isMicrocapNoise) return false;
    if (e.ev.tickers.length === 0) return false;
    if (e.prob.score < 35) return false;
    return true;
  }), [enriched]);
  const noiseDropped = enriched.length - surface.length;

  // ── POSITION SIZING — Core / Tactical / Optionality / Avoid ─────────────
  // Heuristic without live ADV: filing tier × probability × tradability.
  const positionBuckets = useMemo(() => {
    const core: typeof enriched = [];
    const tactical: typeof enriched = [];
    const optionality: typeof enriched = [];
    const avoid: typeof enriched = [];
    for (const e of enriched) {
      if (!e.ev.is_tradable || e.ev.tickers.length === 0) {
        avoid.push(e); continue;
      }
      const isBindingOrApproved = e.tier === 'BINDING_AGREEMENT' || e.tier === 'BOARD_APPROVED';
      if (isBindingOrApproved && e.prob.score >= 75) core.push(e);
      else if (e.prob.score >= 60) tactical.push(e);
      else if (e.prob.score >= 35) optionality.push(e);
      else avoid.push(e);
    }
    return { core, tactical, optionality, avoid };
  }, [enriched]);

  // ── STATS STRIP ─────────────────────────────────────────────────────────
  const tradableCount = enriched.filter((e) => e.ev.is_tradable).length;
  const tier1Count = enriched.filter((e) => e.ev.tier === 'TIER_1').length;
  const avgAge = enriched.length
    ? Math.round(enriched.reduce((a, b) => a + b.ev.age_hours, 0) / enriched.length / 24)
    : 0;
  const avgProb = enriched.length
    ? Math.round(enriched.reduce((a, b) => a + b.prob.score, 0) / enriched.length)
    : 0;
  const inEvents = enriched.filter((e) => e.ev.region === 'IN').length;
  const usEvents = enriched.filter((e) => e.ev.region === 'US').length;

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#0D1623', border: '1px solid #1A2540',
    borderRadius: 6, padding: '12px 14px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: '#6B7A8D', letterSpacing: '0.3px', marginBottom: 4,
  };

  if (isLoading && enriched.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: 'var(--mc-text-3)' }}>📡 Loading special-situations analytics…</div>;
  }
  if (enriched.length === 0) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: 'var(--mc-text-3)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
        <p style={{ margin: 0, fontWeight: 700, color: 'var(--mc-text-1)' }}>No events to analyze yet</p>
        <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          The live RSS feed hasn't produced canonical events for analytics yet.
          Switch to "Discover (raw RSS)" to inspect source health.
        </p>
      </div>
    );
  }

  // Per-row card builder used everywhere.
  const EventRow = ({ e, accent, extra }: { e: typeof enriched[number]; accent: string; extra?: React.ReactNode }) => {
    const primaryTicker = e.ev.tickers[0] || '';
    // PATCH 1086 — market flag bug. The canonical event's `region` field was
    // missing/defaulted on most analytics rows, so every card fell through to
    // 🇺🇸 US. Derive the flag from the ticker exchange suffix first
    // (NSE: / BSE: / .NS / .BO → 🇮🇳 IN) and only fall back to ev.region if
    // no ticker hint exists. This matches the user-visible rule:
    // NSE/BSE → 🇮🇳 IN, else 🇺🇸 US.
    const tickerStr = e.ev.tickers.join(' ').toUpperCase();
    const isIndianTicker = /\b(NSE|BSE):/.test(tickerStr) || /\.(NS|BO)\b/.test(tickerStr);
    const market: 'IN' | 'US' = isIndianTicker || e.ev.region === 'IN' ? 'IN' : 'US';
    const marketFlag = market === 'IN' ? '🇮🇳' : '🇺🇸';
    return (
      <a
        href={e.ev.primary_filing?.link || '#'}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', borderRadius: 4,
          border: `1px solid ${accent}30`, background: `${accent}08`, textDecoration: 'none',
        }}
        title={[
          `Filing tier: ${e.tier}`,
          `Probability: ${e.prob.score}/100 (${e.prob.label})`,
          e.catalyst ? `Catalyst: ${e.catalyst.label}` : '',
          e.lifecycleMeta ? `Lifecycle: ${e.lifecycleMeta.label}` : '',
          `Source: ${e.ev.primary_filing?.source || '—'} (${e.sourceTier || 'UNK'})`,
          `Market: ${market}`,
        ].filter(Boolean).join('\n')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11 }} title={`Market: ${market}`}>{marketFlag}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {primaryTicker || (e.ev.target_name || '—')}
          </span>
          <span style={{ fontSize: 9, color: 'var(--mc-text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.ev.target_name || ''}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 800,
            color: e.prob.color, background: `${e.prob.color}20`,
            border: `1px solid ${e.prob.color}40`, padding: '1px 5px', borderRadius: 3,
          }}>
            P {e.prob.score}
          </span>
          {extra}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--mc-text-3)' }}>
          <span>{e.ev.event_type?.replace(/_/g, ' ')}</span>
          <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
          <span>{e.tier}</span>
          {e.catalyst && (
            <>
              <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
              <span style={{ color: 'var(--mc-warn)' }}>{e.catalyst.daysOut != null ? `${e.catalyst.daysOut}d` : 'catalyst pending'}</span>
            </>
          )}
          <span style={{ color: 'var(--mc-bg-4)' }}>·</span>
          <span style={{ color: (e.sourceTier && TIER_VISUAL[e.sourceTier]?.tone.solid) || 'var(--mc-text-4)' }}>{e.sourceTier || 'UNK'}</span>
        </div>
      </a>
    );
  };

  return (
    <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── STATS STRIP ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Total events</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-cyan)', fontVariantNumeric: 'tabular-nums' }}>{enriched.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Tradable</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>{tradableCount}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{enriched.length ? Math.round((tradableCount / enriched.length) * 100) : 0}% pass quality bar</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Tier-1 hard catalyst</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' }}>{tier1Count}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Avg probability</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-cyan)', fontVariantNumeric: 'tabular-nums' }}>{avgProb}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>across all events</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Avg age</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-state-persistent)', fontVariantNumeric: 'tabular-nums' }}>{avgAge}d</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Regions</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--mc-text-1)' }}>🇮🇳 {inEvents} · 🇺🇸 {usEvents}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Surface (post-filter)</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>{surface.length}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{noiseDropped} filtered as noise</div>
        </div>
      </div>

      {/* ── 🎯 BEST RISK/REWARD ─────────────────────────────────────────── */}
      <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-warn) 25%, transparent)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--mc-warn) 6%, transparent) 0%, transparent 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 13, color: 'var(--mc-warn)', fontWeight: 800, letterSpacing: '0.4px' }}>
            🎯 BEST RISK / REWARD ({ranked.slice(0, 12).length})
          </div>
          <span style={{ fontSize: 10, color: 'var(--mc-warn)', background: 'color-mix(in srgb, var(--mc-warn) 13%, transparent)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>
            EV-RANKED
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
          EV proxy = catalyst-score × probability × (365 ÷ days-to-catalyst). Higher = sooner + higher conviction.
          When a deal carries a real offer/spot spread, use the Acceptance / Deal Math tab to get the exact IRR.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 6 }}>
          {ranked.slice(0, 12).map((e, i) => (
            <EventRow key={e.ev.event_id + i} e={e} accent="#F59E0B" extra={
              <span style={{ fontSize: 9, color: 'var(--mc-warn)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                EV {Math.round(e.evScore)}
              </span>
            } />
          ))}
        </div>
      </div>

      {/* ── ⚠ BREAK-RISK FLAGS ──────────────────────────────────────────── */}
      {breakRisk.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--mc-bearish) 25%, transparent)' }}>
          <div style={{ fontSize: 13, color: 'var(--mc-bearish)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
            ⚠ BREAK-RISK FLAGS ({breakRisk.length})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
            Low-probability deals (regulatory hurdles / rumor-tier / stalled past expected close).
            Spread-positive trades here often have asymmetric downside if the deal breaks — size accordingly.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 6 }}>
            {breakRisk.map((e, i) => (
              <EventRow key={e.ev.event_id + i} e={e} accent="#EF4444" extra={
                <span style={{ fontSize: 9, color: 'var(--mc-bearish)', fontWeight: 800 }}>{e.prob.label}</span>
              } />
            ))}
          </div>
        </div>
      )}

      {/* ── 🕒 CATALYST TIMELINE ───────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
          🕒 CATALYST TIMELINE
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
          Hard catalysts grouped by time-to-event. Earliest deals get scaled position first (capital efficiency).
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>
          {([
            { key: 'next30', label: 'NEXT 30 DAYS',     color: '#EF4444', items: timeline.next30 },
            { key: 'next60', label: 'NEXT 31-60 DAYS',  color: '#F59E0B', items: timeline.next60 },
            { key: 'next90', label: 'NEXT 61-90 DAYS',  color: '#22D3EE', items: timeline.next90 },
          ] as const).map((b) => (
            <div key={b.key} style={{ border: '1px solid var(--mc-bg-4)', borderRadius: 4, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, color: b.color, fontWeight: 800, marginBottom: 6 }}>{b.label} ({b.items.length})</div>
              {b.items.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>No catalysts in window.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {b.items.slice(0, 6).map((e, i) => (
                    <EventRow key={e.ev.event_id + i} e={e} accent={b.color} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 📊 CATEGORY DISTRIBUTION ──────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-cyan)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
          📊 CATEGORY DISTRIBUTION
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10 }}>
          What event types dominate today's pipeline. Tradable-share + avg probability per type tells you which buckets are quality vs noise.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {byType.map((t) => {
            const maxC = Math.max(1, ...byType.map(x => x.count));
            const widthPct = Math.round((t.count / maxC) * 100);
            const tradablePct = Math.round((t.tradable / Math.max(1, t.count)) * 100);
            const tone = t.avgProb >= 70 ? '#10B981' : t.avgProb >= 50 ? '#22D3EE' : t.avgProb >= 35 ? '#F59E0B' : '#EF4444';
            return (
              <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, minWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.type.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 11, color: 'var(--mc-text-3)', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${widthPct}%`, height: '100%', background: tone }} />
                </div>
                <span style={{ fontSize: 10, color: tone, fontWeight: 700, minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>P {t.avgProb}</span>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)', minWidth: 90, textAlign: 'right' }}>{tradablePct}% tradable</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 🏛 SOURCE TIER MIX ─────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-state-persistent)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
          🏛 SOURCE TIER MIX
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
          PRIMARY = exchange filings / regulators (highest confidence).
          AGGREGATOR = reprints + blogs (lowest). Institutional desks ignore aggregator-only events.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {sourceMix.map((s) => {
            const meta = TIER_VISUAL[s.tier as keyof typeof TIER_VISUAL];
            const color = meta?.tone.solid || '#6B7A8D';
            const label = meta?.label || s.tier;
            const glyph = meta?.glyph || '·';
            return (
              <div key={s.tier} style={{
                padding: '6px 12px', borderRadius: 4,
                border: `1px solid ${color}40`, background: `${color}10`,
                fontSize: 11, fontWeight: 700, color,
              }}>
                {glyph} {label} · {s.count} ({s.pct}%)
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 🎯 POSITION SIZING ─────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: 'var(--mc-bullish)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
          🎯 POSITION SIZING SUGGESTIONS
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 10, lineHeight: 1.5 }}>
          Allocation tier per event. <strong>Core</strong> = binding/approved with high probability.
          <strong> Tactical</strong> = mid-conviction with hard catalyst.
          <strong> Optionality</strong> = lottery-ticket / lower probability.
          <strong> Avoid</strong> = not tradable, no ticker, very-low probability.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {([
            { key: 'core',        label: '💎 CORE',         color: '#10B981', items: positionBuckets.core,        hint: '≥75% prob · binding/approved' },
            { key: 'tactical',    label: '⚡ TACTICAL',     color: '#22D3EE', items: positionBuckets.tactical,    hint: '60-75% prob · hard catalyst' },
            { key: 'optionality', label: '🎲 OPTIONALITY',  color: '#A78BFA', items: positionBuckets.optionality, hint: '35-60% prob · asymmetric upside' },
            { key: 'avoid',       label: '🚫 AVOID',        color: '#EF4444', items: positionBuckets.avoid,       hint: 'Not tradable / no ticker / very low prob' },
          ] as const).map((b) => (
            <div key={b.key} style={{ border: `1px solid ${b.color}40`, borderRadius: 4, padding: '8px 10px', background: `${b.color}08` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: b.color, fontWeight: 800 }}>{b.label}</span>
                <span style={{ fontSize: 11, color: b.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>({b.items.length})</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginBottom: 8 }}>{b.hint}</div>
              {b.items.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontStyle: 'italic' }}>—</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {b.items.slice(0, 6).map((e, i) => (
                    <EventRow key={e.ev.event_id + i} e={e} accent={b.color} />
                  ))}
                  {b.items.length > 6 && (
                    <div style={{ fontSize: 10, color: 'var(--mc-text-4)', fontStyle: 'italic' }}>+ {b.items.length - 6} more</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 🚫 QUALITY FILTER TRANSPARENCY ─────────────────────────────── */}
      {noiseDropped > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: 'var(--mc-text-3)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 4 }}>
            🚫 NOISE FILTERED ({noiseDropped})
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
            Surfaced events ({surface.length}) pass: <strong>is_tradable</strong> + at-least-one-ticker
            + probability ≥ 35 + non-microcap-noise. The remaining {noiseDropped} events failed one or more
            gates — review them on the All Situations tab if you want to see what was filtered out.
          </div>
        </div>
      )}

      {/* ── 📚 INSTITUTIONAL GAPS (transparent disclosure) ─────────────── */}
      <div style={{ ...cardStyle, borderColor: 'var(--mc-bg-4)' }}>
        <div style={{ fontSize: 12, color: 'var(--mc-text-4)', fontWeight: 800, letterSpacing: '0.4px', marginBottom: 6 }}>
          📚 KNOWN INSTITUTIONAL GAPS (this view, today)
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.6 }}>
          <li><strong>No real spread engine yet</strong> — payloads don&apos;t carry offerPrice/spotPrice. Use the Acceptance/Deal Math tab to enter terms manually and get IRR / annualized return / break-downside.</li>
          <li><strong>No quantitative break-risk model</strong> — break-risk shown is rule-based (regulatory hurdles + age past expected close). Bayesian failure-rate per category needs the historical backtest layer.</li>
          <li><strong>No ADV / liquidity yet on this surface</strong> — &quot;Avoid&quot; bucket catches no-ticker / non-tradable. Per-row liquidity gating arrives when /api/market/quotes is wired into the events.</li>
          <li><strong>RSS-dependent</strong> — filings-first ingestion (NSE / BSE / SEC EDGAR direct) is blocked on the parser pipeline (§17.4 D). EDGAR submissions adapter shipped in Patch 0318; deeper SC TO-T / DEFM14A extraction is the next module.</li>
          <li><strong>No historical backtest yet</strong> — playbook priors (avg close days, success-rate, dominant failure modes) are shipped per event type in lib/specsit-playbooks.ts; statistical calibration from 500+ realized deals needs the Postgres layer.</li>
        </ul>
      </div>
    </div>
  );
}
