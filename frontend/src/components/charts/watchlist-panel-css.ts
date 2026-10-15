// zzz1006 — the watchlist panel's styles (white default, dark via the workspace's --mc-* tokens). Selection (fill + left bar) is
// kept visibly different from keyboard focus (a neutral ring), green / red are used only for price direction.
export const PANEL_CSS = `
.mcwl { --wl-sel: color-mix(in srgb, var(--mc-accent) 12%, var(--mc-bg-0)); --wl-hover: var(--mc-bg-2); --wl-up: var(--mc-bullish, #059669); --wl-down: var(--mc-bearish, #DC2626);
  position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; border: 1px solid var(--mc-border-1); border-radius: 10px;
  background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 13px; font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased; }
/* zzz1013 — menus sit above the sticky section headers */
.mcwl .mcwl-menu { z-index: 45; }
.mcwl-bar { display: flex; align-items: center; gap: 6px; padding: 0 8px; }
.mcwl-grid { display: grid; grid-template-columns: 12px minmax(0,1fr) 74px 66px 24px; align-items: center; column-gap: 6px; }
.mcwl-ext .mcwl-grid { grid-template-columns: 12px minmax(0,1fr) 74px 66px 62px 24px; }
.mcwl-row { position: relative; padding: 0 6px 0 8px; min-height: 40px; line-height: 17px; cursor: pointer; user-select: none;
  border-bottom: 1px solid var(--mc-border-3); font-variant-numeric: tabular-nums; transition: background-color .1s ease; }
.mcwl-compact .mcwl-row { min-height: 31px; }
.mcwl-row:hover { background: var(--wl-hover); }
.mcwl-row.active { background: var(--wl-sel); box-shadow: inset 3px 0 0 var(--mc-accent); }
.mcwl-row:focus-visible { outline: 2px solid color-mix(in srgb, var(--mc-text-0) 55%, transparent); outline-offset: -3px; }
.mcwl-row.active:focus-visible { outline-color: var(--mc-accent); }
.mcwl-ib:focus-visible, .mcwl-btn:focus-visible, .mcwl-seg button:focus-visible, .mcwl-menu button:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.mcwl-sym { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mcwl-tk { font-weight: 680; color: var(--mc-text-0); letter-spacing: 0.01em; }
.mcwl-row.active .mcwl-tk { color: var(--mc-accent); }
.mcwl-exb { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 3px; font-size: 9.5px; line-height: 14px; font-weight: 600;
  color: var(--mc-text-3); border: 1px solid var(--mc-border-3); vertical-align: 1px; }
.mcwl-exb.us { color: color-mix(in srgb, var(--mc-accent) 80%, var(--mc-text-3)); }
.mcwl-company { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--mc-text-3); margin-top: 1px; }
.mcwl-compact .mcwl-company { display: none; }
.mcwl-compact .mcwl-row:hover .mcwl-company, .mcwl-compact .mcwl-row.active .mcwl-company { display: inline; margin-left: 6px; }
.mcwl-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.mcwl-chg { justify-self: end; min-width: 52px; box-sizing: border-box; padding: 2px 6px; border-radius: 5px; font-weight: 650; font-size: 12.5px; text-align: right; }
.mcwl-chg.up { color: var(--wl-up); background: color-mix(in srgb, var(--wl-up) 11%, transparent); }
.mcwl-chg.down { color: var(--wl-down); background: color-mix(in srgb, var(--wl-down) 11%, transparent); }
.mcwl-row.active .mcwl-chg.up { background: color-mix(in srgb, var(--wl-up) 16%, transparent); }
.mcwl-row.active .mcwl-chg.down { background: color-mix(in srgb, var(--wl-down) 16%, transparent); }
/* zzz1013 — drag to reorder: the dragged row fades, an accent line shows where it will land */
.mcwl-row.dragging { opacity: .45; }
.mcwl-row.drop-before::before, .mcwl-row.drop-after::after { content: ''; position: absolute; left: 6px; right: 6px; height: 2px; border-radius: 2px; background: var(--mc-accent); z-index: 2; pointer-events: none; }
.mcwl-row.drop-before::before { top: -1px; } .mcwl-row.drop-after::after { bottom: -1px; }
.mcwl-sec.drop-into { box-shadow: inset 0 -2px 0 var(--mc-accent); }
.mcwl-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: var(--wl-up); }
.mcwl-dot.warn { background: var(--mc-warn, #D97706); } .mcwl-dot.wait { background: var(--mc-text-4); }
.mcwl-empty { display: grid; justify-items: start; gap: 8px; margin: 14px 12px; padding: 14px; border: 1px dashed var(--mc-border-1); border-radius: 10px; font-size: 13px; color: var(--mc-text-3); }
.mcwl-empty b { color: var(--mc-text-0); font-size: 13.5px; }
.mcwl-empty .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.mcwl-chg.flat { color: var(--mc-text-3); }
.mcwl-extc { font-size: 11.5px; color: var(--mc-text-3); }
.mcwl-extc .ses { font-size: 9.5px; margin-right: 3px; color: var(--mc-text-4); }
.mcwl-stale { color: var(--mc-warn, #D97706); }
.mcwl-act { opacity: 0; display: flex; justify-content: flex-end; }
.mcwl-row:hover .mcwl-act, .mcwl-row:focus-within .mcwl-act, .mcwl-row.active .mcwl-act, .mcwl-act.open { opacity: 1; }
.mcwl-flag { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.mcwl-flagbtn { background: none; border: none; padding: 2px 0; cursor: pointer; line-height: 0; opacity: 0; }
.mcwl-flagbtn.on, .mcwl-row:hover .mcwl-flagbtn, .mcwl-row:focus-within .mcwl-flagbtn { opacity: 1; }
.mcwl-sec { display: flex; align-items: center; gap: 4px; padding: 0 8px 0 4px; height: 28px; font-size: 12px; font-weight: 650;
  color: var(--mc-text-2); background: var(--mc-bg-2); border-bottom: 1px solid var(--mc-border-3); cursor: pointer; position: sticky; top: 0; z-index: 1; }
.mcwl-sec:hover { color: var(--mc-text-0); }
.mcwl-sec > [role="gridcell"] { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.mcwl-sec .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcwl-sec .cnt { font-weight: 400; color: var(--mc-text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mcwl-ib { background: none; border: none; cursor: pointer; color: var(--mc-text-3); font-size: 12px; padding: 0 3px; border-radius: 4px; }
.mcwl-ib:hover { color: var(--mc-text-0); }
.mcwl-dots { width: 22px; height: 22px; padding: 0; font-size: 15px; line-height: 20px; letter-spacing: 1px; }
.mcwl-btn { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 9px; border-radius: 7px; font-weight: 600; border: 1px solid var(--mc-border-1);
  background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 12px; cursor: pointer; white-space: nowrap; }
.mcwl-btn:hover { border-color: var(--mc-border-2); background: var(--mc-bg-2); }
.mcwl-btn[aria-pressed="true"], .mcwl-btn.on { border-color: color-mix(in srgb, var(--mc-accent) 55%, var(--mc-border-1)); color: var(--mc-accent); background: color-mix(in srgb, var(--mc-accent) 9%, var(--mc-bg-0)); }
.mcwl-btn:disabled { opacity: 0.45; cursor: default; }
.mcwl-seg { display: inline-flex; gap: 1px; padding: 2px; border: 1px solid var(--mc-border-1); border-radius: 7px; height: 28px; box-sizing: border-box; background: var(--mc-bg-0); }
.mcwl-seg button { border: none; border-radius: 5px; background: transparent; color: var(--mc-text-3); font-size: 12px; font-weight: 600; padding: 0 9px; cursor: pointer; }
.mcwl-seg button:hover { color: var(--mc-text-0); background: var(--mc-bg-2); }
.mcwl-seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--mc-accent) 12%, var(--mc-bg-0)); color: var(--mc-accent); font-weight: 650; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-accent) 28%, transparent); }
.mcwl-input { height: 30px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-0); font-size: 13px; min-width: 0; }
.mcwl-input:focus { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--mc-accent) 16%, transparent); border-color: var(--mc-accent); }
.mcwl-status { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 11.5px; color: var(--mc-text-3); border-block: 1px solid var(--mc-border-3);
  font-variant-numeric: tabular-nums; min-height: 24px; }
.mcwl-colhead { padding: 5px 6px 5px 8px; font-size: 11px; font-weight: 650; color: var(--mc-text-3); border-bottom: 1px solid var(--mc-border-1); background: var(--mc-bg-0); }
.mcwl-colhead .mcwl-ib:hover { color: var(--mc-text-0); }
.mcwl-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.mcwl-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; min-width: 210px; padding: 4px; border-radius: 10px;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); box-shadow: var(--ct-shadow, 0 10px 28px rgba(15,23,42,.16)); color: var(--mc-text-1); }
.mcwl-menu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; border: none; background: none; color: var(--mc-text-1);
  font-size: 13px; border-radius: 6px; cursor: pointer; }
.mcwl-menu button:hover, .mcwl-menu button:focus-visible { background: var(--mc-bg-2); }
.mcwl-menu .sep { height: 1px; background: var(--mc-border-3); margin: 4px 2px; }
.mcwl-menu .hd { padding: 6px 10px 2px; font-size: 11px; color: var(--mc-text-3); }
.mcwl-menu .danger { color: var(--mc-bearish, #DC2626); }
.mcwl-menu .chk { width: 14px; color: var(--mc-accent); }
.mcwl-drawer { position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column; background: var(--mc-bg-0); border-radius: 8px; }
.mcwl-drawer h3 { margin: 0; font-size: 14px; color: var(--mc-text-0); }
.mcwl-drawer .grp { padding: 10px 12px; border-bottom: 1px solid var(--mc-border-3); display: grid; gap: 6px; }
.mcwl-drawer .lab { font-size: 12px; color: var(--mc-text-3); }
.mcwl-foot { padding: 4px 8px; font-size: 11.5px; color: var(--mc-text-3); border-top: 1px solid var(--mc-border-3); }
@media (hover: none) { .mcwl-act, .mcwl-flagbtn { opacity: 1; } .mcwl-row { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .mcwl-row { transition: none; } }
/* the chart page's divider: a visible grip (the divider itself belongs to the chart page) */
.mc-charts-main .mc-watchlist-resize[role="separator"] { width: 10px; position: relative; background: transparent; border-radius: 0; }
.mc-charts-main .mc-watchlist-resize[role="separator"]::before { content: ''; position: absolute; top: 4px; bottom: 4px; left: 4px; width: 2px; border-radius: 2px; background: var(--mc-border-3); }
.mc-charts-main .mc-watchlist-resize[role="separator"]::after { content: ''; position: absolute; top: 50%; left: 1px; width: 8px; height: 30px; margin-top: -15px; border-radius: 4px;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-0) radial-gradient(circle, var(--mc-text-4) 0.9px, transparent 1.3px) 1px 2px / 6px 5px; }
.mc-charts-main .mc-watchlist-resize[role="separator"]:hover::before, .mc-charts-main .mc-watchlist-resize[role="separator"]:focus-visible::before { background: var(--mc-accent); }
.mc-charts-main .mc-watchlist-resize[role="separator"]:hover::after, .mc-charts-main .mc-watchlist-resize[role="separator"]:focus-visible::after { border-color: var(--mc-accent); }
/* zzz1045d — where a list comes from (chart list / linked to My Book / not the Telegram list) */
.mcwl-src { font-size: 11px; font-weight: 500; color: var(--mc-text-3); padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0; }
.mcwl-menu .mcwl-src { padding: 0; }
.mcwl-src[data-source="book"] { color: var(--mc-accent); }
.mcwl-src[data-source="telegram-name"] { color: var(--mc-warn, #B45309); }
`;
