// zzz1055 — FII / DII flows: the app-scheduler job (`fii-dii`, crons in ./schedule) and the collector ingest. Server only.
import type { JobCtx, JobOutcome } from '@/lib/app-scheduler';
import { isNseHolidayDate } from '@/lib/market-hours';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import { parseNseFiiDii, parseNsdlDaily, nsdlTradeDates, parseSectorReportList, parseSectorReport, type NsdlDailyRow } from './parse';
import { expectedNseDate, planFiiDiiRun, backfillMonths, SECTOR_BACKFILL_REPORTS, SECTOR_REPORTS_PER_RUN, DAILY_BACKFILL_MONTHS } from './schedule';
import { fetchNseFiiDii, fetchNsdlLatest, fetchNsdlArchiveMonth, fetchSectorList, fetchSectorReport } from './sources';
import {
  storeReady, upsertNseDay, applyNsdlRows, readDailyState, upsertSectorReport, storedSectorReports, readMeta, writeMeta, clearApiCache,
} from './store';

export interface FiiDiiRunReport {
  ok: boolean;
  error?: string;
  plan?: ReturnType<typeof planFiiDiiRun>;
  expectedNse?: string;
  nse?: { stored: string | null; via?: string; error?: string; waiting?: boolean };
  nsdl?: { rows: number; error?: string };
  backfill?: { months: string[]; rows: number; errors: string[]; done: boolean };
  sectors?: { stored: string[]; errors: string[]; done: boolean };
}

const isHoliday = (iso: string) => isNseHolidayDate(iso);
const istToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

interface DailyBackfillMeta { cursor: string | null; done: boolean }
interface SectorBackfillMeta { done: boolean; skip: string[] }

export async function runFiiDii(opts: { slot: Date; now?: Date; deadline?: number; log?: (m: string) => void; force?: boolean }): Promise<FiiDiiRunReport> {
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? Date.now() + 3 * 60_000;
  const log = opts.log ?? (() => {});
  if (!(await storeReady())) return { ok: false, error: 'Postgres is not available — FII/DII history needs the database' };
  await warmNseHolidays().catch(() => null);

  const state = await readDailyState();
  const expected = expectedNseDate(now, isHoliday);
  const dailyMeta = (await readMeta<DailyBackfillMeta>('daily_backfill')) ?? { cursor: null, done: false };
  const sectorMeta = (await readMeta<SectorBackfillMeta>('sector_backfill')) ?? { done: false, skip: [] };
  const plan = planFiiDiiRun({
    slot: opts.slot,
    missingNse: state.nseDates.has(expected) ? null : expected,
    needFinal: state.needFinal,
    dailyBackfillDone: dailyMeta.done,
    sectorBackfillDone: sectorMeta.done,
  });
  if (opts.force) { plan.nse = true; plan.nsdlLatest = true; plan.sectors = true; }
  const rep: FiiDiiRunReport = { ok: true, plan, expectedNse: expected };
  let wrote = false;

  // 1) NSE provisional
  if (plan.nse) {
    const r = await fetchNseFiiDii();
    if (r.day) {
      if (r.day.date <= istToday(now)) { await upsertNseDay(r.day); wrote = true; }
      rep.nse = { stored: r.day.date, via: r.via, waiting: r.day.date < expected };
      log(`NSE ${r.day.date} via ${r.via}${r.day.date < expected ? ` (waiting for ${expected})` : ''}`);
    } else {
      rep.nse = { stored: null, via: r.via, error: r.error };
      rep.ok = false; rep.error = `NSE FII/DII not reachable (${r.error || 'no answer'}) — the scrape-fii-dii collector covers this`;
    }
  }

  // 2) NSDL confirmed FPI figure for the latest days
  if (plan.nsdlLatest && Date.now() < deadline) {
    const r = await fetchNsdlLatest();
    if (r.html) {
      const rows = nsdlTradeDates(parseNsdlDaily(r.html), isHoliday);
      rep.nsdl = { rows: await applyNsdlRows(rows) };
      if (rows.length) wrote = true;
    } else rep.nsdl = { rows: 0, error: r.error };
  }

  // 3) history backfill from the NSDL archive (FII only), a few months per run
  if (plan.backfillDaily && Date.now() < deadline) {
    const months = backfillMonths(istToday(now), dailyMeta.cursor, DAILY_BACKFILL_MONTHS);
    const got: NsdlDailyRow[] = [];
    const errors: string[] = [];
    let cursor = dailyMeta.cursor;
    for (const m of months) {
      if (Date.now() >= deadline) break;
      const r = await fetchNsdlArchiveMonth(m);
      if (!r.html) { errors.push(`${m}: ${r.error}`); break; }   // keep the cursor: this month is tried again next run
      got.push(...parseNsdlDaily(r.html).filter((x) => x.reportDate.slice(0, 7) === m.slice(0, 7)));
      cursor = m;
    }
    const mapped = nsdlTradeDates(got, isHoliday);
    const n = await applyNsdlRows(mapped);
    if (n) wrote = true;
    const done = backfillMonths(istToday(now), cursor, DAILY_BACKFILL_MONTHS).length === 0;
    await writeMeta('daily_backfill', { cursor, done });
    rep.backfill = { months, rows: n, errors, done };
    log(`backfill ${months.join(',')} → ${n} rows${done ? ' (done)' : ''}`);
  }

  // 4) sector fortnight reports: the newest one, and the last two years in small chunks
  if ((plan.sectors || plan.backfillSectors) && Date.now() < deadline) {
    const list = await fetchSectorList();
    const stored: string[] = [], errors: string[] = [];
    if (list.html) {
      const links = parseSectorReportList(list.html).slice(0, SECTOR_BACKFILL_REPORTS);
      const have = await storedSectorReports();
      const skip = new Set(sectorMeta.skip);
      const todo = links.filter((l) => !have.has(l.date) && !skip.has(l.date)).slice(0, SECTOR_REPORTS_PER_RUN);
      for (const l of todo) {
        if (Date.now() >= deadline) break;
        const r = await fetchSectorReport(l.url);
        if (!r.html) { errors.push(`${l.date}: ${r.error}`); continue; }
        const parsed = parseSectorReport(r.html);
        if (!parsed) { skip.add(l.date); errors.push(`${l.date}: layout not understood`); continue; }
        await upsertSectorReport(parsed);
        stored.push(parsed.reportDate); wrote = true;
      }
      const haveNow = new Set([...have, ...stored]);
      const done = links.length > 0 && links.every((l) => haveNow.has(l.date) || skip.has(l.date));
      await writeMeta('sector_backfill', { done, skip: [...skip].slice(-50) });
      rep.sectors = { stored, errors, done };
    } else rep.sectors = { stored, errors: [list.error || 'sector list not reachable'], done: sectorMeta.done };
  }

  if (wrote) clearApiCache();
  return rep;
}

