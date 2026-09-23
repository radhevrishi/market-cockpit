// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION FIXTURE — the research view model.                 (zzz770 AG-A)
//
// Findings shaped exactly as buildFinding() stores them, one per case the
// owner named: large order / small cap, small order / large cap, acquisition,
// capacity expansion (Pearl Global's stated before → after), earnings beat and
// miss, financing, denial, accident, listing artifact, no catalyst, band print,
// unclassified filing, portfolio holding vs non-holding, source failure — plus
// the enabling-stage traps (JSWINFRA LoI, MoU, board-approved capex), an LoA
// (PACEDIGITK), an approval, routine paperwork and a stale result.
// Deterministic: fixed dates, no clock.
// ═══════════════════════════════════════════════════════════════════════════

import type { Finding } from '../../ai-gainers/catalyst-research';
import type { ResearchViewInput } from '../../ai-gainers/research-view';

export const FIXTURE_NOW = '2026-09-23T12:00:00.000Z';

function mk(p: Partial<Finding> & { ticker: string }): Finding {
  return {
    company: `${p.ticker} Ltd`, market: 'IN', movePct: 5, marketCap: 1000, turnover: 20,
    status: 'none', category: null, stage: null, headline: null, evidenceQuote: null, sourceUrl: null, sourceDate: null,
    sourceTier: 'unsourced', ageDays: null, valueStated: null, valuePctMcap: null, net: null, components: null, verdict: null,
    returns: { m1: 6, m3: 10, m6: 15, y1: 30, history: 250 }, bandPrint: false, bandLevel: null, listingDays: null,
    routine: [], filingsInWindow: 0, windowDays: 21, holding: false, notes: [], modelRead: false,
    researchedAt: FIXTURE_NOW, sources: ['screener.in'], rulesVersion: '2026-09-23.zzz770',
    ...p,
  } as Finding;
}

const url = (t: string) => `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${t}.pdf`;

