// zzz926 — ONE "results with rows" index PER MARKET, so every India result the extractor ever kept can be read.
//
// Why: the readers took the newest 2,500 ids of the shared ok index (guidance-extract:v1:index:ok, newest EXTRACTION first, up to 8,000).
// On 6 Oct 2026 the page read exactly 2,500 results (India 950 + US 1,550): the rest were never seen. The ones cut off are the oldest
// extractions — India's Q4 FY26 calls (May / early June), which are exactly the EARLIER guidance an August call is compared with
// (their document-index rows were also lost in the zzz916 index wipe, so nothing else points at them). An India raise (May guide →
// August guide) could therefore not be found: India 0 raises in 120 days, US 236 (a US filing states "raised from X to Y" itself).
//
//   guidance-extract:v1:index:ok:IN / :US       -> string[] docIds with an ok result with rows, newest extraction first
//   guidance-extract:v1:index:ok:market-state   -> { pos, done, total, head, counts } — where the walk of the shared ok index stands
//
// syncMarketIndex (called by the extract route on every call, after the run): (1) ids that appeared at the FRONT of the shared ok index
// since the last call (new extractions) are put first in their market's list; (2) a one-time walk of the rest of the shared index,
// `maxIds` per call, appends the older ones. The market of an id is read from its stored result (chunks of 100).
// Safety (the zzz916 lesson): lists and state are read STRICTLY — a failed read throws and nothing is written; a chunk whose results
// all come back empty does not move the walk forward (three such stalls in a row on the same place skip that chunk: expired results).

export const MARKET_INDEX_KEY = (m: 'IN' | 'US') => `guidance-extract:v1:index:ok:${m}`;
export const MARKET_STATE_KEY = 'guidance-extract:v1:index:ok:market-state';
export const SHARED_OK_INDEX_KEY = 'guidance-extract:v1:index:ok';
const RESULT_KEY = (id: string) => `guidance-extract:v1:${id}`;
export const MARKET_INDEX_MAX = 8_000;
/** What one read takes per market (newest first). India needs its old calls (the earlier guidance); the US states raises in one filing. */
export const MARKET_READ_CAP: Record<'IN' | 'US', number> = { IN: 4_000, US: 2_500 };
const TTL_S = 270 * 86_400;
const HEAD_SCAN_MAX = 600;

export interface MarketIndexIo {
  /** STRICT: null = the key does not exist; a failed read THROWS. */
  get<T = any>(k: string): Promise<T | null>;
  set(k: string, v: any, ttlS?: number): Promise<void>;
  mget<T = any>(keys: string[]): Promise<Array<T | null>>;
  /** optional lock (SET NX): two steps at once could each write a list and lose the other's additions */
  setNX?(k: string, v: any, ttlS: number): Promise<boolean>;
  del?(k: string): Promise<void>;
}
export const MARKET_LOCK_KEY = 'guidance-extract:v1:index:ok:market-lock';
export interface MarketIndexState { v: 1; pos: number; done: boolean; total: number; head: string | null; stalls: number; counts: { IN: number; US: number }; updatedAt: string }

export function stateOf(raw: unknown, now = new Date()): MarketIndexState {
  const s = raw as any;
  const fresh: MarketIndexState = { v: 1, pos: 0, done: false, total: 0, head: null, stalls: 0, counts: { IN: 0, US: 0 }, updatedAt: now.toISOString() };
  if (!s || typeof s !== 'object' || s.v !== 1) return fresh;
  return { v: 1, pos: Math.max(0, Number(s.pos) || 0), done: !!s.done, total: Math.max(0, Number(s.total) || 0), head: typeof s.head === 'string' ? s.head : null,
    stalls: Math.max(0, Number(s.stalls) || 0), counts: { IN: Math.max(0, Number(s.counts?.IN) || 0), US: Math.max(0, Number(s.counts?.US) || 0) }, updatedAt: String(s.updatedAt || fresh.updatedAt) };
}
const idList = (raw: unknown): string[] | null => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : null);

/** Pure: put `fresh` in front (in their order), keep the rest in order, no duplicates, bounded. */
export function prependIds(cur: readonly string[], fresh: readonly string[], max = MARKET_INDEX_MAX): string[] {
  const f = Array.from(new Set(fresh)); const fs = new Set(f);
  return [...f, ...cur.filter((x) => !fs.has(x))].slice(0, max);
}
/** Pure: add `older` at the end (extracted earlier than anything already listed), no duplicates, bounded. */
export function appendIds(cur: readonly string[], older: readonly string[], max = MARKET_INDEX_MAX): string[] {
  const have = new Set(cur); const out = cur.slice();
  for (const x of older) if (!have.has(x)) { have.add(x); out.push(x); }
  return out.slice(0, max);
}
/** Pure: the ids in front of `head` in the shared list (new since the last call); all of the first `max` when the head is gone. */
export function newAtFront(shared: readonly string[], head: string | null, max = HEAD_SCAN_MAX): string[] {
  if (!head) return [];
  const i = shared.indexOf(head);
  return (i < 0 ? shared.slice(0, max) : shared.slice(0, Math.min(i, max))).slice();
}

/** Markets of these ids, from their stored results. null = a chunk could not be read at all (stop; try again next call). */
async function marketsOf(io: MarketIndexIo, list: readonly string[]): Promise<{ IN: string[]; US: string[]; read: number; emptyChunk: boolean }> {
  const out = { IN: [] as string[], US: [] as string[], read: 0, emptyChunk: false };
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const got = await io.mget<{ docId?: string; market?: string }>(chunk.map(RESULT_KEY)).catch(() => null);
    if (!Array.isArray(got) || got.length !== chunk.length || got.every((x) => x == null)) { out.emptyChunk = true; break; }
    chunk.forEach((id, j) => { const r = got[j]; if (r && r.docId === id && (r.market === 'IN' || r.market === 'US')) out[r.market].push(id); });
    out.read += chunk.length;
  }
  return out;
}

