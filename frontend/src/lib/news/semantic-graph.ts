// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC GRAPH — patch 0051
//
// Replaces the regex-centric ontology with permanent SystemNode primitives.
// Adding a new technology/theme becomes a data update (a row in
// TOKEN_TO_NODE), not a regex rewrite. The graph survives technology
// generations because the nodes are economic-system descriptions, not
// the names of any particular technology.
//
// HBM is temporary. MEMORY_INFRA is permanent.
// CoWoS is temporary. PACKAGING_INFRA is permanent.
// AI accelerators are temporary. COMPUTE_INFRA is permanent.
//
// Future themes (quantum interconnects, neuromorphic memory, fusion grid,
// humanoid supply chains) become rows in TOKEN_TO_NODE — no code change.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Permanent SystemNode primitives ──────────────────────────────────────

export type SystemNode =
  // Compute stack
  | 'COMPUTE_INFRA'           // accelerators, AI chips, training clusters
  | 'MEMORY_INFRA'            // HBM, DRAM, NAND, SSD, neuromorphic memory
  | 'PACKAGING_INFRA'         // CoWoS, chiplets, advanced packaging
  | 'FABRICATION_INFRA'       // wafer, fab, foundry, lithography
  | 'INTERCONNECT_INFRA'      // photonics, optical, networking, NICs
  | 'COOLING_INFRA'           // thermal, liquid, immersion, CDU
  | 'NETWORK_BANDWIDTH'       // 5G/6G, fiber, undersea, satellite
  // Energy
  | 'ENERGY_INFRA'            // power grid, transformers, generation
  | 'NUCLEAR_INFRA'           // reactors, fuel, SMR, breeder
  | 'OIL_GAS_INFRA'           // refining, pipelines, LNG
  | 'RENEWABLE_INFRA'         // solar, wind, hydro, BESS, hydrogen
  // Logistics & transport
  | 'LOGISTICS_INFRA'         // shipping, ports, freight, last-mile
  | 'TRANSPORT_INFRA'         // rail, road, air, EV charging
  // Defense / strategic
  | 'DEFENSE_INFRA'           // platforms, ordnance, strategic kit
  | 'AEROSPACE_INFRA'         // launch, satellite, defense aerospace
  // Resources
  | 'RESOURCE_SCARCITY'       // rare earth, lithium, uranium, copper
  | 'AGRI_INFRA'              // food, fertilizer, water, pesticides
  // Macro / capital
  | 'MANUFACTURING_CAPACITY'  // production capacity, ramp, capex
  | 'LABOR_CONSTRAINT'        // talent, layoffs, strikes, skill gap
  | 'CAPITAL_CONSTRAINT'      // credit, NPA, banking infra, payment rails
  // Other
  | 'NONE';

// ─── Event class — separate from half-life; describes nature, not duration ─

export type EventClass =
  | 'EVENT'        // discrete one-time happening (earnings beat, deal close)
  | 'CYCLE'        // mid-cycle business / commodity rhythm (oil up, demand)
  | 'STRUCTURE'    // multi-year structural shift (HBM shortage, packaging)
  | 'SECULAR';     // decade-scale paradigm (AI compute, grid modernization)

// ─── Token → Node mapping ──────────────────────────────────────────────────
// Each row maps a regex pattern to a SystemNode + a weight + an event hint.
// Adding new themes = appending rows. No code change required.
// Weights tuned: 8 = strong domain signal; 4 = generic word that needs
// disambiguation context; 2 = secondary cue.

interface TokenMapping {
  pattern: RegExp;
  node: SystemNode;
  weight: number;
  event_hint: EventClass;
  // optional companion: requires another regex to also match (within full
  // text) before this token contributes
  companion?: RegExp;
}

