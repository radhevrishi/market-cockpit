// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR DATE MATH (zzz897) — pure, clock-injectable, century-safe.
//
// The earnings calendar has to keep rolling on its own for decades. Every
// helper here takes the date it works from (never reads the clock itself
// unless the caller omits it), uses UTC getters only, and never assumes the
// 21st century:
//   · two-digit fiscal labels ("FY00") resolve to the century nearest the
//     reference date, so FY00 read in 2099 is FY2100, not FY2000;
//   · month arithmetic goes through Date.UTC(y, m + n, 1), so Jan 31 + 1
//     month is February, never March 3;
//   · "today" for the Indian market is the IST date (UTC+05:30, no DST).
// ═══════════════════════════════════════════════════════════════════════════

const IST_OFFSET_MS = 5.5 * 3600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD from a Date, read in UTC. Years < 1000 / > 9999 are out of scope. */
export function isoUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Today's date in India (IST) as YYYY-MM-DD. */
export function istDateIso(now: Date = new Date()): string {
  return isoUtc(new Date(now.getTime() + IST_OFFSET_MS));
}

/** YYYY-MM of the IST date. */
export function istMonth(now: Date = new Date()): string {
  return istDateIso(now).slice(0, 7);
}

/** Midnight UTC of a YYYY-MM-DD string (null when malformed or not a real day). */
export function parseIsoDay(iso: string): Date | null {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const dt = new Date(Date.UTC(y, mo, d));
  // Date.UTC treats years 0-99 as 1900-1999; four-digit input never hits that.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
  return dt;
}

/** YYYY-MM-DD plus n days (calendar days, DST-free). */
export function addDaysIso(iso: string, n: number): string {
  const d = parseIsoDay(iso);
  if (!d) throw new Error(`bad date ${iso}`);
  return isoUtc(new Date(d.getTime() + n * 86_400_000));
}

/** YYYY-MM plus n months, no day-of-month overflow (Jan + 1 = Feb, Dec + 1 = next Jan). */
export function addMonthsYm(ym: string, n: number): string {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`bad month ${ym}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** First and last day (YYYY-MM-DD) and day count of a month — leap years included. */
export function monthBounds(ym: string): { from: string; to: string; days: number } {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`bad month ${ym}`);
  const days = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad2(days)}`, days };
}

/** Every YYYY-MM-DD from `from` to `to` inclusive (capped, so a bad range cannot loop for ever). */
export function daysBetween(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to && out.length < cap) { out.push(d); d = addDaysIso(d, 1); }
  return out;
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD, independent of the viewer's time zone. */
export function weekdayOfIso(iso: string): number {
  const d = parseIsoDay(iso);
  return d ? d.getUTCDay() : -1;
}

// ── Indian fiscal year (April–March) ────────────────────────────────────────

/** Fiscal year (four digits) that a calendar (year, month 1-12) falls in. FY2027 = Apr-2026 … Mar-2027. */
export function indianFiscalYear(year: number, month1: number): number {
  return month1 >= 4 ? year + 1 : year;
}

/** Two-digit label for a four-digit year: 2027 → "27", 2100 → "00". */
export function fy2(fyYear: number): string {
  return pad2(((fyYear % 100) + 100) % 100);
}

/** Quarter label the given calendar (year, month 1-12) lies in: Apr-Jun = Q1, …, Jan-Mar = Q4. */
export function fiscalQuarterOf(year: number, month1: number): string {
  const q = month1 >= 4 ? Math.floor((month1 - 4) / 3) + 1 : 4;
  return `Q${q} FY${fy2(indianFiscalYear(year, month1))}`;
}

/** Quarter whose results are normally filed in (year, month 1-12): the one that ended most recently. */
export function expectedResultsQuarterOf(year: number, month1: number): string {
  // results lag the quarter end by one quarter: a filing in Oct is for Jul-Sep
  const prevMonth = month1 - 3;
  return prevMonth >= 1 ? fiscalQuarterOf(year, prevMonth) : fiscalQuarterOf(year - 1, prevMonth + 12);
}

/**
 * Four-digit fiscal year from a two-digit label, picking the century closest to
 * `ref` (default now). "FY27" read in 2026 → 2027; "FY00" read in Dec 2099 → 2100;
 * "FY99" read in Jan 2100 → 2099.
 */
export function resolveFyYear(yy: number, ref: Date = new Date()): number {
  const refYear = ref.getUTCFullYear();
  const base = refYear - (((refYear % 100) + 100) % 100);   // start of ref's century
  let best = base + yy;
  for (const c of [base - 100 + yy, base + 100 + yy]) {
    if (Math.abs(c - refYear) < Math.abs(best - refYear)) best = c;
  }
  return best;
}

/** "Q3 FY27" → { q: 3, fy: 2027 } (century resolved against `ref`). */
export function parseQuarterLabel(label: string, ref: Date = new Date()): { q: number; fy: number } | null {
  const m = String(label || '').match(/Q([1-4])\s*FY\s?(\d{4}|\d{2})(?!\d)/i);
  if (!m) return null;
  const fy = m[2].length === 4 ? +m[2] : resolveFyYear(+m[2], ref);
  return { q: +m[1], fy };
}

