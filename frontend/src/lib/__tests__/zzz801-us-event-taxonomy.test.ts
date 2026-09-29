// zzz801 — US AI Daily Gainers: the fundamental-catalyst taxonomy.
// The owner: "fundamental catalyst is missing … new product, new segment,
// product mix, capex, acquisition, all such events". The taxonomy names ~60
// event types from filing / press text, with the evidence sentence and ONLY
// the figures literally in it; an 8-K 7.01 / 8.01 release is named by its
// catalyst; press-only names keep "press only — not verified in a filing".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { classifyUsEvents, figuresIn, eventSentences, countByCategory, US_EVENT_RULE_IDS, US_EVENT_CATEGORIES, usEventMeta } from '../ai-gainers/us-event-taxonomy';
import { buildUsCard, withPressCatalysts, catalystsFromPress, US_CARD_VERSION, US_EVENT_TYPE_OF } from '../ai-gainers/us-card';
import { buildResearchView, type ResearchItem, type ResearchViewInput } from '../ai-gainers/research-view';
import type { Finding } from '../ai-gainers/catalyst-research';
import { UsCatalystList } from '../../components/ai-gainers/Badges';
import { ResearchCard } from '../../components/ai-gainers/ResearchCard';

(globalThis as any).React = React;
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const ids = (t: string, headline = false) => classifyUsEvents(t, { headline }).map((h) => h.id);
const first = (t: string, headline = false) => classifyUsEvents(t, { headline })[0];

// ── 1. many event types, realistic sentences ────────────────────────────────

