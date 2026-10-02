// ═══════════════════════════════════════════════════════════════════════════
// zzz810 — Concall feed: window loading, concall classification, honest status.
//
// Why this exists. The Radar tab said "0 concalls scanned · 0 in feed … this is
// normal off-season" in late September, the tail of the Q1 FY27 results wave,
// when hundreds of transcripts had been filed. Three faults stacked up:
//   1. The NSE adapter answered any window from a ~20-row "newest filings"
//      snapshot (CF Worker) as NSE_OK, so the live 30-day fetch never ran.
//      (Fixed in lib/nse-bse-feed: snapshotCoversWindow.)
//   2. Sub-window caches stored blocked / empty fetches — past windows for
//      180 days — so one bad fetch kept the feed empty after it recovered.
//   3. The UI turned "we could not fetch" and "nothing was filed" into the
//      same off-season sentence.
// This module owns the fixes for 2 and 3 plus the subject+detail classifier
// (NSE files every concall item under one generic category; the detail line
// says whether it is a transcript, a recording or an intimation).
// Pure / dependency-injected so it can be tested without the network.
// ═══════════════════════════════════════════════════════════════════════════

import type { FilingRecord } from './nse-bse-feed';
import { classifyFiling, type ConcallFilingType } from './concall-bullish';

// ─── Classification ─────────────────────────────────────────────────────────

export type ConcallKind =
  | 'EARNINGS_CALL_TRANSCRIPT'
  | 'BUSINESS_UPDATE_TRANSCRIPT'
  | 'INVESTOR_CALL_TRANSCRIPT'     // investor / analyst meet / conference call transcripts
  | 'AUDIO_RECORDING'
  | 'INVESTOR_PRESENTATION'
  | 'CALL_INTIMATION'             // routine notice of an upcoming call
  | 'AGM_TRANSCRIPT'              // shareholder meeting — readable, but not a concall
  | 'OTHER';

export interface ConcallClass {
  filing_type: ConcallFilingType | null;
  kind: ConcallKind | null;
  /** A call that actually took place (transcript or recording). */
  is_concall: boolean;
  /** Transcript text we can read. */
  is_transcript: boolean;
}

const TRANSCRIPT_RE = /\btranscripts?\b/i;
const FUTURE_TRANSCRIPT_RE = /transcripts?\s+(?:will|shall|would)\s+be\b|transcripts?\s+(?:to\s+be|is\s+to\s+be)\b/i;
const RECORDING_RE = /\b(?:audio|video)(?:\s*(?:\/|and|&)\s*(?:audio|video))?\s*(?:recording|file|link|clip)s?\b|\brecording\s+of\s+(?:the\s+)?(?:earnings|investor|analyst|conference|con\.?\s*call|business|call|meet)|\baudio[- ]recording\b|\bweb\s*cast\s+(?:link|recording)\b/i;
const PRESENTATION_RE = /\b(?:investor|earnings|results?|corporate|analyst)\s+(?:presentation|deck)\b|\bpresentation\s+(?:made\s+)?(?:to|for)\s+(?:the\s+)?(?:investors?|analysts?)\b/i;
const INTIMATION_RE = /\bintimation\b|\bschedule\s+of\b|\bscheduled\b|\bwill\s+be\s+(?:held|hosting|conducted|organi[sz]ed)\b|\bto\s+be\s+held\b|\binvit(?:e|ation)\b|\bupcoming\b|\bpropos(?:es|ed)\s+to\s+(?:hold|conduct|host)\b|\bis\s+organi[sz]ing\b|\bwill\s+(?:host|participate|meet)\b/i;
// Live NSE, 28 Aug → 27 Sep 2026: the detail line is often terse — "…about
// Transcript", "…about Link of Recording", "…about Presentation" — under the
// generic con-call category, so a bare word counts when the call context is
// there (subject or detail).
const CALL_CONTEXT_RE = /\bcon(?:ference)?\.?\s*call|\bconcall\b|\banalyst|\binstitutional\s+investor|\binvestors?\s+(?:call|meet|conference|day)|\bearnings\b|\bcall\b/i;
const BARE_RECORDING_RE = /\brecordings?\b/i;
const BARE_PRESENTATION_RE = /\bpresentation\b/i;
const AGM_RE = /\bannual\s+general\s+meeting\b|\bAGM\b|\bextra[- ]?ordinary\s+general\s+meeting\b|\bEGM\b/i;
const BUSINESS_UPDATE_RE = /\bbusiness\s+update\b/i;
const EARNINGS_RE = /\bearnings?\b|\bresults?\b|\bq[1-4]\s*(?:fy)?\s*'?\d{0,4}\b|\bquarter(?:ly)?\b|\bfinancial\s+performance\b/i;
const CALL_RE = /\bcon(?:ference)?\.?\s*call\b|\bconcall\b|\binvestor(?:s)?\s+(?:call|meet)|\banalyst(?:s)?\s*(?:\/\s*institutional\s+investor)?\s*(?:call|meet)|\binstitutional\s+investor\s+meet\b|\bearnings\s+call\b|\bcall\b/i;

