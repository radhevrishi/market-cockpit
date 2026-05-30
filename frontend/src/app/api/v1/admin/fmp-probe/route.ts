// Probe: does FMP cover Indian earnings for the last N days (free backfill source)?
// Read-only, no writes. GET /api/v1/admin/fmp-probe?secret=mc-fmp-1043&days=95
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ONESHOT = 'mc-fmp-1043';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  if (provided !== ONESHOT && expected !== '' && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const key = process.env.FMP_KEY || '';
  if (!key) return NextResponse.json({ error: 'FMP_KEY not set' }, { status: 503 });

  const days = Math.max(7, Math.min(120, parseInt(searchParams.get('days') || '95', 10)));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${f(from)}&to=${f(to)}&apikey=${key}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'mc-probe' } });
    const status = res.status;
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    if (!Array.isArray(body)) {
      return NextResponse.json({ ok: false, status, note: 'non-array response', sample: typeof body === 'object' ? body : String(body).slice(0, 200) });
    }
    const total = body.length;
    const indian = body.filter((r: any) => /\.(NS|BO)$/i.test(String(r?.symbol || '')));
    const months: Record<string, number> = {};
    for (const r of indian) { const m = String(r?.date || '').slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; }
    return NextResponse.json({
      ok: true,
      status,
      window: { from: f(from), to: f(to) },
      total_global: total,
      indian_count: indian.length,
      indian_by_month: months,
      indian_sample: indian.slice(0, 12).map((r: any) => ({ symbol: r.symbol, date: r.date, eps: r.eps, epsEstimated: r.epsEstimated })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'fmp-fetch-failed', message: e?.message || String(e) }, { status: 500 });
  }
}
