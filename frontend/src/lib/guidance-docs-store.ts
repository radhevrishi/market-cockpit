// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE DOC STORE — the companies' own guidance-bearing documents.  (zzz857)
//
// Collectors (GitHub Actions for India BSE/NSE, the EDGAR backfill for US)
// POST documents to /api/v1/guidance-docs/ingest, which validates them here
// and writes them to KV per the contract in guidance-docs-types.ts:
//
//   guidance-docs:v1:index            GuidanceDocIndex, newest first, ≤ 5000 rows
//   guidance-docs:v1:doc:<docId>      GuidanceDoc, text ≤ 120k chars, TTL 120 days
//   guidance-docs:v1:seen             docIds a collector looked at and did NOT
//                                     store (image-only PDF, no guidance cue,
//                                     too big; or an exchange cover letter whose
//                                     linked company PDF was stored) so the next
//                                     run skips the download
//   guidance-docs:v1:status:<name>    per-day source status of a collector
//                                     ('failed' is never reported as 0 filings)
//
// Readers (AI extractor, universe, events): listDocs, getDoc, markExtracted.
// Dedupe is by docId (sha1(url) first 20 hex). A re-ingested docId replaces
// the stored doc but keeps its `extracted` flag.
//
// Storage discipline (wave 2 — Upstash size): a stored doc keeps only the
// guidance-relevant passages (selectGuidancePassages: the first 2k chars plus
// verbatim windows around guidance cues, ≤ 30k chars), gzip-compressed and
// base64-encoded (textEnc 'gz64'); getDoc decompresses. Once the extractor has
// a final result ('ok' / 'no_guidance') markExtracted drops the text and keeps
// the metadata + url. storageStats() sums what is held.
//
//   guidance-docs:v1:coverage:<IN|US>  {v:1, market, updatedAt, days:{date:{status,
//                                     filings, docs, at}}} — days read per market;
//                                     'failed' never overwrites 'ok'; 140 days kept
//
// Pure helpers first (tested with a fake KV); the KV adapter is lazy-imported
// so tests never load the network client.
// ═══════════════════════════════════════════════════════════════════════════

import { gzipSync, gunzipSync } from 'node:zlib';
import type { GuidanceDoc, GuidanceDocIndex, GuidanceDocIndexRow, GuidanceDocKind } from './guidance-docs-types';

export const DOCS_INDEX_KEY = 'guidance-docs:v1:index';
export const DOCS_SEEN_KEY = 'guidance-docs:v1:seen';
export const EXTRACT_INDEX_KEY = 'guidance-extract:v1:index';
export const docKey = (docId: string) => `guidance-docs:v1:doc:${docId}`;
export const statusKey = (collector: string) => `guidance-docs:v1:status:${collector.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown'}`;

export const INDEX_CAP = 9000;   // zzz874: ~2.6 MB of JSON; a 210-day India backfill holds ~7,000 documents (two earnings seasons)
export const TEXT_CAP = 120_000;          // collector-side cap on raw text (contract)
export const PASSAGE_CAP = 30_000;         // what is actually stored per doc
export const HEAD_CHARS = 2_000;
export const COVERAGE_KEEP_DAYS = 220;   // zzz874: keep the 210-day collector record
export const COVERAGE_TTL_S = 230 * 86_400;
export const coverageKey = (market: 'IN' | 'US') => `guidance-docs:v1:coverage:${market}`;
const EXTRACT_RESULT_KEY = (docId: string) => `guidance-extract:v1:${docId}`;
/** zzz921: the extractor's other per-document state (same keys as ai-guidance-extract.ts OK_INDEX_KEY / failKey; kept here so the store never imports the extractor) */
export const EXTRACT_OK_INDEX_KEY = 'guidance-extract:v1:index:ok';
const EXTRACT_FAIL_KEY = (docId: string) => `guidance-extract:v1:fail:${docId}`;
export const DOC_TTL_S = 210 * 86_400;   // zzz874: a document stays as long as the collector window reaches
export const SEEN_CAP = 20_000;
export const MAX_DOCS_PER_REQUEST = 25;
export const MAX_SEEN_PER_REQUEST = 2_000;
// zzz916 — index integrity + intimations
/** {rows, seen, updatedAt} written with every index / seen write: a read that comes back empty while this says rows exist is a failed read, never "no index". */
export const DOCS_INDEX_META_KEY = 'guidance-docs:v1:index-meta';
/** short lock around every read-modify-write of the index (collector ingest vs the extractor's markExtracted) */
export const DOCS_INDEX_LOCK_KEY = 'guidance-docs:v1:index-lock';
/** exchange intimations ("transcript available at <link>") whose real document has not been found yet */
export const INTIMATIONS_KEY = 'guidance-docs:v1:intimations';
export const MAX_INTIMATIONS_PER_REQUEST = 500;
export const INTIMATIONS_CAP = 3_000;
export const INTIMATION_RETRY_DAYS = 60;
/** a stored "transcript" / "presentation" this short is an intimation letter, not the document */
export const SHORT_DOC_CHARS = 2_500;
export class DocsIndexUnreadableError extends Error {
  constructor(what: string) { super(`${what} could not be read; refusing to overwrite it (retry later)`); this.name = 'DocsIndexUnreadableError'; }
}

const KINDS: readonly GuidanceDocKind[] = ['TRANSCRIPT', 'PRESENTATION', 'RESULTS_RELEASE', 'AGM_SPEECH', 'OTHER_COMPANY_DOC'];

export interface DocsKv {
  get<T = any>(k: string): Promise<T | null>;
  set(k: string, v: any, ttlS?: number): Promise<void>;
  /** zzz916 (optional): SET NX EX — the index lock. Absent (tests) → no locking. */
  setNX?(k: string, v: any, ttlS: number): Promise<boolean>;
  del?(k: string): Promise<void>;
  sleep?(ms: number): Promise<void>;
  /** zzz916 (optional): null ONLY when the key does not exist; throws when the read fails (timeout, HTTP error). */
  getStrict?<T = any>(k: string): Promise<T | null>;
}

