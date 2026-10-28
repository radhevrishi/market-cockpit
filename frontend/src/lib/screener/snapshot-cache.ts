// zzz1053 — ONE in-memory copy of each market's screener snapshot, shared by /api/v1/stock-screener, /api/v1/pine-screener and
// /api/v1/tv-data (the TradingView-replacement CSVs).
//
// Before: each of the three kept its own 5-minute copy and read the WHOLE snapshot (US ≈ 15 MB of JSONB) again from Postgres every
// 5 minutes, with no sharing of a read in progress — the home page asks for the manifest and 7 CSV files at once, so a cold
// server ran up to ~20 parallel 15 MB reads over a 5-connection pool (1.3–5.9 s answers).
// Now: one read at a time per market (single flight); after REVALIDATE_MS only the tiny `built_at` is read, and the rows are read
// again only when a newer snapshot was written. A build in this process calls noteSnapshotWritten() so the next request reloads.
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import type { ScreenMarket, ScreenRow } from './types';

export interface SnapshotData { market: ScreenMarket; builtAt: string; rows: ScreenRow[]; meta: any }
export const REVALIDATE_MS = 60_000;

interface Slot { snap: SnapshotData | null; checkedAt: number; dirty: boolean }
const G = globalThis as any;
const SLOTS: Map<ScreenMarket, Slot> = G.__MC_SNAP_SLOTS__ || new Map();
G.__MC_SNAP_SLOTS__ = SLOTS;
const INFLIGHT: Map<string, Promise<SnapshotData | null>> = G.__MC_SNAP_INFLIGHT__ || new Map();
G.__MC_SNAP_INFLIGHT__ = INFLIGHT;

export interface SnapshotReader {
  builtAt(m: ScreenMarket): Promise<string | null>;
  head?(m: ScreenMarket): Promise<{ builtAt: string; meta: any } | null>;
  full(m: ScreenMarket): Promise<SnapshotData | null>;
}
const isoOf = (b: unknown) => (b instanceof Date ? b.toISOString() : String(b));
export const pgSnapshotReader: SnapshotReader = {
  async head(m) {
    if (!getPool() || !(await ensureSchema())) return null;
    const r = await dbQuery<{ built_at: string | Date; meta: any }>(`SELECT built_at, meta FROM screener_snapshot WHERE market = $1`, [m]);
    return r.length ? { builtAt: isoOf(r[0].built_at), meta: r[0].meta ?? null } : null;
  },
  async builtAt(m) {
    if (!getPool() || !(await ensureSchema())) return null;
    const r = await dbQuery<{ built_at: string | Date }>(`SELECT built_at FROM screener_snapshot WHERE market = $1`, [m]);
    return r.length ? isoOf(r[0].built_at) : null;
  },
  async full(m) {
    if (!getPool() || !(await ensureSchema())) return null;
    const r = await dbQuery<{ built_at: string | Date; rows: unknown; meta: any }>(`SELECT built_at, rows, meta FROM screener_snapshot WHERE market = $1`, [m]);
    if (!r.length) return null;
    let rows: unknown = r[0].rows;
    if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
    return { market: m, builtAt: isoOf(r[0].built_at), rows: Array.isArray(rows) ? (rows as ScreenRow[]) : [], meta: r[0].meta ?? null };
  },
};
let reader: SnapshotReader = pgSnapshotReader;
let clock: () => number = Date.now;
/** test hook */
export function _setSnapshotReaderForTests(r: SnapshotReader | null, now?: () => number): void { reader = r || pgSnapshotReader; clock = now || Date.now; SLOTS.clear(); INFLIGHT.clear(); }

/** A build in this process wrote a new snapshot: the next request re-reads it. */
export function noteSnapshotWritten(m: ScreenMarket): void {
  const s = SLOTS.get(m);
  if (s) s.dirty = true;
}

/** An unchanged-row publication still updates source/check notes; retain the expensive shared rows. */
export function noteSnapshotMetadataWritten(m: ScreenMarket, meta: any): void {
  const s = SLOTS.get(m);
  if (s?.snap && !s.dirty) s.snap = { ...s.snap, meta };
}

/**
 * The market's snapshot (null = none built / database unavailable). Never throws. A failed read keeps serving the copy in
 * memory (a database blip must not empty the screener).
 */
export function getSnapshot(m: ScreenMarket): Promise<SnapshotData | null> {
  const slot = SLOTS.get(m);
  const now = clock();
  if (slot && !slot.dirty && now - slot.checkedAt < REVALIDATE_MS) return Promise.resolve(slot.snap);
  return singleFlightSnap(m, async () => {
    const cur = SLOTS.get(m);
    try {
      if (cur?.snap && !cur.dirty) {
        // cheap check first: only the timestamp
        const head = reader.head ? await reader.head(m) : null;
        const b = reader.head ? head?.builtAt : await reader.builtAt(m);
        if (b && b === cur.snap.builtAt) {
          const snap = head ? { ...cur.snap, meta: head.meta } : cur.snap;
          SLOTS.set(m, { snap, checkedAt: clock(), dirty: false }); return snap;
        }
      }
      const full = await reader.full(m);
      SLOTS.set(m, { snap: full ?? (cur?.snap ?? null), checkedAt: clock(), dirty: false });
      return full ?? cur?.snap ?? null;
    } catch {
      // keep what we have; try again after a short pause rather than on every request
      SLOTS.set(m, { snap: cur?.snap ?? null, checkedAt: clock() - REVALIDATE_MS + 10_000, dirty: false });
      return cur?.snap ?? null;
    }
  });
}
function singleFlightSnap(m: ScreenMarket, fn: () => Promise<SnapshotData | null>): Promise<SnapshotData | null> {
  const k = `snap:${m}`;
  const cur = INFLIGHT.get(k);
  if (cur) return cur;
  const p = fn().finally(() => { if (INFLIGHT.get(k) === p) INFLIGHT.delete(k); });
  INFLIGHT.set(k, p);
  return p;
}

/**
 * zzz991 guard on a snapshot built before the Rule of 40 guard: rows whose r40 came from a tiny base get r40 = null. Made once per
 * snapshot (WeakMap) as a view — the shared rows are never changed, so the Pine Screener keeps reading them exactly as stored.
 */
const _guarded = new WeakMap<SnapshotData, ScreenRow[]>();
export function r40GuardedRows(snap: SnapshotData, usable: (revQYoY: any, fcfmTTM: any) => boolean): ScreenRow[] {
  const hit = _guarded.get(snap);
  if (hit) return hit;
  const out = snap.rows.map((r: any) => (r && r.r40 != null && !usable(r.revQYoY, r.fcfmTTM) ? { ...r, r40: null } : r));
  _guarded.set(snap, out);
  return out;
}

/** Status for system pages: what is held and how old the check is. */
export function snapshotCacheStatus(): Array<{ market: ScreenMarket; builtAt: string | null; rows: number; checkedAgoS: number }> {
  return [...SLOTS.entries()].map(([market, s]) => ({ market, builtAt: s.snap?.builtAt ?? null, rows: s.snap?.rows.length ?? 0, checkedAgoS: Math.round((clock() - s.checkedAt) / 1000) }));
}
