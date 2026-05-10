// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE ACCUMULATOR — patch 0051
//
// KV-backed rolling ledger that accumulates source-weighted confidence per
// SystemNode over time. Themes that get repeated coverage from PRIMARY +
// SPECIALIST sources rise to high confidence; themes that only show up in
// SOCIAL / EDITORIAL stay low.
//
// This is what lets the system reason about UNKNOWN future themes:
//   New token "humanoid robotics supply chain" → maps to MANUFACTURING_CAPACITY
//   → multiple weighted articles accumulate → confidence rises organically
//   → emerges as a constraint without requiring code changes.
//
// Bucket key:   evidence:{node}:v1
// Bucket TTL:   30 days rolling window
// Bucket value: { score, sample_count, last_seen, top_articles[5] }
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type { SystemNode } from '@/lib/news/semantic-graph';
import type { SourceTier } from '@/lib/news/source-tiers';

// PATCH 0079: per-domain TTL + decay rates. Structural bottlenecks
// (HBM, CoWoS, transformers, defence) persist for years — a 30-day TTL
// + 14-day half-life decayed an 8-month-old SemiAnalysis HBM article
// to near-zero, even though the bottleneck is still active.
//
// Categorise SystemNodes by structural persistence:
//   STRUCTURAL — multi-year shifts (semis, energy, defence, nuclear)
//                90-day half-life, 180-day TTL
//   CYCLICAL   — months-to-quarter cycles (logistics, agri, capital)
//                14-day half-life, 30-day TTL  (legacy default)
const STRUCTURAL_NODES: Set<string> = new Set([
  'COMPUTE_INFRA',
  'MEMORY_INFRA',
  'PACKAGING_INFRA',
  'FABRICATION_INFRA',
  'INTERCONNECT_INFRA',
  'COOLING_INFRA',
  'NETWORK_BANDWIDTH',
  'ENERGY_INFRA',
  'NUCLEAR_INFRA',
  'OIL_GAS_INFRA',
  'RENEWABLE_INFRA',
  'DEFENSE_INFRA',
  'AEROSPACE_INFRA',
  'RESOURCE_SCARCITY',
  'MANUFACTURING_CAPACITY',
]);

function ttlSecondsFor(node: SystemNode): number {
  return STRUCTURAL_NODES.has(node)
    ? 180 * 24 * 60 * 60   // 180 days for structural
    : 30 * 24 * 60 * 60;   // 30 days for cyclical
}
function halfLifeDaysFor(node: SystemNode): number {
  return STRUCTURAL_NODES.has(node) ? 90 : 14;
}
// PATCH 0080: bump KV key to v2 — clears old ledger that accumulated
// unfiltered evidence (Ryzen gaming deals tagged MEMORY_INFRA, etc.)
const KEY_PREFIX = 'evidence:v2:';

export interface NodeEvidenceSample {
  article_id: string;
  title: string;
  source: string;
  tier: SourceTier;
  weight: number;
  recorded_at: string;
}

export interface NodeEvidence {
  node: SystemNode;
  cumulative_score: number;        // sum of source-weighted scores (decayed)
  sample_count: number;            // number of articles
  last_seen: string;               // ISO date of latest article
  confidence_pct: number;          // 0-100 derived from cumulative score
  top_samples: NodeEvidenceSample[]; // up to 5 highest-scoring contributors
}

const TIER_WEIGHT: Record<SourceTier, number> = {
  PRIMARY:       3,
  SPECIALIST:    3,
  GENERALIST:    1,
  EDITORIAL:     -2,
  PRESS_RELEASE: -1,
  SOCIAL:        -3,
  UNKNOWN:       0,
};

function bucketKey(node: SystemNode): string {
  return `${KEY_PREFIX}${node}`;
}

// PATCH 0079: per-domain decay. Structural nodes use 90-day half-life so
// HBM / CoWoS / grid / defence signals persist properly. Cyclical use 14-day.
function decay(prev: number, lastSeenIso: string, node: SystemNode): number {
  if (!lastSeenIso) return prev;
  const ageDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86400000;
  return prev * Math.pow(0.5, ageDays / halfLifeDaysFor(node));
}

