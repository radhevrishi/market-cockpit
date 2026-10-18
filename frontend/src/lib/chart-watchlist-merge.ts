// zzz1074 — three-way merge of the /charts watchlists (mc:chart-watchlists:v1) for the vault sync.
// zzz1078 (retest B02 / B03) — tickers are merged across the WHOLE list (not section by section), so a ticker moved to
// another section on one device and flagged on the other keeps both changes; a reorder made on one device survives; and
// nothing is dropped silently when the merged list would go past a limit (the lost additions are reported).
//
// Rules, against the copy this device last synced (the "base"):
//   · a list / section / ticker added on either side is kept;
//   · one deleted on one side (present in the base) is deleted — unless the other side changed it since the base;
//   · a name, flag, folded state or a ticker's SECTION changed on one side wins over the unchanged other side;
//     both sides changed it differently → this device's choice (deterministic, and the other device sees it next sync);
//   · order inside a section: the side that reordered it wins (both reordered → this device); additions from the other
//     side follow;
//   · past MAX_ITEMS / MAX_SECTIONS / MAX_LISTS the extra additions are not dropped silently: `lost` lists them.
// Without a base (first merge on a device) nothing counts as deleted or moved: the result is the union of both copies.
// Pure; the result passes sanitizeStore unchanged (no further cutting).
import { sanitizeStore, itemKey, MAX_ITEMS, MAX_LISTS, MAX_SECTIONS, type WlItem, type WlList, type WlSection, type WlStore } from './chart-watchlist';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** One field: the side that changed since the base wins; both changed → this device; no base → this device. */
function pick<T>(base: T | undefined, local: T, server: T, hasBase: boolean): T {
  if (!hasBase) return local;
  if (!same(local, base)) return local;
  return server;
}

/** What was left out because a limit was reached (never silently). */
export interface MergeLost { kind: 'item' | 'section' | 'list'; list: string; section?: string; symbol?: string; from: 'this device' | 'other device' }
export interface WatchlistMergeResult { store: WlStore; lost: MergeLost[] }

/** Existence of a keyed element across three copies. `changed(x, b)` — the element differs from its base copy. */
function keep<T>(b: T | undefined, l: T | undefined, s: T | undefined, hasBase: boolean, changed: (x: T, b: T) => boolean): boolean {
  if (l && s) return true;
  const one = l || s;
  if (!one) return false;
  if (hasBase && b && !changed(one, b)) return false;   // the other side deleted it and this side did not touch it
  return true;
}

interface Placed { key: string; item: WlItem; section: string }
function placements(list: WlList | undefined): Map<string, Placed> {
  const m = new Map<string, Placed>();
  for (const sec of list?.sections || []) for (const it of sec.items) { const k = itemKey(it); if (!m.has(k)) m.set(k, { key: k, item: it, section: sec.id }); }
  return m;
}
const orderOf = (list: WlList | undefined, secId: string) => (list?.sections.find((s) => s.id === secId)?.items || []).map(itemKey);
/** Did this side change the relative order of the tickers it shares with the base, in this section? */
function reordered(side: string[], base: string[] | null): boolean {
  if (!base) return false;
  const inBase = new Set(base);
  const a = side.filter((k) => inBase.has(k));
  const inSide = new Set(a);
  const b = base.filter((k) => inSide.has(k));
  return !same(a, b);
}

