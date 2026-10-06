// zzz919 — PURE LOGIC for the server Conviction Beats bench scan (refresh-bench).
//
// WHY. The cron looked, for each of 60 days, at the current graded key and then
// up to 16 older namespaces, ONE kvGet AT A TIME, stopping at the first
// non-empty hit. Most days (weekends, old dates) have nothing in most
// namespaces, and kvGet answers a miss with TWO round trips (client GET, then a
// raw-REST retry). ~1000 missing keys → ~2000 sequential HTTP calls before any
// real work: far past the 90 s the scheduler allows, so the request was cut and
// the proxy answered 502, while the function itself ran on.
//
// NOW. One EXISTS pipeline over every candidate key (cheap, no payloads), then
// payloads are read only for the NEWEST existing namespace of each day, a few
// days per MGET, newest day first, under a deadline. A day whose payload is
// empty falls to its next existing namespace. A deadline stops the scan
// cleanly and the result says so (partial) — the caller merges the previous
// bench for the days not reached rather than shrinking it.

export interface ScanDeps {
  /** candidate keys for a date, current namespace first. */
  candidates: (date: string) => string[];
  /** EXISTS for many keys, same order; null when unavailable. */
  exists: (keys: string[]) => Promise<boolean[] | null>;
  /** MGET payloads, same order. */
  mget: (keys: string[]) => Promise<Array<any | null>>;
  /** number of rows in a payload (0 = empty / absent). */
  rowCount: (p: any) => number;
  /** turns a hit into the payload to use (legacy regrade). */
  adopt: (payload: any, key: string) => any;
  /** current-namespace test for a key. */
  isCurrent: (key: string) => boolean;
  now: () => number;
}

export interface ScanResult {
  /** one per date that had a usable payload, in the dates order given. */
  days: Array<{ date: string; key: string; payload: any; legacy: boolean }>;
  scannedDays: number;
  /** dates not reached because the deadline hit. */
  skipped: string[];
  partial: boolean;
  mgetCalls: number;
}

export const DAYS_PER_MGET = 4;

export async function scanGradedDays(dates: string[], deps: ScanDeps, deadlineAt: number): Promise<ScanResult> {
  const perDay = dates.map((d) => deps.candidates(d));
  const flat = perDay.flat();
  const ex = await deps.exists(flat);
  // Without EXISTS (in-memory dev store) assume everything may exist.
  const present: string[][] = [];
  let at = 0;
  for (const keys of perDay) {
    present.push(keys.filter((_, i) => (ex ? ex[at + i] : true)));
    at += keys.length;
  }

  const found = new Map<number, { key: string; payload: any }>();
  const cursor = new Array<number>(dates.length).fill(0);   // next candidate index per day
  let pending = dates.map((_, i) => i).filter((i) => present[i].length > 0);
  let mgetCalls = 0;
  // days with nothing present are fully answered ("no data"); the rest are reached once read
  const reached = new Set<number>(dates.map((_, i) => i).filter((i) => present[i].length === 0));

  while (pending.length > 0 && deps.now() < deadlineAt) {
    const next: number[] = [];
    for (let s = 0; s < pending.length; s += DAYS_PER_MGET) {
      if (deps.now() >= deadlineAt) { next.push(...pending.slice(s)); break; }
      const group = pending.slice(s, s + DAYS_PER_MGET);
      const keys = group.map((i) => present[i][cursor[i]]);
      mgetCalls++;
      const vals = await deps.mget(keys);
      group.forEach((i, g) => {
        const payload = vals[g];
        if (deps.rowCount(payload) > 0) {
          found.set(i, { key: keys[g], payload: deps.adopt(payload, keys[g]) });
          reached.add(i);
        } else {
          cursor[i]++;
          if (cursor[i] < present[i].length) next.push(i);   // try the next existing namespace
          else reached.add(i);                                // nothing usable anywhere
        }
      });
    }
    pending = next;
  }

  const days: ScanResult['days'] = [];
  const skipped: string[] = [];
  dates.forEach((d, i) => {
    const f = found.get(i);
    if (f) days.push({ date: d, key: f.key, payload: f.payload, legacy: !deps.isCurrent(f.key) });
    else if (!reached.has(i)) skipped.push(d);
  });
  return { days, scannedDays: dates.length - skipped.length, skipped, partial: skipped.length > 0, mgetCalls };
}

/**
 * Merge the previous bench into a PARTIAL scan: entries older than the oldest
 * date the scan reached are kept (the scan could not have seen them); entries
 * inside the scanned range are not (the scan is authoritative there).
 */
export function mergePartial<T extends { ticker?: string; seen_date?: string }>(fresh: T[], prior: T[], oldestReached: string | null): T[] {
  if (!oldestReached) return [...prior];
  const have = new Set(fresh.map((e) => e.ticker));
  const keep = prior.filter((e) => e?.ticker && !have.has(e.ticker) && typeof e.seen_date === 'string' && e.seen_date < oldestReached);
  return [...fresh, ...keep];
}

/** Drop OLDEST entries (list is newest first) until the JSON fits maxBytes. */
export function boundEntries<T>(entries: T[], maxBytes: number, overhead = 200): { entries: T[]; trimmed: number; bytes: number } {
  const sizes = entries.map((e) => JSON.stringify(e).length + 1);
  let total = overhead + sizes.reduce((a, b) => a + b, 0);
  let n = entries.length;
  while (n > 0 && total > maxBytes) { n--; total -= sizes[n]; }
  return { entries: entries.slice(0, n), trimmed: entries.length - n, bytes: total };
}
