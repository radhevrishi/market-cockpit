// zzz790 — SEC filings → the shared ledger format, and the engine's
// invariants on US rows. Fixture texts are short, realistic 8-K EX-99.1 and
// 10-Q snippets written for these tests (fictional company, "ACMX").
// Run: npx tsx --test src/lib/__tests__/zzz790-us-adapter.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  usCandidatesFromSubmissions, planUsRead, usLedgerDocuments, usHtmlToText, mdnaSection, looksLikeUsEarningsRelease,
  deterministicUsFacts, verifyUsSummary, fiscalLabelFor, usGradedRow, filingIndexUrl, PRICE_KEYS,
} from '../us-thesis/adapter';
import { usCalendarNow, usExpectedPeriod, usFreshness } from '../us-thesis/calendar';
import { assessUsRow, applyUsLedger, newUsRow, withThesisSet } from '../us-thesis/assess';
import { setUsEvidenceKvForTests, persistUsEvidenceRun, persistUsSeen } from '../us-thesis/evidence-store';
import { validateEvents, findPassages } from '../thesis/evidence-extract';
import { normalizeValue } from '../thesis/fact-model';
import { universeCounts, evidenceCounts } from '../thesis/evidence-counts';
import { specialFocusQueue, nearMissList } from '../catalyst/cross-view';
import { detectForRow } from '../../components/special-focus-panel';

const RELEASE = `ACME MOTION CORP REPORTS SECOND QUARTER FISCAL 2026 RESULTS. EAST AURORA, N.Y., August 5, 2026 -- Acme Motion Corp (NYSE: ACMX) today announced financial results for the second quarter of fiscal 2026, ended June 27, 2026. Net sales were $412.6 million, an increase of 18% compared with $349.7 million in the second quarter of fiscal 2025. Net earnings were $38.2 million, or $1.21 per diluted share, compared with $27.9 million, or $0.88 per diluted share, a year ago. Operating income was $55.1 million. Twelve-month backlog was $1.9 billion at quarter end, up from $1.6 billion a year earlier. The company raised its fiscal 2026 net sales outlook to $1.62 billion. Revenue in the quarter was $412.6 million. Total revenue rose on higher volumes. Net income was $38.2 million. Earnings per share was $1.21. Cash from operations was $41.0 million. Capital expenditures were $14.3 million. The Company will host a conference call and webcast. Non-GAAP measures are reconciled below. Forward-looking statements are subject to risks. $412.6 $349.7 $38.2 $27.9 $55.1 $1.9 $1.6 $1.62 $41.0 $14.3`;

const TENQ_HTML = `<html><body>
<p>TABLE OF CONTENTS</p><p>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations 22</p><p>Item 3. Quantitative and Qualitative Disclosures About Market Risk 35</p>
<p>PART I. FINANCIAL INFORMATION</p><table><tr><td>Net sales</td><td>$ 412.6</td></tr></table>
<p>Item 2. Management&#8217;s Discussion and Analysis of Financial Condition and Results of Operations</p>
<p>Net sales for the quarter ended June 27, 2026 were $412.6 million, compared with $349.7 million in the prior year quarter.</p>
<p>Twelve-month backlog was $1.9 billion at June 27, 2026 compared with $1.6 billion at June 28, 2025, reflecting new orders from commercial aircraft customers.</p>
<p>Our production capacity at the Salt Lake City facility increased to 1,200 actuators per month from 900 actuators per month a year ago, and the plant is operating at 85% utilization.</p>
<p>We expect to invest $60 million in capital expenditures in fiscal 2026 to expand capacity.</p>
<p>Item 3. Quantitative and Qualitative Disclosures About Market Risk</p><p>Interest rate risk text that is not MD&amp;A.</p>
</body></html>`;

const RECENT = [
  { form: '8-K', filingDate: '2026-08-05', reportDate: '2026-08-05', items: ['2.02', '9.01'], accession: '0000067887-26-000031' },
  { form: '10-Q', filingDate: '2026-08-07', reportDate: '2026-06-27', items: [], accession: '0000067887-26-000033' },
  { form: '8-K', filingDate: '2026-07-01', reportDate: '2026-07-01', items: ['5.02'], accession: '0000067887-26-000020' },
  { form: '4', filingDate: '2026-08-10', reportDate: null, items: [], accession: '0000067887-26-000040' },
  { form: '10-Q/A', filingDate: '2026-08-20', reportDate: '2026-06-27', items: [], accession: '0000067887-26-000041' },
  { form: '8-K', filingDate: '2026-05-06', reportDate: '2026-05-06', items: ['2.02'], accession: '0000067887-26-000010' },
  { form: '10-Q', filingDate: '2026-05-08', reportDate: '2026-03-28', items: [], accession: '0000067887-26-000012' },
  { form: '6-K', filingDate: '2026-08-06', reportDate: null, items: [], accession: '0000067887-26-000032' },
];
const NOW = new Date('2026-09-24T12:00:00Z');

