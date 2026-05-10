// ═══════════════════════════════════════════════════════════════════════════
// BENEFICIARY LAYERS v1 — patch 0084
//
// PURPOSE
//   Replace the single-list "beneficiaries" output with a 6-layer pricing
//   transmission engine that propagates every bottleneck through L1→L6.
//
//   This is NOT a replacement for bottleneck detection (semantic-graph) or
//   for adaptation-based recognition (beneficiary-graph). It is the
//   beneficiary INFERENCE layer — given a bottleneck SystemNode, who wins
//   across the full pricing-power transmission cascade?
//
// LAYERS
//   L1  Direct Scarcity Capture        (input pricing power — TSMC/MU/ASML)
//   L2  Compute Substitutes            (GPU/CPU substitution — AMD/INTC/ARM)
//   L3  Edge / Distribution            (CDN/latency/bandwidth — AKAM/NET)
//   L4  Transmission Winners           (intermediate pass-through — Sterlite/GLW)
//   L5  Platform Beneficiaries         (demand aggregators — MSFT/AMZN/GOOG)
//   L6  Infrastructure / Efficiency    (power, thermal, grid — VRT/ETN)
//
// AUTO-INJECTION RULES (mandatory tickers per node-class)
//   COMPUTE / MEMORY / GPU / HBM        → AMD, INTC, ARM
//   PACKAGING (CoWoS)                   → AMD, AVGO, MRVL, AMZN, GOOGL, MSFT
//   INTERCONNECT / NETWORK_BANDWIDTH    → AKAM, NET, CIEN, LITE
//   ENERGY / COOLING                    → VRT, ETN, GEV, ARM (perf/watt)
//
// TRANSMISSION CASCADE (T0 → T4)
//   T0 (now)         News / constraint emerges
//   T1 (0–1Q)        Sentiment + order-flow shift
//   T2 (1–3Q)        Revenue acceleration in L1/L4
//   T3 (3–6Q)        Margin expansion (Sterlite-style preform→ASP→EBITDA)
//   T4 (6–12Q)       EPS rerating cycle
// ═══════════════════════════════════════════════════════════════════════════

import type { SystemNode } from '@/lib/news/semantic-graph';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BeneficiaryLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export type PricingLeverage = 'STRONG' | 'MEDIUM' | 'WEAK';

export type LayerSize = 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';

export interface LayerTicker {
  ticker: string;
  layer: BeneficiaryLayer;
  rationale: string;
  pricing_leverage: PricingLeverage;
  size: LayerSize;
  // True if this ticker is force-injected (mandatory) for the firing node-class,
  // independent of whether it co-occurs in the article. Lets the UI mark it as
  // "structurally required" vs. evidence-driven.
  mandatory?: boolean;
}

export interface LayerMeta {
  layer: BeneficiaryLayer;
  label: string;
  icon: string;
  tagline: string;
}

export const LAYER_META: Record<BeneficiaryLayer, LayerMeta> = {
  L1: { layer: 'L1', label: 'Direct Scarcity Capture',     icon: '🧱', tagline: 'Input pricing power — supply capturers' },
  L2: { layer: 'L2', label: 'Compute Substitutes',          icon: '⚙️', tagline: 'GPU / CPU / architecture substitution' },
  L3: { layer: 'L3', label: 'Edge Distribution',            icon: '🌐', tagline: 'CDN / latency / bandwidth winners' },
  L4: { layer: 'L4', label: 'Transmission Winners',         icon: '🧪', tagline: 'Intermediate pricing pass-through (Sterlite-type)' },
  L5: { layer: 'L5', label: 'Platform Beneficiaries',       icon: '🏢', tagline: 'Demand aggregators / hyperscalers' },
  L6: { layer: 'L6', label: 'Infrastructure / Efficiency',  icon: '⚡', tagline: 'Power, thermal, grid, perf-per-watt' },
};

