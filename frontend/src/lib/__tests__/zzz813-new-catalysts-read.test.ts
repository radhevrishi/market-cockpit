// zzz813 — "New · last 10 days" reads the documents and shows what matters.
//
// The owner's verdict on v1: most rows were raw exchange subject lines with no
// content, several were typed wrong (a BMC tax notice as ORDER WIN, a promoter
// inter-se transfer as ACQUISITION, a reply to an exchange query as RESULTS),
// one scheme was split into four rows, and almost every thesis cell said
// "Not assessed". Fixtures below use the real subject lines he quoted; the
// document texts are short synthetic letters in the same shape. No figure in
// any expected line is absent from its source text.
// Run: npx tsx --test src/lib/__tests__/zzz813-new-catalysts-read.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  subjectClass, buildRecentCatalysts, thesisFor, importanceOf, normUrl, windowRange, inRange, groupByDay, topOfWindow,
  countInRange, compareWithinDay, dayLabel, rowAnchor, type RawEvent, type FilingRead, type ThesisCtx, type RecentEvent,
} from '../catalyst/recent-events';
import { readFilingText, resultsLine, capacityLine, schemeLine, toFilingRead, FILING_READ_VERSION } from '../catalyst/filing-read';

const TODAY = '2026-09-28';
const PAD = ' This is for your information and records. The same shall also be available on the website of the Company for the information of shareholders and investors at large.';
let n = 0;
const filing = (o: Partial<RawEvent>): RawEvent => ({ ticker: 'ALPHA', date: '2026-09-26', title: 'x', origin: 'ledger-doc', source: 'BSE corporate announcements', url: `https://www.bseindia.com/xml-data/corpfiling/AttachLive/f${++n}.pdf`, ...o });
const read = (url: string, text: string, subject: string, market: 'IN' | 'US' = 'IN', company?: string): FilingRead =>
  toFilingRead(url, readFilingText({ subject, text, market, company }), null);

// ── 1. subject classifier, on the owner's own lines ──────────────────────
describe('type mapping — real subject lines', () => {
  const cases: Array<[string, string, string | null, boolean?]> = [
    ['Reply to Clarification- Financial results', 'Exchange clarification', null],
    ['Spurt in Volume', 'Exchange clarification', null],
    ['Clarification On Volume Movement', 'Exchange clarification', null],
    ['Action(s) initiated or orders passed', 'Regulatory / legal action', null],
    ['Inter-Se Transfer Of Shares Between Promoter / Promoter Group Under Regulation 10(5) Of SEBI (SAST) Regulations', 'Promoter holding change', null],
    ['Disclosure under Regulation 29(2) of SEBI (SAST) Regulations, 2011', 'Shareholding disclosure', null],
    ["Scheme of Arrangement between Dalmia Bharat Refractories Limited ('Demerged Company') and Himadri Speciality Chemical Limited ('Resulting Company')", 'Corporate restructuring', null],
    ['Sale or disposal', 'Divestment', null],
    ['Bagging/Receiving of orders/contracts', 'Order win', null],
    ['Outcome of Board Meeting - Financial Results for the quarter ended June 30, 2026', 'Results', null],
    ['Change in Directors/ Key Managerial Personnel/ Auditor/ Compliance Officer/ Share Transfer Agent', 'Management change', null],
    ['Intimation Regarding ESG Rating', 'Other filing', 'ESG rating'],
    ['Shareholders meeting', 'Other filing', 'shareholder meeting / record date'],
    ['Repayment of Commercial Paper', 'Other filing', 'debt servicing (CP / NCD repayment)'],
    ['Intimation of redemption of commercial papers (CPs) on maturity', 'Other filing', 'debt servicing (CP / NCD repayment)'],
    ['Copy of Newspaper Publication', 'Other filing', 'newspaper advertisement'],
    ['Closure of Trading Window', 'Other filing', 'trading window'],
  ];
  for (const [t, ty, routine] of cases) {
    test(`${t.slice(0, 60)} → ${routine ? `routine (${routine})` : ty}`, () => {
      const s = subjectClass(t);
      assert.equal(s.type, ty);
      assert.equal(s.routine, routine);
    });
  }
  test('an order passed by an authority is never an order win', () => {
    assert.notEqual(subjectClass('Action(s) initiated or orders passed').type, 'Order win');
  });
  test('generic subjects are left to the document', () => {
    for (const t of ['Press Release', 'Announcement under Regulation 30 (LODR)-Press Release', 'General Updates', 'Updates', 'Reg 23(5)(i): Disclosure of material issue', 'Outcome of Board Meeting']) {
      const s = subjectClass(t);
      assert.equal(s.generic, true, t);
      assert.equal(s.routine, null, t);
    }
  });
  test('CEO / CFO / MD level is recognised', () => {
    assert.equal(subjectClass('Appointment of Chief Financial Officer').senior, true);
    assert.equal(subjectClass('Appointment of Company Secretary').senior, false);
  });
});

