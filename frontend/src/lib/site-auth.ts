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
  '/api/v1/nse-results',         // zzz875 — NSE financial-results list written by the GitHub collector
  '/api/v1/guidance-requests',   // zzz865 — owner's read-first company list (writes)
  '/api/v1/special-focus',       // zzz780 — research memory
  '/api/v1/us-book',             // zzz790 — US book: holdings, cash, bench
  '/api/v1/catalyst/',            // zzz809 — filing reader (fetches documents; owner only); zzz825 us-filings (SEC lists)
  '/api/v1/us-thesis',           // zzz790 — US ledgers, reads (paid AI), special focus
  '/api/v1/thesis-ai',           // zzz837 — AI thesis-type resolver (paid AI, owner only)
  '/api/v1/ai-verify',           // zzz854 — AI verification queue (paid AI; cron uses the x-cron-secret header)
  '/api/v1/guidance-docs',       // zzz857 — company guidance documents (collector ingest uses the x-cron-secret header)
  '/api/v1/results-pdf',         // zzz879 — India results PDF backup (paid AI; cron uses the x-cron-secret header)
  '/api/v1/guidance-extract',    // zzz857 — AI guidance extractor (paid AI; cron uses the x-cron-secret header)
  // zzz882 security audit: paid-AI and job-starting routes that were open to anyone
  '/api/v1/us/ai-summary',       // paid AI + fetches a filing URL
  '/api/v1/ai/desk',             // paid AI (score-ai-ledger cron sends x-cron-secret)
  '/api/v1/ai-gainers',          // paid AI (daily-research sends x-mc-key)
  '/api/v1/cron/trigger-screener-sync',   // starts a GitHub workflow
  '/api/v1/user-state',          // zzz883 — the owner's personal data (book, decisions, theses, ledgers)
  '/api/v1/intel-archive',       // zzz883 — writes events / AI extractions to Postgres
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
