// ═══════════════════════════════════════════════════════════════════════════
// zzz857 — pure helpers for the guidance-document collector.
//
// No network, no filesystem: everything here is exercised by
// frontend/src/lib/__tests__/zzz857-docs.test.ts with fixtures. The runner
// (scrape-guidance-docs.mjs) wires these to fetch + pdftotext.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

export const TEXT_CAP = 120_000;
export const MAX_BATCH_DOCS = 25;
export const MAX_BATCH_BYTES = 4 * 1024 * 1024;

/** docId = sha1(url) hex, first 20 chars (contract). */
export function docIdFor(url) {
  return createHash('sha1').update(String(url)).digest('hex').slice(0, 20);
}

// ── classification ──────────────────────────────────────────────────────────

// Filings that name a call / presentation but are not the document itself:
// schedules, invitations, audio links, intimations, newspaper copies.
const NOT_A_DOC = /\b(audio|recording|video|webcast link|schedule (of|for)|intimation (of|about|regarding) (the )?(earnings|conference|con\.?|analyst|investor|schedule)|invitation|newspaper|trading window|record date|postal ballot|scrutini[sz]er|voting result|book closure|e-?voting|notice of (the )?(\d+\w* )?agm|proceedings of|change in (the )?(date|schedule)|rescheduled|cancell?ation of)\b/i;

/**
 * Kind of company document from the exchange subject / headline / category.
 * Returns null when the filing is not a guidance-bearing document.
 * @param {string} subject  NEWSSUB / NSE desc
 * @param {{ headline?: string, category?: string, subcategory?: string, includePlainResults?: boolean }} [o]
 */
