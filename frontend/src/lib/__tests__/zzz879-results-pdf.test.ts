// zzz879 — India results PDF backup: checks, overlay, queue, runner.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkResultsAnswer, overlayResultsPdf, mergeQueue, dueItems, looksLikeResultsText, resultsExcerpt, RP_RESULT_KEY, RP_LATEST_KEY, RP_QUEUE_KEY, RP_FAIL_KEY } from '../india-results-pdf';
import { runResultsPdf, enqueueResultsPdf, type RpDeps } from '../india-results-pdf-run';

const DOC = 'Statement of Standalone Unaudited Financial Results for the quarter ended 30.09.2026 (Rs. in Lakhs) '
  + 'Particulars Quarter ended 30.09.2026 30.06.2026 30.09.2025 Revenue from operations 12,345.67 11,000.00 9,876.54 Other income 12.00 '
  + 'Total income 12,357.67 Profit before tax 1,500.25 Profit for the period 1,120.50 980.00 (210.75) Earnings per equity share Basic 4.56 3.98 (0.86) '
  + 'x'.repeat(1300);
const ans = (o: any = {}) => ({ is_results_statement: true, period_end: '2026-09-30', basis: 'standalone', unit: 'lakh', revenue_current: 12345.67, revenue_year_ago: 9876.54, net_profit_current: 1120.5, net_profit_year_ago: -210.75, eps_current: 4.56, eps_year_ago: -0.86,
  revenue_line: 'Revenue from operations 12,345.67 11,000.00 9,876.54', net_profit_line: 'Profit for the period 1,120.50 980.00 (210.75)', eps_line: 'Earnings per equity share Basic 4.56 3.98 (0.86)', ...o });
const P = { ticker: 'hiil', want: '2026-09-30', filed: '2026-10-03', docText: DOC, url: 'https://nsearchives.nseindia.com/x.pdf', model: 'haiku' };

describe('zzz879 — checking the answer', () => {
  test('a good answer becomes crore figures with growth', () => {
    const r = checkResultsAnswer(ans(), P);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.record.ticker, 'HIIL'); assert.equal(r.record.sales_curr_cr, 123.46); assert.equal(r.record.sales_prev_cr, 98.77);
    assert.equal(r.record.sales_yoy_pct, 25); assert.equal(r.record.pat_curr_cr, 11.21); assert.equal(r.record.pat_prev_cr, -2.11);
    assert.ok(r.record.pat_yoy_pct! > 600, 'loss to profit: growth measured off the absolute base');
    assert.equal(r.record.eps_curr, 4.56);
  });
  test('refused: a figure not printed, the wrong quarter, not a results statement, no revenue, unknown unit', () => {
    assert.match((checkResultsAnswer(ans({ revenue_current: 12999 }), P) as any).reason, /revenue 12999 is not printed/);
    assert.match((checkResultsAnswer(ans({ period_end: '2026-06-30' }), P) as any).reason, /quarter ending 2026-06-30, not 2026-09-30/);
    assert.match((checkResultsAnswer(ans({ is_results_statement: false }), P) as any).reason, /not a results statement/);
    assert.match((checkResultsAnswer(ans({ revenue_current: null }), P) as any).reason, /no revenue/);
    assert.match((checkResultsAnswer(ans({ unit: 'billion' }), P) as any).reason, /unknown unit/);
    assert.match((checkResultsAnswer(ans({ revenue_year_ago: 11, revenue_line: 'Revenue from operations 12,345.67 11 9,876.54' }), { ...P, docText: DOC.replace('11,000.00 9,876.54', '11 9,876.54') }) as any).reason, /same company quarter/);
    // zzz883: every figure must be on its own printed row, and the row must be in the document
    assert.match((checkResultsAnswer(ans({ revenue_line: undefined }), P) as any).reason, /printed row was not copied/);
    assert.match((checkResultsAnswer(ans({ revenue_line: 'Total income 12,357.67' }), P) as any).reason, /12345.67 is not on the copied revenue row/);
    assert.match((checkResultsAnswer(ans({ revenue_line: 'Revenue from operations 12,345.67 9,876.54 made up' }), P) as any).reason, /not in the document/);
    assert.match((checkResultsAnswer(ans({ net_profit_line: 'Revenue from operations 12,345.67 11,000.00 9,876.54' }), P) as any).reason, /does not name net profit/);
  });
  test('text checks', () => {
    assert.equal(looksLikeResultsText(DOC), true);
    assert.equal(looksLikeResultsText('Intimation of board meeting ' + 'y'.repeat(2000)), false);
    assert.ok(resultsExcerpt('a'.repeat(30000) + ' Statement of Consolidated Unaudited Financial Results ' + 'b'.repeat(30000), 1000).startsWith(' Statement of Consolidated') === false);
    assert.match(resultsExcerpt('a'.repeat(30000) + 'Consolidated Unaudited Financial Results here' + 'b'.repeat(30000), 100), /^Consolidated Unaudited/);
  });
});

