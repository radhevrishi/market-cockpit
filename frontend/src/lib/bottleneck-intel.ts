// ═══════════════════════════════════════════════════════════════════════════
// BOTTLENECK INTELLIGENCE LIBRARY — PATCH 0593/0594/0595
//
// Institutional-grade overlay for the news / bottleneck dashboard. User
// feedback (2026-05-21) flagged:
//   • No counter-thesis layer (every bottleneck eventually normalizes /
//     overbuilds / gets substituted)
//   • India mapping weak — needs direct NSE/BSE proxy beneficiary lists
//   • Missing quantification (lead-time, ASP inflation, margin leverage)
//   • Mixed signal quality (Tom's Hardware ≠ specialist research)
//
// This file is the single source of truth for all of these. Each theme
// carries:
//   • quant     — lead-time + ASP inflation + margin leverage estimates
//   • counter   — de-bottleneck risks with rough trigger thresholds
//   • inProxies — direct India-listed beneficiaries with primary exposure
//
// Consumed by /bottleneck-intel and /bottleneck-workbench pages — surfaces
// inline alongside the existing theme cards.
// ═══════════════════════════════════════════════════════════════════════════

export interface BottleneckQuant {
  metric: string;             // e.g. 'Lead time'
  current: string;            // 'now 140w'
  baseline: string;           // 'vs 70w historical'
  derivedImpact: string;      // 'ASP +18% → margin +400 bps'
  evidence?: string;          // optional source pointer (e.g. ABB Q3 26 concall)
}

export interface CounterThesis {
  risk: string;               // 'Capacity additions overshoot demand by FY28'
  trigger: string;            // 'When? — TX/MX EPC orders fall below 40% YoY for two quarters'
  severity: 'WATCH' | 'MEDIUM' | 'HIGH';
  reverseCallouts?: string[]; // related news patterns that confirm reversal (regex hints)
}

export interface InProxy {
  ticker: string;             // NSE symbol (or BSE: scrip code prefix)
  company: string;
  exposure: 'PURE' | 'CORE' | 'PARTIAL'; // PURE = >70% rev exposed; CORE = 30-70%; PARTIAL = <30%
  thesis: string;             // why this is a direct beneficiary
}

