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
      return { label: `${ev.next_catalyst_label || 'Next catalyst'}: ${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`, daysOut: days };
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
function expectedAlphaFor(eventType: string): { label: string; tone: { solid: string; bg: string; border: string } } | null {
  const yellow = { solid: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' };
  const cyan   = { solid: '#22D3EE', bg: '#22D3EE15', border: '#22D3EE40' };
  const green  = { solid: '#10B981', bg: '#10B98115', border: '#10B98140' };
  const violet = { solid: '#A78BFA', bg: '#A78BFA15', border: '#A78BFA40' };
  const map: Record<string, { label: string; tone: typeof yellow }> = {
    OPEN_OFFER:           { label: 'Spread capture',         tone: cyan },
    TENDER_OFFER:         { label: 'Spread capture',         tone: cyan },
    BUYBACK_TENDER:       { label: 'Spread + odd-lot capture', tone: cyan },
    BUYBACK:              { label: 'Float reduction',        tone: green },
    GOING_PRIVATE:        { label: 'Spread + forced exit',   tone: cyan },
    MERGER_DEFINITIVE:    { label: 'Spread capture',         tone: cyan },
    ACQUISITION_PUBLIC:   { label: 'Spread capture',         tone: cyan },
    SPIN_OFF:             { label: 'SoP unlock + re-rating', tone: violet },
    DEMERGER_INDIA:       { label: 'HoldCo discount → SoP',  tone: violet },
    IPO_SUBSIDIARY:       { label: 'SoP unlock',             tone: violet },
    PREFERENTIAL_ALLOTMENT: { label: 'Conviction signal · float +', tone: yellow },
    PROMOTER_STAKE_UP:    { label: 'Insider conviction',     tone: yellow },
    INDEX_INCLUSION:      { label: 'Forced buying',          tone: green },
    INDEX_EXCLUSION:      { label: 'Forced selling',         tone: green },
    DELISTING:            { label: 'Forced delisting price', tone: cyan },
    NCLT_RESOLUTION:      { label: 'Distressed re-rating',   tone: violet },
    REVERSE_MERGER:       { label: 'Backdoor listing',       tone: violet },
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

function loadRejections(): RejectionMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REJECTED_LS_KEY);
    return raw ? (JSON.parse(raw) as RejectionMap) : {};
  } catch { return {}; }
}
function saveRejections(map: RejectionMap) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(REJECTED_LS_KEY, JSON.stringify(map)); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE FEED — single source of truth
// ═══════════════════════════════════════════════════════════════════════════

type Category = 'SPIN' | 'MA' | 'TURN' | 'CAP';

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
}

