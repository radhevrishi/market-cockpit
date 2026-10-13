// zzz1003 — Pine Screener provenance (retest 13 Oct 2026: PS-01 / PS-03 / PS-07, data side; PS-02 helpers).
//  PS-01: scan version 6; a weekly / monthly reading must carry its own close (`px`) and date (`asOf`) — otherwise it is withheld as
//         'stale-version' and tagScanClose returns px null, NEVER the daily close. v5 entries keep their DAILY reading during the
//         changeover (PATTERN_SCAN_DAILY_COMPAT) but their W / M readings wait for the re-read.
//  PS-03: the daily scan reads COMPLETED sessions; today's unfinished bar is read apart as a provisional scan (patLive / scanLive).
//  PS-07: the build downloads ~10 years; the monthly scan reads up to 120 months, everything else the last ~5 years (unchanged).
//  PS-02: analysisContext() / scanCoverage() label a tag by its own timeframe's close / date / session / status / version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSessionBar, recentBars, TECH_FIGURE_DAYS, type DailyBars } from '../screener/tech';
import {
  techEntry, rowPatternFields, leanRows, tagScanClose, analysisContext, scanCoverage, normalizeRowScans, periodScanUsable, monthlyHistory,
  monthlyNeedText, PATTERN_SCAN_VERSION, PATTERN_SCAN_DAILY_COMPAT, MONTHLY_HISTORY_REQ, MONTHLY_CONTEXT_BARS, type ScreenPatternTag,
} from '../screener/pine';
import { HISTORY_DAYS, type TechStored } from '../screener/tech-fetch';
import type { ScreenRow } from '../screener/types';

const V = PATTERN_SCAN_VERSION;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Business-day bars ending on `end` (inclusive), oldest first: a deterministic wave with drift and noise. */
function bizSeries(end: string, n: number, spikeLast = 0): DailyBars {
  const days: string[] = [];
  let t = Date.parse(`${end}T00:00:00Z`);
  while (days.length < n) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(new Date(t).toISOString().slice(0, 10)); t -= 86_400_000; }
  days.reverse();
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let seed = 11, prev = 50;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n; i++) {
    let c = 50 + 12 * Math.sin(i / 37) + 6 * Math.sin(i / 160) + i * 0.01 + (rnd() - 0.5) * 0.8;
    if (i === n - 1 && spikeLast) c = prev * (1 + spikeLast);
    const o = prev;
    b.d.push(days[i]); b.o.push(o); b.c.push(c); b.h.push(Math.max(o, c) * 1.006); b.l.push(Math.min(o, c) * 0.994); b.v.push(1e6 * (0.8 + 0.4 * rnd()));
    prev = c;
  }
  return b;
}

test('zzz1003 version: bumped to 6; v5 is the daily-compatible version', () => {
  assert.ok(V >= 6);   // zzz1005 bumped it to 7 (chart-pattern precision audit)
  assert.deepEqual([...PATTERN_SCAN_DAILY_COMPAT], [5]);
  assert.equal(HISTORY_DAYS, 10 * 365 + 25);
  assert.equal(TECH_FIGURE_DAYS, 5 * 365 + 25);
});

