'use client';
// zzz999 — shared pieces of the redesigned Pine Screener: colour tokens (the site's --mc-* variables, so white and dark both work),
// the page's scoped style sheet, the pattern chip, the score bar, the sortable header and the small "vs average" cell.
import React from 'react';
import { PATTERN_META } from '@/lib/chart-patterns';
import { likelihoodWord, tagLengthText, type ScreenPatternTag } from '@/lib/screener/pine';
import { fmtPrice } from '@/lib/screener/filters';
import { isReturned, stageWord, tfWord, type ConditionState, type Funnel, type MaPosition } from '@/lib/screener/pine-view';
import type { ScreenMarket } from '@/lib/screener/types';

export const C = {
  text: 'var(--mc-text-0)', text1: 'var(--mc-text-1)', text2: 'var(--mc-text-2, var(--mc-text-1))', dim: 'var(--mc-text-3, #6b7280)', faint: 'var(--mc-text-4, #94a3b8)',
  border: 'var(--mc-border-1)', borderSoft: 'var(--mc-border-3, var(--mc-border-1))', bg: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2, var(--mc-bg-1))',
  accent: 'var(--mc-accent)', green: 'var(--mc-bullish, #059669)', red: 'var(--mc-bearish, #DC2626)', amber: 'var(--mc-warn, #D97706)',
};
export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
export const signColor = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? C.dim : v >= 0 ? C.green : C.red);
export const STAGE_GLYPH = (t: Pick<ScreenPatternTag, 's' | 'b'> & { d?: number | null }) => (t.s === 'f' ? '◌' : t.s === 'b' ? (isReturned(t) ? '↩' : t.b === 'U' ? '▲' : '▼') : '✕');

