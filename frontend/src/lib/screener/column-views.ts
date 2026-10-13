// zzz1006 — column view presets for the Stock Screener table. A preset changes which columns are VISIBLE only: the screen's filters,
// the result, the order, Copy / CSV / shortlist columns are untouched (the CSV keeps the screen's own columns). Pure.
import { fieldOf, filterKeys, fmtValue, type FieldUnit, type Filter, type NumKey } from './filters';
import type { ScreenMarket } from './types';

export type ColumnView = 'screen' | 'overview' | 'growth' | 'valuation' | 'quality' | 'technicals';
export const COLUMN_VIEWS: ReadonlyArray<{ id: ColumnView; label: string; hint: string }> = [
  { id: 'screen', label: 'Screen', hint: 'Price, change, market cap and every figure the filters use' },
  { id: 'overview', label: 'Overview', hint: 'Price, change, market cap, 1-month performance, P/E, quarterly revenue growth' },
  { id: 'growth', label: 'Growth', hint: 'Revenue, EPS and EBITDA growth' },
  { id: 'valuation', label: 'Valuation', hint: 'P/E, P/S, EV / revenue, price / cash' },
  { id: 'quality', label: 'Quality', hint: 'Margins, returns, FCF margin, debt / equity' },
  { id: 'technicals', label: 'Technicals', hint: 'RSI, performance, RS rating, stage, relative volume, ATR — and the chart-pattern column' },
];
const BASE: NumKey[] = ['px', 'chg', 'mc'];
const PRESET: Record<Exclude<ColumnView, 'screen'>, string[]> = {
  overview: ['perf1M', 'pe', 'revQYoY'],
  growth: ['revQYoY', 'revAYoY', 'revTTMYoY', 'epsQYoY', 'epsTTMYoY', 'ebitdaQYoY'],
  valuation: ['pe', 'ps', 'evRev', 'pcf'],
  quality: ['gmFY', 'opmTTM', 'nmTTM', 'roeTTM', 'roceTTM', 'fcfmTTM', 'de'],
  technicals: ['rsi', 'perf1M', 'perf3M', 'rsR', 'stage', 'rvol', 'atrP'],
};
export const COLUMN_VIEW_KEY = 'mc:screener-colview:v1';

/** The screen's own columns — price, change, market cap, then every field a filter uses (exactly the pre-zzz1006 table / CSV set). */
export function screenColumns(filters: readonly Filter[]): NumKey[] {
  const keys: NumKey[] = [...BASE];
  for (const f of filters) for (const k of filterKeys(f)) if (!keys.includes(k)) keys.push(k);
  return keys;
}
/** The visible numeric columns for a view; fields the market does not have are left out. */
export function viewColumns(view: ColumnView, filters: readonly Filter[], market: ScreenMarket): NumKey[] {
  if (view === 'screen') return screenColumns(filters);
  const keys = [...BASE, ...PRESET[view]] as NumKey[];
  return keys.filter((k, i) => keys.indexOf(k) === i && !!fieldOf(k)?.markets.includes(market));
}
export function cleanColumnView(v: unknown): ColumnView { return COLUMN_VIEWS.some((x) => x.id === v) ? (v as ColumnView) : 'screen'; }
export function readColumnView(): ColumnView { try { return cleanColumnView(localStorage.getItem(COLUMN_VIEW_KEY)); } catch { return 'screen'; } }
export function writeColumnView(v: ColumnView): void { try { localStorage.setItem(COLUMN_VIEW_KEY, v); } catch { /* display preference only */ } }

const SIGNED = /^(chg|chgOpen|chg1W|perf)/;
/** Table / panel text for a figure (display only — filters, CSV and tooltips keep the exact value): percentages and multiples with
 *  one decimal so a column lines up, a sign on daily change and performance figures; everything else as fmtValue. */
