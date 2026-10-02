import { GUIDANCE_BEARING_SUBJECT } from './guidance-watch';
// zzz853 — source reconciliation: company announcement date, primary-source search, and the queue inputs they produce.
// Pure and deterministic (no network): the route hands in the candidates and filings it already read.
//
//  assignEventDates  a media candidate takes the COMPANY's announcement date from the matching primary candidate (same company with
//                    identical guided numbers at any age, or a raise-bearing filing within +-10 days). Windows then filter on that date,
//                    so a media article republished today never moves an 80-day-old event into a 7D window.
//  reconcilePrimary  for each not-yet-verified event, search the filings already loaded (+-10 days, same company, AGM / presentation /
//                    outcome / results subject). Found: attach primarySourceUrl and queue it P0 ('PRIMARY SOURCE FOUND'). Not found:
//                    'SECONDARY-SOURCE CLAIM' with 'Primary source: not found in the filings read so far'.
import type { GuCandidate, GuidanceEvent, GuPrimaryState, GuSourceRef } from './guidance-upgrades-types';
import { extractGuidance, PRIMARY_NOT_FOUND_TEXT, primaryStateFor, withClassification } from './guidance-upgrades';
import { isRaiseBearingSubject, normCompanyName } from './guidance-upgrades-candidates';
import { priorityOf, type QueueInput } from './guidance-upgrades-queue';

