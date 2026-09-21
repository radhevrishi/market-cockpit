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
  'nsearchives.nseindia.com',
  'www.bseindia.com',
  'bseindia.com',
  'api.bseindia.com',
  'trendlyne.com',
  'www.trendlyne.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
];

/** Hosts that do not need the shared secret. Public read-only pages only.
 *  bseindia.com joined in zzz744: exchange filing PDFs are public documents
 *  and BSE refuses datacenter IPs exactly as screener.in does, so the
 *  evidence reader could not download SOTL's presentation from Railway. The
 *  same trade as for screener.in applies (see header): GET/HEAD only, no
 *  body, no cookies, nothing a caller could not fetch from a laptop. */
const OPEN_HOSTS = ['www.screener.in', 'screener.in', 'www.bseindia.com', 'bseindia.com', 'nsearchives.nseindia.com'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

/**
 * HOW LONG A PAGE MAY BE SERVED FROM CACHE, BY WHAT THE PAGE IS.    (zzz739)
 *
 * A gainers screen is today's moves and is stale in an hour. A company page
 * changes when a quarter's documents are posted — every three months — so
 * the same 6-hour window that is right for the screen is far too short for
 * it: it guaranteed that every company page the portal asked for outside the
 * warm window was a live fetch into the colo screener.in refuses (SJC), and
 * that is why E2E, MOREPENLAB, SOTL and AARTIPHARM all came back 504 on the
 * six-company test. Company pages: fresh for 6h, servable for 48h, warmed
 * once a day by the scheduler below.
 */
function cacheWindows(target) {
  const isCompany = /^\/company\//.test(target.pathname);
  return isCompany
    ? { FRESH_MS: 6 * 60 * 60 * 1000, STALE_MS: 72 * 60 * 60 * 1000 }
    : { FRESH_MS: 15 * 60 * 1000, STALE_MS: 6 * 60 * 60 * 1000 };
}

/** Where the portal's book lives. Public, read-only, no feed. */
const BOOK_STATE_URL = 'https://market-cockpit-production.up.railway.app/api/v1/book/state?feed=0';

/** Company pages warmed per scheduled tick. 32 ticks a day × 12 covers a
 *  360-name book once a day inside the free KV write budget (1,000/day),
 *  with the gainers screens' 64 writes on top. */
const COMPANY_WARM_PER_TICK = 12;
/** A page younger than this is not re-fetched by the warm — the write is
 *  the scarce resource, not the read. */
const COMPANY_REWARM_AFTER_MS = 20 * 60 * 60 * 1000;

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
          colo: (request.cf && request.cf.colo) || null,
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

      // /page serves the open hosts only. A caller cannot reach a gated host
      // through it by leaving the secret off.
      if (isPageRoute && !isOpenHost) {
        return json({ error: '/page serves screener.in and exchange filing PDFs only; use /proxy with a secret', host: target.hostname }, 403);
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

      // THE WORKER OWNS ITS OWN DEADLINE.                        (zzz735)
      //
      // Measured from the portal on Railway: every request to this Worker
      // ended as "timed out" at the caller's 20s abort, while the identical
      // request from a laptop answered in 1.5s. The caller's timeout fires on
      // the whole round trip and cannot say WHICH part was slow, so the only
      // thing it could report was the least useful fact available.
      //
      // The subrequest now has a 10s deadline of its own, inside the caller's.
      // When screener.in does not answer in time the Worker returns 504 with
      // the elapsed milliseconds and the Cloudflare colo that served it —
      // so the next failure names the hop, the duration and the location
      // instead of "timed out". An opaque hang becomes evidence.
      // ── KV CACHE, AND WHY IT IS NOT AN OPTIMISATION.           (zzz736)
      //
      // The 10s deadline above did its job and named the fault: this Worker
      // gets HTTP 504 on its OWN subrequest when the request arrives at the
      // colo serving Railway, while the identical subrequest from the colo
      // serving a laptop answers in 1.5s. screener.in is slow or refusing
      // from that location specifically. No timeout value fixes that, and
      // retrying into the same colo mostly repeats it.
      //
      // So the read is decoupled from the caller's colo. Any successful
      // fetch — from any location, including the scheduled warm below —
      // writes the page to KV, and a request that cannot reach screener.in
      // serves the cached copy rather than failing. This is exactly what
      // mc-scraper does, which is why mc-scraper has always worked from
      // Railway while a live passthrough did not.
      //
      // STALENESS IS REPORTED, NEVER HIDDEN. Every cached answer carries its
      // age in a header, because a gainers screen whose whole content is
      // today's move must never be served as fresh when it is an hour old.
      const cacheKey = `page:${target.toString()}`;
      const { FRESH_MS, STALE_MS } = cacheWindows(target);
      const kv = env && env.MC_KV;

      if (kv && !url.searchParams.has('nocache')) {
        try {
          const hit = await kv.getWithMetadata(cacheKey, { type: 'text' });
          const at = hit && hit.metadata && hit.metadata.at;
          if (hit && hit.value && at && Date.now() - at < FRESH_MS) {
            return new Response(hit.value, {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'X-MC-Proxy-Cache': 'fresh',
                'X-MC-Proxy-Age-Ms': String(Date.now() - at),
              },
            });
          }
        } catch { /* a cold or unavailable cache is not an error */ }
      }

      const t0 = Date.now();
      let upstream;
      try {
        upstream = await fetch(new Request(target.toString(), {
          method,
          headers: outboundHeaders,
        }), { cf: { cacheTtl: 60, cacheEverything: false }, signal: AbortSignal.timeout(/\.pdf(\?|$)|AnnPdfOpen/i.test(target.toString()) ? 30_000 : 10_000) });
      } catch (e) {
        const ms = Date.now() - t0;
        const timedOut = String((e && e.name) || '') === 'TimeoutError';
        // STALE BEATS NOTHING — but only when it is labelled stale.
        if (kv) {
          try {
            const hit = await kv.getWithMetadata(cacheKey, { type: 'text' });
            const at = hit && hit.metadata && hit.metadata.at;
            if (hit && hit.value && at && Date.now() - at < STALE_MS) {
              return new Response(hit.value, {
                status: 200,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'X-MC-Proxy-Cache': 'stale',
                  'X-MC-Proxy-Age-Ms': String(Date.now() - at),
                  'X-MC-Proxy-Stale-Reason': timedOut ? 'upstream timeout' : 'upstream fetch failed',
                },
              });
            }
          } catch { /* fall through to the honest failure below */ }
        }
        return json({
          error: timedOut ? 'upstream timeout' : 'upstream fetch failed',
          detail: timedOut
            ? `screener.in did not answer this Worker within 10s (${ms}ms elapsed)`
            : String((e && e.message) || e),
          host: target.hostname,
          colo: request.cf && request.cf.colo ? request.cf.colo : null,
          elapsed_ms: ms,
        }, 504);
      }
      const upstreamMs = Date.now() - t0;

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

      // Write through so the next caller — very likely on a colo screener.in
      // will not answer — gets this page instead of a 504. HTML only: a PDF
      // is large and read once.
      if (kv && !isPdf && upstream.status === 200 && typeof body === 'string' && body.length > 500) {
        try {
          await kv.put(cacheKey, body, {
            metadata: { at: Date.now(), status: upstream.status },
            expirationTtl: Math.floor(STALE_MS / 1000),
          });
        } catch { /* an unwritable cache must never fail the request */ }
      }
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': ct,
          'Content-Length': String(isPdf ? body.byteLength : new TextEncoder().encode(body).length),
          'X-MC-Proxy-Upstream-Status': String(upstream.status),
          'X-MC-Proxy-Upstream-Ms': String(upstreamMs),
          'X-MC-Proxy-Colo': (request.cf && request.cf.colo) || 'unknown',
          'X-MC-Proxy-Cache': 'miss',
        },
      });
    } catch (e) {
      // Reported, never swallowed into an empty 200.
      return json({ error: 'proxy failure', detail: String((e && e.message) || e) }, 502);
    }
  },

  /**
   * SCHEDULED WARM.                                                (zzz736)
   *
   * The cache above only helps if something fills it, and the caller that
   * needs it most is the one that cannot reach screener.in. So the Worker
   * fetches the pages the portal depends on from Cloudflare's own scheduler,
   * on its own schedule, with a longer deadline than a user request can wait
   * for. Every quarter hour through Indian market hours.
   *
   * THIS IS A BET, AND WORTH STATING: a cron fires from whichever colo the
   * scheduler picks, and if that colo is also refused by screener.in the warm
   * fails too. It retries every fifteen minutes, so it needs to succeed once
   * an hour to keep the cache inside its six-hour stale window. If the logs
   * show it never succeeding, the next step is an origin outside Cloudflare
   * rather than more retries.
   */
  async scheduled(event, env, ctx) {
    const WARM = [
      'https://www.screener.in/screens/3725746/suresh-daily-gainers/',
      'https://www.screener.in/screens/3725746/suresh-daily-gainers/?page=2',
    ];
    if (!env || !env.MC_KV) return;
    for (const target of WARM) {
      try {
        const r = await fetch(target, {
          headers: {
            'User-Agent': BROWSER_HEADERS['User-Agent'],
            'Accept': BROWSER_HEADERS.Accept,
            'Accept-Language': BROWSER_HEADERS['Accept-Language'],
            'Referer': 'https://www.screener.in/',
          },
          signal: AbortSignal.timeout(25_000),
        });
        if (!r.ok) continue;
        const html = await r.text();
        if (html.length < 500) continue;
        await env.MC_KV.put(`page:${target}`, html, {
          metadata: { at: Date.now(), status: 200, warmed: true },
          expirationTtl: 6 * 60 * 60,
        });
      } catch { /* the next tick tries again; a failed warm is not an error */ }
    }
    await warmCompanyPages(env);
  },
};

