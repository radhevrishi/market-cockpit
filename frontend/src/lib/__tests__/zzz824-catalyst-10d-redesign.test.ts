// zzz824 — "New · last 10 days" redesign: EVENT → EVIDENCE → THESIS → MATERIALITY → ACTION.
//
// Every card field is computed on its own by a fixed rule. The live rows the owner flagged appear below
// ONLY as fixture strings of filing text; tickers in code are synthetic (ALPHA, BETA …) — the logic is generic.
// Run: npx tsx --test src/lib/__tests__/zzz824-catalyst-10d-redesign.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { subjectClass, buildRecentCatalysts, lineQuality, exchangeOf, type RawEvent, type FilingRead, type ThesisCtx, type RecentEvent } from '../catalyst/recent-events';
import {
  readFilingText, toFilingRead, periodOf, plausiblePeriod, resultsLine, ratingLine, isRatingDoc, bonusLine, orderBookChange,
  divestmentLine, legalLine, saneDurations, fmtMoney, docTypeOf, FILING_READ_VERSION,
} from '../catalyst/filing-read';
import { buildCard, keyNumberOf, pairVerified, tidyFigure, indianGroup, ledgerView } from '../catalyst/event-card';
import { seniorChange } from '../catalyst/filing-read';

const TODAY = '2026-09-28';
const PAD = ' This is for your information and records. The same shall also be available on the website of the Company for the information of shareholders and investors at large.';
let n = 0;
const filing = (o: Partial<RawEvent>): RawEvent => ({ ticker: 'ALPHA', date: '2026-09-26', title: 'x', origin: 'ledger-doc', source: 'BSE corporate announcements', url: `https://www.bseindia.com/xml-data/corpfiling/AttachLive/z${++n}.pdf`, ...o });
const A: ThesisCtx = { pattern: 'A', fit: 'exact', assessment: null };
const B: ThesisCtx = { pattern: 'B', fit: 'exact', assessment: null };
const one = (raws: RawEvent[], reads: Record<string, FilingRead> = {}): RecentEvent => {
  const r = buildRecentCatalysts(raws, TODAY, { reads });
  return [...r.items, ...r.minor, ...r.hidden][0];
};
const readOf = (f: RawEvent, text: string, company?: string) => ({ [f.url!]: toFilingRead(f.url!, readFilingText({ subject: f.title, text, market: 'IN', company, date: f.date }), null) });

