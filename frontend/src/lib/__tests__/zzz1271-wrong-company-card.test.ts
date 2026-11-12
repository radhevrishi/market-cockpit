// zzz1271 — a company that reported earlier must never come back "today" under another symbol.
// 12 Nov 2026: "SHYAM" carried Shyam Metalics (shown 1 Nov as SHYAMMETL), "ARUR" carried Karur Vysya Bank (15 Oct, KARURVYSYA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickScreenerHit, symbolShortensName } from '../screener-slug-pick';
import { moveShownEarlier, earlierSightingFor, companyNameKey } from '../india-shown-earlier';

const read = (...p: string[]) => readFileSync(new URL(['..', '..', ...p].join('/'), import.meta.url), 'utf8');

test('the first fuzzy search result is never the company', () => {
  const shyam = [{ url: '/company/SHYAMMETL/consolidated/', name: 'Shyam Metalics & Energy Ltd' }, { url: '/company/SHYAMTEL/', name: 'Shyam Telecom Ltd' }];
  assert.equal(pickScreenerHit('SHYAM', shyam), null);
  assert.equal(pickScreenerHit('ARUR', [{ url: '/company/KARURVYSYA/', name: 'Karur Vysya Bank Ltd' }]), null);
});

test('the symbol’s own page, and a BSE-code-only company the symbol shortens, are accepted', () => {
  assert.equal(pickScreenerHit('SHYAMMETL', [{ url: '/company/SHYAMTEL/', name: 'Shyam Telecom Ltd' }, { url: '/company/SHYAMMETL/consolidated/', name: 'Shyam Metalics & Energy Ltd' }])!.slug, 'SHYAMMETL');
  assert.equal(pickScreenerHit('HAWAENG', [{ url: '/company/539176/', name: 'Hawa Engineers Ltd' }])!.slug, '539176');
  // two BSE-code-only companies fit: no guess
  assert.equal(pickScreenerHit('SHYAM', [{ url: '/company/512345/', name: 'Shyamkamal Investments Ltd' }, { url: '/company/523456/', name: 'Shyam Star Ltd' }]), null);
  // a BSE-code company whose name does not fit the symbol
  assert.equal(pickScreenerHit('ARUR', [{ url: '/company/590003/', name: 'Karur Vysya Bank Ltd' }]), null);
  assert.equal(symbolShortensName('ADCINDIA', 'ADC India Communications Ltd'), true);
  assert.equal(symbolShortensName('ARUR', 'Karur Vysya Bank Ltd'), false);
});

test('a card under another symbol is matched to the earlier day by company name + quarter', () => {
  assert.equal(companyNameKey('Shyam Metalics &amp; Energy Ltd', 'Q2 FY27'), companyNameKey('Shyam Metalics & Energy Limited', 'q2 fy27'));
  const idx = { withFigures: new Map<string, string>(), any: new Map<string, string>(), byName: new Map([[companyNameKey('Shyam Metalics &amp; Energy Ltd', 'Q2 FY27')!, { d: '2026-11-01', t: 'SHYAMMETL' }]]) };
  const card = { ticker: 'SHYAM', company: 'Shyam Metalics &amp; Energy Ltd', quarter: 'Q2 FY27', sales_curr_cr: 5960 };
  assert.deepEqual(earlierSightingFor(card, idx), { d: '2026-11-01', t: 'SHYAMMETL' });
  const out = moveShownEarlier({ by_tier: { BLOCKBUSTER: [card], STRONG: [{ ticker: 'NEWCO', company: 'New Co Ltd', quarter: 'Q2 FY27', sales_curr_cr: 1 }], MIXED: [], AVOID: [] } }, idx);
  assert.equal(out.by_tier.BLOCKBUSTER.length, 0);
  assert.equal(out.by_tier.STRONG.length, 1);
  assert.equal((out as any)._other_day_cards[0].ticker, 'SHYAMMETL');
  assert.match((out as any)._dropped[0].reason, /shown on 2026-11-01 as SHYAMMETL/);
  // another quarter of the same company is a new card
  assert.equal(earlierSightingFor({ ...card, quarter: 'Q3 FY27' }, idx), null);
});

test('no caller takes result #1 of a screener.in search', () => {
  for (const f of [['app', 'api', 'v1', 'earnings', 'enrich', 'route.ts'], ['app', 'api', 'v1', 'fin-fallback', 'route.ts'], ['app', 'api', 'earnings', 'india-screener', 'route.ts'], ['app', 'api', 'market', 'earnings-guidance', 'ingest', 'route.ts'], ['app', 'api', 'market', 'earnings-scan', 'route.ts']]) {
    const s = read(...f);
    assert.match(s, /pickScreenerHit\(/, f.join('/'));
    assert.doesNotMatch(s, /slugs\[0\]|results\[0\]\.url|\|\| arr\[0\]|fuzzy \|\| results\[0\]/, f.join('/'));
  }
});
