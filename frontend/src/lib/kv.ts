/**
 * Key-Value store abstraction for Market Cockpit
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
 * Falls back to globalThis in-memory store (survives warm serverless instances only).
 *
 * Setup:
 * 1. Go to Vercel Dashboard → Storage → Create → Upstash Redis
 * 2. Connect to your project — env vars are auto-added
 * 3. Redeploy
 *
 * zzz1049 — Upstash is billed per command. Reads of shared (non-personal) keys go through a short memory cache
 * (lib/kv-read-cache.ts, 60 s for a value, 30 s for "missing", one shared read per key at a time); every write made
 * here updates or drops the cached copy. Personal data, locks and rate counters are never cached. Every command sent
 * is counted per hour by key family (memory only) — see kvUsageSnapshot() and /api/v1/system-status → kvUsage.
 * Off switch: KV_READ_CACHE=0.
 */

import { Redis } from '@upstash/redis';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { MemoryKvStore } from './kv-memory';
import { VERSIONED_SET_LUA, parseVersionedResult, type VersionedValue } from './kv-versioned';
import { KvReadCache, KvUsage, readThrough } from './kv-read-cache';

let redis: Redis | null = null;
let redisAvailable: boolean | null = null;

function getRedis(): Redis | null {
  if (redisAvailable === false) return null;
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    redisAvailable = false;
    console.log('[KV] No Redis credentials found. Using in-memory fallback. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for persistence.');
    return null;
  }

  try {
    redis = new Redis({ url, token });
    redisAvailable = true;
    console.log('[KV] Upstash Redis connected');
    return redis;
  } catch (e) {
    console.error('[KV] Failed to initialize Redis:', e);
    redisAvailable = false;
    return null;
  }
}

function restCreds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

// In-memory fallback store
// Versioned key avoids treating legacy non-expiring Map entries as fresh.
const MEM_STORE: MemoryKvStore = (globalThis as any).__MC_KV_STORE_V2__ || new MemoryKvStore();
(globalThis as any).__MC_KV_STORE_V2__ = MEM_STORE;

// ── zzz1049: memory read cache + command counters ────────────────────────────
const READ_CACHE: KvReadCache = (globalThis as any).__MC_KV_READ_CACHE__ || new KvReadCache({
  maxBytes: Math.max(8, Number(process.env.KV_READ_CACHE_MB) || 64) * 1024 * 1024,
  maxEntryBytes: 12 * 1024 * 1024,
  hitTtlMs: Math.max(0, Number(process.env.KV_READ_CACHE_TTL_S ?? 60)) * 1000,
  missTtlMs: Math.max(0, Number(process.env.KV_READ_CACHE_MISS_TTL_S ?? 30)) * 1000,
});
(globalThis as any).__MC_KV_READ_CACHE__ = READ_CACHE;
const READ_INFLIGHT = new Map<string, Promise<string | null>>();
export const KV_USAGE: KvUsage = (globalThis as any).__MC_KV_USAGE__ || new KvUsage();
(globalThis as any).__MC_KV_USAGE__ = KV_USAGE;

/** For callers that talk to the Upstash REST API directly, so the per-hour counter stays complete. */
export function kvCountExternal(op: string, key: string, commands = 1, bytes = 0): void { KV_USAGE.record(op, key, commands, bytes); }
const readCacheOn = (): boolean => process.env.KV_READ_CACHE !== '0' && !!restCreds();
/** Usage + cache numbers for /api/v1/system-status. */
export function kvUsageSnapshot() {
  const s = READ_CACHE.size();
  return {
    ...KV_USAGE.snapshot(),
    readCache: { on: readCacheOn(), entries: s.entries, mb: Math.round(s.bytes / 1e4) / 100, hits: READ_CACHE.hits, knownMissingHits: READ_CACHE.missHits, storeReads: READ_CACHE.loads, evictions: READ_CACHE.evictions, ttlS: READ_CACHE.opts.hitTtlMs / 1000 },
  };
}
/** Test/admin helper: forget every cached read. */
export function _clearKvReadCache(): void { READ_CACHE.clear(); READ_INFLIGHT.clear(); LAST_WRITE.clear(); }

