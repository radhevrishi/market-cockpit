// zzz847 - radar engine honours the adapter hints (quarantine, number stripping, subtype routing, bucket, next proof, dedupe, counts).
// Every row is a headline from the owner's live audit, run through the real adapter and then the engine.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseRadarItem, buildRadar, stripNonEarnings } from '../multibagger-radar';
import type { RadarItem } from '../multibagger-radar-types';
import type { RadarFeedEvent } from '../multibagger-radar-feed-types';
import { eventToRadarInput } from '../multibagger-radar-adapter';

let n = 0;
const mk = (title: string, et: string, o: { source?: string; description?: string; tickers?: string[]; filings?: number } = {}): RadarFeedEvent => {
  n += 1;
  const source = o.source || 'ET Industry';
  return {
    event_id: `c${n}`, event_type: et, region: 'IN', tickers: o.tickers,
    primary_filing: { title, source, link: `https://x.test/${n}`, description: o.description, region: 'IN' },
    filings: [{ title, source, link: `https://x.test/${n}` }],
  } as RadarFeedEvent;
};
const radarIn = (title: string, et = 'UNCLASSIFIED', o: Parameters<typeof mk>[2] = {}) => eventToRadarInput(mk(title, et, o));
const CORPUS: Array<[string, string, string, string?]> = [
  ['KPI', 'KPI Green Energy to acquire 507.9 MW operational wind assets in Gujarat for Rs 2,410 crore', 'ACQUISITION'],
  ['HEG', "HEG Share Price Falls 5% Intraday, Down 67% Since Demerger: What's Dragging The Stock?", 'DEMERGER', 'NDTV Profit'],
  ['IHCL-a', "Will IHCL's merger with Oriental Hotels unlock value for shareholders? Here's what Goldman Sachs, Nomura, and others say", 'MERGER', 'ET Stocks'],
  ['IHCL-b', 'IHCL announces merger with Oriental Hotels', 'DEMERGER'],
  ['HONA', 'Honeywell Aerospace (HONA) Spin-Off Unlocks Standalone Value Amid Strong Market Outlook', 'SPIN_OFF', 'Yahoo Finance'],
  ['RPSG', "RPSG Group's renewable-energy arm to acquire Renew Solar Power's portfolio for ₹4,859 crore", 'ACQUISITION', 'BL Companies'],
  ['VEDL-loan', 'Vedanta Aluminium seeks ₹13,500 crore bank loan from HDFC Bank, SBI after group demerger', 'DEMERGER', 'BL Companies'],
  ['AGL', 'Allcargo Global debuts on NSE, BSE following demerger from Allcargo Logistics', 'DEMERGER', 'Livemint'],
  ['JSW-a', 'Shiva Cement to merger with JSW Cement; board approves 5:41 swap ratio', 'DEMERGER'],
  ['JSW-b', 'JSW Cement to merge its listed arm Shiva Cement with itself; board approves 5:41 swap ratio', 'MERGER', 'BL Companies'],
  ['LORDS', "Lord's Mark Industries outlines strategic expansion across global healthcare, advanced diagnostics & oncology; targets ₹1,550 Crore revenue in FY2027", 'DEMERGER'],
  ['TVS', 'TVS Motor may hive off financial services business to unlock value', 'DEMERGER'],
  ['REC', 'REC Declares Rs 4.25/Share Interim Dividend, Q1 Profit Up 23%', 'EARNINGS', 'NDTV Profit'],
  ['NBCC', 'NBCC (India) Q1 Results Today: Time, Interim Dividend, What To Watch, Earnings Call, Share Price Performance', 'EARNINGS', 'NDTV Profit'],
  ['CLSA', 'Vedanta Aluminium share price target: Why Citi, CLSA, Nuvama see up to 20% upside after Q1 earnings', 'EARNINGS', 'ET Stocks'],
  ['F10-a', '10-12G - JLL Property Finance Trust (0002150214) (Filer)', 'SPIN_OFF', 'SEC Form 10-12G'],
  ['F10-b', '10-12G/A - B-Scada, Inc.', 'SPIN_OFF', 'SEC Form 10-12G'],
  ['F10-c', '10-12G - G-Private Equity LP', 'SPIN_OFF', 'SEC Form 10-12G'],
  ['ITC', "From cigarettes to protein bars: ITC's ₹900 cr Yoga Bar bet as FMCG giant taps India's health-food boom", 'MERGER', 'Livemint'],
  ['TATA', 'Tata Sons merger proposal faces questions from Tata Trusts trustees: Report', 'MERGER', 'Livemint'],
  ['ZEEL', 'Zee Entertainment allots 20.94 crore warrants to promoter entity Sunbright Mauritius at ₹126 each', 'OTHER', 'Livemint'],
  ['SAT', 'Zee Entertainment shares rally 8% after SAT grants interim relief in Sebi order', 'OTHER', 'ET Stocks'],
  ['SAMSUNG', 'Samsung works to draw iPhone users to its foldables even as Apple enters the market', 'NEW_PRODUCT', 'CNBC'],
  ['JCM', '8th Pay Commission: NC-JCM Staff Side General Secy Denies Rumours Of Stopping Pension To Retirees', 'CAPACITY', 'NDTV Profit'],
  ['DIV800', '800% dividend stock: This Blackstone-backed IT share zooms 14% after fixing record date; check amount per share', 'OTHER', 'Livemint'],
];

