// ═══════════════════════════════════════════════════════════════════════════
// CHOKEPOINT INDEX — patch 0073
//
// Formalizes the chokepoint concept that was previously a binary flag
// (STRATEGIC_CHOKEPOINT) + a generic dependency_score (1-5). This module
// adds a dedicated 1-5 SEVERITY scale per canonical chokepoint category.
//
// Why this matters
//   Pricing power, margin expansion, and delivery scarcity often accrue
//   MORE to chokepoint suppliers than to prime contractors. NVIDIA gets
//   the headline; SK hynix HBM, TSMC CoWoS, and ASML EUV capture the
//   margin. This index makes the bottleneck-control signal explicit.
//
// Severity
//   5 — Sole producer (no alternative at scale)
//   4 — 2 viable suppliers globally (sub-3)
//   3 — 3-5 specialized suppliers
//   2 — 5-10 suppliers, technical moat
//   1 — Replaceable / commodity competitive
// ═══════════════════════════════════════════════════════════════════════════

export type ChokepointCategory =
  // Semiconductors
  | 'EUV_LITHO'                  // ASML — sole
  | 'COWOS_PACKAGING'            // TSMC dominant
  | 'HBM_MEMORY'                 // SKH / Samsung / Micron
  | 'ABF_SUBSTRATES'             // Ajinomoto / Showa Denko
  // Energy / Power
  | 'TRANSFORMERS_LARGE'         // GE / Hitachi / Siemens / CG / Hitachi Energy
  | 'SWITCHGEAR_HV'              // Eaton / ABB / Siemens
  | 'GAS_TURBINES_LARGE'         // GE Vernova / Siemens Energy / Mitsubishi
  | 'GRID_INTERCONNECT'          // Quanta / MasTec / KEC
  // Nuclear
  | 'HALEU_ENRICHMENT'           // Centrus — sole Western
  | 'NAVAL_PROPULSION'           // BWXT — sole US
  // Defence / Aerospace
  | 'AERO_ENGINES'               // GE / Rolls-Royce / Pratt
  | 'MISSILE_SEEKERS_RF'         // BEL / Raytheon / Astra Microwave
  // AI infrastructure
  | 'AI_GPU_CLUSTERS'            // NVIDIA — dominant
  | 'LIQUID_COOLING_AI'          // Vertiv / nVent / Boyd
  | 'OPTICAL_INTERCONNECT_800G'  // Coherent / Lumentum / Marvell
  // Critical materials
  | 'RARE_EARTH_MAGNETS'         // China-dominant / MP Materials / Lynas
  | 'URANIUM_WESTERN'            // Cameco / Kazatomprom

  | 'NONE';

export interface ChokepointDefinition {
  category: ChokepointCategory;
  label: string;
  severity: 1 | 2 | 3 | 4 | 5;
  global_competitors: string;
  rationale: string;
  primary_tickers: string[];
  // Pattern that triggers detection — matched against title+desc lowercased
  detect_pattern: RegExp;
}

