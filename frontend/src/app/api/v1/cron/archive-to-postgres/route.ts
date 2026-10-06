// Phase 1 - durable archive ingestion. Reads the proven KV month snapshots
// (produced by the existing NSE/BSE pipeline) and persists them into Postgres:
//   raw_filings        (immutable, checksum-deduped)
//   earnings_events    (normalized, upserted by symbol+fiscal period)
//   calendar_snapshots (materialized per month, served fast)
// Safe + idempotent: re-running never duplicates (ON CONFLICT) and never
// touches the live calendar read-path.
// GET /api/v1/cron/archive-to-postgres?secret=<CRON_SECRET|token>&months=2&market=india
import { resolveFyYear, parseQuarterLabel, expectedResultsQuarterOf } from '@/lib/calendar-dates';   // zzz897
import { NextResponse } from 'next/server';
import { secretFromRequest } from '@/lib/request-secret';   // zzz883: header first, ?secret= only for old callers
import { createHash } from 'crypto';
import { kvGet } from '@/lib/kv';
import { getPool, dbAvailable } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ONESHOT = 'mc-archive-1043';
const MONTH_SNAP_KEY = (market: string, month: string) => `earnings-cal-month:v2:${market}:${month}`;

function monthsBack(n: number, ahead = 0): string[] {
  // zzz748 — `ahead` months FIRST. The calendar UI reads only Postgres, and
  // "next 30 days" crosses into next month for a third of every month; with
  // ahead=0 next month's board meetings (ingested into KV by hub-ingest) never
  // reached Postgres, so the upcoming list went blank from the 1st to the 1st.
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + ahead);
  for (let i = 0; i < n + ahead; i++) {
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
    if (fy < 100) fy = resolveFyYear(fy, new Date(resultDate + 'T00:00:00Z'));   // zzz897 — was `fy += 2000` (FY00 in 2100 → 2000)
    return { fy, fq };
  }
  // zzz897 — a filing reports the quarter that ENDED before it (a May filing is Q4, not Q1 of the next year), the same
  // rule the calendar builder uses (expectedResultsQuarterOf). The old fallback used the quarter containing the date.
  const d = new Date(resultDate + 'T00:00:00Z');
  const p = parseQuarterLabel(expectedResultsQuarterOf(d.getUTCFullYear(), d.getUTCMonth() + 1), d);
  return p ? { fy: p.fy, fq: p.q } : { fy: d.getUTCFullYear(), fq: 4 };
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
  const provided = secretFromRequest(req) || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelCron = null /* zzz883: x-vercel-cron no longer trusted (forgeable on Railway) */;
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
  const ahead = Math.max(0, Math.min(3, parseInt(searchParams.get('ahead') || '1', 10)));
  const months = monthsBack(nMonths, ahead);
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
      // Per-date event counts (for explicit ingestion_coverage).
      const dateCounts = new Map<string, number>();
      for (const rr of rawRows) { const dd = rr[5]; dateCounts.set(dd, (dateCounts.get(dd) || 0) + 1); }

      // Dedupe earnings_events rows within this batch by (symbol, fy, fq) - a single
      // INSERT..ON CONFLICT DO UPDATE cannot touch the same target row twice. Keep last.
      const evMap = new Map<string, any[]>();
      for (const r of evRows) evMap.set(`${r[0]}|${r[2]}|${r[3]}`, r);
      const evDedup = [...evMap.values()];
      // zzz413 — dedupe raw rows by (source, source_filing_ref) — the STRICTER
      // unique key. raw_filings has TWO unique constraints: checksum AND the
      // partial index raw_filings_src_ref_idx (source, source_filing_ref). The
      // checksum includes fy/fq, so a re-archived filing whose quarter was
      // re-derived produces a NEW checksum for the SAME (source, symbol:date)
      // ref → the old `ON CONFLICT (checksum)` didn't arbitrate the src_ref
      // collision and the whole archive aborted with "duplicate key value
      // violates unique constraint raw_filings_src_ref_idx". Keep last (newest).
      const rawMap = new Map<string, any[]>();
      for (const r of rawRows) rawMap.set(`${r[0]}|${r[1]}`, r);
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
                  VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`,
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

      // ---- ingestion_coverage (explicit: every date in the captured window is INGESTED) ----
      const _covDates = [...dateCounts.keys()].sort();
      if (_covDates.length) {
        const _src = [...sources][0] || 'NSE';
        const _covRows: any[][] = [];
        for (let _d = new Date(_covDates[0] + 'T00:00:00Z'); _d <= new Date(_covDates[_covDates.length - 1] + 'T00:00:00Z'); _d.setUTCDate(_d.getUTCDate() + 1)) {
          const _ds = _d.toISOString().slice(0, 10);
          _covRows.push([market, _ds, 'INGESTED', _src, dateCounts.get(_ds) || 0]);
        }
        const _v: string[] = []; const _f: any[] = []; let _p = 1;
        for (const r of _covRows) { _v.push(`($${_p++},$${_p++},$${_p++},$${_p++},$${_p++})`); _f.push(...r); }
        await pool.query(
          `INSERT INTO ingestion_coverage (market, cov_date, status, source, events_count)
           VALUES ${_v.join(',')}
           ON CONFLICT (market, cov_date) DO UPDATE SET status = 'INGESTED', source = EXCLUDED.source, events_count = EXCLUDED.events_count, captured_at = now()`,
          _f,
        );
      }

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

export async function POST(req: Request) { return GET(req); }
