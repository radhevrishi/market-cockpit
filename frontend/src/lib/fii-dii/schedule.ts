// zzz1055 — FII / DII flows: when the app-scheduler job runs and what each run does (pure, unit-tested).
//
// NSE publishes the provisional figures ~18:00–19:00 IST (12:30–13:30 UTC). The job looks every 15 minutes from 13:00 to
// 15:30 UTC on weekdays and stops fetching NSE as soon as today's row is stored. Two more slots a day pick up NSDL's confirmed
// FPI figure (it arrives the next working day) and look for a new fortnightly sector report (published around the 1st and the
// 16th): 17:45 UTC (23:15 IST) and 04:20 UTC (09:50 IST). History backfill runs in small chunks in any slot until done.
//
// zzz1060: an hourly ':55' slot (outside the evening window, every day incl. weekends) moves the history backfills along on
// their own (NSDL archive, NSDL sector reports, NSE participant OI) and picks up the participant-OI file and the Nifty close.
// Those slots never call NSE's live API. Every step is skipped once its work is done, so a finished backfill costs nothing.
import { prevTradingDay } from './parse';

export const FII_DII_JOB = 'fii-dii';
export const FII_DII_CRONS: readonly string[] = [
  '0,15,30,45 13-14 * * 1-5', '0,15,30 15 * * 1-5', '45 17 * * 1-5', '20 4 * * 1-5',
  '55 0-11,16-23 * * *', '55 12-15 * * 0,6',
];
/** NSE's participant-wise OI file is out from about this IST time. */
export const NSE_OI_PUBLISH_IST_MIN = 19 * 60;
/** NSE provisional figures are out from about this IST time. */
export const NSE_PUBLISH_IST_MIN = 18 * 60;

const istParts = (now: Date) => {
  const t = new Date(now.getTime() + 330 * 60_000);
  return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes(), wd: t.getUTCDay() };
};
export function isTradingDayIso(iso: string, isHoliday: (iso: string) => boolean): boolean {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !isHoliday(iso);
}

/** The latest trading day whose NSE provisional figures should already be out at `now`. */
export function expectedNseDate(now: Date, isHoliday: (iso: string) => boolean): string {
  const p = istParts(now);
  if (isTradingDayIso(p.date, isHoliday) && p.min >= NSE_PUBLISH_IST_MIN) return p.date;
  return prevTradingDay(p.date, isHoliday);
}

/** The slots that also check NSDL (confirmed figure) and the sector reports: 15:30, 17:45 and 04:20 UTC. */
export function isFinalSlot(slot: Date): boolean {
  const h = slot.getUTCHours(), m = slot.getUTCMinutes();
  return (h === 15 && m === 30) || (h === 17 && m === 45) || (h === 4 && m === 20);
}

/** The hourly ':55' slots: backfill + cheap file checks only, never the NSE live API. */
export function isBackfillSlot(slot: Date): boolean { return slot.getUTCMinutes() === 55; }

/** The latest trading day whose participant-OI file should be out at `now`. */
export function expectedOiDate(now: Date, isHoliday: (iso: string) => boolean): string {
  const p = istParts(now);
  if (isTradingDayIso(p.date, isHoliday) && p.min >= NSE_OI_PUBLISH_IST_MIN) return p.date;
  return prevTradingDay(p.date, isHoliday);
}

export interface PlanInput {
  slot: Date;
  /** latest expected NSE day (expectedNseDate) when its row is NOT stored yet, else null */
  missingNse: string | null;
  /** latest stored NSE day that has no NSDL-confirmed figure yet, else null */
  needFinal: string | null;
  dailyBackfillDone: boolean;
  sectorBackfillDone: boolean;
  /** zzz1060: expected participant-OI day when it is NOT stored yet, else null */
  missingOi?: string | null;
  oiBackfillDone?: boolean;
  /** zzz1060: expected NSE day when its Nifty close is NOT stored yet, else null */
  missingNifty?: string | null;
}
export interface Plan { nse: boolean; nsdlLatest: boolean; sectors: boolean; backfillDaily: boolean; backfillSectors: boolean; oi: boolean; backfillOi: boolean; nifty: boolean }

