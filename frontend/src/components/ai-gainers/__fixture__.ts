// ═══════════════════════════════════════════════════════════════════════════
// DEV FIXTURE — a ResearchView for visual checks and the render test.
// Loaded by the page ONLY behind ?demo=1 (dynamic import), never on a normal
// visit. Figures are illustrative demo values, labelled DEMO on screen; they
// are not a record of any company's filing.                        (zzz770)
// ═══════════════════════════════════════════════════════════════════════════

import type { ResearchItem, ResearchView } from '@/lib/ai-gainers/research-view';

const base: ResearchItem = {
  ticker: '', company: null, market: 'IN', move1d: null, returns: { w1: null, m1: null, m3: null }, marketCap: null,
  eventClass: 'NO_CATALYST', eventType: 'No identified catalyst', headline: '', whatChanged: null, before: null, after: null,
  filedDate: null, stage: 'UNKNOWN', sourceConfidence: 'UNVERIFIED', sourceUrl: null, quote: null,
  materiality: { label: 'UNKNOWN', ratios: [], explanation: 'Not disclosed' },
  transmission: 'NONE', transmissionChain: [], persistence: 'UNKNOWN', expectationGap: { level: 'UNKNOWN', text: 'Unknown' },
  unknowns: [], researchNext: [], whyResearch: '', portfolio: { relevance: 'UNRELATED', thesisVariable: null, note: null },
  earnings: null, flags: { band: null, listing: false, dilution: false, denial: false, turnover: null },
  priority: 0, priorityReasons: [], scoreDetails: null,
};
const mk = (p: Partial<ResearchItem>): ResearchItem => ({ ...base, ...p, flags: { ...base.flags, ...(p.flags || {}) } });

const PACE = mk({
  ticker: 'PACEDIGITK', company: 'Pace Digitek Ltd', move1d: 8.2, returns: { w1: 11.4, m1: 6.3, m3: -4.1 }, marketCap: 4120,
  eventClass: 'CONFIRMED_MATERIAL', eventType: 'Order win',
  headline: 'Letter of Award for ₹488 Cr battery energy storage (BESS) project',
  whatChanged: 'Order inflow +₹488 Cr; first BESS award at this scale.', before: 'Order book: Not disclosed in filing', after: '+₹488 Cr BESS LoA (≈47.8% of TTM revenue)',
  filedDate: '2026-09-22', stage: 'AWARDED', sourceConfidence: 'VERIFIED_DOCUMENT', sourceUrl: 'https://www.bseindia.com/',
  quote: 'received a Letter of Award for supply, installation and commissioning of Battery Energy Storage System valued at ₹488 crore',
  materiality: { label: 'SIGNIFICANT', explanation: 'Order is nearly half of trailing revenue.', ratios: [
    { basis: 'ttm_revenue', pct: 47.8, text: '₹488 Cr ÷ ₹1,020 Cr TTM revenue = 47.8%' },
    { basis: 'market_cap', pct: 11.8, text: '₹488 Cr ÷ ₹4,120 Cr market cap = 11.8%' },
  ] },
  transmission: 'NEAR_TERM', transmissionChain: ['₹488 Cr BESS LoA', 'Execution over 18–24 months', 'Revenue +₹240 Cr/yr (if evenly executed)', 'Order margin: Not disclosed', 'TBD', 'TBD'],
  persistence: 'YEARS', expectationGap: { level: 'MODERATE', text: 'Stock +6% over 1M against an order ≈ half of revenue; margin unknown.' },
  unknowns: ['Order margin: Not disclosed', 'Execution timeline: Not disclosed', 'Customer: Not disclosed'],
  researchNext: ['What is the gross margin on BESS vs telecom EPC?', 'Execution period and milestone billing?', 'Working-capital need — advance received?', 'Is this repeatable (pipeline of tenders)?'],
  whyResearch: 'A new product line order worth ~48% of revenue — could re-base growth if margins hold.',
  priority: 86, priorityReasons: ['Fresh event (1 day)', 'Material vs revenue', 'Verified document', 'New business line'],
  scoreDetails: { freshness: 100, materiality: 90, transmission: 70, persistence: 80, sourceMult: 1, pricedIn: 0.3 },
});

