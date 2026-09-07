// ═══════════════════════════════════════════════════════════════════════════
// SEC EDGAR CLIENT (server-only).
//
// Three endpoints, all free, all keyless, no rate wall:
//   1. https://www.sec.gov/files/company_tickers.json        ticker ↔ CIK
//   2. https://efts.sec.gov/LATEST/search-index               "who filed on D"
//   3. https://data.sec.gov/api/xbrl/companyfacts/CIK….json   the numbers
//
// TWO HARD RULES, both verified the hard way:
//   • A missing or generic User-Agent is a HARD 403 on both sec.gov and
//     efts.sec.gov. Node's fetch sends its own UA, so it MUST be overridden on
//     every single call or the route returns nothing in production while
//     working fine in any browser-based test.
//   • SEC's published ceiling is 10 req/s. We hold ~6/s via `secGate`.
//
// FINDING THE EARNINGS FILERS FOR A DATE
// ───────────────────────────────────────
// An earnings release is an 8-K carrying Item 2.02 ("Results of Operations and
// Financial Condition"). The daily-index files do NOT contain item codes, and
// the `items=` query parameter on efts is silently IGNORED (it returns the same
// total with and without it) — so we pull every 8-K for the date and filter on
// `_source.items` client-side. That field is real and reliable: Apple's
// earnings 8-Ks all carry ["2.02","9.01"], NVIDIA's Q2 8-K on 2026-08-26 does
// too, and a full accession-number diff of efts against form.YYYYMMDD.idx for
// 2026-09-03 matched 165/165 with zero on either side. Two more efts quirks
// baked in below: page size is fixed at 100 regardless of `size=`, and an
// EMPTY `q=` returns one hit per FILING (a non-empty text query returns one hit
// per DOCUMENT, so filings appear twice).
// ═══════════════════════════════════════════════════════════════════════════

// NOTE: no `import 'server-only'` — that package is not a dependency of this
// repo. This module is only ever imported from a route handler.

const SEC_UA = process.env.SEC_USER_AGENT || 'market-cockpit research radhev.232@gmail.com';
const EFTS = 'https://efts.sec.gov/LATEST/search-index';

// ─── politeness gate: ≤6 concurrent-ish requests/second to sec.gov ─────────
let _lastSlot = 0;
async function secGate(): Promise<void> {
  const MIN_GAP_MS = 165;                        // ≈6 req/s
  const now = Date.now();
  const slot = Math.max(now, _lastSlot + MIN_GAP_MS);
  _lastSlot = slot;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function secFetch(url: string, tries = 3): Promise<Response> {
  let lastErr: any = null;
  for (let a = 0; a < tries; a++) {
    await secGate();
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': SEC_UA,                  // non-negotiable — see header note
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        cache: 'no-store',
      });
      if (res.ok) return res;
      if (res.status === 404) return res;        // genuinely absent; don't retry
      lastErr = new Error(`SEC ${res.status} for ${url}`);
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 400 * (a + 1)));
  }
  throw lastErr || new Error('SEC fetch failed');
}

