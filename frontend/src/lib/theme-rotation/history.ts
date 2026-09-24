// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — WEEKLY HISTORY  (zzz795)
//
// One compact snapshot per market per ISO week, in KV:
//     theme-rotation:snap:v1:<market>:<YYYY-Www>     (TTL ~400 days)
//
//   base    — written by the server whenever the board is rebuilt: verdict,
//             quadrant, relative strength, 50-day line, breadth, returns.
//   overlay — posted by the page after it has combined the server read with
//             the evidence that only lives in the browser (graded earnings,
//             catalysts): the research tier and rank.
//
// The last write of a week wins, so a snapshot describes where the week ended.
// From these the page derives new entrants, risers, fallers, persistent
// leaders and fading themes, and whether a move is accelerating, continuing
// or reversing. Until two weeks exist it says so plainly and falls back to the
// eight-week relative-strength tail the engine already computes.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  HistoryDiff, Market, SnapThemeBase, SnapThemeOverlay, ThemeRow, Tier, TrendRead, WeeklySnapshot,
} from './types';
import { TIER_ORDER } from './types';

export const SNAP_TTL_S = 400 * 24 * 60 * 60;
export const SNAP_MAX_BYTES = 900_000;
export const snapKey = (market: Market, week: string) => `theme-rotation:snap:v1:${market}:${week}`;

/** ISO-8601 week label, e.g. 2026-W39 (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/** The ISO weeks ending with the week containing `d`, newest first. */
export function recentWeeks(d: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(isoWeek(new Date(d.getTime() - i * 7 * 86_400_000)));
  return [...new Set(out)];
}

const r2 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(2) : undefined);

export function compactBase(rows: ThemeRow[]): Record<string, SnapThemeBase> {
  const out: Record<string, SnapThemeBase> = {};
  for (const t of rows) {
    if (t.ok === false) continue;
    const b = t.breadthStats;
    out[t.id] = {
      v: t.verdict, q: t.quadrant, rs: r2(t.rsRatio), mom: r2(t.rsMomentum), a50: t.aboveSMA50,
      b: b && b.n ? Math.round((b.above50 / b.n) * 100) : null,
      m1: r2(t.ret?.m1), m3: r2(t.ret?.m3),
    };
  }
  return out;
}

/** Validate and trim a client overlay before it is written. */
export function sanitizeOverlay(raw: unknown, knownIds: Set<string> | null): Record<string, SnapThemeOverlay> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const TIERS = new Set<Tier>(['top', 'look', 'monitor', 'low']);
  const FLAGS = new Set(['early-rotation', 'crowded', 'breakdown', 'short-term-break', 'defensive']);
  const out: Record<string, SnapThemeOverlay> = {};
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, any>)) {
    if (n >= 200) break;
    if (!/^[a-z0-9-]{2,40}$/.test(id)) continue;
    if (knownIds && !knownIds.has(id)) continue;
    if (!v || typeof v !== 'object') continue;
    const o: SnapThemeOverlay = {};
    if (TIERS.has(v.t)) o.t = v.t;
    if (Number.isInteger(v.r) && v.r >= 1 && v.r <= 500) o.r = v.r;
    if (Number.isInteger(v.e) && v.e >= 0 && v.e <= 1000) o.e = v.e;
    if (Number.isInteger(v.c) && v.c >= 0 && v.c <= 1000) o.c = v.c;
    if (Array.isArray(v.f)) o.f = v.f.filter((x: any) => FLAGS.has(x)).slice(0, 5);
    out[id] = o; n++;
  }
  return n ? out : null;
}

export function mergeSnapshot(prev: WeeklySnapshot | null, patch: Partial<WeeklySnapshot> & { week: string; market: Market }, nowIso: string): WeeklySnapshot {
  const next: WeeklySnapshot = { ...(prev || { week: patch.week, market: patch.market }), week: patch.week, market: patch.market, at: nowIso };
  if (patch.base) next.base = patch.base;
  if (patch.overlay) { next.overlay = patch.overlay; next.overlayAt = nowIso; }
  return next;
}

export function snapshotBytes(s: WeeklySnapshot): number {
  return new TextEncoder().encode(JSON.stringify(s)).length;
}

// ── TREND WORDS ────────────────────────────────────────────────────────────
/**
 * Accelerating / continuing / reversing from the last three points of a series
 * (oldest → newest). `eps` is the smallest change that counts as movement.
 */
export function trendFromSeries(values: Array<number | null | undefined>, eps = 0.3, basis: TrendRead['basis'] = 'rrg-tail'): TrendRead {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length < 3) return { word: 'unknown', dir: 'flat', basis: 'none', note: 'Not enough history yet.' };
  const [a, b, c] = v.slice(-3);
  const d0 = b - a, d1 = c - b;
  const dir: TrendRead['dir'] = d1 > eps ? 'up' : d1 < -eps ? 'down' : 'flat';
  const src = basis === 'snapshots' ? 'weekly snapshots' : 'the 8-week relative-strength tail';
  if (dir === 'flat') return { word: 'flat', dir, basis, note: `Little change in the latest week (${src}).` };
  if (Math.abs(d0) > eps && Math.sign(d0) !== Math.sign(d1)) return { word: 'reversing', dir, basis, note: `Turned ${dir} after moving the other way the week before (${src}).` };
  if (Math.abs(d1) > Math.abs(d0) * 1.25 && Math.sign(d0) === Math.sign(d1)) return { word: 'accelerating', dir, basis, note: `Moving ${dir} faster than the week before (${src}).` };
  return { word: 'continuing', dir, basis, note: `Still moving ${dir} (${src}).` };
}

