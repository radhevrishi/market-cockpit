// zzz848/853 — Guidance Universe service (server-only): live pipeline + ledger + stored universe + researched data file -> universe build.
// zzz853 PERSISTENCE: the universe is independent of the news cache. A failing / empty live source never empties it: stored + seed rows are still built.
// After every successful non-empty build a LAST-GOOD copy is written to KV (`guidance-universe:v1:lastgood`); if the build throws or returns nothing,
// the last-good copy is served (servedFrom 'last_good'), else the bare seed (servedFrom 'seed'). Public data, never holdings.
import seedFile from '../data/growth-guidance-seed.json';
import { kvGet, kvSet } from './kv';
import { UNIVERSE_LASTGOOD_KEY, UNIVERSE_TTL_S } from './guidance-config';
import { buildUniverse, loadSeedRows, type GuSeedRow, type GuUniverseBuild, type GuStoredDoc } from './guidance-universe';
import type { GgCompany, GgResponse } from './growth-guidance-types';

const MEM_TTL_MS = 2 * 60_000;
export type GuServedFrom = 'live' | 'last_good' | 'seed';
export interface GuBundle {
  at: number; now: Date; build: GuUniverseBuild; seed: { rows: GuSeedRow[]; dropped: number }; scan: GgResponse['scan']; persisted: { IN: boolean; US: boolean };
  servedFrom: GuServedFrom; builtAt: string; liveError?: string;
}
type LiveIn = { all: GgCompany[]; ledger: any; scan: GgResponse['scan'] };
/** Injectable dependencies (tests pass synthetic ones; production lazily loads the real modules). */
export interface GuServiceDeps {
  getLive?: (now: Date, t0: number, force: boolean) => Promise<LiveIn>;
  readStored?: (m: 'IN' | 'US') => Promise<GuStoredDoc | null>;
  writeStored?: (m: 'IN' | 'US', fresh: GuUniverseBuild['stored'], now: Date, existing: GuStoredDoc | null) => Promise<boolean>;
  kvGet?: (key: string) => Promise<any>; kvSet?: (key: string, v: any, ttl?: number) => Promise<void>;
  seed?: unknown; now?: () => Date; useMemory?: boolean;
}
let mem: GuBundle | null = null;
export function resetUniverseMemory(): void { mem = null; }

export function getSeedRows(raw: unknown = seedFile): { rows: GuSeedRow[]; dropped: number } {
  try { const r = loadSeedRows(raw); return { rows: r.rows, dropped: r.dropped.length }; } catch { return { rows: [], dropped: 0 }; }
}
const withT = <T,>(p: Promise<T>, ms: number, fb: T): Promise<T> => new Promise((res) => { const t = setTimeout(() => res(fb), ms); p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fb); }); });

interface LastGood { v: 1; builtAt: string; build: GuUniverseBuild; seed: { rows: GuSeedRow[]; dropped: number }; scan: GgResponse['scan'] }
const nonEmpty = (b: GuUniverseBuild | null | undefined) => !!b && ((b.records?.length || 0) + (b.defaultRecords?.length || 0) + (b.reviewQueue?.length || 0) + (b.inactive?.length || 0)) > 0;
const EMPTY_SCAN = { note: 'Live scan unavailable; universe served from stored data.', complete: false } as unknown as GgResponse['scan'];

