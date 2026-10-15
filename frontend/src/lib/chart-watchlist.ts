// zzz940 — watchlists for the /charts right-hand panel (pure logic, no window): the stored shape and its clean-up, list /
// section / row operations (all return new objects), sorting, the rows in screen order (for ↑/↓), and the TradingView
// watchlist text format (import + export, so a list round-trips: "###SECTION,NSE:TATVA,NASDAQ:AKAM").
import { IN_TICKER_RE, US_TICKER_RE, type Market } from './chart-math';

export const CHART_WATCHLISTS_KEY = 'mc:chart-watchlists:v1';

export const FLAGS = ['red', 'blue', 'green', 'orange', 'purple'] as const;
export type Flag = (typeof FLAGS)[number];
export const FLAG_COLORS: Record<Flag, string> = { red: '#E53935', blue: '#1E66F5', green: '#2E7D32', orange: '#F57C00', purple: '#8E24AA' };

export interface WlItem { m: Market; t: string; flag?: Flag; x?: string }   // x = exchange as TradingView writes it (for export)
export interface WlSection { id: string; name: string; collapsed: boolean; items: WlItem[] }
export interface WlList { id: string; name: string; sections: WlSection[] }
export interface WlStore { lists: WlList[]; activeId: string }

export const MAX_LISTS = 50, MAX_SECTIONS = 60, MAX_ITEMS = 1000;