// ── 2. the deterministic reader ──────────────────────────────────────────
describe('document read — one line, stated figures only', () => {
  const cupid = 'Pursuant to Regulation 30 of SEBI (LODR) Regulations, 2015, please find enclosed the press release. The Company reports Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores, up 32% YoY. EBITDA at Rs. 21.2 Crores as against Rs. 14.1 Crores. Net Profit of Rs. 17.9 Crores, higher by 41%.' + PAD;
  test('results press release → Q1 FY27 line with the stated figures', () => {
    const r = readFilingText({ subject: 'Press Release', text: cupid, market: 'IN' });
    assert.equal(r.kind, 'Results');
    assert.equal(r.line, 'Q1 FY27: Revenue ₹78.4 Cr (up 32%), EBITDA ₹21.2 Cr (vs ₹14.1 Cr), PAT ₹17.9 Cr (up 41%)');
    for (const f of ['78.4', '32', '21.2', '14.1', '17.9', '41']) assert.ok(cupid.includes(f), f);
    assert.ok(r.touches!.some((t) => t.key === 'revenue_growth' && t.dir === 'up'));
  });
  test('a results line never borrows another metric\'s figure', () => {
    assert.equal(resultsLine('Revenue and EBITDA grew strongly; EBITDA at Rs. 50 Crores for the quarter ended June 30, 2026 as per the results.' + PAD), 'period ended June 30, 2026: EBITDA ₹50 Cr');
    assert.equal(resultsLine('The board met today and approved the results. No figures here.' + PAD), null);
  });
  test('GOLDIAM-style tax notice → regulatory / legal action, amount stated, no material impact', () => {
    const text = 'We wish to inform that the Company has received a property tax demand notice from the Brihanmumbai Municipal Corporation (BMC) for an amount of Rs. 2.4 Crores for the period FY2019-2026. The Company is evaluating legal remedies. There is no material impact on the financial or operational activities of the Company.' + PAD;
    const r = readFilingText({ subject: 'Action(s) initiated or orders passed', text, market: 'IN' });
    assert.match(r.line!, /^The Company has received a property tax demand notice from the Brihanmumbai Municipal Corporation \(BMC\) for an amount of Rs\. 2\.4 Crores/);
    assert.match(r.line!, /company says no material impact$/);
    assert.equal(r.noImpact, true);
  });
  test('capacity 5,000 → 9,600+ MTPA (+92%), commissioned — the % from the two stated capacities', () => {
    const text = 'Xanthine derivatives capacity expanded from 5,000 MTPA to 9,600+ MTPA and was successfully commissioned in Q1 FY27. We added a new CDMO customer, a global innovator. Our site was approved by two innovators.' + PAD;
    assert.equal(capacityLine(text), 'Capacity 5,000 → 9,600+ MTPA (+92%), commissioned');
    const r = readFilingText({ subject: 'Investor Presentation', text, market: 'IN' });
    assert.match(r.line!, /^Capacity 5,000 → 9,600\+ MTPA \(\+92%\), commissioned/);
    assert.match(r.line!, /new CDMO customer/);
    assert.deepEqual(r.touches!.map((t) => t.key).sort(), ['capacity_addition', 'new_customer', 'qualification']);
  });
  test('HSCL scheme → one line, direction named', () => {
    const text = 'The Board of Directors considered and approved the Composite Scheme of Arrangement between Dalmia Bharat Refractories Limited ("Demerged Company") and Himadri Speciality Chemical Limited ("Resulting Company") and their respective shareholders. As consideration, 1 (One) fully paid-up equity share of Himadri Speciality Chemical Limited shall be issued for every 10 (Ten) fully paid-up equity shares held in the Demerged Company.' + PAD;
    assert.equal(schemeLine(text, 'Himadri Speciality Chemical Ltd'),
      "Scheme: Dalmia Bharat Refractories Limited's business demerged into Himadri Speciality Chemical Limited; share swap 1 for every 10 shares; approved by the board — the company receives the business");
  });
  test('spurt in volume → the company\'s own words', () => {
    const text = 'With reference to the email from the Exchange regarding significant increase in volume, we wish to state that the Company is not aware of any information or announcement which has not been disclosed to the exchange. The movement is purely market driven.' + PAD;
    const r = readFilingText({ subject: 'Spurt in Volume', text, market: 'IN' });
    assert.equal(r.line, 'Company says: “The Company is not aware of any information or announcement which has not been disclosed to the exchange. The movement is purely market driven.”');
  });
  test('REIT "material issue" with nothing to report → routine', () => {
    const text = 'In terms of Regulation 23(5)(i) of the SEBI (REIT) Regulations, we wish to inform that there is no material issue to be reported for the quarter ended September 30, 2026.' + PAD;
    const r = readFilingText({ subject: 'Reg 23(5)(i): Disclosure of material issue', text, market: 'IN' });
    assert.ok(r.routine);
    assert.equal(r.kind, null);
  });
  test('US 8-K earnings release → results line in $', () => {
    const text = 'Acme Corp reports second quarter fiscal 2026 results. Total revenue was $120.5 million, up 18% year over year. Net income was $14.2 million compared to $9.1 million in the prior-year quarter.';
    const r = readFilingText({ subject: 'Earnings release — 8-K Item 2.02 (EX-99.1)', text: text + ' ' + text.replace(/Acme/g, 'The company'), market: 'US' });
    assert.equal(r.kind, 'Results');
    assert.match(r.line!, /Revenue \$120\.5 million \(up 18%\)/);
    assert.match(r.line!, /PAT \$14\.2 million \(vs \$9\.1 million\)/);
  });
  test('a document with no text is a failed read, with the reason', () => {
    const f = toFilingRead('https://www.bseindia.com/x.pdf', readFilingText({ subject: 'Press Release', text: 'short', market: 'IN' }), null);
    assert.equal(f.status, 'failed');
    assert.match(String(f.reason), /no readable text/);
    assert.equal(f.version, FILING_READ_VERSION);
  });
});

