// zzz1022 — "Trader setups" chart indicator: the pure pieces (no React, no chart engine).
//  • on / off in the working layout (an extra of type 'SET', like 'PAT' / 'STG')
//  • the candles it reads: the chart's own bars (D / W / M), minus a still-forming last bar (session / week / month not closed)
//  • per-bar markers [timestamp, code, dir] for the chart, the Darvas boxes and the Donchian 20 lines
//  • the banner: active setups on the last bars (age, level, distance %) and the headline
//  • the viewer's per-type show / hide choice (localStorage 'mc:chart-setups:v1')
// The rules themselves are lib/setups.ts — our own version of the published rules, not the traders' own code.
import { newExtra, type ChartLayout } from '@/lib/chart-layouts';
import { periodCloseT } from '@/lib/bar-aggregate';
import { sessionCloseMs, weekComplete } from '@/lib/completed-weeks';
import { SETUP_META, setupSeries, type SetupBar, type SetupCode, type SetupEvent, type SetupSeriesResult } from '@/lib/setups';

export const SETUP_INDICATOR = 'MC_SETUPS';
export const SQZ_INDICATOR = 'MC_SQZ';
export const SQZ_PANE = 'mc_sqz_pane';
export const SETUP_PREFS_KEY = 'mc:chart-setups:v1';
export type SetupChartTf = 'D' | 'W' | 'M';

/** Every setup code in list order (the banner's dropdown). */
export const SETUP_CODES: SetupCode[] = ['WT3', 'DVX', 'DC20', 'DC55', 'SQZ', 'SQZF', 'EP', 'GV', 'MB', 'WP', 'ECB', 'NH', 'ATH', 'HG', 'SPR', 'NR7', 'IB'];
/** Short tag drawn on the candles. */
export const SETUP_TAG: Record<SetupCode, string> = {
  WT3: '3WT', DVX: 'DBX', DC20: 'DC20', DC55: 'DC55', SQZ: 'SQZ', SQZF: 'SQZ', EP: 'EP', GV: 'GAP', MB: 'MB', WP: 'WP', ECB: 'CB',
  NH: 'NH', ATH: 'ATH', NR7: 'NR7', IB: 'IB', HG: 'HG', SPR: 'SPR',
};
/** The tag of one event: the squeeze-fired tag carries its direction (SQZ↑ / SQZ↓). */
export const tagOf = (code: SetupCode, dir: 1 | -1) => (code === 'SQZF' ? `SQZ${dir === 1 ? '↑' : '↓'}` : SETUP_TAG[code]);
/** Quiet-bar setups that fire very often: off on the chart until ticked. */
export const SETUP_DEFAULT_OFF: ReadonlySet<SetupCode> = new Set<SetupCode>(['NR7', 'IB']);
/** Setups that say nothing about direction (drawn in a neutral colour). */
export const SETUP_NEUTRAL: ReadonlySet<SetupCode> = new Set<SetupCode>(['SQZ', 'NR7', 'IB']);
/** How many bars an event stays "active" in the banner (same windows as the screener's setupFigures). */
const ACTIVE_WINDOW: Record<SetupCode, number> = {
  WT3: 10, DVX: 10, DC20: 10, DC55: 10, SQZ: 0, SQZF: 10, EP: 10, GV: 10, MB: 5, WP: 5, ECB: 5, NH: 10, ATH: 10, HG: 5, SPR: 10, NR7: 1, IB: 1,
};
export const SETUP_ROW_WINDOW = 10;

// ── layout on / off ─────────────────────────────────────────────────────────────
export function setupsOn(l: ChartLayout | null | undefined): boolean {
  return !!l?.extras?.some((x) => x.type === 'SET' && x.on);
}
export function withSetups(l: ChartLayout, on: boolean): ChartLayout {
  const rest = l.extras.filter((x) => x.type !== 'SET');
  return { ...l, extras: on ? [...rest, newExtra('SET')] : rest };
}

