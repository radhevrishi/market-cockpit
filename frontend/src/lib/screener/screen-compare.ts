// zzz1045b — "Compare with another screen": which rules two screens share, which differ only in their threshold (same field,
// shown side by side) and which only one has; how many companies each keeps on the current snapshot, how many each loses to a
// missing figure, and example companies in one and not the other. Pure — never changes either screen.
import type { ScreenMarket, ScreenRow } from './types';
import { filterKeys, runScreen, type Filter, type NumKey, type Screen } from './filters';

export interface RuleCompare {
  /** identical rules (same field, comparison and value) */
  shared: Filter[];
  /** the same field (or field pair / kind) with a different comparison or value: A's rule next to B's */
  changed: Array<{ a: Filter; b: Filter }>;
  onlyA: Filter[];
  onlyB: Filter[];
  /** paused rules (not applied) per side — left out of the comparison */
  pausedA: number;
  pausedB: number;
}

/** What a rule is "about": two rules with the same slot and different signatures are shown side by side. */
export function ruleSlot(f: Filter): string {
  switch (f.kind) {
    case 'num': return `num:${f.key}`;
    case 'date': return `date:${f.key}`;
    case 'cmp': return `cmp:${f.key}:${f.other}`;
    case 'near': return `near:${f.key}:${f.other}`;
    case 'sector': return 'sector';
    case 'exch': return 'exch';
    case 'pattern': return 'pattern';
  }
}
const sortedStr = (a: readonly string[]) => Array.from(new Set(a)).sort().join('|');
/** The full rule, written so two equal rules give the same text (list order and the pause mark do not count). */
export function ruleSignature(f: Filter): string {
  switch (f.kind) {
    case 'num': return f.op === 'between' ? `num:${f.key}:between:${Math.min(f.v, f.v2 ?? f.v)}:${Math.max(f.v, f.v2 ?? f.v)}` : `num:${f.key}:${f.op}:${f.v}`;
    case 'date': return `date:${f.key}:${f.op}:${f.op === 'pastYears' ? (f.v ?? 5) : ''}`;
    case 'cmp': return `cmp:${f.key}:${f.op}:${f.other}`;
    case 'near': return `near:${f.key}:${f.other}:${Math.min(f.lo, f.hi)}:${Math.max(f.lo, f.hi)}`;
    case 'sector': return `sector:${sortedStr(f.sectors)}`;
    case 'exch': return `exch:${sortedStr(f.ex)}`;
    case 'pattern': {
      const { bias, ids, tfs, tfMode, stages, minScore, dist } = f;
      // zzz1103 (N07) — "breakouts holding only" is a different rule from the default
      return `pattern:${bias}:${sortedStr(ids)}:${sortedStr(tfs)}:${tfMode}:${sortedStr(stages)}:${minScore}:${dist?.on ? `${dist.lo}:${dist.hi}` : 'off'}${f.returned === false ? ':holding' : ''}`;
    }
  }
}

