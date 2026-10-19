'use client';
// zzz848 — loads the guidance universe (Layer A). Takes NO event window: the universe is independent of event recency.
// zzz853 — view is active | review | history. The answer carries the new additive fields (viewCounts, invariantViolations, servedFrom, builtAt, liveError ...).
// Two components asking for the same URL at the same moment share one request (short memory), so the page does not fetch the universe twice.
import { useEffect, useState } from 'react';
import type { GuUniverseResponse, GuViewCounts, GuInvariantViolation, GuServedFrom, GuHighGrowthGroups, GuStateCounts, GuExpirySummary } from '@/lib/guidance-universe-types';
import type { GuExcluded, GuInactiveRecord } from '@/lib/guidance-universe';
import { isUniverseUsable } from '@/lib/guidance-upgrades-format';
import { readCacheAsync, writeCache, FRESH_MS } from '@/lib/gu-client-cache';
import type { GuView } from './gu-ui';

export type UniverseState = 'loading' | 'ok' | 'error';

/** The universe answer with the additive zzz853 fields. Every extra field is optional: an older cached answer simply lacks them. */
export interface GuUniverseExt extends Omit<GuUniverseResponse, 'summary'> {
  summary: GuUniverseResponse['summary'] & Partial<{
    highGrowthGroups: GuHighGrowthGroups; counts: GuStateCounts; pointCounts: GuStateCounts; reviewQueueCount: number; reviewReasonCounts: Record<string, number>;
    staleVerificationCount: number; sourceConflictCount: number; expiry: GuExpirySummary; needsReviewCount: number;
  }>;
  viewCounts?: GuViewCounts; marketViews?: Record<'IN' | 'US', { active: number; review: number; claims: number; history: number }>; invariantViolations?: Array<GuInvariantViolation | string>; servedFrom?: GuServedFrom; builtAt?: string; liveError?: string;
  inactive?: GuInactiveRecord[]; excluded?: GuExcluded[];
  /** zzz865: every derived growth, recalculated */ derivedAudit?: import('@/lib/guidance-derived-audit').DerivedAudit;
  /** zzz861: claims table (actionable status) and the wanted-companies list */
  pipeline?: { claims: import('@/lib/guidance-claims').GuidanceClaim[]; claimCounts: Record<'IN' | 'US', Record<string, number>>; wanted: import('@/lib/guidance-claims').WantedCompany[]; queueStages: Record<'IN' | 'US', Record<string, number>> };
}

export function guUniverseUrl(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; threshold?: number; view?: GuView } = {}): string {
  const q = new URLSearchParams();
  q.set('market', o.market || 'ALL');
  if (o.metric) q.set('metric', o.metric);
  q.set('threshold', String(o.threshold ?? 30));
  q.set('view', o.view || 'active');
  q.set('lean', '1');   // zzz886: rows without detail-only text; an opened company fetches its full row (?entity=)
  return `/api/v1/guidance-universe?${q.toString()}`;
}

const SHARE_MS = 4000;
const inflight = new Map<string, { at: number; p: Promise<GuUniverseExt> }>();
async function fetchUniverse(url: string, force: boolean): Promise<GuUniverseExt> {
  const hit = inflight.get(url);
  if (hit && !force && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = (async () => {
    // zzz1113 (G07) — a deadline: a hung request ends as an error the page can show, not an endless "reading"
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60_000) }).catch((e: any) => { throw new Error(e?.name === 'TimeoutError' ? 'No answer within 60 seconds' : 'The network request failed'); });
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

/** zzz1113 (guidance audit G07) — the states a viewer must be able to tell apart:
 *  loading (nothing yet) · ok (fresh, or a saved copy still within its fresh time) · refreshing (saved copy shown, fresh data on its
 *  way) · stale (saved copy shown because the refresh FAILED — `refreshError` says why) · error (nothing to show). `savedAgeMs` =
 *  how old the shown saved copy is (null = freshly fetched); `fetchedAt` = when this browser last got a fresh answer. */
export interface UniverseHook {
  data: GuUniverseExt | null; state: UniverseState; retry: () => void; error: string | null;
  refreshing: boolean; refreshError: string | null; savedAgeMs: number | null; fetchedAt: number | null;
}
export function useGuUniverse(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; view?: GuView }): UniverseHook {
  const [data, setData] = useState<GuUniverseExt | null>(null);
  const [state, setState] = useState<UniverseState>('loading');
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [savedAgeMs, setSavedAgeMs] = useState<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const url = guUniverseUrl({ market: o.market, metric: o.metric, view: o.view });
  useEffect(() => { const h = () => setTick((t) => t + 1); window.addEventListener('gu-refresh', h); return () => window.removeEventListener('gu-refresh', h); }, []);
  useEffect(() => {
    let alive = true;
    // zzz863: show the saved copy at once, fetch fresh data in the background (skipped when the copy is under 90 seconds old)
    // zzz886: the saved copy may be in IndexedDB (too big for localStorage), so it is read asynchronously
    (async () => {
      const hit = tick === 0 ? await readCacheAsync<GuUniverseExt>(url) : null;
      if (!alive) return;
      const shown = hit && isUniverseUsable(hit.data) ? hit : null;
      if (shown) {
        setData(shown.data); setState('ok'); setError(null); setSavedAgeMs(shown.ageMs);
        if (shown.ageMs < FRESH_MS) return;
      } else if (tick === 0 || !data) { setState('loading'); }
      setRefreshing(true); setRefreshError(null); setError(null);
      try {
        const j = await fetchUniverse(url, tick > 0);
        if (!alive) return;
        writeCache(url, j);
        setData(j); setState('ok'); setSavedAgeMs(null); setFetchedAt(Date.now());
      } catch (e) {
        if (!alive) return;
        const msg = (e as Error)?.message || 'Unknown error';
        if (shown || data) { setRefreshError(msg); setState('ok'); return; }   // keep the saved copy, but SAY the refresh failed
        setData(null); setError(msg); setState('error');
      } finally { if (alive) setRefreshing(false); }
    })();
    return () => { alive = false; };
    // `data` is read only as "is something on screen" for a retry; it is not a trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);
  return { data, state, retry: () => setTick((t) => t + 1), error, refreshing, refreshError, savedAgeMs, fetchedAt };
}

/** One plain line for the universe's load status (null = nothing to say). */
export function universeStatusLine(h: Pick<UniverseHook, 'state' | 'error' | 'refreshing' | 'refreshError' | 'savedAgeMs' | 'data'>, ageText: (ms: number) => string): { text: string; tone: 'info' | 'warn' | 'error' } | null {
  if (h.state === 'error') return { text: `The guidance data could not be loaded: ${h.error || 'unknown error'}.`, tone: 'error' };
  if (h.state === 'loading') return { text: 'Loading the guidance data…', tone: 'info' };
  if (h.refreshError) return { text: `Showing a saved copy${h.savedAgeMs != null ? ` from ${ageText(h.savedAgeMs)}` : ''} — the refresh failed (${h.refreshError}).`, tone: 'warn' };
  if (h.refreshing && h.savedAgeMs != null) return { text: `Showing a saved copy from ${ageText(h.savedAgeMs)} — fresh data is loading.`, tone: 'info' };
  return null;
}
