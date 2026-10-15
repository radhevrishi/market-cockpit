// zzz1059 — US Top Movers catalysts at India parity: industry clusters, direction-checked headlines, what an 8-K announced,
// the on-demand results grade's fallbacks, insider Form 4s, "earnings due" context, and the scheduler's prewarm entry.
// Fixtures are the live 15 Oct 2026 session's real cases (FRO/DHT/ECO tankers, SMTC/LSCC/MTSI semis, ECO's "new 1-year
// high", AQST's / RZLT's / REAL's / FMC's 8-Ks, MAN / FMC / RXRX results).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  industryStats, industryCluster, headlineDirection, contradictsMove, analystAction, headlineRank, pickHeadline, PREVIEW_OR_TRANSCRIPT,
  releaseHeadline, bodyAnnouncement, eightKAnnouncement, parseForm4Xml, insiderSummary, insiderWhyText, form4XmlUrl, earningsDueText,
} from '../us-movers-catalysts';
import { attributeUsMover, earningsWhyText, filingWhy, isPriceTalk, usMoversPrewarmDue, US_MOVERS_PREWARM_CRONS, whyCoverage, type FilingClass, type UsWhyInput } from '../us-movers';
import { classifyUsFiling, insiderFilingsFromSubmissions } from '../ai-gainers/us-gainers';
import { liteFromGraded, filingRefFromUrl } from '../us-movers-results';
import { liteFromGradedRow, nextNyseSessions, rowFromScanData, scanBody } from '../us-movers-server';
import { LIGHT_JOBS } from '../app-scheduler';

const classify = (f: { subject: string }): FilingClass | null => {
  const c = classifyUsFiling(f);
  return c ? { kind: c.kind as FilingClass['kind'], category: (c.category as string) || null, routineReason: c.routineReason } : null;
};
const win = { session: '2026-10-15', prevSession: '2026-10-14', closeEt: '16:00' };
const base = (o: Partial<UsWhyInput>): UsWhyInput => ({ ticker: 'AAA', chg: -6.5, ...win, filings: [], news: [], ...o });

// ── industry clusters ─────────────────────────────────────────────────────
const universe = [
  { ticker: 'FRO', industry: 'Marine Shipping', chg: -6.63 }, { ticker: 'DHT', industry: 'Marine Shipping', chg: -6.09 },
  { ticker: 'ECO', industry: 'Marine Shipping', chg: -6.77 }, { ticker: 'SHIP', industry: 'Marine Shipping', chg: -5.1 },
  { ticker: 'ZIM', industry: 'Marine Shipping', chg: -1.2 }, { ticker: 'MATX', industry: 'Marine Shipping', chg: 0.4 },
  { ticker: 'SMTC', industry: 'Semiconductors', chg: -10.01 }, { ticker: 'LSCC', industry: 'Semiconductors', chg: -6.88 },
  { ticker: 'MTSI', industry: 'Semiconductors', chg: -6.84 }, { ticker: 'NVDA', industry: 'Semiconductors', chg: 1.1 },
  { ticker: 'AMD', industry: 'Semiconductors', chg: 0.6 }, { ticker: 'INTC', industry: 'Semiconductors', chg: 0.2 },
  ...['QCOM', 'TXN', 'ADI', 'MCHP', 'ON', 'NXPI'].map((t, i) => ({ ticker: t, industry: 'Semiconductors', chg: -0.4 + i * 0.3 })),
  { ticker: 'ATEN', industry: 'Information Technology Services', chg: -6.14 }, { ticker: 'VIAV', industry: 'Information Technology Services', chg: -4.2 },
  { ticker: 'NSIT', industry: 'Information Technology Services', chg: -4.0 },
  ...Array.from({ length: 12 }, (_, i) => ({ ticker: `IT${i}`, industry: 'Information Technology Services', chg: 3 + i * 0.2 })),
  { ticker: 'FMC', industry: 'Chemicals: Agricultural', chg: -30.5 }, { ticker: 'CF', industry: 'Chemicals: Agricultural', chg: -3.4 },
  { ticker: 'MOS', industry: 'Chemicals: Agricultural', chg: -3.1 }, { ticker: 'NTR', industry: 'Chemicals: Agricultural', chg: -3.2 },
  { ticker: 'SOLO', industry: null, chg: -9 },
];
const stats = industryStats(universe);
const top = new Set(['FRO', 'DHT', 'ECO', 'SMTC', 'LSCC', 'MTSI', 'ATEN', 'FMC']);

