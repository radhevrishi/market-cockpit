// zzz793 round 2 — US persistent catalysts and catalyst reading.
//   Filed order backlog (XBRL RPO) → order-book variable and Special Focus with
//   no AI read; US quarter revenue on the detector's scale; "$3,250" units;
//   deterministic US catalyst wording (sentences verbatim from live EDGAR
//   filings, 2026-09-24); catalyst 8-K candidates; strip names its company;
//   page block order; check-all batching.
// Run: npx tsx --test src/lib/__tests__/zzz793-us-pc-catalysts.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { rpoReadings, usdWords } from '../us-thesis/xbrl';
import { usFactsResult } from '../us-thesis/facts-row';
import { newUsRow, applyUsLedger, withXbrlOrderBook } from '../us-thesis/assess';
import { usDetect, usQuarterRevenueScale, usLedgerWithRpo } from '../us-thesis/persist-us';
import { usScaleMoney, sanitizeUsEvents } from '../us-thesis/sanitize';
import { usCatalystEvents, mergeUsEvents } from '../us-thesis/catalyst-text';
import { usCandidatesFromSubmissions, planUsRead, usLedgerDocuments } from '../us-thesis/adapter';
import { setUsEvidenceKvForTests, persistUsEvidenceRun } from '../us-thesis/evidence-store';
import { PersistentStrip } from '../../components/special-focus-panel';

(globalThis as any).React = React;
const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz793-us-pc-edgar.json'), 'utf8'));
const rowFrom = (t: string) => {
  const c = FX.companies[t];
  const r = usFactsResult(t, c.facts, { cik: c.cik, company: c.entityName, sic: c.sic, sicDescription: c.sicDescription, forms: c.forms });
  return newUsRow(t, 'book', r.row, r.why, 'NYSE', r.profile);
};
const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const rpoFacts = (rows: Array<[string, number, string]>) => ({ facts: { 'us-gaap': { RevenueRemainingPerformanceObligation: { units: { USD: rows.map(([end, val, filed]) => ({ end, val, filed, form: '10-Q' })) } } } } });

describe('filed order backlog (us-gaap RevenueRemainingPerformanceObligation)', () => {
  test('MOG-A: $7.10 billion at Jun 27 2026 against $5.51 billion a year earlier (+28.9%)', () => {
    const r = rpoReadings(FX.companies['MOG-A'].facts, '2026-06-27')!;
    assert.equal(r.cur.end, '2026-06-27');
    assert.equal(r.cur.value, 7_100_000_000);
    assert.equal(r.prev?.value, 5_510_000_000);
    assert.equal(r.pct, 28.9);
    assert.equal(usdWords(r.cur.value), '$7.10 billion');
  });
  test('a reading more than 100 days older than the latest quarter is stale → none (GNRC pattern)', () => {
    const f = rpoFacts([['2024-09-30', 400e6, '2024-10-30'], ['2025-09-30', 500e6, '2025-10-29']]);
    assert.equal(rpoReadings(f, '2026-06-30'), null);
    assert.ok(rpoReadings(f, '2025-12-31'));
  });
  test('a name that does not tag RPO has none — silence, never zero', () => {
    assert.equal(rpoReadings(FX.companies.RELL.facts, '2026-05-30'), null);
  });
  test('the order-book variable is filled from XBRL with no AI read', () => {
    const r = rpoReadings(FX.companies['MOG-A'].facts, '2026-06-27')!;
    const s = withXbrlOrderBook(null, r);
    assert.match(s.order_book.closing_value, /^\$7\.10 billion \(remaining performance obligations at .*SEC XBRL\)$/);
    assert.match(s.order_book.growth, /^\+28\.9% year on year/);
    const had = { order_book: { closing_value: '$3.3 billion', growth: null } };
    assert.equal(withXbrlOrderBook(had, r), had, 'a read figure is never overwritten');
    const row = rowFrom('MOG-A');
    const ob = (row.assessment as any)?.mechanismEvidence?.find((c: any) => c.key === 'order_book');
    assert.ok(ob && /\$7\.10 billion .*SEC XBRL/.test(String(ob.text)), JSON.stringify(ob));
  });
});