// ─── Master roster ──────────────────────────────────────────────────────────
// Every ticker the system recognises as a layer member, with rationale,
// pricing leverage, and size class. Adding new names = appending rows.

export const LAYER_ROSTER: LayerTicker[] = [
  // ── L1 — Direct Scarcity Capture ─────────────────────────────────────────
  { ticker: 'TSM',  layer: 'L1', rationale: 'TSMC dominant foundry — captures wafer pricing power on every leading node',          pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'MU',   layer: 'L1', rationale: 'Micron HBM3E + LPDDR5X — direct margin expansion in memory tightness',                pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'ASML', layer: 'L1', rationale: 'EUV / High-NA monopoly — pricing power on every advanced fab tool',                  pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AMAT', layer: 'L1', rationale: 'Hybrid bonding + 3D-stack process — every advanced packaging line',                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'KLAC', layer: 'L1', rationale: 'KLA inspection — every HBM stack and chiplet substrate',                              pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'LRCX', layer: 'L1', rationale: 'Lam Research etch + deposition — leading-node + 3D NAND scaling',                     pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'GEV',  layer: 'L1', rationale: 'GE Vernova grid + turbines — captures power-build pricing power',                     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SMNEY',layer: 'L1', rationale: 'Siemens Energy — global grid + transformers; multi-year backlog',                     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'HTHIY',layer: 'L1', rationale: 'Hitachi Energy — HVDC + transformers, AI-DC-interconnect winner',                     pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'ETN',  layer: 'L1', rationale: 'Eaton power chain — direct beneficiary of grid + DC capex',                            pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'SBGSY',layer: 'L1', rationale: 'Schneider Electric — DC power management + microgrid leader',                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L2 — Compute Substitutes ─────────────────────────────────────────────
  { ticker: 'AMD',  layer: 'L2', rationale: 'MI300/MI325 — only credible second-source for hyperscaler training',                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'INTC', layer: 'L2', rationale: 'Gaudi + Foundry optionality — secondary CPU/GPU substitution',                        pricing_leverage: 'WEAK',   size: 'LARGE_CAP' },
  { ticker: 'ARM',  layer: 'L2', rationale: 'IP royalty on every ARM-based AI/edge core; perf/watt leader',                        pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'QCOM', layer: 'L2', rationale: 'Inference on Snapdragon + custom Oryon ARM cores; data-centre push',                   pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'AAPL', layer: 'L2', rationale: 'Apple Silicon validates ARM at scale — strategic anchor for the substitution thesis',pricing_leverage: 'WEAK',   size: 'LARGE_CAP' },
  { ticker: 'AMZN', layer: 'L2', rationale: 'Trainium / Inferentia — internal silicon substitution + cost lever',                  pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'GOOGL',layer: 'L2', rationale: 'TPU generations — internal substitution + Gemini training capacity',                  pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'MSFT', layer: 'L2', rationale: 'Maia / Cobalt — Azure-internal silicon substitution',                                  pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'AVGO', layer: 'L2', rationale: 'Custom-silicon partner for Google TPU + Meta MTIA — substitution enabler',            pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'MRVL', layer: 'L2', rationale: 'AWS Trainium + custom DPU partner — design-win volume rising',                        pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L3 — Edge / Latency / Distribution ───────────────────────────────────
  { ticker: 'AKAM', layer: 'L3', rationale: 'Akamai pivot to edge compute + generalised AI inference layer',                       pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'NET',  layer: 'L3', rationale: 'Cloudflare Workers AI + edge inference suite leader',                                 pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'FSLY', layer: 'L3', rationale: 'Fastly AI delivery + compute@edge — small-cap leverage to edge shift',                pricing_leverage: 'MEDIUM', size: 'SMALL_CAP' },
  { ticker: 'CIEN', layer: 'L3', rationale: 'Ciena DCI + coherent — backbone for AI traffic distribution',                          pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'LITE', layer: 'L3', rationale: 'Lumentum lasers + DSP — 800G+ optical reach + edge transport',                        pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'COHR', layer: 'L3', rationale: 'Coherent 800G/1.6T optical pluggables — AI fabric + edge volume',                     pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'CCOI', layer: 'L3', rationale: 'Cogent IP transit — beneficiary of decentralised inference traffic',                  pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: 'EQIX', layer: 'L3', rationale: 'Equinix interconnect — edge cabinets and inference cross-connects',                   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L4 — Sterlite-type Transmission Winners ──────────────────────────────
  // Optical fibre / preform chain
  { ticker: 'STL.NS',   layer: 'L4', rationale: 'Sterlite Tech preform → fibre ASP cascade — pricing transmission archetype',     pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: 'PRY.MI',   layer: 'L4', rationale: 'Prysmian — global cable + fibre + grid transmission leader',                      pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'GLW',      layer: 'L4', rationale: 'Corning optical communications — fibre + display + life sciences pass-through',   pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: '6005.HK',  layer: 'L4', rationale: 'YOFC Yangtze Optical Fibre — preform to fibre to cable, China DC build',          pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: '5801.T',   layer: 'L4', rationale: 'Furukawa Electric — optical fibre + power cable; Japan grid + AI',                pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  // Industrial / specialty gases
  { ticker: 'LIN',      layer: 'L4', rationale: 'Linde industrial gases — long-cycle pricing power + DC-build hydrogen',           pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AI.PA',    layer: 'L4', rationale: 'Air Liquide — specialty + electronic gases; semis-fab pricing pass-through',      pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'HON',      layer: 'L4', rationale: 'Honeywell advanced materials — specialty inputs into semis + grid',                pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  // Electronics intermediate (Japan/Taiwan ecosystem)
  { ticker: '6981.T',   layer: 'L4', rationale: 'Murata MLCCs — every AI server board; pricing leverage on capacity tightness',    pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: '6976.T',   layer: 'L4', rationale: 'Taiyo Yuden capacitors — DC-build component pass-through',                         pricing_leverage: 'MEDIUM', size: 'MID_CAP'   },
  { ticker: '4062.T',   layer: 'L4', rationale: 'Ibiden ABF substrates — CoWoS bottleneck; pricing power archetype',                pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: '6967.T',   layer: 'L4', rationale: 'Shinko Electric substrates — IC packaging + advanced substrates',                  pricing_leverage: 'STRONG', size: 'MID_CAP'   },
  { ticker: '3711.TW',  layer: 'L4', rationale: 'ASE Technology OSAT — advanced packaging volume capture',                         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  // Semis fab consumables (carry-over from FAB chain)
  { ticker: '4901.T',   layer: 'L4', rationale: 'Shin-Etsu silicon wafers + photoresist — semis pricing pass-through',             pricing_leverage: 'STRONG', size: 'LARGE_CAP' },

  // ── L5 — Platform Beneficiaries ──────────────────────────────────────────
  { ticker: 'MSFT', layer: 'L5', rationale: 'Azure + Copilot — demand aggregator monetising the AI capex super-cycle',             pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'AMZN', layer: 'L5', rationale: 'AWS Bedrock + Anthropic — full-stack hyperscaler monetisation',                       pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'GOOGL',layer: 'L5', rationale: 'GCP + Gemini + YouTube — multi-channel platform monetisation',                        pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'META', layer: 'L5', rationale: 'Meta AI + ads recommendation — internal-compute → external-revenue uplift',           pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'ORCL', layer: 'L5', rationale: 'OCI AI + Cerner — late-cycle hyperscaler platform monetisation',                      pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },

  // ── L6 — Infrastructure / Efficiency ─────────────────────────────────────
  { ticker: 'VRT',     layer: 'L6', rationale: 'Vertiv liquid CDU + busway — dominant share in hyperscaler liquid cooling',         pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'JCI',     layer: 'L6', rationale: 'Johnson Controls HVAC + DC cooling — retrofits + new build',                        pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: 'CARR',    layer: 'L6', rationale: 'Carrier HVAC + chillers — DC-cooling secondary',                                    pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
  { ticker: '2308.TW', layer: 'L6', rationale: 'Delta Electronics — power + thermal modules in every AI server',                    pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'NVT',     layer: 'L6', rationale: 'nVent thermal + Schroff — cold plate adoption; AI-cluster volume',                  pricing_leverage: 'STRONG', size: 'LARGE_CAP' },
  { ticker: 'EMR',     layer: 'L6', rationale: 'Emerson process / Liebert thermal — hyperscaler retrofits',                         pricing_leverage: 'MEDIUM', size: 'LARGE_CAP' },
];

// ─── Node → Layers + Mandatory Injection map ────────────────────────────────
// Per the v2.0 spec: every bottleneck propagates through ALL six layers, but
// each node-class has a different *rich* layer pattern + a mandatory injection
// list that must appear regardless of article co-occurrence.

interface NodeRule {
  fires: BeneficiaryLayer[];                // which layers are activated
  mandatory: Partial<Record<BeneficiaryLayer, string[]>>;  // force-inject tickers
}

export const NODE_RULES: Record<SystemNode, NodeRule> = {
  // Compute / memory / packaging — full L1-L6 with AMD/INTC/ARM injection
  COMPUTE_INFRA: {
    fires: ['L1','L2','L3','L4','L5','L6'],
    mandatory: { L2: ['AMD','INTC','ARM'], L4: ['4062.T','6981.T'], L5: ['MSFT','AMZN','GOOGL','META'], L6: ['VRT','ETN'] },
  },
  MEMORY_INFRA: {
    fires: ['L1','L2','L4','L5','L6'],
    mandatory: { L1: ['MU','TSM'], L2: ['AMD','INTC','ARM'], L4: ['4901.T','6981.T'], L5: ['MSFT','AMZN','GOOGL'] },
  },
  PACKAGING_INFRA: {
    fires: ['L1','L2','L4','L5'],
    mandatory: { L1: ['TSM','AMAT','KLAC'], L2: ['AMD','AVGO','MRVL','AMZN','GOOGL','MSFT'], L4: ['4062.T','6967.T','3711.TW'] },
  },
  FABRICATION_INFRA: {
    fires: ['L1','L2','L4','L5'],
    mandatory: { L1: ['TSM','ASML','AMAT','KLAC','LRCX'], L4: ['LIN','AI.PA','4901.T'] },
  },
  // Interconnect / network — L3 spine + AKAM/NET/CIEN/LITE injection
  INTERCONNECT_INFRA: {
    fires: ['L1','L3','L4','L6'],
    mandatory: { L3: ['AKAM','NET','CIEN','LITE','COHR'], L4: ['STL.NS','PRY.MI','GLW','6005.HK'] },
  },
  NETWORK_BANDWIDTH: {
    fires: ['L3','L4','L5','L6'],
    mandatory: { L3: ['AKAM','NET','CIEN','LITE'], L4: ['STL.NS','PRY.MI','GLW'], L5: ['MSFT','AMZN','GOOGL'] },
  },
  // Cooling — L1 power-build + L6 thermal injection
  COOLING_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: { L1: ['ETN','SBGSY'], L6: ['VRT','JCI','CARR','2308.TW','NVT','EMR'] },
  },
  // Energy — L1 grid build + L6 efficiency
  ENERGY_INFRA: {
    fires: ['L1','L4','L5','L6'],
    mandatory: { L1: ['GEV','SMNEY','HTHIY','ETN','SBGSY'], L6: ['VRT','ETN','ARM'] },
  },
  NUCLEAR_INFRA: {
    fires: ['L1','L5','L6'],
    mandatory: { L1: ['GEV','SMNEY'], L6: ['ETN','SBGSY'] },
  },
  OIL_GAS_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: { L4: ['LIN','AI.PA'] },
  },
  RENEWABLE_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: { L1: ['GEV','HTHIY','ETN'], L4: ['PRY.MI'] },
  },
  // Logistics / transport — L4 transmission + L1 capacity
  LOGISTICS_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  TRANSPORT_INFRA: {
    fires: ['L1','L4','L6'],
    mandatory: {},
  },
  // Defense / aerospace — narrow L1 + L4
  DEFENSE_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  AEROSPACE_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  // Resources — L1/L4 commodity transmission
  RESOURCE_SCARCITY: {
    fires: ['L1','L4','L6'],
    mandatory: { L4: ['LIN','AI.PA','HON'] },
  },
  AGRI_INFRA: {
    fires: ['L1','L4','L5'],
    mandatory: {},
  },
  // Macro / capital
  MANUFACTURING_CAPACITY: {
    fires: ['L1','L4','L5','L6'],
    mandatory: { L4: ['HON','LIN'] },
  },
  LABOR_CONSTRAINT: {
    fires: ['L2','L5','L6'],
    mandatory: {},
  },
  CAPITAL_CONSTRAINT: {
    fires: ['L5'],
    mandatory: {},
  },
  NONE: {
    fires: [],
    mandatory: {},
  },
};

// ─── Transmission cascade (T0 → T4) ─────────────────────────────────────────

export interface TransmissionCascade {
  T0: string;  // News / constraint emerges
  T1: string;  // 0-1Q: sentiment + order flow
  T2: string;  // 1-3Q: revenue acceleration
  T3: string;  // 3-6Q: margin expansion (Sterlite-style preform→ASP→EBITDA)
  T4: string;  // 6-12Q: EPS rerating cycle
}

// Per-node cascade copy. The T0 line is article-specific (filled at runtime);
// the T1-T4 lines describe what historically happens once a constraint of that
// class fires. Generic enough to not over-promise, specific enough to be useful.
const CASCADE_BY_NODE: Partial<Record<SystemNode, Omit<TransmissionCascade, 'T0'>>> = {
  COMPUTE_INFRA: {
    T1: 'Order books rotate to alt-accelerators (AMD MI-class, custom silicon); GPU lead-times referenced in commentary',
    T2: 'AMD / AVGO / MRVL revenue acceleration; hyperscaler capex disclosures lift L5 platform forecasts',
    T3: 'Memory + packaging ASPs drag L1/L4 EBITDA margins higher (HBM, ABF, OSAT pricing)',
    T4: 'Multiple expansion in L2 substitutes + L4 transmission winners; consensus EPS revision cycle',
  },
  MEMORY_INFRA: {
    T1: 'HBM/DRAM contract pricing referenced; MU/SK Hynix preannounce upside',
    T2: 'Micron revenue acceleration; substrate + packaging pull-through (Ibiden, Shinko)',
    T3: 'Memory gross margins step up 500-1500bps as pricing flows through inventories',
    T4: 'EPS rerating in MU + foundry chain; capex surprise disclosed by hyperscalers',
  },
  PACKAGING_INFRA: {
    T1: 'CoWoS / ABF allocation + lead-time references in supplier commentary',
    T2: 'TSMC packaging revenue mix shifts; Ibiden / Shinko utilisation inflects',
    T3: 'OSAT ASPs rise (3711.TW, 4062.T) — margin expansion in advanced packaging',
    T4: 'L2 substitution accelerates as packaging stays tight; AMD / custom-silicon design-wins disclosed',
  },
  INTERCONNECT_INFRA: {
    T1: 'Fibre / optical pricing referenced; AKAM / NET / CIEN positive prints',
    T2: 'Sterlite-type preform tightness flows to fibre ASPs; Prysmian / GLW order book grows',
    T3: 'Optical EBITDA margins expand 300-800bps (preform → fibre → cable cascade)',
    T4: 'EPS revision cycle in L4 transmission winners; multiple expansion in L3 leaders',
  },
  NETWORK_BANDWIDTH: {
    T1: 'CDN / inference-edge demand cited; Cloudflare / Akamai see acceleration',
    T2: 'L3 revenue inflects as inference distributes; backbone (CIEN, LITE) order books rise',
    T3: 'Fibre + DCI ASPs lift L4 transmission winners',
    T4: 'EPS rerating in edge platforms + optical chain',
  },
  COOLING_INFRA: {
    T1: 'CDU / liquid-cooling allocation referenced in DC operator commentary',
    T2: 'Vertiv / nVent / Delta Electronics revenue acceleration',
    T3: 'Cold-plate + heat-rejection ASPs rise; thermal margin step-up',
    T4: 'L6 multiple expansion; L2 perf/watt names (ARM, AMD) re-rate on energy gating',
  },
  ENERGY_INFRA: {
    T1: 'Interconnect queue / transformer lead-time disclosed',
    T2: 'GEV / SMNEY / Hitachi Energy book-to-bill rises; ETN order book inflects',
    T3: 'Transformer + switchgear ASPs lift; project margins expand',
    T4: 'Multi-year backlog flows into earnings; L6 efficiency winners re-rate',
  },
  NUCLEAR_INFRA: {
    T1: 'Reactor / fuel allocation referenced; SMR partnership disclosures',
    T2: 'CEG / VST PPAs disclosed; SMR / OKLO project finance momentum',
    T3: 'Long-dated nuclear PPAs lift utility EBITDA margins',
    T4: 'L5 hyperscalers disclose nuclear-backed AI capacity; rerating',
  },
  RENEWABLE_INFRA: {
    T1: 'Grid + transformer capacity for renewable build referenced',
    T2: 'GEV / Prysmian / cable order books inflect',
    T3: 'Cable / inverter ASPs lift; long-cycle margin expansion',
    T4: 'Multi-year backlog visibility drives rerating',
  },
  RESOURCE_SCARCITY: {
    T1: 'Specialty input ASP referenced in commentary',
    T2: 'L1 capturers (LIN, AI.PA) revenue acceleration',
    T3: 'Industrial-gas + specialty-input margins expand',
    T4: 'Long-cycle pricing rerates L1/L4',
  },
  MANUFACTURING_CAPACITY: {
    T1: 'Capacity utilisation / capex disclosure referenced',
    T2: 'L1 capacity owners revenue acceleration',
    T3: 'Pricing + utilisation margin expansion',
    T4: 'EPS revision cycle in capacity owners',
  },
};

const DEFAULT_CASCADE: Omit<TransmissionCascade, 'T0'> = {
  T1: 'Sentiment + order-flow rotation toward exposed names',
  T2: 'Revenue acceleration in direct beneficiaries',
  T3: 'Margin expansion as pricing flows through to operating leverage',
  T4: 'EPS rerating cycle begins; consensus revisions follow',
};

// ─── Output type ────────────────────────────────────────────────────────────

export interface LayeredBeneficiaries {
  bottleneck: SystemNode;
  bottleneck_label: string;
  layers: Record<BeneficiaryLayer, LayerTicker[]>;
  fired_layers: BeneficiaryLayer[];
  transmission: TransmissionCascade;
}

// ─── Derive ─────────────────────────────────────────────────────────────────

const ROSTER_BY_TICKER: Map<string, LayerTicker> = (() => {
  const m = new Map<string, LayerTicker>();
  for (const t of LAYER_ROSTER) m.set(t.ticker.toUpperCase(), t);
  return m;
})();

const ROSTER_BY_LAYER: Record<BeneficiaryLayer, LayerTicker[]> = (() => {
  const m: Record<BeneficiaryLayer, LayerTicker[]> = { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] };
  for (const t of LAYER_ROSTER) m[t.layer].push(t);
  return m;
})();

function nodeLabel(node: SystemNode): string {
  return node.replace(/_/g, ' ').toLowerCase();
}

/**
 * Given a bottleneck SystemNode and the article's tickers, produce the full
 * 6-layer beneficiary map + transmission cascade. Mandatory injections are
 * applied first; article tickers are then overlaid (article ticker takes
 * precedence on metadata if both are present).
 *
 * Limit per layer: 8 tickers (mandatory > article > seed remainder).
 */
export function deriveLayeredBeneficiaries(args: {
  primary_node: SystemNode;
  article_tickers?: string[];
  per_layer_limit?: number;
  // Article headline at T0 — used to fill TransmissionCascade.T0.
  article_headline?: string;
}): LayeredBeneficiaries {
  const { primary_node, article_tickers = [], per_layer_limit = 8, article_headline } = args;
  const rule = NODE_RULES[primary_node] ?? NODE_RULES.NONE;
  const articleSet = new Set(article_tickers.map((t) => t.toUpperCase()));

  // Build per-layer ticker list with priority: mandatory > article > seed remainder
  const layers: Record<BeneficiaryLayer, LayerTicker[]> = { L1: [], L2: [], L3: [], L4: [], L5: [], L6: [] };

  for (const layer of rule.fires) {
    const seen = new Set<string>();
    const out: LayerTicker[] = [];

    // 1. Mandatory injects
    const mand = rule.mandatory[layer] ?? [];
    for (const tk of mand) {
      const T = tk.toUpperCase();
      if (seen.has(T)) continue;
      const meta = ROSTER_BY_TICKER.get(T);
      if (meta) {
        out.push({ ...meta, mandatory: true });
        seen.add(T);
      } else {
        // Allow injection of names not in the roster (e.g. region-specific) —
        // populate with a sensible default.
        out.push({
          ticker: T,
          layer,
          rationale: `Mandatory ${LAYER_META[layer].label} member for ${nodeLabel(primary_node)}`,
          pricing_leverage: 'MEDIUM',
          size: 'LARGE_CAP',
          mandatory: true,
        });
        seen.add(T);
      }
    }

    // 2. Article tickers that map into this layer's roster
    for (const meta of ROSTER_BY_LAYER[layer]) {
      const T = meta.ticker.toUpperCase();
      if (seen.has(T)) continue;
      if (articleSet.has(T)) {
        out.push({ ...meta });
        seen.add(T);
      }
    }

    // 3. Top seed remainder by pricing leverage to fill out the layer
    const leverageRank: Record<PricingLeverage, number> = { STRONG: 3, MEDIUM: 2, WEAK: 1 };
    const remainder = ROSTER_BY_LAYER[layer]
      .filter((m) => !seen.has(m.ticker.toUpperCase()))
      .sort((a, b) => leverageRank[b.pricing_leverage] - leverageRank[a.pricing_leverage]);
    for (const meta of remainder) {
      if (out.length >= per_layer_limit) break;
      out.push({ ...meta });
      seen.add(meta.ticker.toUpperCase());
    }

    layers[layer] = out.slice(0, per_layer_limit);
  }

  // Cascade
  const cascade = CASCADE_BY_NODE[primary_node] ?? DEFAULT_CASCADE;
  const t0 = article_headline
    ? `${nodeLabel(primary_node)} signal: "${article_headline.slice(0, 120)}"`
    : `${nodeLabel(primary_node)} constraint surfaced`;

  return {
    bottleneck: primary_node,
    bottleneck_label: nodeLabel(primary_node),
    layers,
    fired_layers: rule.fires,
    transmission: { T0: t0, ...cascade },
  };
}

// Convenience: terse one-line summary for the collapsed strip.
export function summariseLayers(lb: LayeredBeneficiaries): string {
  return lb.fired_layers
    .map((L) => {
      const tickers = lb.layers[L].slice(0, 3).map((t) => t.ticker).join(' · ');
      return `${LAYER_META[L].icon}${L}: ${tickers}`;
    })
    .join('  ');
}
