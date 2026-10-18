'use client';
// zzz1068 — debt ÷ equity for the Conviction Beats cards, from the stock-screener snapshot
// (`/api/v1/stock-screener?market=…&tickers=…`, the slim answer: a few KB). The figure is put on
// each entry as `de_ratio` (+ `de_basis`) so the card, the D/E MAX filter, the Table view and the
// Excel export all read the same value. A name the snapshot does not have keeps no value ("—").
import { useEffect, useMemo, useState } from 'react';
import { deIndex } from '@/lib/cb-metric-view';

const tick = (t: unknown) => String(t || '').toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');

export function withDebtEquity<T extends { ticker?: string }>(entries: T[], idx: Record<string, { de: number; basis: string }>): T[] {
  if (!entries.length || !Object.keys(idx).length) return entries;
  return entries.map((e) => {
    const v = idx[tick(e.ticker)];
    return v ? ({ ...e, de_ratio: v.de, de_basis: v.basis } as T) : e;
  });
}

export function useDebtEquityEntries<T extends { ticker?: string }>(entries: T[], market: 'IN' | 'US'): T[] {
  const [idx, setIdx] = useState<Record<string, { de: number; basis: string }>>({});
  const key = useMemo(() => Array.from(new Set(entries.map((e) => tick(e.ticker)).filter(Boolean))).sort().slice(0, 400).join(','), [entries]);
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    fetch(`/api/v1/stock-screener?market=${market}&tickers=${encodeURIComponent(key)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!ctrl.signal.aborted && j && Array.isArray(j.rows)) setIdx(deIndex(j.rows)); })
      .catch(() => { /* D/E stays "—" — never invented */ });
    return () => ctrl.abort();
  }, [key, market]);
  return useMemo(() => withDebtEquity(entries, idx), [entries, idx]);
}
