/**
 * zzz1269 — WHERE the kept memory was allocated (server only).
 *
 * The heap holds 1.0–1.5 GB after a full collection within 20 minutes of a start (12 Nov samples) and the process restarts several
 * times a night. A large live heap makes every collection slow, which is the "whole site is slow" symptom. V8's sampling heap
 * profiler records the call stack of a small sample of allocations and reports only the ones STILL ALIVE, so its top entries are
 * the code that filled the heap. Cost: one stack capture per ~512 KB allocated (negligible).
 *
 * Also keeps an event-loop delay histogram: how long requests had to wait because the one JavaScript thread was busy.
 */
type Node = { callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }; selfSize: number; children?: Node[] };
export interface HeapTopRow { mb: number; pct: number; stack: string[] }

let session: any = null;
let startedAt = 0;
let loopHist: any = null;

export function startHeapProfile(): boolean {
  if (session) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inspector = require('node:inspector');
    const s = new inspector.Session(); s.connect();
    s.post('HeapProfiler.enable');
    s.post('HeapProfiler.startSampling', { samplingInterval: 512 * 1024 });
    session = s; startedAt = Date.now();
  } catch { session = null; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { monitorEventLoopDelay } = require('node:perf_hooks');
    loopHist = monitorEventLoopDelay({ resolution: 20 }); loopHist.enable();
  } catch { loopHist = null; }
  return !!session;
}

const short = (u: string) => u.replace(/^.*\/\.next\//, '').replace(/^.*\/node_modules\//, 'nm/').replace(/^file:\/\//, '');
const frameText = (f: Node['callFrame']) => `${f.functionName || '(anonymous)'} ${short(f.url || '(native)')}:${f.lineNumber + 1}:${f.columnNumber + 1}`;

/** Pure: sampling-profile tree → the allocation stacks that hold the most live memory (innermost frame first, up to `depth` frames). */
export function topOfProfile(head: Node, top = 40, depth = 10): { totalMb: number; rows: HeapTopRow[] } {
  const acc = new Map<string, { size: number; stack: string[] }>(); let total = 0;
  const walk = (n: Node, path: string[]) => {
    const p = [frameText(n.callFrame), ...path];
    if (n.selfSize > 0) {
      total += n.selfSize;
      const stack = p.slice(0, depth); const k = stack.join('|');
      const e = acc.get(k); if (e) e.size += n.selfSize; else acc.set(k, { size: n.selfSize, stack });
    }
    for (const c of n.children || []) walk(c, p);
  };
  walk(head, []);
  const rows = Array.from(acc.values()).sort((a, b) => b.size - a.size).slice(0, top)
    .map((e) => ({ mb: Math.round(e.size / 104857.6) / 10, pct: total ? Math.round((e.size / total) * 1000) / 10 : 0, stack: e.stack }));
  return { totalMb: Math.round(total / 1048576), rows };
}

export function heapTop(top = 40, depth = 10): Promise<{ ok: boolean; sinceMin: number; totalMb: number; rows: HeapTopRow[]; error?: string }> {
  return new Promise((resolve) => {
    if (!session) return resolve({ ok: false, sinceMin: 0, totalMb: 0, rows: [], error: 'profiler not started' });
    session.post('HeapProfiler.getSamplingProfile', (err: any, res: any) => {
      if (err || !res?.profile?.head) return resolve({ ok: false, sinceMin: 0, totalMb: 0, rows: [], error: String(err?.message || 'no profile') });
      resolve({ ok: true, sinceMin: Math.round((Date.now() - startedAt) / 60000), ...topOfProfile(res.profile.head, top, depth) });
    });
  });
}

/** How long the event loop was held up, in ms, since the last call (the histogram is reset on read when `reset`). */
export function loopDelay(reset = false): { meanMs: number; p50Ms: number; p99Ms: number; maxMs: number } | null {
  if (!loopHist) return null;
  const ms = (n: number) => Math.round(n / 1e5) / 10;
  const out = { meanMs: ms(loopHist.mean), p50Ms: ms(loopHist.percentile(50)), p99Ms: ms(loopHist.percentile(99)), maxMs: ms(loopHist.max) };
  if (reset) loopHist.reset();
  return out;
}
