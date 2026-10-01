'use client';
// zzz848 — loads the guidance universe (Layer A). Takes NO event window: the universe is independent of event recency.
import { useEffect, useState } from 'react';
import type { GuUniverseResponse } from '@/lib/guidance-universe-types';
import { isUniverseUsable, universeUrl, type UniverseView } from '@/lib/guidance-upgrades-format';

export type UniverseState = 'loading' | 'ok' | 'error';

export function useGuUniverse(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; view?: UniverseView }): { data: GuUniverseResponse | null; state: UniverseState; retry: () => void; error: string | null } {
  const [data, setData] = useState<GuUniverseResponse | null>(null);
  const [state, setState] = useState<UniverseState>('loading');
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const url = universeUrl({ market: o.market, metric: o.metric, view: o.view });
  useEffect(() => {
    const ac = new AbortController();
    setState('loading'); setError(null);
    (async () => {
      try {
        const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
        let j: unknown = null;
        try { j = await r.json(); } catch { /* body is not JSON */ }
        const own = (j as { error?: unknown } | null)?.error;
        const ownText = typeof own === 'string' && own.trim() ? own.trim() : '';
        if (!r.ok) throw new Error(`${ownText || 'The server did not return the universe'} (HTTP ${r.status})`);
        if (ownText) throw new Error(ownText);
        if (!isUniverseUsable(j)) throw new Error('The answer was not in the expected format');
        if (ac.signal.aborted) return;
        setData(j); setState('ok');
      } catch (e) {
        if (ac.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
        setData(null); setError((e as Error)?.message || 'Unknown error'); setState('error');
      }
    })();
    return () => ac.abort();
  }, [url, tick]);
  return { data, state, retry: () => setTick((t) => t + 1), error };
}
