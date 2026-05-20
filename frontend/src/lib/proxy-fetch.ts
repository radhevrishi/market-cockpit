// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0518 / 0519 — Proxy-fetch helper + Worker financials adapter.
//
// User has a Cloudflare Worker already running at
// https://indiaearninghub.radhev-232.workers.dev that pre-extracts Screener
// ratios + quarterly tables. Two helpers:
//
//   1. proxiedFetch(url, init)  — raw proxy through generic /proxy endpoint
//      (currently unused since the deployed Worker exposes a richer API)
//
//   2. fetchWorkerStock(symbol) — calls /stock?symbol=X on the Worker and
//      returns pre-parsed financials. Use this as a primary enrich source
//      for Indian symbols — fast (1 hop, no HTML parse), Cloudflare-immune.
//
// CONFIG via env:
//   SCREENER_WORKER_URL — defaults to https://indiaearninghub.radhev-232.workers.dev
//                         set in Vercel env to override.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_WORKER_URL = 'https://indiaearninghub.radhev-232.workers.dev';

/**
 * Pre-parsed financials from the Cloudflare Worker. Maps the Worker's
 * /stock response into our internal financial-data shape so it slots
 * into the existing enrich merge logic.
 */
export interface WorkerStockData {
  symbol: string;
  company?: string;
  sector?: string;
  marketCapCr?: number;
  currentPrice?: number;
  bookValue?: number;
  stockPE?: number;
  dividendYield?: number;
  roce?: number;
  roe?: number;
  faceValue?: number;
  debtToEquity?: number | null;
  // Internal-shape financials (computed from Worker's latest/yoy/qoq)
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  sales_yoy_pct: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  pat_yoy_pct: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  eps_yoy_pct: number | null;
  opm_pct: number | null;
  opm_prev_pct: number | null;
  op_profit_yoy_pct: number | null;
  period_ended?: string;
  latest_quarter_end_iso?: string;
  pe?: number | null;
  market_cap_cr?: number;
  financials_source: 'screener-worker';
}

function workerUrl(): string {
  return (process.env.SCREENER_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, '');
}

function monthEndIso(periodLabel: string): string | undefined {
  // "Mar 2026" → "2026-03-31"
  const m = String(periodLabel || '').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
  if (!m) return undefined;
  const months: Record<string, number> = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const monthIdx = months[m[1].toUpperCase().slice(0, 3)];
  const year = parseInt(m[2], 10);
  // Last day of that month
  const d = new Date(Date.UTC(year, monthIdx + 1, 0));
  return d.toISOString().slice(0, 10);
}

function yoyPct(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/**
 * Fetch a single ticker's pre-extracted financials from the Cloudflare
 * Worker. Returns null if Worker unreachable, ticker not found, or response
 * shape unexpected.
 */
export async function fetchWorkerStock(symbol: string, timeoutMs = 10000): Promise<WorkerStockData | null> {
  const url = `${workerUrl()}/stock?symbol=${encodeURIComponent(symbol)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j || !j.symbol || !j.latest) return null;
    const latest = j.latest;
    const yoy = j.yoy || {};
    const period = String(latest?.date || '');
    return {
      symbol: j.symbol,
      company: j.name,
      sector: j.sector || undefined,
      marketCapCr: j.marketCapCr,
      currentPrice: j.currentPrice,
      bookValue: j.bookValue,
      stockPE: j.stockPE,
      dividendYield: j.dividendYield,
      roce: j.roce,
      roe: j.roe,
      faceValue: j.faceValue,
      debtToEquity: j.debtToEquity,
      // Map quarters → internal field names + crores normalization
      sales_curr_cr: latest.revenue ?? null,
      sales_prev_cr: yoy.revenue ?? null,
      sales_yoy_pct: yoyPct(latest.revenue, yoy.revenue),
      pat_curr_cr: latest.netProfit ?? null,
      pat_prev_cr: yoy.netProfit ?? null,
      pat_yoy_pct: yoyPct(latest.netProfit, yoy.netProfit),
      eps_curr: latest.eps ?? null,
      eps_prev: yoy.eps ?? null,
      eps_yoy_pct: yoyPct(latest.eps, yoy.eps),
      opm_pct: latest.opm ?? null,
      opm_prev_pct: yoy.opm ?? null,
      op_profit_yoy_pct: yoyPct(latest.operatingProfit, yoy.operatingProfit),
      period_ended: period,
      latest_quarter_end_iso: monthEndIso(period),
      pe: j.stockPE ?? null,
      market_cap_cr: j.marketCapCr,
      financials_source: 'screener-worker',
    };
  } catch {
    clearTimeout(t);
    return null;
  }
}

const PROXIED_HOSTS = [
  'www.screener.in',
  'screener.in',
  'www.nseindia.com',
  'nseindia.com',
  'www.bseindia.com',
  'bseindia.com',
  'api.bseindia.com',
  'trendlyne.com',
  'www.trendlyne.com',
];

function shouldProxy(targetUrl: string): boolean {
  const proxyUrl = process.env.PROXY_URL;
  const proxySecret = process.env.PROXY_SECRET;
  if (!proxyUrl || !proxySecret) return false;
  try {
    const u = new URL(targetUrl);
    return PROXIED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function buildProxyUrl(targetUrl: string): string {
  const proxyUrl = process.env.PROXY_URL!;
  const proxySecret = process.env.PROXY_SECRET!;
  const base = proxyUrl.replace(/\/$/, '');
  return `${base}/proxy?url=${encodeURIComponent(targetUrl)}&secret=${encodeURIComponent(proxySecret)}`;
}

/**
 * Fetch wrapper that routes through Cloudflare Worker proxy for blocked hosts.
 * Drop-in replacement for the global fetch() — same signature.
 *
 * If proxy env vars are unset, OR target host is not in PROXIED_HOSTS,
 * passes through to direct fetch unchanged.
 */
export async function proxiedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const targetUrl = typeof input === 'string' ? input :
                    input instanceof URL ? input.toString() :
                    input.url;

  if (!shouldProxy(targetUrl)) {
    return fetch(input, init);
  }

  const proxyUrl = buildProxyUrl(targetUrl);
  return fetch(proxyUrl, init);
}

/**
 * Returns true if proxy env vars are configured. Useful for logging /
 * status pages so the operator can verify proxy is active.
 */
export function isProxyConfigured(): boolean {
  return !!(process.env.PROXY_URL && process.env.PROXY_SECRET);
}
