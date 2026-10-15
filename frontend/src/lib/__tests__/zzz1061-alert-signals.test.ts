// zzz1061 — price alerts on the app's OWN signals (Stage Analysis, Cheat Entry, setups & patterns, volume & accumulation, results,
// guidance): state-change semantics, snapshot-change gating, India / US kept apart, the cheat-entry mapping, the dialog groups and
// templates, the migration.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  stepSignal, screenState, signalReading, consumeEdges, newSignalBook, signalKey, rowIndex, contentStamp, sourcesFor, SIGNAL_META,
  type SignalRow, type SignalFeeds, type SignalState, type SourceView,
} from '../alerts/signals';
import { resultsView } from '../alerts/signal-sources';
import { evaluateAlerts, type EvalCtx } from '../alerts/evaluate';
import { evalAll, needsDaily, type LiveQuote } from '../alerts/conditions';
import { sanitizeAlertInput, condLabel, COND_TYPES, SIGNAL_COND_TYPES, isSignalCond, type PriceAlert, type AlertCondition, type CondType } from '../alerts/types';
import { COND_GROUPS, condHelp, condName, ALERT_TEMPLATES } from '../alerts/dialog-meta';
import { cheatSetup } from '../cheat-entry-setup';
import { MIGRATIONS, migrationsValid } from '../db-migrate';

const at = (s: string) => new Date(s);
const noHol = () => false;
const BAR = '2026-10-15';
const read = (v: number | null, version: string | null = 's1') => ({ v, version });

describe('state-change semantics (stepSignal)', () => {
  test('first sighting only records; false → true fires; staying true does not re-fire', () => {
    const s1 = stepSignal('stage_2', 1, undefined, read(1, 's1'), BAR);
    assert.equal(s1.met, false, 'already true when first seen: no fire');
    assert.equal(s1.known, true);
    assert.deepEqual(s1.next, { v: 1, src: 's1', edge: null, ver: 1 });
    const off = stepSignal('stage_2', 1, undefined, read(0, 's1'), BAR);
    assert.equal(off.met, false);
    const on = stepSignal('stage_2', 1, off.next!, read(1, 's2'), BAR);
    assert.equal(on.met, true, 'false → true fires');
    assert.equal(on.next!.edge, BAR);
    assert.equal(on.changed, true);
    const still = stepSignal('stage_2', 1, { ...on.next!, edge: null }, read(1, 's3'), BAR);
    assert.equal(still.met, false, 'stays true (edge used up): no re-fire');
    const again = stepSignal('stage_2', 1, stepSignal('stage_2', 1, still.next!, read(0, 's4'), BAR).next!, read(1, 's5'), BAR);
    assert.equal(again.met, true, 'true → false → true fires again');
  });
  test('gated by the source version: nothing is recomputed while the snapshot is the same', () => {
    const prev: SignalState = { v: 0, src: 's1', edge: null, ver: 1 };
    const same = stepSignal('stage_2', 1, prev, read(1, 's1'), BAR);
    assert.equal(same.met, false, 'same builtAt → the remembered state is used, the new value is not looked at');
    assert.equal(same.changed, false);
    assert.equal(same.next, prev);
    const latched = stepSignal('stage_2', 1, { v: 1, src: 's2', edge: BAR, ver: 1 }, read(1, 's2'), BAR);
    assert.equal(latched.met, true, 'an unused edge stays met for the rest of the bar (lets an AND with price conditions fire later)');
    assert.equal(stepSignal('stage_2', 1, { v: 1, src: 's2', edge: BAR, ver: 1 }, read(1, 's2'), '2026-10-16').met, false, 'the edge ends with its bar');
  });
  test('unknown keeps the last known state; source unavailable waits; an alert edit starts afresh', () => {
    const unk = stepSignal('acc_ab', 1, { v: 0, src: 's1', edge: null, ver: 1 }, read(null, 's2'), BAR);
    assert.equal(unk.known, false); assert.equal(unk.met, false);
    assert.equal(unk.next!.v, 0, 'last known kept');
    assert.equal(stepSignal('acc_ab', 1, unk.next!, read(1, 's3'), BAR).met, true, 'next known reading compared with the last known one');
    const gone = stepSignal('acc_ab', 1, { v: 0, src: 's1', edge: null, ver: 1 }, read(null, null), BAR);
    assert.equal(gone.known, false); assert.equal(gone.changed, false);
    const edited = stepSignal('acc_ab', 2, { v: 0, src: 's1', edge: null, ver: 1 }, read(1, 's2'), BAR);
    assert.equal(edited.met, false, 'new alert version = first sighting');
    assert.equal(edited.next!.ver, 2);
  });
  test('Stage 1 → 2 fires only from 1; Stage 3 → 2 does not', () => {
    assert.equal(stepSignal('stage_1_to_2', 1, { v: 1, src: 'a', edge: null, ver: 1 }, read(2, 'b'), BAR).met, true);
    assert.equal(stepSignal('stage_1_to_2', 1, { v: 3, src: 'a', edge: null, ver: 1 }, read(2, 'b'), BAR).met, false);
    assert.equal(stepSignal('stage_1_to_2', 1, { v: 2, src: 'a', edge: BAR, ver: 1 }, read(2, 'b'), BAR).met, true, 'edge kept while still Stage 2');
    assert.equal(stepSignal('stage_1_to_2', 1, { v: 2, src: 'a', edge: BAR, ver: 1 }, read(3, 'b'), BAR).met, false);
  });
  test('consumeEdges uses an edge once and gives back an undo list', () => {
    const book = newSignalBook();
    const k = signalKey('a1', 'IN:HAL', 0);
    book.states.set(k, { v: 1, src: 's2', edge: BAR, ver: 1 });
    const undo = consumeEdges(book, [k, signalKey('a1', 'IN:HAL', 9)]);
    assert.equal(book.states.get(k)!.edge, null);
    assert.ok(book.dirty.has(k));
    assert.deepEqual(undo, [[k, { v: 1, src: 's2', edge: BAR, ver: 1 }]]);
  });
});

