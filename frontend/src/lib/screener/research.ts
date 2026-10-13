// zzz969 — screener decision-accuracy helpers (pure; used by the page and the tests):
//   · applicability — a figure that does not mean anything for a kind of company (a bank's gross margin) is "not applicable",
//     which is different from "not known";
//   · exact explanations — every filter on one company, with the unrounded value against the rule (9.0% shown can be 8.96%);
//   · close-confirmed view — the price figures of the last COMPLETED session when the snapshot was read during trading;
//   · stable order — rows keep their place when new data arrives until the owner re-sorts;
//   · shortlists — a saved result (tickers, filters, figures, snapshot time, formula version) and what changed since;
//   · formula version — when a calculation changes, the page can say which saved screens moved and why.
import type { ScreenRow, ScreenMarket } from './types';
import { fieldOf, passes, filterKeys, filterLabel, evalPattern, patMissingWhy, tagDirDist, type Filter, type NumKey, type PatternRule } from './filters';
import { PATTERN_META } from '../chart-patterns';
import { tvSectorMapping } from './tv-sectors';

// ── formula version ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Bump with a line in FORMULA_CHANGES whenever a figure is worked out differently. */
export const FORMULA_VERSION = '2026.10.12e';
export const FORMULA_CHANGES: ReadonlyArray<{ v: string; what: string }> = [
  { v: '2026.10.12e', what: 'Stage Analysis (TheWrap method) added as figures — our own version that follows the published rules: stage 1–4 on weekly bars, SATA score 0–10, Mansfield RS against the S&P 500 / Nifty 50, weeks in stage. Existing figures unchanged; every company is re-scanned as its prices are re-read.' },
  { v: '2026.10.12d', what: 'Your TradingView Pine Screener setups added as figures (trend template, RSI vs its average, MA crosses, RS Rating, Weinstein stage, pocket pivots, relative volume, traded value, Ripster clouds) and FCF margin + Rule of 40 (FCF margin ≈ latest full year). Existing figures unchanged; every company is re-scanned as its prices are re-read.' },
  { v: '2026.10.12c', what: 'Chart patterns (Pine Screener) read from the same daily bars as the price figures: 21 bullish / bearish patterns with stage, likelihood, pivot and distance, as of the last bar date. Screen filters themselves are unchanged.' },
  { v: '2026.10.12b', what: 'Completed-sessions mode re-works market cap, P/E, P/S, price ÷ cash and EV / revenue at the closing price (they used the live price); India "Other Construction Materials" mapped to Non-Energy Minerals, four companies checked one by one.' },
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
/** Figures that move one-for-one with the price while shares outstanding stay the same (market cap = shares × price). */
const PRICE_PROPORTIONAL = ['mc', 'ps', 'pe', 'pcf'] as const;
const r2 = (v: number) => Math.round(v * 100) / 100;
/**
 * The row as of the last completed session (only rows read during trading carry `cc`).
 * zzz974 (audit N-02): the technical figures came from the close, but market cap and the valuation ratios kept the LIVE price —
 * a price rule and a valuation rule then judged two different prices. Now, when the closing price differs, market cap, P/E, P/S
 * and price ÷ cash are re-worked at the close (same shares), and EV / revenue moves by exactly the market-cap change over
 * revenue (debt and cash do not change with the price). When the two prices are too far apart to be one share count
 * (a split or a bad quote: ratio outside 0.5–2) those figures are dropped — unknown, so they fail a filter — instead of guessed.
 */
export function closeConfirmed(r: ScreenRow): ScreenRow {
  if (!r.cc) return r;
  const out: ScreenRow = { ...r, ...(r.cc as Partial<ScreenRow>) };
  const p0 = r.px, p1 = (r.cc as any).px;
  if (typeof p1 !== 'number' || p1 === p0) return out;
  const k = typeof p0 === 'number' && p0 > 0 && p1 > 0 ? p1 / p0 : NaN;
  const o = out as any, src = r as any;
  if (!(k >= 0.5 && k <= 2)) {
    for (const key of [...PRICE_PROPORTIONAL, 'evRev']) if (o[key] != null) o[key] = null;
    out.ccBasis = 'unavailable';
    return out;
  }
  for (const key of PRICE_PROPORTIONAL) if (typeof src[key] === 'number') o[key] = key === 'mc' ? Math.round(src[key] * k * 10) / 10 : r2(src[key] * k);
  // EV / revenue = (cap + debt − cash) / revenue → it changes by (cap change) / revenue = the change in P/S
  if (typeof src.evRev === 'number') o.evRev = typeof src.ps === 'number' && typeof o.ps === 'number' ? r2(src.evRev + (o.ps - src.ps)) : null;
  out.ccBasis = 'scaled';
  return out;
}

// ── exact explanation ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface RuleCheck { label: string; pass: boolean; detail: string; nearMiss: boolean }
const OPW: Record<string, string> = { gt: 'greater than', ge: 'at least', lt: 'less than', le: 'at most', above: 'above', below: 'below' };
export function exact(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'not known';
  const a = Math.abs(v);
  return a >= 1e6 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(v * 10_000) / 10_000);
}
/** zzz994 — a pattern rule on one company: the matching patterns (with timeframe, stage, score, distance) or why it fails /
 *  cannot be evaluated (a timeframe not scanned, too little history, an outdated scan). */