export function planFiiDiiRun(p: PlanInput): Plan {
  const final = isFinalSlot(p.slot);
  const light = isBackfillSlot(p.slot);
  return {
    nse: !light && p.missingNse != null,
    nsdlLatest: final && p.needFinal != null,
    sectors: final,
    backfillDaily: !p.dailyBackfillDone,
    backfillSectors: !p.sectorBackfillDone,
    oi: p.missingOi != null,
    backfillOi: p.oiBackfillDone === false,
    nifty: p.missingNifty != null,
  };
}

/** How far back the history is filled from NSDL (FII only — DII history is not published by NSDL). */
export const DAILY_BACKFILL_MONTHS = 60;
/** Sector reports kept from NSDL's fortnight list (2 years = 48 reports; the 1-year flow needs 24). */
export const SECTOR_BACKFILL_REPORTS = 48;
/** Requests per run, so a run stays short and polite. */
export const DAILY_BACKFILL_MONTHS_PER_RUN = 6;
export const SECTOR_REPORTS_PER_RUN = 8;

/** Month-end dates (YYYY-MM-DD) still to fetch, newest first: from the month before `cursor` (the oldest month already
 *  fetched; null = nothing fetched yet → start with the current month) back to `months` months before `today`. */
export function backfillMonths(today: string, cursor: string | null, months = DAILY_BACKFILL_MONTHS, limit = DAILY_BACKFILL_MONTHS_PER_RUN): string[] {
  const t = new Date(`${today}T00:00:00Z`);
  const stop = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - months, 1));
  let cur = cursor
    ? new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 2, 1))
    : new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const out: string[] = [];
  while (cur >= stop && out.length < limit) {
    const end = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const iso = (end > t ? t : end).toISOString().slice(0, 10);
    out.push(iso);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, 1));
  }
  return out;
}

/** zzz1060 — participant-OI history kept from the NSE archive (a little over a year; a file is ~1 KB). */
export const OI_BACKFILL_DAYS = 380;
export const OI_FILES_PER_RUN = 40;

/** Trading days still to fetch for the OI history, newest first: strictly before `cursor` (the oldest day already tried;
 *  null = start at `latest`) back to `days` calendar days before `latest`. */
export function oiBackfillDates(latest: string, cursor: string | null, isHoliday: (iso: string) => boolean, days = OI_BACKFILL_DAYS, limit = OI_FILES_PER_RUN): string[] {
  const stop = new Date(`${latest}T00:00:00Z`);
  stop.setUTCDate(stop.getUTCDate() - days);
  const stopIso = stop.toISOString().slice(0, 10);
  const out: string[] = [];
  let d = cursor ?? (() => { const x = new Date(`${latest}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })();
  while (out.length < limit) {
    d = prevTradingDay(d, isHoliday);
    if (d < stopIso) break;
    out.push(d);
  }
  return out;
}

/** zzz1060 — an NSDL answer that is really the daily-trends table (an error / session page must not move the cursor on). */
export const looksLikeNsdlTrends = (html: string) => /Reporting\s*Date/i.test(html) && /Net\s*Investment|Derivative/i.test(html);

/** zzz1060 — archive months the collector sent that continue the backfill exactly where it stands (each must be the next
 *  month-end below the cursor; the first gap stops the list, so the cursor never skips a month). */
export function acceptArchiveMonths(today: string, cursor: string | null, months: readonly string[]): string[] {
  const ok: string[] = [];
  let c = cursor;
  for (const m of months) {
    const next = backfillMonths(today, c, DAILY_BACKFILL_MONTHS, 1)[0];
    if (!next || next !== m) break;
    ok.push(m); c = m;
  }
  return ok;
}
