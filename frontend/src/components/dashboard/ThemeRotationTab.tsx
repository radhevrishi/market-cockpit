'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION TAB (zzz480) — USA + India in one tab, separated by a toggle.
// Reads /api/market/theme-rotation and renders: a BUY / AVOID + rotation call
// strip, an RRG quadrant map (Leading / Improving / Weakening / Lagging), and a
// multi-timeframe leaderboard. The whole point: always clear what to buy / avoid.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Region = 'us' | 'india';
interface Ret { w1: number; m1: number; m3: number; m6: number; ytd: number; y1: number }
interface ThemeRow {
  id: string; name: string; emoji: string; group: string; note?: string;
  proxy: string | null; members: string[];
  price?: number; dayChangePct?: number;
  ret?: Ret; rsRatio?: number; rsMomentum?: number; quadrant?: string; trail?: { x: number; y: number }[];
  aboveSMA50?: boolean; breadthAbove50?: number | null;
  characterChange?: 'bullish' | 'bearish' | null;
  verdict?: string; verdictColor?: string; verdictNote?: string;
  ok?: boolean;
}
interface Payload {
  region: Region; benchmark: { symbol: string; name: string; price: number; changePercent: number };
  themes: ThemeRow[]; rotatingIn: string[]; rotatingOut: string[]; topBuy: string[]; topAvoid: string[];
  asOf: string; source?: string; error?: string;
}

const QC: Record<string, string> = { Leading: '#16A34A', Improving: '#3B82F6', Weakening: '#F97316', Lagging: '#EF4444' };
const BG = '#0B111C', CARD = '#0F1A2A', BORD = 'rgba(255,255,255,0.08)', TXT = '#E6EDF3', DIM = '#7D8DA6', MUT = '#9FB0C8';

