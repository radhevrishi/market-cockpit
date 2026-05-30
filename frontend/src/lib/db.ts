// PostgreSQL connection (canonical earnings archive). Lazy + server-only so the
// pg driver's Node-core deps (net/tls/dns/fs) never enter the client bundle.
import type { Pool as PgPool } from 'pg';

declare const __non_webpack_require__: NodeRequire | undefined;

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
    const req: NodeRequire = (typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require) as NodeRequire;
    const mod: any = req('pg');
    const Pool = mod.Pool || (mod.default && mod.default.Pool);
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