test('industry cluster: crude tankers FRO, DHT, ECO all down 6–7% → an industry move, top movers named first, with the median', () => {
  const c = industryCluster({ ticker: 'FRO', chg: -6.63, industry: 'Marine Shipping' }, stats, top)!;
  assert.ok(c, 'cluster found');
  assert.equal(c.industry, 'Marine Shipping');
  assert.deepEqual(c.names.slice(0, 3).map((x) => x.t), ['ECO', 'FRO', 'DHT'], 'the names on the lists first');
  assert.equal(c.topCount, 3);
  assert.match(c.text, /^industry move — Marine Shipping: ECO, FRO, DHT, SHIP all down 5–7%/);
  assert.match(c.text, /4 of 6 names ≥3%; industry median −5\.6%/);
  assert.equal(c.confidence, 'MEDIUM');
  // semis: three top losers together even though the whole industry is flat (two top movers are enough)
  const s = industryCluster({ ticker: 'LSCC', chg: -6.88, industry: 'Semiconductors' }, stats, top)!;
  assert.ok(s); assert.match(s.text, /Semiconductors: SMTC, LSCC, MTSI all down 7–10%/); assert.equal(s.confidence, 'LOW');
});

test('industry cluster: never when the industry moved the other way, when peers are tiny next to the move, or with no industry', () => {
  // ATEN −6% with two peers down while the industry rose +3%: not an industry move
  assert.equal(industryCluster({ ticker: 'ATEN', chg: -6.14, industry: 'Information Technology Services' }, stats, top), null);
  // FMC −30% with ag-chem peers down 3%: the 0.35× magnitude gate (India's) rejects it
  assert.equal(industryCluster({ ticker: 'FMC', chg: -30.5, industry: 'Chemicals: Agricultural' }, stats, top), null);
  assert.equal(industryCluster({ ticker: 'SOLO', chg: -9, industry: null }, stats, top), null);
  assert.equal(industryCluster({ ticker: 'X', chg: -2, industry: 'Marine Shipping' }, stats, top), null, 'under the 3% floor');
  // a lone mover in a quiet industry
  const quiet = industryStats([{ ticker: 'A', industry: 'Q', chg: -8 }, { ticker: 'B', industry: 'Q', chg: -0.5 }, { ticker: 'C', industry: 'Q', chg: 0.3 }]);
  assert.equal(industryCluster({ ticker: 'A', chg: -8, industry: 'Q' }, quiet, new Set(['A'])), null);
});

test('WHY order: industry beats the broad sector, the sector line says it is broad only, and stock-specific news beats industry', () => {
  const ind = industryCluster({ ticker: 'DHT', chg: -6.09, industry: 'Marine Shipping' }, stats, top);
  const w = attributeUsMover(base({ ticker: 'DHT', chg: -6.09, industry: ind, sector: 'Transportation', sectorMovePct: -1.5 }), classify);
  assert.equal(w.kind, 'INDUSTRY'); assert.equal(w.confidence, 'MEDIUM'); assert.match(w.text, /Marine Shipping/);
  const s = attributeUsMover(base({ chg: -6.09, sector: 'Transportation', sectorMovePct: -1.5 }), classify);
  assert.equal(s.kind, 'SECTOR'); assert.match(s.text, /broad sector only/);
  const n = attributeUsMover(base({ ticker: 'DHT', chg: -6.09, industry: ind, news: [{ title: 'DHT Holdings cuts quarterly dividend after weak rates', url: 'https://x', date: '2026-10-15', source: 'Reuters' }] }), classify);
  assert.equal(n.kind, 'NEWS'); assert.ok(n.context?.some((c) => /^also: industry move/.test(c)), 'the industry move rides along');
  // a headline with nothing causal in it (an interview) does not outrank the industry move — it becomes context
  const iv = attributeUsMover(base({ ticker: 'DHT', chg: -6.09, industry: ind, news: [{ title: 'DHT Holdings CEO talks tanker markets at a shipping conference', url: 'https://x', date: '2026-10-15', source: 'x' }] }), classify);
  assert.equal(iv.kind, 'INDUSTRY'); assert.ok(iv.context?.some((c) => /^news: DHT Holdings CEO talks/.test(c)));
  assert.equal(whyCoverage([{ why: w } as any, { why: n } as any]).INDUSTRY, 1);
});

