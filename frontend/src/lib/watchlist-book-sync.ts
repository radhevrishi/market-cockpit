// zzz1042 — keep a /charts watchlist section in step with My Book (owner: "sync India Portfolio and USA Portfolio to my
// portfolio watchlist"). One way only: My Book → watchlist. Pure (no window); the panel reads the books and calls these.
//
//  • A section can be linked to one book: 'IN' (India book, localStorage 'mc_portfolio_holdings') or 'US' (US Portfolio Book,
//    /api/v1/us-book?view=universe, holdings only — never the bench). One section per book in the whole store.
//  • Sync adds every held name that is not in that list yet (NSE, or BSE for a 6-digit code; US tickers with their exchange),
//    keeps the owner's order and flags, and takes a name out of the LINKED SECTION ONLY when it is no longer held. Rows of the
//    other market and every other section / list are never touched.
//  • A list holds a symbol once (sanitizeStore drops repeats), so a held name that already sits in another section of the same
//    list stays there and is not copied into the linked section.
//  • Safety: a book that could not be read, or reads empty, never takes anything out. An automatic run that would take out more
//    than half of the section's rows (and more than 3) holds the removal back until "Sync now".
//  • First run: sections named "India Portfolio" / "USA Portfolio" are linked once (store.bookAuto remembers it, so an unlink
//    is never undone).
import { IN_TICKER_RE, US_TICKER_RE } from './chart-math';
import { MAX_ITEMS, addSection, listCount, updateList, type BookMarket, type WlItem, type WlList, type WlSection, type WlStore } from './chart-watchlist';
import type { ChartMenuItem } from '../components/charts/ChartContextMenu';

export const BOOK_LABEL: Record<BookMarket, string> = { IN: 'My Book (India)', US: 'My Book (USA)' };
export const BOOK_SECTION_NAME: Record<BookMarket, string> = { IN: 'India Portfolio', US: 'USA Portfolio' };
/** This device's last sync time per book (display only, not synced between devices). */
export const BOOK_SYNC_TIMES_KEY = 'mc:wl-book-sync:v1';
export const BOOK_POLL_MS = 3 * 60_000;

export interface BookHolding { t: string; x?: string }
export type BookRead = { ok: true; items: BookHolding[] } | { ok: false; reason: string };

// ── reading the books ──────────────────────────────────────────────────────
/** India book as stored by the Portfolio page: [{ symbol, … }]. `raw` null = nothing stored here yet (not loaded). */
export function indiaBookHoldings(raw: unknown): BookRead {
  if (raw == null) return { ok: false, reason: 'India book not loaded on this device yet' };
  if (!Array.isArray(raw)) return { ok: false, reason: 'India book could not be read' };
  const out: BookHolding[] = []; const seen = new Set<string>();
  for (const h of raw) {
    const t = String((h && typeof h === 'object' ? (h as any).symbol ?? (h as any).ticker : h) ?? '')
      .trim().toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO|NSE|BSE)$/, '');
    if (!IN_TICKER_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push({ t, x: /^\d{6}$/.test(t) ? 'BSE' : 'NSE' });
  }
  return { ok: true, items: out };
}

/** TradingView exchange name for a US book venue (NASDAQ / NYSE / AMEX / NYSEARCA / BATS); none when unknown. */
export function usExchangeOf(ex: unknown): string | undefined {
  const x = String(ex ?? '').toUpperCase();
  if (/NASDAQ|^(NMS|NGS|NGM|NCM|ISLAND)$/.test(x)) return 'NASDAQ';
  if (/ARCA/.test(x)) return 'NYSEARCA';
  if (/AMEX|AMERICAN|MKT/.test(x)) return 'AMEX';
  if (/NYSE|NEW YORK/.test(x)) return 'NYSE';
  if (/BATS|CBOE|BZX|BYX/.test(x)) return 'BATS';
  return undefined;
}
/** US tickers compare with '.' and '-' as the same (the book writes BRK-B, TradingView BRK.B). */
const usNorm = (t: string) => t.toUpperCase().replace(/-/g, '.');

