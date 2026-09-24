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
import { catalystIsolated } from './sanitize';
export { catalystIsolated } from './sanitize';

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

// ── ONE COMPANY PER RECORD.                                          (zzz793)
// The memory is keyed `${TICKER}:${KIND}`. A detection is accepted — and a
// stored record is shown — only when its id, its ticker and its evidence all
// name the same company: every EDGAR address in its evidence carries one CIK,
// and (when the ticker's CIK is known) that CIK is the ticker's own. The NTNX
// card showed RELL's order book; a record like that is never written or read.
/** The blob with every record that fails the isolation test removed (the
 *  stored copy is not rewritten here; the next upsert writes the clean one). */
export function isolatedUsBlob(blob: PersistBlob, ciks: Record<string, number | null> = {}): PersistBlob {
  const records: PersistBlob['records'] = {};
  for (const [id, r] of Object.entries(blob.records || {})) {
    if (!r || String(r.ticker || '').toUpperCase() !== String(r.latest?.ticker || r.ticker || '').toUpperCase()) continue;
    if (!catalystIsolated({ ...(r.latest as any), id, ticker: r.ticker }, ciks[String(r.ticker).toUpperCase()] ?? null)) continue;
    records[id] = r;
  }
  return { ...blob, records };
}

export async function upsertUsDetections(list0: PersistentCatalyst[], ciks: Record<string, number | null> = {}): Promise<{ changed: number; blob: PersistBlob }> {
  const raw = await loadUsPersist();
  const blob = isolatedUsBlob(raw, ciks);
  const dropped = Object.keys(raw.records || {}).length - Object.keys(blob.records).length;
  const list = list0.filter((pc) => catalystIsolated(pc as any, ciks[String(pc.ticker).toUpperCase()] ?? null));
  const { changed } = list.length ? mergeDetections(blob, list, 'portfolio') : { changed: 0 };
  if (changed || dropped > 0) await kv.set(US_PERSIST_KEY, blob);
  return { changed: changed + Math.max(0, dropped), blob };
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
