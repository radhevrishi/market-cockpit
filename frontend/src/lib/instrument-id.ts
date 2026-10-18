// zzz1076 (B01) — one instrument identity for a watchlist symbol: market + exchange + symbol.
//
// The standalone /watchlists list stores plain text ("HAL", "NSE:HAL", "532067", "US:HAL"). The chart lists store
// { m, x, t }. "HAL" on NSE (Hindustan Aeronautics) and "HAL" on NYSE (Halliburton) are different companies, so a bare
// symbol carries NO market: it is resolved from the quote it was priced with, or by the user writing the prefix.
// Nothing here guesses India for an unknown market.
import { IN_TICKER_RE, US_TICKER_RE, type Market } from './chart-math';

export interface Instrument { m: Market | null; x?: string; t: string }

const IN_PREFIX = /^(NSE|BSE|BOM):/;
const US_PREFIX = /^(NYSE|NASDAQ|AMEX|ARCA|US):/;

/** Read a standalone-list symbol. Prefix NSE/BSE/BOM → India; NYSE/NASDAQ/AMEX/ARCA/US → USA; a 6-digit code → BSE.
 *  A bare symbol → market null (unknown). `.NS` / `.BO` suffixes → India. */
export function parseListSymbol(raw: string): Instrument {
  let s = String(raw || '').trim().toUpperCase();
  let m: Market | null = null; let x: string | undefined;
  const ip = s.match(IN_PREFIX);
  const up = s.match(US_PREFIX);
  if (ip) { m = 'IN'; x = ip[1] === 'NSE' ? 'NSE' : 'BSE'; s = s.slice(ip[0].length); }
  else if (up) { m = 'US'; x = up[1] === 'US' ? undefined : up[1]; s = s.slice(up[0].length); }
  else if (/\.(NS|BO)$/.test(s)) { m = 'IN'; x = s.endsWith('.BO') ? 'BSE' : 'NSE'; s = s.replace(/\.(NS|BO)$/, ''); }
  if (/^\d{6}$/.test(s)) { m = 'IN'; x = 'BSE'; }
  return { m, ...(x ? { x } : {}), t: s };
}

/** The text a standalone list keeps for an instrument: India NSE → "HAL"; India BSE code → "532067"; USA → "US:HAL"
 *  (the prefix keeps the market — "HAL" alone would read as India everywhere else on the site). India BSE letter
 *  symbols cannot be kept (the list has no exchange field) → null. */
export function listSymbolOf(i: { m: Market; x?: string; t: string }): string | null {
  if (i.m === 'US') return `US:${i.t}`;
  if (i.x === 'BSE' && !/^\d{6}$/.test(i.t)) return null;
  return i.t;
}

/** A key that keeps markets apart: "IN:HAL", "US:HAL", "IN:BSE:RELIANCE" (BSE letter listing ≠ NSE listing). */
export function instrumentKey(m: Market, x: string | undefined, t: string): string {
  return m === 'IN' && x === 'BSE' && !/^\d{6}$/.test(t) ? `IN:BSE:${t}` : `${m}:${t}`;
}

export const validFor = (m: Market, t: string) => (m === 'IN' ? IN_TICKER_RE : US_TICKER_RE).test(t);

/** Pick the quote for a standalone-list symbol from quotes of both markets. A prefixed symbol only takes its own
 *  market's quote. A bare symbol quoted in BOTH markets is ambiguous: the India quote is shown (as before — this list is
 *  mostly NSE names) and `ambiguous` says the market is not certain. */
export function resolveListQuote<Q extends { ticker: string; market?: Market }>(raw: string, quotes: readonly Q[], norm: (s: string) => string): { quote: Q | undefined; market: Market | undefined; ambiguous: boolean } {
  const inst = parseListSymbol(raw);
  const t = norm(inst.t);
  const hits = quotes.filter((q) => norm(q.ticker) === t);
  if (inst.m) {
    const q = hits.find((h) => (h.market || 'IN') === inst.m);
    return { quote: q, market: inst.m, ambiguous: false };
  }
  const inQ = hits.find((h) => (h.market || 'IN') === 'IN');
  const usQ = hits.find((h) => h.market === 'US');
  if (inQ && usQ) return { quote: inQ, market: undefined, ambiguous: true };
  const q = inQ || usQ;
  return { quote: q, market: q ? (q.market || 'IN') : undefined, ambiguous: false };
}
