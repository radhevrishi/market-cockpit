// PATCH 0400 — Cron-triggered daily snapshot of Concall Intel Top-30.
// Schedule (vercel.json): "30 14 * * 1-5" = 14:30 UTC = 20:00 IST Mon-Fri,
// after market close + post-call digest window.

import { NextRequest, NextResponse } from 'next/server';
import { railwaySelfFetch } from '@/lib/railway-self-fetch'; // PATCH 0985

// PATCH 0452 P0-7 — Require CRON_SECRET env; no hardcoded fallback.
const SECRET = process.env.CRON_SECRET || '';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET env not configured on server' }, { status: 503 });
  }
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const r = await railwaySelfFetch(`${origin}/api/v1/concall-intel/movers?secret=${SECRET}`, {
    method: 'POST',
    cache: 'no-store',
  });
  if (!r.ok) return NextResponse.json({ error: `snapshot HTTP ${r.status}` }, { status: 502 });
  const j = await r.json();
  return NextResponse.json({ ok: true, snapshot_date: j.snapshot?.date, top_count: j.snapshot?.top?.length, ts: new Date().toISOString() });
}
