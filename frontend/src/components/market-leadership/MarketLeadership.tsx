'use client';
// ═══════════════════════════════════════════════════════════════════════════
// MARKET LEADERSHIP & RISK  (zzz1290) — one command centre over the site's existing engines:
//   • /api/market/leadership-risk — benchmark structure, distribution days, rally / follow-through, breadth and leader health
//     (built on the stock-screener snapshot = the Technicals engine), emerging names, regime, risk posture, recovery checks
//   • Theme Rotation (useThemeRotationModel — the SAME model the Theme Rotation tab renders) + Theme Cycle classification
//   • /api/market/theme-cycle — past 15%+ falls for the historical comparison
// USA and India are evaluated independently; the cross-market table only pairs themes with a real counterpart.
// Nothing here is a buy or sell signal.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Market, ThemeRow } from '@/lib/theme-rotation/types';
import type { ThemeView } from '@/lib/theme-rotation/view-model';
import type { MarketPayload } from '@/lib/market-leadership/server';
import type { EpisodeRow } from '@/lib/theme-cycle/core';
import { CROSS_PAIRS, crossVerdict, fmtN, fmtP, type Leader, type Tone } from '@/lib/market-leadership/core';
import { dailyBrief, type BriefLine } from '@/lib/market-leadership/brief';
import { classifyCycle, leadershipTransitions, survivalClass, watchlistOrder, STATE_LABEL, STATE_HELP, SURVIVAL_LABEL, type CycleRead, type CycleState, type SurvivalClass } from '@/lib/theme-cycle/classify';
import { previousStates } from '@/lib/theme-cycle/memory';
import { useThemeRotationModel } from '@/components/dashboard/theme-rotation/useThemeModel';
import { card } from '@/components/dashboard/theme-rotation/ui';
import { T, tint } from '@/components/dashboard/theme-rotation/tokens';
import { usePerf, PerformanceTab, CyclesTab, BestCompanies, useHeld, HeldDot } from './PerfTabs';
import { CyclePanel } from '@/components/dashboard/theme-rotation/CyclePanel';

type Tab = 'overview' | 'leaders' | 'themes' | 'performance' | 'cycles' | 'compare';
const TABS: Array<[Tab, string]> = [['overview', '🧭 Overview'], ['leaders', '🏆 Leaders'], ['themes', '🔄 Themes & cycle'], ['performance', '📊 Performance'], ['cycles', '📈 Market cycles'], ['compare', '🌐 USA vs India']];

type LR = MarketPayload & { ok: boolean; error?: string; detail?: string; ageMin?: number };
const MK: Record<Market, { code: 'US' | 'IN'; q: string; flag: string; name: string }> = {
  us: { code: 'US', q: 'us', flag: '🇺🇸', name: 'USA' },
  india: { code: 'IN', q: 'india', flag: '🇮🇳', name: 'India' },
};
const TONE: Record<Tone, string> = { good: T.up, warn: T.warn, bad: T.down, neutral: T.flat, unknown: T.absent };
const REGIME_TONE: Record<string, string> = {
  STRONG_UPTREND: T.up, UPTREND_UNDER_PRESSURE: T.warn, MARKET_CORRECTION: T.down, SEVERE_CORRECTION: T.down, BEAR_MARKET: T.alarm,
  EARLY_RECOVERY: T.info, CONFIRMED_RECOVERY: T.up, MIXED: T.flat, INSUFFICIENT_DATA: T.absent,
};
const POSTURE_TONE: Record<string, string> = { AGGRESSIVE: T.up, NORMAL: T.up, CAUTIOUS: T.warn, DEFENSIVE: T.down, RECOVERY: T.info, INSUFFICIENT: T.absent };
const LEADER_TONE: Record<Leader['state'], string> = { HEALTHY: T.up, UNDER_PRESSURE: T.warn, BROKEN: T.down, RECOVERING: T.info };
const LEADER_LABEL: Record<Leader['state'], string> = { HEALTHY: 'Healthy', UNDER_PRESSURE: 'Under pressure', BROKEN: 'Broken', RECOVERING: 'Recovering' };
const SURV_TONE: Record<SurvivalClass, string> = {
  CONFIRMED_LEADER: T.up, EMERGING_LEADER: T.up, RECOVERING: T.accent, STABILISING: T.info, HOLDING_UP: T.up, FALLING_LESS: T.flat,
  IN_LINE: T.absent, FALLING_HARD: T.down, BROKEN: T.alarm,
};
const SURV_ORDER: SurvivalClass[] = ['CONFIRMED_LEADER', 'EMERGING_LEADER', 'RECOVERING', 'STABILISING', 'HOLDING_UP', 'FALLING_LESS', 'IN_LINE', 'FALLING_HARD', 'BROKEN'];
const KIND: Record<BriefLine['kind'], [string, string]> = { data: ['DATA', T.dim], calc: ['CALC', T.info], read: ['READ', T.accent], unknown: ['UNKNOWN', T.absent] };

const pct = (f: number | null | undefined, dp = 0) => (typeof f === 'number' && isFinite(f) ? `${f > 0 ? '+' : f < 0 ? '−' : ''}${Math.abs(f * 100).toFixed(dp)}%` : '—');
const pts = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` : '—');
const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
const fmtMon = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ── data hooks ─────────────────────────────────────────────────────────────
function useLR(reload: number, poll = 0) {
  const [d, setD] = useState<Record<Market, LR | null>>({ us: null, india: null });
  const [err, setErr] = useState<Record<Market, string | null>>({ us: null, india: null });
  const [tick, setTick] = useState(0);
  const lastReload = React.useRef(0);
  const staleTries = React.useRef(0);
  useEffect(() => {
    let dead = false;
    const force = reload !== lastReload.current; lastReload.current = reload;
    (['us', 'india'] as Market[]).forEach(async (m) => {
      try {
        const r = await fetch(`/api/market/leadership-risk?market=${m}${force && reload ? '&refresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(70_000) });
        const j = (await r.json()) as LR;
        if (dead) return;
        if (j.ok) {
          setD((x) => ({ ...x, [m]: j })); setErr((x) => ({ ...x, [m]: null }));
          // zzz1291 — an old copy was served while the server rebuilds: ask again shortly so the page never sits on it
          if ((j.ageMin ?? 0) > 45 && staleTries.current < 4) { staleTries.current++; setTimeout(() => !dead && setTick((t) => t + 1), 75_000); }
        }
        else { setErr((x) => ({ ...x, [m]: j.error || 'unavailable' })); setTimeout(() => !dead && setTick((t) => t + 1), 30_000); }
      } catch { if (!dead) { setErr((x) => ({ ...x, [m]: 'Request timed out — retrying.' })); setTimeout(() => !dead && setTick((t) => t + 1), 30_000); } }
    });
    return () => { dead = true; };
  }, [reload, tick, poll]);
  return { d, err };
}
function useCycleHist() {
  const [d, setD] = useState<Record<Market, { episodes: EpisodeRow[]; benchName: string } | null>>({ us: null, india: null });
  useEffect(() => {
    let dead = false;
    (['us', 'india'] as Market[]).forEach(async (m) => {
      for (let k = 0; k < 4 && !dead; k++) {
        try { const j = await (await fetch(`/api/market/theme-cycle?region=${m}`, { cache: 'no-store', signal: AbortSignal.timeout(100_000) })).json(); if (j?.ok) { if (!dead) setD((x) => ({ ...x, [m]: j })); return; } } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 30_000));
      }
    });
    return () => { dead = true; };
  }, []);
  return d;
}
interface ThemeSide { payload: any; views: ThemeView[]; reads: Map<string, CycleRead>; nameOf: (id: string) => string; benchName: string; payloadOk: boolean; loading: boolean; error: string | null; ref: any }
function useThemeSide(region: Market): ThemeSide {
  const m = useThemeRotationModel(region, 0);
  const views = m.vm?.themes || [];
  const prev = useMemo(() => (typeof window === 'undefined' ? new Map<string, CycleState>() : previousStates(region)), [region]);
  const reads = useMemo(() => {
    const out = new Map<string, CycleRead>();
    if (!m.payload) return out;
    for (const v of views) out.set(v.row.id, classifyCycle({ row: v.row, L: v.a.layers, flags: v.a.flags, bench: m.payload.benchmarkRet, ref: m.payload.cycleRef, previous: prev.get(v.row.id) ?? null }));
    return out;
  }, [views, m.payload, prev]);
  const nameOf = useMemo(() => { const by = new Map(views.map((v) => [v.row.id, `${v.row.emoji} ${v.row.name}`])); return (id: string) => by.get(id) || id; }, [views]);
  return { payload: m.payload, views, reads, nameOf, benchName: m.payload?.benchmark?.name || (region === 'us' ? 'S&P 500' : 'Nifty 50'), payloadOk: !!m.payload, loading: m.board.loading, error: m.board.error ?? null, ref: m.payload?.cycleRef ?? null };
}

