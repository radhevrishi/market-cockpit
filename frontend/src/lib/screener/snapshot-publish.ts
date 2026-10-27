// zzz1197 — publish a screener snapshot only when its rows changed (cost audit item 3). The India build runs three times an hour and
// the US build four times a day; most runs produce exactly the same rows (nothing new from NSE / SEC / screener.in), yet each one
// rewrote the whole multi-MB JSONB row and made every reader re-load it. Now: the rows' fingerprint is kept in meta.rowsHash; same
// fingerprint → only meta is updated (checkedAt + notes; Postgres keeps the stored rows untouched) and built_at stays, so the page's
// snapshot cache keeps its copy. Any change in a price, figure, profile or rule changes the rows and publishes as before.
// Rollback: SCREENER_ALWAYS_PUBLISH=1.
import { createHash } from 'crypto';
import { dbQuery } from '@/lib/db';
import { noteSnapshotWritten } from './snapshot-cache';
import { rowsJson, type ScreenRow, type ScreenMarket } from './types';

export const rowsHashOf = (json: string): string => createHash('sha1').update(json).digest('hex');

/** Pure: should the snapshot be replaced? */
export function shouldPublish(storedHash: string | null | undefined, newHash: string, always = process.env.SCREENER_ALWAYS_PUBLISH === '1'): boolean {
  return always || !storedHash || storedHash !== newHash;
}

export async function publishSnapshot(m: ScreenMarket, rows: ScreenRow[], meta: Record<string, unknown>): Promise<{ published: boolean }> {
  const json = rowsJson(rows);
  const hash = rowsHashOf(json);
  const checkedAt = new Date().toISOString();
  let stored: string | null = null;
  try {
    const r = await dbQuery<{ h: string | null }>(`SELECT meta->>'rowsHash' AS h FROM screener_snapshot WHERE market = $1`, [m]);
    stored = r[0]?.h ?? null;
  } catch { stored = null; }   // unknown → publish (never skip on a failed read)
  const full = JSON.stringify({ ...meta, rowsHash: hash, checkedAt });
  if (!shouldPublish(stored, hash)) {
    await dbQuery(`UPDATE screener_snapshot SET meta = $2 WHERE market = $1`, [m, full]);
    return { published: false };
  }
  await dbQuery(`INSERT INTO screener_snapshot (market, built_at, rows, meta) VALUES ($1, now(), $2, $3) ON CONFLICT (market) DO UPDATE SET built_at = now(), rows = EXCLUDED.rows, meta = EXCLUDED.meta`,
    [m, json, full]);
  noteSnapshotWritten(m);   // zzz1053: the shared snapshot cache re-reads it on the next request
  return { published: true };
}