function useLiveFeed() {
  return useQuery<LiveFeedResp>({
    queryKey: ['special-situations', 'live-feed'],
    queryFn: async () => {
      const { data } = await api.get('/special-situations/feed');
      return data;
    },
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    // PATCH 0109 — BUG-04: force fetch on every mount so the page doesn't
    // get stuck in 'Loading...' if a stale cache is in memory.
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
  SPIN: { label: 'Spin-off / Demerger', color: '#22D3EE', icon: '🔀' },
  MA:   { label: 'M&A / Open Offer',    color: '#FBBF24', icon: '🤝' },
  TURN: { label: 'Turnaround',          color: '#10B981', icon: '↩️' },
  CAP:  { label: 'Capital Allocation',  color: '#A78BFA', icon: '💰' },
};

const TIER_META: Record<Tier, { label: string; color: string; tagline: string }> = {
  TIER_1:  { label: 'Tier 1 — Hard Catalyst (≤14d, has ticker)', color: '#EF4444', tagline: 'Recent + named ticker + actionable type' },
  TIER_2:  { label: 'Tier 2 — Watchlist (≤30d)',                  color: '#F59E0B', tagline: 'Recent but lower signal' },
  ARCHIVE: { label: 'Archive (>30d)',                              color: '#6B7A8D', tagline: 'Reference / pattern catalogue' },
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

type Tab = 'all' | 'timing' | 'playbook' | 'math' | 'discover';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'all',       label: 'All Situations' },
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
  const [catFilterSet, setCatFilterSet] = useState<Set<Category>>(new Set());
  const toggleCat = (c: Category) => setCatFilterSet(prev => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  });
  const clearFilters = () => { setTierFilter('ALL'); setCatFilterSet(new Set()); };
  const anyFilterActive = tierFilter !== 'ALL' || catFilterSet.size > 0;

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

  // PATCH 0252 — Apply user-selected tier + category filters before deriving
  // tier1/tier2/watchlist lists. Counts stay computed on `canonicalEvents` so
  // the Stat boxes always show the total available; only the rendered list
  // shrinks.
  const filteredCanonicalEvents: CanonicalEvent[] = useMemo(() => {
    return canonicalEvents.filter((e) => {
      if (tierFilter !== 'ALL' && e.tier !== tierFilter) return false;
      if (catFilterSet.size > 0 && !catFilterSet.has(e.category as Category)) return false;
      return true;
    });
  }, [canonicalEvents, tierFilter, catFilterSet]);

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
  const catCounts: Record<Category, number> = { SPIN: 0, MA: 0, TURN: 0, CAP: 0 };
  if (canonicalEvents.length > 0) {
    for (const e of canonicalEvents) catCounts[e.category as Category]++;
  } else {
    for (const e of allEvents) catCounts[e.category]++;
  }
  // Tier counts that sync with whichever pipeline is rendering
  const tier1Count = canonicalEvents.length > 0 ? tier1Canonical.length : tier1.length;
  const tier2Count = canonicalEvents.length > 0 ? tier2Canonical.length : tier2.length;
  const tier3Count = canonicalEvents.length > 0 ? watchlistCanonical.length : archive.length;
  const tier3Label = canonicalEvents.length > 0 ? 'Watchlist' : 'Archive';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1B2E', borderBottom: '1px solid #1E2D45', padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.5px' }}>
            ⚡ SPECIAL SITUATIONS
          </span>
          <span style={{ fontSize: 11, color: '#6B7A8D' }}>
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
          <Stat label="Tier 1 (hard catalyst)" value={tier1Count} color="#EF4444"
            active={tierFilter === 'TIER_1'}
            onClick={() => setTierFilter(tierFilter === 'TIER_1' ? 'ALL' : 'TIER_1')} />
          <Stat label="Tier 2 (tradable)" value={tier2Count} color="#F59E0B"
            active={tierFilter === 'TIER_2'}
            onClick={() => setTierFilter(tierFilter === 'TIER_2' ? 'ALL' : 'TIER_2')} />
          <Stat label={tier3Label} value={tier3Count} color="#6B7A8D"
            active={tierFilter === 'WATCHLIST'}
            onClick={() => setTierFilter(tierFilter === 'WATCHLIST' ? 'ALL' : 'WATCHLIST')} />
          <span style={{ width: 1, backgroundColor: '#1A2840', margin: '4px 4px' }} />
          {(Object.keys(CAT_META) as Category[]).map((c) => (
            <Stat key={c} label={CAT_META[c].label} value={catCounts[c]} color={CAT_META[c].color} icon={CAT_META[c].icon}
              active={catFilterSet.has(c)}
              onClick={() => toggleCat(c)} />
          ))}
          {anyFilterActive && (
            <button onClick={clearFilters} style={{ marginLeft: 6, alignSelf: 'center', backgroundColor: 'transparent', border: '1px solid #1A2840', color: '#8A95A3', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Clear filters ×</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#6B7A8D', marginRight: 6 }}>Region:</span>
            {(['ALL','IN','US','GLOBAL'] as const).map((r) => {
              const isA = region === r;
              return (
                <button key={r} onClick={() => setRegion(r)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: isA ? '1px solid #38A9E860' : '1px solid #1A2840', backgroundColor: isA ? '#0F7ABF20' : 'transparent', color: isA ? '#38A9E8' : '#6B7A8D', cursor: 'pointer' }}>
                  {r === 'IN' ? '🇮🇳 IN' : r === 'US' ? '🇺🇸 US' : r === 'GLOBAL' ? '🌐 GL' : 'ALL'}
                </button>
              );
            })}
            <button onClick={() => refetch()} disabled={isFetching} style={{ marginLeft: 8, padding: '4px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #1A2840', color: '#8A95A3', cursor: isFetching ? 'not-allowed' : 'pointer', backgroundColor: 'transparent', opacity: isFetching ? 0.5 : 1 }}>
              {isFetching ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid #1A2840' }}>
          {TABS.map(({ id, label }) => {
            const isA = active === id;
            return (
              <button key={id} onClick={() => setActive(id)}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.4px', border: isA ? '1px solid #FBBF2460' : '1px solid #1A2840', backgroundColor: isA ? '#FBBF2418' : 'transparent', color: isA ? '#FBBF24' : '#8A95A3', cursor: 'pointer' }}>
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
        {active === 'timing' && <TimingRules />}
        {active === 'playbook' && <Playbook />}
        {active === 'math' && <MathPanels />}
        {active === 'discover' && <DiscoverScanner feed={feed} isLoading={isLoading} error={error} refetch={refetch} isFetching={isFetching} region={region} setRegion={setRegion} />}
      </div>
    </div>
  );
}

function Stat({ label, value, color, icon, onClick, active }: { label: string; value: number | string; color: string; icon?: string; onClick?: () => void; active?: boolean }) {
  // PATCH 0252 — Clickable Stat boxes. When onClick is supplied, render as
  // button; active state lifts the box visually (fill + bolder border).
  const baseStyle: React.CSSProperties = {
    backgroundColor: active ? `${color}25` : '#0A1422',
    border: `1px solid ${active ? color : `${color}30`}`,
    borderLeft: `3px solid ${color}`,
    borderRadius: 6, padding: '6px 12px',
    cursor: onClick ? 'pointer' : 'default',
    fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
    transition: 'background-color 120ms, border-color 120ms',
  };
  const inner = (
    <>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.1 }}>{icon ? `${icon} ` : ''}{value}</div>
      <div style={{ fontSize: 9.5, color: active ? color : '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2, fontWeight: active ? 700 : 500 }}>{label}{active ? ' ✓' : ''}</div>
    </>
  );
  return onClick ? <button onClick={onClick} style={baseStyle}>{inner}</button> : <div style={baseStyle}>{inner}</div>;
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
    <div style={{ color: '#6B7A8D', fontSize: 12, padding: 14 }}>
      Loading event-intelligence pipeline…
      {slow && (
        <div style={{ marginTop: 6, color: '#F59E0B', fontSize: 11 }}>
          ⏳ RSS fetch taking longer than expected. Click the Refresh button (top-right) to retry.
        </div>
      )}
    </div>
  );
  if (error) return <div style={{ color: '#EF4444', fontSize: 12, padding: 14 }}>Failed to load.</div>;
  if (!tier1.length && !tier2.length && !watchlist.length) {
    return (
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 10, padding: 24, color: '#6B7A8D', fontSize: 13, textAlign: 'center' }}>
        <AlertTriangle style={{ width: 20, height: 20, marginBottom: 8, color: '#F59E0B' }} />
        <div>No canonical events yet — RSS pipeline still warming up.</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>The event-intelligence engine collapses amendments under one event, scores catalysts (+30 definitive / -20 amendment), filters fund housekeeping, and auto-generates "why tradable" blocks.</div>
      </div>
    );
  }
  return (
    <>
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
        <div style={{ fontSize: 11, color: '#6B7A8D', marginTop: 2 }}>{meta.tagline}</div>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.slice(0, 30).map((e) => <CanonicalEventCard key={e.event_id} ev={e} />)}
          {events.length > 30 && <div style={{ fontSize: 11, color: '#6B7A8D', textAlign: 'center' }}>Showing 30 of {events.length}.</div>}
        </div>
      )}
    </div>
  );
}

// PATCH 0128 — extract offer price / consideration from filing title text.
// Returns USD or INR amount as a number, plus currency symbol.  Crude but
// effective: regex catches '$23.50 per share', 'Rs 750', '₹1,250', '750/-'
// patterns we see in tender / open-offer titles.
function parseDealPrice(text: string): { amount: number; currency: string } | null {
  if (!text) return null;
  // USD: $XX.XX or USD XX.XX per share
  let m = text.match(/(?:\$|USD\s*)\s*([\d,]+\.?\d*)\s*(?:per\s+share|\/share)?/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 100000) return { amount: n, currency: '$' };
  }
  // INR: Rs / ₹ / INR
  m = text.match(/(?:rs\.?|₹|inr)\s*([\d,]+\.?\d*)\s*(?:per\s+share|\/-?)?/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 1000000) return { amount: n, currency: '₹' };
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
  const spreadPct = offer != null && cmp != null && cmp > 0 ? ((offer - cmp) / cmp) * 100 : null;
  // Crude time-to-close estimate: tender offers typically 30-60d, going-private
  // ~120d, M&A definitive ~180d.  Fallback 60d if no event_type hint.
  const daysToCloseGuess =
    ev.event_type === 'TENDER_OFFER' || ev.event_type === 'BUYBACK_TENDER' ? 35 :
    ev.event_type === 'OPEN_OFFER' || ev.event_type === 'GOING_PRIVATE'    ? 90 :
    ev.event_type === 'MERGER_DEFINITIVE' || ev.event_type === 'ACQUISITION_PUBLIC' ? 180 :
    ev.event_type === 'SPIN_OFF' || ev.event_type === 'DEMERGER_INDIA' || ev.event_type === 'IPO_SUBSIDIARY' ? 120 : 60;
  const annualizedPct = spreadPct != null ? spreadPct * (365 / daysToCloseGuess) : null;
  return (
    <div style={{
      backgroundColor: rejection ? '#1A0E10' : '#0D1B2E',
      border: `1px solid ${rejection ? '#EF444440' : '#1E2D45'}`,
      borderLeft: `3px solid ${rejection ? '#EF4444' : meta.color}`,
      borderRadius: 10,
      opacity: rejection ? 0.85 : 1,
    }}>
      {/* PATCH 0167/0254 — 'MONITOR' chip (was 'REJECTED' — softer, institutional). */}
      {rejection && (
        <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ color: '#94A3B8', fontWeight: 800, letterSpacing: '0.4px' }}>◯ MONITOR</span>
          <span style={{ color: '#C9D4E0', flex: 1, fontStyle: 'italic' }}>{rejection.reason}</span>
          <span style={{ color: '#6B7A8D', fontSize: 10 }}>{new Date(rejection.ts).toLocaleDateString('en-IN')}</span>
          <button onClick={(e) => { e.stopPropagation(); deleteRejection(); }}
            title="Remove monitor flag"
            style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid #94A3B860', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>
            ✕
          </button>
        </div>
      )}
      {showRejectInput && (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '8px 16px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input autoFocus value={draftReason} onChange={(e) => setDraftReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRejection(); if (e.key === 'Escape') setShowRejectInput(false); }}
            placeholder="Reason for monitoring (e.g. await filing, no spread, low confidence)…  Enter to save, Esc to cancel"
            style={{ flex: 1, padding: '4px 8px', backgroundColor: '#0D1623', border: '1px solid #94A3B840', borderRadius: 4, color: '#E6EDF3', fontSize: 11, outline: 'none' }} />
          <button onClick={saveRejection} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #94A3B860', background: '#94A3B815', color: '#94A3B8', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>Save</button>
        </div>
      )}
      <button onClick={() => setExpanded((s) => !s)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, padding: '2px 8px', borderRadius: 4, backgroundColor: `${meta.color}18`, border: `1px solid ${meta.color}40` }}>
            {meta.icon} {ev.event_type.replace(/_/g, ' ')}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: ev.region === 'IN' ? '#FBBF24' : '#22D3EE' }}>
            {ev.region === 'IN' ? '🇮🇳' : ev.region === 'US' ? '🇺🇸' : '🌐'}
          </span>
          {ev.target_name && (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#E6EDF3' }}>{ev.target_name}</span>
          )}
          {ev.tickers.slice(0, 4).map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', border: '1px solid #0F7ABF40', padding: '1px 6px', borderRadius: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {t}
            </span>
          ))}
          {ev.amendment_count > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#F59E0B', padding: '1px 7px', borderRadius: 3, backgroundColor: '#F59E0B18', border: '1px solid #F59E0B40' }}>
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
                style={{ fontSize: 10, fontWeight: 700, color: '#22D3EE', padding: '1px 7px', borderRadius: 3, backgroundColor: '#22D3EE18', border: '1px solid #22D3EE40' }}>
                ×{n} sources
              </span>
            );
          })()}
          {ev.lifecycle && ev.lifecycle !== 'unknown' && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', padding: '1px 6px', borderRadius: 3, backgroundColor: '#1A2840' }}>
              {ev.lifecycle}
            </span>
          )}
          {/* PATCH 0254 — Expected-alpha tag derived from event_type. Tells the
              user WHAT KIND of trade this is before they read the full card. */}
          {(() => {
            const alpha = expectedAlphaFor(ev.event_type);
            if (!alpha) return null;
            return (
              <span title="Expected source of alpha for this event type"
                style={{ fontSize: 10, fontWeight: 700,
                  color: alpha.tone.solid, backgroundColor: alpha.tone.bg,
                  border: `1px solid ${alpha.tone.border}`,
                  padding: '1px 7px', borderRadius: 3,
                }}>
                α {alpha.label}
              </span>
            );
          })()}
          {/* PATCH 0260 — India sub-category tag */}
          {indiaSubcat && (
            <span title="India-specific event sub-type inferred from headline keywords"
              style={{ fontSize: 10, fontWeight: 700, color: '#FBBF24', padding: '1px 7px', borderRadius: 3, backgroundColor: '#FBBF2418', border: '1px solid #FBBF2440' }}>
              🇮🇳 {indiaSubcat}
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#6B7A8D' }}>
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
          <div style={{ marginTop: 4, marginBottom: 6, fontSize: 11, color: '#94A3B8', fontFamily: 'ui-monospace, monospace' }}>
            <span style={{ color: '#22D3EE', fontWeight: 700, marginRight: 6 }}>→</span>
            <span>{nextCat.label}</span>
            {nextCat.daysOut !== null && nextCat.daysOut >= 0 && (
              <span style={{ marginLeft: 8, fontSize: 10, color: '#6B7A8D' }}>· {nextCat.daysOut}d away</span>
            )}
          </div>
        )}
        <div style={{ display: 'none' }}>{/* placeholder to keep JSX shape from previous code */}
        </div>
        <div style={{ fontSize: 13, color: '#E6EDF3', fontWeight: 500, lineHeight: 1.4 }}>{ev.primary_filing.title}</div>
        {/* PATCH 0128 — Inline deal spread / annualized return strip */}
        {(offer != null || cmp != null) && (
          <div style={{ marginTop: 6, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap', color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {offer != null && (
              <span><span style={{ color: '#6B7A8D' }}>Offer:</span> <strong style={{ color: '#E6EDF3' }}>{dealPrice?.currency}{offer.toLocaleString()}</strong></span>
            )}
            {cmp != null && (
              <span><span style={{ color: '#6B7A8D' }}>CMP:</span> <strong style={{ color: '#E6EDF3' }}>{dealPrice?.currency || (ev.region === 'IN' ? '₹' : '$')}{cmp.toLocaleString()}</strong></span>
            )}
            {spreadPct != null && (
              <span><span style={{ color: '#6B7A8D' }}>Spread:</span> <strong style={{ color: spreadPct >= 0 ? '#10B981' : '#EF4444' }}>{spreadPct >= 0 ? '+' : ''}{spreadPct.toFixed(2)}%</strong></span>
            )}
            {annualizedPct != null && (
              <span title={`Assumes ${daysToCloseGuess}d close`}><span style={{ color: '#6B7A8D' }}>Ann:</span> <strong style={{ color: annualizedPct >= 0 ? '#22D3EE' : '#EF4444' }}>{annualizedPct >= 0 ? '+' : ''}{annualizedPct.toFixed(1)}%/yr</strong></span>
            )}
            <span style={{ color: '#6B7A8D' }}>~{daysToCloseGuess}d est. close</span>
          </div>
        )}
        {!expanded && (
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>{ev.tradability_rationale}</span>
            {!rejection && !showRejectInput && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setShowRejectInput(true); }}
                title="Mark as Monitor — defers acting on this event without deleting it"
                style={{ fontSize: 10, padding: '1px 7px', borderRadius: 3, border: '1px solid #94A3B860', color: '#94A3B8', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.4px' }}>
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
              <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderLeft: '3px solid #8B5CF6', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8B5CF6', letterSpacing: '0.4px', marginBottom: 8 }}>
                  📐 PLAYBOOK — {pb.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
                  <div style={{ backgroundColor: '#0D1623', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.5px' }}>AVG CLOSE</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3' }}>{pb.avg_close_days}d</div>
                    <div style={{ fontSize: 9, color: '#6B7A8D' }}>p25–p75: {pb.close_days_range[0]}–{pb.close_days_range[1]}d</div>
                  </div>
                  <div style={{ backgroundColor: '#0D1623', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.5px' }}>SUCCESS RATE</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: pb.success_rate_pct >= 90 ? '#10B981' : pb.success_rate_pct >= 75 ? '#FBBF24' : '#EF4444' }}>
                      {pb.success_rate_pct}%
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#0D1623', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.5px' }}>TYPICAL SPREAD</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#22D3EE' }}>{pb.typical_spread_pct >= 0 ? '+' : ''}{pb.typical_spread_pct}%</div>
                  </div>
                  <div style={{ backgroundColor: '#0D1623', padding: '6px 10px', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.5px' }}>RETAIL OVERHANG</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: pb.retail_overhang === 'YES' ? '#10B981' : pb.retail_overhang === 'SOMETIMES' ? '#FBBF24' : '#6B7A8D' }}>
                      {pb.retail_overhang === 'YES' ? 'YES — arb capture' : pb.retail_overhang}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#C9D4E0', lineHeight: 1.5, marginBottom: 6 }}>
                  <strong style={{ color: '#22D3EE' }}>Tactics:</strong> {pb.tactics}
                </div>
                {pb.failure_modes.length > 0 && (
                  <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.5 }}>
                    <strong style={{ color: '#EF4444' }}>Failure modes:</strong> {pb.failure_modes.join(' · ')}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Why tradable */}
          <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 6 }}>WHY TRADABLE</div>
            <div style={{ fontSize: 11.5, color: '#C9D4E0', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: '#10B981' }}>What happened:</strong> {ev.why_tradable.what_happened}</p>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: '#FBBF24' }}>What matters:</strong> {ev.why_tradable.what_matters}</p>
              <p style={{ margin: '0 0 6px' }}><strong style={{ color: '#22D3EE' }}>What to watch:</strong> {ev.why_tradable.what_to_watch}</p>
              <p style={{ margin: 0 }}><strong style={{ color: '#EF4444' }}>What breaks thesis:</strong> {ev.why_tradable.what_breaks_thesis}</p>
            </div>
          </div>
          {/* Catalyst score breakdown */}
          <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 6 }}>
              CATALYST SCORE — raw {ev.catalyst_score.raw_score} · decay-adjusted {ev.catalyst_score.decay_score.toFixed(1)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11 }}>
              {ev.catalyst_score.components.map((c, i) => (
                <div key={i} style={{ color: c.pts > 0 ? '#10B981' : '#EF4444' }}>{c.label}</div>
              ))}
            </div>
          </div>
          {/* Filings list */}
          {ev.filings.length > 1 && (
            <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.4px', marginBottom: 6 }}>ALL FILINGS ({ev.filings.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ev.filings.map((f, i) => (
                  <a key={f.id} href={f.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#C9D4E0', textDecoration: 'none', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ color: '#6B7A8D', minWidth: 16 }}>{i + 1}.</span>
                    <span style={{ flex: 1 }}>{f.title}</span>
                    <span style={{ color: '#6B7A8D', fontSize: 10 }}>{f.source} · {f.age_hours < 24 ? `${f.age_hours}h` : `${Math.round(f.age_hours / 24)}d`}</span>
                    <ExternalLink style={{ width: 10, height: 10, color: '#6B7A8D' }} />
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
  if (isLoading) return <div style={{ color: '#6B7A8D', fontSize: 12, padding: 14 }}>Loading live RSS feeds…</div>;
  if (error)     return <div style={{ color: '#EF4444', fontSize: 12, padding: 14 }}>Failed to load corporate-action feed.</div>;

  if (!tier1.length && !tier2.length && !archive.length) {
    return (
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 10, padding: 24, color: '#6B7A8D', fontSize: 13, textAlign: 'center' }}>
        <AlertTriangle style={{ width: 20, height: 20, marginBottom: 8, color: '#F59E0B' }} />
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
        <div style={{ fontSize: 11, color: '#6B7A8D', marginTop: 2 }}>{meta.tagline}</div>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.slice(0, 50).map((e) => <EventRow key={e.id} ev={e} />)}
          {events.length > 50 && <div style={{ fontSize: 11, color: '#6B7A8D', textAlign: 'center' }}>Showing 50 of {events.length}.</div>}
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
    <a href={ev.link} target="_blank" rel="noopener noreferrer" style={{ display: 'block', backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${meta.color}`, borderRadius: 10, padding: '12px 16px', textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, padding: '2px 8px', borderRadius: 4, backgroundColor: `${meta.color}18`, border: `1px solid ${meta.color}40` }}>
          {meta.icon} {meta.label}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: ev.region === 'IN' ? '#FBBF24' : '#22D3EE' }}>
          {ev.region === 'IN' ? '🇮🇳' : ev.region === 'US' ? '🇺🇸' : '🌐'}
        </span>
        {ev.tickers.slice(0, 5).map((t) => (
          <span key={t} style={{ fontSize: 11, fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', border: '1px solid #0F7ABF40', padding: '2px 6px', borderRadius: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {t}
          </span>
        ))}
        {fresh && (
          <span style={{ fontSize: 10, fontWeight: 800, color: '#0A1422', backgroundColor: '#FBBF24', padding: '1px 7px', borderRadius: 3 }}>
            🆕 {ageLabel}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#6B7A8D' }}>Score {ev.score}/100</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {ev.source}
          <ExternalLink style={{ width: 11, height: 11 }} />
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#E6EDF3', fontWeight: 500, lineHeight: 1.5 }}>{ev.title}</div>
      {ev.description && (
        <div style={{ fontSize: 11, color: '#6B7A8D', lineHeight: 1.55, marginTop: 6 }}>
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
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 4 }}>{e.phase}</div>
            <div style={{ fontSize: 12, color: '#C9D4E0', lineHeight: 1.55 }}>{e.text}</div>
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
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #22D3EE', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 14 }}>Universal J-Curve — All Spin-offs / Demergers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <JCell phase="Day 1 – Month 3"  ret="−8 to −15%"        note="Forced selling · Index exclusion · ETF dumps" color="#EF4444" />
          <JCell phase="Month 3 – 9"      ret="Recovery"           note="Management refocuses · Cost cuts visible · Analyst coverage starts" color="#F59E0B" />
          <JCell phase="Month 9 – 24"     ret="+12 to +29%"        note="Above-market performance · Institutional buildup" color="#10B981" />
          <JCell phase="Month 24 – 36"    ret="+28% above market"  note="Peak rerating · M&A premium possible" color="#10B981" />
          <JCell phase="Month 36+"        ret="Diverges"           note="Winners compound · Losers plateau · Review thesis" color="#94A3B8" />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#6B7A8D', lineHeight: 1.5 }}>
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
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}40`, borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 4 }}>{phase}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color, marginBottom: 4 }}>{ret}</div>
      <div style={{ fontSize: 10.5, color: '#6B7A8D', lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}

function PGrid({ title, color, items }: { title: string; color: string; items: Array<{ sym: string; label: string; text: string }> }) {
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ color, fontWeight: 800, fontSize: 14 }}>{it.sym}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#E6EDF3' }}>{it.label}</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#94A3B8', lineHeight: 1.55, paddingLeft: 22 }}>{it.text}</div>
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
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #22D3EE', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 12 }}>📐 SIMPLE MERGER-ARB CALCULATOR</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, marginBottom: 14 }}>
        <NumIn label="Offer price" value={offerPrice} onChange={setOfferPrice} step={1} />
        <NumIn label="Spot price (CMP)" value={spotPrice} onChange={setSpotPrice} step={1} />
        <div>
          <div style={{ fontSize: 10, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 4 }}>EXPECTED CLOSE</div>
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #1E2D45', backgroundColor: '#060E1A', color: '#E6EDF3', fontSize: 13 }}
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
        <div style={{ fontSize: 12, color: '#6B7A8D' }}>Provide valid offer, spot, and close date.</div>
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
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #FBBF24', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 12 }}>📊 INDIAN TENDER BUYBACK CALCULATOR</div>
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
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #FBBF24', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 12 }}>💰 FLOATING-DEAL CALCULATOR (Stock + Cash Merger Arb)</div>
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
      <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{label}</div>
      <input type="number" value={value} step={step ?? 'any'} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%', padding: '6px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, border: '1px solid #1A2840', backgroundColor: '#0A1422', color: '#E6EDF3', borderRadius: 4, outline: 'none' }} />
    </div>
  );
}

