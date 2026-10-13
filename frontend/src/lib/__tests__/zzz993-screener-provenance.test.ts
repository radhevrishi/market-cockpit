// zzz993 — screener provenance (MC-01) and scan quality (MC-02).
// MC-01: the US row's price (px, Nasdaq) and the close the patterns / averages were read from (scanPx, Yahoo bars) are kept apart
//        with their sources; tag distances stay on the scan close, the quote distance is a separate `dq`; vendor disagreements
//        are flagged (pxConflict). MC-02: every row carries a scan status; short histories, bad data, failures and older scan
//        versions are never counted as scanned or shown as current; tags whose volume is not confirmed carry vq 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DailyBars } from '../screener/tech';
import {
  techEntry, patternsFromBars, rowPatternFields, rowScanFields, leanRows, priceSourceNote, LEAN_KEYS, PATTERN_SCAN_VERSION,
  PX_CONFLICT_PCT, SCAN_BASIS, type ScreenPatternTag,
} from '../screener/pine';
import { assembleUsRows } from '../screener/us-build';
import { assembleInRow } from '../screener/in-build';
import type { TechStored } from '../screener/tech-fetch';
import type { ScreenRow } from '../screener/types';

const V = PATTERN_SCAN_VERSION;
const usRow = (t: string, px: number, tf: TechStored): ScreenRow =>
  assembleUsRows([{ t, n: t, sec: 'Technology', ind: 'Software', px, chg: 1, vol: 1, mc: 900, ex: 'NASDAQ' } as any],
    new Map(), {} as any, {} as any, new Map([[t, tf]]), new Map(), new Map()).rows[0];
const stored = (scanPx: number, scanAt: string, pat: ScreenPatternTag[], extra: Partial<TechStored> = {}): TechStored => ({
  d: scanAt, close: Math.round(scanPx * 100) / 100, sma50: scanPx * 0.97, ipoD: null, patV: V, patAt: scanAt, pat,
  scan: { st: pat.length ? 'ready' : 'no-pattern', v: V, n: 700, asOf: scanAt, vc: 1 }, scanPx, scanAt, scanSrc: 'yahoo', scanEx: 'NasdaqGS',
  ...extra,
} as TechStored);
const dist = (px: number, pivot: number) => Math.round((px / pivot - 1) * 1000) / 10;

test('zzz993 MC-01 RPD-like: distance from the scan close, quote distance apart, vendor conflict flagged', () => {
  // Nasdaq quote $13.74; Yahoo bars close $12.93 on 12 Oct; inverse H&S pivot $12.89
  const tag: ScreenPatternTag = { id: 'inverse_hs', b: 'U', s: 'b', c: 70, p: 12.89, d: dist(12.93, 12.89) };
  const r = usRow('RPD', 13.74, stored(12.93, '2026-10-12', [tag]));
  assert.equal(r.px, 13.74); assert.equal(r.pxSrc, 'nasdaq'); assert.equal(r.pxAt, undefined);
  assert.equal(r.scanPx, 12.93); assert.equal(r.scanAt, '2026-10-12'); assert.equal(r.scanSrc, 'yahoo'); assert.equal(r.scanBasis, SCAN_BASIS);
  assert.equal(r.scanEx, 'NasdaqGS');
  assert.equal(r.pxGap, 6.26);
  assert.equal(r.pxConflict, 1);
  assert.equal(r.pat![0].d, 0.3, 'stored distance stays on the scan close');
  assert.ok(Math.abs(r.pat![0].d! - (r.scanPx! / r.pat![0].p! - 1) * 100) <= 0.05, 'd = scanPx / pivot within rounding');
  const lean = leanRows([r]);
  const lt = lean.rows[0].pat![0];
  assert.equal(lt.d, 0.3);
  assert.equal(lt.dq, 6.6, 'dq = quote / pivot, separate from d');
  assert.equal(lean.pxConflicts, 1);
  assert.equal(lean.rows[0].pxConflict, 1); assert.equal(lean.rows[0].scanPx, 12.93); assert.equal(lean.rows[0].pxGap, 6.26);
});

