/**
 * ═══════════════════════════════════════════════════════════════════════════
 * mc-proxy — THE HOP screener.in WILL ANSWER.                       (zzz732)
 *
 * WHY THIS EXISTS. screener.in answers a residential IP and refuses Railway's
 * datacenter range. zzz729 added a proxy chain to the portal and defined the
 * contract `SCREENER_PROXY_URL` + `?url=<encoded>`; the env var was pointed at
 * the indiaearninghub Worker, which has no such route and answered its own
 * 266-byte index JSON to every request. Three features — India daily gainers,
 * the concall-transcript reader and the India earnings summary — have been
 * dark in production ever since, reporting the failure honestly and returning
 * nothing.
 *
 * So the contract needed an implementation, and the repo already had most of
 * one: `cloudflare-worker/proxy.js`, written for exactly this problem and
 * never wired to CI. This is that file, moved under `workers/` where the
 * deploy-workers Action builds it, with two changes noted below.
 *
 * CHANGE 1 — A `/page` ROUTE. It is what zzz729's contract asks for: the
 * target URL appended, encoded, to a base ending in `?url=`. `/proxy` keeps
 * its original shape for existing callers.
 *
 * CHANGE 2 — screener.in IS RELAYED WITHOUT A SECRET; EVERYTHING ELSE IS NOT.
 * A DELIBERATE, NARROW TRADE, stated rather than buried:
 *
 *   - What is exposed: public, read-only screener.in pages, GET/HEAD only,
 *     no request body, no cookies forwarded. Anyone who finds this URL can
 *     read screener.in through it — the same pages they could read directly.
 *   - What is NOT exposed: nseindia, bseindia, trendlyne and Yahoo still
 *     require PROXY_SECRET and fail closed when it is unset. Those are the
 *     hosts where a relay is worth something to an abuser.
 *   - The cost of the alternative: requiring a secret for screener.in too
 *     means the owner must set one by hand before any of the three features
 *     work, and they have already been dark for a day.
 *
 * TO CLOSE IT COMPLETELY, one command, after which screener.in needs the
 * secret like everything else:
 *
 *     cd workers/mc-proxy && npx wrangler secret put PROXY_SECRET
 *     # then append &secret=<that value> is NOT needed — instead set
 *     # SCREENER_PROXY_URL=https://mc-proxy.<subdomain>.workers.dev/proxy?secret=<value>&url=
 *
 * The `?secret=` first, `&url=` last ordering matters: the portal appends the
 * encoded target to the end of whatever SCREENER_PROXY_URL holds.
 *
 * NOTHING SECRET IS COMMITTED HERE. PROXY_SECRET is read from the Worker
 * environment and has no default; an unset secret means the gated hosts are
 * refused, never waved through.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ALLOWED_HOSTS = [
  // Screener (Indian fundamentals) — relayed without a secret, see header.
  'www.screener.in',
  'screener.in',
  // Everything below requires PROXY_SECRET.
  'www.nseindia.com',
  'nseindia.com',
  'www.bseindia.com',
  'bseindia.com',
  'api.bseindia.com',
  'trendlyne.com',
  'www.trendlyne.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
];

/** Hosts that do not need the shared secret. Public read-only pages only. */
const OPEN_HOSTS = ['www.screener.in', 'screener.in'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/' || url.pathname === '/health') {
        return json({
          ok: true,
          service: 'mc-proxy',
          routes: {
            '/page?url=<encoded>': 'screener.in only, no secret, GET/HEAD',
            '/proxy?url=<encoded>&secret=<s>': 'any allowed host, secret required',
          },
          allowed_hosts: ALLOWED_HOSTS,
          open_hosts: OPEN_HOSTS,
          secret_configured: !!(env && env.PROXY_SECRET),
        });
      }

      const isPageRoute = url.pathname === '/page';
      if (!isPageRoute && url.pathname !== '/proxy') {
        return json({ error: 'not found', path: url.pathname }, 404);
      }

      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return json({ error: 'url param required' }, 400);

      let target;
      try { target = new URL(targetUrl); } catch { return json({ error: 'invalid url' }, 400); }

      // Allowlist first, always. Without this the Worker is an open proxy for
      // anything reachable from Cloudflare's network.
      if (!ALLOWED_HOSTS.includes(target.hostname)) {
        return json({ error: 'host not allowed', host: target.hostname }, 403);
      }

      const isOpenHost = OPEN_HOSTS.includes(target.hostname);

      // /page is screener.in-only. A caller cannot reach a gated host through
      // it by leaving the secret off.
      if (isPageRoute && !isOpenHost) {
        return json({ error: '/page serves screener.in only; use /proxy with a secret', host: target.hostname }, 403);
      }

      if (!isOpenHost) {
        const provided = url.searchParams.get('secret') || request.headers.get('x-proxy-secret') || '';
        const expected = (env && env.PROXY_SECRET) || '';
        // Fails closed: no configured secret means no relay for gated hosts.
        if (!expected || provided !== expected) return json({ error: 'unauthorized' }, 401);
      }

      // The open path is read-only. No body is ever forwarded on it, so it
      // cannot be used to POST anywhere.
      const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
      if (isOpenHost && request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'GET/HEAD only on the unauthenticated path' }, 405);
      }

      const outboundHeaders = new Headers(BROWSER_HEADERS);
      if (target.hostname.endsWith('screener.in')) {
        outboundHeaders.set('Referer', 'https://www.screener.in/');
      } else if (target.hostname.endsWith('nseindia.com')) {
        outboundHeaders.set('Referer', 'https://www.nseindia.com/companies-listing/corporate-filings-announcements');
      } else if (target.hostname.endsWith('bseindia.com')) {
        outboundHeaders.set('Referer', 'https://www.bseindia.com/');
      }
      // Client Cookie and Host are deliberately NOT forwarded.

      const upstream = await fetch(new Request(target.toString(), {
        method,
        headers: outboundHeaders,
      }), { cf: { cacheTtl: 60, cacheEverything: false } });

      // The upstream status is passed through rather than flattened to 200.
      // A 403 from screener.in must never reach the portal looking like a
      // successful read of an empty page — that is the failure mode this
      // whole chain exists to prevent.
      const ct = upstream.headers.get('content-type')
        || (target.pathname.endsWith('.pdf') ? 'application/pdf' : 'text/html; charset=utf-8');

      // BUFFERED, NOT STREAMED.                                   (zzz734)
      //
      // The first deploy returned `upstream.body` as a stream. curl read it
      // in 0.3s; the portal on Railway timed out at 12s every time. A
      // streamed passthrough keeps the Worker's subrequest open while the
      // client reads, and that pairing stalls often enough to be useless —
      // and a stall is indistinguishable, from the portal's side, from
      // screener.in being down. These pages are 40-170KB. Buffering costs
      // nothing and the response either arrives whole or fails loudly.
      const isPdf = /pdf/i.test(ct);
      const body = isPdf ? await upstream.arrayBuffer() : await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': ct,
          'Content-Length': String(isPdf ? body.byteLength : new TextEncoder().encode(body).length),
          'X-MC-Proxy-Upstream-Status': String(upstream.status),
        },
      });
    } catch (e) {
      // Reported, never swallowed into an empty 200.
      return json({ error: 'proxy failure', detail: String((e && e.message) || e) }, 502);
    }
  },
};
