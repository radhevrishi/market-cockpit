// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — VALUES AND P&L.                                (zzz790)
//
// THE BOOK PAGE ONLY. Market value and profit/loss against average cost are
// what a book page is for; they are NOT evidence about a thesis, and nothing
// under lib/us-thesis imports this file (a test enforces it). Pure.
//
// Currencies are never mixed silently: totals are per currency, and a USD
// equivalent is printed only when an FX rate was actually fetched.
// ═══════════════════════════════════════════════════════════════════════════

import type { UsHolding, UsBook } from './model';

export interface UsQuote {
  price: number | null; currency: string | null; source: string; symbol: string;
  /** When the PRICE is from (Yahoo regularMarketTime), not when it was fetched. */
  asOf?: string | null;
  marketTime?: string | null;
  /** Previous session close, only when Yahoo states it. */
  prevClose?: number | null;
  name?: string | null;
  exchangeName?: string | null;
  /** Why there is no price, in words. */
  error?: string | null;
}

/** The quote symbol a holding is priced under (Yahoo convention). */
export function quoteSymbolFor(h: Pick<UsHolding, 'ticker' | 'exchange' | 'listing'>): string {
  if (h.listing === 'US') return h.ticker;
  const x = h.exchange;
  if (x === 'FWB' || x === 'FWB2' || x === 'FRA') return `${h.ticker}.F`;
  if (x === 'IBIS' || x === 'IBIS2' || x === 'XETRA') return `${h.ticker}.DE`;
  if (x === 'LSE' || x === 'LSEETF') return `${h.ticker}.L`;
  if (x === 'TSE' || x === 'TSX') return `${h.ticker}.TO`;
  if (x === 'SBF') return `${h.ticker}.PA`;
  if (x === 'AEB') return `${h.ticker}.AS`;
  return h.ticker;
}

export interface HoldingValue {
  ticker: string; exchange: string; currency: string; listing: string;
  quantity: number; avgPrice: number | null;
  price: number | null; priceSource: string | null;
  cost: number | null; marketValue: number | null;
  pnl: number | null; pnlPct: number | null;
  /** Why a figure is blank. */
  note: string | null;
}

export interface BookValuation {
  rows: HoldingValue[];
  /** Per currency: cost, market value, P&L over rows that have both. */
  byCurrency: Record<string, { cost: number; marketValue: number; pnl: number; priced: number; unpriced: number }>;
  /** Cash is reported apart, never added into a holding figure. */
  cash: Record<string, number>;
  /** USD-equivalent total of positions + cash, only with a real FX rate. */
  usdEquivalent: { positions: number; cash: number; total: number; fx: Record<string, number>; missingFx: string[] } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function valueHolding(h: UsHolding, q: UsQuote | null | undefined): HoldingValue {
  const price = q && typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
  const quoteCcy = q?.currency ? String(q.currency).toUpperCase() : null;
  // A quote in another currency than the position (a GBp line, a USD quote
  // for a EUR position) is not used: P&L across currencies would be noise.
  const ccyMismatch = !!price && !!quoteCcy && quoteCcy !== h.currency;
  const p = ccyMismatch ? null : price;
  const cost = h.avgPrice != null ? r2(h.avgPrice * h.quantity) : null;
  const mv = p != null ? r2(p * h.quantity) : null;
  const pnl = mv != null && cost != null ? r2(mv - cost) : null;
  const pnlPct = pnl != null && cost ? Math.round((pnl / Math.abs(cost)) * 10000) / 100 : null;
  const note = ccyMismatch ? `quote is in ${quoteCcy}, position in ${h.currency} — not valued`
    : p == null ? 'no live quote' : h.avgPrice == null ? 'no average cost on file — P&L not computed' : null;
  return { ticker: h.ticker, exchange: h.exchange, currency: h.currency, listing: h.listing, quantity: h.quantity, avgPrice: h.avgPrice, price: p, priceSource: p != null ? (q?.source || null) : null, cost, marketValue: mv, pnl, pnlPct, note };
}

export function valueBook(book: Pick<UsBook, 'holdings' | 'cash'>, quotes: Record<string, UsQuote | null | undefined>, fxToUsd?: Record<string, number> | null): BookValuation {
  const rows = book.holdings.map((h) => valueHolding(h, quotes[quoteSymbolFor(h)] || quotes[h.ticker]));
  const byCurrency: BookValuation['byCurrency'] = {};
  for (const r of rows) {
    const b = byCurrency[r.currency] || (byCurrency[r.currency] = { cost: 0, marketValue: 0, pnl: 0, priced: 0, unpriced: 0 });
    if (r.marketValue != null) { b.marketValue = r2(b.marketValue + r.marketValue); b.priced++; } else b.unpriced++;
    if (r.pnl != null && r.cost != null) { b.cost = r2(b.cost + r.cost); b.pnl = r2(b.pnl + r.pnl); }
  }
  let usdEquivalent: BookValuation['usdEquivalent'] = null;
  if (fxToUsd) {
    const fx: Record<string, number> = { USD: 1, ...fxToUsd };
    const missing = new Set<string>();
    let pos = 0, cash = 0;
    for (const [c, b] of Object.entries(byCurrency)) { if (fx[c]) pos += b.marketValue * fx[c]; else if (b.marketValue) missing.add(c); }
    for (const [c, v] of Object.entries(book.cash)) {
      if (c === 'BASE') continue;                 // IBKR's base total restates the others
      if (fx[c]) cash += v * fx[c]; else missing.add(c);
    }
    usdEquivalent = { positions: r2(pos), cash: r2(cash), total: r2(pos + cash), fx, missingFx: Array.from(missing) };
  }
  return { rows, byCurrency, cash: { ...book.cash }, usdEquivalent };
}

/** "$1,234.5 M" for a USD amount given in units. */
export function fmtUsdMillions(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} M`;
}
