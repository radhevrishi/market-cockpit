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

/**
 * The listing venue for each of `tickers`, as SEC states it ("NYSE", "Nasdaq",
 * "NYSE American", "Cboe"), or null for a ticker the file does not carry.
 *
 * This is the ONE authority on where a US name trades that this app has, and it
 * is free: `company_tickers_exchange.json` is already fetched and cached daily
 * by `listings()`. The TradingView export needs it because an exchange prefix
 * cannot be inferred from a symbol — see lib/us-tradingview.ts for what a
 * wrong prefix does (TradingView drops the row silently).
 *
 * The `.` / `-` class-share separator is tried both ways, because callers hold
 * tickers from two vocabularies: SEC writes BRK-B, TradingView writes BRK.B.
 */
export async function exchangeForTickers(tickers: string[]): Promise<Record<string, string | null>> {
  const L = await listings();
  const out: Record<string, string | null> = {};
  for (const raw of tickers) {
    const t = String(raw || '').toUpperCase().trim();
    if (!t) continue;
    const hit = L.byTicker.get(t)
      ?? L.byTicker.get(t.replace(/\./g, '-'))
      ?? L.byTicker.get(t.replace(/-/g, '.'));
    out[t] = hit?.exchange ?? null;
  }
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
        name: j.name ? normalizeCompanyName(String(j.name)) : null,
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
  // Every company string the US tabs display originates here or in
  // `submissions()`. Normalising at these two points — rather than in each of
  // the pages that render a card — is what guarantees one filer reads the same
  // way on the Opportunities tab, the Conviction bench and the email brief.
  if (!m) return { company: normalizeCompanyName(dn), ticker: null, cik: null };
  const tickers = m[2] ? m[2].split(',').map((t) => t.trim()).filter(Boolean) : [];
  return { company: normalizeCompanyName(m[1]), ticker: tickers[0] ? tickers[0].toUpperCase() : null, cik: m[3] };
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

// ═══════════════════════════════════════════════════════════════════════════
// SECTOR FROM SIC
//
// WHY THIS WAS REBUILT FROM THE FULL SIC LIST
// ───────────────────────────────────────────
// The first version was a short ladder of wide ranges, and wide ranges put
// companies that no professional would shelve together under one label. Every
// one of the following was live on the US tabs:
//
//   • HEICO (SIC 3724, Aircraft Engines & Engine Parts) read "Autos &
//     Transport". The ladder tested 3711-3799 → Autos BEFORE 3721-3728 →
//     Aerospace, so the aerospace line was unreachable: an ordering bug that
//     mislabelled every aircraft, missile and space filer in the market.
//   • Every crypto miner and every consumer lender read "Banks". The 6000-6199
//     range swept in Affirm (SIC 6141, Personal Credit Institutions) and IREN /
//     HIVE / BTCS (SIC 6199, Finance Services) and printed them under the same
//     word as JPMorgan. A deposit-taking bank, a BNPL lender and a bitcoin
//     miner have nothing in common on any axis a reader cares about.
//   • Estee Lauder, Coty and Axil Brands (all SIC 2844, Perfumes & Cosmetics)
//     read "Chemicals", as did Lifevantage (2834, Pharmaceutical Preparations),
//     Jaguar Health (2834) and BiomX (2836, Biological Products) — because
//     2800-2899 was treated as one block. Cosmetics are consumer staples and
//     2833-2836 is the drug industry; neither is a chemicals company.
//   • Mercury Systems (3670, Electronic Components) and Key Tronic (3672,
//     Printed Circuit Boards) read "Semiconductors" because 3670-3679 was
//     collapsed. Only 3674 is the semiconductor code.
//   • Lucky Strike Entertainment (7900, Amusement & Recreation) and Prospect
//     Capital read blank — the first because 79xx had no rule at all, the
//     second because EDGAR carries NO SIC for the filer, which is the one case
//     where blank is the right answer.
//
// THE RULE THIS FILE NOW FOLLOWS
// ──────────────────────────────
// Exact four-digit codes are consulted first, then ordered ranges. The exact
// table exists precisely for the codes that do NOT belong with their
// neighbours — 3559 (semiconductor capital equipment sits in the middle of
// general industrial machinery), 3674, 3812, 5122, 6712, 8731 and so on. When
// nothing matches, the answer is null and the card shows no sector chip: a
// filer whose SIC genuinely does not determine a sector (9995 Non-Classifiable,
// 6770 blank cheques, a filer with no SIC at all) gets nothing rather than a
// label that is wrong.
//
// LABEL VOCABULARY
// ────────────────
// Where a concept exists on the India tabs the US map uses India's exact
// spelling so one reader reads one vocabulary across both: Auto, Capital Goods,
// Chemicals, Consumer, Consumer Services, Diversified, FMCG, Infrastructure,
// IT, Media & Telecom, Metals & Mining, Real Estate (see `sectorFromIndustry`
// in src/lib/nse.ts). Where the US filer set needs a distinction India's tab
// never has to draw, a finer label is added rather than a wrong shared one:
// Aerospace & Defence, Semiconductors, Electronics, Computer Hardware, Pharma &
// Biotech, Medical Devices, Healthcare Services, Banks, Specialty Finance,
// Capital Markets, Insurance, Oil & Gas, Utilities & Power, Retail,
// Distribution, Transport & Logistics, Business Services, Professional
// Services, Paper & Packaging, Construction Materials, Agriculture.
// ═══════════════════════════════════════════════════════════════════════════

/** Codes that do not belong with their numeric neighbours. Consulted first. */
const SIC_EXACT: Record<number, string | null> = {
  // ─ Semiconductor capital equipment lives inside general machinery (35xx).
  //   Applied Materials and Lam Research are both SIC 3559; shelving them under
  //   "Capital Goods" with a forklift maker would be a plain error.
  3559: 'Semiconductors',
  3674: 'Semiconductors',            // the ONE semiconductor code in 367x

  // ─ Ordnance and defence electronics sit inside otherwise civilian blocks.
  3480: 'Aerospace & Defence', 3483: 'Aerospace & Defence', 3489: 'Aerospace & Defence',
  3795: 'Aerospace & Defence',       // tanks & tank components
  3812: 'Aerospace & Defence',       // search, detection, navigation, guidance

  // ─ Consumer goods sitting inside industrial blocks.
  3011: 'Auto',                      // tyres — an auto component, not a chemical
  3630: 'Consumer', 3631: 'Consumer', 3634: 'Consumer', 3635: 'Consumer', 3639: 'Consumer',
  3651: 'Consumer',                  // household audio & video
  3652: 'Media & Telecom',           // prerecorded records & tapes
  3732: 'Consumer',                  // boat building (recreational) — see 3730 below
  3751: 'Consumer',                  // motorcycles & bicycles
  3792: 'Consumer',                  // travel trailers & campers (RV makers)
  3873: 'Consumer',                  // watches & clocks

  // ─ Distribution codes whose end market is healthcare or energy, not "wholesale".
  5047: 'Healthcare Services',       // medical & hospital equipment wholesale
  5122: 'Healthcare Services',       // drugs & druggists' sundries (the distributors)
  5171: 'Oil & Gas', 5172: 'Oil & Gas',

  // ─ Financial codes that are emphatically not banks.
  6712: 'Banks',                     // bank holding companies ARE the banks
  6726: 'Capital Markets',           // investment offices, closed-end funds, BDCs
  6792: 'Oil & Gas',                 // oil royalty traders
  6794: 'Business Services',         // patent owners & lessors
  6795: 'Metals & Mining',           // mineral royalty traders
  6798: 'Real Estate',               // REITs

  // ─ Services codes that belong to another sector's economics.
  7385: 'Media & Telecom',           // telephone interconnect
  8711: 'Infrastructure', 8712: 'Infrastructure',   // engineering / architectural services
  // 8731 "Commercial Physical & Biological Research" is, on EDGAR, overwhelmingly
  // clinical-stage drug developers and CROs — the code a pre-revenue biotech
  // picks when it has no marketed product to justify 2834.
  8731: 'Pharma & Biotech',

  // ─ SIC 3990/3999 "Manufacturing Industries, NEC" is a genuine catch-all: it
  //   holds Brady Corp (industrial identification) and Daktronics (stadium
  //   displays) alongside novelty manufacturers. It determines nothing, so it
  //   says nothing — the neighbouring 39xx codes (jewellery, toys, sporting
  //   goods) really are consumer and keep their label.
  3990: null,
  3999: null,

  // ─ Codes SEC itself defines as "not classified". Blank is the honest answer.
  6770: null,                        // blank cheques (also filtered by looksLikeShell)
  8888: null,                        // foreign governments
  9995: null,                        // non-classifiable establishments
  9999: null,
};

/** Ordered ranges, consulted after `SIC_EXACT`. First match wins. */
const SIC_RANGES: Array<[number, number, string]> = [
  // ── 01-09 agriculture, forestry, fishing ────────────────────────────────
  [100, 999, 'Agriculture'],

  // ── 10-14 mining ────────────────────────────────────────────────────────
  [1000, 1099, 'Metals & Mining'],
  [1200, 1299, 'Metals & Mining'],        // coal — India shelves coal here too
  [1300, 1399, 'Oil & Gas'],              // extraction + oilfield services
  [1400, 1499, 'Metals & Mining'],        // nonmetallic minerals, quarrying

  // ── 15-17 construction ──────────────────────────────────────────────────
  // Residential builders trade on the housing cycle, not the capex cycle.
  [1520, 1531, 'Real Estate'],
  [1540, 1799, 'Infrastructure'],         // non-residential, heavy, special trade

  // ── 20-21 food, beverage, tobacco ───────────────────────────────────────
  [2000, 2199, 'FMCG'],

  // ── 22-23 textiles and apparel ──────────────────────────────────────────
  [2200, 2399, 'Consumer'],

  // ── 24-25 lumber, wood, furniture ───────────────────────────────────────
  [2400, 2499, 'Construction Materials'],
  [2500, 2599, 'Consumer'],

  // ── 26-27 paper and printing ────────────────────────────────────────────
  [2600, 2699, 'Paper & Packaging'],
  [2700, 2799, 'Media & Telecom'],        // publishing & printing

  // ── 28 chemicals — the block that must be split three ways ──────────────
  [2800, 2832, 'Chemicals'],
  [2833, 2836, 'Pharma & Biotech'],       // medicinal chemicals → biologicals
  [2840, 2844, 'FMCG'],                   // soap, detergents, cosmetics, toiletries
  [2850, 2899, 'Chemicals'],              // paints, industrial organics, agrichem

  // ── 29 petroleum refining ───────────────────────────────────────────────
  [2900, 2999, 'Oil & Gas'],

  // ── 30-32 rubber, leather, stone/clay/glass ─────────────────────────────
  [3000, 3099, 'Chemicals'],              // plastics & rubber products (3011 above)
  [3100, 3199, 'Consumer'],               // leather & footwear
  [3200, 3299, 'Construction Materials'], // glass, cement, concrete, gypsum

  // ── 33-34 metals ────────────────────────────────────────────────────────
  [3300, 3399, 'Metals & Mining'],        // steel, aluminium, copper, foundries
  [3400, 3499, 'Capital Goods'],          // fabricated metal (ordnance handled above)

  // ── 35 machinery and computers ──────────────────────────────────────────
  [3500, 3569, 'Capital Goods'],
  [3570, 3579, 'Computer Hardware'],
  [3580, 3599, 'Capital Goods'],

  // ── 36 electrical and electronic ────────────────────────────────────────
  [3600, 3629, 'Capital Goods'],          // transformers, motors, switchgear
  [3640, 3649, 'Capital Goods'],          // lighting & wiring equipment
  [3660, 3669, 'Electronics'],            // communications equipment
  [3670, 3679, 'Electronics'],            // components, PCBs, connectors (3674 above)
  [3680, 3699, 'Electronics'],

  // ── 37 transportation equipment ─────────────────────────────────────────
  [3710, 3716, 'Auto'],                   // vehicles, bodies, parts, truck trailers
  [3720, 3729, 'Aerospace & Defence'],    // aircraft, engines, parts — HEICO's 3724
  // 3730 "Ship & Boat Building & Repairing" genuinely straddles a naval prime
  // and a wakeboard-boat maker (Malibu Boats files under 3730). SIC cannot tell
  // them apart, so the neutral manufacturing label is the honest one; the
  // narrower 3732 "Boat Building" is treated as consumer above.
  [3730, 3731, 'Capital Goods'],
  [3740, 3749, 'Capital Goods'],          // railroad equipment
  [3760, 3769, 'Aerospace & Defence'],    // guided missiles & space vehicles
  [3790, 3799, 'Capital Goods'],

  // ── 38 instruments ──────────────────────────────────────────────────────
  [3820, 3829, 'Electronics'],            // measuring & control instruments
  [3841, 3851, 'Medical Devices'],        // surgical, dental, ophthalmic
  [3860, 3869, 'Electronics'],            // photographic equipment

  // ── 39 miscellaneous manufacturing ──────────────────────────────────────
  [3900, 3999, 'Consumer'],               // jewellery, toys, sporting goods, pens

  // ── 40-47 transportation ────────────────────────────────────────────────
  [4000, 4599, 'Transport & Logistics'],  // rail, transit, trucking, water, air
  [4600, 4619, 'Oil & Gas'],              // pipelines
  [4700, 4799, 'Transport & Logistics'],

  // ── 48 communications ───────────────────────────────────────────────────
  [4800, 4899, 'Media & Telecom'],

  // ── 49 utilities ────────────────────────────────────────────────────────
  [4900, 4949, 'Utilities & Power'],
  [4950, 4969, 'Business Services'],      // refuse systems & sanitary services
  [4970, 4999, 'Utilities & Power'],

  // ── 50-51 wholesale ─────────────────────────────────────────────────────
  [5000, 5199, 'Distribution'],

  // ── 52-59 retail ────────────────────────────────────────────────────────
  [5200, 5811, 'Retail'],
  [5812, 5813, 'Consumer Services'],      // eating & drinking places
  [5814, 5999, 'Retail'],

  // ── 60-67 finance, insurance, real estate — four different businesses ───
  [6000, 6036, 'Banks'],                  // commercial banks, savings institutions
  [6099, 6099, 'Specialty Finance'],      // functions related to depository banking
  [6100, 6199, 'Specialty Finance'],      // consumer credit, mortgage, finance svcs
  [6200, 6299, 'Capital Markets'],        // brokers, exchanges, investment advice
  [6300, 6499, 'Insurance'],
  [6500, 6599, 'Real Estate'],
  [6700, 6719, 'Diversified'],            // holding & other investment offices

  // ── 70-79 services ──────────────────────────────────────────────────────
  [7000, 7099, 'Consumer Services'],      // hotels & lodging
  [7200, 7299, 'Consumer Services'],      // personal services
  [7310, 7319, 'Media & Telecom'],        // advertising
  [7320, 7369, 'Business Services'],
  [7370, 7379, 'IT'],                     // software, data processing, IT services
  [7380, 7399, 'Business Services'],
  [7500, 7549, 'Consumer Services'],      // automotive services
  [7600, 7699, 'Consumer Services'],      // repair services
  [7800, 7899, 'Media & Telecom'],        // motion pictures
  [7900, 7999, 'Consumer Services'],      // amusement & recreation

  // ── 80-89 health, education, professional ───────────────────────────────
  [8000, 8099, 'Healthcare Services'],
  [8200, 8299, 'Consumer Services'],      // educational services
  [8300, 8399, 'Healthcare Services'],    // social services
  [8700, 8799, 'Professional Services'],  // accounting, consulting, testing labs
];

/**
 * Digital-asset issuers hide inside SIC 6199 "Finance Services".
 *
 * 6199 is SEC's catch-all for a financial business that is none of the named
 * ones, and it is what a bitcoin miner selects because SIC — frozen since 1987
 * — has no mining-of-digital-assets code: IREN, HIVE Digital and BTCS all file
 * under it, alongside genuine specialty lenders. Left at "Specialty Finance" a
 * hashrate business reads like a consumer-credit book, which is a different
 * balance sheet, a different revenue driver and a different cycle.
 *
 * The discriminator is the filer's OWN filing, not a list of companies. ASU
 * 2023-08 gave US GAAP a dedicated crypto-asset tag family (`CryptoAssetFairValue`,
 * `CryptoAssetNumberOfUnits`, `CryptoAssetRealizedGain…`), and only an issuer
 * that holds digital assets on its balance sheet tags them: verified present on
 * IREN, HIVE, BTCS and Coinbase and absent on Affirm, SoFi, OFG Bancorp and
 * JPMorgan. Where those facts cannot be consulted, a narrow digital-asset
 * vocabulary in the registrant's own name is the fallback. Both signals are
 * scoped to the ambiguous finance codes and can never override a SIC that does
 * determine a sector.
 */
const DIGITAL_ASSET_NAME_RE = /\b(bitcoin|ethereum|crypto\w*|blockchain|digital[\s-]+assets?|hash\s*rate|hashrate|web3|stablecoin|mining|miner)\b/i;
const AMBIGUOUS_FINANCE_SIC = new Set([6199]);

/** True when the filer tags any ASU 2023-08 crypto-asset concept — i.e. it
 *  carries digital assets on its own balance sheet. Cheap: `companyFacts` is
 *  already in hand wherever a row is graded. */
export function filesCryptoAssetFacts(facts: any): boolean {
  const g = facts?.facts?.['us-gaap'];
  if (!g || typeof g !== 'object') return false;
  for (const k of Object.keys(g)) if (k.startsWith('CryptoAsset')) return true;
  return false;
}

/**
 * Sector for a filer, from its SIC code — plus, ONLY for the ambiguous finance
 * codes, its registrant name and its own crypto-asset tagging. Returns null
 * when the code does not determine a sector; the card then shows no sector
 * chip, which is correct (Prospect Capital, a BDC EDGAR carries no SIC for,
 * reads blank rather than wrong).
 */
export function sectorFromSic(
  sic: string | null,
  name?: string | null,
  signals?: { facts?: any } | null,
): string | null {
  if (!sic) return null;
  const n = parseInt(sic, 10);
  if (!Number.isFinite(n)) return null;

  if (AMBIGUOUS_FINANCE_SIC.has(n)) {
    if (signals?.facts && filesCryptoAssetFacts(signals.facts)) return 'Digital Assets';
    if (name && DIGITAL_ASSET_NAME_RE.test(name)) return 'Digital Assets';
  }

  if (Object.prototype.hasOwnProperty.call(SIC_EXACT, n)) return SIC_EXACT[n] ?? null;
  for (const [lo, hi, label] of SIC_RANGES) if (n >= lo && n <= hi) return label;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRANT NAME → READABLE COMPANY NAME
//
// EDGAR stores the registrant string a filer typed into a form, sometimes
// decades ago, and it is not a display name: "TJX COMPANIES INC /DE/",
// "ABERCROMBIE & FITCH CO /DE/", "SANFILIPPO JOHN B & SON INC", "LOWES
// COMPANIES INC". Meanwhile filers that registered more recently typed their
// own house style — "Workday, Inc.", "Keysight Technologies, Inc." — and those
// are already right. So the normaliser works TOKEN BY TOKEN and only touches
// tokens that are shouting: a token that already carries a lowercase letter is
// the registrant's own casing and is left exactly as it is.
//
// Three things it deliberately does NOT do:
//   • It does not reorder. "SANFILIPPO JOHN B & SON INC" is a surname-first
//     registrant string; guessing that "John B Sanfilippo & Son" was meant is
//     an invention, and would be wrong for any company whose legal name really
//     does start with a surname. It is cased and left alone.
//   • It does not expand abbreviations. "HLDGS" stays "Hldgs"; inventing
//     "Holdings" puts a word in a filer's name that is not in its name.
//   • It does not lowercase a token it cannot prove is a word. Genuine
//     initialisms (TJX, OSI, LGL), single-letter initials (the "B" above),
//     dotted forms (J.M.) and Roman numerals stay uppercase.
// ═══════════════════════════════════════════════════════════════════════════

/** Legal-form tokens, normalised to one consistent rendering everywhere. The
 *  key is the token with punctuation stripped and upper-cased. */
const LEGAL_SUFFIX: Record<string, string> = {
  INC: 'Inc', INCORPORATED: 'Incorporated', CORP: 'Corp', CORPORATION: 'Corporation',
  CO: 'Co', COS: 'Cos', COMPANY: 'Company', COMPANIES: 'Companies',
  LTD: 'Ltd', LIMITED: 'Limited', PLC: 'PLC', LLC: 'LLC', LLP: 'LLP', LP: 'LP',
  LC: 'LC', PC: 'PC', PA: 'PA', NV: 'NV', BV: 'BV', SA: 'SA', SAB: 'SAB',
  AG: 'AG', SE: 'SE', AB: 'AB', ASA: 'ASA', AS: 'AS', OYJ: 'Oyj', OY: 'Oy',
  SPA: 'SpA', GMBH: 'GmbH', KGAA: 'KGaA', KK: 'KK', PTE: 'Pte', PT: 'PT',
  CV: 'CV', SARL: 'Sarl', SAS: 'SAS', TRUST: 'Trust', GROUP: 'Group',
  HOLDINGS: 'Holdings', HOLDING: 'Holding', PARTNERS: 'Partners',
};

/** Initialisms and unit abbreviations that are words nobody title-cases. This
 *  is general industry vocabulary, not a list of companies. */
const KEEP_UPPER = new Set([
  'US', 'USA', 'UK', 'EU', 'UAE', 'ADR', 'ADS', 'REIT', 'ETF', 'SPAC', 'BDC', 'ESG',
  'IT', 'AI', 'ML', 'AR', 'VR', 'TV', 'HD', 'CD', 'DVD', 'PC', 'CPU', 'GPU', 'OS',
  'API', 'SAAS', 'IP', 'RF', 'LED', 'OLED', 'LCD', 'LNG', 'LPG', 'CNG', 'GPS',
  'RFID', 'PCB', 'EMS', 'HVAC', 'MRI', 'CT', 'DNA', 'RNA', 'CBD', 'THC', 'PPE',
  'PVC', 'ABS', 'PET', 'NYSE', 'AMEX', 'NASDAQ', 'FDA', 'DOD', 'NA', 'SPX',
  '3D', '4D', '5G', '6G',
]);

/** Roman numerals used as generation markers ("Fund III", "Acquisition IV"). */
const ROMAN_RE = /^(?:M{0,3})(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

/** Two- and three-letter English words that really do appear in company names.
 *  Without this list the short-token acronym rule would shout "SUN Communities"
 *  and "OLD National Bancorp". */
const SHORT_WORDS = new Set([
  'A', 'AN', 'AS', 'AT', 'BY', 'DE', 'DO', 'GO', 'IN', 'IS', 'IT', 'LA', 'LE', 'MY',
  'NO', 'OF', 'ON', 'OR', 'SO', 'ST', 'TO', 'UP', 'WE',
  'ACE', 'ADD', 'AGE', 'AIR', 'ALL', 'AND', 'ANN', 'ARC', 'ARK', 'ART', 'BAR', 'BAY',
  'BEN', 'BIG', 'BIO', 'BOX', 'BOY', 'BUS', 'BUY', 'CAB', 'CAP', 'CAR', 'CAT', 'CITY',
  'CUP', 'CUT', 'DAY', 'DOG', 'DRY', 'DUO', 'EAT', 'ECO', 'ELM', 'END', 'ERA', 'EYE',
  'FAB', 'FAR', 'FIT', 'FLY', 'FOR', 'FOX', 'FUN', 'GAP', 'GAS', 'GEM', 'GEO', 'GET',
  'GUN', 'HER', 'HIS', 'HOT', 'ICE', 'INN', 'JET', 'JOB', 'JOY', 'KEY', 'KID', 'LAB',
  'LAW', 'LEE', 'LOW', 'MAN', 'MAP', 'MED', 'MEN', 'MID', 'MIX', 'NEW', 'NET', 'NEW',
  'NOW', 'OAK', 'OIL', 'OLD', 'ONE', 'OUR', 'OUT', 'OWN', 'PAY', 'PET', 'PRO', 'PUB',
  'RAY', 'RED', 'RUN', 'SEA', 'SET', 'SHE', 'SIX', 'SKY', 'SON', 'SUN', 'TEA', 'TEN',
  'THE', 'TOP', 'TOY', 'TWO', 'USE', 'VAN', 'VIA', 'WAR', 'WAY', 'WEB', 'WIN', 'ZOO',
  'AID', 'AIM', 'ANY', 'ARE', 'ARM', 'BAG', 'BED', 'BIT', 'CAN', 'DOT', 'DUE', 'EGG',
  'FEE', 'GYM', 'HAS', 'HAT', 'HUB', 'INK', 'ION', 'ITS', 'JAM', 'KIT', 'LEG', 'LOG',
  'MAX', 'MAY', 'MIN', 'MIX', 'NOT', 'NUT', 'OFF', 'ONE', 'PAD', 'PAN', 'PIE', 'PIN',
  'POP', 'POT', 'RAM', 'RAW', 'RIM', 'ROW', 'SEE', 'SUB', 'SUM', 'TAB', 'TAG', 'TAN',
  'TAX', 'TIE', 'TIN', 'TIP', 'TON', 'VET', 'WAS', 'WAX', 'WHO', 'WHY', 'YOU', 'ZIP',
]);

/** Words that stay lowercase inside a name (never first or last token). */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'del', 'der', 'des', 'du', 'for', 'in', 'la',
  'le', 'of', 'on', 'or', 'the', 'to', 'van', 'von', 'und',
]);

const VOWEL_RE = /[AEIOUY]/;

/** Title-case one alphabetic run, keeping Mc- and O'- names intact. */
function titleRun(w: string): string {
  const lower = w.toLowerCase();
  // "MCKESSON" → "McKesson", "MCEWEN" → "McEwen". Restricted to Mc (never Mac,
  // which would turn MACHINE into MacHine) and to tokens long enough that the
  // remainder is a name rather than a two-letter fragment.
  if (/^MC[A-Z]{2,}$/.test(w)) return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3);
  // Capitalise the first LETTER, which is not always the first character:
  // "3KNIGHTS DYNAMICS GROUP" must read "3Knights", not "3knights".
  const i = lower.search(/[a-z]/);
  if (i < 0) return lower;
  return lower.slice(0, i) + lower.charAt(i).toUpperCase() + lower.slice(i + 1);
}