describe('SEC documents → candidates → a read plan', () => {
  const cands = usCandidatesFromSubmissions(RECENT, 67887, NOW);
  test('only 10-Q / 10-K / 8-K Item 2.02; no Form 4, no amendment, no other 8-K, no 6-K unless asked', () => {
    assert.deepEqual(cands.map((c) => `${c.form}:${c.dateIso}`), ['10-Q:2026-08-07', '8-K:2026-08-05', '10-Q:2026-05-08', '8-K:2026-05-06']);
    assert.equal(usCandidatesFromSubmissions(RECENT, 67887, NOW, { includeSixK: true }).filter((c) => c.form === '6-K').length, 1);
  });
  test('each candidate carries the shared calendar key and the filing index url', () => {
    const q = cands[0];
    assert.equal(q.period, 'Q1 FY27');
    assert.equal(q.url, filingIndexUrl(67887, '0000067887-26-000033'));
    assert.match(q.label, /quarter ended 2026-06-27/);
    assert.equal(cands[2].period, 'Q4 FY26');
  });
  test('the plan reads the release AND the 10-Q of the newest period; prior targets the one before', () => {
    const p = planUsRead(cands);
    assert.equal(p.period, 'Q1 FY27');
    assert.deepEqual(p.docs.map((d) => d.form).sort(), ['10-Q', '8-K']);
    const prior = planUsRead(cands, 'Q4 FY26');
    assert.deepEqual(prior.docs.map((d) => d.dateIso).sort(), ['2026-05-06', '2026-05-08']);
    assert.equal(planUsRead(cands, 'Q2 FY26').docs.length, 0);
  });
  test('ledger documents keep the FILING as identity (a later check recognises it)', () => {
    const docs = usLedgerDocuments(cands, [{ url: cands[1].url, outcome: 'read', chars: 900, docUrl: 'https://www.sec.gov/x/ex99-1.htm' }]);
    const read = docs.find((d) => d.outcome === 'read')!;
    assert.equal(read.url, cands[1].url);
    assert.match(String(read.detail), /ex99-1\.htm/);
    assert.equal(docs.filter((d) => d.outcome === 'not_selected').length, 3);
  });
});

describe('text adapters', () => {
  test('an 8-K EX-99.1 reads as an earnings release; a certification does not', () => {
    assert.equal(looksLikeUsEarningsRelease(RELEASE), true);
    assert.equal(looksLikeUsEarningsRelease('I, Jane Doe, certify that I have reviewed this quarterly report pursuant to Section 302. '.repeat(20)), false);
  });
  test('10-Q MD&A is extracted past the table of contents, and stops at Item 3', () => {
    const md = mdnaSection(usHtmlToText(TENQ_HTML), '10-Q');
    assert.match(md, /Management’s Discussion/);
    assert.match(md, /Twelve-month backlog was \$1\.9 billion/);
    assert.ok(!/Interest rate risk text/.test(md), 'Item 3 is not MD&A');
    assert.ok(!/TABLE OF CONTENTS/.test(md));
  });
  test('deterministic first: structural passages found without a model', () => {
    const md = mdnaSection(usHtmlToText(TENQ_HTML), '10-Q');
    const det = deterministicUsFacts([{ label: 'Form 10-Q', text: md, role: 'periodic' }, { label: 'Earnings release', text: RELEASE, role: 'release' }]);
    assert.ok(det.byFamily.orders >= 1, JSON.stringify(det.byFamily));
    assert.ok(det.byFamily.capacity >= 1);
    assert.ok(det.byFamily.utilisation >= 1);
    assert.match(String(det.release.revenueSentence), /\$412\.6 million/);
  });
  test('US dollar events feed the shared validator and unit normaliser ($1.9 billion = 1,900 USD million)', () => {
    const md = mdnaSection(usHtmlToText(TENQ_HTML), '10-Q');
    const passages = findPassages(md, 'Form 10-Q');
    const sent = passages.find((p) => /backlog/.test(p.text))!.text;
    const quote = /Twelve-month backlog.*?customers\./.exec(sent)![0];
    const { kept } = validateEvents([{ variable: 'order_book', value_type: 'ACTUAL', before: '$1.6 billion', after: '$1.9 billion', unit: null, period: null, direction: 'up', evidence_text: quote, source: 'Form 10-Q', confidence: 'HIGH' }], passages);
    assert.equal(kept.length, 1);
    const a = normalizeValue('$1.9 billion'), b = normalizeValue('$412.6 million');
    assert.equal(a.normalized_unit, 'USD million'); assert.equal(a.normalized_value, 1900);
    assert.equal(b.normalized_value, 412.6); assert.equal(a.safe && b.safe, true);
    const { kept: bad } = validateEvents([{ variable: 'order_book', value_type: 'ACTUAL', before: null, after: '$2.7 billion', unit: null, period: null, direction: 'up', evidence_text: quote, source: 'Form 10-Q', confidence: 'HIGH' }], passages);
    assert.equal(bad.length, 0, 'a figure the sentence does not print is dropped');
  });
});

