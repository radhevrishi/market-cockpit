// zzz798 — US AI Daily Gainers: an earnings 8-K is read from its own figures.
// Fixture: Cracker Barrel (CBRL) 8-K filed 2026-09-23, Items 2.02 / 9.01,
// EX-99.1 (tm2625926d1_ex99-1.htm) — the highlights table and the fiscal-2027
// outlook, trimmed (public SEC data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsCard, readUsEarnings, parseHtmlTables, earningsFromTables, profitWords, outlookOf, releaseTitle, earningsMaterial, decodeHtmlText } from '../ai-gainers/us-card';
import type { StrictFigures } from '../us-thesis/xbrl';

const CBRL_TABLE = "<TABLE><TR><TD></TD><TD></TD><TD>Fourth Quarter Ended</TD><TD></TD><TD></TD><TD>Twelve Months Ended</TD><TD></TD></TR><TR><TD>(In thousands, except per share amounts)</TD><TD></TD><TD>7/31/26</TD><TD></TD><TD></TD><TD>8/1/25</TD><TD></TD><TD></TD><TD>7/31/26</TD><TD></TD><TD></TD><TD>8/1/25</TD><TD></TD></TR><TR><TD>Revenue</TD><TD></TD><TD>$</TD><TD>849,342</TD><TD></TD><TD></TD><TD>$</TD><TD>868,009</TD><TD></TD><TD></TD><TD>$</TD><TD>3,318,714</TD><TD></TD><TD></TD><TD>$</TD><TD>3,483,684</TD><TD></TD></TR><TR><TD>GAAP net income</TD><TD></TD><TD>$</TD><TD>12,204</TD><TD></TD><TD></TD><TD>$</TD><TD>6,754</TD><TD></TD><TD></TD><TD>$</TD><TD>31,675</TD><TD></TD><TD></TD><TD>$</TD><TD>46,379</TD><TD></TD></TR><TR><TD><FONT>Adjusted net income<SUP>1</SUP></FONT></TD><TD></TD><TD>$</TD><TD>22,359</TD><TD></TD><TD></TD><TD>$</TD><TD>16,702</TD><TD></TD><TD></TD><TD>$</TD><TD>18,043</TD><TD></TD><TD></TD><TD>$</TD><TD>70,912</TD><TD></TD></TR><TR><TD><FONT>Adjusted EBITDA<SUP>1</SUP></FONT></TD><TD></TD><TD>$</TD><TD>62,054</TD><TD></TD><TD></TD><TD>$</TD><TD>55,713</TD><TD></TD><TD></TD><TD>$</TD><TD>147,714</TD><TD></TD><TD></TD><TD>$</TD><TD>224,264</TD><TD></TD></TR><TR><TD>GAAP earnings per share &ndash; diluted</TD><TD></TD><TD>$</TD><TD>0.54</TD><TD></TD><TD></TD><TD>$</TD><TD>0.30</TD><TD></TD><TD></TD><TD>$</TD><TD>1.40</TD><TD></TD><TD></TD><TD>$</TD><TD>2.06</TD><TD></TD></TR><TR><TD><FONT>Adjusted<SUP>1</SUP> earnings per share &ndash; diluted</FONT></TD><TD></TD><TD>$</TD><TD>0.99</TD><TD></TD><TD></TD><TD>$</TD><TD>0.74</TD><TD></TD><TD></TD><TD>$</TD><TD>0.80</TD><TD></TD><TD></TD><TD>$</TD><TD>3.16</TD><TD></TD></TR></TABLE>";
const CBRL_TEXT = 'EX-99.1 2 tm2625926d1_ex99-1.htm EXHIBIT 99.1 Exhibit 99.1 Investor Contact: Adam Hanan (615) 443-9887 Media Contact: Heidi Pearce (615) 235-4135 CRACKER BARREL REPORTS FOURTH QUARTER AND FULL YEAR FISCAL 2026 RESULTS AND PROVIDES FISCAL 2027 OUTLOOK Performance Underscores Continued Improvement in Key Operating & Financial Metrics LEBANON, Tenn. – September 23, 2026 – Cracker Barrel Old Country Store, Inc. (“Cracker Barrel” or the “Company”) (Nasdaq: CBRL) today reported its financial results for the fourth quarter of fiscal 2026 ended July 31, 2026. '
  + 'Fourth Quarter Fiscal 2026 Highlights · Total revenue was $849.3 million. Compared to the prior year quarter, total revenue decreased 2.2%. · GAAP earnings per diluted share were $0.54, and adjusted 1 earnings per diluted share were $0.99. · GAAP net income was $12.2 million compared to prior year quarter GAAP net income of $6.8 million. '
  + 'Fiscal 2027 Outlook The Company provided the following outlook for fiscal 2027: &middot; Total revenue of $3.325 billion to $3.4 billion including comparable store restaurant sales growth of 3% to 5% and no new store openings &middot; Adjusted EBITDA 1 of $180 million to $200 million 2 &middot; Commodity inflation of approximately 3.0% &middot; Hourly wage inflation of 2.5% to 3.0% &middot; Capital expenditures of $110 million to $125 million 1 EBITDA, adjusted net income, adjusted EBITDA, and adjusted earnings per diluted share are non-GAAP financial measures. Fiscal 2026 Fourth Quarter Conference Call As previously announced';
