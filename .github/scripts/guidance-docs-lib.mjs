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

const CUE_WORD = /\b(guidance|guiding|guided|guide|outlook|expects?|expecting|expected to|target(?:s|ing|ed)?|growth|grow(?:ing)?|aspir(?:e|ation)|envisag(?:e|ing)|visibility|anticipat(?:e|ing)|forecast)\b/i;
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
 *  https PDF link that is not an exchange host. Only for short texts. */
export function findLinkedPdf(text) {
  const t = String(text || '');
  if (t.length > 6000) return null;
  const re = /https?:\/\/[^\s"'<>()\]]+/gi;
  for (const m of t.matchAll(re)) {
    const u = m[0].replace(/[.,;:]+$/, '');
    let x;
    try { x = new URL(u); } catch { continue; }
    const h = x.hostname.toLowerCase();
    if (/(^|\.)(bseindia\.com|nseindia\.com|sec\.gov)$/.test(h)) continue;
    if (/^\d+(\.\d+)+$/.test(h) || !/\.[a-z]{2,}$/.test(h)) continue;
    if (!/\.pdf$/i.test(x.pathname)) continue;
    x.protocol = 'https:';
    return x.toString();
  }
  return null;
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
