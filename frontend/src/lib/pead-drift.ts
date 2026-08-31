// ═══════════════════════════════════════════════════════════════════════════
// PEAD DRIFT TRACKER — pure helpers (no React, no DOM)
//
// Turns the conviction bench into a self-scoring PEAD scoreboard: does our
// PEAD score / tier actually predict post-earnings drift? All math is derived
// ONLY from data that exists on each ConvictionEntry — drift is never
// fabricated. Names without ≥2 close_30d points are excluded from every drift
// aggregate and surfaced separately as "awaiting price history".
// ═══════════════════════════════════════════════════════════════════════════

import type { ConvictionEntry } from './conviction-beats';

export interface DriftRow {
  entry: ConvictionEntry;
  ticker: string;
  company: string;
  tier: ConvictionEntry['tier'];
  peadScore: number | null;      // pead_score if present
  d1: number | null;             // day-1 move %
  daysSince: number;             // whole days since filing
  closes: number[];              // sanitized close_30d
  hasDrift: boolean;             // a drift value is available (closes OR move_pct)
  drift: number | null;          // post-earnings drift %, or null
  driftSource: 'closes' | 'move' | 'none';  // where drift came from
}

/** Whole days between a YYYY-MM-DD filing date and `now` (>=0). */
export function daysSinceFiling(filing_date: string, now: Date = new Date()): number {
  const ms = Date.parse(filing_date + 'T00:00:00+05:30');
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86400000));
}

/** Keep only finite, positive close values (prices) in order. */
function sanitizeCloses(raw: number[] | null | undefined): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
}

/** Build a DriftRow from one conviction entry. */
export function toDriftRow(entry: ConvictionEntry, now: Date = new Date()): DriftRow {
  const closes = sanitizeCloses(entry.close_30d);
  const peadScore =
    typeof entry.pead_score === 'number' && Number.isFinite(entry.pead_score)
      ? entry.pead_score
      : null;
  const d1 =
    typeof entry.d1_pct === 'number' && Number.isFinite(entry.d1_pct) ? entry.d1_pct : null;
  // zzz511 — drift with a graceful fallback. Preferred source is the 30-day
  // close series (true path). When it's absent (most bench entries don't carry
  // close_30d yet), fall back to move_pct — the cumulative move since filing —
  // and isolate the DRIFT after the day-1 reaction by subtracting d1 when we
  // have it. This is a proxy (labelled as such in the UI), so the scoreboard is
  // populated from data we already store instead of sitting empty.
  const move =
    typeof entry.move_pct === 'number' && Number.isFinite(entry.move_pct) ? entry.move_pct : null;
  const closeDrift = closes.length >= 2 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : null;
  const moveDrift = move != null ? (d1 != null ? move - d1 : move) : null;
  const drift = closeDrift != null ? closeDrift : moveDrift;
  const driftSource: 'closes' | 'move' | 'none' =
    closeDrift != null ? 'closes' : moveDrift != null ? 'move' : 'none';
  return {
    entry,
    ticker: entry.ticker,
    company: entry.company,
    tier: entry.tier,
    peadScore,
    d1,
    daysSince: daysSinceFiling(entry.filing_date, now),
    closes,
    hasDrift: drift != null,
    drift,
    driftSource,
  };
}

export type SortKey = 'drift' | 'pead' | 'd1' | 'days';

/** Sort rows descending by a key; rows missing the value sink to the bottom. */
export function sortRows(rows: DriftRow[], key: SortKey): DriftRow[] {
  const val = (r: DriftRow): number | null => {
    switch (key) {
      case 'drift': return r.drift;
      case 'pead': return r.peadScore;
      case 'd1': return r.d1;
      case 'days': return r.daysSince;
    }
  };
  return [...rows].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

export interface Agg {
  n: number;          // names with drift in this cell
  avgDrift: number;   // mean drift %
  hitRate: number;    // % with positive drift (0-100)
}

function aggregate(rows: DriftRow[]): Agg {
  const withDrift = rows.filter((r) => r.hasDrift && r.drift != null);
  const n = withDrift.length;
  if (n === 0) return { n: 0, avgDrift: 0, hitRate: 0 };
  const sum = withDrift.reduce((s, r) => s + (r.drift as number), 0);
  const hits = withDrift.filter((r) => (r.drift as number) > 0).length;
  return { n, avgDrift: sum / n, hitRate: (hits / n) * 100 };
}

export type PeadBucketKey = 'high' | 'mid' | 'low' | 'unscored';

export function peadBucketOf(peadScore: number | null): PeadBucketKey {
  if (peadScore == null) return 'unscored';
  if (peadScore >= 70) return 'high';
  if (peadScore >= 50) return 'mid';
  return 'low';
}

export interface Scoreboard {
  overall: Agg;
  byTier: { BLOCKBUSTER: Agg; STRONG: Agg };
  byBucket: Record<PeadBucketKey, Agg>;
  awaiting: number;   // names with a filing_date but <2 close points
  total: number;      // total rows considered
}

/** Compute the full scoreboard from a set of rows (already window-filtered). */
export function buildScoreboard(rows: DriftRow[]): Scoreboard {
  const withDrift = rows.filter((r) => r.hasDrift);
  return {
    overall: aggregate(withDrift),
    byTier: {
      BLOCKBUSTER: aggregate(withDrift.filter((r) => r.tier === 'BLOCKBUSTER')),
      STRONG: aggregate(withDrift.filter((r) => r.tier === 'STRONG')),
    },
    byBucket: {
      high: aggregate(withDrift.filter((r) => peadBucketOf(r.peadScore) === 'high')),
      mid: aggregate(withDrift.filter((r) => peadBucketOf(r.peadScore) === 'mid')),
      low: aggregate(withDrift.filter((r) => peadBucketOf(r.peadScore) === 'low')),
      unscored: aggregate(withDrift.filter((r) => peadBucketOf(r.peadScore) === 'unscored')),
    },
    awaiting: rows.filter((r) => !r.hasDrift).length,
    total: rows.length,
  };
}
