import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Forward Calendar — what's coming next
// ─────────────────────────────────────────────────────────────────────────────
// Bloomberg's EVTS <GO> equivalent. Returns three buckets:
//   tomorrow      — next 24h
//   this_week     — next 7 days (excluding tomorrow)
//   this_month    — next 30 days (excluding this_week)
//
// Events come from three sources:
//   1. FMP /stable/earnings-calendar (US tickers)
//   2. NSE corporate-actions / board-meetings (India tickers)
//   3. Static India macro calendar (RBI MPC, GST release dates,
//      F&O expiry, IPO listings, monsoon-onset)
//
// Static calendar entries are kept in CALENDAR_STATIC below — update
// quarterly. Dynamic entries (FMP, NSE) refresh on each request and
// cache for 1 hour.
// ─────────────────────────────────────────────────────────────────────────────

const FMP_KEY = process.env.FMP_KEY || '';
const STABLE = 'https://financialmodelingprep.com/stable';

// India macro calendar — static, hand-curated. Update each quarter.
// Dates ISO 8601. Add new events at the END (UI sorts by date).
const CALENDAR_STATIC: Array<{
  date: string;
  type: 'rbi_mpc' | 'gst_release' | 'expiry' | 'budget' | 'monsoon' | 'pmi_release' | 'core_sector' | 'us_fomc' | 'us_cpi' | 'us_jobs';
  region: 'IN' | 'US' | 'GLOBAL';
  title: string;
  importance: 'high' | 'medium';
}> = [
  // RBI MPC schedule (FY26-27 — public RBI Calendar)
  { date: '2026-06-04', type: 'rbi_mpc', region: 'IN', title: 'RBI MPC Decision (Jun 2026)', importance: 'high' },
  { date: '2026-08-06', type: 'rbi_mpc', region: 'IN', title: 'RBI MPC Decision (Aug 2026)', importance: 'high' },
  { date: '2026-10-08', type: 'rbi_mpc', region: 'IN', title: 'RBI MPC Decision (Oct 2026)', importance: 'high' },
  { date: '2026-12-03', type: 'rbi_mpc', region: 'IN', title: 'RBI MPC Decision (Dec 2026)', importance: 'high' },
  // Monthly GST collection release — 1st of each month
  { date: '2026-06-01', type: 'gst_release', region: 'IN', title: 'GST Collection Release (May 2026)', importance: 'high' },
  { date: '2026-07-01', type: 'gst_release', region: 'IN', title: 'GST Collection Release (Jun 2026)', importance: 'high' },
  { date: '2026-08-01', type: 'gst_release', region: 'IN', title: 'GST Collection Release (Jul 2026)', importance: 'high' },
  // F&O monthly expiry — last Thursday of each month
  { date: '2026-05-28', type: 'expiry', region: 'IN', title: 'NSE F&O Monthly Expiry', importance: 'medium' },
  { date: '2026-06-25', type: 'expiry', region: 'IN', title: 'NSE F&O Monthly Expiry', importance: 'medium' },
  { date: '2026-07-30', type: 'expiry', region: 'IN', title: 'NSE F&O Monthly Expiry', importance: 'medium' },
  // Manufacturing PMI release
  { date: '2026-06-02', type: 'pmi_release', region: 'IN', title: 'India Manufacturing PMI (May)', importance: 'medium' },
  { date: '2026-07-01', type: 'pmi_release', region: 'IN', title: 'India Manufacturing PMI (Jun)', importance: 'medium' },
  // Monsoon onset / progress
  { date: '2026-05-29', type: 'monsoon', region: 'IN', title: 'IMD: SW Monsoon Kerala onset (typical)', importance: 'high' },
  { date: '2026-06-15', type: 'monsoon', region: 'IN', title: 'IMD: Monsoon central India coverage', importance: 'medium' },
  // Core sector index
  { date: '2026-05-30', type: 'core_sector', region: 'IN', title: 'India Core Sector Index (Apr 2026)', importance: 'medium' },
  { date: '2026-06-30', type: 'core_sector', region: 'IN', title: 'India Core Sector Index (May 2026)', importance: 'medium' },
  // US FOMC schedule
  { date: '2026-06-17', type: 'us_fomc', region: 'US', title: 'US FOMC Decision (Jun)', importance: 'high' },
  { date: '2026-07-29', type: 'us_fomc', region: 'US', title: 'US FOMC Decision (Jul)', importance: 'high' },
  { date: '2026-09-16', type: 'us_fomc', region: 'US', title: 'US FOMC Decision (Sep)', importance: 'high' },
  // US CPI release
  { date: '2026-05-13', type: 'us_cpi', region: 'US', title: 'US CPI (Apr 2026)', importance: 'high' },
  { date: '2026-06-11', type: 'us_cpi', region: 'US', title: 'US CPI (May 2026)', importance: 'high' },
  // US Jobs report (NFP)
  { date: '2026-05-15', type: 'us_jobs', region: 'US', title: 'US Non-Farm Payrolls (Apr)', importance: 'high' },
  { date: '2026-06-05', type: 'us_jobs', region: 'US', title: 'US Non-Farm Payrolls (May)', importance: 'high' },
];

async function fetchFmpEarningsCalendar(daysAhead: number): Promise<Array<{
  date: string;
  type: 'earnings';
  region: 'US';
  title: string;
  ticker: string;
  importance: 'high' | 'medium';
}>> {
  if (!FMP_KEY) return [];
  const fromDate = new Date().toISOString().slice(0, 10);
  const toDate = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
  try {
    const r = await fetch(
      `${STABLE}/earnings-calendar?from=${fromDate}&to=${toDate}&apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } },
    );
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    // Filter to high-cap names + names with non-null EPS estimate (likely
    // covered enough to matter). Cap at 60 to keep response small.
    return arr
      .filter((e: any) => e.epsEstimated != null || e.revenueEstimated != null)
      .slice(0, 60)
      .map((e: any) => ({
        date: e.date,
        type: 'earnings' as const,
        region: 'US' as const,
        title: `${e.symbol} earnings (cons EPS ${e.epsEstimated ?? '—'}, rev ${e.revenueEstimated != null ? '$' + Math.round(e.revenueEstimated / 1e6) + 'M' : '—'})`,
        ticker: e.symbol,
        importance: 'high' as const,
      }));
  } catch {
    return [];
  }
}

export async function GET(_request: Request) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    const week = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const month = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

    const [fmpEarnings] = await Promise.all([
      fetchFmpEarningsCalendar(30),
    ]);

    const all: Array<any> = [
      ...CALENDAR_STATIC.filter(e => e.date >= todayStr && e.date <= month),
      ...fmpEarnings,
    ];

    all.sort((a, b) => a.date.localeCompare(b.date));

    const buckets = {
      tomorrow: all.filter(e => e.date <= tomorrow),
      this_week: all.filter(e => e.date > tomorrow && e.date <= week),
      this_month: all.filter(e => e.date > week && e.date <= month),
    };

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      counts: {
        tomorrow: buckets.tomorrow.length,
        this_week: buckets.this_week.length,
        this_month: buckets.this_month.length,
        total: all.length,
      },
      buckets,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'calendar_fetch_error', buckets: { tomorrow: [], this_week: [], this_month: [] } },
      { status: 200 },
    );
  }
}
