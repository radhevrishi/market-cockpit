'use client';

// ═══════════════════════════════════════════════════════════════════════════
// MARKET BREADTH INDICATOR (PATCH 0168)
//
// Visualises the composite breadth score and pillar breakdowns from
// /api/v1/breadth.  Updated automatically every 5 minutes by Vercel edge.
// ═══════════════════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';
// PATCH 0274 — Surface refresh freshness so the 5-min cron lag is visible.
import { PanelFreshness } from '@/components/PanelFreshness';

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
  const { data, isLoading, isFetching, dataUpdatedAt, error, refetch } = useQuery<BreadthPayload>({
    queryKey: ['market-breadth'],
    queryFn: async () => {
      const r = await fetch('/api/v1/breadth');
      if (!r.ok) throw new Error('breadth fetch failed');
      return r.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  // PATCH 0460 — explicit error state with Retry. Previously the page hung on
  // the loading spinner forever when /api/v1/breadth was down.
  if (error && !data) {
    return (
      <div style={{ padding: 40, color: '#94A3B8', fontSize: 13, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠</div>
        <div style={{ color: '#E6EDF3', fontWeight: 700, marginBottom: 6 }}>Market Breadth unavailable</div>
        <div style={{ marginBottom: 14 }}>{(error as any)?.message || 'Upstream feed returned an error.'}</div>
        <button
          onClick={() => refetch()}
          style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #1A2840',
            background: '#0F7ABF', color: '#fff', fontWeight: 700, cursor: 'pointer',
          }}
        >Retry</button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div style={{ padding: 40, color: '#94A3B8', fontSize: 13, textAlign: 'center' }}>
        Loading market breadth…
      </div>
    );
  }

  // PATCH 0763 — IMP10. 30-day historical sparkline of the composite score.
  // Appends today's value on each load (deduped by IST date) and renders an
  // inline SVG trend. localStorage-only so no backend dependency.
  if (typeof window !== 'undefined' && data?.composite !== undefined) {
    try {
      const STORE = 'mc:breadth-history:v1';
      const ist = new Date();
      const istIso = new Date(ist.getTime() + (ist.getTimezoneOffset() + 330) * 60_000).toISOString().slice(0, 10);
      const raw = localStorage.getItem(STORE);
      const arr: Array<{ d: string; v: number }> = raw ? JSON.parse(raw) : [];
      if (arr.length === 0 || arr[arr.length - 1].d !== istIso) {
        arr.push({ d: istIso, v: data.composite });
        if (arr.length > 30) arr.shift();
        localStorage.setItem(STORE, JSON.stringify(arr));
      } else if (arr[arr.length - 1].v !== data.composite) {
        // Same day, different value — refresh last entry
        arr[arr.length - 1] = { d: istIso, v: data.composite };
        localStorage.setItem(STORE, JSON.stringify(arr));
      }
    } catch { /* silent */ }
  }

  const pillars = [
    { name: 'Trend Breadth',    weight: 35, score: data.pillars.trend.score,    sub: `% >50DMA ${data.pillars.trend.pct50}% · % >200DMA ${data.pillars.trend.pct200}% · ${data.pillars.trend.newHigh} new highs / ${data.pillars.trend.newLow} new lows` },
    { name: 'Sector Breadth',   weight: 25, score: data.pillars.sector.score,   sub: `${data.pillars.sector.above}/${data.pillars.sector.total} sectors above 50DMA` },
    { name: 'Smallcap Particip.', weight: 20, score: data.pillars.smallcap.score, sub: 'SMID vs Nifty 1m + smallcap above 200DMA' },
    // AUDIT_100 #82 — flag the single-proxy fragility of the flow pillar.
    // The proxy is PSU Bank 1m vs Nifty 1m; not a real DII flow feed.
    { name: 'Institutional Flow', weight: 10, score: data.pillars.flow.score,   sub: 'PSU Bank vs Nifty 1m (proxy for DII) · ⚠ LOW CONFIDENCE — single proxy' },
    { name: 'Momentum Breadth',   weight: 10, score: data.pillars.momentum.score, sub: `${data.pillars.momentum.makingHigherHighs}/${data.pillars.momentum.total} making higher highs` },
  ];

  return (
    <div style={{ padding: '20px 24px', backgroundColor: '#0A0E1A', minHeight: '100%', color: '#E6EDF3' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>📊 Market Breadth Indicator</h1>
        {/* PATCH 0274 — Freshness chip; turns amber when the 5-min cron lags. */}
        <PanelFreshness dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} staleAfterMs={10 * 60_000} />
      </div>
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
          {/* PATCH 0763 — IMP10 sparkline. Reads from mc:breadth-history:v1
              localStorage and draws a 30-day trend. Lets the user see if
              breadth is improving or deteriorating. */}
          {typeof window !== 'undefined' && (() => {
            try {
              const raw = localStorage.getItem('mc:breadth-history:v1');
              const arr: Array<{ d: string; v: number }> = raw ? JSON.parse(raw) : [];
              if (arr.length < 2) return null;
              const w = 120, h = 28;
              const min = Math.min(...arr.map(x => x.v));
              const max = Math.max(...arr.map(x => x.v));
              const range = Math.max(1, max - min);
              const pts = arr.map((p, i) => {
                const x = (i / (arr.length - 1)) * w;
                const y = h - ((p.v - min) / range) * (h - 4) - 2;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
              const first = arr[0].v;
              const last = arr[arr.length - 1].v;
              const delta = last - first;
              const trendColor = delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : '#6B7A8D';
              return (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width={w} height={h} style={{ overflow: 'visible' }}>
                    <polyline points={pts} fill="none" stroke={trendColor} strokeWidth={1.6} />
                  </svg>
                  <span style={{ fontSize: 10, color: trendColor, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                    {delta >= 0 ? '+' : ''}{delta} · {arr.length}d
                  </span>
                </div>
              );
            } catch { return null; }
          })()}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          {/* AUDIT_100 #29 — regime label deeplinks to news search so users can
              immediately see "why" the regime is what it is. */}
          <a
            href={`/news?search=${encodeURIComponent('breadth ' + (data.regime || ''))}`}
            title="See related news"
            style={{ fontSize: 20, fontWeight: 800, color: data.regime_color, marginBottom: 6, textDecoration: 'none', display: 'inline-block' }}
          >
            {data.regime} <span style={{ fontSize: 12, opacity: 0.5 }}>→</span>
          </a>
          <div style={{ fontSize: 13, color: '#C9D4E0', marginBottom: 8, marginTop: 6 }}>{data.regime_desc}</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>
            Suggested cash allocation: <strong style={{ color: '#E6EDF3' }}>{data.suggested_cash_pct}%</strong>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#6B7A8D', textAlign: 'right' }}>
          {/* AUDIT_100 #19 — guard against missing/malformed generated_at so
              the cell doesn't render "Invalid Date" for a partial payload. */}
          Updated {(() => {
            try {
              const d = new Date(data.generated_at);
              return Number.isFinite(d.getTime()) ? d.toLocaleString('en-IN') : '—';
            } catch { return '—'; }
          })()}<br />
          {/* PATCH 0697 — honest universe label. Previously read 'Universe: N
              symbols' which implied a full-market scan. The breadth engine
              actually scans the user's Watchlist + Conviction Beats bench, so
              relabel to reflect that and link out to /movers for full breadth. */}
          <span title="Currently scanning your Watchlist + Conviction Beats bench. For full Nifty 500 breadth, see /movers.">
            Watchlist Breadth · {data.universe_size} symbols · Fetch {(data.ms / 1000).toFixed(1)}s
          </span>
          <div style={{ fontSize: 9, color: '#4A5B6C', marginTop: 4, fontStyle: 'italic' }}>
            scope: Watchlist + Conviction Beats · for Nifty 500 breadth see <a href="/movers" style={{ color: '#22D3EE', textDecoration: 'underline' }}>/movers</a>
          </div>
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
