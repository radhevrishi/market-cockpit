// ═══════════════════════════════════════════════════════════════════════════
// WHOSE NAME IS THIS? — PORTFOLIO, BENCH, OR NEITHER.               (zzz704)
//
// The Transformation Radar ranks whatever the concall feed happened to carry,
// and already marks the handful that are also on the Conviction Bench. What
// it could not answer is the question the owner actually asks first: is this
// something I OWN? A radar entry on a name in the book is a different object
// from a radar entry on a name he has never held — the first is a reason to
// re-read a thesis, the second is a reason to open one.
//
// The holdings live in localStorage under `mc_portfolio_holdings`, written by
// the Portfolio page. This module is the one place that key is read from
// outside that page, so a rename has one place to go rather than four.
//
// SYMBOLS ARE COMPARED LOOSELY AND DELIBERATELY. The book stores what the
// owner typed; the concall feed carries the exchange symbol; the bench
// carries whatever the grader produced. "RELIANCE", "reliance" and
// "RELIANCE.NS" are the same company and must match, while nothing here
// merges two different companies — the normalisation only strips case,
// whitespace and a trailing exchange suffix.
// ═══════════════════════════════════════════════════════════════════════════

const HOLDINGS_KEY = 'mc_portfolio_holdings';

/** Upper-cased, exchange-suffix-stripped. Never merges distinct tickers. */
export function normSymbol(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|BSE|NSE)$/i, '');
}

/**
 * The symbols currently in the book. Empty on the server and whenever the
 * store is unreadable — a blocked localStorage is a normal state, not an
 * error, and an empty set simply means nothing is marked as owned.
 */
export function readPortfolioSymbols(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HOLDINGS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.map((h: any) => normSymbol(h?.symbol)).filter((s: string) => s.length > 0),
    );
  } catch {
    return new Set();
  }
}

export type SymbolSource = 'portfolio' | 'bench' | 'other';

/** Portfolio wins over bench: a name can be both, and "I own it" is the more
 *  consequential fact of the two. */
export function classifySource(
  symbol: unknown,
  owned: Set<string>,
  benchKeys: Set<string>,
): SymbolSource {
  const s = normSymbol(symbol);
  if (!s) return 'other';
  if (owned.has(s)) return 'portfolio';
  if (benchKeys.has(s)) return 'bench';
  return 'other';
}

export const SOURCE_META: Record<SymbolSource, { label: string; icon: string; color: string }> = {
  portfolio: { label: 'In my book', icon: '📗', color: '#34D399' },
  bench:     { label: 'On the bench', icon: '🏆', color: '#FCD34D' },
  other:     { label: 'Not held', icon: '·', color: '#64748B' },
};
