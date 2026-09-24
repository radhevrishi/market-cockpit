// zzz785 — US workstream B: SEC routing (items are hints, not conclusions),
// document → StructuredFacts, official vs press, fallback routing, dedup.
// Fixture texts are short, realistic snippets written for these tests; names
// of counterparties are fictional unless the case is about them (Amazon/BETA).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeSecFiling, sourceRankOf, secSourceRef, pressSourceRef, pressKindOf, DocumentLedger, dedupeSources, sha1Hex, textHash,
  accessionFromUrl, withRetry, routeWithFallback, describeRouting, parseRssItems, parseNasdaqPress, sourceRefFromAnnouncement,
} from '../ai-gainers/sec-routing';
import {
  extractUsFacts, mergeUsFacts, describeUsFact, usFactState, extractUsPressFacts, separateOfficialAndPress, extractBeneficialOwnership,
  isStrategicHolder, RESALE_PLAIN, type UsStructuredFacts,
} from '../ai-gainers/us-extract';
import { usDocumentReadFromText, usFactsFromDocs, ownershipSubject, usFindingEvidence } from '../ai-gainers/edgar-research';
import { classifyUsFiling, announcementsFromSubmissions, submissionsFromAtom, submissionsFromFullText, extractUsPressRelease } from '../ai-gainers/us-gainers';
import { classifyAnnouncement, buildFinding, rescoreFromInputs, compactInputs } from '../ai-gainers/catalyst-research';

const now = new Date('2026-09-23T20:30:00Z');
const TRADE_WORDS = /\b(buy|sell|accumulate|avoid|target price|price target|strong buy)\b/i;
const MUST_FALL = /\bprice (will|must|should) fall\b|\bmust fall\b/i;
const mustFallOnlyNegated = (s: string) => !MUST_FALL.test(s.replace(/does not by itself mean the price must fall/gi, ''));

const ref = (issuer: string, form: string, items: string[], role: 'primary' | 'ex99', text: string, acc = '000121390026012345') =>
  secSourceRef({ issuer, form, items, date: '2026-09-21', url: `https://www.sec.gov/Archives/edgar/data/1653558/${acc}/${role === 'primary' ? 'd8k.htm' : 'ex99-1.htm'}`, access: 'DOCUMENT_READ', text, role });
