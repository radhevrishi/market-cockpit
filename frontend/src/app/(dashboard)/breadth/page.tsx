'use client';

// ═══════════════════════════════════════════════════════════════════════════
// MARKET BREADTH INDICATOR (PATCH 0168)
//
// Visualises the composite breadth score and pillar breakdowns from
// /api/v1/breadth.  Updated automatically every 5 minutes by Vercel edge.
// ═══════════════════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';

interface BreadthPayload {
  composite: number;
  regime: string;
  regime_color: string;
  regime_desc: string;
  suggested_cash_pct: number;
  pillars: {
    trend:    { score: number; weight: number; pct50: number; pct200: number; newHigh: number; newLow: number; hlSpread: number };
    sector:   { score: number; weight: number; above: number; total: number };
    smallcap: { score: number; weight: number };
    flow:     { score: number; weight: number };
    momentum: { score: number; weight: number; makingHigherHighs: number; total: number };
  };
  universe_size: number;
  ms: number;
  generated_at: string;
}

export default function BreadthPage() {
  const { data, isLoading } = useQuery<BreadthPayload>({
    queryKey: ['market-breadth'],
    queryFn: async () => {
      const r = await fetch('/api/v1/breadth');
      if (!r.ok) throw new Error('breadth fetch failed');
      return r.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <div style={{ padding: 40, color: '#94A3B8', fontSize: 13, textAlign: 'center' }}>
        Loading market breadth…
      </div>
    );
  }

  const pillars = [
    { name: 'Trend Breadth',    weight: 35, score: data.pillars.trend.score,    sub: `% >50DMA ${data.pillars.trend.pct50}% · % >200DMA ${data.pillars.trend.pct200}% · ${data.pillars.trend.newHigh} new highs / ${data.pillars.trend.newLow} new lows` },
    { name: 'Sector Breadth',   weight: 25, score: data.pillars.sector.score,   sub: `${data.pillars.sector.above}/${data.pillars.sector.total} sectors above 50DMA` },
    { name: 'Smallcap Particip.', weight: 20, score: data.pillars.smallcap.score, sub: 'SMID vs Nifty 1m + smallcap above 200DMA' },
    { name: 'Institutional Flow', weight: 10, score: data.pillars.flow.score,   sub: 'PSU Bank vs Nifty 1m (proxy for DII)' },
    { name: 'Momentum Breadth',   weight: 10, score: data.pillars.momentum.score, sub: `${data.pillars.momentum.makingHigherHighs}/${data.pillars.momentum.total} making higher highs` },
  ];

  return (
    <div style={{ padding: '20px 24px', backgroundColor: '#0A0E1A', minHeight: '100%', color: '#E6EDF3' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, marginBottom: 6 }}>📊 Market Breadth Indicator</h1>
      <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, marginBottom: 18 }}>
        Composite of 5 breadth pillars · Updates every 5 min · Modify stock scores by regime
      </p>

      {/* ── Headline composite + regime ──────────────────────────────── */}
      <div style={{
        backgroundColor: '#0D1623',
        border: `1px solid ${data.regime_color}40`,
        borderLeft: `4px solid ${data.regime_color}`,
        borderRadius: 12, padding: '18px 22px',
        marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>COMPOSITE SCORE</div>
          <div style={{ fontSize: 56, fontWeight: 900, color: data.regime_color, lineHeight: 1 }}>
            {data.composite}<span style={{ fontSize: 18, color: '#94A3B8', fontWeight: 600 }}>/100</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: data.regime_color, marginBottom: 6 }}>{data.regime}</div>
          <div style={{ fontSize: 13, color: '#C9D4E0', marginBottom: 8 }}>{data.regime_desc}</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>
            Suggested cash allocation: <strong style={{ color: '#E6EDF3' }}>{data.suggested_cash_pct}%</strong>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#6B7A8D', textAlign: 'right' }}>
          Updated {new Date(data.generated_at).toLocaleString('en-IN')}<br />
          Universe: {data.universe_size} symbols · Fetch {(data.ms / 1000).toFixed(1)}s
        </div>
      </div>

      {/* ── Pillar breakdown ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {pillars.map((p) => {
          const color = p.score >= 70 ? '#10B981' : p.score >= 50 ? '#FBBF24' : p.score >= 30 ? '#F59E0B' : '#EF4444';
          return (
            <div key={p.name} style={{
              backgroundColor: '#0A1422',
              border: `1px solid ${color}30`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3' }}>{p.name}</span>
                <span style={{ fontSize: 10, color: '#6B7A8D' }}>weight {p.weight}%</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>{p.score}<span style={{ fontSize: 12, color: '#94A3B8' }}>/100</span></div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6, lineHeight: 1.4 }}>{p.sub}</div>
              <div style={{ height: 4, backgroundColor: '#1A2840', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${p.score}%`, backgroundColor: color, transition: 'width 0.4s' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Score-modifier guide ────────────────────────────────────── */}
      <div style={{ marginTop: 18, backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 8 }}>HOW BREADTH MODIFIES STOCK SCORES</div>
        <div style={{ fontSize: 11.5, color: '#C9D4E0', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 4px' }}><strong style={{ color: '#10B981' }}>80+ Expansion:</strong> aggressively reward acceleration (Earnings Ops boosts magnitude weight, Re-rating loosens trend bar).</p>
          <p style={{ margin: '0 0 4px' }}><strong style={{ color: '#22D3EE' }}>60-79 Healthy Bull:</strong> normal scoring; methodology pills weighted as default.</p>
          <p style={{ margin: '0 0 4px' }}><strong style={{ color: '#F59E0B' }}>40-59 Transitional:</strong> penalize weak balance sheets (FCF, debt, OCF/PAT) more heavily; demote low-quality earnings.</p>
          <p style={{ margin: 0 }}><strong style={{ color: '#EF4444' }}>&lt;40 Risk-Off:</strong> only quality / FCF / cash-flow leaders survive; methodology pills require all-pass for BLOCKBUSTER.</p>
        </div>
      </div>
    </div>
  );
}