const CASES: Array<[string, string]> = [
  ['fda_inspection', 'The FDA completed its inspection of the Bothell facility and issued a Form 483 with three observations.'],
  ['fda_warning_letter', 'The Company received a warning letter from the FDA regarding its manufacturing facility.'],
  ['product_launch', 'Acme Corp. (NASDAQ: ACME) today announced the launch of its next-generation X500 sensor platform for industrial customers.'],
  ['acquisition', 'On September 20, 2026, the Company entered into a definitive agreement to acquire Beta Systems, Inc. for $120 million in cash.'],
  ['fda_adcom', 'The FDA advisory committee voted 10-2 that the benefits of the Galleri test outweigh its risks.'],
  ['guidance_raise', 'The Company raises full-year revenue guidance to $500 million to $520 million.'],
  ['capacity_expansion', 'Gamma will expand manufacturing capacity at its Ohio plant through a $45 million investment.'],
  ['new_segment', 'Beginning in the fourth quarter, the Company will report a new segment, Energy Storage, reflecting its entry into grid batteries.'],
  ['guidance_cut', 'The Company lowered its fiscal 2026 outlook due to weaker demand in Europe.'],
  ['earnings_beat', 'Adjusted EPS of $0.42 exceeded consensus estimates of $0.35.'],
  ['record_results', 'Delta delivered record quarterly revenue of $88.1 million.'],
  ['revenue_growth', 'Total revenue increased 47% year-over-year to $31.2 million.'],
  ['margin_expansion', 'Gross margin expanded 420 basis points to 38.5%, driven by a favorable product mix.'],
  ['turned_profitable', 'The Company achieved GAAP profitability for the first time in its history.'],
  ['product_mix', 'The improvement reflects a richer product mix toward higher-margin systems.'],
  ['pricing_action', 'The Company implemented a 6% price increase across its core product lines effective October 1.'],
  ['new_facility', 'The Company broke ground on a new 250,000 square foot manufacturing facility in Texas.'],
  ['production_start', 'The Company commenced commercial production at its Nevada lithium plant in August.'],
  ['merger_agreement', 'Epsilon and Zeta entered into an Agreement and Plan of Merger under which the companies will combine in an all-stock transaction.'],
  ['divestiture', 'The Company completed the sale of its legacy printing business to Kappa Holdings for $75 million.'],
  ['strategic_review', 'The Board has initiated a process to evaluate strategic alternatives to maximize shareholder value.'],
  ['takeover_bid', 'Under the agreement, shareholders will receive $14.50 per share in cash.'],
  ['joint_venture', 'Theta and Iota formed a joint venture to build battery cathode plants in North America.'],
  ['partnership', 'Lambda announced a strategic partnership with Microsoft to integrate its models into Azure.'],
  ['licensing', 'The Company entered into an exclusive license agreement with Novartis, receiving an upfront payment of $50 million.'],
  ['supply_agreement', 'Mu signed a five-year supply agreement with a leading European automaker.'],
  ['major_contract', 'Nu was awarded a $38 million contract to supply switchgear to a utility in Arizona.'],
  ['customer_win', 'During the quarter the Company signed 14 new enterprise customers, including two Fortune 100 companies.'],
  ['gov_contract', 'Xi received a $22 million task order from the U.S. Army for counter-drone systems.'],
  ['fda_approval', 'The U.S. Food and Drug Administration (FDA) approved ZEPHYR for adults with moderate-to-severe asthma.'],
  ['pdufa', 'The FDA assigned a PDUFA target action date of March 14, 2027.'],
  ['trial_results', 'The Phase 3 PRIME trial met its primary endpoint with a statistically significant reduction in pain (p<0.001).'],
  ['trial_milestone', 'The Company announced that the first patient has been dosed in its Phase 2 trial of OMI-101.'],
  ['designation', 'The FDA granted Breakthrough Therapy Designation to PX-12 for recurrent glioblastoma.'],
  ['intl_approval', 'The device received CE Mark approval, allowing commercial sales across the European Union.'],
  ['profit_growth', 'Net income of $33.9 million, up 154.9% year-over-year, compared to $13.3 million.'],
  ['profit_decline', 'Net income decreased 18% to $4.1 million from $5.0 million.'],
  ['litigation_verdict', 'The jury awarded the Company $90 million in damages plus interest to be determined by the District Court.'],
  ['patent_litigation_win', 'The Company prevailed in its patent infringement lawsuit after a jury verdict awarded $28 million in damages.'],
  ['settlement', 'The Company entered into a settlement agreement resolving all claims in the Delaware litigation.'],
  ['buyback', 'The Board authorized a new share repurchase program of up to $25 million.'],
  ['dividend', 'The Board declared a special cash dividend of $1.00 per share.'],
  ['debt_refinancing', 'The Company entered into a new $150 million senior secured credit facility, refinancing its existing term loan.'],
  ['equity_offering', 'The Company announced the pricing of an underwritten public offering of 8,000,000 shares at $4.00 per share.'],
  ['convertible', 'The Company priced $200 million of 2.5% convertible senior notes due 2031.'],
  ['reverse_split', 'The Board approved a 1-for-10 reverse stock split effective October 3.'],
  ['uplisting', 'The Company\'s common stock has been approved for listing on the Nasdaq Capital Market.'],
  ['index_inclusion', 'Rho Corp. will replace Sigma Inc. in the S&P SmallCap 600 effective prior to the open on October 1.'],
  ['activist_stake', 'Starboard Value filed a Schedule 13D disclosing beneficial ownership of 9.8% of the Company.'],
  ['insider_buying', 'The Company\'s Chief Executive Officer purchased 100,000 shares in open-market purchases.'],
  ['analyst_action', 'Needham initiated coverage with a price target of $30.'],
  ['short_report', 'The Company responds to the short seller report, calling its claims false and misleading.'],
  ['management_change', 'The Board appointed Jane Doe as Chief Executive Officer, effective October 1.'],
  ['restructuring', 'The Company announced a restructuring plan including a reduction in force of approximately 12% of its workforce.'],
  ['ai_datacenter', 'The Company signed a 40 MW colocation lease with an AI cloud provider at its Quebec data center campus.'],
  ['crypto_strategy', 'The Company adopted a bitcoin treasury strategy and purchased 1,200 BTC.'],
  ['strategic_investment', 'Nvidia made a strategic investment of $25 million in the Company.'],
  ['first_commercial', 'The Company completed its first commercial shipment of the Series 3 robots to a logistics customer.'],
  ['backlog', 'Backlog grew 35% to a record $1.2 billion at quarter end.'],
  ['fda_crl', 'The Company received a Complete Response Letter from the FDA for its NDA.'],
  ['fda_submission', 'The Company submitted a Biologics License Application (BLA) to the FDA for VX-9.'],
  ['facility_closure', 'The Company will close its Ohio plant and consolidate production in Mexico.'],
  ['listing_deficiency', 'The Company received a deficiency notice from Nasdaq regarding the minimum bid price requirement.'],
  ['regulatory_probe', 'The Company received a subpoena from the SEC related to its revenue recognition practices.'],
  ['warrant_exercise', 'The Company entered into a warrant inducement agreement with existing holders.'],
];

