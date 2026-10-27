// zzz938 — the stock screener snapshot for the page: every company with its figures, built once a day (lib/screener/us-build.ts).
// Public market data only.
// zzz1053 — read through the shared snapshot cache (lib/screener/snapshot-cache.ts: one read at a time, re-read only when a newer
// snapshot exists). The JSON text (US ≈ 15 MB) is made ONCE per snapshot and sent pre-compressed (br ≈ 2.8 MB, compressed once,
// not per request) with an ETag, so a revisit with an unchanged snapshot is a 304 that transfers nothing.
import { NextResponse } from 'next/server';
import { ruleOf40Usable } from '@/lib/screener/pine';
import { kickBuild } from '@/lib/screener/run';
import { getPool } from '@/lib/db';
import { getSnapshot, r40GuardedRows } from '@/lib/screener/snapshot-cache';
import { etagFor, sendText } from '@/lib/server-memo';
import { serverTiming } from '@/lib/server-timing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_CONTROL = 'private, max-age=300';
/** the serialized body per market, for the snapshot it was made from */
const bodies = new Map<string, { builtAt: string; body: string }>();
/** zzz1045 — `?tickers=A,B` (≤ 400): only those companies' moving averages (a few KB, for the /watchlists "% from average" columns),
 *  never the whole 6 MB snapshot. */
const SLIM_KEYS = ['t', 'sma50', 'sma200', 'scanPx', 'scanAt', 'de', 'deFY'] as const;   // zzz1068: + debt ÷ equity for the Conviction Beats cards
const SLIM_EXTRA = ['ind', 'sec', 'n'] as const;   // zzz1192: industry / sector / name for Conviction Analytics
function slim(rows: any[] | undefined, builtAt: string | null | undefined, market: string, tickers: string[]) {
  const want = new Set(tickers);
  const out = (rows || []).filter((r) => r && want.has(String(r.t).toUpperCase())).map((r) => Object.fromEntries([...SLIM_KEYS, ...SLIM_EXTRA].filter((k) => r[k] != null).map((k) => [k, r[k]])));
  return NextResponse.json({ ok: true, market, builtAt: builtAt ?? null, rows: out }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
export async function GET(req: Request) {
  const t = serverTiming();
  const sp = new URL(req.url).searchParams;
  const market = sp.get('market') === 'IN' ? 'IN' : 'US';
  const slimTickers = (sp.get('tickers') || '').split(',').map((t) => t.trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '')).filter(Boolean).slice(0, 400);
  const snap = await t.time('snapshot', () => getSnapshot(market));
  if (!snap && !getPool()) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
  if (!snap) {
    // nothing built yet (or no database): start the first build now in the background (it takes several minutes) instead of
    // waiting for the schedule
    const started = kickBuild(market);
    return NextResponse.json({ ok: true, market, builtAt: null, rows: [], building: started, notes: [started ? 'The first build is running now — open this page again in about 10 minutes.' : 'The first build has not finished yet — it runs on a schedule.'], sources: [] });
  }
  // zzz991 — snapshots built before the Rule of 40 guard: blank the tiny-base artefacts here too
  const rows = r40GuardedRows(snap, ruleOf40Usable);
  if (slimTickers.length) return slim(rows as any[], snap.builtAt, market, slimTickers);
  let b = bodies.get(market);
  if (!b || b.builtAt !== snap.builtAt) {
    const body = await t.time('serialize', () => JSON.stringify({ ok: true, market, builtAt: snap.builtAt, rows, notes: snap.meta?.notes || [], sources: snap.meta?.sources || [] }));
    b = { builtAt: snap.builtAt, body };
    bodies.set(market, b);
  }
  return sendText(req, {
    text: b.body, contentType: 'application/json', cacheControl: CACHE_CONTROL,
    etag: etagFor('stock-screener', market, snap.builtAt), compressKey: `stock-screener|${market}|${snap.builtAt}`, timing: t,
  });
}
