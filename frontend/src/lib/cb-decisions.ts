// ═══════════════════════════════════════════════════════════════════════════
// zzz1041 — CONVICTION BEATS MARKS: Bought · Watchlist · Rejected.
//
// The owner marks each Conviction Beats name (India and US). A mark is a row
// in the personal decision logbook (lib/decisions.ts, localStorage
// 'mc:decisions:v1', synced to Postgres by the user vault), so the same mark
// shows on the Decision Logbook, the Multibagger tabs and the Journey page:
//
//   Bought    → decision status BUY
//   Watchlist → decision status WATCH
//   Rejected  → decision status REJECTED
//   (no mark) → no decision; a NEUTRAL decision also reads as unmarked here
//
// Decisions are per symbol AND market (India "ABC", US "US:ABC" — see
// decisionKey), so an India mark never shows on the US page or the reverse.
//
// The rule the page applies (applyCbMarks):
//   • Quality Preset ON  → Rejected names are hidden from the list, the
//     counts and every export; a line says "N rejected hidden · show", and
//     "show" brings them back greyed (still left out of the exports).
//   • Quality Preset OFF → Rejected names stay on the list, greyed, with a
//     "Rejected" badge, and are exported like any shown name.
//   • The mark chips (All · Bought · Watchlist · Rejected · Unmarked) narrow
//     the list AND-wise with every other filter. Choosing "Rejected" shows
//     the rejected names (greyed) even with the preset on.
// The rejection is a layer on top of the criteria check, never part of it:
// "Why N names are hidden" still explains only the criteria.
// ═══════════════════════════════════════════════════════════════════════════

import {
  readDecisions, setDecision, clearDecision, decisionLookup, normalizeDecisionSymbol,
  type Decision, type DecisionMarket, type DecisionStatus,
} from '@/lib/decisions';

export type CbMark = 'bought' | 'watchlist' | 'rejected';
export type CbMarkFilter = 'all' | CbMark | 'unmarked';

export const CB_MARKS: readonly CbMark[] = ['bought', 'watchlist', 'rejected'] as const;
export const CB_MARK_FILTERS: readonly CbMarkFilter[] = ['all', 'bought', 'watchlist', 'rejected', 'unmarked'] as const;

export const CB_MARK_META: Record<CbMark, { label: string; status: DecisionStatus; color: string; icon: string; hint: string }> = {
  bought:    { label: 'Bought',    status: 'BUY',      color: '#10B981', icon: '●', hint: 'You hold it (or have bought it). Kept on the list with a Bought badge.' },
  watchlist: { label: 'Watchlist', status: 'WATCH',    color: '#38BDF8', icon: '◐', hint: 'You are following it. Kept on the list with a Watchlist badge.' },
  rejected:  { label: 'Rejected',  status: 'REJECTED', color: '#EF4444', icon: '✕', hint: 'You looked and passed. Hidden while the Quality Preset is on; greyed when it is off.' },
};

export const CB_MARK_FILTER_LABEL: Record<CbMarkFilter, string> = {
  all: 'All', bought: 'Bought', watchlist: 'Watchlist', rejected: 'Rejected', unmarked: 'Unmarked',
};

/** The mark a logbook decision stands for on Conviction Beats (null = unmarked). */
export function markOfDecision(d: Pick<Decision, 'status'> | null | undefined): CbMark | null {
  if (!d) return null;
  if (d.status === 'BUY') return 'bought';
  if (d.status === 'WATCH') return 'watchlist';
  if (d.status === 'REJECTED') return 'rejected';
  return null;
}

/** The ticker a Conviction Beats row is marked under (archived "ABC@Q2-2026" → "ABC"). */
export function cbMarkSymbol(ticker: unknown): string {
  return normalizeDecisionSymbol(String(ticker ?? ''));
}

/** A lookup from a decisions map for one market — pure, so the page reads the map once per render. */
export function cbMarkReader(map: Record<string, Decision> | null | undefined, market: DecisionMarket): (ticker: unknown) => { mark: CbMark | null; decision: Decision | undefined } {
  return (ticker) => {
    const d = decisionLookup(map || {}, cbMarkSymbol(ticker), market);
    return { mark: markOfDecision(d), decision: d };
  };
}

/** Read this market's marks straight from the logbook. */
export function readCbMark(ticker: string, market: DecisionMarket): { mark: CbMark | null; decision: Decision | undefined } {
  return cbMarkReader(readDecisions(), market)(ticker);
}

export interface CbMarkContext {
  company?: string | null;
  price?: number | null;
  score?: number | null;
  grade?: string | null;
}

/**
 * Set the mark (or clear it with null). Changing the mark re-stamps the date
 * and the price; the note and the bull / bear / change-mind text are kept.
 */
export function setCbMark(ticker: string, market: DecisionMarket, mark: CbMark | null, ctx: CbMarkContext = {}): Decision | null {
  const sym = cbMarkSymbol(ticker);
  if (!sym) return null;
  if (mark == null) { clearDecision(sym, market); return null; }
  const prev = decisionLookup(readDecisions(), sym, market);
  const price = typeof ctx.price === 'number' && Number.isFinite(ctx.price) && ctx.price > 0 ? ctx.price : undefined;
  return setDecision({
    ...(prev || {}),
    symbol: sym,
    market,
    status: CB_MARK_META[mark].status,
    reason: prev?.reason ?? '',
    company: (ctx.company && String(ctx.company)) || prev?.company,
    priceAtDecision: price ?? (prev && markOfDecision(prev) === mark ? prev.priceAtDecision : undefined),
    scoreAtDecision: typeof ctx.score === 'number' && Number.isFinite(ctx.score) ? ctx.score : prev?.scoreAtDecision,
    gradeAtDecision: ctx.grade || prev?.gradeAtDecision,
    date: undefined,
  });
}

