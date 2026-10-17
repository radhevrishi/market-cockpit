// zzz1065 — the home page status strip, as pure functions (no React, no fetch), so every rule is tested.
//
// H02: the home page showed the BROWSER's date next to an IST clock. A browser in New York at 17:46 on 15 Oct read
// "Thursday, 15 October 2026 · 03:16 am IST" — but at that moment it is already Friday 16 October in India. Now the
// date and the time come from the SAME time zone (India, Asia/Kolkata) and the pair is labelled "IST".
//
// Market status: India (NSE) is open Mon–Fri 09:15–15:30 IST, closed on NSE holidays (isNseHolidayDate, the collected
// list). The US is open Mon–Fri 09:30–16:00 New York time; US exchange holidays are NOT known here, so the US "next
// open" can be a holiday — the strip says so in its hover text.
import { isNseHolidayDate } from './market-hours';

export const HOME_TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The home page date + time, both in India time. */
export function homeDateTime(now: Date): { date: string; time: string; tz: 'IST'; ymd: string } {
  const date = new Intl.DateTimeFormat('en-IN', { timeZone: HOME_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: HOME_TZ, hour: '2-digit', minute: '2-digit' }).format(now);
  return { date, time, tz: 'IST', ymd: istYmd(now.getTime()) };
}

function istYmd(ms: number): string {
  const t = new Date(ms + IST_OFFSET_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today" / "tomorrow" / "Mon 20 Oct", judged on the India calendar. */
function istDayLabel(targetMs: number, nowMs: number): string {
  const a = istYmd(nowMs), b = istYmd(targetMs);
  if (a === b) return 'today';
  if (istYmd(nowMs + DAY_MS) === b) return 'tomorrow';
  const t = new Date(targetMs + IST_OFFSET_MS);
  return `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
}

function hhmmIst(ms: number): string {
  const t = new Date(ms + IST_OFFSET_MS);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

export interface SessionStatus {
  market: 'IN' | 'US';
  open: boolean;
  /** short text for the chip, e.g. "Open · closes 15:30 IST" or "Closed · opens Mon 20 Oct 09:15 IST" */
  label: string;
  /** the next opening instant (epoch ms), or null while open */
  nextOpenMs: number | null;
  /** extra words for the hover text */
  note: string;
}

/** India (NSE cash market). `isHoliday` is injectable for tests; default = the collected NSE list. */
export function indiaSession(now: Date, isHoliday: (ymd: string) => boolean = isNseHolidayDate): SessionStatus {
  const nowMs = now.getTime();
  const ymd = istYmd(nowMs);
  const dayStartUtc = Date.parse(`${ymd}T00:00:00Z`) - IST_OFFSET_MS;   // India midnight as an instant
  const tradingDay = (startMs: number) => {
    const t = new Date(startMs + IST_OFFSET_MS);
    const dow = t.getUTCDay();
    return dow !== 0 && dow !== 6 && !isHoliday(istYmd(startMs));
  };
  const openAt = (startMs: number) => startMs + (9 * 60 + 15) * 60_000;
  const closeAt = (startMs: number) => startMs + (15 * 60 + 30) * 60_000;
  if (tradingDay(dayStartUtc) && nowMs >= openAt(dayStartUtc) && nowMs < closeAt(dayStartUtc)) {
    return { market: 'IN', open: true, label: 'Open · closes 15:30 IST', nextOpenMs: null, note: 'NSE cash market, 09:15–15:30 IST' };
  }
  for (let k = 0; k <= 20; k++) {
    const start = dayStartUtc + k * DAY_MS;
    if (!tradingDay(start)) continue;
    const o = openAt(start);
    if (o <= nowMs) continue;
    return { market: 'IN', open: false, label: `Closed · opens ${istDayLabel(o, nowMs)} 09:15 IST`, nextOpenMs: o, note: 'NSE cash market, 09:15–15:30 IST; NSE holidays are skipped' };
  }
  return { market: 'IN', open: false, label: 'Closed', nextOpenMs: null, note: 'next NSE session not found in the next 3 weeks' };
}

/** New York wall-clock parts of an instant. */
function nyParts(ms: number): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') % 24, mm: g('minute') };
}

/** The instant of New York wall time y-m-d hh:mm (handles summer / winter time). */
function nyInstant(y: number, m: number, d: number, hh: number, mm: number): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall + 5 * 3_600_000;               // winter offset first
  for (let i = 0; i < 2; i++) {
    const p = nyParts(guess);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += wall - seen;
  }
  return guess;
}

/** US cash market (NYSE / Nasdaq). Exchange holidays are not known here. */
export function usSession(now: Date): SessionStatus {
  const nowMs = now.getTime();
  const p = nyParts(nowMs);
  const note = 'NYSE / Nasdaq, 09:30–16:00 New York time; US exchange holidays are not checked here';
  for (let k = 0; k <= 10; k++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + k));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const o = nyInstant(y, m, d, 9, 30), c = nyInstant(y, m, d, 16, 0);
    if (k === 0 && nowMs >= o && nowMs < c) {
      return { market: 'US', open: true, label: `Open · closes 16:00 ET (${hhmmIst(c)} IST)`, nextOpenMs: null, note };
    }
    if (o <= nowMs) continue;
    const dayWord = k === 0 ? 'today' : `${WD[dow]} ${d} ${MON[m - 1]}`;
    return { market: 'US', open: false, label: `Closed · opens ${dayWord} 09:30 ET (${hhmmIst(o)} IST)`, nextOpenMs: o, note };
  }
  return { market: 'US', open: false, label: 'Closed', nextOpenMs: null, note };
}

export type FreshTone = 'fresh' | 'amber' | 'red' | 'dim';

/** One line for "how fresh is my data": counts per tone and the worst one. */
export function freshnessSummary(tones: FreshTone[]): { fresh: number; amber: number; red: number; unknown: number; worst: FreshTone; text: string } {
  const c = { fresh: 0, amber: 0, red: 0, unknown: 0 };
  for (const t of tones) { if (t === 'dim') c.unknown++; else c[t]++; }
  const worst: FreshTone = c.red ? 'red' : c.amber ? 'amber' : c.fresh ? 'fresh' : 'dim';
  const parts: string[] = [];
  if (c.fresh) parts.push(`${c.fresh} fresh`);
  if (c.amber) parts.push(`${c.amber} ageing`);
  if (c.red) parts.push(`${c.red} stale`);
  if (c.unknown) parts.push(`${c.unknown} unknown`);
  return { ...c, worst, text: parts.length ? parts.join(' · ') : 'not checked yet' };
}
