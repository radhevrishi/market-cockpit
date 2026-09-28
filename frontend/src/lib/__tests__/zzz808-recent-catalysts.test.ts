// zzz808 — "New · last 10 days" on both Portfolio Catalysts pages.
//
// The helper (lib/catalyst/recent-events) merges every dated filing, extracted
// event, persistent-catalyst item and exchange-feed result for the names on a
// page into one newest-first list with ONE filter (event type). Generic,
// made-up tickers only.
// Run: npx tsx --test src/lib/__tests__/zzz808-recent-catalysts.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  inWindow, daysAgo, windowStartDay, isRoutine, routineReason, eventTypeOf, badgeOf, thesisTouchFor,
  mergeRaw, buildRecentCatalysts, filterByType, typeCounts, rawFromLedger, rawFromPersistent, rawFromFeed,
  EVENT_TYPES, type RawEvent,
} from '../catalyst/recent-events';

const TODAY = '2026-09-28';
const doc = (o: Partial<RawEvent>): RawEvent => ({ ticker: 'ALPHA', date: TODAY, title: 'Financial Results for the quarter', origin: 'ledger-doc', source: 'BSE corporate announcements', url: `https://www.bseindia.com/x/${Math.random().toString(36).slice(2)}.pdf`, ...o });

describe('10-day window boundary', () => {
  test('9 days ago is in, 10 days ago is out', () => {
    assert.equal(daysAgo('2026-09-19', TODAY), 9);
    assert.equal(inWindow('2026-09-19', TODAY), true);
    assert.equal(inWindow('2026-09-18', TODAY), false);
    assert.equal(inWindow(TODAY, TODAY), true);
    assert.equal(windowStartDay(TODAY), '2026-09-19');
  });
  test('one day ahead is tolerated (IST vs Europe); further ahead is not', () => {
    assert.equal(inWindow('2026-09-29', TODAY), true);
    assert.equal(inWindow('2026-10-02', TODAY), false);
  });
  test('datetimes and bad dates', () => {
    assert.equal(inWindow('2026-09-20T18:30:00Z', TODAY), true);
    assert.equal(inWindow(null, TODAY), false);
    assert.equal(inWindow('Sep 2026', TODAY), false);
  });
  test('across a month boundary', () => {
    assert.equal(inWindow('2026-09-25', '2026-10-05'), false);
    assert.equal(inWindow('2026-09-26', '2026-10-05'), true);
  });
  test('buildRecentCatalysts keeps only the window', () => {
    const r = buildRecentCatalysts([
      doc({ date: '2026-09-19', title: 'Receipt of order worth Rs 120 Cr' }),
      doc({ date: '2026-09-18', title: 'Receipt of order worth Rs 80 Cr' }),
    ], TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].date, '2026-09-19');
  });
});

describe('newest first', () => {
  test('sorted by date descending, then by type order', () => {
    const r = buildRecentCatalysts([
      doc({ ticker: 'BETA', date: '2026-09-21', title: 'Investor Presentation' }),
      doc({ ticker: 'ALPHA', date: '2026-09-27', title: 'Financial Results' }),
      doc({ ticker: 'GAMMA', date: '2026-09-27', title: 'Bagging/Receiving of orders/contracts' }),
      doc({ ticker: 'DELTA', date: '2026-09-24', title: 'Commissioning of new plant' }),
    ], TODAY);
    assert.deepEqual(r.items.map((e) => e.ticker), ['GAMMA', 'ALPHA', 'DELTA', 'BETA']);
    assert.deepEqual(r.items.map((e) => e.date), ['2026-09-27', '2026-09-27', '2026-09-24', '2026-09-21']);
  });
});