const an = (k: string): RadarItem => { const row = CORPUS.find((c) => c[0] === k)!; return analyseRadarItem(radarIn(row[1], row[2], { source: row[3] })); };
// the quoted headline (event, priorityReason) is excluded: it legitimately echoes the source. Evidence fields must be clean.
const allText = (r: RadarItem) => JSON.stringify([r.financialImpact, r.proof, r.whyItMatters, r.evidenceScope, r.impacts, (r.catalystChain || []).filter((l) => l.link !== 'EVENT').map((l) => l.evidence)]);

describe('1 quarantine', () => {
  const Q: Array<[string, string, string, RegExp]> = [
    ['HEG', 'NOISE', 'PRICE_MOVE', /price/i], ['IHCL-a', 'NOISE', 'ANALYST_CHANGE', /analyst/i], ['CLSA', 'NOISE', 'ANALYST_CHANGE', /analyst/i],
    ['NBCC', 'NOISE', 'OTHER', /preview|not out yet/i], ['F10-a', 'NOISE', 'OTHER', /Registration \(Form 10\)/], ['F10-b', 'NOISE', 'OTHER', /Registration \(Form 10\)/],
    ['F10-c', 'NOISE', 'OTHER', /Registration \(Form 10\)/], ['JCM', 'NOISE', 'OTHER', /not a company/i], ['SAT', 'NOISE', 'PRICE_MOVE', /price/i],
  ];
  for (const [k, bucket, kind, why] of Q) {
    test(`${k}: ${bucket} / ${kind}, excluded, low signal, not ledger eligible, one-line proof`, () => {
      const r = an(k);
      assert.equal(r.bucket, bucket); assert.equal(r.kind, kind);
      assert.equal(r.priority, 'EXCLUDE'); assert.equal(r.lowSignal, true); assert.equal(r.ledgerEligible, false);
      assert.ok(r.falsePositiveReason, 'falsePositiveReason set'); assert.ok(r.quarantineReason, 'quarantineReason set');
      assert.match(r.priorityReason + r.mechanism, why);
      assert.ok(r.proof.what.length < 200 && !/\n/.test(r.proof.what));
      assert.equal(r.changes.length, 0);
      assert.ok((r.catalystChain || []).slice(1).every((l) => l.status === 'NOT_APPLICABLE'), 'no chain detail beyond the event line');
      assert.equal(r.upgradeTrigger ?? null, null);
    });
  }
  test('a Form 10 registration is never a spin-off', () => {
    for (const k of ['F10-a', 'F10-b', 'F10-c']) { const r = an(k); assert.notEqual(r.subKind, 'SPIN_DEMERGER'); assert.notEqual(r.bucket, 'SPECIAL_SITUATION'); assert.equal(r.falsePositiveReason, 'WRONG_CLASSIFICATION'); }
  });
  test('a genuine SpinCo registration is not quarantined as a registration', () => {
    const r = analyseRadarItem(radarIn('10-12B - Archer SpinCo, Inc.', 'SPIN_OFF', { source: 'SEC Form 10-12B', description: 'distribution of shares of Archer to its stockholders' }));
    assert.equal(r.quarantineReason ?? null, null);
  });
  test('an item with no identifiable company is quarantined; a named one is not', () => {
    const r = analyseRadarItem({ id: 'u1', ticker: null, company: 'Not identified', region: 'IN', title: 'Something happens', eventType: 'OTHER' });
    assert.equal(r.quarantineReason, 'UNIDENTIFIED'); assert.equal(r.priority, 'EXCLUDE');
    assert.equal(analyseRadarItem({ id: 'u2', ticker: null, company: 'Unnamed company', region: 'IN', title: 'Acme wins a Rs 100 crore order' }).quarantineReason ?? null, null);
  });
});

