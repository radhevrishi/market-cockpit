// zzz1055 — FII / DII flows: when the app-scheduler job runs and what each run does (pure, unit-tested).
//
// NSE publishes the provisional figures ~18:00–19:00 IST (12:30–13:30 UTC). The job looks every 15 minutes from 13:00 to
// 15:30 UTC on weekdays and stops fetching NSE as soon as today's row is stored. Two more slots a day pick up NSDL's confirmed
// FPI figure (it arrives the next working day) and look for a new fortnightly sector report (published around the 1st and the
// 16th): 17:45 UTC (23:15 IST) and 04:20 UTC (09:50 IST). History backfill runs in small chunks in any slot until done.
import { prevTradingDay } from './parse';

export const FII_DII_JOB = 'fii-dii';
export const FII_DII_CRONS: readonly string[] = ['0,15,30,45 13-14 * * 1-5', '0,15,30 15 * * 1-5', '45 17 * * 1-5', '20 4 * * 1-5'];
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

export interface PlanInput {
  slot: Date;
  /** latest expected NSE day (expectedNseDate) when its row is NOT stored yet, else null */
  missingNse: string | null;
  /** latest stored NSE day that has no NSDL-confirmed figure yet, else null */
  needFinal: string | null;
  dailyBackfillDone: boolean;
  sectorBackfillDone: boolean;
}
export interface Plan { nse: boolean; nsdlLatest: boolean; sectors: boolean; backfillDaily: boolean; backfillSectors: boolean }

export function planFiiDiiRun(p: PlanInput): Plan {
  const final = isFinalSlot(p.slot);
  return {
    nse: p.missingNse != null,
    nsdlLatest: final && p.needFinal != null,
    sectors: final,
    backfillDaily: !p.dailyBackfillDone,
    backfillSectors: !p.sectorBackfillDone,
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