const cand = (subject: string, kind: any, category: any, url = 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026012345/ex99-1.htm') =>
  ({ subject, summary: null, url, dateIso: '2026-09-21T07:40:34-04:00', ageDays: 2, kind, category, stage: 'executed', valueStated: null, incremental: true, routineReason: null } as any);
const finding = (ticker: string, announcements: any[], read?: any) => buildFinding({ ticker, company: null, market: 'US', movePct: 25, marketCap: 800, turnover: 20, announcements, returns: null, holding: false, sources: ['SEC EDGAR submissions'], sourceFailed: false, windowDays: 21, now, read });

// ── fixtures ────────────────────────────────────────────────────────────────

const PRTH_8K = 'UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K CURRENT REPORT Item 1.01 Entry into a Material Definitive Agreement. '
  + 'On September 20, 2026, Priority Technology Holdings, Inc., a Delaware corporation (the “Company”), entered into an Agreement and Plan of Merger (the “Merger Agreement”) with Acme Parent, LLC, a Delaware limited liability company (“Parent”), and Acme Merger Sub, Inc. '
  + 'At the effective time of the Merger, each share of common stock of the Company issued and outstanding will be converted into the right to receive $9.50 per share in cash, without interest (the “Merger Consideration”). '
  + 'Parent has obtained equity commitments from funds affiliated with Acme Capital Partners and debt commitment letters from Big Bank, N.A. to finance the transactions contemplated by the Merger Agreement. '
  + 'The Merger Agreement provides that the Company will pay Parent a termination fee of $38.5 million under specified circumstances. '
  + 'The Merger is expected to close in the first quarter of 2027, subject to the approval of the Company’s stockholders, the expiration of the waiting period under the HSR Act and other customary closing conditions. '
  + 'Item 5.02 Departure of Directors or Certain Officers. On September 20, 2026, the Board appointed Jane Q. Smith as Chief Operating Officer of the Company.';
const PRTH_EX99 = 'Exhibit 99.1 ALPHARETTA, Ga., Sept. 21, 2026 (GLOBE NEWSWIRE) -- Priority Technology Holdings, Inc. today announced that it has entered into a definitive merger agreement to be acquired by Acme Capital Partners in an all-cash transaction. '
  + 'Under the terms of the agreement, Acme will acquire all outstanding shares for $9.50 per share in cash, a premium of approximately 38% to the closing price on September 19, 2026. '
  + 'The transaction is valued at approximately $1.3 billion, including net debt. '
  + 'For the twelve months ended June 30, 2026, Priority generated revenue of $942 million and adjusted EBITDA of $230 million. '
  + 'The combined company could generate revenue of up to $2 billion over time.';

const NUAI_8K = 'FORM 8-K Item 1.01 Entry into a Material Definitive Agreement. On September 19, 2026, New Era Energy & Digital, Inc. (the “Company”) entered into a Power Supply Agreement with Permian Gas Partners LLC to supply up to 200 MW of natural-gas-fired power to the Company’s planned data center campus in Ector County, Texas for a term of ten years. '
  + 'Item 7.01 Regulation FD Disclosure. On September 22, 2026, the Company issued a press release, a copy of which is furnished as Exhibit 99.1 to this report.';
const NUAI_EX99 = 'Exhibit 99.1 MIDLAND, Texas, Sept. 22, 2026 -- New Era Energy & Digital, Inc. (Nasdaq: NUAI) today announced a strategic update on its Texas Critical Data Centers campus. '
  + 'The Company has entered into a Power Supply Agreement with Permian Gas Partners LLC to supply up to 200 MW of natural-gas-fired power to the campus for a term of ten years. '
  + 'The Company expects the campus could generate up to $300 million of annual revenue once fully built.';

const BAND_EX99 = 'Exhibit 99.1 RALEIGH, N.C., Sept. 17, 2026 -- Bandwidth Inc. (NASDAQ: BAND) today shared an update on its enterprise business. '
  + 'Bandwidth has signed a multi-year contract with Global Retail Co. to provide its cloud voice platform across 4,000 stores over three years. '
  + 'The company believes the relationship could generate up to $40 million in revenue over the term.';

const BETA_13G = 'SCHEDULE 13G Under the Securities Exchange Act of 1934 BETA Technologies, Inc. (Name of Issuer) Class A Common Stock (Title of Class of Securities) '
  + '1 Names of Reporting Persons Amazon.com, Inc. 2 Check the appropriate box if a member of a Group (a) (b) 3 Sec Use Only 4 Citizenship or Place of Organization DELAWARE '
  + '9 Aggregate Amount Beneficially Owned by Each Reporting Person 11,650,000.00 11 Percent of class represented by amount in row (9) 5.3 % 12 Type of Reporting Person CO';
const VANGUARD_13G = 'SCHEDULE 13G NUAI (Name of Issuer) 1 NAMES OF REPORTING PERSONS The Vanguard Group 2 CHECK THE APPROPRIATE BOX IF A MEMBER OF A GROUP 9 AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON 2,100,400 11 PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (9) 5.1% 12 TYPE OF REPORTING PERSON IA';

const USDE_424B3 = 'PROSPECTUS SUPPLEMENT (To Prospectus dated September 12, 2026) StableCoinX Inc. '
  + 'This prospectus relates to the offer and resale from time to time by the selling stockholders named herein of up to 12,500,000 shares of our Class A common stock. '
  + 'We will not receive any proceeds from the sale of shares by the selling stockholders. '
  + 'As of September 10, 2026, there were 48,000,000 shares of our Class A common stock outstanding.';

// ── 1. routing: items are hints ────────────────────────────────────────────

describe('zzz785 US — SEC items route, the document concludes', () => {
  test('1.01 / 2.01 / 7.01 / 8.01 open the document and exhibits; 2.03 debt, 3.02 dilution, 5.02 governance, 2.02 results', () => {
    const r101 = routeSecFiling('8-K', ['1.01', '9.01']);
    assert.equal(r101.open, true); assert.deepEqual(r101.exhibits.sort(), ['10.1', '99.1']); assert.equal(r101.hint, null, 'a material agreement is not an event kind');
    assert.equal(routeSecFiling('8-K', ['2.01']).open, true);
    assert.equal(routeSecFiling('8-K', ['7.01', '9.01']).hint, null);
    assert.ok(routeSecFiling('8-K', ['8.01']).focus.includes('general'));
    assert.deepEqual(routeSecFiling('8-K', ['2.03']).focus, ['debt']);
    assert.deepEqual(routeSecFiling('8-K', ['3.02']).focus, ['dilution']);
    const gov = routeSecFiling('8-K', ['5.02', '9.01']);
    assert.equal(gov.hint, 'governance'); assert.equal(gov.catalystByItself, false);
    assert.equal(routeSecFiling('8-K', ['2.02']).hint, 'results');
    assert.equal(routeSecFiling('SCHEDULE 13G', []).hint, 'stake_by_strategic');
    assert.ok(routeSecFiling('424B3', []).focus.includes('resale'));
  });

  test('Item 2.01 whose text says SALE is a divestiture, not an acquisition (the item alone decided before)', () => {
    const text = 'Item 2.01 Completion of Acquisition or Disposition of Assets. On September 18, 2026, the Company completed the sale of its Legacy Payments business to Northwind Holdings Corp. for total consideration of $120 million in cash, subject to customary adjustments. '.repeat(1);
    const c = cand('8-K: Acquisition or disposition completed [Item 2.01, Item 9.01]', 'catalyst', 'acquisition');
    assert.equal(classifyUsFiling(c)?.category, 'acquisition', 'the form-only classification is unchanged (a hint)…');
    const r = usDocumentReadFromText(c, text + ' ' + 'The Company will use the proceeds to repay debt and for general corporate purposes going forward.');
    assert.equal(r.read?.category, 'divestiture', '…the text decides');
    assert.equal(r.read?.valueStated, 120);
  });

  test('a 3.02 reason says what to open for; an 8-K 3.02 read gives shares, price, buyers and computed dilution with its formula', () => {
    assert.match(classifyUsFiling({ subject: '8-K: Item 3.02 Unregistered Sales of Equity Securities' })!.routineReason || '', /shares, price and buyers are in the filing text/);
    const text = 'Item 3.02 Unregistered Sales of Equity Securities. On September 15, 2026, the Company sold an aggregate of 5,000,000 shares of common stock at a purchase price of $4.00 per share to Orchard Strategic Fund LP pursuant to a securities purchase agreement. '
      + 'The Company received gross proceeds of approximately $20.0 million before expenses. As of September 12, 2026, there were 50,000,000 shares of the Company’s common stock outstanding.';
    const [f] = extractUsFacts({ text, source: ref('XYZ', '8-K', ['3.02'], 'primary', text) });
    assert.equal(f.event.kind, 'fundraising');
    assert.equal(f.economics.sharesIssued, 5_000_000); assert.equal(f.economics.issuePrice, 4); assert.equal(f.economics.valueNative, 20);
    assert.deepEqual(f.economics.allottees, ['Orchard Strategic Fund LP']);
    assert.equal(f.economics.dilutionPct, 10);
    assert.match(f.economics.ratios[0].formula, /5,000,000 ÷ 50,000,000 × 100/);
    for (const q of f.quotes) assert.ok(text.includes(q), 'every quote is verbatim');
  });

  test('2.03 debt: amount (facility "up to" is a term, not a value), floating rate and maturity as stated', () => {
    const text = 'Item 1.01 and Item 2.03. On September 10, 2026, the Company entered into a Credit Agreement with JPMorgan Chase Bank, N.A., as administrative agent, providing for a senior secured revolving credit facility of up to $800 million. '
      + 'Borrowings under the facility bear interest at Term SOFR plus 1.75% per annum. The facility matures on September 10, 2031.';
    const [f] = extractUsFacts({ text, source: ref('DOCN', '8-K', ['1.01', '2.03', '7.01'], 'primary', text) });
    assert.equal(f.event.kind, 'debt');
    assert.equal(f.event.counterparty, 'JPMorgan Chase Bank, N.A.');
    assert.equal(f.economics.valueNative, null, 'a commitment is not a drawn amount');
    assert.equal(f.stated.facilityUpToM, 800);
    assert.ok(f.terms.some((t) => t.label === 'Interest rate' && /Term SOFR \+ 1\.75%/.test(t.value)));
    assert.ok(f.terms.some((t) => t.label === 'Maturity' && t.value === 'September 10, 2031'));
    assert.match(describeUsFact(f).line, /financing, not an operating event/);
    assert.equal(usFactState(f), 'Context');
  });

  test('5.02 is governance — who and which role — never a catalyst by itself', () => {
    const facts = extractUsFacts({ text: PRTH_8K, source: ref('PRTH', '8-K', ['1.01', '5.02', '8.01', '9.01'], 'primary', PRTH_8K) });
    const gov = facts.find((f) => f.event.kind === 'governance')!;
    assert.equal(gov.event.counterparty, 'Jane Q. Smith');
    assert.match(gov.event.product || '', /Chief Operating Officer/);
    assert.match(describeUsFact(gov).line, /not a catalyst by itself/);
    assert.equal(facts[facts.length - 1].event.kind, 'governance', 'governance ranks last');
  });
});

// ── 2. PRTH: target economics ───────────────────────────────────────────────

describe('zzz785 US — PRTH take-private: deeper target economics', () => {
  test('8-K body + EX-99.1 merge into ONE acquisition fact: value, per-share, premium, target revenue/EBITDA, ratios with formula, financing, close, conditions', () => {
    const { facts, sources } = usFactsFromDocs(cand('8-K: Business combination agreement signed (also filed as merger communication) [Item 1.01, Item 5.02, Item 8.01, Item 9.01]', 'catalyst', 'acquisition'),
      [{ role: 'primary', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026012345/d8k.htm', text: PRTH_8K }, { role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026012345/ex99-1.htm', text: PRTH_EX99 }], { issuer: 'PRTH' });
    assert.equal(sources.length, 2);
    assert.equal(sources[0].accession, '0001213900-26-012345');
    const deals = facts.filter((f) => f.event.kind === 'acquisition');
    assert.equal(deals.length, 1, 'the same deal in body and release is one fact');
    const d = deals[0] as UsStructuredFacts;
    assert.equal(d.event.counterparty, 'Acme Capital Partners', 'the buyer named by the release, not the merger vehicle');
    assert.equal(d.event.stage, 'SIGNED');
    assert.equal(d.economics.considerationNative, 1300, 'the $38.5M termination fee is not the consideration');
    assert.equal(d.economics.targetRevenueNative, 942);
    assert.equal(d.economics.targetProfitNative, 230);
    assert.deepEqual(d.economics.ratios.map((r) => [r.label, r.value]), [['Deal value / target revenue', 1.38], ['Deal value / target EBITDA', 5.65]]);
    assert.match(d.economics.ratios[0].formula, /\$1\.3B ÷ \$942M \(both as stated\)/);
    assert.ok(d.terms.some((t) => t.label === 'Per-share consideration' && t.value === '$9.50 per share in cash'));
    assert.equal(d.stated.premiumPct, 38);
    assert.match(d.terms.find((t) => t.label === 'Financing')!.value, /equity commitments[\s\S]*debt commitment letters/);
    assert.equal(d.time.expectedCompletion, 'in the first quarter of 2027');
    assert.ok(d.time.milestones.some((m) => /HSR/.test(m)));
    assert.deepEqual(d.unknowns, [], 'everything the list asks for is stated');
    assert.ok(!d.quotes.some((q) => /up to \$2 billion/.test(q)), 'a hedged combined-company figure is never quoted as fact');
    for (const q of d.quotes) assert.ok(PRTH_8K.replace(/\s+/g, ' ').includes(q) || PRTH_EX99.replace(/\s+/g, ' ').includes(q));
    assert.match(describeUsFact(d).line, /^To be acquired by Acme Capital Partners — value \$1\.3B, \$9\.50 per share in cash, target revenue \$942M, target EBITDA \$230M, expected to close in the first quarter of 2027\.$/);
  });

  test('before → after: the read carries financing, closing and target economics for the view; a thin release lists its unknowns', () => {
    const c = cand('8-K: Business combination agreement signed (also filed as merger communication) [Item 1.01, Item 9.01]', 'catalyst', 'acquisition');
    const before = extractUsPressRelease(PRTH_EX99).facts;
    assert.equal(before.funding, undefined, 'before: no financing');
    const r = usDocumentReadFromText(c, PRTH_EX99, { docs: [{ role: 'primary', url: c.url.replace('ex99-1', 'd8k'), text: PRTH_8K }, { role: 'ex99', url: c.url, text: PRTH_EX99 }], issuer: 'PRTH' });
    assert.equal(r.read?.valueStated, 1300);
    assert.match(r.read!.facts!.funding, /equity commitments/);
    assert.match(r.read!.facts!.conditions, /^Expected to close in the first quarter of 2027; conditions:/);
    assert.match(r.read!.facts!.target_economics, /target revenue \$942M · target EBITDA \$230M · Deal value \/ target revenue 1\.38×/);
    assert.match(r.read!.facts!.price_terms, /^\$9\.50 per share in cash, a 38% premium/, 'the zzz782 prefix is unchanged');
    assert.ok(r.facts && r.sources && r.sources.length === 2);
    // A thin release: consideration only.
    const thin = 'Exhibit 99.1 Priority Technology Holdings, Inc. today announced that it has entered into a definitive merger agreement to be acquired by Acme Capital Partners for $9.50 per share in cash, subject to stockholder approval.';
    const [t] = extractUsFacts({ text: thin, source: ref('PRTH', '8-K', ['1.01', '8.01'], 'ex99', thin) });
    assert.deepEqual(t.unknowns, ['Total deal value not stated (only the per-share price is)', "Target's revenue not stated", "Target's EBITDA / profit not stated", 'How the deal is financed not stated', 'Expected closing date not stated']);
    assert.equal(t.economics.targetRevenueNative, null, 'unknown stays null, never zero');
  });
});

// ── 3. NUAI / BAND: unclassified → opened and extracted ─────────────────────

describe('zzz785 US — NUAI and BAND: an unclassified 8-K is opened and extracted', () => {
  test('NUAI: the release lead classifies nothing (before); the event sentence found in body + release does (after)', () => {
    const c = cand('8-K: Material agreement signed (terms not stated in the item — open the filing); also Regulation FD disclosure [Item 1.01, Item 7.01, Item 9.01]', 'unclassified', null);
    assert.equal(classifyUsFiling(c)?.kind, 'unclassified', 'the item alone decides nothing');
    const lead = extractUsPressRelease(NUAI_EX99).lead!;
    assert.equal(classifyAnnouncement({ ...c, summary: lead }, 'US').kind, 'unclassified', 'before: the only sentence tried was the generic lead');
    const r = usDocumentReadFromText(c, NUAI_EX99, { docs: [{ role: 'primary', url: c.url.replace('ex99-1', 'd8k'), text: NUAI_8K }, { role: 'ex99', url: c.url, text: NUAI_EX99 }], issuer: 'NUAI' });
    assert.match(r.summary || '', /Power Supply Agreement with Permian Gas Partners LLC/);
    const cl = classifyAnnouncement({ ...c, summary: r.summary }, 'US');
    assert.notEqual(cl.kind, 'unclassified');
    const f = r.facts![0] as UsStructuredFacts;
    assert.equal(f.event.kind, 'capacity');
    assert.equal(f.event.counterparty, 'Permian Gas Partners LLC');
    assert.equal(f.economics.capacityAfter, 'up to 200 MW');
    assert.equal(f.time.executionPeriod, 'ten years');
    assert.equal(f.economics.valueNative, null, '"could generate up to $300 million" is not a value');
    assert.ok(f.terms.some((t) => /Hedged/.test(t.label)));
    assert.ok(f.unknowns.some((u) => /Contract value not stated/.test(u)));
    const fi = finding('NUAI', [{ ...c, summary: r.summary }]);
    assert.notEqual(fi.status, 'routine_only', 'no longer "not classifiable from the subject"');
  });

  test('BAND: generic update lead → the contract sentence; hedged revenue kept out of the value', () => {
    const c = cand('8-K: Other events (company press release) [Item 8.01, Item 9.01]', 'unclassified', null);
    assert.equal(classifyAnnouncement({ ...c, summary: extractUsPressRelease(BAND_EX99).lead }, 'US').kind, 'unclassified', 'before');
    const r = usDocumentReadFromText(c, BAND_EX99, { issuer: 'BAND' });
    assert.match(r.summary || '', /multi-year contract with Global Retail Co\./);
    assert.equal(classifyAnnouncement({ ...c, summary: r.summary }, 'US').category, 'order_win');
    const f = r.facts![0] as UsStructuredFacts;
    assert.equal(f.event.kind, 'order'); assert.equal(f.event.counterparty, 'Global Retail Co.');
    assert.equal(f.economics.valueNative, null);
    assert.equal(f.time.executionPeriod, 'three years');
    assert.equal(r.read, null, 'still SUMMARY-level for the finding (not a verified value read)');
  });

  test('an opened 8-K that states nothing recognisable says so — "opened, nothing stated" ≠ "not opened"', () => {
    const text = 'Item 8.01 Other Events. On September 18, 2026, the Company announced that its annual meeting of stockholders will be held virtually this year at a date to be determined by the Board.';
    const [f] = extractUsFacts({ text, source: ref('X', '8-K', ['8.01', '9.01'], 'primary', text) });
    assert.equal(f.event.kind, 'other');
    assert.match(f.unknowns[0], /opened[\s\S]*Item 8\.01 is a routing hint, not the event/);
  });
});

// ── 4. BETA: strategic stake ────────────────────────────────────────────────

describe('zzz785 US — BETA: Amazon 5.3% stake is a POTENTIAL catalyst, not "no catalyst"', () => {
  test('the 13G is read: holder, %, shares; operating company → stake_by_strategic, state Potential', () => {
    const bo = extractBeneficialOwnership(BETA_13G);
    assert.deepEqual({ h: bo.holder, p: bo.pct, s: bo.shares }, { h: 'Amazon.com, Inc.', p: 5.3, s: 11_650_000 });
    const src = secSourceRef({ issuer: 'BETA', form: 'SCHEDULE 13G', date: '2026-09-18', url: 'https://www.sec.gov/Archives/edgar/data/1/000110465926000001/xslSCHEDULE_13G_X02/primary_doc.xml', access: 'DOCUMENT_READ', text: BETA_13G });
    const [f] = extractUsFacts({ text: BETA_13G, source: src });
    assert.equal(f.event.kind, 'stake_by_strategic');
    assert.equal(f.economics.stakePct, 5.3);
    const d = describeUsFact(f);
    assert.equal(d.state, 'Potential'); assert.equal(d.label, 'OFFICIAL — SEC filing');
    assert.match(d.line, /Amazon\.com, Inc\. disclosed a 5\.3% stake — a strategic holder; any commercial relationship is not stated/);
    assert.ok(f.unknowns.some((u) => /commercial agreement with Amazon\.com, Inc\./.test(u)));
  });

  test('the read 13G subject is routed to strategic_investor (enabling) → the finding is a catalyst, not routine / none', () => {
    const plain = { subject: 'SCHEDULE 13G · filed 16:05 ET after the close', summary: null, url: 'https://www.sec.gov/Archives/edgar/data/1/000110465926000001/xslSCHEDULE_13G_X02/primary_doc.xml', dateIso: '2026-09-18T16:05:00-04:00', ageDays: 5 };
    assert.equal(classifyUsFiling(plain)?.kind, 'routine', 'unread 13G: still passive paperwork');
    const marked = { ...plain, subject: ownershipSubject(plain.subject, 'Amazon.com, Inc.', 5.3, true) };
    assert.match(marked.subject, /^SCHEDULE 13G: Amazon\.com, Inc\. reported 5\.3% of the class \(strategic holder stake — potential catalyst; [^)]*verification required\) · filed 16:05 ET/);
    const cl = classifyUsFiling(marked)!;
    assert.equal(cl.category, 'strategic_investor'); assert.equal(cl.stage, 'enabling');
    const f = finding('BETA', [marked]);
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'strategic_investor');
    // A fund's 13G is read too, and stays passive.
    const [v] = extractUsFacts({ text: VANGUARD_13G, source: secSourceRef({ issuer: 'NUAI', form: 'SCHEDULE 13G', date: '2026-09-01', url: 'https://www.sec.gov/x/primary_doc.xml', access: 'DOCUMENT_READ', text: VANGUARD_13G }) });
    assert.equal(v.event.kind, 'other'); assert.equal(v.event.counterparty, 'Vanguard Group'); assert.equal(v.economics.stakePct, 5.1);
    assert.equal(classifyUsFiling({ subject: ownershipSubject('SCHEDULE 13G', 'The Vanguard Group', 5.1, false) })?.kind, 'routine');
    assert.equal(isStrategicHolder('BlackRock, Inc.'), false);
    assert.equal(isStrategicHolder('Amazon', true), true); assert.equal(isStrategicHolder('John Smith', true), false);
  });

  test('press alone: Verification Required; once the 13G is on file the press item CONFIRMS it (never counted twice)', () => {
    const press = extractUsPressFacts('BETA', [{ title: 'Amazon discloses 5.3% stake in BETA Technologies', url: 'https://www.reuters.com/markets/beta-amazon', date: '2026-09-18', publisher: 'Reuters' }]);
    assert.equal(press.length, 1);
    assert.equal(press[0].event.kind, 'stake_by_strategic');
    assert.equal(press[0].verificationRequired, true);
    assert.equal(describeUsFact(press[0]).state, 'Verification Required');
    assert.match(describeUsFact(press[0]).line, /Verification required — no official filing states this yet\.$/);
    const src = secSourceRef({ issuer: 'BETA', form: 'SCHEDULE 13G', date: '2026-09-18', url: 'https://www.sec.gov/y/primary_doc.xml', access: 'DOCUMENT_READ', text: BETA_13G });
    const official = extractUsFacts({ text: BETA_13G, source: src });
    const v = separateOfficialAndPress([...official, ...press]);
    assert.equal(v.official.length, 1); assert.equal(v.press.length, 0);
    assert.equal(v.confirmed.length, 1);
    assert.equal(v.official[0].alsoFrom?.[0].kind, 'PRESS');
    assert.deepEqual(v.labelled.map((l) => l.label), ['OFFICIAL — SEC filing']);
    assert.equal(sourceRankOf(v.sources[0]), 3); assert.equal(v.sources[v.sources.length - 1].kind, 'PRESS');
  });
});

