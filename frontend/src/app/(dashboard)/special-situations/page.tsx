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

interface LiveFeedResp {
  last_updated: string;
  total: number;
  by_category: Record<Category, LiveFeedItem[]>;
  source_status: Array<{ name: string; ok: boolean; items?: number }>;
  cached?: boolean;
  cache_age_min?: number;
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

  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/special-situations?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const { data: feed, isLoading, error, dataUpdatedAt, refetch, isFetching } = useLiveFeed();

  // Flatten into a single list, score, tier, region-filter
  const allEvents: ScoredEvent[] = useMemo(() => {
    if (!feed) return [];
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
  const catCounts: Record<Category, number> = { SPIN: 0, MA: 0, TURN: 0, CAP: 0 };
  for (const e of allEvents) catCounts[e.category]++;

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
          <Stat label="Tier 1 (hard catalyst)" value={tier1.length} color="#EF4444" />
          <Stat label="Tier 2 (watchlist)" value={tier2.length} color="#F59E0B" />
          <Stat label="Archive" value={archive.length} color="#6B7A8D" />
          <span style={{ width: 1, backgroundColor: '#1A2840', margin: '4px 4px' }} />
          {(Object.keys(CAT_META) as Category[]).map((c) => (
            <Stat key={c} label={CAT_META[c].label} value={catCounts[c]} color={CAT_META[c].color} icon={CAT_META[c].icon} />
          ))}
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
        {active === 'all' && <AllSituations isLoading={isLoading} error={error} tier1={tier1} tier2={tier2} archive={archive} />}
        {active === 'timing' && <TimingRules />}
        {active === 'playbook' && <Playbook />}
        {active === 'math' && <MathPanels />}
        {active === 'discover' && <DiscoverScanner feed={feed} isLoading={isLoading} error={error} refetch={refetch} isFetching={isFetching} region={region} setRegion={setRegion} />}
      </div>
    </div>
  );
}

function Stat({ label, value, color, icon }: { label: string; value: number | string; color: string; icon?: string }) {
  return (
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`, borderRadius: 6, padding: '6px 12px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.1 }}>{icon ? `${icon} ` : ''}{value}</div>
      <div style={{ fontSize: 9.5, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ALL SITUATIONS — pure data-driven event cards
// ═══════════════════════════════════════════════════════════════════════════

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
      <AcceptanceCalc />
      <FloatingCalc />
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
