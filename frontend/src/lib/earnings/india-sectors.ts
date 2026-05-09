// ─────────────────────────────────────────────────────────────────────────────
// India sector taxonomy + sector-specific KPI templates
// ─────────────────────────────────────────────────────────────────────────────
// Maps screener.in / FMP industry strings to a canonical sector slug, and
// each sector to a KPI checklist that institutional analysts watch for.
// ─────────────────────────────────────────────────────────────────────────────

export type IndiaSector =
  | 'fmcg'
  | 'banks'
  | 'nbfc_insurance'
  | 'it_services'
  | 'pharma_healthcare'
  | 'auto'
  | 'industrials_capgoods'
  | 'metals_mining'
  | 'cement'
  | 'energy_oil_gas'
  | 'energy_power_renewable'
  | 'chemicals'
  | 'consumer_durables'
  | 'consumer_retail'
  | 'real_estate'
  | 'media_telecom'
  | 'defense_aerospace'
  | 'agri_food'
  | 'paper_packaging'
  | 'logistics_transport'
  | 'diversified';

export interface IndiaSectorKPI {
  label: string;
  description: string;
  importance: 'critical' | 'high' | 'medium';
}

// ── Working-capital benchmarks ─────────────────────────────────────────
// Tuple format: [good_max, mid_max, bad_floor]
//   - For "lower is better" metrics (debtor days / inventory / CCC):
//     value <= good_max  → green
//     value <= mid_max   → amber
//     value >  mid_max   → red
//   - For "higher is better" metrics (days payable, marked 'reverse' at
//     the call site): value >= good_max → green; value >= mid_max →
//     amber; else red.
//
// Calibrations are sector-aware because what's normal differs by 10×
// across the taxonomy:
//   - FMCG: 30-day debtor cycle is normal; 90 is alarming
//   - Capital Goods: 90-180 day debtor cycle is normal; 250+ is alarming
//   - Real Estate: project inventory is measured in years (730+ days)
//   - Banks / NBFCs: WC days are not meaningful → wide bands so the
//     UI doesn't scream red on a metric that doesn't apply.
// ────────────────────────────────────────────────────────────────────────
export interface WCBenchmark {
  debtorDays: [number, number, number];
  inventoryDays: [number, number, number];
  daysPayable: [number, number, number];      // higher-is-better; pass 'reverse' to wcTone
  cashConvCycle: [number, number, number];
  workingCapitalDays: [number, number, number];
  cfoOverPat: { good: number; mid: number };  // ≥good = green, ≥mid = amber, else red
}

export interface IndiaSectorTemplate {
  sector: IndiaSector;
  displayName: string;
  kpis: IndiaSectorKPI[];
  themes: string[];     // sector-relevant macro themes
  redFlags: string[];   // institutional warning signals
}

// ── Valuation discipline ───────────────────────────────────────────────
// Sector-aware fair P/E bands. Without these, a 105x P/E industrial gets
// the same "ACCUMULATE" verdict as a 22x P/E industrial — which mis-frames
// risk for any institutional reader. AEROFLEX at 105x in iron/steel is
// 4–6× sector typical; that has to override the fundamentals score
// before the verdict tier renders.
//
// Tuple format: [fair_low, fair_high, stretched, bubble]
//   - PE <= fair_high       → no flag
//   - fair_high < PE <= stretched → "Premium valuation"
//   - stretched < PE <= bubble    → "Stretched — verdict capped at Hold"
//   - PE > bubble                  → "Bubble — verdict capped at Avoid"
//
// Numbers calibrated against Indian 5-yr historical median +/- 1 stdev
// for each sector. Conservative on the upside so we don't suppress
// legitimately re-rating sectors (defense / cap-goods).
export interface ValuationBand {
  fairLow: number;
  fairHigh: number;
  stretched: number;
  bubble: number;
}

export const VALUATION_BANDS: Record<IndiaSector, ValuationBand> = {
  fmcg: { fairLow: 35, fairHigh: 60, stretched: 80, bubble: 110 },
  banks: { fairLow: 10, fairHigh: 20, stretched: 28, bubble: 40 },
  nbfc_insurance: { fairLow: 12, fairHigh: 25, stretched: 35, bubble: 50 },
  it_services: { fairLow: 20, fairHigh: 32, stretched: 45, bubble: 65 },
  pharma_healthcare: { fairLow: 18, fairHigh: 32, stretched: 45, bubble: 65 },
  auto: { fairLow: 12, fairHigh: 25, stretched: 35, bubble: 50 },
  industrials_capgoods: { fairLow: 25, fairHigh: 45, stretched: 65, bubble: 90 },
  // Iron/steel and base metals trade cyclically — fair P/E is low because
  // earnings peak in commodity ups; 105x P/E (AEROFLEX) is 5x sector typical.
  metals_mining: { fairLow: 8, fairHigh: 18, stretched: 28, bubble: 45 },
  cement: { fairLow: 18, fairHigh: 30, stretched: 42, bubble: 60 },
  energy_oil_gas: { fairLow: 8, fairHigh: 18, stretched: 28, bubble: 45 },
  energy_power_renewable: { fairLow: 12, fairHigh: 25, stretched: 38, bubble: 55 },
  chemicals: { fairLow: 18, fairHigh: 32, stretched: 45, bubble: 65 },
  consumer_durables: { fairLow: 28, fairHigh: 50, stretched: 70, bubble: 100 },
  consumer_retail: { fairLow: 35, fairHigh: 65, stretched: 90, bubble: 130 },
  real_estate: { fairLow: 12, fairHigh: 28, stretched: 42, bubble: 65 },
  media_telecom: { fairLow: 15, fairHigh: 28, stretched: 42, bubble: 60 },
  // Defense/aerospace currently re-rating; bands wider on the upside.
  defense_aerospace: { fairLow: 25, fairHigh: 50, stretched: 75, bubble: 110 },
  agri_food: { fairLow: 15, fairHigh: 28, stretched: 42, bubble: 60 },
  paper_packaging: { fairLow: 8, fairHigh: 18, stretched: 28, bubble: 45 },
  logistics_transport: { fairLow: 15, fairHigh: 28, stretched: 42, bubble: 60 },
  diversified: { fairLow: 15, fairHigh: 28, stretched: 42, bubble: 60 },
};

