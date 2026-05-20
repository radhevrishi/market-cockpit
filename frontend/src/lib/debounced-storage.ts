// AUDIT_100 #95 — Debounced localStorage writes.
//
// Many pages re-stringify and write large objects (50KB+) to localStorage on
// every state change. Doing this synchronously inside a useEffect blocks the
// main thread + thrashes the disk. This helper coalesces writes per-key onto
// a single setTimeout with a 250ms idle window.
//
// Usage:
//   import { debouncedSetItem, flushDebouncedWrites } from '@/lib/debounced-storage';
//   debouncedSetItem('mc:graded:v9:2026-05-20', JSON.stringify(payload));
//   // Optional: force-flush on page hide / unmount.
//   flushDebouncedWrites();
//
// Notes:
// - Safe in SSR — guards typeof window.
// - On `pagehide` (browser auto-flush) we synchronously drain pending writes
//   so users navigating away don't lose their last 250ms of typing.

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 250;

function drain() {
  if (typeof window === 'undefined') return;
  for (const [k, v] of pending.entries()) {
    try { localStorage.setItem(k, v); } catch { /* QuotaExceeded handled by callers */ }
  }
  pending.clear();
  timer = null;
}

export function debouncedSetItem(key: string, value: string) {
  if (typeof window === 'undefined') return;
  pending.set(key, value);
  if (timer) clearTimeout(timer);
  timer = setTimeout(drain, IDLE_MS);
}

export function flushDebouncedWrites() {
  if (timer) clearTimeout(timer);
  drain();
}

// Auto-flush on page hide so users don't lose unsaved state on tab close.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flushDebouncedWrites(); });
  window.addEventListener('beforeunload', () => { flushDebouncedWrites(); });
}
