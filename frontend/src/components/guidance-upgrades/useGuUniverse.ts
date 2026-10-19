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

/**
 * zzz1129 (guidance retest R2 + "not the same data again and again") — ONE copy per request address, shared by every section of the
 * page. Before, each of the five sections that use the universe read and parsed the same ~8 MB saved copy from IndexedDB on its own,
 * and a failed view change kept showing the PREVIOUS view's rows under the new label. Now:
 *  • every state belongs to its own address (market / view / metric): a new address never shows another address's rows;
 *  • the saved copy is read once per address, the network is asked once per address while fresh (90 s), concurrent askers share it;
 *  • a refresh failure on the same address keeps that address's rows and says so (`refreshError`).
 */
export interface UniverseEntry { data: GuUniverseExt | null; at: number | null; saved: boolean; error: string | null; refreshError: string | null; busy: boolean; fetchedAt: number | null }
export class UniverseStore {
  private m = new Map<string, UniverseEntry>();
  private subs = new Map<string, Set<() => void>>();
  private work = new Map<string, Promise<void>>();
  networkCalls = 0; cacheReads = 0;
  constructor(private io: { fetch: (url: string, force: boolean) => Promise<GuUniverseExt>; readCache: (url: string) => Promise<{ data: GuUniverseExt; ageMs: number } | null>; writeCache: (url: string, d: GuUniverseExt) => void; now?: () => number }) {}
  private now() { return this.io.now ? this.io.now() : Date.now(); }
  get(url: string): UniverseEntry { return this.m.get(url) || { data: null, at: null, saved: false, error: null, refreshError: null, busy: false, fetchedAt: null }; }
  private set(url: string, e: Partial<UniverseEntry>) { this.m.set(url, { ...this.get(url), ...e }); for (const f of this.subs.get(url) || []) f(); }
  subscribe(url: string, f: () => void): () => void { const s = this.subs.get(url) || new Set(); s.add(f); this.subs.set(url, s); return () => { s.delete(f); }; }
  /** Make sure `url` has data: memory first, then the saved copy (once), then the network when not fresh. `force` = Retry / refresh. */
  ensure(url: string, force = false): Promise<void> {
    const running = this.work.get(url);
    if (running && !force) return running;
    const p = (async () => {
      let e = this.get(url);
      if (!e.data && !force) {
        this.cacheReads++;
        const hit = await this.io.readCache(url).catch(() => null);
        if (hit && isUniverseUsable(hit.data)) { this.set(url, { data: hit.data, at: this.now() - hit.ageMs, saved: true, error: null }); e = this.get(url); }
      }
      if (!force && e.data && e.at != null && this.now() - e.at < FRESH_MS) return;
      this.set(url, { busy: true, refreshError: null, error: null });
      try {
        this.networkCalls++;
        const j = await this.io.fetch(url, force);
        this.io.writeCache(url, j);
        this.set(url, { data: j, at: this.now(), saved: false, error: null, refreshError: null, busy: false, fetchedAt: this.now() });
      } catch (err) {
        const msg = (err as Error)?.message || 'Unknown error';
        if (this.get(url).data) this.set(url, { refreshError: msg, busy: false });   // this address's own rows stay, labelled
        else this.set(url, { error: msg, busy: false });
      }
    })();
    this.work.set(url, p);
    p.finally(() => { if (this.work.get(url) === p) this.work.delete(url); });
    return p;
  }
  /** The hook's view of one address. */
  view(url: string): Omit<UniverseHook, 'retry'> {
    const e = this.get(url);
    const state: UniverseState = e.data ? 'ok' : e.error ? 'error' : 'loading';
    return { data: e.data, state, error: e.data ? null : e.error, refreshing: e.busy && !!e.data, refreshError: e.refreshError, savedAgeMs: e.saved && e.at != null ? this.now() - e.at : null, fetchedAt: e.fetchedAt };
  }
}
const store = new UniverseStore({ fetch: fetchUniverse, readCache: (u) => readCacheAsync<GuUniverseExt>(u), writeCache: (u, d) => writeCache(u, d) });

export function useGuUniverse(o: { market?: 'IN' | 'US' | 'ALL'; metric?: string; view?: GuView }): UniverseHook {
  const url = guUniverseUrl({ market: o.market, metric: o.metric, view: o.view });
  const [, bump] = useState(0);
  useEffect(() => store.subscribe(url, () => bump((n) => n + 1)), [url]);
  useEffect(() => { void store.ensure(url); }, [url]);
  useEffect(() => { const h = () => void store.ensure(url, true); window.addEventListener('gu-refresh', h); return () => window.removeEventListener('gu-refresh', h); }, [url]);
  return { ...store.view(url), retry: () => void store.ensure(url, true) };
}

/** One plain line for the universe's load status (null = nothing to say). */
export function universeStatusLine(h: Pick<UniverseHook, 'state' | 'error' | 'refreshing' | 'refreshError' | 'savedAgeMs' | 'data'>, ageText: (ms: number) => string): { text: string; tone: 'info' | 'warn' | 'error' } | null {
  if (h.state === 'error') return { text: `The guidance data could not be loaded: ${h.error || 'unknown error'}.`, tone: 'error' };
  if (h.state === 'loading') return { text: 'Loading the guidance data…', tone: 'info' };
  if (h.refreshError) return { text: `Showing a saved copy${h.savedAgeMs != null ? ` from ${ageText(h.savedAgeMs)}` : ''} — the refresh failed (${h.refreshError}).`, tone: 'warn' };
  if (h.refreshing && h.savedAgeMs != null) return { text: `Showing a saved copy from ${ageText(h.savedAgeMs)} — fresh data is loading.`, tone: 'info' };
  return null;
}
