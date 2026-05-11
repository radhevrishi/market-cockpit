// ─── Screener.in financials adapter (Tier 1 fundamentals layer) ───────────
// For each calendar event (symbol + filing_date), fetch
// https://www.screener.in/company/<SYMBOL>/consolidated/ via plain fetch
// (no Playwright — Screener.in is public HTML, ~500ms per page).
//
// Parses the #quarters table and #top-ratios block via lightweight regex/
// HTML matching.  Cookies / browser sessions NOT required — confirmed via
// `curl -sI` that Screener returns 200 + full HTML for unauthenticated UA.
//
// PATCH 0138/0139: Playwright-based version was hanging silently on
// page.goto.  Plain fetch is 10× faster (~500ms vs ~5s per stock) and
// has no zero-progress failure mode — every request either returns or
// hits the 8s timeout.

import { CanonicalEvent } from '../types.js';

const SCREENER_BASE = 'https://www.screener.in';
const REQUEST_DELAY_MS = 300;   // polite gap between requests
const FETCH_TIMEOUT_MS = 8000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── HTML helpers (lightweight, dep-free) ─────────────────────────────────
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘');
}
function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function numeric(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,₹$]/g, '').trim();
  if (!s || s === '—' || s === '-' || s === 'N/A') return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// ─── #top-ratios extractor ────────────────────────────────────────────────
