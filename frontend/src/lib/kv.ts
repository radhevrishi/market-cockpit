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
 */

import { Redis } from '@upstash/redis';

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

// In-memory fallback store
const MEM_STORE = (globalThis as any).__MC_KV_STORE__ || new Map<string, string>();
(globalThis as any).__MC_KV_STORE__ = MEM_STORE;

/**
 * Get a value from the KV store
 */
export async function kvGet<T = any>(key: string): Promise<T | null> {
  // PATCH 1018 — client FIRST (fast for small/cached keys), then a BOUNDED
  // raw-REST fallback only when the client returns nothing. The previous
  // raw-REST-primary version added an unbounded HTTP round-trip to every read
  // and could hang, pushing /api/market/quotes past Railway's 30s maxDuration
  // (→ "Movers fetch timed out"). Client reads are fast; raw-REST handles the
  // large blobs the @upstash client returns empty for (universe/mover-reasons).
  const r = getRedis();
  if (r) {
    try {
      const val = await r.get<T>(key);
      if (val !== null && val !== undefined) return val;
    } catch (e) {
      console.error(`[KV] Redis GET failed for ${key}:`, e);
    }
  }
  const _url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const _token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (_url && _token) {
    try {
      const resp = await fetch(`${_url.replace(/\/+$/, '')}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${_token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const j: any = await resp.json().catch(() => null);
        let raw: any = j?.result;
        if (raw !== null && raw !== undefined) {
          if (typeof raw === 'string') {
            try { let p: any = JSON.parse(raw); if (typeof p === 'string') p = JSON.parse(p); return p as T; }
            catch { return raw as unknown as T; }
          }
          return raw as T;
        }
      }
    } catch { /* fall through to memory */ }
  }
  const mem = MEM_STORE.get(key);
  if (mem) {
    try { return JSON.parse(mem) as T; } catch { return mem as unknown as T; }
  }
  return null;
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

export async function kvSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  // Always update memory store (fast path)
  MEM_STORE.set(key, serialized);

  // PATCH 1018 — skip oversized remote writes (Upstash 10 MB limit)
  if (serialized.length > KV_REMOTE_MAX_BYTES) {
    console.warn(`[KV] Skipping remote SET for ${key} — payload ${(serialized.length / 1048576).toFixed(1)} MB > ${(KV_REMOTE_MAX_BYTES / 1048576).toFixed(0)} MB safety cap. (Memory cache still populated.)`);
    return;
  }

  const r = getRedis();
  if (r) {
    try {
      if (ttlSeconds) {
        await r.set(key, value, { ex: ttlSeconds });
      } else {
        await r.set(key, value);
      }
    } catch (e) {
      console.error(`[KV] Redis SET failed for ${key}:`, e);
    }
  }
}

/**
 * Delete a key from the KV store
 */
export async function kvDel(key: string): Promise<void> {
  MEM_STORE.delete(key);
  const r = getRedis();
  if (r) {
    try { await r.del(key); } catch (e) { console.error(`[KV] Redis DEL failed for ${key}:`, e); }
  }
}

/**
 * Atomic SET-IF-NOT-EXISTS (distributed lock primitive)
 * Returns true if the lock was acquired, false if it already exists.
 */
export async function kvSetNX(key: string, value: any, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (r) {
    try {
      const result = await r.set(key, value, { nx: true, ex: ttlSeconds });
      return result === 'OK';
    } catch (e) {
      console.error(`[KV] Redis SETNX failed for ${key}:`, e);
      return false;
    }
  }
  // In-memory fallback
  if (MEM_STORE.has(key)) return false;
  MEM_STORE.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  return true;
}

/**
 * Atomic rename: swap temp key to production key
 * Writes temp first, then overwrites production atomically.
 */
export async function kvSwap(tempKey: string, prodKey: string, ttlSeconds?: number): Promise<boolean> {
  const r = getRedis();
  if (r) {
    try {
      // Read temp value and write to prod in two ops (Upstash REST doesn't support RENAME)
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
      MEM_STORE.set(prodKey, serialized);
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
  MEM_STORE.set(prodKey, val);
  MEM_STORE.delete(tempKey);
  return true;
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}
