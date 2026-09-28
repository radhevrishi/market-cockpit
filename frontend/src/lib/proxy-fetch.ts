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

// ═══════════════════════════════════════════════════════════════════════════
// zzz423 — GLOBAL UPSTREAM CONCURRENCY GATE + RETRY/BACKOFF.
//
// Enrichment used to fan out ~40 symbols × 7 sources at once during a rebuild
// (~300-600 concurrent upstream fetches). That burst overwhelmed the Cloudflare
// worker + Screener proxy, so many calls timed out and returned null — the
// stubborn "N missing" tail on heavy days. Two durable fixes, applied at the
// single choke point every upstream fetch passes through:
//
//   • A process-wide semaphore caps concurrent upstream requests, so the server
//     self-paces under the limit no matter how big the fan-out. Railway runs a
//     single Node instance so an in-memory gate governs the whole app.
//   • gatedRetryFetch retries 429/5xx/timeout with jittered exponential backoff,
//     so a transient failure during load self-heals instead of nulling a ticker.
//
// Tunable via env UPSTREAM_CONCURRENCY (default 24).
// ═══════════════════════════════════════════════════════════════════════════
const MAX_UPSTREAM = Number(process.env.UPSTREAM_CONCURRENCY) || 24;
let _active = 0;
const _waiters: Array<() => void> = [];
function _acquire(): Promise<void> {
  if (_active < MAX_UPSTREAM) { _active++; return Promise.resolve(); }
  return new Promise<void>((resolve) => _waiters.push(resolve));
}
function _release(): void {
  _active = Math.max(0, _active - 1);
  const next = _waiters.shift();
  if (next) { _active++; next(); }
}
/** Run fn while holding an upstream concurrency slot (always released). */
export async function gate<T>(fn: () => Promise<T>): Promise<T> {
  await _acquire();
  try { return await fn(); } finally { _release(); }
}
const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Gated fetch with retry+backoff on 429/5xx/timeout. Each attempt gets a
 *  fresh AbortController so a per-attempt timeout can't wedge the retry. */
export async function gatedRetryFetch(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { headers, timeoutMs = 10000, retries = 2 } = opts;
  return gate(async () => {
    let lastErr: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers });
        clearTimeout(tm);
        if ((res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) && attempt < retries) {
          await _sleep(400 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
          continue;
        }
        return res;
      } catch (e) {
        clearTimeout(tm);
        lastErr = e;
        if (attempt < retries) await _sleep(400 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
      }
    }
    throw lastErr;
  });
}

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
  // zzz324 — CFO/PAT from Worker (annual, computed inside indiaearninghub worker after CFO patch is deployed there)
  ocf_annual_cr?: number | null;
  pat_annual_cr?: number | null;
  ocf_to_pat_ratio?: number | null;
  // zzz377 — quarterly trend series lifted from the Worker's `quarters` object.
  // The Worker is Cloudflare-immune and reliable; the direct Screener HTML scrape
  // (fetchScreenerCFO) is blocked from Railway's datacenter IP for ~85% of symbols,
  // so these Worker-sourced arrays are what actually populate Q-TRENDS in prod.
  quarters_opm?: (number | null)[] | null;
  quarters_sales?: (number | null)[] | null;
  quarters_eps?: (number | null)[] | null;
  quarters_pat?: (number | null)[] | null;   // zzz820
  quarters_dates?: string[] | null;          // zzz820 — "Jun 2026" per column
  quarters_tax_pct?: (number | null)[] | null;
  quarters_other_income_pct?: (number | null)[] | null;
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
 *
 * PATCH 0520 — sends optional X-MC-Token header when WORKER_TOKEN env is
 * set. Worker accepts requests with no token (back-compat) or rejects
 * when its own SHARED_TOKEN env is set and token mismatches. Safe to
 * enable on either side independently.
 */
