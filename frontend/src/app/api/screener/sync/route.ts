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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionid: string = String(body.sessionid || '').trim();
    const screenId: string = String(body.screenId || '').trim();
    const rawName: string = String(body.name || `screener-${screenId}`).trim();
    const name = sanitizeFilename(rawName);

    if (!sessionid) {
      return NextResponse.json({ error: 'sessionid required',
        hint: 'Open screener.in in Chrome → DevTools → Application → Cookies → screener.in → copy the sessionid value' }, { status: 400 });
    }
    if (!screenId || !/^\d+$/.test(screenId)) {
      return NextResponse.json({ error: 'numeric screenId required',
        hint: 'Example: for https://www.screener.in/screens/3443614/fii/, screenId is 3443614' }, { status: 400 });
    }

    // Screener.in export endpoint. excel=1 triggers download.
    const url = `https://www.screener.in/screens/${screenId}/?source=&days=365&excel=1`;

    const r = await fetch(url, {
      headers: {
        Cookie: `sessionid=${sessionid}`,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: '*/*',
      },
      redirect: 'follow',
    });

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
