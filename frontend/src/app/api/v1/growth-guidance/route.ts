// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/growth-guidance?threshold=30&metric=REVENUE|PAT|EPS|EBITDA|FCF&market=IN|US|ALL&cap=SMALL_MICRO|ALL&kind=MGMT|ALL&sort=<GgSort>&force=1   (zzz846)
//
// Companies whose MANAGEMENT has communicated unusually high future growth, verified against a primary source where one is held.
// PUBLIC company data only: never reads holdings (My Book is overlaid in the browser; portfolio.held is always false).
// NO AI. NO document fetching (so it stays public). Cache-first, 22s budget, 2-minute in-memory cache. India and US processed separately.
// Candidate feeds reused from Guidance Upgrades: news cache, concall/filing feed cache, India + US graded caches, live NSE/BSE/EDGAR scan.
// Reported growth / OPM / cap band come from the graded caches (latest row per ticker). Not available: India TTM revenue, prior-FY revenue,
// India consensus, valuation multiples beyond P/E. Those stay DATA UNAVAILABLE / null; nothing is invented.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { getLiveGuidance } from '@/lib/growth-guidance-live';
import { filterCompanies, sortCompanies, newTodayOf, GG_SORTS, type GgFilters } from '@/lib/growth-guidance';
import type { GgMetric, GgResponse, GgSort } from '@/lib/growth-guidance-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const METRICS: GgMetric[] = ['REVENUE', 'PAT', 'EPS', 'EBITDA', 'FCF'];
function parseParams(sp: URLSearchParams): GgFilters & { sort: GgSort; force: boolean } {
  const t = parseFloat(sp.get('threshold') || '30');
  const m = String(sp.get('metric') || 'REVENUE').toUpperCase() as GgMetric;
  const mk = String(sp.get('market') || 'ALL').toUpperCase();
  const cap = String(sp.get('cap') || 'SMALL_MICRO').toUpperCase();
  const kind = String(sp.get('kind') || 'MGMT').toUpperCase();
  const sort = String(sp.get('sort') || 'DEFAULT').toUpperCase() as GgSort;
  return {
    threshold: Number.isFinite(t) ? Math.min(500, Math.max(1, t)) : 30, metric: METRICS.includes(m) ? m : 'REVENUE',
    market: mk === 'IN' || mk === 'US' ? mk : 'ALL', cap: cap === 'ALL' ? 'ALL' : 'SMALL_MICRO', kind: kind === 'ALL' ? 'ALL' : 'MGMT',
    sort: GG_SORTS.includes(sort) ? sort : 'DEFAULT', force: sp.get('force') === '1',
  };
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const f = parseParams(new URL(req.url).searchParams);
  const now = new Date();
  // the live build is market-scoped and filter-free, so every filter/sort combination reuses it (shared 2-minute cache)
  let uni;
  try { uni = await getLiveGuidance(f.market, now, t0, f.force); }
  catch (e: any) { console.error('[growth-guidance] engine error', e?.message || e); return NextResponse.json({ ok: false, error: 'The growth guidance engine could not finish. Please try again.' }, { status: 500 }); }
  const fc = filterCompanies(uni.all, f);
  const companies = sortCompanies(fc.companies, f.sort);
  const discovery = sortCompanies(fc.discovery, 'DEFAULT');
  const newToday = newTodayOf([...companies, ...discovery].filter((c) => c.verification === 'VERIFIED' || c.verification === 'PARTIALLY_VERIFIED'));
  const body: GgResponse = {
    asOf: now.toISOString(), threshold: f.threshold, metric: f.metric, companies, discovery, newToday,
    counts: { universe: fc.universe, verified: companies.filter((c) => c.verification === 'VERIFIED').length, partially: companies.filter((c) => c.verification === 'PARTIALLY_VERIFIED').length,
      discovery: discovery.length, newToday: newToday.length, byMarket: { IN: companies.filter((c) => c.market === 'IN').length, US: companies.filter((c) => c.market === 'US').length } },
    scan: uni.scan,
    note: !companies.length && !uni.scan.complete ? 'No verified growth guidance shown, but the scan was INCOMPLETE — scan incomplete, not a confirmation of no guidance.'
      : !companies.length ? `No verified guidance at or above +${f.threshold}% found in the sources read.` : undefined,
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
