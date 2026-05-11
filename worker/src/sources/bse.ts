// ─── BSE corporate-announcements adapter ───────────────────────────────────
// BSE publishes a public JSON API at api.bseindia.com that lists corporate
// announcements with `category="Result"`. Unlike Trendlyne (which tracks
// SCHEDULED board meetings), this API surfaces the ACTUAL filing event the
// moment a company posts results to BSE — including weekend filings that
// EarningsPulse shows but Trendlyne misses.
//
// Endpoint:
//   GET https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w
//     strCat=Result
//     strPrevDate=YYYYMMDD
//     strToDate=YYYYMMDD
//     strType=C
//     strSearch=P
//     pageno=1..N
//
// Each row has:
//   SCRIP_CD       (e.g. 526433) — BSE code
//   SLONGNAME      (e.g. "ASM Technologies Ltd")
//   NSURL          (e.g. ".../stock-share-price/asm-technologies-ltd/asmtec/526433/")
//                   ^ slug between company-name and code is the NSE ticker
//   DT_TM          IST timestamp "2026-05-09T20:29:59.867"
//   HEADLINE       Filing title
//   ATTACHMENTNAME Filing PDF (relative)
//   QUARTER_ID     null for results
//   TotalPageCnt   Paging count
//
// PATCH 0147: closes the May 8-9 coverage gap by fetching from BSE directly.

import { CanonicalEvent, FetchOptions, SourceAdapter } from '../types.js';

const BSE_API = 'https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15_000;

// "results" filter — match the headlines/announcement-types that BSE uses
// for actual quarterly/annual results filings. We deliberately INCLUDE
// 'Outcome of Board Meeting' rows because they're the canonical wrapper
// BSE uses around the actual financial-results PDF.
const RESULTS_HEADLINE_RE = /(financial\s+results|results\s+for\s+the|outcome\s+of\s+board\s+meeting|quarterly\s+results|annual\s+results|standalone\s+(?:and\s+consolidated\s+)?financial\s+results|consolidated\s+(?:and\s+standalone\s+)?financial\s+results)/i;

function fmtYYYYMMDD(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// Parse NSURL like ".../stock-share-price/asm-technologies-ltd/asmtec/526433/"
// → NSE ticker "ASMTEC". When no NSE listing exists, fall back to SCRIP_CD.
function nseTickerFromNsurl(nsurl: string | null | undefined, scripCd: number | string): string {
  if (nsurl) {
    const m = nsurl.match(/\/stock-share-price\/[^\/]+\/([^\/]+)\/\d+\/?/i);
    if (m && m[1] && !/^\d+$/.test(m[1])) {
      return m[1].toUpperCase();
    }
  }
  return String(scripCd);
}

// Pull the IST calendar day from BSE's IST-formatted timestamp.
// "2026-05-09T20:29:59.867" → "2026-05-09"
function istDateFromBseStamp(s: string): { date: string; iso: string } | null {
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [_, y, mo, d, h, mi, se] = m;
  // BSE stamps are IST. We keep the IST calendar day verbatim.
  const date = `${y}-${mo}-${d}`;
  // For filing_dt_iso, convert IST → UTC
  const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h - 5, +mi - 30, +se));
  const iso = isNaN(utc.getTime()) ? `${date}T00:00:00.000Z` : utc.toISOString();
  return { date, iso };
}

async function fetchBsePage(prevDate: string, toDate: string, pageno: number, signal?: AbortSignal): Promise<any | null> {
  const url = `${BSE_API}?strCat=Result&strPrevDate=${prevDate}&strScrip=&strSearch=P&strToDate=${toDate}&strType=C&subcategory=${pageno > 1 ? `&pageno=${pageno}` : ''}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  // chain external abort
  if (signal) signal.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.bseindia.com/' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

export const bseAdapter: SourceAdapter = {
  name: 'bse',
  priority: 1,
  async fetch({ from, to, signal }: FetchOptions): Promise<CanonicalEvent[]> {
    const out: CanonicalEvent[] = [];
    const seen = new Set<string>();
    const scrapedAt = new Date().toISOString();

    // BSE API returns up to ~50 rows per page across the [prev,to] window.
    // Iterate in 7-day windows to keep response sizes manageable.
    for (let cur = new Date(from); cur <= to; cur.setDate(cur.getDate() + 7)) {
      if (signal?.aborted) break;
      const winEnd = new Date(cur);
      winEnd.setDate(cur.getDate() + 6);
      const prev = fmtYYYYMMDD(cur);
      const toS = fmtYYYYMMDD(winEnd > to ? to : winEnd);

      // Page 1 returns TotalPageCnt; iterate the remainder
      const first = await fetchBsePage(prev, toS, 1, signal);
      if (!first) {
        console.warn(`[bse] window ${prev}-${toS} → no data`);
        continue;
      }
      const rows: any[] = first?.Table || [];
      const totalPages = Math.max(1, Math.min(20, rows[0]?.TotalPageCnt || 1));
      const allRows = [...rows];
      for (let p = 2; p <= totalPages; p++) {
        if (signal?.aborted) break;
        const more = await fetchBsePage(prev, toS, p, signal);
        if (more?.Table?.length) allRows.push(...more.Table);
      }

      for (const r of allRows) {
        const headline = String(r?.HEADLINE || r?.NEWSSUB || '');
        if (!RESULTS_HEADLINE_RE.test(headline)) continue;
        const stamp = istDateFromBseStamp(r?.DT_TM || r?.News_submission_dt || r?.DissemDT);
        if (!stamp) continue;
        // Stay inside the caller's window
        if (stamp.date < fmtYYYYMMDD(from).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') ||
            stamp.date > fmtYYYYMMDD(to).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) continue;

        const ticker = nseTickerFromNsurl(r?.NSURL, r?.SCRIP_CD);
        const company = String(r?.SLONGNAME || ticker).trim();
        const attachment = r?.ATTACHMENTNAME
          ? (String(r.ATTACHMENTNAME).startsWith('http') ? String(r.ATTACHMENTNAME)
              : `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${r.ATTACHMENTNAME}`)
          : null;

        const key = `${ticker}|${stamp.date}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          symbol: ticker,
          company,
          filing_date: stamp.date,
          filing_dt_iso: stamp.iso,
          quarter: '',                            // computed downstream from period_ended
          period_ended: '',                       // BSE API doesn't expose this directly
          audited: /audited/i.test(headline),
          consolidated: /consolidated/i.test(headline),
          period_type: 'Quarterly',
          attachment,
          source_url: attachment || r?.NSURL || `https://www.bseindia.com/stock-share-price/?scripcode=${r?.SCRIP_CD}`,
          exchange: 'BSE',
          source: 'bse',
          source_priority: 1,
          scraped_at: scrapedAt,
          bse_code: String(r?.SCRIP_CD || ''),
        });
      }
    }
    return out;
  },
};
