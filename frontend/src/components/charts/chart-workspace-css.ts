// zzz1013 — the chart page's design: the same refined tokens as the Pine Screener (zzz1011), scoped to .mc-charts-root, so the
// toolbar, the instrument strip, the drawing rail, the canvas frame and the watchlist panel read as one terminal in white and dark.
// Class names start with "ct-". The chart canvas reads --mc-bg-0 / --mc-text-3 / --mc-border-* from .mc-charts-root (themeStyles).
export const CHART_CSS = `
.mc-charts-root.mc-chart-light, .mc-charts-root:not(.mc-workspace-dark) {
  --mc-bg-0: #ffffff; --mc-bg-1: #fbfcfd; --mc-bg-2: #f4f6f8; --mc-bg-3: #eceff3;
  --mc-border-1: #dde2e8; --mc-border-2: #c3c9d2; --mc-border-3: #edf0f3;
  --mc-text-0: #121722; --mc-text-1: #232a36; --mc-text-2: #3d4553; --mc-text-3: #5f6877; --mc-text-4: #8d95a2;
  --mc-accent: #2453c4; --mc-bullish: #0b7a4b; --mc-bearish: #bf3a2e; --mc-warn: #a2560c;
  --ct-on-accent: #ffffff; --ct-press: #e9effc; --ct-hover: #f1f4f8; --ct-well: #f4f6f8;
  --ct-shadow: 0 1px 0 rgba(18,23,34,.04), 0 12px 32px -14px rgba(18,23,34,.28);
  --ct-up: #0b7a4b; --ct-down: #bf3a2e; --ct-up-bg: #e5f3ec; --ct-down-bg: #fbeae8;
  background: #ffffff;
}
.mc-charts-root.mc-workspace-dark {
  --mc-bg-0: #0c1018; --mc-bg-1: #10151f; --mc-bg-2: #141b27; --mc-bg-3: #19212f;
  --mc-border-1: #242d3c; --mc-border-2: #34405a; --mc-border-3: #1a2230;
  --mc-text-0: #eef1f6; --mc-text-1: #d9dfe8; --mc-text-2: #b9c2d0; --mc-text-3: #8c97a8; --mc-text-4: #5f6a7d;
  --mc-accent: #7ea3ff; --mc-bullish: #3cc98f; --mc-bearish: #f2756a; --mc-warn: #e9a947;
  --ct-on-accent: #0c1018; --ct-press: #1a2540; --ct-hover: #161e2b; --ct-well: #10151f;
  --ct-shadow: 0 1px 0 rgba(0,0,0,.4), 0 16px 36px -14px rgba(0,0,0,.75);
  --ct-up: #3cc98f; --ct-down: #f2756a; --ct-up-bg: rgba(60,201,143,.13); --ct-down-bg: rgba(242,117,106,.13);
  background: #0c1018;
}
.mc-charts-root { font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased; }
.mc-charts-root :where(button, a, input, select, [tabindex]):focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.mc-charts-root ::selection { background: color-mix(in srgb, var(--mc-accent) 24%, transparent); }

/* ── toolbar ─────────────────────────────────────────────────────────────── */
.ct-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 34px; }
.ct-spacer { flex: 1; }
.ct-div { width: 1px; align-self: stretch; margin: 5px 2px; background: var(--mc-border-1); }
.ct-search { display: flex; align-items: center; height: 32px; border: 1px solid var(--mc-border-1); border-radius: 8px; background: var(--mc-bg-0); }
.ct-search:focus-within { border-color: var(--mc-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mc-accent) 16%, transparent); }
.ct-search select { appearance: none; height: 100%; border: none; border-right: 1px solid var(--mc-border-3); background: transparent; color: var(--mc-text-2);
  font-size: 12px; font-weight: 650; padding: 0 9px; border-radius: 8px 0 0 8px; cursor: pointer; }
.ct-search .ct-glass { display: inline-grid; place-items: center; width: 26px; color: var(--mc-text-4); }
.ct-search input { height: 30px; width: 168px; border: none; background: transparent; color: var(--mc-text-0); font-size: 13.5px; font-weight: 650; letter-spacing: .01em; padding: 0 4px; outline: none; }
.ct-search input::placeholder { color: var(--mc-text-4); font-weight: 500; }
.ct-search .ct-go { height: 24px; margin-right: 3px; padding: 0 9px; border-radius: 6px; border: none; background: var(--ct-well); color: var(--mc-text-2); font-size: 12px; font-weight: 650; cursor: pointer; }
.ct-search .ct-go:hover { color: var(--mc-text-0); background: var(--mc-bg-3); }
.ct-seg { display: inline-flex; align-items: center; height: 32px; padding: 2px; gap: 1px; border: 1px solid var(--mc-border-1); border-radius: 8px; background: var(--mc-bg-0); box-sizing: border-box; }
.ct-seg-label { padding: 0 6px 0 6px; font-size: 11.5px; font-weight: 600; color: var(--mc-text-4); }
.ct-seg button { height: 26px; min-width: 28px; padding: 0 8px; border: none; border-radius: 6px; background: transparent; color: var(--mc-text-2); font-size: 12.5px; font-weight: 650; cursor: pointer; }
.ct-seg button:hover { background: var(--ct-hover); color: var(--mc-text-0); }
.ct-seg button[aria-pressed="true"] { background: var(--ct-press); color: var(--mc-accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-accent) 30%, transparent); }
.ct-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid var(--mc-border-1); border-radius: 8px; background: var(--mc-bg-0);
  color: var(--mc-text-1); font-size: 12.5px; font-weight: 650; cursor: pointer; white-space: nowrap; box-sizing: border-box; }
.ct-btn:hover { border-color: var(--mc-border-2); background: var(--ct-hover); }
.ct-btn[aria-pressed="true"], .ct-btn[aria-expanded="true"] { border-color: color-mix(in srgb, var(--mc-accent) 55%, var(--mc-border-1)); background: var(--ct-press); color: var(--mc-accent); }
.ct-btn:disabled { opacity: .45; cursor: default; }
.ct-btn.primary { background: var(--mc-accent); border-color: var(--mc-accent); color: var(--ct-on-accent); }
.ct-icon { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: var(--mc-text-2); cursor: pointer; box-sizing: border-box; }
.ct-icon:hover { background: var(--ct-hover); color: var(--mc-text-0); border-color: var(--mc-border-1); }
.ct-icon[aria-pressed="true"], .ct-icon[aria-expanded="true"] { background: var(--ct-press); color: var(--mc-accent); border-color: color-mix(in srgb, var(--mc-accent) 35%, transparent); }
.ct-icon:disabled { opacity: .4; cursor: default; }
.ct-icons { display: inline-flex; align-items: center; gap: 2px; padding: 0 2px; }
.ct-split { display: inline-flex; position: relative; }
.ct-split > .ct-icon:first-child { border-radius: 8px 0 0 8px; }
.ct-split > .ct-caret { width: 18px; border-radius: 0 8px 8px 0; }
.ct-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; min-width: 230px; padding: 4px; border-radius: 10px; border: 1px solid var(--mc-border-1);
  background: var(--mc-bg-0); box-shadow: var(--ct-shadow); }
.ct-menu button { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 7px 10px; border: none; background: none;
  color: var(--mc-text-1); font-size: 13px; border-radius: 6px; cursor: pointer; }
.ct-menu button:hover, .ct-menu button:focus-visible { background: var(--ct-hover); }
kbd, .ct-kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 5px; border: 1px solid var(--mc-border-1); border-bottom-width: 2px;
  background: var(--mc-bg-0); color: var(--mc-text-2); font: 650 11px/1 inherit; font-family: inherit; box-sizing: border-box; }

/* tooltips with a keyboard hint (data-tip / data-kbd) */
.mc-charts-root [data-tip] { position: relative; }
.mc-charts-root [data-tip]::after { content: attr(data-tip); position: absolute; z-index: 90; left: 50%; top: calc(100% + 7px); transform: translateX(-50%); white-space: nowrap;
  padding: 5px 8px; border-radius: 6px; background: var(--mc-text-0); color: var(--mc-bg-0); font-size: 11.5px; font-weight: 600; line-height: 1.2; pointer-events: none;
  opacity: 0; transition: opacity .12s ease .35s; }
.mc-charts-root [data-tip][data-kbd]::after { content: attr(data-tip) "   " attr(data-kbd); }
.mc-charts-root [data-tip]:hover::after, .mc-charts-root [data-tip]:focus-visible::after { opacity: 1; }
.mc-charts-root [data-tip][aria-expanded="true"]::after { display: none; }
.ct-rail [data-tip]::after { left: calc(100% + 8px); top: 50%; transform: translateY(-50%); }
.ct-tip-left[data-tip]::after { left: auto; right: 0; transform: none; }

/* ── instrument strip ────────────────────────────────────────────────────── */
.ct-inst { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; padding: 2px 2px 0; min-height: 40px; }
.ct-id { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.ct-tk { font-size: 19px; font-weight: 750; letter-spacing: -0.01em; color: var(--mc-text-0); }
.ct-name { font-size: 12.5px; color: var(--mc-text-3); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-ex { align-self: center; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--mc-border-1); font-size: 10.5px; font-weight: 650; color: var(--mc-text-3); }
.ct-session { align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px 2px 7px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
  color: var(--mc-text-3); background: var(--ct-well); white-space: nowrap; }
.ct-session i { width: 6px; height: 6px; border-radius: 50%; background: var(--mc-text-4); }
.ct-session.open { color: var(--ct-up); background: var(--ct-up-bg); } .ct-session.open i { background: var(--ct-up); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ct-up) 22%, transparent); }
.ct-session.pre i, .ct-session.post i { background: var(--mc-warn); } .ct-session.pre, .ct-session.post { color: var(--mc-warn); background: color-mix(in srgb, var(--mc-warn) 11%, transparent); }
.ct-px { display: flex; align-items: baseline; gap: 10px; font-variant-numeric: tabular-nums; }
.ct-last { font-size: 22px; font-weight: 720; letter-spacing: -0.02em; color: var(--mc-text-0); }
.ct-chg { align-self: center; padding: 2px 8px; border-radius: 6px; font-size: 12.5px; font-weight: 680; }
.ct-chg.up { color: var(--ct-up); background: var(--ct-up-bg); } .ct-chg.down { color: var(--ct-down); background: var(--ct-down-bg); }
.ct-stats { display: flex; align-items: stretch; margin: 0; padding: 0; border: 1px solid var(--mc-border-3); border-radius: 8px; background: var(--mc-bg-1); }
.ct-stats > div { display: grid; gap: 0; padding: 3px 10px; border-left: 1px solid var(--mc-border-3); cursor: help; }
.ct-stats > div:first-child { border-left: none; }
.ct-stats dt { font-size: 10.5px; font-weight: 600; color: var(--mc-text-4); line-height: 14px; white-space: nowrap; }
.ct-stats dd { margin: 0; font-size: 12.5px; font-weight: 680; color: var(--mc-text-0); line-height: 17px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ct-inst-end { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.ct-inst-end select { height: 28px; font-size: 12px; padding: 0 8px; border-radius: 7px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0); color: var(--mc-text-1); max-width: 128px; }
.ct-inst-end .mcwl-btn { height: 28px; }
.ct-fresh { display: grid; font-size: 11px; line-height: 14px; color: var(--mc-text-3); white-space: nowrap; font-variant-numeric: tabular-nums; cursor: help; }
.ct-fresh b { font-weight: 600; color: var(--mc-text-2); }
.ct-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; }
.ct-status:empty { display: none; }
.ct-spin { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1.6px solid var(--mc-border-2); border-top-color: var(--mc-accent); animation: ct-spin .8s linear infinite; vertical-align: -1px; }
@keyframes ct-spin { to { transform: rotate(360deg); } }

/* review strip */
.ct-review { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 5px 6px 5px 12px; border-radius: 9px; font-size: 13px;
  border: 1px solid color-mix(in srgb, var(--mc-accent) 40%, var(--mc-border-1)); background: color-mix(in srgb, var(--mc-accent) 6%, var(--mc-bg-0)); color: var(--mc-text-1); }
.ct-review .ct-btn { height: 28px; }

/* ── drawing rail + canvas ───────────────────────────────────────────────── */
.ct-rail { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 40px; flex-shrink: 0; padding: 4px 0; border: 1px solid var(--mc-border-1); border-radius: 10px;
  background: var(--mc-bg-1); box-sizing: border-box; overflow: visible; }
.ct-rail .ct-icon { width: 32px; height: 30px; }
.ct-rail .ct-sep { width: 20px; height: 1px; margin: 3px 0; background: var(--mc-border-1); }
.ct-swatch { display: inline-grid; place-items: center; width: 32px; height: 30px; border-radius: 8px; cursor: pointer; position: relative; }
.ct-swatch:hover { background: var(--ct-hover); }
.ct-swatch:focus-within { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.ct-swatch input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.ct-swatch span { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--mc-text-0) 18%, transparent); }
.ct-canvas { position: relative; flex: 1; min-width: 0; border: 1px solid var(--mc-border-1); border-radius: 10px; background: var(--mc-bg-0); overflow: hidden; }
.ct-float { position: absolute; z-index: 5; padding: 3px 9px; border-radius: 7px; font-size: 11.5px; font-weight: 600; background: color-mix(in srgb, var(--mc-bg-0) 92%, transparent);
  border: 1px solid var(--mc-border-1); color: var(--mc-text-2); pointer-events: none; box-shadow: var(--ct-shadow); backdrop-filter: blur(4px); }
.ct-float.ok { color: var(--ct-up); }
/* zzz1045c — a new symbol / timeframe is loading: the overlay chips (from the chart shown before) are dimmed, never removed */
.mc-overlay-row[data-stale] > :not([data-testid="display-toggle"]) { opacity: .35; transition: opacity .12s; }
.ct-loading-badge { left: 50%; top: 6px; transform: translateX(-50%); z-index: 9; display: inline-flex; align-items: center; gap: 6px; color: var(--mc-text-1); white-space: nowrap; }
.ct-loading-badge .ct-spin { width: 10px; height: 10px; }
/* zzz1045c — collapse / expand a lower pane (top-right of the pane, left of its price axis) */
.ct-pane-btn { position: absolute; z-index: 6; height: 18px; min-width: 18px; padding: 0 5px; display: inline-flex; align-items: center; gap: 3px; border-radius: 5px;
  font-size: 11px; font-weight: 650; line-height: 1; cursor: pointer; border: 1px solid var(--mc-border-2); color: var(--mc-text-2);
  background: color-mix(in srgb, var(--mc-bg-0) 92%, transparent); }
.ct-pane-btn:hover, .ct-pane-btn:focus-visible { color: var(--mc-text-0); border-color: var(--mc-accent); outline: none; }
.ct-pane-all { position: absolute; z-index: 6; display: inline-flex; gap: 4px; }
.ct-pane-btn.static { position: static; }
.ct-pane-btn[aria-pressed="true"] { color: var(--mc-accent); border-color: var(--mc-accent); }
.mc-scale-btn { min-width: 38px; height: 24px; padding: 0 8px; font-size: 12px; font-weight: 700; border-radius: 6px; cursor: pointer; letter-spacing: .01em;
  border: 1px solid var(--mc-border-2); background: color-mix(in srgb, var(--mc-bg-0) 94%, transparent); color: var(--mc-text-1); box-shadow: var(--ct-shadow); }
.ct-ctx { min-width: 290px; }
.ct-ctx-title { padding: 6px 10px 4px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--mc-text-3); }
.ct-ctx-sep { height: 1px; margin: 4px 6px; background: var(--mc-border-1); }
.ct-ctx button.danger { color: var(--ct-down, #F23645); }
.ct-ctx button:disabled { opacity: .45; cursor: default; }
.mc-scale-btn:hover { color: var(--mc-text-0); border-color: var(--mc-border-2); }
.mc-scale-btn.on { background: var(--ct-press); border-color: color-mix(in srgb, var(--mc-accent) 45%, transparent); color: var(--mc-accent); }
.ct-empty { position: absolute; inset: 0; z-index: 7; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--mc-bg-0); }
.ct-empty > div { max-width: 420px; display: flex; flex-direction: column; gap: 10px; align-items: center; text-align: center; font-size: 13px; color: var(--mc-text-2); }
.ct-empty .ct-empty-title { font-size: 15px; font-weight: 700; color: var(--mc-text-0); }
.mc-charts-root .ct-canvas .mc-legend-row { flex-wrap: nowrap !important; white-space: nowrap; }
.mc-legend-row { width: max-content; padding: 0 6px; margin-left: -6px; border-radius: 5px; background: color-mix(in srgb, var(--mc-bg-0) 78%, transparent); }

.ct-narrow-only { display: none; }
@media (max-width: 900px) { .ct-narrow-only { display: inline-flex; } }
/* ── shortcuts overlay ───────────────────────────────────────────────────── */
.ct-help-back { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 16px; background: rgba(12,16,24,.42); animation: ct-fade .14s ease; }
.ct-help { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 16px 18px 18px; border-radius: 14px; border: 1px solid var(--mc-border-1);
  background: var(--mc-bg-0); color: var(--mc-text-0); box-shadow: 0 30px 70px -24px rgba(0,0,0,.5); box-sizing: border-box; }
.ct-help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.ct-help h2 { margin: 0; font-size: 16px; font-weight: 720; letter-spacing: -0.01em; }
.ct-help h3 { margin: 12px 0 6px; font-size: 12px; font-weight: 650; color: var(--mc-text-3); }
.ct-help dl { margin: 0; display: grid; gap: 6px; }
.ct-help dl > div { display: grid; grid-template-columns: 136px 1fr; gap: 12px; align-items: center; font-size: 13px; }
.ct-help dt { display: flex; gap: 4px; flex-wrap: wrap; }
.ct-help dd { margin: 0; color: var(--mc-text-2); }
@keyframes ct-fade { from { opacity: 0; } to { opacity: 1; } }

/* ── laptop widths: the toolbar and the strip stay on one line ───────────── */
@media (max-width: 1500px) {
  .ct-layout-label { display: none; }
  .ct-layout > button:first-child { max-width: 170px !important; }
  .ct-search input { width: 136px; }
}
@media (max-width: 1400px) {
  .ct-fresh { display: none; }
  .ct-stats > div { padding: 3px 8px; }
  .ct-name { display: none; }
  .ct-seg-label { display: none; }
  .ct-seg button { padding: 0 7px; }
}
/* ── watchlist drawer (narrow screens) ───────────────────────────────────── */
.ct-backdrop { display: none; }
@media (max-width: 900px) {
  .mc-charts-root { padding: 8px 10px !important; }
  .ct-bar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }
  .ct-bar::-webkit-scrollbar { display: none; }
  .ct-bar > * { flex-shrink: 0; }
  .ct-search input { width: 120px; }
  .mc-charts-root [data-tip]::after { display: none; }
  .ct-inst { gap: 6px 12px; }
  .ct-stats { width: 100%; overflow-x: auto; scrollbar-width: none; }
  .ct-inst-end { margin-left: 0; }
  .mc-charts-main .mc-charts-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 110; width: min(420px, 92vw); height: auto; max-width: none;
    transform: translateX(105%); transition: transform .22s cubic-bezier(.2,.7,.2,1); box-shadow: var(--ct-shadow); background: var(--mc-bg-0); }
  .mc-charts-main .mc-charts-panel.open { transform: none; }
  .mc-charts-main .mc-charts-panel .mcwl { border-radius: 0; border-width: 0 0 0 1px; }
  .ct-backdrop.open { display: block; position: fixed; inset: 0; z-index: 105; border: none; background: rgba(12,16,24,.38); cursor: pointer; }
  .mc-charts-left { height: calc(100vh - 210px) !important; min-height: 380px; }
}
/* phones: the site makes every button a 40 px tap target — the segmented groups grow with it, the legend and scale chips stay small */
@media (max-width: 767px) {
  .ct-seg, .ct-search { height: auto; }
  .ct-search .ct-go { min-height: 30px !important; }
  .mc-charts-root .ct-canvas .mc-legend { flex-wrap: nowrap !important; }
  .mc-legend-row button { min-height: 22px !important; min-width: 22px; }
  .mc-scale-btn { min-height: 28px !important; }
  .ct-rail .ct-icon { min-height: 34px !important; height: 34px; }
  .mcwl-seg { height: auto; }
}
@media (max-width: 520px) {
  .ct-inst-end { flex-wrap: nowrap; width: 100%; }
  .ct-inst-end select { flex: 1; min-width: 0; max-width: none; }
  .ct-inst-end .ct-btn, .ct-inst-end .mcwl-btn { padding: 0 9px; }
  .ct-rail { width: 34px; } .ct-rail .ct-icon, .ct-swatch { width: 28px; height: 28px; }
  .ct-name { display: none; }
  .ct-last { font-size: 20px; }
  .ct-help dl > div { grid-template-columns: 1fr; gap: 2px; }
}
@media (prefers-reduced-motion: reduce) {
  .mc-charts-root *, .mc-charts-root *::after, .ct-help-back { transition: none !important; animation: none !important; }
}
`;
