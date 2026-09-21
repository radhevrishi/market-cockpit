// ═══════════════════════════════════════════════════════════════════════════
// FAVOURITES — THE RAIL HAS FORTY TABS AND YOU USE SIX.             (zzz707)
//
// The sidebar carries ten groups and roughly forty destinations, in a fixed
// order that was last argued about in PATCH 0617. Every one of them earned its
// place, and that is exactly the problem: the six pages actually opened every
// morning are scattered across five groups, and finding them is a scroll and a
// scan rather than a click.
//
// So the order is not re-argued here. A FAVOURITES group is pinned above the
// rest and the owner fills it by starring what he uses. Nothing is removed,
// nothing is reordered, and a starred item still appears in its own group —
// a favourite is a shortcut, not a move, and a tab quietly disappearing from
// where someone expects to find it is worse than a long rail.
//
// STORED PER BROWSER, AND THAT IS HONEST ABOUT WHAT IT IS. localStorage means
// the list does not follow him to another machine. For a six-item shortcut
// list that is the right trade against a server round-trip on every page load
// — and unlike a preference that changes what the engine DOES, losing it
// costs a few clicks rather than a decision.
// ═══════════════════════════════════════════════════════════════════════════

const KEY = 'mc.navFavourites.v1';
const EVENT = 'mc:nav-favourites';

/** Defaults for a rail that has never been starred: the four pages this
 *  session has spent its time in. Overwritten the moment anything is
 *  starred or unstarred, including to an empty list. */
const SEED: readonly string[] = [
  '/earnings-opportunities',
  '/us-earnings-opportunities',
  '/us-conviction-beats',
  '/concall-intel',
];

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [...SEED];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((h) => typeof h === 'string') : [];
  } catch {
    // A blocked or unreadable store is a normal state, not an error. An empty
    // favourites list simply means the group does not render.
    return [];
  }
}

function write(list: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* the rail still works; only the shortcut is lost */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* no listeners is fine */ }
}

export function getFavourites(): string[] {
  return read();
}

export function isFavourite(href: string): boolean {
  return read().includes(href);
}

/** Star or unstar. Returns the new list so a caller can set state directly. */
export function toggleFavourite(href: string): string[] {
  const cur = read();
  const next = cur.includes(href) ? cur.filter((h) => h !== href) : [...cur, href];
  write(next);
  return next;
}

/** Fires on every change in this tab, and on `storage` from other tabs. */
export function subscribeFavourites(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) fn(); };
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', onStorage);
  };
}
