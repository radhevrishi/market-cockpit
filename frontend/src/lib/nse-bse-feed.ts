// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0387 — NSE + BSE general corporate-announcement adapters.
//
// Two sources:
//   1. NSE primary  — https://www.nseindia.com/api/corporate-announcements
//   2. BSE fallback — https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w
//
// Engineering constraints from the user's blueprint:
//   - Browser-like headers (User-Agent, Accept-Language, Referer)
//   - Session cookie warm-up (best-effort)
//   - Retry with exponential backoff
//   - Graceful degradation (BSE best-effort)
//   - Content hash for dedup
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import {
  dedupedCall,
  negCacheCheck,
  negCacheSet,
} from './nse-resilient-fetch';
import { kvGet, isRedisAvailable } from './kv';

// PATCH 0739 — GH-Actions-scraped corp-filings blob. Written by
// .github/scripts/scrape-corp-filings.mjs 4×/day on GitHub Actions free
// CPU. When this blob is fresh, fetchNSEAnnouncements / fetchBSEAnnouncements
// serve from it instead of calling NSE/BSE live — moves the ingestion
// cost off Vercel (CLAUDE.md §18.5 CPU rescue) and dodges the 50% NSE
// upstream failure rate (§18.8).
const GH_BLOB_KEY = 'corp-filings:v1:latest';
const GH_BLOB_MAX_AGE_MS = 6 * 60 * 60 * 1000;   // 6h — half the 12h gap between scrapes

interface GhBlobShape {
  generatedAt?: string;
  sources?: Partial<Record<'NSE' | 'BSE', { fetchedAt?: string; state?: string }>>;
  filings?: FilingRecord[];
}

async function readGhBlob(exchange: 'NSE' | 'BSE'): Promise<GhBlobShape | null> {
  if (!isRedisAvailable()) return null;
  try {
    const blob = await kvGet<GhBlobShape>(GH_BLOB_KEY);
    if (!blob || !Array.isArray(blob.filings) || blob.filings.length === 0) return null;
    const fetchedAt = blob.sources ? blob.sources[exchange]?.fetchedAt : blob.generatedAt;
    if (blob.sources && !fetchedAt) return null;
    if (fetchedAt) {
      const ageMs = Date.now() - new Date(fetchedAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > GH_BLOB_MAX_AGE_MS) return null;
    }
    return blob;
  } catch {
    return null;
  }
}

// PATCH 0929 — Cloudflare Worker as a primary source for NSE filings.
// The Worker (mc-scraper.radhev-232.workers.dev) runs every 5 min during
// IST market hours, fetches NSE corporate-announcements with a persistent
// cookie session (stable Cloudflare egress IP), and stores filings in
// Cloudflare KV. Vercel reads from a public Worker endpoint (no auth)
// served sub-100ms from CF edge.
//
// Why this is the right primary:
//   - Bypasses NSE blocks on Vercel egress IPs (§18.8 50% failure rate)
//   - No Vercel CPU spent on upstream call
//   - No Upstash quota burn (CF KV is separate free-tier with 100K reads/day)
//   - Fresh data within 5 min during market hours
//
// Fallback chain:
//   1. CF Worker (this function)            ← Patch 0929, primary
//   2. GH-Actions-scraped Upstash blob      ← Patch 0739, secondary
//   3. Direct NSE live fetch                ← original, last-resort
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';
const CF_WORKER_MAX_AGE_MS = 15 * 60 * 1000;  // 15 min — accept slightly stale before falling through

interface CFWorkerResponse {
  generated_at?: string;
  count?: number;
  filings?: Array<Record<string, any>>;
  cached?: boolean;
}

