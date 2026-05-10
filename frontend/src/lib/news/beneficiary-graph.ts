// ═══════════════════════════════════════════════════════════════════════════
// BENEFICIARY GRAPH ENGINE — patch 0081
//
// PURPOSE
//   The bottleneck layer answers "what's structurally constrained?"
//   This module answers "who wins from each constraint — including the
//   second-order winners that don't show up in supplier lists?"
//
// ARCHITECTURE
//   constraint (SystemNode)
//     → architectural adaptation (causal pattern, e.g. ALT_ACCELERATOR)
//       → beneficiary tickers (accumulated dynamically from articles)
//
// DESIGN PRINCIPLES
//   1. Adaptations are CAUSAL PATTERNS, not company lists. They describe
//      HOW the market routes around the constraint (efficient compute,
//      alternative silicon, edge inference, behind-the-meter power, etc.).
//   2. Detection uses keyword patterns — articles matching them have their
//      tickers tagged under that adaptation.
//   3. Beneficiary tickers accumulate dynamically in KV. New companies
//      enter the graph organically as they get coverage.
//   4. A small seed (~5-10 tickers per adaptation) provides cold-start so
//      the graph isn't empty on day one. Seed entries decay if not refreshed.
//
// READ FLOW
//   "HBM is binding" → list of adaptations triggered (ALT_ACCELERATOR,
//   MEMORY_HIERARCHY) → top-5 tickers per adaptation from accumulated
//   evidence → AMD, AVGO, MRVL, AAPL, ARM appear as second-order beneficiaries.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type { SystemNode } from '@/lib/news/semantic-graph';

// ─── Adaptation taxonomy ───────────────────────────────────────────────────

export type StructuralAdaptation =
  | 'POWER_EFFICIENCY'         // performance/watt wins when grid is constrained
  | 'ALT_ACCELERATOR'          // hyperscalers route around NVIDIA/HBM/CoWoS
  | 'EDGE_INFERENCE'           // inference shifts to CDN/edge to dodge centralized compute cost
  | 'BEHIND_THE_METER'         // skip the grid via on-site power
  | 'SOFTWARE_ORCHESTRATION'   // orchestration / inference optimization layer
  | 'AI_NETWORKING'            // 800G+ fabric / DPU / smartNIC
  | 'MEMORY_HIERARCHY'         // CXL / chiplets / 3D stacking dodge HBM tightness
  | 'LIQUID_COOLING'           // cooling is the new constraint
  | 'NONE';

export interface AdaptationDefinition {
  adaptation: StructuralAdaptation;
  label: string;
  rationale: string;
  // SystemNode constraints that trigger this adaptation
  triggered_by: SystemNode[];
  // Detection — title+desc must match for an article to count toward this adaptation
  detect: RegExp;
  // Cold-start seed — canonical beneficiary tickers (small, decay if not refreshed)
  seed_tickers: string[];
}

