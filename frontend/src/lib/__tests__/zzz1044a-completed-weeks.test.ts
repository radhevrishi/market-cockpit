// zzz1044a — weekly Stage Analysis and weekly trader setups read COMPLETED exchange weeks only (F01 / F02). A week is complete
// after its Friday close (US 16:00 New York, India 15:30 IST) or once a bar of a later week exists. Synthetic series, made-up names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekComplete, weekCloseMs, completedWeekCount, lastCompletedWeekKey, completedWeekMap, sessionCloseMs } from '../completed-weeks';
import { weeklyBars, stageAnalysis, stageCompleted, stageFromDaily, benchWeekly } from '../stage-analysis';
import { tvFigures } from '../screener/tv-screens';
import { setupFigures } from '../setups';
import { techEntry, setupBarsOf, SETUP_VERSION } from '../screener/pine';
import type { DailyBars } from '../screener/tech';
import { stageFromCharts, stagePointsFor, stageBanner, provisionalText } from '../../components/charts/stage-view';
import { lastBarForming } from '../../components/charts/setup-view';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (s: string) => new Date(s);

/** Weekday daily bars from `from` to `to` (inclusive), close = price(date); skip = dates left out (holidays). */
function daily(from: string, to: string, price: (d: string, i: number) => number, skip: string[] = []): DailyBars {
  const b: DailyBars = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let i = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const wd = new Date(t).getUTCDay();
    const d = iso(t);
    if (wd === 0 || wd === 6 || skip.includes(d)) continue;
    const c = price(d, i++);
    b.d.push(d); b.o.push(c); b.h.push(c); b.l.push(c); b.c.push(c); b.v.push(1e6);
  }
  return b;
}
/** F01 reproducer: 40 complete weeks near 100 (29 Dec 2025 – 2 Oct 2026), a qualifying week ending Fri 9 Oct 2026 at 121, then
 *  later sessions at `after` (Monday 12 Oct only by default). */
function repro(to = '2026-10-12', after = 124, skip: string[] = [], from = '2025-12-29'): DailyBars {
  return daily(from, to, (d, i) => (d >= '2026-10-12' ? after : d >= '2026-10-05' ? 121 : 100 + 0.4 * Math.sin(i)), skip);
}
const MON_EVENING_US = at('2026-10-12T22:00:00Z');   // Monday after the New York close

test('the week clock: Friday close per market (US summer / winter time, India), later data, stale input', () => {
  assert.equal(new Date(weekCloseMs('2026-10-12', 'US')).toISOString(), '2026-10-16T20:00:00.000Z');   // 16:00 EDT
  assert.equal(new Date(weekCloseMs('2026-11-09', 'US')).toISOString(), '2026-11-13T21:00:00.000Z');   // 16:00 EST
  assert.equal(new Date(weekCloseMs('2026-10-12', 'IN')).toISOString(), '2026-10-16T10:00:00.000Z');   // 15:30 IST
  assert.equal(weekCloseMs('2026-10-14', 'US'), weekCloseMs('2026-10-12', 'US'), 'any day of the week names the same week');
  assert.equal(new Date(sessionCloseMs(Date.parse('2026-10-12T13:30:00Z'), 'US')).toISOString(), '2026-10-12T20:00:00.000Z');
  for (const now of ['2026-10-12T22:00:00Z', '2026-10-13T22:00:00Z', '2026-10-14T22:00:00Z', '2026-10-15T22:00:00Z', '2026-10-16T19:59:00Z']) {
    assert.equal(weekComplete('2026-10-12', 'US', at(now)), false, `US week open at ${now}`);
  }
  assert.equal(weekComplete('2026-10-12', 'US', at('2026-10-16T20:00:00Z')), true);
  assert.equal(weekComplete('2026-10-12', 'IN', at('2026-10-16T09:59:00Z')), false);
  assert.equal(weekComplete('2026-10-12', 'IN', at('2026-10-16T10:00:00Z')), true);
  assert.equal(weekComplete('2026-10-12', 'US', at('2026-10-16T10:30:00Z')), false, 'the India close is not the US close');
  assert.equal(weekComplete('2026-10-12', null, at('2026-10-16T10:30:00Z')), false, 'unknown market: the later (US) close');
  assert.equal(weekComplete('2026-10-12', 'US', at('2026-10-13T00:00:00Z'), true), true, 'a bar of a later week completes it');
  assert.equal(lastCompletedWeekKey('2026-10-14', 'US', at('2026-10-15T12:00:00Z')), '2026-10-05');
  assert.equal(lastCompletedWeekKey('2026-10-14', 'US', at('2026-10-19T12:00:00Z')), '2026-10-12', 'stale input ending midweek');
  assert.equal(completedWeekCount([{ wk: '2026-10-05' }, { wk: '2026-10-12' }], (w) => w.wk, 'US', MON_EVENING_US), 1);
});

