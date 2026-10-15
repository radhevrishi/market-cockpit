// zzz938 — the stock screener snapshot for the page: every company with its figures, built once a day (lib/screener/us-build.ts).
// Public market data only. Kept in memory for 5 minutes so page loads do not each read 2 MB from Postgres.
import { NextResponse } from 'next/server';
import { ruleOf40Usable } from '@/lib/screener/pine';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { kickBuild } from '@/lib/screener/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mem = new Map<string, { at: number; body: string; rows?: any[]; builtAt?: string | null }>();
/** zzz1045 — `?tickers=A,B` (≤ 400): only those companies' moving averages (a few KB, for the /watchlists "% from average" columns),
 *  never the whole 6 MB snapshot. */
const SLIM_KEYS = ['t', 'sma50', 'sma200', 'scanPx', 'scanAt'] as const;
function slim(rows: any[] | undefined, builtAt: string | null | undefined, market: string, tickers: string[]) {
  const want = new Set(tickers);
  const out = (rows || []).filter((r) => r && want.has(String(r.t).toUpperCase())).map((r) => Object.fromEntries(SLIM_KEYS.filter((k) => r[k] != null).map((k) => [k, r[k]])));
  return NextResponse.json({ ok: true, market, builtAt: builtAt ?? null, rows: out }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const market = sp.get('market') === 'IN' ? 'IN' : 'US';
  const slimTickers = (sp.get('tickers') || '').split(',').map((t) => t.trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '')).filter(Boolean).slice(0, 400);
  const hit = mem.get(market);
  if (hit && Date.now() - hit.at < 5 * 60_000) {
    if (slimTickers.length) return slim(hit.rows, hit.builtAt, market, slimTickers);
    return new NextResponse(hit.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' } });
  }
  if (!getPool() || !(await ensureSchema())) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
  const rows = await dbQuery<{ built_at: string; rows: unknown; meta: any }>(`SELECT built_at, rows, meta FROM screener_snapshot WHERE market = $1`, [market]).catch(() => []);
  if (!rows.length) {
    // nothing built yet: start the first build now in the background (it takes several minutes) instead of waiting for the schedule
    const started = kickBuild(market);
    return NextResponse.json({ ok: true, market, builtAt: null, rows: [], building: started, notes: [started ? 'The first build is running now — open this page again in about 10 minutes.' : 'The first build has not finished yet — it runs on a schedule.'], sources: [] });
  }
  const r = rows[0];
  // zzz991 — snapshots built before the Rule of 40 guard: blank the tiny-base artefacts here too
  let outRows: unknown = r.rows;
  if (typeof outRows === 'string') { try { outRows = JSON.parse(outRows); } catch { /* served as stored */ } }
  if (Array.isArray(outRows)) for (const row of outRows as any[]) if (row && row.r40 != null && !ruleOf40Usable(row.revQYoY, row.fcfmTTM)) row.r40 = null;
  const body = JSON.stringify({ ok: true, market, builtAt: r.built_at, rows: outRows, notes: r.meta?.notes || [], sources: r.meta?.sources || [] });
  mem.set(market, { at: Date.now(), body, rows: Array.isArray(outRows) ? outRows as any[] : [], builtAt: r.built_at });
  if (slimTickers.length) return slim(Array.isArray(outRows) ? outRows as any[] : [], r.built_at, market, slimTickers);
  return new NextResponse(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' } });
}
