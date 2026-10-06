// zzz926 — India showed 0 guidance raises in 120 days (US 106 on the focus list). Root causes fixed here:
//   1. the readers saw only the newest 2,500 extraction results, which hid India's older calls (the earlier guidance);
//   2. an earlier-document raise had to lift the floor above the old ceiling, so the usual 20–25% → 25–30% raise was thrown away
//      while any lower figure still counted as a cut;
//   3. a growth rate filed under REVENUE ("35% growth in our top line") never met the REVENUE_GROWTH figure of the other call;
//   4. the daily reading budget went to copies, decks of calls whose transcript waits, and large caps first.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractedEvents, normaliseRateRow } from '../guidance-upgrades';
import { earlierPriorMismatch, growthScopeIssue, GEO_PART } from '../guidance-prior-match';
import type { GuidanceExtractResult, ExtractedGuidance, GuidanceDocIndexRow } from '../guidance-docs-types';
import {
  syncMarketIndex, idsToRead, prependIds, appendIds, newAtFront, removeFromMarketIndexes, stateOf,
  MARKET_INDEX_KEY, MARKET_STATE_KEY, SHARED_OK_INDEX_KEY, MARKET_READ_CAP, type MarketIndexIo,
} from '../guidance-extract-market-index';
import { listExtractResults, EXTRACT_OK_INDEX_KEY, extractKey } from '../guidance-extract-reader';
import { planQueue, orderIndia } from '../ai-guidance-extract';

const row = (o: Partial<ExtractedGuidance>): ExtractedGuidance => ({
  metric: 'REVENUE_GROWTH', metricLabel: 'revenue growth', period: 'FY27', periodKind: 'ANNUAL', basis: 'REPORTED', currency: null, unit: '%', low: null, high: null, status: 'NEW',
  quote: 'quote', confidence: 0.9, ...o,
});
const res = (o: Partial<GuidanceExtractResult>): GuidanceExtractResult => ({
  docId: 'd', market: 'IN', ticker: 'ACME', company: 'Acme Ltd', docUrl: 'https://acme.example/t.pdf', docKind: 'TRANSCRIPT', filedAt: '2026-05-27', extractedAt: '2026-10-02T06:00:00Z',
  model: 'test', status: 'ok', rows: [], dropped: 0, ...o,
});
const NOW = new Date('2026-10-06T09:00:00Z');
const P = (raw: string, low: number, high: number) => ({ raw: `${raw} (earlier guidance: Earnings call transcript (X), 2026-05-20)`, low, high });
const A = (raw: string, low: number, high: number) => ({ raw, low, high });

