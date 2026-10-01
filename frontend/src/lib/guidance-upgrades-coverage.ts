// zzz853 — the canonical coverage model. One CoverageCard per market, built from the scan status, so the page can never show
// "7 of 7 days covered" next to "NSE failed". Pure and deterministic; the route passes in what it read.
//
// Rules (each one has a test):
//  - A failed query is never ZERO_RESULTS (it is UNKNOWN). EMPTY (query worked, zero rows) is never COMPLETE.
//  - A day is READ only when EVERY PRIMARY exchange feed answered it. A fallback (scraped blob) or a cache never makes a day read.
//  - read + partial + failed === attempted, always.
//  - Overall COMPLETE only if every PRIMARY source is COMPLETE, no day is missing and no document awaits grading.
import type {
  CoverageCard, CoverageOverall, CoverageSourceRow, CoverageSourceStatus, GuCacheRow, GuCoverageBlock, GuScanSource, GuScanStatus, GuWindow,
} from './guidance-upgrades-types';

const isWeekdayStr = (d: string): boolean => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };
const dayList = (now: Date, n: number): string[] => Array.from({ length: n }, (_, i) => new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));

/** One source row. queryStatus says whether the question was answered at all; dataStatus says what the answer held. */
export function sourceRow(s: GuScanSource): CoverageSourceRow {
  const tier = s.tier ?? 'SECONDARY';
  const tried = s.daysTried?.length ?? 0;
  const ok = s.daysOk?.length ?? 0;
  let queryStatus: CoverageSourceRow['queryStatus'];
  if (s.state === 'NOT_AVAILABLE' || s.state === 'NOT_RUN') queryStatus = 'NOT_AVAILABLE';
  else if (s.state === 'FAILED') queryStatus = 'FAILED';
  else if (tried > 0 && ok === 0) queryStatus = 'FAILED';
  else queryStatus = 'SUCCESS';
  // a failed query is UNKNOWN, never ZERO_RESULTS
  const dataStatus: CoverageSourceRow['dataStatus'] = queryStatus !== 'SUCCESS' ? 'UNKNOWN' : s.scanned > 0 ? 'DATA_FOUND' : 'ZERO_RESULTS';
  let status: CoverageSourceStatus;
  if (queryStatus !== 'SUCCESS') status = 'FAILED';
  else if (s.state === 'PARTIAL' || (tried > 0 && ok < tried)) status = 'PARTIAL';
  else if (dataStatus === 'ZERO_RESULTS') status = 'EMPTY';
  else status = 'COMPLETE';
  const reason = status === 'COMPLETE' ? s.detail
    : status === 'EMPTY' ? `${s.detail || 'query worked'}; zero rows returned (EMPTY is not COMPLETE)`
    : status === 'PARTIAL' ? s.detail
    : `${queryStatus === 'NOT_AVAILABLE' ? 'not available' : 'query failed'}${s.failReasons?.length ? ` (${s.failReasons.join('; ')})` : ''}: ${s.detail}`;
  return { name: s.name, tier, queryStatus, dataStatus, status, recordsRead: s.scanned, reason, daysAttempted: tried, daysSucceeded: ok };
}

export interface CardInput {
  market: 'IN' | 'US';
  window: GuWindow; windowDays: number; now: Date;
  scan: GuScanStatus;
  cache?: GuCacheRow[];
  fallbackNote?: string | null;
  documentsAwaitingGrading?: number; documentsUnavailable?: number;
  candidatesDiscovered?: number; processed?: number; verified?: number;
}