// ── headlines ─────────────────────────────────────────────────────────────
test('headlines: a "new 1-year high" on a falling stock (ECO −6.8%) is rejected; direction words both ways', () => {
  assert.equal(headlineDirection('Okeanis Eco Tankers (NYSE:ECO) Sets New 1-Year High'), 'up');
  assert.equal(contradictsMove('Okeanis Eco Tankers (NYSE:ECO) Sets New 1-Year High', -6.77), true);
  assert.equal(isPriceTalk('Okeanis Eco Tankers (NYSE:ECO) Sets New 1-Year High'), true, 'a 1-year high is a price mark, never a reason');
  assert.equal(headlineDirection('XYZ shares plunge after FDA rejects drug'), 'down');
  assert.equal(contradictsMove('XYZ shares plunge after FDA rejects drug', 12), true);
  assert.equal(headlineDirection('Company raises full-year guidance'), 'up');
  assert.equal(headlineDirection('ATEN Maintained by Mizuho -- Price Target Lowered to $30'), 'down');
  assert.equal(headlineDirection('Critical Metals Rises 4% on Greenland plan; USA Rare Earth Declines 3%'), null, 'both ways = no direction');
  const w = attributeUsMover(base({ ticker: 'ECO', chg: -6.77, news: [{ title: 'Okeanis Eco Tankers (NYSE:ECO) Sets New 1-Year High', url: 'https://x', date: '2026-10-15', source: 'x' }] }), classify);
  assert.equal(w.kind, 'NONE');
});

test('headlines: previews / transcripts / stale-dated items are never the reason; the most causal headline wins', () => {
  for (const t of ['Liberty Energy (LBRT) Reports Next Week: Wall Street Expects Earnings Growth', 'Q1 2026 Zillow Group Inc Earnings Call Transcript',
    'Vicor (VICR) Q3 2026 Preview: EPS Est. $1.24, Reports October 20']) assert.ok(PREVIEW_OR_TRANSCRIPT.test(t), t);
  const items = [
    { title: 'Alpha Corp CEO talks AI strategy at industry conference panel', url: 'u1', date: '2026-10-15', source: 's' },
    { title: 'Alpha Corp wins $200 million Navy contract award', url: 'u2', date: '2026-10-14', source: 's' },
    { title: 'Alpha Corp lowers full-year revenue outlook on weak demand', url: 'u3', date: '2026-10-15', source: 's' },
  ];
  const r = pickHeadline(items, -9, () => true);
  assert.equal(r.pick?.url, 'u3', 'guidance cut on a fall beats a contract and an interview');
  assert.equal(pickHeadline(items, 9, () => true).pick?.url, 'u2', 'on a rise the guidance cut contradicts and is dropped');
  assert.equal(headlineRank('Alpha Corp CEO talks AI strategy at industry conference panel'), 9);
  // stale: a headline from before the previous session never explains today
  const stale = attributeUsMover(base({ chg: 9, news: [{ title: 'Alpha Corp wins $200 million Navy contract award', url: 'u', date: '2026-10-10', source: 's' }] }), classify);
  assert.equal(stale.kind, 'NONE');
});

