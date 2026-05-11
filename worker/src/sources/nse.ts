// ─── NSE corporate-financial-results adapter (Tier 1 — authoritative) ──────
// Hits NSE's own API with the persistent browser session.  Cookies built up
// in browser-pool over weeks of runs reduce Akamai friction substantially.
//
// Falls back gracefully if NSE blocks any single window — the worker uses
// Trendlyne as fallback when nse returns 0 rows for a window.

import { CanonicalEvent, FetchOptions, SourceAdapter } from '../types.js';
import { getContext } from '../browser-pool.js';

function fmtDDMMMYYYY(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function inferQuarterFromPeriodEnded(periodEnded: string): string {
  const m = periodEnded.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
  if (!m) return '';
  const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const mNum = months[m[2].toUpperCase().slice(0, 3)] ?? -1;
  const yr = +m[3];
  if (mNum === 2)  return `Q4FY${String(yr).slice(2)}`;
  if (mNum === 5)  return `Q1FY${String(yr).slice(2)}`;
  if (mNum === 8)  return `Q2FY${String(yr).slice(2)}`;
  if (mNum === 11) return `Q3FY${String(yr).slice(2)}`;
  return '';
}

function parseBroadcast(raw: string): { date: string | null; iso: string | null } {
  if (!raw) return { date: null, iso: null };
  // "09-MAY-2026 18:30:00" / "2026-05-09T18:30:00"
  const m = raw.match(/(\d{1,2})[- /]([A-Za-z]{3,9}|\d{2})[- /](\d{4})\s*(\d{2}):?(\d{2})?/);
  if (m) {
    const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
    const mm = isNaN(+m[2]) ? months[m[2].toUpperCase().slice(0, 3)] : (+m[2] - 1);
    if (mm !== undefined) {
      const d = new Date(Date.UTC(+m[3], mm, +m[1], +m[4] - 5, (+(m[5] || 0)) - 30));
      if (!isNaN(d.getTime())) {
        const iso = d.toISOString();
        return { date: iso.slice(0, 10), iso };
      }
    }
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), iso };
  }
  return { date: null, iso: null };
}

export const nseAdapter: SourceAdapter = {
  name: 'nse',
  priority: 1,
  async fetch({ from, to, signal }: FetchOptions): Promise<CanonicalEvent[]> {
    const ctx = await getContext('nse');
    const page = await ctx.newPage();
    try {
      // Warm session — homepage then quote then results listing
      await page.goto('https://www.nseindia.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.goto('https://www.nseindia.com/companies-listing/corporate-filings-financial-results', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(500);

      const fromStr = fmtDDMMMYYYY(from);
      const toStr   = fmtDDMMMYYYY(to);
      const out: CanonicalEvent[] = [];
      const scrapedAt = new Date().toISOString();

      // Try Quarterly + Annual + Half-Yearly
      for (const period of ['Quarterly', 'Annual', 'Half-Yearly'] as const) {
        if (signal?.aborted) break;
        const apiUrl = `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=${encodeURIComponent(period)}&from_date=${fromStr}&to_date=${toStr}`;
        const result: any = await page.evaluate(async (url) => {
          try {
            const res = await fetch(url, {
              headers: {
                Accept: 'application/json',
                Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results',
              },
              credentials: 'include',
            });
            if (!res.ok) return { status: res.status, body: null };
            return { status: res.status, body: await res.json() };
          } catch (e: any) {
            return { status: 0, error: e.message };
          }
        }, apiUrl);

        if (!result?.body) {
          console.warn(`[nse] ${period} → http ${result?.status} ${result?.error || ''}`);
          continue;
        }
        const rows = Array.isArray(result.body) ? result.body : (result.body.data || []);
        for (const r of rows) {
          const symbol = String(r?.symbol || r?.SYMBOL || '').trim().toUpperCase();
          if (!symbol) continue;
          const company = String(r?.companyName || r?.COMPANY_NAME || symbol).trim();
          const broadcastRaw = String(r?.broadcast_date_time || r?.BROADCAST_DATE || '').trim();
          const { date, iso } = parseBroadcast(broadcastRaw);
          if (!date) continue;
          const periodEnded = String(r?.period_ended || r?.PERIOD_ENDED || '').trim();
          out.push({
            symbol,
            company,
            filing_date: date,
            filing_dt_iso: iso,
            quarter: inferQuarterFromPeriodEnded(periodEnded),
            period_ended: periodEnded,
            audited: /audited/i.test(r?.audited || r?.filing_status || ''),
            consolidated: /consolidated/i.test(r?.consolidated || r?.filing_status || ''),
            period_type: period,
            attachment: r?.attachment
              ? (String(r.attachment).startsWith('http') ? r.attachment : `https://www.nseindia.com/${String(r.attachment).replace(/^\//, '')}`)
              : null,
            source_url: r?.attachment
              ? (String(r.attachment).startsWith('http') ? r.attachment : `https://www.nseindia.com/${String(r.attachment).replace(/^\//, '')}`)
              : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
            exchange: 'NSE',
            source: 'nse',
            source_priority: 1,
            scraped_at: scrapedAt,
            isin: r?.isin,
            bse_code: r?.bse_code,
          });
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      return out;
    } finally {
      await page.close();
    }
  },
};
