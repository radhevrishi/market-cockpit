// ═══════════════════════════════════════════════════════════════════════════
// MY BOOK = MY SAVED HOLDINGS. NOTHING ELSE.                           (zzz823)
//
// The owner: "some companies not in my portfolio book but showing, and some
// missing from my portfolio book." Portfolio Catalysts built "My book" from
// SIX places — four localStorage keys (three of them lists written by old
// versions of other pages and never cleaned up) plus the synced book snapshot
// (/api/v1/book/state — overwritten whole by whichever browser or phone
// synced last). It never read the one list the Portfolio page actually saves
// to the server (/api/portfolio, KV portfolio:<chat>). So:
//   · a name left on an OLD list, or in another device's stale snapshot,
//     showed as a holding (not in the book, but showing);
//   · a holding saved on another device reached this page only if that
//     device happened to be the last one to sync (in the book, but missing);
//   · "ABC" and "ABC-BE" were two different names, so a held name on the
//     Conviction Beats list under the other spelling showed twice.
//
// THE RULE NOW (one function, pure, tested):
//   My book = the Portfolio page's saved holdings — the server copy
//   (/api/portfolio) plus anything saved in this browser
//   (mc_portfolio_holdings) that has not reached the server yet. That is
//   exactly the merge the Portfolio page does when it opens (and it pushes
//   the extra up), so this page and that page show the same names.
//   Old lists and the synced snapshot are NEVER members; they are reported.
//   A name deleted on the Portfolio page leaves both copies, so it leaves here.
//   One company, one row: spellings are compared by heldKey (case, NSE:/BSE:
//   prefix, .NS/.BO suffix, the -BE/-SM series suffix); the plain spelling is
//   kept, the other is listed as merged.
//   The book is never filtered by Conviction Beats criteria, size or preset.
//
// PURE: no fetch, no window. The loader is lib/thesis/book-sources.
// ═══════════════════════════════════════════════════════════════════════════

import { heldKey } from './pc-bench';

export type BookSource = 'server' | 'browser';

export interface BookName {
  /** The spelling the page uses (and the evidence store is keyed by). */
  symbol: string;
  /** heldKey(symbol) — what "same company" is decided by. */
  key: string;
  sources: BookSource[];
  /** Other spellings of the same company, merged into this row. */
  merged: string[];
}

export interface ReadList { ok: boolean; symbols: string[]; updatedAt?: string | null; error?: string | null }

export interface IndiaBookInput {
  /** /api/portfolio — null while not read yet (first paint). */
  server: ReadList | null;
  /** This browser's mc_portfolio_holdings. */
  browser: string[];
  /** Old localStorage lists, by key — reported, never used. */
  legacy?: Record<string, string[]>;
  /** /api/v1/book/state held flags — reported, never used. */
  synced?: ReadList | null;
}

export interface SourceLine { label: string; count: number | null; used: boolean; note: string }
export interface IgnoredName { symbol: string; reason: string }

export interface ResolvedBook {
  names: BookName[];
  sources: SourceLine[];
  /** Names on a list that is NOT a source of the book, and not in it. */
  ignored: IgnoredName[];
  rule: string;
  /** True once the server copy has answered (or failed) — before that the book is this browser's list only. */
  settled: boolean;
  serverError: string | null;
}

const SERIES = /-(BE|SM|ST|BZ|E1|EQ)$/;

