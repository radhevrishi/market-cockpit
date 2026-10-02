// zzz852 - owned numbers, deal terms, entity resolution, source subject, QA, EDGAR forms, corporate-action hierarchy. Synthetic names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOwnedNumbers } from '../special-sit-numbers';
import { extractDealTerms } from '../special-sit-deal-terms';
import { resolveEntity, tickerLabelFor, buildUsLookup, deriveSourceSubject, parseSecTickerPayload, createSecLookupLoader, SEC_FILER_ALIASES } from '../special-sit-entity';
import { buildRadarQa } from '../special-sit-qa';
import { eventToRadarInput, splitRadarInputs, dedupeFeedEvents } from '../multibagger-radar-adapter';
import { NSE_TICKER_NAMES, resolveCompanyToTicker } from '../nse-ticker-names';
import type { RadarFeedEvent } from '../multibagger-radar-feed-types';

let n = 0;
const ev = (title: string, o: { source?: string; link?: string; description?: string; tickers?: string[]; region?: 'IN' | 'US'; event_type?: string; extra?: Partial<RadarFeedEvent> } = {}): RadarFeedEvent => {
  n += 1;
  const { source = 'ET Industry', link = `https://x.test/${n}`, description, tickers, region = 'IN', event_type = 'UNCLASSIFIED', extra } = o;
  return { event_id: `q${n}`, event_type, region, tickers, primary_filing: { title, source, link, description, tickers, region }, filings: [{ title, source, link }], ...extra } as RadarFeedEvent;
};

describe('A owned numbers', () => {
  test('purchase price belongs to the transaction', () => {
    const r = extractOwnedNumbers('Acme Foods to acquire Beta Snacks for Rs 2,410 crore', '', 'ACQUISITION', 'Acme Foods');
    assert.equal(r.length, 1);
    assert.equal(r[0].metric, 'purchase_price'); assert.equal(r[0].entityRole, 'transaction'); assert.equal(r[0].value, 2410); assert.equal(r[0].unit, 'crore'); assert.equal(r[0].currency, 'INR');
    assert.equal(r[0].countsAsParentEarnings, false);
  });
  test('"bet" is an investment', () => {
    const r = extractOwnedNumbers("Acme's Rs 900 cr Beta Bar bet", '', 'ACQUISITION', 'Acme');
    assert.equal(r[0].metric, 'investment'); assert.equal(r[0].entityRole, 'transaction');
  });
  test('target revenue is owned by the target, not the parent', () => {
    const r = extractOwnedNumbers('Acme to acquire Beta Bar for Rs 900 crore', 'Beta Bar, which clocked Rs 452 crore revenue in FY25, is growing fast.', 'ACQUISITION', 'Acme');
    const rev = r.find((x) => x.metric === 'revenue')!;
    assert.equal(rev.entity, 'Beta Bar'); assert.equal(rev.entityRole, 'target'); assert.equal(rev.countsAsParentEarnings, false); assert.equal(rev.period, 'FY25');
    assert.equal(r.some((x) => x.countsAsParentEarnings), false);
  });
  test('"the business" is the target; MW belongs to the acquired asset', () => {
    const r = extractOwnedNumbers('Gamma Power buys wind portfolio of 450 MW for Rs 1,200 crore', 'The business posted Rs 300 crore EBITDA.', 'ACQUISITION', 'Gamma Power');
    assert.equal(r.find((x) => x.metric === 'capacity')!.entityRole, 'acquired_asset');
    const e = r.find((x) => x.metric === 'ebitda')!;
    assert.equal(e.entityRole, 'target'); assert.equal(e.countsAsParentEarnings, false);
  });
  test('market size is role market', () => {
    const r = extractOwnedNumbers('Acme enters snacks', 'The snacks market worth Rs 50,000 crore is crowded.', 'ACQUISITION', 'Acme');
    const m = r.find((x) => x.value === 50000)!;
    assert.equal(m.metric, 'market_size'); assert.equal(m.entityRole, 'market'); assert.equal(m.countsAsParentEarnings, false);
  });
  test("the event company's own results count as parent", () => {
    const r = extractOwnedNumbers('Acme Industries Q1 net profit rises to Rs 200 crore', 'Acme Industries reported revenue of Rs 1,500 crore.', 'EARNINGS', 'Acme Industries');
    assert.ok(r.length >= 2);
    for (const x of r) { assert.equal(x.entityRole, 'parent'); assert.equal(x.countsAsParentEarnings, true); }
    assert.equal(r.find((x) => x.metric === 'pat')!.value, 200);
  });
  test('unclear ownership is unknown and not counted', () => {
    const r = extractOwnedNumbers('Revenue of Rs 300 crore reported', '', 'EARNINGS', 'Acme Industries');
    assert.equal(r[0].entityRole, 'unknown'); assert.equal(r[0].countsAsParentEarnings, false);
  });
  test('parent order value counts; another party order does not', () => {
    const a = extractOwnedNumbers('Acme Industries bags Rs 400 crore order', '', 'ORDER', 'Acme Industries');
    assert.equal(a[0].metric, 'order_value'); assert.equal(a[0].countsAsParentEarnings, true);
    const b = extractOwnedNumbers('Delta Corp bags Rs 400 crore order', '', 'ORDER', 'Acme Industries');
    assert.equal(b[0].countsAsParentEarnings, false);
  });
});

