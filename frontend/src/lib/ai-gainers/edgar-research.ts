// ═══════════════════════════════════════════════════════════════════════════
// EDGAR AS THE US FILING SOURCE.                                     (zzz741)
//
// The US side had "no equivalent feed wired yet", so every US gainer was a
// quarterly result or nothing. SEC EDGAR's submissions API lists every
// filing per company with form type, date and — for 8-Ks — the item codes,
// which are a taxonomy already: 1.01 material agreement, 2.01 acquisition,
// 2.02 results, 3.02 unregistered sale (dilution), 5.02 officer change,
// 7.01/8.01 press release. Two fetches per name, no scraping, and the SEC
// asks only for a User-Agent that names the caller.
//
// Prices and trailing returns come from the TradingView export the page
// already reads (1M/3M/6M/1Y columns), so no market-data call is needed.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type { AnnouncementLite } from './catalyst-research';

const UA = 'MarketCockpit research (radhev.232@gmail.com)';
const TICKER_MAP_KEY = 'edgar:ticker-map:v1';

const ITEM_TEXT: Record<string, string> = {
  '1.01': 'Entry into a Material Definitive Agreement', '1.02': 'Termination of a Material Definitive Agreement',
  '2.01': 'Completion of Acquisition or Disposition of Assets', '2.02': 'Results of Operations and Financial Condition',
  '2.03': 'Creation of a Direct Financial Obligation', '2.05': 'Costs Associated with Exit or Disposal Activities',
  '2.06': 'Material Impairments', '3.01': 'Notice of Delisting or Failure to Satisfy a Continued Listing Rule',
  '3.02': 'Unregistered Sales of Equity Securities', '4.01': "Changes in Registrant's Certifying Accountant",
  '4.02': 'Non-Reliance on Previously Issued Financial Statements', '5.02': 'Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers',
  '5.03': 'Amendments to Articles of Incorporation or Bylaws', '5.07': 'Submission of Matters to a Vote of Security Holders',
  '7.01': 'Regulation FD Disclosure', '8.01': 'Other Events', '9.01': 'Financial Statements and Exhibits',
};

async function loadTickerMap(): Promise<Record<string, string>> {
  try {
    const hit = await kvGet<Record<string, string>>(TICKER_MAP_KEY);
    if (hit && Object.keys(hit).length > 1000) return hit;
  } catch { /* fall through */ }
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!r.ok) throw new Error(`SEC ticker map HTTP ${r.status}`);
  const j: any = await r.json();
  const map: Record<string, string> = {};
  for (const k of Object.keys(j || {})) {
    const e = j[k];
    if (e?.ticker && e?.cik_str != null) map[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0');
  }
  try { await kvSet(TICKER_MAP_KEY, map, 7 * 24 * 3600); } catch { /* best effort */ }
  return map;
}

export interface EdgarResearch {
  ticker: string;
  cik: string | null;
  name: string | null;
  announcements: AnnouncementLite[];
  sources: string[];
  errors: string[];
}

/** Filings for the ticker in the last `windowDays`, as announcements. */
export async function fetchEdgarResearch(ticker: string, windowDays: number, now = new Date()): Promise<EdgarResearch> {
  const out: EdgarResearch = { ticker, cik: null, name: null, announcements: [], sources: [], errors: [] };
  let map: Record<string, string>;
  try { map = await loadTickerMap(); } catch (e: any) { out.errors.push(String(e?.message || e)); return out; }
  const cik = map[ticker.toUpperCase().replace(/\..*$/, '')] || null;
  out.cik = cik;
  if (!cik) { out.errors.push('ticker not in the SEC company list'); return out; }
  let sub: any;
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    if (!r.ok) { out.errors.push(`EDGAR submissions HTTP ${r.status}`); return out; }
    sub = await r.json();
  } catch (e: any) { out.errors.push(`EDGAR: ${String(e?.message || e)}`); return out; }
  out.name = sub?.name || null;
  out.sources.push('SEC EDGAR submissions');
  const rec = sub?.filings?.recent || {};
  const n = Array.isArray(rec.form) ? rec.form.length : 0;
  const cikNum = String(parseInt(cik, 10));
  for (let i = 0; i < n; i++) {
    const form = String(rec.form[i] || '');
    const date = String(rec.filingDate[i] || '');
    const age = Math.floor((now.getTime() - Date.parse(date)) / 86_400_000);
    if (!Number.isFinite(age) || age > windowDays) continue;
    // Forms 3/4/144 are insider mechanics and arrive by the dozen; they are
    // not company events and would bury the 8-Ks. SC 13D/G are kept.
    if (/^(3|4|5|144|3\/A|4\/A)$/.test(form)) continue;
    const acc = String(rec.accessionNumber[i] || '').replace(/-/g, '');
    const doc = String(rec.primaryDocument[i] || '');
    const items = String(rec.items[i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    const itemText = items.map((it) => ITEM_TEXT[it] ? `Item ${it} ${ITEM_TEXT[it]}` : `Item ${it}`).join('; ');
    const subject = form.startsWith('8-K') ? `${form}: ${itemText || 'no items listed'}` : `${form}${rec.primaryDocDescription?.[i] ? `: ${rec.primaryDocDescription[i]}` : ''}`;
    out.announcements.push({
      subject,
      summary: null,
      url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${doc}`,
      dateIso: `${date}T00:00:00Z`,
      ageDays: age,
    });
  }
  return out;
}

/** Fetch an EDGAR document as text. For an 8-K the press release usually sits
 *  in EX-99.1 beside the primary document; that is what a reader wants. */
export async function fetchEdgarText(url: string): Promise<string> {
  const dir = url.replace(/\/[^/]+$/, '/');
  let target = url;
  try {
    const r = await fetch(`${dir}index.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (r.ok) {
      const j: any = await r.json();
      const items: any[] = j?.directory?.item || [];
      const ex = items.find((it) => /ex[-_]?99/i.test(String(it?.name || '')) && /\.htm/i.test(String(it?.name || '')));
      if (ex?.name) target = `${dir}${ex.name}`;
    }
  } catch { /* the primary document is still a fine read */ }
  const r = await fetch(target, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!r.ok) return '';
  const html = await r.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60_000);
}
