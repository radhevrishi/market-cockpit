// Phase 1 - durable archive ingestion. Reads the proven KV month snapshots
// (produced by the existing NSE/BSE pipeline) and persists them into Postgres:
//   raw_filings        (immutable, checksum-deduped)
//   earnings_events    (normalized, upserted by symbol+fiscal period)
//   calendar_snapshots (materialized per month, served fast)
// Safe + idempotent: re-running never duplicates (ON CONFLICT) and never
// touches the live calendar read-path.
// GET /api/v1/cron/archive-to-postgres?secret=<CRON_SECRET|token>&months=2&market=india
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { kvGet } from '@/lib/kv';
import { getPool, dbAvailable } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ONESHOT = 'mc-archive-1043';
const MONTH_SNAP_KEY = (market: string, month: string) => `earnings-cal-month:v2:${market}:${month}`;

function monthsBack(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

// "Q4 FY25" -> { fy: 2025, fq: 4 }. Falls back to deriving from the result date
// using the Indian fiscal calendar (Apr-Mar; Q1 = Apr-Jun).
function deriveFiscal(quarter: string | undefined, resultDate: string): { fy: number; fq: number } {
  const m = (quarter || '').match(/Q([1-4])\s*FY\s*(\d{2,4})/i);
  if (m) {
    const fq = parseInt(m[1], 10);
    let fy = parseInt(m[2], 10);
    if (fy < 100) fy += 2000;
    return { fy, fq };
  }
  const d = new Date(resultDate + 'T00:00:00Z');
  const mo = d.getUTCMonth() + 1;
  const yr = d.getUTCFullYear();
  if (mo >= 4 && mo <= 6) return { fy: yr + 1, fq: 1 };
  if (mo >= 7 && mo <= 9) return { fy: yr + 1, fq: 2 };
  if (mo >= 10 && mo <= 12) return { fy: yr + 1, fq: 3 };
  return { fy: yr, fq: 4 };
}

function checksum(symbol: string, resultDate: string, source: string, fy: number, fq: number): string {
  return createHash('sha256').update(`${symbol}|${resultDate}|${source}|${fy}|${fq}`).digest('hex');
}

async function chunkedInsert(pool: any, rows: any[][], build: (offset: number, batch: any[][]) => { sql: string; flat: any[] }, size = 400) {
  let affected = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const { sql, flat } = build(0, batch);
    const res = await pool.query(sql, flat);
    affected += res.rowCount || 0;
  }
  return affected;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelCron = req.headers.get('x-vercel-cron');
  // Allow when: cron header present, one-shot token, matching secret, OR no
  // CRON_SECRET configured on the server (consistent with the other warming
  // crons, which run open when unset). Only block a wrong secret when one is set.
  if (!vercelCron && provided !== ONESHOT && expected !== '' && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!dbAvailable()) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: 'pool-init-failed' }, { status: 500 });

  const market = searchParams.get('market') || 'india';
  const nMonths = Math.max(1, Math.min(24, parseInt(searchParams.get('months') || '2', 10)));
  const months = monthsBack(nMonths);
  const report: any[] = [];

  try {
    for (const month of months) {
      const events = (await kvGet<any[]>(MONTH_SNAP_KEY(market, month)).catch(() => null)) || [];
      if (!events.length) { report.push({ month, snapshot: 0, skipped: true }); continue; }

      // ---- raw_filings (immutable, checksum-deduped) ----
      const rawRows: any[][] = [];
      const evRows: any[][] = [];
      const sources = new Set<string>();
      const companies = new Set<string>();
      for (const e of events) {
        const symbol = String(e?.ticker || e?.symbol || '').toUpperCase().trim();
        const resultDate = String(e?.resultDate || '').slice(0, 10);
        if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) continue;
        const source = String(e?.source || 'NSE').toUpperCase();
        const company = String(e?.company || '');
        const { fy, fq } = deriveFiscal(e?.quarter, resultDate);
        const cs = checksum(symbol, resultDate, source, fy, fq);
        sources.add(source); companies.add(symbol);
        rawRows.push([source, `${symbol}:${resultDate}`, symbol, company, 'EARNINGS', resultDate, JSON.stringify(e), cs]);
        evRows.push([symbol, company, fy, fq, resultDate, source]);
      }

      // Dedupe earnings_events rows within this batch by (symbol, fy, fq) - a single
      // INSERT..ON CONFLICT DO UPDATE cannot touch the same target row twice. Keep last.
      const evMap = new Map<string, any[]>();
      for (const r of evRows) evMap.set(`${r[0]}|${r[2]}|${r[3]}`, r);
      const evDedup = [...evMap.values()];
      // Dedupe raw rows by checksum too (cosmetic; DO NOTHING already tolerates dups).
      const rawMap = new Map<string, any[]>();
      for (const r of rawRows) rawMap.set(r[7], r);
      const rawDedup = [...rawMap.values()];

      let rawInserted = 0, evUpserted = 0;
      if (rawDedup.length) {
        rawInserted = await chunkedInsert(pool, rawDedup, (_o, batch) => {
          const vals: string[] = []; const flat: any[] = []; let p = 1;
          for (const r of batch) {
            vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,$${p++})`);
            flat.push(...r);
          }
          return {
            sql: `INSERT INTO raw_filings (source, source_filing_ref, symbol, company_name, filing_category, filing_date, raw_json, checksum)
                  VALUES ${vals.join(',')} ON CONFLICT (checksum) DO NOTHING`,
            flat,
          };
        });
      }
      if (evDedup.length) {
        evUpserted = await chunkedInsert(pool, evDedup, (_o, batch) => {
          const vals: string[] = []; const flat: any[] = []; let p = 1;
          for (const r of batch) {
            vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
            flat.push(...r);
          }
          return {
            sql: `INSERT INTO earnings_events (symbol, company_name, fiscal_year, fiscal_quarter, result_date, source)
                  VALUES ${vals.join(',')}
                  ON CONFLICT (symbol, fiscal_year, fiscal_quarter)
                  DO UPDATE SET result_date = EXCLUDED.result_date,
                               company_name = COALESCE(NULLIF(EXCLUDED.company_name,''), earnings_events.company_name),
                               source = EXCLUDED.source,
                               updated_at = now()
                  WHERE earnings_events.result_date IS DISTINCT FROM EXCLUDED.result_date
                     OR earnings_events.source IS DISTINCT FROM EXCLUDED.source`,
            flat,
          };
        });
      }

      // ---- calendar_snapshots (materialized) ----
      await pool.query(
        `INSERT INTO calendar_snapshots (month, snapshot_json, event_count, unique_companies, source_count, coverage_status, generated_at)
         VALUES ($1, $2::jsonb, $3, $4, $5, 'PARTIAL', now())
         ON CONFLICT (month) DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json,
                                           event_count = EXCLUDED.event_count,
                                           unique_companies = EXCLUDED.unique_companies,
                                           source_count = EXCLUDED.source_count,
                                           generated_at = now()`,
        [month, JSON.stringify(events), events.length, companies.size, sources.size]
      );

      report.push({ month, snapshot: events.length, raw_inserted: rawInserted, events_upserted: evUpserted, companies: companies.size, sources: [...sources] });
    }

    const totals = await pool.query(
      `SELECT (SELECT count(*) FROM raw_filings) AS raw_filings,
              (SELECT count(*) FROM earnings_events) AS earnings_events,
              (SELECT count(*) FROM calendar_snapshots) AS calendar_snapshots`
    );
    return NextResponse.json({ ok: true, months: report, totals: totals.rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: 'archive-failed', message: e?.message || String(e), report }, { status: 500 });
  }
}
