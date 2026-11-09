// zzz1234 — the owner's screener.in screens and watchlists, made from our own Stock Screener data (lib/screener/screenerin-server).
//   GET                 → manifest (same shape as the old /data/screener/manifest.json)
//   GET ?file=<slug>.csv → the CSV with screener.in's export columns
//   POST { slug, query } → save (or clear) the screener.in query for a screen; it then runs on our data
import { NextRequest, NextResponse } from 'next/server';
import { buildScreenerInFiles, saveQuery, screenerInManifest, SCREENERIN_FILES } from '@/lib/screener/screenerin-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const file = new URL(req.url).searchParams.get('file');
  try {
    if (!file) return NextResponse.json(await screenerInManifest(), { headers: { 'Cache-Control': 'private, max-age=60' } });
    const slug = file.replace(/\.(csv|xlsx)$/i, '');
    const b = await buildScreenerInFiles();
    const x = b.built.get(slug);
    if (!x) return NextResponse.json({ ok: false, error: 'unknown file' }, { status: 404 });
    return new NextResponse(x.csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, max-age=60', 'X-Source': x.source } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const slug = String(body?.slug || '');
  if (!SCREENERIN_FILES.some((f) => f.slug === slug && f.kind === 'screen')) return NextResponse.json({ ok: false, error: 'unknown screen' }, { status: 400 });
  await saveQuery(slug, typeof body?.query === 'string' ? body.query : null);
  return NextResponse.json({ ok: true, manifest: await screenerInManifest() });
}
