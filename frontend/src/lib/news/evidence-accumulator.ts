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
const KEY_PREFIX = 'evidence:v1:';

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

export interface PersistentBottleneck {
  node: SystemNode;
  confidence_pct: number;
  cumulative_score: number;
  sample_count: number;
  last_seen: string;
  age_days: number;
  trend: 'rising' | 'steady' | 'falling' | 'cooling';
  is_structural: boolean;
  top_samples: NodeEvidenceSample[];
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
    out.push({
      node: n,
      confidence_pct: e.confidence_pct,
      cumulative_score: e.cumulative_score,
      sample_count: e.sample_count,
      last_seen: e.last_seen,
      age_days: Math.round(ageDays),
      trend,
      is_structural: isStructural,
      top_samples: e.top_samples,
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
