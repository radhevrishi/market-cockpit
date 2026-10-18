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

/** zzz1077 — ticker → D/E for a list of tickers (any length: asked in chunks of 300). Unknown tickers stay absent ("—"). */
export function useDebtEquityIndex(tickers: ReadonlyArray<string | undefined | null>, market: 'IN' | 'US'): DeIndex {
  const [idx, setIdx] = useState<DeIndex>({});
  const key = useMemo(() => Array.from(new Set(tickers.map((t) => tick(t)).filter(Boolean))).sort().join(','), [tickers]);
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const all = key.split(',');
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
    Promise.all(chunks.map((c) => fetch(`/api/v1/stock-screener?market=${market}&tickers=${encodeURIComponent(c.join(','))}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j && Array.isArray(j.rows) ? deIndex(j.rows) : {})).catch(() => ({}))))
      .then((parts) => { if (!ctrl.signal.aborted) setIdx(Object.assign({}, ...parts)); });
    return () => ctrl.abort();
  }, [key, market]);
  return idx;
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
