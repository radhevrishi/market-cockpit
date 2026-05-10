// ═══════════════════════════════════════════════════════════════════════════
// BENEFICIARY GRAPH ENGINE v2 — patch 0081 + 0082
//
// PURPOSE
//   The bottleneck layer answers "what's structurally constrained?"
//   This module answers "who wins / loses / captures economics from each
//   constraint — including the second-order winners and structural losers
//   that don't show up in supplier lists?"
//
// LAYERS (patch 0082)
//   1. constraint (SystemNode)
//      → architectural adaptation (causal pattern, e.g. ALT_ACCELERATOR)
//        → beneficiary tickers — each with:
//             EXPOSURE_INTENSITY  (DIRECT / STRONG / MEDIUM / INDIRECT / STRATEGIC)
//             ECONOMIC_CAPTURE    (MASSIVE / HIGH / MODERATE / MARGINAL / STRATEGIC_ONLY)
//             SIZE_CLASS          (LARGE_CAP / MID_CAP / SMALL_CAP)
//             rationale
//      → DURATION (MULTI_YEAR_STRUCTURAL / SECULAR / CYCLICAL / POLICY / TRADING)
//      → STRUCTURAL_LOSERS — companies that LOSE share/margin from this constraint
//
// CAUSAL RELEVANCE FILTER (patch 0082)
//   To prevent ontology contamination ("Dua Lipa sues Samsung" being counted
//   under HBM bottleneck), recordBeneficiary requires:
//     1. Article matches adaptation keyword pattern
//     2. Article's primary_node is in the adaptation's triggered_by list
//        (semantic domain alignment)
//     3. Article's tickers are mentioned (existing)
//     4. Article passes celebrity / retail noise filters (existing)
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type { SystemNode } from '@/lib/news/semantic-graph';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StructuralAdaptation =
  | 'POWER_EFFICIENCY'
  | 'ALT_ACCELERATOR'
  | 'EDGE_INFERENCE'
  | 'BEHIND_THE_METER'
  | 'SOFTWARE_ORCHESTRATION'
  | 'AI_NETWORKING'
  | 'MEMORY_HIERARCHY'
  | 'LIQUID_COOLING'
  | 'NONE';

export type ExposureIntensity = 'DIRECT' | 'STRONG' | 'MEDIUM' | 'INDIRECT' | 'STRATEGIC';
export type EconomicCapture = 'MASSIVE' | 'HIGH' | 'MODERATE' | 'MARGINAL' | 'STRATEGIC_ONLY';
export type SizeClass = 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP';
export type Duration = 'MULTI_YEAR_STRUCTURAL' | 'SECULAR' | 'CYCLICAL' | 'POLICY_SENSITIVE' | 'TRADING';

const EXPOSURE_SCORE: Record<ExposureIntensity, number> = {
  DIRECT: 95, STRONG: 78, MEDIUM: 55, INDIRECT: 35, STRATEGIC: 20,
};
const CAPTURE_SCORE: Record<EconomicCapture, number> = {
  MASSIVE: 95, HIGH: 75, MODERATE: 50, MARGINAL: 25, STRATEGIC_ONLY: 10,
};

export interface SeedTickerMetadata {
  exposure: ExposureIntensity;
  capture: EconomicCapture;
  size: SizeClass;
  rationale: string;
}

