// zzz796 — a short id for the running deploy. The service worker is registered
// as /sw.js?v=<this>, so every deploy installs a fresh worker (and the app can
// offer "Update available — tap to reload"). Server-only: reads env / disk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

export function pwaBuildVersion(): string {
  if (cached) return cached;
  const fromEnv =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    '';
  let v = fromEnv;
  if (!v) {
    try { v = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8'); } catch { v = ''; }
  }
  v = (v || 'dev').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || 'dev';
  cached = v;
  return v;
}