describe('zzz926 — an India raise from the previous call (same measure, same scope, same year)', () => {
  test('20–25% in the May call → 25–30% in the August call is a raise (both ends up)', () => {
    assert.equal(earlierPriorMismatch(P('We expect revenue growth of 20% to 25% in FY27.', 20, 25), A('We now expect revenue growth of 25% to 30% for FY27.', 25, 30), 'REVENUE_GROWTH'), null);
    const may = res({ docId: 'may', filedAt: '2026-05-27', rows: [row({ low: 20, high: 25, quote: 'We expect revenue growth of 20% to 25% in FY27.' })] });
    const aug = res({ docId: 'aug', filedAt: '2026-08-12', rows: [row({ low: 25, high: 30, quote: 'We now expect revenue growth of 25% to 30% for FY27.' })] });
    const ev = buildExtractedEvents([may, aug], () => ({}), NOW, '120D').find((e) => e.announcement_date === '2026-08-12')!;
    const ch = ev.changes.find((c) => c.metric === 'REVENUE_GROWTH')!;
    assert.equal(ch.direction, 'UP'); assert.equal(ch.before!.low, 20); assert.equal(ev.taxonomy, 'formal_upgrade');
    assert.match(String(ch.before!.raw), /earlier guidance: .*2026-05-27/);
  });
  test('the strict rules still hold: narrowed, another measure, a segment, a region, the industry', () => {
    assert.ok(earlierPriorMismatch(P('AUM growth of 20% to 24%', 20, 24), A('the 22% to 24% corridor for AUM growth', 22, 24), 'REVENUE_GROWTH'), 'narrowed is not a raise');
    assert.ok(earlierPriorMismatch(P('deposit growth of 13% to 14%', 13, 14), A('advances growth of 16% to 18%', 16, 18), 'REVENUE_GROWTH'), 'deposits vs advances');
    assert.ok(earlierPriorMismatch(P('revenue growth of 20%', 20, 20), A('exports to grow 30%', 30, 30), 'REVENUE_GROWTH'), 'segment');
    assert.ok(earlierPriorMismatch(P('consolidated revenue of ₹5,000 to 5,500 crores for FY27', 5000, 5500), A('Currently, with Saudi around INR1,200 crores, India would be around INR3,800 crores.', 3800, 3800), 'REVENUE'), 'MAN Industries: the India part is not a cut of the company guide');
    assert.ok(earlierPriorMismatch(P('Cement demand is expected to grow 5%.', 5, 5), A('we target 8% growth', 8, 8), 'REVENUE_GROWTH'), 'industry');
    assert.ok(growthScopeIssue('India would be around INR3,800 crores', 'REVENUE'));
    assert.equal(growthScopeIssue('we expect revenue to grow 30% in FY27, and for us this will be a strong year', 'REVENUE'), null, '"us will be" is not a region');
    assert.ok(!GEO_PART.test('for us will be a year of execution'));
  });
  test('the floor above the old ceiling still counts; a lower figure is still a cut; equal is a reiteration', () => {
    assert.equal(earlierPriorMismatch(P('revenue growth of 20% to 25%', 20, 25), A('revenue growth of 30%', 30, 30), 'REVENUE_GROWTH'), null);
    const may = res({ docId: 'may', filedAt: '2026-05-27', rows: [row({ low: 20, high: 25, quote: 'revenue growth of 20% to 25% in FY27' })] });
    const cut = res({ docId: 'aug', filedAt: '2026-08-12', rows: [row({ low: 15, high: 18, quote: 'revenue growth of 15% to 18% in FY27' })] });
    assert.equal(buildExtractedEvents([may, cut], () => ({}), NOW, '120D').find((e) => e.announcement_date === '2026-08-12')!.changes[0].direction, 'DOWN');
  });
});

describe('zzz926 — a growth rate filed under REVENUE is the revenue growth rate', () => {
  test('"35% growth in our top line" (REVENUE, no unit, stated growth 35) → REVENUE_GROWTH 35%', () => {
    const n = normaliseRateRow(row({ metric: 'REVENUE', unit: null, low: 35, high: 35, growthPctLow: 35, growthPctHigh: 35 }));
    assert.equal(n.metric, 'REVENUE_GROWTH'); assert.equal(n.row.unit, '%');
    assert.equal(normaliseRateRow(row({ metric: 'REVENUE', unit: '%', low: 30, high: 30 })).metric, 'REVENUE_GROWTH');
    const amt = normaliseRateRow(row({ metric: 'REVENUE', unit: 'crore', currency: 'INR', low: 1500, high: 1500 }));
    assert.equal(amt.metric, 'REVENUE'); assert.equal(amt.row.unit, 'crore');
    assert.equal(normaliseRateRow(row({ metric: 'PAT', unit: '%', low: 20, high: 20 })).metric, 'NET_PROFIT', 'a profit growth rate stays a profit rate');
  });
  test('such a row now meets the other call\'s REVENUE_GROWTH figure (UFLEX-style: 25–30% in May, 35% in August)', () => {
    const may = res({ docId: 'may', ticker: 'UFLX', filedAt: '2026-05-28', rows: [row({ low: 25, high: 30, quote: 'We expect revenue growth of 25% to 30% for FY27.' })] });
    const aug = res({ docId: 'aug', ticker: 'UFLX', filedAt: '2026-08-21', rows: [row({ metric: 'REVENUE', unit: null, low: 35, high: 35, growthPctLow: 35, growthPctHigh: 35, quote: "we're expecting 35% growth in our top line in this financial year." })] });
    const ev = buildExtractedEvents([may, aug], () => ({}), NOW, '120D').find((e) => e.announcement_date === '2026-08-21')!;
    const ch = ev.changes.find((c) => c.metric === 'REVENUE_GROWTH')!;
    assert.equal(ch.direction, 'UP'); assert.equal(ch.after.unit, '%'); assert.equal(ch.before!.high, 30);
  });
});

function memIo(init: Record<string, any>, failGets = new Set<string>()): MarketIndexIo & { store: Map<string, any> } {
  const store = new Map(Object.entries(init));
  return {
    store,
    get: async (k: string) => { if (failGets.has(k)) throw new Error('read failed'); return store.has(k) ? store.get(k) : null; },
    set: async (k: string, v: any) => { store.set(k, v); },
    mget: async (ks: string[]) => ks.map((k) => (store.has(k) ? store.get(k) : null)),
  };
}
const kept = (id: string, market: 'IN' | 'US', filed = '2026-05-20') => ({ ...res({ docId: id, market, ticker: id.toUpperCase(), filedAt: filed }), rows: [row({ low: 20, high: 25 })] });

