// ═══════════════════════════════════════════════════════════════════════════
// NEWS CONTEXT FOR A GAINER — SECONDARY EVIDENCE, NEVER THE CATALYST. (zzz773)
//
// Screener.in shows five announcements per company, and it sometimes does not
// answer at all. The owner's complaint: 21 of 43 names came back "source
// failed" and stories that move a stock for days or weeks (a large contract,
// a lock-up expiry, a block deal, a broker initiation, an IPO rally) were
// never seen. This file reads dated press coverage for each gainer and turns
// it into:
//   • the headlines themselves, dated and linked (secondary · unverified);
//   • themes (order win, block deal, lock-up, initiation, results, …);
//   • a RUNNING NARRATIVE when one theme recurs across several days — the
//     kind of story that keeps a stock moving long after the filing.
// It never changes the filing verdict and never supplies a number to NET: a
// news line is where to look, not evidence of what happened.
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuredFacts, SourceRef, EventKind } from './structured-facts';
import { emptyEconomics, emptyTime } from './structured-facts';
import { moneyCr } from './india-extract';

export interface NewsLite { title: string; url: string; published_at: string; source?: string }

export type NewsTheme =
  | 'order_win' | 'results' | 'guidance' | 'block_deal' | 'lockup' | 'ipo_listing' | 'broker_view'
  | 'fundraise' | 'rating' | 'capacity' | 'acquisition' | 'promoter' | 'dividend_action'
  | 'circuit_momentum' | 'sector_theme' | 'regulatory' | 'management' | 'negative';

export const THEME_LABEL: Record<NewsTheme, string> = {
  order_win: 'Order / contract', results: 'Results', guidance: 'Guidance / outlook', block_deal: 'Block / bulk deal',
  lockup: 'Lock-in expiry', ipo_listing: 'IPO / listing', broker_view: 'Broker initiation / target', fundraise: 'Fundraise',
  rating: 'Credit rating', capacity: 'Capacity / plant', acquisition: 'M&A', promoter: 'Promoter / stake',
  dividend_action: 'Dividend / corporate action', circuit_momentum: 'Circuit / momentum', sector_theme: 'Sector theme',
  regulatory: 'Approval / regulatory', management: 'Management', negative: 'Negative',
};

const RULES: Array<[NewsTheme, RegExp]> = [
  ['negative', /\b(gst|tax) (demand|notice|order)|demand notice|show[- ]cause notice|\b(raid|probe|fraud|default|downgrad|resign(s|ed)? as (ceo|md|cfo)|penalty|show[- ]cause|insolven|plunge|slump|crash|tumble|sebi (bans|order))/i],
  ['block_deal', /\bblock deal|bulk deal|change(s)? hands|offload|stake sale|sells? stake|buys? [\d.,]+ (lakh|crore|million)? ?shares/i],
  ['lockup', /lock[- ]?in|lock[- ]?up|anchor (investors?|lock)|shares? unlock/i],
  ['broker_view', /\b(initiat\w+ coverage|target price|price target|\btarget (of )?₹|\bbuy rating|overweight|brokerage|motilal|jefferies|hsbc|kotak inst|nomura|jm financial|nuvama|axis securities|icici securities)/i],
  ['order_win', /\b(order|contract|letter of award|\bLoA\b|work order|bags|wins?|secures?|bagged|awarded)\b.*(₹|rs\.?|crore|cr\b|mn\b|million|billion|order|contract)|order (book|inflow|win)/i],
  ['results', /\b(q[1-4]\s*(fy)?\d{2}|quarter(ly)? results?|net profit|pat (up|rises|jumps)|revenue (up|rises|jumps|grows)|earnings)\b/i],
  ['guidance', /\b(guidance|outlook|targets? (revenue|growth)|expects? (revenue|growth)|revenue target|fy2?\d guidance)\b/i],
  ['ipo_listing', /\b(ipo|listing|lists? at|debut|listing gains?|post[- ]listing|sme ipo|grey market|gmp)\b/i],
  ['fundraise', /\b(qip|preferential (issue|allotment)|rights issue|fund ?rais|raises? ₹|warrants?|ncds?|debentures?)\b/i],
  ['rating', /\b(crisil|icra|care ratings|india ratings|acuite|infomerics|brickwork|credit rating|rating (upgrade|reaffirm)|[abc][+-]? rating)\b/i],
  ['capacity', /\b(capacity|plant|facility|commission\w*|capex|expansion|greenfield|brownfield|mtpa|gw\b|mw\b)\b/i],
  ['acquisition', /\b(acquir\w+|acquisition|merger|amalgamation|takeover|open offer|demerger|stake in)\b/i],
  ['promoter', /\b(promoter (buys|increases|hikes|raises)|creeping acquisition|insider buying|stake (hike|increase))\b/i],
  ['dividend_action', /\b(dividend|bonus|stock split|split|record date|buyback|agm)\b/i],
  ['regulatory', /\b(usfda|approval|approved by|eir|license|licence|patent|clearance|nod)\b/i],
  ['management', /\b(appoint\w*|ceo|cfo|managing director|chairman|joins as)\b/i],
  ['circuit_momentum', /\b(upper circuit|52[- ]week high|record high|hits? high|rall(y|ies)|surges?|zooms?|soars?|jumps?|multibagger|skyrocket)\b/i],
  ['sector_theme', /\b(ai\b|data cent(er|re)s?|defen[cs]e|railway|semiconductor|ev\b|electric vehicle|renewable|solar|green hydrogen|power (sector|demand)|pharma|capital goods|psu)\b/i],
];

