// ═══════════════════════════════════════════════════════════════════════════
// INDIA GRADED SESSIONS AS COMPACT ROWS — ONE READER FOR EVERY CONSUMER.  (zzz1262)
//
// Three routes each read the 120 graded sessions their own way:
//   · portfolio/earnings-grades — per ticker, with an in-process memo (zzz1254 / zzz1255);
//   · earnings/search           — a whole index cached 15 min in the store as `search:idx:v3`;
//   · book/bse-map              — read `search:idx:v3` and found nothing when no search had just run.
// The 15-minute whole-index copy was the bug behind KROSS (a build that missed recent sessions was served for 15
// minutes) and it was still feeding search and bse-map. Now there is ONE reader:
//   · each session is boiled down to compact rows once and kept in memory (today 5 min, older days 30 min);
//   · sessions are read in batches (one multi-get per 6 days), each batch retried once;
//   · a session that could not be read is NEVER remembered as empty — it is reported in `unread` and read again
//     on the next call;
//   · two callers asking for the same day at the same moment share one read (portfolio, risk and cockpit pages all
//     ask on load).
// Dates are India (IST) business days — India files on IST days; a UTC date lags by 5 h 30.
// ═══════════════════════════════════════════════════════════════════════════
import { gradedKeyCandidates } from './graded-cache-key';

export type GradedTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
export const GRADED_TIERS: readonly GradedTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];
export const GRADED_LOOKBACK_BUSINESS_DAYS = 120;

/** One graded result, boiled down. `t` is the upper-case ticker exactly as graded. */
export interface GradedRow {
  t: string; c: string; fd: string; tier: GradedTier;
  sec: string | null; mc: number | null; q: string | null; cs: number | null; p: number | null; bse: string | null;
}
/** A row with how many business days back its session is (0 = today). */
export type GradedEntry = GradedRow & { db: number };

