// zzz778 — owner login. POST { password } → sets the HttpOnly site cookie.
import { NextRequest, NextResponse } from 'next/server';
import { SITE_COOKIE, SITE_COOKIE_MAX_AGE_S, sitePassword, expectedToken, safeEqual, sha256Hex } from '@/lib/site-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const pw = sitePassword();
  if (!pw) {
    return NextResponse.json({ ok: false, error: 'not_configured', message: 'MC_SITE_PASSWORD is not set on Railway (8+ characters). Set it under Variables; Railway redeploys, then log in.' }, { status: 503 });
  }
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const given = typeof body?.password === 'string' ? body.password : '';
  // Compare digests, not strings, so the length of the password never leaks.
  const ok = safeEqual(await sha256Hex(`cmp:${given}`), await sha256Hex(`cmp:${pw}`));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800));            // slows guessing on top of the 30/min/IP limit
    return NextResponse.json({ ok: false, error: 'wrong_password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_COOKIE, (await expectedToken())!, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SITE_COOKIE_MAX_AGE_S,
  });
  return res;
}