describe('routine filtering', () => {
  test('noise subjects are routine', () => {
    for (const t of [
      'Closure of Trading Window',
      'Intimation of Analyst / Investor Meet',
      'Analysts/Institutional Investor Meet/Con. Call Updates - Intimation',
      'Copy of Newspaper Publication',
      'Newspaper Advertisement - Financial Results',
      'Prior Intimation of Board Meeting',
      'Compliance Certificate under Regulation 74(5)',
    ]) assert.equal(isRoutine(t), true, t);
    assert.equal(routineReason('Closure of Trading Window'), 'trading window');
  });
  test('real catalysts are not routine', () => {
    for (const t of ['Financial Results for Q1 FY27', 'Transcript of Analyst Meet / Con. Call', 'Bagging/Receiving of orders/contracts', 'Transcript of Earnings Call', 'Form 10-Q — quarter ended 2026-06-30 (MD&A)'])
      assert.equal(isRoutine(t), false, t);
  });
  test('routine is hidden from items but counted', () => {
    const r = buildRecentCatalysts([
      doc({ title: 'Closure of Trading Window' }),
      doc({ title: 'Copy of Newspaper Publication' }),
      doc({ title: 'Financial Results' }),
    ], TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.hidden.length, 2);
    assert.equal(r.counts.All, 1);
  });
  test('empty state: last new item date is the newest non-routine item outside the window', () => {
    const r = buildRecentCatalysts([
      doc({ ticker: 'ALPHA', date: '2026-08-30', title: 'Financial Results' }),
      doc({ ticker: 'BETA', date: '2026-09-02', title: 'Receipt of order' }),
      doc({ ticker: 'GAMMA', date: '2026-09-25', title: 'Closure of Trading Window' }),
    ], TODAY);
    assert.equal(r.items.length, 0);
    assert.equal(r.hidden.length, 1);
    assert.deepEqual(r.lastItem, { date: '2026-09-02', ticker: 'BETA' });
  });
});