test('F01 reproducer: Monday after a qualifying week does NOT confirm Stage 2 (Stage 1, Stage 2 pending)', () => {
  const b = repro();
  // the defect: every supplied bar read (the open week included) → Stage 2 confirmed on Monday 12 Oct, stage age 1
  const old = stageAnalysis(weeklyBars(b)).last!;
  assert.equal(old.stage, 2); assert.equal(old.confirmedEnd, '2026-10-12'); assert.equal(old.weeks, 1);
  // fixed: completed weeks only
  const w = stageFromDaily(b, null, { market: 'US', now: MON_EVENING_US })!;
  assert.equal(w.stage, 1); assert.equal(w.pending, 2); assert.equal(w.end, '2026-10-09');
  const tv = tvFigures(b, null, { market: 'US', now: MON_EVENING_US });
  assert.equal(tv.twSt, 1); assert.notEqual(tv.twWk, 1);
  // India alike (Monday 16:00 IST)
  const wi = stageFromDaily(b, null, { market: 'IN', now: at('2026-10-12T10:30:00Z') })!;
  assert.equal(wi.stage, 1); assert.equal(wi.pending, 2);
});

test('Monday–Thursday and Friday before the close cannot confirm; Friday after the close can (US and India)', () => {
  const thu = repro('2026-10-15');
  for (const now of ['2026-10-12T22:00:00Z', '2026-10-13T22:00:00Z', '2026-10-14T22:00:00Z', '2026-10-15T22:00:00Z']) {
    assert.equal(stageFromDaily(thu, null, { market: 'US', now: at(now) })!.stage, 1, now);
  }
  const fri = repro('2026-10-16');
  assert.equal(stageFromDaily(fri, null, { market: 'US', now: at('2026-10-16T19:00:00Z') })!.stage, 1, 'Fri 15:00 New York');
  const after = stageFromDaily(fri, null, { market: 'US', now: at('2026-10-16T20:30:00Z') })!;
  assert.equal(after.stage, 2); assert.equal(after.weeks, 1); assert.equal(after.confirmedEnd, '2026-10-16'); assert.equal(after.beganEnd, '2026-10-09');
  // India: 15:30 IST = 10:00 UTC
  assert.equal(stageFromDaily(fri, null, { market: 'IN', now: at('2026-10-16T09:45:00Z') })!.stage, 1);
  const inAfter = stageFromDaily(fri, null, { market: 'IN', now: at('2026-10-16T10:15:00Z') })!;
  assert.equal(inAfter.stage, 2); assert.equal(inAfter.confirmedEnd, '2026-10-16');
  assert.equal(tvFigures(fri, null, { market: 'IN', now: at('2026-10-16T10:15:00Z') }).twWk, 1);
});

test('holiday-shortened week (no Friday bar) completes at the Friday close; stale input ending midweek completes later', () => {
  const hol = repro('2026-10-16', 124, ['2026-10-16']);
  assert.equal(stageFromDaily(hol, null, { market: 'US', now: at('2026-10-16T19:00:00Z') })!.stage, 1);
  const done = stageFromDaily(hol, null, { market: 'US', now: at('2026-10-16T21:00:00Z') })!;
  assert.equal(done.stage, 2); assert.equal(done.confirmedEnd, '2026-10-15', 'confirmed at the Thursday close, its last session');
  const stale = repro('2026-10-14');
  assert.equal(stageFromDaily(stale, null, { market: 'US', now: at('2026-10-15T22:00:00Z') })!.stage, 1);
  const s2 = stageFromDaily(stale, null, { market: 'US', now: at('2026-10-19T12:00:00Z') })!;
  assert.equal(s2.stage, 2); assert.equal(s2.confirmedEnd, '2026-10-14');
});