/** The page's own scoped styles and design tokens (white default, dark). Class names start with "pnx-". */
export const PINE_CSS = `
/* zzz1011 — the Pine Screener's own design tokens. The site's --mc-* names are refined here (scoped to .pnx) so every inline style
   that reads them follows; --pnx-* add what the terminal needs: rules, sunken wells, zebra, focus and the type scale. */
.pnx.mc-chart-light, .pnx:not(.mc-workspace-dark) {
  --mc-bg-0: #ffffff; --mc-bg-1: #fbfcfd; --mc-bg-2: #f5f6f8; --mc-bg-3: #eef0f3;
  --mc-border-1: #dfe3e9; --mc-border-2: #c3c9d2; --mc-border-3: #edf0f3;
  --mc-text-0: #121722; --mc-text-1: #232a36; --mc-text-2: #3d4553; --mc-text-3: #636c7b; --mc-text-4: #9199a6;
  --mc-accent: #2453c4; --mc-bullish: #0b7a4b; --mc-bearish: #bf3a2e; --mc-warn: #a2560c;
  --pnx-zebra: #fafbfc; --pnx-hover: #f1f5fd; --pnx-sel: #e8effc; --pnx-well: #f5f6f8; --pnx-shadow: 0 1px 0 rgba(18,23,34,.04), 0 6px 18px -12px rgba(18,23,34,.18);
  --pnx-chip-up: #e7f4ee; --pnx-chip-down: #fbecea; --pnx-chip-warn: #fbf1e4; --pnx-chip-dim: #f0f2f5; --pnx-track: #e7eaef; --pnx-window: #dcefe5;
  color-scheme: light; background: #ffffff;
}
.pnx.mc-workspace-dark {
  --mc-bg-0: #0c1018; --mc-bg-1: #10151f; --mc-bg-2: #131a26; --mc-bg-3: #19212f;
  --mc-border-1: #232c3b; --mc-border-2: #33405a; --mc-border-3: #1a2230;
  --mc-text-0: #eef1f6; --mc-text-1: #d9dfe8; --mc-text-2: #b9c2d0; --mc-text-3: #8691a3; --mc-text-4: #5d687b;
  --mc-accent: #7ea3ff; --mc-bullish: #3cc98f; --mc-bearish: #f2756a; --mc-warn: #e9a947;
  --pnx-zebra: #0f141d; --pnx-hover: #151d2c; --pnx-sel: #18233a; --pnx-well: #10151f; --pnx-shadow: 0 1px 0 rgba(0,0,0,.4), 0 10px 24px -14px rgba(0,0,0,.7);
  --pnx-chip-up: rgba(60,201,143,.12); --pnx-chip-down: rgba(242,117,106,.12); --pnx-chip-warn: rgba(233,169,71,.13); --pnx-chip-dim: rgba(134,145,163,.12); --pnx-track: #222b3a; --pnx-window: rgba(60,201,143,.16);
  color-scheme: dark; background: #0c1018;
}
.pnx { color: var(--mc-text-0); font-feature-settings: "tnum" 1, "cv11" 1, "ss01" 1; -webkit-font-smoothing: antialiased; line-height: 1.45; font-size: 13px; }
.pnx :where(button, a, input, select, summary, [tabindex]):focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; border-radius: 6px; }
.pnx ::selection { background: color-mix(in srgb, var(--mc-accent) 22%, transparent); }

/* header */
.pnx-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.pnx-title { margin: 0; font-size: 22px; font-weight: 720; letter-spacing: -0.02em; line-height: 1.15; }
.pnx-lede { margin: 0; font-size: 13px; color: var(--mc-text-3); max-width: 78ch; }
.pnx-kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 5px; border: 1px solid var(--mc-border-1); border-bottom-width: 2px; background: var(--mc-bg-0); color: var(--mc-text-2); font-size: 11px; font-weight: 650; line-height: 1; }

/* workflows */
.pnx-flows { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pnx-flow { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px 5px 9px; border-radius: 8px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); font-size: 12.5px; font-weight: 600; color: var(--mc-text-1); white-space: nowrap; transition: border-color .12s ease, background-color .12s ease; }
.pnx-flow:hover { border-color: var(--mc-border-2); background: var(--pnx-hover); }
.pnx-flow[aria-pressed="true"] { border-color: var(--mc-accent); background: color-mix(in srgb, var(--mc-accent) 9%, var(--mc-bg-0)); color: var(--mc-text-0); }
.pnx-flow-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.pnx-flow-n { font-weight: 700; color: var(--mc-text-3); font-size: 12px; min-width: 1.4em; text-align: right; }

/* layout */
.pnx-layout { display: grid; grid-template-columns: minmax(240px, 268px) minmax(0, 1fr); gap: 16px; align-items: start; }
.pnx-layout[data-wide="true"] { grid-template-columns: minmax(0, 1fr); }
.pnx-side { position: sticky; top: 8px; display: grid; gap: 14px; padding: 14px 14px 16px; border: 1px solid var(--mc-border-1); border-radius: 12px; background: var(--mc-bg-1); max-height: calc(100vh - 24px); overflow: auto; overscroll-behavior: contain; }
.pnx-side-toggle { display: none; }

/* setup cards */
.pnx-cards { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.pnx-card { all: unset; box-sizing: border-box; cursor: pointer; position: relative; display: flex; flex-direction: column; gap: 1px; padding: 9px 12px 10px; border-radius: 10px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); min-width: 0; transition: border-color .14s ease, box-shadow .14s ease, transform .14s ease; }
.pnx-card:hover { border-color: var(--mc-border-2); box-shadow: var(--pnx-shadow); }
.pnx-card[aria-pressed="true"] { border-color: var(--mc-accent); box-shadow: inset 0 0 0 1px var(--mc-accent), var(--pnx-shadow); }
.pnx-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
.pnx-card-count { font-size: 24px; line-height: 1.05; font-weight: 720; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
.pnx-card-label { font-size: 13px; font-weight: 680; color: var(--mc-text-0); margin-top: 2px; }
.pnx-card-sub { font-size: 11.5px; line-height: 1.35; color: var(--mc-text-3); }

/* filter panel */
.pnx-field { display: grid; gap: 6px; }
.pnx-field > .pnx-lab, .pnx-lab { font-size: 11.5px; font-weight: 650; color: var(--mc-text-3); letter-spacing: .01em; }
.pnx-seg { display: inline-flex; border: 1px solid var(--mc-border-1); border-radius: 8px; overflow: hidden; width: 100%; background: var(--mc-bg-0); padding: 2px; gap: 2px; box-sizing: border-box; }
.pnx-seg > button { all: unset; box-sizing: border-box; flex: 1; text-align: center; white-space: nowrap; cursor: pointer; padding: 5px 6px; border-radius: 6px; font-size: 12.5px; font-weight: 650; color: var(--mc-text-2); transition: background-color .12s ease, color .12s ease; }
.pnx-seg > button:hover { background: var(--pnx-hover); color: var(--mc-text-0); }
.pnx-seg > button[aria-checked="true"], .pnx-seg > button[aria-pressed="true"] { background: var(--mc-text-0); color: var(--mc-bg-0); }
.pnx-seg > button.pnx-up[aria-checked="true"] { background: var(--mc-bullish); color: #fff; }
.pnx-seg > button.pnx-down[aria-checked="true"] { background: var(--mc-bearish); color: #fff; }
.pnx-in { width: 100%; box-sizing: border-box; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-0); font-size: 13px; font: inherit; transition: border-color .12s ease, box-shadow .12s ease; }
.pnx-in:hover { border-color: var(--mc-border-2); }
.pnx-in:focus { outline: none; border-color: var(--mc-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mc-accent) 18%, transparent); }
.pnx-search { position: relative; display: inline-flex; align-items: center; }
.pnx-search > .pnx-in { padding-left: 28px; padding-right: 30px; }
.pnx-search > svg { position: absolute; left: 9px; pointer-events: none; color: var(--mc-text-4); }
.pnx-search > .pnx-kbd { position: absolute; right: 7px; pointer-events: none; }
.pnx-btn { padding: 6px 11px; border-radius: 8px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 12.5px; font-weight: 620; cursor: pointer; white-space: nowrap; transition: border-color .12s ease, background-color .12s ease; }
.pnx-btn:hover:not(:disabled) { border-color: var(--mc-border-2); background: var(--pnx-hover); }
.pnx-btn:disabled { opacity: .45; cursor: default; }
.pnx-btn[data-on="true"] { background: var(--mc-text-0); border-color: var(--mc-text-0); color: var(--mc-bg-0); }
.pnx-btn-ic { display: inline-flex; gap: 6px; align-items: center; }
.pnx-btn[data-tone="accent"] { background: var(--mc-accent); border-color: var(--mc-accent); color: #fff; }
.pnx-link { all: unset; cursor: pointer; color: var(--mc-accent); font-weight: 620; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.pnx-note { font-size: 12px; color: var(--mc-text-3); }
.pnx-callout { font-size: 12.5px; border-radius: 9px; padding: 8px 11px; border: 1px solid; display: grid; gap: 3px; }
.pnx-callout[data-tone="warn"] { color: var(--mc-warn); border-color: color-mix(in srgb, var(--mc-warn) 40%, transparent); background: var(--pnx-chip-warn); }
.pnx-callout[data-tone="info"] { color: var(--mc-text-1); border-color: var(--mc-border-1); background: var(--mc-bg-2); }

/* the result header: query, funnel */
.pnx-qhead { display: grid; gap: 6px; }
.pnx-query { margin: 0; font-size: 15px; font-weight: 680; letter-spacing: -0.005em; line-height: 1.35; color: var(--mc-text-0); }
.pnx-funnel { display: inline-flex; justify-self: start; max-width: 100%; flex-wrap: wrap; border: 1px solid var(--mc-border-1); border-radius: 10px; overflow: hidden; background: var(--mc-bg-0); }
.pnx-funnel > div { display: grid; gap: 0; padding: 6px 16px 7px 14px; min-width: 88px; border-right: 1px solid var(--mc-border-3); }
.pnx-funnel > div:last-child { border-right: 0; }
.pnx-funnel b { font-size: 18px; font-weight: 720; letter-spacing: -0.02em; line-height: 1.1; }
.pnx-funnel span { font-size: 11.5px; color: var(--mc-text-3); }
.pnx-prog { height: 4px; border-radius: 2px; background: var(--pnx-track); overflow: hidden; }
.pnx-prog > i { display: block; height: 100%; background: var(--mc-warn); border-radius: 2px; transition: width .4s ease; }

/* toolbar */
.pnx-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pnx-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--mc-text-3); }

/* the table */
.pnx-wrap { overflow: auto; max-height: 78vh; border: 1px solid var(--mc-border-1); border-radius: 12px; background: var(--mc-bg-0); }
.pnx-table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.pnx-table th { position: sticky; top: 0; z-index: 3; background: var(--mc-bg-1); text-align: left; padding: 9px 10px 8px; font-size: 11.5px; font-weight: 650; color: var(--mc-text-3); white-space: nowrap; border-bottom: 1px solid var(--mc-border-1); }
.pnx-table th button { color: inherit; }
.pnx-table th[aria-sort] { color: var(--mc-text-0); }
.pnx-sort { display: inline-block; width: 8px; margin-left: 4px; opacity: .35; font-size: 9px; }
.pnx-table th[aria-sort] .pnx-sort { opacity: 1; color: var(--mc-accent); }
.pnx-table td { padding: 6px 10px; vertical-align: middle; border-bottom: 1px solid var(--mc-border-3); white-space: nowrap; }
.pnx-table td.pnx-wrapok { white-space: normal; }
.pnx-table tbody tr.pnx-row:nth-of-type(even) > td { background: var(--pnx-zebra); }
.pnx-table tbody tr.pnx-row:hover > td { background: var(--pnx-hover); }
.pnx-table tbody tr.pnx-row[data-sel="true"] > td { background: var(--pnx-sel); }
.pnx-table tbody tr.pnx-row[data-cursor="true"] > td { background: var(--pnx-sel); }
.pnx-table tbody tr.pnx-row[data-cursor="true"] > td.pnx-pin { box-shadow: inset 3px 0 0 var(--mc-accent); }
.pnx-table tr.pnx-detail > td { white-space: normal; background: var(--mc-bg-1); padding: 0; border-bottom: 1px solid var(--mc-border-1); }
.pnx-pin { position: sticky; left: 0; z-index: 2; background: var(--mc-bg-0); box-shadow: 1px 0 0 var(--mc-border-3); }
.pnx-table th.pnx-pin { z-index: 4; background: var(--mc-bg-1); }
.pnx-num { text-align: right; white-space: nowrap; }
.pnx-tk { color: var(--mc-text-0); font-weight: 700; text-decoration: none; letter-spacing: .01em; font-size: 13.5px; }
.pnx-tk:hover { color: var(--mc-accent); text-decoration: underline; text-underline-offset: 3px; }
.pnx-co { font-size: 11.5px; color: var(--mc-text-3); max-width: 168px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pnx-rank { color: var(--mc-text-4); font-size: 10.5px; width: 1.8em; display: inline-block; text-align: right; margin-right: 6px; }
.pnx-exp { all: unset; cursor: pointer; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; color: var(--mc-text-4); font-size: 11px; transition: transform .15s ease, color .12s ease; }
.pnx-exp:hover, .pnx-exp[aria-expanded="true"] { color: var(--mc-accent); background: color-mix(in srgb, var(--mc-accent) 10%, transparent); }
.pnx-exp[aria-expanded="true"] { transform: rotate(90deg); }
.pnx-compact .pnx-table td { padding: 4px 10px; }
.pnx-compact .pnx-table th { padding: 7px 10px 6px; }
.pnx-dim { color: var(--mc-text-4); }
.pnx-unknown { color: var(--mc-text-4); font-style: italic; font-size: 12px; }

/* chips, badges */
.pnx-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.pnx-pat { all: unset; box-sizing: border-box; cursor: pointer; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--mc-border-1); font-size: 12px; font-weight: 620; color: var(--mc-text-1); background: var(--mc-bg-0); transition: border-color .12s ease; }
.pnx-pat:hover:not(:disabled) { border-color: var(--mc-border-2); }
.pnx-pat[aria-pressed="true"].pnx-up { background: var(--mc-bullish); border-color: var(--mc-bullish); color: #fff; }
.pnx-pat[aria-pressed="true"].pnx-down { background: var(--mc-bearish); border-color: var(--mc-bearish); color: #fff; }
.pnx-pat .pnx-n { opacity: .65; font-weight: 600; margin-left: 5px; }
.pnx-pat[data-zero="true"] { color: var(--mc-text-4); }
.pnx-pat[data-na="true"] { color: var(--mc-text-4); border-style: dashed; cursor: not-allowed; }
.pnx-pat[data-na="true"][aria-pressed="true"] { cursor: pointer; text-decoration: line-through; }
.pnx-badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 5px; font-size: 11px; font-weight: 640; white-space: nowrap; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); line-height: 1.55; }
.pnx-cond { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 7px; border-radius: 6px; font-size: 11.5px; font-weight: 650; white-space: nowrap; line-height: 1.45; }
.pnx-cond[data-tone="up"] { color: var(--mc-bullish); background: var(--pnx-chip-up); }
.pnx-cond[data-tone="down"] { color: var(--mc-bearish); background: var(--pnx-chip-down); }
.pnx-cond[data-tone="warn"] { color: var(--mc-warn); background: var(--pnx-chip-warn); }
.pnx-cond[data-tone="dim"] { color: var(--mc-text-3); background: var(--pnx-chip-dim); }
.pnx-cond::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.pnx-cond[data-state="forming"]::before { background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }
.pnx-seg-sm > button { padding: 4px 10px; font-size: 12px; }

/* row detail */
.pnx-detail-grid { position: sticky; left: 0; box-sizing: border-box; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; padding: 16px 18px 18px; font-size: 12.5px; }
.pnx-detail-grid h4 { margin: 0 0 7px; font-size: 12px; font-weight: 700; color: var(--mc-text-0); }
.pnx-detail-grid ul { margin: 0; padding-left: 16px; display: grid; gap: 4px; }
.pnx-detail-grid > section { min-width: 0; }
.pnx-sum { cursor: pointer; font-size: 12px; font-weight: 650; color: var(--mc-text-2); list-style: none; }
.pnx-sum::-webkit-details-marker { display: none; }
.pnx-panel { border: 1px solid var(--mc-border-1); border-radius: 10px; padding: 8px 12px; background: var(--mc-bg-0); font-size: 12.5px; }

/* loading */
.pnx-skel { display: block; height: 10px; border-radius: 4px; background: linear-gradient(90deg, var(--pnx-track) 0%, var(--mc-bg-2) 40%, var(--pnx-track) 80%); background-size: 240% 100%; animation: pnx-shimmer 1.3s ease-in-out infinite; }
@keyframes pnx-shimmer { from { background-position: 100% 0; } to { background-position: -40% 0; } }

/* help overlay */
.pnx-help-back { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, #0c1018 34%, transparent); display: grid; place-items: center; padding: 16px; animation: pnx-fade .14s ease; }
.pnx-help { width: min(440px, 100%); background: var(--mc-bg-0); color: var(--mc-text-0); border: 1px solid var(--mc-border-1); border-radius: 14px; box-shadow: 0 24px 60px -20px rgba(0,0,0,.45); padding: 18px 20px 16px; display: grid; gap: 12px; }
.pnx-help h2 { margin: 0; font-size: 16px; font-weight: 700; }
.pnx-help dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; align-items: center; font-size: 13px; }
.pnx-help dd { margin: 0; color: var(--mc-text-2); }
@keyframes pnx-fade { from { opacity: 0; } to { opacity: 1; } }

@media (max-width: 1360px) { .pnx-card-sub { font-size: 11px; } .pnx-card { padding: 8px 10px 9px; } }
@media (max-width: 1180px) {
  .pnx-cards { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; }
  .pnx-card { flex: 0 0 168px; scroll-snap-align: start; }
}
@media (max-width: 1599px) { .pnx-hide-lg { display: none; } }
@media (max-width: 1100px) { .pnx-hide-md { display: none; } }
@media (max-width: 899px) {
  .pnx-layout { grid-template-columns: minmax(0, 1fr); }
  .pnx-side { position: static; max-height: none; }
  .pnx-side[data-open="false"] > :not(.pnx-side-head) { display: none !important; }
  .pnx-side-toggle { display: inline-flex; }
  .pnx-card { flex: 0 0 156px; }
  .pnx-flows { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; }
  .pnx-flows > .pnx-lab { flex: none; }
  .pnx-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .pnx-hide-sm { display: none; }
  .pnx-title { font-size: 19px; }
}
@media (max-width: 520px) { .pnx-funnel { display: flex; justify-self: stretch; } .pnx-funnel > div { min-width: 0; flex: 1 1 40%; padding: 6px 10px; } }
@media (prefers-reduced-motion: reduce) {
  .pnx *, .pnx *::before, .pnx-help-back { transition: none !important; animation: none !important; }
}
`;

