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
import { fetchCompanyFinancialResults } from '@/lib/nse';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SCREENER_TIMEOUT_MS = 6000;
const YAHOO_TIMEOUT_MS = 5000;
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

async function fetchScreenerForSymbol(symbol: string): Promise<any | null> {
  const urls = [
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`,
    `https://www.screener.in/company/${encodeURIComponent(symbol)}/`,
  ];
  for (const url of urls) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SCREENER_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*' },
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!/id=["']top-ratios["']/.test(html)) continue;
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
    } catch { /* try next URL */ }
    finally { clearTimeout(t); }
  }
  return null;
}

// ─── Yahoo fetcher ─────────────────────────────────────────────────────────
async function fetchYahooForSymbol(symbol: string): Promise<any | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=1y&interval=1d`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
    const opens: (number | null)[] = r.indicators?.quote?.[0]?.open || [];
    const meta = r.meta || {};
    let lastIdx = -1, lastClose: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null && Number.isFinite(closes[i] as number)) { lastIdx = i; lastClose = closes[i]!; break; }
    }
    const prevClose = lastIdx >= 1 ? closes[lastIdx - 1] : null;
    const openToday = lastIdx >= 0 ? opens[lastIdx] : null;
    const gap = (openToday != null && prevClose != null && prevClose > 0) ? ((openToday - prevClose) / prevClose) * 100 : null;
    const d1 = (lastClose != null && prevClose != null && prevClose > 0) ? ((lastClose - prevClose) / prevClose) * 100 : null;
    // MA helpers
    const sma = (window: number, idx: number): number | null => {
      if (idx < window - 1) return null;
      let s = 0, n = 0;
      for (let i = idx - window + 1; i <= idx; i++) {
        const v = closes[i];
        if (v == null) return null;
        s += v; n++;
      }
      return n > 0 ? s / n : null;
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
async function enrichOne(symbol: string, filedHint?: string, bypassCache = false): Promise<any> {
  // Cache key includes filed date so a new filing busts old cache
  const cacheKey = filedHint ? `enrich:v5:${symbol}:${filedHint}` : `enrich:v5:${symbol}`;
  if (isRedisAvailable() && !bypassCache) {
    try {
      const cached = await kvGet(cacheKey);
      if (cached) return cached;
    } catch {}
  }
  // Run all sources in parallel
  const [nse, screener, yahoo] = await Promise.all([
    fetchNseFinancials(symbol),
    fetchScreenerForSymbol(symbol),
    fetchYahooForSymbol(symbol),
  ]);
  // Merge: NSE primary, Screener fills gaps, Yahoo overlays price/RS/Stage
  const fin = nse || screener || {};
  // If NSE has financials but Screener has sector/market_cap_bucket, take from Screener
  const meta = screener ? {
    sector: screener.sector,
    market_cap_bucket: screener.market_cap_bucket,
    market_cap_cr: screener.market_cap_cr,
    pe: screener.pe,
  } : {};
  const out = {
    ...fin,
    ...meta,
    ...(yahoo || {}),
    financials_source: nse ? 'nse' : (screener ? 'screener' : null),
    _enriched_at: new Date().toISOString(),
  };
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
  const entries: Array<[string, any]> = await Promise.all(symbols.map(async (sym): Promise<[string, any]> => {
    try { return [sym, await enrichOne(sym, filedHint, bypassCache)]; }
    catch { return [sym, null]; }
  }));
  const data: Record<string, any> = {};
  let ok = 0;
  for (const [sym, e] of entries) {
    if (sym && e) { data[sym] = e; ok++; }
  }
  return NextResponse.json({
    data, generated_at: new Date().toISOString(),
    requested: symbols.length, enriched: ok, ms: Date.now() - t0,
  });
}