test('analyst actions are labelled with the firm and the action; holder sales read as such', () => {
  assert.deepEqual(analystAction('Quantinuum in spotlight as Morgan Stanley upgrades, names top quantum play'), { firm: 'Morgan Stanley', action: 'upgrade' });
  assert.deepEqual(analystAction('Morgan Stanley cuts Liberty Energy stock target to USD 28.00'), { firm: 'Morgan Stanley', action: 'target cut' });
  assert.deepEqual(analystAction('Digital Turbine in focus as Roth Capital resumes coverage with Buy rating'), { firm: 'Roth Capital', action: 'coverage started' });
  assert.equal(analystAction('Alpha Corp wins $200 million Navy contract'), null);
  const a = attributeUsMover(base({ ticker: 'QNT', chg: 11, news: [{ title: 'Quantinuum in spotlight as Morgan Stanley upgrades, names top quantum play', url: 'u', date: '2026-10-15', source: 's' }] }), classify);
  assert.equal(a.kind, 'ANALYST'); assert.match(a.text, /^analyst action \(Morgan Stanley upgrade\) — Quantinuum/);
  const h = attributeUsMover(base({ ticker: 'TH', chg: -7.2, news: [{ title: 'TDR Capital sells USD 202.40 million of Target Hospitality stock', url: 'u', date: '2026-10-15', source: 's' }] }), classify);
  assert.equal(h.kind, 'INSIDER'); assert.match(h.text, /^holder \/ insider sale — TDR Capital sells USD 202\.40 million/);
});

// ── 8-K content ───────────────────────────────────────────────────────────
const RZLT_EX99 = 'EX-99.1 2 tm2627620d1_ex99-1.htm EXHIBIT 99.1 Exhibit 99.1 Rezolute Announces Completion of Enrollment in Phase 3 upLIFT Study of Ersodetug in Tumor Hyperinsulinism Topline results expected mid-December 2026 REDWOOD CITY, Calif., October 14, 2026 – Rezolute, Inc. (Nasdaq: RZLT) (Rezolute or Company), a late-stage ultra-rare disease company, today announced that the open-label Phase 3 study of ersodetug in tumor HI (upLIFT) is now fully enrolled.';
const REAL_EX99 = 'EX-99.1 3 d170302dex991.htm EX-99.1 EX-99.1 Exhibit 99.1 THE REALREAL ANNOUNCES REFINANCING OF 2029 SENIOR SECURED NOTES WITH NEW $150 MILLION TERM LOAN AND $25 MILLION REVOLVING CREDIT FACILITY Refinancing Extends Secured Debt Maturity to 2033 and Reduces Interest Expense Outlines Medium-Term Target for Leverage San Francisco, October 15, 2026 — The RealReal, Inc. (Nasdaq: REAL) today announced that it has entered into a credit agreement.';
const FMC_EX99 = 'EX-99.1 2 ex99110152026.htm EX-99.1 Document Exhibit 99.1 FMC Corporation 2929 Walnut Street Philadelphia, PA 19104 USA News Release 215.299.6000 fmc.com For Release: Immediate Media contact: Nicole Canning +1.215.299.5916 Nicole.Canning@fmc.com Investor Contact: Curt Brooks + 1 . 215.299.6137 Curt.Brooks@fmc.com FMC Corporation Provides Update to Third-Quarter Expectations and Announces Comprehensive Commercial Actions to Expedite Return to Growth • Third-quarter revenue 1 is now expected to be $65 million to $125 million, with Adjusted EBITDA 2 expected to be negative $565 million to negative $510 million • Revised expectations now include commercial actions';
const AQST_BODY = 'aqst-20261015 FORM 8-K CURRENT REPORT Aquestive Therapeutics, Inc. Item 7.01 Regulation FD Disclosure. On October 15, 2026, Aquestive Therapeutics, Inc. ("Aquestive" or the "Company") issued a press release announcing that the U.S. Food and Drug Administration (FDA) has acknowledged its resubmission of the New Drug Application (NDA) for Anaphylm™ (dibutepinephrine) sublingual film as complete and has assigned a PDUFA goal date of March 16, 2027. The information in this Item 7.01 shall not be deemed to be "filed".';

test('8-K content: the EX-99.1 headline (dateline cut, sub-headline dropped, ALL CAPS sentence-cased); no dateline → the headline run + its figure bullet', () => {
  assert.equal(releaseHeadline(RZLT_EX99), 'Rezolute Announces Completion of Enrollment in Phase 3 upLIFT Study of Ersodetug in Tumor Hyperinsulinism');
  assert.equal(releaseHeadline(REAL_EX99), 'The realreal announces refinancing of 2029 senior secured notes with new $150 million term loan and $25 million revolving credit facility');
  const fmc = releaseHeadline(FMC_EX99)!;
  assert.match(fmc, /^FMC Corporation Provides Update to Third-Quarter Expectations and Announces Comprehensive Commercial Actions/);
  assert.match(fmc, /— Third-quarter revenue is now expected to be \$65 million to \$125 million/, 'the figure bullet, footnote marks removed');
  assert.equal(releaseHeadline('Exhibit 99.1 random table 1 2 3 of numbers only'), null);
});

