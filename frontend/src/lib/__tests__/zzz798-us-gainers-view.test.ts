// zzz798 — US AI Daily Gainers: the card the owner reads. A US finding that
// carries the SEC-document card shows the filed figures, ONE source label,
// HIGH / MODERATE / SMALL with the arithmetic, and no junk "also in" line.
// India findings are untouched (the card is US-gated).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildResearchView, type ResearchItem, type ResearchViewInput } from '../ai-gainers/research-view';
import type { Finding } from '../ai-gainers/catalyst-research';
import { buildUsCard, US_CARD_VERSION } from '../ai-gainers/us-card';
import { ResearchCard } from '../../components/ai-gainers/ResearchCard';
import { FactLine, SourceBadge } from '../../components/ai-gainers/Badges';

(globalThis as any).React = React;
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const NOW_ISO = '2026-09-24T18:00:00.000Z';
function mk(p: Partial<Finding> & { ticker: string }): Finding {
  return {
    company: `${p.ticker} Inc.`, market: 'US', movePct: 9, marketCap: 1159, turnover: 20,
    status: 'catalyst', category: 'quarterly_result', stage: 'executed', headline: 'Results released — Fiscal 2027 Outlook The Company provided the following outlook', evidenceQuote: 'today reported its financial results for the fourth quarter of fiscal 2026 ended July 31, 2026.',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_8k.htm', sourceDate: '2026-09-23T11:29:00-04:00',
    sourceTier: 'primary', ageDays: 1, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: { m1: 6, m3: 10, m6: 15, y1: 30, history: 250 }, bandPrint: false, bandLevel: null, listingDays: null,
    routine: [], filingsInWindow: 3, windowDays: 21, holding: false, notes: [], modelRead: false, docExtract: true,
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
const card = (it: ResearchItem, section?: string) => strip(renderToStaticMarkup(React.createElement(ResearchCard, { it, rank: 1, onOpen: () => {}, section })));

const CBRL_TABLE = "<TABLE><TR><TD></TD><TD></TD><TD>Fourth Quarter Ended</TD><TD></TD><TD></TD><TD>Twelve Months Ended</TD><TD></TD></TR><TR><TD>(In thousands, except per share amounts)</TD><TD></TD><TD>7/31/26</TD><TD></TD><TD></TD><TD>8/1/25</TD><TD></TD><TD></TD><TD>7/31/26</TD><TD></TD><TD></TD><TD>8/1/25</TD><TD></TD></TR><TR><TD>Revenue</TD><TD></TD><TD>$</TD><TD>849,342</TD><TD></TD><TD></TD><TD>$</TD><TD>868,009</TD><TD></TD><TD></TD><TD>$</TD><TD>3,318,714</TD><TD></TD><TD></TD><TD>$</TD><TD>3,483,684</TD><TD></TD></TR><TR><TD>GAAP net income</TD><TD></TD><TD>$</TD><TD>12,204</TD><TD></TD><TD></TD><TD>$</TD><TD>6,754</TD><TD></TD><TD></TD><TD>$</TD><TD>31,675</TD><TD></TD><TD></TD><TD>$</TD><TD>46,379</TD><TD></TD></TR><TR><TD><FONT>Adjusted net income<SUP>1</SUP></FONT></TD><TD></TD><TD>$</TD><TD>22,359</TD><TD></TD><TD></TD><TD>$</TD><TD>16,702</TD><TD></TD><TD></TD><TD>$</TD><TD>18,043</TD><TD></TD><TD></TD><TD>$</TD><TD>70,912</TD><TD></TD></TR><TR><TD><FONT>Adjusted EBITDA<SUP>1</SUP></FONT></TD><TD></TD><TD>$</TD><TD>62,054</TD><TD></TD><TD></TD><TD>$</TD><TD>55,713</TD><TD></TD><TD></TD><TD>$</TD><TD>147,714</TD><TD></TD><TD></TD><TD>$</TD><TD>224,264</TD><TD></TD></TR><TR><TD>GAAP earnings per share &ndash; diluted</TD><TD></TD><TD>$</TD><TD>0.54</TD><TD></TD><TD></TD><TD>$</TD><TD>0.30</TD><TD></TD><TD></TD><TD>$</TD><TD>1.40</TD><TD></TD><TD></TD><TD>$</TD><TD>2.06</TD><TD></TD></TR><TR><TD><FONT>Adjusted<SUP>1</SUP> earnings per share &ndash; diluted</FONT></TD><TD></TD><TD>$</TD><TD>0.99</TD><TD></TD><TD></TD><TD>$</TD><TD>0.74</TD><TD></TD><TD></TD><TD>$</TD><TD>0.80</TD><TD></TD><TD></TD><TD>$</TD><TD>3.16</TD><TD></TD></TR></TABLE>";
const CBRL_TEXT = 'Exhibit 99.1 CRACKER BARREL REPORTS FOURTH QUARTER AND FULL YEAR FISCAL 2026 RESULTS AND PROVIDES FISCAL 2027 OUTLOOK Performance Underscores Continued Improvement LEBANON, Tenn. – September 23, 2026 – Cracker Barrel Old Country Store, Inc. (Nasdaq: CBRL) today reported its financial results for the fourth quarter of fiscal 2026 ended July 31, 2026. Total revenue was $849.3 million. Fiscal 2027 Outlook The Company provided the following outlook for fiscal 2027: · Total revenue of $3.325 billion to $3.4 billion including comparable store restaurant sales growth of 3% to 5% · Adjusted EBITDA 1 of $180 million to $200 million 2 · Capital expenditures of $110 million to $125 million. Conference Call';
const cbrlCard = buildUsCard({
  ticker: 'CBRL', company: 'Cracker Barrel Old Country Store, Inc.', marketCapM: 1159,
  filing: { form: '8-K', items: ['2.02', '9.01'], date: '2026-09-23T11:29:00-04:00', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_8k.htm', subject: '8-K: Results of operations [Item 2.02, Item 9.01]' },
  docs: [{ role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_ex99-1.htm', text: CBRL_TEXT, html: `<p>${CBRL_TEXT}</p>${CBRL_TABLE}` }], secChecked: true,
})!;

test('CBRL (US): CONFIRMED MATERIAL from the filed figures, one VERIFIED source, no SECONDARY badge, no junk "also in"', () => {
  const v = view('US', { CBRL: mk({ ticker: 'CBRL', usCard: cbrlCard, usCardV: US_CARD_VERSION }) });
  const it = all(v).find((x) => x.ticker === 'CBRL')!;
  assert.equal(it.eventClass, 'CONFIRMED_MATERIAL');
  assert.equal(it.sourceConfidence, 'VERIFIED_DOCUMENT');
  assert.match(it.whatChanged!, /^Revenue \$849\.3M vs \$868\.0M a year ago \(-2\.2%\) · Net income \$12\.2M vs \$6\.75M \(up 80\.7%\)/);
  assert.equal(it.materiality.label, 'SIGNIFICANT');
  assert.equal(it.economicsUnknown, null);
  assert.ok(!(it.surfacedIn || []).includes('Unknown — needs reading'));
  assert.ok(!it.unknowns.some((u) => /^Guidance: Not stated/i.test(u)));
  assert.equal(it.headline, 'Cracker Barrel Reports Fourth Quarter and Full Year Fiscal 2026 Results and Provides Fiscal 2027 Outlook');
  const html = card(it, 'Research queue');
  assert.match(html, /SOURCE: VERIFIED DOCUMENT \(SEC 8-K, filed 2026-09-23 · EX-99\.1 press release\)/);
  assert.doesNotMatch(html, /SECONDARY · VERIFICATION REQUIRED/);
  assert.doesNotMatch(html, /SAME EVENT · ALSO IN/);
  assert.doesNotMatch(html, /Guidance: Not stated|UNKNOWN — NEEDS READING/i);
  assert.match(html, /MATERIAL HIGH · ⓘ how computed/);
  assert.match(html, /Outlook as filed \(FY2027\): revenue \$3\.325B–\$3\.4B/);
  assert.doesNotMatch(html, /₹|\bCr\b/);
  assert.match(it.whyRank!, /material change \(revenue -2\.2%, net income up 80\.7%\)/);
});

test('press-only (US): "PRESS ONLY — no SEC filing found yet" is the one source label', () => {
  const press = buildUsCard({ ticker: 'MNTK', company: 'Montauk Renewables', marketCapM: 410, filing: null, docs: [], secChecked: true,
    press: [{ title: 'Montauk Renewables opens $200 million biogas facility in North Carolina', url: 'https://news.example/2', date: '2026-09-22', source: 'Bioenergy Insight Magazine' }] })!;
  const v = view('US', { MNTK: mk({ ticker: 'MNTK', status: 'none', category: null, headline: 'No filing in the last 21 days', evidenceQuote: null, sourceUrl: null, sourceDate: null, usCard: press, usCardV: US_CARD_VERSION }) });
  const it = all(v).find((x) => x.ticker === 'MNTK')!;
  assert.equal(it.eventClass, 'POTENTIAL_UNVERIFIED');
  assert.equal(it.sourceConfidence, 'SECONDARY_SUMMARY');
  const badge = strip(renderToStaticMarkup(React.createElement(SourceBadge, { it })));
  assert.match(badge, /SOURCE: PRESS ONLY — no SEC filing found yet/);
  const html = card(it);
  assert.doesNotMatch(html, /SECONDARY · VERIFICATION REQUIRED/);   // said once, by the source badge
  assert.doesNotMatch(html, /as stated in the filing/);
});

test('India is untouched: a usCard on an India finding is ignored, output identical', () => {
  const base = mk({ ticker: 'VIKRAN', market: 'IN', company: 'Vikran Engineering', marketCap: 1575, movePct: 8.6, category: 'order_win', headline: 'Vikran Engineering secures 153.76 Crore order from POWERGRID', evidenceQuote: null, sourceUrl: 'https://www.bseindia.com/x.pdf', sourceDate: '2026-09-23T10:00:00+05:30', docExtract: false });
  const a = all(view('IN', { VIKRAN: base }))[0];
  const b = all(view('IN', { VIKRAN: { ...base, usCard: cbrlCard, usCardV: US_CARD_VERSION } }))[0];
  assert.equal(b.usCard, undefined);
  assert.deepEqual({ ...b, usCard: undefined }, { ...a, usCard: undefined });
  const fl = strip(renderToStaticMarkup(React.createElement(FactLine, { it: b })));
  assert.doesNotMatch(fl, /how computed/);
});
