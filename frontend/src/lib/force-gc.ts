/**
 * zzz1255 — full garbage collection on demand (server only).
 *
 * The scheduler's heap guard reads process.memoryUsage().heapUsed. That figure includes dead objects until V8
 * runs a full collection, and an idle web process may not run one for a long time: on 11 Nov the heap sat at
 * 2.3–2.4 GB with no job running and the guard held the 12:23 UTC transformational-archive slot. Collecting
 * first tells garbage (freed at once) from memory that is really kept.
 *
 * Node has no gc() unless started with --expose-gc; setting the flag at run time and taking gc from a new
 * context gives the same function. Returns null when it cannot run (never throws).
 */
let gcFn: (() => void) | null | undefined;
let lastAt = 0;
export const FORCE_GC_MIN_GAP_MS = 5 * 60_000;

function getGc(): (() => void) | null {
  if (gcFn !== undefined) return gcFn;
  try {
    const g = (globalThis as any).gc;
    if (typeof g === 'function') return (gcFn = g);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v8 = require('v8'); const vm = require('vm');
    v8.setFlagsFromString('--expose-gc');
    const f = vm.runInNewContext('gc');
    gcFn = typeof f === 'function' ? f : null;
  } catch { gcFn = null; }
  return gcFn ?? null;
}

/** Pure: may a forced collection run now? (at most once every 5 minutes — a full collection pauses the process briefly) */
export function forceGcDue(lastAtMs: number, nowMs: number, gapMs = FORCE_GC_MIN_GAP_MS): boolean {
  return lastAtMs <= 0 || nowMs - lastAtMs >= gapMs;
}

/** Run a full collection (rate-limited). Returns heap used before / after in MB, or null when skipped / unavailable. */
export function forceFullGc(): { beforeMb: number; afterMb: number } | null {
  const now = Date.now();
  if (!forceGcDue(lastAt, now)) return null;
  const gc = getGc();
  if (!gc) return null;
  lastAt = now;
  const before = process.memoryUsage().heapUsed;
  try { gc(); } catch { return null; }
  const after = process.memoryUsage().heapUsed;
  return { beforeMb: Math.round(before / 1048576), afterMb: Math.round(after / 1048576) };
}
