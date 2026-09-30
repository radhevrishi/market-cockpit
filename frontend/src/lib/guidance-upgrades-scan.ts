// zzz844 — Guidance Upgrades V2: live incremental scan layer.
// The cache-only pipeline can miss a filing that landed today. This layer asks the exchanges / SEC for each day
// of the window (bounded, parallel, failures tolerated) and reports HONESTLY what it covered.
// Pure helpers take injectable fetchers, so tests never touch the network. No paid AI, no document fetching.
import type { GuCandidate, GuScanSource, GuScanStatus } from './guidance-upgrades-types';
import { dateList, filingToCandidate, isGuidanceRelevantFiling, istDate, istDateList, parseWhen, usSessionDates } from './guidance-upgrades-candidates';

export interface FilingRowLike {
  exchange?: string; symbol?: string; company_name?: string; subject?: string; detail?: string;
  category?: string | null; subcategory?: string | null; filing_datetime?: string;
  attachment_urls?: string[]; source_url?: string; content_hash?: string;
}
export interface DayFetch { ok: boolean; filings: FilingRowLike[]; reason?: string }
export type DayFetcher = (day: string, signal?: AbortSignal) => Promise<DayFetch>;
export type BlobReader = (day: string) => Promise<FilingRowLike[] | null>;

export interface EdgarRowLike { form: string; items: string[]; ticker: string | null; company: string; filed: string; filing_url: string; cikNum?: number }
export type EdgarDayFetcher = (day: string) => Promise<EdgarRowLike[]>;

export const SCAN_BUDGET_MS = 12_000;

/** Run `fn` over items with bounded concurrency and a shared deadline. Items not finished by the deadline are reported as timeouts. */
export async function runBounded<T, R>(
  items: T[], fn: (x: T) => Promise<R>, opts: { concurrency?: number; budgetMs?: number } = {},
): Promise<Array<{ item: T; ok: boolean; value?: R; error?: string }>> {
  const conc = Math.max(1, opts.concurrency ?? 6);
  const deadline = Date.now() + (opts.budgetMs ?? SCAN_BUDGET_MS);
  const out: Array<{ item: T; ok: boolean; value?: R; error?: string }> = items.map((item) => ({ item, ok: false, error: 'not started before budget ended' }));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const left = deadline - Date.now();
      if (left <= 0) { out[i].error = 'scan budget exhausted'; continue; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const v = await Promise.race([
          fn(items[i]),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), left); }),
        ]);
        out[i] = { item: items[i], ok: true, value: v };
      } catch (e: any) { out[i] = { item: items[i], ok: false, error: String(e?.message || e || 'error').slice(0, 120) }; }
      finally { if (timer) clearTimeout(timer); }
    }
  };
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker)),
    new Promise<void>((r) => setTimeout(r, Math.max(0, deadline - Date.now()) + 50)),
  ]);
  return out;
}

const stateFor = (ok: number, total: number, ran = true): GuScanSource['state'] =>
  !ran || total === 0 ? 'NOT_RUN' : ok === total ? 'COMPLETE' : ok === 0 ? 'FAILED' : 'PARTIAL';

/** Normalise a hourly-scraper / raw-exchange row to the FilingRecord shape filingToCandidate reads. */
export function normaliseBlobRow(r: any): FilingRowLike | null {
  if (!r || typeof r !== 'object') return null;
  const subject = String(r.subject || r.desc || r.NEWSSUB || '').trim();
  const dt = r.filing_datetime || r.filing_date || r.an_dt || r.NEWS_DT;
  if (!subject || !dt) return null;
  const when = parseWhen(dt);   // exchange time: a zone-less value is IST, not the server's zone
  if (!when) return null;
  return { ...r, subject, filing_datetime: when, symbol: String(r.symbol || r.SYMBOL || r.SCRIP_CD || '').toUpperCase(), company_name: r.company_name || r.company || r.sm_name };
}

