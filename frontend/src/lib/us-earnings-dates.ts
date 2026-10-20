// ═══════════════════════════════════════════════════════════════════════════
// US EARNINGS — DAY BOUNDARIES, SNAPSHOT FRESHNESS, TICKER MATCHING, AND
// COUNTED EXCLUSIONS.  Pure helpers: no fetch, no server-only imports, so the
// page, the routes and the tests all use the same rules.
//
// THE DAY BOUNDARY IS US EASTERN, ALWAYS
// ──────────────────────────────────────
// A US session is a New York calendar day. A release at 16:05 ET on 24 Sep is
// 01:35 IST on 25 Sep and 20:05 UTC on 24 Sep; it belongs to 24 Sep. The old
// code took "today" as UTC−4 — right in summer (EDT), an hour early in winter
// (EST), where the date flipped at 23:00 ET. America/New_York handles both.
//
// A SNAPSHOT OF A DAY IS ONLY FINAL IF IT WAS TAKEN AFTER THE DAY ENDED
// ─────────────────────────────────────────────────────────────────────
// Every cache in the US pipeline used "is this date in the past?" — evaluated
// at READ time — to pick a 24h–30d TTL. So a list of 24 Sep filers fetched at
// 09:00 ET on 24 Sep (before the after-close reporters had filed) became, at
// midnight, a "completed day" and was served for a month. That is how names
// that reported after 09:00 went missing from a day for good. A snapshot is
// final only if it was TAKEN after the ET midnight that closed the day.
// ═══════════════════════════════════════════════════════════════════════════

const ET_TZ = 'America/New_York';
const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

let _etFmt: Intl.DateTimeFormat | null = null;
function etFmt(): Intl.DateTimeFormat {
  if (!_etFmt) {
    _etFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: ET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  }
  return _etFmt;
}

/** The US Eastern calendar date (YYYY-MM-DD) at a UTC instant. */
export function usEasternDate(utcMs: number = Date.now()): string {
  const parts = etFmt().formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && ISO_RE.test(s);

export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}

export function isWeekendIso(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6;
}

/** The weekday before `iso` (holidays are not known here — a holiday simply
 *  has no schedule, which the callers treat as "no evidence"). */
export function prevWeekdayIso(iso: string): string {
  let d = addDaysIso(iso, -1);
  while (isWeekendIso(d)) d = addDaysIso(d, -1);
  return d;
}

/** UTC ms of 00:00 US Eastern on the day AFTER `iso` — the instant the ET
 *  session `iso` is over. DST changes at 02:00, so midnight is always either
 *  04:00 UTC (EDT) or 05:00 UTC (EST). */
export function etMidnightAfterUtcMs(iso: string): number {
  const next = addDaysIso(iso, 1);
  const base = Date.parse(next + 'T00:00:00Z');
  const edt = base + 4 * 3600_000;
  if (usEasternDate(edt) === next && usEasternDate(edt - 1) !== next) return edt;
  return base + 5 * 3600_000;
}

/** A snapshot of day `iso` taken at `fetchedAtMs` covers the whole ET day. */
export function isFinalSnapshot(iso: string, fetchedAtMs: number): boolean {
  if (!Number.isFinite(fetchedAtMs)) return false;
  return fetchedAtMs >= etMidnightAfterUtcMs(iso);
}

/**
 * Is a cached snapshot of day `iso` still usable?
 *   • taken after the day ended  → final, good for `finalTtlMs`
 *   • taken during the day, and the day has since ended → NOT usable: it
 *     misses everything filed after it was taken (refetch once, then final)
 *   • taken during the day, day still running (or in the future) → `liveTtlMs`
 */
export function snapshotFresh(
  iso: string, fetchedAtMs: number, nowMs: number, liveTtlMs: number, finalTtlMs: number,
): boolean {
  if (!Number.isFinite(fetchedAtMs)) return false;
  const age = nowMs - fetchedAtMs;
  if (age < 0) return false;
  const end = etMidnightAfterUtcMs(iso);
  if (fetchedAtMs >= end) return age < finalTtlMs;
  if (nowMs >= end) return false;
  return age < liveTtlMs;
}