export function patternDetail(r: ScreenRow, f: PatternRule): string {
  const e = evalPattern(r, f);
  const miss = e.missingTfs.map((tf) => patMissingWhy(r, tf));
  if (!f.stages.length) return 'no stage selected — this rule matches nothing until a stage is chosen';
  if (e.status === 'pass') {
    const tags = e.tags.slice().sort((a, b) => b.c - a.c).slice(0, 4).map((t) => {
      const d = tagDirDist(t);
      return `${PATTERN_META[t.id]?.label || t.id} [${t.tf || 'D'}] score ${t.c}${d != null ? `, ${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}% to pivot` : ''}`;
    });
    return `matches: ${tags.join('; ')}${miss.length ? ` · not evaluated: ${miss.join('; ')}` : ''}`;
  }
  if (e.status === 'missing') return `cannot be evaluated — ${miss.join('; ')} (counted as not passing)`;
  return `no pattern matches on ${(f.tfs?.length ? f.tfs : ['D']).join(f.tfMode === 'all' ? ' + ' : '/')}${miss.length ? ` · not evaluated: ${miss.join('; ')}` : ''}`;
}
/** Every filter on one company: passed or not, the unrounded value against the rule, and a note when the miss is only visible unrounded. */
export function explainRow(r: ScreenRow, filters: readonly Filter[], market: ScreenMarket, now = new Date(), exactOnly = false): RuleCheck[] {
  return filters.map((f) => {
    const pass = passes(r, f, now, exactOnly);
    const label = filterLabel(f, market);
    if (f.off) return { label: `${label} (paused)`, pass: true, detail: 'paused — not applied until you turn it back on', nearMiss: false };
    if (f.kind === 'sector') {
      const m = tvSectorMapping(market, r.sec, r.ind, r.t);
      return { label, pass, detail: `sector: ${r.tvSec || r.sec || 'not known'} — ${m.note}; source: ${[r.sec, r.ind].filter(Boolean).join(' · ') || 'none'}`, nearMiss: false };
    }
    if (f.kind === 'exch') return { label, pass, detail: `exchange: ${(r.exch || []).join(' / ') || 'not known'}`, nearMiss: false };
    if (f.kind === 'pattern') return { label, pass, detail: patternDetail(r, f), nearMiss: false };   // zzz994
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
  /** figures for the first DETAIL_LIMIT companies (older shortlists: the only record) */
  rows: Array<{ t: string; n: string; v: Record<string, number | null> }>;
  /** zzz974 (audit N-03) — EVERY company of the result, so a big result is compared like for like. Absent on older shortlists. */
  all?: string[];
  total?: number;
  sort?: { key: string; dir: 1 | -1 };
}
export const DETAIL_LIMIT = 1000;
/** The full membership of a shortlist, and whether it is complete (an old shortlist of exactly 1,000 may have been cut). */
export function membership(sl: Shortlist): { tickers: string[]; complete: boolean } {
  if (Array.isArray(sl.all) && sl.all.length) return { tickers: sl.all, complete: true };
  const t = sl.rows.map((r) => r.t);
  return { tickers: t, complete: t.length < DETAIL_LIMIT };
}
export const MAX_SHORTLISTS = 60;
export function makeShortlist(p: Omit<Shortlist, 'id' | 'savedAt' | 'formulaVersion' | 'rows' | 'all' | 'total'>, rows: readonly ScreenRow[], cols: readonly string[]): Shortlist {
  // the price is always kept, so a later change in a valuation ratio can be told apart from a change in the price
  const keep = Array.from(new Set(['px', 'mc', ...cols]));
  return {
    ...p, id: `sl-${Date.now().toString(36)}`, savedAt: new Date().toISOString(), formulaVersion: FORMULA_VERSION,
    rows: rows.slice(0, DETAIL_LIMIT).map((r) => ({ t: r.t, n: r.n, v: Object.fromEntries(keep.map((k) => [k, typeof r[k as NumKey] === 'number' ? (r[k as NumKey] as number) : null])) })),
    all: rows.map((r) => r.t), total: rows.length,
  };
}
export function cleanShortlists(raw: unknown): Shortlist[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s: any) => s && typeof s.id === 'string' && Array.isArray(s.rows) && Array.isArray(s.filters) && (s.market === 'US' || s.market === 'IN'))
    .map((s: any) => (s.all !== undefined && !(Array.isArray(s.all) && s.all.every((x: unknown) => typeof x === 'string')) ? { ...s, all: undefined } : s))
    .slice(-MAX_SHORTLISTS);
}

