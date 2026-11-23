import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labSignals, reinvestment, evFcf, impliedGrowth, type SignalInput } from '../company-lab/signals';
import { labScore } from '../company-lab/score';

const none: SignalInput = { fcf: null, cfoPat: null, squeeze: null, epsG: null, dilution: null, accel: null, gmChg: null, omChg: null, r40: null, rs: null, de: null };
const ids = (x: Partial<SignalInput>) => labSignals({ ...none, ...x }).map((s) => s.id).sort();

test('red-flag combinations fire only when every part is there; missing figures never fire', () => {
  assert.deepEqual(ids({}), []);
  assert.deepEqual(ids({ fcf: -10, cfoPat: 0.4, squeeze: 'High' }), ['R1']);
  assert.deepEqual(ids({ fcf: -10, cfoPat: 0.4, squeeze: 'Medium' }), []);
  assert.deepEqual(ids({ epsG: 60, dilution: 15, cfoPat: 0.5 }), ['R2']);
  assert.deepEqual(ids({ epsG: 60, dilution: 15 }), []);                       // CFO/PAT unknown → no flag
  assert.deepEqual(ids({ accel: 'accelerating', gmChg: -3 }), ['R3']);
  assert.deepEqual(ids({ accel: 'accelerating', omChg: -3 }), ['R3']);         // gross margin missing → operating margin
  assert.deepEqual(ids({ accel: 'steady', gmChg: -3 }), []);
  assert.deepEqual(ids({ accel: 'accelerating', gmChg: -2, omChg: 2 }), []);   // operating margin made it up
  assert.deepEqual(ids({ accel: 'accelerating', gmChg: -2, omChg: 0.5 }), ['R3']);
  assert.deepEqual(ids({ r40: 55, de: 1.6 }), ['R4']);
  assert.deepEqual(ids({ rs: 90, squeeze: 'High' }), ['R4']);
});

test('positive combinations need every part known', () => {
  assert.deepEqual(ids({ fcf: 50, cfoPat: 1.2, de: 0.2, dilution: 1 }), ['P1']);
  assert.deepEqual(ids({ fcf: 50, cfoPat: 1.2, de: 0.2 }), []);               // dilution unknown
  assert.deepEqual(ids({ gmChg: 2, omChg: 3, accel: 'accelerating', epsG: 30 }), ['P2']);
});

test('reinvestment, EV/FCF and market-implied growth', () => {
  const r = reinvestment([{ label: 'FY23', netIncome: 100, equity: 1000, debt: 0 }, { label: 'FY25', netIncome: 150, equity: 1200, debt: 50 }]);
  assert.equal(r.pct, 20);
  assert.equal(reinvestment([{ label: 'FY25', netIncome: 1, equity: 1, debt: 0 }]).pct, null);
  const e = evFcf(1000, 200, 100, 50);
  assert.equal(e.ev, 1100); assert.equal(e.multiple, 22);
  assert.equal(evFcf(1000, 0, 0, -5).multiple, null);
  const cheap = impliedGrowth(500, 50, 'US').g!, dear = impliedGrowth(5000, 50, 'US').g!;
  assert.ok(cheap < dear, `${cheap} < ${dear}`);
  assert.equal(impliedGrowth(500, -1, 'IN').g, null);
});

test('a red flag caps the overall score at 60', () => {
  const base = { revQ: 40, accel: 'accelerating', epsG: 50, revY: 30, r40: 45, om: 18, omChg: 3, gmChg: 1, fcfPassed: 5, fcfKnown: 7, fcfM: 6, cfoPat: 1, de: 0.3, squeeze: 'Low', dilution: 1, stage: 2, tt: 6, rs: 92 } as const;
  const clean = labScore({ ...base });
  const flagged = labScore({ ...base, redFlags: ['Cash stress'] });
  assert.ok(clean.score! > 60);
  assert.ok(flagged.score! <= 60, `got ${flagged.score}`);
});

test('zzz1299: return on new capital is not shown when capital barely grew, and is bounded', () => {
  // ADROITIND-like: capital +5% → small-base artefact
  assert.equal(reinvestment([{ label: 'FY23', netIncome: 10, equity: 100, debt: 0 }, { label: 'FY26', netIncome: 24, equity: 105, debt: 0 }]).pct, null);
  assert.equal(reinvestment([{ label: 'FY23', netIncome: 10, equity: 100, debt: 0 }, { label: 'FY26', netIncome: 40, equity: 120, debt: 0 }]).pct, 100);
});
