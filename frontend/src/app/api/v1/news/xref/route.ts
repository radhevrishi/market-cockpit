import { NextResponse } from 'next/server';
import { listXRef } from '@/lib/news/cross-reference';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// GET /api/v1/news/xref?theme=MEMORY_STORAGE&limit=10
//
// Returns the rolling 90-day window of structural articles tagged with
// the given theme. Used by the UI to render "see also: 4 prior articles"
// under each structural alert. Theme is the bottleneck_sub_tag emitted
// by the classifier.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const theme = searchParams.get('theme') || '';
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '10', 10));
  if (!theme) {
    return NextResponse.json({ ok: false, error: 'missing theme', items: [] });
  }
  const items = await listXRef(theme, limit);
  return NextResponse.json({ ok: true, theme, count: items.length, items });
}
