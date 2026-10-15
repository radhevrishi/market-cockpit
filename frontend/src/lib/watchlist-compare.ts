// zzz1045d — two watchlist sources, shown side by side (pure logic, no window).
//
//  1. The standalone /watchlists list ("My Watchlist"): stored on the server (/api/watchlist), also read by the Telegram bot,
//     with a copy in this browser ('mc_watchlist_tickers'). Plain symbols: NSE symbols, BSE number codes, US tickers.
//  2. The chart lists ('mc:chart-watchlists:v1'): many named lists with sections, flags and an exchange per row; some
//     sections are linked to My Book (India / USA).
//
// Nothing here copies anything by itself. compareWithChartList() builds a preview; the page copies only what the user
// clicks. Symbols are never remapped: a BSE row stays BSE, an NSE symbol stays NSE, order is kept, and sections linked
// to My Book are left out of the comparison and never written to (holdings are not touched).
import { IN_TICKER_RE, US_TICKER_RE, type Market } from './chart-math';
import { addItem, findItem, itemKey, updateList, type WlItem, type WlList, type WlStore } from './chart-watchlist';

// ── where each list comes from ───────────────────────────────────────────────
export type ChartListSourceKind = 'book' | 'chart' | 'telegram-name';
export interface ListSource { kind: ChartListSourceKind | 'server' | 'browser-copy'; label: string; detail: string }

/** One short label per chart list: linked to My Book, or a chart list (saved in this browser and copied to your account). */
export function chartListSource(list: WlList): ListSource {
  const books = [...new Set(list.sections.map((s) => s.book).filter(Boolean))] as Array<'IN' | 'US'>;
  if (books.length) {
    const which = books.map((b) => (b === 'IN' ? 'India' : 'USA')).join(' + ');
    return { kind: 'book', label: `chart list · linked to My Book (${which})`, detail: `Sections linked to My Book (${which}) follow your holdings. Other sections are your own.` };
  }
  if (/telegram/i.test(list.name)) {
    return { kind: 'telegram-name', label: 'chart list · not the Telegram list', detail: 'This chart list has "Telegram" in its name, but the Telegram bot reads the list on the Watchlists page, not this one.' };
  }
  return { kind: 'chart', label: 'chart list', detail: 'Saved in this browser and copied to your account in the background. Separate from the list on the Watchlists page.' };
}

/** The /watchlists header line: where the list on screen was read from, and when it was last saved / read. */
export function standaloneSource(opts: { readFrom: 'server' | 'browser-copy' | null; reason?: string | null; savedAt?: number | null; readAt?: number | null }, fmt: (ms: number) => string): ListSource {
  if (opts.readFrom === 'server') {
    const when = opts.savedAt ? `saved ${fmt(opts.savedAt)}` : opts.readAt ? `read ${fmt(opts.readAt)}` : '';
    return { kind: 'server', label: `Source: your server watchlist${when ? ` · ${when}` : ''}`, detail: 'Stored on the server. The Telegram bot (@mc_watchlist_pulse_bot) uses this same list. The chart lists on the Charts page are separate.' };
  }
  if (opts.readFrom === 'browser-copy') {
    const why = opts.reason === 'no-record' ? 'the server has no saved list yet' : 'the server list could not be read';
    return { kind: 'browser-copy', label: `Source: this browser's copy (${why})${opts.savedAt ? ` · saved ${fmt(opts.savedAt)}` : ''}`, detail: 'Shown from this browser until the server list can be read. A change you make is still sent to the server.' };
  }
  return { kind: 'server', label: 'Source: your server watchlist · reading…', detail: 'Reading the list from the server.' };
}

// ── compare ──────────────────────────────────────────────────────────────────
/** True for a BSE row whose symbol is a letter symbol (BSE:RELIANCE). The /watchlists list has no exchange field, so it
 *  cannot hold this row without turning it into the NSE symbol — that would be a remap, so it is never copied. */
