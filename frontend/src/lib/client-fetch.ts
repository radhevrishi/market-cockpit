// ════════════════════════════════════════════════════════════════════════════
// client-fetch.ts (zzz855) — one small, shared client-side GET layer.
//
// Why: the home page fired ~185 requests in 20 s. The same URL was requested
// by several widgets at once, `_=${Date.now()}` busters defeated any reuse, a
// 60 s refresh tick re-ran every fetch (news, feeds, 40-ticker fan-outs), and
// polling kept going in background tabs. This module gives every caller:
//
//   • in-flight dedupe   — N callers of the same URL share ONE request
//   • short TTL cache    — a successful JSON body is reused for `ttlMs`
//                          (default 60 s); errors are never cached
//   • per-caller timeout + AbortSignal — a caller that gives up (unmount,
//                          timeout) never cancels the request for the others;
//                          the shared request lives until the LONGEST
//                          requested timeout of any joined caller
//   • a concurrency limiter for fan-outs (default 6 at once)
//   • pollWhenVisible    — interval polling that stops while the tab is
//                          hidden and resumes (with jitter) when it is shown
//   • onIdle             — run after first paint (requestIdleCallback)
//   • readJsonMemo       — parse a large localStorage value once, re-parse
//                          only when the stored string actually changes
//
// Never throws to callers: fetchJson resolves { data: null, error } instead.
// Never invents data: a failed request is reported as a failure, not as [].
// ════════════════════════════════════════════════════════════════════════════

export type FetchErrorKind = 'timeout' | 'network' | 'parse' | 'aborted' | `http_${number}`;

export interface FetchJsonResult<T> {
  data: T | null;
  error?: FetchErrorKind;
  status?: number;
  /** true when served from the TTL cache without touching the network */
  fromCache?: boolean;
}

export interface FetchJsonOptions {
  /** Reuse a successful response for this long. 0 disables caching (in-flight dedupe still applies). Default 60 s. */
  ttlMs?: number;
  /** Give up (for THIS caller) after this long. Default 15 s. */
  timeoutMs?: number;
  /** Caller-owned abort. Aborting only detaches this caller. */
  signal?: AbortSignal;
  /** Skip the TTL cache (a request already in flight is still joined — it is fresh). */
  force?: boolean;
  /** RequestInit.cache — default 'no-store' so the browser HTTP cache never serves stale API data. */
  cache?: RequestCache;
}

type TimerHandle = unknown;
export interface ClientFetchDeps {
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (h: TimerHandle) => void;
}

interface InflightEntry {
  promise: Promise<FetchJsonResult<unknown>>;
  ctl: AbortController;
  deadline: number;
  timer: TimerHandle;
  timedOut: boolean;
}