// ── small UI bits ──────────────────────────────────────────────────────────
const Pill = ({ c, children, title, big }: { c: string; children: React.ReactNode; title?: string; big?: boolean }) => (
  <span title={title} style={{ display: 'inline-block', fontSize: big ? 15 : 11, fontWeight: 900, padding: big ? '4px 10px' : '2px 7px', borderRadius: 6, color: c, background: tint(c, 13), border: `1px solid ${tint(c, 42)}`, whiteSpace: 'nowrap' }}>{children}</span>
);
const H2 = ({ n, children, hint }: { n: number; children: React.ReactNode; hint?: React.ReactNode }) => (
  <div style={{ margin: '18px 0 8px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
    <span style={{ fontSize: 11, fontWeight: 900, color: T.faint, fontFamily: T.mono }}>{String(n).padStart(2, '0')}</span>
    <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: 0.2 }}>{children}</span>
    {hint ? <span style={{ fontSize: 11.5, color: T.faint }}>{hint}</span> : null}
  </div>
);
const Dot = ({ c }: { c: string }) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: c, marginRight: 6, flex: '0 0 auto' }} />;
const Stat = ({ label, value, sub, c }: { label: string; value: React.ReactNode; sub?: React.ReactNode; c?: string }) => (
  <div style={{ ...card, padding: '8px 10px', minWidth: 0 }}>
    <div style={{ fontSize: 10.5, fontWeight: 900, color: T.faint, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 900, color: c || T.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>{value}</div>
    {sub ? <div style={{ fontSize: 11.5, color: T.dim }}>{sub}</div> : null}
  </div>
);
const Btn = ({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} style={{ fontSize: 12.5, fontWeight: 800, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${on ? T.accent : T.border2}`, background: on ? tint(T.accent, 15) : 'transparent', color: on ? T.accent : T.dim }}>{children}</button>
);

// ── 1. executive card ──────────────────────────────────────────────────────
function ExecCard({ m, p, err, sel, onSel }: { m: Market; p: LR | null; err: string | null; sel: boolean; onSel: () => void }) {
  const mk = MK[m];
  if (!p) return <div style={{ ...card, minHeight: 170 }}><div style={{ fontWeight: 900 }}>{mk.flag} {mk.name}</div><div style={{ color: T.faint, fontSize: 12.5, marginTop: 10 }}>{err || 'Reading benchmark, breadth and leaders…'}</div></div>;
  const rc = REGIME_TONE[p.regime.regime] || T.flat, pc = POSTURE_TONE[p.posture.posture] || T.flat;
  const h = p.health;
  return (
    <div onClick={onSel} style={{ ...card, cursor: 'pointer', borderColor: sel ? tint(T.accent, 60) : T.border, boxShadow: sel ? `0 0 0 1px ${tint(T.accent, 40)}` : undefined, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 900 }}>{mk.flag} {mk.name} <span style={{ fontSize: 11.5, color: T.faint, fontWeight: 600 }}>· {p.bench?.name || 'benchmark n/a'}</span></div>
        <span style={{ fontSize: 10.5, color: T.faint }}>{p.bench ? `index to ${fmtDay(p.bench.last)}` : ''}{p.ageMin != null ? ` · built ${p.ageMin}m ago` : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <Pill c={rc} big title="Multi-factor regime — see the factors below">{p.regime.label}</Pill>
        <Pill c={pc} title={`Risk level: ${p.posture.level}`}>{p.posture.label} · risk {p.posture.level.toLowerCase()}</Pill>
        {!p.regime.complete ? <Pill c={T.warn} title={`Missing: ${p.regime.missing.join(', ')}`}>partial data</Pill> : null}
      </div>
      <div style={{ fontSize: 12, color: T.dim, marginBottom: 8, lineHeight: 1.45 }}>{p.regime.reasons.join('; ')}.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '4px 12px' }}>
        {p.regime.factors.map((f) => (
          <div key={f.key} title={f.note} style={{ display: 'flex', alignItems: 'flex-start', fontSize: 11.5, lineHeight: 1.35, minWidth: 0 }}>
            <Dot c={TONE[f.tone]} /><span style={{ minWidth: 0 }}><b style={{ color: T.text }}>{f.label}:</b> <span style={{ color: T.dim }}>{f.value}</span></span>
          </div>
        ))}
      </div>
      {h ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', borderTop: `1px dashed ${T.border}`, paddingTop: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: h.n - h.above200 > h.n / 2 ? T.down : T.up, fontVariantNumeric: 'tabular-nums' }}>{h.n - h.above200} of {h.n}</span>
          <span style={{ fontSize: 12, color: T.dim }}>leaders below their 200-day line · <b style={{ color: T.up }}>{h.above200} above</b> · {h.healthy} healthy</span>
        </div>
      ) : null}
    </div>
  );
}

// ── 3. benchmark chart (price, 50 / 200-day, volume, distribution days) ───
function BenchChart({ p }: { p: MarketPayload }) {
  const ch = p.chart; const b = p.bench;
  if (!ch || !b) return <div style={{ color: T.faint, fontSize: 12.5 }}>No benchmark history.</div>;
  const W = 760, H = 260, VH = 60, L = 8, R = 60;
  const n = ch.c.length;
  const vals = [...ch.c, ...ch.ma50.filter((x): x is number => x != null), ...ch.ma200.filter((x): x is number => x != null)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - VH - 24);
  const vmax = Math.max(...ch.v, 1);
  const line = (arr: Array<number | null>) => arr.map((v, i) => (v == null ? '' : `${i && arr[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const distSet = new Set(b.dist.days.map((d) => d.d));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={`${b.name} with 50- and 200-day lines and distribution days`}>
      {ch.v.map((v, i) => { const h = (v / vmax) * (VH - 6); return <rect key={i} x={x(i) - 1.6} y={H - 16 - h} width={3.2} height={h} fill={distSet.has(ch.d[i]) ? T.down : tint(T.dim, 45)} />; })}
      <path d={line(ch.ma200)} fill="none" stroke={T.warn} strokeWidth={1.6} strokeDasharray="5 4" />
      <path d={line(ch.ma50)} fill="none" stroke={T.info} strokeWidth={1.4} />
      <path d={line(ch.c)} fill="none" stroke={T.text} strokeWidth={1.8} />
      {ch.d.map((d, i) => (distSet.has(d) ? <circle key={d} cx={x(i)} cy={y(ch.c[i])} r={3.6} fill={T.down}><title>{`Distribution day ${d}`}</title></circle> : null))}
      {b.rally.ftdDay && ch.d.indexOf(b.rally.ftdDay) >= 0 ? <g><circle cx={x(ch.d.indexOf(b.rally.ftdDay))} cy={y(ch.c[ch.d.indexOf(b.rally.ftdDay)])} r={5} fill="none" stroke={T.up} strokeWidth={2} /><title>Follow-through day</title></g> : null}
      {[['Index', T.text, ch.c[n - 1]], ['50-day', T.info, ch.ma50[n - 1]], ['200-day', T.warn, ch.ma200[n - 1]]].map(([lab, c, v], k) => (v != null ? <text key={k} x={W - R + 4} y={y(v as number) + 4} fontSize={11} fill={c as string} fontWeight={800}>{lab as string}</text> : null))}
      <text x={L} y={H - 2} fontSize={10.5} fill={T.faint}>{fmtDay(ch.d[0])}</text>
      <text x={W - R} y={H - 2} fontSize={10.5} fill={T.faint} textAnchor="end">{fmtDay(ch.d[n - 1])}</text>
    </svg>
  );
}

function Spark({ vals, color, w = 120, h = 26 }: { vals: Array<number | null>; color: string; w?: number; h?: number }) {
  const v = vals.filter((x): x is number => x != null);
  if (v.length < 2) return <span style={{ fontSize: 11, color: T.faint }}>builds daily</span>;
  const lo = Math.min(...v), hi = Math.max(...v);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join('');
  return <svg width={w} height={h} style={{ display: 'block' }}><path d={d} fill="none" stroke={color} strokeWidth={1.6} /></svg>;
}

// ── 4. survival map (themes over the same peak → trough → today window) ───
function SurvivalMap({ side, region }: { side: ThemeSide; region: Market }) {
  const ref = side.ref;
  const rows = side.views.map((v) => v.row).filter((t) => t.cycle?.fall != null && t.cycle?.sincePeak != null);
  if (!ref || !rows.length) return <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>{side.payloadOk ? `${side.benchName} has had no 5%+ correction in the last nine months, so there is no common fall to measure themes against. Section 05 compares them on relative strength instead.` : 'Theme Rotation is loading…'}</div>;
  const cls = new Map(rows.map((t) => [t.id, survivalClass(t, side.reads.get(t.id)!)] as const));
  const sorted = [...rows].sort((a, b) => SURV_ORDER.indexOf(cls.get(a.id)!) - SURV_ORDER.indexOf(cls.get(b.id)!) || b.cycle!.sincePeak! - a.cycle!.sincePeak!);
  const vals = sorted.flatMap((t) => [t.cycle!.fall!, t.cycle!.sincePeak!]).concat([ref.benchFall, ref.benchSincePeak]).map((v: number) => v * 100);
  const lo = Math.floor(Math.min(...vals) / 10) * 10, hi = Math.max(10, Math.ceil(Math.max(...vals) / 10) * 10);
  const W = 900, L = 210, R = 120, RH = 22;
  const x = (v: number) => L + ((v * 100 - lo) / (hi - lo)) * (W - L - R);
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 10) ticks.push(v);
  const H = sorted.length * RH + 44;
  return (
    <div style={{ ...card, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 4 }}>
        Each theme: <b>○ in the fall</b> ({fmtDay(ref.peak)} → {fmtDay(ref.trough)}) → <b>● now</b> (since the same high). Grey lines: {side.benchName} {pct(ref.benchFall)} in the fall, {pct(ref.benchSincePeak)} now. Colour = how it has come through — holding up is not the same as leading.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 680, display: 'block' }} role="img" aria-label="Leadership survival map">
          {ticks.map((v) => <g key={v}><line x1={L + ((v - lo) / (hi - lo)) * (W - L - R)} x2={L + ((v - lo) / (hi - lo)) * (W - L - R)} y1={14} y2={H - 22} stroke={v === 0 ? T.dim : T.border} /><text x={L + ((v - lo) / (hi - lo)) * (W - L - R)} y={H - 6} fontSize={11} textAnchor="middle" fill={T.faint}>{v > 0 ? '+' : ''}{v}%</text></g>)}
          <line x1={x(ref.benchFall)} x2={x(ref.benchFall)} y1={14} y2={H - 22} stroke={T.flat} strokeWidth={2} strokeDasharray="4 3" />
          <line x1={x(ref.benchSincePeak)} x2={x(ref.benchSincePeak)} y1={14} y2={H - 22} stroke={T.flat} strokeWidth={2} />
          <text x={x(ref.benchSincePeak)} y={11} fontSize={10.5} textAnchor="middle" fill={T.dim}>{side.benchName} now</text>
          {sorted.map((t, i) => {
            const c = SURV_TONE[cls.get(t.id)!]; const yy = 26 + i * RH;
            return (
              <g key={t.id}>
                <title>{`${t.name}: ${pct(t.cycle!.fall)} in the fall (${pts(t.cycle!.relFall)} pts vs market), ${pct(t.cycle!.sincePeak)} since the high, ${pct(t.cycle!.fromTrough)} from the low — ${SURVIVAL_LABEL[cls.get(t.id)!]}`}</title>
                <text x={L - 8} y={yy + 4} fontSize={12} textAnchor="end" fill={T.text}>{t.emoji} {t.name.length > 22 ? `${t.name.slice(0, 21)}…` : t.name}</text>
                <line x1={x(t.cycle!.fall!)} x2={x(t.cycle!.sincePeak!)} y1={yy} y2={yy} stroke={tint(c, 55)} strokeWidth={3} />
                <circle cx={x(t.cycle!.fall!)} cy={yy} r={4.5} fill={T.card} stroke={c} strokeWidth={2} />
                <circle cx={x(t.cycle!.sincePeak!)} cy={yy} r={5} fill={c} />
                <text x={W - R + 8} y={yy + 4} fontSize={11} fill={c} fontWeight={800}>{SURVIVAL_LABEL[cls.get(t.id)!].replace(' (early rotation)', '')}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ fontSize: 11, color: T.faint }}>{region === 'india' ? 'Themes are NSE sector indices or baskets of their members.' : 'Themes are sector / theme ETFs.'} Same two dates for every theme and for the market.</div>
    </div>
  );
}

// ── main ───────────────────────────────────────────────────────────────────
export default function MarketLeadership() {
  const [reload, setReload] = useState(0);
  const [sel, setSel] = useState<Market>('us');
  useEffect(() => { try { const r = new URLSearchParams(window.location.search).get('market'); if (r === 'india' || r === 'us') setSel(r); } catch { /* ignore */ } }, []);
  const [poll, setPoll] = useState(0);
  const { d: lr, err } = useLR(reload, poll);
  const us = useThemeSide('us'), ind = useThemeSide('india');
  const hist = useCycleHist();
  const side = sel === 'us' ? us : ind;
  const p = lr[sel];
  const [showAllLeaders, setShowAllLeaders] = useState(false);
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { try { const t = new URLSearchParams(window.location.search).get('tab'); if (t && TABS.some(([k]) => k === t)) setTab(t as Tab); } catch { /* ignore */ } }, []);
  const pickTab = (t: Tab) => { setTab(t); try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()); } catch { /* ignore */ } };
  // zzz1291 — always live: everything re-reads every 10 minutes while the page is open (the server caches keep it cheap)
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') setPoll((r) => r + 1); }, 10 * 60_000); return () => clearInterval(id); }, []);
  const perf = usePerf(sel, reload + poll);
  const held = useHeld(sel);
  const perfTheme = useMemo(() => new Map((perf.d?.themes || []).map((t) => [t.id, t])), [perf.d]);

  const themeBrief = (s: ThemeSide) => {
    if (!s.payloadOk) return null;
    const rows = s.views.map((v) => v.row);
    const byRel = rows.filter((t) => t.cycle?.relSincePeak != null || t.ret).sort((a, b) => (a.cycle?.relSincePeak ?? -(0)) - (b.cycle?.relSincePeak ?? 0));
    const reads = [...s.reads.values()];
    const holding = rows.filter((t) => { const r = s.reads.get(t.id); return r && (survivalClass(t, r) === 'HOLDING_UP' || survivalClass(t, r) === 'FALLING_LESS'); }).map((t) => s.nameOf(t.id));
    return {
      mostDamaged: byRel.filter((t) => (t.cycle?.relSincePeak ?? 0) <= -5).slice(0, 5).map((t) => s.nameOf(t.id)),
      holdingUp: holding,
      early: reads.filter((r) => r.state === 'EARLY_ROTATION' || r.state === 'STABILISING').sort(watchlistOrder).map((r) => s.nameOf(r.id)),
      emerging: reads.filter((r) => r.state === 'EMERGING_LEADER' || r.state === 'CONFIRMED_LEADER').map((r) => s.nameOf(r.id)),
      failed: reads.filter((r) => r.state === 'FAILED_TRANSITION').map((r) => s.nameOf(r.id)),
    };
  };
  const briefs = useMemo(() => ({ us: dailyBrief(lr.us, themeBrief(us)), india: dailyBrief(lr.india, themeBrief(ind)) }), [lr, us, ind]); // eslint-disable-line react-hooks/exhaustive-deps

  const themeRows = useMemo(() => side.views.map((v) => ({ v, r: side.reads.get(v.row.id)!, s: survivalClass(v.row, side.reads.get(v.row.id)!) })).filter((x) => x.r), [side]);
  const radar = useMemo(() => themeRows.filter((x) => ['EMERGING_LEADER', 'EARLY_ROTATION', 'STABILISING', 'FAILED_TRANSITION'].includes(x.r.state)).sort((a, b) => watchlistOrder(a.r, b.r)), [themeRows]);
  const trans = useMemo(() => leadershipTransitions(side.views.map((v) => v.row), side.reads, 6), [side]);
  const cross = useMemo(() => CROSS_PAIRS.map((pr) => {
    const a = us.views.find((v) => v.row.id === pr.us), b = ind.views.find((v) => v.row.id === pr.india);
    const ra = a ? us.reads.get(a.row.id) : undefined, rb = b ? ind.reads.get(b.row.id) : undefined;
    const sum = (r?: CycleRead) => (r ? { rel12w: r.rel12w, improving: ['EMERGING_LEADER', 'EARLY_ROTATION', 'CONFIRMED_LEADER'].includes(r.state), weakening: ['BROKEN', 'FAILED_TRANSITION', 'NOT_READY'].includes(r.state) } : null);
    return { pr, a, b, ra, rb, verdict: crossVerdict(sum(ra), sum(rb)) };
  }), [us, ind]);

  const leadersShown = p ? (showAllLeaders ? p.leaders : p.leaders.slice(0, 12)) : [];
  const eps = hist[sel]?.episodes || [];

  return (
    <div style={{ padding: '14px 22px 40px', maxWidth: 1880, margin: '0 auto', color: T.text, zoom: 1.12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: 0.2 }}>Market Leadership &amp; Risk</h1>
          <div style={{ fontSize: 12.5, color: T.faint, marginTop: 2 }}>USA · India · regime · distribution · leaders · themes · rotation · risk — decision support, not buy or sell signals.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn on={sel === 'us'} onClick={() => setSel('us')}>🇺🇸 USA detail</Btn>
          <Btn on={sel === 'india'} onClick={() => setSel('india')}>🇮🇳 India detail</Btn>
          <Btn onClick={() => setReload((r) => r + 1)}>↻ Refresh</Btn>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '12px 0 4px', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 5, background: T.bg, paddingTop: 4 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => pickTab(k)} style={{ fontSize: 14, fontWeight: 900, padding: '8px 14px', cursor: 'pointer', border: 'none', borderBottom: `3px solid ${tab === k ? T.accent : 'transparent'}`, background: 'transparent', color: tab === k ? T.accent : T.dim }}>{l}</button>)}
        <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11.5, color: T.faint }}>{MK[sel].flag} {MK[sel].name} · {p?.ageMin != null ? `data ${p.ageMin} min old` : 'loading'} · re-reads every 10 min</span>
      </div>
      {tab === 'overview' && (<>

      <H2 n={1} hint="Each market judged on its own data. Click a card for its detail below.">Executive market regime</H2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 10 }}>
        <ExecCard m="us" p={lr.us} err={err.us} sel={sel === 'us'} onSel={() => setSel('us')} />
        <ExecCard m="india" p={lr.india} err={err.india} sel={sel === 'india'} onSel={() => setSel('india')} />
      </div>

      <H2 n={2} hint="Every line comes from a figure on this page. DATA = observed · CALC = calculated · READ = interpretation · UNKNOWN = not available.">Daily market brief</H2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 10 }}>
        {(['us', 'india'] as Market[]).map((m) => (
          <div key={m} style={{ ...card, padding: '10px 12px' }}>
            <div style={{ fontWeight: 900, marginBottom: 4 }}>{MK[m].flag} {MK[m].name}</div>
            {briefs[m].map((l) => (
              <div key={l.label} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, fontSize: 12, lineHeight: 1.45, padding: '3px 0', borderTop: `1px solid ${T.border}` }}>
                <span style={{ color: T.faint, fontWeight: 800 }}>{l.label} <span style={{ fontSize: 9, fontWeight: 900, color: KIND[l.kind][1], marginLeft: 3 }}>{KIND[l.kind][0]}</span></span>
                <span style={{ color: T.dim }}>{l.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      </>)}
      <div style={{ margin: '22px 0 0', padding: '8px 12px', borderRadius: 8, background: tint(T.accent, 8), border: `1px solid ${tint(T.accent, 30)}`, fontSize: 13, fontWeight: 900 }}>
        {MK[sel].flag} {MK[sel].name} in detail <span style={{ fontWeight: 600, color: T.faint, fontSize: 12 }}>— switch with the buttons at the top</span>
      </div>

      {!p ? <div style={{ ...card, marginTop: 10, color: T.faint, fontSize: 12.5 }}>{err[sel] || 'Loading…'}</div> : (
        <>
          {tab === 'overview' && (<>
          <H2 n={3} hint={`${p.bench?.name ?? ''} — completed sessions${p.liveSession ? `; today's session (${p.liveSession}) joins once it closes` : ''}.`}>The market: structure &amp; distribution</H2>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.1fr) minmax(260px, 1fr)', gap: 10 }} className="mlr-two">
            <div style={{ ...card, padding: '8px 10px' }}>
              <BenchChart p={p} />
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: T.dim, flexWrap: 'wrap' }}>
                <span><b style={{ color: T.text }}>━</b> index</span><span><b style={{ color: T.info }}>━</b> 50-day</span><span><b style={{ color: T.warn }}>╌</b> 200-day</span><span><b style={{ color: T.down }}>●</b> distribution day</span><span><b style={{ color: T.up }}>○</b> follow-through day</span>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
              {p.bench ? (
                <div style={{ ...card, borderColor: tint(p.bench.dist.level === 'heavy' ? T.down : p.bench.dist.level === 'pressure' ? T.warn : T.up, 50), padding: '10px 12px' }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: p.bench.dist.level === 'heavy' ? T.down : p.bench.dist.level === 'pressure' ? T.warn : T.up }}>{p.bench.dist.volumeOk ? `${p.bench.dist.count} distribution days` : 'Volume n/a'}</div>
                  <div style={{ fontSize: 12, color: T.dim }}>in the last 25 sessions · 4–5 = pressure, 6+ = heavy · {p.bench.dist.trend}{p.bench.dist.ago5 != null ? ` (5 sessions ago ${p.bench.dist.ago5}, 10 ago ${p.bench.dist.ago10 ?? '—'}, 20 ago ${p.bench.dist.ago20 ?? '—'})` : ''}{p.bench.dist.cluster10 >= 3 ? ` · ${p.bench.dist.cluster10} in the last 10 sessions (clustered)` : ''}</div>
                  {p.bench.dist.days.length ? <div style={{ fontSize: 11.5, color: T.dim, marginTop: 4 }}>{p.bench.dist.days.map((d) => `${fmtDay(d.d)} ${fmtP(d.chg, 2)}`).join(' · ')}</div> : null}
                  <div style={{ fontSize: 10.5, color: T.faint, marginTop: 4 }}>Down ≥ 0.2% on higher volume than the day before; drops out after 25 sessions or once the index closes 5% above it. Stalling days not counted. Never used alone.</div>
                </div>
              ) : null}
              {p.bench ? (
                <div style={{ ...card, padding: '8px 10px', fontSize: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 2 }}>Rally attempt</div>
                  <div style={{ color: T.dim }}>{p.bench.rally.state === 'no-correction' ? 'No 7%+ correction in the last six months — no rally attempt to track.' : p.bench.rally.state === 'follow-through' ? `Low ${fmtDay(p.bench.rally.lowDay)}; follow-through ${fmtDay(p.bench.rally.ftdDay)} (+${p.bench.rally.ftdGain}% on higher volume). Index ${fmtP(p.bench.rally.fromLow)} from the low. One piece of evidence — leaders and breadth must confirm.` : p.bench.rally.state === 'attempt' ? `Day ${p.bench.rally.day} of a rally attempt from the ${fmtDay(p.bench.rally.lowDay)} low — no follow-through yet (needs ≥ 1.25% up on higher volume from day 4).` : p.bench.rally.state === 'failed' ? 'The last rally attempt failed — the low was undercut.' : `Still making lows (latest ${fmtDay(p.bench.rally.lowDay)}). No rally attempt has started.`}</div>
                </div>
              ) : null}
            </div>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: T.faint, fontSize: 11, textAlign: 'right' }}><th style={{ textAlign: 'left', padding: '4px 6px' }}>Benchmark</th><th>vs 20-day</th><th>vs 50-day</th><th>vs 200-day</th><th>50-day line</th><th>200-day line</th><th>Off high</th><th>Volatility (normal)</th><th>1 wk</th><th>1 mo</th><th>3 mo</th><th>Distribution</th></tr></thead>
              <tbody>{p.benches.map((b) => (
                <tr key={b.name} style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <td style={{ textAlign: 'left', padding: '5px 6px', fontWeight: 800 }}>{b.name}</td>
                  {[b.vs20, b.vs50, b.vs200].map((v, i) => <td key={i} style={{ color: (v ?? 0) >= 0 ? T.up : T.down }}>{fmtP(v)}</td>)}
                  <td style={{ color: b.slope50 === 'rising' ? T.up : b.slope50 === 'falling' ? T.down : T.dim }}>{b.slope50 ?? '—'}</td>
                  <td style={{ color: b.slope200 === 'rising' ? T.up : b.slope200 === 'falling' ? T.down : T.dim }}>{b.slope200 ?? '—'}</td>
                  <td style={{ color: b.dd >= 10 ? T.down : b.dd >= 5 ? T.warn : T.dim }}>−{b.dd.toFixed(1)}%</td>
                  <td>{b.vol20 ?? '—'}% ({b.volMedian ?? '—'}%)</td>
                  <td>{fmtP(b.ret.w1)}</td><td>{fmtP(b.ret.m1)}</td><td>{fmtP(b.ret.m3)}</td>
                  <td>{b.dist.volumeOk ? `${b.dist.count} · ${b.dist.trend}` : 'n/a'}</td>
                </tr>))}</tbody>
            </table>
            {p.benchMissing.length ? <div style={{ fontSize: 11, color: T.warn }}>Not available: {p.benchMissing.join('; ')}</div> : null}
          </div>

          <H2 n={4} hint={p.breadth ? `${p.breadth.n} liquid ${sel === 'us' ? 'US' : 'Indian'} stocks from the stock screener (the Technicals data), as of ${p.snapshotAt?.slice(0, 10) ?? '—'}.` : undefined}>Breadth</H2>
          {p.breadth ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <Stat label="Above 20-day" value={`${fmtN(p.breadth.a20)}%`} c={(p.breadth.a20 ?? 0) >= 50 ? T.up : T.down} sub={<Spark vals={p.breadthHistory.map((h) => h.a20)} color={T.info} />} />
              <Stat label="Above 50-day" value={`${fmtN(p.breadth.a50)}%`} c={(p.breadth.a50 ?? 0) >= 50 ? T.up : T.down} sub={<>{p.breadth.a50Prev != null ? `yesterday ${p.breadth.a50Prev}%` : ''}<Spark vals={p.breadthHistory.map((h) => h.a50)} color={T.info} /></>} />
              <Stat label="Above 200-day" value={`${fmtN(p.breadth.a200)}%`} c={(p.breadth.a200 ?? 0) >= 50 ? T.up : T.down} sub={<Spark vals={p.breadthHistory.map((h) => h.a200)} color={T.info} />} />
              <Stat label="52-wk highs / lows" value={<span><span style={{ color: T.up }}>{p.breadth.nh}</span> / <span style={{ color: T.down }}>{p.breadth.nlKnown ? p.breadth.nl : 'n/a'}</span></span>} sub="within 1% of the high / low" />
              <Stat label="Advancing / declining" value={<span><span style={{ color: T.up }}>{p.breadth.adv}</span> / <span style={{ color: T.down }}>{p.breadth.dec}</span></span>} sub="last session" />
              <Stat label="Weekly stage 2 / 4" value={<span><span style={{ color: T.up }}>{fmtN(p.breadth.stage2)}%</span> / <span style={{ color: T.down }}>{fmtN(p.breadth.stage4)}%</span></span>} sub={`advancing / declining stage, ${p.breadth.nStage} read`} />
            </div>
          ) : <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>Screener snapshot not available — breadth unknown.</div>}

          </>)}
          {tab === 'leaders' && (<>
          {held.size ? (() => {
            const byT = new Map(p.leaders.map((l) => [l.t, l]));
            const emer = new Set(p.emerging.map((e) => e.t));
            const mine = [...held].map((t) => ({ t, l: byT.get(t), e: emer.has(t), th: (perf.d?.themes || []).filter((x) => x.members.some((mm) => mm.t === t)).map((x) => `${x.emoji} ${x.name}`) })).filter((x) => x.l || x.e || x.th.length);
            const lead = mine.filter((x) => x.l), bad = lead.filter((x) => x.l!.state === 'BROKEN' || x.l!.state === 'UNDER_PRESSURE');
            return (<>
              <H2 n={5} hint="Your holdings in this market (portfolio in this browser + US book) — where each one sits in today's leadership.">Your holdings vs leadership</H2>
              <div style={{ ...card, padding: '8px 10px' }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}><b>{held.size}</b> held · <b style={{ color: T.up }}>{lead.length}</b> on the leader list{bad.length ? <> · <b style={{ color: T.down }}>{bad.length} of them under pressure or broken</b></> : null} · <b>{mine.filter((x) => x.e).length}</b> on the emerging list</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
                  {mine.sort((a, b) => (a.l ? 0 : a.e ? 1 : 2) - (b.l ? 0 : b.e ? 1 : 2)).slice(0, 40).map((x) => (
                    <div key={x.t} style={{ fontSize: 12.5, borderTop: `1px solid ${T.border}`, padding: '4px 0' }}>
                      <b>{x.t}</b>{' '}
                      {x.l ? <span style={{ color: LEADER_TONE[x.l.state], fontWeight: 800 }} title={x.l.why}>leader · {LEADER_LABEL[x.l.state]}</span> : x.e ? <span style={{ color: T.up, fontWeight: 800 }}>emerging leader</span> : <span style={{ color: T.faint }}>not a leader</span>}
                      {x.th.length ? <span style={{ color: T.dim }}> · {x.th.slice(0, 2).join(', ')}</span> : null}
                    </div>))}
                </div>
                {held.size > mine.length ? <div style={{ fontSize: 11.5, color: T.faint, marginTop: 4 }}>{held.size - mine.length} other holdings are not on the leader / emerging lists and not in a tracked theme.</div> : null}
              </div>
            </>);
          })() : null}
          <H2 n={5} hint={p.leaderRule}>Leader health</H2>
          {p.health ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) minmax(0, 2fr)', gap: 10 }} className="mlr-two">
              <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                <div style={{ ...card, textAlign: 'center', padding: '12px' }}>
                  <div style={{ fontSize: 34, fontWeight: 900, color: T.down, lineHeight: 1.1 }}>{p.health.n - p.health.above200} of {p.health.n}</div>
                  <div style={{ fontSize: 12.5, color: T.dim }}>leaders below their 200-day line</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: T.up, marginTop: 6 }}>{p.health.above200} above</div>
                  <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: '10px 0 4px' }}>
                    {(['HEALTHY', 'RECOVERING', 'UNDER_PRESSURE', 'BROKEN'] as Leader['state'][]).map((s) => { const k = p.leaders.filter((l) => l.state === s).length; return k ? <div key={s} title={`${LEADER_LABEL[s]}: ${k}`} style={{ width: `${(k / p.health!.n) * 100}%`, background: LEADER_TONE[s] }} /> : null; })}
                  </div>
                  <div style={{ fontSize: 11, color: T.dim, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{(['HEALTHY', 'RECOVERING', 'UNDER_PRESSURE', 'BROKEN'] as Leader['state'][]).map((s) => <span key={s}><Dot c={LEADER_TONE[s]} />{LEADER_LABEL[s]} {p.leaders.filter((l) => l.state === s).length}</span>)}</div>
                  <div style={{ fontSize: 11.5, color: T.dim, marginTop: 6 }}>{p.health.newHighs} at new highs{p.health.newLows != null ? ` · ${p.health.newLows} at new lows` : ''} · {p.health.rsUp} beat the market last month, {p.health.rsDown} lagged · leadership <b>{p.health.concentration}</b></div>
                </div>
                <div style={{ ...card, borderColor: tint(T.up, 45), padding: '10px 12px' }}>
                  <div style={{ fontWeight: 900, color: T.up }}>Still holding ({p.holding.length})</div>
                  {p.holding.length ? p.holding.slice(0, 10).map((l) => <div key={l.t} style={{ fontSize: 12.5 }} title={l.why}>✓ <b>{l.t}</b> <span style={{ color: T.faint }}>{l.n.slice(0, 26)} · {l.dd != null ? `${l.dd}% off high` : ''}</span></div>) : <div style={{ fontSize: 12, color: T.faint }}>None — no leader is above both lines and near its high.</div>}
                  {p.nearMiss.length ? <div style={{ fontSize: 11.5, color: T.faint, marginTop: 4 }}>Just under the 200-day: {p.nearMiss.slice(0, 5).map((l) => `${l.t} ${fmtP(l.vs200)}`).join(', ')}</div> : null}
                  <div style={{ fontSize: 11, color: T.dim, marginTop: 6, fontStyle: 'italic' }}>{p.holding.length && p.health.healthyPct != null && p.health.healthyPct < 35 ? 'Few holding out of many — that is the clue, not the signal.' : ''}</div>
                </div>
              </div>
              <div style={{ ...card, padding: '8px 10px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ color: T.faint, fontSize: 10.5, textAlign: 'right' }}><th style={{ textAlign: 'left', padding: '3px 4px' }}>Leader</th><th style={{ textAlign: 'left' }}>State</th><th title="Price a year ago → 52-week high">Run-up</th><th>Off high</th><th>vs 50-day</th><th>vs 200-day</th><th>RS</th><th title="Last month vs the benchmark, points">vs mkt 1m</th></tr></thead>
                  <tbody>{leadersShown.map((l) => (
                    <tr key={l.t} style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <td style={{ textAlign: 'left', padding: '4px', whiteSpace: 'nowrap' }}><Link href={`/charts?ticker=${encodeURIComponent(l.t)}&market=${MK[sel].code}`} style={{ color: T.text, fontWeight: 800, textDecoration: 'none' }}>{l.t}</Link><HeldDot on={held.has(l.t)} />{l.listedMonths ? <span title="Listed less than a year ago — the run-up starts at the listing price" style={{ fontSize: 10.5, color: T.warn, marginLeft: 4 }}>listed {l.listedMonths}m ago</span> : null} <span style={{ color: T.dim }}>{l.n}</span>{l.ind ? <div style={{ fontSize: 10.5, color: T.faint }}>{l.ind}</div> : null}</td>
                      <td style={{ textAlign: 'left' }} title={l.why}><span style={{ color: LEADER_TONE[l.state], fontWeight: 800 }}>{LEADER_LABEL[l.state]}</span></td>
                      <td>+{l.runUp}%</td><td>{l.dd != null ? `−${l.dd}%` : '—'}</td>
                      <td style={{ color: (l.vs50 ?? 0) >= 0 ? T.up : T.down }}>{fmtP(l.vs50)}</td>
                      <td style={{ color: (l.vs200 ?? 0) >= 0 ? T.up : T.down }}>{fmtP(l.vs200)}</td>
                      <td>{l.rs ?? '—'}</td><td style={{ color: (l.relM1 ?? 0) >= 0 ? T.up : T.down }}>{pts(l.relM1)}</td>
                    </tr>))}</tbody>
                </table>
                {p.leaders.length > 12 ? <Btn onClick={() => setShowAllLeaders((s) => !s)}>{showAllLeaders ? 'Show 12' : `Show all ${p.leaders.length}`}</Btn> : null}
              </div>
            </div>
          ) : <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>Leader universe unavailable (no screener snapshot).</div>}
          </>)}
        </>
      )}

      {tab === 'themes' && (<>
      {side.payload ? <div style={{ marginTop: 10 }}><CyclePanel region={sel} payload={side.payload} views={side.views} nameOf={side.nameOf} onPick={(id) => setOpenTheme(id)} benchName={side.benchName} /></div> : null}
      <H2 n={6} hint={side.ref ? `${side.benchName}: high ${fmtDay(side.ref.peak)} → low ${fmtDay(side.ref.trough)} → today. Same window for every theme.` : undefined}>Leadership survival map (themes)</H2>
      <SurvivalMap side={side} region={sel} />

      <H2 n={7} hint="From Theme Rotation's own evidence layers. Falling less ≠ stabilising ≠ improving RS ≠ improving breadth ≠ earnings — each is its own column.">Theme damage &amp; resilience</H2>
      {side.payloadOk ? (
        <div style={{ ...card, padding: '6px 8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: T.faint, fontSize: 10.5, textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '4px' }}>Theme</th><th style={{ textAlign: 'left' }}>Through the fall</th><th style={{ textAlign: 'left' }}>Cycle stage</th>
              <th title="Theme return over the benchmark's peak → trough">In the fall</th><th title="vs market, points">vs mkt</th><th>Since high</th><th>vs mkt 4w / 12w / 26w</th><th title="Share of members above their 50 / 200-day line">Breadth 50 / 200</th><th style={{ textAlign: 'left' }}>RS · BRD · ERN · CAT</th><th style={{ textAlign: 'left' }}>Verdict</th>
            </tr></thead>
            <tbody>{[...themeRows].sort((a, b) => SURV_ORDER.indexOf(a.s) - SURV_ORDER.indexOf(b.s) || (b.v.row.cycle?.relSincePeak ?? -99) - (a.v.row.cycle?.relSincePeak ?? -99)).map(({ v, r, s }) => {
              const t = v.row, bs = t.breadthStats; const open = openTheme === t.id;
              const g = (d: CycleRead['dims'][keyof CycleRead['dims']]) => ({ up: ['▲', T.up], partial: ['◐', T.info], down: ['▼', T.down], flat: ['●', T.flat], unknown: ['○', T.absent] } as const)[d];
              return (
                <React.Fragment key={t.id}>
                  <tr onClick={() => setOpenTheme(open ? null : t.id)} style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', cursor: 'pointer', background: open ? tint(T.accent, 5) : undefined }}>
                    <td style={{ textAlign: 'left', padding: '4px', whiteSpace: 'nowrap', fontWeight: 800 }}>{t.emoji} {t.name}</td>
                    <td style={{ textAlign: 'left' }}><span style={{ color: SURV_TONE[s], fontWeight: 800 }}>{SURVIVAL_LABEL[s]}</span></td>
                    <td style={{ textAlign: 'left' }} title={STATE_HELP[r.state]}>{STATE_LABEL[r.state]}</td>
                    <td>{pct(t.cycle?.fall)}</td><td style={{ color: (t.cycle?.relFall ?? 0) >= 0 ? T.up : T.down }}>{pts(t.cycle?.relFall)}</td><td>{pct(t.cycle?.sincePeak)}</td>
                    <td>{pts(r.rel4w)} / {pts(r.rel12w)} / {pts(r.rel26w)}</td>
                    <td>{bs && bs.n ? `${Math.round((bs.above50 / bs.n) * 100)}%` : '—'} / {bs && bs.n200 ? `${Math.round(((bs.above200 ?? 0) / bs.n200) * 100)}%` : '—'}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{(['market', 'breadth', 'earnings', 'catalysts'] as const).map((k) => { const [gl, c] = g(r.dims[k]); return <span key={k} style={{ color: c, marginRight: 6, fontWeight: 900 }}>{gl}</span>; })}</td>
                    <td style={{ textAlign: 'left', color: T.dim }}>{t.verdict || '—'}</td>
                  </tr>
                  {open ? <tr><td colSpan={10} style={{ padding: '6px 10px', background: tint(T.accent, 4), fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                      <div><b style={{ color: T.up }}>For</b>{r.forEvidence.map((e) => <div key={e}>• {e}</div>)}</div>
                      <div><b style={{ color: T.down }}>Against / missing</b>{r.againstEvidence.map((e) => <div key={e}>• {e}</div>)}</div>
                      <div><b>Next confirmation</b><div>{r.milestone}</div><b>Invalidation</b><div>{r.invalidation}</div>
                        <Link href={`/multibagger?tab=theme-rotation&region=${sel}`} style={{ color: T.accent, fontSize: 11.5 }}>Full evidence in Theme Rotation →</Link></div>
                      <div><b>Best companies</b><BestCompanies th={perfTheme.get(t.id)} m={sel} max={5} /></div>
                    </div>
                  </td></tr> : null}
                </React.Fragment>
              );
            })}</tbody>
          </table>
          <div style={{ fontSize: 10.5, color: T.faint, padding: 4 }}>▲ improving (against an earlier period, enough names) · ◐ partly · ● steady · ▼ weakening · ○ no data. RS counts relative strength and price structure as ONE vote.</div>
        </div>
      ) : <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>{side.error || 'Theme Rotation is loading (the first build of the day can take a minute)…'}</div>}

      <H2 n={8} hint="Potential emerging leaders based on improving evidence — not buy signals. Not picked for the deepest fall or the highest current strength.">Next leadership radar</H2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', gap: 10 }}>
        <div style={{ ...card, padding: '8px 10px' }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>Themes</div>
          {radar.length ? radar.slice(0, 10).map(({ v, r }) => (
            <div key={v.row.id} style={{ borderTop: `1px solid ${T.border}`, padding: '6px 0', fontSize: 12, lineHeight: 1.45 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b>{v.row.emoji} {v.row.name}</b>
                <Pill c={r.state === 'FAILED_TRANSITION' ? T.alarm : r.state === 'STABILISING' ? T.info : T.up}>{r.state === 'STABILISING' ? 'Early watch · stabilising' : STATE_LABEL[r.state]}</Pill>
                <span style={{ color: r.confidence === 'High' ? T.up : r.confidence === 'Low' ? T.warn : T.dim, fontWeight: 800, fontSize: 11 }}>{r.confidence} confidence</span>
                <span style={{ color: T.faint, fontSize: 11 }}>{r.improving} independent measure{r.improving === 1 ? '' : 's'} improving{r.dims.breadth === 'unknown' || r.dims.earnings === 'unknown' ? ' · some data missing' : ''}</span>
              </div>
              <div style={{ color: T.dim }}>What changed: {r.forEvidence.slice(0, 2).join('; ') || '—'}</div>
              <div style={{ color: T.dim }}><span style={{ color: T.down }}>Risk:</span> {r.againstEvidence.slice(0, 2).join('; ') || '—'}</div>
              <div style={{ color: T.dim }}><b>Confirms if:</b> {r.milestone} <b>Invalidated if:</b> {r.invalidation}</div>
              {r.state !== 'FAILED_TRANSITION' ? <div style={{ marginTop: 5, padding: '6px 8px', borderRadius: 6, background: tint(T.up, 5), border: `1px solid ${tint(T.up, 22)}` }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: T.faint, marginBottom: 2 }}>BEST COMPANIES IN THIS THEME (Stage 2 · RS · current growth · near the high)</div>
                <BestCompanies th={perfTheme.get(v.row.id)} m={sel} max={4} />
              </div> : null}
            </div>
          )) : <div style={{ fontSize: 12, color: T.faint }}>{side.payloadOk ? 'No theme is improving on enough independent measures. Nothing is forced onto the list.' : 'Loading…'}</div>}
        </div>
        <div style={{ ...card, padding: '8px 10px' }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>Stocks <span style={{ fontWeight: 600, color: T.faint, fontSize: 11 }}>— not on the leader list; RS ≥ 85, within 12% of the high, 50-day above 200-day, beating the market this month, weekly stage 2</span></div>
          {p?.emerging.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: T.faint, fontSize: 10.5, textAlign: 'right' }}><th style={{ textAlign: 'left' }}>Stock</th><th>RS</th><th>Off high</th><th>vs 50-day</th><th>vs mkt 1m</th></tr></thead>
              <tbody>{p.emerging.map((e) => (
                <tr key={e.t} title={e.why} style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <td style={{ textAlign: 'left', padding: '3px 0', whiteSpace: 'nowrap' }}><Link href={`/charts?ticker=${encodeURIComponent(e.t)}&market=${MK[sel].code}`} style={{ color: T.text, fontWeight: 800, textDecoration: 'none' }}>{e.t}</Link> <span style={{ color: T.faint }}>{(e.ind || e.n).slice(0, 24)}</span></td>
                  <td>{e.rs}</td><td>−{e.dd}%</td><td>{fmtP(e.vs50)}</td><td style={{ color: T.up }}>{pts(e.relM1)}</td>
                </tr>))}</tbody>
            </table>
          ) : <div style={{ fontSize: 12, color: T.faint }}>{p ? 'No stock passes all five checks right now.' : 'Loading…'}</div>}
        </div>
      </div>

      <H2 n={9} hint="Related themes only (same group or moving together). Relative-strength divergence — not evidence that money moved.">Potential leadership transitions</H2>
      {trans.length ? (
        <div style={{ ...card, padding: '6px 8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: T.faint, fontSize: 10.5, textAlign: 'left' }}><th style={{ padding: 4 }}>Losing relative strength</th><th>Gaining</th><th style={{ textAlign: 'right' }}>RS gap 4w</th><th style={{ textAlign: 'right' }}>Breadth (above 50-day)</th><th>Earnings</th><th>Link</th><th>Against</th><th>Confidence</th></tr></thead>
            <tbody>{trans.map((t) => (
              <tr key={`${t.from}-${t.to}`} style={{ borderTop: `1px solid ${T.border}` }} title={`Invalidates if: ${t.invalidation}`}>
                <td style={{ padding: 4, color: T.down, fontWeight: 800 }}>{side.nameOf(t.from)} <span style={{ color: T.faint }}>{pts(t.fromRel4w)}</span></td>
                <td style={{ color: T.up, fontWeight: 800 }}>{side.nameOf(t.to)} <span style={{ color: T.faint }}>{pts(t.toRel4w)}</span></td>
                <td style={{ textAlign: 'right' }}>{pts(t.rsGap4w)}</td>
                <td style={{ textAlign: 'right' }}>{t.breadthFrom ?? '—'}% → {t.breadthTo ?? '—'}%</td>
                <td>{t.earningsFrom} → {t.earningsTo}</td><td>{t.basis}</td>
                <td style={{ color: T.warn }}>{t.against.join('; ') || '—'}</td><td>{t.confidence}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>No related pair shows a relative-strength hand-over of 4+ points over 4 weeks.</div>}

      </>)}
      {tab === 'performance' && <PerformanceTab m={sel} d={perf.d} err={perf.err} />}
      {tab === 'overview' && p ? (
        <>
          <H2 n={10} hint="A reading of market conditions — not an allocation or a cash percentage.">Risk posture &amp; discipline</H2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 10 }}>
            <div style={{ ...card, padding: '10px 12px', borderColor: tint(POSTURE_TONE[p.posture.posture], 45) }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Pill c={POSTURE_TONE[p.posture.posture]} big>{p.posture.label}</Pill><span style={{ fontSize: 12, color: T.dim }}>Risk level: <b>{p.posture.level}</b></span></div>
              <div style={{ fontSize: 12, color: T.dim, margin: '6px 0', lineHeight: 1.5 }}>{p.posture.evidence.map((e) => <div key={e}>• {e}</div>)}</div>
              {([['Avoid', p.posture.avoid, T.down], ['Watch', p.posture.watch, T.info], ['Would improve the posture', p.posture.improve, T.up], ['Would worsen it', p.posture.worsen, T.warn]] as Array<[string, string[], string]>).map(([lab, list, c]) => list.length && list[0] !== '—' ? (
                <div key={lab} style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}><b style={{ color: c }}>{lab}</b>{list.map((x) => <div key={x}>• {x}</div>)}</div>
              ) : null)}
            </div>
            <div style={{ ...card, padding: '10px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>Recovery confirmation</b><Pill c={/Confirmed|Not in/.test(p.recovery.stage) ? T.up : /deteriorating/.test(p.recovery.stage) ? T.down : T.info}>{p.recovery.stage}</Pill></div>
              <div style={{ fontSize: 11.5, color: T.faint, margin: '2px 0 6px' }}>Several independent checks — no single day or moving-average cross decides.</div>
              {p.recovery.checks.map((c) => (
                <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 6, fontSize: 12.5, padding: '3px 0', borderTop: `1px solid ${T.border}` }}>
                  <span style={{ color: c.state === 'met' ? T.up : c.state === 'not-met' ? T.down : T.absent, fontWeight: 900 }}>{c.state === 'met' ? '✓' : c.state === 'not-met' ? '✗' : '?'}</span>
                  <span>{c.label}</span><span style={{ color: T.faint, fontSize: 11.5 }}>{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {tab === 'cycles' && <CyclesTab m={sel} d={perf.d} err={perf.err} history={<>
      <H2 n={11} hint="Past 15%+ falls of the same benchmark, every figure over each fall's own dates. Later returns are shown only for completed falls.">Historical comparison</H2>
      {eps.length ? (
        <div style={{ ...card, padding: '6px 8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: T.faint, fontSize: 10.5, textAlign: 'right' }}><th style={{ textAlign: 'left', padding: 4 }}>Fall</th><th>Depth</th><th>High → low</th><th style={{ textAlign: 'left' }}>Hit hardest</th><th style={{ textAlign: 'left' }}>Held up best</th><th style={{ textAlign: 'left' }}>Last boom's leaders</th><th>Market next 12m</th><th style={{ textAlign: 'left' }}>Led the next 12m</th></tr></thead>
            <tbody>
              {p?.bench && p.bench.dd >= 5 && !eps.some((e) => e.ongoing) ? (
                <tr style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', background: tint(T.accent, 6) }}>
                  <td style={{ textAlign: 'left', padding: 4, fontWeight: 900 }}>Now (open)</td><td>−{p.bench.dd.toFixed(1)}%</td><td>{days(p.bench.highDay, p.bench.last)}d so far</td>
                  <td colSpan={5} style={{ textAlign: 'left', color: T.faint }}>Below the 15% history threshold — see the survival map above for this fall.</td>
                </tr>
              ) : null}
              {[...eps].reverse().map((e) => (
                <tr key={e.peak} style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', background: e.ongoing ? tint(T.accent, 6) : undefined }}>
                  <td style={{ textAlign: 'left', padding: 4, fontWeight: 800 }}>{e.name.split(' · ')[0]}{e.ongoing ? ' (open)' : ''} <span style={{ color: T.faint, fontWeight: 400 }}>{fmtMon(e.peak)}</span></td>
                  <td style={{ color: T.down }}>{pct(e.bench.fall)}</td><td>{days(e.peak, e.trough)}d</td>
                  <td style={{ textAlign: 'left' }}>{e.worst ? `${e.worst.name} ${pct(e.worst.fall)}` : '—'}</td>
                  <td style={{ textAlign: 'left' }}>{e.least ? `${e.least.name} ${pct(e.least.fall)}` : '—'}</td>
                  <td style={{ textAlign: 'left' }}>{e.leaders.join(', ') || '—'}{e.leadersFall != null ? ` (${pct(e.leadersFall)})` : ''}</td>
                  <td>{e.ongoing ? 'not yet' : pct(e.bench.next12)}</td>
                  <td style={{ textAlign: 'left' }}>{e.ongoing ? '—' : e.nextTop.map((n) => `${n.name}${n.fallRank ? ` (#${n.fallRank} in fall)` : ''}`).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: T.faint, padding: 4 }}>"#N in fall" = how that sector ranked by fall (1 = fell least). Next-12-month figures are after each low — shown only once the year has passed, never for the open fall. Breadth and leader counts are not on file for past falls, so they are not compared.</div>
        </div>
      ) : <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>Building the long history (first build can take a few minutes)…</div>}

      </>} />}
      {tab === 'compare' && (<>
      <H2 n={12} hint="Only themes with a real counterpart in both markets. US strength does not imply Indian strength.">USA vs India — leadership comparison</H2>
      <div style={{ ...card, padding: '6px 8px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ color: T.faint, fontSize: 10.5, textAlign: 'right' }}><th style={{ textAlign: 'left', padding: 4 }}>Comparable theme</th><th style={{ textAlign: 'left' }}>🇺🇸 stage</th><th>🇺🇸 vs mkt 12w</th><th>🇺🇸 breadth</th><th style={{ textAlign: 'left' }}>🇮🇳 stage</th><th>🇮🇳 vs mkt 12w</th><th>🇮🇳 breadth</th><th style={{ textAlign: 'left' }}>Reading</th></tr></thead>
          <tbody>{cross.map(({ pr, a, b, ra, rb, verdict }) => {
            const br = (v?: ThemeView) => (v?.row.breadthStats?.n ? `${Math.round((v.row.breadthStats.above50 / v.row.breadthStats.n) * 100)}%` : '—');
            const vc = verdict === 'Both improving' ? T.up : verdict === 'Both deteriorating' ? T.down : verdict === 'Divergence' ? T.warn : verdict === 'No comparable data' ? T.absent : T.info;
            return (
              <tr key={pr.label} style={{ borderTop: `1px solid ${T.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <td style={{ textAlign: 'left', padding: 4, fontWeight: 800 }}>{pr.label} <span style={{ color: T.faint, fontWeight: 400 }}>{a?.row.name ?? '—'} · {b?.row.name ?? '—'}</span></td>
                <td style={{ textAlign: 'left' }}>{ra ? STATE_LABEL[ra.state] : '—'}</td><td style={{ color: (ra?.rel12w ?? 0) >= 0 ? T.up : T.down }}>{pts(ra?.rel12w)}</td><td>{br(a)}</td>
                <td style={{ textAlign: 'left' }}>{rb ? STATE_LABEL[rb.state] : '—'}</td><td style={{ color: (rb?.rel12w ?? 0) >= 0 ? T.up : T.down }}>{pts(rb?.rel12w)}</td><td>{br(b)}</td>
                <td style={{ textAlign: 'left', color: vc, fontWeight: 800 }}>{verdict}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <div style={{ fontSize: 10.5, color: T.faint, padding: 4 }}>Each side is measured against its own market (S&amp;P 500 / Nifty 50). "USA leading" = US theme 5+ points stronger vs its market over 12 weeks than the Indian one vs its market. No financial link between the two is assumed.</div>
      </div>

      </>)}
      <div style={{ fontSize: 11, color: T.faint, marginTop: 18, lineHeight: 1.6 }}>
        <b>Method.</b> Regime: trend (benchmark vs 50 / 200-day lines and their slopes), drawdown from the 52-week high, distribution days, breadth (share of liquid stocks above their 50 / 200-day lines), leader health, volatility and the rally attempt are each shown; the label needs several of them to agree and says which data is missing. Leaders are picked by their run-up into the 52-week high, so leaders that have since broken stay in the count. Breadth and leaders come from the stock screener snapshot (the same data as the Technicals and Stock Screener pages); themes from Theme Rotation; past falls from Theme Cycle. Educational decision support — not investment advice.
      </div>
      <style>{`@media (max-width: 900px) { .mlr-two { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
