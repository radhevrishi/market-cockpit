'use client';
// zzz848 — loads the guidance universe (Layer A). Takes NO event window: the universe is independent of event recency.
import { useEffect, useState } from 'react';
import type { GuUniverseResponse } from '@/lib/guidance-universe-types';
import { isUniverseUsable, universeUrl, type UniverseView } from '@/lib/guidance-upgrades-format';

export type UniverseState = 'loading' | 'ok' | 'error';

export function useGuUniverse(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; view?: UniverseView }): { data: GuUniverseResponse | null; state: UniverseState; retry: () => void } {
  const [data, setData] = useState<GuUniverseResponse | null>(null);
  const [state, setState] = useState<UniverseState>('loading');
  const [tick, setTick] = useState(0);
  const url = universeUrl({ market: o.market, metric: o.metric, view: o.view });
  useEffect(() => {
    const ac = new AbortController();
    setState('loading');
    (async () => {
      try {
        const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: unknown = await r.json();
        if (!isUniverseUsable(j)) throw new Error('bad answer');
        if (ac.signal.aborted) return;
        setData(j); setState('ok');
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        setData(null); setState('error');
      }
    })();
    return () => ac.abort();
  }, [url, tick]);
  return { data, state, retry: () => setTick((t) => t + 1) };
}
