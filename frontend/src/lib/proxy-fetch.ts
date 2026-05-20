// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0518 — Proxy-fetch helper.
//
// When PROXY_URL + PROXY_SECRET are set in env, routes outbound requests
// through a Cloudflare Worker proxy (see cloudflare-worker/ at repo root).
// Falls back to direct fetch if env vars unset — transparent to callers.
//
// Use this for hosts that Cloudflare-block Vercel egress IPs:
//   - Screener.in (primary motivation)
//   - NSE corp-announcements (rate-limited on weekends)
//   - BSE corp-announcements (occasional blocks)
//
// Yahoo Finance does NOT need this (already works from Vercel).
//
// USAGE:
//   import { proxiedFetch } from '@/lib/proxy-fetch';
//   const res = await proxiedFetch('https://www.screener.in/company/RELIANCE/');
// ═══════════════════════════════════════════════════════════════════════════

const PROXIED_HOSTS = [
  'www.screener.in',
  'screener.in',
  'www.nseindia.com',
  'nseindia.com',
  'www.bseindia.com',
  'bseindia.com',
  'api.bseindia.com',
  'trendlyne.com',
  'www.trendlyne.com',
];

function shouldProxy(targetUrl: string): boolean {
  const proxyUrl = process.env.PROXY_URL;
  const proxySecret = process.env.PROXY_SECRET;
  if (!proxyUrl || !proxySecret) return false;
  try {
    const u = new URL(targetUrl);
    return PROXIED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function buildProxyUrl(targetUrl: string): string {
  const proxyUrl = process.env.PROXY_URL!;
  const proxySecret = process.env.PROXY_SECRET!;
  const base = proxyUrl.replace(/\/$/, '');
  return `${base}/proxy?url=${encodeURIComponent(targetUrl)}&secret=${encodeURIComponent(proxySecret)}`;
}

/**
 * Fetch wrapper that routes through Cloudflare Worker proxy for blocked hosts.
 * Drop-in replacement for the global fetch() — same signature.
 *
 * If proxy env vars are unset, OR target host is not in PROXIED_HOSTS,
 * passes through to direct fetch unchanged.
 */
export async function proxiedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const targetUrl = typeof input === 'string' ? input :
                    input instanceof URL ? input.toString() :
                    input.url;

  if (!shouldProxy(targetUrl)) {
    return fetch(input, init);
  }

  const proxyUrl = buildProxyUrl(targetUrl);
  return fetch(proxyUrl, init);
}

/**
 * Returns true if proxy env vars are configured. Useful for logging /
 * status pages so the operator can verify proxy is active.
 */
export function isProxyConfigured(): boolean {
  return !!(process.env.PROXY_URL && process.env.PROXY_SECRET);
}