describe('every new condition reads the right snapshot field', () => {
  const row = (o: Partial<SignalRow>): SignalRow => ({ t: 'X', ...o });
  const st = (c: AlertCondition, o: Partial<SignalRow>) => screenState(c, row(o));
  test('Stage Analysis', () => {
    assert.equal(st({ type: 'stage_2' }, { twSt: 2 }), 1); assert.equal(st({ type: 'stage_2' }, { twSt: 1 }), 0); assert.equal(st({ type: 'stage_2' }, {}), null);
    assert.equal(st({ type: 'stage_to', value: 4 }, { twSt: 4 }), 1); assert.equal(st({ type: 'stage_to', value: 4 }, { twSt: 3 }), 0);
    assert.equal(st({ type: 'stage2_weak' }, { twSt: 2, twH: 0 }), 1); assert.equal(st({ type: 'stage2_weak' }, { twSt: 2, twH: 1 }), 0);
    assert.equal(st({ type: 'stage2_weak' }, { twSt: 3 }), 0, 'outside Stage 2 = not weakening'); assert.equal(st({ type: 'stage2_weak' }, { twSt: 2 }), null);
    assert.equal(st({ type: 'stage_1_to_2' }, { twSt: 1 }), 1, 'the stage number is the state');
    assert.equal(st({ type: 'sata_cross_up', value: 7 }, { sata: 8 }), 1); assert.equal(st({ type: 'sata_cross_up', value: 7 }, { sata: 7 }), 0);
    assert.equal(st({ type: 'sata_cross_down', value: 4 }, { sata: 3 }), 1); assert.equal(st({ type: 'sata_cross_down', value: 4 }, { sata: 4 }), 0);
    assert.equal(st({ type: 'mrs_cross_up' }, { mrs: 0.2 }), 1); assert.equal(st({ type: 'mrs_cross_up' }, { mrs: 0 }), 0);
  });
  test('setups & patterns (setups unknown until read with the current version)', () => {
    const read = { td9: 0, udv: 1.1 };
    assert.equal(st({ type: 'pattern_breakout', tf: 'D' }, { pat: [{ b: 'U', s: 'b', d: 2 }], scan: { st: 'ready' } }), 1);
    assert.equal(st({ type: 'pattern_breakout', tf: 'D' }, { pat: [{ b: 'D', s: 'b', d: -2 }] }), 0, 'a bearish breakdown is not a breakout');
    assert.equal(st({ type: 'pattern_breakout', tf: 'D' }, { scan: { st: 'no-pattern' } }), 0);
    assert.equal(st({ type: 'pattern_breakout', tf: 'D' }, { scan: { st: 'stale-version' } }), null);
    assert.equal(st({ type: 'pattern_breakout', tf: 'W' }, { pat: [{ b: 'U', s: 'b' }], patW: [{ b: 'U', s: 'f', d: -1 }] }), 0, 'weekly reads patW only');
    assert.equal(st({ type: 'pattern_breakout', tf: 'M' }, { patM: [{ b: 'U', s: 'b' }] }), 1);
    assert.equal(st({ type: 'pattern_near_pivot', value: 5, tf: 'D' }, { pat: [{ b: 'U', s: 'f', d: -4 }] }), 1);
    assert.equal(st({ type: 'pattern_near_pivot', value: 5, tf: 'D' }, { pat: [{ b: 'U', s: 'f', d: -7 }] }), 0);
    assert.equal(st({ type: 'pattern_near_pivot', value: 5, tf: 'D' }, { pat: [{ b: 'U', s: 'b', d: 1 }] }), 0, 'already broken out is not forming');
    assert.equal(st({ type: 'tight_3w' }, { ...read, wt3: 3 }), 1); assert.equal(st({ type: 'tight_3w' }, read), 0); assert.equal(st({ type: 'tight_3w' }, {}), null);
    assert.equal(st({ type: 'darvas_breakout' }, { ...read, dvx: 2 }), 1); assert.equal(st({ type: 'darvas_breakout' }, { ...read, dvx: 1 }), 0);
    assert.equal(st({ type: 'donchian_20' }, { ...read, dc20D: 0 }), 1); assert.equal(st({ type: 'donchian_20' }, { ...read, dc20D: 4 }), 0);
    assert.equal(st({ type: 'donchian_55' }, { ...read, dc55D: 1 }), 1);
    assert.equal(st({ type: 'squeeze_up' }, { ...read, sqzF: 0, sqzM: 1 }), 1); assert.equal(st({ type: 'squeeze_up' }, { ...read, sqzF: 0, sqzM: -1 }), 0, 'fired down');
    assert.equal(st({ type: 'episodic_pivot' }, { ...read, epD: 0 }), 1);
    assert.equal(st({ type: 'pocket_pivot' }, { tt: 5, ppD: 1 }), 1); assert.equal(st({ type: 'pocket_pivot' }, { tt: 5 }), 0); assert.equal(st({ type: 'pocket_pivot' }, {}), null);
    assert.equal(st({ type: 'trend_template' }, { ttOk: 1 }), 1); assert.equal(st({ type: 'trend_template' }, { ttOk: 0, tt: 5 }), 0);
    assert.equal(st({ type: 'rs_rating', value: 80 }, { rsR: 80 }), 1); assert.equal(st({ type: 'rs_rating', value: 80 }, { rsR: 79 }), 0);
  });
  test('volume & accumulation (unknown until read with the current ACC_VERSION)', () => {
    assert.equal(st({ type: 'acc_ab' }, { accS: 70, accR: 4 }), 1); assert.equal(st({ type: 'acc_ab' }, { accS: 70, accR: 3 }), 0); assert.equal(st({ type: 'acc_ab' }, { accR: 5 }), null);
    assert.equal(st({ type: 'dist_warn' }, { accS: 20, distWarn: 1 }), 1); assert.equal(st({ type: 'dist_warn' }, { accS: 20 }), 0);
    assert.equal(st({ type: 'vol_breakout' }, { accS: 50, vboD: 0 }), 1); assert.equal(st({ type: 'vol_breakout' }, { accS: 50, vboD: 6 }), 0);
  });
  test('cheat entry maps the /cheat-entry board rules', () => {
    // 50-day pullback: 2% over the 50-day, well above the 200-day
    assert.equal(st({ type: 'cheat_50' }, { px: 102, sma50: 100, sma200: 80 }), 1);
    assert.equal(st({ type: 'cheat_any' }, { px: 102, sma50: 100, sma200: 80 }), 1);
    assert.equal(st({ type: 'cheat_200' }, { px: 102, sma50: 100, sma200: 80 }), 0);
    assert.equal(st({ type: 'cheat_support' }, { px: 100.5, sma50: 100, sma200: 80 }), 1, 'within 1% of the average');
    assert.equal(st({ type: 'cheat_support' }, { px: 103, sma50: 100, sma200: 80 }), 0);
    // 200-day retest
    assert.equal(st({ type: 'cheat_200' }, { px: 101, sma50: 120, sma200: 100 }), 1);
    // extended / broken / drifting = no trigger
    assert.equal(st({ type: 'cheat_any' }, { px: 130, sma50: 100, sma200: 80 }), 0, 'extended');
    assert.equal(st({ type: 'cheat_any' }, { px: 90, sma50: 100, sma200: 100 }), 0, 'broken (> 3% under the 200-day)');
    assert.equal(st({ type: 'cheat_any' }, { px: 110, sma50: 100, sma200: 80 }), 0, 'drifting between pivots');
    assert.equal(st({ type: 'cheat_any' }, { scanPx: 102, sma50: 100, sma200: 80 }), 1, 'falls back to the scan close');
    assert.equal(st({ type: 'cheat_any' }, { px: 102, sma50: 100 }), null);
    // the library is the page's own rules
    assert.equal(cheatSetup(102, 100, 80)!.setup, 'AT_50');
    assert.equal(cheatSetup(101, 120, 100)!.setup, 'AT_200');
    assert.equal(cheatSetup(130, 100, 80)!.setup, 'EXTENDED');
    assert.equal(cheatSetup(110, 100, 80)!.setup, 'DRIFT');
    assert.equal(cheatSetup(90, 100, 100), null);
    const both = cheatSetup(101, 100.5, 99)!;   // both averages qualify: nearest with the deeper-average preference
    assert.equal(both.setup, 'AT_200'); assert.equal(both.stopMa, '200DMA');
    assert.ok(Math.abs(cheatSetup(102, 100, 80)!.riskPct! - (102 - 98) / 102 * 100) < 1e-9, 'stop 2% under the pivot average');
    const page = readFileSync(join(__dirname, '../../app/(dashboard)/cheat-entry/page.tsx'), 'utf8');
    assert.match(page, /cheatSetup\(livePrice, t\.sma50, t\.sma200\)/, 'the page uses the shared rules');
    assert.ok(!/pivots\.push/.test(page), 'no second copy of the rules on the page');
    assert.ok(!/^export (?!default)/m.test(page));
  });
});

