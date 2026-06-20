// Phase 0 - create the canonical earnings-archive schema (idempotent).
// GET /api/v1/admin/db-init?secret=<CRON_SECRET|token>
import { NextResponse } from 'next/server';
import { getPool, dbAvailable } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DDL = `
CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  isin TEXT UNIQUE,
  company_name TEXT NOT NULL,
  sector TEXT, industry TEXT, nse_code TEXT, bse_code TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  aliases JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_isin_idx ON companies (isin);

CREATE TABLE IF NOT EXISTS source_priority (
  source TEXT PRIMARY KEY,
  priority INT NOT NULL
);
INSERT INTO source_priority(source,priority) VALUES
  ('MANUAL',1000),('VENDOR',100),('NSE',80),('BSE',70)
  ON CONFLICT (source) DO NOTHING;

CREATE TABLE IF NOT EXISTS raw_filings (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_filing_ref TEXT,
  symbol TEXT NOT NULL,
  company_id BIGINT,
  company_name TEXT,
  filing_category TEXT NOT NULL,
  filing_type TEXT,
  filing_date DATE NOT NULL,
  announcement_date TIMESTAMPTZ,
  source_url TEXT,
  raw_json JSONB NOT NULL,
  raw_html TEXT,
  checksum TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_filings_checksum_key UNIQUE (checksum)
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_filings_src_ref_idx ON raw_filings (source, source_filing_ref) WHERE source_filing_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS raw_filings_cat_date_idx ON raw_filings (filing_category, filing_date);
CREATE INDEX IF NOT EXISTS raw_filings_company_idx ON raw_filings (company_id);

CREATE TABLE IF NOT EXISTS earnings_events (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT,
  symbol TEXT NOT NULL,
  company_name TEXT,
  fiscal_year SMALLINT NOT NULL,
  fiscal_quarter SMALLINT NOT NULL,
  result_date DATE NOT NULL,
  source TEXT NOT NULL,
  source_filing_id BIGINT,
  confidence_score NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT earnings_events_uniq UNIQUE (symbol, fiscal_year, fiscal_quarter)
);
CREATE INDEX IF NOT EXISTS earnings_events_date_idx ON earnings_events (result_date);

CREATE TABLE IF NOT EXISTS earnings_events_history (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT,
  symbol TEXT,
  fiscal_year SMALLINT,
  fiscal_quarter SMALLINT,
  result_date DATE,
  source TEXT,
  source_filing_id BIGINT,
  confidence_score NUMERIC(4,3),
  change_reason TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE coverage_status AS ENUM ('COMPLETE','PARTIAL','RECOVERED','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS calendar_snapshots (
  month TEXT PRIMARY KEY,
  snapshot_json JSONB NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  unique_companies INT NOT NULL DEFAULT 0,
  source_count INT NOT NULL DEFAULT 0,
  coverage_status coverage_status NOT NULL DEFAULT 'UNKNOWN',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS earnings_consensus (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT,
  symbol TEXT,
  fiscal_year SMALLINT,
  fiscal_quarter SMALLINT,
  estimate_eps NUMERIC,
  reported_eps NUMERIC,
  surprise_pct NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT earnings_consensus_uniq UNIQUE (symbol, fiscal_year, fiscal_quarter)
);

CREATE TABLE IF NOT EXISTS ingestion_coverage (
  market TEXT NOT NULL,
  cov_date DATE NOT NULL,
  status TEXT NOT NULL,            -- INGESTED | OUT_OF_WINDOW | FAILED
  source TEXT,
  events_count INT NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (market, cov_date)
);
`;

export async function GET(req: Request) {
  // PATCH 1101zzz / AUDIT C1 — removed hardcoded ONESHOT bypass token
  // 'mc-dbinit-1043-once'. Public repo = public token. The bypass let
  // anyone with the string re-initialize the database. Strict CRON_SECRET only.
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) {
    return NextResponse.json({ error: 'server-misconfigured', hint: 'CRON_SECRET must be set in env to use db-init' }, { status: 503 });
  }
  if (provided.length !== expected.length || provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!dbAvailable()) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  }
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: 'pool-init-failed' }, { status: 500 });
  try {
    await pool.query(DDL);
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    return NextResponse.json({ ok: true, tables: tables.rows.map((r: any) => r.table_name) });
  } catch (e: any) {
    return NextResponse.json({ error: 'ddl-failed', message: e?.message || String(e) }, { status: 500 });
  }
}