describe('verification: every figure must be printed', () => {
  test('an invented figure costs its own item; the rest survives', () => {
    const v = verifyUsSummary({
      verdict_line: 'Net sales rose 18% to $412.6 million.',
      positives: [{ label: 'Sales', detail: 'Net sales $412.6 million, up 18%.' }, { label: 'Backlog', detail: 'Backlog $1.9 billion.' }, { label: 'Made up', detail: 'Services revenue $77.7 million.' }],
      negatives: [], headline: { revenue: '$412.6 million', revenue_growth: '18%', profit: '$99.9 million', basis: 'x', comparison: 'yoy' },
      order_book: { closing_value: '$1.9 billion', growth: '+19%' },
    }, RELEASE);
    assert.equal(v.rejected, null);
    assert.deepEqual(v.data.positives.map((p: any) => p.label), ['Sales', 'Backlog']);
    assert.equal(v.data.headline.profit, '', 'an unprinted profit figure is blanked');
    assert.equal(v.data.headline.basis, 'not_stated');
    assert.equal(v.data.order_book.growth, '', 'a growth rate the documents do not print is blanked');
    assert.ok(v.dropped.length >= 2);
  });
  test('a summary that is mostly invented is rejected whole', () => {
    const v = verifyUsSummary({ positives: [{ label: 'a', detail: '$5.5 million' }, { label: 'b', detail: '$6.6 million' }, { label: 'c', detail: '$7.7 million' }], negatives: [] }, RELEASE);
    assert.match(String(v.rejected), /discarded/);
  });
});

describe('the deterministic XBRL grader row — no price', () => {
  const fund = { q_end: '2026-06-27', q_end_prev: '2025-06-28', q_filed: '2026-08-07', revenue: 412.6e6, revenue_prev: 349.7e6, operating_income: 55.1e6, operating_income_prev: 38e6, net_income: 38.2e6, net_income_prev: 27.9e6, eps: 1.21, eps_prev: 0.88, cfo: 41e6, capex: 14.3e6 };
  const row = usGradedRow('ACMX', fund, { company: 'Acme Motion Corp', cik: 67887, fiscalLabel: 'Q2 FY2026' })!;
  test('growth, margin and cash conversion from filed figures', () => {
    assert.equal(row.sales_yoy_pct, 18);
    assert.equal(row.net_profit_yoy_pct, 36.9);
    assert.equal(row.eps_yoy_pct, 37.5);
    assert.equal(row.opm_pct, 13.4); assert.equal(row.opm_prev_pct, 10.9); assert.equal(row.opm_change_pp, 2.5);
    assert.equal(row.cfo_to_pat_ratio, 1.07);
    assert.equal(row.revenue_curr_musd, 412.6);
    assert.match(row.period, /Q2 FY2026 \(quarter ended 2026-06-27\)/);
  });
  test('carries no price key of any kind', () => {
    for (const k of PRICE_KEYS) assert.ok(!(k in row), `grader row must not carry ${k}`);
  });
  test('growth off a loss is not computed', () => {
    const r = usGradedRow('L', { ...fund, net_income_prev: -5e6 })!;
    assert.equal(r.net_profit_yoy_pct, null);
    assert.equal(usGradedRow('E', { ...fund, revenue: null, revenue_prev: null, operating_income: null, net_income: null }), null);
  });
  test('company fiscal label from XBRL fp / fy of the first filing', () => {
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [
      { end: '2026-06-27', fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-08-07', val: 1 },
      { end: '2026-06-27', fy: 2027, fp: 'Q2', form: '10-Q', filed: '2027-08-06', val: 1 },
      { end: '2025-09-27', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-11-20', val: 1 },
    ] } } } } };
    assert.equal(fiscalLabelFor(facts, '2026-06-27'), 'Q2 FY2026');
    assert.equal(fiscalLabelFor(facts, '2025-09-27'), 'Q4 FY2025');
    assert.equal(fiscalLabelFor(facts, '2024-01-01'), null);
  });
});

