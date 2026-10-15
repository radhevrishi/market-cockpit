// zzz1054 — turning an alert's target into the tickers it watches right now (pure; the server reads the lists, this file
// only interprets them). A list alert follows the list's CURRENT members: members added later are watched from their next
// check, removed members stop being checked.
//
// Sources (the owner's saved data, Postgres user_state, values stored as {__raw, parsed} by the browser sync):
//   chart-list — mc:chart-watchlists:v1 (lists → sections → items {m, t, x})
//   watchlist  — mc_watchlist_tickers (the /watchlists list; India tickers)
//   book-in    — mc_portfolio_holdings (India book; [{symbol}])
//   book-us    — the US Portfolio Book holdings (symbols)
//   cb-in / cb-us — mc:conviction-beats:v1 / mc:conviction-beats-us:v1 (maps of {ticker})
import { toMid, parseMid, targetKindLabel, type AlertTarget } from './types';

export interface TargetSources {
  chartStore?: unknown;
  watchlist?: unknown;
  holdingsIn?: unknown;
  usBook?: readonly string[] | null;
  cbIn?: unknown;
  cbUs?: unknown;
}
export interface Expanded { mids: string[]; label: string; error?: string }

export const MAX_TICKERS_PER_ALERT = 1000;

/** Unwraps a value saved by the browser sync ({__raw: string} / {parsed}) or returns it as is. */
export function unwrapStored(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as any;
    if (o.parsed !== undefined) return o.parsed;
    if (typeof o.__raw === 'string') { try { return JSON.parse(o.__raw); } catch { return null; } }
  }
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

function uniq(mids: Array<string | null>): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const m of mids) { if (m && !seen.has(m)) { seen.add(m); out.push(m); if (out.length >= MAX_TICKERS_PER_ALERT) break; } }
  return out;
}
const tickerOf = (x: any): string => (typeof x === 'string' ? x : String(x?.ticker || x?.symbol || x?.t || ''));
const listTickers = (v: unknown): string[] => {
  const u = unwrapStored(v);
  if (Array.isArray(u)) return u.map(tickerOf);
  if (u && typeof u === 'object') return Object.entries(u as Record<string, any>).map(([k, e]) => (e && typeof e === 'object' && e.ticker ? String(e.ticker) : k));
  return [];
};

export function expandTarget(t: AlertTarget, src: TargetSources): Expanded {
  switch (t.kind) {
    case 'ticker': {
      const p = parseMid(t.id);
      return p ? { mids: [p.bse ? `IN:BSE:${p.ticker}` : `${p.market}:${p.ticker}`], label: t.label || p.ticker } : { mids: [], label: t.label || '?', error: 'invalid ticker' };
    }
    case 'chart-list': {
      const store: any = unwrapStored(src.chartStore);
      const list = Array.isArray(store?.lists) ? store.lists.find((l: any) => l && l.id === t.id) : null;
      if (!list) return { mids: [], label: t.label || 'chart watchlist', error: 'the chart watchlist was deleted or is not on the server yet' };
      const mids: Array<string | null> = [];
      for (const s of Array.isArray(list.sections) ? list.sections : []) {
        for (const it of Array.isArray(s?.items) ? s.items : []) {
          if (it?.m === 'IN' || it?.m === 'US') mids.push(toMid(it.m, String(it.t || ''), it.x));
        }
      }
      return { mids: uniq(mids), label: String(list.name || t.label || 'chart watchlist').slice(0, 60) };
    }
    case 'watchlist': return { mids: uniq(listTickers(src.watchlist).map((x) => toMid('IN', x))), label: 'My Watchlist' };
    case 'book-in': return { mids: uniq(listTickers(src.holdingsIn).map((x) => toMid('IN', x))), label: targetKindLabel('book-in') };
    case 'book-us':
      if (!src.usBook) return { mids: [], label: targetKindLabel('book-us'), error: 'the US book could not be read' };
      return { mids: uniq(src.usBook.map((x) => toMid('US', x))), label: targetKindLabel('book-us') };
    case 'cb-in': return { mids: uniq(listTickers(src.cbIn).map((x) => toMid('IN', x))), label: targetKindLabel('cb-in') };
    case 'cb-us': return { mids: uniq(listTickers(src.cbUs).map((x) => toMid('US', x))), label: targetKindLabel('cb-us') };
  }
  return { mids: [], label: '?', error: 'unknown target' };
}

/** Which saved-data sources a set of targets needs (so the checker reads only those). */
export function sourcesNeeded(targets: readonly AlertTarget[]): Set<keyof TargetSources> {
  const s = new Set<keyof TargetSources>();
  for (const t of targets) {
    if (t.kind === 'chart-list') s.add('chartStore');
    else if (t.kind === 'watchlist') s.add('watchlist');
    else if (t.kind === 'book-in') s.add('holdingsIn');
    else if (t.kind === 'book-us') s.add('usBook');
    else if (t.kind === 'cb-in') s.add('cbIn');
    else if (t.kind === 'cb-us') s.add('cbUs');
  }
  return s;
}