export const DEFAULT_TTL_MS = 60_000;
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Factory so tests can inject a fake fetch + fake clock. The app uses the default instance below. */
export function createClientFetch(deps?: Partial<ClientFetchDeps>) {
  const d: ClientFetchDeps = {
    fetchImpl: deps?.fetchImpl ?? ((url, init) => fetch(url, init)),
    now: deps?.now ?? (() => Date.now()),
    setTimer: deps?.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: deps?.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
  };
  const cache = new Map<string, { at: number; data: unknown; status: number }>();
  const inflight = new Map<string, InflightEntry>();
  const stats = { network: 0, cacheHits: 0, joined: 0 };

  function armTimer(url: string, e: InflightEntry) {
    d.clearTimer(e.timer);
    const ms = Math.max(0, e.deadline - d.now());
    e.timer = d.setTimer(() => {
      // Only abort if nobody extended the deadline meanwhile.
      if (inflight.get(url) === e && d.now() >= e.deadline) { e.timedOut = true; e.ctl.abort(); }
      else if (inflight.get(url) === e) armTimer(url, e);
    }, ms);
  }

  function start(url: string, timeoutMs: number, reqCache: RequestCache): InflightEntry {
    const ctl = new AbortController();
    const e: InflightEntry = { promise: null as any, ctl, deadline: d.now() + timeoutMs, timer: null, timedOut: false };
    stats.network++;
    e.promise = (async (): Promise<FetchJsonResult<unknown>> => {
      try {
        const r = await d.fetchImpl(url, { cache: reqCache, signal: ctl.signal });
        if (!r.ok) return { data: null, error: `http_${r.status}`, status: r.status };
        let body: unknown;
        try { body = await r.json(); }
        catch (err: any) {
          if (e.timedOut || err?.name === 'AbortError') return { data: null, error: 'timeout' };
          return { data: null, error: 'parse', status: r.status };
        }
        cache.set(url, { at: d.now(), data: body, status: r.status });
        return { data: body, status: r.status };
      } catch (err: any) {
        if (e.timedOut || err?.name === 'AbortError') return { data: null, error: 'timeout' };
        return { data: null, error: 'network' };
      } finally {
        d.clearTimer(e.timer);
        if (inflight.get(url) === e) inflight.delete(url);
      }
    })();
    inflight.set(url, e);
    armTimer(url, e);
    return e;
  }

  /** GET + parse JSON. Never throws. */
  function fetchJson<T = any>(url: string, opts: FetchJsonOptions = {}): Promise<FetchJsonResult<T>> {
    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (opts.signal?.aborted) return Promise.resolve({ data: null, error: 'aborted' });

    if (!opts.force && ttl > 0) {
      const hit = cache.get(url);
      if (hit && d.now() - hit.at < ttl) {
        stats.cacheHits++;
        return Promise.resolve({ data: hit.data as T, status: hit.status, fromCache: true });
      }
    }

    let e = inflight.get(url);
    if (e) {
      stats.joined++;
      const want = d.now() + timeoutMs;
      if (want > e.deadline) { e.deadline = want; armTimer(url, e); }
    } else {
      e = start(url, timeoutMs, opts.cache ?? 'no-store');
    }
    const shared = e.promise as Promise<FetchJsonResult<T>>;

    // Race the shared request against THIS caller's own timeout + signal.
    return new Promise<FetchJsonResult<T>>((resolve) => {
      let done = false;
      const finish = (res: FetchJsonResult<T>) => {
        if (done) return;
        done = true;
        d.clearTimer(t);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(res);
      };
      const onAbort = () => finish({ data: null, error: 'aborted' });
      const t = d.setTimer(() => finish({ data: null, error: 'timeout' }), timeoutMs);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      shared.then(finish, () => finish({ data: null, error: 'network' }));
    });
  }

  /** Convenience: just the data (null on any failure). */
  async function getJson<T = any>(url: string, opts?: FetchJsonOptions): Promise<T | null> {
    return (await fetchJson<T>(url, opts)).data;
  }

  /** Read a cached body without fetching (undefined when absent/expired). */
  function peek<T = any>(url: string, ttlMs = DEFAULT_TTL_MS): T | undefined {
    const hit = cache.get(url);
    return hit && d.now() - hit.at < ttlMs ? (hit.data as T) : undefined;
  }

  function invalidate(prefix?: string) {
    if (!prefix) { cache.clear(); return; }
    for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) cache.delete(k);
  }

  return { fetchJson, getJson, peek, invalidate, stats, _inflightSize: () => inflight.size };
}

const defaultClient = createClientFetch();
export const fetchJson = defaultClient.fetchJson;
export const getJson = defaultClient.getJson;
export const peekJson = defaultClient.peek;
export const invalidateJson = defaultClient.invalidate;
export const clientFetchStats = defaultClient.stats;

/**
 * Fire a request purely to warm a server cache, without downloading the body.
 * The server finishes (and caches) its work before it sends headers, so we
 * cancel the body as soon as headers arrive. Deduped for `onceMs`.
 */
const _warmed = new Map<string, number>();
export function warmUrl(url: string, onceMs = 10 * 60_000): void {
  if (typeof window === 'undefined') return;
  const last = _warmed.get(url);
  if (last && Date.now() - last < onceMs) return;
  _warmed.set(url, Date.now());
  fetch(url, { cache: 'no-store' })
    .then((r) => { try { r.body?.cancel(); } catch { /* ignore */ } })
    .catch(() => { /* fire-and-forget */ });
}

// ── Concurrency limiter ─────────────────────────────────────────────────────

export const DEFAULT_CONCURRENCY = 6;

export function createLimiter(max = DEFAULT_CONCURRENCY) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (job) job();
  };
  function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job = () => {
        active++;
        let p: Promise<T>;
        try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
        p.then(resolve, reject).finally(() => { active--; next(); });
      };
      queue.push(job);
      next();
    });
  }
  return { run, get active() { return active; }, get pending() { return queue.length; } };
}