export function trendForTheme(t: ThemeRow, snaps: WeeklySnapshot[]): TrendRead {
  // Snapshots win once three weeks exist; until then the RRG tail answers.
  const fromSnaps = snaps.map((s) => s.base?.[t.id]?.rs).filter((x) => typeof x === 'number');
  if (fromSnaps.length >= 3) return trendFromSeries(fromSnaps as number[], 0.3, 'snapshots');
  return trendFromSeries((t.trail || []).map((p) => p.x), 0.3, 'rrg-tail');
}

// ── WEEK-OVER-WEEK DIFF ────────────────────────────────────────────────────
const TOP2 = (t?: Tier) => t === 'top' || t === 'look';
const VERDICT_RANK: Record<string, number> = { BUY: 5, 'EARLY BUY': 4, HOLD: 3, WATCH: 2, TRIM: 1, AVOID: 0 };

/**
 * @param current  this week's tiers (computed on the page, not yet saved)
 * @param snaps    stored weekly snapshots, OLDEST first; the current week's
 *                 own snapshot, if present, is ignored for comparison.
 */
export function diffHistory(
  currentWeek: string,
  current: Record<string, { tier: Tier; verdict?: string }>,
  snaps: WeeklySnapshot[],
  rows: ThemeRow[],
): HistoryDiff {
  const past = snaps.filter((s) => s.week < currentWeek).sort((a, b) => a.week.localeCompare(b.week));
  const tierOf = (s: WeeklySnapshot, id: string): Tier | undefined => {
    const o = s.overlay?.[id]?.t; if (o) return o;
    // A week with no overlay still has a verdict: use it as a coarse tier.
    const v = s.base?.[id]?.v; if (!v) return undefined;
    const r = VERDICT_RANK[v] ?? 2;
    return r >= 4 ? 'look' : r >= 2 ? 'monitor' : 'low';
  };
  if (!past.length) return interimDiff(rows, currentWeek);
  const prev = past[past.length - 1];
  // Compare like with like: when the previous week holds no evidence overlay
  // (the page was not opened that week), both sides use the verdict-derived
  // coarse tier, so a richer read this week cannot masquerade as a change.
  const coarse = !prev.overlay || !Object.keys(prev.overlay).length;
  const coarseOf = (v?: string): Tier => { const r = VERDICT_RANK[v || ''] ?? 2; return r >= 4 ? 'look' : r >= 2 ? 'monitor' : 'low'; };
  const nowOf = (id: string): Tier => (coarse ? coarseOf(current[id].verdict) : current[id].tier);
  const thenOf = (s: WeeklySnapshot, id: string): Tier | undefined => (coarse ? (s.base?.[id]?.v ? coarseOf(s.base[id].v) : undefined) : tierOf(s, id));
  const lead: Tier = coarse ? 'look' : 'top';
  const ids = Object.keys(current);
  const newEntrants: string[] = [], rising: string[] = [], falling: string[] = [], persistentLeaders: string[] = [], fading: string[] = [];
  for (const id of ids) {
    const now = nowOf(id);
    const was = thenOf(prev, id);
    if (TOP2(now) && was && !TOP2(was)) newEntrants.push(id);
    if (was && TIER_ORDER[now] < TIER_ORDER[was]) rising.push(id);
    if (was && TIER_ORDER[now] > TIER_ORDER[was]) falling.push(id);
    const lastTwo = past.slice(-2).map((s) => thenOf(s, id));
    if (now === lead && lastTwo.length === 2 && lastTwo.every((t) => t === lead)) persistentLeaders.push(id);
    const recentTop = past.slice(-3).filter((s) => TOP2(thenOf(s, id))).length;
    if (!TOP2(now) && recentTop >= 2) fading.push(id);
  }
  const basisNote = coarse ? ' (that week has no stored evidence read, so the comparison uses the verdicts)' : '';
  return {
    available: true, basis: 'snapshots', previousWeek: prev.week, weeksOfHistory: past.length,
    newEntrants, rising: rising.filter((x) => !newEntrants.includes(x)), falling, persistentLeaders, fading,
    note: past.length < 3 ? `Compared with ${prev.week}${basisNote}. ${past.length} earlier week${past.length === 1 ? '' : 's'} stored so far — the history deepens every week.` : `Compared with ${prev.week}${basisNote}; ${past.length} earlier weeks stored.`,
  };
}

/** Before any stored history: use the 8-week RRG tail and quadrant moves. */
export function interimDiff(rows: ThemeRow[], currentWeek: string): HistoryDiff {
  const ok = rows.filter((t) => t.ok !== false);
  const up = ok.filter((t) => t.quadrantMove?.dir === 'upgrade').map((t) => t.id);
  const down = ok.filter((t) => t.quadrantMove?.dir === 'downgrade').map((t) => t.id);
  const newEntrants = ok.filter((t) => t.quadrantMove?.to === 'Leading' || (t.quadrantMove?.to === 'Improving' && t.quadrantMove?.from === 'Lagging')).map((t) => t.id);
  const persistentLeaders = ok.filter((t) => {
    const tr = t.trail || [];
    return tr.length >= 6 && tr.slice(-6).every((p) => p.x >= 100 && p.y >= 100);
  }).map((t) => t.id);
  const fading = ok.filter((t) => {
    const tr = t.trail || [];
    if (tr.length < 5) return false;
    const wasLeading = tr.slice(-5, -1).filter((p) => p.x >= 100 && p.y >= 100).length >= 2;
    return wasLeading && t.quadrant !== 'Leading';
  }).map((t) => t.id);
  return {
    available: false, basis: 'rrg-tail', previousWeek: null, weeksOfHistory: 0,
    newEntrants, rising: up.filter((x) => !newEntrants.includes(x)), falling: down, persistentLeaders, fading,
    note: `History starts this week (${currentWeek}). Until earlier weeks are stored, changes are read from the 8-week relative-strength tail.`,
  };
}
