// PATCH 0715 — Centralized timezone + market-session helpers.
// Goal: eliminate scattered inline IST math (`5.5 * 60 * 60 * 1000`,
// `getUTCDay()`, hard-coded session windows) so timezone bugs have one
// place to live + fix. India is permanent +5:30 (no DST), US uses ET
// which DOES observe DST; we approximate ET as UTC-5 standard / UTC-4
// daylight via the same IANA shortcut used by `Intl.DateTimeFormat`.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30 fixed (no DST in India)

// NSE equity-segment weekday trading holidays (official NSE 2026 circular).
// Keep in sync each January. Weekend holidays are excluded (weekday check covers them).
export const NSE_HOLIDAYS = new Set<string>([
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31',
  '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26',
  '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24',
  '2026-12-25',
]);

/** True when today (IST) is an NSE trading holiday. */
export function isNseHoliday(now?: Date): boolean {
  return NSE_HOLIDAYS.has(istToday(now));
}

/** Current wall-clock as a Date shifted into IST. */
export function istNow(now?: Date): Date {
  const base = now ?? new Date();
  return new Date(base.getTime() + IST_OFFSET_MS);
}

/** Today's date in IST as 'YYYY-MM-DD'. */
export function istToday(now?: Date): string {
  const t = istNow(now);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Last N IST weekdays (Mon-Fri), newest first, as 'YYYY-MM-DD'. */
export function istLastNWeekdays(n: number): string[] {
  const out: string[] = [];
  const t = istNow();
  const cursor = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  while (out.length < n) {
    const dow = cursor.getUTCDay(); // 0=Sun..6=Sat (already on IST-shifted Date)
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
      const d = String(cursor.getUTCDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

/** Mon-Fri 09:15-15:30 IST. */
export function isIndianMarketOpen(now?: Date): boolean {
  const t = istNow(now);
  const dow = t.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (NSE_HOLIDAYS.has(istToday(now))) return false; // exchange holiday
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return minutes >= (9 * 60 + 15) && minutes <= (15 * 60 + 30);
}

/** Approx Mon-Fri 09:30-16:00 ET via Intl. Handles DST. */
export function isUSMarketOpen(now?: Date): boolean {
  const base = now ?? new Date();
  // Use Intl.DateTimeFormat to extract ET wall-clock fields.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(base);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  // Intl 'en-US' with hour12:false occasionally emits '24' for midnight; normalize.
  const hour = parseInt(hourStr, 10) % 24;
  const minute = parseInt(minuteStr, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= (9 * 60 + 30) && minutes < (16 * 60);
}

/** Format a Date as 'HH:MM IST'. */
export function formatISTTime(d: Date): string {
  const t = istNow(d);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} IST`;
}