export const ADAPTATIONS: AdaptationDefinition[] = [
  {
    adaptation: 'POWER_EFFICIENCY',
    label: 'Power-efficient compute',
    rationale: 'Grid + cooling constraints make performance/watt the binding metric. ARM-based servers, custom CPUs, and efficient GPUs win share.',
    triggered_by: ['ENERGY_INFRA', 'COOLING_INFRA', 'COMPUTE_INFRA'],
    detect: /\b(performance per watt|perf\/watt|power efficient|power.?efficient|efficient compute|efficient inference|low.?power|thermal envelope|tdp|edge ai|arm.based|arm.architecture|inference efficiency|energy.?aware (?:schedul|comput)|sustainable compute)\b/i,
    seed_tickers: ['ARM', 'QCOM', 'AMPC', 'AAPL', 'AMD'],
  },
  {
    adaptation: 'ALT_ACCELERATOR',
    label: 'Alternative AI accelerators',
    rationale: 'HBM / CoWoS / NVIDIA scarcity pushes hyperscalers toward AMD MI300, custom silicon, Trainium, TPU. Diversification accelerates.',
    triggered_by: ['MEMORY_INFRA', 'PACKAGING_INFRA', 'COMPUTE_INFRA', 'FABRICATION_INFRA'],
    detect: /\b(custom (?:silicon|ai chip|accelerator|asic)|in.?house (?:chip|silicon)|alternative (?:gpu|accelerator|silicon)|nvidia (?:diversification|alternative)|hyperscaler (?:custom|diversif)|trainium|inferentia|tpu (?:cluster|deploy|gen)|mi3\d{2}|mi4\d{2}|amd (?:gpu|mi300|epyc)|broadcom (?:custom|asic|jericho)|marvell (?:custom|asic|teralynx)|graphcore|cerebras|sambanova|groq|tenstorrent)\b/i,
    seed_tickers: ['AMD', 'AVGO', 'MRVL', 'AMZN', 'GOOG', 'META'],
  },
  {
    adaptation: 'EDGE_INFERENCE',
    label: 'Edge inference / AI delivery',
    rationale: 'Centralized inference is expensive — workloads shift to CDN edge, regional compute, caching. Akamai / Cloudflare / Fastly benefit.',
    triggered_by: ['NETWORK_BANDWIDTH', 'COMPUTE_INFRA', 'INTERCONNECT_INFRA'],
    detect: /\b(edge inference|edge ai|edge compute|cdn.{0,20}(?:ai|inference|llm)|distributed inference|inference at edge|latency optim|content delivery network|caching layer|model caching|regional inference|hybrid inference|on.?device inference|federated inference)\b/i,
    seed_tickers: ['AKAM', 'NET', 'FSLY', 'CDNS', 'EQIX', 'DLR'],
  },
  {
    adaptation: 'BEHIND_THE_METER',
    label: 'Behind-the-meter power',
    rationale: 'AI campus interconnect queues are years long. Hyperscalers go behind-the-meter — fuel cells, on-site gas, SMRs, microgrids.',
    triggered_by: ['ENERGY_INFRA', 'NUCLEAR_INFRA'],
    detect: /\b(behind.the.meter|btm power|on.?site (?:power|gen|generation)|fuel cell|hydrogen (?:power|fuel cell)|microgrid|self.?generated power|on.?campus (?:nuclear|power|gen)|gas turbine on.?site|distributed generation|co.?located generation|small modular reactor|smr|haleu)\b/i,
    seed_tickers: ['BLDP', 'BE', 'PLUG', 'SMR', 'OKLO', 'CEG', 'VST'],
  },
  {
    adaptation: 'SOFTWARE_ORCHESTRATION',
    label: 'AI orchestration / observability',
    rationale: 'Compute scarcity → orchestration premium. MLOps, model serving, observability, energy-aware scheduling become alpha.',
    triggered_by: ['COMPUTE_INFRA', 'NETWORK_BANDWIDTH'],
    detect: /\b(mlops|llmops|model serving|model orchestrat|ai (?:orchestrat|platform|pipeline)|inference optim|workflow scheduling|energy.?aware schedul|observability|model monitoring|ai gateway|model routing|agent routing|vllm|tensorrt|sglang|tritonserver)\b/i,
    seed_tickers: ['DDOG', 'SNOW', 'MDB', 'NOW', 'PLTR', 'ESTC'],
  },
  {
    adaptation: 'AI_NETWORKING',
    label: 'AI networking / 800G fabric',
    rationale: 'GPU clusters need 800G+ fabric. Ethernet vs InfiniBand battle. Broadcom Tomahawk, Arista 7800R, Marvell DSP win.',
    triggered_by: ['INTERCONNECT_INFRA', 'NETWORK_BANDWIDTH', 'COMPUTE_INFRA'],
    detect: /\b(ai network|ai fabric|ai interconnect|800g (?:ai|cluster|fabric|switch)|1\.6t (?:ai|optical)|fabric switch|tomahawk|jericho|teralynx|smartnic|dpu|infiniband|nvlink|ethernet (?:fabric|cluster)|ucie|chiplet interconnect|silicon photonics)\b/i,
    seed_tickers: ['AVGO', 'MRVL', 'ANET', 'COHR', 'LITE', 'CIEN'],
  },
  {
    adaptation: 'MEMORY_HIERARCHY',
    label: 'Memory hierarchy / CXL / chiplets',
    rationale: 'HBM tightness drives memory-tier innovation — CXL pooling, computational storage, chiplet memory, 3D stacking.',
    triggered_by: ['MEMORY_INFRA', 'COMPUTE_INFRA'],
    detect: /\b(memory hierarchy|cxl (?:memory|pool|tier)|computational storage|chiplet memory|3d (?:stacking|memory)|hbm hierarchy|stacked dram|near.?memory compute|processing.in.memory|pim|memory pooling)\b/i,
    seed_tickers: ['MU', 'AVGO', 'MRVL', 'KLAC', 'AMAT'],
  },
  {
    adaptation: 'LIQUID_COOLING',
    label: 'Liquid cooling specialists',
    rationale: 'B100/B200/GB200 thermal density requires liquid cooling. Vertiv / nVent / Boyd / Asetek capture spec lock-in.',
    triggered_by: ['COOLING_INFRA', 'COMPUTE_INFRA'],
    detect: /\b(liquid cool|immersion cool|direct.?chip cool|cdu (?:cooling|order|capacity)|coolant distribution|two.?phase cooling|rear.?door (?:cooler|heat)|cold plate|in.row cooling|in.rack cooling)\b/i,
    seed_tickers: ['VRT', 'NVT', 'BOYD', 'ETN', 'CARR'],
  },
];

// ─── Detection ─────────────────────────────────────────────────────────────

export function detectAdaptations(args: {
  title: string;
  desc?: string;
}): StructuralAdaptation[] {
  const text = `${args.title} ${args.desc || ''}`;
  const matched: StructuralAdaptation[] = [];
  for (const a of ADAPTATIONS) {
    if (a.detect.test(text)) matched.push(a.adaptation);
  }
  return matched;
}

// Map a constraint (SystemNode) → adaptations it triggers
export function adaptationsForConstraint(constraint: SystemNode): AdaptationDefinition[] {
  return ADAPTATIONS.filter((a) => a.triggered_by.includes(constraint));
}