describe('source document decides the type (§29)', () => {
  test('subjects: credit rating, allotment, bonus', () => {
    assert.equal(subjectClass('Credit Rating').type, 'Credit rating');
    assert.equal(subjectClass('Intimation of Credit Rating by CRISIL').type, 'Credit rating');
    assert.equal(subjectClass('Announcement under Regulation 30 (LODR)-Allotment').type, 'Fund raise');
    assert.equal(subjectClass('Allotment of Bonus Shares').type, 'Corporate action');
    assert.equal(subjectClass('Bonus issue').type, 'Corporate action');
    assert.equal(subjectClass('Intimation Regarding ESG Rating').routine, 'ESG rating');
  });

  const RATING = 'Rating Rationale. CRISIL Ratings has reaffirmed its CRISIL AA/Stable rating on the long-term bank facilities of the company. Key financial indicators: First quarter 2028: Revenue ₹9,837 Cr (vs ₹7,551 Cr), EBITDA margin 27.7%. The company is also evaluating the acquisition of a defence electronics business.' + PAD;
  test('a rating letter with results-like figures is a Credit rating, never Results or Acquisition', () => {
    const r = readFilingText({ subject: 'Credit Rating', text: RATING, market: 'IN', date: '2026-09-24' });
    assert.equal(r.kind, 'Credit rating');
    assert.equal(r.docType, 'Credit rating letter');
    assert.equal(r.ratingAction, 'reaffirm');
    assert.match(String(r.line), /^Credit rating: CRISIL AA\/Stable reaffirmed — long-term bank facilities$/);
    assert.doesNotMatch(String(r.line), /Revenue|2028/);
    // a generic subject with a rating body is still a rating
    const g = readFilingText({ subject: 'Updates', text: RATING, market: 'IN', date: '2026-09-24' });
    assert.equal(g.kind, 'Credit rating');
    assert.equal(isRatingDoc(RATING), true);
    const f = filing({ ticker: 'BETA', title: 'Credit Rating', ctx: A });
    const e = one([f], readOf(f, RATING));
    assert.equal(e.type, 'Credit rating');
    assert.equal(e.importance, 'Minor');
    assert.equal(e.card!.impact, 'Neutral');
    assert.equal(e.card!.keyNumber, null);
  });
  test('ratingLine: upgrade and downgrade are named; a downgrade needs attention', () => {
    const d = ratingLine('ICRA has downgraded the long-term rating to [ICRA]A- (Negative) from [ICRA]A.');
    assert.equal(d.action, 'downgrade');
    assert.match(String(d.line), /\[ICRA\]\s?A-\/Negative downgraded/);
    const card = buildCard({ type: 'Credit rating', importance: 'Notable', read: 'read', badge: 'filed', title: 'Credit Rating', what: String(d.line), line: d.line, figure: null, claims: [], ctx: A, sourceDoc: 'Credit rating letter', exchange: 'BSE', date: TODAY, ratingAction: d.action });
    assert.equal(card.attention, 'credit rating downgraded');
  });

  test('quarter labels are checked against the filing date (Indian FY Apr–Mar)', () => {
    assert.equal(periodOf('Results for the first quarter 2028', '2026-09-20'), null);
    assert.equal(periodOf('Q1 FY27 results', '2026-08-10'), 'Q1 FY27');
    assert.equal(periodOf('Q1 FY28 results', '2026-08-10'), null);
    assert.equal(periodOf('Q4 FY26 results', '2026-05-20'), 'Q4 FY26');
    assert.equal(plausiblePeriod('Q2 FY27', '2026-11-05'), true);
    assert.equal(plausiblePeriod('Q2 FY27', '2026-09-01'), false);
    assert.equal(plausiblePeriod('Q1 FY27'), true, 'no date → as written');
    assert.equal(resultsLine('Q1 FY28: Revenue from Operations at Rs. 78.4 Crores, up 32% YoY.', 'IN', '2026-08-10'), 'Revenue ₹78.4 Cr (up 32%)');
  });

  test('an allotment of NCDs is a fund raise — never regulatory / legal action', () => {
    const text = 'We wish to inform that the Company has allotted 35,000 secured, rated, listed, redeemable non-convertible debentures of face value Rs. 1,00,000 each aggregating to Rs. 350 crore on a private placement basis. In case of default in payment of interest, the Company shall pay additional interest.' + PAD;
    const f = filing({ ticker: 'GAMMA', title: 'Announcement under Regulation 30 (LODR)-Allotment', ctx: A });
    const r = readFilingText({ subject: f.title, text, market: 'IN' });
    assert.equal(r.kind, 'Fund raise');
    assert.equal(r.line, 'Non-convertible debentures: 35,000 NCDs, total ₹350 crore');
    const e = one([f], readOf(f, text));
    assert.equal(e.type, 'Fund raise');
    const c = e.card!;
    assert.equal(c.sourceDocument, 'Allotment intimation');
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.why, 'financial contribution not yet evidenced');
    assert.equal(c.next, 'capital deployment → earnings/return impact');
    assert.equal(c.keyNumber, '₹350 Cr');
    assert.equal(c.evidence, 'allotment disclosed');
  });

  test('a bonus issue is a corporate action, never a rights fund raise', () => {
    const text = 'The Board has approved the issue of bonus equity shares in the ratio of 1:1. Accordingly, 10,46,16,204 fully paid-up bonus equity shares shall be allotted. The bonus issue is not a rights issue.' + PAD;
    const r = readFilingText({ subject: 'Bonus issue', text, market: 'IN' });
    assert.equal(r.kind, 'Corporate action');
    assert.equal(r.line, 'Bonus issue: 1 bonus share for every 1 held; 10,46,16,204 shares');
    assert.doesNotMatch(String(r.line), /Rights/i);
    const gen = readFilingText({ subject: 'General Updates', text, market: 'IN' });
    assert.equal(gen.kind, 'Corporate action');
    assert.equal(bonusLine('Bonus shares in the ratio of 2:1 record date 12 October 2026 bonus'), 'Bonus issue: 2 bonus shares for every 1 held; record date 12 October 2026');
  });
});