/** Normalize the CF Worker's raw NSE filing shape into our FilingRecord. */
function normalizeCFFiling(raw: any): FilingRecord | null {
  const symbol = raw.symbol || raw.SYMBOL || '';
  const subject = String(raw.subject || raw.desc || '').trim();
  const isoDt = raw.filing_date || raw.an_dt || raw.dt || '';
  if (!symbol || !subject || !isoDt) return null;
  // Worker's filing_date is in NSE format ("27-May-2026 00:52:00"). Parse it.
  const parsed = parseNSEDateTime(isoDt);
  if (!parsed) return null;
  const attUrl = raw.attachment_url || raw.attchmntFile || '';
  const attUrls = attUrl ? [attUrl] : [];
  const detail = String(raw.raw?.attchmntText || raw.attchmntText || raw.detail || '').trim();
  return {
    exchange: 'NSE',
    symbol: symbol.toUpperCase(),
    company_name: raw.company || raw.sm_name || symbol,
    subject,
    ...(detail && detail !== subject ? { detail } : {}),
    category: raw.category || null,
    subcategory: null,
    filing_datetime: parsed,
    attachment_urls: attUrls,
    source_url: attUrl || `https://www.nseindia.com/companies-listing/corporate-filings-financial-results?symbol=${encodeURIComponent(symbol)}`,
    content_hash: createHash('sha256').update(`NSE|${symbol.toUpperCase()}|${subject.toLowerCase().trim()}|${parsed}|${attUrls.join(',')}`).digest('hex').slice(0, 16),
  };
}

/** Parse "27-May-2026 00:52:00" → "2026-05-27T00:52:00Z" */
function parseNSEDateTime(s: string): string | null {
  if (!s) return null;
  // ISO first
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const months: Record<string, string> = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06', JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };
  const mm = months[m[2].slice(0, 3).toUpperCase()];
  if (!mm) return null;
  const dd = m[1].padStart(2, '0');
  const hh = (m[4] || '00').padStart(2, '0');
  const mn = (m[5] || '00').padStart(2, '0');
  const ss = (m[6] || '00').padStart(2, '0');
  return `${m[3]}-${mm}-${dd}T${hh}:${mn}:${ss}Z`;
}