const isBseLetterSymbol = (it: WlItem) => it.m === 'IN' && it.x === 'BSE' && !/^\d{6}$/.test(it.t);
/** The matching key: a plain symbol, upper case, without an exchange prefix / suffix. BSE letter rows keep "BSE:". */
export function compareKey(raw: string): string {
  return String(raw || '').trim().toUpperCase().replace(/^(NSE|BSE|BOM|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
}
const chartKey = (it: WlItem) => (isBseLetterSymbol(it) ? `BSE:${it.t}` : it.t);

export interface ChartSideRow { item: WlItem; symbol: string; copyable: boolean; reason?: string }
export interface CompareResult {
  onlyStandalone: string[];          // in /watchlists, not in the chart list (standalone order)
  onlyChart: ChartSideRow[];         // in the chart list, not in /watchlists (chart order: section by section)
  both: string[];                    // in both (standalone order)
  bookSectionsLeftOut: number;       // names in sections linked to My Book, not compared
}

/** The chart list's rows in screen order, without the sections linked to My Book. */
export function chartRowsForCompare(list: WlList): { items: WlItem[]; bookLeftOut: number } {
  const items: WlItem[] = []; let bookLeftOut = 0;
  for (const s of list.sections) {
    if (s.book) { bookLeftOut += s.items.length; continue; }
    items.push(...s.items);
  }
  return { items, bookLeftOut };
}

export function compareWithChartList(standalone: string[], list: WlList): CompareResult {
  const { items, bookLeftOut } = chartRowsForCompare(list);
  const chartKeys = new Set(items.map(chartKey));
  const standaloneKeys = new Set(standalone.map(compareKey));
  const onlyStandalone: string[] = []; const both: string[] = [];
  const seen = new Set<string>();
  for (const t of standalone) {
    const k = compareKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    (chartKeys.has(k) ? both : onlyStandalone).push(t);
  }
  const onlyChart: ChartSideRow[] = [];
  const seenChart = new Set<string>();
  for (const it of items) {
    const k = chartKey(it);
    if (seenChart.has(k) || standaloneKeys.has(k)) continue;
    seenChart.add(k);
    if (isBseLetterSymbol(it)) onlyChart.push({ item: it, symbol: `BSE:${it.t}`, copyable: false, reason: 'BSE letter symbol: the Watchlists list has no exchange field, so it would turn into the NSE symbol' });
    else onlyChart.push({ item: it, symbol: it.m === 'US' ? it.t : it.x === 'BSE' ? `BSE:${it.t}` : it.t, copyable: true });
  }
  return { onlyStandalone, onlyChart, both, bookSectionsLeftOut: bookLeftOut };
}

/** Names to add to /watchlists, in chart order. A BSE number code is added as the code (as the Watchlists add box does). */
export function planCopyToStandalone(rows: ChartSideRow[]): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const r of rows) {
    if (!r.copyable || seen.has(r.item.t)) continue;
    seen.add(r.item.t); out.push(r.item.t);
  }
  return out;
}

export interface CopyToChartResult { store: WlStore; added: string[]; skipped: Array<{ symbol: string; reason: string }>; sectionName: string | null }

/** Add /watchlists names to a chart list: into its last section that is not linked to My Book (never a book section).
 *  `marketOf` says which market a name was quoted in (US or India); unknown → India. Nothing is remapped: the symbol is
 *  kept as typed; a 6-digit BSE code stays a code. */
export function planCopyToChart(store: WlStore, listId: string, symbols: string[], marketOf: (t: string) => Market | undefined): CopyToChartResult {
  const list = store.lists.find((l) => l.id === listId);
  if (!list) return { store, added: [], skipped: symbols.map((s) => ({ symbol: s, reason: 'chart list not found' })), sectionName: null };
  const target = [...list.sections].reverse().find((s) => !s.book);
  if (!target) return { store, added: [], skipped: symbols.map((s) => ({ symbol: s, reason: 'every section of this list is linked to My Book' })), sectionName: null };
  let next = list;
  const added: string[] = []; const skipped: Array<{ symbol: string; reason: string }> = [];
  for (const raw of symbols) {
    const t = compareKey(raw);
    const m: Market = marketOf(raw) === 'US' ? 'US' : 'IN';
    if (!(m === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(t)) { skipped.push({ symbol: raw, reason: `not a valid ${m === 'IN' ? 'India' : 'US'} symbol for charts` }); continue; }
    const item: WlItem = { m, t };
    if (findItem(next, itemKey(item))) { skipped.push({ symbol: raw, reason: 'already in this chart list' }); continue; }
    const after = addItem(next, target.id, item);
    if (after === next) { skipped.push({ symbol: raw, reason: 'chart list is full' }); continue; }
    next = after; added.push(t);
  }
  return { store: added.length ? updateList(store, listId, () => next) : store, added, skipped, sectionName: target.name || null };
}

/** The chart list to compare with by default: one named "My Watchlist" (any case), else the first list. */
export function defaultCompareListId(store: WlStore): string {
  return (store.lists.find((l) => l.name.trim().toLowerCase() === 'my watchlist') || store.lists[0])?.id || '';
}
