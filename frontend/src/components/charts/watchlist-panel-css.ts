// zzz1006 — the watchlist panel's styles (white default, dark via the workspace's --mc-* tokens). Selection (fill + left bar) is
// kept visibly different from keyboard focus (a neutral ring), green / red are used only for price direction.
export const PANEL_CSS = `
.mcwl { --wl-sel: color-mix(in srgb, var(--mc-accent) 12%, var(--mc-bg-0)); --wl-hover: var(--mc-bg-2); --wl-up: var(--mc-bullish, #059669); --wl-down: var(--mc-bearish, #DC2626);
  position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; border: 1px solid var(--mc-border-1); border-radius: 8px;
  background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 13px; }
.mcwl-bar { display: flex; align-items: center; gap: 6px; padding: 0 8px; }
.mcwl-grid { display: grid; grid-template-columns: 12px minmax(0,1fr) 74px 66px 24px; align-items: center; column-gap: 6px; }
.mcwl-ext .mcwl-grid { grid-template-columns: 12px minmax(0,1fr) 74px 66px 62px 24px; }
.mcwl-row { position: relative; padding: 0 6px 0 8px; min-height: 40px; line-height: 17px; cursor: pointer; user-select: none;
  border-bottom: 1px solid var(--mc-border-3); font-variant-numeric: tabular-nums; }
.mcwl-compact .mcwl-row { min-height: 31px; }
.mcwl-row:hover { background: var(--wl-hover); }
.mcwl-row.active { background: var(--wl-sel); box-shadow: inset 3px 0 0 var(--mc-accent); }
.mcwl-row:focus-visible { outline: 2px solid color-mix(in srgb, var(--mc-text-0) 55%, transparent); outline-offset: -3px; }
.mcwl-row.active:focus-visible { outline-color: var(--mc-accent); }
.mcwl-ib:focus-visible, .mcwl-btn:focus-visible, .mcwl-seg button:focus-visible, .mcwl-menu button:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.mcwl-sym { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mcwl-tk { font-weight: 650; color: var(--mc-text-0); letter-spacing: 0.1px; }
.mcwl-row.active .mcwl-tk { color: var(--mc-accent); }
.mcwl-exb { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 3px; font-size: 9.5px; line-height: 14px; font-weight: 600;
  color: var(--mc-text-3); border: 1px solid var(--mc-border-3); vertical-align: 1px; }
.mcwl-exb.us { color: color-mix(in srgb, var(--mc-accent) 80%, var(--mc-text-3)); }
.mcwl-company { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--mc-text-3); margin-top: 1px; }
.mcwl-compact .mcwl-company { display: none; }
.mcwl-compact .mcwl-row:hover .mcwl-company, .mcwl-compact .mcwl-row.active .mcwl-company { display: inline; margin-left: 6px; }
.mcwl-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.mcwl-chg { justify-self: end; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
.mcwl-chg.up { color: var(--wl-up); background: color-mix(in srgb, var(--wl-up) 10%, transparent); }
.mcwl-chg.down { color: var(--wl-down); background: color-mix(in srgb, var(--wl-down) 10%, transparent); }
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
  color: var(--mc-text-2); background: var(--mc-bg-2); border-bottom: 1px solid var(--mc-border-3); cursor: pointer; }
.mcwl-sec > [role="gridcell"] { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.mcwl-sec .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcwl-sec .cnt { font-weight: 400; color: var(--mc-text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mcwl-ib { background: none; border: none; cursor: pointer; color: var(--mc-text-3); font-size: 12px; padding: 0 3px; border-radius: 4px; }
.mcwl-ib:hover { color: var(--mc-text-0); }
.mcwl-dots { width: 22px; height: 22px; padding: 0; font-size: 15px; line-height: 20px; letter-spacing: 1px; }
.mcwl-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--mc-border-1);
  background: var(--mc-bg-0); color: var(--mc-text-1); font-size: 12px; cursor: pointer; white-space: nowrap; }
.mcwl-btn:hover { border-color: var(--mc-border-2); }
.mcwl-btn[aria-pressed="true"], .mcwl-btn.on { border-color: var(--mc-accent); color: var(--mc-accent); }
.mcwl-btn:disabled { opacity: 0.45; cursor: default; }
.mcwl-seg { display: inline-flex; border: 1px solid var(--mc-border-1); border-radius: 6px; overflow: hidden; height: 26px; }
.mcwl-seg button { border: none; background: var(--mc-bg-0); color: var(--mc-text-3); font-size: 12px; padding: 0 9px; cursor: pointer; }
.mcwl-seg button + button { border-left: 1px solid var(--mc-border-1); }
.mcwl-seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--mc-accent) 12%, var(--mc-bg-0)); color: var(--mc-accent); font-weight: 650; }
.mcwl-input { height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-0); font-size: 13px; min-width: 0; }
.mcwl-input:focus { outline: 2px solid color-mix(in srgb, var(--mc-accent) 40%, transparent); border-color: var(--mc-accent); }
.mcwl-status { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 11.5px; color: var(--mc-text-3); border-block: 1px solid var(--mc-border-3);
  font-variant-numeric: tabular-nums; min-height: 24px; }
.mcwl-colhead { padding: 4px 6px 4px 8px; font-size: 11px; font-weight: 650; color: var(--mc-text-3); border-bottom: 1px solid var(--mc-border-3); }
.mcwl-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.mcwl-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; min-width: 210px; padding: 4px; border-radius: 8px;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-1); box-shadow: 0 10px 28px rgba(15,23,42,.16); color: var(--mc-text-1); }
.mcwl-menu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 10px; border: none; background: none; color: var(--mc-text-1);
  font-size: 13px; border-radius: 4px; cursor: pointer; }
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
/* the chart page's divider: a visible grip (the divider itself belongs to the chart page) */
.mc-charts-main .mc-watchlist-resize[role="separator"] { width: 10px; position: relative; background: transparent; border-radius: 0; }
.mc-charts-main .mc-watchlist-resize[role="separator"]::before { content: ''; position: absolute; top: 4px; bottom: 4px; left: 4px; width: 2px; border-radius: 2px; background: var(--mc-border-3); }
.mc-charts-main .mc-watchlist-resize[role="separator"]::after { content: ''; position: absolute; top: 50%; left: 1px; width: 8px; height: 30px; margin-top: -15px; border-radius: 4px;
  border: 1px solid var(--mc-border-1); background: var(--mc-bg-0) radial-gradient(circle, var(--mc-text-4) 0.9px, transparent 1.3px) 1px 2px / 6px 5px; }
.mc-charts-main .mc-watchlist-resize[role="separator"]:hover::before, .mc-charts-main .mc-watchlist-resize[role="separator"]:focus-visible::before { background: var(--mc-accent); }
.mc-charts-main .mc-watchlist-resize[role="separator"]:hover::after, .mc-charts-main .mc-watchlist-resize[role="separator"]:focus-visible::after { border-color: var(--mc-accent); }
`;
