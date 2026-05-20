// AUDIT_100 #58 — Read-it-later queue for news articles.
// localStorage `mc:reading-list:v1` stores an array of article IDs the user
// wants to revisit. Capped at 200 items. Cross-tab sync via storage event
// + 'mc:reading-list:updated' custom event.

const KEY = 'mc:reading-list:v1';
const MAX = 200;

export function getReadingList(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

export function isInReadingList(id: string): boolean {
  if (!id) return false;
  return getReadingList().includes(id);
}

function save(next: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent('mc:reading-list:updated'));
  } catch {}
}

export function addToReadingList(id: string) {
  if (!id || typeof window === 'undefined') return;
  const cur = getReadingList();
  if (cur.includes(id)) return;
  save([id, ...cur]);
}

export function removeFromReadingList(id: string) {
  if (!id || typeof window === 'undefined') return;
  const cur = getReadingList();
  if (!cur.includes(id)) return;
  save(cur.filter(x => x !== id));
}

export function toggleReadingList(id: string): boolean {
  if (!id || typeof window === 'undefined') return false;
  const cur = getReadingList();
  if (cur.includes(id)) {
    save(cur.filter(x => x !== id));
    return false;
  } else {
    save([id, ...cur]);
    return true;
  }
}