// ─── Beneficiary ledger (KV-backed accumulation) ───────────────────────────

const KV_PREFIX = 'beneficiary:adapt:v1:';
const TTL_SECONDS = 180 * 24 * 60 * 60;   // 180 days

export interface BeneficiaryEntry {
  ticker: string;
  score: number;
  sample_count: number;
  last_seen: string;
  // Top sources that contributed
  top_sources: string[];
}

export interface AdaptationBucket {
  adaptation: StructuralAdaptation;
  entries: BeneficiaryEntry[];   // top by score
  last_updated: string;
}

function bucketKey(adaptation: StructuralAdaptation): string {
  return `${KV_PREFIX}${adaptation}`;
}

// 30-day half-life decay so older co-occurrences fade
function decay(prevScore: number, lastSeenIso: string): number {
  if (!lastSeenIso) return prevScore;
  const ageDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86400000;
  return prevScore * Math.pow(0.5, ageDays / 30);
}

/**
 * Record a co-occurrence: an article matching `adaptation` mentioned `tickers`.
 * Source tier weights how much the score increments.
 */
export async function recordBeneficiary(args: {
  adaptation: StructuralAdaptation;
  tickers: string[];
  source: string;
  source_tier: 'PRIMARY' | 'SPECIALIST' | 'GENERALIST' | 'EDITORIAL' | 'PRESS_RELEASE' | 'SOCIAL' | 'UNKNOWN';
}): Promise<void> {
  const { adaptation, tickers, source, source_tier } = args;
  if (adaptation === 'NONE' || tickers.length === 0) return;

  const tierWeight: Record<string, number> = {
    PRIMARY: 3, SPECIALIST: 3, GENERALIST: 1,
    EDITORIAL: 0.5, PRESS_RELEASE: 0.5, SOCIAL: 0, UNKNOWN: 0.5,
  };
  const w = tierWeight[source_tier] ?? 0.5;
  if (w <= 0) return;

  try {
    const key = bucketKey(adaptation);
    const bucket = (await kvGet<AdaptationBucket>(key)) || {
      adaptation,
      entries: [],
      last_updated: '',
    };

    const map = new Map<string, BeneficiaryEntry>();
    for (const e of bucket.entries) {
      map.set(e.ticker.toUpperCase(), {
        ...e,
        score: decay(e.score, e.last_seen),
      });
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
    const entries = Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
    await kvSet(key, { adaptation, entries, last_updated: now }, TTL_SECONDS);
  } catch {
    // Best-effort
  }
}

/**
 * Read the top beneficiaries for a given adaptation. Includes seed entries
 * (with low base score) so the graph isn't empty on cold start.
 */
export async function readBeneficiaries(args: {
  adaptation: StructuralAdaptation;
  limit?: number;
}): Promise<BeneficiaryEntry[]> {
  const { adaptation, limit = 5 } = args;
  if (adaptation === 'NONE') return [];

  const def = ADAPTATIONS.find((a) => a.adaptation === adaptation);
  if (!def) return [];

  let bucket: AdaptationBucket | null = null;
  try {
    bucket = (await kvGet<AdaptationBucket>(bucketKey(adaptation))) || null;
  } catch {
    bucket = null;
  }

  // Merge seed with accumulated. Seed each ticker at base 1.0; accumulated
  // dominates as evidence grows.
  const map = new Map<string, BeneficiaryEntry>();
  for (const t of def.seed_tickers) {
    map.set(t.toUpperCase(), {
      ticker: t.toUpperCase(),
      score: 1.0,
      sample_count: 0,
      last_seen: '',
      top_sources: ['(seed)'],
    });
  }
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
        map.set(T, {
          ticker: T,
          score: decayed,
          sample_count: e.sample_count,
          last_seen: e.last_seen,
          top_sources: e.top_sources,
        });
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * For a constraint SystemNode, return the adaptations it triggers, each with
 * top-K beneficiary tickers. This is the core read for the bottleneck panel:
 * "HBM tight" → ALT_ACCELERATOR (AMD, AVGO...) + MEMORY_HIERARCHY (MU, ...).
 */
export interface ConstraintBeneficiaries {
  constraint: SystemNode;
  adaptations: Array<{
    adaptation: StructuralAdaptation;
    label: string;
    rationale: string;
    beneficiaries: BeneficiaryEntry[];
  }>;
}

export async function readConstraintBeneficiaries(args: {
  constraint: SystemNode;
  per_adaptation_limit?: number;
}): Promise<ConstraintBeneficiaries> {
  const { constraint, per_adaptation_limit = 5 } = args;
  const adaptDefs = adaptationsForConstraint(constraint);
  const adaptations = await Promise.all(
    adaptDefs.map(async (a) => ({
      adaptation: a.adaptation,
      label: a.label,
      rationale: a.rationale,
      beneficiaries: await readBeneficiaries({ adaptation: a.adaptation, limit: per_adaptation_limit }),
    })),
  );
  return { constraint, adaptations };
}
