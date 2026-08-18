'use client';

// zzz404 — Historical Returns (India Smallcap + USA Nasdaq-100).
//
// The empirical bedrock the two scenario simulators are calibrated from.
// Real calendar-year returns, presented as an institutional reference:
//   • Year-by-year return bars (hover for exact figure)
//   • Growth of ₹1 / $1 (log scale) — the compounding story
//   • Rolling 5-year CAGR strip — how consistent the ride was
//   • Decade breakdown + full statistics (CAGR, vol, best/worst, drawdown, streaks)
//   • Same-period (2007–2025) rebased overlay when comparing both markets
//
// Pure client component. Data + stats from '@/lib/market-history'.

import React, { useEffect, useMemo, useState } from 'react';
import {
  NASDAQ100, SMALLCAP100, computeStats, growthOf, rollingCagr,
  type YearReturn,
} from '@/lib/market-history';

const C = {
  bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937',
  text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B', text4: '#475569',
  cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', green: '#22C55E',
  amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
};
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' };

interface Market { id: 'usa' | 'india'; name: string; short: string; series: YearReturn[]; ccy: string; accent: string; span: string; sim: string; note: string; }
const MARKETS: Record<'usa' | 'india', Market> = {
  usa: { id: 'usa', name: 'Nasdaq-100 (QQQ)', short: 'QQQ', series: NASDAQ100, ccy: '$', accent: C.cyan, span: '1986–2025 · 40 yrs', sim: '/qqq-simulator', note: 'Index inception 1985; QQQ ETF launched 1999. 40 completed calendar years.' },
  india: { id: 'india', name: 'Nifty Smallcap 100', short: 'Smallcap', series: SMALLCAP100, ccy: '₹', accent: C.purple, span: '2007–2025 · 19 yrs', sim: '/smallcap-simulator', note: 'Indian smallcap index history is short — clean calendar-year data from 2007.' },
};

function fmtMoney(ccy: string, n: number): string {
  if (ccy === '₹') {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
    if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
    return `₹${n.toFixed(1)}`;
  }
  if (n >= 1e3) return `$${Math.round(n).toLocaleString('en-US')}`;
  return `$${n.toFixed(1)}`;
}

