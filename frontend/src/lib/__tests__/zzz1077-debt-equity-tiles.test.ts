// zzz1077 — DEBT / EQUITY on every Earnings Opportunities card (India + USA) and both Conviction Beats, coloured like the
// other figures (green ≤ 0.5×, amber to 1×, red above; lenders n/a; unknown "—" with the reason, never invented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deCell, TONE_COLOR } from '../cb-metric-view';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

test('the colour rule and the words', () => {
  assert.equal(deCell(0.16, 'fiscal year', false).tone, 'good');
  assert.equal(deCell(0.8, 'latest quarter', false).tone, 'warn');
  assert.equal(deCell(2.63, 'fiscal year', false).tone, 'bad');
  assert.equal(deCell(0.01, 'fiscal year', false).text, 'debt-free');
  assert.equal(deCell(0.5, 'fiscal year', true).text, 'n/a (lender)');
  assert.equal(deCell(undefined, undefined, false).text, '—');
  assert.ok(TONE_COLOR.good && TONE_COLOR.bad);
});

test('India Earnings Opportunities: a DEBT / EQUITY tile beside cash, fed for every card on screen', () => {
  const s = read('app/(dashboard)/earnings-opportunities/page.tsx');
  assert.match(s, /<DeTile stock=\{stock\} \/>/);   // zzz1089 — the tile reads the row (kind of financial company) + the page fallback
  assert.match(s, /useDebtEquityIndex\(deTickers, 'IN'\)/);
  assert.match(s, /<DebtEquityContext\.Provider value=\{deIdx\}>/);
  assert.match(s, /label="DEBT \/ EQUITY"/);
});

test('USA: the shared card has the tile; Earnings Opportunities and US Conviction Beats both provide the figures', () => {
  const card = read('components/us-earnings-card.tsx');
  assert.match(card, /label="DEBT \/ EQUITY"/);
  assert.match(card, /useDebtEquityOf\(\(r as any\)\.ticker\)/);
  const eo = read('app/(dashboard)/us-earnings-opportunities/page.tsx');
  assert.match(eo, /useDebtEquityIndex\(deTickers, 'US'\)/);
  assert.match(eo, /<DebtEquityContext\.Provider value=\{deIdx\}>/);
  const cb = read('app/(dashboard)/us-conviction-beats/page.tsx');
  assert.match(cb, /<DebtEquityContext\.Provider value=\{deIdx\}>/);
  assert.doesNotMatch(cb, /Chip text=\{`D\/E \$\{dc\.text\}`\}/, 'no second, smaller D/E chip on the same card');
});

test('India Conviction Beats keeps its D/E on the card (same chip style as its other figures)', () => {
  assert.match(read('app/(dashboard)/watchlists/ConvictionTable.tsx'), /testId="cb-de"/);
});

test('the lookup asks in chunks so a 60-day window (more than 300 names) is covered', () => {
  const h = read('lib/use-debt-equity.ts');
  assert.match(h, /const CHUNK = 300/);
  assert.match(h, /chunks\.map/);
});
