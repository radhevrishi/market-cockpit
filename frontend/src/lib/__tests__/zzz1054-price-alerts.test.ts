// zzz1054 — price alerts (TradingView-style "Create alert on <watchlist>"), India + USA: conditions, crossings, sessions and
// holidays, trigger dedupe, expiry, list expansion, message template, market-qualified ids, API protection, migration, scheduler.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalCondition, evalAll, figuresFromBars, liveMa, liveRsi, moveBase, needsDaily, type DailyFigs, type LiveQuote } from '../alerts/conditions';
import { sessionOpen, anySessionOpen, nyseHolidays, isNyseHoliday, barKey, marketDate, regularStarted } from '../alerts/session';
import { dedupeKey, isExpired, statusAfterFire, renderMessage, isLive } from '../alerts/trigger';
import { expandTarget, unwrapStored, sourcesNeeded } from '../alerts/targets';
import { evaluateAlerts, firedKey, type EvalCtx } from '../alerts/evaluate';
import { sanitizeAlertInput, parseMid, toMid, yahooSymbol, condLabel, type PriceAlert, type AlertCondition } from '../alerts/types';
import { dailyFetchPlan, externalMessage } from '../alerts/engine';
import { smaOf, rsiOf } from '../screener/tech';
import { NYSE_HOLIDAYS } from '../trading-calendar';
import { isProtectedApi } from '../site-auth';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { LIGHT_JOBS, APP_JOBS, parseCron, prevSlot, lightHeartbeatDue, staleAfterHoursFor } from '../app-scheduler';

const at = (s: string) => new Date(s);
const noHol = () => false;
const closes = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
const figs = (over: Partial<DailyFigs> = {}): DailyFigs => ({ asOf: '2026-10-14', day: null, open: null, c: closes(260, (i) => 100 + i * 0.1), hi52: 150, lo52: 90, avgVol50: 1_000_000, wc: closes(60, (i) => 90 + i), ...over });
const q = (price: number, over: Partial<LiveQuote> = {}): LiveQuote => ({ price, prevClose: 100, volume: 500_000, dayHigh: price, dayLow: price, ...over });
const T = '2026-10-15';