export function buildCoverageCard(i: CardInput): CoverageCard {
  const sources = i.scan.sources.map(sourceRow);
  const primary = i.scan.sources.filter((s) => (s.tier ?? 'SECONDARY') === 'PRIMARY');
  const fallback = i.scan.sources.filter((s) => s.tier === 'FALLBACK');

  // the calendar of the window, and the trading days (weekdays) the exchanges owe
  const gen = dayList(i.now, i.windowDays);
  const calendar = [...new Set([...gen, ...i.scan.sources.flatMap((s) => s.daysTried ?? [])])].sort().reverse().slice(0, Math.max(i.windowDays, 1));
  const inWin = new Set(calendar);
  const trading = calendar.filter(isWeekdayStr);

  const attemptedSet = new Set<string>();
  for (const s of [...primary, ...fallback]) for (const d of s.daysTried ?? []) if (inWin.has(d) && isWeekdayStr(d)) attemptedSet.add(d);
  const attempted = [...attemptedSet];

  let read = 0; let primaryPartial = 0; let fallbackOnly = 0; let failed = 0;
  for (const d of attempted) {
    const answered = primary.filter((s) => s.daysOk?.includes(d)).length;
    if (primary.length > 0 && answered === primary.length) read++;
    else if (answered > 0) primaryPartial++;
    else if (fallback.some((s) => s.daysOk?.includes(d))) fallbackOnly++;   // labelled partial coverage, never covered
    else failed++;
  }
  const partial = primaryPartial + fallbackOnly;
  const notAttempted = Math.max(0, trading.length - attempted.length);
  const fromEarlier = Math.min(notAttempted, Math.max(0, i.scan.storeDays ?? 0));
  const unreadDays = notAttempted - fromEarlier;

  const awaiting = Math.max(0, i.documentsAwaitingGrading ?? 0);
  const unavailable = Math.max(0, i.documentsUnavailable ?? 0);
  const primaryRows = sources.filter((r) => r.tier === 'PRIMARY');
  const anyPrimaryAnswered = primaryRows.some((r) => r.daysSucceeded > 0 || (r.queryStatus === 'SUCCESS' && r.daysAttempted === 0));

  let overall: CoverageOverall; let overallReason: string;
  if (primaryRows.length === 0 || !anyPrimaryAnswered) {
    overall = 'FAILED'; overallReason = 'no primary exchange feed answered for any day';
  } else {
    const notComplete = primaryRows.filter((r) => r.status !== 'COMPLETE');
    if (notComplete.length === 0 && failed === 0 && partial === 0 && unreadDays === 0 && awaiting === 0) { overall = 'COMPLETE'; overallReason = 'every primary source answered every trading day and nothing awaits grading'; }
    else {
      overall = 'PARTIAL';
      const why: string[] = [];
      if (notComplete.length) why.push(`${notComplete.map((r) => `${r.name} ${r.status}`).join(', ')}`);
      if (failed) why.push(`${failed} day${failed === 1 ? '' : 's'} nobody answered`);
      if (partial) why.push(`${partial} day${partial === 1 ? '' : 's'} partly covered`);
      if (unreadDays) why.push(`${unreadDays} day${unreadDays === 1 ? '' : 's'} not read this run`);
      if (awaiting) why.push(`${awaiting} document${awaiting === 1 ? '' : 's'} awaiting grading`);
      overallReason = why.join('; ');
    }
  }
  const mk = i.market === 'IN' ? 'India' : 'US';
  const headline = overall === 'COMPLETE' ? `${mk}: coverage complete (${read} of ${trading.length} trading days read from primary sources)`
    : overall === 'FAILED' ? `${mk}: scan failed (${overallReason}); this says nothing about whether events exist`
    : `${mk}: coverage partial, ${read} of ${trading.length} trading days fully read from primary sources (${overallReason})`;
  return {
    market: i.market, requestedWindow: i.window, windowDays: i.windowDays, calendarDays: calendar.length, tradingDays: trading.length,
    daysAttempted: attempted.length, daysSuccessfullyRead: read, daysPartialCoverage: partial, daysPrimaryPartial: primaryPartial, daysFallbackOnly: fallbackOnly,
    daysFailed: failed, daysNotAttempted: notAttempted, daysFromEarlierRuns: fromEarlier,
    coveredLabel: `${read} of ${trading.length} trading days read from primary exchange feeds`,
    partialLabel: partial > 0 ? `${partial} day${partial === 1 ? '' : 's'} with partial coverage (${primaryPartial ? `${primaryPartial} answered by only some primary feeds` : ''}${primaryPartial && fallbackOnly ? ', ' : ''}${fallbackOnly ? `${fallbackOnly} covered only by a scraped copy` : ''}); not counted as covered` : null,
    sources, cache: i.cache ?? [], fallbackNote: i.fallbackNote ?? null,
    documentsAwaitingGrading: awaiting, documentsUnavailable: unavailable,
    candidatesDiscovered: i.candidatesDiscovered ?? 0, processed: i.processed ?? 0, verified: i.verified ?? 0,
    overall, overallReason, headline,
  };
}