/** A pattern chip: name, timeframe badge, stage glyph; bullish green, bearish red, failed grey (dashed). */
/** zzz1004 (PS-02) — `when`: the tag's OWN timeframe as-of text (sessionLabel(analysisOf(row, tag)) — e.g. "completed monthly close
 *  2026-09-30"); `patAt` (a daily date) is kept for older callers and used only on a daily tag. */
export function PatternChip({ t, main = false, market, patAt, when, showStage = false }: { t: ScreenPatternTag; main?: boolean; market: ScreenMarket; patAt?: string; when?: string; showStage?: boolean }) {
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
    m.short, when ? `As of: ${when}` : patAt && tf === 'D' ? `As of the ${patAt} close` : ''].filter(Boolean).join('\n');
  const bg = failed ? 'transparent' : t.b === 'U' ? 'var(--pnx-chip-up)' : 'var(--pnx-chip-down)';
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: main ? '2px 8px 2px 6px' : '1px 7px 1px 5px', borderRadius: 6, fontSize: main ? 12.5 : 11.5, fontWeight: main ? 680 : 600, whiteSpace: 'nowrap',
      border: failed ? `1px dashed ${col}` : main ? '1px solid transparent' : `1px solid color-mix(in srgb, ${col} 30%, transparent)`, background: main ? bg : 'transparent', color: col }}>
      <span aria-hidden style={{ fontSize: 10 }}>{STAGE_GLYPH(t)}</span><span style={{ color: main ? 'var(--mc-text-0)' : undefined }}>{m.label}</span>
      <span style={{ fontSize: 10, fontWeight: 760, padding: '0 4px', borderRadius: 4, background: `color-mix(in srgb, ${col} 16%, transparent)`, lineHeight: '15px' }} aria-label={`${tfWord(tf)} timeframe`}>{tf}</span>
      {showStage ? <span style={{ fontWeight: 600, color: isReturned(t) ? C.amber : C.dim }} data-stage={isReturned(t) ? 'returned' : t.s}>{stageWord(t)}</span> : null}
      {vq ? <span title="Volume not confirmed" aria-label="volume not confirmed" style={{ opacity: 0.85 }}>v?</span> : null}
    </span>
  );
}