// ── passage selection + compression ─────────────────────────────────────────

const STRONG_CUE = /\b(guidance|guiding|guided|outlook|expects?|expecting|expected to|sees|target(?:s|ing|ed)?|raise[sd]?|raising|reaffirm(?:s|ed|ing)?|full[- ]year)\b/gi;
const WEAK_CUE = /(\bFY\s*'?2\d\b|\bFY\s*20\d\d|\bfiscal\s+(?:year\s+)?20\d\d|\bcrores?\b|\bmillion\b|\bbillion\b|\d\s?%|\bmargins?\b|\bgrowth\b)/gi;
export const PASSAGE_SEP = '\n[…]\n';

/**
 * The guidance-relevant part of a document, as VERBATIM excerpts (so a quote
 * the extractor finds in it is also in the original): the first 2k chars, then
 * windows around strong cues (guidance / outlook / expect / sees / target /
 * raise / reaffirm / full-year), then windows around weak cues (FY2x, fiscal
 * 20xx, crore, million, billion, %, margin, growth) while room remains. Windows
 * snap to line breaks, overlapping windows merge, output is in document order,
 * joined by "\n[…]\n", capped at `cap` chars. Short texts are returned as-is.
 */
export function selectGuidancePassages(text: string, cap = PASSAGE_CAP): string {
  const t = String(text || '');
  if (t.length <= cap) return t;
  const head = Math.min(HEAD_CHARS, t.length);
  const spans: Array<[number, number]> = [[0, snapEnd(t, head)]];
  const before = 700, after = 900;
  const windowsFor = (re: RegExp) => {
    const out: Array<[number, number]> = [];
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const s = snapStart(t, Math.max(0, m.index - before));
      const e = snapEnd(t, Math.min(t.length, m.index + m[0].length + after));
      const last = out[out.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
    }
    return out;
  };
  const sizeOf = (sp: Array<[number, number]>) => merged(sp).reduce((n, [a, b]) => n + (b - a) + PASSAGE_SEP.length, 0);
  for (const group of [windowsFor(STRONG_CUE), windowsFor(WEAK_CUE)]) {
    for (const w of group) {
      const trial = spans.concat([w]);
      if (sizeOf(trial) <= cap) { spans.push(w); continue; }
      // partial fit: take the start of the window up to the room left
      const room = cap - sizeOf(spans) - PASSAGE_SEP.length;
      if (room > 400) spans.push([w[0], snapEnd(t, w[0] + room, w[0] + 200)]);
      break;
    }
    if (sizeOf(spans) >= cap - 400) break;
  }
  const out = merged(spans).map(([a, b]) => t.slice(a, b)).join(PASSAGE_SEP);
  return out.length > cap ? out.slice(0, cap) : out;
}
function merged(sp: Array<[number, number]>): Array<[number, number]> {
  const s = sp.slice().sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const l = out[out.length - 1];
    if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]);
  }
  return out;
}
/** Move a start back to the previous line break (≤ 200 chars away). */
function snapStart(t: string, i: number): number {
  const nl = t.lastIndexOf('\n', i);
  return nl >= 0 && i - nl <= 200 ? nl + 1 : i;
}
/** Move an end back to the last line break / sentence end before it (not below `min`). */
function snapEnd(t: string, i: number, min = 0): number {
  if (i >= t.length) return t.length;
  const nl = t.lastIndexOf('\n', i);
  if (nl > min && i - nl <= 300) return nl;
  const sp = t.lastIndexOf(' ', i);
  return sp > min ? sp : i;
}

export function encodeText(text: string): string {
  return gzipSync(Buffer.from(text, 'utf8')).toString('base64');
}
export function decodeText(b64: string): string {
  return gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

/** What KV holds for a doc: metadata + compressed text (or none once dropped). */
export type StoredDoc = Omit<GuidanceDoc, 'text'> & { textEnc?: 'gz64'; textGz?: string; text?: string; textDropped?: boolean };

// ── host policy ─────────────────────────────────────────────────────────────

/** Exchange / regulator hosts whose attachments are the company's own filings. */
const EXCHANGE_HOSTS = ['bseindia.com', 'nseindia.com', 'sec.gov'];

function hostOf(u: string): string | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
    return x.hostname.toLowerCase();
  } catch { return null; }
}
function onHost(h: string, base: string): boolean { return h === base || h.endsWith(`.${base}`); }
export function isExchangeHost(h: string | null): boolean { return !!h && EXCHANGE_HOSTS.some((b) => onHost(h, b)); }

/** A plausible public company domain: a name, not an IP, not localhost/internal. */
function isPublicDomain(h: string): boolean {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return false;
  if (/^\d+(\.\d+)+$/.test(h)) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|svc|cluster)$/.test(h)) return false;
  return /\.[a-z]{2,}$/.test(h);
}

/** The document URL may be an exchange / SEC attachment, or the company's
 *  own domain when an exchange / SEC filing (`exchangeUrl`) pointed there. */
export function isAllowedDocUrl(url: string, exchangeUrl?: string | null): boolean {
  const h = hostOf(url);
  if (!h) return false;
  if (isExchangeHost(h)) return true;
  if (!exchangeUrl) return false;
  if (!isExchangeHost(hostOf(exchangeUrl))) return false;
  return url.startsWith('https://') && isPublicDomain(h);
}

// ── validation (hand-rolled: no zod in this repo) ───────────────────────────

