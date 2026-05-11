// ─── Screener.in financials adapter (Tier 1 fundamentals layer) ───────────
// For each calendar event (symbol + filing_date), fetch screener.in/company/
// SYMBOL/ and parse the quarterly P&L table.  Extract:
//   - Sales (latest quarter + same quarter prior year)
//   - Operating Profit
//   - Net Profit
//   - EPS
//   - OPM %
// + static metadata: sector, PE, Market Cap, 52w high/low
//
// Polite-access pattern:
//   - One persistent Playwright context (cookies stick)
//   - 1-2s sleep between requests
//   - Skip if (symbol, filing_date) already enriched in KV (per-event cache)
//
// On any failure we return null and the event continues to be pushed
// without financials — the calendar entry still works, just without grades.

import { CanonicalEvent } from '../types.js';
import { getContext } from '../browser-pool.js';

const SCREENER_BASE = 'https://www.screener.in';
const REQUEST_DELAY_MS = 1100;

// ─── Screener page parser ──────────────────────────────────────────────────
// Runs inside Playwright's page.evaluate() to do DOM parsing client-side.
function parseScreenerPage_clientSide() {
  // This function runs in the browser context.  Extracts:
  //   - quarterly table (most recent quarter vs same quarter prior year)
  //   - top-of-page ratios (PE, market cap, current price, 52w high/low)
  //   - sector (from page header / metadata)

  const numeric = (raw: any): number | null => {
    if (raw == null) return null;
    const s = String(raw).replace(/,/g, '').replace(/[₹$]/g, '').trim();
    if (!s || s === '—' || s === '-') return null;
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  };

  // ── Top-of-page ratios ─────────────────────────────────────────────────
  const ratios: Record<string, number | null> = {};
  const ratioItems = document.querySelectorAll('#top-ratios li');
  ratioItems.forEach((li) => {
    const name = (li.querySelector('.name') as HTMLElement | null)?.innerText?.trim() || '';
    const val = (li.querySelector('.number') as HTMLElement | null)?.innerText?.trim() || '';
    if (name) ratios[name] = numeric(val);
  });

  // Sector from About / Company info
  let sector: string | null = null;
  const aboutSection = document.querySelector('#about p, .company-info');
  if (aboutSection) {
    const txt = (aboutSection as HTMLElement).innerText || '';
    const sectorMatch = txt.match(/(?:Sector|Industry)[:\s]+([\w &\-]+)/i);
    if (sectorMatch) sector = sectorMatch[1].trim();
  }
  // Fallback: BSE / NSE classification link
  if (!sector) {
    const peerLink = document.querySelector('a[href^="/company/compare/"]');
    if (peerLink) {
      const t = (peerLink as HTMLElement).innerText || '';
      if (t) sector = t.replace(/^Compare with\s+/i, '').trim();
    }
  }

  // ── Quarterly table ────────────────────────────────────────────────────
  // Screener's quarterly section: <section id="quarters"> with <table>
  const qSection = document.querySelector('#quarters');
  if (!qSection) {
    return { ratios, sector, quarterly: null };
  }
  const table = qSection.querySelector('table');
  if (!table) return { ratios, sector, quarterly: null };

  // Header row = quarter labels (e.g. "Mar 2026", "Dec 2025", ...)
  const headerCells = Array.from(table.querySelectorAll('thead th'));
  const quarterLabels: string[] = headerCells.slice(1).map((th) => (th as HTMLElement).innerText.trim());

  // Body rows: each <tr> first cell = metric name, rest = quarter values
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  const rows: Record<string, (number | null)[]> = {};
  for (const tr of bodyRows) {
    const tds = tr.querySelectorAll('td');
    if (tds.length === 0) continue;
    const label = (tds[0] as HTMLElement).innerText.trim();
    if (!label) continue;
    rows[label] = Array.from(tds).slice(1).map((td) => numeric((td as HTMLElement).innerText.trim()));
  }

  // Locate latest quarter (index 0 in screener layout — usually last column)
  // Screener typically shows oldest → newest LEFT to RIGHT.  Last column = latest.
  const N = quarterLabels.length;
  const latestIdx = N - 1;
  // Same quarter prior year = 4 quarters back
  const priorYearIdx = N - 5;
  if (latestIdx < 0 || priorYearIdx < 0) {
    return { ratios, sector, quarterly: null };
  }

  const get = (label: string, idx: number): number | null => {
    const candidates = Object.keys(rows).filter((k) => k.toLowerCase().includes(label.toLowerCase()));
    if (candidates.length === 0) return null;
    const arr = rows[candidates[0]];
    return arr?.[idx] ?? null;
  };

  const quarterly = {
    latest_quarter_label: quarterLabels[latestIdx],
    prior_year_quarter_label: quarterLabels[priorYearIdx],
    sales_curr:   get('Sales', latestIdx)       ?? get('Revenue', latestIdx)       ?? get('Income', latestIdx),
    sales_prev:   get('Sales', priorYearIdx)    ?? get('Revenue', priorYearIdx)    ?? get('Income', priorYearIdx),
    op_profit_curr: get('Operating Profit', latestIdx),
    op_profit_prev: get('Operating Profit', priorYearIdx),
    opm_curr:     get('OPM %', latestIdx),
    opm_prev:     get('OPM %', priorYearIdx),
    pat_curr:     get('Net Profit', latestIdx),
    pat_prev:     get('Net Profit', priorYearIdx),
    eps_curr:     get('EPS', latestIdx),
    eps_prev:     get('EPS', priorYearIdx),
  };

  return { ratios, sector, quarterly };
}