/** The last `n` India business days, newest first (IST calendar; weekends skipped). Pure. */
export function istBusinessDaysBack(n: number, nowMs: number = Date.now()): string[] {
  const out: string[] = [];
  const base = nowMs + 330 * 60_000;
  for (let i = 0; out.length < n && i < n * 2; i++) {
    const d = new Date(base - i * 86_400_000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** A graded day payload → compact rows. Pure. */
export function compactGradedRows(payload: any, d: string): GradedRow[] {
  const rows: GradedRow[] = [];
  for (const tier of GRADED_TIERS) {
    const arr = payload?.by_tier?.[tier];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const t = String(e?.ticker || '').toUpperCase();
      if (!t) continue;
      rows.push({
        t, c: String(e.company || t), fd: String(e.filing_date || d), tier,
        sec: e.sector || null, mc: typeof e.market_cap_cr === 'number' ? e.market_cap_cr : null,
        q: e.quarter || null, cs: typeof e.composite_score === 'number' ? e.composite_score : null,
        p: typeof e.pead_score === 'number' ? e.pead_score : null,
        bse: e.bse_code != null ? String(e.bse_code) : e.scrip_code != null ? String(e.scrip_code) : null,
      });
    }
  }
  return rows;
}

/** "Q2 FY27" → 272 (orders quarters; 0 when unreadable). Pure. */
export function quarterRank(q: string | null | undefined): number {
  const m = /Q(\d)\s*FY\s*(\d+)/i.exec(q || '');
  return m ? parseInt(m[2], 10) * 10 + parseInt(m[1], 10) : 0;
}

export interface GradedReadDeps {
  /** multi-get of stored values (throws when the store cannot be read) */
  mget: (keys: string[]) => Promise<any[]>;
  /** regrade a payload stored under an older engine version (in memory) */
  regrade: (payload: any, key: string) => any;
  now?: () => number;
}

const GROUP = 6;          // sessions per multi-get
const LANES = 2;          // multi-gets in flight at once (payloads are large; more lanes = more memory at the peak)
const TODAY_TTL_MS = 5 * 60_000;
const OLDER_TTL_MS = 30 * 60_000;

interface Shared { memo: Map<string, { at: number; rows: GradedRow[] }>; inflight: Map<string, Promise<void>>; flat: { at: number; key: string; index: GradedEntry[] } | null }
const G = globalThis as any;
const shared: Shared = G.__mcGradedSessions || (G.__mcGradedSessions = { memo: new Map(), inflight: new Map(), flat: null });

async function defaultDeps(): Promise<GradedReadDeps> {
  const [{ kvMGet }, { withCurrentIndiaRules }] = await Promise.all([import('./kv'), import('./india-regrade')]);
  return { mget: (keys) => kvMGet(keys), regrade: withCurrentIndiaRules };
}

/** Forget every remembered session (the search page's "refresh"). */
export function clearGradedSessionMemo(): void { shared.memo.clear(); shared.flat = null; }

async function readGroup(group: string[], deps: GradedReadDeps): Promise<void> {
  const keys: string[] = [], owner: string[] = [];
  for (const d of group) for (const k of gradedKeyCandidates(d)) { keys.push(k); owner.push(d); }
  let vals: any[] | null = null;
  for (let attempt = 0; attempt < 2 && !vals; attempt++) { try { vals = await deps.mget(keys); } catch { vals = null; } }
  if (!vals) return;                                   // unread: nothing remembered, the caller reports it
  const at = (deps.now || Date.now)();
  const done = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    const d = owner[i];
    if (done.has(d)) continue;                         // the first candidate key with a payload wins (current namespace first)
    const v = vals[i];
    if (v && v.by_tier) { shared.memo.set(d, { at, rows: compactGradedRows(deps.regrade(v, keys[i]), d) }); done.add(d); }
  }
  for (const d of group) if (!done.has(d)) shared.memo.set(d, { at, rows: [] });   // read fine, nothing graded that day
  shared.flat = null;
}

/**
 * Compact rows of the given sessions, in the order asked. `unread` = sessions the store could not give (after one retry);
 * they are not remembered and will be read again next time.
 */
export async function gradedSessions(dates: string[], depsIn?: GradedReadDeps): Promise<{ sessions: Array<{ d: string; rows: GradedRow[] }>; unread: string[] }> {
  const deps = depsIn || await defaultDeps();
  const now = (deps.now || Date.now)();
  const today = istBusinessDaysBack(1, now)[0];
  const fresh = (d: string) => { const m = shared.memo.get(d); return !!m && now - m.at < (d === today ? TODAY_TTL_MS : OLDER_TTL_MS); };
  const waits: Promise<void>[] = [];
  const todo: string[] = [];
  for (const d of dates) {
    if (fresh(d)) continue;
    const p = shared.inflight.get(d);
    if (p) waits.push(p); else todo.push(d);
  }
  const groups: string[][] = [];
  for (let i = 0; i < todo.length; i += GROUP) groups.push(todo.slice(i, i + GROUP));
  // Every group's read is created (and registered as in flight) NOW, before anything is awaited, so a second caller
  // arriving a moment later shares these reads. Group i runs after group i − LANES: at most LANES multi-gets at once.
  const runs: Promise<void>[] = [];
  groups.forEach((g, i) => {
    const before = i >= LANES ? runs[i - LANES] : Promise.resolve();
    const p: Promise<void> = before.then(() => readGroup(g, deps)).catch(() => undefined)
      .finally(() => { for (const d of g) if (shared.inflight.get(d) === p) shared.inflight.delete(d); });
    for (const d of g) shared.inflight.set(d, p);
    runs.push(p);
  });
  await Promise.all([...runs, ...waits]);
  const sessions: Array<{ d: string; rows: GradedRow[] }> = [], unread: string[] = [];
  for (const d of dates) {
    const m = shared.memo.get(d);
    if (m) sessions.push({ d, rows: m.rows });   // a remembered copy past its time is still better than nothing …
    if (!fresh(d)) unread.push(d);               // … but the day is reported as not read this time
  }
  return { sessions, unread };
}

/** Every graded entry of the look-back window, newest session first, one per ticker + quarter (the newest sighting). */
export async function gradedIndex(depsIn?: GradedReadDeps): Promise<{ index: GradedEntry[]; unread: string[]; cache: 'memo' | 'built' }> {
  const now = (depsIn?.now || Date.now)();
  const dates = istBusinessDaysBack(GRADED_LOOKBACK_BUSINESS_DAYS, now);
  const key = dates[0];
  if (shared.flat && shared.flat.key === key && now - shared.flat.at < 60_000) return { index: shared.flat.index, unread: [], cache: 'memo' };
  const { sessions, unread } = await gradedSessions(dates, depsIn);
  const index = flattenSessions(sessions, dates);
  if (!unread.length) shared.flat = { at: now, key, index };   // an incomplete index is never kept
  const inWindow = new Set(dates);
  for (const k of shared.memo.keys()) if (!inWindow.has(k)) shared.memo.delete(k);
  return { index, unread, cache: 'built' };
}

/** Pure: sessions (any order) → entries, newest session first, first sighting of ticker@quarter kept; `only` narrows to those tickers. */
export function flattenSessions(sessions: Array<{ d: string; rows: GradedRow[] }>, dates: string[], only?: ReadonlySet<string>): GradedEntry[] {
  const pos = new Map(dates.map((d, i) => [d, i] as const));
  const ordered = sessions.filter((s) => pos.has(s.d)).sort((a, b) => pos.get(a.d)! - pos.get(b.d)!);
  const seen = new Set<string>();
  const out: GradedEntry[] = [];
  for (const s of ordered) {
    const db = pos.get(s.d)!;
    for (const r of s.rows) {
      if (only && !only.has(r.t)) continue;
      const k = `${r.t}@${r.q || ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...r, db });
    }
  }
  return out;
}

/** The graded entries of just these tickers (upper-case), newest session first. */
export async function lookupGraded(tickers: string[], depsIn?: GradedReadDeps): Promise<{ entries: GradedEntry[]; unread: string[] }> {
  const now = (depsIn?.now || Date.now)();
  const dates = istBusinessDaysBack(GRADED_LOOKBACK_BUSINESS_DAYS, now);
  const { sessions, unread } = await gradedSessions(dates, depsIn);
  return { entries: flattenSessions(sessions, dates, new Set(tickers.map((t) => String(t).toUpperCase()))), unread };
}
