// zzz793 — US Portfolio Catalysts: two companies' evidence never mixes.
// Regression for the NTNX card that showed RELL's order book
// ($151.2M → $164.4M) as a persistent catalyst candidate.
// Run: npx tsx --test src/lib/__tests__/zzz793-us-pc-isolation.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { usCandidatesFromSubmissions, usLedgerDocuments } from '../us-thesis/adapter';
import { setUsEvidenceKvForTests, persistUsEvidenceRun, loadUsLedger, saveUsLedger, US_LEDGER_KEY } from '../us-thesis/evidence-store';
import { newUsRow, applyUsLedger } from '../us-thesis/assess';
import { isolateUsLedger, catalystIsolated } from '../us-thesis/sanitize';
import { isolatedUsBlob } from '../us-thesis/special-focus-store';
import { convictionBenchAdds } from '../us-thesis/use-us-book';
import { detectForRow } from '../../components/special-focus-panel';

const NOW = new Date('2026-09-24T12:00:00Z');
const fakeKv = () => {
  const m = new Map<string, string>();
  return { m, kv: { get: async <T = any>(k: string) => (m.has(k) ? JSON.parse(m.get(k)!) as T : null), set: async (k: string, v: any) => { m.set(k, JSON.stringify(v)); } } };
};
const docsFor = (cik: number, n: string) => {
  const recent = [
    { form: '8-K', filingDate: '2026-08-05', reportDate: '2026-08-05', items: ['2.02'], accession: `000${cik}-26-0000${n}1` },
    { form: '10-Q', filingDate: '2026-08-07', reportDate: '2026-06-30', items: [], accession: `000${cik}-26-0000${n}2` },
  ];
  const c = usCandidatesFromSubmissions(recent, cik, NOW);
  return usLedgerDocuments(c, c.map((x) => ({ url: x.url, outcome: 'read' as const, chars: 4000 })));
};
const RELL_EV = [{ variable: 'order_book', value_type: 'ACTUAL', before: '$151.2 million', after: '$164.4 million', unit: null, period: null, direction: 'up', evidence_text: 'Backlog was $164.4 million compared with $151.2 million at the end of fiscal 2025.', source: 'Form 10-Q', confidence: 'HIGH' }];
const G = (t: string) => ({ ticker: t, market: 'US', source: 'sec-xbrl', sales_yoy_pct: 20, net_profit_yoy_pct: 30, opm_pct: 10, opm_prev_pct: 9, opm_change_pp: 1, cfo_to_pat_ratio: 1.1, cfo_period_is_current: true });

describe('two tickers, one KV: evidence never crosses', () => {
  test('concurrent persists land under their own keys, and each ledger names its own company only', async () => {
    const { m, kv } = fakeKv();
    setUsEvidenceKvForTests(kv);
    try {
      await Promise.all([
        persistUsEvidenceRun({ ticker: 'RELL', runId: 'r1', startedAt: '2026-09-01T00:00:00Z', documents: docsFor(355948, '1'), events: RELL_EV as any, summary: { verdict_line: 'x', positives: [], order_book: { closing_value: '$164.4 million' } }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'v', model: 'm', rawExtraction: null, pipeline: null }),
        persistUsEvidenceRun({ ticker: 'NTNX', runId: 'r2', startedAt: '2026-09-01T00:00:00Z', documents: docsFor(1618732, '2'), events: [], summary: { verdict_line: 'y', positives: [] }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'v', model: 'm', rawExtraction: null, pipeline: null }),
      ]);
      const rell = (await loadUsLedger('RELL'))!, ntnx = (await loadUsLedger('NTNX'))!;
      assert.equal(rell.ticker, 'RELL'); assert.equal(ntnx.ticker, 'NTNX');
      assert.ok(!JSON.stringify(ntnx).includes('164.4'), 'NTNX ledger carries no RELL figure');
      assert.ok(JSON.stringify(rell).includes('164.4'));
      const ntnxRow = applyUsLedger(newUsRow('NTNX', 'book', G('NTNX')), ntnx);
      const rellRow = applyUsLedger(newUsRow('RELL', 'book', G('RELL')), rell);
      assert.ok(!JSON.stringify(detectForRow(ntnxRow as any)).includes('164.4'), 'no RELL catalyst on the NTNX card');
      assert.ok(detectForRow(rellRow as any).every((pc) => pc.ticker === 'RELL'));
      assert.deepEqual([...m.keys()].filter((k) => k.startsWith('us-evidence:ledger')).sort(), [US_LEDGER_KEY('NTNX'), US_LEDGER_KEY('RELL')]);
    } finally { setUsEvidenceKvForTests(null); }
  });
  test('a ledger object naming another company is written under the REQUESTED ticker, and a mismatched stored ledger is never loaded', async () => {
    const { m, kv } = fakeKv();
    setUsEvidenceKvForTests(kv);
    try {
      await persistUsEvidenceRun({ ticker: 'RELL', runId: 'r1', startedAt: '2026-09-01T00:00:00Z', documents: docsFor(355948, '1'), events: RELL_EV as any, summary: { verdict_line: 'x', positives: [] }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'v', model: 'm', rawExtraction: null, pipeline: null });
      const rell = (await loadUsLedger('RELL'))!;
      const r = await saveUsLedger(rell, 'NTNX');
      assert.equal(r.ok, true);
      assert.equal(JSON.parse(m.get(US_LEDGER_KEY('NTNX'))!).ticker, 'NTNX', 'the key and the document agree');
      // a contaminated copy stored under NTNX that still names RELL
      m.set(US_LEDGER_KEY('NTNX'), JSON.stringify(rell));
      assert.equal(await loadUsLedger('NTNX'), null);
    } finally { setUsEvidenceKvForTests(null); }
  });
});