test('the taxonomy covers ~60 event types in eight categories, each with a plain-English label', () => {
  assert.ok(US_EVENT_RULE_IDS.length >= 50, `rules: ${US_EVENT_RULE_IDS.length}`);
  assert.deepEqual(US_EVENT_CATEGORIES, ['Earnings', 'Product & segment', 'Capital & capacity', 'Corporate action', 'Deals & customers', 'Regulatory & clinical', 'Capital structure', 'Market & ownership']);
  for (const id of US_EVENT_RULE_IDS) {
    const m = usEventMeta(id)!;
    assert.ok(m.label && /^[A-Z]/.test(m.label), id);
    assert.ok(US_EVENT_CATEGORIES.includes(m.category), id);
    assert.ok(US_EVENT_TYPE_OF[id], `event type mapped for ${id}`);
    assert.doesNotMatch(m.label, /\b(?:buy|sell)\b/i, `no trade words in ${id}`);
  }
  // every rule is exercised by a case below
  const covered = new Set(CASES.map((c) => c[0]));
  const missing = US_EVENT_RULE_IDS.filter((id) => !covered.has(id) && !/^(earnings_miss|revenue_decline|margin_compression|growth_acceleration|eps_reported|guidance_issued|tech_milestone)$/.test(id));
  assert.deepEqual(missing, []);
});

for (const [id, text] of CASES) {
  test(`classifies: ${id}`, () => {
    const got = ids(text);
    assert.ok(got.includes(id), `${id} not in [${got.join(', ')}] for: ${text}`);
  });
}

test('extra event types: miss, decline, compression, acceleration, EPS, outlook reaffirmed, milestone', () => {
  assert.ok(ids('Revenue of $12.0 million came in below consensus expectations.').includes('earnings_miss'));
  assert.ok(ids('Net sales decreased 18% to $40.2 million.').includes('revenue_decline'));
  assert.ok(ids('Gross margin contracted to 21% from 29% due to higher freight costs.').includes('margin_compression'));
  assert.ok(ids('Revenue growth accelerated for the third consecutive quarter.').includes('growth_acceleration'));
  assert.ok(ids('Erasca Q2 EPS -$0.12 beats by $0.03', true).includes('earnings_beat'));
  assert.ok(ids('GAAP diluted EPS was $0.31, compared with $0.12 a year ago.').includes('eps_reported'));
  assert.ok(ids('The Company reaffirmed its full-year 2026 outlook.').includes('guidance_issued'));
  assert.ok(ids('The Company achieved a key development milestone with the successful completion of flight testing.').includes('tech_milestone'));
});

test('direction hints: a missed endpoint, a CRL, a downgrade and a rebuttal', () => {
  assert.equal(first('The Phase 2 study did not meet its primary endpoint.')!.direction, 'negative');
  assert.equal(first('The Company received a Complete Response Letter from the FDA.')!.direction, 'negative');
  assert.equal(first('Morgan Stanley downgraded the shares to equal-weight.')!.direction, 'negative');
  assert.equal(classifyUsEvents('The Company responds to the short seller report, calling its claims false and misleading.').find((h) => h.id === 'short_report')!.direction, 'positive');
  assert.equal(classifyUsEvents('The FDA advisory committee voted 10-2 in favor of approval.').find((h) => h.id === 'fda_adcom')!.direction, 'positive');
  assert.equal(classifyUsEvents('The Company expects to launch its new platform in 2027.').find((h) => h.id === 'product_launch')!.planned, true);
});

// ── 2. the owner's press-only watch list ────────────────────────────────────

