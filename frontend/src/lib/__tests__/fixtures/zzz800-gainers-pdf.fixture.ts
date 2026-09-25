// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE — research views for the AI Daily Gainers PDF.          (zzz800)
//
// India: the regression findings (fixtureInput) through the real view builder.
// USA: the US regression findings plus two SEC/press cards read without a
// model (CBRL results 8-K, MNTK press only), through the same builder.
// Deterministic: fixed dates, no clock.
// ═══════════════════════════════════════════════════════════════════════════

import type { Finding } from '../../ai-gainers/catalyst-research';
import { buildResearchView, type ResearchView } from '../../ai-gainers/research-view';
import { buildUsCard, US_CARD_VERSION } from '../../ai-gainers/us-card';
import { fixtureInput, fixtureInputUS } from './gainers-view.fixture';

export const PDF_GENERATED_AT = '2026-09-25T09:05:00.000Z';

export function indiaPdfView(): ResearchView {
  const inp = fixtureInput();
  return buildResearchView({ ...inp, session: { date: '2026-09-25', scanAt: '2026-09-25T08:42:00.000Z', status: 'Live', cached: false } });
}

const CBRL_TEXT = 'Exhibit 99.1 CRACKER BARREL REPORTS FOURTH QUARTER AND FULL YEAR FISCAL 2026 RESULTS AND PROVIDES FISCAL 2027 OUTLOOK LEBANON, Tenn. – September 23, 2026 – Cracker Barrel Old Country Store, Inc. (Nasdaq: CBRL) today reported its financial results for the fourth quarter of fiscal 2026 ended July 31, 2026. Total revenue was $849.3 million. Fiscal 2027 Outlook The Company provided the following outlook for fiscal 2027: · Total revenue of $3.325 billion to $3.4 billion including comparable store restaurant sales growth of 3% to 5% · Adjusted EBITDA 1 of $180 million to $200 million 2 · Capital expenditures of $110 million to $125 million. Conference Call';
const CBRL_TABLE = '<TABLE><TR><TD></TD><TD>Fourth Quarter Ended</TD></TR><TR><TD>(In thousands, except per share amounts)</TD><TD>7/31/26</TD><TD>8/1/25</TD><TD>7/31/26</TD><TD>8/1/25</TD></TR><TR><TD>Revenue</TD><TD>$</TD><TD>849,342</TD><TD>$</TD><TD>868,009</TD><TD>$</TD><TD>3,318,714</TD><TD>$</TD><TD>3,483,684</TD></TR><TR><TD>GAAP net income</TD><TD>$</TD><TD>12,204</TD><TD>$</TD><TD>6,754</TD><TD>$</TD><TD>31,675</TD><TD>$</TD><TD>46,379</TD></TR></TABLE>';

export function usPdfView(): ResearchView {
  const inp = fixtureInputUS();
  const base = Object.values(inp.findings)[0];
  const mk = (p: Partial<Finding> & { ticker: string }): Finding => ({ ...base, company: `${p.ticker} Inc.`, notes: [], ...p } as Finding);
  const cbrl = buildUsCard({
    ticker: 'CBRL', company: 'Cracker Barrel Old Country Store, Inc.', marketCapM: 1159,
    filing: { form: '8-K', items: ['2.02', '9.01'], date: '2026-09-23T11:29:00-04:00', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_8k.htm', subject: '8-K: Results of operations [Item 2.02, Item 9.01]' },
    docs: [{ role: 'ex99', url: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_ex99-1.htm', text: CBRL_TEXT, html: `<p>${CBRL_TEXT}</p>${CBRL_TABLE}` }], secChecked: true,
  } as any);
  const mntk = buildUsCard({ ticker: 'MNTK', company: 'Montauk Renewables', marketCapM: 410, filing: null, docs: [], secChecked: true,
    press: [{ title: 'Montauk Renewables opens $200 million biogas facility in North Carolina', url: 'https://news.example/2', date: '2026-09-22', source: 'Bioenergy Insight Magazine' }] } as any);
  const findings: Record<string, Finding> = {
    ...inp.findings,
    CBRL: mk({ ticker: 'CBRL', company: 'Cracker Barrel Old Country Store, Inc.', movePct: 9, marketCap: 1159, status: 'catalyst', category: 'quarterly_result', stage: 'executed',
      headline: 'Results released', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067294/000110465926109812/tm2625926d1_8k.htm', sourceDate: '2026-09-23T11:29:00-04:00', sourceTier: 'primary', ageDays: 1,
      usCard: cbrl, usCardV: US_CARD_VERSION } as any),
    MNTK: mk({ ticker: 'MNTK', company: 'Montauk Renewables', movePct: 14, marketCap: 410, status: 'none', category: null, headline: 'No filing in the last 21 days', usCard: mntk, usCardV: US_CARD_VERSION } as any),
  };
  return buildResearchView({
    ...inp, findings,
    board: Object.values(findings).map((x) => ({ ticker: x.ticker, company: x.company, move_pct: x.movePct, market_cap: x.marketCap })),
    session: { date: '2026-09-24', scanAt: '2026-09-24T21:12:00.000Z', status: 'Today — final', cached: true },
  });
}