const PRICE_KEYS = /^(px|chg|chgOpen|chg1W|perf|vol|avgVol|hi52|sma|ema|rsi|atrP|adrP)/;
/** Ratios with the price on top: they change when the price OR the figure underneath (earnings, sales, cash) changes. */
const PRICE_RATIOS = new Set(['mc', 'pe', 'ps', 'evRev', 'pcf']);
export interface ChangeLine { t: string; n: string; kind: 'entered' | 'exited'; why: string }

/** zzz974 (audit N-04) — a valuation ratio's change is only called price movement when the saved and current prices explain it. */
export function ratioCause(key: string, oldV: number | null, newV: number | null, oldPx: number | null | undefined, newPx: number | null | undefined): string {
  const name = fieldOf(key as NumKey)?.label || key;
  const vals = `${name} ${exact(oldV)} → ${exact(newV)}`;
  if (typeof oldV !== 'number' || typeof newV !== 'number' || oldV === 0) return `${vals} — cause not established`;
  if (typeof oldPx !== 'number' || typeof newPx !== 'number' || oldPx <= 0) return `${vals} — valuation ratio changed; price not saved then, so the cause is not established`;
  const pxMove = newPx / oldPx, ratioMove = newV / oldV;
  if (key === 'evRev') {
    // debt and cash sit in EV too: only say "price" when the price moved and the ratio moved the same way
    return pxMove === 1 ? `${vals} — valuation ratio changed with the price unchanged (new revenue, debt or cash figures)`
      : `${vals} — price ${exact(oldPx)} → ${exact(newPx)}; revenue, debt or cash may also have changed (not separated)`;
  }
  if (Math.abs(ratioMove - pxMove) <= 0.02 * Math.max(1, Math.abs(pxMove))) return `${vals} — price movement (${exact(oldPx)} → ${exact(newPx)})`;
  if (pxMove === 1) return `${vals} — valuation ratio changed with the price unchanged (new ${key === 'pe' ? 'earnings' : key === 'ps' ? 'sales' : key === 'pcf' ? 'cash' : 'share-count'} figures)`;
  return `${vals} — price ${exact(oldPx)} → ${exact(newPx)} and the ${key === 'pe' ? 'earnings' : key === 'ps' ? 'sales' : key === 'pcf' ? 'cash' : 'share-count'} figure both changed (mixed)`;
}