const CBRL_HTML = `<html><body><p>${CBRL_TEXT.slice(0, 900)}</p>${CBRL_TABLE}<p>${CBRL_TEXT.slice(900)}</p></body></html>`;

const cbrlCard = () => buildUsCard({
  ticker: 'CBRL', company: 'Cracker Barrel Old Country Store, Inc.', marketCapM: 1159,
  filing: { form: '8-K', items: ['2.02', '9.01'], date: '2026-09-23T11:29:00-04:00', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_8k.htm', subject: '8-K: Results of operations [Item 2.02, Item 9.01]' },
  docs: [
    { role: 'primary', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_8k.htm', text: 'Item 2.02 Results of Operations and Financial Condition. On September 23, 2026, Cracker Barrel Old Country Store, Inc. issued a press release announcing its results for the fourth quarter of fiscal 2026. A copy is furnished as Exhibit 99.1.' },
    { role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_ex99-1.htm', text: CBRL_TEXT, html: CBRL_HTML },
  ],
  secChecked: true,
});

test('CBRL: the EX-99.1 table is read with its own "in thousands" scaling, current quarter first', () => {
  const t = parseHtmlTables(CBRL_TABLE);
  assert.equal(t.length, 1);
  const te = earningsFromTables(t, CBRL_TEXT)!;
  assert.equal(te.scale, 1 / 1000);
  assert.deepEqual(te.revenue, { cur: 849.342, prev: 868.009 });
  assert.deepEqual(te.netIncome, { cur: 12.204, prev: 6.754 });
  assert.deepEqual(te.eps, { cur: 0.54, prev: 0.3 });
  assert.deepEqual(te.adjEps, { cur: 0.99, prev: 0.74 });
  assert.deepEqual(te.adjEbitda, { cur: 62.054, prev: 55.713 });
  assert.deepEqual(te.ttmRevenue, { cur: 3318.714, prev: 3483.684 });
});

test('CBRL card: WHAT CHANGED carries revenue, net income, EPS, margin and the FY2027 outlook — never "Guidance: Not stated"', () => {
  const c = cbrlCard()!;
  assert.equal(c.kind, 'earnings');
  assert.match(c.whatChanged, /Revenue \$849\.3M vs \$868\.0M a year ago \(-2\.2%\)/);
  assert.match(c.whatChanged, /Net income \$12\.2M vs \$6\.75M \(up 80\.7%\)/);
  assert.match(c.whatChanged, /Diluted EPS \$0\.54 vs \$0\.30 \(adjusted \$0\.99 vs \$0\.74\)/);
  assert.match(c.whatChanged, /Adjusted EBITDA margin 7\.3% vs 6\.4% \(\+0\.9 pts\)/);
  assert.match(c.whatChanged, /FY2027 outlook: revenue \$3\.325B–\$3\.4B/);
  const extra = c.extra.join(' | ');
  assert.match(extra, /adjusted EBITDA \$180M–\$200M/);
  assert.match(extra, /capital expenditures \$110M–\$125M/);
  assert.match(extra, /\+0\.2% to \+2\.4% vs the last twelve months' \$3\.319B/);
  assert.doesNotMatch(`${c.whatChanged} ${extra} ${c.unknowns.join(' ')}`, /Guidance: Not stated/i);
  assert.equal(c.earnings!.guidance, 'NEW');
  assert.equal(c.earnings!.outlookLabel, 'FY2027');
  assert.equal(c.earnings!.basis, 'EX-99.1 table');
  assert.match(c.earnings!.period!, /fourth quarter of fiscal 2026 ended July 31, 2026/);
});

test('CBRL card: MATERIAL computed from the filed figures (India bands) and one consistent SEC source', () => {
  const c = cbrlCard()!;
  assert.equal(c.material.label, 'SIGNIFICANT');            // net income +80.7% ≥ 50%
  assert.match(c.material.how, /revenue -2\.2% vs a year ago; net income up 80\.7%/);
  assert.equal(c.source.tier, 'SEC');
  assert.equal(c.source.label, 'VERIFIED DOCUMENT (SEC 8-K, filed 2026-09-23 · EX-99.1 press release)');
  assert.match(c.source.url!, /tm2625926d1_ex99-1\.htm$/);
  assert.equal(c.quantified, true);
  assert.equal(c.headline, 'Cracker Barrel Reports Fourth Quarter and Full Year Fiscal 2026 Results and Provides Fiscal 2027 Outlook');
  assert.doesNotMatch(JSON.stringify(c), /₹|\bCr\b/);
});

test('losses: "loss narrowed / widened / swung", never a growth %', () => {
  assert.deepEqual(profitWords({ cur: -5, prev: -10 }), { words: 'loss narrowed by 50.0%', pct: null });
  assert.deepEqual(profitWords({ cur: -15, prev: -10 }), { words: 'loss widened by 50.0%', pct: null });
  assert.deepEqual(profitWords({ cur: 3, prev: -2 }), { words: 'swung to a profit from a loss', pct: null });
  assert.deepEqual(profitWords({ cur: -3, prev: 2 }), { words: 'swung to a loss from a profit', pct: null });
  assert.deepEqual(profitWords({ cur: 12.204, prev: 6.754 }), { words: 'up 80.7%', pct: 80.7 });
});

test('a bracketed loss in an "(in millions)" table is a loss; the card says the loss narrowed', () => {
  const html = '<table><tr><td>(In millions, except per share data)</td><td>Three Months Ended June 30,</td></tr><tr><td></td><td>2026</td><td>2025</td></tr>'
    + '<tr><td>Total revenue</td><td>$</td><td>45.2</td><td>$</td><td>30.1</td></tr><tr><td>Net loss</td><td>$</td><td>(4.0</td><td>)</td><td>$</td><td>(9.5</td><td>)</td></tr>'
    + '<tr><td>Net loss per share, basic and diluted</td><td>$</td><td>(0.08</td><td>)</td><td>$</td><td>(0.21</td><td>)</td></tr></table>';
  const text = 'Acme Bio today reported financial results for the second quarter ended June 30, 2026.';
  const e = readUsEarnings({ text, html })!;
  assert.deepEqual(e.revenue, { cur: 45.2, prev: 30.1 });
  assert.deepEqual(e.netIncome, { cur: -4, prev: -9.5 });
  assert.deepEqual(e.eps, { cur: -0.08, prev: -0.21 });
  assert.equal(e.profitGrowthPct, null);
  assert.equal(e.profitChange, 'loss narrowed by 57.9%');
  const c = buildUsCard({ ticker: 'ACME', company: 'Acme Bio', marketCapM: 500, filing: { form: '8-K', items: ['2.02'], date: '2026-08-06', url: 'https://www.sec.gov/x/a.htm', subject: '8-K: Results [Item 2.02]' }, docs: [{ role: 'ex99', url: 'https://www.sec.gov/x/ex99.htm', text, html }], secChecked: true })!;
  assert.match(c.whatChanged, /Net loss \$4M vs a loss of \$9\.5M \(loss narrowed by 57\.9%\)/);
  assert.doesNotMatch(c.whatChanged, /Net loss[^·]*\([+-]\d/);
  assert.equal(earningsMaterial(e).label, 'SIGNIFICANT');   // revenue +50.2%
});

test('a table with no stated scale and no calibrating sentence is not used (never invented)', () => {
  const html = '<table><tr><td>Three Months Ended</td><td>2026</td><td>2025</td></tr><tr><td>Revenue</td><td>849,342</td><td>868,009</td></tr><tr><td>Net income</td><td>12,204</td><td>6,754</td></tr></table>';
  assert.equal(readUsEarnings({ text: 'Results for the quarter.', html }), null);
});

test('10-Q: strict XBRL quarter is used when it is the same period', () => {
  const x = { taxonomy: 'us-gaap', currency: 'USD', basis: 'quarterly', q_end: '2026-06-30', q_start: '2026-04-01', q_end_prev: '2025-06-30', q_filed: '2026-08-05', fiscal_name: 'Q2 FY2026', period_label: 'Q2 FY2026 (quarter ended Jun 30, 2026)',
    revenue: { cur: 120_000_000, prev: 100_000_000, derived: null, tag: 'Revenues' }, net_income: { cur: 9_000_000, prev: 5_000_000, derived: null, tag: 'NetIncomeLoss' },
    operating_income: { cur: 15_000_000, prev: 10_000_000, derived: null, tag: 'OperatingIncomeLoss' }, cfo: { cur: null, prev: null, derived: null, tag: null }, capex: { cur: null, prev: null, derived: null, tag: null },
    eps: { cur: 0.45, prev: 0.25, derived: null, tag: 'EarningsPerShareDiluted' }, calendar: null, why: null } as unknown as StrictFigures;
  const e = readUsEarnings({ text: '', xbrl: x, filedDate: '2026-08-05', form: '10-Q' })!;
  assert.equal(e.basis, 'SEC XBRL');
  assert.equal(e.revenueGrowthPct, 20);
  assert.equal(e.profitChange, 'up 80.0%');
  assert.deepEqual(e.margin, { name: 'Operating margin', cur: 12.5, prev: 10 });
  // a different period's XBRL is never used
  assert.equal(readUsEarnings({ text: 'reported results for the quarter ended September 30, 2026.', xbrl: x, form: '8-K' }), null);
});

test('guidance raised / cut / reaffirmed is said when the release says so', () => {
  assert.equal(outlookOf('The Company raises its full-year 2026 revenue guidance to $410 million to $420 million.').action, 'RAISED');
  assert.equal(outlookOf('The Company lowered its fiscal 2027 outlook for adjusted EBITDA.').action, 'CUT');
  assert.equal(outlookOf('The Company reaffirms its full year 2026 guidance.').action, 'REAFFIRMED');
  assert.equal(outlookOf(CBRL_TEXT).action, 'NEW');
});

test('release title / entities: title-cased, &middot; decoded', () => {
  assert.equal(releaseTitle('EX-99.1 Exhibit 99.1 Horizon Quantum Announces Second Quarter 2026 Financial Results August 4, 2026 SINGAPORE — (BUSINESS WIRE)'), 'Horizon Quantum Announces Second Quarter 2026 Financial Results');
  assert.equal(decodeHtmlText('a&middot;b &amp; c'), 'a·b & c');
});
