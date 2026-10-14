// zzz944 — named chart LAYOUTS for /charts (TradingView-style "Manual Support Resistance", "RSI" …). A layout is the indicator
// set (moving-average lines with period / colour / on-off, volume + its average, extra indicators such as RSI or Bollinger
// Bands). Drawings are NOT part of a layout — they stay per ticker and are shared by every layout, as in TradingView.
// Pure: shapes, seeds, clean-up, compare ("unsaved changes"), save / save as / rename / delete, and a merge for two devices.

import { bollinger, ema, sma, supertrend, type Bar } from './chart-math';

export const CHART_LAYOUTS_KEY = 'mc:chart-layouts:v1';

export type LineKind = 'EMA' | 'SMA';
export interface MaLine { id: string; kind: LineKind; period: number; color: string; on: boolean }
export type ExtraType = 'BOLL' | 'RSI' | 'MACD' | 'ATR' | 'ST' | 'PAT' | 'STG';
export interface Extra { id: string; type: ExtraType; params: number[]; color: string; on: boolean }
export interface ChartLayout { id: string; name: string; updatedAt: number; lines: MaLine[]; volume: { on: boolean; avg: number }; extras: Extra[]; scale: LayoutScale }
/** zzz946 — price scale: `auto` fits the visible candles (TradingView "A"); `log` = logarithmic (TradingView "L"). */
export interface LayoutScale { auto: boolean; log: boolean }
export interface LayoutStore { v: 1; layouts: ChartLayout[]; deleted: Record<string, number>; activeId: string }

export const MAX_LAYOUTS = 40, MAX_LINES = 12, MAX_EXTRAS = 8;

/** What each extra indicator is, its default numbers and their names (shown in the settings). */
export const EXTRA_INFO: Record<ExtraType, { label: string; pane: boolean; defaults: number[]; names: string[]; min: number[]; max: number[]; color: string }> = {
  BOLL: { label: 'Bollinger Bands', pane: false, defaults: [20, 2], names: ['Length', 'Width (std dev)'], min: [2, 0.1], max: [400, 10], color: '#2962FF' },
  ST: { label: 'Supertrend', pane: false, defaults: [10, 3], names: ['ATR length', 'Multiplier'], min: [1, 0.1], max: [200, 20], color: '#089981' },
  RSI: { label: 'RSI', pane: true, defaults: [14], names: ['Length'], min: [2], max: [200], color: '#7E57C2' },
  MACD: { label: 'MACD', pane: true, defaults: [12, 26, 9], names: ['Fast', 'Slow', 'Signal'], min: [1, 2, 1], max: [200, 400, 200], color: '#2962FF' },
  ATR: { label: 'ATR', pane: true, defaults: [14], names: ['Length'], min: [1], max: [200], color: '#E91E63' },
  // zzz982 — "Automate chart patterns": no line of its own; a status line at the top of the chart + the lead pattern drawn
  // (components/charts/pattern-view). Off unless added to the layout.
  PAT: { label: 'Automate chart patterns', pane: false, defaults: [], names: [], min: [], max: [], color: '#2962FF' },
  // zzz987 — "Stage Analysis (TheWrap method)": stage background bands + a status line + its own Mansfield RS pane
  // (components/charts/stage-view, StageIndicator). Off unless added to the layout.
  STG: { label: 'Stage Analysis (TheWrap method)', pane: false, defaults: [], names: [], min: [], max: [], color: '#089981' },
};
/** zzz987 — extras with their own on/off row in the Indicators panel (not listed under "other indicators"). */
export const SPECIAL_EXTRAS: ReadonlySet<ExtraType> = new Set<ExtraType>(['PAT', 'STG']);
export const EXTRA_TYPES = Object.keys(EXTRA_INFO) as ExtraType[];

let _seq = 0;
export function newLayoutId(prefix = 'y'): string {
  _seq = (_seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const clampNum = (v: unknown, min: number, max: number, dflt: number, int: boolean) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  const c = Math.min(max, Math.max(min, n));
  return int ? Math.round(c) : Math.round(c * 100) / 100;
};
const cleanName = (s: unknown, fallback: string) => {
  const v = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) : '';
  return v || fallback;
};