describe('Special Focus on US inputs (the India gate, unchanged)', () => {
  test('quarter revenue on the detector scale is USD millions ÷ 10; non-USD is not converted', () => {
    assert.equal(usQuarterRevenueScale({ revenue_curr_musd: 1116.5, currency: 'USD' }), 111.65);
    assert.equal(usQuarterRevenueScale({ revenue_curr_musd: 100, currency: 'CNY' }), null);
    assert.equal(usQuarterRevenueScale({}), null);
  });
  test('MOG-A qualifies from filed RPO alone: two filings a year apart = two evidence periods', () => {
    const row = rowFrom('MOG-A');
    const led = usLedgerWithRpo(row);
    const facts = Object.values(led.periods).flatMap((p: any) => p.facts).filter((f: any) => f.metric_name === 'order_book');
    assert.equal(facts.length, 2);
    assert.ok(facts.every((f: any) => /SEC XBRL/.test(f.source_quote)));
    const pcs = usDetect(row);
    const sf = pcs.find((p) => p.specialFocus);
    assert.ok(sf, JSON.stringify(pcs.map((p) => [p.kind, p.confidence, p.evidencePeriods, p.toQualify])));
    assert.ok((sf!.evidencePeriods ?? 0) >= 2);
    assert.ok(['MEDIUM', 'HIGH'].includes(sf!.confidence));
  });
  test('RELL: one filing with an in-document prior is ONE evidence period → near miss, not Special Focus', async () => {
    const m = new Map<string, string>();
    setUsEvidenceKvForTests({ get: async (k: string) => (m.has(k) ? JSON.parse(m.get(k)!) : null), set: async (k: string, v: any) => { m.set(k, JSON.stringify(v)); } } as any);
    const recent = [{ form: '8-K', filingDate: '2026-07-22', reportDate: '2026-07-22', items: ['2.02', '9.01'], accession: '0000355948-26-000020' }];
    const c = usCandidatesFromSubmissions(recent, 355948, new Date('2026-09-24T00:00:00Z'));
    const docs = usLedgerDocuments(c, c.map((x) => ({ url: x.url, outcome: 'read' as const, chars: 5000 })));
    const events = usCatalystEvents([{ label: c[0].label, text: 'Backlog grew 8.7% to $164.4 million at the end of the fourth quarter of fiscal 2026, versus $151.2 million at the end of the third quarter of fiscal 2026, primarily driven by an increase in PMT.' }]);
    const p = await persistUsEvidenceRun({ ticker: 'RELL', runId: 'r', startedAt: '2026-09-24T00:00:00Z', documents: docs, events: events as any, summary: { verdict_line: 'x', positives: [], events }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'v', model: 'm', rawExtraction: null, pipeline: null } as any);
    const row = applyUsLedger(rowFrom('RELL'), p.ledger);
    const pcs = usDetect(row);
    assert.ok(pcs.length, 'a candidate is detected');
    assert.ok(!pcs.some((x) => x.specialFocus), 'not Special Focus on one period');
    assert.ok(pcs.every((x) => (x.evidencePeriods ?? 0) < 2));
    assert.ok(pcs.some((x) => x.toQualify.length > 0), 'the missing piece is named');
  });
});

describe('"$3,250" in a table is scaled from its context, or dropped', () => {
  test('(in millions) → $3,250 million; (in thousands) → thousand; no scale → dropped', () => {
    assert.equal(usScaleMoney('order_book', '$3,250', 'Backlog (in millions) $3,250').value, '$3,250 million');
    assert.equal(usScaleMoney('order_book', '$3,250', '(in thousands) backlog $3,250').value, '$3,250 thousand');
    assert.equal(usScaleMoney('order_book', '$3,250', 'Backlog was $3,250').value, null);
    assert.equal(usScaleMoney('order_book', '$164.4 million', null).value, '$164.4 million');
    assert.equal(usScaleMoney('margin', '$3,250', null).value, '$3,250', 'not a money variable');
  });
  test('an event whose only figure is unscaled is not kept', () => {
    const out = sanitizeUsEvents([{ variable: 'order_book', after: '$3,250', before: null, unit: null, evidence_text: 'Backlog $3,250' }]);
    assert.ok(!out.some((e) => e.after === '$3,250'));
  });
});

