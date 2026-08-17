// ═══════════════════════════════════════════════════════════════════════════
// LIVE ENRICHMENT ENDPOINT (PATCH 0155)
//
// Bypasses the (currently broken) Railway worker by fetching Screener.in
// financials + Yahoo Finance price data directly from Vercel for any list
// of NSE symbols, caching per-symbol in KV with a 7-day TTL.
//
// GET /api/v1/earnings/enrich?symbols=ATLANTAELE,SAMBHV,GAEL...
//   → { data: { ATLANTAELE: { sales_curr_cr, pat_curr_cr, ..., rs_rating, stage }, ... } }
//
// Vercel maxDuration=60s. Parallel fetch: ~47 symbols × 500ms each =
// ~2-5s total when cold, <1s when warm (KV-cached).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';
import { proxiedFetch, fetchWorkerStock } from '@/lib/proxy-fetch';
import { fetchCompanyFinancialResults } from '@/lib/nse';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// PATCH 0404 — UA rotation + browser-mimic Sec-Ch headers to bypass
// Cloudflare's lightweight challenge on Vercel egress IPs. Screener
// returns 200 to ordinary requests from residential IPs but sometimes
// returns 5xx/403 + empty body to Vercel function IPs without these
// headers.
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
function pickUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}
function browserHeaders(referer: string): Record<string, string> {
  return {
    'User-Agent': pickUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,en-IN;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Referer': referer,
  };
}
const UA = UA_POOL[0];           // kept for backwards-compat callers below
// PATCH 0445 BUG-025 — Bump per-source timeouts. The previous 7s/5s budget
// was too tight when Screener has Cloudflare friction or Yahoo rate-limits.
// New ceilings still fit comfortably under the per-ticker 18s ceiling above.
// PATCH 0454 P1-25 — Audit found inner Screener chain (3 attempts × 12s +
// 1.5s jitter delays) could run ~39s while the outer withTimeout was only
// 18s. The outer just resolved null but the inner kept running in the
// background, consuming container time. Tightened: 2 attempts × 7s plus
// PATCH 0463 — was 7000ms × 2 retries × 2 URLs ≈ 29s, exceeding the outer
// 18s PER_TICKER_MS budget so the outer would abort mid-second-URL. Now
// 5500ms × 2 retries × 2 URLs ≈ 22s — still over the original 18s budget,
// so the outer PER_TICKER_MS is also bumped below to 24s.
const SCREENER_TIMEOUT_MS = 5500;
const YAHOO_TIMEOUT_MS = 5000;
const SCREENER_RETRY_DELAYS_MS = [0, 500];  // 2 attempts only
// PATCH 0157 — staleness defense:
// • Cache TTL reduced from 7 days → 6 hours. Quarterly filings come every
//   90 days but the SAME stock can release amendments/clarifications same-
//   day; 6h means at most a stale view until the next refetch.
// • Cache key bumped v3 → v4 — fully busts older cached entries on deploy.
// • Cache key now optionally includes `&filed=YYYY-MM-DD` from the caller
//   so a fresh filing date naturally invalidates the cache.
const ENRICH_TTL_S = 6 * 3600;

// ─── HTML helpers ──────────────────────────────────────────────────────────
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function num(raw: any): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,₹$]/g, '').trim();
  if (!s || s === '—' || s === '-' || s === 'N/A') return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m && Number.isFinite(Number(m[0])) ? Number(m[0]) : null;
}
function pct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
}

