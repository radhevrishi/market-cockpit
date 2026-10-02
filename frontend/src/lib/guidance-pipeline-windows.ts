// zzz861 — a real BACKEND query for each recent window (24H / 3D / 7D / 14D / 30D / 120D). It reads the collected documents, the extractor results and the
// per-day coverage; it never reads the Active universe, so a window cannot be empty just because the Active list is. A window filters on the ANNOUNCEMENT date
// of the company document (never the period end). Pure; the clock is passed in.
import type { Coverage } from './guidance-docs-store';
import type { GuidanceDocIndexRow, GuidanceExtractResult } from './guidance-docs-types';
import { tradingDaysBetween } from './guidance-pipeline-coverage';

export type GuWindowKey = '24H' | '3D' | '7D' | '14D' | '30D' | '120D';
export const WINDOW_DAYS: Record<GuWindowKey, number> = { '24H': 1, '3D': 3, '7D': 7, '14D': 14, '30D': 30, '120D': 120 };
export const isWindowKey = (s: string): s is GuWindowKey => s in WINDOW_DAYS;
const DAY = 86_400_000; const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface RecentEngineNumbers {
  documents_scanned: number; with_guidance_language: number; events_extracted: number; with_previous_guidance: number; classified: number;
  verified_raises: number; reiterations: number; lowered: number; first_guidance: number; not_guidance: number; awaiting_verification: number;
  /** when events_extracted is 0: the first reason, in plain words, why it is 0 */ why_zero: string | null;
}
export interface WindowQuery {
  market: 'IN' | 'US'; requested_window: GuWindowKey; requested_days: number; actual_start: string; actual_end: string; trading_days: number;
  covered_days: number; partial_days: number; failed_days: number; not_read_days: number; documents: number; events: number;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'NO_COVERAGE'; partial_coverage: string | null; engine: RecentEngineNumbers;
}
export function windowQuery(market: 'IN' | 'US', win: GuWindowKey, now: Date, docs: GuidanceDocIndexRow[], results: GuidanceExtractResult[], coverage: Coverage | null | undefined, queueAwaiting = 0): WindowQuery {
  const n = WINDOW_DAYS[win]; const end = iso(now); const start = iso(new Date(now.getTime() - (n - 1) * DAY));
  const inWin = (d: string | null | undefined) => { const x = String(d || '').slice(0, 10); return x >= start && x <= end; };
  const dayRows = docs.filter((d) => d.market === market && inWin(d.filedAt));
  const res = results.filter((r) => r.market === market && inWin(r.filedAt));
  const days = tradingDaysBetween(start, end);
  let ok = 0, partial = 0, failed = 0, notRead = 0; let first: string | null = null;
  for (const d of days) { const c = coverage?.days?.[d]; if (!c) { notRead++; continue; } if (!first) first = d; if (c.status === 'ok') ok++; else if (c.status === 'partial') partial++; else failed++; }
  const rows = res.flatMap((r) => r.rows);
  const eng: RecentEngineNumbers = {
    documents_scanned: dayRows.length, with_guidance_language: dayRows.length /* the collector stores only documents that carry a guidance cue */,
    events_extracted: rows.length, with_previous_guidance: rows.filter((r) => !!r.prior || r.status === 'RAISED' || r.status === 'LOWERED' || r.status === 'NARROWED').length, classified: rows.filter((r) => r.status !== 'UNCLEAR').length,
    verified_raises: rows.filter((r) => r.status === 'RAISED').length, reiterations: rows.filter((r) => r.status === 'REITERATED').length, lowered: rows.filter((r) => r.status === 'LOWERED').length,
    first_guidance: rows.filter((r) => r.status === 'NEW').length, not_guidance: res.filter((r) => r.status === 'no_guidance').length,
    awaiting_verification: dayRows.filter((d) => d.extracted !== true).length + Math.max(0, queueAwaiting), why_zero: null,
  };
  if (!rows.length) eng.why_zero = !dayRows.length && !res.length
    ? (days.length && notRead === days.length ? `No company documents were collected for these ${days.length} trading days (the collector has not read them yet).` : `The collector read these days but stored no guidance-bearing company document in the ${win} window.`)
    : eng.awaiting_verification > 0 && !res.length ? `${eng.documents_scanned} document${eng.documents_scanned === 1 ? ' is' : 's are'} collected but not read by the extractor yet.`
    : `${res.length} document${res.length === 1 ? ' was' : 's were'} read; none states numeric guidance.`;
  const status: WindowQuery['coverage_status'] = days.length && notRead === days.length ? 'NO_COVERAGE' : failed === 0 && partial === 0 && notRead === 0 && eng.awaiting_verification === 0 ? 'COMPLETE' : 'PARTIAL';
  return {
    market, requested_window: win, requested_days: n, actual_start: first ?? start, actual_end: end, trading_days: days.length, covered_days: ok, partial_days: partial, failed_days: failed, not_read_days: notRead,
    documents: dayRows.length, events: rows.length, coverage_status: status,
    partial_coverage: status === 'COMPLETE' ? null : `PARTIAL COVERAGE: ${ok} of ${days.length} trading days fully read${partial ? `, ${partial} partly` : ''}${failed ? `, ${failed} failed` : ''}${notRead ? `, ${notRead} not read` : ''}${eng.awaiting_verification ? `; ${eng.awaiting_verification} document${eng.awaiting_verification === 1 ? '' : 's'} not processed` : ''}.`,
    engine: eng,
  };
}