// ── the viewer's choices ────────────────────────────────────────────────────────
export interface SetupPrefs { shown: Record<SetupCode, boolean>; sqzPane: boolean; donchian: boolean }
export function defaultSetupPrefs(): SetupPrefs {
  const shown = {} as Record<SetupCode, boolean>;
  for (const c of SETUP_CODES) shown[c] = !SETUP_DEFAULT_OFF.has(c);
  return { shown, sqzPane: false, donchian: false };
}
export function parseSetupPrefs(raw: string | null | undefined): SetupPrefs {
  const p = defaultSetupPrefs();
  if (!raw) return p;
  let j: any;
  try { j = JSON.parse(raw); } catch { return p; }
  if (!j || typeof j !== 'object') return p;
  if (j.shown && typeof j.shown === 'object') for (const c of SETUP_CODES) if (typeof j.shown[c] === 'boolean') p.shown[c] = j.shown[c];
  if (typeof j.sqzPane === 'boolean') p.sqzPane = j.sqzPane;
  if (typeof j.donchian === 'boolean') p.donchian = j.donchian;
  return p;
}
export const serializeSetupPrefs = (p: SetupPrefs) => JSON.stringify({ v: 1, shown: p.shown, sqzPane: p.sqzPane, donchian: p.donchian });

// ── which bars are read ─────────────────────────────────────────────────────────
/** Is the last candle still forming at `now`? Daily: the bar's date is today and the market has not closed yet (US 16:00 New
 *  York = 20:00 UTC in summer time, 21:00 UTC in winter; India 15:30 IST = 10:00 UTC). Weekly (zzz1044a): the week's Friday
 *  close has not passed (lib/completed-weeks — the same rule as the weekly Stage Analysis and the screener's weekly setups).
 *  Monthly: the month has not ended (lib/bar-aggregate periodCloseT — 00:00 UTC after its last weekday). */
export function lastBarForming(lastT: number | null | undefined, tf: SetupChartTf, market: string, now: number = Date.now()): boolean {
  if (lastT == null || !Number.isFinite(lastT)) return false;
  if (tf === 'W') return !weekComplete(lastT, market, now);
  if (tf === 'M') return now < periodCloseT(lastT, tf);
  return now < sessionCloseMs(lastT, market);
}
/** The completed candles of the chart (a prefix of `bars`, so indexes match) and whether a forming last candle was left out. */
export function completedBars<T extends { t: number }>(bars: readonly T[], tf: SetupChartTf, market: string, now: number = Date.now()): { bars: T[]; dropped: boolean } {
  const last = bars[bars.length - 1];
  const dropped = !!last && lastBarForming(last.t, tf, market, now);
  return { bars: dropped ? bars.slice(0, -1) : bars.slice(), dropped };
}

// ── chart points ────────────────────────────────────────────────────────────────
/** One marker on the chart: [timestamp of the bar, code, direction]. */
export type SetupPoint = [number, SetupCode, 1 | -1];
/** Markers for the bars given (completed bars). `series` may be passed when already worked out; `shown` filters the types. */
export function setupPointsFor(bars: readonly SetupBar[], series?: SetupSeriesResult | null, shown?: (c: SetupCode) => boolean, market?: 'US' | 'IN'): SetupPoint[] {
  const s = series ?? setupSeries(bars as SetupBar[], { market });
  const out: SetupPoint[] = [];
  for (const e of s.events) {
    const b = bars[e.i];
    if (!b || (shown && !shown(e.code))) continue;
    out.push([b.t, e.code, e.dir]);
  }
  return out;
}
/** A Darvas box by timestamps (for the chart: matched to the candles by time). */
export interface SetupBox { fromT: number; toT: number; top: number; bottom: number; state: 'inside' | 'up' | 'down' }
export function setupBoxesFor(bars: readonly SetupBar[], s: SetupSeriesResult, latest = 3): SetupBox[] {
  return s.darvas.slice(-latest).filter((b) => bars[b.from] && bars[b.to]).map((b) => ({ fromT: bars[b.from].t, toT: bars[b.to].t, top: b.top, bottom: b.bottom, state: b.state }));
}
/** The Donchian 20 channel per candle: [timestamp, high, low]. */
export type DonchianPoint = [number, number | null, number | null];
export function donchianPointsFor(bars: readonly SetupBar[], s: SetupSeriesResult): DonchianPoint[] {
  return bars.map((b, i) => [b.t, s.donchian20.hi[i] ?? null, s.donchian20.lo[i] ?? null]);
}
/** The squeeze pane per candle: [timestamp, squeeze on (1 / 0 / null unknown), momentum]. */
export type SqueezePoint = [number, 1 | 0 | null, number | null];
export function squeezePointsFor(bars: readonly SetupBar[], s: SetupSeriesResult): SqueezePoint[] {
  return bars.map((b, i) => [b.t, s.squeeze.mom[i] == null && !s.squeeze.on[i] ? null : s.squeeze.on[i] ? 1 : 0, s.squeeze.mom[i] ?? null]);
}

