// zzz969 — several named drawing sets for one chart ("Long-term thesis", "Earnings setup", "Tactical levels"). The first set is
// the drawings saved before sets existed (stored under the plain key, so nothing moves); other sets are stored under
// `<key>#<set-id>` in the same synced drawing store. Which set is open per chart is remembered (and synced) here.
export const DRAWING_SETS_KEY = 'mc:chart-drawing-sets:v1';
export const MAIN_SET = 'main';
export interface SetsStore { v: 1; sets: Record<string, Array<{ id: string; name: string }>>; active: Record<string, string> }

export const slugSet = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'set';
export const withSet = (key: string, set: string | null | undefined) => (!set || set === MAIN_SET ? key : `${key}#${set}`);

export function readSets(raw: unknown): SetsStore {
  const out: SetsStore = { v: 1, sets: {}, active: {} };
  const r: any = raw;
  if (!r || typeof r !== 'object') return out;
  for (const [k, list] of Object.entries<any>(r.sets || {})) {
    if (!Array.isArray(list)) continue;
    const clean = list.filter((x: any) => x && typeof x.id === 'string' && /^[a-z0-9-]{1,24}$/.test(x.id) && x.id !== MAIN_SET && typeof x.name === 'string').slice(0, 12)
      .map((x: any) => ({ id: x.id, name: String(x.name).slice(0, 40) }));
    if (clean.length) out.sets[k] = clean;
  }
  for (const [k, v] of Object.entries<any>(r.active || {})) if (typeof v === 'string' && (v === MAIN_SET || out.sets[k]?.some((s) => s.id === v))) out.active[k] = v;
  return out;
}
export function loadSets(): SetsStore {
  try { return readSets(JSON.parse(localStorage.getItem(DRAWING_SETS_KEY) || 'null')); } catch { return readSets(null); }
}
export function saveSets(s: SetsStore): boolean {
  try { localStorage.setItem(DRAWING_SETS_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export const activeSetOf = (s: SetsStore, key: string) => s.active[key] || MAIN_SET;
export const setsOf = (s: SetsStore, key: string) => [{ id: MAIN_SET, name: 'Main' }, ...(s.sets[key] || [])];

export function addSet(s: SetsStore, key: string, name: string): { store: SetsStore; id: string } {
  const base = slugSet(name);
  const have = new Set(setsOf(s, key).map((x) => x.id));
  let id = base === MAIN_SET ? 'main-2' : base, i = 2;
  while (have.has(id)) id = `${base}-${i++}`.slice(0, 24);
  const list = [...(s.sets[key] || []), { id, name: name.trim().slice(0, 40) || id }].slice(0, 12);
  return { store: { ...s, sets: { ...s.sets, [key]: list }, active: { ...s.active, [key]: id } }, id };
}
export function removeSet(s: SetsStore, key: string, id: string): SetsStore {
  if (id === MAIN_SET) return s;
  const list = (s.sets[key] || []).filter((x) => x.id !== id);
  const sets = { ...s.sets }; if (list.length) sets[key] = list; else delete sets[key];
  const active = { ...s.active }; if (active[key] === id) delete active[key];
  return { ...s, sets, active };
}
export const chooseSet = (s: SetsStore, key: string, id: string): SetsStore => ({ ...s, active: { ...s.active, [key]: id } });
