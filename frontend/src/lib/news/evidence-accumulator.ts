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

const TTL_SECONDS = 30 * 24 * 60 * 60;   // 30-day rolling window
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

// Apply 14-day exponential decay to existing cumulative score.
function decay(prev: number, lastSeenIso: string): number {
  if (!lastSeenIso) return prev;
  const ageDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86400000;
  return prev * Math.pow(0.5, ageDays / 14);
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
    // Decay existing score
    const decayed = decay(existing.cumulative_score, existing.last_seen);
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
    await kvSet(key, updated, TTL_SECONDS);
  } catch {
    // Non-fatal — accumulation is enrichment.
  }
}

export async function readEvidence(node: SystemNode): Promise<NodeEvidence | null> {
  if (node === 'NONE') return null;
  try {
    const e = (await kvGet<NodeEvidence>(bucketKey(node))) || null;
    if (!e) return null;
    // Apply on-read decay so confidence reflects current time
    const decayed = decay(e.cumulative_score, e.last_seen);
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
