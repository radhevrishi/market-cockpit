// zzz848/853 — Guidance Universe service (server-only): live pipeline + ledger + stored universe + researched data file -> universe build.
// zzz853 PERSISTENCE: the universe is independent of the news cache. A failing / empty live source never empties it: stored + seed rows are still built.
// After every successful non-empty build a LAST-GOOD copy is written to KV (`guidance-universe:v1:lastgood`); if the build throws or returns nothing,
// the last-good copy is served (servedFrom 'last_good'), else the bare seed (servedFrom 'seed'). Public data, never holdings.
import seedFile from '../data/growth-guidance-seed.json';
import { kvGet, kvSet } from './kv';
import { UNIVERSE_LASTGOOD_KEY, UNIVERSE_TTL_S } from './guidance-config';
import { buildUniverse, loadSeedRows, type GuSeedRow, type GuUniverseBuild, type GuStoredDoc } from './guidance-universe';
import type { GgCompany, GgResponse } from './growth-guidance-types';
import type { GuEventStatus, GuExtractCoverage, GuUniverseSourceInfo } from './guidance-universe-types';
import type { GuidanceExtractResult } from './guidance-docs-types';
import type { PriorActual } from './guidance-extract-reader';

const MEM_TTL_MS = 2 * 60_000;
export type GuServedFrom = 'live' | 'last_good' | 'seed';
export interface GuBundle {
  at: number; now: Date; build: GuUniverseBuild; seed: { rows: GuSeedRow[]; dropped: number }; scan: GgResponse['scan']; persisted: { IN: boolean; US: boolean };
  servedFrom: GuServedFrom; builtAt: string; liveError?: string;
  /** zzz854: how many event statuses (Layer B) the build was reconciled against, and where they came from */
  events?: { statuses: number; source: string; error?: string };
  /** zzz857: every input the build read (with row counts) and the AI-extract coverage of the collected company documents */
  sources?: GuUniverseSourceInfo[]; extractCoverage?: GuExtractCoverage;
}
/** zzz857: what the AI extractor read from the companies' own documents (results newest first) plus prior-year actuals */
export interface GuExtractedIn { results: GuidanceExtractResult[]; actuals: Map<string, PriorActual>; coverage: GuExtractCoverage }
type LiveIn = { all: GgCompany[]; ledger: any; scan: GgResponse['scan'] };
/** Injectable dependencies (tests pass synthetic ones; production lazily loads the real modules). */
export interface GuServiceDeps {
  getLive?: (now: Date, t0: number, force: boolean) => Promise<LiveIn>;
  readStored?: (m: 'IN' | 'US') => Promise<GuStoredDoc | null>;
  writeStored?: (m: 'IN' | 'US', fresh: GuUniverseBuild['stored'], now: Date, existing: GuStoredDoc | null) => Promise<boolean>;
  kvGet?: (key: string) => Promise<any>; kvSet?: (key: string, v: any, ttl?: number) => Promise<void>;
  seed?: unknown; now?: () => Date; useMemory?: boolean;
  /** zzz854: the events layer's verdict per company + metric + period (production: the persisted event store run through the event engine) */
  getEventStatuses?: (now: Date) => Promise<{ statuses: GuEventStatus[]; source: string }>;
  /** zzz857: AI-extracted company-document rows (production: lib/guidance-extract-reader) */
  getExtracted?: (now: Date) => Promise<GuExtractedIn>;
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
  // zzz854: the events layer wins over the universe. When event statuses cannot be read the universe is still built (and says so in `events`).
  const getEvents = deps.getEventStatuses ?? (deps.getLive ? (async () => ({ statuses: [] as GuEventStatus[], source: 'none (not injected)' })) : (async (n: Date) => (await import('./guidance-upgrades-reconcile')).loadEventStatuses(n)));
  // zzz857: company documents read by the AI extractor. A failed read never empties the universe; it is reported in `sources`.
  const EMPTY_X: GuExtractedIn = { results: [], actuals: new Map(), coverage: { docs: 0, extracted: 0, rows: 0, lastExtractAt: null } };
  const getX = deps.getExtracted ?? (deps.getLive ? (async () => EMPTY_X) : (async () => (await import('./guidance-extract-reader')).loadExtractedForUniverse()));
  const xP = withT(getX(now).catch((e: any) => ({ ...EMPTY_X, coverage: { ...EMPTY_X.coverage, error: String(e?.message || e).slice(0, 160) } })), 5_000, { ...EMPTY_X, coverage: { ...EMPTY_X.coverage, error: 'timed out' } });
  const evP = withT(getEvents(now).then((x) => ({ ...x, error: undefined as string | undefined }), (e: any) => ({ statuses: [] as GuEventStatus[], source: 'unavailable', error: String(e?.message || e).slice(0, 160) })), 6_000, { statuses: [] as GuEventStatus[], source: 'unavailable', error: 'timed out' });