describe('B deal terms', () => {
  const tender = 'Zeta Corp announced a tender offer to purchase up to 5,000,000 shares at $12.50 per share in cash. The offer is subject to a minimum tender of 60% of outstanding shares. The offer will expire on March 14, 2027. Payment will be settled within three business days. The offer is not subject to a financing condition.';
  test('tender: stated fields, no premium without reference', () => {
    const t = extractDealTerms(tender, 'TENDER');
    assert.equal(t.fields.offer_price, '$12.50 per share'); assert.equal(t.fields.consideration_type, 'cash'); assert.equal(t.fields.expiry_date, 'March 14, 2027');
    assert.ok(t.fields.minimum_tender.includes('60%')); assert.ok(t.fields.settlement);
    assert.ok(t.missing.includes('reference_price')); assert.ok(t.missing.includes('premium_or_discount'));
    assert.ok(t.statedConditions.some((c) => /minimum tender/.test(c)) && t.statedConditions.some((c) => /expire/.test(c)));
  });
  test('premium shown only with the reference price', () => {
    const a = extractDealTerms('Offer of $12.50 per share, a 25% premium to the closing price of $10.00 on May 1, 2027.', 'TENDER');
    assert.ok(a.fields.premium_or_discount && a.fields.reference_price);
    const b = extractDealTerms('Offer of $12.50 per share, a 25% premium.', 'TENDER');
    assert.equal(b.fields.premium_or_discount, undefined); assert.ok(b.missing.includes('premium_or_discount'));
  });
  test('never mentions approvals that the text does not', () => {
    const t = extractDealTerms('Zeta offers $5 per share.', 'TENDER');
    assert.equal(JSON.stringify(t).match(/antitrust|minority/i), null);
    assert.ok(t.missing.includes('regulatory_approvals'));
  });
  test('acquisition', () => {
    const t = extractDealTerms('Acme to acquire Beta for $1.2 billion in cash. Beta posted revenue of $300 million. The deal will be funded by a new credit facility. Closing is expected in the second quarter of 2027.', 'ACQUISITION');
    assert.equal(t.fields.purchase_price, '$1.2 billion'); assert.equal(t.fields.consideration_type, 'cash'); assert.ok(t.fields.financing); assert.ok(t.fields.expected_close);
    assert.ok(t.missing.includes('multiple') && t.missing.includes('new_shares_or_dilution'));
  });
  test('merger, spin, buyback, dividend', () => {
    const m = extractDealTerms('Each Beta holder receives 0.45 shares of Acme for every 1 Beta share. Acme will issue 12 million new shares. Beta holders will own 30% of the combined company. Subject to shareholder approval.', 'MERGER');
    assert.ok(m.fields.exchange_ratio); assert.ok(m.fields.shares_issued); assert.ok(m.fields.ownership_split); assert.ok(m.fields.approvals);
    const s = extractDealTerms('Record date is June 3, 2027. One share of SpinCo for every 4 shares of Parent. SpinCo listing is expected on July 1, 2027.', 'SPIN_OFF');
    assert.equal(s.fields.record_date, 'June 3, 2027'); assert.ok(s.fields.ratio);
    const b = extractDealTerms('Board approves buyback of Rs 500 crore via the tender offer route at Rs 250 per share, 2.1% of paid-up equity capital, funded from free reserves.', 'BUYBACK');
    assert.equal(b.fields.size, 'Rs 500 crore'); assert.equal(b.fields.method, 'tender offer'); assert.ok(b.fields.price.includes('250')); assert.ok(b.fields.pct_of_market_cap); assert.ok(b.fields.funding);
    const d = extractDealTerms('Declares Rs 200/Share dividend. Record date is August 20, 2027.', 'DIVIDEND');
    assert.ok(d.fields.amount_per_share.includes('200')); assert.equal(d.fields.record_date, 'August 20, 2027'); assert.deepEqual(d.missing, []);
  });
});