/** zzz1004 — the latest-condition badges beside a W / M breakout ("latest quote back below pivot", "marginal clearance", "extended
 *  beyond entry window") and the session badge ("provisional (session open, observed 14:46 UTC)" / "completed close 2026-10-09"). */
export function ConditionBadges({ items, compact = false }: { items: ReadonlyArray<{ id: string; label: string; tip: string }>; compact?: boolean }) {
  if (!items.length) return null;
  // zzz1011 — compact (the table): the glyph only, the words in the tooltip / aria-label (the detail panel shows them in full)
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: compact ? 'nowrap' : 'wrap' }}>
      {items.map((c) => <span key={c.id} className="pnx-badge" data-cond={c.id} title={`${c.label}: ${c.tip}`} aria-label={compact ? c.label : undefined} style={{ color: c.id === 'marginal' ? C.dim : C.amber, ...(compact ? { padding: '0 5px' } : {}) }}>{c.id === 'back-through' ? '↩' : c.id === 'extended' ? '↗' : '≈'}{compact ? '' : ` ${c.label}`}</span>)}
    </span>
  );
}
export function SessionBadge({ text, provisional }: { text: string; provisional: boolean }) {
  return <span className="pnx-badge" data-session={provisional ? 'provisional' : 'completed'} style={{ color: provisional ? C.amber : C.dim }} title={provisional ? 'Read with an unfinished session: the bar can still change; not a completed close' : 'Read from completed bars'}>{provisional ? '◷ ' : '✓ '}{text}</span>;
}

