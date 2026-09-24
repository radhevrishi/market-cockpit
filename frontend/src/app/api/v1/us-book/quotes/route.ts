// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-book/quotes — LIVE QUOTES FOR THE US BOOK PAGE.   (zzz790, zzz793)
//
// Book page only (market value and P&L). The catalyst engine never calls
// this route and never imports anything it uses.
//
// zzz793 — reads Yahoo's chart API through lib/us-book/quotes so every quote
// keeps its CURRENCY, its PRICE TIME and the PREVIOUS CLOSE (the shared
// fallback dropped all three: the page could not refuse a wrong-currency
// quote, said "quotes 14:32" for a price that was days old, and had no day
// change). Frankfurt lines are asked for under Yahoo's `.F` suffix. FX comes
// from the same source (EURUSD=X etc.); when it fails the page says
// "FX unavailable" — no rate is ever assumed.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { readUsBook, US_BOOK_OWNER } from '@/lib/us-book-store';
import { quoteSymbolFor } from '@/lib/us-book/valuation';
import { fetchUsBookQuotes } from '@/lib/us-book/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const { book, error } = await readUsBook(US_BOOK_OWNER);
  if (error) return NextResponse.json({ ok: false, error }, { status: 503 });
  const symbols = Array.from(new Set(book.holdings.map((h) => quoteSymbolFor(h))));
  // EUR is always asked for: the broker account's base currency is EUR, so
  // the page can show the book in euros too — labelled, never guessed.
  const currencies = Array.from(new Set(['EUR', ...book.holdings.map((h) => h.currency), ...Object.keys(book.cash)]))
    .filter((c) => /^[A-Z]{3}$/.test(c) && c !== 'USD');
  const fxSymbols = currencies.map((c) => `${c}USD=X`);
  const got = await fetchUsBookQuotes([...symbols, ...fxSymbols]);

  const quotes: Record<string, any> = {};
  for (const s of symbols) quotes[s] = got[s];

  const fx: Record<string, number> = {};
  const fxDetail: Record<string, { rate: number | null; at: string | null; source: string; symbol: string; error: string | null }> = {};
  for (const c of currencies) {
    const q = got[`${c}USD=X`];
    const rate = q && q.price != null && (q.currency == null || q.currency === 'USD') ? q.price : null;
    if (rate != null) fx[c] = rate;
    fxDetail[c] = { rate, at: q?.marketTime ?? null, source: 'Yahoo Finance', symbol: `${c}USD=X`, error: rate != null ? null : (q?.error || 'no rate returned') };
  }
  return NextResponse.json({
    ok: true, at: new Date().toISOString(), quotes, fx, fxDetail,
    priced: Object.values(quotes).filter((q: any) => q?.price != null).length, requested: symbols.length,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