let _seq = 0;
export function newId(prefix: string): string {
  _seq = (_seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const itemKey = (it: { m: Market; t: string; x?: string }) => it.m === 'IN' && it.x === 'BSE' ? `IN:BSE:${it.t}` : `${it.m}:${it.t}`;
const isFlag = (f: unknown): f is Flag => typeof f === 'string' && (FLAGS as readonly string[]).includes(f);
export function nextFlag(f: Flag | undefined): Flag | undefined {
  if (!f) return FLAGS[0];
  const i = FLAGS.indexOf(f);
  return i >= FLAGS.length - 1 ? undefined : FLAGS[i + 1];
}

function validItem(m: unknown, t: unknown): m is Market {
  if (m !== 'IN' && m !== 'US') return false;
  return typeof t === 'string' && (m === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(t);
}
const cleanName = (s: unknown, fallback: string, max = 60) => {
  const v = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
  return v || fallback;
};

/** Clean whatever came out of storage (or another device). Never throws; always returns at least one list. */
export function sanitizeStore(raw: unknown): WlStore {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const lists: WlList[] = [];
  const seenList = new Set<string>();
  for (const l of Array.isArray(r.lists) ? r.lists.slice(0, MAX_LISTS) : []) {
    if (!l || typeof l !== 'object') continue;
    let id = typeof l.id === 'string' && l.id ? l.id.slice(0, 40) : newId('l');
    if (seenList.has(id)) id = newId('l');
    seenList.add(id);
    const seenItem = new Set<string>();
    let count = 0;
    const sections: WlSection[] = [];
    const seenSec = new Set<string>();
    for (const s of Array.isArray(l.sections) ? l.sections.slice(0, MAX_SECTIONS) : []) {
      if (!s || typeof s !== 'object') continue;
      let sid = typeof s.id === 'string' && s.id ? s.id.slice(0, 40) : newId('s');
      if (seenSec.has(sid)) sid = newId('s');
      seenSec.add(sid);
      const items: WlItem[] = [];
      for (const it of Array.isArray(s.items) ? s.items : []) {
        if (!it || count >= MAX_ITEMS) continue;
        const t = typeof it.t === 'string' ? it.t.trim().toUpperCase() : it.t;
        if (!validItem(it.m, t)) continue;
        const k = itemKey({ m: it.m, t, x: it.x });
        if (seenItem.has(k)) continue;
        seenItem.add(k); count++;
        const out: WlItem = { m: it.m, t };
        if (isFlag(it.flag)) out.flag = it.flag;
        if (typeof it.x === 'string' && /^[A-Z]{2,10}$/.test(it.x)) out.x = it.x;
        items.push(out);
      }
      sections.push({ id: sid, name: typeof s.name === 'string' ? s.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) : '', collapsed: s.collapsed === true, items });
    }
    if (!sections.length) sections.push({ id: newId('s'), name: '', collapsed: false, items: [] });
    lists.push({ id, name: cleanName(l.name, 'Watchlist'), sections });
  }
  if (!lists.length) lists.push(emptyList('My Watchlist'));
  const activeId = lists.some((l) => l.id === r.activeId) ? String(r.activeId) : lists[0].id;
  return { lists, activeId };
}

export function emptyList(name: string): WlList {
  return { id: newId('l'), name: cleanName(name, 'Watchlist'), sections: [{ id: newId('s'), name: '', collapsed: false, items: [] }] };
}

/** First visit: "My Watchlist" from the site's watchlist (India tickers) and "Portfolio" from the India book, when present. */
export function seedStore(watchTickers: unknown, holdings: unknown): WlStore {
  const toItems = (arr: string[]): WlItem[] => {
    const out: WlItem[] = []; const seen = new Set<string>();
    for (const raw of arr) {
      const t = String(raw || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '');
      if (!IN_TICKER_RE.test(t) || seen.has(t)) continue;
      seen.add(t); out.push({ m: 'IN', t });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  };
  const wl = toItems(Array.isArray(watchTickers) ? watchTickers.map((x: any) => (typeof x === 'string' ? x : x?.ticker || x?.symbol || '')) : []);
  const pf = toItems(Array.isArray(holdings) ? holdings.map((h: any) => (typeof h === 'string' ? h : h?.symbol || h?.ticker || '')) : []);
  const lists: WlList[] = [];
  const my = emptyList('My Watchlist'); my.sections[0].items = wl; lists.push(my);
  if (pf.length) { const p = emptyList('Portfolio'); p.sections[0].items = pf; lists.push(p); }
  return { lists, activeId: lists[0].id };
}

// ── store / list operations (immutable) ─────────────────────────────────────
export const activeList = (s: WlStore): WlList => s.lists.find((l) => l.id === s.activeId) || s.lists[0];
export function updateList(s: WlStore, id: string, fn: (l: WlList) => WlList): WlStore {
  return { ...s, lists: s.lists.map((l) => (l.id === id ? fn(l) : l)) };
}
export function addList(s: WlStore, name: string): WlStore {
  if (s.lists.length >= MAX_LISTS) return s;
  const l = emptyList(name);
  return { lists: [...s.lists, l], activeId: l.id };
}
export function removeList(s: WlStore, id: string): WlStore {
  const lists = s.lists.filter((l) => l.id !== id);
  if (!lists.length) lists.push(emptyList('My Watchlist'));
  return { lists, activeId: lists.some((l) => l.id === s.activeId) ? s.activeId : lists[0].id };
}
export const renameList = (l: WlList, name: string): WlList => ({ ...l, name: cleanName(name, l.name) });
export const listCount = (l: WlList) => l.sections.reduce((n, s) => n + s.items.length, 0);
export const findItem = (l: WlList, key: string) => {
  for (const s of l.sections) { const i = s.items.findIndex((it) => itemKey(it) === key); if (i >= 0) return { section: s, index: i, item: s.items[i] }; }
  return null;
};

/** Add a row to a section (end). Returns the same list when the symbol is already in the list. */
export function addItem(l: WlList, sectionId: string | null, item: WlItem): WlList {
  if (!validItem(item.m, item.t) || findItem(l, itemKey(item)) || listCount(l) >= MAX_ITEMS) return l;
  const sid = sectionId && l.sections.some((s) => s.id === sectionId) ? sectionId : l.sections[l.sections.length - 1].id;
  return { ...l, sections: l.sections.map((s) => (s.id === sid ? { ...s, items: [...s.items, item] } : s)) };
}
export function removeItem(l: WlList, key: string): WlList {
  return { ...l, sections: l.sections.map((s) => ({ ...s, items: s.items.filter((it) => itemKey(it) !== key) })) };
}
export function patchItem(l: WlList, key: string, patch: Partial<WlItem>): WlList {
  return { ...l, sections: l.sections.map((s) => ({ ...s, items: s.items.map((it) => {
    if (itemKey(it) !== key) return it;
    const n: WlItem = { ...it, ...patch };
    if (!n.flag) delete n.flag;
    return n;
  }) })) };
}
/** Move a row into a section, before position `index` (end when omitted). Works inside one section too (reorder). */
export function moveItem(l: WlList, key: string, toSectionId: string, index?: number): WlList {
  const found = findItem(l, key);
  if (!found || !l.sections.some((s) => s.id === toSectionId)) return l;
  const item = found.item;
  const removed = l.sections.map((s) => (s.id === found.section.id ? { ...s, items: s.items.filter((_, i) => i !== found.index) } : s));
  return { ...l, sections: removed.map((s) => {
    if (s.id !== toSectionId) return s;
    // `index` is a position in the section as it was BEFORE the row was taken out
    let at = index == null ? s.items.length : index;
    if (index != null && found.section.id === toSectionId && found.index < index) at -= 1;
    at = Math.max(0, Math.min(s.items.length, at));
    const items = s.items.slice(); items.splice(at, 0, item);
    return { ...s, items };
  }) };
}
export function addSection(l: WlList, name: string): WlList {
  if (l.sections.length >= MAX_SECTIONS) return l;
  return { ...l, sections: [...l.sections, { id: newId('s'), name: cleanName(name, 'New section'), collapsed: false, items: [] }] };
}
export function patchSection(l: WlList, id: string, patch: Partial<Pick<WlSection, 'name' | 'collapsed'>>): WlList {
  return { ...l, sections: l.sections.map((s) => (s.id === id ? { ...s, ...patch, ...(patch.name != null ? { name: patch.name.trim().slice(0, 60) } : {}) } : s)) };
}
/** Remove a section; its rows move to the section above (or below when it is the first). The last section cannot go. */
export function removeSection(l: WlList, id: string): WlList {
  const i = l.sections.findIndex((s) => s.id === id);
  if (i < 0 || l.sections.length <= 1) return l;
  const target = i > 0 ? i - 1 : 1;
  const moved = l.sections[i].items;
  return { ...l, sections: l.sections.map((s, k) => (k === target ? { ...s, items: k < i ? [...s.items, ...moved] : [...moved, ...s.items] } : s)).filter((_, k) => k !== i) };
}

// ── zzz1038 — right-click menu helpers (pure; every one keeps all symbols) ──
/** Move a row to the top or the bottom of its own section. */
export function moveItemToEdge(l: WlList, key: string, edge: 'top' | 'bottom'): WlList {
  const f = findItem(l, key);
  if (!f) return l;
  return moveItem(l, key, f.section.id, edge === 'top' ? 0 : undefined);
}
/** Move a row into a new section (added at the end of the list) named `name`. Same list when sections are at their limit. */
export function moveItemToNewSection(l: WlList, key: string, name: string): WlList {
  if (!findItem(l, key) || l.sections.length >= MAX_SECTIONS) return l;
  const withSec = addSection(l, name);
  return moveItem(withSec, key, withSec.sections[withSec.sections.length - 1].id);
}
/** Where a removed row was, so "Undo" can put it back in the same place. */
export interface RemovedItem { sectionId: string; index: number; item: WlItem }
export function removedFrom(l: WlList, key: string): RemovedItem | null {
  const f = findItem(l, key);
  return f ? { sectionId: f.section.id, index: f.index, item: f.item } : null;
}
/** Undo a removal: the row goes back to its section and position (last section when that one is gone). No change when it is
 *  already in the list again. */
export function restoreItem(l: WlList, r: RemovedItem): WlList {
  const k = itemKey(r.item);
  if (findItem(l, k)) return l;
  const sid = l.sections.some((s) => s.id === r.sectionId) ? r.sectionId : null;
  const added = addItem(l, sid, r.item);
  if (added === l || !sid) return added;
  return moveItem(added, k, sid, r.index);
}
/** Copy a row (with its flag) into another list's last section; the open list stays the open list. */
export function copyItemToList(s: WlStore, listId: string, item: WlItem): WlStore {
  return updateList(s, listId, (l) => addItem(l, null, { ...item }));
}
/** A new list holding this one row; the open list stays the open list. */
export function copyItemToNewList(s: WlStore, name: string, item: WlItem): WlStore {
  if (s.lists.length >= MAX_LISTS) return s;
  const l = emptyList(name);
  l.sections[0].items = validItem(item.m, item.t) ? [{ ...item }] : [];
  return { ...s, lists: [...s.lists, l] };
}
/** Sort the stored order of one section: by symbol A→Z, or by today's change % high→low (rows without a quote last). */
export function sortSection(l: WlList, id: string, by: 'symbol' | 'chg', quotes: Record<string, Quote | undefined>): WlList {
  const sort: SortState = by === 'symbol' ? { key: 'symbol', dir: 'asc' } : { key: 'chg', dir: 'desc' };
  return { ...l, sections: l.sections.map((s) => (s.id === id ? { ...s, items: sortItems(s.items, sort, quotes) } : s)) };
}
/** Remove a section header but keep its symbols: they join the unnamed (no section) group at the end of it. When the list has
 *  no unnamed group, this section simply loses its name and moves to the top (so its rows show above every named section). */
export function dissolveSection(l: WlList, id: string): WlList {
  const i = l.sections.findIndex((s) => s.id === id);
  if (i < 0 || !l.sections[i].name) return l;
  const sec = l.sections[i];
  const loose = l.sections.findIndex((s, k) => k !== i && !s.name);
  if (loose < 0) return { ...l, sections: [{ ...sec, name: '', collapsed: false }, ...l.sections.filter((_, k) => k !== i)] };
  return { ...l, sections: l.sections.map((s, k) => (k === loose ? { ...s, items: [...s.items, ...sec.items] } : s)).filter((_, k) => k !== i) };
}
/** Copy-symbol text: NSE:TICKER (BSE:CODE for BSE rows) for India, the bare ticker for the US. */
export function copySymbolText(it: { m: Market; t: string; x?: string }): string {
  if (it.m === 'US') return it.t;
  return `${it.x === 'BSE' || (!it.x && /^\d{6}$/.test(it.t)) ? 'BSE' : 'NSE'}:${it.t}`;
}

// ── sorting + screen order ──────────────────────────────────────────────────
export type SortKey = 'symbol' | 'last' | 'chg';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null;
export interface Quote { last: number | null; chgPct: number | null; name?: string | null; ext?: number | null; at?: number; marketTime?: number | null; stale?: boolean }

/** Header click: first click (numbers high→low, symbol A→Z), second flips, third goes back to his own order. */
export function nextSort(cur: SortState, key: SortKey): SortState {
  const first: 'asc' | 'desc' = key === 'symbol' ? 'asc' : 'desc';
  if (!cur || cur.key !== key) return { key, dir: first };
  if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return null;
}
/** Sorted copy; rows without a value always go last. */
export function sortItems(items: WlItem[], sort: SortState, quotes: Record<string, Quote | undefined>): WlItem[] {
  if (!sort) return items;
  const val = (it: WlItem): number | string | null => {
    if (sort.key === 'symbol') return it.t;
    const q = quotes[itemKey(it)];
    const v = sort.key === 'last' ? q?.last : q?.chgPct;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const sign = sort.dir === 'asc' ? 1 : -1;
  return items.map((it, i) => ({ it, i, v: val(it) })).sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    const c = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : (a.v as number) - (b.v as number);
    return c !== 0 ? c * sign : a.i - b.i;
  }).map((x) => x.it);
}
export interface ViewRow { sectionId: string; item: WlItem }
export interface WatchlistView { query?: string; market?: Market | 'ALL' }
/** Rows in the order they are on screen: per section, sorted, collapsed sections skipped, optional flag filter. */
/** `rows` = what is drawn (empty while the section is collapsed, unless searching); `matches` = how many of the section's symbols
 *  pass the filters whatever the collapse state (zzz1000: a filtered view hides sections with no matches). */
export function viewRows(l: WlList, sort: SortState, quotes: Record<string, Quote | undefined>, flagFilter: Flag | null, view: WatchlistView = {}): { section: WlSection; rows: WlItem[]; matches: number }[] {
  const query = (view.query || '').trim().toLocaleLowerCase();
  return l.sections.map((s) => {
    const items = s.items.filter((it) => (!flagFilter || it.flag === flagFilter)
      && (!view.market || view.market === 'ALL' || it.m === view.market)
      && (!query || `${it.t} ${it.x || ''} ${quotes[itemKey(it)]?.name || ''}`.toLocaleLowerCase().includes(query)));
    // Search includes collapsed sections, without changing their stored state.
    return { section: s, rows: s.collapsed && !query ? [] : sortItems(items, sort, quotes), matches: items.length };
  });
}
export function flatRows(l: WlList, sort: SortState, quotes: Record<string, Quote | undefined>, flagFilter: Flag | null, view: WatchlistView = {}): ViewRow[] {
  return viewRows(l, sort, quotes, flagFilter, view).flatMap((g) => g.rows.map((item) => ({ sectionId: g.section.id, item })));
}
/** ↑/↓: the row after (or before) the current ticker; first / last row when the current one is not in view. */
export function stepRow(rows: ViewRow[], currentKey: string, dir: 1 | -1): ViewRow | null {
  if (!rows.length) return null;
  const i = rows.findIndex((r) => itemKey(r.item) === currentKey);
  if (i < 0) return dir === 1 ? rows[0] : rows[rows.length - 1];
  const j = i + dir;
  return j >= 0 && j < rows.length ? rows[j] : null;
}

// ── TradingView text format ─────────────────────────────────────────────────
const IN_EXCH = new Set(['NSE', 'BSE']);
const US_EXCH = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'NYSEMKT', 'BATS', 'CBOE', 'OTC', 'ARCA']);
// TradingView writes NSE "&" and "-" both as "_" (M&M → M_M, BAJAJ-AUTO → BAJAJ_AUTO). These NSE symbols use "&".
const NSE_AMP = new Set(['M&M', 'M&MFIN', 'J&KBANK', 'GMRP&UI', 'S&SPOWER']);
const AMP_BY_UNDERSCORE = new Map([...NSE_AMP].map((s) => [s.replace(/&/g, '_'), s]));