// Each ratio is rendered as:  <li class="flex flex-space-between"><span class="name">Market Cap</span><span class="nowrap value"><span class="number">15,06,178</span> Cr.</span></li>
function parseTopRatios(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const topRatiosMatch = html.match(/<ul[^>]*id=["']top-ratios["'][^>]*>([\s\S]*?)<\/ul>/i);
  if (!topRatiosMatch) return out;
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(topRatiosMatch[1])) !== null) {
    const li = m[1];
    const nameMatch = li.match(/class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const numMatch  = li.match(/class=["'][^"']*\bnumber\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!nameMatch || !numMatch) continue;
    const name = stripTags(nameMatch[1]).trim();
    const val  = numeric(stripTags(numMatch[1]));
    if (name) out[name] = val;
  }
  return out;
}

// ─── #quarters table extractor ────────────────────────────────────────────
// PATCH 0140: don't rely on </section> (Screener has nested sections inside
// the quarters block which broke the non-greedy match). Instead, locate the
// section opening tag and slice forward to find the first <table>...</table>.
function parseQuartersTable(html: string): {
  quarter_labels: string[];
  rows: Record<string, (number | null)[]>;
} | null {
  // Find the opening of the quarters section
  const openRe = /<section[^>]*\bid=["']quarters["'][^>]*>/i;
  const open = html.match(openRe);
  let block: string;
  if (open && open.index !== undefined) {
    // Slice from after the opening tag forward (capped to 80KB — quarters
    // tables are <10KB). Stop at the next <section id="..."> tag if found.
    const start = open.index + open[0].length;
    const tail = html.slice(start, start + 80_000);
    const nextSec = tail.search(/<section\s+[^>]*\bid=["']/i);
    block = nextSec > 0 ? tail.slice(0, nextSec) : tail;
  } else {
    block = html;
  }
  const tbl = block.match(/<table[\s\S]*?<\/table>/i);
  if (!tbl) return null;

  // Headers: <th class="text">Mar 2026</th> etc.  First th is the metric column.
  const headerRow = tbl[0].match(/<thead[\s\S]*?<\/thead>/i);
  if (!headerRow) return null;
  const ths = Array.from(headerRow[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1]));
  const quarter_labels = ths.slice(1);  // first is empty / metric column

  // Body rows
  const tbody = tbl[0].match(/<tbody[\s\S]*?<\/tbody>/i);
  const rows: Record<string, (number | null)[]> = {};
  if (!tbody) return { quarter_labels, rows };
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(tbody[0])) !== null) {
    const tr = m[0];
    const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) => stripTags(x[1]));
    if (tds.length === 0) continue;
    const label = tds[0];
    if (!label) continue;
    rows[label] = tds.slice(1).map((v) => numeric(v));
  }
  return { quarter_labels, rows };
}

// PATCH 0149: pull annual cash-flow + P&L for accrual-quality check.
// Screener's #cash-flow section has a table like:
//   <th>Mar 2022</th>  <th>Mar 2023</th>  ...  <th>Mar 2026</th>
//   <td>Cash from Operating Activity +</td><td>...</td>...
// We extract the latest "Cash from Operating" row and pair it with the
// matching year's Net Profit from #profit-loss.
function parseAnnualSection(html: string, sectionId: string): {
  labels: string[];
  rows: Record<string, (number | null)[]>;
} | null {
  const openRe = new RegExp(`<section[^>]*\\bid=["']${sectionId}["'][^>]*>`, 'i');
  const open = html.match(openRe);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  const tail = html.slice(start, start + 80_000);
  const nextSec = tail.search(/<section\s+[^>]*\bid=["']/i);
  const block = nextSec > 0 ? tail.slice(0, nextSec) : tail;
  const tblM = block.match(/<table[\s\S]*?<\/table>/i);
  if (!tblM) return null;
  const thead = tblM[0].match(/<thead[\s\S]*?<\/thead>/i);
  if (!thead) return null;
  const ths = Array.from(thead[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1]));
  const labels = ths.slice(1);
  const tbody = tblM[0].match(/<tbody[\s\S]*?<\/tbody>/i);
  const rows: Record<string, (number | null)[]> = {};
  if (!tbody) return { labels, rows };
  for (const tr of Array.from(tbody[0].matchAll(/<tr[\s\S]*?<\/tr>/gi))) {
    const tds = Array.from(tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
    if (!tds[0]) continue;
    rows[tds[0]] = tds.slice(1).map((v) => numeric(v));
  }
  return { labels, rows };
}

function extractOcfQuality(html: string): {
  ocf_annual_cr: number | null;
  pat_annual_cr: number | null;
  ocf_to_pat_ratio: number | null;
} {
  const cf = parseAnnualSection(html, 'cash-flow');
  const pl = parseAnnualSection(html, 'profit-loss');
  if (!cf || !pl) return { ocf_annual_cr: null, pat_annual_cr: null, ocf_to_pat_ratio: null };
  const findRow = (rows: Record<string, (number | null)[]>, kw: string) =>
    Object.keys(rows).find((k) => k.toLowerCase().includes(kw.toLowerCase()));
  const cfKey = findRow(cf.rows, 'Cash from Operating');
  const patKey = findRow(pl.rows, 'Net Profit') || findRow(pl.rows, 'Profit');
  if (!cfKey || !patKey) return { ocf_annual_cr: null, pat_annual_cr: null, ocf_to_pat_ratio: null };
  // Latest annual column (last column in both)
  const cfRow = cf.rows[cfKey];
  const plRow = pl.rows[patKey];
  // Use last column where both have a value
  let ocf: number | null = null, pat: number | null = null;
  for (let i = Math.min(cfRow.length, plRow.length) - 1; i >= 0; i--) {
    const c = cfRow[i], p = plRow[i];
    if (c != null && p != null) { ocf = c; pat = p; break; }
  }
  const ratio = (ocf != null && pat != null && pat !== 0) ? ocf / pat : null;
  return { ocf_annual_cr: ocf, pat_annual_cr: pat, ocf_to_pat_ratio: ratio };
}

// ─── Sector extractor (best-effort) ───────────────────────────────────────
function parseSector(html: string): string | null {
  // Screener page header has: <a href="/company/compare/...">Compare with FII / DII</a> etc.
  // The peer comparison link includes the industry.  Also see #peers section heading.
  const peer = html.match(/<a[^>]*href=["']\/company\/compare\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  if (peer) {
    const txt = stripTags(peer[1]).replace(/^Compare with\s+/i, '').trim();
    if (txt && txt.length < 60) return txt;
  }
  // Fallback: meta description sector pattern
  const meta = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (meta) {
    const m = meta[1].match(/(?:sector|industry)\s+(?:is|of)\s+([\w &\-]+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

// ─── Public API: enrich a single canonical event ─────────────────────────
// PATCH 0141: return the FIRST URL that not only has top-ratios but whose
// quarterly results table actually has columns. Many companies (TVSELECT,
// KREBSBIO, AMAGI etc.) only file standalone numbers; the /consolidated/
// page exists but its quarters table is empty.
async function* iterScreenerHtml(symbol: string): AsyncGenerator<string> {
  const urls = [
    `${SCREENER_BASE}/company/${encodeURIComponent(symbol)}/consolidated/`,
    `${SCREENER_BASE}/company/${encodeURIComponent(symbol)}/`,
  ];
  for (const url of urls) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*' },
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!/id=["']top-ratios["']/.test(html)) continue;
      yield html;
    } catch { /* try next */ }
    finally { clearTimeout(t); }
  }
}

function bucketMarketCap(mcap: number | null): 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO' | null {
  if (mcap == null) return null;
  if (mcap >= 200_000) return 'MEGA';
  if (mcap >=  20_000) return 'LARGE';
  if (mcap >=   5_000) return 'MID';
  if (mcap >=     500) return 'SMALL';
  return 'MICRO';
}

function pct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
}

// PATCH 0140: structured outcome so we can see WHICH step fails per symbol
export type EnrichOutcome =
  | { ok: true; data: Partial<CanonicalEvent> }
  | { ok: false; reason: 'no-html' | 'no-quarters' | 'too-few-quarters' | 'no-rows' };

export async function fetchScreenerFinancials(symbol: string): Promise<EnrichOutcome> {
  // PATCH 0141: iterate consolidated → standalone and pick the variant whose
  // quarters table actually has columns. Companies that only file standalone
  // results (e.g. TVSELECT, KREBSBIO) have an empty quarterly table on the
  // /consolidated/ page even though id="quarters" is present.
  let html: string | null = null;
  let q: ReturnType<typeof parseQuartersTable> = null;
  let firstFailReason: 'no-quarters' | 'too-few-quarters' | null = null;
  for await (const candidate of iterScreenerHtml(symbol)) {
    const parsed = parseQuartersTable(candidate);
    if (!parsed) {
      if (!firstFailReason) firstFailReason = 'no-quarters';
      continue;
    }
    if (parsed.quarter_labels.length < 5) {
      if (!firstFailReason) firstFailReason = 'too-few-quarters';
      continue;
    }
    html = candidate;
    q = parsed;
    break;
  }
  if (!html) {
    // Either we got no HTML at all (no top-ratios on either URL) or both
    // variants had unusable quarters tables. Use the more specific reason.
    return { ok: false, reason: firstFailReason ?? 'no-html' };
  }
  if (!q) return { ok: false, reason: 'no-quarters' };
  const qNN = q;  // capture for closure narrowing

  const ratios = parseTopRatios(html);
  const sector = parseSector(html);

  // Resolve row labels (Screener uses fuzzy variants depending on company type)
  const get = (labelKeyword: string, idx: number): number | null => {
    const keys = Object.keys(qNN.rows);
    const k = keys.find((kk) => kk.toLowerCase().includes(labelKeyword.toLowerCase()));
    if (!k) return null;
    return qNN.rows[k]?.[idx] ?? null;
  };

  const N = qNN.quarter_labels.length;
  const latestIdx = N - 1;
  const priorYearIdx = N - 5;

  // Top-line: Sales / Revenue / Income / Interest Earned (banks) / Premium Earned (insurers)
  const salesCurr =
    get('Sales', latestIdx) ??
    get('Revenue', latestIdx) ??
    get('Income', latestIdx) ??
    get('Interest', latestIdx) ??
    get('Premium', latestIdx);
  const salesPrev =
    get('Sales', priorYearIdx) ??
    get('Revenue', priorYearIdx) ??
    get('Income', priorYearIdx) ??
    get('Interest', priorYearIdx) ??
    get('Premium', priorYearIdx);
  const opCurr   = get('Operating Profit', latestIdx);
  const opPrev   = get('Operating Profit', priorYearIdx);
  const opmCurr  = get('OPM', latestIdx);
  const opmPrev  = get('OPM', priorYearIdx);
  // Bottom-line: Net Profit / Profit (banks: "Profit" or "PAT")
  const patCurr  = get('Net Profit', latestIdx) ?? get('Profit', latestIdx);
  const patPrev  = get('Net Profit', priorYearIdx) ?? get('Profit', priorYearIdx);
  const epsCurr  = get('EPS', latestIdx);
  const epsPrev  = get('EPS', priorYearIdx);

  // Require at least one of salesCurr / patCurr / epsCurr to be derivable
  if (salesCurr == null && patCurr == null && epsCurr == null) {
    return { ok: false, reason: 'no-rows' };
  }

  const cp = ratios['Current Price'];
  const hi = ratios['High'] ?? ratios['52w High'];

  // PATCH 0149: pull OCF + annual PAT for accrual-quality check
  const ocfQuality = extractOcfQuality(html);

  // PATCH 0145: capture Screener's latest quarter label + period-end date.
  // Used downstream to detect "scheduled but not yet filed" companies whose
  // Trendlyne calendar entry promised Q4FY26 (Mar 2026) but whose Screener
  // page still shows Q3FY26 (Dec 2025) as latest — they haven't reported.
  const latestLabel = qNN.quarter_labels[latestIdx];   // e.g. "Mar 2026"
  let latestEndIso: string | undefined;
  if (latestLabel) {
    const lm = latestLabel.match(/([A-Za-z]{3,9})\s+(\d{4})/);
    if (lm) {
      const monthMap: Record<string, number> = {
        JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
        JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
      };
      const mm = monthMap[lm[1].toUpperCase().slice(0, 3)];
      if (mm) {
        // Last day of that month
        const yr = Number(lm[2]);
        const last = new Date(Date.UTC(yr, mm, 0));   // mm here is 1-indexed → trick gives last day
        latestEndIso = last.toISOString().slice(0, 10);
      }
    }
  }

  return {
    ok: true,
    data: {
      sector: sector || undefined,
      latest_quarter_label: latestLabel || undefined,
      latest_quarter_end_iso: latestEndIso,
      pe: ratios['Stock P/E'] ?? ratios['P/E'] ?? null,
      market_cap_cr: ratios['Market Cap'] ?? null,
      market_cap_bucket: bucketMarketCap(ratios['Market Cap'] ?? null),
      current_price: cp ?? null,
      high_52w: hi ?? null,
      low_52w: ratios['Low'] ?? ratios['52w Low'] ?? null,
      pct_from_52w_high: (cp != null && hi != null && hi > 0)
        ? Math.round(((cp - hi) / hi) * 1000) / 10
        : null,
      sales_curr_cr: salesCurr,
      sales_prev_cr: salesPrev,
      op_profit_curr_cr: opCurr,
      op_profit_prev_cr: opPrev,
      opm_pct: opmCurr,
      opm_prev_pct: opmPrev,
      pat_curr_cr: patCurr,
      pat_prev_cr: patPrev,
      eps_curr: epsCurr,
      eps_prev: epsPrev,
      sales_yoy_pct: pct(salesCurr, salesPrev),
      op_profit_yoy_pct: pct(opCurr, opPrev),
      pat_yoy_pct: pct(patCurr, patPrev),
      eps_yoy_pct: pct(epsCurr, epsPrev),
      // PATCH 0149 — annual OCF + PAT for accrual quality
      ocf_annual_cr: ocfQuality.ocf_annual_cr,
      pat_annual_cr: ocfQuality.pat_annual_cr,
      ocf_to_pat_ratio: ocfQuality.ocf_to_pat_ratio,
      financials_source: 'screener',
      financials_scraped_at: new Date().toISOString(),
    },
  };
}

// ─── Batch enricher with per-event KV cache ──────────────────────────────
const ENRICHMENT_TTL_S = 30 * 24 * 3600;

export interface EnrichmentClient {
  kvGet: (key: string) => Promise<any>;
  kvSet: (key: string, value: any, ttlSeconds: number) => Promise<void>;
}

export async function enrichEvents(
  events: CanonicalEvent[],
  kv?: EnrichmentClient,
  opts?: { maxConcurrent?: number; budgetMs?: number },
): Promise<CanonicalEvent[]> {
  const budgetMs = opts?.budgetMs ?? 12 * 60_000;
  const startedAt = Date.now();
  const out: CanonicalEvent[] = [];
  const isValidSymbol = (s: string) => /^[A-Z][A-Z0-9&\-]{1,15}$/.test(s);

  const todo: CanonicalEvent[] = [];
  let cacheHits = 0, skipped = 0;
  for (const ev of events) {
    if (!isValidSymbol(ev.symbol)) { out.push(ev); skipped++; continue; }
    const cacheKey = `earnings:enrichment:v1:${ev.symbol}:${ev.filing_date}`;
    let cached: Partial<CanonicalEvent> | null = null;
    if (kv) {
      try {
        const got = await kv.kvGet(cacheKey);
        if (got) cached = typeof got === 'string' ? JSON.parse(got) : got;
      } catch {}
    }
    if (cached) { out.push({ ...ev, ...cached }); cacheHits++; }
    else { todo.push(ev); }
  }
  console.log(`[enrich] cache hits=${cacheHits}, skipped (bad symbol)=${skipped}, queued=${todo.length}`);

  let fetched = 0, failed = 0;
  // PATCH 0140: track failure reasons + sample failing symbols
  const failReasons: Record<string, number> = {};
  const failSamples: Record<string, string[]> = {};
  const recordFail = (reason: string, sym: string) => {
    failReasons[reason] = (failReasons[reason] || 0) + 1;
    if (!failSamples[reason]) failSamples[reason] = [];
    if (failSamples[reason].length < 5) failSamples[reason].push(sym);
  };

  for (let i = 0; i < todo.length; i++) {
    const ev = todo[i];
    if (Date.now() - startedAt > budgetMs) {
      console.log(`[enrich] budget exhausted at ${i}/${todo.length}, deferring remainder to next pass`);
      for (let j = i; j < todo.length; j++) out.push(todo[j]);
      break;
    }
    try {
      const result = await fetchScreenerFinancials(ev.symbol);
      if (result.ok) {
        out.push({ ...ev, ...result.data });
        fetched++;
        if (kv) {
          await kv.kvSet(`earnings:enrichment:v1:${ev.symbol}:${ev.filing_date}`, result.data, ENRICHMENT_TTL_S).catch(() => {});
        }
      } else {
        out.push(ev);
        failed++;
        recordFail(result.reason, ev.symbol);
      }
      // Polite delay
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      // Heartbeat every 10 fetches
      if ((fetched + failed) % 10 === 0) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(`[enrich] ${fetched + failed}/${todo.length} (ok=${fetched}, fail=${failed}, ${elapsed}s, last=${ev.symbol})`);
      }
    } catch (e: any) {
      console.warn(`[enrich] ${ev.symbol} threw: ${e?.message || e}`);
      out.push(ev);
      failed++;
      recordFail('exception', ev.symbol);
    }
  }
  console.log(`[enrich] DONE — fetched=${fetched}, failed=${failed}, cached=${cacheHits}, skipped=${skipped}, total=${out.length}`);
  if (failed > 0) {
    console.log(`[enrich] failure breakdown:`);
    for (const [reason, count] of Object.entries(failReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}  (e.g. ${failSamples[reason].join(', ')})`);
    }
  }
  return out;
}
