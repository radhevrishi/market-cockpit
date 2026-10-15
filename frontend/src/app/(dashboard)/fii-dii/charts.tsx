// zzz1055 / zzz1060 — FII / DII page: own SVG charts (no chart library). Every chart has one y-axis; hover shows the exact
// figures. Cumulative FII flow (green fill above zero, red below) with an optional Nifty 50 panel under it on the same time
// axis, daily FII vs DII bars, 20-day rolling net, monthly totals, FII futures long % with its bands, sparklines.
'use client';

import { useId, useMemo, useState } from 'react';
import { fmtAxisCr, fmtCr, fmtDate, GREEN, RED } from './format';

export interface HistPoint { date: string; fii: number | null; dii: number | null; fiiCum: number; fii20: number | null; dii20: number | null; nifty?: number | null; source: 'nse' | 'nsdl'; provisional: boolean }

const W = 900, H = 220, PL = 56, PR = 12, PT = 12, PB = 24;
const FII_C = '#1d4ed8', DII_C = '#d97706', GRID = '#e2e8f0', SOFT = '#64748b', ZERO = '#94a3b8';
const GREEN_FILL = '#10b981', RED_FILL = '#ef4444';

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
function scaleY(min: number, max: number, h = H, pt = PT, pb = PB) {
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.06;
  const lo = min - pad, hi = max + pad;
  const y = (v: number) => pt + (h - pt - pb) * (1 - (v - lo) / (hi - lo));
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { y, ticks };
}
const xOf = (n: number) => (i: number) => PL + ((W - PL - PR) * (n <= 1 ? 0.5 : i / (n - 1)));
const tipBox: React.CSSProperties = { position: 'absolute', top: 4, background: '#fff', border: `1px solid ${GRID}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, pointerEvents: 'none', boxShadow: '0 2px 6px rgba(15,23,42,0.08)', whiteSpace: 'nowrap', zIndex: 2 };
const signColor = (v: number | null | undefined) => (v == null ? SOFT : v >= 0 ? GREEN : RED);

function hoverIndex(e: React.MouseEvent<SVGSVGElement>, n: number): number | null {
  if (n < 1) return null;
  const r = e.currentTarget.getBoundingClientRect();
  const sx = ((e.clientX - r.left) / r.width) * W;
  const i = Math.round(((sx - PL) / (W - PL - PR)) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

function Axis({ ticks, y, fmt = fmtAxisCr, zero = true }: { ticks: number[]; y: (v: number) => number; fmt?: (v: number) => string; zero?: boolean }) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={zero && t === 0 ? ZERO : GRID} strokeWidth={1} />
          <text x={PL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={SOFT}>{fmt(t)}</text>
        </g>
      ))}
    </>
  );
}
function DateLabels({ pts, h = H }: { pts: Array<{ date: string }>; h?: number }) {
  const n = pts.length, x = xOf(n);
  const idx = n <= 1 ? [0] : [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])];
  return <>{idx.map((i) => pts[i] ? <text key={i} x={x(i)} y={h - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill={SOFT}>{fmtDate(pts[i].date, true)} {pts[i].date.slice(2, 4)}</text> : null)}</>;
}

function Frame({ ticks, y, pts, children, onHover, hoverIdx, tip, fmt }: {
  ticks: number[]; y: (v: number) => number; pts: HistPoint[]; children: React.ReactNode;
  onHover: (i: number | null) => void; hoverIdx: number | null; tip: (p: HistPoint) => React.ReactNode; fmt?: (v: number) => string;
}) {
  const n = pts.length, x = xOf(n);
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img"
        onMouseLeave={() => onHover(null)} onMouseMove={(e) => onHover(hoverIndex(e, n))}>
        <Axis ticks={ticks} y={y} fmt={fmt} />
        <DateLabels pts={pts} />
        {children}
        {hoverIdx != null && pts[hoverIdx] ? <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PT} y2={H - PB} stroke="#0f172a" strokeOpacity={0.25} /> : null}
      </svg>
      {hoverIdx != null && pts[hoverIdx] ? (
        <div style={{ ...tipBox, left: `${Math.min(70, Math.max(8, (x(hoverIdx) / W) * 100))}%` }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{fmtDate(pts[hoverIdx].date)}{pts[hoverIdx].source === 'nsdl' ? ' · NSDL' : pts[hoverIdx].provisional ? ' · provisional' : ''}</div>
          {tip(pts[hoverIdx])}
        </div>
      ) : null}
    </div>
  );
}

/** Running total of FII net flow: green area above zero, red below (two clip paths on one area). When Nifty closes exist,
 *  a second panel under it shows Nifty 50 on the same dates — one hover line runs through both (two panels, one axis each). */
export function CumulativeChart({ pts, showNifty = true }: { pts: HistPoint[]; showNifty?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const hasNifty = showNifty && pts.filter((p) => p.nifty != null).length >= 2;
  const NH = 130;
  const g = useMemo(() => {
    const vals = pts.map((p) => p.fiiCum);
    const s = scaleY(Math.min(0, ...vals), Math.max(0, ...vals));
    const x = xOf(pts.length);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${s.y(p.fiiCum).toFixed(1)}`).join(' ');
    const z = s.y(0);
    const area = pts.length ? `${line} L${x(pts.length - 1).toFixed(1)},${z.toFixed(1)} L${x(0).toFixed(1)},${z.toFixed(1)} Z` : '';
    const nv = pts.map((p) => p.nifty).filter((v): v is number => v != null);
    const ns = nv.length ? scaleY(Math.min(...nv), Math.max(...nv), NH, 8, 22) : null;
    let nPath = '';
    if (ns) { let pen = false; pts.forEach((p, i) => { if (p.nifty == null) { pen = false; return; } nPath += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${ns.y(p.nifty).toFixed(1)} `; pen = true; }); }
    return { ...s, line, area, z, ns, nPath };
  }, [pts]);
  const n = pts.length, x = xOf(n);
  const id = `cum${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const hp = hover != null ? pts[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img" aria-label="FII running total"
        onMouseLeave={() => setHover(null)} onMouseMove={(e) => setHover(hoverIndex(e, n))}>
        <defs>
          <clipPath id={`${id}a`}><rect x={0} y={0} width={W} height={Math.max(0, g.z)} /></clipPath>
          <clipPath id={`${id}b`}><rect x={0} y={g.z} width={W} height={Math.max(0, H - g.z)} /></clipPath>
        </defs>
        <Axis ticks={g.ticks} y={g.y} />
        {!hasNifty ? <DateLabels pts={pts} /> : null}
        <path d={g.area} fill={GREEN_FILL} fillOpacity={0.18} clipPath={`url(#${id}a)`} />
        <path d={g.area} fill={RED_FILL} fillOpacity={0.18} clipPath={`url(#${id}b)`} />
        <path d={g.line} fill="none" stroke={GREEN} strokeWidth={2} clipPath={`url(#${id}a)`} />
        <path d={g.line} fill="none" stroke={RED} strokeWidth={2} clipPath={`url(#${id}b)`} />
        {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="#0f172a" strokeOpacity={0.25} /> : null}
      </svg>
      {hasNifty && g.ns ? (
        <>
          <div style={{ fontSize: 12, color: SOFT, margin: '6px 0 0 4px' }}>Nifty 50 (same dates)</div>
          <svg viewBox={`0 0 ${W} ${NH}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img" aria-label="Nifty 50"
            onMouseLeave={() => setHover(null)} onMouseMove={(e) => setHover(hoverIndex(e, n))}>
            {g.ns.ticks.map((t) => (
              <g key={t}>
                <line x1={PL} x2={W - PR} y1={g.ns!.y(t)} y2={g.ns!.y(t)} stroke={GRID} />
                <text x={PL - 6} y={g.ns!.y(t) + 4} textAnchor="end" fontSize={11} fill={SOFT}>{Math.round(t).toLocaleString('en-IN')}</text>
              </g>
            ))}
            <DateLabels pts={pts} h={NH} />
            <path d={g.nPath} fill="none" stroke="#334155" strokeWidth={2} />
            {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={8} y2={NH - 22} stroke="#0f172a" strokeOpacity={0.25} /> : null}
          </svg>
        </>
      ) : null}
      {hp ? (
        <div style={{ ...tipBox, left: `${Math.min(70, Math.max(8, (x(hover!) / W) * 100))}%` }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{fmtDate(hp.date)}{hp.source === 'nsdl' ? ' · NSDL' : hp.provisional ? ' · provisional' : ''}</div>
          <div>Running total: <b style={{ color: signColor(hp.fiiCum) }}>{fmtCr(hp.fiiCum, { signed: true })}</b></div>
          <div>That day: <b style={{ color: signColor(hp.fii) }}>{fmtCr(hp.fii, { signed: true })}</b></div>
          {hp.nifty != null ? <div>Nifty 50: <b>{hp.nifty.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</b></div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function DailyBars({ pts }: { pts: HistPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { y, ticks } = useMemo(() => {
    const vals = pts.flatMap((p) => [p.fii ?? 0, p.dii ?? 0]);
    return scaleY(Math.min(0, ...vals), Math.max(0, ...vals));
  }, [pts]);
  const n = pts.length, x = xOf(n);
  const slot = (W - PL - PR) / Math.max(n, 1);
  const bw = Math.max(0.8, Math.min(9, slot * 0.4));
  return (
    <Frame ticks={ticks} y={y} pts={pts} onHover={setHover} hoverIdx={hover}
      tip={(p) => <><div><span style={{ color: FII_C }}>■</span> FII: <b style={{ color: signColor(p.fii) }}>{fmtCr(p.fii, { signed: true })}</b></div><div><span style={{ color: DII_C }}>■</span> DII: <b style={{ color: signColor(p.dii) }}>{fmtCr(p.dii, { signed: true })}</b></div></>}>
      {pts.map((p, i) => {
        const z = y(0);
        const out: React.ReactNode[] = [];
        if (p.fii != null) { const t = y(p.fii); out.push(<rect key="f" x={x(i) - bw} y={Math.min(t, z)} width={bw} height={Math.max(0.5, Math.abs(z - t))} fill={FII_C} fillOpacity={hover === i ? 1 : 0.85} />); }
        if (p.dii != null) { const t = y(p.dii); out.push(<rect key="d" x={x(i)} y={Math.min(t, z)} width={bw} height={Math.max(0.5, Math.abs(z - t))} fill={DII_C} fillOpacity={hover === i ? 1 : 0.85} />); }
        return <g key={p.date}>{out}</g>;
      })}
    </Frame>
  );
}

export function RollingChart({ pts }: { pts: HistPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { y, ticks, fPath, dPath } = useMemo(() => {
    const vals = pts.flatMap((p) => [p.fii20, p.dii20].filter((v): v is number => v != null));
    const s = scaleY(Math.min(0, ...(vals.length ? vals : [0])), Math.max(0, ...(vals.length ? vals : [0])));
    const x = xOf(pts.length);
    const mk = (pick: (p: HistPoint) => number | null) => {
      let d = '', pen = false;
      pts.forEach((p, i) => { const v = pick(p); if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${s.y(v).toFixed(1)} `; pen = true; });
      return d;
    };
    return { ...s, fPath: mk((p) => p.fii20), dPath: mk((p) => p.dii20) };
  }, [pts]);
  return (
    <Frame ticks={ticks} y={y} pts={pts} onHover={setHover} hoverIdx={hover}
      tip={(p) => <><div><span style={{ color: FII_C }}>━</span> FII 20 days: <b style={{ color: signColor(p.fii20) }}>{fmtCr(p.fii20, { signed: true })}</b></div><div><span style={{ color: DII_C }}>━</span> DII 20 days: <b style={{ color: signColor(p.dii20) }}>{fmtCr(p.dii20, { signed: true })}</b></div></>}>
      <path d={fPath} fill="none" stroke={FII_C} strokeWidth={2} />
      <path d={dPath} fill="none" stroke={DII_C} strokeWidth={2} />
    </Frame>
  );
}

// ── monthly totals (FII and DII side by side, value labels) ──────────────────

export interface MonthBar { month: string; fii: number; dii: number | null; days: number; diiDays: number }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export function MonthlyBars({ months }: { months: MonthBar[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const MH = 250, MT = 22, MB = 30;
  const { y, ticks } = useMemo(() => {
    const vals = months.flatMap((m) => [m.fii, m.dii ?? 0]);
    return scaleY(Math.min(0, ...vals), Math.max(0, ...vals), MH, MT, MB);
  }, [months]);
  const n = months.length;
  const slot = (W - PL - PR) / Math.max(n, 1);
  const hasDii = months.some((m) => m.dii != null);
  const bw = Math.max(3, Math.min(22, slot * (hasDii ? 0.36 : 0.6)));
  const cx = (i: number) => PL + slot * (i + 0.5);
  const z = y(0);
  const showVals = n <= 14;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${MH}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img" aria-label="Monthly net flows"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const sx = ((e.clientX - r.left) / r.width) * W; const i = Math.floor((sx - PL) / slot); setHover(i >= 0 && i < n ? i : null); }}>
        <Axis ticks={ticks} y={y} />
        {months.map((m, i) => {
          const bars: Array<{ v: number; c: string; dx: number; k: string }> = [{ v: m.fii, c: FII_C, dx: hasDii ? -bw - 1 : -bw / 2, k: 'f' }];
          if (m.dii != null) bars.push({ v: m.dii, c: DII_C, dx: 1, k: 'd' });
          return (
            <g key={m.month}>
              {hover === i ? <rect x={cx(i) - slot / 2} y={MT} width={slot} height={MH - MT - MB} fill="#0f172a" fillOpacity={0.04} /> : null}
              {bars.map((b) => { const t = y(b.v); return <rect key={b.k} x={cx(i) + b.dx} y={Math.min(t, z)} width={bw} height={Math.max(0.5, Math.abs(z - t))} rx={2} fill={b.c} fillOpacity={0.88} />; })}
              {showVals ? bars.map((b) => <text key={`t${b.k}`} x={cx(i) + b.dx + bw / 2} y={b.v >= 0 ? y(b.v) - 4 : y(b.v) + 12} textAnchor="middle" fontSize={10} fill={signColor(b.v)}>{fmtAxisCr(b.v)}</text>) : null}
              {(n <= 14 || i % 2 === (n - 1) % 2) ? <text x={cx(i)} y={MH - 10} textAnchor="middle" fontSize={11} fill={SOFT}>{monLabel(m.month)}</text> : null}
            </g>
          );
        })}
      </svg>
      {hover != null && months[hover] ? (
        <div style={{ ...tipBox, left: `${Math.min(70, Math.max(8, (cx(hover) / W) * 100))}%` }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{monLabel(months[hover].month)} · {months[hover].days} trading day{months[hover].days === 1 ? '' : 's'}</div>
          <div><span style={{ color: FII_C }}>■</span> FII: <b style={{ color: signColor(months[hover].fii) }}>{fmtCr(months[hover].fii, { signed: true })}</b></div>
          {months[hover].dii != null ? <div><span style={{ color: DII_C }}>■</span> DII: <b style={{ color: signColor(months[hover].dii) }}>{fmtCr(months[hover].dii, { signed: true })}</b>{months[hover].diiDays < months[hover].days ? <span style={{ color: SOFT }}> ({months[hover].diiDays} days)</span> : null}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── FII index-futures long % over time, with the 30 % / 70 % bands ───────────

export function LongPctChart({ series }: { series: Array<{ date: string; longPct: number; ratio: number | null }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const LH = 200, LT = 10, LB = 24;
  const n = series.length, x = xOf(n);
  const y = (v: number) => LT + (LH - LT - LB) * (1 - v / 100);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.longPct).toFixed(1)}`).join(' ');
  const hp = hover != null ? series[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${LH}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img" aria-label="FII index futures long percent"
        onMouseLeave={() => setHover(null)} onMouseMove={(e) => setHover(hoverIndex(e, n))}>
        <rect x={PL} y={y(30)} width={W - PL - PR} height={y(0) - y(30)} fill={RED_FILL} fillOpacity={0.07} />
        <rect x={PL} y={y(100)} width={W - PL - PR} height={y(70) - y(100)} fill={GREEN_FILL} fillOpacity={0.08} />
        {[0, 30, 50, 70, 100].map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={t === 50 ? ZERO : GRID} strokeDasharray={t === 30 || t === 70 ? '4 3' : undefined} />
            <text x={PL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={SOFT}>{t}%</text>
          </g>
        ))}
        <text x={W - PR - 4} y={y(30) - 4} textAnchor="end" fontSize={10} fill={RED}>below 30% = very bearish</text>
        <text x={W - PR - 4} y={y(70) + 12} textAnchor="end" fontSize={10} fill={GREEN}>above 70% = bullish</text>
        <DateLabels pts={series} h={LH} />
        <path d={path} fill="none" stroke={FII_C} strokeWidth={2} />
        {n ? <circle cx={x(n - 1)} cy={y(series[n - 1].longPct)} r={4} fill={FII_C} stroke="#fff" strokeWidth={2} /> : null}
        {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={LT} y2={LH - LB} stroke="#0f172a" strokeOpacity={0.25} /> : null}
      </svg>
      {hp ? (
        <div style={{ ...tipBox, left: `${Math.min(70, Math.max(8, (x(hover!) / W) * 100))}%` }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{fmtDate(hp.date)}</div>
          <div>FII long: <b>{hp.longPct}%</b></div>
          {hp.ratio != null ? <div>Long ÷ short: <b>{hp.ratio.toFixed(2)}</b></div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── tiny bar sparkline (sector rows) ─────────────────────────────────────────

export function SparkBars({ vals, dates, width = 120, height = 28 }: { vals: Array<number | null>; dates?: string[]; width?: number; height?: number }) {
  const max = Math.max(1, ...vals.map((v) => Math.abs(v ?? 0)));
  const n = vals.length, bw = width / Math.max(n, 1);
  const mid = height / 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }} aria-hidden>
      <line x1={0} x2={width} y1={mid} y2={mid} stroke={GRID} />
      {vals.map((v, i) => {
        if (v == null) return null;
        const h = Math.max(1, (Math.abs(v) / max) * (mid - 1));
        return (
          <rect key={i} x={i * bw + 0.5} y={v >= 0 ? mid - h : mid} width={Math.max(1, bw - 1.5)} height={h} rx={1} fill={v >= 0 ? GREEN_FILL : RED_FILL}>
            <title>{`${dates?.[i] ? fmtDate(dates[i]) + ': ' : ''}${fmtCr(v, { signed: true })}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export const LEGEND_FII = FII_C;
export const LEGEND_DII = DII_C;
