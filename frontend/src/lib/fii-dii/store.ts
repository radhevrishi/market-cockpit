// zzz1055 — FII / DII flows: Postgres storage (tables from db-migrate migration 5 'fii_dii'). Server only.
import { dbQuery, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import type { DailyRow, SectorFortnightRow } from './compute';
import type { NseFiiDiiDay, NsdlTradeRow, SectorReport, AssetMixRow, ParticipantOiDay } from './parse';
import type { OiRow, ClosePoint } from './insights';

const num = (v: any): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function storeReady(): Promise<boolean> {
  if (!getPool()) return false;
  return ensureSchema();
}

/** NSE provisional day. Keeps an NSDL-confirmed figure that is already there (then the row is no longer provisional). */
export async function upsertNseDay(day: NseFiiDiiDay): Promise<void> {
  await dbQuery(
    `INSERT INTO fii_dii_daily (date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net, provisional, source, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,'nse',now())
     ON CONFLICT (date) DO UPDATE SET
       fii_buy = EXCLUDED.fii_buy, fii_sell = EXCLUDED.fii_sell, fii_net = EXCLUDED.fii_net,
       dii_buy = EXCLUDED.dii_buy, dii_sell = EXCLUDED.dii_sell, dii_net = EXCLUDED.dii_net,
       source = 'nse', fetched_at = now(), provisional = (fii_dii_daily.fpi_final_net IS NULL)`,
    [day.date, day.fii?.buy ?? null, day.fii?.sell ?? null, day.fii?.net ?? null, day.dii?.buy ?? null, day.dii?.sell ?? null, day.dii?.net ?? null],
  );
}

/** NSDL-confirmed FPI rows (already filed under their trading day). A day without an NSE row becomes an FII-only history row;
 *  a day with an NSE row keeps NSE's provisional FII/DII figures and gains the confirmed FPI figure. */
export async function applyNsdlRows(rows: readonly NsdlTradeRow[], mix: readonly AssetMixRow[] = []): Promise<number> {
  if (!rows.length) return 0;
  const mixBy = new Map(mix.map((m) => [m.reportDate, m]));
  const pool = getPool();
  if (!pool) throw new Error('DB not configured');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const r of rows) {
      await c.query(
        `INSERT INTO fii_dii_daily (date, fii_buy, fii_sell, fii_net, provisional, source, fetched_at, fpi_final_buy, fpi_final_sell, fpi_final_net, nsdl_report_date, final_at)
         VALUES ($1,$2,$3,$4,false,'nsdl',now(),$2,$3,$4,$5,now())
         ON CONFLICT (date) DO UPDATE SET
           fpi_final_buy = EXCLUDED.fpi_final_buy, fpi_final_sell = EXCLUDED.fpi_final_sell, fpi_final_net = EXCLUDED.fpi_final_net,
           nsdl_report_date = EXCLUDED.nsdl_report_date, final_at = now(), provisional = false,
           fii_buy  = CASE WHEN fii_dii_daily.source = 'nsdl' THEN EXCLUDED.fii_buy  ELSE fii_dii_daily.fii_buy  END,
           fii_sell = CASE WHEN fii_dii_daily.source = 'nsdl' THEN EXCLUDED.fii_sell ELSE fii_dii_daily.fii_sell END,
           fii_net  = CASE WHEN fii_dii_daily.source = 'nsdl' THEN EXCLUDED.fii_net  ELSE fii_dii_daily.fii_net  END`,
        [r.tradeDate, r.buy, r.sell, r.net, r.reportDate],
      );
      // zzz1060 — the same NSDL page carries debt / hybrid; filed under the same trading day as the equity row
      const m = mixBy.get(r.reportDate);
      if (m) {
        await c.query(`UPDATE fii_dii_daily SET fpi_eq_total_net = $2, fpi_debt_net = $3, fpi_hybrid_net = $4 WHERE date = $1`,
          [r.tradeDate, m.equityNet, m.debtNet, m.hybridNet]);
      }
    }
    await c.query('COMMIT');
    return rows.length;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function readDaily(from: string | null = null): Promise<DailyRow[]> {
  const rows = await dbQuery(
    `SELECT to_char(date,'YYYY-MM-DD') AS d, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net, provisional, source,
            fetched_at, fpi_final_net, final_at, fpi_eq_total_net, fpi_debt_net, fpi_hybrid_net
       FROM fii_dii_daily ${from ? 'WHERE date >= $1' : ''} ORDER BY date ASC`,
    from ? [from] : [],
  );
  return rows.map((r: any) => ({
    date: r.d,
    fiiBuy: num(r.fii_buy), fiiSell: num(r.fii_sell), fiiNet: num(r.fii_net),
    diiBuy: num(r.dii_buy), diiSell: num(r.dii_sell), diiNet: num(r.dii_net),
    provisional: !!r.provisional, source: r.source === 'nsdl' ? 'nsdl' : 'nse',
    fetchedAt: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
    fpiFinalNet: num(r.fpi_final_net), finalAt: r.final_at ? new Date(r.final_at).toISOString() : null,
    fpiEqTotal: num(r.fpi_eq_total_net), fpiDebt: num(r.fpi_debt_net), fpiHybrid: num(r.fpi_hybrid_net),
  }));
}

export interface DailyState { latestNse: string | null; nseDates: Set<string>; needFinal: string | null; earliestNsdl: string | null; count: number; firstNse: string | null }
export async function readDailyState(): Promise<DailyState> {
  const [agg] = await dbQuery(
    `SELECT to_char(max(date) FILTER (WHERE source='nse'),'YYYY-MM-DD') AS latest_nse,
            to_char(min(date) FILTER (WHERE source='nse'),'YYYY-MM-DD') AS first_nse,
            to_char(min(date) FILTER (WHERE fpi_final_net IS NOT NULL),'YYYY-MM-DD') AS earliest_nsdl,
            to_char(max(date) FILTER (WHERE source='nse' AND fpi_final_net IS NULL),'YYYY-MM-DD') AS need_final,
            count(*)::int AS n
       FROM fii_dii_daily`,
  );
  const recent = await dbQuery(`SELECT to_char(date,'YYYY-MM-DD') AS d FROM fii_dii_daily WHERE source='nse' AND date >= current_date - 20`);
  return {
    latestNse: agg?.latest_nse ?? null, firstNse: agg?.first_nse ?? null, earliestNsdl: agg?.earliest_nsdl ?? null,
    needFinal: agg?.need_final ?? null, count: Number(agg?.n || 0), nseDates: new Set(recent.map((r: any) => r.d)),
  };
}

export async function readMeta<T = any>(key: string): Promise<T | null> {
  const [r] = await dbQuery(`SELECT value FROM fii_dii_meta WHERE key = $1`, [key]);
  return (r?.value as T) ?? null;
}
export async function writeMeta(key: string, value: unknown): Promise<void> {
  await dbQuery(
    `INSERT INTO fii_dii_meta (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Answers of GET /api/v1/fii-dii, kept in memory for a few minutes; emptied whenever new figures are stored. */
export const apiCache = new Map<string, { at: number; body: unknown }>();
export function clearApiCache(): void { apiCache.clear(); }

export async function upsertSectorReport(rep: SectorReport): Promise<number> {
  const pool = getPool();
  if (!pool) throw new Error('DB not configured');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const all = rep.total ? [...rep.sectors, rep.total] : rep.sectors;
    for (const s of all) {
      await c.query(
        `INSERT INTO fii_sector_fortnight (report_date, sector, auc_cr, net_cr, net_prev_cr, fortnight, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (report_date, sector) DO UPDATE SET auc_cr = EXCLUDED.auc_cr, net_cr = EXCLUDED.net_cr,
           net_prev_cr = EXCLUDED.net_prev_cr, fortnight = EXCLUDED.fortnight, fetched_at = now()`,
        [rep.reportDate, s.sector, s.aucCr, s.netCr, s.netPrevCr, rep.fortnight],
      );
    }
    await c.query('COMMIT');
    return all.length;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function storedSectorReports(): Promise<Set<string>> {
  const rows = await dbQuery(`SELECT DISTINCT to_char(report_date,'YYYY-MM-DD') AS d FROM fii_sector_fortnight`);
  return new Set(rows.map((r: any) => r.d));
}

export async function readSectorRows(sinceDays = 400): Promise<SectorFortnightRow[]> {
  const rows = await dbQuery(
    `SELECT to_char(report_date,'YYYY-MM-DD') AS d, sector, auc_cr, net_cr FROM fii_sector_fortnight
      WHERE report_date >= (SELECT max(report_date) FROM fii_sector_fortnight) - $1::int ORDER BY report_date ASC`,
    [sinceDays],
  );
  return rows.map((r: any) => ({ reportDate: r.d, sector: r.sector, aucCr: Number(r.auc_cr), netCr: Number(r.net_cr) }));
}

// ── zzz1060: participant OI + index closes (migration 7) ─────────────────────

export async function upsertParticipantOi(day: ParticipantOiDay): Promise<void> {
  for (const [who, p] of Object.entries(day.byParticipant)) {
    await dbQuery(
      `INSERT INTO fii_participant_oi (date, participant, fut_idx_long, fut_idx_short, fut_stk_long, fut_stk_short,
         opt_idx_call_long, opt_idx_put_long, opt_idx_call_short, opt_idx_put_short, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (date, participant) DO UPDATE SET fut_idx_long = EXCLUDED.fut_idx_long, fut_idx_short = EXCLUDED.fut_idx_short,
         fut_stk_long = EXCLUDED.fut_stk_long, fut_stk_short = EXCLUDED.fut_stk_short, opt_idx_call_long = EXCLUDED.opt_idx_call_long,
         opt_idx_put_long = EXCLUDED.opt_idx_put_long, opt_idx_call_short = EXCLUDED.opt_idx_call_short,
         opt_idx_put_short = EXCLUDED.opt_idx_put_short, fetched_at = now()`,
      [day.date, who, p.futIdxLong, p.futIdxShort, p.futStkLong, p.futStkShort, p.optIdxCallLong, p.optIdxPutLong, p.optIdxCallShort, p.optIdxPutShort],
    );
  }
}

export async function latestOiDate(): Promise<string | null> {
  const [r] = await dbQuery(`SELECT to_char(max(date),'YYYY-MM-DD') AS d FROM fii_participant_oi WHERE participant = 'FII'`);
  return r?.d ?? null;
}

/** FII (+ Client for comparison) index positions, the last `days` calendar days. */
export async function readOi(days = 400): Promise<OiRow[]> {
  const rows = await dbQuery(
    `SELECT to_char(f.date,'YYYY-MM-DD') AS d, f.fut_idx_long, f.fut_idx_short, f.opt_idx_call_long, f.opt_idx_call_short,
            f.opt_idx_put_long, f.opt_idx_put_short, c.fut_idx_long AS c_long, c.fut_idx_short AS c_short
       FROM fii_participant_oi f LEFT JOIN fii_participant_oi c ON c.date = f.date AND c.participant = 'Client'
      WHERE f.participant = 'FII' AND f.date >= current_date - $1::int ORDER BY f.date ASC`,
    [days],
  );
  return rows.map((r: any) => ({
    date: r.d, fiiIdxLong: Number(r.fut_idx_long), fiiIdxShort: Number(r.fut_idx_short),
    fiiCallLong: Number(r.opt_idx_call_long), fiiCallShort: Number(r.opt_idx_call_short),
    fiiPutLong: Number(r.opt_idx_put_long), fiiPutShort: Number(r.opt_idx_put_short),
    clientIdxLong: num(r.c_long), clientIdxShort: num(r.c_short),
  }));
}

export const NIFTY_SYMBOL = '^NSEI';
export async function upsertCloses(symbol: string, pts: readonly ClosePoint[]): Promise<number> {
  if (!pts.length) return 0;
  // one statement: unnest arrays (a 5-year fill is ~1,250 rows)
  await dbQuery(
    `INSERT INTO fii_index_close (symbol, date, close)
     SELECT $1, d::date, c::numeric FROM unnest($2::text[], $3::numeric[]) AS t(d, c)
     ON CONFLICT (symbol, date) DO UPDATE SET close = EXCLUDED.close`,
    [symbol, pts.map((p) => p.date), pts.map((p) => p.close)],
  );
  return pts.length;
}
export async function latestCloseDate(symbol: string): Promise<string | null> {
  const [r] = await dbQuery(`SELECT to_char(max(date),'YYYY-MM-DD') AS d FROM fii_index_close WHERE symbol = $1`, [symbol]);
  return r?.d ?? null;
}
export async function readCloses(symbol: string): Promise<ClosePoint[]> {
  const rows = await dbQuery(`SELECT to_char(date,'YYYY-MM-DD') AS d, close FROM fii_index_close WHERE symbol = $1 ORDER BY date ASC`, [symbol]);
  return rows.map((r: any) => ({ date: r.d, close: Number(r.close) }));
}
