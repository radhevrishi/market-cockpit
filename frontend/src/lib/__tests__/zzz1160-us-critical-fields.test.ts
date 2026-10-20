// zzz1160 — US cards: revenue and a margin are critical fields. A 10-K's mis-tagged quarter never replaces the 10-Q figure; the
// release's own total-revenue row is read when its year-ago column differs from the XBRL tag; the card always says why revenue is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conceptSeries } from '../us-earnings-core';
import { financialsFromReleaseHtml } from '../us-pr-financials';

test('a later 10-K quarter value far from the 10-Q one does not replace it (Vicor $407.7M vs $110.4M)', () => {
  const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [
    { start: '2025-07-01', end: '2025-09-30', val: 110423000, form: '10-Q', filed: '2025-10-30' },
    { start: '2025-07-01', end: '2025-09-30', val: 407701000, form: '10-K', filed: '2026-02-25' },
    { start: '2025-04-01', end: '2025-06-30', val: 90000000, form: '10-Q', filed: '2025-07-30' },
    { start: '2025-04-01', end: '2025-06-30', val: 91000000, form: '10-K', filed: '2026-02-25' },
  ] } } } } };
  const s = conceptSeries(facts, 'Revenues');
  assert.equal(s.find((x) => x.end === '2025-09-30')!.val, 110423000);
  assert.equal(s.find((x) => x.end === '2025-06-30')!.val, 91000000, 'a small restatement still wins');
});

test('the release total-revenue row is read when its year-ago column differs from the XBRL tag (GM)', () => {
  const html = `<html><body><p>General Motors reported third-quarter 2026 results.</p><table>
    <tr><td></td><td>Three Months Ended September 30, 2026</td><td>Three Months Ended September 30, 2025</td></tr>
    <tr><td>Total net sales and revenue</td><td>$ 50,015</td><td>$ 48,591</td></tr>
    <tr><td>Net income attributable to stockholders</td><td>$ 3,335</td><td>$ 1,327</td></tr>
  </table></body></html>`;
  const pr = financialsFromReleaseHtml(html, { revenue: 44256000000, operating_income: null, net_income: 1327000000, eps: null }, { reportedPeriodEnd: '2026-09-30' });
  assert.equal(pr.revenue, 50015000000); assert.equal(pr.revenue_prev, 48591000000);
  assert.match(String(pr.revenue_basis), /total-revenue row/);
});

test('the card never drops revenue silently; a net margin shows when there is no operating line', () => {
  const c = readFileSync(new URL('../../components/us-earnings-card.tsx', import.meta.url), 'utf8');
  assert.match(c, /'n\/a \(bank\)' : 'Not read yet'/);
  assert.match(c, /label="NET MARGIN"/);
});
