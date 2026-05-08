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

export interface IndiaSectorTemplate {
  sector: IndiaSector;
  displayName: string;
  kpis: IndiaSectorKPI[];
  themes: string[];     // sector-relevant macro themes
  redFlags: string[];   // institutional warning signals
}

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
export function classifyIndiaSector(industry: string | null | undefined, fallbackText: string = ''): IndiaSector {
  const t = `${industry || ''} ${fallbackText || ''}`.toLowerCase();

  if (/(bank|psu bank|private bank)/.test(t)) return 'banks';
  if (/(insurance|asset management|amc|broker|capital market|finance|nbfc|housing finance|microfinance)/.test(t)) return 'nbfc_insurance';
  if (/(it -|computers - software|software|it services|consulting)/.test(t)) return 'it_services';
  if (/(pharmaceutic|drug|biotech|hospital|diagnostic|healthcare|medical)/.test(t)) return 'pharma_healthcare';
  if (/(auto|automobile|tyre|tire|tractor|two\s*-?\s*wheeler|four\s*-?\s*wheeler|commercial vehicle|electric vehicle)/.test(t)) return 'auto';
  if (/(defen|aerospace|aviation|shipyard)/.test(t)) return 'defense_aerospace';
  if (/(capital good|engineering|industrial|capgoods|machinery|electrical equipment|bearing|compressor|forging|casting)/.test(t)) return 'industrials_capgoods';
  if (/(steel|aluminium|aluminum|copper|zinc|metal|mining|iron ore|coal|ferro)/.test(t)) return 'metals_mining';
  if (/cement/.test(t)) return 'cement';
  if (/(refiner|petroleum|oil|gas|lng|upstream|downstream|petro)/.test(t)) return 'energy_oil_gas';
  if (/(power|electricity|renewable|solar|wind|hydro|thermal)/.test(t)) return 'energy_power_renewable';
  if (/(chemical|specialty chemical|agrochem|pesticide|fertilizer|paint|dye)/.test(t)) return 'chemicals';
  if (/(consumer durable|electronics|appliance|fan|cooler|kitchen)/.test(t)) return 'consumer_durables';
  if (/(retail|e\s*-?\s*commerce|apparel|footwear|hotel|restaurant|qsr|hospitality)/.test(t)) return 'consumer_retail';
  if (/(personal product|household|fmcg|food|beverage|tobacco|consumer staples)/.test(t)) return 'fmcg';
  if (/(real estate|realty|construction)/.test(t)) return 'real_estate';
  if (/(media|broadcast|entertainment|telecom|communication|cable)/.test(t)) return 'media_telecom';
  if (/(seed|agri|tea|sugar|edible oil|food processing)/.test(t)) return 'agri_food';
  if (/(paper|packaging|carton|corrug)/.test(t)) return 'paper_packaging';
  if (/(logistics|transport|shipping|courier|airline|port|railway)/.test(t)) return 'logistics_transport';

  return 'diversified';
}
