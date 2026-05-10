// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORMATIONAL CONTRACTS LEDGER — patch 0068
//
// 90-day rolling KV-backed ledger of every article that qualified as
// strategic-visibility. Solves the original gap: the live news feed only
// holds 24-72h of articles, but transformational contracts arrive maybe
// once a week. Without persistence, the user sees an empty section most
// days even when 5-10 mega-deals were announced over the last quarter.
//
// Storage layout:
//   transformational:idx:v1            → sorted set of article ids by ts
//   transformational:item:v1:<id>      → JSON of the qualifying article
//
// Window: 90 days (configurable). Items past the window are filtered
// out at read time and pruned opportunistically.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type {
  StrategicVisibilitySignal,
  SignalQualityTier,
  CapacityReserved,
  FundingConfidence,
  ExecutionStatus,
  RevenueProfile,
  ImpliedSecondaryDemand,
} from '@/lib/news/strategic-visibility';
import { strategicRankScore } from '@/lib/news/strategic-visibility';

// PATCH 0070: 24-month rolling capacity. Default read window is 365d (1Y)
// but the ledger can return up to 24M for institutional reference. KV TTL
// keeps items 25 months so reads never hit a missing-item race after the
// window cutoff edge.
const WINDOW_DAYS = 365;             // default read window
const MAX_RETENTION_DAYS = 24 * 30;  // 720 days — KV retention horizon
const TTL_SECONDS = MAX_RETENTION_DAYS * 24 * 60 * 60 + 30 * 24 * 60 * 60;  // 750 days
const INDEX_KEY = 'transformational:idx:v1';
const ITEM_PREFIX = 'transformational:item:v1:';

export interface TransformationalItem {
  // identity
  id: string;
  title: string;
  source_name: string;
  source_url: string;
  published_at: string;       // ISO
  recorded_at: string;        // ISO — when added to ledger
  region: string;
  ticker_symbols: string[];
  primary_ticker: string | null;

  // strategic visibility v1
  strategic_visibility: StrategicVisibilitySignal;

  // strategic visibility v2 (patch 0067)
  sv_signal_quality_tier?: SignalQualityTier | null;
  sv_capacity_reserved?: CapacityReserved | null;
  sv_dependency_score?: number | null;
  sv_dependency_rationale?: string | null;
  sv_why_this_matters?: string | null;
  sv_second_order?: { beneficiaries: string[]; risk: string[] } | null;
  sv_formatted_line?: string | null;

  // PATCH 0072: institutional dimensions
  funding_confidence?: FundingConfidence | null;
  funding_confidence_rationale?: string | null;
  execution_status?: ExecutionStatus | null;
  revenue_profile?: RevenueProfile | null;
  revenue_profile_ebitda_band?: string | null;
  revenue_profile_cash_conversion?: string | null;
  revenue_profile_working_capital?: string | null;
  revenue_profile_rationale?: string | null;
  implied_secondary_demand?: ImpliedSecondaryDemand | null;

  // PATCH 0073: chokepoint index + numeric WC intensity
  chokepoint_category?: string | null;            // ChokepointCategory
  chokepoint_label?: string | null;
  chokepoint_severity?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  chokepoint_competitors?: string | null;
  chokepoint_rationale?: string | null;
  chokepoint_primary_tickers?: string[] | null;
  working_capital_intensity_pct?: number | null;  // 0-100 numeric (sortable/filterable)
}

interface IndexEntry {
  id: string;
  ts: number;          // ms epoch — used for window cutoff + sorting
  rank: number;        // strategicRankScore at write time
}

// ─── WRITE PATH ────────────────────────────────────────────────────────────
// Called inside the news loop whenever an article qualifies as strategic
// visibility. De-duplicates by id (we never overwrite an existing record).

export async function recordTransformational(item: TransformationalItem): Promise<void> {
  const itemKey = `${ITEM_PREFIX}${item.id}`;

  // Skip if already recorded
  const existing = await kvGet<TransformationalItem>(itemKey);
  if (existing) return;

  // Persist the item with TTL > window so reads always find it inside window
  await kvSet(itemKey, item, TTL_SECONDS);

  // Append to index (read-modify-write — the index is a single JSON list,
  // bounded by ~500 items max, so this is cheap)
  const idx = (await kvGet<IndexEntry[]>(INDEX_KEY)) || [];
  if (idx.some((e) => e.id === item.id)) return;
  idx.push({
    id: item.id,
    ts: new Date(item.published_at || item.recorded_at).getTime(),
    rank: strategicRankScore(item.strategic_visibility),
  });

  // PATCH 0070: Prune entries older than MAX_RETENTION (24M) — NOT the
  // default read window. Users can ask for 2Y views and we want those to
  // actually return results from the seed file.
  const cutoff = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pruned = idx.filter((e) => e.ts >= cutoff);

  // Cap at 1000 most-recent — defensive bound
  pruned.sort((a, b) => b.ts - a.ts);
  const capped = pruned.slice(0, 1000);

  await kvSet(INDEX_KEY, capped, TTL_SECONDS);
}