export type ValuationTier = 'fair' | 'premium' | 'stretched' | 'bubble' | 'na';

export interface ValuationAssessment {
  tier: ValuationTier;
  band: ValuationBand;
  pe: number | null;
  // Pretty label for the verdict pill
  label: string;
  // Multiplier vs sector mid (fair_low + fair_high) / 2
  vsSectorMidX: number | null;
}

// PEG-aware valuation. Growth context can downgrade a "bubble" P/E back
// to "stretched" when earnings compounding justifies the multiple.
//
// PEG = P/E ÷ EPS growth rate (4Q YoY trailing avg, in %).
// Institutional rule of thumb:
//   PEG <= 1.0  → cheap for the growth on offer
//   PEG <= 1.5  → fair for growth
//   PEG <= 2.0  → premium but defensible
//   PEG <= 3.0  → stretched
//   PEG  > 3.0  → expensive (true overvaluation, growth doesn't justify)
//
// The function returns the SAME ValuationAssessment shape but the tier
// is now growth-adjusted: a 105x P/E that would otherwise be 'bubble'
// becomes 'stretched' if EPS is compounding 50%+ (PEG ~2.1).
export function assessValuation(
  pe: number | null | undefined,
  sector: IndiaSector,
  epsGrowthPct: number | null = null,  // 4Q YoY trailing avg, pass null when unknown
): ValuationAssessment {
  const band = VALUATION_BANDS[sector];
  if (pe == null || !Number.isFinite(pe) || pe <= 0) {
    return { tier: 'na', band, pe: null, label: 'P/E n/a', vsSectorMidX: null };
  }
  const mid = (band.fairLow + band.fairHigh) / 2;
  const vsMid = mid > 0 ? Math.round((pe / mid) * 10) / 10 : null;

  // Step 1 — raw band tier from sector P/E ranges.
  let tier: ValuationTier;
  if (pe <= band.fairHigh) tier = 'fair';
  else if (pe <= band.stretched) tier = 'premium';
  else if (pe <= band.bubble) tier = 'stretched';
  else tier = 'bubble';

  // Step 2 — growth re-grade. When EPS is compounding strongly,
  // calculate PEG and downgrade the tier severity.
  //   PEG <= 2  : downgrade bubble → stretched, stretched → premium
  //   PEG <= 1.5: downgrade bubble → premium
  //   PEG <= 1  : downgrade bubble → fair (cheap for growth)
  // Only applies when epsGrowthPct >= 15% (else PEG math is meaningless;
  // small growers with high P/E really are expensive).
  let pegReason = '';
  if (epsGrowthPct !== null && epsGrowthPct >= 15) {
    const peg = pe / epsGrowthPct;
    pegReason = ` PEG ${peg.toFixed(1)} on ${epsGrowthPct.toFixed(0)}% EPS growth`;
    if (peg <= 1.0) {
      tier = 'fair';
    } else if (peg <= 1.5) {
      if (tier === 'bubble' || tier === 'stretched') tier = 'premium';
    } else if (peg <= 2.0) {
      if (tier === 'bubble') tier = 'stretched';
    } else if (peg <= 3.0) {
      // No downgrade — already at appropriate tier
    } else {
      // PEG > 3 with high growth: still expensive
    }
  }

  let label: string;
  if (tier === 'fair') label = `Fair valuation${pegReason}`;
  else if (tier === 'premium') label = `Premium valuation${pegReason}`;
  else if (tier === 'stretched') label = `Stretched — quality + premium pricing${pegReason}`;
  else label = `Expensive — multiple disconnected from growth${pegReason}`;

  return { tier, band, pe, label, vsSectorMidX: vsMid };
}

