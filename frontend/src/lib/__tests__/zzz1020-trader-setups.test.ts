// zzz1020 — TRADER SETUPS (lib/setups.ts): every rule on synthetic bars — it fires, it does not fire, window edges, too little
// history → null, Darvas top / bottom confirmation. Our own version of the published rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupFigures, setupSeries, SETUP_META, SETUP_FIGURE_KEYS, type SetupBar, type SetupCode } from '../setups';
import { ema } from '../chart-math';

const DAY = 86_400_000;
const MON = Date.UTC(2024, 0, 1);   // a Monday
/** trading days Mon–Fri from 1 Jan 2024 */
function dayT(i: number): number { const w = Math.floor(i / 5), d = i % 5; return MON + (w * 7 + d) * DAY; }
type Spec = { c: number; o?: number; h?: number; l?: number; v?: number };
function bars(specs: Spec[]): SetupBar[] {
  return specs.map((s, i) => {
    const o = s.o ?? (i ? specs[i - 1].c : s.c);
    return { t: dayT(i), o, h: s.h ?? Math.max(o, s.c) * 1.005, l: s.l ?? Math.min(o, s.c) * 0.995, c: s.c, v: s.v ?? 1_000_000 };
  });
}
const flat = (n: number, c = 100, extra: Partial<Spec> = {}): Spec[] => Array.from({ length: n }, () => ({ c, ...extra }));
const rising = (n: number, from: number, pct: number): Spec[] => Array.from({ length: n }, (_, i) => ({ c: from * (1 + pct) ** i }));
const codes = (b: SetupBar[]) => new Set(setupSeries(b).events.map((e) => e.code));

test('zzz1020 API: every code has plain-words meta; figure keys; empty / short input never throws and is null', () => {
  const all: SetupCode[] = ['WT3', 'DVX', 'DC20', 'DC55', 'SQZ', 'SQZF', 'EP', 'GV', 'MB', 'WP', 'ECB', 'NH', 'ATH', 'NR7', 'IB', 'HG', 'SPR'];
  for (const c of all) { const m = SETUP_META[c]; assert.ok(m.label && m.method && m.rule, c); assert.doesNotMatch(`${m.label} ${m.rule}`, /\bbest\b|\bbuy\b|\bsell\b/i, c); }
  assert.equal(Object.keys(SETUP_META).length, all.length);
  const e = setupFigures([]);
  for (const k of SETUP_FIGURE_KEYS) assert.equal(e[k], null, k);
  const one = setupFigures(bars(flat(1)));
  for (const k of SETUP_FIGURE_KEYS) assert.equal(one[k], null, k);
  const s = setupSeries([]);
  assert.deepEqual(s, { events: [], darvas: [], squeeze: { on: [], mom: [] }, donchian20: { hi: [], lo: [] } });
  // 30 sessions: the long-history setups stay null
  const f = setupFigures(bars(flat(30)));
  for (const k of ['nhD', 'dvx', 'dvT', 'epD', 'udv', 'x50A', 'dc55D', 'sprD', 'wt3', 'dc20W'] as const) assert.equal(f[k], null, k);
  assert.equal(f.sqzN != null, true);   // squeeze needs only ~20 bars
});

test('zzz1020 episodic pivot: fires on a 10%+ gap on 3× volume after a quiet stretch; India 8%; holding; window edge', () => {
  const base = flat(120, 100);
  const gap = (g: number, vol = 4_000_000, after = 2, afterC = 114): Spec[] => [...base, { o: 100 * (1 + g), c: 100 * (1 + g) + 2, l: 100 * (1 + g) - 1, h: 100 * (1 + g) + 3, v: vol }, ...flat(after, afterC)];
  let f = setupFigures(bars(gap(0.12)));
  assert.equal(f.epD, 2); assert.equal(f.epG, 12);
  assert.ok(f.epT != null && f.epT > 19000);
  assert.ok(codes(bars(gap(0.12))).has('EP'));
  assert.equal(setupFigures(bars(gap(0.12, 2_000_000))).epD, null, 'volume only 2× the average');
  assert.equal(setupFigures(bars(gap(0.09, 4_000_000, 2, 110))).epD, null, 'US needs 10%');
  assert.equal(setupFigures(bars(gap(0.09, 4_000_000, 2, 110)), { market: 'IN' }).epD, 2, 'India: 8% is enough');
  assert.equal(setupFigures(bars(gap(0.7, 4_000_000, 2, 175))).epD, null, 'over 60% is not an episodic pivot');
  assert.equal(setupFigures(bars(gap(0.12, 4_000_000, 2, 105))).epD, null, 'close back under the gap-day low');
  assert.equal(setupFigures(bars(gap(0.12, 4_000_000, 9))).epD, 9, 'window edge: 9 sessions ago');
  assert.equal(setupFigures(bars(gap(0.12, 4_000_000, 10))).epD, null, '10 sessions ago is outside the window');
  // not after a big run: +50% over the 60 sessions before the gap
  const ran = [...flat(60, 100), ...rising(61, 100, 0.0075), ...[]];
  const last = ran[ran.length - 1].c;
  f = setupFigures(bars([...ran, { o: last * 1.12, c: last * 1.14, l: last * 1.11, h: last * 1.15, v: 4_000_000 }]));
  assert.equal(f.epD, null, 'prior 60-session change above +30%');
});

