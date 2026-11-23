'use client';
// zzz1291 — Market Leadership tabs: Performance (indices + every theme with its companies) and Market cycles (SOIC-style
// weekly log chart with bull / bust bands, cycle cards "led by" + fall cause), plus the theme → best companies block used by the
// radar. Data: /api/market/leadership-perf?market=us|india (lib/market-leadership/perf-server).
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Market } from '@/lib/theme-rotation/types';
import type { PerfPayload } from '@/lib/market-leadership/perf-server';
import { PERF_KEYS, PERF_LABEL, type MemberRow, type PerfKey, type ThemePerf, type Cycle } from '@/lib/market-leadership/perf';
import { card } from '@/components/dashboard/theme-rotation/ui';
import { T, tint } from '@/components/dashboard/theme-rotation/tokens';

type PP = PerfPayload & { ok: boolean; error?: string; ageMin?: number };

// zzz1291 — the owner's holdings (India / US portfolio in this browser + the US book), to mark held names everywhere
const heldCache: Partial<Record<Market, Set<string>>> = {};
const clean = (s: unknown) => String(s || '').toUpperCase().trim().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX|US|IN):/, '').replace(/\.(NS|BO)$/, '').replace(/-(BE|EQ|SM|ST)$/, '');
export function useHeld(m: Market): Set<string> {
  const [held, setHeld] = useState<Set<string>>(heldCache[m] ?? new Set());
  useEffect(() => {
    let off = false;
    const out = new Set<string>();
    try {
      const raw = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]');
      if (Array.isArray(raw)) for (const h of raw) { const mk = h?.market === 'US' ? 'us' : 'india'; if (mk === m && h?.symbol) out.add(clean(h.symbol)); }
    } catch { /* none */ }
    heldCache[m] = out; setHeld(new Set(out));
    if (m === 'us') {
      fetch('/api/v1/us-book', { cache: 'no-store' }).then((r) => r.json()).then((j: any) => {
        if (off) return;
        for (const h of j?.book?.holdings || j?.holdings || []) if (h?.ticker) out.add(clean(h.ticker));
        heldCache[m] = out; setHeld(new Set(out));
      }).catch(() => { /* local only */ });
    }
    return () => { off = true; };
  }, [m]);
  return held;
}
export const HeldDot = ({ on }: { on: boolean }) => (on ? <span title="You hold this" style={{ fontSize: 10.5, fontWeight: 900, color: T.accent, border: `1px solid ${tint(T.accent, 45)}`, borderRadius: 4, padding: '0 4px', marginLeft: 4 }}>● HELD</span> : null);
const cache: Partial<Record<Market, PP>> = {};
export function usePerf(m: Market, reload: number): { d: PP | null; err: string | null } {
  const [d, setD] = useState<PP | null>(cache[m] ?? null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false; setD(cache[m] ?? null);
    const go = async (n: number) => {
      try {
        const r = await fetch(`/api/market/leadership-perf?market=${m}`, { cache: 'no-store' });
        const j: PP = await r.json();
        if (off) return;
        if (j.ok) { cache[m] = j; setD(j); setErr(null); } else if (n < 3) setTimeout(() => void go(n + 1), 20_000); else setErr(j.error || 'not available');
      } catch { if (!off && n < 3) setTimeout(() => void go(n + 1), 20_000); }
    };
    void go(0);
    return () => { off = true; };
  }, [m, reload]);
  return { d, err };
}

const pc = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const heat = (v: number | null | undefined, scale = 10) => {
  if (v == null) return undefined;
  const a = Math.min(1, Math.abs(v) / scale);
  return tint(v >= 0 ? T.up : T.down, Math.round(6 + a * 30));
};
const SCALE: Record<PerfKey, number> = { d1: 2, w1: 4, m1: 8, m3: 15, m6: 25, ytd: 30, y1: 40 };
const mcText = (mc: number | null, m: Market) => (mc == null ? '' : m === 'india' ? `₹${mc >= 1000 ? `${(mc / 1000).toFixed(1)}k` : Math.round(mc)} Cr` : mc >= 1000 ? `$${(mc / 1000).toFixed(1)}B` : `$${Math.round(mc)}M`);
const chartHref = (t: string, m: Market) => `/charts?ticker=${encodeURIComponent(t)}&market=${m === 'us' ? 'US' : 'IN'}`;