async function secJson(url: string, tries = 3): Promise<any | null> {
  const res = await secFetch(url, tries);
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// ─── ticker ↔ CIK ↔ exchange map (refreshed daily) ────────────────────────
// `company_tickers_exchange.json` carries the listing venue, which is what
// lets us keep the calendar to real NYSE/Nasdaq common stock. Without it the
// EDGAR filer set is ~20% OTC shells, SPAC blank-checks, crypto trusts and
// preferred-share lines — a live audit of one 12-day window found 42 such
// rows out of 269.
const MAJOR_EXCHANGES = new Set(['NYSE', 'Nasdaq', 'NYSE American', 'NYSE MKT', 'NYSE Arca', 'CBOE', 'Cboe']);

interface Listing { ticker: string; exchange: string | null; }
let _listings: { at: number; byCik: Map<number, Listing[]>; byTicker: Map<string, { cik: number; exchange: string | null }> } | null = null;

async function listings() {
  if (_listings && Date.now() - _listings.at < 24 * 3600_000) return _listings;
  const byCik = new Map<number, Listing[]>();
  const byTicker = new Map<string, { cik: number; exchange: string | null }>();
  const j = await secJson('https://www.sec.gov/files/company_tickers_exchange.json');
  const fields: string[] = j?.fields || [];
  const iCik = fields.indexOf('cik'), iT = fields.indexOf('ticker'), iX = fields.indexOf('exchange');
  if (Array.isArray(j?.data) && iCik >= 0 && iT >= 0) {
    for (const row of j.data as any[]) {
      const cik = Number(row[iCik]); const t = String(row[iT] || '').toUpperCase();
      if (!t || !Number.isFinite(cik)) continue;
      const ex = iX >= 0 && row[iX] ? String(row[iX]) : null;
      if (!byCik.has(cik)) byCik.set(cik, []);
      byCik.get(cik)!.push({ ticker: t, exchange: ex });
      if (!byTicker.has(t)) byTicker.set(t, { cik, exchange: ex });
    }
  } else {
    // Fallback to the plain file (no exchange info) so a schema change can't
    // take the whole engine down.
    const p = await secJson('https://www.sec.gov/files/company_tickers.json');
    if (p) for (const k of Object.keys(p)) {
      const v = p[k]; const cik = Number(v?.cik_str); const t = String(v?.ticker || '').toUpperCase();
      if (!t || !Number.isFinite(cik)) continue;
      if (!byCik.has(cik)) byCik.set(cik, []);
      byCik.get(cik)!.push({ ticker: t, exchange: null });
      if (!byTicker.has(t)) byTicker.set(t, { cik, exchange: null });
    }
  }
  _listings = { at: Date.now(), byCik, byTicker };
  return _listings;
}

/** Preferred lines, warrants, units and rights are not the common stock.
 *  Hyphenated suffixes are NYSE style; a fifth letter W/R/U/L/P/Q is the
 *  Nasdaq convention (warrant / right / unit / misc / preferred / bankrupt). */
const NON_COMMON_RE = /(-P[A-Z]?$|-W[A-Z]?$|-U$|-R$|-WT$|\.WS$|\.U$|\.R$|^[A-Z]{4}[WRULPQ]$)/;

/**
 * The tradeable common-stock ticker for a CIK on a major US exchange, or null
 * when the issuer has none (OTC, unlisted, funds). Among several listed
 * classes prefers the one without a class suffix, then the alphabetically
 * later class (BF-B over BF-A, the liquid line in the common dual-class case).
 */
export async function primaryTicker(cikNum: number): Promise<{ ticker: string; exchange: string | null } | null> {
  const L = await listings();
  const rows = (L.byCik.get(cikNum) || []).filter((r) => !NON_COMMON_RE.test(r.ticker));
  if (!rows.length) return null;
  const major = rows.filter((r) => r.exchange && MAJOR_EXCHANGES.has(r.exchange));
  const pool = major.length ? major : (rows.some((r) => r.exchange) ? [] : rows);
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const sa = a.ticker.includes('-') ? 1 : 0, sb = b.ticker.includes('-') ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return b.ticker.localeCompare(a.ticker);
  });
  return { ticker: pool[0].ticker, exchange: pool[0].exchange };
}

export async function isMajorListed(ticker: string): Promise<boolean> {
  const L = await listings();
  const r = L.byTicker.get(ticker.toUpperCase());
  if (!r) return false;
  if (NON_COMMON_RE.test(ticker.toUpperCase())) return false;
  return !r.exchange || MAJOR_EXCHANGES.has(r.exchange);
}

/** CIK → primary ticker (major exchanges only). Kept for callers that need the plain map. */
export async function cikTickerMap(): Promise<Map<number, string>> {
  const L = await listings();
  const out = new Map<number, string>();
  L.byCik.forEach((rows, cik) => {
    const clean = rows.filter((r) => !NON_COMMON_RE.test(r.ticker));
    const major = clean.filter((r) => r.exchange && MAJOR_EXCHANGES.has(r.exchange));
    const pick = (major.length ? major : clean)[0];
    if (pick) out.set(cik, pick.ticker);
  });
  return out;
}

