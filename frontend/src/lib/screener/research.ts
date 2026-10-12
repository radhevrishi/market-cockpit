// zzz969 — screener decision-accuracy helpers (pure; used by the page and the tests):
//   · applicability — a figure that does not mean anything for a kind of company (a bank's gross margin) is "not applicable",
//     which is different from "not known";
//   · exact explanations — every filter on one company, with the unrounded value against the rule (9.0% shown can be 8.96%);
//   · close-confirmed view — the price figures of the last COMPLETED session when the snapshot was read during trading;
//   · stable order — rows keep their place when new data arrives until the owner re-sorts;
//   · shortlists — a saved result (tickers, filters, figures, snapshot time, formula version) and what changed since;
//   · formula version — when a calculation changes, the page can say which saved screens moved and why.
import type { ScreenRow, ScreenMarket } from './types';
import { fieldOf, passes, filterKeys, filterLabel, type Filter, type NumKey } from './filters';

// ── formula version ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Bump with a line in FORMULA_CHANGES whenever a figure is worked out differently. */
export const FORMULA_VERSION = '2026.10.12';
export const FORMULA_CHANGES: ReadonlyArray<{ v: string; what: string }> = [
  { v: '2026.10.12', what: 'Last-5-trading-sessions change added; US companies without quarterly figures now say why; close-confirmed price figures kept for snapshots read during trading.' },
  { v: '2026.10.07', what: 'US cash read from restricted-cash / bank-cash lines when the plain line is not filed (EV / revenue and cash filters).' },
];
export function changesSince(v: string | null | undefined): string[] {
  if (!v) return [];
  return FORMULA_CHANGES.filter((c) => c.v > v).map((c) => `${c.v}: ${c.what}`);
}

// ── applicability ──────────────────────────────────────────────────────────────────────────────────────────────────────
const LENDER = /\b(bank|banking|insurance|insurer|nbfc|non[- ]banking|finance|financial services|lending|housing finance|credit|asset management|brokerage|capital markets|reit|real estate investment trust)\b/i;
/** Figures that are not meaningful for lenders / insurers / funds: no "cost of goods", debt is their raw material, EV is not defined. */
const NOT_FOR_LENDERS = new Set<string>(['gmFY', 'gpQYoY', 'gpAYoY', 'roceTTM', 'roceFY', 'evRev', 'de', 'deFY', 'netDebt', 'debtAssetsQ', 'debtAssetsA', 'debtCapQ', 'debtCapA', 'debtEbitdaQ', 'debtEbitdaA', 'ebitdaQoQ', 'ebitdaQYoY', 'ebitdaTTMYoY', 'ebitdaAYoY', 'fs']);
export function isLender(r: Pick<ScreenRow, 'tvSec' | 'sec' | 'ind'>): boolean {
  if (r.tvSec === 'Finance') return true;
  return LENDER.test(`${r.sec || ''} ${r.ind || ''}`);
}
/** Why a figure does not apply to this company (null = it applies). */
export function naReason(r: ScreenRow, key: string): string | null {
  if (NOT_FOR_LENDERS.has(key) && isLender(r)) return 'not applicable to banks, insurers and other financial companies (no cost of goods; debt is their raw material)';
  return null;
}

// ── close-confirmed view ───────────────────────────────────────────────────────────────────────────────────────────────
/** The row as of the last completed session (only rows read during trading carry `cc`). */
export function closeConfirmed(r: ScreenRow): ScreenRow {
  if (!r.cc) return r;
  return { ...r, ...(r.cc as Partial<ScreenRow>) };
}