test('press headlines: GRAL advisory committee, ETON revenue +99%, ERAS EPS, a contract, a new plant', () => {
  assert.equal(first('GRAIL shares jump after FDA advisory committee backs Galleri test', true)!.id, 'fda_adcom');
  assert.equal(first('Eton Pharmaceuticals revenue +99% as product launches drive growth', true)!.id, 'revenue_growth');
  assert.equal(first('Eton Pharmaceuticals revenue up 99% year over year', true)!.id, 'revenue_growth');
  assert.ok(ids('Erasca Q2 EPS -$0.12 beats by $0.03', true).includes('earnings_beat'));
  assert.equal(first('Planet Labs wins $230 million contract from German government', true)!.id, 'major_contract');
  assert.equal(first('Montauk Renewables opens $200 million biogas facility in North Carolina', true)!.id, 'new_facility');
});

// ── 3. negatives: boilerplate never triggers ────────────────────────────────

test('forward-looking statements, safe harbor and risk factors never trigger', () => {
  const fls = 'This press release contains forward-looking statements within the meaning of the Private Securities Litigation Reform Act of 1995, including statements regarding the launch of new products, potential acquisitions, FDA approval, expansion of manufacturing capacity and our partnership with Microsoft.';
  assert.deepEqual(ids(fls), []);
  assert.deepEqual(ids('Safe Harbor: statements about the expected completion of the acquisition and the benefits of the merger are forward-looking.'), []);
  const risk = 'If we fail to obtain FDA approval for our product candidates, our business could be materially adversely affected. We may not be able to complete acquisitions or integrate acquired businesses. There can be no assurance that our new facility will be completed on time. Our collaboration with partners may not succeed.';
  assert.deepEqual(ids(risk), []);
  assert.deepEqual(ids('The information in this Item 7.01, including Exhibit 99.1, shall not be deemed "filed" for purposes of Section 18 of the Securities Exchange Act of 1934, nor incorporated by reference into any filing.'), []);
});

test('the forward-looking section and the "About" paragraph are cut from a full release', () => {
  const release = [
    'Omega Robotics Announces Launch of Atlas Picker. BOSTON, Sept. 22, 2026 -- Omega Robotics, Inc. (NASDAQ: OMGA) today announced the launch of Atlas Picker, its new warehouse robot.',
    'The robot is available immediately to customers in North America.',
    'About Omega Robotics Omega Robotics, Inc. is a leading provider of automation. The company has partnered with Amazon and acquired three businesses since 2020.',
    'Forward-Looking Statements This press release contains forward-looking statements about FDA approval, acquisitions and new facilities.',
  ].join(' ');
  const got = ids(release);
  assert.ok(got.includes('product_launch'));
  assert.ok(!got.includes('partnership'), 'the About paragraph is not an event');
  assert.ok(!got.includes('acquisition'));
  assert.ok(!got.includes('fda_approval'));
});

test('generic words alone never trigger ("acquisition cost", "entered into an agreement", "launched an offering")', () => {
  assert.ok(!ids('Customer acquisition cost declined 12% in the quarter.').includes('acquisition'));
  assert.ok(!ids('The Company launched an underwritten public offering of common stock.').includes('product_launch'));
  assert.ok(!ids('The Company entered into an amendment to its lease.').includes('new_segment'));
  assert.deepEqual(ids('Shares of the Company traded higher on heavy volume.'), []);
});

// ── 4. no invented figures ─────────────────────────────────────────────────

