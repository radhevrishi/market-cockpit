// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS SEARCH — one matcher for the India and US Earnings Opportunities
// pages.  (zzz812)
//
// WHY THIS FILE EXISTS.
//
// "I search FCL on India Earnings Opportunities and nothing happens." FCL
// (Fineotex) reported Q1 FY27 in August. Three things stood between the owner
// and the card:
//
//   1. The server index behind the India box read `graded:v10:<date>` — a
//      namespace nothing has written to since the engine moved to v23. Every
//      result filed after that bump was simply not in the index, so a recent
//      small cap could never be found. The index now reads the current key
//      (lib/graded-cache-key.ts) and falls back through the legacy ones.
//   2. The page only shows ONE filing date (or, on the US page, a window of
//      sessions). A company that reported on another day got "no match" with
//      no explanation. Search now looks at the loaded window first, then at
//      the graded history the server / browser already holds, and says which.
//   3. Filters (ELITE, cap bucket, pattern, a collapsed tier) could hide the
//      one card that matched, and the search said nothing. A hidden match is
//      now reported with the filter that hid it, and can be shown anyway.
//
// Everything here is pure (no React, no fetch) so it can be unit-tested; the
// history lookup is passed in as a function.
// ═══════════════════════════════════════════════════════════════════════════

export interface SearchableRow {
  ticker: string;
  company?: string | null;
  filing_date?: string | null;
  tier?: string | null;
  bse_code?: string | number | null;
  quarter?: string | null;
}

/** Exchange prefixes people paste in: "NSE:FCL", "NASDAQ:NVDA", "BOM:541557". */
const PREFIX_RE = /^(NSE|BSE|BOM|NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX|ARCA|OTC|OTCMKTS|US)[:\s]+/;
/** Suffixes from Yahoo / TradingView / NSE series: "FCL.NS", "FCL.BO", "FCL-EQ". */
const SUFFIX_RE = /(\.(NS|NSE|BO|BSE|US)|-(EQ|BE|BZ))$/;

/**
 * One canonical form for a ticker, so "fcl", " FCL ", "NSE:FCL", "FCL.NS" and
 * "FCL-EQ" all compare equal. A 6-digit BSE code is returned as-is.
 */
export function normalizeTicker(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';
  s = s.replace(PREFIX_RE, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(SUFFIX_RE, '');
  return s;
}

const COMPANY_STOP = new Set(['LTD', 'LIMITED', 'INC', 'CORP', 'CORPORATION', 'CO', 'PLC', 'THE']);

/** Upper-case alphanumeric words of a company name, without "Ltd"/"Inc" noise. */
export function companyWords(name: string | null | undefined): string[] {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, ' ')
    .split(' ')
    .filter((w) => w && !COMPANY_STOP.has(w));
}

export interface ParsedQuery {
  raw: string;        // what the user typed, trimmed
  ticker: string;     // normalised ticker form
  words: string[];    // company-name words
}

export function parseQuery(q: string | null | undefined): ParsedQuery | null {
  const raw = String(q ?? '').trim();
  if (!raw) return null;
  const ticker = normalizeTicker(raw);
  const words = companyWords(raw);
  if (!ticker && !words.length) return null;
  return { raw, ticker, words };
}

// Score bands. Anything a ticker matches exactly beats anything else.
export const SCORE_TICKER_EXACT = 1000;
export const SCORE_TICKER_PREFIX = 600;
export const SCORE_NAME_WORDS = 300;
export const SCORE_NAME_SUBSTRING = 100;

/**
 * How well one row matches. 0 = no match.
 *
 *   exact ticker (after normalising both sides) ........ 1000
 *   ticker starts with the query (shorter ticker wins) .. 500–600
 *   every query word starts a word of the company name .. 300–350
 *   the query (≥ 4 letters) appears inside the name ..... 100
 *
 * Deliberately NOT a match: the query inside the middle of a ticker. "FCL"
 * must not drag in every ticker that merely contains those three letters.
 */
