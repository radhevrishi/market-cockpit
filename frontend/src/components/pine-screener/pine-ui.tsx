'use client';
// zzz999 — shared pieces of the redesigned Pine Screener: colour tokens (the site's --mc-* variables, so white and dark both work),
// the page's scoped style sheet, the pattern chip, the score bar, the sortable header and the small "vs average" cell.
import React from 'react';
import { PATTERN_META } from '@/lib/chart-patterns';
import { likelihoodWord, tagLengthText, type ScreenPatternTag } from '@/lib/screener/pine';
import { fmtPrice } from '@/lib/screener/filters';
import { stageWord, tfWord, type MaPosition } from '@/lib/screener/pine-view';
import type { ScreenMarket } from '@/lib/screener/types';

export const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', text2: 'var(--mc-text-2, var(--mc-text-1))', dim: 'var(--mc-text-3, #6b7280)', faint: 'var(--mc-text-4, #94a3b8)',
  border: 'var(--mc-border-1)', borderSoft: 'var(--mc-border-3, var(--mc-border-1))', bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2, var(--mc-bg-1))',
  accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
export const signColor = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? C.dim : v >= 0 ? C.green : C.red);
export const STAGE_GLYPH = (t: Pick<ScreenPatternTag, 's' | 'b'>) => (t.s === 'f' ? '◌' : t.s === 'b' ? (t.b === 'U' ? '▲' : '▼') : '✕');