export interface SeenEntry { docId: string; outcome: 'unreadable' | 'no_cue' | 'too_big' | 'error' | 'linked' | 'intimation' }
/** zzz916: an exchange intimation whose real document (transcript / deck) has not been found yet. */
export interface IntimationEntry { docId: string; url: string; ticker: string | null; bseCode: string | null; company: string; kind: GuidanceDocKind; filedAt: string; firstSeen?: string }
export interface DayStatus {
  date: string;                       // YYYY-MM-DD
  source: string;                     // 'BSE' | 'BSE_PROXY' | 'NSE' | 'NSE_PROXY' | 'NONE'
  status: 'ok' | 'empty' | 'failed';  // failed ≠ zero filings
  filings: number | null;             // null when the source failed
  matched: number | null;
  note?: string | null;
}
export interface CollectorStatus {
  collector: string;
  updatedAt: string;
  lastRun: { at: string; days: number; stored: number; skipped: number; failedDays: number } | null;
  days: DayStatus[];                  // newest first, ≤ 140
}
export interface CoverageDay { status: 'ok' | 'partial' | 'failed'; filings: number; docs: number; at: string }
export interface Coverage { v: 1; market: 'IN' | 'US'; updatedAt: string; days: Record<string, CoverageDay> }
export interface IngestBody {
  collector: string;
  market: 'IN' | 'US' | null;
  docs: GuidanceDoc[];
  seen: SeenEntry[];
  status: { days: DayStatus[]; run?: CollectorStatus['lastRun'] } | null;
  coverage: { market: 'IN' | 'US'; days: Record<string, Partial<CoverageDay> & { status: CoverageDay['status'] }> } | null;
  /** zzz916 */ intimations?: IntimationEntry[];
  /** zzz921: true = these documents are re-collected: each is stored again as UNEXTRACTED (the extractor's old result for it is cleared). Needs market 'IN'. */
  reextract?: boolean;
}

const isStr = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max;
const isDocId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{20}$/.test(v);
const isIsoish = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Validate one document; returns the cleaned doc or a reason. Text is capped. */
export function validateDoc(raw: any, collector: string): { ok: true; doc: GuidanceDoc } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not an object' };
  if (!isDocId(raw.docId)) return { ok: false, reason: 'docId must be 20 lowercase hex chars' };
  if (raw.market !== 'IN' && raw.market !== 'US') return { ok: false, reason: 'market must be IN or US' };
  if (!(raw.ticker === null || (isStr(raw.ticker, 24) && /^[A-Z0-9&.\-_]{1,24}$/.test(raw.ticker)))) return { ok: false, reason: 'ticker invalid' };
  if (raw.bseCode != null && !(isStr(raw.bseCode, 6) && /^\d{6}$/.test(raw.bseCode))) return { ok: false, reason: 'bseCode invalid' };
  if (raw.cik != null && !(isStr(raw.cik, 10) && /^\d{1,10}$/.test(raw.cik))) return { ok: false, reason: 'cik invalid' };
  if (!isStr(raw.company, 200) || !raw.company.trim()) return { ok: false, reason: 'company required' };
  if (!KINDS.includes(raw.kind)) return { ok: false, reason: 'kind invalid' };
  if (!isStr(raw.title, 500) || !raw.title.trim()) return { ok: false, reason: 'title required' };
  if (!isStr(raw.url, 1000)) return { ok: false, reason: 'url required' };
  if (raw.exchangeUrl != null && !isStr(raw.exchangeUrl, 1000)) return { ok: false, reason: 'exchangeUrl invalid' };
  if (!isAllowedDocUrl(raw.url, raw.exchangeUrl)) return { ok: false, reason: 'url host not allowed' };
  if (!isStr(raw.sourceHost, 200)) return { ok: false, reason: 'sourceHost required' };
  if (!isIsoish(raw.filedAt)) return { ok: false, reason: 'filedAt invalid' };
  if (raw.periodHint != null && !isStr(raw.periodHint, 40)) return { ok: false, reason: 'periodHint invalid' };
  if (!isStr(raw.text, 5_000_000) || raw.text.trim().length < 50) return { ok: false, reason: 'text required' };
  if (raw.collectedAt != null && !isIsoish(raw.collectedAt)) return { ok: false, reason: 'collectedAt invalid' };
  const text = selectGuidancePassages(raw.text);
  const urlHost = hostOf(raw.url)!;
  const doc: GuidanceDoc = {
    docId: raw.docId,
    market: raw.market,
    ticker: raw.ticker,
    ...(raw.bseCode != null ? { bseCode: raw.bseCode } : {}),
    ...(raw.cik != null ? { cik: raw.cik } : {}),
    company: raw.company.trim(),
    kind: raw.kind,
    title: raw.title.trim(),
    url: raw.url,
    sourceHost: urlHost.replace(/^www\./, ''),  // derived, never trusted from the caller
    filedAt: new Date(raw.filedAt).toISOString(),
    periodHint: raw.periodHint ?? null,
    textChars: text.length,
    originalChars: raw.text.length,
    text,
    collectedAt: raw.collectedAt ? new Date(raw.collectedAt).toISOString() : new Date().toISOString(),
    collector: isStr(raw.collector, 60) && raw.collector ? raw.collector : collector,
    ...(raw.exchangeUrl ? { exchangeUrl: raw.exchangeUrl } : {}),
  };
  return { ok: true, doc };
}

/** Validate an ingest request body. Bad docs are rejected individually
 *  (reported by index); a malformed envelope rejects the whole request. */