/** The US book's /api/v1/us-book?view=universe answer: holdings on a US listing (bench names and non-US listings left out). */
export function usBookHoldings(json: unknown): BookRead {
  const j: any = json && typeof json === 'object' ? json : null;
  if (!j || j.ok === false || !Array.isArray(j.universe)) return { ok: false, reason: j?.error ? `US book could not be read (${String(j.error).slice(0, 80)})` : 'US book could not be read' };
  const out: BookHolding[] = []; const seen = new Set<string>();
  for (const u of j.universe) {
    if (!u || (u.origin !== 'book' && u.origin !== 'both') || u.listing !== 'US') continue;
    const t = usNorm(String(u.ticker || '').trim());
    if (!US_TICKER_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    const x = usExchangeOf(u.exchange);
    out.push(x ? { t, x } : { t });
  }
  return { ok: true, items: out };
}

// ── links ──────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const NAME_MATCH: Record<BookMarket, string[]> = { IN: ['indiaportfolio'], US: ['usaportfolio', 'usportfolio'] };
const LIST_HINT: Record<BookMarket, RegExp> = { IN: /india/, US: /usa|^us|us$/ };

export function linkedSection(s: WlStore, book: BookMarket): { list: WlList; section: WlSection } | null {
  for (const list of s.lists) for (const section of list.sections) if (section.book === book) return { list, section };
  return null;
}

/** The section the first run links: named "India Portfolio" / "USA Portfolio" (any case or spacing). When several lists have one,
 *  the list whose name says India / USA wins, then the one with the most rows. */
export function findBookSection(s: WlStore, book: BookMarket): { list: WlList; section: WlSection } | null {
  let best: { list: WlList; section: WlSection; score: number } | null = null;
  for (const list of s.lists) for (const section of list.sections) {
    if (!NAME_MATCH[book].includes(norm(section.name))) continue;
    const score = (LIST_HINT[book].test(norm(list.name)) ? 10_000 : 0) + section.items.length;
    if (!best || score > best.score) best = { list, section, score };
  }
  return best ? { list: best.list, section: best.section } : null;
}

const markAuto = (s: WlStore, book: BookMarket): WlStore => (s.bookAuto?.includes(book) ? s : { ...s, bookAuto: [...(s.bookAuto || []), book] });

/** Link one section to a book (any other section linked to that book is unlinked; its rows stay). */
export function linkSection(s: WlStore, listId: string, sectionId: string, book: BookMarket): WlStore {
  const target = s.lists.find((l) => l.id === listId)?.sections.find((x) => x.id === sectionId);
  if (!target || target.book === book) return target ? markAuto(s, book) : s;
  const lists = s.lists.map((l) => ({ ...l, sections: l.sections.map((x) => {
    if (l.id === listId && x.id === sectionId) return { ...x, book };
    if (x.book === book) { const { book: _b, ...rest } = x; return rest; }
    return x;
  }) }));
  return markAuto({ ...s, lists }, book);
}

/** Stop syncing a section. Its rows stay exactly as they are. */
export function unlinkSection(s: WlStore, listId: string, sectionId: string): WlStore {
  const sec = s.lists.find((l) => l.id === listId)?.sections.find((x) => x.id === sectionId);
  if (!sec?.book) return s;
  const book = sec.book;
  return markAuto(updateList(s, listId, (l) => ({ ...l, sections: l.sections.map((x) => {
    if (x.id !== sectionId) return x;
    const { book: _b, ...rest } = x; return rest;
  }) })), book);
}

/** First run: link "India Portfolio" / "USA Portfolio" once, when found and that book was never linked before. */
export function autoLinkSections(s: WlStore): { store: WlStore; linked: BookMarket[] } {
  let out = s; const linked: BookMarket[] = [];
  for (const book of ['IN', 'US'] as const) {
    if (out.bookAuto?.includes(book)) continue;
    if (linkedSection(out, book)) { out = markAuto(out, book); continue; }
    const f = findBookSection(out, book);
    if (!f) continue;
    out = linkSection(out, f.list.id, f.section.id, book);
    linked.push(book);
  }
  return { store: out, linked };
}

/** "Keep a section in sync with My Book" from the list menu: links the open list's section with the usual name, or adds one. */
export function createLinkedSection(s: WlStore, book: BookMarket): WlStore {
  const list = s.lists.find((l) => l.id === s.activeId) || s.lists[0];
  const same = list.sections.find((x) => NAME_MATCH[book].includes(norm(x.name)));
  if (same) return linkSection(s, list.id, same.id, book);
  const withSec = addSection(list, BOOK_SECTION_NAME[book]);
  if (withSec === list) return s;
  const sec = withSec.sections[withSec.sections.length - 1];
  return linkSection(updateList(s, list.id, () => withSec), list.id, sec.id, book);
}

// ── sync ───────────────────────────────────────────────────────────────────
export interface BookSyncResult {
  store: WlStore;
  /** symbols added to the linked section */
  added: string[];
  /** symbols taken out of the linked section (no longer held) */
  removed: string[];
  /** held names left where they are, in another section of the same list */
  elsewhere: string[];
  /** names that would leave the section but were kept (automatic run, unusually large drop) */
  heldBack: string[];
  /** held names not added because the list is full */
  full: string[];
  /** no linked section, or the book could not be read */
  skipped?: string;
}

const tOf = (book: BookMarket, t: string) => (book === 'US' ? usNorm(t) : t.toUpperCase());

/** One book → its linked section. Returns the SAME store object when nothing changes (so nothing is saved). */
export function syncBookSection(s: WlStore, book: BookMarket, read: BookRead, opts: { auto: boolean } = { auto: false }): BookSyncResult {
  const empty = { added: [], removed: [], elsewhere: [], heldBack: [], full: [] };
  const link = linkedSection(s, book);
  if (!link) return { store: s, ...empty, skipped: `No section is linked to ${BOOK_LABEL[book]}.` };
  if (!read.ok) return { store: s, ...empty, skipped: read.reason };
  const held = new Set(read.items.map((h) => tOf(book, h.t)));
  const { list, section } = link;

  // 1) take out rows of this market that are no longer held — only when the book has names in it
  let gone = held.size ? section.items.filter((it) => it.m === book && !held.has(tOf(book, it.t))) : [];
  const heldBack: string[] = [];
  const marketRows = section.items.filter((it) => it.m === book).length;
  if (opts.auto && gone.length > 3 && gone.length * 2 > marketRows) { heldBack.push(...gone.map((it) => it.t)); gone = []; }
  const goneSet = new Set(gone);
  let items = gone.length ? section.items.filter((it) => !goneSet.has(it)) : section.items;

  // 2) add held names the list does not have yet (any section, any exchange)
  const inList = new Set<string>(), inSection = new Set<string>();
  for (const sec of list.sections) for (const it of (sec.id === section.id ? items : sec.items)) {
    if (it.m !== book) continue;
    inList.add(tOf(book, it.t));
    if (sec.id === section.id) inSection.add(tOf(book, it.t));
  }
  let room = MAX_ITEMS - (listCount(list) - gone.length);
  const added: string[] = [], elsewhere: string[] = [], full: string[] = [];
  const toAdd: WlItem[] = [];
  for (const h of [...read.items].sort((a, b) => a.t.localeCompare(b.t))) {
    const k = tOf(book, h.t);
    if (inSection.has(k)) continue;
    if (inList.has(k)) { elsewhere.push(h.t); continue; }
    if (room <= 0) { full.push(h.t); continue; }
    toAdd.push(h.x ? { m: book, t: h.t, x: h.x } : { m: book, t: h.t });
    added.push(h.t); inList.add(k); room--;
  }
  if (toAdd.length) items = [...items, ...toAdd];
  if (!gone.length && !toAdd.length) return { store: s, ...empty, elsewhere, heldBack, full };
  const store = updateList(s, list.id, (l) => ({ ...l, sections: l.sections.map((x) => (x.id === section.id ? { ...x, items } : x)) }));
  return { store, added, removed: gone.map((it) => it.t), elsewhere, heldBack, full };
}

/** What a manual link would do right now (for the confirmation): names that would leave the section. */
export function previewLinkRemovals(s: WlStore, listId: string, sectionId: string, book: BookMarket, read: BookRead): string[] {
  if (!read.ok) return [];
  return syncBookSection(linkSection(s, listId, sectionId, book), book, read).removed;
}

// ── words ──────────────────────────────────────────────────────────────────
const few = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(', ')} +${xs.length - n} more` : xs.join(', '));

/** One short line for the panel footer; null when there is nothing worth saying. */
export function syncSummary(book: BookMarket, r: BookSyncResult, manual: boolean): string | null {
  const label = BOOK_LABEL[book];
  if (r.skipped) return manual ? `${label}: ${r.skipped} Nothing changed.` : null;
  const parts: string[] = [];
  if (r.added.length) parts.push(`${r.added.length} added (${few(r.added)})`);
  if (r.removed.length) parts.push(`${r.removed.length} no longer held, taken out of the section (${few(r.removed)})`);
  if (r.heldBack.length) parts.push(`${r.heldBack.length} not in the book were kept for now — use Sync now to take them out`);
  if (r.full.length) parts.push(`${r.full.length} not added, the list is full`);
  if (!parts.length) return manual ? `${label}: already up to date${r.elsewhere.length ? ` (${r.elsewhere.length} held name${r.elsewhere.length === 1 ? ' is' : 's are'} in other sections)` : ''}.` : null;
  return `${label}: ${parts.join('; ')}.`;
}

const hhmm = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** Tooltip on a linked section header. */
export function linkTooltip(book: BookMarket, lastAt: number | null | undefined, note?: string | null): string {
  const when = lastAt ? `last synced ${hhmm(lastAt)}` : 'not synced on this device yet';
  return `Kept in sync with ${BOOK_LABEL[book]} — ${when}. Names you hold are added here; names you no longer hold leave this section only.${note ? ` ${note}` : ''}`;
}

/** Items for the section header's right-click menu (added after the usual ones). */
export function bookSectionMenu(s: WlStore, section: WlSection): ChartMenuItem[] {
  if (section.book) {
    return [
      { id: 'book-info', label: `Linked to ${BOOK_LABEL[section.book]}`, disabled: true, sepBefore: true },
      { id: 'book-sync', label: 'Sync now' },
      { id: 'book-unlink', label: 'Unlink (keep the symbols)' },
    ];
  }
  return [
    { id: 'book-link', label: 'Keep in sync with My Book', sepBefore: true, children: (['IN', 'US'] as const).map((b) => {
      const other = linkedSection(s, b);
      return { id: `book-link:${b}`, label: other ? `${BOOK_LABEL[b]} (moves the link from “${other.section.name || 'no section'}”)` : BOOK_LABEL[b] };
    }) },
  ];
}

/** Read this device's last sync times. */
export function readSyncTimes(raw: unknown): Partial<Record<BookMarket, number>> {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const out: Partial<Record<BookMarket, number>> = {};
  for (const b of ['IN', 'US'] as const) if (Number.isFinite(Number(r[b])) && Number(r[b]) > 0) out[b] = Number(r[b]);
  return out;
}

