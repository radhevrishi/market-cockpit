/**
 * zzz1230 — the key-value store on the app's own PostgreSQL (replaces Upstash, which bills every command).
 *
 * The class answers the subset of the @upstash/redis client that lib/kv.ts uses (get / mget / set {ex, nx} / del /
 * incrbyfloat / expire / sadd / eval / exists), with the same value rules: a string is stored as it is, anything else as JSON;
 * a read gives back JSON when the text parses, else the text. A key past its expiry time is treated as absent; the
 * maintenance job (lib/kv-maintenance) deletes expired rows.
 *
 * eval: only the three scripts the app sends (versioned compare-and-set of personal state, AI budget reserve and settle)
 * are understood; they run inside one transaction holding advisory locks on their keys, so they stay atomic.
 *
 * Own small connection pool (KV_PG_POOL, default 6) so key-value traffic never starves the rest of the database work.
 */
import type { Pool, PoolClient } from 'pg';

export const KV_PG_DDL = [
  `CREATE TABLE IF NOT EXISTS kv_store (k text PRIMARY KEY, v text NOT NULL, exp timestamptz)`,
  `CREATE INDEX IF NOT EXISTS kv_store_exp ON kv_store (exp) WHERE exp IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS kv_set (k text NOT NULL, m text NOT NULL, exp timestamptz, PRIMARY KEY (k, m))`,
  `CREATE TABLE IF NOT EXISTS kv_meta (k text PRIMARY KEY, v jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
];

const LIVE = `(exp IS NULL OR exp > now())`;

/** Same rule as the Upstash client: strings as they are, everything else JSON. */
export function encodeValue(v: unknown): string { return typeof v === 'string' ? v : JSON.stringify(v); }
/** Same rule as the Upstash client: JSON when it parses, the text otherwise. */
export function decodeValue<T = any>(text: string | null | undefined): T | null {
  if (text === null || text === undefined) return null;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

export function pgUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL || null;
}

/** Which script lib/kv eval was given (they are matched by their text: the store cannot import ai-budget without a cycle). */
export function scriptKind(script: string): 'versioned' | 'reserve' | 'settle' | null {
  if (/cjson\.decode\(ARGV\[1\]\)/.test(script) && /Invalid next version/.test(script)) return 'versioned';
  if (/'cap'/.test(script) && /'store'/.test(script)) return 'reserve';
  if (/'done'/.test(script) && /SETTLE|return 1/.test(script)) return 'settle';
  return null;
}

type Tx = { get(k: string): Promise<string | null>; set(k: string, v: string, exS?: number | null): Promise<void> };

/** The Lua scripts' logic, in TypeScript over a locked transaction. Pure apart from the Tx it is given (unit-tested). */
export async function runScript(kind: 'versioned' | 'reserve' | 'settle', tx: Tx, keys: string[], args: Array<string | number>): Promise<unknown> {
  if (kind === 'versioned') {
    const raw = await tx.get(keys[0]);
    const next = JSON.parse(String(args[0]));
    const current = raw ? JSON.parse(raw) : null;
    if (current && current.hash === next.hash) return [2, raw];
    const version = current ? Number(current.version) || 0 : 0;
    if (Number(args[1]) !== version) return [0, raw || ''];
    if (Number(next.version) !== version + 1) throw new Error('Invalid next version');
    await tx.set(keys[0], String(args[0]), null);
    return [1, String(args[0])];
  }
  if (kind === 'reserve') {
    const spent = Math.max(Number(await tx.get(keys[0]) ?? '0') || 0, Number(args[0]));
    const reserved = Math.max(0, Number(await tx.get(keys[1]) ?? '0') || 0);
    const amount = Number(args[1]); const cap = Number(args[2]); const ttl = Number(args[3]);
    const existing = await tx.get(keys[2]);
    if (existing !== null) {
      if (amount > 0 && Number(existing) === amount) return ['ok', String(spent), String(reserved)];
      return ['store', String(spent), String(reserved)];
    }
    if (spent + reserved + amount > cap || (amount === 0 && spent + reserved >= cap)) return ['cap', String(spent), String(reserved)];
    if (amount > 0) {
      await tx.set(keys[0], String(spent), ttl);
      await tx.set(keys[1], String(reserved + amount), ttl);
      await tx.set(keys[2], String(amount), ttl);
    }
    return ['ok', String(spent), String(reserved + amount)];
  }
  // settle
  const entry = await tx.get(keys[2]);
  if (entry === null) return 0;
  if (entry === 'done') return 1;
  const amount = Number(entry);
  if (!Number.isFinite(amount)) return 0;
  const spent = Number(await tx.get(keys[0]) ?? '0') || 0;
  const reserved = Math.max(0, Number(await tx.get(keys[1]) ?? '0') || 0);
  const ttl = Number(args[1]);
  await tx.set(keys[0], String(spent + Number(args[0])), ttl);
  await tx.set(keys[1], String(Math.max(0, reserved - amount)), ttl);
  await tx.set(keys[2], 'done', ttl);
  return 1;
}

const expOf = (exS?: number | null): Date | null => (exS && exS > 0 ? new Date(Date.now() + exS * 1000) : null);

export class PgKv {
  private poolP: Promise<Pool> | null = null;
  private ready: Promise<void> | null = null;
  private url: string;
  constructor(url: string) { this.url = url; }
  /** 'pg' is loaded on first use (a server-only package; nothing imports it at module load). */
  private getPool(): Promise<Pool> {
    if (!this.poolP) this.poolP = this.makePool();
    return this.poolP;
  }
  private async makePool(): Promise<Pool> {
    // zzz1230: lib/kv reaches some client bundles through shared modules, so 'pg' must stay invisible to the bundler.
    // process.getBuiltinModule (Node ≥ 22.3) gives require without any import the bundler would follow; 'pg' is a
    // server-external package already shipped for lib/db.
    const { createRequire } = (process as any).getBuiltinModule('module') as typeof import('module');
    const { Pool } = createRequire(`${process.cwd()}/package.json`)('pg') as typeof import('pg');   // resolved from the app folder
    const url = this.url;
    const pool = new Pool({
      connectionString: url,
      max: Math.max(2, Number(process.env.KV_PG_POOL) || 6),
      idleTimeoutMillis: 10 * 60_000,
      keepAlive: true,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 20_000,
      ssl: /sslmode=require|proxy\.rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
    } as any);
    pool.on('error', (e: any) => console.error('[KV/pg] pool error:', e?.message || e));
    return pool;
  }
  ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => { const pool = await this.getPool(); for (const s of KV_PG_DDL) await pool.query(s); })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }
  private async q<T = any>(text: string, params: any[] = []): Promise<T[]> {
    await this.ensure();
    return (await (await this.getPool()).query(text, params)).rows as T[];
  }

  async getRaw(key: string): Promise<string | null> {
    const r = await this.q<{ v: string }>(`SELECT v FROM kv_store WHERE k = $1 AND ${LIVE}`, [key]);
    return r.length ? r[0].v : null;
  }
  async get<T = any>(key: string): Promise<T | null> { return decodeValue<T>(await this.getRaw(key)); }
  async mgetRaw(keys: string[]): Promise<Array<string | null>> {
    if (!keys.length) return [];
    const rows = await this.q<{ k: string; v: string }>(`SELECT k, v FROM kv_store WHERE k = ANY($1::text[]) AND ${LIVE}`, [keys]);
    const m = new Map(rows.map((r) => [r.k, r.v]));
    return keys.map((k) => m.get(k) ?? null);
  }
  async mget<T = any[]>(...keys: string[]): Promise<T> {
    return (await this.mgetRaw(keys)).map((t) => decodeValue(t)) as unknown as T;
  }
  /** Mirrors client.set(key, value, { ex, nx }). Returns 'OK' or null (NX lost). */
  async set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
    const v = encodeValue(value); const exp = expOf(opts?.ex);
    if (opts?.nx) {
      const r = await this.q(`INSERT INTO kv_store (k, v, exp) VALUES ($1, $2, $3)
        ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, exp = EXCLUDED.exp WHERE kv_store.exp IS NOT NULL AND kv_store.exp <= now()
        RETURNING k`, [key, v, exp]);
      return r.length ? 'OK' : null;
    }
    await this.q(`INSERT INTO kv_store (k, v, exp) VALUES ($1, $2, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, exp = EXCLUDED.exp`, [key, v, exp]);
    return 'OK';
  }
  /** Insert only when the key is absent (used when copying from Upstash: anything written here since is newer). */
  async setIfAbsent(key: string, raw: string, exp: Date | null): Promise<boolean> {
    const r = await this.q(`INSERT INTO kv_store (k, v, exp) VALUES ($1, $2, $3) ON CONFLICT (k) DO NOTHING RETURNING k`, [key, raw, exp]);
    return r.length > 0;
  }
  async del(...keys: string[]): Promise<number> {
    const r = await this.q(`DELETE FROM kv_store WHERE k = ANY($1::text[]) RETURNING k`, [keys]);
    await this.q(`DELETE FROM kv_set WHERE k = ANY($1::text[])`, [keys]);
    return r.length;
  }
  async expire(key: string, seconds: number): Promise<number> {
    const r = await this.q(`UPDATE kv_store SET exp = $2 WHERE k = $1 AND ${LIVE} RETURNING k`, [key, expOf(seconds)]);
    await this.q(`UPDATE kv_set SET exp = $2 WHERE k = $1`, [key, expOf(seconds)]);
    return r.length;
  }
  async incrbyfloat(key: string, by: number): Promise<number> {
    const r = await this.q<{ v: string }>(`INSERT INTO kv_store (k, v, exp) VALUES ($1, ($2::float8)::text, NULL)
      ON CONFLICT (k) DO UPDATE SET
        v = ((CASE WHEN kv_store.exp IS NOT NULL AND kv_store.exp <= now() THEN 0 ELSE kv_store.v::float8 END) + $2::float8)::text,
        exp = CASE WHEN kv_store.exp IS NOT NULL AND kv_store.exp <= now() THEN NULL ELSE kv_store.exp END
      RETURNING v`, [key, by]);
    return Number(r[0]?.v);
  }
  async sadd(key: string, member: string): Promise<number> {
    const r = await this.q(`INSERT INTO kv_set (k, m) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING m`, [key, member]);
    return r.length;
  }
  async existsMany(keys: string[]): Promise<boolean[]> {
    if (!keys.length) return [];
    const rows = await this.q<{ k: string }>(`SELECT k FROM kv_store WHERE k = ANY($1::text[]) AND ${LIVE}`, [keys]);
    const s = new Set(rows.map((r) => r.k));
    return keys.map((k) => s.has(k));
  }
  /** Runs one of the three known scripts atomically (advisory locks on its keys, in a fixed order). */
  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    const kind = scriptKind(script);
    if (!kind) throw new Error('kv-pg: unsupported script');
    await this.ensure();
    const c: PoolClient = await (await this.getPool()).connect();
    try {
      await c.query('BEGIN');
      for (const k of [...new Set(keys)].sort()) await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7))', [k]);
      const tx: Tx = {
        get: async (k) => { const r = await c.query(`SELECT v FROM kv_store WHERE k = $1 AND ${LIVE}`, [k]); return r.rows.length ? r.rows[0].v : null; },
        set: async (k, v, exS) => { await c.query(`INSERT INTO kv_store (k, v, exp) VALUES ($1, $2, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, exp = EXCLUDED.exp`, [k, v, expOf(exS)]); },
      };
      const out = await runScript(kind, tx, keys, args);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }
  async sweepExpired(limit = 5000): Promise<number> {
    const r = await this.q(`DELETE FROM kv_store WHERE k IN (SELECT k FROM kv_store WHERE exp IS NOT NULL AND exp <= now() LIMIT $1) RETURNING k`, [limit]);
    await this.q(`DELETE FROM kv_set WHERE exp IS NOT NULL AND exp <= now()`);
    return r.length;
  }
  async metaGet<T = any>(k: string): Promise<T | null> {
    const r = await this.q<{ v: T }>(`SELECT v FROM kv_meta WHERE k = $1`, [k]);
    return r.length ? r[0].v : null;
  }
  async metaSet(k: string, v: unknown): Promise<void> {
    await this.q(`INSERT INTO kv_meta (k, v, at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, at = now()`, [k, JSON.stringify(v)]);
  }
  async stats(): Promise<{ keys: number; mb: number; dbMb: number }> {
    const [a] = await this.q<{ n: string; b: string; d: string }>(`SELECT
      (SELECT count(*) FROM kv_store)::text AS n,
      pg_total_relation_size('kv_store')::text AS b,
      pg_database_size(current_database())::text AS d`);
    return { keys: Number(a?.n || 0), mb: Math.round(Number(a?.b || 0) / 1048576), dbMb: Math.round(Number(a?.d || 0) / 1048576) };
  }
}

let shared: PgKv | null = null;
export function pgKv(): PgKv | null {
  const g = globalThis as any;
  if (g.__MC_PG_KV__) return g.__MC_PG_KV__ as PgKv;
  const url = pgUrl();
  if (!url || typeof window !== 'undefined') return null;
  try { shared = new PgKv(url); g.__MC_PG_KV__ = shared; return shared; } catch (e) { console.error('[KV/pg] init failed', e); return null; }
}