test('8-K content: the body "issued a press release announcing that …" sentence, the Item 1.01 counterparty, and docs order', () => {
  assert.match(bodyAnnouncement(AQST_BODY)!, /^the U\.S\. Food and Drug Administration \(FDA\) has acknowledged its resubmission/);
  assert.equal(bodyAnnouncement('Item 1.01 Entry into a Material Definitive Agreement. On October 9, 2026, the Company entered into a Credit Agreement (the "Credit Agreement") with Blue Owl Capital Corporation, as administrative agent.'),
    'entered into a Credit Agreement with Blue Owl Capital Corporation');
  assert.match(eightKAnnouncement([{ role: 'primary', text: AQST_BODY }, { role: 'ex99', text: RZLT_EX99 }])!, /^Rezolute Announces/, 'EX-99.1 headline first');
  assert.match(eightKAnnouncement([{ role: 'primary', text: AQST_BODY }])!, /FDA/);
  assert.equal(eightKAnnouncement([{ role: 'primary', text: 'Item 5.07 Submission of Matters to a Vote. The proposals passed.' }]), null);
  // the WHY says what it announced instead of the item number
  const f = { subject: '8-K: Regulation FD disclosure (press release / investor materials) [Item 7.01, Item 9.01] · filed 07:21 ET', url: 'https://www.sec.gov/a', dateIso: '2026-10-15T07:21:16-04:00', announced: bodyAnnouncement(AQST_BODY) };
  const w = attributeUsMover(base({ ticker: 'AQST', chg: -11.9, filings: [f] }), classify);
  assert.equal(w.kind, 'FILING'); assert.match(w.text, /^8-K: the U\.S\. Food and Drug Administration/);
  assert.doesNotMatch(w.text, /Regulation FD/);
});

