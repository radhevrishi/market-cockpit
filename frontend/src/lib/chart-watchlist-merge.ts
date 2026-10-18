// zzz1074 — three-way merge of the /charts watchlists (mc:chart-watchlists:v1) for the vault sync.
//
// Why: the watchlists were synced "whole value, last writer wins", so when two devices both changed them the second one got
// "Another device saved a newer copy… have not synced" and had to pick one copy (losing the other device's edits). Now the two
// copies are merged against the last copy this device synced (the "base"):
//   · a list / section / ticker added on either side is kept;
//   · one deleted on one side (present in the base) is deleted — unless the other side changed it since the base;
//   · a name, flag or folded state changed on one side wins over the unchanged other side (both changed: this device's);
//   · order follows the server copy, this device's new tickers / sections / lists are added after.
// Without a base (first merge on a device) nothing counts as deleted: the result is the union of both copies.
// Pure; the result always passes sanitizeStore (one section per book, the item / list limits).
import { sanitizeStore, itemKey, type WlItem, type WlList, type WlSection, type WlStore } from './chart-watchlist';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** One field: the side that changed since the base wins; both changed → this device; no base → this device. */
function pick<T>(base: T | undefined, local: T, server: T, hasBase: boolean): T {
  if (!hasBase) return local;
  if (!same(local, base)) return local;
  return server;
}

/** Merge two keyed collections three ways. `mergeOne` merges an element present on both sides. */
function merge3<T>(
  base: T[] | null, local: T[], server: T[], keyOf: (x: T) => string,
  mergeOne: (b: T | undefined, l: T, s: T) => T,
): T[] {
  const B = new Map((base || []).map((x) => [keyOf(x), x]));
  const L = new Map(local.map((x) => [keyOf(x), x]));
  const S = new Map(server.map((x) => [keyOf(x), x]));
  const hasBase = base != null;
  const out: T[] = [];
  const take = (k: string) => {
    const b = B.get(k), l = L.get(k), s = S.get(k);
    if (l && s) return mergeOne(b, l, s);
    if (l) {   // only on this device
      if (hasBase && b && same(l, b)) return null;   // the server deleted it and this device did not change it
      return l;
    }
    if (s) {   // only on the server
      if (hasBase && b && same(s, b)) return null;   // this device deleted it and the server did not change it
      return s;
    }
    return null;
  };
  const seen = new Set<string>();
  for (const x of server) { const k = keyOf(x); seen.add(k); const v = take(k); if (v) out.push(v); }
  for (const x of local) { const k = keyOf(x); if (seen.has(k)) continue; seen.add(k); const v = take(k); if (v) out.push(v); }
  return out;
}

function mergeItem(b: WlItem | undefined, l: WlItem, s: WlItem, hasBase: boolean): WlItem {
  const flag = pick(b?.flag, l.flag, s.flag, hasBase);
  const out: WlItem = { m: l.m, t: l.t };
  if (flag) out.flag = flag;
  const x = l.x || s.x;
  if (x) out.x = x;
  return out;
}
function mergeSection(b: WlSection | undefined, l: WlSection, s: WlSection, hasBase: boolean): WlSection {
  const items = merge3(hasBase ? (b?.items || []) : null, l.items, s.items, itemKey, (bi, li, si) => mergeItem(bi, li, si, hasBase));
  const out: WlSection = {
    id: l.id,
    name: pick(b?.name, l.name, s.name, hasBase),
    collapsed: pick(b?.collapsed, l.collapsed, s.collapsed, hasBase),
    items,
  };
  const book = pick(b?.book, l.book, s.book, hasBase);
  if (book) out.book = book;
  return out;
}
function mergeList(b: WlList | undefined, l: WlList, s: WlList, hasBase: boolean): WlList {
  return {
    id: l.id,
    name: pick(b?.name, l.name, s.name, hasBase),
    sections: merge3(hasBase ? (b?.sections || []) : null, l.sections, s.sections, (x) => x.id, (bs, ls, ss) => mergeSection(bs, ls, ss, hasBase)),
  };
}

/** The merged watchlists. `baseRaw` = the copy this device last synced (null / undefined = unknown → union). */
export function mergeWatchlistStores(localRaw: unknown, serverRaw: unknown, baseRaw?: unknown): WlStore {
  const local = sanitizeStore(localRaw), server = sanitizeStore(serverRaw);
  const hasBase = baseRaw != null && typeof baseRaw === 'object';
  const base = hasBase ? sanitizeStore(baseRaw) : null;
  const lists = merge3(base ? base.lists : null, local.lists, server.lists, (x) => x.id, (b, l, s) => mergeList(b, l, s, hasBase));
  const activeId = lists.some((x) => x.id === local.activeId) ? local.activeId : lists.some((x) => x.id === server.activeId) ? server.activeId : (lists[0]?.id || local.activeId);
  const bookAuto = Array.from(new Set([...(local.bookAuto || []), ...(server.bookAuto || [])]));
  return sanitizeStore({ lists, activeId, ...(bookAuto.length ? { bookAuto } : {}) });
}
