// zzz1038 — the watchlist's right-click menu, as in TradingView (owner: "in the watchlist also right-click — I should be able to do
// all tasks like TradingView"). Pure: the items for a row or a section header, and the list edits behind them. Opening charts,
// copying and prompts happen in WatchlistPanel. Item ids carry their target ("flag:red", "move:<section id>", "copy-to:<list id>").
import type { ChartMenuItem } from './ChartContextMenu';
import {
  FLAGS, findItem, copyItemToList, dissolveSection, moveItem, moveItemToEdge, patchItem, patchSection, sortSection, updateList,
  type Quote, type WlList, type WlStore,
} from '@/lib/chart-watchlist';
import { displaySectionName } from '@/lib/watchlist-display';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const secLabel = (name: string) => (name ? displaySectionName(name) : 'No section');

/** Right-click on a row. `companyName` = the name from its quote (Copy company name is off without one). */
export function watchlistRowMenu(store: WlStore, list: WlList, key: string, companyName?: string | null): ChartMenuItem[] {
  const f = findItem(list, key);
  if (!f) return [];
  const { item, section, index } = f;
  const others = store.lists.filter((l) => l.id !== list.id);
  return [
    { id: 'open', label: 'Open chart', kbd: 'Enter' },
    { id: 'open-tab', label: 'Open chart in new tab' },
    { id: 'copy-sym', label: 'Copy symbol', sepBefore: true },
    { id: 'copy-name', label: 'Copy company name', disabled: !companyName },
    { id: 'flag', label: 'Flag', sepBefore: true, children: [
      ...FLAGS.map((c) => ({ id: `flag:${c}`, label: cap(c), checked: item.flag === c })),
      { id: 'flag:none', label: 'Remove flag', disabled: !item.flag, sepBefore: true },
    ] },
    { id: 'move', label: 'Move to section', children: [
      ...list.sections.map((s) => ({ id: `move:${s.id}`, label: secLabel(s.name), checked: s.id === section.id, disabled: s.id === section.id })),
      { id: 'move:new', label: 'New section…', sepBefore: true },
    ] },
    { id: 'top', label: 'Move to top of section', disabled: index === 0 },
    { id: 'bottom', label: 'Move to bottom of section', disabled: index === section.items.length - 1 },
    { id: 'copy-list', label: 'Add to another watchlist', children: [
      ...others.map((l) => { const has = !!findItem(l, key); return { id: `copy-to:${l.id}`, label: has ? `${l.name} (already in)` : l.name, disabled: has }; }),
      { id: 'copy-to:new', label: 'New list…', sepBefore: others.length > 0 },
    ] },
    { id: 'news', label: 'News for this ticker', sepBefore: true },
    { id: 'remove', label: 'Remove from watchlist', danger: true, sepBefore: true },
  ];
}

/** Right-click on a section header. */
export function watchlistSectionMenu(list: WlList, sectionId: string): ChartMenuItem[] {
  const s = list.sections.find((x) => x.id === sectionId);
  if (!s) return [];
  return [
    { id: 'sec-add', label: 'Add symbol to this section' },
    { id: 'sec-rename', label: 'Rename section…', sepBefore: true },
    { id: 'sec-toggle', label: s.collapsed ? 'Expand section' : 'Collapse section' },
    { id: 'sec-sort:symbol', label: 'Sort section by symbol (A to Z)', sepBefore: true, disabled: s.items.length < 2 },
    { id: 'sec-sort:chg', label: 'Sort section by change % (high to low)', disabled: s.items.length < 2 },
    { id: 'sec-remove', label: 'Remove section (keep its symbols)…', danger: true, sepBefore: true },
  ];
}

/** The store after a row item that only edits lists (flags, moves, copies to a list). null = not a plain edit (the panel handles it). */
export function applyRowMenu(store: WlStore, listId: string, key: string, id: string): WlStore | null {
  const list = store.lists.find((l) => l.id === listId);
  const f = list ? findItem(list, key) : null;
  if (!list || !f) return null;
  const edit = (fn: (l: WlList) => WlList) => updateList(store, listId, fn);
  if (id === 'flag:none') return edit((l) => patchItem(l, key, { flag: undefined }));
  if (id.startsWith('flag:')) { const c = id.slice(5); return (FLAGS as readonly string[]).includes(c) ? edit((l) => patchItem(l, key, { flag: c as (typeof FLAGS)[number] })) : null; }
  if (id === 'top' || id === 'bottom') return edit((l) => moveItemToEdge(l, key, id));
  if (id.startsWith('move:') && id !== 'move:new') return edit((l) => moveItem(l, key, id.slice(5)));
  if (id.startsWith('copy-to:') && id !== 'copy-to:new') return copyItemToList(store, id.slice(8), f.item);
  return null;
}

/** The store after a section item that only edits the list (collapse, sort, remove keeping symbols). null = handled by the panel. */
export function applySectionMenu(store: WlStore, listId: string, sectionId: string, id: string, quotes: Record<string, Quote | undefined>): WlStore | null {
  const list = store.lists.find((l) => l.id === listId);
  const s = list?.sections.find((x) => x.id === sectionId);
  if (!list || !s) return null;
  const edit = (fn: (l: WlList) => WlList) => updateList(store, listId, fn);
  if (id === 'sec-toggle') return edit((l) => patchSection(l, sectionId, { collapsed: !s.collapsed }));
  if (id === 'sec-sort:symbol' || id === 'sec-sort:chg') return edit((l) => sortSection(l, sectionId, id === 'sec-sort:symbol' ? 'symbol' : 'chg', quotes));
  if (id === 'sec-remove') return edit((l) => dissolveSection(l, sectionId));
  return null;
}

/** /charts link for a row (used by "Open chart in new tab"). */
export function chartHref(it: { m: 'IN' | 'US'; t: string; x?: string }): string {
  return `/charts?t=${encodeURIComponent(it.t)}&m=${it.m}${it.m === 'IN' && it.x ? `&x=${encodeURIComponent(it.x)}` : ''}`;
}
/** /news search for a row's ticker. */
export const newsHref = (t: string) => `/news?q=${encodeURIComponent(t)}`;
