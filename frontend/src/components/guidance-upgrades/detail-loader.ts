// zzz1128 (guidance retest R1) — the request life of an opened event, kept apart from React so it can be tested step by step.
// Completed full records are cached; an IN-FLIGHT request is not a result. Closing or switching aborts the request and drops its
// "loading" mark, so reopening starts a new request (the retest found close → reopen stuck on "Loading" with no request running).
// Every request carries an attempt number: a late answer from an older attempt never overwrites newer state. A deadline turns a hung
// request into a visible error with Retry. No React, no DOM.
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { normalizeFullEvent, type DetailLoad } from './detail-normalize';

export type Fetcher = (url: string, signal: AbortSignal) => Promise<{ status: number; ok: boolean; json: () => Promise<any> }>;
export interface DetailLoaderOpts { fetcher: Fetcher; deadlineMs?: number; onChange: () => void; urlFor: (id: string) => string }

export class DetailLoader {
  private done = new Map<string, GuidanceEvent>();
  private errors = new Map<string, string>();
  private inflight: { id: string; attempt: number; ctrl: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
  private attempt = 0;
  /** zzz1143 (E2) — the newest attempt started for each event: an answer from an older attempt is dropped, never cached */
  private latest = new Map<string, number>();
  requests = 0;
  constructor(private o: DetailLoaderOpts) {}

  /** The state for an event id: its cached full record, its error, loading (a request is running) or idle. */
  state(id: string | null): DetailLoad | undefined {
    if (!id) return undefined;
    const ev = this.done.get(id); if (ev) return { status: 'ok', event: ev };
    if (this.inflight?.id === id) return { status: 'loading' };
    const e = this.errors.get(id); if (e) return { status: 'error', text: e };
    return undefined;
  }
  /** Open an event. A full (not lean) record is used as it is; a lean one is fetched unless already cached or already loading. */
  open(id: string, lean: unknown, isLean: boolean): void {
    if (this.inflight && this.inflight.id !== id) this.cancel();
    if (!isLean) {
      const ev = normalizeFullEvent(lean, id);
      if (ev) this.done.set(id, ev); else this.errors.set(id, 'the record is incomplete');
      this.o.onChange(); return;
    }
    if (this.done.has(id) || this.inflight?.id === id) { this.o.onChange(); return; }
    this.errors.delete(id);
    this.start(id, lean);
  }
  /** Retry after an error (or a cancel). */
  retry(id: string, lean: unknown): void { if (this.done.has(id)) return; this.cancel(); this.errors.delete(id); this.start(id, lean); }
  /** Close / switch away: the request stops and leaves no "loading" mark behind. */
  cancel(): void {
    const f = this.inflight; if (!f) return;
    this.inflight = null; clearTimeout(f.timer); f.ctrl.abort();
    this.o.onChange();
  }
  /** A new event window: cached full records stay valid (same event ids), a running request is restarted by the next open. */
  private start(id: string, lean: unknown): void {
    const attempt = ++this.attempt; this.requests++;
    this.latest.set(id, attempt);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, this.o.deadlineMs ?? 20_000);
    this.inflight = { id, attempt, ctrl, timer };
    this.o.onChange();
    const mine = () => this.inflight?.attempt === attempt;
    this.o.fetcher(this.o.urlFor(id), ctrl.signal)
      .then(async (r) => {
        if (r.status === 404) throw new Error('this event is no longer in the feed');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json().catch(() => null);
        const ev = normalizeFullEvent(j?.event ? { ...(lean as object), ...j.event, lean: false } : null, id);
        if (!ev) throw new Error('the answer did not contain this event');
        // not the running attempt: keep the answer only if it is the newest attempt for this event (closed before it arrived, nothing
        // newer asked) and nothing is cached yet — an older answer arriving after a newer one never replaces it (evening verification E2)
        if (!mine()) { if (this.latest.get(id) === attempt && !this.done.has(id)) this.done.set(id, ev); return; }
        this.done.set(id, ev); this.inflight = null; clearTimeout(timer); this.o.onChange();
      })
      .catch((e: any) => {
        if (!mine()) return;                                 // cancelled or superseded: a newer attempt owns the state
        this.inflight = null; clearTimeout(timer);
        this.errors.set(id, timedOut ? 'no answer within 20 seconds' : String(e?.message || e));
        this.o.onChange();
      });
  }
}