// ── 3. grouping, fallback, routine hiding, importance ────────────────────
describe('grouping and dedupe — one row per company per event', () => {
  test('HSCL: scheme outcome + scheme announcement + demerger filing → one row, 3 filings', () => {
    const r = buildRecentCatalysts([
      filing({ ticker: 'HSCL', date: '2026-09-24', title: 'Outcome of Board Meeting - Scheme of Arrangement' }),
      filing({ ticker: 'HSCL', date: '2026-09-24', title: "Scheme of Arrangement between Dalmia Bharat Refractories Limited ('Demerged Company') and Himadri Speciality Chemical Limited ('Resulting Company')" }),
      filing({ ticker: 'HSCL', date: '2026-09-25', title: 'Demerger of refractory business' }),
    ], TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].type, 'Corporate restructuring');
    assert.equal(r.items[0].filings.length, 3);
    assert.equal(r.items[0].importance, 'Material');
  });
  test('CLEANMAX: appointment + change in management within 2 days → one row', () => {
    const r = buildRecentCatalysts([
      filing({ ticker: 'CLEANMAX', date: '2026-09-22', title: 'Appointment of Chief Executive Officer' }),
      filing({ ticker: 'CLEANMAX', date: '2026-09-23', title: 'Change in Management' }),
    ], TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].filings.length, 2);
    assert.equal(r.items[0].importance, 'Notable');
  });
  test('the same event type 5 days apart stays two rows', () => {
    const r = buildRecentCatalysts([
      filing({ date: '2026-09-20', title: 'Bagging/Receiving of orders/contracts' }),
      filing({ date: '2026-09-25', title: 'Bagging/Receiving of orders/contracts' }),
    ], TODAY);
    assert.equal(r.items.length, 2);
  });
  test('CUPID: two press releases + results outcome, read → one Results row with figures', () => {
    const text = 'The Company reports Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores, up 32% YoY. Net Profit of Rs. 17.9 Crores, higher by 41%.' + PAD;
    const a = filing({ ticker: 'CUPID', date: '2026-09-25', title: 'Press Release' });
    const b = filing({ ticker: 'CUPID', date: '2026-09-25', title: 'Announcement under Regulation 30 (LODR)-Press Release' });
    const c = filing({ ticker: 'CUPID', date: '2026-09-24', title: 'Outcome of Board Meeting - Financial Results' });
    const reads = { [a.url!]: read(a.url!, text, a.title), [b.url!]: read(b.url!, text, b.title) };
    const r = buildRecentCatalysts([a, b, c], TODAY, { reads });
    assert.equal(r.items.length, 1);
    const e = r.items[0];
    assert.equal(e.type, 'Results');
    assert.equal(e.importance, 'Material');
    assert.equal(e.what, 'Q1 FY27: Revenue ₹78.4 Cr (up 32%), PAT ₹17.9 Cr (up 41%)');
    assert.equal(e.filings.length, 3);
  });
});

