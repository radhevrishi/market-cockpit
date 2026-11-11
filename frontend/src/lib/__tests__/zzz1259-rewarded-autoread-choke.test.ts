import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardedWhy } from '../rewarded';
import { lateCurve } from '../choke-themes/core';
import { planAutoRead, runAutoRead, isBudgetRefusal, triesKey, dayKey } from '../us-thesis/auto-read';
import { chokeWeeklyDecision, isoWeekKey } from '../choke-themes/weekly';
import { APP_JOBS } from '../app-scheduler';

test('rewarded: 3M run with a rising year; rebound, RS alone and unknown handled', () => {
  assert.equal(rewardedWhy({ p3m: 55, p1y: 120 }).rewarded, true);
  assert.equal(rewardedWhy({ p3m: 55, p1y: -30 }).rewarded, false);          // rebound
  assert.equal(rewardedWhy({ p3m: 12, p1y: 60, rs: 96 }).rewarded, false);    // RS alone = the leaders
  assert.equal(rewardedWhy({ p3m: 28, p1y: 60, rs: 96 }).rewarded, true);
  assert.equal(rewardedWhy({ p3m: null }).rewarded, null);
  assert.equal(rewardedWhy(undefined).rewarded, null);
  assert.equal(rewardedWhy({ p3m: 39, p1y: 50 }).rewarded, false);
});

test('choke lateCurve now reasons on 3-month run too', () => {
  const f: any = { cap: 1, revQ: 1, revA: 1, epsQ: 1, opm: 1, pe: 20, fcfm: 1, de: 0, p1y: 90, p5y: 100 };
  assert.match(lateCurve({ ...f, p3m: 50 }).join(), /already rewarded/);
  assert.deepEqual(lateCurve({ ...f, p3m: 10 }), []);
});

test('auto-read plan: dedupe, tries cap, name cap', () => {
  const p = planAutoRead(['a', 'A', 'B', 'C'], { B: 2 }, 2);
  assert.deepEqual(p.pick, ['A', 'C']); assert.deepEqual(p.needsManual, ['B']);
  assert.ok(isBudgetRefusal(429, null)); assert.ok(isBudgetRefusal(200, 'daily limit reached')); assert.ok(!isBudgetRefusal(500, 'boom'));
});

function fakeKv() {
  const m = new Map<string, any>();
  return { m, kv: {
    get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); },
    setNX: async (k: string, v: any) => { if (m.has(k)) return false; m.set(k, v); return true; }, del: async (k: string) => { m.delete(k); },
    incrByFloat: async (k: string, by: number) => { const n = (Number(m.get(k)) || 0) + by; m.set(k, n); return n; },
  } as any };
}

test('auto-read: ceiling stops the run and refunds; failures counted; budget refusal stops', async () => {
  process.env.US_AUTO_READ_DAILY_USD = '0.07';
  const { m, kv } = fakeKv(); const calls: string[] = [];
  const r = await runAutoRead(['AAA', 'BBB', 'CCC', 'DDD'], { kv, deadline: Date.now() + 3_600_000, log: () => {},
    call: async (p) => { calls.push(p); return { ok: true, status: 200, json: { ok: true } }; } });
  assert.deepEqual(r.read, ['AAA', 'BBB']); assert.equal(r.stoppedBy, 'ceiling'); assert.equal(calls.length, 2);
  assert.ok(Math.abs(Number(m.get(dayKey())) - 0.06) < 1e-9);               // the refused reservation was handed back
  assert.ok(calls.every((c) => c.includes('mode=incremental') && !c.includes('force')));
  process.env.US_AUTO_READ_DAILY_USD = '1';
  const k2 = fakeKv();
  const r2 = await runAutoRead(['X', 'Y'], { kv: k2.kv, deadline: Date.now() + 3_600_000, log: () => {},
    call: async (p) => (p.includes('ticker=X') ? { ok: false, status: 500, json: { ok: false, error: 'boom' } } : { ok: true, status: 200, json: { ok: true, skipped: 'SKIPPED_NO_NEW_EVIDENCE' } }) });
  assert.deepEqual(r2.failed, ['X']); assert.deepEqual(r2.skipped, ['Y']); assert.equal(k2.m.get(triesKey('X')), 1);
  assert.ok(Math.abs(Number(k2.m.get(dayKey())) - 0.03) < 1e-9);             // zzz1262: a 5xx may come after the model was paid — its reservation stays; the skipped one is handed back
  const k2b = fakeKv();
  const r2b = await runAutoRead(['T1', 'T2'], { kv: k2b.kv, deadline: Date.now() + 3_600_000, log: () => {},
    call: async (p) => { if (p.includes('ticker=T1')) throw new Error('timeout'); return { ok: false, status: 400, json: { ok: false, error: 'a valid ticker is required' } }; } });
  assert.deepEqual(r2b.failed, ['T1', 'T2']);
  assert.ok(Math.abs(Number(k2b.m.get(dayKey())) - 0.03) < 1e-9);            // thrown call keeps its reservation; a 4xx refusal is handed back
  const k3 = fakeKv();
  const r3 = await runAutoRead(['P', 'Q'], { kv: k3.kv, deadline: Date.now() + 3_600_000, log: () => {}, call: async () => ({ ok: false, status: 429, json: { error: 'x' } }) });
  assert.equal(r3.stoppedBy, 'budget'); assert.equal(r3.failed.length, 0);
  delete process.env.US_AUTO_READ_DAILY_USD;
});

test('choke weekly: skip when fresh or tried twice; week key; job registered', () => {
  const now = new Date('2026-11-15T05:10:00Z');
  assert.equal(chokeWeeklyDecision('2026-11-02T10:00:00Z', 0, now).run, true);
  assert.equal(chokeWeeklyDecision('2026-11-13T10:00:00Z', 0, now).run, false);
  assert.equal(chokeWeeklyDecision('2026-11-02T10:00:00Z', 2, now).run, false);
  assert.equal(chokeWeeklyDecision(null, 0, now).run, true);
  assert.equal(isoWeekKey(new Date('2026-11-15T05:10:00Z')), '2026-W46');
  const j = APP_JOBS.find((x) => x.name === 'choke-themes-weekly'); assert.ok(j && j.crons[0] === '10 5 * * 0');
  assert.ok(APP_JOBS.find((x) => x.name === 'us-evidence-check')!.timeoutMs >= 40 * 60_000);
});