// ─── Screener parsers ──────────────────────────────────────────────────────
function parseTopRatios(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const m = html.match(/<ul[^>]*id=["']top-ratios["'][^>]*>([\s\S]*?)<\/ul>/i);
  if (!m) return out;
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = liRe.exec(m[1])) !== null) {
    const li = mm[1];
    const nameM = li.match(/class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const numM = li.match(/class=["'][^"']*\bnumber\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (nameM && numM) {
      out[stripTags(nameM[1]).trim()] = num(stripTags(numM[1]));
      continue;
    }
    // zzz358 BUG3 — tolerant fallback for edge-case layouts (missing/renamed
    // "number" span). If we can identify the ratio name, salvage the numeric
    // value from any trailing <span class="value"> or the raw li text so
    // ROCE/ROE aren't silently dropped when Screener tweaks its markup.
    if (nameM) {
      const label = stripTags(nameM[1]).trim();
      if (!label) continue;
      const valM = li.match(/class=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      // Strip the name span out first so its text can't be mistaken for the value.
      const rest = li.replace(nameM[0], '');
      const salvaged = valM ? num(stripTags(valM[1])) : num(stripTags(rest));
      if (salvaged != null && out[label] === undefined) out[label] = salvaged;
    }
  }
  return out;
}

function parseQuartersTable(html: string): { labels: string[]; rows: Record<string, (number | null)[]> } | null {
  const open = html.match(/<section[^>]*\bid=["']quarters["'][^>]*>/i);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  const tail = html.slice(start, start + 80_000);
  const next = tail.search(/<section\s+[^>]*\bid=["']/i);
  const block = next > 0 ? tail.slice(0, next) : tail;
  const tbl = block.match(/<table[\s\S]*?<\/table>/i);
  if (!tbl) return null;
  const thead = tbl[0].match(/<thead[\s\S]*?<\/thead>/i);
  if (!thead) return null;
  const ths = Array.from(thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1]));
  const labels = ths.slice(1);
  const tbody = tbl[0].match(/<tbody[\s\S]*?<\/tbody>/i);
  const rows: Record<string, (number | null)[]> = {};
  if (tbody) {
    for (const tr of Array.from(tbody[0].matchAll(/<tr[\s\S]*?<\/tr>/gi))) {
      const tds = Array.from(tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) => stripTags(x[1]));
      if (!tds[0]) continue;
      rows[tds[0]] = tds.slice(1).map((v) => num(v));
    }
  }
  return { labels, rows };
}

// zzz316 — generic section table parser (mirrors parseQuartersTable but for
// any Screener section id: 'cash-flow', 'profit-loss', 'balance-sheet', etc.)
function parseSectionTable(html: string, sectionId: string): { labels: string[]; rows: Record<string, (number | null)[]> } | null {
  const idRe = new RegExp('<section[^>]*\\bid=["\']' + sectionId + '["\'][^>]*>', 'i');
  const open = html.match(idRe);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  const tail = html.slice(start, start + 80_000);
  const next = tail.search(/<section\s+[^>]*\bid=["\']/i);
  const block = next > 0 ? tail.slice(0, next) : tail;
  const tbl = block.match(/<table[\s\S]*?<\/table>/i);
  if (!tbl) return null;
  const thead = tbl[0].match(/<thead[\s\S]*?<\/thead>/i);
  if (!thead) return null;
  const ths = Array.from(thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1]));
  const labels = ths.slice(1);
  const tbody = tbl[0].match(/<tbody[\s\S]*?<\/tbody>/i);
  const rows: Record<string, (number | null)[]> = {};
  if (tbody) {
    for (const tr of Array.from(tbody[0].matchAll(/<tr[\s\S]*?<\/tr>/gi))) {
      const tds = Array.from(tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) => stripTags(x[1]));
      if (!tds[0]) continue;
      rows[tds[0]] = tds.slice(1).map((v) => num(v));
    }
  }
  return { labels, rows };
}

// zzz367 — TOLERANT table parser. parseQuartersTable/parseSectionTable require a
// <thead> (and quarters gates on >=5 labels); on the PROXIED Screener HTML that
// reaches the production server those strict parsers return null, so
// fetchScreenerForSymbol silently yields null and EVERY trend/quarterly/pledge/
// one-off field was missing in prod. (fetchScreenerCFO's looser row-scan is the
// only Screener path that survives there — proven by CFO/PAT populating live.)
// This parser drops the thead requirement (derives column labels from the first
// mostly-non-numeric row) and never gates on length.
function parseTableLoose(html: string, sectionId: string): { labels: string[]; rows: Record<string, (number | null)[]> } | null {
  const idRe = new RegExp('<section[^>]*\\bid=["\']' + sectionId + '["\'][^>]*>', 'i');
  const open = html.match(idRe);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  const tail = html.slice(start, start + 120_000);
  const next = tail.search(/<section\s+[^>]*\bid=["']/i);
  const block = next > 0 ? tail.slice(0, next) : tail;
  const tbl = block.match(/<table[\s\S]*?<\/table>/i);
  if (!tbl) return null;
  let labels: string[] = [];
  const thead = tbl[0].match(/<thead[\s\S]*?<\/thead>/i);
  if (thead) {
    labels = Array.from(thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1])).slice(1);
  }
  const bodyM = tbl[0].match(/<tbody[\s\S]*?<\/tbody>/i);
  const bodySrc = bodyM ? bodyM[0] : tbl[0];
  const rows: Record<string, (number | null)[]> = {};
  for (const tr of Array.from(bodySrc.matchAll(/<tr[\s\S]*?<\/tr>/gi))) {
    const cells = Array.from(tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((x) => stripTags(x[1]));
    if (!cells.length || !cells[0]) continue;
    if (labels.length === 0) {
      const vals = cells.slice(1);
      const numeric = vals.filter((v) => num(v) !== null).length;
      if (vals.length > 0 && numeric < vals.length / 2) { labels = vals; continue; }
    }
    rows[cells[0]] = cells.slice(1).map(num);
  }
  return { labels, rows };
}

// zzz367 — extract quarterly trend series + annual CFO/PAT + one-off/exceptional +
// pledge from raw Screener HTML using the tolerant parser, independent of the strict
// fetchScreenerForSymbol gate. Mirrors the zzz360/zzz363 computations. Every field is
// null-safe; null-only keys are stripped so the payload stays lean.
function extractScreenerTrends(html: string): Record<string, any> {
  const outT: Record<string, any> = {};
  const last = (arr: (number | null)[] | null): number | null => (arr && arr.length ? arr[arr.length - 1] : null);
  try {
    const q = parseTableLoose(html, 'quarters');
    const qRow = (kw: string): (number | null)[] | null => {
      if (!q) return null;
      const k = Object.keys(q.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
      return k ? (q.rows[k] || null) : null;
    };
    const salesRow = qRow('Sales') ?? qRow('Revenue') ?? qRow('Income') ?? qRow('Interest') ?? qRow('Premium');
    const QN = salesRow ? Math.min(8, salesRow.length) : 0;
    const tailArr = (arr: (number | null)[] | null): (number | null)[] | null =>
      (arr && QN > 0 ? arr.slice(Math.max(0, arr.length - QN)) : null);
    const salesTail = tailArr(salesRow);
    const oiRow = tailArr(qRow('Other income normal') ?? qRow('Other Income'));
    outT.quarters_material_cost_pct = tailArr(qRow('Material Cost %'));
    outT.quarters_tax_pct = tailArr(qRow('Tax %'));
    outT.quarters_sales = salesTail;
    outT.quarters_eps = tailArr(qRow('EPS'));
    outT.quarters_opm = tailArr(qRow('OPM'));
    outT.quarters_other_income_pct = (oiRow && salesTail)
      ? oiRow.map((oi, i) => { const s = salesTail[i]; return oi != null && s != null && s !== 0 ? Math.round((oi / s) * 1000) / 10 : null; })
      : null;
    // one-off / exceptional (latest quarter)
    const exc = last(qRow('Exceptional'));
    const pbt = last(qRow('Profit before tax') ?? qRow('Profit Before Tax'));
    outT.exceptional_curr_cr = exc;
    outT.exceptional_pct_pbt = (exc != null && pbt != null && pbt !== 0) ? Math.round((exc / Math.abs(pbt)) * 1000) / 10 : null;
    // annual CFO / PAT series (right-aligned)
    const cf = parseTableLoose(html, 'cash-flow');
    const pl = parseTableLoose(html, 'profit-loss');
    const secRow = (t: { rows: Record<string, (number | null)[]> } | null, kw: string): (number | null)[] | null => {
      if (!t) return null;
      const k = Object.keys(t.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
      return k ? (t.rows[k] || null) : null;
    };
    const cfoRow = secRow(cf, 'Cash from Operating');
    const patRow = secRow(pl, 'Net Profit') ?? secRow(pl, 'Profit');
    if (cfoRow && patRow) {
      // zzz371 — VALUE FIX (audit): the P&L table carries a trailing "TTM" column
      // that the cash-flow table does NOT have. Blind right-alignment therefore
      // paired FY-N CFO with FY-N+1 PAT — every annual CFO/PAT ratio was shifted
      // one year. Align by column LABEL (e.g. "Mar 2025"), skipping non-FY labels
      // like TTM; fall back to right-alignment only if labels are unavailable.
      const pairs: (number | null)[] = [];
      const cfLabels = (cf && cf.labels) || [];
      const plLabels = (pl && pl.labels) || [];
      const isFY = (lb: string) => /^[A-Za-z]{3}\s+\d{4}$/.test(String(lb).trim());
      if (cfLabels.length === cfoRow.length && plLabels.length === patRow.length && cfLabels.some(isFY)) {
        const plIdx: Record<string, number> = {};
        plLabels.forEach((lb, i) => { if (isFY(lb)) plIdx[String(lb).trim()] = i; });
        cfLabels.forEach((lb, i) => {
          if (!isFY(lb)) return;
          const j = plIdx[String(lb).trim()];
          const c = cfoRow[i] ?? null;
          const pv = j != null ? (patRow[j] ?? null) : null;
          pairs.push(c == null || pv == null || pv === 0 ? null : Math.round((c / pv) * 100) / 100);
        });
      } else {
        // fallback: strip a trailing TTM on the P&L side, then right-align
        const patFY = plLabels.length === patRow.length ? patRow.filter((_, i) => isFY(plLabels[i])) : patRow;
        const L = Math.min(cfoRow.length, patFY.length);
        for (let k = 0; k < L; k++) {
          const c = cfoRow[cfoRow.length - L + k] ?? null;
          const pv = patFY[patFY.length - L + k] ?? null;
          pairs.push(c == null || pv == null || pv === 0 ? null : Math.round((c / pv) * 100) / 100);
        }
      }
      if (pairs.length) outT.annual_cfo_pat = pairs.slice(Math.max(0, pairs.length - 6));
    }
    // pledge + return ratios from top-ratios block
    const ratios = parseTopRatios(html);
    const pk = Object.keys(ratios).find((k) => /pledg/i.test(k));
    if (pk) outT.pledged_pct = ratios[pk] ?? null;
    const ric = Object.keys(ratios).find((k) => /roic|return on invested/i.test(k));
    if (ric) outT.roic = ratios[ric] ?? null;
    // latest + prior-quarter P&L-quality scalars (used by the institutional chips)
    const oiFull = qRow('Other income normal') ?? qRow('Other Income');
    const prevOf = (arr: (number | null)[] | null): number | null => (arr && arr.length >= 2 ? arr[arr.length - 2] : null);
    const oiCurr = last(oiFull), oiPrev = prevOf(oiFull);
    const sCurr = last(salesRow), sPrev = prevOf(salesRow);
    outT.other_income_pct_sales_curr = (oiCurr != null && sCurr != null && sCurr !== 0) ? Math.round((oiCurr / sCurr) * 1000) / 10 : null;
    // zzz368 — prior-quarter Other-Income % of sales so the scalar "OTHER-INC ↓/↑"
    // chip (which needs both curr AND prev) actually fires. Without prev it was null.
    outT.other_income_pct_sales_prev = (oiPrev != null && sPrev != null && sPrev !== 0) ? Math.round((oiPrev / sPrev) * 1000) / 10 : null;
    const taxTail = qRow('Tax %');
    outT.effective_tax_rate_curr = last(taxTail);
    outT.effective_tax_rate_prev = taxTail && taxTail.length >= 2 ? taxTail[taxTail.length - 2] : null;
  } catch { /* null-safe: any parse hiccup yields no trend fields, never a throw */ }
  for (const k of Object.keys(outT)) { if (outT[k] == null) delete outT[k]; }
  return outT;
}

function parseSector(html: string): string | null {
  const peer = html.match(/<a[^>]*href=["']\/company\/compare\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  if (peer) {
    const txt = stripTags(peer[1]).replace(/^Compare with\s+/i, '').trim();
    if (txt && txt.length < 60) return txt;
  }
  return null;
}

async function fetchScreenerHtml(url: string): Promise<string | null> {
  // PATCH 0404 — three attempts with rotated UA + browser-mimic headers
  // + jittered backoff. Cloudflare's lightweight challenge almost always
  // passes on the 2nd attempt once the IP+UA combination has a session
  // ring. Returns first HTML containing the top-ratios sentinel; null
  // if all attempts fail.
  for (let attempt = 0; attempt < SCREENER_RETRY_DELAYS_MS.length; attempt++) {
    const delay = SCREENER_RETRY_DELAYS_MS[attempt];
    if (delay > 0) {
      const jittered = delay + Math.floor((Math.random() - 0.5) * delay * 0.6);
      await new Promise((r) => setTimeout(r, jittered));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SCREENER_TIMEOUT_MS);
    try {
      // PATCH 0518 — Route through Cloudflare Worker proxy when env vars set.
      // proxiedFetch falls back to direct fetch when PROXY_URL/PROXY_SECRET
      // are missing — transparent to callers. See lib/proxy-fetch.ts.
      const res = await proxiedFetch(url, {
        headers: browserHeaders('https://www.screener.in/'),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        if (res.status === 404) return null;   // permanent miss, don't retry URL
        continue;                              // 403/429/503 → next attempt
      }
      const html = await res.text();
      if (!/id=["']top-ratios["']/.test(html)) continue;
      return html;
    } catch {
      clearTimeout(t);
      // Network error or timeout → next attempt
    }
  }
  return null;
}

async function fetchScreenerForSymbol(symbol: string): Promise<any | null> {
  const urls = [
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`,
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/`,
  ];
  for (const url of urls) {
    const html = await fetchScreenerHtml(url);
    if (!html) continue;
    const q = parseQuartersTable(html);
    if (!q || q.labels.length < 5) continue;
    const ratios = parseTopRatios(html);
    const sector = parseSector(html);
    const N = q.labels.length;
    const latestIdx = N - 1;
    const priorIdx = N - 5;
    const get = (kw: string, idx: number) => {
      const k = Object.keys(q.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
      return k ? (q.rows[k]?.[idx] ?? null) : null;
    };
    const salesCurr = get('Sales', latestIdx) ?? get('Revenue', latestIdx) ?? get('Income', latestIdx) ?? get('Interest', latestIdx) ?? get('Premium', latestIdx);
    const salesPrev = get('Sales', priorIdx) ?? get('Revenue', priorIdx) ?? get('Income', priorIdx) ?? get('Interest', priorIdx) ?? get('Premium', priorIdx);
    // zzz233 — NBFC / bank / insurance sector-shape fallback.
    // Screener.in labels these sectors' operating profit differently:
    //   NBFC / Bank       → "Financing Profit" + "Financing Margin %"
    //   Insurance         → "Underwriting Profit" (rare) + no OPM row
    // Without the fallback, L&T Finance (LTF), Indian Bank (INDIANB), and
    // Bank of Maharashtra (MAHABANK) all rendered as OPM 0.0% (+0.0pp) on
    // Earnings Opportunities cards. The literal string "Operating Profit"
    // and "OPM" simply never appear in those rows so get(...) returned null,
    // and the PATCH 1005 op/rev fallback couldn't fill it either.
    const opCurr = get('Operating Profit', latestIdx) ?? get('Financing Profit', latestIdx);
    const opPrev = get('Operating Profit', priorIdx) ?? get('Financing Profit', priorIdx);
    const opmCurr = get('OPM', latestIdx) ?? get('Financing Margin', latestIdx);
    const opmPrev = get('OPM', priorIdx) ?? get('Financing Margin', priorIdx);
    const patCurr = get('Net Profit', latestIdx) ?? get('Profit', latestIdx);
    const patPrev = get('Net Profit', priorIdx) ?? get('Profit', priorIdx);
    const epsCurr = get('EPS', latestIdx);
    const epsPrev = get('EPS', priorIdx);
    if (salesCurr == null && patCurr == null && epsCurr == null) continue;
    const cp = ratios['Current Price'];
    const hi = ratios['High'] ?? ratios['52w High'];
    const mcap = ratios['Market Cap'] ?? null;
    const bucket = mcap == null ? null : mcap >= 200_000 ? 'MEGA' : mcap >= 20_000 ? 'LARGE' : mcap >= 5_000 ? 'MID' : mcap >= 500 ? 'SMALL' : 'MICRO';
    return {
      sector,
      pe: ratios['Stock P/E'] ?? ratios['P/E'] ?? null,
      // zzz358 BUG3 — surface ROCE/ROE from the Screener top-ratios <ul> so the
      // direct-Screener path (worker absent) carries them. Tolerant key lookup
      // handles "ROCE" / "ROCE %" / "Return on capital employed" layouts.
      roce: ratios['ROCE'] ?? ratios['ROCE %'] ?? ratios['Return on capital employed'] ?? null,
      roe: ratios['ROE'] ?? ratios['ROE %'] ?? ratios['Return on equity'] ?? null,
      market_cap_cr: mcap,
      market_cap_bucket: bucket,
      current_price: cp ?? null,
      high_52w: hi ?? null,
      low_52w: ratios['Low'] ?? ratios['52w Low'] ?? null,
      pct_from_52w_high: (cp != null && hi != null && hi > 0) ? Math.round(((cp - hi) / hi) * 1000) / 10 : null,
      sales_curr_cr: salesCurr, sales_prev_cr: salesPrev,
      op_profit_curr_cr: opCurr, op_profit_prev_cr: opPrev,
      opm_pct: opmCurr, opm_prev_pct: opmPrev,
      pat_curr_cr: patCurr, pat_prev_cr: patPrev,
      eps_curr: epsCurr, eps_prev: epsPrev,
      sales_yoy_pct: pct(salesCurr, salesPrev),
      op_profit_yoy_pct: pct(opCurr, opPrev),
      pat_yoy_pct: pct(patCurr, patPrev),
      eps_yoy_pct: pct(epsCurr, epsPrev),
      latest_quarter_label: q.labels[latestIdx],
      financials_source: 'screener',
      // zzz356 — 4-quarter history (Sales/EPS/OPM) + EBITDA margin + Receivables/
      // Inventory YoY. All parsed from the same Screener HTML we already have,
      // no extra fetch cost. Powers acceleration chips + working-capital red flags.
      ...(() => {
        const lastN = (kw: string, n: number): (number | null)[] => {
          const rowKey = Object.keys(q.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          if (!rowKey) return [];
          const arr = q.rows[rowKey] || [];
          return arr.slice(Math.max(0, arr.length - n));
        };
        const salesQ4 = lastN('Sales', 4).length ? lastN('Sales', 4) : (lastN('Revenue', 4).length ? lastN('Revenue', 4) : lastN('Income', 4));
        const epsQ4 = lastN('EPS', 4);
        const opmQ4 = lastN('OPM', 4).length ? lastN('OPM', 4) : lastN('Financing Margin', 4);
        // EBITDA margin from P&L "OPM %" row (annual). Falls back to quarterly OPM.
        const pl = parseSectionTable(html, 'profit-loss');
        const plLatest = pl && pl.labels.length > 0 ? pl.labels.length - 1 : -1;
        const getPL = (kw: string, idx: number): number | null => {
          if (!pl || idx < 0) return null;
          const k = Object.keys(pl.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          return k ? (pl.rows[k]?.[idx] ?? null) : null;
        };
        const opmAnnual = getPL('OPM', plLatest);
        // Receivables + Inventory YoY from balance-sheet section
        const bs = parseSectionTable(html, 'balance-sheet');
        const bsLatest = bs && bs.labels.length > 0 ? bs.labels.length - 1 : -1;
        const bsPrior = bsLatest > 0 ? bsLatest - 1 : -1;
        const getBS = (kw: string, idx: number): number | null => {
          if (!bs || idx < 0) return null;
          const k = Object.keys(bs.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          return k ? (bs.rows[k]?.[idx] ?? null) : null;
        };
        const recvCurr = getBS('Trade Receivables', bsLatest) ?? getBS('Receivables', bsLatest);
        const recvPrev = getBS('Trade Receivables', bsPrior) ?? getBS('Receivables', bsPrior);
        const invCurr = getBS('Inventor', bsLatest);
        const invPrev = getBS('Inventor', bsPrior);
        return {
          quarters_sales: salesQ4.length >= 2 ? salesQ4 : null,
          quarters_eps: epsQ4.length >= 2 ? epsQ4 : null,
          quarters_opm: opmQ4.length >= 2 ? opmQ4 : null,
          ebitda_margin_pct: opmAnnual,
          receivables_yoy_pct: pct(recvCurr, recvPrev),
          inventory_yoy_pct: pct(invCurr, invPrev),
        };
      })(),
      // zzz316 — CFO/PAT from cash-flow + profit-loss annual tables. Same HTML,
      // same source of truth Screener shows users. Ratio > 0.8 = healthy cash
      // conversion; <0.5 = profits not translating to cash (earnings-quality flag).
      ...(() => {
        const cf = parseSectionTable(html, 'cash-flow');
        const pl = parseSectionTable(html, 'profit-loss');
        const cfLatest = cf && cf.labels.length > 0 ? cf.labels.length - 1 : -1;
        const plLatest = pl && pl.labels.length > 0 ? pl.labels.length - 1 : -1;
        const getRow = (t: { rows: Record<string, (number | null)[]> } | null, kw: string, idx: number): number | null => {
          if (!t || idx < 0) return null;
          const k = Object.keys(t.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          return k ? (t.rows[k]?.[idx] ?? null) : null;
        };
        const ocfAnnual = getRow(cf, 'Cash from Operating', cfLatest);
        // Try TTM last (right-most) column of P&L first; fall back to latest annual.
        const patAnnual = getRow(pl, 'Net Profit', plLatest) ?? getRow(pl, 'Profit', plLatest);
        // zzz364 — annual sales for the meaningfulness gate below.
        const salesAnnual = getRow(pl, 'Sales', plLatest) ?? getRow(pl, 'Revenue', plLatest);
        let ratio = (typeof ocfAnnual === 'number' && typeof patAnnual === 'number' && patAnnual > 0)
          ? Math.round((ocfAnnual / patAnnual) * 100) / 100
          : null;
        // zzz364 BUG B FIX — CFO/PAT explodes into artifacts (-65.58, 21.75,
        // -12.84) when PAT is tiny/near-zero. Null the ratio out when it is not
        // a meaningful earnings-quality signal: (a) |PAT| is a rounding-scale
        // sliver of sales (< 2% of |sales|, when sales is known), or (b) the
        // ratio magnitude exceeds 8 (clearly an artifact, not real cash
        // conversion). Genuine values in [-8, 8] are kept.
        if (ratio != null) {
          const patTinyVsSales = typeof salesAnnual === 'number' && salesAnnual !== 0
            && typeof patAnnual === 'number'
            && Math.abs(patAnnual) < 0.02 * Math.abs(salesAnnual);
          if (patTinyVsSales || Math.abs(ratio) > 8) ratio = null;
        }
        return {
          ocf_annual_cr: ocfAnnual,
          pat_annual_cr: patAnnual,
          ocf_to_pat_ratio: ratio,
        };
      })(),
      // zzz358 — Tier 2 P&L quality fields, computed from the SAME quarterly
      // table (`q` / `get` / `salesCurr` etc.) we already parsed above. No extra
      // fetch. Every field is null-safe: when a source row is absent get(...)
      // returns null and the arithmetic / pct() below short-circuit to null
      // rather than throwing, so existing extraction is never broken.
      ...(() => {
        // Screener quarterly P&L rows: "Other Income", "Depreciation",
        // "Interest" (= finance cost for non-financials), "Tax %".
        const otherIncCurr = get('Other Income', latestIdx);
        const otherIncPrev = get('Other Income', priorIdx);
        const depCurr = get('Depreciation', latestIdx);
        const depPrev = get('Depreciation', priorIdx);
        // Finance cost: Screener labels the P&L expense row "Interest".
        // (For banks/NBFCs "Interest" is a revenue line — this field is only
        //  meaningful for non-financials; left as-is, additive + null-safe.)
        const finCurr = get('Interest', latestIdx);
        // Effective tax rate: Screener publishes the ready "Tax %" row, which
        // IS Tax / PBT (%). Read it directly rather than deriving from an
        // absolute Tax row (Screener quarters expose no absolute Tax figure).
        const taxRateCurr = get('Tax %', latestIdx);
        const taxRatePrev = get('Tax %', priorIdx);
        // Other Income as % of Sales.
        const oiPct = (oi: number | null, sales: number | null): number | null =>
          (oi != null && sales != null && sales !== 0)
            ? Math.round((oi / sales) * 1000) / 10
            : null;
        // EBIT = Operating Profit − Depreciation (both from quarters table).
        const ebitCurr = (opCurr != null && depCurr != null) ? opCurr - depCurr : null;
        const ebitPrev = (opPrev != null && depPrev != null) ? opPrev - depPrev : null;
        // EBITDA on Operating-Profit basis: Screener "Operating Profit" is
        // pre-Depreciation, so it already equals EBITDA.
        const ebitdaCurr = opCurr;
        const ebitdaPrev = opPrev;
        return {
          other_income_pct_sales_curr: oiPct(otherIncCurr, salesCurr),
          other_income_pct_sales_prev: oiPct(otherIncPrev, salesPrev),
          effective_tax_rate_curr: taxRateCurr,
          effective_tax_rate_prev: taxRatePrev,
          dep_yoy_pct: pct(depCurr, depPrev),
          finance_cost_curr_cr: finCurr,
          ebit_curr_cr: ebitCurr,
          ebit_yoy_pct: pct(ebitCurr, ebitPrev),
          ebitda_curr_cr: ebitdaCurr,
          ebitda_yoy_pct: pct(ebitdaCurr, ebitdaPrev),
        };
      })(),
      // zzz360 — quarterly cost/tax/other-income series + annual CFO/PAT +
      // pledge + working-capital / return ratios. All parsed from the SAME
      // Screener HTML already in hand (`q` quarters table, `ratios` top-ratios
      // block, `parseSectionTable` for annual cash-flow / profit-loss / ratios).
      // Every field is null-safe: a missing source row yields null (or a null
      // element inside the array), never a throw. Additive only — nothing above
      // is touched.
      ...(() => {
        // Whole-row lookup by keyword against the quarterly P&L table.
        const qRow = (kw: string): (number | null)[] | null => {
          const k = Object.keys(q.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          return k ? (q.rows[k] || null) : null;
        };
        // Sales row drives the alignment window: up to the last 8 quarters,
        // right-aligned to the newest quarter (chronological oldest→newest),
        // consistent with the existing quarters_sales series.
        const salesRow =
          qRow('Sales') ?? qRow('Revenue') ?? qRow('Income') ?? qRow('Interest') ?? qRow('Premium');
        const QN = salesRow ? Math.min(8, salesRow.length) : 0;
        // Right-tail an array to the same QN window (best-effort per-row length).
        const tail = (arr: (number | null)[] | null): (number | null)[] | null =>
          arr && QN > 0 ? arr.slice(Math.max(0, arr.length - QN)) : null;

        const materialRow = tail(qRow('Material Cost %'));
        const taxRow = tail(qRow('Tax %'));
        // Prefer the "Other income normal" row (recurring), else "Other Income".
        const oiRow = tail(qRow('Other income normal') ?? qRow('Other Income'));
        const salesTail = tail(salesRow);

        // Quarterly Other Income as % of that quarter's Sales, element-aligned.
        const quarters_other_income_pct: (number | null)[] | null =
          oiRow && salesTail
            ? oiRow.map((oi, i) => {
                const s = salesTail[i];
                return oi != null && s != null && s !== 0 ? Math.round((oi / s) * 1000) / 10 : null;
              })
            : null;

        // ── Annual CFO / PAT per financial year (last up to 6 FY) ──
        const cf = parseSectionTable(html, 'cash-flow');
        const pl = parseSectionTable(html, 'profit-loss');
        const secRow = (
          t: { rows: Record<string, (number | null)[]> } | null,
          kw: string,
        ): (number | null)[] | null => {
          if (!t) return null;
          const k = Object.keys(t.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          return k ? (t.rows[k] || null) : null;
        };
        const cfoRow = secRow(cf, 'Cash from Operating');
        const patRow = secRow(pl, 'Net Profit') ?? secRow(pl, 'Profit');
        let annual_cfo_pat: (number | null)[] | null = null;
        if (cf && pl && cfoRow && patRow) {
          // Align by column label so a trailing P&L "TTM" column can't skew the
          // year pairing. Fall back to right-aligned positional if labels miss.
          const plIndex: Record<string, number> = {};
          pl.labels.forEach((lb, i) => {
            plIndex[String(lb).trim()] = i;
          });
          let pairs: (number | null)[] = cf.labels.map((lb, i) => {
            const j = plIndex[String(lb).trim()];
            const cfo = cfoRow[i] ?? null;
            const pat = j != null ? (patRow[j] ?? null) : null;
            if (cfo == null || pat == null) return null;
            if (pat === 0) return null; // divide-by-zero guard (negatives allowed)
            return Math.round((cfo / pat) * 100) / 100;
          });
          const anyMatched = pairs.some((v) => v != null);
          if (!anyMatched) {
            // No label overlap — align both rows from the right (newest FY).
            const L = Math.min(cfoRow.length, patRow.length);
            pairs = [];
            for (let k = 0; k < L; k++) {
              const cfo = cfoRow[cfoRow.length - L + k] ?? null;
              const pat = patRow[patRow.length - L + k] ?? null;
              pairs.push(cfo == null || pat == null || pat === 0 ? null : Math.round((cfo / pat) * 100) / 100);
            }
          }
          annual_cfo_pat = pairs.slice(Math.max(0, pairs.length - 6));
        }

        // ── Pledge + return / working-capital ratios ──
        // Pledged percentage from the top-ratios block (0 is valid, not null).
        const pledgedKey = Object.keys(ratios).find((k) => /pledg/i.test(k));
        const pledged_pct = pledgedKey ? (ratios[pledgedKey] ?? null) : null;

        // ROIC / Interest coverage from the top-ratios block (tolerant match).
        const topGet = (re: RegExp): number | null => {
          const k = Object.keys(ratios).find((kk) => re.test(kk));
          return k ? (ratios[k] ?? null) : null;
        };
        const roic = topGet(/roic|return on invested/i);
        const int_coverage = topGet(/int(?:erest)?\.?\s*coverage/i);

        // Debtor / Inventory / Working-capital days from the annual Ratios table.
        const rt = parseSectionTable(html, 'ratios');
        const rtLatest = rt && rt.labels.length > 0 ? rt.labels.length - 1 : -1;
        const rtGet = (kw: string): number | null => {
          if (!rt || rtLatest < 0) return null;
          const k = Object.keys(rt.rows).find((kk) => kk.toLowerCase().includes(kw.toLowerCase()));
          return k ? (rt.rows[k]?.[rtLatest] ?? null) : null;
        };
        const debtor_days = rtGet('Debtor Days');
        const inventory_days = rtGet('Inventory Days');
        const wc_days = rtGet('Working Capital Days');

        return {
          quarters_material_cost_pct: materialRow, // zzz360
          quarters_other_income_pct, // zzz360
          quarters_tax_pct: taxRow, // zzz360
          annual_cfo_pat, // zzz360
          pledged_pct, // zzz360
          debtor_days, // zzz360
          inventory_days, // zzz360
          wc_days, // zzz360
          roic, // zzz360
          int_coverage, // zzz360
        };
      })(),
      // zzz363 — one-off (exceptional) income detection from the SAME quarterly
      // P&L table already in hand (`get` / `latestIdx`). A large exceptional
      // GAIN can flatter a headline "beat", so we expose the latest-quarter
      // Exceptional-items value and its share of that quarter's Profit before
      // tax. The ratio uses |PBT| in the denominator so the sign always tracks
      // the exceptional item itself (a big positive % = one-off gain inflating
      // the print; negative = one-off charge depressing it). Fully null-safe:
      // a missing Exceptional row, a missing PBT, or PBT == 0 yields null.
      ...(() => {
        // Screener quarterly rows: "Exceptional items", "Profit before tax".
        const exceptional_curr_cr = get('Exceptional items', latestIdx); // zzz363
        const pbtCurr = get('Profit before tax', latestIdx); // zzz363
        const exceptional_pct_pbt =
          exceptional_curr_cr != null && pbtCurr != null && pbtCurr !== 0
            ? Math.round((exceptional_curr_cr / Math.abs(pbtCurr)) * 1000) / 10
            : null; // zzz363
        return {
          exceptional_curr_cr, // zzz363
          exceptional_pct_pbt, // zzz363
        };
      })(),
    };
  }
  return null;
}

// ─── Yahoo fetcher ─────────────────────────────────────────────────────────
async function fetchYahooForSymbol(symbol: string, filedHint?: string): Promise<any | null> {  // PATCH 0986
  // PATCH 0998 — multi-endpoint retry. Yahoo sometimes blocks Railway IPs
  // on query1. Try query1 → query2 → suffix .BO as last resort. Use a richer
  // browser UA. range=6mo gives us 120+ trading days — enough for MA50/150
  // and the filing-date D1 lookback. range=1y was unnecessarily large.
  const stronger_ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const candidates = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=6mo&interval=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=6mo&interval=1d`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.BO?range=6mo&interval=1d`,
  ];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT_MS);
  let r: any = null;
  try {
    for (const url of candidates) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': stronger_ua, 'Accept': 'application/json,*/*' }, signal: ctrl.signal });
        if (!res.ok) continue;
        const j = await res.json();
        const candR = j?.chart?.result?.[0];
        if (candR && candR.indicators?.quote?.[0]?.close) {
          r = candR;
          break;
        }
      } catch {
        // try next endpoint
      }
    }
    if (!r) return null;
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
    const opens: (number | null)[] = r.indicators?.quote?.[0]?.open || [];
    const volumes: (number | null)[] = r.indicators?.quote?.[0]?.volume || [];  // PATCH 1034 — liquidity/EP
    const highs: (number | null)[] = r.indicators?.quote?.[0]?.high || [];
    const lows: (number | null)[] = r.indicators?.quote?.[0]?.low || [];
    const meta = r.meta || {};
    let lastIdx = -1, lastClose: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null && Number.isFinite(closes[i] as number)) { lastIdx = i; lastClose = closes[i]!; break; }
    }
    // PATCH 0986 — if filedHint given, find FILING-DATE index using r.timestamp[]
    // so D1 reflects POST-EARNINGS reaction, not today's daily move.
    const timestamps: number[] = (r.timestamp as number[] | undefined) || [];  // PATCH 0989
    let filedIdx = -1;
    if (filedHint && timestamps.length === closes.length) {
      // filedHint is YYYY-MM-DD; convert to UTC midnight epoch seconds for fair compare
      const filedMs = Date.parse(filedHint);
      if (!Number.isNaN(filedMs)) {
        const filedDay = Math.floor(filedMs / 86400_000);
        // Pick the first close whose date >= filedDay (handles after-hours filings → next trading day)
        for (let i = 0; i < timestamps.length; i++) {
          const tsDay = Math.floor((timestamps[i] * 1000) / 86400_000);
          if (tsDay >= filedDay && closes[i] != null && Number.isFinite(closes[i] as number)) {
            filedIdx = i;
            break;
          }
        }
      }
    }
    // Reaction index: filedIdx if known, else lastIdx
    const reactionIdx = filedIdx >= 0 ? filedIdx : lastIdx;
    // Search backward for first non-null prev close (handles holiday gaps)
    let prevClose: number | null = null;
    if (reactionIdx >= 1) {
      for (let i = reactionIdx - 1; i >= 0 && i >= reactionIdx - 5; i--) {
        const c = closes[i];
        if (c != null && Number.isFinite(c as number)) {
          prevClose = c as number;  // PATCH 0989 — explicit narrow
          break;
        }
      }
    }
    const reactionClose: number | null = reactionIdx >= 0 ? (closes[reactionIdx] ?? null) : null;  // PATCH 0989
    const openReaction: number | null = reactionIdx >= 0 ? (opens[reactionIdx] ?? null) : null;  // PATCH 0989
    const gap = (openReaction != null && prevClose != null && prevClose > 0) ? ((openReaction - prevClose) / prevClose) * 100 : null;
    const d1 = (reactionClose != null && prevClose != null && prevClose > 0) ? ((reactionClose - prevClose) / prevClose) * 100 : null;
    // MA helpers
    const sma = (window: number, idx: number): number | null => {
      // PATCH 0986 — skip null closes (Indian-stock holiday gaps).
      // Require ≥ 80% of window to be valid so MAs survive normal Q4 calendar
      // (Mahavir Jayanti / Eid / Diwali) instead of returning null forever.
      if (idx < window - 1) return null;
      let s = 0, n = 0;
      for (let i = idx - window + 1; i <= idx; i++) {
        const v = closes[i];
        if (v == null || !Number.isFinite(v as number)) continue;
        s += (v as number); n++;  // PATCH 0989 — explicit cast for TS strict
      }
      if (n < Math.ceil(window * 0.8)) return null;
      return s / n;
    };
    const ma50 = sma(50, lastIdx);
    const ma150 = sma(150, lastIdx);
    const ma200 = sma(200, lastIdx);
    const ma200_30 = sma(200, lastIdx - 30);
    const ma200_slope = (ma200 != null && ma200_30 != null && ma200_30 > 0) ? ((ma200 - ma200_30) / ma200_30) * 100 : null;
    // 12-week return for RS approximation (vs Nifty needs a separate call — we'll just use raw)
    const idx12w = Math.max(0, lastIdx - 60);
    const ret12w = closes[idx12w] != null && closes[idx12w]! > 0 && lastClose != null ? ((lastClose - closes[idx12w]!) / closes[idx12w]!) * 100 : null;
    // Stage
    let stage: 1 | 2 | 3 | 4 | null = null;
    if (lastClose != null && ma200 != null) {
      const above200 = lastClose > ma200;
      const stacked = ma50 != null && ma150 != null && ma50 > ma150 && ma150 > ma200;
      const slopeUp = ma200_slope != null && ma200_slope > 0;
      if (above200 && stacked && slopeUp) stage = 2;
      else if (!above200 && !slopeUp) stage = 4;
      else if (above200 && !slopeUp) stage = 3;
      else stage = 1;
    }
    // Trend template (Minervini 8)
    const trendTemplate = !!(lastClose && ma50 && ma150 && ma200 &&
      lastClose > ma50 && lastClose > ma150 && lastClose > ma200 &&
      ma150 > ma200 && ma200_slope != null && ma200_slope > 0 &&
      ma50 > ma150 &&
      meta.fiftyTwoWeekLow && lastClose > meta.fiftyTwoWeekLow * 1.25 &&
      meta.fiftyTwoWeekHigh && lastClose >= meta.fiftyTwoWeekHigh * 0.75);
    const hi52 = meta.fiftyTwoWeekHigh ?? null;
    const pctFromHi = (lastClose != null && hi52 != null && hi52 > 0) ? ((lastClose - hi52) / hi52) * 100 : null;
    // PATCH 1034 — liquidity + volume-signature metrics (institutional).
    // adtv_cr  : median daily traded value (₹ Cr) over last ~30 sessions —
    //            free-float/illiquidity proxy. Median so one spike can't mask a thin book.
    // rvol     : reaction-day volume ÷ 30-day median volume — volume surge (EP/Zanger Layer 9).
    // atr_pct  : ATR(14) as % of price — volatility, used to size the move in ATR units.
    const _tv: number[] = [];
    const _volWindow: number[] = [];
    for (let i = closes.length - 1; i >= 0 && _tv.length < 30; i--) {
      const c = closes[i]; const v = volumes[i];
      if (c != null && v != null && Number.isFinite(c as number) && Number.isFinite(v as number) && (v as number) > 0) {
        _tv.push((c as number) * (v as number));
        _volWindow.push(v as number);
      }
    }
    const _median = (arr: number[]): number | null => {
      if (arr.length < 5) return null;
      const a = [...arr].sort((x, y) => x - y);
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const _medTvR = _median(_tv);
    const adtv_cr: number | null = _medTvR != null ? _medTvR / 1e7 : null;
    const _medVol = _median(_volWindow);
    const _reactVol = (reactionIdx >= 0 && volumes[reactionIdx] != null && Number.isFinite(volumes[reactionIdx] as number)) ? (volumes[reactionIdx] as number) : null;
    const rvol: number | null = (_reactVol != null && _medVol != null && _medVol > 0) ? _reactVol / _medVol : null;
    // ATR(14) via true range over last valid 14 sessions.
    let atr_pct: number | null = null;
    {
      const trs: number[] = [];
      for (let i = closes.length - 1; i >= 1 && trs.length < 14; i--) {
        const h = highs[i], l = lows[i], pc = closes[i - 1];
        if (h != null && l != null && pc != null && Number.isFinite(h as number) && Number.isFinite(l as number) && Number.isFinite(pc as number)) {
          const tr = Math.max((h as number) - (l as number), Math.abs((h as number) - (pc as number)), Math.abs((l as number) - (pc as number)));
          trs.push(tr);
        }
      }
      if (trs.length >= 7 && lastClose != null && lastClose > 0) {
        const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
        atr_pct = (atr / lastClose) * 100;
      }
    }
    // zzz248 — Extract last 30 valid closes for client-side sparkline.
    // Cheap: closes array already in memory. Skip nulls (Indian-market holiday gaps).
    const _close30d: number[] = [];
    for (let i = closes.length - 1; i >= 0 && _close30d.length < 30; i--) {
      const c = closes[i];
      if (c != null && Number.isFinite(c as number)) _close30d.unshift(c as number);
    }
    return {
      current_price: lastClose, prev_close: prevClose,
      gap_pct: gap, d1_pct: d1,
      high_52w: hi52, low_52w: meta.fiftyTwoWeekLow ?? null,
      pct_from_52w_high: pctFromHi,
      ma_50: ma50, ma_150: ma150, ma_200: ma200, ma_200_slope_30d: ma200_slope,
      return_12w_pct: ret12w,
      stage, trend_template_passes: trendTemplate,
      adtv_cr, rvol, atr_pct,  // PATCH 1034
      close_30d: _close30d.length >= 2 ? _close30d : null,  // zzz248
      // zzz356 — 20-day avg volume + latest/avg ratio for institutional-
      // demand confirmation. Yahoo 52W high already present on Screener
      // path; the Yahoo copy here is the fallback when Screener is blocked.
      ...(() => {
        const _vol20: number[] = [];
        for (let i = volumes.length - 1; i >= 0 && _vol20.length < 20; i--) {
          const v = volumes[i];
          if (v != null && Number.isFinite(v as number) && (v as number) > 0) _vol20.unshift(v as number);
        }
        const avg = _vol20.length >= 5 ? _vol20.reduce((a, b) => a + b, 0) / _vol20.length : null;
        const latestVol = _vol20.length ? _vol20[_vol20.length - 1] : null;
        const ratio = (avg != null && avg > 0 && latestVol != null) ? Math.round((latestVol / avg) * 100) / 100 : null;
        const hi52Yahoo = (meta.fiftyTwoWeekHigh as number | undefined) ?? null;
        const dist52 = (hi52Yahoo != null && lastClose != null && hi52Yahoo > 0)
          ? Math.round(((lastClose - hi52Yahoo) / hi52Yahoo) * 1000) / 10
          : null;
        return { avg_vol_20d: avg, vol_ratio_20d: ratio, dist_52w_pct_yahoo: dist52 };
      })(),
    };
  } catch { return null; }
  finally { clearTimeout(t); }
}

// ─── Yahoo Finance quarterly fundamentals (4th-source fallback for Cloudflare-blocked Screener) ─
//
// PATCH 0512 — Pulls quarterly income statement from Yahoo Finance's
// quoteSummary endpoint. Used when Screener.in returns null (Cloudflare
// block on Vercel IPs) AND NSE's structured /financial-results is sparse.
//
// Endpoint: /v10/finance/quoteSummary/<SYM>.NS?modules=incomeStatementHistoryQuarterly
//
// Returns up to 4 quarters of: totalRevenue, netIncome, basicEPS, ebit.
// Picks latest 2 quarters and computes Sales/PAT/EPS YoY %.
//
// Unlike Screener, Yahoo is NOT Cloudflare-blocked from Vercel IPs.
// This gives us a fighting chance to surface YoY data for tickers like
// JAINREC, IOC, IGL, HLEGLAS when Screener is blocking.
async function fetchYahooFundamentals(symbol: string): Promise<any | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=incomeStatementHistoryQuarterly,price,summaryDetail,defaultKeyStatistics,financialData`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const result = j?.quoteSummary?.result?.[0];
    if (!result) return null;
    const quarterly = result.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
    if (quarterly.length < 2) return null;

    // Yahoo orders newest → oldest. Index 0 = latest Q, find YoY (target ≈ 1y back).
    const latest = quarterly[0];
    const latestDate = new Date((latest.endDate?.raw || 0) * 1000);
    const yoyTarget = new Date(latestDate); yoyTarget.setFullYear(yoyTarget.getFullYear() - 1);
    let prior: any = null;
    let bestDiff = Infinity;
    for (const q of quarterly.slice(1)) {
      const qd = new Date((q.endDate?.raw || 0) * 1000);
      const diff = Math.abs(qd.getTime() - yoyTarget.getTime());
      if (diff < bestDiff) { bestDiff = diff; prior = q; }
    }
    if (!prior) return null;

    // Yahoo values are in raw INR (not crores). Divide by 1e7 for Cr.
    const num = (v: any): number | null => {
      const n = v?.raw;
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    };
    const salesCurr = num(latest.totalRevenue);
    const salesPrev = num(prior.totalRevenue);
    const patCurr = num(latest.netIncome);
    const patPrev = num(prior.netIncome);
    const epsCurr = num(latest.basicEPS) ?? num(latest.dilutedEPS);
    const epsPrev = num(prior.basicEPS) ?? num(prior.dilutedEPS);
    const opCurr = num(latest.ebit) ?? num(latest.operatingIncome);
    const opPrev = num(prior.ebit) ?? num(prior.operatingIncome);

    const yoy = (curr: number | null, prev: number | null): number | null => {
      if (curr == null || prev == null || prev === 0) return null;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    const out: any = {
      sales_curr_cr: salesCurr != null ? salesCurr / 1e7 : null,
      sales_prev_cr: salesPrev != null ? salesPrev / 1e7 : null,
      sales_yoy_pct: yoy(salesCurr, salesPrev),
      pat_curr_cr: patCurr != null ? patCurr / 1e7 : null,
      pat_prev_cr: patPrev != null ? patPrev / 1e7 : null,
      pat_yoy_pct: yoy(patCurr, patPrev),
      eps_curr: epsCurr,
      eps_prev: epsPrev,
      eps_yoy_pct: yoy(epsCurr, epsPrev),
      op_profit_yoy_pct: yoy(opCurr, opPrev),
      latest_quarter_end_iso: !isNaN(latestDate.getTime()) ? latestDate.toISOString().slice(0, 10) : undefined,
      period_ended: !isNaN(latestDate.getTime()) ? latestDate.toISOString().slice(0, 10) : undefined,
      pe: result.summaryDetail?.trailingPE?.raw ?? null,
      // zzz258 — Bug B fallback: pull debtToEquity from Yahoo defaultKeyStatistics
      // or financialData module. Screener often returns null for this field.
      debtToEquity: result.defaultKeyStatistics?.debtToEquity?.raw
        ?? result.financialData?.debtToEquity?.raw ?? null,
      // Also grab returnOnEquity + returnOnCapital if available (backup for banks/NBFCs)
      roe: result.financialData?.returnOnEquity?.raw != null
        ? result.financialData.returnOnEquity.raw * 100 : null,
      // zzz364 BUG A FIX — do NOT alias returnOnAssets → ROCE. ROA ≪ ROCE for
      // any leveraged balance sheet (ROCE uses EBIT / capital-employed; ROA
      // uses net income / total assets), so the old zzz358 proxy systematically
      // UNDERSTATED ROCE and wrongly tripped the client's `roce < 15` quality
      // cap. A null ROCE renders as an honest "—" rather than a corrupt low
      // value that mis-caps quality. Only populate from a genuine
      // return-on-capital field; leave null otherwise (Screener supplies the
      // real ROCE when its top-ratios <ul> is reachable — never fabricate here).
      roce: result.financialData?.returnOnCapital?.raw != null
        ? result.financialData.returnOnCapital.raw * 100
        : null,
      financials_source: 'yahoo-fundamentals',
    };
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── NSE structured financials (PRIMARY) ───────────────────────────────────
// Pulls quarterly financial results directly from NSE's
// /api/corporates-financial-results endpoint. Returns the latest 2
// comparable Q4 periods (current + YoY prior) → computes YoY %.
//
// Field map per NSE XBRL response row:
//   re_revenue / re_incomeFromOperations / totalIncome → Sales
//   re_eps / re_dilutedEps                              → EPS
//   re_netProfit / NET                                  → Net Profit
//   re_operatingProfit / OPR                            → Operating Profit
//   re_toDate / re_periodEnded                          → quarter end date
//   re_ind_auditedUnAudited                             → audited flag
async function fetchNseFinancials(symbol: string): Promise<any | null> {
  try {
    const res = await fetchCompanyFinancialResults(symbol);
    const rows: any[] = Array.isArray(res) ? res : res?.data || [];
    if (!rows.length) return null;
    // Pick only Quarterly period rows, sort by toDate desc
    const quarterly = rows.filter((r) => {
      const period = String(r?.re_period || r?.period || '').toLowerCase();
      return !period || period.includes('quart');
    }).map((r) => ({
      ...r,
      _toDate: r?.re_toDate || r?.toDate || r?.re_periodEnded,
    })).filter((r) => r._toDate);
    quarterly.sort((a, b) => new Date(b._toDate).getTime() - new Date(a._toDate).getTime());
    if (quarterly.length < 2) return null;
    const latest = quarterly[0];
    // Find YoY prior (closest to 1 year before)
    const latestDate = new Date(latest._toDate);
    const yoyTarget = new Date(latestDate); yoyTarget.setFullYear(yoyTarget.getFullYear() - 1);
    let prior: any = null;
    let bestDiff = Infinity;
    for (const r of quarterly.slice(1)) {
      const rd = new Date(r._toDate);
      const diff = Math.abs(rd.getTime() - yoyTarget.getTime());
      if (diff < bestDiff) { bestDiff = diff; prior = r; }
    }
    if (!prior) return null;

    const pickNum = (row: any, keys: string[]): number | null => {
      for (const k of keys) {
        const v = row?.[k];
        if (v != null && v !== '') {
          const n = Number(String(v).replace(/,/g, ''));
          if (Number.isFinite(n)) return n;
        }
      }
      return null;
    };
    // Note: NSE returns values in ₹ Lakh by default (XBRL convention).
    // Convert to ₹ Cr (1 Cr = 100 Lakh).
    const toCr = (n: number | null): number | null => n == null ? null : Math.round(n / 100 * 100) / 100;

    const salesCurr = toCr(pickNum(latest, ['re_revenue', 're_incomeFromOperations', 'totalIncome', 'revenue', 'income']));
    const salesPrev = toCr(pickNum(prior, ['re_revenue', 're_incomeFromOperations', 'totalIncome', 'revenue', 'income']));
    const patCurr = toCr(pickNum(latest, ['re_netProfit', 'NET', 'netProfit', 're_profit']));
    const patPrev = toCr(pickNum(prior, ['re_netProfit', 'NET', 'netProfit', 're_profit']));
    const opCurr = toCr(pickNum(latest, ['re_operatingProfit', 'OPR', 'operatingProfit']));
    const opPrev = toCr(pickNum(prior, ['re_operatingProfit', 'OPR', 'operatingProfit']));
    const epsCurr = pickNum(latest, ['re_eps', 'EPS', 'eps', 're_dilutedEps', 'dilutedEPS', 'basicEPS']);
    const epsPrev = pickNum(prior, ['re_eps', 'EPS', 'eps', 're_dilutedEps', 'dilutedEPS', 'basicEPS']);

    if (salesCurr == null && patCurr == null && epsCurr == null) return null;

    // Quarter label
    const qNumber = (() => {
      const m = latestDate.getMonth() + 1;
      if (m === 3) return `Q4FY${String(latestDate.getFullYear()).slice(2)}`;
      if (m === 6) return `Q1FY${String(latestDate.getFullYear() + 1).slice(2)}`;
      if (m === 9) return `Q2FY${String(latestDate.getFullYear() + 1).slice(2)}`;
      if (m === 12) return `Q3FY${String(latestDate.getFullYear() + 1).slice(2)}`;
      return '';
    })();

    // PATCH 0182 — capture the actual ANNOUNCE date (when the company filed
    // the result), not just the quarter-end. NSE's re_broadcastDt is the
    // timestamp when the XBRL was submitted to the exchange — this is the
    // authoritative filing date.
    const announceRaw =
      latest.re_broadcastDt || latest.broadcastDate ||
      latest.re_date || latest.date ||
      latest.re_submissionDate;
    let announce_date_iso: string | null = null;
    if (announceRaw) {
      const ad = new Date(announceRaw);
      if (!isNaN(ad.getTime())) announce_date_iso = ad.toISOString().slice(0, 10);
    }

    return {
      company: latest.re_companyName || latest.companyName,
      quarter: qNumber,
      period_ended: latest._toDate,
      announce_date_iso,
      audited: /^(audited|yes)/i.test(latest.re_ind_auditedUnAudited || ''),
      sales_curr_cr: salesCurr, sales_prev_cr: salesPrev,
      pat_curr_cr: patCurr, pat_prev_cr: patPrev,
      op_profit_curr_cr: opCurr, op_profit_prev_cr: opPrev,
      eps_curr: epsCurr, eps_prev: epsPrev,
      sales_yoy_pct: pct(salesCurr, salesPrev),
      pat_yoy_pct: pct(patCurr, patPrev),
      op_profit_yoy_pct: pct(opCurr, opPrev),
      eps_yoy_pct: pct(epsCurr, epsPrev),
      latest_quarter_label: latestDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      financials_source: 'nse',
    };
  } catch {
    return null;
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────
function isValidSymbol(s: string): boolean {
  // PATCH 0195 — allow digit-leading tickers (3IINFOLTD, 3MINDIA, 5PAISA,
  // 63MOONS, 21STCENMGM, 360ONE etc.). Old regex required leading [A-Z]
  // which silently rejected these and made /enrich return empty data —
  // refresh would say "0/1 updated" for ever.
  return /^[A-Z0-9][A-Z0-9&\-]{1,15}$/.test(s);
}

// PATCH 0155.2 — three-tier source-of-truth chain:
//   1. NSE structured /api/corporates-financial-results (primary, XBRL)
//   2. BSE corporate filings + Screener (fallback for BSE-only stocks)
//   3. Yahoo Finance v8 (always overlaid for price/RS/Stage)
// PATCH 0369 — Resolve company name via Screener.in's own search API when
// the financial-data fetchers don't have a clean company_name. NSE often
// returns names with junk suffixes; Screener doesn't return anything for
// micro/small-caps. Without a real company name, the Screener.in export
// in the UI falls back to the bare ticker which Screener's fuzzy match
// can't resolve for many small-caps.
//
// Cache the resolved name in KV for 180 days — company names rarely change.
async function resolveCompanyNameFromScreenerSearch(symbol: string): Promise<string | null> {
  const cacheKey = `co-name:v1:${symbol.toUpperCase()}`;
  if (isRedisAvailable()) {
    try {
      const cached = await kvGet<string>(cacheKey);
      if (cached && typeof cached === 'string' && cached.trim()) return cached;
    } catch {}
  }
  try {
    const url = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.screener.in/',
      },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const arr: any[] = Array.isArray(json) ? json : (Array.isArray(json?.companies) ? json.companies : []);
    if (arr.length === 0) return null;

    // Best match priority:
    //   1. URL path contains /SYMBOL/ exactly (means Screener's symbol equals ours)
    //   2. Name starts with the symbol letters (acronym-style names)
    //   3. First result (Screener's default ranking)
    const symUp = symbol.toUpperCase();
    const exact = arr.find((c) => {
      const u = String(c.url || '').toUpperCase();
      return u.includes(`/${symUp}/`) || u.endsWith(`/${symUp}`);
    });
    const winner = exact || arr[0];
    const name = String(winner.name || winner.company_name || '').trim();
    if (!name) return null;
    // Don't cache the bare ticker as the "name" (that means search returned the ticker itself)
    if (name.toUpperCase() === symUp) return null;

    if (isRedisAvailable()) {
      try { await kvSet(cacheKey, name, 180 * 24 * 3600); } catch {}
    }
    return name;
  } catch {
    return null;
  }
}

async function enrichOne(symbol: string, filedHint?: string, bypassCache = false): Promise<any> {
  // Cache key includes filed date so a new filing busts old cache
  // PATCH 1013 — bumped v5 → v6 to invalidate stale entries lacking opm_pct.
  // zzz363 — bump v8->v9 to surface zzz360/zzz363 fields (stale KV was hiding them)
  // zzz366 — bump v9->v10: the trend/pledge/one-off fields were being DROPPED whenever
  // the Cloudflare Worker won the source merge (see overlay block below). v9 KV cached
  // those field-less payloads, so a straight code fix alone wouldn't surface them —
  // the cache key MUST change to force a clean re-fetch that carries the overlay.
  // zzz367 — v10->v11: v10 cached the field-less payloads (fetchScreenerForSymbol
  // was null in prod, so no trends). v11 forces a clean re-fetch that now carries the
  // trends via the proven fetchScreenerCFO path (extractScreenerTrends).
  const cacheKey = filedHint ? `enrich:v14:${symbol}:${filedHint}` : `enrich:v14:${symbol}`;  // zzz375 v13->v14: flush entries missing trends before the standalone-page fallback. zzz372 v12->v13. zzz369 v11->v12
  if (isRedisAvailable() && !bypassCache) {
    try {
      const cached = await kvGet(cacheKey);
      if (cached) return cached;
    } catch {}
  }
  // PATCH 0514 — Symbol variants for tickers with special chars.
  // GVT&D, M&MFIN, L&T, P&G — '&' breaks URL encoding on Yahoo/Screener.
  // Try the original + a sanitized form (strip & or replace with empty).
  // Yahoo sometimes accepts the literal & via URL encoding, sometimes
  // needs it stripped. Same for Screener which uses the symbol in URL path.
  const symVariants: string[] = [symbol];
  if (symbol.includes('&')) {
    symVariants.push(symbol.replace(/&/g, ''));     // GVT&D → GVTD
    symVariants.push(symbol.replace(/&/g, 'AND'));  // GVT&D → GVTANDD
    symVariants.push(symbol.replace(/&/g, '_'));    // GVT&D → GVT_D
  }
  if (symbol.includes('-')) {
    symVariants.push(symbol.replace(/-/g, ''));     // BAJAJ-AUTO → BAJAJAUTO
  }

  // Try each variant in parallel via Yahoo + Screener until one returns data.
  // PATCH 0519 — Worker (indiaearninghub) added as PRIMARY source. Returns
  // pre-parsed Screener financials via Cloudflare's network — never blocked.
  // When Worker returns valid data, we still fetch the others as overlays.
  // zzz320 — standalone CFO/PAT fetcher. Runs independently of the main
  // fetchScreenerForSymbol (which was returning null for many tickers because
  // its q.labels.length < 5 gate is too strict). Uses simple regex over the
  // consolidated HTML — Screener's cash-flow row is stable across all pages.
  // zzz367 — this proven-in-prod path now ALSO carries the quarterly trend series,
  // annual CFO/PAT, one-off/exceptional and pledge (via extractScreenerTrends on the
  // same HTML), because fetchScreenerForSymbol — the former sole source of those —
  // returns null on the proxied prod HTML. Cache bumped v1->v2 to include the trends.
  const fetchScreenerCFO = async (sym: string): Promise<any | null> => {
    // zzz322 — KV cache first (24h TTL)
    // zzz371 — honor the caller's bypassCache (nocache=1) so the client RETRY SWEEP
    // actually re-scrapes Screener instead of being re-served the same trend-less
    // cfo payload (that KV read was silently defeating zzz370's retry). Also: a cached
    // payload that has NO trends is never a valid hit for the trend consumers — fall
    // through and re-scrape so a transient miss self-heals.
    const kvKey = `cfo:v5:${sym}`;
    if (!bypassCache) {
      try {
        const cached = await kvGet<any>(kvKey);
        if (cached && typeof cached === 'object' && cached._trends) return cached;
      } catch {}
    }
    // zzz322 — reuse fetchScreenerHtml (3-attempt retry with backoff)
    // zzz375 — MANY mid/large caps (NAVINFLUOR, NEULANDLAB, LLOYDSME, IOLCP,
    // LUMAXTECH, SHILPAMED …) returned NO trends because this only ever hit
    // /consolidated/ — companies with no consolidated statements 404 there, or
    // their consolidated page lacks the quarters table. fetchScreenerForSymbol
    // already tries both; mirror that here. Take whichever URL yields the
    // quarters/trend data (prefer consolidated, fall back to standalone).
    const urls = [
      `https://www.screener.in/company/${encodeURIComponent(sym)}/consolidated/`,
      `https://www.screener.in/company/${encodeURIComponent(sym)}/`,
    ];
    let html: string | null = null;
    let anyPageLoaded = false;  // zzz376 — did EITHER URL actually return HTML?
    for (const u of urls) {
      const h = await fetchScreenerHtml(u);
      if (!h) continue;
      anyPageLoaded = true;
      html = h;
      // If this page already has a parsable quarters section, use it; else keep
      // it as a fallback but try the next URL for a richer page.
      if (Object.keys(extractScreenerTrends(h)).length > 0) break;
    }
    // zzz376 — DISTINGUISH the two failure modes for the UI:
    //   fetch-failed = both URLs failed to load (403/429/timeout/proxy) — TRANSIENT,
    //                  data may well exist; worth retrying. NOT cached so it retries.
    //   no-table     = a page DID load but has no quarterly section — GENUINELY absent
    //                  for this ticker. Cached briefly so we don't hammer Screener.
    if (!html) {
      return { _trends_status: 'fetch-failed' };
    }
    // Strip tags helper local (top-level stripTags exists elsewhere).
    const strip = (s: string) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/,/g, '').trim();
    const toNum = (s: string) => { const n = parseFloat(strip(s)); return Number.isFinite(n) ? n : null; };
    // Match ANY <tr> that contains the row label, then take the LAST numeric <td>.
    const findLastNum = (labelRe: RegExp): number | null => {
      const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let mm: RegExpExecArray | null;
      while ((mm = trRe.exec(html!)) !== null) {
        const row = mm[1];
        // Only consider TRs where the first cell text matches the label
        const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(m => strip(m[1]));
        if (!cells.length) continue;
        if (!labelRe.test(cells[0])) continue;
        // Latest = last cell with a numeric value
        for (let i = cells.length - 1; i >= 1; i--) {
          const v = toNum(cells[i]);
          if (v != null) return v;
        }
      }
      return null;
    };
    // zzz322 — loosened label match
    const ocf = findLastNum(/(cash\s+from\s+operating|cash\s+from\s+operations|operating\s+cash\s+flow|net\s+cash\s+from\s+operating)/i);
    // zzz371 — VALUE FIX (audit): the page-wide row scan matched the QUARTERS table's
    // "Net Profit" first (a single-quarter figure), and even on the P&L it took the
    // trailing TTM cell — so annual CFO was being divided by a quarterly/TTM PAT
    // (KMEW showed 1.17 top-line vs 0.62 in the annual pill from the same data).
    // Read the P&L section's latest FY column (label "Mon YYYY", skip TTM) so
    // numerator and denominator are the SAME fiscal year. Falls back to the old
    // scan only when the section parser can't find the P&L table.
    const plT = parseTableLoose(html, 'profit-loss');
    const fyIdxOf = (t: { labels: string[] } | null): number => {
      if (!t) return -1;
      for (let i = t.labels.length - 1; i >= 0; i--) if (/^[A-Za-z]{3}\s+\d{4}$/.test(String(t.labels[i]).trim())) return i;
      return -1;
    };
    const plFy = fyIdxOf(plT);
    const plRow = (kw: RegExp): number | null => {
      if (!plT || plFy < 0) return null;
      const k = Object.keys(plT.rows).find((kk) => kw.test(kk));
      const v = k ? plT.rows[k][plFy] : null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const netProfit = plRow(/^\s*Net Profit/i) ?? plRow(/^\s*Profit for/i)
                   ?? findLastNum(/^\s*Net Profit\s*[+\-]?\s*$/i)
                   ?? findLastNum(/^\s*Profit for (the )?year\s*[+\-]?\s*$/i)
                   ?? findLastNum(/^\s*Net Profit\b/i);
    // zzz364 — annual sales for the meaningfulness gate below.
    const salesAnnual = plRow(/^\s*Sales/i) ?? plRow(/^\s*Revenue/i) ?? findLastNum(/^\s*Sales\b/i) ?? findLastNum(/^\s*Revenue\b/i);
    let ratio = (typeof ocf === 'number' && typeof netProfit === 'number' && netProfit > 0)
      ? Math.round((ocf / netProfit) * 100) / 100
      : null;
    // zzz364 BUG B FIX — same artifact guard as the zzz316 annual path: when
    // PAT is tiny/near-zero the CFO/PAT ratio explodes (-65.58, 21.75, -12.84).
    // Null it out when it is not a meaningful quality signal: |PAT| < 2% of
    // |sales| (when sales is known) OR |ratio| > 8. Keep genuine [-8, 8] values.
    if (ratio != null) {
      const patTinyVsSales = typeof salesAnnual === 'number' && salesAnnual !== 0
        && typeof netProfit === 'number'
        && Math.abs(netProfit) < 0.02 * Math.abs(salesAnnual);
      if (patTinyVsSales || Math.abs(ratio) > 8) ratio = null;
    }
    // zzz367 — extract the trend/pledge/one-off fields from the SAME html.
    const trends = extractScreenerTrends(html);
    const result: any = { ocf_annual_cr: ocf, pat_annual_cr: netProfit, ocf_to_pat_ratio: ratio, ...trends };
    if (Object.keys(trends).length > 0) result._trends = true;
    // zzz376 — a page loaded (anyPageLoaded) but no quarters table → GENUINELY absent.
    result._trends_status = result._trends ? 'ok' : (anyPageLoaded ? 'no-table' : 'fetch-failed');
    // zzz369 — short-TTL when the trend extraction came back empty (transient
    // Screener miss) so the next fetch retries and self-heals, instead of pinning
    // a trend-less CFO payload for 24h and starving the enrich hoist.
    const cfoTtl = result._trends ? 24 * 3600 : 30 * 60;
    if (typeof ocf === 'number' || typeof netProfit === 'number' || result._trends) {
      try { await kvSet(`cfo:v5:${sym}`, result, cfoTtl); } catch {}
    }
    return result;
  };

  const tryVariant = async (sym: string, filedHint?: string) => {  // PATCH 0986
    const [worker, nse, screener, yahoo, yahooFund, cfoOnly] = await Promise.all([
      fetchWorkerStock(sym),
      fetchNseFinancials(sym),
      fetchScreenerForSymbol(sym),
      fetchYahooForSymbol(sym, filedHint),  // PATCH 0986
      fetchYahooFundamentals(sym),
      fetchScreenerCFO(sym), // zzz320 — dedicated CFO row extractor (Cloudflare-proxied)
    ]);
    const anyHit = worker || nse || screener || yahoo || yahooFund;
    return { sym, worker, nse, screener, yahoo, yahooFund, cfoOnly, anyHit };
  };

  // Run all variants in parallel; keep the first variant that actually
  // produced ANY data. Variant order matters: original first, then
  // sanitized forms.
  let worker: any = null, nse: any = null, screener: any = null, yahoo: any = null, yahooFund: any = null, cfoOnly: any = null;
  if (symVariants.length === 1) {
    // Fast path — no special chars in symbol, no variant fan-out needed
    const r = await tryVariant(symbol, filedHint);  // PATCH 0986
    worker = r.worker; nse = r.nse; screener = r.screener; yahoo = r.yahoo; yahooFund = r.yahooFund; cfoOnly = r.cfoOnly;
  } else {
    // Slow path — fan-out to variants in parallel, pick the most-populated.
    const results = await Promise.all(symVariants.map((v) => tryVariant(v, filedHint)));  // PATCH 0986
    // Score each result by how many sources returned non-null (Worker counts double — it's pre-parsed)
    const scored = results.map(r => ({
      ...r,
      score: (r.worker ? 2 : 0) + (r.nse ? 1 : 0) + (r.screener ? 1 : 0) + (r.yahoo ? 1 : 0) + (r.yahooFund ? 1 : 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    worker = best.worker; nse = best.nse; screener = best.screener; yahoo = best.yahoo; yahooFund = best.yahooFund; cfoOnly = best.cfoOnly;
  }
  // Merge priority (most reliable first):
  //   1. Cloudflare Worker  — pre-parsed, Cloudflare-immune (Patch 0519)
  //   2. NSE structured     — official Q-data when available
  //   3. Screener direct    — fallback for tickers not on Worker
  //   4. Yahoo fundamentals — Cloudflare-blocked Screener bypass
  //   Always overlay: Yahoo price / RS / Stage / 52w (separate concerns).
  const fin = worker || nse || screener || yahooFund || {};
  // Sector/market_cap_bucket from Worker / Screener if available
  const meta = worker ? {
    sector: worker.sector,
    market_cap_cr: worker.market_cap_cr,
    pe: worker.pe,
  } : screener ? {
    sector: screener.sector,
    market_cap_bucket: screener.market_cap_bucket,
    market_cap_cr: screener.market_cap_cr,
    pe: screener.pe,
  } : (yahooFund && yahooFund.pe ? { pe: yahooFund.pe } : {});
  const out: any = {
    ...fin,
    ...meta,
    ...(yahoo || {}),
    financials_source:
      worker ? 'screener-worker' :
      nse ? 'nse' :
      screener ? 'screener' :
      yahooFund ? 'yahoo-fundamentals' :
      null,
    _enriched_at: new Date().toISOString(),
  };
  // zzz259 — Cherry-pick institutional-quality fields from Yahoo fundamentals
  // even when a higher-priority source (Worker/NSE/Screener) won the merge.
  // Screener/Worker frequently return null for D/E; Yahoo's defaultKeyStatistics
  // reliably has it. Only fill fields that the primary source left null so we
  // never overwrite better data.
  // zzz358 BUG3 — hoist ROCE/ROE from the direct Screener top-ratios scrape
  // first (runs before the Yahoo fill below), so when the Worker/NSE path won
  // the merge but left ROCE/ROE null, the more-reliable Screener value fills
  // ahead of the Yahoo returnOnAssets proxy. Guarded on null → never overwrites
  // a good primary value.
  if (screener) {
    const sc = screener as any;
    if (out.roce == null && typeof sc.roce === 'number' && Number.isFinite(sc.roce)) {
      out.roce = sc.roce;
      out._roce_source = 'screener';
    }
    if (out.roe == null && typeof sc.roe === 'number' && Number.isFinite(sc.roe)) {
      out.roe = sc.roe;
      out._roe_source = 'screener';
    }
  }
  if (yahooFund) {
    const yf = yahooFund as any;
    if (out.debtToEquity == null && typeof yf.debtToEquity === 'number' && Number.isFinite(yf.debtToEquity)) {
      out.debtToEquity = yf.debtToEquity;
      out._de_source = 'yahoo-fundamentals';
    }
    if (out.roe == null && typeof yf.roe === 'number' && Number.isFinite(yf.roe)) {
      out.roe = yf.roe;
      out._roe_source = 'yahoo-fundamentals';
    }
    // zzz358 BUG3 — ROCE fallback from Yahoo (returnOnAssets/returnOnCapital
    // proxy). Only fills when the primary source left ROCE null so a good
    // Screener/Worker value is never overwritten.
    if (out.roce == null && typeof yf.roce === 'number' && Number.isFinite(yf.roce)) {
      out.roce = yf.roce;
      out._roce_source = 'yahoo-fundamentals';
    }
  }
  // zzz317 — Cherry-pick CFO/PAT fields from the direct Screener scrape even
  // when Worker won the primary merge. The Cloudflare Worker does not return
  // cash-flow data, so without this hoist the worker path always leaves the
  // ratio null. This is annual CFO/PAT (Screener does not publish quarterly
  // cash flow) — treat as multi-year quality signal, not a per-quarter check.
  if (screener) {
    const sc = screener as any;
    if (out.ocf_annual_cr == null && typeof sc.ocf_annual_cr === 'number') {
      out.ocf_annual_cr = sc.ocf_annual_cr;
      out._cfo_source = 'screener';
    }
    if (out.pat_annual_cr == null && typeof sc.pat_annual_cr === 'number') {
      out.pat_annual_cr = sc.pat_annual_cr;
    }
    if (out.ocf_to_pat_ratio == null && typeof sc.ocf_to_pat_ratio === 'number') {
      out.ocf_to_pat_ratio = sc.ocf_to_pat_ratio;
    }
  }
  // zzz320 — cfoOnly is the dedicated proxied CFO scrape. Runs even when the
  // main Screener HTML parser bombs out on the strict quarters gate.
  if (cfoOnly) {
    const co = cfoOnly as any;
    if (out.ocf_annual_cr == null && typeof co.ocf_annual_cr === 'number') {
      out.ocf_annual_cr = co.ocf_annual_cr;
      out._cfo_source = 'screener-cfo-only';
    }
    if (out.pat_annual_cr == null && typeof co.pat_annual_cr === 'number') {
      out.pat_annual_cr = co.pat_annual_cr;
    }
    if (out.ocf_to_pat_ratio == null && typeof co.ocf_to_pat_ratio === 'number') {
      out.ocf_to_pat_ratio = co.ocf_to_pat_ratio;
    }
    // zzz367 — hoist the trend/quarterly/pledge/one-off fields extracted on this
    // proven-working path. These are the fields that were missing in production
    // because fetchScreenerForSymbol (their former sole source) returns null there.
    // Fill only when the primary merge left them null, so a good Worker value is
    // never overwritten.
    const TREND_HOIST = [
      'quarters_material_cost_pct', 'quarters_other_income_pct', 'quarters_tax_pct',
      'quarters_sales', 'quarters_eps', 'quarters_opm',
      'annual_cfo_pat', 'pledged_pct', 'roic',
      'exceptional_curr_cr', 'exceptional_pct_pbt',
      'other_income_pct_sales_curr', 'other_income_pct_sales_prev',
      'effective_tax_rate_curr', 'effective_tax_rate_prev',
    ];
    for (const f of TREND_HOIST) {
      if ((out as any)[f] == null && co[f] != null) (out as any)[f] = co[f];
    }
    if (co._trends && out._screener_overlay == null) out._screener_overlay = 'zzz367-cfo-path';
    // zzz376 — carry WHY the trends are (or aren't) here so the UI can tell the
    // user "genuinely absent" vs "Screener fetch failed — transient".
    if (typeof co._trends_status === 'string') out._trends_status = co._trends_status;
  }

  // zzz366 — CRITICAL FIX (root cause of "I still don't see Other Income / Tax /
  // one-off / pledge trends"): every one of these fields is extracted ONLY by the
  // direct Screener scrape (fetchScreenerForSymbol → the zzz360/zzz363 blocks). But
  // the primary merge is `const fin = worker || nse || screener || ...`, so whenever
  // the Cloudflare Worker (indiaearninghub) returns data — the COMMON case — `fin`
  // is the worker payload and the entire `screener` object (with all these fields)
  // is discarded. The chips/Q-TRENDS/pledge therefore never had data to render.
  // The Worker payload NEVER carries any of these, so a plain fill (only when
  // out.<f> is null/undefined) is safe and can never clobber a better value.
  if (screener) {
    const sc = screener as any;
    const SCREENER_ONLY_FIELDS = [
      // zzz360 quarterly trend series + annual CFO/PAT + pledge + WC/return ratios
      'quarters_material_cost_pct', 'quarters_other_income_pct', 'quarters_tax_pct',
      'annual_cfo_pat', 'pledged_pct', 'roic', 'int_coverage',
      'debtor_days', 'inventory_days', 'wc_days',
      // zzz363 one-off / exceptional-item detection
      'exceptional_curr_cr', 'exceptional_pct_pbt',
      // zzz360 P&L-quality scalars (Screener-derived; Worker doesn't provide)
      'other_income_pct_sales_curr', 'other_income_pct_sales_prev',
      'effective_tax_rate_curr', 'effective_tax_rate_prev',
      'dep_yoy_pct', 'finance_cost_curr_cr', 'ebit_curr_cr', 'ebit_yoy_pct',
      'ebitda_curr_cr', 'ebitda_yoy_pct', 'pat_margin_curr', 'pat_margin_prev',
      // zzz356 quarterly base series + BS deltas (fill only when Worker left them null)
      'quarters_sales', 'quarters_eps', 'quarters_opm',
      'ebitda_margin_pct', 'receivables_yoy_pct', 'inventory_yoy_pct',
    ];
    for (const f of SCREENER_ONLY_FIELDS) {
      if ((out as any)[f] == null && sc[f] != null) (out as any)[f] = sc[f];
    }
    if (out._screener_overlay == null) out._screener_overlay = 'zzz366';
  }

  // PATCH 1016 — NSE Bhavcopy overlay for D1/Gap price reaction.
  // Yahoo blocks Railway IPs often → D1/Gap missing for most tickers, blocking
  // ELITE qualification. NSE archives bhavcopy is a static CSV that never
  // rejects requests and contains every NSE-listed security's OHLCV.
  // We fetch lazily, cache per-symbol for 90 days.
  // zzz235 — Fire getPriceReaction when D1/gap OR D2/move are missing. Previously
  // only fired when D1 was null → existing entries with D1 never got D2/move
  // populated, keeping the 2D chip stuck at ⏳ pending state.
  // zzz238 — Always initialize price fields + diagnostic markers so response
  // tells us why fields are missing. Distinguishes 'not attempted' vs 'attempted
  // but null return' vs 'threw exception'.
  if (out.d1_pct === undefined) out.d1_pct = null;
  if (out.gap_pct === undefined) out.gap_pct = null;
  if ((out as any).d2_pct === undefined) out.d2_pct = null;
  if ((out as any).move_pct === undefined) out.move_pct = null;
  const _needsPrice = filedHint && (
    out.d1_pct == null || out.gap_pct == null ||
    (out as any).d2_pct == null || (out as any).move_pct == null
  );
  if (!filedHint) {
    out._price_source = 'no-filed-hint';
  } else if (!_needsPrice) {
    out._price_source = 'skip-all-populated';
  } else if (_needsPrice) {
    try {
      const _t0 = Date.now();
      const { getPriceReaction } = await import('@/lib/nse-bhavcopy');
      const px = await getPriceReaction(symbol, filedHint);
      const _elapsed = Date.now() - _t0;
      out._price_elapsed_ms = _elapsed;
      out._price_reaction_d1 = px.d1_pct;
      out._price_reaction_d2 = (px as any).d2_pct;
      out._price_reaction_move = (px as any).move_pct;
      if (px.d1_pct != null) {
        if (out.d1_pct == null) out.d1_pct = px.d1_pct;
        if (out.gap_pct == null) out.gap_pct = px.gap_pct;
        if ((px as any).d2_pct != null) out.d2_pct = (px as any).d2_pct;
        if ((px as any).move_pct != null) out.move_pct = (px as any).move_pct;
        if (out.current_price == null) out.current_price = px.current_price;
        if (out.prev_close == null) out.prev_close = px.prev_close;
        out._price_source = 'nse-bhavcopy';
      } else {
        out._price_source = 'bhavcopy-returned-null';
      }
      // PATCH 1035 — Liquidity fallback. Yahoo's chart (our median-ADTV source) is
      // usually IP-blocked on Railway, so derive traded value from the NSE bhavcopy
      // we already fetched: filing-day turnover (qty × close) in ₹Cr. It's a
      // conservative thin-float proxy — earnings day is typically the heaviest
      // volume day, so if even that is thin the stock is genuinely illiquid.
      if ((out.adtv_cr == null || !Number.isFinite(out.adtv_cr)) && px.volume != null && px.volume > 0) {
        const _p = (px.current_price ?? out.current_price);
        if (_p != null && Number.isFinite(_p) && _p > 0) {
          out.adtv_cr = (px.volume * _p) / 1e7;
          out._adtv_source = 'nse-bhavcopy';
        }
      }
    } catch (e: any) {
      // zzz238 — expose the error so we can diagnose from the response
      out._price_source = 'bhavcopy-threw';
      out._price_error = String(e?.message || e).slice(0, 200);
    }
  }

  // PATCH 1005 — OPM compute fallback + sanity clamp.
  // Many tickers (EIFFL etc.) come back with opm_pct=null even when
  // operatingProfit + revenue exist in one of the sources. Compute it.
  // Then clamp to a sane range — |opm| > 100% almost certainly means the
  // parser ingested operating loss as raw value without dividing by sales.
  const _opmFrom = (op: any, rev: any): number | null => {
    if (op == null || rev == null) return null;
    const n = Number(op);
    const r = Number(rev);
    if (!Number.isFinite(n) || !Number.isFinite(r) || r <= 0) return null;
    return (n / r) * 100;
  };
  // zzz234 — treat opm_pct === 0 (with populated sales) as "unknown, refill".
  // The Cloudflare Worker (screener-worker, primary source) returns opm_pct=0
  // for NBFCs/banks because its Screener parser looks for "OPM" which those
  // sectors don't have (they use "Financing Margin %"). The prior `== null`
  // check let this 0 slip through unchanged. Symptom: LTF/INDIANB/MAHABANK
  // Q1 FY27 cards showed OPM 0.0% (+0.0pp) vs 0.0%. Only kicks in when
  // sales_curr_cr is non-trivial (≥100 Cr) — a company with real 0% OPM
  // at that scale would be genuinely unusual, and the fallback still returns
  // null if no source can compute it, so worst case is unchanged behavior.
  const _opmNeedsRefill = (opm: any, sales: any) =>
    opm == null ||
    (opm === 0 && sales != null && Number.isFinite(Number(sales)) && Number(sales) >= 100);
  if (_opmNeedsRefill(out.opm_pct, out.sales_curr_cr)) {
    // Try worker -> nse -> screener for op_profit + revenue
    const candidates = [
      [worker?.operating_profit_curr_cr ?? worker?.opCurr, worker?.sales_curr_cr ?? worker?.revenue],
      [nse?.op_profit_curr_cr,                              nse?.sales_curr_cr],
      [screener?.op_profit_curr_cr,                         screener?.sales_curr_cr],
    ];
    let refilled: number | null = null;
    for (const [op, rev] of candidates) {
      const v = _opmFrom(op, rev);
      if (v != null && v !== 0) { refilled = v; break; }
    }
    if (refilled != null) out.opm_pct = refilled;
    else if (out.opm_pct === 0) out.opm_pct = null;  // 0 stayed 0 → mark unknown so UI can render "—"
  }
  if (_opmNeedsRefill(out.opm_prev_pct, out.sales_prev_cr)) {
    const candidates = [
      [worker?.operating_profit_prev_cr ?? worker?.opPrev, worker?.sales_prev_cr],
      [nse?.op_profit_prev_cr,                              nse?.sales_prev_cr],
      [screener?.op_profit_prev_cr,                         screener?.sales_prev_cr],
    ];
    let refilled: number | null = null;
    for (const [op, rev] of candidates) {
      const v = _opmFrom(op, rev);
      if (v != null && v !== 0) { refilled = v; break; }
    }
    if (refilled != null) out.opm_prev_pct = refilled;
    else if (out.opm_prev_pct === 0) out.opm_prev_pct = null;
  }
  // Sanity clamp — anything outside reasonable margin range is a parser bug
  if (out.opm_pct != null && (out.opm_pct > 100 || out.opm_pct < -50)) {
    console.log(`[enrich] PATCH 1005: opm_pct out-of-range for ${symbol}: ${out.opm_pct} → null`);
    out.opm_pct = null;
  }
  if (out.opm_prev_pct != null && (out.opm_prev_pct > 100 || out.opm_prev_pct < -50)) {
    console.log(`[enrich] PATCH 1005: opm_prev_pct out-of-range for ${symbol}: ${out.opm_prev_pct} → null`);
    out.opm_prev_pct = null;
  }
  // zzz237 — PAT-margin ultimate fallback for NBFC/bank filings where every
  // OPM source (Worker, NSE, Screener) came up empty. This happens because
  //   1. The Cloudflare Worker parses Screener HTML looking for "OPM" — for
  //      NBFCs/banks the row is "Financing Margin %", never matched → 0/null.
  //   2. Vercel's direct Screener fetch is Cloudflare-blocked most of the time
  //      (that's the whole reason the Worker exists as a proxy).
  //   3. NSE's XBRL `re_operatingProfit` field is absent for these sectors.
  // So neither op_profit nor opm ever reaches the merge, and the card shows
  // "— screener gap" for LTF / INDIANB / MAHABANK etc. despite having full
  // sales / PAT / EPS data.
  //
  // Fallback logic: if opm_pct is still null but pat_curr_cr and sales_curr_cr
  // are both populated and positive, compute a Net Profit Margin from PAT/Sales
  // and use it as an OPM proxy. For NBFCs this is roughly the Financing Margin
  // scale (both express profit as % of revenue), so the card renders a
  // reasonable number instead of an em-dash. Same for the prior-year figure.
  // Only fires when opm is literally null (not 0) so the sanity clamp above
  // still owns the > 100 / < -50 rejection path.
  const _patMargin = (pat: any, sales: any): number | null => {
    if (pat == null || sales == null) return null;
    const p = Number(pat); const s = Number(sales);
    if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
    const v = (p / s) * 100;
    if (v > 100 || v < -50) return null;  // same sanity band as OPM
    return Math.round(v * 10) / 10;
  };
  if (out.opm_pct == null) {
    const v = _patMargin(out.pat_curr_cr, out.sales_curr_cr);
    if (v != null) {
      out.opm_pct = v;
      out._opm_source = 'pat-margin-fallback';
    }
  }
  if (out.opm_prev_pct == null) {
    const v = _patMargin(out.pat_prev_cr, out.sales_prev_cr);
    if (v != null) {
      out.opm_prev_pct = v;
      out._opm_prev_source = 'pat-margin-fallback';
    }
  }

  // PATCH 0369 — If NSE/Screener fetchers didn't give us a real company
  // name (or returned the ticker as the name), resolve via Screener.in
  // search API. Costs one extra HTTP call per missing-name symbol, only
  // on cache miss, results cached 180 days. Stamp both `company` and
  // `company_name` so consumers reading either field work.
  const currentName = String(out.company || '').trim();
  const needsName = !currentName || currentName.toUpperCase() === symbol.toUpperCase();
  if (needsName) {
    const resolved = await resolveCompanyNameFromScreenerSearch(symbol);
    if (resolved) out.company = resolved;
  }
  // Mirror onto company_name field (some consumers in earnings-scan read this).
  if (out.company) out.company_name = out.company;
  // PATCH 0194 — don't cache an empty result for the full 6h TTL.
  // If financials came back null, cache for only 5 minutes so the next
  // refresh actually re-tries the upstream sources (NSE / Screener may
  // have just propagated the data). This is the difference between
  // "data permanently missing" and "data temporarily slow" — fast-retry
  // for the latter.
  const hasFinancials = (out as any).sales_curr_cr != null ||
                        (out as any).pat_curr_cr != null ||
                        (out as any).eps_curr != null;
  // zzz369 — TREND-AWARE TTL (the fix for "some cards show trends, others don't").
  // A symbol can have financials (from the Cloudflare Worker) yet LACK the Screener
  // trend series when that symbol's Screener scrape transiently fails/returns a
  // challenge page. Caching that trend-less payload for the full 6h poisons the card
  // (no Q-TRENDS / one-off / CFO-PAT-annual) until expiry. So: full 6h ONLY when the
  // trend series actually made it in; otherwise a 30-min retry TTL so the next fetch
  // re-scrapes Screener and self-heals once it responds cleanly.
  const hasTrends = Array.isArray((out as any).quarters_tax_pct)
    || Array.isArray((out as any).quarters_opm)
    || Array.isArray((out as any).quarters_other_income_pct)
    || Array.isArray((out as any).annual_cfo_pat);
  const ttl = !hasFinancials ? 5 * 60 : (hasTrends ? ENRICH_TTL_S : 30 * 60);  // 5min / 6h / 30min-retry

  // PATCH 0404 — Last-good fallback. When the fresh fetch returns NO
  // financials (Cloudflare blocked Screener AND NSE cookie expired AND
  // both are sad), look up the most recent successful enrichment for
  // this symbol from a separate "last-good" KV slot. Serving even
  // slightly-stale numbers is dramatically better than showing all-
  // dashes "Financial detail awaiting enrichment" — the user can still
  // see this company beat / missed estimates while the upstream sources
  // recover.
  //
  // The last-good slot is keyed by SYMBOL only (no date) — overwritten
  // each time financials are successfully fetched. 30-day TTL. Restored
  // payload is stamped with _stale_from_last_good so the UI can
  // optionally show a "stale data" chip later.
  const LAST_GOOD_KEY = `enrich-last-good:v1:${symbol}`;
  if (isRedisAvailable()) {
    if (hasFinancials) {
      // Persist this successful fetch as the long-lived last-good slot.
      try { await kvSet(LAST_GOOD_KEY, out, 30 * 24 * 3600); } catch {}
    } else {
      // Fresh fetch failed → look for a last-good payload to surface.
      try {
        const lastGood: any = await kvGet(LAST_GOOD_KEY);
        if (lastGood && (lastGood.sales_curr_cr != null || lastGood.pat_curr_cr != null || lastGood.eps_curr != null)) {
          // Overlay live Yahoo price data on top of stale financials so
          // gap / D1 / current_price reflect today, not the snapshot date.
          const merged = {
            ...lastGood,
            ...(yahoo || {}),
            _stale_from_last_good: true,
            _last_good_at: lastGood._enriched_at,
            _enriched_at: new Date().toISOString(),
            company: out.company || lastGood.company,
            company_name: out.company_name || lastGood.company_name,
          };
          // Cache the merged payload under the per-date key with the 5min
          // retry TTL so a next attempt still re-tries upstream.
          try { await kvSet(cacheKey, merged, 5 * 60); } catch {}
          return merged;
        }
      } catch {}
    }
  }

  if (isRedisAvailable()) {
    try { await kvSet(cacheKey, out, ttl); } catch {}
  }
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbolsParam = searchParams.get('symbols') || '';
  // Optional cache-bust hint — when frontend knows the filing date, pass it
  // so the cache key includes it and a fresh filing automatically invalidates.
  const filedHint = searchParams.get('filed') || undefined;
  // PATCH 0160 — nocache=1 forces fresh fetch (used by partial-refresh mode)
  const bypassCache = searchParams.get('nocache') === '1';
  const symbols = symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(isValidSymbol).slice(0, 80);
  if (symbols.length === 0) {
    return NextResponse.json({ data: {}, generated_at: new Date().toISOString(), error: 'no valid symbols' });
  }
  const t0 = Date.now();
  // PATCH 0445 BUG-025 — Replace naked Promise.all with chunked allSettled +
  // circuit breaker. Previously a single slow / hanging Screener fetch could
  // poison the whole batch and the 60s Vercel limit fired, returning 0/N
  // enriched. Now:
  //   • Concurrency capped at 12 (Screener rate-limits aggressive fan-out).
  //   • Each ticker wrapped with a per-call 18s hard ceiling so one stuck
  //     fetch can't drag the batch past Vercel's 60s budget.
  //   • allSettled means one bad ticker never breaks the others.
  //   • Hard-stop at 55s — flush whatever is ready and report partial.
  const HARD_BUDGET_MS = 55_000;
  // PATCH 0463 — bumped from 18s to 24s so the outer timeout no longer fires
  // mid-Screener-fallback. Worst-case inner (with 0463-tightened SCREENER_TIMEOUT_MS)
  // is ~22s; outer at 24s leaves 2s headroom for parse+merge.
  const PER_TICKER_MS = 24_000;
  const CONCURRENCY = 12;
  const data: Record<string, any> = {};
  let ok = 0;
  let truncatedAt: number | null = null;
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => {
    return new Promise<T | null>((resolve) => {
      const tm = setTimeout(() => resolve(null), ms);
      p.then((v) => { clearTimeout(tm); resolve(v); })
       .catch(() => { clearTimeout(tm); resolve(null); });
    });
  };
  outer: for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    if (Date.now() - t0 > HARD_BUDGET_MS) { truncatedAt = i; break outer; }
    const chunk = symbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (sym): Promise<[string, any]> => {
        const enriched = await withTimeout(enrichOne(sym, filedHint, bypassCache), PER_TICKER_MS);
        return [sym, enriched];
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        const [sym, e] = r.value;
        if (sym && e) { data[sym] = e; ok++; }
      }
    }
  }
  return NextResponse.json({
    data, generated_at: new Date().toISOString(),
    requested: symbols.length, enriched: ok, ms: Date.now() - t0,
    truncated_at: truncatedAt,
  });
}
