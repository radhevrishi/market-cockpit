// zzz1196 — MEASURE BEFORE CUTTING (cost audit, 27 Oct: "record RSS, heap, external and array buffers every 5–15 minutes, with cache
// sizes and active jobs; before / after heavy jobs"). Server-only. One sample every 10 minutes, kept in memory (72 h) and written to
// Redis once per sample (one small key, so the history survives a restart); per-job before / after readings for the last 60 heavy
// runs. Read by /api/v1/system-status → memory. Never logs personal data.
export interface MemSample { at: string; rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; kvFallbackMb: number; kvFallbackEntries: number; readCacheMb: number; jobs: string[] }
export interface JobMem { job: string; at: string; secs: number; rssBefore: number; rssAfter: number; heapBefore: number; heapAfter: number; ok: boolean }
const KEY = 'ops:mem-samples:v1';
const MAX_SAMPLES = 432;   // 72 h at 10 min
const EVERY_MS = 10 * 60_000;
const mb = (v: number) => Math.round(v / 1048576);
const G = globalThis as any;
const state: { samples: MemSample[]; jobs: JobMem[]; running: Set<string>; started: boolean } = G.__mcMemSampler || (G.__mcMemSampler = { samples: [], jobs: [], running: new Set<string>(), started: false });

export function memNow() { const m = process.memoryUsage(); return { rss: mb(m.rss), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers || 0) }; }

async function takeSample(): Promise<MemSample> {
  let kvFallbackMb = 0, kvFallbackEntries = 0, readCacheMb = 0;
  try { const kv = await import('./kv'); const s = kv.kvMemStoreSize(); kvFallbackMb = mb(s.bytes); kvFallbackEntries = s.entries; readCacheMb = Math.round(kv.kvUsageSnapshot().readCache.mb); } catch { /* sizes unknown */ }
  return { at: new Date().toISOString(), ...memNow(), kvFallbackMb, kvFallbackEntries, readCacheMb, jobs: Array.from(state.running) };
}

/** Starts the 10-minute sampler once per process (instrumentation). */
export function startMemSampler(): void {
  if (state.started) return;
  state.started = true;
  void (async () => {
    try { const { kvGet } = await import('./kv'); const old = await kvGet<MemSample[]>(KEY); if (Array.isArray(old)) state.samples = old.slice(-MAX_SAMPLES); } catch { /* fresh history */ }
    const tick = async () => {
      try {
        state.samples.push(await takeSample());
        if (state.samples.length > MAX_SAMPLES) state.samples.splice(0, state.samples.length - MAX_SAMPLES);
        const { kvSet } = await import('./kv'); await kvSet(KEY, state.samples, 7 * 86_400);
      } catch { /* best effort */ }
    };
    await tick();
    const t = setInterval(() => { void tick(); }, EVERY_MS); (t as any).unref?.();
  })();
}

/** Wraps one heavy background job: memory before / after, kept for the last 60 runs. */
export async function withJobMemory<T extends { ok: boolean }>(job: string, fn: () => Promise<T>): Promise<T> {
  const b = memNow(); const t0 = Date.now(); state.running.add(job);
  let out: T | undefined;
  try { out = await fn(); return out; } finally {
    state.running.delete(job);
    const a = memNow();
    state.jobs.push({ job, at: new Date(t0).toISOString(), secs: Math.round((Date.now() - t0) / 1000), rssBefore: b.rss, rssAfter: a.rss, heapBefore: b.heapUsed, heapAfter: a.heapUsed, ok: !!out?.ok });
    if (state.jobs.length > 60) state.jobs.splice(0, state.jobs.length - 60);
  }
}

/** Pure summary of samples since `sinceMs`. */
export function summarise(samples: MemSample[], sinceMs: number): { n: number; avgRss: number | null; maxRss: number | null; avgHeap: number | null; maxHeap: number | null } {
  const s = samples.filter((x) => Date.parse(x.at) >= sinceMs);
  if (!s.length) return { n: 0, avgRss: null, maxRss: null, avgHeap: null, maxHeap: null };
  const avg = (f: (x: MemSample) => number) => Math.round(s.reduce((a, x) => a + f(x), 0) / s.length);
  return { n: s.length, avgRss: avg((x) => x.rss), maxRss: Math.max(...s.map((x) => x.rss)), avgHeap: avg((x) => x.heapUsed), maxHeap: Math.max(...s.map((x) => x.heapUsed)) };
}

export function memoryReport() {
  const now = Date.now();
  // the newest heavy-job readings sorted by how much the job added
  const jobs = state.jobs.slice().sort((a, b) => (b.rssAfter - b.rssBefore) - (a.rssAfter - a.rssBefore)).slice(0, 15);
  return { now: memNow(), last24h: summarise(state.samples, now - 86_400_000), last72h: summarise(state.samples, now - 3 * 86_400_000), samples: state.samples.slice(-36), heavyJobs: jobs, running: Array.from(state.running) };
}