// ── exact explanation ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface RuleCheck { label: string; pass: boolean; detail: string; nearMiss: boolean }
const OPW: Record<string, string> = { gt: 'greater than', ge: 'at least', lt: 'less than', le: 'at most', above: 'above', below: 'below' };
export function exact(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'not known';
  const a = Math.abs(v);
  return a >= 1e6 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(v * 10_000) / 10_000);
}
/** Every filter on one company: passed or not, the unrounded value against the rule, and a note when the miss is only visible unrounded. */
export function explainRow(r: ScreenRow, filters: readonly Filter[], market: ScreenMarket, now = new Date(), exactOnly = false): RuleCheck[] {
  return filters.map((f) => {
    const pass = passes(r, f, now, exactOnly);
    const label = filterLabel(f, market);
    if (f.kind === 'sector') return { label, pass, detail: `sector: ${r.tvSec || r.sec || 'not known'}`, nearMiss: false };
    if (f.kind === 'exch') return { label, pass, detail: `exchange: ${(r.exch || []).join(' / ') || 'not known'}`, nearMiss: false };
    const keys = filterKeys(f);
    const na = keys.map((k) => naReason(r, k)).find(Boolean);
    if (na && keys.every((k) => typeof r[k as NumKey] !== 'number')) return { label, pass, detail: na, nearMiss: false };
    const naNote = na ? ' · this figure is not meaningful for financial companies' : '';
    if (exactOnly && keys.some((k) => r.approx?.includes(k))) return { label, pass, detail: 'approximate (≈) for this company — "exact figures only" is on', nearMiss: false };
    const a = r[f.key as NumKey] as number | null | undefined;
    if (f.kind === 'date') return { label, pass, detail: `value: ${typeof a === 'number' ? new Date(a * 86_400_000).toISOString().slice(0, 10) : 'not known'}`, nearMiss: false };
    if (f.kind === 'cmp' || f.kind === 'near') {
      const b = r[f.other as NumKey] as number | null | undefined;
      const extra = f.kind === 'near' && typeof a === 'number' && typeof b === 'number' && b > 0 ? ` → ${exact((a / b - 1) * 100)}% above (rule ${f.lo}–${f.hi}%)` : '';
      return { label, pass, detail: `${fieldOf(f.key)?.label || f.key} ${exact(a)} vs ${fieldOf(f.other)?.label || f.other} ${exact(b)}${extra}${naNote}`, nearMiss: false };
    }
    const unit = fieldOf(f.key)?.unit;
    const rounded = typeof a === 'number' ? (unit === '%' ? Math.round(a * 10) / 10 : unit === 'x' ? Math.round(a * 100) / 100 : a) : null;
    // the shown (rounded) value would pass but the real one does not, or the other way round
    const roundedPass = rounded != null && passes({ ...r, [f.key]: rounded } as ScreenRow, f, now, false);
    const atEdge = rounded != null && a !== rounded && [f.v, f.v2].some((t) => typeof t === 'number' && rounded === t);
    const nearMiss = rounded != null && (roundedPass !== pass || atEdge);
    const rule = f.op === 'between' ? `between ${exact(f.v)} and ${exact(f.v2 ?? f.v)} (both ends included)` : `${OPW[f.op]} ${exact(f.v)}`;
    return { label, pass, detail: `value ${exact(a)} — rule: ${rule}${nearMiss ? ` · shown rounded as ${exact(rounded)}, compared unrounded` : ''}${naNote}`, nearMiss };
  });
}

// ── stable order ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Keep the rows that were already on screen in their old places; rows that are new go to the end in their sorted order. */
export function stableOrder<T>(prevKeys: readonly string[] | null, sorted: readonly T[], keyOf: (x: T) => string): { rows: T[]; moved: boolean } {
  if (!prevKeys || !prevKeys.length) return { rows: sorted.slice(), moved: false };
  const byKey = new Map(sorted.map((x) => [keyOf(x), x]));
  const out: T[] = [];
  for (const k of prevKeys) { const x = byKey.get(k); if (x) { out.push(x); byKey.delete(k); } }
  for (const x of sorted) if (byKey.has(keyOf(x))) out.push(x);
  const moved = out.some((x, i) => keyOf(x) !== keyOf(sorted[i]));
  return { rows: out, moved };
}

// ── shortlists ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const SHORTLISTS_KEY = 'mc:screen-shortlists:v1';
export interface Shortlist {
  id: string; name: string; savedAt: string; market: ScreenMarket; screenId: string; screenName: string;
  filters: Filter[]; exactOnly: boolean; closeOnly: boolean; snapshotBuiltAt: string | null; formulaVersion: string;
  rows: Array<{ t: string; n: string; v: Record<string, number | null> }>;
}
export const MAX_SHORTLISTS = 60;
export function makeShortlist(p: Omit<Shortlist, 'id' | 'savedAt' | 'formulaVersion' | 'rows'>, rows: readonly ScreenRow[], cols: readonly string[]): Shortlist {
  return {
    ...p, id: `sl-${Date.now().toString(36)}`, savedAt: new Date().toISOString(), formulaVersion: FORMULA_VERSION,
    rows: rows.slice(0, 1000).map((r) => ({ t: r.t, n: r.n, v: Object.fromEntries(cols.map((k) => [k, typeof r[k as NumKey] === 'number' ? (r[k as NumKey] as number) : null])) })),
  };
}
export function cleanShortlists(raw: unknown): Shortlist[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s: any) => s && typeof s.id === 'string' && Array.isArray(s.rows) && Array.isArray(s.filters) && (s.market === 'US' || s.market === 'IN')).slice(-MAX_SHORTLISTS);
}

