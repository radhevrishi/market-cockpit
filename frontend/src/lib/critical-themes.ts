// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL THEMES (PATCH 0627)
//
// Choke-point investment themes for India + USA — 6-8 each, structurally
// driven, monopoly-backed, policy-aligned. Used by the /themes page and
// the Home dashboard panel.
//
// Each theme carries: structural driver (Why), curated leader stocks
// (governance-filtered), and asymmetric risk/reward.
//
// Adding a theme: append to USA_THEMES or INDIA_THEMES below. Adding a
// leader stock: append to the theme's leaders array. Governance filter
// is editorial — every stock listed must pass clean balance sheet +
// trustworthy management + execution credibility check.
// ═══════════════════════════════════════════════════════════════════════════

export type ThemeRegion = 'US' | 'IN';

export interface ThemeLeader {
  ticker: string;       // exchange-specific
  name: string;
  exchange?: 'NYSE' | 'NASDAQ' | 'NSE' | 'BSE' | 'ASX';
  note?: string;
}

export interface CriticalTheme {
  id: string;
  region: ThemeRegion;
  name: string;
  emoji: string;
  why: string;          // 2-3 line structural driver
  leaders: ThemeLeader[];
  bearCase: string;     // -60% to -90% scenario
  bullCase: string;     // 5x-20x scenario
  priorityRank: number; // 1 = highest conviction
}

