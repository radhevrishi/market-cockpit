import { NextResponse } from 'next/server';
import { kvDel } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Clear the news cache to force a fresh fetch
    await kvDel('news:articles:v1');
    return NextResponse.json({ success: true, message: 'News cache cleared — next request will fetch fresh data' });
  } catch (error) {
    console.error('[News Refresh] Error:', error);
    return NextResponse.json({ success: true, message: 'Refresh triggered' });
  }
}