// ── banner ──────────────────────────────────────────────────────────────────────
export interface SetupRow {
  code: SetupCode; dir: 1 | -1;
  /** bars since it fired (0 = the last completed bar); for a state (inside a box, squeeze on) the bars it has lasted */
  age: number;
  state: boolean;
  level: number | null;
  /** last close against the level, % (negative = below) */
  distPct: number | null;
  /** full line for the list */ text: string;
  /** short form for the headline */ short: string;
}
const TF_NAME: Record<SetupChartTf, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
const BAR_WORD: Record<SetupChartTf, string> = { D: 'days', W: 'weeks', M: 'months' };
export function fmtSetupPrice(n: number): string {
  const a = Math.abs(n);
  return a >= 1 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(Number(n.toPrecision(4)));
}
export const ageWords = (n: number) => (n <= 0 ? 'on the last bar' : n === 1 ? '1 bar ago' : `${n} bars ago`);
const distWords = (d: number | null) => (d == null ? '' : Math.abs(d) < 0.05 ? 'at it' : `${Math.abs(d).toFixed(1)}% ${d < 0 ? 'below' : 'above'}`);
/** zzz1044 (F12) — a setup's rule as the CHART reads it: the chart reads the candles on screen, so on weekly candles "3 tight" and its
 *  50-bar average are weekly (50 weeks), not the Pine Screener's weekly closes with the DAILY 50-day average. Said, not hidden. */
export function setupRuleText(code: SetupCode, tf: SetupChartTf = 'D'): string {
  const m = SETUP_META[code];
  if (code === 'WT3') {
    const bar = BAR_WORD[tf].replace(/s$/, '');
    return `On these ${tf === 'D' ? 'daily' : tf === 'W' ? 'weekly' : 'monthly'} candles: three or more closes in a row, each within 1.5% of the ${bar} before, with price above its 50-${bar} average (SMA 50 of the candles on screen); the pivot is the highest high of those ${BAR_WORD[tf]}. ` +
      `The Pine Screener's "3 weeks tight" is a different reading: completed weekly closes with price above the 50-DAY average.`;
  }
  return m.rule;
}
export function setupName(code: SetupCode, dir: 1 | -1, tf: SetupChartTf = 'D'): string {
  switch (code) {
    case 'WT3': return tf === 'W' ? '3 weeks tight' : `3 tight ${BAR_WORD[tf]}`;
    case 'DVX': return dir === 1 ? 'Darvas box top broken' : 'Darvas box bottom broken';
    case 'DC20': return dir === 1 ? 'Donchian 20-bar breakout' : 'Donchian 20-bar breakdown';
    case 'DC55': return dir === 1 ? 'Donchian 55-bar breakout' : 'Donchian 55-bar breakdown';
    case 'SQZF': return dir === 1 ? 'Squeeze fired up' : 'Squeeze fired down';
    // the look-back is one year on every timeframe (252 daily, 52 weekly, 12 monthly bars)
    case 'NH': return SETUP_META.NH.label;
    default: return SETUP_META[code].label;
  }
}
const LEVEL_WORD: Partial<Record<SetupCode, string>> = { WT3: 'pivot', EP: 'gap-day low', GV: 'gap-day low', NH: 'prior high', ATH: 'prior high', SPR: 'support', ECB: 'EMA 20', WP: 'EMA', IB: 'prior bar high' };
const levelWord = (code: SetupCode, dir: 1 | -1) => (code === 'DVX' ? (dir === 1 ? 'top' : 'bottom') : LEVEL_WORD[code] || 'level');

/**
 * The setups active on the last completed bar, most recent first: events inside their window (an episodic pivot / gap only
 * while the close holds the gap-day low), the Darvas box price is inside, a squeeze that is on now.
 * `shown` filters the types (hidden types are left out of the banner too).
 */
