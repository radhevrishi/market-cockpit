// zzz875 — NSE "financial results" list collected by GitHub Actions (.github/scripts/scrape-nse-results.mjs).
//
// The Earnings hub confirms that a company REALLY filed results from NSE's /api/corporates-financial-results list. That call goes
// straight from the server to NSE, and NSE refuses the server, so a board-meeting entry could never become "Confirmed" and was dropped
// (ANSALAPI / HAWAENG / HIIL, 3 Oct 2026: Hawa Engineers filed on a Saturday evening; the announcement feed that the Cloudflare worker and
// the document collector read did not carry it — only the financial-results list did). The GitHub job reads that list for the last
// days (NSE answers GitHub), POSTs the RAW rows here, and lib/nse.ts reads KV first:
//   nse-results:v1:day:<YYYY-MM-DD>   { v: 1, day, updatedAt, rows: raw NSE rows broadcast that day }      TTL 120 d
//   nse-results:v1:coverage           { v: 1, updatedAt, days: { 'YYYY-MM-DD': { rows, at } } }           TTL 120 d
// Rows keep NSE's own field names (symbol, companyName, broadCastDate, seqNumber, ...) so every existing reader works unchanged.
// Pure helpers here (tested); the KV reads/writes are thin.
import type { DocsKv } from './guidance-docs-store';

export const NSE_RESULTS_DAY_KEY = (day: string) => `nse-results:v1:day:${day}`;
export const NSE_RESULTS_COVERAGE_KEY = 'nse-results:v1:coverage';
export const NSE_RESULTS_TTL_S = 120 * 86_400;
export const NSE_RESULTS_MAX_ROWS_PER_DAY = 4_000;
export const NSE_RESULTS_MAX_DAYS_PER_REQUEST = 70;

