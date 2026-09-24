// zzz778 — clears the site cookie on this browser.
import { NextResponse } from 'next/server';
import { SITE_COOKIE } from '@/lib/site-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