// ─── READ PATH ─────────────────────────────────────────────────────────────
// Returns items in the rolling 90-day window, sorted by strategicRankScore
// (institutional ranking) with recency as the secondary sort.

export interface ReadOptions {
  region?: 'IN' | 'US' | 'GLOBAL' | 'ALL';
  theme?: string;                   // filter by StrategicTheme
  min_rank?: number;                // hide weaker items
  limit?: number;                   // default 100
  sort?: 'rank' | 'recent';         // default 'rank'
  window_days?: number;             // override default 90
}

export async function readTransformational(opts: ReadOptions = {}): Promise<{
  window_days: number;
  total: number;
  items: TransformationalItem[];
}> {
  const window = opts.window_days ?? WINDOW_DAYS;
  const limit = opts.limit ?? 100;
  const cutoff = Date.now() - window * 24 * 60 * 60 * 1000;

  const idx = (await kvGet<IndexEntry[]>(INDEX_KEY)) || [];
  const inWindow = idx.filter((e) => e.ts >= cutoff);

  // Sort by rank desc (default) or recent desc
  const sorted = [...inWindow].sort((a, b) => {
    if (opts.sort === 'recent') return b.ts - a.ts;
    return b.rank - a.rank || b.ts - a.ts;
  });

  // Hydrate items
  const ids = sorted.slice(0, limit).map((e) => e.id);
  const items: TransformationalItem[] = [];
  for (const id of ids) {
    const v = await kvGet<TransformationalItem>(`${ITEM_PREFIX}${id}`);
    if (!v) continue;

    // Apply post-fetch filters
    if (opts.region && opts.region !== 'ALL' && v.region !== opts.region) continue;
    if (opts.theme && v.strategic_visibility?.theme !== opts.theme) continue;
    if (opts.min_rank && strategicRankScore(v.strategic_visibility) < opts.min_rank) continue;

    items.push(v);
  }

  return { window_days: window, total: inWindow.length, items };
}

// ─── SUMMARY STATS for the UI header ──────────────────────────────────────
// Returns counts by theme + by flag for a header-strip render.

export async function transformationalSummary(opts: ReadOptions = {}): Promise<{
  window_days: number;
  total: number;
  total_in_ledger: number;       // PATCH 0070: full retention count
  by_theme: Record<string, number>;
  by_flag: Record<string, number>;
  by_quality_tier: Record<string, number>;
  newest_recorded_at: string | null;
  oldest_in_window_at: string | null;
}> {
  const { window_days, total, items } = await readTransformational({ ...opts, limit: 1000 });
  // Total in ledger (full retention) — independent of read window
  const idx = (await kvGet<IndexEntry[]>(INDEX_KEY)) || [];
  const totalInLedger = idx.length;
  const by_theme: Record<string, number> = {};
  const by_flag: Record<string, number> = {};
  const by_quality_tier: Record<string, number> = {};
  let newest = 0;
  let oldest = Infinity;
  for (const it of items) {
    const theme = it.strategic_visibility?.theme || 'NONE';
    by_theme[theme] = (by_theme[theme] || 0) + 1;
    for (const f of it.strategic_visibility?.flags || []) {
      by_flag[f] = (by_flag[f] || 0) + 1;
    }
    const sq = it.sv_signal_quality_tier || 'UNKNOWN';
    by_quality_tier[sq] = (by_quality_tier[sq] || 0) + 1;
    const ts = new Date(it.published_at).getTime();
    if (ts > newest) newest = ts;
    if (ts < oldest) oldest = ts;
  }
  return {
    window_days,
    total,
    total_in_ledger: totalInLedger,
    by_theme,
    by_flag,
    by_quality_tier,
    newest_recorded_at: newest > 0 ? new Date(newest).toISOString() : null,
    oldest_in_window_at: isFinite(oldest) ? new Date(oldest).toISOString() : null,
  };
}
