// ═══════════════════════════════════════════════════════════════════════════
// THE DAY CACHE — why this is not localStorage any more.
//
// The US Earnings Opportunities page fetches one EDGAR session at a time and
// caches each day, so a 60-session window costs only the days it has not seen.
// That is what makes the long windows usable at all: the second visit is
// instant.
//
// It stopped working, and the reason is worth writing down because it will
// happen again to whoever grows the payload next.
//
// localStorage gives a page about 5 MB, TOTAL, for the whole origin. When the
// day cache was written, a day held four quarters and a handful of numbers per
// filer, and 90 days fitted comfortably. Since then a day has grown to carry,
// for EVERY filer on it: sixteen quarters of revenue / gross profit / operating
// income / net income / EPS / CFO / FCF, a balance sheet, the filer's own prior
// guidance with verbatim quotes, this quarter's guidance with verbatim quotes,
// the guide-vs-guide diff, per-tile benchmarks, the setup factors, the
// quality/inflection components, the implied-arithmetic derivations and the
// XBRL tag provenance. A busy session is now megabytes on its own.
//
// So the quota filled after two or three days. Every subsequent write threw,
// and the old eviction — which counted DAYS, not BYTES — looked at "5 days
// cached, limit 90" and correctly concluded there was nothing to evict. The
// write failed silently, by design ("the page renders fine uncached"), and the
// result was that NOTHING was ever cached again: every visit re-swept the whole
// window from EDGAR, which is exactly what the cache existed to prevent, and
// which reads to the user as "why is it always loading".
//
// IndexedDB is the right store for this and always was: it is measured in
// hundreds of megabytes rather than five, it holds structured values without a
// JSON round-trip through a string, and it is asynchronous, which suits a cache
// read that already happens inside an async fetcher.
//
// Two rules this module keeps, so the failure cannot recur:
//   1. EVICTION IS BY BYTES. Every record stores its own size; the budget is a
//      byte budget. A payload that grows tenfold evicts ten times as much
//      rather than silently disabling the cache.
//   2. EVERY PATH DEGRADES, NONE THROWS. Private windows, disabled storage and
//      quota exhaustion all end in "no cache", never in a broken page. The
//      localStorage fallback below is deliberately tiny — it exists so the
//      feature still works where IndexedDB does not, not to be fast.
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = 'mc-us-days';
const DB_VERSION = 1;
const STORE = 'days';

/** Byte budget for the whole day cache. IndexedDB will happily hold far more,
 *  but there is no reason to keep a quarter of EDGAR on a laptop forever, and a
 *  bounded store is one less thing that can surprise the user later. */
const MAX_BYTES = 120 * 1024 * 1024;
/** Never keep more sessions than the longest window can ask for, with room to
 *  spare, so a user who moves the date back and forth still gets cache hits. */
const MAX_DAYS = 120;

/** localStorage fallback: a hard cap far below the 5 MB origin quota, so the
 *  day cache can never starve the calendar cache that shares it. */
const LS_FALLBACK_PREFIX = 'mc:graded-us:v3:';
const LS_FALLBACK_MAX_BYTES = 1_500_000;

interface DayRecord {
  day: string;          // ISO session date — the key
  payload: unknown;
  cachedAt: number;     // epoch ms
  bytes: number;        // approximate serialized size, for the byte budget
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'day' });
          os.createIndex('cachedAt', 'cachedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // Safari in a private window can hang here rather than erroring.
      setTimeout(() => resolve(null), 3000);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
        t.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }).catch(() => null);
}

/** Approximate byte size without paying for a second full serialization. */
function sizeOf(payload: unknown): number {
  try { return JSON.stringify(payload).length * 2; } catch { return 0; }
}

// ── localStorage fallback ──────────────────────────────────────────────────

function lsGet(day: string): DayRecord | null {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_PREFIX + day);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { day, payload: o, cachedAt: Date.parse(o?._cachedAt || '') || 0, bytes: raw.length * 2 };
  } catch { return null; }
}

function lsPut(day: string, payload: unknown): void {
  try {
    const body = JSON.stringify({ ...(payload as object), _cachedAt: new Date().toISOString() });
    if (body.length * 2 > LS_FALLBACK_MAX_BYTES) return;   // too big to be worth it
    try {
      localStorage.setItem(LS_FALLBACK_PREFIX + day, body);
    } catch {
      // Evict every fallback day and try once. The fallback is a courtesy, not
      // a store — one day cached beats none, and none beats a thrown error.
      lsClear();
      try { localStorage.setItem(LS_FALLBACK_PREFIX + day, body); } catch { /* uncached */ }
    }
  } catch { /* storage unavailable */ }
}

