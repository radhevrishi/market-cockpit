import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_US_SCAN_CRITERIA, parseUsScanCriteria, criteriaHash, scanFilters, describeCriteria,
  parseScreenerLink, criteriaFromTvRequest, screenOptionsFor, isDefaultCriteria, US_SCAN_LIMIT_MAX, type UsScanCriteria,
} from '../ai-gainers/us-scan-criteria';
import { liveScanBody, fetchUsLiveGainers, rowFromScan } from '../ai-gainers/us-live-gainers';
import { screenUsGainers } from '../ai-gainers/us-gainers';

const def = (): UsScanCriteria => ({ ...DEFAULT_US_SCAN_CRITERIA, exchanges: [...DEFAULT_US_SCAN_CRITERIA.exchanges] });
const f = (b: any, left: string) => b.filter.find((x: any) => x.left === left);

test('defaults keep the small/mid focus: ≥4%, $300M–$10B, 300k avg vol, NASDAQ/NYSE/AMEX, common stock; row limit 500', () => {
  const b: any = liveScanBody();
  assert.deepEqual(f(b, 'change'), { left: 'change', operation: 'egreater', right: 4 });
  assert.deepEqual(f(b, 'market_cap_basic').right, [300e6, 10e9]);
  assert.deepEqual(f(b, 'exchange').right, ['NASDAQ', 'NYSE', 'AMEX']);
  assert.equal(f(b, 'average_volume_30d_calc').right, 300_000);
  assert.deepEqual(b.range, [0, 500]);
  assert.equal(b.sort.sortBy, 'change');
  // common stock only, the way TradingView's screener sends "Symbol type"
  assert.equal(b.filter2.operands.length, 1);
  assert.match(JSON.stringify(b.filter2), /"typespecs","operation":"has","right":\["common"\]/);
});

test('criteria → request body: no ceiling, lower change floor, ADRs, OTC, price floor, primary only', () => {
  const c = parseUsScanCriteria({ minChangePct: 3, maxMcapUsd: null, exchanges: ['NASDAQ', 'NYSE', 'AMEX', 'OTC'], includeDr: true, minPrice: 5, primaryOnly: true, minAvgVol30d: '' }).criteria;
  const b: any = liveScanBody(c);
  assert.equal(f(b, 'change').right, 3);
  assert.deepEqual(f(b, 'market_cap_basic'), { left: 'market_cap_basic', operation: 'egreater', right: 300e6 });
  assert.ok(f(b, 'exchange').right.includes('OTC'));
  assert.equal(f(b, 'average_volume_30d_calc'), undefined, 'empty avg volume = no floor');
  assert.deepEqual(f(b, 'close'), { left: 'close', operation: 'egreater', right: 5 });
  assert.deepEqual(f(b, 'is_primary'), { left: 'is_primary', operation: 'equal', right: true });
  assert.equal(b.filter2.operands.length, 2);
  assert.match(JSON.stringify(b.filter2), /"right":"dr"/);
  // only a ceiling
  const onlyMax = scanFilters({ ...def(), minMcapUsd: null, maxMcapUsd: 2e9 }).filter.find((x) => x.left === 'market_cap_basic');
  assert.deepEqual(onlyMax, { left: 'market_cap_basic', operation: 'eless', right: 2e9 });
  // no cap bounds at all
  assert.equal(scanFilters({ ...def(), minMcapUsd: null, maxMcapUsd: null }).filter.find((x) => x.left === 'market_cap_basic'), undefined);
});

test('the request actually sent carries the criteria', async () => {
  let sent: any = null;
  const fake = (async (_u: string, init: any) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ totalCount: 88, data: [] }) }; }) as any;
  const c = parseUsScanCriteria({ maxMcapUsd: null, limit: 700 }).criteria;
  const r = await fetchUsLiveGainers(new Date('2026-09-24T15:00:00Z'), fake, c);
  assert.equal(r.totalCount, 88);
  assert.deepEqual(sent.range, [0, 700]);
  assert.equal(sent.filter.find((x: any) => x.left === 'market_cap_basic').operation, 'egreater');
});

test('cache-key hash: changes with any scan field, ignores the link and timestamp, stable across exchange order', () => {
  const base = def();
  const h = criteriaHash(base);
  assert.match(h, /^[0-9a-z]+$/);
  assert.equal(criteriaHash(def()), h, 'deterministic');
  for (const patch of [{ minChangePct: 3 }, { maxMcapUsd: null }, { maxMcapUsd: 20e9 }, { minAvgVol30d: 100_000 }, { includeDr: true },
    { exchanges: ['NASDAQ', 'NYSE'] }, { limit: 600 }, { primaryOnly: true }, { minPrice: 1 }] as Partial<UsScanCriteria>[]) {
    assert.notEqual(criteriaHash({ ...base, ...patch }), h, `hash must change for ${JSON.stringify(patch)}`);
  }
  assert.equal(criteriaHash({ ...base, screenerUrl: 'https://www.tradingview.com/screener/Neuim2Bm/', updatedAt: '2026-09-24T20:00:00Z' }), h);
  assert.equal(criteriaHash({ ...base, exchanges: ['AMEX', 'NYSE', 'NASDAQ'] }), h);
  assert.ok(isDefaultCriteria(base));
  assert.ok(!isDefaultCriteria({ ...base, maxMcapUsd: null }));
});

test('route cache key carries the criteria hash (a criteria change is never served a stale list)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../app/api/v1/ai-gainers/route.ts', import.meta.url), 'utf8');
  assert.match(src, /ai-gainers:v5:US:\$\{etToday\(\)\}:\$\{usKeyPhase\}:\$\{limit\}:\$\{criteriaHash\(usCriteria!\)\}/);
  assert.doesNotMatch(src, /ai-gainers:v4:US/);
});