describe('conditions', () => {
  test('price crossing: first sighting only records; then up / down / either', () => {
    const c: AlertCondition = { type: 'price_cross_up', value: 105 };
    const first = evalCondition(c, q(106), null, undefined, 'D', T);
    assert.equal(first.met, false); assert.equal(first.known, true); assert.equal(first.state, 1);
    assert.equal(evalCondition(c, q(106), null, -2, 'D', T).met, true, 'was below, now above');
    assert.equal(evalCondition(c, q(106), null, 0, 'D', T).met, true, 'touching the level then above counts as a cross up');
    assert.equal(evalCondition(c, q(106), null, 3, 'D', T).met, false, 'already above: no cross');
    const down: AlertCondition = { type: 'price_cross_down', value: 105 };
    assert.equal(evalCondition(down, q(104), null, 1, 'D', T).met, true);
    assert.equal(evalCondition(down, q(106), null, -1, 'D', T).met, false);
    const any: AlertCondition = { type: 'price_cross', value: 105 };
    assert.equal(evalCondition(any, q(104), null, 1, 'D', T).met, true);
    assert.equal(evalCondition(any, q(106), null, -1, 'D', T).met, true);
    assert.equal(evalCondition(any, q(106), null, 2, 'D', T).met, false);
  });
  test('greater / less than', () => {
    assert.equal(evalCondition({ type: 'price_above', value: 100 }, q(101), null, undefined, 'D', T).met, true);
    assert.equal(evalCondition({ type: 'price_above', value: 100 }, q(100), null, undefined, 'D', T).met, false);
    assert.equal(evalCondition({ type: 'price_below', value: 100 }, q(99), null, undefined, 'D', T).met, true);
  });
  test('moving up / down % in N bars (1 bar = previous close; W uses completed weekly closes)', () => {
    assert.equal(evalCondition({ type: 'move_up_pct', value: 1, bars: 1 }, q(101), null, undefined, 'D', T).met, true);
    assert.equal(evalCondition({ type: 'move_up_pct', value: 1, bars: 1 }, q(100.9), null, undefined, 'D', T).met, false);
    assert.equal(evalCondition({ type: 'move_down_pct', value: 2, bars: 1 }, q(97.9), null, undefined, 'D', T).met, true);
    const f = figs({ c: [100, 110, 120, 130] });
    assert.equal(moveBase(q(130), f, 3, 'D'), 110, '3 bars back');
    assert.equal(evalCondition({ type: 'move_up_pct', value: 18, bars: 3 }, q(130), f, undefined, 'D', T).met, true);   // +18.2%
    assert.equal(evalCondition({ type: 'move_up_pct', value: 5, bars: 3 }, q(130), null, undefined, 'D', T).known, false, 'no figures → waits');
    const fw = figs({ wc: [100, 120] });
    assert.equal(evalCondition({ type: 'move_up_pct', value: 10, bars: 1 }, q(132), fw, undefined, 'W', T).met, true, 'vs last completed week');
    assert.equal(evalCondition({ type: 'move_up_pct', value: 10, bars: 2 }, q(105), fw, undefined, 'W', T).met, false);
    assert.equal(needsDaily({ type: 'move_up_pct', value: 1, bars: 1 }, 'D'), false);
    assert.equal(needsDaily({ type: 'move_up_pct', value: 1, bars: 1 }, 'W'), true);
  });
  test('moving-average crossing uses the live price as the current bar', () => {
    const c = closes(260, () => 100);
    assert.equal(liveMa('SMA', 50, c, 149), (49 * 100 + 149) / 50);
    assert.equal(liveMa('SMA', 200, c.slice(0, 100), 1), null, 'not enough bars');
    const e = liveMa('EMA', 20, c, 121)!;
    assert.ok(Math.abs(e - (121 * (2 / 21) + 100 * (19 / 21))) < 1e-9);
    const f = figs({ c });
    const up: AlertCondition = { type: 'ma_cross_up', ma: 'SMA', len: 50 };
    const r0 = evalCondition(up, q(99), f, undefined, 'D', T);
    assert.ok(r0.state! < 0);
    assert.equal(evalCondition(up, q(102), f, r0.state, 'D', T).met, true);
    assert.equal(evalCondition({ type: 'ma_cross_down', ma: 'EMA', len: 200 }, q(98), f, 1, 'D', T).met, true);
  });
  test('new 52-week high / low (day high / low count), near the high', () => {
    const f = figs({ hi52: 150, lo52: 90 });
    assert.equal(evalCondition({ type: 'high_52w' }, q(149, { dayHigh: 151 }), f, undefined, 'D', T).met, true, 'made the high earlier today');
    assert.equal(evalCondition({ type: 'high_52w' }, q(149, { dayHigh: 149.5 }), f, undefined, 'D', T).met, false);
    assert.equal(evalCondition({ type: 'low_52w' }, q(91, { dayLow: 89 }), f, undefined, 'D', T).met, true);
    assert.equal(evalCondition({ type: 'near_52w_high', value: 5 }, q(143), f, undefined, 'D', T).met, true);   // 4.7% below
    assert.equal(evalCondition({ type: 'near_52w_high', value: 5 }, q(140), f, undefined, 'D', T).met, false);
    assert.equal(evalCondition({ type: 'high_52w' }, q(149), figs({ hi52: null }), undefined, 'D', T).known, false);
  });
  test('gap up / down only with TODAY\'s open', () => {
    const f = figs({ c: [100], day: T, open: 104 });
    assert.equal(evalCondition({ type: 'gap_up', value: 3 }, q(105), f, undefined, 'D', T).met, true);
    assert.equal(evalCondition({ type: 'gap_up', value: 5 }, q(105), f, undefined, 'D', T).met, false);
    assert.equal(evalCondition({ type: 'gap_up', value: 3 }, q(105), { ...f, day: '2026-10-14' }, undefined, 'D', T).known, false, "yesterday's open is never used");
    assert.equal(evalCondition({ type: 'gap_down', value: 3 }, q(95), figs({ c: [100], day: T, open: 96 }), undefined, 'D', T).met, true);
  });
  test('relative volume and RSI crossing', () => {
    assert.equal(evalCondition({ type: 'rel_volume', value: 2 }, q(100, { volume: 2_100_000 }), figs(), undefined, 'D', T).met, true);
    assert.equal(evalCondition({ type: 'rel_volume', value: 2 }, q(100, { volume: null }), figs(), undefined, 'D', T).known, false);
    const c = closes(100, (i) => 100 + (i % 2 ? 1 : -1));
    assert.ok(Math.abs(liveRsi(c, 100)! - rsiOf([...c, 100], 14)!) < 1e-12);
    const r = evalCondition({ type: 'rsi_cross_up', value: 70 }, q(140), figs({ c }), -5, 'D', T);
    assert.equal(r.met, true, 'a big jump lifts RSI over 70 from below');
    assert.equal(evalCondition({ type: 'rsi_cross_up', value: 70 }, q(140), figs({ c }), undefined, 'D', T).met, false, 'first sighting');
  });
  test('AND: all must be known and met; states kept for every condition', () => {
    const conds: AlertCondition[] = [{ type: 'price_above', value: 100 }, { type: 'price_cross_up', value: 110 }];
    const r1 = evalAll(conds, q(111), null, [], 'D', T);
    assert.equal(r1.met, false); assert.equal(r1.states[1], 1);
    assert.equal(evalAll(conds, q(111), null, [undefined, -1], 'D', T).met, true);
    assert.equal(evalAll([...conds, { type: 'high_52w' }], q(111), null, [undefined, -1], 'D', T).met, false, 'unknown blocks');
    assert.equal(evalCondition({ type: 'price_above', value: 1 }, q(NaN), null, undefined, 'D', T).known, false);
  });
});

