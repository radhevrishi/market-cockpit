// zzz1147–1152 — 19 Oct evening: KV request size measured as sent, price facts in plain words on one line, stale cash years,
// missing company names, "no guidance on record" acted on, refresh message and pending reasons per day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestBytesOf } from '../kv';
import { priceContextWords } from '../earnings-grade-shared';
import { plainPriceSentences, cashYearTooOld, cashTileView } from '../india-eo-card-data';
import { needCallSlice } from '../need-call';
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('KV: the size checked is the value as sent (quotes escaped once more)', () => {
  const v = JSON.stringify({ a: '"'.repeat(1000) });
  assert.ok(requestBytesOf(v) > Buffer.byteLength(v) * 1.9);
  assert.match(src('lib/kv.ts'), /const wireBytes = requestBytesOf\(serialized\);\n  if \(wireBytes > KV_PACK_ABOVE_BYTES\)/);
});

test('price facts in plain words', () => {
  assert.equal(priceContextWords('sold off post-results', -8.6), 'fell sharply after the results (-8.6% on day 1)');
  assert.equal(priceContextWords('market rejected print', -4.4), 'fell after the results (-4.4% on day 1)');
  assert.equal(priceContextWords('stage 4 downtrend'), 'chart in a downtrend (stage 4)');
  assert.equal(priceContextWords('31% below its 52-week high'), '31% below its 52-week high');
  const old = 'X prints (revenue +19% YoY). Market reaction: D1 -8.6% after the print — a price move, not a verdict on the filing; it does not change the grade. Price context (not part of the grade): stage 4 downtrend, thin float. Size context (not part of the grade): very small company.';
  const t = plainPriceSentences(old);
  assert.match(t, /The share price fell 8\.6% the day after the results; that does not change the grade\./);
  assert.match(t, /Share price \(not part of the grade\): chart in a downtrend \(stage 4\), few shares trade freely\./);
  assert.match(t, /Size \(not part of the grade\): very small company\./);
  assert.doesNotMatch(t, /Market reaction|Price context|post-results/);
});

test('one price line, no separate "Price context" row, no duplicate reaction chip', () => {
  const p = src('app/(dashboard)/earnings-opportunities/page.tsx');
  assert.doesNotMatch(p, /Price context — not part of the grade:<\/span>/);
  assert.doesNotMatch(p, /price context · not graded/);
  assert.match(p, /share price — not part of the grade/);
  assert.match(p, /if \(_reaction\) return null;/);
});

test('a cash year years before the filing is not used (AksharChem "FY16")', () => {
  assert.equal(cashYearTooOld('Mar 2016', '2026-10-19'), true);
  assert.equal(cashYearTooOld('Mar 2026', '2026-10-19'), false);
  assert.equal(cashYearTooOld('Mar 2024', '2026-10-19'), false);
  const v = cashTileView({ cash_fy: 'Mar 2016', filing_date: '2026-10-19', ocf_to_pat_ratio: 0.76, ocf_annual_cr: 13, pat_annual_cr: 17 });
  assert.equal(v.text, '—'); assert.match(v.note, /Mar 2016 — too old to use/);
  const w = cashTileView({ cash_fy: 'Mar 2016', filing_date: '2026-10-19', ocf_to_pat_ratio: 0.76 }, { cfo: 30, pat: 20, fy: 'Mar 2026' });
  assert.equal(w.text, '1.50x'); assert.equal(w.basis, 'Mar 2026 full year');
});

test('companies with no guidance on record are looked up a slice at a time', () => {
  const m: Record<string, string> = {}; for (let i = 0; i < 30; i++) m[`T${i}`] = `2026-10-${String(1 + (i % 19)).padStart(2, '0')}`;
  const a = needCallSlice(m, new Date('2026-10-19T00:00:00Z')), b = needCallSlice(m, new Date('2026-10-19T02:00:00Z'));
  assert.equal(a.length, 12); assert.notDeepEqual(a, b);
  assert.deepEqual(needCallSlice({ BEPL: '2026-10-19', 'bad sym': '2026-10-19' }, new Date()), ['BEPL']);
  assert.match(src('lib/in-guide-check.ts'), /r\?\.guide_line\?\.direction === 'unknown'\) need\[/);
  assert.match(src('../../.github/scripts/scrape-guidance-docs.mjs'), /await sweepToken\(token, \{ since: needSince, cap: 2 \}\)/);
  assert.doesNotMatch(src('lib/in-guide-line.ts'), /no earlier call read and no call \/ deck filed yet/);
});

test('refresh message and pending reasons belong to their day', () => {
  const p = src('app/(dashboard)/earnings-opportunities/page.tsx');
  assert.match(p, /useEffect\(\(\) => \{ setRefreshFeedback\(null\); \}, \[resolvedDateForGrading\]\);/);
  assert.match(p, /checking the filings…/);
  assert.match(src('app/api/v1/earnings/graded/route.ts'), /await fillCompanyNames\(by_tier\);/);
});
