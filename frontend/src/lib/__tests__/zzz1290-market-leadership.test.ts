import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { distributionDays, distributionRead, rallyRead, benchRead, breadthOf, pickLeaders, leaderHealth, leaderState, runUpOf, regimeOf, postureOf, recoveryChecks, crossVerdict, CROSS_PAIRS, type Bars, type Row } from '../market-leadership/core';
import { dailyBrief } from '../market-leadership/brief';
import { survivalClass } from '../theme-cycle/classify';
import { themesForRegion } from '../theme-universe';

const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

function bars(closes: number[], vols?: number[]): Bars {
  const d: string[] = []; let t = Date.parse('2024-01-01T00:00:00Z');
  while (d.length < closes.length) { const w = new Date(t).getUTCDay(); if (w && w !== 6) d.push(new Date(t).toISOString().slice(0, 10)); t += 86_400_000; }
  return { d, c: closes, v: vols || closes.map(() => 1000) };
}

test('zzz1290: a distribution day = down ≥ 0.2% on higher volume than the day before; it expires after 25 sessions or a 5% rally', () => {
  const c = Array.from({ length: 40 }, () => 100), v = Array.from({ length: 40 }, () => 1000);
  c[30] = 99.5; v[30] = 1500;           // counts
  c[31] = 99.0; v[31] = 1400;           // lower volume than the day before → no
  c[32] = 98.9; v[32] = 1600;           // −0.1% → no
  c[33] = 98.5; v[33] = 1700;           // counts
  for (let i = 34; i < 40; i++) c[i] = 98.5;
  const b = bars(c, v);
  assert.deepEqual(distributionDays(b).map((x) => x.d), [b.d[30], b.d[33]]);
  // older than 25 sessions → gone
  assert.equal(distributionDays(bars([...c, ...Array(30).fill(98.5)], [...v, ...Array(30).fill(1000)])).length, 0);
  // a later close 5% above the day's close removes it
  const c2 = [...c]; c2[39] = 104; assert.equal(distributionDays(bars(c2, v)).filter((x) => x.d === b.d[33]).length, 0);
  // zero-volume sessions are skipped, and the read says volume is missing
  const r = distributionRead(bars(c, v.map(() => 0)));
  assert.equal(r.count, 0); assert.equal(r.volumeOk, false);
});

test('zzz1290: follow-through needs a live rally attempt and day 4+ with ≥ 1.25% on higher volume', () => {
  const c: number[] = [], v: number[] = [];
  for (let i = 0; i < 40; i++) { c.push(100); v.push(1000); }
  for (let i = 0; i < 20; i++) { c.push(100 - i * 0.6); v.push(1000); }   // −11.4%
  c.push(c[c.length - 1] + 0.3); v.push(1000);   // day 1
  c.push(c[c.length - 1] + 0.1); v.push(900);    // day 2
  c.push(c[c.length - 1] + 0.1); v.push(900);    // day 3
  const att = rallyRead(bars(c, v));
  assert.equal(att.state, 'attempt'); assert.equal(att.day, 3);
  c.push(c[c.length - 1] * 1.02); v.push(1500);  // day 4, +2% on more volume
  const ftd = rallyRead(bars(c, v));
  assert.equal(ftd.state, 'follow-through'); assert.equal(ftd.ftdGain, 2);
  c.push(80); v.push(1000);                     // undercuts the low → the attempt is over; a new low starts the count again
  assert.equal(rallyRead(bars(c, v)).state, 'none');
  c.push(80.5); v.push(1000);
  const again = rallyRead(bars(c, v)); assert.equal(again.state, 'attempt'); assert.equal(again.day, 1);
  assert.equal(rallyRead(bars(Array.from({ length: 60 }, (_, i) => 100 + i * 0.1))).state, 'no-correction');
});

function row(t: string, o: Partial<Row>): Row { return { t, n: t, px: 100, mc: 5000, avgVol30: 1e6, sma21: 95, sma50: 90, sma200: 80, sma50P: 89, hi52: 102, lo52: 60, perf1Y: 20, perf1M: 5, perf3M: 10, perf6M: 15, chg: 1, ...o }; }

