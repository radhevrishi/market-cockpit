// zzz938 — screener filters: the list of fields, how a filter is checked, and the owner's saved screens (copied from his
// TradingView screens, 7 Oct 2026). Pure — used by the page and the tests. A company whose figure is not known FAILS a filter
// on that figure (TradingView does the same), so a missing number never sneaks a company in.
import type { ScreenRow, ScreenMarket } from './types';

export type NumKey = Exclude<keyof ScreenRow, 't' | 'n' | 'sec' | 'ind' | 'q' | 'approx'>;
export type FieldUnit = '%' | 'x' | 'money' | 'num' | 'price' | 'shares';
export interface FieldDef { key: NumKey; label: string; unit: FieldUnit; markets: ScreenMarket[]; approxNote?: Partial<Record<ScreenMarket, string>> }

export const FIELDS: readonly FieldDef[] = [
  { key: 'mc', label: 'Market cap', unit: 'money', markets: ['US', 'IN'] },
  { key: 'px', label: 'Price', unit: 'price', markets: ['US', 'IN'] },
  { key: 'chg', label: 'Change today', unit: '%', markets: ['US', 'IN'] },
  { key: 'vol', label: 'Volume (last day)', unit: 'shares', markets: ['US', 'IN'] },
  { key: 'avgVol10', label: 'Avg volume, 10 days', unit: 'shares', markets: ['US', 'IN'] },
  { key: 'sma50', label: 'SMA 50', unit: 'price', markets: ['US', 'IN'] },
  { key: 'sma200', label: 'SMA 200', unit: 'price', markets: ['US', 'IN'] },
  { key: 'revQYoY', label: 'Revenue growth, quarterly YoY', unit: '%', markets: ['US', 'IN'] },
  { key: 'revAYoY', label: 'Revenue growth, annual YoY', unit: '%', markets: ['US', 'IN'] },
  { key: 'gpQYoY', label: 'Gross profit growth, quarterly YoY', unit: '%', markets: ['US', 'IN'], approxNote: { IN: 'India: sales minus raw-material cost — Indian results do not print gross profit' } },
  { key: 'gmFY', label: 'Gross margin, FY', unit: '%', markets: ['US', 'IN'], approxNote: { IN: 'India: sales minus raw-material cost, latest year' } },
  { key: 'ebitdaQoQ', label: 'EBITDA growth, quarterly QoQ', unit: '%', markets: ['US', 'IN'], approxNote: { US: 'USA: operating profit + depreciation where filed, else operating profit' } },
  { key: 'ebitdaAYoY', label: 'EBITDA growth, annual YoY', unit: '%', markets: ['US', 'IN'], approxNote: { US: 'USA: operating profit + depreciation where filed, else operating profit' } },
  { key: 'epsQYoY', label: 'EPS (diluted) growth, quarterly YoY', unit: '%', markets: ['US', 'IN'] },
  { key: 'opmTTM', label: 'Operating margin, TTM', unit: '%', markets: ['US', 'IN'] },
  { key: 'ps', label: 'P/S', unit: 'x', markets: ['US', 'IN'] },
  { key: 'evRev', label: 'EV / revenue, TTM', unit: 'x', markets: ['US', 'IN'] },
  { key: 'de', label: 'Debt / equity', unit: 'x', markets: ['US', 'IN'] },
  { key: 'cash', label: 'Cash on hand', unit: 'money', markets: ['US', 'IN'] },
  { key: 'emp', label: 'Employees', unit: 'num', markets: ['US'] },
  { key: 'flt', label: 'Free float %', unit: '%', markets: ['US'] },
  { key: 'bb', label: 'Shares buyback ratio, FY', unit: '%', markets: ['US', 'IN'] },
  { key: 'fs', label: 'F-score, FY', unit: 'num', markets: ['US', 'IN'] },
];
export const fieldOf = (k: string): FieldDef | undefined => FIELDS.find((f) => f.key === k);

/** One filter. `op`: gt / lt / between on a number; above / below = one field against another (SMA 50 above SMA 200); in = sector list. */
export type Filter =
  | { kind: 'num'; key: NumKey; op: 'gt' | 'lt' | 'between'; v: number; v2?: number }
  | { kind: 'cmp'; key: NumKey; op: 'above' | 'below'; other: NumKey }
  | { kind: 'sector'; sectors: string[] };

export interface Screen { id: string; name: string; market: ScreenMarket; filters: Filter[]; builtIn?: boolean }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function passes(r: ScreenRow, f: Filter): boolean {
  if (f.kind === 'sector') return !f.sectors.length || (!!r.sec && f.sectors.includes(r.sec));
  const a = r[f.key] as number | null;
  if (!fin(a)) return false;
  if (f.kind === 'cmp') { const b = r[f.other] as number | null; return fin(b) && (f.op === 'above' ? a > b : a < b); }
  if (f.op === 'gt') return a > f.v;
  if (f.op === 'lt') return a < f.v;
  const v2 = fin(f.v2) ? f.v2 : f.v;
  return a >= Math.min(f.v, v2) && a <= Math.max(f.v, v2);
}
export const runScreen = (rows: readonly ScreenRow[], filters: readonly Filter[]): ScreenRow[] => rows.filter((r) => filters.every((f) => passes(r, f)));