/** Shape score as a short bar + the number (0–100; possible ≥ 35, likely ≥ 55, very likely ≥ 75). */
export function ScoreBar({ c }: { c: number }) {
  const col = c >= 75 ? C.green : c >= 55 ? C.accent : C.faint;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }} title={`${likelihoodWord(c)} — shape score ${c}/100 (not a probability)`}>
      <span aria-hidden style={{ width: 30, height: 4, borderRadius: 2, background: 'var(--pnx-track, color-mix(in srgb, var(--mc-text-3, #6b7280) 18%, transparent))', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${Math.max(4, Math.min(100, c))}%`, height: '100%', background: col }} />
      </span>
      <b style={{ minWidth: 20, textAlign: 'right', fontWeight: 650 }}>{c}</b>
    </span>
  );
}

/** "+3.1  −2.0  +12.4" — the close against its 21, 50 and 200-day averages (same daily bars). */
export function MaCell({ ma, market }: { ma: MaPosition; market: ScreenMarket }) {
  // zzz1008 (BVN) — one documented close: the DAILY TECHNICAL close (its own date and session), never the pattern's analysis close
  const tip = ma.close == null ? 'No close stored'
    : `${ma.basis === 'scan' ? 'Daily technical close' : 'Latest quote (no daily technical close stored)'} ${fmtPrice(ma.close, market)}${ma.at ? ` · ${ma.at}` : ''}${ma.session === 'provisional' ? ' (session open — provisional, the unfinished bar)' : ma.basis === 'scan' ? ' (completed session)' : ''} against its 21 / 50 / 200-day simple moving averages, worked out from the same daily bars:\n21-day ${pct(ma.d21)} · 50-day ${pct(ma.d50)} · 200-day ${pct(ma.d200)}\n(The pattern's own analysis close is shown apart.)`;
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
      {label}<span className="pnx-sort" aria-hidden>{on ? (sort.dir === -1 ? '▼' : '▲') : '↕'}</span>
    </button>
  );
  return bare ? b : <th className={className} style={{ textAlign: num ? 'right' : 'left' }} title={title} aria-sort={on ? (sort.dir === -1 ? 'descending' : 'ascending') : undefined}>{b}</th>;
}

// ── zzz1011 — the terminal pieces ─────────────────────────────────────────────────────────────────────────────────────────
/** The latest CONDITION of a reading (forming / crossed / holding / retesting / back inside / invalidated / expired), with the
 *  historical event in its tooltip — the two are never merged into one word. */
export function ConditionChip({ c }: { c: ConditionState }) {
  return <span className="pnx-cond" data-tone={c.tone} data-state={c.id} data-quote-back={c.quoteBack ? true : undefined} title={`${c.label}: ${c.tip}\nEvent: ${c.event.label}`}>{c.label}</span>;
}

/** 12-month price path drawn from the stored performance figures (−12M, −6M, −3M, −1M, −1W, now) — no extra download. */
export function Sparkline({ pts, w = 64, h = 20 }: { pts: Array<{ at: string; v: number }> | null; w?: number; h?: number }) {
  if (!pts) return <span className="pnx-dim" title="Not enough performance figures to draw the 12-month path">—</span>;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xOf = (i: number) => 1.5 + (i / (pts.length - 1)) * (w - 3), yOf = (v: number) => 2 + (1 - (v - lo) / span) * (h - 4);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(p.v).toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1].v >= pts[0].v;
  const col = up ? C.green : C.red;
  const tip = `Price path from the stored performance figures (now = 100):\n${pts.map((p) => `${p.at}: ${(100 * p.v).toFixed(0)}`).join(' · ')}\nA guide to the trend, not a chart: points are the performance periods only.`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`12-month path ${up ? 'up' : 'down'}`} style={{ display: 'block' }}>
      <title>{tip}</title>
      <path d={`${d} L${xOf(pts.length - 1).toFixed(1)} ${h} L1.5 ${h} Z`} fill={col} opacity={0.09} />
      <path d={d} fill="none" stroke={col} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xOf(pts.length - 1)} cy={yOf(1)} r={1.9} fill={col} />
    </svg>
  );
}

