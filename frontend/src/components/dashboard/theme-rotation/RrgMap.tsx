'use client';
// ═══════════════════════════════════════════════════════════════════════════
// ROTATION MAP (RRG) — the one chart on the page  (zzz795, from zzz-RRG)
//
// Relative strength (→) against its own momentum (↑), with an eight-week tail
// that shows the path each theme took. Themes travel clockwise. Labels are
// drawn only for what is worth naming (themes that crossed a quadrant this
// week, flagged themes, and whatever is hovered), and de-collided.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import type { ThemeRow } from '@/lib/theme-rotation/types';
import { QUAD_TONE, T } from './tokens';

export function RrgMap({ themes, hover, setHover, onPick, highlight }: {
  themes: ThemeRow[]; hover: string | null; setHover: (s: string | null) => void; onPick?: (id: string) => void; highlight?: Set<string>;
}) {
  const W = 360, H = 320, pad = 30;
  const pts = themes.filter((t) => typeof t.rsRatio === 'number' && typeof t.rsMomentum === 'number');
  if (!pts.length) return <div style={{ fontSize: 11.5, color: T.faint, padding: 20, textAlign: 'center' }}>No themes to plot.</div>;
  const xs = pts.map((t) => t.rsRatio as number), ys = pts.map((t) => t.rsMomentum as number);
  const span = (arr: number[]) => { const mn = Math.min(100, ...arr), mx = Math.max(100, ...arr); const p2 = Math.max(1.5, (mx - mn) * 0.15); return [mn - p2, mx + p2] as const; };
  const [x0, x1] = span(xs), [y0, y1] = span(ys);
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
  const cx = sx(100), cy = sy(100);
  const col = (t: ThemeRow) => QUAD_TONE[t.quadrant || 'Lagging'] || T.flat;
  const labelled = pts.filter((t) => (hover ? hover === t.id : !!t.quadrantMove || !!highlight?.has(t.id)));
  const placed: number[] = [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rotation map: relative strength against momentum, with 8-week tails" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x={cx} y={pad} width={W - pad - cx} height={cy - pad} style={{ fill: QUAD_TONE.Leading, opacity: 0.06 }} />
      <rect x={pad} y={pad} width={cx - pad} height={cy - pad} style={{ fill: QUAD_TONE.Improving, opacity: 0.06 }} />
      <rect x={pad} y={cy} width={cx - pad} height={H - pad - cy} style={{ fill: QUAD_TONE.Lagging, opacity: 0.06 }} />
      <rect x={cx} y={cy} width={W - pad - cx} height={H - pad - cy} style={{ fill: QUAD_TONE.Weakening, opacity: 0.06 }} />
      <line x1={cx} y1={pad} x2={cx} y2={H - pad} style={{ stroke: T.border2 }} strokeDasharray="3 3" />
      <line x1={pad} y1={cy} x2={W - pad} y2={cy} style={{ stroke: T.border2 }} strokeDasharray="3 3" />
      <text x={W - pad} y={pad + 10} style={{ fill: QUAD_TONE.Leading }} fontSize="9" textAnchor="end" fontWeight="700">LEADING</text>
      <text x={pad} y={pad + 10} style={{ fill: QUAD_TONE.Improving }} fontSize="9" fontWeight="700">IMPROVING</text>
      <text x={pad} y={H - pad - 4} style={{ fill: QUAD_TONE.Lagging }} fontSize="9" fontWeight="700">LAGGING</text>
      <text x={W - pad} y={H - pad - 4} style={{ fill: QUAD_TONE.Weakening }} fontSize="9" textAnchor="end" fontWeight="700">WEAKENING</text>
      <text x={W / 2} y={H - 6} style={{ fill: T.faint }} fontSize="8" textAnchor="middle">relative strength vs benchmark →</text>
      <text x={9} y={H / 2} style={{ fill: T.faint }} fontSize="8" textAnchor="middle" transform={`rotate(-90 9 ${H / 2})`}>momentum →</text>
      {pts.map((t) => {
        const tr = t.trail || [];
        if (tr.length < 2) return null;
        const on = hover === t.id;
        return (
          <g key={`tr:${t.id}`} pointerEvents="none">
            {tr.slice(1).map((pt, i) => {
              const a = tr[i]; const frac = (i + 1) / (tr.length - 1);
              return <line key={i} x1={sx(a.x)} y1={sy(a.y)} x2={sx(pt.x)} y2={sy(pt.y)} style={{ stroke: col(t) }} strokeWidth={on ? 0.6 + frac * 1.8 : 0.3 + frac * 0.9} opacity={on ? 0.35 + frac * 0.55 : (t.quadrantMove ? 0.16 : 0.09) + frac * 0.22} strokeLinecap="round" />;
            })}
          </g>
        );
      })}
      {pts.map((t) => {
        const x = sx(t.rsRatio as number), y = sy(t.rsMomentum as number);
        const on = hover === t.id;
        return (
          <g key={t.id} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(t.id)} style={{ cursor: 'pointer' }}>
            <title>{`${t.name} — ${t.quadrant}${t.verdict ? ` · ${t.verdict}` : ''}`}</title>
            <circle cx={x} cy={y} r={10} fill="transparent" />
            {(t.quadrantMove || highlight?.has(t.id)) && <circle cx={x} cy={y} r={on ? 8.5 : 7} fill="none" style={{ stroke: T.warn }} strokeWidth="1.2" opacity={0.9} />}
            <circle cx={x} cy={y} r={on ? 6 : t.quadrantMove ? 4.5 : 3.6} style={{ fill: col(t), stroke: T.bg }} strokeWidth="1" />
          </g>
        );
      })}
      {labelled.map((t) => ({ t, x: sx(t.rsRatio as number), y: sy(t.rsMomentum as number) })).sort((a, b) => a.y - b.y).map(({ t, x, y }) => {
        let ly = y + 3;
        while (placed.some((pp) => Math.abs(pp - ly) < 11)) ly += 11;
        ly = Math.max(pad + 8, Math.min(H - pad - 2, ly));
        placed.push(ly);
        const on = hover === t.id;
        const right = x > W * 0.6;
        const lx = x + (right ? -9 : 9);
        return (
          <g key={`lb:${t.id}`} pointerEvents="none">
            {Math.abs(ly - (y + 3)) > 3 && <line x1={x} y1={y} x2={lx} y2={ly - 3} style={{ stroke: T.faint }} strokeWidth="0.6" opacity={0.7} />}
            <text x={lx} y={ly} textAnchor={right ? 'end' : 'start'} style={{ fill: T.text, stroke: T.bg }} fontSize={on ? 10 : 8.5} fontWeight={on ? 800 : 700} strokeWidth={on ? 2.8 : 2.2} paintOrder="stroke" strokeLinejoin="round">{t.emoji} {t.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
