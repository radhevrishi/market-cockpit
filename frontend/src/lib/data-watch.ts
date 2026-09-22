// Pure helpers for the data watch (zzz749). Kept out of the route file so
// they can be imported and tested — a route module may export only handlers.

export type WatchLevel = 'ok' | 'warn' | 'fail';
export interface WatchCheck {
  id: string;
  name: string;
  level: WatchLevel;
  detail: string;
  /** What a human should do. Only present when the watch could not heal it. */
  action?: string;
  healed?: string;
  ms: number;
}
export interface WatchResult {
  ran_at: string;
  ist_date: string;
  checks: WatchCheck[];
  fails: number;
  warns: number;
  healed: number;
  alerted: boolean;
  alert_note?: string;
}

/** India results seasons: the fortnight before and the month of each quarter's prints. */
export function indiaResultsSeason(isoDate: string): boolean {
  const md = isoDate.slice(5);   // MM-DD
  const inRange = (a: string, b: string) => md >= a && md <= b;
  return inRange('09-25', '11-15') || inRange('12-25', '12-31') || inRange('01-01', '02-15') || inRange('04-01', '05-31') || inRange('06-25', '08-15');
}

/** Minimum upcoming meetings a healthy calendar shows on this date. */
export function upcomingFloor(isoDate: string): number {
  return indiaResultsSeason(isoDate) ? 25 : 3;
}

/** Same failing set → same signature; the alert cooldown keys on it. */
export function failureSignature(checks: WatchCheck[]): string {
  return checks.filter((c) => c.level !== 'ok').map((c) => `${c.id}:${c.level}`).sort().join('|');
}
