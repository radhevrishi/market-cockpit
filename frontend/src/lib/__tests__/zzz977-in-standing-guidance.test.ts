import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inGuideLine, applyInGuideLine, standingGuidance } from '../in-guide-line';
import { standingDocIds } from '../in-guide-check';
import { planQueue } from '../ai-guidance-extract';

const julCall = { docId: 'd1', docKind: 'transcript', filedAt: '2026-08-05', docUrl: 'https://x/t.pdf', status: 'ok',
  rows: [{ metric: 'REVENUE_GROWTH', period: 'FY27', status: 'NEW', low: 20, high: 25, unit: '%', quote: 'We expect 20-25% revenue growth in FY27.' }] };
const row = (o: any = {}) => ({ ticker: 'ABC', tier: 'STRONG', quarter: 'Q2 FY27', filing_date: '2026-10-09', sales_yoy_pct: 31, ...o });

test('zzz977 no new call yet: the standing guidance from the last call, with this quarter’s pace against it', () => {
  const l = inGuideLine(row(), { standing: [julCall] });
  assert.equal(l.direction, 'standing');
  assert.equal(l.pace, 'ahead');
  assert.match(l.text, /^Standing guidance \(concall transcript, Aug 2026\): FY27 revenue growth/);
  assert.match(l.text, /running ahead/);
  assert.equal(inGuideLine(row({ sales_yoy_pct: 12 }), { standing: [julCall] }).pace, 'behind');
  assert.equal(inGuideLine(row({ sales_yoy_pct: 22 }), { standing: [julCall] }).pace, 'on-track');
  // shown, never moves the tier
  const r = row({ sales_yoy_pct: 5 });
  assert.equal(applyInGuideLine(r, { standing: [julCall] }), false);
  assert.equal(r.tier, 'STRONG');
});

test('zzz977 revenue guided in crore with last year stated → growth worked out for the pace', () => {
  const doc = { docKind: 'presentation', filedAt: '2026-07-30', rows: [{ metric: 'REVENUE', period: 'FY27', status: 'NEW', low: 1200, high: 1200, unit: 'crore', currency: 'INR', priorActual: { period: 'FY26', value: 1000, quote: 'FY26 revenue of ₹1,000 crore' }, quote: 'targeting ₹1,200 crore in FY27' }] };
  const s = standingGuidance(row({ sales_yoy_pct: 21 }), [doc]);
  assert.equal(s?.pace, 'on-track');
});

test('zzz977 the new call filed or announced but not read: said, with the standing guidance when there is one', () => {
  const pend = inGuideLine(row(), { pending: [{ kind: 'TRANSCRIPT', filedAt: '2026-10-11' }] });
  assert.equal(pend.direction, 'pending');
  assert.match(pend.text, /filed 11 Oct — in the reading queue/);
  const ann = inGuideLine(row(), { announced: [{ kind: 'TRANSCRIPT', filedAt: '2026-10-10' }] });
  assert.match(ann.text, /announced 10 Oct — document not out yet/);
  const both = inGuideLine(row(), { standing: [julCall], pending: [{ kind: 'PRESENTATION', filedAt: '2026-10-11' }] });
  assert.equal(both.direction, 'standing');
  assert.match(both.text, /new: investor presentation filed 11 Oct/);
  assert.match(inGuideLine(row(), {}).text, /No guidance on record/);
});

test('zzz977 a new cut this season still wins over the standing guidance', () => {
  const cut = { docKind: 'transcript', filedAt: '2026-10-12', rows: [{ metric: 'REVENUE_GROWTH', period: 'FY27', status: 'LOWERED', low: 12, high: 15, unit: '%', prior: { low: 20, high: 25, statedIn: 'Q1' }, quote: 'We now expect 12-15% growth.' }] };
  const r = row();
  assert.equal(applyInGuideLine(r, { extracts: [cut], standing: [julCall] }), true);
  assert.equal(r.tier, 'MIXED');
});

test('zzz977 standing documents are the previous season’s (3–200 days before), newest two', () => {
  const ids = standingDocIds([
    { docId: 'a', filedAt: '2026-10-08', extracted: true }, { docId: 'b', filedAt: '2026-08-05', extracted: true },
    { docId: 'c', filedAt: '2026-05-20', extracted: true }, { docId: 'd', filedAt: '2026-01-01', extracted: true }, { docId: 'e', filedAt: '2026-07-01', extracted: false },
  ], '2026-10-09');
  assert.deepEqual(ids, ['b', 'c']);
});

test('zzz977 the reader takes this season’s top-tier India companies first', () => {
  const doc = (docId: string, ticker: string, filedAt: string) => ({ docId, market: 'IN' as const, ticker, company: ticker, kind: 'TRANSCRIPT' as any, filedAt, url: '', textChars: 1000 });
  const plan = planQueue([doc('1', 'AAA', '2026-10-11'), doc('2', 'TOPCO', '2026-10-01'), doc('3', 'BBB', '2026-10-10')],
    { handoff: null, graded: null, verified: null, looked: new Set(), watched: null, readIndia: [], eoTop: new Set(['TOPCO']) });
  assert.equal(plan.rows[0].ticker, 'TOPCO');
});
