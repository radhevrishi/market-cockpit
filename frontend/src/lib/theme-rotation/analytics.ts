// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — MORE ANALYTICS  (zzz797)
//
// Each piece traceable to data the page already has:
//   · breadth heatmap — % of each theme's constituents above their 20 / 50 /
//     200-day lines, and new 52-week highs minus lows, with the sample size;
//   · leaders and laggards inside a theme — top / bottom 3 by one-month
//     relative strength, SMALL / MID caps only;
//   · second-order names after a rotation — small / mid caps only, backed by
//     a dated strong print where one exists;
//   · correlation clusters — themes that move together ("moves with");
//   · your exposure — holdings weighted by their theme's verdict, and the
//     holdings sitting in breakdown / AVOID / TRIM themes with their own 1M.
// Pure functions: the page renders them, the tests call them.
// ═══════════════════════════════════════════════════════════════════════════

import type { ThemeRegion } from '@/lib/theme-universe';
import { sizeClass } from '@/lib/theme-universe';
import type { ThemeView } from './view-model';
import type { ListEntry } from './lists';
import { BREADTH_MIN_CONFIDENT } from './layers';

// ── BREADTH HEATMAP ────────────────────────────────────────────────────────
export interface HeatRow {
  id: string;
  n: number;
  p20: number | null;
  p50: number | null;
  p200: number | null;
  n200: number | null;
  /** New 52-week highs minus new lows, as a count of names. */
  hiLo: number | null;
  lowConfidence: boolean;
}

export function heatmapRows(views: ThemeView[]): HeatRow[] {
  const out: HeatRow[] = [];
  for (const v of views) {
    const b = v.row.breadthStats;
    if (!b || !b.n) continue;
    const pc = (x: number | null | undefined, d: number | null | undefined) => (typeof x === 'number' && typeof d === 'number' && d > 0 ? Math.round((x / d) * 100) : null);
    out.push({
      id: v.row.id, n: b.n,
      p20: pc(b.above20, b.n), p50: pc(b.above50, b.n),
      p200: pc(b.above200, b.n200 ?? null), n200: b.n200 ?? null,
      hiLo: b.newHighs - b.newLows,
      lowConfidence: b.n < BREADTH_MIN_CONFIDENT,
    });
  }
  return out;
}

// ── LEADERS / LAGGARDS INSIDE A THEME ──────────────────────────────────────
export interface DrillStock { sym: string; m1?: number | null; rs1m?: number | null; rs3m?: number | null; aboveSMA50?: boolean; extra?: boolean }
export interface LeaderPick { sym: string; rs1m: number; m1: number | null; size: 'small-mid' | 'unknown'; cap: number | null }

/**
 * Top / bottom `n` constituents by one-month relative strength (1M return
 * minus the benchmark's), small and mid caps only. Large caps (by market cap
 * on file, else by the well-known list) are counted as excluded.
 */
export function leadersLaggards(stocks: DrillStock[], region: ThemeRegion, capOf: (sym: string) => number | null, n = 3): { leaders: LeaderPick[]; laggards: LeaderPick[]; excludedLarge: number; eligible: number } {
  const pool: LeaderPick[] = [];
  let excludedLarge = 0;
  for (const s of stocks) {
    if (typeof s.rs1m !== 'number' || !Number.isFinite(s.rs1m)) continue;
    const cap = capOf(s.sym);
    const size = sizeClass(s.sym, region, cap);
    if (size === 'large') { excludedLarge++; continue; }
    pool.push({ sym: s.sym, rs1m: s.rs1m, m1: typeof s.m1 === 'number' ? s.m1 : null, size, cap });
  }
  const byRs = [...pool].sort((a, b) => b.rs1m - a.rs1m || a.sym.localeCompare(b.sym));
  const leaders = byRs.slice(0, n);
  const laggards = byRs.length > n ? [...byRs].reverse().filter((x) => !leaders.includes(x)).slice(0, n) : [];
  return { leaders, laggards, excludedLarge, eligible: pool.length };
}

// ── SECOND-ORDER NAMES (small / mid only) ──────────────────────────────────
export interface Candidate { ticker: string; cap?: number | null; strongPrint?: string | null; onList?: boolean }

/**
 * Names in a theme most likely to benefit next, SMALL / MID caps only:
 * those with a recent strong print first (newest first), then names on your
 * lists, then declared constituents that are not large caps. Each label says
 * why the name is there.
 */
export function smallMidBeneficiaries(cands: Candidate[], region: ThemeRegion, max = 4): string[] {
  const seen = new Set<string>();
  const ok = cands.filter((c) => {
    const t = c.ticker.toUpperCase().replace(/\.(NS|BO)$/, '');
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return sizeClass(t, region, c.cap ?? null) !== 'large';
  });
  const rank = (c: Candidate) => (c.strongPrint ? 0 : c.onList ? 1 : 2);
  ok.sort((a, b) => rank(a) - rank(b) || String(b.strongPrint || '').localeCompare(String(a.strongPrint || '')) || a.ticker.localeCompare(b.ticker));
  return ok.slice(0, max).map((c) => {
    const t = c.ticker.toUpperCase().replace(/\.(NS|BO)$/, '');
    const size = sizeClass(t, region, c.cap ?? null);
    const why = c.strongPrint ? `strong print ${c.strongPrint}` : c.onList ? 'on your lists' : 'constituent';
    return `${t} (${why}${size === 'unknown' ? ', size not on file' : ''})`;
  });
}