export const TOKEN_TO_NODE: TokenMapping[] = [
  // ─── COMPUTE_INFRA ──────────────────────────────────────────────────────
  { pattern: /\b(ai accelerator|ai chip|gpu|tpu)\b/i,                  node: 'COMPUTE_INFRA',  weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(training cluster|inference cluster|ai cluster)\b/i,    node: 'COMPUTE_INFRA',  weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(neuromorphic|quantum (compute|chip|processor))\b/i,    node: 'COMPUTE_INFRA',  weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(custom silicon|asic design|hyperscaler chip)\b/i,      node: 'COMPUTE_INFRA',  weight: 6, event_hint: 'STRUCTURE' },

  // ─── MEMORY_INFRA ───────────────────────────────────────────────────────
  { pattern: /\bhbm\d?e?\b/i,                                          node: 'MEMORY_INFRA',   weight: 9, event_hint: 'STRUCTURE' },
  { pattern: /\b(dram|ddr5|ddr6)\b/i,                                  node: 'MEMORY_INFRA',   weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\bnand\b/i,                                              node: 'MEMORY_INFRA',   weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(neuromorphic memory|3d dram|cxl memory)\b/i,           node: 'MEMORY_INFRA',   weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(memory bandwidth|memory wall)\b/i,                    node: 'MEMORY_INFRA',   weight: 7, event_hint: 'STRUCTURE' },

  // ─── PACKAGING_INFRA ────────────────────────────────────────────────────
  { pattern: /\b(cowos|cowos-?[a-z]|emib|foveros)\b/i,                 node: 'PACKAGING_INFRA', weight: 9, event_hint: 'STRUCTURE' },
  { pattern: /\b(chiplet|interposer|hybrid bonding|2\.5d|3d stacking)\b/i, node: 'PACKAGING_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\badvanced packaging\b/i,                                 node: 'PACKAGING_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(osat|amkor|ase group)\b/i,                            node: 'PACKAGING_INFRA', weight: 5, event_hint: 'STRUCTURE' },

  // ─── FABRICATION_INFRA ──────────────────────────────────────────────────
  { pattern: /\beuv\b/i,                                               node: 'FABRICATION_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(asml|lithography|euv tool)\b/i,                       node: 'FABRICATION_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(wafer|fab capacity)\b/i,                              node: 'FABRICATION_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(capacity|tight|allocation|backlog|construction|expansion|shortage|sold out)/i },
  { pattern: /\b(foundry|tsmc|globalfoundries|samsung foundry|intel foundry)\b/i, node: 'FABRICATION_INFRA', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(2nm|3nm|5nm|7nm|10nm|14nm)\b/i,                       node: 'FABRICATION_INFRA', weight: 5, event_hint: 'CYCLE' },

  // ─── INTERCONNECT_INFRA ─────────────────────────────────────────────────
  { pattern: /\b(silicon photonics|co.?packaged optics|cpo)\b/i,       node: 'INTERCONNECT_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(optical interconnect|optical i\/o)\b/i,                node: 'INTERCONNECT_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(quantum interconnect|spinwave)\b/i,                    node: 'INTERCONNECT_INFRA', weight: 9, event_hint: 'SECULAR' },
  { pattern: /\b(infiniband|nvlink|dpu|smart nic)\b/i,                  node: 'INTERCONNECT_INFRA', weight: 5, event_hint: 'STRUCTURE' },

  // ─── COOLING_INFRA ──────────────────────────────────────────────────────
  { pattern: /\b(liquid cooling|immersion cooling|cdu)\b/i,            node: 'COOLING_INFRA',  weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(thermal management|rack cooling|direct-to-chip)\b/i,   node: 'COOLING_INFRA',  weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(thermal limit|cooling capacity)\b/i,                  node: 'COOLING_INFRA',  weight: 5, event_hint: 'STRUCTURE' },

  // ─── NETWORK_BANDWIDTH ──────────────────────────────────────────────────
  { pattern: /\b(5g|6g|fiber|fibre)\b/i,                              node: 'NETWORK_BANDWIDTH', weight: 4, event_hint: 'CYCLE',
    companion: /(rollout|capacity|spectrum|deploy|build|tender)/i },
  { pattern: /\b(undersea cable|submarine cable|satellite (constellation|broadband))\b/i, node: 'NETWORK_BANDWIDTH', weight: 6, event_hint: 'STRUCTURE' },

  // ─── ENERGY_INFRA ───────────────────────────────────────────────────────
  { pattern: /\b(power grid|electricity grid)\b/i,                      node: 'ENERGY_INFRA',   weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(transmission line|substation|transformer)\b/i,         node: 'ENERGY_INFRA',   weight: 5, event_hint: 'STRUCTURE',
    companion: /(capacity|order|shortage|backlog|expansion|constraint|stress)/i },
  { pattern: /\b(grid (capacity|stress|congestion|stability|frequency))\b/i, node: 'ENERGY_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(load shedding|blackout|brownout|power deficit|electricity shortage)\b/i, node: 'ENERGY_INFRA', weight: 8, event_hint: 'CYCLE' },
  { pattern: /\b(data center power|hyperscaler power)\b/i,             node: 'ENERGY_INFRA',   weight: 7, event_hint: 'SECULAR' },
  { pattern: /\b(coal (stockpile|stock at|shortage|imports?|allocation)|coal india)\b/i, node: 'ENERGY_INFRA', weight: 6, event_hint: 'CYCLE' },
  { pattern: /\b(battery cell|gigafactory|electrolyser|green hydrogen|fusion)\b/i, node: 'ENERGY_INFRA', weight: 6, event_hint: 'SECULAR' },
  { pattern: /\b\d{2,4}\s*(mw|gw|kva)\b/i,                            node: 'ENERGY_INFRA',   weight: 4, event_hint: 'EVENT' },

  // ─── NUCLEAR_INFRA ──────────────────────────────────────────────────────
  { pattern: /\b(nuclear (reactor|power|plant|fuel|capacity))\b/i,     node: 'NUCLEAR_INFRA',  weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(small modular reactor|smr)\b/i,                       node: 'NUCLEAR_INFRA',  weight: 7, event_hint: 'SECULAR' },
  { pattern: /\b(thorium|breeder reactor|fast breeder|criticality)\b/i, node: 'NUCLEAR_INFRA', weight: 7, event_hint: 'SECULAR' },
  { pattern: /\b(npcil|bhavini|kalpakkam|kudankulam)\b/i,              node: 'NUCLEAR_INFRA',  weight: 7, event_hint: 'STRUCTURE' },

  // ─── OIL_GAS_INFRA ──────────────────────────────────────────────────────
  { pattern: /\b(refinery (commissioning|capacity expansion|throughput|shutdown|maintenance))\b/i, node: 'OIL_GAS_INFRA', weight: 6, event_hint: 'CYCLE' },
  { pattern: /\b(oil pipeline|gas pipeline|kg-?d6|kg-?krishna)\b/i,    node: 'OIL_GAS_INFRA',  weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(opec.{0,15}(quota|cut|production))\b/i,                node: 'OIL_GAS_INFRA',  weight: 5, event_hint: 'CYCLE' },
  { pattern: /\b(strategic petroleum reserve|spr)\b/i,                  node: 'OIL_GAS_INFRA',  weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(lng (carrier|terminal|capacity|export))\b/i,           node: 'OIL_GAS_INFRA',  weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(crude oil|brent|wti)\b/i,                             node: 'OIL_GAS_INFRA',  weight: 4, event_hint: 'CYCLE',
    companion: /(price|supply|cut|production|spike|surge|crisis|ban|sanction)/i },

  // ─── RENEWABLE_INFRA ────────────────────────────────────────────────────
  { pattern: /\b(solar (capacity|farm|park|project)|pv module)\b/i,    node: 'RENEWABLE_INFRA', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(wind (farm|capacity|turbine|tender))\b/i,             node: 'RENEWABLE_INFRA', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(green hydrogen|electrolyser|hydrogen mission)\b/i,     node: 'RENEWABLE_INFRA', weight: 6, event_hint: 'SECULAR' },
  { pattern: /\b(bess|battery storage|pumped storage)\b/i,             node: 'RENEWABLE_INFRA', weight: 5, event_hint: 'STRUCTURE' },

  // ─── LOGISTICS_INFRA ────────────────────────────────────────────────────
  { pattern: /\b(shipping container|container shortage|container rate)\b/i, node: 'LOGISTICS_INFRA', weight: 6, event_hint: 'CYCLE' },
  { pattern: /\b(port (congestion|backlog|capacity|expansion))\b/i,    node: 'LOGISTICS_INFRA', weight: 6, event_hint: 'CYCLE' },
  { pattern: /\b(freight (rate|congestion|capacity))\b/i,              node: 'LOGISTICS_INFRA', weight: 5, event_hint: 'CYCLE' },
  { pattern: /\b(supply chain (disruption|gap|crisis|crunch))\b/i,     node: 'LOGISTICS_INFRA', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(strait of hormuz|red sea|panama canal|suez)\b/i,      node: 'LOGISTICS_INFRA', weight: 6, event_hint: 'EVENT',
    companion: /(disruption|blockade|attack|closure|congestion|delay)/i },
  { pattern: /\b(jnpt|sagarmala|major port)\b/i,                       node: 'LOGISTICS_INFRA', weight: 5, event_hint: 'STRUCTURE' },

  // ─── TRANSPORT_INFRA ────────────────────────────────────────────────────
  { pattern: /\b(railway (freight|capex|tender|order)|vande bharat|rail vikas)\b/i, node: 'TRANSPORT_INFRA', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(highway contract|nhai (award|tender|contract))\b/i,    node: 'TRANSPORT_INFRA', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(metro rail tender|metro rail|coach order)\b/i,        node: 'TRANSPORT_INFRA', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(ev charging|charging infrastructure|hpcl charging)\b/i, node: 'TRANSPORT_INFRA', weight: 5, event_hint: 'STRUCTURE' },

  // ─── DEFENSE_INFRA ──────────────────────────────────────────────────────
  { pattern: /\b(defence (order|procurement|deal|corridor|export|contract win))\b/i, node: 'DEFENSE_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(defense (order|procurement|contract|spending|export))\b/i, node: 'DEFENSE_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(brahmos|akash|tejas|rafale|s-400|p-?75|pinaka|agni)\b/i, node: 'DEFENSE_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(order|deliver|contract|production|export|deployment|squadron|batch)/i },
  { pattern: /\b(submarine|fighter jet|missile|warship|aircraft carrier)\b/i, node: 'DEFENSE_INFRA', weight: 4, event_hint: 'EVENT',
    companion: /(order|build|deliver|acquisition|procurement|contract|fleet)/i },

  // ─── AEROSPACE_INFRA ────────────────────────────────────────────────────
  { pattern: /\b(pslv|gslv|chandrayaan|gaganyaan)\b/i,                 node: 'AEROSPACE_INFRA', weight: 6, event_hint: 'EVENT' },
  { pattern: /\b(starlink|spacex|launch (cadence|capacity)|leo constellation)\b/i, node: 'AEROSPACE_INFRA', weight: 5, event_hint: 'SECULAR' },

  // ─── RESOURCE_SCARCITY ──────────────────────────────────────────────────
  { pattern: /\brare earth\b/i,                                        node: 'RESOURCE_SCARCITY', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(lithium|cobalt|nickel|graphite|tungsten|gallium|germanium)\b/i, node: 'RESOURCE_SCARCITY', weight: 5, event_hint: 'STRUCTURE',
    companion: /(supply|export|allocation|reserve|mine|processing|ban|sanction)/i },
  { pattern: /\b(critical mineral|strategic mineral|kabil|amrita)\b/i, node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'SECULAR' },
  { pattern: /\b(uranium|enrichment|fuel rod|cameco|kazatomprom)\b/i,  node: 'RESOURCE_SCARCITY', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(copper|aluminium|aluminum|steel)\b/i,                 node: 'RESOURCE_SCARCITY', weight: 3, event_hint: 'CYCLE',
    companion: /(supply|shortage|inventory|capacity|stockpile|export ban)/i },

  // ─── AGRI_INFRA ─────────────────────────────────────────────────────────
  { pattern: /\b(fertilizer (shortage|subsidy|import)|urea|dap|mop|nitrogen fertilizer)\b/i, node: 'AGRI_INFRA', weight: 5, event_hint: 'CYCLE' },
  { pattern: /\b(monsoon (forecast|deficit|progress|rainfall))\b/i,    node: 'AGRI_INFRA', weight: 5, event_hint: 'CYCLE' },
  { pattern: /\b(crop (failure|output|damage)|food inflation)\b/i,     node: 'AGRI_INFRA', weight: 5, event_hint: 'CYCLE' },

  // ─── MANUFACTURING_CAPACITY ─────────────────────────────────────────────
  { pattern: /\b(production (capacity|expansion|ramp|cut)|capex (raise|increase|step.up|guidance))\b/i, node: 'MANUFACTURING_CAPACITY', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(pli scheme|production[- ]linked incentive)\b/i,       node: 'MANUFACTURING_CAPACITY', weight: 6, event_hint: 'STRUCTURE' },

  // ─── LABOR_CONSTRAINT ───────────────────────────────────────────────────
  { pattern: /\b(layoff|workforce (cut|reduction)|attrition|skill gap|talent shortage|wage hike|strike)\b/i, node: 'LABOR_CONSTRAINT', weight: 4, event_hint: 'EVENT' },
  { pattern: /\b(ai.{0,15}(layoff|cut|displace|automat))\b/i,           node: 'LABOR_CONSTRAINT', weight: 6, event_hint: 'SECULAR' },

  // ─── CAPITAL_CONSTRAINT ─────────────────────────────────────────────────
  { pattern: /\b(rbi.{0,15}(licence|license|repealed|revoke|granted|policy))\b/i, node: 'CAPITAL_CONSTRAINT', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(npa|gnpa|stressed asset|asset quality|sma[- ]?[12]|provision coverage)\b/i, node: 'CAPITAL_CONSTRAINT', weight: 5, event_hint: 'CYCLE' },
  { pattern: /\b(insolvency (resolution|admission)|ibc (admission|liquidation))\b/i, node: 'CAPITAL_CONSTRAINT', weight: 5, event_hint: 'EVENT' },
  { pattern: /\b(credit (crunch|squeeze)|nbfc (crisis|liquidity)|cost of funds)\b/i, node: 'CAPITAL_CONSTRAINT', weight: 5, event_hint: 'STRUCTURE' },
];

// ─── Dependency edges — graph of how nodes depend on each other ───────────
// "AI compute depends on memory + packaging + power + cooling"
//
// This is the institutional moat: when an article hits a node, the
// frontend can render the full transmission graph instead of just the
// hit node alone.

interface DependencyEdge {
  from: SystemNode;
  to: SystemNode;
  mechanism: string;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
}

export const DEPENDENCY_GRAPH: DependencyEdge[] = [
  // Compute stack
  { from: 'COMPUTE_INFRA',     to: 'MEMORY_INFRA',         mechanism: 'memory bandwidth bound',           strength: 'STRONG' },
  { from: 'COMPUTE_INFRA',     to: 'PACKAGING_INFRA',      mechanism: 'CoWoS / advanced packaging',        strength: 'STRONG' },
  { from: 'COMPUTE_INFRA',     to: 'FABRICATION_INFRA',    mechanism: 'wafer + EUV lithography',           strength: 'STRONG' },
  { from: 'COMPUTE_INFRA',     to: 'INTERCONNECT_INFRA',   mechanism: 'optical I/O scaling',               strength: 'STRONG' },
  { from: 'COMPUTE_INFRA',     to: 'COOLING_INFRA',        mechanism: 'rack thermal envelope',             strength: 'STRONG' },
  { from: 'COMPUTE_INFRA',     to: 'ENERGY_INFRA',         mechanism: 'datacenter power',                  strength: 'STRONG' },
  { from: 'COMPUTE_INFRA',     to: 'NETWORK_BANDWIDTH',    mechanism: 'inter-DC bandwidth',                strength: 'MODERATE' },
  // Memory dependencies
  { from: 'MEMORY_INFRA',      to: 'PACKAGING_INFRA',      mechanism: 'HBM stacking',                      strength: 'STRONG' },
  { from: 'MEMORY_INFRA',      to: 'FABRICATION_INFRA',    mechanism: 'wafer + EUV',                       strength: 'MODERATE' },
  // Energy dependencies
  { from: 'ENERGY_INFRA',      to: 'NUCLEAR_INFRA',        mechanism: 'baseload generation',               strength: 'MODERATE' },
  { from: 'ENERGY_INFRA',      to: 'OIL_GAS_INFRA',        mechanism: 'gas turbine + reserve',             strength: 'MODERATE' },
  { from: 'ENERGY_INFRA',      to: 'RENEWABLE_INFRA',      mechanism: 'capacity addition',                  strength: 'MODERATE' },
  { from: 'NUCLEAR_INFRA',     to: 'RESOURCE_SCARCITY',    mechanism: 'uranium / fuel rod',                strength: 'STRONG' },
  // Defense dependencies
  { from: 'DEFENSE_INFRA',     to: 'AEROSPACE_INFRA',      mechanism: 'platform integration',              strength: 'MODERATE' },
  { from: 'DEFENSE_INFRA',     to: 'MANUFACTURING_CAPACITY', mechanism: 'production line capex',            strength: 'STRONG' },
  // Logistics dependencies
  { from: 'LOGISTICS_INFRA',   to: 'OIL_GAS_INFRA',        mechanism: 'bunker fuel + LNG carriers',         strength: 'MODERATE' },
  // Resources flow into manufacturing
  { from: 'MANUFACTURING_CAPACITY', to: 'RESOURCE_SCARCITY', mechanism: 'feedstock supply',                strength: 'STRONG' },
];

// ─── Score the graph hits for a given title+desc ──────────────────────────

export interface GraphScore {
  total_weight: number;
  title_weight: number;
  desc_weight: number;
  primary_node: SystemNode;
  nodes_hit: Array<{ node: SystemNode; weight: number; event_class: EventClass }>;
  // Inferred event class — most-weighted token's hint
  event_class: EventClass;
  // Dependency expansion: nodes the primary depends on (1 hop)
  dependent_nodes: SystemNode[];
}

const TITLE_BONUS = 2.0;

export function scoreGraph(title: string, desc: string): GraphScore {
  const titleLower = title.toLowerCase();
  const fullLower = (title + ' ' + (desc || '')).toLowerCase();

  let titleWeight = 0;
  let descWeight = 0;
  const nodeWeights: Partial<Record<SystemNode, number>> = {};
  const nodeEventClass: Partial<Record<SystemNode, EventClass>> = {};

  for (const tok of TOKEN_TO_NODE) {
    const hitTitle = tok.pattern.test(title);
    const hitDesc = !hitTitle && tok.pattern.test(fullLower);
    if (!hitTitle && !hitDesc) continue;
    if (tok.companion && !tok.companion.test(fullLower)) continue;

    const w = tok.weight * (hitTitle ? TITLE_BONUS : 1.0);
    if (hitTitle) titleWeight += w;
    else descWeight += w;
    nodeWeights[tok.node] = (nodeWeights[tok.node] || 0) + w;
    // First hit wins for event_class (could be improved with median later)
    if (!nodeEventClass[tok.node]) nodeEventClass[tok.node] = tok.event_hint;
  }

  // Determine primary node (highest weight)
  let primary: SystemNode = 'NONE';
  let maxW = 0;
  for (const [n, w] of Object.entries(nodeWeights)) {
    if ((w ?? 0) > maxW) { maxW = w ?? 0; primary = n as SystemNode; }
  }

  // Inherit event class from primary node
  const eventClass: EventClass = nodeEventClass[primary] || 'EVENT';

  // Multi-node breadth bonus (cross-system coverage)
  const breadthBonus = Object.keys(nodeWeights).length >= 3 ? 6
                     : Object.keys(nodeWeights).length >= 2 ? 3 : 0;
  const total = titleWeight + descWeight + breadthBonus;

  // Nodes hit, sorted by weight
  const nodesHit = (Object.entries(nodeWeights) as Array<[SystemNode, number]>)
    .map(([node, weight]) => ({ node, weight: weight!, event_class: nodeEventClass[node] || 'EVENT' }))
    .sort((a, b) => b.weight - a.weight);

  // Dependent nodes (1-hop expansion of primary)
  const dependent: SystemNode[] = DEPENDENCY_GRAPH
    .filter(e => e.from === primary)
    .map(e => e.to);

  return {
    total_weight: total,
    title_weight: titleWeight,
    desc_weight: descWeight,
    primary_node: primary,
    nodes_hit: nodesHit,
    event_class: eventClass,
    dependent_nodes: dependent,
  };
}

// Threshold above which an article is eligible to enter BOTTLENECK
export const GRAPH_ANCHOR_THRESHOLD = 12;

// Display labels for nodes
export const NODE_DISPLAY: Record<SystemNode, string> = {
  COMPUTE_INFRA:           'Compute infra',
  MEMORY_INFRA:            'Memory infra',
  PACKAGING_INFRA:         'Packaging infra',
  FABRICATION_INFRA:       'Fabrication infra',
  INTERCONNECT_INFRA:      'Interconnect infra',
  COOLING_INFRA:           'Cooling infra',
  NETWORK_BANDWIDTH:       'Network bandwidth',
  ENERGY_INFRA:            'Energy infra',
  NUCLEAR_INFRA:           'Nuclear infra',
  OIL_GAS_INFRA:           'Oil & gas infra',
  RENEWABLE_INFRA:         'Renewables',
  LOGISTICS_INFRA:         'Logistics infra',
  TRANSPORT_INFRA:         'Transport infra',
  DEFENSE_INFRA:           'Defense infra',
  AEROSPACE_INFRA:         'Aerospace infra',
  RESOURCE_SCARCITY:       'Resource scarcity',
  AGRI_INFRA:              'Agri infra',
  MANUFACTURING_CAPACITY:  'Mfg capacity',
  LABOR_CONSTRAINT:        'Labor',
  CAPITAL_CONSTRAINT:      'Capital infra',
  NONE:                    '—',
};