// ── results: on-demand grade fallbacks ────────────────────────────────────
test('results 8-K: never "not graded yet" — graded figures (GAAP and adjusted apart), else the release headline, grade queued', () => {
  assert.deepEqual(filingRefFromUrl('https://www.sec.gov/Archives/edgar/data/37785/000003778526000149/fmc-20261015.htm'),
    { cikNum: 37785, accession: '0000037785-26-000149', indexUrl: 'https://www.sec.gov/Archives/edgar/data/37785/000003778526000149/0000037785-26-000149-index.htm' });
  // no validated figures (FMC's pre-announcement): the release headline stands in
  const fmcLite = liteFromGraded(null, { ticker: 'FMC', filed: '2026-10-15', prelim: true, guidance: 'LOWERED', headline: 'FMC Corporation Provides Update to Third-Quarter Expectations', url: 'u' })!;
  const t = earningsWhyText(fmcLite, -30.5);
  assert.equal(t, 'fell on results (8-K 2.02) — FMC Corporation Provides Update to Third-Quarter Expectations · guidance lowered · full grade queued for the next refresh');
  assert.doesNotMatch(t, /not graded yet/);
  assert.equal(liteFromGraded(null, { ticker: 'X', filed: '2026-10-15', prelim: true, guidance: null, headline: null, url: null }), null);
  // a PRELIM grade: GAAP and adjusted EPS shown apart, BLOCKBUSTER capped at STRONG
  const row: any = { quarter: 'Q3 FY26', sales_yoy_pct: 6.2, eps_yoy_pct: 87, eps_gaap_yoy_pct: 87, eps_adj_yoy_pct: 12.4, eps_swing: null, eps_adj_swing: null, net_profit_yoy_pct: 80, tier: 'BLOCKBUSTER' };
  const man = liteFromGraded(row, { ticker: 'MAN', filed: '2026-10-15', prelim: true, guidance: null, headline: null, url: 'u' })!;
  assert.equal(man.tier, 'STRONG');
  assert.equal(earningsWhyText(man, -15.8), 'fell on Q3 FY26 earnings · revenue +6% · EPS (GAAP) +87% · adj. EPS +12% · STRONG (prelim)');
  // a graded-us day row keeps the split too
  const lite = liteFromGradedRow({ ticker: 'abc', filing_date: '2026-10-14', quarter: 'Q3 FY26', sales_yoy_pct: 20, eps_yoy_pct: 30, eps_gaap_yoy_pct: null, eps_adj_yoy_pct: 30, eps_swing: 'loss-narrowed', tier: 'GOOD', guidance: 'RAISED' }, '2026-10-14', 'GOOD')!;
  assert.equal(earningsWhyText(lite, 8), 'rose on Q3 FY26 earnings · revenue +20% · EPS (GAAP) loss narrowed · adj. EPS +30% · guidance raised · GOOD');
  // the on-demand record leads the WHY like a graded day row
  const w = attributeUsMover(base({ ticker: 'FMC', chg: -30.5, earnings: fmcLite }), classify);
  assert.equal(w.kind, 'EARNINGS'); assert.equal(w.confidence, 'HIGH');
  // the filing-only fallback (release unreadable) also queues the grade and never says "not graded yet"
  const fw = filingWhy([{ subject: '8-K: Quarterly results released (results of operations) [Item 2.02, Item 9.01] · filed 08:03 ET', url: 'u', dateIso: '2026-10-15T08:03:47-04:00' }], -30.5, classify, win)!;
  assert.match(fw.text, /grade queued/); assert.doesNotMatch(fw.text, /not graded yet/);
  // RXRX: results + other items, plus a 424B5 the same morning → context line
  const rx = attributeUsMover(base({ ticker: 'RXRX', chg: 11.2, earnings: { ...fmcLite, ticker: 'RXRX', guidance: null, headline: 'Recursion Announces Sanofi Options Development Candidate', other_items: true },
    filings: [{ subject: '424B5 · filed 08:19 ET before the open', url: 'u', dateIso: '2026-10-15T08:19:50-04:00' }] }), classify);
  assert.match(rx.text, /^rose on results \+ other events \(8-K\) — Recursion Announces Sanofi/);
  assert.ok(rx.context?.some((c) => /offering \/ dilution filed \(424B5\)/.test(c)));
});

// ── insider Form 4 ────────────────────────────────────────────────────────
const FORM4 = `<?xml version="1.0"?><ownershipDocument><periodOfReport>2026-10-14</periodOfReport>
<reportingOwner><reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100000</value></transactionShares><transactionPricePerShare><value>26.00</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>20000</value></transactionShares><transactionPricePerShare><value>25.00</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionCoding><transactionCode>M</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>50000</value></transactionShares><transactionPricePerShare><value>3.00</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>`;