describe('orders, order book, capacity — change vs level (§30)', () => {
  const ORDER = 'We wish to inform that the Company has received an order worth Rs. 2,073 crore from a public sector shipyard for supply of marine propulsion systems. The Company has over 38 years of experience in marine engineering.' + PAD;
  test('an order by itself is Neutral: order disclosed, next execution → revenue → margin', () => {
    const f = filing({ ticker: 'DELTA', title: 'Bagging/Receiving of orders/contracts', ctx: B });
    const e = one([f], readOf(f, ORDER));
    const c = e.card!;
    assert.equal(e.type, 'Order win');
    assert.equal(e.importance, 'Material');
    assert.doesNotMatch(e.what, /38 years/);
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.why, 'financial contribution not yet evidenced');
    assert.equal(c.evidence, 'order disclosed');
    assert.equal(c.next, 'execution → revenue → margin');
    assert.equal(c.gap, 'Order → execution');
    assert.equal(c.quality, 'Static');
    assert.equal(c.delta.text, 'LEVEL ONLY — change not established');
    assert.deepEqual(c.chain!.map((x) => `${x.label}${x.ok ? '✓' : '?'}`), ['ORDER✓', 'EXECUTION?', 'REVENUE?', 'MARGIN?', 'CASH?']);
    assert.equal(c.thesisType, 'B');
    assert.equal(c.thesisVariable, 'order_intake');
    assert.match(String(c.keyNumber), /^₹2,?073 (?:Cr|crore)$/);
  });
  test('implausible execution periods are dropped, plausible ones kept', () => {
    assert.equal(saneDurations('Order worth ₹2,073 Cr, to be executed in 38 years'), 'Order worth ₹2,073 Cr');
    assert.equal(saneDurations('Order worth ₹2,073 Cr, to be executed in 38 months'), 'Order worth ₹2,073 Cr, to be executed in 38 months');
  });

  test('order book with a stated prior → Direct change; B thesis → Supports; units consistent', () => {
    const text = 'Order book stood at 184 billion as against 150 billion a year ago, driven by transmission orders.' + PAD;
    const ob = orderBookChange(text, 'IN');
    assert.ok(ob);
    assert.equal(ob!.text, 'Order book ₹150 bn → ₹184 bn (+22.7%)');
    const f = filing({ ticker: 'EPSI', title: 'Investor Presentation', ctx: B });
    const e = one([f], readOf(f, text));
    assert.equal(e.card!.quality, 'Direct');
    assert.equal(e.card!.impact, 'Supports');
    assert.equal(e.card!.delta.text, 'CHANGE: Order book ₹150 bn → ₹184 bn (+22.7%)');
    assert.equal(fmtMoney('184 billion'), '₹184 bn');
  });
  test('a ledger before → after whose quote lacks the prior is a level only — never Supports', () => {
    const doc = filing({ ticker: 'EPSI', title: 'Investor Presentation', ctx: B });
    const ev = filing({ ...doc, origin: 'ledger-event', variable: 'order_book', direction: 'up', before: '150 billion', after: '184 billion', figure: '150 billion → 184 billion', quote: 'Order book at 184 billion', text: 'Order book: 150 billion → 184 billion' });
    const e = one([doc, ev]);
    assert.notEqual(e.card!.impact, 'Supports');
    assert.notEqual(e.card!.quality, 'Direct');
    const ok = filing({ ...ev, quote: 'Order book grew to 184 billion from 150 billion' });
    const e2 = one([doc, ok]);
    assert.equal(e2.card!.impact, 'Supports');
    assert.equal(e2.card!.delta.text, 'CHANGE: Order book ₹150 bn → ₹184 bn (+22.7%)');
    assert.equal(pairVerified('150 billion', '184 billion', 'at 184 billion'), false);
  });
  test('"capacity added: more than 30 GW" from a deck is a LEVEL (Static), not Supports', () => {
    const doc = filing({ ticker: 'EPSI', title: 'Investor Presentation', ctx: A });
    const ev = filing({ ...doc, origin: 'ledger-event', variable: 'capacity_addition', direction: 'up', after: 'more than 30 GW', figure: 'more than 30 GW', quote: 'Capacity added: more than 30 GW across the globe', text: 'Capacity added: more than 30 GW' });
    const c = one([doc, ev]).card!;
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.quality, 'Static');
    assert.equal(c.why, 'LEVEL ONLY — change not established');
  });
  test('capacity from → to stated in the filing is Direct and Supports an A thesis', () => {
    const f = filing({ ticker: 'KAPPA', title: 'Commissioning of new plant', ctx: A });
    const e = one([f], readOf(f, 'Capacity expanded from 5,000 MTPA to 9,600 MTPA and was successfully commissioned.' + PAD));
    assert.equal(e.card!.quality, 'Direct');
    assert.equal(e.card!.impact, 'Supports');
    assert.deepEqual(e.card!.chain!.slice(0, 2).map((x) => x.ok), [true, true]);
    assert.equal(e.card!.next, 'utilisation → revenue → ROCE');
  });
});

