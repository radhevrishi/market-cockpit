'use client';
// Options Ideas — market panel at the top: index trend, VIX / India VIX, breadth, fear & greed (our own), and what the replay
// says to do now for calls, bought puts and sold puts. Both markets side by side; the selected one first.
import { useEffect, useState, type CSSProperties } from 'react';

const ACT_COL: Record<string, string> = { TAKE: '#10B981', SELECTIVE: '#F59E0B', AVOID: '#EF4444' };
const BAND: Record<string, { t: string; c: string }> = { calm: { t: 'Calm', c: '#10B981' }, normal: { t: 'Normal', c: '#94A3B8' }, elevated: { t: 'Elevated', c: '#F59E0B' }, fear: { t: 'FEAR', c: '#EF4444' } };
const box: CSSProperties = { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 12, padding: 12 };
const lab: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--mc-text-3)' };
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const sgn = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
const col = (x: number | null | undefined) => (x == null ? 'var(--mc-text-2)' : x > 0 ? '#10B981' : x < 0 ? '#EF4444' : 'var(--mc-text-2)');

function Gauge({ score, label }: { score: number; label: string }) {
  const c = score < 25 ? '#EF4444' : score < 45 ? '#F97316' : score <= 55 ? '#94A3B8' : score <= 75 ? '#84CC16' : '#10B981';
  return <div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}><b style={{ fontSize: 22, color: c }}>{score}</b><span style={{ fontWeight: 800, color: c }}>{label}</span></div>
    <div style={{ height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#EF4444,#F97316,#94A3B8,#84CC16,#10B981)', position: 'relative', marginTop: 4 }}>
      <div style={{ position: 'absolute', left: `calc(${score}% - 5px)`, top: -3, width: 10, height: 12, borderRadius: 3, background: 'var(--mc-text-0)' }} />
    </div>
  </div>;
}

function One({ p }: { p: any }) {
  const flag = p.market === 'US' ? '🇺🇸 USA' : '🇮🇳 India';
  const b = p.vix ? BAND[p.vix.band] : null;
  return (
    <div style={{ ...box, display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, fontSize: 15 }}>{flag}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div><div style={lab}>{p.index?.name ?? 'Index'}</div>
          {p.index ? <><div style={{ fontSize: 18, fontWeight: 800 }}>{p.index.last.toLocaleString('en-US', { maximumFractionDigits: 0 })} <span style={{ fontSize: 13, color: col(p.index.chg1d) }}>{sgn(p.index.chg1d)}</span></div>
            <div style={{ fontSize: 12 }}>vs 200-day <b style={{ color: col(p.index.vs200) }}>{sgn(p.index.vs200)}</b> · vs 50-day <b style={{ color: col(p.index.vs50) }}>{sgn(p.index.vs50)}</b> · 20 days <b style={{ color: col(p.index.ret20) }}>{sgn(p.index.ret20)}</b></div></> : <div>—</div>}
        </div>
        <div><div style={lab}>{p.vix?.name ?? 'VIX'}</div>
          {p.vix ? <><div style={{ fontSize: 18, fontWeight: 800 }}>{p.vix.last.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 800, color: b!.c, border: `1px solid ${b!.c}`, borderRadius: 999, padding: '0 7px' }}>{b!.t}</span></div>
            <div style={{ fontSize: 12 }}>{sgn(p.vix.chg1d)} today · {ord(p.vix.pct1y)} percentile of its year · fear line {p.vix.fearLine}</div></> : <div>—</div>}
        </div>
        <div><div style={lab}>Breadth</div>
          {p.breadth ? <><div style={{ fontSize: 18, fontWeight: 800 }}>{p.breadth.above200}% <span style={{ fontSize: 12, fontWeight: 600 }}>above 200-day</span></div>
            <div style={{ fontSize: 12 }}>{p.breadth.above50}% above 50-day · {p.breadth.nearHigh}% near 52-week high · {p.breadth.n} stocks{p.breadth.asOf ? ` · close of ${p.breadth.asOf}` : ''}</div></> : <div>—</div>}
        </div>
        <div><div style={lab} title="Our own CNN-style gauge (CNN blocks servers): index momentum, breadth, volatility and 20-day return, each ranked 0–100">Fear & Greed (our gauge)</div>
          {p.mood ? <Gauge score={p.mood.score} label={p.mood.label} /> : <div>—</div>}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--mc-text-3)' }}>Index and {p.vix?.name ?? 'VIX'}: live, re-read every 5 minutes (read {new Date(p.readAt).toLocaleTimeString()}). Breadth: share of all listed stocks (≥ {p.market === 'US' ? '$300M' : '₹500 Cr'}), each counted once — so it can be much weaker than the index, which a few giants carry; it updates after each close.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {([['Buy calls', p.verdict.calls], ['Buy puts', p.verdict.puts], ['Sell puts (short put)', p.verdict.sellPuts]] as const).map(([k, v]: any) => (
          <div key={k} style={{ border: `1px solid ${ACT_COL[v.act]}`, borderRadius: 10, padding: '6px 9px', fontSize: 12.5, lineHeight: 1.45 }}>
            <b>{k}: <span style={{ color: ACT_COL[v.act] }}>{v.act}</span></b><div style={{ color: 'var(--mc-text-2)' }}>{v.why}</div>
          </div>))}
      </div>
    </div>
  );
}

export function MarketPanel({ market }: { market: 'US' | 'IN' }) {
  const [j, setJ] = useState<any>(null);
  useEffect(() => { let off = false; const go = () => fetch('/api/v1/options-ideas?panel=1').then((r) => r.json()).then((x) => { if (!off) setJ(x); }).catch(() => {}); go(); const t = setInterval(go, 5 * 60_000); return () => { off = true; clearInterval(t); }; }, []);
  if (!j?.panel) return <div style={{ ...box, fontSize: 13, color: 'var(--mc-text-3)' }}>Loading market indicators…</div>;
  const ps = [...j.panel].sort((a: any, b: any) => (a.market === market ? -1 : b.market === market ? 1 : 0));
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 12 }}>{ps.map((p: any) => <One key={p.market} p={p} />)}</div>;
}
