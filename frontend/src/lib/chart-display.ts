// zzz1029 — chart display presets and right-edge tag placement for /charts. QA (HAL): patterns + stage analysis + auto levels on at
// once gave stacked status bars, many turning-point labels and right-edge price tags on top of each other.
//  • "Clean" (default) shows fewer labels: pattern turning-point codes only when a pattern is picked / hovered, stage pills for the
//    current stage and the change before it, setup tags on the last ~20 bars, nearby auto-line tags merged into one tag, a cap on
//    right-edge tags. "Research" shows every label as before. The calculations are the same in both — this only changes what is drawn.
//  • placeEdgeTags: one placement for right-edge tags from several indicators — higher priority first, kept clear of tags drawn by
//    others (the last-price tag, a pattern pivot tag), the lowest priority dropped when crowded (Clean) or stacked (Research).
// Pure (no DOM, no chart engine) so it is unit-tested.

export type ChartDisplay = 'clean' | 'research';
export const CHART_DISPLAY_KEY = 'mc:chart-display:v1';
export const DEFAULT_CHART_DISPLAY: ChartDisplay = 'clean';

export function parseChartDisplay(raw: string | null | undefined): ChartDisplay {
  if (!raw) return DEFAULT_CHART_DISPLAY;
  try {
    const j = JSON.parse(raw);
    const v = typeof j === 'string' ? j : j && typeof j === 'object' ? (j as { mode?: unknown }).mode : null;
    return v === 'research' ? 'research' : 'clean';
  } catch {
    return raw === 'research' ? 'research' : 'clean';
  }
}
export const serializeChartDisplay = (d: ChartDisplay): string => JSON.stringify({ mode: d });

export function readChartDisplay(): ChartDisplay {
  try { return parseChartDisplay(localStorage.getItem(CHART_DISPLAY_KEY)); } catch { return DEFAULT_CHART_DISPLAY; }
}
export function saveChartDisplay(d: ChartDisplay): void {
  try { localStorage.setItem(CHART_DISPLAY_KEY, serializeChartDisplay(d)); } catch { /* this visit only */ }
}

export const DISPLAY_WORDS: Record<ChartDisplay, { label: string; tip: string }> = {
  clean: { label: 'Clean', tip: 'Clean: fewer labels on the chart — turning-point codes when you pick or hover a pattern, recent setup tags, the current stage, nearby level tags merged. The numbers are the same.' },
  research: { label: 'Research', tip: 'Research: every label on the chart — all turning points, stage changes, setup tags and level tags. The numbers are the same.' },
};

// ── Clean filters (display only) ──────────────────────────────────────────────────

/** Pattern turning-point codes (TH / TL / LIP …) on the chart: always in Research; in Clean only when the user picked rows in the
 *  list, hovers this pattern's row, or hovers the pattern's lines on the chart. */
export function patternLabelsShown(o: { display: ChartDisplay; picked: boolean; hoverRow: string | null; rowKey: string; chartHover: boolean }): boolean {
  if (o.display === 'research') return true;
  return o.picked || o.chartHover || (o.hoverRow != null && o.hoverRow === o.rowKey);
}

/** Stage marks (pills, levels, "began" ticks) in Clean: the current stage and the change before it (the last two). */
export function stageMarksForDisplay<T>(marks: readonly T[], display: ChartDisplay): T[] {
  return display === 'research' ? marks.slice() : marks.slice(-2);
}

export const CLEAN_SETUP_BARS = 20;
/** Setup tags in Clean: only those on the last `n` bars (by time; `times` = the bars read, ascending). */
export function recentSetupPoints<P extends readonly [number, ...unknown[]]>(points: readonly P[], times: readonly number[], display: ChartDisplay, n = CLEAN_SETUP_BARS): P[] {
  if (display === 'research' || !times.length) return points.slice();
  const from = times[Math.max(0, times.length - n)];
  return points.filter((p) => p[0] >= from);
}

// ── right-edge tags ───────────────────────────────────────────────────────────────

/** Priorities: higher wins a crowded spot. The last-price tag and a picked pattern's pivot tag are drawn by others and passed as
 *  reserved positions; nearest support / resistance come next, then the rest. */