function lsClear(): void {
  try {
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_FALLBACK_PREFIX)) kill.push(k);
    }
    for (const k of kill) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Read one cached session. Returns null for a miss, for anything past its age
 * limit, and for a payload that was never worth keeping.
 *
 * A completed session is immutable on EDGAR, so it is held for 30 days; today's
 * keeps moving as 8-Ks land, so it expires in 10 minutes.
 */
export async function getCachedDay(day: string, isToday: boolean): Promise<any | null> {
  const maxAge = isToday ? 10 * 60_000 : 30 * 24 * 3600_000;
  let rec = await tx<DayRecord>('readonly', (s) => s.get(day) as IDBRequest<DayRecord>);
  if (!rec) rec = lsGet(day);
  if (!rec || !rec.payload) return null;
  const age = Date.now() - (rec.cachedAt || 0);
  if (!Number.isFinite(age) || age > maxAge) return null;
  const p: any = rec.payload;
  if (!p?.by_tier) return null;
  // A scan that found filers but graded NONE of them is a failed scan, not a
  // result. Never serve it from cache — refetch.
  if ((p.raw_items_total ?? 0) > 0 && (p.candidates_total ?? 0) === 0) return null;
  return p;
}

/** Cache one session. Never throws; a failure simply means no cache. */
export async function putCachedDay(day: string, payload: any): Promise<void> {
  if (!payload?.by_tier) return;
  if ((payload.raw_items_total ?? 0) > 0 && (payload.candidates_total ?? 0) === 0) return;
  const rec: DayRecord = { day, payload, cachedAt: Date.now(), bytes: sizeOf(payload) };
  const db = await openDb();
  if (!db) { lsPut(day, payload); return; }
  await tx('readwrite', (s) => s.put(rec) as IDBRequest<any>);
  await evict();
}

/**
 * Hold the store inside its byte and day budgets, oldest first.
 *
 * "Oldest" is the session date, not the write time: the day furthest in the
 * past is the one least likely to be asked for again, and it is also the one
 * whose numbers will never change.
 */
async function evict(): Promise<void> {
  const all = await tx<DayRecord[]>('readonly', (s) => s.getAll() as IDBRequest<DayRecord[]>);
  if (!all || !all.length) return;
  all.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));   // ISO sorts chronologically
  let total = all.reduce((n, r) => n + (r.bytes || 0), 0);
  const kill: string[] = [];
  let i = 0;
  while (i < all.length && (total > MAX_BYTES || all.length - kill.length > MAX_DAYS)) {
    kill.push(all[i].day);
    total -= all[i].bytes || 0;
    i++;
  }
  for (const d of kill) await tx('readwrite', (s) => s.delete(d) as IDBRequest<any>);
}

/** Wipe the whole day cache — the "hard refresh" the user asks for explicitly. */
export async function clearDayCache(): Promise<void> {
  await tx('readwrite', (s) => s.clear() as IDBRequest<any>);
  lsClear();
}

/** How much is cached, for the status strip. Cheap enough to call on mount. */
export async function dayCacheStats(): Promise<{ days: number; bytes: number }> {
  const all = await tx<DayRecord[]>('readonly', (s) => s.getAll() as IDBRequest<DayRecord[]>);
  if (!all) return { days: 0, bytes: 0 };
  return { days: all.length, bytes: all.reduce((n, r) => n + (r.bytes || 0), 0) };
}

/**
 * One-time cleanup of the localStorage day caches this module replaces. They
 * are dead weight against a 5 MB quota the calendar cache still shares.
 */
export function scrubLegacyDayCaches(): void {
  try {
    const MARK = 'mc:us-days:migrated:v1';
    if (localStorage.getItem(MARK) === '1') return;
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('mc:graded-us:v1:') || k.startsWith('mc:graded-us:v2:')
        || k.startsWith(LS_FALLBACK_PREFIX))) kill.push(k);
    }
    for (const k of kill) localStorage.removeItem(k);
    localStorage.setItem(MARK, '1');
  } catch { /* storage unavailable */ }
}