async function readCFWorkerBlob(signal?: AbortSignal): Promise<FilingRecord[] | null> {
  if (!CF_WORKER_URL) return null;
  try {
    const url = `${CF_WORKER_URL}/api/filings/latest`;
    const res = await fetch(url, {
      signal: withDefaultTimeout(signal, 5_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CFWorkerResponse;
    if (!Array.isArray(data?.filings) || data.filings.length === 0) return null;
    // Age check — if Worker hasn't run recently, fall through to fallbacks
    if (data.generated_at) {
      const ageMs = Date.now() - new Date(data.generated_at).getTime();
      if (!Number.isFinite(ageMs) || ageMs > CF_WORKER_MAX_AGE_MS) return null;
    }
    const normalized: FilingRecord[] = [];
    for (const raw of data.filings) {
      const f = normalizeCFFiling(raw);
      if (f) normalized.push(f);
    }
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function filterBlobToWindow(filings: FilingRecord[], fromIso: string, toIso: string, exchange: 'NSE' | 'BSE'): FilingRecord[] {
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();
  const toMs   = new Date(`${toIso}T23:59:59Z`).getTime();
  return filings.filter((f) => {
    if (f.exchange !== exchange) return false;
    const t = new Date(f.filing_datetime).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= fromMs && t <= toMs;
  });
}

// PATCH 0732 — defaults applied to both NSE and BSE announcement adapters
// to absorb the ~50% upstream failure rate. Negative-cache TTL matches
// lib/nse.ts; per-call timeout protects callers that forgot to pass an
// AbortSignal (otherwise upstream hangs eat the full Vercel maxDuration).
const ANNOUNCEMENT_NEG_CACHE_MS = 90_000;
const ANNOUNCEMENT_DEFAULT_TIMEOUT_MS = 12_000;

// Combines a caller-supplied AbortSignal with a default timeout signal so
// the fetch always has an upper bound, while still honouring caller-side
// aborts (e.g. React useEffect cleanup).
function withDefaultTimeout(callerSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (!callerSignal) return AbortSignal.timeout(timeoutMs);
  // AbortSignal.any was added in Node 20 and is on the Vercel runtime.
  // Fall back to a manual chained controller for older runtimes.
  const anyFn = (AbortSignal as any).any;
  if (typeof anyFn === 'function') {
    return anyFn([callerSignal, AbortSignal.timeout(timeoutMs)]);
  }
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (callerSignal.aborted) ctl.abort();
  else callerSignal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  ctl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return ctl.signal;
}

export interface FilingRecord {
  exchange: 'NSE' | 'BSE';
  symbol: string;
  company_name: string;
  subject: string;
  /** zzz810 — the exchange's free-text line under the subject (NSE
   *  `attchmntText`, BSE `HEADLINE`). NSE files every concall item under the
   *  one category "Analysts/Institutional Investor Meet/Con. Call Updates";
   *  whether it is a transcript, a recording link or a routine intimation is
   *  only said here. Not part of content_hash (hashes stay stable). */
  detail?: string;
  category: string | null;
  subcategory: string | null;
  filing_datetime: string;       // ISO
  attachment_urls: string[];
  source_url: string;
  content_hash: string;
}

function hashRecord(exchange: string, symbol: string, subject: string, dt: string, urls: string[]): string {
  const payload = `${exchange}|${symbol.toUpperCase()}|${subject.toLowerCase().trim()}|${dt}|${urls.join(',')}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ─── Snapshot coverage (zzz810) ────────────────────────────────────────────
// The CF Worker snapshot holds only the ~20 NEWEST announcements (no date
// range) and the GH blob ~24h. Before zzz810 any non-empty overlap with the
// requested window was returned as NSE_OK — so a 30-day request got 20 rows
// of "Trading Window / Change in Director", none of them concalls, and the
// live windowed fetch never ran. That is why the Radar said "0 in feed".
// A snapshot may only answer a request when it actually reaches back to the
// start of the window (12h slack); otherwise the window is fetched live and
// the snapshot rows are merged in.
const SNAPSHOT_COVER_SLACK_MS = 12 * 60 * 60 * 1000;

export function snapshotCoversWindow(filings: FilingRecord[], fromIso: string): boolean {
  if (!Array.isArray(filings) || filings.length === 0) return false;
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(fromMs)) return false;
  let oldest = Infinity;
  for (const f of filings) {
    const t = new Date(f.filing_datetime).getTime();
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  return oldest <= fromMs + SNAPSHOT_COVER_SLACK_MS;
}

function mergeByHash(...lists: FilingRecord[][]): FilingRecord[] {
  const seen = new Set<string>();
  const out: FilingRecord[] = [];
  for (const list of lists) {
    for (const f of list) {
      const k = f.content_hash || `${f.exchange}|${f.symbol}|${f.subject}|${f.filing_datetime}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
  }
  return out;
}

export interface AnnouncementResult<S extends string> {
  filings: FilingRecord[];
  source: S;
  /** zzz810 — why a fetch failed or came back empty (HTTP 403, timeout …). */
  reason?: string;
  /** zzz810 — SNAPSHOT (blob covered the window), LIVE, or SNAPSHOT+LIVE. */
  via?: 'SNAPSHOT' | 'LIVE' | 'SNAPSHOT+LIVE';
}

// ─── NSE adapter ───────────────────────────────────────────────────────────

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
};

// zzz810 — NSE's API answers 401/403 without the session cookies its
// homepage sets. The header comment always promised a warm-up; there was
// none. One homepage visit per 10 minutes, shared by every caller.
let nseCookieJar = '';
let nseCookieExpiry = 0;
async function nseCookies(force = false): Promise<string> {
  if (!force && nseCookieJar && Date.now() < nseCookieExpiry) return nseCookieJar;
  try {
    const res = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': NSE_HEADERS['User-Agent'], 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    const set = (res.headers as any).getSetCookie?.() || [];
    nseCookieJar = (set as string[]).map((c) => c.split(';')[0]).join('; ');
    nseCookieExpiry = Date.now() + 10 * 60 * 1000;
  } catch {
    nseCookieJar = '';
    nseCookieExpiry = 0;
  }
  return nseCookieJar;
}

/** One NSE corporate-announcement row → FilingRecord (null when unusable). */
export function nseRowToFiling(e: Record<string, any>): FilingRecord | null {
  const subject = String(e.subject || e.desc || '').trim();
  if (!subject) return null;
  const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt;
  if (!ts) return null;
  let isoDt: string;
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return null;
    isoDt = d.toISOString();
  } catch { return null; }
  const symbol = String(e.symbol || '').trim().toUpperCase();
  const company = String(e.sm_name || e.company_name || symbol).trim();
  const urls: string[] = [];
  if (e.attchmntFile) urls.push(String(e.attchmntFile));
  if (e.attachmentUrl) urls.push(String(e.attachmentUrl));
  const detail = String(e.attchmntText || '').trim();
  return {
    exchange: 'NSE',
    symbol,
    company_name: company,
    subject,
    ...(detail && detail !== subject ? { detail } : {}),
    category: e.csubject || e.category || null,
    subcategory: e.smkt_cat || e.sub_category || null,
    filing_datetime: isoDt,
    attachment_urls: urls,
    source_url: `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(symbol)}`,
    content_hash: hashRecord('NSE', symbol, subject, isoDt, urls),
  };
}

export async function fetchNSEAnnouncements(opts: {
  signal?: AbortSignal;
  fromIso?: string;   // YYYY-MM-DD start
  toIso?: string;     // YYYY-MM-DD end (defaults to today)
} = {}): Promise<AnnouncementResult<'NSE_OK' | 'NSE_BLOCKED' | 'NSE_EMPTY'>> {
  // The general endpoint with no symbol param returns announcements for all
  // equities in the date range. NSE takes DD-MM-YYYY.
  const today = new Date();
  const fromStr = opts.fromIso || isoDaysAgo(2);
  const toStr = opts.toIso || today.toISOString().slice(0, 10);
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${formatNSEDate(fromStr)}&to_date=${formatNSEDate(toStr)}`;

  // PATCH 0732 — short-circuit if this exact window has recently failed.
  const dedupKey = `nse-feed:announcements:${fromStr}:${toStr}`;
  const neg = negCacheCheck(dedupKey);
  if (neg) return { filings: [], source: 'NSE_BLOCKED', reason: `${neg.reason} (retry after cool-down)` };

  return dedupedCall(dedupKey, async () => {
    const neg2 = negCacheCheck(dedupKey);
    if (neg2) return { filings: [], source: 'NSE_BLOCKED' as const, reason: `${neg2.reason} (retry after cool-down)` };

    // Snapshot sources (CF Worker ~20 newest + GH blob ~24h). Used alone only
    // when they reach back to the start of the window (zzz810).
    let snapshot: FilingRecord[] = [];
    try {
      const [cfFilings, ghBlob] = await Promise.all([
        readCFWorkerBlob(opts.signal).catch(() => null),
        readGhBlob('NSE').catch(() => null),
      ]);
      const merged = mergeByHash(cfFilings || [], (ghBlob && ghBlob.filings) || []);
      snapshot = filterBlobToWindow(merged, fromStr, toStr, 'NSE');
      if (snapshot.length > 0 && (!ghBlob?.sources || ghBlob.sources.NSE?.state === 'fresh') && snapshotCoversWindow(merged.filter((f) => f.exchange === 'NSE'), fromStr)) {
        return { filings: snapshot, source: 'NSE_OK' as const, via: 'SNAPSHOT' as const };
      }
    } catch {
      /* best-effort: fall through to live fetch */
    }

    const partial = (reason: string) => ({
      filings: snapshot,
      source: 'NSE_BLOCKED' as const,
      reason: snapshot.length > 0 ? `${reason}; only the ${snapshot.length} newest snapshot rows are available` : reason,
      via: snapshot.length > 0 ? 'SNAPSHOT' as const : undefined,
    });

    try {
      const doFetch = async (cookie: string) => fetch(url, {
        signal: withDefaultTimeout(opts.signal, ANNOUNCEMENT_DEFAULT_TIMEOUT_MS),
        headers: cookie ? { ...NSE_HEADERS, Cookie: cookie } : NSE_HEADERS,
        cache: 'no-store',
      });
      let res = await doFetch(await nseCookies());
      if (res.status === 401 || res.status === 403) {
        // Stale / missing session — refresh the cookie once and retry.
        res = await doFetch(await nseCookies(true));
      }
      if (!res.ok) {
        const reason = `NSE HTTP ${res.status}`;
        negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, reason);
        return partial(reason);
      }
      const data = await res.json();
      const entries: Array<Record<string, any>> = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.data) ? (data as any).data : [];

      const live: FilingRecord[] = [];
      for (const e of entries) {
        const f = nseRowToFiling(e);
        if (f) live.push(f);
      }
      // A date range of ALL equities with zero rows is NSE soft-blocking
      // (empty body / challenge page), not a quiet market.
      if (live.length === 0) {
        negCacheSet(dedupKey, Math.floor(ANNOUNCEMENT_NEG_CACHE_MS / 3), 'NSE returned no announcements');
        if (snapshot.length > 0) return partial('NSE returned no announcements for the range');
        return { filings: [], source: 'NSE_EMPTY' as const, reason: 'NSE returned no announcements for the range' };
      }
      const all = mergeByHash(live, snapshot);
      return { filings: all, source: 'NSE_OK' as const, via: snapshot.length > 0 ? 'SNAPSHOT+LIVE' as const : 'LIVE' as const };
    } catch (e: any) {
      const reason = e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'NSE timeout' : `NSE ${e?.message || 'network error'}`;
      negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, reason);
      return partial(reason);
    }
  });
}

// ─── BSE adapter (best-effort) ─────────────────────────────────────────────

const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/',
  'Origin': 'https://www.bseindia.com',
};

/** One BSE AnnGetData row → FilingRecord (null when unusable). */
export function bseRowToFiling(e: Record<string, any>): FilingRecord | null {
  const subject = String(e.NEWSSUB || e.HEADLINE || '').trim();
  if (!subject) return null;
  const ts = e.NEWS_DT || e.DT_TM;
  if (!ts) return null;
  let isoDt: string;
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return null;
    isoDt = d.toISOString();
  } catch { return null; }
  const symbol = String(e.SCRIP_CD || '').trim();
  const company = String(e.SLONGNAME || e.SHORTNAME || symbol).trim();
  const urls: string[] = [];
  if (e.ATTACHMENTNAME) urls.push(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${e.ATTACHMENTNAME}`);
  const detail = String(e.HEADLINE || '').trim();
  return {
    exchange: 'BSE',
    symbol,
    company_name: company,
    subject,
    ...(detail && detail !== subject ? { detail } : {}),
    category: e.CATEGORYNAME || null,
    subcategory: e.SUBCATNAME || null,
    filing_datetime: isoDt,
    attachment_urls: urls,
    source_url: `https://www.bseindia.com/stock-share-price/_/_/${symbol}/`,
    content_hash: hashRecord('BSE', symbol, subject, isoDt, urls),
  };
}

export async function fetchBSEAnnouncements(opts: {
  signal?: AbortSignal;
  fromIso?: string;
  toIso?: string;
  pages?: number;     // default 1
  /** zzz810 — BSE category / subcategory filter, e.g. 'Company Update' +
   *  'Earnings Call Transcript'. Without it the newest N pages of ALL
   *  announcements are read, which in results season is only a few hours. */
  category?: string;
  subcategory?: string;
} = {}): Promise<AnnouncementResult<'BSE_OK' | 'BSE_BLOCKED' | 'BSE_EMPTY'>> {
  const today = new Date();
  const fromStr = (opts.fromIso || isoDaysAgo(2)).replace(/-/g, '');
  const toStr = (opts.toIso || today.toISOString().slice(0, 10)).replace(/-/g, '');
  const pages = opts.pages || 1;
  const cat = opts.category || '';
  const sub = opts.subcategory || '';

  const dedupKey = `bse-feed:announcements:${fromStr}:${toStr}:${pages}:${cat}:${sub}`;
  const neg = negCacheCheck(dedupKey);
  if (neg) return { filings: [], source: 'BSE_BLOCKED', reason: `${neg.reason} (retry after cool-down)` };

  return dedupedCall(dedupKey, async () => {
    const neg2 = negCacheCheck(dedupKey);
    if (neg2) return { filings: [], source: 'BSE_BLOCKED' as const, reason: `${neg2.reason} (retry after cool-down)` };

    // Snapshot (GH blob) — only for the unfiltered query and only when it
    // covers the window (zzz810).
    let snapshot: FilingRecord[] = [];
    if (!cat && !sub) {
      try {
        const fromIso = `${fromStr.slice(0, 4)}-${fromStr.slice(4, 6)}-${fromStr.slice(6, 8)}`;
        const toIso   = `${toStr.slice(0, 4)}-${toStr.slice(4, 6)}-${toStr.slice(6, 8)}`;
        const [cfFilings, blob] = await Promise.all([
          readCFWorkerBlob(opts.signal).catch(() => null),
          readGhBlob('BSE').catch(() => null),
        ]);
        const merged = mergeByHash(cfFilings || [], (blob && blob.filings) || []).filter((f) => f.exchange === 'BSE');
        snapshot = filterBlobToWindow(merged, fromIso, toIso, 'BSE');
        if (snapshot.length > 0 && (!blob?.sources || blob.sources.BSE?.state === 'fresh') && snapshotCoversWindow(merged, fromIso)) {
          return { filings: snapshot, source: 'BSE_OK' as const, via: 'SNAPSHOT' as const };
        }
      } catch {
        /* best-effort: fall through to live fetch */
      }
    }

    const allFilings: FilingRecord[] = [];
    const done = (source: 'BSE_OK' | 'BSE_BLOCKED' | 'BSE_EMPTY', reason?: string) => {
      const filings = mergeByHash(allFilings, snapshot);
      return { filings, source, ...(reason ? { reason } : {}), via: allFilings.length > 0 ? (snapshot.length > 0 ? 'SNAPSHOT+LIVE' as const : 'LIVE' as const) : (snapshot.length > 0 ? 'SNAPSHOT' as const : undefined) };
    };
    try {
      for (let pageno = 1; pageno <= pages; pageno++) {
        const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=${pageno}&strCat=${cat ? encodeURIComponent(cat) : '-1'}&strPrevDate=${fromStr}&strScrip=&strSearch=P&strToDate=${toStr}&strType=C${sub ? `&subcategory=${encodeURIComponent(sub)}` : ''}`;
        const res = await fetch(url, {
          signal: withDefaultTimeout(opts.signal, ANNOUNCEMENT_DEFAULT_TIMEOUT_MS),
          headers: BSE_HEADERS,
          cache: 'no-store',
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403 || res.status === 429) {
            const reason = `BSE HTTP ${res.status}`;
            negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, reason);
            return done(allFilings.length > 0 ? 'BSE_OK' : 'BSE_BLOCKED', reason);
          }
          continue;
        }
        const data = await res.json();
        const tableData: Array<Record<string, any>> = Array.isArray((data as any)?.Table) ? (data as any).Table : [];
        if (tableData.length === 0) break;              // past the last page — stop, don't hammer
        for (const e of tableData) {
          const f = bseRowToFiling(e);
          if (f) allFilings.push(f);
        }
        if (pageno < pages) await new Promise((r) => setTimeout(r, 250));   // polite pacing
      }
      if (allFilings.length === 0) {
        // An unfiltered all-scrip range with zero rows is a soft block; a
        // category-filtered query can genuinely be empty.
        if (!cat && !sub) negCacheSet(dedupKey, Math.floor(ANNOUNCEMENT_NEG_CACHE_MS / 3), 'BSE returned no announcements');
        return done(snapshot.length > 0 ? 'BSE_BLOCKED' : 'BSE_EMPTY', cat || sub ? undefined : 'BSE returned no announcements for the range');
      }
      return done('BSE_OK');
    } catch (e: any) {
      const reason = e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'BSE timeout' : `BSE ${e?.message || 'network error'}`;
      negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, reason);
      return done(allFilings.length > 0 ? 'BSE_OK' : 'BSE_BLOCKED', reason);
    }
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatNSEDate(iso: string): string {
  // YYYY-MM-DD → DD-MM-YYYY (NSE format)
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