test('benchmark: its open week is left out too; a lagging index uses its previous weekly close', () => {
  const b = repro('2026-10-09', 124, [], '2025-06-02');   // 70 weeks: enough for Mansfield RS (52 weekly ratios)
  const idx = daily('2024-06-03', '2026-10-12', (d, i) => (d >= '2026-10-12' ? 400 : 200 + i * 0.1));
  const full = benchWeekly(idx.d, idx.c);
  assert.ok(full.has('2026-10-12'));
  assert.equal(completedWeekMap(full, 'US', MON_EVENING_US)!.has('2026-10-12'), false);
  const cut = new Map(full); cut.delete('2026-10-12');
  const now = MON_EVENING_US;
  const withOpen = stageCompleted(weeklyBars(b), full, { market: 'US', now });
  const without = stageCompleted(weeklyBars(b), cut, { market: 'US', now });
  assert.ok(withOpen.last!.mrs != null);
  assert.deepEqual(withOpen.weeks, without.weeks);
  // the stock's own open week: the index's partial week can never be read with it
  const bm = repro('2026-10-12', 124, [], '2025-06-02');
  const r = stageCompleted(weeklyBars(bm), full, { market: 'US', now });
  assert.equal(r.last!.wk, '2026-10-05'); assert.equal(r.openWeek, '2026-10-12');
  // a lagging index (no bar for the stock's last completed week): its previous weekly close stands in
  const lag = new Map(cut); lag.delete('2026-10-05');
  const lr = stageCompleted(weeklyBars(b), lag, { market: 'US', now }).last!;
  assert.ok(lr.mrs != null);
});

test('historical prefix unchanged: the completed weeks read exactly as before', () => {
  const b = repro('2026-10-14');
  const weeks = weeklyBars(b);
  const all = stageAnalysis(weeks);
  const r = stageCompleted(weeks, null, { market: 'US', now: at('2026-10-14T22:00:00Z') });
  assert.equal(r.weeks.length, weeks.length - 1);
  assert.deepEqual(r.weeks, all.weeks.slice(0, -1));
  assert.deepEqual(r.weeks, stageAnalysis(weeks.slice(0, -1)).weeks);
  // when every week is complete nothing is cut
  const r2 = stageCompleted(weeks, null, { market: 'US', now: at('2026-10-19T00:00:00Z') });
  assert.deepEqual(r2.weeks, all.weeks); assert.equal(r2.openWeek, null);
});

test('chart overlay: confirmed stage from completed weeks; the open week only as "provisional (week not closed)"', () => {
  const b = repro();
  const timed = b.d.map((d, i) => ({ t: Date.parse(`${d}T13:30:00Z`), o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] }));
  const r = stageFromCharts(timed, null, 'US', MON_EVENING_US);
  assert.equal(r.last!.stage, 1); assert.equal(r.last!.pending, 2);
  assert.equal(r.provisional!.stage, 2);
  assert.match(provisionalText(r.last, r.provisional), /this week: Stage 2 .*provisional \(week not closed\)/);
  const banner = stageBanner('ready', r.last, false, undefined, true, r.changes, r.provisional);
  assert.match(banner.text, /^Stage 1 /); assert.match(banner.text, /provisional \(week not closed\)/);
  assert.equal(banner.stage, 1);
  const pts = stagePointsFor(timed.map((x) => x.t), r);
  assert.equal(pts[pts.length - 1][1], 1, 'the Monday candle keeps the confirmed Stage 1');
  assert.ok(!(r.changes || []).some((c) => c.to === 2), 'no Stage 2 mark');
  // after the Friday close the change is confirmed and painted; no provisional reading remains
  const f = repro('2026-10-16');
  const tf = f.d.map((d, i) => ({ t: Date.parse(`${d}T13:30:00Z`), o: f.o[i], h: f.h[i], l: f.l[i], c: f.c[i], v: f.v[i] }));
  const rf = stageFromCharts(tf, null, 'US', at('2026-10-16T20:30:00Z'));
  assert.equal(rf.last!.stage, 2); assert.equal(rf.provisional ?? null, null);
  const pf = stagePointsFor(tf.map((x) => x.t), rf);
  assert.equal(pf[pf.length - 1][1], 2, 'the confirming Friday candle shows Stage 2');
  assert.equal(pf[pf.length - 2][1], 1, 'the days before the confirming close keep Stage 1');
});