export function cellText(v: number | null | undefined, unit: FieldUnit, market: ScreenMarket, key?: string): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (unit === '%') return `${key && SIGNED.test(key) && v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 1000 ? 0 : 1)}%`;
  if (unit === 'x') return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
  return fmtValue(v, unit, market);
}

// ── zzz1012 — table presentation helpers (display only: nothing here feeds a filter, the result set, Copy or the CSV) ───────────
/** The unit shown after a column name in the header: "%", "×" (multiples, whose cells carry no sign), the currency for prices and
 *  money columns (cells already scale with $ B / ₹ Cr), "shares" for volumes. */
export function unitSuffix(unit: FieldUnit | undefined, market: ScreenMarket): string {
  if (unit === '%') return '%';
  if (unit === 'x') return '×';
  if (unit === 'money' || unit === 'price') return market === 'US' ? 'USD' : 'INR';
  if (unit === 'usd') return 'USD';
  if (unit === 'shares') return 'shares';
  return '';
}
/** Median of the finite numbers (null when there are none). */
export function median(values: readonly unknown[]): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/** Per column: the median over the rows and how many rows have the figure. */
export function columnMedians<R extends Record<string, unknown>>(rows: readonly R[], keys: readonly string[]): Record<string, { med: number | null; n: number }> {
  const out: Record<string, { med: number | null; n: number }> = {};
  for (const k of keys) { const vals = rows.map((r) => r[k]); out[k] = { med: median(vals), n: vals.filter((x) => typeof x === 'number' && Number.isFinite(x)).length }; }
  return out;
}
/** Advancers / decliners / unchanged by today's change (rows without a change are not counted). */
export function breadth(rows: ReadonlyArray<{ chg?: number | null }>): { up: number; down: number; flat: number } {
  let up = 0, down = 0, flat = 0;
  for (const r of rows) { const c = r.chg; if (typeof c !== 'number' || !Number.isFinite(c)) continue; if (c > 0) up++; else if (c < 0) down++; else flat++; }
  return { up, down, flat };
}
/** Table sort: numbers by value, text alphabetically; a missing figure always sorts LAST whichever way the column is sorted. */
export function compareRows(a: Record<string, unknown>, b: Record<string, unknown>, key: string, dir: 1 | -1): number {
  const x = a[key], y = b[key];
  if (typeof x === 'string' || typeof y === 'string') {
    const sx = typeof x === 'string' ? x : '', sy = typeof y === 'string' ? y : '';
    if (!sx || !sy) return sx === sy ? 0 : sx ? -1 : 1;
    return sx.localeCompare(sy) * dir;
  }
  const nx = typeof x === 'number' && Number.isFinite(x), ny = typeof y === 'number' && Number.isFinite(y);
  if (!nx || !ny) return nx === ny ? 0 : nx ? -1 : 1;
  return ((x as number) - (y as number)) * dir;
}
export type ShortcutAction = 'find' | 'down' | 'up' | 'open' | 'details' | 'select' | 'help' | 'escape';
/** Keyboard shortcuts on the results (/ find, j / k rows, Enter chart, o details, x select, ? help). Never while typing in
 *  a field or with Ctrl / ⌘ / Alt held, so browser and system shortcuts keep working. */
export function shortcutAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown }): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target as { tagName?: string; isContentEditable?: boolean; type?: string } | null | undefined;
  const tag = (t?.tagName || '').toUpperCase();
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || !!t?.isContentEditable || (tag === 'INPUT' && !['checkbox', 'radio', 'button'].includes(String(t?.type || 'text')));
  if (typing) return e.key === 'Escape' ? 'escape' : null;
  switch (e.key) {
    case '/': return 'find';
    case 'j': return 'down';
    case 'k': return 'up';
    case 'Enter': return tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ? null : 'open';
    case 'o': return 'details';
    case 'x': return 'select';
    case '?': return 'help';
    case 'Escape': return 'escape';
    default: return null;
  }
}
