// ─── Trendlyne calendar-v2 adapter ─────────────────────────────────────────
// Trendlyne's events calendar JSON API is the most accessible Indian source.
// We confirmed in the Chrome-MCP seed run that it returns:
//   - GMBREW, TCS, RSWM on 2026-04-09
//   - 895 results across 70 days
// Each event has stock.{NSEcode,BSEcode,ISIN,get_full_name} + date + purpose.

import { CanonicalEvent, FetchOptions, SourceAdapter } from '../types.js';
import { getContext } from '../browser-pool.js';

const RESULTS_PURPOSE_RE = /\b(audited\s+results|unaudited\s+results|quarterly\s+results|annual\s+results|standalone\s+results|consolidated\s+results|q[1-4]\s+results|financial\s+results)\b/i;

function fmtDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function inferQuarter(periodEnded: string | undefined): string {
  if (!periodEnded) return '';
  // Trendlyne dates rarely include period_ended; fall back later when joining
  // with NSE which has it
  return '';
}

export const trendlyneAdapter: SourceAdapter = {
  name: 'trendlyne',
  priority: 2,
  async fetch({ from, to, signal }: FetchOptions): Promise<CanonicalEvent[]> {
    const ctx = await getContext('trendlyne');
    const page = await ctx.newPage();
    try {
      // Warm up — ensures cookies are fresh
      await page.goto('https://trendlyne.com/markets-today/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Loop in 7-day windows; Trendlyne caps each response at ~200 events
      const out: CanonicalEvent[] = [];
      const seen = new Set<string>();
      const scrapedAt = new Date().toISOString();

      for (let cur = new Date(from); cur <= to; cur.setDate(cur.getDate() + 7)) {
        if (signal?.aborted) break;
        const winEnd = new Date(cur);
        winEnd.setDate(cur.getDate() + 6);
        const sd = fmtDDMMYYYY(cur);
        const ed = fmtDDMMYYYY(winEnd > to ? to : winEnd);
        const apiUrl = `https://trendlyne.com/equity/api/events/calendar-v2/?corporate_actions=BM&stock_group=All&start_date=${sd}&end_date=${ed}&perPageCount=500&groupType=all&groupName=all`;

        const data = await page.evaluate(async (url) => {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return { status: res.status, body: null };
          return { status: res.status, body: await res.json() };
        }, apiUrl);

        if (!data.body) {
          console.warn(`[trendlyne] window ${sd} → http ${data.status}`);
          continue;
        }
        const rows = data.body?.body?.eventsData || [];
        for (const r of rows) {
          const purpose = `${r?.purpose || ''} ${r?.['event-details'] || ''}`;
          if (!RESULTS_PURPOSE_RE.test(purpose)) continue;
          const symbol = r?.stock?.NSEcode;
          if (!symbol) continue;
          const date = r?.date;
          if (!date) continue;
          const key = `${symbol}|${date}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            symbol: String(symbol).toUpperCase(),
            company: r?.stock?.get_full_name || symbol,
            filing_date: date,
            filing_dt_iso: null,
            quarter: inferQuarter(undefined),
            period_ended: '',
            audited: /audited/i.test(purpose),
            consolidated: /consolidated/i.test(purpose),
            period_type: 'Quarterly',
            attachment: r?.stock?.absolute_url || null,
            source_url: r?.stock?.absolute_url || `https://trendlyne.com/equity/corporate-actions/${symbol}/`,
            exchange: 'NSE',
            source: 'trendlyne',
            source_priority: 2,
            scraped_at: scrapedAt,
            isin: r?.stock?.ISIN,
            bse_code: r?.stock?.BSEcode,
          });
        }
        // Be polite — 200ms between window calls
        await new Promise((r) => setTimeout(r, 200));
      }
      return out;
    } finally {
      await page.close();
    }
  },
};
