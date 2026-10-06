#!/usr/bin/env node
// zzz857 — EDGAR guidance backfill (US recall).
//
// WHY THIS RUNS ON GITHUB, NOT IN THE APP
//   The app's live EDGAR read shares one 8 req/s gate with every other US job and has a 3-9 s slice of a 30 s route, so a
//   120-day window was read ~2 sessions per run. This job reads the FULL window off-line, at SEC's fair-access pace, and
//   hands every results / Reg FD press release that talks about the future to the app as a GuidanceDoc (the AI extractor
//   reads those). The app then keeps only a small recent live window and counts a day as read when this job indexed it.
//
// WHAT IT DOES, PER TRADING DAY (US Eastern business days, newest first)
//   1. efts full-text search JSON (empty q = one hit per filing; 100 per page) for form 8-K on that day. The daily-index
//      files carry no item codes; efts `_source.items` does (see frontend/src/lib/us-edgar.ts).
//   2. keep plain 8-K (not 8-K/A) with Item 2.02 or 7.01.
//   3. read the filing's own -index.htm document table, take EX-99.1 / EX-99.2 (.htm/.html/.txt).
//   4. HTML -> text (no dependency), keep the document only if it carries a guidance cue outside the safe-harbor paragraph.
//   5. build a GuidanceDoc (frontend/src/lib/guidance-docs-types.ts), POST in batches to /api/v1/guidance-docs/ingest
//      with `coverage` rows for the days finished in that batch.
//   Optional: when UPSTASH_REDIS_REST_URL/TOKEN are set, the per-day coverage is ALSO merged straight into the KV key
//   guidance-docs:v1:coverage:US (same shape the ingest route stores), so coverage is honest even before the route ships.
//
// ENV
//   SEC_USER_AGENT or SEC_CONTACT_EMAIL (required by SEC; a generic UA is a hard 403)
//   CRON_SECRET (header x-cron-secret), CRON_BASE_URL (default: production Railway URL)
//   DAYS (trading days, default 7, max 130), END_DATE (YYYY-MM-DD, default today ET), DRY_RUN=1 (no POST / KV write)
//   SEC_RPS (default 8, hard max 9 — SEC's ceiling is 10)
//   ITEMS (default '2.02' = results releases; '2.02,7.01' opts Reg FD in), MAX_TEXT_CHARS (default 60000; contract cap 120000)
// Logs counts only — never document text, never secrets.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { exitForError } from './lib/resilient-fetch.mjs';   // zzz908: transient-vs-real exit

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Pure helpers (exported for tests: frontend/src/lib/__tests__/zzz857-us.test.ts)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

export const TEXT_CAP = 120_000;          // the contract cap
export const DEFAULT_TEXT_CHARS = 60_000; // zzz857 wave 2: what the job sends by default (the store keeps only guidance passages, cap 30k)
export const MAX_DAYS = 130;
export const COVERAGE_KEY = 'guidance-docs:v1:coverage:US';
export const COVERAGE_KEEP_DAYS = 140;
export const COLLECTOR = 'gh:edgar-guidance-backfill';

/** docId per the shared contract: sha1(url) hex, first 20 chars. */
export function docIdOf(url) {
  return createHash('sha1').update(String(url)).digest('hex').slice(0, 20);
}

