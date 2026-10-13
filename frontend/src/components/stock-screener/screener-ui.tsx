'use client';
// zzz1006 — the Stock Screener's visual language (shared by its sub-panels): quiet bordered controls on white (dark through the
// workspace's --mc-* tokens), blue for selection and primary actions, green / red only for price direction, tabular numerals.
import { useEffect, useRef, useState } from 'react';

export const SCREENER_CSS = `
.mcss { --ss-tint: color-mix(in srgb, var(--mc-accent) 10%, var(--mc-bg-0)); --ss-up: var(--mc-bullish, #059669); --ss-down: var(--mc-bearish, #DC2626); --ss-warn: var(--mc-warn, #D97706);
  font-size: 13px; }
.mcss-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mcss-title { font-size: 17px; font-weight: 750; color: var(--mc-text-0); letter-spacing: -0.1px; margin-right: 2px; }
.mcss-btn { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 11px; border-radius: 7px; border: 1px solid var(--mc-border-1);
  background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; font-family: inherit; }
.mcss-btn:hover { border-color: var(--mc-border-2); background: var(--mc-bg-2); }
.mcss-btn.primary { background: var(--mc-accent); border-color: var(--mc-accent); color: #fff; }
.mcss-btn.primary:hover { background: var(--mc-accent-dark, var(--mc-accent)); }
.mcss-btn.ghost { border-color: transparent; background: transparent; }
.mcss-btn.ghost:hover { background: var(--mc-bg-2); }
.mcss-btn.sm { height: 26px; padding: 0 8px; font-size: 12px; }
.mcss-btn[aria-expanded="true"] { border-color: var(--mc-accent); color: var(--mc-accent); }
.mcss-btn:disabled { opacity: 0.45; cursor: default; }
.mcss-btn:focus-visible, .mcss-chip button:focus-visible, .mcss-seg button:focus-visible, .mcss-item:focus-visible, .mcss-link:focus-visible, .mcss-badge:focus-visible
  { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.mcss-seg { display: inline-flex; border: 1px solid var(--mc-border-1); border-radius: 7px; overflow: hidden; height: 30px; }
.mcss-seg.sm { height: 26px; }
.mcss-seg button { border: none; background: var(--mc-bg-0); color: var(--mc-text-3); font-size: 13px; font-weight: 600; padding: 0 11px; cursor: pointer; font-family: inherit; }
.mcss-seg.sm button { font-size: 12px; padding: 0 8px; }
.mcss-seg button + button { border-left: 1px solid var(--mc-border-1); }
.mcss-seg button[aria-pressed="true"], .mcss-seg button[aria-checked="true"] { background: var(--ss-tint); color: var(--mc-accent); }
.mcss-input { height: 30px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-0); font-size: 13px; font-family: inherit; min-width: 0; }
.mcss-input:focus { outline: 2px solid color-mix(in srgb, var(--mc-accent) 35%, transparent); border-color: var(--mc-accent); }
.mcss-dim { color: var(--mc-text-3); }
.mcss-chip { display: inline-flex; align-items: stretch; min-height: 28px; max-width: 100%; border-radius: 7px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0);
  color: var(--mc-text-1); font-size: 12.5px; overflow: hidden; }
.mcss-chip:hover { border-color: var(--mc-border-2); }
.mcss-chip button { all: unset; cursor: pointer; display: inline-flex; align-items: center; padding: 4px 9px; min-height: 0; line-height: 1.3; box-sizing: border-box; }
.mcss-chip .ic { padding: 0 7px; color: var(--mc-text-4); border-left: 1px solid var(--mc-border-3); font-size: 11px; }
.mcss-chip .ic:hover { color: var(--mc-text-0); background: var(--mc-bg-2); }
.mcss-chip.editing { border-color: var(--mc-accent); background: var(--ss-tint); color: var(--mc-accent); }
.mcss-chip.paused { border-style: dashed; border-color: var(--mc-border-2); background: var(--mc-bg-2); color: var(--mc-text-4); }
.mcss-chip.paused .lab { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--mc-text-4) 60%, transparent); }
.mcss-chip .tag { margin-left: 6px; font-size: 10.5px; font-weight: 650; padding: 0 5px; border-radius: 4px; line-height: 16px; }
.mcss-chip .tag.paused { background: var(--mc-bg-0); color: var(--mc-text-3); border: 1px solid var(--mc-border-1); text-decoration: none; }
.mcss-chip .tag.zero { color: var(--ss-down); border: 1px solid color-mix(in srgb, var(--ss-down) 40%, transparent); }
.mcss-chip .tag.fill { color: var(--ss-warn); }
.mcss-add { border-style: dashed; color: var(--mc-accent); }
.mcss-pop { position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; min-width: 240px; max-height: min(70vh, 560px); overflow: auto; padding: 6px;
  border-radius: 10px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-1); color: var(--mc-text-1); box-shadow: 0 14px 36px rgba(15,23,42,.18); }
.mcss-pop.right { left: auto; right: 0; }
.mcss-grp { padding: 8px 8px 3px; font-size: 11.5px; font-weight: 650; color: var(--mc-text-3); }
.mcss-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 8px; border: none; background: none; border-radius: 6px;
  color: var(--mc-text-1); font-size: 13px; cursor: pointer; font-family: inherit; text-decoration: none; box-sizing: border-box; }
.mcss-item:hover, .mcss-item:focus-visible, .mcss-item.cur { background: var(--mc-bg-2); }
.mcss-item[aria-checked="true"], .mcss-item[aria-selected="true"] { color: var(--mc-accent); font-weight: 650; }
.mcss-item:disabled { opacity: 0.45; cursor: default; }
.mcss-item .end { white-space: nowrap; flex-shrink: 0; margin-left: auto; color: var(--mc-text-3); font-size: 11.5px; font-weight: 400; font-variant-numeric: tabular-nums; }
.mcss-sep { height: 1px; background: var(--mc-border-3); margin: 5px 2px; }
.mcss-mk { display: inline-block; min-width: 22px; text-align: center; padding: 0 4px; border-radius: 4px; font-size: 10.5px; font-weight: 700; line-height: 16px;
  color: var(--mc-text-3); border: 1px solid var(--mc-border-1); }
.mcss-status { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; color: var(--mc-text-3); }
.mcss-status .dot { width: 3px; height: 3px; border-radius: 3px; background: var(--mc-border-2); }
.mcss-link { all: unset; cursor: pointer; color: var(--mc-accent); font-weight: 600; }
.mcss-link:hover { text-decoration: underline; }
.mcss-warn { font-size: 12.5px; color: var(--ss-warn); }
.mcss-note { font-size: 12.5px; padding: 8px 10px; border-radius: 8px; background: var(--mc-bg-2); border: 1px solid var(--mc-border-3); }
.mcss-panel { border: 1px solid var(--mc-border-1); border-radius: 10px; padding: 10px 12px; background: var(--mc-bg-0); }
.mcss-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--mc-border-1); border-bottom: none;
  border-radius: 10px 10px 0 0; background: var(--mc-bg-0); }
.mcss-count { font-size: 15px; font-weight: 750; color: var(--mc-text-0); font-variant-numeric: tabular-nums; }
.mcss-sel { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 10px; border: 1px solid var(--mc-accent); border-bottom: none;
  background: var(--ss-tint); color: var(--mc-text-1); font-size: 13px; }
.mcss-tablewrap { overflow: auto; max-height: 78vh; border: 1px solid var(--mc-border-1); border-radius: 0 0 10px 10px; background: var(--mc-bg-0); }
.mcss-table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.mcss-table th { position: sticky; top: 0; z-index: 3; background: var(--mc-bg-2); text-align: left; padding: 7px 9px; font-size: 12px; font-weight: 650;
  color: var(--mc-text-3); white-space: nowrap; border-bottom: 1px solid var(--mc-border-1); }
.mcss-table th.num, .mcss-table td.num { text-align: right; }
.mcss-table td { border-bottom: 1px solid var(--mc-border-3); vertical-align: middle; }
.mcss-table tbody tr:hover td { background: var(--mc-bg-2); }
.mcss-table tbody tr.sel td { background: var(--ss-tint); }
.mcss-table tbody tr.open td { box-shadow: inset 0 1px 0 var(--mc-accent), inset 0 -1px 0 var(--mc-accent); }
.mcss-table .pin { position: sticky; left: 0; z-index: 1; background: var(--mc-bg-0); box-shadow: 1px 0 0 var(--mc-border-1); }
.mcss-table th.pin { z-index: 4; background: var(--mc-bg-2); }
.mcss-table tbody tr:hover td.pin { background: var(--mc-bg-2); }
.mcss-table tbody tr.sel td.pin { background: var(--ss-tint); }
.mcss-table .co { font-weight: 700; color: var(--mc-accent); text-decoration: none; }
.mcss-table .co:hover { text-decoration: underline; }
.mcss-name { all: unset; cursor: pointer; color: var(--mc-text-3); font-size: 12px; display: block; max-width: 230px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mcss-name:hover { color: var(--mc-text-0); text-decoration: underline; }
.mcss-name.inline { display: inline-block; max-width: 160px; vertical-align: bottom; margin-left: 6px; }
.mcss-badge { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
  white-space: nowrap; border: 1px solid var(--mc-border-1); color: var(--mc-text-3); }
.mcss-badge.chart { border-color: color-mix(in srgb, var(--mc-accent) 45%, transparent); color: var(--mc-accent); background: var(--ss-tint); }
.mcss-badge.filings { border-color: var(--mc-accent); color: #fff; background: var(--mc-accent); }
.mcss-badge.parked { border-style: dashed; color: var(--mc-text-4); }
.mcss-drawer { position: fixed; z-index: 80; top: 64px; right: 12px; bottom: 12px; width: min(400px, calc(100vw - 24px)); display: flex; flex-direction: column;
  border-radius: 12px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-1); box-shadow: 0 18px 48px rgba(15,23,42,.22); }
.mcss-drawer .hd { padding: 12px 14px 10px; border-bottom: 1px solid var(--mc-border-3); }
.mcss-drawer .bd { overflow: auto; padding: 4px 14px 14px; flex: 1; }
.mcss-facts { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px 10px; padding: 10px 0; }
.mcss-facts .k { font-size: 11.5px; color: var(--mc-text-3); }
.mcss-facts .v { font-size: 14px; font-weight: 650; color: var(--mc-text-0); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcss-kv { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 3px 12px; font-size: 12.5px; }
.mcss-kv .v { text-align: right; font-variant-numeric: tabular-nums; color: var(--mc-text-0); }
.mcss-h4 { margin: 14px 0 6px; font-size: 12.5px; font-weight: 700; color: var(--mc-text-2); }
@media (max-width: 760px) { .mcss-hide-sm { display: none !important; } .mcss-drawer { top: auto; height: 78vh; left: 8px; right: 8px; width: auto; } }
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
