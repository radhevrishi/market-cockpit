// ─────────────────────────────────────────────────────────────────────────────
// seen-store (zzz514) — a tiny per-surface "what's new / dismissed" memory.
//
// Lets any board show only what CHANGED since you last looked, and lets you
// dismiss items you've acted on. Keyed by a surface id (e.g. 'cockpit').
// Everything is localStorage + SSR-guarded; every write emits 'seen:updated'.
// ─────────────────────────────────────────────────────────────────────────────

const SEEN_KEY = (k: string) => `mc:seen:${k}:v1`;
const DISMISS_KEY = (k: string) => `mc:dismissed:${k}:v1`;

function readSet(storeKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storeKey);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch { return new Set(); }
}

function writeSet(storeKey: string, s: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storeKey, JSON.stringify([...s].slice(0, 4000)));
    window.dispatchEvent(new CustomEvent('seen:updated'));
  } catch { /* quota / disabled */ }
}

/** Ids seen the last time markSeen() was called for this surface. */
export function getSeen(surface: string): Set<string> {
  return readSet(SEEN_KEY(surface));
}

/** Of `ids`, the ones NOT in the last-seen set (i.e. new since last visit). */
export function diffNew(surface: string, ids: string[]): Set<string> {
  const seen = getSeen(surface);
  return new Set(ids.map(String).filter((id) => !seen.has(id)));
}

/** Record the current ids as "seen" (call after showing the board). */
export function markSeen(surface: string, ids: string[]): void {
  writeSet(SEEN_KEY(surface), new Set(ids.map(String)));
}

export function getDismissed(surface: string): Set<string> {
  return readSet(DISMISS_KEY(surface));
}
export function isDismissed(surface: string, id: string): boolean {
  return getDismissed(surface).has(String(id));
}
export function dismiss(surface: string, id: string): void {
  const s = getDismissed(surface);
  s.add(String(id));
  writeSet(DISMISS_KEY(surface), s);
}
export function undismiss(surface: string, id: string): void {
  const s = getDismissed(surface);
  s.delete(String(id));
  writeSet(DISMISS_KEY(surface), s);
}
export function clearDismissed(surface: string): void {
  writeSet(DISMISS_KEY(surface), new Set());
}
