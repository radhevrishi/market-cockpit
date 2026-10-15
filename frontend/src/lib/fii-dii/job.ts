// zzz1055 — FII / DII flows: the app-scheduler job (`fii-dii`, crons in ./schedule) and the collector ingest. Server only.
import type { JobCtx, JobOutcome } from '@/lib/app-scheduler';
import { isNseHolidayDate } from '@/lib/market-hours';
import { warmNseHolidays } from '@/lib/nse-holidays-server';
import {
  parseNseFiiDii, parseNsdlDaily, nsdlTradeDates, parseSectorReportList, parseSectorReport, parseParticipantOi, parseNsdlAssetMix,
  type NsdlDailyRow, type AssetMixRow,
} from './parse';
import {
  expectedNseDate, expectedOiDate, planFiiDiiRun, backfillMonths, oiBackfillDates, SECTOR_BACKFILL_REPORTS, SECTOR_REPORTS_PER_RUN,
  DAILY_BACKFILL_MONTHS, acceptArchiveMonths, looksLikeNsdlTrends,
} from './schedule';
import { fetchNseFiiDii, fetchNsdlLatest, fetchNsdlArchiveMonth, fetchSectorList, fetchSectorReport, fetchParticipantOi, fetchNiftyCloses } from './sources';
import {
  storeReady, upsertNseDay, applyNsdlRows, readDailyState, upsertSectorReport, storedSectorReports, readMeta, writeMeta, clearApiCache,
  upsertParticipantOi, latestOiDate, upsertCloses, latestCloseDate, NIFTY_SYMBOL,
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
  oi?: { stored: string | null; missing?: boolean; error?: string };
  oiBackfill?: { tried: number; stored: number; errors: string[]; done: boolean };
  nifty?: { rows: number; error?: string };
}

