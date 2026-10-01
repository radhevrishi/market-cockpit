'use client';
// zzz848 — loads the guidance universe (Layer A). Takes NO event window: the universe is independent of event recency.
// zzz853 — view is active | review | history. The answer carries the new additive fields (viewCounts, invariantViolations, servedFrom, builtAt, liveError ...).
// Two components asking for the same URL at the same moment share one request (short memory), so the page does not fetch the universe twice.
import { useEffect, useState } from 'react';
import type { GuUniverseResponse, GuViewCounts, GuInvariantViolation, GuServedFrom, GuHighGrowthGroups, GuStateCounts, GuExpirySummary } from '@/lib/guidance-universe-types';
import type { GuExcluded, GuInactiveRecord } from '@/lib/guidance-universe';
import { isUniverseUsable } from '@/lib/guidance-upgrades-format';
import type { GuView } from './gu-ui';

export type UniverseState = 'loading' | 'ok' | 'error';

/** The universe answer with the additive zzz853 fields. Every extra field is optional: an older cached answer simply lacks them. */
export interface GuUniverseExt extends Omit<GuUniverseResponse, 'summary'> {
  summary: GuUniverseResponse['summary'] & Partial<{
    highGrowthGroups: GuHighGrowthGroups; counts: GuStateCounts; pointCounts: GuStateCounts; reviewQueueCount: number; reviewReasonCounts: Record<string, number>;
    staleVerificationCount: number; sourceConflictCount: number; expiry: GuExpirySummary; needsReviewCount: number;
  }>;
  viewCounts?: GuViewCounts; invariantViolations?: Array<GuInvariantViolation | string>; servedFrom?: GuServedFrom; builtAt?: string; liveError?: string;
  inactive?: GuInactiveRecord[]; excluded?: GuExcluded[];
}

export function guUniverseUrl(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; threshold?: number; view?: GuView } = {}): string {
  const q = new URLSearchParams();
  q.set('market', o.market || 'ALL');
  if (o.metric) q.set('metric', o.metric);
  q.set('threshold', String(o.threshold ?? 30));
  q.set('view', o.view || 'active');
  return `/api/v1/guidance-universe?${q.toString()}`;
}

const SHARE_MS = 4000;
const inflight = new Map<string, { at: number; p: Promise<GuUniverseExt> }>();
async function fetchUniverse(url: string, force: boolean): Promise<GuUniverseExt> {
  const hit = inflight.get(url);
  if (hit && !force && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = (async () => {
    const r = await fetch(url, { cache: 'no-store' });
    let j: unknown = null;
    try { j = await r.json(); } catch { /* body is not JSON */ }
    const own = (j as { error?: unknown } | null)?.error;
    const ownText = typeof own === 'string' && own.trim() ? own.trim() : '';
    if (!r.ok) throw new Error(`${ownText || 'The server did not return the universe'} (HTTP ${r.status})`);
    if (ownText) throw new Error(ownText);
    if (!isUniverseUsable(j)) throw new Error('The answer was not in the expected format');
    return j as unknown as GuUniverseExt;
  })();
  inflight.set(url, { at: Date.now(), p });
  p.catch(() => { if (inflight.get(url)?.p === p) inflight.delete(url); });
  return p;
}

export function useGuUniverse(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; view?: GuView }): { data: GuUniverseExt | null; state: UniverseState; retry: () => void; error: string | null } {
  const [data, setData] = useState<GuUniverseExt | null>(null);
  const [state, setState] = useState<UniverseState>('loading');
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const url = guUniverseUrl({ market: o.market, metric: o.metric, view: o.view });
  useEffect(() => {
    let alive = true;
    setState('loading'); setError(null);
    (async () => {
      try {
        const j = await fetchUniverse(url, tick > 0);
        if (!alive) return;
        setData(j); setState('ok');
      } catch (e) {
        if (!alive) return;
        setData(null); setError((e as Error)?.message || 'Unknown error'); setState('error');
      }
    })();
    return () => { alive = false; };
  }, [url, tick]);
  return { data, state, retry: () => setTick((t) => t + 1), error };
}