export function validateIngestBody(raw: any):
  | { ok: true; body: IngestBody; rejected: Array<{ i: number; reason: string }> }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object' };
  if (!isStr(raw.collector, 60) || !/^[a-z0-9_:.-]{2,60}$/i.test(raw.collector)) return { ok: false, error: 'collector must be a short slug' };
  if (raw.market != null && raw.market !== 'IN' && raw.market !== 'US') return { ok: false, error: 'market must be IN or US' };
  // zzz921: the re-extract flag is a strict boolean, India only, and means nothing without documents
  if (raw.reextract != null && typeof raw.reextract !== 'boolean') return { ok: false, error: 'reextract must be a boolean' };
  const reextract = raw.reextract === true;
  const docsRaw = raw.docs ?? [];
  if (!Array.isArray(docsRaw)) return { ok: false, error: 'docs must be an array' };
  if (reextract && raw.market !== 'IN') return { ok: false, error: 'reextract needs market IN' };
  if (reextract && !docsRaw.length) return { ok: false, error: 'reextract needs at least one document' };
  if (docsRaw.length > MAX_DOCS_PER_REQUEST) return { ok: false, error: `at most ${MAX_DOCS_PER_REQUEST} docs per request` };
  const seenRaw = raw.seen ?? [];
  if (!Array.isArray(seenRaw) || seenRaw.length > MAX_SEEN_PER_REQUEST) return { ok: false, error: `seen must be an array of at most ${MAX_SEEN_PER_REQUEST}` };
  const docs: GuidanceDoc[] = [];
  const rejected: Array<{ i: number; reason: string }> = [];
  docsRaw.forEach((d: any, i: number) => {
    const v = validateDoc(d, raw.collector);
    if (!v.ok) rejected.push({ i, reason: v.reason });
    else if (raw.market != null && v.doc.market !== raw.market) rejected.push({ i, reason: 'market differs from the request' });
    else docs.push(v.doc);
  });
  const seen: SeenEntry[] = [];
  for (const s of seenRaw) {
    if (s && isDocId(s.docId) && ['unreadable', 'no_cue', 'too_big', 'error', 'linked', 'intimation'].includes(s.outcome)) seen.push({ docId: s.docId, outcome: s.outcome });
  }
  // zzz916: intimations (validated one by one; a bad entry is dropped, never the request)
  const intRaw = raw.intimations ?? [];
  if (!Array.isArray(intRaw) || intRaw.length > MAX_INTIMATIONS_PER_REQUEST) return { ok: false, error: `intimations must be an array of at most ${MAX_INTIMATIONS_PER_REQUEST}` };
  const intimations: IntimationEntry[] = [];
  for (const x of intRaw) { const v = validIntimation(x); if (v) intimations.push(v); }
  let status: IngestBody['status'] = null;
  if (raw.status != null) {
    if (typeof raw.status !== 'object' || !Array.isArray(raw.status.days) || raw.status.days.length > 200) return { ok: false, error: 'status.days must be an array (≤200)' };
    const days: DayStatus[] = [];
    for (const d of raw.status.days) {
      if (!d || !isDay(d.date) || !isStr(d.source, 20) || !['ok', 'empty', 'failed'].includes(d.status)) continue;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
      const failed = d.status === 'failed';
      days.push({ date: d.date, source: d.source, status: d.status, filings: failed ? null : num(d.filings), matched: failed ? null : num(d.matched), note: isStr(d.note, 200) ? d.note : null });
    }
    const r = raw.status.run;
    const run = r && typeof r === 'object' && isIsoish(r.at)
      ? { at: new Date(r.at).toISOString(), days: Number(r.days) || 0, stored: Number(r.stored) || 0, skipped: Number(r.skipped) || 0, failedDays: Number(r.failedDays) || 0 }
      : undefined;
    status = { days, ...(run ? { run } : {}) };
  }
  let coverage: IngestBody['coverage'] = null;
  if (raw.coverage != null) {
    const c = raw.coverage;
    const cm = c?.market ?? raw.market;
    if (typeof c !== 'object' || (cm !== 'IN' && cm !== 'US') || !c.days || typeof c.days !== 'object' || Array.isArray(c.days)) return { ok: false, error: 'coverage must be {market, days:{YYYY-MM-DD:{status,...}}}' };
    if (Object.keys(c.days).length > 200) return { ok: false, error: 'coverage.days: at most 200 days per request' };
    const days: NonNullable<IngestBody['coverage']>['days'] = {};
    for (const [d, r] of Object.entries<any>(c.days)) {
      const row = typeof r === 'string' ? { status: r } : r;
      if (!isDay(d) || !row || !['ok', 'partial', 'failed'].includes(row.status)) continue;
      days[d] = { status: row.status, filings: Number(row.filings) || 0, docs: Number(row.docs) || 0, ...(isIsoish(row.at) ? { at: new Date(row.at).toISOString() } : {}) };
    }
    coverage = { market: cm, days };
  }
  return { ok: true, body: { collector: raw.collector, market: raw.market ?? null, docs, seen, status, coverage, intimations, ...(reextract ? { reextract: true } : {}) }, rejected };
}

/** zzz916: one intimation entry, or null. The url must be an exchange attachment (that is what an intimation is). */
export function validIntimation(x: any): IntimationEntry | null {
  if (!x || typeof x !== 'object' || !isDocId(x.docId) || !isStr(x.url, 1000)) return null;
  if (!isExchangeHost(hostOf(x.url))) return null;
  const ticker = x.ticker == null ? null : (isStr(x.ticker, 24) && /^[A-Z0-9&.\-_]{1,24}$/.test(x.ticker) ? x.ticker : undefined);
  const bseCode = x.bseCode == null ? null : (isStr(x.bseCode, 6) && /^\d{6}$/.test(x.bseCode) ? x.bseCode : undefined);
  if (ticker === undefined || bseCode === undefined) return null;
  if (!KINDS.includes(x.kind) || !isIsoish(x.filedAt)) return null;
  const company = isStr(x.company, 200) && x.company.trim() ? x.company.trim() : (ticker || bseCode || '');
  if (!company) return null;
  return { docId: x.docId, url: x.url, ticker, bseCode, company, kind: x.kind, filedAt: new Date(x.filedAt).toISOString(), ...(isIsoish(x.firstSeen) ? { firstSeen: new Date(x.firstSeen).toISOString() } : {}) };
}

// ── pure merges ─────────────────────────────────────────────────────────────

