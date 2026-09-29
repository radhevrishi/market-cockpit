// ═══════════════════════════════════════════════════════════════════════════
// CATALYST RESEARCH — WHAT THE PAGE IS SHOWN.                        (zzz769)
//
// Pure helpers shared by the research route and the page (no server imports,
// so the client bundle can use them): entity cleanup of stored text, the
// short error lines, and coverage measured against the CURRENT board rather
// than against every name the day's store has ever seen.
// ═══════════════════════════════════════════════════════════════════════════

import { NSE_HOLIDAYS } from '@/lib/market-hours';
import { closeMinutes, lastCompletedNyseSession } from './us-gainers';

/** HTML entities and SQL-style doubled apostrophes in stored text:
 *  "AIL Dixon&#x27;s" (zzz768), "Scrutinizer''s Report" (KTKBANK, zzz769). */
export function unEntity<T>(v: T): T {
  if (typeof v !== 'string') return v;
  return v
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/(\w)''(?=\w)/g, "$1'") as unknown as T;
}

/** Findings as the page is shown them: text decoded, and findings stored
 *  before a scoring rule tightened re-capped at read time. (zzz766–768) */
export function presentFindings<T extends Record<string, any>>(findings: T): T {
  const out: Record<string, any> = {};
  for (const [k, f0] of Object.entries(findings || {})) {
    const f = f0 ? { ...f0, headline: unEntity(f0.headline), evidenceQuote: unEntity(f0.evidenceQuote), company: unEntity(f0.company),
      notes: Array.isArray(f0.notes) ? f0.notes.map(unEntity) : f0.notes, routine: Array.isArray(f0.routine) ? f0.routine.map(unEntity) : f0.routine } : f0;
    if (f && f.status === 'catalyst' && f.category === 'fundraising'
      && /\bncds?\b|non[- ]convertible debenture|debentures?\b|commercial paper|term loan/i.test(String(f.headline || ''))
      && !/\bequity\b|preferential|\bqip\b|warrant|rights (issue|shares)/i.test(String(f.headline || ''))) {
      // Debt is financing, not a catalyst (zzz766).
      out[k] = { ...f, status: 'routine_only', headline: `Debt financing — ${String(f.headline)}`, net: null, verdict: null, components: null, notes: (f.notes || []).filter((n: string) => !/A raise is supply|Fundraising adds supply/.test(n)).concat('Borrowing is financing, not a catalyst.'), routine: [...(f.routine || []), String(f.headline)] };
      continue;
    }
    if (f && f.status !== 'catalyst' && Array.isArray(f.notes) && /\bncds?\b|debenture/i.test(String(f.headline || ''))) {
      out[k] = { ...f, notes: f.notes.filter((n: string) => !/A raise is supply|Fundraising adds supply/.test(n)) };
      continue;
    }
    out[k] = f && f.category === 'management_change' && typeof f.net === 'number' && f.net > 15
      ? { ...f, net: 15, verdict: 'WEAK' } : f;
  }
  return out as T;
}

/** One failure clause → a few words the owner can read. */
function summarizeClause(c: string): string {
  const s = c.trim();
  if (/^chart\b/i.test(s)) return 'price chart unavailable (screener.in)';
  if (/^company page\b/i.test(s)) return 'company page unavailable (screener.in)';
  if (/not in the SEC company list/i.test(s)) return 'not in the SEC company list';
  if (/edgar|\bsec\b/i.test(s)) return 'SEC EDGAR unavailable';
  if (/timed? ?out|timeout|aborted/i.test(s)) return 'timed out';
  if (/proxy|screener/i.test(s)) return 'screener.in could not be read';
  const first = s.split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '');
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

export interface ErrorLine { ticker: string | null; short: string; full: string }

/** "Last errors", readable: one short line per ticker (≤ 90 chars, the last
 *  failure wins), at most `max`, only for names still on today's board, with
 *  the full text kept for a tooltip. The proxy's paragraph-long diagnostics
 *  used to be printed whole, several times over. (zzz769) */
export function presentErrorLines(errors: string[], universe: Array<{ ticker: string }>, max = 5): ErrorLine[] {
  const on = new Set(universe.map((u) => u.ticker.toUpperCase()));
  const byKey = new Map<string, ErrorLine>();
  for (const e0 of errors || []) {
    const e = String(e0);
    const m = /^([A-Z0-9.&-]+):\s*([\s\S]*)$/.exec(e.trim());
    const ticker = m ? m[1].toUpperCase() : null;
    if (ticker && !on.has(ticker)) continue;
    const body = m ? m[2] : e;
    const parts = Array.from(new Set(body.split(/;\s+(?=[a-z][\w .-]{0,30}:)/i).map(summarizeClause).filter(Boolean)));
    const short = `${ticker ? `${ticker}: ` : ''}${parts.join(', ') || 'failed'}`;
    const key = ticker || e;
    byKey.delete(key);                               // the latest failure for a name wins, in order
    byKey.set(key, { ticker, short: short.length > 90 ? `${short.slice(0, 89)}…` : short, full: e.slice(0, 2000) });
  }
  return Array.from(byKey.values()).slice(-max);
}

