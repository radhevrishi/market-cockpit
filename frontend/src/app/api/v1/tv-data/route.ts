// zzz1048 — the files the TradingView sync used to commit (public/data/tradingview/*.csv + manifest.json), now made from our own
// Stock Screener snapshots (lib/screener/tv-replacement*.ts). Same file names, same CSV columns, same money units.
//
//   GET /api/v1/tv-data                  → the manifest (same shape as the old manifest.json, plus `source` per file)
//   GET /api/v1/tv-data?file=<name>.csv  → that file's CSV text
//
// Public market data, except the US Portfolio Book list (watchlist-usa-339270482.csv): the owner's holdings, served only to a
// signed-in browser or a service key. When a snapshot is missing the old committed export is served, labelled as old data
// (header x-tv-source: old-tradingview-export).
//
// zzz1053 — speed: files are built once per snapshot (tv-replacement-server memo + the shared snapshot cache) and sent with an
// ETag, so a revisit with an unchanged snapshot is a 304. Public files may be kept by the browser for a minute
// (private, max-age=60, stale-while-revalidate=600); the manifest is revalidated on every load (it differs for a signed-in
// browser); the US-book list is never cached. Server-Timing shows where the time went.
import { NextResponse } from 'next/server';
import { siteAuthOk } from '@/lib/site-auth-request';
import { buildTvFile, buildTvManifest } from '@/lib/screener/tv-replacement-server';
import { tvFileOf } from '@/lib/screener/tv-replacement';
import { etagOfText, sendText } from '@/lib/server-memo';
import { serverTiming } from '@/lib/server-timing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TV_FILE_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=600';

export async function GET(req: Request) {
  const t = serverTiming();
  const file = new URL(req.url).searchParams.get('file');
  const withPersonal = await t.time('auth', () => siteAuthOk(req));
  if (!file) {
    const manifest = await t.time('build', () => buildTvManifest({ withPersonal }), 'manifest');
    const text = JSON.stringify(manifest);
    return sendText(req, { text, contentType: 'application/json', etag: etagOfText(text), cacheControl: 'private, no-cache', headers: { Vary: 'Cookie' }, timing: t });
  }
  const f = tvFileOf(file);
  if (!f) return NextResponse.json({ ok: false, error: `unknown file ${file.slice(0, 80)}` }, { status: 404 });
  if (f.list === 'us-book' && !withPersonal) return NextResponse.json({ ok: false, error: 'sign in to read the US Portfolio Book list' }, { status: 401 });
  const r = await t.time('build', () => buildTvFile(f.name, { withPersonal }), f.name);
  if (!r || !r.text) return NextResponse.json({ ok: false, error: r?.error || 'not available' }, { status: 503 });
  const personal = f.list === 'us-book';
  return sendText(req, {
    text: r.text, contentType: 'text/csv; charset=utf-8',
    // the owner's holdings: never kept by the browser, no ETag
    etag: personal ? null : etagOfText(r.text),
    cacheControl: personal ? 'private, no-store' : TV_FILE_CACHE_CONTROL,
    headers: { 'x-tv-source': r.source, ...(r.builtAt ? { 'x-tv-built-at': r.builtAt } : {}) },
    timing: t,
  });
}
