'use client';

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGIC VISIBILITY — patch 0064
//
// Parallel intelligence layer to Bottlenecks. Detects companies whose
// future revenue base structurally changed via mega contracts, hyperscaler
// leases, defense appropriations, sovereign programs, AI infra capacity
// reservations.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
// PATCH 0274 — Shared freshness chip.
import { PanelFreshness } from '@/components/PanelFreshness';
import api from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

interface SVSignal {
  qualifies: boolean;
  theme: string;
  counterparty_tier: string;
  counterparty_name?: string;
  contract_value_usd_m?: number;
  visibility_years?: number;
  pct_of_mcap?: number;
  pct_of_ltm_revenue?: number;
  flags: string[];
  is_chokepoint_override: boolean;
  is_policy_framework: boolean;
  reason: string;
}

interface SVCapacityReserved {
  unit: string;
  amount: number;
  raw_phrase: string;
}

interface SVSecondOrder {
  beneficiaries: string[];
  risk: string[];
}

// PATCH 0072: institutional dimensions
interface SVSecondaryDemandLine {
  category: string;
  est_usd_per_mw_k: number;
  rationale: string;
  beneficiary_tickers?: string[];
}
interface SVImpliedSecondaryDemand {
  basis_mw: number;
  total_secondary_demand_usd_m: number;
  lines: SVSecondaryDemandLine[];
}

type SVChokepointCategory = 'EUV_LITHO' | 'COWOS_PACKAGING' | 'HBM_MEMORY' | 'ABF_SUBSTRATES' | 'TRANSFORMERS_LARGE' | 'SWITCHGEAR_HV' | 'GAS_TURBINES_LARGE' | 'GRID_INTERCONNECT' | 'HALEU_ENRICHMENT' | 'NAVAL_PROPULSION' | 'AERO_ENGINES' | 'MISSILE_SEEKERS_RF' | 'AI_GPU_CLUSTERS' | 'LIQUID_COOLING_AI' | 'OPTICAL_INTERCONNECT_800G' | 'RARE_EARTH_MAGNETS' | 'URANIUM_WESTERN' | 'NONE';

interface SVArticle {
  id: string;
  title: string;
  source_name: string;
  source_url: string;
  published_at: string;
  region: string;
  ticker_symbols?: string[];
  primary_ticker?: string | null;
  strategic_visibility: SVSignal;
  // PATCH 0067: v2 enhancements
  sv_signal_quality_tier?: 'A_FILING' | 'B_TIER1_MEDIA' | 'C_INDUSTRY' | 'D_SPECULATIVE' | null;
  sv_capacity_reserved?: SVCapacityReserved | null;
  sv_dependency_score?: number | null;
  sv_dependency_rationale?: string | null;
  sv_why_this_matters?: string | null;
  sv_second_order?: SVSecondOrder | null;
  sv_formatted_line?: string | null;
  // PATCH 0072: institutional dimensions
  funding_confidence?: 1 | 2 | 3 | 4 | 5 | null;
  funding_confidence_rationale?: string | null;
  execution_status?: 'ANNOUNCED' | 'SIGNED' | 'FINANCIAL_CLOSE' | 'POWER_SECURED' | 'UNDER_CONSTRUCTION' | 'OPERATIONAL' | null;
  revenue_profile?: 'AI_TAKE_OR_PAY' | 'ANNUITY_INFRA' | 'MID_MARGIN_DEFENSE' | 'LOW_MARGIN_BUILD' | 'CAPITAL_INTENSIVE_FAB' | 'OPTION_VALUE' | 'UNCLASSIFIED' | null;
  revenue_profile_ebitda_band?: string | null;
  revenue_profile_cash_conversion?: string | null;
  revenue_profile_working_capital?: string | null;
  revenue_profile_rationale?: string | null;
  implied_secondary_demand?: SVImpliedSecondaryDemand | null;
  // PATCH 0073: chokepoint + WC numeric
  chokepoint_category?: SVChokepointCategory | null;
  chokepoint_label?: string | null;
  chokepoint_severity?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  chokepoint_competitors?: string | null;
  chokepoint_rationale?: string | null;
  chokepoint_primary_tickers?: string[] | null;
  working_capital_intensity_pct?: number | null;
  _rank: number;
}

interface SVResponse {
  section_title: string;
  section_subtitle: string;
  window_days?: number;
  count: number;
  total_in_ledger?: number;
  summary?: {
    by_theme?: Record<string, number>;
    by_flag?: Record<string, number>;
    by_quality_tier?: Record<string, number>;
    newest_recorded_at?: string | null;
    oldest_in_window_at?: string | null;
  };
  articles: SVArticle[];
}

const FLAG_LABEL: Record<string, string> = {
  MCAP_GRADE:           '🌟 mcap-grade',
  BACKLOG_RESET:        '🔥 backlog reset',
  DECADE_VISIBILITY:    '✅ 10y visibility',
  STRATEGIC_CHOKEPOINT: '🔒 chokepoint',
  POLICY_BACKED:        '🧭 policy-backed',
};

const FLAG_COLOR: Record<string, string> = {
  MCAP_GRADE:           '#F59E0B',  // amber
  BACKLOG_RESET:        '#EF4444',  // red
  DECADE_VISIBILITY:    '#10B981',  // green
  STRATEGIC_CHOKEPOINT: '#8B5CF6',  // purple
  POLICY_BACKED:        '#22D3EE',  // cyan
};

