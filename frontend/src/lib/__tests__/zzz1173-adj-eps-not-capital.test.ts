// zzz1173 — LKFN Q3 2026: "PER SHARE DATA — Adjusted Tangible Capital (2) | 12.32 | … | 12.57" was read as adjusted EPS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adjustedEpsFromReleaseHtml } from '../us-pr-adjusted';

const html = `<html><body><table>
<tr><td></td><td>Three Months Ended September 30, 2026</td><td>Three Months Ended September 30, 2025</td></tr>
<tr><td>PER SHARE DATA</td><td></td><td></td></tr>
<tr><td>Diluted net income</td><td>1.14</td><td>1.03</td></tr>
<tr><td>Adjusted Tangible Capital (2)</td><td>12.32</td><td>12.57</td></tr>
</table></body></html>`;

test('the real LKFN release tables: no adjusted EPS read (the bank publishes none)', () => {
  const real = readFileSync(new URL('./fixtures/zzz1173-lkfn-per-share.html', import.meta.url), 'utf8');
  assert.equal(adjustedEpsFromReleaseHtml(real, { gaapEps: 1.14, periodEndISO: '2026-09-30' }), null);
});

test('a per-share capital / book figure is never adjusted EPS', () => {
  const r = adjustedEpsFromReleaseHtml(html, { gaapEps: 1.14, periodEndISO: '2026-09-30' });
  assert.ok(r == null || r.value < 5, `read ${r?.value} from "${r?.label}"`);
});

test('a real adjusted EPS row is still read', () => {
  const ok = html.replace('Adjusted Tangible Capital (2)', 'Adjusted diluted earnings per share').replace('12.32', '1.21').replace('12.57', '1.05');
  const r = adjustedEpsFromReleaseHtml(ok, { gaapEps: 1.14, periodEndISO: '2026-09-30' });
  assert.equal(r?.value, 1.21);
});
