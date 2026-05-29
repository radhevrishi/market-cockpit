// PATCH 0985 — Railway self-fetch loopback helper (shared).
//
// On Railway, calling `fetch(<own public URL>)` from inside the container
// throws "fetch failed" almost immediately because the edge layer rejects
// the self-loop. Retry the same URL via 127.0.0.1:$PORT to bypass the edge.
//
// No-op on Vercel and local dev (public self-fetch already works there).
//
// USAGE:
//   import { railwaySelfFetch } from '@/lib/railway-self-fetch';
//   const res = await railwaySelfFetch(`${origin}/api/v1/something`, init);
//
// or:
//   await railwaySelfFetch(`${base}/api/...`, { cache: 'no-store' });
export async function railwaySelfFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: any) {
    const port = process.env.PORT;
    if (port && /^https?:\/\/[^/]+\//.test(url)) {
      const loop = url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`);
      try {
        // eslint-disable-next-line no-console
        console.log(`[railway-self-fetch] public URL failed (${err?.message}), retrying loopback: ${loop}`);
        return await fetch(loop, init);
      } catch (e2: any) {
        const merged = new Error(
          `railway-self-fetch failed both paths: public=${err?.message} loopback=${e2?.message}`,
        );
        throw merged;
      }
    }
    throw err;
  }
}