// Sector → working-capital benchmark map. Kept separate from
// INDIA_SECTOR_TEMPLATES so the template literals stay readable; the build
// pipeline merges these in at snapshot time.
export const WC_BENCHMARKS: Record<IndiaSector, WCBenchmark> = {
  fmcg: {
    debtorDays: [30, 45, 60],
    inventoryDays: [45, 75, 100],
    daysPayable: [90, 60, 30],
    cashConvCycle: [15, 45, 75],
    workingCapitalDays: [30, 60, 90],
    cfoOverPat: { good: 0.9, mid: 0.7 },
  },
  banks: {
    // Banks don't operate on WC days — wide bands so the UI doesn't paint
    // any cell red on a metric that's structurally meaningless.
    debtorDays: [180, 365, 730],
    inventoryDays: [180, 365, 730],
    daysPayable: [180, 90, 30],
    cashConvCycle: [180, 365, 730],
    workingCapitalDays: [180, 365, 730],
    cfoOverPat: { good: 0.7, mid: 0.4 },
  },
  nbfc_insurance: {
    debtorDays: [180, 365, 730],
    inventoryDays: [180, 365, 730],
    daysPayable: [180, 90, 30],
    cashConvCycle: [180, 365, 730],
    workingCapitalDays: [180, 365, 730],
    cfoOverPat: { good: 0.6, mid: 0.4 },
  },
  it_services: {
    debtorDays: [60, 90, 120],
    inventoryDays: [15, 30, 60],
    daysPayable: [60, 30, 15],
    cashConvCycle: [60, 90, 120],
    workingCapitalDays: [60, 100, 140],
    cfoOverPat: { good: 0.95, mid: 0.75 },
  },
  pharma_healthcare: {
    debtorDays: [60, 90, 120],
    inventoryDays: [90, 130, 180],
    daysPayable: [90, 60, 30],
    cashConvCycle: [60, 120, 180],
    workingCapitalDays: [80, 130, 180],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  auto: {
    debtorDays: [30, 60, 90],
    inventoryDays: [30, 60, 90],
    daysPayable: [60, 45, 30],
    cashConvCycle: [15, 45, 75],
    workingCapitalDays: [30, 75, 120],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  industrials_capgoods: {
    // Capital-goods companies typically run 90-180 day debtor cycles
    // and 90-200 day inventory (build-to-order, long execution).
    debtorDays: [75, 120, 180],
    inventoryDays: [75, 150, 220],
    daysPayable: [90, 60, 30],
    cashConvCycle: [75, 150, 220],
    workingCapitalDays: [100, 175, 250],
    cfoOverPat: { good: 0.7, mid: 0.45 },
  },
  metals_mining: {
    // Aeroflex Industries (Iron & Steel Products) lands here — typical
    // industrial-products WC profile, mid-cycle debtor exposure.
    debtorDays: [60, 105, 150],
    inventoryDays: [60, 100, 140],
    daysPayable: [60, 45, 30],
    cashConvCycle: [60, 110, 160],
    workingCapitalDays: [75, 130, 180],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  cement: {
    debtorDays: [30, 60, 90],
    inventoryDays: [30, 60, 90],
    daysPayable: [60, 45, 30],
    cashConvCycle: [30, 60, 90],
    workingCapitalDays: [45, 75, 105],
    cfoOverPat: { good: 0.9, mid: 0.7 },
  },
  energy_oil_gas: {
    debtorDays: [30, 60, 90],
    inventoryDays: [30, 60, 90],
    daysPayable: [60, 45, 30],
    cashConvCycle: [15, 45, 75],
    workingCapitalDays: [30, 60, 90],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  energy_power_renewable: {
    // DISCOM payment cycle pushes debtor days higher than other sectors.
    debtorDays: [60, 120, 180],
    inventoryDays: [30, 60, 90],
    daysPayable: [60, 45, 30],
    cashConvCycle: [60, 150, 240],
    workingCapitalDays: [75, 150, 240],
    cfoOverPat: { good: 0.9, mid: 0.7 },
  },
  chemicals: {
    debtorDays: [60, 90, 120],
    inventoryDays: [60, 100, 150],
    daysPayable: [60, 45, 30],
    cashConvCycle: [60, 100, 150],
    workingCapitalDays: [75, 120, 180],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  consumer_durables: {
    debtorDays: [45, 75, 100],
    inventoryDays: [60, 100, 140],
    daysPayable: [60, 45, 30],
    cashConvCycle: [45, 90, 130],
    workingCapitalDays: [60, 100, 140],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  consumer_retail: {
    // Retail collects cash at till — debtor days near zero is normal.
    debtorDays: [10, 25, 45],
    inventoryDays: [45, 75, 110],
    daysPayable: [60, 45, 30],
    cashConvCycle: [15, 45, 75],
    workingCapitalDays: [30, 60, 90],
    cfoOverPat: { good: 0.9, mid: 0.7 },
  },
  real_estate: {
    // Project inventory is measured in years not months — separate scale.
    debtorDays: [60, 120, 240],
    inventoryDays: [365, 730, 1460],
    daysPayable: [180, 90, 60],
    cashConvCycle: [365, 730, 1460],
    workingCapitalDays: [365, 730, 1460],
    cfoOverPat: { good: 0.7, mid: 0.4 },
  },
  media_telecom: {
    debtorDays: [45, 75, 105],
    inventoryDays: [30, 60, 90],
    daysPayable: [60, 45, 30],
    cashConvCycle: [30, 60, 90],
    workingCapitalDays: [45, 75, 105],
    cfoOverPat: { good: 0.95, mid: 0.75 },
  },
  defense_aerospace: {
    // Long-cycle contracts: 6-12 months payable / receivable common.
    debtorDays: [90, 180, 270],
    inventoryDays: [120, 220, 320],
    daysPayable: [90, 60, 30],
    cashConvCycle: [120, 240, 360],
    workingCapitalDays: [150, 280, 420],
    cfoOverPat: { good: 0.7, mid: 0.45 },
  },
  agri_food: {
    debtorDays: [30, 60, 90],
    inventoryDays: [60, 100, 150],
    daysPayable: [60, 45, 30],
    cashConvCycle: [45, 90, 130],
    workingCapitalDays: [60, 100, 140],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  paper_packaging: {
    debtorDays: [45, 75, 105],
    inventoryDays: [60, 90, 130],
    daysPayable: [60, 45, 30],
    cashConvCycle: [45, 90, 130],
    workingCapitalDays: [60, 100, 140],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
  logistics_transport: {
    debtorDays: [45, 75, 105],
    inventoryDays: [15, 30, 60],
    daysPayable: [60, 45, 30],
    cashConvCycle: [30, 60, 90],
    workingCapitalDays: [45, 75, 105],
    cfoOverPat: { good: 0.9, mid: 0.7 },
  },
  diversified: {
    // Mid-band defaults — used when sector cannot be mapped.
    debtorDays: [60, 100, 140],
    inventoryDays: [60, 100, 150],
    daysPayable: [75, 50, 30],
    cashConvCycle: [60, 110, 160],
    workingCapitalDays: [75, 130, 180],
    cfoOverPat: { good: 0.85, mid: 0.6 },
  },
};

// ── Sector templates ────────────────────────────────────────────────────
export const INDIA_SECTOR_TEMPLATES: Record<IndiaSector, IndiaSectorTemplate> = {
  fmcg: {
    sector: 'fmcg',
    displayName: 'FMCG / Consumer Staples',
    kpis: [
      { label: 'Volume Growth', description: 'Underlying unit volume growth (ex-pricing)', importance: 'critical' },
      { label: 'Rural / Urban Mix', description: 'Rural recovery vs urban consumption', importance: 'critical' },
      { label: 'Gross Margin', description: 'Sensitive to commodity costs (palm oil, milk, packaging)', importance: 'critical' },
      { label: 'Ad Spend Intensity', description: 'A&P spend as % of sales', importance: 'high' },
      { label: 'Distribution Reach', description: 'Direct outlets reached, depth of distribution', importance: 'high' },
      { label: 'New Product Mix', description: 'Innovation / NPD revenue share', importance: 'medium' },
      { label: 'Premiumization', description: 'Premium portfolio growth vs mass', importance: 'medium' },
    ],
    themes: ['rural recovery', 'urban consumption', 'premiumization', 'monsoon sensitivity', 'commodity inflation', 'GST impact'],
    redFlags: ['volume contraction', 'gross margin compression > 200 bps QoQ', 'channel destocking', 'distributor inventory build'],
  },
  banks: {
    sector: 'banks',
    displayName: 'Banks',
    kpis: [
      { label: 'Net Interest Margin (NIM)', description: 'Spread over deposits', importance: 'critical' },
      { label: 'Credit Growth', description: 'Loan book YoY %', importance: 'critical' },
      { label: 'GNPA / NNPA', description: 'Gross / Net non-performing assets ratio', importance: 'critical' },
      { label: 'CASA Ratio', description: 'Current+Savings deposits / total deposits', importance: 'high' },
      { label: 'PCR', description: 'Provision Coverage Ratio', importance: 'high' },
      { label: 'Cost-to-Income', description: 'Operational efficiency', importance: 'high' },
      { label: 'Slippages', description: 'Fresh NPA additions in the quarter', importance: 'high' },
      { label: 'CET1 Ratio', description: 'Capital adequacy', importance: 'medium' },
    ],
    themes: ['credit cycle', 'rate cycle', 'CASA accretion', 'corporate vs retail mix', 'digital banking', 'unsecured lending'],
    redFlags: ['NIM compression', 'GNPA increase', 'high slippages', 'rapid retail unsecured growth'],
  },
  nbfc_insurance: {
    sector: 'nbfc_insurance',
    displayName: 'NBFC / Insurance',
    kpis: [
      { label: 'AUM Growth', description: 'Assets Under Management YoY', importance: 'critical' },
      { label: 'Spread / NIM', description: 'Lending spread', importance: 'critical' },
      { label: 'Cost of Funds', description: 'Borrowing cost vs banks', importance: 'critical' },
      { label: 'Stage 3 Assets', description: 'IndAS NPA equivalent', importance: 'high' },
      { label: 'Persistency Ratio', description: 'For insurance: 13M/25M/61M persistency', importance: 'high' },
      { label: 'VNB Margin', description: 'Insurance: Value of New Business margin', importance: 'high' },
    ],
    themes: ['rate cycle', 'co-lending', 'rural credit', 'digital lending', 'private vs PSU'],
    redFlags: ['Stage 3 increase', 'cost of funds spike', 'persistency drop'],
  },
  it_services: {
    sector: 'it_services',
    displayName: 'IT Services',
    kpis: [
      { label: 'CC Revenue Growth', description: 'Constant-currency revenue growth QoQ', importance: 'critical' },
      { label: 'EBIT Margin', description: 'Operating margin trend', importance: 'critical' },
      { label: 'Deal TCV', description: 'Total Contract Value of new deals', importance: 'critical' },
      { label: 'Utilization', description: 'Billable utilization %', importance: 'high' },
      { label: 'Attrition (LTM)', description: 'Last-twelve-months attrition rate', importance: 'high' },
      { label: 'Headcount Growth', description: 'Net additions QoQ', importance: 'high' },
      { label: 'Revenue per Employee', description: 'Productivity metric', importance: 'medium' },
      { label: 'Vertical Mix', description: 'BFSI / Retail / Hi-Tech / Mfg split', importance: 'medium' },
    ],
    themes: ['BFSI vertical', 'hi-tech vertical', 'discretionary spend', 'GenAI adoption', 'cost takeout deals', 'attrition cycle'],
    redFlags: ['CC revenue contraction', 'margin contraction', 'TCV decline', 'rising attrition'],
  },
  pharma_healthcare: {
    sector: 'pharma_healthcare',
    displayName: 'Pharma / Healthcare',
    kpis: [
      { label: 'US Generics Pricing', description: 'Pricing erosion in US generics', importance: 'critical' },
      { label: 'India Branded Growth', description: 'IPM growth + acute/chronic mix', importance: 'critical' },
      { label: 'R&D / Sales', description: 'R&D intensity for innovation pipeline', importance: 'high' },
      { label: 'New Launches', description: 'Filings + approvals + launches', importance: 'high' },
      { label: 'EBITDA Margin', description: 'Mix and operating leverage', importance: 'high' },
      { label: 'API / Formulations Mix', description: 'Captive vs external API dependency', importance: 'medium' },
    ],
    themes: ['US generics pricing', 'India IPM growth', 'GLP-1', 'biosimilars', 'CDMO', 'specialty derma'],
    redFlags: ['FDA observation / warning letter', 'price erosion > 10% YoY', 'R&D cuts'],
  },
  auto: {
    sector: 'auto',
    displayName: 'Auto / Auto Components',
    kpis: [
      { label: 'Volumes', description: 'Domestic + exports unit volumes', importance: 'critical' },
      { label: 'ASP / Realization', description: 'Average selling price trend', importance: 'critical' },
      { label: 'EBITDA per Unit', description: 'Per-unit profitability', importance: 'high' },
      { label: 'EV Mix', description: 'EV share of revenue + ASP', importance: 'high' },
      { label: 'Export Mix', description: 'Export % of revenue', importance: 'medium' },
      { label: 'Inventory Days', description: 'Channel inventory health', importance: 'medium' },
    ],
    themes: ['rural demand', 'EV transition', 'commodity inflation', 'export demand', 'PV vs CV cycle', 'tractor demand'],
    redFlags: ['volume decline', 'inventory build > 30 days', 'EBITDA per unit compression'],
  },
  industrials_capgoods: {
    sector: 'industrials_capgoods',
    displayName: 'Industrials / Capital Goods',
    kpis: [
      { label: 'Order Inflow', description: 'New orders booked in quarter', importance: 'critical' },
      { label: 'Order Book / Backlog', description: 'Total backlog + book-to-bill', importance: 'critical' },
      { label: 'Execution / Revenue', description: 'Backlog conversion to revenue', importance: 'high' },
      { label: 'EBITDA Margin', description: 'Mix and operating leverage', importance: 'high' },
      { label: 'Working Capital Days', description: 'Cash conversion cycle', importance: 'high' },
      { label: 'Export Order Mix', description: 'Export contribution to backlog', importance: 'medium' },
    ],
    themes: ['government capex', 'private capex', 'PLI scheme', 'defense indigenization', 'railway modernization', 'China+1 supply chain'],
    redFlags: ['order inflow decline', 'execution slippage', 'working capital stretch'],
  },
  metals_mining: {
    sector: 'metals_mining',
    displayName: 'Metals & Mining',
    kpis: [
      { label: 'Realization per Tonne', description: 'Avg selling price per tonne', importance: 'critical' },
      { label: 'Cost per Tonne', description: 'Production cost trend', importance: 'critical' },
      { label: 'EBITDA per Tonne', description: 'Spread metric', importance: 'critical' },
      { label: 'Volumes', description: 'Production + sales volumes', importance: 'high' },
      { label: 'Net Debt', description: 'Leverage trajectory', importance: 'high' },
    ],
    themes: ['China demand', 'global commodity prices', 'safeguard duty', 'iron ore / coking coal', 'capex cycle'],
    redFlags: ['realization decline', 'cost spike', 'debt rise'],
  },
  cement: {
    sector: 'cement',
    displayName: 'Cement',
    kpis: [
      { label: 'Volume Growth', description: 'Sales volume YoY', importance: 'critical' },
      { label: 'Realization (₹/t)', description: 'Average selling price per tonne', importance: 'critical' },
      { label: 'EBITDA per Tonne', description: 'Margin metric', importance: 'critical' },
      { label: 'Cost per Tonne', description: 'Energy + freight + other', importance: 'high' },
      { label: 'Capacity Utilization', description: 'Operating capacity utilization', importance: 'high' },
    ],
    themes: ['housing demand', 'infrastructure spend', 'fuel cost (pet coke/coal)', 'consolidation'],
    redFlags: ['volume contraction', 'realization decline', 'EBITDA/t compression'],
  },
  energy_oil_gas: {
    sector: 'energy_oil_gas',
    displayName: 'Oil & Gas',
    kpis: [
      { label: 'GRM (₹/bbl)', description: 'Gross Refining Margin (refiners)', importance: 'critical' },
      { label: 'Marketing Margin', description: 'Marketing inventory gain/loss', importance: 'high' },
      { label: 'Subsidy Burden', description: 'Under-recovery (PSU OMCs)', importance: 'high' },
      { label: 'Production', description: 'Crude / gas production volumes (E&P)', importance: 'critical' },
      { label: 'Realization', description: 'Crude / gas price realization', importance: 'high' },
    ],
    themes: ['crude price', 'GRM cycle', 'rupee depreciation', 'OPEC policy'],
    redFlags: ['GRM crash', 'inventory loss', 'subsidy unfavorable'],
  },
  energy_power_renewable: {
    sector: 'energy_power_renewable',
    displayName: 'Power / Renewables',
    kpis: [
      { label: 'PLF (%)', description: 'Plant Load Factor', importance: 'critical' },
      { label: 'PPA Tariff', description: 'Realized tariff per kWh', importance: 'critical' },
      { label: 'Capacity / Pipeline', description: 'Operational + under-construction MW', importance: 'high' },
      { label: 'Receivables Days', description: 'DISCOM payment cycle', importance: 'high' },
      { label: 'Coal Cost', description: 'Cost per kWh (thermal)', importance: 'medium' },
    ],
    themes: ['renewable transition', 'DISCOM payments', 'merchant tariff', 'BESS / storage'],
    redFlags: ['receivable stretch', 'PLF decline', 'tariff under-recovery'],
  },
  chemicals: {
    sector: 'chemicals',
    displayName: 'Chemicals / Specialty Chemicals',
    kpis: [
      { label: 'Volume Growth', description: 'Underlying unit volume', importance: 'critical' },
      { label: 'Realization', description: 'Average selling price', importance: 'critical' },
      { label: 'Gross Margin', description: 'Raw material spread', importance: 'critical' },
      { label: 'Capex / Revenue', description: 'Capex intensity', importance: 'high' },
      { label: 'Export Mix', description: 'Export contribution', importance: 'high' },
    ],
    themes: ['China+1', 'agrochem cycle', 'specialty migration', 'capex cycle', 'realization recovery'],
    redFlags: ['China oversupply', 'realization crash', 'capacity overhang'],
  },
  consumer_durables: {
    sector: 'consumer_durables',
    displayName: 'Consumer Durables',
    kpis: [
      { label: 'Volume Growth', description: 'Unit sales growth', importance: 'critical' },
      { label: 'Gross Margin', description: 'Commodity-sensitive', importance: 'critical' },
      { label: 'Premium Mix', description: 'Premium product share', importance: 'high' },
      { label: 'Working Capital Days', description: 'Channel + inventory health', importance: 'high' },
    ],
    themes: ['summer demand', 'urban affluence', 'premiumization', 'AC penetration'],
    redFlags: ['inventory build', 'gross margin compression'],
  },
  consumer_retail: {
    sector: 'consumer_retail',
    displayName: 'Consumer / Retail',
    kpis: [
      { label: 'SSSG (Same-Store Sales Growth)', description: 'Like-for-like growth', importance: 'critical' },
      { label: 'New Store Adds', description: 'Footprint expansion', importance: 'high' },
      { label: 'Gross Margin', description: 'Mix + sourcing', importance: 'high' },
      { label: 'EBITDA Margin', description: 'Operating leverage', importance: 'high' },
      { label: 'Footfall / Conversion', description: 'Traffic and basket size', importance: 'medium' },
    ],
    themes: ['urban consumption', 'quick commerce', 'D2C', 'mall vs high-street'],
    redFlags: ['SSSG negative', 'gross margin compression'],
  },
  real_estate: {
    sector: 'real_estate',
    displayName: 'Real Estate',
    kpis: [
      { label: 'Pre-Sales', description: 'Pre-sales bookings value', importance: 'critical' },
      { label: 'Collections', description: 'Cash collections from bookings', importance: 'critical' },
      { label: 'Net Debt / Equity', description: 'Leverage', importance: 'high' },
      { label: 'Inventory (msf)', description: 'Unsold inventory', importance: 'high' },
    ],
    themes: ['housing cycle', 'rate cycle', 'consolidation', 'commercial vs residential'],
    redFlags: ['pre-sales decline', 'inventory build', 'debt rise'],
  },
  media_telecom: {
    sector: 'media_telecom',
    displayName: 'Media & Telecom',
    kpis: [
      { label: 'ARPU', description: 'Average Revenue Per User', importance: 'critical' },
      { label: 'Subscriber Net Adds', description: 'Subscriber base growth', importance: 'critical' },
      { label: 'Capex / Revenue', description: '5G / fiber investment intensity', importance: 'high' },
      { label: 'Net Debt / EBITDA', description: 'Leverage', importance: 'high' },
    ],
    themes: ['5G rollout', 'tariff hikes', 'consolidation', 'digital advertising'],
    redFlags: ['ARPU decline', 'subscriber loss'],
  },
  defense_aerospace: {
    sector: 'defense_aerospace',
    displayName: 'Defense / Aerospace',
    kpis: [
      { label: 'Order Book / Sales', description: 'Backlog cover ratio (years of revenue)', importance: 'critical' },
      { label: 'Order Inflow', description: 'New orders booked', importance: 'critical' },
      { label: 'EBITDA Margin', description: 'Mix-driven', importance: 'high' },
      { label: 'Indigenization Mix', description: 'Domestic content %', importance: 'high' },
      { label: 'Export Orders', description: 'Export pipeline', importance: 'high' },
    ],
    themes: ['defense indigenization', 'positive list / negative list', 'export push', 'naval / aerospace platforms', 'private sector entry'],
    redFlags: ['order delay', 'execution slippage', 'tender cancellation'],
  },
  agri_food: {
    sector: 'agri_food',
    displayName: 'Agri / Food Processing',
    kpis: [
      { label: 'Volume Growth', description: 'Unit volume', importance: 'critical' },
      { label: 'Realization', description: 'Per-kg pricing', importance: 'high' },
      { label: 'Gross Margin', description: 'Commodity-sensitive', importance: 'high' },
      { label: 'Export Mix', description: 'Export contribution', importance: 'medium' },
    ],
    themes: ['monsoon', 'MSP / minimum support price', 'agri-input cycle', 'export ban'],
    redFlags: ['volume drop', 'monsoon failure', 'realization volatility'],
  },
  paper_packaging: {
    sector: 'paper_packaging',
    displayName: 'Paper / Packaging',
    kpis: [
      { label: 'Realization', description: 'Per-tonne paper price', importance: 'critical' },
      { label: 'Volumes', description: 'Production + sales volumes', importance: 'high' },
      { label: 'EBITDA / Tonne', description: 'Margin metric', importance: 'high' },
    ],
    themes: ['import substitution', 'paper cycle', 'pulp prices'],
    redFlags: ['realization decline', 'imports surge'],
  },
  logistics_transport: {
    sector: 'logistics_transport',
    displayName: 'Logistics & Transport',
    kpis: [
      { label: 'Volume / Tonnage', description: 'Freight tonnage', importance: 'critical' },
      { label: 'Yield (₹/tonne-km)', description: 'Realization metric', importance: 'critical' },
      { label: 'EBITDA Margin', description: 'Operating margin', importance: 'high' },
      { label: 'Asset Utilization', description: 'Fleet / capacity utilization', importance: 'high' },
    ],
    themes: ['freight rates', 'multimodal', 'e-commerce volumes', 'rail-road shift'],
    redFlags: ['volume drop', 'yield compression'],
  },
  diversified: {
    sector: 'diversified',
    displayName: 'Diversified / Conglomerate',
    kpis: [
      { label: 'Segmental Revenue Mix', description: 'Revenue by segment', importance: 'critical' },
      { label: 'Segmental EBIT', description: 'Profit by segment', importance: 'critical' },
      { label: 'Capital Allocation', description: 'Capex per segment', importance: 'high' },
      { label: 'Holding Discount', description: 'NAV vs market cap', importance: 'medium' },
    ],
    themes: ['demerger / value unlocking', 'capex cycle', 'segment momentum'],
    redFlags: ['weakest-segment dragging', 'capital misallocation'],
  },
};

// ── Industry-string → sector mapper ──────────────────────────────────────
// CRITICAL: regexes use word boundaries to avoid false matches like
// "oil" matching "toiletries" or "metal" matching "metaphor".
// Order matters: more specific categories first (FMCG before generic
// consumer; bank before generic finance).
export function classifyIndiaSector(industry: string | null | undefined, fallbackText: string = ''): IndiaSector {
  const t = `${industry || ''} ${fallbackText || ''}`.toLowerCase();

  // FMCG first (so "personal product / household" doesn't fall through to
  // any generic consumer match)
  if (/\b(fmcg|consumer\s+staples|household\s*&?\s*personal\s+products?|personal\s+products?|household\s+products?|tobacco|beverage|consumer\s+food|hair\s+oil|cosmetic|toiletry|toiletries|soap|detergent)/.test(t)) return 'fmcg';

  if (/\b(bank(?:ing)?|psu\s+bank|private\s+bank)\b/.test(t)) return 'banks';
  if (/\b(insurance|asset\s+management|amc\b|stock\s+broker|broker(?:age)?|capital\s+market|nbfc\b|housing\s+finance|microfinance|small\s+finance|mutual\s+fund)/.test(t)) return 'nbfc_insurance';

  // IT — be careful with "it" as a substring
  if (/\b(it\s*[-–]\s*software|computers?\s*[-–]\s*software|software\s*[-–]\s*services|it\s+services|it\s+consulting|software\s+services|application\s+software|technology\s+services|computer\s+software)\b/.test(t)) return 'it_services';
  // Last-ditch IT match (riskier substrings)
  if (/\b(software|saas|cloud\s+services)\b/.test(t) && !/\bsoftware\s+(license|tool|product|company|company)/.test(t)) return 'it_services';

  if (/\b(pharmaceutical|pharma\b|drug|biotech|hospital|diagnostic|healthcare|medical\s+devices?|formulations?|api\s+manufactur|generics)/.test(t)) return 'pharma_healthcare';

  if (/\b(automobile|auto\s+(component|ancillary|parts?|industry|sector)|tyre|tire|tractor|two\s*-?\s*wheeler|four\s*-?\s*wheeler|commercial\s+vehicle|electric\s+vehicle|passenger\s+vehicle|automotive)\b/.test(t)) return 'auto';

  if (/\b(defen[cs]e|aerospace|aviation|shipyard|defence\s+&?\s*aerospace|aircraft|missile)\b/.test(t)) return 'defense_aerospace';

  if (/\b(capital\s+goods?|engineering|industrial(?:s)?|capgoods|industrial\s+machinery|electrical\s+equipment|bearings?|compressor|forging|casting|industrial\s+gases|construction\s+equipment|electrical\s+component)\b/.test(t)) return 'industrials_capgoods';

  if (/\b(iron\s*&?\s*steel|steel|aluminium|aluminum|copper|zinc\b|nonferrous\s+metals?|ferrous\s+metals?|metals?\s*&?\s*mining|mining|iron\s+ore|coal\b|ferro\s+alloy|precious\s+metals?)\b/.test(t)) return 'metals_mining';

  if (/\bcement\b/.test(t)) return 'cement';

  // Oil & Gas — use word boundaries strictly
  if (/\b(refiner(?:y|ies)?|petroleum|oil\s+&?\s*gas|crude\s+oil|natural\s+gas|lng\b|upstream|downstream|petrochemical|petro\s+products|gas\s+distribution)\b/.test(t)) return 'energy_oil_gas';

  if (/\b(power\s+(generation|distribution|utility|sector|company|grid)|electric\s+utility|electricity\s+generation|renewable\s+energy|solar\s+(power|panel|cell|farm|module)|wind\s+(power|turbine|farm)|hydro\s+power|thermal\s+power|gas\s+power|battery\s+storage|bess\b)\b/.test(t)) return 'energy_power_renewable';

  if (/\b(specialty\s+chemicals?|agrochemicals?|chemicals?\b|pesticide|fertilizer|paint\b|dye\s+(chemical|stuff)|industrial\s+chemicals?)\b/.test(t)) return 'chemicals';

  if (/\b(consumer\s+durables?|electronics\s+(appliance|component)|home\s+appliances?|fan\b|cooler|kitchen\s+appliances?|cooling\s+appliances?|consumer\s+electronics)\b/.test(t)) return 'consumer_durables';

  if (/\b(retail\s+(chain|trading|store|outlet)|e\s*-?\s*commerce|apparel|footwear|hotel(?:s|ing|ier)?|restaurant|qsr|hospitality|departmental\s+store|supermarket|hypermarket)\b/.test(t)) return 'consumer_retail';

  if (/\b(real\s+estate|realty|residential\s+construction|commercial\s+real\s+estate)\b/.test(t)) return 'real_estate';

  if (/\b(media\s+(content|broadcast)|broadcasting|entertainment|telecom\b|communication\s+services|cable\s+&?\s*satellite|telecom\s+services|wireless\s+services|fixed\s+line|publishing|print\s+media|tv\s+broadcast)\b/.test(t)) return 'media_telecom';

  if (/\b(agri\s+(business|input)|agricultural|tea\s+(industry|estate)|sugar\s+(industry|mill)|edible\s+oil|food\s+processing|seeds?\s+(industry|company)|dairy\s+products?)\b/.test(t)) return 'agri_food';

  if (/\b(paper\s+(industry|product)|packaging\s+(material|product)|corrugat|pulp\s+&?\s*paper|paperboard)\b/.test(t)) return 'paper_packaging';

  if (/\b(logistics|transport(?:ation)?|shipping\s+(line|company)|courier|airlines?|port\s+services?|railway|road\s+transport|cargo)\b/.test(t)) return 'logistics_transport';

  return 'diversified';
}