// Score → confidence_pct mapping (saturating logistic).
function scoreToConfidence(score: number): number {
  // Logistic: confidence = 100 * (1 - exp(-score / 10))
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-score / 10)))));
}

export async function recordEvidence(
  node: SystemNode,
  sample: { article_id: string; title: string; source: string; tier: SourceTier; raw_weight: number },
): Promise<void> {
  if (node === 'NONE') return;
  const key = bucketKey(node);
  try {
    const existing = (await kvGet<NodeEvidence>(key)) || {
      node,
      cumulative_score: 0,
      sample_count: 0,
      last_seen: '',
      confidence_pct: 0,
      top_samples: [],
    };
    // Decay existing score (per-domain half-life)
    const decayed = decay(existing.cumulative_score, existing.last_seen, node);
    const tierW = TIER_WEIGHT[sample.tier] ?? 0;
    // Add new sample (clamp to non-negative)
    const sampleScore = Math.max(0, sample.raw_weight + tierW);
    const newScore = decayed + sampleScore;
    const newSample: NodeEvidenceSample = {
      article_id: sample.article_id,
      title: sample.title,
      source: sample.source,
      tier: sample.tier,
      weight: sampleScore,
      recorded_at: new Date().toISOString(),
    };
    // Keep top 5 samples by weight; drop dups by article_id
    const samples = [newSample, ...existing.top_samples.filter(s => s.article_id !== sample.article_id)]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
    const updated: NodeEvidence = {
      node,
      cumulative_score: Math.round(newScore * 100) / 100,
      sample_count: existing.sample_count + 1,
      last_seen: newSample.recorded_at,
      confidence_pct: scoreToConfidence(newScore),
      top_samples: samples,
    };
    await kvSet(key, updated, ttlSecondsFor(node));
  } catch {
    // Non-fatal — accumulation is enrichment.
  }
}

export async function readEvidence(node: SystemNode): Promise<NodeEvidence | null> {
  if (node === 'NONE') return null;
  try {
    const e = (await kvGet<NodeEvidence>(bucketKey(node))) || null;
    if (!e) return null;
    // Apply on-read decay so confidence reflects current time (per-domain)
    const decayed = decay(e.cumulative_score, e.last_seen, node);
    return {
      ...e,
      cumulative_score: Math.round(decayed * 100) / 100,
      confidence_pct: scoreToConfidence(decayed),
    };
  } catch {
    return null;
  }
}

// Snapshot of all known node confidences — used for the "themes emerging"
// dashboard. Returns sorted by confidence desc.
export async function readAllEvidence(nodes: SystemNode[]): Promise<NodeEvidence[]> {
  const results: NodeEvidence[] = [];
  for (const n of nodes) {
    const e = await readEvidence(n);
    if (e && e.confidence_pct > 0) results.push(e);
  }
  return results.sort((a, b) => b.confidence_pct - a.confidence_pct);
}

// PATCH 0079: Persistent Bottleneck Reading
// Returns the top-K active SystemNodes ranked by decay-adjusted confidence,
// with trend (rising / steady / falling) inferred from cumulative_score
// vs sample_count age distribution. This is the answer to "which
// bottlenecks are STILL ACTIVE even when no fresh news arrived today".