// ───────── PS-01: v5 compat + mandatory W / M metadata ─────────
test('zzz1003 PS-01: a v5 entry keeps its daily tags; its weekly / monthly readings are withheld until re-read', () => {
  const dTag: ScreenPatternTag = { id: 'double_bottom', b: 'U', s: 'b', c: 80, p: 33.1, d: 4.4, l: 60 };
  const wTag: ScreenPatternTag = { id: 'double_bottom', b: 'U', s: 'b', c: 100, p: 33.1, d: 1.9, tf: 'W', l: 13, lu: 'w' };
  const v5: TechStored = {
    d: '2026-10-13', close: 34.57, ipoD: null, patV: 5, patAt: '2026-10-13', pat: [dTag], scan: { st: 'ready', v: 5, n: 700, asOf: '2026-10-13' },
    patW: [wTag], scanW: { st: 'ready', v: 5, tf: 'W', asOf: '2026-10-09' },        // v5: no px
    patM: [], scanM: { st: 'no-pattern', v: 5, tf: 'M', asOf: '2026-09-30' },
    scanPx: 34.57, scanAt: '2026-10-13',
  } as unknown as TechStored;
  const f = rowPatternFields(v5);
  assert.deepEqual(f.pat, [dTag], 'daily tags of v5 stay visible');
  assert.equal(f.patAt, '2026-10-13');
  assert.equal(f.scan!.v, 5); assert.equal(f.scan!.st, 'ready'); assert.equal(f.scan!.session, 'completed', 'no cc: read after the close');
  assert.equal(f.patW, undefined); assert.equal(f.patM, undefined);
  assert.equal(f.scanW!.st, 'stale-version'); assert.equal(f.scanW!.asOf, '2026-10-09'); assert.equal(f.scanW!.px, undefined);
  assert.equal(f.scanM!.st, 'stale-version');
  // read during a session (cc present): the v5 daily reading included the live bar → provisional
  assert.equal(rowPatternFields({ ...v5, cc: { px: 34 } } as TechStored).scan!.session, 'provisional');
  // even a v5 W reading WITH px is not certified (older scan quality metadata)
  assert.equal(rowPatternFields({ ...v5, scanW: { ...v5.scanW!, px: 33.74 } } as TechStored).scanW!.st, 'stale-version');
  // v4 and older: stale everywhere, as before
  const v4 = rowPatternFields({ ...v5, patV: 4 } as TechStored);
  assert.deepEqual(Object.keys(v4), ['scan']); assert.equal(v4.scan!.st, 'stale-version');

  // a stored snapshot row from a v5 build (rowPatternFields of the old code kept scanW ready without px)
  const snap = { t: 'GTECJAINX', n: 'GTECJAINX', px: 34.57, scanPx: 34.57, scanAt: '2026-10-13', pat: [dTag], patAt: '2026-10-13', scan: { st: 'ready', v: 5 }, patW: [wTag], scanW: { st: 'ready', v: 5, tf: 'W', asOf: '2026-10-09' } } as ScreenRow;
  const l = leanRows([snap]);
  const lr = l.rows[0];
  assert.deepEqual(lr.pat!.map((t) => t.id), ['double_bottom']);
  assert.equal(lr.patW, undefined, 'v5 weekly tags withheld');
  assert.equal(lr.scanW!.st, 'stale-version');
  assert.equal(l.scanned, 1); assert.equal(l.stale, 0, 'the daily reading is not stale');
  assert.equal(l.coverage.W.stale, 1); assert.equal(l.coverage.D.ready, 1);
  assert.equal(l.withPatternW, 0);
  // the weekly close is unavailable — never the daily 34.57
  assert.deepEqual(tagScanClose(snap, wTag), { px: null, at: '2026-10-09', tf: 'W' });
  assert.deepEqual(tagScanClose(lr, wTag), { px: null, at: '2026-10-09', tf: 'W' });
  assert.equal(leanRows([snap], null, true).rows.length, 1, 'still listed by its daily pattern');
});

test('zzz1003 PS-01: no daily fallback under a W / M date (PPIH: daily 30.62 on 13 Oct, monthly reading of 30 Sep)', () => {
  const tag: ScreenPatternTag = { id: 'double_top', b: 'D', s: 'b', c: 70, p: 36.72, d: -16.2, tf: 'M', l: 14, lu: 'm' };
  const noPx = { scanPx: 30.62, scanAt: '2026-10-13', scanM: { st: 'ready' as const, v: V, tf: 'M' as const, asOf: '2026-09-30' } };
  assert.deepEqual(tagScanClose(noPx, tag), { px: null, at: '2026-09-30', tf: 'M' });
  assert.equal(periodScanUsable(noPx.scanM), false);
  const ctx0 = analysisContext(noPx, tag);
  assert.equal(ctx0.close, null); assert.equal(ctx0.at, '2026-09-30'); assert.equal(ctx0.status, 'stale-version'); assert.equal(ctx0.session, null); assert.equal(ctx0.unit, 'month');
  assert.equal(normalizeRowScans(noPx).scanM!.st, 'stale-version');
  // with its own close: 30.77 (the close the stored −16.2% is measured from), never 30.62
  const ok = { ...noPx, scanM: { ...noPx.scanM, px: 30.77 } };
  assert.deepEqual(tagScanClose(ok, tag), { px: 30.77, at: '2026-09-30', tf: 'M' });
  assert.equal(r2((30.77 / 36.72 - 1) * 100), -16.2);
  const ctx = analysisContext(ok, tag);
  assert.deepEqual({ ...ctx }, { tf: 'M', unit: 'month', close: 30.77, at: '2026-09-30', session: 'completed', status: 'ready', v: V, obsAt: null });
  // a lean row (current version sent without `v`) is usable too
  const { v: _v, ...leanM } = ok.scanM;
  assert.equal(tagScanClose({ ...ok, scanM: leanM as any }, tag).px, 30.77);
  // not-scanned statuses of the current version are usable as statuses (no px needed)
  assert.equal(periodScanUsable({ st: 'insufficient-history', v: V }), true);
});

