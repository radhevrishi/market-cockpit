// zzz798 — US AI Daily Gainers: orders, other US event types, press-only
// cards and the SEC-first ranking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsCard, rankUsFilings, readUsOrder, readUsOther, pressKindOf, PRESS_NOISE, bandLabel, matWord, usdM } from '../ai-gainers/us-card';

const filing = (form: string, items: string[]) => ({ form, items, date: '2026-09-22', url: 'https://www.sec.gov/Archives/edgar/data/1/1/x.htm', subject: `${form}: [${items.map((i) => `Item ${i}`).join(', ')}]` });
const doc = (role: string, text: string) => ({ role, url: `https://www.sec.gov/Archives/edgar/data/1/1/${role}.htm`, text });

test('order / contract: value ÷ market cap, customer and duration — same as India "Order ₹X ÷ market cap"', () => {
  const text = 'Acme Defense, Inc. (NYSE: ACME) today announced that it has been awarded a $120 million contract from the U.S. Army for tactical radios over five years. Deliveries begin in 2027.';
  const o = readUsOrder(text)!;
  assert.equal(o.valueM, 120);
  assert.equal(o.customer, 'U.S. Army');
  assert.equal(o.duration, 'five years');
  const c = buildUsCard({ ticker: 'ACME', company: 'Acme Defense, Inc.', marketCapM: 800, filing: filing('8-K', ['8.01', '9.01']), docs: [doc('ex99', `${text} ${'Filler sentence about the company. '.repeat(5)}`)], secChecked: true })!;
  assert.equal(c.kind, 'order');
  assert.match(c.whatChanged, /^Order \$120M ÷ \$800M market cap = 15% · customer: U\.S\. Army · duration: five years$/);
  assert.equal(c.material.label, 'SIGNIFICANT');   // ≥15% of market cap (India order band)
  assert.match(c.material.how, /15% or more of market cap = HIGH/);
});

test('an "up to" contract ceiling is scale only, never a materiality label', () => {
  const text = 'Acme announced an indefinite-delivery contract with a ceiling value of up to $900 million from the U.S. Navy. The award has a five-year base period.';
  const c = buildUsCard({ ticker: 'ACME', company: 'Acme', marketCapM: 800, filing: filing('8-K', ['7.01']), docs: [doc('ex99', `${text} ${'More text about the business. '.repeat(6)}`)], secChecked: true })!;
  assert.equal(c.kind, 'order');
  assert.equal(c.material.label, 'UNKNOWN');
  assert.match(c.material.how, /ceiling \("up to"\) — scale only/);
});

test('offering: sized against market cap and a rise on it is flagged as unusual', () => {
  const text = 'Beta Therapeutics, Inc. announced the pricing of an underwritten public offering of 10,000,000 shares of its common stock at a public offering price of $5.00 per share. Gross proceeds are expected to be approximately $50 million.';
  const r = readUsOther(text, { form: '8-K' })!;
  assert.equal(r.kind, 'offering');
  const c = buildUsCard({ ticker: 'BETA', company: 'Beta Therapeutics', marketCapM: 400, filing: filing('8-K', ['8.01']), docs: [doc('ex99', `${text} ${'Company background sentence. '.repeat(6)}`)], secChecked: true })!;
  assert.equal(c.kind, 'offering');
  assert.match(c.whatChanged, /\$50M ÷ \$400M market cap = 12\.5%/);
  assert.equal(c.material.label, 'SIGNIFICANT');   // ≥10% (India fund-raise band)
  assert.match(c.flags[0], /A rise on the day of a share sale is unusual/);
});

test('buyback ÷ market cap (India buyback band 5% / 2%)', () => {
  const text = 'The Board of Directors authorized a new share repurchase program of up to $30 million of the Company\'s common stock.';
  const c = buildUsCard({ ticker: 'GAMA', company: 'Gama', marketCapM: 1000, filing: filing('8-K', ['8.01']), docs: [doc('ex99', `${text} ${'Other text. '.repeat(20)}`)], secChecked: true })!;
  assert.equal(c.kind, 'buyback');
  assert.equal(c.material.label, 'MODERATE');      // 3% of market cap
  assert.match(c.whatChanged, /Share buyback: \$30M ÷ \$1B market cap = 3%/);
});

test('FDA approval, trial read-out, guidance raised, index inclusion', () => {
  assert.equal(readUsOther('Delta Bio announced that the U.S. Food and Drug Administration (FDA) has approved DELTAMAB for adults with plaque psoriasis.')!.kind, 'fda');
  assert.equal(readUsOther('The Phase 3 trial met its primary endpoint with statistical significance (p<0.001).')!.kind, 'clinical');
  const miss = readUsOther('The Phase 2 study did not meet its primary endpoint.')!;
  assert.equal(miss.polarity, 'negative');
  assert.equal(readUsOther('The Company raised its full-year 2026 revenue guidance to $410 million to $420 million.')!.word, 'Guidance raised');
  assert.equal(readUsOther('Epsilon Corp. will replace Zeta Inc. in the S&P SmallCap 600 effective prior to the open on October 1.')!.kind, 'index');
});