test('figures are only those literally present in the evidence sentence', () => {
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  for (const [, text] of CASES) {
    for (const h of classifyUsEvents(text)) {
      const sentence = h.sentence.replace(/…$/, '');
      assert.ok(norm(text).includes(sentence), `sentence is quoted verbatim: ${h.sentence}`);
      for (const f of h.figures) assert.ok(h.sentence.includes(f), `figure "${f}" is in "${h.sentence}"`);
    }
  }
  assert.deepEqual(first('The Company announced the launch of its new platform.')!.figures, []);
  assert.deepEqual(figuresIn('Gross margin expanded 420 basis points to 38.5% on $12.4 million of revenue.'), ['420 basis points', '38.5%', '$12.4 million']);
  assert.deepEqual(first('The FDA advisory committee voted 10-2 that the benefits outweigh the risks.')!.figures, ['10-2']);
  assert.deepEqual(first('Acme signed a 40 MW colocation lease with an AI cloud provider.')!.figures, ['40 MW']);
  // a figure in the NEXT sentence is not borrowed
  const two = classifyUsEvents('The Company announced the launch of its new platform. Revenue for the year was $90 million.');
  assert.deepEqual(two.find((h) => h.id === 'product_launch')!.figures, []);
});

test('sentence split keeps "U.S. Army" and "Inc." inside one sentence', () => {
  const ss = eventSentences('Xi Inc. received a $22 million task order from the U.S. Army for radios. Deliveries begin in 2027.');
  assert.equal(ss.length, 2);
  assert.match(ss[0], /U\.S\. Army/);
});

test('countByCategory: every category present', () => {
  const c = countByCategory(classifyUsEvents(CASES.map((x) => x[1]).join(' '), { max: 100 }));
  assert.equal(Object.keys(c).length, 8);
  for (const k of US_EVENT_CATEGORIES) assert.ok(c[k] > 0, `${k} counted`);
});

// ── 5. the card: 8-K 7.01 / 8.01 read from the EX-99.1 body ─────────────────

const filing = (form: string, items: string[]) => ({ form, items, date: '2026-09-22', url: 'https://www.sec.gov/Archives/edgar/data/1/1/x.htm', subject: `${form}: [${items.map((i) => `Item ${i}`).join(', ')}]` });
const doc = (role: string, text: string) => ({ role, url: `https://www.sec.gov/Archives/edgar/data/1/1/${role}.htm`, text });
const BODY_701 = 'UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K. Item 7.01 Regulation FD Disclosure. On September 22, 2026, the Company issued a press release, a copy of which is furnished as Exhibit 99.1. The information in this Item 7.01 shall not be deemed "filed" for purposes of Section 18 of the Securities Exchange Act of 1934.';

test('8-K Item 7.01: the EX-99.1 release names a launch — no longer "Reg FD disclosure — no amount stated"', () => {
  const ex = 'WhiteFiber Announces Launch of Its Second AI Data Center Campus. NEW YORK, Sept. 22, 2026 -- WhiteFiber, Inc. (NASDAQ: WYFI) today announced the launch of NC-2, its new 60 MW AI data center campus in North Carolina, backed by a $180 million investment. The campus is expected to be energized in the second half of 2027. Forward-Looking Statements This press release contains forward-looking statements.';
  const c = buildUsCard({ ticker: 'WYFI', company: 'WhiteFiber, Inc.', marketCapM: 900, filing: filing('8-K', ['7.01', '9.01']), docs: [doc('primary', BODY_701), doc('ex99', ex)], secChecked: true })!;
  assert.equal(c.v, US_CARD_VERSION);
  assert.equal(c.source.tier, 'SEC');
  assert.notEqual(c.eventType, 'No identified catalyst');
  assert.doesNotMatch(c.whatChanged, /no amount stated in the filing/);
  assert.ok(c.catalysts && c.catalysts.length >= 1);
  assert.ok(c.catalysts!.every((x) => x.source === 'SEC'));
  assert.ok(c.catalysts!.some((x) => x.id === 'product_launch' || x.id === 'ai_datacenter'));
  assert.match(c.whatChanged, /today announced the launch of NC-2/);
  assert.match(c.whatChanged, /stated: .*60 MW/);
  assert.match(c.catalysts![0].sourceLabel, /^SEC 8-K · EX-99\.1 press release$/);
});