const THEME_LABEL: Record<string, string> = {
  AI_INFRASTRUCTURE:         'AI Infrastructure',
  ENERGY_TRANSITION:         'Energy Transition',
  DEFENSE_AEROSPACE:         'Defense / Aerospace',
  SEMI_SUPPLY_CHAIN:         'Semi Supply Chain',
  CRITICAL_NATIONAL_PROGRAM: 'National Program',
  HYPERSCALER_LEASE:         'Hyperscaler Lease',
  NEOCLOUD_AI_INFRA:         'Neocloud AI Infra',
  QUANTUM_CRYPTO:            'Quantum / Crypto',
  POWER_GRID:                'Power / Grid',
};

const COUNTERPARTY_LABEL: Record<string, string> = {
  HYPERSCALER:        'Hyperscaler',
  TIER1_GOV_DEFENSE:  'Tier-1 Gov',
  TOP3_UTILITY:       'Top-3 Utility',
  MAJOR_FINANCIAL:    'Major Financial',
  OTHER:              'Other',
};

// PATCH 0067: Signal Quality Tier display
const SQ_LABEL: Record<string, string> = {
  A_FILING:       'A · Filing',
  B_TIER1_MEDIA:  'B · Tier-1 Media',
  C_INDUSTRY:     'C · Industry',
  D_SPECULATIVE:  'D · Speculative',
};
const SQ_COLOR: Record<string, string> = {
  A_FILING:       '#10B981',  // green — primary filing
  B_TIER1_MEDIA:  '#22D3EE',  // cyan — Tier-1 media
  C_INDUSTRY:     '#F59E0B',  // amber — industry / specialist
  D_SPECULATIVE:  '#EF4444',  // red — speculative / single-source
};

// Dependency Score (1-5) display
function depDots(score: number): string {
  return '●'.repeat(Math.max(0, Math.min(5, score))) + '○'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, score))));
}
function depColor(score: number): string {
  if (score >= 5) return '#8B5CF6';     // chokepoint
  if (score >= 4) return '#10B981';     // very hard to replace
  if (score >= 3) return '#22D3EE';     // hard
  if (score >= 2) return '#F59E0B';     // moderate
  return '#6B7A8D';                     // easy / replaceable
}

function fmtCapacity(c?: SVCapacityReserved | null): string {
  if (!c) return '';
  const unitLabel = c.unit.replace('_', ' ').replace('pm', '/mo');
  return `${c.amount.toLocaleString()} ${unitLabel}`;
}

// PATCH 0072: institutional dimension display
const FUNDING_LABEL: Record<number, string> = {
  5: 'A · Definitive',
  4: 'B · Approved/phased',
  3: 'C · MoU/pending',
  2: 'D · Policy intent',
  1: 'E · Conceptual',
};
const FUNDING_COLOR: Record<number, string> = {
  5: '#10B981', 4: '#22D3EE', 3: '#F59E0B', 2: '#EF4444', 1: '#6B7A8D',
};

const EXEC_LABEL: Record<string, string> = {
  ANNOUNCED:           'Announced',
  SIGNED:              'Signed',
  FINANCIAL_CLOSE:     'Fin close',
  POWER_SECURED:       'Power secured',
  UNDER_CONSTRUCTION:  'Under constr.',
  OPERATIONAL:         'Operational',
};
const EXEC_COLOR: Record<string, string> = {
  ANNOUNCED:           '#6B7A8D',
  SIGNED:              '#22D3EE',
  FINANCIAL_CLOSE:     '#3B82F6',
  POWER_SECURED:       '#8B5CF6',
  UNDER_CONSTRUCTION:  '#F59E0B',
  OPERATIONAL:         '#10B981',
};

const REVENUE_LABEL: Record<string, string> = {
  AI_TAKE_OR_PAY:        'AI take-or-pay',
  ANNUITY_INFRA:         'Annuity infra',
  MID_MARGIN_DEFENSE:    'Mid-margin defence',
  LOW_MARGIN_BUILD:      'Low-margin build',
  CAPITAL_INTENSIVE_FAB: 'Capital-intensive fab',
  OPTION_VALUE:          'Option value',
  UNCLASSIFIED:          '—',
};
const REVENUE_COLOR: Record<string, string> = {
  AI_TAKE_OR_PAY:        '#10B981',
  ANNUITY_INFRA:         '#22D3EE',
  MID_MARGIN_DEFENSE:    '#F59E0B',
  LOW_MARGIN_BUILD:      '#EF4444',
  CAPITAL_INTENSIVE_FAB: '#8B5CF6',
  OPTION_VALUE:          '#94A3B8',
  UNCLASSIFIED:          '#4A5B6C',
};

// PATCH 0073: chokepoint severity helpers
function chokepointSevColor(s: number): string {
  if (s >= 5) return '#8B5CF6';
  if (s >= 4) return '#22D3EE';
  if (s >= 3) return '#10B981';
  if (s >= 2) return '#F59E0B';
  return '#6B7A8D';
}
function chokepointSevDots(s: number): string {
  return '●'.repeat(Math.max(0, Math.min(5, s))) + '○'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, s))));
}

