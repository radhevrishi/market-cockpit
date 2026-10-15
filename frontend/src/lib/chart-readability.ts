// zzz1045c — chart readability on /charts (audit: in the combined NVDA monthly dark view the overlay chips plus the long MA /
// indicator legend covered much of the candle pane, lower panes squeezed the price pane, and analysis from the previous symbol
// stayed readable while the next one loaded). Pure helpers (no DOM, no chart engine) so they are unit-tested:
//  • legendCompact / stripFit — the one-line legend strip in Clean (names + latest values, the rest behind "+N")
//  • barsNeeded / missingValueText — "— (needs 200 bars, has 120)" instead of a bare "—"
//  • fitPaneHeights + the per-layout collapsed-pane store — the price pane keeps at least ~45% of the chart
//  • transitionLabel / analysisStale — "Loading NVDA M…" while new data loads; the previous symbol's analysis is dimmed
import type { ChartDisplay } from './chart-display';
import type { PriceSeries } from './chart-layouts';

// ── 1. compact legend ─────────────────────────────────────────────────────────────

/** The viewer's legend choice: null = follow the display preset (Clean → one strip, Research → full list). */
export type LegendPref = 'compact' | 'full' | null;

/** The legend is one strip when the viewer chose so, or by default in Clean. */
export function legendCompact(display: ChartDisplay, pref: LegendPref): boolean {
  return pref ? pref === 'compact' : display === 'clean';
}

/** How many strip items fit on one line of `avail` px (items in order, `gap` px between them). When some do not fit, room is kept
 *  for the "+N" button (`moreW` px). `extra` = items that are never in the strip but are counted in "+N" (e.g. hidden lines). */
export function stripFit(widths: readonly number[], avail: number, moreW: number, gap = 8, extra = 0): { shown: number; more: number } {
  const total = widths.reduce((s, w, i) => s + w + (i ? gap : 0), 0);
  if (!extra && total <= avail) return { shown: widths.length, more: 0 };
  const room = avail - moreW - gap;
  let used = 0, n = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = used + widths[i] + (i ? gap : 0);
    if (next > room) break;
    used = next; n++;
  }
  return { shown: n, more: widths.length - n + extra };
}

// ── 3. missing values ─────────────────────────────────────────────────────────────

/** Bars needed before a price-pane series has its first value (same maths as lib/chart-math). */
export function barsNeeded(spec: PriceSeries): number {
  // EMA / SMA / Bollinger: the first value is on bar n; Supertrend: on bar n (its ATR length)
  return Math.max(1, Math.round(spec.a || 1));
}

/** Bars needed for each value a lower-pane indicator shows in the legend (RSI: one; MACD: line and signal; ATR: one). */
export function paneBarsNeeded(type: string, params: readonly number[]): number[] {
  const p = (i: number, d: number) => Math.max(1, Math.round(Number(params[i]) || d));
  if (type === 'RSI') return [p(0, 14) + 1];
  if (type === 'MACD') { const slow = Math.max(p(0, 12), p(1, 26)); return [slow, slow + p(2, 9) - 1]; }
  if (type === 'ATR') return [p(0, 14)];
  return [];
}

/** The legend text for a value: the number, a plain "—", or "— (needs N bars, has M)" when the history is too short for it.
 *  `has` = bars up to and including the bar the legend shows (the hovered one, or the last). */
export function missingValueText(needed: number | null | undefined, has: number): string {
  if (needed == null || !(needed > 0) || has >= needed) return '—';
  return `— (needs ${needed} bars, has ${Math.max(0, has)})`;
}

// ── 2. lower panes ────────────────────────────────────────────────────────────────

export const MIN_PRICE_FRACTION = 0.45;
export const MIN_PRICE_PX = 180;
export const COLLAPSED_PANE_PX = 22;
export const MIN_PANE_PX = 36;

export interface PaneReq { id: string; want: number; collapsed?: boolean }

/** Heights for the lower panes so the price pane keeps at least `minFrac` of `total` (or `minPx`, whichever is larger, never more
 *  than the chart allows). Collapsed panes get `collapsedPx`; open ones keep their wanted height when everything fits, otherwise
 *  shrink in proportion (never below `minPanePx`). `axis` = the time axis height below the panes. */
