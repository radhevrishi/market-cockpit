// zzz1286 — owner-only check: does the mc-proxy relay reach NSE / BSE filing APIs from here? (direct vs relay, status, rows, ms)
import { NextRequest, NextResponse } from 'next/server';
import { siteAuthOk } from '@/lib/site-auth-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;

async function probe(label: string, run: () => Promise<Response>) {
  const t0 = Date.now();
  try {
    const r = await run();
    const txt = await r.text();
    let rows: number | null = null;
    try { const j = JSON.parse(txt); rows = Array.isArray(j) ? j.length : Array.isArray(j?.data) ? j.data.length : Array.isArray(j?.Table) ? j.Table.length : null; } catch { /* not JSON */ }
    return { label, status: r.status, rows, bytes: txt.length, ms: Date.now() - t0, head: rows == null ? txt.slice(0, 120) : undefined };
  } catch (e: any) { return { label, error: String(e?.name || e?.message || e), ms: Date.now() - t0 }; }
}

export async function GET(req: NextRequest) {
  if (!(await siteAuthOk(req))) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 401 });
  const { isProxyConfigured, proxiedFetch } = await import('@/lib/proxy-fetch');
  const now = new Date(); const from = new Date(now.getTime() - 3 * 86_400_000);
  const nseUrl = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(now)}`;
  const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
  const sym = (req.nextUrl.searchParams.get('symbol') || 'TATATECH').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  const oneDay = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${ddmmyyyy(now)}&to_date=${ddmmyyyy(now)}`;
  const out = await Promise.all([
    probe('NSE home page (cookie step)', () => fetch('https://www.nseindia.com/', { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) })),
    probe('NSE direct (one day)', () => fetch(oneDay, { headers: H, signal: AbortSignal.timeout(12_000) })),
    probe(`NSE direct corporate-announcements symbol ${sym}`, () => fetch(`https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${sym}`, { headers: H, signal: AbortSignal.timeout(12_000) })),
    probe(`NSE direct corporates-announcements symbol ${sym}`, () => fetch(`https://www.nseindia.com/api/corporates-announcements?index=equities&symbol=${sym}`, { headers: H, signal: AbortSignal.timeout(12_000) })),
    probe('NSE direct (all equities, 3 days)', () => fetch(nseUrl, { headers: H, signal: AbortSignal.timeout(12_000) })),
    isProxyConfigured() ? probe('NSE via relay (all equities, 3 days)', () => proxiedFetch(nseUrl, { signal: AbortSignal.timeout(20_000) })) : Promise.resolve({ label: 'relay', error: 'PROXY_URL / PROXY_SECRET not set' }),
  ]);
  // the app's own feed function for single days (what the India scans call), timed
  const feed = await import('@/lib/nse-bse-feed');
  const days = [0, 1, 2].map((k) => new Date(now.getTime() + 5.5 * 3_600_000 - k * 86_400_000).toISOString().slice(0, 10));
  const appFeed = await Promise.all(days.map(async (d) => { const t0 = Date.now(); try { const r: any = await feed.fetchNSEAnnouncements({ fromIso: d, toIso: d }); return { day: d, ms: Date.now() - t0, source: r?.source, via: r?.via, rows: (r?.filings || []).length, reason: r?.reason }; } catch (e: any) { return { day: d, ms: Date.now() - t0, error: String(e?.message || e) }; } }));
  return NextResponse.json({ ok: true, relayConfigured: isProxyConfigured(), probes: out.filter(Boolean), appFeed });
}