// PATCH 0073: macro-pattern banner derivation.
// Returns a 1-line headline + sub-explanation auto-derived from the
// distribution of qualifying contracts by theme + flag.
function buildMacroInsight(articles: SVArticle[]): { headline: string; sub: string; accent: string } {
  if (articles.length === 0) {
    return { headline: '', sub: '', accent: '#22D3EE' };
  }

  const themeCounts: Record<string, number> = {};
  const profileCounts: Record<string, number> = {};
  let chokepointCount = 0;
  let totalUsdM = 0;
  for (const a of articles) {
    const t = a.strategic_visibility?.theme || 'NONE';
    themeCounts[t] = (themeCounts[t] || 0) + 1;
    const p = a.revenue_profile || 'UNCLASSIFIED';
    profileCounts[p] = (profileCounts[p] || 0) + 1;
    if ((a.chokepoint_severity ?? 0) >= 4) chokepointCount++;
    totalUsdM += a.strategic_visibility?.contract_value_usd_m || 0;
  }

  // Industrial-capacity themes (the user's macro insight pattern)
  const industrialThemes = ['ENERGY_TRANSITION', 'POWER_GRID', 'DEFENSE_AEROSPACE', 'SEMI_SUPPLY_CHAIN', 'CRITICAL_NATIONAL_PROGRAM', 'AI_INFRASTRUCTURE', 'HYPERSCALER_LEASE', 'NEOCLOUD_AI_INFRA'];
  const industrialCount = industrialThemes.reduce((s, t) => s + (themeCounts[t] || 0), 0);
  const industrialPct = articles.length > 0 ? Math.round((industrialCount / articles.length) * 100) : 0;

  const aiInfraCount = (themeCounts['AI_INFRASTRUCTURE'] || 0) + (themeCounts['HYPERSCALER_LEASE'] || 0) + (themeCounts['NEOCLOUD_AI_INFRA'] || 0);
  const energyDefenceCount = (themeCounts['ENERGY_TRANSITION'] || 0) + (themeCounts['POWER_GRID'] || 0) + (themeCounts['DEFENSE_AEROSPACE'] || 0) + (themeCounts['CRITICAL_NATIONAL_PROGRAM'] || 0);
  const totalFmt = totalUsdM >= 1000 ? `$${(totalUsdM / 1000).toFixed(1)}B` : `$${Math.round(totalUsdM)}M`;

  if (industrialPct >= 80) {
    return {
      headline: 'Markets are repricing scarce industrial capacity — not software',
      sub: `${industrialCount} of ${articles.length} contracts (${industrialPct}%) are AI infra / energy / defence / semi / sovereign. ${chokepointCount} are sub-3 chokepoints. Cumulative book ${totalFmt}.`,
      accent: '#8B5CF6',
    };
  }
  if (aiInfraCount >= energyDefenceCount && aiInfraCount >= 3) {
    return {
      headline: 'AI infrastructure capex dominating',
      sub: `${aiInfraCount} hyperscaler / neocloud lease frameworks vs ${energyDefenceCount} energy + defence frameworks. ${chokepointCount} sub-3 chokepoints. Cumulative ${totalFmt}.`,
      accent: '#22D3EE',
    };
  }
  if (energyDefenceCount > aiInfraCount) {
    return {
      headline: 'Energy + defence sovereignty is the dominant capital cycle',
      sub: `${energyDefenceCount} energy / defence / sovereign-program frameworks vs ${aiInfraCount} AI infra. ${chokepointCount} sub-3 chokepoints. Cumulative ${totalFmt}.`,
      accent: '#F59E0B',
    };
  }
  return {
    headline: 'Mixed institutional capex backdrop',
    sub: `${articles.length} qualifying contracts across ${Object.keys(themeCounts).length} themes. ${chokepointCount} sub-3 chokepoints. Cumulative ${totalFmt}.`,
    accent: '#10B981',
  };
}

function fmtMoney(usdM?: number): string {
  if (usdM === undefined) return '—';
  if (usdM >= 1000) return `$${(usdM / 1000).toFixed(1)}B`;
  if (usdM >= 100)  return `$${usdM.toFixed(0)}M`;
  return `$${usdM.toFixed(1)}M`;
}

function fmtAge(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return ''; }
}

// PATCH 0068 + 0070: pull the rolling ledger by default. Default 365d (1Y).
// Users can drop to 30/90/6M for recency or extend to 24M (2Y) for full
// backlog reference.
// PATCH 0439 BUG-030 — localStorage cache prime so cold load doesn't flash
// ALL:0 / IN:0 / US:0. The 365-day rolling ledger is persisted on the
// backend; on the frontend we cache the last successful response in LS so
// returning users see real counts immediately while React Query refetches
// fresh in background.
const SV_LS_KEY = (days: number) => `mc:strategic-vis:v1:${days}`;

function useStrategic(windowDays: number = 365) {
  return useQuery<SVResponse>({
    queryKey: ['news', 'transformational', windowDays],
    queryFn: async () => {
      const { data } = await api.get(`/news?transformational=1&window_days=${windowDays}`);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(SV_LS_KEY(windowDays), JSON.stringify({ data, ts: Date.now() }));
        }
      } catch {}
      return data;
    },
    initialData: (() => {
      if (typeof window === 'undefined') return undefined;
      try {
        const raw = window.localStorage.getItem(SV_LS_KEY(windowDays));
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        // Use cache only if less than 6 hours old
        if (Date.now() - (parsed.ts || 0) > 6 * 3600_000) return undefined;
        return parsed.data;
      } catch { return undefined; }
    })(),
    refetchInterval: 5 * 60_000,   // 5 min
    staleTime: 5 * 60_000,
  });
}

