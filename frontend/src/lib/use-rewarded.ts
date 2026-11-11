'use client';
// zzz1262 — "already rewarded" (lib/rewarded.ts) for any list of tickers on a page. The 3-month and 1-year price moves
// come from our own stock-screener snapshot (slim `?tickers=` answer), asked once per ticker per browser session.
// A name with no 3-month figure is UNKNOWN (null), never treated as "not rewarded". Buy lists use `demoteRewarded` to put
// rewarded names last — demoted with the reason shown, never hidden.
import { useEffect, useMemo, useState } from 'react';
import { rewardedWhy, type RewardedOut } from './rewarded';

export type RewardedIndex = Record<string, RewardedOut & { p3m: number | null; p1y: number | null; rs?: number | null }>;
type Mkt = 'IN' | 'US';
const CHUNK = 300;
const cache: Record<Mkt, RewardedIndex> = { IN: {}, US: {} };
const asked: Record<Mkt, Set<string>> = { IN: new Set(), US: new Set() };
const listeners = new Set<() => void>();

export const rewardedKey = (t: string | null | undefined): string => String(t || '').toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '').replace(/-(BE|BZ|BL|EQ|SM|T)$/, '');

/** Pure: slim screener rows → index by ticker. */
export function rewardedIndexOf(rows: ReadonlyArray<any> | null | undefined): RewardedIndex {
  const out: RewardedIndex = {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  for (const r of rows || []) {
    const t = rewardedKey(r?.t);
    if (!t) continue;
    const p3m = num(r.perf3M), p1y = num(r.perf1Y), rs = num(r.rs);
    out[t] = { ...rewardedWhy({ p3m, p1y, rs }), p3m, p1y, rs };
  }
  return out;
}

/** Pure, stable: names that are NOT rewarded (or unknown) keep their order and come first; rewarded names follow in their order. */
export function demoteRewarded<T>(list: ReadonlyArray<T>, tickerOf: (x: T) => string | null | undefined, idx: RewardedIndex): T[] {
  const a: T[] = [], b: T[] = [];
  for (const x of list) (idx[rewardedKey(tickerOf(x))]?.rewarded === true ? b : a).push(x);
  return b.length ? [...a, ...b] : (list as T[]);
}

export function useRewardedIndex(tickers: ReadonlyArray<string | null | undefined>, market: Mkt): RewardedIndex {
  const [, setTick] = useState(0);
  const key = useMemo(() => Array.from(new Set(tickers.map(rewardedKey).filter(Boolean))).sort().join(','), [tickers]);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    listeners.add(f);
    const todo = key ? key.split(',').filter((t) => !asked[market].has(t)) : [];
    for (const t of todo) asked[market].add(t);
    for (let i = 0; i < todo.length; i += CHUNK) {
      const c = todo.slice(i, i + CHUNK);
      fetch(`/api/v1/stock-screener?market=${market}&tickers=${encodeURIComponent(c.join(','))}`, { signal: AbortSignal.timeout(25_000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || !Array.isArray(j.rows)) { for (const t of c) asked[market].delete(t); return; }   // ask again next time
          Object.assign(cache[market], rewardedIndexOf(j.rows));
          for (const l of listeners) l();
        })
        .catch(() => { for (const t of c) asked[market].delete(t); });
    }
    return () => { listeners.delete(f); };
  }, [key, market]);
  return cache[market];
}
