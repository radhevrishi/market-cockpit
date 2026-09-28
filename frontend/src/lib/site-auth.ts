// ═══════════════════════════════════════════════════════════════════════════
// SITE AUTH — one owner, one password.                               (zzz778)
//
// Before this, anyone on the internet could read /api/v1/book/state (every
// holding, entry price, quantity and the Telegram chat id), read and OVERWRITE
// /api/portfolio and /api/v1/book/sync (the admin chat id — shipped in the
// client bundle — was a write bypass), and trigger paid AI reads.
//
// Now:
//   · every PAGE needs the owner's login cookie (→ /login otherwise);
//   · every PERSONAL-DATA or AI-SPENDING API needs the cookie OR a service
//     key (x-mc-key header or ?secret=) — GitHub Actions, the Cloudflare
//     worker and the app's own server-side self-fetches use the key;
//   · public market-data APIs stay open (the scheduled Claude briefs read
//     /api/v1/earnings/graded*).
//
// Edge-safe: Web Crypto only, no Node imports — middleware imports this.
// The cookie holds SHA-256("mc-site:v1:" + password), never the password;
// changing MC_SITE_PASSWORD on Railway logs every browser out.
// NOT SET → FAIL CLOSED: pages send you to /login, which says what to set.
// ═══════════════════════════════════════════════════════════════════════════

export const SITE_COOKIE = 'mc_site';
export const SITE_COOKIE_MAX_AGE_S = 180 * 24 * 3600;

/** Personal data or paid AI. Cookie or service key required. */
export const PROTECTED_API_PREFIXES = [
  '/api/portfolio',
  '/api/watchlist',
  '/api/v1/book/',
  '/api/v1/portfolio',
  '/api/v1/ai-gainers/research',
  '/api/v1/india/ai-summary',
  '/api/v1/haiku/',
  '/api/v1/special-focus',       // zzz780 — research memory
  '/api/v1/us-book',             // zzz790 — US book: holdings, cash, bench
  '/api/v1/catalyst/',            // zzz809 — filing reader (fetches documents; owner only)
  '/api/v1/us-thesis',           // zzz790 — US ledgers, reads (paid AI), special focus
] as const;

/** Never gated: the login flow itself, and machine endpoints with their own auth. */
export const PUBLIC_PAGE_PATHS = ['/login'];

export function isProtectedApi(path: string): boolean {
  return PROTECTED_API_PREFIXES.some((p) => p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`));
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sitePassword(): string | null {
  const p = process.env.MC_SITE_PASSWORD || '';
  return p.length >= 8 ? p : null;
}

export async function expectedToken(): Promise<string | null> {
  const p = sitePassword();
  return p ? sha256Hex(`mc-site:v1:${p}`) : null;
}

/** Constant-time string compare (length leaks only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Machine keys already configured on Railway. Short values are ignored. */
export function serviceKeys(): string[] {
  return [process.env.MC_API_KEY, process.env.CRON_SECRET, process.env.PROXY_SECRET, process.env.MC_BOT_SECRET]
    .filter((k): k is string => typeof k === 'string' && k.length >= 12);
}

export function hasServiceKey(provided: string | null | undefined): boolean {
  if (!provided) return false;
  return serviceKeys().some((k) => safeEqual(k, provided));
}