/** After a write: keep the written value as the cached copy (non-string values only — a string is stored raw and the
 *  client may JSON-parse it on the way back, so its read shape is not known here), or drop it. */
function noteWrite(key: string, value: any, serialized: string | null, ttlSeconds?: number): void {
  if (typeof serialized === 'string' && typeof value !== 'string' && value !== null && value !== undefined) READ_CACHE.put(key, serialized, ttlSeconds);
  else READ_CACHE.invalidate(key);
}

// zzz1049 — a write of the SAME value shortly after this process wrote it is skipped (it would only re-set the TTL).
// Window: 10 % of the TTL, at most 10 minutes (no TTL: 10 minutes), so the key can expire at most that much earlier.
// Personal / lock / counter keys are never skipped.
const LAST_WRITE = new Map<string, { hash: string; at: number; ttl: number | null }>();
const SKIP_WINDOW_CAP_MS = 10 * 60_000;
export function unchangedWriteSkippable(prev: { hash: string; at: number; ttl: number | null } | undefined, hash: string, ttlSeconds: number | undefined, now: number): boolean {
  if (!prev || prev.hash !== hash) return false;
  const ttl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : null;
  if ((prev.ttl === null) !== (ttl === null)) return false;
  const windowMs = ttl === null ? SKIP_WINDOW_CAP_MS : Math.min(SKIP_WINDOW_CAP_MS, ttl * 100);
  return now - prev.at < windowMs;
}

/**
 * Get a value from the KV store
 */
// zzz985 — a value too big for the shared cache (feeds of 8–11 MB: filings windows, the concall feed, special situations)
// was skipped and rebuilt from scratch after every restart, freezing requests for 10–15 s. Such values are now stored
// gzip-compressed (JSON shrinks ~10×) in a small wrapper; every reader here unpacks it. Values under the cap are untouched.
const GZ_MARK = '__mc_gz';
export function packLarge(serialized: string): { [GZ_MARK]: 1; d: string } {
  return { [GZ_MARK]: 1, d: gzipSync(Buffer.from(serialized, 'utf8'), { level: 6 }).toString('base64') };
}
export function unpackLarge<T = any>(v: any): T {
  if (v && typeof v === 'object' && v[GZ_MARK] === 1 && typeof v.d === 'string') {
    try { return JSON.parse(gunzipSync(Buffer.from(v.d, 'base64')).toString('utf8')) as T; } catch { return null as unknown as T; }
  }
  return v as T;
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  if (readCacheOn() && READ_CACHE.canCache(key)) {
    const before = READ_CACHE.hits + READ_CACHE.missHits;
    const v = await readThrough<T>(READ_CACHE, READ_INFLIGHT, key, () => kvGetFromStore<T>(key));
    if (READ_CACHE.hits + READ_CACHE.missHits > before) KV_USAGE.cacheServed++;
    return v;
  }
  return (await kvGetFromStore<T>(key)).value;
}