// PATCH 0080: Rich bottleneck labels — what the user actually wants to read
// instead of the generic SystemNode name. "MEMORY_INFRA" → "HBM / DRAM SUPPLY".
const BOTTLENECK_LABEL: Partial<Record<SystemNode, { label: string; sub: string }>> = {
  COMPUTE_INFRA:        { label: 'AI COMPUTE / GPU',          sub: 'NVIDIA / AMD / custom silicon — training capacity' },
  MEMORY_INFRA:         { label: 'HBM / DRAM SUPPLY',         sub: 'SK hynix / Samsung / Micron — HBM3E/HBM4 binding constraint' },
  PACKAGING_INFRA:      { label: 'CoWoS / ADV PACKAGING',     sub: 'TSMC dominant — GPU build packaging-bound' },
  FABRICATION_INFRA:    { label: 'TSMC / FAB CAPACITY',       sub: 'Leading-edge logic — N3/N2 demand outpacing fab supply' },
  INTERCONNECT_INFRA:   { label: 'OPTICAL / 800G+ FABRIC',    sub: 'Coherent / Lumentum / Marvell — AI superpod interconnect' },
  COOLING_INFRA:        { label: 'LIQUID COOLING (AI)',       sub: 'Vertiv / nVent — B100/B200 thermal density' },
  NETWORK_BANDWIDTH:    { label: 'NETWORK / DCI BACKBONE',    sub: 'Hyperscaler east-west AI traffic + sub-sea cable' },
  ENERGY_INFRA:         { label: 'GRID / TRANSFORMERS',       sub: 'Large transformer + switchgear lead times — AI campus power' },
  NUCLEAR_INFRA:        { label: 'NUCLEAR / HALEU / SMR',     sub: 'Centrus HALEU + Naval reactors + SMR fuel cycle' },
  OIL_GAS_INFRA:        { label: 'OIL / GAS / LNG',           sub: 'Crude pricing + LNG offtake + petrochem' },
  RENEWABLE_INFRA:      { label: 'RENEWABLE / BESS / PPA',    sub: 'Solar/wind PPAs + battery storage frameworks' },
  LOGISTICS_INFRA:      { label: 'SHIPPING / LOGISTICS',      sub: 'Container freight + port congestion + last-mile' },
  TRANSPORT_INFRA:      { label: 'RAIL / EV CHARGING',        sub: 'High-speed rail + EV charging buildout' },
  DEFENSE_INFRA:        { label: 'DEFENCE / MISSILES',        sub: 'Production lines + ammunition + RF seekers' },
  AEROSPACE_INFRA:      { label: 'AEROSPACE / LAUNCH',        sub: 'Aero engines + space launch + satellite capacity' },
  RESOURCE_SCARCITY:    { label: 'RARE EARTHS / CRITICAL MIN',sub: 'NdFeB magnets + uranium + lithium — China dependency' },
  AGRI_INFRA:           { label: 'AGRI / FERTILIZER',         sub: 'Food + fertilizer + water + pesticides' },
  MANUFACTURING_CAPACITY:{ label: 'MFG CAPACITY / PLI',       sub: 'Production-linked + reshoring + capex ramp' },
  LABOR_CONSTRAINT:     { label: 'LABOUR / TALENT',           sub: 'Skilled-talent gap + strikes + visa friction' },
  CAPITAL_CONSTRAINT:   { label: 'CAPITAL / CREDIT',          sub: 'Banking / NPA / payment rails / liquidity' },
};

export function bottleneckLabelFor(node: SystemNode): { label: string; sub: string } {
  return BOTTLENECK_LABEL[node] || { label: node.replace(/_/g, ' '), sub: '' };
}

export interface PersistentBottleneck {
  node: SystemNode;
  label: string;                    // PATCH 0080: rich human-readable label
  sub: string;                      // PATCH 0080: 1-line context
  confidence_pct: number;
  cumulative_score: number;
  sample_count: number;
  last_seen: string;
  age_days: number;
  trend: 'rising' | 'steady' | 'falling' | 'cooling';
  is_structural: boolean;
  top_samples: NodeEvidenceSample[];
  best_specialist_sample?: NodeEvidenceSample | null;  // PATCH 0080: highest-tier sample
  // PATCH 0088: "Latest" 10-day surfacing window
  first_seen?: string;              // ISO of earliest top_samples.recorded_at
  first_seen_age_days?: number;     // days since first_seen (proxy via top_samples)
  is_latest?: boolean;              // first_seen_age_days <= 10
}