export function setupBannerRows(bars: readonly SetupBar[], s: SetupSeriesResult, tf: SetupChartTf, shown?: (c: SetupCode) => boolean): SetupRow[] {
  const n = bars.length;
  if (!n) return [];
  const L = n - 1, close = bars[L].c;
  const ok = (c: SetupCode) => !shown || shown(c);
  const dist = (lv: number | null | undefined) => (lv != null && lv > 0 ? Math.round((close / lv - 1) * 1000) / 10 : null);
  const events: SetupRow[] = [];
  const seen = new Set<string>();
  for (let k = s.events.length - 1; k >= 0; k--) {
    const e: SetupEvent = s.events[k];
    const age = L - e.i;
    if (age < 0 || age >= Math.min(SETUP_ROW_WINDOW, ACTIVE_WINDOW[e.code] || 0) || !ok(e.code)) continue;
    const key = `${e.code}:${e.dir}`;
    if (seen.has(key)) continue;   // the latest one of each kind
    if ((e.code === 'EP' || e.code === 'GV') && e.level != null && close < e.level) continue;
    seen.add(key);
    const lv = e.level ?? null, d = dist(lv);
    const name = setupName(e.code, e.dir, tf);
    const lvTxt = lv != null ? ` · ${levelWord(e.code, e.dir)} ${fmtSetupPrice(lv)}${d != null ? ` · ${distWords(d)}` : ''}` : '';
    events.push({ code: e.code, dir: e.dir, age, state: false, level: lv, distPct: d, text: `${name} · ${ageWords(age)}${lvTxt}${e.note && e.code !== 'WT3' && e.code !== 'DVX' ? ` · ${e.note}` : ''}`, short: `${name} ${ageWords(age)}` });
  }
  events.sort((a, b) => a.age - b.age || SETUP_CODES.indexOf(a.code) - SETUP_CODES.indexOf(b.code));
  const states: SetupRow[] = [];
  const box = s.darvas[s.darvas.length - 1];
  if (ok('DVX') && box && box.state === 'inside' && box.to === L) {
    const d = dist(box.top);
    states.push({ code: 'DVX', dir: 1, age: L - box.from, state: true, level: box.top, distPct: d,
      text: `Darvas box · top ${fmtSetupPrice(box.top)}${d != null ? ` · ${distWords(d)}` : ''} · bottom ${fmtSetupPrice(box.bottom)}`,
      short: `Darvas box top ${fmtSetupPrice(box.top)}${d != null ? ` (${distWords(d)})` : ''}` });
  }
  if (ok('SQZ')) {
    let run = 0;
    for (let i = L; i >= 0 && s.squeeze.on[i]; i--) run++;
    if (run >= 5) {
      const m = s.squeeze.mom[L];
      const lean = m == null ? '' : m > 0 ? ' · momentum up' : m < 0 ? ' · momentum down' : '';
      states.push({ code: 'SQZ', dir: m != null && m < 0 ? -1 : 1, age: run, state: true, level: null, distPct: null, text: `Squeeze on · ${run} bars${lean}`, short: `Squeeze on ${run} bars` });
    }
  }
  // the most recent event leads, then what price is in now (box / squeeze), then the older events
  return events.length ? [events[0], ...states, ...events.slice(1)] : states;
}

export interface SetupBannerModel { text: string; tone: 'up' | 'down' | 'none'; more: number }
export function setupHeadline(rows: readonly SetupRow[], tf: SetupChartTf, status: 'loading' | 'ready' | 'short' | 'idle' = 'ready'): SetupBannerModel {
  const head = `Trader setups · ${TF_NAME[tf]}`;
  if (status === 'loading' || status === 'idle') return { text: `${head} · reading the bars…`, tone: 'none', more: 0 };
  if (status === 'short') return { text: `${head} · too little history`, tone: 'none', more: 0 };
  if (!rows.length) return { text: `${head} · no setup on the last ${SETUP_ROW_WINDOW} bars`, tone: 'none', more: 0 };
  const top = rows.slice(0, 2);
  const more = rows.length - top.length;
  const lead = rows[0];
  const tone = SETUP_NEUTRAL.has(lead.code) || lead.state ? 'none' : lead.dir === 1 ? 'up' : 'down';
  return { text: `${head} · ${top.map((r) => r.short).join(' · ')}${more > 0 ? ` · +${more} more` : ''}`, tone, more };
}

/** Events per code inside the visible bar range [from, to) (indexes into the bars read). */
export function countsInRange(s: SetupSeriesResult, from: number, to: number): Partial<Record<SetupCode, number>> {
  const out: Partial<Record<SetupCode, number>> = {};
  for (const e of s.events) if (e.i >= from && e.i < to) out[e.code] = (out[e.code] || 0) + 1;
  return out;
}

/** Marker colours: green up, red down, grey neutral — the readable shade per theme. */
export function setupColor(code: SetupCode, dir: 1 | -1, light: boolean): string {
  if (SETUP_NEUTRAL.has(code)) return light ? '#5D606B' : '#B2B5BE';
  if (dir === 1) return light ? '#067A66' : '#22C3A6';
  return light ? '#C8102E' : '#FF6B78';
}