/** Why India and US show the same window, and where a producer still uses another one. */
export function windowNoteText(window: GuWindow, windowDays: number): string {
  return `Both markets use the requested ${window} window (${windowDays} calendar days ending today). Windows filter on the company announcement date only; a media article republished later never moves an event into a shorter window. `
    + 'The growth-guidance universe producer (growth-guidance-live) reads a fixed 14-day window of its own for its candidate list, so a 7D page can include universe items up to 14 days old until that producer takes the page window; events here are always cut at the requested window.';
}

export function buildCoverageBlock(cards: CoverageCard[], window: GuWindow, windowDays: number, now: Date): GuCoverageBlock {
  return { window, windowDays, cards, windowNote: windowNoteText(window, windowDays), generatedAt: now.toISOString() };
}

/** Contradictions that must be impossible. Returns one sentence per broken rule (empty = consistent). */
export function checkCoverageCard(c: CoverageCard): string[] {
  const v: string[] = [];
  const id = c.market;
  if (c.daysSuccessfullyRead + c.daysPartialCoverage + c.daysFailed !== c.daysAttempted) v.push(`${id}: read + partial + failed does not equal days attempted`);
  if (c.daysSuccessfullyRead > c.daysAttempted || c.daysAttempted > c.tradingDays) v.push(`${id}: days read, attempted and trading days are out of order`);
  if (c.daysPartialCoverage !== c.daysPrimaryPartial + c.daysFallbackOnly) v.push(`${id}: partial days do not add up`);
  if (c.daysAttempted + c.daysNotAttempted !== c.tradingDays) v.push(`${id}: attempted + not attempted does not equal trading days`);
  const primary = c.sources.filter((s) => s.tier === 'PRIMARY');
  if (c.overall === 'COMPLETE') {
    if (primary.some((s) => s.status !== 'COMPLETE')) v.push(`${id}: overall COMPLETE while a primary source is not COMPLETE`);
    if (c.daysFailed > 0 || c.daysPartialCoverage > 0) v.push(`${id}: overall COMPLETE while days failed or are partial`);
    if (c.documentsAwaitingGrading > 0) v.push(`${id}: overall COMPLETE while documents await grading`);
  }
  if (c.overall !== 'FAILED' && primary.length > 0 && primary.every((s) => s.queryStatus === 'FAILED')) v.push(`${id}: every primary query failed but overall is not FAILED`);
  for (const s of c.sources) {
    if (s.queryStatus !== 'SUCCESS' && s.dataStatus === 'ZERO_RESULTS') v.push(`${id}: ${s.name} failed but is reported as zero results`);
    if (s.status === 'EMPTY' && s.dataStatus !== 'ZERO_RESULTS') v.push(`${id}: ${s.name} is EMPTY without a zero-result answer`);
    if (s.status === 'COMPLETE' && (s.queryStatus !== 'SUCCESS' || s.dataStatus === 'ZERO_RESULTS')) v.push(`${id}: ${s.name} is COMPLETE without data`);
    if (s.tier === 'FALLBACK' && s.status === 'COMPLETE' && c.daysSuccessfullyRead > 0 && primary.every((p) => p.daysSucceeded === 0)) v.push(`${id}: fallback days counted as covered`);
  }
  if (c.verified > c.processed || c.processed > c.candidatesDiscovered) v.push(`${id}: verified, processed and discovered are out of order`);
  return v;
}
