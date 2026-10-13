'use client';
// zzz1006 — the Stock Screener's visual language (shared by its sub-panels).
// zzz1012 — premium pass: its own token set for both themes (white default, dark), IBM Plex Sans with tabular figures, a results frame
// (toolbar · readout · table) with sticky header + median row + pinned company column, zebra/hover rows, sort arrows, skeleton rows,
// empty states, the company drawer, the shortcut card; motion only on open/close and off under prefers-reduced-motion.
import { useEffect, useRef, useState } from 'react';

export const SCREENER_CSS = `
/* ── tokens: white (default) ─────────────────────────────────────────────────────────────────────────────────────── */
.mcss { --ss-canvas: #ffffff; --ss-sunk: #f5f6f8; --ss-raise: #ffffff; --ss-zebra: #f9fafb; --ss-hover: #f0f3f9;
  --ss-rule: #e4e7ec; --ss-rule-2: #cdd3db; --ss-ink: #101828; --ss-ink-2: #3d4757; --ss-ink-3: #6b7587; --ss-ink-4: #98a1b0;
  --ss-accent: #2448d8; --ss-accent-ink: #1d3bb3; --ss-tint: #eef2ff; --ss-tint-2: #e0e7ff;
  --ss-up: #0a7d4f; --ss-down: #c2372b; --ss-warn: #9a5800; --ss-warn-tint: #fff7e8; --ss-down-tint: #fdf0ee;
  --ss-shadow: 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -8px rgba(16,24,40,.18); --ss-ring: 0 0 0 3px rgba(36,72,216,.22);
  --ss-font: 'IBM Plex Sans', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --ss-ease: cubic-bezier(.2,.7,.2,1); --ss-hdr: 36px;
  font-family: var(--ss-font); font-size: 13px; line-height: 1.4; color: var(--ss-ink); background: var(--ss-canvas);
  -webkit-font-smoothing: antialiased; font-feature-settings: "kern" 1; overflow-x: clip; }
/* ── tokens: dark ────────────────────────────────────────────────────────────────────────────────────────────────── */
.mcss.mc-workspace-dark { --ss-canvas: #0c1018; --ss-sunk: #121823; --ss-raise: #151c28; --ss-zebra: #0f141d; --ss-hover: #18202e;
  --ss-rule: #1f2735; --ss-rule-2: #2c3647; --ss-ink: #e9eef6; --ss-ink-2: #b4bdcc; --ss-ink-3: #808b9d; --ss-ink-4: #5d6779;
  --ss-accent: #7c93ff; --ss-accent-ink: #9fb0ff; --ss-tint: rgba(124,147,255,.11); --ss-tint-2: rgba(124,147,255,.2);
  --ss-up: #3ccb8f; --ss-down: #f26b5e; --ss-warn: #e5a843; --ss-warn-tint: rgba(229,168,67,.09); --ss-down-tint: rgba(242,107,94,.09);
  --ss-shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 40px -10px rgba(0,0,0,.65); --ss-ring: 0 0 0 3px rgba(124,147,255,.3); }
.mcss *, .mcss *::before, .mcss *::after { box-sizing: border-box; }
.mcss button, .mcss input, .mcss select { font-family: inherit; }
.mcss ::selection { background: var(--ss-tint-2); }

/* ── layout primitives ───────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mcss-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--ss-rule); }
.mcss-title { font-size: 20px; font-weight: 600; color: var(--ss-ink); letter-spacing: -0.02em; margin: 0 6px 0 0; line-height: 1; }
.mcss-dim { color: var(--ss-ink-3); }
.mcss-num { font-variant-numeric: tabular-nums; }

/* ── buttons, segments, inputs ───────────────────────────────────────────────────────────────────────────────────── */
.mcss-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--ss-rule-2);
  background: var(--ss-raise); color: var(--ss-ink-2); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; text-decoration: none;
  transition: background-color .12s, border-color .12s, color .12s; }
.mcss-btn:hover { border-color: var(--ss-ink-4); color: var(--ss-ink); background: var(--ss-sunk); }
.mcss-btn.primary { background: var(--ss-accent); border-color: var(--ss-accent); color: #fff; font-weight: 600; }
.mcss.mc-workspace-dark .mcss-btn.primary { color: #0c1018; }
.mcss-btn.primary:hover { background: var(--ss-accent-ink); border-color: var(--ss-accent-ink); color: #fff; }
.mcss.mc-workspace-dark .mcss-btn.primary:hover { color: #0c1018; }
.mcss-btn.ghost { border-color: transparent; background: transparent; }
.mcss-btn.ghost:hover { background: var(--ss-sunk); }
.mcss-btn.sm { height: 26px; padding: 0 9px; font-size: 12px; border-radius: 5px; }
.mcss-btn[aria-expanded="true"] { border-color: var(--ss-accent); color: var(--ss-accent); background: var(--ss-tint); }
.mcss-btn:disabled { opacity: 0.45; cursor: default; }
.mcss :is(.mcss-btn, .mcss-chip button, .mcss-seg button, .mcss-item, .mcss-link, .mcss-badge, .mcss-th, .mcss-name, .co, input[type="checkbox"]):focus-visible
  { outline: none; box-shadow: var(--ss-ring); border-radius: 5px; }
.mcss-seg { display: inline-flex; border: 1px solid var(--ss-rule-2); border-radius: 6px; overflow: hidden; height: 32px; background: var(--ss-raise); }
.mcss-seg.sm { height: 26px; }
.mcss-seg button { border: none; background: transparent; color: var(--ss-ink-3); font-size: 13px; font-weight: 500; padding: 0 12px; cursor: pointer; transition: background-color .12s, color .12s; }
.mcss-seg.sm button { font-size: 12px; padding: 0 9px; }
.mcss-seg button + button { border-left: 1px solid var(--ss-rule-2); }
.mcss-seg button:hover { color: var(--ss-ink); }
.mcss-seg button[aria-pressed="true"], .mcss-seg button[aria-checked="true"] { background: var(--ss-tint); color: var(--ss-accent); font-weight: 600; }
.mcss-input { height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ss-rule-2); background: var(--ss-raise); color: var(--ss-ink); font-size: 13px; min-width: 0;
  transition: border-color .12s, box-shadow .12s; }
.mcss-input::placeholder { color: var(--ss-ink-4); }
.mcss-input:focus { outline: none; border-color: var(--ss-accent); box-shadow: var(--ss-ring); }
.mcss-search { position: relative; display: inline-flex; align-items: center; }
.mcss-search .mcss-input { padding-left: 30px; padding-right: 28px; width: 220px; }
.mcss-search svg { position: absolute; left: 10px; color: var(--ss-ink-4); pointer-events: none; }
.mcss-search kbd { position: absolute; right: 7px; }
.mcss kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 4px;
  border: 1px solid var(--ss-rule-2); border-bottom-width: 2px; background: var(--ss-sunk); color: var(--ss-ink-3); font: 500 11px/1 var(--ss-font); }
.mcss-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--ss-ink-2); user-select: none; }
.mcss-check input { accent-color: var(--ss-accent); width: 14px; height: 14px; margin: 0; }
.mcss-check.on { color: var(--ss-accent); }
.mcss input[type="checkbox"] { accent-color: var(--ss-accent); }

/* ── filter chips ───────────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mcss-chip { display: inline-flex; align-items: stretch; min-height: 30px; max-width: 100%; border-radius: 6px; border: 1px solid var(--ss-rule-2); background: var(--ss-raise);
  color: var(--ss-ink); font-size: 12.5px; overflow: hidden; transition: border-color .12s, background-color .12s, box-shadow .12s; }
.mcss-chip:hover { border-color: var(--ss-ink-4); }
.mcss-chip button { all: unset; cursor: pointer; display: inline-flex; align-items: center; padding: 4px 10px; line-height: 1.3; box-sizing: border-box; }
.mcss-chip .lab { min-width: 0; }
.mcss-chip .lab .f { color: var(--ss-ink-2); }
.mcss-chip .lab .c { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ss-ink); }
.mcss-chip .pass { margin-left: 8px; padding-left: 8px; border-left: 1px solid var(--ss-rule); color: var(--ss-ink-3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.mcss-chip .ic { padding: 0 8px; color: var(--ss-ink-4); border-left: 1px solid var(--ss-rule); font-size: 11px; }
.mcss-chip .ic:hover { color: var(--ss-ink); background: var(--ss-sunk); }
.mcss-chip.editing { border-color: var(--ss-accent); box-shadow: var(--ss-ring); }
.mcss-chip.editing .lab .f, .mcss-chip.editing .lab .c { color: var(--ss-accent); }
.mcss-chip.paused { border-style: dashed; background: var(--ss-sunk); }
.mcss-chip.paused .lab { text-decoration: line-through; text-decoration-color: var(--ss-ink-4); }
.mcss-chip.paused .lab .f, .mcss-chip.paused .lab .c { color: var(--ss-ink-4); }
.mcss-chip.blocking { border-color: color-mix(in srgb, var(--ss-down) 55%, var(--ss-rule-2)); }
.mcss-chip .tag { margin-left: 7px; font-size: 10.5px; font-weight: 600; padding: 0 5px; border-radius: 4px; line-height: 17px; }
.mcss-chip .tag.paused { background: var(--ss-raise); color: var(--ss-ink-3); border: 1px solid var(--ss-rule-2); text-decoration: none; }
.mcss-chip .tag.zero { color: var(--ss-down); background: var(--ss-down-tint); }
.mcss-chip .tag.fill { color: var(--ss-warn); }
.mcss-add { border-style: dashed; color: var(--ss-accent); background: transparent; }
.mcss-add:hover { background: var(--ss-tint); border-color: var(--ss-accent); }
.mcss-editor { animation: mcss-drop .16s var(--ss-ease); }
.mcss-editor > div { border-radius: 8px !important; border-color: var(--ss-rule-2) !important; background: var(--ss-sunk) !important; padding: 12px 14px !important; }
.mcss-editor :is(select, input[type="number"], input[type="text"], button) { height: 30px; border-radius: 6px !important; border: 1px solid var(--ss-rule-2) !important; background: var(--ss-raise) !important;
  color: var(--ss-ink) !important; padding: 0 9px !important; font-size: 13px; }
.mcss-editor button { font-weight: 500; }
.mcss-editor button:hover { border-color: var(--ss-ink-4) !important; }

/* ── popovers & menus ──────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-pop { position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; min-width: 240px; max-height: min(70vh, 560px); overflow: auto; padding: 6px;
  border-radius: 10px; border: 1px solid var(--ss-rule-2); background: var(--ss-raise); color: var(--ss-ink-2); box-shadow: var(--ss-shadow);
  animation: mcss-drop .14s var(--ss-ease); transform-origin: top left; }
.mcss-pop.right { left: auto; right: 0; transform-origin: top right; }
.mcss-grp { padding: 9px 8px 4px; font-size: 11.5px; font-weight: 600; color: var(--ss-ink-3); }
.mcss-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 8px; border: none; background: none; border-radius: 6px;
  color: var(--ss-ink); font-size: 13px; cursor: pointer; text-decoration: none; }
.mcss-item:hover, .mcss-item:focus-visible, .mcss-item.cur { background: var(--ss-hover); }
.mcss-item[aria-checked="true"], .mcss-item[aria-selected="true"] { color: var(--ss-accent); font-weight: 600; }
.mcss-item:disabled { opacity: 0.45; cursor: default; }
.mcss-item .end { white-space: nowrap; flex-shrink: 0; margin-left: auto; color: var(--ss-ink-3); font-size: 11.5px; font-weight: 400; font-variant-numeric: tabular-nums; }
.mcss-sep { height: 1px; background: var(--ss-rule); margin: 5px 2px; }
.mcss-mk { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; padding: 0 5px; border-radius: 4px; font-size: 10.5px; font-weight: 600;
  line-height: 17px; letter-spacing: .02em; color: var(--ss-ink-2); background: var(--ss-sunk); border: 1px solid var(--ss-rule); }

/* ── status + notes ───────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--ss-ink-3); }
.mcss-status .dot { width: 3px; height: 3px; border-radius: 3px; background: var(--ss-ink-4); }
.mcss-status .live { display: inline-flex; align-items: center; gap: 6px; }
.mcss-status .live::before { content: ''; width: 7px; height: 7px; border-radius: 7px; background: var(--ss-up); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ss-up) 18%, transparent); }
.mcss-status .live.old::before { background: var(--ss-warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ss-warn) 18%, transparent); }
.mcss-link { all: unset; cursor: pointer; color: var(--ss-accent); font-weight: 500; }
.mcss-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.mcss-warn { font-size: 12.5px; color: var(--ss-warn); display: flex; gap: 6px; align-items: baseline; }
.mcss-note { font-size: 12.5px; padding: 10px 12px; border-radius: 8px; background: var(--ss-sunk); border: 1px solid var(--ss-rule); color: var(--ss-ink-2); }
.mcss-panel { border: 1px solid var(--ss-rule-2); border-radius: 10px; padding: 12px 14px; background: var(--ss-raise); }

/* ── results frame: toolbar, readout, table ───────────────────────────────────────────────────────────────────── */
.mcss-frame { border: 1px solid var(--ss-rule-2); border-radius: 10px; background: var(--ss-canvas); overflow: hidden; }
.mcss-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; background: var(--ss-canvas); }
.mcss-count { display: inline-flex; align-items: baseline; gap: 0; font-size: 13px; font-weight: 500; color: var(--ss-ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mcss-count .n { font-size: 22px; font-weight: 600; color: var(--ss-ink); letter-spacing: -0.02em; margin-right: 6px; line-height: 1; }
.mcss-readout { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 7px 12px; border-top: 1px solid var(--ss-rule); background: var(--ss-sunk);
  font-size: 12px; color: var(--ss-ink-3); font-variant-numeric: tabular-nums; }
.mcss-readout b { color: var(--ss-ink); font-weight: 600; }
.mcss-breadth { display: inline-flex; align-items: center; gap: 8px; }
.mcss-breadth .bar { display: inline-flex; width: 96px; height: 6px; border-radius: 6px; overflow: hidden; background: var(--ss-rule); }
.mcss-breadth .bar i { display: block; height: 100%; }
.mcss-sel { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 12px; border-top: 1px solid var(--ss-accent);
  background: var(--ss-tint); color: var(--ss-ink); font-size: 13px; animation: mcss-drop .14s var(--ss-ease); }
.mcss-tablewrap { overflow: auto; max-height: 76vh; border-top: 1px solid var(--ss-rule-2); background: var(--ss-canvas); overscroll-behavior: contain; }
.mcss-table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.mcss-table th { position: sticky; top: 0; z-index: 3; height: var(--ss-hdr); background: var(--ss-sunk); text-align: left; padding: 0 12px; font-size: 12px; font-weight: 600;
  color: var(--ss-ink-2); white-space: nowrap; border-bottom: 1px solid var(--ss-rule-2); vertical-align: middle; }
.mcss-table th .u { margin-left: 4px; font-weight: 400; color: var(--ss-ink-4); }
.mcss-table tr.med th { top: var(--ss-hdr); height: 26px; z-index: 3; background: var(--ss-canvas); font-weight: 500; font-size: 11.5px; color: var(--ss-accent-ink);
  border-bottom: 1px solid var(--ss-rule-2); font-style: italic; }
.mcss.mc-workspace-dark .mcss-table tr.med th { background: var(--ss-raise); }
.mcss-table tr.med th.pin { font-style: normal; color: var(--ss-ink-3); font-weight: 500; }
.mcss-table th.num, .mcss-table td.num { text-align: right; }
.mcss-th { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; border-radius: 4px; }
.mcss-th.num { flex-direction: row-reverse; }
.mcss-th .ar { display: inline-block; width: 9px; color: var(--ss-ink-4); opacity: 0; transition: opacity .12s; font-size: 10px; }
.mcss-th:hover { color: var(--ss-ink); }
.mcss-th:hover .ar { opacity: 1; }
th[aria-sort] .mcss-th, .mcss-th.on { color: var(--ss-accent); }
th[aria-sort] .mcss-th .ar, .mcss-th.on .ar { opacity: 1; color: var(--ss-accent); }
.mcss-table td { padding: 0 12px; height: 40px; border-bottom: 1px solid var(--ss-rule); vertical-align: middle; color: var(--ss-ink); background: var(--ss-canvas); transition: background-color .08s; }
.mcss-table.compact td { height: 30px; }
.mcss-table tbody tr:nth-child(even) td { background: var(--ss-zebra); }
.mcss-table tbody tr:hover td { background: var(--ss-hover); }
.mcss-table tbody tr.sel td { background: var(--ss-tint); }
.mcss-table tbody tr.cur td.pin { box-shadow: inset 3px 0 0 var(--ss-accent), 1px 0 0 var(--ss-rule-2); }
.mcss-table tbody tr.cur td { background: var(--ss-hover); }
.mcss-table tbody tr.open td { background: var(--ss-tint); }
.mcss-table .pin { position: sticky; left: 0; z-index: 1; box-shadow: 1px 0 0 var(--ss-rule-2); }
.mcss-table th.pin { z-index: 5; }
.mcss-table td.num { font-size: 13px; letter-spacing: -0.005em; }
.mcss-table .up { color: var(--ss-up); }
.mcss-table .down { color: var(--ss-down); }
.mcss-table .na { color: var(--ss-ink-4); font-style: italic; }
.mcss-table .nil { color: var(--ss-ink-4); }
.mcss-table .cell-co { flex-wrap: nowrap !important; }
.mcss-table .rk { font-size: 11px; color: var(--ss-ink-4); min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
.mcss-table .co { font-weight: 600; color: var(--ss-ink); text-decoration: none; letter-spacing: .01em; }
.mcss-table .co:hover { color: var(--ss-accent); text-decoration: underline; text-underline-offset: 2px; }
.mcss-table .sec { font-size: 12px; color: var(--ss-ink-3); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcss-table .qtr { font-size: 12px; color: var(--ss-ink-3); white-space: nowrap; }
.mcss-name { all: unset; cursor: pointer; color: var(--ss-ink-3); font-size: 12px; display: block; max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mcss-name:hover { color: var(--ss-ink); text-decoration: underline; text-underline-offset: 2px; }
.mcss-name.inline { display: inline-block; max-width: 170px; vertical-align: bottom; margin-left: 7px; }
.mcss-pat { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.mcss-pat.u { color: var(--ss-up); background: color-mix(in srgb, var(--ss-up) 10%, transparent); }
.mcss-pat.d { color: var(--ss-down); background: var(--ss-down-tint); }
.mcss-pat .s { font-weight: 400; opacity: .8; }
.mcss-more { padding: 10px; text-align: center; border-top: 1px solid var(--ss-rule); background: var(--ss-sunk); }

/* ── review badge ─────────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-badge { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; height: 21px; padding: 0 8px; border-radius: 4px; font-size: 11.5px; font-weight: 500;
  white-space: nowrap; border: 1px solid var(--ss-rule-2); color: var(--ss-ink-3); background: var(--ss-raise); }
.mcss-badge:hover { border-color: var(--ss-ink-4); color: var(--ss-ink); }
.mcss-badge.chart { border-color: color-mix(in srgb, var(--ss-accent) 45%, transparent); color: var(--ss-accent); background: var(--ss-tint); }
.mcss-badge.filings { border-color: var(--ss-accent); color: #fff; background: var(--ss-accent); }
.mcss.mc-workspace-dark .mcss-badge.filings { color: #0c1018; }
.mcss-badge.parked { border-style: dashed; color: var(--ss-ink-4); background: transparent; }
.mcss-badge.unreviewed { border-color: transparent; background: transparent; color: var(--ss-ink-4); }
.mcss-table tr:hover .mcss-badge.unreviewed, .mcss-badge.unreviewed[aria-expanded="true"], .mcss-badge.unreviewed:focus-visible { border-color: var(--ss-rule-2); background: var(--ss-raise); color: var(--ss-ink-2); }

/* ── skeleton + empty states ─────────────────────────────────────────────────────────────────────────────────── */
.mcss-skel { display: block; height: 10px; border-radius: 3px; background: linear-gradient(90deg, var(--ss-rule) 0%, var(--ss-sunk) 50%, var(--ss-rule) 100%);
  background-size: 200% 100%; animation: mcss-shimmer 1.3s linear infinite; }
.mcss-empty { display: grid; justify-items: start; gap: 8px; padding: 28px 24px 30px; max-width: 640px; }
.mcss-empty h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--ss-ink); letter-spacing: -0.01em; }
.mcss-empty p { margin: 0; font-size: 13px; color: var(--ss-ink-3); line-height: 1.5; }
.mcss-empty .acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }

/* ── company drawer ──────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-drawer { position: fixed; z-index: 80; top: 64px; right: 12px; bottom: 12px; width: min(420px, calc(100vw - 24px)); display: flex; flex-direction: column;
  border-radius: 12px; border: 1px solid var(--ss-rule-2); background: var(--ss-raise); color: var(--ss-ink-2); box-shadow: var(--ss-shadow);
  animation: mcss-slide .2s var(--ss-ease); font-family: var(--ss-font); }
.mcss-drawer .hd { padding: 16px 18px 14px; border-bottom: 1px solid var(--ss-rule); }
.mcss-drawer .tk { font-size: 22px; font-weight: 600; color: var(--ss-ink); letter-spacing: -0.02em; line-height: 1.1; }
.mcss-drawer .bd { overflow: auto; padding: 4px 18px 18px; flex: 1; }
.mcss-facts { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0; margin: 14px 0 4px; border: 1px solid var(--ss-rule); border-radius: 8px; overflow: hidden; }
.mcss-facts > div { padding: 9px 11px; }
.mcss-facts > div + div { border-left: 1px solid var(--ss-rule); }
.mcss-facts .k { font-size: 11.5px; color: var(--ss-ink-3); }
.mcss-facts .v { font-size: 15px; font-weight: 600; color: var(--ss-ink); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.mcss-kv { display: grid; grid-template-columns: minmax(0,1fr) auto; font-size: 12.5px; }
.mcss-kv > span { padding: 5px 0; border-bottom: 1px dotted var(--ss-rule); }
.mcss-kv .v { text-align: right; font-variant-numeric: tabular-nums; color: var(--ss-ink); font-weight: 500; }
.mcss-h4 { margin: 18px 0 6px; font-size: 12px; font-weight: 600; color: var(--ss-ink); }
.mcss-checks { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 12.5px; }
.mcss-checks li { display: grid; grid-template-columns: 18px minmax(0,1fr); gap: 2px; }
.mcss-checks .ok { color: var(--ss-up); } .mcss-checks .no { color: var(--ss-down); }

/* ── help overlay ─────────────────────────────────────────────────────────────────────────────────────────────── */
.mcss-help { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: rgba(12,16,24,.32); animation: mcss-fade .14s ease-out; padding: 16px; }
.mcss-help .card { width: min(460px, 100%); background: var(--ss-raise); color: var(--ss-ink-2); border: 1px solid var(--ss-rule-2); border-radius: 12px; box-shadow: var(--ss-shadow);
  padding: 18px 20px; animation: mcss-drop .16s var(--ss-ease); }
.mcss-help h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; color: var(--ss-ink); }
.mcss-help dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; margin: 0; align-items: center; font-size: 13px; }
.mcss-help dt { display: flex; gap: 4px; justify-content: flex-end; }
.mcss-help dd { margin: 0; }

/* ── motion ──────────────────────────────────────────────────────────────────────────────────────────────────── */
@keyframes mcss-drop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes mcss-slide { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@keyframes mcss-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mcss-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .mcss *, .mcss *::before, .mcss *::after { animation: none !important; transition: none !important; }
}

/* ── responsive ──────────────────────────────────────────────────────────────────────────────────────────────── */
@media (max-width: 1100px) { .mcss-search .mcss-input { width: 180px; } }
@media (max-width: 760px) {
  .mcss-hide-sm { display: none !important; }
  .mcss-title { font-size: 18px; }
  .mcss-top { gap: 8px; }
  .mcss-top .mcss-title { order: 0; flex: 1 1 auto; }
  .mcss-top .thm { order: 1; }
  .mcss-top .sp { display: none; }
  .mcss-top .pick { order: 2; flex: 1 1 100%; min-width: 0; }
  .mcss-top > .mcss-seg { order: 3; }
  .mcss-top .pick > div, .mcss-top .pick .mcss-btn { width: 100%; max-width: none !important; }
  .mcss-top > .mcss-btn, .mcss-top > div { order: 4; }
  .mcss-top > .mcss-seg + .pick + .mcss-btn { margin-left: auto; }
  .mcss-table .rk { display: none; }
  .mcss-table .mcss-name, .mcss-table .mcss-th { min-height: 24px !important; display: flex; align-items: center; }
  .mcss-seg, .mcss-seg.sm { height: auto; min-height: 32px; flex-wrap: wrap; }
  .mcss-drawer .mcss-seg button { flex: 1 1 auto; }
  .mcss-top > [role="status"] { order: 5; flex-basis: 100%; }
  .mcss-chip { min-height: 28px; font-size: 12px; }
  .mcss-chip button { padding: 3px 8px; }
  .mcss-status { gap: 6px 8px; }
  .mcss-toolbar { gap: 6px; padding: 10px; }
  .mcss-toolbar .grow { flex-basis: 100%; height: 0; }
  .mcss-search { flex: 1 1 100%; order: 10; }
  .mcss-search .mcss-input { width: 100%; }
  .mcss-search kbd { display: none; }
  .mcss-readout { gap: 6px 14px; }
  .mcss-table td, .mcss-table th { padding: 0 9px; }
  .mcss-name { max-width: 140px; }
  .mcss-drawer { top: auto; height: 82vh; left: 0; right: 0; bottom: 0; width: auto; border-radius: 14px 14px 0 0; animation-name: mcss-rise; }
  .mcss-facts .v { font-size: 14px; }
}
@keyframes mcss-rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
`;

/** A popover that closes on a click outside it or on Escape (focus goes back to the trigger). */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('pointerdown', down); window.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [open]);
  return { open, setOpen, ref };
}

/** ↑ / ↓ move focus between the items of a menu or list (Home / End to the ends). */
export function listKeys(e: React.KeyboardEvent<HTMLElement>, selector = '.mcss-item') {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector)).filter((x) => !(x as HTMLButtonElement).disabled);
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