const isHoliday = (iso: string) => isNseHolidayDate(iso);
const istToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export interface DailyBackfillMeta { cursor: string | null; done: boolean }
export interface SectorBackfillMeta { done: boolean; skip: string[] }
export interface OiBackfillMeta { cursor: string | null; done: boolean }

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
  const oiMeta = (await readMeta<OiBackfillMeta>('oi_backfill')) ?? { cursor: null, done: false };
  const expectedOi = expectedOiDate(now, isHoliday);
  const [oiLatest, niftyLatest] = await Promise.all([latestOiDate().catch(() => null), latestCloseDate(NIFTY_SYMBOL).catch(() => null)]);
  const plan = planFiiDiiRun({
    slot: opts.slot,
    missingNse: state.nseDates.has(expected) ? null : expected,
    needFinal: state.needFinal,
    dailyBackfillDone: dailyMeta.done,
    sectorBackfillDone: sectorMeta.done,
    missingOi: oiLatest && oiLatest >= expectedOi ? null : expectedOi,
    oiBackfillDone: oiMeta.done,
    missingNifty: niftyLatest && niftyLatest >= expected ? null : expected,
  });
  if (opts.force) { plan.nse = true; plan.nsdlLatest = true; plan.sectors = true; plan.oi = true; plan.nifty = true; }
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
      rep.nsdl = { rows: await applyNsdlRows(rows, parseNsdlAssetMix(r.html)) };
      if (rows.length) wrote = true;
    } else rep.nsdl = { rows: 0, error: r.error };
  }

  // 3) history backfill from the NSDL archive (FII only), a few months per run
  if (plan.backfillDaily && Date.now() < deadline) {
    const months = backfillMonths(istToday(now), dailyMeta.cursor, DAILY_BACKFILL_MONTHS);
    const got: NsdlDailyRow[] = [];
    const gotMix: AssetMixRow[] = [];
    const errors: string[] = [];
    let cursor = dailyMeta.cursor;
    for (const m of months) {
      if (Date.now() >= deadline) break;
      const r = await fetchNsdlArchiveMonth(m);
      if (!r.html) { errors.push(`${m}: ${r.error}`); break; }   // keep the cursor: this month is tried again next run
      if (!looksLikeNsdlTrends(r.html)) { errors.push(`${m}: NSDL answered with a page that is not the daily-trends table`); break; }
      got.push(...parseNsdlDaily(r.html).filter((x) => x.reportDate.slice(0, 7) === m.slice(0, 7)));
      gotMix.push(...parseNsdlAssetMix(r.html).filter((x) => x.reportDate.slice(0, 7) === m.slice(0, 7)));
      cursor = m;
    }
    const mapped = nsdlTradeDates(got, isHoliday);
    const n = await applyNsdlRows(mapped, gotMix);
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

  // 5) zzz1060 — NSE participant-wise OI: the latest file, then a year of history a few dozen files per run
  if (plan.oi && Date.now() < deadline) {
    const r = await fetchParticipantOi(expectedOi);
    const day = r.csv ? parseParticipantOi(r.csv) : null;
    if (day) { await upsertParticipantOi(day); wrote = true; rep.oi = { stored: day.date }; }
    else rep.oi = { stored: null, missing: r.missing, error: r.csv ? 'layout not understood' : r.error };
  }
  if (plan.backfillOi && Date.now() < deadline) {
    const dates = oiBackfillDates(expectedOi, oiMeta.cursor, isHoliday);
    let cursor = oiMeta.cursor, stored = 0;
    const errors: string[] = [];
    for (let i = 0; i < dates.length; i += 4) {
      if (Date.now() >= deadline) break;
      const chunk = dates.slice(i, i + 4);
      const res = await Promise.all(chunk.map((d) => fetchParticipantOi(d)));
      let blocked = false;
      for (let k = 0; k < chunk.length; k++) {
        const day = res[k].csv ? parseParticipantOi(res[k].csv!) : null;
        if (day) { await upsertParticipantOi(day); stored++; }
        else if (!res[k].missing) { errors.push(`${chunk[k]}: ${res[k].error}`); blocked = true; }
      }
      if (blocked) break;                        // NSE refused: keep the cursor; the next run (or the collector) tries again
      cursor = chunk[chunk.length - 1];
    }
    if (stored) wrote = true;
    const done = oiBackfillDates(expectedOi, cursor, isHoliday).length === 0;
    await writeMeta('oi_backfill', { cursor, done });
    rep.oiBackfill = { tried: dates.length, stored, errors: errors.slice(0, 5), done };
    log(`oi backfill → ${stored} days${done ? ' (done)' : ''}`);
  }

  // 6) zzz1060 — Nifty 50 closes for the "FII flow vs market" overlay (5 years the first time, then the last month).
  //    Only bars up to the latest finished session are kept, so an intraday price is never stored as a close.
  if (plan.nifty && Date.now() < deadline) {
    try {
      const pts = (await fetchNiftyCloses(niftyLatest ? '1mo' : '5y')).filter((p) => p.date <= expected);
      rep.nifty = { rows: await upsertCloses(NIFTY_SYMBOL, pts) };
      if (pts.length) wrote = true;
    } catch (e: any) { rep.nifty = { rows: 0, error: e?.message || 'failed' }; }
  }

  if (wrote) clearApiCache();
  return rep;
}

/** app-scheduler entry (APP_JOBS 'fii-dii'). */
export async function fiiDiiJob(ctx: JobCtx): Promise<JobOutcome> {
  const r = await runFiiDii({ slot: ctx.slot, deadline: Math.min(ctx.deadline, Date.now() + 3 * 60_000), log: ctx.log });
  ctx.log(JSON.stringify({ ok: r.ok, nse: r.nse, nsdl: r.nsdl, backfill: r.backfill && { ...r.backfill, months: r.backfill.months.length }, sectors: r.sectors, oi: r.oi, oiBackfill: r.oiBackfill, nifty: r.nifty }));
  return r.ok ? { ok: true, status: 200 } : { ok: false, status: 503, error: r.error };
}

// ── collector ingest (POST /api/v1/fii-dii with the service key) ───────────────

export interface CollectedBody {
  nse?: unknown; nsdlDaily?: unknown; sectorReports?: unknown;
  /** zzz1060 — NSDL archive months fetched by the collector, newest first: [{ month: 'YYYY-MM-DD' (month end), html }] */
  nsdlArchive?: unknown;
  /** zzz1060 — participant-OI CSV files, and the oldest day the collector tried for the OI history (404s included) */
  participantOi?: unknown; oiBackfillCursor?: unknown;
}
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface IngestResult {
  ok: boolean; error?: string; nse: string | null; nsdlRows: number; sectors: string[];
  archiveMonths?: string[]; oiDays?: number; backfill?: { daily: DailyBackfillMeta; oi: OiBackfillMeta };
}
const MAX_HTML = 3_000_000, MAX_ITEMS = 80;
const htmlList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= MAX_HTML).slice(0, MAX_ITEMS) : []);

