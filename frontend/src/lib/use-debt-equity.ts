'use client';
// zzz1068 — debt ÷ equity for the Conviction Beats cards, from the stock-screener snapshot
// (`/api/v1/stock-screener?market=…&tickers=…`, the slim answer: a few KB). The figure is put on
// each entry as `de_ratio` (+ `de_basis`) so the card, the D/E MAX filter, the Table view and the
// Excel export all read the same value. A name the snapshot does not have keeps no value ("—").
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { deIndex } from '@/lib/cb-metric-view';

const tick = (t: unknown) => String(t || '').toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');

export function withDebtEquity<T extends { ticker?: string }>(entries: T[], idx: Record<string, { de: number; basis: string }>): T[] {
  if (!entries.length || !Object.keys(idx).length) return entries;
  return entries.map((e) => {
    const v = idx[tick(e.ticker)];
    return v ? ({ ...e, de_ratio: v.de, de_basis: v.basis } as T) : e;
  });
}

export type DeIndex = Record<string, { de: number; basis: string }>;
const CHUNK = 300;   // the slim stock-screener answer takes a few hundred tickers per call

/** zzz1077 — ticker → D/E for a list of tickers (any length: asked in chunks of 300). Unknown tickers stay absent ("—").
 *  zzz1091 — answers are kept for the page's lifetime (module cache) and a request is never cancelled when the list grows
 *  (the window loads a day at a time); `answered` says which tickers the snapshot has been asked about, so a caller can tell
 *  "no D/E for this company" from "not asked yet". */
const _deCache: Record<string, Record<string, { de: number; basis: string }>> = { IN: {}, US: {} };
const _deAsked: Record<string, Set<string>> = { IN: new Set(), US: new Set() };
const _deListeners = new Set<() => void>();
function askDe(market: 'IN' | 'US', list: string[]): void {
  const todo = list.filter((t) => !_deAsked[market].has(t));
  if (!todo.length) return;
  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  for (const c of chunks) {
    const pending = new Set(c);
    fetch(`/api/v1/stock-screener?market=${market}&tickers=${encodeURIComponent(c.join(','))}`, { signal: AbortSignal.timeout(30_000) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j && Array.isArray(j.rows) ? deIndex(j.rows) : null)).catch(() => null)
      .then((part) => {
        if (part) { Object.assign(_deCache[market], part); for (const t of pending) _deAsked[market].add(t); }
        for (const f of _deListeners) f();
      });
  }
}
export function useDebtEquityState(tickers: ReadonlyArray<string | undefined | null>, market: 'IN' | 'US'): { idx: DeIndex; answered: ReadonlySet<string> } {
  const [, setTick] = useState(0);
  const key = useMemo(() => Array.from(new Set(tickers.map((t) => tick(t)).filter(Boolean))).sort().join(','), [tickers]);
  useEffect(() => { const f = () => setTick((x) => x + 1); _deListeners.add(f); return () => { _deListeners.delete(f); }; }, []);
  useEffect(() => { if (key) askDe(market, key.split(',')); }, [key, market]);
  return { idx: _deCache[market], answered: _deAsked[market] };
}
export function useDebtEquityIndex(tickers: ReadonlyArray<string | undefined | null>, market: 'IN' | 'US'): DeIndex {
  const { idx } = useDebtEquityState(tickers, market);
  return useMemo(() => ({ ...idx }), [idx, Object.keys(idx).length]);   // a new object when answers arrive (consumers memo on it)
}

export function useDebtEquityEntries<T extends { ticker?: string }>(entries: T[], market: 'IN' | 'US'): T[] {
  const tickers = useMemo(() => entries.map((e) => e.ticker), [entries]);
  const idx = useDebtEquityIndex(tickers as string[], market);
  return useMemo(() => withDebtEquity(entries, idx), [entries, idx]);
}

