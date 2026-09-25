// ═══════════════════════════════════════════════════════════════════════════
// WHICH STOCKS THE PORTFOLIO FUNDAMENTALS ANALYZER SHOWS.            (zzz799)
//
// Before: the analyzer showed whatever was in one synced CSV — the screener.in
// watchlist 10432429 for India and the TradingView watchlist 339270482 for the
// USA. Those are lists the owner keeps by hand on other websites, so they
// drift away from what he actually owns and never contain his Conviction
// Beats. "Show the stocks from my portfolio book and my conviction beats,
// for each country."
//
// Now, per country:
//   India → India Portfolio Book (server /api/portfolio, the /portfolio page's
//           own store) + India Conviction Beats (server /api/v1/bench, plus
//           the names this browser graded that the server does not have yet,
//           minus the names the owner removed).
//   USA   → US Portfolio Book holdings (server /api/v1/us-book?view=universe;
//           cash is not a stock, a Frankfurt / euro line is left out and
//           named) + US Conviction Beats (server /api/v1/bench-us, plus this
//           browser's list, minus removals — the same merge US Portfolio
//           Catalysts uses).
//
// The FIGURES still come from the synced CSV exports (the only place this page
// has fundamentals): the portfolio file first, then any other synced export of
// the same country. A name found in none of them is still listed, with blank
// figures and the reason — never a made-up number.
//
// This file is PURE (no fetch, no storage) so it is tested with fixtures.
// ═══════════════════════════════════════════════════════════════════════════

import { normSymbol } from '@/lib/portfolio-symbols';
import { usTickerKey } from '@/lib/us-thesis/sanitize';

export type FundMarket = 'INDIA' | 'USA';
/** Where a name came from. `both` = held AND on Conviction Beats. */
export type FundOrigin = 'book' | 'cb' | 'both';
/** What the owner chose to look at. `file` = the old behaviour (the synced / uploaded list as it is). */
export type FundSourceFilter = 'both' | 'book' | 'cb' | 'file';

export const ORIGIN_CHIP: Record<FundOrigin, { icon: string; label: string }> = {
  book: { icon: '📗', label: 'In my book' },
  cb: { icon: '🏆', label: 'Conviction Beats' },
  both: { icon: '📗🏆', label: 'In my book and on Conviction Beats' },
};

export interface FundUniverseName {
  symbol: string;
  origin: FundOrigin;
  company: string | null;
}

export interface FundUniverse {
  market: FundMarket;
  names: FundUniverseName[];
  counts: { book: number; cb: number; both: number; total: number };
  /** Lines in the book this analyzer cannot cover, each with the reason in words. */
  leftOut: Array<{ symbol: string; reason: string }>;
  /** Plain-English source lines for the header ("India Portfolio Book: 52 from the server"). */
  sources: string[];
  /** A failure reading a source — shown, never turned into "empty". */
  errors: string[];
}

/** One symbol, normalised the way this market writes tickers. */
export function fundKey(market: FundMarket, raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (market === 'USA') {
    // TradingView sometimes writes "NASDAQ:AAPL"; class shares as BRK.B.
    const bare = s.includes(':') ? s.split(':').pop() || '' : s;
    return usTickerKey(bare.split('@')[0]);
  }
  return normSymbol(s.replace(/^(NSE|BSE):/i, ''));
}

