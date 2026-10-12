// zzz986 — every listed US + India company as [ticker, name, market, exchange, cap $M] for the chart page's symbol search.
// Source: the stock-screener snapshots in Postgres (USA = Nasdaq's full list, India = NSE EQUITY_L), only the four fields pulled
// out in SQL so the 2 MB+ snapshot rows never leave the database. Fallbacks when a snapshot is missing: India = the NSE symbol
// master kept in KV (lib/symbolMaster), USA = Nasdaq's list read live. Public listing data only. Kept in memory for 6 hours.
import { NextResponse } from 'next/server';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { loadCatalog } from '@/lib/symbolMaster';
import { nasdaqList } from '@/lib/screener/us-build';
import { croreToUsdM, toTuple, type SymbolItem, type SymbolMarket } from '@/lib/symbol-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MS = 6 * 3600_000;
let mem: { at: number; body: string } | null = null;
let pending: Promise<string> | null = null;

async function fromSnapshots(): Promise<Map<SymbolMarket, SymbolItem[]>> {
  const out = new Map<SymbolMarket, SymbolItem[]>();
  if (!getPool() || !(await ensureSchema())) return out;
  const rows = await dbQuery<{ market: string; t: string; n: string | null; x: string | null; mc: string | null }>(
    `SELECT s.market, e->>'t' AS t, e->>'n' AS n, e->'exch'->>0 AS x, e->>'mc' AS mc
       FROM screener_snapshot s, jsonb_array_elements(s.rows) e`).catch(() => []);
  for (const r of rows) {
    const m: SymbolMarket = r.market === 'IN' ? 'IN' : 'US';
    if (!r.t) continue;
    const mc = r.mc != null ? Number(r.mc) : NaN;
    const c = Number.isFinite(mc) && mc > 0 ? Math.round(m === 'IN' ? croreToUsdM(mc) : mc) : undefined;
    const list = out.get(m) || [];
    list.push({ t: r.t, n: (r.n || r.t).slice(0, 90), m, x: r.x || (m === 'IN' ? 'NSE' : undefined), c });
    out.set(m, list);
  }
  return out;
}

async function build(): Promise<string> {
  const notes: string[] = [];
  const by = await fromSnapshots();
  if (!by.get('IN')?.length) {
    const cat = await loadCatalog().catch(() => null);
    if (cat?.entries) by.set('IN', Object.values(cat.entries).map((e) => ({ t: e.symbol, n: e.companyName || e.symbol, m: 'IN' as const, x: 'NSE' })));
    notes.push(by.get('IN')?.length ? 'India from the NSE symbol master (no screener snapshot yet)' : 'India list not available');
  }
  if (!by.get('US')?.length) {
    const rows = await nasdaqList(notes).catch(() => []);
    by.set('US', rows.map((r) => ({ t: r.t, n: r.n, m: 'US' as const, x: r.ex, c: r.mc != null && r.mc > 0 ? Math.round(r.mc) : undefined })));
  }
  const list = [...(by.get('US') || []), ...(by.get('IN') || [])];
  return JSON.stringify({ ok: true, builtAt: new Date().toISOString(), count: list.length, notes, symbols: list.map(toTuple) });
}

export async function GET() {
  if (mem && Date.now() - mem.at < TTL_MS) {
    return new NextResponse(mem.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' } });
  }
  try {
    pending = pending || build();
    const body = await pending;
    // keep an empty / partial result only briefly so a later request retries
    const n = (JSON.parse(body) as { count: number }).count;
    mem = { at: n > 1000 ? Date.now() : Date.now() - TTL_MS + 5 * 60_000, body };
    return new NextResponse(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': n > 1000 ? 'private, max-age=3600' : 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed', symbols: [] }, { status: 500 });
  } finally {
    pending = null;
  }
}
