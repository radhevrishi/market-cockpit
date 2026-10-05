// zzz844 — Guidance Upgrades V2: live incremental scan layer.
// The cache-only pipeline can miss a filing that landed today. This layer asks the exchanges / SEC for each day
// of the window (bounded, parallel, failures tolerated) and reports HONESTLY what it covered.
// Pure helpers take injectable fetchers, so tests never touch the network. No paid AI, no document fetching.
import type { GuCandidate, GuScanSource, GuScanStatus, GuWindow } from './guidance-upgrades-types';
import { BLOB_ONLY_NOTE, LIVE_SCAN_MAX_DAYS, computeCoverage, coverageLabel, dateList, filingToCandidate, isGuidanceRelevantFiling, istDate, istDateList, parseWhen, scanState, usSessionDates } from './guidance-upgrades-candidates';

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
  /** zzz848: days an earlier run already processed (persisted event store). Only used for windows longer than LIVE_SCAN_MAX_DAYS. */
  storeCovered?: ReadonlySet<string>;
  /** zzz848: IST days that have a graded results session in the cache (null/absent = not required). Used for long windows. */
  gradedDays?: ReadonlySet<string> | null | Promise<ReadonlySet<string> | null>;
  window?: GuWindow;
  /**
   * zzz866: IST days the GitHub India collector fully indexed (KV guidance-docs:v1:coverage:IN, status 'ok'). NSE/BSE refuse this server, so the
   * collector (which runs on GitHub) is the real India reader; a day it indexed counts as covered. Absent/null: behaviour unchanged.
   */
  collectorDays?: ReadonlySet<string> | null | Promise<ReadonlySet<string> | null>;
}
export interface MarketScanResult {
  status: GuScanStatus;
  candidates: GuCandidate[];
  /** rows the source returned / that passed the relevance filter */
  rowsSeen: number; rowsRelevant: number;
  /** zzz848: days every required LIVE source answered for in this run (what the route persists as processed) */
  liveDays?: string[];
  /** zzz853: SEC filings indexed but not yet graded (US): the processing queue reads these documents */
  awaitingDocs?: AwaitingDoc[];
}
export interface AwaitingDoc { ticker: string | null; company: string | null; filed: string; url: string; form: string; day: string }
const MISSING_CAP = 60;
const windowOfDays = (d: number): GuWindow => (d <= 1 ? '24H' : d <= 3 ? '3D' : d <= 7 ? '7D' : d <= 14 ? '14D' : d <= 30 ? '30D' : '120D');
const pickDays = (all: string[], store: ReadonlySet<string> | undefined, max: number): string[] => {
  if (all.length <= max) return all;                                  // windows up to LIVE_SCAN_MAX_DAYS: every day, exactly as before
  const recent = all.slice(0, 3);                                     // filings land late: the newest days are always read again
  const rest = all.slice(3).filter((d) => !store?.has(d));           // older days only when an earlier run has not processed them
  return [...recent, ...rest].slice(0, max);
};

const dayOfCandidate = (c: GuCandidate) => c.publishedAt.slice(0, 10);