const PEARL = mk({
  ticker: 'PGIL', company: 'Pearl Global Industries Ltd', move1d: 5.1, returns: { w1: 7.9, m1: 12.2, m3: 18.5 }, marketCap: 6900,
  eventClass: 'CONFIRMED_MATERIAL', eventType: 'Capacity expansion',
  headline: 'Capacity raised from 101M to 108M pieces a year — new unit operational',
  whatChanged: '+7M pieces/yr (+6.9%) capacity, now operational.', before: '101M pieces/yr', after: '108M pieces/yr',
  filedDate: '2026-09-21', stage: 'OPERATIONAL', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.nseindia.com/',
  materiality: { label: 'MODERATE', explanation: 'Capacity +6.9%; revenue effect depends on utilisation.', ratios: [
    { basis: 'current_capacity', pct: 6.9, text: '7M ÷ 101M pieces = 6.9% capacity added' },
  ] },
  transmission: 'NEAR_TERM', transmissionChain: ['New unit operational', 'Volume +6.9% at full utilisation', 'Revenue +≈6–7% (at constant realisation)', 'Operating leverage: TBD', 'TBD', 'TBD'],
  persistence: 'YEARS', expectationGap: { level: 'SMALL', text: 'Stock +18% over 3M — the expansion was flagged earlier.' },
  unknowns: ['Current utilisation: Not disclosed', 'Capex: Not disclosed'],
  researchNext: ['Utilisation of the existing 101M base?', 'Customer orders backing the added capacity?', 'Capex and payback?'],
  whyResearch: 'Holding: confirms the capacity leg of your thesis; check utilisation before crediting revenue.',
  portfolio: { relevance: 'HOLDING', thesisVariable: 'Capacity & utilisation', note: 'Thesis evidence — capacity step delivered on schedule.' },
  priority: 74, priorityReasons: ['In your book', 'Operational (not just announced)', 'Exchange filing'],
  scoreDetails: { freshness: 90, materiality: 55, transmission: 70, persistence: 80, sourceMult: 0.9, pricedIn: 0.5 },
});

const DEEP = mk({
  ticker: 'DEEPINDS', company: 'Deep Industries Ltd', move1d: 4.3, returns: { w1: 5.0, m1: -2.2, m3: 9.8 }, marketCap: 3050,
  eventClass: 'CONFIRMED_LOW_MATERIALITY', eventType: 'Contract',
  headline: '₹88 Cr ONGC charter-hire contract for a gas compression unit',
  whatChanged: '+₹88 Cr contract over 3 years.', before: null, after: null,
  filedDate: '2026-09-22', stage: 'AWARDED', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  materiality: { label: 'SMALL', explanation: '≈₹29 Cr a year against ≈₹560 Cr revenue.', ratios: [
    { basis: 'ttm_revenue', pct: 15.7, text: '₹88 Cr ÷ ₹560 Cr TTM revenue = 15.7% (over 3 years ≈ 5.2%/yr)' },
    { basis: 'market_cap', pct: 2.9, text: '₹88 Cr ÷ ₹3,050 Cr market cap = 2.9%' },
  ] },
  transmission: 'DIRECT', transmissionChain: ['₹88 Cr ONGC contract', 'Charter-hire day rates', '≈₹29 Cr/yr revenue', 'Margin: Not disclosed', 'TBD', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'SMALL', text: 'A 4% move for a ~5%/yr revenue add looks proportionate.' },
  unknowns: ['Day rate vs existing fleet: Not disclosed'],
  researchNext: ['Is this a renewal or new capacity?', 'Utilisation of the fleet?'],
  whyResearch: 'Routine-sized ONGC work; explains little of the move alone.',
  priority: 48, priorityReasons: ['Verified', 'Small vs revenue'],
  scoreDetails: { freshness: 100, materiality: 30, transmission: 80, persistence: 40, sourceMult: 0.9, pricedIn: 0.4 },
});

