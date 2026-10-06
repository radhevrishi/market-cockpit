// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

export const STORAGE_KEY = 'mb_excel_scored_v2';
export const STORAGE_META = 'mb_excel_meta_v2';
const MB_IDB_DB = 'mc-mb';
const MB_IDB_STORE = 'kv';
function mbIdbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(MB_IDB_DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(MB_IDB_STORE)) db.createObjectStore(MB_IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
// PATCH 1101i — Persistence primitives hardened. The outer `.catch(() => {})`
// on mbIdbSet was swallowing all IDB write failures and resolving the Promise
// to undefined — meaning callers' `.then()` would fire even when the write
// had silently failed. That's exactly why META was being written without
// IDB data (the "Saved data lost (N stocks)" banner root cause).
//
// Now: writes that fail REJECT the Promise so callers can branch correctly.
// Also: console.warn on failure so the user (and us) can see what happened
// in DevTools instead of silent loss.
export function mbIdbSet(key: string, val: string): Promise<void> {
  return mbIdbOpen().then(db => new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(MB_IDB_STORE, 'readwrite');
      tx.objectStore(MB_IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        try { console.warn('[mb-idb] write tx error', key, tx.error); } catch {}
        reject(tx.error || new Error('IDB tx error'));
      };
      tx.onabort = () => {
        try { console.warn('[mb-idb] write tx abort', key, tx.error); } catch {}
        reject(tx.error || new Error('IDB tx abort'));
      };
    } catch (e) {
      try { console.warn('[mb-idb] write threw', key, e); } catch {}
      reject(e);
    }
  })).catch((e) => {
    // Surface the failure to the caller so they can stop writing META.
    try { console.warn('[mb-idb] write failed (rethrowing)', key, e); } catch {}
    throw e;
  });
}
export function mbIdbGet(key: string): Promise<string | null> {
  return mbIdbOpen().then(db => new Promise<string | null>((resolve, reject) => {
    try {
      const tx = db.transaction(MB_IDB_STORE, 'readonly');
      const r = tx.objectStore(MB_IDB_STORE).get(key);
      r.onsuccess = () => resolve((r.result as string) ?? null);
      r.onerror = () => {
        try { console.warn('[mb-idb] read request error', key, r.error); } catch {}
        reject(r.error || new Error('IDB read error'));
      };
    } catch (e) {
      reject(e);
    }
  })).catch((e) => {
    // Read failure → return null so caller treats as "no data", but log it
    // so future debugging of empty hydration is possible. Differs from write:
    // a failed read isn't catastrophic, but we don't want to silently lie
    // either when investigating the orphan-META mystery.
    try { console.warn('[mb-idb] read failed → returning null', key, e); } catch {}
    return null;
  });
}
export function mbIdbDel(key: string): Promise<void> {
  return mbIdbOpen().then(db => new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(MB_IDB_STORE, 'readwrite');
      tx.objectStore(MB_IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  })).catch(() => {});
}

// PATCH 1101i — Resilient IDB read with retry. The browser's IDB layer can
// be slow to initialize on cold start or after heavy other-tab activity, so
// a single read attempt occasionally returns null even when data exists.
// Retry up to 4 times with backoff before giving up.
export async function mbIdbGetWithRetry(key: string, retries = 4, delayMs = 250): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const raw = await mbIdbGet(key);
      if (raw && raw !== '[]') return raw;
    } catch {}
    if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
  }
  return null;
}

// PATCH 1101l — Server-side persistence layer (Upstash Redis via Railway).
// localStorage + IDB are both subject to browser eviction under storage
// pressure — the "Saved data lost (N stocks)" banner kept recurring even
// after 1101i hardened the IDB write path. This third layer survives ALL
// local browser eviction by stashing the scored JSON on Railway under an
// anonymous client UUID stored in localStorage. POST happens after every
// successful upload; GET happens on hydration ONLY when both local layers
// are empty.
const MB_CLIENT_ID_KEY = 'mb_client_id_v1';
function mbGetClientId(): string {
  try {
    let cid = localStorage.getItem(MB_CLIENT_ID_KEY);
    if (cid && /^[a-zA-Z0-9_-]{8,64}$/.test(cid)) return cid;
    // Generate a new anonymous UUID. Format: 12 chars random base36.
    cid = 'mb-' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
    localStorage.setItem(MB_CLIENT_ID_KEY, cid);
    return cid;
  } catch {
    // localStorage unavailable (private browsing) — fall back to session UUID.
    return 'mb-' + Math.random().toString(36).slice(2, 11);
  }
}
export async function mbServerSnapshotSave(snapshot: string, count: number, market: 'IN' | 'USA' = 'IN'): Promise<boolean> {
  try {
    const clientId = mbGetClientId();
    const res = await fetch('/api/v1/multibagger/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, snapshot, count, market }),
      // Don't block UI on this — but do await so we surface failures.
    });
    if (!res.ok) {
      try { console.warn('[mb-server-snapshot] save failed', res.status, await res.text()); } catch {}
      return false;
    }
    return true;
  } catch (e) {
    try { console.warn('[mb-server-snapshot] save threw', e); } catch {}
    return false;
  }
}
export async function mbServerSnapshotLoad(market: 'IN' | 'USA' = 'IN'): Promise<string | null> {
  try {
    const clientId = mbGetClientId();
    const res = await fetch(`/api/v1/multibagger/snapshot?clientId=${encodeURIComponent(clientId)}&market=${market}`);
    if (!res.ok) return null;
    const j = await res.json();
    return (j?.snapshot as string) || null;
  } catch (e) {
    try { console.warn('[mb-server-snapshot] load threw', e); } catch {}
    return null;
  }
}
// Request persistent storage so browsers don't evict IDB under pressure.
// This is best-effort — Safari rarely honors it, Chrome/Firefox usually do.
export function mbRequestPersistentStorage(): void {
  try {
    if (typeof navigator !== 'undefined'
        && navigator.storage
        && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().then((granted) => {
        try { console.log('[mb-persist] navigator.storage.persist() →', granted); } catch {}
      }).catch(() => {});
    }
  } catch {}
}
