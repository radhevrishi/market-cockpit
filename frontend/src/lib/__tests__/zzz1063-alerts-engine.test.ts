// zzz1063 — price alerts audit fixes: A01 freshness contract, A02 durable crossings + delivery outbox, A03 one exchange calendar
// (US 13:00 early closes, holidays, DST), A05 deliberate Rearm, A06 honest history coverage; plus the server half of phone push.
// No network: fake adapters / senders only; nothing is ever sent to the owner. The Postgres part runs only when ZZZ1063_PG_URL
// points at a scratch database (it creates its own tables there).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceForAlert, dailyFreshness, evaluateAlerts, condTextWithNotes, firedKey, WAIT_TEXT, type EvalCtx } from '../alerts/evaluate';
import { figuresFromBars, evalCondition, FIGS_VERSION, type DailyFigs, type LiveQuote } from '../alerts/conditions';
import { sessionOpen, expectedDailyAsOf } from '../alerts/session';
import { dayWindows, isNyseEarlyClose, phaseAt, lastCompletedSession, isTradingDay, prevTradingDay } from '../exchange-calendar';
import { closeMinutes } from '../ai-gainers/us-gainers';
import { dedupeKey } from '../alerts/trigger';
import { sanitizeAlertInput, type PriceAlert } from '../alerts/types';
import { firingChanged, retryDelayMin, CLAIM_OUTBOX_SQL, commitRun, DELIVERY_MAX_ATTEMPTS, type ClaimedRow, type OutboxUpdate } from '../alerts/store';
import { planOutcome, groupClaimed, deliverOnce, deliveryDue, idempotencyKeyFor, type DeliveryDeps, type ChannelSend } from '../alerts/delivery';
import { crossChanges, channelsOf, testReport, pushLine } from '../alerts/engine';
import { sendPushToAll, allowedEndpoint, parseSubscription, pushForEvents, goneStatus, type PushTarget } from '../push/server';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { isProtectedApi } from '../site-auth';
import { LIGHT_JOBS, parseCron } from '../app-scheduler';
import type { AlertEvent } from '../alerts/types';

const at = (s: string) => new Date(s);
const noHol = () => false;
const IN_OPEN = at('2026-10-15T05:00:00Z');         // 10:30 IST Thursday
const US_OPEN = at('2026-10-15T15:00:00Z');         // 11:00 New York
const q = (price: number, over: Partial<LiveQuote> = {}): LiveQuote => ({ price, prevClose: 100, volume: 500_000, dayHigh: price, dayLow: price, provider: 'test', ...over });

describe('A03 — one exchange calendar: early closes, holidays, DST', () => {
  test('US 13:00 early close on 27 Nov and 24 Dec 2026: regular and after-hours end early', () => {
    for (const day of ['2026-11-27', '2026-12-24']) {
      assert.equal(isNyseEarlyClose(day), true, day);
      assert.deepEqual(dayWindows('US', day)!.regular, [570, 780]);
    }
    // 27 Nov 2026 is EST (UTC−5): 13:00 ET = 18:00 UTC
    assert.equal(sessionOpen('US', 'regular', at('2026-11-27T17:59:00Z')), true, '12:59 ET open');
    assert.equal(sessionOpen('US', 'regular', at('2026-11-27T18:00:00Z')), false, '13:00 ET closed');
    assert.equal(sessionOpen('US', 'regular', at('2026-11-27T19:00:00Z')), false, 'the audit case: 14:00 ET was "open" before');
    assert.equal(phaseAt('US', at('2026-11-27T18:30:00Z')), 'post');
    assert.equal(sessionOpen('US', 'extended', at('2026-11-27T21:59:00Z')), true, '16:59 ET after-hours');
    assert.equal(sessionOpen('US', 'extended', at('2026-11-27T22:00:00Z')), false, 'after-hours ends 17:00 on an early-close day');
    assert.equal(lastCompletedSession('US', at('2026-11-27T18:01:00Z')), '2026-11-27');
    assert.equal(lastCompletedSession('US', at('2026-11-27T17:59:00Z')), '2026-11-25', 'Thanksgiving skipped');
    assert.equal(sessionOpen('US', 'regular', at('2026-11-25T20:59:00Z')), true, 'an ordinary day: 15:59 ET still open');
  });
  test('early closes by rule in other years; full holidays; India', () => {
    assert.equal(isNyseEarlyClose('2028-07-03'), true, '3 July before a Tuesday 4th');
    assert.equal(isNyseEarlyClose('2026-07-03'), false, '2026: 3 July is itself the observed holiday');
    assert.equal(isNyseEarlyClose('2027-12-24'), false, '2027: 24 Dec is the observed Christmas holiday');
    assert.equal(isNyseEarlyClose('2028-11-24'), true);
    assert.equal(closeMinutes('2028-11-24'), 13 * 60, 'us-gainers reads the shared calendar too');
    assert.equal(isTradingDay('US', '2026-11-26'), false, 'Thanksgiving');
    assert.equal(isTradingDay('US', '2025-01-09'), false, 'national day of mourning');
    assert.equal(sessionOpen('IN', 'regular', at('2026-10-20T05:00:00Z'), (d) => d === '2026-10-20'), false, 'NSE holiday');
    assert.equal(prevTradingDay('IN', '2026-10-21', (d) => d === '2026-10-20'), '2026-10-19');
  });
  test('DST: the open follows New York time, before and after the clock changes', () => {
    assert.equal(sessionOpen('US', 'regular', at('2026-03-06T14:30:00Z')), true, 'Fri 6 Mar EST 09:30');
    assert.equal(sessionOpen('US', 'regular', at('2026-03-09T13:30:00Z')), true, 'Mon 9 Mar EDT 09:30');
    assert.equal(sessionOpen('US', 'regular', at('2026-03-09T13:29:00Z')), false);
    assert.equal(sessionOpen('US', 'regular', at('2026-11-02T14:29:00Z')), false, 'Mon 2 Nov EST 09:29');
    assert.equal(sessionOpen('US', 'regular', at('2026-11-02T14:30:00Z')), true);
    assert.equal(sessionOpen('US', 'regular', at('2026-11-02T20:59:00Z')), true, '15:59 EST');
    assert.equal(sessionOpen('US', 'regular', at('2026-11-02T21:00:00Z')), false, '16:00 EST');
  });
});

