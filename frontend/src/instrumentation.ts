// zzz778 — server-side self-fetches carry the service key.
//
// Several routes call the app's own APIs over HTTP (data-watch → portfolio
// evidence, the Telegram bot → watchlist / portfolio, guidance ingest →
// portfolio). Those calls carry no login cookie, so once personal-data APIs
// needed one they would 401. This adds `x-mc-key` to server-side fetches
// that go to THIS app's own host and a protected path — never to any other
// host, so the key cannot leak to a third party.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { isProtectedApi, serviceKeys } = await import('./lib/site-auth');
  const key = serviceKeys()[0];
  if (!key) return;
  const own = new Set(
    [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_PRIVATE_DOMAIN, process.env.CRON_BASE_URL, process.env.NEXT_PUBLIC_BASE_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.API_BASE,
      'market-cockpit-production.up.railway.app', 'localhost', '127.0.0.1', '0.0.0.0']
      .filter(Boolean)
      .map((h) => { try { return new URL(String(h).includes('://') ? String(h) : `https://${h}`).hostname; } catch { return String(h); } }),
  );
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (url && /^https?:\/\//i.test(url)) {
        const u = new URL(url);
        const isOwn = own.has(u.hostname) || u.hostname.endsWith('.railway.internal');
        // zzz883 security: a call to THIS app that carries ?secret= gets it moved into the x-cron-secret header, so the secret
        // never appears in a URL (access logs). Only for this app's own host; other hosts are never touched.
        if (isOwn && u.searchParams.has('secret')) {
          const sec = u.searchParams.get('secret') || '';
          u.searchParams.delete('secret');
          const headers = new Headers(init?.headers || (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined));
          if (sec && !headers.has('x-cron-secret')) headers.set('x-cron-secret', sec);
          if (isProtectedApi(u.pathname) && !headers.has('x-mc-key')) headers.set('x-mc-key', key);
          const req2 = typeof input === 'object' && !(input instanceof URL) ? { method: input.method, body: (input as any).body } : {};
          return orig(u.toString(), { ...req2, ...(init || {}), headers });
        }
        if (isOwn && isProtectedApi(u.pathname)) {
          const headers = new Headers(init?.headers || (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined));
          if (!headers.has('x-mc-key')) headers.set('x-mc-key', key);
          return orig(input, { ...(init || {}), headers });
        }
      }
    } catch { /* fall through to the untouched call */ }
    return orig(input, init);
  }) as typeof fetch;
}
