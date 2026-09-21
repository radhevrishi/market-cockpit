// ═══════════════════════════════════════════════════════════════════════════
// FETCHING screener.in FROM A PLACE IT WILL ANSWER.                 (zzz729)
//
// Both screener.in features shipped this week — the India gainers screen and
// the company document list — were verified by fetching the page from the
// owner's Mac, where they work perfectly. Neither works in production:
//
//   screener.in from a residential IP   → HTTP 200, 41KB / 165KB
//   screener.in from Railway            → "fetch failed"
//   SEC EDGAR   from Railway            → HTTP 200, live, uncached
//
// So Railway's outbound HTTPS is fine and screener.in is refusing that IP
// range specifically, which is ordinary behaviour for a free service guarding
// itself against datacenter scraping. The verification was the error, not the
// parser: testing a fetch from the wrong network proves the parse and nothing
// about whether the feature runs.
//
// THE CHAIN, in order, with every hop reported:
//
//   1. A PROXY that screener.in does answer — a Cloudflare Worker, whose
//      egress screener.in permits (the existing `indiaearninghub` worker
//      already reads screener.in successfully today). Configured by env so no
//      code change is needed to enable it.
//   2. A DIRECT fetch. Works in development and on any host screener.in
//      accepts, and costs one failed connection where it does not.
//
// WHAT THIS FILE REFUSES TO DO: return an empty page as though it were an
// empty screen. Every failure carries the hops attempted and why each failed,
// because on this pipeline specifically a silent empty answer has been the
// single most repeated bug — four separate times in one day.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A worker or proxy that will fetch a screener.in URL on this server's behalf
 * and return the raw HTML. The URL is appended, encoded, to this value.
 *
 * Example (Cloudflare Worker route):
 *   SCREENER_PROXY_URL=https://<worker>.workers.dev/page?url=
 */
const PROXY = (process.env.SCREENER_PROXY_URL || '').trim();

/**
 * The repo's own proxy Worker, tried after the configured one.      (zzz732)
 *
 * SCREENER_PROXY_URL was set to the indiaearninghub Worker's `/page` route.
 * That Worker has no such route: it answered its own 266-byte index JSON to
 * every request, and all three screener.in features were dark for a day while
 * the env var looked correctly set. The contract had no implementation.
 *
 * `workers/mc-proxy` is that implementation, deployed by the deploy-workers
 * Action from this repo. It is tried as a SECOND hop rather than replacing the
 * configured one, so the chain heals itself whatever SCREENER_PROXY_URL
 * currently holds — a stale or wrong value costs one failed hop instead of the
 * whole feature, and the hop is named in the error either way.
 */
const FALLBACK_PROXY = 'https://mc-proxy.radhev-232.workers.dev/page?url=';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type ProxyHop = 'proxy' | 'mc-proxy' | 'direct';

export interface HtmlFetch {
  html: string | null;
  /** Which hop answered. Null when none did. */
  via: ProxyHop | null;
  /** Every hop tried and what it did. Never empty on failure. */
  attempts: Array<{ hop: string; outcome: string }>;
  error: string | null;
}

async function tryFetch(hop: ProxyHop, url: string, timeoutMs: number):
Promise<{ html: string | null; outcome: string }> {
  try {
    const r = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!r.ok) {
      // A proxy that refuses explains WHY in its body — the host it refused,
      // how long the upstream took, which Cloudflare colo served it. Reporting
      // only "HTTP 504" throws that away and leaves the next person guessing
      // at exactly the moment the answer was handed over. (zzz735)
      let why = '';
      try { why = (await r.text()).slice(0, 300); } catch { /* body is optional */ }
      return { html: null, outcome: `HTTP ${r.status}${why ? ` — ${why}` : ''}` };
    }
    const html = await r.text();
    // A proxy that answers 200 with an error page is worse than one that
    // fails: it looks like a successful read of an empty screen.
    if (html.length < 500) return { html: null, outcome: `answered ${html.length} bytes — too short to be a page` };
    return { html, outcome: `ok, ${html.length} bytes` };
  } catch (e: any) {
    const msg = String(e?.name === 'TimeoutError' ? 'timed out' : (e?.message || e));
    return { html: null, outcome: msg };
  }
}

/**
 * Fetch a screener.in page through whichever hop will answer.
 *
 * Only screener.in URLs are accepted. The proxy takes a URL as a parameter, so
 * without this guard a caller could aim it at anything reachable from the
 * worker — an SSRF hole opened for the convenience of one feature.
 */
export async function fetchScreenerHtml(url: string, timeoutMs = 20_000): Promise<HtmlFetch> {
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  if (!/(^|\.)screener\.in$/i.test(host)) {
    return {
      html: null, via: null, attempts: [],
      error: `refused: ${host || 'that URL'} is not screener.in. This fetcher is deliberately single-purpose.`,
    };
  }

  const attempts: HtmlFetch['attempts'] = [];

  if (PROXY) {
    const r = await tryFetch('proxy', `${PROXY}${encodeURIComponent(url)}`, timeoutMs);
    attempts.push({ hop: 'proxy', outcome: r.outcome });
    if (r.html) return { html: r.html, via: 'proxy', attempts, error: null };
  } else {
    attempts.push({ hop: 'proxy', outcome: 'not configured (SCREENER_PROXY_URL is unset)' });
  }

  // Skipped only when the configured proxy IS this one, so the same hop is
  // never tried twice and reported as two independent failures.
  if (!PROXY.startsWith(FALLBACK_PROXY.split('?')[0])) {
    const m = await tryFetch('mc-proxy', `${FALLBACK_PROXY}${encodeURIComponent(url)}`, timeoutMs);
    attempts.push({ hop: 'mc-proxy', outcome: m.outcome });
    if (m.html) return { html: m.html, via: 'mc-proxy', attempts, error: null };
  }

  const d = await tryFetch('direct', url, timeoutMs);
  attempts.push({ hop: 'direct', outcome: d.outcome });
  if (d.html) return { html: d.html, via: 'direct', attempts, error: null };

  return {
    html: null, via: null, attempts,
    error: `screener.in could not be read. ${attempts.map((a) => `${a.hop}: ${a.outcome}`).join('; ')}. `
      + 'Every hop failed — this is a network or upstream problem, not an empty screen. '
      + 'If the mc-proxy hop reports 404 or too-short, the deploy-workers Action has not '
      + 'published workers/mc-proxy yet.',
  };
}

/** True when a proxy hop exists at all. The repo's own Worker always counts,
 *  so this is no longer a question of whether one env var is set. */
export const screenerProxyConfigured = (): boolean => true;

/** What the chain will actually try, in order — for diagnostics panels. */
export const screenerProxyChain = (): string[] => [
  PROXY ? `configured: ${PROXY.split('?')[0]}` : 'configured: none (SCREENER_PROXY_URL unset)',
  `repo worker: ${FALLBACK_PROXY.split('?')[0]}`,
  'direct',
];
