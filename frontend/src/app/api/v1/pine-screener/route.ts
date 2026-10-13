// zzz983 — the Pine Screener's data: every company (?patterns=1: only those whose chart shows a pattern), with the few fields the page needs.
// Same stored snapshot as /api/v1/stock-screener (built once a day per market; patterns are read from the same daily bars in
// the build — lib/screener/pine.ts). No extra reads of any outside source. Kept in memory for 5 minutes.
import { NextResponse } from 'next/server';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { leanRows, rowGeometry, scanCoverage, PATTERN_SCAN_VERSION } from '@/lib/screener/pine';
import type { ScreenRow } from '@/lib/screener/types';
import { kickBuild, isBuilding } from '@/lib/screener/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mem = new Map<string, { at: number; body: string }>();
/** zzz1008 — the parsed snapshot per market (the row detail's geometry is read from it without another database read) */
const snapMem = new Map<string, { at: number; builtAt: string; rows: ScreenRow[] }>();
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const market = sp.get('market') === 'IN' ? 'IN' : 'US';
  // zzz1008 — ?detail=<TICKER>: one company's pattern tags WITH their auditable geometry (turning points + rule evidence). The list
  // payload carries the tags without it (leanRows strips pts / ev) so it stays small.
  const detail = (sp.get('detail') || '').trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
  if (detail) {
    if (!/^[A-Z0-9&.\-]{1,24}$/.test(detail)) return NextResponse.json({ ok: false, error: 'bad ticker' }, { status: 400 });
    let snap = snapMem.get(market);
    if (!snap || Date.now() - snap.at > 5 * 60_000) {
      if (!getPool() || !(await ensureSchema())) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
      const f = await dbQuery<{ built_at: string; rows: unknown }>(`SELECT built_at, rows FROM screener_snapshot WHERE market = $1`, [market]).catch(() => []);
      if (!f.length) return NextResponse.json({ ok: false, error: 'not built yet' }, { status: 404 });
      let rr: unknown = f[0].rows;
      if (typeof rr === 'string') { try { rr = JSON.parse(rr); } catch { rr = []; } }
      snap = { at: Date.now(), builtAt: String(f[0].built_at), rows: Array.isArray(rr) ? (rr as ScreenRow[]) : [] };
      snapMem.set(market, snap);
    }
    const row = snap.rows.find((r) => String(r.t).toUpperCase() === detail);
    if (!row) return NextResponse.json({ ok: false, error: 'not in this market\'s data' }, { status: 404 });
    return NextResponse.json({ ok: true, market, t: row.t, builtAt: snap.builtAt, geometry: rowGeometry(row) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  }
  const b = sp.get('bias');
  const bias = b === 'bullish' || b === 'U' ? 'U' : b === 'bearish' || b === 'D' ? 'D' : null;
  const patternsOnly = sp.get('patterns') === '1';   // zzz984: default = every company (rules-only screens need them all)
  const key = `${market}|${bias || ''}|${patternsOnly ? 1 : 0}`;
  const hit = mem.get(key);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' };
  if (hit && Date.now() - hit.at < (isBuilding(market) ? 60_000 : 5 * 60_000)) return new NextResponse(hit.body, { headers });
  if (!getPool() || !(await ensureSchema())) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
  const found = await dbQuery<{ built_at: string; rows: unknown }>(`SELECT built_at, rows FROM screener_snapshot WHERE market = $1`, [market]).catch(() => []);
  if (!found.length) {
    kickBuild(market);
    return NextResponse.json({ ok: true, market, builtAt: null, rows: [], total: 0, scanned: 0, withPattern: 0, patAt: null, insufficient: 0, invalid: 0, errors: 0, stale: 0, pxConflicts: 0, scannedW: 0, scannedM: 0, withPatternW: 0, withPatternM: 0, scanV: PATTERN_SCAN_VERSION, coverage: { D: scanCoverage([], 'D'), W: scanCoverage([], 'W'), M: scanCoverage([], 'M') }, building: isBuilding(market), notes: ['This market has not been built yet — the first build has started; the page fills itself in when it finishes (about 10–15 minutes).'] });
  }
  let rows: unknown = found[0].rows;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  const all = Array.isArray(rows) ? (rows as ScreenRow[]) : [];
  snapMem.set(market, { at: Date.now(), builtAt: String(found[0].built_at), rows: all });
  const lean = leanRows(all, bias, patternsOnly);
  // zzz989 — a snapshot from before the newest figures (patterns / TradingView-script fields) starts a build now, instead of
  // waiting for the next scheduled one; at most once every 30 minutes (kickBuild), and it joins a running build.
  const builtMs = Date.parse(String(found[0].built_at));
  // zzz993 (MC-02) — coverage counts genuine readings plus companies whose history is genuinely too short (a re-read cannot help them)
  const covered = lean.scanned + lean.insufficient;
  // zzz1003 — also while many weekly / monthly readings are from the older scan version (the v6 re-read is pending)
  const behind = !lean.scanned || covered < lean.total * 0.8 || !all.some((r) => r.tt != null) || !(builtMs > Date.now() - 30 * 3600_000)
    || lean.coverage.W.stale + lean.coverage.M.stale > lean.total * 0.2;
  if (behind) kickBuild(market);
  const building = isBuilding(market);
  const notes: string[] = lean.scanned ? [] : [building
    ? 'Chart patterns are being read now by a build that just started — the page fills them in when it finishes (about 10–15 minutes). Companies are listed meanwhile.'
    : 'Chart patterns are read during the screener build; the next build of this market adds them. Companies are listed meanwhile.'];
  // zzz1008 (item 5) — timeframe-specific coverage (stale / rebuilding, too little history, provisional, rejected data) is no longer a
  // market-wide note: the page states it for the SELECTED timeframes within the current list, in that timeframe's own units
  // (lean.coverage carries the counts per timeframe). Only market-wide facts stay here.
  if (lean.pxConflicts) notes.push(`${lean.pxConflicts} companies show a latest quote more than 2% from the close the patterns were read from (different price sources) — pattern distances use the scan close; the quote distance is shown apart.`);
  const body = JSON.stringify({ ok: true, market, builtAt: found[0].built_at, ...lean, building, notes });
  mem.set(key, { at: Date.now(), body });
  return new NextResponse(body, { headers });
}