describe('US catalyst wording read with no model (verbatim live sentences)', () => {
  const one = (text: string) => usCatalystEvents([{ label: 'doc', text }]);
  test('RELL backlog: before → after', () => {
    const e = one('Backlog grew 8.7% to $164.4 million at the end of the fourth quarter of fiscal 2026, versus $151.2 million at the end of the third quarter of fiscal 2026, primarily driven by an increase in PMT.').find((x) => x.variable === 'order_book')!;
    assert.equal(e.after, '$164.4 million');
    assert.equal(e.before, '$151.2 million');
    assert.equal(e.direction, 'up');
  });
  test('POWL: bookings compared to the prior year; backlog; book-to-bill', () => {
    const ev = one('New orders (2) totaled $934 million compared to $362 million in the prior year and $490 million in the second quarter of Fiscal 2026. Backlog (3) totaled $2.4 billion as of June 30, 2026, an increase of 69% compared to $1.4 billion as of June 30, 2025. Powell was awarded a record $934 million of new orders (2) in the quarter and reported a book-to-bill ratio of 3.0x.');
    const oi = ev.find((x) => x.variable === 'order_intake')!;
    assert.deepEqual([oi.after, oi.before], ['$934 million', '$362 million']);
    const ob = ev.find((x) => x.variable === 'order_book')!;
    assert.deepEqual([ob.after, ob.before], ['$2.4 billion', '$1.4 billion']);
    assert.equal(ev.find((x) => x.variable === 'book_to_bill')?.after, '3.0x');
  });
  test('STRL: the period-end RPO is read; "This compares to …" history is not', () => {
    const ev = one('At June 30, 2026, our RPOs were $4.23 billion and our MSAs were $100.0 million, resulting in a total Backlog of $4.33 billion. This compares to December 31, 2025, when RPOs were $3.01 billion.');
    const ob = ev.filter((x) => x.variable === 'order_book');
    assert.equal(ob.length, 1);
    assert.equal(ob[0].after, '$4.23 billion');
  });
  test('MOG-A twelve-month backlog is revenue visibility, not the order book', () => {
    const ev = one('Twelve-month backlog increased 23% to $3.3 billion, reflecting continued demand across our markets.');
    assert.ok(!ev.some((x) => x.variable === 'order_book'));
    assert.equal(ev.find((x) => x.variable === 'revenue_visibility')?.after, '$3.3 billion');
  });
  test('unsigned / combined backlog and nine-month bookings are skipped', () => {
    assert.ok(!one('Including unsigned awards, our combined backlog was $5.1 billion at quarter end.').some((x) => x.variable === 'order_book'));
    assert.ok(!one('Bookings for the nine months ended June 30, 2026 were $1.9 billion in total.').some((x) => x.variable === 'order_intake'));
  });
  test('a management remark ("as of today") is a claim, not a filed figure', () => {
    const e = one('As of today, our data center backlog is approximately $1.6 billion across our customers.').find((x) => x.variable === 'order_book')!;
    assert.equal(e.value_type, 'MANAGEMENT_CLAIM');
  });
  test('guidance raised is read as guidance', () => {
    const e = one('Achieves Record Third Quarter 2026 Results Through Operational Excellence and Raises Full-Year Guidance').find((x) => x.variable === 'guidance')!;
    assert.equal(e.direction, 'up');
  });
  test('merge: the model\'s figure for a variable is not doubled by a deterministic one', () => {
    const model = one('Backlog grew 8.7% to $164.4 million at the end of the fourth quarter of fiscal 2026, versus $151.2 million at the end of the third quarter.');
    const det = one('Our backlog increased to $170.0 million as of the end of the quarter, a new record for the company.');
    assert.equal(mergeUsEvents(model, det).filter((x) => x.variable === 'order_book').length, 1);
  });
});

