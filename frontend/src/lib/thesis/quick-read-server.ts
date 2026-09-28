// ═══════════════════════════════════════════════════════════════════════════
// QUICK READ (NO AI) — THE SERVER HALF.                              (zzz816)
//
// One company: discover its latest concall transcript, investor presentation
// and results filing (the SAME discovery the AI read uses), download each
// (no OCR — OCR is a model call), run the deterministic extractors
// (lib/thesis/quick-read) and persist the facts through the SAME evidence
// store the AI read writes, marked "read without AI (deterministic)" so the
// card says so and a later AI read (on click) supersedes them.
//
// Bounded and polite: at most 3 documents (+2 same-period replacements),
// 20 s per download, 45 s per company. Each document's extraction is cached
// per URL (KV, 30 days, versioned); a failed download is never cached in KV
// and is remembered in memory for 30 minutes. A failure is recorded on the
// ledger as what it is — source unreachable, document unreadable, or no
// readable document at any source — never as "not disclosed".
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet as realKvGet, kvSet as realKvSet } from '@/lib/kv';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { loadLedger, persistEvidenceRun, persistAttempt, docsFromRoute } from './evidence-store';
import { discoverEvidence, nextBestCandidate, type Discovery, type DocCandidate } from './evidence-discovery';
import { readOneDocument, type DocumentRead } from './pdf-ocr';
import { documentId, contentHash, reportingPeriodFromDate, periodOrdinal, latestExpectedPeriod, type CompanyLedger } from './evidence-ledger';
import { loadFilingsCached } from './india-filings-feed';
import {
  quickExtract, quickSummary, isQuickReadPeriod, lastQuickRun,
  QUICK_READ_VERSION, QUICK_READ_MODEL, QUICK_READ_MODE, QUICK_READ_LABEL, QUICK_RETRY_AFTER_MS,
} from './quick-read';
import type { StructuralEvent } from './evidence-extract';

export const QUICK_MAX_DOCS = 3;
export const QUICK_DOC_TIMEOUT_MS = 20_000;
export const QUICK_CALL_BUDGET_MS = 45_000;
const DOC_CACHE_TTL_S = 30 * 24 * 3600;
const FAIL_MEMO_MS = 30 * 60_000;
/** The kinds a quick read takes, in order: the concall (cause, guidance,
 *  utilisation), the presentation (capacity, order book), the results. */
const QUICK_KINDS = ['transcript', 'investor_presentation', 'results'] as const;

export type QuickOutcome = 'READ' | 'SKIPPED' | 'NO_DOCUMENTS' | 'FAILED';

export interface QuickDocOutcome { label: string; kind: string; url: string; outcome: string; detail?: string; cached?: boolean; events?: number }

export interface QuickReadResult {
  ok: boolean;
  outcome: QuickOutcome;
  ticker: string;
  period: string | null;
  /** Plain words for the card. */
  note: string;
  ledger: CompanyLedger | null;
  persisted: boolean;
  documents: QuickDocOutcome[];
  facts: number;
  events: number;
  label: string;
}

interface DocCacheEntry { v: string; outcome: 'read'; chars: number; pages: number; hash: string | null; events: StructuralEvent[]; financialLines: string[]; vocabulary: { lender: string[]; market: string[] } }

export interface QuickDeps {
  discover: (ticker: string, filingDate: string | null) => Promise<Discovery>;
  extract: (url: string) => Promise<{ text?: string | null; pages?: number | null; source?: string; failure_reason?: string } | null>;
  kv: { get: <T = any>(k: string) => Promise<T | null>; set: (k: string, v: any, ttl?: number) => Promise<void> };
  now: () => number;
}

const realDeps: QuickDeps = {
  discover: async (ticker, filingDate) => discoverEvidence(ticker, { filings: await loadFilingsCached(filingDate), filingDate }),
  extract: (url) => extractPdfText(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: QUICK_DOC_TIMEOUT_MS }) as any,
  kv: { get: realKvGet, set: (k, v, ttl) => realKvSet(k, v, ttl) as any },
  now: () => Date.now(),
};

const docKey = (url: string) => `quick-read:doc:${QUICK_READ_VERSION}:${documentId(url)}`;
const failMemo = new Map<string, { at: number; detail: string; outcome: string }>();
/** Test-only: forget remembered download failures. */
export function resetQuickMemoForTests(): void { failMemo.clear(); }

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); });
  try { return await Promise.race([p, timer]); } finally { if (t) clearTimeout(t); }
}

/** Pure: the documents a quick read takes — one transcript, one presentation,
 *  one results filing, newest-period first (the discovery's own ranking). */
