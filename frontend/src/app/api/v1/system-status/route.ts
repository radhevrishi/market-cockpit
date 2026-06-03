// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/system-status (PATCH 0840)
//
// Probes every critical data endpoint in parallel + returns a structured
// status payload. Used by /system-status dashboard page. ~3-5s per probe,
// runs in parallel so total response time is ~5s worst case.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { internalBase } from '@/lib/internal-base';

export const runtime = 'nodejs';
export const maxDuration = 15;

interface Probe {
  name: string;
  url: string;
  category: 'earnings' | 'movers' | 'news' | 'signals' | 'breadth' | 'special';
  expectedField?: string;
}

const PROBES: Probe[] = [
  { name: 'EO graded (today)',     url: '/api/v1/earnings/graded',                     category: 'earnings', expectedField: 'by_tier' },
  { name: 'EO calendar',           url: '/api/v1/calendar?days=7',                     category: 'earnings', expectedField: 'buckets' },
  { name: 'Earnings scan',         url: '/api/market/earnings?market=india&month=2026-05', category: 'earnings', expectedField: 'results' },
  { name: 'Quotes (movers)',       url: '/api/market/quotes?market=india',             category: 'movers',   expectedField: 'stocks' },
  { name: 'Mover reasons',         url: '/api/market/mover-reasons?tickers=RELIANCE',  category: 'movers',   expectedField: 'reasons' },
  { name: 'Fundamentals',          url: '/api/market/fundamentals?tickers=RELIANCE',   category: 'movers',   expectedField: 'fundamentals' },
  { name: 'News feed',             url: '/api/v1/news?limit=10',                       category: 'news' },
  { name: 'Signals (intelligence)', url: '/api/market/intelligence?days=30',           category: 'signals',  expectedField: 'signals' },
  { name: 'Special Situations',    url: '/api/v1/special-situations/feed',             category: 'special',  expectedField: 'events' },
  { name: 'Super Investors',       url: '/api/v1/super-investor-flow',                 category: 'special' },
  { name: 'Concall live-feed',     url: '/api/v1/concall-intel/live-feed?days=7&cacheOnly=1', category: 'signals', expectedField: 'filings' },
  { name: 'Market Breadth',        url: '/api/v1/breadth',                             category: 'breadth',  expectedField: 'pillars' },
];

async function probe(p: Probe, origin: string): Promise<any> {
  const start = Date.now();
  try {
    const res = await fetch(origin + p.url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
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

export async function GET(request: Request) {
  const origin = internalBase(request); // PATCH 1013 — Railway self-fetch fix
  const results = await Promise.all(PROBES.map(p => probe(p, origin)));
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
  return NextResponse.json({
    generated_at: new Date().toISOString(),
    summary,
    signalsVersions,
    probes: results,
  }, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
}
