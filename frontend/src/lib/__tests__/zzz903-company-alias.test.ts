// zzz903 — alias-based company matcher for News Feed tags. Capitalised words are no longer tickers.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchCompanies, tagTickers, buildAliasIndex, normalizeCompanyName, stripPublisherSuffix } from '../company-alias';

const tags = (t: string) => tagTickers(t);

describe('false-positive traps (no company named)', () => {
  for (const h of [
    'AI boom lifts IT stocks',
    'RBI keeps rates unchanged, MPC votes 5-1',
    'CEO says demand will stay strong through FY27',
    'EV sales jump 40% in September',
    'GDP growth beats estimates; FII selling continues',
    'SEBI tightens F&O rules for retail traders',
    'PSU banks rally as NPA ratios fall',
    'Reserve Bank of India holds repo rate',
    'LIVE What’s Hot: Stocks, Gold & Big Money Moves | Daily Markets Show',
    'Korea’s High-Purity CO₂ Inventory Falls Below One Month',
    'US CPI cools; Fed signals patience',
    'apple farmers in Himachal protest import duty cut',
    'indian oil demand rises to record',
    'Q2 results preview: PAT growth seen at 12% YoY',
    'Micro LED optical interconnect ecosystem mapped',
    'UK launches Great British Grid to accelerate clean power',
  ]) {
    test(h, () => assert.deepEqual(tags(h), []));
  }
});

describe('true positives — India', () => {
  test('full name with legal suffix', () => assert.deepEqual(tags('Reliance Industries Ltd shares rise after AGM'), ['RELIANCE']));
  test('ampersand and "and" variants', () => {
    assert.deepEqual(tags('Larsen & Toubro wins ultra-mega order'), ['LT']);
    assert.deepEqual(tags('Larsen and Toubro Limited bags order'), ['LT']);
    assert.deepEqual(tags('L&T bags mega order from NHAI'), ['LT']);
  });
  test('short names', () => {
    assert.deepEqual(tags('Infosys, TCS lead gains in IT pack'), ['INFY', 'TCS']);
    assert.deepEqual(tags('Airfare strength to offset fuel cost; IndiGo PAT may rise 176%: Elara'), ['INDIGO']);
  });
  test('acronym names must be in capitals', () => {
    assert.deepEqual(tags('HAL Koraput to deliver 2,000th aero-engine'), ['HAL']);
    assert.deepEqual(tags("BHEL share price rallies 5%; what's driving PSU stock?"), ['BHEL']);
    assert.deepEqual(tags('Hal and friends'), []);
  });
  test('longest match wins', () => {
    assert.deepEqual(tags('Reliance Power hits upper circuit'), ['RPOWER']);
    assert.deepEqual(tags('Union Bank of India Q2 profit up 20%'), ['UNIONBANK']);
    assert.deepEqual(tags('Bank of India raises MCLR'), ['BANKINDIA']);
  });
  test('everyday-word names need Title Case', () => {
    assert.deepEqual(tags('Indian Oil Q2 profit doubles'), ['IOC']);
    assert.deepEqual(tags('indian oil imports rise'), []);
  });
  test('apostrophes and periods', () => assert.deepEqual(tags('Dr. Reddy’s Laboratories gets USFDA nod for generic'), ['DRREDDY']));
  test('old names', () => assert.deepEqual(tags('Zomato parent posts profit'), ['ETERNAL']));
  test('curated NSE_TICKER_NAMES entries', () => assert.deepEqual(tags('Bliss GVS Pharma bags export order'), ['BLISSGVS']));
});