test('8-K Item 8.01: a supply agreement with a stated value is sized against market cap, the arithmetic shown', () => {
  const ex = 'Bandwidth Corp. (NASDAQ: BAND) today announced a five-year supply agreement valued at $60 million with a Tier 1 carrier.';
  const c = buildUsCard({ ticker: 'BAND', company: 'Bandwidth Corp.', marketCapM: 400, filing: filing('8-K', ['8.01', '9.01']), docs: [doc('primary', BODY_701.replace(/7\.01/g, '8.01')), doc('ex99', `${ex} ${'The company serves enterprise customers. '.repeat(4)}`)], secChecked: true })!;
  assert.ok(c.catalysts!.some((x) => x.id === 'supply_agreement'));
  assert.match(c.whatChanged, /\$60M ÷ \$400M market cap = 15%/);
});

test('8-K with nothing classifiable keeps the plain answer and says the scan found nothing', () => {
  const ex = 'Acme Inc. today announced that it will hold its annual shareholder meeting on November 5, 2026 at its offices.';
  const c = buildUsCard({ ticker: 'ACME', company: 'Acme Inc.', marketCapM: 400, filing: filing('8-K', ['8.01']), docs: [doc('primary', BODY_701.replace(/7\.01/g, '8.01')), doc('ex99', `${ex} ${'Other company text here. '.repeat(6)}`)], secChecked: true })!;
  assert.deepEqual(c.catalysts, []);
  assert.ok(c.extra.some((x) => /no (?:material operating )?catalyst found in the filing text/i.test(x)));   // zzz835: an extracted event says "event found, low information" first
});

test('an earnings card still reads the figures, and also lists the release\'s other catalysts', () => {
  const ex = 'Acme Reports Record Third Quarter Results. Acme Corp. today reported total revenue of $120.0 million, compared to $90.0 million a year ago. Net income was $12.0 million, compared to $6.0 million. During the quarter Acme launched its new X9 platform and broke ground on a new manufacturing facility in Ohio.';
  const c = buildUsCard({ ticker: 'ACME', company: 'Acme Corp.', marketCapM: 800, filing: filing('8-K', ['2.02', '9.01']), docs: [doc('ex99', ex)], secChecked: true })!;
  assert.equal(c.kind, 'earnings');
  const got = c.catalysts!.map((x) => x.id);
  assert.ok(got.includes('new_facility'), got.join(','));
  assert.ok(got.includes('record_results'), got.join(','));
});

// ── 6. press-only names ────────────────────────────────────────────────────

test('press only: the event type is named, the honesty label stays "press only"', () => {
  const c = buildUsCard({ ticker: 'GRAL', company: 'GRAIL, Inc.', marketCapM: 2000, filing: null, docs: [], secChecked: true,
    press: [{ title: 'GRAIL shares jump after FDA advisory committee backs Galleri test', url: 'https://news.example/g', date: '2026-09-24', source: 'Reuters' }] })!;
  assert.equal(c.source.label, 'PRESS ONLY — no SEC filing found yet');
  assert.equal(c.kindWord, 'FDA advisory committee (press only)');
  assert.equal(c.eventType, 'Regulatory approval');
  assert.equal(c.catalysts![0].source, 'PRESS');
  assert.match(c.catalysts![0].sourceLabel, /not verified in a filing/);

  const e = buildUsCard({ ticker: 'ETON', company: 'Eton Pharmaceuticals', marketCapM: 500, filing: null, docs: [], secChecked: true,
    press: [{ title: 'Eton Pharmaceuticals revenue up 99% year over year', url: 'https://news.example/e', date: '2026-09-24', source: 'Seeking Alpha' }] })!;
  assert.equal(e.eventType, 'Earnings');
  assert.equal(e.kind, 'earnings');
  assert.deepEqual(e.catalysts![0].figures, ['99%']);
});

test('press with only price chatter: no event, "No catalyst found in filings or news"', () => {
  const c = buildUsCard({ ticker: 'NEO', company: 'NeoGenomics', marketCapM: 2513, filing: null, docs: [], secChecked: true,
    press: [{ title: 'NeoGenomics (NASDAQ:NEO) Trading 4.8% Higher - Here\'s Why', url: 'u1', date: '2026-09-24', source: 'MarketBeat' },
      { title: 'Precision Oncology Expansion Could Be A Game Changer For NeoGenomics Stock', url: 'u2', date: '2026-09-22', source: 'simplywall.st' }] })!;
  assert.equal(c.eventType, 'No identified catalyst');
  assert.deepEqual(c.catalysts, []);
  assert.match(c.whatChanged, /No catalyst found in filings or news/);
});

