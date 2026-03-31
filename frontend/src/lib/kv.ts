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
  const r = getRedis();
  if (r) {
    try {
      const val = await r.get<T>(key);
      return val;
    } catch (e) {
      console.error(`[KV] Redis GET failed for ${key}:`, e);
    }
  }
  // Fallback to memory
  const mem = MEM_STORE.get(key);
  if (mem) {
    try { return JSON.parse(mem) as T; } catch { return mem as unknown as T; }
  }
  return null;
}

/**
 * Set a value in the KV store with optional TTL (seconds)
 */
export async function kvSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  // Always update memory store (fast path)
  MEM_STORE.set(key, serialized);

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
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}
