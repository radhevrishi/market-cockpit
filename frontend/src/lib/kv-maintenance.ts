/**
 * zzz1230 — upkeep of the Postgres key-value store (lib/kv-pg), run by the app scheduler every 5 minutes:
 *   1. deletes expired keys (in batches);
 *   2. while Upstash still holds keys not copied yet, copies the next slice of them (SCAN in pages, sizes first, values in
 *      groups of ≤ 16 MB, each with its remaining lifetime; a key already here is never overwritten — it is newer).
 *      The cursor is kept in kv_meta 'upstash-migration'; when SCAN comes back to 0 the copy is marked done and the app
 *      stops reading Upstash at all. After that the Upstash database can be deleted.
 * Budgeted per run (default 120 s) and skipped when the server is short of memory.
 */
import { pgKv } from './kv-pg';
import { kvBackend, upstashCreds, upstashPipeline, kvMigrating, noteMigrationDone, UPSTASH_MIGRATION_META } from './kv';

export interface MigrationState {
  cursor: string; done: boolean; scanned: number; copied: number; skippedPresent: number; skippedOther: number;
  total?: number | null; startedAt: string; updatedAt: string; finishedAt?: string | null; note?: string | null;
}

const GROUP_BYTES = 16 * 1024 * 1024;
const HEAP_LIMIT_MB = Number(process.env.KV_MIGRATE_HEAP_MB) || 1600;

/** Splits keys (with their sizes) into GET groups of at most `cap` bytes; a key bigger than the cap goes alone. Pure. */
export function groupBySize(items: Array<{ key: string; bytes: number }>, cap = GROUP_BYTES, maxKeys = 50): string[][] {
  const out: string[][] = []; let cur: string[] = []; let size = 0;
  for (const it of items) {
    if (cur.length && (size + it.bytes > cap || cur.length >= maxKeys)) { out.push(cur); cur = []; size = 0; }
    cur.push(it.key); size += it.bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function runKvMaintenance(budgetMs = Number(process.env.KV_MAINT_BUDGET_MS) || 120_000): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const pg = pgKv();
  if (kvBackend() !== 'pg' || !pg) return { ok: true, skipped: 'store is not Postgres' };
  let swept = 0;
  try { for (let i = 0; i < 10; i++) { const n = await pg.sweepExpired(5000); swept += n; if (n < 5000) break; } }
  catch (e: any) { return { ok: false, error: `sweep: ${String(e?.message || e).slice(0, 160)}` }; }
  if (!upstashCreds() || !(await kvMigrating())) return { ok: true, swept, migration: 'done or not needed' };
  if (process.memoryUsage().heapUsed / 1048576 > HEAP_LIMIT_MB) return { ok: true, swept, migration: 'deferred (memory)' };

  const now = () => new Date().toISOString();
  let st = (await pg.metaGet<MigrationState>(UPSTASH_MIGRATION_META)) || {
    cursor: '0', done: false, scanned: 0, copied: 0, skippedPresent: 0, skippedOther: 0, total: null, startedAt: now(), updatedAt: now(),
  };
  if (st.total == null) {
    const d = await upstashPipeline([['DBSIZE']], 'dbsize');
    st.total = d ? Number(d[0]?.result) || null : null;
  }
  const maxDbMb = Number(process.env.KV_PG_MAX_DB_MB) || 4500;
  let pages = 0;
  while (Date.now() - t0 < budgetMs) {
    try { const s = await pg.stats(); if (s.dbMb > maxDbMb) { st.note = `paused: database is ${s.dbMb} MB (limit ${maxDbMb} MB)`; break; } } catch { /* keep going */ }
    const scan = await upstashPipeline([['SCAN', st.cursor, 'COUNT', 300]], 'scan');
    const res = scan?.[0]?.result;
    if (!Array.isArray(res) || res.length !== 2) { st.note = 'Upstash SCAN failed; retried next run'; break; }
    const next = String(res[0]);
    const keys: string[] = Array.isArray(res[1]) ? res[1].map(String) : [];
    st.scanned += keys.length;
    if (keys.length) {
      const have = await pg.existsMany(keys);
      const todo = keys.filter((_, i) => !have[i]);
      st.skippedPresent += keys.length - todo.length;
      if (todo.length) {
        const meta = await upstashPipeline(todo.flatMap((k) => [['TYPE', k], ['STRLEN', k], ['PTTL', k]]), 'meta(migrate)');
        if (!meta) { st.note = 'Upstash size read failed; retried next run'; break; }
        const items: Array<{ key: string; bytes: number; pttl: number }> = [];
        todo.forEach((k, i) => {
          const type = String(meta[3 * i]?.result || '');
          if (type !== 'string') { st.skippedOther++; return; }   // sets / missing (expired meanwhile) are not copied
          items.push({ key: k, bytes: Number(meta[3 * i + 1]?.result) || 0, pttl: Number(meta[3 * i + 2]?.result) });
        });
        const ttl = new Map(items.map((x) => [x.key, x.pttl]));
        let failed = false;
        for (const grp of groupBySize(items)) {
          const got = await upstashPipeline(grp.map((k) => ['GET', k]), 'get(migrate)');
          if (!got) { failed = true; break; }
          for (let j = 0; j < grp.length; j++) {
            const raw = got[j]?.result;
            if (typeof raw !== 'string') continue;
            const p = ttl.get(grp[j]) ?? -1;
            if (await pg.setIfAbsent(grp[j], raw, p > 0 ? new Date(Date.now() + p) : null)) st.copied++;
            else st.skippedPresent++;
          }
        }
        if (failed) { st.note = 'Upstash value read failed; the page is retried next run'; break; }
      }
    }
    st.cursor = next; pages++; st.note = null;
    if (next === '0') { st.done = true; st.finishedAt = now(); break; }
  }
  st.updatedAt = now();
  await pg.metaSet(UPSTASH_MIGRATION_META, st);
  if (st.done) noteMigrationDone(true);
  return { ok: true, swept, pages, migration: { done: st.done, scanned: st.scanned, copied: st.copied, total: st.total, note: st.note || null }, ms: Date.now() - t0 };
}