test('Form 4: open-market sells summed (option exercises ignored); a big sale on a fall is the WHY, a small one is not', () => {
  const f = parseForm4Xml(FORM4)!;
  assert.equal(f.owner, 'DOE JANE'); assert.equal(f.role, 'Chief Executive Officer'); assert.equal(f.trades.length, 3);
  const s = insiderSummary(f)!;
  assert.equal(s.side, 'sell'); assert.equal(s.valueUsd, 100000 * 26 + 20000 * 25);
  const w = insiderWhyText([s])!;
  assert.match(w.text, /^insider selling — CEO Doe Jane sold \$3\.1M on the open market \(Form 4\)$/);
  assert.equal(insiderWhyText([{ ...s, valueUsd: 400_000 }]), null, 'a $400K sale is not material');
  assert.equal(parseForm4Xml('<html>not a form 4</html>'), null);
  assert.equal(form4XmlUrl('https://www.sec.gov/Archives/edgar/data/1/000000000126000001/xslF345X05/wk-form4_1.xml'), 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/wk-form4_1.xml');
  const big = attributeUsMover(base({ chg: -8, mcapM: 400, insider: { ...w, date: '2026-10-14', url: 'u' } }), classify);
  assert.equal(big.kind, 'INSIDER'); assert.equal(big.confidence, 'MEDIUM');           // $3.1M ≥ 0.5% of a $400M cap
  const same = attributeUsMover(base({ chg: 8, mcapM: 400, insider: { ...w, date: '2026-10-14', url: 'u' } }), classify);
  assert.equal(same.kind, 'NONE', 'a sale never explains a rise');
  // the submissions list → insider filings in the window
  const sub = { filings: { recent: { form: ['4', '8-K', '144', '4'], filingDate: ['2026-10-15', '2026-10-15', '2026-10-14', '2026-09-01'], accessionNumber: ['0000000001-26-000001', '0000000001-26-000002', '0000000001-26-000003', '0000000001-26-000004'], primaryDocument: ['xslF345X05/f4.xml', 'a.htm', 'xsl144X01/p.xml', 'xslF345X05/old.xml'], acceptanceDateTime: ['2026-10-15T20:31:00.000Z', '', '2026-10-14T21:00:00.000Z', ''] } } };
  const ins = insiderFilingsFromSubmissions(sub, '0000000001', 5, new Date('2026-10-15T22:00:00Z'));
  assert.deepEqual(ins.map((x) => x.form), ['4', '144']);
  assert.match(ins[0].url, /\/data\/1\/000000000126000001\/xslF345X05\/f4\.xml$/);
});

// ── context + schedule + scanner ──────────────────────────────────────────
test('earnings due: a weak answer carries "earnings due <date>"; the next three NYSE sessions skip weekends', () => {
  assert.equal(earningsDueText('2026-10-20', 'pre-market'), 'earnings due Tue Oct 20 (before the open)');
  assert.deepEqual(nextNyseSessions('2026-10-15', 3), ['2026-10-16', '2026-10-19', '2026-10-20']);
  assert.deepEqual(nextNyseSessions('2026-11-25', 2), ['2026-11-27', '2026-11-30'], 'Thanksgiving skipped');
  const w = attributeUsMover(base({ ticker: 'VICR', chg: -10.4, earningsDue: earningsDueText('2026-10-20', 'pre-market') }), classify);
  assert.equal(w.kind, 'NONE'); assert.match(w.text, /· earnings due Tue Oct 20 \(before the open\)$/);
  assert.deepEqual(w.context, ['earnings due Tue Oct 20 (before the open)']);
});

test('prewarm: 16:05 / 16:20 ET after the close (13:05 / 13:20 on early closes) and 09:45 ET; the scheduler entry matches', () => {
  assert.equal(usMoversPrewarmDue(new Date('2026-10-15T20:05:00Z')), 'close');       // 16:05 EDT
  assert.equal(usMoversPrewarmDue(new Date('2026-10-15T20:20:00Z')), 'close');
  assert.equal(usMoversPrewarmDue(new Date('2026-10-15T13:45:00Z')), 'open');        // 09:45 EDT
  assert.equal(usMoversPrewarmDue(new Date('2026-12-15T21:05:00Z')), 'close');       // 16:05 EST
  assert.equal(usMoversPrewarmDue(new Date('2026-12-15T14:45:00Z')), 'open');        // 09:45 EST
  assert.equal(usMoversPrewarmDue(new Date('2026-11-27T18:05:00Z')), 'close');       // Black Friday 13:05 EST
  assert.equal(usMoversPrewarmDue(new Date('2026-10-15T21:05:00Z')), null);          // 17:05 EDT — not a prewarm minute
  assert.equal(usMoversPrewarmDue(new Date('2026-10-17T20:05:00Z')), null);          // Saturday
  assert.equal(usMoversPrewarmDue(new Date('2026-11-26T20:05:00Z')), null);          // Thanksgiving
  const job = LIGHT_JOBS.find((j) => j.name === 'us-movers-prewarm');
  assert.ok(job, 'the light job exists');
  assert.deepEqual([...job!.crons], [...US_MOVERS_PREWARM_CRONS], 'crons equal the lib constant');
});

test('scanner: the industry column is requested and read', () => {
  const cols = scanBody().columns as readonly string[];
  assert.ok(cols.includes('industry'));
  const d = cols.map((c) => (c === 'name' ? 'FRO' : c === 'industry' ? 'Marine Shipping' : c === 'sector' ? 'Transportation' : c === 'description' ? 'Frontline' : c === 'exchange' ? 'NYSE' : 1));
  assert.equal(rowFromScanData(d)!.industry, 'Marine Shipping');
});