test('zzz1020 gap-up with volume (Kell): open ≥ 0.75 × ATR 40 above the close on 1.5× volume', () => {
  const base = flat(80, 100, { h: 101, l: 99 });
  assert.equal(setupFigures(bars([...base, { o: 102, c: 102.5, h: 103, l: 101.8, v: 2_000_000 }])).gvD, 0);
  assert.equal(setupFigures(bars([...base, { o: 102, c: 102.5, h: 103, l: 101.8, v: 1_000_000 }])).gvD, null, 'no volume');
  assert.equal(setupFigures(bars([...base, { o: 101, c: 101.5, h: 102, l: 100.8, v: 2_000_000 }])).gvD, null, 'gap under 0.75 ATR');
});

test('zzz1020 momentum burst (Bonde): +4% on higher volume, previous bar not a burst, window 5', () => {
  const base = flat(60, 100);
  assert.equal(setupFigures(bars([...base, { c: 105, v: 2_000_000 }])).mbD, 0);
  assert.equal(setupFigures(bars([...base, { c: 103.5, v: 2_000_000 }])).mbD, null, 'under 4%');
  assert.equal(setupFigures(bars([...base, { c: 105, v: 900_000 }])).mbD, null, 'volume not higher');
  // two bursts in a row: only the first counts
  assert.equal(setupFigures(bars([...base, { c: 105, v: 2_000_000 }, { c: 110, v: 3_000_000 }])).mbD, 1);
  assert.equal(setupFigures(bars([...base, { c: 105, v: 2_000_000 }, ...flat(4, 105)])).mbD, 4, 'window edge');
  assert.equal(setupFigures(bars([...base, { c: 105, v: 2_000_000 }, ...flat(5, 105)])).mbD, null);
});

test('zzz1020 Donchian 20 / 55 (Turtles): close above the prior 20 / 55-bar high; weekly version', () => {
  const base = flat(80, 100, { h: 101, l: 99 });
  let f = setupFigures(bars([...base, { c: 103, h: 103.5, l: 100 }]));
  assert.equal(f.dc20D, 0); assert.equal(f.dc55D, 0);
  f = setupFigures(bars([...base, { c: 100.9, h: 103.5, l: 100 }]));
  assert.equal(f.dc20D, null, 'only the high went above — the close did not');
  // a 20-bar high that is not a 55-bar high
  f = setupFigures(bars([...flat(30, 100, { h: 106, l: 99 }), ...flat(30, 100, { h: 101, l: 99 }), { c: 103, h: 103.5, l: 100 }]));
  assert.equal(f.dc20D, 0); assert.equal(f.dc55D, null);
  const s = setupSeries(bars([...base, { c: 103, h: 103.5, l: 100 }]));
  assert.equal(s.donchian20.hi[base.length], 101);
  assert.equal(s.donchian20.hi[5], null);
  assert.ok(s.events.some((e) => e.code === 'DC20' && e.dir === 1 && e.level === 101));
  // weekly: 30 flat weeks then a strong final week
  const wf = setupFigures(bars([...flat(150, 100, { h: 101, l: 99 }), ...flat(4, 100, { h: 101, l: 99 }), { c: 106, h: 106.5, l: 101 }]));
  assert.equal(wf.dc20W, 0);
});

