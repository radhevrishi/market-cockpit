'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LIVE INPUT COST → EQUITY TRANSMISSION (PATCH 0096 / 0170, rewritten 0241-0245)
//
// Premium decision workstation for input-cost shocks:
//   - Sticky filter rail (category, sensitivity, sector, ticker, horizon)
//   - URL-persistent filter state
//   - Sparkline per commodity (60-day series from API)
//   - Click commodity → drilldown panel with full driver matrix
//   - Scenario Lab — drag input deltas, see aggregate sector pressure recalc
//   - Right-rail Transmission Intelligence (top movers, beneficiaries, casualties)
//   - Tabular numerals + premium polish
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TOKENS } from '@/lib/design-tokens';

type Sensitivity = 'high' | 'med' | 'low';
type Category = 'energy' | 'metals' | 'agri' | 'chemicals' | 'fx_rates' | 'ai_robotics' | 'nuclear' | 'rare_earths';

interface Impact {
  sector: string;
  sign: 1 | -1;
  sensitivity: Sensitivity;
  margin_pressure_pp_1m: number | null;
  margin_pressure_pp_3m: number | null;
  sample_tickers: string[];
  pass_through_lag?: 'immediate' | '1Q' | '2Q' | '3Q+' | null;
  pricing_power?: 'strong' | 'moderate' | 'weak' | null;
  note?: string | null;
}
interface CommodityRow {
  symbol: string;
  name: string;
  unit: string;
  category?: Category | null;
  bias_2026?: 'rising' | 'falling' | 'volatile' | 'stable' | null;
  source_note?: string | null;
  proxy_via?: string | null;     // PATCH 0250 — equity-proxy mode
  fetched: boolean;
  price_source?: 'yahoo' | 'fmp' | 'alphavantage' | null;
  last: number | null;
  change_1d: number | null;
  change_1w: number | null;
  change_1m: number | null;
  change_3m: number | null;
  sparkline?: number[];
  impacts: Impact[];
}
interface Shock {
  commodity: string;
  sector: string;
  pressure_pp: number;
  sign: 1 | -1;
  sensitivity: Sensitivity;
  tickers: string[];
}
interface TransmissionPayload {
  commodities: CommodityRow[];
  top_shocks: Shock[];
  fetched_at: string;
  ms: number;
}

