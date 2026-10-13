// zzz983 — the Pine Screener's data: every company (?patterns=1: only those whose chart shows a pattern), with the few fields the page needs.
// Same stored snapshot as /api/v1/stock-screener (built once a day per market; patterns are read from the same daily bars in
// the build — lib/screener/pine.ts). No extra reads of any outside source. Kept in memory for 5 minutes.
import { NextResponse } from 'next/server';
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { leanRows, scanCoverage, PATTERN_SCAN_VERSION, PATTERN_SCAN_DAILY_COMPAT } from '@/lib/screener/pine';
import type { ScreenRow } from '@/lib/screener/types';
import { kickBuild, isBuilding } from '@/lib/screener/run';

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
  if (lean.stale) notes.push(`${lean.stale} companies were read by an older pattern-scan version — their patterns are withheld (not shown as current) until their prices are re-read${building ? ' (a build is running)' : ''}.`);
  // zzz1003 (PS-01) — weekly / monthly readings of an older scan (no close of their own) are withheld until the company is re-read
  { const sw = lean.coverage.W.stale, sm = lean.coverage.M.stale;
    if (sw || sm) notes.push(`${sw} weekly and ${sm} monthly readings come from an older scan (version ${PATTERN_SCAN_DAILY_COMPAT.join('/')} or without their own week / month close) — those patterns are withheld and their analysis close shown as unavailable until the company is re-read with the current scan (version ${PATTERN_SCAN_VERSION})${building ? ' (a build is running)' : ''}. Daily patterns of those companies are shown.`); }
  if (lean.coverage.D.provisional) notes.push(`${lean.coverage.D.provisional} companies' daily patterns were read during a trading session (they include that day's unfinished bar) — marked provisional until re-read.`);
  if (lean.insufficient) notes.push(`${lean.insufficient} companies have too little price history for a pattern scan (fewer than 30 usable sessions) — not counted as scanned.`);
  if (lean.invalid || lean.errors) notes.push(`${lean.invalid + lean.errors} companies could not be scanned (${lean.invalid} price data rejected, ${lean.errors} scan failures) — their price figures are kept.`);
  if (lean.pxConflicts) notes.push(`${lean.pxConflicts} companies show a latest quote more than 2% from the close the patterns were read from (different price sources) — pattern distances use the scan close; the quote distance is shown apart.`);
  const body = JSON.stringify({ ok: true, market, builtAt: found[0].built_at, ...lean, building, notes });
  mem.set(key, { at: Date.now(), body });
  return new NextResponse(body, { headers });
}
