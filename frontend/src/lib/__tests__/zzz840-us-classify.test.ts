// zzz840 - US AI Gainers: classification / label fixes and missing catalyst types.
// Synthetic company names only; the sentence patterns are those seen on a real page.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUsEvents, reconcileConvertibleHits } from '../ai-gainers/us-event-taxonomy';
import { buildUsCard, catalystsFromPress, CONVERTIBLE_CAUTION, FILING_ONLY_WORD, pressKindOf, readUsOther } from '../ai-gainers/us-card';
import { buildResearchView } from '../ai-gainers/research-view';
import { directionOf, directionNote, isPriceCommentary, researchQuestionFor, subtypeOf } from '../ai-gainers/structured-facts';
import { fixtureInputUS } from './fixtures/gainers-view.fixture';

const H = (t: string) => classifyUsEvents(t, { headline: true });
const B = (t: string) => classifyUsEvents(t);
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

const sec = (form: string, items: string[], date = '2026-09-28') => ({ form, items, date, url: 'https://www.sec.gov/Archives/edgar/data/1/000000000000000001/x.htm', subject: `${form}: [${items.map((i) => `Item ${i}`).join(', ')}]` });
const secDoc = (role: string, text: string) => ({ role, url: `https://www.sec.gov/Archives/edgar/data/1/000000000000000001/${role}.htm`, text });
const PAD = ' The Company is a diversified company headquartered in Denver and its shares trade on Nasdaq under the symbol shown above. '.repeat(3);

function oneItemView(ticker: string, card: any) {
  const inp = fixtureInputUS();
  const tpl = Object.values(inp.findings)[0] as any;
  inp.findings = { [ticker]: { ...tpl, ticker, market: 'US', company: `${ticker} Corp`, status: 'none', headline: null, sourceDate: null, ageDays: null, usCard: card } };
  inp.board = [{ ticker, company: `${ticker} Corp`, move_pct: 8 }];
  inp.filedResults = []; inp.holdings = []; inp.now = '2026-09-29T12:00:00Z'; inp.session = undefined;
  const v = buildResearchView(inp);
  const it = [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])].find((i) => i.ticker === ticker);
  assert.ok(it, `${ticker} is in the view`);
  return it!;
}

// ═══ 1. debt financing is not a government contract; a bare filing is not an event ═══
describe('1. debt financing / filing with no event', () => {
  const T = "Northwind's US$330M Corani debt: capex, funding mix and schedule for mine planners";
  test('"US$330M ... funding mix ... schedule ... planners" is Debt financing (Capital structure), never a government contract', () => {
    const h = H(T);
    assert.equal(h[0].id, 'debt_refinancing');
    assert.equal(h[0].label, 'Debt financing / new credit facility');
    assert.equal(h[0].category, 'Capital structure');
    assert.ok(!ids(h).includes('gov_contract'));
  });
  test('a real government award still classifies as one; "US$" is a currency, not the government', () => {
    assert.ok(ids(B('The U.S. Army awarded the Company a $40 million contract for radios.')).includes('gov_contract'));
    assert.ok(!ids(B('The Company won a US$40 million funding round.')).includes('gov_contract'));
  });
  test('a 6-K / 8-K with no classifiable event is "Filing on file", NO_CATALYST, neutral question, never the order question', () => {
    const text = 'Report of foreign private issuer. The Company furnishes the following documents for the information of holders. General corporate housekeeping and the schedule of the upcoming shareholder communication. '.repeat(3);
    for (const form of ['6-K', '8-K']) {
      const card = buildUsCard({ ticker: 'FILE', company: 'Filecorp', marketCapM: 500, filing: sec(form, form === '8-K' ? ['8.01'] : []), docs: [secDoc('primary', text)], secChecked: true, moveDate: '2026-09-29' })!;
      assert.equal(card.kind, 'other');
      assert.equal(card.kindWord, FILING_ONLY_WORD);
      assert.equal(card.subtype, 'filing_only');
      assert.equal(card.direction, 'UNKNOWN');
      assert.match(String(card.researchQuestion), /no classifiable event/);
      assert.doesNotMatch(String(card.researchQuestion), /Order on file/);
      const it = oneItemView('FILE', card);
      assert.equal(it.eventClass, 'NO_CATALYST');
      assert.doesNotMatch(String(it.researchQuestion), /Order on file|delivery/);
      assert.match(String(it.researchQuestion), /no classifiable event/);
      assert.equal(it.eventLabel, FILING_ONLY_WORD);
    }
  });
});

