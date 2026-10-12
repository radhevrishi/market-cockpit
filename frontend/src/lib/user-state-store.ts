// zzz883 — the owner's personal data, kept on the server (Rishi: "protect my data"; the audit found decisions, theses, ledgers and
// saved valuations lived ONLY in one browser, and the server book copy expired after 60 days).
//
// Store: Postgres `user_state` (current value + version) and `user_state_history` (every saved version, last 60 kept per key).
// Mirror: Redis `user-state:v1:<key>` with NO expiry, so the data survives even when Postgres is down.
// Personal data never goes in source code or logs: values are only read/written through the protected /api/v1/user-state route.
import { createHash } from 'node:crypto';
import { getPool } from './db';
import { ensureSchema } from './db-migrate';
import { kvGet, kvGetDurable, kvSet, kvSetVersioned } from './kv';
import { US_BOOK_KEY, US_BOOK_OWNER } from './us-book-store';
import type { UsBook } from './us-book/model';

/** The browser keys that hold personal data. Anything else is refused (no arbitrary storage). */
export const USER_STATE_KEYS = [
  'mc:decisions:v1', 'mc:thesis:v1', 'mc:coffeecan:v1', 'mc:mb-ledger:v1', 'mc:mb-tags:v1', 'mc:signal-log:v1',
  'mc:saved-valuations:v1', 'mc:book-flags:v1', 'mc_portfolio_holdings', 'mc_watchlist_tickers',
  'mc:conviction-beats:v1', 'mc:conviction-beats-us:v1', 'mc:saved-views:v1', 'mc:news-alerts:v1', 'mc:notes:bundle',
  'mc:chart-drawings:v1', 'mc:chart-settings:v1',   // zzz937 — /charts
  'mc:chart-watchlists:v1',                         // zzz940 — /charts watchlist panel
  'mc:chart-layouts:v1',                            // zzz944 — /charts named layouts
  'mc:stock-screens:v1',   // zzz938 — saved stock screens
  'mc:pine-screens:v1',    // zzz983 — saved Pine screens (chart-pattern screens)
  'mc:screen-shortlists:v1', 'mc:chart-drawing-sets:v1', 'mc:screen-review:v1',   // zzz969 — saved screener shortlists; named drawing sets per chart
] as const;
export type UserStateKey = (typeof USER_STATE_KEYS)[number];
export const MAX_VALUE_BYTES = 3_000_000;
const HISTORY_KEEP = 60;
const kvKey = (k: string) => `user-state:v1:${k}`;

export function isUserStateKey(k: unknown): k is UserStateKey { return typeof k === 'string' && (USER_STATE_KEYS as readonly string[]).includes(k); }
/** zzz883: canonical JSON (object keys sorted) — Postgres JSONB re-orders keys, so a plain JSON.stringify hash would not survive a round trip. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export function hashOf(v: unknown): string { return createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 24); }

export interface UserStateRow { key: string; value: unknown; hash: string; version: number; updatedAt: string; device?: string | null }
export interface UserStateMeta { key: string; hash: string; version: number; updatedAt: string; bytes: number }
export class UserStateConflict extends Error {
  constructor(public version: number, public hash: string) { super('Another device saved a newer version; local changes were not overwritten'); }
}

async function pgOk(): Promise<boolean> { return getPool() ? ensureSchema() : false; }

export async function listUserState(): Promise<{ store: 'postgres' | 'redis'; keys: UserStateMeta[] }> {
  if (await pgOk()) {
    const rows = (await getPool()!.query('SELECT key, value, version, bytes, updated_at FROM user_state ORDER BY key')).rows;
    // the hash is recomputed from the stored value (canonical JSON), so it always describes exactly what is stored
    return { store: 'postgres', keys: rows.map((r: any) => ({ key: r.key, hash: hashOf(r.value), version: Number(r.version), bytes: Number(r.bytes), updatedAt: new Date(r.updated_at).toISOString() })) };
  }
  const out: UserStateMeta[] = [];
  for (const k of USER_STATE_KEYS) {
    const r = await kvGet<UserStateRow>(kvKey(k)).catch(() => null);
    if (r) out.push({ key: k, hash: r.hash, version: r.version, updatedAt: r.updatedAt, bytes: JSON.stringify(r.value).length });
  }
  return { store: 'redis', keys: out };
}

export async function getUserState(key: UserStateKey): Promise<UserStateRow | null> {
  if (await pgOk()) {
    const r = (await getPool()!.query('SELECT key, value, hash, version, device, updated_at FROM user_state WHERE key = $1', [key])).rows[0];
    if (r) return { key: r.key, value: r.value, hash: hashOf(r.value), version: Number(r.version), device: r.device, updatedAt: new Date(r.updated_at).toISOString() };
  }
  return (await kvGet<UserStateRow>(kvKey(key)).catch(() => null)) || null;
}

/**
 * Saves a value. `baseVersion` is the version the device last saw: if the server already moved past it (another device saved),
 * a different value requires the exact current version. Same hash = safe no-op.
 */
