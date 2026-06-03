// PATCH 1013 — Internal origin resolver for Railway self-fetches.
//
// Background: several API routes self-fetch sibling routes for compute/probe/
// fan-out (system-status, super-investor-flow, intelligence). On Vercel the
// pattern `fetch(new URL('/api/foo', request.url))` works because Vercel's
// edge can reach its own public hostname from inside the function. On Railway
// the container can't resolve its own *.up.railway.app domain — every self-
// fetch fails immediately ("fetch failed" in ~15ms). Result: probes report
// DOWN for working endpoints, compute crons silently never run, fan-out
// returns empty.
//
// Fix: detect Railway runtime via env vars Railway always sets, and use
// http://127.0.0.1:PORT for self-fetches. On Vercel/dev we keep the request
// origin.
export function internalBase(request: Request): string {
  if (process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_PROJECT_ID) {
    const port = process.env.PORT || '3000';
    return `http://127.0.0.1:${port}`;
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return `http://127.0.0.1:${process.env.PORT || '3000'}`;
  }
}

// Convenience: build an absolute URL from a relative path using the internal base.
export function internalUrl(request: Request, path: string): string {
  const base = internalBase(request);
  if (path.startsWith('/')) return base + path;
  return new URL(path, base).toString();
}
