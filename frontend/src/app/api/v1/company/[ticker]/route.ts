// zzz892 — GET /api/v1/company/<TICKER> → the one shared record for a company (lib/company-record): latest graded result,
// active guidance, archived guidance events, AI document reads and India technicals, each with its source and age.
// Protected (owner login / service key) because it reads the Postgres record of truth.
import { NextRequest, NextResponse } from 'next/server';
import { getCompanyRecord, normTicker } from '@/lib/company-record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  const t = normTicker(decodeURIComponent(ticker || ''));
  if (!/^[A-Z0-9][A-Z0-9&.\-]{0,19}$/.test(t)) return NextResponse.json({ ok: false, error: 'Not a ticker.' }, { status: 400 });
  const rec = await getCompanyRecord(t);
  return NextResponse.json({ ok: true, record: rec }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
