// ═══════════════════════════════════════════════════════════════════════════
// WHICH COMPANIES THIS PAGE IS RESPONSIBLE FOR.                     (zzz731)
//
// Portfolio Catalysts watched exactly one list: `mc_portfolio_holdings` in
// this browser's localStorage. Checked live against the server book on 21
// September, that is 51 names — and the server book holds 360, of which 311
// are the conviction bench. So the page was not dropping holdings; it had
// never been told about the bench at all, and a name the owner is tracking
// hard enough to keep on the bench had no thesis ledger anywhere.
//
// THE UNIVERSE IS NOW: every company in the book, plus every bench name that
// passes the quality preset. Two populations, one engine, and never confused
// with each other — a bench name is a candidate, not a holding, and the card
// says which it is. Nothing here implies ownership of a bench name.
//
// WHY THE PRESET GATES THE BENCH AND NOTHING GATES THE BOOK. The book is what
// the owner actually owns: it is watched in full, whatever it grades at, since
// the entire point is to catch a holding deteriorating. The bench is a
// candidate list that grows on every scan, so it is gated by the same preset
// the alerts already use (lib/quality-preset) — one definition, applied to the
// same graded row the thesis engine reads, so the page and the alert can never
// disagree about what "preset-passing" means.
//
// TWO PLACES A HOLDING CAN HIDE, both now read:
//
//   1. FOUR LEGACY localStorage KEYS. The earnings page has probed all four
//      since PATCH 0968; this module was reading one. A book written in an
//      older session was invisible here and nowhere else.
//   2. THE SERVER BOOK (KV, /api/v1/book/state). localStorage is per-browser,
//      so opening this page on a second machine showed an empty book and the
//      page said "your book is empty" — which is a wrong answer, not a blank
//      one. The server book is the union partner, never the replacement: a
//      name added locally and not yet synced still shows.
//
// PURE where it can be: the merge and the preset gate take data and return
// data, so both are tested against fixtures rather than against a browser.
// ═══════════════════════════════════════════════════════════════════════════

import { normSymbol } from '@/lib/portfolio-symbols';
import { passesIndiaPreset } from '@/lib/quality-preset';

/** Where a name in the universe came from. A name can be both. */
export type BookOrigin = 'book' | 'bench' | 'both';

export const ORIGIN_META: Record<BookOrigin, { label: string; short: string; icon: string; color: string }> = {
  book:  { label: 'In my book',            short: 'Book',  icon: '📗', color: '#34D399' },
  bench: { label: 'Conviction bench',      short: 'Bench', icon: '🏆', color: '#FCD34D' },
  both:  { label: 'Held — and on the bench', short: 'Both', icon: '📗', color: '#34D399' },
};

/**
 * Every localStorage key a book has ever been written under. All four are
 * read and MERGED, not first-wins: a partial book under an old key plus a
 * partial book under the new one is still one book, and picking whichever
 * key answered first would silently drop the other half.
 */
export const HOLDING_KEYS = [
  'mc_portfolio_holdings',
  'portfolioHoldings',
  'mc_portfolio_tickers',
  'mc_portfolio_holdings_v1',
] as const;

/**
 * Pure: one stored value in, its symbols out.
 *
 * Three shapes have been written over the life of this store — an array of
 * strings, an array of objects keyed `ticker` or `symbol`, and an object map
 * keyed by ticker. Anything else yields nothing rather than a guess.
 */
export function symbolsFromStoredValue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!parsed) return [];
  let out: string[] = [];
  if (Array.isArray(parsed)) {
    out = parsed.map((h: any) => (typeof h === 'string' ? h : (h?.ticker ?? h?.symbol ?? '')));
  } else if (typeof parsed === 'object') {
    out = Object.keys(parsed);
  }
  return out.map((s) => normSymbol(s)).filter((s) => s.length > 0);
}

/** The book as this browser has it, across every key it may live under. */
export function readHoldingSymbols(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const out = new Set<string>();
  for (const key of HOLDING_KEYS) {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(key); } catch { raw = null; }
    for (const s of symbolsFromStoredValue(raw)) out.add(s);
  }
  return out;
}