export function cleanLine(raw: any): MaLine {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id.slice(0, 40) : newLayoutId('m'),
    kind: raw?.kind === 'SMA' ? 'SMA' : 'EMA',
    period: clampNum(raw?.period, 1, 500, 21, true),
    color: HEX.test(String(raw?.color)) ? String(raw.color) : '#2962FF',
    on: raw?.on !== false,
  };
}
export function cleanExtra(raw: any): Extra | null {
  const type = String(raw?.type) as ExtraType;
  const info = EXTRA_INFO[type];
  if (!info) return null;
  const params = info.defaults.map((d, i) => clampNum(Array.isArray(raw?.params) ? raw.params[i] : undefined, info.min[i], info.max[i], d, !(type === 'BOLL' && i === 1) && !(type === 'ST' && i === 1)));
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id.slice(0, 40) : newLayoutId('x'),
    type, params,
    color: HEX.test(String(raw?.color)) ? String(raw.color) : info.color,
    on: raw?.on !== false,
  };
}
export function cleanLayout(raw: any, fallbackName = 'Layout'): ChartLayout {
  const lines = (Array.isArray(raw?.lines) ? raw.lines : []).slice(0, MAX_LINES).map(cleanLine);
  const extras = (Array.isArray(raw?.extras) ? raw.extras : []).slice(0, MAX_EXTRAS).map(cleanExtra).filter((x: Extra | null): x is Extra => !!x);
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id.slice(0, 40) : newLayoutId(),
    name: cleanName(raw?.name, fallbackName),
    updatedAt: Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : 0,
    lines,
    volume: { on: raw?.volume?.on !== false, avg: clampNum(raw?.volume?.avg, 1, 200, 20, true) },
    scale: { auto: raw?.scale?.auto !== false, log: raw?.scale?.log === true },
    extras,
  };
}

/** His TradingView legend, top to bottom: EMA 100 / 150 (hidden) / 50 / 55 (hidden) / 89 / 21. */
function manualSR(): Omit<ChartLayout, 'id' | 'updatedAt'> {
  return {
    name: 'Manual Support Resistance',
    lines: [
      { id: 'e100', kind: 'EMA', period: 100, color: '#FFD600', on: true },
      { id: 'e150', kind: 'EMA', period: 150, color: '#2E7D32', on: false },
      { id: 'e50', kind: 'EMA', period: 50, color: '#2962FF', on: true },
      { id: 'e55', kind: 'EMA', period: 55, color: '#8E24AA', on: false },
      { id: 'e89', kind: 'EMA', period: 89, color: '#000000', on: true },
      { id: 'e21', kind: 'EMA', period: 21, color: '#F23645', on: true },
    ],
    volume: { on: true, avg: 20 },
    scale: { auto: true, log: false },
    extras: [],
  };
}
/** First visit: the two layouts he uses in TradingView. */
export function seedLayoutStore(now = Date.now()): LayoutStore {
  const a: ChartLayout = { id: 'lay-msr', updatedAt: now, ...manualSR() };
  const b: ChartLayout = { id: 'lay-rsi', updatedAt: now, ...manualSR(), name: 'RSI', extras: [{ id: 'rsi14', type: 'RSI', params: [14], color: '#7E57C2', on: true }] };
  return { v: 1, layouts: [a, b], deleted: {}, activeId: a.id };
}

export function sanitizeLayoutStore(raw: unknown): LayoutStore {
  const r: any = raw && typeof raw === 'object' ? raw : null;
  if (!r || !Array.isArray(r.layouts)) return seedLayoutStore();
  const seen = new Set<string>();
  const layouts: ChartLayout[] = [];
  for (const l of r.layouts.slice(0, MAX_LAYOUTS)) {
    if (!l || typeof l !== 'object') continue;
    const c = cleanLayout(l);
    if (seen.has(c.id)) c.id = newLayoutId();
    seen.add(c.id); layouts.push(c);
  }
  const deleted: Record<string, number> = {};
  if (r.deleted && typeof r.deleted === 'object') for (const [k, v] of Object.entries(r.deleted).slice(0, 200)) if (Number.isFinite(Number(v)) && !seen.has(k)) deleted[k.slice(0, 40)] = Number(v);
  if (!layouts.length) return { ...seedLayoutStore(), deleted };
  return { v: 1, layouts, deleted, activeId: layouts.some((l) => l.id === r.activeId) ? r.activeId : layouts[0].id };
}

export const activeLayout = (s: LayoutStore): ChartLayout => s.layouts.find((l) => l.id === s.activeId) || s.layouts[0];

