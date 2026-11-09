'use client';
// zzz1231 — founder-led + moat on the Conviction Beats cards. Only for the names the Quality Preset keeps (`want`):
// stored reads are fetched (free); names with none are sent for an AI read (≤ 10 a call, ≤ 40 a day, server-side).
// Every entry gets `cbfm` when a read exists. One AI request per page per set of names; answers kept for the page's life.
import { useEffect, useMemo, useState } from 'react';
import type { FounderMoat } from './cb-founder-moat';

const tick = (t: unknown) => String(t || '').toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO)$/, '');
const _cache: Record<'IN' | 'US', Record<string, FounderMoat>> = { IN: {}, US: {} };
const _asked: Record<'IN' | 'US', Set<string>> = { IN: new Set(), US: new Set() };

export function useCbFounderMoat<T extends { ticker?: string; company?: string | null; sector?: string | null }>(entries: T[], want: ReadonlyArray<T>, market: 'IN' | 'US'): T[] {
  const [ver, setVer] = useState(0);
  const key = useMemo(() => Array.from(new Set(want.map((e) => tick(e.ticker)).filter(Boolean))).sort().join(','), [want]);
  useEffect(() => {
    if (!key) return;
    const todo = key.split(',').filter((t) => !_asked[market].has(t));
    if (!todo.length) return;
    for (const t of todo) _asked[market].add(t);
    let alive = true;
    (async () => {
      const got = await fetch(`/api/v1/cb-founder-moat?market=${market}&tickers=${encodeURIComponent(todo.join(','))}`, { signal: AbortSignal.timeout(20_000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (got?.results) Object.assign(_cache[market], got.results);
      if (alive) setVer((v) => v + 1);
      const missing = todo.filter((t) => !_cache[market][t]);
      if (!missing.length) return;
      const byT = new Map(want.map((e) => [tick(e.ticker), e]));
      const items = missing.slice(0, 10).map((t) => {
        const e: any = byT.get(t);
        return { ticker: t, company: e?.company ?? null, industry: e?.cbIndustry ?? e?.industry ?? e?.sector ?? null };
      });
      const r = await fetch('/api/v1/cb-founder-moat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market, items }), signal: AbortSignal.timeout(65_000) })
        .then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r?.results) Object.assign(_cache[market], r.results);
      // names not read this time (daily limit / the 10-a-call slice) are asked again on the next visit
      for (const t of missing) if (!_cache[market][t]) _asked[market].delete(t);
      if (alive) setVer((v) => v + 1);
    })();
    return () => { alive = false; };
  }, [key, market]);   // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const c = _cache[market];
    const w = new Set(key ? key.split(',') : []);
    if (!w.size && !Object.keys(c).length) return entries;
    return entries.map((e) => {
      const t = tick(e.ticker), fm = c[t];
      return fm || w.has(t) ? ({ ...e, cbfm: fm ?? null, cbfmWant: w.has(t) } as T) : e;
    });
  }, [entries, market, ver, key]);
}