const CATEGORY_LABELS: Record<Category, { label: string; glyph: string; tone: { solid: string; bg: string; border: string } }> = {
  energy:       { label: 'Energy',       glyph: '⛽', tone: { solid: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' } },
  metals:       { label: 'Metals',       glyph: '⚙️', tone: { solid: '#94A3B8', bg: '#94A3B815', border: '#94A3B840' } },
  agri:         { label: 'Agri',         glyph: '🌾', tone: { solid: '#10B981', bg: '#10B98115', border: '#10B98140' } },
  chemicals:    { label: 'Chemicals',    glyph: '⚗️', tone: { solid: '#22D3EE', bg: '#22D3EE15', border: '#22D3EE40' } },
  fx_rates:     { label: 'FX / Rates',   glyph: '💱', tone: { solid: '#60A5FA', bg: '#60A5FA15', border: '#60A5FA40' } },
  ai_robotics:  { label: 'AI / Robotics', glyph: '🤖', tone: { solid: '#A78BFA', bg: '#A78BFA15', border: '#A78BFA40' } },
  nuclear:      { label: 'Nuclear',      glyph: '☢️', tone: { solid: '#FB7185', bg: '#FB718515', border: '#FB718540' } },
  rare_earths:  { label: 'Rare Earths',  glyph: '🪨', tone: { solid: '#FBBF24', bg: '#FBBF2415', border: '#FBBF2440' } },
};

const SENS_FACTOR: Record<Sensitivity, number> = { high: 0.6, med: 0.3, low: 0.15 };

function pct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(digits)}%`;
}
const NUM = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' as const };

function Sparkline({ data, color, width = 80, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  // AUDIT_100 #23 — render null rather than a blank SVG box. The empty 80x24
  // SVG occupied a slot in the card grid and caused visible alignment shimmer
  // next to populated rows. null collapses the inline flow cleanly.
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = data[data.length - 1];
  const first = data[0];
  const up = last >= first;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline fill="none" stroke={up ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid} strokeWidth={1.4} points={points} />
    </svg>
  );
}

// ── Drilldown panel ───────────────────────────────────────────────────────
// PATCH 0330 — Z-Score panel inside Drilldown. Lazy-fetches z-scores
// across 60d / 180d / 365d / 5yr windows on panel open, renders chip
// strip with interpretation tooltips.
interface ZScoreData {
  window_days: number; z_score: number; percentile: number;
  mean: number; std_dev: number; sample_size: number;
  interpretation: string; source: string;
}
function ZScoreChips({ commodity }: { commodity: CommodityRow }) {
  const [data, setData] = useState<ZScoreData[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // AUDIT_100 #12 — abort in-flight z-score fetches when commodity changes.
    // Previously only a `cancelled` flag suppressed state writes; the 4 HTTP
    // requests still completed and held connection slots, and on fast
    // commodity-A→B clicks the stale A results could resolve AFTER B (because
    // setData was guarded but the Promise.all ordering depended on network).
    // AbortController kills the in-flight requests cleanly.
    let cancelled = false;
    const ctl = new AbortController();
    const fetchAll = async () => {
      const windows = [60, 180, 365, 1825];
      const slug = commodity.name.toLowerCase().replace(/\s+/g, '_');
      const sym = encodeURIComponent(commodity.symbol);
      try {
        const results = await Promise.all(
          windows.map(w =>
            fetch(`/api/v1/transmission/zscore/${encodeURIComponent(slug)}?window=${w}&symbol=${sym}`, { signal: ctl.signal })
              .then(r => r.ok ? r.json() : null).catch(() => null)
          )
        );
        if (cancelled) return;
        setData(results.filter(r => r && r.source !== 'INSUFFICIENT_DATA'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    return () => { cancelled = true; ctl.abort(); };
  }, [commodity.name, commodity.symbol]);
  if (loading) {
    return <div style={{ fontSize: 11, color: TOKENS.surface.textMuted, padding: '8px 14px' }}>Computing z-scores…</div>;
  }
  if (!data || data.length === 0) {
    return <div style={{ fontSize: 11, color: TOKENS.surface.textMuted, padding: '8px 14px', fontStyle: 'italic' }}>z-score history unavailable for this commodity</div>;
  }
  const horizonLabel = (d: number) => d === 60 ? '3m' : d === 180 ? '6m' : d === 365 ? '1y' : '5y';
  const zoneColor = (z: number) => {
    if (z > 2) return TOKENS.semantic.bullish.solid;     // extremely elevated → mean-rev risk
    if (z > 1) return '#F59E0B';                          // elevated
    if (z > -1) return TOKENS.surface.textDim;            // normal
    if (z > -2) return '#22D3EE';                         // value zone
    return TOKENS.semantic.bearish.solid;                 // extreme low → capitulation
  };
  return (
    <div style={{ marginBottom: 18, backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 8, letterSpacing: '0.5px' }}>
        STATISTICAL CONTEXT  ·  current price vs historical distribution
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {data.map(z => (
          <div
            key={z.window_days}
            title={z.interpretation}
            style={{
              border: `1px solid ${zoneColor(z.z_score)}40`,
              backgroundColor: `${zoneColor(z.z_score)}14`,
              borderRadius: 5, padding: '6px 10px', fontSize: 11,
            }}
          >
            <div style={{ fontSize: 9, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 2 }}>
              vs {horizonLabel(z.window_days)} ({z.sample_size}d)
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
              <strong style={{ fontSize: 14, color: zoneColor(z.z_score) }}>
                {z.z_score >= 0 ? '+' : ''}{z.z_score.toFixed(2)}σ
              </strong>
              <span style={{ fontSize: 10, color: TOKENS.surface.textDim }}>p{z.percentile.toFixed(0)}</span>
            </div>
          </div>
        ))}
      </div>
      {data[2] && (
        <div style={{ fontSize: 10, color: TOKENS.surface.textDim, marginTop: 8, lineHeight: 1.5 }}>
          {data[2].interpretation}
        </div>
      )}
    </div>
  );
}

function DrilldownPanel({ commodity, onClose }: { commodity: CommodityRow; onClose: () => void }) {
  const sortedImpacts = [...commodity.impacts].sort((a, b) => {
    const pa = Math.abs(a.margin_pressure_pp_1m ?? 0);
    const pb = Math.abs(b.margin_pressure_pp_1m ?? 0);
    return pb - pa;
  });
  const tone = commodity.category ? CATEGORY_LABELS[commodity.category].tone : TOKENS.surface.cardBorder;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.65)' }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: '100%', maxWidth: 720,
        backgroundColor: TOKENS.surface.card, borderLeft: `1px solid ${TOKENS.surface.cardBorder}`,
        overflowY: 'auto', padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: TOKENS.surface.textDim, fontSize: 18, cursor: 'pointer', marginRight: 12 }}>✕</button>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: TOKENS.surface.text }}>{commodity.name}</h2>
          {commodity.category && (
            <span style={{
              marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
              ...((typeof tone === 'object' && 'bg' in tone) ? { backgroundColor: tone.bg, color: tone.solid, border: `1px solid ${tone.border}` } : {}),
            }}>
              {CATEGORY_LABELS[commodity.category].glyph} {CATEGORY_LABELS[commodity.category].label}
            </span>
          )}
        </div>
        {/* Top KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
          {([
            { label: 'Last', value: commodity.last != null ? `${commodity.last.toLocaleString()} ${commodity.unit}` : 'n/a', tone: TOKENS.surface.text },
            { label: '1d', value: pct(commodity.change_1d), tone: (commodity.change_1d ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid },
            { label: '1w', value: pct(commodity.change_1w), tone: (commodity.change_1w ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid },
            { label: '1m', value: pct(commodity.change_1m), tone: (commodity.change_1m ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid },
            { label: '3m', value: pct(commodity.change_3m), tone: (commodity.change_3m ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid },
          ] as const).map(k => (
            <div key={k.label} style={{ backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: TOKENS.surface.textMuted, fontWeight: 700, letterSpacing: '0.5px' }}>{k.label.toUpperCase()}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: k.tone, marginTop: 2, ...NUM }}>{k.value}</div>
            </div>
          ))}
        </div>
        {commodity.sparkline && commodity.sparkline.length > 1 && (
          <div style={{ marginBottom: 18, backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 6, letterSpacing: '0.5px' }}>LAST 60 DAYS</div>
            <Sparkline data={commodity.sparkline} color={TOKENS.surface.accent} width={680} height={70} />
          </div>
        )}
        {/* PATCH 0330 — Z-Score statistical context */}
        {commodity.symbol && !commodity.symbol.startsWith('MANUAL') && <ZScoreChips commodity={commodity} />}
        {commodity.bias_2026 && (
          <div style={{ marginBottom: 14, fontSize: 11, color: TOKENS.surface.textDim }}>
            <strong style={{ color: TOKENS.surface.text }}>2026 bias:</strong> {commodity.bias_2026}
            {commodity.source_note && <span style={{ marginLeft: 8 }}>· {commodity.source_note}</span>}
          </div>
        )}
        <div style={{ fontSize: 11, fontWeight: 700, color: TOKENS.surface.accent, letterSpacing: '0.5px', marginBottom: 8 }}>
          EXPOSED SECTORS  ·  {sortedImpacts.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedImpacts.map((imp, i) => {
            const pp = imp.margin_pressure_pp_1m;
            const col = pp == null ? TOKENS.surface.textMuted : pp > 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid;
            return (
              <div key={i} style={{
                backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`,
                borderLeft: `3px solid ${col}`,
                borderRadius: 6, padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{imp.sign === 1 ? '⬆' : '⬇'} {imp.sector}</span>
                  <span style={{ fontSize: 10, color: TOKENS.surface.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{imp.sensitivity}</span>
                  {imp.pass_through_lag && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, backgroundColor: '#1A2540', color: TOKENS.surface.textDim }}>
                      lag: {imp.pass_through_lag}
                    </span>
                  )}
                  {imp.pricing_power && (
                    <span title="Sector's ability to pass cost through to end-customer" style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, backgroundColor: '#1A2540', color: TOKENS.surface.textDim }}>
                      pass: {imp.pricing_power}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 13, color: col, ...NUM }}>
                    1m: {pct(pp)} {imp.margin_pressure_pp_3m != null && <span style={{ fontSize: 10, color: TOKENS.surface.textMuted, marginLeft: 6 }}>3m: {pct(imp.margin_pressure_pp_3m)}</span>}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {imp.sample_tickers.map(t => (
                    <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, backgroundColor: '#0F7ABF18', color: '#38A9E8', ...NUM }}>{t}</span>
                  ))}
                </div>
                {imp.note && <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, marginTop: 6, fontStyle: 'italic' }}>{imp.note}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Scenario Lab ──────────────────────────────────────────────────────────