/**
 * Classify an exchange filing from its subject AND detail line.
 * Earnings-call, business-update, investor-call and analyst-meet transcripts
 * all count as concalls. A routine notice of an upcoming call does not.
 */
export function classifyConcallFiling(subject: string, detail?: string | null): ConcallClass {
  const text = `${subject || ''} ${detail || ''}`.replace(/\s+/g, ' ').trim();
  const hasTranscript = TRANSCRIPT_RE.test(text) && !(FUTURE_TRANSCRIPT_RE.test(text) && !/\btranscripts?\s+of\b/i.test(text));
  const agm = AGM_RE.test(text);
  const callCtx = CALL_CONTEXT_RE.test(text);
  if (hasTranscript && agm && !/\b(?:earnings|analyst|investor\s+call|con(?:ference)?\.?\s*call)\b/i.test(detail || subject || '')) {
    return { filing_type: 'TRANSCRIPT', kind: 'AGM_TRANSCRIPT', is_concall: false, is_transcript: true };
  }
  if (hasTranscript) {
    const kind: ConcallKind = BUSINESS_UPDATE_RE.test(text)
      ? 'BUSINESS_UPDATE_TRANSCRIPT'
      : EARNINGS_RE.test(text)
        ? 'EARNINGS_CALL_TRANSCRIPT'
        : 'INVESTOR_CALL_TRANSCRIPT';
    return { filing_type: 'TRANSCRIPT', kind, is_concall: true, is_transcript: true };
  }
  if (RECORDING_RE.test(text) || (BARE_RECORDING_RE.test(text) && callCtx)) {
    return { filing_type: 'AUDIO_RECORDING', kind: 'AUDIO_RECORDING', is_concall: !agm, is_transcript: false };
  }
  if (PRESENTATION_RE.test(text) || (BARE_PRESENTATION_RE.test(text) && callCtx && !INTIMATION_RE.test(detail || ''))) {
    return { filing_type: 'INVESTOR_PRESENTATION', kind: 'INVESTOR_PRESENTATION', is_concall: false, is_transcript: false };
  }
  if (CALL_RE.test(text) && INTIMATION_RE.test(text)) {
    return { filing_type: 'CONCALL_INVITE', kind: 'CALL_INTIMATION', is_concall: false, is_transcript: false };
  }
  const ft = classifyFiling(text);
  if (!ft) return { filing_type: null, kind: null, is_concall: false, is_transcript: false };
  return { filing_type: ft, kind: 'OTHER', is_concall: false, is_transcript: false };
}

/** Subject with the detail line folded in, for display and downstream regexes. */
export function displaySubject(f: Pick<FilingRecord, 'subject' | 'detail'>): string {
  const d = (f.detail || '').trim();
  if (!d || d === f.subject) return f.subject;
  const clipped = d.length > 240 ? `${d.slice(0, 237)}…` : d;
  return `${f.subject} — ${clipped}`;
}

// ─── Dedupe across NSE / BSE ────────────────────────────────────────────────

