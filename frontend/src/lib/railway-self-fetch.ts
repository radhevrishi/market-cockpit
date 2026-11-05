// PATCH: Use localhost first for calls to this Railway service itself.
// Railway's public edge occasionally stalls or rejects self-calls. Falling back
// only after that failure wasted the timeout budget of live dashboard routes.
// External origins are never rewritten (including non-Railway custom hosts).
function localUrl(url: string): string | null {
  const port = process.env.PORT;
  if (!port || !/^\d+$/.test(port)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const configured = [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_API_URL]
      .filter((v): v is string => !!v)
      .flatMap((v) => { try { return [new URL(v.includes('://') ? v : 'https://' + v).host.toLowerCase()]; } catch { return []; } });
    const host = u.host.toLowerCase();
    if (!u.hostname.toLowerCase().endsWith('.up.railway.app') && !configured.includes(host)) return null;
    return `http://127.0.0.1:${port}${u.pathname}${u.search}${u.hash}`;
  } catch { return null; }
}

export async function railwaySelfFetch(url: string, init?: RequestInit): Promise<Response> {
  const loop = localUrl(url);
  if (loop) {
    try {
      return await fetch(loop, init);
    } catch (err: any) {
      // An aborted caller does not benefit from retrying on the public edge.
      if (init?.signal?.aborted) throw err;
      console.warn(`[railway-self-fetch] loopback failed (${err?.message || 'unknown'}); using public URL`);
      return fetch(url, init);
    }
  }
  // Non-self or non-Railway URLs retain their original behavior.
  return fetch(url, init);
}