const CHOKEPOINT_REGISTRY: ChokepointDefinition[] = [
  // ── Severity 5 — sole / near-sole producer ─────────────────────────
  {
    category: 'EUV_LITHO',
    label: 'EUV Lithography',
    severity: 5,
    global_competitors: 'ASML — sole producer',
    rationale: 'Sole supplier of EUV scanners; no alternative for ≤7nm logic. Backlog-bound for years.',
    primary_tickers: ['ASML'],
    detect_pattern: /\b(asml|euv (?:scanner|lithography|tool|machine)|extreme ultraviolet)\b/i,
  },
  {
    category: 'HALEU_ENRICHMENT',
    label: 'HALEU Enrichment',
    severity: 5,
    global_competitors: 'Centrus — sole Western commercial; TENEX (Russia) blocked',
    rationale: 'Sole Western HALEU producer; bottleneck for advanced reactors / SMRs / Naval. State-backed.',
    primary_tickers: ['LEU'],
    detect_pattern: /\b(haleu|centrus|leu enrichment|advanced fuel cycle|nuclear fuel sovereignty)\b/i,
  },
  {
    category: 'NAVAL_PROPULSION',
    label: 'Naval Reactor Propulsion',
    severity: 5,
    global_competitors: 'BWXT — sole US Naval reactor producer',
    rationale: 'Sole US producer of Naval reactor cores. Chokepoint for SSBN/SSN program.',
    primary_tickers: ['BWXT'],
    detect_pattern: /\b(bwxt|bwx technologies|naval reactor|columbia.?class|virginia.?class)\b/i,
  },

  // ── Severity 4 — sub-3 global suppliers ─────────────────────────────
  {
    category: 'COWOS_PACKAGING',
    label: 'CoWoS Advanced Packaging',
    severity: 4,
    global_competitors: 'TSMC dominant; ASE / Samsung distant',
    rationale: 'Advanced packaging chokepoint for AI GPUs; TSMC capacity controls GPU build pace.',
    primary_tickers: ['TSM'],
    detect_pattern: /\b(cowos|chip[-\s]on[-\s]wafer|advanced packaging|tsmc packaging)\b/i,
  },
  {
    category: 'HBM_MEMORY',
    label: 'HBM Memory (HBM3E / HBM4)',
    severity: 4,
    global_competitors: 'SKH leads; Samsung / Micron lag',
    rationale: 'Sub-3 global HBM suppliers. Binding constraint for AI GPU build.',
    primary_tickers: ['MU', '000660.KS', '005930.KS'],
    detect_pattern: /\b(hbm[34]?[ea]?|high.?bandwidth memory|sk hynix.{0,30}(?:memory|hbm)|micron.{0,30}hbm)\b/i,
  },
  {
    category: 'AI_GPU_CLUSTERS',
    label: 'AI GPU Clusters',
    severity: 4,
    global_competitors: 'NVIDIA dominant; AMD MI300 + custom silicon trail',
    rationale: 'NVIDIA captures most AI training spend; switching cost from CUDA is high.',
    primary_tickers: ['NVDA', 'AMD'],
    detect_pattern: /\b(nvidia|h100|h200|b100|b200|gb200|gb300|cuda|tensorrt|nvidia gpu cluster)\b/i,
  },
  {
    category: 'AERO_ENGINES',
    label: 'Commercial Aero Engines',
    severity: 4,
    global_competitors: 'GE / Rolls-Royce / Pratt — three players for wide-body',
    rationale: 'Sub-3 wide-body engine OEMs. Long certification cycles + service annuity.',
    primary_tickers: ['GE', 'RR.L', 'RTX'],
    detect_pattern: /\b(geno?x|leap engine|trent (?:1000|7000|xwb)|pw1100g|aero engine|jet engine (?:order|maintenance))\b/i,
  },

  // ── Severity 3 — 3-5 specialized suppliers ──────────────────────────
  {
    category: 'TRANSFORMERS_LARGE',
    label: 'Large Power Transformers',
    severity: 3,
    global_competitors: 'GE Vernova / Hitachi / Siemens / CG Power / Hyosung',
    rationale: 'Large-power-transformer lead times >2y; pricing power for grid + AI campus.',
    primary_tickers: ['GEV', 'CGPOWER.NS', 'HBL.NS', 'HEM.HE'],
    detect_pattern: /\b(transformer (?:order|backlog|capacity|shortage)|large power transformer|hvdc transformer|step.?up transformer|grid transformer)\b/i,
  },
  {
    category: 'GAS_TURBINES_LARGE',
    label: 'Large Gas Turbines',
    severity: 3,
    global_competitors: 'GE Vernova / Siemens Energy / Mitsubishi Power',
    rationale: 'Three-supplier oligopoly; backlog-bound for AI campus / data center power.',
    primary_tickers: ['GEV', 'ENR.DE', 'MHI.T'],
    detect_pattern: /\b(gas turbine (?:order|backlog|deployment)|hrsg|combined cycle|h.?class turbine|9ha|m701)\b/i,
  },
  {
    category: 'SWITCHGEAR_HV',
    label: 'High-Voltage Switchgear',
    severity: 3,
    global_competitors: 'Eaton / ABB / Siemens / Schneider',
    rationale: 'AI-grade switchgear backlog rising; lead times 18+ months.',
    primary_tickers: ['ETN', 'ABBN.SW', 'SIE.DE', 'SU.PA'],
    detect_pattern: /\b(switchgear|medium.?voltage|gis (?:order|capacity)|gas insulated switchgear)\b/i,
  },
  {
    category: 'LIQUID_COOLING_AI',
    label: 'Liquid Cooling (Direct-chip / Immersion)',
    severity: 3,
    global_competitors: 'Vertiv leads; nVent / Boyd / Asetek follow',
    rationale: 'B100/B200 thermal density requires liquid cooling; specification lock-in.',
    primary_tickers: ['VRT', 'NVT', 'BOYD'],
    detect_pattern: /\b(liquid cooling|direct.?chip cooling|immersion cooling|cdu (?:order|capacity)|cold plate)\b/i,
  },
  {
    category: 'OPTICAL_INTERCONNECT_800G',
    label: 'Optical Interconnect 800G / 1.6T',
    severity: 3,
    global_competitors: 'Coherent / Lumentum / Marvell DSP',
    rationale: 'AI fabric pluggables — limited scale producers for 800G+; DSPs are sub-3.',
    primary_tickers: ['COHR', 'LITE', 'AVGO', 'MRVL'],
    detect_pattern: /\b(800g (?:optical|transceiver|pluggable)|1\.6t (?:optical|transceiver)|optical interconnect|silicon photonics|coherent.{0,10}optical|lumentum)\b/i,
  },
  {
    category: 'GRID_INTERCONNECT',
    label: 'Grid Interconnect / Substation EPC',
    severity: 3,
    global_competitors: 'Quanta / MasTec / KEC / Sterlite Power / Larsen',
    rationale: 'AI campus grid-interconnect lead times >24 months; EPC moat is geographic.',
    primary_tickers: ['PWR', 'MTZ', 'KEC.NS', 'STRTECH.NS'],
    detect_pattern: /\b(grid interconnection|substation (?:epc|construction)|transmission interconnect|utility (?:approval|interconnect))\b/i,
  },
  {
    category: 'MISSILE_SEEKERS_RF',
    label: 'Missile RF Seekers / Radar',
    severity: 3,
    global_competitors: 'Raytheon / Lockheed / BEL / Astra Microwave / IAI',
    rationale: 'RF seekers + AESA radar — limited qualified suppliers; defence chokepoint.',
    primary_tickers: ['RTX', 'LMT', 'BEL.NS', 'ASTRAMICRO.NS'],
    detect_pattern: /\b(rf seeker|aesa radar|active electronically scanned|ku.?band|x.?band radar|seeker head)\b/i,
  },
  {
    category: 'RARE_EARTH_MAGNETS',
    label: 'Rare Earth NdFeB Magnets',
    severity: 3,
    global_competitors: 'China dominant (~85%); MP Materials / Lynas / Iluka',
    rationale: 'Critical-mineral chokepoint for EV motors, defence, wind turbines.',
    primary_tickers: ['MP', 'LYC.AX', 'ILU.AX'],
    detect_pattern: /\b(rare earth|ndfeb|neodymium|dysprosium|terbium|samarium cobalt|rare earth magnet)\b/i,
  },
  {
    category: 'URANIUM_WESTERN',
    label: 'Western Uranium Supply',
    severity: 3,
    global_competitors: 'Cameco / Kazatomprom / Orano / Western miners',
    rationale: 'Western uranium chokepoint as TENEX/Russia is blocked; SMR demand pulling forward.',
    primary_tickers: ['CCJ', 'KAP.IL', 'DNN', 'NXE', 'UEC'],
    detect_pattern: /\b(cameco|kazatomprom|uranium offtake|u3o8|spot uranium|uranium mining|uranium fuel)\b/i,
  },
  {
    category: 'ABF_SUBSTRATES',
    label: 'ABF Substrates',
    severity: 3,
    global_competitors: 'Ajinomoto Build-up / Showa Denko / Sumitomo Bakelite',
    rationale: 'Advanced packaging substrate chokepoint; Japan-dominant.',
    primary_tickers: ['2802.T', '4004.T', '4203.T'],
    detect_pattern: /\b(abf (?:substrate|build.?up)|ajinomoto build|fc.?bga substrate)\b/i,
  },
];