function ScenarioLab({ commodities }: { commodities: CommodityRow[] }) {
  // PATCH 0249 — Toggle between 1d (most recent shock) and 1m (trend) base.
  const [base, setBase] = useState<'1d' | '1m'>('1m');
  // Pick the 6 highest-impact commodities by abs change for the selected base
  const scenarioInputs = useMemo(() => {
    const key = base === '1d' ? 'change_1d' : 'change_1m';
    return [...commodities]
      .filter(c => c.fetched && (c as any)[key] != null && c.impacts.length > 0)
      .sort((a, b) => (Math.abs((b as any)[key] ?? 0) - Math.abs((a as any)[key] ?? 0)))
      .slice(0, 6);
  }, [commodities, base]);

  // User-applied delta per commodity (% on top of live move). Default 0.
  const [deltas, setDeltas] = useState<Record<string, number>>(() => Object.fromEntries(scenarioInputs.map(c => [c.symbol, 0])));

  // Compute per-sector aggregate pressure under the scenario.
  const sectorAgg = useMemo(() => {
    const agg = new Map<string, { pressure: number; tickers: Set<string> }>();
    for (const c of scenarioInputs) {
      const baseMove = (base === '1d' ? c.change_1d : c.change_1m) ?? 0;
      const userDelta = deltas[c.symbol] ?? 0;
      const totalMove = baseMove + userDelta;
      for (const imp of c.impacts) {
        const f = SENS_FACTOR[imp.sensitivity];
        const press = totalMove * imp.sign * f;
        const existing = agg.get(imp.sector) || { pressure: 0, tickers: new Set<string>() };
        existing.pressure += press;
        for (const t of imp.sample_tickers) existing.tickers.add(t);
        agg.set(imp.sector, existing);
      }
    }
    return Array.from(agg.entries())
      .map(([sector, v]) => ({ sector, pressure: Math.round(v.pressure * 10) / 10, tickers: Array.from(v.tickers).slice(0, 6) }))
      .sort((a, b) => Math.abs(b.pressure) - Math.abs(a.pressure));
  }, [scenarioInputs, deltas, base]);

  const reset = () => setDeltas(Object.fromEntries(scenarioInputs.map(c => [c.symbol, 0])));
  const anyDelta = Object.values(deltas).some(v => v !== 0);

  return (
    <div style={{ backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.severity.high.solid, letterSpacing: '0.4px' }}>🧪 SCENARIO LAB</div>
        <div style={{ fontSize: 10, color: TOKENS.surface.textMuted }}>
          Drag a slider to layer extra move on the live {base} change. Sector pressure recomputes instantly.
        </div>
        {/* PATCH 0249 — Toggle 1d ('today's shock') vs 1m (trend) as the base */}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          {(['1d', '1m'] as const).map(b => (
            <button key={b} onClick={() => { setBase(b); }} style={{
              backgroundColor: base === b ? TOKENS.severity.high.bg : 'transparent',
              border: `1px solid ${base === b ? TOKENS.severity.high.solid : TOKENS.surface.cardBorder}`,
              color: base === b ? TOKENS.severity.high.solid : TOKENS.surface.textDim,
              borderRadius: 5, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.4px',
            }}>{b}</button>
          ))}
        </div>
        {anyDelta && (
          <button onClick={reset} style={{ backgroundColor: 'transparent', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.textDim, borderRadius: 5, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Reset</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 8 }}>INPUT SHOCKS ({base.toUpperCase()})</div>
          {scenarioInputs.map(c => {
            const delta = deltas[c.symbol] ?? 0;
            const baseMove = (base === '1d' ? c.change_1d : c.change_1m) ?? 0;
            const otherMove = (base === '1d' ? c.change_1m : c.change_1d) ?? 0;
            const total = baseMove + delta;
            return (
              <div key={c.symbol} style={{ marginBottom: 8, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: TOKENS.surface.text, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ ...NUM, color: total >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid }}>{pct(total)}</span>
                </div>
                <input
                  type="range" min={-50} max={50} step={1}
                  value={delta}
                  onChange={e => setDeltas(d => ({ ...d, [c.symbol]: Number(e.target.value) }))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
                {/* PATCH 0249 — show both 1d and 1m beneath each slider so user sees both horizons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: TOKENS.surface.textMuted, ...NUM }}>
                  <span>base {base}: {pct(baseMove)} · {base === '1d' ? '1m' : '1d'}: {pct(otherMove)}</span>
                  <span>delta: {delta >= 0 ? '+' : ''}{delta}%</span>
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 8 }}>SECTOR PRESSURE (TOP 10)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sectorAgg.slice(0, 10).map(s => {
              const col = s.pressure > 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid;
              return (
                <div key={s.sector} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, alignItems: 'center', padding: '4px 8px', borderRadius: 4, backgroundColor: '#0A1422', border: `1px solid ${col}30`, borderLeft: `3px solid ${col}` }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{s.sector}</div>
                    <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                      {s.tickers.map(t => (
                        <span key={t} style={{ fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 3, backgroundColor: '#0F7ABF18', color: '#38A9E8', ...NUM }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: col, ...NUM }}>{pct(s.pressure)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Transmission Intelligence right rail ──────────────────────────────────
function TransmissionIntelligence({ data }: { data: TransmissionPayload }) {
  const movers = useMemo(() =>
    [...data.commodities]
      .filter(c => c.fetched && c.change_1m != null)
      .sort((a, b) => Math.abs(b.change_1m ?? 0) - Math.abs(a.change_1m ?? 0))
      .slice(0, 5),
    [data]);

  const losers = data.top_shocks.filter(s => s.pressure_pp < 0).slice(0, 6);
  const beneficiaries = data.top_shocks.filter(s => s.pressure_pp > 0).slice(0, 6);

  return (
    <div style={{ backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 10, padding: '14px 16px', position: 'sticky', top: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.surface.accent, letterSpacing: '0.4px', marginBottom: 10 }}>
        🎯 TRANSMISSION INTELLIGENCE
      </div>
      <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, marginBottom: 12 }}>What changed · who's hit · who benefits</div>

      <div style={{ marginBottom: 14 }}>
        {/* PATCH 0249 — Show both 1d (today's shock) and 1m (trend) per mover */}
        <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>TOP MOVERS</span>
          <span style={{ display: 'inline-flex', gap: 10 }}>
            <span style={{ width: 36, textAlign: 'right' }}>1D</span>
            <span style={{ width: 40, textAlign: 'right' }}>1M</span>
          </span>
        </div>
        {movers.map(m => {
          const col1m = (m.change_1m ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid;
          const col1d = (m.change_1d ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid;
          return (
            <div key={m.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, gap: 8 }}>
              <span style={{ color: TOKENS.surface.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span style={{ ...NUM, color: col1d, fontWeight: 600, width: 36, textAlign: 'right', fontSize: 10 }}>{pct(m.change_1d)}</span>
              <span style={{ ...NUM, color: col1m, fontWeight: 700, width: 40, textAlign: 'right' }}>{pct(m.change_1m)}</span>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: TOKENS.semantic.bearish.solid, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 6 }}>▼ MARGIN CASUALTIES</div>
        {losers.length === 0 ? <div style={{ fontSize: 11, color: TOKENS.surface.textMuted }}>—</div> :
          losers.map((s, i) => (
            <div key={i} style={{ fontSize: 11, padding: '3px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.sector}</span>
                <span style={{ ...NUM, color: TOKENS.semantic.bearish.solid, fontWeight: 700 }}>{pct(s.pressure_pp)}</span>
              </div>
              <div style={{ fontSize: 9, color: TOKENS.surface.textMuted, marginTop: 1 }}>via {s.commodity}</div>
            </div>
          ))}
      </div>

      <div>
        <div style={{ fontSize: 10, color: TOKENS.semantic.bullish.solid, fontWeight: 700, letterSpacing: '0.4px', marginBottom: 6 }}>▲ BENEFICIARIES</div>
        {beneficiaries.length === 0 ? <div style={{ fontSize: 11, color: TOKENS.surface.textMuted }}>—</div> :
          beneficiaries.map((s, i) => (
            <div key={i} style={{ fontSize: 11, padding: '3px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.sector}</span>
                <span style={{ ...NUM, color: TOKENS.semantic.bullish.solid, fontWeight: 700 }}>{pct(s.pressure_pp)}</span>
              </div>
              <div style={{ fontSize: 9, color: TOKENS.surface.textMuted, marginTop: 1 }}>via {s.commodity}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function TransmissionPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const initParam = (k: string, d: string) => (typeof sp?.get === 'function' && sp.get(k)) || d;

  const [category, setCategory] = useState<string>(initParam('cat', 'ALL'));
  const [sensitivity, setSensitivity] = useState<string>(initParam('sens', 'ALL'));
  const [sectorSearch, setSectorSearch] = useState<string>(initParam('sector', ''));
  const [tickerSearch, setTickerSearch] = useState<string>(initParam('ticker', ''));
  const [horizon, setHorizon] = useState<'1m' | '3m'>(initParam('h', '1m') as any);
  const [activeCommodity, setActiveCommodity] = useState<CommodityRow | null>(null);

  // URL persistence
  useEffect(() => {
    const params = new URLSearchParams();
    if (category !== 'ALL') params.set('cat', category);
    if (sensitivity !== 'ALL') params.set('sens', sensitivity);
    if (sectorSearch) params.set('sector', sectorSearch);
    if (tickerSearch) params.set('ticker', tickerSearch);
    if (horizon !== '1m') params.set('h', horizon);
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [category, sensitivity, sectorSearch, tickerSearch, horizon, pathname, router]);

  const { data, isLoading, dataUpdatedAt, isFetching } = useQuery<TransmissionPayload>({
    queryKey: ['commodity-transmission'],
    queryFn: async () => {
      // PATCH 0473 — 30s timeout (route hits 34 commodity feeds, can be slow)
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30_000);
      try {
        const r = await fetch('/api/v1/transmission', { signal: ctl.signal });
        if (!r.ok) throw new Error('transmission fetch failed');
        return await r.json();
      } finally { clearTimeout(t); }
    },
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  });

  const filteredCommodities = useMemo(() => {
    if (!data) return [];
    return data.commodities.filter(c => {
      if (category !== 'ALL' && c.category !== category) return false;
      if (sensitivity !== 'ALL') {
        const matchSens = c.impacts.some(imp => imp.sensitivity === sensitivity);
        if (!matchSens) return false;
      }
      if (sectorSearch.trim()) {
        const q = sectorSearch.toLowerCase();
        const matchSector = c.impacts.some(imp => imp.sector.toLowerCase().includes(q));
        if (!matchSector) return false;
      }
      if (tickerSearch.trim()) {
        const q = tickerSearch.toUpperCase();
        const matchTicker = c.impacts.some(imp => imp.sample_tickers.some(t => t.toUpperCase().includes(q)));
        if (!matchTicker) return false;
      }
      return true;
    });
  }, [data, category, sensitivity, sectorSearch, tickerSearch]);

  const categories: Array<'ALL' | Category> = ['ALL', 'energy', 'metals', 'agri', 'chemicals', 'fx_rates', 'ai_robotics', 'nuclear', 'rare_earths'];
  const sensitivities = ['ALL', 'high', 'med', 'low'];

  if (isLoading || !data) {
    return <div style={{ padding: 40, color: TOKENS.surface.textDim, fontSize: 13, textAlign: 'center' }}>Loading commodity shocks…</div>;
  }

  const freshDate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const freshHhmm = freshDate ? freshDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const ageMin = freshDate ? Math.floor((Date.now() - freshDate.getTime()) / 60_000) : 0;
  const isStale = ageMin > 15;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr 280px', gap: 16, padding: '20px 24px', backgroundColor: TOKENS.surface.canvas, minHeight: '100%', color: TOKENS.surface.text, ...NUM }}>

      {/* ── Sticky filter rail ──────────────────────── */}
      <aside style={{ position: 'sticky', top: 16, alignSelf: 'start', backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 10, padding: '14px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: TOKENS.surface.accent, letterSpacing: '0.4px', marginBottom: 10 }}>FILTERS</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 4 }}>CATEGORY</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {categories.map(c => {
              const active = category === c;
              const meta = c !== 'ALL' ? CATEGORY_LABELS[c as Category] : null;
              return (
                <button key={c} onClick={() => setCategory(c)} style={{
                  textAlign: 'left', fontSize: 11, padding: '4px 6px', borderRadius: 4,
                  backgroundColor: active ? (meta?.tone.bg || TOKENS.surface.accent + '20') : 'transparent',
                  border: `1px solid ${active ? (meta?.tone.solid || TOKENS.surface.accent) : 'transparent'}`,
                  color: active ? (meta?.tone.solid || TOKENS.surface.accent) : TOKENS.surface.textDim,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {meta ? `${meta.glyph} ${meta.label}` : 'All categories'}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 4 }}>SENSITIVITY</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {sensitivities.map(s => (
              <button key={s} onClick={() => setSensitivity(s)} style={{
                flex: 1, fontSize: 10, padding: '4px 6px', borderRadius: 4,
                backgroundColor: sensitivity === s ? TOKENS.surface.accent + '20' : 'transparent',
                border: `1px solid ${sensitivity === s ? TOKENS.surface.accent : TOKENS.surface.cardBorder}`,
                color: sensitivity === s ? TOKENS.surface.accent : TOKENS.surface.textDim,
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, textTransform: 'uppercase',
              }}>{s}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 4 }}>SECTOR CONTAINS</div>
          <input value={sectorSearch} onChange={e => setSectorSearch(e.target.value)} placeholder="e.g. Cement"
            style={{ width: '100%', fontSize: 11, padding: '5px 8px', borderRadius: 4, backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 4 }}>TICKER CONTAINS</div>
          <input value={tickerSearch} onChange={e => setTickerSearch(e.target.value)} placeholder="e.g. RELIANCE"
            style={{ width: '100%', fontSize: 11, padding: '5px 8px', borderRadius: 4, backgroundColor: '#0A1422', border: `1px solid ${TOKENS.surface.cardBorder}`, color: TOKENS.surface.text, fontFamily: 'inherit', textTransform: 'uppercase' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, fontWeight: 700, marginBottom: 4 }}>HORIZON</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['1m', '3m'] as const).map(h => (
              <button key={h} onClick={() => setHorizon(h)} style={{
                flex: 1, fontSize: 10, padding: '4px 6px', borderRadius: 4,
                backgroundColor: horizon === h ? TOKENS.surface.accent + '20' : 'transparent',
                border: `1px solid ${horizon === h ? TOKENS.surface.accent : TOKENS.surface.cardBorder}`,
                color: horizon === h ? TOKENS.surface.accent : TOKENS.surface.textDim,
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, textTransform: 'uppercase',
              }}>{h}</button>
            ))}
          </div>
        </div>
        {(category !== 'ALL' || sensitivity !== 'ALL' || sectorSearch || tickerSearch || horizon !== '1m') && (
          <button onClick={() => { setCategory('ALL'); setSensitivity('ALL'); setSectorSearch(''); setTickerSearch(''); setHorizon('1m'); }} style={{
            width: '100%', backgroundColor: 'transparent', border: `1px solid ${TOKENS.surface.cardBorder}`,
            color: TOKENS.surface.textDim, borderRadius: 4, padding: '5px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>Clear all</button>
        )}
      </aside>

      {/* ── Main column ──────────────────────────── */}
      <main>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>⚙️ Input Cost → Equity Transmission</h1>
          <span title={`Last successful fetch: ${freshDate?.toLocaleString() || '—'}`} style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
            backgroundColor: isStale ? TOKENS.state.stale.bg : 'transparent',
            border: `1px solid ${isStale ? TOKENS.state.stale.solid : TOKENS.surface.cardBorder}`,
            color: isStale ? TOKENS.state.stale.solid : TOKENS.surface.textDim,
            ...NUM,
          }}>{isFetching ? '↻ ' : ''}as of {freshHhmm} · {ageMin}m ago</span>
        </div>
        <p style={{ fontSize: 12, color: TOKENS.surface.textDim, margin: 0, marginBottom: 18 }}>
          Commodity / FX / yield moves mapped to first-order EBIT margin pressure on Indian sectors.
          Click any card for the full driver matrix. Updates every 10 minutes.
        </p>

        {/* PATCH 0494 QA-#7 — pass FILTERED commodities so Category/Sensitivity/
            Sector/Ticker chips narrow the Sector Pressure aggregate too. */}
        <ScenarioLab commodities={filteredCommodities.length > 0 ? filteredCommodities : data.commodities} />

        {/* Top shocks summary */}
        <div style={{ backgroundColor: TOKENS.surface.card, border: `1px solid ${TOKENS.surface.cardBorder}`, borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.surface.accent, letterSpacing: '0.4px', marginBottom: 10 }}>
            🔥 TOP 15 SHOCKS (1-month) — sorted by absolute margin pressure
          </div>
          {data.top_shocks.length === 0 ? (
            <div style={{ color: TOKENS.surface.textMuted, fontSize: 12 }}>No material shocks (all commodities moved less than ±2 pp impact in last month)</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {data.top_shocks.slice(0, 15).map((s, i) => {
                const col = s.pressure_pp > 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid;
                return (
                  <div key={i} style={{
                    padding: '8px 12px', backgroundColor: '#0A1422',
                    border: `1px solid ${col}30`, borderLeft: `3px solid ${col}`,
                    borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, color: TOKENS.surface.text, fontWeight: 700, marginBottom: 2 }}>
                        {s.sector} <span style={{ color: TOKENS.surface.textMuted, fontWeight: 400 }}>· via {s.commodity}</span>
                      </div>
                      <div style={{ fontSize: 10, color: TOKENS.surface.textDim, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {s.tickers.slice(0, 6).map(t => (
                          <span key={t} style={{ padding: '0 5px', borderRadius: 3, backgroundColor: '#0F7ABF18', color: '#38A9E8', ...NUM, fontWeight: 700 }}>{t}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: col, ...NUM }}>{pct(s.pressure_pp)}</div>
                      <div style={{ fontSize: 9, color: TOKENS.surface.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{s.sensitivity} sens</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Commodity grid */}
        <div style={{ fontSize: 11, color: TOKENS.surface.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: '0.4px' }}>
          {filteredCommodities.length} of {data.commodities.length} commodities
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 10 }}>
          {filteredCommodities.map(c => {
            const oneM = c.change_1m ?? 0;
            const trendCol = oneM > 0 ? TOKENS.semantic.bullish.solid : oneM < 0 ? TOKENS.semantic.bearish.solid : TOKENS.surface.textMuted;
            const cat = c.category ? CATEGORY_LABELS[c.category] : null;
            return (
              <button
                key={c.name}
                onClick={() => setActiveCommodity(c)}
                style={{
                  textAlign: 'left', fontFamily: 'inherit',
                  backgroundColor: TOKENS.surface.card,
                  border: `1px solid ${trendCol}30`,
                  borderLeft: `3px solid ${trendCol}`,
                  borderRadius: 8, padding: '12px 14px', cursor: 'pointer', color: 'inherit',
                  opacity: c.fetched ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {cat && <span title={cat.label} style={{ fontSize: 13 }}>{cat.glyph}</span>}
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{c.name}</span>
                    {/* PATCH 0250 — Equity-proxy badge. Cleanly tells user the
                        % move is from a stock proxy, not the spot commodity. */}
                    {c.proxy_via && (
                      <span
                        title={`Equity proxy — uses ${c.proxy_via} stock to give directional signal. No free spot-price feed available for this commodity.`}
                        style={{
                          fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                          backgroundColor: '#F59E0B15', color: '#F59E0B',
                          border: '1px solid #F59E0B40', letterSpacing: '0.3px',
                        }}
                      >via {c.proxy_via}</span>
                    )}
                    {/* PATCH 0248 — Price source provenance: y=Yahoo, f=FMP, a=AV */}
                    {c.price_source && (
                      <span
                        title={`Price feed: ${c.price_source === 'yahoo' ? 'Yahoo Finance' : c.price_source === 'fmp' ? 'Financial Modeling Prep (fallback)' : 'Alpha Vantage (fallback)'}`}
                        style={{
                          fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                          backgroundColor: c.price_source === 'yahoo' ? '#1A2540' : c.price_source === 'fmp' ? '#22D3EE15' : '#A78BFA15',
                          color: c.price_source === 'yahoo' ? TOKENS.surface.textMuted : c.price_source === 'fmp' ? '#22D3EE' : '#A78BFA',
                          border: `1px solid ${c.price_source === 'yahoo' ? TOKENS.surface.cardBorder : c.price_source === 'fmp' ? '#22D3EE40' : '#A78BFA40'}`,
                          letterSpacing: '0.3px', textTransform: 'uppercase',
                        }}
                      >{c.price_source === 'yahoo' ? 'y' : c.price_source === 'fmp' ? 'fmp' : 'av'}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: TOKENS.surface.textDim, ...NUM }}>
                    {c.last != null ? `${c.last.toLocaleString()} ${c.unit}` : <span style={{ color: TOKENS.surface.textMuted, fontStyle: 'italic' }}>manual feed</span>}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, ...NUM }}>
                    <span><span style={{ color: TOKENS.surface.textMuted }}>1d</span> <strong style={{ color: (c.change_1d ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid }}>{pct(c.change_1d)}</strong></span>
                    <span><span style={{ color: TOKENS.surface.textMuted }}>1m</span> <strong style={{ color: (c.change_1m ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid }}>{pct(c.change_1m)}</strong></span>
                    <span><span style={{ color: TOKENS.surface.textMuted }}>3m</span> <strong style={{ color: (c.change_3m ?? 0) >= 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid }}>{pct(c.change_3m)}</strong></span>
                  </div>
                  {c.sparkline && c.sparkline.length > 1 && (
                    <div style={{ marginLeft: 'auto' }}>
                      <Sparkline data={c.sparkline} color={trendCol} width={70} height={20} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {c.impacts.slice(0, 4).map((imp, idx) => {
                    const pp = horizon === '3m' ? imp.margin_pressure_pp_3m : imp.margin_pressure_pp_1m;
                    const col = pp == null ? TOKENS.surface.textMuted : pp > 0 ? TOKENS.semantic.bullish.solid : TOKENS.semantic.bearish.solid;
                    return (
                      <div key={idx} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, backgroundColor: '#0D1623', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, color: TOKENS.surface.text }}>
                          {imp.sign === 1 ? '⬆' : '⬇'} {imp.sector}
                          <span style={{ fontSize: 9, color: TOKENS.surface.textMuted, marginLeft: 6 }}>· {imp.sensitivity}</span>
                        </span>
                        <span style={{ fontWeight: 700, color: col, ...NUM }}>{pp != null ? pct(pp) : '—'}</span>
                      </div>
                    );
                  })}
                  {c.impacts.length > 4 && (
                    <div style={{ fontSize: 10, color: TOKENS.surface.textMuted, textAlign: 'right', fontStyle: 'italic' }}>+{c.impacts.length - 4} more sectors — click for full matrix</div>
                  )}
                </div>
              </button>
            );
          })}
          {filteredCommodities.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 32, color: TOKENS.surface.textMuted, fontSize: 13 }}>
              No commodities match the current filters.
            </div>
          )}
        </div>
      </main>

      {/* ── Right rail: Transmission Intelligence ─────────────────────── */}
      <aside>
        <TransmissionIntelligence data={data} />
      </aside>

      {activeCommodity && <DrilldownPanel commodity={activeCommodity} onClose={() => setActiveCommodity(null)} />}
    </div>
  );
}
