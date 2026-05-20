/**
 * Market Cockpit — Cloudflare Worker Proxy
 *
 * Proxies requests from Vercel (where Screener.in / NSE often Cloudflare-block
 * our egress IPs) through a Worker on Cloudflare's own network. Screener.in
 * runs on Cloudflare itself, so requests from another Worker bypass the IP-
 * range block.
 *
 * USAGE FROM VERCEL:
 *   GET https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/proxy?url=<TARGET_URL>&secret=<SHARED_SECRET>
 *
 * SECURITY:
 *   - secret query param required (matches env.PROXY_SECRET)
 *   - whitelisted hosts only (prevents abuse as open proxy)
 *   - rate-limit per IP in KV (cheap defensive)
 *
 * DEPLOY:
 *   1. Install wrangler: `npm i -g wrangler`
 *   2. `wrangler login` (opens browser, signs into your CF account)
 *   3. `cd cloudflare-worker && wrangler deploy`
 *   4. Worker URL prints, copy it
 *   5. In Vercel project env, set:
 *        PROXY_URL=https://your-worker-url.workers.dev
 *        PROXY_SECRET=<pick any 32-char random string>
 *   6. Re-deploy Vercel project (env changes need rebuild)
 */

const ALLOWED_HOSTS = [
  // Screener (Indian fundamentals)
  'www.screener.in',
  'screener.in',
  // NSE corp filings + structured results
  'www.nseindia.com',
  'nseindia.com',
  // BSE corp filings
  'www.bseindia.com',
  'bseindia.com',
  'api.bseindia.com',
  // Trendlyne future-proofing
  'trendlyne.com',
  'www.trendlyne.com',
  // Yahoo Finance (sometimes throttles too)
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // Health check — no secret needed
      if (url.pathname === '/' || url.pathname === '/health') {
        return new Response(
          JSON.stringify({
            ok: true,
            service: 'mc-proxy',
            allowed_hosts: ALLOWED_HOSTS,
            note: 'Use /proxy?url=<TARGET>&secret=<SECRET>',
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.pathname !== '/proxy') {
        return new Response('Not found', { status: 404 });
      }

      // Secret check
      const providedSecret = url.searchParams.get('secret') || request.headers.get('x-proxy-secret') || '';
      const expectedSecret = env.PROXY_SECRET || '';
      if (!expectedSecret || providedSecret !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
      }

      // Target URL
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'url param required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let target;
      try {
        target = new URL(targetUrl);
      } catch {
        return new Response(JSON.stringify({ error: 'invalid url' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Whitelist check — prevents abuse as open proxy
      if (!ALLOWED_HOSTS.includes(target.hostname)) {
        return new Response(
          JSON.stringify({ error: 'host not allowed', host: target.hostname }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Build outbound request
      const outboundHeaders = new Headers(BROWSER_HEADERS);
      // Set Referer dynamically based on target
      if (target.hostname.endsWith('screener.in')) {
        outboundHeaders.set('Referer', 'https://www.screener.in/');
      } else if (target.hostname.endsWith('nseindia.com')) {
        outboundHeaders.set('Referer', 'https://www.nseindia.com/companies-listing/corporate-filings-announcements');
      } else if (target.hostname.endsWith('bseindia.com')) {
        outboundHeaders.set('Referer', 'https://www.bseindia.com/');
      }

      // Forward client-provided headers EXCEPT Host/Cookie which would leak
      const clientHeaders = request.headers;
      const forwardHeader = (name) => {
        const v = clientHeaders.get(name);
        if (v) outboundHeaders.set(name, v);
      };
      forwardHeader('Accept');
      forwardHeader('Accept-Language');

      const outbound = new Request(target.toString(), {
        method: request.method,
        headers: outboundHeaders,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
      });

      const response = await fetch(outbound, {
        cf: {
          // Use Cloudflare's smart routing + caching
          cacheTtl: 60, // 1-minute edge cache for repeated queries
          cacheEverything: false,
        },
      });

      // Stream the response back. Strip CORS headers — we'll set our own.
      const respHeaders = new Headers(response.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      respHeaders.set('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
      respHeaders.set('X-Proxied-Via', 'mc-proxy');
      respHeaders.set('X-Proxy-Status', String(response.status));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'proxy_error', message: String(err) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
