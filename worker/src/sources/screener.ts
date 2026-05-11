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
function parseQuartersTable(html: string): {
  quarter_labels: string[];
  rows: Record<string, (number | null)[]>;
} | null {
  // The quarters section may have id="quarters" or be in a <section> with that id
  const sec = html.match(/<section[^>]*\bid=["']quarters["'][^>]*>([\s\S]*?)<\/section>/i);
  const block = sec ? sec[1] : html;
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
async function fetchScreenerHtml(symbol: string): Promise<string | null> {
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
      // Quick sanity check — Screener pages always have these
      if (!/id=["']top-ratios["']/.test(html)) continue;
      return html;
    } catch { /* try next */ }
    finally { clearTimeout(t); }
  }
  return null;
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

export async function fetchScreenerFinancials(symbol: string): Promise<Partial<CanonicalEvent> | null> {
  const html = await fetchScreenerHtml(symbol);
  if (!html) return null;

  const ratios = parseTopRatios(html);
  const sector = parseSector(html);
  const q = parseQuartersTable(html);
  if (!q || q.quarter_labels.length < 5) return null;

  // Resolve row labels (Screener uses fuzzy variants depending on company type)
  const get = (labelKeyword: string, idx: number): number | null => {
    const keys = Object.keys(q.rows);
    const k = keys.find((kk) => kk.toLowerCase().includes(labelKeyword.toLowerCase()));
    if (!k) return null;
    return q.rows[k]?.[idx] ?? null;
  };

  const N = q.quarter_labels.length;
  const latestIdx = N - 1;
  const priorYearIdx = N - 5;
  if (priorYearIdx < 0) return null;

  const salesCurr =
    get('Revenue', latestIdx) ??
    get('Sales', latestIdx) ??
    get('Income', latestIdx);
  const salesPrev =
    get('Revenue', priorYearIdx) ??
    get('Sales', priorYearIdx) ??
    get('Income', priorYearIdx);
  const opCurr   = get('Operating Profit', latestIdx);
  const opPrev   = get('Operating Profit', priorYearIdx);
  const opmCurr  = get('OPM', latestIdx);
  const opmPrev  = get('OPM', priorYearIdx);
  const patCurr  = get('Net Profit', latestIdx);
  const patPrev  = get('Net Profit', priorYearIdx);
  const epsCurr  = get('EPS', latestIdx);
  const epsPrev  = get('EPS', priorYearIdx);

  // Require at least one of salesYoY / patYoY / epsYoY to be derivable
  if (salesCurr == null && patCurr == null && epsCurr == null) return null;

  const cp = ratios['Current Price'];
  const hi = ratios['High'] ?? ratios['52w High'];
  return {
    sector: sector || undefined,
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
    financials_source: 'screener',
    financials_scraped_at: new Date().toISOString(),
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
  for (let i = 0; i < todo.length; i++) {
    const ev = todo[i];
    if (Date.now() - startedAt > budgetMs) {
      console.log(`[enrich] budget exhausted at ${i}/${todo.length}, deferring remainder to next pass`);
      for (let j = i; j < todo.length; j++) out.push(todo[j]);
      break;
    }
    try {
      const fin = await fetchScreenerFinancials(ev.symbol);
      if (fin) {
        out.push({ ...ev, ...fin });
        fetched++;
        if (kv) {
          await kv.kvSet(`earnings:enrichment:v1:${ev.symbol}:${ev.filing_date}`, fin, ENRICHMENT_TTL_S).catch(() => {});
        }
      } else {
        out.push(ev);
        failed++;
      }
      // Polite delay
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      // Heartbeat every 10 fetches
      if ((fetched + failed) % 10 === 0) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(`[enrich] ${fetched + failed}/${todo.length} (ok=${fetched}, fail=${failed}, ${elapsed}s, last=${ev.symbol})`);
      }
    } catch (e: any) {
      console.warn(`[enrich] ${ev.symbol} failed: ${e?.message || e}`);
      out.push(ev);
      failed++;
    }
  }
  console.log(`[enrich] DONE — fetched=${fetched}, failed=${failed}, cached=${cacheHits}, skipped=${skipped}, total=${out.length}`);
  return out;
}
