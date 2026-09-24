// ═══════════════════════════════════════════════════════════════════════════
// THE COMPANY PAGE AS A RESEARCH SOURCE.                             (zzz741)
//
// The exchange feeds this portal can reach hold about twenty filings — the
// current day's. The brief's window is three weeks. The screener.in company
// page carries, for every listed company, the five most recent exchange
// announcements with an exact ISO timestamp, the subject, the PDF link and a
// one-line summary; the market cap and price; and a chart API with a year of
// closes. All of it public, all of it through the proxy chain with its KV
// cache. So a name is researched from THREE fetches, each cheap:
//
//   /company/<T>/                    — id, market cap, price, 5 announcements
//   /api/company/<id>/chart/?q=Price — daily closes → 1M/3M/6M/1Y, history
//   (/announcements/recent/<id>/ answers the same 5; kept for a fallback)
//
// LIMIT, stated: five announcements. In AGM season (September) five filings
// can be eight days of paperwork, so a catalyst filed three weeks ago can sit
// below the fold. The finding records `filingsInWindow` so the reader knows
// how deep the look went.
//
// Parsers are pure and tested against captured pages.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol, parseBseCode } from '@/lib/earnings/screener-documents';
import type { AnnouncementLite, Returns } from './catalyst-research';
import { returnsFromSeries } from './catalyst-research';
import { companyNameFromPage } from './news-context';

export function parseCompanyId(html: string): string | null {
  const m = /data-company-id="(\d+)"/.exec(html) || /\/company\/(\d+)\/chart/.exec(html) || /\/announcements\/recent\/(\d+)\//.exec(html);
  return m ? m[1] : null;
}

/** Top-ratio numbers: "Market Cap ₹ 7,298 Cr.", "Current Price ₹ 2,879". */
export function parseTopRatios(html: string): { marketCapCr: number | null; price: number | null; high52: number | null; low52: number | null; pe: number | null } {
  const grab = (name: string): string | null => {
    const re = new RegExp(`<span class="name">\\s*${name}\\s*<\\/span>\\s*<span class="nowrap value">([\\s\\S]*?)<\\/span>\\s*<\\/li>`, 'i');
    const m = re.exec(html);
    return m ? m[1] : null;
  };
  const nums = (s: string | null): number[] => (s ? Array.from(s.matchAll(/<span class="number">([^<]*)<\/span>/g)).map((m) => parseFloat(m[1].replace(/,/g, ''))).filter((n) => Number.isFinite(n)) : []);
  const mc = nums(grab('Market Cap'))[0] ?? null;
  const px = nums(grab('Current Price'))[0] ?? null;
  const hl = nums(grab('High \\/ Low'));
  const pe = nums(grab('Stock P\\/E'))[0] ?? null;
  return { marketCapCr: mc, price: px, high52: hl[0] ?? null, low52: hl[1] ?? null, pe };
}

// "Scrutinizer''s Report" (KTKBANK): a doubled apostrophe is one. (zzz769)
const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…').replace(/(\w)''(?=\w)/g, "$1'").replace(/\s+/g, ' ').trim();

/** The announcement list: works on the full page and on the ajax fragment. */
export function parseAnnouncements(html: string, now = new Date()): AnnouncementLite[] {
  const out: AnnouncementLite[] = [];
  const block = (() => {
    const i = html.indexOf('company-announcements-tab');
    return i >= 0 ? html.slice(i, i + 40_000) : html;
  })();
  for (const m of block.matchAll(/<li class="overflow-wrap-anywhere">([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const url = /href="([^"]+)"/.exec(li)?.[1];
    const subject = /rel="noopener noreferrer">\s*([\s\S]*?)\s*<div class="ink-600 smaller">/.exec(li)?.[1];
    const dateIso = /datetime="([^"]+)"/.exec(li)?.[1] || null;
    const summary = /<\/time>\s*-\s*([\s\S]*?)<\/div>/.exec(li)?.[1];
    if (!url || !subject) continue;
    const ageDays = dateIso ? Math.max(0, Math.floor((now.getTime() - Date.parse(dateIso)) / 86_400_000)) : null;
    out.push({ subject: decode(subject), summary: summary ? decode(summary) : null, url: decode(url), dateIso, ageDays });
  }
  return out;
}

/** Chart API JSON → [date, close][] */
export function parseChart(json: any): Array<[string, number]> {
  const ds = Array.isArray(json?.datasets) ? json.datasets : [];
  const price = ds.find((d: any) => /price/i.test(String(d?.metric || d?.label || ''))) || ds[0];
  const vals = Array.isArray(price?.values) ? price.values : [];
  return vals.map((v: any) => [String(v[0]), parseFloat(String(v[1]))] as [string, number]).filter((x: [string, number]) => Number.isFinite(x[1]));
}

export interface CompanyResearch {
  ticker: string;
  companyId: string | null;
  marketCapCr: number | null;
  price: number | null;
  pe: number | null;
  /** Full legal name from the page title — the press search uses it. */
  companyName?: string | null;
  /** BSE scrip code from the page's BSE link — the sweep asks BSE for the full filing list with it. */
  bseCode?: string | null;
  announcements: AnnouncementLite[];
  returns: Returns | null;
  lastClose: number | null;
  prevClose: number | null;
  sources: string[];
  errors: string[];
}

export async function fetchCompanyResearch(ticker: string, now = new Date()): Promise<CompanyResearch> {
  const sym = screenerSymbol(ticker);
  const out: CompanyResearch = { ticker, companyId: null, marketCapCr: null, price: null, pe: null, announcements: [], returns: null, lastClose: null, prevClose: null, sources: [], errors: [] };
  const page = await fetchScreenerHtml(`https://www.screener.in/company/${encodeURIComponent(sym)}/`);
  if (!page.html) { out.errors.push(`company page: ${page.error || 'unreachable'}`); return out; }
  out.sources.push('screener.in company page');
  out.companyId = parseCompanyId(page.html);
  out.companyName = companyNameFromPage(page.html);
  out.bseCode = parseBseCode(page.html);
  const tr = parseTopRatios(page.html);
  out.marketCapCr = tr.marketCapCr; out.price = tr.price; out.pe = tr.pe;
  out.announcements = parseAnnouncements(page.html, now);
  if (out.companyId) {
    const ch = await fetchScreenerHtml(`https://www.screener.in/api/company/${out.companyId}/chart/?q=Price&days=365`, 15_000);
    if (ch.html) {
      try {
        const series = parseChart(JSON.parse(ch.html));
        if (series.length) {
          out.returns = returnsFromSeries(series);
          out.lastClose = series[series.length - 1][1];
          out.prevClose = series.length > 1 ? series[series.length - 2][1] : null;
          out.sources.push('screener.in price history');
        }
      } catch (e: any) { out.errors.push(`chart: ${String(e?.message || e)}`); }
    } else out.errors.push(`chart: ${ch.error || 'unreachable'}`);
  }
  return out;
}