test('a filing card also lists the press headlines\' catalysts — marked press only, never merged into the filing', () => {
  const ex = 'Acme Inc. today announced that it will hold its annual shareholder meeting on November 5, 2026.';
  const c0 = buildUsCard({ ticker: 'ACME', company: 'Acme Inc.', marketCapM: 400, filing: filing('8-K', ['8.01']), docs: [doc('primary', BODY_701.replace(/7\.01/g, '8.01')), doc('ex99', `${ex} ${'Other company text. '.repeat(6)}`)], secChecked: true })!;
  const c = withPressCatalysts(c0, [{ title: 'Acme wins $40 million Navy contract', url: 'https://news.example/a', date: '2026-09-23', source: 'Defense News' }]);
  assert.equal(c.source.tier, 'SEC');
  assert.equal(c.catalysts!.length, 1);
  assert.equal(c.catalysts![0].source, 'PRESS');
  assert.ok(c.extra.some((x) => /Press reports \(not verified in a filing\)/.test(x)));
  assert.deepEqual(catalystsFromPress([{ title: 'Is Acme stock a buy? Here\'s why it could be a game changer', url: 'x', date: null, source: null }]), []);
});

// ── 7. the view, the card render and India ─────────────────────────────────

const NOW_ISO = '2026-09-24T18:00:00.000Z';
function mk(p: Partial<Finding> & { ticker: string }): Finding {
  return {
    company: `${p.ticker} Inc.`, market: 'US', movePct: 9, marketCap: 900, turnover: 20,
    status: 'none', category: null, stage: null, headline: 'No filing in the last 21 days', evidenceQuote: null,
    sourceUrl: null, sourceDate: null, sourceTier: 'primary', ageDays: 1, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: { m1: 6, m3: 10, m6: 15, y1: 30, history: 250 }, bandPrint: false, bandLevel: null, listingDays: null,
    routine: [], filingsInWindow: 1, windowDays: 21, holding: false, notes: [], modelRead: false, docExtract: true,
    researchedAt: NOW_ISO, sources: ['SEC EDGAR submissions'], ...p,
  } as Finding;
}
const view = (market: 'US' | 'IN', findings: Record<string, Finding>, extra: Partial<ResearchViewInput> = {}) => buildResearchView({
  market, findings, board: Object.values(findings).map((f) => ({ ticker: f.ticker, company: f.company, move_pct: f.movePct, market_cap: f.marketCap })),
  filedResults: [], holdings: [], now: NOW_ISO, ...extra,
});
const all = (v: ReturnType<typeof view>): ResearchItem[] => {
  const m = new Map<string, ResearchItem>();
  for (const i of [...v.queue, ...v.watch, ...v.negative, ...(v.immaterialNegative || []), ...v.noCatalyst, ...v.dataQuality, ...(v.context || []), ...(v.needsReading || [])]) m.set(i.ticker, i);
  return Array.from(m.values());
};

