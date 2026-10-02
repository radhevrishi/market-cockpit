// zzz853 — processing queue + automated extraction for Guidance Upgrades.
//
// Exchange / SEC filings whose SUBJECT names a guidance-bearing document (AGM outcome, presentation, press release, results, call) are
// evidence that a primary document EXISTS, not that a raise happened. They are queued here, read a few at a time on each route run
// (highest priority first), and turned into primary-source candidates for the SAME engine. The backlog shrinks run by run.
//
//   KV key        guidance-upgrades:queue:v1   (one value, bounded in count and in size)
//   priority      P0 subject names guidance / outlook / forecast / target / expects / raises-increases-lowers-revises guidance / revenue|EBITDA|PAT target
//                 P1 results presentation / earnings release / press release / concall transcript   P2 anything else
//   status        QUEUED -> READING -> DONE | FAILED (retry later) | SOURCE_UNAVAILABLE (after 3 failures, or a 404 / 410)
//   backoff       failure 1: retry in 10 min; failure 2: retry in 2 h; failure 3: SOURCE_UNAVAILABLE, one last long re-check after 24 h, then never again
//   VERIFIED      only when company + metric + period + value were ALL read from the document. A document that cannot show all four stays
//                 DONE with `complete: false` and produces no candidate: it never makes anything verified.
//   budget        a run reads at most MAX_DOCS_PER_RUN documents inside DOC_BUDGET_MS; the rest wait for the next hourly run.
//
// All network access goes through the injected `fetchDoc(url)`. The default uses the repo's existing PDF text helper (lib/pdf-text-extractor,
// pdf-parse, KV text cache, exchange proxy) and a plain HTML/text fetch for SEC pages. Tests inject synthetic documents.
import type { GuCandidate, GuQueueItem, GuQueuePriority, GuQueueReport, GuQueueStatus } from './guidance-upgrades-types';
import { extractGuidance } from './guidance-upgrades';
import { runBounded } from './guidance-upgrades-scan';
import { guidanceDocIdOf, parseSecFilingIndexUrl } from './us-edgar-backfill';

export const QUEUE_KEY = 'guidance-upgrades:queue:v1';
export const QUEUE_TTL_S = 60 * 24 * 3600;
export const QUEUE_MAX_ITEMS = 900;
export const QUEUE_MAX_CHARS = 900_000;
/**
 * zzz854 throughput: was 12 docs / 15 s / 3 at a time, which left 87 documents waiting for 7+ runs. Now up to 30 docs per run, 5 at a time,
 * inside an 18 s budget (the route still caps the budget at 26 s minus what it has already spent, inside its 30 s maxDuration).
 * A PDF read takes ~2-5 s (KV text cache hits are faster), so a run reads ~18-30 documents; the hourly workflow calls the route twice
 * (30D and 120D windows), so ~40-60 documents per hour: a backlog of 87 drains in about 2 hours of weekday runs (see drainEstimate).
 */
export const MAX_DOCS_PER_RUN = 30;
/**
 * zzz857: budget 18 s -> 20 s (the route still caps it at 26 s minus what it already spent). A US item now costs 2-3 SEC requests
 * (index.json + the EX-99.1 press release, instead of the filing INDEX page, which carried no release text and always ended "numbers not
 * found") through the shared 8 req/s gate, so ~30 US documents take ~10-12 s of gate time. Count (30) and concurrency (5) are pinned by the
 * zzz853/zzz854 tests. The big US throughput gain is elsewhere: the GitHub EDGAR backfill hands every guidance-bearing 8-K exhibit to the
 * AI extractor as a GuidanceDoc, so the US backlog no longer has to drain through this queue.
 */
export const DOC_BUDGET_MS = 20_000;
export const QUEUE_CONCURRENCY = 5;
/** route runs per hour that process the queue (the hourly workflow calls the events route for 30D and 120D) */
export const QUEUE_RUNS_PER_HOUR = 2;
/** a conservative documents-per-run figure for the drain estimate (not every run gets the full budget) */
export const EXPECTED_DOCS_PER_RUN = 20;
/** minutes to wait after failure 1, failure 2, failure 3 (the last is the single long re-check of a SOURCE_UNAVAILABLE item) */
export const RETRY_DELAYS_MIN = [10, 120, 24 * 60] as const;
export const MAX_FAILURES = 3;
const READING_STALE_MS = 10 * 60_000;
const EVIDENCE_MAX_CHARS = 1500;

