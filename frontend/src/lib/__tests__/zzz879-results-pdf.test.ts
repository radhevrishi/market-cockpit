// zzz879 — India results PDF backup: checks, overlay, queue, runner.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { consolidatedTableAt, statedUnit, checkResultsAnswer, overlayResultsPdf, mergeQueue, dueItems, looksLikeResultsText, resultsExcerpt, RP_RESULT_KEY, RP_LATEST_KEY, RP_QUEUE_KEY, RP_FAIL_KEY } from '../india-results-pdf';
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
    assert.match(resultsExcerpt('a'.repeat(30000) + 'Consolidated Unaudited Financial Results here Revenue from operations 1 2' + 'b'.repeat(30000), 400), /Consolidated Unaudited/);
    // zzz1225 — Anthem: "Statement of Unaudited Consolidated Financial Results" (adjective first) is found too, even in a short document
    const anthem = 'Statement of Unaudited Standalone Financial Results Revenue from operations 572.11 552.70 ' + 'x'.repeat(2000) + ' Statement of Unaudited Consolidated Financial Results for the quarter ended 30 September 2026 Revenue from operations 594.03 550.50';
    assert.ok(consolidatedTableAt(anthem) > 0);
    assert.match(resultsExcerpt(anthem), /^.{0,300}Statement of Unaudited Consolidated/s);
    assert.doesNotMatch(resultsExcerpt(anthem), /572\.11/);
    // a cover letter naming both tables is not the table
    assert.equal(consolidatedTableAt('the Board approved the standalone and consolidated financial results. Kindly take on record.'), -1);
    // zzz1225 — ONEPOINT: the stated unit wins
    assert.equal(statedUnit('(₹ in Lakhs) Particulars Quarter ended'), 'lakh');
    assert.equal(statedUnit('Rs. in crore except EPS'), 'crore');
    assert.equal(statedUnit('(₹ in Lakhs) … (₹ in crore)'), null);
    const big = (checkResultsAnswer({ ...ans(), unit: 'crore' }, P) as any).record;
    if (big) assert.match(String(overlayResultsPdf({ sales_curr_cr: 1, latest_quarter_end_iso: '2026-06-30', market_cap_cr: 1 }, big, '2026-10-03')._results_pdf_skipped), /unit not trusted/);
    assert.match(String(overlayResultsPdf({ latest_quarter_end_iso: '2026-06-30' }, { ...big, ck: 4 }, '2026-10-03')._results_pdf_skipped), /older checker/);
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
  test('due: seen 20+ minutes ago (zzz1221; was 2 h, then 2 days), not done, back-off respected, given up after 4', () => {
    const now = Date.parse('2026-10-06T10:00:00Z');
    const q = [it('OLD', '2026-10-01'), it('NEW', '2026-10-05'), it('DONE', '2026-10-01'), it('WAIT', '2026-10-01'), it('GONE', '2026-10-01'), it('RETRY', '2026-10-01')];
    const fails = new Map([['WAIT|2026-09-30', { at: '2026-10-06T08:00:00Z', tries: 1, reason: '', cv: 5 }], ['GONE|2026-09-30', { at: '2026-09-01T00:00:00Z', tries: 4, reason: '', cv: 5 }], ['RETRY|2026-09-30', { at: '2026-10-05T00:00:00Z', tries: 1, reason: '', cv: 5 }]]);
    assert.deepEqual(dueItems(q, new Set(['DONE|2026-09-30']), fails, now).map((x) => x.ticker), ['OLD', 'NEW', 'RETRY']);
    const fresh = { ticker: 'TODAY', filed: '2026-10-06', want: '2026-09-30', added_at: '2026-10-06T09:50:00Z' };
    assert.deepEqual(dueItems([fresh], new Set(), new Map(), now), [], 'seen 10 min ago: Screener gets 20 min first (zzz1221)');
    assert.equal(dueItems([fresh], new Set(), new Map(), now + 3_600_000).length, 1);
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
    assert.ok(r2.outcomes.length >= 1 && r2.outcomes.every((o) => o.outcome === 'spend_cap'), 'stops at the cap (zzz1221: names already in flight say so too)'); assert.equal(kv2.store.get(RP_QUEUE_KEY).length, 2, 'nothing lost');
    const kv3 = memKv({ [RP_QUEUE_KEY]: q.slice(0, 1) });
    const r3 = await runResultsPdf(base(kv3, { callModel: async () => ({ ok: true, raw: ans({ period_end: '2026-06-30' }), costUsd: 0.01, model: 'h' }) }));
    assert.equal(r3.outcomes[0].outcome, 'rejected'); assert.equal(kv3.store.get(RP_FAIL_KEY('A', '2026-09-30')).tries, 1);
    const r3b = await runResultsPdf(base(kv3));
    assert.equal(r3b.due, 0, 'backs off');
    const kv4 = memKv({ [RP_QUEUE_KEY]: q.slice(0, 1) });
    const r4 = await runResultsPdf(base(kv4, { findDocs: async () => [] }));
    assert.equal(r4.outcomes[0].outcome, 'no_document');
  });
  test('zzz1226 — a name whose figures were read by an older checker goes first, from its known PDF', async () => {
    const q = [{ ticker: 'NEWCO', filed: '2026-10-03', want: '2026-09-30', added_at: 'x' }, { ticker: 'ANTHEM', filed: '2026-10-01', want: '2026-09-30', added_at: 'x' }];
    const kv = memKv({ [RP_QUEUE_KEY]: q, [RP_RESULT_KEY('ANTHEM', '2026-09-30')]: { v: 1, ck: 4, quotes: {}, source_url: 'https://x/anthem-results.pdf' } });
    const seen: Array<string | null | undefined> = [];
    const r = await runResultsPdf(base(kv, { findDocs: async (it) => { seen.push(it.url); return ['https://x/results.pdf']; } }), { concurrency: 1 } as any);
    assert.equal(r.outcomes[0].ticker, 'ANTHEM');
    assert.equal(seen[0], 'https://x/anthem-results.pdf');
  });
  test('a held lock skips the run', async () => {
    const kv = memKv({ 'results-pdf:v1:lock': 'x' });
    assert.equal((await runResultsPdf(base(kv))).skipped, 'another run is in progress');
  });
});

