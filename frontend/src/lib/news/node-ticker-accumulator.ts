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

// PATCH 0109b: pseudo-ticker blacklist — these are CONCEPT words / units /
// acronyms / regulator names that the news ticker-extraction picks up as
// "tickers" but aren't tradable equities.  Without this filter the L1 chips
// show GW / DRAM / MW / BESS / TSMC / AMCA / EPC / IPO / NTPCm / SKm / DAE
// as if they were stocks.  User: 'symbolic pseudo-tickers look messy'.
const PSEUDO_TICKER_BLACKLIST = new Set([
  // Units
  'GW','MW','KW','GWH','MWH','KWH','TWH','BWH','MM','CM','KM','HZ','MHZ','GHZ','THZ','KV','MV','HV','VAC','HVAC','CFM',
  // Concept / industry acronyms
  'AI','ML','LLM','GPU','CPU','TPU','NPU','HBM','DRAM','NAND','SSD','HDD','CXL','DDR','DDR5','DDR6','NVME','SATA','PCIE','USB',
  'IPO','QIP','M&A','MA','PE','VC','HF','SPV','REIT','ARR','MRR','EBITDA','PAT','EBIT','OPM','ROCE','ROIC','ROE','EPS','NPM','PEG','TAM','SAM','SOM',
  'EV','EVS','HEV','BEV','PHEV','FCEV','ICE','OEM','EMS','ESDM','ATMP','OSAT','SMR','BESS','BWMS','EPC','BOT','BOOT','PPP','PPA','LCOE','GW',
  'AMCA','TEDBF','HALEU','LEU','MOU','NDA','LOI','RFP','RFQ','BOQ','SOR','PMS','AMC','SIP',
  // Regulator / programs
  'SEBI','RBI','TRAI','CCI','PIB','GST','DAE','DRDO','ISRO','NPCIL','NHPC','AERB','CERC','NCLT','IBC','SECI','PLI','FDI','NHAI','DFC','MNRE','MOP','MORTH','MEA','MOD','PSU','PFC','REC','IREDA',
  // Geography
  'IN','US','UK','EU','UAE','USA','CN','JP','KR','TW','GCC','MENA','APAC','EMEA','LATAM',
  // News verbs / common caps
  'CEO','CFO','COO','CTO','CIO','MD','VP','EVP','SVP','BOD','MOA','AOA','KPI',
  'BUY','SELL','HOLD','BULL','BEAR','HIGH','LOW','TOP','UP','DOWN','LIVE','BREAKING','UPDATE','FACT','SPEC','INFER','NEW','OLD',
  'YEAR','YEARS','QTR','QUARTER','MONTH','WEEK','DAY','FY','FYTD','YTD','YOY','QOQ','MOM','HOH','TTM','LTM','CAGR',
  // Currency
  'USD','INR','EUR','GBP','JPY','KRW','RMB','CNY','AED','SAR','SGD','HKD','BTC','ETH','SOL',
  // Months
  'JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC',
  // Common short words mistaken for tickers
  'AND','OR','BUT','THE','FOR','WITH','FROM','ARE','HAS','HAD','OUT','OVER','INTO','MORE','LESS','BIG','SMALL','SAID','SAYS','TBD','NA','TBA',
  // Bracket-y SEC stuff
  'TSMC','SK','SKM','HZL','HBM3','HBM4','HBM3E','GAA','EUV','ASML',
  'NTPC','HAL','BEL','BHEL','BDL',  // these ARE real Indian companies but appear as SUFFIX-LESS strings; we want NTPC.NS / HAL.NS form (the .NS roster entries already cover them)
]);

function isValidTickerCandidate(t: string): boolean {
  if (!t) return false;
  const T = t.toUpperCase().trim();
  if (T.length < 2 || T.length > 12) return false;
  // Indian tickers always have .NS / .BO / .NSE / .BSE suffix → accept
  if (/\.(NS|BO|NSE|BSE)$/i.test(T)) return true;
  // Japanese / Taiwan / HK Bloomberg-style suffixes → accept
  if (/\.(T|TW|HK|TYO|KS|KQ)$/i.test(T)) return true;
  // Multi-segment with dot (e.g. PRY.MI / AI.PA) → accept
  if (/^[A-Z0-9]{1,6}\.[A-Z0-9]{1,4}$/i.test(T)) return true;
  // Pure-caps US/global ticker (3-5 chars only — 1-2 are too noisy, 6+ is rare and usually concept)
  if (T.length >= 3 && T.length <= 5 && /^[A-Z]+$/.test(T)) {
    if (PSEUDO_TICKER_BLACKLIST.has(T)) return false;
    return true;
  }
  return false;
}

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
      // PATCH 0109b: drop pseudo-tickers (GW / DRAM / MW / BESS / etc.)
      if (!isValidTickerCandidate(T)) continue;
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
      // PATCH 0109b: re-filter on read so pseudo-tickers in older KV buckets
      // (written before the write-side filter) don't bleed into the UI.
      .filter((e) => isValidTickerCandidate(e.ticker))
      .filter((e) => e.score >= min_score && e.mention_count >= min_mentions)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// PATCH 0110: contamination scan — count distinct nodes a ticker appears in.
// User: 'if ticker appears in 7+ unrelated nodes → suppress'.  Returns a map
// of ticker → count of distinct buckets containing it (with score >= 2).
const ALL_NODES_FOR_CONTAMINATION: SystemNode[] = [
  'COMPUTE_INFRA','MEMORY_INFRA','PACKAGING_INFRA','FABRICATION_INFRA',
  'INTERCONNECT_INFRA','COOLING_INFRA','NETWORK_BANDWIDTH',
  'ENERGY_INFRA','NUCLEAR_INFRA','OIL_GAS_INFRA','RENEWABLE_INFRA',
  'LOGISTICS_INFRA','TRANSPORT_INFRA','DEFENSE_INFRA','AEROSPACE_INFRA',
  'RESOURCE_SCARCITY','AGRI_INFRA','MANUFACTURING_CAPACITY',
  'LABOR_CONSTRAINT','CAPITAL_CONSTRAINT',
];

export async function buildContaminationMap(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(ALL_NODES_FOR_CONTAMINATION.map(async (n) => {
    try {
      const bucket = await kvGet<NodeBucket>(bucketKey(n));
      if (!bucket) return;
      for (const e of bucket.entries) {
        if (!isValidTickerCandidate(e.ticker)) continue;
        // Only count if score is meaningful (>=2 = ~2 specialist mentions)
        const liveScore = decay(e.score, e.last_seen);
        if (liveScore < 2) continue;
        const T = e.ticker.toUpperCase();
        counts[T] = (counts[T] || 0) + 1;
      }
    } catch { /* skip failed nodes */ }
  }));
  return counts;
}

// Returns a multiplier in [0.4, 1.0] based on contamination count.
// 1-3 nodes: 1.0 (clean)
// 4-5 nodes: 0.85 (mild dilution)
// 6-7 nodes: 0.65 (high dilution)
// 8+ nodes: 0.40 ('everything stock' — heavy penalty)
export function contaminationMultiplier(distinctNodes: number): number {
  if (distinctNodes <= 3) return 1.0;
  if (distinctNodes <= 5) return 0.85;
  if (distinctNodes <= 7) return 0.65;
  return 0.40;
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