export default function StrategicVisibilityPage() {
  const [windowDays, setWindowDays] = React.useState<30 | 90 | 180 | 365 | 730>(365);
  // PATCH 0071: region filter + sort toggle
  const [regionFilter, setRegionFilter] = React.useState<'ALL' | 'IN' | 'US'>('ALL');
  const [sortMode, setSortMode] = React.useState<'rank' | 'recent'>('rank');
  const { data, isLoading, isFetching, dataUpdatedAt } = useStrategic(windowDays);

  const articles = useMemo(() => {
    const base = data?.articles ?? [];
    // Region filter — match IN, US, or both (GLOBAL passes through ALL)
    const filtered = regionFilter === 'ALL'
      ? base
      : base.filter((a) => a.region === regionFilter || (regionFilter === 'US' && a.region === 'GLOBAL'));
    // Sort
    if (sortMode === 'recent') {
      return [...filtered].sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
    }
    return filtered;  // server returns rank-sorted
  }, [data?.articles, regionFilter, sortMode]);

  // Group by theme so users can scan by category
  const grouped = useMemo(() => {
    const out: Record<string, SVArticle[]> = {};
    for (const a of articles) {
      const t = a.strategic_visibility.theme;
      if (!out[t]) out[t] = [];
      out[t].push(a);
    }
    return out;
  }, [articles]);

  // Per-region counts for filter chip badges
  const regionCounts = useMemo(() => {
    const all = data?.articles ?? [];
    return {
      ALL: all.length,
      IN: all.filter((a) => a.region === 'IN').length,
      US: all.filter((a) => a.region === 'US' || a.region === 'GLOBAL').length,
    };
  }, [data?.articles]);

  return (
    <div style={{ minHeight: '100%', backgroundColor: 'var(--mc-bg-0)', padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--mc-text-0)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            🌟 <span style={{ background: 'linear-gradient(90deg,#8B5CF6,var(--mc-cyan))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Transformational Contracts</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--mc-cyan)', backgroundColor: '#22D3EE10', border: '1px solid #22D3EE40', padding: '3px 8px', borderRadius: 4, letterSpacing: '0.4px' }}>
              ROLLING {windowDays}D LEDGER
            </span>
            {/* PATCH 0274 — Freshness chip. Turns amber if the 5-min refresh stalls. */}
            <PanelFreshness dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} staleAfterMs={10 * 60_000} />
          </h1>
          <p style={{ fontSize: 12, color: 'var(--mc-text-4)', margin: '4px 0 0', lineHeight: 1.5 }}>
            Multi-year frameworks · hyperscaler commitments · sovereign programs · transformational revenue locks.
            Persisted to KV with a {windowDays}-day rolling window — independent of the live news feed.
          </p>
          {/* AUDIT_100 #45 / #84 — one-line legend so users know what the chips rank.
              Funding 5 = financial close (most certain), 1 = press release only.
              Execution ladder: Announced → Signed → Fin close → Power secured → Under constr → Operational. */}
          <p style={{ fontSize: 10.5, color: 'var(--mc-text-4)', margin: '6px 0 0', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--mc-text-3)', fontWeight: 700 }}>LEGEND:</span>{' '}
            <span style={{ color: 'var(--mc-bullish)' }}>FUNDING 5 = financial close</span> →{' '}
            <span style={{ color: 'var(--mc-cyan)' }}>4 binding</span> →{' '}
            <span style={{ color: 'var(--mc-warn)' }}>3 signed LOI</span> →{' '}
            <span style={{ color: 'var(--mc-bearish)' }}>2 mou</span> →{' '}
            <span style={{ color: 'var(--mc-text-4)' }}>1 press release</span>{' '}
            · <span style={{ color: 'var(--mc-text-3)' }}>EXEC ladder:</span> Announced → Signed → Fin close → Power secured → Under constr. → Operational
          </p>
          {/* PATCH 0068 + 0070: window selector with 1Y / 2Y options */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px' }}>WINDOW:</span>
            {[30, 90, 180, 365, 730].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d as 30 | 90 | 180 | 365 | 730)}
                style={{
                  fontSize: 10, fontWeight: 700,
                  color: windowDays === d ? 'var(--mc-cyan)' : 'var(--mc-text-4)',
                  backgroundColor: windowDays === d ? '#22D3EE15' : 'transparent',
                  border: `1px solid ${windowDays === d ? '#22D3EE60' : 'var(--mc-border-1)'}`,
                  borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
                  letterSpacing: '0.4px',
                }}
              >
                {d === 30 ? '30D' : d === 90 ? '3M' : d === 180 ? '6M' : d === 365 ? '1Y' : '2Y'}
              </button>
            ))}
            {data?.total_in_ledger !== undefined && data.total_in_ledger > articles.length && (
              <span style={{ fontSize: 10, color: 'var(--mc-warn)', marginLeft: 8, fontWeight: 700 }}>
                {articles.length} in window · {data.total_in_ledger} total in ledger ·{' '}
                <button
                  onClick={() => setWindowDays(730)}
                  style={{ fontSize: 10, fontWeight: 700, color: 'var(--mc-cyan)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  expand to 2Y
                </button>
              </span>
            )}
            {data?.summary?.oldest_in_window_at && (
              <span style={{ fontSize: 10, color: 'var(--mc-text-4)', marginLeft: 8 }}>
                Oldest in window: {new Date(data.summary.oldest_in_window_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          {/* PATCH 0071: Region filter + sort toggle.
              PATCH 0569 (UX #6) — Show a skeleton bar in the count badge
              on cold load instead of '0', which previously made it look
              like the region had no data when really we hadn't fetched
              yet. The skeleton shimmer matches the rest of the page. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px' }}>REGION:</span>
            {(['ALL', 'IN', 'US'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRegionFilter(r)}
                style={{
                  fontSize: 10, fontWeight: 700,
                  color: regionFilter === r ? 'var(--mc-bullish)' : 'var(--mc-text-4)',
                  backgroundColor: regionFilter === r ? '#10B98115' : 'transparent',
                  border: `1px solid ${regionFilter === r ? '#10B98160' : 'var(--mc-border-1)'}`,
                  borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
                  letterSpacing: '0.4px',
                }}
              >
                {r === 'ALL' ? '🌐 ALL' : r === 'IN' ? '🇮🇳 IN' : '🇺🇸 US'}
                {isLoading && !data ? (
                  <span style={{
                    display: 'inline-block', marginLeft: 5, width: 18, height: 8,
                    verticalAlign: 'middle', borderRadius: 3,
                    background: 'linear-gradient(90deg, var(--mc-bg-4) 0%, #2A3B55 50%, var(--mc-bg-4) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'svShimmer 1.4s linear infinite',
                  }} aria-label="loading count" />
                ) : (
                  <span style={{ marginLeft: 5, color: 'var(--mc-text-4)', fontWeight: 400 }}>{regionCounts[r]}</span>
                )}
              </button>
            ))}
            <span style={{ fontSize: 10, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.5px', marginLeft: 12 }}>SORT:</span>
            {(['rank', 'recent'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortMode(s)}
                style={{
                  fontSize: 10, fontWeight: 700,
                  color: sortMode === s ? 'var(--mc-warn)' : 'var(--mc-text-4)',
                  backgroundColor: sortMode === s ? '#F59E0B15' : 'transparent',
                  border: `1px solid ${sortMode === s ? '#F59E0B60' : 'var(--mc-border-1)'}`,
                  borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
                  letterSpacing: '0.4px',
                }}
              >
                {s === 'rank' ? '▲ By Rank' : '🕒 By Recent'}
              </button>
            ))}
          </div>
        </header>

        {/* Inclusion criteria pinned at top */}
        <div style={{
          backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)', borderLeft: '3px solid #8B5CF6',
          borderRadius: 10, padding: '10px 14px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 700, letterSpacing: '0.8px', marginBottom: 6 }}>
            INCLUSION CRITERIA — only articles meeting ALL of A + B + C qualify
          </div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--mc-text-1)' }}>A. Size:</strong> ≥$300M firm contract OR ≥10× backlog OR ≥20% LTM rev OR ≥10% mcap. Auto-include: 10y+ deal ≥30% mcap. India PSU path: ≥₹500 cr from NTPC / PGCIL / SECI / HAL / BEL with ≥3y visibility.<br/>
            <strong style={{ color: 'var(--mc-text-1)' }}>B. Theme:</strong> AI Infra / Energy Transition / Defense / Semi Supply Chain / Sovereign Program / Hyperscaler Lease / Quantum / Power.<br/>
            <strong style={{ color: 'var(--mc-text-1)' }}>C. Duration:</strong> ≥3y firm visibility (prefer ≥5–10y) with Tier-1 counterparty (Hyperscaler / Gov / Top-3 Utility). Generic "hyperscaler" / "investment-grade tenant" accepted with lease/take-or-pay structure.<br/>
            <strong style={{ color: 'var(--mc-text-1)' }}>Capacity inference:</strong> ≥100MW AI campus + ≥10y → implicit ≥$200M (industry benchmark $20M/MW/y).<br/>
            <strong style={{ color: 'var(--mc-text-1)' }}>Overrides:</strong> 🔒 Chokepoint (sole producer + ≥5y policy-backed) · 🧭 Strategic Program (≥$300M + ≥5y national framework).
          </div>
        </div>

        {/* PATCH 0073: MACRO INSIGHT BANNER — auto-derived dominant pattern */}
        {!isLoading && articles.length > 0 && (() => {
          const insight = buildMacroInsight(articles);
          if (!insight.headline) return null;
          return (
            <div style={{
              backgroundColor: '#0D1B2E',
              border: `1px solid ${insight.accent}40`,
              borderLeft: `3px solid ${insight.accent}`,
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 14,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>📡</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: insight.accent, letterSpacing: '0.8px', marginBottom: 3 }}>
                  MACRO PATTERN — derived from current ledger distribution
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 4 }}>
                  {insight.headline}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mc-text-3)', lineHeight: 1.5 }}>
                  {insight.sub}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Stats row */}
        {!isLoading && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
            {(['MCAP_GRADE','BACKLOG_RESET','DECADE_VISIBILITY','STRATEGIC_CHOKEPOINT','POLICY_BACKED'] as const).map(f => {
              const n = articles.filter(a => a.strategic_visibility.flags.includes(f)).length;
              if (n === 0) return null;
              return (
                <div key={f} style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
                  <span style={{ color: FLAG_COLOR[f], fontWeight: 700 }}>{n}</span>
                  <span style={{ marginLeft: 4 }}>{FLAG_LABEL[f]}</span>
                </div>
              );
            })}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-text-4)' }}>
              {articles.length} qualifying signals
            </div>
          </div>
        )}

        {isLoading && (
          /* PATCH 0445 BUG-030 — Shimmer skeleton rows instead of single
             centred "Computing…" line so cold-load feels populated. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--mc-text-4)', marginBottom: 6 }}>
              📡 Computing strategic visibility…
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                height: 60,
                background: 'linear-gradient(90deg, #0D1B2E 0%, var(--mc-bg-4) 50%, #0D1B2E 100%)',
                backgroundSize: '200% 100%',
                animation: `svShimmer 1.4s linear infinite ${i * 0.08}s`,
                borderRadius: 8,
                opacity: 0.7,
              }} />
            ))}
            <style>{`@keyframes svShimmer{0%{background-position:-200% 0;}100%{background-position:200% 0;}}`}</style>
          </div>
        )}

        {!isLoading && articles.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--mc-text-4)', backgroundColor: '#0D1B2E', borderRadius: 10, border: '1px solid var(--mc-border-1)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, color: 'var(--mc-text-3)', marginBottom: 4 }}>
              {regionFilter !== 'ALL'
                ? `No ${regionFilter} contracts in the rolling ${windowDays}-day window.`
                : `No transformational contracts in the rolling ${windowDays}-day ledger yet.`}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 12 }}>
              The ledger fills as qualifying contracts come in across the news cycle.
              India PSU orders ≥ ₹500 cr from NTPC / PGCIL / SECI / HAL / BEL with ≥3y visibility qualify
              alongside the global ≥$300M Tier-1 path.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {regionFilter !== 'ALL' && (
                <button
                  onClick={() => setRegionFilter('ALL')}
                  style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-bullish)', backgroundColor: '#10B98115', border: '1px solid #10B98160', borderRadius: 4, padding: '6px 14px', cursor: 'pointer' }}
                >
                  Show all regions
                </button>
              )}
              {windowDays < 730 && (
                <button
                  onClick={() => setWindowDays(730)}
                  style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-cyan)', backgroundColor: '#22D3EE15', border: '1px solid #22D3EE60', borderRadius: 4, padding: '6px 14px', cursor: 'pointer' }}
                >
                  Switch to 2-year window
                </button>
              )}
            </div>
          </div>
        )}

        {/* Theme-grouped cards */}
        {!isLoading && Object.entries(grouped).map(([theme, items]) => (
          <section key={theme} style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-cyan)', margin: '0 0 10px', letterSpacing: '0.5px' }}>
              {THEME_LABEL[theme] || theme} <span style={{ color: 'var(--mc-text-4)', fontWeight: 400, marginLeft: 6 }}>({items.length})</span>
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
              {items.map(a => {
                const sv = a.strategic_visibility;
                return (
                  <a
                    key={a.id}
                    href={a.source_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      backgroundColor: '#0D1B2E', border: '1px solid var(--mc-border-1)',
                      borderLeft: `3px solid ${sv.flags.includes('MCAP_GRADE') ? 'var(--mc-warn)' : sv.flags.includes('STRATEGIC_CHOKEPOINT') ? '#8B5CF6' : 'var(--mc-cyan)'}`,
                      borderRadius: 10, padding: '10px 12px',
                      textDecoration: 'none', color: 'inherit',
                      transition: 'border-color 0.15s',
                    }}
                  >
                    {/* Top row: ticker + signal quality + flags */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      {(a.ticker_symbols ?? []).slice(0, 3).map(t => (
                        <span key={t} style={{ fontSize: 10, fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', padding: '2px 6px', borderRadius: 4, border: '1px solid #0F7ABF40' }}>
                          {t}
                        </span>
                      ))}
                      {/* PATCH 0067: Signal Quality Tier badge */}
                      {a.sv_signal_quality_tier && (
                        <span
                          title="Signal source quality — A: company filing, B: Tier-1 media, C: industry/specialist, D: speculative/single-source"
                          style={{
                            fontSize: 9, fontWeight: 700,
                            color: SQ_COLOR[a.sv_signal_quality_tier] || 'var(--mc-text-3)',
                            border: `1px solid ${SQ_COLOR[a.sv_signal_quality_tier] || 'var(--mc-text-3)'}40`,
                            backgroundColor: `${SQ_COLOR[a.sv_signal_quality_tier] || 'var(--mc-text-3)'}10`,
                            padding: '2px 5px', borderRadius: 3,
                          }}
                        >
                          {SQ_LABEL[a.sv_signal_quality_tier] || a.sv_signal_quality_tier}
                        </span>
                      )}
                      {sv.flags.map(f => (
                        <span key={f} style={{ fontSize: 9, fontWeight: 700, color: FLAG_COLOR[f] || 'var(--mc-text-3)' }}>
                          {FLAG_LABEL[f] || f}
                        </span>
                      ))}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mc-text-4)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                        <span style={{ color: 'var(--mc-text-3)', fontWeight: 700 }}>
                          {a.published_at ? new Date(a.published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </span>
                        <span style={{ color: 'var(--mc-text-4)', fontSize: 9 }}>{fmtAge(a.published_at)}</span>
                      </span>
                    </div>
                    {/* Headline */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text-0)', lineHeight: 1.4, marginBottom: 8 }}>
                      {a.title}
                    </div>
                    {/* Metadata grid (4 cells × 2 rows when capacity / dependency present) */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 6 }}>
                      <div>
                        <div style={{ color: 'var(--mc-text-4)' }}>VALUE</div>
                        <div style={{ color: 'var(--mc-text-1)', fontWeight: 700 }}>{fmtMoney(sv.contract_value_usd_m)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--mc-text-4)' }}>VISIBILITY</div>
                        <div style={{ color: 'var(--mc-text-1)', fontWeight: 700 }}>{sv.visibility_years ? `${sv.visibility_years}y` : '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--mc-text-4)' }}>COUNTERPARTY</div>
                        <div style={{ color: 'var(--mc-text-1)', fontWeight: 700 }}>{sv.counterparty_name ?? COUNTERPARTY_LABEL[sv.counterparty_tier] ?? '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--mc-text-4)' }}>% MCAP</div>
                        <div style={{ color: sv.pct_of_mcap && sv.pct_of_mcap >= 30 ? 'var(--mc-bullish)' : 'var(--mc-text-1)', fontWeight: 700 }}>
                          {sv.pct_of_mcap !== undefined ? `${sv.pct_of_mcap}%` : '—'}
                        </div>
                      </div>
                      {/* PATCH 0067: row 2 — Capacity Reserved + Dependency Score */}
                      {(a.sv_capacity_reserved || a.sv_dependency_score) && (
                        <>
                          <div style={{ gridColumn: 'span 2' }}>
                            <div style={{ color: 'var(--mc-text-4)' }}>CAPACITY RESERVED</div>
                            <div style={{ color: a.sv_capacity_reserved ? 'var(--mc-bullish)' : 'var(--mc-text-4)', fontWeight: 700 }}>
                              {a.sv_capacity_reserved ? fmtCapacity(a.sv_capacity_reserved) : '—'}
                            </div>
                          </div>
                          <div style={{ gridColumn: 'span 2' }}>
                            <div style={{ color: 'var(--mc-text-4)' }}>
                              DEPENDENCY <span style={{ color: 'var(--mc-text-4)', fontWeight: 400 }}>(1–5)</span>
                            </div>
                            <div
                              title={a.sv_dependency_rationale || ''}
                              style={{
                                color: depColor(a.sv_dependency_score ?? 1),
                                fontWeight: 700,
                                fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                                letterSpacing: '1px',
                              }}
                            >
                              {depDots(a.sv_dependency_score ?? 1)} <span style={{ marginLeft: 4 }}>{a.sv_dependency_score ?? 1}/5</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {/* PATCH 0072: institutional dimensions strip */}
                    {(a.funding_confidence || a.execution_status || a.revenue_profile) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 6, paddingTop: 6, borderTop: '1px solid var(--mc-bg-4)' }}>
                        {a.funding_confidence != null && (
                          <span
                            title={a.funding_confidence_rationale || ''}
                            style={{
                              fontSize: 9, fontWeight: 700,
                              color: FUNDING_COLOR[a.funding_confidence] || 'var(--mc-text-3)',
                              border: `1px solid ${FUNDING_COLOR[a.funding_confidence]}40`,
                              backgroundColor: `${FUNDING_COLOR[a.funding_confidence]}10`,
                              padding: '2px 6px', borderRadius: 3,
                            }}
                          >
                            FUNDING: {FUNDING_LABEL[a.funding_confidence] || a.funding_confidence}
                          </span>
                        )}
                        {a.execution_status && (
                          <span
                            style={{
                              fontSize: 9, fontWeight: 700,
                              color: EXEC_COLOR[a.execution_status] || 'var(--mc-text-3)',
                              border: `1px solid ${EXEC_COLOR[a.execution_status]}40`,
                              backgroundColor: `${EXEC_COLOR[a.execution_status]}10`,
                              padding: '2px 6px', borderRadius: 3,
                            }}
                          >
                            STATUS: {EXEC_LABEL[a.execution_status] || a.execution_status}
                          </span>
                        )}
                        {a.revenue_profile && a.revenue_profile !== 'UNCLASSIFIED' && (
                          <span
                            title={`${a.revenue_profile_rationale || ''} · EBITDA ${a.revenue_profile_ebitda_band || '—'} · Cash ${a.revenue_profile_cash_conversion || '—'} · WC ${a.revenue_profile_working_capital || '—'}`}
                            style={{
                              fontSize: 9, fontWeight: 700,
                              color: REVENUE_COLOR[a.revenue_profile] || 'var(--mc-text-3)',
                              border: `1px solid ${REVENUE_COLOR[a.revenue_profile]}40`,
                              backgroundColor: `${REVENUE_COLOR[a.revenue_profile]}10`,
                              padding: '2px 6px', borderRadius: 3,
                            }}
                          >
                            PROFILE: {REVENUE_LABEL[a.revenue_profile] || a.revenue_profile}
                            {a.revenue_profile_ebitda_band && (
                              <span style={{ marginLeft: 4, color: 'var(--mc-text-3)', fontWeight: 400 }}>
                                · {a.revenue_profile_ebitda_band}
                              </span>
                            )}
                          </span>
                        )}
                        {/* PATCH 0073: chokepoint + WC numeric badges */}
                        {a.chokepoint_severity != null && a.chokepoint_severity > 0 && (
                          <span
                            title={`${a.chokepoint_rationale || ''}\nCompetitors: ${a.chokepoint_competitors || '—'}`}
                            style={{
                              fontSize: 9, fontWeight: 700,
                              color: chokepointSevColor(a.chokepoint_severity),
                              border: `1px solid ${chokepointSevColor(a.chokepoint_severity)}40`,
                              backgroundColor: `${chokepointSevColor(a.chokepoint_severity)}10`,
                              padding: '2px 6px', borderRadius: 3,
                              fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                            }}
                          >
                            🔒 {a.chokepoint_label || 'CHOKEPOINT'}
                            <span style={{ marginLeft: 4, letterSpacing: '1px' }}>{chokepointSevDots(a.chokepoint_severity)}</span>
                            <span style={{ marginLeft: 3, color: 'var(--mc-text-3)', fontWeight: 400 }}>{a.chokepoint_severity}/5</span>
                          </span>
                        )}
                        {a.working_capital_intensity_pct != null && (
                          <span
                            title={`Working capital intensity ${a.working_capital_intensity_pct}% — 0 = annuity / 100 = milestone-paid extreme`}
                            style={{
                              fontSize: 9, fontWeight: 700,
                              color: a.working_capital_intensity_pct >= 70 ? 'var(--mc-bearish)'
                                : a.working_capital_intensity_pct >= 40 ? 'var(--mc-warn)'
                                : a.working_capital_intensity_pct >= 20 ? 'var(--mc-cyan)'
                                : 'var(--mc-bullish)',
                              border: `1px solid ${a.working_capital_intensity_pct >= 70 ? 'var(--mc-bearish)' : a.working_capital_intensity_pct >= 40 ? 'var(--mc-warn)' : 'var(--mc-cyan)'}40`,
                              backgroundColor: a.working_capital_intensity_pct >= 70 ? '#EF444410' : a.working_capital_intensity_pct >= 40 ? '#F59E0B10' : '#22D3EE10',
                              padding: '2px 6px', borderRadius: 3,
                            }}
                          >
                            WC: {a.working_capital_intensity_pct}%
                          </span>
                        )}
                      </div>
                    )}
                    {/* PATCH 0072: IMPLIED SECONDARY DEMAND — capex propagation */}
                    {a.implied_secondary_demand && a.implied_secondary_demand.lines.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', backgroundColor: '#0A1422', border: '1px solid #22D3EE30', borderRadius: 6, padding: '6px 8px', marginBottom: 6, lineHeight: 1.5 }}>
                        <div style={{ marginBottom: 4 }}>
                          <strong style={{ color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>↪ IMPLIED SECONDARY DEMAND</strong>
                          <span style={{ marginLeft: 6, color: 'var(--mc-text-3)' }}>
                            {a.implied_secondary_demand.basis_mw}MW basis ·{' '}
                            <strong style={{ color: 'var(--mc-bullish)' }}>~${(a.implied_secondary_demand.total_secondary_demand_usd_m / 1000).toFixed(1)}B</strong> total capex propagation
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px' }}>
                          {a.implied_secondary_demand.lines.map((line, i) => (
                            <div key={i} style={{ fontSize: 9, lineHeight: 1.4 }}>
                              <span style={{ color: 'var(--mc-text-2)' }}>{line.category}</span>
                              <span style={{ marginLeft: 4, color: 'var(--mc-bullish)', fontWeight: 700 }}>
                                ~${((line.est_usd_per_mw_k * a.implied_secondary_demand!.basis_mw) / 1000).toFixed(0)}M
                              </span>
                              {line.beneficiary_tickers && line.beneficiary_tickers.length > 0 && (
                                <span style={{ marginLeft: 4, color: '#38A9E8', fontSize: 8 }}>
                                  ({line.beneficiary_tickers.slice(0, 3).join(', ')})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* PATCH 0067: WHY THIS MATTERS — institutional 1-liner */}
                    {a.sv_why_this_matters && (
                      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', borderTop: '1px solid var(--mc-bg-4)', paddingTop: 6, marginBottom: 6, lineHeight: 1.5 }}>
                        <strong style={{ color: 'var(--mc-warn)', letterSpacing: '0.4px' }}>WHY THIS MATTERS:</strong>{' '}
                        <span style={{ color: 'var(--mc-text-2)' }}>{a.sv_why_this_matters}</span>
                      </div>
                    )}
                    {/* PATCH 0067: SECOND-ORDER EFFECTS */}
                    {a.sv_second_order && ((a.sv_second_order.beneficiaries?.length ?? 0) > 0 || (a.sv_second_order.risk?.length ?? 0) > 0) && (
                      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', backgroundColor: '#0A1422', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '6px 8px', marginBottom: 6, lineHeight: 1.5 }}>
                        {(a.sv_second_order.beneficiaries?.length ?? 0) > 0 && (
                          <div style={{ marginBottom: 3 }}>
                            <strong style={{ color: 'var(--mc-bullish)' }}>↗ DOWNSTREAM BENEFICIARIES:</strong>{' '}
                            <span style={{ color: 'var(--mc-text-2)' }}>{a.sv_second_order.beneficiaries.join(' · ')}</span>
                          </div>
                        )}
                        {(a.sv_second_order.risk?.length ?? 0) > 0 && (
                          <div>
                            <strong style={{ color: 'var(--mc-bearish)' }}>↘ AT-RISK:</strong>{' '}
                            <span style={{ color: 'var(--mc-text-2)' }}>{a.sv_second_order.risk.join(' · ')}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* WHY IT QUALIFIES (engine reason) */}
                    <div style={{ fontSize: 10, color: 'var(--mc-cyan)', borderTop: '1px solid var(--mc-bg-4)', paddingTop: 6 }}>
                      <strong style={{ color: 'var(--mc-cyan)' }}>QUALIFIES:</strong> <span style={{ color: 'var(--mc-text-3)' }}>{sv.reason}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 9, color: 'var(--mc-text-4)' }}>
                      {a.source_name}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