/** efts `items` → normalised item codes ('2.02'). Accepts an array or a comma / space separated string; drops junk. */
export function parseItems(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s;]+/) : [];
  const out = [];
  for (const x of list) {
    const m = /^(?:item\s*)?(\d{1,2})\.(\d{1,2})$/i.exec(String(x).trim());
    if (!m) continue;
    const code = `${Number(m[1])}.${m[2].padStart(2, '0')}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** A plain 8-K carrying Item 2.02 (results) or Item 7.01 (Reg FD). Amendments re-file an earlier release: skipped. */
export function isResultsOrRegFd(form, items) {
  if (String(form || '').trim().toUpperCase() !== '8-K') return false;
  const it = parseItems(items);
  return it.includes('2.02') || it.includes('7.01');
}

const NAME_RE = /^(.*?)\s*(?:\(([^()]*)\)\s*)?\(CIK (\d{10})\)\s*$/;
/** efts display name "JABIL INC  (JBL)  (CIK 0000898293)" → { company, ticker, cik } */
export function parseDisplayName(dn) {
  const m = NAME_RE.exec(String(dn || '').trim());
  if (!m) return { company: String(dn || '').trim(), ticker: null, cik: null };
  const tickers = m[2] ? m[2].split(',').map((t) => t.trim()).filter(Boolean) : [];
  return { company: m[1].replace(/\s+/g, ' ').trim(), ticker: tickers[0] ? tickers[0].toUpperCase() : null, cik: m[3] };
}

/** One efts hit → a filing row, or null. The archive path uses the COMPANY's CIK (the accession prefix may be a filing agent). */
export function filingFromHit(hit, dayFallback) {
  const s = hit && hit._source; if (!s) return null;
  const dn = Array.isArray(s.display_names) ? s.display_names[0] : '';
  const p = parseDisplayName(dn);
  const cik = p.cik || (Array.isArray(s.ciks) ? s.ciks[0] : null);
  const acc = String(s.adsh || '');
  if (!cik || !/^\d{10}-\d{2}-\d{6}$/.test(acc)) return null;
  const cikNum = Number(cik);
  const nod = acc.replace(/-/g, '');
  return {
    cik: String(cik).padStart(10, '0'), cikNum, company: p.company || String(dn || ''), tickerHint: p.ticker,
    form: String(s.form || ''), items: parseItems(s.items), accession: acc, filed: String(s.file_date || dayFallback || '').slice(0, 10),
    indexUrl: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${nod}/${acc}-index.htm`,
  };
}

/** company_tickers.json ({"0":{cik_str,ticker,title}}) → Map<cikNum, ticker> (first ticker listed wins: SEC lists the primary first). */
export function cikTickerMapOf(json) {
  const m = new Map();
  if (!json || typeof json !== 'object') return m;
  for (const k of Object.keys(json)) {
    const v = json[k]; const cik = Number(v && v.cik_str); const t = String((v && v.ticker) || '').toUpperCase().trim();
    if (Number.isFinite(cik) && cik > 0 && t && !m.has(cik)) m.set(cik, t);
  }
  return m;
}

const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/\s+/g, ' ').trim();
/** The filing's -index.htm document table → rows { seq, description, name, url, type, size }. Columns are read relative to the cell holding the link. */
export function parseFilingIndex(html) {
  const out = [];
  const rows = String(html || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const r of rows.slice(0, 300)) {
    const cells = r.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 4) continue;
    const aIdx = cells.findIndex((c) => /<a[^>]+href=/i.test(c));
    if (aIdx < 0) continue;
    const href = /<a[^>]+href=["']([^"']+)["']/i.exec(cells[aIdx])?.[1] || '';
    if (!href) continue;
    const path = href.replace(/^\/ix\?doc=/, '');
    const url = /^https?:/i.test(path) ? path : `https://www.sec.gov${path.startsWith('/') ? '' : '/'}${path}`;
    const name = path.split('/').pop() || '';
    const txt = cells.map(stripTags);
    const size = parseInt(String(txt[aIdx + 2] || '').replace(/[^\d]/g, ''), 10);
    out.push({ seq: txt[0] || '', description: aIdx > 0 ? txt[aIdx - 1] : '', name, url, type: (txt[aIdx + 1] || '').toUpperCase(), size: Number.isFinite(size) ? size : 0 });
  }
  return out;
}

/** EX-99.1 first, then EX-99.2; readable formats only (.htm/.html/.txt); at most `max`. Falls back to a bare EX-99 when no .1/.2 exists. */
export function pickExhibits(rows, max = 2) {
  const readable = (r) => /\.(?:htm|html|txt)$/i.test(r.name);
  const num = (r) => { const m = /^EX-99(?:\.(\d+))?$/i.exec(String(r.type || '').trim()); return m ? (m[1] ? Number(m[1]) : 0) : -1; };
  const ex = (rows || []).filter((r) => readable(r) && num(r) >= 0);
  const main = ex.filter((r) => num(r) === 1 || num(r) === 2).sort((a, b) => num(a) - num(b));
  const pool = main.length ? main : ex.filter((r) => num(r) === 0);
  const seen = new Set(); const out = [];
  for (const r of pool) { if (seen.has(r.url)) continue; seen.add(r.url); out.push(r); if (out.length >= max) break; }
  return out;
}

