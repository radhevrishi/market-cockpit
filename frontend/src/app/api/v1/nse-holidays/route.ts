// zzz905 — GET /api/v1/nse-holidays → { years: {'2027': [...]}, updatedAt, source, status }. Public (exchange holidays are
// public data), cached. The browser's market-hours lib primes itself from here so the header "NSE Open/Closed" badge
// knows holidays beyond 2026.
import { NextResponse } from 'next/server';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import { loadNseHolidays } from '@/lib/market-hours';
export const dynamic = 'force-dynamic';
export async function GET() {
  const status = await warmNseHolidays();
  const blob = await loadNseHolidays();
  return NextResponse.json(
    { ok: true, years: blob?.years || {}, updatedAt: blob?.updatedAt || null, source: blob?.source || status.source, status },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
