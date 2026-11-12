// zzz1196 — MEASURE BEFORE CUTTING (cost audit, 27 Oct: "record RSS, heap, external and array buffers every 5–15 minutes, with cache
// sizes and active jobs; before / after heavy jobs"). Server-only. One sample every 10 minutes, kept in memory (72 h) and written to
// Redis once per sample (one small key, so the history survives a restart); per-job before / after readings for the last 60 heavy
// runs. Read by /api/v1/system-status → memory. Never logs personal data.
export interface MemSample { at: string; rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; kvFallbackMb: number; kvFallbackEntries: number; readCacheMb: number; jobs: string[];
  /** zzz1262 — heap in MB right after a full collection (only taken when the heap was large and no heavy job was running) */
  heapAfterGc?: number; /** zzz1269: event-loop hold-ups since the previous sample (ms) */ loop?: { meanMs: number; p50Ms: number; p99Ms: number; maxMs: number } }
export interface JobMem { job: string; at: string; secs: number; rssBefore: number; rssAfter: number; heapBefore: number; heapAfter: number; ok: boolean }
const KEY = 'ops:mem-samples:v1';
const MAX_SAMPLES = 432;   // 72 h at 10 min
const EVERY_MS = 10 * 60_000;
export const GC_SAMPLE_MIN_HEAP_MB = 700;
const mb = (v: number) => Math.round(v / 1048576);
const G = globalThis as any;
const state: { samples: MemSample[]; jobs: JobMem[]; running: Set<string>; started: boolean } = G.__mcMemSampler || (G.__mcMemSampler = { samples: [], jobs: [], running: new Set<string>(), started: false });

export function memNow() { const m = process.memoryUsage(); return { rss: mb(m.rss), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers || 0) }; }

async function takeSample(): Promise<MemSample> {
  let kvFallbackMb = 0, kvFallbackEntries = 0, readCacheMb = 0;
  try { const kv = await import('./kv'); const s = kv.kvMemStoreSize(); kvFallbackMb = mb(s.bytes); kvFallbackEntries = s.entries; readCacheMb = Math.round(kv.kvUsageSnapshot().readCache.mb); } catch { /* sizes unknown */ }
  const before = memNow();
  // zzz1262 — heapUsed counts dead objects until V8 collects, and an idle server may not collect for hours: the heap sat at
  // ~1.3 GB after the first heavy job of each run and nobody could tell garbage from memory that is really kept (the open
  // question since 10 Nov). When the heap is large and no heavy job is running, collect once (rate-limited in force-gc) and
  // record what is left: that figure is what the process really holds, and the collection hands the rest back.
  let heapAfterGc: number | undefined;
  if (state.running.size === 0 && before.heapUsed >= GC_SAMPLE_MIN_HEAP_MB) {
    try { const g = (await import('./force-gc')).forceFullGc(); if (g) heapAfterGc = g.afterMb; } catch { /* not available */ }
  }
  let loop: MemSample['loop']; try { loop = (await import('./heap-profile')).loopDelay(true) ?? undefined; } catch { /* not available */ }
  return { at: new Date().toISOString(), ...before, kvFallbackMb, kvFallbackEntries, readCacheMb, jobs: Array.from(state.running), ...(heapAfterGc != null ? { heapAfterGc } : {}), ...(loop ? { loop } : {}) };
}

/** Starts the 10-minute sampler once per process (instrumentation). */
export function startMemSampler(): void {
  if (state.started) return;
  state.started = true;
  void (async () => {
    try { const { kvGet } = await import('./kv'); const old = await kvGet<MemSample[]>(KEY); if (Array.isArray(old)) state.samples = old.slice(-MAX_SAMPLES); } catch { /* fresh history */ }
    const tick = async () => {
      try {
        const sample = await takeSample();
        state.samples.push(sample);
        if (state.samples.length > MAX_SAMPLES) state.samples.splice(0, state.samples.length - MAX_SAMPLES);
        const { kvSet, kvUsageSnapshot } = await import('./kv');
        // Operational telemetry every 10 min: family-level counts only; no keys, values, or credentials.
        // GitHub / Cloudflare writes bypass this process and are NOT included.
        if (process.env.NODE_ENV === 'production') {
          const u = kvUsageSnapshot();
          console.log('[cost-watch]', JSON.stringify({ at: sample.at, rssMb: sample.rss, heapMb: sample.heapUsed,
            kvCommandsSinceBoot: u.commands, kvPerDayAtRate: u.perDayAtThisRate,
            topKvSources48h: u.topSources48h.slice(0, 6), activeHeavyJobs: sample.jobs }));
        }
        await kvSet(KEY, state.samples, 7 * 86_400);
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
