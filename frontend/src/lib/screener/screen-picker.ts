// zzz1006 — the Stock Screener's searchable screen picker: groups (favourites, my screens, built-in USA / India), search and the
// favourite marks (a display preference kept in this browser). Saved screen definitions are never touched here. Pure + guarded storage.
import type { Screen } from './filters';
import type { ScreenMarket } from './types';

export interface PickerGroup { id: string; label: string; hint?: string; screens: Screen[] }

// zzz1086 — retest improvement 4: the built-in screens of the open market are listed in a few FAMILIES instead of one long list
// (navigation only: screen IDs, rules, saved screens, favourites and links are untouched; no screen is merged or removed).
export type StockFamilyId = 'start' | 'growth' | 'future' | 'momentum' | 'leaders' | 'volume' | 'short';
export const STOCK_FAMILIES: ReadonlyArray<{ id: StockFamilyId; label: string; hint: string }> = [
  { id: 'growth', label: 'Growth & quality', hint: 'Sales / profit growth, margins, Rule of 40, PEAD, balance sheet' },
  { id: 'future', label: 'Future leaders', hint: 'Future NVDIA / Super Scalers recipes, IPO winners and the crash scenario' },
  { id: 'leaders', label: 'Trend leaders', hint: 'Minervini, Qullamaggie and liquidity leaders — strong charts with growth' },
  { id: 'momentum', label: 'Momentum & breakouts', hint: 'Gainers, breakouts, episodic pivots, all-time highs, RSI' },
  { id: 'volume', label: 'Volume & accumulation', hint: 'Heavy buying read from price and volume' },
  { id: 'short', label: 'Shorts & weakness', hint: 'Stage-analysis short set-ups' },
  { id: 'start', label: 'Start points', hint: 'Every company, no or few rules — build your own screen from here' },
];
const STOCK_NAMED: Readonly<Record<string, StockFamilyId>> = {
  'us-overall': 'start', 'in-reject': 'start',
  'us-zachs': 'growth', 'in-zachs': 'growth', 'us-small-cap-crushed': 'growth', 'us-pead': 'growth', 'in-pead': 'growth', 'us-all-growth': 'growth',
  'tv-rule-of-40': 'growth', 'tv-rule-of-40-in': 'growth', 'in-debt-reduction': 'growth', 'in-overall-good': 'growth', 'in-growth-margins': 'growth', 'in-growth-stocks': 'growth',
  'us-future-nvda': 'future', 'us-future-nvda-india2': 'future', 'in-future-nvda-2': 'future', 'us-super-scalers-full': 'future', 'us-super-scalers-main': 'future',
  'us-super-scalers': 'future', 'us-crash-nvda': 'future', 'in-ipo-winners': 'future',
  'us-minervini': 'leaders', 'in-minervini': 'leaders', 'us-qullamaggie-leaders': 'leaders', 'in-qullamaggie-leaders': 'leaders', 'in-leaders-correction': 'leaders',
  'us-liquidity-leaders': 'leaders', 'in-liquidity-leaders': 'leaders',
  'us-daily-gainers': 'momentum', 'in-daily-gainers': 'momentum', 'us-weekly-gainer-usa': 'momentum', 'in-weekly-gainers': 'momentum', 'in-weekly-gainer-usa': 'momentum',
  'us-momentum-bursts': 'momentum', 'us-breakout': 'momentum', 'in-breakout': 'momentum', 'us-episodic-pivot': 'momentum', 'in-episodic-pivot': 'momentum',
  'us-bonde-ep': 'momentum', 'us-ath': 'momentum', 'in-rsi-55': 'momentum', 'in-rsi-m-over-w': 'momentum',
  'us-volume-accumulation': 'volume', 'in-volume-accumulation': 'volume',
  'us-stage-short': 'short', 'us-stage-ipo-shorts': 'short',
};
/** The family a built-in screen is listed under (always one): by id, else by words in its name, else Growth & quality. */
export function stockFamilyOf(s: Pick<Screen, 'id' | 'name'>): StockFamilyId {
  if (STOCK_NAMED[s.id]) return STOCK_NAMED[s.id];
  const n = s.name.toLowerCase();
  if (/short|stage 4|breakdown/.test(n)) return 'short';
  if (/accumul|volume/.test(n)) return 'volume';
  if (/minerv|qull|qual|leader/.test(n)) return 'leaders';
  if (/gainer|breakout|pivot|momentum|\bath\b|rsi/.test(n)) return 'momentum';
  if (/future|scaler|nvd|ipo/.test(n)) return 'future';
  if (/overall|all companies|no filters/.test(n)) return 'start';
  return 'growth';
}
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
  ];
  const built = hit.filter((s) => builtInIds.has(s.id) && !fav.has(s.id));
  if (market) {
    // zzz1086 — one market open: its built-in screens by family
    for (const f of STOCK_FAMILIES) groups.push({ id: `fam:${f.id}`, label: f.label, hint: f.hint, screens: built.filter((s) => stockFamilyOf(s) === f.id) });
  } else {
    groups.push({ id: 'us', label: 'Built-in · USA', screens: built.filter((s) => s.market === 'US') });
    groups.push({ id: 'in', label: 'Built-in · India', screens: built.filter((s) => s.market === 'IN') });
  }
  return groups.filter((g) => g.screens.length);
}
/** zzz1069 — how many visible (not hidden) screens the OTHER market has, for the picker's "switch market" line. */
export function otherMarketScreenCount(screens: readonly Screen[], market: ScreenMarket, hidden: readonly string[] = []): number {
  const off = new Set(hidden);
  return screens.filter((s) => s.market !== market && !off.has(s.id)).length;
}