test('zzz1020 3 weeks tight (O\'Neil): weekly closes within 1.5%, price above SMA 50', () => {
  const up = rising(100, 50, 0.005);
  const p = up[up.length - 1].c * 1.03;
  const tight = [...up, ...flat(5, p), ...flat(5, p * 1.006), ...flat(5, p * 1.002)];
  const f = setupFigures(bars(tight));
  assert.equal(f.wt3, 3);
  assert.ok(f.wt3P != null && f.wt3P >= p * 1.006);
  const two = setupFigures(bars([...up, ...flat(5, p), ...flat(5, p * 1.006)]));
  assert.equal(two.wt3, null, 'only 2 tight weeks');
  const loose = setupFigures(bars([...up, ...flat(5, p), ...flat(5, p * 1.03), ...flat(5, p)]));
  assert.equal(loose.wt3, null, 'weekly closes 3% apart');
  const below = setupFigures(bars([...up, ...flat(5, p * 0.6), ...flat(5, p * 0.6), ...flat(5, p * 0.6)]));
  assert.equal(below.wt3, null, 'price under SMA 50');
  // on weekly bars passed in, the series reads them as bars
  assert.ok(codes(bars([...rising(60, 50, 0.01), ...flat(3, 100)])).has('WT3'));
});

test('zzz1020 Darvas box: top + bottom each confirmed by 3 bars; inside / broke out / broke down', () => {
  const up: Spec[] = Array.from({ length: 270 }, (_, i) => ({ c: 50 + (69 * i) / 269, h: 50 + (69 * i) / 269 + 0.5, l: 50 + (69 * i) / 269 - 0.5 }));
  const box: Spec[] = [
    { c: 119.5, h: 120, l: 118.5 },                    // 270: the 52-week high (top 120)
    { c: 117, h: 118, l: 116 }, { c: 113, h: 117, l: 112 }, { c: 111, h: 116, l: 110 },   // 3 lower highs; low 110
    { c: 112, h: 115, l: 110.5 }, { c: 113, h: 115, l: 111 },                          // 2 bars holding the low
  ];
  assert.equal(setupFigures(bars([...up, ...box])).dvx, null, 'bottom not confirmed yet (2 bars)');
  const ok = [...up, ...box, { c: 112, h: 114, l: 111 }];
  let f = setupFigures(bars(ok));
  assert.equal(f.dvx, 1); assert.equal(f.dvT, 120); assert.equal(f.dvB, 110);
  f = setupFigures(bars([...ok, { c: 121, h: 121.5, l: 113 }]));
  assert.equal(f.dvx, 2);
  f = setupFigures(bars([...ok, { c: 121, h: 121.5, l: 113 }, ...flat(5, 121)]));
  assert.equal(f.dvx, null, 'breakout older than 5 sessions');
  f = setupFigures(bars([...ok, { c: 109, h: 112, l: 108.5 }]));
  assert.equal(f.dvx, 3);
  const s = setupSeries(bars([...ok, { c: 121, h: 121.5, l: 113 }]));
  const last = s.darvas[s.darvas.length - 1];
  assert.deepEqual({ top: last.top, bottom: last.bottom, state: last.state, from: last.from }, { top: 120, bottom: 110, state: 'up', from: 270 });
  assert.ok(s.events.some((e) => e.code === 'DVX' && e.dir === 1 && e.level === 120));
  // a new high before the top is confirmed restarts the box
  const re = [...up, { c: 119.5, h: 120, l: 118.5 }, { c: 117, h: 118, l: 116 }, { c: 120.5, h: 121, l: 119 }, { c: 118, h: 119, l: 117 }];
  assert.equal(setupFigures(bars(re)).dvx, null);
  assert.equal(setupSeries(bars(re)).darvas.length, 0);
});

test('zzz1020 TTM squeeze: on while the bands are inside the channel, fired after ≥ 5 bars, momentum sign', () => {
  const wild: Spec[] = Array.from({ length: 60 }, (_, i) => ({ c: 100 * (1 + 0.02 * Math.sin(i / 3)) }));
  const quiet = flat(30, 100, { h: 102, l: 98 });
  let f = setupFigures(bars([...wild, ...quiet]));
  assert.ok(f.sqzN != null && f.sqzN >= 5, `squeeze bars ${f.sqzN}`);
  f = setupFigures(bars([...wild, ...quiet, { c: 104, h: 104.5, l: 100 }, { c: 108, h: 108.5, l: 103.5 }, { c: 113, h: 113.5, l: 107.5 }]));
  assert.equal(f.sqzN, 0);
  assert.ok(f.sqzF != null && f.sqzF <= 2, `fired ${f.sqzF}`);
  assert.equal(f.sqzM, 1);
  assert.equal(setupFigures(bars(wild)).sqzF, null, 'never squeezed');
  const s = setupSeries(bars([...wild, ...quiet]));
  assert.equal(s.squeeze.on.length, 90); assert.equal(s.squeeze.on[89], true); assert.equal(s.squeeze.mom[5], null);
});