const PRICE_KEYS = /^(px|chg|chgOpen|chg1W|perf|vol|avgVol|hi52|sma|ema|rsi|atrP|adrP|mc|pe|ps|evRev|pcf)/;
export interface ChangeLine { t: string; n: string; kind: 'entered' | 'exited'; why: string }
/** What changed between a saved shortlist and the same filters on today's snapshot, and the likely cause of each change. */
export function diffShortlist(sl: Shortlist, nowRows: readonly ScreenRow[], nowMatches: readonly ScreenRow[], market: ScreenMarket, now = new Date()): { entered: ChangeLine[]; exited: ChangeLine[]; stayed: number; formulaChanged: string[] } {
  const was = new Map(sl.rows.map((r) => [r.t, r]));
  const isNow = new Set(nowMatches.map((r) => r.t));
  const allNow = new Map(nowRows.map((r) => [r.t, r]));
  const formulaChanged = changesSince(sl.formulaVersion);
  const cause = (old: Record<string, number | null> | undefined, cur: ScreenRow, failed: Filter[]): string => {
    const keys = Array.from(new Set(failed.flatMap(filterKeys)));
    const moved = keys.filter((k) => old && old[k] !== undefined && old[k] !== (cur[k as NumKey] ?? null));
    if (moved.length) {
      const price = moved.filter((k) => PRICE_KEYS.test(k));
      const fig = moved.filter((k) => !PRICE_KEYS.test(k));
      const parts: string[] = [];
      if (price.length) parts.push(`price movement (${price.map((k) => `${fieldOf(k)?.label || k} ${exact(old![k])} → ${exact(cur[k as NumKey] as number)}`).join('; ')})`);
      if (fig.length) parts.push(`new or corrected figures (${fig.map((k) => `${fieldOf(k)?.label || k} ${exact(old![k])} → ${exact(cur[k as NumKey] as number)}`).join('; ')})`);
      return parts.join(' and ');
    }
    if (formulaChanged.length) return 'a formula change (see the list of changes)';
    return keys.length ? `${keys.map((k) => fieldOf(k)?.label || k).join(', ')} not saved in the old shortlist — cause not known` : 'cause not known';
  };
  const exited: ChangeLine[] = [];
  for (const r of sl.rows) {
    if (isNow.has(r.t)) continue;
    const cur = allNow.get(r.t);
    if (!cur) { exited.push({ t: r.t, n: r.n, kind: 'exited', why: 'no longer in the snapshot (delisted, renamed or below the size floor)' }); continue; }
    const failed = sl.filters.filter((f) => !passes(cur, f, now, sl.exactOnly));
    exited.push({ t: r.t, n: r.n, kind: 'exited', why: `now fails ${failed.map((f) => filterLabel(f, market)).join(', ') || 'a filter'} — ${cause(r.v, cur, failed)}` });
  }
  const entered: ChangeLine[] = [];
  for (const cur of nowMatches) {
    if (was.has(cur.t)) continue;
    entered.push({ t: cur.t, n: cur.n, kind: 'entered', why: 'was not in the saved result — it now passes every filter (price movement, a new filing or a corrected figure)' });
  }
  return { entered, exited, stayed: sl.rows.filter((r) => isNow.has(r.t)).length, formulaChanged };
}

// ── formula impact (per saved screen, remembered per browser) ──────────────────────────────────────────────────────────
export const SCREEN_RUNS_KEY = 'mc:screen-runs:v1';
export interface ScreenRun { v: string; at: string; tickers: string[] }
/** Compare this run with the last one remembered for the screen. Only says something when the formula version changed. */
export function formulaImpact(prev: ScreenRun | undefined, tickers: readonly string[]): { changed: boolean; added: string[]; removed: string[]; notes: string[] } | null {
  if (!prev || prev.v === FORMULA_VERSION) return null;
  const a = new Set(prev.tickers), b = new Set(tickers);
  return { changed: true, added: tickers.filter((t) => !a.has(t)), removed: prev.tickers.filter((t) => !b.has(t)), notes: changesSince(prev.v) };
}