export interface ParsedSection { name: string; items: WlItem[] }
export interface ParseResult { sections: ParsedSection[]; count: number; skipped: number; skippedExamples: string[]; bseCodes: number }

/** Parse a TradingView watchlist export (### starts a section; EXCHANGE:TICKER separated by commas or new lines). */
export function parseTradingView(text: string, defaultMarket: Market = 'US'): ParseResult {
  const sections: ParsedSection[] = [];
  let cur: ParsedSection | null = null;
  const seen = new Set<string>();
  let skipped = 0, bseCodes = 0, count = 0;
  const skippedExamples: string[] = [];
  const skip = (tok: string) => { skipped++; if (skippedExamples.length < 5) skippedExamples.push(tok.slice(0, 30)); };
  for (const raw of String(text || '').replace(/^﻿/, '').split(/[,\n\r\t]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    if (tok.startsWith('###')) {
      cur = { name: tok.replace(/^#+/, '').trim().slice(0, 60), items: [] };
      sections.push(cur);
      continue;
    }
    let ex = '', sym = tok.toUpperCase();
    const c = sym.indexOf(':');
    if (c >= 0) { ex = sym.slice(0, c).trim(); sym = sym.slice(c + 1).trim(); }
    let m: Market | null = null;
    if (!ex) m = defaultMarket;
    else if (IN_EXCH.has(ex)) m = 'IN';
    else if (US_EXCH.has(ex)) m = 'US';
    if (!m) { skip(tok); continue; }
    if (m === 'IN') {
      sym = AMP_BY_UNDERSCORE.get(sym) || sym.replace(/_/g, '-');
      if (ex === 'BSE' && /^\d{6}$/.test(sym)) bseCodes++;
    } else {
      sym = sym.replace(/_/g, '.');
    }
    if (!validItem(m, sym)) { skip(tok); continue; }
    const k = itemKey({ m, t: sym, x: ex });
    if (seen.has(k)) continue;
    seen.add(k);
    if (!cur) { cur = { name: '', items: [] }; sections.push(cur); }
    const item: WlItem = { m, t: sym };
    if (ex) item.x = ex;
    cur.items.push(item);
    count++;
    if (count >= MAX_ITEMS) break;
  }
  return { sections: sections.filter((s) => s.items.length || s.name), count, skipped, skippedExamples, bseCodes };
}

/** One row in TradingView's own form (NSE:M_M, NASDAQ:AKAM). */
export function tvSymbol(it: WlItem): string {
  const ex = it.x || (it.m === 'IN' ? (/^\d{6}$/.test(it.t) ? 'BSE' : 'NSE') : 'NASDAQ');
  const t = it.m === 'IN' ? it.t.replace(/[&-]/g, '_') : it.t;
  return `${ex}:${t}`;
}
/** A list as TradingView text — the same format the import reads, so it round-trips. */
export function serializeTradingView(l: WlList): string {
  const parts: string[] = [];
  for (const s of l.sections) {
    if (s.name) parts.push(`###${s.name.replace(/[,\n\r]/g, ' ')}`);
    for (const it of s.items) parts.push(tvSymbol(it));
  }
  return parts.join(',');
}

/** Put parsed sections into the store: as a new list (made active), or added to an existing list (same-name sections merge). */
export function importParsed(s: WlStore, parsed: ParseResult, opts: { mode: 'new'; name: string } | { mode: 'append'; listId: string }): WlStore {
  if (opts.mode === 'new') {
    if (s.lists.length >= MAX_LISTS) return s;
    const secs = parsed.sections.length ? parsed.sections : [{ name: '', items: [] }];
    const raw = { id: newId('l'), name: opts.name, sections: secs.map((p) => ({ id: newId('s'), name: p.name, collapsed: false, items: p.items })) };
    const l = sanitizeStore({ lists: [raw], activeId: raw.id }).lists[0];
    return { lists: [...s.lists, l], activeId: l.id };
  }
  return updateList(s, opts.listId, (l) => {
    let out = l;
    for (const p of parsed.sections) {
      let sec = out.sections.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (!sec) { out = p.name ? addSection(out, p.name) : out; sec = p.name ? out.sections[out.sections.length - 1] : out.sections[0]; }
      for (const it of p.items) out = addItem(out, sec.id, it);
    }
    return out;
  });
}

// ── zzz945: all TradingView lists in one file ───────────────────────────────
// {"mcTradingViewLists":1,"lists":[{"name":"INDIA PORTFOLIO","text":"###SECTION,NSE:TATVA,…"}],"flags":{"red":["NSE:TATVA",…]},
//  "active":"india and usa themes"}. A list with the same name as one already here is REPLACED (re-importing does not duplicate);
// other lists are untouched. Flags ("colored" TradingView lists) are put on the rows of the imported lists.
export interface TvBundle { lists: { name: string; text: string }[]; flags: Partial<Record<string, string[]>>; active?: string }
export function parseTvBundle(text: string): TvBundle | null {
  let j: any;
  try { j = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch { return null; }
  if (!j || typeof j !== 'object' || j.mcTradingViewLists !== 1 || !Array.isArray(j.lists)) return null;
  const lists = j.lists.filter((l: any) => l && typeof l.name === 'string' && typeof l.text === 'string').map((l: any) => ({ name: l.name, text: l.text }));
  const flags: Record<string, string[]> = {};
  if (j.flags && typeof j.flags === 'object') for (const f of FLAGS) if (Array.isArray(j.flags[f])) flags[f] = j.flags[f].filter((x: unknown) => typeof x === 'string');
  return { lists, flags, active: typeof j.active === 'string' ? j.active : undefined };
}
export interface BundleResult { store: WlStore; lists: number; symbols: number; skipped: number; replaced: number; flagged: number }
export function importTvBundle(s: WlStore, b: TvBundle): BundleResult {
  const flagOf = new Map<string, Flag>();
  for (const f of FLAGS) for (const sec of parseTradingView((b.flags[f] || []).join(',')).sections) for (const it of sec.items) if (!flagOf.has(itemKey(it))) flagOf.set(itemKey(it), f);
  let lists = s.lists.slice();
  let symbols = 0, skipped = 0, replaced = 0, flagged = 0, added = 0;
  let activeId = s.activeId;
  for (const bl of b.lists) {
    const parsed = parseTradingView(bl.text);
    skipped += parsed.skipped;
    if (!parsed.count) continue;
    const name = cleanName(bl.name, 'Watchlist');
    const secs = parsed.sections.map((p) => ({
      id: newId('s'), name: p.name, collapsed: false,
      items: p.items.map((it) => { const f = flagOf.get(itemKey(it)); if (f) flagged++; return f ? { ...it, flag: f } : it; }),
    }));
    const one = sanitizeStore({ lists: [{ id: newId('l'), name, sections: secs }] }).lists[0];
    const at = lists.findIndex((l) => l.name.toLowerCase() === name.toLowerCase());
    if (at >= 0) { one.id = lists[at].id; lists[at] = one; replaced++; }
    else if (lists.length < MAX_LISTS) lists.push(one);
    else continue;
    added++;
    symbols += listCount(one);
    if (b.active && b.active.toLowerCase() === name.toLowerCase()) activeId = one.id;
  }
  if (!lists.some((l) => l.id === activeId)) activeId = lists[0]?.id || s.activeId;
  return { store: { lists, activeId }, lists: added, symbols, skipped, replaced, flagged };
}

/** zzz1000 — the sections a filtered view draws: with a search / flag / market filter on, sections without a match are hidden
 *  (unless `showEmpty`); without a filter every section shows, as before. Stored collapse state is never changed. */
export function visibleSections<G extends { matches: number }>(groups: G[], filtered: boolean, showEmpty: boolean): G[] {
  return filtered && !showEmpty ? groups.filter((g) => g.matches > 0) : groups;
}
