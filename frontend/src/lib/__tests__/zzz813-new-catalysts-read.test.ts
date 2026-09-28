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
    // zzz824: the owner counts the company secretary as senior management (Notable + needs attention)
    assert.equal(subjectClass('Appointment of Company Secretary').senior, true);
    assert.equal(subjectClass('Appointment of Independent Director').senior, false);
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
    // unread, no swap ratio or figure yet → Notable at most (zzz815)
    assert.equal(r.items[0].importance, 'Notable');
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
    assert.match(t.why, /capacity added up — an A-type thesis variable/);
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
    assert.equal(t.why, 'No effect on your B (demand explosion) thesis');
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
    assert.equal(days[1].header, 'Tue 22 Sep · 4 events (1 Material)');
  });
  test('inside a day: Material with a figure first, then Notable by event weight; minor and routine apart', () => {
    assert.deepEqual(days[1].items.map((e) => e.ticker), ['RES', 'ORD', 'SCH']);
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
    assert.deepEqual(top.map((e) => e.ticker), ['RES']);
    assert.ok(top.every((e) => e.importance === 'Material'));
    assert.deepEqual(topOfWindow(r.items, windowRange(TODAY, 10), 0, TODAY), []);
    assert.deepEqual(topOfWindow(r.items, windowRange(TODAY, 3), 5, TODAY), []);
    assert.match(rowAnchor(top[0]), /^nc-[A-Za-z0-9-]+$/);
  });
});

// ── 6. live rows the owner flagged (zzz815) — the exact strings the page showed ──
import { stripLetterhead, lineQuality, cleanClip } from '../catalyst/recent-events';
import { divestmentLine, acquisitionLine, fundLine, approvalLine, repairName } from '../catalyst/filing-read';