export async function scanIndia(inp: IndiaScanInput): Promise<MarketScanResult> {
  const { now } = inp;
  const requested = Math.max(inp.days, 2);      // 24H still needs yesterday evening + today
  const allDays = istDateList(now, requested);  // the Indian announcement day (IST), so an evening filing is on the right day
  const long = requested > LIVE_SCAN_MAX_DAYS;
  const days = pickDays(allDays, inp.storeCovered, LIVE_SCAN_MAX_DAYS);   // live scan stays bounded; the rest of a long window comes from the persisted store
  const budget = inp.budgetMs ?? SCAN_BUDGET_MS;
  const rows: FilingRowLike[] = [];
  const sources: GuScanSource[] = [];
  const dayOk = new Map<string, boolean>(days.map((d) => [d, true]));
  const failedDays: Record<string, string[]> = {};
  const collDays = new Set<string>();   // zzz866: days the GitHub collector fully indexed
  const blobDays = new Set<string>();   // zzz849: days the scraped blob really covers (never required, never a substitute for the exchange feeds)

  const runEx = async (name: string, f: DayFetcher | undefined) => {
    if (!f) { sources.push({ name, state: 'NOT_RUN', scanned: 0, tier: 'PRIMARY', daysTried: days.slice(), daysOk: [], detail: 'not wired' }); for (const d of days) dayOk.set(d, false); return; }
    const res = await runBounded(days, (d) => f(d), { concurrency: 6, budgetMs: budget });
    let ok = 0; let seen = 0; const bad: string[] = []; const okList: string[] = [];
    for (const r of res) {
      const d = r.item;
      if (r.ok && r.value?.ok) { ok++; okList.push(d); seen += r.value.filings.length; rows.push(...r.value.filings); }
      else { dayOk.set(d, false); bad.push(d); (failedDays[name] ||= []).push(r.value?.reason || r.error || 'failed'); }
    }
    const st = stateFor(ok, days.length);
    const why = failedDays[name]?.[0];
    sources.push({ name, state: st, scanned: seen, tier: 'PRIMARY', daysTried: days.slice(), daysOk: okList, failReasons: [...new Set(failedDays[name] || [])].slice(0, 3),
      detail: st === 'COMPLETE' ? `${ok} of ${days.length} days, ${seen} announcements` : `${name.split(' ')[0]} feed failed for ${days.length - ok} of ${days.length} days${why ? ` (${why})` : ''}` });
  };
  await Promise.all([runEx('NSE announcements', inp.fetchNse), runEx('BSE announcements', inp.fetchBse)]);

  // Hourly-scraper KV blobs: an extra source, never required for completeness.
  if (inp.readBlob) {
    const rb = inp.readBlob;
    const res = await runBounded(days, (d) => rb(d), { concurrency: 6, budgetMs: Math.min(budget, 6_000) });
    let have = 0; let seen = 0;
    for (const r of res) if (r.ok && Array.isArray(r.value)) { have++; blobDays.add(r.item); for (const x of r.value) { const n = normaliseBlobRow(x); if (n) { rows.push(n); seen++; } } }
    // zzz849: a day counts as read from the blob only when the blob's own date range covers it (the reader answers null outside that range)
    sources.push({ name: 'Scraped filings blob', tier: 'FALLBACK', daysTried: days.slice(), daysOk: [...blobDays], state: have === 0 ? 'NOT_RUN' : stateFor(have, days.length), scanned: seen, detail: have === 0 ? 'scraped filings blob (corp-filings:v1:latest) missing, empty or older than the window: blob (optional source)' : `${have} of ${days.length} days covered by the scraped filings blob, ${seen} announcements: blob (optional source)` });
  } else sources.push({ name: 'Scraped filings blob', tier: 'FALLBACK', daysTried: days.slice(), daysOk: [], state: 'NOT_RUN', scanned: 0, detail: 'not wired (optional source)' });

  // zzz866: the GitHub India collector's own day record (status 'ok' only; partial/failed days are never counted)
  const cd = await Promise.resolve(inp.collectorDays ?? null).catch(() => null);
  const cdAll = cd;   // zzz870: on a long window the collector's older days count too (they are not re-read live)
  if (cd) for (const d of days) if (cd.has(d)) collDays.add(d);
  // zzz872: the collector reads EVERY day of the window (it is not bounded like the live scan), so its source row covers the whole window:
  // on a 120D page its 86 trading days are all "tried", and every day it fully indexed is "ok". Before this fix the row only carried the
  // 30 live-scan days, so the coverage card could never show more than 30 days read for India.
  const collWindow = long ? allDays : days;
  const collOkAll = cd ? collWindow.filter((d) => cd.has(d)) : [];
  if (inp.collectorDays !== undefined) sources.push({ name: 'GitHub India collector', tier: 'PRIMARY', daysTried: collWindow.slice(), daysOk: collOkAll, state: !cd || cd.size === 0 ? 'NOT_RUN' : stateFor(collOkAll.length, collWindow.length), scanned: collOkAll.length,
    detail: !cd || cd.size === 0 ? 'no collector run recorded yet (run the "Scrape Guidance Docs" GitHub workflow; NSE and BSE refuse this server)' : `${collOkAll.length} of ${collWindow.length} days fully indexed by the GitHub collector (company documents handed to the extractor)` });

  const relevant = rows.filter(isGuidanceRelevantFiling);
  const seenId = new Set<string>();
  const candidates: GuCandidate[] = [];
  for (const f of relevant) {
    const c = filingToCandidate(f);
    if (!c || seenId.has(c.id)) continue;
    seenId.add(c.id); candidates.push(c);
  }
  const liveOk = days.filter((d) => dayOk.get(d));
  const required = sources.filter((s) => s.name === 'NSE announcements' || s.name === 'BSE announcements');
  const newest = candidates.map((c) => c.publishedAt).sort().pop() ?? null;
  let status: GuScanStatus;
  if (!long) {
    // windows up to 30D: exactly the previous numbers and rules
    // zzz849: a day read by the exchange feeds OR covered by the scraped blob counts as covered; COMPLETE still needs every required exchange feed
    const daysCovered = days.filter((d) => dayOk.get(d) || blobDays.has(d) || collDays.has(d)).length;
    const complete = (required.every((s) => s.state === 'COMPLETE') && liveOk.length === days.length) || (days.length > 0 && daysCovered === days.length && collDays.size > 0 && days.every((d) => dayOk.get(d) || collDays.has(d)));
    status = {
      market: 'IN', windowFrom: days[days.length - 1], windowTo: days[0], complete, lastScanAt: now.toISOString(), sources,
      daysCovered, daysRequested: days.length, candidatesFound: candidates.length, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: newest, note: '',
    };
  } else {
    // long window: days covered = read live today (and graded, weekdays) OR already processed by an earlier run. A day that is neither is MISSING, never "zero events".
    const gradedDays = await Promise.resolve(inp.gradedDays ?? null).catch(() => null);
    // zzz872: a day the GitHub collector fully indexed needs no graded results session to count as read (the collector read the exchange's
    // own announcement list for that day); the graded-session requirement stays for days only the live feeds answered.
    const isWeekend = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
    const cov = computeCoverage({ days: allDays, live: new Set([...liveOk, ...days.filter((d) => blobDays.has(d) || collDays.has(d)), ...(cdAll ? allDays.filter((d) => cdAll!.has(d)) : [])]), graded: gradedDays, store: inp.storeCovered, freeDay: (d) => isWeekend(d) || !!cdAll?.has(d) });
    const storeSeen = inp.storeCovered ? allDays.filter((d) => inp.storeCovered!.has(d)).length : 0;
    sources.push({
      name: 'Persisted event store', scanned: storeSeen, tier: 'SECONDARY',
      state: storeSeen === 0 ? 'NOT_AVAILABLE' : cov.missing.length === 0 ? 'COMPLETE' : 'PARTIAL',
      detail: storeSeen === 0 ? 'no stored history yet: long-window coverage builds up run by run as each scan is saved'
        : `${storeSeen} of ${allDays.length} days already processed by earlier runs; ${cov.missing.length} still missing`,
    });
    status = {
      market: 'IN', windowFrom: allDays[allDays.length - 1], windowTo: allDays[0], complete: (required.every((s) => s.state === 'COMPLETE') || collDays.size > 0) && cov.missing.length === 0,
      lastScanAt: now.toISOString(), sources, daysCovered: cov.covered.length, daysRequested: allDays.length,
      candidatesFound: candidates.length, processed: 0, awaitingGrading: 0, verified: 0, newestItemAt: newest, note: '',
      missingDays: cov.missing.slice(0, MISSING_CAP), missingDaysCount: cov.missing.length, storeDays: cov.fromStore,
    };
    for (const r of required) r.detail += ` (live scan is bounded to ${LIVE_SCAN_MAX_DAYS} days per run; ${days.length} of ${allDays.length} days read this run)`;
  }
  status.windowDays = inp.days; status.sourcesCount = sources.filter((x) => x.state !== 'NOT_RUN' && x.state !== 'NOT_AVAILABLE').length;
  const blobOnly = days.filter((d) => blobDays.has(d) && !dayOk.get(d) && !collDays.has(d)).length;
  status.coveredBy = { exchange: liveOk.length, blob: blobDays.size, blobOnly };
  status.coverageLabel = coverageLabel(status.daysCovered, status.daysRequested, inp.window ?? windowOfDays(inp.days)) + (blobOnly > 0 && !status.complete ? ` — PARTIAL: ${BLOB_ONLY_NOTE}` : '');
  status.status = scanState(status);
  if (blobOnly > 0 && !status.complete && status.status === 'COMPLETE') status.status = 'PARTIAL';
  status.note = scanNote(status);
  return { status, candidates, rowsSeen: rows.length, rowsRelevant: relevant.length, liveDays: liveOk };
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
  /** zzz848: sessions an earlier run already processed (persisted event store). Only used for windows longer than LIVE_SCAN_MAX_DAYS. */
  storeCovered?: ReadonlySet<string>;
  window?: GuWindow;
  /**
   * zzz857: sessions the GitHub EDGAR backfill fully indexed (KV guidance-docs:v1:coverage:US, status 'ok'). Such a day counts as
   * read for the EDGAR source and is not re-read live. Absent: taken from the real fetcher (makeRealEdgarFetcher) when it carries a
   * reader; test stubs carry none, so their behaviour is unchanged.
   */
  backfillIndexed?: ReadonlySet<string> | null;
}
/**
 * US sessions the live EDGAR index read may cover per run on a window up to LIVE_SCAN_MAX_DAYS (every session, as before, unless the
 * backfill already indexed it). zzz857: the live read shares the app's 8 req/s SEC gate and a 3-9 s slice of the route, so in production it
 * really read ~2 sessions per run; the full window now comes from the GitHub backfill (.github/scripts/edgar-guidance-backfill.mjs).
 */