test('US view: catalysts by category in the summary; the card lists them with SEC / PRESS ONLY badges; no trade words, no score', () => {
  const ex = 'WhiteFiber, Inc. (NASDAQ: WYFI) today announced the launch of NC-2, its new 60 MW AI data center campus in North Carolina.';
  const wyfi = buildUsCard({ ticker: 'WYFI', company: 'WhiteFiber, Inc.', marketCapM: 900, filing: filing('8-K', ['7.01', '9.01']), docs: [doc('primary', BODY_701), doc('ex99', `${ex} ${'Company text. '.repeat(10)}`)], secChecked: true })!;
  const gral = buildUsCard({ ticker: 'GRAL', company: 'GRAIL', marketCapM: 2000, filing: null, docs: [], secChecked: true, press: [{ title: 'GRAIL shares jump after FDA advisory committee backs Galleri test', url: 'https://news.example/g', date: '2026-09-24', source: 'Reuters' }] })!;
  const neo = buildUsCard({ ticker: 'NEO', company: 'NeoGenomics', marketCapM: 2513, filing: null, docs: [], secChecked: true, press: [{ title: 'NeoGenomics (NASDAQ:NEO) Trading 4.8% Higher - Here\'s Why', url: 'u1', date: '2026-09-24', source: 'MarketBeat' }] })!;
  const v = view('US', {
    WYFI: mk({ ticker: 'WYFI', usCard: wyfi, usCardV: US_CARD_VERSION } as any),
    GRAL: mk({ ticker: 'GRAL', usCard: gral, usCardV: US_CARD_VERSION } as any),
    NEO: mk({ ticker: 'NEO', usCard: neo, usCardV: US_CARD_VERSION } as any),
  });
  const u = v.summary.usCatalysts!;
  assert.equal(u.found, 2);
  assert.equal(u.none, 1);
  const reg = u.byCategory.find((x) => x.category === 'Regulatory & clinical')!;
  assert.equal(reg.names, 1);
  assert.equal(reg.press, 1);
  const w = all(v).find((x) => x.ticker === 'WYFI')!;
  assert.notEqual(w.eventType, 'No identified catalyst');
  const html = strip(renderToStaticMarkup(React.createElement(ResearchCard, { it: w, rank: 1, onOpen: () => {} })));
  assert.match(html, /CATALYSTS FOUND \(\d+\)/);
  assert.match(html, /SEC/);
  assert.doesNotMatch(html, /\b(?:BUY|SELL)\b/);
  const g = all(v).find((x) => x.ticker === 'GRAL')!;
  const gh = strip(renderToStaticMarkup(React.createElement(UsCatalystList, { it: g })));
  assert.match(gh, /FDA advisory committee/);
  assert.match(gh, /PRESS ONLY — NOT VERIFIED IN A FILING/);
  const n = all(v).find((x) => x.ticker === 'NEO')!;
  assert.match(strip(renderToStaticMarkup(React.createElement(UsCatalystList, { it: n }))), /No catalyst found in filings or news/);
});

test('India: no catalyst summary, nothing rendered by the US list', () => {
  const base = mk({ ticker: 'VIKRAN', market: 'IN', company: 'Vikran Engineering', marketCap: 1575, movePct: 8.6, status: 'catalyst', category: 'order_win', headline: 'Vikran Engineering secures 153.76 Crore order from POWERGRID', sourceUrl: 'https://www.bseindia.com/x.pdf', sourceDate: '2026-09-23T10:00:00+05:30', docExtract: false } as any);
  const v = view('IN', { VIKRAN: base });
  assert.equal((v.summary as any).usCatalysts, undefined);
  const it = all(v)[0];
  assert.equal(renderToStaticMarkup(React.createElement(UsCatalystList, { it })), '');
});

// ── 8. the PDF export carries the list (data via research-view) ────────────

import { inflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import { buildGainersPdf } from '../ai-gainers/gainers-pdf';
import { usPdfView, PDF_GENERATED_AT } from './fixtures/zzz800-gainers-pdf.fixture';

function pdfDrawnText(doc: jsPDF): string {
  const buf = Buffer.from(doc.output('arraybuffer'));
  const bin = buf.toString('latin1');
  let raw = '';
  const sre = /stream\r?\n/g;
  let sm: RegExpExecArray | null;
  while ((sm = sre.exec(bin))) {
    const start = sm.index + sm[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) break;
    try { raw += inflateSync(buf.subarray(start, end)).toString('latin1') + '\n'; } catch { raw += bin.slice(start, end) + '\n'; }
    sre.lastIndex = end + 9;
  }
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[0].slice(1, m[0].lastIndexOf(')')).replace(/\\([()\\])/g, '$1'));
  return out.join(' ').replace(/\s+/g, ' ');
}

test('PDF (US): the catalyst list and the by-category line are printed', () => {
  const v = usPdfView();
  const doc = buildGainersPdf(jsPDF as any, { generatedAt: PDF_GENERATED_AT, view: v, market: 'US' });
  const t = pdfDrawnText(doc);
  assert.match(t, /CATALYSTS FOUND/);
  assert.match(t, /Catalysts found by category/);
});
