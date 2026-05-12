'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LIVE INPUT COST → EQUITY TRANSMISSION (PATCH 0096 / 0170)
//
// Real-time view of commodity / currency / yield moves and their first-order
// impact on Indian equities.
// ═══════════════════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';

interface Impact {
  sector: string;
  sign: 1 | -1;
  sensitivity: 'high' | 'med' | 'low';
  margin_pressure_pp_1m: number | null;
  margin_pressure_pp_3m: number | null;
  sample_tickers: string[];
}
interface CommodityRow {
  symbol: string;
  name: string;
  unit: string;
  fetched: boolean;
  last: number | null;
  change_1d: number | null;
  change_1w: number | null;
  change_1m: number | null;
  change_3m: number | null;
  impacts: Impact[];
}
interface Shock {
  commodity: string;
  sector: string;
  pressure_pp: number;
  sign: 1 | -1;
  sensitivity: 'high' | 'med' | 'low';
  tickers: string[];
}
interface TransmissionPayload {
  commodities: CommodityRow[];
  top_shocks: Shock[];
  fetched_at: string;
  ms: number;
}

function pct(p: number | null, digits = 1): string {
  if (p == null) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(digits)}%`;
}

export default function TransmissionPage() {
  const { data, isLoading } = useQuery<TransmissionPayload>({
    queryKey: ['commodity-transmission'],
    queryFn: async () => {
      const r = await fetch('/api/v1/transmission');
      if (!r.ok) throw new Error('transmission fetch failed');
      return r.json();
    },
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  if (isLoading || !data) {
    return <div style={{ padding: 40, color: '#94A3B8', fontSize: 13, textAlign: 'center' }}>Loading commodity shocks…</div>;
  }

  return (
    <div style={{ padding: '20px 24px', backgroundColor: '#0A0E1A', minHeight: '100%', color: '#E6EDF3' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, marginBottom: 6 }}>⚙️ Input Cost → Equity Transmission</h1>
      <p style={{ fontSize: 12, color: '#94A3B8', margin: 0, marginBottom: 18 }}>
        Real-time commodity / FX / yield moves mapped to first-order EBIT margin pressure on Indian sectors.
        Updates every 10 minutes.
      </p>

      {/* ── Top transmission shocks ─────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1623', border: '1px solid #1A2540', borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 10 }}>
          🔥 TOP 15 SHOCKS (1-month) — sorted by absolute margin pressure
        </div>
        {data.top_shocks.length === 0 ? (
          <div style={{ color: '#6B7A8D', fontSize: 12 }}>No material shocks (all commodities moved less than ±2 pp impact in last month)</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {data.top_shocks.slice(0, 15).map((s, i) => {
              const col = s.pressure_pp > 0 ? '#10B981' : '#EF4444';
              return (
                <div key={i} style={{
                  padding: '8px 12px',
                  backgroundColor: '#0A1422',
                  border: `1px solid ${col}30`,
                  borderLeft: `3px solid ${col}`,
                  borderRadius: 6,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: '#E6EDF3', fontWeight: 700, marginBottom: 2 }}>
                      {s.sector} <span style={{ color: '#6B7A8D', fontWeight: 400 }}>· via {s.commodity}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {s.tickers.slice(0, 6).map((t) => (
                        <span key={t} style={{ padding: '0 5px', borderRadius: 3, backgroundColor: '#0F7ABF18', color: '#38A9E8', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: col, fontFamily: 'ui-monospace, monospace' }}>
                      {pct(s.pressure_pp)}
                    </div>
                    <div style={{ fontSize: 9, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {s.sensitivity} sens
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Per-commodity panels ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
        {data.commodities.map((c) => {
          if (!c.fetched) {
            return (
              <div key={c.symbol} style={{ padding: '12px 14px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8, opacity: 0.5 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: '#EF4444' }}>fetch failed</div>
              </div>
            );
          }
          const oneM = c.change_1m ?? 0;
          const trendCol = oneM > 0 ? '#10B981' : oneM < 0 ? '#EF4444' : '#6B7A8D';
          return (
            <div key={c.symbol} style={{
              backgroundColor: '#0A1422',
              border: `1px solid ${trendCol}30`,
              borderLeft: `3px solid ${trendCol}`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#E6EDF3' }}>{c.name}</span>
                <span style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'ui-monospace, monospace' }}>
                  {c.last?.toLocaleString()} {c.unit}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 11, marginBottom: 8 }}>
                <span><span style={{ color: '#6B7A8D' }}>1d</span> <strong style={{ color: (c.change_1d ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(c.change_1d)}</strong></span>
                <span><span style={{ color: '#6B7A8D' }}>1w</span> <strong style={{ color: (c.change_1w ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(c.change_1w)}</strong></span>
                <span><span style={{ color: '#6B7A8D' }}>1m</span> <strong style={{ color: (c.change_1m ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(c.change_1m)}</strong></span>
                <span><span style={{ color: '#6B7A8D' }}>3m</span> <strong style={{ color: (c.change_3m ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{pct(c.change_3m)}</strong></span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {c.impacts.map((imp, idx) => {
                  const pp = imp.margin_pressure_pp_1m;
                  const col = pp == null ? '#6B7A8D' : pp > 0 ? '#10B981' : '#EF4444';
                  return (
                    <div key={idx} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, backgroundColor: '#0D1623', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, color: '#C9D4E0' }}>
                        {imp.sign === 1 ? '⬆' : '⬇'} {imp.sector}
                        <span style={{ fontSize: 9, color: '#6B7A8D', marginLeft: 6 }}>· {imp.sensitivity}</span>
                      </span>
                      <span style={{ fontWeight: 700, color: col, fontFamily: 'ui-monospace, monospace' }}>
                        {pp != null ? pct(pp) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
