// Shared PostgreSQL lease across web/Actions processes. Publication uses the SAME connection that owns the lease:
// losing that connection must never let an obsolete builder publish after another process has taken over.
import { AsyncLocalStorage } from 'node:async_hooks';
import { getPool, dbQuery } from '../db';
import type { ScreenMarket } from './types';

export interface LeaseClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
  on(event: 'error', cb: (error: Error) => void): unknown;
  removeListener(event: 'error', cb: (error: Error) => void): unknown;
  release(destroy?: boolean): void;
}
interface LeaseContext { client: LeaseClient; lost: boolean }
const G = globalThis as any;
const context: AsyncLocalStorage<LeaseContext> = G.__mcScreenerBuildLease || (G.__mcScreenerBuildLease = new AsyncLocalStorage<LeaseContext>());
export const buildLockKey = (m: ScreenMarket): [number, number] => [1296257874, m === 'IN' ? 1 : 2];

export async function withBuildLease<T>(m: ScreenMarket, build: () => Promise<T>, busy: () => T, pool: { connect(): Promise<LeaseClient> } | null = getPool()): Promise<T> {
  if (!pool) return build(); // the builder's existing missing-database result stays intact
  const client = await pool.connect();
  const state: LeaseContext = { client, lost: false };
  const onError = () => { state.lost = true; };
  client.on('error', onError);
  let acquired = false;
  try {
    const r = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', buildLockKey(m));
    acquired = r.rows[0]?.acquired === true;
    if (!acquired) return busy();
    return await context.run(state, build);
  } finally {
    if (acquired && !state.lost) { try { await client.query('SELECT pg_advisory_unlock($1, $2)', buildLockKey(m)); } catch { state.lost = true; } }
    client.removeListener('error', onError);
    client.release(state.lost);
  }
}

export async function publicationQuery<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const lease = context.getStore();
  if (!lease) return dbQuery<T>(sql, params);
  if (lease.lost) throw new Error('Screener build lease was lost; the existing snapshot was kept');
  const r = await lease.client.query(sql, params);
  return r.rows as T[];
}
