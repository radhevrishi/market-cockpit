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
import { yahooChart } from '@/lib/us-prices';
import { fetchCorporateAnnouncements } from '@/lib/nse';

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
  /** zzz785: screener.in (a secondary aggregator) failed after one retry.
   *  The caller reads the exchanges directly; this is "secondary source
   *  unavailable", never "source unavailable". */
  secondaryUnavailable?: string | null;
}

/** zzz776: Yahoo daily closes → returns, for a re-score whose stored inputs
 *  have no price history (the screener.in chart failed on the first pass). */
export async function yahooReturns(ticker: string): Promise<{ returns: Returns; lastClose: number; source: string } | null> {
  const out = { returns: null, lastClose: null, prevClose: null, sources: [] as string[], errors: [] as string[], bseCode: null } as unknown as CompanyResearch;
  await yahooFallback(out, screenerSymbol(ticker));
  return out.returns && out.lastClose != null ? { returns: out.returns, lastClose: out.lastClose, source: out.sources[out.sources.length - 1] } : null;
}

async function yahooFallback(out: CompanyResearch, sym: string): Promise<void> {
  // zzz775: screener.in's chart is the first choice, not the only one. When
  // it fails, the NSE (.NS) or BSE (.BO) daily closes stand in, so 1W/1M/3M
  // and the reaction to the filing are measured instead of printed "—".
  if (out.returns) return;
  {
    const tries = [`${sym}.NS`, out.bseCode ? `${out.bseCode}.BO` : null, /^\d{6}$/.test(sym) ? `${sym}.BO` : null].filter((x): x is string => !!x);
    for (const y of tries) {
      try {
        const bars = await Promise.race([yahooChart(y, '1y'), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);
        if (bars && bars.close.length > 20) {
          const series = bars.dates.map((d, k) => [d, bars.close[k]] as [string, number]);
          out.returns = returnsFromSeries(series);
          out.lastClose = series[series.length - 1][1];
          out.prevClose = series.length > 1 ? series[series.length - 2][1] : null;
          out.sources.push(`price history (Yahoo ${y})`);
          out.errors = out.errors.filter((e) => !/^chart:/.test(e));
          break;
        }
      } catch { /* next */ }
    }
  }
}

export async function fetchCompanyResearch(ticker: string, now = new Date()): Promise<CompanyResearch> {
  const sym = screenerSymbol(ticker);
  const out: CompanyResearch = { ticker, companyId: null, marketCapCr: null, price: null, pe: null, announcements: [], returns: null, lastClose: null, prevClose: null, sources: [], errors: [] };
  let page = await fetchScreenerHtml(`https://www.screener.in/company/${encodeURIComponent(sym)}/`);
  // zzz785: one retry with a short backoff — screener.in drops ~1 request in
  // 2 through the proxy chain, and the second try usually answers.
  if (!page.html) {
    await new Promise((r) => setTimeout(r, 1_200));
    const again = await fetchScreenerHtml(`https://www.screener.in/company/${encodeURIComponent(sym)}/`);
    if (again.html) page = again;
  }
  if (!page.html) {
    out.secondaryUnavailable = `screener.in company page (${String(page.error || 'unreachable').split(/[.;\n]/)[0].slice(0, 80)})`; out.errors.push(`company page: ${page.error || 'unreachable'}`); await yahooFallback(out, sym); out.sources = out.sources.filter((x) => !/^price history/.test(x)); return out; }
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
  await yahooFallback(out, sym);
  return out;
}

// ── zzz785: NSE's own announcement list — the fallback when screener.in and
// BSE both fail. Public, per symbol, through the shared resilient NSE fetch.

const NSE_MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** "24-Sep-2026 17:52:39" (IST) → ISO with the +05:30 zone. */
export function nseDateIso(raw: string | null | undefined): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(raw || '').trim());
  if (!m) return null;
  const mo = NSE_MON[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${mo}-${m[1].padStart(2, '0')}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}+05:30`;
}

/** NSE rows → AnnouncementLite. Pure (tested with a captured payload shape). */
export function parseNseAnnouncements(rows: any[], days: number, now = new Date()): AnnouncementLite[] {
  const cutoff = now.getTime() - days * 86_400_000;
  const out: AnnouncementLite[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const subject = String(r?.desc || r?.subject || '').trim();
    const dateIso = nseDateIso(r?.an_dt || r?.sort_date || r?.dt);
    const url = String(r?.attchmntFile || '').trim();
    if (!subject || !url) continue;
    if (dateIso && Date.parse(dateIso) < cutoff) continue;
    const text = String(r?.attchmntText || '').replace(/\s+/g, ' ').trim();
    out.push({ subject, summary: text && text.toLowerCase() !== subject.toLowerCase() ? text.slice(0, 600) : null, url, dateIso, ageDays: dateIso ? Math.max(0, Math.floor((now.getTime() - Date.parse(dateIso)) / 86_400_000)) : null });
  }
  return out;
}

export async function fetchNseAnnouncementsLite(ticker: string, days = 22, now = new Date()): Promise<{ items: AnnouncementLite[]; error: string | null }> {
  if (/^\d{6}$/.test(ticker)) return { items: [], error: 'BSE-only scrip — not on NSE' };
  try {
    const j = await Promise.race([fetchCorporateAnnouncements(ticker), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]);
    const rows = Array.isArray(j) ? j : Array.isArray((j as any)?.data) ? (j as any).data : null;
    if (!rows) return { items: [], error: 'NSE announcements unavailable' };
    return { items: parseNseAnnouncements(rows, days, now), error: null };
  } catch (e: any) { return { items: [], error: `NSE: ${String(e?.message || e).slice(0, 80)}` }; }
}