describe('acquisition and results (§36)', () => {
  test('a 51% acquisition is Neutral; next integration → revenue → margin → EPS/FCF', () => {
    const text = 'The Company has acquired 51% stake of the paid-up share capital of a beauty brand company for Rs. 120 Crores.' + PAD;
    const f = filing({ ticker: 'LAMBDA', title: 'Acquisition', ctx: A });
    const c = one([f], readOf(f, text)).card!;
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.why, 'financial contribution not yet evidenced');
    assert.equal(c.next, 'integration → revenue → margin → EPS/FCF');
    assert.equal(c.keyNumber, '51% stake · ₹120 Cr');
  });
  test('results with stated YoY growth → Direct, Supports on A; chain SALES ✓ PROFIT ✓', () => {
    const text = 'Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores, up 32% YoY. Net profit at Rs. 17.9 Crores, up 41% YoY.' + PAD;
    const f = filing({ ticker: 'MU', title: 'Press Release', ctx: A, date: '2026-08-12' });
    const e = buildRecentCatalysts([f], '2026-08-14', { reads: readOf(f, text) }).items[0];
    const c = e.card!;
    assert.equal(e.type, 'Results');
    assert.equal(c.quality, 'Direct');
    assert.equal(c.impact, 'Supports');
    assert.match(c.delta.text, /^CHANGE: Revenue ₹78\.4 Cr \(up 32%\)$/);
    assert.deepEqual(c.chain!.map((x) => x.ok), [true, true, false, false, false]);
    assert.equal(c.next, 'margin → cash');
  });
  test('results figures with no prior are a level — Neutral, never Supports / improving', () => {
    const text = 'Q1 FY27 results. Revenue from Operations at Rs. 78.4 Crores. Net profit at Rs. 17.9 Crores.' + PAD;
    const f = filing({ ticker: 'NU', title: 'Press Release', ctx: A, date: '2026-08-12' });
    const c = buildRecentCatalysts([f], '2026-08-14', { reads: readOf(f, text) }).items[0].card!;
    assert.equal(c.quality, 'Static');
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.delta.text, 'LEVEL ONLY — change not established');
  });
  test('stated decline on a thesis variable → Weakens and needs attention', () => {
    const text = 'Q1 FY27 results. Revenue from Operations at Rs. 60.1 Crores, down 12% YoY.' + PAD;
    const f = filing({ ticker: 'XI', title: 'Press Release', ctx: A, date: '2026-08-12' });
    const c = buildRecentCatalysts([f], '2026-08-14', { reads: readOf(f, text) }).items[0].card!;
    assert.equal(c.impact, 'Weakens');
    assert.equal(c.attention, 'revenue growth fell');
  });
});