export function fitPaneHeights(total: number, panes: readonly PaneReq[], o: { minFrac?: number; minPx?: number; collapsedPx?: number; minPanePx?: number; axis?: number } = {}): Record<string, number> {
  const minFrac = o.minFrac ?? MIN_PRICE_FRACTION, minPx = o.minPx ?? MIN_PRICE_PX;
  const collapsedPx = o.collapsedPx ?? COLLAPSED_PANE_PX, minPanePx = o.minPanePx ?? MIN_PANE_PX, axis = o.axis ?? 0;
  const out: Record<string, number> = {};
  const usable = Math.max(0, total - axis);
  const open = panes.filter((p) => !p.collapsed);
  let fixed = 0;
  for (const p of panes) if (p.collapsed) { out[p.id] = collapsedPx; fixed += collapsedPx; }
  if (!open.length) return out;
  const minPrice = Math.min(usable, Math.max(minFrac * usable, minPx));
  const budget = Math.max(0, usable - minPrice - fixed);
  const wants = open.map((p) => Math.max(minPanePx, p.want || 0));
  const sum = wants.reduce((s, w) => s + w, 0);
  if (sum <= budget) { open.forEach((p, i) => { out[p.id] = Math.round(wants[i]); }); return out; }
  // shrink in proportion; a pane that would go below the floor is held at it and the rest share what is left
  const floor = new Set<number>();
  const freeSum = () => wants.reduce((s, w, i) => s + (floor.has(i) ? 0 : w), 0);
  const roomLeft = () => Math.max(0, budget - floor.size * minPanePx);
  for (let pass = 0; pass < open.length; pass++) {
    const free = freeSum(), room = roomLeft();
    let changed = false;
    wants.forEach((w, i) => { if (!floor.has(i) && (free > 0 ? (w * room) / free : 0) < minPanePx) { floor.add(i); changed = true; } });
    if (!changed) break;
  }
  const free = freeSum();
  const room = roomLeft();
  open.forEach((p, i) => { out[p.id] = floor.has(i) || free <= 0 ? minPanePx : Math.max(minPanePx, Math.floor((wants[i] * room) / free)); });
  return out;
}

/** Collapsed lower panes, per layout: { [layoutId]: paneId[] } ('mc:chart-panes:v1', this browser only). */
export const CHART_PANES_KEY = 'mc:chart-panes:v1';
export type PaneCollapseStore = Record<string, string[]>;
const MAX_LAYOUTS = 60, MAX_PANES = 24;

export function parsePaneCollapse(raw: string | null | undefined): PaneCollapseStore {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out: PaneCollapseStore = {};
    for (const [k, v] of Object.entries(j).slice(-MAX_LAYOUTS)) {
      if (typeof k !== 'string' || !k || !Array.isArray(v)) continue;
      const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 120))].slice(0, MAX_PANES);
      if (ids.length) out[k] = ids;
    }
    return out;
  } catch { return {}; }
}
export function isPaneCollapsed(s: PaneCollapseStore, layoutId: string, paneId: string): boolean {
  return !!s[layoutId]?.includes(paneId);
}
/** Collapse / expand one pane of one layout; the most recently changed layout moves to the end (oldest dropped past the cap). */
export function togglePaneCollapsed(s: PaneCollapseStore, layoutId: string, paneId: string): PaneCollapseStore {
  const cur = s[layoutId] || [];
  const next = cur.includes(paneId) ? cur.filter((x) => x !== paneId) : [...cur, paneId].slice(-MAX_PANES);
  const out: PaneCollapseStore = {};
  for (const [k, v] of Object.entries(s)) if (k !== layoutId) out[k] = v;
  if (next.length) out[layoutId] = next;
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_LAYOUTS))) delete out[k];
  return out;
}
export function readPaneCollapse(): PaneCollapseStore {
  try { return parsePaneCollapse(localStorage.getItem(CHART_PANES_KEY)); } catch { return {}; }
}
export function savePaneCollapse(s: PaneCollapseStore): void {
  try { localStorage.setItem(CHART_PANES_KEY, JSON.stringify(s)); } catch { /* this visit only */ }
}

// ── 4. symbol / timeframe switch ──────────────────────────────────────────────────

const TF_WORDS: Record<string, string> = { D: 'daily', W: 'weekly', M: 'monthly' };
/** "Loading NVDA M…" (BSE added for a BSE chart); the full words go in its hover text. */
export function transitionLabel(ticker: string, tf: string, exchange?: string | null): { text: string; title: string } {
  const ex = exchange === 'BSE' ? ' (BSE)' : '';
  return {
    text: `Loading ${ticker}${ex} ${tf}…`,
    title: `Loading ${ticker}${ex} ${TF_WORDS[tf] || tf} candles. The analysis above is from the chart shown before and is dimmed until the new data arrives.`,
  };
}

/** True while the bars on screen are not for the chart asked for (another symbol / exchange / timeframe / price basis) and no
 *  error has replaced the load: the analysis summaries from before must not read as current. */
export function analysisStale(o: { ready: boolean; loadedId: string; viewId: string; loading: boolean; error: string | null }): boolean {
  if (!o.ready || o.loadedId === o.viewId) return false;
  return o.loading || !o.error;
}