/** Coverage of the CURRENT board: researched ∩ board / board. The store's
 *  own universe is every name seen today across scans — 99/99 while 26 of
 *  125 names on the board had never been looked at. (zzz769) */
export function boardCoverage(board: string[], findings: Record<string, { status?: string } | undefined>, excluded: string[] = []): { researched: number; total: number; pct: number; missing: string[]; offBoard: number } {
  const ex = new Set(excluded.map((t) => String(t).toUpperCase()));
  const uniq = Array.from(new Set(board.map((t) => String(t).toUpperCase()))).filter((t) => !ex.has(t));
  const done = (t: string) => { const f = findings?.[t]; return !!f && f.status !== 'unresearched'; };
  const missing = uniq.filter((t) => !done(t));
  const on = new Set(uniq);
  const offBoard = Object.keys(findings || {}).filter((t) => !on.has(t.toUpperCase()) && !ex.has(t.toUpperCase())).length;
  const researched = uniq.length - missing.length;
  return { researched, total: uniq.length, pct: uniq.length ? Math.round((researched / uniq.length) * 100) : 0, missing, offBoard };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MARKET RUN — SESSION, GENERATED, DATA-AS-OF, FINAL OR PROVISIONAL.
//                                                                    (zzz835)
// A US scan taken at 15:43 ET printed STATUS "Live" and nothing said the
// rankings can still change until the 16:00 close. An India report generated
// at 01:13 IST on the 29th described the 28th's session, and the two dates
// were never shown apart. Every time here is an EXCHANGE time (Intl with an
// explicit time zone — never the browser's zone). Pure: `now` is a parameter.
//
//   is_final  =  the session has closed (exchange clock)  AND  the data was
//                read at or after the close. A scan taken at 15:43 ET is
//                PROVISIONAL forever — even when the page is opened at 17:00 —
//                until it is rescanned after 16:00 ET.
// Early closes (13:00 ET) come from the NYSE table in us-gainers.
// ═══════════════════════════════════════════════════════════════════════════


export type SessionStatus = 'pre_market' | 'live' | 'closed' | 'stale';

export interface MarketRun {
  market: 'IN' | 'US';
  /** The trading date the moves belong to (exchange date), or null when unknown. */
  sessionDate: string | null;
  exchangeTimezone: 'America/New_York' | 'Asia/Kolkata';
  /** When the scan was generated (ISO instant). */
  generatedAt: string | null;
  /** When the prices were read — the scan instant. */
  dataAsOf: string | null;
  sessionStatus: SessionStatus;
  /** The session's close as an ISO instant. */
  marketCloseAt: string | null;
  isFinal: boolean;
  /** !isFinal — the rankings can still change. */
  provisional: boolean;
  /** One plain sentence saying why (final or provisional). */
  reason: string;
}

const TZ = { US: 'America/New_York', IN: 'Asia/Kolkata' } as const;
const OPEN_MIN = { US: 9 * 60 + 30, IN: 9 * 60 + 15 } as const;
const CLOSE_MIN_IN = 15 * 60 + 30;
const CLOSE_LABEL = { US: 'ET', IN: 'IST' } as const;

function tzOffsetMin(tz: string, at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const g = (t: string) => parseInt(p.find((x) => x.type === t)?.value || '0', 10);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant at which the wall clock in `tz` reads `ymd` + `minutes` after midnight. */
export function zonedInstant(ymd: string, minutes: number, tz: string): Date {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000;
  let t = guess - tzOffsetMin(tz, new Date(guess)) * 60_000;
  t = guess - tzOffsetMin(tz, new Date(t)) * 60_000;
  return new Date(t);
}

/** The exchange calendar date (YYYY-MM-DD) of an instant, in that market's own zone. */
export function exchangeDateOf(market: 'IN' | 'US', at: Date): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ[market], year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).slice(0, 10); } catch { return at.toISOString().slice(0, 10); }
}