/** Case one whitespace-delimited token's alphanumeric core. */
function caseCore(core: string, opts: { partiallyCased: boolean }): string {
  const upper = core.toUpperCase();

  // Already-known legal forms, always rendered the same way — but ONLY when the
  // token is uniformly cased, i.e. the registrant was shouting ("INC") or typed
  // it flat ("plc"). A token the filer capitalised themselves is a word in
  // their name, not a suffix: "Ballston Spa Bancorp" is a town in New York and
  // must never become "Ballston SpA Bancorp".
  const uniform = core === upper || core === core.toLowerCase();
  if (uniform && LEGAL_SUFFIX[upper]) return LEGAL_SUFFIX[upper];

  // The registrant's own casing wins: any lowercase letter means a human typed
  // this deliberately ("Workday", "iRobot", "eBay").
  if (/[a-z]/.test(core)) return core;

  if (KEEP_UPPER.has(upper)) return upper;
  if (/^[A-Z]$/.test(core)) return core;                    // "SANFILIPPO JOHN B"
  if (/^[A-Z](?:\.[A-Z])+\.?$/.test(core)) return core;     // "J.M.", "U.S."
  if (ROMAN_RE.test(core) && core.length > 1) return core;  // "II", "III", "IV"
  if (!/[A-Z]/.test(core)) return core;                     // digits / symbols only

  // A short all-caps run with no vowel cannot be a word: TJX, NPK, BRT, LGL.
  if (core.length <= 5 && !VOWEL_RE.test(core)) return upper;

  // A two- or three-letter run that is not an English word is an initialism:
  // OSI, AXT, IES. The word list above is what keeps SUN, OLD and NEW as words.
  if (core.length <= 3 && !SHORT_WORDS.has(upper)) return upper;

  // In a registrant string that is only PARTLY shouting, a short all-caps token
  // is the filer's own branding and is left alone — "HIVE Digital Technologies
  // Ltd." and "BTCS Inc." are how those two companies write themselves, and
  // title-casing them would damage a name that was already right. One character
  // further out, the vowel density decides: "CRISPR Therapeutics AG" is an
  // initialism at one vowel in six and stays shouting, while "FRANCO NEVADA
  // Corp" is two ordinary words at one vowel in three and gets cased.
  if (opts.partiallyCased) {
    if (core.length <= 5) return upper;
    const vowels = (core.match(/[AEIOUY]/g) || []).length;
    if (core.length <= 6 && vowels * 3 < core.length) return upper;
  }

  return titleRun(core);
}

