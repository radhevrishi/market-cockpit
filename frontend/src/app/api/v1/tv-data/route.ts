// zzz1048 — the files the TradingView sync used to commit (public/data/tradingview/*.csv + manifest.json), now made from our own
// Stock Screener snapshots (lib/screener/tv-replacement*.ts). Same file names, same CSV columns, same money units.
//
//   GET /api/v1/tv-data                  → the manifest (same shape as the old manifest.json, plus `source` per file)
//   GET /api/v1/tv-data?file=<name>.csv  → that file's CSV text
//
// Public market data, except the US Portfolio Book list (watchlist-usa-339270482.csv): the owner's holdings, served only to a
// signed-in browser or a service key. When a snapshot is missing the old committed export is served, labelled as old data
// (header x-tv-source: old-tradingview-export).
import { NextResponse } from 'next/server';
import { siteAuthOk } from '@/lib/site-auth-request';
import { buildTvFile, buildTvManifest } from '@/lib/screener/tv-replacement-server';
import { tvFileOf } from '@/lib/screener/tv-replacement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get('file');
  const withPersonal = await siteAuthOk(req);
  if (!file) {
    const manifest = await buildTvManifest({ withPersonal });
    return NextResponse.json(manifest, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const f = tvFileOf(file);
  if (!f) return NextResponse.json({ ok: false, error: `unknown file ${file.slice(0, 80)}` }, { status: 404 });
  if (f.list === 'us-book' && !withPersonal) return NextResponse.json({ ok: false, error: 'sign in to read the US Portfolio Book list' }, { status: 401 });
  const r = await buildTvFile(f.name, { withPersonal });
  if (!r || !r.text) return NextResponse.json({ ok: false, error: r?.error || 'not available' }, { status: 503 });
  return new NextResponse(r.text, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'x-tv-source': r.source,
      ...(r.builtAt ? { 'x-tv-built-at': r.builtAt } : {}),
    },
  });
}