describe('zzz926 — every kept India result is readable (per-market lists)', () => {
  test('the shared list cut at 2,500 hid the oldest results; the market lists hold all of them', async () => {
    const init: Record<string, any> = {}; const shared: string[] = [];
    for (let i = 0; i < 3_200; i++) { const m = i % 3 === 0 ? 'IN' : 'US'; const id = `${m.toLowerCase()}${i}`; shared.push(id); init[`guidance-extract:v1:${id}`] = kept(id, m, i < 2_600 ? '2026-08-20' : '2026-05-20'); }
    init[SHARED_OK_INDEX_KEY] = shared;
    const io = memIo(init);
    const before = await listExtractResults({ io: io as any, market: 'IN' });
    assert.ok(!before.results.some((r) => r.filedAt.startsWith('2026-05')), 'before: the May calls (oldest extractions) were never read');
    let st = stateOf(null);
    for (let n = 0; n < 10 && !st.done; n++) st = await syncMarketIndex(io, { maxIds: 600, now: NOW });
    assert.ok(st.done); assert.equal(st.counts.IN, Math.ceil(3_200 / 3));
    const after = await listExtractResults({ io: io as any, market: 'IN' });
    assert.equal(after.results.length, Math.ceil(3_200 / 3), 'every India result');
    assert.ok(after.results.some((r) => r.filedAt.startsWith('2026-05')), 'the May calls are back');
    assert.ok(after.results.every((r) => r.market === 'IN'));
  });
  test('new extractions go first; a failed read writes nothing; empty chunks are skipped after three tries', async () => {
    const io = memIo({ [SHARED_OK_INDEX_KEY]: ['a', 'b'], 'guidance-extract:v1:a': kept('a', 'IN'), 'guidance-extract:v1:b': kept('b', 'US') });
    let st = await syncMarketIndex(io, { now: NOW });
    assert.deepEqual(io.store.get(MARKET_INDEX_KEY('IN')), ['a']); assert.ok(st.done);
    io.store.set('guidance-extract:v1:c', kept('c', 'IN', '2026-08-01')); io.store.set(SHARED_OK_INDEX_KEY, ['c', 'a', 'b']);
    st = await syncMarketIndex(io, { now: NOW });
    assert.deepEqual(io.store.get(MARKET_INDEX_KEY('IN')), ['c', 'a']);
    const broken = memIo({ ...Object.fromEntries(io.store) }, new Set([MARKET_INDEX_KEY('IN')]));
    broken.store.set('guidance-extract:v1:d', kept('d', 'IN')); broken.store.set(SHARED_OK_INDEX_KEY, ['d', 'c', 'a', 'b']);
    await assert.rejects(() => syncMarketIndex(broken, { now: NOW }));
    assert.deepEqual(broken.store.get(MARKET_INDEX_KEY('IN')), ['c', 'a'], 'unchanged after a failed read');
    // expired results: three stalls at one place, then the walk moves on
    const gone = memIo({ [SHARED_OK_INDEX_KEY]: Array.from({ length: 150 }, (_, i) => `x${i}`) });
    let s = stateOf(null);
    for (let i = 0; i < 3; i++) s = await syncMarketIndex(gone, { maxIds: 100, now: NOW });
    assert.equal(s.pos, 100);
  });
  test('pure helpers', () => {
    assert.deepEqual(prependIds(['a', 'b'], ['c', 'b']), ['c', 'b', 'a']);
    assert.deepEqual(appendIds(['a'], ['b', 'a', 'c']), ['a', 'b', 'c']);
    assert.deepEqual(newAtFront(['n2', 'n1', 'h', 'x'], 'h'), ['n2', 'n1']); assert.deepEqual(newAtFront(['a'], null), []);
    const st = { v: 1, pos: 5, done: true, total: 5, head: 'a', stalls: 0, counts: { IN: 2, US: 1 }, updatedAt: '' };
    assert.deepEqual(idsToRead({ market: 'IN', shared: ['u1', 'i1'], sharedCap: 2_500, IN: ['i1', 'i0'], US: ['u1'], state: st }), ['i1', 'i0'], 'done: the market list alone');
    assert.deepEqual(idsToRead({ market: 'IN', shared: ['u1', 'i1'], sharedCap: 2_500, IN: ['i0'], US: null, state: { ...st, done: false } }), ['u1', 'i1', 'i0'], 'walking: old list plus what is known');
    assert.deepEqual(idsToRead({ market: 'ALL', shared: null, sharedCap: 2_500, IN: ['i1'], US: ['u1'], state: st }), ['i1', 'u1']);
    assert.ok(MARKET_READ_CAP.IN >= 4_000);
  });
  test('re-collect removes the ids from the market lists too', async () => {
    const io = memIo({ [MARKET_INDEX_KEY('IN')]: ['a', 'b'], [MARKET_INDEX_KEY('US')]: ['c'] });
    await removeFromMarketIndexes(io, ['b', 'c']);
    assert.deepEqual(io.store.get(MARKET_INDEX_KEY('IN')), ['a']); assert.deepEqual(io.store.get(MARKET_INDEX_KEY('US')), []);
    assert.equal(MARKET_STATE_KEY.startsWith('guidance-extract:v1:index:ok'), true); assert.equal(EXTRACT_OK_INDEX_KEY, SHARED_OK_INDEX_KEY); assert.ok(extractKey('x'));
  });
});