// teal(up) → grey(flat) → red(down) ramp, clamped at ±25%
function pctColor(v: number | undefined): string {
  if (v == null || isNaN(v)) return DIM;
  const x = Math.max(-25, Math.min(25, v)) / 25;
  if (x >= 0) { const a = 0.12 + x * 0.55; return `rgba(22,163,74,${a.toFixed(2)})`; }
  const a = 0.12 + (-x) * 0.55; return `rgba(239,68,68,${a.toFixed(2)})`;
}
const fmtPct = (v?: number) => (v == null || isNaN(v) ? '·' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

export default function ThemeRotationTab() {
  const [region, setRegion] = useState<Region>('us');
  const [data, setData] = useState<Record<Region, Payload | null>>({ us: null, india: null });
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'rs' | 'w1' | 'm1' | 'm3' | 'ytd' | 'y1'>('rs');
  const [hover, setHover] = useState<string | null>(null);

  const load = useCallback(async (r: Region, force = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/theme-rotation?region=${r}${force ? '&refresh=1' : ''}`, { cache: 'no-store' });
      const j = (await res.json()) as Payload;
      setData((prev) => ({ ...prev, [r]: j }));
    } catch { /* keep prior */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!data[region]) load(region); }, [region, data, load]);

  const payload = data[region];
  const themes = payload?.themes?.filter((t) => t.ok) || [];
  const byId = useMemo(() => { const m = new Map<string, ThemeRow>(); themes.forEach((t) => m.set(t.id, t)); return m; }, [themes]);

  const sorted = useMemo(() => {
    const key = sortKey;
    return [...themes].sort((a, b) => {
      const va = key === 'rs' ? (a.rsRatio || 0) + (a.rsMomentum || 0) - 200 : (a.ret?.[key] ?? -999);
      const vb = key === 'rs' ? (b.rsRatio || 0) + (b.rsMomentum || 0) - 200 : (b.ret?.[key] ?? -999);
      return vb - va;
    });
  }, [themes, sortKey]);

  const chip = (id: string, color: string) => {
    const t = byId.get(id); if (!t) return null;
    return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, color, background: `${color}1a`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px' }}>{t.emoji} {t.name}</span>;
  };

  return (
    <div style={{ background: BG, borderRadius: 12, padding: 16, color: TXT, minHeight: 400 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.3 }}>🔄 Theme Rotation</div>
          <div style={{ fontSize: 11.5, color: DIM, marginTop: 2 }}>Which themes to <b style={{ color: '#22C55E' }}>buy</b> and which to <b style={{ color: '#EF4444' }}>avoid</b> — RS-Ratio × momentum on live prices. {payload?.benchmark && <>Benchmark <b style={{ color: MUT }}>{payload.benchmark.name}</b>.</>}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: CARD, border: `1px solid ${BORD}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['us', 'india'] as Region[]).map((r) => (
              <button key={r} onClick={() => setRegion(r)} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', background: region === r ? '#1E40AF' : 'transparent', color: region === r ? '#fff' : MUT, fontSize: 13, fontWeight: 800 }}>{r === 'us' ? '🇺🇸 USA' : '🇮🇳 India'}</button>
            ))}
          </div>
          <button onClick={() => load(region, true)} disabled={loading} title="Recompute from live prices (bypasses the 30-min cache)" style={{ fontSize: 11, fontWeight: 800, padding: '6px 11px', borderRadius: 7, cursor: loading ? 'wait' : 'pointer', border: '1px solid rgba(34,197,94,0.4)', background: 'transparent', color: '#22C55E' }}>{loading ? '⏳' : '↻ Refresh'}</button>
        </div>
      </div>

      {loading && !payload && <div style={{ color: DIM, fontSize: 13, padding: 30, textAlign: 'center' }}>Scoring themes on live prices…</div>}
      {payload?.error && <div style={{ color: '#EF4444', fontSize: 12.5, padding: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8 }}>Couldn’t load live data: {payload.error}. Try ↻ Refresh.</div>}

      {payload && !payload.error && themes.length > 0 && (
        <>
          {/* BUY / AVOID / ROTATION call strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#22C55E', letterSpacing: 0.5, marginBottom: 7 }}>🟢 BUY — strongest themes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{payload.topBuy.length ? payload.topBuy.map((id) => chip(id, '#16A34A')) : <span style={{ color: DIM, fontSize: 12 }}>none leading right now</span>}</div>
            </div>
            <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#60A5FA', letterSpacing: 0.5, marginBottom: 7 }}>🔵 ROTATING IN — early</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{payload.rotatingIn.length ? payload.rotatingIn.map((id) => chip(id, '#3B82F6')) : <span style={{ color: DIM, fontSize: 12 }}>—</span>}</div>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#F87171', letterSpacing: 0.5, marginBottom: 7 }}>🔴 AVOID / ROTATING OUT</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(payload.topAvoid.length ? payload.topAvoid : payload.rotatingOut).length ? (payload.topAvoid.length ? payload.topAvoid : payload.rotatingOut).map((id) => chip(id, '#EF4444')) : <span style={{ color: DIM, fontSize: 12 }}>—</span>}</div>
            </div>
          </div>

          {/* character-change alerts (the "suddenly buyable / just rolled over" moments) */}
          {themes.some((t) => t.characterChange) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {themes.filter((t) => t.characterChange).map((t) => (
                <span key={t.id} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '4px 9px', color: t.characterChange === 'bullish' ? '#22C55E' : '#EF4444', background: t.characterChange === 'bullish' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${t.characterChange === 'bullish' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}` }}>
                  {t.characterChange === 'bullish' ? '⚡ Character change ↑' : '⚠️ Character change ↓'} — {t.emoji} {t.name}: {t.characterChange === 'bullish' ? 'momentum crossed up + reclaimed 50-DMA' : 'momentum rolled over + lost 50-DMA'}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* RRG quadrant map */}
            <div style={{ flex: '1 1 360px', minWidth: 300, background: CARD, border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: MUT, marginBottom: 6 }}>Rotation map — RS-Ratio (→) × Momentum (↑)</div>
              <RRG themes={themes} hover={hover} setHover={setHover} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 10.5 }}>
                {Object.entries(QC).map(([q, c]) => <span key={q} style={{ color: c, fontWeight: 700 }}>● {q}</span>)}
              </div>
            </div>

            {/* leaderboard */}
            <div style={{ flex: '2 1 520px', minWidth: 320, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: DIM, textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Theme</th>
                    <th style={{ padding: '6px 6px', fontWeight: 700, textAlign: 'center' }}>Verdict</th>
                    {([['w1', '1W'], ['m1', '1M'], ['m3', '3M'], ['ytd', 'YTD'], ['y1', '1Y']] as const).map(([k, lbl]) => (
                      <th key={k} onClick={() => setSortKey(k as any)} style={{ padding: '6px 6px', fontWeight: sortKey === k ? 900 : 700, color: sortKey === k ? TXT : DIM, cursor: 'pointer' }}>{lbl}{sortKey === k ? ' ▾' : ''}</th>
                    ))}
                    <th onClick={() => setSortKey('rs')} style={{ padding: '6px 8px', fontWeight: sortKey === 'rs' ? 900 : 700, color: sortKey === 'rs' ? TXT : DIM, cursor: 'pointer' }}>RS{sortKey === 'rs' ? ' ▾' : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.id} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}
                      style={{ borderTop: `1px solid ${BORD}`, background: hover === t.id ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                      <td style={{ padding: '7px 8px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 8, background: QC[t.quadrant || 'Lagging'], flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 800, color: TXT }}>{t.emoji} {t.name}</div>
                            <div style={{ fontSize: 9.5, color: DIM }}>{t.quadrant}{t.aboveSMA50 ? ' · >50DMA' : ' · <50DMA'}{t.breadthAbove50 != null ? ` · ${t.breadthAbove50}% brdth` : ''}{t.proxy ? '' : ' · basket'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: t.verdictColor, background: `${t.verdictColor}1a`, border: `1px solid ${t.verdictColor}55`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }} title={t.verdictNote}>{t.verdict}</span>
                      </td>
                      {(['w1', 'm1', 'm3', 'ytd', 'y1'] as const).map((k) => (
                        <td key={k} style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: TXT, background: pctColor(t.ret?.[k]), borderRadius: 4 }}>{fmtPct(t.ret?.[k])}</td>
                      ))}
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: MUT }}>
                        {t.rsRatio?.toFixed(0)}<span style={{ color: (t.rsMomentum || 100) >= 100 ? '#22C55E' : '#EF4444', marginLeft: 4 }}>{(t.rsMomentum || 100) >= 100 ? '↑' : '↓'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: DIM, lineHeight: 1.6 }}>
            <b style={{ color: MUT }}>How to read it:</b> Leading (green) = strong &amp; rising → buy leaders. Improving (blue) = weak but turning up → early buy on 50-DMA reclaim. Weakening (orange) = strong but rolling over → trim. Lagging (red) = weak &amp; falling → avoid. Verdicts combine the quadrant with the price’s position vs its 50-DMA. Live prices via {payload.source}. Themes with no clean ETF use an equal-weight basket of leaders. Educational, not investment advice.
            {payload.asOf && <span> · updated {new Date(payload.asOf).toLocaleString()}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── RRG scatter ─────────────────────────────────────────────────────────────
function RRG({ themes, hover, setHover }: { themes: ThemeRow[]; hover: string | null; setHover: (s: string | null) => void }) {
  const W = 360, H = 300, pad = 26;
  const pts = themes.filter((t) => t.rsRatio != null && t.rsMomentum != null);
  const xs = pts.map((t) => t.rsRatio as number), ys = pts.map((t) => t.rsMomentum as number);
  const span = (arr: number[]) => { const mn = Math.min(100, ...arr), mx = Math.max(100, ...arr); const pad2 = Math.max(1.5, (mx - mn) * 0.15); return [mn - pad2, mx + pad2] as const; };
  const [x0, x1] = pts.length ? span(xs) : [96, 104] as const;
  const [y0, y1] = pts.length ? span(ys) : [96, 104] as const;
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
  const cx = sx(100), cy = sy(100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* quadrant fills */}
      <rect x={cx} y={pad} width={W - pad - cx} height={cy - pad} fill="rgba(22,163,74,0.06)" />
      <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill="rgba(59,130,246,0.06)" />
      <rect x={pad} y={cy} width={cx - pad} height={H - pad - cy} fill="rgba(239,68,68,0.06)" />
      <rect x={cx} y={cy} width={W - pad - cx} height={H - pad - cy} fill="rgba(249,115,22,0.06)" />
      <line x1={cx} y1={pad} x2={cx} y2={H - pad} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
      <line x1={pad} y1={cy} x2={W - pad} y2={cy} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
      <text x={W - pad} y={pad + 10} fill="#16A34A" fontSize="9" textAnchor="end" fontWeight="700">LEADING</text>
      <text x={pad} y={pad + 10} fill="#3B82F6" fontSize="9" fontWeight="700">IMPROVING</text>
      <text x={pad} y={H - pad - 4} fill="#EF4444" fontSize="9" fontWeight="700">LAGGING</text>
      <text x={W - pad} y={H - pad - 4} fill="#F97316" fontSize="9" textAnchor="end" fontWeight="700">WEAKENING</text>
      {pts.map((t) => {
        const x = sx(t.rsRatio as number), y = sy(t.rsMomentum as number);
        const c = QC[t.quadrant || 'Lagging'];
        const on = hover === t.id;
        const trail = (t.trail || []).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
        return (
          <g key={t.id} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            {t.trail && t.trail.length > 1 && <polyline points={trail} fill="none" stroke={c} strokeWidth={on ? 1.6 : 0.8} opacity={on ? 0.8 : 0.35} />}
            <circle cx={x} cy={y} r={on ? 6 : 4} fill={c} stroke="#0B111C" strokeWidth="1" />
            {(on || pts.length <= 22) && <text x={x + 7} y={y + 3} fill={on ? '#fff' : '#B7C4D6'} fontSize={on ? 10 : 8.5} fontWeight={on ? 800 : 600}>{t.emoji}{on ? ` ${t.name}` : ''}</text>}
          </g>
        );
      })}
    </svg>
  );
}