export function toIndexRow(d: GuidanceDoc, extracted?: boolean, textBytes?: number): GuidanceDocIndexRow {
  return { docId: d.docId, market: d.market, ticker: d.ticker, company: d.company, kind: d.kind, filedAt: d.filedAt, url: d.url, textChars: d.textChars, ...(textBytes != null ? { textBytes } : {}), ...(extracted ? { extracted: true } : {}) };
}

/** Merge new rows into the index: dedupe by docId (new data wins, the
 *  extracted flag survives), newest filedAt first, capped. */
export function mergeIndex(prev: GuidanceDocIndex | null, docs: GuidanceDoc[], now: Date, cap = INDEX_CAP, bytes?: Map<string, number>, resetExtracted?: Set<string>): GuidanceDocIndex {
  const byId = new Map<string, GuidanceDocIndexRow>();
  for (const r of prev?.rows || []) if (r && r.docId) byId.set(r.docId, r);
  // zzz916: a document that arrives with an `exchangeUrl` replaces the intimation stored earlier under that exchange url (the short
  // "transcript available at <link>" letter): its row leaves the index, so it is no longer listed as the company's "transcript, read, no guidance"
  const replaced = new Set(docs.map((d) => d.exchangeUrl).filter((u): u is string => !!u));
  if (replaced.size) for (const [id, r] of Array.from(byId.entries())) if (replaced.has(r.url) && isShortDocRow(r)) byId.delete(id);
  // zzz921: a re-collected document comes back UNEXTRACTED (resetExtracted); every other re-ingest keeps its flag
  for (const d of docs) byId.set(d.docId, toIndexRow(d, resetExtracted?.has(d.docId) ? false : byId.get(d.docId)?.extracted, bytes?.get(d.docId)));
  const rows = Array.from(byId.values()).sort((a, b) => (b.filedAt || '').localeCompare(a.filedAt || '') || a.docId.localeCompare(b.docId));
  return { updatedAt: now.toISOString(), rows: rows.slice(0, cap) };
}

/** zzz916: a stored transcript / presentation this short is an intimation letter, not the document. */
export function isShortDocRow(r: Pick<GuidanceDocIndexRow, 'kind' | 'textChars'>): boolean {
  return (r.kind === 'TRANSCRIPT' || r.kind === 'PRESENTATION') && typeof r.textChars === 'number' && r.textChars > 0 && r.textChars < SHORT_DOC_CHARS;
}

type IntimationList = { updatedAt: string; items: IntimationEntry[] };
/** zzz916: add new intimations (first-seen date kept), drop the ones a stored document now replaces and the ones older than the retry window; capped, newest first. */
export function mergeIntimations(prev: IntimationList | null, add: IntimationEntry[], resolvedUrls: Set<string>, now: Date, cap = INTIMATIONS_CAP): IntimationList {
  const byId = new Map<string, IntimationEntry>();
  for (const x of prev?.items || []) if (x && x.docId) byId.set(x.docId, x);
  for (const x of add) byId.set(x.docId, { ...x, firstSeen: byId.get(x.docId)?.firstSeen || x.firstSeen || now.toISOString() });
  const cut = new Date(now.getTime() - INTIMATION_RETRY_DAYS * 86_400_000).toISOString();
  const items = Array.from(byId.values()).filter((x) => !resolvedUrls.has(x.url) && x.filedAt >= cut).sort((a, b) => b.filedAt.localeCompare(a.filedAt) || a.docId.localeCompare(b.docId)).slice(0, cap);
  return { updatedAt: now.toISOString(), items };
}

type SeenMap = { updatedAt: string; ids: Record<string, string> };
/** Seen map: docId → "<outcome>:<YYYY-MM-DD>"; entries older than 210 days pruned (zzz874), capped. */
export function mergeSeen(prev: SeenMap | null, seen: SeenEntry[], now: Date, cap = SEEN_CAP): SeenMap {
  const day = now.toISOString().slice(0, 10);
  const cutoff = new Date(now.getTime() - 210 * 86_400_000).toISOString().slice(0, 10);
  const entries = Object.entries(prev?.ids || {}).filter(([, v]) => typeof v === 'string' && (v.split(':')[1] || '') >= cutoff);
  const ids: Record<string, string> = Object.fromEntries(entries);
  for (const s of seen) ids[s.docId] = `${s.outcome}:${day}`;
  const all = Object.entries(ids).sort((a, b) => (b[1].split(':')[1] || '').localeCompare(a[1].split(':')[1] || ''));
  return { updatedAt: now.toISOString(), ids: Object.fromEntries(all.slice(0, cap)) };
}

export function mergeStatus(prev: CollectorStatus | null, collector: string, st: NonNullable<IngestBody['status']>, now: Date): CollectorStatus {
  const byDate = new Map<string, DayStatus>();
  for (const d of prev?.days || []) byDate.set(d.date, d);
  for (const d of st.days) {
    const old = byDate.get(d.date);
    // a later failure never erases an earlier successful read of the same day
    if (d.status === 'failed' && old && old.status !== 'failed') continue;
    byDate.set(d.date, d);
  }
  const days = Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 140);
  return { collector, updatedAt: now.toISOString(), lastRun: st.run ?? prev?.lastRun ?? null, days };
}

/** Same rules as mergeCoverage in .github/scripts/edgar-guidance-backfill.mjs:
 *  a newer row replaces an older one for the same day, except 'failed' never
 *  overwrites 'ok'; days more than 140 days older than the newest are dropped. */
