// zzz847 - feed / adapter audit from the owner's live Radar output. Headlines are from the corpus.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eventToRadarInput, eventsToRadarInputs, dedupeFeedEvents, companyFromTitle } from '../multibagger-radar-adapter';
import type { RadarFeedEvent } from '../multibagger-radar-feed-types';
import {
  decodeHtmlEntities, parseSecFilingTitle, classifyForm10, contentHints, subtypeHint, identifySubject, extractSubjectTickers, countCanonicalEventTypes, createEventClusterer,
} from '../special-sit-feed-quality';
import { extractEventSignals } from '../news/event-intelligence';

let n = 0;
const ev = (title: string, o: Partial<RadarFeedEvent> & { source?: string; link?: string; description?: string; tickers?: string[] } = {}): RadarFeedEvent => {
  n += 1;
  const { source = 'ET Industry', link = `https://x.test/${n}`, description, tickers, ...rest } = o;
  return {
    event_id: `e${n}`, event_type: 'UNCLASSIFIED', region: 'IN', tickers,
    primary_filing: { title, source, link, description, tickers, region: 'IN' },
    filings: [{ title, source, link }], ...rest,
  } as RadarFeedEvent;
};
const inp = (title: string, o: Parameters<typeof ev>[1] = {}) => eventToRadarInput(ev(title, o));

describe('1 bogus tickers', () => {
  const cases: Array<[string, string | null, RegExp?]> = [
    ['Zee Entertainment shares rally 8% after SAT grants interim relief in Sebi order', null],
    ['8th Pay Commission: NC-JCM Staff Side General Secy Denies Rumours Of Stopping Pension To Retirees', null],
    ['Nerdy announces 1-for-15 reverse split on NYSE', null],
    ['North West Company raises dividend by 4% to CAD 0.42', null],
    ['Maharatna PSU stock Power Finance Corporation declares dividend', null],
    ['Angel One Q1 Results: date 4 PM IST, dividend', null],
    ['Vedanta Aluminium share price target: Why Citi, CLSA, Nuvama see up to 20% upside after Q1 earnings', null],
    ['Vedanta Aluminium seeks ₹13,500 crore bank loan from HDFC Bank, SBI after group demerger', null],
    ["Lord's Mark Industries outlines strategic expansion across global healthcare; targets ₹1,550 Crore revenue in FY2027", null],
    ['JSW Dulux Stock Split: Check ratio, record date and other details', null],
    ['JSW Cement to merge its listed arm Shiva Cement with itself; board approves 5:41 swap ratio', null],
    ['Samsung works to draw iPhone users to its foldables even as Apple enters the market', null],
    ['Tata Sons merger proposal faces questions from Tata Trusts trustees: Report', null],
  ];
  for (const [h, t] of cases) test(`no ticker: ${h.slice(0, 60)}`, () => { assert.equal(inp(h).ticker, t); });
  test('feed tickers that are denylisted acronyms are dropped by the extractor', () => {
    for (const h of ['Zee rallies after SAT relief', 'Nerdy reverse split NYSE', 'Nestle India CMD', 'Angel One Q1 Results IST', 'Vedanta loan HDFC CLSA']) {
      const t = extractSubjectTickers(h, '', 'ET Stocks', 'https://x');
      for (const bad of ['SAT', 'NYSE', 'CMD', 'IST', 'HDFC', 'CLSA']) assert.ok(!t.includes(bad), `${bad} in ${h}`);
    }
  });
  test('CMD is a designation: the subject (Nestle India) resolves from the master, never CMD', () => {
    assert.equal(inp('Nestle India CMD says growth to stay strong').ticker, 'NESTLEIND');
  });
  test('subject-position tickers that are legitimate are kept', () => {
    assert.equal(inp('HEG Share Price Falls 5% Intraday, Down 67% Since Demerger: What\'s Dragging The Stock?').ticker, 'HEG');
    assert.equal(inp('REC Declares Rs 4.25/Share Interim Dividend, Q1 Profit Up 23%').ticker, 'REC');
    assert.equal(inp("IHCL announces merger with Oriental Hotels").ticker, 'IHCL');
    assert.equal(inp('Honeywell Aerospace (HONA) Spin-Off Unlocks Standalone Value Amid Strong Market Outlook', { source: 'Yahoo Finance' }).ticker, 'HONA');
    assert.equal(inp('From cigarettes to protein bars: ITC’s ₹900 cr Yoga Bar bet as FMCG giant taps health-food boom').ticker, 'ITC');
    assert.equal(inp('TCS Q2 Results: Date, Time, Dividend News, Record Date Details And More').ticker, 'TCS');
  });
  test('structured feed ticker wins when the headline has none', () => {
    assert.equal(inp('Acme Corp wins a large export order', { tickers: ['ACME'] }).ticker, 'ACME');
  });
  test('feed ticker that is a denylisted word is ignored', () => {
    assert.equal(inp('Vedanta Aluminium seeks bank loan', { tickers: ['HDFC'] }).ticker, null);
  });
});

