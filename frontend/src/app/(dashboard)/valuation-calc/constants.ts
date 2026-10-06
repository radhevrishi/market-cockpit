// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { type SectorScenario, type GuidanceMethod } from './types';

// PATCH 0858 — BUY-zone upside threshold (percent). Reuses the same 25%
// "buy-ready" bar the Analytics tab already applies (ValuationAnalyticsPanel
// buyReady = base upside >= 25). A saved valuation whose LIVE upside crosses
// from below this to at/above it is a fresh WATCH→BUY signal.
export const BUY_UPSIDE = 25;
export const BG = '#0A0E1A';
export const CARD = '#0D1623';
export const BORDER = '#1A2540';
export const TEXT = '#E6EDF3';
export const DIM = '#8A95A3';
export const SECTOR_SCENARIOS: Record<string, SectorScenario> = {
  'Industrials / Capital Goods': {
    ticker: 'TDPOWERSYS', company: 'TD Power Systems', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 240, multiple: 35,
    currentMcap: 6800,
    rationale: 'Generator OEM with order-book backed FY27 revenue ₹2,200+ Cr guidance. PAT margin ~10%. Base P/E 35× for industrial cycle midpoint.',
  },
  'Defence': {
    ticker: 'HAL', company: 'Hindustan Aeronautics', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 9500, multiple: 40,
    currentMcap: 380000,
    rationale: 'PSU defence prime with multi-year order book. PE 30-50× sustainable on Govt-backed visibility. Discount premium when order intake decelerates.',
  },
  'Power / Transmission': {
    ticker: 'ATLANTAELE', company: 'Atlanta Electricals', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 180, multiple: 22,
    currentMcap: 3800, netDebt: 50,
    rationale: 'Power transformer manufacturer; capex cycle premium. EV/EBITDA 18-28× on China+1 mfg shift + grid modernization tailwind.',
  },
  'Pharmaceuticals': {
    ticker: 'RUBICON', company: 'Rubicon Research', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 220, multiple: 38,
    currentMcap: 8500,
    rationale: 'USFDA-approved specialty pharma. PE 30-45× sustainable on patent-pipeline visibility. Apply margin-pressure discount if generics pricing softens.',
  },
  'Specialty Chemicals': {
    ticker: 'NEOGEN', company: 'Neogen Chemicals', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 250, multiple: 25,
    currentMcap: 7200, netDebt: 200,
    rationale: 'Bromine specialty chemistry with CDMO contracts. Premium EV/EBITDA 20-30× on long-cycle visibility + import-substitution moat.',
  },
  'Consumer Durables / FMCG': {
    ticker: 'TITAN', company: 'Titan Company', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 5200, multiple: 55,
    currentMcap: 320000,
    rationale: 'Quality moat / category leader. PE 40-70× justifiable on brand pricing power + retail expansion. Stretches at cycle peak.',
  },
  'Auto Components': {
    ticker: 'CEAT', company: 'CEAT Tyres', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 1800, multiple: 14,
    currentMcap: 17500, netDebt: 1200,
    rationale: 'Auto-cycle exposure. EV/EBITDA 12-18× at cycle midpoint. Apply 0.8× multiple at cycle peak (raw material pressure ahead).',
  },
  'Financial Services / NBFC': {
    ticker: 'BAJFINANCE', company: 'Bajaj Finance', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 22000, multiple: 25,
    currentMcap: 480000,
    rationale: 'Premier NBFC. PE 18-28× pegged to ROE 22-25%. Higher ROE = higher multiple. Watch for credit-cost spikes that compress PE.',
  },
  'IT / Tech Services': {
    ticker: 'INFY', company: 'Infosys', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 30000, multiple: 26,
    currentMcap: 750000,
    rationale: 'Large-cap IT services. PE 20-35× tied to USD revenue growth + margin trajectory. Tighter band than 5-yr median during deal-velocity slowdown.',
  },
  'SaaS / Software (US)': {
    ticker: 'CRWD', company: 'CrowdStrike', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $M)', driverValue: 4500, multiple: 16,
    currentMcap: 88000,
    rationale: 'Rule-of-40 SaaS. P/S 8-25× tied to ARR growth + FCF margin. Premium 15-25× when both >25%. Avoid <Rule-of-30 names.',
  },
  'Pre-revenue / Growth': {
    ticker: 'CRDO', company: 'Credo Technology', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $M)', driverValue: 420, multiple: 18,
    currentMcap: 8500,
    rationale: 'Pre-profit growth name. P/S only — earnings noisy. Watch gross margin trajectory — must trend toward 50%+ for the multiple to compound.',
  },
  'AI Compute & Infrastructure (US)': {
    ticker: 'NVDA', company: 'NVIDIA', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $B)', driverValue: 220, multiple: 18,
    currentMcap: 4200000,
    rationale: 'AI capex cycle. P/S 12-30× justified by GPU monopoly + 75%+ gross margins. Track Blackwell adoption + hyperscaler capex announcements.',
  },
  'AI Infrastructure (India)': {
    ticker: 'KAYNES', company: 'Kaynes Technology', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 600, multiple: 50,
    currentMcap: 35000,
    rationale: 'ESDM (electronics manufacturing services) premium. PE 35-60× on India semicon push + capex-cycle order book. Stretches if PLI subsidies normalise.',
  },
  'Robotics & Automation': {
    ticker: 'ABB', company: 'ABB India', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 1900, multiple: 52,
    currentMcap: 120000,
    rationale: 'Industrial automation premium. PE 40-65× on India automation tailwind. Multiple compresses when order intake decelerates >2 consecutive quarters.',
  },
  'EV / Battery / Charging': {
    ticker: 'EXIDEIND', company: 'Exide Industries', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 2400, multiple: 22,
    currentMcap: 42000, netDebt: 800,
    rationale: 'Legacy lead-acid + lithium-ion capex. EV/EBITDA 18-30× as EV adoption scales. Watch capex-EBITDA ratio (>1.5× = stretched).',
  },
  'Nuclear / Clean Energy (US)': {
    ticker: 'CEG', company: 'Constellation Energy', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27 $B)', driverValue: 5.2, multiple: 22,
    currentMcap: 95000, netDebt: 8000,
    rationale: 'PPA-linked nuclear power producer. EV/EBITDA 18-30× on 20-yr contract visibility. Premium when AI hyperscalers sign long-term PPAs.',
  },
  'Rail / Metro / Mobility': {
    ticker: 'TITAGARH', company: 'Titagarh Rail Systems', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 480, multiple: 32,
    currentMcap: 18000,
    rationale: 'Rail/metro coach maker. PE 25-40× on Vande Bharat + metro order pipeline. Order-book to revenue ratio >3× justifies upper band.',
  },
  'Critical Minerals / Rare Earth (US)': {
    ticker: 'MP', company: 'MP Materials', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27 $M)', driverValue: 220, multiple: 15,
    currentMcap: 4200, netDebt: 700,
    rationale: 'Rare-earth supply-crunch optionality. EV/EBITDA 10-22× volatile on REE pricing. Apply lower band — China pricing risk is non-trivial.',
  },
  'GLP-1 / Healthcare (US)': {
    ticker: 'LLY', company: 'Eli Lilly', method: 'PE',
    driverLabel: 'Forward PAT (FY27 $B)', driverValue: 22, multiple: 38,
    currentMcap: 850000,
    rationale: 'GLP-1 patent runway 8-12 years. PE 30-50× sustainable until biosimilars arrive (~2032+). Discount as patent cliff approaches.',
  },
  'Cybersecurity (US)': {
    ticker: 'PANW', company: 'Palo Alto Networks', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $B)', driverValue: 13, multiple: 14,
    currentMcap: 130000,
    rationale: 'Cloud-native cyber leader. P/S 10-25× on platform consolidation theme. Premium when Next-Gen Security ARR growth >35%.',
  },
  'Quantum / Frontier Tech': {
    ticker: 'IONQ', company: 'IonQ', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $M)', driverValue: 130, multiple: 35,
    currentMcap: 8000,
    rationale: 'Pre-commercial quantum. P/S highly volatile — narrative-driven. Only size at <2% portfolio; multiple compresses fast on competitive announcements.',
  },
};
export const GUIDANCE_METHODS: GuidanceMethod[] = [
  {
    id: 'revenue-growth-pct',
    emoji: '📈',
    title: 'Revenue Growth % (single year)',
    description: 'Management gives a single percentage growth target for one specific fiscal year. The cleanest, most common form. Apply growth to current TTM revenue to get forward revenue, then multiply by sector multiple.',
    examples: [
      { company: 'MTAR Technologies', quote: '50% revenue growth for FY27' },
      { company: 'Acutaas Chemicals', quote: '30% revenue growth for FY26' },
      { company: 'Lumax Auto', quote: 'Revenue growth guidance revised to 30% for FY26' },
      { company: 'Sterlite Tech', quote: '20%+ YoY revenue growth for FY26' },
    ],
    variables: ['Current TTM revenue (₹ Cr)', 'Growth guidance %', 'Sector P/S multiple', 'Current market cap (₹ Cr)'],
    formula: [
      'Forward Revenue = TTM Revenue × (1 + Growth%/100)',
      'Target Market Cap = Forward Revenue × Sector P/S Multiple',
      'Upside % = (Target Mcap / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'MTAR Technologies — "50% revenue growth for FY27"',
      inputs: [
        { label: 'TTM Revenue (FY26)', value: '₹876 Cr' },
        { label: 'Growth Guidance', value: '50%' },
        { label: 'Defence P/S Multiple (base)', value: '10×' },
        { label: 'Current Market Cap', value: '₹17,675 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward Revenue', calc: '₹876 × (1 + 0.50)', result: '₹1,314 Cr' },
        { label: 'Step 2 — Target Market Cap', calc: '₹1,314 × 10', result: '₹13,140 Cr' },
        { label: 'Step 3 — Upside %', calc: '(13,140 / 17,675) − 1', result: '−26%' },
      ],
      fairValue: '₹13,140 Cr',
      upside: '−26% (stock trading above fair value at base case)',
    },
    tips: [
      'Always check whether guidance is conservative or stretch — discount stretch by 20-30% for base case.',
      'Use sector P/S median or trailing 5yr median, not all-time high.',
    ],
  },
  {
    id: 'revenue-growth-range',
    emoji: '📊',
    title: 'Revenue Growth % Range',
    description: 'Management gives a range (e.g. 18-20%). Use the midpoint for base case, low end for bear, high end for bull. This is the institutional standard for scenario analysis.',
    examples: [
      { company: 'GNG Electronics', quote: 'Revenue growth guidance revised upward to 28-30% for FY26' },
      { company: 'Inox India', quote: '18-20% revenue growth guidance for FY27' },
      { company: 'Aimtron Electronics', quote: '40-50% CAGR revenue growth guidance for FY26' },
    ],
    variables: ['TTM Revenue', 'Growth low %', 'Growth high %', 'Multiple bands (bear/base/bull)'],
    formula: [
      'Bear Revenue = TTM × (1 + LowGrowth/100)',
      'Base Revenue = TTM × (1 + MidGrowth/100)',
      'Bull Revenue = TTM × (1 + HighGrowth/100)',
      'For each scenario: Target Mcap = Revenue × Multiple',
    ],
    worked: {
      company: 'Inox India — "18-20% revenue growth guidance for FY27"',
      inputs: [
        { label: 'TTM Revenue (FY26)', value: '₹1,200 Cr' },
        { label: 'Growth Low / High', value: '18% / 20%' },
        { label: 'Midpoint (Base)', value: '19%' },
        { label: 'P/S Bear / Base / Bull', value: '8× / 11× / 14×' },
        { label: 'Current Market Cap', value: '₹14,000 Cr' },
      ],
      steps: [
        { label: 'Bear case (18% × 8×)', calc: '1,200 × 1.18 × 8', result: '₹11,328 Cr → −19%' },
        { label: 'Base case (19% × 11×)', calc: '1,200 × 1.19 × 11', result: '₹15,708 Cr → +12%' },
        { label: 'Bull case (20% × 14×)', calc: '1,200 × 1.20 × 14', result: '₹20,160 Cr → +44%' },
      ],
      fairValue: '₹15,708 Cr (base case)',
      upside: '+12% base, with −19% downside / +44% upside scenario spread',
    },
  },
  {
    id: 'multi-year-cagr',
    emoji: '🚀',
    title: 'Multi-Year CAGR (3-5 years)',
    description: 'Management gives a CAGR over a longer horizon. Compound growth across the full window, then apply terminal multiple. Best for compounders with multi-year visibility.',
    examples: [
      { company: 'Emcure Pharmaceuticals', quote: 'Low to mid-teens revenue CAGR over 3-5 years' },
      { company: 'Sai Life Sciences', quote: '15-20% revenue CAGR over 3-5 years; EBITDA margin 28-30% by FY27' },
      { company: 'Aimtron Electronics', quote: '40-50% CAGR revenue growth guidance for FY26' },
    ],
    variables: ['TTM Revenue', 'CAGR %', 'Years (N)', 'Terminal Multiple'],
    formula: [
      'Forward Revenue (Year N) = TTM × (1 + CAGR/100)^N',
      'Target Market Cap = Forward Revenue × Terminal Multiple',
      'Annualized Upside = (Target/Current)^(1/N) − 1',
    ],
    worked: {
      company: 'Sai Life Sciences — "15-20% CAGR over 3-5 years"',
      inputs: [
        { label: 'TTM Revenue (FY26)', value: '₹1,500 Cr' },
        { label: 'CAGR (midpoint)', value: '17.5%' },
        { label: 'Horizon', value: '4 years' },
        { label: 'Pharma CDMO P/S (base)', value: '12×' },
        { label: 'Current Market Cap', value: '₹14,000 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward Revenue (4yr)', calc: '1,500 × (1.175)^4', result: '₹2,852 Cr' },
        { label: 'Step 2 — Target Mcap', calc: '2,852 × 12', result: '₹34,224 Cr' },
        { label: 'Step 3 — Total upside', calc: '(34,224 / 14,000) − 1', result: '+144%' },
        { label: 'Step 4 — Annualized', calc: '(34,224/14,000)^(1/4) − 1', result: '+25% CAGR' },
      ],
      fairValue: '₹34,224 Cr',
      upside: '+144% total / +25% annualized (4yr horizon)',
    },
    tips: [
      'Discount the bull-end CAGR by 20% for base case — most companies miss their stretch.',
      'Re-rate multiple downward if growth decelerates in years 4-5 (use 80% of base multiple for terminal).',
    ],
  },
  {
    id: 'absolute-revenue',
    emoji: '💰',
    title: 'Absolute Revenue ₹ Cr (specific FY)',
    description: 'Management gives an explicit ₹ Cr revenue number for a specific year. The easiest case — no growth math, just apply multiple directly.',
    examples: [
      { company: 'HFCL', quote: 'OFC Revenue: ₹3,500 crores in FY27 (from ₹2,400 crores in FY26)' },
      { company: 'TD Power Systems', quote: 'FY27 Revenue guidance: ₹2,200+ crores (conservative)' },
      { company: 'Sansera Engineering', quote: 'ADS Revenue: ₹550-600 crores for FY27' },
      { company: 'Quality Power Electrical', quote: '₹700-800 crores revenue guidance for FY26' },
    ],
    variables: ['Forward Revenue ₹ Cr (direct from guidance)', 'Sector Multiple', 'Current Market Cap'],
    formula: [
      'Target Market Cap = Guided Revenue × Multiple',
      'Upside % = (Target / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'TD Power Systems — "₹2,200+ Cr FY27 revenue (conservative)"',
      inputs: [
        { label: 'Guided Revenue FY27', value: '₹2,200 Cr (floor)' },
        { label: 'Industrial Cap-goods P/S (base)', value: '5×' },
        { label: 'Current Market Cap', value: '₹6,800 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Target Mcap', calc: '2,200 × 5', result: '₹11,000 Cr' },
        { label: 'Step 2 — Upside', calc: '(11,000 / 6,800) − 1', result: '+62%' },
      ],
      fairValue: '₹11,000 Cr (base, conservative)',
      upside: '+62% — "conservative" framing means upper scenarios likely larger',
    },
    tips: [
      'When guidance says "conservative" or "minimum" — these are floor numbers. Treat as your BEAR case.',
      '"Stretch" or "ambition" → these are bull-case anchors, not base case.',
    ],
  },
  {
    id: 'absolute-pat',
    emoji: '💵',
    title: 'Absolute PAT ₹ Cr (specific FY)',
    description: 'Management gives an absolute PAT target. Apply P/E multiple directly. Best when you have a clean profit number with sustainable tax rate.',
    examples: [
      { company: 'Hypothetical', quote: '₹400 Cr PAT in FY27' },
      { company: 'Hypothetical', quote: 'PAT target ₹250-300 Cr for FY28' },
    ],
    variables: ['Forward PAT ₹ Cr', 'Sector P/E Multiple', 'Current Market Cap'],
    formula: [
      'Target Market Cap = Forward PAT × P/E Multiple',
      'Upside % = (Target / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'Hypothetical — "₹400 Cr PAT in FY27"',
      inputs: [
        { label: 'Guided PAT FY27', value: '₹400 Cr' },
        { label: 'Sector P/E (Defence 30-50×)', value: '40× (base)' },
        { label: 'Current Market Cap', value: '₹12,000 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Target Mcap', calc: '400 × 40', result: '₹16,000 Cr' },
        { label: 'Step 2 — Upside', calc: '(16,000 / 12,000) − 1', result: '+33%' },
      ],
      fairValue: '₹16,000 Cr',
      upside: '+33% — base case',
    },
    tips: [
      'Always check effective tax rate. MAT credits / SEZ benefits can normalize, dropping PAT growth.',
      'Apply tighter P/E band when guidance has lumpy quarters (e.g. order-book-driven defence/infra).',
    ],
  },
  {
    id: 'ebitda-margin',
    emoji: '🎯',
    title: 'EBITDA Margin Guidance',
    description: 'Management gives target EBITDA margin for forward year. Combine with revenue projection to derive forward EBITDA, then apply EV/EBITDA multiple.',
    examples: [
      { company: 'DEE Development', quote: '18% to 20% EBITDA margin guidance for FY27' },
      { company: 'Navin Fluorine', quote: '30%+ EBITDA margin guidance for FY26' },
      { company: 'Quality Power Electrical', quote: '22%+ EBITDA margin guidance for FY26' },
      { company: 'Azad Engineering', quote: '33-35% EBITDA margin sustainable over a long period' },
    ],
    variables: ['Forward Revenue', 'Guided EBITDA Margin %', 'EV/EBITDA Multiple', 'Net Debt'],
    formula: [
      'Forward EBITDA = Forward Revenue × (EBITDA Margin / 100)',
      'Enterprise Value (EV) = Forward EBITDA × EV/EBITDA Multiple',
      'Equity Value = EV − Net Debt',
      'Upside % = (Equity Value / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'DEE Development — "18-20% EBITDA margin FY27" + revenue assumed ₹1,400 Cr',
      inputs: [
        { label: 'Forward Revenue (FY27)', value: '₹1,400 Cr' },
        { label: 'EBITDA Margin (mid)', value: '19%' },
        { label: 'EV/EBITDA (Engineering)', value: '15× (base)' },
        { label: 'Net Debt', value: '₹50 Cr' },
        { label: 'Current Market Cap', value: '₹2,800 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward EBITDA', calc: '1,400 × 0.19', result: '₹266 Cr' },
        { label: 'Step 2 — Enterprise Value', calc: '266 × 15', result: '₹3,990 Cr' },
        { label: 'Step 3 — Equity Value', calc: '3,990 − 50', result: '₹3,940 Cr' },
        { label: 'Step 4 — Upside', calc: '(3,940 / 2,800) − 1', result: '+41%' },
      ],
      fairValue: '₹3,940 Cr',
      upside: '+41% — base case',
    },
  },
  {
    id: 'ebitda-margin-bps',
    emoji: '📐',
    title: 'EBITDA Margin Improvement (bps)',
    description: 'Management gives margin EXPANSION in basis points (100 bps = 1%). Add to current margin to get forward margin, then apply revenue + EV/EBITDA chain.',
    examples: [
      { company: 'GNG Electronics', quote: 'EBITDA margin improvement of 150-200 bps' },
      { company: 'Emcure Pharmaceuticals', quote: 'EBITDA margin to rise 300-400 bps to 23-24% by FY29' },
    ],
    variables: ['Current EBITDA margin %', 'Margin expansion (bps)', 'Forward revenue'],
    formula: [
      'Forward Margin = Current Margin + (bps / 100)',
      'Forward EBITDA = Forward Revenue × (Forward Margin / 100)',
      'EV = Forward EBITDA × Multiple; Equity = EV − Net Debt',
    ],
    worked: {
      company: 'GNG Electronics — "150-200 bps margin improvement, 28-30% revenue growth FY26"',
      inputs: [
        { label: 'TTM Revenue', value: '₹450 Cr' },
        { label: 'Current EBITDA margin', value: '8%' },
        { label: 'Margin expansion (mid)', value: '175 bps' },
        { label: 'Forward margin', value: '8% + 1.75% = 9.75%' },
        { label: 'Revenue growth (mid)', value: '29%' },
        { label: 'EV/EBITDA', value: '14×' },
        { label: 'Current Market Cap', value: '₹600 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward Revenue', calc: '450 × 1.29', result: '₹581 Cr' },
        { label: 'Step 2 — Forward EBITDA', calc: '581 × 0.0975', result: '₹57 Cr' },
        { label: 'Step 3 — EV', calc: '57 × 14', result: '₹793 Cr' },
        { label: 'Step 4 — Upside', calc: '(793 / 600) − 1', result: '+32%' },
      ],
      fairValue: '₹793 Cr',
      upside: '+32%',
    },
    tips: [
      '100 bps = 1.00% margin. 150-200 bps = 1.5-2.0%.',
      'Margin expansion is often back-loaded (Q3/Q4). Check management cadence.',
    ],
  },
  {
    id: 'ebitda-growth',
    emoji: '💼',
    title: 'EBITDA Growth % (instead of revenue)',
    description: 'Management guides EBITDA growth directly without specifying revenue. Apply EBITDA growth to TTM EBITDA, then apply EV/EBITDA multiple.',
    examples: [
      { company: 'CCL Products', quote: '25% EBITDA growth guidance for FY26' },
      { company: 'Aeroflex Industries', quote: '25% EBITDA growth for FY26' },
    ],
    variables: ['TTM EBITDA', 'EBITDA growth %', 'EV/EBITDA Multiple'],
    formula: [
      'Forward EBITDA = TTM EBITDA × (1 + EBITDA Growth/100)',
      'EV = Forward EBITDA × Multiple',
      'Equity Value = EV − Net Debt',
    ],
    worked: {
      company: 'CCL Products — "25% EBITDA growth FY26"',
      inputs: [
        { label: 'TTM EBITDA (FY25)', value: '₹500 Cr' },
        { label: 'EBITDA growth guidance', value: '25%' },
        { label: 'Coffee/F&B EV/EBITDA', value: '18× (base)' },
        { label: 'Net Debt', value: '₹600 Cr' },
        { label: 'Current Market Cap', value: '₹9,500 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward EBITDA', calc: '500 × 1.25', result: '₹625 Cr' },
        { label: 'Step 2 — EV', calc: '625 × 18', result: '₹11,250 Cr' },
        { label: 'Step 3 — Equity', calc: '11,250 − 600', result: '₹10,650 Cr' },
        { label: 'Step 4 — Upside', calc: '(10,650 / 9,500) − 1', result: '+12%' },
      ],
      fairValue: '₹10,650 Cr',
      upside: '+12% — fairly valued',
    },
  },
  {
    id: 'peak-revenue',
    emoji: '⛰️',
    title: 'Peak Revenue Potential (by FYxx)',
    description: 'Management gives PEAK revenue achievable at full capacity ramp by a later FY. Treat as terminal-year revenue. Discount back to current year using a discount rate (10-12%).',
    examples: [
      { company: 'Aeroflex Industries', quote: 'Peak revenue potential ₹650 crores from hoses + ₹85 crores from metal bellows by FY28' },
      { company: 'Navin Fluorine', quote: '₹600-825 crores peak revenue from 15,000 MTPA R32 expansion by Q3 FY27' },
    ],
    variables: ['Peak Revenue ₹ Cr', 'Years to peak (N)', 'Discount rate'],
    formula: [
      'Sum peak revenue from all segments → Total peak revenue',
      'Apply multiple to peak revenue → Peak Mcap',
      'Discount: PV = Peak Mcap / (1 + DiscRate)^N',
      'Or simpler: take ratio (Peak Mcap / Current Mcap) and annualize over N years',
    ],
    worked: {
      company: 'Aeroflex — "₹650 Cr hoses + ₹85 Cr metal bellows peak by FY28" (2 years out)',
      inputs: [
        { label: 'Peak Revenue', value: '₹650 + ₹85 = ₹735 Cr' },
        { label: 'Years to peak', value: '2 (FY26 → FY28)' },
        { label: 'P/S (Industrial)', value: '6× (base)' },
        { label: 'Current Market Cap', value: '₹2,400 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Peak Mcap', calc: '735 × 6', result: '₹4,410 Cr' },
        { label: 'Step 2 — Total upside', calc: '(4,410 / 2,400) − 1', result: '+84%' },
        { label: 'Step 3 — Annualized (2yr)', calc: '(4,410/2,400)^(1/2) − 1', result: '+36% CAGR' },
      ],
      fairValue: '₹4,410 Cr (peak FY28)',
      upside: '+84% total / +36% annualized',
    },
    tips: [
      'Peak revenue assumes full ramp + healthy utilization. Discount 15-25% if capex commissioning has risk.',
      'If multiple segments give peak guidance, sum them. But check whether they\'re additive or overlapping.',
    ],
  },
  {
    id: 'segment-mix',
    emoji: '🔀',
    title: 'Segment Revenue Mix Shift',
    description: 'Guidance specifies that a higher-margin segment will reach X% of revenue by year N. Useful for re-rating thesis (mix-driven margin expansion).',
    examples: [
      { company: 'SJS Enterprises', quote: 'Export contribution to reach 14-15% of revenue by FY28' },
      { company: 'HFCL', quote: 'OFC Revenue: ₹3,500 Cr / Defence Revenue: ₹500 Cr in FY27' },
    ],
    variables: ['Total forward revenue', 'Segment mix %', 'Segment-specific margin'],
    formula: [
      'Segment Revenue = Total Revenue × (Segment % / 100)',
      'Blended Margin = Σ (Segment % × Segment margin)',
      'EBITDA = Total Revenue × Blended Margin',
    ],
    worked: {
      company: 'SJS — "Exports 14% of revenue by FY28, exports margin 25% vs domestic 15%"',
      inputs: [
        { label: 'Total Revenue FY28', value: '₹900 Cr' },
        { label: 'Export %', value: '14%' },
        { label: 'Export margin', value: '25%' },
        { label: 'Domestic margin', value: '15%' },
      ],
      steps: [
        { label: 'Step 1 — Export EBITDA', calc: '900 × 0.14 × 0.25', result: '₹31.5 Cr' },
        { label: 'Step 2 — Domestic EBITDA', calc: '900 × 0.86 × 0.15', result: '₹116.1 Cr' },
        { label: 'Step 3 — Total EBITDA', calc: '31.5 + 116.1', result: '₹147.6 Cr' },
        { label: 'Step 4 — Blended margin', calc: '147.6 / 900', result: '16.4%' },
      ],
      fairValue: 'EBITDA-based — apply EV/EBITDA multiple to ₹147.6 Cr',
      upside: 'Depends on multiple. At 18× → EV ₹2,657 Cr',
    },
  },
  {
    id: 'sustainable-margin',
    emoji: '🏆',
    title: 'Sustainable Margin Target (long horizon)',
    description: 'Management gives a sustainable margin for the long run (not a year-specific target). Treat as terminal margin for DCF or apply to a normalized forward year.',
    examples: [
      { company: 'Azad Engineering', quote: '33-35% EBITDA margin sustainable over a long period' },
      { company: 'Emcure', quote: 'EBITDA margin to rise 300-400 bps to 23-24% by FY29' },
    ],
    variables: ['Terminal margin %', 'Terminal revenue', 'Terminal multiple'],
    formula: [
      'Terminal EBITDA = Terminal Revenue × (Terminal Margin / 100)',
      'Terminal EV = Terminal EBITDA × Multiple',
      'For valuation today: discount terminal EV back N years at 10-12%',
    ],
    worked: {
      company: 'Azad Engineering — "33-35% sustainable EBITDA margin, current revenue ₹400 Cr"',
      inputs: [
        { label: 'Current Revenue', value: '₹400 Cr' },
        { label: 'Sustainable margin (mid)', value: '34%' },
        { label: 'Implied EBITDA today', value: '₹136 Cr' },
        { label: 'EV/EBITDA (premium precision)', value: '25×' },
        { label: 'Current Market Cap', value: '₹9,800 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Steady-state EBITDA', calc: '400 × 0.34', result: '₹136 Cr' },
        { label: 'Step 2 — EV at 25×', calc: '136 × 25', result: '₹3,400 Cr' },
        { label: 'Step 3 — Underwater vs current', calc: '(3,400 / 9,800) − 1', result: '−65%' },
      ],
      fairValue: '₹3,400 Cr (steady-state)',
      upside: '−65% on steady-state — stock pricing in significant growth. Sustainable margin only validates the bull-case multiple, not the entry today.',
    },
    tips: [
      'Sustainable margin guidance is the LONG-RUN floor — pair with growth thesis, never standalone.',
      'Use 25× max for premium precision engineering. For pharma 18-22×. For autos 12-15×.',
    ],
  },
  {
    id: 'sum-of-parts',
    emoji: '🧩',
    title: 'Sum-of-Parts (Multiple segments with separate guidance)',
    description: 'Management gives separate guidance for each segment. Value each segment using its own multiple (because growth and risk profiles differ), then sum to get total fair value.',
    examples: [
      { company: 'HFCL', quote: 'OFC Revenue: ₹3,500 Cr (from ₹2,400 Cr); Defence Revenue: ₹500 Cr in FY27' },
      { company: 'Aeroflex', quote: '₹650 Cr from hoses + ₹85 Cr from metal bellows by FY28' },
    ],
    variables: ['Per-segment revenue', 'Per-segment multiple', 'Holding/corporate discount'],
    formula: [
      'For each segment: Segment Value = Segment Revenue × Segment Multiple',
      'Total Enterprise Value = Σ Segment Values',
      'Apply 10-15% conglomerate discount if 3+ segments with low synergy',
      'Equity Value = EV − Net Debt − Conglomerate Discount',
    ],
    worked: {
      company: 'HFCL — "OFC ₹3,500 Cr (P/S 4×, cyclical), Defence ₹500 Cr (P/S 8×, premium)"',
      inputs: [
        { label: 'OFC Revenue FY27', value: '₹3,500 Cr' },
        { label: 'OFC Multiple', value: '4× P/S' },
        { label: 'Defence Revenue FY27', value: '₹500 Cr' },
        { label: 'Defence Multiple', value: '8× P/S' },
        { label: 'Current Mcap', value: '₹15,000 Cr' },
      ],
      steps: [
        { label: 'OFC value', calc: '3,500 × 4', result: '₹14,000 Cr' },
        { label: 'Defence value', calc: '500 × 8', result: '₹4,000 Cr' },
        { label: 'Total EV', calc: '14,000 + 4,000', result: '₹18,000 Cr' },
        { label: 'Less: 10% conglomerate discount', calc: '18,000 × 0.90', result: '₹16,200 Cr' },
        { label: 'Upside', calc: '(16,200 / 15,000) − 1', result: '+8%' },
      ],
      fairValue: '₹16,200 Cr (post-conglomerate discount)',
      upside: '+8%',
    },
    tips: [
      'High-multiple segment (defence) drives most of the value. Always check whether it\'s really delivered margin/growth.',
      'Conglomerate discount: 10% for 2 segments, 15% for 3+, 20% for unrelated diversification.',
    ],
  },
];