describe('routine hiding', () => {
  test('ESG, shareholders meeting, CP repayment, newspaper ads are hidden and counted', () => {
    const r = buildRecentCatalysts([
      filing({ ticker: 'A', title: 'Intimation Regarding ESG Rating' }),
      filing({ ticker: 'B', title: 'Shareholders meeting' }),
      filing({ ticker: 'MINDACORP', title: 'Repayment of Commercial Paper' }),
      filing({ ticker: 'D', title: 'Copy of Newspaper Publication' }),
      filing({ ticker: 'E', title: 'Bagging/Receiving of orders/contracts' }),
    ], TODAY);
    assert.equal(r.items.length, 1);
    assert.equal(r.hidden.length, 4);
    assert.ok(r.hidden.every((h) => h.routine && h.routineWhy));
  });
  test('"General Updates" whose document says nothing → routine after the read', () => {
    const f = filing({ ticker: 'X', title: 'General Updates' });
    const text = 'Dear Sir/Madam, We wish to inform that the company has updated its website contact details. Kindly take the same on record.' + PAD;
    const before = buildRecentCatalysts([f], TODAY);
    assert.equal(before.hidden.length, 0);
    assert.equal(before.toRead.length, 1);
    const after = buildRecentCatalysts([f], TODAY, { reads: { [f.url!]: read(f.url!, text, f.title) } });
    assert.equal(after.items.length + after.minor.length, 0);
    assert.equal(after.hidden.length, 1);
    assert.equal(after.toRead.length, 0);
  });
  test('routine subjects are never queued for reading', () => {
    const r = buildRecentCatalysts([filing({ title: 'Closure of Trading Window' }), filing({ title: 'Press Release' })], TODAY);
    assert.deepEqual(r.toRead.map((q) => q.subject), ['Press Release']);
  });
});