// ───────── the seven weekly examples (completed week of 9 Oct 2026) ─────────
const SEVEN: Array<[string, number, number, number, number, number, number, number]> = [
  // ticker, score, pivot, weekly close 9 Oct, weekly dist %, newer daily close, daily dist %, length (weeks)
  ['GTECJAINX', 100, 33.10, 33.74, 1.93, 34.57, 4.44, 13],
  ['AEQUS', 96, 271.21, 273.50, 0.84, 265.10, -2.25, 11],
  ['OMFREIGHT', 91, 99.50, 107.46, 8.00, 108.00, 8.54, 10],
  ['JKIPL', 89, 109.80, 113.40, 3.28, 107.37, -2.21, 12],
  ['DBSTOCKBRO', 65, 31.97, 31.99, 0.06, 32.47, 1.56, 7],
  ['EPACKPEB', 62, 250.90, 253.62, 1.08, 252.60, 0.68, 8],
  ['OMNI', 61, 615.00, 634.10, 3.11, 653.45, 6.25, 9],
];
test('zzz1003 seven weekly double bottoms: the weekly close of 9 Oct drives the weekly distance, the daily close stays apart', () => {
  const rows: ScreenRow[] = SEVEN.map(([t, c, p, wc, , dc, , l]) => ({
    t, n: t, px: dc, scanPx: dc, scanAt: '2026-10-13', pxSrc: 'nse-bhav', pxAt: '2026-10-13',
    scan: { st: 'no-pattern', v: V, asOf: '2026-10-13', px: dc, session: 'completed' },
    patW: [{ id: 'double_bottom', b: 'U', s: 'b', c, p, d: Math.round((wc / p - 1) * 1000) / 10, tf: 'W', l, lu: 'w' }],
    scanW: { st: 'ready', v: V, tf: 'W', asOf: '2026-10-09', px: wc },
  } as ScreenRow));
  for (const [i, [t, , p, wc, wd, dc, dd, l]] of SEVEN.entries()) {
    const r = rows[i], tag = r.patW![0];
    const sc = tagScanClose(r, tag);
    assert.deepEqual(sc, { px: wc, at: '2026-10-09', tf: 'W' }, t);
    assert.equal(r2((sc.px! / p - 1) * 100), wd, `${t} weekly distance`);
    assert.equal(r2((tagScanClose(r, { tf: 'D' }).px! / p - 1) * 100), dd, `${t} daily distance (separate)`);
    assert.equal(tagScanClose(r, { tf: 'D' }).at, '2026-10-13');
    const ctx = analysisContext(r, tag);
    assert.equal(ctx.unit, 'week'); assert.equal(ctx.session, 'completed'); assert.equal(ctx.at, '2026-10-09'); assert.equal(ctx.close, wc);
    assert.equal(tag.l, l);
    // AEQUS / JKIPL: weekly breakout of a completed week while the newer daily close is back below the pivot — both visible
    if (t === 'AEQUS' || t === 'JKIPL') { assert.ok(sc.px! > p && dc < p, `${t} weekly above, daily below`); }
    if (t === 'DBSTOCKBRO') assert.equal(r2(wc - p), 0.02, 'marginal ₹0.02 clearance stays a raw crossing');
  }
  const l = leanRows(rows);
  assert.equal(l.withPatternW, 7); assert.equal(l.coverage.W.ready, 7); assert.equal(l.coverage.W.asOf, '2026-10-09');
  for (const [i, [t, , p, wc, , dc]] of SEVEN.entries()) {
    const lt = l.rows[i].patW![0];
    assert.equal(lt.d, Math.round((wc / p - 1) * 1000) / 10, `${t} d (weekly close)`);
    assert.equal(lt.dq, Math.round((dc / p - 1) * 1000) / 10, `${t} dq (latest quote)`);
    assert.equal(tagScanClose(l.rows[i], lt).px, wc, `${t} lean row keeps the weekly close`);
  }
});

