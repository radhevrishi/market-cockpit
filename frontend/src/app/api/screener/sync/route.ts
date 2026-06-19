// PATCH 1101zz — Screener.in sync route. Fetches a saved screen as CSV/XLSX
// using the user's sessionid cookie. Currently supports a single screen per
// call; multi-screen ZIP bundling is planned once user verifies single-fetch
// works for them.
//
// Request: POST { sessionid: string, screenId: string|number, name?: string }
// Response (success):
//   - Content-Type: text/csv  OR  application/vnd.openxmlformats-...
//   - Content-Disposition: attachment; filename="<name>.csv"
//   - body: raw bytes from Screener.in
// Response (error): JSON { error, hint?, status? } at 4xx/5xx
//
// The user's sessionid is sent only with this single request; not stored
// server-side. UI keeps it in localStorage and POSTs it each time.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-.]/gi, '_').slice(0, 64);
}

// PATCH 1101aaa — GET handler reports whether server has SCREENER_SESSIONID
// configured, so the client button can skip its localStorage prompt entirely.
// Returns { configured: boolean } — never reveals the actual value.
export async function GET(): Promise<NextResponse> {
  const configured = !!(process.env.SCREENER_SESSIONID || '').trim();
  return NextResponse.json({ configured });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    // PATCH 1101aaa — server-side env var fallback. Priority:
    //   1) SCREENER_SESSIONID env var (set in Railway dashboard, never in code)
    //   2) sessionid from request body (user paste / localStorage)
    // This lets the user configure once in Railway and skip the prompt forever.
    const envSessionid = (process.env.SCREENER_SESSIONID || '').trim();
    const sessionid: string = envSessionid || String(body.sessionid || '').trim();
    const screenId: string = String(body.screenId || '').trim();
    // PATCH 1101ccc — support both saved screens AND watchlists. type='screen'
    // uses /screens/<id>/?excel=1. type='watchlist' uses /watchlist/<id>/?excel=1.
    const type: 'screen' | 'watchlist' = body.type === 'watchlist' ? 'watchlist' : 'screen';
    const rawName: string = String(body.name || `${type}-${screenId}`).trim();
    const name = sanitizeFilename(rawName);

    if (!sessionid) {
      return NextResponse.json({ error: 'sessionid required',
        hint: 'Either set SCREENER_SESSIONID env var on Railway (recommended), OR paste sessionid via the UI prompt. Get it from screener.in (logged in) → DevTools → Application → Cookies → screener.in.' }, { status: 400 });
    }
    if (!screenId || !/^\d+$/.test(screenId)) {
      return NextResponse.json({ error: 'numeric screenId required',
        hint: 'Example: for https://www.screener.in/screens/3443614/fii/, screenId is 3443614' }, { status: 400 });
    }

    // PATCH 1101ccc — Screener.in export endpoint. Different URL for screens
    // vs watchlists, both support ?excel=1 to trigger CSV/Excel download.
    const url = type === 'watchlist'
      ? `https://www.screener.in/watchlist/${screenId}/?excel=1`
      : `https://www.screener.in/screens/${screenId}/?source=&days=365&excel=1`;

    // PATCH 1101aaa — Robust fetch. The previous slim header set triggered
    // generic "fetch failed" — Cloudflare upstream blocks bot-ish requests.
    // Now send a full browser-like header set + 25s timeout + capture the
    // real Node error so the user sees something actionable instead of
    // a generic message.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let r: Response;
    try {
      r = await fetch(url, {
        headers: {
          Cookie: `sessionid=${sessionid}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="121", "Google Chrome";v="121"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          Referer: 'https://www.screener.in/',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      const isAbort = fetchErr?.name === 'AbortError';
      return NextResponse.json({
        error: isAbort ? 'screener.in fetch timed out (25s)' : 'screener.in fetch failed at network layer',
        nodeError: String(fetchErr?.cause?.code || fetchErr?.code || fetchErr?.message || fetchErr),
        hint: 'Cloudflare or DNS blocked the request, or Railway can\'t reach screener.in. If Railway egress is restricted, the only path is setting SCREENER_SESSIONID env var and running the fetch from a different host / GitHub Action.',
      }, { status: 502 });
    }
    clearTimeout(timeout);

    if (!r.ok) {
      let preview = '';
      try { preview = (await r.text()).slice(0, 300); } catch {}
      return NextResponse.json({
        error: 'screener.in fetch failed',
        status: r.status,
        hint: r.status === 401 || r.status === 403
          ? 'Your sessionid is invalid or expired. Refresh it from Chrome DevTools → Application → Cookies → screener.in.'
          : r.status === 404
          ? `Screen ID ${screenId} not found, or you don't have access to it.`
          : 'Check screen ID + sessionid + you have access to this screen.',
        preview,
      }, { status: 502 });
    }

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const cd = r.headers.get('content-disposition') || '';

    // Guard: if Screener returns the HTML login page, sessionid is bad
    if (ct.includes('text/html')) {
      let preview = '';
      try { preview = (await r.text()).slice(0, 200); } catch {}
      const looksLikeLogin = preview.includes('Login') || preview.includes('Sign in') || preview.includes('csrftoken');
      return NextResponse.json({
        error: looksLikeLogin
          ? 'Screener.in returned the login page — your sessionid is invalid or expired.'
          : 'Screener.in returned HTML instead of CSV/Excel.',
        hint: 'Refresh the sessionid cookie. Open screener.in in Chrome (must be logged in) → DevTools → Application → Cookies → screener.in → copy sessionid value.',
        preview,
      }, { status: 401 });
    }

    const buf = await r.arrayBuffer();
    const ext = ct.includes('spreadsheet') || cd.toLowerCase().includes('.xlsx')
      ? 'xlsx'
      : (ct.includes('text/csv') || cd.toLowerCase().includes('.csv'))
      ? 'csv'
      : 'csv'; // default

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': ct || (ext === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv'),
        'Content-Disposition': `attachment; filename="${name}.${ext}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