describe('live rows — cleaned', () => {
  const DECK = 'Largest manufacturer of Xanthine Derivatives in India International, 60% Domestic, 40% GEOGRAPHICAL SALES (Q1-FY27) 15,021 17,714 17,976 5,346 19% 20% 24% 25% FY24FY25FY26Q1-FY26 STANDALONE REVENUE (INR Mn) & EBITDA MARGINS (%) Aarti Pharmalabs Limited Investor Presentation';
  test('1 AARTIPHARM: a deck dump never shows; only the extracted fact', () => {
    assert.equal(lineQuality(DECK).ok, false);
    const text = `${DECK}. Xanthine derivatives capacity expanded from 5,000 MTPA to 9,600+ MTPA and was successfully commissioned in Q1 FY27.${PAD}`;
    const r = readFilingText({ subject: 'Investor Presentation', text, market: 'IN' });
    assert.equal(r.line, 'Capacity 5,000 → 9,600+ MTPA (+92%), commissioned');
    assert.equal(lineQuality('Capacity added: 5000MTPA → 9,600+MTPA (+92%)').ok, true);
  });

  const JUNK = 'Merger / amalgamation: If yes, whether the same is done at arm s length No No No g) Whether the sale, lease or disposal of the undertaking is outside Not Applicable Not Applicable Not';
  test('2 CLEANMAX: disclosure-table junk is rejected; the filled fields are read', () => {
    assert.equal(lineQuality(JUNK).ok, false);
    const table = 'Disclosure under Regulation 30 - sale or disposal of unit. a) Name of the undertaking: Solar Asset Division b) Amount and percentage of the turnover or revenue or income and net worth contributed by such unit: Not Applicable c) Date on which the agreement for sale has been entered into: September 24, 2026 d) Expected date of completion of sale: Not Applicable e) Consideration received from such sale/disposal: Rs. 45 Crores f) Brief details of buyers and whether any of the buyers belong to the promoter group: Not Applicable g) Whether the sale, lease or disposal of the undertaking is outside Scheme of Arrangement: Not Applicable. ' + JUNK + PAD;
    assert.equal(divestmentLine(table), 'Divestment: Solar Asset Division for Rs. 45 Crores; agreement dated September 24, 2026');
    const r = readFilingText({ subject: 'Sale or disposal', text: table, market: 'IN' });
    assert.equal(r.line, 'Divestment: Solar Asset Division for Rs. 45 Crores; agreement dated September 24, 2026');
    const empty = 'Sale or disposal of unit. a) Name of the undertaking: Not Applicable b) Consideration received from such sale/disposal: Not Applicable c) Brief details of buyers: Not Applicable.' + PAD;
    assert.equal(divestmentLine(empty), "Divestment — details in the filing's disclosure table");
  });
  test('2 CLEANMAX: a scheme says what it is when the filing states it', () => {
    const text = 'The Board of Directors at its meeting held today considered and approved the Scheme of Amalgamation of Clean Max Enviro Energy Solutions Private Limited with Clean Max Energy Limited and their respective shareholders under Sections 230 to 232 of the Companies Act, 2013.' + PAD;
    const r = readFilingText({ subject: 'Scheme of Arrangement', text, market: 'IN' });
    assert.equal(r.line, 'Scheme of amalgamation: Clean Max Enviro Energy Solutions Private Limited with Clean Max Energy Limited; approved by the board');
  });

  test('3 HSCL: OCR-broken names repaired from the row\'s company and clean text; capacity never claimed', () => {
    assert.equal(lineQuality("Dalmia Bharat Re fractories Limited's business demerged into Bimad1 i Speciality Chemical Ltd").ok, false);
    const text = 'The Board approved the Scheme of Arrangement between Dalmia Bharat Re fractories Limited ("Demerged Company") and Bimad1 i Speciality Chemical Ltd ("Resulting Company"). The refractory business has a capacity addition of 50,000 TPA planned. As consideration, 1 (One) fully paid-up equity share of the Resulting Company shall be issued for every 10 (Ten) fully paid-up equity shares held in the Demerged Company.' + PAD;
    const r = readFilingText({ subject: 'Scheme of Arrangement', text, market: 'IN', company: 'Himadri Speciality Chemical Ltd' });
    assert.equal(r.line, "Scheme: Dalmia Bharat Refractories Limited's business demerged into Himadri Speciality Chemical Ltd; share swap 1 for every 10 shares; approved by the board — the company receives the business");
    assert.deepEqual(r.touches, []);
    assert.equal(repairName('Bimad1 i Speciality Chemical Ltd', 'nothing clean here', null), null);
    const A: ThesisCtx = { pattern: 'A', fit: 'exact', assessment: null };
    const f = filing({ ticker: 'HSCL', title: 'Scheme of Arrangement', ctx: A });
    const e = buildRecentCatalysts([f], TODAY, { reads: { [f.url!]: toFilingRead(f.url!, r, null) } }).items[0];
    assert.equal(e.thesis, 'neutral');
    assert.equal(e.thesisWhy, 'No effect on your A (operating inflection) thesis');
    assert.equal(e.importance, 'Material');
  });

  test('4 CUPID: acquisition names the shares and the consideration; no invented "0% stake"', () => {
    const text = 'We wish to inform that the Company has acquired 24,00,000 equity shares of face value of Re. 1/- each of Cupid Trades and Finance Limited for a total consideration of Rs. 12.5 Crores.' + PAD;
    const line = acquisitionLine(text);
    assert.equal(line, 'Acquisition: 24,00,000 equity shares of Cupid Trades and Finance Limited for Rs. 12.5 Crores');
    assert.doesNotMatch(String(line), /0% stake|Re,/);
    assert.equal(acquisitionLine('The Company has acquired 51% stake of the paid-up share capital in a subsidiary for Rs. 3 Crores.'), 'Acquisition: for Rs. 3 Crores (51% stake)');
  });
  test('4 CUPID: an approval that says nothing is Minor with "see filing"; a specific one says what', () => {
    const vague = 'Intimation regarding licence / approval. The Company has received the approval.' + PAD;
    assert.equal(approvalLine(vague), null);
    const f = filing({ ticker: 'CUPID', title: 'Licence / approval', ctx: { pattern: 'B', assessment: null } });
    const r = buildRecentCatalysts([f], TODAY, { reads: { [f.url!]: read(f.url!, vague, f.title) } });
    const e = [...r.items, ...r.minor][0];
    assert.equal(e.what, 'Regulatory approval — see filing');
    assert.equal(e.importance, 'Minor');
    assert.notEqual(e.thesis, 'supports');
    assert.equal(approvalLine('The Company has received approval from the Drug Controller General of India (DCGI) for manufacture of female condoms at its Nashik plant.'),
      'Approval from the Drug Controller General of India (DCGI) for manufacture of female condoms at its Nashik plant');
  });

  test('5 AARTIPHARM: a site qualification on a results filing is not "Results"', () => {
    const f = filing({ ticker: 'AARTIPHARM', title: 'Financial Results', kind: 'results' });
    const ev = filing({ ticker: 'AARTIPHARM', url: f.url, title: 'Financial Results', origin: 'ledger-event', variable: 'qualification', direction: 'up', text: 'qualification: Atali site audited/approved by innovators' });
    const e = [...buildRecentCatalysts([f, ev], TODAY).items][0];
    assert.equal(e.type, 'Regulatory approval');
    assert.equal(e.what, 'qualification: Atali site audited/approved by innovators');
  });

  test('6 letterhead is stripped before any sentence is chosen', () => {
    const mind = 'The Listing Department BSE Limited Phiroze Jeejeebhoy Towers, Dalal Street, Mumbai - 400 001 The Listing Department National Stock Exchange of India Limited Exchange Plaza, G Block, Bandra Kurla Complex, Bandra (E), Mumbai - 400051 Scrip Symbol: MINDSPACE (Units) Dear Sir/Madam, Sub: Intimation of issuance of non-convertible debentures. We wish to inform you that the Mindspace REIT has allotted 50,000 listed, rated, secured non-convertible debentures of face value Rs. 1,00,000 each aggregating to Rs. 500 crores on a private placement basis. Kindly take the same on record.';
    const stripped = stripLetterhead(mind);
    assert.doesNotMatch(stripped, /Listing Department|Scrip|400\s?0\d\d|Bandra|Dear Sir/);
    const r = readFilingText({ subject: 'Fund raising', text: mind + PAD, market: 'IN' });
    assert.equal(r.line, 'Non-convertible debentures: 50,000 NCDs, total ₹500 crores');
    const spec = 'NSE Symbol: SPECTRUM Script Code: 544386 ISIN: INE0QFO01010 Subject: Disclosure , We wish to inform you that the Company has entered into a Memorandum of Understanding (MoU) with Tata Electronics Private Limited for supply of electronic assemblies.' + PAD;
    const s2 = readFilingText({ subject: 'Disclosure under Regulation 30', text: spec, market: 'IN' });
    assert.match(String(s2.line), /Memorandum of Understanding \(MoU\) with Tata Electronics Private Limited for supply of electronic assemblies/);
    assert.doesNotMatch(String(s2.line), /Symbol|Script|ISIN/);
    const gold = 'Scrip Code: GOLDIAM EQ Respected Sir/Madam, Sub: Intimation Receipt of Property Tax Notice from BMC. Pursuant to Regulation 30 of the SEBI (LODR) Regulations, 2015, we wish to inform that the Company has received a communication from the Brihanmumbai Municipal Corporation (BMC) regarding revision of property tax for its premises at Andheri. The Company is assessing the same.' + PAD;
    const g = readFilingText({ subject: 'Action(s) initiated or orders passed', text: gold, market: 'IN' });
    assert.match(String(g.line), /^The Company has received a communication from the Brihanmumbai Municipal Corporation \(BMC\) regarding revision of property tax/);
    assert.doesNotMatch(String(g.line), /Scrip|Sir\/Madam|Sub:/);
  });

  test('7 SPECTRUM: an equity raise states instrument, count, price, size and allottees — or says the size is not stated', () => {
    assert.equal(fundLine('The Board approved issue of up to 12,00,000 convertible warrants at a price of Rs. 145 per warrant to promoter group and non-promoter persons on a preferential basis aggregating up to Rs. 17.40 crores.'),
      'Convertible warrants: 12,00,000 warrants, at ₹145 each, total ₹17.40 crores; to promoter and non-promoter allottees');
    assert.equal(fundLine('The Board approved a preferential issue of equity shares.'), 'Preferential issue — size not stated in the filing');
    assert.equal(importanceOf({ type: 'Fund raise', figure: null, line: 'Preferential issue — size not stated in the filing', read: 'read' }), 'Notable');
  });

  test('8 thesis wording: article, type name, provisional in plain words', () => {
    assert.equal(thesisFor([], { pattern: 'F', assessment: null }, 'read').why, 'No effect on your F (profit jump · forensics) thesis');
    assert.match(thesisFor([{ key: 'earnings_growth', dir: 'up' }], { pattern: 'F', fit: 'provisional', assessment: null }, 'read').why, /— an F-type thesis variable \(type is provisional\)$/);
    assert.match(thesisFor([{ key: 'order_book', dir: 'up' }], { pattern: 'B', assessment: null }, 'read').why, /— a B-type thesis variable$/);
  });

  test('9 quality gate and clipping', () => {
    for (const bad of [DECK, JUNK, 'Debt raise / borrowing: Block, Bandra Kurla Complex, Bandra (E), Mumbai - 400051 Scrip Symbol: MINDSPACE (Units) The Listing Department BSE Limited', 'Scrip Code: GOLDIAM EQ Respected Sir/Madam, Sub: Intimation Receipt of Property Tax Notice from BMC']) {
      assert.equal(lineQuality(bad).ok, false, bad.slice(0, 40));
    }
    assert.equal(lineQuality('Q1 FY27: Revenue ₹78.4 Cr (up 32%), EBITDA ₹21.2 Cr (vs ₹14.1 Cr), PAT ₹17.9 Cr (up 41%)').ok, true);
    assert.equal(cleanClip('The first sentence is here. The second one runs on and on past the limit', 40), 'The first sentence is here.');
    assert.equal(cleanClip('alpha beta gamma delta epsilon', 18), 'alpha beta gamma…');
  });

  test('10 materiality: unspecified approval / raise / scheme are not Material', () => {
    assert.equal(importanceOf({ type: 'Regulatory approval', figure: null, line: null, read: 'read' }), 'Minor');
    assert.equal(importanceOf({ type: 'Corporate restructuring', figure: null, line: 'Scheme of arrangement / amalgamation — terms not stated in this filing', read: 'read' }), 'Notable');
    assert.equal(importanceOf({ type: 'Acquisition', figure: 'Rs. 12.5 Crores', line: 'x', read: 'read' }), 'Material');
    assert.equal(importanceOf({ type: 'Acquisition', figure: null, line: 'Acquisition: X Limited', read: 'read' }), 'Notable');
    assert.equal(importanceOf({ type: 'Capex / capacity', figure: null, line: 'Commissioned new line', read: 'read' }), 'Notable');
  });
});
