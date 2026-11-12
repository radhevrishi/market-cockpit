// zzz1270 — the SEC company-file cache is bounded by SIZE (it was 600 files ≈ 2 GB and filled the heap in results season),
// and a US grade build keeps only the recent data points of each file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factsEvictions, slimCompanyFacts, FACTS_MAX, FACTS_MAX_CHARS } from '../us-edgar';

const read = (...p: string[]) => readFileSync(new URL(['..', '..', ...p].join('/'), import.meta.url), 'utf8');

test('the budget is small: at most 60 files and 40 MB of text', () => {
  assert.ok(FACTS_MAX <= 60); assert.ok(FACTS_MAX_CHARS <= 40 * 1024 * 1024);
});

test('least recently used files leave until the new one fits', () => {
  const e = [{ key: 1, chars: 30 }, { key: 2, chars: 30 }, { key: 3, chars: 30 }];
  assert.deepEqual(factsEvictions(e, 90, 20, 100, 10), [1]);
  assert.deepEqual(factsEvictions(e, 90, 50, 100, 10), [1, 2]);
  assert.deepEqual(factsEvictions(e, 90, 5, 100, 10), []);
  assert.deepEqual(factsEvictions(e, 90, 1, 1000, 3), [1]);   // file-count limit
});

test('slim keeps recent points, drops old ones and empty tags, and leaves the full file untouched', () => {
  const full = { cik: 1, entityName: 'X', facts: { 'us-gaap': {
    Revenues: { label: 'Revenues', description: 'long text', units: { USD: [{ end: '2012-12-31', val: 1 }, { end: '2025-09-30', val: 9, fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-11-01' }] } },
    OldTag: { label: 'Old', units: { USD: [{ end: '2010-12-31', val: 1 }] } } },
    dei: { EntityCommonStockSharesOutstanding: { label: 'Shares', units: { shares: [{ end: '2025-10-20', val: 5 }] } } } } };
  const slim = slimCompanyFacts(full, '2021-05-12');
  assert.equal(slim.facts['us-gaap'].Revenues.units.USD.length, 1);
  assert.equal(slim.facts['us-gaap'].Revenues.units.USD[0].fp, 'Q3');
  assert.equal(slim.facts['us-gaap'].OldTag, undefined);
  assert.equal(slim.facts.dei.EntityCommonStockSharesOutstanding.units.shares[0].val, 5);
  assert.equal(full.facts['us-gaap'].Revenues.units.USD.length, 2);
  assert.equal(slimCompanyFacts(null, '2021-01-01'), null);
});

test('the US grade build slims every file it holds', () => {
  assert.match(read('app', 'api', 'v1', 'earnings', 'graded-us', 'route.ts'), /slimCompanyFacts\(await companyFacts\(x\.f\.cikNum\), factsSince\)/);
});
