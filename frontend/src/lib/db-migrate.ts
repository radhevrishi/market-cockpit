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
  {
    // zzz938 — our own stock screener: the daily snapshot the page reads, per-company stored pieces (profile, prices) and the
    // SEC frame files kept between builds (older periods change rarely, so they are not downloaded every day)
    id: 3, name: 'stock_screener',
    sql: `
      CREATE TABLE IF NOT EXISTS screener_snapshot (
        market      TEXT PRIMARY KEY,
        built_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        rows        JSONB NOT NULL,
        meta        JSONB
      );
      CREATE TABLE IF NOT EXISTS screener_store (
        market      TEXT NOT NULL,
        ticker      TEXT NOT NULL,
        kind        TEXT NOT NULL,
        payload     JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (market, ticker, kind)
      );
      CREATE TABLE IF NOT EXISTS sec_frame_cache (
        key         TEXT PRIMARY KEY,
        data        JSONB NOT NULL,
        fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
  },
  {
    // zzz1050 — one record per AI model call (lib/ai-runs.ts), kept 90 days; read by /ai-runs
    id: 4, name: 'ai_run',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_run (
        run_id             TEXT PRIMARY KEY,
        batch_id           TEXT,
        job                TEXT NOT NULL,
        model              TEXT,
        prompt_version     TEXT,
        doc_id             TEXT,
        ticker             TEXT,
        started_at         TIMESTAMPTZ NOT NULL,
        finished_at        TIMESTAMPTZ,
        duration_ms        INTEGER NOT NULL DEFAULT 0,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        output_tokens      INTEGER NOT NULL DEFAULT 0,
        cost_usd           NUMERIC(12,6) NOT NULL DEFAULT 0,
        outcome            TEXT NOT NULL,
        error              TEXT,
        rows_kept          INTEGER,
        rows_rejected      INTEGER,
        escalation_reason  TEXT
      );
      CREATE INDEX IF NOT EXISTS ai_run_started_idx ON ai_run (started_at DESC);
      CREATE INDEX IF NOT EXISTS ai_run_job_idx ON ai_run (job, started_at DESC);
      CREATE INDEX IF NOT EXISTS ai_run_outcome_idx ON ai_run (outcome, started_at DESC);`,
  },
  {
    // zzz1054 — price alerts (lib/alerts): the owner's alerts, what fired (kept 180 days, capped), daily figures per ticker
    // (so a restart does not re-download bars) and the one-run-per-minute claim (two server copies never check the same minute).
    // The UNIQUE (alert_id, mid, dedupe_key) index is the trigger dedupe: a second insert for the same bar / minute is refused.
    id: 5, name: 'price_alerts',
    sql: `
      CREATE TABLE IF NOT EXISTS price_alert (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        spec           JSONB NOT NULL,
        status         TEXT NOT NULL DEFAULT 'active',
        expires_at     TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        version        INTEGER NOT NULL DEFAULT 1,
        last_fired_at  TIMESTAMPTZ,
        fire_count     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS price_alert_status_idx ON price_alert (status);
      CREATE TABLE IF NOT EXISTS price_alert_event (
        id          BIGSERIAL PRIMARY KEY,
        alert_id    TEXT NOT NULL,
        alert_name  TEXT NOT NULL,
        mid         TEXT NOT NULL,
        market      TEXT NOT NULL,
        ticker      TEXT NOT NULL,
        name        TEXT,
        price       DOUBLE PRECISION,
        change_pct  DOUBLE PRECISION,
        condition   TEXT NOT NULL,
        list        TEXT,
        message     TEXT NOT NULL,
        dedupe_key  TEXT NOT NULL,
        toast       BOOLEAN NOT NULL DEFAULT true,
        browser     BOOLEAN NOT NULL DEFAULT false,
        fired_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at     TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS price_alert_event_dedupe_idx ON price_alert_event (alert_id, mid, dedupe_key);
      CREATE INDEX IF NOT EXISTS price_alert_event_fired_idx ON price_alert_event (fired_at DESC);
      CREATE INDEX IF NOT EXISTS price_alert_event_unread_idx ON price_alert_event (fired_at DESC) WHERE read_at IS NULL;
      CREATE TABLE IF NOT EXISTS price_alert_daily (
        mid          TEXT PRIMARY KEY,
        fetched_day  TEXT NOT NULL,
        figs         JSONB NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS price_alert_meta (
        k  TEXT PRIMARY KEY,
        v  TEXT NOT NULL
      );
      INSERT INTO price_alert_meta (k, v) VALUES ('last_minute', '') ON CONFLICT (k) DO NOTHING;`,
  },
  {
    // zzz1055 — FII / DII flows (lib/fii-dii/store.ts): one row per trading day (NSE provisional FII + DII, or NSDL-confirmed
    // FPI only for history before NSE rows exist) and NSDL's fortnightly sector-wise FPI equity figures (₹ crore).
    id: 6, name: 'fii_dii',
    sql: `
      CREATE TABLE IF NOT EXISTS fii_dii_daily (
        date             DATE PRIMARY KEY,
        fii_buy          NUMERIC(14,2),
        fii_sell         NUMERIC(14,2),
        fii_net          NUMERIC(14,2),
        dii_buy          NUMERIC(14,2),
        dii_sell         NUMERIC(14,2),
        dii_net          NUMERIC(14,2),
        provisional      BOOLEAN NOT NULL DEFAULT true,
        source           TEXT NOT NULL,
        fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        fpi_final_buy    NUMERIC(14,2),
        fpi_final_sell   NUMERIC(14,2),
        fpi_final_net    NUMERIC(14,2),
        nsdl_report_date DATE,
        final_at         TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS fii_sector_fortnight (
        report_date  DATE NOT NULL,
        sector       TEXT NOT NULL,
        auc_cr       NUMERIC(16,2) NOT NULL,
        net_cr       NUMERIC(14,2) NOT NULL,
        net_prev_cr  NUMERIC(14,2),
        fortnight    TEXT,
        fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (report_date, sector)
      );
      CREATE TABLE IF NOT EXISTS fii_dii_meta (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );`,
  },
  {
    // zzz1060 — FII / DII extra insights: NSE participant-wise open interest (FII / DII / Client / Pro positions in index and
    // stock derivatives, contracts), the NSDL FPI asset-class split per trading day (equity incl. primary market, debt, hybrid)
    // and Nifty 50 daily closes for the "FII flow vs market" overlay.
    id: 7, name: 'fii_dii_insights',
    sql: `
      ALTER TABLE fii_dii_daily ADD COLUMN IF NOT EXISTS fpi_eq_total_net NUMERIC(14,2);
      ALTER TABLE fii_dii_daily ADD COLUMN IF NOT EXISTS fpi_debt_net     NUMERIC(14,2);
      ALTER TABLE fii_dii_daily ADD COLUMN IF NOT EXISTS fpi_hybrid_net   NUMERIC(14,2);
      CREATE TABLE IF NOT EXISTS fii_participant_oi (
        date                DATE NOT NULL,
        participant         TEXT NOT NULL,
        fut_idx_long        BIGINT NOT NULL,
        fut_idx_short       BIGINT NOT NULL,
        fut_stk_long        BIGINT NOT NULL,
        fut_stk_short       BIGINT NOT NULL,
        opt_idx_call_long   BIGINT NOT NULL,
        opt_idx_put_long    BIGINT NOT NULL,
        opt_idx_call_short  BIGINT NOT NULL,
        opt_idx_put_short   BIGINT NOT NULL,
        fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (date, participant)
      );
      CREATE TABLE IF NOT EXISTS fii_index_close (
        symbol  TEXT NOT NULL,
        date    DATE NOT NULL,
        close   NUMERIC(12,2) NOT NULL,
        PRIMARY KEY (symbol, date)
      );`,
  },
  {
    // zzz1061 — price alerts on the app's own signals (lib/alerts/signals.ts): the last known state of each state-change condition
    // per alert + market-qualified ticker + condition, the source reading it came from (screener builtAt / content stamp), and an
    // unused edge (the bar it was found in). Written only when the state or the edge changes. Rows of deleted alerts are removed
    // by the checker's hourly housekeeping.
    id: 8, name: 'price_alert_signals',
    sql: `
      CREATE TABLE IF NOT EXISTS price_alert_signal (
        alert_id       TEXT NOT NULL,
        mid            TEXT NOT NULL,
        cond_idx       SMALLINT NOT NULL,
        alert_version  INTEGER NOT NULL,
        state          DOUBLE PRECISION,
        src            TEXT NOT NULL,
        edge           TEXT,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (alert_id, mid, cond_idx)
      );`,
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