describe('2 non-earnings numbers never reach earnings evidence', () => {
  test('REC: the dividend per share is gone, the profit growth stays an earnings fact', () => {
    const r = an('REC');
    assert.doesNotMatch(allText(r), /4\.25/);
    // zzz852: a dividend headline is the primary corporate action; the profit figure is secondary context
    assert.equal(r.kind, 'CORPORATE_ACTION'); assert.match(r.secondaryEvent?.text || '', /23%/); assert.equal(r.catalystDirection, 'positive');
  });
  test('HEG: 5% and 67% are price numbers', () => { const t = allText(an('HEG')); assert.doesNotMatch(t, /\b67%|\b5%/); });
  test('SAT: 8% is a price move', () => assert.doesNotMatch(allText(an('SAT')), /\b8%/));
  test('ZEEL: the warrant price is not evidence', () => { const r = an('ZEEL'); assert.doesNotMatch(r.financialImpact, /126/); assert.equal(r.kind, 'CAPITAL_RAISE'); assert.equal(r.link, 'NOT_APPLICABLE'); });
  test('Satin: issue price and stake percent are stripped; nothing else stated gives "Not quantified"', () => {
    const r = analyseRadarItem(radarIn('Satin Creditcare allots 1.2 crore warrants to promoter at Rs 260 per share; promoter stake to 38.32%', 'OTHER', { source: 'Livemint' }));
    assert.doesNotMatch(allText(r), /\b260\b|38\.32/);
    assert.match(r.financialImpact, /Not (?:quantified|established)/);
  });
  test('stripNonEarnings keeps a percent that follows an earnings word and drops a stake percent', () => {
    assert.equal(stripNonEarnings('Profit up 23% and stake at 38.32%', ['23%', '38.32%']), 'Profit up 23% and stake at');
  });
});

describe('3 subtype routing', () => {
  test('IHCL merger is a merger, never a demerger; the next proof has approvals, swap terms and combined results', () => {
    const r = an('IHCL-b');
    assert.equal(r.kind, 'SPECIAL_SITUATION'); assert.equal(r.subKind, 'MERGER');
    assert.match(r.proof.what, /NCLT|shareholder/); assert.match(r.proof.what, /swap/i); assert.match(r.proof.what, /combined results/i);
    assert.doesNotMatch(r.proof.what, /record date|listing of (?:the )?separated/i);
  });
  test('JSW / Shiva cement is a merger in both wordings', () => {
    for (const k of ['JSW-a', 'JSW-b']) { const r = an(k); assert.equal(r.subKind, 'MERGER'); assert.doesNotMatch(r.proof.what, /record date/i); }
  });
  test('Vedanta bank loan is financing, not a special situation; the next proof is the use of funds', () => {
    const r = an('VEDL-loan');
    assert.equal(r.kind, 'FINANCING'); assert.equal(r.eventClass, 'CAPITAL_STRUCTURE_FUNDING'); assert.notEqual(r.bucket, 'SPECIAL_SITUATION');
    assert.equal(r.link, 'NOT_APPLICABLE'); assert.match(r.proof.what, /use of proceeds/i); assert.equal(r.subKind, null);
  });
  test("Lord's Mark is a management plan with a target, not a spin-off", () => {
    const r = an('LORDS');
    assert.equal(r.kind, 'NEW_PRODUCT_MARKET'); assert.notEqual(r.subKind, 'SPIN_DEMERGER'); assert.notEqual(r.bucket, 'SPECIAL_SITUATION'); assert.notEqual(r.bucket, 'EARNINGS_INFLECTION');
    assert.match(r.proof.what, /management target/i); assert.match(r.proof.what, /reported revenue/i); assert.doesNotMatch(r.proof.what, /record date|separated/i);
    assert.match(r.financialImpact, /management target/i);
    assert.ok(['INDIRECT', 'NEAR_DIRECT'].includes(r.link));
    assert.notEqual(r.evidence.status, 'CONFIRMED');
  });
  test('Allcargo: the listing is done, so the next proof is separate reporting, never a record date', () => {
    const r = an('AGL');
    assert.equal(r.subKind, 'SPIN_DEMERGER'); assert.ok(['VALIDATED', 'DEVELOPING'].includes(String(r.catalystMaturity)), String(r.catalystMaturity));
    assert.doesNotMatch(r.proof.what, /record date/i); assert.match(r.proof.what, /separate (?:results|reporting)/i);
  });
  test('ITC Yoga Bar is a new product / market', () => { const r = an('ITC'); assert.equal(r.kind, 'NEW_PRODUCT_MARKET'); assert.notEqual(r.bucket, 'EARNINGS_INFLECTION'); });
  test('tentative wording caps the evidence and says proposed, not approved (TVS hive-off, Tata Sons)', () => {
    for (const k of ['TVS', 'TATA']) {
      const r = an(k);
      assert.ok(['HYPOTHESIS', 'DEVELOPING'].includes(r.evidence.status), `${k} ${r.evidence.status}`);
      assert.ok((r.evidenceScope?.notConfirmed || []).some((x) => /proposed, not approved/i.test(x)), k);
      assert.equal(r.ledgerEligible, false);
      assert.match(r.proof.what, /proposed, not approved/i);
    }
  });
  test('a spin-off keeps the spin proof', () => assert.match(an('HONA').proof.what, /record date|listing/i));
});