export async function ingestCollected(body: CollectedBody, now: Date = new Date()): Promise<IngestResult> {
  if (!(await storeReady())) return { ok: false, error: 'Postgres is not available', nse: null, nsdlRows: 0, sectors: [] };
  await warmNseHolidays().catch(() => null);
  let nse: string | null = null;
  const day = body.nse != null ? parseNseFiiDii(body.nse) : null;
  if (day && day.date <= istToday(now)) { await upsertNseDay(day); nse = day.date; }
  const daily: NsdlDailyRow[] = [];
  const mix: AssetMixRow[] = [];
  for (const h of htmlList(body.nsdlDaily)) { daily.push(...parseNsdlDaily(h)); mix.push(...parseNsdlAssetMix(h)); }
  // archive months: only those that continue the backfill cursor are taken (and they move it on)
  const dailyMeta = (await readMeta<DailyBackfillMeta>('daily_backfill')) ?? { cursor: null, done: false };
  const arch = (Array.isArray(body.nsdlArchive) ? body.nsdlArchive : [])
    .filter((x: any) => x && typeof x.month === 'string' && ISO_RE.test(x.month) && typeof x.html === 'string' && x.html.length <= MAX_HTML)
    .slice(0, MAX_ITEMS) as Array<{ month: string; html: string }>;
  const firstBad = arch.findIndex((a) => !looksLikeNsdlTrends(a.html));
  const good = firstBad < 0 ? arch : arch.slice(0, firstBad);
  const accepted = dailyMeta.done ? [] : acceptArchiveMonths(istToday(now), dailyMeta.cursor, good.map((a) => a.month));
  for (const m of accepted) {
    const h = arch.find((a) => a.month === m)!.html;
    daily.push(...parseNsdlDaily(h).filter((x) => x.reportDate.slice(0, 7) === m.slice(0, 7)));
    mix.push(...parseNsdlAssetMix(h).filter((x) => x.reportDate.slice(0, 7) === m.slice(0, 7)));
  }
  const uniq = new Map(daily.map((r) => [r.reportDate, r]));
  const nsdlRows = await applyNsdlRows(nsdlTradeDates([...uniq.values()], isHoliday), [...new Map(mix.map((m) => [m.reportDate, m])).values()]);
  let newDaily = dailyMeta;
  if (accepted.length) {
    const cursor = accepted[accepted.length - 1];
    newDaily = { cursor, done: backfillMonths(istToday(now), cursor, DAILY_BACKFILL_MONTHS).length === 0 };
    await writeMeta('daily_backfill', newDaily);
  }
  // participant-OI files + the collector's OI backfill cursor (only ever moves further back)
  let oiDays = 0;
  for (const csv of htmlList(body.participantOi)) {
    const d = parseParticipantOi(csv);
    if (d && d.date <= istToday(now)) { await upsertParticipantOi(d); oiDays++; }
  }
  let oiMeta = (await readMeta<OiBackfillMeta>('oi_backfill')) ?? { cursor: null, done: false };
  const oc = typeof body.oiBackfillCursor === 'string' && ISO_RE.test(body.oiBackfillCursor) ? body.oiBackfillCursor : null;
  if (oc && (!oiMeta.cursor || oc < oiMeta.cursor)) {
    oiMeta = { cursor: oc, done: oiBackfillDates(expectedOiDate(now, isHoliday), oc, isHoliday).length === 0 };
    await writeMeta('oi_backfill', oiMeta);
  }
  const sectors: string[] = [];
  for (const h of htmlList(body.sectorReports)) {
    const rep = parseSectorReport(h);
    if (rep) { await upsertSectorReport(rep); sectors.push(rep.reportDate); }
  }
  if (nse || nsdlRows || sectors.length || oiDays) clearApiCache();
  return { ok: true, nse, nsdlRows, sectors, archiveMonths: accepted, oiDays, backfill: { daily: newDaily, oi: oiMeta } };
}