export async function fetchWorkerStock(symbol: string, timeoutMs = 10000): Promise<WorkerStockData | null> {
  const url = `${workerUrl()}/stock?symbol=${encodeURIComponent(symbol)}`;
  const headers: Record<string, string> = {};
  const token = process.env.WORKER_TOKEN;
  if (token) headers['X-MC-Token'] = token;
  try {
    // zzz423 — gated + retried. The worker is the reliable, Cloudflare-immune
    // source; a single burst-timeout used to null a ticker permanently.
    const res = await gatedRetryFetch(url, { headers, timeoutMs, retries: 2 });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j || !j.symbol || !j.latest) return null;
    const latest = j.latest;
    const yoy = j.yoy || {};
    const period = String(latest?.date || '');
    // PATCH 0996 — Worker bug: for some companies (e.g. GAUDIUMIVF) the yoy
    // field returns the WRONG quarter — Dec 2024 instead of Mar 2025 for a
    // Mar 2026 latest. This produces inflated YoY % (110%+ Sales / PAT).
    // Validate yoy.date matches latest.date month with year - 1. If mismatch,
    // null-out yoy fields so downstream fallback (Screener direct / Yahoo
    // fundamentals) takes over rather than us shipping wrong data.
    const yoyMisaligned = (() => {
      const lat = String(latest?.date || '').trim();
      const yPer = String(yoy?.date || '').trim();
      if (!lat || !yPer) return false;
      const latM = lat.match(/^([A-Za-z]{3})\s+(\d{4})$/);
      const yM = yPer.match(/^([A-Za-z]{3})\s+(\d{4})$/);
      if (!latM || !yM) return true;  // unknown format → treat as misaligned
      return latM[1].toLowerCase() !== yM[1].toLowerCase()
          || (parseInt(latM[2], 10) - parseInt(yM[2], 10)) !== 1;
    })();
    if (yoyMisaligned) {
      // eslint-disable-next-line no-console
      console.log(`[worker] PATCH 0996: yoy date misaligned for ${j.symbol}: latest=${latest?.date} yoy=${yoy?.date} — re-reading the year-ago column by date (zzz820)`);
    }
    // zzz820 — the Worker picks its year-ago column POSITIONALLY (4 back), so
    // on a gappy table (half-yearly SME filer: Mar 25, Jun 25, Dec 25, Mar 26,
    // Jun 26) it hands back Mar 2025 for a Jun 2026 quarter. Nulling it (0996)
    // left a downstream positional fallback to repeat the same mistake. The
    // exact year-ago column is usually in the Worker's own quarters table, so
    // look it up BY DATE; only when it is genuinely absent is the year-ago
    // block empty.
    const monthMatchedYoy = (() => {
      if (!yoyMisaligned) return null;
      const q = j.quarters;
      const dates: any[] = Array.isArray(q?.dates) ? q.dates : [];
      const lm = String(latest?.date || '').trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
      if (!lm || dates.length === 0) return null;
      const want = `${lm[1]} ${parseInt(lm[2], 10) - 1}`.toLowerCase();
      const i = dates.findIndex((d) => String(d || '').trim().toLowerCase() === want);
      if (i < 0) return null;
      const at = (a: any) => (Array.isArray(a) && typeof a[i] === 'number' && Number.isFinite(a[i]) ? a[i] : null);
      // Same statement basis check: the latest column must be the last column.
      if (String(dates[dates.length - 1] || '').trim().toLowerCase() !== String(latest?.date || '').trim().toLowerCase()) return null;
      return {
        date: dates[i],
        revenue: at(q.sales), netProfit: at(q.netProfit), eps: at(q.eps),
        opm: at(q.opm), operatingProfit: at(q.operatingProfit),
      };
    })();
    const safeYoy = yoyMisaligned ? (monthMatchedYoy || {} as any) : yoy;
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
      sales_prev_cr: safeYoy.revenue ?? null,
      sales_yoy_pct: yoyPct(latest.revenue, safeYoy.revenue),
      pat_curr_cr: latest.netProfit ?? null,
      pat_prev_cr: safeYoy.netProfit ?? null,
      pat_yoy_pct: yoyPct(latest.netProfit, safeYoy.netProfit),
      eps_curr: latest.eps ?? null,
      eps_prev: safeYoy.eps ?? null,
      eps_yoy_pct: yoyPct(latest.eps, safeYoy.eps),
      // PATCH 1012 — when worker's opm field is null but operatingProfit + revenue
      // both exist, compute it: OPM = (op / revenue) * 100. This catches the
      // ~30% of tickers where the worker has op/revenue but the opm field is empty.
      // Same fallback for prior year. EBITDA-margin equivalent for these stocks.
      opm_pct: (latest.opm ?? null) ??
        (latest.operatingProfit != null && latest.revenue != null && latest.revenue > 0
          ? (latest.operatingProfit / latest.revenue) * 100
          : null),
      opm_prev_pct: (safeYoy.opm ?? null) ??
        (safeYoy.operatingProfit != null && safeYoy.revenue != null && safeYoy.revenue > 0
          ? (safeYoy.operatingProfit / safeYoy.revenue) * 100
          : null),
      op_profit_yoy_pct: yoyPct(latest.operatingProfit, safeYoy.operatingProfit),
      period_ended: period,
      latest_quarter_end_iso: monthEndIso(period),
      pe: j.stockPE ?? null,
      market_cap_cr: j.marketCapCr,
      // zzz324 — pass CFO fields through if the worker returned them
      ocf_annual_cr: (typeof j.ocf_annual_cr === 'number' ? j.ocf_annual_cr : null),
      pat_annual_cr: (typeof j.pat_annual_cr === 'number' ? j.pat_annual_cr : null),
      ocf_to_pat_ratio: (typeof j.ocf_to_pat_ratio === 'number' ? j.ocf_to_pat_ratio : null),
      // zzz377 — quarterly trend series straight from the Worker's `quarters` object.
      // q.tax is already the tax-RATE % (netProfit ≈ PBT·(1−tax/100) checks out).
      // Other-income is normalised to % of sales to match the existing pill semantics.
      ...(() => {
        const q = j.quarters;
        if (!q || typeof q !== 'object') return {};
        const numArr = (a: any): (number | null)[] | null =>
          Array.isArray(a) ? a.map((x: any) => (typeof x === 'number' && Number.isFinite(x)) ? x : null) : null;
        const opm = numArr(q.opm);
        const sales = numArr(q.sales);
        const eps = numArr(q.eps);
        const pat = numArr(q.netProfit);   // zzz820
        const dates = Array.isArray(q.dates) ? q.dates.map((d: any) => String(d || '').trim()) : null;
        const tax = numArr(q.tax);
        const oiRaw = numArr(q.otherIncome);
        const oiPct = (oiRaw && sales)
          ? oiRaw.map((oi, i) => { const s = sales[i]; return (oi != null && s != null && s !== 0) ? Math.round((oi / s) * 1000) / 10 : null; })
          : null;
        const hasAny = (a: (number | null)[] | null) => !!a && a.some((x) => x != null);
        return {
          ...(hasAny(opm) ? { quarters_opm: opm } : {}),
          ...(hasAny(sales) ? { quarters_sales: sales } : {}),
          ...(hasAny(eps) ? { quarters_eps: eps } : {}),
          // zzz820 — the column dates travel with the series so any YoY taken
          // from them can be matched by DATE, never by position.
          ...(hasAny(pat) ? { quarters_pat: pat } : {}),
          ...(dates && dates.length ? { quarters_dates: dates } : {}),
          ...(hasAny(tax) ? { quarters_tax_pct: tax } : {}),
          ...(hasAny(oiPct) ? { quarters_other_income_pct: oiPct } : {}),
        };
      })(),
      financials_source: 'screener-worker',
    };
  } catch {
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
    return gate(() => fetch(input, init));  // zzz423 — gate direct fetches too
  }

  const proxyUrl = buildProxyUrl(targetUrl);
  return gate(() => fetch(proxyUrl, init));  // zzz423 — cap proxy burst
}

/**
 * Returns true if proxy env vars are configured. Useful for logging /
 * status pages so the operator can verify proxy is active.
 */
export function isProxyConfigured(): boolean {
  return !!(process.env.PROXY_URL && process.env.PROXY_SECRET);
}