describe('zzz879 — enrich overlay', () => {
  const rec = (checkResultsAnswer(ans(), P) as any).record;
  test('used only when newer than Screener and for this filing', () => {
    const old = { sales_curr_cr: 90, opm_pct: 12, latest_quarter_end_iso: '2026-06-30', financials_source: 'screener-worker', market_cap_cr: 1140 };
    const o = overlayResultsPdf(old, rec, '2026-10-03');
    assert.equal(o.sales_curr_cr, 123.46); assert.equal(o.latest_quarter_end_iso, '2026-09-30'); assert.equal(o.latest_quarter_label, 'Sep 2026');
    assert.equal(o.opm_pct, null, "the old quarter's margin is not carried over"); assert.equal(o.market_cap_cr, 1140); assert.equal(o.financials_source, 'results-pdf');
    assert.equal(overlayResultsPdf({ ...old, latest_quarter_end_iso: '2026-09-30' }, rec, '2026-10-03').financials_source, 'screener-worker', 'Screener caught up: Screener wins');
    assert.equal(overlayResultsPdf(old, rec, '2026-09-20').financials_source, 'screener-worker', 'quarter had not ended by that filing');
    assert.equal(overlayResultsPdf(old, rec, '2026-12-20').financials_source, 'screener-worker', 'a different filing');
    assert.equal(overlayResultsPdf(old, null, '2026-10-03'), old);
  });
});

describe('zzz879 — queue', () => {
  const it = (t: string, filed: string, want = '2026-09-30') => ({ ticker: t, filed, want, added_at: 'x' });
  test('merge: one per company+quarter, newest first, bad dates dropped', () => {
    const q = mergeQueue([it('a', '2026-10-01')], [it('A', '2026-10-01'), it('B', '2026-10-03'), { ...it('C', 'bad') }]);
    assert.deepEqual(q.map((x) => x.ticker), ['B', 'A']);
  });
  test('due: filed 2+ days ago, not done, back-off respected, given up after 4', () => {
    const now = Date.parse('2026-10-06T10:00:00Z');
    const q = [it('OLD', '2026-10-01'), it('NEW', '2026-10-05'), it('DONE', '2026-10-01'), it('WAIT', '2026-10-01'), it('GONE', '2026-10-01'), it('RETRY', '2026-10-01')];
    const fails = new Map([['WAIT|2026-09-30', { at: '2026-10-06T08:00:00Z', tries: 1, reason: '' }], ['GONE|2026-09-30', { at: '2026-09-01T00:00:00Z', tries: 4, reason: '' }], ['RETRY|2026-09-30', { at: '2026-10-05T00:00:00Z', tries: 1, reason: '' }]]);
    assert.deepEqual(dueItems(q, new Set(['DONE|2026-09-30']), fails, now).map((x) => x.ticker), ['OLD', 'RETRY']);
  });
});

