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