describe('A01 — freshness contract', () => {
  const n = US_OPEN.getTime();
  test('regular session: undated, future, old and earlier-session quotes wait', () => {
    assert.deepEqual(priceForAlert(undefined, 'US', US_OPEN), { ok: false, reason: 'no-quote' });
    assert.equal((priceForAlert(q(101, { marketTime: null }), 'US', US_OPEN) as any).reason, 'quote-undated', 'the audit case: marketTime=null used to fire');
    assert.equal((priceForAlert(q(101, { marketTime: n + 10 * 60_000 }), 'US', US_OPEN) as any).reason, 'quote-future');
    assert.equal((priceForAlert(q(101, { marketTime: n - 21 * 60_000 }), 'US', US_OPEN) as any).reason, 'quote-stale');
    const ok = priceForAlert(q(101, { marketTime: n - 60_000 }), 'US', US_OPEN);
    assert.ok(ok.ok && ok.session === 'regular' && ok.quote.price === 101 && ok.provider === 'test');
    assert.equal((priceForAlert(q(101, { marketTime: IN_OPEN.getTime() - 26 * 3600_000 }), 'IN', IN_OPEN, noHol) as any).reason, 'quote-stale', "yesterday's close");
  });
  test("pre-market at 08:00 ET: yesterday's regular quote with no extended trade waits; a fresh pre-market price is used", () => {
    const pre = at('2026-10-15T12:00:00Z');
    const yclose = at('2026-10-14T20:00:00Z').getTime();
    assert.equal((priceForAlert(q(100, { marketTime: yclose }), 'US', pre) as any).reason, 'no-extended-price', 'the audit case');
    assert.equal((priceForAlert(q(100, { marketTime: yclose, ext: { price: 103, session: 'post', observedAt: pre.getTime(), basis: 'fetched' } }), 'US', pre) as any).reason, 'no-extended-price', 'wrong session');
    assert.equal((priceForAlert(q(100, { marketTime: yclose, ext: { price: 103, session: 'pre', observedAt: null, basis: 'fetched' } }), 'US', pre) as any).reason, 'extended-undated');
    assert.equal((priceForAlert(q(100, { marketTime: yclose, ext: { price: 103, session: 'pre', observedAt: pre.getTime() - 30 * 60_000, basis: 'fetched' } }), 'US', pre) as any).reason, 'extended-stale');
    assert.equal((priceForAlert(q(100, { marketTime: yclose - 86400_000, ext: { price: 103, session: 'pre', observedAt: pre.getTime(), basis: 'fetched' } }), 'US', pre) as any).reason, 'regular-ref-session', 'regular close two days old');
    const ok = priceForAlert(q(100, { marketTime: yclose, ext: { price: 103, session: 'pre', observedAt: pre.getTime() - 60_000, basis: 'fetched' } }), 'US', pre);
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.quote.price, 103); assert.equal(ok.quote.prevClose, 100, 'change vs the last regular close');
      assert.equal(ok.quote.volume, null, "yesterday's volume is not today's"); assert.equal(ok.session, 'pre');
    }
  });
  test("after-hours uses today's regular close as reference; India pre-open waits for a fresh price", () => {
    const post = at('2026-10-15T21:00:00Z');   // 17:00 ET
    const close = at('2026-10-15T20:00:00Z').getTime();
    const ok = priceForAlert(q(100, { marketTime: close, ext: { price: 99, session: 'post', observedAt: post.getTime(), basis: 'fetched' } }), 'US', post);
    assert.ok(ok.ok && ok.quote.price === 99 && ok.session === 'post');
    const preOpen = at('2026-10-15T03:35:00Z');   // 09:05 IST
    assert.equal((priceForAlert(q(100, { marketTime: at('2026-10-14T10:00:00Z').getTime() }), 'IN', preOpen, noHol) as any).reason, 'quote-stale');
  });
  test('daily figures must end on the last completed session (holidays skipped)', () => {
    const f = (asOf: string): DailyFigs => ({ asOf, day: null, open: null, c: [1], hi52: 1, lo52: 1, avgVol50: 1, wc: [], v: FIGS_VERSION });
    assert.equal(dailyFreshness(null, 'IN', '2026-10-15', noHol), 'daily-missing');
    assert.equal(dailyFreshness(f('2026-10-13'), 'IN', '2026-10-15', noHol), 'daily-stale');
    assert.equal(dailyFreshness(f('2026-10-14'), 'IN', '2026-10-15', noHol), null);
    assert.equal(dailyFreshness(f('2026-10-19'), 'IN', '2026-10-21', (d) => d === '2026-10-20'), null, 'holiday on the 20th');
    assert.equal(expectedDailyAsOf('US', '2026-11-27'), '2026-11-25');
    assert.equal(dailyFreshness(f('2026-10-16'), 'US', '2026-10-19'), null, 'Monday: Friday is the last session');
  });
  test('the pass waits with a counted reason instead of firing', () => {
    const a: PriceAlert = alertOf({ conditions: [{ type: 'ma_cross_up', ma: 'SMA', len: 50 }], target: { kind: 'chart-list', id: 'l' } });
    const ctx: EvalCtx = {
      now: IN_OPEN, isNseHoliday: noHol, prev: new Map(), firedKeys: new Set(),
      quotes: new Map([['IN:A', q(101, { marketTime: null })], ['IN:B', q(101, { marketTime: IN_OPEN.getTime() - 60_000 })], ['IN:C', q(101, { marketTime: IN_OPEN.getTime() - 60_000 })]]),
      daily: new Map([['IN:B', { asOf: '2026-10-12', day: null, open: null, c: Array(260).fill(100), hi52: 1, lo52: 1, avgVol50: 1, wc: [], v: FIGS_VERSION }]]),
      expansions: new Map([['a1', { mids: ['IN:A', 'IN:B', 'IN:C', 'IN:D'], label: 'L' }]]),
    };
    const r = evaluateAlerts([a], ctx);
    assert.equal(r.events.length, 0);
    assert.deepEqual(r.waitReasons, { 'quote-undated': 1, 'daily-stale': 1, 'daily-missing': 1, 'no-quote': 1 });
    assert.ok(WAIT_TEXT['daily-stale'].includes('last completed session'));
  });
});

