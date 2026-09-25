// ═══════════════════════════════════════════════════════════════════════════
// US EARNINGS — HARD RE-SCAN, THE BACKGROUND GRADING QUEUE, AND HONEST
// PROGRESS.                                                         (zzz805)
//
// What the owner saw after pressing "⟳ Hard re-scan" on a 1-day window:
//   "0 filers · 0 graded … The server is grading 2026-09-24, one at a time"
// for as long as he watched. EDGAR had 14 earnings filers that day (SNX, BB,
// COST, DRI, FUL, ICFI …) and the filer fetch finds them in under a second.
// The day was not slow; it was being graded AGAIN AND AGAIN:
//
//   1. The hard re-scan bumps `forceKey`, and every poll of a pending day sent
//      `cache_only=1&force=1`.
//   2. `force=1` skipped every cache on the server, so when the background
//      grade finished and wrote its result, the next poll ignored it and queued
//      the day again. The page could never receive a finished payload.
//   3. The "0 filers" was the placeholder the page paints while a day is
//      pending — not a count anyone measured — and the empty-state below it
//      then said "No US earnings filings in this window". Silence passed.
//
// And beside that loop, three silent failures:
//   • a background grade that FAILED (EDGAR 403/429, a timeout, a crash) was
//     indistinguishable from one still running; the page polled for ever;
//   • a day whose filer list could not be fetched was folded into the result
//     as an empty day ("0 filers") and, for a past date, cached for 30 days;
//   • the engine-version bump refreshed every stale day with a full,
//     un-queued grade request in parallel, bypassing the one-at-a-time queue.
//
// This module holds the decisions as pure functions so they are testable, and
// the queue as a small class the route owns one instance of.
// ═══════════════════════════════════════════════════════════════════════════

export type CacheOnlyDecision =
  | { kind: 'serve-cache' }
  | { kind: 'pending' }                      // queued or running — report progress
  | { kind: 'enqueue'; force: boolean }      // start (or restart) the grade
  | { kind: 'failed'; error: string; retryInMs: number };

export interface LastRun {
  at: number;
  ok: boolean;
  error?: string | null;
  /** Consecutive failures of this key. Reset by a success. */
  failures: number;
}

/** How long a failed day waits before the next poll may retry it. Grows with
 *  consecutive failures so a blocked SEC IP is not hammered: 1, 3, 10 min. */
export function failureBackoffMs(failures: number): number {
  return failures <= 1 ? 60_000 : failures === 2 ? 180_000 : 600_000;
}

/**
 * What a `cache_only` probe for one day should do.
 *
 * The rule that fixes the loop: `force` means "regrade ONCE". A forced probe
 * for a day that is already queued or running is just a progress question,
 * and the client sends `force` only on the first request of a re-scan, so a
 * finished forced grade is served from the cache it just wrote.
 */
export function decideCacheOnly(i: {
  known: boolean;          // queued or running right now
  force: boolean;
  cacheHit: boolean;       // a fresh result for this key exists
  last: LastRun | null;
  now: number;
}): CacheOnlyDecision {
  if (i.known) return { kind: 'pending' };
  if (i.force) return { kind: 'enqueue', force: true };
  if (i.cacheHit) return { kind: 'serve-cache' };
  if (i.last && !i.last.ok && i.last.failures > 0) {
    const wait = failureBackoffMs(i.last.failures) - (i.now - i.last.at);
    if (wait > 0) return { kind: 'failed', error: i.last.error || 'the grade did not finish', retryInMs: wait };
  }
  return { kind: 'enqueue', force: false };
}

// ─── the queue ─────────────────────────────────────────────────────────────

export interface GradeProgress {
  stage: string;
  done: number;
  total: number;
  started_at: number;
}

export type GradeRunner = (key: string, force: boolean) => Promise<{ ok: boolean; error?: string | null }>;

/**
 * One-at-a-time background grading. Every run always settles — success,
 * failure or the runner's own timeout — and records its outcome, so a day can
 * never sit "grading" for ever and a failure is reported instead of polled.
 */
export class GradeQueue {
  private queue: Array<{ key: string; force: boolean; prio: number; seq: number }> = [];
  private seq = 0;
  private running = new Set<string>();
  private claimed = new Set<string>();       // a live (foreground) request is grading it
  private last = new Map<string, LastRun>();
  private progress = new Map<string, GradeProgress>();
  constructor(private runner: GradeRunner, private max = 1, private now: () => number = Date.now) {}