/** How many companies each single filter keeps (so the owner sees which filter is the tight one). */
export function filterCounts(rows: readonly ScreenRow[], filters: readonly Filter[]): number[] {
  return filters.map((f) => rows.reduce((n, r) => n + (passes(r, f) ? 1 : 0), 0));
}

// ── labels ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function fmtValue(v: number | null | undefined, unit: FieldUnit, market: ScreenMarket): string {
  if (!fin(v)) return '—';
  const loc = market === 'US' ? 'en-US' : 'en-IN';
  if (unit === '%') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'x') return `${Math.round(v * 100) / 100}`;
  if (unit === 'money') {
    if (market === 'US') return v >= 1000 ? `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}B` : `$${Math.round(v)}M`;
    return `₹${Math.round(v).toLocaleString(loc)} Cr`;
  }
  if (unit === 'shares' || unit === 'num') return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`;
  return `${market === 'US' ? '$' : '₹'}${v.toLocaleString(loc, { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}
export function filterLabel(f: Filter, market: ScreenMarket): string {
  if (f.kind === 'sector') return `Sector (${f.sectors.length || 'all'})`;
  const d = fieldOf(f.key); const name = d?.label || f.key;
  if (f.kind === 'cmp') return `${name} ${f.op === 'above' ? '>' : '<'} ${fieldOf(f.other)?.label || f.other}`;
  const u = d?.unit || 'num';
  if (f.op === 'between') return `${name} ${fmtValue(f.v, u, market)} to ${fmtValue(f.v2 ?? f.v, u, market)}`;
  return `${name} ${f.op === 'gt' ? '>' : '<'} ${fmtValue(f.v, u, market)}`;
}

// ── the owner's screens (from his TradingView screens, 7 Oct 2026) ────────────────────────────────────────────────────
// Market caps: USA in $ million, India in ₹ crore (100M–50B INR = ₹10 Cr – ₹5,000 Cr). Sector lists start empty (= all):
// TradingView's sector names differ from Nasdaq / screener.in names, so the owner ticks his sectors once and saves.
const n = (key: NumKey, op: 'gt' | 'lt', v: number): Filter => ({ kind: 'num', key, op, v });
const btw = (key: NumKey, v: number, v2: number): Filter => ({ kind: 'num', key, op: 'between', v, v2 });
const smaUp: Filter = { kind: 'cmp', key: 'sma50', op: 'above', other: 'sma200' };
export const BUILT_IN_SCREENS: readonly Screen[] = [
  { id: 'us-super-scalers', name: 'Future Super Scalers like NBIS', market: 'US', builtIn: true, filters: [
    { kind: 'sector', sectors: [] }, n('vol', 'gt', 30_000), btw('mc', 200, 30_000), n('revAYoY', 'gt', 10), n('de', 'lt', 2), n('revQYoY', 'gt', 20), smaUp,
  ] },
  { id: 'us-future-nvda', name: 'Future NVDA ALAB APP PLTR', market: 'US', builtIn: true, filters: [
    { kind: 'sector', sectors: [] }, n('ebitdaQoQ', 'gt', 0), n('revQYoY', 'gt', 25), n('revAYoY', 'gt', 10), n('emp', 'gt', 100), n('gmFY', 'gt', 25),
    n('de', 'lt', 1), btw('ps', 3, 333), n('gpQYoY', 'gt', 50), n('opmTTM', 'gt', -15), n('bb', 'gt', -25),
  ] },
  { id: 'in-zachs', name: 'ZACHS SCREENER India', market: 'IN', builtIn: true, filters: [
    n('revQYoY', 'gt', 9), n('epsQYoY', 'gt', 15), btw('mc', 10, 5_000), smaUp, { kind: 'sector', sectors: [] }, n('gpQYoY', 'gt', 5), btw('ps', 0, 7),
    n('gmFY', 'gt', 15), n('fs', 'gt', 4.9), n('ebitdaAYoY', 'gt', -10), n('evRev', 'lt', 20), n('cash', 'gt', 0), n('avgVol10', 'gt', 60_000),
  ] },
];

/** Saved screens are kept in the browser (synced to the owner's database by the vault). Pure clean-up of what was stored. */
export const SCREENS_KEY = 'mc:stock-screens:v1';
export function cleanScreens(raw: unknown): Screen[] {
  if (!Array.isArray(raw)) return [];
  const out: Screen[] = [];
  for (const s of raw.slice(0, 100)) {
    if (!s || typeof s !== 'object') continue;
    const x = s as any;
    if (typeof x.id !== 'string' || typeof x.name !== 'string' || (x.market !== 'US' && x.market !== 'IN') || !Array.isArray(x.filters)) continue;
    const filters = (x.filters as any[]).filter((f) => f && (f.kind === 'sector' ? Array.isArray(f.sectors) : fieldOf(f.key) && (f.kind === 'cmp' ? !!fieldOf(f.other) : fin(f.v))));
    out.push({ id: x.id.slice(0, 60), name: x.name.slice(0, 80), market: x.market, filters });
  }
  return out;
}
