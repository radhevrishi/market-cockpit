// zzz1065 (H01) — the box a LazyPanel draws around its panel, as a pure function so a real-browser layout test can use
// the exact same CSS. Before: the waiting box had only a min-height and no content, so inside a wrapping flex ROW it
// shrank to width 0 — the observer never saw it and the panel never loaded (Daily Signal Inbox, Data freshness,
// Signal scoreboard). Now the box always takes a full line: width 100% in a block / grid, and flex-basis 100% (no
// shrinking below the line) when its parent happens to be a flex row. The same box stays after the panel mounts, so
// the layout and the scroll position do not jump.
export type LazyPanelState = 'waiting' | 'mounted';

export interface LazyPanelBox {
  display: 'block';
  width: '100%';
  flex: '1 1 100%';
  minWidth: 0;
  maxWidth: '100%';
  boxSizing: 'border-box';
  minHeight?: number;
}

export function lazyPanelWrapperStyle(state: LazyPanelState, minHeight: number): LazyPanelBox {
  const box: LazyPanelBox = { display: 'block', width: '100%', flex: '1 1 100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' };
  // Reserve the height only while waiting; once the panel is there it decides its own height.
  if (state === 'waiting') box.minHeight = Math.max(1, Math.round(minHeight));
  return box;
}

/** The same box as inline CSS text (for plain-HTML harnesses and tests). */
export function lazyPanelWrapperCss(state: LazyPanelState, minHeight: number): string {
  const s = lazyPanelWrapperStyle(state, minHeight);
  const out = [`display:${s.display}`, `width:${s.width}`, `flex:${s.flex}`, `min-width:${s.minWidth}`, `max-width:${s.maxWidth}`, `box-sizing:${s.boxSizing}`];
  if (s.minHeight != null) out.push(`min-height:${s.minHeight}px`);
  return out.join(';');
}
