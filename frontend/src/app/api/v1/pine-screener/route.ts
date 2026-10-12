// zzz983 — the Pine Screener's data: every company (?patterns=1: only those whose chart shows a pattern), with the few fields the page needs.
// Same stored snapshot as /api/v1/stock-screener (built once a day per market; patterns are read from the same daily bars in
// the build — lib/screener/pine.ts). No extra reads of any outside source. Kept in memory for 5 minutes.
import { NextResponse } from 'next/server';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { leanRows } from '@/lib/screener/pine';
import type { ScreenRow } from '@/lib/screener/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mem = new Map<string, { at: number; body: string }>();
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const market = sp.get('market') === 'IN' ? 'IN' : 'US';
  const b = sp.get('bias');
  const bias = b === 'bullish' || b === 'U' ? 'U' : b === 'bearish' || b === 'D' ? 'D' : null;
  const patternsOnly = sp.get('patterns') === '1';   // zzz984: default = every company (rules-only screens need them all)
  const key = `${market}|${bias || ''}|${patternsOnly ? 1 : 0}`;
  const hit = mem.get(key);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' };
  if (hit && Date.now() - hit.at < 5 * 60_000) return new NextResponse(hit.body, { headers });
  if (!getPool() || !(await ensureSchema())) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
  const found = await dbQuery<{ built_at: string; rows: unknown }>(`SELECT built_at, rows FROM screener_snapshot WHERE market = $1`, [market]).catch(() => []);
  if (!found.length) return NextResponse.json({ ok: true, market, builtAt: null, rows: [], total: 0, scanned: 0, withPattern: 0, patAt: null, notes: ['The stock screener has not built this market yet — open the Stock Screener once to start the first build.'] });
  let rows: unknown = found[0].rows;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  const lean = leanRows(Array.isArray(rows) ? (rows as ScreenRow[]) : [], bias, patternsOnly);
  const notes = lean.scanned ? [] : ['Chart patterns are read during the screener build; the next build of this market adds them (USA: weekdays after the US close; India: the hourly runs).'];
  const body = JSON.stringify({ ok: true, market, builtAt: found[0].built_at, ...lean, notes });
  mem.set(key, { at: Date.now(), body });
  return new NextResponse(body, { headers });
}