export async function putUserState(key: UserStateKey, value: unknown, opts: { baseVersion?: number | null; device?: string | null } = {}): Promise<{ ok: boolean; version: number; hash: string; conflict: boolean; store: string; unchanged?: boolean }> {
  const json = JSON.stringify(value ?? null);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_VALUE_BYTES) throw new Error(`value too large (${bytes} bytes, max ${MAX_VALUE_BYTES})`);
  const hash = hashOf(value);
  const device = opts.device ? String(opts.device).slice(0, 40) : null;
  let version = 1; let conflict = false; let store = 'redis'; let unchanged = false;
  if (await pgOk()) {
    const pool = getPool()!; const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Row locks cannot serialize two inserts when no row exists yet.
      await c.query('SELECT pg_advisory_xact_lock(883, hashtext($1))', [key]);
      const cur = (await c.query('SELECT hash, version FROM user_state WHERE key = $1 FOR UPDATE', [key])).rows[0];
      if (cur && cur.hash === hash) { await c.query('COMMIT'); return { ok: true, version: Number(cur.version), hash, conflict: false, store: 'postgres', unchanged: true }; }
      version = cur ? Number(cur.version) + 1 : 1;
      if ((opts.baseVersion ?? 0) !== Number(cur?.version ?? 0)) throw new UserStateConflict(Number(cur?.version ?? 0), cur?.hash ?? '');
      await c.query(`INSERT INTO user_state (key, value, hash, version, bytes, device, updated_at) VALUES ($1, $2::jsonb, $3, $4, $5, $6, now())
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, hash = EXCLUDED.hash, version = EXCLUDED.version, bytes = EXCLUDED.bytes, device = EXCLUDED.device, updated_at = now()`,
        [key, json, hash, version, bytes, device]);
      await c.query('INSERT INTO user_state_history (key, value, hash, version, device) VALUES ($1, $2::jsonb, $3, $4, $5)', [key, json, hash, version, device]);
      await c.query(`DELETE FROM user_state_history WHERE key = $1 AND id NOT IN (SELECT id FROM user_state_history WHERE key = $1 ORDER BY saved_at DESC LIMIT ${HISTORY_KEEP})`, [key]);
      await c.query('COMMIT');
      store = 'postgres';
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  } else {
    const row = { key, value, hash, version, device, updatedAt: new Date().toISOString() } satisfies UserStateRow;
    const result = await kvSetVersioned(kvKey(key), row, opts.baseVersion);
    if (!result.ok) throw new UserStateConflict(result.row?.version ?? 0, result.row?.hash ?? '');
    return { ok: true, version: result.row!.version, hash, conflict: false, store, unchanged: result.unchanged };
  }
  // the Redis mirror never expires (it is the fallback copy, not a cache)
  // no TTL: KV mirror of the user's personal data (Postgres is the record of truth; this copy must not vanish either)
  const row = { key, value, hash, version, device, updatedAt: new Date().toISOString() } satisfies UserStateRow;
  if (store === 'postgres') await kvSet(kvKey(key), row).catch(() => {});
  return { ok: true, version, hash, conflict, store, unchanged };
}

export async function userStateHistory(key: UserStateKey, limit = 20): Promise<Array<{ version: number; hash: string; savedAt: string; device: string | null; bytes: number }>> {
  if (!(await pgOk())) return [];
  const rows = (await getPool()!.query('SELECT version, hash, device, saved_at, length(value::text) AS bytes FROM user_state_history WHERE key = $1 ORDER BY saved_at DESC LIMIT $2', [key, Math.min(60, Math.max(1, limit))])).rows;
  return rows.map((r: any) => ({ version: Number(r.version), hash: r.hash, savedAt: new Date(r.saved_at).toISOString(), device: r.device, bytes: Number(r.bytes) }));
}

/** Full export for the nightly off-site backup (protected route only). */
export async function exportUserState() {
  const items: UserStateRow[] = [];
  const postgres = await pgOk();
  if (postgres) {
    // One statement: a consistent snapshot, unaffected by concurrent device saves.
    const rows = (await getPool()!.query('SELECT key, value, version, device, updated_at FROM user_state WHERE key = ANY($1::text[]) ORDER BY key', [USER_STATE_KEYS])).rows;
    for (const r of rows) items.push({ key: r.key, value: r.value, hash: hashOf(r.value), version: Number(r.version), device: r.device, updatedAt: new Date(r.updated_at).toISOString() });
  } else {
    for (const k of USER_STATE_KEYS) { const r = await kvGetDurable<UserStateRow>(kvKey(k)); if (r) items.push(r); }
  }
  const key = US_BOOK_KEY(US_BOOK_OWNER);
  const value = await kvGetDurable<UsBook>(key);
  return { formatVersion: 2, exportedAt: new Date().toISOString(), store: postgres ? 'postgres' : 'redis', items, usBook: { key, value, hash: hashOf(value) } };
}
