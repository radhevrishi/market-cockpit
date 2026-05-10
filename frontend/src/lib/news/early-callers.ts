// ═══════════════════════════════════════════════════════════════════════════
// EARLY CALLERS — patch 0077
//
// PURPOSE
//   Some sources are domain-specialist experts who consistently call
//   bottlenecks BEFORE Tier-1 media catches up. SemiAnalysis (Dylan Patel)
//   called HBM3E/CoWoS shortage 6+ months before WSJ/Reuters.
//   TrendForce broke memory pricing first. Power Engineering called gas
//   turbine + transformer tightness early.
//
//   Our default SignalQualityTier classifier downgraded these to
//   C_INDUSTRY or D_SPECULATIVE because they aren't Tier-1 media. Result:
//   we missed the AI compute bottleneck signal until late.
//
//   This module marks domain-specialist early-callers and the SystemNode
//   areas where they have track records. classifySignalQuality (in
//   strategic-visibility.ts) checks this registry FIRST and promotes the
//   article to A_FILING-equivalent confidence when there's a domain match.
//
// HOW TO ADD A SOURCE
//   1. Verify track record — provide an example of a call they made
//      ≥30 days before Tier-1 confirmed it.
//   2. Map to SystemNode domains where they have expertise.
//   3. Set vindication_score 60-95 based on consistency.
// ═══════════════════════════════════════════════════════════════════════════

import type { SystemNode } from '@/lib/news/semantic-graph';

export interface EarlyCallerSource {
  pattern: RegExp;             // matched against feed.name (case-insensitive)
  domains: SystemNode[];       // SystemNodes where this source has track record
  vindication_score: number;   // 0-100, higher = more reliable early-caller
  rationale: string;
}

// Curated registry of domain-specialist early-callers
export const EARLY_CALLERS: EarlyCallerSource[] = [
  // ── AI compute / semis ───────────────────────────────────────────────
  {
    pattern: /^semianalysis\b/i,
    domains: ['COMPUTE_INFRA', 'MEMORY_INFRA', 'PACKAGING_INFRA', 'FABRICATION_INFRA', 'INTERCONNECT_INFRA'],
    vindication_score: 95,
    rationale: 'Called HBM3E + CoWoS shortage 6+ months before consensus media. Specialist on AI compute supply chain.',
  },
  {
    pattern: /^digitimes\b/i,
    domains: ['PACKAGING_INFRA', 'FABRICATION_INFRA', 'COMPUTE_INFRA', 'MEMORY_INFRA'],
    vindication_score: 90,
    rationale: 'Taiwan-side TSMC + ASE + UMC capacity reporting. First to know on packaging/fab capacity moves.',
  },
  {
    pattern: /^trendforce\b/i,
    domains: ['MEMORY_INFRA', 'COMPUTE_INFRA', 'PACKAGING_INFRA'],
    vindication_score: 88,
    rationale: 'DRAM/NAND/HBM pricing data — typically 4-6 weeks ahead of Tier-1 reporting.',
  },
  {
    pattern: /^semiwiki\b/i,
    domains: ['FABRICATION_INFRA', 'PACKAGING_INFRA', 'COMPUTE_INFRA'],
    vindication_score: 78,
    rationale: 'Specialist semi-industry coverage of fab tools, EDA, IP cores.',
  },
  {
    pattern: /^servethehome\b|^the next ?platform\b|^nextplatform\b/i,
    domains: ['COMPUTE_INFRA', 'INTERCONNECT_INFRA', 'COOLING_INFRA'],
    vindication_score: 76,
    rationale: 'Hyperscale + AI infra hardware coverage — hands-on benchmark + reference designs.',
  },
  {
    pattern: /^datacenter dynamics\b|^data ?center dynamics\b/i,
    domains: ['COMPUTE_INFRA', 'ENERGY_INFRA', 'COOLING_INFRA'],
    vindication_score: 80,
    rationale: 'AI campus power + interconnect + cooling — first to break hyperscaler lease announcements.',
  },
  {
    pattern: /^tom'?s hardware\b/i,
    domains: ['COMPUTE_INFRA', 'MEMORY_INFRA'],
    vindication_score: 65,
    rationale: 'Consumer-grade but breaks supply-chain stories (e.g. SK hynix EUV order).',
  },

  // ── Energy / power ──────────────────────────────────────────────────
  {
    pattern: /^power engineering\b|^power-eng\b/i,
    domains: ['ENERGY_INFRA', 'NUCLEAR_INFRA', 'RENEWABLE_INFRA'],
    vindication_score: 85,
    rationale: 'Called gas turbine + transformer + interconnect queue tightness early.',
  },
  {
    pattern: /^utility dive\b/i,
    domains: ['ENERGY_INFRA', 'RENEWABLE_INFRA'],
    vindication_score: 78,
    rationale: 'US utility-side coverage — IRP filings, FERC interconnect.',
  },
  {
    pattern: /^world nuclear news\b/i,
    domains: ['NUCLEAR_INFRA', 'RESOURCE_SCARCITY'],
    vindication_score: 88,
    rationale: 'HALEU / SMR / nuclear fuel cycle — first to report on Centrus, BWXT, NPCIL milestones.',
  },
  {
    pattern: /^renewable watch\b|^power line\b/i,
    domains: ['RENEWABLE_INFRA', 'ENERGY_INFRA'],
    vindication_score: 76,
    rationale: 'India renewable + transmission specialist coverage.',
  },
  {
    pattern: /^et energyworld\b|^et energy world\b/i,
    domains: ['ENERGY_INFRA', 'OIL_GAS_INFRA', 'RENEWABLE_INFRA'],
    vindication_score: 75,
    rationale: 'India PSU energy + renewable order coverage.',
  },

  // ── Defence / aerospace ─────────────────────────────────────────────
  {
    pattern: /^defense news\b|^defence news\b|^breaking defense\b/i,
    domains: ['DEFENSE_INFRA', 'AEROSPACE_INFRA'],
    vindication_score: 82,
    rationale: 'US defence appropriation + framework calls — first to read the budget.',
  },
  {
    pattern: /^aviation week\b|^space ?news\b/i,
    domains: ['AEROSPACE_INFRA', 'DEFENSE_INFRA'],
    vindication_score: 78,
    rationale: 'Aerospace specialist — engine, launch, satellite coverage.',
  },
  {
    pattern: /^livefist\b|^idrw\b|^bw defence\b|^raksha anirveda\b|^sp'?s aviation\b/i,
    domains: ['DEFENSE_INFRA', 'AEROSPACE_INFRA'],
    vindication_score: 80,
    rationale: 'India defence specialist — first to cover MoD/IAF/Navy framework orders.',
  },

  // ── Critical materials / commodities ────────────────────────────────
  {
    pattern: /^icis\b/i,
    domains: ['RESOURCE_SCARCITY', 'OIL_GAS_INFRA'],
    vindication_score: 75,
    rationale: 'Chemicals + commodities specialist.',
  },
  {
    pattern: /^s&p commodity insights\b|^platts\b/i,
    domains: ['RESOURCE_SCARCITY', 'OIL_GAS_INFRA'],
    vindication_score: 80,
    rationale: 'Commodity pricing benchmarks — first to mark price moves.',
  },
  {
    pattern: /^oilprice\b|^freightwaves\b/i,
    domains: ['OIL_GAS_INFRA', 'LOGISTICS_INFRA'],
    vindication_score: 70,
    rationale: 'Commodity + freight market coverage.',
  },
  {
    pattern: /^steelmint\b|^coalmint\b/i,
    domains: ['RESOURCE_SCARCITY', 'MANUFACTURING_CAPACITY'],
    vindication_score: 78,
    rationale: 'India steel + coal specialist pricing/order coverage.',
  },

  // ── India infrastructure / industrial ───────────────────────────────
  {
    pattern: /^et infra\b/i,
    domains: ['ENERGY_INFRA', 'TRANSPORT_INFRA', 'MANUFACTURING_CAPACITY'],
    vindication_score: 75,
    rationale: 'India infrastructure order specialist.',
  },
  {
    pattern: /^et telecom\b/i,
    domains: ['NETWORK_BANDWIDTH', 'COMPUTE_INFRA'],
    vindication_score: 72,
    rationale: 'India telecom specialist — semi mfg, 5G rollouts.',
  },
  {
    pattern: /^project today\b|^construction world\b/i,
    domains: ['MANUFACTURING_CAPACITY', 'TRANSPORT_INFRA', 'ENERGY_INFRA'],
    vindication_score: 70,
    rationale: 'India infra project tracker.',
  },
];