function mergeList(b: WlList | undefined, l: WlList, s: WlList, hasBase: boolean, lost: MergeLost[]): WlList {
  // 1 · sections (metadata + existence; tickers are placed afterwards)
  const B = new Map((b?.sections || []).map((x) => [x.id, x]));
  const Ls = new Map(l.sections.map((x) => [x.id, x]));
  const Ss = new Map(s.sections.map((x) => [x.id, x]));
  const secIds: string[] = [];
  for (const x of [...s.sections, ...l.sections]) if (!secIds.includes(x.id)) secIds.push(x.id);
  const sections: WlSection[] = [];
  for (const id of secIds) {
    const bs = B.get(id), ls = Ls.get(id), ss = Ss.get(id);
    if (!keep(bs, ls, ss, hasBase, (x, y) => !same(x, y))) continue;
    const base = bs, one = ls || ss!;
    const sec: WlSection = ls && ss
      ? { id, name: pick(base?.name, ls.name, ss.name, hasBase), collapsed: pick(base?.collapsed, ls.collapsed, ss.collapsed, hasBase), items: [] }
      : { id, name: one.name, collapsed: one.collapsed, items: [] };
    const book = ls && ss ? pick(base?.book, ls.book, ss.book, hasBase) : one.book;
    if (book) sec.book = book;
    sections.push(sec);
  }
  const live = new Set(sections.map((x) => x.id));
  const fallbackSec = sections.find((x) => !x.book)?.id || sections[0]?.id;

  // 2 · tickers across the whole list: existence, section, flag
  const PB = placements(b), PL = placements(l), PS = placements(s);
  const keys: string[] = [];
  for (const m of [PS, PL]) for (const k of m.keys()) if (!keys.includes(k)) keys.push(k);
  const final = new Map<string, Placed>();
  for (const k of keys) {
    const pb = PB.get(k), pl = PL.get(k), ps = PS.get(k);
    if (!keep(pb, pl, ps, hasBase, (x, y) => x.section !== y.section || (x.item.flag || '') !== (y.item.flag || ''))) continue;
    let section: string; let flag: WlItem['flag']; let x: string | undefined; let src: WlItem;
    if (pl && ps) {
      section = pick(pb?.section, pl.section, ps.section, hasBase);
      if (!live.has(section)) section = live.has(pl.section) ? pl.section : live.has(ps.section) ? ps.section : fallbackSec!;
      flag = pick(pb?.item.flag, pl.item.flag, ps.item.flag, hasBase);
      x = pl.item.x || ps.item.x; src = pl.item;
    } else {
      const one = (pl || ps)!;
      section = live.has(one.section) ? one.section : fallbackSec!;
      flag = one.item.flag; x = one.item.x; src = one.item;
    }
    if (!section) continue;
    const item: WlItem = { m: src.m, t: src.t };
    if (flag) item.flag = flag;
    if (x) item.x = x;
    final.set(k, { key: k, item, section });
  }

  // 3 · order inside each section
  for (const sec of sections) {
    const bo = hasBase ? orderOf(b, sec.id) : null;
    const lo = orderOf(l, sec.id), so = orderOf(s, sec.id);
    const localFirst = hasBase && reordered(lo, bo);   // this device reordered → its order leads (both reordered → this device)
    const seq = localFirst ? [...lo, ...so] : [...so, ...lo];
    const extra = [...final.values()].filter((p) => p.section === sec.id).map((p) => p.key);   // moved in from another section
    const seen = new Set<string>();
    for (const k of [...seq, ...extra]) {
      const p = final.get(k);
      if (!p || p.section !== sec.id || seen.has(k)) continue;
      seen.add(k);
      sec.items.push(p.item);
    }
  }

  // 4 · the per-list item limit: keep everything both sides already had, then additions — report what does not fit
  let count = sections.reduce((n, x) => n + x.items.length, 0);
  if (count > MAX_ITEMS) {
    const onBoth = (it: WlItem) => PL.has(itemKey(it)) && PS.has(itemKey(it));
    // drop the newest additions first: the other device's, then this device's (last in screen order)
    for (const preferDrop of ['other device', 'this device'] as const) {
      for (let si = sections.length - 1; si >= 0 && count > MAX_ITEMS; si--) {
        const sec = sections[si];
        for (let i = sec.items.length - 1; i >= 0 && count > MAX_ITEMS; i--) {
          const it = sec.items[i];
          if (onBoth(it)) continue;
          const from = PL.has(itemKey(it)) ? 'this device' : 'other device';
          if (from !== preferDrop) continue;
          sec.items.splice(i, 1); count--;
          lost.push({ kind: 'item', list: l.name || s.name, section: sec.name || undefined, symbol: `${it.m}:${it.t}`, from });
        }
      }
    }
  }
  if (sections.length > MAX_SECTIONS) {
    for (const sec of sections.splice(MAX_SECTIONS)) lost.push({ kind: 'section', list: l.name || s.name, section: sec.name || sec.id, from: Ls.has(sec.id) ? 'this device' : 'other device' });
  }
  return { id: l.id, name: pick(b?.name, l.name, s.name, hasBase), sections };
}