// ── 5. USDE: resale registration ────────────────────────────────────────────

describe('zzz785 US — USDE: resale registration is an overhang, never "must fall"', () => {
  test('424B3 → resale_registration with shares, no proceeds, % of outstanding with formula, plain wording', () => {
    const src = secSourceRef({ issuer: 'USDE', form: '424B3', date: '2026-09-17', url: 'https://www.sec.gov/Archives/edgar/data/2080215/000121390026056860/ea0305686-424b3_stablecoinx.htm', access: 'DOCUMENT_READ', text: USDE_424B3 });
    const [f] = extractUsFacts({ text: USDE_424B3, source: src });
    assert.equal(f.event.kind, 'resale_registration');
    assert.equal(f.stated.sharesRegistered, 12_500_000);
    assert.ok(f.terms.some((t) => t.label === 'Proceeds to the company' && /None/.test(t.value)));
    assert.deepEqual(f.economics.ratios.map((r) => [r.value, r.formula]), [[26.04, '12,500,000 ÷ 48,000,000 × 100 (%)']]);
    const d = describeUsFact(f);
    assert.equal(d.line, RESALE_PLAIN);
    assert.equal(d.line, 'Resale overhang — shares may be sold; this does not by itself mean the price must fall.');
    for (const s of [d.line, ...f.unknowns, ...f.terms.map((t) => t.value)]) { assert.ok(mustFallOnlyNegated(s), s); assert.ok(!TRADE_WORDS.test(s), s); }
    assert.equal(sourceRankOf(src), 3);
  });

  test('the form-level reason keeps "resale / shelf" (view contract) and the plain caveat', () => {
    const reason = classifyUsFiling({ subject: '424B3: PROSPECTUS SUPPLEMENT' })!.routineReason || '';
    assert.match(reason, /resale \/ shelf registration/);
    assert.match(reason, /shares may be sold; this does not by itself mean the price must fall/);
    assert.ok(mustFallOnlyNegated(reason));
  });
});

