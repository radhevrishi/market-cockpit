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
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      // Railway internal PG doesn't require TLS; public proxy does. Be permissive.
      ssl: /sslmode=require|proxy\.rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (e: any) => console.error('[DB] pool error:', e?.message || e));
    g.__MC_PG_POOL__ = pool;
    console.log('[DB] PostgreSQL pool created');
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