// ─── Market cap bucket ─────────────────────────────────────────────────────
function bucketMarketCap(mcap: number | null): 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO' | null {
  if (mcap == null) return null;
  // Screener "Market Cap" is in Crore
  if (mcap >= 200_000) return 'MEGA';
  if (mcap >=  20_000) return 'LARGE';
  if (mcap >=   5_000) return 'MID';
  if (mcap >=     500) return 'SMALL';
  return 'MICRO';
}

function pct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;  // 1 decimal
}

// ─── Public API: enrich a single canonical event ─────────────────────────
export async function fetchScreenerFinancials(symbol: string): Promise<Partial<CanonicalEvent> | null> {
  const ctx = await getContext('screener');
  const page = await ctx.newPage();
  try {
    // Try consolidated first (preferred for multi-segment companies); fall back to standalone
    const urls = [
      `${SCREENER_BASE}/company/${encodeURIComponent(symbol)}/consolidated/`,
      `${SCREENER_BASE}/company/${encodeURIComponent(symbol)}/`,
    ];
    for (const url of urls) {
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        if (!res || res.status() !== 200) continue;
        // Wait briefly for hydration
        await page.waitForSelector('#top-ratios, #quarters', { timeout: 5000 }).catch(() => {});
        const parsed = await page.evaluate(parseScreenerPage_clientSide);
        if (!parsed?.quarterly || parsed.quarterly.sales_curr == null) continue;

        const r = parsed.ratios || {};
        const q = parsed.quarterly;

        const out: Partial<CanonicalEvent> = {
          sector: parsed.sector || undefined,
          pe: r['Stock P/E'] ?? r['P/E'] ?? null,
          market_cap_cr: r['Market Cap'] ?? null,
          market_cap_bucket: bucketMarketCap(r['Market Cap'] ?? null),
          current_price: r['Current Price'] ?? null,
          high_52w: r['High'] ?? r['52w High'] ?? null,
          low_52w: r['Low'] ?? r['52w Low'] ?? null,
          // Quarterly absolutes
          sales_curr_cr: q.sales_curr,
          sales_prev_cr: q.sales_prev,
          op_profit_curr_cr: q.op_profit_curr,
          op_profit_prev_cr: q.op_profit_prev,
          opm_pct: q.opm_curr,
          opm_prev_pct: q.opm_prev,
          pat_curr_cr: q.pat_curr,
          pat_prev_cr: q.pat_prev,
          eps_curr: q.eps_curr,
          eps_prev: q.eps_prev,
          // Derived YoY
          sales_yoy_pct: pct(q.sales_curr, q.sales_prev),
          op_profit_yoy_pct: pct(q.op_profit_curr, q.op_profit_prev),
          pat_yoy_pct: pct(q.pat_curr, q.pat_prev),
          eps_yoy_pct: pct(q.eps_curr, q.eps_prev),
          // 52w high distance
          pct_from_52w_high: (r['Current Price'] != null && r['High'] != null && r['High'] > 0)
            ? Math.round(((r['Current Price'] - r['High']) / r['High']) * 1000) / 10
            : null,
          financials_source: 'screener',
          financials_scraped_at: new Date().toISOString(),
        };
        return out;
      } catch {
        // try next URL
      }
    }
    return null;
  } finally {
    await page.close();
    // Be polite
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }
}

