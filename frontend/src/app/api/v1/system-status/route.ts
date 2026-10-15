// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/system-status (PATCH 0840)
//
// Probes every critical data endpoint in parallel + returns a structured
// status payload. Used by /system-status dashboard page. ~3-5s per probe,
// runs in parallel so total response time is ~5s worst case.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { internalBase } from '@/lib/internal-base';
import { kvUsageSnapshot } from '@/lib/kv';

export const runtime = 'nodejs';
export const maxDuration = 15;

interface Probe {
  name: string;
  url: string;
  category: 'earnings' | 'movers' | 'news' | 'signals' | 'breadth' | 'special';
  expectedField?: string;
  timeoutMs?: number;
}

// PATCH 1058 — /api/v1/earnings/graded requires a ?date= param, otherwise
// upstream returns 400 and the section gets marked DOWN. Stamp today's
// ISO yyyy-mm-dd on the probe URL.
// zzz883: dates are worked out on EVERY request (they used to be fixed when the server started, and the scan probe asked for May 2026)
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const probesNow = (): Probe[] => [
  // zzz957: cache_only — the probe used to START a full grading build for today's date on every status check (a new IST day has
  // nothing cached yet), took > 8 s and was reported DOWN while adding load. Now it only reads; an ungraded day shows EMPTY.
  { name: 'EO graded (today)',     url: `/api/v1/earnings/graded?date=${istToday()}&cache_only=1`, category: 'earnings', expectedField: 'by_tier', timeoutMs: 15_000 },   // a graded day is a large stored record: reading it takes ~6 s
  { name: 'EO calendar',           url: '/api/v1/calendar?days=7',                     category: 'earnings', expectedField: 'buckets' },
  { name: 'Earnings scan',         url: `/api/market/earnings?market=india&month=${istToday().slice(0, 7)}`, category: 'earnings', expectedField: 'results' },
  { name: 'Quotes (movers)',       url: '/api/market/quotes?market=india',             category: 'movers',   expectedField: 'stocks' },
  { name: 'Mover reasons',         url: '/api/market/mover-reasons?tickers=RELIANCE',  category: 'movers',   expectedField: 'reasons' },
  { name: 'Fundamentals',          url: '/api/market/fundamentals?tickers=RELIANCE',   category: 'movers',   expectedField: 'fundamentals' },
  { name: 'News feed',             url: '/api/v1/news?limit=10',                       category: 'news' },
  { name: 'Signals (intelligence)', url: '/api/market/intelligence?days=30',           category: 'signals',  expectedField: 'signals' },
  { name: 'Special Situations',    url: '/api/v1/special-situations/feed',             category: 'special',  expectedField: 'events' },
  { name: 'Concall live-feed',     url: '/api/v1/concall-intel/live-feed?days=7&cacheOnly=1', category: 'signals', expectedField: 'filings' },
  { name: 'Market Breadth',        url: '/api/v1/breadth',                             category: 'breadth',  expectedField: 'pillars' },
];

async function probe(p: Probe, origin: string): Promise<any> {
  const start = Date.now();
  try {
    const res = await fetch(origin + p.url, { signal: AbortSignal.timeout(p.timeoutMs ?? 8000), cache: 'no-store' });
    const elapsed = Date.now() - start;
    if (!res.ok) {
      return { ...p, status: 'DOWN', httpCode: res.status, latencyMs: elapsed };
    }
    const data = await res.json();
    let recordCount = 0;
    if (p.expectedField && data) {
      const v = data[p.expectedField];
      if (Array.isArray(v)) recordCount = v.length;
      else if (typeof v === 'object' && v) recordCount = Object.keys(v).length;
      // by_tier special case
      if (p.expectedField === 'by_tier') {
        recordCount = Object.values(v as any || {}).reduce((s: number, arr: any) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      }
    }
    let status: 'HEALTHY' | 'DEGRADED' | 'EMPTY' = 'HEALTHY';
    if (recordCount === 0 && p.expectedField) status = 'EMPTY';
    if (elapsed > 5000) status = 'DEGRADED';
    return { ...p, status, httpCode: 200, latencyMs: elapsed, recordCount };
  } catch (e: any) {
    return { ...p, status: 'DOWN', error: e?.message || 'unknown', latencyMs: Date.now() - start };
  }
}

// zzz957: one result is shared for 30 s, so repeated checks (several tabs, monitors, a person refreshing) do not each fire
// eleven self-requests at once and slow the very pages they measure. ?fresh=1 always measures again.
let _memo: { at: number; body: any } | null = null;
let _inflight: Promise<any> | null = null;
const MEMO_MS = 90_000;   // zzz1049: 30 s → 90 s (each build fires eleven probe requests that read KV)
// zzz1049 — Upstash commands sent by this process, per hour and per key family (memory counter; always live, never memoised)
const withKv = (body: any) => ({ ...body, kvUsage: kvUsageSnapshot() });
/** Optional extras must never hold the status answer up: give each at most `ms`. */
function capped<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  if (!fresh && _memo && Date.now() - _memo.at < MEMO_MS) return NextResponse.json(withKv({ ..._memo.body, cached_for_s: Math.round((Date.now() - _memo.at) / 1000) }), { headers: { 'Cache-Control': 'no-store' } });
  if (!fresh && _inflight) return NextResponse.json(withKv(await _inflight), { headers: { 'Cache-Control': 'no-store' } });
  const run = buildStatus(request);
  if (!fresh) _inflight = run;
  try {
    const body = await run;
    _memo = { at: Date.now(), body };
    return NextResponse.json(withKv(body), { headers: { 'Cache-Control': 'no-store' } });
  } finally { if (_inflight === run) _inflight = null; }
}

