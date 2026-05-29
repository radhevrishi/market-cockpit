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
    if (!nameM || !numM) continue;
    out[stripTags(nameM[1]).trim()] = num(stripTags(numM[1]));
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
    const opCurr = get('Operating Profit', latestIdx);
    const opPrev = get('Operating Profit', priorIdx);
    const opmCurr = get('OPM', latestIdx);
    const opmPrev = get('OPM', priorIdx);
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
    return {
      current_price: lastClose, prev_close: prevClose,
      gap_pct: gap, d1_pct: d1,
      high_52w: hi52, low_52w: meta.fiftyTwoWeekLow ?? null,
      pct_from_52w_high: pctFromHi,
      ma_50: ma50, ma_150: ma150, ma_200: ma200, ma_200_slope_30d: ma200_slope,
      return_12w_pct: ret12w,
      stage, trend_template_passes: trendTemplate,
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
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=incomeStatementHistoryQuarterly,price,summaryDetail`;
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
  const cacheKey = filedHint ? `enrich:v6:${symbol}:${filedHint}` : `enrich:v6:${symbol}`;
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
  const tryVariant = async (sym: string, filedHint?: string) => {  // PATCH 0986
    const [worker, nse, screener, yahoo, yahooFund] = await Promise.all([
      fetchWorkerStock(sym),
      fetchNseFinancials(sym),
      fetchScreenerForSymbol(sym),
      fetchYahooForSymbol(sym, filedHint),  // PATCH 0986
      fetchYahooFundamentals(sym),
    ]);
    const anyHit = worker || nse || screener || yahoo || yahooFund;
    return { sym, worker, nse, screener, yahoo, yahooFund, anyHit };
  };

  // Run all variants in parallel; keep the first variant that actually
  // produced ANY data. Variant order matters: original first, then
  // sanitized forms.
  let worker: any = null, nse: any = null, screener: any = null, yahoo: any = null, yahooFund: any = null;
  if (symVariants.length === 1) {
    // Fast path — no special chars in symbol, no variant fan-out needed
    const r = await tryVariant(symbol, filedHint);  // PATCH 0986
    worker = r.worker; nse = r.nse; screener = r.screener; yahoo = r.yahoo; yahooFund = r.yahooFund;
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
    worker = best.worker; nse = best.nse; screener = best.screener; yahoo = best.yahoo; yahooFund = best.yahooFund;
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

  // PATCH 1016 — NSE Bhavcopy overlay for D1/Gap price reaction.
  // Yahoo blocks Railway IPs often → D1/Gap missing for most tickers, blocking
  // ELITE qualification. NSE archives bhavcopy is a static CSV that never
  // rejects requests and contains every NSE-listed security's OHLCV.
  // We fetch lazily, cache per-symbol for 90 days.
  if (filedHint && (out.d1_pct == null || out.gap_pct == null)) {
    try {
      const { getPriceReaction } = await import('@/lib/nse-bhavcopy');
      const px = await getPriceReaction(symbol, filedHint);
      if (px.d1_pct != null) {
        out.d1_pct = px.d1_pct;
        out.gap_pct = px.gap_pct;
        if (out.current_price == null) out.current_price = px.current_price;
        if (out.prev_close == null) out.prev_close = px.prev_close;
        out._price_source = 'nse-bhavcopy';
      }
    } catch (e) {
      // Non-fatal — Yahoo fallback may still have populated d1/gap above
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
  if (out.opm_pct == null) {
    // Try worker -> nse -> screener for op_profit + revenue
    const candidates = [
      [worker?.operating_profit_curr_cr ?? worker?.opCurr, worker?.sales_curr_cr ?? worker?.revenue],
      [nse?.op_profit_curr_cr,                              nse?.sales_curr_cr],
      [screener?.op_profit_curr_cr,                         screener?.sales_curr_cr],
    ];
    for (const [op, rev] of candidates) {
      const v = _opmFrom(op, rev);
      if (v != null) { out.opm_pct = v; break; }
    }
  }
  if (out.opm_prev_pct == null) {
    const candidates = [
      [worker?.operating_profit_prev_cr ?? worker?.opPrev, worker?.sales_prev_cr],
      [nse?.op_profit_prev_cr,                              nse?.sales_prev_cr],
      [screener?.op_profit_prev_cr,                         screener?.sales_prev_cr],
    ];
    for (const [op, rev] of candidates) {
      const v = _opmFrom(op, rev);
      if (v != null) { out.opm_prev_pct = v; break; }
    }
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
  const ttl = hasFinancials ? ENRICH_TTL_S : 5 * 60;  // 6h vs 5min

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