describe('document-read fallback', () => {
  test('a document that cannot be opened keeps its subject line and says why', () => {
    const f = filing({ ticker: 'NRBBEARING', title: 'Press Release' });
    const reads = { [f.url!]: toFilingRead(f.url!, null, 'HTTP 403') };
    const r = buildRecentCatalysts([f], TODAY, { reads });
    const e = [...r.items, ...r.minor][0];
    assert.equal(e.what, 'Press Release');
    assert.equal(e.read, 'failed');
    assert.equal(e.readNote, "couldn't open the document (HTTP 403)");
    assert.equal(r.reading.failed, 1);
  });
  test('reads are matched whatever the URL spelling', () => {
    const f = filing({ title: 'Press Release', url: 'https://www.bseindia.com/a/b.pdf' });
    const text = 'The Company reports Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores, up 32% YoY.' + PAD;
    const r = buildRecentCatalysts([f], TODAY, { reads: { 'http://bseindia.com/a/b.pdf?x=1': read('https://www.bseindia.com/a/b.pdf', text, 'Press Release') } });
    assert.equal(r.items[0].type, 'Results');
    assert.equal(normUrl('https://www.bseindia.com/a/b.pdf'), normUrl('http://bseindia.com/a/b.pdf?x=1'));
  });
  test('progress counts: total = read + failed + pending', () => {
    const fs = [filing({ title: 'Press Release' }), filing({ title: 'General Updates' }), filing({ title: 'Updates' })];
    const r = buildRecentCatalysts(fs, TODAY, { reads: { [fs[0].url!]: toFilingRead(fs[0].url!, null, 'timed out') } });
    assert.equal(r.reading.total, 3);
    assert.equal(r.reading.failed, 1);
    assert.equal(r.reading.pending, 2);
    assert.equal(r.toRead.length, 2);
  });
});

describe('importance order', () => {
  test('results with numbers, then orders with value, before a clarification', () => {
    const res = filing({ ticker: 'R', date: '2026-09-20', title: 'Press Release' });
    const text = 'The Company reports Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores, up 32% YoY.' + PAD;
    const r = buildRecentCatalysts([
      filing({ ticker: 'C', date: '2026-09-27', title: 'Spurt in Volume' }),
      filing({ ticker: 'O', date: '2026-09-26', title: 'Bagging/Receiving of orders/contracts' }),
      filing({ ticker: 'K', date: '2026-09-21', title: 'Commissioning of new plant', origin: 'ledger-doc' }),
      res,
    ], TODAY, { reads: { [res.url!]: read(res.url!, text, res.title) } });
    assert.deepEqual(r.items.map((e) => e.ticker), ['R', 'O', 'K']);
    assert.deepEqual(r.items.map((e) => e.importance), ['Material', 'Notable', 'Notable']);
    assert.deepEqual(r.minor.map((e) => e.ticker), ['C']);
  });
  test('importance words', () => {
    assert.equal(importanceOf({ type: 'Order win', figure: '₹450 Cr', line: 'x', read: 'read' }), 'Material');
    assert.equal(importanceOf({ type: 'Order win', figure: null, line: null, read: 'pending' }), 'Notable');
    assert.equal(importanceOf({ type: 'Management change', figure: null, line: null, senior: true, read: 'read' }), 'Notable');
    assert.equal(importanceOf({ type: 'Management change', figure: null, line: null, senior: false, read: 'read' }), 'Minor');
    assert.equal(importanceOf({ type: 'Regulatory / legal action', figure: '₹2.4 Cr', line: 'x', read: 'read', noImpact: true }), 'Minor');
    assert.equal(importanceOf({ type: 'Promoter holding change', figure: null, line: null, read: 'read' }), 'Minor');
    assert.equal(importanceOf({ type: 'Exchange clarification', figure: null, line: 'x', read: 'read' }), 'Minor');
  });
});