/** app-scheduler entry (APP_JOBS 'fii-dii'). */
export async function fiiDiiJob(ctx: JobCtx): Promise<JobOutcome> {
  const r = await runFiiDii({ slot: ctx.slot, deadline: Math.min(ctx.deadline, Date.now() + 3 * 60_000), log: ctx.log });
  ctx.log(JSON.stringify({ ok: r.ok, nse: r.nse, nsdl: r.nsdl, backfill: r.backfill && { ...r.backfill, months: r.backfill.months.length }, sectors: r.sectors }));
  return r.ok ? { ok: true, status: 200 } : { ok: false, status: 503, error: r.error };
}

// ── collector ingest (POST /api/v1/fii-dii with the service key) ───────────────

export interface CollectedBody { nse?: unknown; nsdlDaily?: unknown; sectorReports?: unknown }
const MAX_HTML = 3_000_000, MAX_ITEMS = 80;
const htmlList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= MAX_HTML).slice(0, MAX_ITEMS) : []);

export async function ingestCollected(body: CollectedBody, now: Date = new Date()): Promise<{ ok: boolean; error?: string; nse: string | null; nsdlRows: number; sectors: string[] }> {
  if (!(await storeReady())) return { ok: false, error: 'Postgres is not available', nse: null, nsdlRows: 0, sectors: [] };
  await warmNseHolidays().catch(() => null);
  let nse: string | null = null;
  const day = body.nse != null ? parseNseFiiDii(body.nse) : null;
  if (day && day.date <= istToday(now)) { await upsertNseDay(day); nse = day.date; }
  const daily: NsdlDailyRow[] = [];
  for (const h of htmlList(body.nsdlDaily)) daily.push(...parseNsdlDaily(h));
  const uniq = new Map(daily.map((r) => [r.reportDate, r]));
  const nsdlRows = await applyNsdlRows(nsdlTradeDates([...uniq.values()], isHoliday));
  const sectors: string[] = [];
  for (const h of htmlList(body.sectorReports)) {
    const rep = parseSectorReport(h);
    if (rep) { await upsertSectorReport(rep); sectors.push(rep.reportDate); }
  }
  if (nse || nsdlRows || sectors.length) clearApiCache();
  return { ok: true, nse, nsdlRows, sectors };
}