/** Pure: the saved-holdings book. */
export function resolveIndiaBook(input: IndiaBookInput): ResolvedBook {
  const byKey = new Map<string, BookName>();
  const add = (raw: string, src: BookSource) => {
    const sym = String(raw || '').toUpperCase().trim().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO|BSE|NSE)$/, '');
    const key = heldKey(sym);
    if (!key) return;
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { symbol: sym, key, sources: [src], merged: [] }); return; }
    if (!cur.sources.includes(src)) cur.sources.push(src);
    if (sym === cur.symbol) return;
    // Keep the plain spelling; the series-suffixed one is listed as merged.
    if (SERIES.test(cur.symbol) && !SERIES.test(sym)) { if (!cur.merged.includes(cur.symbol)) cur.merged.push(cur.symbol); cur.symbol = sym; }
    else if (!cur.merged.includes(sym)) cur.merged.push(sym);
  };
  const server = input.server;
  const serverUsed = !!server && server.ok;
  if (serverUsed) for (const s of server!.symbols) add(s, 'server');
  for (const s of input.browser) add(s, 'browser');
  const names = Array.from(byKey.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));

  const inBook = new Set(names.map((n) => n.key));
  const ignored: IgnoredName[] = [];
  const seenIgnored = new Set<string>();
  const ignore = (s: string, reason: string) => {
    const k = heldKey(s);
    if (!k || inBook.has(k) || seenIgnored.has(k)) return;
    seenIgnored.add(k);
    ignored.push({ symbol: String(s).toUpperCase().trim(), reason });
  };
  for (const [k, list] of Object.entries(input.legacy || {})) for (const s of list) ignore(s, `only on an old list in this browser (${k}) — not a saved holding, so not shown`);
  if (input.synced?.ok) for (const s of input.synced.symbols) ignore(s, 'only in the synced book snapshot (last device to sync) — not a saved holding, so not shown');

  const onlyBrowser = names.filter((n) => n.sources.length === 1 && n.sources[0] === 'browser').length;
  const sources: SourceLine[] = [
    {
      label: 'Saved holdings on the server (Portfolio page)',
      count: server?.ok ? server.symbols.length : null,
      used: serverUsed,
      note: !server ? 'reading…' : server.ok ? `used${server.updatedAt ? ` · saved ${String(server.updatedAt).slice(0, 10)}` : ''}` : `could not be read (${server.error || 'error'}) — this browser's list only`,
    },
    {
      label: 'Saved holdings in this browser (Portfolio page)',
      count: input.browser.length,
      used: true,
      note: onlyBrowser ? `used · ${onlyBrowser} not on the server yet — open the Portfolio page to push them up (or delete them there)` : 'used',
    },
  ];
  for (const [k, list] of Object.entries(input.legacy || {})) {
    if (list.length) sources.push({ label: `Old list in this browser: ${k}`, count: list.length, used: false, note: 'NOT used — written by an older version of another page' });
  }
  if (input.synced) {
    sources.push({ label: 'Synced book snapshot (/api/v1/book/state)', count: input.synced.ok ? input.synced.symbols.length : null, used: false, note: input.synced.ok ? `NOT used — a copy from the last device that synced${input.synced.updatedAt ? ` (${String(input.synced.updatedAt).slice(0, 10)})` : ''}` : `NOT used (not read: ${input.synced.error || 'error'})` });
  }
  return {
    names, sources, ignored,
    rule: 'My book = your saved holdings on the Portfolio page: the server copy plus anything saved in this browser that has not reached the server yet (the Portfolio page merges the same way). Old lists and the synced snapshot are never used. One company = one row (ABC and ABC-BE are the same). Never filtered by Conviction Beats criteria, size or preset.',
    settled: !!server,
    serverError: server && !server.ok ? (server.error || 'error') : null,
  };
}

/** Plain words: why a saved name is in the book. */
export function bookWhy(n: BookName): string {
  const src = n.sources.includes('server') && n.sources.includes('browser') ? 'saved holding (server + this browser)'
    : n.sources.includes('server') ? 'saved holding (server)'
    : 'saved holding in this browser only — not on the server yet';
  const bse = /^\d{6}$/.test(n.symbol) ? ' · a BSE code: Conviction Beats uses NSE symbols, so it cannot be matched to the bench' : '';
  return `${src}${n.merged.length ? ` · also saved as ${n.merged.join(', ')} (same company, shown once)` : ''}${bse}`;
}

