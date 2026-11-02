// Server-authoritative India Conviction Bench — read-only route.
// A storage timeout is UNKNOWN, not an empty investment list. Cache one last
// good response and coalesce requests to avoid 60+ second page loads.
import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { compactIndiaBench } from '@/lib/fundamentals/universe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BENCH_KEY = 'bench:server:v1';
const FRESH_MS = 60_000;
const READ_BUDGET_MS = 4_000;
let lastGood: { payload: any; at: number } | null = null;
let reading: Promise<any> | null = null;

function readBench(): Promise<any> {
  if (lastGood && Date.now() - lastGood.at < FRESH_MS) return Promise.resolve(lastGood.payload);
  if (!reading) {
    reading = kvGet<any>(BENCH_KEY).then((payload) => {
      if (payload && Array.isArray(payload.entries)) lastGood = { payload, at: Date.now() };
      return payload;
    }).finally(() => { reading = null; });
  }
  return reading;
}

export async function GET(req?: Request) {
  let view: string | null = null;
  try { view = req ? new URL(req.url).searchParams.get('view') : null; } catch { view = null; }

  let payload: any = null;
  let failed = false;
  try {
    payload = await Promise.race([
      readBench(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('storage read timed out')), READ_BUDGET_MS)),
    ]);
  } catch {
    failed = true;
  }

  // A failed remote read must never silently replace an established bench
  // with 0 companies. Show the last good data explicitly as stale.
  const stale = !payload && !!lastGood;
  if (stale) payload = lastGood!.payload;
  const headers = { 'Cache-Control': 'no-store', 'x-mc-stale': stale ? '1' : '0' };

  if (!payload) {
    if (failed) return NextResponse.json(
      { ok: false, unavailable: true, entries: null, count: null, updatedAt: null,
        note: 'Bench storage temporarily unavailable; existing holdings are not deleted.' },
      { status: 503, headers: { ...headers, 'Retry-After': '30' } },
    );
    return NextResponse.json({ ok: true, entries: [], count: 0, updatedAt: null, note: 'not built yet' }, { headers });
  }

  if (view === 'tickers') {
    const names = compactIndiaBench(payload.entries);
    return NextResponse.json(
      { ok: true, view: 'tickers', entries: names, count: names.length, updatedAt: payload.updatedAt ?? null, stale },
      { headers },
    );
  }

  return NextResponse.json({ ...payload, stale }, { headers });
}
