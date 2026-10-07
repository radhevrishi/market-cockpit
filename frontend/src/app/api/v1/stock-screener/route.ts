// zzz938 — the stock screener snapshot for the page: every company with its figures, built once a day (lib/screener/us-build.ts).
// Public market data only. Kept in memory for 5 minutes so page loads do not each read 2 MB from Postgres.
import { NextResponse } from 'next/server';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mem = new Map<string, { at: number; body: string }>();
export async function GET(req: Request) {
  const market = new URL(req.url).searchParams.get('market') === 'IN' ? 'IN' : 'US';
  const hit = mem.get(market);
  if (hit && Date.now() - hit.at < 5 * 60_000) return new NextResponse(hit.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' } });
  if (!getPool() || !(await ensureSchema())) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
  const rows = await dbQuery<{ built_at: string; rows: unknown; meta: any }>(`SELECT built_at, rows, meta FROM screener_snapshot WHERE market = $1`, [market]).catch(() => []);
  if (!rows.length) return NextResponse.json({ ok: true, market, builtAt: null, rows: [], notes: ['The first build has not run yet — it runs once a day.'], sources: [] });
  const r = rows[0];
  const body = JSON.stringify({ ok: true, market, builtAt: r.built_at, rows: r.rows, notes: r.meta?.notes || [], sources: r.meta?.sources || [] });
  mem.set(market, { at: Date.now(), body });
  return new NextResponse(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' } });
}