export async function tickerToCik(ticker: string): Promise<number | null> {
  const L = await listings();
  const t = ticker.toUpperCase().replace(/\./g, '-');
  return L.byTicker.get(t)?.cik ?? L.byTicker.get(ticker.toUpperCase())?.cik ?? null;
}

// ─── submissions (filing history + SIC + exchanges), cached 6h ─────────────
export interface SubmissionsLite {
  sic: string | null;
  sicDescription: string | null;
  exchanges: string[];
  tickers: string[];
  name: string | null;
  recent: Array<{ form: string; filingDate: string; reportDate: string | null; items: string[]; accession: string }>;
}
const _subs = new Map<number, { at: number; data: SubmissionsLite | null }>();
export async function submissions(cikNum: number): Promise<SubmissionsLite | null> {
  const hit = _subs.get(cikNum);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
  let out: SubmissionsLite | null = null;
  try {
    const j = await secJson(`https://data.sec.gov/submissions/CIK${String(cikNum).padStart(10, '0')}.json`, 2);
    if (j) {
      const r = j.filings?.recent || {};
      const n = Array.isArray(r.form) ? r.form.length : 0;
      const recent: SubmissionsLite['recent'] = [];
      // Scan the whole `recent` block (up to 1000). A money-centre bank files
      // hundreds of 424B prospectus supplements a quarter; a 400-row cap did
      // not reach back to JPM's July earnings 8-K.
      for (let i = 0; i < n; i++) {
        recent.push({
          form: String(r.form[i] || ''),
          filingDate: String(r.filingDate?.[i] || ''),
          reportDate: r.reportDate?.[i] ? String(r.reportDate[i]) : null,
          items: String(r.items?.[i] || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          accession: String(r.accessionNumber?.[i] || ''),
        });
      }
      out = {
        sic: j.sic ? String(j.sic) : null,
        sicDescription: j.sicDescription ? String(j.sicDescription) : null,
        exchanges: Array.isArray(j.exchanges) ? j.exchanges.filter(Boolean).map(String) : [],
        tickers: Array.isArray(j.tickers) ? j.tickers.filter(Boolean).map(String) : [],
        name: j.name ? String(j.name) : null,
        recent,
      };
    }
  } catch { out = null; }
  if (_subs.size > 1500) {
    const oldest = Array.from(_subs.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 300);
    for (const [k] of oldest) _subs.delete(k);
  }
  _subs.set(cikNum, { at: Date.now(), data: out });
  return out;
}

/**
 * The date a company ACTUALLY announced the quarter a 10-Q/10-K reports.
 * Most issuers press-release (8-K Item 2.02) first and file the 10-Q days or
 * weeks later; listing the 10-Q date as "reported today" is how HD, CSCO and
 * KEYS showed up 1–3 weeks after the market had already traded their prints.
 * Returns the 8-K date when one exists in the 30 days before the periodic
 * filing, else the periodic filing's own date (small issuers often skip the
 * 8-K and the 10-Q genuinely is the first disclosure).
 */
export async function announcementDateFor(cikNum: number, periodicFiledOn: string): Promise<{ date: string; via: '8-K' | 'periodic' }> {
  const s = await submissions(cikNum);
  if (!s) return { date: periodicFiledOn, via: 'periodic' };
  const lo = new Date(Date.parse(periodicFiledOn + 'T00:00:00Z') - 30 * 86_400_000).toISOString().slice(0, 10);
  let best: string | null = null;
  for (const f of s.recent) {
    if (f.form !== '8-K') continue;
    if (!f.items.includes('2.02')) continue;
    if (f.filingDate > periodicFiledOn || f.filingDate < lo) continue;
    if (!best || f.filingDate > best) best = f.filingDate;
  }
  return best ? { date: best, via: '8-K' } : { date: periodicFiledOn, via: 'periodic' };
}

/** Blank-check / SPAC / fund-like issuers have no earnings to grade. */
export function looksLikeShell(company: string, sic: string | null): boolean {
  const n = parseInt(sic || '', 10);
  if (n === 6770) return true;                              // blank checks
  if (n === 6221) return true;                              // commodity / crypto trusts
  if (/\b(acquisition|merger)\s+corp/i.test(company)) return true;
  if (/\bETF\b/i.test(company)) return true;
  if (/\b(bitcoin|ether|ethereum|solana|xrp|litecoin)\b.*\btrust\b/i.test(company)) return true;
  return false;
}

export interface EdgarFiling {
  cik: string;              // zero-padded 10-digit
  cikNum: number;
  ticker: string | null;
  company: string;
  form: string;
  items: string[];
  accession: string;
  filed: string;            // YYYY-MM-DD
  period: string | null;    // period_ending as EDGAR reports it
  sic: string | null;
  filing_url: string;
}

const NAME_RE = /^(.*?)\s*(?:\(([^()]*)\)\s*)?\(CIK (\d{10})\)\s*$/;
function parseDisplayName(dn: string): { company: string; ticker: string | null; cik: string | null } {
  const m = NAME_RE.exec(dn || '');
  if (!m) return { company: dn, ticker: null, cik: null };
  const tickers = m[2] ? m[2].split(',').map((t) => t.trim()).filter(Boolean) : [];
  return { company: m[1].trim(), ticker: tickers[0] ? tickers[0].toUpperCase() : null, cik: m[3] };
}

/** Every filing of the given forms on one date. Paginates efts by 100. */
export async function edgarFilingsOn(date: string, forms: string[]): Promise<EdgarFiling[]> {
  const out: EdgarFiling[] = [];
  let from = 0;
  for (let page = 0; page < 40; page++) {           // hard stop: 4000 filings
    const qs = new URLSearchParams({
      q: '',                                       // empty q ⇒ one hit per FILING
      forms: forms.join(','),
      startdt: date, enddt: date,
      from: String(from),
    });
    const j = await secJson(`${EFTS}?${qs.toString()}`);
    const hits: any[] = j?.hits?.hits || [];
    const total: number = j?.hits?.total?.value ?? 0;
    for (const h of hits) {
      const s = h?._source; if (!s) continue;
      const dn = Array.isArray(s.display_names) ? s.display_names[0] : '';
      const parsed = parseDisplayName(String(dn || ''));
      const cik = parsed.cik || (Array.isArray(s.ciks) ? s.ciks[0] : null);
      if (!cik) continue;
      const cikNum = Number(cik);
      const acc = String(s.adsh || '');
      const nod = acc.replace(/-/g, '');
      out.push({
        cik: String(cik).padStart(10, '0'),
        cikNum,
        ticker: parsed.ticker,
        company: parsed.company || String(dn),
        form: String(s.form || ''),
        items: Array.isArray(s.items) ? s.items.map(String) : [],
        accession: acc,
        filed: String(s.file_date || date),
        period: s.period_ending ? String(s.period_ending) : null,
        sic: Array.isArray(s.sics) && s.sics.length ? String(s.sics[0]) : null,
        filing_url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${nod}/${acc}-index.htm`,
      });
    }
    from += hits.length;
    if (!hits.length || from >= total) break;
  }
  return out;
}

// Per-date filer cache. A completed past date is immutable on EDGAR, so it is
// held effectively forever; today keeps moving as filings land through the
// session, so it expires in 10 minutes. This is what makes the calendar view
// affordable: a 60-day sweep costs ~90 requests once, then nothing.
const _filersByDate = new Map<string, { at: number; data: EdgarFiling[] }>();
const FILERS_MAX = 400;

/**
 * The day's earnings filers: 8-Ks carrying Item 2.02, plus 10-Q/10-K filers.
 * De-duplicated by CIK, preferring the 8-K (it is the earnings release; the
 * 10-Q that often lands the same day is the same quarter's detail).
 */
export async function earningsFilersOn(date: string): Promise<EdgarFiling[]> {
  const today = new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
  const ttl = date < today ? 30 * 24 * 3600_000 : 10 * 60_000;
  const hit = _filersByDate.get(date);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const [eightK, periodic] = await Promise.all([
    edgarFilingsOn(date, ['8-K']),
    edgarFilingsOn(date, ['10-Q', '10-K']),
  ]);
  // Plain 8-K with Item 2.02 only. An 8-K/A re-files an earlier release (TREX
  // amended an early-August print on 2 Sep) and must not count as a new one.
  const results = eightK.filter((f) => f.form === '8-K' && f.items.includes('2.02'));
  const periodicClean = periodic.filter((f) => f.form === '10-Q' || f.form === '10-K');
  const byCik = new Map<number, EdgarFiling>();
  for (const f of results) if (!byCik.has(f.cikNum)) byCik.set(f.cikNum, f);
  for (const f of periodicClean) if (!byCik.has(f.cikNum)) byCik.set(f.cikNum, f);

  // Resolve the tradeable common ticker on a major exchange; drop the rest
  // (OTC shells, unlisted filers, preferred lines) and blank-check / trust
  // issuers, which file 10-Qs but have no earnings to grade.
  const out: EdgarFiling[] = [];
  for (const f of Array.from(byCik.values())) {
    if (looksLikeShell(f.company, f.sic)) continue;
    const p = await primaryTicker(f.cikNum);
    if (!p) continue;
    f.ticker = p.ticker;
    out.push(f);
  }

  if (_filersByDate.size >= FILERS_MAX) {
    const oldest = Array.from(_filersByDate.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 80);
    for (const [k] of oldest) _filersByDate.delete(k);
  }
  _filersByDate.set(date, { at: Date.now(), data: out });
  return out;
}

// ─── companyfacts, cached ─────────────────────────────────────────────────
// ~0.25 MB on the wire (gzipped), ~3-4 MB parsed. Immutable until the company
// files again, so a 6-hour TTL is generous and makes repeat scans of the same
// date nearly free. Bounded so a long-lived container can't grow without limit.
const FACTS_TTL_MS = 6 * 3600_000;
const FACTS_MAX = 600;
const _facts = new Map<number, { at: number; data: any }>();

export async function companyFacts(cikNum: number): Promise<any | null> {
  const hit = _facts.get(cikNum);
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.data;
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cikNum).padStart(10, '0')}.json`;
  let data: any = null;
  try { data = await secJson(url, 2); } catch { data = null; }
  if (data) {
    if (_facts.size >= FACTS_MAX) {
      // evict the oldest quarter of the cache
      const entries = Array.from(_facts.entries()).sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i < Math.ceil(FACTS_MAX / 4); i++) _facts.delete(entries[i][0]);
    }
    _facts.set(cikNum, { at: Date.now(), data });
  }
  return data;
}

/**
 * Shares outstanding straight out of the same companyfacts payload — no extra
 * request. We prefer the cover-page `dei:EntityCommonStockSharesOutstanding`
 * over Yahoo's `sharesOutstanding`, which is not trustworthy: for ONTO it
 * reports 61.1m against EDGAR's 49.1m, a 25% overstatement that would put the
 * market cap $3.2B too high and let a name clear a cap floor it should fail.
 * Falls back to the weighted diluted count when the cover-page tag is absent.
 */
export function sharesOutstandingFromFacts(facts: any, asOf?: string | null): number | null {
  // Issuers that moved to per-class share tagging vanish from the undimensioned
  // cover-page series: Berkshire's last plain fact is from 2011, Mastercard's
  // from 2010 — taken verbatim they put BRK-B at $0.5B and MA at $71B. So a
  // cover-page count only counts if it is RECENT relative to the quarter.
  const cutoff = asOf ? new Date(Date.parse(asOf + 'T00:00:00Z') - 400 * 86_400_000).toISOString().slice(0, 10) : null;
  const pick = (arr: any[]): number | null => {
    let best: any = null;
    for (const e of arr) {
      if (typeof e?.val !== 'number' || !(e.val > 0)) continue;
      if (cutoff && String(e.end || '') < cutoff) continue;
      if (!best || String(e.end || '') > String(best.end || '')
        || (e.end === best.end && String(e.filed || '') > String(best.filed || ''))) best = e;
    }
    return best ? best.val : null;
  };
  const dei = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (Array.isArray(dei) && dei.length) { const v = pick(dei); if (v) return v; }
  const wa = facts?.facts?.['us-gaap']?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares;
  if (Array.isArray(wa) && wa.length) { const v = pick(wa); if (v) return v; }
  const wb = facts?.facts?.['us-gaap']?.WeightedAverageNumberOfSharesOutstandingBasic?.units?.shares;
  if (Array.isArray(wb) && wb.length) { const v = pick(wb); if (v) return v; }
  return null;
}

/** Coarse sector from the filing's SIC code — enough to label a card. */
export function sectorFromSic(sic: string | null): string | null {
  if (!sic) return null;
  const n = parseInt(sic, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 100 && n <= 999) return 'Agriculture';
  if (n >= 1000 && n <= 1099) return 'Mining & Metals';
  if (n >= 1200 && n <= 1299) return 'Coal';
  if (n >= 1300 && n <= 1399) return 'Oil & Gas';
  if (n >= 1400 && n <= 1499) return 'Mining & Metals';
  if (n >= 1500 && n <= 1799) return 'Construction';
  if (n >= 2000 && n <= 2199) return 'Food & Beverage';
  if (n >= 2200 && n <= 2399) return 'Textiles & Apparel';
  if (n >= 2400 && n <= 2599) return 'Materials';
  if (n >= 2600 && n <= 2699) return 'Paper';
  if (n >= 2800 && n <= 2836) return 'Chemicals';
  if (n >= 2833 && n <= 2836) return 'Biotech';
  if (n >= 2840 && n <= 2899) return 'Chemicals';
  if (n >= 2900 && n <= 2999) return 'Oil & Gas';
  if (n >= 3300 && n <= 3399) return 'Steel & Metals';
  if (n >= 3400 && n <= 3499) return 'Industrials';
  if (n >= 3500 && n <= 3569) return 'Industrials';
  if (n >= 3570 && n <= 3579) return 'Computer Hardware';
  if (n >= 3600 && n <= 3629) return 'Electrical Equipment';
  if (n >= 3630 && n <= 3669) return 'Electronics';
  if (n >= 3670 && n <= 3679) return 'Semiconductors';
  if (n >= 3680 && n <= 3699) return 'Electronics';
  if (n >= 3711 && n <= 3799) return 'Autos & Transport';
  if (n >= 3721 && n <= 3728) return 'Aerospace & Defence';
  if (n >= 3812 && n <= 3812) return 'Aerospace & Defence';
  if (n >= 3820 && n <= 3899) return 'Instruments';
  if (n >= 4000 && n <= 4799) return 'Transport & Logistics';
  if (n >= 4800 && n <= 4899) return 'Telecom';
  if (n >= 4900 && n <= 4999) return 'Utilities & Power';
  if (n >= 5000 && n <= 5199) return 'Distribution';
  if (n >= 5200 && n <= 5999) return 'Retail';
  if (n >= 6000 && n <= 6199) return 'Banks';
  if (n >= 6200 && n <= 6299) return 'Capital Markets';
  if (n >= 6300 && n <= 6499) return 'Insurance';
  if (n >= 6500 && n <= 6599) return 'Real Estate';
  if (n >= 6700 && n <= 6799) return 'Holding & Investment';
  if (n >= 7370 && n <= 7379) return 'Software & IT Services';
  if (n >= 7300 && n <= 7399) return 'Business Services';
  if (n >= 8000 && n <= 8099) return 'Healthcare Services';
  if (n >= 8700 && n <= 8799) return 'Professional Services';
  return null;
}

/**
 * Financial-sector detector. CFO/PAT is meaningless for banks, insurers and
 * REITs (operating cash flow is a funding artefact), so the Quality Preset
 * skips that gate for them exactly as the India engine does for NBFCs.
 */
export function isFinancialSic(sic: string | null): boolean {
  if (!sic) return false;
  const n = parseInt(sic, 10);
  return Number.isFinite(n) && n >= 6000 && n <= 6799;
}