// ─── Batch enricher with per-event KV cache ──────────────────────────────
// Calls the screener adapter for each event that doesn't already have
// financials in KV.  Once enriched, the result is stored in
// `earnings:enrichment:v1:<symbol>:<filing_date>` so the next worker
// pass doesn't refetch.
const ENRICHMENT_TTL_S = 30 * 24 * 3600;  // 30 days

export interface EnrichmentClient {
  kvGet: (key: string) => Promise<any>;
  kvSet: (key: string, value: any, ttlSeconds: number) => Promise<void>;
}

export async function enrichEvents(
  events: CanonicalEvent[],
  kv?: EnrichmentClient,
  opts?: { maxConcurrent?: number; budgetMs?: number },
): Promise<CanonicalEvent[]> {
  const budgetMs = opts?.budgetMs ?? 8 * 60_000;
  const startedAt = Date.now();
  const out: CanonicalEvent[] = [];
  // Filter to NSE-symbol events with reasonable ticker (not raw BSE numeric codes)
  const isValidSymbol = (s: string) => /^[A-Z][A-Z0-9&\-]{1,15}$/.test(s);

  // Two-pass approach for visibility:
  //   Pass 1 (fast): consult KV cache for every valid symbol, merge what we have
  //   Pass 2 (slow): fetch Screener.in for the remaining ones, up to budget
  const todo: CanonicalEvent[] = [];
  let cacheHits = 0;
  let skipped = 0;

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
    if (cached) {
      out.push({ ...ev, ...cached });
      cacheHits++;
    } else {
      todo.push(ev);
    }
  }
  console.log(`[enrich] cache hits=${cacheHits}, skipped (bad symbol)=${skipped}, queued=${todo.length}`);

  // Slow pass — fetch Screener.in with budget
  let fetched = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const ev = todo[i];
    if (Date.now() - startedAt > budgetMs) {
      console.log(`[enrich] budget exhausted at ${i}/${todo.length}, deferring remainder to next pass`);
      // Push remainder un-enriched
      for (let j = i; j < todo.length; j++) out.push(todo[j]);
      break;
    }
    try {
      const fin = await fetchScreenerFinancials(ev.symbol);
      if (fin) {
        const enriched = { ...ev, ...fin };
        out.push(enriched);
        fetched++;
        if (kv) {
          await kv.kvSet(`earnings:enrichment:v1:${ev.symbol}:${ev.filing_date}`, fin, ENRICHMENT_TTL_S).catch(() => {});
        }
        // Visible heartbeat — every 5 stocks
        if (fetched % 5 === 0) {
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          console.log(`[enrich] ${fetched}/${todo.length} fetched (${elapsed}s elapsed, last=${ev.symbol})`);
        }
      } else {
        out.push(ev);
        failed++;
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
