// zzz1044c — save logic for the standalone /watchlists list (the Telegram-synced list at /api/watchlist).
// Not the /charts watchlist engine. Pure / injectable so it can be tested without React or a server.
//
//  F08  decideInitialWatchlist — a successful (HTTP ok + valid shape) EMPTY list is the truth, so a deliberate clear
//       stays cleared on reload. This browser's own copy is used only when the read failed (network, HTTP error,
//       unreadable JSON, wrong shape) or the server says it has no record at all (`source: 'default'` — the server's
//       storage read returned nothing, which is also what a storage outage looks like).
//  F09  flag saves — the next flag is worked out from the flag the user can see (held outside React's updater),
//       the server's answer is checked, saves for one company run one at a time (a later click is sent after the
//       earlier one settles), and a failed save puts the flag back to the last saved value and marks the row
//       "not saved — retry". A failed flag never looks saved.
//  F10  list saves — one queue per list. Each write sends the latest intended list (last saved list + every change
//       still waiting). Only one write is in flight, so writes cannot finish out of order. A failed write undoes only
//       the changes that write carried, against the current list — later changes stay — and they are listed as
//       "not saved" with retry / dismiss.

// ── F08: which list to start from ─────────────────────────────────────────────

export type WatchlistReadResult =
  | { kind: 'response'; ok: boolean; status: number; body: unknown; parseFailed?: boolean }
  | { kind: 'error'; error?: unknown };

export type InitialWatchlistDecision =
  | { use: 'remote'; tickers: string[]; flags: Record<string, string> }
  | { use: 'local'; reason: 'network' | 'http' | 'parse' | 'schema' | 'no-record' };

const LEGACY_FLAG: Record<string, string> = { GREEN: '🟢', ORANGE: '🟠', RED: '🔴' };

