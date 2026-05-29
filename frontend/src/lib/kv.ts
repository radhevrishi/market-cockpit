/**
 * Key-Value store abstraction for Market Cockpit
 *
 * Backend selection (first available wins):
 *   1. Railway Redis (TCP)  — when REDIS_URL (or REDIS_PRIVATE_URL / RAILWAY_REDIS_URL) is set.
 *                             Durable, NOT subject to the Upstash free-tier eviction that
 *                             caused the earnings-calendar flicker. Preferred on Railway.
 *   2. Upstash Redis (REST) — when UPSTASH_REDIS_REST_URL + _TOKEN (or KV_REST_API_*) are set.
 *                             Legacy path; kept for backward compatibility / zero-downtime cutover.
 *   3. In-memory (globalThis) — last-resort fallback; survives a warm process only.
 *
 * The cutover is automatic and safe: the app keeps using Upstash until REDIS_URL
 * is present in the environment, then switches to Railway Redis with no code change.
 *
 * Railway setup:
 *   1. Railway Dashboard -> your project -> New -> Database -> Add Redis
 *   2. Railway injects a connection URL var (REDIS_URL / REDIS_PRIVATE_URL) into the service
 *   3. Redeploy. (Set the Redis maxmemory-policy to `noeviction` so keys never drop.)
 */

import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis, { Redis as IORedisClient } from 'ioredis';

type Backend = 'railway' | 'upstash' | 'memory';

let backend: Backend | null = null;
let upstash: UpstashRedis | null = null;

// Railway (ioredis / TCP). Cache the client on globalThis so Next.js module
// re-evaluation / multiple route bundles do not open a new socket each time.
function getRailwayRedis(): IORedisClient | null {
  const url =
    process.env.REDIS_URL ||
    process.env.REDIS_PRIVATE_URL ||
    process.env.RAILWAY_REDIS_URL ||
    process.env.REDIS_PUBLIC_URL;
  if (!url) return null;

  const g = globalThis as any;
  if (g.__MC_IOREDIS__) return g.__MC_IOREDIS__ as IORedisClient;

  try {
    const client = new IORedis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    client.on('error', (e: any) => console.error('[KV] Railway Redis error:', e?.message || e));
    g.__MC_IOREDIS__ = client;
    console.log('[KV] Railway Redis (ioredis) connected');
    return client;
  } catch (e) {
    console.error('[KV] Failed to initialize Railway Redis:', e);
    return null;
  }
}

// Upstash (REST) — legacy, unchanged behavior.
function getUpstash(): UpstashRedis | null {
  if (upstash) return upstash;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    upstash = new UpstashRedis({ url, token });
    console.log('[KV] Upstash Redis connected');
    return upstash;
  } catch (e) {
    console.error('[KV] Failed to initialize Upstash Redis:', e);
    return null;
  }
}

function resolveBackend(): Backend {
  if (backend) return backend;
  if (getRailwayRedis()) backend = 'railway';
  else if (getUpstash()) backend = 'upstash';
  else {
    backend = 'memory';
    console.log('[KV] No Redis credentials found. Using in-memory fallback. Set REDIS_URL (Railway) or UPSTASH_REDIS_REST_URL for persistence.');
  }
  return backend;
}

// In-memory fallback store
const MEM_STORE = (globalThis as any).__MC_KV_STORE__ || new Map<string, string>();
(globalThis as any).__MC_KV_STORE__ = MEM_STORE;

function serialize(value: any): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// ioredis returns raw strings; reproduce Upstash's "auto-decode JSON, else raw" behavior.
function deserialize<T>(raw: string | null): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const b = resolveBackend();

  if (b === 'railway') {
    const r = getRailwayRedis();
    if (r) {
      try {
        return deserialize<T>(await r.get(key));
      } catch (e) {
        console.error(`[KV] Railway GET failed for ${key}:`, e);
      }
    }
  } else if (b === 'upstash') {
    const r = getUpstash();
    if (r) {
      try {
        return await r.get<T>(key);
      } catch (e) {
        console.error(`[KV] Upstash GET failed for ${key}:`, e);
      }
    }
  }

  const mem = MEM_STORE.get(key);
  if (mem) {
    try { return JSON.parse(mem) as T; } catch { return mem as unknown as T; }
  }
  return null;
}