export interface IndiaScanInput {
  now: Date; days: number;
  fetchNse?: DayFetcher; fetchBse?: DayFetcher; readBlob?: BlobReader;
  budgetMs?: number;
}
export interface MarketScanResult {
  status: GuScanStatus;
  candidates: GuCandidate[];
  /** rows the source returned / that passed the relevance filter */
  rowsSeen: number; rowsRelevant: number;
}

const dayOfCandidate = (c: GuCandidate) => c.publishedAt.slice(0, 10);

export async function scanIndia(inp: IndiaScanInput): Promise<MarketScanResult> {
  const { now } = inp;
  const requested = Math.max(inp.days, 2);      // 24H still needs yesterday evening + today
  const days = istDateList(now, requested);     // the Indian announcement day (IST), so an evening filing is on the right day
  const budget = inp.budgetMs ?? SCAN_BUDGET_MS;
  const rows: FilingRowLike[] = [];
  const sources: GuScanSource[] = [];
  const dayOk = new Map<string, boolean>(days.map((d) => [d, true]));
  const failedDays: Record<string, string[]> = {};

  const runEx = async (name: string, f: DayFetcher | undefined) => {
    if (!f) { sources.push({ name, state: 'NOT_RUN', scanned: 0, detail: 'not wired' }); for (const d of days) dayOk.set(d, false); return; }
    const res = await runBounded(days, (d) => f(d), { concurrency: 6, budgetMs: budget });
    let ok = 0; let seen = 0; const bad: string[] = [];
    for (const r of res) {
      const d = r.item;
      if (r.ok && r.value?.ok) { ok++; seen += r.value.filings.length; rows.push(...r.value.filings); }
      else { dayOk.set(d, false); bad.push(d); (failedDays[name] ||= []).push(r.value?.reason || r.error || 'failed'); }
    }
    const st = stateFor(ok, days.length);
    const why = failedDays[name]?.[0];
    sources.push({ name, state: st, scanned: seen, detail: st === 'COMPLETE' ? `${ok} of ${days.length} days, ${seen} announcements` : `${name.split(' ')[0]} feed failed for ${days.length - ok} of ${days.length} days${why ? ` (${why})` : ''}` });
  };
  await Promise.all([runEx('NSE announcements', inp.fetchNse), runEx('BSE announcements', inp.fetchBse)]);

  // Hourly-scraper KV blobs: an extra source, never required for completeness.
  if (inp.readBlob) {
    const rb = inp.readBlob;
    const res = await runBounded(days, (d) => rb(d), { concurrency: 6, budgetMs: Math.min(budget, 6_000) });
    let have = 0; let seen = 0;
    for (const r of res) if (r.ok && Array.isArray(r.value)) { have++; for (const x of r.value) { const n = normaliseBlobRow(x); if (n) { rows.push(n); seen++; } } }
    sources.push({ name: 'Scraped filings blob', state: have === 0 ? 'NOT_RUN' : stateFor(have, days.length), scanned: seen, detail: have === 0 ? 'scraped filings blob (corp-filings:v1:latest) missing, empty or older than the window (optional source)' : `${have} of ${days.length} days read from the scraped filings blob, ${seen} announcements (optional source)` });
  } else sources.push({ name: 'Scraped filings blob', state: 'NOT_RUN', scanned: 0, detail: 'not wired (optional source)' });

  const relevant = rows.filter(isGuidanceRelevantFiling);
  const seenId = new Set<string>();
  const candidates: GuCandidate[] = [];
  for (const f of relevant) {
    const c = filingToCandidate(f);
    if (!c || seenId.has(c.id)) continue;
    seenId.add(c.id); candidates.push(c);
  }
  const daysCovered = Array.from(dayOk.values()).filter(Boolean).length;
  const required = sources.filter((s) => s.name === 'NSE announcements' || s.name === 'BSE announcements');
  const complete = required.every((s) => s.state === 'COMPLETE') && daysCovered === days.length;
  const newest = candidates.map((c) => c.publishedAt).sort().pop() ?? null;
  const status: GuScanStatus = {
    market: 'IN', windowFrom: days[days.length - 1], windowTo: days[0], complete, lastScanAt: now.toISOString(), sources,
    daysCovered, daysRequested: days.length, candidatesFound: candidates.length, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: newest, note: '',
  };
  status.note = scanNote(status);
  return { status, candidates, rowsSeen: rows.length, rowsRelevant: relevant.length };
}