describe('catalyst 8-K press releases', () => {
  const NOW = new Date('2026-09-24T00:00:00Z');
  const RECENT = [
    { form: '8-K', filingDate: '2026-08-03', reportDate: '2026-08-03', items: ['2.02', '9.01'], accession: '0000874238-26-000030' },
    { form: '10-Q', filingDate: '2026-08-04', reportDate: '2026-06-30', items: [], accession: '0000874238-26-000031' },
    { form: '8-K', filingDate: '2026-07-08', reportDate: '2026-07-08', items: ['1.01', '7.01'], accession: '0000874238-26-000025' },
    { form: '8-K', filingDate: '2026-09-10', reportDate: '2026-09-10', items: ['8.01'], accession: '0000874238-26-000040' },
    { form: '8-K', filingDate: '2026-03-01', reportDate: '2026-03-01', items: ['8.01'], accession: '0000874238-26-000005' },
    { form: '8-K', filingDate: '2026-09-01', reportDate: '2026-09-01', items: ['5.02'], accession: '0000874238-26-000039' },
  ];
  test('Items 1.01 / 7.01 / 8.01 within ~120 days, labelled with form, item and date; old and 5.02 excluded', () => {
    const c = usCandidatesFromSubmissions(RECENT, 874238, NOW, { catalystDays: 120 }).filter((x) => x.role === 'catalyst');
    assert.deepEqual(c.map((x) => x.accession).sort(), ['0000874238-26-000025', '0000874238-26-000040']);
    for (const x of c) {
      assert.equal(x.kind, 'announcement');
      assert.match(x.label, /^Press release — 8-K Item .*filed 2026-\d\d-\d\d$/);
    }
  });
  test('default candidates are unchanged (no catalysts unless asked)', () => {
    assert.ok(!usCandidatesFromSubmissions(RECENT, 874238, NOW).some((x) => x.role === 'catalyst'));
  });
  test('a catalyst release never decides the quarter being read', () => {
    const c = usCandidatesFromSubmissions(RECENT, 874238, NOW, { catalystDays: 120 });
    const plan = planUsRead(c);
    assert.ok(plan.docs.length > 0);
    assert.ok(plan.docs.every((d) => d.role !== 'catalyst'));
  });
  test('the ledger period comes from results documents, not announcements', () => {
    assert.match(src('lib/us-thesis/evidence-store.ts'), /kind !== 'announcement'/);
  });
});

describe('layout and batching', () => {
  test('the strip names its company only when given a ticker (India unchanged)', () => {
    const pcs = usDetect(rowFrom('MOG-A'));
    const us = renderToStaticMarkup(React.createElement(PersistentStrip, { pcs, ticker: 'MOG-A' }));
    const india = renderToStaticMarkup(React.createElement(PersistentStrip, { pcs }));
    assert.match(us, /MOG-A · /);
    assert.ok(!/MOG-A · /.test(india));
    assert.equal(us.replace(/<b[^>]*>MOG-A · <\/b>/, ''), india);
  });
  test('each US card is one block: company line, then strip, then card', () => {
    const p = src('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    const block = p.indexOf('data-testid="us-card-block"');
    const strip = p.indexOf('<PersistentStrip ticker=', block);
    const card = p.indexOf('<ThesisCard', block);
    assert.ok(block > 0 && strip > block && card > strip);
    assert.ok(!/^\s*export (?!default)/m.test(p), 'no named exports from page.tsx');
  });
  test('check-all takes ?offset=&limit= and returns next_offset', () => {
    const r = src('app/api/v1/us-thesis/check-all/route.ts');
    assert.match(r, /sp\.get\('offset'\)/);
    assert.match(r, /sp\.get\('limit'\)/);
    assert.match(r, /next_offset/);
  });
});
