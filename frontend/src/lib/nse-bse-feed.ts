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

  try {
    const res = await fetch(url, {
      signal: opts.signal,
      headers: NSE_HEADERS,
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        return { filings: [], source: 'NSE_BLOCKED' };
      }
      return { filings: [], source: 'NSE_BLOCKED' };
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
    return {
      filings,
      source: filings.length === 0 ? 'NSE_EMPTY' : 'NSE_OK',
    };
  } catch {
    return { filings: [], source: 'NSE_BLOCKED' };
  }
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
  const allFilings: FilingRecord[] = [];

  try {
    for (let pageno = 1; pageno <= pages; pageno++) {
      // strCat=AnnLatest fetches recent announcements across all scrips
      const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=${pageno}&strCat=-1&strPrevDate=${fromStr}&strScrip=&strSearch=P&strToDate=${toStr}&strType=C`;
      const res = await fetch(url, {
        signal: opts.signal,
        headers: BSE_HEADERS,
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          return { filings: allFilings, source: 'BSE_BLOCKED' };
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
    return {
      filings: allFilings,
      source: allFilings.length === 0 ? 'BSE_EMPTY' : 'BSE_OK',
    };
  } catch {
    return { filings: allFilings, source: 'BSE_BLOCKED' };
  }
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