describe('1b company names are subject phrases, never headline slices', () => {
  const cases: Array<[string, string]> = [
    ['Samsung works to draw iPhone users to its foldables even as Apple enters the market', 'Samsung'],
    ['Tata Sons merger proposal faces questions from Tata Trusts trustees: Report', 'Tata Sons'],
    ['Satin Creditcare Network board approves fund raise', 'Satin Creditcare Network'],
    ['800% dividend stock: This Blackstone-backed IT share zooms 14% after fixing record date', 'Not identified'],
    ['Dividend, stock split record date alert: Last chance to buy today - Noble Polymers, Naturite Agro, Midwest Energy, more', 'Not identified'],
    ['Vedanta Aluminium seeks ₹13,500 crore bank loan after group demerger', 'Vedanta Aluminium'],
    ["Lord's Mark Industries outlines strategic expansion", "Lord's Mark Industries"],
    ['KPI Green Energy to acquire 507.9 MW operational wind assets in Gujarat for Rs 2,410 crore', 'KPI Green Energy'],
  ];
  for (const [h, want] of cases) test(want + ' <- ' + h.slice(0, 40), () => {
    assert.equal(inp(h).company, want);
    assert.equal(companyFromTitle(h), want);
    assert.ok(inp(h).company.length <= 40);
  });
});