/** Whole calendar days from `fromYmd` to `toYmd` (both exchange dates); null if either is not a date. */
export function calendarDaysBetween(fromYmd: string | null | undefined, toYmd: string | null | undefined): number | null {
  const ok = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
  if (!ok(fromYmd) || !ok(toYmd)) return null;
  const a = Date.parse(`${String(fromYmd).slice(0, 10)}T00:00:00Z`), b = Date.parse(`${String(toYmd).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

const isInTradingDay = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d !== 0 && d !== 6 && !NSE_HOLIDAYS.has(ymd); };
function lastCompletedInSession(now: Date): string {
  let ymd = exchangeDateOf('IN', now);
  const mins = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ.IN, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now); return parseInt(p.find((x) => x.type === 'hour')?.value || '0', 10) * 60 + parseInt(p.find((x) => x.type === 'minute')?.value || '0', 10); })();
  if (isInTradingDay(ymd) && mins >= CLOSE_MIN_IN) return ymd;
  for (let i = 0; i < 12; i++) { ymd = new Date(Date.parse(`${ymd}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10); if (isInTradingDay(ymd)) return ymd; }
  return ymd;
}

/** Session state and finality for one scan. `now` = the moment being asked about (the page passes the clock; a server build without one uses the scan instant). */
export function marketRunOf(o: { market: 'IN' | 'US'; sessionDate: string | null | undefined; scanAt: string | null | undefined; now?: string | Date | null }): MarketRun {
  const market = o.market === 'US' ? 'US' : 'IN';
  const tz = TZ[market];
  const lab = CLOSE_LABEL[market];
  const scanT = o.scanAt ? Date.parse(o.scanAt) : NaN;
  const generatedAt = Number.isFinite(scanT) ? new Date(scanT).toISOString() : null;
  const nowT = o.now instanceof Date ? o.now.getTime() : o.now ? Date.parse(o.now) : NaN;
  const ref = Number.isFinite(nowT) ? nowT : scanT;
  const sessionDate = o.sessionDate && /^\d{4}-\d{2}-\d{2}/.test(String(o.sessionDate)) ? String(o.sessionDate).slice(0, 10) : null;
  const base = { market, sessionDate, exchangeTimezone: tz, generatedAt, dataAsOf: generatedAt } as const;
  if (!sessionDate || !Number.isFinite(ref)) {
    return { ...base, sessionStatus: 'stale', marketCloseAt: null, isFinal: false, provisional: true, reason: 'The session date or the scan time is not known, so the rankings cannot be called final.' };
  }
  const closeMin = market === 'US' ? closeMinutes(sessionDate) : CLOSE_MIN_IN;
  const openAt = zonedInstant(sessionDate, OPEN_MIN[market], tz).getTime();
  const closeAtD = zonedInstant(sessionDate, closeMin, tz);
  const closeT = closeAtD.getTime();
  const closeClock = `${String(Math.floor(closeMin / 60)).padStart(2, '0')}:${String(closeMin % 60).padStart(2, '0')} ${lab}`;
  const closed = ref >= closeT;
  let status: SessionStatus = ref < openAt ? 'pre_market' : closed ? 'closed' : 'live';
  if (closed) {
    const refD = new Date(ref);
    const newer = market === 'US' ? lastCompletedNyseSession(refD) > sessionDate : lastCompletedInSession(refD) > sessionDate;
    if (newer) status = 'stale';
  }
  const dataAfterClose = Number.isFinite(scanT) && scanT >= closeT;
  const isFinal = closed && dataAfterClose;
  const scanClock = Number.isFinite(scanT) ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(scanT)) + ` ${lab}` : 'an unknown time';
  const reason = isFinal
    ? `Session ${sessionDate} closed at ${closeClock}; the data was read at ${scanClock}, after the close.`
    : !closed
      ? `PROVISIONAL — the ${sessionDate} session is ${status === 'pre_market' ? 'not open yet' : 'still open'} (close ${closeClock}); prices and rank can change until the close.`
      : `PROVISIONAL — the ${sessionDate} session has closed, but this data was read at ${scanClock}, before the ${closeClock} close; press Rescan for the final moves.`;
  return { ...base, sessionStatus: status, marketCloseAt: closeAtD.toISOString(), isFinal, provisional: !isFinal, reason };
}

/** "Mon 28 Sep 15:43 ET" — an instant on the market's own clock, with its date. */
export function exchangeStamp(market: 'IN' | 'US', iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  try {
    const d = new Date(t);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ[market], weekday: 'short', day: '2-digit', month: 'numeric' }).formatToParts(d);
    const g = (t: string) => parts.find((x) => x.type === t)?.value || '';
    const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = `${g('weekday')} ${g('day')} ${MO[parseInt(g('month'), 10) - 1] || ''}`;
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ[market], hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return `${day} ${hm} ${CLOSE_LABEL[market]}`;
  } catch { return null; }
}

/** The one catalyst-window sentence, from the same numbers the badge logic uses. */
export function windowSentence(market: 'IN' | 'US', w: { thisMove: number; recent: number }): string {
  return `${market === 'IN' ? 'India' : 'US'}: filed within ${w.thisMove} calendar day${w.thisMove === 1 ? '' : 's'} of the session (${market === 'IN' ? 'India' : 'New York'} date) = this move; up to ${w.recent} days = recent; older = context only`;
}