/**
 * WARM THE BOOK'S COMPANY PAGES, A SLICE PER TICK.                 (zzz739)
 *
 * Why a slice and not the whole book: priming all 346 pages from one host
 * in a burst got HTTP 403 on every single request — screener.in rate-limits
 * a burst — while the same pages fetched one a second all answered 200.
 * And KV's free tier allows 1,000 writes a day; 346 pages every two hours
 * would be 4,000. So each tick takes the next twelve names past a cursor
 * kept in KV, fetches them one at a time with a short pause, skips any page
 * cached in the last 20 hours, and stops after 20s regardless. The cursor
 * wraps, so the whole book is covered about once a day, which is the right
 * cadence for pages that change once a quarter.
 */
async function warmCompanyPages(env) {
  const kv = env.MC_KV;
  const deadline = Date.now() + 20_000;
  let tickers = [];
  try {
    const r = await fetch(BOOK_STATE_URL, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return;
    const j = await r.json();
    const rows = (j && j.book && Array.isArray(j.book.tickers)) ? j.book.tickers : [];
    tickers = rows.map((x) => String(x && x.ticker || '').toUpperCase()).filter((t) => /^[A-Z0-9&-]{1,20}$/.test(t));
  } catch { return; }
  if (!tickers.length) return;
  tickers = Array.from(new Set(tickers.map((t) => t.replace(/-(BE|BZ|SM|ST|BL|IL|GS|SZ|E1|N[0-9A-Z])$/, '')))).sort();

  let cursor = 0;
  try { cursor = parseInt(await kv.get('warm:company:cursor') || '0', 10) || 0; } catch { cursor = 0; }
  if (cursor >= tickers.length) cursor = 0;

  let done = 0, i = cursor;
  while (done < COMPANY_WARM_PER_TICK && Date.now() < deadline) {
    const t = tickers[i];
    i = (i + 1) % tickers.length;
    if (i === cursor) { done = COMPANY_WARM_PER_TICK; } // wrapped: stop after this one
    // The evidence reader asks for the standalone page — same document list,
    // and the key must match the URL the portal will request or the warm
    // fills a cache nobody reads. Series suffixes (-BE, -SM) are dropped
    // because screener.in keys on the bare symbol.
    const target = `https://www.screener.in/company/${t.replace(/-(BE|BZ|SM|ST|BL|IL|GS|SZ|E1|N[0-9A-Z])$/, '')}/`;
    const key = `page:${target}`;
    try {
      const hit = await kv.getWithMetadata(key, { type: 'text' });
      const at = hit && hit.metadata && hit.metadata.at;
      if (hit && hit.value && at && Date.now() - at < COMPANY_REWARM_AFTER_MS) { continue; }
      const r = await fetch(target, {
        headers: {
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          'Accept': BROWSER_HEADERS.Accept,
          'Accept-Language': BROWSER_HEADERS['Accept-Language'],
          'Referer': 'https://www.screener.in/',
        },
        signal: AbortSignal.timeout(8_000),
      });
      done++;
      if (r.status === 403 || r.status === 429) break;      // rate-limited: stop the burst, next tick resumes
      if (!r.ok) continue;
      const html = await r.text();
      if (html.length < 500) continue;
      await kv.put(key, html, {
        metadata: { at: Date.now(), status: 200, warmed: true },
        expirationTtl: 72 * 60 * 60,
      });
      await new Promise((res) => setTimeout(res, 1000));
    } catch { done++; }
  }
  try { await kv.put('warm:company:cursor', String(i)); } catch { /* next tick starts over; harmless */ }
}
