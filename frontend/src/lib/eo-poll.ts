// zzz1068 — WHEN TODAY'S INDIA EARNINGS PAGE REFRESHES ITSELF. Pure.
//
// The page polled only 09:00–17:00 IST and showed "MARKET CLOSED · manual refresh only"
// outside it. Indian companies file results all evening and on weekends (17 Oct 2026, a
// Saturday: CENTRALBK 13:19, LAGNAM 16:50, KROSS 18:00, PSB 18:41, YESBANK 19:35 IST),
// so after 17:00 the page sat on a stale list in which filed companies still read
// "board meeting only". Results filings follow the board meeting, not the trading
// session, so the poll follows the FILING window: every day 09:00–23:59 IST.

export const EO_POLL_MARKET_MS = 4 * 60_000;
export const EO_POLL_EVENING_MS = 6 * 60_000;

/** IST hour (0–23.99) for an instant. */
export function istHourOf(nowMs: number): number {
  const d = new Date(nowMs + 330 * 60_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** Poll interval for TODAY's page, or false outside the filing window. Weekends included. */
export function eoTodayPollMs(nowMs: number = Date.now()): number | false {
  const h = istHourOf(nowMs);
  if (h < 9) return false;
  return h < 17 ? EO_POLL_MARKET_MS : EO_POLL_EVENING_MS;
}

/** The status chip's words for today's page. */
export function eoTodayPollLabel(nowMs: number = Date.now()): { live: boolean; text: string; title: string } {
  const ms = eoTodayPollMs(nowMs);
  if (ms === false) return { live: false, text: 'QUIET HOURS · manual refresh only', title: 'Before 9 AM IST few results are filed; auto-refresh starts at 9 AM IST (every day, weekends included).' };
  const min = Math.round(ms / 60_000);
  return { live: true, text: `LIVE · results filing hours · auto-refresh ${min}m`, title: `Results are filed through the evening and on weekends, so the page re-checks every ${min} minutes from 9 AM to midnight IST, every day.` };
}