describe('zzz926 — the daily reading budget goes to the documents that can show something', () => {
  const ir = (id: string, ticker: string, kind: any, filedAt: string, textChars = 29_000): GuidanceDocIndexRow => ({ docId: id, market: 'IN', ticker, company: ticker, kind, filedAt, url: '', textChars });
  test('one lead per call (transcript), then decks / releases of calls with a transcript, then large caps, copies last (after the US)', () => {
    const rows = [
      ir('gk-ppt', 'GKENERGY', 'PRESENTATION', '2026-08-07', 29_897), ir('gk-ppt2', 'GKENERGY', 'PRESENTATION', '2026-08-07', 29_897),
      ir('gk-tr', 'GKENERGY', 'TRANSCRIPT', '2026-08-07', 27_426), ir('gk-tr2', 'GKENERGY', 'TRANSCRIPT', '2026-08-13', 27_426),
      ir('omni-tr', 'OMNI', 'TRANSCRIPT', '2026-08-10'), ir('omni-ppt', 'OMNI', 'PRESENTATION', '2026-08-06', 28_386),
      ir('tcs-tr', 'TCS', 'TRANSCRIPT', '2026-10-01'), ir('lotus-rr', 'LOTUSDEV', 'RESULTS_RELEASE', '2026-08-03', 9_941),
      { docId: 'us-1', market: 'US', ticker: 'ZZ', company: 'ZZ', kind: 'RESULTS_RELEASE', filedAt: '2026-10-02', url: '', textChars: 5_000 } as GuidanceDocIndexRow,
    ];
    const p = planQueue(rows, { handoff: new Set(['us-1']), graded: null, verified: null, looked: new Set() });
    const order = p.rows.map((r) => r.docId);
    assert.deepEqual(order.slice(0, 2), ['gk-tr2', 'omni-tr'], 'transcripts of small / mid caps first (newest first)');
    assert.ok(order.indexOf('lotus-rr') < order.indexOf('omni-ppt'), 'a results release with no transcript is a lead');
    assert.ok(order.indexOf('omni-ppt') < order.indexOf('tcs-tr'), 'large caps after the small / mid followers');
    assert.ok(order.indexOf('tcs-tr') < order.indexOf('us-1'), 'India before the US');
    assert.deepEqual(order.slice(-2).sort(), ['gk-ppt2', 'gk-tr'], 'copies last (the same transcript filed twice, the same deck twice)');
    assert.deepEqual(p.india, { leads: 3, followers: 2, large: 1, copies: 2 });
  });
  test('a copy of a document already read is not read again; another quarter\'s call of the same length is not a copy', () => {
    const read = [ir('v-aug', 'VOEPL', 'TRANSCRIPT', '2026-08-21', 29_909)];
    const o = orderIndia([ir('v-oct', 'VOEPL', 'TRANSCRIPT', '2026-10-02', 29_909), ir('v-may', 'VOEPL', 'TRANSCRIPT', '2026-05-30', 29_909)], read, () => false);
    assert.deepEqual(o.copies.map((r) => r.docId), ['v-oct']); assert.deepEqual(o.leads.map((r) => r.docId), ['v-may']);
  });
});