function normCompany(n: string): string {
  return (n || '').toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|corp(?:oration)?|inc|company|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Same document filed on NSE and BSE within minutes → one row.
 * Exact duplicates (same content_hash) always collapse. Cross-exchange: same
 * company + same day + same concall kind collapses, NSE preferred. Different
 * documents from one company on one day (a presentation in the morning, a
 * transcript at night) stay separate.
 */
export function dedupeConcallFilings(filings: FilingRecord[]): FilingRecord[] {
  const byHash = new Map<string, FilingRecord>();
  for (const f of filings) if (!byHash.has(f.content_hash)) byHash.set(f.content_hash, f);
  const out = new Map<string, FilingRecord>();
  for (const f of byHash.values()) {
    const cls = classifyConcallFiling(f.subject, f.detail);
    const kindKey = cls.kind && cls.kind !== 'OTHER' ? cls.kind : `${f.exchange}|${f.subject.toLowerCase()}`;
    const key = `${normCompany(f.company_name) || f.symbol.toLowerCase()}|${f.filing_datetime.slice(0, 10)}|${kindKey}`;
    const prev = out.get(key);
    if (!prev) { out.set(key, f); continue; }
    if (prev.exchange !== 'NSE' && f.exchange === 'NSE') out.set(key, f);
  }
  return [...out.values()];
}

// ─── Window loading with backfill ───────────────────────────────────────────

export type SourceState = 'OK' | 'EMPTY' | 'BLOCKED';

export interface SourceFetch {
  filings: FilingRecord[];
  source: string;          // NSE_OK / NSE_BLOCKED / NSE_EMPTY / BSE_…
  reason?: string;
}

export interface WindowStore {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttlSeconds: number): Promise<void>;
}

export interface LoadWindowDeps {
  fetchNSE(fromIso: string, toIso: string): Promise<SourceFetch>;
  fetchBSE(fromIso: string, toIso: string): Promise<SourceFetch>;
  store?: WindowStore | null;
  now?: () => Date;
  /** Pause between sub-window batches (politeness). Default 600ms. */
  politeDelayMs?: number;
}

export interface LoadedWindow {
  filings: FilingRecord[];
  from_iso: string;
  to_iso: string;
  nse: SourceState;
  bse: SourceState;
  nse_reason?: string;
  bse_reason?: string;
  windows_total: number;
  windows_from_store: number;
  windows_backfilled: number;
}

export const SUBWIN_STORE_KEY = (fromIso: string, toIso: string) => `subwin-filings:v2:${fromIso}:${toIso}`;
const SUBWIN_TTL_PAST = 180 * 24 * 60 * 60;
const SUBWIN_TTL_CURRENT = 30 * 60;