const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', reg: '®', trade: '™', copy: '©',
  dollar: '$', percnt: '%', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', deg: '°',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', minus: '−', shy: '',
  zwj: '', zwnj: '', ensp: ' ', emsp: ' ', thinsp: ' ', lpar: '(', rpar: ')', comma: ',', period: '.', colon: ':', semi: ';', sol: '/',
};
/** Decode HTML entities: named (a curated table), decimal and hex. An unknown named entity is dropped, never left as text. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return ' ';
      if (cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f) return ' ';
      if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xad || cp === 0xfeff) return '';
      return String.fromCodePoint(cp);
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? ' ' : v;
  });
}

/**
 * HTML → plain text, careful about the things SEC exhibits do:
 *  - inline-XBRL <ix:header> (hidden facts), <script>/<style>/<head>, comments and CDATA are removed whole;
 *  - block tags become line breaks, table cells become " | " so a table row stays one readable line;
 *  - entities are decoded AFTER tags are gone (so "&lt;b&gt;" text never turns into a tag), hex included (&#x2013; is a dash, not "x2013");
 *  - whitespace is collapsed per line, blank lines collapsed, cell separators tidied.
 * A .txt exhibit (no tags) passes through with only <PAGE>-style markers removed.
 */
export function htmlToText(input) {
  let h = String(input || '');
  if (!/<[a-z!/][^>]*>/i.test(h)) return h.replace(/\r/g, '').replace(/^<\/?(?:PAGE|DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT)>.*$/gim, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  h = h.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<(script|style|head|title|ix:header|xbrli?:[a-z]+)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, ' ');
  h = h.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|th)\s*>/gi, ' | ')
    .replace(/<\/?(?:p|div|tr|li|ul|ol|table|thead|tbody|tfoot|h[1-6]|section|article|header|footer|blockquote|pre|center|hr|dt|dd|dl)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  h = decodeEntities(h).replace(/ /g, ' ').replace(/\r/g, '');
  const lines = h.split('\n').map((l) => l.replace(/[ \t\f\v]+/g, ' ').replace(/(?:\s*\|\s*)+/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim()).filter((l) => l.length > 0);
  return lines.join('\n').trim();
}

const CUE_RE = /\b(?:guidance|outlook|expects?|sees|raises?|raised|raising|reaffirms?|reaffirmed|reaffirming|reiterates?|reiterated|reiterating|now\s+anticipates?|full[- ]year|fiscal\s+(?:year\s+)?20\d{2})\b/gi;
/** a dollar figure, a percentage, or a numeric range ("1.2 to 1.3", "5–7") */
const NUM_RE = /\$\s?\d|\b\d+(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|m|b)?\s?(?:-|–|—|to)\s?\$?\d/i;
export const CUE_WINDOW = 300;
const SAFE_HARBOR_RE = /forward[- ]looking\s+statements?|private\s+securities\s+litigation\s+reform|safe\s+harbor/i;
/** Drop the safe-harbor / forward-looking-statements boilerplate (every release says "expects" there) before looking for cues. */
export function withoutSafeHarbor(text) {
  const paras = String(text || '').split(/\n+/);
  const out = []; let skipping = 0;
  for (const p of paras) {
    if (SAFE_HARBOR_RE.test(p)) { skipping = 3; continue; }   // the boilerplate heading and the next couple of paragraphs
    if (skipping > 0 && p.length > 120) { skipping--; continue; }
    if (skipping > 0 && p.length <= 120) skipping--;
    out.push(p);
  }
  return out.join('\n');
}
/**
 * Keep a document only when it talks about the future WITH a figure: an explicit guidance cue outside the safe-harbor boilerplate that has a
 * number / range / percentage within CUE_WINDOW characters of it. (zzz857 wave 2: a bare "expects" or "full-year" with no figure nearby is
 * dropped — it cannot carry a guided number.) The cue word itself is excluded from the number check ("fiscal 2027" is not a figure).
 */
export function hasGuidanceCue(text, windowChars = CUE_WINDOW) {
  const t = withoutSafeHarbor(text);
  CUE_RE.lastIndex = 0;
  let m;
  while ((m = CUE_RE.exec(t))) {
    const before = t.slice(Math.max(0, m.index - windowChars), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
    if (NUM_RE.test(before) || NUM_RE.test(after)) return true;
  }
  return false;
}

const ORD = { first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
/** "Second Quarter Fiscal 2027" → "Q2 FY27"; "Q3 2026" → "Q3 FY26"; "Fiscal Year 2026" / "Full Year 2026" → "FY26". Only from the head of the doc. Null when unsure. */
export function periodHintOf(text) {
  const head = String(text || '').slice(0, 1500);
  let m = /\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(?:fiscal\s+)?quarter\s+(?:(?:and|&)\s+(?:full[- ]|fiscal\s+)?year\s+)?(?:of\s+)?(?:fiscal\s+(?:year\s+)?)?(?:FY\s?)?(20\d{2})\b/i.exec(head);
  if (m) return `Q${ORD[m[1].toLowerCase()]} FY${m[2].slice(2)}`;
  m = /\b(?:fiscal\s+)?(?:FY\s?)?(20\d{2})\s+(first|second|third|fourth)\s+quarter\b/i.exec(head);
  if (m) return `Q${ORD[m[2].toLowerCase()]} FY${m[1].slice(2)}`;
  m = /\bQ([1-4])\s*(?:FY\s?|fiscal\s+)?'?(20\d{2}|\d{2})\b/i.exec(head);
  if (m) return `Q${m[1]} FY${m[2].slice(-2)}`;
  m = /\b(?:full[- ]year|fiscal\s+year|fiscal)\s+(20\d{2})\b/i.exec(head);
  if (m) return `FY${m[1].slice(2)}`;
  return null;
}

/** Kind of the company document: a 2.02 release is RESULTS_RELEASE; a 7.01-only exhibit is a deck / transcript / other company doc by its own wording. */
export function kindOf(items, exhibit) {
  const it = parseItems(items);
  const words = `${exhibit?.description || ''} ${exhibit?.name || ''}`;
  if (/transcript|prepared[-_\s]*remarks|conference[-_\s]*call/i.test(words)) return 'TRANSCRIPT';
  if (/present|slide|deck/i.test(words)) return 'PRESENTATION';
  if (it.includes('2.02')) return 'RESULTS_RELEASE';
  if (/press[-_\s]*release|news[-_\s]*release|earnings|results/i.test(words)) return 'RESULTS_RELEASE';
  return 'OTHER_COMPANY_DOC';
}

/** Build the GuidanceDoc (contract: frontend/src/lib/guidance-docs-types.ts). Text capped at TEXT_CAP characters. */
export function buildGuidanceDoc({ filing, exhibit, text, ticker, now }) {
  const t = String(text || '').slice(0, TEXT_CAP);
  const items = parseItems(filing.items);
  const label = exhibit.description && !/^EX-?99/i.test(exhibit.description) ? exhibit.description : exhibit.type || 'EX-99';
  return {
    docId: docIdOf(exhibit.url),
    market: 'US',
    ticker: ticker || null,
    cik: filing.cik || null,
    company: filing.company,
    kind: kindOf(items, exhibit),
    title: `${filing.company}: ${label} (8-K item${items.filter((i) => i !== '9.01').length > 1 ? 's' : ''} ${items.filter((i) => i !== '9.01').join(', ')})`.slice(0, 300),
    url: exhibit.url,
    sourceHost: 'sec.gov',
    filedAt: filing.filed,
    periodHint: periodHintOf(t),
    textChars: t.length,
    text: t,
    collectedAt: (now || new Date()).toISOString(),
    collector: COLLECTOR,
  };
}

/** Split docs into POST batches bounded by count AND serialized size (the body stays well under the platform's limits). */
export function batchBySize(docs, maxBytes = 1_500_000, maxCount = 15) {
  const out = []; let cur = []; let size = 0;
  for (const d of docs) {
    const s = JSON.stringify(d).length;
    if (cur.length && (cur.length >= maxCount || size + s > maxBytes)) { out.push(cur); cur = []; size = 0; }
    cur.push(d); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** US Eastern business days (Mon-Fri), newest first, ending at `end` (YYYY-MM-DD), `n` of them (capped at MAX_DAYS). */
export function tradingDays(end, n) {
  const k = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(n) || 0)));
  const out = []; let t = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(t)) return out;
  while (out.length < k) {
    const d = new Date(t); const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    t -= 86_400_000;
  }
  return out;
}
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayEt = (now = new Date()) => ET.format(now);

/** Per-day status from what happened: index unreadable → failed; any exhibit / POST failure → partial; else ok. */
export function dayStatus({ indexOk, exhibitFailures, postFailures }) {
  if (!indexOk) return 'failed';
  return exhibitFailures > 0 || postFailures > 0 ? 'partial' : 'ok';
}

/**
 * Merge coverage rows into the stored record. Shape (KV guidance-docs:v1:coverage:US):
 *   { v: 1, market: 'US', updatedAt, days: { 'YYYY-MM-DD': { status: 'ok'|'partial'|'failed', filings, docs, at } } }
 * A newer row replaces the older one for the same day, EXCEPT that a 'failed' re-run never downgrades a day already 'ok'
 * (a transient SEC error must not un-read a day). Days older than `keepDays` before the newest are dropped.
 */
export function mergeCoverage(existing, rows, now = new Date(), keepDays = COVERAGE_KEEP_DAYS) {
  const days = { ...((existing && typeof existing === 'object' && existing.days && typeof existing.days === 'object') ? existing.days : {}) };
  for (const [d, r] of Object.entries(rows || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !r) continue;
    const row = typeof r === 'string' ? { status: r } : r;
    if (!['ok', 'partial', 'failed'].includes(row.status)) continue;
    const prev = days[d];
    if (prev && prev.status === 'ok' && row.status === 'failed') continue;
    days[d] = { status: row.status, filings: Number(row.filings) || 0, docs: Number(row.docs) || 0, at: row.at || now.toISOString() };
  }
  const keys = Object.keys(days).sort();
  const newest = keys[keys.length - 1];
  if (newest) {
    const cut = new Date(Date.parse(`${newest}T00:00:00Z`) - keepDays * 86_400_000).toISOString().slice(0, 10);
    for (const k of keys) if (k < cut) delete days[k];
  }
  return { v: 1, market: 'US', updatedAt: now.toISOString(), days };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Network (runner only)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

const EFTS = 'https://efts.sec.gov/LATEST/search-index';
const PROD = 'https://market-cockpit-production.up.railway.app';

function secUserAgent() {
  const ua = (process.env.SEC_USER_AGENT || '').trim();
  if (ua) return ua;
  const mail = (process.env.SEC_CONTACT_EMAIL || '').trim();
  return mail ? `market-cockpit research ${mail}` : '';
}

let lastSlot = 0;
async function gate(rps) {
  const gap = Math.ceil(1000 / rps);
  const now = Date.now(); const slot = Math.max(now, lastSlot + gap); lastSlot = slot;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

function makeSec(ua, rps, stats) {
  return async function secGet(url, { json = false, tries = 3 } = {}) {
    let last = null;
    for (let a = 0; a < tries; a++) {
      await gate(rps); stats.requests++;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: json ? 'application/json' : 'text/html,text/plain,*/*', 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(25_000) });
        if (res.status === 404) return { ok: false, status: 404, body: null };
        if (res.ok) return { ok: true, status: res.status, body: json ? await res.json() : await res.text() };
        last = `HTTP ${res.status}`;
        if (res.status === 403 || res.status === 429) await new Promise((r) => setTimeout(r, 5_000 * (a + 1)));   // SEC throttle: back off hard
      } catch (e) { last = String((e && e.name) || e); }
      await new Promise((r) => setTimeout(r, 600 * (a + 1)));
    }
    return { ok: false, status: 0, body: null, error: last };
  };
}