export function mergeCoverage(existing: Coverage | null, market: 'IN' | 'US', rows: Record<string, any>, now = new Date(), keepDays = COVERAGE_KEEP_DAYS): Coverage {
  const days: Record<string, CoverageDay> = { ...((existing && typeof existing === 'object' && existing.days && typeof existing.days === 'object') ? existing.days : {}) };
  for (const [d, r] of Object.entries(rows || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !r) continue;
    const row = typeof r === 'string' ? { status: r } : r;
    if (!['ok', 'partial', 'failed'].includes(row.status)) continue;
    const prev = days[d];
    if (prev && prev.status === 'ok' && row.status === 'failed') continue;
    days[d] = { status: row.status, filings: Number(row.filings) || 0, docs: Number(row.docs) || 0, at: row.at || now.toISOString() };
  }
  const keys = Object.keys(days).sort();
  const newest = keys[keys.length - 1];
  if (newest) {
    const cut = new Date(Date.parse(`${newest}T00:00:00Z`) - keepDays * 86_400_000).toISOString().slice(0, 10);
    for (const k of keys) if (k < cut) delete days[k];
  }
  return { v: 1, market, updatedAt: now.toISOString(), days };
}

export async function readCoverage(kv: DocsKv, market: 'IN' | 'US'): Promise<Coverage | null> {
  return kv.get<Coverage>(coverageKey(market)).catch(() => null);
}

// ── KV operations ───────────────────────────────────────────────────────────

export async function ingestDocs(body: IngestBody, kv: DocsKv, now = new Date()): Promise<{ stored: number; seen: number; indexRows: number; coverageDays: number; reextracted?: number }> {
  // docs first, then the index (a reader never sees an index row whose doc is missing)
  const unique = new Map<string, GuidanceDoc>();
  for (const d of body.docs) unique.set(d.docId, d);
  const docs = Array.from(unique.values());
  const bytes = new Map<string, number>();
  for (const d of docs) {
    const { text, ...meta } = d;
    const textGz = encodeText(text || '');
    bytes.set(d.docId, textGz.length);
    const stored: StoredDoc = { ...meta, textEnc: 'gz64', textGz };
    await kv.set(docKey(d.docId), stored, DOC_TTL_S);
  }
  let indexRows = 0;
  const reIds = body.reextract ? docs.filter((d) => d.market === 'IN').map((d) => d.docId) : [];
  if (docs.length) {
    // zzz916: read-modify-write under the index lock, and never on top of a read that failed (a slow read used to come back null and
    // the whole index was replaced by this one batch: 381 India rows left on 6 Oct where thousands had been stored)
    indexRows = (await withIndexLock(kv, async () => {
      const prev = await readIndexStrict(kv);
      const next = mergeIndex(prev, docs, now, INDEX_CAP, bytes, reIds.length ? new Set(reIds) : undefined);
      await writeIndex(kv, next, now);
      return next.rows.length;
    }, true)) ?? 0;
  }
  // zzz921: the extractor's old result for a re-collected document is cleared AFTER the index row is unextracted again. If this fails the request
  // fails (the collector retries; the whole step is idempotent); if only the clearing is missed, the extractor finds the old result, re-flags the row
  // and nothing is lost — it just is not read again, which the next re-collect fixes.
  if (reIds.length) await clearExtraction(kv, reIds);
  if (body.seen.length) {
    const prev = await kv.get<SeenMap>(DOCS_SEEN_KEY).catch(() => null);
    const meta = await kv.get<IndexMeta>(DOCS_INDEX_META_KEY).catch(() => null);
    if (!prev && (meta?.seen ?? 0) > 0) throw new DocsIndexUnreadableError('the seen list');
    const merged = mergeSeen(prev, body.seen, now);
    await kv.set(DOCS_SEEN_KEY, merged, DOC_TTL_S);
    await patchMeta(kv, { seen: Object.keys(merged.ids).length }, now);
  }
  // zzz916: intimations waiting for their real document; a stored document carrying the intimation's url as exchangeUrl resolves it
  const resolved = new Set(docs.map((d) => d.exchangeUrl).filter((u): u is string => !!u));
  if ((body.intimations && body.intimations.length) || resolved.size) {
    const prev = await kv.get<IntimationList>(INTIMATIONS_KEY).catch(() => null);
    if (body.intimations?.length || prev?.items?.some((x) => resolved.has(x.url))) await kv.set(INTIMATIONS_KEY, mergeIntimations(prev, body.intimations || [], resolved, now), DOC_TTL_S);
  }
  if (body.status) {
    const k = statusKey(body.collector);
    const prev = await kv.get<CollectorStatus>(k).catch(() => null);
    await kv.set(k, mergeStatus(prev, body.collector, body.status, now), DOC_TTL_S);
  }
  let coverageDays = 0;
  if (body.coverage) {
    const m = body.coverage.market;
    const merged = mergeCoverage(await readCoverage(kv, m), m, body.coverage.days, now);
    await kv.set(coverageKey(m), merged, COVERAGE_TTL_S);
    coverageDays = Object.keys(merged.days).length;
  }
  return { stored: docs.length, seen: body.seen.length, indexRows, coverageDays, ...(reIds.length ? { reextracted: reIds.length } : {}) };
}

/**
 * zzz921: forget what the extractor knows about these documents so it reads them again: its result, its error back-off, and their place in its
 * main and ok indexes (listDocs also skips ids found in the main index). The index arrays are read strictly when the store can (a failed read
 * throws, never "nothing to remove") and written back only when something changed. The documents index row is NOT touched here.
 */
export async function clearExtraction(kv: DocsKv, docIds: string[]): Promise<void> {
  if (!docIds.length) return;
  const drop = async (k: string) => { if (kv.del) await kv.del(k); else await kv.set(k, null, 60); };
  for (const id of docIds) { await drop(EXTRACT_RESULT_KEY(id)); await drop(EXTRACT_FAIL_KEY(id)); }
  const gone = new Set(docIds);
  for (const k of [EXTRACT_INDEX_KEY, EXTRACT_OK_INDEX_KEY]) {
    let cur: unknown;
    try { cur = kv.getStrict ? await kv.getStrict<string[]>(k) : await kv.get<string[]>(k); } catch { throw new DocsIndexUnreadableError('the extractor index'); }
    if (!Array.isArray(cur)) continue;
    const next = cur.filter((id) => !gone.has(String(id)));
    if (next.length !== cur.length) await kv.set(k, next, 270 * 86_400);
  }
}