describe('4 bucket assignment', () => {
  test('acquisitions, mergers and spin-offs land in Special situations, never Earnings inflection', () => {
    for (const k of ['KPI', 'IHCL-b', 'HONA', 'RPSG', 'TVS', 'JSW-a', 'JSW-b', 'TATA', 'AGL']) assert.equal(an(k).bucket, 'SPECIAL_SITUATION', k);
  });
  test('no corpus row other than a measured result is an Earnings inflection', () => {
    for (const row of CORPUS) { const b = an(row[0]).bucket; if (row[0] !== 'REC') assert.notEqual(b, 'EARNINGS_INFLECTION', row[0]); }
  });
  // zzz852: REC leads with a dividend, so it is a corporate action with the profit as context
  test('REC, a dividend headline with a profit figure, is a corporate action', () => assert.equal(an('REC').bucket, 'CORPORATE_ACTION'));
  test('Samsung (media, no deal, no result) is not a thesis bucket', () => { const r = an('SAMSUNG'); assert.ok(['EVENT_DRIVEN', 'NOISE'].includes(r.bucket)); assert.notEqual(r.priority, 'HIGH'); });
});

describe('5 next proof text', () => {
  test('no feed boilerplate and no truncated timing anywhere in the corpus', () => {
    for (const row of CORPUS) {
      const r = an(row[0]);
      assert.doesNotMatch(r.proof.what, /Feed watch item|Definitive filing/i, row[0]);
      assert.ok(r.proof.when == null || !/^FY20$|^FY\d$|^Q\d FY\d$/.test(r.proof.when), `${row[0]} when=${r.proof.when}`);
    }
  });
  test('the feed what_to_watch text is not appended', () => {
    const inp = { ...radarIn('Acme Ltd wins Rs 90 crore order', 'ORDER'), feedFacts: { what_to_watch: 'Definitive filing · named ticker · timeline' } };
    assert.doesNotMatch(analyseRadarItem(inp).proof.what, /Feed watch|Definitive filing/);
  });
  test('timing is parsed whole: FY2027, FY26, Q2 FY27 and is omitted when absent', () => {
    const w = (t: string) => analyseRadarItem({ id: 't', ticker: 'ACME', company: 'Acme', region: 'IN', title: t, sourceLabel: 'NSE' }).proof.when;
    const t = (when: string) => `Acme adds a new 2 MTPA capacity line against a customer contract${when}`;
    assert.equal(w(t(', commissioning in FY2027')), 'FY2027');
    assert.equal(w(t(', commissioning by FY26')), 'FY26');
    assert.equal(w(t(', commissioning by Q2 FY27')), 'Q2 FY27');
    assert.equal(w(t('')), null);
  });
  test("Lord's Mark timing is FY2027, not FY20", () => assert.equal(an('LORDS').proof.when, 'FY2027'));
});