// ─── Lookup ────────────────────────────────────────────────────────────────

export interface EarlyCallerMatch {
  is_early_caller: boolean;
  vindication_score: number;
  rationale: string;
  matched_domains: SystemNode[];
}

/**
 * Returns whether the article's source is a known early-caller for the
 * primary domain of the article. This lets us promote specialist
 * coverage above Tier-1 media on domain-relevant signals.
 */
export function classifyEarlyCaller(args: {
  source_name?: string;
  primary_node?: SystemNode | string;
  nodes_hit?: Array<SystemNode | string>;
}): EarlyCallerMatch {
  const { source_name = '', primary_node, nodes_hit = [] } = args;

  const matched: EarlyCallerSource[] = [];
  for (const ec of EARLY_CALLERS) {
    if (ec.pattern.test(source_name)) {
      matched.push(ec);
    }
  }
  if (matched.length === 0) {
    return { is_early_caller: false, vindication_score: 0, rationale: '', matched_domains: [] };
  }

  // Source is recognised. Now check domain overlap.
  const articleDomains = [primary_node, ...nodes_hit].filter((n): n is SystemNode => !!n && n !== 'NONE') as SystemNode[];
  const articleDomainSet = new Set(articleDomains);

  // Pick the highest-vindication early-caller match where at least one
  // domain overlaps the article's nodes.
  let best: EarlyCallerSource | null = null;
  let bestOverlap: SystemNode[] = [];
  for (const ec of matched) {
    const overlap = ec.domains.filter((d) => articleDomainSet.has(d));
    if (overlap.length > 0) {
      if (!best || ec.vindication_score > best.vindication_score) {
        best = ec;
        bestOverlap = overlap;
      }
    }
  }

  // No domain overlap — source is recognized but the article isn't in
  // their domain. Don't promote (e.g. SemiAnalysis writing about politics
  // shouldn't get the institutional bump).
  if (!best) {
    // Source-recognised but off-domain — return half-credit
    const top = matched.reduce((a, b) => (a.vindication_score > b.vindication_score ? a : b));
    return {
      is_early_caller: false,
      vindication_score: Math.round(top.vindication_score * 0.4),
      rationale: `${top.rationale} (off-domain article — no promotion)`,
      matched_domains: [],
    };
  }

  return {
    is_early_caller: true,
    vindication_score: best.vindication_score,
    rationale: best.rationale,
    matched_domains: bestOverlap,
  };
}