export interface UsScanInput {
  now: Date; days: number;
  /** graded-cache sessions found (warm) and expected (total) */
  warmSessions: number; totalSessions: number;
  /** tickers that already have a graded row, so we can say which SEC filers are still awaiting grading */
  gradedTickers?: ReadonlySet<string>;
  warmDates?: ReadonlySet<string>;
  fetchEdgar?: EdgarDayFetcher;
  budgetMs?: number;
}

export async function scanUs(inp: UsScanInput): Promise<MarketScanResult> {
  const { now } = inp;
  const dates = usSessionDates(now, inp.days);
  const sources: GuScanSource[] = [];
  const total = inp.totalSessions || dates.length;
  const warm = inp.warmSessions;
  sources.push({ name: 'Graded results cache', state: total === 0 ? 'NOT_RUN' : warm >= total ? 'COMPLETE' : warm === 0 ? 'FAILED' : 'PARTIAL', scanned: warm,
    detail: warm >= total ? `${warm} of ${total} sessions graded` : `${warm} of ${total} sessions graded; ${total - warm} awaiting grading` });

  let awaiting = 0; let rowsSeen = 0; let edgarDays = 0;
  if (inp.fetchEdgar) {
    const fe = inp.fetchEdgar;
    const res = await runBounded(dates, (d) => fe(d), { concurrency: 3, budgetMs: inp.budgetMs ?? SCAN_BUDGET_MS });
    const cold = new Set<string>();
    for (const r of res) {
      if (!r.ok || !Array.isArray(r.value)) continue;
      edgarDays++;
      const hits = r.value.filter((x) => x.form === '8-K' && x.items.some((i) => i === '2.02' || i === '7.01'));
      rowsSeen += hits.length;
      const dayWarm = inp.warmDates ? inp.warmDates.has(r.item) : warm >= total;
      for (const h of hits) {
        const t = (h.ticker || '').toUpperCase();
        if (t && inp.gradedTickers?.has(t)) continue;
        if (!dayWarm || !t) { awaiting++; cold.add(r.item); }
      }
    }
    sources.push({ name: 'SEC EDGAR 8-K (items 2.02/7.01)', state: stateFor(edgarDays, dates.length), scanned: rowsSeen,
      detail: edgarDays === dates.length ? `${edgarDays} of ${dates.length} sessions indexed; ${awaiting} filing${awaiting === 1 ? '' : 's'} not yet graded (index only, no release text read)` : `EDGAR index read for ${edgarDays} of ${dates.length} sessions` });
  } else sources.push({ name: 'SEC EDGAR 8-K (items 2.02/7.01)', state: 'NOT_RUN', scanned: 0, detail: 'not run' });

  const edgar = sources[1];
  // Graded sessions are what turn an 8-K into a guidance candidate; EDGAR alone only indexes filers.
  const daysCovered = Math.min(warm, total);
  const complete = sources[0].state === 'COMPLETE' && edgar.state === 'COMPLETE' && daysCovered === total && awaiting === 0;
  const status: GuScanStatus = {
    market: 'US', windowFrom: dates[dates.length - 1] ?? '', windowTo: dates[0] ?? '', complete, lastScanAt: now.toISOString(), sources,
    daysCovered, daysRequested: total, candidatesFound: 0, processed: 0, awaitingGrading: awaiting, verified: 0, newestItemAt: null, note: '',
  };
  status.note = scanNote(status);
  return { status, candidates: [], rowsSeen, rowsRelevant: rowsSeen };
}