describe('true positives — US', () => {
  test('names and possessives', () => {
    assert.deepEqual(tags("Nvidia's Q3 beat lifts chip stocks"), ['NVDA']);
    assert.deepEqual(tags('Apple unveils new iPhone lineup'), ['AAPL']);
    assert.deepEqual(tags('Lockheed Martin wins $2 billion Army contract'), ['LMT']);
  });
  test('explicit symbols', () => {
    assert.deepEqual(tags('$NVDA hits a record high'), ['NVDA']);
    assert.deepEqual(tags('Micron (MU) surges on HBM demand'), ['MU']);
    assert.deepEqual(tags('Shares of NASDAQ: CRDO jump after guidance raise'), ['CRDO']);
  });
  test('exchange-prefixed unknown ticker still counts', () => {
    const m = matchCompanies('NSE:ZZQXCORP rallies 8% on order win');
    assert.equal(m[0].ticker, 'ZZQXCORP'); assert.equal(m[0].kind, 'symbol-exchange');
  });
  test('(XYZ) / $XYZ need a known ticker; stop words never count', () => {
    assert.deepEqual(tags('Startup (ACME) raises funds'), []);
    assert.deepEqual(tags('Revenue (USD) up; $AI hype'), []);
  });
  test('TSMC and SK hynix', () => {
    assert.deepEqual(tags('Samsung, SK hynix expansion strains tool supply, pressures TSMC'), ['SKHYNIX', 'TSM']);
  });
  test('AMD named and Bank of America', () => {
    assert.deepEqual(tags('AMD buys World Labs for $8.2 billion'), ['AMD']);
    assert.deepEqual(tags('Bank of America upgrades Micron'), ['BAC', 'MU']);
  });
});

describe('match details', () => {
  test('returns matched text, kind and confidence', () => {
    const m = matchCompanies('Larsen & Toubro Ltd. and $NVDA in focus');
    assert.equal(m.length, 2);
    assert.equal(m[0].ticker, 'LT'); assert.equal(m[0].matched, 'Larsen & Toubro'); assert.equal(m[0].kind, 'name'); assert.ok(m[0].confidence >= 0.85);
    assert.equal(m[1].ticker, 'NVDA'); assert.equal(m[1].kind, 'symbol-explicit');
  });
  test('one-word names score lower than full names', () => {
    const [a] = matchCompanies('Infosys wins deal'); const [b] = matchCompanies('Tata Consultancy Services wins deal');
    assert.ok(a.confidence < b.confidence);
  });
  test('publisher suffix is never tagged', () => {
    assert.equal(stripPublisherSuffix('Kaynes wins order - NDTV Profit'), 'Kaynes wins order');
    assert.deepEqual(tags('Market wrap - Reuters'), []);
  });
  test('shouted all-caps headlines do not turn every word into a ticker', () => {
    assert.deepEqual(tags('BREAKING: MARKETS CRASH AS FED HIKES'), []);
  });
  test('normalizeCompanyName strips legal suffixes and & variants', () => {
    assert.equal(normalizeCompanyName('Larsen & Toubro Ltd.'), 'larsen and toubro');
    assert.equal(normalizeCompanyName('Acme Holdings Inc'), 'acme holdings');
    assert.equal(normalizeCompanyName('Foo plc'), 'foo');
  });
  test('runtime extras extend the table; low-trust one-word names are skipped', () => {
    const idx = buildAliasIndex([
      { ticker: 'ZZWIDGET', market: 'IN', name: 'Zz Widget Makers Limited', lowTrust: true },
      { ticker: 'ZZONE', market: 'IN', name: 'Zzone Limited', lowTrust: true },
      { ticker: 'ZZBENCH', market: 'US', name: 'Zzbench Robotics Inc' },
    ]);
    assert.deepEqual(tagTickers('Zz Widget Makers wins order', idx), ['ZZWIDGET']);
    assert.deepEqual(tagTickers('Zzone posts profit', idx), []);
    assert.deepEqual(tagTickers('ZZONE jumps 10%', idx), ['ZZONE']);
    assert.deepEqual(tagTickers('Zzbench Robotics beats estimates', idx), ['ZZBENCH']);
  });
  test('limit caps the number of tags', () => {
    assert.equal(tags('Infosys, Wipro, TCS and HCL Technologies report').length, 3);
  });
});

describe('news route wiring', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'news', 'route.ts'), 'utf8');
  test('no capital-word regex left; tags come from the alias matcher', () => {
    assert.ok(!src.includes('title.match(/\\b[A-Z]{2,15}\\b/g)'));
    assert.match(src, /tagTickers\(title, _newsAliasIndex, 3\)/);
    assert.match(src, /await ensureNewsAliasIndex\(\)/);
  });
  test('scraper rows that supply tickers keep them', () => {
    assert.match(src, /Array\.isArray\(s\.tickers\) && s\.tickers\.length \? s\.tickers\.map\(String\)/);
  });
});