/** Where the ANALYSIS close sits against the pivot (filled dot), with the LATEST QUOTE apart (ring) when it differs. Track −15% … +10%
 *  in the pattern's direction; the shaded band is the 0 … +5% entry window, the tick is the pivot itself. */
export const GAUGE_LO = -15, GAUGE_HI = 10;
export function PivotGauge({ dd, dq, w = 58 }: { dd: number | null; dq: number | null; w?: number }) {
  if (dd == null) return null;
  const x = (v: number) => 2 + ((Math.max(GAUGE_LO, Math.min(GAUGE_HI, v)) - GAUGE_LO) / (GAUGE_HI - GAUGE_LO)) * (w - 4);
  const col = dd >= 0 ? C.green : C.text1;
  return (
    <svg width={w} height={12} viewBox={`0 0 ${w} 12`} aria-hidden style={{ display: 'block' }}>
      <rect x={2} y={5} width={w - 4} height={2} rx={1} fill="var(--pnx-track)" />
      <rect x={x(0)} y={3} width={x(5) - x(0)} height={6} rx={1} fill="var(--pnx-window)" />
      <line x1={x(0)} y1={1} x2={x(0)} y2={11} stroke="var(--mc-text-3)" strokeWidth={1} />
      {dq != null && Math.abs(dq - dd) >= 0.15 ? <circle cx={x(dq)} cy={6} r={2.6} fill="var(--mc-bg-0)" stroke="var(--mc-warn)" strokeWidth={1.3} /> : null}
      <circle cx={x(dd)} cy={6} r={3} fill={col} />
    </svg>
  );
}

