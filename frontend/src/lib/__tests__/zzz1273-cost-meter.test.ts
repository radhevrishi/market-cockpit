import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appFrame, routeFamily, noteBody, noteRequest, fetchMeterReport } from '../fetch-meter';
import { SUBS_SKIP_FORM, FACTS_MAX, FACTS_MAX_CHARS } from '../us-edgar';
import { dailyCapUsd } from '../us-guide-check';

test('zzz1273 submissions list drops forms no reader uses, keeps every form a reader uses', () => {
  for (const f of ['4', '4/A', '3', '5', '144', '424B2', '424B5', 'FWP', '13F-HR', 'SC 13G', 'SC 13G/A', 'S-8', 'D', 'D/A', 'N-PX', '497K', '485BPOS'])
    assert.ok(SUBS_SKIP_FORM.test(f), f);
  for (const f of ['8-K', '8-K/A', '10-Q', '10-K', '10-K/A', '20-F', '40-F', '6-K', 'SC TO-T', 'SC TO-I', 'SC 14D9', 'SC 13E3', 'SC 13D', 'SC 13D/A',
    'S-4', 'F-4', '425', 'DEFM14A', 'PREM14A', 'DEFA14A', 'DEF 14A', 'S-1', 'S-3'])
    assert.ok(!SUBS_SKIP_FORM.test(f), f);
});

test('zzz1273 smaller SEC company-file cache; US web check default ceiling lowered', () => {
  assert.equal(FACTS_MAX, 30); assert.equal(FACTS_MAX_CHARS, 16 * 1024 * 1024);
  const prev = process.env.US_GUIDE_CHECK_DAILY_USD; delete process.env.US_GUIDE_CHECK_DAILY_USD;
  assert.equal(dailyCapUsd(), 0);   // zzz1274 — off unless set in Railway
  process.env.US_GUIDE_CHECK_DAILY_USD = '1'; assert.equal(dailyCapUsd(), 1);   // the owner's setting still wins
  if (prev == null) delete process.env.US_GUIDE_CHECK_DAILY_USD; else process.env.US_GUIDE_CHECK_DAILY_USD = prev;
});

test('zzz1273 meter: app frame, route family, counters', () => {
  const st = 'Error\n    at x (/app/node_modules/next/dist/a.js:1:1)\n    at M (/app/.next/server/chunks/src_lib_us-edgar_ts_1z-98oc._.js:1:5444)\n';
  assert.equal(appFrame(st), 'src_lib_us-edgar:5444');
  assert.equal(routeFamily('/api/v1/guidance-universe/list?x=1'), '/api/v1/guidance-universe');
  assert.equal(routeFamily('/api/market/quotes'), '/api/market');
  assert.equal(routeFamily('/charts'), 'page');
  noteBody('t-site', 'json', 100); noteBody('t-site', 'json', 2 * 1048576);
  noteRequest('/api/v1/news', 'anon'); noteRequest('/api/v1/news', 'anon');
  const r = fetchMeterReport(400);
  const b = r.bigBodies.find((x) => x.site === 't-site');
  assert.ok(b && b.n === 1 && b.maxMb === 2);
  assert.equal(r.traffic.find((x) => x.key === 'anon /api/v1/news')?.n, 2);
});