describe('results & guidance views', () => {
  test('graded rows → BLOCKBUSTER beats STRONG; prefixes dropped; stamp follows the content', () => {
    const v = resultsView([{ by_tier: { STRONG: [{ ticker: 'NSE:HAL' }, { ticker: 'BEL' }], MIXED: [{ ticker: 'X' }] } }, { by_tier: { BLOCKBUSTER: [{ ticker: 'BEL' }] } }]);
    assert.equal(v.get('HAL'), 'STRONG'); assert.equal(v.get('BEL'), 'BLOCKBUSTER'); assert.equal(v.get('X'), null);
    assert.equal(resultsView([{ by_tier: { BLOCKBUSTER: [{ ticker: 'BEL' }], STRONG: [{ ticker: 'HAL' }] } }]).version, v.version);
    assert.notEqual(resultsView([]).version, v.version);
    const feeds: SignalFeeds = { results: v };
    assert.deepEqual(signalReading({ type: 'result_strong' }, feeds, 'HAL'), { v: 1, version: v.version });
    assert.deepEqual(signalReading({ type: 'result_blockbuster' }, feeds, 'HAL'), { v: 0, version: v.version });
    assert.deepEqual(signalReading({ type: 'result_strong' }, feeds, 'ZZZ'), { v: 0, version: v.version }, 'not graded = false (known)');
    assert.deepEqual(signalReading({ type: 'guidance_raised' }, {}, 'HAL'), { v: null, version: null }, 'source missing → waits');
    assert.equal(contentStamp([['a', '1'], ['b', '2']]), contentStamp([['b', '2'], ['a', '1']]));
  });
  test('ticker lookup: exact, and US class shares either spelling', () => {
    const get = rowIndex([{ t: 'BRK-B' }, { t: 'HAL' }]);
    assert.equal(get('BRK.B')!.t, 'BRK-B'); assert.equal(get('hal')!.t, 'HAL'); assert.equal(get('NOPE'), null);
  });
});