export interface ServerBook {
  held: string[];
  benched: string[];
  /** Null when the server could not be read — distinct from "read, and empty". */
  error: string | null;
}

/**
 * The book as the server has it. A failure is reported, never returned as an
 * empty book: "your book is empty" and "the book could not be read" are
 * different answers and this page has shipped the first in place of the
 * second before.
 */
export async function fetchServerBook(): Promise<ServerBook> {
  try {
    const r = await fetch('/api/v1/book/state?feed=0', { cache: 'no-store' });
    if (!r.ok) return { held: [], benched: [], error: `book/state answered HTTP ${r.status}` };
    const j = await r.json();
    const tickers: any[] = Array.isArray(j?.book?.tickers) ? j.book.tickers : [];
    const held: string[] = [];
    const benched: string[] = [];
    for (const t of tickers) {
      const s = normSymbol(t?.ticker);
      if (!s) continue;
      if (t?.held) held.push(s);
      else if (t?.benched) benched.push(s);
    }
    return { held, benched, error: null };
  } catch (e: any) {
    return { held: [], benched: [], error: String(e?.message || e) };
  }
}

/**
 * Pure: which bench candidates pass the preset, given whatever graded rows
 * are in hand.
 *
 * A candidate with NO graded row is excluded and counted, never waved
 * through. Including it would mean showing a name as preset-passing on the
 * strength of never having checked it, which is the exact failure this
 * engine's absence states exist to prevent.
 */
export function benchPassingPreset(
  candidates: string[],
  gradedBySymbol: Record<string, any>,
): { passed: string[]; failed: number; unchecked: string[] } {
  const passed: string[] = [];
  const unchecked: string[] = [];
  let failed = 0;
  for (const raw of candidates) {
    const sym = normSymbol(raw);
    if (!sym) continue;
    const g = gradedBySymbol[sym] || gradedBySymbol[sym.toUpperCase()] || null;
    if (!g || g.source === 'none') { unchecked.push(sym); continue; }
    if (passesIndiaPreset(g)) passed.push(sym);
    else failed++;
  }
  return { passed, failed, unchecked };
}

/**
 * The ceiling for "small and mid cap", in ₹ Cr.
 *
 * The preset has a market-cap FLOOR and no ceiling, so the bench's
 * preset-passing names include TITAN at ₹4.3 lakh Cr and HINDALCO at ₹2.2
 * lakh Cr. The owner's research is small and mid cap, so the page filters
 * above this line BY DEFAULT and says how many it hid — a default that hides
 * without saying so is the thing this engine exists not to do.
 *
 * It filters the BENCH only. A holding is never hidden by a size rule: if he
 * owns it, he needs to see it deteriorate whatever it is worth.
 */
export const SMALL_MID_CAP_MAX_CR = 50_000;

/** Pure: is this row inside the small/mid band? An unknown cap is KEPT — the
 *  size filter is a convenience, and dropping a name because its cap has not
 *  been parsed would be a silent exclusion on missing data. */
export function isSmallMidCap(graded: any): boolean {
  const m = graded?.market_cap_cr;
  if (typeof m !== 'number' || !Number.isFinite(m)) return true;
  return m <= SMALL_MID_CAP_MAX_CR;
}

/** Pure: merge the two populations into one addressed list. */
export function mergeUniverse(book: Iterable<string>, bench: Iterable<string>): Map<string, BookOrigin> {
  const out = new Map<string, BookOrigin>();
  for (const s of book) {
    const k = normSymbol(s);
    if (k) out.set(k, 'book');
  }
  for (const s of bench) {
    const k = normSymbol(s);
    if (!k) continue;
    out.set(k, out.has(k) ? 'both' : 'bench');
  }
  return out;
}

/** Counts for the header line. `book` counts everything owned, including the
 *  names that are also benched — "how many do I own" must not change because
 *  a holding happens to appear on a candidate list. */
export function originCounts(origins: Iterable<BookOrigin>): { book: number; bench: number; both: number; total: number } {
  let book = 0, bench = 0, both = 0, total = 0;
  for (const o of origins) {
    total++;
    if (o === 'both') { both++; book++; bench++; }
    else if (o === 'book') book++;
    else bench++;
  }
  return { book, bench, both, total };
}
