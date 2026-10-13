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
