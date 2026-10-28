// Runs the SAME builder/financial/pattern code outside the web process. No model keys, no notification secrets.
// Run from frontend/: node --import tsx scripts/build-screener-external.ts US|IN
import { getPool } from '../src/lib/db';
import { MIGRATIONS } from '../src/lib/db-migrate';
import { runBuild } from '../src/lib/screener/run';

async function main() {
  const market = process.argv[2];
  if (market !== 'US' && market !== 'IN') throw new Error('Choose US or IN');
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('.railway.internal')) throw new Error('A dedicated external database credential is required');
  const pool = getPool();
  if (!pool) throw new Error('Database is not configured');
  try {
    // Deploy migrations through the application first. Never bootstrap a production database from a scheduled runner.
    const applied = new Set((await pool.query('SELECT id FROM schema_migrations')).rows.map((r) => Number(r.id)));
    if (MIGRATIONS.some((m) => !applied.has(m.id))) throw new Error('Application schema is not current; deploy the application first');
    process.env.SCREENER_BUILD_RUNNER = 'github';
    process.env.SCREENER_SCHEMA_CHECK_ONLY = '1';
    const result = await runBuild(market);
    // Deliberately exclude notes, source payloads, connection details and personal data from public Actions logs.
    console.log(JSON.stringify({ market, ok: result.ok, rows: result.rows, ms: result.ms, skipped: !!(result as any).skipped }));
    if (!result.ok) process.exitCode = 1;
  } finally { await pool.end(); }
}
main().catch(() => { console.error('External screener build failed. Check credentials, schema readiness and source availability; the existing snapshot remains available.'); process.exitCode = 1; });