const OPTI = mk({
  ticker: 'OPTIEMUS', company: 'Optiemus Infracom Ltd', move1d: 9.6, returns: { w1: 14.0, m1: 21.5, m3: 30.2 }, marketCap: 5200,
  eventClass: 'POTENTIAL_UNVERIFIED', eventType: 'JV',
  headline: 'Board approves a JV for electronics component manufacturing',
  whatChanged: null, stage: 'ENABLING', sourceConfidence: 'SECONDARY_SUMMARY', sourceUrl: 'https://www.screener.in/',
  materiality: { label: 'UNKNOWN', ratios: [], explanation: 'No investment or revenue figure disclosed.' },
  transmission: 'LONG_TERM', transmissionChain: ['JV approved (enabling)', 'Partner / capex: Not disclosed', 'Not disclosed', 'Not disclosed', 'TBD', 'TBD'],
  persistence: 'UNKNOWN', expectationGap: { level: 'UNKNOWN', text: 'Stock +30% over 3M on an enabling approval — expectations may be ahead of facts.' },
  unknowns: ['JV partner: Not disclosed', 'Investment size: Not disclosed', 'Timeline: Not disclosed'],
  researchNext: ['Who is the JV partner and what stake?', 'Capex and funding source?', 'Any customer commitment?'],
  whyResearch: 'Enabling step only; worth a check because the stock already priced a lot of it.',
  priority: 41, priorityReasons: ['Large expectations vs enabling stage'],
  scoreDetails: { freshness: 90, materiality: 0, transmission: 30, persistence: 20, sourceMult: 0.6, pricedIn: 0.7 },
});

const TIRU = mk({
  ticker: 'TIRUPATIFL', company: 'Tirupati Forge Ltd', move1d: 6.8, returns: { w1: 8.8, m1: 15.1, m3: 44.0 }, marketCap: 610,
  eventClass: 'CONFIRMED_LOW_MATERIALITY', eventType: 'Fundraising',
  headline: 'Preferential issue of convertible warrants to promoter and non-promoter investors',
  whatChanged: 'Warrants issued; financing, not an operating change.', stage: 'SIGNED', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  materiality: { label: 'SMALL', ratios: [], explanation: 'Financing event; size vs market cap not disclosed in the summary.' },
  transmission: 'WEAK', transmissionChain: ['Warrants issued', 'Cash if exercised', 'Use of funds: Not disclosed', 'Not disclosed', 'Dilution on exercise', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'SMALL', text: 'Stock +44% over 3M — the raise follows the move.' },
  unknowns: ['Issue price vs market: Not disclosed', 'Use of proceeds: Not disclosed'],
  researchNext: ['Who are the allottees?', 'Issue price vs current price?', 'Stated use of proceeds?'],
  whyResearch: 'A raise is supply of shares; relevant only if the use of funds is a real expansion.',
  flags: { dilution: true, band: null, listing: false, denial: false, turnover: null },
  priority: 30, priorityReasons: ['Financing, not operations'],
  scoreDetails: { freshness: 80, materiality: 10, transmission: 10, persistence: 30, sourceMult: 0.9, pricedIn: 0.8 },
});

const RESULT = mk({
  ticker: 'SHILCTECH', company: 'Shilchar Technologies Ltd', move1d: 3.9, returns: { w1: 4.2, m1: 10.3, m3: 22.8 }, marketCap: 5800,
  eventClass: 'CONFIRMED_MATERIAL', eventType: 'Earnings',
  headline: 'Q1 FY27 results: revenue +38% YoY, EBITDA margin 25.4% (from 22.1%)',
  whatChanged: 'Revenue +38% YoY with ~330 bps margin expansion.',
  filedDate: '2026-09-19', stage: 'MONETIZING', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.nseindia.com/',
  materiality: { label: 'SIGNIFICANT', ratios: [], explanation: 'A full quarter of results — directly earnings.' },
  transmission: 'DIRECT', transmissionChain: ['Q1 FY27 filed', 'Transformer volumes + pricing', 'Revenue +38% YoY', 'Margin 22.1% → 25.4%', 'PAT +45% YoY', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'MODERATE', text: 'Stock +10% over 1M; street estimates Unknown.' },
  unknowns: ['Export share of order book: Not disclosed'],
  researchNext: ['Is the margin gain mix or pricing?', 'Order book cover in months?', 'CFO lagging PAT — receivables?'],
  whyResearch: 'Margin step-up with strong growth — test whether it is durable.',
  earnings: { revenueYoY: 38.1, revenueQoQ: 6.4, ebitdaYoY: 58.7, marginNow: 25.4, marginPrior: 22.1, patYoY: 45.0, cfoToPat: 0.62, guidance: 'NOT_STATED', orderBook: 'UP', keyChange: 'EBITDA margin +330 bps YoY', filedDaysAgo: 4 },
  priority: 70, priorityReasons: ['Earnings filed this week', 'Margin inflection'],
  scoreDetails: { freshness: 80, materiality: 80, transmission: 90, persistence: 50, sourceMult: 0.9, pricedIn: 0.5 },
});