describe('dedupe across sources', () => {
  const url = 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/abc.pdf';
  test('ledger doc + pending doc + extracted event on the same URL → one row', () => {
    const rows = mergeRaw([
      doc({ url, title: 'Bagging/Receiving of orders/contracts', origin: 'ledger-doc' }),
      doc({ url: url.replace('https://www.', 'http://') + '?x=1', title: 'Bagging/Receiving of orders/contracts', origin: 'pending-doc' }),
      doc({ url, title: 'Bagging/Receiving of orders/contracts', origin: 'ledger-event', variable: 'order_intake', figure: '₹450 Cr', text: 'Order intake: ₹450 Cr', thesis: 'supports' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].figure, '₹450 Cr');
    assert.equal(rows[0].thesis, 'supports');
    assert.match(rows[0].what, /₹450 Cr/);
    assert.deepEqual(rows[0].origins.sort(), ['ledger-doc', 'ledger-event', 'pending-doc']);
  });
  test('the exchange feed (no URL) joins the same-day results PDF', () => {
    const rows = mergeRaw([
      doc({ url, title: 'Financial Results for the quarter ended June 2026', kind: 'results' }),
      ...rawFromFeed([{ ticker: 'ALPHA', reported_at: TODAY, subject: 'Outcome of Board Meeting - Financial Results' }]),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url !== null, true);
  });
  test('same subject filed twice under two links → duplicate hidden as routine', () => {
    const r = buildRecentCatalysts([
      doc({ title: 'Receipt of order from a state utility', url: 'https://www.bseindia.com/a.pdf' }),
      doc({ title: 'Receipt of order from a state utility', url: 'https://nsearchives.nseindia.com/b.pdf' }),
    ], TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.hidden.length, 1);
    assert.equal(r.hidden[0].routineWhy, 'duplicate filing');
  });
  test('different names on the same day never merge', () => {
    const rows = mergeRaw([doc({ ticker: 'ALPHA', url }), doc({ ticker: 'BETA', url })]);
    assert.equal(rows.length, 2);
  });
});

describe('type mapping', () => {
  const cases: Array<[string, string]> = [
    ['Bagging/Receiving of orders/contracts', 'Order win'],
    ['Letter of Award from NHAI', 'Order win'],
    ['Financial Results for the quarter ended 30-Jun-2026', 'Results'],
    ['Earnings release — 8-K Item 2.02 (EX-99.1), filed 2026-09-22', 'Results'],
    ['Form 10-Q — quarter ended 2026-06-30 (MD&A), filed 2026-08-05', 'Results'],
    ['Commissioning of new manufacturing line', 'Capex / capacity'],
    ['Capacity expansion at Unit 2', 'Capex / capacity'],
    ['Transcript of Earnings Conference Call', 'Concall / business update'],
    ['Investor Presentation Q1 FY27', 'Concall / business update'],
    ['Press release — 8-K Item 7.01 (Regulation FD disclosure), filed 2026-09-20', 'Concall / business update'],
    ['Updated revenue guidance for FY27', 'Guidance'],
    ['Acquisition of 51% stake in a subsidiary', 'Acquisition'],
    ['Appointment of Chief Financial Officer', 'Management change'],
    ['Receipt of USFDA approval for ANDA', 'Regulatory approval'],
    ['Preferential allotment of warrants', 'Fund raise'],
    ['Qualified Institutions Placement - launch', 'Fund raise'],
    ['Disclosure under SEBI Takeover Regulations 29(2)', 'Acquisition'],
    ['Clarification sought by exchange', 'Other filing'],
  ];
  for (const [t, want] of cases) test(`${t} → ${want}`, () => assert.equal(eventTypeOf(t), want));
  test('variable decides when the title does not', () => {
    assert.equal(eventTypeOf('Clarification', 'order_book'), 'Order win');
    assert.equal(eventTypeOf('Update', 'utilisation'), 'Capex / capacity');
    assert.equal(eventTypeOf('Document', null, 'transcript'), 'Concall / business update');
  });
  test('every type is a plain-words label from the fixed list', () => {
    assert.equal(EVENT_TYPES.length, 10);
    assert.ok(EVENT_TYPES.includes('Other filing'));
  });
});

describe('badge and thesis touch', () => {
  test('filed vs press only', () => {
    assert.equal(badgeOf('SEC EDGAR'), 'filed');
    assert.equal(badgeOf('BSE corporate announcements'), 'filed');
    assert.equal(badgeOf('Economic Times'), 'press');
    assert.equal(badgeOf(null, 'https://www.sec.gov/Archives/x-index.htm'), 'filed');
  });
  test('thesis touch is read from the assessment, never judged', () => {
    const a = { status: 'ON_TRACK', checked: [
      { key: 'order_book', verdict: 'improving' },
      { key: 'margin', verdict: 'deteriorating' },
      { key: 'utilisation', verdict: 'deteriorating', watch: true },
      { key: 'capex', verdict: 'flat' },
    ] };
    assert.equal(thesisTouchFor(a, 'order_book'), 'supports');
    assert.equal(thesisTouchFor(a, 'margin'), 'against');
    assert.equal(thesisTouchFor(a, 'utilisation'), 'neutral');
    assert.equal(thesisTouchFor(a, 'capex'), 'neutral');
    assert.equal(thesisTouchFor(a, 'guidance'), 'not assessed');
    assert.equal(thesisTouchFor(null, 'order_book'), 'not assessed');
    assert.equal(thesisTouchFor({ status: 'THESIS_NOT_SET', checked: a.checked }, 'order_book'), 'not assessed');
  });
});

describe('filter counts', () => {
  const r = buildRecentCatalysts([
    doc({ ticker: 'A1', title: 'Receipt of order worth Rs 50 Cr' }),
    doc({ ticker: 'A2', title: 'Bagging/Receiving of orders/contracts' }),
    doc({ ticker: 'A3', title: 'Financial Results' }),
    doc({ ticker: 'A4', title: 'Transcript of Earnings Call' }),
    doc({ ticker: 'A5', title: 'Closure of Trading Window' }),
  ], TODAY);
  test('counts per type sum to All and exclude routine', () => {
    assert.equal(r.counts.All, 4);
    assert.equal(r.counts['Order win'], 2);
    assert.equal(r.counts.Results, 1);
    assert.equal(r.counts['Concall / business update'], 1);
    assert.equal(r.counts['Fund raise'], 0);
    const sum = EVENT_TYPES.reduce((s, t) => s + r.counts[t], 0);
    assert.equal(sum, r.counts.All);
  });
  test('the one filter returns exactly the counted rows', () => {
    for (const t of EVENT_TYPES) assert.equal(filterByType(r.items, t).length, r.counts[t], t);
    assert.equal(filterByType(r.items, 'All').length, r.counts.All);
    assert.deepEqual(typeCounts(filterByType(r.items, 'Order win')).All, 2);
  });
});

describe('ledger + persistent adapters', () => {
  const ledger = {
    periods: {
      'Jun 2026': {
        documents: [
          { id: 'd1', url: 'https://www.bseindia.com/r.pdf', label: 'Financial Results', kind: 'results', source: 'BSE corporate announcements', date_iso: '2026-09-25', outcome: 'read' },
          { id: 'd2', url: 'https://www.bseindia.com/t.pdf', label: 'Transcript of Earnings Call', kind: 'transcript', source: 'BSE corporate announcements', date_iso: '2026-09-26', outcome: 'read' },
          { id: 'd3', url: 'https://www.bseindia.com/old.pdf', label: 'Investor Presentation', kind: 'investor_presentation', source: 'BSE corporate announcements', date_iso: '2026-06-10', outcome: 'not_selected' },
          { id: 'd4', url: 'https://www.bseindia.com/nodate.pdf', label: 'Something', kind: 'other', source: 'BSE', date_iso: null, outcome: 'read' },
        ],
        events: [
          { id: 'e1', variable: 'utilisation', before: '68%', after: '81%', unit: '%', evidence_text: 'Utilisation rose to 81% from 68%.', source_document_id: 'd2' },
          { id: 'e2', variable: 'order_book', before: null, after: null, unit: null, evidence_text: 'Order book remains healthy.', source_document_id: 'd2' },
          { id: 'e3', variable: 'capex', after: '₹200 Cr', source_document_id: 'd2', record_status: 'SUPERSEDED' },
        ],
      },
    },
    pending_documents: [{ id: 'p1', url: 'https://www.bseindia.com/o.pdf', label: 'Bagging/Receiving of orders/contracts', kind: 'announcement', date_iso: '2026-09-27' }],
  };
  const assessment = { status: 'STRENGTHENING', checked: [{ key: 'utilisation', verdict: 'improving' }] };
  test('one row per document; figures only from the source; superseded ignored', () => {
    const r = buildRecentCatalysts(rawFromLedger('ALPHA', 'Alpha Industries', ledger, assessment), TODAY);
    assert.deepEqual(r.items.map((e) => e.type), ['Order win', 'Concall / business update', 'Results']);
    const tr = r.items.find((e) => e.type === 'Concall / business update')!;
    assert.equal(tr.figure, '68% → 81%');
    assert.equal(tr.thesis, 'supports');
    assert.equal(tr.company, 'Alpha Industries');
    assert.match(tr.what, /\+1 more point/);
    const res = r.items.find((e) => e.type === 'Results')!;
    assert.equal(res.figure, null);
    assert.equal(res.thesis, 'not assessed');
    assert.deepEqual(r.lastItem, { date: '2026-09-27', ticker: 'ALPHA' });
  });
  test('persistent items merge with the document they cite', () => {
    const pcs = [{ ticker: 'ALPHA', evidence: [{ metric: 'utilisation', text: 'Utilisation 81%', before: '68%', after: '81%', date: '2026-09-26', origin: 'ledger', sources: [{ name: 'BSE corporate announcements', url: 'https://www.bseindia.com/t.pdf', date: '2026-09-26', quote: null }] }], forward: [] }];
    const raws = [...rawFromLedger('ALPHA', null, ledger, assessment), ...rawFromPersistent('ALPHA', null, pcs, assessment)];
    const r = buildRecentCatalysts(raws, TODAY);
    assert.equal(r.items.filter((e) => e.url === 'https://www.bseindia.com/t.pdf').length, 1);
  });
  test('a gainer-origin item from news is press only', () => {
    const pcs = [{ ticker: 'ALPHA', evidence: [{ metric: 'order_win', text: 'Wins export order', date: '2026-09-24', origin: 'gainer', sources: [{ name: 'Economic Times', url: 'https://example.com/news/1', date: '2026-09-24', quote: null }] }], forward: [] }];
    const r = buildRecentCatalysts(rawFromPersistent('ALPHA', null, pcs, null), TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].badge, 'press');
    assert.equal(r.items[0].type, 'Order win');
  });
  test('no ledger → nothing, never a crash', () => {
    assert.deepEqual(rawFromLedger('X', null, null), []);
    assert.deepEqual(rawFromPersistent('X', null, undefined), []);
  });
});

describe('plain words only', () => {
  test('no BUY/SELL words and no 0–100 score in any output row', () => {
    const r = buildRecentCatalysts([doc({ title: 'Financial Results' }), doc({ title: 'Receipt of order' })], TODAY);
    for (const e of r.items) {
      const s = JSON.stringify(e);
      assert.doesNotMatch(s, /\b(BUY|SELL)\b/);
      assert.equal('score' in e, false);
    }
  });
});