/** Pure: the universe — book first, then the bench names (already not held). */
export function bookUniverse(book: BookName[], bench: Iterable<string>): Map<string, 'book' | 'bench'> {
  const out = new Map<string, 'book' | 'bench'>();
  const keys = new Set<string>();
  for (const n of book) { out.set(n.symbol, 'book'); keys.add(n.key); }
  for (const s of bench) {
    const k = heldKey(s);
    if (!k || keys.has(k) || out.has(s)) continue;
    out.set(s, 'bench');
  }
  return out;
}

// ── THE BOOK CHECK. What the owner reads to verify the page. ───────────────

export interface CheckRow { symbol: string; origin: string; preset?: { state?: string | null; text?: string | null } | null; benchSource?: string | null }

export interface BookCheck {
  sources: SourceLine[];
  rule: string;
  book: Array<{ symbol: string; why: string }>;
  bench: Array<{ symbol: string; why: string }>;
  /** Saved holdings NOT shown as a book row, with the reason. */
  notShown: IgnoredName[];
  /** Book rows NOT in the saved holdings — must be zero. */
  notSaved: IgnoredName[];
  ignored: IgnoredName[];
  line: string;
}

/**
 * Pure. `saved` is the resolved book; `rows` every row on the page (all
 * sources, before any view chip); `savedElsewhere` saved holdings that are
 * deliberately not rows (US: non-US listings), with the reason.
 */
export function buildBookCheck(o: {
  saved: BookName[]; rows: CheckRow[]; sources: SourceLine[]; rule: string; ignored?: IgnoredName[];
  savedElsewhere?: IgnoredName[]; keyOf?: (s: string) => string;
}): BookCheck {
  const keyOf = o.keyOf || heldKey;
  const rowByKey = new Map<string, CheckRow>();
  for (const r of o.rows) { const k = keyOf(r.symbol); if (k && !rowByKey.has(k)) rowByKey.set(k, r); }
  const savedKeys = new Set(o.saved.map((n) => keyOf(n.symbol)));
  const elsewhere = new Set((o.savedElsewhere || []).map((x) => keyOf(x.symbol)));
  const notShown: IgnoredName[] = [...(o.savedElsewhere || [])];
  const book: Array<{ symbol: string; why: string }> = [];
  for (const n of o.saved) {
    const k = keyOf(n.symbol);
    if (elsewhere.has(k)) continue;
    const r = rowByKey.get(k);
    if (!r) { notShown.push({ symbol: n.symbol, reason: 'saved, but no row on this page — reload; if it persists this is a fault' }); continue; }
    if (r.origin === 'bench') { notShown.push({ symbol: n.symbol, reason: 'saved, but shown as a bench name — a fault' }); continue; }
    book.push({ symbol: r.symbol, why: bookWhy(n) });
  }
  const notSaved: IgnoredName[] = [];
  const bench: Array<{ symbol: string; why: string }> = [];
  for (const r of o.rows) {
    if (r.origin === 'bench') {
      bench.push({ symbol: r.symbol, why: `${r.benchSource || 'bench'} · ${r.preset?.text || 'criteria not checked yet'}` });
      continue;
    }
    if (!savedKeys.has(keyOf(r.symbol))) notSaved.push({ symbol: r.symbol, reason: 'shown as a holding but not in your saved holdings' });
  }
  bench.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const line = `Saved holdings ${o.saved.length} → shown in My book ${book.length}`
    + `${notShown.length ? ` · ${notShown.length} saved but not shown (reason below)` : ' · every saved holding is shown'}`
    + ` · shown as a holding but not saved: ${notSaved.length}${notSaved.length ? ' ⚠' : ' ✓'}`
    + ` · bench ${bench.length} (Conviction Beats names you do not hold)`
    + `${(o.ignored || []).length ? ` · ${(o.ignored || []).length} names on old lists ignored` : ''}`;
  return { sources: o.sources, rule: o.rule, book, bench, notShown, notSaved, ignored: o.ignored || [], line };
}