// ── 6. official vs press, per name ──────────────────────────────────────────

describe('zzz785 US — INOD, ACMR, FSLY, RSKD, OUST: official and press kept apart and labelled', () => {
  const sec = (issuer: string, items: string[], text: string) => secSourceRef({ issuer, form: '8-K', items, date: '2026-09-18', url: `https://www.sec.gov/Archives/edgar/data/9/0001${issuer.length}0000260000${items.length}/${issuer.toLowerCase()}8k.htm`, access: 'DOCUMENT_READ', text });
  const ir = (issuer: string, title: string) => ({ title, url: `https://www.globenewswire.com/news-release/2026/09/18/${issuer}`, date: '2026-09-18', publisher: 'GlobeNewswire', summary: null });
  const news = (title: string, host = 'www.reuters.com') => ({ title, url: `https://${host}/markets/x`, date: '2026-09-19', publisher: host.includes('reuters') ? 'Reuters' : 'Seeking Alpha', summary: null });

  const cases: Array<{ t: string; official: UsStructuredFacts[]; press: UsStructuredFacts[]; confirmed: number; pressLeft: number; officialKind: string }> = [];
  {
    // INOD: company release on a wire (official) + Reuters on the same contract → confirmed.
    const official = extractUsPressFacts('INOD', [ir('INOD', 'Innodata awarded $25 million contract by leading technology company to deliver AI training data over two years')]);
    const press = extractUsPressFacts('INOD', [news('Innodata wins $25 million AI training data contract from Big Tech customer')]);
    cases.push({ t: 'INOD', official, press, confirmed: 1, pressLeft: 0, officialKind: 'order' });
  }
  {
    // ACMR: 8-K 2.02 results (official) + an unconfirmed supply-deal story (press).
    const t = 'Exhibit 99.1 ACM Research, Inc. today reported financial results for the second quarter. Revenue was $224.1 million, an increase of 9% year over year. The company raised its full-year 2026 revenue guidance.';
    const official = extractUsFacts({ text: t, source: sec('ACMR', ['2.02', '9.01'], t) });
    const press = extractUsPressFacts('ACMR', [news('ACM Research signs supply agreement with Chinese chipmaker Hua Semiconductor, sources say')]);
    cases.push({ t: 'ACMR', official, press, confirmed: 0, pressLeft: 1, officialKind: 'results' });
  }
  {
    // FSLY: 8-K 2.02 with a raised outlook + press on the same raise → confirmed.
    const t = 'Exhibit 99.1 Fastly, Inc. today announced financial results for its second quarter. Total revenue was $158.2 million, up 12% from the prior year. Fastly raised its full-year 2026 revenue outlook.';
    const official = extractUsFacts({ text: t, source: sec('FSLY', ['2.02', '9.01'], t) });
    const press = extractUsPressFacts('FSLY', [news('Fastly raises full-year revenue outlook after quarterly revenue beat', 'seekingalpha.com')]);
    cases.push({ t: 'FSLY', official, press, confirmed: 1, pressLeft: 0, officialKind: 'results' });
  }
  {
    // RSKD: 8-K 1.01 credit agreement (official) + an acquisition rumour (press).
    const t = 'Item 1.01 Entry into a Material Definitive Agreement. On September 16, 2026, Riskified Ltd. entered into a Loan Agreement with Harbor Bank Ltd. providing for a term loan of $50 million. The loan bears interest at a rate of 6.5% per annum and matures on September 16, 2029.';
    const official = extractUsFacts({ text: t, source: sec('RSKD', ['1.01', '2.03'], t) });
    const press = extractUsPressFacts('RSKD', [news('Riskified is in talks to acquire fraud-analytics startup Veritrace, people familiar say')]);
    cases.push({ t: 'RSKD', official, press, confirmed: 0, pressLeft: 1, officialKind: 'debt' });
  }
  {
    // OUST: 8-K 8.01 purchase order (official) + press on the same order → confirmed.
    const t = 'Item 8.01 Other Events. On September 17, 2026, Ouster, Inc. announced that it received a purchase order from Acme Robotics Corp. for digital lidar sensors to be delivered over 18 months.';
    const official = extractUsFacts({ text: t, source: sec('OUST', ['8.01', '9.01'], t) });
    const press = extractUsPressFacts('OUST', [news('Ouster wins lidar order from Acme Robotics for its warehouse fleet')]);
    cases.push({ t: 'OUST', official, press, confirmed: 1, pressLeft: 0, officialKind: 'order' });
  }

  for (const c of cases) {
    test(`${c.t}: official ${c.officialKind}; press ${c.confirmed ? 'confirmed by the official document' : 'kept separate, verification required'}`, () => {
      assert.ok(c.official.length >= 1, `${c.t} official fact extracted`);
      assert.equal(c.official[0].event.kind, c.officialKind);
      assert.equal(c.official[0].verificationRequired, c.official[0].source.access === 'SUMMARY_ONLY', 'an SEC document read needs no verification; a release headline does');
      assert.ok(c.press.length >= 1, `${c.t} press fact extracted`);
      assert.ok(c.press.every((p) => p.source.kind === 'PRESS' && p.verificationRequired));
      const v = separateOfficialAndPress([...c.official, ...c.press]);
      assert.equal(v.confirmed.length, c.confirmed);
      assert.equal(v.press.length, c.pressLeft);
      const labels = v.labelled.map((l) => l.label);
      assert.ok(labels[0].startsWith('OFFICIAL'), 'official first');
      if (c.pressLeft) assert.equal(labels[labels.length - 1], 'PRESS — verification required');
      else assert.ok(!labels.some((l) => l.startsWith('PRESS')), 'a confirmed press item is not a second fact');
      for (const l of v.labelled) assert.ok(!TRADE_WORDS.test(describeUsFact(l.fact).line), describeUsFact(l.fact).line);
      // hierarchy: every official source ranks above every press source
      const ranks = v.sources.map((s) => sourceRankOf(s));
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    });
  }

  test('source kinds: a wire release is COMPANY_IR (official), an article is PRESS', () => {
    assert.equal(pressKindOf({ url: 'https://www.globenewswire.com/x', publisher: null }), 'COMPANY_IR');
    assert.equal(pressKindOf({ url: 'https://news.google.com/rss/articles/abc', publisher: 'Business Wire' }), 'COMPANY_IR');
    assert.equal(pressKindOf({ url: 'https://investors.ouster.com/news/x', publisher: null }), 'COMPANY_IR');
    assert.equal(pressKindOf({ url: 'https://www.reuters.com/x', publisher: 'Reuters' }), 'PRESS');
    assert.deepEqual([1, 2, 3, 4, 5], [
      sourceRankOf({ kind: 'SEC_FILING', title: '8-K: EX-99 press release' }), sourceRankOf({ kind: 'SEC_FILING', title: '10-Q: Quarterly report' }),
      sourceRankOf({ kind: 'SEC_FILING', title: 'S-1: Registration statement' }), sourceRankOf(pressSourceRef('X', ir('X', 'x'))), sourceRankOf(pressSourceRef('X', news('x'))),
    ]);
  });
});

