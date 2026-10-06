// zzz883 — "is this request from the owner?" for route handlers that are not under a protected prefix but have an owner-only switch.
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from './site-auth';

export async function siteAuthOk(req: Request): Promise<boolean> {
  const key = req.headers.get('x-mc-key') || req.headers.get('x-cron-secret') || '';
  if (key && hasServiceKey(key)) return true;
  const want = await expectedToken();
  if (!want) return false;
  const cookie = req.headers.get('cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${SITE_COOKIE}=([^;]+)`).exec(cookie);
  return !!m && safeEqual(decodeURIComponent(m[1]), want);
}