function alertOf(over: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 'a1', name: 'A', target: { kind: 'ticker', id: 'IN:HAL' }, conditions: [{ type: 'price_cross_up', value: 100 }], interval: 'D', trigger: 'per_bar',
    session: 'regular', expiresAt: null, message: '{{ticker}} {{condition}}', notify: { app: true, toast: true, browser: false, telegram: true, email: false },
    status: 'active', createdAt: '', updatedAt: '', version: 2, lastFiredAt: null, fireCount: 0, ...over,
  };
}

describe('A02 — durable crossings and delivery', () => {
  const live = (price: number) => new Map([['IN:HAL', q(price, { marketTime: IN_OPEN.getTime() - 60_000 })]]);
  const ctxOf = (price: number, prev: Map<string, Array<number | undefined>>, fired: Set<string>, now = IN_OPEN): EvalCtx => ({
    now, quotes: live(price), daily: new Map(), prev, firedKeys: fired, expansions: new Map([['a1', { mids: ['IN:HAL'], label: 'HAL' }]]), isNseHoliday: noHol, deferState: true,
  });
  test('the audit case: a failed insert does not lose the crossing (state moves on only after commit)', () => {
    const prev = new Map<string, Array<number | undefined>>(), fired = new Set<string>();
    const a = alertOf();
    const r0 = evaluateAlerts([a], ctxOf(99, prev, fired));
    for (const [k, st] of r0.stateUpdates) prev.set(k, st);                    // committed: below the level
    const r1 = evaluateAlerts([a], ctxOf(101, prev, fired, at('2026-10-15T05:01:00Z')));
    assert.equal(r1.events.length, 1, 'crossed up');
    // insert FAILED → what engine.ts does: forget the fired marks, do NOT apply the state updates
    for (const ev of r1.events) fired.delete(firedKey(ev.alertId, ev.mid, ev.dedupeKey));
    const r2 = evaluateAlerts([a], ctxOf(101, prev, fired, at('2026-10-15T05:02:00Z')));
    assert.equal(r2.events.length, 1, 'the crossing is seen again and recorded');
    // committed this time → no further event while it stays above
    for (const [k, st] of r2.stateUpdates) prev.set(k, st);
    assert.equal(evaluateAlerts([a], ctxOf(102, prev, new Set(), at('2026-10-15T05:03:00Z'))).events.length, 0);
  });
  test('crossing states are stored as sides and written only when a side changes', () => {
    const saved = new Map<string, string>();
    const c1 = crossChanges([['a1|2|IN:HAL', [1]], ['a1|2|IN:BEL', [undefined]]], saved);
    assert.deepEqual(c1.map((c) => [c.row.alertId, c.row.version, c.row.mid, c.json]), [['a1', 2, 'IN:HAL', '[1]']], 'no row for an alert without crossings');
    saved.set(c1[0].key, c1[0].json);
    assert.equal(crossChanges([['a1|2|IN:HAL', [1]]], saved).length, 0, 'same side: nothing to write');
    assert.equal(crossChanges([['a1|2|IN:HAL', [-1]]], saved).length, 1);
    assert.equal(evalCondition({ type: 'price_cross_up', value: 100 }, q(137.5), null, undefined, 'D', '2026-10-15').state, 1, 'sign, not distance');
  });
  test('commitRun: one transaction — any failure rolls everything back and throws', async () => {
    const log: string[] = [];
    const client = (failOn: RegExp | null) => ({
      query: async (sql: string) => {
        log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
        if (failOn && failOn.test(sql)) throw new Error('disk full');
        if (/INSERT INTO price_alert_event/.test(sql)) return { rows: [{ id: 7, alert_id: 'a1', alert_name: 'A', mid: 'IN:HAL', market: 'IN', ticker: 'HAL', price: 101, condition: 'c', message: 'm', fired_at: new Date(), dedupe_key: 'bar:x', toast: true, browser: false }] };
        return { rows: [], rowCount: 0 };
      },
      release: () => log.push('release'),
    });
    const ev = { alertId: 'a1', alertName: 'A', mid: 'IN:HAL', market: 'IN', ticker: 'HAL', name: null, price: 101, changePct: 1, condition: 'c', list: null, message: 'm', dedupeKey: 'bar:x', toast: true, browser: false };
    const inp = { events: [ev], channelsFor: () => ['telegram', 'push'] as any, cross: [{ alertId: 'a1', version: 2, mid: 'IN:HAL', states: [1] }], statusFor: () => 'active' as const };
    const ok = await commitRun(inp, { connect: async () => client(null) });
    assert.equal(ok.inserted.length, 1); assert.equal(ok.outbox, 2);
    assert.deepEqual(log.filter((x) => /^(BEGIN|COMMIT|ROLLBACK|release)/.test(x)), ['BEGIN', 'COMMIT', 'release']);
    for (const failOn of [/price_alert_event/, /price_alert_outbox/, /price_alert_cross/, /UPDATE price_alert SET fire_count/]) {
      log.length = 0;
      await assert.rejects(commitRun(inp, { connect: async () => client(failOn) }), /disk full/);
      assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'), String(failOn));
    }
  });
  test('retry plan 1, 5, 15, 60, 60 min, then give up; outcomes per row', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(retryDelayMin), [1, 5, 15, 60, 60, null]);
    assert.equal(DELIVERY_MAX_ATTEMPTS, 6);
    const rows: ClaimedRow[] = [{ id: 1, eventId: 10, channel: 'telegram', attempts: 1 }, { id: 2, eventId: 11, channel: 'telegram', attempts: 6 }, { id: 3, eventId: 12, channel: 'telegram', attempts: 3 }];
    const fail = planOutcome(rows, { state: 'error', error: 'telegram HTTP 429' });
    const by = (s: string) => fail.find((u) => u.status === s && u.delayMin !== undefined)!;
    assert.deepEqual(fail.map((u) => [u.status, u.delayMin, u.ids]).sort(), [['failed', 1, [1]], ['failed', 15, [3]], ['gave_up', null, [2]]].sort());
    assert.ok(by('failed').error!.includes('429'));
    assert.deepEqual(planOutcome(rows, { state: 'sent' }), [{ ids: [1, 2, 3], status: 'sent', error: null, delayMin: null }]);
    assert.equal(planOutcome(rows, { state: 'skipped' })[0].status, 'skipped', 'a channel not set up is not retried');
  });
  test('claim SQL: FOR UPDATE SKIP LOCKED + lease, so two server copies never take the same row', () => {
    assert.match(CLAIM_OUTBOX_SQL, /FOR UPDATE SKIP LOCKED/);
    assert.match(CLAIM_OUTBOX_SQL, /SET status = 'sending', attempts = o\.attempts \+ 1/);
    assert.match(CLAIM_OUTBOX_SQL, /next_attempt_at = now\(\) \+ make_interval\(mins => \$3\)/);
    assert.match(CLAIM_OUTBOX_SQL, /attempts < \$2/);
  });
  const evOf = (id: number, ticker = 'HAL'): AlertEvent => ({ id, alertId: 'a1', alertName: 'A', mid: `IN:${ticker}`, market: 'IN', ticker, name: null, price: 100 + id, changePct: 1, condition: 'Crossing Up 100', list: 'Swing', message: `${ticker} crossed`, firedAt: '', dedupeKey: `k${id}`, read: false, toast: true, browser: false });
  const fakeDeps = (rows: ClaimedRow[], events: AlertEvent[], res: Partial<Record<'telegram' | 'email' | 'push', ChannelSend>>) => {
    const sent: Array<[string, any]> = [], finished: OutboxUpdate[] = [];
    const deps: DeliveryDeps = {
      claim: async () => rows, events: async (ids) => events.filter((e) => ids.includes(e.id)), finish: async (u) => { finished.push(...u); },
      giveUpLost: async () => 0, nextDue: async () => null,
      adapters: {
        telegram: async (m) => { sent.push(['telegram', m]); return res.telegram ?? { state: 'sent' }; },
        email: async (m) => { sent.push(['email', m]); return res.email ?? { state: 'sent' }; },
        push: async (p) => { sent.push(['push', p]); return res.push ?? { state: 'sent' }; },
      },
    };
    return { deps, sent, finished };
  };
  test('several due events of one channel → ONE grouped message; channels fail independently', async () => {
    const rows: ClaimedRow[] = [
      { id: 1, eventId: 10, channel: 'telegram', attempts: 1 }, { id: 2, eventId: 11, channel: 'telegram', attempts: 2 },
      { id: 3, eventId: 10, channel: 'email', attempts: 1 }, { id: 4, eventId: 11, channel: 'push', attempts: 1 }, { id: 5, eventId: 99, channel: 'push', attempts: 1 },
    ];
    const { deps, sent, finished } = fakeDeps(rows, [evOf(10), evOf(11, 'BEL')], { email: { state: 'error', error: 'email timeout' } });
    const r = await deliverOnce(deps);
    assert.equal(sent.filter(([c]) => c === 'telegram').length, 1, 'one Telegram message for two events');
    assert.match(sent.find(([c]) => c === 'telegram')![1].subject, /2 price alerts fired/);
    assert.ok(sent.find(([c]) => c === 'email')![1].idempotencyKey.startsWith('mc-alert-email-'), 'email carries a provider idempotency key');
    assert.equal(sent.find(([c]) => c === 'push')![1].url, '/price-alerts?event=11', 'one push opens that event');
    assert.equal(r.sent, 2 + 1); assert.equal(r.failed, 1); assert.equal(r.gaveUp, 1, 'row of a deleted event');
    assert.deepEqual(finished.find((u) => u.status === 'failed'), { ids: [3], status: 'failed', error: 'email timeout', delayMin: 1 });
    assert.equal(idempotencyKeyFor('email', [rows[2]]), idempotencyKeyFor('email', [rows[2]]), 'same rows → same key');
  });
  test('Telegram 429 / timeout: retried later, then given up after the 6th try; an adapter that throws counts as a failure', async () => {
    const one = (attempts: number): ClaimedRow[] => [{ id: 1, eventId: 10, channel: 'telegram', attempts }];
    const a = fakeDeps(one(1), [evOf(10)], { telegram: { state: 'error', error: 'telegram HTTP 429 — Too Many Requests' } });
    await deliverOnce(a.deps);
    assert.deepEqual(a.finished, [{ ids: [1], status: 'failed', error: 'telegram HTTP 429 — Too Many Requests', delayMin: 1 }]);
    const b = fakeDeps(one(6), [evOf(10)], { telegram: { state: 'error', error: 'telegram timeout' } });
    await deliverOnce(b.deps);
    assert.equal(b.finished[0].status, 'gave_up');
    const c = fakeDeps(one(2), [evOf(10)], {});
    c.deps.adapters.telegram = async () => { throw new Error('socket hang up'); };
    await deliverOnce(c.deps);
    assert.deepEqual([c.finished[0].status, c.finished[0].delayMin], ['failed', 5]);
  });
  test('the delivery job reads Postgres only when something is due (or every 5 minutes)', () => {
    assert.equal(deliveryDue(null, 1000, 2000), false);
    assert.equal(deliveryDue(1500, 1000, 2000), true);
    assert.equal(deliveryDue(null, 0, 5 * 60_000), true);
    const j = LIGHT_JOBS.find((x) => x.name === 'alert-delivery')!;
    assert.ok(j && j.crons.every((c) => parseCron(c)) && j.crons.includes('* * * * *'), 'every minute, every day (retries finish off-hours)');
  });
  test('channels of an event: push is on unless turned off (old alerts too)', () => {
    assert.deepEqual(channelsOf(alertOf()), ['telegram', 'push']);
    assert.deepEqual(channelsOf(alertOf({ notify: { app: true, toast: true, browser: false, telegram: false, email: true, push: false } })), ['email']);
    const s = sanitizeAlertInput({ target: { kind: 'watchlist' }, conditions: [{ type: 'high_52w' }] });
    assert.ok(s.ok && s.alert.notify.push === true);
    const off = sanitizeAlertInput({ target: { kind: 'watchlist' }, conditions: [{ type: 'high_52w' }], notify: { push: false } });
    assert.ok(off.ok && off.alert.notify.push === false);
  });
  test('migration 9: outbox, crossing state, push tables, Rearm column', () => {
    assert.ok(migrationsValid());
    const m = MIGRATIONS.find((x) => x.id === 9)!;
    assert.equal(m.name, 'price_alert_delivery');
    for (const t of ['price_alert_cross', 'price_alert_outbox', 'push_subscription', 'push_vapid']) assert.match(m.sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`));
    assert.match(m.sql, /UNIQUE \(event_id, channel\)/);
    assert.match(m.sql, /ON DELETE CASCADE/);
    assert.match(m.sql, /ADD COLUMN IF NOT EXISTS arm_gen/);
    const store = readFileSync(join(__dirname, '../alerts/store.ts'), 'utf8');
    const del = readFileSync(join(__dirname, '../alerts/delivery.ts'), 'utf8');
    for (const src of [store, del]) assert.ok(!/from '@\/lib\/kv'/.test(src), 'no Redis');
  });
});

describe('push (server half)', () => {
  const targets: PushTarget[] = [
    { id: 1, label: 'iPhone', endpoint: 'https://web.push.apple.com/abc', p256dh: 'x', auth: 'y' },
    { id: 2, label: 'Old Chrome', endpoint: 'https://fcm.googleapis.com/fcm/send/zz', p256dh: 'x', auth: 'y' },
  ];
  test('410 Gone disables the device; one ok device = sent', async () => {
    const r = await sendPushToAll({ title: 't', body: 'b', url: '/price-alerts', tag: 'x', eventId: null }, {
      targets, record: false, vapid: { publicKey: 'p', privateKey: 'k' },
      sender: async (t) => { if (t.id === 2) { const e: any = new Error('push subscription has unsubscribed or expired'); e.status = 410; throw e; } return { status: 201 }; },
    });
    assert.equal(r.state, 'sent');
    assert.deepEqual(r.results.map((x) => [x.id, x.state, x.disabled]), [[1, 'sent', false], [2, 'gone', true]]);
    assert.ok(goneStatus(404) && goneStatus(410) && !goneStatus(429));
    const none = await sendPushToAll({ title: 't', body: 'b', url: '/', tag: 'x', eventId: null }, { targets: [], record: false, vapid: { publicKey: 'p', privateKey: 'k' }, sender: async () => ({ status: 201 }) });
    assert.equal(none.state, 'skipped');
    assert.match(pushLine(none), /no phone or browser/);
    assert.match(pushLine(r), /sent to 1 device; failed on iPhone|sent to 1 device; failed on Old Chrome/);
  });
  test('only real push services; subscription shape checked', () => {
    assert.ok(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
    assert.ok(allowedEndpoint('https://web.push.apple.com/QK'));
    assert.ok(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
    assert.ok(!allowedEndpoint('http://fcm.googleapis.com/x'));
    assert.ok(!allowedEndpoint('https://169.254.169.254/latest'));
    assert.ok(!allowedEndpoint('https://evil.com/fcm.googleapis.com'));
    const key = 'B'.repeat(87);
    assert.ok(parseSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: key, auth: 'abcdefghijklmnop' } }).ok);
    assert.equal(parseSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: {} }).ok, false);
  });
  test('payload: {title, body, url, tag, eventId}; url is a same-site path', () => {
    const one = pushForEvents([{ id: 42, ticker: 'HAL', condition: 'Crossing Up 100', message: 'HAL crossed', price: 101, market: 'IN' }])!;
    assert.deepEqual(Object.keys(one).sort(), ['body', 'eventId', 'tag', 'title', 'url']);
    assert.equal(one.url, '/price-alerts?event=42'); assert.equal(one.eventId, 42); assert.equal(one.tag, 'mc-alert-42');
    const many = pushForEvents([1, 2, 3, 4, 5, 6].map((i) => ({ id: i, ticker: `T${i}`, condition: 'c', message: `m${i}`, price: null, market: 'US' })))!;
    assert.equal(many.url, '/price-alerts'); assert.equal(many.eventId, null); assert.match(many.body, /and 2 more/);
    assert.ok(isProtectedApi('/api/v1/push'), 'owner-only like /api/v1/price-alerts');
    const route = readFileSync(join(__dirname, '../../app/api/v1/push/route.ts'), 'utf8');
    for (const a of ["'subscribe'", "'unsubscribe'", "'test'", "view === 'key'", 'replaces']) assert.ok(route.includes(a), a);
  });
  test('Test result adds a push line', () => {
    const ready = { telegram: { ready: true, missing: [] }, email: { ready: true, missing: [], toMasked: null } };
    const lines = testReport({ telegram: 'sent', email: 'sent', errors: [] }, ready, { telegram: true, email: true }, { state: 'skipped', results: [] });
    assert.equal(lines.length, 3); assert.match(lines[2], /^Push: no phone/);
    assert.equal(testReport({ telegram: 'sent', email: 'sent', errors: [] }, ready, { telegram: true, email: true }).length, 2, 'unchanged without push');
  });
});

describe('A05 — deliberate Rearm', () => {
  test('once keys carry the activation generation; generation 0 keeps the old key', () => {
    assert.equal(dedupeKey('once', 'IN', 'D', IN_OPEN), 'once');
    assert.equal(dedupeKey('once', 'IN', 'D', IN_OPEN, 0), 'once');
    assert.equal(dedupeKey('once', 'IN', 'D', IN_OPEN, 3), 'once:g3');
    assert.equal(dedupeKey('per_bar', 'IN', 'D', IN_OPEN, 3), 'bar:2026-10-15', 'other modes unchanged');
  });
  test('after Rearm a ticker that fired under "once" can fire again; before it, it cannot', () => {
    const a = alertOf({ trigger: 'once', conditions: [{ type: 'price_above', value: 100 }], version: 5 });
    const fired = new Set([firedKey('a1', 'IN:HAL', 'once')]);   // fired in an earlier lifecycle (what the DB unique index holds)
    const ctx = (al: PriceAlert): EvalCtx => ({ now: IN_OPEN, quotes: new Map([['IN:HAL', q(101, { marketTime: IN_OPEN.getTime() - 60_000 })]]), daily: new Map(), prev: new Map(), firedKeys: fired, expansions: new Map([['a1', { mids: ['IN:HAL'], label: 'x' }]]), isNseHoliday: noHol });
    assert.equal(evaluateAlerts([a], ctx(a)).events.length, 0, 'a cosmetic edit / reactivation alone does not refire');
    const re = { ...a, armGen: 1, version: 6 };
    const r = evaluateAlerts([re], ctx(re));
    assert.deepEqual(r.events.map((e) => e.dedupeKey), ['once:g1']);
  });
  test('cosmetic vs firing edits', () => {
    const a = alertOf();
    const cosmetic: PriceAlert = { ...a, name: 'new', message: 'x', notify: { ...a.notify, email: true } };
    assert.equal(firingChanged(a, cosmetic), false);
    assert.equal(firingChanged(a, { ...a, conditions: [{ type: 'price_cross_up', value: 105 }] }), true);
    assert.equal(firingChanged(a, { ...a, target: { kind: 'ticker', id: 'US:HAL' } }), true);
    assert.equal(firingChanged(a, { ...a, session: 'extended' }), true);
    const store = readFileSync(join(__dirname, '../alerts/store.ts'), 'utf8');
    assert.match(store, /dedupe_key NOT LIKE 'once%'/, 'pruning keeps every once generation');
    const route = readFileSync(join(__dirname, '../../app/api/v1/price-alerts/route.ts'), 'utf8');
    assert.match(route, /case 'rearm'/);
  });
});

describe('A06 — history coverage is honest', () => {
  const bars = (n: number, vol: (i: number) => number) => {
    const d = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    return { d, o: d.map(() => 10), h: d.map((_, i) => 20 + i), l: d.map(() => 5), c: d.map(() => 15), v: d.map((_, i) => vol(i)) };
  };
  test('21 sessions: figures are given, flagged partial, and the condition text says so', () => {
    const f = figuresFromBars(bars(21, () => 1000), '2027-01-01')!;
    assert.equal(f.hiBars, 21); assert.equal(f.volBars, 21); assert.equal(f.hi52, 40);
    const r = evalCondition({ type: 'high_52w' }, q(41), f, undefined, 'D', '2027-01-01');
    assert.equal(r.met, true); assert.equal(r.note, 'since listing, 21 sessions');
    const rv = evalCondition({ type: 'rel_volume', value: 2 }, q(41, { volume: 5000 }), f, undefined, 'D', '2027-01-01');
    assert.equal(rv.note, 'average of 21 sessions with volume data');
    assert.equal(condTextWithNotes({ conditions: [{ type: 'high_52w' }], interval: 'D' }, [r.note]), 'New 52-week high (since listing, 21 sessions)');
    assert.equal(figuresFromBars(bars(19, () => 1), '2027-01-01')!.hi52, null, 'under 20 sessions: nothing');
  });
  test('a full year: no note; zero volume counts as zero, missing volume is left out', () => {
    const f = figuresFromBars(bars(300, (i) => (i >= 250 ? (i % 2 ? 0 : 200) : 100)), '2027-12-31')!;
    assert.equal(f.hiBars, 252); assert.equal(f.volBars, 50);
    assert.equal(f.avgVol50, 100, 'zero-volume sessions pull the average down (25 × 200 + 25 × 0) / 50');
    assert.equal(evalCondition({ type: 'high_52w' }, q(1), f, undefined, 'D', '2027-12-31').note, undefined);
    const g = figuresFromBars(bars(300, (i) => (i >= 290 ? NaN : 100)), '2027-12-31')!;
    assert.equal(g.volBars, 40, 'ten sessions without volume data are missing, not zero');
    assert.equal(g.avgVol50, 100);
    assert.equal(f.v, FIGS_VERSION, 'versioned so older stored figures are fetched again');
  });
});

describe('Postgres (scratch database, ZZZ1063_PG_URL)', { skip: !process.env.ZZZ1063_PG_URL }, () => {
  test('migration 9 applies; commit + outbox + SKIP LOCKED claim + retry + crossing state round trip', async () => {
    process.env.DATABASE_URL = process.env.ZZZ1063_PG_URL;
    const { ensureSchema } = await import('../db-migrate');
    const { getPool } = await import('../db');
    assert.equal(await ensureSchema(), true);
    const pool = getPool()!;
    await pool.query("TRUNCATE price_alert_outbox, price_alert_event, price_alert_cross, price_alert RESTART IDENTITY CASCADE");
    const store = await import('../alerts/store');
    const a = await store.createAlert({ name: 'T', target: { kind: 'ticker', id: 'IN:HAL' }, conditions: [{ type: 'price_cross_up', value: 100 }], interval: 'D', trigger: 'once', session: 'regular', expiresAt: null, message: 'm', notify: { app: true, toast: true, browser: false, telegram: true, email: true, push: true } });
    const ev = { alertId: a.id, alertName: 'T', mid: 'IN:HAL', market: 'IN', ticker: 'HAL', name: null, price: 101, changePct: 1, condition: 'c', list: null, message: 'HAL crossed', dedupeKey: 'once', toast: true, browser: false };
    const inp = { events: [ev], channelsFor: () => ['telegram', 'email', 'push'] as any, cross: [{ alertId: a.id, version: a.version, mid: 'IN:HAL', states: [1] }], statusFor: () => 'triggered' as const };
    const c1 = await store.commitRun(inp);
    assert.equal(c1.inserted.length, 1); assert.equal(c1.outbox, 3);
    const c2 = await store.commitRun(inp);
    assert.equal(c2.inserted.length, 0, 'the dedupe index refuses the same once-fire'); assert.equal(c2.outbox, 0);
    assert.equal((await store.getAlert(a.id))!.status, 'triggered');
    const cross = await store.loadCrossStates([{ id: a.id, version: a.version }]);
    assert.deepEqual(cross.get(`${a.id}|${a.version}|IN:HAL`), [1]);
    // two concurrent claimers get disjoint rows
    const [x, y] = await Promise.all([store.claimOutbox(2), store.claimOutbox(2)]);
    const ids = [...x, ...y].map((r) => r.id).sort();
    assert.deepEqual(ids, [1, 2, 3], 'every row claimed exactly once');
    assert.equal((await store.claimOutbox(10)).length, 0, 'leased rows are not due');
    await store.finishOutbox([{ ids: [1], status: 'sent', error: null, delayMin: null }, { ids: [2], status: 'failed', error: 'email timeout', delayMin: 1 }, { ids: [3], status: 'skipped', error: 'no device', delayMin: null }]);
    const del = await store.deliveryFor([c1.inserted[0].id]);
    assert.deepEqual(Object.fromEntries(Object.entries(del.get(c1.inserted[0].id)!).map(([k, v]) => [k, v!.state])), { telegram: 'sent', email: 'failed', push: 'skipped' });
    await pool.query("UPDATE price_alert_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = 2");
    const again = await store.claimOutbox(10);
    assert.deepEqual(again.map((r) => [r.id, r.attempts]), [[2, 2]], 'the failed row comes back with its try count');
    const sum = await store.deliverySummary();
    assert.equal(sum.telegram.sent, 1); assert.equal(sum.email.pending, 1);
    // Rearm: new generation, watched again; the next once-fire gets a new key
    const re = await store.rearmAlert(a.id, (await store.getAlert(a.id))!.version);
    assert.equal(re.armGen, 1); assert.equal(re.status, 'active');
    const c3 = await store.commitRun({ ...inp, events: [{ ...ev, dedupeKey: dedupeKey('once', 'IN', 'D', IN_OPEN, re.armGen) }], cross: [] });
    assert.equal(c3.inserted.length, 1);
    // cosmetic edit keeps "triggered"
    const after = (await store.getAlert(a.id))!;
    assert.equal(after.status, 'triggered');
    const ed = await store.updateAlert(a.id, { ...after, name: 'Renamed' }, after.version);
    assert.equal(ed.status, 'triggered', 'a rename does not pretend to watch');
    const ed2 = await store.updateAlert(a.id, { ...ed, conditions: [{ type: 'price_cross_up', value: 120 }] }, ed.version);
    assert.equal(ed2.status, 'active', 'a condition edit watches again (as before)');
    await pool.end();
    (globalThis as any).__MC_PG_POOL__ = undefined;
  });
});
