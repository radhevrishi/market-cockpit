// zzz1253 — Portfolio Catalysts judges Conviction Beats names with the screener figures; lenders are never capacity
// ramps; failing bench names and lender records leave Special Focus; mismatch line grouped by reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LENDING_WORDS } from '../catalyst/persistence';
import { splitOffLists } from '../catalyst/cross-view';
import { reconcileCbLists, filtersMatchSaved } from '../india-cb-view';

test('lending words', () => {
  assert.ok(LENDING_WORDS.test('Volume: disbursements are up by 45%'));
  assert.ok(LENDING_WORDS.test('loan book grew 22%'));
  assert.ok(!LENDING_WORDS.test('capacity added 4,000 tons; utilisation 59%'));
});

test('Special Focus: failing bench names and lender capacity records are off the lists', () => {
  const e = (row: any, pc: any = { kind: 'ORDER_VISIBILITY', mechanism: 'order book', runway: { text: '' } }) => ({ row, dismissed: false, pc });
  const ok = e({ origin: 'book' });
  const failing = e({ origin: 'bench', preset: { state: 'fail' } });
  const lender = e({ origin: 'bench', preset: { state: 'pass' } }, { kind: 'CAPACITY_RAMP', mechanism: 'in commercial production → utilisation 80% → volume rising', runway: { text: 'Volume: disbursements are up by 45%' } });
  const gone = e(null);
  const r = splitOffLists([ok, failing, lender, gone]);
  assert.deepEqual(r.onLists, [ok]);
  assert.equal(r.offLists.length, 3);
});

test('mismatch line groups names by reason and caps each group', () => {
  const pc = Array.from({ length: 20 }, (_, i) => `PC${i}`);
  const r = reconcileCbLists({ tickers: ['A', 'B'], savedCriteria: false, at: '2026-11-11T08:21:00Z' }, pc, () => null);
  assert.match(r.line, /2 only on the tab \(the tab was showing your own chips, not your saved criteria\): A, B/);
  assert.match(r.line, /20 only here \(.*\): PC0, .*PC11 \+8 more/);
});

test('Stage 2 counts as part of the saved criteria', () => {
  const src = readFileSync(new URL('../india-cb-view.ts', import.meta.url), 'utf8');
  assert.match(src, /'r40Min', 'stage2'\]/);
  assert.equal(typeof filtersMatchSaved, 'function');
});

test('Portfolio Catalysts asks the screener figures before judging the list', () => {
  const src = readFileSync(new URL('../thesis/use-book.ts', import.meta.url), 'utf8');
  assert.match(src, /const list = await withCbFigures\(listBare as any\[\], 'IN'\);/);
});