async function listDay(secGet, day) {
  const out = []; let from = 0;
  for (let page = 0; page < 40; page++) {
    const qs = new URLSearchParams({ q: '', forms: '8-K', startdt: day, enddt: day, from: String(from) });
    const r = await secGet(`${EFTS}?${qs}`, { json: true });
    if (!r.ok) return { ok: false, filings: out };
    const hits = r.body?.hits?.hits || []; const total = r.body?.hits?.total?.value ?? 0;
    for (const h of hits) { const f = filingFromHit(h, day); if (f) out.push(f); }
    from += hits.length;
    if (!hits.length || from >= total) break;
  }
  return { ok: true, filings: out };
}

async function kvGetJson(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL; const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = await r.json(); let v = j?.result;
    if (typeof v === 'string') { try { v = JSON.parse(v); if (typeof v === 'string') v = JSON.parse(v); } catch { return null; } }
    return v ?? null;
  } catch { return null; }
}
async function kvSetJson(key, value, ttl) {
  const url = process.env.UPSTASH_REDIS_REST_URL; const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return false;
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttl}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(15_000) });
    return r.ok;
  } catch { return false; }
}

async function postIngest(base, secret, payload) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`${base.replace(/\/+$/, '')}/api/v1/guidance-docs/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000),
      });
      if (r.ok) { const j = await r.json().catch(() => ({})); return { ok: true, status: r.status, stored: Number(j?.stored ?? j?.accepted ?? payload.docs.length) }; }
      if (r.status === 401 || r.status === 403 || r.status === 404) return { ok: false, status: r.status };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2_000 * (a + 1)));
  }
  return { ok: false, status: 0 };
}

async function main() {
  const t0 = Date.now();
  const ua = secUserAgent();
  if (!ua) { console.error('::error title=Missing SEC contact::Set SEC_USER_AGENT or SEC_CONTACT_EMAIL (SEC rejects requests without a contact User-Agent).'); process.exit(1); }
  const dry = process.env.DRY_RUN === '1';
  const secret = process.env.CRON_SECRET || '';
  if (!dry && !secret) { console.error('::error title=Missing CRON_SECRET::Set CRON_SECRET (or run with DRY_RUN=1).'); process.exit(1); }
  const base = (process.env.CRON_BASE_URL || '').trim() || PROD;
  const nDays = Math.max(1, Math.min(MAX_DAYS, parseInt(process.env.DAYS || '7', 10) || 7));
  const end = /^\d{4}-\d{2}-\d{2}$/.test(process.env.END_DATE || '') ? process.env.END_DATE : todayEt();
  const rps = Math.max(1, Math.min(9, Number(process.env.SEC_RPS) || 8));
  const wantItems = parseItems(process.env.ITEMS || '2.02').filter((i) => i === '2.02' || i === '7.01');
  const items = wantItems.length ? wantItems : ['2.02'];
  const textCap = Math.max(5_000, Math.min(TEXT_CAP, parseInt(process.env.MAX_TEXT_CHARS || '', 10) || DEFAULT_TEXT_CHARS));
  const stats = { requests: 0 };
  const secGet = makeSec(ua, rps, stats);
  const days = tradingDays(end, nDays);
  console.log(`edgar-guidance-backfill: ${days.length} trading days ${days[days.length - 1]}..${days[0]}, items ${items.join('+')}, ${rps} req/s, text cap ${textCap}, dry=${dry}`);

  const tk = await secGet('https://www.sec.gov/files/company_tickers.json', { json: true });
  const tickers = tk.ok ? cikTickerMapOf(tk.body) : new Map();
  console.log(`ticker map: ${tickers.size} CIKs${tk.ok ? '' : ' (download failed; using efts display names)'}`);

  const tot = { filings: 0, matched: 0, exhibits: 0, exhibitFail: 0, kept: 0, noCue: 0, empty: 0, posted: 0, postFail: 0, daysOk: 0, daysPartial: 0, daysFailed: 0 };
  const coverageAll = {}; let pending = 0;
  // direct KV merge (optional): flushed every 10 days so a long run that dies part-way keeps what it finished
  const flushCoverage = async () => {
    if (dry || !pending || !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return;
    const merged = mergeCoverage(await kvGetJson(COVERAGE_KEY), coverageAll, new Date());
    const ok = await kvSetJson(COVERAGE_KEY, merged, 150 * 24 * 3600);
    pending = 0;
    console.log(`coverage KV ${COVERAGE_KEY}: ${ok ? 'written' : 'write failed'} (${Object.keys(merged.days).length} days held)`);
  };
  for (const day of days) {
    const listed = await listDay(secGet, day);
    const matched = listed.filings.filter((f) => isResultsOrRegFd(f.form, f.items) && f.items.some((i) => items.includes(i)));
    tot.filings += listed.filings.length; tot.matched += matched.length;
    const docs = []; let exFail = 0; let noCue = 0; let empty = 0;
    for (const f of matched) {
      const idx = await secGet(f.indexUrl);
      if (!idx.ok) { exFail++; continue; }
      for (const ex of pickExhibits(parseFilingIndex(idx.body))) {
        tot.exhibits++;
        const r = await secGet(ex.url);
        if (!r.ok) { if (r.status !== 404) exFail++; continue; }
        const text = htmlToText(r.body);
        if (text.length < 200) { empty++; continue; }
        if (!hasGuidanceCue(text)) { noCue++; continue; }
        docs.push(buildGuidanceDoc({ filing: f, exhibit: ex, text: text.slice(0, textCap), ticker: tickers.get(f.cikNum) || f.tickerHint, now: new Date() }));
      }
    }
    let postFail = 0; let posted = 0;
    const batches = batchBySize(docs);
    if (!dry) {
      for (let i = 0; i < batches.length; i++) {
        const res = await postIngest(base, secret, { market: 'US', collector: COLLECTOR, docs: batches[i] });
        if (res.ok) posted += batches[i].length; else { postFail++; console.log(`  ${day}: ingest batch ${i + 1}/${batches.length} failed (HTTP ${res.status})`); }
      }
    }
    // the day's coverage row goes AFTER its documents, so a day is never 'ok' before its documents are stored
    const st = dayStatus({ indexOk: listed.ok, exhibitFailures: exFail, postFailures: postFail });
    const row = { [day]: { status: st, filings: matched.length, docs: docs.length, at: new Date().toISOString() } };
    if (!dry) { const c = await postIngest(base, secret, { market: 'US', collector: COLLECTOR, docs: [], coverage: { market: 'US', days: row } }); if (!c.ok) console.log(`  ${day}: coverage row not accepted by ingest (HTTP ${c.status})`); }
    Object.assign(coverageAll, row); pending++;
    if (pending >= 10) await flushCoverage();
    tot.exhibitFail += exFail; tot.noCue += noCue; tot.empty += empty; tot.kept += docs.length; tot.posted += posted; tot.postFail += postFail;
    if (st === 'ok') tot.daysOk++; else if (st === 'partial') tot.daysPartial++; else tot.daysFailed++;
    console.log(`  ${day}: ${st} 8-K=${listed.filings.length} items2.02/7.01=${matched.length} kept=${docs.length} chars=${docs.reduce((n, d) => n + d.textChars, 0)} noCue=${noCue} empty=${empty} exhibitFail=${exFail} posted=${posted}`);
  }

  await flushCoverage();
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`done in ${secs}s: requests=${stats.requests} 8-K=${tot.filings} matched=${tot.matched} exhibits=${tot.exhibits} kept=${tot.kept} noCue=${tot.noCue} empty=${tot.empty} exhibitFail=${tot.exhibitFail} posted=${tot.posted} postFail=${tot.postFail} days ok=${tot.daysOk} partial=${tot.daysPartial} failed=${tot.daysFailed}`);
  if (tot.daysFailed === days.length) process.exit(1);
}

const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();
if (isMain) main().catch((e) => exitForError(e, 'edgar-guidance-backfill failed'));