test('F02: 3 weeks tight cannot count the third week before its exchange close', () => {
  // a rise to 95 (ends Fri 18 Sep), then weeks closing 100 (25 Sep) and 100.5 (2 Oct), the open week at 101 (5–7 Oct)
  const b = daily('2026-04-06', '2026-10-07', (d, i) => (d >= '2026-10-05' ? 101 : d >= '2026-09-28' ? 100.5 : d >= '2026-09-21' ? 100 : 50 + i * 0.37));
  const bars = setupBarsOf(b);
  const midweek = setupFigures(bars, { market: 'US', now: at('2026-10-07T22:00:00Z') });
  assert.equal(midweek.wt3, null, 'two completed tight weeks only');
  const fri = setupFigures(setupBarsOf(daily('2026-04-06', '2026-10-09', (d, i) => (d >= '2026-10-05' ? 101 : d >= '2026-09-28' ? 100.5 : d >= '2026-09-21' ? 100 : 50 + i * 0.37))), { market: 'US', now: at('2026-10-09T20:30:00Z') });
  assert.equal(fri.wt3, 3); assert.equal(fri.wt3P, 101);
  // India: the 15:30 IST close
  const inBefore = setupFigures(setupBarsOf(daily('2026-04-06', '2026-10-09', (d, i) => (d >= '2026-10-05' ? 101 : d >= '2026-09-28' ? 100.5 : d >= '2026-09-21' ? 100 : 50 + i * 0.37))), { market: 'IN', now: at('2026-10-09T09:00:00Z') });
  assert.equal(inBefore.wt3, null);
});

test('F02: weekly breakout age (dc20W) advances only on completed weeks; a Monday-only breakout is not a breakout yet', () => {
  // reproducer: the Fri 9 Oct week broke out (a completed week → 0); Monday 12 Oct alone changes nothing
  const mon = setupFigures(setupBarsOf(repro()), { market: 'US', now: MON_EVENING_US });
  assert.equal(mon.dc20W, 0);
  const thu = setupFigures(setupBarsOf(repro('2026-10-15', 120)), { market: 'US', now: at('2026-10-15T22:00:00Z') });
  assert.equal(thu.dc20W, 0, 'still the 9 Oct week: the open week does not age it');
  const fri = setupFigures(setupBarsOf(repro('2026-10-16', 120)), { market: 'US', now: at('2026-10-16T20:30:00Z') });
  assert.equal(fri.dc20W, 1, 'one more COMPLETED week');
  // a breakout only on Monday (the week before stayed in the base): nothing on Monday, 0 once that week closes above
  const base = (to: string) => daily('2025-12-29', to, (d, i) => (d >= '2026-10-12' ? 124 : 100 + 0.4 * Math.sin(i)));
  assert.equal(setupFigures(setupBarsOf(base('2026-10-12')), { market: 'US', now: MON_EVENING_US }).dc20W, null);
  assert.equal(setupFigures(setupBarsOf(base('2026-10-16')), { market: 'US', now: at('2026-10-16T20:30:00Z') }).dc20W, 0);
});

test('screener entry: Stage + weekly setups agree on the same completed close; version bumped', () => {
  assert.equal(SETUP_VERSION, 4);
  const e = techEntry(repro(), null, false, null, { market: 'US', now: MON_EVENING_US });
  assert.equal((e as any).twSt, 1);
  assert.notEqual((e as any).twWk, 1);
  assert.equal((e as any).setV, 4);
  const f = techEntry(repro('2026-10-16'), null, false, null, { market: 'US', now: at('2026-10-16T20:30:00Z') });
  assert.equal((f as any).twSt, 2); assert.equal((f as any).twWk, 1);
});

test('chart setup wrapper: a weekly candle forms until the Friday close of its market', () => {
  const mon = Date.parse('2026-10-12T00:00:00Z');
  assert.equal(lastBarForming(mon, 'W', 'US', Date.parse('2026-10-16T19:00:00Z')), true);
  assert.equal(lastBarForming(mon, 'W', 'US', Date.parse('2026-10-16T20:30:00Z')), false);
  assert.equal(lastBarForming(mon, 'W', 'IN', Date.parse('2026-10-16T10:15:00Z')), false);
  assert.equal(lastBarForming(Date.parse('2026-10-12T03:45:00Z'), 'D', 'IN', Date.parse('2026-10-12T09:00:00Z')), true);
  assert.equal(lastBarForming(Date.parse('2026-10-12T03:45:00Z'), 'D', 'IN', Date.parse('2026-10-12T10:01:00Z')), false);
});