// ─── tickers ──────────────────────────────────────────────────────────────
/** One spelling for a share-class ticker across vocabularies: SEC writes
 *  BRK-B, Nasdaq's calendar BRK/B or BRK.B, TradingView BRK.B. Used only for
 *  MATCHING — the displayed ticker is left as the source gave it. */
export function normalizeUsTicker(t: unknown): string {
  return String(t ?? '').trim().toUpperCase().replace(/[./\s]+/g, '-');
}

// ─── after-close 8-Ks dated the next business day ─────────────────────────
//
// EDGAR stamps an 8-K accepted after its 17:30 ET cutoff with the NEXT
// business day's filing date. An after-close release that reaches EDGAR late
// in the evening is therefore filed "tomorrow", and the calendar listed it a
// day late (and, on the real day, as "reported without an 8-K"). The only
// honest evidence we have is the company's own confirmed schedule: if Nasdaq
// listed the ticker AFTER-HOURS on the previous weekday and does NOT list it
// on the filing day, the release belongs to the previous weekday. Anything
// else is left exactly where EDGAR put it.
export interface ScheduleHint { ticker: string; time: string }

export function afterHoursAnnouncementDate(
  ticker: string,
  filedOn: string,
  scheduleFor: (iso: string) => ScheduleHint[] | null | undefined,
): string | null {
  const t = normalizeUsTicker(ticker);
  const today = scheduleFor(filedOn) || [];
  if (today.some((r) => normalizeUsTicker(r.ticker) === t)) return null;
  const prev = prevWeekdayIso(filedOn);
  const y = scheduleFor(prev) || [];
  const hit = y.find((r) => normalizeUsTicker(r.ticker) === t);
  if (hit && /after/i.test(hit.time)) return prev;
  return null;
}

// ─── zzz912 — the EDGAR filing date RIGHT NOW ─────────────────────────────
//
// The same 17:30 ET cutoff, seen from the clock: from 17:30 ET on a weekday
// until midnight, every new 8-K carries the NEXT weekday's filing date. A
// sweep at 20:00 ET that asks only for "today" therefore never sees the
// evening reporters — they sit under tomorrow's date, which the grader used
// to refuse as "the future". This is the latest filing date that can already
// hold filings (holidays are not known here; a holiday simply has none).
export const EDGAR_CUTOFF_ET_MIN = 17 * 60 + 30;

/** Minutes after midnight US Eastern at a UTC instant. */
export function etMinutesOfDay(utcMs: number = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ET_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utcMs));
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return (h % 24) * 60 + m;
}

/** The newest EDGAR filing date in use at `utcMs`: today (ET), or the next weekday once a weekday passes 17:30 ET. */
export function edgarFilingDateNow(utcMs: number = Date.now()): string {
  const today = usEasternDate(utcMs);
  if (isWeekendIso(today) || etMinutesOfDay(utcMs) < EDGAR_CUTOFF_ET_MIN) return today;
  let d = addDaysIso(today, 1);
  while (isWeekendIso(d)) d = addDaysIso(d, 1);
  return d;
}

// ─── counted exclusions ───────────────────────────────────────────────────
export type ExclusionCounts = Record<string, number>;

export function countExclusion(m: ExclusionCounts, reason: string, n = 1): ExclusionCounts {
  if (n > 0) m[reason] = (m[reason] || 0) + n;
  return m;
}

export function mergeExclusions(...ms: Array<ExclusionCounts | null | undefined>): ExclusionCounts {
  const out: ExclusionCounts = {};
  for (const m of ms) if (m) for (const [k, v] of Object.entries(m)) countExclusion(out, k, v);
  return out;
}

/** "3 excluded: 2 not on a major US exchange, 1 shell/SPAC" — or '' for none. */
export function formatExclusions(m: ExclusionCounts | null | undefined): string {
  if (!m) return '';
  const rows = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!rows.length) return '';
  const total = rows.reduce((n, [, v]) => n + v, 0);
  return `${total} excluded: ${rows.map(([k, v]) => `${v} ${k}`).join(', ')}`;
}