// ── single-market panel ──
function MarketPanel({ m }: { m: Market }) {
  const s = useMemo(() => computeStats(m.series), [m]);
  const growth = useMemo(() => growthOf(m.series, 1), [m]);
  const roll = useMemo(() => rollingCagr(m.series, 5), [m]);
  const finalMult = growth[growth.length - 1].value;

  // decade breakdown
  const decades = useMemo(() => {
    const map = new Map<number, YearReturn[]>();
    for (const y of m.series) { const d = Math.floor(y.year / 10) * 10; if (!map.has(d)) map.set(d, []); map.get(d)!.push(y); }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([d, ys]) => {
      const st = computeStats(ys);
      return { decade: `${d}s`, n: ys.length, cagr: st.cagr, best: st.best, worst: st.worst, pos: st.posPct };
    });
  }, [m]);

  // annual bar chart geometry
  const W = 780, H = 220, padL = 4, padR = 8, padTop = 14, padBot = 26;
  const maxAbs = Math.max(...m.series.map(y => Math.abs(y.ret)), 40);
  const zeroY = padTop + (H - padTop - padBot) / 2;
  const scale = ((H - padTop - padBot) / 2) / maxAbs;
  const yOf = (v: number) => zeroY - v * scale;
  const colW = (W - padL - padR) / m.series.length;
  const barW = Math.min(colW * 0.62, 26);

  // growth log chart
  const gW = 780, gH = 180, gPadL = 4, gPadR = 8, gPadT = 12, gPadB = 22;
  const logs = growth.map(p => Math.log10(Math.max(p.value, 0.01)));
  const logMin = Math.min(...logs), logMax = Math.max(...logs);
  const gx = (i: number) => gPadL + (i / (growth.length - 1)) * (gW - gPadL - gPadR);
  const gy = (v: number) => gPadT + (1 - (Math.log10(Math.max(v, 0.01)) - logMin) / (logMax - logMin || 1)) * (gH - gPadT - gPadB);
  const gLine = growth.map((p, i) => `${gx(i).toFixed(1)},${gy(p.value).toFixed(1)}`).join(' ');
  const gArea = `${gLine} ${gx(growth.length - 1).toFixed(1)},${gH - gPadB} ${gPadL},${gH - gPadB}`;

  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 };
  const sub: React.CSSProperties = { ...mono, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 10 };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: m.accent }}>{m.name}</div>
          <div style={{ ...mono, fontSize: 11, color: C.text3 }}>{m.span} · calendar-year price returns</div>
        </div>
        <a href={m.sim} style={{ ...mono, fontSize: 11.5, fontWeight: 700, color: m.accent, textDecoration: 'none', padding: '6px 12px', borderRadius: 7, background: `${m.accent}12`, border: `1px solid ${m.accent}40` }}>🎲 Open {m.short} simulator →</a>
      </div>

      {/* stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'CAGR', value: `${s.cagr >= 0 ? '+' : ''}${s.cagr.toFixed(1)}%`, color: s.cagr >= 0 ? C.green : C.red },
          { label: `${m.ccy}1 → grew to`, value: `${m.ccy}${finalMult.toFixed(1)}`, color: C.gold },
          { label: 'Avg year', value: `${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(1)}%`, color: s.avg >= 0 ? C.green : C.red },
          { label: 'Median year', value: `${s.median >= 0 ? '+' : ''}${s.median.toFixed(1)}%`, color: s.median >= 0 ? C.green : C.red },
          { label: 'Best', value: `+${s.best.ret.toFixed(0)}%`, sub: `${s.best.year}`, color: C.green },
          { label: 'Worst', value: `${s.worst.ret.toFixed(0)}%`, sub: `${s.worst.year}`, color: C.red },
          { label: 'Positive yrs', value: `${s.posPct.toFixed(0)}%`, color: C.green },
          { label: 'Volatility', value: `${s.stdev.toFixed(0)}%`, color: C.amber },
          { label: 'Max drawdown', value: `−${s.maxDrawdown.toFixed(0)}%`, color: C.red },
          { label: 'Win streak', value: `${s.longestUp} yrs`, color: C.cyan },
          { label: 'Lose streak', value: `${s.longestDown} yrs`, color: C.red },
          { label: 'Down years', value: `${s.negCount} of ${s.n}`, color: C.text2 },
        ].map(t => (
          <div key={t.label} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: C.text3, marginBottom: 3 }}>{t.label}</div>
            <div style={{ ...mono, fontSize: 15, fontWeight: 800, color: t.color }}>{t.value}</div>
            {t.sub && <div style={{ ...mono, fontSize: 9, color: C.text4 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* annual returns bar chart */}
      <div style={sub}>Annual returns — every year (hover for exact %)</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginBottom: 16 }} preserveAspectRatio="xMidYMid meet">
        {[-60, -40, -20, 20, 40, 60, 80, 100].filter(v => Math.abs(v) <= maxAbs).map(v => (
          <g key={v}>
            <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={W - padR} y={yOf(v) - 2} fill={C.text4} fontSize={8} textAnchor="end" style={mono}>{v > 0 ? '+' : ''}{v}</text>
          </g>
        ))}
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke={C.text3} strokeWidth={1} />
        {m.series.map((y, i) => {
          const isPos = y.ret >= 0; const x = padL + colW * (i + 0.5);
          const yy = yOf(y.ret); const top = Math.min(zeroY, yy); const h = Math.abs(yy - zeroY);
          const col = isPos ? C.green : C.red;
          const showLabel = m.series.length <= 22;
          return (
            <g key={y.year}>
              <title>{y.year}: {isPos ? '+' : ''}{y.ret.toFixed(1)}%</title>
              <rect x={x - barW / 2} y={top} width={barW} height={Math.max(h, 0.5)} rx={2} fill={col} opacity={0.82} />
              {showLabel && <text x={x} y={isPos ? top - 3 : top + h + 8} fill={col} fontSize={7.5} textAnchor="middle" style={mono}>{isPos ? '+' : ''}{y.ret.toFixed(0)}</text>}
              {(m.series.length <= 22 || y.year % 5 === 0) && <text x={x} y={H - padBot + 13} fill={C.text3} fontSize={7.5} textAnchor="middle" style={mono} transform={m.series.length > 22 ? `rotate(0 ${x} ${H - padBot + 13})` : ''}>{`'${String(y.year).slice(2)}`}</text>}
            </g>
          );
        })}
      </svg>

      {/* growth of 1 (log) */}
      <div style={sub}>Growth of {m.ccy}1 — log scale ({m.ccy}1 → {m.ccy}{finalMult.toFixed(1)} over {s.n} yrs)</div>
      <svg viewBox={`0 0 ${gW} ${gH}`} style={{ width: '100%', height: 'auto', display: 'block', marginBottom: 16 }} preserveAspectRatio="none">
        {[1, 2, 5, 10, 20, 50, 100, 200].filter(v => Math.log10(v) >= logMin - 0.05 && Math.log10(v) <= logMax + 0.05).map(v => (
          <g key={v}>
            <line x1={gPadL} y1={gy(v)} x2={gW - gPadR} y2={gy(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={gPadL + 2} y={gy(v) - 2} fill={C.text4} fontSize={8} style={mono}>{m.ccy}{v}</text>
          </g>
        ))}
        <polygon points={gArea} fill={`${m.accent}18`} />
        <polyline points={gLine} fill="none" stroke={m.accent} strokeWidth={2} />
      </svg>

      {/* rolling 5Y CAGR */}
      {roll.length > 0 && (
        <>
          <div style={sub}>Rolling 5-year CAGR — how consistent was the ride?</div>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            {roll.map(r => {
              const col = r.cagr >= 15 ? C.green : r.cagr >= 0 ? C.amber : C.red;
              return (
                <div key={r.endYear} title={`5Y to ${r.endYear}: ${r.cagr >= 0 ? '+' : ''}${r.cagr.toFixed(1)}% CAGR`} style={{ textAlign: 'center', flex: '1 0 34px' }}>
                  <div style={{ ...mono, fontSize: 9, color: col, fontWeight: 700 }}>{r.cagr >= 0 ? '+' : ''}{r.cagr.toFixed(0)}</div>
                  <div style={{ height: 6, background: col, opacity: 0.55, borderRadius: 3, marginTop: 2 }} />
                  <div style={{ ...mono, fontSize: 8, color: C.text4, marginTop: 2 }}>{`'${String(r.endYear).slice(2)}`}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* decade breakdown */}
      <div style={sub}>Decade breakdown</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: C.text3, textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600 }}>Decade</th>
              <th style={{ padding: '5px 8px', fontWeight: 600 }}>Yrs</th>
              <th style={{ padding: '5px 8px', fontWeight: 600 }}>CAGR</th>
              <th style={{ padding: '5px 8px', fontWeight: 600 }}>Best</th>
              <th style={{ padding: '5px 8px', fontWeight: 600 }}>Worst</th>
              <th style={{ padding: '5px 8px', fontWeight: 600 }}>% up</th>
            </tr>
          </thead>
          <tbody>
            {decades.map(d => (
              <tr key={d.decade} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ textAlign: 'left', padding: '5px 8px', color: C.text2 }}>{d.decade}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: C.text3 }}>{d.n}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: d.cagr >= 0 ? C.green : C.red, fontWeight: 700 }}>{d.cagr >= 0 ? '+' : ''}{d.cagr.toFixed(1)}%</td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: C.green }}>+{d.best.ret.toFixed(0)}% <span style={{ color: C.text4 }}>{`'${String(d.best.year).slice(2)}`}</span></td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: C.red }}>{d.worst.ret.toFixed(0)}% <span style={{ color: C.text4 }}>{`'${String(d.worst.year).slice(2)}`}</span></td>
                <td style={{ textAlign: 'right', padding: '5px 8px', color: C.text2 }}>{d.pos.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* every-year table — collapsed by default */}
      <details style={{ marginTop: 14 }}>
        <summary style={{ ...mono, fontSize: 12, color: m.accent, cursor: 'pointer', fontWeight: 700, listStyle: 'none', padding: '8px 0' }}>
          ▸ Show all {s.n} yearly returns
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6, marginTop: 10 }}>
          {m.series.map(y => {
            const isPos = y.ret >= 0; const col = isPos ? C.green : C.red;
            return (
              <div key={y.year} style={{ background: `${col}0e`, border: `1px solid ${col}30`, borderRadius: 7, padding: '7px 6px', textAlign: 'center' }}>
                <div style={{ ...mono, fontSize: 11, color: C.text3 }}>{y.year}</div>
                <div style={{ ...mono, fontSize: 14, fontWeight: 800, color: col }}>{isPos ? '+' : ''}{y.ret.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </details>

      <div style={{ ...mono, fontSize: 11, color: C.text4, marginTop: 12 }}>{m.note}</div>
    </div>
  );
}

// ── same-period (2007–2025) rebased comparison ──
function CompareOverlay() {
  const start = 2007, end = 2025;
  const usa = NASDAQ100.filter(y => y.year >= start && y.year <= end);
  const ind = SMALLCAP100.filter(y => y.year >= start && y.year <= end);
  const gU = growthOf(usa, 100), gI = growthOf(ind, 100);
  const stU = computeStats(usa), stI = computeStats(ind);
  const W = 780, H = 200, pL = 4, pR = 8, pT = 12, pB = 22;
  const allV = [...gU.map(p => p.value), ...gI.map(p => p.value)];
  const logMin = Math.min(...allV.map(v => Math.log10(v))), logMax = Math.max(...allV.map(v => Math.log10(v)));
  const n = gU.length;
  const x = (i: number) => pL + (i / (n - 1)) * (W - pL - pR);
  const y = (v: number) => pT + (1 - (Math.log10(v) - logMin) / (logMax - logMin || 1)) * (H - pT - pB);
  const lU = gU.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const lI = gI.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 };
  return (
    <div style={card}>
      <div style={{ ...mono, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 4 }}>Head-to-head · same window (2007–2025), rebased to 100</div>
      <div style={{ ...mono, fontSize: 11, color: C.text3, marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><span style={{ color: C.cyan }}>━</span> Nasdaq-100 · {stU.cagr >= 0 ? '+' : ''}{stU.cagr.toFixed(1)}% CAGR · vol {stU.stdev.toFixed(0)}%</span>
        <span><span style={{ color: C.purple }}>━</span> Nifty Smallcap 100 · {stI.cagr >= 0 ? '+' : ''}{stI.cagr.toFixed(1)}% CAGR · vol {stI.stdev.toFixed(0)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="none">
        {[100, 200, 400, 800, 1600].filter(v => Math.log10(v) >= logMin - 0.05 && Math.log10(v) <= logMax + 0.05).map(v => (
          <g key={v}>
            <line x1={pL} y1={y(v)} x2={W - pR} y2={y(v)} stroke={C.border} strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={pL + 2} y={y(v) - 2} fill={C.text4} fontSize={8} style={mono}>{v}</text>
          </g>
        ))}
        <polyline points={lI} fill="none" stroke={C.purple} strokeWidth={2} />
        <polyline points={lU} fill="none" stroke={C.cyan} strokeWidth={2} />
      </svg>
      <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.6, marginTop: 10 }}>
        Over the same 19 years, {stU.cagr > stI.cagr ? 'the Nasdaq-100 out-compounded Indian smallcaps' : 'Indian smallcaps out-compounded the Nasdaq-100'} — {' '}
        {Math.abs(stU.cagr - stI.cagr).toFixed(1)}pp CAGR gap — but smallcaps carried {(stI.stdev / stU.stdev).toFixed(1)}× the volatility ({stI.stdev.toFixed(0)}% vs {stU.stdev.toFixed(0)}%) and a deeper max drawdown ({stI.maxDrawdown.toFixed(0)}% vs {stU.maxDrawdown.toFixed(0)}%). Different risk engines: QQQ is a steadier mega-cap compounder; Indian smallcaps are a higher-beta, boom-bust ride.
      </div>
    </div>
  );
}

export default function HistoricalReturnsPage() {
  const [view, setView] = useState<'both' | 'usa' | 'india'>('both');
  useEffect(() => {
    try {
      const m = new URLSearchParams(window.location.search).get('m');
      if (m === 'usa' || m === 'india' || m === 'both') setView(m);
    } catch { /* ignore */ }
  }, []);

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 700, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
    background: active ? `${color}22` : `${color}0c`, color, border: `1px solid ${color}${active ? '77' : '2e'}`, ...mono,
  });

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '26px 24px' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        <div style={{ marginBottom: 18, padding: '18px 22px', background: `linear-gradient(135deg, ${C.gold}14 0%, ${C.panel} 100%)`, border: `1px solid ${C.gold}33`, borderRadius: 14 }}>
          <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.4px', margin: 0 }}>Historical Returns — QQQ vs India Smallcap</h1>
          <div style={{ ...mono, fontSize: 13, color: C.text3, marginTop: 6 }}>
            Every calendar year of real returns — the empirical foundation both scenario simulators are calibrated from.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={() => setView('both')} style={chip(view === 'both', C.gold)}>⚖ Compare both</button>
          <button onClick={() => setView('usa')} style={chip(view === 'usa', C.cyan)}>🇺🇸 Nasdaq-100 (QQQ)</button>
          <button onClick={() => setView('india')} style={chip(view === 'india', C.purple)}>🇮🇳 Nifty Smallcap 100</button>
        </div>

        {view === 'both' && <CompareOverlay />}
        {(view === 'usa' || view === 'both') && <MarketPanel m={MARKETS.usa} />}
        {(view === 'india' || view === 'both') && <MarketPanel m={MARKETS.india} />}

        <div style={{ background: `${C.amber}0c`, border: `1px solid ${C.amber}28`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.6 }}>
            <strong style={{ color: C.amber }}>⚠ Notes.</strong> Calendar-year price returns, rounded; figures may differ ~1pp by vendor (total-return vs price-return, index vs ETF). QQQ tracks the Nasdaq-100 (index inception 1985) — 40 completed years is the real ceiling, not 50. Indian smallcap index history is genuinely short: clean calendar-year data begins ~2007. Past returns do not predict the future. Educational only, not investment advice.
          </div>
        </div>
        <div style={{ ...mono, fontSize: 10.5, color: C.text4, textAlign: 'center', paddingBottom: 20 }}>
          Sources: Nasdaq-100 1986–2025 (slickcharts / 1stock1) · Nifty Smallcap 100 2007–2025 (NSE, calendar-year) · Market Cockpit
        </div>
      </div>
    </div>
  );
}