/** The merged watchlists and anything that did not fit (`lost`). `baseRaw` = the copy this device last synced
 *  (null / undefined = unknown → union). */
export function mergeWatchlistStoresDetailed(localRaw: unknown, serverRaw: unknown, baseRaw?: unknown): WatchlistMergeResult {
  const local = sanitizeStore(localRaw), server = sanitizeStore(serverRaw);
  const hasBase = baseRaw != null && typeof baseRaw === 'object';
  const base = hasBase ? sanitizeStore(baseRaw) : null;
  const lost: MergeLost[] = [];
  const B = new Map((base?.lists || []).map((x) => [x.id, x]));
  const L = new Map(local.lists.map((x) => [x.id, x]));
  const S = new Map(server.lists.map((x) => [x.id, x]));
  const ids: string[] = [];
  for (const x of [...server.lists, ...local.lists]) if (!ids.includes(x.id)) ids.push(x.id);
  let lists: WlList[] = [];
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), s = S.get(id);
    if (!keep(b, l, s, hasBase, (x, y) => !same(x, y))) continue;
    lists.push(l && s ? mergeList(b, l, s, hasBase, lost) : (l || s)!);
  }
  if (lists.length > MAX_LISTS) {
    for (const x of lists.slice(MAX_LISTS)) lost.push({ kind: 'list', list: x.name, from: L.has(x.id) ? 'this device' : 'other device' });
    lists = lists.slice(0, MAX_LISTS);
  }
  const activeId = lists.some((x) => x.id === local.activeId) ? local.activeId : lists.some((x) => x.id === server.activeId) ? server.activeId : (lists[0]?.id || local.activeId);
  const bookAuto = Array.from(new Set([...(local.bookAuto || []), ...(server.bookAuto || [])]));
  return { store: sanitizeStore({ lists, activeId, ...(bookAuto.length ? { bookAuto } : {}) }), lost };
}

/** The merged watchlists (see mergeWatchlistStoresDetailed for what did not fit). */
export function mergeWatchlistStores(localRaw: unknown, serverRaw: unknown, baseRaw?: unknown): WlStore {
  return mergeWatchlistStoresDetailed(localRaw, serverRaw, baseRaw).store;
}

/** A one-line, plain description of what did not fit. */
export function describeLost(lost: readonly MergeLost[]): string {
  if (!lost.length) return '';
  const items = lost.filter((x) => x.kind === 'item');
  const parts: string[] = [];
  if (items.length) parts.push(`${items.length} ticker${items.length === 1 ? '' : 's'} (${items.slice(0, 6).map((x) => x.symbol).join(', ')}${items.length > 6 ? ', …' : ''}) — the list is full (${MAX_ITEMS} max)`);
  const secs = lost.filter((x) => x.kind === 'section');
  if (secs.length) parts.push(`${secs.length} section${secs.length === 1 ? '' : 's'} — ${MAX_SECTIONS} per list max`);
  const lists = lost.filter((x) => x.kind === 'list');
  if (lists.length) parts.push(`${lists.length} list${lists.length === 1 ? '' : 's'} — ${MAX_LISTS} max`);
  return `Not merged: ${parts.join('; ')}. Kept in a recovery copy — download it, make room, and add them again.`;
}