describe('zzz1221 — a results day is read 4 names at a time', () => {
  test('8 queued names that each take 50 ms finish in about 2 rounds, not 8; all are resolved', async () => {
    const q = Array.from({ length: 8 }, (_, i) => ({ ticker: `T${i}`, filed: '2026-10-03', want: '2026-09-30', added_at: 'x' }));
    const kv = memKv({ [RP_QUEUE_KEY]: q });
    let live = 0, peak = 0;
    const d: RpDeps = {
      kv: kv as any, now: () => new Date('2026-10-06T10:00:00Z'),
      screenerQuarter: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 50)); live--; return '2026-09-30'; },
      findDocs: async () => [], readPdf: async () => ({ text: '' }),
      callModel: async () => ({ ok: false, kind: 'x', message: 'x' }), regrade: async () => {},
    };
    const t = Date.now();
    const r = await runResultsPdf(d, { maxItems: 8 });
    assert.equal(r.outcomes.filter((o) => o.outcome === 'screener_caught_up').length, 8);
    assert.equal(peak, 4);
    assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);   // peak = 4 is the real check; time is loose for busy CI
    assert.deepEqual(kv.store.get(RP_QUEUE_KEY), []);
  });
});

describe('zzz1221 — a bad EPS no longer throws away good revenue and profit', () => {
  test('EPS not printed → record kept, EPS left out', () => {
    const r = checkResultsAnswer(ans({ eps_current: 0.68 }), P);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.record.eps_curr, null); assert.equal(r.record.quotes?.eps_line, null); assert.equal(r.record.sales_curr_cr, 123.46); }
  });
  test('EPS row that does not name EPS → EPS left out; a "Basic" row is accepted', () => {
    const r = checkResultsAnswer(ans({ eps_line: 'Profit for the period 1,120.50 980.00 (210.75)' }), P);
    assert.ok(r.ok && r.record.eps_curr == null);
    const b = checkResultsAnswer(ans({ eps_line: 'Basic 4.56 3.98 (0.86)' }), P);
    assert.ok(b.ok && b.record.eps_curr === 4.56);
  });
  test('a row whose label runs into the figure in the PDF text still counts', () => {
    const doc = DOC.replace('Revenue from operations 12,345.67', 'Revenue from operations12,345.67');
    assert.equal(checkResultsAnswer(ans(), { ...P, docText: doc }).ok, true);
  });
  test('revenue is still strict', () => {
    assert.equal(checkResultsAnswer(ans({ revenue_current: 12999 }), P).ok, false);
  });
});

test('zzz1221 — a failure judged by the older checker is retried at once', () => {
  const now = Date.parse('2026-10-06T10:00:00Z');
  const q = [{ ticker: 'R', filed: '2026-10-01', want: '2026-09-30', added_at: 'x' }];
  assert.equal(dueItems(q, new Set(), new Map([['R|2026-09-30', { at: '2026-10-06T09:00:00Z', tries: 1, reason: 'EPS' }]]), now).length, 1);
  assert.equal(dueItems(q, new Set(), new Map([['R|2026-09-30', { at: '2026-10-06T09:00:00Z', tries: 1, reason: 'EPS', cv: 5 }]]), now).length, 0);
});

test('zzz1221 — printed slips "8,208,14" and "14,302 .31" count as 8208.14 and 14302.31 (PRINCEPIPE)', async () => {
  const { numbersIn } = await import('../india-results-pdf');
  const ns = numbersIn('a Revenue from Operations 8,208,14 6,094.18 5,945.74 14,302 .31');
  assert.ok(ns.includes(8208.14)); assert.ok(ns.includes(6094.18)); assert.ok(ns.includes(14302.31));
  assert.ok(!numbersIn('1,234,567').includes(12345.67), 'a normal 3-digit group is never re-read');
});

test('zzz1221 — a space as the thousands separator: "19 768.70" (ARCHIDPLY)', async () => {
  const { numbersIn, checkResultsAnswer: chk } = await import('../india-results-pdf');
  assert.ok(numbersIn('a. Revenue from operations 19 768.70 18 900.78 17 571.72').includes(19768.7));
  const doc = DOC.replace('Revenue from operations 12,345.67 11,000.00 9,876.54', 'Revenue from operations 12 345.67 11 000.00 9 876.54');
  assert.equal(chk(ans({ revenue_line: 'Revenue from operations 12 345.67 11 000.00 9 876.54' }), { ...P, docText: doc }).ok, true);
});

test('zzz1221 — columns the PDF reader ran together ("8,208,146,094.18") still check out; a made-up row still does not', async () => {
  const { checkResultsAnswer: chk } = await import('../india-results-pdf');
  const doc = DOC.replace('Revenue from operations 12,345.67 11,000.00 9,876.54', 'Revenue from operations12,345,6711,000.009,876.54');
  const r = chk(ans(), { ...P, docText: doc });
  assert.equal(r.ok, true, (r as any).reason);
  assert.match((chk(ans({ revenue_line: 'Revenue from operations 12,345.67 9,876.54 made up' }), P) as any).reason, /not in the document/);
});
