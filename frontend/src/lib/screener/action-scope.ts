// zzz994 (MC-04 / MC-06) — ONE rule for which companies a bulk action (Copy for TradingView, CSV, Add to watchlist, chart review
// queue, shortlist) acts on, shared by the Stock Screener and the Pine Screener. Pure — used by both pages and the tests.
//
//   results     = the filter matches narrowed by the search box (and any other on-page narrowing) — the DEFAULT, because the
//                 action button sits beside the searched table: one searched row → one ticker;
//   all         = every filter match, ignoring the search (an explicit choice, labelled with its count);
//   selected    = the rows ticked in the table (Pine);
//   provisional = companies whose rules could not all be evaluated (Pine, MC-07) — never part of the other scopes.
// The table may show fewer rows than `results` (the first 200): actions never act on just the page, and the counts say so.
import type { ScreenMarket } from './types';

export type ActionScope = 'results' | 'all' | 'selected' | 'provisional';
export interface ScopeSets<T> {
  /** filter matches after search / on-page narrowing, in table order */
  results: readonly T[];
  /** every filter match (strict), in table order */
  all: readonly T[];
  /** keys of the ticked rows */
  selected?: ReadonlySet<string> | null;
  /** companies that could not be fully evaluated (preview only) */
  provisional?: readonly T[];
}
export interface ScopeCounts { shown: number; results: number; all: number; selected: number; provisional: number }

/** The companies an action acts on. `selected` keeps table order and only ticks that are still strict matches. */
export function scopeItems<T>(sets: ScopeSets<T>, scope: ActionScope, keyOf: (x: T) => string): T[] {
  if (scope === 'all') return sets.all.slice();
  if (scope === 'provisional') return (sets.provisional || []).slice();
  if (scope === 'selected') { const sel = sets.selected; return sel && sel.size ? sets.all.filter((x) => sel.has(keyOf(x))) : []; }
  return sets.results.slice();
}
export function scopeCounts<T>(sets: ScopeSets<T>, shown: number, keyOf: (x: T) => string): ScopeCounts {
  return {
    shown: Math.min(shown, sets.results.length), results: sets.results.length, all: sets.all.length,
    selected: sets.selected?.size ? sets.all.filter((x) => sets.selected!.has(keyOf(x))).length : 0,
    provisional: sets.provisional?.length || 0,
  };
}
/** The scope to use: the chosen one when it still has companies, else the search result (never silently "all"). */
export function effectiveScope(chosen: ActionScope, c: ScopeCounts): ActionScope {
  if (chosen === 'selected' && !c.selected) return 'results';
  if (chosen === 'provisional' && !c.provisional) return 'results';
  return chosen;
}
export function scopeLabel(scope: ActionScope, c: ScopeCounts, searching: boolean): string {
  const n = (k: number) => k.toLocaleString('en-US');
  if (scope === 'all') return `All ${n(c.all)} filter matches${searching ? ' (search ignored)' : ''}`;
  if (scope === 'selected') return `Selected (${n(c.selected)})`;
  if (scope === 'provisional') return `Provisional (${n(c.provisional)}) — rules not fully evaluated`;
  return searching ? `Search matches (${n(c.results)})` : `Filter matches (${n(c.results)})`;
}
/** "12 shown · 40 search matches · 856 filter matches" — every count kept apart (MC-06). */
export function countsLine(c: ScopeCounts, searching: boolean): string {
  const n = (k: number) => k.toLocaleString('en-US');
  const parts = [`${n(c.shown)} shown`];
  if (searching) parts.push(`${n(c.results)} search match${c.results === 1 ? '' : 'es'}`);
  parts.push(`${n(c.all)} filter match${c.all === 1 ? '' : 'es'}`);
  if (c.selected) parts.push(`${n(c.selected)} selected`);
  return parts.join(' · ');
}
/** The four distinct empty states (MC-06): no data at all, no filter match, no search match, or nothing to show for a list. */
export type EmptyState = 'no-data' | 'no-filter-match' | 'no-search-match' | null;
export function emptyState(p: { dataRows: number; filterMatches: number; searchMatches: number; searching: boolean }): EmptyState {
  if (!p.dataRows) return 'no-data';
  if (!p.filterMatches) return 'no-filter-match';
  if (p.searching && !p.searchMatches) return 'no-search-match';
  return null;
}
/** The confirmation line shown before symbols are added to a watchlist: destination + count + scope. */
export function confirmAddText(count: number, listName: string, label: string): string {
  return `Add ${count.toLocaleString('en-US')} symbol${count === 1 ? '' : 's'} (${label}) to “${listName}”? Duplicates are skipped; each list holds up to 1,000.`;
}
/** TradingView paste text: NSE:TICKER for India, plain tickers for the USA. */
export function tvTickerText(tickers: readonly string[], market: ScreenMarket, exch?: (t: string) => string | null | undefined): string {
  return tickers.map((t) => (market === 'IN' ? `${exch?.(t) === 'BSE' ? 'BSE' : 'NSE'}:${t}` : t)).join(',');
}