/** One sync step (see the header). Throws when a strict read fails (nothing written). Returns the new state. */
export async function syncMarketIndex(io: MarketIndexIo, opts: { maxIds?: number; now?: Date } = {}): Promise<MarketIndexState> {
  if (io.setNX) {
    const got = await io.setNX(MARKET_LOCK_KEY, { at: Date.now() }, 90).catch(() => false);
    if (!got) return stateOf(await io.get(MARKET_STATE_KEY), opts.now ?? new Date());   // another step is running
    try { return await syncStep(io, opts); } finally { if (io.del) await io.del(MARKET_LOCK_KEY).catch(() => undefined); }
  }
  return syncStep(io, opts);
}
async function syncStep(io: MarketIndexIo, opts: { maxIds?: number; now?: Date }): Promise<MarketIndexState> {
  const now = opts.now ?? new Date();
  const st = stateOf(await io.get(MARKET_STATE_KEY), now);
  const shared = idList(await io.get(SHARED_OK_INDEX_KEY));
  if (!shared || !shared.length) return st;
  const lists: Record<'IN' | 'US', string[]> = { IN: idList(await io.get(MARKET_INDEX_KEY('IN'))) || [], US: idList(await io.get(MARKET_INDEX_KEY('US'))) || [] };
  const touched = new Set<'IN' | 'US'>();
  // (1) new extractions at the front of the shared list
  const fresh = newAtFront(shared, st.head);
  if (fresh.length) {
    const got = await marketsOf(io, fresh);
    if (got.emptyChunk && !got.read) return st;
    // the walk's place moves right by the ids put in front that it had not passed yet (new ones, or older ones re-extracted);
    // an id it had already passed moved from behind the place to the front, which leaves the place where it is
    const known = new Set([...lists.IN, ...lists.US]);
    st.pos += fresh.filter((id) => !known.has(id)).length;
    for (const m of ['IN', 'US'] as const) if (got[m].length) { lists[m] = prependIds(lists[m], got[m]); touched.add(m); }
  }
  // (2) the one-time walk of the older part
  if (!st.done) {
    const max = Math.max(100, Math.min(3_000, opts.maxIds ?? 600));
    const slice = shared.slice(st.pos, st.pos + max);
    const got = await marketsOf(io, slice);
    for (const m of ['IN', 'US'] as const) if (got[m].length) { lists[m] = appendIds(lists[m], got[m]); touched.add(m); }
    if (got.read) { st.pos += got.read; st.stalls = 0; }
    else if (got.emptyChunk && slice.length) { st.stalls += 1; if (st.stalls >= 3) { st.pos += Math.min(100, slice.length); st.stalls = 0; } }
    st.done = st.pos >= shared.length;
  }
  for (const m of Array.from(touched)) await io.set(MARKET_INDEX_KEY(m), lists[m], TTL_S);
  st.head = shared[0] ?? null; st.total = shared.length; st.counts = { IN: lists.IN.length, US: lists.US.length }; st.updatedAt = now.toISOString();
  await io.set(MARKET_STATE_KEY, st, TTL_S);
  return st;
}

/** Remove ids from both market lists (re-collect: the document will be read again). Throws on a failed strict read (nothing written). */
export async function removeFromMarketIndexes(io: Pick<MarketIndexIo, 'get' | 'set'>, docIds: readonly string[]): Promise<void> {
  if (!docIds.length) return;
  const gone = new Set(docIds);
  for (const m of ['IN', 'US'] as const) {
    const cur = idList(await io.get(MARKET_INDEX_KEY(m)));
    if (!cur) continue;
    const next = cur.filter((x) => !gone.has(x));
    if (next.length !== cur.length) await io.set(MARKET_INDEX_KEY(m), next, TTL_S);
  }
}

/**
 * Pure: which result ids a reader takes. Once the walk is done the market lists are complete and are used alone (newest first, capped
 * per market); until then the shared newest-first list is read as before and whatever the market lists already hold is added.
 */
export function idsToRead(o: { market: 'IN' | 'US' | 'ALL'; shared: readonly string[] | null; sharedCap: number; IN: readonly string[] | null; US: readonly string[] | null; state: unknown }): string[] {
  const markets: Array<'IN' | 'US'> = o.market === 'ALL' ? ['IN', 'US'] : [o.market];
  const fromMarkets = markets.flatMap((m) => (o[m] || []).slice(0, MARKET_READ_CAP[m]));
  const st = o.state ? stateOf(o.state) : null;
  const ready = !!st?.done && markets.every((m) => Array.isArray(o[m]));
  if (ready) return Array.from(new Set(fromMarkets));
  return Array.from(new Set([...(o.shared || []).slice(0, o.sharedCap), ...fromMarkets]));
}

/** Production io: strict reads through the document store's Upstash reader, plain writes and multi-reads. */
export async function realMarketIndexIo(): Promise<MarketIndexIo> {
  const ds = await import('./guidance-docs-store');
  const kv = await import('./kv');
  const d = ds.realDocsKv();
  return {
    get: async <T>(k: string) => (d.getStrict ? d.getStrict<T>(k) : kv.kvGet<T>(k)),
    set: async (k, v, ttl) => { await kv.kvSet(k, v, ttl); },
    mget: async <T>(keys: string[]) => kv.kvMGet<T>(keys),
    setNX: async (k, v, ttl) => kv.kvSetNX(k, v, ttl),
    del: async (k) => { await kv.kvDel(k); },
  };
}