/** Clicking the active mark clears it; clicking another one sets that. */
export function toggleCbMark(ticker: string, market: DecisionMarket, mark: CbMark, ctx: CbMarkContext = {}): Decision | null {
  const cur = readCbMark(ticker, market).mark;
  return setCbMark(ticker, market, cur === mark ? null : mark, ctx);
}

/** Save the one-line note on an existing mark (keeps status, date and price). */
export function setCbMarkNote(ticker: string, market: DecisionMarket, note: string): Decision | null {
  const sym = cbMarkSymbol(ticker);
  const prev = decisionLookup(readDecisions(), sym, market);
  if (!prev) return null;
  return setDecision({ ...prev, symbol: sym, market, reason: String(note || '').slice(0, 500), date: prev.date });
}

/**
 * After marking a name whose row carries no price (India), look the price up
 * once and put it on the mark — only if the mark is still the one just made
 * (same date). Never throws; a failed lookup leaves the mark without a price.
 */
let _inPrices: { at: number; p: Promise<Record<string, number>> } | null = null;
function indiaPrices(): Promise<Record<string, number>> {
  if (_inPrices && Date.now() - _inPrices.at < 10 * 60_000) return _inPrices.p;
  const p = (async () => {
    try {
      const r = await fetch('/api/market/quotes?market=india&fields=ticker,symbol,price', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return {};
      const j = await r.json();
      const m: Record<string, number> = {};
      for (const s of (j?.stocks || [])) {
        const t = normalizeDecisionSymbol(String(s?.ticker || s?.symbol || ''));
        const px = Number(s?.price);
        if (t && Number.isFinite(px) && px > 0) m[t] = px;
      }
      return m;
    } catch { return {}; }
  })();
  _inPrices = { at: Date.now(), p };
  return p;
}
export async function attachCbMarkPrice(ticker: string, market: DecisionMarket, date: string): Promise<void> {
  if (market !== 'IN' || typeof window === 'undefined') return;
  const sym = cbMarkSymbol(ticker);
  const px = (await indiaPrices())[sym];
  if (!(typeof px === 'number' && px > 0)) return;
  const cur = decisionLookup(readDecisions(), sym, market);
  if (!cur || cur.date !== date || (typeof cur.priceAtDecision === 'number' && cur.priceAtDecision > 0)) return;
  setDecision({ ...cur, priceAtDecision: px, date: cur.date });
}

// ─── The list rule ─────────────────────────────────────────────────────────

export interface CbMarkResult<E> {
  /** Rows to show, in input order. */
  visible: E[];
  /** Rows to export / count as the list: `visible`, minus Rejected while the preset is on. */
  exportRows: E[];
  /** Rejected rows the preset is hiding right now (0 when they are shown). */
  rejectedHidden: E[];
  /** Rejected rows on the list before the mark rule (for the "show" line and the chip). */
  rejectedTotal: number;
  /** Count per mark chip, over the input rows (before the mark chip narrows them). */
  counts: Record<CbMarkFilter, number>;
}

/** Apply the mark rule to rows that already passed every other filter. */
export function applyCbMarks<E>(rows: readonly E[], opts: {
  markOf: (e: E) => CbMark | null;
  presetOn: boolean;
  showRejected: boolean;
  filter: CbMarkFilter;
}): CbMarkResult<E> {
  const counts: Record<CbMarkFilter, number> = { all: 0, bought: 0, watchlist: 0, rejected: 0, unmarked: 0 };
  const marks = rows.map((e) => opts.markOf(e));
  for (const m of marks) { counts[m ?? 'unmarked']++; }
  // "All" counts what the list would show under the preset rule.
  counts.all = opts.presetOn && !opts.showRejected ? rows.length - counts.rejected : rows.length;
  const visible: E[] = [];
  const rejectedHidden: E[] = [];
  rows.forEach((e, i) => {
    const m = marks[i];
    if (opts.filter === 'all') {
      if (m === 'rejected' && opts.presetOn && !opts.showRejected) { rejectedHidden.push(e); return; }
      visible.push(e);
      return;
    }
    if (opts.filter === 'unmarked' ? m == null : m === opts.filter) visible.push(e);
  });
  const exportRows = opts.presetOn ? visible.filter((e) => opts.markOf(e) !== 'rejected') : visible;
  return { visible, exportRows, rejectedHidden, rejectedTotal: counts.rejected, counts };
}

/** "marked 15 Oct · at ₹1,234" (or "$12.30" for US). */
export function cbMarkStamp(d: Pick<Decision, 'date' | 'priceAtDecision'> | null | undefined, market: DecisionMarket): string {
  if (!d) return '';
  const t = Date.parse(String(d.date || ''));
  const when = Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
    : '';
  const p = d.priceAtDecision;
  const at = typeof p === 'number' && Number.isFinite(p) && p > 0
    ? (market === 'US'
      ? `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₹${p.toLocaleString('en-IN', { maximumFractionDigits: p >= 100 ? 0 : 2 })}`)
    : '';
  return ['marked', when, at ? `· at ${at}` : ''].filter(Boolean).join(' ').replace('marked ·', 'marked');
}

/** The "N rejected hidden" line. */
export function rejectedHiddenLine(n: number, showing: boolean): string {
  if (showing) return `${n} rejected shown greyed · hide`;
  return `${n} rejected hidden · show`;
}