describe('2 SEC Form 10 registrations', () => {
  test('company name parsing keeps B-/G- prefixes and strips only the form', () => {
    assert.equal(parseSecFilingTitle('10-12G/A - B-Scada, Inc. (0001341878) (Filer)')?.company, 'B-Scada, Inc.');
    assert.equal(parseSecFilingTitle('10-12G - G-INFRA LP (0001999999) (Filer)')?.company, 'G-INFRA LP');
    assert.equal(parseSecFilingTitle('10-12G - G-Private Equity LP (0001999999) (Filer)')?.company, 'G-Private Equity LP');
    assert.equal(parseSecFilingTitle('10-12G - JLL Property Finance Trust (0002150214) (Filer)')?.company, 'JLL Property Finance Trust');
    assert.equal(parseSecFilingTitle('10-12B - Archer SpinCo, Inc. (0001) (Filer)')?.company, 'Archer SpinCo, Inc.');
    assert.equal(extractEventSignals({ title: '10-12G/A - B-Scada, Inc. (0001341878) (Filer)' }).target_name, 'B-Scada, Inc.');
  });
  const regs = [
    '10-12G - JLL Property Finance Trust (0002150214) (Filer)', '10-12G/A - B-Scada, Inc. (0001341878) (Filer)', '10-12G - Leach John Peter (0001111111) (Filer)',
    '10-12G - BIOMOLECULAR LIFE HOLDINGS (0002222222) (Filer)', '10-12G - G-INFRA LP (0003333333) (Filer)', '10-12G - G-Private Equity LP (0004444444) (Filer)',
    '10-12G - Broad Capital Acquisition Corp (0005555555) (Filer)', '10-12G - Fidelity Private Credit Co II LLC (0006666666) (Filer)',
  ];
  for (const t of regs) test(`registration: ${t.slice(0, 50)}`, () => {
    assert.equal(classifyForm10(t), 'REGISTRATION');
    assert.equal(extractEventSignals({ title: t }).event_type, 'FORM10_REGISTRATION');
    const i = inp(t, { source: 'SEC Form 10-12G', link: 'https://www.sec.gov/x', event_type: 'SPIN_OFF', category: 'SPIN', tier: 'TIER_1', tickers: ['BEAUTY', 'INFRA', 'TECH', 'LIFE', 'JLL'] }) as any;
    assert.equal(i.ticker, null);
    assert.equal(i.isRegistration, true);
    assert.equal(i.eventType, 'FORM10_REGISTRATION');
    assert.equal(i.category, undefined);
    assert.equal(i.feedTier, 'NOISE');
    assert.notEqual(i.subtypeHint, 'SPIN');
  });
  test('real SpinCo filings stay spin-offs', () => {
    for (const t of ['10-12B - Archer SpinCo, Inc. (0001) (Filer)', '10-12B - MSGS Spinco, Inc. (0002) (Filer)']) {
      assert.equal(classifyForm10(t), 'SPIN');
      assert.equal(extractEventSignals({ title: t }).event_type, 'SPIN_OFF');
    }
    assert.equal(classifyForm10('10-12B - Mobility Global Inc. (0003) (Filer)', 'Information statement: distribution of all shares of common stock of the company to parent stockholders'), 'SPIN');
  });
  test('company names in the radar input come from the filing title', () => {
    assert.equal(inp('10-12G/A - B-Scada, Inc. (0001341878) (Filer)', { source: 'SEC Form 10-12G', target_name: 'Scada, Inc.' }).company, 'B-Scada, Inc.');
    assert.equal(inp('10-12G - G-INFRA LP (0003333333) (Filer)', { source: 'SEC Form 10-12G', target_name: 'INFRA LP' }).company, 'G-INFRA LP');
  });
});