function ResultCard({ title, color, rows }: { title: string; color: string; rows: Array<[string, string]> }) {
  return (
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}40`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 8 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} style={{ borderTop: '1px solid #1A2840' }}>
              <td style={{ padding: '5px 0', color: '#94A3B8' }}>{k}</td>
              <td style={{ padding: '5px 0', color: '#E6EDF3', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</td>
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
    <div style={{ backgroundColor: '#0A1422', border: highlight ? '1px solid #FBBF2440' : '1px solid #1A2840', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: 14, color: c, fontWeight: 800, marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2, fontStyle: 'italic' }}>{hint}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVER — raw RSS scanner with source-health diagnostics
// ═══════════════════════════════════════════════════════════════════════════

function DiscoverScanner({ feed, isLoading, error, refetch, isFetching, region, setRegion }: { feed?: LiveFeedResp; isLoading: boolean; error: any; refetch: () => any; isFetching: boolean; region: 'ALL'|'IN'|'US'|'GLOBAL'; setRegion: (r: 'ALL'|'IN'|'US'|'GLOBAL') => void }) {
  if (isLoading) return <div style={{ color: '#6B7A8D', fontSize: 12, padding: 14 }}>Loading…</div>;
  if (error)     return <div style={{ color: '#EF4444', fontSize: 12, padding: 14 }}>Failed to load.</div>;
  if (!feed)     return null;

  const filterReg = (items: LiveFeedItem[]) =>
    region === 'ALL' ? items : items.filter((i) => i.region === region);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #22D3EE', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 8 }}>🔴 LIVE FEED — Raw Discovery</div>
        <div style={{ fontSize: 11, color: '#6B7A8D', lineHeight: 1.55, marginBottom: 8 }}>
          14 RSS feeds (ET / Livemint / BS / NDTV / Reuters / MarketWatch / SeekingAlpha / CNBC / Yahoo) hit directly with corporate-action classifiers. {feed.total} matches · {feed.source_status.filter((s)=>s.ok).length}/{feed.source_status.length} sources OK.
        </div>
        <button onClick={() => refetch()} disabled={isFetching} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #1A2840', backgroundColor: 'transparent', color: '#8A95A3', cursor: isFetching ? 'not-allowed' : 'pointer' }}>
          {isFetching ? 'Refreshing…' : '↻ Refresh now'}
        </button>
      </div>

      {(['SPIN','MA','TURN','CAP'] as Category[]).map((cat) => {
        const items = filterReg(feed.by_category[cat] || []);
        const meta = CAT_META[cat];
        return (
          <div key={cat} style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${meta.color}`, borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: meta.color, letterSpacing: '0.4px', marginBottom: 8 }}>{meta.icon} {meta.label} · {items.length}</div>
            {items.length === 0 ? (
              <div style={{ fontSize: 11, color: '#6B7A8D' }}>No matches{region !== 'ALL' && <> for {region}</>}.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.slice(0, 12).map((it) => (
                  <a key={it.id} href={it.link} target="_blank" rel="noopener noreferrer" style={{ display: 'block', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '8px 12px', textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 10 }}>{it.region === 'IN' ? '🇮🇳' : it.region === 'US' ? '🇺🇸' : '🌐'}</span>
                      {it.tickers.slice(0, 4).map((t) => (
                        <span key={t} style={{ fontSize: 10, fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', border: '1px solid #0F7ABF40', padding: '1px 6px', borderRadius: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{t}</span>
                      ))}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6B7A8D' }}>{it.source} · {it.age_hours < 24 ? `${it.age_hours}h` : `${Math.round(it.age_hours/24)}d`}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#E6EDF3', lineHeight: 1.45 }}>{it.title}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Source health */}
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 12, padding: '10px 14px' }}>
        <div style={{ fontSize: 11, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>RSS source health</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {feed.source_status.map((s) => (
            <span key={s.name} title={s.ok ? `${s.items ?? 0} items` : 'Failed'} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, color: s.ok ? '#10B981' : '#EF4444', backgroundColor: s.ok ? '#10B98115' : '#EF444415', border: `1px solid ${s.ok ? '#10B98140' : '#EF444440'}` }}>
              {s.ok ? '✓' : '✗'} {s.name}{s.ok && s.items != null ? ` (${s.items})` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