describe('6 duplicates and 7 counts', () => {
  const ev = (title: string, et: string, source: string, id: string): RadarFeedEvent => ({ event_id: id, event_type: et, region: 'IN', primary_filing: { title, source, link: `https://${source.replace(/\W/g, '')}.test/${id}`, region: 'IN' }, filings: [{ title, source, link: `https://${source.replace(/\W/g, '')}.test/${id}` }] } as RadarFeedEvent);
  const JA = 'Shiva Cement to merger with JSW Cement; board approves 5:41 swap ratio';
  const JB = 'JSW Cement to merge its listed arm Shiva Cement with itself; board approves 5:41 swap ratio';
  test('the same merger from two outlets with the same swap ratio is one card with two distinct sources', () => {
    const r = buildRadar([radarIn(JA, 'DEMERGER'), { ...radarIn(JB, 'MERGER', { source: 'BL Companies' }) }]);
    const deals = r.items.filter((i) => i.bucket === 'SPECIAL_SITUATION');
    assert.equal(deals.length, 1); assert.equal(r.counts.duplicatesMerged, 1);
    assert.equal(deals[0].evidence.sourceCount, 2);
  });
  test('two copies from one publisher family count once', () => {
    const a = eventToRadarInput(ev(JA, 'DEMERGER', 'ET Industry', 'a1')), b = eventToRadarInput(ev(JB, 'MERGER', 'ET Stocks', 'a2'));
    const r = buildRadar([a, b]);
    assert.equal(r.items.length, 1); assert.equal(r.items[0].evidence.sourceCount, 1); assert.equal(r.items[0].evidence.independentSources, 1);
  });
  test('different deals with different numbers are not merged', () => {
    const r = buildRadar([radarIn(JA, 'MERGER'), radarIn('JSW Cement to merge Shiva Cement; board approves 9:10 swap ratio', 'MERGER', { source: 'BL Companies' })]);
    assert.equal(r.items.length, 2);
  });
  test('quarantined items are not in the Special situations count and are reported separately', () => {
    const inputs = [...CORPUS.filter((c) => c[0].startsWith('F10')), ...CORPUS.filter((c) => ['KPI', 'HONA', 'HEG', 'NBCC', 'CLSA', 'JCM'].includes(c[0]))].map((c) => radarIn(c[1], c[2], { source: c[3] }));
    const r = buildRadar(inputs);
    assert.equal(r.counts.byBucket.SPECIAL_SITUATION, 2); assert.equal(r.counts.specialSituations, 2);
    assert.equal(r.counts.quarantined, 7);
    assert.equal(r.counts.quarantineByReason?.REGISTRATION, 3);
    assert.equal(r.byBucket.SPECIAL_SITUATION.some((i) => i.quarantineReason), false);
  });
});

describe('8 identity display', () => {
  test('a headline fragment is never the company name', () => {
    assert.equal(an('REC').company, 'REC');
    for (const row of CORPUS) { const r = an(row[0]); assert.ok(!/\b(?:declares|announces|works|allots|outlines)\b/i.test(r.company), `${row[0]}: ${r.company}`); assert.ok(r.company.length <= 60, row[0]); }
  });
  test('ticker stays null when unresolved (the UI shows "No ticker")', () => { assert.equal(an('VEDL-loan').ticker, null); assert.equal(an('JCM').ticker, null); assert.equal(an('SAMSUNG').ticker, null); });
});

describe('9 hard rules on the new paths', () => {
  test('no buy / sell language and no price input in any corpus item', () => {
    for (const row of CORPUS) assert.doesNotMatch(allText(an(row[0])), /\b(?:buy|sell) (?:rating|call|now)\b|target price|\bBUY\b|\bSELL\b/, row[0]);
  });
  test('unknown is not negative: a plan or proposal is never DISPROVED', () => { for (const k of ['LORDS', 'TVS', 'TATA']) assert.notEqual(an(k).evidence.status, 'DISPROVED'); });
  test('inputs without hints behave as before', () => {
    const r = analyseRadarItem({ id: 'x', ticker: 'ACME', company: 'Acme', region: 'IN', title: 'Acme wins a $40 million order from a global OEM', sourceLabel: 'NSE' });
    assert.equal(r.quarantineReason ?? null, null); assert.notEqual(r.bucket, 'NOISE');
  });
});