/** One store read, no memory cache. `failed` = the store could not be asked, so a null is not proof of absence. */
async function kvGetFromStore<T = any>(key: string): Promise<{ value: T | null; failed: boolean }> {
  // PATCH 1018 — client FIRST (fast for small/cached keys), then a BOUNDED
  // raw-REST fallback only when the client returns nothing. The previous
  // raw-REST-primary version added an unbounded HTTP round-trip to every read
  // and could hang, pushing /api/market/quotes past Railway's 30s maxDuration
  // (→ "Movers fetch timed out"). Client reads are fast; raw-REST handles the
  // large blobs the @upstash client returns empty for (universe/mover-reasons).
  // zzz1049: note a MISS therefore costs two commands — the memory cache keeps "missing" for 30 s.
  let failed = false;
  const r = getRedis();
  if (r) {
    try {
      KV_USAGE.record('get', key);
      const val = await r.get<T>(key);
      if (val !== null && val !== undefined) return { value: unpackLarge<T>(val), failed: false };
    } catch (e) {
      failed = true;
      console.error(`[KV] Redis GET failed for ${key}:`, e);
    }
  }
  const creds = restCreds();
  if (creds) {
    failed = true;
    try {
      KV_USAGE.record('get(rest)', key);
      const resp = await fetch(`${creds.url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${creds.token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const j: any = await resp.json().catch(() => null);
        if (j && typeof j === 'object' && 'result' in j) failed = false;
        const raw: any = j?.result;
        if (raw !== null && raw !== undefined) {
          if (typeof raw === 'string') {
            KV_USAGE.record('get(rest)', key, 0, raw.length);
            try { let p: any = JSON.parse(raw); if (typeof p === 'string') p = JSON.parse(p); return { value: unpackLarge<T>(p), failed: false }; }
            catch { return { value: raw as unknown as T, failed: false }; }
          }
          return { value: unpackLarge<T>(raw), failed: false };
        }
      }
    } catch { /* fall through to memory */ }
  }
  const mem = MEM_STORE.get(key);
  if (mem) {
    try { return { value: JSON.parse(mem) as T, failed }; } catch { return { value: mem as unknown as T, failed }; }
  }
  return { value: null, failed };
}

/** Backup reads must distinguish absent data from unavailable storage. Never served from the memory cache. */
export async function kvGetDurable<T = any>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) throw new Error('Durable storage is unavailable');
  KV_USAGE.record('get(durable)', key);
  return await r.get<T>(key);
}

/**
 * zzz814 — read MANY keys in ONE Upstash command (MGET). A 60-day India
 * earnings window is ~84 graded days; reading them one GET at a time would be
 * 84 commands per page open against a request-metered quota. Uses the raw
 * REST endpoint (the same path kvGet falls back to for large blobs, which the
 * client sometimes returns empty for), then the client's mget, then per-key
 * kvGet (in-memory mode / REST unavailable). Returns values in key order,
 * null for a missing key.
 * zzz1049: keys held in the memory read cache are answered from it; only the rest go into the MGET.
 */
export async function kvMGet<T = any>(keys: string[]): Promise<Array<T | null>> {
  if (keys.length === 0) return [];
  if (!readCacheOn()) return (await kvMGetFromStore<T>(keys)).values;
  const out: Array<T | null> = new Array(keys.length).fill(null);
  const need: number[] = [];
  keys.forEach((k, i) => {
    if (!READ_CACHE.canCache(k)) { need.push(i); return; }
    const h = READ_CACHE.get(k);
    if (h.found) { KV_USAGE.cacheServed++; out[i] = h.text === null ? null : (JSON.parse(h.text) as T); }
    else need.push(i);
  });
  if (!need.length) return out;
  const needKeys = need.map((i) => keys[i]);
  const got = await kvMGetFromStore<T>(needKeys);
  need.forEach((i, j) => {
    const v = got.values[j];
    out[i] = v;
    if (!READ_CACHE.canCache(keys[i])) return;
    if (v !== null && v !== undefined) { try { READ_CACHE.put(keys[i], JSON.stringify(v)); } catch { /* not cached */ } }
    else if (got.batched) READ_CACHE.put(keys[i], null);
  });
  return out;
}

async function kvMGetFromStore<T = any>(keys: string[]): Promise<{ values: Array<T | null>; batched: boolean }> {
  const parse = (raw: any): any => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
      try { let p: any = JSON.parse(raw); if (typeof p === 'string') p = JSON.parse(p); return unpackLarge(p); }
      catch { return raw; }
    }
    return unpackLarge(raw);
  };
  const creds = restCreds();
  if (creds) {
    try {
      KV_USAGE.record('mget', keys[0]);
      const resp = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['MGET', ...keys]),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const text = await resp.text();
        KV_USAGE.record('mget', keys[0], 0, text.length);
        let j: any = null; try { j = JSON.parse(text); } catch { j = null; }
        if (Array.isArray(j?.result) && j.result.length === keys.length) {
          return { values: j.result.map((v: any) => parse(v) as T | null), batched: true };
        }
      }
    } catch { /* fall through */ }
  }
  const r = getRedis();
  if (r) {
    try {
      KV_USAGE.record('mget', keys[0]);
      const vals = await r.mget<any[]>(...keys);
      if (Array.isArray(vals) && vals.length === keys.length) return { values: vals.map((v) => parse(v) as T | null), batched: true };
    } catch (e) {
      console.error('[KV] Redis MGET failed:', e);
    }
  }
  return { values: await Promise.all(keys.map((k) => kvGet<T>(k))), batched: false };
}

/**
 * Set a value in the KV store with optional TTL (seconds).
 *
 * PATCH 1018 — Upstash imposes a 10 MB Max Request Size on the REST API.
 * Writes larger than that get rejected and the cache silently stays empty,
 * which makes every subsequent read pay the full recompute cost AND triggers
 * "Max Request Size limit" alerts to the account owner. The concall-intel
 * live-feed payload at days=180 is ~12 MB, so this guard is necessary.
 *
 * Strategy: skip the REMOTE write if the serialized payload exceeds the safe
 * threshold (8 MB — keep a 2 MB safety margin below the 10 MB hard cap).
 * Memory cache is still populated so the current request returns fast; only
 * the cross-instance KV cache is skipped for over-sized blobs.
 */
const KV_REMOTE_MAX_BYTES = 8 * 1024 * 1024;  // 8 MB safety cap (Upstash hard limit is 10 MB)

/** Personal data must receive a durable acknowledgement before reporting success. Never skipped, never cached. */
export async function kvSetVersioned<T extends VersionedValue>(key: string, value: T, baseVersion: number | null | undefined) {
  const base = baseVersion ?? 0;
  if (!Number.isSafeInteger(base) || base < 0 || base >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid base version');
  const serialized = JSON.stringify({ ...value, version: base + 1 });
  if (Buffer.byteLength(serialized, 'utf8') > KV_REMOTE_MAX_BYTES) throw new Error('Durable KV value exceeds the storage limit');
  const r = getRedis();
  if (!r) throw new Error('Durable storage is unavailable; save was not confirmed');
  READ_CACHE.invalidate(key); LAST_WRITE.delete(key);
  KV_USAGE.record('eval(versioned-set)', key, 1, serialized.length);
  const result = parseVersionedResult<T>(await r.eval(VERSIONED_SET_LUA, [key], [serialized, baseVersion ?? 0]));
  if (result.ok && result.row) MEM_STORE.set(key, JSON.stringify(result.row));
  return result;
}

/** Durable write: always sent and acknowledged (never skipped, never cached). */
export async function kvSetDurable(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > KV_REMOTE_MAX_BYTES) {
    throw new Error('Durable KV value exceeds the storage limit or is not serializable');
  }
  const r = getRedis();
  if (!r) throw new Error('Durable storage is unavailable; save was not confirmed');
  READ_CACHE.invalidate(key); LAST_WRITE.delete(key);
  KV_USAGE.record('set(durable)', key, 1, serialized.length);
  const result = ttlSeconds ? await r.set(key, value, { ex: ttlSeconds }) : await r.set(key, value);
  if (result !== 'OK') throw new Error('Durable storage did not acknowledge the save');
  MEM_STORE.set(key, serialized, ttlSeconds);
}

export async function kvSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const original = value;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  // Always update memory store (fast path)
  MEM_STORE.set(key, serialized, ttlSeconds);

  // zzz1049 — same value written moments ago by this process: nothing to send
  const r0 = getRedis();
  const skippable = !!r0 && typeof serialized === 'string' && READ_CACHE.canCache(key);
  const hash = skippable ? createHash('sha1').update(serialized).digest('base64') : '';
  if (skippable && unchangedWriteSkippable(LAST_WRITE.get(key), hash, ttlSeconds, Date.now())) {
    KV_USAGE.writesSkipped++;
    noteWrite(key, value, serialized, ttlSeconds);
    return;
  }

  // PATCH 1018 — skip oversized remote writes (Upstash 10 MB limit)
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  if (serializedBytes > KV_REMOTE_MAX_BYTES) {
    // zzz985: store it compressed instead of not at all
    let packed: { __mc_gz: 1; d: string } | null = null;
    try { packed = packLarge(serialized); } catch { packed = null; }
    const packedBytes = packed ? packed.d.length + 20 : Infinity;
    if (!packed || packedBytes > KV_REMOTE_MAX_BYTES) {
      console.warn(`[KV] Skipping remote SET for ${key} — payload ${(serializedBytes / 1048576).toFixed(1)} MB > ${(KV_REMOTE_MAX_BYTES / 1048576).toFixed(0)} MB safety cap even compressed. (Memory cache still populated.)`);
      READ_CACHE.invalidate(key); LAST_WRITE.delete(key);
      return;
    }
    value = packed;
  }

  const r = getRedis();
  if (r) {
    try {
      KV_USAGE.record('set', key, 1, Math.min(serializedBytes, KV_REMOTE_MAX_BYTES));
      if (ttlSeconds) {
        await r.set(key, value, { ex: ttlSeconds });
      } else {
        await r.set(key, value);
      }
      noteWrite(key, original, serialized, ttlSeconds);
      if (skippable) {
        if (LAST_WRITE.size > 5000) LAST_WRITE.clear();
        LAST_WRITE.set(key, { hash, at: Date.now(), ttl: ttlSeconds && ttlSeconds > 0 ? ttlSeconds : null });
      }
    } catch (e) {
      READ_CACHE.invalidate(key); LAST_WRITE.delete(key);
      console.error(`[KV] Redis SET failed for ${key}:`, e);
    }
  } else {
    READ_CACHE.invalidate(key);
  }
}

/**
 * Delete a key from the KV store
 */
export async function kvDel(key: string): Promise<void> {
  MEM_STORE.delete(key);
  READ_CACHE.invalidate(key); LAST_WRITE.delete(key);
  const r = getRedis();
  if (r) {
    KV_USAGE.record('del', key);
    try { await r.del(key); } catch (e) { console.error(`[KV] Redis DEL failed for ${key}:`, e); }
  }
}

/**
 * Atomic SET-IF-NOT-EXISTS (distributed lock primitive)
 * Returns true if the lock was acquired, false if it already exists.
 * zzz1049: a key used here is a lock / once-marker — it is never served from the memory read cache.
 */
export async function kvSetNX(key: string, value: any, ttlSeconds: number): Promise<boolean> {
  READ_CACHE.markUncacheable(key); LAST_WRITE.delete(key);
  const r = getRedis();
  if (r) {
    try {
      KV_USAGE.record('setnx', key);
      const result = await r.set(key, value, { nx: true, ex: ttlSeconds });
      return result === 'OK';
    } catch (e) {
      console.error(`[KV] Redis SETNX failed for ${key}:`, e);
      return false;
    }
  }
  // In-memory fallback
  if (MEM_STORE.has(key)) return false;
  MEM_STORE.set(key, typeof value === 'string' ? value : JSON.stringify(value), ttlSeconds);
  return true;
}

/** zzz883 — atomic add (never loses an update when two calls write at once). Returns the new total, or null when Redis is off. */
export async function kvIncrByFloat(key: string, by: number, ttlSeconds?: number): Promise<number | null> {
  const r = getRedis();
  if (!r || !Number.isFinite(by)) return null;
  READ_CACHE.markUncacheable(key); LAST_WRITE.delete(key);
  try {
    KV_USAGE.record('incrbyfloat', key, ttlSeconds ? 2 : 1);
    const v = await r.incrbyfloat(key, by);
    if (ttlSeconds) await r.expire(key, ttlSeconds).catch(() => {});
    return Number(v);
  } catch (e) { console.error(`[KV] INCRBYFLOAT failed for ${key}:`, e); return null; }
}
/** zzz883 — atomic set add (job-name index etc.). */
export async function kvSAdd(key: string, member: string, ttlSeconds?: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  READ_CACHE.markUncacheable(key);
  KV_USAGE.record('sadd', key, ttlSeconds ? 2 : 1);
  try { await r.sadd(key, member); if (ttlSeconds) await r.expire(key, ttlSeconds).catch(() => {}); return true; } catch { return false; }
}

/**
 * Atomic rename: swap temp key to production key
 * Writes temp first, then overwrites production atomically.
 */
export async function kvSwap(tempKey: string, prodKey: string, ttlSeconds?: number): Promise<boolean> {
  READ_CACHE.invalidate(tempKey); READ_CACHE.invalidate(prodKey); LAST_WRITE.delete(tempKey); LAST_WRITE.delete(prodKey);
  const r = getRedis();
  if (r) {
    try {
      // Read temp value and write to prod in two ops (Upstash REST doesn't support RENAME)
      KV_USAGE.record('swap', prodKey, 3);
      const val = await r.get(tempKey);
      if (val === null) return false;
      if (ttlSeconds) {
        await r.set(prodKey, val, { ex: ttlSeconds });
      } else {
        await r.set(prodKey, val);
      }
      await r.del(tempKey);
      // Also update memory store
      const serialized = typeof val === 'string' ? val : JSON.stringify(val);
      MEM_STORE.set(prodKey, serialized, ttlSeconds);
      MEM_STORE.delete(tempKey);
      return true;
    } catch (e) {
      console.error(`[KV] Redis SWAP failed ${tempKey} → ${prodKey}:`, e);
      return false;
    }
  }
  // In-memory fallback
  const val = MEM_STORE.get(tempKey);
  if (!val) return false;
  MEM_STORE.set(prodKey, val, ttlSeconds);
  MEM_STORE.delete(tempKey);
  return true;
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}

/**
 * zzz919 — EXISTS for many keys in Upstash pipeline calls (chunks of 500).
 * Never reads a payload, so it is cheap even for megabyte values, and a
 * missing key costs one pipeline slot instead of two round trips (kvGet
 * retries a miss over raw REST). Returns null when the REST backend is not
 * configured or any chunk fails — callers then fall back to reading.
 * zzz1049: each key is one billed command; keys held in the memory read cache are answered without asking.
 */
export async function kvExistsMany(keys: string[]): Promise<boolean[] | null> {
  if (keys.length === 0) return [];
  const creds = restCreds();
  if (!creds) return null;
  const out: Array<boolean | null> = keys.map((k) => {
    if (!readCacheOn() || !READ_CACHE.canCache(k)) return null;
    const h = READ_CACHE.get(k);
    if (!h.found) return null;
    KV_USAGE.cacheServed++;
    return h.text !== null;
  });
  const ask = out.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < ask.length; i += 500) {
    const idx = ask.slice(i, i + 500);
    const chunk = idx.map((j) => keys[j]);
    try {
      KV_USAGE.record('exists', chunk[0], chunk.length);
      const r = await fetch(`${creds.url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((k) => ['EXISTS', k])),
        cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return null;
      const j: any = await r.json();
      if (!Array.isArray(j) || j.length !== chunk.length) return null;
      j.forEach((x: any, n: number) => {
        const exists = Number(x?.result) > 0;
        out[idx[n]] = exists;
        if (!exists && readCacheOn()) READ_CACHE.put(chunk[n], null);   // known missing (a present key's value is not known here)
      });
    } catch { return null; }
  }
  return out as boolean[];
}
