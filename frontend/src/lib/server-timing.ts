// zzz1053 — a tiny Server-Timing helper: route handlers note where their time goes, and the browser's devtools (Network → Timing)
// show it. No dependency, no I/O. Names are sanitised to the header's token grammar; descriptions are quoted.
//
//   const t = serverTiming();
//   const snap = await t.time('db', () => loadSnapshot('US'));
//   t.note('memo', 'hit');
//   return withServerTiming(NextResponse.json(body), t);

export interface ServerTiming {
  /** Time an async step (recorded even when it throws). */
  time<T>(name: string, fn: () => Promise<T> | T, desc?: string): Promise<T>;
  /** Record a step with a known duration in ms. */
  add(name: string, durMs: number, desc?: string): void;
  /** Record a label with no duration (e.g. cache state). */
  note(name: string, desc: string): void;
  /** The `Server-Timing` header value (including `total` since creation). */
  header(): string;
  /** ms since this timer was created */
  elapsed(): number;
}

const tok = (s: string) => String(s || 'step').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40) || 'step';
const qdesc = (s: string) => `"${String(s).replace(/["\\\r\n]/g, ' ').slice(0, 80)}"`;

export function serverTiming(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())): ServerTiming {
  const t0 = now();
  const parts: string[] = [];
  const fmt = (n: number) => Math.max(0, Math.round(n * 10) / 10);
  const api: ServerTiming = {
    async time(name, fn, desc) {
      const a = now();
      try { return await fn(); } finally { api.add(name, now() - a, desc); }
    },
    add(name, durMs, desc) { parts.push(`${tok(name)};dur=${fmt(durMs)}${desc ? `;desc=${qdesc(desc)}` : ''}`); },
    note(name, desc) { parts.push(`${tok(name)};desc=${qdesc(desc)}`); },
    header() { return [...parts, `total;dur=${fmt(now() - t0)}`].join(', '); },
    elapsed() { return now() - t0; },
  };
  return api;
}

/** Put the timer's header on a response (returns the same response). Never throws. */
export function withServerTiming<R extends Response>(res: R, t: ServerTiming): R {
  try { res.headers.set('Server-Timing', t.header()); } catch { /* immutable headers: skip */ }
  return res;
}
