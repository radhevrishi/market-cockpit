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
  filings?: FilingRecord[];
}

async function readGhBlob(): Promise<GhBlobShape | null> {
  if (!isRedisAvailable()) return null;
  try {
    const blob = await kvGet<GhBlobShape>(GH_BLOB_KEY);
    if (!blob || !Array.isArray(blob.filings) || blob.filings.length === 0) return null;
    if (blob.generatedAt) {
      const ageMs = Date.now() - new Date(blob.generatedAt).getTime();
      if (!Number.isFinite(ageMs) || ageMs > GH_BLOB_MAX_AGE_MS) return null;
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
  return {
    exchange: 'NSE',
    symbol: symbol.toUpperCase(),
    company_name: raw.company || raw.sm_name || symbol,
    subject,
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

// ─── NSE adapter ───────────────────────────────────────────────────────────

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
};

export async function fetchNSEAnnouncements(opts: {
  signal?: AbortSignal;
  fromIso?: string;   // YYYY-MM-DD start
  toIso?: string;     // YYYY-MM-DD end (defaults to today)
} = {}): Promise<{ filings: FilingRecord[]; source: 'NSE_OK' | 'NSE_BLOCKED' | 'NSE_EMPTY' }> {
  // The general endpoint with no symbol param returns recent announcements
  // for all equities. NSE accepts from_date / to_date params in
  // DD-MM-YYYY format.
  const today = new Date();
  const fromStr = opts.fromIso || isoDaysAgo(2);
  const toStr = opts.toIso || today.toISOString().slice(0, 10);
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${formatNSEDate(fromStr)}&to_date=${formatNSEDate(toStr)}`;

  // PATCH 0732 — short-circuit if this exact window has recently failed.
  // Keyed by the date range so a different date scan isn't blocked by a
  // failed scan of a different range.
  const dedupKey = `nse-feed:announcements:${fromStr}:${toStr}`;
  if (negCacheCheck(dedupKey)) {
    return { filings: [], source: 'NSE_BLOCKED' };
  }

  return dedupedCall(dedupKey, async () => {
    // Re-check negative cache inside the dedup lock — another concurrent
    // caller may have flipped this window into the failure state while
    // we were waiting.
    if (negCacheCheck(dedupKey)) {
      return { filings: [], source: 'NSE_BLOCKED' as const };
    }

    // PATCH 1101zzz29 — MERGE CF + GH blobs instead of exclusive fallback.
    // Old: CF Worker won when non-empty → GH blob never read. CF Worker
    // queries NSE `?index=equities` with no date range and returns only
    // ~20 newest filings, starving downstream stages (concall scoring,
    // warrant momentum, signals compute). Meanwhile the GH-Actions
    // `scrape-corp-filings.yml` writes 500 filings/day to KV but that
    // blob was unreachable because CF returned non-empty.
    // Fix: pull BOTH in parallel, dedupe by content_hash, merge before
    // window-filtering. CF stays as the freshness source for the last
    // 15-30 min, GH gives the 24h depth needed for real scoring signal.
    try {
      const [cfFilings, ghBlob] = await Promise.all([
        readCFWorkerBlob(opts.signal).catch(() => null),
        readGhBlob().catch(() => null),
      ]);
      const cfArr = (cfFilings && cfFilings.length > 0) ? cfFilings : [];
      const ghArr = (ghBlob && ghBlob.filings) ? ghBlob.filings : [];
      if (cfArr.length > 0 || ghArr.length > 0) {
        const seen = new Set<string>();
        const merged: FilingRecord[] = [];
        // CF first (fresher), then GH entries that don't dupe.
        // Dedupe key: content_hash if present, else symbol|subject|filing_date.
        for (const f of cfArr) {
          const k = (f as any).content_hash || `${f.symbol}|${f.subject}|${f.filing_date}`;
          if (!seen.has(k)) { seen.add(k); merged.push(f); }
        }
        for (const f of ghArr) {
          const k = (f as any).content_hash || `${f.symbol}|${f.subject}|${f.filing_date}`;
          if (!seen.has(k)) { seen.add(k); merged.push(f); }
        }
        const filtered = filterBlobToWindow(merged, fromStr, toStr, 'NSE');
        if (filtered.length > 0) {
          return { filings: filtered, source: 'NSE_OK' as const };
        }
      }
    } catch {
      /* best-effort: fall through to live fetch */
    }

    try {
      const res = await fetch(url, {
        signal: withDefaultTimeout(opts.signal, ANNOUNCEMENT_DEFAULT_TIMEOUT_MS),
        headers: NSE_HEADERS,
        cache: 'no-store',
      });
      if (!res.ok) {
        negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, `HTTP ${res.status}`);
        return { filings: [], source: 'NSE_BLOCKED' as const };
      }
      const data = await res.json();
      const entries: Array<Record<string, any>> = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.data) ? (data as any).data : [];

      const filings: FilingRecord[] = [];
      for (const e of entries) {
        const subject = String(e.subject || e.desc || '').trim();
        if (!subject) continue;
        const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt;
        if (!ts) continue;
        let isoDt: string;
        try {
          const d = new Date(ts);
          if (!Number.isFinite(d.getTime())) continue;
          isoDt = d.toISOString();
        } catch { continue; }

        const symbol = String(e.symbol || '').trim().toUpperCase();
        const company = String(e.sm_name || e.company_name || symbol).trim();
        const urls: string[] = [];
        if (e.attchmntFile) urls.push(String(e.attchmntFile));
        if (e.attachmentUrl) urls.push(String(e.attachmentUrl));

        filings.push({
          exchange: 'NSE',
          symbol,
          company_name: company,
          subject,
          category: e.csubject || e.category || null,
          subcategory: e.smkt_cat || e.sub_category || null,
          filing_datetime: isoDt,
          attachment_urls: urls,
          source_url: `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(symbol)}`,
          content_hash: hashRecord('NSE', symbol, subject, isoDt, urls),
        });
      }
      // PATCH 0732 — NSE_EMPTY is also worth a brief negative cache. NSE
      // legitimately returns empty payloads when blocking softly (429 in
      // some windows, empty body in others). Use a shorter TTL so we
      // recover faster than for a hard failure.
      if (filings.length === 0) {
        negCacheSet(dedupKey, Math.floor(ANNOUNCEMENT_NEG_CACHE_MS / 3), 'empty');
      }
      return {
        filings,
        source: filings.length === 0 ? 'NSE_EMPTY' as const : 'NSE_OK' as const,
      };
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network');
      negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, reason);
      return { filings: [], source: 'NSE_BLOCKED' as const };
    }
  });
}

// ─── BSE adapter (best-effort) ─────────────────────────────────────────────

const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/corporates/ann.html',
};

export async function fetchBSEAnnouncements(opts: {
  signal?: AbortSignal;
  fromIso?: string;
  toIso?: string;
  pages?: number;     // default 1
} = {}): Promise<{ filings: FilingRecord[]; source: 'BSE_OK' | 'BSE_BLOCKED' | 'BSE_EMPTY' }> {
  const today = new Date();
  const fromStr = (opts.fromIso || isoDaysAgo(2)).replace(/-/g, '');
  const toStr = (opts.toIso || today.toISOString().slice(0, 10)).replace(/-/g, '');
  const pages = opts.pages || 1;

  // PATCH 0732 — same resilience pattern as fetchNSEAnnouncements.
  // Pages is included in the key because a 1-page scan and a 5-page scan
  // touch different upstream URLs and may succeed/fail independently.
  const dedupKey = `bse-feed:announcements:${fromStr}:${toStr}:${pages}`;
  if (negCacheCheck(dedupKey)) {
    return { filings: [], source: 'BSE_BLOCKED' };
  }

  return dedupedCall(dedupKey, async () => {
    if (negCacheCheck(dedupKey)) {
      return { filings: [], source: 'BSE_BLOCKED' as const };
    }

    // PATCH 0739 + 1101zzz29 — Merge CF + GH blobs for BSE too. Same
    // logic as fetchNSEAnnouncements above.
    try {
      const fromIso = `${fromStr.slice(0, 4)}-${fromStr.slice(4, 6)}-${fromStr.slice(6, 8)}`;
      const toIso   = `${toStr.slice(0, 4)}-${toStr.slice(4, 6)}-${toStr.slice(6, 8)}`;
      const [cfFilings, blob] = await Promise.all([
        readCFWorkerBlob(opts.signal).catch(() => null),
        readGhBlob().catch(() => null),
      ]);
      const cfArr = (cfFilings && cfFilings.length > 0) ? cfFilings.filter((f: any) => f.exchange === 'BSE') : [];
      const ghArr = (blob && blob.filings) ? blob.filings.filter((f: any) => f.exchange === 'BSE') : [];
      if (cfArr.length > 0 || ghArr.length > 0) {
        const seen = new Set<string>();
        const merged: FilingRecord[] = [];
        for (const f of cfArr) {
          const k = (f as any).content_hash || `${f.symbol}|${f.subject}|${f.filing_date}`;
          if (!seen.has(k)) { seen.add(k); merged.push(f); }
        }
        for (const f of ghArr) {
          const k = (f as any).content_hash || `${f.symbol}|${f.subject}|${f.filing_date}`;
          if (!seen.has(k)) { seen.add(k); merged.push(f); }
        }
        const filtered = filterBlobToWindow(merged, fromIso, toIso, 'BSE');
        if (filtered.length > 0) {
          return { filings: filtered, source: 'BSE_OK' as const };
        }
      }
    } catch {
      /* best-effort: fall through to live fetch */
    }

    const allFilings: FilingRecord[] = [];
    try {
    for (let pageno = 1; pageno <= pages; pageno++) {
      // strCat=AnnLatest fetches recent announcements across all scrips
      const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=${pageno}&strCat=-1&strPrevDate=${fromStr}&strScrip=&strSearch=P&strToDate=${toStr}&strType=C`;
      const res = await fetch(url, {
        signal: withDefaultTimeout(opts.signal, ANNOUNCEMENT_DEFAULT_TIMEOUT_MS),
        headers: BSE_HEADERS,
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, `HTTP ${res.status}`);
          return { filings: allFilings, source: 'BSE_BLOCKED' as const };
        }
        continue;
      }
      const data = await res.json();
      const tableData: Array<Record<string, any>> = Array.isArray((data as any)?.Table)
        ? (data as any).Table
        : [];

      for (const e of tableData) {
        const subject = String(e.NEWSSUB || e.HEADLINE || '').trim();
        if (!subject) continue;
        const ts = e.NEWS_DT || e.DT_TM;
        if (!ts) continue;
        let isoDt: string;
        try {
          const d = new Date(ts);
          if (!Number.isFinite(d.getTime())) continue;
          isoDt = d.toISOString();
        } catch { continue; }

        const symbol = String(e.SCRIP_CD || '').trim();
        const company = String(e.SLONGNAME || e.SHORTNAME || symbol).trim();
        const urls: string[] = [];
        if (e.ATTACHMENTNAME) urls.push(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${e.ATTACHMENTNAME}`);

        allFilings.push({
          exchange: 'BSE',
          symbol,
          company_name: company,
          subject,
          category: e.CATEGORYNAME || null,
          subcategory: e.SUBCATNAME || null,
          filing_datetime: isoDt,
          attachment_urls: urls,
          source_url: `https://www.bseindia.com/stock-share-price/_/_/${symbol}/`,
          content_hash: hashRecord('BSE', symbol, subject, isoDt, urls),
        });
      }
    }
    if (allFilings.length === 0) {
      negCacheSet(dedupKey, Math.floor(ANNOUNCEMENT_NEG_CACHE_MS / 3), 'empty');
    }
    return {
      filings: allFilings,
      source: allFilings.length === 0 ? 'BSE_EMPTY' as const : 'BSE_OK' as const,
    };
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network');
      negCacheSet(dedupKey, ANNOUNCEMENT_NEG_CACHE_MS, reason);
      return { filings: allFilings, source: 'BSE_BLOCKED' as const };
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
