// zzz1283 — Transformational Gainers "Reject".
// A reject is the SAME logbook mark as on Conviction Beats (lib/cb-decisions → lib/decisions,
// status REJECTED, per symbol + market, synced by the user vault), so a name passed on in one
// place is passed on everywhere (Decision Logbook, Conviction Beats, this board).
// On this board a rejected company is hidden unless "Show rejected" is on — EXCEPT when the
// board has an event dated AFTER the day it was rejected: then it comes back with a
// "rejected on X — new event since" badge, so a fresh filing is never missed.

export type TgRejectState = 'hidden' | 'resurfaced' | null;

/** decisionStatus/decisionDate from the logbook; latestEventDate = newest session date of the company's events. */
export function tgRejectState(decisionStatus: string | null | undefined, decisionDate: string | null | undefined, latestEventDate: string): TgRejectState {
  if (decisionStatus !== 'REJECTED') return null;
  const rej = String(decisionDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rej)) return 'hidden';
  return latestEventDate > rej ? 'resurfaced' : 'hidden';
}