// ─── USA THEMES ─────────────────────────────────────────────────────────
export const USA_THEMES: CriticalTheme[] = [
  {
    id: 'us-critical-minerals',
    region: 'US',
    name: 'Critical Minerals & Rare Earths',
    emoji: '🌍⚡',
    why: 'US/EU/Japan cannot stay dependent on China for rare earths (95%+ refining controlled). Decoupling already underway via CHIPS Act + IRA. Whoever controls enrichment, refining & supply chains becomes a strategic choke point.',
    leaders: [
      { ticker: 'MP',   name: 'MP Materials',     exchange: 'NYSE',   note: 'Largest US rare-earth pure-play; Pentagon-backed' },
      { ticker: 'UUUU', name: 'Energy Fuels',     exchange: 'NYSE',   note: 'Uranium + rare earths integration' },
      { ticker: 'LYC',  name: 'Lynas Rare Earths',exchange: 'ASX',    note: 'Non-China NdPr refiner; Australia-listed' },
    ],
    bearCase: 'Liquidity crunch + commodity bust: -70% drawdown realistic',
    bullCase: 'Policy + supply crunch by 2030 = 5-10× upside; sustained reshoring tailwind',
    priorityRank: 1,
  },
  {
    id: 'us-ai-compute',
    region: 'US',
    name: 'AI Compute & Foundation Models',
    emoji: '🤖🧠',
    why: 'AI training and inference are the largest capital deployment cycle since hyperscale cloud. NVIDIA holds a monopoly on training (CUDA moat); inference is contestable. The compute-AND-power supply chain is the entire bottleneck.',
    leaders: [
      { ticker: 'NVDA', name: 'NVIDIA',           exchange: 'NASDAQ', note: 'CUDA + H100/B100 monopoly; training rail' },
      { ticker: 'AVGO', name: 'Broadcom',         exchange: 'NASDAQ', note: 'Custom ASIC + AI networking' },
      { ticker: 'TSM',  name: 'Taiwan Semiconductor', exchange: 'NYSE', note: 'CoWoS packaging monopoly' },
      { ticker: 'MU',   name: 'Micron',           exchange: 'NASDAQ', note: 'HBM3E + HBM4 supply (24% global)' },
    ],
    bearCase: 'AI capex cycle peaks + hyperscaler restraint: -50% to -70%',
    bullCase: 'Sustained capex through 2030 + inference at scale: 3-7×',
    priorityRank: 2,
  },
  {
    id: 'us-power-grid',
    region: 'US',
    name: 'Power Grid & Nuclear',
    emoji: '⚡☢',
    why: 'US grid is undersized for AI data-center demand growth (+50-80GW expected by 2030). Nuclear restart wave (SMR + revival) is policy-backed. Grid transformers face 18-month lead times.',
    leaders: [
      { ticker: 'CEG',  name: 'Constellation Energy',  exchange: 'NASDAQ', note: 'Nuclear fleet — hyperscaler PPA deals' },
      { ticker: 'VST',  name: 'Vistra',                exchange: 'NYSE',   note: 'Power generator + nuclear/gas mix' },
      { ticker: 'GEV',  name: 'GE Vernova',            exchange: 'NYSE',   note: 'Grid equipment + gas turbines' },
      { ticker: 'NEE',  name: 'NextEra Energy',        exchange: 'NYSE',   note: 'Largest renewables operator' },
    ],
    bearCase: 'Rate hikes crush regulated utility multiples: -40%',
    bullCase: 'Sustained capex + PPA pricing power through 2030s: 3-5×',
    priorityRank: 3,
  },
  {
    id: 'us-cyber-defense',
    region: 'US',
    name: 'Cybersecurity & Defense Tech',
    emoji: '🛡',
    why: 'Geopolitical fragmentation + ransomware industrialization make security spend non-discretionary. AI-native defense (CrowdStrike, Palantir) replaces legacy SIEM. Pentagon software contract budgets compounding.',
    leaders: [
      { ticker: 'PLTR', name: 'Palantir',          exchange: 'NASDAQ', note: 'AIP + Gotham — Pentagon AI ops' },
      { ticker: 'CRWD', name: 'CrowdStrike',       exchange: 'NASDAQ', note: 'Endpoint cloud-native monopoly' },
      { ticker: 'AXON', name: 'Axon Enterprise',   exchange: 'NASDAQ', note: 'Public-safety hardware + software bundle' },
    ],
    bearCase: 'SaaS multiple compression: -50%',
    bullCase: 'Sustained software-into-defense shift: 3-5×',
    priorityRank: 4,
  },
  {
    id: 'us-onshoring-industrial',
    region: 'US',
    name: 'Reshoring & Industrial Capex',
    emoji: '🏭🔧',
    why: 'CHIPS Act + IRA + national security create 10-year US industrial capex cycle. Foundries (Intel, TSMC AZ), battery (LG/SK), EV factories all underwritten by Federal grants.',
    leaders: [
      { ticker: 'EME',  name: 'EMCOR Group',       exchange: 'NYSE',   note: 'Mechanical/electrical contractor — capex beneficiary' },
      { ticker: 'PWR',  name: 'Quanta Services',   exchange: 'NYSE',   note: 'Electric infrastructure EPC' },
      { ticker: 'ETN',  name: 'Eaton',             exchange: 'NYSE',   note: 'Electrical components, data-center capex' },
    ],
    bearCase: 'Government grants pulled / capex peak: -40%',
    bullCase: 'Multi-decade reshoring secularity: 3-4×',
    priorityRank: 5,
  },
  {
    id: 'us-healthcare-glp1',
    region: 'US',
    name: 'GLP-1 / Obesity & Diabetes',
    emoji: '💊',
    why: 'GLP-1 (semaglutide / tirzepatide) is reshaping a $200B+ TAM. Pricing power until generics arrive in 2030s. Pipeline expansion into cardiac, NASH, addiction unlocks larger franchise.',
    leaders: [
      { ticker: 'LLY',  name: 'Eli Lilly',         exchange: 'NYSE',   note: 'Mounjaro / Zepbound — fastest-growing pharma' },
      { ticker: 'NVO',  name: 'Novo Nordisk',      exchange: 'NYSE',   note: 'Ozempic / Wegovy — incumbent leader' },
    ],
    bearCase: 'Generic erosion + pricing reform: -40%',
    bullCase: 'Pipeline expansion (cardiac/NASH): 2-3×',
    priorityRank: 6,
  },
  {
    id: 'us-uranium-nuclear-fuel',
    region: 'US',
    name: 'Uranium & Nuclear Fuel Cycle',
    emoji: '☢⚛',
    why: 'Western utilities cut off Russian uranium enrichment (~50% of supply). HALEU (high-assay LEU) needed for SMRs has 5-year buildout gap. Spot uranium up 5x since 2020 lows.',
    leaders: [
      { ticker: 'CCJ',  name: 'Cameco',            exchange: 'NYSE',   note: 'Largest non-Kazakh producer + Westinghouse JV' },
      { ticker: 'URA',  name: 'Global X Uranium ETF', exchange: 'NYSE', note: 'Diversified pure-play sector exposure' },
      { ticker: 'LEU',  name: 'Centrus Energy',    exchange: 'NYSE',   note: 'Only US HALEU producer' },
    ],
    bearCase: 'Russia returns to market / nuclear stall: -60%',
    bullCase: 'SMR scale + HALEU shortage: 5-10×',
    priorityRank: 7,
  },
];