/** Last day of a fiscal quarter, midnight UTC. Q4 FY2027 ends 31-Mar-2027. */
export function fiscalQuarterEnd(q: number, fy: number): Date {
  if (q === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (q === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (q === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}

// ── Recurring-event rules (no hand-kept date lists) ────────────────────────

/** Day of month of the last `weekday` (0 = Sun) in a month. */
export function lastWeekdayOfMonth(year: number, month1: number, weekday: number): number {
  const last = new Date(Date.UTC(year, month1, 0));
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
}

/** Day of month of the first `weekday` (0 = Sun) in a month. */
export function firstWeekdayOfMonth(year: number, month1: number, weekday: number): number {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  return 1 + ((weekday - first.getUTCDay() + 7) % 7);
}

/** First Mon-Fri day of a month (1-3). */
export function firstBusinessDayOfMonth(year: number, month1: number): number {
  const dow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  return dow === 6 ? 3 : dow === 0 ? 2 : 1;
}

// ── refresh-earnings-calendar window + write plan ───────────────────────────

/** The [today-back, today+ahead] window, anchored on the IST date. */
export function calendarWindow(now: Date = new Date(), backDays = 14, aheadDays = 60): { today: string; from: string; to: string } {
  const today = istDateIso(now);
  return { today, from: addDaysIso(today, -backDays), to: addDaysIso(today, aheadDays) };
}

/**
 * Which per-date KV keys to write after a refresh.
 *   · Both exchanges answered → every date in the window is rewritten, and a
 *     date that no longer has a meeting is cleared (a postponed meeting does
 *     not linger on its old date).
 *   · One exchange failed → only dates with meetings are written, merged with
 *     what is already stored, so a one-sided outage cannot drop the other
 *     exchange's names — except that a company the answering exchange now
 *     shows on a DIFFERENT date is taken off its old date (a moved meeting).
 */
export function planCalendarWrites(
  found: Record<string, string[]>,
  existing: Record<string, string[] | null | undefined>,
  window: { from: string; to: string },
  bothSourcesOk: boolean,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const days = daysBetween(window.from, window.to);
  if (bothSourcesOk) {
    for (const d of days) {
      const now = [...new Set(found[d] || [])].sort();
      if (now.length || (existing[d] && existing[d]!.length)) out[d] = now;
    }
    return out;
  }
  const foundOn = new Map<string, Set<string>>();   // ticker → dates it is now reported on
  for (const [d, list] of Object.entries(found)) {
    if (d < window.from || d > window.to) continue;
    for (const t of list) { if (!foundOn.has(t)) foundOn.set(t, new Set()); foundOn.get(t)!.add(d); }
  }
  for (const d of days) {
    const before = existing[d] || [];
    const kept = before.filter((t) => !foundOn.has(t) || foundOn.get(t)!.has(d));
    const merged = [...new Set([...kept, ...(found[d] || [])])].sort();
    const same = merged.length === before.length && [...before].sort().every((t, i) => t === merged[i]);
    if (!same || (found[d] || []).length) out[d] = merged;   // rewrite found dates even if unchanged (refreshes their TTL)
  }
  return out;
}

/** KV TTL for a per-date calendar key: kept until 30 days after the date itself (never less than 30 days). */
export function calendarKeyTtlSeconds(dateIso: string, now: Date = new Date()): number {
  const d = parseIsoDay(dateIso);
  const ahead = d ? Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000)) : 0;
  return (ahead + 30) * 24 * 3600;
}

export interface MacroEvent { date: string; type: 'gst_release' | 'expiry' | 'pmi_release'; region: 'IN'; title: string; importance: 'high' | 'medium' }

/**
 * Rule-generated recurring India macro events in [fromIso, toIso] — no hand-kept list to run out:
 *   · GST collection release on the 1st (for the previous month);
 *   · manufacturing PMI on the first business day;
 *   · NSE monthly F&O expiry on the last Tuesday (last Thursday before Sep 2025), moved a day earlier
 *     past any weekend or listed trading holiday.
 */
export function recurringIndiaMacroEvents(fromIso: string, toIso: string, holidays: ReadonlySet<string> = new Set()): MacroEvent[] {
  const out: MacroEvent[] = [];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let ym = fromIso.slice(0, 7); ym <= toIso.slice(0, 7); ym = addMonthsYm(ym, 1)) {
    const [y, m] = ym.split('-').map(Number);
    const prev = addMonthsYm(ym, -1);
    const prevMon = MON[Number(prev.slice(5)) - 1];
    const at = (day: number) => `${ym}-${pad2(day)}`;
    out.push({ date: at(1), type: 'gst_release', region: 'IN', title: `GST Collection Release (${prevMon} ${prev.slice(0, 4)})`, importance: 'high' });
    out.push({ date: at(firstBusinessDayOfMonth(y, m)), type: 'pmi_release', region: 'IN', title: `India Manufacturing PMI (${prevMon})`, importance: 'medium' });
    let exp = at(lastWeekdayOfMonth(y, m, ym >= '2025-09' ? 2 : 4));
    for (let guard = 0; guard < 7 && (holidays.has(exp) || weekdayOfIso(exp) === 0 || weekdayOfIso(exp) === 6); guard++) exp = addDaysIso(exp, -1);
    out.push({ date: exp, type: 'expiry', region: 'IN', title: 'NSE F&O Monthly Expiry', importance: 'medium' });
  }
  return out.filter((e) => e.date >= fromIso && e.date <= toIso);
}