// ── 7. fallback routing + retries ───────────────────────────────────────────

describe('zzz785 US — retries, fallback routes, secondary ≠ source unavailable', () => {
  test('withRetry backs off on a retryable status and returns the first good answer', async () => {
    const waits: number[] = [];
    let n = 0;
    const res = await withRetry(async () => ({ status: ++n < 3 ? 429 : 200 }), { retries: 2, baseMs: 400, retryOn: (r) => r.status === 429, sleep: async (ms) => { waits.push(ms); } });
    assert.equal(res.status, 200); assert.deepEqual(waits, [400, 1200]);
    // A thrown error is retried, then re-thrown.
    let m = 0;
    await assert.rejects(withRetry(async () => { m++; throw new Error('ECONNRESET'); }, { retries: 1, sleep: async () => {} }), /ECONNRESET/);
    assert.equal(m, 2);
    // Never sleeps past the deadline.
    let k = 0;
    const r2 = await withRetry(async () => ({ status: (k++, 503) }), { retries: 3, baseMs: 5_000, deadlineMs: Date.now() + 1_000, retryOn: (r) => r.status === 503, sleep: async () => {} });
    assert.equal(r2.status, 503); assert.equal(k, 1);
  });

  test('submissions JSON fails → Atom feed answers: status OK with a note; all SEC routes fail → SOURCE_UNAVAILABLE; press-only failure → SECONDARY_UNAVAILABLE', async () => {
    const ok = await routeWithFallback([
      { name: 'SEC EDGAR submissions', tier: 'primary', run: async () => { throw new Error('EDGAR submissions: SEC rate-limited or refused the request (HTTP 429)'); } },
      { name: 'SEC EDGAR company feed', tier: 'primary', run: async () => ({ rows: 3 }) },
    ]);
    assert.equal(ok.status, 'OK'); assert.equal(ok.from, 'SEC EDGAR company feed');
    assert.match(describeRouting(ok, 'SEC filings'), /from SEC EDGAR company feed \(after SEC EDGAR submissions failed\)/);
    const down = await routeWithFallback([
      { name: 'SEC EDGAR submissions', tier: 'primary', run: async () => null },
      { name: 'SEC EDGAR full-text search', tier: 'primary', run: async () => { throw new Error('HTTP 503'); } },
      { name: 'Google News RSS', tier: 'secondary', run: async () => [{ title: 'x' }] },
    ]);
    assert.equal(down.status, 'SECONDARY_ONLY', 'a secondary answer is flagged as secondary-only');
    assert.match(describeRouting(down), /secondary, verification required/);
    const allDown = await routeWithFallback([{ name: 'SEC EDGAR submissions', tier: 'primary', run: async () => null }]);
    assert.equal(allDown.status, 'SOURCE_UNAVAILABLE');
    assert.match(describeRouting(allDown), /^Source unavailable[\s\S]*not "no filing"/);
    const pressDown = await routeWithFallback([
      { name: 'Nasdaq press releases', tier: 'secondary', run: async () => { throw new Error('HTTP 403'); } },
      { name: 'Google News RSS', tier: 'secondary', run: async () => null },
    ]);
    assert.equal(pressDown.status, 'SECONDARY_UNAVAILABLE');
    assert.match(describeRouting(pressDown), /^Secondary source unavailable[\s\S]*not a primary-source failure/);
  });

  test('the Atom feed and full-text search rebuild the same filing list the submissions JSON gives', () => {
    const atom = `<feed><entry><content type="text/xml"><accession-number>0001213900-26-060470</accession-number><filing-date>2026-09-21</filing-date><filing-type>8-K</filing-type><form-name>Current report</form-name><items-desc>items 1.01, 5.02, 8.01 and 9.01</items-desc></content><updated>2026-09-21T07:40:34-04:00</updated></entry>
      <entry><content type="text/xml"><accession-number>0001213900-26-060471</accession-number><filing-date>2026-09-21</filing-date><filing-type>4</filing-type></content><updated>2026-09-21T18:00:00-04:00</updated></entry></feed>`;
    const a = announcementsFromSubmissions(submissionsFromAtom(atom), '0001653558', 21, now);
    assert.equal(a.length, 1, 'the insider Form 4 is counted, not listed');
    assert.match(a[0].subject, /^8-K: .*\[Item 1\.01, Item 5\.02, Item 8\.01, Item 9\.01\] · filed 07:40 ET before the open$/);
    assert.equal(a[0].url, 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026060470/0001213900-26-060470-index.htm');
    const fts = { hits: { hits: [
      { _id: '0001213900-26-060470:ea0306047-ex99-1.htm', _source: { adsh: '0001213900-26-060470', form: '8-K', file_type: 'EX-99.1', file_date: '2026-09-21', items: ['1.01', '5.02', '8.01', '9.01'] } },
      { _id: '0001213900-26-060470:ea0306047-8k_priority.htm', _source: { adsh: '0001213900-26-060470', form: '8-K', file_type: '8-K', file_date: '2026-09-21', items: ['1.01', '5.02', '8.01', '9.01'] } },
    ] } };
    const b = announcementsFromSubmissions(submissionsFromFullText(fts), '0001653558', 21, now);
    assert.equal(b.length, 1, 'an exhibit hit folds into its filing');
    assert.equal(b[0].url, 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026060470/ea0306047-8k_priority.htm');
  });

  test('RSS and Nasdaq parsers; a SourceRef per listed filing', () => {
    const rss = '<rss><channel><item><title>Amazon discloses 5.3% stake in BETA Technologies - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Thu, 18 Sep 2026 20:10:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>';
    const it = parseRssItems(rss)[0];
    assert.deepEqual({ t: it.title, p: it.publisher, d: it.date }, { t: 'Amazon discloses 5.3% stake in BETA Technologies', p: 'Reuters', d: '2026-09-18T20:10:00.000Z' });
    const nq = parseNasdaqPress({ data: { rows: [{ title: 'Ouster Receives Order', url: '/press-release/ouster-receives-order-2026-09-17', created: 'Sep 17, 2026', publisher: 'Business Wire' }] } });
    assert.equal(nq[0].url, 'https://www.nasdaq.com/press-release/ouster-receives-order-2026-09-17');
    assert.equal(pressKindOf(nq[0]), 'COMPANY_IR');
    const r = sourceRefFromAnnouncement('PRTH', { subject: '8-K: Business combination agreement signed [Item 1.01, Item 9.01] · filed 07:40 ET before the open', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026060470/ea0306047-8k_priority.htm', dateIso: '2026-09-21T07:40:34-04:00' });
    assert.deepEqual({ k: r.kind, a: r.access, acc: r.accession, items: r.secItems, d: r.date }, { k: 'SEC_FILING', a: 'SUMMARY_ONLY', acc: '0001213900-26-060470', items: ['1.01', '9.01'], d: '2026-09-21' });
  });
});

// ── 8. cache / dedup ────────────────────────────────────────────────────────

describe('zzz785 US — dedup by issuer + date + accession + text hash', () => {
  test('sha1 is standard; hashing ignores case, punctuation and whitespace', () => {
    assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
    assert.equal(sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
    assert.equal(textHash('The  Transaction is VALUED at $1.3 billion.'), textHash('the transaction is valued at $1.3 billion.'));
    assert.equal(accessionFromUrl('https://www.sec.gov/Archives/edgar/data/1653558/000121390026060470/x.htm'), '0001213900-26-060470');
  });

  test('the same release filed as 8-K and DEFA14A, or the same exhibit fetched twice, is ONE document', () => {
    const l = new DocumentLedger();
    const a = secSourceRef({ issuer: 'PRTH', form: '8-K', date: '2026-09-21', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026060470/ex99.htm', access: 'DOCUMENT_READ', text: PRTH_EX99 });
    const b = secSourceRef({ issuer: 'PRTH', form: 'DEFA14A', date: '2026-09-21', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026060471/ex99.htm', access: 'DOCUMENT_READ', text: PRTH_EX99 });
    assert.equal(l.add(a).added, true);
    assert.equal(l.add(b).duplicateOf, a);
    assert.equal(l.add({ ...a, hash: null }).added, false, 'same accession + url');
    assert.equal(dedupeSources([b, a, a]).length, 1);
    const { facts, sources } = usFactsFromDocs(cand('8-K: x [Item 1.01, Item 8.01]', 'catalyst', 'acquisition'), [
      { role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026012345/ex99-1.htm', text: PRTH_EX99 },
      { role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026012345/ex99-1-copy.htm', text: PRTH_EX99 },
    ], { issuer: 'PRTH' });
    assert.equal(sources.length, 1);
    assert.equal(facts.filter((f) => f.event.kind === 'acquisition').length, 1);
  });

  test('mergeUsFacts keeps the higher-ranked source and records the other document', () => {
    const a = extractUsFacts({ text: PRTH_EX99, source: pressSourceRef('PRTH', { title: 'Priority to be acquired', url: 'https://www.globenewswire.com/x', date: '2026-09-21', publisher: 'GlobeNewswire' }, 'DOCUMENT_READ') });
    const b = extractUsFacts({ text: PRTH_EX99, source: ref('PRTH', '8-K', ['1.01'], 'ex99', PRTH_EX99) });
    const m = mergeUsFacts([...a, ...b]).filter((f) => f.event.kind === 'acquisition');
    assert.equal(m.length, 1);
    assert.equal(m[0].source.kind, 'SEC_FILING');
    assert.equal(m[0].alsoFrom?.[0].kind, 'COMPANY_IR');
  });
});

describe('zzz785 US — contract rules', () => {
  test('never invents: nothing stated → nothing emitted; prices never enter; boilerplate reads as nothing', () => {
    assert.deepEqual(extractUsFacts({ text: 'x'.repeat(300), source: ref('X', '8-K', ['8.01'], 'primary', 'x') }), []);
    const c = cand('8-K: Other events (company press release) [Item 8.01, Item 9.01]', 'unclassified', null);
    assert.deepEqual(usDocumentReadFromText(c, 'x'.repeat(300)), { read: null, summary: null });
    const t = 'Exhibit 99.1 Widget Inc. today announced that it has been awarded a contract by the U.S. Army to supply tactical radios. Shares of Widget closed at $14.20 on Friday, up 22%.';
    const [f] = extractUsFacts({ text: t, source: ref('WID', '8-K', ['8.01'], 'ex99', t) });
    assert.equal(f.event.kind, 'order');
    assert.equal(f.event.counterparty, 'U.S. Army');
    assert.equal(f.economics.valueNative, null, 'a share price is never a contract value');
    assert.ok(f.unknowns.includes('Contract value not stated (a hedged "up to / potential" figure is not a value)'));
  });
});

// ── 9. shapes seen in the live 8-Ks (24 Sep 2026) ───────────────────────────

describe('zzz785 US — live-shaped 8-Ks: what the item code hid', () => {
  const COVER = 'Emerging growth company ☒ If an emerging growth company, indicate by check mark if the registrant has elected not to use the extended transition period for complying with any new or revised financial accounting standards provided pursuant to Section 13(a) of the Exchange Act. ☐ ';
  test('NUAI (live shape): Item 1.01 was an at-the-market Sales Agreement → a DILUTION document read, not a positive raise; the permit halt is a stated setback', () => {
    const body = COVER + 'Item 1.01 Entry into a Material Definitive Agreement On September 24, 2026, New Era Energy & Digital, Inc., a Nevada corporation (the “ Company ”), entered into an At-The-Market Issuance Sales Agreement (the “ Sales Agreement ”) with Mizuho Securities USA LLC and B. Riley Securities, Inc., as agents, pursuant to which the Company may offer and sell shares of its common stock having an aggregate offering price of up to $100 million (the “ ATM Program ”). '
      + 'The Company is not obligated to sell any shares of Common Stock under the Sales Agreement. The Company will pay the Agents a commission up to 3.5% of the gross proceeds from each sale of shares of Common Stock. '
      + 'Item 8.01 Other Events. If we enter into a letter of intent with a tenant, it will be non-binding and subject to a number of terms and conditions. '
      + 'On September 21, 2026, Texas Governor Greg Abbott directed the Texas Commission on Environmental Quality to halt all permits sought by data centers in Texas, and certain permits necessary to the development of the Company’s project may be delayed.';
    const c = cand('8-K: Material agreement signed (terms not stated in the item — open the filing); also Other events (company press release) [Item 1.01, Item 8.01, Item 9.01]', 'unclassified', null, 'https://www.sec.gov/Archives/edgar/data/2028336/000121390026102859/ea0306502-8k_newera.htm');
    const r = usDocumentReadFromText(c, body, { issuer: 'NUAI' });
    assert.equal(r.read?.category, 'dilution');
    assert.equal(r.read?.valueStated, null, 'an "up to" program size is not money raised');
    assert.match(r.read!.headline, /^At-the-market equity program of up to \$100M with Mizuho Securities USA LLC and B\. Riley Securities, Inc\. — shares may be sold over time; a supply facility, not money raised\.$/);
    assert.ok(body.includes(r.read!.quote));
    const kinds = r.facts!.map((f) => f.event.kind);
    assert.deepEqual(kinds, ['fundraising', 'regulatory_negative']);
    assert.ok(!r.facts!.some((f) => f.quotes.some((q) => /^If we enter/.test(q))), 'a hypothetical is never the event');
    const fi = finding('NUAI', [c], r.read);
    assert.equal(fi.status, 'negative'); assert.equal(fi.category, 'dilution');
  });

  test('BAND (live shape): a 7.01 investor deck reads as routine, not "unclassified"', () => {
    const body = COVER + 'Item 7.01 Regulation FD Disclosure. Bandwidth Inc. (the “Company”) plans to use certain presentation materials at various investor conferences during the third quarter of 2026. A copy of these materials is furnished with this Current Report on Form 8-K as Exhibit 99.1.';
    const c = cand('8-K: Regulation FD disclosure (press release / investor materials) [Item 7.01, Item 9.01]', 'unclassified', null);
    const r = usDocumentReadFromText(c, body, { issuer: 'BAND' });
    assert.equal(r.read, null);
    assert.match(r.summary || '', /^Investor presentation furnished under Regulation FD — no new event: Bandwidth Inc\. \(the “Company”\) plans to use/);
    assert.equal(classifyAnnouncement({ ...c, summary: r.summary }, 'US').kind, 'routine');
    assert.equal(describeUsFact(r.facts![0] as UsStructuredFacts).line, 'Investor presentation furnished under Regulation FD — the 8-K itself states no new event.');
  });

  test('PRTH (live shape): a management-led take-private — the buyer is the investor group, the related party is named, both premiums kept', () => {
    const ex = 'Priority Technology Holdings, Inc. (NASDAQ: PRTH) today announced it has entered into a definitive agreement with an investor group led by Thomas Priore, the Company’s Chairman and Chief Executive Officer, to take the Company private. '
      + 'The all-cash transaction represents an enterprise value of approximately $1.6 billion. '
      + 'The transaction delivers a 65% premium to the Company’s closing share price on November 7, 2025, the last trading day before public disclosure of the Investor Group’s preliminary, non-binding proposal. '
      + 'The transaction represents a 38% premium to the Company’s closing share price on September 18, 2026, the last trading day prior to the announcement of the definitive agreement. '
      + 'Holders of the Company’s common stock (other than shares held by the Investor Group) will receive $8.05 per share in cash at the closing of the transaction. '
      + 'The transaction is being financed, in part, by equity commitments from funds advised by Searchlight Capital Partners, L.P. and is not subject to any financing conditions. The transaction is expected to close in the first half of 2027.';
    const body = 'On September 18, 2026, Priority Technology Holdings, Inc. entered into an Agreement and Plan of Merger with WD Capital Partners Parent Inc. (“ Parent ”), pursuant to which Merger Sub will merge with and into the Company, with the Company surviving the Merger as a wholly owned subsidiary of Parent. '
      + 'Parent and Merger Sub are entities controlled by Thomas C. Priore, the Company\'s Chairman and Chief Executive Officer and certain of his affiliates.';
    const { facts } = usFactsFromDocs(cand('8-K: Business combination agreement signed [Item 1.01, Item 8.01]', 'catalyst', 'acquisition'), [
      { role: 'primary', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026101651/ea0306047-8k_priority.htm', text: body },
      { role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026101651/ea030604701ex99-1_priority.htm', text: ex },
    ], { issuer: 'PRTH' });
    const d = facts.filter((f) => f.event.kind === 'acquisition') as UsStructuredFacts[];
    assert.equal(d.length, 1, 'body + release: one fact');
    assert.equal(d[0].event.counterparty, 'Investor group led by Thomas Priore');
    assert.ok(d[0].terms.some((t) => t.label === 'Role' && /TARGET/.test(t.value)));
    assert.match(d[0].terms.find((t) => t.label === 'Buyer (related party)')!.value, /Thomas C\. Priore, the company's Chairman and Chief Executive Officer/);
    assert.match(d[0].terms.find((t) => t.label === 'Premium (as stated)')!.value, /^65% \([^)]*\) · 38% \([^)]*\)$/);
    assert.equal(d[0].economics.considerationNative, 1600);
    assert.equal(d[0].terms.find((t) => t.label === 'Financing condition')?.value, 'None (as stated)');
    assert.match(d[0].terms.find((t) => t.label === 'Financing')!.value, /Searchlight/);
    assert.deepEqual(d[0].unknowns, ["Target's revenue not stated", "Target's EBITDA / profit not stated"], 'the release states no target revenue / EBITDA — listed, not guessed');
  });

  test('sentence splitter: a cover-page check box ends the cover; initials and "Inc. (the …)" do not end a sentence', () => {
    const s = extractUsFacts({ text: COVER + 'Item 5.02. On September 2, 2026, the Board appointed Mary K. Jones as Chief Financial Officer of Acme Widgets, Inc. (the “Company”), effective immediately.', source: ref('X', '8-K', ['5.02'], 'primary', 'x') });
    assert.equal(s[0].event.counterparty, 'Mary K. Jones');
    assert.match(s[0].event.product || '', /Chief Financial Officer/);
  });
});

// ── 9. wiring: US facts / refs reach the finding (route → buildFinding) ─────

describe('zzz785 US — the finding carries the US facts, refs and evidence gap', () => {
  const withEv = (ticker: string, announcements: any[], ev: { extraFacts: any[]; extraRefs: any[] }, read?: any) =>
    buildFinding({ ticker, company: null, market: 'US', movePct: 25, marketCap: 800, turnover: 20, announcements, returns: null, holding: false, sources: ['SEC EDGAR submissions'], sourceFailed: false, windowDays: 21, now, read, extraFacts: ev.extraFacts, extraRefs: ev.extraRefs });

  test('PRTH: 8-K body + EX-99.1 → one acquisition fact on the finding, one ref per document, the listing copy not repeated', () => {
    const c = cand('8-K: Material agreement signed [Item 1.01, Item 5.02, Item 9.01]', 'unclassified', null, 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026012345/d8k.htm');
    const r = usDocumentReadFromText(c, PRTH_EX99, { docs: [{ role: 'primary', url: c.url, text: PRTH_8K }, { role: 'ex99', url: c.url.replace('d8k', 'ex99-1'), text: PRTH_EX99 }], issuer: 'PRTH' });
    const ev = usFindingEvidence({ doc: r, issuer: 'PRTH' });
    const f = withEv('PRTH', [c], ev);
    const deal = f.structuredFacts!.filter((x) => x.event.kind === 'acquisition');
    assert.equal(deal.length, 1, 'body + release = one event');
    assert.ok(deal[0].economics.considerationNative != null);
    assert.equal(deal[0].economics.currency, 'USD_M');
    const secRefs = f.sourceRefs!.filter((x) => x.kind === 'SEC_FILING');
    assert.deepEqual(secRefs.map((x) => x.access), ['DOCUMENT_READ', 'DOCUMENT_READ'], 'body + exhibit; no SUMMARY_ONLY duplicate of the same filing');
    assert.ok(secRefs.every((x) => x.accession === '0001213900-26-012345' && x.hash));
    assert.ok(f.structuredFacts!.some((x) => x.event.kind === 'governance'), '5.02 kept as governance context');
  });

  test('an opened 8-K that still states nothing recognisable → UNCLASSIFIED (not EVIDENCE_INCOMPLETE, not NO_CATALYST); unopened → EVIDENCE_INCOMPLETE', () => {
    const url = 'https://www.sec.gov/Archives/edgar/data/9/000000000026000777/x8k.htm';
    const c = { subject: '8-K: Other events [Item 8.01, Item 9.01]', summary: null, url, dateIso: '2026-09-21T07:40:34-04:00', ageDays: 2 };
    const text = 'Item 8.01 Other Events. On September 18, 2026, the Company announced that its annual meeting of stockholders will be held virtually this year at a date to be determined by the Board.';
    const before = finding('XYZ', [c]);
    assert.equal(before.status, 'routine_only'); assert.equal(before.evidenceGap, 'EVIDENCE_INCOMPLETE', 'not opened: incomplete');
    const r = usFactsFromDocs(c, [{ role: 'primary', url, text }], { issuer: 'XYZ' });
    const after = withEv('XYZ', [c], usFindingEvidence({ doc: r, issuer: 'XYZ' }));
    assert.equal(after.status, 'routine_only'); assert.equal(after.evidenceGap, 'UNCLASSIFIED', 'opened, nothing stated');
    assert.ok(after.sourceRefs!.some((x) => x.access === 'DOCUMENT_READ' && x.url === url));
  });

  test('BETA press only → EVIDENCE_INCOMPLETE (never NO_CATALYST); the press fact is secondary, verification required, not confirmed', () => {
    const press = extractUsPressFacts('BETA', [{ title: 'Amazon discloses 5.3% stake in BETA Technologies', url: 'https://www.reuters.com/markets/beta-amazon', date: '2026-09-18', publisher: 'Reuters' }]);
    const ev = usFindingEvidence({ listing: { facts: press, sourceRefs: press.map((p) => p.source) } as any, issuer: 'BETA' });
    const f = withEv('BETA', [], ev);
    assert.notEqual(f.evidenceGap, 'NO_CATALYST');
    assert.equal(f.evidenceGap, 'EVIDENCE_INCOMPLETE');
    const p = f.structuredFacts!.find((x) => x.event.kind === 'stake_by_strategic') as any;
    assert.equal(p.source.kind, 'PRESS'); assert.equal(p.secondary, true); assert.equal(p.verificationRequired, true); assert.equal(p.confirmedBy, null);
    assert.match(p.headline, /Verification required/);
  });

  test('BETA 13G read + press → the press item is confirmedBy the 13G; the official fact is Potential, and counted once', () => {
    const url = 'https://www.sec.gov/Archives/edgar/data/1/000110465926000001/xslSCHEDULE_13G_X02/primary_doc.xml';
    const src = secSourceRef({ issuer: 'BETA', form: 'SCHEDULE 13G', date: '2026-09-18', url, access: 'DOCUMENT_READ', text: BETA_13G });
    const official = extractUsFacts({ text: BETA_13G, source: src });
    const press = extractUsPressFacts('BETA', [{ title: 'Amazon discloses 5.3% stake in BETA Technologies', url: 'https://www.reuters.com/markets/beta-amazon', date: '2026-09-18', publisher: 'Reuters' }]);
    const ev = usFindingEvidence({ listing: { facts: [...official, ...press], sourceRefs: [src] } as any, issuer: 'BETA' });
    const stakes = ev.extraFacts.filter((x) => x.event.kind === 'stake_by_strategic');
    const off = stakes.filter((x) => x.source.kind === 'SEC_FILING');
    const pr = stakes.filter((x) => x.source.kind === 'PRESS');
    assert.equal(off.length, 1); assert.equal(pr.length, 1);
    assert.equal(pr[0].secondary, true);
    assert.equal(pr[0].confirmedBy?.url, url, 'press confirmed by the official filing');
    assert.equal(describeUsFact(off[0]).state, 'Potential');
    const marked = { subject: ownershipSubject('SCHEDULE 13G · filed 16:05 ET after the close', 'Amazon.com, Inc.', 5.3, true), summary: null, url, dateIso: '2026-09-18T16:05:00-04:00', ageDays: 5 };
    const f = withEv('BETA', [marked], ev);
    assert.equal(f.status, 'catalyst'); assert.notEqual(f.evidenceGap, 'NO_CATALYST');
  });

  test('USDE: a read 424B3 travels as resale_registration with the plain overhang wording', () => {
    const src = secSourceRef({ issuer: 'USDE', form: '424B3', date: '2026-09-17', url: 'https://www.sec.gov/Archives/edgar/data/2080215/000121390026056860/424b3.htm', access: 'DOCUMENT_READ', text: USDE_424B3 });
    const ev = usFindingEvidence({ doc: { facts: extractUsFacts({ text: USDE_424B3, source: src }), sources: [src] }, issuer: 'USDE' });
    const f = withEv('USDE', [], ev);
    const r = f.structuredFacts!.find((x) => x.event.kind === 'resale_registration') as any;
    assert.ok(r);
    assert.equal(r.headline, RESALE_PLAIN);
    assert.ok(mustFallOnlyNegated(r.headline) && !TRADE_WORDS.test(r.headline));
  });

  test('SEC down → a SOURCE_UNAVAILABLE ref; press down too → a separate SECONDARY_UNAVAILABLE ref (never merged)', () => {
    const ev = usFindingEvidence({ listing: { facts: [], sourceRefs: [], failure: 'submissions_failed', routingNote: 'Source unavailable: SEC EDGAR submissions failed', errors: [], press: { items: [], sources: [], facts: [], status: 'SECONDARY_UNAVAILABLE', attempts: [], note: 'Secondary source unavailable (Nasdaq, Google News)' } } as any, issuer: 'OUST' });
    const acc = ev.extraRefs.map((r) => `${r.kind}:${r.access}`);
    assert.deepEqual(acc, ['SEC_FILING:SOURCE_UNAVAILABLE', 'PRESS:SECONDARY_UNAVAILABLE']);
    assert.ok(ev.extraRefs.every((r) => r.issuer === 'OUST'));
    const secOnlyDown = usFindingEvidence({ listing: { failure: 'submissions_failed', routingNote: 'x', errors: [], press: { status: 'OK', items: [], sources: [], facts: [], attempts: [], note: '' } } as any });
    assert.equal(secOnlyDown.extraRefs.filter((r) => r.access === 'SECONDARY_UNAVAILABLE').length, 0);
  });

  test('a re-score from stored inputs keeps the US facts and refs (no refetch)', () => {
    const src = secSourceRef({ issuer: 'USDE', form: '424B3', date: '2026-09-17', url: 'https://www.sec.gov/Archives/edgar/data/2080215/000121390026056860/424b3.htm', access: 'DOCUMENT_READ', text: USDE_424B3 });
    const ev = usFindingEvidence({ doc: { facts: extractUsFacts({ text: USDE_424B3, source: src }), sources: [src] }, issuer: 'USDE' });
    const stored = compactInputs({ announcements: [], returns: null, marketCap: 800, turnover: 20, sources: ['SEC EDGAR submissions'], sourceFailed: false, fetchedAt: now.toISOString(), extraFacts: ev.extraFacts, extraRefs: ev.extraRefs }, 21, now);
    const f = rescoreFromInputs(JSON.parse(JSON.stringify(stored)), { ticker: 'USDE', company: null, market: 'US', movePct: 12, holding: false, windowDays: 21 });
    assert.ok(f.structuredFacts!.some((x) => x.event.kind === 'resale_registration'));
    assert.ok(f.sourceRefs!.some((x) => x.access === 'DOCUMENT_READ' && x.accession === '0001213900-26-056860'));
    assert.ok(JSON.stringify(stored).length < 20_000, 'compact enough for the day\'s KV state');
  });

  test('never invents: an empty listing adds nothing', () => {
    assert.deepEqual(usFindingEvidence({}), { extraFacts: [], extraRefs: [] });
  });
});