test('zzz1020 narrow range 7 / 4 and inside bar', () => {
  const ranges = [4, 5, 6, 3.5, 4.5, 5.5];
  const base: Spec[] = [...flat(20, 100), ...ranges.map((r) => ({ c: 100, h: 100 + r / 2, l: 100 - r / 2 }))];
  let f = setupFigures(bars([...base, { c: 100, h: 100.5, l: 99.5 }]));
  assert.equal(f.nr7, 7); assert.equal(f.ib, 1); assert.equal(f.antD, 1);
  f = setupFigures(bars([...base, { c: 100, h: 101.7, l: 98.3 }]));   // range 3.4: narrower than all 6 before it
  assert.equal(f.nr7, 7);
  f = setupFigures(bars([...base, { c: 100, h: 101.9, l: 98.1 }]));   // range 3.8: not narrower than 3.5 (3 bars back) → 0
  assert.equal(f.nr7, 0);
  f = setupFigures(bars([...flat(20, 100, { h: 101, l: 99 }), { c: 100, h: 106, l: 94 }, { c: 100, h: 104, l: 96 }, { c: 100, h: 103, l: 97 }, { c: 100, h: 102.5, l: 97.5 }]));
  assert.equal(f.nr7, 4);
  f = setupFigures(bars([...flat(20, 100), { c: 100, h: 103, l: 97 }, { c: 101, h: 103.5, l: 98 }]));
  assert.equal(f.ib, 0, 'high above the bar before');
});

test('zzz1020 wedge pop and EMA crossback (Kell)', () => {
  const up = rising(60, 80, 0.004);
  const top = up[up.length - 1].c;
  const drop = flat(6, top * 0.9);
  let f = setupFigures(bars([...up, ...drop, { c: top * 1.01, v: 2_000_000 }]));
  assert.equal(f.wpD, 0);
  assert.equal(setupFigures(bars([...up, ...drop, { c: top * 1.01, v: 500_000 }])).wpD, null, 'volume under the average');
  assert.equal(setupFigures(bars([...up, ...flat(3, top * 0.9), { c: top * 1.01, v: 2_000_000 }])).wpD, null, 'only 3 closes below');
  // EMA crossback: a steady uptrend, one bar's low dips to EMA 20 and closes above EMA 10
  const tr = rising(80, 50, 0.006);
  const e20 = ema([...tr.map((x) => x.c), tr[tr.length - 1].c * 1.002], 20);
  const c = tr[tr.length - 1].c * 1.002, lowTouch = (e20[e20.length - 1] as number) * 1.001;
  f = setupFigures(bars([...tr, { c, o: c, h: c * 1.003, l: lowTouch }]));
  assert.equal(f.ecbD, 0);
  f = setupFigures(bars([...tr, { c, o: c, h: c * 1.003, l: c * 0.995 }]));
  assert.equal(f.ecbD, null, 'the low stayed well above EMA 20');
});

test('zzz1020 new 52-week high / all-time high closes; window 10', () => {
  const hist = [...rising(200, 50, 0.002), ...flat(100, 80, { h: 82, l: 78 })];
  let f = setupFigures(bars([...hist, { c: 90, h: 91, l: 85 }]));
  assert.equal(f.nhD, 0); assert.equal(f.athD, 0);
  f = setupFigures(bars([...hist, { c: 90, h: 91, l: 85 }, ...flat(10, 85, { h: 86, l: 84 })]));
  assert.equal(f.nhD, null);
  f = setupFigures(bars([...hist, { c: 81.5, h: 82, l: 80 }]));
  assert.equal(f.nhD, null, 'below the 252-session high');
  assert.equal(setupFigures(bars(rising(100, 50, 0.003))).nhD, null, 'too little history for 52 weeks');
  assert.equal(setupFigures(bars(rising(100, 50, 0.01))).athD, 0, 'all-time high in the data we have');
});

