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
  '/portfolio-catalysts',
  '/us-portfolio-catalysts',
  '/us-portfolio-book',
  '/exit-radar',
  '/ai-gainers',
  '/concall-intel?tab=radar',
  '/market-snapshot',
  '/guidance-upgrades',
  '/stock-screener',
  '/charts',
];

// ── INTRODUCING A NEW TAB TO A RAIL THAT HAS ALREADY BEEN STARRED. (zzz713)
//
// SEED only answers for a browser that has never starred anything. The owner
// has, so a new page added to SEED would never reach him — the exact failure
// he reported: pages built, shipped, and invisible because the shortcut list
// was frozen the first time it was written.
//
// So new destinations are offered ONCE each, through a ledger of what has
// already been offered. If he unstars one, it is not offered again: the
// ledger records the OFFER, not the state, so an unstar is permanent and a
// later release cannot quietly put it back. Nothing is ever removed from his
// list by this, only added, and only on its first ever appearance.
const OFFERED_KEY = 'mc.navFavourites.offered.v1';
const OFFER: readonly string[] = ['/portfolio-catalysts', '/exit-radar', '/ai-gainers', '/concall-intel?tab=radar',
  // zzz790 — the US book and its catalysts, offered once like every new tab.
  '/us-portfolio-book', '/us-portfolio-catalysts'];
// zzz841 — Market Snapshot, offered once like every new tab.
// zzz843 — Guidance Upgrades, offered once like every new tab.
// zzz846 — Growth Guidance, offered once like every new tab.
// zzz938 — our own Stock Screener and Charts (replace TradingView), offered once like every new tab.
const OFFER_ALL: readonly string[] = [...OFFER, '/market-snapshot', '/guidance-upgrades', '/growth-guidance', '/stock-screener', '/charts'];

function applyOffers(cur: string[]): string[] {
  let offered: string[] = [];
  try { offered = JSON.parse(window.localStorage.getItem(OFFERED_KEY) || '[]'); } catch { offered = []; }
  if (!Array.isArray(offered)) offered = [];
  const fresh = OFFER_ALL.filter((h) => !offered.includes(h));
  if (!fresh.length) return cur;
  try {
    window.localStorage.setItem(OFFERED_KEY, JSON.stringify([...offered, ...fresh]));
  } catch { return cur; }
  const next = [...cur, ...fresh.filter((h) => !cur.includes(h))];
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* shortcut only */ }
  return next;
}

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      try { window.localStorage.setItem(OFFERED_KEY, JSON.stringify([...OFFER_ALL])); } catch { /* shortcut only */ }
      return [...SEED];
    }
    const arr = JSON.parse(raw);
    const cur = Array.isArray(arr) ? arr.filter((h) => typeof h === 'string') : [];
    return applyOffers(cur);
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