export function scoreRow(pq: ParsedQuery, row: SearchableRow): number {
  const t = normalizeTicker(row.ticker);
  const bse = row.bse_code != null ? String(row.bse_code).trim() : '';
  if (pq.ticker && (t === pq.ticker || (bse && bse === pq.ticker))) return SCORE_TICKER_EXACT;
  let best = 0;
  if (pq.ticker && t.startsWith(pq.ticker)) {
    best = SCORE_TICKER_PREFIX - Math.min(100, (t.length - pq.ticker.length) * 10);
  }
  if (pq.words.length) {
    const cw = companyWords(row.company);
    if (cw.length) {
      const all = pq.words.every((w) => cw.some((c) => c.startsWith(w)));
      if (all) {
        const lead = cw[0].startsWith(pq.words[0]) ? 50 : 0;
        best = Math.max(best, SCORE_NAME_WORDS + lead);
      } else {
        const flatQ = pq.words.join('');
        if (flatQ.length >= 4 && cw.join('').includes(flatQ)) best = Math.max(best, SCORE_NAME_SUBSTRING);
      }
    }
  }
  return best;
}

export interface RankedHit<T> { row: T; score: number }

/**
 * Rank rows against a query: best score first, then the newest filing, then
 * ticker A→Z so the order is stable between renders.
 */
export function rankMatches<T extends SearchableRow>(rows: readonly T[], q: string | ParsedQuery | null, limit = 25): RankedHit<T>[] {
  const pq = typeof q === 'string' || q == null ? parseQuery(q as any) : q;
  if (!pq) return [];
  const out: RankedHit<T>[] = [];
  for (const row of rows) {
    if (!row || !row.ticker) continue;
    const s = scoreRow(pq, row);
    if (s > 0) out.push({ row, score: s });
  }
  out.sort((a, b) =>
    b.score - a.score
    || String(b.row.filing_date || '').localeCompare(String(a.row.filing_date || ''))
    || String(a.row.ticker).localeCompare(String(b.row.ticker)));
  return out.slice(0, limit);
}