export const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="pnx-kbd">{children}</kbd>;

export const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['/', 'Focus the search box'], ['j', 'Next row'], ['k', 'Previous row'], ['Enter', 'Open the chart of the row'],
  ['o', 'Open or close the row detail'], ['x', 'Select or unselect the row'], ['?', 'Show or hide these shortcuts'], ['Esc', 'Close this panel / leave the search box'],
];
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="pnx-help-back" role="presentation" onClick={onClose}>
      <div className="pnx-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2>Keyboard shortcuts</h2><span style={{ flex: 1 }} /><button type="button" className="pnx-btn" onClick={onClose} autoFocus>Close</button></div>
        <dl>{SHORTCUTS.map(([k, t]) => <React.Fragment key={k}><dt><Kbd>{k}</Kbd></dt><dd>{t}</dd></React.Fragment>)}</dl>
        <div className="pnx-note">Shortcuts pause while you type in a box.</div>
      </div>
    </div>
  );
}

/** Eligible → evaluated → matched, and what could not be evaluated, for the current screen and company list. */
export function FunnelStrip({ f, rebuilding }: { f: Funnel; rebuilding: boolean }) {
  const n = (v: number) => v.toLocaleString('en-US');
  return (
    <div className="pnx-funnel" data-testid="funnel" role="group" aria-label="Screen counts">
      <div title="Companies of the current list found in this market's data (every company when no list is chosen)"><b data-funnel="eligible">{n(f.eligible)}</b><span>eligible</span></div>
      <div title="Eligible companies whose selected timeframes could be read (ANY: at least one; ALL: every one)"><b data-funnel="evaluated">{n(f.evaluated)}</b><span>evaluated</span></div>
      <div title="Strict matches: every choice evaluated and passed"><b data-funnel="matched" style={{ color: f.matched ? C.accent : C.text }}>{rebuilding ? '…' : n(f.matched)}</b><span>matched{rebuilding ? ' (rebuilding)' : ''}</span></div>
      <div title="Not evaluated: a selected timeframe not readable (not scanned, too little history, rejected data, rebuilding) or not in the data — never counted as a non-match"><b data-funnel="unavailable" style={{ color: f.unavailable ? C.amber : C.text }}>{n(f.unavailable)}</b><span>unavailable{f.notInData ? ` · ${n(f.notInData)} not in data` : ''}</span></div>
      {f.provisional ? <div title="Passed every rule that could be checked; a rule could not be evaluated — not counted"><b data-funnel="provisional" style={{ color: C.amber }}>{n(f.provisional)}</b><span>provisional</span></div> : null}
    </div>
  );
}

export function SkeletonRows({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, k) => (
        <tr key={`sk-${k}`} aria-hidden data-skeleton>
          <td className="pnx-pin"><span style={{ display: 'grid', gap: 5 }}><span className="pnx-skel" style={{ width: 64 }} /><span className="pnx-skel" style={{ width: 120, height: 7, opacity: 0.7 }} /></span></td>
          {Array.from({ length: Math.max(1, cols - 1) }, (_, c) => <td key={c}><span className="pnx-skel" style={{ width: `${[70, 44, 52, 40, 36, 48, 56, 60][c % 8]}%`, marginLeft: c ? 'auto' : 0 }} /></td>)}
        </tr>
      ))}
    </>
  );
}

export function SearchBox({ value, onChange, inputRef, placeholder, label }: { value: string; onChange: (v: string) => void; inputRef?: React.Ref<HTMLInputElement>; placeholder: string; label: string }) {
  return (
    <span className="pnx-search">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11 L14.5 14.5" strokeLinecap="round" /></svg>
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className="pnx-in" style={{ width: 220 }} />
      {value ? null : <Kbd>/</Kbd>}
    </span>
  );
}