export function quickSelection(candidates: DocCandidate[], max = QUICK_MAX_DOCS): DocCandidate[] {
  const out: DocCandidate[] = [];
  for (const k of QUICK_KINDS) {
    const c = candidates.find((x) => x.kind === k);
    if (c && out.length < max) out.push(c);
  }
  return out;
}

const docWords = (d: { outcome: string; detail?: string }) =>
  d.outcome === 'download_failed' ? `download failed${d.detail ? ` (${String(d.detail).slice(0, 120)})` : ''}`
    : d.outcome === 'scanned' ? 'scanned image — needs OCR, which is an AI read (on click)'
      : d.outcome === 'too_short' ? 'too short to be a filing (a notice or cover letter)'
        : d.outcome === 'timed_out' ? 'timed out' : d.outcome;

/**
 * Quick-read one company. `force` ignores the recent-attempt guard (a click).
 */
export async function runQuickRead(ticker0: string, opts: { filingDate?: string | null; force?: boolean; deps?: Partial<QuickDeps> } = {}): Promise<QuickReadResult> {
  const deps: QuickDeps = { ...realDeps, ...(opts.deps || {}) } as QuickDeps;
  const ticker = String(ticker0 || '').toUpperCase().trim();
  const start = deps.now();
  const startedAt = new Date(start).toISOString();
  const runId = `quick_${start.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const filingDate = opts.filingDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.filingDate) ? opts.filingDate : null;
  const base = { ticker, label: QUICK_READ_LABEL, documents: [] as QuickDocOutcome[], facts: 0, events: 0 };
  const before = await loadLedger(ticker);
  const expected = latestExpectedPeriod(new Date(start)).period;

  // ── Nothing to do: evidence for the expected quarter is on file, or a
  // quick read ran recently (a failure is retried later, not every load).
  if (!opts.force) {
    if (before?.latest_period && periodOrdinal(before.latest_period) >= periodOrdinal(expected)) {
      return { ...base, ok: true, outcome: 'SKIPPED', period: before.latest_period, ledger: before, persisted: true,
        note: `${before.latest_period} evidence is already on file — nothing to quick-read.` };
    }
    const q = lastQuickRun(before);
    if (q && start - Date.parse(q.at) < QUICK_RETRY_AFTER_MS) {
      return { ...base, ok: q.outcome === 'COMPLETED', outcome: 'SKIPPED', period: before?.latest_period || null, ledger: before, persisted: true,
        note: `Quick read already ran at ${q.at.slice(0, 16).replace('T', ' ')} UTC (${q.outcome.toLowerCase().replace(/_/g, ' ')}${before?.last_attempt?.error ? `: ${before.last_attempt.error}` : ''}) — tried again after ${Math.round(QUICK_RETRY_AFTER_MS / 3600_000)} hours.` };
    }
  }

  // ── DISCOVERY — the same sources, the same ranking as the AI read.
  let discovery: Discovery;
  try { discovery = await deps.discover(ticker, filingDate); }
  catch (e: any) {
    const why = `discovery failed: ${String(e?.message || e).slice(0, 200)}`;
    const a = await persistAttempt(ticker, 'IN', runId, startedAt, 'SOURCE_UNAVAILABLE', why, { failureKind: 'source_unreachable', mode: QUICK_READ_MODE });
    return { ...base, ok: false, outcome: 'FAILED', period: null, ledger: a.ledger, persisted: a.persisted, note: `Couldn't search the sources (${why}). Nothing is inferred from this.` };
  }
  // discovery.candidates arrive ranked (resolveDiscovery): newest period
  // first, then transcript → presentation → results.
  const toRead = quickSelection(discovery.candidates);
  if (!toRead.length) {
    const unreachable = discovery.attempts.some((a) => a.outcome === 'error');
    const errs = discovery.attempts.filter((a) => a.outcome === 'error').map((a) => `${a.source}: ${a.detail}`).join('; ');
    const why = unreachable
      ? `no transcript, presentation or results filing found, and ${errs}`
      : 'no concall transcript, investor presentation or results filing is listed at any source';
    const a = await persistAttempt(ticker, 'IN', runId, startedAt, unreachable ? 'SOURCE_UNAVAILABLE' : 'NO_DISCLOSURE', why.slice(0, 400),
      { documents_found: discovery.candidates.length, failureKind: 'source_unreachable', mode: QUICK_READ_MODE, attempts: discovery.attempts });
    return { ...base, ok: false, outcome: unreachable ? 'FAILED' : 'NO_DOCUMENTS', period: null, ledger: a.ledger, persisted: a.persisted,
      note: unreachable ? `Couldn't search every source — ${why}. Not a disclosure gap.` : `Searched: ${why}.` };
  }

  // A period already read WITH AI is never re-read without it.
  const newest = toRead.map((c) => c.dateIso).filter((d): d is string => !!d).sort().pop() || null;
  const newestPeriod = reportingPeriodFromDate(newest)?.period || null;
  const onFile = newestPeriod && before?.periods?.[newestPeriod];
  if (onFile && !isQuickReadPeriod(onFile) && (onFile.documents_read || 0) > 0 && !opts.force) {
    return { ...base, ok: true, outcome: 'SKIPPED', period: newestPeriod, ledger: before, persisted: true,
      note: `The newest documents found are ${newestPeriod}'s, which was already read with AI — no newer filing to quick-read.` };
  }

  // ── READ. One document at a time (the company's own budget); a failure
  // pulls the next-best document of the same period.
  const queue: DocCandidate[] = [...toRead];
  const tried = new Set(queue.map((c) => c.url));
  const outcomes: Array<{ url: string; label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string; hash?: string | null }> = [];
  const docOut: QuickDocOutcome[] = [];
  const events: StructuralEvent[] = [];
  const financialLines: string[] = [];
  const vocab = { lender: new Set<string>(), market: new Set<string>() };
  const readDocs: DocCandidate[] = [];
  let downloads = 0;
  while (queue.length) {
    const cand = queue.shift()!;
    if (deps.now() - start > QUICK_CALL_BUDGET_MS) {
      outcomes.push({ url: cand.url, label: cand.label, kind: cand.kind, outcome: 'budget_exhausted', chars: 0, pages: 0, detail: 'not reached in this pass' });
      docOut.push({ label: cand.label, kind: cand.kind, url: cand.url, outcome: 'not reached', detail: 'time budget used up — read on the next pass' });
      continue;
    }
    // Per-document cache: the extraction, versioned.
    let hit: DocCacheEntry | null = null;
    try { hit = await deps.kv.get<DocCacheEntry>(docKey(cand.url)); } catch { hit = null; }
    if (hit && hit.v === QUICK_READ_VERSION && hit.outcome === 'read') {
      outcomes.push({ url: cand.url, label: cand.label, kind: cand.kind, outcome: 'read', chars: hit.chars, pages: hit.pages, hash: hit.hash });
      docOut.push({ label: cand.label, kind: cand.kind, url: cand.url, outcome: 'read', cached: true, events: hit.events.length });
      events.push(...hit.events.map((e) => ({ ...e, source: cand.label })));
      financialLines.push(...hit.financialLines);
      hit.vocabulary.lender.forEach((w) => vocab.lender.add(w)); hit.vocabulary.market.forEach((w) => vocab.market.add(w));
      readDocs.push(cand);
      continue;
    }
    const memo = failMemo.get(cand.url);
    let r: DocumentRead;
    if (memo && deps.now() - memo.at < FAIL_MEMO_MS) {
      r = { outcome: memo.outcome as any, chars: 0, pages: 0, detail: `${memo.detail} (tried in the last 30 minutes)` };
    } else {
      downloads++;
      r = await withTimeout(readOneDocument(cand, {
        extract: deps.extract,
        ocr: async () => ({ ok: false, detail: 'no OCR in a read without AI' }),
        ocrGate: () => 'OCR is an AI read — only on click',
      }), QUICK_DOC_TIMEOUT_MS + 5_000, { outcome: 'download_failed', chars: 0, pages: 0, detail: `timed out after ${Math.round((QUICK_DOC_TIMEOUT_MS + 5_000) / 1000)} s` } as DocumentRead);
    }
    if (r.outcome !== 'read') {
      if (!memo && (r.outcome === 'download_failed' || r.outcome === 'scanned')) failMemo.set(cand.url, { at: deps.now(), detail: r.detail || r.outcome, outcome: r.outcome });
      outcomes.push({ url: cand.url, label: cand.label, kind: cand.kind, outcome: r.outcome, chars: r.chars, pages: r.pages, ...(r.detail ? { detail: r.detail } : {}) });
      docOut.push({ label: cand.label, kind: cand.kind, url: cand.url, outcome: r.outcome, detail: docWords({ outcome: r.outcome, detail: r.detail }) });
      if (downloads < QUICK_MAX_DOCS + 2) {
        const next = nextBestCandidate(discovery.candidates, cand, tried);
        if (next && (QUICK_KINDS as readonly string[]).includes(next.kind)) { tried.add(next.url); queue.push(next); }
      }
      continue;
    }
    const x = quickExtract([{ label: cand.label, kind: cand.kind, text: r.text }]);
    const hash = contentHash(r.text);
    const entry: DocCacheEntry = { v: QUICK_READ_VERSION, outcome: 'read', chars: r.text.length, pages: r.pages, hash, events: x.events, financialLines: x.financialLines, vocabulary: x.vocabulary };
    try { await deps.kv.set(docKey(cand.url), entry, DOC_CACHE_TTL_S); } catch { /* uncached is still a read */ }
    outcomes.push({ url: cand.url, label: cand.label, kind: cand.kind, outcome: 'read', chars: r.text.length, pages: r.pages, hash });
    docOut.push({ label: cand.label, kind: cand.kind, url: cand.url, outcome: 'read', events: x.events.length });
    events.push(...x.events);
    financialLines.push(...x.financialLines);
    x.vocabulary.lender.forEach((w) => vocab.lender.add(w)); x.vocabulary.market.forEach((w) => vocab.market.add(w));
    readDocs.push(cand);
  }

  if (!readDocs.length) {
    // Documents exist and none could be read: OUR failure (download, scan),
    // never an absence of disclosure. Only "too short" everywhere is the
    // company's own filing being a notice.
    const onlyShort = outcomes.every((o) => o.outcome === 'too_short');
    const reasons = docOut.map((d) => `${d.label}: ${d.detail || d.outcome}`).join('; ');
    const a = await persistAttempt(ticker, 'IN', runId, startedAt, onlyShort ? 'NO_DISCLOSURE' : 'SOURCE_UNAVAILABLE',
      `couldn't read — ${reasons}`.slice(0, 500),
      { documents_found: discovery.candidates.length, newestSeenDate: newest, failureKind: onlyShort ? null : 'document_unreadable', mode: QUICK_READ_MODE, attempts: discovery.attempts });
    return { ...base, documents: docOut, ok: false, outcome: onlyShort ? 'NO_DOCUMENTS' : 'FAILED', period: null, ledger: a.ledger, persisted: a.persisted,
      note: onlyShort ? `Only notices / cover letters found (${reasons}).` : `Couldn't read the documents found — ${reasons}. Not a disclosure gap.` };
  }

  // Across documents, one reading per variable / type / value.
  const seen = new Set<string>();
  const merged = events.filter((e) => {
    const k = `${e.variable}|${e.value_type}|${String(e.after ?? '').toLowerCase()}|${(e as any).product || ''}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const extraction = { events: merged, financialLines: Array.from(new Set(financialLines)).slice(0, 8), vocabulary: { lender: Array.from(vocab.lender).sort(), market: Array.from(vocab.market).sort() }, pipeline: null as any };
  const summary = quickSummary(extraction as any, readDocs.map((d) => ({ label: d.label, kind: d.kind })));
  const persisted = await persistEvidenceRun({
    ticker, market: 'IN', runId, startedAt,
    documents: docsFromRoute([], outcomes, discovery.candidates),
    filingDate, events: merged, summary,
    discoveryState: discovery.state, discoveryAttempts: discovery.attempts,
    promptVersion: QUICK_READ_VERSION, model: QUICK_READ_MODEL,
    rawExtraction: { quick_read: { documents: docOut } }, pipeline: null,
    mode: QUICK_READ_MODE,
  });
  if (!persisted.persisted) {
    const aiOnFile = /already read with AI/.test(String(persisted.error || ''));
    return { ...base, documents: docOut, ok: aiOnFile, outcome: aiOnFile ? 'SKIPPED' : 'FAILED', period: persisted.period, ledger: persisted.ledger, persisted: false,
      note: aiOnFile ? String(persisted.error) : `Read ${readDocs.length} document(s) without AI but the save failed: ${persisted.error}` };
  }
  const p = persisted.ledger.periods[persisted.period];
  const facts = p?.facts?.length || 0;
  const skippedDocs = docOut.filter((d) => d.outcome !== 'read');
  return {
    ...base, documents: docOut, ok: true, outcome: 'READ', period: persisted.period, ledger: persisted.ledger, persisted: true,
    facts, events: p?.events?.length || 0,
    note: `${persisted.period} · read ${readDocs.length} document${readDocs.length === 1 ? '' : 's'} without AI (${readDocs.map((d) => d.kind === 'transcript' ? 'transcript' : d.kind === 'investor_presentation' ? 'presentation' : 'results').join(' + ')}) · ${facts} fact${facts === 1 ? '' : 's'}`
      + (skippedDocs.length ? ` · couldn't read ${skippedDocs.map((d) => `${d.label} (${d.detail || d.outcome})`).join('; ')}` : ''),
  };
}
