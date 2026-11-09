'use client';
// zzz1231 — days below the 50 / 200 average + the 3-candle low, for a list of tickers (fundamentals page tables).
import { useEffect, useMemo, useState } from 'react';
import type { MaStreak } from './ma-streak';

const _cache: Record<'IN' | 'US', Record<string, MaStreak>> = { IN: {}, US: {} };
const _asked: Record<'IN' | 'US', Set<string>> = { IN: new Set(), US: new Set() };

export function useMaStreaks(tickers: ReadonlyArray<string | null | undefined>, market: 'IN' | 'US'): Record<string, MaStreak> {
  const [ver, setVer] = useState(0);
  const key = useMemo(() => Array.from(new Set(tickers.map((t) => String(t || '').toUpperCase().replace(/^(NSE|BSE):/, '').trim()).filter(Boolean))).sort().join(','), [tickers]);
  useEffect(() => {
    if (!key) return;
    const todo = key.split(',').filter((t) => !_asked[market].has(t));
    if (!todo.length) return;
    for (const t of todo) _asked[market].add(t);
    let alive = true;
    const chunks: string[][] = [];
    for (let i = 0; i < todo.length; i += 60) chunks.push(todo.slice(i, i + 60));
    for (const c of chunks) {
      fetch(`/api/v1/ma-streak?market=${market}&tickers=${encodeURIComponent(c.join(','))}`, { signal: AbortSignal.timeout(60_000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((j) => {
          if (j?.results) Object.assign(_cache[market], j.results);
          else for (const t of c) _asked[market].delete(t);
          if (alive) setVer((v) => v + 1);
        });
    }
    return () => { alive = false; };
  }, [key, market]);
  return useMemo(() => ({ ..._cache[market] }), [market, ver]);   // eslint-disable-line react-hooks/exhaustive-deps
}