// ═══ 2. tax ruling, ownership split, counterparty dividend ═══
describe('2. spin-off / merger facts', () => {
  test('a favourable IRS Private Letter Ruling is a tax ruling (closing condition), not a patent / litigation win', () => {
    const s = 'Alpine Corp received a favorable Private Letter Ruling from the Internal Revenue Service regarding federal income tax consequences of the transaction.';
    for (const hits of [H(s), B(s)]) {
      assert.equal(hits[0].id, 'tax_ruling');
      assert.equal(hits[0].label, 'Tax ruling (closing condition satisfied)');
      assert.ok(!ids(hits).includes('patent_litigation_win'));
      assert.equal(hits[0].economicDirection, 'NEUTRAL');
      assert.match(String(hits[0].directionNote), /closing condition/);
    }
  });
  test('a post-deal ownership split is a fact of the deal, not an activist stake (13D)', () => {
    const s = 'Brightwell shareholders are expected to own approximately 56.4% of the combined company and former holders of SpinCo are expected to own approximately 43.6%.';
    const h = B(s);
    assert.equal(h[0].id, 'ownership_split');
    assert.equal(h[0].label, 'Post-deal ownership split');
    assert.ok(!ids(h).includes('activist_stake'));
    assert.ok(!ids(h).includes('insider_buying'));
    // a genuine 13D stake is untouched
    assert.ok(ids(B('Starboard Value filed a Schedule 13D disclosing beneficial ownership of 9.8% of the Company.')).includes('activist_stake'));
  });
  test('the special dividend declared by the OTHER company in the deal is attributed to it', () => {
    const s = 'Brightwell will pay a special dividend of $3.00 per share to its shareholders prior to the closing of the transaction.';
    const h = B(s);
    assert.equal(h[0].id, 'dividend_counterparty');
    assert.equal(h[0].label, 'Special dividend declared by the counterparty');
    assert.ok(!ids(h).includes('dividend'));
    assert.match(String(h[0].directionNote), /counterparty/);
    // the Board of the company itself declaring one is still this company's dividend
    assert.equal(B('The Board declared a special cash dividend of $1.00 per share.')[0].id, 'dividend');
    // when the issuer is the payer it is its own dividend
    assert.equal(classifyUsEvents(s, { issuer: 'Brightwell Holdings, Inc.' })[0].id, 'dividend');
  });
});

// ═══ 3. priority review voucher ═══
describe('3. priority review voucher', () => {
  test('a voucher is a saleable asset, not a designation', () => {
    const h = B('The Company received a Priority Review Voucher upon this approval.');
    assert.equal(h[0].id, 'priority_review_voucher');
    assert.equal(h[0].label, 'Priority review voucher received (a saleable asset; value not stated)');
    assert.ok(!ids(h).includes('designation'));
    assert.match(String(h[0].directionNote), /saleable asset/);
    assert.equal(ids(B('The FDA granted Breakthrough Therapy Designation to PX-12.'))[0], 'designation');
  });
});

// ═══ 4. AI / data-centre restricted to infrastructure ═══
describe('4. AI / data-centre label', () => {
  test('a biotech AI collaboration is "Collaboration expanded" (Deals & customers), not AI / data-centre', () => {
    const h = H('Meridian Bio, Quanta Labs Expand AI and RNA Collaboration Agreements');
    assert.equal(h[0].id, 'collaboration_expanded');
    assert.equal(h[0].label, 'Collaboration expanded');
    assert.equal(h[0].category, 'Deals & customers');
    assert.ok(!ids(h).includes('ai_datacenter'));
  });
  test('infrastructure / compute / data-centre / GPU / power context is still AI / data-centre', () => {
    for (const s of ['The Company signed a 40 MW colocation lease with an AI cloud provider at its data center campus.', 'The Company announced a GPU cluster agreement with a hyperscale customer.', 'The Company will expand its AI data center capacity by 200 megawatts.']) {
      assert.ok(ids(B(s)).includes('ai_datacenter'), s);
    }
    assert.ok(!ids(B('The Company signed an agreement to use AI in its drug discovery partner program.')).includes('ai_datacenter'));
  });
});