  let build: GuUniverseBuild | null = null; let scan = EMPTY_SCAN; let liveError: string | undefined;
  let persisted = { IN: false, US: false }; let sIN: GuStoredDoc | null = null; let sUS: GuStoredDoc | null = null;
  let evMeta: GuBundle['events'] = { statuses: 0, source: 'not read' };
  let xIn: GuExtractedIn = EMPTY_X; let srcInfo: GuUniverseSourceInfo[] | undefined;
  try {
    let live: LiveIn = { all: [], ledger: null, scan: EMPTY_SCAN };
    try { live = await getLive(now, t0, force); scan = live.scan; } catch (e: any) { liveError = String(e?.message || e).slice(0, 200); }   // a dead news cache never empties the universe
    [sIN, sUS] = await Promise.all([withT(readStored('IN'), 2_500, null), withT(readStored('US'), 2_500, null)]);
    const stored: GuStoredDoc['rows'] = [...(sIN?.rows || []), ...(sUS?.rows || [])];
    const ev = await evP; evMeta = { statuses: ev.statuses.length, source: ev.source, ...(ev.error ? { error: ev.error } : {}) };
    xIn = await xP;
    build = buildUniverse(live.all || [], live.ledger, seed.rows, now, { stored, eventStatuses: ev.statuses, extracted: { results: xIn.results, actuals: xIn.actuals } });
    srcInfo = sourcesInfo(live.all || [], live.ledger, stored, seed.rows.length, xIn, build);
  } catch (e: any) { liveError = String(e?.message || e).slice(0, 200); build = null; }

  if (build && nonEmpty(build)) {
    try {
      const [pIN, pUS] = await Promise.all([withT(writeStored('IN', build.stored, now, sIN), 3_000, false), withT(writeStored('US', build.stored, now, sUS), 3_000, false)]);
      persisted = { IN: pIN, US: pUS };
    } catch { /* best effort */ }
    const builtAt = now.toISOString();
    try { await withT(ks(UNIVERSE_LASTGOOD_KEY, { v: 1, builtAt, build, seed, scan } as LastGood, UNIVERSE_TTL_S), 4_000, undefined); } catch { /* best effort */ }
    const b: GuBundle = { at: Date.now(), now, build, seed, scan, persisted, servedFrom: 'live', builtAt, events: evMeta, sources: srcInfo, extractCoverage: xIn.coverage, ...(liveError ? { liveError } : {}) };
    if (useMem) mem = b;
    return b;
  }
  // fallback 1: last good copy
  try {
    const lg = await withT(kg(UNIVERSE_LASTGOOD_KEY) as Promise<LastGood | null>, 4_000, null);
    if (lg && lg.build && nonEmpty(lg.build)) {
      return { at: Date.now(), now, build: lg.build, seed: lg.seed || seed, scan: lg.scan || EMPTY_SCAN, persisted, servedFrom: 'last_good', builtAt: lg.builtAt || now.toISOString(), liveError: liveError || 'live build returned no records', events: evMeta, extractCoverage: xIn.coverage };
    }
  } catch { /* fall through */ }
  // fallback 2: the seed alone
  let sb: GuUniverseBuild;
  try { const ev = await evP; const x = await xP; xIn = x; sb = buildUniverse([], null, seed.rows, now, { stored: [], eventStatuses: ev.statuses, extracted: { results: x.results, actuals: x.actuals } }); srcInfo = sourcesInfo([], null, [], seed.rows.length, x, sb); } catch { sb = { records: [], inactive: [], excluded: [], stored: [], defaultRecords: [], reviewQueue: [], claimsAwaiting: [] }; }
  return { at: Date.now(), now, build: sb, seed, scan: EMPTY_SCAN, persisted, servedFrom: 'seed', builtAt: now.toISOString(), liveError: liveError || 'live build returned no records', events: evMeta, sources: srcInfo, extractCoverage: xIn.coverage };
}
/** zzz857: the inputs of one build with their row counts; COMPANY_DOC counts the company-document points that reached any list. */
export function sourcesInfo(live: GgCompany[], ledger: any, stored: GuStoredDoc['rows'], seedRows: number, x: GuExtractedIn, build: GuUniverseBuild): GuUniverseSourceInfo[] {
  const docPoints = [...(build.defaultRecords || []), ...(build.reviewQueue || []), ...(build.claimsAwaiting || [])].reduce((n, r) => n + r.points.filter((p) => p.origin === 'COMPANY_DOC').length, 0);
  const xRows = x.results.reduce((n, r) => n + (Array.isArray(r.rows) ? r.rows.length : 0), 0);
  return [
    { id: 'COMPANY_DOC', label: "Company documents read by the AI extractor (transcripts, presentations, results releases; every row quote-checked)", rows: docPoints,
      note: `${x.results.length} documents with guidance, ${xRows} extracted rows${x.coverage.error ? `; read error: ${x.coverage.error}` : ''}` },
    { id: 'LIVE', label: 'Live scan (news, exchange / SEC filings, results caches)', rows: (live || []).length },
    { id: 'LEDGER', label: 'Guidance ledger', rows: Array.isArray(ledger) ? ledger.reduce((n: number, r: any) => n + (Array.isArray(r?.entries) ? r.entries.length : 0), 0) : 0 },
    { id: 'STORED', label: 'Stored universe (earlier builds)', rows: (stored || []).length },
    { id: 'RESEARCHED_SEED', label: 'Researched records (data file)', rows: seedRows },
  ];
}