// ───────── PS-03: completed sessions by default, provisional live bar apart ─────────
test('zzz1003 PS-03: liveSessionBar — US before 16:00 New York / India before 15:30 IST on the bar\'s own date', () => {
  assert.equal(liveSessionBar('2026-10-13', 'US', new Date('2026-10-13T18:00:00Z')), true);    // 14:00 EDT
  assert.equal(liveSessionBar('2026-10-13', 'US', new Date('2026-10-13T20:30:00Z')), false);   // 16:30 EDT
  assert.equal(liveSessionBar('2026-10-12', 'US', new Date('2026-10-13T18:00:00Z')), false);   // yesterday's bar
  assert.equal(liveSessionBar('2026-10-13', 'IN', new Date('2026-10-13T05:00:00Z')), true);    // 10:30 IST
  assert.equal(liveSessionBar('2026-10-13', 'IN', new Date('2026-10-13T10:30:00Z')), false);   // 16:00 IST
  assert.equal(liveSessionBar('2026-10-13', 'IN', new Date('2026-10-13T02:00:00Z')), true);    // 07:30 IST: a bar dated today before the open is unfinished
  assert.equal(liveSessionBar('2026-10-13', 'IN', new Date('2026-10-12T20:00:00Z')), true);    // 01:30 IST on 13 Oct (IST date, not UTC)
  assert.equal(liveSessionBar('2026-10-11', 'US', new Date('2026-10-11T15:00:00Z')), false);   // Sunday
  assert.equal(liveSessionBar(null, 'US'), false);
});