function memKv(init: Record<string, any> = {}) {
  const store = new Map(Object.entries(init));
  return { store, get: async (k: string) => (store.has(k) ? store.get(k) : null) as any, set: async (k: string, v: any) => { store.set(k, v); }, setNX: async (k: string, v: any) => { if (store.has(k)) return false; store.set(k, v); return true; }, del: async (k: string) => { store.delete(k); } };
}
describe('zzz879 — runner', () => {
  const now = () => new Date('2026-10-06T10:00:00Z');
  const base = (kv: any, over: Partial<RpDeps> = {}): RpDeps => ({
    kv, now,
    screenerQuarter: async () => '2026-06-30',
    findDocs: async () => ['https://x/notice.pdf', 'https://x/results.pdf'],
    readPdf: async (u) => ({ text: u.includes('results') ? DOC : 'Intimation ' + 'z'.repeat(2000) }),
    callModel: async () => ({ ok: true, raw: ans(), costUsd: 0.01, model: 'haiku' }),
    regrade: async () => {},
    ...over,
  });
  test('reads the PDF once, stores it, re-grades the day, leaves the queue; a second run spends nothing', async () => {
    const kv = memKv({ [RP_QUEUE_KEY]: [{ ticker: 'HIIL', filed: '2026-10-03', want: '2026-09-30', added_at: 'x' }] });
    const regraded: Array<[string, string[]]> = []; let calls = 0;
    const d = base(kv, { regrade: async (dt, t) => { regraded.push([dt, t]); }, callModel: async () => { calls++; return { ok: true, raw: ans(), costUsd: 0.01, model: 'haiku' }; } });
    const r = await runResultsPdf(d);
    assert.equal(r.outcomes[0].outcome, 'read'); assert.equal(r.spentUsd, 0.01);
    assert.equal(kv.store.get(RP_RESULT_KEY('HIIL', '2026-09-30')).sales_curr_cr, 123.46);
    assert.ok(kv.store.get(RP_LATEST_KEY('HIIL')));
    assert.deepEqual(regraded, [['2026-10-03', ['HIIL']]]);
    assert.deepEqual(kv.store.get(RP_QUEUE_KEY), []);
    await enqueueResultsPdf(kv, [{ ticker: 'HIIL', filed: '2026-10-03', want: '2026-09-30', added_at: 'y' }]);
    const r2 = await runResultsPdf(d);
    assert.equal(calls, 1, 'never read twice'); assert.equal(r2.outcomes.length, 0);
  });
  test('Screener caught up: no AI; spend cap stops; a rejected answer is recorded and backs off', async () => {
    const q = [{ ticker: 'A', filed: '2026-10-01', want: '2026-09-30', added_at: 'x' }, { ticker: 'B', filed: '2026-10-01', want: '2026-09-30', added_at: 'x' }];
    let calls = 0;
    const kv1 = memKv({ [RP_QUEUE_KEY]: q });
    const r1 = await runResultsPdf(base(kv1, { screenerQuarter: async () => '2026-09-30', callModel: async () => { calls++; return { ok: true, raw: ans(), costUsd: 0.01, model: 'h' }; } }));
    assert.deepEqual(r1.outcomes.map((o) => o.outcome), ['screener_caught_up', 'screener_caught_up']); assert.equal(calls, 0);
    const kv2 = memKv({ [RP_QUEUE_KEY]: q });
    const r2 = await runResultsPdf(base(kv2, { callModel: async () => ({ ok: false, kind: 'spend_cap', message: 'cap' }) }));
    assert.deepEqual(r2.outcomes.map((o) => o.outcome), ['spend_cap']); assert.equal(kv2.store.get(RP_QUEUE_KEY).length, 2, 'nothing lost');
    const kv3 = memKv({ [RP_QUEUE_KEY]: q.slice(0, 1) });
    const r3 = await runResultsPdf(base(kv3, { callModel: async () => ({ ok: true, raw: ans({ period_end: '2026-06-30' }), costUsd: 0.01, model: 'h' }) }));
    assert.equal(r3.outcomes[0].outcome, 'rejected'); assert.equal(kv3.store.get(RP_FAIL_KEY('A', '2026-09-30')).tries, 1);
    const r3b = await runResultsPdf(base(kv3));
    assert.equal(r3b.due, 0, 'backs off');
    const kv4 = memKv({ [RP_QUEUE_KEY]: q.slice(0, 1) });
    const r4 = await runResultsPdf(base(kv4, { findDocs: async () => [] }));
    assert.equal(r4.outcomes[0].outcome, 'no_document');
  });
  test('a held lock skips the run', async () => {
    const kv = memKv({ 'results-pdf:v1:lock': 'x' });
    assert.equal((await runResultsPdf(base(kv))).skipped, 'another run is in progress');
  });
});