  known(key: string): boolean {
    return this.running.has(key) || this.claimed.has(key) || this.queue.some((q) => q.key === key);
  }
  /** 1-based place in line (1 = running now), or 0 if not known. */
  place(key: string): number {
    if (this.running.has(key) || this.claimed.has(key)) return 1;
    const i = this.queue.findIndex((q) => q.key === key);
    return i >= 0 ? i + 1 + this.running.size : 0;
  }
  length(): number { return this.queue.length + this.running.size; }
  lastRun(key: string): LastRun | null { return this.last.get(key) ?? null; }
  getProgress(key: string): GradeProgress | null { return this.progress.get(key) ?? null; }
  setProgress(key: string, p: Partial<GradeProgress> & { stage: string }): void {
    const prev = this.progress.get(key);
    this.progress.set(key, {
      stage: p.stage, done: p.done ?? prev?.done ?? 0, total: p.total ?? prev?.total ?? 0,
      started_at: prev?.started_at ?? this.now(),
    });
  }
  tick(key: string, by = 1): void {
    const p = this.progress.get(key);
    if (p) p.done = Math.min(p.total || Infinity, p.done + by);
  }
  /** A foreground request grading `key` on its own clock. */
  claim(key: string): boolean {
    if (this.known(key)) return false;
    this.claimed.add(key);
    return true;
  }
  release(key: string, outcome?: { ok: boolean; error?: string | null }): void {
    this.claimed.delete(key);
    this.progress.delete(key);
    if (outcome) this.record(key, outcome);
  }
  record(key: string, outcome: { ok: boolean; error?: string | null }): void {
    const prev = this.last.get(key);
    this.last.set(key, {
      at: this.now(), ok: outcome.ok, error: outcome.ok ? null : (outcome.error || 'failed'),
      failures: outcome.ok ? 0 : (prev && !prev.ok ? prev.failures + 1 : 1),
    });
    if (this.last.size > 500) {
      const oldest = Array.from(this.last.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 100);
      for (const [k] of oldest) this.last.delete(k);
    }
  }
  /**
   * Queue a key. Returns its place. A key already known is never queued twice
   * — but a higher priority raises it (the page's own window outranks a
   * background sweep).
   *
   * ORDER (zzz807): priority first, then NEWEST DAY FIRST. Keys begin with the
   * ISO session date, so a descending key sort is newest-first. The queue used
   * to be first-come-first-served, and a bench sweep that asks for its window
   * oldest-first put 2026-08-04 at the front while the day the owner was
   * looking at sat fifty places back.
   */
  enqueue(key: string, force = false, prio = 0): number {
    const q = this.queue.find((x) => x.key === key);
    if (q) {
      if (prio > q.prio || (force && !q.force)) { q.prio = Math.max(q.prio, prio); q.force = q.force || force; this.sortQueue(); }
      return this.place(key);
    }
    if (this.known(key)) return this.place(key);
    this.queue.push({ key, force, prio, seq: this.seq++ });
    this.sortQueue();
    this.pump();
    return this.place(key);
  }
  private sortQueue(): void {
    this.queue.sort((a, b) => (b.prio - a.prio) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0) || (a.seq - b.seq));
  }
  /** Keys waiting, in the order they will run (running ones not included). */
  pendingKeys(): string[] { return this.queue.map((q) => q.key); }
  private pump(): void {
    while (this.running.size < this.max && this.queue.length) {
      const { key, force } = this.queue.shift()!;
      this.running.add(key);
      this.setProgress(key, { stage: 'starting', done: 0, total: 0 });
      void Promise.resolve()
        .then(() => this.runner(key, force))
        .then((o) => o, (e) => ({ ok: false, error: String(e?.message || e) }))
        .then((o) => {
          this.running.delete(key);
          this.progress.delete(key);
          this.record(key, o);
          this.pump();
        });
    }
  }
}

// ─── the filer list: fetched, empty, or failed ────────────────────────────

export type FilerFetchStatus = 'ok' | 'none-yet' | 'partial' | 'failed';

/**
 * `perDay[i]` is the filer list for `dates[i]`, or `undefined`/`null` when the
 * fetch threw. A failed fetch is never the same fact as an empty day.
 */
