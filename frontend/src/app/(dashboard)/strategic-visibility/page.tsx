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
  _rank: number;
}

interface SVResponse {
  section_title: string;
  section_subtitle: string;
  count: number;
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

function useStrategic() {
  return useQuery<SVResponse>({
    queryKey: ['news', 'strategic'],
    queryFn: async () => {
      const { data } = await api.get('/news?strategic=1');
      return data;
    },
    refetchInterval: 5 * 60_000,   // 5 min
    staleTime: 5 * 60_000,
  });
}

export default function StrategicVisibilityPage() {
  const { data, isLoading } = useStrategic();
  const articles = data?.articles ?? [];

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

  return (
    <div style={{ minHeight: '100%', backgroundColor: '#0A0E1A', padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#F5F7FA', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            🌟 <span style={{ background: 'linear-gradient(90deg,#8B5CF6,#22D3EE)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Strategic Visibility</span>
          </h1>
          <p style={{ fontSize: 12, color: '#6B7A8D', margin: '4px 0 0', lineHeight: 1.5 }}>
            Multi-year frameworks · hyperscaler commitments · sovereign programs · transformational revenue locks.
            Parallel layer to Bottlenecks — answers <em>'who locked in multi-year demand visibility'</em> rather than <em>'who benefits from scarcity'</em>.
          </p>
        </header>

        {/* Inclusion criteria pinned at top */}
        <div style={{
          backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #8B5CF6',
          borderRadius: 10, padding: '10px 14px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 700, letterSpacing: '0.8px', marginBottom: 6 }}>
            INCLUSION CRITERIA — only articles meeting ALL of A + B + C qualify
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.6 }}>
            <strong style={{ color: '#E6EDF3' }}>A. Size:</strong> ≥$300M firm contract OR ≥10× backlog OR ≥20% LTM rev OR ≥10% mcap. Auto-include: 10y+ deal ≥30% mcap.<br/>
            <strong style={{ color: '#E6EDF3' }}>B. Theme:</strong> AI Infra / Energy Transition / Defense / Semi Supply Chain / Sovereign Program / Hyperscaler Lease / Quantum / Power.<br/>
            <strong style={{ color: '#E6EDF3' }}>C. Duration:</strong> ≥3y firm visibility (prefer ≥5–10y) with Tier-1 counterparty (Hyperscaler / Gov / Top-3 Utility).<br/>
            <strong style={{ color: '#E6EDF3' }}>Overrides:</strong> 🔒 Chokepoint (sole producer + ≥5y policy-backed) · 🧭 Strategic Program (≥$300M + ≥5y national framework).
          </div>
        </div>

        {/* Stats row */}
        {!isLoading && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
            {(['MCAP_GRADE','BACKLOG_RESET','DECADE_VISIBILITY','STRATEGIC_CHOKEPOINT','POLICY_BACKED'] as const).map(f => {
              const n = articles.filter(a => a.strategic_visibility.flags.includes(f)).length;
              if (n === 0) return null;
              return (
                <div key={f} style={{ fontSize: 11, color: '#94A3B8' }}>
                  <span style={{ color: FLAG_COLOR[f], fontWeight: 700 }}>{n}</span>
                  <span style={{ marginLeft: 4 }}>{FLAG_LABEL[f]}</span>
                </div>
              );
            })}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D' }}>
              {articles.length} qualifying signals
            </div>
          </div>
        )}

        {isLoading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B7A8D' }}>Computing strategic visibility…</div>
        )}

        {!isLoading && articles.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: '#6B7A8D', backgroundColor: '#0D1B2E', borderRadius: 10, border: '1px solid #1E2D45' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 4 }}>No qualifying strategic visibility events in the current news window.</div>
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              The engine is conservative by design — it requires ≥$300M firm contract AND a Tier-1 counterparty AND ≥3-year visibility,
              OR a strategic-chokepoint / sovereign-program override. Most news doesn't qualify.
            </div>
          </div>
        )}

        {/* Theme-grouped cards */}
        {!isLoading && Object.entries(grouped).map(([theme, items]) => (
          <section key={theme} style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#22D3EE', margin: '0 0 10px', letterSpacing: '0.5px' }}>
              {THEME_LABEL[theme] || theme} <span style={{ color: '#4A5B6C', fontWeight: 400, marginLeft: 6 }}>({items.length})</span>
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
                      backgroundColor: '#0D1B2E', border: '1px solid #1E2D45',
                      borderLeft: `3px solid ${sv.flags.includes('MCAP_GRADE') ? '#F59E0B' : sv.flags.includes('STRATEGIC_CHOKEPOINT') ? '#8B5CF6' : '#22D3EE'}`,
                      borderRadius: 10, padding: '10px 12px',
                      textDecoration: 'none', color: 'inherit',
                      transition: 'border-color 0.15s',
                    }}
                  >
                    {/* Top row: ticker + flags */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      {(a.ticker_symbols ?? []).slice(0, 3).map(t => (
                        <span key={t} style={{ fontSize: 10, fontWeight: 700, color: '#38A9E8', backgroundColor: '#0F7ABF20', padding: '2px 6px', borderRadius: 4, border: '1px solid #0F7ABF40' }}>
                          {t}
                        </span>
                      ))}
                      {sv.flags.map(f => (
                        <span key={f} style={{ fontSize: 9, fontWeight: 700, color: FLAG_COLOR[f] || '#94A3B8' }}>
                          {FLAG_LABEL[f] || f}
                        </span>
                      ))}
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4A5B6C' }}>{fmtAge(a.published_at)}</span>
                    </div>
                    {/* Headline */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#F5F7FA', lineHeight: 1.4, marginBottom: 8 }}>
                      {a.title}
                    </div>
                    {/* Metadata grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, fontSize: 10, color: '#94A3B8', marginBottom: 6 }}>
                      <div>
                        <div style={{ color: '#4A5B6C' }}>VALUE</div>
                        <div style={{ color: '#E6EDF3', fontWeight: 700 }}>{fmtMoney(sv.contract_value_usd_m)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#4A5B6C' }}>VISIBILITY</div>
                        <div style={{ color: '#E6EDF3', fontWeight: 700 }}>{sv.visibility_years ? `${sv.visibility_years}y` : '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#4A5B6C' }}>COUNTERPARTY</div>
                        <div style={{ color: '#E6EDF3', fontWeight: 700 }}>{sv.counterparty_name ?? COUNTERPARTY_LABEL[sv.counterparty_tier] ?? '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#4A5B6C' }}>% MCAP</div>
                        <div style={{ color: sv.pct_of_mcap && sv.pct_of_mcap >= 30 ? '#10B981' : '#E6EDF3', fontWeight: 700 }}>
                          {sv.pct_of_mcap !== undefined ? `${sv.pct_of_mcap}%` : '—'}
                        </div>
                      </div>
                    </div>
                    {/* Why it qualifies */}
                    <div style={{ fontSize: 10, color: '#22D3EE', borderTop: '1px solid #1A2840', paddingTop: 6 }}>
                      <strong style={{ color: '#22D3EE' }}>WHY:</strong> <span style={{ color: '#94A3B8' }}>{sv.reason}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 9, color: '#4A5B6C' }}>
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