describe('the US calendar over the shared keys', () => {
  test('a 10-K is not overdue until 90 days after the December quarter', () => {
    assert.equal(usExpectedPeriod('2027-03-01T00:00:00Z').period, 'Q2 FY27', 'Sep quarter still the expected one on 1 Mar');
    assert.equal(usExpectedPeriod('2027-04-05T00:00:00Z').period, 'Q3 FY27', 'Dec quarter due after 31 Mar');
    assert.equal(usExpectedPeriod('2026-09-24T00:00:00Z').period, 'Q1 FY27');
    assert.equal(usCalendarNow('2026-09-24T00:00:00Z').toISOString().slice(0, 10), '2026-09-24');
  });
});

// ── ENGINE INVARIANTS ON US ROWS ──────────────────────────────────────────
const G = (sales: number, eps: number, cfo = 1.1) => ({ ticker: 'T', market: 'US', source: 'sec-xbrl', sales_yoy_pct: sales, net_profit_yoy_pct: eps, eps_yoy_pct: eps, opm_pct: 15, opm_prev_pct: 13, opm_change_pp: 2, cfo_to_pat_ratio: cfo, period: 'Q2 FY2026' });
const AFFIRMATIVE = ['STRENGTHENING', 'ON_TRACK'];

describe('engine invariants (US rows through the shared engine)', () => {
  test('a nearest-fit type is provisional — never affirmative', () => {
    const r = newUsRow('NEAR', 'book', G(20, 24));
    assert.equal(r.pattern?.fit, 'nearest');
    assert.ok(!AFFIRMATIVE.includes(r.assessment!.status), r.assessment!.status);
  });
  test('no type fits → THESIS NOT SET, not a thesis status', () => {
    const r = newUsRow('NONE', 'book', G(3, -40, 0.5));
    assert.equal(r.pattern, null);
    assert.equal(r.assessment!.status, 'THESIS_NOT_SET');
    assert.equal(withThesisSet({ pattern: null }, r.assessment!).action, 'THESIS NOT SET');
  });
  test('silence is unknown: with nothing read, mechanism variables are never a pass', () => {
    const r = newUsRow('SIL', 'book', G(30, 60));
    assert.equal(r.pattern?.pattern, 'A');
    assert.ok(!AFFIRMATIVE.includes(r.assessment!.status), `unread evidence cannot read ${r.assessment!.status}`);
    const mech = r.assessment!.checked.filter((c) => ['utilisation', 'capacity', 'order_book'].includes(c.key));
    for (const c of mech) { assert.equal(c.verdict, 'unknown', c.key); assert.notEqual(c.state, 'FOUND'); }
  });
  test('a manual type is honoured; without evidence it stays short of affirmative', () => {
    const r = assessUsRow(newUsRow('MAN', 'book', G(3, -40, 0.5)), { MAN: 'B' });
    assert.equal(r.pattern?.fit, 'manual');
    assert.notEqual(r.assessment!.status, 'THESIS_NOT_SET');
    assert.ok(!AFFIRMATIVE.includes(r.assessment!.status));
  });
  test('a persisted US read → reload gives the same card inputs, zero network', async () => {
    const m = new Map<string, string>();
    setUsEvidenceKvForTests({ get: async <T = any>(k: string) => (m.has(k) ? JSON.parse(m.get(k)!) as T : null), set: async (k: string, v: any) => { m.set(k, JSON.stringify(v)); } });
    try {
      const cands = usCandidatesFromSubmissions(RECENT, 67887, NOW);
      const docs = usLedgerDocuments(cands, [{ url: cands[0].url, outcome: 'read', chars: 5000 }, { url: cands[1].url, outcome: 'read', chars: 3000 }]);
      const md = mdnaSection(usHtmlToText(TENQ_HTML), '10-Q');
      const quote = /Twelve-month backlog.*?customers\./.exec(md)![0];
      const ev = [{ variable: 'order_book', value_type: 'ACTUAL', before: '$1.6 billion', after: '$1.9 billion', unit: null, period: null, direction: 'up', evidence_text: quote, source: cands[0].label, confidence: 'HIGH' }];
      const p = await persistUsEvidenceRun({ ticker: 'ACMX', runId: 'r', startedAt: '2026-09-01T00:00:00Z', documents: docs, events: ev as any, summary: { events: ev, verdict_line: 'x', positives: [], us_fiscal: { label: 'Q2 FY2026' } }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'v', model: 'm', rawExtraction: null, pipeline: null });
      assert.equal(p.persisted, true);
      const realFetch = globalThis.fetch; let calls = 0;
      (globalThis as any).fetch = (() => { calls++; throw new Error('no network on reload'); }) as any;
      try {
        const a = applyUsLedger(newUsRow('ACMX', 'book', G(18, 37)), p.ledger);
        const b = applyUsLedger(newUsRow('ACMX', 'book', G(18, 37)), JSON.parse(JSON.stringify(p.ledger)));
        assert.deepEqual(JSON.parse(JSON.stringify(a.assessment)), JSON.parse(JSON.stringify(b.assessment)));
        assert.equal(a.reportingPeriod, 'Q1 FY27');
        assert.equal(a.fiscalLabel, 'Q2 FY2026');
        const ob = a.assessment!.checked.find((c) => c.key === 'order_book');
        assert.ok(ob && ob.verdict !== 'unknown', 'the backlog read from the 10-Q reaches the thesis row');
        // historical ≠ current / freshness: a filing seen but not read flags new evidence
        const seen = await persistUsSeen('ACMX', '2026-11-05', [{ url: filingIndexUrl(67887, '0000067887-26-000090'), kind: 'results', label: 'Form 10-Q — quarter ended 2026-09-26', dateIso: '2026-11-05' }]);
        assert.equal(seen.unseen.length, 1);
        const fr = usFreshness(seen.ledger, '2026-11-10T00:00:00Z');
        assert.equal(fr.state, 'NEW_EVIDENCE_AVAILABLE', 'newer filing unread is flagged');
        // the same filing already on file is NOT new
        const again = await persistUsSeen('ACMX', '2026-08-07', [{ url: cands[0].url, kind: 'results', label: cands[0].label, dateIso: cands[0].dateIso }]);
        assert.equal(again.unseen.length, 0);
      } finally { (globalThis as any).fetch = realFetch; }
      assert.equal(calls, 0);
    } finally { setUsEvidenceKvForTests(null); }
  });
  test('counts reconcile exactly: buckets + not assessed = shown = book + bench; Special Focus and near misses disjoint', () => {
    const rows = [
      newUsRow('A1', 'book', G(30, 60)), newUsRow('A2', 'book', G(20, 24)), newUsRow('A3', 'bench', G(3, -40, 0.5)),
      newUsRow('A4', 'both', null), { ...newUsRow('A5', 'bench', null), assessment: null },
    ];
    const CON = ['STRENGTHENING', 'ON_TRACK', 'CONFIRMATION_REQUIRED', 'POSITIVE_EXPECTATION_GAP'];
    const uc = universeCounts(rows as any, rows as any, CON);
    assert.equal(uc.statusSum + uc.notAssessed, uc.shown);
    assert.equal(uc.book + uc.bench, uc.shown);
    assert.equal(uc.exportable + uc.exportableUs + uc.excludedN, uc.evaluated);
    const ec = evidenceCounts(rows as any);
    assert.equal(ec.held + ec.bench, ec.total);
    assert.equal(Object.values(ec.by_state).reduce((a, b) => a + b, 0), ec.total);
    const live = new Map<string, any>();
    for (const r of rows) for (const pc of detectForRow(r as any)) live.set(pc.id, { pc, row: r });
    const q = specialFocusQueue<any>(live, {}, () => null);
    const nm = nearMissList<any>(live, q.entries);
    const inQ = new Set(q.entries.map((e) => e.pc.ticker));
    assert.ok(!nm.near.some((n) => inQ.has(n.pc.ticker)), 'a Special Focus company is never also a near miss');
  });
});