test('zzz1020 Holy Grail (Raschke): ADX ≥ 30 and rising, low touches EMA 20, next bar above that bar\'s high', () => {
  // a strong uptrend (+1.2% a day) with a small shakeout every 6th day, so ADX is ~62 and moves (a perfectly smooth trend pins it at 100)
  const tr: Spec[] = [];
  let px = 50;
  for (let i = 0; i < 48; i++) { px *= 1.012; const o = px / 1.012; tr.push(i % 6 === 0 ? { c: px, o, h: px * 1.005, l: o * 0.968 } : { c: px, o }); }
  const closes = tr.map((x) => x.c);
  const e20 = ema(closes, 20)[closes.length - 1] as number;
  const last = closes[closes.length - 1];
  const touch: Spec = { c: last * 1.004, o: last * 1.006, h: last * 1.012, l: e20 * 0.999 };
  const seq = [...tr, touch, { c: last * 1.02, o: last * 1.01, h: last * 1.025, l: last * 1.005 }];
  const f = setupFigures(bars(seq));
  assert.equal(f.hgD, 0);
  assert.ok(codes(bars(seq)).has('HG'));
  const noBreak = [...tr, touch, { c: last * 1.0, o: last * 1.005, h: last * 1.01, l: last * 0.995 }];
  assert.equal(setupFigures(bars(noBreak)).hgD, null, 'the next bar stayed under the touch bar\'s high');
  // a flat market has no ADX ≥ 30
  const fl = [...flat(60, 100), { c: 100, h: 100.5, l: 99 }, { c: 101, h: 102, l: 100 }];
  assert.equal(setupFigures(bars(fl)).hgD, null);
});

test('zzz1020 Wyckoff spring: dip ≤ 5% under a 20+ bar support, back above within 3 bars on volume', () => {
  const range = flat(90, 102, { h: 104, l: 100 });
  let f = setupFigures(bars([...range, { c: 99, o: 101, h: 101, l: 97 }, { c: 101, o: 99, h: 102, l: 98.5, v: 2_000_000 }]));
  assert.equal(f.sprD, 0);
  f = setupFigures(bars([...range, { c: 99, o: 101, h: 101, l: 97 }, { c: 101, o: 99, h: 102, l: 98.5, v: 500_000 }]));
  assert.equal(f.sprD, null, 'no volume on the recovery');
  f = setupFigures(bars([...range, { c: 93, o: 101, h: 101, l: 92 }, { c: 101, o: 93, h: 102, l: 92.5, v: 2_000_000 }]));
  assert.equal(f.sprD, null, 'a dip of 8% is a breakdown, not a spring');
  f = setupFigures(bars([...range, { c: 99, o: 101, h: 101, l: 97 }, ...flat(3, 98.5, { h: 99.5, l: 97.5 }), { c: 101, v: 2_000_000 }]));
  assert.equal(f.sprD, null, 'back above only after 4 bars');
});

test('zzz1020 up/down volume, ATR extension, TD count', () => {
  const alt: Spec[] = Array.from({ length: 60 }, (_, i) => (i % 2 ? { c: 101, v: 2_000_000 } : { c: 100, v: 1_000_000 }));
  assert.equal(setupFigures(bars(alt)).udv, 2);
  assert.equal(setupFigures(bars(rising(60, 50, 0.01))).udv, null, 'no down days');
  const f = setupFigures(bars(rising(80, 50, 0.01)));
  assert.ok(f.x50A != null && f.x50A > 0 && f.x10A != null && f.x10A > 0 && f.x50A > f.x10A);
  assert.equal(setupFigures(bars([...flat(10, 100), ...rising(9, 101, 0.01)])).td9, 9);
  assert.equal(setupFigures(bars([...flat(10, 100), ...rising(10, 101, 0.01)])).td9, 1, 'starts over after 9');
  assert.equal(setupFigures(bars([...flat(10, 100), ...rising(3, 99, -0.01)])).td9, -3);
});

test('zzz1022d — the "52-week high" look-back is one year on weekly candles (52 bars), not 252 bars', async () => {
  const { setupSeries } = await import('../setups');
  const WEEK = 7 * 86_400_000;
  // 80 weekly bars: flat at 100, then a close above every earlier high on the last bar
  const bars = Array.from({ length: 80 }, (_, i) => { const c = i === 79 ? 110 : 100 + (i % 3); return { t: i * WEEK, o: c, h: c + 1, l: c - 1, c, v: 1000 }; });
  const daily = setupSeries(bars).events.filter((e) => e.code === 'NH');
  const weekly = setupSeries(bars, { yearBars: 52 }).events.filter((e) => e.code === 'NH');
  assert.equal(daily.length, 0, '252 bars are not there yet');
  assert.ok(weekly.some((e) => e.i === 79), 'a new 52-week high on weekly candles');
});