/**
 * Map over items with at most `max` running at once. Once `signal` aborts, items
 * that have not STARTED yet are skipped (their slot is undefined) — so a time
 * budget bounds how many requests are ever sent, not just how long we wait.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  max: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: { signal?: AbortSignal } = {},
): Promise<Array<R | undefined>> {
  const out: Array<R | undefined> = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      if (opts.signal?.aborted) return;
      const i = cursor++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = undefined; }
    }
  };
  const n = Math.max(1, Math.min(max, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

// ── Visibility-aware polling ────────────────────────────────────────────────

export interface VisibilityDoc {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface PollOptions {
  /** Random extra delay in [0, jitterMs) added to every wait so tabs/widgets don't fire in lockstep. Default 10% of interval, max 5 s. */
  jitterMs?: number;
  /** Run once right away (if visible). Default false. */
  runImmediately?: boolean;
  /** Test seams. */
  doc?: VisibilityDoc | null;
  timers?: { set: (fn: () => void, ms: number) => TimerHandle; clear: (h: TimerHandle) => void; now: () => number };
  random?: () => number;
}

/**
 * setInterval that pauses while the tab is hidden. `intervalMs` may be a
 * function (re-read before every wait — e.g. 60 s in market hours, 5 min
 * after). When the tab becomes visible again it runs as soon as a full
 * interval has passed since the last run (immediately + jitter if overdue).
 * Returns a stop() function.
 */
export function pollWhenVisible(fn: () => void, intervalMs: number | (() => number), opts: PollOptions = {}): () => void {
  const doc: VisibilityDoc | null = opts.doc !== undefined ? opts.doc : (typeof document !== 'undefined' ? document : null);
  const timers = opts.timers ?? {
    set: (f: () => void, ms: number) => setTimeout(f, ms),
    clear: (h: TimerHandle) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
  const rnd = opts.random ?? Math.random;
  const interval = () => Math.max(1_000, typeof intervalMs === 'function' ? intervalMs() : intervalMs);
  const jitter = () => {
    const j = opts.jitterMs ?? Math.min(5_000, Math.round(interval() * 0.1));
    return j > 0 ? Math.floor(rnd() * j) : 0;
  };
  let stopped = false;
  let timer: TimerHandle = null;
  let lastRun = timers.now();

  const fire = () => {
    timer = null;
    if (stopped) return;
    if (doc?.hidden) return; // paused — visibilitychange will resume us
    lastRun = timers.now();
    try { fn(); } catch { /* a poll callback must never kill the loop */ }
    schedule(interval());
  };
  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer != null) timers.clear(timer);
    timer = timers.set(fire, Math.max(0, ms) + jitter());
  };
  const onVis = () => {
    if (stopped) return;
    if (doc?.hidden) {
      if (timer != null) { timers.clear(timer); timer = null; }
      return;
    }
    const remaining = interval() - (timers.now() - lastRun);
    schedule(remaining > 0 ? remaining : 0);
  };

  doc?.addEventListener('visibilitychange', onVis);
  if (opts.runImmediately && !doc?.hidden) fire();
  else if (!doc?.hidden) schedule(interval());

  return () => {
    stopped = true;
    if (timer != null) timers.clear(timer);
    doc?.removeEventListener('visibilitychange', onVis);
  };
}

// ── After-first-paint scheduling ────────────────────────────────────────────

/** Run `cb` when the browser is idle (or after `timeoutMs` at the latest). Returns cancel(). */
export function onIdle(cb: () => void, timeoutMs = 1_500): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as any;
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(cb, { timeout: timeoutMs });
    return () => { try { w.cancelIdleCallback(id); } catch { /* ignore */ } };
  }
  const id = setTimeout(cb, Math.min(timeoutMs, 200));
  return () => clearTimeout(id);
}

// ── Memoised localStorage JSON ──────────────────────────────────────────────

const _lsMemo = new Map<string, { raw: string | null; value: unknown }>();

/**
 * JSON.parse a localStorage value once and reuse it until the stored string
 * changes (multi-MB keys like mb_excel_scored_v2 were being re-parsed several
 * times per render/refresh). Returns `fallback` on a missing key or bad JSON.
 * The returned object is SHARED — callers must treat it as read-only.
 */
export function readJsonMemo<T = any>(key: string, fallback: T, storage?: Pick<Storage, 'getItem'> | null): T {
  let raw: string | null = null;
  try {
    const s = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    raw = s ? s.getItem(key) : null;
  } catch { return fallback; }
  if (raw == null) return fallback;
  const hit = _lsMemo.get(key);
  if (hit && hit.raw === raw) return (hit.value ?? fallback) as T;
  let value: unknown = null;
  try { value = JSON.parse(raw); } catch { value = null; }
  _lsMemo.set(key, { raw, value });
  return (value ?? fallback) as T;
}