export const TAG_PRIORITY = { lastPrice: 100, patternPivot: 90, stageLevel: 70, nearest: 50, other: 10 } as const;

export interface EdgeTagReq {
  id: string;
  /** desired y (pixels in the pane) */
  y: number;
  priority: number;
  text: string;
  color: string;
  /** exact prices behind this tag (several when merged) */
  prices?: number[];
}
export interface PlacedEdgeTag extends EdgeTagReq { yPlaced: number }
export interface EdgeTagOpts {
  mode: ChartDisplay;
  /** minimum distance between two tags (pixels) */
  gap: number;
  min?: number; max?: number;
  /** positions already taken by tags drawn elsewhere (last price, pattern pivot) */
  reserved?: number[];
  /** Clean: at most this many tags in all, reserved ones included */
  maxTags?: number;
  /** Clean: a tag pushed further than this from its line is dropped instead */
  maxShift?: number;
}

/** Place right-edge tags: highest priority first, each at the free spot nearest its line, never within `gap` of another tag or a
 *  reserved position. Clean drops what does not fit (cap, shift); Research keeps every tag (overlapping only when there is no room). */
export function placeEdgeTags(reqs: readonly EdgeTagReq[], o: EdgeTagOpts): { placed: PlacedEdgeTag[]; dropped: EdgeTagReq[] } {
  const min = o.min ?? -Infinity, max = o.max ?? Infinity;
  const reserved = (o.reserved || []).filter((y) => Number.isFinite(y));
  const clean = o.mode === 'clean';
  const order = reqs.map((r, i) => ({ r, i })).sort((a, b) => b.r.priority - a.r.priority || a.i - b.i);
  const budget = clean ? Math.max(0, (o.maxTags ?? Infinity) - reserved.length) : Infinity;
  const taken: number[] = [...reserved];
  const out: Array<{ i: number; t: PlacedEdgeTag }> = [];
  const dropped: EdgeTagReq[] = [];
  const free = (y: number) => y >= min - 1e-9 && y <= max + 1e-9 && taken.every((t) => Math.abs(t - y) >= o.gap - 1e-9);
  for (const { r, i } of order) {
    if (out.length >= budget) { dropped.push(r); continue; }
    const want = Math.min(max, Math.max(min, r.y));
    let spot: number | null = free(want) ? want : null;
    if (spot == null) {
      for (const t of taken) for (const c of [t - o.gap, t + o.gap]) if (free(c) && (spot == null || Math.abs(c - want) < Math.abs(spot - want))) spot = c;
    }
    if (spot == null || (clean && Math.abs(spot - r.y) > (o.maxShift ?? Infinity))) {
      if (clean) { dropped.push(r); continue; }
      spot = spot ?? want;   // Research: no free spot left — stacked on top
    }
    taken.push(spot);
    out.push({ i, t: { ...r, yPlaced: spot } });
  }
  out.sort((a, b) => a.i - b.i);
  return { placed: out.map((x) => x.t), dropped };
}

export interface LevelTag {
  id: string; y: number; price: number;
  /** touch count (×N) */
  n: number;
  kind: 'support' | 'resistance';
  prov?: boolean;
  color: string;
  priority: number;
  /** the tag as drawn alone */
  text: string;
}

/** Clean: auto-line tags whose prices are within `pct` % (or whose tags are within `px` pixels) of each other become one tag,
 *  "×5 · ×3  131.00–132.60"; the exact prices stay in `prices` (and in the indicator's list). Research: one tag each. */