/** The Telegram side may store GREEN / ORANGE / RED; the page shows the coloured dots. Unknown → no flag. */
export function normalizeFlag(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (FLAG_CYCLE.includes(s)) return s;
  return LEGACY_FLAG[s.toUpperCase()] || '';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function decideInitialWatchlist(read: WatchlistReadResult): InitialWatchlistDecision {
  if (read.kind === 'error') return { use: 'local', reason: 'network' };
  if (!read.ok) return { use: 'local', reason: 'http' };
  if (read.parseFailed) return { use: 'local', reason: 'parse' };
  const body = read.body;
  if (!isPlainObject(body)) return { use: 'local', reason: 'schema' };
  const list = body.watchlist;
  if (!Array.isArray(list) || !list.every((t) => typeof t === 'string' && t.trim().length > 0)) return { use: 'local', reason: 'schema' };
  if (body.flags !== undefined && body.flags !== null && !isPlainObject(body.flags)) return { use: 'local', reason: 'schema' };
  // The server answers `source: 'default'` when it has no stored list (never saved, or its storage read failed).
  // That is not a deliberate clear, so it must not wipe this browser's copy.
  if (list.length === 0 && body.source === 'default') return { use: 'local', reason: 'no-record' };
  const flags: Record<string, string> = {};
  if (isPlainObject(body.flags)) {
    for (const [k, v] of Object.entries(body.flags)) { const f = normalizeFlag(v); if (f) flags[k] = f; }
  }
  return { use: 'remote', tickers: [...(list as string[])], flags };
}

// ── shared: was a write confirmed? ────────────────────────────────────────────

export type WriteResult = { ok: true; list?: string[] } | { ok: false; error: string };

/** A write counts as saved only when HTTP is ok AND the body says `ok: true`. */
export function interpretWriteResponse(httpOk: boolean, status: number, body: unknown): WriteResult {
  if (!httpOk) return { ok: false, error: `HTTP ${status}` };
  if (!isPlainObject(body) || body.ok !== true) return { ok: false, error: 'server did not confirm' };
  const list = body.watchlist;
  if (Array.isArray(list) && list.every((t) => typeof t === 'string')) return { ok: true, list: [...list] };
  return { ok: true };
}

// ── F09: flags ────────────────────────────────────────────────────────────────

export const FLAG_CYCLE = ['', '🟢', '🟠', '🔴'];

/** ⚪ → 🟢 → 🟠 → 🔴 → ⚪, from the flag the user can see. */
export function nextFlag(current: string | null | undefined): string {
  const idx = FLAG_CYCLE.indexOf(normalizeFlag(current ?? ''));
  return FLAG_CYCLE[(idx + 1) % FLAG_CYCLE.length];
}

export interface FlagEntry {
  confirmed: string;          // last value the server confirmed
  desired: string;            // what the user last chose (shown while saving)
  inFlight: string | null;    // value of the save now in flight
  failed: string | null;      // value whose save failed (the row is marked; flag shown = confirmed)
}
export type FlagState = Record<string, FlagEntry>;
export type FlagStatus = 'saved' | 'saving' | 'error';
export interface FlagView { flag: string; status: FlagStatus; failedFlag: string | null }

const blank = (): FlagEntry => ({ confirmed: '', desired: '', inFlight: null, failed: null });

export function flagView(state: FlagState, ticker: string): FlagView {
  const e = state[ticker];
  if (!e) return { flag: '', status: 'saved', failedFlag: null };
  return { flag: e.desired, status: e.inFlight !== null ? 'saving' : e.failed !== null ? 'error' : 'saved', failedFlag: e.failed };
}

export interface FlagStep { state: FlagState; send: string | null }

export function clickFlag(state: FlagState, ticker: string): FlagStep {
  const e = state[ticker] || blank();
  const desired = nextFlag(e.desired);
  const send = e.inFlight === null ? desired : null;   // one save per company at a time; a later click goes after
  return { state: { ...state, [ticker]: { ...e, desired, failed: null, inFlight: send ?? e.inFlight } }, send };
}

export function retryFlag(state: FlagState, ticker: string): FlagStep {
  const e = state[ticker];
  if (!e || e.failed === null || e.inFlight !== null) return { state, send: null };
  const v = e.failed;
  return { state: { ...state, [ticker]: { ...e, desired: v, failed: null, inFlight: v } }, send: v };
}

export function settleFlag(state: FlagState, ticker: string, sent: string, ok: boolean): FlagStep {
  const e = state[ticker] || blank();
  let next: FlagEntry = { ...e, inFlight: null, confirmed: ok ? sent : e.confirmed };
  if (!ok && e.desired === sent) {
    // Nothing newer was chosen: undo this flag only and mark it.
    next = { ...next, desired: next.confirmed, failed: sent };
    return { state: { ...state, [ticker]: next }, send: null };
  }
  if (next.desired !== next.confirmed) {
    // A newer click is waiting — it replaces the flag entirely, so send it now.
    next = { ...next, inFlight: next.desired };
    return { state: { ...state, [ticker]: next }, send: next.desired };
  }
  return { state: { ...state, [ticker]: next }, send: null };
}

/** Server flags arrive (page load). Rows with a save in flight / waiting keep the user's choice. */
export function applyServerFlags(state: FlagState, flags: Record<string, string>): FlagState {
  const out: FlagState = {};
  for (const [t, e] of Object.entries(state)) {
    if (e.inFlight !== null || e.desired !== e.confirmed) out[t] = { ...e, confirmed: normalizeFlag(flags[t]) };
  }
  for (const [t, v] of Object.entries(flags)) {
    if (out[t]) continue;
    const f = normalizeFlag(v);
    out[t] = { confirmed: f, desired: f, inFlight: null, failed: null };
  }
  return out;
}

/** Drives the flag reducer: holds the state outside React, sends, checks, chains the next save. */
export class FlagSync {
  private state: FlagState = {};
  constructor(private readonly opts: {
    send: (ticker: string, flag: string) => Promise<boolean>;
    onChange?: (s: FlagState) => void;
    onFailed?: (ticker: string, flag: string) => void;
  }) {}
  private inflight = new Set<Promise<void>>();

  snapshot(): FlagState { return this.state; }
  view(ticker: string): FlagView { return flagView(this.state, ticker); }
  loadServer(flags: Record<string, string>): void { this.commit(applyServerFlags(this.state, flags)); }
  click(ticker: string): void { this.step(clickFlag(this.state, ticker), ticker); }
  retry(ticker: string): void { this.step(retryFlag(this.state, ticker), ticker); }
  /** Resolves when no save is in flight (tests). */
  async idle(): Promise<void> { while (this.inflight.size) await Promise.all([...this.inflight]); }

  private commit(s: FlagState) { this.state = s; this.opts.onChange?.(s); }
  private step(r: FlagStep, ticker: string) {
    this.commit(r.state);
    if (r.send !== null) this.fire(ticker, r.send);
  }
  private fire(ticker: string, value: string) {
    const p = (async () => {
      let ok = false;
      try { ok = (await this.opts.send(ticker, value)) === true; } catch { ok = false; }
      const r = settleFlag(this.state, ticker, value, ok);
      const failedNow = r.state[ticker]?.failed === value && !ok;
      this.step(r, ticker);
      if (failedNow) this.opts.onFailed?.(ticker, value);
    })();
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }
}

// ── F10: list changes ─────────────────────────────────────────────────────────

export interface ListOp { id: string; kind: 'add' | 'remove'; tickers: string[] }
export interface FailedListOp extends ListOp { error: string }
export interface ListSyncSnapshot {
  tickers: string[];          // what the user sees: last saved list + every change still waiting
  confirmed: string[];        // last list the server confirmed
  pending: ListOp[];          // changes not yet confirmed (in flight + waiting)
  failed: FailedListOp[];     // changes undone because their save failed
}

export function applyOps(base: string[], ops: ListOp[]): string[] {
  let out = [...base];
  for (const op of ops) {
    if (op.kind === 'add') { const have = new Set(out); for (const t of op.tickers) if (!have.has(t)) { out.push(t); have.add(t); } }
    else { const drop = new Set(op.tickers); out = out.filter((t) => !drop.has(t)); }
  }
  return out;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

export const EMPTY_LIST_SNAPSHOT: ListSyncSnapshot = { tickers: [], confirmed: [], pending: [], failed: [] };

export class WatchlistMutationQueue {
  private confirmed: string[] = [];
  private pending: ListOp[] = [];
  private failed: FailedListOp[] = [];
  private running = false;
  private current: Promise<void> | null = null;
  private seq = 0;
  private lastTickers: string[] = [];
  private snap: ListSyncSnapshot = EMPTY_LIST_SNAPSHOT;

  constructor(private readonly opts: {
    send: (list: string[]) => Promise<WriteResult>;
    onChange?: (s: ListSyncSnapshot) => void;
    onFailed?: (ops: ListOp[], error: string) => void;
  }) {}

  snapshot(): ListSyncSnapshot { return this.snap; }

  /** The list read at page load. Changes the user already made stay on top of it. */
  reset(confirmed: string[]): void { this.confirmed = [...confirmed]; this.emit(); }

  enqueue(kind: ListOp['kind'], tickers: string[]): ListOp | null {
    if (tickers.length === 0) return null;
    const op: ListOp = { id: `op${++this.seq}`, kind, tickers: [...tickers] };
    this.pending.push(op);
    this.emit();
    this.pump();
    return op;
  }

  retry(id: string): void {
    const i = this.failed.findIndex((f) => f.id === id);
    if (i < 0) return;
    const [f] = this.failed.splice(i, 1);
    this.pending.push({ id: f.id, kind: f.kind, tickers: f.tickers });
    this.emit();
    this.pump();
  }

  dismiss(id: string): void { this.failed = this.failed.filter((f) => f.id !== id); this.emit(); }

  /** Resolves when nothing is in flight or waiting (tests). */
  async idle(): Promise<void> { while (this.current) await this.current; }

  private emit() {
    const tickers = applyOps(this.confirmed, this.pending);
    if (!sameList(tickers, this.lastTickers)) this.lastTickers = tickers;   // keep the same array when nothing changed
    this.snap = { tickers: this.lastTickers, confirmed: [...this.confirmed], pending: [...this.pending], failed: [...this.failed] };
    this.opts.onChange?.(this.snap);
  }

  private pump() {
    if (this.running || this.pending.length === 0) return;
    this.running = true;
    this.current = (async () => {
      try {
        while (this.pending.length > 0) {
          const batch = [...this.pending];                       // every change waiting now
          const list = applyOps(this.confirmed, batch);         // the latest intended list
          let r: WriteResult;
          try { r = await this.opts.send(list); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : 'network error' }; }
          const ids = new Set(batch.map((o) => o.id));
          this.pending = this.pending.filter((o) => !ids.has(o.id));
          if (r.ok) {
            this.confirmed = r.list ?? list;
          } else {
            // Undo only what this write carried; changes made since stay waiting and go in the next write.
            this.failed.push(...batch.map((o) => ({ ...o, error: r.ok ? '' : r.error })));
          }
          this.emit();
          if (!r.ok) this.opts.onFailed?.(batch, r.error);
        }
      } finally {
        this.running = false;
        this.current = null;
      }
    })();
  }
}