export const US_LIVE_SESSIONS = 24;
/** zzz857: long windows (120D): the live read is a small recent window; the GitHub backfill indexes the rest. */
export const US_LIVE_SESSIONS_LONG = 6;
/** zzz857: the newest sessions are always read live on short windows (8-Ks keep landing through the evening), even when the backfill indexed them. */
export const US_ALWAYS_LIVE = 2;
/** zzz857: an EdgarDayFetcher may carry a reader of the days the backfill indexed (the real one does). */
export type EdgarDayFetcherWithBackfill = EdgarDayFetcher & { backfillIndexed?: () => Promise<ReadonlySet<string> | null> };
/** zzz857: which sessions the live EDGAR read covers this run (newest first). Pure. */
export function pickUsLiveDates(allDates: readonly string[], o: { long: boolean; backfill?: ReadonlySet<string> | null; store?: ReadonlySet<string> }): string[] {
  const elsewhere = (d: string): boolean => !!o.backfill?.has(d) || (o.long && !!o.store?.has(d));
  const recent = allDates.slice(0, o.long ? 3 : US_ALWAYS_LIVE);
  const rest = allDates.slice(recent.length).filter((d) => !elsewhere(d));
  // short window: every session not indexed elsewhere (no backfill record = every session, unchanged); long window: the small recent window
  return [...recent, ...rest].slice(0, o.long ? US_LIVE_SESSIONS_LONG : US_LIVE_SESSIONS);
}
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const isWeekend = (d: string): boolean => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };

export async function scanUs(inp: UsScanInput): Promise<MarketScanResult> {
  const { now } = inp;
  const allDates = usSessionDates(now, inp.days);
  const long = inp.days > LIVE_SCAN_MAX_DAYS;
  // zzz857: days the GitHub EDGAR backfill indexed count as read and are not re-read live (except the newest sessions)
  let backfill: ReadonlySet<string> | null = inp.backfillIndexed ?? null;
  const bfReader = (inp.fetchEdgar as EdgarDayFetcherWithBackfill | undefined)?.backfillIndexed;
  if (inp.backfillIndexed === undefined && bfReader) backfill = await bfReader().catch(() => null);
  const dates = pickUsLiveDates(allDates, { long, backfill, store: inp.storeCovered });   // the live EDGAR read stays small; the backfill and earlier runs supply the rest
  const skippedStore = long ? allDates.filter((d) => !dates.includes(d) && !backfill?.has(d) && inp.storeCovered?.has(d)).length : 0;
  const sources: GuScanSource[] = [];
  const total = inp.totalSessions || allDates.length;
  const warm = inp.warmSessions;
  const storeOnly = long && inp.storeCovered ? allDates.filter((d) => inp.storeCovered!.has(d) && !(inp.warmDates?.has(d))).length : 0;
  const gradedOk = long ? warm + storeOnly : warm;
  sources.push({ name: 'Graded results cache', tier: 'SECONDARY', daysTried: allDates.slice(), daysOk: allDates.filter((d) => inp.warmDates?.has(d)), state: total === 0 ? 'NOT_RUN' : gradedOk >= total ? 'COMPLETE' : gradedOk === 0 ? 'FAILED' : 'PARTIAL', scanned: warm,
    detail: gradedOk >= total ? `${warm} of ${total} sessions graded${storeOnly ? `; ${storeOnly} carried from the persisted store` : ''}`
      : `${warm} of ${total} sessions graded${storeOnly ? `, ${storeOnly} carried from the persisted store` : ''}; ${total - gradedOk} awaiting grading` });

  let awaiting = 0; let rowsSeen = 0; let edgarDays = 0;
  const edgarOkDays: string[] = []; const edgarFail: string[] = [];
  const awaitingDocs: AwaitingDoc[] = [];
  const coldDays = new Set<string>();
  if (inp.fetchEdgar) {
    const fe = inp.fetchEdgar;
    const res = await runBounded(dates, (d) => fe(d), { concurrency: 3, budgetMs: inp.budgetMs ?? SCAN_BUDGET_MS });
    const cold = coldDays;
    for (const r of res) {
      if (!r.ok || !Array.isArray(r.value)) { edgarFail.push(r.error || 'failed'); continue; }
      edgarDays++; edgarOkDays.push(r.item);
      const hits = r.value.filter((x) => x.form === '8-K' && x.items.some((i) => i === '2.02' || i === '7.01'));
      rowsSeen += hits.length;
      const dayWarm = inp.warmDates ? inp.warmDates.has(r.item) : warm >= total;
      for (const h of hits) {
        const t = (h.ticker || '').toUpperCase();
        if (t && inp.gradedTickers?.has(t)) continue;
        if (!dayWarm || !t) { awaiting++; cold.add(r.item); if (h.filing_url) awaitingDocs.push({ ticker: t || null, company: h.company || null, filed: h.filed || r.item, url: h.filing_url, form: h.form, day: r.item }); }
      }
    }
    // zzz857: backfill-indexed sessions not read live this run (or whose live read failed) count as indexed
    const bfOnly = backfill ? allDates.filter((d) => backfill!.has(d) && !edgarOkDays.includes(d)) : [];
    const tried = [...dates.filter((d) => !bfOnly.includes(d)), ...bfOnly];
    const edgarTotal = long || bfOnly.length ? allDates.length : dates.length; const edgarOk = edgarDays + skippedStore + bfOnly.length;
    const bfTail = bfOnly.length ? `, ${bfOnly.length} more indexed by the GitHub EDGAR backfill (press releases handed to the document extractor)` : '';
    sources.push({ name: 'SEC EDGAR 8-K (items 2.02/7.01)', tier: 'PRIMARY', daysTried: tried, daysOk: [...edgarOkDays, ...bfOnly], failReasons: [...new Set(edgarFail)].slice(0, 3), state: stateFor(edgarOk, edgarTotal), scanned: rowsSeen,
      detail: edgarOk === edgarTotal ? `${edgarDays} of ${dates.length} sessions indexed${bfTail}${skippedStore ? `, ${skippedStore} more already processed by earlier runs` : ''}; ${awaiting} filing${awaiting === 1 ? '' : 's'} not yet graded (index only, no release text read)`
        : `EDGAR index read for ${edgarDays} of ${dates.length} sessions${bfTail}${long || bfOnly.length ? ` (the live index read is a small recent window of up to ${long ? US_LIVE_SESSIONS_LONG : US_LIVE_SESSIONS} sessions; the full window is read by the GitHub EDGAR backfill; ${allDates.length - edgarOk} sessions of the window not indexed yet)` : ''}` });
  } else sources.push({ name: 'SEC EDGAR 8-K (items 2.02/7.01)', tier: 'PRIMARY', daysTried: dates.slice(), daysOk: [], state: 'NOT_RUN', scanned: 0, detail: 'not run' });

  const edgar = sources[1];
  // Graded sessions are what turn an 8-K into a guidance candidate; EDGAR alone only indexes filers.
  let status: GuScanStatus;
  const warmSet = inp.warmDates ?? new Set<string>();
  const liveWarm = allDates.filter((d) => warmSet.has(d) && !coldDays.has(d));
  if (!long) {
    // zzz857: a session the backfill indexed (its press releases are with the document extractor) counts as covered, alongside graded sessions
    const daysCovered = backfill && backfill.size
      ? Math.min(total, inp.warmDates ? allDates.filter((d) => (warmSet.has(d) && !coldDays.has(d)) || backfill!.has(d)).length : Math.max(warm, allDates.filter((d) => backfill!.has(d)).length))
      : Math.min(warm, total);
    const complete = sources[0].state === 'COMPLETE' && edgar.state === 'COMPLETE' && daysCovered === total && awaiting === 0;
    status = {
      market: 'US', windowFrom: dates[dates.length - 1] ?? '', windowTo: dates[0] ?? '', complete, lastScanAt: now.toISOString(), sources,
      daysCovered, daysRequested: total, candidatesFound: 0, processed: 0, awaitingGrading: awaiting, verified: 0, newestItemAt: null, note: '',
    };
  } else {
    // long window, in CALENDAR days: a weekend needs nothing; a session is covered when graded (and not waiting on ungraded filers) or already processed earlier
    const cal: string[] = []; for (let i = 0; i < Math.min(inp.days, 130); i++) { const d = etFmt.format(new Date(now.getTime() - i * 86_400_000)); if (!cal.includes(d)) cal.push(d); }
    const live = new Set<string>([...cal.filter(isWeekend), ...liveWarm, ...(backfill ? cal.filter((d) => backfill!.has(d) && !coldDays.has(d)) : [])]);
    const cov = computeCoverage({ days: cal, live, graded: null, store: inp.storeCovered });
    const storeSeen = inp.storeCovered ? cal.filter((d) => inp.storeCovered!.has(d)).length : 0;
    sources.push({ name: 'Persisted event store', scanned: storeSeen, tier: 'SECONDARY', state: storeSeen === 0 ? 'NOT_AVAILABLE' : cov.missing.length === 0 ? 'COMPLETE' : 'PARTIAL',
      detail: storeSeen === 0 ? 'no stored history yet: long-window coverage builds up run by run as each scan is saved' : `${storeSeen} of ${cal.length} days already processed by earlier runs; ${cov.missing.length} still missing` });
    const complete = sources[0].state === 'COMPLETE' && edgar.state === 'COMPLETE' && cov.missing.length === 0 && awaiting === 0;
    status = {
      market: 'US', windowFrom: cal[cal.length - 1] ?? '', windowTo: cal[0] ?? '', complete, lastScanAt: now.toISOString(), sources,
      daysCovered: cov.covered.length, daysRequested: cal.length, candidatesFound: 0, processed: 0, awaitingGrading: awaiting, verified: 0, newestItemAt: null, note: '',
      missingDays: cov.missing.slice(0, MISSING_CAP), missingDaysCount: cov.missing.length, storeDays: cov.fromStore,
    };
  }
  status.windowDays = inp.days; status.sourcesCount = sources.filter((x) => x.state !== 'NOT_RUN' && x.state !== 'NOT_AVAILABLE').length; status.unprocessed = awaiting;
  status.coverageLabel = coverageLabel(status.daysCovered, status.daysRequested, inp.window ?? windowOfDays(inp.days));
  status.status = scanState(status);
  status.note = scanNote(status);
  return { status, candidates: [], rowsSeen, rowsRelevant: rowsSeen, liveDays: liveWarm, awaitingDocs };
}