/** Plain note that never turns an incomplete scan into "nothing happened". */
export function scanNote(s: GuScanStatus): string {
  const name = s.market === 'IN' ? 'India' : 'US';
  if (s.complete) return `${name} scan complete: ${s.daysCovered} of ${s.daysRequested} days, every required source answered.`;
  const bad = s.sources.filter((x) => x.state !== 'COMPLETE' && x.state !== 'NOT_RUN').map((x) => x.detail).concat(s.sources.filter((x) => x.state === 'NOT_RUN' && !/optional/.test(x.detail)).map((x) => `${x.name} not run`));
  return `SCAN INCOMPLETE — ${name}: ${s.daysCovered} of ${s.daysRequested} days covered${bad.length ? `; ${bad.join('; ')}` : ''}${s.awaitingGrading ? `; ${s.awaitingGrading} filing${s.awaitingGrading === 1 ? '' : 's'} awaiting grading` : ''}. Zero events shown is NOT a confirmation of no upgrades.`;
}

/** After the engine ran: fill processed / verified / candidatesFound and re-stamp the note. */
export function finaliseScan(s: GuScanStatus, n: { found: number; processed: number; verified: number; newest?: string | null }): GuScanStatus {
  const out: GuScanStatus = { ...s, candidatesFound: n.found, processed: n.processed, verified: n.verified, newestItemAt: n.newest ?? s.newestItemAt };
  out.note = scanNote(out);
  return out;
}

/** Dedupe key helper for merging: a scan candidate on the same day as a cached one. */
export const candidateDay = dayOfCandidate;

// ── real fetcher wiring (used by the route; tests inject stubs instead) ──────────────────────────────────────────
const BLOB_KEY = 'corp-filings:v1:latest';
export function makeRealIndiaFetchers(): { nse: DayFetcher; bse: DayFetcher; blob: BlobReader } {
  const mk = (which: 'NSE' | 'BSE'): DayFetcher => async (day, signal) => {
    const feed = await import('./nse-bse-feed');
    const r: any = which === 'NSE'
      ? await feed.fetchNSEAnnouncements({ fromIso: day, toIso: day, signal })
      : await feed.fetchBSEAnnouncements({ fromIso: day, toIso: day, pages: 2, signal });
    const src = String(r?.source || '');
    const blocked = src.endsWith('_BLOCKED');
    // *_EMPTY on a weekend/holiday is a real answer; *_BLOCKED is a failure
    return { ok: !blocked, filings: Array.isArray(r?.filings) ? r.filings : [], reason: blocked ? (r?.reason || src) : undefined };
  };
  let latest: Promise<any> | null = null;
  const blob: BlobReader = async (day) => {
    const { kvGet } = await import('./kv');
    // What the GitHub scraper really writes: ONE blob 'corp-filings:v1:latest' { generatedAt, filings[] } (last ~3 days, newest 500).
    // There is no per-day key; the old per-day key was never written by anything, so this source was always empty.
    if (!latest) latest = kvGet<any>(BLOB_KEY).catch(() => null);
    const v: any = await latest;
    const rows: any[] | null = Array.isArray(v) ? v : Array.isArray(v?.filings) ? v.filings : null;
    if (!rows) return null;
    return rows.filter((r) => { const t = parseWhen(r?.filing_datetime ?? r?.filing_date ?? r?.an_dt ?? r?.NEWS_DT); return !!t && istDate(new Date(t)) === day; });
  };
  return { nse: mk('NSE'), bse: mk('BSE'), blob };
}

export function makeRealEdgarFetcher(): EdgarDayFetcher {
  return async (day) => {
    const { edgarFilingsOn } = await import('./us-edgar');
    return edgarFilingsOn(day, ['8-K']);
  };
}