// ── response assembly (shared by the route and the tests) ────────────────────────────────────
import { summarize } from './guidance-universe';
import { checkUniverseInvariants, checkUniverseCountEquations } from './guidance-invariants';
import { scanNoteText } from './growth-guidance-format';
import { HIGH_GROWTH_THRESHOLD, MIN_THRESHOLD, MAX_THRESHOLD } from './guidance-config';
import type { GgMetric } from './growth-guidance-types';

export type GuView = 'active' | 'review' | 'claims' | 'history';
export interface GuResponseParams { market?: 'IN' | 'US' | 'ALL'; metric?: GgMetric | null; threshold?: number; view?: GuView }
export function parseView(q: string | null | undefined): GuView { const v = String(q || 'active').toLowerCase(); return v === 'review' ? 'review' : v === 'claims' || v === 'awaiting' ? 'claims' : v === 'all' || v === 'history' ? 'history' : 'active'; }
export function clampThreshold(x: unknown): number { const t = typeof x === 'number' ? x : parseFloat(String(x ?? '')); return Number.isFinite(t) ? Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, t)) : HIGH_GROWTH_THRESHOLD; }

/** The universe never depends on an event window: no window parameter exists here. */
export function buildUniverseResponse(b: GuBundle, p: GuResponseParams = {}) {
  const market = p.market || 'ALL'; const metric = p.metric || null; const threshold = clampThreshold(p.threshold ?? HIGH_GROWTH_THRESHOLD); const view = p.view || 'active';
  const bd = b.build;
  const claims = bd.claimsAwaiting ?? [];   // an older stored build has no claims list
  const summary = summarize(bd.defaultRecords, b.now, threshold, bd.inactive, bd.reviewQueue, claims);
  const inMk = (m: string) => market === 'ALL' || m === market;
  let records = (view === 'review' ? bd.reviewQueue : view === 'claims' ? claims : bd.defaultRecords).filter((r) => inMk(r.record.market));
  if (metric) records = records.filter((r) => r.points.some((x) => x.metric === metric && x.compareValue != null && x.compareValue >= threshold && x.counted));
  const inactive = bd.inactive.filter((x) => inMk(x.market));
  const cnt = (s: string) => bd.inactive.filter((x) => x.status === s).length;
  // zzz854: every view count comes from the same three lists the page shows (Active / Needs review / Claims awaiting verification)
  const viewCounts = { default: bd.defaultRecords.length, review: bd.reviewQueue.length, claimsAwaiting: claims.length, expired: cnt('EXPIRED'), superseded: cnt('SUPERSEDED'), withdrawn: cnt('WITHDRAWN'), excluded: bd.excluded.length };
  const invariantViolations = [
    ...checkUniverseInvariants({ defaultRecords: bd.defaultRecords, reviewQueue: bd.reviewQueue, claimsAwaiting: claims, inactive: bd.inactive, excluded: bd.excluded }),
    ...checkUniverseCountEquations(summary.countEquations),
  ];
  return {
    summary, records, pendingPrimary: summary.all.pendingPrimary,
    ...(view === 'review' ? { reviewQueue: records } : {}),
    ...(view === 'claims' ? { claimsAwaiting: records } : {}),
    countEquations: summary.countEquations,
    ...(b.events ? { eventReconciliation: b.events } : {}),
    sources: b.sources ?? [], extractCoverage: b.extractCoverage ?? { docs: 0, extracted: 0, rows: 0, lastExtractAt: null },
    scan: { note: scanNoteText(b.scan?.note), complete: b.scan?.complete },
    seed: { loaded: b.seed.rows.length, dropped: b.seed.dropped }, persisted: b.persisted,
    ...(view === 'history' ? { inactive, excluded: bd.excluded } : {}),
    viewCounts, invariantViolations, servedFrom: b.servedFrom, builtAt: b.builtAt, ...(b.liveError ? { liveError: b.liveError } : {}),
    filters: { market, metric, threshold, view },
  };
}