// ── priority ───────────────────────────────────────────────────────────────────────────────────────────────────────
const P0_RE = /\b(?:guidance|outlook|forecasts?|targets?|expects?|expectations?|(?:rais\w*|increas\w*|lower\w*|revis\w*)\s+(?:\w+\s+){0,3}?guidance|revenue targets?|ebitda targets?|pat targets?)\b/i;
const P1_RE = /\b(?:results?\s+presentation|investor presentation|earnings\s+(?:release|call)|press release|media release|con(?:ference)?\.? call|transcript|analyst(?:s)?\s*\/?\s*(?:and\s+)?institutional investor|investor (?:meet|call|day)|financial results|quarterly results|audited results|unaudited results)\b/i;
export function priorityOf(subject: string, sourceType = ''): GuQueuePriority {
  const hay = `${subject || ''} ${sourceType || ''}`;
  if (P0_RE.test(hay)) return 'P0';
  if (P1_RE.test(hay)) return 'P1';
  return 'P2';
}
const PRIO_RANK: Record<GuQueuePriority, number> = { P0: 0, P1: 1, P2: 2 };

const djb = (t: string): string => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };

export interface QueueInput {
  market: 'IN' | 'US';
  ticker?: string | null; company?: string | null; companyId?: string | null;
  sourceUrl?: string | null; sourceType: string; subject: string;
  /** the company's announcement date (YYYY-MM-DD or ISO) */
  eventDate: string;
  /** force a priority (a media-detected raise that has a filing on file is queued P0) */
  priority?: GuQueuePriority;
}
export const queueIdOf = (i: Pick<QueueInput, 'market' | 'ticker' | 'company' | 'sourceUrl' | 'subject' | 'eventDate'>): string =>
  `q_${djb(`${i.market}|${(i.sourceUrl || '').toLowerCase().replace(/[?#].*$/, '') || `${i.ticker || i.company || ''}|${i.eventDate.slice(0, 10)}|${(i.subject || '').toLowerCase().slice(0, 60)}`}`)}`;

export interface QueueState { v: 1; updatedAt: string; items: GuQueueItem[] }
export const emptyQueue = (now: Date = new Date()): QueueState => ({ v: 1, updatedAt: now.toISOString(), items: [] });
export function validQueue(v: any): QueueState | null {
  if (!v || typeof v !== 'object' || v.v !== 1 || !Array.isArray(v.items)) return null;
  const items = v.items.filter((x: any) => x && typeof x.id === 'string' && typeof x.processing_status === 'string' && typeof x.event_date === 'string');
  return { v: 1, updatedAt: String(v.updatedAt || ''), items };
}

/** Add newly discovered documents. Idempotent: an item already queued keeps its status and attempts (its priority only moves up). */
export function enqueue(q: QueueState, inputs: readonly QueueInput[], now: Date): { queue: QueueState; added: number; promoted: number } {
  const byId = new Map(q.items.map((x) => [x.id, x]));
  let added = 0; let promoted = 0;
  for (const inp of inputs) {
    if (!inp.subject || !inp.eventDate) continue;
    const id = queueIdOf(inp);
    const pr = inp.priority && PRIO_RANK[inp.priority] < PRIO_RANK[priorityOf(inp.subject, inp.sourceType)] ? inp.priority : priorityOf(inp.subject, inp.sourceType);
    const ex = byId.get(id);
    if (ex) {
      if (PRIO_RANK[pr] < PRIO_RANK[ex.priority]) { ex.priority = pr; promoted++; }
      if (!ex.source_url && inp.sourceUrl) { ex.source_url = inp.sourceUrl; if (ex.processing_status === 'SOURCE_UNAVAILABLE' && ex.attempt_count === 0) ex.processing_status = 'QUEUED'; }
      continue;
    }
    byId.set(id, {
      id, discovered_at: now.toISOString(), priority: pr, company_id: inp.companyId ?? inp.ticker ?? null, ticker: inp.ticker ?? null, company: inp.company ?? null, market: inp.market,
      source_url: inp.sourceUrl ?? null, source_type: inp.sourceType, subject: inp.subject.slice(0, 200), event_date: inp.eventDate.slice(0, 10),
      processing_status: 'QUEUED', attempt_count: 0, last_error: null, next_attempt: null, result: null,
    });
    added++;
  }
  return { queue: bound({ ...q, items: [...byId.values()], updatedAt: now.toISOString() }), added, promoted };
}

/** Keep the value inside one KV value: drop the oldest finished items first, never an item that is still waiting. */
export function bound(q: QueueState): QueueState {
  let items = q.items.slice();
  const keepRank = (x: GuQueueItem) => (x.processing_status === 'DONE' ? 0 : x.processing_status === 'SOURCE_UNAVAILABLE' ? 1 : 2);
  const sortForDrop = (a: GuQueueItem, b: GuQueueItem) => keepRank(a) - keepRank(b) || a.event_date.localeCompare(b.event_date);
  if (items.length > QUEUE_MAX_ITEMS) items = items.sort(sortForDrop).slice(items.length - QUEUE_MAX_ITEMS);
  while (items.length > 1 && JSON.stringify(items).length > QUEUE_MAX_CHARS) { items = items.sort(sortForDrop); items = items.slice(Math.ceil(items.length * 0.1)); }
  return { ...q, items };
}

// ── what is due ────────────────────────────────────────────────────────────────────────────────────────────────────
const dueAt = (x: GuQueueItem, nowMs: number): boolean => {
  if (!x.source_url) return false;                                                   // no link yet: nothing to read (wording stays 'Awaiting primary source')
  const t = x.next_attempt ? Date.parse(x.next_attempt) : 0;
  switch (x.processing_status) {
    case 'QUEUED': return !t || t <= nowMs;
    case 'FAILED': return !t || t <= nowMs;
    case 'READING': return nowMs - (t || 0) > READING_STALE_MS;                      // a run that died while reading: next_attempt holds the start time
    case 'SOURCE_UNAVAILABLE': return x.attempt_count === MAX_FAILURES && !!t && t <= nowMs;   // the one long re-check
    default: return false;
  }
};
/**
 * P0 first, then P1, then P2. Inside a priority the document that has WAITED LONGEST goes first (oldest discovered_at), so the backlog drains
 * in order and nothing starves behind a stream of new filings; among documents discovered together, the newest announcement first. At most `max`.
 */
export function selectDue(q: QueueState, now: Date, max: number = MAX_DOCS_PER_RUN): GuQueueItem[] {
  const nowMs = now.getTime();
  return q.items.filter((x) => dueAt(x, nowMs))
    .sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.discovered_at.localeCompare(b.discovered_at) || b.event_date.localeCompare(a.event_date))
    .slice(0, max);
}
/** zzz854: how long the current backlog takes to drain at the configured throughput (runs and hours, rounded up). */
export function drainEstimate(waitingDocs: number, perRun = EXPECTED_DOCS_PER_RUN, runsPerHour = QUEUE_RUNS_PER_HOUR): { runs: number; hours: number; text: string } {
  const n = Math.max(0, Math.floor(waitingDocs));
  if (!n) return { runs: 0, hours: 0, text: 'No backlog.' };
  const runs = Math.ceil(n / Math.max(1, perRun)); const hours = Math.ceil(runs / Math.max(1, runsPerHour));
  return { runs, hours, text: `about ${runs} run${runs === 1 ? '' : 's'} (~${hours} hour${hours === 1 ? '' : 's'} of scheduled weekday runs) to read all ${n}` };
}

// ── documents ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DocFetchResult {
  ok: boolean; status?: number; contentType?: string | null; text: string; reason?: string;
  /** zzz857: the document actually read when it differs from the queued link (an SEC filing index resolves to its EX-99.1 press release) */
  resolvedUrl?: string | null;
}
export type FetchDoc = (url: string) => Promise<DocFetchResult>;

const SKIP_TYPE = /^(?:image|audio|video)\/|zip|octet-stream$/i;
const nameTokens = (company: string | null | undefined): string[] => String(company || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ')
  .split(/\s+/).filter((w) => w.length >= 3 && !/^(?:ltd|limited|inc|corp|corporation|plc|company|co|the|india|industries|private|pvt)$/.test(w)).slice(0, 2);
/** the document must name the company (its name words, or its ticker as a word) */
export function namesCompany(text: string, o: { company?: string | null; ticker?: string | null }): boolean {
  const t = text.toLowerCase();
  const toks = nameTokens(o.company);
  if (toks.length && toks.every((w) => t.includes(w))) return true;
  const tk = String(o.ticker || '').toLowerCase();
  return !!tk && tk.length >= 2 && new RegExp(`\\b${tk.replace(/[^a-z0-9]/g, '')}\\b`, 'i').test(t);
}
const hasDate = (t: string): boolean => /\b(?:19|20)\d{2}\b/.test(t) || /\bFY\s?'?\d{2}\b/i.test(t);

export interface ValidationFailure { reason: string; permanent: boolean }
/** HTTP success, a readable content type, readable text, the company named, a date present. */
export function validateDocument(doc: DocFetchResult, item: Pick<GuQueueItem, 'company' | 'ticker'>): ValidationFailure | null {
  if (!doc.ok || (doc.status != null && (doc.status < 200 || doc.status >= 300))) {
    const st = doc.status ?? 0;
    return { reason: doc.reason || `HTTP ${st || 'error'}`, permanent: st === 404 || st === 410 };
  }
  if (doc.contentType && SKIP_TYPE.test(doc.contentType)) return { reason: `unsupported content type (${doc.contentType})`, permanent: true };
  const text = String(doc.text || '');
  if (text.replace(/\s+/g, ' ').trim().length < 200) return { reason: 'no readable text (empty or scanned image)', permanent: false };
  if ((item.company || item.ticker) && !namesCompany(text, item)) return { reason: 'the document does not name the company', permanent: false };
  if (!hasDate(text)) return { reason: 'the document carries no date or period', permanent: false };
  return null;
}

const KIND_OF = (sourceType: string): GuCandidate['kind'] =>
  /transcript|con(?:ference)?\.? call/i.test(sourceType) ? 'TRANSCRIPT' : /presentation|deck/i.test(sourceType) ? 'DECK' : /press release|earnings release|media release|8-?k/i.test(sourceType) ? 'RELEASE' : 'FILING';
const splitSentences = (t: string): string[] => t.replace(/\r/g, '\n').split(/(?<=[.!?])\s+(?=[A-Z₹$€£])|\n+|;\s+/).map((s) => s.trim()).filter(Boolean);

export interface ExtractionResult { complete: boolean; metrics: number; candidate: GuCandidate | null }
/**
 * Run the existing guidance extractor over the document text. COMPLETE only when company + metric + period + value were all read:
 * the document names the company (checked by validateDocument), and at least one guided measure has a known metric, a stated period and a number.
 * The candidate keeps only the evidence sentences (the ones the extractor read, plus the sentence that explains why), trimmed.
 */
export function extractFromDocument(text: string, item: Pick<GuQueueItem, 'id' | 'ticker' | 'company' | 'market' | 'source_url' | 'source_type' | 'subject' | 'event_date'>): ExtractionResult {
  const sents = splitSentences(text);
  const evidence: string[] = []; let metrics = 0; const seen = new Set<string>();
  for (const sn of sents) {
    const chs = extractGuidance(sn);
    if (!chs.length) continue;
    for (const c of chs) {
      const full = c.metric !== 'OTHER' && c.after.period !== 'UNSTATED' && c.after.low != null && c.after.high != null;
      const k = `${c.metric}|${c.after.period}|${c.after.low}|${c.after.high}`;
      if (full && !seen.has(k)) { seen.add(k); metrics++; }
    }
    evidence.push(sn);
  }
  if (!metrics) return { complete: false, metrics: 0, candidate: null };
  const joined = evidence.join(' ').slice(0, EVIDENCE_MAX_CHARS);
  const cand: GuCandidate = {
    id: `queue:${item.id}`, ticker: item.ticker || undefined, company: item.company || undefined, market: item.market, title: item.subject, text: joined,
    url: item.source_url || undefined, sourceName: item.market === 'IN' ? `Exchange filing (${item.source_type})` : `SEC filing (${item.source_type})`,
    publishedAt: item.event_date, kind: KIND_OF(item.source_type),
  };
  return { complete: true, metrics, candidate: cand };
}

// ── one run ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ProcessOptions { now: Date; fetchDoc: FetchDoc; budgetMs?: number; maxDocs?: number; concurrency?: number;
  /** zzz861: called for every document that was fetched AND validated (the text the worker read). The route stores it in the guidance-docs store so the AI extractor can read it; the worker never just marks a document read. */
  onRead?: (item: GuQueueItem, doc: DocFetchResult) => void }
export interface ProcessResult { queue: QueueState; attempted: number; done: number; complete: number; failed: number; unavailable: number; changed: boolean }

const applyFailure = (x: GuQueueItem, f: ValidationFailure, now: Date): void => {
  x.attempt_count = Math.max(1, x.attempt_count);
  x.last_error = f.reason.slice(0, 160);
  if (f.permanent || x.attempt_count >= MAX_FAILURES) {
    // after the third failure (or a 404 / 410): SOURCE_UNAVAILABLE. A third failure keeps ONE long re-check; a permanent error never retries.
    x.processing_status = 'SOURCE_UNAVAILABLE';
    x.next_attempt = !f.permanent && x.attempt_count === MAX_FAILURES ? new Date(now.getTime() + RETRY_DELAYS_MIN[2] * 60_000).toISOString() : null;
  } else {
    x.processing_status = 'FAILED';
    x.next_attempt = new Date(now.getTime() + RETRY_DELAYS_MIN[Math.min(x.attempt_count, RETRY_DELAYS_MIN.length) - 1] * 60_000).toISOString();
  }
};

/** Read the highest-priority due documents (bounded), update every touched item, return the new queue. Never throws. */
export async function processQueue(q: QueueState, o: ProcessOptions): Promise<ProcessResult> {
  const due = selectDue(q, o.now, o.maxDocs ?? MAX_DOCS_PER_RUN);
  const out = { queue: q, attempted: 0, done: 0, complete: 0, failed: 0, unavailable: 0, changed: false } as ProcessResult;
  if (!due.length) return out;
  const items = q.items.map((x) => ({ ...x }));
  const byId = new Map(items.map((x) => [x.id, x]));
  const res = await runBounded(due, async (d) => {
    const x = byId.get(d.id)!;
    x.processing_status = 'READING'; x.next_attempt = o.now.toISOString(); x.attempt_count += 1; out.attempted++;
    const doc = await o.fetchDoc(x.source_url!).catch((e: any): DocFetchResult => ({ ok: false, text: '', reason: String(e?.message || e || 'fetch failed').slice(0, 120) }));
    const bad = validateDocument(doc, x);
    if (bad) { applyFailure(x, bad, o.now); return; }
    try { o.onRead?.(x, doc); } catch { /* the hook is an accelerator */ }
    const ex = extractFromDocument(doc.text, x);
    x.processing_status = 'DONE'; x.last_error = null; x.next_attempt = null;
    x.result = { complete: ex.complete, metrics: ex.metrics, candidate: ex.candidate, readAt: o.now.toISOString() };
    markHandoff(x, doc, ex.complete);
    out.done++; if (ex.complete) out.complete++;
  }, { concurrency: o.concurrency ?? QUEUE_CONCURRENCY, budgetMs: o.budgetMs ?? DOC_BUDGET_MS });
  // an item that was started but did not finish inside the budget is a failed attempt (a timeout), never left in READING forever
  for (const r of res) {
    const x = byId.get(r.item.id)!;
    if (!r.ok && x.processing_status === 'READING') applyFailure(x, { reason: r.error === 'timeout' ? 'timeout inside the run budget' : (r.error || 'failed'), permanent: false }, o.now);
  }
  for (const d of due) { const x = byId.get(d.id)!; if (x.processing_status === 'FAILED') out.failed++; if (x.processing_status === 'SOURCE_UNAVAILABLE') out.unavailable++; }
  // an item that never started (budget exhausted) must look untouched
  for (const r of res) { const x = byId.get(r.item.id)!; if (!r.ok && r.error === 'scan budget exhausted' && x.attempt_count === r.item.attempt_count) { x.processing_status = r.item.processing_status; x.next_attempt = r.item.next_attempt; } }
  out.queue = { ...q, items, updatedAt: o.now.toISOString() };
  out.changed = true;
  return out;
}

// ── zzz857: hand-off to the AI extractor ─────────────────────────────────────────────────────────────────────────────
/**
 * A document the regex engine read but could not take company + metric + period + value from ("DETECTED, NUMBERS NOT FOUND") is handed to
 * the AI extractor (guidance-docs-types.ts). The link is the shared docId: sha1(document url).slice(0, 20), where the url is the document
 * actually read (for SEC: the EX-99.1 exhibit, the same url the GitHub EDGAR backfill stores as GuidanceDoc.url). The extractor finds the
 * text under guidance-docs:v1:doc:<docId> (stored by the backfill / India collectors) and writes guidance-extract:v1:<docId>.
 * Stored on the queue item as extra optional fields (the queue value is plain JSON; GuQueueItem is unchanged).
 */
export interface QueueHandoff { to: 'AI_EXTRACTOR'; docId: string; docUrl: string; reason: 'NUMBERS_NOT_FOUND'; at: string }
export type GuQueueItemX = GuQueueItem & { doc_id?: string | null; doc_url?: string | null; handoff?: QueueHandoff | null };
function markHandoff(x: GuQueueItem, doc: DocFetchResult, complete: boolean): void {
  const xx = x as GuQueueItemX;
  const url = doc.resolvedUrl || x.source_url;
  if (!url) return;
  xx.doc_url = url; xx.doc_id = guidanceDocIdOf(url);
  xx.handoff = complete ? null : { to: 'AI_EXTRACTOR', docId: xx.doc_id, docUrl: url, reason: 'NUMBERS_NOT_FOUND', at: x.result?.readAt || new Date().toISOString() };
}
export interface ExtractorHandoffRow { docId: string; docUrl: string; market: 'IN' | 'US'; ticker: string | null; company: string | null; eventDate: string; subject: string; sourceType: string }
/** Documents read with no usable numbers, for the AI extractor (newest announcement first). */
export function extractorHandoffs(q: QueueState, market?: 'IN' | 'US'): ExtractorHandoffRow[] {
  return (q.items as GuQueueItemX[])
    .filter((x) => x.processing_status === 'DONE' && !x.result?.complete && x.handoff?.to === 'AI_EXTRACTOR' && (!market || x.market === market))
    .sort((a, b) => b.event_date.localeCompare(a.event_date))
    .map((x) => ({ docId: x.handoff!.docId, docUrl: x.handoff!.docUrl, market: x.market, ticker: x.ticker, company: x.company, eventDate: x.event_date, subject: x.subject, sourceType: x.source_type }));
}
export const handedToExtractorCount = (q: QueueState, market: 'IN' | 'US'): number => extractorHandoffs(q, market).length;

/** Candidates produced by documents that were read and showed company + metric + period + value (kept on later runs too). */
export function doneCandidates(q: QueueState): GuCandidate[] {
  return q.items.filter((x) => x.processing_status === 'DONE' && x.result?.complete && x.result.candidate).map((x) => x.result!.candidate!);
}

const waiting = (x: GuQueueItem): boolean => x.processing_status === 'QUEUED' || x.processing_status === 'READING' || x.processing_status === 'FAILED';
export function reportQueue(q: QueueState, run: { processed: number; verified: number; failed: number } = { processed: 0, verified: 0, failed: 0 }): GuQueueReport {
  const by = (s: GuQueueStatus) => q.items.filter((x) => x.processing_status === s).length;
  const open = q.items.filter(waiting);
  const byPriority: Record<GuQueuePriority, number> = { P0: 0, P1: 0, P2: 0 };
  for (const x of open) byPriority[x.priority]++;
  const backlogByMarket = { IN: open.filter((x) => x.market === 'IN').length, US: open.filter((x) => x.market === 'US').length };
  const note = open.length === 0 ? 'No documents are waiting to be read.'
    : `${open.length} document${open.length === 1 ? '' : 's'} waiting to be read (${by('QUEUED')} queued + ${by('FAILED')} retrying after a failed fetch; P0 ${byPriority.P0}, P1 ${byPriority.P1}, P2 ${byPriority.P2}); up to ${MAX_DOCS_PER_RUN} are read per run (${QUEUE_CONCURRENCY} at a time), highest priority and longest-waiting first; ${drainEstimate(open.length).text}.`;
  return { total: q.items.length, queued: by('QUEUED'), reading: by('READING'), done: by('DONE'), failed: by('FAILED'), sourceUnavailable: by('SOURCE_UNAVAILABLE'), byPriority,
    processedThisRun: run.processed, verifiedThisRun: run.verified, failedThisRun: run.failed, backlogByMarket, note };
}
/** documents still to be read in one market: waiting items (a SOURCE_UNAVAILABLE item is counted apart) */
export const awaitingCount = (q: QueueState, market: 'IN' | 'US'): number => q.items.filter((x) => x.market === market && waiting(x)).length;
export const unavailableCount = (q: QueueState, market: 'IN' | 'US'): number => q.items.filter((x) => x.market === market && x.processing_status === 'SOURCE_UNAVAILABLE').length;
export const readNoEventCount = (q: QueueState, market: 'IN' | 'US'): number => q.items.filter((x) => x.market === market && x.processing_status === 'DONE' && !(x.result?.complete)).length;

// ── persistence + the default document fetcher (production only; tests inject their own) ──────────────────────────────────
export async function readQueue(): Promise<QueueState | null> {
  try { const { kvGet } = await import('./kv'); return validQueue(await kvGet<QueueState>(QUEUE_KEY)); } catch { return null; }
}
export async function writeQueue(q: QueueState): Promise<boolean> {
  try { const { kvSet } = await import('./kv'); await kvSet(QUEUE_KEY, q, QUEUE_TTL_S); return true; } catch { return false; }
}

const stripHtml = (h: string): string => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Default fetcher: PDFs go through the repo's own extractor (pdf-parse, KV text cache, exchange proxy); HTML / text pages (SEC filings) are fetched
 * directly and stripped to text. No new dependency. A non-2xx answer, a wrong content type or an unreadable PDF is reported, never guessed.
 */
export function makeDefaultFetchDoc(timeoutMs = 12_000): FetchDoc {
  return async (url) => {
    try {
      // zzz857: an SEC filing INDEX page lists documents; it carries no release text, so reading it always ended "numbers not found".
      // Read the filing's press release (EX-99.1, ranked and verified by lib/us-guidance releaseDocument) instead.
      const sec = parseSecFilingIndexUrl(url);
      if (sec) {
        const { releaseDocument, htmlToText } = await import('./us-guidance');
        const rd = await Promise.race([
          releaseDocument(sec.cikNum, sec.accession, url),
          new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
        ]);
        if (!rd) return { ok: false, text: '', reason: 'timeout' };
        if (!rd.url || !rd.html) return { ok: false, text: '', reason: 'press release exhibit not found in the SEC filing' };
        return { ok: true, status: 200, contentType: 'text/html', text: htmlToText(rd.html), resolvedUrl: rd.url };
      }
      if (/\.pdf(?:$|[?#])/i.test(url) || /nseindia\.com\/.*\.pdf|bseindia\.com\/xml-data\/corpfiling/i.test(url)) {
        const { extractPdfText } = await import('./pdf-text-extractor');
        const r = await extractPdfText(url, { timeoutMs });
        return r.source === 'FAILED' ? { ok: false, text: '', contentType: 'application/pdf', reason: r.failure_reason || 'pdf unreadable', status: /^HTTP (\d{3})/.exec(r.failure_reason || '')?.[1] ? Number(/^HTTP (\d{3})/.exec(r.failure_reason || '')![1]) : undefined }
          : { ok: true, status: 200, contentType: 'application/pdf', text: r.text };
      }
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpitResearch/1.0)', Accept: 'text/html,application/pdf,text/plain,*/*' } });
        const ct = res.headers.get('content-type');
        if (!res.ok) return { ok: false, status: res.status, contentType: ct, text: '', reason: `HTTP ${res.status}` };
        if (ct && /pdf/i.test(ct)) { const { extractPdfText } = await import('./pdf-text-extractor'); const r = await extractPdfText(url, { timeoutMs }); return r.source === 'FAILED' ? { ok: false, text: '', contentType: ct, status: res.status, reason: r.failure_reason || 'pdf unreadable' } : { ok: true, status: res.status, contentType: ct, text: r.text }; }
        const body = await res.text();
        return { ok: true, status: res.status, contentType: ct, text: /html/i.test(ct || '') || /^\s*</.test(body) ? stripHtml(body) : body };
      } finally { clearTimeout(timer); }
    } catch (e: any) { return { ok: false, text: '', reason: e?.name === 'AbortError' ? 'timeout' : String(e?.message || 'fetch failed').slice(0, 120) }; }
  };
}
