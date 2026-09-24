'use client';
// Theme Rotation — small shared pieces (zzz795).
import React, { useState } from 'react';
import type { LayerKey, LayerRead, LayerSet, Tier } from '@/lib/theme-rotation/types';
import { TIER_LABEL } from '@/lib/theme-rotation/types';
import { LAYER_NAME, LAYER_ORDER, LAYER_SHORT } from '@/lib/theme-rotation/layers';
import { STATE_META, T, TIER_TONE, VERDICT_TONE, tint } from './tokens';

export function Pill({ color, children, title, strong, style }: { color: string; children: React.ReactNode; title?: string; strong?: boolean; style?: React.CSSProperties }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: 10.5, fontWeight: strong ? 900 : 800,
      color, background: tint(color, 13), border: `1px solid ${tint(color, 40)}`, borderRadius: 5, padding: '1px 6px', lineHeight: 1.5, ...style,
    }}>{children}</span>
  );
}

export function VerdictBadge({ verdict, note }: { verdict?: string; note?: string }) {
  if (!verdict) return <span style={{ color: T.faint, fontSize: 11 }}>—</span>;
  return <Pill color={VERDICT_TONE[verdict] || T.flat} title={note} strong>{verdict}</Pill>;
}

export function TierBadge({ tier }: { tier: Tier }) {
  return <Pill color={TIER_TONE[tier]} strong>{TIER_LABEL[tier]}</Pill>;
}

/** Seven small badges, one per evidence layer, in a fixed order. */
export function LayerStrip({ layers, compact }: { layers: LayerSet; compact?: boolean }) {
  return (
    <div className="trt-layers" style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {LAYER_ORDER.map((k) => <LayerBadge key={k} k={k} r={layers[k]} compact={compact} />)}
    </div>
  );
}

export function LayerBadge({ k, r, compact }: { k: LayerKey; r: LayerRead; compact?: boolean }) {
  // Valuation has no direction; show its level instead of a state glyph.
  const isVal = k === 'valuation';
  const m = STATE_META[r.state];
  const color = isVal ? (r.level === 'weak' ? T.warn : r.level === 'strong' ? T.up : r.level === 'neutral' ? T.flat : T.absent) : m.color;
  const glyph = isVal ? (r.level === 'weak' ? '$$' : r.level === 'strong' ? '$' : r.level === 'neutral' ? '≈' : '○') : m.glyph;
  const word = isVal ? (r.level === 'weak' ? 'rich vs graded names' : r.level === 'strong' ? 'cheap vs graded names' : r.level === 'neutral' ? 'in line' : 'not available') : m.word;
  return (
    <span title={`${LAYER_NAME[k]}: ${word}. ${r.headline}${r.proxy ? ' (proxy)' : ''}`}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9.5, fontWeight: 800, fontFamily: T.mono,
        color, background: tint(color, r.state === 'unknown' && !isVal ? 6 : 12), border: `1px ${r.state === 'unknown' && !(isVal && r.level) ? 'dashed' : 'solid'} ${tint(color, 45)}`,
        borderRadius: 4, padding: compact ? '0' : '1px 4px', lineHeight: 1.45,
        ...(compact ? { width: 22, justifyContent: 'center', boxSizing: 'border-box' as const } : {}),
      }}>
      <span aria-hidden>{glyph}</span>{compact ? null : <span>{LAYER_SHORT[k]}</span>}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{LAYER_NAME[k]} {word}</span>
    </span>
  );
}

/** A ranked list of names: the first `n`, then "+N more" that expands in place. */
export function NameChips({ names, n = 5, color = T.dim, onPick, render }: {
  names: string[]; n?: number; color?: string; onPick?: (x: string) => void; render?: (x: string) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  if (!names.length) return <span style={{ color: T.faint, fontSize: 11 }}>none</span>;
  const shown = all ? names : names.slice(0, n);
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {shown.map((x) => onPick
        ? <button key={x} type="button" onClick={() => onPick(x)} style={chipBtn(color)}>{render ? render(x) : x}</button>
        : <span key={x} style={chipStatic(color)}>{render ? render(x) : x}</span>)}
      {names.length > n && (
        <button type="button" onClick={() => setAll((v) => !v)} style={{ ...chipBtn(T.faint), borderStyle: 'dashed' }}>
          {all ? 'show fewer' : `+${names.length - n} more`}
        </button>
      )}
    </span>
  );
}
const chipBtn = (c: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, color: c, background: tint(c, 8), border: `1px solid ${tint(c, 30)}`, borderRadius: 5, padding: '1px 7px', cursor: 'pointer', lineHeight: 1.5 });
const chipStatic = (c: string): React.CSSProperties => ({ ...chipBtn(c), cursor: 'default' });

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: T.text, letterSpacing: 0.2 }}>{children}</span>
      {hint ? <span style={{ fontSize: 11, color: T.faint }}>{hint}</span> : null}
    </div>
  );
}

export const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px' };

/**
 * zzz797 — a tiny relative-strength sparkline (12 weekly points of the theme
 * ÷ benchmark line, rebased to 100). Rising = beating the benchmark over
 * those weeks. No axis: the title carries the numbers.
 */
export function Sparkline({ values, width = 64, height = 18, label }: { values?: number[] | null; width?: number; height?: number; label?: string }) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length < 3) return <span style={{ color: T.faint, fontSize: 10 }} title="Not enough weekly history for a sparkline">—</span>;
  const mn = Math.min(...v), mx = Math.max(...v), span = mx - mn || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((y - mn) / span) * (height - 4) - 1).toFixed(1)}`).join(' ');
  const chg = v[v.length - 1] - v[0];
  const c = chg >= 0.5 ? T.up : chg <= -0.5 ? T.down : T.flat;
  const title = `${label ? `${label}: ` : ''}relative strength vs the benchmark over ${v.length} weeks ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% (rising = beating it)`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ display: 'block' }}>
      <title>{title}</title>
      <polyline points={pts} fill="none" style={{ stroke: c }} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width - 1.5} cy={Number(pts.split(' ').pop()!.split(',')[1])} r="1.6" style={{ fill: c }} />
    </svg>
  );
}