/** Same ticker + filing date = the same result, whichever store it came from. */
export function dedupeHits<T extends SearchableRow>(hits: RankedHit<T>[]): RankedHit<T>[] {
  const seen = new Set<string>();
  const out: RankedHit<T>[] = [];
  for (const h of hits) {
    const k = normalizeTicker(h.row.ticker) + '@' + String(h.row.filing_date || h.row.quarter || '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

// ── filters ────────────────────────────────────────────────────────────────

export interface WindowHit<T> extends RankedHit<T> {
  /** Why the page's current filters hide this row. Empty = it is visible. */
  hiddenBy: string[];
}

export function annotateHidden<T extends SearchableRow>(hits: RankedHit<T>[], hiddenReasons: (row: T) => string[]): WindowHit<T>[] {
  return hits.map((h) => {
    let r: string[] = [];
    try { r = hiddenReasons(h.row) || []; } catch { r = []; }
    return { ...h, hiddenBy: r };
  });
}

export function hiddenNote(reasons: string[]): string {
  return reasons.length ? `shown despite your filters (${reasons.join(' / ')})` : '';
}

export function hiddenCountNote(n: number): string {
  return n <= 0 ? '' : `${n} match${n === 1 ? '' : 'es'} hidden by filters`;
}

// ── history fallback + honest not-found ────────────────────────────────────

export function fmtSearchDate(iso: string | null | undefined): string {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || 'an earlier';
  const d = new Date(s + 'T00:00:00Z');
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function historyNote(filingDate: string | null | undefined): string {
  return `Found in ${fmtSearchDate(filingDate)} results (outside your current window)`;
}

export function notFoundMessage(q: string, lookbackDays: number, reason?: string | null): string {
  const label = normalizeTicker(q) || q.trim();
  return `${label}: no graded result on file for the last ${lookbackDays} days — it may not have reported in the window, or its filing wasn't graded${reason ? ` (${reason})` : ''}.`;
}

export type SearchOutcome<T extends SearchableRow, H extends SearchableRow = SearchableRow> =
  | { kind: 'empty' }
  | { kind: 'window'; hits: WindowHit<T>[]; visibleCount: number; hiddenCount: number; note: string }
  | { kind: 'history'; hits: RankedHit<H>[]; note: string }
  | { kind: 'none'; message: string; historyError?: string };

export interface HistoryResult<H> { rows: H[]; reason?: string | null; lookbackDays?: number | null }

export interface ResolveSearchArgs<T extends SearchableRow, H extends SearchableRow> {
  q: string;
  windowRows: readonly T[];
  hiddenReasons?: (row: T) => string[];
  /**
   * Graded history the server/browser already holds. Must not start new
   * grading. May also say why it came back empty and how far back it looked.
   */
  fetchHistory?: (pq: ParsedQuery) => Promise<H[] | HistoryResult<H>>;
  lookbackDays: number;
  notFoundReason?: string | null;
  limit?: number;
}

/**
 * The whole search, in order:
 *   1. the loaded window (with filter-hidden matches flagged, never dropped);
 *   2. the graded history already on file, newest first;
 *   3. an honest "not on file" message.
 * Never returns a silent empty result for a non-empty query.
 */
export async function resolveSearch<T extends SearchableRow, H extends SearchableRow = SearchableRow>(
  a: ResolveSearchArgs<T, H>,
): Promise<SearchOutcome<T, H>> {
  const pq = parseQuery(a.q);
  if (!pq) return { kind: 'empty' };
  const limit = a.limit ?? 12;
  const inWindow = rankMatches(a.windowRows, pq, limit);
  if (inWindow.length) {
    const hits = annotateHidden(inWindow, a.hiddenReasons || (() => []));
    const hiddenCount = hits.filter((h) => h.hiddenBy.length > 0).length;
    return {
      kind: 'window', hits, hiddenCount,
      visibleCount: hits.length - hiddenCount,
      note: hiddenCountNote(hiddenCount),
    };
  }
  let historyError: string | undefined;
  let reason: string | null | undefined = a.notFoundReason;
  let lookback = a.lookbackDays;
  if (a.fetchHistory) {
    try {
      const got = await a.fetchHistory(pq);
      const hist: H[] = Array.isArray(got) ? got : (got?.rows || []);
      if (!Array.isArray(got) && got) {
        if (got.reason) reason = got.reason;
        if (typeof got.lookbackDays === 'number' && got.lookbackDays > 0) lookback = got.lookbackDays;
      }
      const ranked = dedupeHits(rankMatches(hist, pq, 50));
      // Best match band first, and inside it the NEWEST result first.
      if (ranked.length) {
        const top = ranked[0].score;
        const hits = ranked.filter((h) => h.score >= Math.min(top, SCORE_NAME_WORDS)).slice(0, limit);
        return { kind: 'history', hits, note: historyNote(hits[0].row.filing_date) };
      }
    } catch (e: any) {
      historyError = String(e?.message || e || 'history lookup failed');
    }
  }
  return {
    kind: 'none',
    message: notFoundMessage(pq.raw, lookback, reason ?? (historyError ? 'history lookup failed' : null)),
    historyError,
  };
}

// ── URL ────────────────────────────────────────────────────────────────────

export const SEARCH_PARAM = 'q';

export function readSearchParam(search: string | null | undefined): string {
  try { return new URLSearchParams(String(search || '')).get(SEARCH_PARAM) || ''; } catch { return ''; }
}

/**
 * The URL with `?q=` set (or removed when empty), every other parameter and
 * the hash left as they were. Takes and returns a path-relative href.
 */
export function withSearchParam(href: string, q: string): string {
  const u = new URL(href, 'http://x');
  const v = q.trim();
  if (v) u.searchParams.set(SEARCH_PARAM, v); else u.searchParams.delete(SEARCH_PARAM);
  const qs = u.searchParams.toString();
  return u.pathname + (qs ? '?' + qs : '') + u.hash;
}