/** Both markets are always built together so the India and USA summary buckets are complete whichever market filter the page applies. */
export async function getUniverseBundle(t0: number, force = false, deps: GuServiceDeps = {}): Promise<GuBundle> {
  const useMem = deps.useMemory ?? !deps.getLive;
  if (useMem && mem && !force && Date.now() - mem.at <= MEM_TTL_MS) return mem;
  const now = deps.now ? deps.now() : new Date();
  const seed = getSeedRows(deps.seed ?? seedFile);
  const kg = deps.kvGet ?? kvGet; const ks = deps.kvSet ?? kvSet;
  const readStored = deps.readStored ?? (async (m) => (await import('./growth-guidance-ledger')).readGuStored(m));
  const writeStored = deps.writeStored ?? (async (m, f, n, e) => (await import('./growth-guidance-ledger')).writeGuStored(m, f, n, e));
  const getLive = deps.getLive ?? (async (n, t, f) => (await import('./growth-guidance-live')).getLiveGuidance('ALL', n, t, f) as Promise<LiveIn>);

  let build: GuUniverseBuild | null = null; let scan = EMPTY_SCAN; let liveError: string | undefined;
  let persisted = { IN: false, US: false }; let sIN: GuStoredDoc | null = null; let sUS: GuStoredDoc | null = null;
  try {
    let live: LiveIn = { all: [], ledger: null, scan: EMPTY_SCAN };
    try { live = await getLive(now, t0, force); scan = live.scan; } catch (e: any) { liveError = String(e?.message || e).slice(0, 200); }   // a dead news cache never empties the universe
    [sIN, sUS] = await Promise.all([withT(readStored('IN'), 2_500, null), withT(readStored('US'), 2_500, null)]);
    const stored: GuStoredDoc['rows'] = [...(sIN?.rows || []), ...(sUS?.rows || [])];
    build = buildUniverse(live.all || [], live.ledger, seed.rows, now, { stored });
  } catch (e: any) { liveError = String(e?.message || e).slice(0, 200); build = null; }

  if (build && nonEmpty(build)) {
    try {
      const [pIN, pUS] = await Promise.all([withT(writeStored('IN', build.stored, now, sIN), 3_000, false), withT(writeStored('US', build.stored, now, sUS), 3_000, false)]);
      persisted = { IN: pIN, US: pUS };
    } catch { /* best effort */ }
    const builtAt = now.toISOString();
    try { await withT(ks(UNIVERSE_LASTGOOD_KEY, { v: 1, builtAt, build, seed, scan } as LastGood, UNIVERSE_TTL_S), 4_000, undefined); } catch { /* best effort */ }
    const b: GuBundle = { at: Date.now(), now, build, seed, scan, persisted, servedFrom: 'live', builtAt, ...(liveError ? { liveError } : {}) };
    if (useMem) mem = b;
    return b;
  }
  // fallback 1: last good copy
  try {
    const lg = await withT(kg(UNIVERSE_LASTGOOD_KEY) as Promise<LastGood | null>, 4_000, null);
    if (lg && lg.build && nonEmpty(lg.build)) {
      return { at: Date.now(), now, build: lg.build, seed: lg.seed || seed, scan: lg.scan || EMPTY_SCAN, persisted, servedFrom: 'last_good', builtAt: lg.builtAt || now.toISOString(), liveError: liveError || 'live build returned no records' };
    }
  } catch { /* fall through */ }
  // fallback 2: the seed alone
  let sb: GuUniverseBuild;
  try { sb = buildUniverse([], null, seed.rows, now, { stored: [] }); } catch { sb = { records: [], inactive: [], excluded: [], stored: [], defaultRecords: [], reviewQueue: [] }; }
  return { at: Date.now(), now, build: sb, seed, scan: EMPTY_SCAN, persisted, servedFrom: 'seed', builtAt: now.toISOString(), liveError: liveError || 'live build returned no records' };
}

// ── response assembly (shared by the route and the tests) ────────────────────────────────────
import { summarize } from './guidance-universe';
import { checkUniverseInvariants } from './guidance-invariants';
import { HIGH_GROWTH_THRESHOLD, MIN_THRESHOLD, MAX_THRESHOLD } from './guidance-config';
import type { GgMetric } from './growth-guidance-types';

export type GuView = 'active' | 'review' | 'history';
export interface GuResponseParams { market?: 'IN' | 'US' | 'ALL'; metric?: GgMetric | null; threshold?: number; view?: GuView }
export function parseView(q: string | null | undefined): GuView { const v = String(q || 'active').toLowerCase(); return v === 'review' ? 'review' : v === 'all' || v === 'history' ? 'history' : 'active'; }
export function clampThreshold(x: unknown): number { const t = typeof x === 'number' ? x : parseFloat(String(x ?? '')); return Number.isFinite(t) ? Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, t)) : HIGH_GROWTH_THRESHOLD; }

/** The universe never depends on an event window: no window parameter exists here. */
export function buildUniverseResponse(b: GuBundle, p: GuResponseParams = {}) {
  const market = p.market || 'ALL'; const metric = p.metric || null; const threshold = clampThreshold(p.threshold ?? HIGH_GROWTH_THRESHOLD); const view = p.view || 'active';
  const bd = b.build;
  const summary = summarize(bd.defaultRecords, b.now, threshold, bd.inactive, bd.reviewQueue);
  const inMk = (m: string) => market === 'ALL' || m === market;
  let records = (view === 'review' ? bd.reviewQueue : bd.defaultRecords).filter((r) => inMk(r.record.market));
  if (metric) records = records.filter((r) => r.points.some((x) => x.metric === metric && x.compareValue != null && x.compareValue >= threshold && x.counted));
  const inactive = bd.inactive.filter((x) => inMk(x.market));
  const cnt = (s: string) => bd.inactive.filter((x) => x.status === s).length;
  const viewCounts = { default: bd.defaultRecords.length, review: bd.reviewQueue.length, expired: cnt('EXPIRED'), superseded: cnt('SUPERSEDED'), withdrawn: cnt('WITHDRAWN'), excluded: bd.excluded.length };
  const invariantViolations = checkUniverseInvariants({ defaultRecords: bd.defaultRecords, reviewQueue: bd.reviewQueue, inactive: bd.inactive, excluded: bd.excluded });
  return {
    summary, records, pendingPrimary: summary.all.pendingPrimary,
    ...(view === 'review' ? { reviewQueue: records } : {}),
    scan: { note: b.scan?.note, complete: b.scan?.complete },
    seed: { loaded: b.seed.rows.length, dropped: b.seed.dropped }, persisted: b.persisted,
    ...(view === 'history' ? { inactive, excluded: bd.excluded } : {}),
    viewCounts, invariantViolations, servedFrom: b.servedFrom, builtAt: b.builtAt, ...(b.liveError ? { liveError: b.liveError } : {}),
    filters: { market, metric, threshold, view },
  };
}