export async function readPersistentBottlenecks(args: {
  nodes: SystemNode[];
  min_confidence?: number;
  limit?: number;
}): Promise<PersistentBottleneck[]> {
  const { nodes, min_confidence = 25, limit = 10 } = args;
  const out: PersistentBottleneck[] = [];
  const now = Date.now();
  for (const n of nodes) {
    const e = await readEvidence(n);
    if (!e || e.confidence_pct < min_confidence) continue;
    const ageDays = e.last_seen
      ? (now - new Date(e.last_seen).getTime()) / 86400000
      : 999;
    const isStructural = STRUCTURAL_NODES.has(n);
    const halfLife = halfLifeDaysFor(n);
    // Trend heuristic — compares decay-adjusted score against an estimate
    // of what a "steady" stream of articles would maintain.
    // - rising:    recent activity (≤ halfLife/3 days), score above threshold
    // - steady:    activity within 1 half-life
    // - falling:   activity within 2 half-lives but not refreshing
    // - cooling:   beyond 2 half-lives
    let trend: PersistentBottleneck['trend'];
    if (ageDays <= halfLife / 3 && e.confidence_pct >= 60) trend = 'rising';
    else if (ageDays <= halfLife) trend = 'steady';
    else if (ageDays <= halfLife * 2) trend = 'falling';
    else trend = 'cooling';

    // PATCH 0080: pick the highest-quality "latest" sample for display.
    // Rank: PRIMARY/SPECIALIST > GENERALIST > everything else.
    // Tie-break by recency. Falls back to top_samples[0] if nothing matches.
    const tierRank: Record<string, number> = {
      PRIMARY: 5, SPECIALIST: 5, GENERALIST: 3, EDITORIAL: 2,
      PRESS_RELEASE: 1, SOCIAL: 0, UNKNOWN: 1,
    };
    const ranked = [...e.top_samples].sort((a, b) => {
      const r = (tierRank[b.tier] ?? 0) - (tierRank[a.tier] ?? 0);
      if (r !== 0) return r;
      return new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();
    });
    const bestSpecialistSample = ranked.find((s) =>
      s.tier === 'PRIMARY' || s.tier === 'SPECIALIST' || s.tier === 'GENERALIST',
    ) || ranked[0] || null;

    const meta = bottleneckLabelFor(n);

    // PATCH 0088: compute "first seen" proxy from earliest top_samples.recorded_at.
    // Used to flag bottlenecks that surfaced in the last 10 days as "Latest" so
    // the UI can sort them to the top of each region panel.
    const recordedTimes = (e.top_samples || [])
      .map((s) => (s.recorded_at ? new Date(s.recorded_at).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    const firstSeenMs = recordedTimes.length > 0 ? Math.min(...recordedTimes) : NaN;
    const firstSeenIso = Number.isFinite(firstSeenMs) ? new Date(firstSeenMs).toISOString() : undefined;
    const firstSeenAgeDays = Number.isFinite(firstSeenMs)
      ? Math.round((now - firstSeenMs) / 86400000)
      : undefined;
    const isLatest = firstSeenAgeDays !== undefined && firstSeenAgeDays <= 10;

    out.push({
      node: n,
      label: meta.label,
      sub: meta.sub,
      confidence_pct: e.confidence_pct,
      cumulative_score: e.cumulative_score,
      sample_count: e.sample_count,
      last_seen: e.last_seen,
      age_days: Math.round(ageDays),
      trend,
      is_structural: isStructural,
      top_samples: e.top_samples,
      best_specialist_sample: bestSpecialistSample,
      first_seen: firstSeenIso,
      first_seen_age_days: firstSeenAgeDays,
      is_latest: isLatest,
    });
  }
  // Rank: structural nodes get a +5 score boost so HBM / CoWoS / grid surface
  // even when cyclical signals score slightly higher in the moment.
  out.sort((a, b) => {
    const aS = a.confidence_pct + (a.is_structural ? 5 : 0);
    const bS = b.confidence_pct + (b.is_structural ? 5 : 0);
    return bS - aS;
  });
  return out.slice(0, limit);
}