/** zzz1077 — the Earnings Opportunities cards (India + USA) read D/E from here; the page provides the index. */
export const DebtEquityContext = createContext<DeIndex>({});
export function useDebtEquityOf(ticker: string | undefined | null): { de: number; basis: string } | null {
  const idx = useContext(DebtEquityContext);
  return idx[tick(ticker)] || null;
}

// ── zzz1089 — figures from the company's own screener.in page for the cards that have none ────────────────────────────────
// (D/E missing from the stock-screener snapshot, or no cash figures for a non-bank). /api/v1/fin-fallback, 20 tickers a call.
export interface FinFallbackEntry { de: number | null; deBasis: string | null; cfo: number | null; pat: number | null; fy: string | null; pending?: boolean; error?: string | null }
export type FinFallbackIndex = Record<string, FinFallbackEntry>;
export const FinFallbackContext = createContext<FinFallbackIndex>({});
export function useFinFallbackOf(ticker: string | undefined | null): FinFallbackEntry | null {
  const idx = useContext(FinFallbackContext);
  return idx[tick(ticker)] || null;
}
const FB_CHUNK = 6;   // zzz1091 — small batches, two at a time, never cancelled
const _fbCache = new Map<string, FinFallbackEntry & { at: number }>();
const _fbInflight = new Set<string>();
const _fbListeners = new Set<() => void>();
function askFallback(list: string[], names?: Readonly<Record<string, string>>): void {
  const now = Date.now();
  const todo = list.filter((t) => !_fbInflight.has(t) && !(_fbCache.has(t) && (!_fbCache.get(t)!.error || now - _fbCache.get(t)!.at < 10 * 60_000)));
  if (!todo.length) return;
  for (const t of todo) _fbInflight.add(t);
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += FB_CHUNK) batches.push(todo.slice(i, i + FB_CHUNK));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const c = batches[next++];
      const nm = c.map((t) => String(names?.[t] || '').replace(/[|,]/g, ' ')).join('|');
      const j = await fetch(`/api/v1/fin-fallback?tickers=${encodeURIComponent(c.join(','))}${nm.replace(/\|/g, '') ? `&names=${encodeURIComponent(nm)}` : ''}`, { signal: AbortSignal.timeout(55_000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      for (const t of c) {
        const v = j?.results?.[t];
        _fbCache.set(t, v && !v.error ? { de: v.de ?? null, deBasis: v.deBasis ?? null, cfo: v.cfo ?? null, pat: v.pat ?? null, fy: v.fy ?? null, at: Date.now() }
          : { de: null, deBasis: null, cfo: null, pat: null, fy: null, error: v?.error || (j ? 'not found' : 'could not be read'), at: Date.now() });
        _fbInflight.delete(t);
      }
      for (const f of _fbListeners) f();
    }
  };
  void Promise.all([worker(), worker()]);
}
/** `tickers` = the India cards that need a fallback (worked out by the page). In-flight entries are marked pending. */
export function useFinFallbackIndex(tickers: ReadonlyArray<string | undefined | null>, names?: Readonly<Record<string, string>>): FinFallbackIndex {
  const [tickN, setTick] = useState(0);
  const key = useMemo(() => Array.from(new Set(tickers.map((t) => tick(t)).filter(Boolean))).sort().join(','), [tickers]);
  useEffect(() => { const f = () => setTick((x) => x + 1); _fbListeners.add(f); return () => { _fbListeners.delete(f); }; }, []);
  useEffect(() => { if (key) askFallback(key.split(','), names); }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const out: FinFallbackIndex = {};
    for (const t of key ? key.split(',') : []) {
      const c = _fbCache.get(t);
      if (c) { const { at: _at, ...rest } = c; void _at; out[t] = rest; }
      else if (_fbInflight.has(t)) out[t] = { de: null, deBasis: null, cfo: null, pat: null, fy: null, pending: true };
    }
    return out;
  }, [key, tickN]);
}