async function buildStatus(request: Request): Promise<any> {
  const origin = internalBase(request); // PATCH 1013 — Railway self-fetch fix
  const results = await Promise.all(probesNow().map(p => probe(p, origin)));
  const summary = {
    total: results.length,
    healthy: results.filter(r => r.status === 'HEALTHY').length,
    degraded: results.filter(r => r.status === 'DEGRADED').length,
    empty: results.filter(r => r.status === 'EMPTY').length,
    down: results.filter(r => r.status === 'DOWN').length,
  };
  // PATCH 0853 — Surface Signals compute/filter/universe version stamps
  // and last-compute age so the dashboard tells you AT A GLANCE whether
  // the latest deploy is live, the cron has fired since deploy, and the
  // universe blob is fresh.
  let signalsVersions: any = undefined;
  try {
    const { kvGet } = await import('@/lib/kv');
    const meta = await kvGet<any>('intelligence:meta');
    if (meta) {
      const ageMs = meta.computedAt ? (Date.now() - new Date(meta.computedAt).getTime()) : Infinity;
      const ageMin = Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : null;
      signalsVersions = {
        computeVersion: meta.computeVersion || 'pre-0853',
        filterVersion:  meta.filterVersion  || 'pre-0853',
        universeVersion: meta.universeVersion || 'unknown',
        computedAt: meta.computedAt || null,
        computedAgeMin: ageMin,
        signalCount: meta.signalCount ?? 0,
        signalHashShort: meta.signalHash ? String(meta.signalHash).slice(0, 16) : null,
      };
    }
  } catch {}
  // zzz747 — what the model calls cost this month, per feature, from the
  // API's own usage counts (lib/anthropic-meter). And the cap that stops them.
  let anthropicSpend: any = undefined;
  try {
    const { readSpend, monthlyCapUsd, provider, openaiModel } = await import('@/lib/anthropic-meter');
    const led = await readSpend();
    const prov = provider();
    anthropicSpend = { ...led, cap_usd: monthlyCapUsd(), provider: prov, model: prov === 'openai' ? openaiModel() : 'claude-haiku-4-5' };
  } catch (e: any) {
    anthropicSpend = { error: String(e?.message || e) };
  }
  // zzz749 — the last data-watch run: did each pipeline PRODUCE data.
  let dataWatch: any = undefined;
  try {
    const { kvGet } = await import('@/lib/kv');
    dataWatch = (await kvGet<any>('data-watch:last')) || null;
  } catch (e: any) { dataWatch = { error: String(e?.message || e) }; }
  // zzz905 — NSE holiday calendar coverage (missingFor = current year has no list).
  let nseHolidays: any = undefined;
  try { nseHolidays = await capped((await import('@/lib/nse-holidays-server')).warmNseHolidays() as Promise<any>, 3000, { pending: 'still loading' }); }
  catch (e: any) { nseHolidays = { error: String(e?.message || e) }; }
  return {
    generated_at: new Date().toISOString(),
    // zzz955 — which deploy is running (git commit when Railway built it; build id otherwise)
    build: { commit: (process.env.MC_BUILD_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 40) || null, deployment: process.env.RAILWAY_DEPLOYMENT_ID || null },
    summary,
    nseHolidays,
    signalsVersions,
    anthropicSpend,
    dataWatch,
    probes: results,
  };
}