test('zzz993 MC-01 AVAV-like: bearish neckline below the quote but above the scan close — both readings kept', () => {
  const tag: ScreenPatternTag = { id: 'head_shoulders', b: 'D', s: 'b', c: 66, p: 136.826, d: dist(131.51, 136.826) };
  const r = usRow('AVAV', 137.11, stored(131.51, '2026-10-12', [tag]));
  assert.equal(r.pat![0].d, -3.9);
  assert.equal(r.pxGap, 4.26); assert.equal(r.pxConflict, 1);
  const lt = leanRows([r]).rows[0].pat![0];
  assert.equal(lt.d, -3.9); assert.equal(lt.dq, 0.2);
});

test('zzz993 MC-01: small gaps are not conflicts; a gap on different known days is timing, not a conflict; India coherent', () => {
  assert.equal(usRow('OK', 50.5, stored(50, '2026-10-12', [])).pxConflict, undefined);   // +1%
  assert.equal(usRow('OK', 50.5, stored(50, '2026-10-12', [])).pxGap, 1);
  const lag = rowScanFields(stored(100, '2026-10-09', []), { px: 110, src: 'nse-bhav', at: '2026-10-12' });
  assert.equal(lag.pxGap, 10); assert.equal(lag.pxConflict, undefined);
  const same = rowScanFields(stored(100, '2026-10-12', []), { px: 103, src: 'nse-bhav', at: '2026-10-12' });
  assert.equal(same.pxConflict, 1);
  assert.ok(PX_CONFLICT_PCT === 2);
  // India: the bars carry NSE's own close for the latest day → the row's px IS the scan close
  const tf = stored(812.4, '2026-10-12', [], { scanSrc: 'yahoo+nse-bhav', scanEx: 'NSE' });
  const inRow = assembleInRow('ABC', 'Abc', { date: '2026-10-12', px: { ABC: [812.4, 800, 1000] } } as any, [], undefined, tf, undefined);
  assert.equal(inRow.pxSrc, 'nse-bhav'); assert.equal(inRow.pxAt, '2026-10-12');
  assert.equal(inRow.scanPx, 812.4); assert.equal(inRow.scanSrc, 'yahoo+nse-bhav'); assert.equal(inRow.pxGap, 0); assert.equal(inRow.pxConflict, undefined);
  // an entry from before zzz993 (no scanPx): the stored close / date of the same bars are used
  const legacy = rowScanFields({ d: '2026-10-10', close: 20, ipoD: null } as TechStored, { px: 21, src: 'nasdaq' });
  assert.equal(legacy.scanPx, 20); assert.equal(legacy.scanAt, '2026-10-10'); assert.equal(legacy.pxGap, 5);
  const note = priceSourceNote([usRow('RPD', 13.74, stored(12.93, '2026-10-12', [])), usRow('OK', 50.5, stored(50, '2026-10-12', []))], 'US');
  assert.match(note!, /1 of 2 companies/);
  assert.match(note!, /Nasdaq/);
  for (const k of ['scan', 'scanPx', 'scanAt', 'scanSrc', 'scanBasis', 'scanEx', 'pxSrc', 'pxAt', 'pxGap', 'pxConflict', 'patW', 'patM', 'scanW', 'scanM'])
    assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} sent to the page`);
});

// ───────── real bars through the engine ─────────
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
type Leg = [number, number, ('lin' | 'ease')?];
function series(legs: Leg[], vol: (i: number) => number): DailyBars {
  const r = rng(7);
  const path: number[] = new Array(301).fill(legs[0][1]);
  for (const [d, to, shape] of legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); }
  }
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.UTC(2023, 0, 2), prev = path[0];
  for (let i = 0; i < path.length; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 0.006), o = prev;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(o); b.c.push(c);
    b.h.push(Math.max(o, c) * (1 + 0.005 * (0.3 + 0.7 * r()))); b.l.push(Math.min(o, c) * (1 - 0.005 * (0.3 + 0.7 * r())));
    b.v.push(vol(i));
    prev = c; t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return b;
}
const CUP_LEGS: Leg[] = [[60, 60], [120, 100], [50, 75, 'ease'], [12, 75], [50, 98, 'ease'], [12, 92], [4, 94.5]];

test('zzz993 MC-02: a ready scan carries status, version, usable bars, as-of, volume coverage and the scan close', () => {
  const b = series(CUP_LEGS, () => 1_000_000);
  const e = techEntry(b, null, false, null, { src: 'yahoo', ex: 'NasdaqGS' });
  assert.equal(e.scan!.st, 'ready'); assert.equal(e.scan!.v, V); assert.equal(e.scan!.asOf, b.d[b.d.length - 1]);
  assert.equal(e.scan!.n, b.c.length); assert.equal(e.scan!.vc, 1);
  assert.equal(e.scanPx, Number(b.c[b.c.length - 1].toPrecision(6))); assert.equal(e.scanAt, b.d[b.d.length - 1]); assert.equal(e.scanEx, 'NasdaqGS');
  assert.ok(e.pat!.length && e.pat!.every((t) => t.vq === undefined), 'volume confirmed → no vq flag');
  const f = rowPatternFields(e);
  assert.equal(f.scan!.st, 'ready'); assert.deepEqual(f.pat, e.pat); assert.equal(f.patAt, e.patAt);
});

test('zzz993 MC-02: all-zero volume → tags carry vq 0, coverage 0', () => {
  const e = techEntry(series(CUP_LEGS, () => 0), null, false);
  assert.ok(e.pat!.length >= 1, JSON.stringify(e.pat));
  for (const t of e.pat!) assert.equal(t.vq, 0, `${t.id} must say volume not confirmed`);
  assert.equal(e.scan!.vc, 0);
  assert.equal(leanRows([{ t: 'Z', n: 'Z', px: 1, ...rowPatternFields(e) } as ScreenRow]).rows[0].pat![0].vq, 0);
});

test('zzz993 MC-02: a 15-bar history is insufficient, not scanned / no-pattern', () => {
  const b = series([[1, 50]], () => 1000);
  const short: DailyBars = { d: b.d.slice(-15), o: b.o.slice(-15), h: b.h.slice(-15), l: b.l.slice(-15), c: b.c.slice(-15), v: b.v.slice(-15) };
  const e = techEntry(short, null, false);
  assert.equal(e.scan!.st, 'insufficient-history'); assert.equal(e.scan!.n, 15); assert.equal(e.patAt, null);
  assert.ok(typeof e.close === 'number', 'price figures kept');
  const row = { t: 'NEW', n: 'New', px: 1, ...rowPatternFields(e) } as ScreenRow;
  assert.equal(row.patAt, undefined); assert.equal(row.scan!.st, 'insufficient-history');
  const l = leanRows([row]);
  assert.equal(l.scanned, 0); assert.equal(l.insufficient, 1); assert.equal(l.patAt, null);
  // enough bars supplied but most rejected by validation → invalid data, not short history
  const bad = series([[1, 50]], () => 1000);
  for (let i = 0; i < bad.c.length - 20; i++) bad.c[i] = NaN;
  const p = patternsFromBars(bad, null);
  assert.equal(p.scan.st, 'invalid-data'); assert.equal(p.patAt, null);
});

test('zzz993 MC-02: an older scan version is stale — its tags are never shown as current', () => {
  const e = techEntry(series(CUP_LEGS, () => 1_000_000), null, false);
  const old = { ...e, patV: V - 1, scan: undefined } as TechStored;
  const f = rowPatternFields(old);
  assert.deepEqual(Object.keys(f).sort(), ['scan']);
  assert.equal(f.scan!.st, 'stale-version'); assert.equal(f.scan!.v, V - 1); assert.equal(f.scan!.asOf, e.patAt);
  const fixture = rowPatternFields({ ...e, patV: 1 } as TechStored);
  assert.equal(fixture.pat, undefined); assert.equal(fixture.scan!.st, 'stale-version');
  // a snapshot row from before zzz993 (patAt + tags, no scan) is stale too
  const legacy = { t: 'LEG', n: 'Leg', px: 1, patAt: '2026-10-09', pat: e.pat } as ScreenRow;
  const l = leanRows([legacy, { t: 'S', n: 'S', px: 1, ...f } as ScreenRow], null, false);
  assert.equal(l.scanned, 0); assert.equal(l.stale, 2); assert.equal(l.withPattern, 0);
  assert.ok(l.rows.every((r) => !r.pat && !r.patAt));
  assert.deepEqual(l.rows[0].scan, { st: 'stale-version', v: 0 });
  assert.equal(leanRows([legacy], null, true).rows.length, 0, 'patterns-only list leaves stale rows out');
});

test('zzz993 MC-02: a scan exception keeps the price figures but reports error, not "no pattern"', () => {
  const b = series(CUP_LEGS, () => 1_000_000);
  Object.defineProperty(b.o, 3, { get() { throw new Error('boom'); } });   // touched by the pattern scan only
  const e = techEntry(b, null, false);
  assert.equal(e.scan!.st, 'error'); assert.equal(e.scan!.asOf, b.d[b.d.length - 1]);
  assert.deepEqual(e.pat, []); assert.equal(e.patAt, null);
  assert.ok(typeof e.sma50 === 'number' && typeof e.close === 'number', 'price figures kept');
  const r = usRow('ERR', 95, e);
  assert.ok(typeof r.sma50 === 'number' && r.scanPx != null);
  assert.equal(r.scan!.st, 'error'); assert.equal(r.patAt, undefined);
  const l = leanRows([r]);
  assert.equal(l.errors, 1); assert.equal(l.scanned, 0);
});

test('zzz993 counts: scanned = ready + no-pattern only; weekly / monthly fields pass through when present', () => {
  const ready = { t: 'A', n: 'A', px: 10, patAt: '2026-10-12', scan: { st: 'ready', v: V }, pat: [{ id: 'vcp', b: 'U', s: 'f', c: 60, p: 11, d: -9.1 }] } as ScreenRow;
  const none = { t: 'B', n: 'B', px: 10, patAt: '2026-10-12', scan: { st: 'no-pattern', v: V } } as ScreenRow;
  const never = { t: 'C', n: 'C', px: 10 } as ScreenRow;
  const l = leanRows([ready, none, never]);
  assert.deepEqual([l.scanned, l.withPattern, l.insufficient, l.invalid, l.errors, l.stale, l.total], [2, 1, 0, 0, 0, 0, 3]);
  assert.equal(l.patAt, '2026-10-12');
  const wk: ScreenPatternTag = { id: 'flat_base', b: 'U', s: 'f', c: 60, p: 12, d: -5, tf: 'W' };
  const e = { ...techEntry(series(CUP_LEGS, () => 1_000_000), null, false), patW: [wk], scanW: { st: 'ready' as const, v: V, tf: 'W' as const } };
  const f = rowPatternFields(e);
  assert.deepEqual(f.patW, [wk]); assert.equal(f.scanW!.tf, 'W');
  assert.equal(rowPatternFields({ ...e, scanM: { st: 'no-pattern', v: V, tf: 'M' } }).patM, undefined, 'monthly tags only with a ready monthly scan');
  const lw = leanRows([{ t: 'W', n: 'W', px: 12.6, ...f } as ScreenRow]).rows[0];
  assert.equal(lw.patW![0].dq, 5);
});

// ───────── weekly / monthly scans (same daily bars, completed periods) ─────────
function longSeries(legs: Leg[], flat: number): DailyBars {
  const r = rng(7);
  const path: number[] = new Array(flat).fill(legs[0][1]);
  for (const [d, to, shape] of legs) {
    const from = path[path.length - 1];
    for (let k = 1; k <= d; k++) { const x = k / d; path.push(from + (to - from) * (shape === 'ease' ? (1 - Math.cos(Math.PI * x)) / 2 : x)); }
  }
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let t = Date.UTC(2021, 0, 4), prev = path[0];
  for (let i = 0; i < path.length; i++) {
    const c = path[i] * (1 + (r() - 0.5) * 0.006), o = prev;
    b.d.push(new Date(t).toISOString().slice(0, 10)); b.o.push(o); b.c.push(c); b.h.push(Math.max(o, c) * 1.004); b.l.push(Math.min(o, c) * 0.996);
    b.v.push(1e6 * (0.8 + 0.4 * r()));
    prev = c; t += 86_400_000; while ([0, 6].includes(new Date(t).getUTCDay())) t += 86_400_000;
  }
  return b;
}
const LONG = longSeries([[60, 60], [250, 100], [150, 72, 'ease'], [180, 98, 'ease'], [40, 92], [20, 95]], 100);
const AFTER = new Date(Date.parse(LONG.d[LONG.d.length - 1]) + 40 * 86_400_000);   // the last week / month is complete

test('zzz993 W/M: techEntry scans completed weeks and months of the same daily bars; tags carry tf; rows / lean rows / counts carry them', () => {
  const e = techEntry(LONG, null, false, null, { now: AFTER });
  assert.equal(e.scan!.st === 'ready' || e.scan!.st === 'no-pattern', true);
  assert.equal(e.scanW!.st, 'ready'); assert.equal(e.scanW!.tf, 'W'); assert.equal(e.scanW!.v, V); assert.ok(e.scanW!.e);
  assert.ok(e.scanW!.n! > 100 && e.scanW!.n! < 200, `weekly bars ${e.scanW!.n}`);
  assert.equal(e.scanW!.asOf, LONG.d[LONG.d.length - 1]);
  assert.ok(e.patW!.length && e.patW!.every((t) => t.tf === 'W' && typeof t.l === 'number' && t.c >= 35));
  assert.equal(e.scanM!.tf, 'M'); assert.ok(e.scanM!.n! >= 24 && e.scanM!.n! < 60, `monthly bars ${e.scanM!.n}`);
  assert.ok(e.patM!.every((t) => t.tf === 'M'));
  assert.ok(e.pat!.every((t) => t.tf === undefined), 'daily tags carry no tf');
  const f = rowPatternFields(e);
  assert.deepEqual(f.patW, e.patW); assert.equal(f.scanW!.st, 'ready');
  const l = leanRows([{ t: 'L', n: 'L', px: 95, ...f } as ScreenRow]);
  assert.equal(l.scannedW, 1); assert.equal(l.withPatternW, 1); assert.equal(l.scannedM, 1);
  assert.equal(l.withPatternM, e.patM!.length ? 1 : 0);
  assert.ok(l.rows[0].patW![0].dq != null);
  // stale entries expose no weekly / monthly tags either
  assert.equal(rowPatternFields({ ...e, patV: V - 1 }).patW, undefined);
});

test('zzz993 W/M: too few weeks / months is insufficient history; a W/M failure never costs the daily scan', () => {
  const e = techEntry(longSeries([[1, 50]], 120), null, false, null, { now: AFTER });
  assert.equal(e.scanW!.st, 'insufficient-history');   // ~24 weeks < 30
  assert.equal(e.scanM!.st, 'insufficient-history');   // ~5 months < 24
  assert.deepEqual(e.patW, []); assert.deepEqual(e.patM, []);
  const l = leanRows([{ t: 'Y', n: 'Y', px: 1, ...rowPatternFields(e) } as ScreenRow]);
  assert.equal(l.scannedW, 0); assert.equal(l.scannedM, 0);
  // the getter throws from its second read: the daily scan (first read) succeeds, the weekly / monthly scans fail
  const b = longSeries([[60, 60], [250, 100], [150, 72, 'ease'], [180, 98, 'ease'], [40, 92], [20, 95]], 100);
  let reads = 0; const o3 = b.o[3];
  Object.defineProperty(b.o, 3, { get() { if (++reads > 1) throw new Error('boom'); return o3; } });
  const x = techEntry(b, null, false, null, { now: AFTER });
  assert.ok(x.scan!.st === 'ready' || x.scan!.st === 'no-pattern', `daily ${x.scan!.st}`);
  assert.equal(x.scanW!.st, 'error'); assert.equal(x.scanM!.st, 'error'); assert.deepEqual(x.patW, []);
  assert.ok(typeof x.sma50 === 'number');
});

test('zzz993 lean rows: the rule-editor fields are sent, numbers rounded, repeated version / basis sent once', () => {
  for (const k of ['rsiW', 'rsiM', 'epsQYoY', 'revAYoY', 'ps', 'evRev', 'de', 'cash', 'roeTTM', 'roceTTM', 'gmFY', 'epsTTMYoY', 'revTTMYoY', 'gpQYoY', 'pe',
    'opmTTM', 'nmTTM', 'sma21', 'sma100', 'ema10', 'ema50', 'atrP', 'chg1W', 'perf5D', 'perf5Y', 'avgVol60', 'fs'])
    assert.ok((LEAN_KEYS as readonly string[]).includes(k), `${k} sent to the page`);
  const r = usRow('RND', 0.123456, stored(0.12, '2026-10-12', []));
  Object.assign(r, { pe: 23.456789, de: 0.0123456, avgVol60: 1234567, fs: 7, rsiW: 61.005 });
  const l = leanRows([r]);
  const lr = l.rows[0] as any;
  assert.equal(lr.pe, 23.46); assert.equal(lr.de, 0.01235); assert.equal(lr.avgVol60, 1234567); assert.equal(lr.fs, 7); assert.equal(lr.px, 0.1235);
  assert.equal(lr.scan.v, undefined, 'current version is sent once (scanV)'); assert.equal(lr.scan.e, undefined);
  assert.equal(l.scanV, V); assert.equal(l.engine, null, 'fixture scan carries no engine version'); assert.equal(l.scanBasis, SCAN_BASIS); assert.equal(lr.scanBasis, undefined);
  assert.equal(lr.scanSrc, 'yahoo');
  assert.ok(leanRows([{ t: 'E', n: 'E', px: 1, ...rowPatternFields(techEntry(LONG, null, false, null, { now: AFTER })) } as ScreenRow]).engine);
});

test('zzz996 a Nasdaq quote a session behind is replaced by the last bar close (RPD / AVAV / AAPL on 13 Oct 2026)', async () => {
  const { resolveUsQuote } = await import('../screener/pine');
  // zzz998 — replacement also needs the quote's change to be the PREVIOUS session's (prev2Close) and runs outside the US session
  const AFTER_HOURS = new Date('2026-10-13T02:00:00Z');   // Mon 12 Oct 22:00 New York
  const rpd = resolveUsQuote({ px: 13.74, chg: 6.02 }, { close: 12.93, prevClose: 13.74, prev2Close: 12.96, scanAt: '2026-10-12' }, AFTER_HOURS);
  assert.equal(rpd.px, 12.93); assert.equal(rpd.pxAlt, 13.74); assert.equal(rpd.chg, -5.9); assert.equal(rpd.at, '2026-10-12');
  const aapl = resolveUsQuote({ px: 336.64, chg: -1.11 }, { close: 340.97, prevClose: 336.64, prev2Close: 340.42 }, AFTER_HOURS);
  assert.equal(aapl.px, 340.97); assert.ok(Math.abs(aapl.mcScale - 340.97 / 336.64) < 1e-9);
  // a current quote (live session, or equal to the last close) is kept
  assert.equal(resolveUsQuote({ px: 341.5, chg: 0.2 }, { close: 340.97, prevClose: 336.64, prev2Close: 340.42 }, AFTER_HOURS).src, 'nasdaq');
  assert.equal(resolveUsQuote({ px: 340.97, chg: 1.3 }, { close: 340.97, prevClose: 336.64, prev2Close: 340.42 }, AFTER_HOURS).px, 340.97);
  assert.equal(resolveUsQuote({ px: 10, chg: 0 }, undefined, AFTER_HOURS).px, 10);
});