/** The page's own scoped styles: layout grid, focus rings, hover, the mobile stack. Class names start with "pnx-". */
export const PINE_CSS = `
.pnx { color: var(--mc-text-0); }
.pnx :where(button, a, input, select, summary):focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; border-radius: 6px; }
.pnx-layout { display: grid; grid-template-columns: minmax(236px, 264px) minmax(0, 1fr); gap: 16px; align-items: start; }
.pnx-layout[data-wide="true"] { grid-template-columns: minmax(0, 1fr); }
.pnx-side { position: sticky; top: 8px; display: grid; gap: 14px; padding: 14px; border: 1px solid var(--mc-border-1); border-radius: 10px; background: var(--mc-bg-2, var(--mc-bg-1)); max-height: calc(100vh - 24px); overflow: auto; }
.pnx-side-toggle { display: none; }
.pnx-cards { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.pnx-card { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-rows: auto auto auto 1fr; gap: 2px; padding: 10px 12px 11px; border-radius: 10px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); min-width: 0; transition: border-color .12s ease, box-shadow .12s ease; }
.pnx-card:hover { border-color: var(--mc-border-2, var(--mc-border-1)); }
.pnx-card[aria-pressed="true"] { border-color: var(--mc-accent); box-shadow: inset 0 0 0 1px var(--mc-accent); }
.pnx-card-count { font-size: 28px; line-height: 1.05; font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.pnx-card-label { font-size: 13.5px; font-weight: 700; color: var(--mc-text-0); }
.pnx-card-sub { font-size: 11.5px; line-height: 1.35; color: var(--mc-text-3, #6b7280); }
.pnx-field { display: grid; gap: 6px; }
.pnx-field > .pnx-lab { font-size: 12px; font-weight: 700; color: var(--mc-text-2, var(--mc-text-1)); }
.pnx-seg { display: inline-flex; border: 1px solid var(--mc-border-1); border-radius: 8px; overflow: hidden; width: 100%; }
.pnx-seg > button { all: unset; box-sizing: border-box; flex: 1; text-align: center; white-space: nowrap; cursor: pointer; padding: 6px 4px; font-size: 13px; font-weight: 700; color: var(--mc-text-1); background: var(--mc-bg-0); }
.pnx-seg > button + button { border-left: 1px solid var(--mc-border-1); }
.pnx-seg > button[aria-checked="true"], .pnx-seg > button[aria-pressed="true"] { background: var(--mc-accent); color: #fff; }
.pnx-seg > button.pnx-up[aria-checked="true"] { background: var(--mc-bullish, #059669); }
.pnx-seg > button.pnx-down[aria-checked="true"] { background: var(--mc-bearish, #DC2626); }
.pnx-in { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 7px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-0); font-size: 13px; }
.pnx-btn { padding: 6px 11px; border-radius: 7px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.pnx-btn:hover:not(:disabled) { border-color: var(--mc-border-2, var(--mc-border-1)); }
.pnx-btn:disabled { opacity: .5; cursor: default; }
.pnx-btn[data-on="true"] { background: var(--mc-accent); border-color: var(--mc-accent); color: #fff; }
.pnx-link { all: unset; cursor: pointer; color: var(--mc-accent); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.pnx-table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.pnx-table th { position: sticky; top: 0; z-index: 3; background: var(--mc-bg-2, var(--mc-bg-1)); text-align: left; padding: 8px 8px; font-size: 12px; font-weight: 700; color: var(--mc-text-3, #6b7280); white-space: nowrap; border-bottom: 1px solid var(--mc-border-1); }
.pnx-table td { padding: 7px 8px; vertical-align: middle; border-bottom: 1px solid var(--mc-border-3, var(--mc-border-1)); }
.pnx-table tr.pnx-row:hover > td { background: color-mix(in srgb, var(--mc-accent) 5%, var(--mc-bg-0)); }
.pnx-table tr.pnx-row[data-sel="true"] > td { background: color-mix(in srgb, var(--mc-accent) 9%, var(--mc-bg-0)); }
.pnx-table tr.pnx-detail > td { background: var(--mc-bg-2, var(--mc-bg-1)); padding: 0; }
.pnx-pin { position: sticky; left: 0; z-index: 2; background: var(--mc-bg-0); }
.pnx-table th.pnx-pin { z-index: 4; background: var(--mc-bg-2, var(--mc-bg-1)); }
.pnx-num { text-align: right; white-space: nowrap; }
.pnx-exp { all: unset; cursor: pointer; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; color: var(--mc-text-3, #6b7280); font-size: 12px; }
.pnx-exp:hover, .pnx-exp[aria-expanded="true"] { color: var(--mc-accent); background: color-mix(in srgb, var(--mc-accent) 10%, transparent); }
.pnx-compact .pnx-table td { padding: 5px 8px; }
.pnx-wrap { overflow: auto; max-height: 76vh; border: 1px solid var(--mc-border-1); border-radius: 10px; }
.pnx-note { font-size: 12.5px; color: var(--mc-text-3, #6b7280); }
.pnx-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.pnx-pat { all: unset; box-sizing: border-box; cursor: pointer; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--mc-border-1); font-size: 12.5px; font-weight: 650; color: var(--mc-text-1); background: var(--mc-bg-0); }
.pnx-pat[aria-pressed="true"].pnx-up { background: var(--mc-bullish, #059669); border-color: var(--mc-bullish, #059669); color: #fff; }
.pnx-pat[aria-pressed="true"].pnx-down { background: var(--mc-bearish, #DC2626); border-color: var(--mc-bearish, #DC2626); color: #fff; }
.pnx-pat .pnx-n { opacity: .7; font-weight: 600; margin-left: 4px; }
.pnx-pat[data-zero="true"] { color: var(--mc-text-4, #94a3b8); }
.pnx-detail-grid { position: sticky; left: 0; box-sizing: border-box; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding: 14px 16px 16px; font-size: 13px; }
.pnx-detail-grid h4 { margin: 0 0 6px; font-size: 12.5px; font-weight: 750; color: var(--mc-text-2, var(--mc-text-1)); }
.pnx-detail-grid ul { margin: 0; padding-left: 16px; display: grid; gap: 3px; }
.pnx-sum { cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--mc-text-2, var(--mc-text-1)); list-style: none; }
.pnx-sum::-webkit-details-marker { display: none; }
@media (max-width: 1180px) { .pnx-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 899px) {
  .pnx-layout { grid-template-columns: minmax(0, 1fr); }
  .pnx-side { position: static; max-height: none; }
  .pnx-side[data-open="false"] > :not(.pnx-side-head) { display: none !important; }
  .pnx-side-toggle { display: inline-flex; }
  .pnx-cards { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; }
  .pnx-card { flex: 0 0 158px; scroll-snap-align: start; }
  .pnx-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .pnx-hide-sm { display: none; }
}
@media (prefers-reduced-motion: reduce) { .pnx-card { transition: none; } }
`;