// ═══ 5. insider buying ═══
describe('5. insider buying', () => {
  test('company buyback mechanics ("open market purchases, block trades") are never insider buying', () => {
    const s = 'Under the program, the Company may make repurchases, from time to time, through open market purchases, block trades, in privately negotiated transactions.';
    assert.ok(!ids(B(s)).includes('insider_buying'));
    assert.ok(!ids(B('Repurchases may be made through open market purchases or privately negotiated transactions under Rule 10b5-1.')).includes('insider_buying'));
  });
  test('a named director / officer / 10% holder buying is insider buying', () => {
    assert.ok(ids(B("The Company's Chief Executive Officer purchased 100,000 shares in open-market purchases.")).includes('insider_buying'));
    assert.ok(ids(B('Director Jane Roe bought 5,000 shares of the Company in the open market.')).includes('insider_buying'));
    assert.ok(ids(B('Insider buying: the CFO made open-market purchases totalling $250,000.')).includes('insider_buying'));
  });
});

// ═══ 6. convertible notes vs share sale ═══
describe('6. convertible notes in a private placement', () => {
  const TXT = 'Harbor Corp today announced the sale of an additional $50.0 million aggregate principal amount of 4.75% Convertible Senior notes due 2031 in a private placement to qualified institutional buyers. Closing is expected September 30, 2026, subject to customary closing conditions.';
  test('taxonomy: one Convertible-notes hit, no share-sale hit', () => {
    const h = B(TXT);
    assert.ok(ids(h).includes('convertible_private_placement'), ids(h).join(','));
    assert.ok(!ids(h).includes('equity_offering'));
    assert.equal(h.find((x) => x.id === 'convertible_private_placement')!.label, 'Convertible notes offering (private placement)');
    assert.equal(h.find((x) => x.id === 'convertible_private_placement')!.economicDirection, 'MIXED');
    assert.match(String(h[0].directionNote), /dilution only if converted/);
  });
  test('separate sentences: the share-sale hit is dropped for notes, kept for a real share sale', () => {
    const cv = { id: 'convertible', label: 'Convertible financing', sentence: 'The Company sold $50 million of convertible senior notes due 2031.', figures: [] };
    const eq = { id: 'equity_offering', label: 'Equity offering / ATM (dilution)', sentence: 'The notes were placed in a private placement.', figures: [] };
    const out = reconcileConvertibleHits([cv, eq]);
    assert.deepEqual(out.map((x) => x.id), ['convertible_private_placement']);
    const real = { ...eq, sentence: 'The Company also sold 2,000,000 shares of common stock in a private placement.' };
    assert.deepEqual(reconcileConvertibleHits([cv, real]).map((x) => x.id), ['convertible', 'equity_offering']);
  });
  test('card: convertible notes offering (private placement), debt with potential dilution, closing expected = SIGNED not EXECUTED, no share-sale caution', () => {
    const r = readUsOther(TXT, { form: '8-K', items: ['3.02'] })!;
    assert.equal(r.word, 'Convertible notes offering (private placement)');
    assert.equal(r.polarity, 'neutral');
    assert.equal(r.valueM, 50);
    assert.deepEqual(r.flags, [CONVERTIBLE_CAUTION]);
    assert.doesNotMatch(r.flags.join(' '), /rise on the day of a share sale/);
    const card = buildUsCard({ ticker: 'HARB', company: 'Harbor Corp', marketCapM: 400, filing: sec('8-K', ['3.02', '7.01']), docs: [secDoc('ex99', `${TXT} ${PAD}`)], secChecked: true, moveDate: '2026-09-29' })!;
    assert.equal(card.kindWord, 'Convertible notes offering (private placement)');
    assert.equal(card.eventType, 'Fundraising');
    assert.equal(card.stage, 'SIGNED');
    assert.match(String(card.stageText), /closing expected September 30, 2026/);
    assert.deepEqual(card.flags, [CONVERTIBLE_CAUTION]);
    assert.equal(card.subtype, 'convertible');
    assert.match(String(card.researchQuestion), /conversion price/);
    assert.ok(!(card.catalysts || []).some((c) => c.id === 'equity_offering'), 'no second equity-offering catalyst');
    assert.match(card.whyResearch, /potential future dilution/);
  });
  test('a real share sale keeps its caution line and its stage', () => {
    const card = buildUsCard({ ticker: 'SHRS', company: 'Sharecorp', marketCapM: 400, filing: sec('8-K', ['8.01']), docs: [secDoc('ex99', `Sharecorp today announced the pricing of an underwritten public offering of 8,000,000 shares of common stock at $4.00 per share. The offering is expected to close on October 2, 2026. ${PAD}`)], secChecked: true })!;
    assert.match(card.flags.join(' '), /rise on the day of a share sale is unusual/);
    assert.equal(card.stage, 'SIGNED');
  });
});