export function mergeLevelTags(tags: readonly LevelTag[], o: { mode: ChartDisplay; pct?: number; px?: number; fmt: (n: number) => string }): EdgeTagReq[] {
  if (o.mode === 'research' || tags.length < 2) return tags.map((t) => ({ id: t.id, y: t.y, priority: t.priority, text: t.text, color: t.color, prices: [t.price] }));
  const pct = o.pct ?? 1.2, px = o.px ?? 14;
  const sorted = [...tags].sort((a, b) => a.y - b.y);
  const groups: LevelTag[][] = [];
  for (const t of sorted) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    const near = !!last && (Math.abs(t.y - last.y) <= px || Math.abs(t.price - last.price) / Math.max(1e-9, Math.min(Math.abs(t.price), Math.abs(last.price))) * 100 <= pct);
    if (near) g!.push(t); else groups.push([t]);
  }
  return groups.map((g) => {
    if (g.length === 1) { const t = g[0]; return { id: t.id, y: t.y, priority: t.priority, text: t.text, color: t.color, prices: [t.price] }; }
    const lead = [...g].sort((a, b) => b.priority - a.priority)[0];
    const ps = g.map((t) => t.price);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const counts = [...g].sort((a, b) => b.n - a.n).map((t) => `×${t.n}`).join(' · ');
    return {
      id: g.map((t) => t.id).join('|'),
      y: g.reduce((s, t) => s + t.y, 0) / g.length,
      priority: lead.priority,
      text: `${counts}  ${o.fmt(lo)}–${o.fmt(hi)}${g.some((t) => t.prov) ? ' · provisional' : ''}`,
      color: lead.color,
      prices: ps.slice().sort((a, b) => a - b),
    };
  });
}

/** Priority of an auto-line tag: the nearest line above and the nearest below the last price come first. */
export function levelPriorities<T extends { id: string; price: number }>(tags: readonly T[], lastPrice: number | null): Map<string, number> {
  const m = new Map<string, number>();
  let up: T | null = null, dn: T | null = null;
  if (lastPrice != null && Number.isFinite(lastPrice)) {
    for (const t of tags) {
      if (t.price >= lastPrice) { if (!up || t.price < up.price) up = t; }
      else if (!dn || t.price > dn.price) dn = t;
    }
  }
  for (const t of tags) m.set(t.id, t === up || t === dn ? TAG_PRIORITY.nearest : TAG_PRIORITY.other);
  return m;
}

export const CLEAN_MAX_EDGE_TAGS = 6;

// ── overlay summary chips ─────────────────────────────────────────────────────────

export type OverlayId = 'patterns' | 'stage' | 'setups' | 'alines';

/** The short text of a chip in the overlay summary row (the full status line stays in its hover text and its details). */
export function overlayChipText(id: OverlayId, full: string): string {
  const s = full.trim();
  if (id === 'patterns') {
    const m = /^📐\s*(.+?) · (Daily|Weekly|Monthly) · (.+)$/.exec(s);
    if (!m) return s;
    const rest = m[3].split(' · ')[0]
      .replace(/(\d+) days? ago/, '$1d').replace(/(\d+) wk ago/, '$1w').replace(/(\d+) weeks? ago/, '$1w').replace(/(\d+) months? ago/, '$1mo');
    return `📐 ${m[2]}: ${m[1]} ${rest}`;
  }
  if (id === 'setups') return s.replace(/^Trader setups · (Daily|Weekly|Monthly) · /, 'Setups: ');
  if (id === 'alines') return s.replace(/^Auto lines · (Daily|Weekly|Monthly) · /, 'Lines: ');
  return s.replace(/^Stage Analysis: /, 'Stage: ');
}

// ── another timeframe's structure on these candles (zzz1029b, QA AVAV monthly) ────────
export const CLEAN_MIN_SPAN_CANDLES = 6;
/** How many candles on screen a structure from startT to endT covers (times ascending; a candle counts when its time is in range,
 *  plus the candle holding startT). */
export function candlesSpanned(startT: number, endT: number, times: readonly number[]): number {
  if (!times.length || !(endT >= startT)) return 0;
  let n = 0, holder = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= startT) holder = i;
    if (times[i] >= startT && times[i] <= endT) n++;
  }
  return n + (holder >= 0 && times[holder] < startT ? 1 : 0);
}
/** Clean: a structure found on another timeframe than the candles on screen is not drawn when it would cover fewer than ~6 candles
 *  (squeezed onto the last bars); it stays in the overlay chip with its "Switch to …". Research always draws it. */
export function drawOtherTfStructure(o: { display: ChartDisplay; hitTf: string; shownTf: string; startT: number; endT: number; times: readonly number[]; min?: number }): boolean {
  if (o.display === 'research' || o.hitTf === o.shownTf) return true;
  return candlesSpanned(o.startT, o.endT, o.times) >= (o.min ?? CLEAN_MIN_SPAN_CANDLES);
}