// ── 4. thesis mapping ────────────────────────────────────────────────────
describe('thesis mapping — deterministic', () => {
  const A: ThesisCtx = { pattern: 'A', fit: 'exact', assessment: null };
  const B: ThesisCtx = { pattern: 'B', fit: 'exact', assessment: null };
  test('capacity added on an A thesis supports it', () => {
    const t = thesisFor([{ key: 'capacity_addition', dir: 'up' }], A, 'read');
    assert.equal(t.touch, 'supports');
    assert.match(t.why, /capacity added up — A thesis variable/);
  });
  test('an order win on a B thesis supports it', () => {
    assert.equal(thesisFor([{ key: 'order_intake', dir: 'up' }], B, 'read').touch, 'supports');
  });
  test('a margin cut is against', () => {
    assert.equal(thesisFor([{ key: 'margin', dir: 'down' }], A, 'read').touch, 'against');
  });
  test('results figures name the card\'s own direction', () => {
    const ctx: ThesisCtx = { pattern: 'A', assessment: { checked: [{ key: 'revenue_growth', verdict: 'improving' }] } };
    const t = thesisFor([{ key: 'revenue_growth', dir: 'up' }], ctx, 'read');
    assert.equal(t.touch, 'supports');
    assert.match(t.why, /\(card: improving\)/);
  });
  test('no thesis type → says so in words', () => {
    assert.deepEqual(thesisFor([{ key: 'order_intake', dir: 'up' }], { pattern: null }, 'read'), { touch: 'not assessed', why: 'thesis type not set — pick A / B / F / G on the card' });
  });
  test('a variable the thesis does not rest on is neutral, with the reason', () => {
    const t = thesisFor([{ key: 'new_product', dir: 'up' }], B, 'read');
    assert.equal(t.touch, 'neutral');
    assert.match(t.why, /not a variable the B thesis rests on/);
  });
  test('an unread document is "being read", a read one with nothing is neutral', () => {
    assert.equal(thesisFor([], A, 'pending').why, 'document still being read');
    assert.equal(thesisFor([], A, 'read').touch, 'neutral');
  });
  test('end to end: a read capacity filing on an A name reads Supports', () => {
    const f = filing({ ticker: 'AARTIPHARM', title: 'Investor Presentation', ctx: A });
    const text = 'Xanthine derivatives capacity expanded from 5,000 MTPA to 9,600+ MTPA and was successfully commissioned in Q1 FY27.' + PAD;
    const r = buildRecentCatalysts([f], TODAY, { reads: { [f.url!]: read(f.url!, text, f.title) } });
    const e = r.items[0];
    assert.equal(e.what, 'Capacity 5,000 → 9,600+ MTPA (+92%), commissioned');
    assert.equal(e.thesis, 'supports');
    assert.equal(e.importance, 'Material');
  });
});

// ── 5. by calendar day, like Earnings Opportunities (zzz814) ─────────────
describe('window selector', () => {
  test('10d = today and the 9 days before; Today = one day', () => {
    assert.deepEqual(windowRange(TODAY, 10), { from: '2026-09-19', to: TODAY, days: 10 });
    assert.deepEqual(windowRange(TODAY, 1), { from: TODAY, to: TODAY, days: 1 });
    assert.deepEqual(windowRange(TODAY, 3), { from: '2026-09-26', to: TODAY, days: 3 });
    assert.deepEqual(windowRange(TODAY, 5), { from: '2026-09-24', to: TODAY, days: 5 });
  });
  test('stepping back moves the window; it never runs before the 10-day floor or past today', () => {
    assert.deepEqual(windowRange(TODAY, 3, '2026-09-25'), { from: '2026-09-23', to: '2026-09-25', days: 3 });
    assert.deepEqual(windowRange(TODAY, 5, '2026-09-20'), { from: '2026-09-19', to: '2026-09-20', days: 2 });
    assert.deepEqual(windowRange(TODAY, 1, '2026-09-01'), { from: '2026-09-19', to: '2026-09-19', days: 1 });
    assert.deepEqual(windowRange(TODAY, 1, '2026-10-05'), { from: TODAY, to: TODAY, days: 1 });
  });
  test('range boundaries are inclusive; an IST "tomorrow" counts as today only when the window ends today', () => {
    const r = windowRange(TODAY, 3);
    assert.equal(inRange('2026-09-26', r), true);
    assert.equal(inRange('2026-09-25', r), false);
    assert.equal(inRange('2026-09-29', r, TODAY), true);
    assert.equal(inRange('2026-09-26', windowRange(TODAY, 1, '2026-09-25')), false);
  });
});

