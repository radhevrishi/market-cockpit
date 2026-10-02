/**
 * zzz855 — stale-while-revalidate cache for heavy API routes.
 *
 * Layers (fastest first):
 *   1. in-process memory (per Node instance, parsed object — no JSON parse cost)
 *   2. KV (Upstash / kv.ts in-memory fallback), envelope { v: 1, ts, value }
 *   3. build() — the route's real computation
 *
 * Rules (owner's correctness rules):
 *   - fresh (age < freshMs)           → serve, state 'hit'
 *   - stale (freshMs ≤ age < maxStaleMs) → serve the last-good value at once, state 'stale',
 *                                         refresh in the background (single-flight)
 *   - nothing usable / older than maxStaleMs → build synchronously (single-flight per instance)
 *   - a failed or EMPTY rebuild never overwrites last-good. If the synchronous rebuild fails and an
 *     old last-good value exists, that value is served labelled 'stale' with its true age.
 *   - the age is always reported (ageMs / builtAt) so routes can label stale data; the helper never
 *     invents an as_of field in the body — routes decide what to put there.
 *
 * Single flight: one in-flight build per key per instance (shared promise), plus a short KV lock
 * (SET NX EX) so several instances don't all rebuild the same stale key in the background.
 */
import { kvGet, kvSet, kvSetNX, kvDel } from './kv';

export type SwrState = 'hit' | 'stale' | 'miss';