/** zzz849: the one wording for days covered only by the optional scraped blob while the exchange feeds failed. */
export { BLOB_ONLY_NOTE };
/** Plain note that never turns an incomplete scan into "nothing happened". */
export function scanNote(s: GuScanStatus): string {
  const name = s.market === 'IN' ? 'India' : 'US';
  const blobTail = s.coveredBy?.blobOnly ? ` ${s.coveredBy.blobOnly} of the covered days were ${BLOB_ONLY_NOTE} (blob is an optional source, so this is PARTIAL, not full coverage).` : '';
  if (s.complete) return `${name} scan complete: ${s.daysCovered} of ${s.daysRequested} days, every required source answered.`;
  if (s.windowDays && s.windowDays > LIVE_SCAN_MAX_DAYS && s.coverageLabel) {
    const bad = s.sources.filter((x) => x.state !== 'COMPLETE' && x.state !== 'NOT_RUN').map((x) => `${x.name}: ${x.detail}`);
    const wait = (s.unprocessed ?? s.awaitingGrading) > 0 ? `; ${s.unprocessed ?? s.awaitingGrading} filing${(s.unprocessed ?? s.awaitingGrading) === 1 ? '' : 's'} awaiting grading` : '';
    return `SCAN INCOMPLETE — ${name}: ${s.coverageLabel}${bad.length ? `; ${bad.join('; ')}` : ''}${wait}.${blobTail} Zero events shown is NOT a confirmation of no upgrades.`;
  }
  const bad = s.sources.filter((x) => x.state !== 'COMPLETE' && x.state !== 'NOT_RUN').map((x) => x.detail).concat(s.sources.filter((x) => x.state === 'NOT_RUN' && !/optional/.test(x.detail)).map((x) => `${x.name} not run`));
  return `SCAN INCOMPLETE — ${name}: ${s.daysCovered} of ${s.daysRequested} days covered${bad.length ? `; ${bad.join('; ')}` : ''}${(s.unprocessed ?? s.awaitingGrading) ? `; ${s.unprocessed ?? s.awaitingGrading} filing${(s.unprocessed ?? s.awaitingGrading) === 1 ? '' : 's'} awaiting grading` : ''}.${blobTail} Zero events shown is NOT a confirmation of no upgrades.`;
}

