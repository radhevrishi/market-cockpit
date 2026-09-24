// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-book/quotes — LIVE QUOTES FOR THE US BOOK PAGE.          (zzz790)
//
// Book page only (market value and P&L). The catalyst engine never calls
// this route and never imports anything it uses. Reuses the shared Yahoo
// quote helper (lib/yahoo, batch → chart fallback). Frankfurt lines are
// asked for under Yahoo's `.F` suffix; an FX rate (EURUSD) is fetched so a
// USD-equivalent total can be printed — and is not printed without it.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { fetchQuotesWithFallback } from '@/lib/yahoo';
import { readUsBook, US_BOOK_OWNER } from '@/lib/us-book-store';
import { quoteSymbolFor, type UsQuote } from '@/lib/us-book/valuation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const { book, error } = await readUsBook(US_BOOK_OWNER);
  if (error) return NextResponse.json({ ok: false, error }, { status: 503 });
  const symbols = Array.from(new Set(book.holdings.map((h) => quoteSymbolFor(h))));
  const currencies = Array.from(new Set([...book.holdings.map((h) => h.currency), ...Object.keys(book.cash)]))
    .filter((c) => c && c !== 'USD' && c !== 'BASE');
  const fxSymbols = currencies.map((c) => `${c}USD=X`);
  const all = [...symbols, ...fxSymbols];
  let rows: any[] = [];
  try { rows = all.length ? await fetchQuotesWithFallback([...all]) : []; } catch { rows = []; }
  const bySym = new Map<string, any>(rows.filter((r) => r?.symbol).map((r) => [String(r.symbol).toUpperCase(), r]));
  const quotes: Record<string, UsQuote> = {};
  for (const s of symbols) {
    const r = bySym.get(s.toUpperCase());
    const price = typeof r?.regularMarketPrice === 'number' ? r.regularMarketPrice : null;
    quotes[s] = { symbol: s, price, currency: r?.currency ? String(r.currency).toUpperCase() : null, source: price != null ? 'Yahoo Finance' : 'unavailable', asOf: new Date().toISOString() };
  }
  const fx: Record<string, number> = {};
  for (const c of currencies) {
    const r = bySym.get(`${c}USD=X`);
    if (typeof r?.regularMarketPrice === 'number' && r.regularMarketPrice > 0) fx[c] = r.regularMarketPrice;
  }
  return NextResponse.json({
    ok: true, at: new Date().toISOString(), quotes, fx,
    priced: Object.values(quotes).filter((q) => q.price != null).length, requested: symbols.length,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