export async function kvSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const serialized = serialize(value);

  // Always update memory store (fast path / read-after-write within a process)
  MEM_STORE.set(key, serialized);

  const b = resolveBackend();

  if (b === 'railway') {
    const r = getRailwayRedis();
    if (r) {
      try {
        if (ttlSeconds) await r.set(key, serialized, 'EX', ttlSeconds);
        else await r.set(key, serialized);
      } catch (e) {
        console.error(`[KV] Railway SET failed for ${key}:`, e);
      }
    }
  } else if (b === 'upstash') {
    const r = getUpstash();
    if (r) {
      try {
        if (ttlSeconds) await r.set(key, value, { ex: ttlSeconds });
        else await r.set(key, value);
      } catch (e) {
        console.error(`[KV] Upstash SET failed for ${key}:`, e);
      }
    }
  }
}

export async function kvDel(key: string): Promise<void> {
  MEM_STORE.delete(key);
  const b = resolveBackend();
  if (b === 'railway') {
    const r = getRailwayRedis();
    if (r) { try { await r.del(key); } catch (e) { console.error(`[KV] Railway DEL failed for ${key}:`, e); } }
  } else if (b === 'upstash') {
    const r = getUpstash();
    if (r) { try { await r.del(key); } catch (e) { console.error(`[KV] Upstash DEL failed for ${key}:`, e); } }
  }
}

export async function kvSetNX(key: string, value: any, ttlSeconds: number): Promise<boolean> {
  const b = resolveBackend();

  if (b === 'railway') {
    const r = getRailwayRedis();
    if (r) {
      try {
        const result = await r.set(key, serialize(value), 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch (e) {
        console.error(`[KV] Railway SETNX failed for ${key}:`, e);
        return false;
      }
    }
  } else if (b === 'upstash') {
    const r = getUpstash();
    if (r) {
      try {
        const result = await r.set(key, value, { nx: true, ex: ttlSeconds });
        return result === 'OK';
      } catch (e) {
        console.error(`[KV] Upstash SETNX failed for ${key}:`, e);
        return false;
      }
    }
  }

  if (MEM_STORE.has(key)) return false;
  MEM_STORE.set(key, serialize(value));
  return true;
}

export async function kvSwap(tempKey: string, prodKey: string, ttlSeconds?: number): Promise<boolean> {
  const b = resolveBackend();

  if (b === 'railway') {
    const r = getRailwayRedis();
    if (r) {
      try {
        const val = await r.get(tempKey); // raw string
        if (val === null) return false;
        if (ttlSeconds) await r.set(prodKey, val, 'EX', ttlSeconds);
        else await r.set(prodKey, val);
        await r.del(tempKey);
        MEM_STORE.set(prodKey, val);
        MEM_STORE.delete(tempKey);
        return true;
      } catch (e) {
        console.error(`[KV] Railway SWAP failed ${tempKey} -> ${prodKey}:`, e);
        return false;
      }
    }
  } else if (b === 'upstash') {
    const r = getUpstash();
    if (r) {
      try {
        const val = await r.get(tempKey);
        if (val === null) return false;
        if (ttlSeconds) await r.set(prodKey, val, { ex: ttlSeconds });
        else await r.set(prodKey, val);
        await r.del(tempKey);
        const serialized = typeof val === 'string' ? val : JSON.stringify(val);
        MEM_STORE.set(prodKey, serialized);
        MEM_STORE.delete(tempKey);
        return true;
      } catch (e) {
        console.error(`[KV] Upstash SWAP failed ${tempKey} -> ${prodKey}:`, e);
        return false;
      }
    }
  }

  const val = MEM_STORE.get(tempKey);
  if (!val) return false;
  MEM_STORE.set(prodKey, val);
  MEM_STORE.delete(tempKey);
  return true;
}

export function isRedisAvailable(): boolean {
  return resolveBackend() !== 'memory';
}

export function kvBackend(): Backend {
  return resolveBackend();
}