export function compareRules(a: readonly Filter[], b: readonly Filter[]): RuleCompare {
  const actA = a.filter((f) => !f.off), actB = b.filter((f) => !f.off);
  const shared: Filter[] = [];
  const restB = [...actB];
  const restA: Filter[] = [];
  for (const f of actA) {
    const sig = ruleSignature(f);
    const i = restB.findIndex((g) => ruleSignature(g) === sig);
    if (i >= 0) { shared.push(f); restB.splice(i, 1); } else restA.push(f);
  }
  const changed: Array<{ a: Filter; b: Filter }> = [];
  const onlyA: Filter[] = [];
  for (const f of restA) {
    const slot = ruleSlot(f);
    const i = restB.findIndex((g) => ruleSlot(g) === slot);
    if (i >= 0) { changed.push({ a: f, b: restB[i] }); restB.splice(i, 1); } else onlyA.push(f);
  }
  return { shared, changed, onlyA, onlyB: restB, pausedA: a.length - actA.length, pausedB: b.length - actB.length };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface MissingLoss {
  /** companies that fail at least one applied rule because a figure that rule reads is not known */
  companies: number;
  /** per field: how many companies lack it (fields read by the screen's applied rules), most first */
  byField: Array<{ key: NumKey; n: number }>;
}
export function missingLoss(rows: readonly ScreenRow[], filters: readonly Filter[]): MissingLoss {
  const keys = Array.from(new Set(filters.filter((f) => !f.off).flatMap(filterKeys)));
  const per = new Map<NumKey, number>();
  let companies = 0;
  for (const r of rows) {
    let lost = false;
    for (const k of keys) if (!fin(r[k])) { per.set(k, (per.get(k) || 0) + 1); lost = true; }
    if (lost) companies++;
  }
  return { companies, byField: Array.from(per, ([key, n]) => ({ key, n })).sort((x, y) => y.n - x.n || String(x.key).localeCompare(String(y.key))) };
}

export interface ScreenSide { name: string; market: ScreenMarket; filters: readonly Filter[] }
export interface CompareResult {
  rules: RuleCompare;
  /** the two screens are for different markets: their figures are in different units and their companies differ */
  marketsDiffer: boolean;
  a: { matches: number; universe: number; missing: MissingLoss };
  b: { matches: number; universe: number; missing: MissingLoss };
  both: number;
  /** up to `limit` examples (largest market cap first) */
  onlyInA: Array<{ t: string; n: string }>;
  onlyInB: Array<{ t: string; n: string }>;
  onlyInACount: number;
  onlyInBCount: number;
}

const byCapDesc = (x: ScreenRow, y: ScreenRow) => (fin(y.mc) ? y.mc : -Infinity) - (fin(x.mc) ? x.mc : -Infinity) || x.t.localeCompare(y.t);

/** Compare screen A (on rowsA) with B (on rowsB — the same rows when both are for one market). */
export function compareScreens(a: ScreenSide, b: ScreenSide, rowsA: readonly ScreenRow[], rowsB: readonly ScreenRow[],
  opts: { now?: Date; exactOnly?: boolean; limit?: number } = {}): CompareResult {
  const now = opts.now ?? new Date(), exact = !!opts.exactOnly, limit = opts.limit ?? 10;
  const mA = runScreen(rowsA, a.filters, now, exact), mB = runScreen(rowsB, b.filters, now, exact);
  // zzz1104 (deep audit N08) — a company is its market + ticker: India HAL (Hindustan Aeronautics) and US HAL (Halliburton) are
  // two companies, so screens for different markets share no company
  const idA = (r: ScreenRow) => `${a.market}:${r.t}`, idB = (r: ScreenRow) => `${b.market}:${r.t}`;
  const setA = new Set(mA.map(idA)), setB = new Set(mB.map(idB));
  const onlyA = mA.filter((r) => !setB.has(idA(r))).sort(byCapDesc), onlyB = mB.filter((r) => !setA.has(idB(r))).sort(byCapDesc);
  const pick = (r: ScreenRow) => ({ t: r.t, n: r.n });
  return {
    rules: compareRules(a.filters, b.filters),
    marketsDiffer: a.market !== b.market,
    a: { matches: mA.length, universe: rowsA.length, missing: missingLoss(rowsA, a.filters) },
    b: { matches: mB.length, universe: rowsB.length, missing: missingLoss(rowsB, b.filters) },
    both: mA.filter((r) => setB.has(idA(r))).length,
    onlyInA: onlyA.slice(0, limit).map(pick),
    onlyInB: onlyB.slice(0, limit).map(pick),
    onlyInACount: onlyA.length,
    onlyInBCount: onlyB.length,
  };
}

/** Screens that can be compared with the open one: same market first, then the other market; the open screen left out. */
export function compareCandidates(screens: readonly Screen[], currentId: string, market: ScreenMarket, hidden: readonly string[] = []): Screen[] {
  const off = new Set(hidden);
  const list = screens.filter((s) => s.id !== currentId && !off.has(s.id));
  return [...list.filter((s) => s.market === market), ...list.filter((s) => s.market !== market)];
}

/**
 * zzz1124 (deep audit §6.7) — the difference between two screens in plain words, so variants such as "Super Scalers Full" vs "Main"
 * read as "B adds the buyback and YTD limits; B allows equal averages" instead of only a rule table. `label` turns a rule into its
 * text (the page passes filterLabel). At most `max` items per sentence; the table below keeps every rule. Pure.
 */
export function rulesInWords(r: RuleCompare, label: (f: Filter) => string, max = 6): string[] {
  const list = (fs: readonly Filter[]) => { const t = fs.map(label); return t.length > max ? `${t.slice(0, max).join('; ')} and ${t.length - max} more` : t.join('; '); };
  const out: string[] = [];
  if (!r.changed.length && !r.onlyA.length && !r.onlyB.length) return ['The two screens apply the same rules.'];
  if (r.onlyA.length) out.push(`Only A has: ${list(r.onlyA)}.`);
  if (r.onlyB.length) out.push(`Only B has: ${list(r.onlyB)}.`);
  if (r.changed.length) out.push(`Same field, different limit: ${r.changed.slice(0, max).map((c) => `A “${label(c.a)}” vs B “${label(c.b)}”`).join('; ')}${r.changed.length > max ? ` and ${r.changed.length - max} more` : ''}.`);
  out.push(`${r.shared.length} rule${r.shared.length === 1 ? ' is' : 's are'} identical.`);
  return out;
}
