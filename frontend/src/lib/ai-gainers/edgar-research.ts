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
//
// zzz766 — SEC FAIR ACCESS AND A BOUNDED CLOCK.
//   · Every request carries the declared User-Agent and is spaced ≥ 125 ms
//     apart in this process (the SEC ceiling is 10 requests/second).
//   · The 800 KB ticker map is memoised in memory for a day. It was read from
//     KV per name and, when KV was unavailable (the Upstash quota incident),
//     re-downloaded from sec.gov for EVERY name on the board.
//   · Timeouts are passed in, so the research route can keep a sweep inside
//     its 60 s function limit (a 20 s + 20 s + model-read chain overran it and
//     the proxy answered "upstream error" — not JSON — to the page).
//   · The submissions → announcements mapping is pure and lives in
//     us-gainers.ts, where it is tested against captured EDGAR JSON.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import { classifyAnnouncement, type AnnouncementLite, type ClassifiedAnnouncement, type SweepInput } from './catalyst-research';
import {
  announcementsFromSubmissions, secTickerCandidates, extractUsPressRelease, usPlainSubject, usFormOf, usItemsOf,
  submissionsFromAtom, submissionsFromFullText, STRATEGIC_STAKE_MARKER, insiderFilingsFromSubmissions, type InsiderFilingLite,
} from './us-gainers';
import { isKnownCatalyst } from './events';
import type { SourceRef, StructuredFacts } from './structured-facts';
import {
  withRetry, retryableStatus, routeWithFallback, describeRouting, secSourceRef, sourceRefFromAnnouncement, pressSourceRef,
  secDocRoleOf, cikFromUrl, DocumentLedger, dedupeSources, parseNasdaqPress, parseRssItems, isOfficial,
  type Routed, type RouteAttempt, type SecDocRole, type UsPressItem,
} from './sec-routing';
import { extractUsFacts, mergeUsFacts, extractUsPressFacts, describeUsFact, separateOfficialAndPress, sameEvent, type UsStructuredFacts } from './us-extract';

const UA = 'MarketCockpit research (radhev.232@gmail.com)';
const TICKER_MAP_KEY = 'edgar:ticker-map:v1';
const MIN_SPACING_MS = 125;
const MAP_MEMO_MS = 24 * 3600_000;

let lastSecCall = 0;
let mapMemo: { at: number; map: Record<string, string>; live?: boolean } | null = null;
/** zzz782: a ticker missing from a cached map (a KV copy up to 7 days old)
 *  forces ONE live re-download per process per hour — a recent listing is
 *  otherwise "not in the SEC company list" for a week. */
const MAP_MISS_REFRESH_MS = 3600_000;
let lastMissRefresh = 0;