/** After the engine ran: fill processed / verified / candidatesFound and re-stamp the note. */
export function finaliseScan(s: GuScanStatus, n: { found: number; processed: number; verified: number; newest?: string | null; unprocessed?: number }): GuScanStatus {
  const out: GuScanStatus = { ...s, candidatesFound: n.found, processed: n.processed, verified: n.verified, newestItemAt: n.newest ?? s.newestItemAt };
  if (typeof n.unprocessed === 'number') {
    // zzz848: filings seen whose raise text was never read are NOT processed: the scan cannot be COMPLETE while any wait
    out.unprocessed = n.unprocessed; out.awaitingGrading = n.unprocessed;
    if (n.unprocessed > 0) out.complete = false;
  }
  if (out.windowDays) { out.status = scanState(out); out.sourcesCount = out.sources.filter((x) => x.state !== 'NOT_RUN' && x.state !== 'NOT_AVAILABLE').length; }
  out.note = scanNote(out);
  return out;
}

/** Dedupe key helper for merging: a scan candidate on the same day as a cached one. */
export const candidateDay = dayOfCandidate;

// ── real fetcher wiring (used by the route; tests inject stubs instead) ──────────────────────────────────────────
const BLOB_KEY = 'corp-filings:v1:latest';
/** The scraper keeps the newest N announcements. A blob holding N rows was cut off, so its oldest day is partial. */
export const BLOB_CAP = 500;
const rowsOfBlob = (v: any): any[] | null => (Array.isArray(v) ? v : Array.isArray(v?.filings) ? v.filings : null);
/** The IST days the scraped blob really covers: from its oldest complete day to the day it was generated (or its newest row). Null when it holds nothing readable. */
export function blobCoverage(v: any, cap: number = BLOB_CAP): { from: string; to: string; rows: number; truncated: boolean } | null {
  const rows = rowsOfBlob(v);
  if (!rows || !rows.length) return null;
  const days: string[] = [];
  for (const r of rows) { const t = parseWhen(r?.filing_datetime ?? r?.filing_date ?? r?.an_dt ?? r?.NEWS_DT); if (t) days.push(istDate(new Date(t))); }
  if (!days.length) return null;
  days.sort();
  const gen = parseWhen(v?.generatedAt ?? v?.generated_at);
  const last = gen && istDate(new Date(gen)) > days[days.length - 1] ? istDate(new Date(gen)) : days[days.length - 1];
  const truncated = rows.length >= cap;
  let from = days[0];
  if (truncated) { const next = new Date(Date.parse(`${from}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); from = next <= last ? next : last; }   // the oldest day may be cut off: not counted
  return { from, to: last, rows: rows.length, truncated };
}
/** Per-day reader for the scraped blob. Returns null for a day the blob does not cover, so such a day is never counted as read. `load` is injected (tests pass a stub). */
export function makeBlobReader(load: () => Promise<any>, cap: number = BLOB_CAP): BlobReader {
  return async (day) => {
    const v: any = await load();
    const cov = blobCoverage(v, cap);
    const rows = rowsOfBlob(v);
    if (!cov || !rows || day < cov.from || day > cov.to) return null;
    return rows.filter((r) => { const t = parseWhen(r?.filing_datetime ?? r?.filing_date ?? r?.an_dt ?? r?.NEWS_DT); return !!t && istDate(new Date(t)) === day; });
  };
}
export function makeRealIndiaFetchers(): { nse: DayFetcher; bse: DayFetcher; blob: BlobReader; collector: () => Promise<ReadonlySet<string> | null> } {
  const mk = (which: 'NSE' | 'BSE'): DayFetcher => async (day, signal) => {
    const feed = await import('./nse-bse-feed');
    const r: any = which === 'NSE'
      ? await feed.fetchNSEAnnouncements({ fromIso: day, toIso: day, signal })
      : await feed.fetchBSEAnnouncements({ fromIso: day, toIso: day, pages: 2, signal });
    const src = String(r?.source || '');
    const blocked = src.endsWith('_BLOCKED');
    const filings = Array.isArray(r?.filings) ? r.filings : [];
    // *_EMPTY on a weekend is a real answer; *_BLOCKED is a failure. zzz853: an EMPTY answer for a WEEKDAY is not trusted: an exchange that refuses this server
    // often answers 200 with no rows, which is indistinguishable from a quiet day, so the day is NOT counted as read (failed / unknown, never 'complete, 0 scanned').
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const suspectEmpty = !blocked && src.endsWith('_EMPTY') && filings.length === 0 && dow !== 0 && dow !== 6;
    return { ok: !blocked && !suspectEmpty, filings, reason: blocked ? (r?.reason || src) : suspectEmpty ? `${which} returned zero rows for a trading day (cannot be told from a blocked feed), so the day is not counted as read` : undefined };
  };
  let latest: Promise<any> | null = null;
  // What the GitHub scraper really writes: ONE blob 'corp-filings:v1:latest' { generatedAt, filings[] } (last ~3 days, newest 500).
  // There is no per-day key. A day counts as covered only when the blob's own date range holds it (see makeBlobReader).
  const blob = makeBlobReader(async () => {
    const { kvGet } = await import('./kv');
    if (!latest) latest = kvGet<any>(BLOB_KEY).catch(() => null);
    return latest;
  });
  // zzz866: days the GitHub India collector indexed (KV guidance-docs:v1:coverage:IN); null when nothing is stored
  const collector = async () => { const { readIndiaCollectorDays } = await import('./us-edgar-backfill'); return readIndiaCollectorDays(); };
  return { nse: mk('NSE'), bse: mk('BSE'), blob, collector };
}

export function makeRealEdgarFetcher(): EdgarDayFetcherWithBackfill {
  const f: EdgarDayFetcherWithBackfill = async (day) => {
    const { edgarFilingsOn } = await import('./us-edgar');
    return edgarFilingsOn(day, ['8-K']);
  };
  // zzz857: the days the GitHub EDGAR backfill indexed (KV guidance-docs:v1:coverage:US); null when nothing is stored yet
  f.backfillIndexed = async () => { const { readUsBackfillIndexedDays } = await import('./us-edgar-backfill'); return readUsBackfillIndexedDays(); };
  return f;
}