/** Every key a CSV row can be matched by (NSE code AND BSE code for India). */
export function rowKeys(market: FundMarket, row: Record<string, any>): string[] {
  const fields = market === 'USA' ? ['Symbol', 'Ticker'] : ['NSE Code', 'BSE Code', 'Symbol', 'Ticker'];
  const out: string[] = [];
  for (const f of fields) {
    const k = fundKey(market, row?.[f]);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Pure: book + Conviction Beats → one de-duplicated list with origins. */
export function mergeFundUniverse(
  market: FundMarket,
  book: Array<{ symbol: string; company?: string | null }>,
  cb: Array<{ symbol: string; company?: string | null }>,
): FundUniverseName[] {
  const out = new Map<string, FundUniverseName>();
  for (const b of book) {
    const k = fundKey(market, b.symbol);
    if (!k) continue;
    const had = out.get(k);
    out.set(k, { symbol: k, origin: 'book', company: had?.company || b.company || null });
  }
  for (const c of cb) {
    const k = fundKey(market, c.symbol);
    if (!k) continue;
    const had = out.get(k);
    out.set(k, { symbol: k, origin: had ? (had.origin === 'cb' ? 'cb' : 'both') : 'cb', company: had?.company || c.company || null });
  }
  return Array.from(out.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Counts for the chips. `book` includes names that are also on CB (and `cb` likewise). */
export function fundCounts(names: FundUniverseName[]): FundUniverse['counts'] {
  let book = 0, cb = 0, both = 0;
  for (const n of names) {
    if (n.origin === 'both') { both++; book++; cb++; }
    else if (n.origin === 'book') book++;
    else cb++;
  }
  return { book, cb, both, total: names.length };
}

export function inFilter(origin: FundOrigin, filter: FundSourceFilter): boolean {
  if (filter === 'both' || filter === 'file') return true;
  if (filter === 'book') return origin === 'book' || origin === 'both';
  return origin === 'cb' || origin === 'both';
}

/**
 * Pure: the rows the analyzer shows for a chosen source.
 *
 * `fileRows` is the list the page already has (synced portfolio CSV + any
 * uploads). `pool` is every other synced export of the same country, each
 * with its file name. For each universe name: the file row if it has one,
 * else the first pool row that matches, else a blank placeholder that says
 * so. `file` returns `fileRows` untouched (the old behaviour).
 */
export function buildUniverseRows(
  market: FundMarket,
  universe: FundUniverseName[],
  fileRows: Array<Record<string, any>>,
  pool: Array<{ file: string; rows: Array<Record<string, any>> }>,
  filter: FundSourceFilter,
): { rows: Array<Record<string, any>>; withFigures: number; blank: string[]; fromOtherFiles: number } {
  if (filter === 'file') return { rows: fileRows, withFigures: fileRows.length, blank: [], fromOtherFiles: 0 };
  const byKey = new Map<string, Record<string, any>>();
  for (const r of fileRows) for (const k of rowKeys(market, r)) if (!byKey.has(k)) byKey.set(k, r);
  const poolByKey = new Map<string, { file: string; row: Record<string, any> }>();
  for (const p of pool) for (const r of p.rows) {
    // A TradingView export can carry non-US names; a US analyzer row must be a US listing.
    if (market === 'USA' && r?.Exchange && !/^(NASDAQ|NYSE|AMEX|NYSE ?ARCA|NYSE ?AMERICAN|BATS|CBOE|OTC)/i.test(String(r.Exchange))) continue;
    for (const k of rowKeys(market, r)) if (!poolByKey.has(k)) poolByKey.set(k, { file: p.file, row: r });
  }
  const rows: Array<Record<string, any>> = [];
  const blank: string[] = [];
  let withFigures = 0, fromOtherFiles = 0;
  for (const n of universe) {
    if (!inFilter(n.origin, filter)) continue;
    const own = byKey.get(n.symbol);
    if (own) { rows.push({ ...own, _origin: n.origin }); withFigures++; continue; }
    const hit = poolByKey.get(n.symbol);
    if (hit) {
      rows.push({ ...hit.row, _files: [hit.file], _origin: n.origin });
      withFigures++; fromOtherFiles++;
      continue;
    }
    blank.push(n.symbol);
    rows.push(market === 'USA'
      ? { Symbol: n.symbol, Description: n.company || n.symbol, _origin: n.origin, _blank: 'no row in any synced TradingView export yet' }
      : { Name: n.company || n.symbol, 'NSE Code': n.symbol, _origin: n.origin, _blank: 'no row in any synced screener.in export yet' });
  }
  return { rows, withFigures, blank, fromOtherFiles };
}

// ── India Conviction Beats: the compact server list ────────────────────────

export interface IndiaBenchName { ticker: string; company: string | null; tier: string | null; filing_date: string | null }

/** Bench payload entries → ticker / company / tier / date, one per ticker (newest filing wins). */
export function compactIndiaBench(entries: unknown): IndiaBenchName[] {
  const by = new Map<string, IndiaBenchName>();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== 'object') continue;
    const t = normSymbol((e as any).ticker);
    if (!t) continue;
    const tier = (e as any).tier ? String((e as any).tier).toUpperCase() : null;
    if (tier && tier !== 'BLOCKBUSTER' && tier !== 'STRONG') continue;
    const n: IndiaBenchName = {
      ticker: t, tier,
      company: String((e as any).company || (e as any).company_name || (e as any).name || '').slice(0, 120) || null,
      filing_date: (e as any).filing_date ? String((e as any).filing_date).slice(0, 10) : null,
    };
    const had = by.get(t);
    if (!had || String(n.filing_date || '') > String(had.filing_date || '')) by.set(t, { ...n, company: n.company || had?.company || null });
  }
  return Array.from(by.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Server list + this browser's list − the owner's removals. Pure. */
export function mergeIndiaBench(server: IndiaBenchName[], local: Array<{ ticker: string; company?: string | null }>, removed: Iterable<string> = []): { names: Array<{ symbol: string; company: string | null }>; server: number; localOnly: number; removed: number } {
  const off = new Set(Array.from(removed, (t) => normSymbol(t)).filter(Boolean));
  const out = new Map<string, { symbol: string; company: string | null }>();
  let removedN = 0;
  for (const s of server) {
    if (off.has(s.ticker)) { removedN++; continue; }
    out.set(s.ticker, { symbol: s.ticker, company: s.company });
  }
  let localOnly = 0;
  for (const l of local) {
    const t = normSymbol(l?.ticker);
    if (!t || out.has(t)) continue;
    out.set(t, { symbol: t, company: l.company || null });
    localOnly++;
  }
  return { names: Array.from(out.values()), server: server.length, localOnly, removed: removedN };
}

/** US book universe entries → holdings the analyzer covers, and the lines it leaves out (named). */
export function usBookHoldings(universe: unknown): { held: Array<{ symbol: string }>; leftOut: Array<{ symbol: string; reason: string }> } {
  const held: Array<{ symbol: string }> = [];
  const leftOut: Array<{ symbol: string; reason: string }> = [];
  for (const u of Array.isArray(universe) ? universe : []) {
    if (!u || (u.origin !== 'book' && u.origin !== 'both')) continue;   // a US-book bench entry is not a holding
    const t = fundKey('USA', u.ticker);
    if (!t) continue;
    if (u.listing !== 'US') {
      const x = String(u.exchange || '').toUpperCase();
      const venue = /^(FWB|FRA|XETRA|GER)/.test(x) ? 'FWB, EUR' : x || 'non-US';
      leftOut.push({ symbol: t, reason: `${t} (${venue}) is not a US listing — the US fundamentals exports do not cover it` });
      continue;
    }
    held.push({ symbol: t });
  }
  return { held, leftOut };
}