async function secFetch(url: string, timeoutMs: number): Promise<Response> {
  const wait = lastSecCall + MIN_SPACING_MS - Date.now();
  lastSecCall = Math.max(Date.now(), lastSecCall + MIN_SPACING_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate', Accept: 'application/json, text/html;q=0.9, */*;q=0.5' },
    // zzz798: AbortSignal.timeout takes a whole number of ms — "usLeft() / 3"
    // was a fraction and threw "The value of "delay" is out of range".
    signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))), cache: 'no-store',
  });
}

/** zzz785: SEC fetch with back-off on 429 / 403 / 5xx / network errors
 *  (0.4 s, 1.2 s), never sleeping past the caller's budget. A 404 is an
 *  answer, not a retry. */
async function secFetchRetry(url: string, timeoutMs: number, retries = 2): Promise<Response> {
  const deadline = Date.now() + timeoutMs + 1_500;
  return withRetry((attempt) => secFetch(url, attempt ? Math.max(2_000, Math.min(timeoutMs, deadline - Date.now())) : timeoutMs), {
    retries, baseMs: 400, deadlineMs: deadline, retryOn: (r) => retryableStatus(r.status),
  });
}

function secError(what: string, status: number): string {
  if (status === 429 || status === 403) return `${what}: SEC rate-limited or refused the request (HTTP ${status}) — retry later`;
  return `${what} HTTP ${status}`;
}

async function loadTickerMap(timeoutMs: number, forceLive = false): Promise<Record<string, string>> {
  if (!forceLive && mapMemo && Date.now() - mapMemo.at < MAP_MEMO_MS) return mapMemo.map;
  if (!forceLive) {
    try {
      const hit = await kvGet<Record<string, string>>(TICKER_MAP_KEY);
      if (hit && Object.keys(hit).length > 1000) { mapMemo = { at: Date.now(), map: hit }; return hit; }
    } catch { /* fall through */ }
  }
  const r = await secFetchRetry('https://www.sec.gov/files/company_tickers.json', Math.max(timeoutMs, 8_000), 1);
  if (!r.ok) throw new Error(secError('SEC ticker map', r.status));
  const j: any = await r.json();
  const map: Record<string, string> = {};
  for (const k of Object.keys(j || {})) {
    const e = j[k];
    if (e?.ticker && e?.cik_str != null) map[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0');
  }
  mapMemo = { at: Date.now(), map, live: true };
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
  /** zzz782: why nothing came back, so "not checked" is never shown as
   *  "checked, nothing filed". */
  failure?: 'cik_not_found' | 'ticker_map_failed' | 'submissions_failed' | null;
  /** Filings of any form in the window, and how many were insider Forms 3/4/5/144 (not listed). */
  filingsInWindow?: number;
  insiderForms?: number;
  // ── zzz785 (all optional; older callers ignore them) ──
  /** One SourceRef per listed filing (SUMMARY_ONLY) and per document read
   *  (DOCUMENT_READ), hierarchy order, duplicates removed. */
  sourceRefs?: SourceRef[];
  /** Facts read from documents opened during the listing (13D / 13G
   *  ownership reports). Candidate 8-Ks are read by readUsFilingDocument. */
  facts?: StructuredFacts[];
  /** Which route produced the filing list (submissions JSON → Atom feed →
   *  full-text search), and one plain line about it. */
  listingRoute?: { from: string | null; status: Routed<unknown>['status']; attempts: RouteAttempt[] };
  routingNote?: string | null;
  /** Secondary (press / IR) items, fetched only when every SEC route failed
   *  and `pressFallback` allowed it. Never counted as a filing. */
  press?: UsPressFallback | null;
  /** zzz798: the company's non-insider filings of the last ~200 days (from the
   *  submissions list) — how an 8-K/A finds the 8-K it amends, and what the
   *  "latest SEC filing" is on a press-only card. */
  recentFilings?: UsRecentFiling[];
  /** zzz1059: insider Forms 4 / 144 in the window (counted in `insiderForms`, not listed as announcements). */
  insiderFilings?: InsiderFilingLite[];
}
export interface UsRecentFiling { form: string; date: string; items: string[]; url: string }

/** Filings for the ticker in the last `windowDays`, as announcements. */
export async function fetchEdgarResearch(ticker: string, windowDays: number, now = new Date(), opts: { timeoutMs?: number; readOwnership?: boolean; pressFallback?: boolean; company?: string | null } = {}): Promise<EdgarResearch> {
  const timeoutMs = Math.max(2_000, Math.min(20_000, opts.timeoutMs ?? 12_000));
  const out: EdgarResearch = { ticker, cik: null, name: null, announcements: [], sources: [], errors: [] };
  let map: Record<string, string>;
  try { map = await loadTickerMap(timeoutMs); } catch (e: any) { out.errors.push(String(e?.message || e)); out.failure = 'ticker_map_failed'; return out; }
  let cik = secTickerCandidates(ticker).map((t) => map[t]).find(Boolean) || null;
  if (!cik && !mapMemo?.live && Date.now() - lastMissRefresh > MAP_MISS_REFRESH_MS) {
    lastMissRefresh = Date.now();
    try { map = await loadTickerMap(timeoutMs, true); cik = secTickerCandidates(ticker).map((t) => map[t]).find(Boolean) || null; } catch { /* keep the cached answer */ }
  }
  out.cik = cik;
  if (!cik) { out.errors.push('ticker not in the SEC company list'); out.failure = 'cik_not_found'; return out; }

  // zzz785: the filing list, with fallback routes. Each is SEC (primary).
  const from = new Date(now.getTime() - (windowDays + 1) * 86_400_000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const routed = await routeWithFallback<{ sub: any; label: string }>([
    { name: 'SEC EDGAR submissions', tier: 'primary', run: async () => {
      const r = await secFetchRetry(`https://data.sec.gov/submissions/CIK${cik}.json`, timeoutMs);
      if (!r.ok) throw new Error(secError('EDGAR submissions', r.status));
      return { sub: await r.json(), label: 'SEC EDGAR submissions' };
    } },
    { name: 'SEC EDGAR company feed', tier: 'primary', run: async () => {
      const r = await secFetchRetry(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40&output=atom`, Math.min(timeoutMs, 8_000), 1);
      if (!r.ok) throw new Error(secError('EDGAR company feed', r.status));
      const sub = submissionsFromAtom(await r.text());
      return sub.filings.recent.form.length ? { sub, label: 'SEC EDGAR company feed' } : null;
    } },
    { name: 'SEC EDGAR full-text search', tier: 'primary', run: async () => {
      // Every 8-K cover page since 2019 prints the trading symbol.
      const r = await secFetchRetry(`https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&ciks=${cik}&dateRange=custom&startdt=${from}&enddt=${to}`, Math.min(timeoutMs, 8_000), 1);
      if (!r.ok) throw new Error(secError('EDGAR full-text search', r.status));
      const sub = submissionsFromFullText(await r.json());
      return sub.filings.recent.form.length ? { sub, label: 'SEC EDGAR full-text search' } : null;
    } },
  ]);
  out.listingRoute = { from: routed.from, status: routed.status, attempts: routed.attempts };
  if (!routed.value) {
    for (const a of routed.attempts) out.errors.push(a.name === 'SEC EDGAR submissions' ? (a.error || 'EDGAR submissions failed') : `${a.name}: ${a.error || 'failed'}`);
    out.failure = 'submissions_failed';
    out.routingNote = describeRouting(routed, 'SEC filings');
    if (opts.pressFallback) {
      out.press = await fetchUsPressFallback(ticker, opts.company ?? null, { timeoutMs: Math.min(timeoutMs, 6_000), now });
      out.sourceRefs = out.press.sources;
      out.facts = out.press.facts;
    }
    return out;
  }
  if (routed.attempts.some((a) => !a.ok)) out.routingNote = describeRouting(routed, 'SEC filings');
  const sub = routed.value.sub;
  out.name = sub?.name || null;
  out.sources.push(routed.value.label);
  const stats = { insiderForms: 0, inWindow: 0 };
  out.announcements = announcementsFromSubmissions(sub, cik, windowDays, now, stats);
  out.recentFilings = recentFilingsOf(sub, cik, now);
  out.insiderFilings = insiderFilingsFromSubmissions(sub, cik, windowDays, now);
  out.filingsInWindow = stats.inWindow;
  out.insiderForms = stats.insiderForms;
  const refs = out.announcements.map((a) => sourceRefFromAnnouncement(ticker, a));

  // zzz785: an ownership report is opened, not judged by its form: Amazon's
  // 13G on BETA is a strategic holder (a potential catalyst); Vanguard's is
  // a passive position. At most two, bounded by the caller's clock.
  const facts: UsStructuredFacts[] = [];
  if (opts.readOwnership !== false) {
    const own = out.announcements.filter((a) => /^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/.test(usFormOf(a.subject)) && /primary_doc\.xml|\.htm/i.test(a.url)).slice(0, 2);
    for (const a of own) {
      try {
        const text = await getDocText(a.url, Math.min(5_000, timeoutMs));
        if (!text) continue;
        const ref = secSourceRef({ issuer: ticker, form: usFormOf(a.subject), date: a.dateIso, url: a.url, title: a.subject, access: 'DOCUMENT_READ', text });
        refs.push(ref);
        const fs = extractUsFacts({ text, source: ref, form: usFormOf(a.subject) });
        facts.push(...fs);
        const stake = fs.find((f) => f.economics.stakePct != null || f.event.counterparty);
        if (stake) {
          const i = out.announcements.indexOf(a);
          out.announcements[i] = { ...a, subject: ownershipSubject(a.subject, stake.event.counterparty, stake.economics.stakePct, stake.event.kind === 'stake_by_strategic') };
        }
      } catch (e: any) { out.errors.push(`ownership report ${a.url.split('/').slice(-3, -1).join('/')}: ${String(e?.message || e).slice(0, 80)}`); }
    }
  }
  out.sourceRefs = dedupeSources(refs);
  if (facts.length) out.facts = facts;
  return out;
}

/** zzz798: the non-insider filings of the last `days` days, newest first. Pure. */
export function recentFilingsOf(sub: any, cik: string, now: Date, days = 200): UsRecentFiling[] {
  const rec = sub?.filings?.recent || {};
  const n = Array.isArray(rec.form) ? rec.form.length : 0;
  const out: UsRecentFiling[] = [];
  const cikNum = String(parseInt(cik, 10));
  for (let i = 0; i < n && out.length < 60; i++) {
    const form = String(rec.form[i] || '').toUpperCase();
    const date = String(rec.filingDate?.[i] || '');
    if (!form || /^(3|4|5|144)(\/A)?$/.test(form) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if ((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000 > days) continue;
    const acc = String(rec.accessionNumber?.[i] || '');
    const doc = String(rec.primaryDocument?.[i] || '');
    if (!acc) continue;
    out.push({ form, date, items: String(rec.items?.[i] ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d\.\d\d$/.test(x)),
      url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc.replace(/-/g, '')}/${doc}` });
  }
  return out;
}

/** "SCHEDULE 13G · filed 16:05 ET after the close" → "SCHEDULE 13G: Amazon.com,
 *  Inc. reported 5.3% of the class (strategic holder stake — …) · filed …".
 *  Pure. The marker is what lets classifyUsFiling treat it as a (potential)
 *  strategic-investor event — only ever written after the report was read. */
export function ownershipSubject(subject: string, holder: string | null, pct: number | null, strategic: boolean): string {
  const form = usFormOf(subject);
  const i = subject.indexOf(' · filed ');
  const filed = i >= 0 ? subject.slice(i) : '';
  const who = holder || 'A holder';
  const what = pct != null ? `reported ${pct}% of the class` : 'reported a 5%+ holding';
  const tail = strategic ? ` (${STRATEGIC_STAKE_MARKER} — potential catalyst; any commercial relationship is not stated, verification required)` : ' (financial investor or individual — not a strategic stake)';
  return `${form}: ${who} ${what}${tail}${filed}`;
}

// ── zzz785: SECONDARY ROUTES (press / IR) ──────────────────────────────────

export interface UsPressFallback {
  items: UsPressItem[];
  sources: SourceRef[];
  facts: UsStructuredFacts[];
  /** 'OK' when a secondary route answered; SECONDARY_UNAVAILABLE when none
   *  did — never SOURCE_UNAVAILABLE (that is EDGAR's own failure). */
  status: 'OK' | 'SECONDARY_UNAVAILABLE';
  attempts: RouteAttempt[];
  note: string;
}

/** Nasdaq press releases → Google News RSS. Every item is SECONDARY: a wire
 *  release is the company's words (COMPANY_IR) but not a filing; a news
 *  article is PRESS (verification required). */
export async function fetchUsPressFallback(ticker: string, company: string | null, o: { timeoutMs?: number; now?: Date; windowDays?: number } = {}): Promise<UsPressFallback> {
  const timeoutMs = Math.round(Math.max(2_000, Math.min(10_000, o.timeoutMs ?? 6_000)));
  const now = o.now ?? new Date();
  const windowMs = (o.windowDays ?? 21) * 86_400_000;
  const get = async (url: string, accept: string) => withRetry(() => fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MarketCockpit research)', Accept: accept }, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' }), { retries: 1, baseMs: 500, retryOn: (r) => retryableStatus(r.status) });
  const fresh = (xs: UsPressItem[]) => xs.filter((x) => !x.date || now.getTime() - Date.parse(x.date) <= windowMs);
  const routed = await routeWithFallback<UsPressItem[]>([
    { name: 'Nasdaq press releases', tier: 'secondary', run: async () => {
      const r = await get(`https://api.nasdaq.com/api/news/topic/press_release?q=symbol:${encodeURIComponent(ticker.toLowerCase())}|assetclass:stocks&limit=10&offset=0`, 'application/json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xs = fresh(parseNasdaqPress(await r.json()));
      return xs.length ? xs : null;
    } },
    { name: 'Google News RSS', tier: 'secondary', run: async () => {
      const q = encodeURIComponent(`"${company || ticker}" ${company ? '' : 'stock'}`.trim());
      const r = await get(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, 'application/rss+xml, text/xml');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xs = fresh(parseRssItems(await r.text())).slice(0, 12);
      return xs.length ? xs : null;
    } },
  ]);
  const items = routed.value || [];
  const sources = dedupeSources(items.map((it) => pressSourceRef(ticker, it)));
  const facts = extractUsPressFacts(ticker, items);
  return { items, sources, facts, status: routed.value ? 'OK' : 'SECONDARY_UNAVAILABLE', attempts: routed.attempts, note: describeRouting(routed, 'Press items') };
}

// ── zzz782: THE FILING'S OWN WORDS, WITHOUT A MODEL ────────────────────────
//
// A US 8-K candidate used to be either model-read (paid, ceilinged, and only
// when an API key is set) or left as "document not parsed" with its value
// unknown. This reads the press release text (fetchEdgarText — EX-99.1 when
// there is one) with the same SEC fair-access headers and spacing, and:
//   · for a filing the FORM already classified (merger 8-K, 2.02 results,
//     2.01 completion, 425, SC TO-T…), returns a document read whose quote is
//     the verbatim sentence stating the value or the revenue — never a
//     figure the text does not state;
//   · for a filing only a reader can classify (1.01 / 7.01 / 8.01 / 6-K),
//     returns the release's lead sentence as the announcement SUMMARY. The
//     classifier then reads the company's own words, and the evidence stays
//     SUMMARY-level (materiality at 60%, capped below P1) — it is not a
//     verified reading.
// Returns null when nothing usable is stated. Never throws.
//
// zzz785: both the 8-K BODY and EX-99.1 are opened (the Item 1.01 terms are
// in the body; the release carries value and target figures) and every
// document becomes StructuredFacts (us-extract.ts) on the result as `facts`
// with a SourceRef per document as `sources`. The SEC item is a routing
// hint: an Item 2.01 "completion" whose text says SALE is a divestiture,
// and an 8.01/7.01 whose lead sentence classifies nothing is re-tried with
// the event sentence the extractor found (NUAI / BAND were left
// "unclassified" because only the dateline'd lead was tried).

export type UsDocRead = NonNullable<SweepInput['read']>;
export interface UsDocReadResult {
  read: UsDocRead | null;
  summary: string | null;
  /** zzz785: facts stated in the documents read (only present when any). */
  facts?: StructuredFacts[];
  /** zzz785: one SourceRef per document read (only present with facts). */
  sources?: SourceRef[];
}
export interface UsDocText { role: SecDocRole; url: string; text: string }
const DEAL_WORDS = /\b(contract|award|order|agreement|acquisition|merger|purchase)\b/i;

/** Facts from the documents of one filing: one SourceRef per document, the
 *  same text never counted twice, the same event in body + release merged. */
export function usFactsFromDocs(cand: Pick<ClassifiedAnnouncement, 'subject' | 'url' | 'dateIso'>, docs: UsDocText[], o: { issuer?: string | null; issuerName?: string | null } = {}): { facts: UsStructuredFacts[]; sources: SourceRef[] } {
  const form = usFormOf(cand.subject);
  const items = usItemsOf(cand.subject);
  const issuer = o.issuer || cikFromUrl(cand.url) || 'US';
  const ledger = new DocumentLedger();
  const sources: SourceRef[] = [];
  const all: UsStructuredFacts[] = [];
  for (const d of docs) {
    if (!d.text || d.text.length < 60) continue;
    const ref = secSourceRef({ issuer, form, items, date: cand.dateIso, url: d.url, title: cand.subject, access: 'DOCUMENT_READ', text: d.text, role: d.role });
    if (!ledger.add(ref).added) continue;
    sources.push(ref);
    all.push(...extractUsFacts({ text: d.text, source: ref, form, items, issuerName: o.issuerName ?? null }));
  }
  return { facts: mergeUsFacts(all), sources };
}

/** Extra answers for the view's research questions, from the facts. */
function factsForView(base: Record<string, string> | null, facts: UsStructuredFacts[]): Record<string, string> | null {
  const f = facts.find((x) => !['governance', 'other'].includes(x.event.kind));
  if (!f) return base;
  const out: Record<string, string> = { ...(base || {}) };
  const term = (re: RegExp) => f.terms.find((t) => re.test(t.label))?.value || null;
  if (!out.funding && term(/^Financing$/)) out.funding = term(/^Financing$/)!.slice(0, 220);
  if (!out.counterparty && f.event.counterparty) out.counterparty = f.event.counterparty;
  if (!out.execution_period && f.time.executionPeriod) out.execution_period = f.time.executionPeriod;
  if (f.time.expectedCompletion && !/expected to close/i.test(out.conditions || '')) out.conditions = `Expected to close ${f.time.expectedCompletion}${f.time.milestones.length ? `; conditions: ${f.time.milestones.join(', ')}` : ''}`;
  if (!out.capacity && f.economics.capacityAfter) out.capacity = f.economics.capacityAfter;
  const tgt = [f.economics.targetRevenueNative != null ? `target revenue $${f.economics.targetRevenueNative}M` : null, f.economics.targetProfitNative != null ? `target EBITDA $${f.economics.targetProfitNative}M` : null, ...f.economics.ratios.map((r) => `${r.label} ${r.value}× (${r.formula})`)].filter(Boolean);
  if (tgt.length) { out.target_economics = tgt.join(' · '); if (out.price_terms && !out.price_terms.includes('target revenue')) out.price_terms = `${out.price_terms} · ${tgt.join(' · ')}`; }
  if (f.unknowns.length) out.unknowns = f.unknowns.join('; ');
  return Object.keys(out).length ? out : null;
}

/** Pure: the document read / summary for a candidate from its text. `extra.docs`
 *  (8-K body + exhibits) feed the StructuredFacts; `text` stays the release
 *  the legacy read quotes from. */
export function usDocumentReadFromText(cand: ClassifiedAnnouncement, text: string, extra: { docs?: UsDocText[]; issuer?: string | null; issuerName?: string | null } = {}): UsDocReadResult {
  if (!text || text.length < 200) return { read: null, summary: null };
  const { facts, sources } = usFactsFromDocs(cand, extra.docs && extra.docs.length ? extra.docs : [{ role: 'primary', url: cand.url, text }], extra);
  const withFacts = (r: { read: UsDocRead | null; summary: string | null }): UsDocReadResult => (facts.length ? { ...r, facts, sources } : r);
  const pr = extractUsPressRelease(text);
  const plain = usPlainSubject(cand.subject).replace(/ \[Item [^\]]*\]/, '').replace(/ · filed [\s\S]*$/, '').replace(/^[^:]+:\s*/, '');
  const baseFacts = Object.keys(pr.facts).length ? { ...pr.facts } : null;
  const factsRec = factsForView(baseFacts, facts);
  if (cand.kind === 'catalyst' && isKnownCatalyst(cand.category)) {
    let category = cand.category;
    // Item 2.01 is "acquisition OR disposition": the text decides. (zzz785)
    const deal = facts.find((f) => f.event.kind === 'acquisition');
    if (category === 'acquisition' && deal?.terms.some((t) => t.label === 'Event' && /Disposition/.test(t.value))) category = 'divestiture';
    const lead = plain.replace(/ \([^)]*\)$/, '');
    if (category === 'quarterly_result' && pr.revenueSentence) {
      return withFacts({ read: { url: cand.url, headline: `Results released — ${pr.revenueSentence.slice(0, 160)}`, quote: pr.revenueSentence, category, valueStated: null, facts: factsRec, source: 'document_extract' }, summary: null });
    }
    if (category !== 'quarterly_result' && pr.valueM != null && pr.valueSentence) {
      return withFacts({ read: { url: cand.url, headline: `${category === 'divestiture' ? 'Disposition' : lead} — ${pr.valueSentence.slice(0, 160)}`, quote: pr.valueSentence, category, valueStated: pr.valueM, facts: factsRec, source: 'document_extract' }, summary: null });
    }
    if (baseFacts && pr.facts.price_terms) {
      // Terms without a stated deal value (per-share price only): the facts
      // travel, the value stays unknown.
      const q = /“([^”]+)”/.exec(pr.facts.price_terms)?.[1] || null;
      if (q && text.replace(/\s+/g, ' ').includes(q)) return withFacts({ read: { url: cand.url, headline: `${lead} — ${pr.facts.price_terms.split(' — ')[0]}`, quote: q, category, valueStated: null, facts: factsRec, source: 'document_extract' }, summary: null });
    }
    // zzz785: the 8-K body states the deal when the release does not.
    if (deal && deal.quotes.length && (deal.economics.considerationNative != null || deal.terms.some((t) => /per-share/i.test(t.label)))) {
      const q = deal.quotes.find((x) => /\$\s?\d/.test(x)) || deal.quotes[0];
      return withFacts({ read: { url: cand.url, headline: `${lead} — ${q.slice(0, 160)}`, quote: q, category, valueStated: deal.economics.considerationNative, facts: factsRec, source: 'document_extract' }, summary: null });
    }
    return withFacts({ read: null, summary: null });
  }
  if (cand.kind === 'unclassified') {
    // zzz785: SUPPLY or a stated SETBACK read from the document is recorded
    // as a negative document read (verbatim quote) — never handed to the
    // generic classifier, which reads "equity offering" as a positive raise.
    // Offerings are supply on the US side (classifyUsFiling); NUAI's Item
    // 1.01 was an at-the-market Sales Agreement.
    const top = facts.find((f) => !['governance', 'other', 'results'].includes(f.event.kind));
    const negCat = top?.event.kind === 'fundraising' ? 'dilution' as const
      : top?.event.kind === 'regulatory_negative' && /\b(project|development|construction|permit)/i.test(top.quotes[0] || '') ? 'project_delay' as const : null;
    if (top && negCat && top.quotes[0]) {
      const d = describeUsFact(top);
      return withFacts({ read: { url: cand.url, headline: d.line.slice(0, 300), quote: top.quotes[0], category: negCat, valueStated: null, facts: factsRec, source: 'document_extract' }, summary: null });
    }
    // The value sentence, when there is one, is the more useful summary: the
    // classifier takes its category and its figure from the same words.
    const tries: string[] = [];
    if (pr.lead) tries.push((pr.valueSentence && DEAL_WORDS.test(pr.valueSentence) ? `${pr.lead} ${pr.valueSentence}` : pr.lead).slice(0, 400));
    // zzz785: then the event sentence each extracted fact was read from —
    // for context kinds with the plain label the reader derived, so a debt
    // line or an investor deck reads as what it is (routine), not "unclassified".
    for (const f of facts) {
      if (f.event.kind === 'governance' || !f.quotes[0]) continue;
      const label = f.event.kind === 'debt' ? 'Debt financing: ' : f.event.kind === 'other' && f.terms.some((t) => /Investor presentation/.test(t.value)) ? 'Investor presentation furnished under Regulation FD — no new event: ' : f.event.kind === 'other' ? null : '';
      if (label != null) tries.push(`${label}${f.quotes[0]}`.slice(0, 400));
    }
    for (const summary of tries) {
      const c = classifyAnnouncement({ ...cand, summary }, 'US');
      // A summary that reads as a catalyst, routine or negative is worth
      // recording; one that still classifies nothing adds nothing.
      if (c.kind !== 'unclassified') return withFacts({ read: null, summary });
    }
    return withFacts({ read: null, summary: null });
  }
  return withFacts({ read: null, summary: null });
}

/** Fetch + read one candidate filing (8-K body + EX-99.1). Null on any failure. */
export async function readUsFilingDocument(cand: ClassifiedAnnouncement, timeoutMs = 8_000, o: { ticker?: string | null; issuerName?: string | null; exhibit10?: boolean } = {}): Promise<UsDocReadResult | null> {
  if (!/^https:\/\/www\.sec\.gov\//.test(String(cand.url || ''))) return null;
  try {
    const docs = await fetchEdgarDocuments(cand.url, timeoutMs, { exhibit10: o.exhibit10 });
    const release = docs.find((d) => d.role === 'ex99') || docs.find((d) => d.role === 'primary') || docs[0];
    if (!release?.text) return null;
    return usDocumentReadFromText(cand, release.text, { docs, issuer: o.ticker || null, issuerName: o.issuerName || null });
  } catch { return null; }
}

// ── zzz785: WHAT THE FINDING CARRIES (extraFacts / extraRefs) ─────────────
//
// Everything US-side that was read for one name — ownership reports opened
// during the listing, the candidate 8-K body + exhibits, press / IR items from
// the secondary route — becomes the finding's structured facts and source
// refs. Official and press stay apart: a press item the filing also states is
// kept as SECONDARY with `confirmedBy` that filing (never a second event); a
// press item nothing official states stays "verification required".
// A listed-but-unopened filing is NOT repeated here — buildFinding already
// lists every in-window filing as SUMMARY_ONLY. Pure; compact (KV-sized).

export type UsFindingFact = StructuredFacts & {
  secondary?: true;
  confirmedBy?: { url: string | null; date: string | null; title: string } | null;
  headline?: string;
};
export interface UsFindingEvidence { extraFacts: UsFindingFact[]; extraRefs: SourceRef[] }

function compactUsFact(f: UsStructuredFacts | StructuredFacts): UsFindingFact {
  const x = f as UsStructuredFacts & UsFindingFact;
  const out: any = {
    source: x.source, event: x.event, economics: { ...x.economics, allottees: x.economics.allottees.slice(0, 6), ratios: x.economics.ratios.slice(0, 4) },
    time: { ...x.time, milestones: x.time.milestones.slice(0, 4) },
    quotes: x.quotes.slice(0, 2).map((q) => q.slice(0, 280)), unknowns: x.unknowns.slice(0, 5), verificationRequired: x.verificationRequired,
  };
  if (x.terms) out.terms = x.terms.slice(0, 8).map((t) => ({ ...t, value: String(t.value).slice(0, 220) }));
  if (x.alsoFrom && x.alsoFrom.length) out.alsoFrom = x.alsoFrom.slice(0, 3);
  if (x.secondary) out.secondary = true;
  if (x.confirmedBy !== undefined) out.confirmedBy = x.confirmedBy;
  try { out.headline = describeUsFact(x).line.slice(0, 240); } catch { /* the line is a convenience */ }
  return out as UsFindingFact;
}

export function usFindingEvidence(parts: {
  listing?: Pick<EdgarResearch, 'facts' | 'sourceRefs' | 'press' | 'failure' | 'routingNote' | 'errors'> | null;
  doc?: Pick<UsDocReadResult, 'facts' | 'sources'> | null;
  /** Evidence stored by an earlier pass (a re-score adds the new document to it). */
  prior?: { facts?: StructuredFacts[] | null; refs?: SourceRef[] | null } | null;
  issuer?: string | null;
}): UsFindingEvidence {
  const all = [...(parts.prior?.facts || []), ...(parts.listing?.facts || []), ...(parts.doc?.facts || [])] as UsStructuredFacts[];
  const official = all.filter((f) => isOfficial(f.source) && !(f as UsFindingFact).secondary);
  const pressIn = all.filter((f) => !isOfficial(f.source) || (f as UsFindingFact).secondary);
  const v = separateOfficialAndPress(official);
  const offs = v.official;
  const press: UsFindingFact[] = [];
  const seenPress = new Set<string>();
  for (const p of pressIn) {
    const k = `${p.source.hash || p.source.url || p.source.title}|${p.event.kind}`;
    if (seenPress.has(k)) continue;
    seenPress.add(k);
    const hit = offs.find((o) => sameEvent(o, p));
    const confirmedBy = hit ? { url: hit.source.url ?? null, date: hit.source.date, title: hit.source.title } : null;
    press.push({ ...p, verificationRequired: true, secondary: true, confirmedBy,
      unknowns: Array.from(new Set(['Press report — not verified against an official filing.', ...(confirmedBy ? [] : ['No official filing read that states the same event.']), ...p.unknowns.filter((u) => !/^Press report|^No official filing/.test(u))])) } as UsFindingFact);
  }
  const facts = [...offs.map(compactUsFact), ...press.slice(0, 6).map(compactUsFact)].slice(0, 10);

  // Refs: documents read first (so a DOCUMENT_READ copy wins over a listing copy of the same file).
  const readRefs = [...(parts.doc?.sources || []), ...(parts.prior?.refs || []), ...(parts.listing?.sourceRefs || [])]
    .filter((r) => !(r.kind === 'SEC_FILING' && r.access === 'SUMMARY_ONLY'));
  const refs = dedupeSources([...readRefs, ...all.flatMap((f) => (f as UsStructuredFacts).alsoFrom || [])]);
  const l = parts.listing;
  if (l?.failure && !refs.some((r) => r.access === 'SOURCE_UNAVAILABLE')) {
    refs.push({ kind: 'SEC_FILING', access: 'SOURCE_UNAVAILABLE', issuer: parts.issuer || '', date: null, url: null, title: `SEC EDGAR unavailable — ${l.routingNote || l.errors?.[0] || l.failure}`.slice(0, 300) });
  }
  if (l?.press && l.press.status === 'SECONDARY_UNAVAILABLE' && !refs.some((r) => r.access === 'SECONDARY_UNAVAILABLE')) {
    refs.push({ kind: 'PRESS', access: 'SECONDARY_UNAVAILABLE', issuer: parts.issuer || '', date: null, url: null, title: `Secondary source unavailable — ${l.press.note}`.slice(0, 300) });
  }
  return { extraFacts: facts, extraRefs: refs.slice(0, 12) };
}

// ── zzz785: DOCUMENT CACHE ─────────────────────────────────────────────────
// The same 8-K / exhibit is fetched once per process per 6 h (a re-score, a
// second candidate pass and the model read all ask for it) — never twice
// over the SEC's rate limit, never counted twice.
const DOC_TTL_MS = 6 * 3600_000;
const DOC_MAX = 200;
const docCache = new Map<string, { at: number; text: string }>();

async function getDocText(url: string, timeoutMs: number): Promise<string> {
  const hit = docCache.get(url);
  if (hit && Date.now() - hit.at < DOC_TTL_MS) return hit.text;
  const r = await secFetchRetry(url, timeoutMs, 1);
  if (!r.ok) return '';
  const text = htmlToText(await r.text());
  if (docCache.size >= DOC_MAX) docCache.delete(docCache.keys().next().value as string);
  docCache.set(url, { at: Date.now(), text });
  return text;
}

// ── zzz798: SEC helpers for the US card reader (us-card-fetch.ts) ─────────
// Same User-Agent, same ≤10 requests/s spacing, same retry, same 6 h text
// cache. Raw HTML (for the EX-99.1 tables) and very long exhibits (a scheme
// booklet) sit in their own small caches so they cannot crowd out the rest.
const RAW_MAX = 24;
const rawCache = new Map<string, { at: number; html: string }>();
/** Raw HTML of one SEC document ('' on failure). Never throws. */
export async function secRawHtml(url: string, timeoutMs: number, maxBytes = 8_000_000): Promise<string> {
  const hit = rawCache.get(url);
  if (hit && Date.now() - hit.at < DOC_TTL_MS) return hit.html;
  try {
    const r = await secFetchRetry(url, timeoutMs, 1);
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, maxBytes);
    if (rawCache.size >= RAW_MAX) rawCache.delete(rawCache.keys().next().value as string);
    rawCache.set(url, { at: Date.now(), html });
    return html;
  } catch { return ''; }
}
/** JSON from sec.gov / data.sec.gov (null on failure). Never throws. */
export async function secJson<T = any>(url: string, timeoutMs: number): Promise<T | null> {
  try { const r = await secFetchRetry(url, timeoutMs, 1); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}
/** Filing text through the shared 6 h cache ('' on failure). Never throws. */
export async function secDocText(url: string, timeoutMs: number): Promise<string> {
  try { return await getDocText(url, timeoutMs); } catch { return ''; }
}

/** The documents of one filing: the primary (8-K body), EX-99.1 (press
 *  release) and — only when asked, it is often very long — EX-10.1. */
export async function fetchEdgarDocuments(url: string, timeoutMs = 12_000, o: { exhibit10?: boolean } = {}): Promise<UsDocText[]> {
  const dir = url.replace(/\/[^/]+$/, '/');
  const primaryName = /-index\.htm$/i.test(url) ? null : url.split('/').pop() || null;
  const want: Array<{ role: SecDocRole; url: string }> = [];
  try {
    const r = await secFetchRetry(`${dir}index.json`, timeoutMs, 1);
    if (r.ok) {
      const j: any = await r.json();
      const items: any[] = j?.directory?.item || [];
      const htm = items.filter((it) => /\.htm/i.test(String(it?.name || '')) && !/index/i.test(String(it?.name || '')));
      // zzz782: "exhibit991.htm" / "ex99-1.htm" / "d123dex991.htm" are all the
      // press release; 99.1 is preferred over 99.2 (often a slide deck).
      const exs = htm.filter((it) => secDocRoleOf(it.name, primaryName) === 'ex99');
      const ex = exs.find((it) => /99[-_ .]?0?1(?!\d)/.test(String(it?.name || ''))) || exs[0];
      const main = primaryName ? { name: primaryName } : htm.find((it) => secDocRoleOf(it.name) === 'other');
      if (main?.name && !/\.xml$/i.test(main.name)) want.push({ role: 'primary', url: `${dir}${main.name}` });
      if (ex?.name) want.push({ role: 'ex99', url: `${dir}${ex.name}` });
      if (o.exhibit10) {
        const e10 = htm.find((it) => secDocRoleOf(it.name, primaryName) === 'ex10' && Number(it.size || 0) < 400_000);
        if (e10?.name) want.push({ role: 'ex10', url: `${dir}${e10.name}` });
      }
    }
  } catch { /* the primary document is still a fine read */ }
  if (!want.length && primaryName) want.push({ role: 'primary', url });
  const out: UsDocText[] = [];
  for (const w of want) {
    try { const text = await getDocText(w.url, timeoutMs); if (text) out.push({ ...w, text }); } catch { /* one exhibit failing keeps the rest */ }
  }
  return out;
}

/** Fetch an EDGAR document as text. For an 8-K the press release usually sits
 *  in EX-99.1 beside the primary document; that is what a reader wants. */
export async function fetchEdgarText(url: string, timeoutMs = 12_000): Promise<string> {
  const docs = await fetchEdgarDocuments(url, timeoutMs);
  return (docs.find((d) => d.role === 'ex99') || docs.find((d) => d.role === 'primary') || docs[0])?.text || '';
}

const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', bull: '•', reg: '®', trade: '™',
  // zzz798: EX-99.1 bullets ("&middot; Total revenue was …") stayed literal.
  middot: '·',
};

/** Filing HTML → text. Entities are DECODED, not blanked: "company&#8217;s"
 *  used to become "company s", so a verbatim quote containing an apostrophe or
 *  a dash never matched the document and a paid read was thrown away. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c === 160 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c === 0xa0 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&([a-z]+);/gi, (m, k) => NAMED[k.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim().slice(0, 60_000);
}