describe('C entity resolution', () => {
  const lookup = buildUsLookup([
    { ticker: 'UTST', name: 'Utah Test Medical Inc', cik: '0000706698', exchange: 'Nasdaq' },
    { ticker: 'DUALA', name: 'Dual Class Holdings Corp Class A', cik: 1, exchange: 'NYSE' },
    { ticker: 'DUALB', name: 'Dual Class Holdings Corp Class A', cik: 1, exchange: 'NYSE' },
    { ticker: 'NRTH', name: 'Northern Quarry Materials Inc', cik: 2, exchange: 'NYSE' },
    { ticker: 'NRTX', name: 'Northern Quarry Systems Inc', cik: 3, exchange: 'Nasdaq' },
  ]);
  test('explicit tag directly after the name', () => {
    const e = resolveEntity({ name: 'Acme Widgets', text: 'Acme Widgets Inc. (NASDAQ: ACMW) to acquire Beta Gears (NYSE: BGRS)' });
    assert.equal(e.state, 'RESOLVED'); assert.equal(e.ticker, 'ACMW'); assert.equal(e.exchange, 'Nasdaq');
    assert.equal(tickerLabelFor(e), 'Ticker: ACMW (Nasdaq)');
    const t = resolveEntity({ name: 'Beta Gears', text: 'Acme Widgets Inc. (NASDAQ: ACMW) to acquire Beta Gears (NYSE: BGRS)' });
    assert.equal(t.ticker, 'BGRS');
    const none = resolveEntity({ name: 'Gamma Lens', text: 'Acme Widgets (NASDAQ: ACMW) buys Gamma Lens' });
    assert.equal(none.ticker, null);
  });
  test('injected US lookup: exact normalised, CIK, multiple, prefix, ambiguity', () => {
    assert.equal(resolveEntity({ name: 'Utah Test Medical, Inc.' }, { usLookup: lookup, nseLookup: () => undefined }).ticker, 'UTST');
    const byCik = resolveEntity({ name: 'Some Renamed Filer', cik: '0000706698' }, { usLookup: lookup, nseLookup: () => undefined });
    assert.equal(byCik.ticker, 'UTST'); assert.equal(byCik.basis, 'filing header CIK');
    const multi = resolveEntity({ name: 'Dual Class Holdings Corp' }, { usLookup: lookup, nseLookup: () => undefined });
    assert.equal(multi.state, 'RESOLVED_MULTIPLE'); assert.equal(multi.ticker, null);
    assert.equal(tickerLabelFor(multi), 'Listed - security not identified');
    const pre = resolveEntity({ name: 'Utah Test' }, { usLookup: lookup, nseLookup: () => undefined });
    assert.equal(pre.ticker, 'UTST');
    const amb = resolveEntity({ name: 'Northern Quarry' }, { usLookup: lookup, nseLookup: () => undefined });
    assert.equal(amb.state, 'UNRESOLVED'); assert.equal(amb.ticker, null);
    const one = resolveEntity({ name: 'Utah' }, { usLookup: lookup, nseLookup: () => undefined });
    assert.equal(one.state, 'UNRESOLVED');
  });
  test('funds, regulators, courts, unlisted, groups', () => {
    const f = resolveEntity({ name: 'Alpha Private Credit Fund' });
    assert.equal(f.state, 'NOT_APPLICABLE'); assert.equal(f.entityType, 'FUND'); assert.equal(tickerLabelFor(f), 'Not applicable (fund)');
    assert.equal(resolveEntity({ name: 'Securities Appellate Tribunal' }).entityType, 'COURT');
    assert.equal(resolveEntity({ name: 'Securities and Exchange Commission' }).entityType, 'REGULATOR');
    const u = resolveEntity({ name: 'Omega Retail Pvt Ltd' });
    assert.equal(u.state, 'UNLISTED'); assert.equal(tickerLabelFor(u), 'Unlisted / private');
    assert.equal(tickerLabelFor(resolveEntity({ name: 'Essar Group' })), 'No listed ticker (group)');
  });
  test('alias table mechanism (empty by default)', () => {
    assert.deepEqual(SEC_FILER_ALIASES, {});
    const e = resolveEntity({ name: 'Filer Holdco LLC' }, { usLookup: lookup, nseLookup: () => undefined, aliases: { 'filer holdco': { listedIssuer: 'Utah Test Medical Inc' } } });
    assert.equal(e.ticker, 'UTST'); assert.equal(e.listedIssuer, 'Utah Test Medical Inc'); assert.match(e.basis, /alias/);
    const noSec = resolveEntity({ name: 'Filer Holdco LLC' }, { usLookup: lookup, nseLookup: () => undefined, aliases: { 'filer holdco': { listedIssuer: 'Parent Without Security' } } });
    assert.equal(noSec.state, 'UNRESOLVED'); assert.equal(tickerLabelFor(noSec), 'Listed - security not identified');
  });
  test('labels never say bare "No ticker"', () => {
    const e = resolveEntity({ name: 'Quiet Rivers Ltd' }, { nseLookup: () => undefined });
    assert.equal(tickerLabelFor(e, true), 'Not resolved - listed status unknown');
    assert.equal(tickerLabelFor(e, false), 'Not resolved yet');
    for (const x of ['RESOLVED', 'RESOLVED_MULTIPLE', 'UNLISTED', 'NOT_APPLICABLE', 'UNRESOLVED'] as const) assert.notEqual(tickerLabelFor({ legalEntity: 'x', state: x, basis: '' }), 'No ticker');
  });
  test('a real name in the repo NSE catalog resolves', () => {
    const name = NSE_TICKER_NAMES.CIPLA;
    assert.ok(name);
    const e = resolveEntity({ name });
    assert.equal(e.state, 'RESOLVED'); assert.equal(e.ticker, resolveCompanyToTicker(name)); assert.equal(e.exchange, 'NSE');
  });
  test('SEC payload parsing and the KV loader (injected, cached, defensive)', () => {
    assert.equal(parseSecTickerPayload({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'Foo Inc', 'foo', 'Nasdaq']] })[0].ticker, 'FOO');
    assert.equal(parseSecTickerPayload({ 0: { cik_str: 5, ticker: 'bar', title: 'Bar Corp' } })[0].name, 'Bar Corp');
    assert.deepEqual(parseSecTickerPayload(null), []);
  });
  test('loader caches and survives errors', async () => {
    let calls = 0; let t = 0;
    const load = createSecLookupLoader(async (k) => { calls += 1; if (k === 'a') throw new Error('x'); return { 0: { cik_str: 5, ticker: 'bar', title: 'Bar Corp' } }; }, ['a', 'b'], 1000, () => t);
    const l1 = await load(); assert.equal(l1!.byName('bar').length, 1);
    const c = calls; await load(); assert.equal(calls, c);
    t = 5000; await load(); assert.ok(calls > c);
    const empty = createSecLookupLoader(async () => null, ['z']); assert.equal(await empty(), null);
  });
  test('adapter: ticker only when RESOLVED, with a label', () => {
    const i = eventToRadarInput(ev('Quiet Rivers Ltd to acquire Rapid Streams for Rs 100 crore'));
    assert.equal(i.ticker, null); assert.equal(i.entity!.state, 'UNRESOLVED'); assert.equal(i.tickerLabel, 'Not resolved - listed status unknown');
    const t = eventToRadarInput(ev('Acme Widgets (NASDAQ: ACMW) wins big contract', { region: 'US' }));
    assert.equal(t.ticker, 'ACMW'); assert.equal(t.tickerLabel, 'Ticker: ACMW (Nasdaq)');
    const us = eventToRadarInput(ev('Utah Test Medical, Inc. announces buyback', { region: 'US' }), { entityDeps: { usLookup: buildUsLookup([{ ticker: 'UTST', name: 'Utah Test Medical Inc', exchange: 'Nasdaq' }]), nseLookup: () => undefined } });
    assert.equal(us.ticker, 'UTST'); assert.equal(us.tickerLabel, 'Ticker: UTST (Nasdaq)');
    const f = eventToRadarInput(ev('SC TO-I - Alpha Private Credit Fund (0001111111) (Subject)', { source: 'SEC SC TO-I', link: 'https://www.sec.gov/Archives/edgar/data/1/0001111111-26-000001-index.htm', region: 'US', event_type: 'TENDER_OFFER' }));
    assert.equal(f.ticker, null); assert.equal(f.tickerLabel, 'Not applicable (fund)'); assert.equal(f.excludedFromEquityRadar, true);
    const none = eventToRadarInput(ev('Will rates fall?'));
    assert.notEqual(none.tickerLabel, 'No ticker');
  });
});