test('press-only card says so plainly and never borrows a filing label (MNTK)', () => {
  const c = buildUsCard({
    ticker: 'MNTK', company: 'Montauk Renewables, Inc.', marketCapM: 410, filing: null, docs: [],
    press: [
      { title: 'Montauk Renewables stock gains 39.5 percent this year - ad-hoc-news.de', url: 'https://news.example/1', date: '2026-09-23', source: 'Google News' },
      { title: 'Montauk Renewables opens $200 million biogas facility in North Carolina', url: 'https://news.example/2', date: '2026-09-22', source: 'Bioenergy Insight Magazine' },
    ],
    latestSec: { form: '8-K', date: '2026-08-06', items: ['2.02'] }, secChecked: true,
  })!;
  assert.equal(c.source.tier, 'PRESS');
  assert.equal(c.source.label, 'PRESS ONLY — no SEC filing found yet');
  assert.match(c.whatChanged, /press only, no SEC filing found yet/);
  assert.match(c.whatChanged, /scale \(press figure, not verified\): \$200M ÷ \$410M market cap = 48\.8%/);
  assert.equal(c.material.label, 'UNKNOWN');
  assert.match(c.extra[0], /SEC EDGAR checked: no results, deal, contract, offering or 13D filing in the last 21 days \(latest SEC filing: 8-K \(Item 2\.02\) on 2026-08-06\)/);
  assert.doesNotMatch(c.whatChanged, /as stated in the filing/);
  assert.equal(c.quantified, false);
});

test('press with only price chatter → "no company event found", never a capacity catalyst (NEO)', () => {
  const c = buildUsCard({
    ticker: 'NEO', company: 'NeoGenomics', marketCapM: 2513, filing: null, docs: [], secChecked: true,
    press: [
      { title: 'NeoGenomics (NASDAQ:NEO) Trading 4.8% Higher - Here\'s Why', url: 'u1', date: '2026-09-24', source: 'MarketBeat' },
      { title: 'Precision Oncology Expansion Could Be A Game Changer For NeoGenomics Stock', url: 'u2', date: '2026-09-22', source: 'simplywall.st' },
    ],
  })!;
  assert.equal(c.eventType, 'No identified catalyst');
  assert.match(c.whatChanged, /^No company event found/);
  assert.equal(c.source.label, 'PRESS ONLY — no SEC filing found yet');
});

test('press kinds: analyst upgrade / short report / index are press-only kinds', () => {
  assert.equal(pressKindOf('B. Riley upgrades Acme to Buy, raises price target to $30').kind, 'analyst');
  assert.equal(pressKindOf('Hindenburg Research discloses short position in Acme').kind, 'short_report');
  assert.equal(pressKindOf('Acme set to join S&P SmallCap 600').kind, 'index');
  assert.ok(PRESS_NOISE.test('Is Montauk Renewables (MNTK) Outperforming Other Oils-Energy Stocks This Year?'));
});

test('SEC first: 8-K with EX-99.1 > 8-K > 6-K > others, the last 10 days before older ones', () => {
  const now = new Date('2026-09-24T20:00:00Z');
  const a = (subject: string, dateIso: string) => ({ subject, dateIso, url: subject, ageDays: Math.floor((now.getTime() - Date.parse(dateIso)) / 86_400_000) });
  const ranked = rankUsFilings([
    a('SC 13D: stake', '2026-09-22T10:00:00Z'),
    a('6-K', '2026-09-20T10:00:00Z'),
    a('8-K: Other events [Item 8.01]', '2026-09-21T10:00:00Z'),
    a('8-K: Results [Item 2.02, Item 9.01]', '2026-09-23T10:00:00Z'),
    a('4: insider', '2026-09-23T10:00:00Z'),
    a('8-K: Results [Item 2.02, Item 9.01]', '2026-09-05T10:00:00Z'),
    a('S-8: plan', '2026-09-23T10:00:00Z'),
  ], now);
  assert.deepEqual(ranked.map((x) => `${x.subject.split(':')[0]}@${x.dateIso.slice(5, 10)}`), ['8-K@09-23', '8-K@09-21', '6-K@09-20', 'SC 13D@09-22', '8-K@09-05']);
});

test('bands and words: same thresholds as India, HIGH instead of SIGNIFICANT, $ only', () => {
  assert.equal(bandLabel(20, 'acquisition'), 'SIGNIFICANT');
  assert.equal(bandLabel(5, 'acquisition'), 'MODERATE');
  assert.equal(bandLabel(4.9, 'acquisition'), 'SMALL');
  assert.equal(bandLabel(15, 'order'), 'SIGNIFICANT');
  assert.equal(matWord('SIGNIFICANT'), 'HIGH');
  assert.equal(usdM(3325), '$3.325B');
  assert.equal(usdM(849.342), '$849.3M');
  assert.equal(usdM(0.45), '$450K');
  assert.equal(usdM(null), 'not stated');
});
