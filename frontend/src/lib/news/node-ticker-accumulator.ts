// ═══════════════════════════════════════════════════════════════════════════
// NODE-TICKER ACCUMULATOR — patch 0104
//
// Records ticker mentions per SystemNode (compute / memory / nuclear / etc.)
// from live news flow, with 30-day exponential decay.  Solves the
// "MTAR not in nuclear" problem WITHOUT hardcoding any roster expansion.
//
// Architecture:
//   - kvGet/kvSet keyed by SystemNode → bucket of accumulated entries
//   - Each entry: ticker + decayed score + mention count + last_seen + sources
//   - Source-tier weighting: PRIMARY/SPECIALIST=3, GENERALIST=1, EDITORIAL/PR=0.5
//   - Recall: when news article fires graph_primary_node, every ticker
//     in the article gets recorded to that node's bucket.
//   - On read: deriveLayeredBeneficiaries merges discovered tickers into L1.
//
// This is the foundation of automated discovery — no manual roster updates.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type { SystemNode } from '@/lib/news/semantic-graph';

const KV_PREFIX = 'beneficiary:node:v1:';
const TTL_SECONDS = 95 * 86400;             // 95 days TTL on the bucket itself
const HALF_LIFE_DAYS = 30;                  // exponential decay half-life

export interface NodeTickerEntry {
  ticker: string;
  score: number;                            // tier-weighted, decayed
  mention_count: number;                    // raw count over the bucket lifetime
  last_seen: string;                        // ISO date of most recent mention
  top_sources: string[];                    // up to 5 most recent sources
  // Patch 0104b: revenue-growth filter (filled lazily by 0101)
  revenue_growth_pct?: number;
  growth_checked_at?: string;
  // Patch 0104b: crowding score (% of total node mentions that are this ticker)
  crowding_score?: number;
}

export interface NodeBucket {
  node: SystemNode;
  entries: NodeTickerEntry[];
  total_mentions: number;
  last_updated: string;
}

function bucketKey(node: SystemNode): string {
  return `${KV_PREFIX}${node}`;
}

