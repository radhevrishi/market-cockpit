// PATCH 1101hhh — Same-origin redirect proxy for screener.in downloads.
//
// Problem: bulk-download anchor tags with target="_blank" to cross-origin
// (screener.in) trip Chrome's popup blocker. Only the first opens.
//
// Fix: anchors point to /api/screener/redirect?url=<screener-url> (same-origin).
//   - Same-origin + download attribute → browser uses download manager, no popup.
//   - Server 302s to the real screener.in URL.
//   - Browser follows redirect carrying screener.in's session cookie (top-level
//     navigation continuation) → CSV lands in Downloads folder.
//
// Allow-list: only https://www.screener.in/* URLs are forwarded (no open redirect).

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PREFIX = 'https://www.screener.in/';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl.searchParams.get('url') || '';
  if (!url.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json({ error: 'invalid url', hint: 'only screener.in URLs are forwarded' }, { status: 400 });
  }
  return NextResponse.redirect(url, 302);
}
