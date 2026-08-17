// zzz397 — Book Watch: read back the persisted book + the alert feed.
//
// GET /api/v1/book/state?chatId=...&feed=1
//   { ok, book: BookState | null, feed: BookFlag[] }
// The feed is the in-app "Book Watch" inbox the cron appends to, so the user
// sees fired alerts even when no Slack/SMTP push channel is configured.

import { NextRequest, NextResponse } from 'next/server';
import { readBookState, readFeed } from '@/lib/book-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const ADMIN_CHAT_ID = process.env.NEXT_PUBLIC_CHAT_ID || '5057319640';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get('chatId') || ADMIN_CHAT_ID;
  const wantFeed = searchParams.get('feed') !== '0';

  const [book, feed] = await Promise.all([
    readBookState(chatId),
    wantFeed ? readFeed(chatId) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    ok: true,
    chatId,
    book: book || null,
    tickers: book?.tickers?.length || 0,
    updatedAt: book?.updatedAt || null,
    feed,
  });
}