export function classifyFilerFetch(dates: string[], perDay: Array<unknown[] | null | undefined>, today: string): {
  status: FilerFetchStatus; failed: string[]; found: number;
} {
  const failed = dates.filter((_, i) => !Array.isArray(perDay[i]));
  const found = perDay.reduce<number>((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  if (dates.length && failed.length === dates.length) return { status: 'failed', failed, found: 0 };
  if (failed.length) return { status: 'partial', failed, found };
  if (found === 0 && dates.some((d) => d >= today)) return { status: 'none-yet', failed, found };
  return { status: 'ok', failed, found };
}

/** The sentence the page shows for a day, from what the server said. */
export function dayStatusLine(d: {
  date: string;
  grading?: boolean;
  failed?: boolean;
  error?: string | null;
  retryInMs?: number | null;
  progress?: { stage: string; done: number; total: number } | null;
  place?: number | null;
  length?: number | null;
}): string {
  if (d.failed) {
    const mins = d.retryInMs != null ? Math.max(1, Math.round(d.retryInMs / 60_000)) : null;
    return `${d.date}: the filer list could not be fetched from SEC EDGAR (${d.error || 'source failed'}) — will retry${mins ? ` in about ${mins} min` : ''}.`;
  }
  if (d.grading) {
    const p = d.progress;
    if (p && p.total > 0) return `${d.date}: graded ${Math.min(p.done, p.total)} of ${p.total} filers (${p.stage}).`;
    if (p) return `${d.date}: ${p.stage}…`;
    if (d.place && d.place > 1) return `${d.date}: waiting — ${d.place - 1} session${d.place > 2 ? 's' : ''} ahead in the queue.`;
    return `${d.date}: starting — finding the day's earnings filers on EDGAR.`;
  }
  return '';
}

// ─── the page's side: what to ask the server for one day ─────────────────

export type DayPlan =
  | { action: 'use-cache' }
  | { action: 'ask-server'; force: boolean; keepShowing: boolean };

/**
 * One session on the page, one decision.
 *
 *  • A hard re-scan sends `force` exactly ONCE per day — the first request of
 *    that re-scan. Every later poll is a plain probe, which the server answers
 *    from the fresh result the moment it lands. (Sending force on every poll is
 *    what re-graded the same day for ever.)
 *  • While a day is being re-graded — by a re-scan or because a new engine
 *    version made its cached grade stale — the previous grade STAYS ON SCREEN
 *    and is replaced in place; nothing is wiped first, and nothing is fetched
 *    outside the server's one-at-a-time queue.
 *  • A fresh cached day never touches the network.
 */
export function planDayRequest(i: {
  cached: { stale: boolean } | null;
  rescanRequested: boolean;
  forceAlreadySent: boolean;
  awaitingServer: boolean;
}): DayPlan {
  if (i.rescanRequested && !i.forceAlreadySent) return { action: 'ask-server', force: true, keepShowing: !!i.cached };
  if (i.awaitingServer) return { action: 'ask-server', force: false, keepShowing: !!i.cached };
  if (i.cached && !i.cached.stale) return { action: 'use-cache' };
  return { action: 'ask-server', force: false, keepShowing: !!i.cached };
}

/** How soon the page asks again about a day that is not final yet. */
export function pollDelayMs(d: { failed?: boolean; retryInMs?: number | null; readFailed?: boolean; place?: number | null }): number {
  if (d.failed) return Math.max(15_000, Math.min(10 * 60_000, (d.retryInMs ?? 60_000) + 2_000));
  if (d.readFailed) return 2_500;
  const place = d.place && d.place > 0 ? d.place : 1;
  return place <= 1 ? 8_000 : Math.min(150_000, 20_000 * place);
}

/** zzz807 — what the Hard re-scan button says it did. Never silent. */
export function rescanNoteText(gradingDays: string[], sessions: string[]): string {
  const running = gradingDays.length;
  if (running > 0) {
    const newestFirst = gradingDays.slice().sort().reverse();
    return `Already re-scanning — ${running} day${running > 1 ? 's' : ''} left, newest first (${newestFirst.slice(0, 3).join(', ')}${running > 3 ? ' …' : ''}). Nothing was queued twice; each day lands here as it finishes.`;
  }
  const rest = Math.max(0, sessions.length - 1);
  return `Re-scanning ${sessions[0]} from SEC EDGAR now; the other ${rest} day${rest === 1 ? '' : 's'} are re-graded from their stored filings instantly.`;
}

/** zzz807 — the window status line, in words a reader can act on. */
export function windowStatusLine(i: { companies: number; days: number; upToDate: number; refreshing: number; failed: number; notAsked: number }): string {
  const parts = [`${i.upToDate} up to date`];
  if (i.refreshing) parts.push(`${i.refreshing} refreshing (newest first)`);
  if (i.failed) parts.push(`${i.failed} could not be fetched`);
  if (i.notAsked) parts.push(`${i.notAsked} not yet asked`);
  return `${i.companies} companies shown · ${i.days} day${i.days === 1 ? '' : 's'}: ${parts.join(', ')}`;
}