describe('D source subject', () => {
  test('acquisition headline', () => {
    const s = deriveSourceSubject({ title: 'Acme Foods to acquire Beta Snacks for Rs 2,410 crore', company: 'Acme Foods' });
    // zzz854: the acquirer is not assumed to own the figures of an acquisition story (old expectation 'Acme Foods' encoded the ITC / Yoga Bar bug)
    assert.equal(s.eventSubject, 'Acme Foods'); assert.equal(s.target, 'Beta Snacks'); assert.equal(s.financialOwner, undefined);
    const t = deriveSourceSubject({ title: 'Acme Foods buys 51% stake in Beta Snacks', company: 'Acme Foods' });
    assert.equal(t.target, 'Beta Snacks');
  });
  test('dividend headline and bet headline', () => {
    const d = deriveSourceSubject({ title: 'Omega Polymers Declares Rs 200/Share Dividend', company: 'Omega Polymers' });
    assert.equal(d.eventSubject, 'Omega Polymers'); assert.equal(d.target, undefined);
    const b = deriveSourceSubject({ title: "Acme's Rs 900 cr Beta Bar bet", company: 'Acme' });
    assert.equal(b.eventSubject, 'Acme'); assert.equal(b.target, 'Beta Bar');
  });
  test('adapter fills it', () => {
    const i = eventToRadarInput(ev('Acme Foods to acquire Beta Snacks for Rs 2,410 crore'));
    assert.equal(i.sourceSubject!.target, 'Beta Snacks');
    assert.equal(i.eventHeadlineKind, 'ACQUISITION');
    assert.ok(i.ownedNumbers!.some((o) => o.metric === 'purchase_price'));
    assert.equal(i.dealTerms!.fields.purchase_price, 'Rs 2,410 crore');
  });
});