export function classifySubject(subject, o = {}) {
  const head = String(o.headline || '');
  const cat = `${o.category || ''} ${o.subcategory || ''}`;
  const hay = `${subject || ''} ${head}`.replace(/\s+/g, ' ').trim();
  const all = `${hay} ${cat}`;
  if (!hay && !cat.trim()) return null;
  const isTranscript = /\btranscripts?\b/i.test(all);
  // A transcript filing can also mention "audio recording"; a transcript wins.
  if (!isTranscript && NOT_A_DOC.test(hay)) return null;
  if (isTranscript) return 'TRANSCRIPT';
  if (/chairman'?s?\s+(speech|address|statement|message|letter)|\bagm\s+speech|speech\b.*\b(agm|annual general meeting)|\b(address|speech) (by|of) (the )?(chairman|managing director|md)\b|letter to (the )?shareholders/i.test(hay)) return 'AGM_SPEECH';
  if (/\b(investors?|earnings|results?|corporate|analysts?)\s+(presentation|deck|update presentation)|\bpresentation\b/i.test(all)) return 'PRESENTATION';
  const resultWords = /\b(results?|quarter|q[1-4]|fy\s*'?\d{2}|earnings|financial performance|performance|half[- ]year|h[12])\b/i;
  if (/\b(press|media|earnings)\s+release\b/i.test(all) && resultWords.test(all)) return 'RESULTS_RELEASE';
  if (/\bearnings\s+release\b/i.test(all)) return 'RESULTS_RELEASE';
  if (o.includePlainResults && /outcome of (the )?board meeting/i.test(hay) && /\bresults?\b/i.test(all)) return 'RESULTS_RELEASE';
  if (o.includePlainResults && /^\s*result\b/i.test(o.category || '') && /financial results?/i.test(hay)) return 'RESULTS_RELEASE';
  return null;
}

// ── period hint ─────────────────────────────────────────────────────────────

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const fy2 = (y) => String(Number(y) % 100).padStart(2, '0');

/** Indian fiscal quarter for a quarter-end month/year (FY ends March). */
function indianQuarter(month, year) {
  const q = { 6: 1, 9: 2, 12: 3, 3: 4 }[month];
  if (!q) return null;
  const fyEnd = month === 3 ? year : year + 1;
  return `Q${q} FY${fy2(fyEnd)}`;
}

/** Normalise "26", "2026", "2025-26", "2025-2026" → two-digit FY end year. */
function fyEnd(s) {
  const m = /^(\d{2,4})(?:\s*[-–\/]\s*(\d{2,4}))?$/.exec(String(s).trim());
  if (!m) return null;
  if (m[2]) return fy2(m[2]);
  return fy2(m[1]);
}

/**
 * Period stated in a filing title, e.g. 'Q1 FY27', 'H1 FY27', 'FY26'. Null when none.
 * Indian fiscal year (April–March) for quarter-ended dates.
 */
export function extractPeriodHint(title) {
  const t = String(title || '').replace(/\s+/g, ' ');
  let m = /\bQ\s*([1-4])\s*(?:[-'’&,]|and)?\s*FY\s*'?\s*(\d{4}\s*[-–\/]\s*\d{2,4}|\d{2,4})\b/i.exec(t);
  if (m) { const y = fyEnd(m[2]); if (y) return `Q${m[1]} FY${y}`; }
  m = /\b([1-4])\s*Q\s*FY\s*'?\s*(\d{4}\s*[-–\/]\s*\d{2,4}|\d{2,4})\b/i.exec(t);
  if (m) { const y = fyEnd(m[2]); if (y) return `Q${m[1]} FY${y}`; }
  m = /\b(H[12])\s*(?:[-']|of)?\s*FY\s*'?\s*(\d{4}\s*[-–\/]\s*\d{2,4}|\d{2,4})\b/i.exec(t);
  if (m) { const y = fyEnd(m[2]); if (y) return `${m[1].toUpperCase()} FY${y}`; }
  // "quarter (and half year) ended (on) 30th June, 2026" / "June 30, 2026" / "30.06.2026"
  m = /\b(quarter|three months|period|half[- ]year|year)\b[^.]{0,40}?\bended\b\s*(?:on\s*)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s*(\d{4})|([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})|(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4}))/i.exec(t);
  if (m) {
    let month = null, year = null;
    if (m[3]) { month = MONTHS[m[3].slice(0, 3).toLowerCase()]; year = Number(m[4]); }
    else if (m[5]) { month = MONTHS[m[5].slice(0, 3).toLowerCase()]; year = Number(m[7]); }
    else if (m[9]) { month = Number(m[9]); year = Number(m[10]); }
    if (month && year) {
      const span = m[1].toLowerCase();
      if (span === 'year' && month === 3) return `FY${fy2(year)}`;
      if (/half/.test(span)) { if (month === 9) return `H1 FY${fy2(year + 1)}`; if (month === 3) return `H2 FY${fy2(year)}`; }
      const q = indianQuarter(month, year);
      if (q) return q;
    }
  }
  m = /\bFY\s*'?\s*(\d{4}\s*[-–\/]\s*\d{2,4}|\d{2,4})\b/i.exec(t);
  if (m) { const y = fyEnd(m[1]); if (y) return `FY${y}`; }
  m = /\bfinancial year\s*(\d{4}\s*[-–\/]\s*\d{2,4})\b/i.exec(t);
  if (m) { const y = fyEnd(m[1]); if (y) return `FY${y}`; }
  return null;
}

// ── guidance cue ────────────────────────────────────────────────────────────

// zzz916: + aim / plan / double / triple / CAGR / "looking at" / trajectory ("we aim to double revenue to ₹2,000 crore by FY29" had none of the older words)
const CUE_WORD = /\b(guidance|guiding|guided|guide|outlook|expects?|expecting|expected to|target(?:s|ing|ed)?|growth|grow(?:ing)?|aspir(?:e|ation)|envisag(?:e|ing)|visibility|anticipat(?:e|ing)|forecast|aim(?:s|ing)?|plan(?:s|ning)?|doubl(?:e|ing)|tripl(?:e|ing)|cagr|looking at|trajectory)\b/i;
const CUE_NUMBER = /(\bFY\s*'?2?\d\b|\bFY\s*20\d\d|\bcrores?\b|\bcr\.?\b|\bmargins?\b|\d\s?%|\bbillion\b|\bmillion\b|\blakhs?\b)/i;

/** A document worth keeping: a forward-looking word AND a financial/number cue. */
export function hasGuidanceCue(text) {
  const t = String(text || '');
  return CUE_WORD.test(t) && CUE_NUMBER.test(t);
}

/** Image-only / empty PDF: too few letters to read. */
export function isUnreadableText(text) {
  const letters = (String(text || '').match(/[A-Za-z]/g) || []).length;
  return letters < 400;
}

/** A cover letter whose real document lives on the company site: the first
 *  https PDF link that is not an exchange host. Only for short texts.
 *  zzz916: see findLinkedPdfs (also transcript-named links without ".pdf"). */
export function findLinkedPdf(text) {
  return findLinkedPdfs(text)[0] || null;
}

/** zzz916 — every candidate document link in a short cover letter, best first: ".pdf" links, then links whose path names a transcript /
 *  concall (the download step checks the bytes really are a PDF). Exchange / SEC hosts, IPs and audio / web pages are skipped. */
export function findLinkedPdfs(text) {
  const t = String(text || '');
  if (t.length > 6000) return [];
  const re = /https?:\/\/[^\s"'<>()\]]+/gi;
  const pdfs = []; const named = [];
  for (const m of t.matchAll(re)) {
    const u = m[0].replace(/[.,;:]+$/, '');
    let x;
    try { x = new URL(u); } catch { continue; }
    const h = x.hostname.toLowerCase();
    if (/(^|\.)(bseindia\.com|nseindia\.com|sec\.gov)$/.test(h)) continue;
    if (/^\d+(\.\d+)+$/.test(h) || !/\.[a-z]{2,}$/.test(h)) continue;
    x.protocol = 'https:';
    if (/\.pdf$/i.test(x.pathname)) pdfs.push(x.toString());
    else if (/transcript|con-?call|earnings-?call/i.test(x.pathname) && !/\.(mp3|mp4|m4a|wav|html?|aspx?|php)$/i.test(x.pathname)) named.push(x.toString());
  }
  return Array.from(new Set([...pdfs, ...named]));
}

// ── zzz916: intimation letters (they point to the document; they are not it) ─

/**
 * An exchange "intimation" that only POINTS to the document: "the transcript of the earnings call is available on our website at …",
 * "audio recording … uploaded", "please find the link". Short (a page or two) and says the document lives elsewhere. Such a filing is
 * never stored as the transcript and never marked "read, no guidance": the collector follows its link, then Screener.in's concall list,
 * and records it as an intimation still waiting for the real document.
 */
const POINTS_ELSEWHERE = /\b(transcripts?|audio|recording|presentation|concall|con\.? call|conference call|earnings call)\b[^.]{0,160}?\b(available|uploaded|hosted|placed|posted|accessible|can be (?:accessed|viewed|found)|link)\b|\b(weblink|web link|following link|below link|link below|hyperlink|website of the company|company'?s website|our website)\b/i;
export function isIntimationText(text) {
  const t = String(text || '');
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters > 4_500) return false;                 // a real transcript / deck is longer than a cover letter
  return POINTS_ELSEWHERE.test(t.replace(/\s+/g, ' '));
}

// ── zzz916: Screener.in concall list (fetched by the collector from GitHub's network) ──

const SCREENER_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const decodeHtml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** BSE "AnnPdfOpen.aspx?Pname=<file>.pdf" (Screener's links) → the attachment URL it redirects to; http → https for exchange hosts. */
export function normaliseExchangePdfUrl(u) {
  let x;
  try { x = new URL(decodeHtml(u)); } catch { return null; }
  const h = x.hostname.toLowerCase();
  if (/(^|\.)bseindia\.com$/.test(h) && /annpdfopen\.aspx$/i.test(x.pathname)) {
    const p = x.searchParams.get('Pname') || x.searchParams.get('pname') || '';
    return /^[A-Za-z0-9._-]+\.pdf$/i.test(p) ? `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${p}` : null;
  }
  if (/(^|\.)(bseindia\.com|nseindia\.com)$/.test(h)) x.protocol = 'https:';
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return null;
  return x.toString();
}

/**
 * A Screener.in company page → { name, bseCode, nseSymbol, concalls: [{ month: 'YYYY-MM', label, transcript, ppt }] } (page order, newest first).
 * Reads the current markup (<li> rows with a "Mon YYYY" label and button-chip links: text "Transcript" / title "Raw Transcript", text "PPT")
 * and the older one (a.concall-link). A locked row (a <div class="button-chip"> without a link) gives null for that document.
 * (The app's own parser in api/v1/haiku/forward-guidance still looks for the old a.concall-link only.)
 */
export function parseScreenerCompany(html) {
  const s = String(html || '');
  const title = /<title>\s*([^<|]+?)\s+share price/i.exec(s);
  const name = title ? decodeHtml(title[1]).trim() : null;
  const bse = /bseindia\.com\/stock-share-price\/[^"'\s]*?\/(\d{6})\/?["']/i.exec(s);
  const nse = /nseindia\.com\/get-quotes\/equity\?symbol=([A-Z0-9&%-]+)/i.exec(s);
  const at = s.search(/>\s*Concalls\s*</i);
  const concalls = [];
  if (at >= 0) {
    const seg = s.slice(at, at + 80_000);
    const end = seg.search(/<\/ul>/i);
    const body = end > 0 ? seg.slice(0, end) : seg;
    for (const li of body.split(/<li\b/i).slice(1)) {
      const lm = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(20\d{2})\b/.exec(li.replace(/<[^>]+>/g, ' '));
      if (!lm) continue;
      const mon = SCREENER_MON[lm[1].toLowerCase()];
      const links = Array.from(li.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map((m) => {
        const href = /href="([^"]+)"/i.exec(m[1]);
        const ttl = /title="([^"]*)"/i.exec(m[1]);
        return { href: href ? decodeHtml(href[1]) : null, text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), title: ttl ? ttl[1] : '', cls: m[1] };
      }).filter((l) => l.href && /^https?:\/\//i.test(l.href));
      const tr = links.find((l) => /^transcript$/i.test(l.text) || /raw transcript/i.test(l.title) || (/concall-link/.test(l.cls) && !/\b(ppt|rec|notes)\b/i.test(l.text)));
      const ppt = links.find((l) => /^ppt$/i.test(l.text) || /presentation/i.test(l.title));
      concalls.push({ month: `${lm[2]}-${String(mon).padStart(2, '0')}`, label: `${lm[1]} ${lm[2]}`, transcript: tr ? tr.href : null, ppt: ppt ? ppt.href : null });
    }
  }
  return { name, bseCode: bse ? bse[1] : null, nseSymbol: nse ? decodeURIComponent(nse[1]).toUpperCase() : null, concalls };
}

/**
 * Screener search API answer → the company page path ("/company/539682/consolidated/"), or null. A hit must BE the queried company:
 * its page path names the query, or (for a query of 5+ letters) its name does once spaces are dropped ("Mobavenue AI Tech" for
 * MOBAVENUE). The first hit is never taken on trust ("BMW" finds BMW Ventures, not BMW Industries).
 */
export function screenerSearchPath(json, query) {
  const rows = Array.isArray(json) ? json : [];
  const q = String(query || '').trim().toUpperCase();
  if (!q) return null;
  const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ok = (r) => r && typeof r.url === 'string' && /^\/company\/[A-Za-z0-9&%-]+\/(?:consolidated\/)?$/.test(r.url);
  const hit = rows.find((r) => ok(r) && r.url.toUpperCase().includes(`/${q}/`))
    || (q.length >= 5 && /[A-Z]/.test(q) ? rows.find((r) => ok(r) && squash(r.name).startsWith(squash(q))) : null);
  return hit ? hit.url : null;
}

/** The concall row that belongs to an exchange filing dated `filedAtIso`: the newest call in the ~75 days up to (and 10 days after) it. */
export function pickConcallFor(concalls, filedAtIso) {
  const t = Date.parse(filedAtIso);
  if (!Number.isFinite(t)) return null;
  const rows = (Array.isArray(concalls) ? concalls : []).map((c) => ({ c, start: Date.parse(`${c.month}-01T00:00:00Z`) })).filter((x) => Number.isFinite(x.start));
  const ok = rows.filter((x) => x.start <= t + 10 * 86_400_000 && t - x.start <= 75 * 86_400_000).sort((a, b) => b.start - a.start);
  return ok.length ? ok[0].c : null;
}

/** Calls whose month is on or after the window start (YYYY-MM-DD). */
export function concallsSince(concalls, sinceDay) {
  const since = String(sinceDay || '').slice(0, 7);
  return (Array.isArray(concalls) ? concalls : []).filter((c) => c && c.month >= since);
}

const LONG_MON = 'january|february|march|april|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
/** The call date printed on a transcript's first page when it falls in `month` (YYYY-MM); else the 1st of that month. ISO; null without a month. */
export function callDateFrom(text, month) {
  const head = String(text || '').slice(0, 4000);
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return null;
  const pick = (yy, mm, dd) => (yy === y && mm === m && dd >= 1 && dd <= 31 ? `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T00:00:00.000Z` : null);
  const mi = (w) => SCREENER_MON[String(w).slice(0, 3).toLowerCase()];
  let r;
  for (const x of head.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${LONG_MON})\\.?,?\\s+(20\\d{2})\\b`, 'gi'))) if ((r = pick(Number(x[3]), mi(x[2]), Number(x[1])))) return r;
  for (const x of head.matchAll(new RegExp(`\\b(${LONG_MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'))) if ((r = pick(Number(x[3]), mi(x[1]), Number(x[2])))) return r;
  for (const x of head.matchAll(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/g)) if ((r = pick(Number(x[3]), Number(x[2]), Number(x[1])))) return r;
  return `${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`;
}

/**
 * "FREDUN, 539682 ,baroext:513502" → ['FREDUN','539682','BAROEXT:513502'] (at most 2000). A token is an NSE / BSE symbol, a 6-digit
 * BSE code, or SYMBOL:CODE — the symbol the site uses for a BSE-only company plus its BSE code (looked up by code, filed under the symbol).
 */
export function parseTickerList(s) {
  return Array.from(new Set(String(s || '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase().replace(/^(NSE|BSE):(?=[A-Z0-9])/, '')).filter((x) => /^[A-Z0-9][A-Z0-9&-]{0,19}(?::\d{6})?$/.test(x)))).slice(0, 2000);
}
/** A sweep token → { lookup (what Screener is asked for), ticker (what the document is filed under, null = not known), bseCode }. */
export function sweepTarget(token) {
  const t = String(token || '').toUpperCase();
  const m = /^([A-Z0-9][A-Z0-9&-]{0,19}):(\d{6})$/.exec(t);
  if (m) return { lookup: m[2], ticker: /^\d+$/.test(m[1]) ? null : m[1], bseCode: m[2] };
  if (/^\d{6}$/.test(t)) return { lookup: t, ticker: null, bseCode: t };
  return { lookup: t, ticker: t, bseCode: null };
}

// ── zzz921: targeted re-collect ─────────────────────────────────────────────

export const RECOLLECT_MAX_TICKERS = 30;
export const RECOLLECT_DEFAULT_DAYS = 120;
export const RECOLLECT_MAX_DAYS = 210;
/**
 * The `recollect_tickers` input → targets. Anything but letters, digits, & - : and separators is dropped first (the workflow does the same with `tr`),
 * then each token must be an NSE symbol, a BSE code or SYMBOL:BSECODE; duplicates removed; at most 30. Never throws.
 */
export function parseRecollectTickers(s, max = RECOLLECT_MAX_TICKERS) {
  const clean = String(s || '').replace(/[^A-Za-z0-9,;:&\-\s]/g, '').slice(0, 2000);
  return parseTickerList(clean).slice(0, Math.max(0, Math.min(RECOLLECT_MAX_TICKERS, max)));
}
/** `recollect_days` → 1..210, default 120 (anything not a whole number falls back to the default). */
export function recollectDays(v) {
  const n = /^\d{1,4}$/.test(String(v ?? '').trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return RECOLLECT_DEFAULT_DAYS;
  return Math.min(RECOLLECT_MAX_DAYS, n);
}
/** NSE per-company announcements over a date range (days YYYY-MM-DD). */
export function nseRangeUrl({ symbol, index = 'equities', from, to }) {
  const f = (d) => { const [y, m, dd] = d.split('-'); return `${dd}-${m}-${y}`; };
  return `https://www.nseindia.com/api/corporate-announcements?index=${index === 'sme' ? 'sme' : 'equities'}&symbol=${encodeURIComponent(symbol)}&from_date=${f(from)}&to_date=${f(to)}`;
}
/** BSE per-scrip announcements over a date range, all categories. */
export function bseScripRangeUrl({ scrip, from, to, page = 1 }) {
  const y = (d) => d.replace(/-/g, '');
  return `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1&strPrevDate=${y(from)}&strScrip=${encodeURIComponent(scrip)}&strSearch=P&strToDate=${y(to)}&strType=C&subcategory=-1`;
}

// ── exchange rows → filings ─────────────────────────────────────────────────

/** BSE NEWS_DT has no zone; it is IST. */
export function bseDateToIso(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}+05:30`;
  const d = new Date(withZone);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** NSE an_dt "26-May-2026 18:42:11" (IST). */
export function nseDateToIso(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || '').trim());
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}+05:30`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** One BSE AnnSubCategoryGetData row → filing (null when no PDF). */
export function bseRowToFiling(r) {
  const file = String(r?.ATTACHMENTNAME || '').trim();
  if (!file || !/\.pdf$/i.test(file)) return null;
  const live = String(r?.PDFFLAG ?? '0') === '0';
  const filedAt = bseDateToIso(r?.NEWS_DT || r?.DT_TM);
  if (!filedAt) return null;
  const code = String(r?.SCRIP_CD || '').trim();
  return {
    exchange: 'BSE',
    bseCode: /^\d{6}$/.test(code) ? code : null,
    nseSymbol: null,
    isin: null,
    company: String(r?.SLONGNAME || r?.SHORTNAME || code).trim(),
    subject: String(r?.NEWSSUB || '').replace(/\s+/g, ' ').trim(),
    headline: String(r?.HEADLINE || '').replace(/\s+/g, ' ').trim(),
    category: r?.CATEGORYNAME || null,
    subcategory: r?.SUBCATNAME || null,
    filedAt,
    url: `https://www.bseindia.com/xml-data/corpfiling/${live ? 'AttachLive' : 'AttachHis'}/${file}`,
  };
}

/** One NSE corporate-announcements row → filing. */
export function nseRowToFiling(r) {
  const url = String(r?.attchmntFile || '').trim();
  if (!/^https?:\/\/.+\.pdf$/i.test(url)) return null;
  const filedAt = nseDateToIso(r?.an_dt || r?.sort_date || r?.dt) || bseDateToIso(r?.sort_date);
  if (!filedAt) return null;
  const sym = String(r?.symbol || '').trim().toUpperCase();
  return {
    exchange: 'NSE',
    bseCode: null,
    nseSymbol: /^[A-Z0-9&\-]{1,20}$/.test(sym) ? sym : null,
    isin: String(r?.sm_isin || '').trim() || null,
    company: String(r?.sm_name || sym).trim(),
    subject: String(r?.desc || '').replace(/\s+/g, ' ').trim(),
    headline: String(r?.attchmntText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    category: null,
    subcategory: null,
    filedAt,
    url,
  };
}

// ── ticker map ──────────────────────────────────────────────────────────────

/** NSE EQUITY_L.csv → Map(isin → symbol). */
export function parseEquityL(csv) {
  const out = new Map();
  const lines = String(csv || '').split(/\r?\n/);
  if (!lines.length) return out;
  const head = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const iSym = head.indexOf('SYMBOL');
  const iIsin = head.findIndex((h) => h.startsWith('ISIN'));
  if (iSym < 0 || iIsin < 0) return out;
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const sym = (c[iSym] || '').trim().toUpperCase();
    const isin = (c[iIsin] || '').trim().toUpperCase();
    if (sym && /^IN[A-Z0-9]{10}$/.test(isin)) out.set(isin, sym);
  }
  return out;
}

/** BSE ListofScripData rows → Map(code → isin). */
export function parseBseScripList(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = String(r?.SCRIP_CD ?? '').trim();
    const isin = String(r?.ISIN_NUMBER ?? '').trim().toUpperCase();
    if (/^\d{6}$/.test(code) && /^IN[A-Z0-9]{10}$/.test(isin)) out.set(code, isin);
  }
  return out;
}

/** zzz924: a BSE scrip code is six digits starting with 5 (the equity / SME ranges); anything else is never used to list filings. */
export function validBseCode(c) {
  return /^5\d{5}$/.test(String(c ?? '').trim()) ? String(c).trim() : null;
}

/** BSE ListofScripData rows → Map(trading id such as "MOBAVENUE" → code). Ids that appear twice (ambiguous) or carry an invalid code are left out. */
export function parseBseScripIds(rows) {
  const out = new Map(); const dup = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r?.scrip_id ?? r?.SCRIP_ID ?? '').trim().toUpperCase();
    const code = validBseCode(r?.SCRIP_CD);
    if (!id || !code) continue;
    if (out.has(id) && out.get(id) !== code) dup.add(id);
    out.set(id, code);
  }
  for (const d of dup) out.delete(d);
  return out;
}

/** frontend/src/lib/bse-nse-mapping.ts curated rows → Map(code → symbol). */
export function parseCuratedMap(tsSource) {
  const out = new Map();
  for (const m of String(tsSource || '').matchAll(/nseSymbol:\s*'([A-Z0-9&\-]+)'\s*,\s*bseCode:\s*'(\d{6})'/g)) out.set(m[2], m[1]);
  return out;
}

/** Resolve a filing's NSE symbol: NSE row symbol → ISIN join → curated → null. */
export function resolveTicker(filing, maps = {}) {
  if (filing.nseSymbol) return filing.nseSymbol;
  const { isinToNse, bseToIsin, curated } = maps;
  if (filing.isin && isinToNse?.get(filing.isin)) return isinToNse.get(filing.isin);
  if (filing.bseCode) {
    const isin = bseToIsin?.get(filing.bseCode);
    if (isin && isinToNse?.get(isin)) return isinToNse.get(isin);
    if (curated?.get(filing.bseCode)) return curated.get(filing.bseCode);
  }
  return null;
}

// ── document + batches ──────────────────────────────────────────────────────

/**
 * GuidanceDoc for the ingest route.
 * @param {{ filing: any, kind: string, text: string, url?: string, exchangeUrl?: string|null, ticker?: string|null, collector: string, collectedAt?: string }} a
 */
export function buildDoc(a) {
  const f = a.filing;
  const url = a.url || f.url;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const title = (f.headline && f.headline.length > (f.subject || '').length ? f.headline : f.subject || f.headline || 'Company filing').slice(0, 480);
  const text = String(a.text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const capped = text.length > TEXT_CAP ? text.slice(0, TEXT_CAP) : text;
  const doc = {
    docId: docIdFor(url),
    market: 'IN',
    ticker: a.ticker ?? null,
    bseCode: f.bseCode ?? null,
    company: String(f.company || '').slice(0, 200) || 'Unknown',
    kind: a.kind,
    title,
    url,
    sourceHost: host,
    filedAt: f.filedAt,
    periodHint: extractPeriodHint(`${f.subject || ''} ${f.headline || ''}`),
    textChars: capped.length,
    text: capped,
    collectedAt: a.collectedAt || new Date().toISOString(),
    collector: a.collector,
  };
  if (a.exchangeUrl && a.exchangeUrl !== url) doc.exchangeUrl = a.exchangeUrl;
  return doc;
}

/** Split docs into POST batches of ≤ maxDocs and ≤ maxBytes (JSON bytes). */
export function chunkBatches(docs, o = {}) {
  const maxDocs = o.maxDocs || MAX_BATCH_DOCS;
  const maxBytes = o.maxBytes || MAX_BATCH_BYTES;
  const out = [];
  let cur = [], bytes = 2;
  for (const d of docs) {
    const b = Buffer.byteLength(JSON.stringify(d), 'utf8') + 1;
    if (cur.length && (cur.length >= maxDocs || bytes + b > maxBytes)) { out.push(cur); cur = []; bytes = 2; }
    cur.push(d); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Calendar days (YYYY-MM-DD, IST) newest first, `days` long ending today. */
export function dayList(days, now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const out = [];
  for (let i = 0; i < days; i++) out.push(new Date(ist.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}