describe('garbled extraction and raw tables (§30)', () => {
  test('divestment table garble → no line; the card shows the subject + details in filing', () => {
    const t = 'Sale or disposal of unit. Brief details of buyers and whether any of the buyers belong to the promoter group for INR 26,000 Date on which the agreement for sale has been entered into The Company will update the exchange.' + PAD;
    const line = divestmentLine(t);
    assert.doesNotMatch(String(line), /whether|belong to the promoter|26,000|dated The/);
    const f = filing({ ticker: 'OMI', title: 'Sale or disposal', ctx: A });
    const e = one([f], readOf(f, t));
    assert.equal(e.card!.event, 'Sale or disposal — details in filing');
    assert.equal(e.card!.quality, 'Unproven');
    assert.equal(e.card!.impact, 'Evidence incomplete');
  });
  test('an authority-action annexure is parsed; the raw table header never shows', () => {
    assert.equal(lineQuality('No. Particulars Details 1 Name of the listed Company Gold Jewels Limited 2 Name of the authority').ok, false);
    const t = 'No. Particulars Details 1 Name of the listed Company: Gold Jewels Limited 2 Name of the authority: Brihanmumbai Municipal Corporation 3 Nature and details of the action(s) taken, or order(s) passed: Revision of property tax for premises at Andheri 4 Date of receipt of direction or order: September 22, 2026 5 Impact on financial, operation or other activities of the listed entity: Rs. 2.4 crore.' + PAD;
    assert.equal(legalLine(t), 'Brihanmumbai Municipal Corporation: Revision of property tax for premises at Andheri; Rs. 2.4 crore');
    const r = readFilingText({ subject: 'Action(s) initiated or orders passed', text: t, market: 'IN' });
    assert.match(String(r.line), /^Brihanmumbai Municipal Corporation: Revision of property tax/);
    const f = filing({ ticker: 'PI', title: 'Action(s) initiated or orders passed', ctx: A });
    const c = one([f], readOf(f, t)).card!;
    assert.equal(c.impact, 'Neutral');
    assert.equal(c.attention, 'authority action — impact not quantified');
  });
  test('deck marketing text is never a regulatory approval', () => {
    const deck = 'Investor Presentation. Demerger: Largest manufacturer of Xanthine derivatives in India with approvals from global regulators; 12 USFDA approved products and 4 plants.' + PAD;
    const r = readFilingText({ subject: 'Investor Presentation', text: deck, market: 'IN' });
    assert.notEqual(r.kind, 'Regulatory approval');
    assert.doesNotMatch(String(r.line), /Largest/);
  });
});

describe('card rules — unknown is never negative', () => {
  test('an unread filing is Evidence incomplete and Unproven', () => {
    const f = filing({ ticker: 'RHO', title: 'Bagging/Receiving of orders/contracts', ctx: B });
    const c = one([f]).card!;
    assert.equal(c.quality, 'Unproven');
    assert.equal(c.impact, 'Evidence incomplete');
    assert.match(c.evidence, /filing subject only/);
  });
  test('no thesis type → Evidence incomplete with the reason', () => {
    const f = filing({ ticker: 'SIGMA', title: 'Bagging/Receiving of orders/contracts', ctx: { pattern: null } });
    const c = one([f], readOf(f, 'The Company has received an order worth Rs. 45 crore from a state utility.' + PAD)).card!;
    assert.equal(c.impact, 'Evidence incomplete');
    assert.match(c.why, /thesis type not set/);
  });
  test('press only is Unproven', () => {
    const c = one([filing({ ticker: 'TAU', title: 'Company wins order', source: 'Economic Times', url: 'https://example.com/n', origin: 'persistent', badge: 'press', ctx: B })]).card!;
    assert.equal(c.quality, 'Unproven');
  });
  test('a company name blank on one row is filled from the same ticker', () => {
    const r = buildRecentCatalysts([
      filing({ ticker: 'UPS', title: 'Bagging/Receiving of orders/contracts', company: null }),
      filing({ ticker: 'UPS', date: '2026-09-18', title: 'Change in Directors', company: 'Upsilon Industries Limited' }),
    ], TODAY);
    for (const e of [...r.items, ...r.minor]) assert.equal(e.company, 'Upsilon Industries Limited');
  });
  test('exchange and figures: one spelling', () => {
    assert.equal(exchangeOf('https://nsearchives.nseindia.com/corporate/x.pdf'), 'NSE');
    assert.equal(exchangeOf('https://www.bseindia.com/xml-data/x.pdf'), 'BSE');
    assert.equal(tidyFigure('150 billion → 184 billion'), '₹150 bn → ₹184 bn');
    assert.equal(tidyFigure('Order book stood at 184 billion as against 150 billion'), 'Order book stood at ₹184 bn as against ₹150 bn');
    assert.equal(docTypeOf('Action(s) initiated or orders passed', ''), 'Authority action disclosure');
    assert.equal(docTypeOf('Bagging/Receiving of orders/contracts', ''), 'Order intimation');
    assert.equal(keyNumberOf('Corporate action', 'Bonus issue: 10,46,16,204 shares', null), null);
    assert.equal(FILING_READ_VERSION, 'r3');
  });
});