export interface SwrStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  setNX(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

export const kvSwrStore: SwrStore = {
  get: (k) => kvGet(k),
  set: (k, v, ttl) => kvSet(k, v, ttl),
  setNX: (k, v, ttl) => kvSetNX(k, v, ttl),
  del: (k) => kvDel(k),
};

export interface SwrOptions<T> {
  /** Logical cache key (namespaced internally as `swr:<key>`). */
  key: string;
  /** Age below which the value is served as a plain hit. */
  freshMs: number;
  /** Age below which a stale value is served instantly while refreshing. Beyond it the request rebuilds synchronously. */
  maxStaleMs: number;
  build: () => Promise<T>;
  /** Return false for an empty / failed payload; such values are never cached and never replace last-good. */
  isUsable?: (v: T) => boolean;
  /** Keep the parsed value in process memory (default true). */
  memory?: boolean;
  /** Write to KV (default true). Set false for per-instance-only caches. */
  kv?: boolean;
  /** KV expiry in seconds (default: maxStaleMs + 1 day, so last-good outlives the stale window). */
  kvTtlS?: number;
  /** Cross-instance refresh lock TTL (default 120 s). */
  lockTtlS?: number;
  /** Skip all cached layers and rebuild now (e.g. ?refresh=1). Still single-flight; still never caches an empty result. */
  force?: boolean;
  store?: SwrStore;
  now?: () => number;
}

export interface SwrResult<T> {
  value: T;
  state: SwrState;
  /** Age of the value in ms (0 for a fresh build). */
  ageMs: number;
  /** Epoch ms when the value was built. */
  builtAt: number;
  /** A background refresh was started (or was already running) for this request. */
  refreshing: boolean;
  /** Where the value came from. */
  source: 'memory' | 'kv' | 'build';
  /** The synchronous rebuild failed and an older last-good value was served instead. */
  rebuildFailed?: boolean;
}

interface Envelope<T> { v: 1; ts: number; value: T }

const MEM_MAX = 200;
const G = globalThis as any;
const MEM: Map<string, Envelope<unknown>> = G.__MC_SWR_MEM__ || new Map();
G.__MC_SWR_MEM__ = MEM;
const INFLIGHT: Map<string, Promise<Envelope<unknown>>> = G.__MC_SWR_INFLIGHT__ || new Map();
G.__MC_SWR_INFLIGHT__ = INFLIGHT;
const REFRESHING: Set<string> = G.__MC_SWR_REFRESHING__ || new Set();
G.__MC_SWR_REFRESHING__ = REFRESHING;

const kvKeyOf = (k: string) => `swr:${k}`;
const lockKeyOf = (k: string) => `swr:lock:${k}`;

function memPut(key: string, env: Envelope<unknown>) {
  if (MEM.has(key)) MEM.delete(key);
  MEM.set(key, env);
  while (MEM.size > MEM_MAX) { const first = MEM.keys().next().value; if (first === undefined) break; MEM.delete(first); }
}

function isEnvelope(x: any): x is Envelope<unknown> {
  return !!x && typeof x === 'object' && x.v === 1 && typeof x.ts === 'number' && 'value' in x;
}

/** Default emptiness test: null/undefined, empty array, or object with no keys = not usable. */
export function defaultUsable(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/** Build once per key per instance; write memory + KV only when the result is usable. Rejects when unusable. */
function runBuild<T>(o: SwrOptions<T>, store: SwrStore, now: () => number, useMem: boolean, useKv: boolean): Promise<Envelope<T>> {
  const existing = INFLIGHT.get(o.key);
  if (existing) return existing as Promise<Envelope<T>>;
  const usable = o.isUsable || defaultUsable;
  const p = (async () => {
    const value = await o.build();
    if (!usable(value)) throw new SwrUnusableError(o.key, value);
    const env: Envelope<T> = { v: 1, ts: now(), value };
    if (useMem) memPut(o.key, env);
    if (useKv) {
      const ttl = o.kvTtlS ?? Math.ceil(o.maxStaleMs / 1000) + 86400;
      try { await store.set(kvKeyOf(o.key), env, ttl); } catch { /* memory still has it */ }
    }
    return env;
  })();
  INFLIGHT.set(o.key, p);
  const clear = () => { if (INFLIGHT.get(o.key) === p) INFLIGHT.delete(o.key); };
  p.then(clear, clear);
  return p;
}

/** Thrown when a build returns an empty/unusable value. `value` carries it so a caller can still pass it through uncached. */
export class SwrUnusableError extends Error {
  constructor(key: string, public readonly value?: unknown) { super(`swr: build for ${key} returned an empty/unusable payload; last-good kept`); this.name = 'SwrUnusableError'; }
}

function refreshInBackground<T>(o: SwrOptions<T>, store: SwrStore, now: () => number, useMem: boolean, useKv: boolean): void {
  if (INFLIGHT.has(o.key) || REFRESHING.has(o.key)) return;
  REFRESHING.add(o.key);   // marked synchronously so concurrent stale requests in this instance start one refresh
  const lockTtl = o.lockTtlS ?? 120;
  void (async () => {
    let locked = true;
    if (useKv) {
      try { locked = await store.setNX(lockKeyOf(o.key), now(), lockTtl); } catch { locked = true; }
    }
    if (!locked) { REFRESHING.delete(o.key); return; }   // another instance is refreshing; it will write KV
    try { await runBuild(o, store, now, useMem, useKv); }
    catch (e: any) { console.warn(`[swr] background refresh failed for ${o.key}: ${e?.message || e}`); }
    finally {
      if (useKv && locked) { try { await store.del(lockKeyOf(o.key)); } catch { /* lock TTL expires */ } }
      REFRESHING.delete(o.key);
    }
  })();
}

export async function swrGet<T>(o: SwrOptions<T>): Promise<SwrResult<T>> {
  const store = o.store || kvSwrStore;
  const now = o.now || Date.now;
  const useMem = o.memory !== false;
  const useKv = o.kv !== false;
  const usable = o.isUsable || defaultUsable;

  let env: Envelope<T> | null = null;
  let source: SwrResult<T>['source'] = 'memory';
  if (!o.force) {
    if (useMem) {
      const m = MEM.get(o.key) as Envelope<T> | undefined;
      if (m) env = m;
    }
    // memory miss, or memory only holds a stale value: KV may hold a newer one written by another instance
    if (useKv && (!env || (now() - env.ts >= o.freshMs && !INFLIGHT.has(o.key) && !REFRESHING.has(o.key)))) {
      try {
        const k = await store.get<Envelope<T>>(kvKeyOf(o.key));
        if (isEnvelope(k) && usable(k.value as T) && (!env || k.ts > env.ts)) {
          env = k as Envelope<T>;
          source = 'kv';
          if (useMem) memPut(o.key, env);
        }
      } catch { /* KV down: memory or build */ }
    }
  }

  if (env) {
    const age = Math.max(0, now() - env.ts);
    if (age < o.freshMs) return { value: env.value, state: 'hit', ageMs: age, builtAt: env.ts, refreshing: false, source };
    if (age < o.maxStaleMs) {
      refreshInBackground(o, store, now, useMem, useKv);
      return { value: env.value, state: 'stale', ageMs: age, builtAt: env.ts, refreshing: true, source };
    }
  }

  // cold, forced, or too old: build synchronously (shared per instance)
  try {
    const built = await runBuild(o, store, now, useMem, useKv);
    return { value: built.value, state: 'miss', ageMs: Math.max(0, now() - built.ts), builtAt: built.ts, refreshing: false, source: 'build' };
  } catch (e) {
    // too-old / forced rebuild failed: an honest old value beats an error, labelled stale with its real age
    let fallback = env;
    if (!fallback && o.force) {
      const m = useMem ? (MEM.get(o.key) as Envelope<T> | undefined) : undefined;
      if (m) fallback = m;
      if (!fallback && useKv) {
        try { const k = await store.get<Envelope<T>>(kvKeyOf(o.key)); if (isEnvelope(k) && usable(k.value as T)) fallback = k as Envelope<T>; } catch { /* none */ }
      }
    }
    if (fallback) {
      return { value: fallback.value, state: 'stale', ageMs: Math.max(0, now() - fallback.ts), builtAt: fallback.ts, refreshing: false, source: source, rebuildFailed: true };
    }
    throw e;
  }
}

/** Pure in-process memo (no KV) for short-lived derived values, e.g. a per-request overlay. Same SWR + single-flight rules. */
export function swrMemo<T>(o: Omit<SwrOptions<T>, 'kv' | 'store'>): Promise<SwrResult<T>> {
  return swrGet({ ...o, kv: false });
}

/** Response headers describing the cache state. Age is the true age of the payload. */
export function swrHeaders(r: Pick<SwrResult<unknown>, 'state' | 'ageMs' | 'builtAt'>, cacheControl?: string): Record<string, string> {
  const h: Record<string, string> = {
    'x-mc-cache': r.state,
    'x-mc-cache-age': String(Math.round(r.ageMs / 1000)),
    'x-mc-built-at': new Date(r.builtAt).toISOString(),
  };
  if (cacheControl) h['Cache-Control'] = cacheControl;
  return h;
}

/** Browser-only cache (routes sit behind the owner cookie — never `public`). */
export function privateCache(maxAgeS: number, staleWhileRevalidateS: number): string {
  return `private, max-age=${Math.max(0, Math.round(maxAgeS))}, stale-while-revalidate=${Math.max(0, Math.round(staleWhileRevalidateS))}`;
}

/** Test hook: drop the in-process layers. */
export function __resetSwrForTests(): void {
  MEM.clear();
  INFLIGHT.clear();
  REFRESHING.clear();
}

/** Test hook: resolve once no build or background refresh is running. */
export async function __swrSettled(maxTicks = 1000): Promise<void> {
  for (let i = 0; i < maxTicks && (INFLIGHT.size > 0 || REFRESHING.size > 0); i++) await new Promise((r) => setImmediate(r));
}