// ═══ 7. law-firm solicitation ═══
describe('7. law-firm solicitation', () => {
  const T = 'SUJA ALERT: Investigation Launched into Sujacorp, Robbins Geller Rudman & Dowd LLP Attorneys Encourage Investors and Potential Witnesses to Contact Law Firm';
  test('classified as a law-firm notice, neutral, never positive', () => {
    const h = H(T);
    assert.equal(h[0].id, 'law_firm_solicitation');
    assert.equal(h[0].label, 'Investor-litigation solicitation (law-firm notice; not a company filing)');
    assert.equal(h[0].economicDirection, 'NEUTRAL');
    assert.notEqual(h[0].direction, 'positive');
    assert.equal(h[0].subtype, 'law_firm_notice');
  });
  for (const t of [
    'Pomerantz Law Firm Investigates Claims On Behalf of Investors of Sujacorp',
    'Rosen Law Firm Encourages Sujacorp Investors to Inquire About Securities Class Action Investigation',
    'Levi & Korsinsky Notifies Sujacorp Shareholders of a Class Action Lawsuit',
    'Bragar Eagel & Squire, P.C. is investigating Sujacorp on behalf of stockholders',
    'SHAREHOLDER ALERT: securities fraud investigation into Sujacorp',
  ]) {
    test(`solicitation: ${t.slice(0, 50)}`, () => {
      const h = H(t);
      assert.equal(h[0]?.id, 'law_firm_solicitation', t);
      assert.equal(h[0].economicDirection, 'NEUTRAL');
    });
  }
  test('press card: kind solicitation, press only, NO_CATALYST, neutral, never a positive catalyst', () => {
    assert.equal(pressKindOf(T).kind, 'solicitation');
    assert.equal(pressKindOf(T).polarity, 'neutral');
    const card = buildUsCard({ ticker: 'SUJA', company: 'Sujacorp', marketCapM: 300, filing: null, docs: [], press: [{ title: T, url: 'https://example.com/a', date: '2026-09-28', source: 'wire' }], secChecked: true, moveDate: '2026-09-29' })!;
    assert.equal(card.kind, 'solicitation');
    assert.equal(card.source.tier, 'PRESS');
    assert.equal(card.polarity, 'neutral');
    assert.equal(card.direction, 'NEUTRAL');
    assert.equal(card.subtype, 'law_firm_notice');
    assert.match(String(card.researchQuestion), /not a company filing/);
    const it = oneItemView('SUJA', card);
    assert.equal(it.eventClass, 'NO_CATALYST');
    assert.notEqual(it.direction, 'POSITIVE');
    assert.match(it.eventLabel || '', /law-firm notice; not a company filing/);
  });
});