/** What changed between a saved shortlist and the same filters on today's snapshot, and — only where the saved figures show it — why. */
export function diffShortlist(sl: Shortlist, nowRows: readonly ScreenRow[], nowMatches: readonly ScreenRow[], market: ScreenMarket, now = new Date()): { entered: ChangeLine[]; exited: ChangeLine[]; stayed: number; formulaChanged: string[]; complete: boolean; savedTotal: number } {
  const mem = membership(sl);
  const was = new Set(mem.tickers);
  const detail = new Map(sl.rows.map((r) => [r.t, r]));
  const isNow = new Set(nowMatches.map((r) => r.t));
  const allNow = new Map(nowRows.map((r) => [r.t, r]));
  const formulaChanged = changesSince(sl.formulaVersion);
  const cause = (old: Record<string, number | null> | undefined, cur: ScreenRow, failed: Filter[]): string => {
    const keys = Array.from(new Set(failed.flatMap(filterKeys)));
    const moved = keys.filter((k) => old && old[k] !== undefined && old[k] !== (cur[k as NumKey] ?? null));
    if (moved.length) {
      const parts: string[] = [];
      const price = moved.filter((k) => PRICE_KEYS.test(k) && !PRICE_RATIOS.has(k));
      const ratios = moved.filter((k) => PRICE_RATIOS.has(k));
      const fig = moved.filter((k) => !PRICE_KEYS.test(k) && !PRICE_RATIOS.has(k));
      if (price.length) parts.push(`price movement (${price.map((k) => `${fieldOf(k as NumKey)?.label || k} ${exact(old![k])} → ${exact(cur[k as NumKey] as number)}`).join('; ')})`);
      for (const k of ratios) parts.push(ratioCause(k, old![k], (cur[k as NumKey] as number) ?? null, old!.px, cur.px));
      if (fig.length) parts.push(`new or corrected figures (${fig.map((k) => `${fieldOf(k as NumKey)?.label || k} ${exact(old![k])} → ${exact(cur[k as NumKey] as number)}`).join('; ')})`);
      return parts.join(' and ');
    }
    if (formulaChanged.length) return 'a formula change may be the cause (see the list of changes) — not proven';
    return keys.length ? `${keys.map((k) => fieldOf(k)?.label || k).join(', ')} not saved in the old shortlist — cause not established` : 'cause not established';
  };
  const exited: ChangeLine[] = [];
  for (const t of mem.tickers) {
    if (isNow.has(t)) continue;
    const saved = detail.get(t);
    const cur = allNow.get(t);
    const n = saved?.n || cur?.n || '';
    if (!cur) { exited.push({ t, n, kind: 'exited', why: 'no longer in the snapshot (delisted, renamed or below the size floor)' }); continue; }
    const failed = sl.filters.filter((f) => !passes(cur, f, now, sl.exactOnly));
    exited.push({ t, n, kind: 'exited', why: `now fails ${failed.map((f) => filterLabel(f, market)).join(', ') || 'a filter'} — ${saved ? cause(saved.v, cur, failed) : 'its figures were not kept (beyond the first 1,000) — cause not established'}` });
  }
  const entered: ChangeLine[] = [];
  if (mem.complete) {
    for (const cur of nowMatches) {
      if (was.has(cur.t)) continue;
      entered.push({ t: cur.t, n: cur.n, kind: 'entered', why: 'not in the saved result; now passes every filter — its figures were not saved then, so the cause is not established' });
    }
  }
  return { entered, exited, stayed: mem.tickers.filter((t) => isNow.has(t)).length, formulaChanged, complete: mem.complete, savedTotal: sl.total ?? mem.tickers.length };
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