export interface BottleneckTheme {
  themeId: string;            // e.g. 'POWER_GRID_TRANSFORMERS'
  label: string;              // 'Transformer / Grid Buildout'
  parent?: string;            // optional parent for hierarchy
  quant: BottleneckQuant[];
  counter: CounterThesis[];
  inProxies: InProxy[];
  globalProxies?: { ticker: string; company: string; thesis: string }[]; // for completeness
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE CREDIBILITY WEIGHTING (PATCH 0593)
//
// Per user feedback table:
//   Primary filing               1.00
//   Specialist research          0.90
//   Earnings call                0.90
//   Trade journal                0.75
//   Mainstream financial media   0.60
//   Tech blog extrapolation      0.35
//
// Stacks on top of the existing source-tiers.ts classifier — that one
// returns PRIMARY/SPECIALIST/SECONDARY/AGGREGATOR; this one returns a
// numeric weight used to deflate the priority score of low-credibility
// sources. Examples of how each tier resolves:
// ═══════════════════════════════════════════════════════════════════════════

export type CredibilityTier =
  | 'PRIMARY_FILING'
  | 'SPECIALIST_RESEARCH'
  | 'EARNINGS_CALL'
  | 'TRADE_JOURNAL'
  | 'MAINSTREAM_MEDIA'
  | 'TECH_BLOG_EXTRAPOLATION'
  | 'UNKNOWN';

export const CREDIBILITY_WEIGHT: Record<CredibilityTier, number> = {
  PRIMARY_FILING:              1.00,
  SPECIALIST_RESEARCH:         0.90,
  EARNINGS_CALL:               0.90,
  TRADE_JOURNAL:               0.75,
  MAINSTREAM_MEDIA:            0.60,
  TECH_BLOG_EXTRAPOLATION:     0.35,
  UNKNOWN:                     0.50,
};

export const CREDIBILITY_TIER_META: Record<CredibilityTier, { color: string; label: string; glyph: string }> = {
  PRIMARY_FILING:           { color: '#10B981', label: 'Primary filing',           glyph: '◆' },
  SPECIALIST_RESEARCH:      { color: '#22D3EE', label: 'Specialist research',      glyph: '◇' },
  EARNINGS_CALL:            { color: '#22D3EE', label: 'Earnings call',            glyph: '🎙' },
  TRADE_JOURNAL:            { color: '#F59E0B', label: 'Trade journal',            glyph: '▤' },
  MAINSTREAM_MEDIA:         { color: '#94A3B8', label: 'Mainstream media',         glyph: '◯' },
  TECH_BLOG_EXTRAPOLATION:  { color: '#EF4444', label: 'Tech blog extrapolation',  glyph: '·' },
  UNKNOWN:                  { color: '#6B7A8D', label: 'Unknown',                  glyph: '?' },
};

// Domain → credibility tier mapping
const DOMAIN_TIER: Array<{ rx: RegExp; tier: CredibilityTier }> = [
  // PRIMARY filings / exchanges / regulators
  { rx: /(sec\.gov|nseindia\.com|bseindia\.com|rbi\.org\.in|sebi\.gov\.in|fda\.gov|ferc\.gov|mca\.gov\.in)/i, tier: 'PRIMARY_FILING' },
  // Earnings calls — investor-relations pages, seekingalpha transcript pages
  { rx: /(\bir\.|\binvestor\.|seekingalpha\.com\/article|\bconference[- ]call\b|\bearnings call\b|earningscall|wsj\.com\/market-data\/quotes)/i, tier: 'EARNINGS_CALL' },
  // Specialist research / industry analysts
  { rx: /(gartner|forrester|idc\.com|mckinsey|bcg|baird|jpmorgan|gs\.com|morganstanley|barclays|credit-suisse|ubs\.com|jefferies|bernstein|wolfe|cowen|stifel|piper|raymond\.james|trefis)/i, tier: 'SPECIALIST_RESEARCH' },
  // Trade journals — industry-specific publications
  { rx: /(semiconductor-today|eetimes|electronicdesign|powermag|nuclearenergy-insider|naturalgasintel|argusmedia|platts|cru|icis|chemical-engineering|ihs|igd-supplychain|fastmarkets|metalbulletin)/i, tier: 'TRADE_JOURNAL' },
  // Mainstream financial media
  { rx: /(bloomberg\.com|reuters\.com|ft\.com|wsj\.com|nytimes\.com|economist\.com|cnbc\.com|economictimes|moneycontrol|livemint|businessstandard|business-standard|ndtv\.com\/business|forbes\.com|barrons\.com|marketwatch|yahoo finance|finance\.yahoo)/i, tier: 'MAINSTREAM_MEDIA' },
  // Tech blogs / consumer-grade extrapolations — explicitly demoted
  { rx: /(tomshardware|theverge|techcrunch|engadget|gizmodo|pcmag\.com|extremetech|wccftech|digitaltrends|androidauthority|9to5)/i, tier: 'TECH_BLOG_EXTRAPOLATION' },
];

const SOURCE_NAME_TIER: Array<{ rx: RegExp; tier: CredibilityTier }> = [
  { rx: /(NSE|BSE|SEC EDGAR|RBI|SEBI|FDA|FERC|MCA)/i, tier: 'PRIMARY_FILING' },
  { rx: /(seeking ?alpha|earnings call|conference call|transcript)/i, tier: 'EARNINGS_CALL' },
  { rx: /(gartner|forrester|idc|mckinsey|bcg|baird|jpmorgan|goldman|morgan stanley|barclays|jefferies|bernstein|wolfe|cowen|stifel|piper)/i, tier: 'SPECIALIST_RESEARCH' },
  { rx: /(semiconductor today|ee ?times|electronic design|powermag|argus|platts|cru|icis)/i, tier: 'TRADE_JOURNAL' },
  { rx: /(bloomberg|reuters|ft|wall street journal|nytimes|economist|cnbc|economic times|moneycontrol|livemint|business standard|ndtv|forbes|barron|marketwatch)/i, tier: 'MAINSTREAM_MEDIA' },
  { rx: /(tom'?s hardware|the verge|techcrunch|engadget|gizmodo|pcmag|extremetech|wccftech|digital trends|android authority)/i, tier: 'TECH_BLOG_EXTRAPOLATION' },
];

export function classifyCredibility(source: string | undefined, url?: string | undefined): CredibilityTier {
  const s = (source || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (u) {
    for (const m of DOMAIN_TIER) if (m.rx.test(u)) return m.tier;
  }
  if (s) {
    for (const m of SOURCE_NAME_TIER) if (m.rx.test(s)) return m.tier;
  }
  return 'UNKNOWN';
}

export function credibilityWeight(source: string | undefined, url?: string | undefined): number {
  return CREDIBILITY_WEIGHT[classifyCredibility(source, url)];
}

// ═══════════════════════════════════════════════════════════════════════════
// THEME CATALOG (PATCH 0594/0595)
//
// User-curated. Each theme carries quant + counter-thesis + India proxies.
// Themes are matched to existing bottleneck-intel bucket_ids by name OR
// substring; see resolveTheme() at the bottom of this file.
// ═══════════════════════════════════════════════════════════════════════════

export const THEMES: BottleneckTheme[] = [

  // ── POWER GRID / TRANSFORMERS ───────────────────────────────────────────
  {
    themeId: 'POWER_GRID_TRANSFORMERS',
    label: 'Transformer / Grid Buildout',
    parent: 'AI_INFRASTRUCTURE_POWER',
    quant: [
      {
        metric: 'Transformer lead time',
        current: '~140 weeks (large HV)',
        baseline: 'historical 70 weeks',
        derivedImpact: 'ASP +18-25% YoY · margin +400 bps for top OEMs',
        evidence: 'ABB / Siemens Energy concall transcripts Q3-Q4 2025',
      },
      {
        metric: 'AI campus power demand',
        current: '~1 GW per hyperscaler campus',
        baseline: 'pre-AI averaged 50-100 MW',
        derivedImpact: 'transmission capex multiplier 4-6× over 2025-2030',
      },
    ],
    counter: [
      {
        risk: 'Transformer capex cycle normalizes 2028-2030',
        trigger: 'When EPC order intake drops below 40% YoY for two consecutive quarters',
        severity: 'MEDIUM',
      },
      {
        risk: 'GIS / solid-state transformers substitute conventional units in dense urban infill',
        trigger: 'When Hitachi / ABB / Siemens guide GIS share >25% of new bookings',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'POWERINDIA', company: 'Hitachi Energy India',                       exposure: 'PURE',  thesis: 'India arm of global #1 transformer/grid OEM; 100% rev exposed to T&D capex' },
      { ticker: 'CGPOWER',    company: 'CG Power & Industrial Solutions',            exposure: 'PURE',  thesis: 'High-tension transformer + industrial drives; turned around under Tube Investments' },
      { ticker: 'TRIL',       company: 'Transformers & Rectifiers India',            exposure: 'PURE',  thesis: 'Pure-play power transformer manufacturer; capacity expansion underway' },
      { ticker: 'KEC',        company: 'KEC International',                          exposure: 'CORE',  thesis: 'T&D EPC contractor; large order book in HVDC / transmission lines' },
      { ticker: 'KPIL',       company: 'Kalpataru Projects International',           exposure: 'CORE',  thesis: 'T&D EPC + railway electrification + oil & gas pipelines' },
      { ticker: 'STLTECH',    company: 'Sterlite Technologies',                      exposure: 'PARTIAL', thesis: 'Optical fiber + smart grid solutions; AI data-center linkage' },
      { ticker: 'BHEL',       company: 'Bharat Heavy Electricals',                   exposure: 'CORE',  thesis: 'Large-capacity transformer manufacturer; thermal + nuclear order book' },
      { ticker: 'GEPIL',      company: 'GE Power India',                             exposure: 'CORE',  thesis: 'Steam turbines + gas turbines for thermal + combined-cycle power plants' },
      { ticker: 'POWERGRID',  company: 'Power Grid Corporation of India',            exposure: 'PURE',  thesis: 'Owner of national transmission grid; primary capex deployer' },
    ],
    globalProxies: [
      { ticker: 'ABBNY',  company: 'ABB Ltd', thesis: 'Global #1 power-grid OEM; transformer + GIS leader' },
      { ticker: 'ENR.DE', company: 'Siemens Energy', thesis: 'Grid technologies + gas turbines for AI campus power' },
      { ticker: 'EATON',  company: 'Eaton Corp', thesis: 'Switchgear + power management for data centers' },
    ],
    notes: 'Strongest bottleneck on the page per user; multi-decade capex cycle from AI campus + EV + electrification + grid hardening.',
  },

  // ── AI COMPUTE / HBM / COWOS ──────────────────────────────────────────────
  {
    themeId: 'AI_COMPUTE_HBM_COWOS',
    label: 'HBM Memory + CoWoS Advanced Packaging',
    parent: 'AI_INFRASTRUCTURE_COMPUTE',
    quant: [
      {
        metric: 'TSMC CoWoS capacity FY25E',
        current: '~35k wafers/month',
        baseline: 'FY23 baseline 12k wafers/month',
        derivedImpact: 'still 30-40% short of NVDA + AMD + custom-ASIC demand',
        evidence: 'TSMC Q3 25 capex update',
      },
      {
        metric: 'HBM3E ASP',
        current: '5-6× DDR5 ASP/GB',
        baseline: 'pre-AI baseline 2-3× DDR5',
        derivedImpact: 'memory vendor gross margin +1000-1500 bps (Hynix / Micron / Samsung)',
      },
    ],
    counter: [
      {
        risk: 'Custom HBM4 / on-chip stacking displaces standalone HBM',
        trigger: 'When NVDA / AMD signal in-chip memory stack in next-gen accelerator (e.g. Rubin Ultra)',
        severity: 'MEDIUM',
      },
      {
        risk: 'TSMC CoWoS capacity overshoots AI training demand by FY27',
        trigger: 'When CoWoS booking-to-bill ratio drops below 1.0 for two consecutive quarters',
        severity: 'WATCH',
      },
      {
        risk: 'Alternative packaging (Intel Foveros, Samsung X-Cube) commoditizes the chain',
        trigger: 'If Intel 18A / Foveros wins MI-class accelerator design wins',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'KAYNES',    company: 'Kaynes Technology India',  exposure: 'PARTIAL', thesis: 'Advanced semiconductor packaging ambitions; OSAT JV planned' },
      { ticker: 'TATAELXSI', company: 'Tata Elxsi',               exposure: 'PARTIAL', thesis: 'Chip-design services + AI / autonomous mobility ER&D' },
      { ticker: 'SYRMA',     company: 'Syrma SGS Technology',     exposure: 'PARTIAL', thesis: 'EMS player benefiting from semiconductor PLI ecosystem buildout' },
    ],
    globalProxies: [
      { ticker: 'NVDA',  company: 'Nvidia',     thesis: 'Anchor demand for HBM3E + CoWoS' },
      { ticker: '000660.KS', company: 'SK Hynix', thesis: 'HBM3E #1 supplier; >55% share' },
      { ticker: 'TSM',   company: 'TSMC',       thesis: 'CoWoS sole-sourced; capacity-constrained' },
      { ticker: 'AMAT',  company: 'Applied Materials', thesis: 'Equipment for advanced packaging' },
    ],
  },

  // ── COOLING / LIQUID THERMAL ──────────────────────────────────────────────
  {
    themeId: 'AI_DATA_CENTER_COOLING',
    label: 'Liquid / Immersion Cooling',
    parent: 'AI_INFRASTRUCTURE_COMPUTE',
    quant: [
      {
        metric: 'Rack power density',
        current: '60-100+ kW (B200 era)',
        baseline: 'pre-AI baseline 10-20 kW',
        derivedImpact: 'air cooling alone infeasible above ~30 kW → liquid TAM ~$15B by 2028',
      },
    ],
    counter: [
      {
        risk: 'Two-phase immersion adoption slower than DLC for capex-cost reasons',
        trigger: 'If hyperscaler design-spec sheets standardize on DLC over immersion',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'BLUESTARCO', company: 'Blue Star',         exposure: 'PARTIAL', thesis: 'Commercial HVAC + data-center cooling solutions' },
      { ticker: 'VOLTAS',     company: 'Voltas',            exposure: 'PARTIAL', thesis: 'Industrial HVAC + data-center thermal-management' },
    ],
    globalProxies: [
      { ticker: 'VRT', company: 'Vertiv Holdings', thesis: 'Pure-play data-center thermal + power' },
      { ticker: 'NVT', company: 'nVent Electric', thesis: 'Liquid-cooling infrastructure' },
    ],
  },

  // ── NUCLEAR / SMR ─────────────────────────────────────────────────────────
  {
    themeId: 'NUCLEAR_SMR',
    label: 'Nuclear + Small Modular Reactors',
    parent: 'AI_INFRASTRUCTURE_POWER',
    quant: [
      {
        metric: 'SMR FOAK (first-of-a-kind) cost',
        current: '$15-20K/kW',
        baseline: 'mature LWR ~$6-8K/kW',
        derivedImpact: 'depends on 4-6× learning curve; hyperscaler PPAs at $80-100/MWh signal acceptance',
      },
    ],
    counter: [
      {
        risk: 'Solar + 8h battery storage undercuts SMR LCOE by FY28',
        trigger: 'When utility-scale 4h+8h hybrid PPAs settle below $60/MWh',
        severity: 'MEDIUM',
      },
      {
        risk: 'SMR licensing delays push commercial dates beyond 2030',
        trigger: 'When first NRC SMR design approval slips past 2028',
        severity: 'MEDIUM',
      },
    ],
    inProxies: [
      { ticker: 'NTPC',    company: 'NTPC',                         exposure: 'PARTIAL', thesis: 'Nuclear JV (ASHVINI) with NPCIL for SMR development' },
      { ticker: 'BHEL',    company: 'Bharat Heavy Electricals',     exposure: 'PARTIAL', thesis: 'Nuclear forgings + reactor pressure vessels supplier' },
      { ticker: 'L&T',     company: 'Larsen & Toubro',              exposure: 'PARTIAL', thesis: 'Nuclear forgings + heavy engineering for reactor construction' },
    ],
    globalProxies: [
      { ticker: 'CCJ',  company: 'Cameco', thesis: 'Uranium supply' },
      { ticker: 'LEU',  company: 'Centrus Energy', thesis: 'HALEU enrichment' },
      { ticker: 'BWXT', company: 'BWX Technologies', thesis: 'Naval + SMR reactor components' },
    ],
  },

  // ── DEFENSE / AEROSPACE ───────────────────────────────────────────────────
  {
    themeId: 'DEFENSE_AEROSPACE',
    label: 'Defense / Indigenisation',
    quant: [
      {
        metric: 'India defense order pipeline',
        current: '₹4.5 lakh crore (FY24-30)',
        baseline: '₹1.5 lakh crore (FY18-24)',
        derivedImpact: '3× revenue runway for Indian defense PSUs + private OEMs',
      },
    ],
    counter: [
      {
        risk: 'PLI saturation + export-licence delays cap top-line',
        trigger: 'When BEL / HAL guide flat YoY revenue for two quarters',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'HAL',         company: 'Hindustan Aeronautics',         exposure: 'PURE', thesis: 'Tejas / LCA / Sukhoi production; multi-decade order book' },
      { ticker: 'BEL',         company: 'Bharat Electronics',            exposure: 'PURE', thesis: 'Radar / electronic warfare / battlefield management systems' },
      { ticker: 'BDL',         company: 'Bharat Dynamics',               exposure: 'PURE', thesis: 'Missile systems (Akash / Astra / Nag); export pipeline' },
      { ticker: 'MAZDOCK',     company: 'Mazagon Dock Shipbuilders',     exposure: 'PURE', thesis: 'Submarine + frigate builder; P75-I program' },
      { ticker: 'COCHINSHIP',  company: 'Cochin Shipyard',               exposure: 'PURE', thesis: 'Aircraft carrier + naval vessel builder' },
      { ticker: 'PARAS',       company: 'Paras Defence and Space',       exposure: 'PURE', thesis: 'Optronic + electromagnetic suites; space defense' },
      { ticker: 'DATAPATTNS',  company: 'Data Patterns India',           exposure: 'PURE', thesis: 'Defense electronics + radar + comms; private-sector pure-play' },
    ],
  },

  // ── RARE EARTHS / CRITICAL MINERALS ──────────────────────────────────────
  {
    themeId: 'CRITICAL_MINERALS_RARE_EARTH',
    label: 'Rare Earths / Critical Minerals',
    quant: [
      {
        metric: 'Rare-earth export controls (China)',
        current: 'tightening Q4 25',
        baseline: 'unrestricted pre-2024',
        derivedImpact: 'NdPr ASP +25-40%; downstream EV motor margins squeezed',
      },
    ],
    counter: [
      {
        risk: 'EV motor designs migrate to ferrite + recycled rare-earth blends',
        trigger: 'When Tesla / BYD signal switch on next-gen drivetrain',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'HINDCOPPER', company: 'Hindustan Copper',          exposure: 'PARTIAL', thesis: 'India copper mining; benefits from critical-mineral policy' },
      { ticker: 'NMDC',       company: 'NMDC',                      exposure: 'PARTIAL', thesis: 'Iron ore + critical-mineral exploration; PSU disinvestment angle' },
      { ticker: 'IREL',       company: 'IREL (India)',              exposure: 'PURE',    thesis: 'PSU monopoly on rare-earth mining + monazite processing' },
    ],
    globalProxies: [
      { ticker: 'MP',      company: 'MP Materials', thesis: 'US-listed pure-play rare-earth processor' },
      { ticker: 'LYC.AX',  company: 'Lynas Rare Earths', thesis: 'ex-China supplier' },
    ],
  },

  // ── PHARMA / API ──────────────────────────────────────────────────────────
  {
    themeId: 'PHARMA_API_CHINA_PLUS_ONE',
    label: 'Pharma API / China+1 Diversification',
    quant: [
      {
        metric: 'India API self-sufficiency',
        current: '~70% (FY26)',
        baseline: '~50% (FY18)',
        derivedImpact: 'PLI-backed Indian API plants gaining 5-8% market share annually',
      },
    ],
    counter: [
      {
        risk: 'PLI sunset 2027-28 reduces incentive economics',
        trigger: 'When MOH announces PLI tapering / non-renewal',
        severity: 'WATCH',
      },
      {
        risk: 'US generic pricing pressure compounds Indian formulator margin compression',
        trigger: 'When DRL / Sun / Cipla guide US business growth <5%',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'NEULANDLAB', company: 'Neuland Laboratories',  exposure: 'PURE', thesis: 'CRDMO + specialty API; high-margin niche' },
      { ticker: 'AARTIIND',   company: 'Aarti Industries',      exposure: 'CORE', thesis: 'Specialty chemicals + APIs; backward integration' },
      { ticker: 'JUBLPHARMA', company: 'Jubilant Pharmova',     exposure: 'CORE', thesis: 'API + dosage forms; CDMO contracts' },
      { ticker: 'DIVISLAB',   company: 'Divi\'s Laboratories',  exposure: 'PURE', thesis: 'World\'s largest API contract manufacturer' },
      { ticker: 'GLAND',      company: 'Gland Pharma',          exposure: 'PURE', thesis: 'Injectable generics for regulated markets' },
    ],
  },

  // ── ELECTRONICS MANUFACTURING / PLI ──────────────────────────────────────
  {
    themeId: 'ELECTRONICS_MANUFACTURING_PLI',
    label: 'Electronics Manufacturing / PLI',
    quant: [
      {
        metric: 'India electronics exports',
        current: '$30 B (FY25)',
        baseline: '$10 B (FY18)',
        derivedImpact: '20-25% CAGR; PLI drives Apple + Samsung supply-chain shift',
      },
    ],
    counter: [
      {
        risk: 'China subsidy retaliation + Vietnam competition',
        trigger: 'When Apple guides India share <30% of iPhone volume',
        severity: 'WATCH',
      },
    ],
    inProxies: [
      { ticker: 'DIXON',     company: 'Dixon Technologies',       exposure: 'PURE', thesis: 'EMS leader; iPhone + smartphone + appliances + LEDs' },
      { ticker: 'KAYNES',    company: 'Kaynes Technology India',  exposure: 'PURE', thesis: 'Defense + auto + industrial EMS; semiconductor JV' },
      { ticker: 'SYRMA',     company: 'Syrma SGS Technology',     exposure: 'PURE', thesis: 'EMS focused on defense, medical, industrial' },
      { ticker: 'AMBER',     company: 'Amber Enterprises',        exposure: 'CORE', thesis: 'AC contract manufacturer; expanding into components' },
      { ticker: 'CYIENT',    company: 'Cyient',                   exposure: 'PARTIAL', thesis: 'ER&D services + semiconductor design' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// THEME RESOLUTION — match an inbound theme id / label to a catalog entry.
// ═══════════════════════════════════════════════════════════════════════════

const RESOLVE_HINTS: Array<{ rx: RegExp; themeId: string }> = [
  { rx: /(power|grid|transformer|hvdc|substation|transmission)/i, themeId: 'POWER_GRID_TRANSFORMERS' },
  { rx: /(hbm|cowos|advanced[-\s]?packaging|chip[-\s]?packaging|memory)/i, themeId: 'AI_COMPUTE_HBM_COWOS' },
  { rx: /(liquid[-\s]?cool|immersion|thermal[-\s]?management|data[-\s]?center cool)/i, themeId: 'AI_DATA_CENTER_COOLING' },
  { rx: /(nuclear|smr|uranium|haleu)/i, themeId: 'NUCLEAR_SMR' },
  { rx: /(defen[cs]e|aerospace|missile|radar|naval|shipbuild)/i, themeId: 'DEFENSE_AEROSPACE' },
  { rx: /(rare[-\s]?earth|critical[-\s]?mineral|ndpr|neodymium|lithium)/i, themeId: 'CRITICAL_MINERALS_RARE_EARTH' },
  { rx: /(api|pharma\b|china[-\s]?\+1|cdmo)/i, themeId: 'PHARMA_API_CHINA_PLUS_ONE' },
  { rx: /(electronics|pli|ems\b|mobile\s+manufact|semiconductor\s+pli)/i, themeId: 'ELECTRONICS_MANUFACTURING_PLI' },
];

export function resolveTheme(themeId: string | undefined, label?: string | undefined): BottleneckTheme | undefined {
  const blob = `${themeId || ''} ${label || ''}`.toLowerCase();
  // First exact id match
  const exact = THEMES.find(t => (themeId || '').toUpperCase() === t.themeId);
  if (exact) return exact;
  // Otherwise hint-driven
  for (const h of RESOLVE_HINTS) {
    if (h.rx.test(blob)) {
      const found = THEMES.find(t => t.themeId === h.themeId);
      if (found) return found;
    }
  }
  return undefined;
}

// Convenience: tier-color + glyph for credibility chip in news cards.
export function credibilityChip(source?: string, url?: string): { tier: CredibilityTier; label: string; color: string; glyph: string; weight: number } {
  const tier = classifyCredibility(source, url);
  const meta = CREDIBILITY_TIER_META[tier];
  return { tier, label: meta.label, color: meta.color, glyph: meta.glyph, weight: CREDIBILITY_WEIGHT[tier] };
}