// ═══ 8. missing catalyst types ═══
describe('8. index inclusion, regulatory submission, sector sympathy, price commentary', () => {
  test('(a) index inclusion: "S&P SmallCap 600 Inclusion" -> Index inclusion, index-fund demand not an operating change', () => {
    const t = 'ACME Stock Jumps As S&P SmallCap 600 Inclusion';
    const h = H(t)[0];
    assert.equal(h.id, 'index_inclusion');
    assert.equal(h.label, 'Index inclusion (S&P/Russell/Nasdaq-100 add)');
    assert.equal(h.economicDirection, 'NEUTRAL');
    assert.match(String(h.directionNote), /index-fund demand, not an operating change/);
    assert.equal(pressKindOf(t).kind, 'index');
    const card = buildUsCard({ ticker: 'ACME', company: 'Acme', marketCapM: 900, filing: null, docs: [], press: [{ title: t, url: 'https://example.com/i', date: '2026-09-28', source: 'wire' }], secChecked: true, moveDate: '2026-09-29' })!;
    assert.equal(card.kind, 'index');
    assert.match(card.whyResearch, /index-fund demand, not an operating change/);
    assert.equal(card.subtype, 'index_inclusion');
  });
  test('(b) regulatory submission: filed, not approved, stage PROPOSED', () => {
    for (const t of ['FDA Submission Opens Path for Lead Therapy', 'Nuvo Therapeutics submits NDA to FDA for lead drug', 'Nuvo files 510(k) with the FDA', 'Nuvo submits IND for its lead candidate']) {
      const h = H(t);
      const s = h.find((x) => x.id === 'fda_submission');
      assert.ok(s, t);
      assert.equal(s!.label, 'Regulatory submission (filed, not approved)');
      assert.equal(s!.stage, 'PROPOSED');
      assert.equal(s!.subtype, 'regulatory_submission');
    }
    const card = buildUsCard({ ticker: 'NUVO', company: 'Nuvo Therapeutics', marketCapM: 300, filing: null, docs: [], press: [{ title: 'FDA Submission Opens Path for Lead Therapy', url: 'https://example.com/s', date: '2026-09-28', source: 'wire' }], secChecked: true, moveDate: '2026-09-29' })!;
    assert.equal(card.stage, 'PROPOSED');
    assert.match(card.kindWord, /Regulatory submission \(filed, not approved\)/);
    // an approval is still an approval
    assert.equal(ids(B('FDA approved the drug for adults.'))[0], 'fda_approval');
  });
  test('(b) SEC 8-K submission: stage PROPOSED on the card', () => {
    const card = buildUsCard({ ticker: 'NUVO', company: 'Nuvo Therapeutics', marketCapM: 300, filing: sec('8-K', ['7.01']), docs: [secDoc('ex99', `Nuvo Therapeutics today announced that it has submitted a New Drug Application (NDA) to the FDA for its lead product. ${PAD}`)], secChecked: true, moveDate: '2026-09-29' })!;
    assert.equal(card.stage, 'PROPOSED');
    assert.match(String(card.stageText), /not approved/);
  });
  test('(c) sector / theme press is sympathy, not evidence', () => {
    const t = "Meta's AI glasses push lifts eyewear name";
    const h = H(t)[0];
    assert.equal(h.id, 'sector_sympathy');
    assert.equal(h.label, 'Sector/theme sympathy (no company event)');
    assert.equal(h.economicDirection, 'NEUTRAL');
    assert.match(String(h.directionNote), /sympathy/);
    assert.match(researchQuestionFor(subtypeOf('sector_sympathy', t, 'US')), /no company event/);
  });
  test('(d) analyst target-price / "Still a Buy?" / "Average target price" are PRICE COMMENTARY and never given a direction', () => {
    for (const t of ['Acme: Still a Buy? Average target price implies 20% upside', 'Average target price for Acme points to 15% upside', 'Acme analysts see 30% upside as price target raised']) {
      const k = pressKindOf(t);
      assert.ok(k.kind === 'price_commentary' || k.kind === 'analyst', `${t} -> ${k.kind}`);
      const card = buildUsCard({ ticker: 'ACME', company: 'Acme', marketCapM: 900, filing: null, docs: [], press: [{ title: t, url: 'https://example.com/p', date: '2026-09-28', source: 'wire' }], secChecked: true, moveDate: '2026-09-29' })!;
      assert.equal(card.direction, 'NEUTRAL', t);
      assert.equal(card.priceCommentary, true, t);
      assert.equal(directionOf('analyst_action', t, 'positive'), 'NEUTRAL');
    }
    assert.ok(isPriceCommentary('Acme: Still a Buy? Average target price implies 20% upside'));
    assert.equal(directionOf('analyst_action', 'Analyst raises price target', 'positive'), 'NEUTRAL');
    // press catalysts: an analyst headline is skipped or neutral-labelled, never a positive company event
    const pc = catalystsFromPress([{ title: 'Acme: Still a Buy? Average target price implies 20% upside', url: 'u', date: '2026-09-28', source: 'wire' }]);
    assert.ok(pc.every((c) => c.id === 'analyst_action' || c.direction !== 'positive'));
  });
});