describe('3 HTML entities', () => {
  test('numeric, hex and named entities decode', () => {
    assert.equal(decodeHtmlEntities('PLDT dividend &#x20B1;46.00'), 'PLDT dividend ₱46.00');
    assert.equal(decodeHtmlEntities('Rs &#8377;13,500 crore'), 'Rs ₹13,500 crore');
    assert.equal(decodeHtmlEntities('M&amp;A and Q&amp;A'), 'M&A and Q&A');
    assert.equal(decodeHtmlEntities('&amp;#8377;5'), '₹5');
    assert.equal(decodeHtmlEntities('plain'), 'plain');
  });
  test('adapter decodes title and description', () => {
    const i = inp('PLDT declares dividend of &#x20B1;46.00 per share', { description: 'Payout &amp; record date' });
    assert.match(i.title, /₱46\.00/);
    assert.ok(!/&#|&amp;/.test(i.title));
    assert.equal(i.description, 'Payout & record date');
  });
});

describe('4 price / preview / analyst / opinion hints', () => {
  const t = (h: string) => contentHints(h);
  test('HEG price article', () => {
    const i = inp("HEG Share Price Falls 5% Intraday, Down 67% Since Demerger: What's Dragging The Stock?", { source: 'NDTV Profit', event_type: 'DEMERGER_INDIA', category: 'SPIN', tier: 'TIER_1' }) as any;
    assert.equal(i.isPriceArticle, true);
    assert.equal(i.category, undefined);
    assert.equal(i.feedTier, 'NOISE');
    assert.ok(i.nonEarningsNumbers.some((x: string) => /5%/.test(x)) && i.nonEarningsNumbers.some((x: string) => /67%/.test(x)));
  });
  test('NBCC / TCS results previews', () => {
    assert.equal(t('NBCC (India) Q1 Results Today: Time, Interim Dividend, What To Watch, Earnings Call, Share Price Performance').isPreview, true);
    assert.equal(t('TCS Q2 Results: Date, Time, Dividend News, Record Date Details And More').isPreview, true);
    assert.equal(t('Dividend, stock split record date alert: Last chance to buy today').isPreview, true);
  });
  test('analyst target', () => {
    const h = t('Vedanta Aluminium share price target: Why Citi, CLSA, Nuvama see up to 20% upside after Q1 earnings');
    assert.equal(h.isAnalystTarget, true);
    assert.equal(h.isPriceArticle, false);
    assert.equal(inp('Vedanta Aluminium share price target: Why Citi, CLSA see 20% upside').eventType, 'ANALYST_TARGET');
  });
  test('opinion and stock split watch', () => {
    assert.equal(t('Prediction: Nvidia will be the largest company by 2030').isOpinion, true);
    assert.equal(t("Will IHCL's merger with Oriental Hotels unlock value for shareholders? Here's what Goldman Sachs, Nomura, and others say").isOpinion || t("Will IHCL's merger with Oriental Hotels unlock value for shareholders? Here's what Goldman Sachs, Nomura, and others say").isAnalystTarget, true);
    assert.equal(t('JSW Dulux Stock Split Watch: ratio and record date').isPreview, true);
  });
  test('real events are not flagged', () => {
    for (const h of ['IHCL announces merger with Oriental Hotels', 'KPI Green Energy to acquire 507.9 MW operational wind assets in Gujarat for Rs 2,410 crore', 'Zee Entertainment allots 20.94 crore warrants to promoter entity Sunbright Mauritius at ₹126 each', 'TVS Motor may hive off financial services business to unlock value']) {
      const x = t(h);
      assert.ok(!x.isPriceArticle && !x.isPreview && !x.isAnalystTarget && !x.isOpinion, h);
    }
  });
  test('dividend and percent figures are flagged as non-earnings numbers (REC)', () => {
    const i = inp('REC Declares Rs 4.25/Share Interim Dividend, Q1 Profit Up 23%') as any;
    assert.ok(i.nonEarningsNumbers.some((x: string) => /4\.25/.test(x)));
    assert.ok(i.nonEarningsNumbers.some((x: string) => /23%/.test(x)));
  });
  test('pay commission news is non-corporate', () => {
    const i = inp('8th Pay Commission: NC-JCM Staff Side General Secy Denies Rumours Of Stopping Pension To Retirees', { source: 'NDTV Profit' }) as any;
    assert.equal(i.isNonCorporate, true);
    assert.equal(i.ticker, null);
  });
});

describe('5 merger vs demerger subtype', () => {
  test('merger wording', () => {
    for (const h of ['IHCL announces merger with Oriental Hotels', 'Shiva Cement to merger with JSW Cement; board approves 5:41 swap ratio', 'Board approves amalgamation of X with Y']) assert.equal(subtypeHint(h), 'MERGER', h);
  });
  test('spin wording', () => {
    for (const h of ['TVS Motor may hive off financial services business to unlock value', 'Honeywell Aerospace (HONA) Spin-Off Unlocks Standalone Value', 'Company X to demerge its realty arm']) assert.equal(subtypeHint(h), 'SPIN', h);
  });
  test('financing, plan, listing-done, new product', () => {
    assert.equal(subtypeHint('Vedanta Aluminium seeks ₹13,500 crore bank loan after group demerger'), 'FINANCING');
    assert.equal(subtypeHint("Lord's Mark Industries outlines strategic expansion across global healthcare; targets ₹1,550 Crore revenue in FY2027"), 'GUIDANCE_PLAN');
    assert.equal(subtypeHint('Allcargo Global debuts on NSE, BSE following demerger from Allcargo Logistics'), 'LISTING_DONE');
    // zzz854: a '<money> <Company> bet' is an investment in a named company (stake / acquisition), not a new product (old expectation encoded the bug)
    assert.equal(subtypeHint("From cigarettes to protein bars: ITC's ₹900 cr Yoga Bar bet as FMCG giant taps India's health-food boom"), null);
  });
  test('adapter re-types a merger that the feed marked as spin-off', () => {
    const i = inp('IHCL announces merger with Oriental Hotels', { event_type: 'DEMERGER_INDIA', category: 'SPIN' }) as any;
    assert.equal(i.eventType, 'MERGER_DEFINITIVE');
    assert.equal(i.category, 'MA');
    assert.equal(i.subtypeHint, 'MERGER');
    const j = inp('Vedanta Aluminium seeks ₹13,500 crore bank loan after group demerger', { event_type: 'DEMERGER_INDIA', category: 'SPIN' }) as any;
    assert.equal(j.eventType, 'FINANCING_LOAN');
    assert.equal(j.category, undefined);
    const k = inp("Lord's Mark Industries outlines strategic expansion; targets ₹1,550 Crore revenue in FY2027", { event_type: 'SPIN_OFF', category: 'SPIN' }) as any;
    assert.equal(k.eventType, 'GUIDANCE_PLAN');
  });
  test('the feed classifier no longer calls a merger a demerger', () => {
    assert.equal(extractEventSignals({ title: 'IHCL announces merger with Oriental Hotels' }).event_type, 'MERGER_DEFINITIVE');
    assert.equal(extractEventSignals({ title: 'Shiva Cement to merger with JSW Cement; board approves 5:41 swap ratio' }).event_type, 'MERGER_DEFINITIVE');
    assert.equal(extractEventSignals({ title: 'TVS Motor may hive off financial services business' }).event_type, 'DEMERGER_INDIA');
    assert.equal(extractEventSignals({ title: 'Tata Sons merger proposal faces questions from Tata Trusts trustees: Report' }).event_type, 'NEWS_RUMOR');
  });
});

describe('6 dedupe', () => {
  test('IHCL merger: analyst piece and announcement are one card', () => {
    const a = ev("Will IHCL's merger with Oriental Hotels unlock value for shareholders? Here's what Goldman Sachs, Nomura, and others say", { source: 'ET Stocks', event_type: 'MERGER_DEFINITIVE' });
    const b = ev('IHCL announces merger with Oriental Hotels', { source: 'ET Industry', event_type: 'DEMERGER_INDIA' });
    const r = eventsToRadarInputs([a, b]);
    assert.equal(r.length, 1);
    assert.match(r[0].title, /announces merger/);
  });
  test('JSW Cement / Shiva Cement 5:41: ET and BL cards merge; sources counted once per publisher family', () => {
    const a = ev('Shiva Cement to merger with JSW Cement; board approves 5:41 swap ratio', { source: 'ET Industry', event_type: 'DEMERGER_INDIA', category: 'SPIN' });
    const b = ev('JSW Cement to merge its listed arm Shiva Cement with itself; board approves 5:41 swap ratio', { source: 'BL Companies', event_type: 'MERGER_DEFINITIVE', category: 'MA' });
    const { events, merged } = dedupeFeedEvents([a, b]);
    assert.equal(events.length, 1);
    assert.equal(merged, 1);
    assert.equal(events[0].filings?.length, 2);
    const r = eventsToRadarInputs([a, b]);
    assert.equal(r.length, 1);
    assert.equal(r[0].eventType, 'MERGER_DEFINITIVE');
    // zzz854: two outlets reporting the same board approval with the same 5:41 ratio are ONE information origin
    // (was 2 = outlet count, which is the bug). Both copies are still listed.
    assert.equal(r[0].independentSources, 1);
    assert.equal(r[0].sourceOrigins!.sourceCount, 2);
  });
  test('28 syndicated copies from one publisher count as one independent source', () => {
    const e = ev('Tata Sons merger proposal faces questions from Tata Trusts trustees: Report', { source: 'Livemint Companies' });
    e.filings = Array.from({ length: 28 }, (_, i) => ({ title: `Tata Sons merger proposal faces questions from Tata Trusts trustees: Report ${i}`, source: i % 2 ? 'Livemint Companies' : 'Livemint Markets', link: `https://m/${i}` }));
    assert.equal(eventToRadarInput(e).independentSources, 1);
  });
  test('different deals are not merged', () => {
    const a = ev('IHCL announces merger with Oriental Hotels');
    const b = ev('Mahindra Logistics announces merger with Rivigo');
    assert.equal(eventsToRadarInputs([a, b]).length, 2);
  });
  test('Form 10 registrations never merge into each other', () => {
    const a = ev('10-12G - G-INFRA LP (0003) (Filer)', { source: 'SEC Form 10-12G' });
    const b = ev('10-12G - G-Private Equity LP (0004) (Filer)', { source: 'SEC Form 10-12G' });
    assert.equal(eventsToRadarInputs([a, b]).length, 2);
  });
  test('the route clusterer joins the same deal under different subjects', () => {
    const c = createEventClusterer();
    const id1 = c.assign('A', 'Shiva Cement to merger with JSW Cement; board approves 5:41 swap ratio', 'IN', 'MERGER_DEFINITIVE');
    const id2 = c.assign('B', 'JSW Cement to merge its listed arm Shiva Cement with itself; board approves 5:41 swap ratio', 'IN', 'MERGER_DEFINITIVE');
    assert.equal(id1, id2);
  });
});

describe('7 counts audit (synthetic)', () => {
  test('per-canonical-event counts exclude registrations and price / preview / analyst pieces', () => {
    const items: Array<{ event_type: string; title: string }> = [];
    for (let i = 0; i < 30; i++) items.push({ event_type: 'FORM10_REGISTRATION', title: `10-12G - Fund ${i} LP (000${i}) (Filer)` });
    items.push({ event_type: 'DEMERGER_INDIA', title: "HEG Share Price Falls 5% Intraday, Down 67% Since Demerger" });
    items.push({ event_type: 'MERGER_DEFINITIVE', title: 'Vedanta Aluminium share price target: Why Citi, CLSA see 20% upside' });
    items.push({ event_type: 'MERGER_DEFINITIVE', title: 'NBCC Q1 Results Today: What To Watch' });
    items.push({ event_type: 'MERGER_DEFINITIVE', title: 'IHCL announces merger with Oriental Hotels' });
    items.push({ event_type: 'DEMERGER_INDIA', title: 'TVS Motor may hive off financial services business' });
    const c = countCanonicalEventTypes(items);
    assert.equal(c.FORM10_REGISTRATION, undefined);
    assert.equal(c.MERGER_DEFINITIVE, 1);
    assert.equal(c.DEMERGER_INDIA, 1);
    // before: every raw item counted under its type (registrations as spin-offs): spin 32, M&A 3
    const before: Record<string, number> = {};
    for (const it of items) { const k = it.event_type === 'FORM10_REGISTRATION' ? 'SPIN_OFF' : it.event_type; before[k] = (before[k] || 0) + 1; }
    assert.equal(before.SPIN_OFF + before.DEMERGER_INDIA, 32);
    assert.equal((c.DEMERGER_INDIA || 0) + (c.SPIN_OFF || 0), 1);
  });
  test('Form 10 registrations are NOISE in the radar adapter so the Special situations count is not inflated', () => {
    const evs = Array.from({ length: 30 }, (_, i) => ev(`10-12G - Fund ${i} LP (00${String(i).padStart(8, '0')}) (Filer)`, { source: 'SEC Form 10-12G', event_type: 'SPIN_OFF', category: 'SPIN', tier: 'TIER_1' }));
    const inputs = eventsToRadarInputs(evs);
    assert.equal(inputs.length, 30);
    assert.equal(inputs.filter((x: any) => x.isRegistration && x.feedTier === 'NOISE' && x.category === undefined).length, 30);
  });
});

describe('identifySubject edge cases', () => {
  test('HDFC alone is not a ticker; Vedanta is the subject', () => {
    const id = identifySubject({ title: 'Vedanta Aluminium seeks bank loan from HDFC Bank' });
    assert.equal(id.ticker, null);
    assert.equal(id.company, 'Vedanta Aluminium');
  });
  test('NSE-listed company resolved from the master by its subject name', () => {
    assert.equal(identifySubject({ title: 'Nestle India reports strong quarter' }).ticker, 'NESTLEIND');
  });
  test('no mapped symbol for SEC filers', () => {
    assert.equal(identifySubject({ title: '10-12G - Broad Capital Acquisition Corp (0005555555) (Filer)', feedTicker: 'BROAD', isSec: true }).ticker, null);
  });
});