test('parsing stored criteria: bad values fall back with a reason, strings are read, bounds are sane', () => {
  const empty = parseUsScanCriteria(null);
  assert.deepEqual(empty.criteria, def());
  assert.equal(empty.problems.length, 0);

  const s = parseUsScanCriteria({ minChangePct: '3.5', minMcapUsd: '250,000,000', maxMcapUsd: 0, minAvgVol30d: -5, exchanges: 'nasdaq, arca, xyz', includeCommon: 'false', includeDr: true, limit: '999999' });
  assert.equal(s.criteria.minChangePct, 3.5);
  assert.equal(s.criteria.minMcapUsd, 250e6);
  assert.equal(s.criteria.maxMcapUsd, null, '0 = no ceiling');
  assert.equal(s.criteria.minAvgVol30d, 300_000, 'negative → default kept');
  assert.deepEqual(s.criteria.exchanges, ['NASDAQ', 'AMEX'], 'ARCA maps to AMEX; unknown dropped');
  assert.equal(s.criteria.includeCommon, false);
  assert.equal(s.criteria.includeDr, true);
  assert.equal(s.criteria.limit, US_SCAN_LIMIT_MAX);
  assert.ok(s.problems.some((p) => /minAvgVol30d/.test(p)));

  const swapped = parseUsScanCriteria({ minMcapUsd: 10e9, maxMcapUsd: 300e6 });
  assert.equal(swapped.criteria.minMcapUsd, 300e6); assert.equal(swapped.criteria.maxMcapUsd, 10e9);
  assert.ok(swapped.problems.some((p) => /swapped/.test(p)));

  const none = parseUsScanCriteria({ includeCommon: false, includePreferred: false, includeDr: false, exchanges: [] });
  assert.equal(none.criteria.includeCommon, true, 'never an empty type set');
  assert.deepEqual(none.criteria.exchanges, ['NASDAQ', 'NYSE', 'AMEX'], 'never an empty exchange set');

  assert.equal(parseUsScanCriteria({ minChangePct: 'abc' }).criteria.minChangePct, 4);
  assert.equal(parseUsScanCriteria({ limit: 0 }).criteria.limit, 500);
  assert.equal(parseUsScanCriteria({ limit: 1 }).criteria.limit, 1);
});

test('summary line reads like the owner\'s screener', () => {
  assert.equal(describeCriteria(def()), 'change ≥ 4% · cap $300M–$10B · avg vol (30d) ≥ 300k · exchanges NASDAQ/NYSE/AMEX · common');
  const c = parseUsScanCriteria({ minChangePct: 3, maxMcapUsd: null, includeDr: true, minAvgVol30d: null }).criteria;
  assert.equal(describeCriteria(c), 'change ≥ 3% · cap ≥ $300M (no maximum) · any avg volume · exchanges NASDAQ/NYSE/AMEX · common + ADR/DR');
});

test('a TradingView screener link carries only an ID — said in plain words; pasted filter JSON is read', () => {
  const l = parseScreenerLink('https://www.tradingview.com/screener/Neuim2Bm/');
  assert.equal(l.kind, 'screener_link'); assert.equal(l.screenerId, 'Neuim2Bm'); assert.equal(l.criteria, null);
  assert.match(l.message, /only carries the screen.s ID/);
  assert.equal(parseScreenerLink('hello').kind, 'unknown');

  // The filters TradingView sent for the owner's saved screen (captured by the sync on 22 Sep).
  const j = criteriaFromTvRequest({ filter: [
    { left: 'close', operation: 'egreater', right: 5 },
    { left: 'change|1W', operation: 'greater', right: 9 },
    { left: 'market_cap_basic', operation: 'in_range', right: [300000000, 10000000000000] },
    { left: 'change', operation: 'egreater', right: 3 },
  ] });
  assert.equal(j.kind, 'tv_filter_json');
  assert.equal(j.criteria!.minPrice, 5);
  assert.equal(j.criteria!.minChangePct, 3);
  assert.equal(j.criteria!.minMcapUsd, 300e6);
  assert.equal(j.criteria!.maxMcapUsd, null, '$10T ceiling = no ceiling');
  assert.ok(j.unsupported.some((u) => u.startsWith('change|1W')));
  assert.equal(parseScreenerLink('[{"left":"change","operation":"egreater","right":2}]').criteria!.minChangePct, 2);
});

test('the downstream screen follows the owner\'s bounds: no ceiling keeps a $25B gainer; defaults still drop it', () => {
  const row = (t: string, ex: string, mcap: number, price = 12) => rowFromScan([t, ex, `${t} Inc.`, 6, mcap, price, 1e6, 2, 1, 5, 5, 5, 5, 5, 'Tech', 'stock', 'common'])!;
  const rows = [row('SMID', 'NASDAQ', 2e9), row('BIG', 'NYSE', 25e9), row('OTCQ', 'OTC', 900e6), row('PFD.PA', 'NYSE', 1e9)];
  assert.deepEqual(screenUsGainers(rows).kept.map((r) => r.ticker), ['SMID']);
  const owner = parseUsScanCriteria({ maxMcapUsd: null, exchanges: ['NASDAQ', 'NYSE', 'OTC'], includePreferred: true }).criteria;
  assert.deepEqual(screenUsGainers(rows, screenOptionsFor(owner)).kept.map((r) => r.ticker), ['SMID', 'BIG', 'OTCQ', 'PFD.PA']);
  const capped = parseUsScanCriteria({ maxMcapUsd: 20e9 }).criteria;
  const ex = screenUsGainers(rows, screenOptionsFor(capped)).excluded.find((e) => e.ticker === 'BIG')!;
  assert.match(ex.reason, /above the \$20\.0B ceiling/);
});