function decay(prevScore: number, lastSeenIso: string): number {
  if (!lastSeenIso) return prevScore;
  const ageDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86400000;
  return prevScore * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// Source-tier classifier — same weights as beneficiary-graph
const TIER_WEIGHT: Record<string, number> = {
  PRIMARY: 3, SPECIALIST: 3, GENERALIST: 1,
  EDITORIAL: 0.5, PRESS_RELEASE: 0.5, SOCIAL: 0, UNKNOWN: 0.5,
};

export async function recordNodeTicker(args: {
  node: SystemNode;
  tickers: string[];
  source: string;
  source_tier: 'PRIMARY' | 'SPECIALIST' | 'GENERALIST' | 'EDITORIAL' | 'PRESS_RELEASE' | 'SOCIAL' | 'UNKNOWN';
}): Promise<void> {
  const { node, tickers, source, source_tier } = args;
  if (!node || node === 'NONE' || tickers.length === 0) return;
  const w = TIER_WEIGHT[source_tier] ?? 0.5;
  if (w <= 0) return;

  try {
    const key = bucketKey(node);
    const bucket = (await kvGet<NodeBucket>(key)) || {
      node, entries: [], total_mentions: 0, last_updated: '',
    };

    // Apply decay to existing entries
    const map = new Map<string, NodeTickerEntry>();
    for (const e of bucket.entries) {
      map.set(e.ticker.toUpperCase(), { ...e, score: decay(e.score, e.last_seen) });
    }

    const now = new Date().toISOString();
    let added = 0;
    for (const t of tickers) {
      const T = (t || '').toUpperCase().trim();
      if (!T || T.length < 1 || T.length > 20) continue;
      const existing = map.get(T);
      if (existing) {
        existing.score += w;
        existing.mention_count += 1;
        existing.last_seen = now;
        existing.top_sources = Array.from(new Set([source, ...existing.top_sources])).slice(0, 5);
      } else {
        map.set(T, {
          ticker: T,
          score: w,
          mention_count: 1,
          last_seen: now,
          top_sources: [source],
        });
      }
      added += 1;
    }

    // Recompute crowding score (each entry as % of total)
    const allEntries = Array.from(map.values());
    const totalMentions = allEntries.reduce((s, e) => s + e.mention_count, 0);
    for (const e of allEntries) {
      e.crowding_score = totalMentions > 0
        ? Math.round((e.mention_count / totalMentions) * 100)
        : 0;
    }

    // Keep top 50 by score, drop dust
    const entries = allEntries
      .filter((e) => e.score >= 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    await kvSet(key, {
      node, entries, total_mentions: totalMentions, last_updated: now,
    } satisfies NodeBucket, TTL_SECONDS);
  } catch { /* non-fatal */ }
}

export async function readNodeTickers(args: {
  node: SystemNode;
  limit?: number;
  min_score?: number;
  min_mentions?: number;
}): Promise<NodeTickerEntry[]> {
  const { node, limit = 12, min_score = 1.5, min_mentions = 1 } = args;
  if (!node || node === 'NONE') return [];
  try {
    const bucket = await kvGet<NodeBucket>(bucketKey(node));
    if (!bucket) return [];
    return bucket.entries
      .map((e) => ({ ...e, score: decay(e.score, e.last_seen) }))
      .filter((e) => e.score >= min_score && e.mention_count >= min_mentions)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ─── Tier A/B/C/D classification ────────────────────────────────────────────
// Computed from existing LayerTicker metadata + accumulator score:
//
//   Tier A — Direct Scarcity Capture (highest earnings torque)
//     STRONG pricing leverage AND mandatory injection
//     OR accumulator score > 30 (heavy news + tier-1 source weighting)
//
//   Tier B — Mandatory Enabler (demand pull-through)
//     mandatory injection AND NOT tier A
//     OR (STRONG leverage AND seed roster member)
//
//   Tier C — Architectural Beneficiary (conditional winner)
//     MEDIUM/STRONG leverage AND seed roster member AND NOT B
//
//   Tier D — Narrative Sympathy (weak correlation)
//     Everything else (WEAK leverage, discovered without strong evidence)
// ───────────────────────────────────────────────────────────────────────────

export type ExposureTier = 'A' | 'B' | 'C' | 'D';

export interface TierInputs {
  pricing_leverage?: 'STRONG' | 'MEDIUM' | 'WEAK';
  mandatory?: boolean;
  is_seed?: boolean;
  accumulator_score?: number;
  mention_count?: number;
}

export function classifyTier(args: TierInputs): ExposureTier {
  const { pricing_leverage, mandatory, is_seed, accumulator_score = 0 } = args;

  // Tier A — Direct Scarcity Capture
  if (mandatory && pricing_leverage === 'STRONG') return 'A';
  if (accumulator_score >= 30) return 'A';

  // Tier B — Mandatory Enabler
  if (mandatory) return 'B';
  if (pricing_leverage === 'STRONG' && is_seed) return 'B';

  // Tier C — Architectural Beneficiary
  if (is_seed && (pricing_leverage === 'STRONG' || pricing_leverage === 'MEDIUM')) return 'C';

  // Tier D — Narrative Sympathy
  return 'D';
}

export const TIER_META: Record<ExposureTier, { label: string; tagline: string; color: string }> = {
  A: { label: 'A · Direct Scarcity Capture', tagline: 'Highest earnings torque',     color: '#EF4444' },
  B: { label: 'B · Mandatory Enabler',        tagline: 'Demand pull-through',         color: '#FBBF24' },
  C: { label: 'C · Architectural',            tagline: 'Conditional winner',          color: '#22D3EE' },
  D: { label: 'D · Narrative Sympathy',       tagline: 'Weak correlation, sentiment', color: '#6B7A8D' },
};