describe('isolation on the page side', () => {
  const rellDocs = docsFor(355948, '1');
  test('isolateUsLedger drops a ledger that belongs to another ticker, and documents / facts filed under another CIK', () => {
    const base: any = { version: 3, ticker: 'NTNX', market: 'US', latest_period: 'Q1 FY27', periods: { 'Q1 FY27': { reporting_period: 'Q1 FY27', documents: [...docsFor(1618732, '2'), rellDocs[0]], facts: [
      { id: 'a', ticker: 'NTNX', metric_name: 'order_book', after_value: '$2.3 billion', source_quote: 'ARR $2.3 billion', source_url: docsFor(1618732, '2')[0].url },
      { id: 'b', ticker: 'RELL', metric_name: 'order_book', after_value: '$164.4 million', source_quote: 'Backlog $164.4 million', source_url: rellDocs[0].url },
      { id: 'c', ticker: 'NTNX', metric_name: 'order_book', after_value: '$164.4 million', source_quote: 'Backlog $164.4 million', source_url: rellDocs[0].url },
    ], events: [], summary: null } } };
    assert.equal(isolateUsLedger({ ...base, ticker: 'RELL' }, 'NTNX'), null);
    const clean = isolateUsLedger(base, 'NTNX')!;
    const p = clean.periods['Q1 FY27'];
    assert.deepEqual(p.facts.map((f: any) => f.id), ['a']);
    assert.ok(p.documents.every((d) => /\/data\/1618732\//.test(d.url)));
  });
  test('a Special Focus record whose evidence names two companies, or another company\'s CIK, is never shown or written', () => {
    const pc = (id: string, ticker: string, urls: string[]) => ({ id, ticker, evidence: [{ sources: urls.map((url) => ({ url })) }] });
    const rellUrl = rellDocs[0].url, ntnxUrl = docsFor(1618732, '2')[0].url;
    assert.equal(catalystIsolated(pc('NTNX:ORDER_VISIBILITY', 'NTNX', [ntnxUrl])), true);
    assert.equal(catalystIsolated(pc('NTNX:ORDER_VISIBILITY', 'NTNX', [ntnxUrl, rellUrl])), false);
    assert.equal(catalystIsolated(pc('NTNX:ORDER_VISIBILITY', 'NTNX', [rellUrl]), 1618732), false);
    assert.equal(catalystIsolated(pc('RELL:ORDER_VISIBILITY', 'NTNX', [ntnxUrl])), false, 'id and ticker must agree');
    const blob: any = { version: 1, seq: 0, records: {
      'NTNX:ORDER_VISIBILITY': { id: 'NTNX:ORDER_VISIBILITY', ticker: 'NTNX', latest: { ...pc('NTNX:ORDER_VISIBILITY', 'NTNX', [rellUrl]) } },
      'RELL:ORDER_VISIBILITY': { id: 'RELL:ORDER_VISIBILITY', ticker: 'RELL', latest: { ...pc('RELL:ORDER_VISIBILITY', 'RELL', [rellUrl]) } },
    } };
    assert.deepEqual(Object.keys(isolatedUsBlob(blob, { NTNX: 1618732, RELL: 355948 }).records), ['RELL:ORDER_VISIBILITY']);
  });
});

describe('US Conviction Beats on the bench', () => {
  test('added once, de-duplicated against the holdings and against itself, US tickers only', () => {
    const adds = convictionBenchAdds([{ ticker: 'NTNX' }, { ticker: 'MOG-A' }], [
      { ticker: 'NTNX', exchange: 'NASDAQ' }, { ticker: 'CRDO', exchange: 'NASDAQ' }, { ticker: 'crdo' }, { ticker: 'MOG.A' }, { ticker: 'IESC@2026-08-01', exchange: 'NASDAQ' }, { ticker: '' },
    ]);
    assert.deepEqual(adds.map((a) => a.ticker), ['CRDO', 'IESC']);
  });
});