export const FINDINGS: Record<string, Finding> = {
  // 1. Large order, small company — verified in the document.
  BIGORD: mk({ ticker: 'BIGORD', movePct: 5.2, marketCap: 900, status: 'catalyst', category: 'order_win', stage: 'executed',
    headline: 'Receipt of Letter of Award from NHAI for ₹488 Cr EPC contract', evidenceQuote: 'The Company has received a Letter of Award from NHAI for an EPC contract of ₹488 crore.',
    modelRead: true, sourceUrl: url('BIGORD'), sourceDate: '2026-09-22T18:10:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 488, valuePctMcap: 54.2,
    returns: { m1: 8, m3: 12, m6: 20, y1: 40, history: 250 } }),
  // 2. Small order, large company — subject line only.
  SMALLORD: mk({ ticker: 'SMALLORD', movePct: 20, marketCap: 1000, status: 'catalyst', category: 'order_win', stage: 'executed',
    headline: 'Bagged work order worth ₹5 Cr from a state utility', sourceUrl: url('SMALLORD'), sourceDate: '2026-09-23T10:00:00+05:30', sourceTier: 'primary', ageDays: 0,
    valueStated: 5, valuePctMcap: 0.5, returns: { m1: 25, m3: 30, m6: 35, y1: 50, history: 250 },
    notes: ["Headline from the filing subject and the source's summary; the document itself was not model-read — treat the figure as unverified."] }),
  // 3. Acquisition completed.
  ACQ: mk({ ticker: 'ACQ', movePct: 7, marketCap: 1200, status: 'catalyst', category: 'acquisition', stage: 'executed',
    headline: 'Completion of acquisition of 100% stake in Rheinmetall Components GmbH for ₹150 Cr', evidenceQuote: 'completed the acquisition of 100% of the share capital of Rheinmetall Components GmbH for a consideration of ₹150 crore',
    modelRead: true, sourceUrl: url('ACQ'), sourceDate: '2026-09-21T16:00:00+05:30', sourceTier: 'primary', ageDays: 2, valueStated: 150 }),
  // 4. Capacity — Pearl Global's stated before → after (small increment).
  PEARL: mk({ ticker: 'PEARL', company: 'Pearl Global Industries Ltd', movePct: 6, marketCap: 6000, status: 'catalyst', category: 'capacity_expansion', stage: 'executed',
    headline: 'Pearl Global commissions new garment facility in Bangladesh', evidenceQuote: 'The new facility has been commissioned, increasing the installed capacity from ~101 million pieces per annum to ~108 million pieces per annum.',
    modelRead: true, sourceUrl: url('PEARL'), sourceDate: '2026-09-22T11:00:00+05:30', sourceTier: 'primary', ageDays: 1 }),
  // 4b. Capacity — a material increment.
  CAPX: mk({ ticker: 'CAPX', movePct: 4, marketCap: 800, status: 'catalyst', category: 'capacity_expansion', stage: 'executed',
    headline: 'Commissioning of expanded specialty chemicals plant at Dahej', evidenceQuote: 'The Company has commissioned the expansion, increasing capacity from 50,000 TPA to 80,000 TPA at Dahej.',
    modelRead: true, sourceUrl: url('CAPX'), sourceDate: '2026-09-22T09:00:00+05:30', sourceTier: 'primary', ageDays: 1 }),
  // 5. Earnings beat — filed result, no other filing.
  EARNBEAT: mk({ ticker: 'EARNBEAT', movePct: 8, marketCap: 7182, status: 'routine_only',
    headline: 'Quarterly result on file — ranked in the filed-results rows of the research queue. 1 filing in window, all routine (Outcome of board meeting)',
    sourceTier: 'primary', ageDays: 2 }),
  // 6. Earnings miss.
  EARNMISS: mk({ ticker: 'EARNMISS', movePct: 3, marketCap: 1500, status: 'none', headline: 'Quarterly result on file — No filing in the last 21 days' }),
  // 7. Financing (equity) — never a positive catalyst.
  FINANCE: mk({ ticker: 'FINANCE', movePct: 9, marketCap: 700, status: 'catalyst', category: 'fundraising', stage: 'executed',
    headline: 'Allotment of 50,00,000 equity shares on preferential basis at ₹120 per share', sourceUrl: url('FINANCE'), sourceDate: '2026-09-22T19:00:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 60 }),
  // 8. Denial.
  DENY: mk({ ticker: 'DENY', movePct: 18, marketCap: 400, status: 'denied', headline: 'Company told the exchange it has no undisclosed information (2026-09-22)',
    sourceUrl: url('DENY'), sourceDate: '2026-09-22T12:00:00+05:30', sourceTier: 'primary', ageDays: 1, returns: { m1: 60, m3: 90, m6: 120, y1: 200, history: 250 },
    notes: ['A denial on a stock that is moving is a caution flag, not a catalyst.'] }),
  // 9. Accident.
  ACCIDENT: mk({ ticker: 'ACCIDENT', movePct: 2.5, marketCap: 2500, status: 'negative', category: null,
    headline: 'Major fire at Unit II; operations temporarily suspended', sourceUrl: url('ACCIDENT'), sourceDate: '2026-09-22T08:00:00+05:30', sourceTier: 'primary', ageDays: 1 }),
  // 10. Listing artifact.
  LISTED: mk({ ticker: 'LISTED', movePct: 14, marketCap: 1800, status: 'listing_artifact', listingDays: 12, returns: { m1: null, m3: null, m6: null, y1: null, history: 12 },
    headline: 'Listed ~12 sessions ago — no comparable prior close' }),
  // 11. No catalyst, big move.
  NOCAT: mk({ ticker: 'NOCAT', movePct: 30, marketCap: 600, status: 'none', headline: 'No filing in the last 21 days', returns: { m1: 45, m3: 60, m6: 70, y1: 90, history: 250 } }),
  // 12. Band print.
  BAND: mk({ ticker: 'BAND', movePct: 20, marketCap: 300, turnover: 4, status: 'none', bandPrint: true, bandLevel: 20, headline: 'No filing in the last 21 days',
    notes: ['Closed at the 20% band (avg daily value ~₹4.0 Cr, 1-week average) — a band print measures the band, not demand.'] }),
  // 13. Unclassified filing.
  UNCL: mk({ ticker: 'UNCL', movePct: 6, status: 'routine_only', headline: '2 filings in window; 1 not classifiable from the subject (General Updates)',
    sourceUrl: url('UNCL'), sourceTier: 'primary', ageDays: 3 }),
  // 14. Portfolio holding with a moderate verified order.
  HOLDCO: mk({ ticker: 'HOLDCO', movePct: 4, marketCap: 2000, holding: true, status: 'catalyst', category: 'order_win', stage: 'executed',
    headline: 'Secured purchase order of ₹180 Cr from Indian Railways', evidenceQuote: 'has secured a purchase order of ₹180 crore from Indian Railways for supply over 3 years',
    modelRead: true, sourceUrl: url('HOLDCO'), sourceDate: '2026-09-22T15:00:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 180 }),
  // 15. Non-holding twin.
  NONHOLD: mk({ ticker: 'NONHOLD', movePct: 4, marketCap: 2000, status: 'catalyst', category: 'order_win', stage: 'executed',
    headline: 'Secured purchase order of ₹180 Cr from Indian Railways', evidenceQuote: 'has secured a purchase order of ₹180 crore from Indian Railways for supply over 3 years',
    modelRead: true, sourceUrl: url('NONHOLD'), sourceDate: '2026-09-22T15:00:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 180 }),
  // 16. Source failure.
  SRCFAIL: mk({ ticker: 'SRCFAIL', movePct: 11, status: 'source_failed', sources: [], notes: ['The filing source could not be reached — this is not "nothing filed".'] }),
  // 17. JSWINFRA — a Letter of Intent is ENABLING, never an order win.
  JSWINFRA: mk({ ticker: 'JSWINFRA', company: 'JSW Infrastructure Ltd', movePct: 3.4, marketCap: 60000, status: 'catalyst', category: 'order_win', stage: 'enabling',
    headline: 'JSW Infrastructure receives Letter of Intent for development of a multipurpose terminal', sourceUrl: url('JSWINFRA'), sourceDate: '2026-09-22T17:00:00+05:30', sourceTier: 'primary', ageDays: 1,
    notes: ['ENABLING, not executed: a board considering something has no size, no price and no counterparty yet.'] }),
  // 18. PACEDIGITK — a Letter of Award received is AWARDED.
  PACEDIGITK: mk({ ticker: 'PACEDIGITK', movePct: 6.5, marketCap: 2800, status: 'catalyst', category: 'order_win', stage: 'executed',
    headline: 'Receipt of Letter of Award for supply and installation of solar pumps worth Rs. 4,884.61 Million, to be completed by March 2027', sourceUrl: url('PACEDIGITK'),
    sourceDate: '2026-09-22T13:00:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 488.46 }),
  // 19. MoU presented as an order.
  MOUCO: mk({ ticker: 'MOUCO', movePct: 12, marketCap: 500, status: 'catalyst', category: 'order_win', stage: 'enabling',
    headline: 'Signs MoU with State Government for ₹2,000 Cr investment and order pipeline', sourceUrl: url('MOUCO'), sourceDate: '2026-09-22T10:00:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 2000 }),
  // 20. Board approval presented as executed capex.
  BOARDAPP: mk({ ticker: 'BOARDAPP', movePct: 5, marketCap: 1100, status: 'catalyst', category: 'capacity_expansion', stage: 'enabling',
    headline: 'Board approves capex of ₹300 Cr for greenfield plant, subject to shareholder approval', sourceUrl: url('BOARDAPP'), sourceDate: '2026-09-22T16:00:00+05:30', sourceTier: 'primary', ageDays: 1, valueStated: 300 }),
  // 21. Regulatory approval.
  APPROVAL: mk({ ticker: 'APPROVAL', movePct: 4.5, marketCap: 3000, status: 'catalyst', category: 'regulatory_approval', stage: 'executed',
    headline: 'Receives USFDA final approval for ANDA of Dapagliflozin tablets', evidenceQuote: 'has received final approval from the USFDA for its ANDA for Dapagliflozin Tablets',
    modelRead: true, sourceUrl: url('APPROVAL'), sourceDate: '2026-09-22T09:30:00+05:30', sourceTier: 'primary', ageDays: 1 }),
  // 22. Routine paperwork only.
  ROUTINE: mk({ ticker: 'ROUTINE', movePct: 7, status: 'routine_only', headline: '3 filings in window, all routine (AGM notice; BRSR)', sourceUrl: url('ROUTINE'), sourceTier: 'primary', ageDays: 4,
    routine: ['AGM notice', 'BRSR', 'Newspaper publication'] }),
  // 23. A stale (40-day-old) strong result.
  STALEEARN: mk({ ticker: 'STALEEARN', movePct: 6, marketCap: 3000, status: 'none', headline: 'Quarterly result on file — No filing in the last 21 days', returns: { m1: 10, m3: 18, m6: 25, y1: 40, history: 250 } }),
  // 24. A shouted broker rating in source text — never passed through as an instruction.
  BROKER: mk({ ticker: 'BROKER', movePct: 5, status: 'routine_only', headline: '1 filing in window, all routine (Brokerage initiates coverage with BUY rating)', sourceTier: 'primary', ageDays: 2 }),
};

export const FILED_RESULTS: any[] = [
  { ticker: 'BIGORD', quarter: 'Q1 FY27', filing_date: '2026-08-10', _ageDays: 44, sales_curr_cr: 270, sales_prev_cr: 230, sales_yoy_pct: 17.4, quarters_sales: [240, 250, 260, 270], tier: 'MIXED' },
  { ticker: 'EARNBEAT', company: 'Knowledge Marine & Engineering Works Ltd', tier: 'BLOCKBUSTER', quarter: 'Q1 FY27', filing_date: '2026-09-21', _ageDays: 2,
    sales_curr_cr: 115, sales_prev_cr: 48, sales_yoy_pct: 139.58, pat_curr_cr: 63, pat_prev_cr: 11, net_profit_yoy_pct: 472.73, eps_yoy_pct: 380.65,
    opm_pct: 64, opm_prev_pct: 41, ocf_to_pat_ratio: 1.17, filing_url: 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=EARNBEAT' },
  { ticker: 'EARNMISS', tier: 'AVOID', quarter: 'Q1 FY27', filing_date: '2026-09-20', _ageDays: 3, sales_curr_cr: 88, sales_prev_cr: 100, sales_yoy_pct: -12, pat_curr_cr: 5.5, pat_prev_cr: 10, pat_yoy_pct: -45 },
  { ticker: 'STALEEARN', tier: 'BLOCKBUSTER', quarter: 'Q1 FY27', filing_date: '2026-08-14', _ageDays: 40, sales_curr_cr: 400, sales_prev_cr: 300, sales_yoy_pct: 33.3, pat_curr_cr: 60, pat_prev_cr: 35, pat_yoy_pct: 71.4 },
];

export function fixtureInput(): ResearchViewInput {
  const findings = JSON.parse(JSON.stringify(FINDINGS)) as Record<string, Finding>;
  return {
    market: 'IN',
    findings,
    board: Object.values(findings).map((f) => ({ ticker: f.ticker, company: f.company, move_pct: f.movePct, market_cap: f.marketCap })),
    filedResults: JSON.parse(JSON.stringify(FILED_RESULTS)),
    holdings: ['HOLDCO'],
    watchlist: [],
    errors: ['SRCFAIL: company page: proxy timeout after 20000 ms; chart: unreachable'],
    now: FIXTURE_NOW,
    session: { date: '2026-09-22', scanAt: FIXTURE_NOW, status: 'last_completed', cached: true, label: 'Tue, 22 Sep 2026 — last completed session', isToday: false },
  };
}

/** US: an offering (424B5) is supply; a 10-Q is the result; the move is 1-week. */
export function fixtureInputUS(): ResearchViewInput {
  const f = (p: Partial<Finding> & { ticker: string }) => mk({ market: 'US', marketCap: 800, ...p });
  const findings: Record<string, Finding> = {
    OFFR: f({ ticker: 'OFFR', movePct: 35, status: 'negative', category: 'dilution', headline: '424B5 — registration / prospectus for securities: supply, dilution or resale overhang',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/000000000000000001/x424b5.htm', sourceTier: 'primary', ageDays: 1,
      notes: ['An offering / registration is supply, not demand: it dilutes or releases stock for sale. No catalyst was filed beside it.'] }),
    TENQ: f({ ticker: 'TENQ', movePct: 12, status: 'catalyst', category: 'quarterly_result', stage: 'executed', headline: '10-Q · filed 16:05 ET after the close',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2/000000000000000002/x10q.htm', sourceTier: 'primary', ageDays: 2 }),
  };
  return {
    market: 'US', findings,
    board: Object.values(findings).map((x) => ({ ticker: x.ticker, company: x.company, move_pct: x.movePct, market_cap: x.marketCap })),
    filedResults: [], holdings: [], now: FIXTURE_NOW,
    session: { date: '2026-09-22', scanAt: FIXTURE_NOW, status: 'weekly_export', cached: true },
  };
}
