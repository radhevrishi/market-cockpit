// zzz1065 — home page "All tools" search and ⭐ Favourites ordering, as pure functions.

/** Does a tool's label match the search? Emoji and case are ignored; every word typed must appear. */
export function toolMatches(label: string, query: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s/+&-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = norm(label);
  return words.every((w) => hay.includes(w));
}

/** zzz1065 — the phone Menu filtered by what was typed (every word must appear in the page name or its group name);
 *  groups with no match are left out. Empty filter = the same groups. */
export function filterMenuGroups<I extends { label: string }, G extends { label: string; items: I[] }>(groups: G[], query: string): G[] {
  if (!query.trim()) return groups;
  const out: G[] = [];
  for (const g of groups) {
    const items = g.items.filter((it) => toolMatches(`${it.label} ${g.label}`, query));
    if (items.length) out.push({ ...g, items });
  }
  return out;
}

/** Move one item from `from` to `to` (both clamped); returns a new array, the input is not changed. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const dest = Math.max(0, Math.min(next.length - 1, to));
  if (dest === from) return next;
  const [m] = next.splice(from, 1);
  next.splice(dest, 0, m);
  return next;
}

/**
 * A saved favourites order merged with today's defaults (zzz791 rule, unchanged): unknown saved entries are dropped;
 * a favourite the saved order does not have yet goes right after its neighbour in the default list (first → front).
 */
export function mergeFavOrder(saved: unknown, defaults: readonly string[]): string[] {
  if (!Array.isArray(saved) || !saved.length) return [...defaults];
  const known = new Set(defaults);
  const next = saved.filter((h): h is string => typeof h === 'string' && known.has(h));
  const uniq = [...new Set(next)];
  defaults.forEach((h, i) => {
    if (uniq.includes(h)) return;
    const prev = defaults.slice(0, i).reverse().find((d) => uniq.includes(d));
    const at = prev ? uniq.indexOf(prev) + 1 : 0;
    uniq.splice(at, 0, h);
  });
  return uniq;
}

/** How long a finger must rest on a favourite's handle before it is picked up for moving (touch only). */
export const FAV_LONG_PRESS_MS = 450;