// ─── Detection result ──────────────────────────────────────────────────────

export interface ChokepointResult {
  detected: boolean;
  category: ChokepointCategory;
  label: string;
  severity: 1 | 2 | 3 | 4 | 5 | 0;     // 0 if not detected
  global_competitors: string;
  rationale: string;
  primary_tickers: string[];
}

export function classifyChokepoint(args: {
  title: string;
  desc?: string;
  ticker_symbols?: string[];
}): ChokepointResult {
  const text = `${args.title} ${args.desc || ''}`;
  const tickers = (args.ticker_symbols || []).map((t) => t.toUpperCase());

  // First pass — text pattern match
  for (const def of CHOKEPOINT_REGISTRY) {
    if (def.detect_pattern.test(text)) {
      return {
        detected: true,
        category: def.category,
        label: def.label,
        severity: def.severity,
        global_competitors: def.global_competitors,
        rationale: def.rationale,
        primary_tickers: def.primary_tickers,
      };
    }
  }

  // Second pass — ticker match (if a primary ticker appears in the article tickers)
  for (const def of CHOKEPOINT_REGISTRY) {
    if (def.primary_tickers.some((t) => tickers.includes(t.toUpperCase()))) {
      return {
        detected: true,
        category: def.category,
        label: def.label,
        severity: def.severity,
        global_competitors: def.global_competitors,
        rationale: def.rationale,
        primary_tickers: def.primary_tickers,
      };
    }
  }

  return {
    detected: false,
    category: 'NONE',
    label: '',
    severity: 0,
    global_competitors: '',
    rationale: '',
    primary_tickers: [],
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────

export function chokepointSeverityColor(severity: number): string {
  if (severity >= 5) return '#8B5CF6';   // purple — sole producer
  if (severity >= 4) return '#22D3EE';   // cyan — sub-3
  if (severity >= 3) return '#10B981';   // green — 3-5 suppliers
  if (severity >= 2) return '#F59E0B';   // amber — moderate
  return '#6B7A8D';                       // gray — replaceable
}
export function chokepointSeverityDots(severity: number): string {
  return '●'.repeat(Math.max(0, Math.min(5, severity))) + '○'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, severity))));
}

// ─── Working capital intensity (numeric) — patch 0073 ─────────────────────
//
// 0  — annuity / pre-paid (e.g., AI take-or-pay)
// 25 — moderate (defence electronics / transmission EPC)
// 50 — defence systems / mid-margin builds
// 75 — long-cycle naval / shipbuilding
// 100 — extreme milestone/lump-sum exposure

export function workingCapitalIntensityNumeric(args: {
  revenue_profile?: string;
  text?: string;
}): number {
  const profile = args.revenue_profile || '';
  const text = (args.text || '').toLowerCase();
  if (profile === 'AI_TAKE_OR_PAY') return 5;
  if (profile === 'ANNUITY_INFRA') {
    return /\b(epc|construction|build phase)\b/i.test(text) ? 30 : 15;
  }
  if (profile === 'MID_MARGIN_DEFENSE') return 50;
  if (profile === 'LOW_MARGIN_BUILD') {
    return /\b(submarine|frigate|destroyer|aircraft carrier|shipbuilding)\b/i.test(text) ? 90 : 70;
  }
  if (profile === 'CAPITAL_INTENSIVE_FAB') return 60;
  if (profile === 'OPTION_VALUE') return 70;
  return 40;
}
