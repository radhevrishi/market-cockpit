import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raiseLine, buildFocusList, isSmallEpsBase } from '../gu-focus';
import { fmtPoint } from '../guidance-upgrades';

const ch = (metric: string, b: [number, number], a: [number, number], pct: number, cur = '$', unit?: string) => ({
  metric, direction: 'UP', percentageChange: pct,
  before: { low: b[0], high: b[1], midpoint: (b[0] + b[1]) / 2, currency: cur, unit, period: 'FY27' },
  after: { low: a[0], high: a[1], midpoint: (a[0] + a[1]) / 2, currency: cur, unit, period: 'FY27' },
});
const ev = (id: string, changes: any[], extra: any = {}) => ({ guidance_event_id: id, company: id, ticker: id, market: 'US', announcement_date: '2026-08-27', verification: 'VERIFIED', taxonomy: 'formal_upgrade', changes, ...extra }) as any;

test('Rubrik: headline is the revenue/FCF raise, not EPS +67% from a $0.30 base', () => {
  const e = ev('RBRK', [ch('REVENUE', [1.638, 1.648], [1.685, 1.693], 2.8, '$', 'B'), ch('ADJ_EPS', [0.25, 0.35], [0.47, 0.53], 66.7), ch('FCF', [293, 303], [323, 333], 10.1, '$', 'M')]);
  const l = raiseLine(e)!;
  assert.equal(l.pct, 10.1);
  assert.match(l.text, /free cash flow/);
  assert.match(l.text, /small base/);
});
test('Fastly: only a small-base EPS raise → small raise, kept out of the strong list', () => {
  const e = ev('FSLY', [ch('ADJ_EPS', [0.27, 0.33], [0.5, 0.54], 73.3)]);
  const l = raiseLine(e)!;
  assert.equal(l.pct, null); assert.equal(l.smallBaseOnly, true);
  const rows = buildFocusList(null, [e], new Date('2026-10-06'));
  assert.equal(rows[0].smallRaise, true); assert.equal(rows[0].verdict, 'WATCH');
});
test('Kohl\'s EPS base $1.30 is not small; Planet Labs +0.6% is a small raise', () => {
  assert.equal(isSmallEpsBase(ch('ADJ_EPS', [1, 1.6], [1.8, 2.4], 61.5)), false);
  const rows = buildFocusList(null, [ev('KSS', [ch('ADJ_EPS', [1, 1.6], [1.8, 2.4], 61.5)]), ev('PL', [ch('REVENUE', [425, 441], [430, 441], 0.6, '$', 'M')])], new Date('2026-10-06'));
  assert.equal(rows.find((r) => r.ticker === 'KSS')!.verdict, 'STRONG RAISE');
  assert.equal(rows.find((r) => r.ticker === 'PL')!.smallRaise, true);
});
test('India EPS ₹3 base counts as small; pp raise is meaningful', () => {
  assert.equal(isSmallEpsBase(ch('EPS', [2, 4], [5, 6], 80, '₹')), true);
  const e = ev('EFCIL', [{ metric: 'REVENUE_GROWTH', direction: 'UP', percentagePointChange: 10, before: { low: 40, high: 40, midpoint: 40, isGrowthRate: true, period: 'FY27' }, after: { low: 50, high: 50, midpoint: 50, isGrowthRate: true, period: 'FY27' } }], { market: 'IN' });
  const rows = buildFocusList(null, [e], new Date('2026-10-06'));
  assert.equal(rows[0].smallRaise, false); assert.equal(rows[0].verdict, 'STRONG RAISE');   // zzz882: 40 → 50% is a 25% higher guided growth
});
test('range never prints two equal ends', () => {
  assert.equal(fmtPoint({ low: 1.685, high: 1.693, currency: '$', unit: 'B' } as any), '$1.685–1.693B');
  assert.equal(fmtPoint({ low: 425, high: 441, currency: '$', unit: 'M' } as any), '$425–441M');
});
test('Planet Labs: only the floor moved ($0–10M → $3–10M) is not a strong raise', () => {
  const e = ev('PL', [ch('EBITDA', [0, 10], [3, 10], 30, '$', 'M')]);
  const rows = buildFocusList(null, [e], new Date('2026-10-06'));
  assert.equal(rows[0].smallRaise, true); assert.notEqual(rows[0].verdict, 'STRONG RAISE');
});
test('zzz882: a growth-rate raise is sized by how much the guided growth rose (CP Plus 25–30% → 40–50%)', () => {
  const g = (lo: number, hi: number) => ({ low: lo, high: hi, midpoint: (lo + hi) / 2, isGrowthRate: true, period: 'FY27' });
  const e = ev('CPPLUS', [{ metric: 'REVENUE_GROWTH', direction: 'UP', percentagePointChange: 17.5, before: g(25, 30), after: g(40, 50) }], { market: 'IN' });
  const r = buildFocusList(null, [e], new Date('2026-10-06'))[0];
  assert.equal(r.raisePct, 63.6); assert.equal(r.verdict, 'STRONG RAISE'); assert.match(r.why, /growth rate/);
  assert.match(r.raised!, /\+17\.5 pp/);
});
