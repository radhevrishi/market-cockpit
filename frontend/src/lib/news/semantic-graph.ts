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
  // PATCH 0060: semiconductor manufacturing chain — substrates, photoresists, gases, chemicals
  { pattern: /\b(abf substrate|ajinomoto build.?up film|abf supply)\b/i, node: 'FABRICATION_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(photoresist|euv resist|jsr|tokyo ohka|shin.?etsu chemical)\b/i, node: 'FABRICATION_INFRA', weight: 7, event_hint: 'STRUCTURE',
    companion: /(supply|shortage|allocation|lead time|capacity|expansion|export|ban)/i },
  { pattern: /\b(specialty gas|electronic gas|process gas|neon gas|nf3|wf6)\b/i, node: 'FABRICATION_INFRA', weight: 7, event_hint: 'STRUCTURE',
    companion: /(supply|shortage|allocation|disruption|export|ban|spike)/i },
  { pattern: /\b(silicon wafer|300mm wafer|polysilicon|wafer supply)\b/i, node: 'FABRICATION_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(slurry|cmp slurry|advanced chemical|chip chemical|fluoropolymer)\b/i, node: 'FABRICATION_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(supply|allocation|capacity|shortage|expansion)/i },

  // ─── INTERCONNECT_INFRA ─────────────────────────────────────────────────
  { pattern: /\b(silicon photonics|co.?packaged optics|cpo)\b/i,       node: 'INTERCONNECT_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(optical interconnect|optical i\/o)\b/i,                node: 'INTERCONNECT_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(quantum interconnect|spinwave)\b/i,                    node: 'INTERCONNECT_INFRA', weight: 9, event_hint: 'SECULAR' },
  { pattern: /\b(infiniband|nvlink|dpu|smart nic)\b/i,                  node: 'INTERCONNECT_INFRA', weight: 5, event_hint: 'STRUCTURE' },
  // PATCH 0060: fiber stack — coherent optics, DSP, fiber mfg, optical switching
  { pattern: /\b(coherent optics|coherent dsp|optical dsp)\b/i,         node: 'INTERCONNECT_INFRA', weight: 7, event_hint: 'SECULAR' },
  { pattern: /\b(800g (?:optics|module|transceiver)|1\.6t (?:optics|module))\b/i, node: 'INTERCONNECT_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(fiber manufacturing|fiber capacity|fibre manufacturing|optical fiber)\b/i, node: 'INTERCONNECT_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(supply|shortage|capacity|expansion|allocation|tender|order)/i },
  { pattern: /\b(optical switch|optical cross.?connect|ocs)\b/i,        node: 'INTERCONNECT_INFRA', weight: 6, event_hint: 'SECULAR' },
  { pattern: /\b(amphenol|corning optical|prysmian|nexans|sterlite)\b/i, node: 'INTERCONNECT_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(order|capacity|expansion|tender|deal|supply)/i },

  // ─── COOLING_INFRA ──────────────────────────────────────────────────────
  { pattern: /\b(liquid cooling|immersion cooling|cdu)\b/i,            node: 'COOLING_INFRA',  weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(thermal management|rack cooling|direct-to-chip)\b/i,   node: 'COOLING_INFRA',  weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(thermal limit|cooling capacity)\b/i,                  node: 'COOLING_INFRA',  weight: 5, event_hint: 'STRUCTURE' },
  // PATCH 0060: cooling depth — chillers, HVAC industrial, water constraints
  { pattern: /\b(industrial chiller|precision chiller|crac unit|crah unit|hvac)\b/i, node: 'COOLING_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(data center|datacenter|hyperscaler|cooling|capacity|order)/i },
  { pattern: /\b(water (?:constraint|cooling|withdrawal|consumption|risk))\b/i, node: 'COOLING_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(data center|datacenter|hyperscaler|drought|water (?:cooled|use))/i },
  { pattern: /\b(vertiv|schneider electric|eaton cooling|nlight)\b/i,  node: 'COOLING_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(order|capacity|expansion|tender|win|deal)/i },

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
  // PATCH 0060: transformer / grid equipment depth
  { pattern: /\b(transformer (?:lead time|shortage|backlog|order book|tender))\b/i, node: 'ENERGY_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(switchgear|gis switchgear|hvdc|high.?voltage)\b/i,    node: 'ENERGY_INFRA',   weight: 6, event_hint: 'STRUCTURE',
    companion: /(order|capacity|expansion|tender|shortage|backlog|deal|win)/i },
  { pattern: /\b(copper winding|grain.?oriented steel|crgo|hrgo)\b/i,  node: 'ENERGY_INFRA',   weight: 7, event_hint: 'STRUCTURE',
    companion: /(supply|shortage|capacity|allocation|import|export)/i },
  { pattern: /\b(utility queue|interconnection queue|grid connection backlog)\b/i, node: 'ENERGY_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(ge vernova|hitachi energy|prysmian|abb power|eaton)\b/i, node: 'ENERGY_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(order|capacity|expansion|tender|deal|win|backlog)/i },
  { pattern: /\b(ppa|power purchase agreement)\b/i,                    node: 'ENERGY_INFRA',   weight: 6, event_hint: 'STRUCTURE',
    companion: /(data center|hyperscaler|signed|gigawatt|gw)/i },

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
  // PATCH 0060: aerospace supply chain depth
  { pattern: /\b(aero.?engine|jet engine|geared turbofan|gtf|leap engine|trent engine|cf6|cfm56)\b/i, node: 'AEROSPACE_INFRA', weight: 7, event_hint: 'STRUCTURE',
    companion: /(shortage|backlog|lead time|maintenance|recall|delivery|order|capacity)/i },
  { pattern: /\b(titanium forging|titanium ring|aerospace forging|nickel alloy)\b/i, node: 'AEROSPACE_INFRA', weight: 7, event_hint: 'STRUCTURE',
    companion: /(supply|shortage|capacity|allocation|order)/i },
  { pattern: /\b(avionics|cockpit display|fly.?by.?wire)\b/i,          node: 'AEROSPACE_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(supply|shortage|order|capacity|certification)/i },
  { pattern: /\b(jet engine maintenance|engine mro|aircraft mro|maintenance backlog)\b/i, node: 'AEROSPACE_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(boeing|airbus|embraer|atr)\b/i,                       node: 'AEROSPACE_INFRA', weight: 4, event_hint: 'STRUCTURE',
    companion: /(order|delivery|backlog|production|cancellation|capacity|shortage)/i },

  // ─── RESOURCE_SCARCITY ──────────────────────────────────────────────────
  { pattern: /\brare earth\b/i,                                        node: 'RESOURCE_SCARCITY', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(lithium|cobalt|nickel|graphite|tungsten|gallium|germanium)\b/i, node: 'RESOURCE_SCARCITY', weight: 5, event_hint: 'STRUCTURE',
    companion: /(supply|export|allocation|reserve|mine|processing|ban|sanction)/i },
  { pattern: /\b(critical mineral|strategic mineral|kabil|amrita)\b/i, node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'SECULAR' },
  { pattern: /\b(uranium|enrichment|fuel rod|cameco|kazatomprom)\b/i,  node: 'RESOURCE_SCARCITY', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(copper|aluminium|aluminum|steel)\b/i,                 node: 'RESOURCE_SCARCITY', weight: 3, event_hint: 'CYCLE',
    companion: /(supply|shortage|inventory|capacity|stockpile|export ban)/i },
  // PATCH 0060: rare earth depth — magnets, refining, processing
  { pattern: /\b(rare earth (?:magnet|magnets|processing|refining|export|ban))\b/i, node: 'RESOURCE_SCARCITY', weight: 9, event_hint: 'SECULAR' },
  { pattern: /\b(neodymium|dysprosium|terbium|samarium|praseodymium|ndfeb)\b/i, node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'SECULAR',
    companion: /(supply|export|magnet|processing|allocation|ban|china)/i },
  { pattern: /\b(lithium (?:refining|conversion|hydroxide|carbonate))\b/i, node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(cobalt (?:refining|processing)|graphite (?:anode|refining))\b/i, node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(copper (?:concentrate|smelting|refining|grade)|copper (?:ore|tightness))\b/i, node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(uranium (?:enrichment|conversion|deconversion)|fuel cycle|sweu)\b/i, node: 'RESOURCE_SCARCITY', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(antimony|bismuth|indium|tellurium|hafnium|zirconium)\b/i, node: 'RESOURCE_SCARCITY', weight: 6, event_hint: 'SECULAR',
    companion: /(supply|export|ban|allocation|shortage|sanction)/i },
  { pattern: /\b(china (?:rare earth|export control|critical mineral)|china export ban)\b/i, node: 'RESOURCE_SCARCITY', weight: 9, event_hint: 'EVENT' },

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

  // ═════════════════════════════════════════════════════════════════════════
  // PATCH 0098 — INDIA-SPECIFIC EXPANSION
  // 66% of Indian articles were firing graph_primary_node = NONE because the
  // patterns above are US-centric. The block below covers Indian PSU power,
  // domestic DC operators, NTPC/DAE nuclear, HAL/BEL/BDL/Mazagon defence,
  // PLI/Make-in-India manufacturing, Tata fab + Vedanta-Foxconn, fibre rollout,
  // SECI renewables, IREL critical minerals, ISRO/NSIL space.
  //
  // All pattern-based — NO hardcoded ticker→bottleneck dictionaries.
  // ═════════════════════════════════════════════════════════════════════════

  // ─── COMPUTE_INFRA — Indian DC operators + IndiaAI Mission ──────────────
  { pattern: /\b(yotta|esds|ctrls|nxtgen|nxt-?gen|sify|nseit|adani ?connex|hiranandani (?:dc|data ?cent(?:re|er))|reliance jio cloud|airtel cloud|jio platforms cloud|web werks|web werks)\b/i,
    node: 'COMPUTE_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(india ?ai (?:mission|compute|gpu|cluster)|gpu cluster (?:in india|india)|ai compute (?:in india|india|fund)|india.{0,20}(?:hyperscale|hyperscaler)|national.{0,20}ai compute|sovereign ai)\b/i,
    node: 'COMPUTE_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(\d{2,4}\s*mw\s*(?:dc|data ?cent(?:re|er)|hyperscaler|capacity))\b/i,
    node: 'COMPUTE_INFRA', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(data ?cent(?:re|er) (?:capacity|tender|allocation|expansion|build|capex|construction|approval|park|cluster))\b/i,
    node: 'COMPUTE_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(india|mumbai|chennai|hyderabad|bengaluru|bangalore|noida|navi mumbai|pune|tamil nadu|maharashtra|gujarat|telangana|karnataka|hyperscaler|nvidia|aws|azure|gcp|psu)/i },

  // ─── ENERGY_INFRA — Indian PSU power + transmission EPC ─────────────────
  { pattern: /\b(ntpc(?!.{0,30}nuclear)|power ?grid (?:corp|corporation)|powergrid|tata power|adani power|adani transmission|adani green|nhpc|nlc india|sjvn|jsw energy|ntpc green)\b/i,
    node: 'ENERGY_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(capex|order|tender|capacity|expansion|deal|win|backlog|ppa|transmission|allocation|gw|mw|approval)/i },
  { pattern: /\b(kec international|sterlite power|tata projects|larsen.{0,10}(?:power|t&d)|cg power (?:transmission|t&d)|abb india|siemens india|hitachi energy india|abb power india)\b/i,
    node: 'ENERGY_INFRA', weight: 6, event_hint: 'STRUCTURE',
    companion: /(transmission|grid|order|tender|hvdc|win|backlog|epc|substation|line|kv\b)/i },
  { pattern: /\b(rec ltd|pfc ltd|ireda|india energy exchange|iex india)\b/i,
    node: 'ENERGY_INFRA', weight: 5, event_hint: 'STRUCTURE' },

  // ─── NUCLEAR_INFRA — broader Indian patterns (DAE, NTPC nuclear, BARC) ──
  { pattern: /\b(department of atomic energy|\bdae\b|atomic energy commission|aerb|igcar|barc|bhabha atomic)\b/i,
    node: 'NUCLEAR_INFRA', weight: 8, event_hint: 'STRUCTURE' },
  { pattern: /\b(ntpc.{0,30}nuclear|nuclear.{0,30}ntpc|nuclear ?project (?:study|feasibility|approval|nod|tender))\b/i,
    node: 'NUCLEAR_INFRA', weight: 9, event_hint: 'STRUCTURE' },
  { pattern: /\b(kakrapar|tarapur|kaiga|narora|rawatbhata|gorakhpur ?nuclear|bhavini ?nuclear)\b/i,
    node: 'NUCLEAR_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(prototype fast breeder|\bpfbr\b|advanced heavy water reactor|\bahwr\b|haleu india)\b/i,
    node: 'NUCLEAR_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(india.{0,20}smr (?:tender|deployment|approval|policy)|bharat ?smr)\b/i,
    node: 'NUCLEAR_INFRA', weight: 8, event_hint: 'SECULAR' },

  // ─── FABRICATION_INFRA — India semicon mission + Tata + Vedanta-Foxconn ─
  { pattern: /\b(india semiconductor mission|isemicon|semicon india|sem ?2\.?0|sem ?ii\b)\b/i,
    node: 'FABRICATION_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(tata electronics|tata semiconductor|cg power semiconductor|tower india|powerchip india|kaynes semicon)\b/i,
    node: 'FABRICATION_INFRA', weight: 7, event_hint: 'STRUCTURE' },
  { pattern: /\b(fab in (?:india|gujarat|dholera|sanand|assam|jagiroad)|first (?:semiconductor|chip) fab.{0,20}india|micron sanand|micron.{0,15}india)\b/i,
    node: 'FABRICATION_INFRA', weight: 8, event_hint: 'SECULAR' },
  { pattern: /\b(vedanta.{0,15}foxconn|foxconn.{0,15}vedanta)\b/i,
    node: 'FABRICATION_INFRA', weight: 6, event_hint: 'EVENT' },

  // ─── PACKAGING_INFRA — Indian OSAT ──────────────────────────────────────
  { pattern: /\b(kaynes (?:semicon|osat|technology)|tata.{0,15}osat|tata.{0,15}assembly|micron.{0,15}assembly|atmp india|test.{0,10}assembly.{0,10}package)\b/i,
    node: 'PACKAGING_INFRA', weight: 7, event_hint: 'STRUCTURE' },

  // ─── INTERCONNECT_INFRA — Indian fibre / optical ────────────────────────
  { pattern: /\b(sterlite tech(?:nologies)?|stl tech|hfcl|tejas networks|polycab india|kei industries|finolex cables)\b/i,
    node: 'INTERCONNECT_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(order|tender|capacity|capex|expansion|win|deal|fibre|fiber|optical|cable|preform|backlog)/i },

  // ─── NETWORK_BANDWIDTH — Indian 5G + carrier edge + cable landings ──────
  { pattern: /\b(jio (?:5g|fiber|fibre|airfiber)|airtel (?:5g|fiber|fibre|xstream|business)|bharti (?:5g|fiber|fibre|hexa))\b/i,
    node: 'NETWORK_BANDWIDTH', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(india (?:5g|6g) (?:rollout|deployment|tender|allocation)|spectrum auction india|trai (?:5g|spectrum))\b/i,
    node: 'NETWORK_BANDWIDTH', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(chennai cable landing|mumbai cable landing|trans.?asia.?europe|2africa cable|sea-?me-?we|nixi|ix india)\b/i,
    node: 'NETWORK_BANDWIDTH', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(bharat ?net|bharatnet|gigafiber|fttx|ftth)\b/i,
    node: 'NETWORK_BANDWIDTH', weight: 5, event_hint: 'STRUCTURE' },

  // ─── COOLING_INFRA — Indian DC cooling + tropical climate ───────────────
  { pattern: /\b(voltas|blue ?star|amber enterprises|epack durable|symphony ltd|crompton greaves|johnson controls.{0,15}india)\b/i,
    node: 'COOLING_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(data ?cent(?:re|er)|hyperscaler|order|capacity|hvac|chiller|cooling|deal|win|tender)/i },

  // ─── RENEWABLE_INFRA — Indian RE + SECI tenders ─────────────────────────
  { pattern: /\b(renew (?:power|energy)|adani green|suzlon energy|inox wind|greenko|ntpc green|nhpc renewables|tata power renewables|jsw renew|borosil renewables|premier energies|waaree)\b/i,
    node: 'RENEWABLE_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(capex|order|tender|capacity|win|backlog|ppa|gw|mw|allocation|deal|approval)/i },
  { pattern: /\b(seci (?:tender|allocation|ppa|auction|sets)|seci.{0,20}gigawatt|solar park (?:in india|india)|isuw|wind.{0,5}solar (?:hybrid|tender))\b/i,
    node: 'RENEWABLE_INFRA', weight: 6, event_hint: 'STRUCTURE' },

  // ─── DEFENSE_INFRA — Indian defence PSUs + platforms (no companion) ─────
  { pattern: /\b(hindustan aeronautics|\bhal\b|bharat electronics|\bbel\b|bharat dynamics|\bbdl\b|mazagon dock|\bmdl\b|cochin shipyard|\bcsl\b|garden reach shipbuilders|\bgrse\b|\bmidhani\b|mishra dhatu|bharat forge defen[cs]e|bharat earth movers|\bbeml\b|drdo|defence research)\b/i,
    node: 'DEFENSE_INFRA', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(amca|\btedbf\b|su-?30 ?mki|mig-?29|tejas ?mk\d|tejas ?lca|prachand|dhruv|rudra|astra missile|\bnag\b ?missile|barak|akash ?ng|\bqrsam\b|\bsmarka\b|spike (?:er|missile)|nasams|man.?portable|atag|atags|nirbhay|shaurya|prithvi)\b/i,
    node: 'DEFENSE_INFRA', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(ministry of defence (?:of india|india|approval|deal|grant)|\bmod\b.{0,15}clears|cabinet committee on security|\bccs\b.{0,10}clears|aon.{0,10}defence|acceptance of necessity)\b/i,
    node: 'DEFENSE_INFRA', weight: 7, event_hint: 'EVENT' },

  // ─── AEROSPACE_INFRA — Indian space ─────────────────────────────────────
  { pattern: /\b(isro|nsil|in.?space|skyroot|agnikul|ananth technologies|pixxel|bellatrix aerospace|dhruva space|paras defence)\b/i,
    node: 'AEROSPACE_INFRA', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /\b(sslv|chandrayaan-?\d|gaganyaan|aditya-?l1|mangalyaan|navic|gsat|risat|cartosat)\b/i,
    node: 'AEROSPACE_INFRA', weight: 6, event_hint: 'EVENT' },

  // ─── MANUFACTURING_CAPACITY — Indian capex + PLI + EMS ──────────────────
  { pattern: /\b(rs\.?\s*[\d,]+\s*(?:crore|cr|lakh crore)\s*(?:capex|investment|plant|facility|expansion))\b/i,
    node: 'MANUFACTURING_CAPACITY', weight: 6, event_hint: 'STRUCTURE' },
  { pattern: /₹\s*[\d,]+\s*(?:crore|cr|lakh crore)/,
    node: 'MANUFACTURING_CAPACITY', weight: 4, event_hint: 'STRUCTURE',
    companion: /(capex|investment|plant|facility|capacity|expansion|fab|order|capex of|capex plan)/i },
  { pattern: /\b(make in india|atmanirbhar|assemble in india|china \+ ?one|electronics manufacturing services|\bems\b)\b/i,
    node: 'MANUFACTURING_CAPACITY', weight: 5, event_hint: 'SECULAR' },
  { pattern: /\b(dixon technologies|amber enterprises|kaynes technology|syrma sgs|cyient dlm|epack durable|elin electronics|optiemus|sahasra electronics)\b/i,
    node: 'MANUFACTURING_CAPACITY', weight: 6, event_hint: 'STRUCTURE',
    companion: /(capex|capacity|expansion|order|win|tender|plant|approval|pli)/i },

  // ─── RESOURCE_SCARCITY — Indian rare earth / critical minerals ──────────
  { pattern: /\b(\birel\b|indian rare earth|\bnmdc\b|\bmoil\b|hindustan zinc|\bhzl\b|\bkabil\b|gmdc|nalco)\b/i,
    node: 'RESOURCE_SCARCITY', weight: 6, event_hint: 'STRUCTURE',
    companion: /(supply|allocation|expansion|capacity|export|import|reserve|mine|bid|auction|block)/i },
  { pattern: /\b(india.{0,20}critical mineral|chinese export ban india|india.{0,20}rare earth|critical mineral mission india|critical mineral.{0,10}india)\b/i,
    node: 'RESOURCE_SCARCITY', weight: 7, event_hint: 'EVENT' },

  // ─── LOGISTICS_INFRA — Indian ports + corridors ─────────────────────────
  { pattern: /\b(adani ports|jnpt|mumbai port|chennai port|paradip|kandla|mundra|tuticorin|vizhinjam|vadhavan|deendayal port|krishnapatnam|gangavaram)\b/i,
    node: 'LOGISTICS_INFRA', weight: 5, event_hint: 'STRUCTURE',
    companion: /(capex|expansion|tender|order|capacity|congestion|throughput|deal|terminal)/i },
  { pattern: /\b(dedicated freight corridor|\bdfc\b|sagarmala|inland waterway|bharatmala|gati shakti|pm gatishakti|multimodal logistics park|\bmmlp\b)\b/i,
    node: 'LOGISTICS_INFRA', weight: 6, event_hint: 'STRUCTURE' },

  // ─── CAPITAL_CONSTRAINT — Indian banking + fund-raising ─────────────────
  { pattern: /\b(rbi (?:rate|repo|policy|monetary policy committee|mpc)|nbfc.{0,15}capital|ind.?as 109|\bcrar\b|liquidity coverage ratio|\blcr\b)\b/i,
    node: 'CAPITAL_CONSTRAINT', weight: 5, event_hint: 'STRUCTURE' },
  { pattern: /\b(qip|qualified institutional placement|rights issue|preferential allotment|fund.?rais(?:e|ing).{0,20}rs\.?)\b/i,
    node: 'CAPITAL_CONSTRAINT', weight: 5, event_hint: 'EVENT' },
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

// PATCH 0113 — BUG-03 ANTI-CONTAMINATION RULES.
// User: 'NTPC fertilizer IPO should NOT be tagged as power bottleneck.'
// Each rule penalizes a node's weight when its anti-pattern matches the
// article text — semantic-domain conflict.  Multiplier <1.0 reduces the
// score so a different (correct) node wins primary.
interface AntiContamination {
  node: SystemNode;
  antiPattern: RegExp;
  multiplier: number;     // 0.0 = veto, 0.3 = heavy penalty, 0.7 = mild
}
const ANTI_CONTAMINATION_RULES: AntiContamination[] = [
  // ENERGY_INFRA: utility tickers (NTPC, COALINDIA) appear in fertilizer / IPO /
  // movie / cricket stories — penalize when those domains dominate the text
  { node: 'ENERGY_INFRA',
    antiPattern: /\b(fertili[sz]er|urvarak|urea|ammonia|phosphate|nitrogen fertili|hindustan urvarak)\b/i,
    multiplier: 0.20 },
  { node: 'ENERGY_INFRA',
    antiPattern: /\bipo\s+(?:of|for)\s+(?:its\s+)?(?:subsidiary|fertili[sz]er|venture|joint venture|arm)\b/i,
    multiplier: 0.25 },
  // NUCLEAR_INFRA: NPCIL appears in non-nuclear infrastructure / property news
  { node: 'NUCLEAR_INFRA',
    antiPattern: /\b(real estate|property|residential|hospitality|hotel)\b/i,
    multiplier: 0.15 },
  // DEFENSE_INFRA: HAL/BEL appear in equity-fundraising stories not order news
  { node: 'DEFENSE_INFRA',
    antiPattern: /\b(qip|rights issue|preferential allotment|dividend declared|bonus issue)\b/i,
    multiplier: 0.40 },
  // RENEWABLE_INFRA: ReNew / Adani Green appear in fundraising / FII flow context
  { node: 'RENEWABLE_INFRA',
    antiPattern: /\b(qip|rights issue|fii\s+flow|dii\s+flow|mutual fund holding)\b/i,
    multiplier: 0.50 },
  // COMPUTE_INFRA: TCS/INFY mentioned in cricket/sports/entertainment context
  { node: 'COMPUTE_INFRA',
    antiPattern: /\b(cricket|bollywood|movie|film|sports|entertainment|wedding)\b/i,
    multiplier: 0.10 },
  // FABRICATION_INFRA: foundry mentioned in metal/iron/steel context
  { node: 'FABRICATION_INFRA',
    antiPattern: /\b(iron foundry|steel foundry|ferrous foundry|casting industry)\b/i,
    multiplier: 0.20 },
];

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

  // PATCH 0113: apply anti-contamination penalties before picking primary.
  // Example: 'NTPC plans IPO of fertilizer subsidiary' fires ENERGY_INFRA via
  // NTPC token, but matches the fertilizer anti-pattern → ENERGY_INFRA score
  // multiplied by 0.20 so MANUFACTURING_CAPACITY (IPO/subsidiary) or
  // AGRI_INFRA (fertilizer) wins primary.
  for (const rule of ANTI_CONTAMINATION_RULES) {
    if (rule.antiPattern.test(fullLower)) {
      const current = nodeWeights[rule.node];
      if (current != null && current > 0) {
        nodeWeights[rule.node] = current * rule.multiplier;
      }
    }
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