describe('evaluation pass with signals', () => {
  const alert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
    id: 'a1', name: 'Stage 2 on Swing', target: { kind: 'chart-list', id: 'l1' }, conditions: [{ type: 'stage_2' }], interval: 'D',
    trigger: 'per_bar', session: 'regular', expiresAt: null, message: '{{ticker}} {{condition}}',
    notify: { app: true, toast: true, browser: false, telegram: false, email: false }, status: 'active', createdAt: '', updatedAt: '', version: 1, lastFiredAt: null, fireCount: 0, ...over,
  });
  const q = (price: number): LiveQuote => ({ price, prevClose: 100, volume: 1, dayHigh: price, dayLow: price });
  const view = (version: string, rows: SignalRow[]): SourceView<SignalRow> => ({ version, get: rowIndex(rows) });
  const IN_OPEN = at('2026-10-15T05:00:00Z');   // 10:30 IST; New York closed
  const US_OPEN = at('2026-10-15T15:00:00Z');   // 11:00 New York; NSE closed
  const ctxOf = (now: Date, feeds: Map<'IN' | 'US', SignalFeeds>, book = newSignalBook(feeds)): EvalCtx => {
    book.feeds = feeds;
    return {
      now, quotes: new Map([['IN:HAL', q(102)], ['IN:BEL', q(50)], ['US:HAL', q(30)]]), daily: new Map(), prev: new Map(), firedKeys: new Set(),
      expansions: new Map([['a1', { mids: ['IN:HAL', 'IN:BEL', 'US:HAL'], label: 'Swing' }]]), isNseHoliday: noHol, signals: book,
    };
  };
  test('first snapshot records only; the next snapshot that flips a state fires once; same snapshot never re-fires', () => {
    const book = newSignalBook();
    const s1 = new Map([['IN', { screen: view('snap:1', [{ t: 'HAL', twSt: 1 }, { t: 'BEL', twSt: 2 }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    const c1 = ctxOf(IN_OPEN, s1, book);
    const r1 = evaluateAlerts([alert()], c1);
    assert.equal(r1.events.length, 0, 'BEL already Stage 2 when first seen: no fire');
    assert.equal(book.dirty.size, 2, 'first states written');
    const s2 = new Map([['IN', { screen: view('snap:2', [{ t: 'HAL', twSt: 2 }, { t: 'BEL', twSt: 2 }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    const c2 = ctxOf(at('2026-10-15T05:20:00Z'), s2, book);
    const r2 = evaluateAlerts([alert()], c2);
    assert.deepEqual(r2.events.map((e) => e.mid), ['IN:HAL'], 'HAL turned Stage 2; BEL stayed');
    assert.equal(r2.events[0].condition, 'Stage changes to 2 (confirmed)');
    assert.equal(r2.consumed!.length, 1);
    const r3 = evaluateAlerts([alert({ trigger: 'per_minute' })], { ...c2, now: at('2026-10-15T05:21:00Z'), firedKeys: new Set() });
    assert.equal(r3.events.length, 0, 'the edge was used: no second fire for one change, even once-per-minute');
    // the snapshot rows change but builtAt does not → no work, no fire
    const s2b = new Map([['IN', { screen: view('snap:2', [{ t: 'HAL', twSt: 2 }, { t: 'BEL', twSt: 1 }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    book.dirty.clear();
    assert.equal(evaluateAlerts([alert()], ctxOf(at('2026-10-15T05:22:00Z'), s2b, book)).events.length, 0);
    assert.equal(book.dirty.size, 0, 'nothing recomputed while builtAt is unchanged');
  });
  test('India and US are kept apart (same ticker, own snapshot, own state)', () => {
    const book = newSignalBook();
    const f1 = new Map([['IN', { screen: view('in:1', [{ t: 'HAL', accS: 60, accR: 3 }]) }], ['US', { screen: view('us:1', [{ t: 'HAL', accS: 60, accR: 3 }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    const a = alert({ conditions: [{ type: 'acc_ab' }] });
    evaluateAlerts([a], ctxOf(IN_OPEN, f1, book));
    evaluateAlerts([a], ctxOf(US_OPEN, f1, book));
    // only the US snapshot changes: HAL (US) becomes grade A
    const f2 = new Map([['IN', { screen: view('in:1', [{ t: 'HAL', accS: 60, accR: 3 }]) }], ['US', { screen: view('us:2', [{ t: 'HAL', accS: 90, accR: 5 }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    const us = evaluateAlerts([a], ctxOf(at('2026-10-15T15:20:00Z'), f2, book));
    assert.deepEqual(us.events.map((e) => [e.mid, e.market]), [['US:HAL', 'US']]);
    assert.ok(book.states.has(signalKey('a1', 'IN:HAL', 0)) && book.states.has(signalKey('a1', 'US:HAL', 0)), 'separate states per market');
    assert.equal(book.states.get(signalKey('a1', 'IN:HAL', 0))!.v, 0);
  });
  test('AND with a price condition: the edge waits inside its bar for the price; a ticker missing from the snapshot waits', () => {
    const book = newSignalBook();
    const a = alert({ conditions: [{ type: 'pattern_breakout', tf: 'D' }, { type: 'price_above', value: 105 }] });
    const f1 = new Map([['IN', { screen: view('s1', [{ t: 'HAL', scan: { st: 'no-pattern' } }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    const r0 = evaluateAlerts([a], ctxOf(IN_OPEN, f1, book));
    assert.equal(r0.events.length, 0);
    assert.ok(r0.waiting >= 1, 'BEL / not in the snapshot → waits');
    const f2 = new Map([['IN', { screen: view('s2', [{ t: 'HAL', pat: [{ b: 'U', s: 'b', d: 1 }], scan: { st: 'ready' } }]) }]]) as Map<'IN' | 'US', SignalFeeds>;
    const c = ctxOf(at('2026-10-15T05:20:00Z'), f2, book);
    assert.equal(evaluateAlerts([a], c).events.length, 0, 'breakout, but price 102 is not above 105');
    c.quotes.set('IN:HAL', q(106));
    const r = evaluateAlerts([a], { ...c, now: at('2026-10-15T06:00:00Z') });
    assert.deepEqual(r.events.map((e) => e.mid), ['IN:HAL'], 'later the same day both hold');
    assert.match(r.events[0].condition, /Breaks out of a pattern \(daily\) and Price greater than 105/);
  });
  test('no signal data at all → the alert waits (never fires on a guess)', () => {
    const ctx = ctxOf(IN_OPEN, new Map());
    const r = evaluateAlerts([alert()], ctx);
    assert.equal(r.events.length, 0); assert.ok(r.waiting >= 2);
    const noBook = { ...ctx, signals: undefined };
    assert.equal(evaluateAlerts([alert()], noBook).events.length, 0);
  });
});

describe('input, labels, dialog', () => {
  const now = at('2026-10-15T00:00:00Z');
  test('new conditions pass the input check with exact plain-English labels', () => {
    const labels: Array<[AlertCondition, string]> = [
      [{ type: 'stage_2' }, 'Stage changes to 2 (confirmed)'],
      [{ type: 'stage_to', value: 3 }, 'Stage changes to 3 (topping)'],
      [{ type: 'stage2_weak' }, 'Stage 2 weakening (topping risk)'],
      [{ type: 'stage_1_to_2' }, 'Stage 1 → 2 transition'],
      [{ type: 'sata_cross_up', value: 7 }, 'SATA score crosses above 7'],
      [{ type: 'sata_cross_down', value: 4 }, 'SATA score crosses below 4'],
      [{ type: 'mrs_cross_up' }, 'Mansfield RS crosses above 0'],
      [{ type: 'cheat_any' }, 'Cheat entry trigger (onto the 50 or 200-day average)'],
      [{ type: 'cheat_50' }, 'Cheat entry: 50-day average pullback'],
      [{ type: 'cheat_200' }, 'Cheat entry: 200-day average retest'],
      [{ type: 'cheat_support' }, 'Cheat entry: at support now (within 1% of the average)'],
      [{ type: 'pattern_breakout', tf: 'W' }, 'Breaks out of a pattern (weekly)'],
      [{ type: 'pattern_near_pivot', value: 5, tf: 'D' }, 'Pattern forming within 5% of pivot (daily)'],
      [{ type: 'tight_3w' }, '3 weeks tight'],
      [{ type: 'darvas_breakout' }, 'Darvas breakout'],
      [{ type: 'donchian_20' }, 'Donchian 20 breakout'],
      [{ type: 'donchian_55' }, 'Donchian 55 breakout'],
      [{ type: 'squeeze_up' }, 'Squeeze fired up'],
      [{ type: 'episodic_pivot' }, 'Episodic pivot / gap on volume'],
      [{ type: 'pocket_pivot' }, 'Pocket pivot'],
      [{ type: 'trend_template' }, 'Minervini trend template passes (all 6)'],
      [{ type: 'rs_rating', value: 80 }, 'RS Rating ≥ 80'],
      [{ type: 'acc_ab' }, 'Accumulation grade becomes A or B'],
      [{ type: 'dist_warn' }, 'Distribution warning appears'],
      [{ type: 'vol_breakout' }, 'Volume breakout (≥1.5× on a new 50-day closing high)'],
      [{ type: 'result_strong' }, 'New result filed graded STRONG or BLOCKBUSTER'],
      [{ type: 'result_blockbuster' }, 'New result filed graded BLOCKBUSTER'],
      [{ type: 'guidance_raised' }, 'Guidance raised'],
    ];
    assert.equal(labels.length, SIGNAL_COND_TYPES.length, 'every signal type is covered here');
    for (const [c, label] of labels) {
      const r = sanitizeAlertInput({ target: { kind: 'watchlist' }, conditions: [c] }, now);
      assert.ok(r.ok, `${c.type}: ${r.ok ? '' : r.error}`);
      if (r.ok) assert.equal(condLabel(r.alert.conditions[0]), label);
      assert.ok(isSignalCond(c)); assert.equal(needsDaily(c, 'D'), false);
      assert.ok(SIGNAL_META[c.type]!.updates.length > 20, `${c.type} says when it updates`);
    }
    const bad = (c: unknown) => { const r = sanitizeAlertInput({ target: { kind: 'watchlist' }, conditions: [c] }, now); return r.ok ? '' : r.error; };
    assert.match(bad({ type: 'stage_to', value: 2.5 }), /stage must be/);
    assert.match(bad({ type: 'stage_to', value: 5 }), /between 1 and 4/);
    assert.match(bad({ type: 'pattern_breakout', tf: 'H' }), /timeframe/);
    const def = sanitizeAlertInput({ target: { kind: 'watchlist' }, conditions: [{ type: 'pattern_breakout' }] }, now);
    assert.ok(def.ok && def.alert.conditions[0].tf === 'D', 'daily by default');
    assert.deepEqual([...sourcesFor([{ type: 'stage_2' }, { type: 'result_strong' }, { type: 'price_above', value: 1 }])].sort(), ['results', 'screen']);
  });
  test('price conditions are untouched by the signal pass (evalAll treats a signal as met — its verdict comes from signals.ts)', () => {
    const r = evalAll([{ type: 'stage_2' }, { type: 'price_above', value: 100 }], { price: 101, prevClose: 100 }, null, [], 'D', BAR);
    assert.equal(r.met, true); assert.equal(r.known, true); assert.equal(r.states[0], undefined);
  });
  test('dialog: six groups as a grouped dropdown, every condition once, a description + update note each, four templates', () => {
    assert.deepEqual(COND_GROUPS.map((g) => g.label), ['Price', 'Moving averages & momentum', 'Stage Analysis', 'Setups & patterns', 'Volume & accumulation', 'Fundamentals & results']);
    const all = COND_GROUPS.flatMap((g) => g.types);
    assert.equal(new Set(all).size, all.length, 'no type twice');
    assert.deepEqual([...all].sort(), [...COND_TYPES].sort(), 'every condition type is offered');
    for (const t of COND_TYPES as readonly CondType[]) { assert.ok(condName(t) && condName(t) !== t, t); assert.ok(condHelp(t).desc && condHelp(t).updates, t); }
    assert.match(condHelp('stage_2').updates, /weekly close/);
    assert.match(condHelp('pattern_breakout').updates, /20 min \(India\) · 4× a day \(USA\)/);
    assert.deepEqual(ALERT_TEMPLATES.map((t) => t.label), ['Stage 2 confirmed on my list', 'Breakout on my list', 'Accumulation A/B on my list', 'Cheat entry on my list']);
    for (const t of ALERT_TEMPLATES) assert.ok(sanitizeAlertInput({ target: { kind: 'book-in' }, conditions: t.conditions }, now).ok, t.id);
    const dlg = readFileSync(join(__dirname, '../../components/alerts/CreateAlertDialog.tsx'), 'utf8');
    assert.match(dlg, /<optgroup key=\{g\.label\} label=\{g\.label\}>/);
    assert.match(dlg, /ALERT_TEMPLATES\.map/);
    assert.match(dlg, /condHelp\(c\.type\)/);
  });
});

describe('storage, sources, cost', () => {
  test('migration 8 adds price_alert_signal keyed per alert + ticker + condition', () => {
    assert.ok(migrationsValid());
    const m = MIGRATIONS.find((x) => x.name === 'price_alert_signals')!;
    assert.ok(m); assert.equal(m.id, 8);
    assert.match(m.sql, /CREATE TABLE IF NOT EXISTS price_alert_signal/);
    assert.match(m.sql, /PRIMARY KEY \(alert_id, mid, cond_idx\)/);
    for (const col of ['alert_version', 'state', 'src', 'edge']) assert.ok(m.sql.includes(col), col);
  });
  test('the checker reads the shared snapshot copy; no Redis in the checker or the store', () => {
    const engine = readFileSync(join(__dirname, '../alerts/engine.ts'), 'utf8');
    const store = readFileSync(join(__dirname, '../alerts/store.ts'), 'utf8');
    const src = readFileSync(join(__dirname, '../alerts/signal-sources.ts'), 'utf8');
    assert.ok(!/from '@\/lib\/kv'/.test(engine) && !/from '@\/lib\/kv'/.test(store));
    assert.match(src, /from '@\/lib\/screener\/snapshot-cache'/);
    assert.match(src, /RESULTS_TTL_MS = 30 \* 60_000/);
    assert.match(engine, /if \(sigNeeds\.size\)/, 'signal sources are read only when an alert needs them');
    assert.match(engine, /saveSignalStates/);
  });
});
