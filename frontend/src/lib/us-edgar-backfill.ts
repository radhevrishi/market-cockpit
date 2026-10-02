// zzz857 — the app side of the GitHub EDGAR guidance backfill (.github/scripts/edgar-guidance-backfill.mjs).
//
// The backfill reads the full US window off-line (every 8-K with Item 2.02 / 7.01, its EX-99.1 / 99.2), stores the
// documents that talk about the future as GuidanceDocs (the AI extractor reads them), and records per day whether it
// indexed that day. The app's live EDGAR read is then only a small recent window; a day the backfill indexed counts as
// read for the US coverage card.
//
//   KV guidance-docs:v1:coverage:US  ->  { v: 1, market: 'US', updatedAt, days: { 'YYYY-MM-DD': { status: 'ok'|'partial'|'failed', filings, docs, at } } }
//   Written by the ingest route (payload field `coverage`) and/or by the workflow straight to KV. A plain { 'YYYY-MM-DD': 'ok' } map is accepted too.
//
// docId (shared contract, guidance-docs-types.ts): sha1(url) hex, first 20 chars — the same function as the script's docIdOf,
// so a queue item that read an SEC exhibit can point at the GuidanceDoc the backfill stored for that exhibit.
import { createHash } from 'crypto';

export const US_BACKFILL_COVERAGE_KEY = 'guidance-docs:v1:coverage:US';
export type UsBackfillDayStatus = 'ok' | 'partial' | 'failed';
export interface UsBackfillDay { status: UsBackfillDayStatus; filings?: number; docs?: number; at?: string }
export interface UsBackfillCoverage { v: 1; market: 'US'; updatedAt: string; days: Record<string, UsBackfillDay> }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<UsBackfillDayStatus>(['ok', 'partial', 'failed']);

/** Accepts the stored record or a bare { day: status } map; anything else is null (never "zero days"). */
export function parseUsBackfillCoverage(v: unknown): UsBackfillCoverage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const src: Record<string, unknown> = o.days && typeof o.days === 'object' ? o.days : o;
  const days: Record<string, UsBackfillDay> = {};
  for (const [d, r] of Object.entries(src)) {
    if (!DAY_RE.test(d)) continue;
    const st = (typeof r === 'string' ? r : (r as any)?.status) as UsBackfillDayStatus;
    if (!STATUSES.has(st)) continue;
    const row = typeof r === 'object' && r ? (r as any) : {};
    days[d] = { status: st, filings: Number(row.filings) || 0, docs: Number(row.docs) || 0, at: typeof row.at === 'string' ? row.at : undefined };
  }
  if (!Object.keys(days).length) return null;
  return { v: 1, market: 'US', updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '', days };
}

/** Days the backfill fully indexed (status 'ok'). A 'partial' or 'failed' day is NOT read: the live scan still tries it. */
export function backfillIndexedDays(cov: UsBackfillCoverage | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!cov) return out;
  for (const [d, r] of Object.entries(cov.days)) if (r.status === 'ok') out.add(d);
  return out;
}

/** Production reader. Null when KV is unreachable or holds nothing (the scan then behaves exactly as before). */
export async function readUsBackfillIndexedDays(): Promise<Set<string> | null> {
  try {
    const { kvGet } = await import('./kv');
    const cov = parseUsBackfillCoverage(await kvGet<unknown>(US_BACKFILL_COVERAGE_KEY));
    return cov ? backfillIndexedDays(cov) : null;
  } catch { return null; }
}

/** GuidanceDoc docId: sha1(url) hex, first 20 chars. */
export const guidanceDocIdOf = (url: string): string => createHash('sha1').update(String(url)).digest('hex').slice(0, 20);

/** An SEC filing index page (…/Archives/edgar/data/<cik>/<acc no dashes>/<acc>-index.htm[l]) → cik + accession. */
export function parseSecFilingIndexUrl(url: string | null | undefined): { cikNum: number; accession: string } | null {
  const m = /^https?:\/\/(?:www\.)?sec\.gov\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/(\d{10}-\d{2}-\d{6})-index\.html?(?:[?#].*)?$/i.exec(String(url || ''));
  if (!m) return null;
  if (m[3].replace(/-/g, '') !== m[2]) return null;
  return { cikNum: Number(m[1]), accession: m[3] };
}
export const isSecFilingIndexUrl = (url: string | null | undefined): boolean => parseSecFilingIndexUrl(url) != null;