/** A pattern chip: name, timeframe badge, stage glyph; bullish green, bearish red, failed grey (dashed). */
export function PatternChip({ t, main = false, market, patAt, showStage = false }: { t: ScreenPatternTag; main?: boolean; market: ScreenMarket; patAt?: string; showStage?: boolean }) {
  const m = PATTERN_META[t.id];
  if (!m) return null;
  const failed = t.s === 'x';
  const col = failed ? C.faint : t.b === 'U' ? C.green : C.red;
  const tf = t.tf || 'D';
  const vq = (t as any).vq === 0;
  const len = tagLengthText(t);
  const tip = [`${m.label} (${m.bias}) on ${tfWord(tf)} bars — ${stageWord(t)}, shape score ${t.c}/100 (${likelihoodWord(t.c)}; not a probability)`,
    t.p != null ? `${t.b === 'U' ? 'Pivot' : 'Breakdown level'} ${fmtPrice(t.p, market)}${t.d != null ? `, scan close ${Math.abs(t.d).toFixed(2)}% ${t.d < 0 ? 'below' : 'above'}` : ''}` : '',
    typeof (t as any).dq === 'number' ? `From the latest quote: ${(t as any).dq > 0 ? '+' : ''}${(t as any).dq}%` : '',
    len ? `${len} long${t.dp != null ? `, ${t.dp}% deep` : ''}` : '',
    vq ? 'Volume not confirmed: too little usable volume data for this pattern' : '',
    m.short, patAt ? `As of the ${patAt} close` : ''].filter(Boolean).join('\n');
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: main ? 750 : 600, whiteSpace: 'nowrap',
      border: `1px ${failed ? 'dashed' : 'solid'} ${col}`, background: main && !failed ? `color-mix(in srgb, ${col} 14%, transparent)` : 'transparent', color: col }}>
      <span aria-hidden>{STAGE_GLYPH(t)}</span>{m.label}
      <span style={{ fontSize: 10, fontWeight: 800, padding: '0 4px', borderRadius: 4, border: '1px solid currentColor', opacity: 0.85 }} aria-label={`${tfWord(tf)} timeframe`}>{tf}</span>
      {showStage ? <span style={{ fontWeight: 600, color: C.dim }}>{stageWord(t)}</span> : null}
      {vq ? <span title="Volume not confirmed" aria-label="volume not confirmed" style={{ opacity: 0.85 }}>v?</span> : null}
    </span>
  );
}

/** Shape score as a short bar + the number (0–100; possible ≥ 35, likely ≥ 55, very likely ≥ 75). */
export function ScoreBar({ c }: { c: number }) {
  const col = c >= 75 ? C.green : c >= 55 ? C.accent : C.faint;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }} title={`${likelihoodWord(c)} — shape score ${c}/100 (not a probability)`}>
      <span aria-hidden style={{ width: 34, height: 6, borderRadius: 3, background: 'color-mix(in srgb, var(--mc-text-3, #6b7280) 18%, transparent)', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${Math.max(4, Math.min(100, c))}%`, height: '100%', background: col }} />
      </span>
      <b style={{ minWidth: 20, textAlign: 'right' }}>{c}</b>
    </span>
  );
}

/** "+3.1  −2.0  +12.4" — the close against its 21, 50 and 200-day averages (same daily bars). */
export function MaCell({ ma, market }: { ma: MaPosition; market: ScreenMarket }) {
  const tip = ma.close == null ? 'No close stored'
    : `${ma.basis === 'scan' ? 'Scan close' : 'Latest quote (no scan close stored)'} ${fmtPrice(ma.close, market)}${ma.at ? ` on ${ma.at}` : ''} against its simple moving averages (worked out from the same daily bars):\n21-day ${pct(ma.d21)} · 50-day ${pct(ma.d50)} · 200-day ${pct(ma.d200)}`;
  return (
    <span title={tip} style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(3, 3.6em)', gap: 4, justifyItems: 'end', fontSize: 12.5 }}>
      {[ma.d21, ma.d50, ma.d200].map((d, i) => <span key={i} style={{ color: signColor(d) }}>{d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`}</span>)}
    </span>
  );
}

export function Th({ label, k, sort, setSort, num, title, bare, className }: { label: React.ReactNode; k: string; sort: { key: string; dir: 1 | -1 }; setSort: (s: { key: string; dir: 1 | -1 }) => void; num?: boolean; title?: string; bare?: boolean; className?: string }) {
  const on = sort.key === k;
  const b = (
    <button type="button" title={title} onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : num ? -1 : 1 })} style={{ all: 'unset', cursor: 'pointer', color: on ? 'var(--mc-accent)' : undefined }}
      aria-label={typeof label === 'string' ? `Sort by ${label}` : undefined}>
      {label} {on ? (sort.dir === -1 ? '▼' : '▲') : ''}
    </button>
  );
  return bare ? b : <th className={className} style={{ textAlign: num ? 'right' : 'left' }} title={title} aria-sort={on ? (sort.dir === -1 ? 'descending' : 'ascending') : undefined}>{b}</th>;
}
