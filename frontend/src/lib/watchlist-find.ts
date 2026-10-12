// zzz972 — Watchlists page search box, pure logic (no window, no React).
//
// 1. findInList: the search box also narrows the rows already in the list
//    (by ticker or company name; NSE:/BSE:/BOM: prefixes and .NS/.BO suffixes
//    are ignored). Empty box = every row. A bulk paste (commas / new lines)
//    is an add, not a find, so it narrows nothing.
// 2. buildMembershipIndex / membershipsFor: before adding a company, show
//    every list that already holds it (site watchlist, each chart-side list,
//    the India book, Conviction Beats). Read-only.
//
// Exchange rule: a listing stored with an explicit BSE marker (BSE:/BOM:
// prefix, .BO/.BSE suffix, chart item x === 'BSE') is kept apart from the
// NSE one — NSE:TATVA and BSE:TATVA are different listings. Anything else
// (NSE:, .NS, bare, US) shares the main key, so a bare symbol matches NSE.
// Tickers go through the canonical normaliser in ticker-normalize.ts.

import { canonicalTicker } from './ticker-normalize';

const BSE_RE = /^(BSE|BOM):|\.(BO|BSE)$/i;

/** Lookup key for one stored/typed ticker. '' when nothing usable. */
export function listingKey(raw: string | null | undefined, explicitBse = false): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  const c = canonicalTicker(s);
  if (!c) return '';
  return explicitBse || BSE_RE.test(s) ? `BSE:${c}` : c;
}

export function isBulkQuery(q: string): boolean {
  return /[,\n;]/.test(q);
}

/** Rows of the list that match the typed text. Empty / bulk text returns every row (same array order). */
export function findInList<T extends { ticker: string; company?: string | null }>(rows: T[], query: string | null | undefined): T[] {
  const raw = String(query ?? '').trim();
  if (!raw || isBulkQuery(raw)) return rows;
  const tq = canonicalTicker(raw);
  const nq = raw.toLowerCase().replace(/\s+/g, ' ');
  return rows.filter((r) => {
    const t = canonicalTicker(r.ticker);
    if (tq && t.includes(tq)) return true;
    const name = String(r.company ?? '').toLowerCase().replace(/\s+/g, ' ');
    return !!name && name.includes(nq);
  });
}

export interface MembershipSources {
  /** The site watchlist ('mc_watchlist_tickers'). */
  watchlist?: unknown;
  /** The chart-side store ('mc:chart-watchlists:v1'), as parsed JSON. */
  chartStore?: unknown;
  /** The India book symbols ('mc_portfolio_holdings'). */
  portfolio?: unknown;
  /** Conviction Beats tickers. */
  conviction?: Iterable<string> | null;
}

export type MembershipIndex = Map<string, string[]>;

function add(idx: MembershipIndex, key: string, label: string) {
  if (!key) return;
  const cur = idx.get(key);
  if (!cur) idx.set(key, [label]);
  else if (!cur.includes(label)) cur.push(label);
}

function tickersOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => (typeof x === 'string' ? x : (x?.ticker ?? x?.symbol ?? ''))).filter((x) => typeof x === 'string' && x);
}

/** One map from listing key to the names of the lists that hold it. Never throws. */
export function buildMembershipIndex(src: MembershipSources): MembershipIndex {
  const idx: MembershipIndex = new Map();
  try { for (const t of tickersOf(src.watchlist)) add(idx, listingKey(t), 'Watchlist'); } catch { /* bad shape */ }
  try {
    const lists: any[] = Array.isArray((src.chartStore as any)?.lists) ? (src.chartStore as any).lists : [];
    for (const l of lists) {
      const name = typeof l?.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 60) : 'Watchlist';
      const label = `Chart list '${name}'`;
      for (const s of Array.isArray(l?.sections) ? l.sections : []) {
        for (const it of Array.isArray(s?.items) ? s.items : []) {
          if (!it || typeof it.t !== 'string') continue;
          add(idx, listingKey(it.t, it.m === 'IN' && it.x === 'BSE'), label);
        }
      }
    }
  } catch { /* bad shape */ }
  try {
    const p: any = src.portfolio;
    const syms = Array.isArray(p) ? tickersOf(p) : (p && typeof p === 'object' ? Object.keys(p) : []);
    for (const t of syms) add(idx, listingKey(t), 'Portfolio');
  } catch { /* bad shape */ }
  try { for (const t of src.conviction ?? []) if (typeof t === 'string') add(idx, listingKey(t), 'Conviction Beats'); } catch { /* bad shape */ }
  return idx;
}

/** Lists that already hold this ticker. A bare symbol is the NSE listing. */
export function membershipsFor(idx: MembershipIndex, ticker: string | null | undefined): string[] {
  const k = listingKey(ticker);
  return k ? [...(idx.get(k) ?? [])] : [];
}