for (const [market, liveAt, afterAt] of [['US', '2026-10-13T18:00:00Z', '2026-10-13T20:30:00Z'], ['IN', '2026-10-13T05:00:00Z', '2026-10-13T10:30:00Z']] as const) {
  test(`zzz1003 PS-03 ${market}: during the session the daily scan reads the previous close; the live bar is provisional and timestamped`, () => {
    const b = bizSeries('2026-10-13', 700, 0.09);   // the live bar jumps 9%
    const n = b.c.length;
    const live = techEntry(b, null, false, null, { market, now: new Date(liveAt) });
    // completed reading
    assert.equal(live.scan!.session, 'completed');
    assert.equal(live.scan!.asOf, '2026-10-12'); assert.equal(live.patAt, '2026-10-12', 'patAt = the completed session, never "13 Oct close"');
    assert.equal(live.scan!.px, Number(b.c[n - 2].toPrecision(6)));
    assert.equal(live.scan!.obsAt, liveAt.replace('Z', '.000Z'));
    for (const t of live.pat || []) if (t.p && t.d != null && t.b === 'U') assert.ok(Math.abs(t.d - (live.scan!.px! / t.p - 1) * 100) <= 0.1, `${t.id} d from the completed close`);
    assert.ok((live.pat || []).every((t) => !t.lv));
    // provisional reading of the live bar
    assert.ok(live.scanLive, 'scanLive kept');
    assert.equal(live.scanLive!.session, 'open'); assert.equal(live.scanLive!.at, new Date(liveAt).toISOString());
    assert.equal(live.scanLive!.asOf, '2026-10-13'); assert.equal(live.scanLive!.px, Number(b.c[n - 1].toPrecision(6)));
    assert.ok((live.patLive || []).every((t) => t.lv === 1));
    // price figures: the live bar (scanPx), the completed ones apart (cc)
    assert.equal(live.scanAt, '2026-10-13'); assert.equal(live.scanPx, Number(b.c[n - 1].toPrecision(6)));
    assert.ok(live.cc && live.cc.px === r2(b.c[n - 2]), 'cc = the completed session');
    // the same bars after the close: one completed reading, no provisional one
    const after = techEntry(b, null, false, null, { market, now: new Date(afterAt) });
    assert.equal(after.scan!.session, 'completed'); assert.equal(after.patAt, '2026-10-13'); assert.equal(after.scanLive, undefined); assert.equal(after.patLive, undefined); assert.equal(after.cc, undefined);
    // Yahoo's own `partial` flag alone (no market) also keeps the live bar out of the daily scan
    assert.equal(techEntry(b, null, true, null, { now: new Date(liveAt) }).patAt, '2026-10-12');
    // the completed reading during the session equals the after-close reading of the day before
    const prevDay = techEntry({ d: b.d.slice(0, -1), o: b.o.slice(0, -1), h: b.h.slice(0, -1), l: b.l.slice(0, -1), c: b.c.slice(0, -1), v: b.v.slice(0, -1) }, null, false, null, { market, now: new Date(afterAt) });
    assert.deepEqual(live.pat, prevDay.pat);
    // row + lean + helpers
    const row = { t: 'X', n: 'X', px: b.c[n - 1], ...rowPatternFields(live), scanPx: live.scanPx, scanAt: live.scanAt, ...(live.cc ? { cc: live.cc } : {}) } as ScreenRow;
    assert.ok(row.scanLive);
    const ctxD = analysisContext(row, { tf: 'D' });
    assert.equal(ctxD.session, 'completed'); assert.equal(ctxD.at, '2026-10-12'); assert.equal(ctxD.close, live.scan!.px); assert.equal(ctxD.obsAt, live.scan!.obsAt);
    const ctxL = analysisContext(row, { tf: 'D', lv: 1 });
    assert.equal(ctxL.session, 'provisional'); assert.equal(ctxL.at, '2026-10-13'); assert.equal(ctxL.close, live.scanLive!.px); assert.equal(ctxL.obsAt, live.scanLive!.at);
    const l = leanRows([row]);
    assert.equal(l.coverage.D.live, 1); assert.equal(l.coverage.D.provisional, 0); assert.equal(l.coverage.D.asOf, '2026-10-12');
    assert.equal((l.rows[0] as any).live, 1);
    assert.equal(l.rows[0].scanLive!.v, undefined, 'current version sent once');
  });
}

// ───────── PS-07: 10 years for the monthly scan; everything else unchanged ─────────
test('zzz1003 PS-07: ~10 years → ~120 monthly bars; daily / weekly figures and scans identical to the last ~5 years', () => {
  const now = new Date('2026-10-13T22:00:00Z');
  const full = bizSeries('2026-10-13', 2610);   // ~10 years of sessions
  const five = recentBars(full, TECH_FIGURE_DAYS);
  assert.ok(five.c.length < full.c.length && five.c.length > 1250 && five.c.length < 1330, `5 y cut ${five.c.length}`);
  const e10 = techEntry(full, null, false, null, { market: 'US', now });
  const e5 = techEntry(five, null, false, null, { market: 'US', now });
  for (const k of ['sma200', 'sma50', 'ema21', 'rsi', 'rsiW', 'rsiM', 'perf1Y', 'perf5Y', 'perfAll', 'hi52', 'atrP', 'adrP', 'stage', 'tt'] as const) {
    assert.equal((e10 as any)[k], (e5 as any)[k], k);
  }
  assert.deepEqual(e10.pat, e5.pat); assert.equal(e10.patAt, e5.patAt); assert.deepEqual({ ...e10.scan, obsAt: 0 }, { ...e5.scan, obsAt: 0 });
  assert.deepEqual(e10.patW, e5.patW); assert.deepEqual(e10.scanW, e5.scanW);
  // monthly: the full history
  assert.ok(e10.scanM!.hist! >= 118 && e10.scanM!.hist! <= 121, `hist ${e10.scanM!.hist}`);
  assert.equal(e10.scanM!.req, MONTHLY_HISTORY_REQ);
  assert.equal(e10.scanM!.from, full.d[0]);
  assert.ok(e10.scanM!.n! <= MONTHLY_HISTORY_REQ);
  assert.equal(e10.scanM!.need, undefined, 'a 60-month U base can be read with its prior trend');
  assert.equal(e10.scanM!.asOf, '2026-09-30'); assert.ok(e10.scanM!.px! > 0);
  // the 5-year history: ~60 monthly bars, the U base flagged as needing more
  assert.ok(e5.scanM!.hist! >= 59 && e5.scanM!.hist! <= 61, `5 y hist ${e5.scanM!.hist}`);
  assert.deepEqual(e5.scanM!.need, { u_base: MONTHLY_CONTEXT_BARS.u_base });
  assert.equal(MONTHLY_CONTEXT_BARS.u_base, 68);
  assert.match(monthlyNeedText(e5.scanM), /U \/ rounding base needs 68/);
  assert.equal(monthlyNeedText(e10.scanM), '');
  assert.deepEqual(monthlyHistory(30, '2024-01-02'), { hist: 30, req: 120, from: '2024-01-02', need: { u_base: 68 } });
  // the monthly reading passes rowPatternFields (current, with px) and labels itself
  const row = { t: 'M', n: 'M', px: 1, scanPx: e10.scanPx, scanAt: e10.scanAt, ...rowPatternFields(e10) } as ScreenRow;
  assert.equal(row.scanM!.st === 'ready' || row.scanM!.st === 'no-pattern', true);
  const ctx = analysisContext(row, { tf: 'M' });
  assert.equal(ctx.at, '2026-09-30'); assert.equal(ctx.close, e10.scanM!.px); assert.notEqual(ctx.close, e10.scanPx);
});