describe('daily figures from bars', () => {
  const d = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
  const bars = { d, o: d.map((_, i) => 100 + i), h: d.map((_, i) => 102 + i), l: d.map((_, i) => 98 + i), c: d.map((_, i) => 101 + i), v: d.map(() => 1000) };
  test("today's bar is left out of the completed set; its open is today's open; weekly closes skip the current week", () => {
    const f = figuresFromBars(bars, '2026-10-15')!;
    assert.equal(f.asOf, '2026-10-14'); assert.equal(f.day, '2026-10-15'); assert.equal(f.open, 108);
    assert.deepEqual(f.c, [101, 102, 103, 104, 105, 106, 107, 108]);
    assert.deepEqual(f.wc, [105], 'week of 5 Oct closed at 105; the week of 12 Oct is current');
    assert.equal(f.hi52, null, 'fewer than 20 bars');
    const g = figuresFromBars(bars, '2026-10-16')!;
    assert.equal(g.day, null); assert.equal(g.c.length, 9, "before today's session every bar is complete");
    assert.equal(figuresFromBars(bars, '2026-10-14'), null, 'bars from the future → unusable');
  });
  test('52-week window and 50-day volume', () => {
    const n = 300;
    const dd = closes(n, (i) => i).map((i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
    const b = { d: dd, o: closes(n, () => 10), h: closes(n, (i) => (i === 10 ? 999 : 20 + i * 0.01)), l: closes(n, (i) => (i === 10 ? 1 : 10)), c: closes(n, () => 15), v: closes(n, (i) => (i >= n - 50 ? 200 : 100)) };
    const f = figuresFromBars(b, '2030-01-01')!;
    assert.ok(f.hi52! < 999, 'a high from more than 252 bars ago is outside the window');
    assert.equal(f.avgVol50, 200);
    assert.equal(f.c.length, 260);
    assert.equal(smaOf(f.c, 50), 15);
  });
});

describe('sessions and holidays', () => {
  test('India regular 09:15–15:30 IST, extended 09:00–16:00, weekends and NSE holidays closed', () => {
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-15T03:44:00Z'), noHol), false);   // 09:14 IST
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-15T03:45:00Z'), noHol), true);    // 09:15
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-15T10:00:00Z'), noHol), true);    // 15:30
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-15T10:01:00Z'), noHol), false);
    assert.equal(sessionOpen('IN', 'extended', at('2026-10-15T03:30:00Z'), noHol), true);   // 09:00
    assert.equal(sessionOpen('IN', 'extended', at('2026-10-15T10:20:00Z'), noHol), true);   // 15:50
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-17T05:00:00Z'), noHol), false, 'Saturday');
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-20T05:00:00Z'), (d) => d === '2026-10-20'), false, 'NSE holiday');
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-20T05:00:00Z'), noHol), true);
  });
  test('USA regular 09:30–16:00 New York with daylight saving, extended 04:00–20:00', () => {
    assert.equal(sessionOpen('US', 'regular', at('2026-10-15T13:30:00Z')), true);    // 09:30 EDT
    assert.equal(sessionOpen('US', 'regular', at('2026-10-15T13:29:00Z')), false);
    assert.equal(sessionOpen('US', 'regular', at('2026-10-15T20:00:00Z')), false);   // 16:00
    assert.equal(sessionOpen('US', 'regular', at('2026-12-15T14:30:00Z')), true);    // 09:30 EST
    assert.equal(sessionOpen('US', 'regular', at('2026-12-15T13:30:00Z')), false);
    assert.equal(sessionOpen('US', 'extended', at('2026-10-15T08:00:00Z')), true);   // 04:00 EDT
    assert.equal(sessionOpen('US', 'extended', at('2026-10-15T23:59:00Z')), true);   // 19:59
    assert.equal(sessionOpen('US', 'extended', at('2026-10-16T00:00:00Z')), false);  // 20:00
    assert.equal(sessionOpen('US', 'regular', at('2026-11-26T15:00:00Z')), false, 'Thanksgiving');
    assert.equal(anySessionOpen(at('2026-10-17T12:00:00Z'), noHol), false, 'Saturday noon UTC');
    assert.equal(anySessionOpen(at('2026-10-15T05:00:00Z'), noHol), true);
  });
  test('NYSE holidays worked out by rule match the published 2025 and 2026 lists', () => {
    for (const y of [2025, 2026]) {
      const published = [...NYSE_HOLIDAYS].filter((d) => d.startsWith(`${y}-`)).sort();
      assert.deepEqual([...nyseHolidays(y)].sort(), published, String(y));
    }
    assert.ok(isNyseHoliday('2027-03-26'), 'Good Friday 2027');
    assert.ok(isNyseHoliday('2027-07-05'), 'Independence Day 2027 observed Monday');
    assert.ok(!isNyseHoliday('2021-12-31'), 'a Saturday New Year is not moved back to Friday');
  });
  test('bar keys and market dates', () => {
    assert.equal(marketDate('IN', at('2026-10-15T20:00:00Z')), '2026-10-16');
    assert.equal(marketDate('US', at('2026-10-16T02:00:00Z')), '2026-10-15');
    assert.equal(barKey('IN', 'D', at('2026-10-15T05:00:00Z')), '2026-10-15');
    assert.equal(barKey('US', 'W', at('2026-10-15T15:00:00Z')), 'W2026-10-12');
    assert.equal(barKey('US', 'W', at('2026-10-18T15:00:00Z')), 'W2026-10-12', 'Sunday belongs to the Monday-started week');
    assert.equal(regularStarted('IN', at('2026-10-15T03:40:00Z'), noHol), false);
    assert.equal(regularStarted('IN', at('2026-10-15T08:00:00Z'), noHol), true);
  });
});

describe('triggers, expiry, template', () => {
  test('dedupe keys per mode', () => {
    const now = at('2026-10-15T05:31:20Z');
    assert.equal(dedupeKey('once', 'IN', 'D', now), 'once');
    assert.equal(dedupeKey('per_bar', 'IN', 'D', now), 'bar:2026-10-15');
    assert.equal(dedupeKey('per_bar', 'US', 'W', now), 'bar:W2026-10-12');
    assert.equal(dedupeKey('per_minute', 'IN', 'D', now), 'min:2026-10-15T05:31');
    assert.notEqual(dedupeKey('per_minute', 'IN', 'D', now), dedupeKey('per_minute', 'IN', 'D', at('2026-10-15T05:32:00Z')));
  });
  test('expiry and status after a fire', () => {
    assert.equal(isExpired(null, at('2030-01-01T00:00:00Z')), false, 'open-ended');
    assert.equal(isExpired('2026-10-15T00:00:00Z', at('2026-10-15T00:00:01Z')), true);
    assert.equal(isLive({ status: 'active', expiresAt: '2026-11-01T00:00:00Z' }, at('2026-10-15T00:00:00Z')), true);
    assert.equal(isLive({ status: 'paused', expiresAt: null }, at('2026-10-15T00:00:00Z')), false);
    assert.equal(statusAfterFire({ trigger: 'once', target: { kind: 'ticker', id: 'IN:HAL' } }), 'triggered');
    assert.equal(statusAfterFire({ trigger: 'once', target: { kind: 'chart-list', id: 'l1' } }), 'active', 'a list keeps watching other members');
    assert.equal(statusAfterFire({ trigger: 'per_bar', target: { kind: 'ticker', id: 'IN:HAL' } }), 'active');
  });
  test('message template', () => {
    const m = renderMessage('{{ticker}}, {{interval}} {{condition}} · {{name}} {{price}} {{change}} on {{list}} ({{exchange}}) {{time}} {{unknown}}', {
      ticker: 'HAL', name: 'Hindustan Aeronautics', price: 4123.5, change: 2.345, condition: 'Moving Up 1% in 1 bar', list: 'Defence', time: at('2026-10-15T05:31:00Z'), interval: 'D', exchange: 'NSE', market: 'IN',
    });
    assert.equal(m, 'HAL, 1D Moving Up 1% in 1 bar · Hindustan Aeronautics ₹4123.50 +2.35% on Defence (NSE) 15 Oct, 11:01 IST {{unknown}}');
    assert.match(renderMessage('{{price}} {{time}}', { ticker: 'HAL', price: 12.5, condition: 'x', time: at('2026-10-15T15:00:00Z'), interval: 'W', exchange: 'US', market: 'US' }), /^\$12\.50 15 Oct, 11:00 ET$/);
    assert.equal(renderMessage('{{list}}', { ticker: 'HAL', condition: 'x', time: new Date(), interval: 'D', exchange: 'NSE', market: 'IN' }), 'HAL', 'single ticker: list = ticker');
  });
});

describe('market-qualified ids — India and USA kept apart', () => {
  test('ids, Yahoo symbols', () => {
    assert.equal(toMid('IN', 'NSE:hal'), 'IN:HAL');
    assert.equal(toMid('IN', 'HAL.NS'), 'IN:HAL');
    assert.equal(toMid('IN', '532540'), 'IN:BSE:532540');
    assert.equal(toMid('IN', 'TATVA', 'BSE'), 'IN:BSE:TATVA');
    assert.equal(toMid('US', 'NASDAQ:nvda'), 'US:NVDA');
    assert.equal(toMid('US', '1BAD'), null);
    assert.equal(yahooSymbol('IN:HAL'), 'HAL.NS');
    assert.equal(yahooSymbol('IN:BSE:532540'), '532540.BO');
    assert.equal(yahooSymbol('US:BRK.B'), 'BRK-B');
    assert.deepEqual(parseMid('US:HAL'), { market: 'US', ticker: 'HAL', bse: false });
    assert.equal(parseMid('HAL'), null);
  });
  test('the same symbol in two markets: separate quotes, states and events', () => {
    const alert = (id: string, mid: string): PriceAlert => ({
      id, name: id, target: { kind: 'ticker', id: mid }, conditions: [{ type: 'price_above', value: 100 }], interval: 'D', trigger: 'per_bar',
      session: 'regular', expiresAt: null, message: '{{ticker}} {{condition}}', notify: { app: true, toast: true, browser: false, telegram: false, email: false },
      status: 'active', createdAt: '', updatedAt: '', version: 1, lastFiredAt: null, fireCount: 0,
    });
    const both = at('2026-10-15T14:00:00Z');   // 19:30 IST (India closed) / 10:00 New York (open)
    const ctx: EvalCtx = {
      now: both, quotes: new Map([['IN:HAL', q(150)], ['US:HAL', q(50, { marketTime: both.getTime() })]]), daily: new Map(), prev: new Map(), firedKeys: new Set(),
      expansions: new Map([['a', { mids: ['IN:HAL'], label: 'HAL' }], ['b', { mids: ['US:HAL'], label: 'HAL' }]]), isNseHoliday: noHol,
    };
    const r = evaluateAlerts([alert('a', 'IN:HAL'), alert('b', 'US:HAL')], ctx);
    assert.equal(r.events.length, 0, 'India closed; US:HAL at 50 is not above 100 (India\'s 150 never leaks in)');
    assert.equal(r.closed, 1);
    const india = at('2026-10-15T05:00:00Z');
    const r2 = evaluateAlerts([alert('a', 'IN:HAL'), alert('b', 'US:HAL')], { ...ctx, now: india });
    assert.deepEqual(r2.events.map((e) => e.mid), ['IN:HAL']);
    assert.equal(r2.events[0].market, 'IN');
  });
});

describe('evaluation pass: dedupe, sessions, stale quotes, lists', () => {
  const base = (over: Partial<PriceAlert> = {}): PriceAlert => ({
    id: 'a1', name: 'Breakouts', target: { kind: 'chart-list', id: 'l1' }, conditions: [{ type: 'move_up_pct', value: 1, bars: 1 }], interval: 'D',
    trigger: 'per_bar', session: 'regular', expiresAt: null, message: '{{ticker}}, {{interval}} {{condition}}',
    notify: { app: true, toast: true, browser: false, telegram: true, email: false }, status: 'active', createdAt: '', updatedAt: '', version: 3, lastFiredAt: null, fireCount: 0, ...over,
  });
  const now = at('2026-10-15T05:00:00Z');
  const mk = (over: Partial<EvalCtx> = {}): EvalCtx => ({
    now, quotes: new Map([['IN:HAL', q(102)], ['IN:BEL', q(100.5)], ['US:NVDA', q(105)]]), daily: new Map(), prev: new Map(), firedKeys: new Set(),
    expansions: new Map([['a1', { mids: ['IN:HAL', 'IN:BEL', 'US:NVDA'], label: 'Swing' }]]), isNseHoliday: noHol, ...over,
  });
  test('per bar: fires once per ticker per day; the list name and message are filled in', () => {
    const ctx = mk();
    const r = evaluateAlerts([base()], ctx);
    assert.deepEqual(r.events.map((e) => e.mid), ['IN:HAL'], 'BEL only +0.5%; NVDA session closed (01:00 New York)');
    assert.equal(r.events[0].dedupeKey, 'bar:2026-10-15');
    assert.equal(r.events[0].message, 'HAL, 1D Moving Up 1% in 1 bar');
    assert.equal(r.events[0].list, 'Swing');
    assert.equal(r.closed, 1);
    assert.equal(evaluateAlerts([base()], { ...ctx, now: at('2026-10-15T05:01:00Z') }).events.length, 0, 'same bar → no second event');
    assert.equal(evaluateAlerts([base()], { ...ctx, now: at('2026-10-16T05:00:00Z') }).events.length, 1, 'next day fires again');
  });
  test('per minute: once a minute while true', () => {
    const ctx = mk();
    const a = base({ trigger: 'per_minute' });
    assert.equal(evaluateAlerts([a], ctx).events.length, 1);
    assert.equal(evaluateAlerts([a], ctx).events.length, 0, 'same minute');
    assert.equal(evaluateAlerts([a], { ...ctx, now: at('2026-10-15T05:01:00Z') }).events.length, 1);
    assert.ok(ctx.firedKeys.has(firedKey('a1', 'IN:HAL', 'min:2026-10-15T05:00')));
  });
  test('once: per ticker on a list; crossings remembered per alert version', () => {
    const ctx = mk();
    const a = base({ trigger: 'once', conditions: [{ type: 'price_cross_up', value: 101 }] });
    assert.equal(evaluateAlerts([a], ctx).events.length, 0, 'first sighting');
    ctx.quotes.set('IN:BEL', q(101.5));
    const r = evaluateAlerts([a], { ...ctx, now: at('2026-10-15T05:01:00Z') });
    assert.deepEqual(r.events.map((e) => [e.mid, e.dedupeKey]), [['IN:BEL', 'once']]);
    const edited = { ...a, version: 4 };
    assert.equal(evaluateAlerts([edited], { ...ctx, now: at('2026-10-15T05:02:00Z') }).events.length, 0, 'an edit starts fresh (no remembered side)');
  });
  test('stale quote during the session waits; paused / expired alerts are skipped; extended US uses the pre/after price', () => {
    const old = mk({ quotes: new Map([['IN:HAL', q(102, { marketTime: now.getTime() - 25 * 60_000 })]]) });
    const r = evaluateAlerts([base()], old);
    assert.equal(r.events.length, 0); assert.ok(r.waiting >= 1);
    assert.equal(evaluateAlerts([base({ status: 'paused' })], mk()).events.length, 0);
    assert.equal(evaluateAlerts([base({ expiresAt: '2026-10-01T00:00:00Z' })], mk()).events.length, 0);
    const pre = at('2026-10-15T12:00:00Z');   // 08:00 New York: pre-market
    const ext = mk({ now: pre, quotes: new Map([['US:NVDA', { ...q(100), extPct: 3 } as any]]), expansions: new Map([['a1', { mids: ['US:NVDA'], label: 'x' }]]) });
    assert.equal(evaluateAlerts([base({ session: 'regular' })], ext).events.length, 0, 'regular session only');
    const e = evaluateAlerts([base({ session: 'extended' })], ext).events;
    assert.equal(e.length, 1); assert.ok(Math.abs(e[0].price! - 103) < 1e-9);
  });
});

describe('watchlist expansion (current members)', () => {
  const store = { lists: [{ id: 'l1', name: 'Swing', sections: [{ id: 's', items: [{ m: 'IN', t: 'HAL' }, { m: 'US', t: 'HAL' }, { m: 'IN', t: '532540', x: 'BSE' }, { m: 'IN', t: 'HAL' }, { m: 'XX', t: 'Z' }] }] }] };
  test('chart list (stored as {__raw}), duplicates dropped, India and US both kept', () => {
    const r = expandTarget({ kind: 'chart-list', id: 'l1' }, { chartStore: { __raw: JSON.stringify(store) } });
    assert.deepEqual(r.mids, ['IN:HAL', 'US:HAL', 'IN:BSE:532540']);
    assert.equal(r.label, 'Swing');
    assert.match(expandTarget({ kind: 'chart-list', id: 'gone' }, { chartStore: store }).error!, /deleted/);
  });
  test('other lists', () => {
    assert.deepEqual(expandTarget({ kind: 'watchlist' }, { watchlist: { parsed: ['NSE:HAL', 'bel.ns', { ticker: 'IRCON' }] } }).mids, ['IN:HAL', 'IN:BEL', 'IN:IRCON']);
    assert.deepEqual(expandTarget({ kind: 'book-in' }, { holdingsIn: [{ symbol: 'TATVA' }] }).mids, ['IN:TATVA']);
    assert.deepEqual(expandTarget({ kind: 'cb-in' }, { cbIn: { HAL: { ticker: 'HAL' }, BEL: { ticker: 'BEL' } } }).mids, ['IN:HAL', 'IN:BEL']);
    assert.deepEqual(expandTarget({ kind: 'cb-us' }, { cbUs: { 'NVDA|Q3': { ticker: 'NVDA' }, 'NVDA|Q2': { ticker: 'NVDA' } } }).mids, ['US:NVDA']);
    assert.deepEqual(expandTarget({ kind: 'book-us' }, { usBook: ['AAPL', 'HAL'] }).mids, ['US:AAPL', 'US:HAL']);
    assert.match(expandTarget({ kind: 'book-us' }, { usBook: null }).error!, /could not be read/);
    assert.deepEqual(expandTarget({ kind: 'ticker', id: 'US:HAL' }, {}).mids, ['US:HAL']);
    assert.deepEqual([...sourcesNeeded([{ kind: 'chart-list', id: 'x' }, { kind: 'ticker', id: 'IN:HAL' }, { kind: 'book-us' }])].sort(), ['chartStore', 'usBook']);
    assert.equal(unwrapStored('["A"]')!.toString(), 'A');
  });
});

describe('input check', () => {
  const now = at('2026-10-15T00:00:00Z');
  test('defaults: 1 day, once per bar, regular, +30 days, TradingView-style message and name', () => {
    const r = sanitizeAlertInput({ target: { kind: 'chart-list', id: 'l1', label: 'Swing' }, conditions: [{ type: 'move_up_pct', value: '1' }] }, now);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.alert.interval, 'D'); assert.equal(r.alert.trigger, 'per_bar'); assert.equal(r.alert.session, 'regular');
    assert.equal(r.alert.expiresAt, '2026-11-14T00:00:00.000Z');
    assert.equal(r.alert.message, '{{ticker}}, {{interval}} {{condition}}');
    assert.equal(r.alert.name, 'Swing · Moving Up 1% in 1 bar');
    assert.deepEqual(r.alert.conditions, [{ type: 'move_up_pct', value: 1, bars: 1 }]);
    assert.equal(r.alert.notify.app, true);
    const open = sanitizeAlertInput({ target: { kind: 'ticker', id: 'us:nvda' }, conditions: [{ type: 'high_52w' }], expiresAt: null }, now);
    assert.ok(open.ok && open.alert.expiresAt === null && open.alert.target.id === 'US:NVDA');
  });
  test('refusals', () => {
    const bad = (x: unknown) => { const r = sanitizeAlertInput(x, now); assert.equal(r.ok, false); return r.ok ? '' : r.error; };
    assert.match(bad({ target: { kind: 'ticker', id: 'HAL' }, conditions: [{ type: 'high_52w' }] }), /market-qualified/);
    assert.match(bad({ target: { kind: 'watchlist' }, conditions: [] }), /at least one/);
    assert.match(bad({ target: { kind: 'watchlist' }, conditions: Array(6).fill({ type: 'high_52w' }) }), /at most 5/);
    assert.match(bad({ target: { kind: 'watchlist' }, conditions: [{ type: 'rsi_cross_up', value: 150 }] }), /between/);
    assert.match(bad({ target: { kind: 'watchlist' }, conditions: [{ type: 'ma_cross', ma: 'SMA', len: 33 }] }), /moving average/);
    assert.match(bad({ target: { kind: 'watchlist' }, conditions: [{ type: 'hack' }] }), /unknown condition/);
    assert.match(bad({ target: { kind: 'watchlist' }, conditions: [{ type: 'high_52w' }], expiresAt: '2020-01-01' }), /past/);
    assert.match(bad({ target: { kind: 'nope' }, conditions: [{ type: 'high_52w' }] }), /ticker or a watchlist/);
  });
  test('labels', () => {
    assert.equal(condLabel({ type: 'move_down_pct', value: 2.5, bars: 3 }, 'W'), 'Moving Down 2.5% in 3 weeks');
    assert.equal(condLabel({ type: 'ma_cross_up', ma: 'EMA', len: 20 }), 'Price crossing up EMA 20 (daily)');
  });
});

describe('checker plumbing', () => {
  test('daily figures fetch plan: gap alerts after the open first, then never fetched, then stale; retries spaced', () => {
    const now = at('2026-10-15T05:00:00Z');
    const f = (day: string | null) => ({ fetchedDay: '2026-10-15', figs: figs({ day }) });
    const have = new Map([['IN:A', f(null)], ['IN:B', { fetchedDay: '2026-10-14', figs: figs() }], ['IN:C', f('2026-10-15')]]);
    const needs = new Map([['IN:A', { open: true }], ['IN:B', { open: false }], ['IN:C', { open: true }], ['IN:D', { open: false }], ['IN:E', { open: false }]]);
    const plan = dailyFetchPlan(needs, have, now, new Map([['IN:E', now.getTime() - 60_000]]), 10, () => true);
    assert.deepEqual(plan, ['IN:A', 'IN:D', 'IN:B'], 'C has today\'s open; E tried a minute ago');
    assert.deepEqual(dailyFetchPlan(needs, have, now, new Map(), 1, () => true), ['IN:A']);
  });
  test('one external message per run', () => {
    const ev = (i: number) => ({ id: i, alertId: 'a', alertName: 'x', mid: 'IN:HAL', market: 'IN' as const, ticker: 'HAL', name: null, price: 100, changePct: 1, condition: 'c', list: 'Swing', message: `HAL m${i}`, firedAt: '', dedupeKey: '', read: false, toast: true, browser: false });
    const one = externalMessage([ev(1)])!;
    assert.equal(one.subject, '🔔 HAL: c'); assert.equal(one.text, '• HAL m1 — ₹100.00 (Swing)');
    const many = externalMessage(Array.from({ length: 35 }, (_, i) => ev(i)))!;
    assert.match(many.subject, /35 price alerts/); assert.match(many.text, /and 5 more/);
    assert.equal(externalMessage([]), null);
  });
  test('API is owner-only; migration 5 adds the tables with the dedupe index', () => {
    assert.ok(isProtectedApi('/api/v1/price-alerts'));
    assert.ok(isProtectedApi('/api/v1/price-alerts/anything'));
    assert.ok(migrationsValid());
    const m = MIGRATIONS.find((x) => x.name === 'price_alerts')!;
    assert.ok(m);
    for (const t of ['price_alert ', 'price_alert_event', 'price_alert_daily', 'price_alert_meta']) assert.ok(m.sql.includes(`CREATE TABLE IF NOT EXISTS ${t.trim()}`), t);
    assert.match(m.sql, /UNIQUE INDEX IF NOT EXISTS price_alert_event_dedupe_idx ON price_alert_event \(alert_id, mid, dedupe_key\)/);
    const route = readFileSync(join(__dirname, '../../app/api/v1/price-alerts/route.ts'), 'utf8');
    assert.match(route, /AlertStoreUnavailable[\s\S]*503/, 'a save that could not be written answers 503');
    const store = readFileSync(join(__dirname, '../alerts/store.ts'), 'utf8');
    assert.ok(!/from '@\/lib\/kv'/.test(store), 'no Redis in the alert store');
    const page = readFileSync(join(__dirname, '../../app/(dashboard)/price-alerts/page.tsx'), 'utf8');
    assert.ok(!/^export (?!default)/m.test(page), 'page file has only its default export');
  });
  test('scheduler: every-minute light job, no Redis lock, heartbeat throttled, weekend-aware staleness', () => {
    const j = LIGHT_JOBS.find((x) => x.name === 'price-alerts')!;
    assert.ok(j);
    for (const c of j.crons) assert.ok(parseCron(c), c);
    assert.ok(!APP_JOBS.some((x) => x.name === 'price-alerts'), 'not a slot job (those take Redis locks)');
    assert.equal(prevSlot(j.crons, at('2026-10-15T05:31:30Z'))!.toISOString(), '2026-10-15T05:31:00.000Z');
    assert.equal(prevSlot(j.crons, at('2026-10-17T00:30:30Z'))!.toISOString(), '2026-10-17T00:30:00.000Z', 'US Friday after-hours (Saturday UTC)');
    assert.equal(lightHeartbeatDue(undefined, true, 0, 15), true);
    assert.equal(lightHeartbeatDue({ at: 0, ok: true }, true, 14 * 60_000, 15), false);
    assert.equal(lightHeartbeatDue({ at: 0, ok: true }, false, 60_000, 15), true, 'ok flipped');
    assert.equal(lightHeartbeatDue({ at: 0, ok: true }, true, 15 * 60_000, 15), true);
    const stale = staleAfterHoursFor('price-alerts', 25, at('2026-10-15T00:00:00Z'))!;
    assert.ok(stale >= 50, `weekend gap allowed (${stale} h)`);
    const src = readFileSync(join(__dirname, '../alerts/engine.ts'), 'utf8');
    assert.ok(!/from '@\/lib\/kv'/.test(src), 'no Redis in the checker');
  });
});