// ─── the page's remembered date ───────────────────────────────────────────
//
// The page used to remember the selected date verbatim. Open it on Monday,
// come back on Thursday, and it reopened on MONDAY — every name that reported
// since was "missing". A date is now remembered as "pinned" only when the
// reader picked a day other than today; a remembered today means today.
export function encodeSelectedDate(date: string, today: string): string {
  return JSON.stringify({ d: date, pinned: date !== today });
}

export function restoreSelectedDate(stored: string | null | undefined, today: string): string {
  if (!stored) return today;
  try {
    const o = JSON.parse(stored);
    if (o && typeof o === 'object' && isIsoDate(o.d) && o.pinned === true) {
      return o.d > today ? today : o.d;
    }
  } catch { /* legacy plain string */ }
  // A legacy bare date cannot say whether it was "today" when saved. Today is
  // the answer that can never hide a fresh report.
  return today;
}

// ─── is the XBRL on file this filing's quarter? ───────────────────────────
//
// For an earnings 8-K, companyfacts usually still holds the PREVIOUS quarter.
// The route treated "XBRL quarter filed > 7 days before this 8-K" as "this
// 8-K is not the announcement" — true for AIN (a strategic-review 8-K 63
// days after its quarter), but also true for every fast reporter whose last
// quarter ended < 110 days ago: a bank reporting Q2 on 14 Jul holds Q1
// (31 Mar, 105 days) in XBRL, filed in May, and was dropped as
// "reported earlier". If a whole fiscal quarter (≥ 80 days — Costco-style
// 12-week quarters are 84) has elapsed since the XBRL quarter end, a NEWER
// quarter has closed and this 8-K is most likely its announcement: that is
// "numbers not posted yet" (PRELIM candidate), not "reported earlier".
export type XbrlFreshness = 'current' | 'quarter-stale' | 'reported-earlier';
export const MIN_QUARTER_DAYS = 80;

export function classifyXbrlFreshness(p: {
  filed: string; qEnd: string; qFiled: string | null;
  maxLagDays?: number; alreadyPublicDays?: number; checkAlreadyPublic?: boolean;
}): XbrlFreshness {
  const maxLag = p.maxLagDays ?? 110;
  const pub = p.alreadyPublicDays ?? 7;
  const days = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);
  const lag = days(p.filed, p.qEnd);
  if (lag > maxLag) return 'quarter-stale';
  if (p.checkAlreadyPublic !== false && p.qFiled && days(p.filed, p.qFiled) > pub) {
    return lag >= MIN_QUARTER_DAYS ? 'quarter-stale' : 'reported-earlier';
  }
  return 'current';
}

/** zzz1163 — the filing that announced the quarter ending `qEnd`: the latest earnings 8-K filed between the quarter end and a
 *  week after its 10-Q/10-K, else the periodic filing itself. Null when neither is known. Pure. */
export function announcingFiling(f: { cikNum: number; _earnings8k?: Array<{ filingDate: string; accession: string }>; _periodic?: { filingDate: string; accession: string; form: string } | null },
  qEnd: string | null, qFiled: string | null): { filed: string; accession: string; form: string; items: string[]; filing_url: string } | null {
  if (!qEnd) return null;
  const lim = qFiled ? new Date(Date.parse(`${qFiled}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10) : null;
  const url = (acc: string) => `https://www.sec.gov/Archives/edgar/data/${f.cikNum}/${acc.replace(/-/g, '')}/${acc}-index.htm`;
  const hit = (f._earnings8k || []).filter((x) => x.filingDate > qEnd && (!lim || x.filingDate <= lim)).sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
  if (hit) return { filed: hit.filingDate, accession: hit.accession, form: '8-K', items: ['2.02'], filing_url: url(hit.accession) };
  const p = f._periodic;
  if (p && p.filingDate > qEnd) return { filed: p.filingDate, accession: p.accession, form: p.form, items: [], filing_url: url(p.accession) };
  return null;
}