// ═══ 9. per-type research questions on the US path ═══
describe('9. US per-type research questions', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['earnings_beat', 'Revenue increased 30% and EPS beat consensus.', /what drove the change.*one-offs.*guidance/],
    ['guidance_raise', 'The Company raised its full-year revenue guidance to $500 million.', /backed by orders or a segment.*prior range/],
    ['fda_approval', 'The FDA approved the drug for adults.', /launch date.*price.*patients.*label limits/],
    ['tax_ruling', 'Alpine received a favorable Private Letter Ruling from the Internal Revenue Service on the spin-off.', /terms.*closing conditions.*tax.*leverage/],
    ['licensing', 'The Company entered into an exclusive license agreement and will receive an upfront payment.', /upfront cash versus milestones.*term.*exclusivity/],
    ['buyback', 'The Board authorized a share repurchase program of up to $100 million.', /size against market cap.*executed.*funded/],
    ['convertible', 'The Company priced $200 million of 2.5% convertible senior notes due 2031.', /use of proceeds.*conversion price/],
    ['acquisition', 'The Company agreed to acquire Zeta Systems for $80 million in cash.', /price.*earns.*financed/],
    ['management_change', 'The Company appointed Jane Roe as Chief Executive Officer.', /why.*replaces/],
    ['index_inclusion', 'Rho Corp. will replace Sigma Inc. in the S&P SmallCap 600 effective prior to the open on October 1.', /index-fund buying.*not an operating change/],
    ['fda_submission', 'The Company submitted a Biologics License Application (BLA) to the FDA for VX-9.', /accepted.*decision date/],
    ['law_firm_solicitation', 'SHAREHOLDER ALERT: Rosen Law Firm encourages investors to contact the firm.', /not a company filing.*own filings/],
  ];
  for (const [id, text, rx] of cases) {
    test(`${id} has its own question`, () => {
      const h = B(text).find((x) => x.id === id);
      assert.ok(h, `${id} found in: ${ids(B(text)).join(',')}`);
      const q = researchQuestionFor(h!.subtype!);
      assert.match(q, rx);
      assert.doesNotMatch(q, /What fundamental event, if any/);
    });
  }
  test('an 8-K earnings card carries the earnings question end to end; India rows are unchanged', () => {
    const card = buildUsCard({ ticker: 'ERN', company: 'Ernco', marketCapM: 900, filing: sec('8-K', ['7.01']), docs: [secDoc('ex99', `Ernco announced that it raised its full-year revenue guidance to $500 million from $450 million. ${PAD}`)], secChecked: true, moveDate: '2026-09-29' })!;
    assert.ok(card.researchQuestion, 'US card has a question');
    const it = oneItemView('ERN', card);
    assert.ok(it.researchQuestion && !/What fundamental event/.test(it.researchQuestion));
    // India: the same shared function keeps the old reading (no market hint -> no US mapping)
    assert.equal(subtypeOf('revenue_growth', 'Revenue up 20%'), 'other');
    assert.equal(researchQuestionFor(subtypeOf('earnings', 'x')), '');
    assert.equal(directionNote('convertible_private_placement', 'x')?.startsWith('Convertible notes'), true);
  });
});