// ── zzz916: index integrity ─────────────────────────────────────────────────

type IndexMeta = { rows?: number; seen?: number; updatedAt?: string };
async function patchMeta(kv: DocsKv, patch: IndexMeta, now: Date): Promise<void> {
  const cur = await kv.get<IndexMeta>(DOCS_INDEX_META_KEY).catch(() => null);
  await kv.set(DOCS_INDEX_META_KEY, { ...(cur && typeof cur === 'object' ? cur : {}), ...patch, updatedAt: now.toISOString() }, DOC_TTL_S);
}
/** The index, or null when there truly is none. Throws when the read failed although the meta record says rows exist. */
export async function readIndexStrict(kv: DocsKv): Promise<GuidanceDocIndex | null> {
  const idx = await kv.get<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null);
  if (idx && Array.isArray(idx.rows)) return idx;
  const meta = await kv.get<IndexMeta>(DOCS_INDEX_META_KEY).catch(() => null);
  if ((meta?.rows ?? 0) > 0) throw new DocsIndexUnreadableError('the documents index');
  // no meta yet (the first write after zzz916 deploys): a store that can tell "missing" from "failed" is asked once more, strictly
  if (!meta && kv.getStrict) {
    let again: GuidanceDocIndex | null;
    try { again = await kv.getStrict<GuidanceDocIndex>(DOCS_INDEX_KEY); } catch { throw new DocsIndexUnreadableError('the documents index'); }
    if (again && Array.isArray(again.rows)) return again;
  }
  return null;
}
async function writeIndex(kv: DocsKv, next: GuidanceDocIndex, now: Date): Promise<void> {
  await kv.set(DOCS_INDEX_KEY, next, DOC_TTL_S);
  await patchMeta(kv, { rows: next.rows.length }, now);
}
/**
 * Run `fn` holding the index lock (SET NX, 30 s). Without lock support (tests) it simply runs. `must` = the caller cannot skip the
 * write (ingest: throw so the collector retries); otherwise (markExtracted) a lock not obtained skips the index update (null).
 */
export async function withIndexLock<T>(kv: DocsKv, fn: () => Promise<T>, must: boolean): Promise<T | null> {
  if (!kv.setNX) return fn();
  const sleep = kv.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < 10; i++) {
    const got = await kv.setNX(DOCS_INDEX_LOCK_KEY, { at: Date.now() }, 30).catch(() => false);
    if (got) {
      try { return await fn(); } finally { if (kv.del) await kv.del(DOCS_INDEX_LOCK_KEY).catch(() => undefined); }
    }
    await sleep(300 + i * 150);
  }
  if (must) throw new DocsIndexUnreadableError('the documents index lock');
  return null;
}

/**
 * zzz916: intimations the collector should try to resolve (Screener.in concall list): the collector's pending list, plus stored
 * India transcripts / presentations so short they are intimation letters (stored before zzz916). Within the retry window, newest first.
 */
export async function pendingIntimations(kv: DocsKv, now = new Date()): Promise<IntimationEntry[]> {
  const [list, idx] = await Promise.all([kv.get<IntimationList>(INTIMATIONS_KEY).catch(() => null), kv.get<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null)]);
  const cut = new Date(now.getTime() - INTIMATION_RETRY_DAYS * 86_400_000).toISOString();
  const out = new Map<string, IntimationEntry>();
  for (const x of list?.items || []) if (x && x.filedAt >= cut) out.set(x.docId, x);
  for (const r of idx?.rows || []) {
    if (!r || r.market !== 'IN' || !isShortDocRow(r) || (r.filedAt || '') < cut || out.has(r.docId)) continue;
    if (!isExchangeHost(hostOf(r.url))) continue;
    out.set(r.docId, { docId: r.docId, url: r.url, ticker: r.ticker, bseCode: null, company: r.company, kind: r.kind, filedAt: r.filedAt });
  }
  return Array.from(out.values()).sort((a, b) => b.filedAt.localeCompare(a.filedAt)).slice(0, 1_500);
}

/** docIds a collector need not download again: stored docs + seen (skipped) docs. */
export async function knownDocIds(kv: DocsKv, market?: 'IN' | 'US'): Promise<string[]> {
  const [idx, seen] = await Promise.all([
    kv.get<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null),
    kv.get<SeenMap>(DOCS_SEEN_KEY).catch(() => null),
  ]);
  const out = new Set<string>();
  for (const r of idx?.rows || []) if (!market || r.market === market) out.add(r.docId);
  for (const k of Object.keys(seen?.ids || {})) out.add(k);
  return Array.from(out);
}

export async function readCollectorStatus(kv: DocsKv, collector: string): Promise<CollectorStatus | null> {
  return kv.get<CollectorStatus>(statusKey(collector)).catch(() => null);
}

export interface ListDocsOpts {
  market?: 'IN' | 'US';
  sinceDays?: number;
  kinds?: GuidanceDocKind[];
  unextractedOnly?: boolean;
  limit?: number;
}

/** Index rows (no text), newest first. `unextractedOnly` also consults the
 *  extractor's own index, so a lost `extracted` flag never re-queues a doc. */
