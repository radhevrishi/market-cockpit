// ═══════════════════════════════════════════════════════════════════════════
// US CARD — THE SEC-FIRST DOCUMENT READ (server only, no model).     (zzz798)
//
// For one US gainer: rank its SEC filings (8-K with EX-99.1 > 8-K > 6-K >
// deal / periodic / offering forms, the last ~10 days first), open the best
// one — the 8-K body, every EX-99 exhibit (whatever it is named: "ex99-1",
// "naveris-pressrelease", "...pressrel", a pro forma exhibit, a scheme
// booklet), the 8-K an 8-K/A amends, and for a 10-Q / 10-K the strict XBRL
// quarter — and build the card (us-card.ts). With no SEC event document in
// the window it builds a PRESS-ONLY card that says so.
//
// SEC fair access: every request goes through edgar-research's throttled,
// User-Agent-carrying fetch (≤10/s, retry on 429/5xx) and its caches.
// Bounded by the caller's deadline; never throws.
// ═══════════════════════════════════════════════════════════════════════════

import { strictFigures, type StrictFigures } from '@/lib/us-thesis/xbrl';
import { secRawHtml, secJson, secDocText, htmlToText, type EdgarResearch, type UsRecentFiling } from './edgar-research';
import { buildUsCard, rankUsFilings, decodeHtmlText, type UsCard, type UsCardDoc } from './us-card';
import { secDocRoleOf } from './sec-routing';
import { usFormOf, usItemsOf } from './us-gainers';

const XBRL_TTL_MS = 6 * 3600_000;
const xbrlMemo = new Map<string, { at: number; s: StrictFigures | null }>();

