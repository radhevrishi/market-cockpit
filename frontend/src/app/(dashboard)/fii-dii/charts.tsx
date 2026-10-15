// zzz1055 — FII / DII page: three small SVG charts (no chart library): cumulative FII flow, daily FII vs DII bars,
// 20-day rolling net. Hover shows the day's figures.
'use client';

import { useMemo, useState } from 'react';
import { fmtAxisCr, fmtCr, fmtDate, GREEN, RED } from './format';

export interface HistPoint { date: string; fii: number | null; dii: number | null; fiiCum: number; fii20: number | null; dii20: number | null; source: 'nse' | 'nsdl'; provisional: boolean }

const W = 900, H = 220, PL = 52, PR = 12, PT = 12, PB = 24;
const FII_C = '#1d4ed8', DII_C = '#d97706', GRID = '#e2e8f0', SOFT = '#64748b';

function scaleY(min: number, max: number) {
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.06;
  const lo = min - pad, hi = max + pad;
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
  // 4 round ticks
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return { y, ticks };
}
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

function Frame({ ticks, y, pts, children, onHover, hoverIdx, tip }: {
  ticks: number[]; y: (v: number) => number; pts: HistPoint[]; children: React.ReactNode;
  onHover: (i: number | null) => void; hoverIdx: number | null; tip: (p: HistPoint) => React.ReactNode;
}) {
  const n = pts.length;
  const x = (i: number) => PL + ((W - PL - PR) * (n <= 1 ? 0.5 : i / (n - 1)));
  const labelIdx = n <= 1 ? [0] : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }} role="img"
        onMouseLeave={() => onHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const sx = ((e.clientX - r.left) / r.width) * W;
          if (n < 1) return;
          const i = Math.round(((sx - PL) / (W - PL - PR)) * (n - 1));
          onHover(Math.max(0, Math.min(n - 1, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#94a3b8' : GRID} strokeWidth={1} />
            <text x={PL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={SOFT}>{fmtAxisCr(t)}</text>
          </g>
        ))}
        {[...new Set(labelIdx)].map((i) => pts[i] ? (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill={SOFT}>{fmtDate(pts[i].date, true)} {pts[i].date.slice(2, 4)}</text>
        ) : null)}
        {children}
        {hoverIdx != null && pts[hoverIdx] ? <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PT} y2={H - PB} stroke="#0f172a" strokeOpacity={0.25} /> : null}
      </svg>
      {hoverIdx != null && pts[hoverIdx] ? (
        <div style={{ position: 'absolute', top: 4, left: `${Math.min(70, Math.max(8, (x(hoverIdx) / W) * 100))}%`, background: '#fff', border: `1px solid ${GRID}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, pointerEvents: 'none', boxShadow: '0 2px 6px rgba(15,23,42,0.08)', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{fmtDate(pts[hoverIdx].date)}{pts[hoverIdx].source === 'nsdl' ? ' · NSDL' : pts[hoverIdx].provisional ? ' · provisional' : ''}</div>
          {tip(pts[hoverIdx])}
        </div>
      ) : null}
    </div>
  );
}

const xOf = (n: number) => (i: number) => PL + ((W - PL - PR) * (n <= 1 ? 0.5 : i / (n - 1)));

export function CumulativeChart({ pts }: { pts: HistPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { y, ticks, path, area } = useMemo(() => {
    const vals = pts.map((p) => p.fiiCum);
    const s = scaleY(Math.min(0, ...vals), Math.max(0, ...vals));
    const x = xOf(pts.length);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${s.y(p.fiiCum).toFixed(1)}`).join(' ');
    const ar = pts.length ? `${line} L${x(pts.length - 1).toFixed(1)},${s.y(0).toFixed(1)} L${x(0).toFixed(1)},${s.y(0).toFixed(1)} Z` : '';
    return { ...s, path: line, area: ar };
  }, [pts]);
  const last = pts[pts.length - 1]?.fiiCum ?? 0;
  const c = last >= 0 ? GREEN : RED;
  return (
    <Frame ticks={ticks} y={y} pts={pts} onHover={setHover} hoverIdx={hover}
      tip={(p) => <><div>Running total: <b style={{ color: p.fiiCum >= 0 ? GREEN : RED }}>{fmtCr(p.fiiCum, { signed: true })}</b></div><div>That day: {fmtCr(p.fii, { signed: true })}</div></>}>
      <path d={area} fill={c} fillOpacity={0.08} />
      <path d={path} fill="none" stroke={c} strokeWidth={2} />
    </Frame>
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
      tip={(p) => <><div><span style={{ color: FII_C }}>■</span> FII: <b style={{ color: (p.fii ?? 0) >= 0 ? GREEN : RED }}>{fmtCr(p.fii, { signed: true })}</b></div><div><span style={{ color: DII_C }}>■</span> DII: <b style={{ color: (p.dii ?? 0) >= 0 ? GREEN : RED }}>{fmtCr(p.dii, { signed: true })}</b></div></>}>
      {pts.map((p, i) => {
        const z = y(0);
        const out: React.ReactNode[] = [];
        if (p.fii != null) { const t = y(p.fii); out.push(<rect key="f" x={x(i) - bw} y={Math.min(t, z)} width={bw} height={Math.max(0.5, Math.abs(z - t))} fill={FII_C} fillOpacity={0.85} />); }
        if (p.dii != null) { const t = y(p.dii); out.push(<rect key="d" x={x(i)} y={Math.min(t, z)} width={bw} height={Math.max(0.5, Math.abs(z - t))} fill={DII_C} fillOpacity={0.85} />); }
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
      tip={(p) => <><div><span style={{ color: FII_C }}>━</span> FII 20 days: <b>{fmtCr(p.fii20, { signed: true })}</b></div><div><span style={{ color: DII_C }}>━</span> DII 20 days: <b>{fmtCr(p.dii20, { signed: true })}</b></div></>}>
      <path d={fPath} fill="none" stroke={FII_C} strokeWidth={2} />
      <path d={dPath} fill="none" stroke={DII_C} strokeWidth={2} />
    </Frame>
  );
}

export const LEGEND_FII = FII_C;
export const LEGEND_DII = DII_C;