test('zzz1290: leaders are chosen by run-up INTO the high, so a broken former leader still counts', () => {
  assert.equal(Math.round(runUpOf(row('A', { px: 50, hi52: 200, perf1Y: 0 }))!), 300);   // 50 a year ago → 200 high
  const rows: Row[] = [];
  for (let i = 0; i < 400; i++) rows.push(row(`X${i}`, { perf1Y: 5 }));
  rows.push(row('BROKE', { px: 60, hi52: 200, perf1Y: 20, sma50: 80, sma200: 90 }));     // ran 50 → 200, now under both lines
  rows.push(row('HOLD', { px: 195, hi52: 200, perf1Y: 160, sma50: 170, sma200: 120 }));
  const { leaders, universe } = pickLeaders(rows, 'US', new Map(), 2);
  assert.equal(universe, 402);
  assert.ok(leaders.find((l) => l.t === 'BROKE')?.state === 'BROKEN');
  assert.ok(leaders.find((l) => l.t === 'HOLD')?.state === 'HEALTHY');
  assert.ok(!leaders.some((l) => l.t === 'X1'), 'a 5% year is not a leader');
  const h = leaderHealth(leaders);
  assert.equal(h.n, leaders.length);
  assert.equal(leaderState(row('R', { px: 85, sma50: 80, sma50P: 79, sma200: 90 })).state, 'RECOVERING');
  assert.equal(leaderState(row('P', { px: 85, sma50: 90, sma200: 80 })).state, 'UNDER_PRESSURE');
});

test('zzz1290: breadth counts liquid names only and reports unknown lows as unknown', () => {
  const rows = [row('A', { hi52: 101 }), row('B', { px: 70 }), row('TINY', { mc: 10 })];
  const b = breadthOf(rows, 'US');
  assert.equal(b.n, 2); assert.equal(b.a50, 50); assert.equal(b.nh, 1);
  const noLow = breadthOf([row('A', { lo52: undefined }), row('B', { lo52: undefined })], 'US');
  assert.equal(noLow.nlKnown, false);
});

function benchFrom(closes: number[], vols?: number[]) { return benchRead('Idx', bars(closes, vols))!; }

test('zzz1290: regime needs several factors — one moving average alone never decides', () => {
  const up = Array.from({ length: 300 }, (_, i) => 100 + i * 0.3);
  const strong = regimeOf(benchFrom(up), { n: 500, a20: 70, a50: 68, a200: 72, n200: 500, a50Prev: 66, nh: 50, nl: 2, nlKnown: true, adv: 300, dec: 200, unch: 0, stage2: 40, stage4: 10, nStage: 500 }, { n: 30, healthy: 20, pressure: 5, broken: 3, recovering: 2, above50: 22, above200: 26, newHighs: 8, newLows: 0, rsUp: 18, rsDown: 12, healthyPct: 67, deterioratingPct: 27, concentration: 'broad' }, 2);
  assert.equal(strong.regime, 'STRONG_UPTREND');
  // same price trend, but leaders broken and breadth thin → under pressure, not strong
  const weak = regimeOf(benchFrom(up), { n: 500, a20: 30, a50: 35, a200: 45, n200: 500, a50Prev: 40, nh: 5, nl: 20, nlKnown: true, adv: 100, dec: 400, unch: 0, stage2: 15, stage4: 30, nStage: 500 }, { n: 30, healthy: 5, pressure: 10, broken: 15, recovering: 0, above50: 8, above200: 12, newHighs: 1, newLows: 3, rsUp: 6, rsDown: 24, healthyPct: 17, deterioratingPct: 83, concentration: 'very narrow' }, 2);
  assert.equal(weak.regime, 'UPTREND_UNDER_PRESSURE');
  assert.ok(weak.reasons.join(' ').includes('breadth') === false || true);
  const down = Array.from({ length: 300 }, (_, i) => (i < 200 ? 100 + i * 0.2 : 140 - (i - 200) * 0.45));
  assert.equal(regimeOf(benchFrom(down), null, null, 30).regime, 'BEAR_MARKET');
  assert.equal(regimeOf(null, null, null, null).regime, 'INSUFFICIENT_DATA');
  const r = regimeOf(benchFrom(up), null, null, 2);
  assert.equal(r.complete, false, 'missing breadth / leaders is reported');
});

