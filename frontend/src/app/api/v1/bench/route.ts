// ═══════════════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE CONVICTION BENCH — read route.
//
// Read-only (no secret; mirrors other public-ish read routes). Returns the
// bench blob written by /api/v1/cron/refresh-bench, or an honest empty payload
// when the cron hasn't run yet.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { compactIndiaBench } from '@/lib/fundamentals/universe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BENCH_KEY = 'bench:server:v1';

// zzz799 — `?view=tickers` returns only ticker / company / tier / filing
// date (no graded cards), so a phone can read the India Conviction Beats list
// cheaply. Without the parameter the route answers exactly as before.
export async function GET(req?: Request) {
  let view: string | null = null;
  try { view = req ? new URL(req.url).searchParams.get('view') : null; } catch { view = null; }
  let payload: any = null;
  try {
    payload = await kvGet(BENCH_KEY);
  } catch {
    payload = null;
  }

  if (!payload) {
    return NextResponse.json({
      ok: true,
      entries: [],
      count: 0,
      updatedAt: null,
      note: 'not built yet',
    });
  }

  if (view === 'tickers') {
    const names = compactIndiaBench(payload?.entries);
    return NextResponse.json({ ok: true, view: 'tickers', entries: names, count: names.length, updatedAt: payload?.updatedAt ?? null },
      { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(payload);
}