/**
 * A registrant string rendered as a company name. Never reorders, never expands,
 * never invents. Returns the input unchanged when there is nothing to fix.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  // ── registry artefacts ────────────────────────────────────────────────
  // The state-of-incorporation marker EDGAR appends: "/DE/", "/MD/", "/NEW/",
  // "/FI", and the backslash variant. Stripped only from the END and only when
  // whitespace precedes it, so a genuine "A/S" or "S/A" inside a name survives.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\s+[\/\\][A-Za-z]{2,5}[\/\\]?\s*$/, '').trim();
    if (next === s) break;
    s = next;
  }
  // EDGAR's own duplicate-name disambiguators.
  s = s.replace(/\s*\((?:formerly|fka|f\/k\/a|new|old)\b[^)]*\)\s*$/i, '').trim();
  s = s.replace(/\s+-\s*ADR\s*$/i, '').trim();
  s = s.replace(/\s{2,}/g, ' ');
  if (!s) return String(raw ?? '').trim();

  // "Partly cased" means the registrant typed at least some of this themselves,
  // which changes how an all-caps token inside it is read (see caseCore).
  const partiallyCased = /[a-z]/.test(s);

  const tokens = s.split(' ');
  const out = tokens.map((tok, i) => {
    // Split leading and trailing punctuation off so "STORES," and "INC." keep
    // their punctuation while their cores are cased.
    const m = /^([^0-9A-Za-z]*)(.*?)([^0-9A-Za-z]*)$/.exec(tok);
    if (!m) return tok;
    const [, lead, body, tail] = m;
    if (!body) return tok;

    // Hyphenated / slashed compounds are cased part by part.
    const cased = body
      .split(/([-\/])/)
      .map((part) => (part === '-' || part === '/' ? part : caseCore(part, { partiallyCased })))
      .join('');

    // Minor words go lowercase, but never as the first or last token: "Bank of
    // America Corp", not "bank Of America Corp".
    const isEdge = i === 0 || i === tokens.length - 1;
    if (!isEdge && MINOR_WORDS.has(cased.toLowerCase()) && !/[a-z]/.test(body)) {
      return lead + cased.toLowerCase() + tail;
    }
    return lead + cased + tail;
  });

  const result = out.join(' ').replace(/\s{2,}/g, ' ').trim();
  return result || String(raw ?? '').trim();
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