/** Same indicator set? (name, id and time ignored) — drives the ● "unsaved changes" mark. */
export function sameSettings(a: ChartLayout, b: ChartLayout): boolean {
  const pick = (l: ChartLayout) => JSON.stringify({
    lines: l.lines.map((x) => [x.kind, x.period, x.color.toLowerCase(), x.on]),
    volume: [l.volume.on, l.volume.avg],
    scale: [l.scale.auto, l.scale.log],
    extras: l.extras.map((x) => [x.type, x.params, x.color.toLowerCase(), x.on]),
  });
  return pick(a) === pick(b);
}

/** Save: overwrite the active layout with the working copy. */
export function saveLayout(s: LayoutStore, working: ChartLayout, now = Date.now()): LayoutStore {
  return { ...s, layouts: s.layouts.map((l) => (l.id === s.activeId ? { ...cleanLayout(working), id: l.id, name: l.name, updatedAt: now } : l)) };
}
/** Save as: a new layout from the working copy, made active. */
export function saveLayoutAs(s: LayoutStore, working: ChartLayout, name: string, now = Date.now()): LayoutStore {
  if (s.layouts.length >= MAX_LAYOUTS) return s;
  const l: ChartLayout = { ...cleanLayout(working), id: newLayoutId(), name: cleanName(name, 'My layout'), updatedAt: now };
  return { ...s, layouts: [...s.layouts, l], activeId: l.id };
}
export function renameLayout(s: LayoutStore, id: string, name: string, now = Date.now()): LayoutStore {
  return { ...s, layouts: s.layouts.map((l) => (l.id === id ? { ...l, name: cleanName(name, l.name), updatedAt: now } : l)) };
}
/** Delete (the last layout cannot go). The id is remembered so another device does not bring it back. */
export function deleteLayout(s: LayoutStore, id: string, now = Date.now()): LayoutStore {
  if (s.layouts.length <= 1 || !s.layouts.some((l) => l.id === id)) return s;
  const layouts = s.layouts.filter((l) => l.id !== id);
  return { ...s, layouts, deleted: { ...s.deleted, [id]: now }, activeId: s.activeId === id ? layouts[0].id : s.activeId };
}

/** Two copies (this device + the server): per layout the newer save wins; a delete wins over older saves. The active layout is
 *  this device's own choice (`a`). */
export function mergeLayoutStores(aRaw: unknown, bRaw: unknown): LayoutStore {
  const a = sanitizeLayoutStore(aRaw), b = sanitizeLayoutStore(bRaw);
  const deleted: Record<string, number> = { ...b.deleted };
  for (const [k, v] of Object.entries(a.deleted)) deleted[k] = Math.max(deleted[k] || 0, v);
  const byId = new Map<string, ChartLayout>();
  for (const l of [...b.layouts, ...a.layouts]) { const cur = byId.get(l.id); if (!cur || l.updatedAt >= cur.updatedAt) byId.set(l.id, l); }
  const order = [...a.layouts.map((l) => l.id), ...b.layouts.map((l) => l.id)].filter((id, i, arr) => arr.indexOf(id) === i);
  const layouts = order.map((id) => byId.get(id)!).filter((l) => !(deleted[l.id] && deleted[l.id] >= l.updatedAt));
  for (const l of layouts) delete deleted[l.id];
  const out: LayoutStore = { v: 1, layouts: layouts.length ? layouts : seedLayoutStore().layouts, deleted, activeId: a.activeId };
  if (!out.layouts.some((l) => l.id === out.activeId)) out.activeId = out.layouts[0].id;
  return out;
}

// ── labels ────────────────────────────────────────────────────────────────────
export const lineLabel = (l: MaLine) => `${l.kind} ${l.period}`;
export const extraLabel = (e: Extra) => `${EXTRA_INFO[e.type].label} ${e.params.join(' ')}`.trim();
export function newExtra(type: ExtraType): Extra {
  const info = EXTRA_INFO[type];
  return { id: newLayoutId('x'), type, params: info.defaults.slice(), color: info.color, on: true };
}

// ── what the price pane draws, and the legend rows ───────────────────────────
/** One line on the price pane. */
export interface PriceSeries { kind: 'EMA' | 'SMA' | 'BBU' | 'BBM' | 'BBL' | 'STU' | 'STD'; a: number; b?: number }