function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), W = 90, H = 24;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * W},${H - ((x - lo) / (hi - lo || 1)) * H}`).join(' ');
  return <svg width={W} height={H} style={{ display: 'block' }}><polyline points={pts} fill="none" stroke={v[v.length - 1] >= v[0] ? T.up : T.down} strokeWidth={1.4} /></svg>;
}

/** The best companies of one theme, compact — used by the radar and the theme list. */
export function BestCompanies({ th, m, max = 5 }: { th: ThemePerf | undefined; m: Market; max?: number }) {
  const held = useHeld(m);
  if (!th) return <div style={{ fontSize: 12.5, color: T.faint }}>Companies loading…</div>;
  if (!th.best.length) return <div style={{ fontSize: 12.5, color: T.faint }}>None of the theme&apos;s {th.n} companies are in the stock-screener data.</div>;
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {th.best.slice(0, max).map((x) => (
        <div key={x.t} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, fontSize: 13, alignItems: 'baseline' }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Link href={chartHref(x.t, m)} style={{ color: T.text, fontWeight: 900, textDecoration: 'none' }}>{x.t}</Link><HeldDot on={held.has(x.t)} /> <span style={{ color: T.dim }}>{x.n}</span> <span style={{ color: T.faint, fontSize: 11.5 }}>{mcText(x.mc, m)}</span>
          </span>
          <span style={{ fontSize: 12, color: T.dim, whiteSpace: 'nowrap' }}>{x.why.slice(0, 3).join(' · ') || '—'} · 3M <b style={{ color: (x.m3 ?? 0) >= 0 ? T.up : T.down }}>{pc(x.m3)}</b></span>
        </div>
      ))}
    </div>
  );
}

const th = { padding: '6px 8px', fontSize: 12, color: T.faint, textAlign: 'right' as const, whiteSpace: 'nowrap' as const, cursor: 'pointer' };
const td = { padding: '6px 8px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const };

export function PerformanceTab({ m, d, err, other }: { m: Market; d: PP | null; err: string | null; other?: React.ReactNode }) {
  const held = useHeld(m);
  const [sortK, setSortK] = useState<PerfKey>('m1');
  const [kind, setKind] = useState<'All' | 'Broad' | 'Size' | 'Sector' | 'Style'>('All');
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const idx = useMemo(() => (d?.indices || []).filter((x) => kind === 'All' || x.kind === kind).sort((a, b) => (b.r[sortK] ?? -999) - (a.r[sortK] ?? -999)), [d, sortK, kind]);
  const themes = useMemo(() => (d?.themes || []).filter((t) => t.found > 0 && (!q || `${t.name} ${t.group} ${t.members.map((x) => `${x.t} ${x.n}`).join(' ')}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (b.med[sortK] ?? -999) - (a.med[sortK] ?? -999)), [d, sortK, q]);
  if (!d) return <div style={{ ...card, color: T.faint, fontSize: 14 }}>{err || 'Building index and theme returns (first build of the hour can take a minute)…'}</div>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: T.dim }}>Sort by</span>
        {PERF_KEYS.map((k) => <button key={k} type="button" onClick={() => setSortK(k)} style={{ fontSize: 13, fontWeight: 900, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${sortK === k ? T.accent : T.border}`, background: sortK === k ? tint(T.accent, 14) : 'transparent', color: sortK === k ? T.accent : T.dim }}>{PERF_LABEL[k]}</button>)}
        <span style={{ fontSize: 12, color: T.faint, marginLeft: 'auto' }}>as of {d.indices.find((x) => x.at)?.at ?? '—'} close · built {new Date(d.builtAt).toLocaleTimeString()}{d.ageMin != null ? ` (${d.ageMin} min ago)` : ''}{d.missing.length ? ` · not available: ${d.missing.join(', ')}` : ''}</span>
      </div>
      <div style={{ ...card, padding: '8px 10px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16 }}>Indices {m === 'us' ? '🇺🇸' : '🇮🇳'}</b>
          {(['All', 'Broad', 'Size', 'Style', 'Sector'] as const).filter((k) => k === 'All' || d.indices.some((x) => x.kind === k)).map((k) => <button key={k} type="button" onClick={() => setKind(k)} style={{ fontSize: 12, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${kind === k ? T.accent : T.border}`, background: kind === k ? tint(T.accent, 12) : 'transparent', color: kind === k ? T.accent : T.dim }}>{k}</button>)}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>Index</th><th style={th}>Last</th>{PERF_KEYS.map((k) => <th key={k} style={{ ...th, color: sortK === k ? T.accent : T.faint }} onClick={() => setSortK(k)}>{PERF_LABEL[k]}{sortK === k ? ' ▾' : ''}</th>)}<th style={th}>6 months</th></tr></thead>
          <tbody>{idx.map((x) => (
            <tr key={x.s} style={{ borderTop: `1px solid ${T.border}` }}>
              <td style={{ ...td, textAlign: 'left' }}><b>{x.name}</b> <span style={{ color: T.faint, fontSize: 12 }}>{x.kind} · {x.s}</span></td>
              <td style={td}>{x.last == null ? '—' : x.last.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
              {PERF_KEYS.map((k) => <td key={k} style={{ ...td, background: heat(x.r[k], SCALE[k]), fontWeight: sortK === k ? 900 : 600 }}>{pc(x.r[k])}</td>)}
              <td style={td}><Spark v={x.spark} /></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ ...card, padding: '8px 10px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16 }}>Themes — median of their companies</b>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a theme or company (e.g. cyber, CRWD)" style={{ fontSize: 13, padding: '4px 9px', borderRadius: 7, border: `1px solid ${T.border}`, background: 'transparent', color: T.text, minWidth: 260 }} />
          <span style={{ fontSize: 12, color: T.faint }}>Click a theme for every company in it, best first (Stage 2, relative strength, current growth, distance from the high).</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>Theme</th><th style={th}>Companies</th>{PERF_KEYS.map((k) => <th key={k} style={{ ...th, color: sortK === k ? T.accent : T.faint }} onClick={() => setSortK(k)}>{PERF_LABEL[k]}{sortK === k ? ' ▾' : ''}</th>)}<th style={{ ...th, textAlign: 'left' }}>Best companies</th></tr></thead>
          <tbody>{themes.map((t) => (
            <React.Fragment key={t.id}>
              <tr onClick={() => setOpen(open === t.id ? null : t.id)} style={{ borderTop: `1px solid ${T.border}`, cursor: 'pointer', background: open === t.id ? tint(T.accent, 6) : undefined }}>
                <td style={{ ...td, textAlign: 'left' }}><b>{t.emoji} {t.name}</b> <span style={{ color: T.faint, fontSize: 12 }}>{t.group}</span>{(() => { const k = t.members.filter((x) => held.has(x.t)).length; return k ? <span style={{ fontSize: 11, fontWeight: 900, color: T.accent, marginLeft: 6 }}>● {k} held</span> : null; })()}</td>
                <td style={td}>{t.found}{t.found < t.n ? <span style={{ color: T.faint }}>/{t.n}</span> : ''}</td>
                {PERF_KEYS.map((k) => <td key={k} style={{ ...td, background: heat(t.med[k], SCALE[k]), fontWeight: sortK === k ? 900 : 600 }}>{pc(t.med[k])}</td>)}
                <td style={{ ...td, textAlign: 'left', fontSize: 13 }}>{t.best.slice(0, 3).map((x) => <span key={x.t} style={{ marginRight: 10 }}><b>{x.t}</b> <span style={{ color: T.faint }}>{x.n.slice(0, 18)}</span></span>)}</td>
              </tr>
              {open === t.id ? <tr><td colSpan={PERF_KEYS.length + 3} style={{ padding: '6px 10px', background: tint(T.accent, 3) }}><Members rows={t.members} m={m} /></td></tr> : null}
            </React.Fragment>))}</tbody>
        </table>
        <div style={{ fontSize: 12, color: T.faint, marginTop: 6 }}>Members are the Theme Rotation lists; figures from the stock-screener snapshot (the Technicals data). Theme figure = median of its companies (not a fund price). Best-first order is a reading aid, not a buy signal.</div>
      </div>
      {other}
    </div>
  );
}

function Members({ rows, m }: { rows: MemberRow[]; m: Market }) {
  const held = useHeld(m);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
      <thead><tr><th style={{ ...th, textAlign: 'left' }}>Company</th><th style={th}>Size</th><th style={th}>Stage</th><th style={th}>RS</th>{PERF_KEYS.map((k) => <th key={k} style={th}>{PERF_LABEL[k]}</th>)}<th style={th}>Off high</th><th style={th}>Revenue YoY (qtr)</th><th style={th}>Rule of 40</th><th style={{ ...th, textAlign: 'left' }}>Why ranked here</th></tr></thead>
      <tbody>{rows.map((x, i) => (
        <tr key={x.t} style={{ borderTop: `1px solid ${T.border}`, background: i < 3 ? tint(T.up, 5) : undefined }}>
          <td style={{ ...td, textAlign: 'left' }}><Link href={chartHref(x.t, m)} style={{ color: T.text, fontWeight: 900, textDecoration: 'none' }}>{x.t}</Link><HeldDot on={held.has(x.t)} /> <span style={{ color: T.dim }}>{x.n}</span> <Link href={`/company-lab?add=${m === 'us' ? 'US' : 'IN'}:${encodeURIComponent(x.t)}`} title="Open in Company Lab" style={{ color: T.accent, fontSize: 11.5, textDecoration: 'none' }}>🧪</Link></td>
          <td style={td}>{mcText(x.mc, m)}</td>
          <td style={{ ...td, color: x.st === 2 ? T.up : x.st === 4 ? T.down : T.dim, fontWeight: 800 }}>{x.st ?? '—'}</td>
          <td style={td}>{x.rs == null ? '—' : Math.round(x.rs)}</td>
          {PERF_KEYS.map((k) => <td key={k} style={{ ...td, background: heat(x[k], SCALE[k]) }}>{pc(x[k])}</td>)}
          <td style={td}>{x.dd == null ? '—' : `−${x.dd}%`}</td><td style={td}>{pc(x.revQ)}</td><td style={td}>{x.r40 == null ? '—' : Math.round(x.r40)}</td>
          <td style={{ ...td, textAlign: 'left', color: T.dim }}>{x.why.join(' · ') || '—'}</td>
        </tr>))}</tbody>
    </table>
  );
}

// ── Market cycles (SOIC-style) ─────────────────────────────────────────────
function CycleChart({ w, list }: { w: { d: string[]; c: number[] }; list: Cycle[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const W = 1400, H = 420, L = 56, R = 16, TOP = 16, B = 30;
  const n = w.c.length;
  if (n < 10) return null;
  const lo = Math.log(Math.min(...w.c)), hi = Math.log(Math.max(...w.c));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R), y = (v: number) => TOP + (1 - (Math.log(v) - lo) / (hi - lo || 1)) * (H - TOP - B);
  const iOf = (iso: string) => { let k = 0; for (let i = 0; i < n; i++) { if (w.d[i] <= iso) k = i; else break; } return k; };
  const path = w.c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks: number[] = []; { const a = Math.ceil(Math.log10(Math.exp(lo))), b = Math.floor(Math.log10(Math.exp(hi))); for (let e = a - 1; e <= b; e++) for (const mlt of [1, 2, 5]) { const v = mlt * 10 ** e; if (v >= Math.exp(lo) && v <= Math.exp(hi)) ticks.push(v); } }
  const years: number[] = []; for (let i = 1; i < n; i++) if (w.d[i].slice(0, 4) !== w.d[i - 1].slice(0, 4) && +w.d[i].slice(0, 4) % 2 === 0) years.push(i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHov(null)}
      onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHov(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))))); }}>
      {list.map((c, k) => { const a = iOf(c.start), b = iOf(c.peak), f = c.fall ? iOf(c.fall.low) : b; return (
        <g key={k}>
          <rect x={x(a)} y={TOP} width={Math.max(1, x(b) - x(a))} height={H - TOP - B} fill={tint(T.up, 9)} />
          {c.fall ? <rect x={x(b)} y={TOP} width={Math.max(1, x(f) - x(b))} height={H - TOP - B} fill={tint(T.down, 11)} /> : null}
          <text x={(x(a) + x(b)) / 2} y={TOP + 14} textAnchor="middle" fontSize={13} fontWeight={900} fill={T.up}>+{c.gainPct}%</text>
          {c.fall ? <text x={(x(b) + x(f)) / 2} y={H - B - 8} textAnchor="middle" fontSize={12} fontWeight={900} fill={T.down}>{c.fall.depthPct}%</text> : null}
        </g>); })}
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={T.border} strokeDasharray="2 4" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={T.faint}>{v.toLocaleString('en-US')}</text></g>)}
      {years.map((i) => <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={T.faint}>{w.d[i].slice(0, 4)}</text>)}
      <path d={path} fill="none" stroke={T.text} strokeWidth={1.6} />
      {list.map((c, k) => { const a = iOf(c.start), b = iOf(c.peak); return (
        <g key={`m${k}`}><circle cx={x(a)} cy={y(w.c[a])} r={4} fill={T.up} /><circle cx={x(b)} cy={y(w.c[b])} r={4} fill={c.current ? T.accent : T.down} /></g>); })}
      {hov != null ? <g><line x1={x(hov)} x2={x(hov)} y1={TOP} y2={H - B} stroke={T.accent} /><rect x={Math.min(x(hov) + 6, W - 170)} y={TOP + 22} width={160} height={36} rx={5} fill={T.bg ?? '#fff'} stroke={T.border} /><text x={Math.min(x(hov) + 14, W - 162)} y={TOP + 37} fontSize={12} fill={T.dim}>{w.d[hov]}</text><text x={Math.min(x(hov) + 14, W - 162)} y={TOP + 52} fontSize={13} fontWeight={900} fill={T.text}>{w.c[hov].toLocaleString('en-US')}</text></g> : null}
    </svg>
  );
}
export function CyclesTab({ m, d, err, history }: { m: Market; d: PP | null; err: string | null; history?: React.ReactNode }) {
  const cy = d?.cycles;
  if (!cy) return <div style={{ ...card, color: T.faint, fontSize: 14 }}>{err || (d ? 'The long benchmark history is not available right now.' : 'Building the long history (first build can take a minute)…')}</div>;
  const done = cy.list.filter((c) => !c.current);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...card, padding: '10px 12px' }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{done.length} bull runs since {cy.from?.slice(0, 4)} — what led each one</div>
        <div style={{ fontSize: 13, color: T.dim, marginTop: 2 }}>{cy.benchName}, weekly closes, log scale. <span style={{ color: T.up, fontWeight: 800 }}>Green</span> = bull run (low → peak), <span style={{ color: T.down, fontWeight: 800 }}>red</span> = bust (a fall of 20%+). A new cycle is usually led by a different theme than the last one.</div>
        <CycleChart w={cy.weekly} list={cy.list} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
        {cy.list.slice().reverse().map((c, k) => (
          <div key={k} style={{ ...card, padding: '10px 12px', borderColor: c.current ? tint(T.accent, 50) : undefined }}>
            <div style={{ fontSize: 12, color: T.faint, fontWeight: 900 }}>{c.start.slice(0, 7)} → {c.current ? 'now' : c.peak.slice(0, 7)}{c.current ? ' · CURRENT' : ''}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: T.up }}>+{c.gainPct}% <span style={{ fontSize: 13, color: T.dim, fontWeight: 600 }}>in {c.months} months</span></div>
            <div style={{ fontSize: 13, marginTop: 4 }}><span style={{ color: T.faint }}>Led by: </span>{c.ledBy.length ? c.ledBy.map((l) => <b key={l.name} style={{ marginRight: 8 }}>{l.name} <span style={{ color: T.up }}>+{l.pct}%</span></b>) : <span style={{ color: T.faint }}>{c.ledNote}</span>}{c.ledBy.length && c.ledNote ? <div style={{ fontSize: 11, color: T.faint }}>{c.ledNote}</div> : null}</div>
            {c.fall ? <div style={{ fontSize: 13, marginTop: 4, color: T.down }}><b>{c.fall.depthPct}%</b> over {c.fall.months} months{c.fall.cause ? <span style={{ color: T.dim }}> · {c.fall.cause}</span> : null}</div> : <div style={{ fontSize: 13, marginTop: 4, color: T.accent }}>still running — no 20% fall since the low</div>}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: T.faint }}>Turning points need a 20% move the other way to count. "Led by" = the sector indices / funds that rose most over that bull run, from the histories that existed then ({m === 'india' ? 'NSE sector indices start 2010–11; earlier India runs use equal-weight baskets of the large companies of the time, marked *' : 'US sector funds start 1998–99'}). Fall causes are short historical context, written by hand.</div>
      {history}
    </div>
  );
}