/** Generic market-data spam that names the stock but carries no event. */
const JUNK = /latest shareholding|share price (today|live)|stock price (today|live)|session: finishes|level watch|technical (analysis|view)|stocks? to (watch|buy)|top (gainers|losers)|shares? of .* trade|market (live|update|wrap)|sensex|nifty (ends|closes|opens)|intraday|tracxn|marketscreener|investing\.com|moneycontrol quote|stock analysis|peer context/i;

export function themesOf(title: string): NewsTheme[] {
  const out: NewsTheme[] = [];
  for (const [t, rx] of RULES) if (rx.test(title)) out.push(t);
  return out;
}

/** Tokens that must appear in a headline for it to be about THIS company. */
export function nameTokens(ticker: string, company: string | null): string[] {
  const stop = new Set(['ltd', 'limited', 'india', 'the', 'and', 'of', 'co', 'company', 'corporation', 'industries', 'inds', 'ind', 'solutions', 'technologies', 'tech', 'services', 'global', 'international', 'enterprises', 'group', 'holdings', 'private', 'pvt', 'systems']);
  const words = String(company || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
  const t = /^\d+$/.test(ticker) ? [] : [ticker.toLowerCase()];
  return Array.from(new Set([...words.slice(0, 2), ...t]));
}

export interface NewsContext {
  items: Array<{ title: string; url: string; date: string; source: string; themes: NewsTheme[];
    /** zzz785: always true — press is secondary until an official filing confirms it. */
    secondary?: boolean;
    /** zzz785: the official filing that states the same event, when one was read. */
    confirmedBy?: { url: string | null; date: string | null; title: string } | null }>;
  themes: Array<{ theme: NewsTheme; label: string; count: number; firstDate: string; lastDate: string }>;
  /** A theme covered on ≥2 different days within the window — a story that keeps running. */
  narrative: { theme: NewsTheme; label: string; count: number; days: number; firstDate: string; lastDate: string; lead: string } | null;
  windowDays: number;
  fetched: number;
  query: string;
}

export function buildNewsContext(raw: NewsLite[], opts: { ticker: string; company: string | null; now: Date; windowDays?: number; query?: string }): NewsContext {
  const windowDays = opts.windowDays ?? 45;
  const cutoff = opts.now.getTime() - windowDays * 86_400_000;
  const toks = nameTokens(opts.ticker, opts.company);
  const seen = new Set<string>();
  const items: NewsContext['items'] = [];
  const nameWords = String(opts.company || '').replace(/\b(ltd|limited)\b\.?/gi, '').replace(/[^A-Za-z0-9& ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const nameRx = nameWords.length ? new RegExp(`\\b(${nameWords.map((w) => w.replace(/[&]/g, '\\&')).join('|')})\\b`, 'gi') : null;
  for (const n of raw) {
    const t = Date.parse(n.published_at);
    if (!Number.isFinite(t) || t < cutoff || t > opts.now.getTime() + 86_400_000) continue;
    // Google News appends " - Publisher"; the publisher is the source.
    const m = /^(.*?)(?:\s+-\s+([^-]{2,60}))?$/.exec(n.title.trim());
    const title = (m?.[1] || n.title).trim();
    const source = (m?.[2] || n.source || '').trim();
    const low = title.toLowerCase();
    if (JUNK.test(n.title)) continue;
    if (toks.length && !toks.some((k) => low.includes(k))) continue;
    const key = low.replace(/[^a-z0-9]/g, '').slice(0, 70);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Theme on the headline with the company's own name removed: "Kavveri
    // Defence … falls 8%" is not defence-sector news.
    const bare = nameRx ? title.replace(nameRx, ' ') : title;
    items.push({ title: title.slice(0, 180), url: n.url, date: new Date(t).toISOString().slice(0, 10), source, themes: themesOf(bare) });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  const by = new Map<NewsTheme, { n: number; dates: Set<string>; first: string; last: string; lead: string }>();
  for (const it of items) for (const th of it.themes) {
    const e = by.get(th) || { n: 0, dates: new Set<string>(), first: it.date, last: it.date, lead: it.title };
    e.n++; e.dates.add(it.date);
    if (it.date < e.first) e.first = it.date;
    if (it.date > e.last) { e.last = it.date; e.lead = it.title; }
    by.set(th, e);
  }
  const themes = Array.from(by.entries()).map(([theme, e]) => ({ theme, label: THEME_LABEL[theme], count: e.n, firstDate: e.first, lastDate: e.last }))
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  // Momentum commentary is not a story in itself; a sector word alone is not
  // company news. Either can still be the narrative when nothing else recurs.
  const weak = new Set<NewsTheme>(['circuit_momentum', 'sector_theme', 'management', 'dividend_action']);
  const cands = Array.from(by.entries()).filter(([, e]) => e.dates.size >= 2)
    .sort(([ta, a], [tb, b]) => Number(weak.has(ta)) - Number(weak.has(tb)) || b.dates.size - a.dates.size || b.last.localeCompare(a.last) || b.n - a.n);
  const top = cands[0];
  const narrative = top ? { theme: top[0], label: THEME_LABEL[top[0]], count: top[1].n, days: top[1].dates.size, firstDate: top[1].first, lastDate: top[1].last, lead: top[1].lead } : null;
  return { items: items.slice(0, 6), themes: themes.slice(0, 6), narrative, windowDays, fetched: raw.length, query: opts.query || '' };
}

/** The full legal name from a screener.in company page title. */
export function companyNameFromPage(html: string): string | null {
  const m = /<title>\s*([^<|]+?)\s+share price/i.exec(html) || /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i.exec(html);
  return m ? m[1].replace(/&amp;/g, '&').trim() : null;
}

// ── zzz785: PRESS AS STRUCTURED FACTS — SECONDARY, VERIFICATION REQUIRED ────

const THEME_KIND: Partial<Record<NewsTheme, EventKind>> = {
  order_win: 'order', fundraise: 'fundraising', capacity: 'capacity', acquisition: 'acquisition', regulatory: 'qualification',
  results: 'results', guidance: 'guidance', rating: 'other', promoter: 'stake_by_strategic',
};

export interface PressFacts extends StructuredFacts {
  polarity: 'positive' | 'negative' | 'neutral';
  headline: string;
  secondary: true;
  confirmedBy: { url: string | null; date: string | null; title: string } | null;
}

const tok = (s: string | null | undefined) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !/^(limited|india|indian|order|orders|crore|leading|private|company)$/.test(w)));
const days = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.abs(Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86_400_000 : Infinity);

/** Each dated headline that names an event, as a SECONDARY fact. When a read
 *  official filing states the same event (same kind and the same value,
 *  counterparty or date ±3 days), the press item is marked confirmed-by it. */
export function pressFacts(news: NewsContext, issuer: string, official: StructuredFacts[]): { facts: PressFacts[]; refs: SourceRef[]; news: NewsContext } {
  const out: PressFacts[] = [];
  const refs: SourceRef[] = [];
  const offs = official.filter((f) => f.source.kind !== 'PRESS');
  const items = news.items.map((it) => {
    const negTax = it.themes.includes('negative') && /\b(gst|tax|demand|show[- ]cause)\b/i.test(it.title);
    const theme = it.themes.find((t) => THEME_KIND[t]) || (negTax ? 'negative' : null);
    const newSub = /\bincorporat\w*[^.]{0,40}subsidiary|subsidiary[^.]{0,40}incorporat/i.test(it.title);
    const kind: EventKind | null = negTax ? 'tax_litigation' : newSub ? 'other' : theme === 'negative' ? 'regulatory_negative' : theme ? THEME_KIND[theme]! : null;
    const value = moneyCr(it.title);
    let confirmedBy: PressFacts['confirmedBy'] = null;
    if (kind) {
      const mine = tok(it.title);
      const hit = offs.find((f) => {
        if (f.event.kind !== kind) return false;
        const fv = f.economics.valueNative ?? f.economics.considerationNative ?? f.economics.capex;
        if (value != null && fv != null) return Math.abs(value - fv) <= Math.max(0.05, fv * 0.02);
        const cp = tok(`${f.event.counterparty || ''} ${f.event.product || ''}`);
        if (Array.from(cp).some((w) => mine.has(w))) return true;
        return days(f.source.date, it.date) <= 3;
      });
      if (hit) confirmedBy = { url: hit.source.url ?? null, date: hit.source.date, title: hit.source.title };
    }
    const src: SourceRef = { kind: 'PRESS', access: 'SUMMARY_ONLY', issuer, date: it.date, url: it.url, title: `${it.title}${it.source ? ` — ${it.source}` : ''}`.slice(0, 160) };
    refs.push(src);
    if (kind && out.length < 6) {
      const economics = emptyEconomics();
      if (value != null) { economics.valueNative = value; economics.currency = 'INR_CR'; }
      out.push({
        source: src, event: { kind, counterparty: null, product: null, geography: null, stage: null }, economics, time: emptyTime(),
        quotes: [], unknowns: ['Press report — not verified against an official filing.', ...(confirmedBy ? [] : ['No official filing read that states the same event.'])],
        verificationRequired: true, polarity: kind === 'tax_litigation' || kind === 'regulatory_negative' ? 'negative' : ['order', 'capacity', 'qualification', 'acquisition', 'partnership', 'stake_by_strategic'].includes(kind) ? 'positive' : 'neutral',
        headline: it.title, secondary: true, confirmedBy,
      });
    }
    return { ...it, secondary: true, confirmedBy };
  });
  return { facts: out, refs, news: { ...news, items } };
}