// ── CORRELATION CLUSTERS ───────────────────────────────────────────────────
export interface ClusterGroup { id: number; label: string; members: string[]; verdicts: Record<string, number>; note: string }

export function clusterGroups(views: ThemeView[], clusters: Array<{ id: number; label: string; members: string[] }> | null | undefined): ClusterGroup[] {
  if (!clusters) return [];
  const byId = new Map(views.map((v) => [v.row.id, v]));
  const out: ClusterGroup[] = [];
  for (const c of clusters) {
    const mem = c.members.filter((m) => byId.has(m));
    if (mem.length < 2) continue;
    const verdicts: Record<string, number> = {};
    for (const m of mem) { const vv = byId.get(m)!.row.verdict || '—'; verdicts[vv] = (verdicts[vv] || 0) + 1; }
    const mixed = Object.keys(verdicts).length > 1;
    out.push({
      id: c.id, label: c.label, members: mem, verdicts,
      note: `${mem.length} themes whose daily moves correlate at 0.8 or more over 6 months — owning several is closer to one position than to several.${mixed ? ' Their verdicts differ, so the stronger one is the better way to hold the idea.' : ''}`,
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

// ── YOUR EXPOSURE ──────────────────────────────────────────────────────────
export interface HoldingQuote { price: number | null; m1: number | null; w1: number | null }
export interface ExposureModel {
  /** 'value' when values are on file for most holdings, else 'count'. */
  basis: 'value' | 'count';
  total: number;
  byVerdict: Array<{ verdict: string; weight: number; count: number; tickers: string[] }>;
  /** Holdings in themes with a breakdown flag or a TRIM / AVOID verdict. */
  atRisk: Array<{ ticker: string; theme: string; verdict: string; reason: string; m1: number | null }>;
  unmatched: Array<{ ticker: string; reason: string }>;
  excluded: Array<{ ticker: string; reason: string }>;
  note: string;
}

const V_ORDER = ['BUY', 'EARLY BUY', 'HOLD', 'WATCH', 'TRIM', 'AVOID', 'No theme'];

/**
 * @param valueOf current value of a holding (any single currency), or null.
 * @param quoteOf the holding's own price move, or null.
 * @param reasonOf why an unmatched holding has no theme.
 * @param excluded holdings left out of the counts (cash lines, non-US listings), with the reason.
 */
export function exposureModel(
  entries: ListEntry[], byTheme: Map<string, ThemeView>,
  valueOf: (t: string) => number | null, quoteOf: (t: string) => HoldingQuote | null,
  reasonOf: (e: ListEntry) => string, excluded: Map<string, string>,
): ExposureModel {
  const held = entries.filter((e) => e.held);
  const ex = held.filter((e) => excluded.has(e.ticker)).map((e) => ({ ticker: e.ticker, reason: excluded.get(e.ticker)! }));
  const counted = held.filter((e) => !excluded.has(e.ticker));
  const vals = counted.map((e) => valueOf(e.ticker));
  const withVal = vals.filter((v) => typeof v === 'number' && v > 0).length;
  const basis: ExposureModel['basis'] = counted.length && withVal >= Math.ceil(counted.length * 0.8) ? 'value' : 'count';
  const buckets = new Map<string, { weight: number; count: number; tickers: string[] }>();
  let totalW = 0;
  const atRisk: ExposureModel['atRisk'] = [];
  const unmatched: ExposureModel['unmatched'] = [];
  counted.forEach((e, i) => {
    const v = e.theme ? byTheme.get(e.theme) : undefined;
    const key = v?.row.verdict || 'No theme';
    const w = basis === 'value' ? (vals[i] && vals[i]! > 0 ? vals[i]! : 0) : 1;
    totalW += w;
    const b = buckets.get(key) || { weight: 0, count: 0, tickers: [] };
    b.weight += w; b.count++; b.tickers.push(e.ticker); buckets.set(key, b);
    if (!v) { unmatched.push({ ticker: e.ticker, reason: reasonOf(e) }); return; }
    const brk = v.a.flags.find((f) => f.kind === 'breakdown');
    if (brk || v.row.verdict === 'TRIM' || v.row.verdict === 'AVOID') {
      atRisk.push({ ticker: e.ticker, theme: v.row.id, verdict: v.row.verdict || '—', reason: brk ? brk.label : `theme rated ${v.row.verdict}`, m1: quoteOf(e.ticker)?.m1 ?? null });
    }
  });
  const byVerdict = [...buckets.entries()].map(([verdict, b]) => ({ verdict, weight: totalW > 0 ? +(b.weight / totalW * 100).toFixed(1) : 0, count: b.count, tickers: b.tickers }))
    .sort((a, b) => V_ORDER.indexOf(a.verdict) - V_ORDER.indexOf(b.verdict));
  atRisk.sort((a, b) => (a.m1 ?? 0) - (b.m1 ?? 0));
  const note = !counted.length ? 'No holdings found on this device.'
    : basis === 'value' ? `Weighted by current value of ${withVal} of ${counted.length} holdings${ex.length ? `; ${ex.length} cash / non-US line${ex.length === 1 ? '' : 's'} left out` : ''}.`
      : `Values are not on file for enough holdings, so this counts holdings equally (${counted.length})${ex.length ? `; ${ex.length} cash / non-US line${ex.length === 1 ? '' : 's'} left out` : ''}.`;
  return { basis, total: counted.length, byVerdict, atRisk, unmatched, excluded: ex, note };
}