export async function listDocs(opts: ListDocsOpts = {}, kv: DocsKv = realDocsKv(), now = new Date()): Promise<GuidanceDocIndexRow[]> {
  const idx = await kv.get<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null);
  let rows = Array.isArray(idx?.rows) ? idx!.rows : [];
  if (opts.market) rows = rows.filter((r) => r.market === opts.market);
  if (opts.sinceDays != null && opts.sinceDays > 0) {
    const cut = new Date(now.getTime() - opts.sinceDays * 86_400_000).toISOString();
    rows = rows.filter((r) => (r.filedAt || '') >= cut);
  }
  if (opts.kinds && opts.kinds.length) { const ks = new Set(opts.kinds); rows = rows.filter((r) => ks.has(r.kind)); }
  if (opts.unextractedOnly) {
    const done = await kv.get<string[]>(EXTRACT_INDEX_KEY).catch(() => null);
    const doneSet = new Set(Array.isArray(done) ? done : []);
    rows = rows.filter((r) => !r.extracted && !doneSet.has(r.docId));
  }
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

export async function getDoc(docId: string, kv: DocsKv = realDocsKv()): Promise<GuidanceDoc | null> {
  if (!/^[0-9a-f]{20}$/.test(docId)) return null;
  const d = await kv.get<StoredDoc>(docKey(docId)).catch(() => null);
  if (!d || typeof d !== 'object' || d.docId !== docId) return null;
  const { textEnc, textGz, textDropped, ...meta } = d;
  let text: string | undefined = typeof d.text === 'string' ? d.text : undefined;   // pre-wave-2 plain docs
  if (textEnc === 'gz64' && typeof textGz === 'string') {
    try { text = decodeText(textGz); } catch { text = undefined; }
  }
  return { ...(meta as GuidanceDoc), ...(text !== undefined ? { text } : { text: undefined }) };
}

/** Flag the index row as extracted. When the extractor's result for the doc
 *  is final and successful ('ok' / 'no_guidance'), the stored text is dropped
 *  (metadata + url kept) so steady-state storage stays small. Returns false
 *  when the doc is not indexed. */
export async function markExtracted(docId: string, kv: DocsKv = realDocsKv(), now = new Date()): Promise<boolean> {
  // zzz916: the index flag is set under the index lock on a FRESH read (the read-modify-write used to race the collector's ingest and
  // could drop documents stored in between). The extractor's own index is the source of truth for "extracted", so a skipped flag is harmless.
  const r = await withIndexLock(kv, async () => {
    const idx = await kv.get<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null);
    if (!idx || !Array.isArray(idx.rows)) return false;
    const row = idx.rows.find((x) => x.docId === docId);
    if (!row) return false;
    const result = await kv.get<{ status?: string }>(EXTRACT_RESULT_KEY(docId)).catch(() => null);
    const final = !!result && (result.status === 'ok' || result.status === 'no_guidance');
    let changed = false;
    if (final) {
      const d = await kv.get<StoredDoc>(docKey(docId)).catch(() => null);
      if (d && typeof d === 'object' && !d.textDropped) {
        const { textGz, textEnc, text, ...meta } = d;
        await kv.set(docKey(docId), { ...meta, textDropped: true }, DOC_TTL_S);
      }
      if (row.textBytes !== 0) { row.textBytes = 0; changed = true; }
    }
    if (!row.extracted) { row.extracted = true; changed = true; }
    if (changed) await writeIndex(kv, { updatedAt: now.toISOString(), rows: idx.rows }, now);
    return true;
  }, false).catch(() => null);
  return r ?? true;
}

/** Docs indexed and the compressed text bytes they hold (from the index). */
export async function storageStats(kv: DocsKv = realDocsKv()): Promise<{ docs: number; withText: number; textBytes: number; byMarket: Record<string, { docs: number; textBytes: number }> }> {
  const idx = await kv.get<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null);
  const rows = Array.isArray(idx?.rows) ? idx!.rows : [];
  const byMarket: Record<string, { docs: number; textBytes: number }> = {};
  let textBytes = 0, withText = 0;
  for (const r of rows) {
    // rows written before wave 2 carry no textBytes: estimate from textChars
    const b = typeof r.textBytes === 'number' ? r.textBytes : Math.round((r.textChars || 0) * 1.33);
    textBytes += b; if (b > 0) withText++;
    const m = (byMarket[r.market] ||= { docs: 0, textBytes: 0 });
    m.docs++; m.textBytes += b;
  }
  return { docs: rows.length, withText, textBytes, byMarket };
}

// ── real KV (lazy import) ───────────────────────────────────────────────────

export function realDocsKv(timeoutMs = 5_000): DocsKv {
  const race = <T>(p: Promise<T>, fb: T): Promise<T> => Promise.race([p.catch(() => fb), new Promise<T>((r) => setTimeout(() => r(fb), timeoutMs))]);
  return {
    get: async <T>(k: string) => { const m = await import('./kv'); return race(m.kvGet<T>(k), null); },
    // writes are not raced: an ingest must fail loudly rather than report a store it did not make
    set: async (k, v, ttl) => { const m = await import('./kv'); await m.kvSet(k, v, ttl); },
    // zzz916: the index lock (a lock that cannot be confirmed is not taken)
    setNX: async (k, v, ttl) => { const m = await import('./kv'); return race(m.kvSetNX(k, v, ttl), false); },
    del: async (k) => { const m = await import('./kv'); await race(m.kvDel(k), undefined); },
    // zzz916: a read that tells "missing" (null) from "failed" (throws) — Upstash REST answers {"result":null} for a missing key
    getStrict: async <T>(k: string): Promise<T | null> => {
      const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
      if (!url || !token) { const m = await import('./kv'); return m.kvGet<T>(k); }   // in-memory mode: nothing can fail remotely
      const res = await fetch(`${url.replace(/\/+$/, '')}/get/${encodeURIComponent(k)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(Math.max(timeoutMs, 15_000)) });
      if (!res.ok) throw new Error(`KV HTTP ${res.status}`);
      const j: any = await res.json();
      const raw = j?.result;
      if (raw === null || raw === undefined) return null;
      if (typeof raw !== 'string') return raw as T;
      let p: any = JSON.parse(raw); if (typeof p === 'string') p = JSON.parse(p);
      return p as T;
    },
  };
}