/** Strict XBRL figures for a CIK, memoised per process (6 h). */
async function strictFor(cik: string, timeoutMs: number): Promise<StrictFigures | null> {
  const hit = xbrlMemo.get(cik);
  if (hit && Date.now() - hit.at < XBRL_TTL_MS) return hit.s;
  const facts = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`, timeoutMs);
  const s = facts ? strictFigures(facts) : null;
  if (xbrlMemo.size > 200) xbrlMemo.delete(xbrlMemo.keys().next().value as string);
  xbrlMemo.set(cik, { at: Date.now(), s });
  return s;
}

/** Role of one file in a filing directory. */
export function usDocRole(name: string, primaryName: string | null, size: number): string | null {
  const n = String(name || '').toLowerCase();
  if (!/\.htm/.test(n) || /index|^r\d+\.htm/.test(n)) return null;
  if (primaryName && n === primaryName.toLowerCase()) return 'primary';
  if (/pro[-_ ]?forma/.test(n)) return 'proforma';
  if (/press[-_ ]?rel|pressrelease|release/.test(n)) return 'ex99';
  const r = secDocRoleOf(name, primaryName);
  if (r === 'ex99') return /99[-_ .]?0?1(?!\d)/.test(n) ? (size > 1_500_000 ? 'booklet' : 'ex99') : 'ex992';
  if (r === 'ex10') return null;
  // other exhibit-like documents of a filing (financial statements of an acquired business, etc.)
  if (/financ|statement|consent/.test(n)) return /consent/.test(n) ? null : 'other';
  return null;
}

async function readFiling(url: string, left: () => number, opts: { earnings: boolean; maxDocs?: number }): Promise<UsCardDoc[]> {
  const dir = url.replace(/\/[^/]+$/, '/');
  const primaryName = /-index\.htm$/i.test(url) ? null : url.split('/').pop() || null;
  const idx = await secJson<any>(`${dir}index.json`, Math.max(1_500, Math.min(6_000, left())));
  const items: any[] = idx?.directory?.item || [];
  const want: Array<{ role: string; url: string; size: number }> = [];
  for (const it of items) {
    const size = Number(it?.size || 0);
    const role = usDocRole(String(it?.name || ''), primaryName, size);
    if (role) want.push({ role, url: `${dir}${it.name}`, size });
  }
  if (!want.some((w) => w.role === 'primary') && primaryName) want.unshift({ role: 'primary', url, size: 0 });
  // zzz801: an index URL names no primary document — the 8-K body is the
  // "…8k.htm" / "form8-k.htm" file of the directory (its Item text is read).
  if (!want.some((w) => w.role === 'primary') && !primaryName) {
    const body = items.find((it) => /(?:^|[-_.d])(?:form)?8-?k(?:a)?\.htm$/i.test(String(it?.name || '')));
    if (body) want.unshift({ role: 'primary', url: `${dir}${body.name}`, size: Number(body.size || 0) });
  }
  const order: Record<string, number> = { primary: 0, ex99: 1, ex992: 2, proforma: 3, booklet: 4, other: 5 };
  want.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  const out: UsCardDoc[] = [];
  for (const w of want.slice(0, opts.maxDocs ?? 5)) {
    if (left() < 1_500) break;
    const t = Math.max(1_500, Math.min(w.size > 1_500_000 ? 9_000 : 6_000, left()));
    if (w.role === 'booklet' || w.size > 400_000 || (opts.earnings && w.role === 'ex99')) {
      // big documents: raw HTML — a long booklet is read whole (the terms sit
      // deep in it), an earnings release keeps its tables.
      const html = await secRawHtml(w.url, t);
      if (!html) continue;
      const text = w.role === 'booklet' || w.size > 400_000 ? decodeHtmlText(html).slice(0, 2_000_000) : htmlToText(html);
      out.push({ role: w.role, url: w.url, text, html: opts.earnings && w.role === 'ex99' ? html : null, name: w.url.split('/').pop() || null });
    } else {
      const text = await secDocText(w.url, t);
      if (text) out.push({ role: w.role, url: w.url, text, name: w.url.split('/').pop() || null });
    }
  }
  return out;
}

/** The 8-K an 8-K/A amends: the filing whose date the amendment names, else
 *  the latest 8-K before it with an overlapping item. */
export function originalOf(amend: { date: string | null; items: string[]; text: string }, recent: UsRecentFiling[]): UsRecentFiling | null {
  const named = /\bOn\s+([A-Z][a-z]+ \d{1,2}, \d{4}),[^.]{0,160}\bfiled (?:a|its) Current Report on Form 8-K/.exec(amend.text);
  const namedIso = named ? (() => { const d = Date.parse(`${named[1]} 00:00:00 UTC`); return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null; })() : null;
  const before = recent.filter((r) => r.form === '8-K' && (!amend.date || r.date <= amend.date.slice(0, 10)));
  if (namedIso) { const hit = before.find((r) => r.date === namedIso); if (hit) return hit; }
  return before.find((r) => r.items.some((i) => amend.items.includes(i) && i !== '9.01')) || null;
}

export interface UsCardFetchInput {
  ticker: string;
  company: string | null;
  marketCapM: number | null;
  listing: Pick<EdgarResearch, 'cik' | 'announcements' | 'recentFilings' | 'failure' | 'press'> | null;
  /** Press items already fetched for the name (news context / press fallback). */
  press?: Array<{ title: string; url: string; date: string | null; source: string | null }>;
  now: Date;
  deadlineMs: number;
  windowDays?: number;
}

/** Build the US card for one name. Null when there is nothing to read. */
export async function fetchUsCard(inp: UsCardFetchInput): Promise<UsCard | null> {
  const t0 = Date.now();
  const left = () => inp.deadlineMs - (Date.now() - t0);
  try {
    const l = inp.listing;
    const recent = l?.recentFilings || [];
    const latest = recent[0] ? { form: recent[0].form, date: recent[0].date, items: recent[0].items.filter((i) => i !== '9.01') } : null;
    const ranked = l ? rankUsFilings(l.announcements.filter((a) => /^https:\/\/www\.sec\.gov\//.test(a.url)), inp.now) : [];
    for (const cand of ranked.slice(0, 2)) {
      if (left() < 3_000) break;
      const form = usFormOf(cand.subject);
      const items = usItemsOf(cand.subject);
      const earnings = items.includes('2.02') || /^(10-Q|10-K|20-F|40-F|6-K)/.test(form);
      const docs = await readFiling(cand.url, left, { earnings, maxDocs: /^6-K/.test(form) ? 4 : 5 });
      if (!docs.length) continue;
      let original: { form: string; date: string | null; url: string; docs: UsCardDoc[] } | null = null;
      if (/^8-K\/A$/.test(form) && left() > 4_000) {
        const o = originalOf({ date: cand.dateIso, items, text: docs.map((d) => d.text).join(' ') }, recent);
        if (o) { const od = await readFiling(o.url, left, { earnings: false, maxDocs: 3 }); if (od.length) original = { form: o.form, date: o.date, url: o.url, docs: od }; }
      }
      let xbrl: StrictFigures | null = null;
      if (l?.cik && left() > 4_000 && /^(10-Q|10-K)/.test(form)) xbrl = await strictFor(l.cik, Math.min(9_000, left() - 1_000));
      const card = buildUsCard({
        ticker: inp.ticker, company: inp.company, marketCapM: inp.marketCapM,
        filing: { form, items, date: cand.dateIso, url: cand.url, subject: cand.subject }, docs, original, xbrl,
        latestSec: latest, secChecked: !l?.failure, windowDays: inp.windowDays,
      });
      if (card) return card;
    }
    // No SEC event document read → press only (said plainly).
    const press = [...(inp.press || []), ...((l?.press?.items || []).map((p: any) => ({ title: String(p.title || ''), url: String(p.url || ''), date: p.date ?? null, source: p.source ?? null })))];
    if (!press.length) return null;
    return buildUsCard({ ticker: inp.ticker, company: inp.company, marketCapM: inp.marketCapM, filing: null, docs: [], press, latestSec: latest, secChecked: !!l && !l.failure, windowDays: inp.windowDays });
  } catch { return null; }
}