// ─── INDIA THEMES ───────────────────────────────────────────────────────
export const INDIA_THEMES: CriticalTheme[] = [
  {
    id: 'in-power-grid-tnd',
    region: 'IN',
    name: 'Power T&D + Capex Cycle',
    emoji: '⚡🏗',
    why: 'India needs ₹17 lakh Cr in power-grid capex by 2030. PGCIL + private discoms placing orders. Transformer/cable/switchgear suppliers face 18-month lead times. AI data centers + EV charging add structural demand.',
    leaders: [
      { ticker: 'ATLANTAELE',name: 'Atlanta Electricals', exchange: 'NSE', note: 'T&D capex direct beneficiary' },
      { ticker: 'KEC',       name: 'KEC International',   exchange: 'NSE', note: 'Transmission EPC monopoly' },
      { ticker: 'CGPOWER',   name: 'CG Power',            exchange: 'NSE', note: 'Transformers + switchgear' },
      { ticker: 'TRITURBINE',name: 'Triveni Turbine',     exchange: 'NSE', note: 'Industrial steam turbines export' },
    ],
    bearCase: 'Capex cycle peaks / order intake slips: -40%',
    bullCase: 'Multi-year capex visibility through FY30: 3-5×',
    priorityRank: 1,
  },
  {
    id: 'in-defence-indigenization',
    region: 'IN',
    name: 'Defence Indigenization',
    emoji: '🛡',
    why: 'Indian MoD mandates 70%+ indigenous content by 2027. HAL Tejas Mk1A, BEL avionics, Solar Industries explosives, MAZDOCK shipyard — all monopoly/duopoly suppliers to a non-discretionary buyer.',
    leaders: [
      { ticker: 'HAL',       name: 'Hindustan Aeronautics',    exchange: 'NSE', note: 'Tejas Mk1A + helicopter monopoly' },
      { ticker: 'BEL',       name: 'Bharat Electronics',       exchange: 'NSE', note: 'Avionics + radar duopoly' },
      { ticker: 'BDL',       name: 'Bharat Dynamics',          exchange: 'NSE', note: 'Missile systems monopoly' },
      { ticker: 'MAZDOCK',   name: 'Mazagon Dock Shipyards',   exchange: 'NSE', note: 'Naval shipbuilding monopoly' },
      { ticker: 'SOLARINDS', name: 'Solar Industries',         exchange: 'NSE', note: 'Defence explosives + ammunition' },
    ],
    bearCase: 'Order intake delays / cost overruns: -30%',
    bullCase: 'Sustained order book + export wins: 3-5×',
    priorityRank: 2,
  },
  {
    id: 'in-china-plus-one-chemicals',
    region: 'IN',
    name: 'China+1 Specialty Chemicals',
    emoji: '🧪',
    why: 'Global pharma/agro/electronics formulators de-risking from China. India has clean balance sheets, regulatory approvals (USFDA/EUGMP), and 30%+ cost arbitrage. CDMO contracts compounding.',
    leaders: [
      { ticker: 'NITTAGELA', name: 'Nitta Gelatin',         exchange: 'NSE', note: 'CRDMO + specialty molecule wins' },
      { ticker: 'AARTIIND',  name: 'Aarti Industries',      exchange: 'NSE', note: 'Specialty + agro intermediates' },
      { ticker: 'NEOGEN',    name: 'Neogen Chemicals',      exchange: 'NSE', note: 'Battery electrolyte + specialty' },
      { ticker: 'TATACHEM',  name: 'Tata Chemicals',        exchange: 'NSE', note: 'Soda ash + lithium derivatives' },
    ],
    bearCase: 'China dumping returns + crude spike: -40%',
    bullCase: 'CDMO scale + new-molecule pipeline: 3-5×',
    priorityRank: 3,
  },
  {
    id: 'in-rail-modernization',
    region: 'IN',
    name: 'Rail Modernization + Vande Bharat',
    emoji: '🚄',
    why: 'Indian Railways executing the largest rail capex in 40 years: Vande Bharat sleepers, station redevelopment, electrification, KAVACH safety system. Order book backed by Government of India.',
    leaders: [
      { ticker: 'RVNL',     name: 'Rail Vikas Nigam',     exchange: 'NSE', note: 'EPC arm of Indian Railways' },
      { ticker: 'IRCON',    name: 'IRCON International',  exchange: 'NSE', note: 'Rail EPC + infra' },
      { ticker: 'TITAGARH', name: 'Titagarh Rail Systems',exchange: 'NSE', note: 'Vande Bharat manufacturing JV' },
      { ticker: 'BEML',     name: 'BEML Ltd',             exchange: 'NSE', note: 'Metro coaches + defence vehicles' },
    ],
    bearCase: 'Capex cycle delayed / execution slippage: -40%',
    bullCase: 'Multi-decade visibility: 3-5×',
    priorityRank: 4,
  },
  {
    id: 'in-data-center-build',
    region: 'IN',
    name: 'Data Centers + Hyperscale Build-out',
    emoji: '💾',
    why: 'AWS / Microsoft / Google all committed $20B+ India data-center capex through 2030. Local hyperscalers (Reliance Jio, Adani) add capacity. Power + cooling + UPS suppliers are the picks-and-shovels play.',
    leaders: [
      { ticker: 'POWERMECH', name: 'Power Mech Projects',      exchange: 'NSE', note: 'Power-plant EPC + data centers' },
      { ticker: 'CGPOWER',   name: 'CG Power',                 exchange: 'NSE', note: 'Switchgear / transformers for DCs' },
      { ticker: 'KAYNES',    name: 'Kaynes Technology',        exchange: 'NSE', note: 'ESDM + connectivity hardware' },
      { ticker: 'NETWEB',    name: 'Netweb Technologies',      exchange: 'NSE', note: 'HPC + AI server assembly' },
    ],
    bearCase: 'Capex cycle peaks + global cloud slowdown: -40%',
    bullCase: 'India DC capacity 5x by 2030: 3-5×',
    priorityRank: 5,
  },
  {
    id: 'in-pharma-us-generics',
    region: 'IN',
    name: 'Pharma US Generics + CDMO',
    emoji: '💊',
    why: 'US generic drug shortages persistent. Indian formulators (Rubicon, Sun, Dr Reddy\'s, Kwality) face USFDA EIR cleared facilities with capacity scaling. CDMO wins for innovator molecules compounding.',
    leaders: [
      { ticker: 'RUBICON',     name: 'Rubicon Research',          exchange: 'NSE', note: 'US generics + India formulator pipeline' },
      { ticker: 'KPL',         name: 'Kwality Pharma',            exchange: 'NSE', note: 'US generics + injectables' },
      { ticker: 'NEULAND',     name: 'Neuland Laboratories',      exchange: 'NSE', note: 'CDMO for innovators' },
      { ticker: 'PIIND',       name: 'PI Industries',             exchange: 'NSE', note: 'Agrochemical CSM monopoly' },
    ],
    bearCase: 'USFDA observation / pricing pressure: -40%',
    bullCase: 'Pipeline approval + CDMO scale: 3-5×',
    priorityRank: 6,
  },
  {
    id: 'in-financialization',
    region: 'IN',
    name: 'Financialization of Savings',
    emoji: '💰',
    why: 'Indian household financial assets shifting from FDs/gold to MFs + equities + insurance. SIP flows now ₹26k+ Cr/month and compounding. Asset managers, brokers, exchanges all monopoly/duopoly franchises.',
    leaders: [
      { ticker: 'HDFCAMC',    name: 'HDFC Asset Management',  exchange: 'NSE', note: 'Largest MF house — operating leverage on AUM' },
      { ticker: 'NIPPONLIFE', name: 'Nippon Life India AMC',  exchange: 'NSE', note: 'Listed AMC duopoly' },
      { ticker: 'BSE',        name: 'BSE Ltd',                exchange: 'NSE', note: 'Exchange duopoly + derivatives ramp' },
      { ticker: 'CDSL',       name: 'CDSL',                   exchange: 'NSE', note: 'Depository monopoly' },
    ],
    bearCase: 'Equity bear market kills SIPs / regulation: -40%',
    bullCase: 'Multi-decade penetration cycle: 3-5×',
    priorityRank: 7,
  },
  {
    id: 'in-premiumization',
    region: 'IN',
    name: 'Consumer Premiumization',
    emoji: '🛍',
    why: 'India\'s top-100M consumers reaching $5,000+ per-capita income, the discretionary-spending inflection point. Luxury watches, premium luggage, jewellery, branded apparel, QSR — all see double-digit volume growth.',
    leaders: [
      { ticker: 'TITAN',      name: 'Titan Company',          exchange: 'NSE', note: 'Premium jewellery + watches monopoly' },
      { ticker: 'SAFARI',     name: 'Safari Industries',      exchange: 'NSE', note: 'Premium luggage market-share gainer' },
      { ticker: 'THANGAMAYL', name: 'Thangamayil Jewellery',  exchange: 'NSE', note: 'Tier-2/3 jewellery premiumization' },
      { ticker: 'DOMSIND',    name: 'DOMS Industries',        exchange: 'NSE', note: 'Premium stationery monopoly' },
    ],
    bearCase: 'Discretionary slowdown / rural distress: -30%',
    bullCase: 'Sustained per-capita rise + brand consolidation: 3-5×',
    priorityRank: 8,
  },
];

export function getThemesByRegion(region: ThemeRegion): CriticalTheme[] {
  return (region === 'US' ? USA_THEMES : INDIA_THEMES).slice().sort((a, b) => a.priorityRank - b.priorityRank);
}

/** Returns top-3 themes per region for the Home dashboard summary card. */
export function getTopThemesForHome(): { us: CriticalTheme[]; india: CriticalTheme[] } {
  return {
    us: USA_THEMES.slice().sort((a, b) => a.priorityRank - b.priorityRank).slice(0, 3),
    india: INDIA_THEMES.slice().sort((a, b) => a.priorityRank - b.priorityRank).slice(0, 3),
  };
}