describe('grouped by calendar day, newest day first', () => {
  const text = 'The Company reports Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores, up 32% YoY.' + PAD;
  const res = filing({ ticker: 'RES', date: '2026-09-22', title: 'Press Release' });
  const raws = [
    filing({ ticker: 'CLAR', date: '2026-09-22', title: 'Spurt in Volume' }),
    filing({ ticker: 'ORD', date: '2026-09-22', title: 'Bagging/Receiving of orders/contracts' }),
    filing({ ticker: 'SCH', date: '2026-09-22', title: 'Scheme of Arrangement - demerger' }),
    res,
    filing({ ticker: 'ESG', date: '2026-09-22', title: 'Intimation Regarding ESG Rating' }),
    filing({ ticker: 'NEW', date: '2026-09-27', title: 'Bagging/Receiving of orders/contracts' }),
    filing({ ticker: 'OLD', date: '2026-09-19', title: 'Acquisition of a subsidiary' }),
  ];
  const r = buildRecentCatalysts(raws, TODAY, { reads: { [res.url!]: read(res.url!, text, res.title) } });
  const days = groupByDay(r, windowRange(TODAY, 10), TODAY);
  test('one group per day, newest first, with a plain header', () => {
    assert.deepEqual(days.map((d) => d.date), ['2026-09-27', '2026-09-22', '2026-09-19']);
    assert.equal(dayLabel('2026-09-22'), 'Tue 22 Sep');
    assert.equal(days[1].header, 'Tue 22 Sep · 4 events (2 Material)');
  });
  test('inside a day: Material with a figure first, then Material, then Notable; minor and routine apart', () => {
    assert.deepEqual(days[1].items.map((e) => e.ticker), ['RES', 'SCH', 'ORD']);
    assert.deepEqual(days[1].minor.map((e) => e.ticker), ['CLAR']);
    assert.deepEqual(days[1].hidden.map((e) => e.ticker), ['ESG']);
  });
  test('compareWithinDay: importance, then a stated figure, then weight', () => {
    const e = (o: Partial<RecentEvent>) => ({ ticker: 'T', importance: 'Notable', figure: null, thesis: 'neutral', type: 'Other filing', ...o }) as RecentEvent;
    const list = [e({ ticker: 'N' }), e({ ticker: 'MO', importance: 'Material', type: 'Acquisition' }), e({ ticker: 'MF', importance: 'Material', type: 'Order win', figure: '₹450 Cr' }), e({ ticker: 'MR', importance: 'Material', type: 'Results' })];
    assert.deepEqual([...list].sort(compareWithinDay).map((x) => x.ticker), ['MF', 'MR', 'MO', 'N']);
  });
  test('a shorter window keeps only its days; the label count matches', () => {
    const w3 = windowRange(TODAY, 3);
    assert.deepEqual(groupByDay(r, w3, TODAY).map((d) => d.date), ['2026-09-27']);
    assert.equal(countInRange(r.items, w3, TODAY), 1);
    assert.equal(countInRange(r.items, windowRange(TODAY, 10), TODAY), r.items.length);
  });
  test('top of the window: up to 5 Material, newest first', () => {
    const top = topOfWindow(r.items, windowRange(TODAY, 10), 5, TODAY);
    assert.deepEqual(top.map((e) => e.ticker), ['RES', 'SCH', 'OLD']);
    assert.ok(top.every((e) => e.importance === 'Material'));
    assert.deepEqual(topOfWindow(r.items, windowRange(TODAY, 10), 2, TODAY).map((e) => e.ticker), ['RES', 'SCH']);
    assert.deepEqual(topOfWindow(r.items, windowRange(TODAY, 3), 5, TODAY), []);
    assert.match(rowAnchor(top[0]), /^nc-[A-Za-z0-9-]+$/);
  });
});