describe('E QA report', () => {
  const fund = ev('SC TO-I - Alpha Private Credit Fund (0001111111) (Subject)', { source: 'SEC SC TO-I', link: 'https://www.sec.gov/Archives/edgar/data/1/0001111111-26-000009-index.htm', region: 'US', event_type: 'TENDER_OFFER' });
  const reg = ev('Securities Appellate Tribunal sets aside order against Omega Polymers');
  const ok1 = ev('Acme Foods to acquire Beta Snacks for Rs 2,410 crore');
  const dup = ev('Acme Foods to acquire Beta Snacks for Rs 2,410 crore', { link: 'https://x.test/dup' });
  const raw = [fund, reg, ok1, dup];
  test('structure and counts', () => {
    const split = splitRadarInputs(raw);
    const norm = dedupeFeedEvents(raw).events;
    const qa = buildRadarQa({ rawEvents: raw, normalizedEvents: norm, radarInputs: split.inputs, heldBack: split.heldBackInputs });
    assert.equal(qa.totals.raw, 4); assert.equal(qa.totals.normalised, 3); assert.equal(qa.totals.radar, split.inputs.length); assert.equal(qa.totals.held_back, 1);
    assert.equal(qa.entity_resolution.funds, 1);
    assert.ok(qa.exclusions.every((x) => x.excluded_from_equity_radar === true && x.exclusion_reason && x.entity_type));
    assert.ok(qa.exclusions.some((x) => x.exclusion_reason === 'FUND_REPURCHASE' && x.entity_type === 'FUND'));
    assert.ok(qa.exclusions.some((x) => x.exclusion_reason === 'DUPLICATE'));
    assert.equal(qa.evidence.disproved, 0);
    assert.ok(qa.classification.ACQUISITION >= 1);
    assert.equal('economic' in qa, false);
  });
  test('held-back records stay in the raw list (flags only)', () => {
    assert.equal(raw.length, 4);
    assert.ok(splitRadarInputs(raw).heldBackInputs[0].excludedFromEquityRadar);
  });
});