export const PRIMARY_MATCH_DAYS = 10;
const day = (s: string): string => String(s || '').slice(0, 10);
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${day(a)}T00:00:00Z`) - Date.parse(`${day(b)}T00:00:00Z`)) / 86_400_000);
const isPrimaryCand = (c: GuCandidate): boolean => c.kind === 'FILING' || c.kind === 'RELEASE' || c.kind === 'TRANSCRIPT' || c.kind === 'DECK' || c.id.startsWith('graded:') || c.id.startsWith('us-graded:') || c.id.startsWith('queue:');
const sameCompany = (a: { ticker?: string; company?: string }, b: { ticker?: string; company?: string }): boolean => {
  if (a.ticker && b.ticker) return a.ticker.toUpperCase() === b.ticker.toUpperCase();
  const ka = normCompanyName(a.company || ''); const kb = normCompanyName(b.company || '');
  return !!ka && ka === kb;
};
const afterKeys = (c: GuCandidate): Set<string> => {
  const out = new Set<string>();
  for (const ch of extractGuidance(`${c.title}. ${c.text}`)) {
    if (ch.after.low == null && ch.after.high == null) continue;
    out.add(`${ch.metric}|${ch.after.period}|${ch.after.low}|${ch.after.high}`);
  }
  return out;
};

/** Media candidates take the company's announcement date from the matching primary candidate. Never changes `publishedAt` (that stays the media date). */
export function assignEventDates(cands: readonly GuCandidate[]): { cands: GuCandidate[]; reassigned: number } {
  // index the primaries by symbol and by normalised company name, so the cost stays linear in the number of media candidates
  const byKey = new Map<string, { p: GuCandidate; keys: Set<string> }[]>();
  const keyOf = (c: { ticker?: string; company?: string }): string[] => {
    const out: string[] = [];
    if (c.ticker) out.push(`T:${c.ticker.toUpperCase()}`);
    const n = normCompanyName(c.company || ''); if (n) out.push(`N:${n}`);
    return out;
  };
  for (const p of cands) {
    if (!isPrimaryCand(p)) continue;
    const entry = { p, keys: afterKeys(p) };
    for (const k of keyOf(p)) { const l = byKey.get(k) || []; l.push(entry); byKey.set(k, l); }
  }
  let reassigned = 0;
  const out = cands.map((c) => {
    if (c.eventDate || isPrimaryCand(c)) return c;
    const pool = new Set<{ p: GuCandidate; keys: Set<string> }>();
    for (const k of keyOf(c)) for (const e of byKey.get(k) || []) pool.add(e);
    if (!pool.size) return c;
    const mine = afterKeys(c);
    let best: string | null = null;
    for (const { p, keys } of pool) {
      if (!sameCompany(c, p)) continue;
      const sameNumbers = mine.size > 0 && [...mine].some((k) => keys.has(k));                       // identical guided numbers: the same announcement at any age
      const nearFiling = Math.abs(dayDiff(p.publishedAt, c.publishedAt)) <= PRIMARY_MATCH_DAYS && (isRaiseBearingSubject(p.title) || keys.size > 0);
      if (!sameNumbers && !nearFiling) continue;
      const d = day(p.eventDate || p.publishedAt);
      if (!best || d < best) best = d;
    }
    if (!best || best >= day(c.publishedAt)) return c;
    reassigned++;
    return { ...c, eventDate: best };
  });
  return { cands: out, reassigned };
}

/** A filing (or SEC document) the route already loaded. `anySubject` lets an SEC 8-K 2.02/7.01 stand in without a subject line. */
export interface PrimaryFiling { market: 'IN' | 'US'; ticker?: string; company?: string; subject: string; date: string; url?: string | null; exchange: string; anySubject?: boolean }

export interface ReconcileResult { events: GuidanceEvent[]; found: number; notFound: number; queueInputs: QueueInput[] }

const stripOpenManual = (s: string): boolean => /^open (?:the )?(?:company'?s? |attached |exchange )?(?:filing|document|investor)/i.test(s) || /^open the .*filing/i.test(s);

export function reconcilePrimary(events: readonly GuidanceEvent[], filings: readonly PrimaryFiling[]): ReconcileResult {
  const queueInputs: QueueInput[] = []; let found = 0; let notFound = 0;
  const out = events.map((e) => {
    if (e.verification === 'VERIFIED' || e.primaryAvailable) return e;
    const hits = filings.filter((f) => f.market === (e.market === 'US' ? 'US' : 'IN') && sameCompany({ ticker: e.ticker, company: e.company }, f)
      && (f.anySubject || isRaiseBearingSubject(f.subject)) && Math.abs(dayDiff(f.date, e.announcement_date)) <= PRIMARY_MATCH_DAYS)
      .sort((a, b) => Math.abs(dayDiff(a.date, e.announcement_date)) - Math.abs(dayDiff(b.date, e.announcement_date)) || a.date.localeCompare(b.date));
    if (!hits.length) {
      notFound++;
      const gap = PRIMARY_NOT_FOUND_TEXT;
      const ps = primaryStateFor({ url: null, searched: true });
      return withClassification({ ...e, primaryState: ps.state as GuPrimaryState, primaryStateText: ps.text, primarySourceUrl: null,
        evidenceGaps: e.evidenceGaps.includes(gap) ? e.evidenceGaps : [gap, ...e.evidenceGaps] });
    }
    found++;
    const h = hits[0];
    const url = h.url || null;
    const ps = primaryStateFor({ url });
    const gap = url
      ? `Primary source found: ${h.exchange} filing of ${h.date} ("${h.subject.slice(0, 90)}"). It is queued for automated reading (priority P0); the figures are not confirmed from it yet`
      : `Awaiting primary source: ${h.exchange} filing of ${h.date} ("${h.subject.slice(0, 90)}") is listed but has no document link`;
    const next = url ? 'Primary document is queued for automated reading; the result updates on a later run' : 'Awaiting the document link for the exchange filing';
    const ref: GuSourceRef = { url: url ?? undefined, name: `${h.exchange} filing`, tier: 'SECONDARY', type: url ? 'Exchange filing (primary document found, queued for reading)' : 'Exchange filing (no document link)', date: h.date };
    const sources = e.sources.some((s) => s.url && url && s.url === url) ? e.sources : [...e.sources, ref];
    const filedDay = day(h.date);
    const earlier = filedDay && filedDay < day(e.announcement_date);
    queueInputs.push({ market: e.market === 'US' ? 'US' : 'IN', ticker: e.ticker, company: e.company, sourceUrl: url, sourceType: h.exchange, subject: h.subject, eventDate: filedDay, priority: 'P0' });
    return withClassification({
      ...e, sources, primarySourceUrl: url, primarySourceDate: filedDay, primaryState: ps.state as GuPrimaryState, primaryStateText: ps.text,
      // the announcement is the company's filing, never the later media date
      ...(earlier ? { announcement_date: filedDay, announcement_timestamp: undefined, media_date: e.media_date && e.media_date < day(e.announcement_date) ? e.media_date : day(e.announcement_date), dateBasis: 'ANNOUNCEMENT' as const } : {}),
      evidenceGaps: [gap, ...e.evidenceGaps.filter((g) => g !== gap)],
      nextEvidence: [next, ...e.nextEvidence.filter((n) => n !== next && !stripOpenManual(n))].slice(0, 3),
    });
  });
  return { events: out, found, notFound, queueInputs };
}

/** Queue inputs for every filing that names a guidance-bearing document. P0 when a not-yet-verified event of the same company is waiting on it. */
export function queueInputsFromFilings(filings: readonly PrimaryFiling[], matched: ReadonlySet<string> = new Set(), watched?: (s: { market: string; ticker?: string | null; company?: string | null }) => boolean): QueueInput[] {
  const out: QueueInput[] = []; const seen = new Set<string>();
  for (const f of filings) {
    const watch = !!watched && watched({ market: f.market, ticker: f.ticker, company: f.company }) && GUIDANCE_BEARING_SUBJECT.test(f.subject);   // zzz862: a company that already has guidance: its new results / call / presentation filing is always read, first
    if (!(f.anySubject || isRaiseBearingSubject(f.subject) || watch)) continue;
    const k = `${f.market}|${f.url || ''}|${f.ticker || f.company}|${day(f.date)}|${f.subject.slice(0, 50)}`;
    if (seen.has(k)) continue; seen.add(k);
    const waiting = watch || matched.has(`${f.market}|${(f.ticker || '').toUpperCase()}`);
    out.push({ market: f.market, ticker: f.ticker, company: f.company, sourceUrl: f.url ?? null, sourceType: f.exchange, subject: f.subject, eventDate: day(f.date), priority: waiting ? 'P0' : priorityOf(f.subject, f.exchange) });
  }
  return out;
}
