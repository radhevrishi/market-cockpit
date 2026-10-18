// zzz1093 (evening retest R2) — merge-overflow recovery records stay VISIBLE until the owner dismisses them, also after a reload
// or on another page (they were only shown when the event fired, and vanished on remount while the copy was still stored).
// A record: localStorage `mc:vault:overflow:<key>` = { at, message, local, server, dismissed? }. Dismiss hides the notice and
// KEEPS the copy; "Delete copy" removes it. Pure helpers over a Storage-like object.
export const OVERFLOW_PREFIX = 'mc:vault:overflow:';
export interface OverflowNotice { key: string; message: string; at: string | null }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function pendingOverflows(s: Store | null | undefined): OverflowNotice[] {
  if (!s) return [];
  const out: OverflowNotice[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(OVERFLOW_PREFIX)) continue;
    try {
      const r = JSON.parse(s.getItem(k) || 'null');
      if (!r || r.dismissed) continue;
      out.push({ key: k.slice(OVERFLOW_PREFIX.length), message: String(r.message || 'Some items did not fit the list limit.'), at: typeof r.at === 'string' ? r.at : null });
    } catch { /* not ours */ }
  }
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
export function dismissOverflow(s: Store, key: string): boolean {
  try {
    const r = JSON.parse(s.getItem(OVERFLOW_PREFIX + key) || 'null');
    if (!r) return false;
    s.setItem(OVERFLOW_PREFIX + key, JSON.stringify({ ...r, dismissed: true }));
    return true;
  } catch { return false; }
}
export function deleteOverflow(s: Store, key: string): void { try { s.removeItem(OVERFLOW_PREFIX + key); } catch { /* blocked */ } }
/** Keep the record; true only when it was really written (so the notice never claims a copy that is not there). */
export function storeOverflow(s: Store, key: string, rec: Record<string, unknown>): boolean {
  try { s.setItem(OVERFLOW_PREFIX + key, JSON.stringify(rec)); return s.getItem(OVERFLOW_PREFIX + key) != null; } catch { return false; }
}