describe('F EDGAR forms carry no quantified economics', () => {
  const link = (a: string) => `https://www.sec.gov/Archives/edgar/data/9/${a}-index.htm`;
  for (const form of ['SC TO-T', 'SC TO-I', 'SC 13E3', 'SC 14D9']) {
    test(`${form}: numbers are non-earnings and never parent earnings`, () => {
      const i = eventToRadarInput(ev(`${form} - Kappa Systems Inc (0000123456) (Subject)`, { source: `SEC ${form}`, link: link('0000123456-26-000001'), region: 'US', event_type: 'TENDER_OFFER', description: 'Offer at $12.50 per share for 40% of outstanding shares; revenue of $300 million.' }));
      assert.ok(i.nonEarningsNumbers!.some((x) => /12\.50/.test(x)) || form === 'SC 13E3');
      assert.equal(i.ownedNumbers!.some((o) => o.countsAsParentEarnings), false);
      assert.equal((i.description || '').includes('40%') && form === 'SC 13E3', false);
    });
  }
  test('13E3 subject / filed-by dedupe: subject is the company, filer goes to sourceSubject', () => {
    const subj = ev('SC 13E3 - Kappa Systems Inc (0000123456) (Subject)', { source: 'SEC SC 13E3', link: link('0000999999-26-000002'), region: 'US', event_type: 'TENDER_OFFER' });
    const filer = ev('SC 13E3 - Lambda Holdings LP (0000777777) (Filed by)', { source: 'SEC SC 13E3', link: link('0000999999-26-000002'), region: 'US', event_type: 'TENDER_OFFER' });
    const res = splitRadarInputs([filer, subj]);
    const all = [...res.inputs, ...res.heldBackInputs];
    assert.equal(all.length, 1);
    assert.equal(all[0].company, 'Kappa Systems Inc');
    assert.equal(all[0].sourceSubject!.sourceSubject, 'Kappa Systems Inc');
    assert.equal(all[0].sourceSubject!.eventSubject, 'Lambda Holdings LP');
    assert.equal(all[0].sourceSubject!.target, 'Kappa Systems Inc');
    assert.equal(all[0].sourceSubject!.financialOwner, 'Kappa Systems Inc');
  });
});

describe('G corporate action hierarchy', () => {
  test('dividend with a profit fall stays a dividend; profit is a secondary fact', () => {
    const i = eventToRadarInput(ev('Omega Polymers Declares Rs 200/Share Dividend, Despite Fall In Q1 Net Profit', { event_type: 'EARNINGS' }));
    assert.equal(i.eventHeadlineKind, 'DIVIDEND');
    assert.deepEqual(i.secondaryFacts, ['Fall In Q1 Net Profit']);
  });
  test('comma form and plain earnings', () => {
    const a = eventToRadarInput(ev('Omega Polymers Declares Rs 4.25/Share Interim Dividend, Q1 Profit Up 23%'));
    assert.equal(a.eventHeadlineKind, 'DIVIDEND'); assert.deepEqual(a.secondaryFacts, ['Q1 Profit Up 23%']);
    const b = eventToRadarInput(ev('Omega Polymers Q1 net profit rises 23% to Rs 120 crore'));
    assert.equal(b.eventHeadlineKind, 'EARNINGS'); assert.equal(b.secondaryFacts, undefined);
  });
});