/** Values of one price-pane series for every bar (null while there is not enough history). */
export function seriesValues(spec: PriceSeries, bars: Bar[]): (number | null)[] {
  const closes = bars.map((x) => x.c);
  switch (spec.kind) {
    case 'EMA': return ema(closes, spec.a);
    case 'SMA': return sma(closes, spec.a);
    case 'BBU': return bollinger(closes, spec.a, spec.b ?? 2).up;
    case 'BBM': return bollinger(closes, spec.a, spec.b ?? 2).mid;
    case 'BBL': return bollinger(closes, spec.a, spec.b ?? 2).lo;
    case 'STU': { const st = supertrend(bars, spec.a, spec.b ?? 3); return st.line.map((v, i) => (st.dir[i] === 1 ? v : null)); }
    case 'STD': { const st = supertrend(bars, spec.a, spec.b ?? 3); return st.line.map((v, i) => (st.dir[i] === -1 ? v : null)); }
    default: return bars.map(() => null);
  }
}

export const BB_MID_COLOR = '#FF6D00', ST_UP_COLOR = '#089981', ST_DOWN_COLOR = '#F23645';

/** One row of the top-left legend: an EMA/SMA line, Bollinger Bands, Supertrend, or a lower-pane indicator. */
export interface LegendRow { id: string; source: 'line' | 'extra' | 'volume'; label: string; color: string; on: boolean; series: { spec: PriceSeries; color: string }[]; pane: boolean }
export function legendRows(l: ChartLayout): LegendRow[] {
  const rows: LegendRow[] = l.lines.map((x) => ({ id: x.id, source: 'line', label: lineLabel(x), color: x.color, on: x.on, pane: false, series: [{ spec: { kind: x.kind, a: x.period }, color: x.color }] }));
  for (const e of l.extras) {
    if (e.type === 'PAT' || e.type === 'STG') continue;   // zzz982 / zzz987 — shown as their own status line at the top of the chart, not a legend row
    const info = EXTRA_INFO[e.type];
    const series: LegendRow['series'] = e.type === 'BOLL'
      ? [{ spec: { kind: 'BBU', a: e.params[0], b: e.params[1] }, color: e.color }, { spec: { kind: 'BBM', a: e.params[0], b: e.params[1] }, color: BB_MID_COLOR }, { spec: { kind: 'BBL', a: e.params[0], b: e.params[1] }, color: e.color }]
      : e.type === 'ST'
        ? [{ spec: { kind: 'STU', a: e.params[0], b: e.params[1] }, color: ST_UP_COLOR }, { spec: { kind: 'STD', a: e.params[0], b: e.params[1] }, color: ST_DOWN_COLOR }]
        : [];
    rows.push({ id: e.id, source: 'extra', label: extraLabel(e), color: e.type === 'ST' ? ST_UP_COLOR : e.color, on: e.on, pane: info.pane, series });
  }
  return rows;
}
/** The series MC_LINES draws: every visible price-pane row, flattened. */
export function priceSeriesOf(l: ChartLayout): { spec: PriceSeries; color: string }[] {
  return legendRows(l).filter((r) => r.on && !r.pane).flatMap((r) => r.series);
}
/** zzz1019 — the id of the volume row in the chart legend (volume is a layout setting, not a line or extra). */
export const VOLUME_ROW_ID = '__vol';
/** zzz1019 — the legend rows plus Volume (lower pane) when it is on, so it can be hidden / removed from the legend too. */
export function legendRowsWithVolume(l: ChartLayout): LegendRow[] {
  const rows = legendRows(l);
  if (l.volume.on) rows.push({ id: VOLUME_ROW_ID, source: 'volume', label: `Volume ${l.volume.avg}`, color: '#F59E0B', on: true, pane: true, series: [] });
  return rows;
}
/** zzz1019 — the × on a legend row: the line / indicator leaves the layout (Volume is switched off; Indicators ▾ adds it back). */
export function removeRow(l: ChartLayout, id: string): ChartLayout {
  if (id === VOLUME_ROW_ID) return { ...l, volume: { ...l.volume, on: false } };
  return { ...l, lines: l.lines.filter((x) => x.id !== id), extras: l.extras.filter((x) => x.id !== id) };
}
/** Eye toggle on a legend row. */
export function toggleRow(l: ChartLayout, id: string): ChartLayout {
  if (id === VOLUME_ROW_ID) return { ...l, volume: { ...l.volume, on: !l.volume.on } };
  return {
    ...l,
    lines: l.lines.map((x) => (x.id === id ? { ...x, on: !x.on } : x)),
    extras: l.extras.map((x) => (x.id === id ? { ...x, on: !x.on } : x)),
  };
}