const ASTEC = mk({
  ticker: 'ASTEC', company: 'Astec Lifesciences Ltd', move1d: 12.4, returns: { w1: 18.0, m1: 9.0, m3: -6.0 }, marketCap: 1900,
  eventClass: 'NEGATIVE', eventType: 'Denial',
  headline: 'Company states it has no undisclosed information behind the price movement',
  stage: 'UNKNOWN', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  whyResearch: 'The company denies a catalyst; the move is unsupported by any filing.',
  flags: { denial: true, band: null, listing: false, dilution: false, turnover: null }, priority: 22,
});
const SUNDROP = mk({
  ticker: 'SUNDROP', company: 'Sundrop Brands Ltd', move1d: 4.8, returns: { w1: 2.0, m1: -5.0, m3: -11.0 }, marketCap: 3300,
  eventClass: 'NEGATIVE', eventType: 'Accident / disruption',
  headline: 'Fire at the Hyderabad plant; production suspended pending assessment',
  stage: 'UNKNOWN', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  whyResearch: 'Production loss is Unknown; a rising price here is not explained by this filing.', priority: 20,
});

const LISTING = mk({
  ticker: 'NEWLIST', company: 'Newlist Engineering Ltd', move1d: 22.0, eventClass: 'LISTING', eventType: 'Market/technical move',
  headline: 'Listed 3 sessions ago — no comparable prior close', flags: { listing: true, band: null, dilution: false, denial: false, turnover: null },
  whyResearch: 'Excluded from fundamental comparison.',
});
const BAND = mk({
  ticker: 'MICROBAND', company: 'Microband Polymers Ltd', move1d: 5.0, eventClass: 'MARKET_MOVE_ONLY', eventType: 'Market/technical move',
  headline: 'Upper-circuit print on thin turnover', flags: { band: 5, turnover: 4.2, listing: false, dilution: false, denial: false },
});
const SECZ = mk({ ticker: 'SECZ', company: 'Sec Z Ltd', move1d: 17.9, headline: 'No meaningful filing', sourceConfidence: 'VERIFIED_FILING' });
const NOCATS = [SECZ, ...['ALPHAX', 'BETAWIRE', 'GAMMAAGRO', 'DELTAPACK'].map((t, i) => mk({ ticker: t, company: `${t[0]}${t.slice(1).toLowerCase()} Ltd`, move1d: 9 - i, headline: 'No meaningful filing in 21 days' }))];
const FAILED = mk({ ticker: 'SRCFAIL', company: 'Srcfail Ltd', move1d: 7.1, eventClass: 'DATA_UNAVAILABLE', eventType: 'No identified catalyst', headline: 'Filing source unreachable', whyResearch: 'Not checked — data unavailable.' });

export const DEMO_VIEW: ResearchView = {
  session: { date: '2026-09-22', scanAt: '2026-09-22T13:12:00Z', status: 'Last completed session', cached: true },
  summary: { scanned: 42, confirmed: 5, potential: 1, negative: 2, noCatalyst: 26, queue: 4, portfolioMatches: 1, dataUnavailable: 1 },
  top3: [PACE, PEARL, RESULT],
  queue: [PACE, PEARL, RESULT, DEEP],
  watch: [OPTI, TIRU],
  negative: [ASTEC, SUNDROP],
  noCatalyst: [...NOCATS, BAND],
  dataQuality: [LISTING, FAILED],
  sourceFailures: [{ ticker: 'SRCFAIL', text: 'company page unavailable (screener.in)', full: 'SRCFAIL: company page: proxy timeout after 20000 ms; chart: unreachable' }],
  portfolio: [PEARL],
};
