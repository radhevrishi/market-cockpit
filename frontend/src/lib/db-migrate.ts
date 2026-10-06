// zzz883 — versioned SQL migrations for the Postgres record of truth.
//
// Postgres (Railway) is where data that must SURVIVE lives: the owner's book, decisions, theses and ledgers (before this they
// lived in browser storage or in Redis keys that expire), every guidance / results event the engines produced, and every AI
// extraction with its model and prompt version. Redis stays the cache.
//
// Rules: a migration is append-only (never edit one that has shipped — add a new one); each runs once, inside a transaction,
// under a Postgres advisory lock so two servers never run it at the same time. `ensureSchema()` is cheap after the first call.
import { getPool } from './db';

export interface Migration { id: number; name: string; sql: string }

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1, name: 'user_state',
    sql: `
      CREATE TABLE IF NOT EXISTS user_state (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL,
        hash        TEXT NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        bytes       INTEGER NOT NULL DEFAULT 0,
        device      TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS user_state_history (
        id          BIGSERIAL PRIMARY KEY,
        key         TEXT NOT NULL,
        value       JSONB NOT NULL,
        hash        TEXT NOT NULL,
        version     INTEGER NOT NULL,
        device      TEXT,
        saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS user_state_history_key_idx ON user_state_history (key, saved_at DESC);`,
  },
  {
    id: 2, name: 'events_and_extractions',
    sql: `
      CREATE TABLE IF NOT EXISTS intel_event (
        id              TEXT PRIMARY KEY,
        market          TEXT NOT NULL,
        ticker          TEXT,
        company         TEXT,
        event_type      TEXT NOT NULL,
        event_date      DATE,
        status          TEXT,
        verification    TEXT,
        materiality     TEXT,
        confidence      TEXT,
        headline        TEXT,
        changes         JSONB,
        source_name     TEXT,
        source_url      TEXT,
        source_date     DATE,
        evidence        TEXT,
        engine_version  TEXT,
        payload         JSONB,
        first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS intel_event_ticker_idx ON intel_event (market, ticker, event_date DESC);
      CREATE INDEX IF NOT EXISTS intel_event_type_idx ON intel_event (event_type, event_date DESC);
      CREATE TABLE IF NOT EXISTS ai_extraction (
        doc_id          TEXT PRIMARY KEY,
        market          TEXT NOT NULL,
        ticker          TEXT,
        company         TEXT,
        doc_url         TEXT,
        doc_kind        TEXT,
        filed_at        DATE,
        extracted_at    TIMESTAMPTZ,
        model           TEXT,
        prompt_version  TEXT,
        status          TEXT,
        row_count       INTEGER,
        rows            JSONB,
        saved_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ai_extraction_ticker_idx ON ai_extraction (market, ticker, filed_at DESC);`,
  },
] as const;

const LOCK_ID = 88_301_883;   // advisory-lock id for migrations
let _ready: Promise<boolean> | null = null;

/** Runs pending migrations once per process. Resolves false (never throws) when Postgres is not configured or unreachable. */
export function ensureSchema(): Promise<boolean> {
  if (_ready) return _ready;
  _ready = (async () => {
    const pool = getPool();
    if (!pool) return false;
    const c = await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      const done = new Set((await c.query('SELECT id FROM schema_migrations')).rows.map((r: any) => Number(r.id)));
      for (const m of MIGRATIONS) {
        if (done.has(m.id)) continue;
        await c.query('BEGIN');
        try {
          await c.query(m.sql);
          await c.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
          await c.query('COMMIT');
          console.log(`[DB] migration ${m.id} ${m.name} applied`);
        } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      }
      return true;
    } catch (e: any) {
      console.error('[DB] migrations failed:', e?.message || e);
      _ready = null;   // retry on the next call
      return false;
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
      c.release();
    }
  })().catch(() => { _ready = null; return false; });
  return _ready;
}

/** Pure: migration ids must be unique and increasing (tested). */
export function migrationsValid(list: readonly Migration[] = MIGRATIONS): boolean {
  return list.every((m, i) => m.id === i + 1 && !!m.name && !!m.sql.trim());
}
