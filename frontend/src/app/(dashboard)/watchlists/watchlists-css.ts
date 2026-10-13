// zzz1013 — the Watchlists page in the same terminal style as Charts and the Pine Screener: refined --mc-* tokens scoped to .wlp
// (white and dark), tabs as a real tab list with one accent, a figures strip instead of four cards, a dense sortable table.
export const WLP_CSS = `
.wlp.mc-chart-light, .wlp:not(.mc-workspace-dark) {
  --mc-bg-0: #ffffff; --mc-bg-1: #fbfcfd; --mc-bg-2: #f4f6f8; --mc-bg-3: #eceff3;
  --mc-border-1: #dde2e8; --mc-border-2: #dde2e8; --mc-border-3: #edf0f3;
  --mc-text-0: #121722; --mc-text-1: #232a36; --mc-text-2: #3d4553; --mc-text-3: #5f6877; --mc-text-4: #8d95a2;
  --mc-accent: #2453c4; --mc-info: #2453c4; --mc-bullish: #0b7a4b; --mc-bearish: #bf3a2e; --mc-warn: #a2560c;
  --wlp-hover: #f3f6fb; --wlp-zebra: #fafbfc; --wlp-press: #e9effc; --wlp-up-bg: #e5f3ec; --wlp-down-bg: #fbeae8;
  --wlp-shadow: 0 1px 0 rgba(18,23,34,.04), 0 12px 32px -14px rgba(18,23,34,.28);
}
.wlp.mc-workspace-dark {
  --mc-bg-0: #0c1018; --mc-bg-1: #10151f; --mc-bg-2: #141b27; --mc-bg-3: #19212f;
  --mc-border-1: #242d3c; --mc-border-2: #242d3c; --mc-border-3: #1a2230;
  --mc-text-0: #eef1f6; --mc-text-1: #d9dfe8; --mc-text-2: #b9c2d0; --mc-text-3: #8c97a8; --mc-text-4: #5f6a7d;
  --mc-accent: #7ea3ff; --mc-info: #7ea3ff; --mc-bullish: #3cc98f; --mc-bearish: #f2756a; --mc-warn: #e9a947;
  --wlp-hover: #151d2b; --wlp-zebra: #0f141d; --wlp-press: #1a2540; --wlp-up-bg: rgba(60,201,143,.13); --wlp-down-bg: rgba(242,117,106,.13);
  --wlp-shadow: 0 1px 0 rgba(0,0,0,.4), 0 16px 36px -14px rgba(0,0,0,.75);
  background: #0c1018 !important;
}
.wlp { font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased; }
.wlp :where(button, a, input, select, [tabindex]):focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; border-radius: 6px; }
.wlp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.wlp-title { margin: 0; font-size: 22px; font-weight: 720; letter-spacing: -0.02em; color: var(--mc-text-0); line-height: 1.15; }
.wlp-lede { margin: 3px 0 0; font-size: 12.5px; color: var(--mc-text-3); }
.wlp-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.wlp-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--mc-border-1); background: var(--mc-bg-0);
  color: var(--mc-text-1); font-size: 12.5px; font-weight: 650; cursor: pointer; white-space: nowrap; box-sizing: border-box; text-decoration: none; }
.wlp-btn:hover:not(:disabled) { border-color: var(--mc-border-2); background: var(--wlp-hover); }
.wlp-btn:disabled { opacity: .45; cursor: not-allowed; }
.wlp-btn.accent { color: var(--mc-accent); }
.wlp-spin { animation: wlp-spin .9s linear infinite; }
@keyframes wlp-spin { to { transform: rotate(360deg); } }
.wlp-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--mc-border-1); margin-bottom: 18px; overflow-x: auto; scrollbar-width: none; }
.wlp-tabs::-webkit-scrollbar { display: none; }
.wlp-tab { position: relative; display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; padding: 10px 12px 11px; border: none; background: none; cursor: pointer;
  color: var(--mc-text-3); font-size: 13px; font-weight: 650; white-space: nowrap; border-radius: 8px 8px 0 0; }
.wlp-tab:hover { color: var(--mc-text-0); background: var(--wlp-hover); }
.wlp-tab[aria-selected="true"] { color: var(--mc-text-0); }
.wlp-tab[aria-selected="true"]::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; border-radius: 2px 2px 0 0; background: var(--mc-accent); }
.wlp-tab svg { opacity: .8; }
.wlp-count { min-width: 18px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; color: var(--mc-text-3); background: var(--mc-bg-2); font-variant-numeric: tabular-nums; }
.wlp-tab[aria-selected="true"] .wlp-count { color: var(--mc-accent); background: var(--wlp-press); }
.wlp-count.hot { color: var(--mc-warn); background: color-mix(in srgb, var(--mc-warn) 13%, transparent); }
.wlp-figs { display: flex; flex-wrap: wrap; margin: 0 0 16px; padding: 0; border: 1px solid var(--mc-border-1); border-radius: 10px; background: var(--mc-bg-1); }
.wlp-figs > div { flex: 1 1 140px; padding: 10px 16px 11px; border-left: 1px solid var(--mc-border-3); }
.wlp-figs > div:first-child { border-left: none; }
.wlp-figs dt { font-size: 11.5px; font-weight: 600; color: var(--mc-text-3); }
.wlp-figs dd { margin: 2px 0 0; font-size: 20px; font-weight: 720; letter-spacing: -0.02em; color: var(--mc-text-0); font-variant-numeric: tabular-nums; }
.wlp-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 12.5px; color: var(--mc-text-3); }
.wlp-tablewrap { overflow: auto; border: 1px solid var(--mc-border-1); border-radius: 12px; background: var(--mc-bg-0); max-height: 72vh; }
.wlp-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.wlp-table th { position: sticky; top: 0; z-index: 2; padding: 9px 14px; background: var(--mc-bg-1); border-bottom: 1px solid var(--mc-border-1); color: var(--mc-text-3);
  font-size: 11.5px; font-weight: 650; text-align: left; white-space: nowrap; user-select: none; }
.wlp-table th.num, .wlp-table td.num { text-align: right; }
.wlp-table th[aria-sort] { cursor: pointer; }
.wlp-table th[aria-sort]:hover { color: var(--mc-text-0); }
.wlp-table th[aria-sort="ascending"], .wlp-table th[aria-sort="descending"] { color: var(--mc-text-0); }
.wlp-table th .wlp-th { display: inline-flex; align-items: center; gap: 5px; }
.wlp-table th.num .wlp-th { justify-content: flex-end; width: 100%; }
.wlp-table td { padding: 9px 14px; border-bottom: 1px solid var(--mc-border-3); color: var(--mc-text-0); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wlp-table tbody tr:nth-child(even) td { background: var(--wlp-zebra); }
.wlp-table tbody tr:hover td { background: var(--wlp-hover); }
.wlp-table tbody tr:last-child td { border-bottom: none; }
.wlp-tk { font-weight: 700; color: var(--mc-text-0); text-decoration: none; letter-spacing: .01em; }
.wlp-tk:hover { color: var(--mc-accent); }
.wlp-tk .go { margin-left: 4px; font-size: 11px; color: var(--mc-text-4); }
.wlp-tk:hover .go { color: var(--mc-accent); }
.wlp-chg { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 64px; box-sizing: border-box; padding: 2px 7px; border-radius: 6px; font-weight: 650; font-size: 12.5px; }
.wlp-chg.up { color: var(--mc-bullish); background: var(--wlp-up-bg); } .wlp-chg.down { color: var(--mc-bearish); background: var(--wlp-down-bg); }
.wlp-dim { color: var(--mc-text-4); }
.wlp-x { display: inline-grid; place-items: center; width: 28px; height: 28px; border: none; border-radius: 7px; background: none; color: var(--mc-text-4); cursor: pointer; opacity: .55; }
.wlp-table tr:hover .wlp-x, .wlp-x:focus-visible { opacity: 1; }
.wlp-x:hover { color: var(--mc-bearish); background: var(--wlp-down-bg); }
.wlp-flag { background: none; border: none; cursor: pointer; font-size: 15px; padding: 2px 4px; border-radius: 6px; line-height: 1; }
.wlp-flag:hover { background: var(--mc-bg-2); }
.wlp-pop { position: absolute; top: 100%; right: 8px; margin-top: 4px; z-index: 50; min-width: 210px; padding: 6px; border-radius: 10px; border: 1px solid var(--mc-border-1);
  background: var(--mc-bg-0); box-shadow: var(--wlp-shadow); text-align: left; }
.wlp-pop label { display: flex; align-items: center; gap: 8px; padding: 6px 6px; border-radius: 6px; cursor: pointer; font-size: 12.5px; font-weight: 500; color: var(--mc-text-0); }
.wlp-pop label:hover { background: var(--wlp-hover); }
.wlp-empty { display: grid; justify-items: center; gap: 10px; text-align: center; padding: 56px 20px; border: 1px dashed var(--mc-border-1); border-radius: 14px; background: var(--mc-bg-1); }
.wlp-empty h2 { margin: 0; font-size: 17px; font-weight: 720; color: var(--mc-text-0); letter-spacing: -0.01em; }
.wlp-empty p { margin: 0; max-width: 56ch; font-size: 13px; color: var(--mc-text-3); }
.wlp-skel { height: 40px; border-radius: 8px; background: linear-gradient(90deg, var(--mc-bg-2) 0%, var(--mc-bg-1) 40%, var(--mc-bg-2) 80%); background-size: 240% 100%; animation: wlp-shimmer 1.3s ease-in-out infinite; }
@keyframes wlp-shimmer { from { background-position: 100% 0; } to { background-position: -40% 0; } }
.wlp-note { margin-top: 20px; padding: 12px 16px; border: 1px solid var(--mc-border-3); border-radius: 10px; background: var(--mc-bg-1); font-size: 12.5px; color: var(--mc-text-3); }
@media (max-width: 640px) {
  .wlp-pad { padding: 14px 12px !important; }
  .wlp-figs > div { flex-basis: 45%; border-left: none; border-top: 1px solid var(--mc-border-3); padding: 8px 12px; }
  .wlp-figs > div:nth-child(-n+2) { border-top: none; }
  .wlp-figs dd { font-size: 17px; }
  .wlp-table td, .wlp-table th { padding: 8px 10px; }
}
@media (prefers-reduced-motion: reduce) { .wlp-spin, .wlp-skel { animation: none; } }
`;