export interface NseResultsDay { v: 1; day: string; updatedAt: string; rows: any[] }
export interface NseResultsCoverage { v: 1; updatedAt: string; days: Record<string, { rows: number; at: string }> }

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The broadcast day (YYYY-MM-DD) of a raw NSE results row: "03-Oct-2026 21:42:15", "03-10-2026", "2026-10-03T16:12:15" or "03 Oct 2026". Null when absent. */
export function rowBroadcastDay(row: any): string | null {
  const cands = [row?.broadCastDate, row?.re_broadcastDt, row?.broadcastDate, row?.re_date, row?.date, row?.re_submissionDate, row?.exchdisstime, row?.an_dt];
  for (const c of cands) {
    const d = parseNseDay(c);
    if (d) return d;
  }
  return null;
}
export function parseNseDay(s: unknown): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{4})/.exec(t);
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? `${m[3]}-${mo}-${m[1].padStart(2, '0')}` : null; }
  m = /^(\d{1,2})[-/](\d{2})[-/](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, '0')}`;
  return null;
}
/** Stable identity of a row: symbol + seqNumber when NSE gives one, else symbol + period end + broadcast day. */
export function rowKey(row: any): string | null {
  const sym = String(row?.symbol || row?.re_symbol || '').trim().toUpperCase();
  if (!sym) return null;
  const seq = String(row?.seqNumber || row?.seq_num || row?.re_seqNumber || '').trim();
  if (seq) return `${sym}|${seq}`;
  const to = String(row?.toDate || row?.re_to_date || row?.period || '').trim();
  return `${sym}|${to}|${rowBroadcastDay(row) || ''}`;
}
/** Group raw rows by broadcast day; rows without a usable day or symbol are dropped (counted). */
export function groupRowsByDay(rows: unknown[]): { byDay: Map<string, any[]>; dropped: number } {
  const byDay = new Map<string, any[]>(); let dropped = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') { dropped++; continue; }
    const day = rowBroadcastDay(r); const k = rowKey(r);
    if (!day || !k) { dropped++; continue; }
    const list = byDay.get(day) || []; list.push(r); byDay.set(day, list);
  }
  return { byDay, dropped };
}
/** Merge a day's new rows into the stored day: newer row wins per rowKey, capped, never shrinks a day because of a smaller re-read. */
export function mergeDayRows(existing: NseResultsDay | null, day: string, rows: any[], now: Date): NseResultsDay {
  const map = new Map<string, any>();
  for (const r of existing?.rows || []) { const k = rowKey(r); if (k) map.set(k, r); }
  for (const r of rows) { const k = rowKey(r); if (k) map.set(k, r); }
  const out = Array.from(map.values()).slice(0, NSE_RESULTS_MAX_ROWS_PER_DAY);
  return { v: 1, day, updatedAt: now.toISOString(), rows: out };
}
export function mergeCoverage(existing: NseResultsCoverage | null, days: Record<string, number>, now: Date, keepDays = 130): NseResultsCoverage {
  const out: NseResultsCoverage['days'] = { ...(existing?.days && typeof existing.days === 'object' ? existing.days : {}) };
  for (const [d, n] of Object.entries(days)) if (DAY_RE.test(d)) out[d] = { rows: n, at: now.toISOString() };
  const cut = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
  for (const k of Object.keys(out)) if (k < cut) delete out[k];
  return { v: 1, updatedAt: now.toISOString(), days: out };
}
/** Calendar days from → to inclusive (YYYY-MM-DD), oldest first; empty when the range is bad or longer than the cap. */
export function dayRange(fromIso: string, toIso: string, cap = NSE_RESULTS_MAX_DAYS_PER_REQUEST): string[] {
  const a = Date.parse(`${fromIso}T00:00:00Z`), b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b && out.length <= cap; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out.length > cap ? [] : out;
}
/** "DD-MM-YYYY" (the hub's format) → "YYYY-MM-DD"; an ISO day passes through. */
export function isoDayOf(s: string): string | null { return parseNseDay(s); }

export interface IngestOutcome { daysWritten: string[]; rowsStored: number; dropped: number }
/** Store a collector payload: rows grouped by broadcast day, each day merged with what is stored; the coverage record says which days were read. */
export async function ingestNseResults(kv: DocsKv, rows: unknown[], readDays: string[], now = new Date()): Promise<IngestOutcome> {
  const { byDay, dropped } = groupRowsByDay(rows);
  const daysWritten: string[] = []; let rowsStored = 0;
  for (const [day, list] of byDay) {
    const prev = await kv.get<NseResultsDay>(NSE_RESULTS_DAY_KEY(day)).catch(() => null);
    const merged = mergeDayRows(prev && prev.v === 1 ? prev : null, day, list, now);
    await kv.set(NSE_RESULTS_DAY_KEY(day), merged, NSE_RESULTS_TTL_S);
    daysWritten.push(day); rowsStored += list.length;
  }
  // a day that was READ but had no rows is still covered (a quiet Sunday is a real answer from NSE)
  const cov: Record<string, number> = {};
  for (const d of readDays) if (DAY_RE.test(d)) cov[d] = byDay.get(d)?.length ?? 0;
  for (const [d, list] of byDay) cov[d] = Math.max(cov[d] ?? 0, list.length);
  const prevCov = await kv.get<NseResultsCoverage>(NSE_RESULTS_COVERAGE_KEY).catch(() => null);
  await kv.set(NSE_RESULTS_COVERAGE_KEY, mergeCoverage(prevCov && prevCov.v === 1 ? prevCov : null, cov, now), NSE_RESULTS_TTL_S);
  return { daysWritten: daysWritten.sort(), rowsStored, dropped };
}
/** Rows stored for the days of a range (oldest first) and which of those days the collector has read. */
export async function readNseResults(kv: Pick<DocsKv, 'get'> & { mget?: <T>(keys: string[]) => Promise<Array<T | null>> }, fromIso: string, toIso: string): Promise<{ rows: any[]; daysRead: string[]; daysMissing: string[] }> {
  const days = dayRange(fromIso, toIso);
  if (!days.length) return { rows: [], daysRead: [], daysMissing: [] };
  const cov = await kv.get<NseResultsCoverage>(NSE_RESULTS_COVERAGE_KEY).catch(() => null);
  const read = new Set(Object.keys(cov?.days || {}));
  const keys = days.map(NSE_RESULTS_DAY_KEY);
  const got = kv.mget ? await kv.mget<NseResultsDay>(keys).catch(() => keys.map(() => null)) : await Promise.all(keys.map((k) => kv.get<NseResultsDay>(k).catch(() => null)));
  const rows: any[] = [];
  for (const d of got) if (d && d.v === 1 && Array.isArray(d.rows)) rows.push(...d.rows);
  return { rows, daysRead: days.filter((d) => read.has(d)), daysMissing: days.filter((d) => !read.has(d)) };
}
