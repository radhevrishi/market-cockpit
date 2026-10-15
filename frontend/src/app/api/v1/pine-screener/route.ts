// zzz983 — the Pine Screener's data: every company (?patterns=1: only those whose chart shows a pattern), with the few fields the page needs.
// Same stored snapshot as /api/v1/stock-screener (built once a day per market; patterns are read from the same daily bars in
// the build — lib/screener/pine.ts). No extra reads of any outside source. Kept in memory for 5 minutes.
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSnapshot } from '@/lib/screener/snapshot-cache';
import { MemoLru, etagOfText, sendText } from '@/lib/server-memo';
import { serverTiming } from '@/lib/server-timing';
import { leanRows, rowGeometry, scanCoverage, PATTERN_SCAN_VERSION } from '@/lib/screener/pine';
import type { ScreenRow } from '@/lib/screener/types';
import { kickBuild, isBuilding } from '@/lib/screener/run';
import { getResultPayload } from '@/lib/screener/latest-result-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// zzz1053 — the list body per (market, bias, patterns-only) is made once per snapshot (+ build state) and sent pre-compressed with an
// ETag; the snapshot itself comes from the ONE shared cache (lib/screener/snapshot-cache.ts) instead of a private copy per route.
const bodies = new MemoLru<{ text: string; etag: string }>({ maxEntries: 24, maxBytes: 64 * 1024 * 1024, sizeOf: (b) => b.text.length });
/** the parsed snapshot rows per market, from the shared cache (null = none built / no database) */
async function snapOf(market: 'US' | 'IN'): Promise<{ builtAt: string; rows: ScreenRow[] } | null> {
  const s = await getSnapshot(market);
  return s ? { builtAt: s.builtAt, rows: s.rows } : null;
}
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const market = sp.get('market') === 'IN' ? 'IN' : 'US';
  // zzz1008 — ?detail=<TICKER>: one company's pattern tags WITH their auditable geometry (turning points + rule evidence). The list
  // payload carries the tags without it (leanRows strips pts / ev) so it stays small.
  const detail = (sp.get('detail') || '').trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
  if (detail) {
    if (!/^[A-Z0-9&.\-]{1,24}$/.test(detail)) return NextResponse.json({ ok: false, error: 'bad ticker' }, { status: 400 });
    if (!getPool()) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
    const snap = await snapOf(market);
    if (!snap) return NextResponse.json({ ok: false, error: 'not built yet' }, { status: 404 });
    const row = snap.rows.find((r) => String(r.t).toUpperCase() === detail);
    if (!row) return NextResponse.json({ ok: false, error: 'not in this market\'s data' }, { status: 404 });
    return NextResponse.json({ ok: true, market, t: row.t, builtAt: snap.builtAt, geometry: rowGeometry(row) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  }
  // zzz1032 — ?results=1: each company's latest earnings result (Earnings Opportunities graded days of the last ~100 days + the
  // Conviction Beats bench), keyed by this market's tickers. A separate small request the page makes once; built at most every
  // 30 minutes (lib/screener/latest-result-server.ts), never on the list request itself.
  if (sp.get('results') === '1') {
    const universe = async () => {
      const snap = await snapOf(market);
      if (!snap) return null;
      return snap.rows.length ? snap.rows.map((r) => ({ t: r.t, n: r.n })) : null;
    };
    try {
      const p = await getResultPayload(market, universe);
      return NextResponse.json({ ok: true, ...p }, { headers: { 'Cache-Control': 'private, max-age=300' } });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: `latest results could not be read: ${String(e?.message || e).slice(0, 160)}` }, { status: 503 });
    }
  }
  const b = sp.get('bias');
  const bias = b === 'bullish' || b === 'U' ? 'U' : b === 'bearish' || b === 'D' ? 'D' : null;
  const patternsOnly = sp.get('patterns') === '1';   // zzz984: default = every company (rules-only screens need them all)
  const key = `${market}|${bias || ''}|${patternsOnly ? 1 : 0}`;
  const t = serverTiming();
  if (!getPool()) return NextResponse.json({ ok: false, error: 'database not available' }, { status: 503 });
  const found = await t.time('snapshot', () => snapOf(market));
  if (!found) {
    kickBuild(market);
    return NextResponse.json({ ok: true, market, builtAt: null, rows: [], total: 0, scanned: 0, withPattern: 0, patAt: null, insufficient: 0, invalid: 0, errors: 0, stale: 0, pxConflicts: 0, scannedW: 0, scannedM: 0, withPatternW: 0, withPatternM: 0, scanV: PATTERN_SCAN_VERSION, coverage: { D: scanCoverage([], 'D'), W: scanCoverage([], 'W'), M: scanCoverage([], 'M') }, building: isBuilding(market), notes: ['This market has not been built yet — the first build has started; the page fills itself in when it finishes (about 10–15 minutes).'] });
  }
  const all = found.rows;
  // the made body is reused while the snapshot and the build state are the same (a build start / finish makes a new one)
  const bodyKey = `${key}|${found.builtAt}|${isBuilding(market) ? 'b' : ''}`;
  const made = bodies.get(bodyKey);
  // at most 5 minutes old, so a behind-snapshot check (kickBuild below, itself limited to once per 30 minutes) still runs
  if (made && Date.now() - made.at < 5 * 60_000) {
    t.note('memo', 'hit');
    return sendText(req, { text: made.value.text, contentType: 'application/json', cacheControl: 'private, max-age=300', etag: made.value.etag, compressKey: `pine|${made.value.etag}`, timing: t });
  }
  const lean = leanRows(all, bias, patternsOnly);
  // zzz989 — a snapshot from before the newest figures (patterns / TradingView-script fields) starts a build now, instead of
  // waiting for the next scheduled one; at most once every 30 minutes (kickBuild), and it joins a running build.
  const builtMs = Date.parse(String(found.builtAt));
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
  const body = JSON.stringify({ ok: true, market, builtAt: found.builtAt, ...lean, building, notes });
  // keyed by the build state AFTER this request's kickBuild, so the next request finds it
  const finalKey = `${key}|${found.builtAt}|${building ? 'b' : ''}`;
  const etag = etagOfText(body);
  bodies.set(finalKey, { text: body, etag });
  return sendText(req, { text: body, contentType: 'application/json', cacheControl: 'private, max-age=300', etag, compressKey: `pine|${etag}`, timing: t });
}
