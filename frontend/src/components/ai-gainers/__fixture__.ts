// ═══════════════════════════════════════════════════════════════════════════
// DEV FIXTURE — a ResearchView for visual checks and the render test.
// Loaded by the page ONLY behind ?demo=1 (dynamic import), never on a normal
// visit. Figures are illustrative demo values, labelled DEMO on screen; they
// are not a record of any company's filing.                        (zzz770)
//
// zzz771 cases: catalystFor on every dated item; a CONTEXT item (47-day-old
// result) and a 55-day-old order in `context`; a RECENT (9d) order in the
// queue; a clarification NO_CATALYST row with a scanNote; a POTENTIAL
// preferential allotment with dilution + a named allottee; a bare BSE scrip
// code carrying displayTicker/displayCode; a US 424B3 NO_CATALYST + dilution.
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
  catalystFor: 'THIS_MOVE', ageDays: 1,
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
  catalystFor: 'THIS_MOVE', ageDays: 2,
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
  catalystFor: 'THIS_MOVE', ageDays: 1,
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
  catalystFor: 'THIS_MOVE', ageDays: 3,
  scoreDetails: { freshness: 80, materiality: 80, transmission: 90, persistence: 50, sourceMult: 0.9, pricedIn: 0.5 },
});

const ASTEC = mk({
  ticker: 'ASTEC', company: 'Astec Lifesciences Ltd', move1d: 12.4, returns: { w1: 18.0, m1: 9.0, m3: -6.0 }, marketCap: 1900,
  eventClass: 'NEGATIVE', eventType: 'Denial',
  headline: 'Company states it has no undisclosed information behind the price movement',
  stage: 'UNKNOWN', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  whyResearch: 'The company denies a catalyst; the move is unsupported by any filing.',
  flags: { denial: true, band: null, listing: false, dilution: false, turnover: null }, priority: 22, catalystFor: 'THIS_MOVE', ageDays: 0,
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
// zzz771: a clarification is NO_CATALYST + flags.denial — neutral, never red.
const CLARIFY = mk({
  ticker: 'GAMMAAGRO', company: 'Gammaagro Ltd', move1d: 7.0, returns: { w1: 9.1, m1: 3.0, m3: -1.2 }, marketCap: 880,
  eventClass: 'NO_CATALYST', eventType: 'Denial',
  headline: 'Clarification to the exchange: no undisclosed information behind the price movement',
  filedDate: '2026-09-22', stage: 'UNKNOWN', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  scanNote: 'Scanned 21 days of BSE/NSE announcements: 1 price-movement clarification, 0 results, 0 orders, 0 capex filings.',
  whyResearch: 'The company answered the exchange; nothing filed explains the move.',
  flags: { denial: true, band: null, listing: false, dilution: false, turnover: null },
  unknowns: ['Cause of the move: Unknown', 'Turnover versus average: Unknown'], researchNext: ['Check turnover and delivery % behind the move.', 'Check bulk/block deals and shareholding changes.'],
  catalystFor: 'THIS_MOVE', ageDays: 0, priority: 8,
});
// zzz771: a US resale prospectus adds shares but is not an operating event.
const US424 = mk({
  ticker: 'XYZQ', company: 'Xyzq Therapeutics Inc', market: 'US', move1d: null, move: { pct: 31.2, window: '1W' }, returns: { w1: 31.2, m1: 40.5, m3: 12.0 }, marketCap: 210,
  eventClass: 'NO_CATALYST', eventType: 'Fundraising', eventLabel: 'Resale prospectus (424B3)',
  headline: '424B3 prospectus supplement — resale registration by existing holders; no operating event in 7 days',
  filedDate: '2026-09-18', stage: 'ENABLING', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.sec.gov/',
  scanNote: 'Scanned EDGAR 7 days: 1 424B3, 0 8-K, 0 press releases.',
  whyResearch: 'Supply of shares, not demand; the week’s move is unexplained by filings.',
  flags: { dilution: true, band: null, listing: false, denial: false, turnover: null },
  unknowns: ['Cause of the move: Unknown'], researchNext: ['Check volume versus the 1-week average.', 'Who is selling under the resale registration?'],
  catalystFor: 'THIS_MOVE', ageDays: 4, priority: 6,
});
const NOCATS = [SECZ, ...['ALPHAX', 'BETAWIRE'].map((t, i) => mk({ ticker: t, company: `${t[0]}${t.slice(1).toLowerCase()} Ltd`, move1d: 9 - i, headline: 'No meaningful filing in 21 days', scanNote: 'Scanned 21 days of BSE/NSE announcements: 0 results, 0 orders, 0 capex filings.' })), CLARIFY, US424];
const FAILED = mk({ ticker: 'SRCFAIL', company: 'Srcfail Ltd', move1d: 7.1, eventClass: 'DATA_UNAVAILABLE', eventType: 'No identified catalyst', headline: 'Filing source unreachable', whyResearch: 'Not checked — data unavailable.' });

// zzz771: RECENT — a 9-day-old award; a delayed reaction is possible, so it
// stays in the queue with a freshness penalty (never in the top 3 here).
const ARCHEM = mk({
  ticker: 'ARCHEMTEK', company: 'Archemtek Industries Ltd', move1d: 6.1, returns: { w1: 7.3, m1: 4.0, m3: 2.2 }, marketCap: 1450,
  eventClass: 'CONFIRMED_MATERIAL', eventType: 'Order win',
  headline: 'Work order of ₹212 Cr from a state transmission utility for substation packages',
  whatChanged: 'Order inflow +₹212 Cr (≈24% of TTM revenue).', filedDate: '2026-09-13', stage: 'AWARDED', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.nseindia.com/',
  materiality: { label: 'MODERATE', explanation: 'About a quarter of trailing revenue.', ratios: [{ basis: 'ttm_revenue', pct: 24.1, text: '₹212 Cr ÷ ₹880 Cr TTM revenue = 24.1%' }] },
  transmission: 'NEAR_TERM', transmissionChain: ['₹212 Cr work order', 'Execution 12–18 months', 'Revenue +≈₹150 Cr/yr', 'Margin: Not disclosed', 'TBD', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'MODERATE', text: 'Stock +4% over 1M since the award; today’s move came 9 days later.' },
  unknowns: ['Order margin: Not disclosed', 'Execution period: Not disclosed'], researchNext: ['Why the reaction 9 days after the filing?', 'Margin on substation packages vs company average?'],
  whyResearch: 'A meaningful award filed 9 days ago — check whether today’s move is a delayed reaction or something new.',
  priority: 58, priorityReasons: ['Material vs revenue', 'Freshness penalty (9 days)'],
  scoreDetails: { freshness: 55, materiality: 60, transmission: 70, persistence: 40, sourceMult: 0.9, pricedIn: 0.4 },
  catalystFor: 'RECENT', ageDays: 9,
});

// zzz771: a bare BSE scrip code — the pipeline supplies the name as the
// title and the code small beside it; the company line is not repeated.
const SCRIP = mk({
  ticker: '544501', displayTicker: 'Demo Fabrics Ltd', displayCode: '544501', company: 'Demo Fabrics Ltd',
  move1d: 5.4, returns: { w1: 6.0, m1: 1.1, m3: 3.3 }, marketCap: 390,
  eventClass: 'CONFIRMED_LOW_MATERIALITY', eventType: 'Order win',
  headline: 'Export order of ₹9 Cr for technical textiles from a European customer',
  whatChanged: '+₹9 Cr order.', filedDate: '2026-09-22', stage: 'AWARDED', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  materiality: { label: 'SMALL', explanation: 'Small against ≈₹210 Cr revenue.', ratios: [{ basis: 'ttm_revenue', pct: 4.3, text: '₹9 Cr ÷ ₹210 Cr TTM revenue = 4.3%' }] },
  transmission: 'NEAR_TERM', transmissionChain: ['₹9 Cr export order', 'Not disclosed', '≈4% of revenue', 'Margin: Not disclosed', 'TBD', 'TBD'],
  persistence: 'DAYS', expectationGap: { level: 'SMALL', text: 'A 5% move on a 4%-of-revenue order.' },
  unknowns: ['Order margin: Not disclosed'], researchNext: ['Is this a repeat customer?'],
  whyResearch: 'Small and routine; explains little of the move.', priority: 34, priorityReasons: ['Verified', 'Small vs revenue'],
  catalystFor: 'THIS_MOVE', ageDays: 1,
});

// zzz771: POTENTIAL preferential allotment with a named allottee — DILUTION
// in the class colour (amber), never red; the allottee text is shown as given.
const PREF = mk({
  ticker: 'NOVAPOLY', company: 'Novapoly Chemicals Ltd', move1d: 8.9, returns: { w1: 10.2, m1: 19.0, m3: 35.5 }, marketCap: 2100,
  eventClass: 'POTENTIAL_UNVERIFIED', eventType: 'Fundraising', eventLabel: 'Preferential allotment (proposed)',
  headline: 'Board to consider a preferential allotment of 12.5 lakh equity shares to Alpha Growth Mutual Fund at ₹412 per share',
  whatChanged: null, filedDate: '2026-09-22', stage: 'PROPOSED', sourceConfidence: 'SECONDARY_SUMMARY', sourceUrl: 'https://www.screener.in/',
  materiality: { label: 'SMALL', explanation: '≈₹51 Cr ÷ ₹2,100 Cr market cap = 2.4%.', ratios: [{ basis: 'market_cap', pct: 2.4, text: '₹51 Cr ÷ ₹2,100 Cr market cap = 2.4%' }] },
  transmission: 'WEAK', transmissionChain: ['Preferential allotment proposed', 'Cash on allotment', 'Use of proceeds: Not disclosed', 'Not disclosed', 'Dilution ≈2.4%', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'SMALL', text: 'Stock +35% over 3M — the raise follows the move.' },
  unknowns: ['Use of proceeds: Not disclosed', 'Issue price vs market: ₹412 stated; discount Unknown'],
  researchNext: ['Why is an institutional allottee taking a preferential stake?', 'Stated use of proceeds?', 'Lock-in and board approval date?'],
  whyResearch: 'An institutional allottee is a signal worth a check; the raise itself adds shares, not demand.',
  flags: { dilution: true, band: null, listing: false, denial: false, turnover: null },
  priority: 36, priorityReasons: ['Named institutional allottee', 'Financing, not operations'],
  catalystFor: 'THIS_MOVE', ageDays: 1,
});

// zzz771: CONTEXT — a 47-day-old result. Real, but not this move's catalyst;
// lives only in `context`, never in queue / top3 / confirmed.
const OLDRESULT = mk({
  ticker: 'VELOCAST', company: 'Velocast Engineering Ltd', move1d: 7.7, returns: { w1: 9.4, m1: 12.0, m3: 28.0 }, marketCap: 2650,
  eventClass: 'CONFIRMED_MATERIAL', eventType: 'Earnings',
  headline: 'Q1 FY27 results filed 47 days ago: revenue +22% YoY, PAT +31% YoY',
  whatChanged: 'Revenue +22% YoY; PAT +31% YoY (47 days ago).',
  filedDate: '2026-08-07', stage: 'MONETIZING', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.nseindia.com/',
  materiality: { label: 'MODERATE', ratios: [], explanation: 'Versus the prior-year quarter: revenue +22.0% YoY; PAT +31.0% YoY.' },
  transmission: 'DIRECT', transmissionChain: ['Q1 FY27 filed 47d ago', 'Not disclosed', 'Revenue +22% YoY', 'Margin: Not disclosed', 'PAT +31% YoY', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'UNKNOWN', text: 'Stock +28% over 3M since the result; today’s move is not explained by a 47-day-old filing.' },
  unknowns: ['Cause of today’s move: Unknown', 'Guidance: Not stated', 'CFO/PAT: Not disclosed'],
  researchNext: ['What happened today? Nothing newer is filed.', 'Check sector and peer moves in the same session.'],
  whyResearch: 'Context for the name only — the last real event is 47 days old.',
  earnings: { revenueYoY: 22.0, revenueQoQ: null, ebitdaYoY: null, marginNow: null, marginPrior: null, patYoY: 31.0, cfoToPat: null, guidance: 'NOT_STATED', orderBook: 'NOT_STATED', keyChange: 'PAT +31.0% YoY on revenue +22.0% YoY', filedDaysAgo: 47, quarter: 'Q1 FY27', filedDate: '2026-08-07', stale: true },
  priority: 18, priorityReasons: ['Older than the move window (47 days)'],
  scoreDetails: { freshness: 5, materiality: 55, transmission: 90, persistence: 50, sourceMult: 0.9, pricedIn: 0.6 },
  catalystFor: 'CONTEXT', ageDays: 47,
});
const OLDORDER = mk({
  ticker: 'KRONMETAL', company: 'Kronmetal Forgings Ltd', move1d: 6.3, returns: { w1: 8.0, m1: 15.0, m3: 21.0 }, marketCap: 1700,
  eventClass: 'CONFIRMED_LOW_MATERIALITY', eventType: 'Order win',
  headline: 'Order of ₹64 Cr for forged components — filed 55 days ago',
  whatChanged: '+₹64 Cr order (55 days ago).', filedDate: '2026-07-30', stage: 'AWARDED', sourceConfidence: 'VERIFIED_FILING', sourceUrl: 'https://www.bseindia.com/',
  materiality: { label: 'SMALL', explanation: '₹64 Cr ÷ ₹940 Cr TTM revenue = 6.8%.', ratios: [{ basis: 'ttm_revenue', pct: 6.8, text: '₹64 Cr ÷ ₹940 Cr TTM revenue = 6.8%' }] },
  transmission: 'NEAR_TERM', transmissionChain: ['₹64 Cr order (55d ago)', 'Not disclosed', '≈7% of revenue', 'Margin: Not disclosed', 'TBD', 'TBD'],
  persistence: 'QUARTER', expectationGap: { level: 'UNKNOWN', text: 'Nothing newer is filed; the order is 55 days old.' },
  unknowns: ['Cause of today’s move: Unknown'], researchNext: ['Check sector and peer moves in the same session.'],
  whyResearch: 'Context only — a small order from nearly two months ago.', priority: 12, priorityReasons: ['Older than the move window (55 days)'],
  catalystFor: 'CONTEXT', ageDays: 55,
});

export const DEMO_VIEW: ResearchView = {
  session: { date: '2026-09-22', scanAt: '2026-09-22T13:12:00Z', status: 'Last completed session', cached: true },
  summary: { scanned: 42, confirmed: 7, potential: 2, negative: 2, noCatalyst: 24, queue: 6, portfolioMatches: 1, dataUnavailable: 1, context: 2 },
  top3: [PACE, PEARL, RESULT],
  queue: [PACE, PEARL, RESULT, ARCHEM, DEEP, SCRIP],
  watch: [OPTI, PREF, TIRU],
  negative: [ASTEC, SUNDROP],
  noCatalyst: [...NOCATS, BAND],
  dataQuality: [LISTING, FAILED],
  sourceFailures: [{ ticker: 'SRCFAIL', text: 'company page unavailable (screener.in)', full: 'SRCFAIL: company page: proxy timeout after 20000 ms; chart: unreachable' }],
  portfolio: [PEARL],
  context: [OLDRESULT, OLDORDER],
};