// ───────── PS-02: per-timeframe coverage ─────────
test('zzz1003 PS-02: scanCoverage per timeframe — ready / no-pattern / insufficient / invalid / error / stale / none', () => {
  const W = (st: string, extra: object = {}) => ({ st, v: V, tf: 'W', ...extra });
  const rows = [
    { t: 'A', scan: { st: 'ready', v: V, asOf: '2026-10-12' }, scanW: W('ready', { px: 10, asOf: '2026-10-09' }), scanM: { st: 'no-pattern', v: V, tf: 'M', px: 9, asOf: '2026-09-30' } },
    { t: 'B', scan: { st: 'no-pattern', v: V, asOf: '2026-10-12' }, scanW: W('ready', { asOf: '2026-10-09' }) /* no px */, scanM: { st: 'insufficient-history', v: V, tf: 'M' } },
    { t: 'C', scan: { st: 'ready', v: 5 }, cc: { px: 1 }, scanW: { st: 'ready', v: 5, tf: 'W', asOf: '2026-10-09' } },
    { t: 'D', scan: { st: 'error', v: V } },
    { t: 'E', scan: { st: 'invalid-data', v: V } },
    { t: 'F', patAt: '2026-10-01' },
    { t: 'G' },
    { t: 'H', scan: { st: 'ready', v: 3 } },
  ] as unknown as ScreenRow[];
  const d = scanCoverage(rows, 'D'), w = scanCoverage(rows, 'W'), m = scanCoverage(rows, 'M');
  assert.deepEqual([d.ready, d.noPattern, d.insufficient, d.invalid, d.error, d.stale, d.none, d.provisional], [2, 1, 0, 1, 1, 2, 1, 1]);
  assert.equal(d.asOf, '2026-10-12');
  assert.deepEqual([w.ready, w.noPattern, w.stale, w.none], [1, 0, 2, 5]); assert.equal(w.asOf, '2026-10-09');
  assert.deepEqual([m.ready, m.noPattern, m.insufficient, m.none], [0, 1, 1, 6]); assert.equal(m.asOf, '2026-09-30');
  const l = leanRows(rows);
  assert.deepEqual(l.coverage.W, w); assert.deepEqual(l.coverage.D, d);
  // lean rows (current version without v) give the same coverage — the page can count its own scope
  assert.deepEqual(scanCoverage(l.rows, 'W', l.scanV), w);
  assert.deepEqual(scanCoverage(l.rows, 'M', l.scanV), m);
});
