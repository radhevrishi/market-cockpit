// zzz1006 — the Stock Screener's searchable screen picker: groups (favourites, my screens, built-in USA / India), search and the
// favourite marks (a display preference kept in this browser). Saved screen definitions are never touched here. Pure + guarded storage.
import type { Screen } from './filters';
import type { ScreenMarket } from './types';

export interface PickerGroup { id: 'fav' | 'mine' | 'us' | 'in'; label: string; screens: Screen[] }
export const FAV_SCREENS_KEY = 'mc:screener-fav-screens:v1';

export function readFavScreens(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_SCREENS_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 200) : []; } catch { return []; }
}
export function writeFavScreens(ids: readonly string[]): void { try { localStorage.setItem(FAV_SCREENS_KEY, JSON.stringify(ids.slice(0, 200))); } catch { /* display preference only */ } }
/** zzz1043 — built-in screens the owner removed from his list (a built-in cannot be deleted from the code, so it is hidden; it can be
 *  brought back from "Hidden screens"). Synced like the saved screens. */
export const HIDDEN_SCREENS_KEY = 'mc:stock-screens-hidden:v1';
export function readHiddenScreens(): string[] {
  try { const v = JSON.parse(localStorage.getItem(HIDDEN_SCREENS_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500) : []; } catch { return []; }
}
export function writeHiddenScreens(ids: readonly string[]): boolean {
  try { localStorage.setItem(HIDDEN_SCREENS_KEY, JSON.stringify(Array.from(new Set(ids)).slice(0, 500))); return true; } catch { return false; }
}
export function toggleFav(ids: readonly string[], id: string): string[] { return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; }

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** Every word of the query must appear in the screen's name or market ("usa", "india", "us", "in"). */
export function matchesScreen(s: Screen, q: string): boolean {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${norm(s.name)} ${s.market === 'US' ? 'usa us' : 'india in'}`;
  return words.every((w) => hay.includes(w));
}
/** Favourites first, then the owner's own screens, then the built-in ones — each in its stored order.
 *  zzz1069 — `market` given: ONLY that market's screens (India open → India screens, USA open → USA screens); the other market's
 *  screens are reached with the page's 🇺🇸 USA / 🇮🇳 India buttons. Without `market`: every market, as before. */
export function pickerGroups(screens: readonly Screen[], builtInIds: ReadonlySet<string>, favs: readonly string[], q = '', hidden: readonly string[] = [], market?: ScreenMarket): PickerGroup[] {
  const off = new Set(hidden);
  const hit = screens.filter((s) => !off.has(s.id) && (!market || s.market === market) && matchesScreen(s, q));
  const fav = new Set(favs);
  const groups: PickerGroup[] = [
    { id: 'fav', label: 'Favourites', screens: hit.filter((s) => fav.has(s.id)) },
    { id: 'mine', label: 'My screens', screens: hit.filter((s) => !builtInIds.has(s.id) && !fav.has(s.id)) },
    { id: 'us', label: 'Built-in · USA', screens: hit.filter((s) => builtInIds.has(s.id) && s.market === 'US' && !fav.has(s.id)) },
    { id: 'in', label: 'Built-in · India', screens: hit.filter((s) => builtInIds.has(s.id) && s.market === 'IN' && !fav.has(s.id)) },
  ];
  return groups.filter((g) => g.screens.length);
}
/** zzz1069 — how many visible (not hidden) screens the OTHER market has, for the picker's "switch market" line. */
export function otherMarketScreenCount(screens: readonly Screen[], market: ScreenMarket, hidden: readonly string[] = []): number {
  const off = new Set(hidden);
  return screens.filter((s) => s.market !== market && !off.has(s.id)).length;
}
