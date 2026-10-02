// zzz855 — public entry for the safe localStorage layer.
//
// The runtime (compression, quota guard, read cache, migration) lives in
// ./storage/safe-storage-runtime.ts and is installed twice, idempotently:
//   1. as an inline <script> at the top of <head> in src/app/layout.tsx, so it
//      runs before ANY page bundle evaluates (hard ordering guarantee);
//   2. at module load of src/app/providers.tsx, as a backup if the inline
//      script was blocked or threw.
// Page code keeps calling localStorage.getItem/setItem as before.

import { installSafeStorage, safeStorageEarlyScript, SAFE_STORAGE_VERSION } from './storage/safe-storage-runtime';

export { installSafeStorage, safeStorageEarlyScript, SAFE_STORAGE_VERSION };

/** Install on the current window (no-op on the server or if already installed). */
export function ensureSafeStorage(): void {
  if (typeof window === 'undefined') return;
  try { installSafeStorage(window); } catch { /* never break the app */ }
}

/** True once a write could not be saved even after freeing cache space. */
export function isStorageFull(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__mcStorageFull;
}

/** Diagnostics: sizes per key, what was evicted, what is memory-only. */
export function storageStats(): any {
  if (typeof window === 'undefined') return null;
  const api = (window as any).__mcSafeStorage;
  return api ? api.stats() : null;
}

// Parsed-JSON read cache. For big keys, the runtime hands back the SAME
// decoded string object while the stored value is unchanged, so an identity
// check is enough to skip JSON.parse of multi-MB strings. Callers must treat
// the result as read-only (it is shared).
const parsed = new Map<string, { raw: string; val: unknown }>();
export function readJSON<T = unknown>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(key); } catch { return fallback; }
  if (raw == null) { parsed.delete(key); return fallback; }
  const hit = parsed.get(key);
  if (hit && hit.raw === raw) return hit.val as T;
  try {
    const val = JSON.parse(raw);
    parsed.set(key, { raw, val });
    return val as T;
  } catch {
    return fallback;
  }
}
