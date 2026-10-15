// PostgreSQL connection (canonical earnings archive). Lazy + server-only so the
// pg driver's Node-core deps (net/tls/dns/fs) never enter the client bundle.
// zzz883: a plain import. The old webpack-only `__non_webpack_require__` trick broke under Next 16 / Turbopack (its require shim
// cannot find 'pg', so the pool silently became null). 'pg' is listed in serverExternalPackages, so it is loaded from
// node_modules at run time and never bundled; only server route handlers import this file.
import { Pool } from 'pg';
type PgPool = Pool;

export function dbAvailable(): boolean {
  return !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL);
}

export function getPool(): PgPool | null {
  if (typeof window !== 'undefined') return null;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
  if (!url) return null;
  const g = globalThis as any;
  if (g.__MC_PG_POOL__) return g.__MC_PG_POOL__ as PgPool;
  try {
    const pool: PgPool = new Pool({
      connectionString: url,
      // zzz1053 — one long-lived server: keep connections open between page loads (they were closed after 30 s idle, so most
      // visits paid a fresh connect + auth before the first query), TCP keep-alive so idle sockets are not dropped silently,
      // and a little more room (the home page fires several database-backed requests at once; the screener builds use some).
      max: 10,
      idleTimeoutMillis: 10 * 60_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      // Railway internal PG doesn't require TLS; public proxy does. Be permissive.
      ssl: /sslmode=require|proxy\.rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (e: any) => console.error('[DB] pool error:', e?.message || e));
    g.__MC_PG_POOL__ = pool;
    console.log('[DB] PostgreSQL pool created');
    // zzz1053 — open the first connection now, not inside the first request that needs it
    void pool.query('SELECT 1').catch(() => { /* the request that needs it will report the failure */ });
    return pool;
  } catch (e) {
    console.error('[DB] failed to init pool:', e);
    return null;
  }
}

export async function dbQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new Error('DB not configured');
  const res = await pool.query(text, params);
  return res.rows as T[];
}
