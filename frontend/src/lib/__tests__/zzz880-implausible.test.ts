import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implausibleImplied } from '../guidance-universe';
test('zzz880 — a guided amount implying an impossible change against last year is not company guidance', () => {
  const man = { gOrigin: 'IMPLIED', low: -99, high: -98.6, metric: 'REVENUE', abs: { value: 50, valueLow: 35, unit: '₹ Cr' }, base: { value: 3592.5, unit: '₹ Cr', period: 'FY26' } };
  assert.match(implausibleImplied(man)!, /35–50 ₹ Cr against last year's 3592\.5 ₹ Cr would be -99%/);
  assert.equal(implausibleImplied({ ...man, low: 39, high: 53 }), null, 'Man Industries 5,000–5,500 Cr = +39–53%: fine');
  assert.equal(implausibleImplied({ ...man, gOrigin: 'STATED' }), null, 'a stated % is the company\'s own words');
  assert.equal(implausibleImplied({ ...man, metric: 'PAT', low: 300, high: 400 }), null, 'a profit turnaround can be large');
  assert.ok(implausibleImplied({ ...man, low: 900, high: 950 }));
  assert.equal(implausibleImplied({ ...man, pkind: 'MULTI_YEAR_CAGR', low: -99 }), null);
});

import { buildUniverse } from '../guidance-universe';
import { actualKey } from '../guidance-extract-reader';
test('zzz880 — Man Industries: the later segment figure does not replace the FY27 company guide', () => {
  const row = (o: any) => ({ metric: 'REVENUE', metricLabel: 'revenue', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: 'INR', unit: 'crore', low: null, high: null, status: 'NEW', quote: 'q', confidence: 0.9, ...o });
  const res = (o: any) => ({ docId: 'd', market: 'IN', ticker: 'MANINDS', company: 'Man Industries (India) Ltd', docUrl: 'https://x/t.pdf', docKind: 'TRANSCRIPT', filedAt: '2026-05-27', extractedAt: 'x', model: 't', status: 'ok', rows: [], dropped: 0, ...o });
  const may = res({ docId: 'may', rows: [row({ low: 5000, high: 5500, quote: 'For FY27 we are guiding a consolidated revenue of ₹5,000 crore to ₹5,500 crore.' })] });
  const aug = res({ docId: 'aug', filedAt: '2026-08-18', rows: [row({ low: 35, high: 50, quote: 'this business should do ₹35 to 50 crore this year' })] });
  const act = new Map([[actualKey('IN', 'MANINDS', 'REVENUE', 'FY26'), { market: 'IN', ticker: 'MANINDS', metric: 'REVENUE', period: 'FY26', value: 3592.5, unit: '₹ Cr', source: 'FY26 results' } as any]]);
  const b = buildUniverse([], [], [], new Date('2026-10-05T10:00:00Z'), { extracted: { results: [may, aug] as any, actuals: act } });
  const man = b.defaultRecords.find((r: any) => (r.record?.ticker || '') === 'MANINDS');
  const pt = man?.points.find((p: any) => p.metric === 'REVENUE' && /FY27/.test(p.period));
  assert.ok(pt, 'FY27 revenue is active'); assert.match(String(pt!.display), /\+39|5,000/);
});
