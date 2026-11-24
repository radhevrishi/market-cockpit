// Options Ideas (lib/options-ideas).
//   GET ?market=US|IN&ticker=X        one company: setups, grade, plan, option (live chain when it can be read)
//   GET ?market=US|IN&tickers=A,B,…   up to 10 companies (the page's "My lists" scan), no live chains
//   GET ?market=US|IN                 the last scheduled scan (KV)
//   GET ?log=1                        the live track record
//   POST ?market=US|IN&run=1          run the scan now (owner / service key)
//   POST ?grade=1                     grade the live track record now (owner / service key)
import { NextRequest, NextResponse } from 'next/server';
import { analyseTicker, readScan, readLog, runScan, gradeLog, type Mkt } from '@/lib/options-ideas/server';
import { STUDY } from '@/lib/options-ideas/model-coeffs';
import { siteAuthOk } from '@/lib/site-auth-request';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const clean = (t: string) => t.trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE):/, '').replace(/[^A-Z0-9&.\-]/g, '').slice(0, 20);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const market: Mkt = sp.get('market') === 'IN' ? 'IN' : 'US';
  if (sp.get('log') === '1') return NextResponse.json({ ok: true, log: await readLog(), study: STUDY }, { headers: { 'Cache-Control': 'no-store' } });
  const one = sp.get('ticker');
  if (one) {
    const t = clean(one);
    if (!t) return NextResponse.json({ ok: false, error: 'Add a ticker.' }, { status: 400 });
    const r = await analyseTicker(market, t, { chain: true, bars: true });
    return NextResponse.json({ ...r, study: { trainedOn: STUDY.trainedOn, option: STUDY.option } }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const many = sp.get('tickers');
  if (many) {
    const list = Array.from(new Set(many.split(/[,\s]+/).map(clean).filter(Boolean))).slice(0, 10);
    const results = await Promise.all(list.map((t) => analyseTicker(market, t, { chain: false }).catch(() => null)));
    return NextResponse.json({ ok: true, market, results: results.filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const scan = await readScan(market);
  return NextResponse.json({ ok: true, market, scan, study: STUDY }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!(await siteAuthOk(req))) return NextResponse.json({ ok: false, error: 'Owner only.' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  if (sp.get('grade') === '1') return NextResponse.json({ ok: true, ...(await gradeLog()) });
  if (sp.get('run') === '1') {
    const market: Mkt = sp.get('market') === 'IN' ? 'IN' : 'US';
    const s = await runScan(market, 4 * 60_000);
    return NextResponse.json({ ok: true, market, scanned: s.scanned, counts: s.counts, tookS: s.tookS });
  }
  return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 });
}
