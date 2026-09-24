// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/us-book/profile — COMPANY NAME + SEC INDUSTRY + SECTOR.     (zzz793)
//
// For the US Portfolio Book's sector view. Reads the book's tickers (the
// route never returns quantities or cost), looks each US-listed one up at
// the SEC (company list → CIK → SIC industry code) and maps the code to a
// broad sector group. Cached 30 days in KV (`us-book-profile:v1`). Non-US
// lines have no SEC filer and come back as "Unknown (no SEC filer)".
// Protected by the site login through the /api/v1/us-book prefix.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { readUsBook, readUsProfiles, writeUsProfiles, US_BOOK_OWNER } from '@/lib/us-book-store';
import { fetchUsProfiles, profileIsFresh, type UsProfile } from '@/lib/us-book/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const { book, error } = await readUsBook(US_BOOK_OWNER);
  if (error) return NextResponse.json({ ok: false, error }, { status: 503 });
  const cached = await readUsProfiles();
  const usTickers = Array.from(new Set(book.holdings.filter((h) => h.listing === 'US').map((h) => h.ticker)));
  const stale = usTickers.filter((t) => !profileIsFresh(cached[t])).slice(0, 60);
  let merged: Record<string, UsProfile> = { ...cached };
  if (stale.length) {
    const fresh = await fetchUsProfiles(stale);
    merged = { ...cached, ...fresh };
    await writeUsProfiles(merged);
  }
  const profiles: Record<string, UsProfile> = {};
  for (const t of usTickers) if (merged[t]) profiles[t] = merged[t];
  return NextResponse.json({ ok: true, at: new Date().toISOString(), profiles, looked_up: stale.length }, { headers: { 'Cache-Control': 'no-store' } });
}