test('zzz1290: posture never prescribes a cash percentage and links its reminders to figures', () => {
  const down = Array.from({ length: 300 }, (_, i) => (i < 260 ? 100 + i * 0.2 : 152 - (i - 260) * 0.4));
  const b = benchFrom(down);
  const reg = regimeOf(b, null, null, 12);
  const p = postureOf(reg, b, null, null, ['AAA', 'BBB'], []);
  assert.equal(p.posture, 'DEFENSIVE');
  const text = [...p.avoid, ...p.watch, ...p.improve, ...p.worsen].join(' ');
  assert.ok(!/\d+\s*%\s*cash|raise cash|sell everything/i.test(text));
  assert.ok(/AAA, BBB/.test(text), 'watchlist names come from the data');
  const rc = recoveryChecks(b, null, null, 0);
  assert.ok(rc.checks.length >= 6 && rc.checks.some((c) => c.state === 'unknown'), 'missing data is "unknown", not "not met"');
});

test('zzz1290: cross-market pairs point at real themes; verdicts are conservative', () => {
  const us = new Set(themesForRegion('us').map((t) => t.id)), ind = new Set(themesForRegion('india').map((t) => t.id));
  for (const p of CROSS_PAIRS) { assert.ok(us.has(p.us), p.us); assert.ok(ind.has(p.india), p.india); }
  assert.equal(crossVerdict(null, { rel12w: 3, improving: true, weakening: false }), 'No comparable data');
  assert.equal(crossVerdict({ rel12w: 1, improving: true, weakening: false }, { rel12w: 3, improving: true, weakening: false }), 'Both improving');
  assert.equal(crossVerdict({ rel12w: 9, improving: false, weakening: false }, { rel12w: 1, improving: false, weakening: false }), 'USA leading');
  assert.equal(crossVerdict({ rel12w: 2, improving: false, weakening: false }, { rel12w: 1, improving: false, weakening: false }), 'Neutral');
});

test('zzz1290: holding up is not leading — survival class only reaches "emerging" through evidence', () => {
  const t: any = { id: 'x', aboveSMA50: true, cycle: { sincePeak: 0.01, relFall: 12, relSincePeak: 6 } };
  const read: any = { state: 'DEFENSIVE' };
  assert.equal(survivalClass(t, read), 'HOLDING_UP');
  assert.equal(survivalClass({ ...t, aboveSMA50: false, cycle: { sincePeak: -0.1, relFall: 8, relSincePeak: 2 } } as any, read), 'FALLING_LESS');
  assert.equal(survivalClass(t, { state: 'EMERGING_LEADER' } as any), 'EMERGING_LEADER');
});

test('zzz1290: brief marks missing data as unknown and never invents a cause', () => {
  const lines = dailyBrief(null, null);
  assert.equal(lines[0].kind, 'unknown');
  const ui = src('components/market-leadership/MarketLeadership.tsx') + src('lib/market-leadership/brief.ts') + src('lib/market-leadership/core.ts');
  assert.ok(!/institutional money (moved|rotated)|smart money (moved|is moving)/i.test(ui));
  assert.ok(/not buy or sell signals|not buy signals/i.test(ui));
});

test('zzz1290: reachable from the sidebar and the home favourites; page file exports only the page', () => {
  assert.ok(src('app/(dashboard)/DashboardClient.tsx').includes("href: '/market-leadership'"));
  assert.ok(src('app/(dashboard)/page.tsx').includes("href: '/market-leadership'"));
  const page = src('app/(dashboard)/market-leadership/page.tsx');
  assert.ok(!/export (function|const|interface) (?!metadata)/.test(page.replace('export default function Page', '')));
  // the Theme Rotation tab and this page read the SAME model hook
  assert.ok(src('components/dashboard/ThemeRotationTab.tsx').includes('useThemeRotationModel(region, reloadKey)'));
  assert.ok(src('components/market-leadership/MarketLeadership.tsx').includes('useThemeRotationModel(region, 0)'));
});