export interface StructuralLoser {
  ticker: string;
  rationale: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AdaptationDefinition {
  adaptation: StructuralAdaptation;
  label: string;
  rationale: string;
  triggered_by: SystemNode[];
  detect: RegExp;
  duration: Duration;
  // Per-ticker metadata for the seed entries — drives exposure_intensity,
  // economic_capture, size_class on the beneficiary cards.
  seed_metadata: Record<string, SeedTickerMetadata>;
  // Companies that LOSE share/margin from this constraint
  structural_losers: StructuralLoser[];
}

export const ADAPTATIONS: AdaptationDefinition[] = [
  {
    adaptation: 'POWER_EFFICIENCY',
    label: 'Power-efficient compute',
    rationale: 'Grid + cooling constraints make perf/watt the binding metric. ARM-based servers, custom CPUs, efficient GPUs win share.',
    triggered_by: ['ENERGY_INFRA', 'COOLING_INFRA', 'COMPUTE_INFRA'],
    detect: /\b(performance per watt|perf\/watt|power efficient|power.?efficient|efficient compute|efficient inference|low.?power|thermal envelope|tdp|edge ai|arm.based|arm.architecture|inference efficiency|energy.?aware (?:schedul|comput)|sustainable compute)\b/i,
    duration: 'SECULAR',
    seed_metadata: {
      ARM:  { exposure: 'DIRECT',    capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'IP royalty on every ARM-based AI/edge core; perf/watt leader' },
      QCOM: { exposure: 'STRONG',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Inference on Snapdragon + custom Oryon ARM cores; data-center push' },
      AMPC: { exposure: 'DIRECT',    capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Pure-play ARM-server vendor (Ampere Altra/AmpereOne)' },
      AAPL: { exposure: 'STRATEGIC', capture: 'STRATEGIC_ONLY', size: 'LARGE_CAP', rationale: 'Apple Silicon validates ARM at scale; not a sell-into-DC story' },
      AMD:  { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'LARGE_CAP', rationale: 'EPYC perf/watt vs Xeon; partial beneficiary alongside ARM' },
      // Small/mid cap additions (patch 0082)
      MPWR: { exposure: 'STRONG',    capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Power management ICs for AI/data-center DC-DC; HBM/GPU power delivery' },
      POWI: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'High-voltage power semis — efficiency at the wall plug' },
      LSCC: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Low-power FPGAs for edge AI / always-on inference' },
      SITM: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Precision MEMS timing — needed for AI cluster sync' },
    },
    structural_losers: [
      { ticker: 'INTC',     severity: 'HIGH',   rationale: 'Legacy x86 share loss to ARM + AMD in DC; perf/watt deficit' },
      { ticker: 'DELL',     severity: 'MEDIUM', rationale: 'Pure-play x86 server stack faces ARM-DC migration over 5y' },
    ],
  },

  {
    adaptation: 'ALT_ACCELERATOR',
    label: 'Alternative AI accelerators',
    rationale: 'HBM / CoWoS / NVIDIA scarcity pushes hyperscalers toward AMD MI300, custom silicon, Trainium, TPU. Diversification accelerates.',
    triggered_by: ['MEMORY_INFRA', 'PACKAGING_INFRA', 'COMPUTE_INFRA', 'FABRICATION_INFRA'],
    detect: /\b(custom (?:silicon|ai chip|accelerator|asic)|in.?house (?:chip|silicon)|alternative (?:gpu|accelerator|silicon)|nvidia (?:diversification|alternative)|hyperscaler (?:custom|diversif)|trainium|inferentia|tpu (?:cluster|deploy|gen)|mi3\d{2}|mi4\d{2}|amd (?:gpu|mi300|epyc)|broadcom (?:custom|asic|jericho)|marvell (?:custom|asic|teralynx)|graphcore|cerebras|sambanova|groq|tenstorrent)\b/i,
    duration: 'MULTI_YEAR_STRUCTURAL',
    seed_metadata: {
      AMD:  { exposure: 'DIRECT', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'MI300/MI325 — only credible 2nd-source for hyperscaler AI training' },
      AVGO: { exposure: 'STRONG', capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Google TPU + Meta MTIA partner — captures custom-silicon AI ASIC margins' },
      MRVL: { exposure: 'STRONG', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'AWS Trainium + custom DPU partner — design-win volume rising' },
      AMZN: { exposure: 'STRATEGIC', capture: 'STRATEGIC_ONLY', size: 'LARGE_CAP', rationale: 'Trainium = AWS-internal; cost-saving but no 3rd-party revenue' },
      GOOG: { exposure: 'STRATEGIC', capture: 'STRATEGIC_ONLY', size: 'LARGE_CAP', rationale: 'TPU = Google-internal capacity; strategic cost lever, not P&L line' },
      META: { exposure: 'STRATEGIC', capture: 'STRATEGIC_ONLY', size: 'LARGE_CAP', rationale: 'MTIA = Meta-internal; strategic only' },
      // Small/mid cap (patch 0082)
      ALAB: { exposure: 'STRONG', capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Astera Labs PCIe/CXL retimers + Aries — every alt-accelerator system' },
      CRDO: { exposure: 'STRONG', capture: 'HIGH',     size: 'SMALL_CAP', rationale: 'Credo SerDes + AECs in custom-silicon hyperscaler designs' },
      AEHR: { exposure: 'MEDIUM', capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Wafer-test for SiC + AI accelerators; volume capacity tied to ramp' },
      CAMT: { exposure: 'MEDIUM', capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Camtek inspection for advanced packaging — volume lever for ALT-ACC' },
    },
    structural_losers: [
      { ticker: 'NVDA',  severity: 'LOW',    rationale: 'NVIDIA absolute winner but share-of-wallet erosion as alt-accelerators ramp' },
      { ticker: 'INTC',  severity: 'MEDIUM', rationale: 'Gaudi adoption lags MI300 — losing the diversification trade' },
    ],
  },

  {
    adaptation: 'EDGE_INFERENCE',
    label: 'Edge inference / AI delivery',
    rationale: 'Centralized inference is expensive — workloads shift to CDN edge, regional compute, caching. Akamai / Cloudflare / Fastly benefit.',
    triggered_by: ['NETWORK_BANDWIDTH', 'COMPUTE_INFRA', 'INTERCONNECT_INFRA'],
    detect: /\b(edge inference|edge ai|edge compute|cdn.{0,20}(?:ai|inference|llm)|distributed inference|inference at edge|latency optim|content delivery network|caching layer|model caching|regional inference|hybrid inference|on.?device inference|federated inference)\b/i,
    duration: 'SECULAR',
    seed_metadata: {
      AKAM: { exposure: 'DIRECT',    capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Akamai pivoting to edge compute + Generalized AI inference layer' },
      NET:  { exposure: 'DIRECT',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Cloudflare Workers AI + edge inference suite leader' },
      FSLY: { exposure: 'DIRECT',    capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Fastly AI delivery + compute@edge — smaller scale, levered to AI shift' },
      EQIX: { exposure: 'MEDIUM',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Edge data-center cabinets — interconnect economics improve with AI' },
      DLR:  { exposure: 'MEDIUM',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Digital Realty hybrid edge — secondary metro footprint matters' },
      // Small/mid cap (patch 0082)
      CCOI: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Cogent enterprise + IP transit — beneficiary of decentralised inference' },
      DBX:  { exposure: 'INDIRECT',  capture: 'MARGINAL', size: 'MID_CAP',   rationale: 'Dropbox AI / file edge — edge-adjacent but secondary capture' },
      VTEX: { exposure: 'INDIRECT',  capture: 'MARGINAL', size: 'SMALL_CAP', rationale: 'VTEX commerce + edge personalisation — applied edge inference' },
      WIX:  { exposure: 'INDIRECT',  capture: 'MARGINAL', size: 'MID_CAP',   rationale: 'Wix AI features delivered at edge — applied tier' },
    },
    structural_losers: [
      { ticker: 'CDW',  severity: 'LOW',    rationale: 'Centralised hardware reseller — value migrates to edge platforms' },
    ],
  },

  {
    adaptation: 'BEHIND_THE_METER',
    label: 'Behind-the-meter power',
    rationale: 'AI campus interconnect queues are years long. Hyperscalers go behind-the-meter — fuel cells, on-site gas, SMRs, microgrids.',
    triggered_by: ['ENERGY_INFRA', 'NUCLEAR_INFRA'],
    detect: /\b(behind.the.meter|btm power|on.?site (?:power|gen|generation)|fuel cell|hydrogen (?:power|fuel cell)|microgrid|self.?generated power|on.?campus (?:nuclear|power|gen)|gas turbine on.?site|distributed generation|co.?located generation|small modular reactor|smr|haleu)\b/i,
    duration: 'POLICY_SENSITIVE',
    seed_metadata: {
      BLDP: { exposure: 'DIRECT',    capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Ballard fuel cells — early commercial + DC backup adoption' },
      BE:   { exposure: 'DIRECT',    capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Bloom Energy SOFC modules — primary power for hyperscaler campuses' },
      PLUG: { exposure: 'STRONG',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Plug Power hydrogen fuel cells — DC + logistics' },
      SMR:  { exposure: 'DIRECT',    capture: 'HIGH',     size: 'SMALL_CAP', rationale: 'NuScale SMR — hyperscaler partnership signal' },
      OKLO: { exposure: 'DIRECT',    capture: 'HIGH',     size: 'SMALL_CAP', rationale: 'Oklo Aurora microreactor — first mover on AI-campus nuclear' },
      CEG:  { exposure: 'STRONG',    capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Constellation Energy — Three Mile Island restart + nuclear PPAs' },
      VST:  { exposure: 'STRONG',    capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Vistra nuclear fleet + dispatchable gas for AI campuses' },
      // Small/mid cap (patch 0082)
      EOSE: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'Eos zinc-bromide BESS — long-duration storage for BTM stacks' },
      FCEL: { exposure: 'MEDIUM',    capture: 'MARGINAL', size: 'SMALL_CAP', rationale: 'FuelCell Energy carbonate cells — niche BTM applications' },
      NNE:  { exposure: 'MEDIUM',    capture: 'STRATEGIC_ONLY', size: 'SMALL_CAP', rationale: 'NANO Nuclear microreactor designs — option-value, pre-commercial' },
      CGRN: { exposure: 'MEDIUM',    capture: 'MARGINAL', size: 'SMALL_CAP', rationale: 'Capstone microturbines — niche BTM commercial deployments' },
    },
    structural_losers: [
      { ticker: 'EXC',  severity: 'MEDIUM', rationale: 'Pure T&D utilities lose if hyperscalers bypass grid via BTM' },
      { ticker: 'AEP',  severity: 'LOW',    rationale: 'Regulated utility — share-of-load erosion if BTM scales materially' },
    ],
  },

  {
    adaptation: 'SOFTWARE_ORCHESTRATION',
    label: 'AI orchestration / observability',
    rationale: 'Compute scarcity → orchestration premium. MLOps, model serving, observability, energy-aware scheduling become alpha.',
    triggered_by: ['COMPUTE_INFRA', 'NETWORK_BANDWIDTH'],
    detect: /\b(mlops|llmops|model serving|model orchestrat|ai (?:orchestrat|platform|pipeline)|inference optim|workflow scheduling|energy.?aware schedul|observability|model monitoring|ai gateway|model routing|agent routing|vllm|tensorrt|sglang|tritonserver)\b/i,
    duration: 'SECULAR',
    seed_metadata: {
      DDOG: { exposure: 'STRONG',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Datadog LLM observability + APM — direct AI infra adoption' },
      SNOW: { exposure: 'STRONG',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Snowflake Cortex — model orchestration + data layer for inference' },
      MDB:  { exposure: 'STRONG',    capture: 'HIGH',     size: 'MID_CAP',   rationale: 'MongoDB Atlas Vector — vector DB for RAG inference' },
      NOW:  { exposure: 'MEDIUM',    capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'ServiceNow agent platform — workflow + AI orchestration enterprise' },
      PLTR: { exposure: 'STRONG',    capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Palantir AIP — ontology + agent orchestration for govt + enterprise' },
      ESTC: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Elastic search + observability + vector — partial AI capture' },
      // Small/mid cap (patch 0082)
      DT:   { exposure: 'STRONG',    capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Dynatrace AI observability — direct LLM + orchestration coverage' },
      FROG: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'JFrog model registry + ML artifact pipeline' },
      GTLB: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'GitLab Duo + ML/LLM workflow CI/CD' },
      CFLT: { exposure: 'MEDIUM',    capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Confluent streaming for real-time inference + agent pipelines' },
    },
    structural_losers: [
      { ticker: 'IBM',  severity: 'LOW',    rationale: 'Legacy ITSM / Watson stack — losing modern MLOps share' },
      { ticker: 'ORCL', severity: 'LOW',    rationale: 'Legacy DB — value shifts to vector + streaming layers (offset by OCI AI win)' },
    ],
  },

  {
    adaptation: 'AI_NETWORKING',
    label: 'AI networking / 800G fabric',
    rationale: 'GPU clusters need 800G+ fabric. Ethernet vs InfiniBand battle. Broadcom Tomahawk, Arista 7800R, Marvell DSP win.',
    triggered_by: ['INTERCONNECT_INFRA', 'NETWORK_BANDWIDTH', 'COMPUTE_INFRA'],
    detect: /\b(ai network|ai fabric|ai interconnect|800g (?:ai|cluster|fabric|switch)|1\.6t (?:ai|optical)|fabric switch|tomahawk|jericho|teralynx|smartnic|dpu|infiniband|nvlink|ethernet (?:fabric|cluster)|ucie|chiplet interconnect|silicon photonics)\b/i,
    duration: 'MULTI_YEAR_STRUCTURAL',
    seed_metadata: {
      AVGO: { exposure: 'DIRECT', capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Tomahawk 5/6 + Jericho — dominant AI ethernet fabric' },
      MRVL: { exposure: 'DIRECT', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Teralynx + Innovium + custom DPU — second-source AI fabric' },
      ANET: { exposure: 'DIRECT', capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Arista 7800R3 — pure-play AI ethernet switch leader' },
      COHR: { exposure: 'STRONG', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Coherent 800G/1.6T optical pluggables — AI fabric volume' },
      LITE: { exposure: 'STRONG', capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Lumentum lasers + DSP — 800G+ optical reach' },
      CIEN: { exposure: 'MEDIUM', capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Ciena DCI — secondary beneficiary as AI traffic grows' },
      // Small/mid cap (patch 0082)
      ALAB: { exposure: 'DIRECT', capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Astera PCIe/CXL retimers + Aries connectivity for AI clusters' },
      CRDO: { exposure: 'DIRECT', capture: 'HIGH',     size: 'SMALL_CAP', rationale: 'Credo SerDes + AECs — every 800G AI rack' },
      CALX: { exposure: 'INDIRECT', capture: 'MARGINAL', size: 'SMALL_CAP', rationale: 'Calix telco fabric — adjacency to AI carrier networks' },
      EXTR: { exposure: 'INDIRECT', capture: 'MARGINAL', size: 'SMALL_CAP', rationale: 'Extreme Networks enterprise switching — peripheral AI exposure' },
    },
    structural_losers: [
      { ticker: 'CSCO', severity: 'MEDIUM', rationale: 'Legacy enterprise switching — share loss to Arista in AI clusters (Splunk offsets partially)' },
      { ticker: 'JNPR', severity: 'MEDIUM', rationale: 'Juniper traditional carrier networking — limited AI-fabric exposure' },
    ],
  },

  {
    adaptation: 'MEMORY_HIERARCHY',
    label: 'Memory hierarchy / CXL / chiplets',
    rationale: 'HBM tightness drives memory-tier innovation — CXL pooling, computational storage, chiplet memory, 3D stacking.',
    triggered_by: ['MEMORY_INFRA', 'COMPUTE_INFRA'],
    detect: /\b(memory hierarchy|cxl (?:memory|pool|tier)|computational storage|chiplet memory|3d (?:stacking|memory)|hbm hierarchy|stacked dram|near.?memory compute|processing.in.memory|pim|memory pooling)\b/i,
    duration: 'MULTI_YEAR_STRUCTURAL',
    seed_metadata: {
      MU:   { exposure: 'DIRECT', capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Micron HBM3E + LPDDR5X for AI — direct margin expansion' },
      AVGO: { exposure: 'STRONG', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Broadcom CXL switching + memory connectivity ASICs' },
      MRVL: { exposure: 'STRONG', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Marvell CXL + custom memory controllers' },
      KLAC: { exposure: 'MEDIUM', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'KLA inspection — every HBM stack and chiplet substrate' },
      AMAT: { exposure: 'MEDIUM', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'Applied Materials hybrid bonding + 3D-stack process' },
      // Small/mid cap (patch 0082)
      ONTO: { exposure: 'STRONG', capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Onto Innovation HBM + advanced packaging metrology' },
      CAMT: { exposure: 'STRONG', capture: 'HIGH',     size: 'SMALL_CAP', rationale: 'Camtek inspection — bottleneck inspection for HBM/chiplet build' },
      ACMR: { exposure: 'MEDIUM', capture: 'MODERATE', size: 'SMALL_CAP', rationale: 'ACM Research wet processing — chiplet/3D-stack adoption' },
      ALAB: { exposure: 'STRONG', capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Astera CXL fabric + memory pooling — direct stack play' },
    },
    structural_losers: [
      { ticker: 'STX',  severity: 'LOW',    rationale: 'Spinning disk — share migration to NAND + memory-tier pooling' },
      { ticker: 'WDC',  severity: 'LOW',    rationale: 'HDD-heavy mix — partial loser to memory hierarchy shift' },
    ],
  },

  {
    adaptation: 'LIQUID_COOLING',
    label: 'Liquid cooling specialists',
    rationale: 'B100/B200/GB200 thermal density requires liquid cooling. Vertiv / nVent / Boyd / Asetek capture spec lock-in.',
    triggered_by: ['COOLING_INFRA', 'COMPUTE_INFRA'],
    detect: /\b(liquid cool|immersion cool|direct.?chip cool|cdu (?:cooling|order|capacity)|coolant distribution|two.?phase cooling|rear.?door (?:cooler|heat)|cold plate|in.row cooling|in.rack cooling)\b/i,
    duration: 'MULTI_YEAR_STRUCTURAL',
    seed_metadata: {
      VRT:  { exposure: 'DIRECT', capture: 'MASSIVE',  size: 'LARGE_CAP', rationale: 'Vertiv liquid CDU + busway — dominant share in hyperscaler liquid' },
      NVT:  { exposure: 'STRONG', capture: 'HIGH',     size: 'LARGE_CAP', rationale: 'nVent liquid + thermal — Schroff cabinets + cold-plate adoption' },
      BOYD: { exposure: 'DIRECT', capture: 'HIGH',     size: 'SMALL_CAP', rationale: 'Boyd Corp liquid cold plates — embedded in NVIDIA reference designs' },
      ETN:  { exposure: 'MEDIUM', capture: 'MODERATE', size: 'LARGE_CAP', rationale: 'Eaton power chain + thermal adjacency — broader infra play' },
      CARR: { exposure: 'MEDIUM', capture: 'MODERATE', size: 'LARGE_CAP', rationale: 'Carrier HVAC + chillers — DC-cooling secondary' },
      // Small/mid cap (patch 0082)
      FIX:  { exposure: 'STRONG', capture: 'HIGH',     size: 'MID_CAP',   rationale: 'Comfort Systems mechanical EPC — DC liquid retrofit + new build' },
      MOD:  { exposure: 'STRONG', capture: 'MODERATE', size: 'MID_CAP',   rationale: 'Modine data-center cooling — CDU + heat-rejection volume' },
      AAON: { exposure: 'MEDIUM', capture: 'MODERATE', size: 'MID_CAP',   rationale: 'AAON custom HVAC — DC modular cooling adoption' },
      EMR:  { exposure: 'MEDIUM', capture: 'MODERATE', size: 'LARGE_CAP', rationale: 'Emerson process / Liebert thermal — hyperscaler retrofits' },
    },
    structural_losers: [
      { ticker: 'IBM', severity: 'LOW', rationale: 'Air-only legacy DC OEM exposure (small versus AI relevance)' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

export function detectAdaptations(args: { title: string; desc?: string }): StructuralAdaptation[] {
  const text = `${args.title} ${args.desc || ''}`;
  const matched: StructuralAdaptation[] = [];
  for (const a of ADAPTATIONS) {
    if (a.detect.test(text)) matched.push(a.adaptation);
  }
  return matched;
}

export function adaptationsForConstraint(constraint: SystemNode): AdaptationDefinition[] {
  return ADAPTATIONS.filter((a) => a.triggered_by.includes(constraint));
}

// PATCH 0082: causal relevance check.
// Article must have a primary_node aligned with the adaptation's
// triggered_by list — prevents "Dua Lipa sues Samsung" from being counted
// under MEMORY/HBM bottleneck just because it mentions Samsung.
export function isCausallyAlignedAdaptation(
  adaptation: StructuralAdaptation,
  article_primary_node?: SystemNode | string,
): boolean {
  if (!article_primary_node || article_primary_node === 'NONE') return false;
  const def = ADAPTATIONS.find((a) => a.adaptation === adaptation);
  if (!def) return false;
  return def.triggered_by.includes(article_primary_node as SystemNode);
}

// ─── KV ledger ─────────────────────────────────────────────────────────────

const KV_PREFIX = 'beneficiary:adapt:v2:';   // PATCH 0082: bumped to v2
const TTL_SECONDS = 180 * 24 * 60 * 60;

export interface BeneficiaryEntry {
  ticker: string;
  score: number;
  sample_count: number;
  last_seen: string;
  top_sources: string[];
  // PATCH 0082: institutional dimensions
  exposure_intensity?: ExposureIntensity;
  exposure_score?: number;       // 0-100
  economic_capture?: EconomicCapture;
  capture_score?: number;        // 0-100
  size_class?: SizeClass;
  rationale?: string;
  // Combined score for ranking — blends accumulated evidence with intrinsic
  // exposure × capture quality. Lets DIRECT/MASSIVE seeds outrank weakly-
  // accumulated INDIRECT/STRATEGIC tickers.
  composite_score?: number;
}

interface AdaptationBucket {
  adaptation: StructuralAdaptation;
  entries: BeneficiaryEntry[];
  last_updated: string;
}

function bucketKey(adaptation: StructuralAdaptation): string {
  return `${KV_PREFIX}${adaptation}`;
}

function decay(prevScore: number, lastSeenIso: string): number {
  if (!lastSeenIso) return prevScore;
  const ageDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86400000;
  return prevScore * Math.pow(0.5, ageDays / 30);
}

export async function recordBeneficiary(args: {
  adaptation: StructuralAdaptation;
  tickers: string[];
  source: string;
  source_tier: 'PRIMARY' | 'SPECIALIST' | 'GENERALIST' | 'EDITORIAL' | 'PRESS_RELEASE' | 'SOCIAL' | 'UNKNOWN';
  // PATCH 0082: causal relevance gate
  primary_node?: SystemNode | string;
}): Promise<void> {
  const { adaptation, tickers, source, source_tier, primary_node } = args;
  if (adaptation === 'NONE' || tickers.length === 0) return;
  // PATCH 0082: enforce semantic domain alignment — drops contamination
  if (!isCausallyAlignedAdaptation(adaptation, primary_node)) return;

  const tierWeight: Record<string, number> = {
    PRIMARY: 3, SPECIALIST: 3, GENERALIST: 1,
    EDITORIAL: 0.5, PRESS_RELEASE: 0.5, SOCIAL: 0, UNKNOWN: 0.5,
  };
  const w = tierWeight[source_tier] ?? 0.5;
  if (w <= 0) return;

  try {
    const key = bucketKey(adaptation);
    const bucket = (await kvGet<AdaptationBucket>(key)) || {
      adaptation, entries: [], last_updated: '',
    };
    const map = new Map<string, BeneficiaryEntry>();
    for (const e of bucket.entries) {
      map.set(e.ticker.toUpperCase(), { ...e, score: decay(e.score, e.last_seen) });
    }
    const now = new Date().toISOString();
    for (const t of tickers) {
      const T = t.toUpperCase();
      const existing = map.get(T);
      if (existing) {
        existing.score = existing.score + w;
        existing.sample_count += 1;
        existing.last_seen = now;
        existing.top_sources = Array.from(new Set([source, ...existing.top_sources])).slice(0, 5);
      } else {
        map.set(T, {
          ticker: T,
          score: w,
          sample_count: 1,
          last_seen: now,
          top_sources: [source],
        });
      }
    }
    const entries = Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, 25);
    await kvSet(key, { adaptation, entries, last_updated: now }, TTL_SECONDS);
  } catch { /* non-fatal */ }
}

export async function readBeneficiaries(args: {
  adaptation: StructuralAdaptation;
  limit?: number;
}): Promise<BeneficiaryEntry[]> {
  const { adaptation, limit = 8 } = args;
  if (adaptation === 'NONE') return [];
  const def = ADAPTATIONS.find((a) => a.adaptation === adaptation);
  if (!def) return [];

  let bucket: AdaptationBucket | null = null;
  try { bucket = (await kvGet<AdaptationBucket>(bucketKey(adaptation))) || null; }
  catch { bucket = null; }

  // Seed with metadata
  const map = new Map<string, BeneficiaryEntry>();
  for (const [ticker, meta] of Object.entries(def.seed_metadata)) {
    const T = ticker.toUpperCase();
    map.set(T, {
      ticker: T,
      score: 1.0,
      sample_count: 0,
      last_seen: '',
      top_sources: ['(seed)'],
      exposure_intensity: meta.exposure,
      exposure_score: EXPOSURE_SCORE[meta.exposure],
      economic_capture: meta.capture,
      capture_score: CAPTURE_SCORE[meta.capture],
      size_class: meta.size,
      rationale: meta.rationale,
    });
  }
  // Merge accumulated evidence
  if (bucket) {
    for (const e of bucket.entries) {
      const T = e.ticker.toUpperCase();
      const decayed = decay(e.score, e.last_seen);
      const existing = map.get(T);
      if (existing) {
        existing.score = existing.score + decayed;
        existing.sample_count = e.sample_count;
        existing.last_seen = e.last_seen;
        existing.top_sources = e.top_sources;
      } else {
        // New ticker not in seed — populate with default metadata
        map.set(T, {
          ticker: T,
          score: decayed,
          sample_count: e.sample_count,
          last_seen: e.last_seen,
          top_sources: e.top_sources,
          // Unknown intensity — conservative default
          exposure_intensity: 'INDIRECT',
          exposure_score: EXPOSURE_SCORE.INDIRECT,
          economic_capture: 'MARGINAL',
          capture_score: CAPTURE_SCORE.MARGINAL,
          size_class: 'MID_CAP',
          rationale: 'Detected via accumulated co-occurrence',
        });
      }
    }
  }
  // PATCH 0082: composite score = 0.5 × exposure + 0.3 × capture + 0.2 × accumulated
  // Caps accumulated at 50 so a few mentions don't outrank seed quality.
  const out = Array.from(map.values()).map((e) => {
    const accumulatedNorm = Math.min(50, e.score) * 2;  // 0-100
    const composite =
      0.5 * (e.exposure_score ?? 35) +
      0.3 * (e.capture_score ?? 25) +
      0.2 * accumulatedNorm;
    return { ...e, composite_score: Math.round(composite) };
  });
  return out.sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0)).slice(0, limit);
}

export interface ConstraintBeneficiaries {
  constraint: SystemNode;
  adaptations: Array<{
    adaptation: StructuralAdaptation;
    label: string;
    rationale: string;
    duration: Duration;
    beneficiaries: BeneficiaryEntry[];
    structural_losers: StructuralLoser[];
  }>;
}

export async function readConstraintBeneficiaries(args: {
  constraint: SystemNode;
  per_adaptation_limit?: number;
}): Promise<ConstraintBeneficiaries> {
  const { constraint, per_adaptation_limit = 8 } = args;
  const adaptDefs = adaptationsForConstraint(constraint);
  const adaptations = await Promise.all(
    adaptDefs.map(async (a) => ({
      adaptation: a.adaptation,
      label: a.label,
      rationale: a.rationale,
      duration: a.duration,
      beneficiaries: await readBeneficiaries({ adaptation: a.adaptation, limit: per_adaptation_limit }),
      structural_losers: a.structural_losers,
    })),
  );
  return { constraint, adaptations };
}