/** Today's calendar date in India (the exchanges' clock), as YYYY-MM-DD. */
export function istDateIso(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function shiftIso(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Split a `days` window ending today (IST) into ≤30-day chunks, newest first. */
export function subWindowsFor(days: number, now: Date, chunkDays = 30): Array<{ fromIso: string; toIso: string }> {
  const out: Array<{ fromIso: string; toIso: string }> = [];
  let to = istDateIso(now);
  let remaining = Math.max(1, Math.floor(days));
  while (remaining > 0) {
    const size = Math.min(chunkDays, remaining);
    out.push({ fromIso: shiftIso(to, -(size - 1)), toIso: to });
    to = shiftIso(to, -size);
    remaining -= size;
  }
  return out;
}

function stateOf(source: string | undefined): SourceState {
  if (!source) return 'BLOCKED';
  if (/_OK$/.test(source)) return 'OK';
  if (/_EMPTY$/.test(source)) return 'EMPTY';
  return 'BLOCKED';
}

/** A stored sub-window is usable only if a source succeeded and it holds rows. */
export function isUsableSubwindow(hit: any): boolean {
  if (!hit || !hit.nse || !hit.bse) return false;
  if (!Array.isArray(hit.nse.filings) || !Array.isArray(hit.bse.filings)) return false;
  const okAny = stateOf(hit.nse.source) === 'OK' || stateOf(hit.bse.source) === 'OK';
  return okAny && hit.nse.filings.length + hit.bse.filings.length > 0;
}

/**
 * Load every filing in the last `days` days. Stored sub-windows are reused;
 * a missing, empty or failed one is fetched from the exchanges (backfill)
 * and stored only if the fetch actually succeeded — a blocked fetch is never
 * cached as "no filings".
 */
export async function loadConcallWindow(days: number, deps: LoadWindowDeps, opts: { force?: boolean } = {}): Promise<LoadedWindow> {
  const now = deps.now ? deps.now() : new Date();
  const todayIso = istDateIso(now);
  const windows = subWindowsFor(days, now);
  const store = deps.store || null;
  const delay = deps.politeDelayMs ?? 600;

  const results: Array<{ nse: SourceFetch; bse: SourceFetch }> = [];
  const misses: typeof windows = [];
  let fromStore = 0;
  if (store && !opts.force) {
    const reads = await Promise.all(windows.map((w) => store.get(SUBWIN_STORE_KEY(w.fromIso, w.toIso)).catch(() => null)));
    windows.forEach((w, i) => {
      if (isUsableSubwindow(reads[i])) { results.push({ nse: reads[i].nse, bse: reads[i].bse }); fromStore++; }
      else misses.push(w);
    });
  } else {
    misses.push(...windows);
  }

  const CONC = 2;
  for (let i = 0; i < misses.length; i += CONC) {
    const batch = misses.slice(i, i + CONC);
    const got = await Promise.all(batch.map(async (w) => {
      const [nse, bse] = await Promise.all([
        deps.fetchNSE(w.fromIso, w.toIso).catch((e: any): SourceFetch => ({ filings: [], source: 'NSE_BLOCKED', reason: `NSE ${e?.message || 'error'}` })),
        deps.fetchBSE(w.fromIso, w.toIso).catch((e: any): SourceFetch => ({ filings: [], source: 'BSE_BLOCKED', reason: `BSE ${e?.message || 'error'}` })),
      ]);
      return { w, nse, bse };
    }));
    for (const { w, nse, bse } of got) {
      results.push({ nse, bse });
      const entry = {
        fromIso: w.fromIso, toIso: w.toIso,
        nse: { filings: nse.filings, source: nse.source, reason: nse.reason },
        bse: { filings: bse.filings, source: bse.source, reason: bse.reason },
        fetched_at: now.toISOString(),
      };
      if (store && isUsableSubwindow(entry)) {
        // Only a window where BOTH sources succeeded is final; a half-fetched
        // past window is kept briefly so the missing side is retried.
        const bothOk = stateOf(nse.source) === 'OK' && stateOf(bse.source) === 'OK';
        const ttl = w.toIso < todayIso && bothOk ? SUBWIN_TTL_PAST : SUBWIN_TTL_CURRENT;
        await store.set(SUBWIN_STORE_KEY(w.fromIso, w.toIso), entry, ttl).catch(() => {});
      }
    }
    if (i + CONC < misses.length && delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  // Merge (exact-duplicate dedupe; cross-exchange collapse happens after scoring).
  const merged = new Map<string, FilingRecord>();
  let nse: SourceState = 'BLOCKED', bse: SourceState = 'BLOCKED';
  let nseReason: string | undefined, bseReason: string | undefined;
  const rank = (s: SourceState) => (s === 'OK' ? 2 : s === 'EMPTY' ? 1 : 0);
  for (const r of results) {
    const ns = stateOf(r.nse.source), bs = stateOf(r.bse.source);
    if (rank(ns) > rank(nse)) nse = ns;
    if (rank(bs) > rank(bse)) bse = bs;
    if (ns !== 'OK' && r.nse.reason && !nseReason) nseReason = r.nse.reason;
    if (bs !== 'OK' && r.bse.reason && !bseReason) bseReason = r.bse.reason;
    for (const f of r.nse.filings) if (!merged.has(f.content_hash)) merged.set(f.content_hash, f);
    for (const f of r.bse.filings) if (!merged.has(f.content_hash)) merged.set(f.content_hash, f);
  }
  return {
    filings: [...merged.values()],
    from_iso: windows[windows.length - 1].fromIso,
    to_iso: windows[0].toIso,
    nse, bse,
    ...(nse !== 'OK' ? { nse_reason: nseReason || (nse === 'EMPTY' ? 'NSE returned no announcements' : 'NSE unreachable') } : {}),
    ...(bse !== 'OK' ? { bse_reason: bseReason || (bse === 'EMPTY' ? 'BSE returned no announcements' : 'BSE unreachable') } : {}),
    windows_total: windows.length,
    windows_from_store: fromStore,
    windows_backfilled: misses.length,
  };
}

// ─── Honest status ──────────────────────────────────────────────────────────

export type FeedState = 'OK' | 'PARTIAL' | 'EMPTY' | 'FAILED';

export interface FeedStatus {
  state: FeedState;
  message: string;
  nse: SourceState;
  bse: SourceState;
  reason?: string;
  last_success_at: string | null;
  announcements_total: number;
  concall_filings: number;
  transcripts: number;
  window_days: number;
  from_iso?: string;
  to_iso?: string;
  retrying: boolean;
}

/** "Thu 17 Sep, 19:45 IST" — or "never" for a first run. */
export function formatIst(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return 'never';
  const ist = new Date(t.getTime() + 330 * 60_000);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][ist.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][ist.getUTCMonth()];
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${wd} ${ist.getUTCDate()} ${mo}, ${hh}:${mm} IST`;
}

/** Below this many concall filings in a fetched window, say the count is low. */
export const LOW_CONCALL_COUNT = 6;

export function buildFeedStatus(input: {
  nse: SourceState;
  bse: SourceState;
  nse_reason?: string;
  bse_reason?: string;
  announcements_total: number;
  concall_filings: number;
  transcripts: number;
  window_days: number;
  last_success_at: string | null;
  from_iso?: string;
  to_iso?: string;
}): FeedStatus {
  const { nse, bse, announcements_total: total, concall_filings: n, transcripts: tx, window_days: days } = input;
  const reasons = [nse !== 'OK' ? input.nse_reason : null, bse !== 'OK' ? input.bse_reason : null].filter(Boolean) as string[];
  const reason = reasons.join('; ') || undefined;
  const base = {
    nse, bse, reason, last_success_at: input.last_success_at,
    announcements_total: total, concall_filings: n, transcripts: tx, window_days: days,
    from_iso: input.from_iso, to_iso: input.to_iso,
  };
  const anyOk = nse === 'OK' || bse === 'OK';
  if (!anyOk || total === 0) {
    return {
      ...base,
      state: 'FAILED',
      retrying: true,
      message: `Couldn't reach NSE/BSE announcements (${reason || 'no announcements returned'}) — last successful fetch ${formatIst(input.last_success_at)}; retrying.`,
    };
  }
  const countLine = `${n} concall filing${n === 1 ? '' : 's'} (${tx} transcript${tx === 1 ? '' : 's'}) out of ${total} announcements in the last ${days} days`;
  if (nse !== 'OK' || bse !== 'OK') {
    const down = nse !== 'OK' ? 'NSE' : 'BSE';
    return {
      ...base,
      state: 'PARTIAL',
      retrying: true,
      message: `${countLine}. ${down} could not be reached (${reason || 'unknown'}), so this may be incomplete — retrying.`,
    };
  }
  if (n === 0) {
    return {
      ...base,
      state: 'EMPTY',
      retrying: false,
      message: `NSE and BSE answered: ${total} announcements in the last ${days} days, and none were concall transcripts, recordings or presentations.`,
    };
  }
  return {
    ...base,
    state: 'OK',
    retrying: false,
    message: n <= LOW_CONCALL_COUNT
      ? `${countLine}. That is a low count — a quiet stretch between results waves.`
      : `${countLine}.`,
  };
}

/** Counts used by buildFeedStatus, from a list of (already deduped) filings. */
export function countConcalls(filings: Array<Pick<FilingRecord, 'subject' | 'detail'>>): { concall_filings: number; transcripts: number } {
  let concall = 0, tx = 0;
  for (const f of filings) {
    const c = classifyConcallFiling(f.subject, f.detail);
    if (c.is_concall || c.kind === 'INVESTOR_PRESENTATION') concall++;
    if (c.is_transcript && c.is_concall) tx++;
  }
  return { concall_filings: concall, transcripts: tx };
}

export const LAST_OK_KEY = 'concall-feed:last-ok:v1';

// ─── zzz854: durable read of the India exchange filing feed ─────────────────────────────────────────────────────────────────────────
// The live-feed route writes `concall-feed:v26:days:N` with short TTLs, so a reader often finds the 30-day key absent. A reader must NOT
// treat that as "no filings": it falls back to the next-best key (14 / 7 / 2 days), then to a durable last-good copy, and labels what it used.
// A read that throws or times out is FAILED (unknown), never zero. The last-good copy is written (throttled) whenever a live key is read.
export const CONCALL_FEED_KEY = (days: number) => `concall-feed:v26:days:${days}`;
export const CONCALL_FEED_DAYS_ORDER = [30, 14, 7, 2] as const;
export const CONCALL_FEED_LASTGOOD_KEY = 'concall-feed:v26:lastgood';
/** at least 26 h, so one missed hourly refresh or a night without traffic never empties the feed */
export const CONCALL_FEED_LASTGOOD_TTL_S = 30 * 3600;
const CONCALL_LASTGOOD_THROTTLE_MS = 10 * 60_000;
const CONCALL_LASTGOOD_MAX_CHARS = 900_000;
let concallLastGoodWrittenAt = 0;
export function _resetConcallLastGoodThrottle(): void { concallLastGoodWrittenAt = 0; }

export interface FeedKvRead { value: any; failed?: boolean; timedOut?: boolean; reason?: string }
export interface FeedIo { get(key: string): Promise<FeedKvRead>; set(key: string, value: any, ttlSeconds: number): Promise<void>; now?(): number }
export type ConcallFeedServedBy = 'LIVE' | 'FALLBACK_KEY' | 'LASTGOOD' | 'NONE';
export interface ConcallFeedRead {
  /** the payload ({ filings: [...] }) or null when no key and no last-good copy held any */
  feed: any | null;
  servedBy: ConcallFeedServedBy;
  /** the key the filings came from */
  keyUsed: string | null;
  /** keys read and what each said: HIT / MISS (absent) / EMPTY (no filings) / FAILED (read error or timeout: unknown, never zero) */
  tried: Array<{ key: string; state: 'HIT' | 'MISS' | 'EMPTY' | 'FAILED'; reason?: string }>;
  /** ISO time the last-good copy was saved (when it served) and its age in minutes */
  lastGoodAt: string | null; ageMinutes: number | null;
  /** true when the answer is not the preferred live key (the page says so) */
  stale: boolean;
  /** one honest sentence for coverage / scan notes */
  label: string;
  /** true when every read FAILED (not one key answered): the caller reports FAILED, never zero filings */
  allFailed: boolean;
  wrote: Promise<void>;
}
const hasFilings = (v: any): boolean => !!v && Array.isArray(v.filings) && v.filings.length > 0;
const ageMin = (iso: string | null, nowMs: number): number | null => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 60_000)) : null; };
const ageWords = (m: number | null): string => (m == null ? 'an unknown time ago' : m < 90 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`);

export async function readConcallFeedWithFallback(io: FeedIo, prefer: readonly number[] = CONCALL_FEED_DAYS_ORDER): Promise<ConcallFeedRead> {
  const nowMs = (io.now ?? Date.now)();
  const tried: ConcallFeedRead['tried'] = [];
  const preferred = CONCALL_FEED_KEY(prefer[0] ?? 30);
  for (const d of prefer) {
    const key = CONCALL_FEED_KEY(d);
    const r = await io.get(key).catch((e: any): FeedKvRead => ({ value: null, failed: true, reason: String(e?.message || e || 'read failed').slice(0, 80) }));
    if (r.failed || r.timedOut) { tried.push({ key, state: 'FAILED', reason: r.timedOut ? 'timed out' : r.reason || 'read failed' }); continue; }
    if (r.value == null) { tried.push({ key, state: 'MISS' }); continue; }
    if (!hasFilings(r.value)) { tried.push({ key, state: 'EMPTY' }); continue; }
    tried.push({ key, state: 'HIT' });
    let wrote: Promise<void> = Promise.resolve();
    if (nowMs - concallLastGoodWrittenAt >= CONCALL_LASTGOOD_THROTTLE_MS) {
      concallLastGoodWrittenAt = nowMs;
      const filings = (r.value.filings as any[]).slice();
      let copy = { savedAt: new Date(nowMs).toISOString(), fromKey: key, filings };
      while (copy.filings.length > 1 && JSON.stringify(copy).length > CONCALL_LASTGOOD_MAX_CHARS) copy = { ...copy, filings: copy.filings.slice(0, Math.ceil(copy.filings.length * 0.85)) };
      wrote = io.set(CONCALL_FEED_LASTGOOD_KEY, copy, CONCALL_FEED_LASTGOOD_TTL_S).catch(() => undefined);
    }
    const fb = key !== preferred;
    const misses = tried.filter((t) => t.state !== 'HIT').map((t) => `${t.key} ${t.state === 'MISS' ? 'missing' : t.state === 'EMPTY' ? 'empty' : `read failed (${t.reason})`}`);
    return { feed: r.value, servedBy: fb ? 'FALLBACK_KEY' : 'LIVE', keyUsed: key, tried, lastGoodAt: null, ageMinutes: null, stale: fb, allFailed: false, wrote,
      label: fb ? `India exchange filing feed: ${misses.join(', ')}; using ${key} (${r.value.filings.length} filings, shorter window).` : `India exchange filing feed: read ${key} (${r.value.filings.length} filings).` };
  }
  const lg = await io.get(CONCALL_FEED_LASTGOOD_KEY).catch((e: any): FeedKvRead => ({ value: null, failed: true, reason: String(e?.message || e).slice(0, 80) }));
  tried.push({ key: CONCALL_FEED_LASTGOOD_KEY, state: lg.failed || lg.timedOut ? 'FAILED' : lg.value == null ? 'MISS' : hasFilings(lg.value) ? 'HIT' : 'EMPTY', ...(lg.failed || lg.timedOut ? { reason: lg.timedOut ? 'timed out' : lg.reason || 'read failed' } : {}) });
  const allFailed = tried.every((t) => t.state === 'FAILED');
  const misses = tried.filter((t) => t.key !== CONCALL_FEED_LASTGOOD_KEY).map((t) => `${t.key} ${t.state === 'MISS' ? 'missing' : t.state === 'EMPTY' ? 'empty' : `read failed (${t.reason})`}`).join(', ');
  if (hasFilings(lg.value)) {
    const at = typeof lg.value.savedAt === 'string' ? lg.value.savedAt : null; const age = ageMin(at, nowMs);
    return { feed: lg.value, servedBy: 'LASTGOOD', keyUsed: CONCALL_FEED_LASTGOOD_KEY, tried, lastGoodAt: at, ageMinutes: age, stale: true, allFailed: false, wrote: Promise.resolve(),
      label: `India exchange filing feed: ${misses}; serving the last good copy saved ${ageWords(age)} (${lg.value.filings.length} filings, STALE).` };
  }
  return { feed: null, servedBy: 'NONE', keyUsed: null, tried, lastGoodAt: null, ageMinutes: null, stale: true, allFailed, wrote: Promise.resolve(),
    label: allFailed ? `India exchange filing feed: every read FAILED (${misses}); unknown, not zero filings.` : `India exchange filing feed: no key and no last-good copy holds filings (${misses}); needs a refresh, this says nothing about whether filings exist.` };
}

/** Production wiring over the shared KV helpers (lazy import; tests inject their own io). */
export function makeKvFeedIo(timeoutMs: number): FeedIo {
  return {
    get: async (key) => {
      const { kvGet } = await import('./kv');
      let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
      try { const v = await Promise.race([kvGet<any>(key), new Promise<null>((r) => { timer = setTimeout(() => { timedOut = true; r(null); }, timeoutMs); })]); return { value: v, timedOut }; }
      catch (e: any) { return { value: null, failed: true, reason: String(e?.message || e).slice(0, 80) }; } finally { if (timer) clearTimeout(timer); }
    },
    set: async (key, value, ttl) => { const { kvSet } = await import('./kv'); await kvSet(key, value, ttl); },
  };
}