describe('follow-ups — ledger panel, digit grouping, senior changes', () => {
  test('each ledger panel shows only its own ticker\'s ledger and events', () => {
    const mk = (t: string, ev: string): ThesisCtx => ({ pattern: 'B', fit: 'exact', assessment: { status: 'ON_TRACK', checked: [{ key: 'order_book', label: `Order book ${t}`, weight: 4, before: '1', after: '2', verdict: 'improving' }], evidenceItems: { structural: [ev], supporting: [] } } });
    const r = buildRecentCatalysts([
      filing({ ticker: 'ONE', title: 'Bagging/Receiving of orders/contracts', ctx: mk('ONE', 'evidence of ONE') }),
      filing({ ticker: 'TWO', title: 'Action(s) initiated or orders passed', ctx: mk('TWO', 'evidence of TWO') }),
      filing({ ticker: 'TWO', date: '2026-09-20', title: 'Bagging/Receiving of orders/contracts', ctx: mk('TWO', 'evidence of TWO') }),
    ], TODAY);
    const all = [...r.items, ...r.minor];
    for (const e of all) {
      const v = ledgerView(e, all);
      assert.deepEqual(v.latest, [`evidence of ${e.ticker}`]);
      assert.ok(v.rows.every((x) => x.label.endsWith(e.ticker)));
      assert.ok(v.events.every((x) => x.ticker === e.ticker));
    }
    assert.equal(ledgerView(all.find((e) => e.ticker === 'TWO')!, all).events.length, 2);
    // a ctx stamped with another ticker is never shown
    const one = all.find((e) => e.ticker === 'ONE')!;
    assert.deepEqual(ledgerView({ ...one, ctx: { ...(one.ctx as any), ticker: 'TWO' } } as RecentEvent, all).latest, []);
  });
  test('Indian digit grouping everywhere, including the older extractor\'s figures', () => {
    assert.equal(indianGroup('2073'), '2,073');
    assert.equal(indianGroup('100000'), '1,00,000');
    assert.equal(indianGroup('1,000,000'), '10,00,000');
    assert.equal(indianGroup('12345678.5'), '1,23,45,678.5');
    assert.equal(tidyFigure('Order worth ₹2073 Cr'), 'Order worth ₹2,073 Cr');
    assert.equal(tidyFigure('face value Rs. 100000 each'), 'face value ₹1,00,000 each');
    const f = filing({ ticker: 'DELTA2', title: 'Bagging/Receiving of orders/contracts', ctx: B });
    const e = one([f], readOf(f, 'We wish to inform that the Company has received an order worth Rs. 2,073 crore from a public sector shipyard.' + PAD));
    assert.equal(e.card!.keyNumber, '₹2,073 Cr');
    assert.doesNotMatch(e.what, /₹2073/);
  });
  test('CFO / CEO / MD / whole-time director / company secretary changes → Notable + needs attention', () => {
    assert.equal(seniorChange('The Board approved the appointment of Ms. R. Shah as Company Secretary and Compliance Officer.'), true);
    assert.equal(seniorChange('Mr. X has resigned from the position of Chief Financial Officer.'), true);
    assert.equal(seniorChange('The Board approved the appointment of Mr. Y as an Independent Director.'), false);
    for (const [who, subj] of [['Chief Financial Officer', 'Change in Directors/ Key Managerial Personnel/ Auditor/ Compliance Officer/ Share Transfer Agent'], ['Company Secretary', 'Change in Management'], ['Whole-time Director', 'Change in Management']]) {
      const f = filing({ ticker: 'KMP', title: subj, ctx: A });
      const e = one([f], readOf(f, `The Board approved the appointment of Mr. A. Kumar as ${who} with effect from October 1, 2026.` + PAD));
      assert.equal(e.type, 'Management change', who);
      assert.equal(e.importance, 'Notable', who);
      assert.equal(e.card!.attention, 'senior management change', who);
    }
  });
});
