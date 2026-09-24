// ═══════════════════════════════════════════════════════════════════════════
// US SPECIAL FOCUS MEMORY.                                           (zzz790)
//
// The shared pure merge (lib/catalyst/persistence-store mergeDetections /
// focusStatus) on its OWN key, `us-persist:v1:all`, so a US detection never
// lands in the India memory (`persist:v1:all`) and India's never here.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet as realKvGet, kvSet as realKvSet } from '@/lib/kv';
import { mergeDetections, type PersistBlob, type StoredCatalyst, type UserFocusState } from '@/lib/catalyst/persistence-store';
import type { PersistentCatalyst } from '@/lib/catalyst/persistence';

export const US_PERSIST_KEY = 'us-persist:v1:all';

type KvLike = { get: <T = any>(k: string) => Promise<T | null>; set: (k: string, v: any) => Promise<void> };
let kv: KvLike = { get: realKvGet, set: (k, v) => realKvSet(k, v) };
export function setUsFocusKvForTests(fake: KvLike | null): void {
  kv = fake || { get: realKvGet, set: (k, v) => realKvSet(k, v) };
}

export async function loadUsPersist(): Promise<PersistBlob> {
  const b = await kv.get<PersistBlob>(US_PERSIST_KEY).catch(() => null);
  return b && b.records ? b : { version: 1, seq: 0, records: {} };
}

export async function upsertUsDetections(list: PersistentCatalyst[]): Promise<{ changed: number; blob: PersistBlob }> {
  const blob = await loadUsPersist();
  if (!list.length) return { changed: 0, blob };
  const { changed } = mergeDetections(blob, list, 'portfolio');
  if (changed) await kv.set(US_PERSIST_KEY, blob);
  return { changed, blob };
}

export async function setUsUserState(id: string, state: UserFocusState | null, note: string | null = null): Promise<StoredCatalyst | null> {
  const blob = await loadUsPersist();
  const rec = blob.records[id];
  if (!rec) return null;
  rec.user = state ? { state, at: new Date().toISOString(), note: note ? String(note).slice(0, 300) : null } : null;
  if (state === 'confirmed' && !rec.sfId) rec.sfId = ++blob.seq;
  if (state === 'confirmed') rec.everSpecialFocus = true;
  await kv.set(US_PERSIST_KEY, blob);
  return rec;
}
