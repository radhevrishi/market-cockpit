// zzz849 — Reconcile EVENTS (Layer B) with the persistent guidance UNIVERSE (Layer A).
// An event candidate that has only news / a filing subject ("DETECTED, Before DATA UNAVAILABLE") can be enriched from the universe
// record for the same company when that record holds a source-backed RAISED point. Every number used is a number the record already holds
// (its own verbatim statement, or its stated prior and new growth); nothing is calculated or invented here.
// Provenance stays honest: the record's own verification tier is carried, and a media-only record is never promoted to VERIFIED.
// Pure and read-only. The universe lib/service are only READ (types here; the loader imports them lazily and fails to "no enrichment").
import type { GuCandidate, GuEventV2, GuMetric } from './guidance-upgrades-types';
import type { GuSkeleton, GuExtra } from './guidance-upgrades';
import { extractGuidance } from './guidance-upgrades';
import type { GuUniverseRecordX } from './guidance-universe';

type NumbersFrom = NonNullable<GuEventV2['numbersFrom']>;
/** how far after the record's source date a re-reporting event may fall and still be the same announcement */
export const RECONCILE_MAX_LAG_DAYS = 21;
/** an event may be dated this many days BEFORE the record's source date (a record dated by its later write-up) */
export const RECONCILE_MAX_LEAD_DAYS = 1;

const METRIC_WORD: Record<string, string> = { REVENUE: 'revenue', PAT: 'net profit', EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'free cash flow' };
const GU_METRIC: Record<string, GuMetric> = { REVENUE: 'REVENUE', PAT: 'NET_PROFIT', EPS: 'EPS', EBITDA: 'EBITDA', FCF: 'FCF' };
const dayNum = (iso: string): number => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const num = (n: number): string => String(Math.round(n * 100) / 100);
const rng = (lo: number, hi: number | null): string => (hi == null || hi === lo ? `${num(lo)}%` : `${num(lo)}-${num(hi)}%`);

export interface UniverseHit { key: string; market: 'IN' | 'US'; ticker: string; company: string; date: string; extra: GuExtra }
export type UniverseLookup = Map<string, UniverseHit[]>;
export const lookupKey = (market: string, ticker: string): string => `${market === 'US' ? 'US' : 'IN'}:${String(ticker || '').trim().toUpperCase()}`;

/**
 * One candidate per (record, source, date): the record's own verbatim statements for its RAISED points, so the engine reads the numbers
 * the same way it reads any other text. A point is used only when it has a source name, a date, a statement and either a statement the engine
 * can read as before-and-after numbers, or STATED (never implied) growth with a stated prior.
 */
export function universeLookup(records: readonly GuUniverseRecordX[]): UniverseLookup {
  const out: UniverseLookup = new Map();
  for (const r of records || []) {
    const market: 'IN' | 'US' = r.record?.market === 'US' ? 'US' : 'IN';
    const bySource = new Map<string, { points: Array<{ p: GuUniverseRecordX['points'][number]; text: string }> }>();
    for (const p of r.points || []) {
      if (p.revision !== 'RAISED' || !p.sourceName || !p.sourceDate || !p.statement?.trim()) continue;
      if (p.verification === 'UNVERIFIED') continue;
      let text = p.statement.trim();
      const parsed = extractGuidance(text).filter((c) => !!c.before && c.direction === 'UP');
      if (!parsed.length) {
        // no readable before-and-after in the statement: only STATED growth with a stated prior can be put into words from the record's own numbers
        const prior = (p.priors || []).filter((x) => x.low != null).slice(-1)[0];
        if (p.implied || p.low == null || !prior || prior.low == null) continue;
        text = `Management raised ${p.period} ${METRIC_WORD[p.metric] || String(p.metric).toLowerCase()} growth guidance to ${rng(p.low, p.high)} from ${rng(prior.low, prior.high)}.`;
      }
      const k = `${p.sourceName}|${p.sourceDate}`;
      (bySource.get(k) || bySource.set(k, { points: [] }).get(k)!).points.push({ p, text });
    }
    for (const [k, grp] of Array.from(bySource.entries())) {
      const first = grp.points[0].p;
      const verified = grp.points.every((x) => x.p.verification === 'VERIFIED') && grp.points.every((x) => x.p.primarySource);
      const date = String(first.sourceDate);
      const company = r.record?.company || r.names?.[0] || '';
      const tickers = (r.tickers && r.tickers.length ? r.tickers : r.record?.ticker ? [r.record.ticker] : []).map((t) => String(t).toUpperCase());
      const verification = verified ? 'VERIFIED' : grp.points.every((x) => x.p.verification === 'SECONDARY_ONLY') ? 'SECONDARY_ONLY' : 'PARTIALLY_VERIFIED';
      const metrics = grp.points.map((x) => `${METRIC_WORD[x.p.metric] || x.p.metric} ${x.p.period} ${x.p.display}`).join('; ');
      for (const ticker of tickers) {
        const cand: GuCandidate = {
          id: `universe:${market}:${ticker}:${k.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, ticker, company, market,
          title: `${company} raised guidance (guidance universe record)`, text: grp.points.map((x) => x.text).join(' '),
          url: first.sourceUrl || undefined, sourceName: first.sourceName, publishedAt: date,
          // PRIMARY only when the record itself is VERIFIED against a primary document; a media record stays a news-level source
          kind: verified ? 'FILING' : 'NEWS',
        };
        const numbersFrom: NumbersFrom = {
          origin: 'UNIVERSE_RECORD', verification, sourceName: first.sourceName, sourceDate: date, sourceUrl: first.sourceUrl || null,
          metric: grp.points.map((x) => x.p.metric).join(', '), period: Array.from(new Set(grp.points.map((x) => x.p.period))).join(', '), display: metrics,
          note: `Numbers from universe record, source: ${first.sourceName} (${date}); the record is ${verification.replace(/_/g, ' ').toLowerCase()}${verified ? '' : ', so this is not confirmed by a primary document'}`,
        };
        const key = lookupKey(market, ticker);
        (out.get(key) || out.set(key, []).get(key)!).push({ key, market, ticker, company, date, extra: { cand, numbersFrom } });
      }
    }
  }
  return out;
}

/** Hook for the engine: the universe candidates for a skeleton that has NO before-and-after numbers of its own. */
export function makeExtraFor(lookup: UniverseLookup | null | undefined): ((sk: GuSkeleton) => GuExtra[]) | undefined {
  if (!lookup || !lookup.size) return undefined;
  return (sk) => {
    const hits = lookup.get(lookupKey(sk.market === 'US' ? 'US' : 'IN', sk.ticker)) || [];
    const ev = dayNum(sk.announcement_date);
    return hits.filter((h) => { const d = ev - dayNum(h.date); return d >= -RECONCILE_MAX_LEAD_DAYS && d <= RECONCILE_MAX_LAG_DAYS; }).map((h) => h.extra);
  };
}

/** Candidate tickers for the loader: only what the page is about to build events for. */
export async function loadUniverseRecords(tickers: { IN: string[]; US: string[] }, now: Date): Promise<GuUniverseRecordX[]> {
  try {
    const [{ buildUniverse }, svc, led] = await Promise.all([import('./guidance-universe'), import('./guidance-universe-service'), import('./growth-guidance-ledger')]);
    const seed = svc.getSeedRows();
    const [sIN, sUS] = await Promise.all([led.readGuStored('IN').catch(() => null), led.readGuStored('US').catch(() => null)]);
    const ledgerRows: Array<{ market: 'IN' | 'US'; ticker: string; entries: any[] }> = [];
    for (const m of ['IN', 'US'] as const) {
      const list = Array.from(new Set(tickers[m])).slice(0, 80);
      if (!list.length) continue;
      const map = await led.readGgLedgers(list, m).catch(() => new Map<string, any[]>());
      for (const [ticker, entries] of Array.from(map.entries())) if (entries?.length) ledgerRows.push({ market: m, ticker, entries });
    }
    const stored = [...(sIN?.rows || []), ...(sUS?.rows || [])];
    return buildUniverse([], ledgerRows, seed.rows, now, { stored }).records;
  } catch { return []; }
}

// ═══ zzz854: the EVENTS layer's verdict per company + metric + period, for the universe to reconcile against ═══════════════════════
// One status per (event, changed metric): RAISED / REITERATED / LOWERED / MIXED / INVALID (not guidance) / NO_NUMBERS.
// Built from the event engine's OWN classification (never from a headline verb). The universe uses only VERIFIED statuses to override a record.
import type { GuidanceEvent } from './guidance-upgrades-types';
import type { GgMetric } from './growth-guidance-types';
import type { GuEventStatus, GuEventStatusKind } from './guidance-universe-types';
import { normPeriod } from './guidance-universe-integrity';
import { nonGuidanceRaiseSentence } from './guidance-upgrades-candidates';

const EV_METRIC: Partial<Record<string, GgMetric>> = { REVENUE: 'REVENUE', REVENUE_GROWTH: 'REVENUE', NET_PROFIT: 'PAT', EBITDA: 'EBITDA', EPS: 'EPS', ADJ_EPS: 'EPS', FCF: 'FCF' };
const STATUS_LABEL: Record<GuEventStatusKind, string> = { RAISED: 'GUIDANCE RAISED', REITERATED: 'GUIDANCE REITERATED', LOWERED: 'GUIDANCE LOWERED', MIXED: 'MIXED / RANGE CHANGE', INVALID: 'NOT GUIDANCE', NO_NUMBERS: 'NUMBERS NOT FOUND' };
const ptText = (p: { low: number | null; high: number | null; currency?: string; unit?: string; isGrowthRate?: boolean } | null | undefined): string | null => {
  if (!p || p.low == null) return null;
  const u = p.isGrowthRate ? '%' : p.unit || ''; const c = p.isGrowthRate ? '' : p.currency || '';
  const f = (n: number) => `${c}${String(Math.round(n * 100) / 100)}${u}`;
  return p.high != null && p.high !== p.low ? `${f(p.low)}–${f(p.high)}` : f(p.low);
};
/** The event agent may add a taxonomy field; read it defensively (string or { kind }). Unknown values fall back to `classification`. */
const taxonomyOf = (e: GuidanceEvent): string | null => {
  const t: any = (e as any).taxonomy ?? (e as any).guidanceTaxonomy ?? (e as any).eventTaxonomy ?? null;
  const s = typeof t === 'string' ? t : typeof t?.kind === 'string' ? t.kind : typeof t?.bucket === 'string' ? t.bucket : null;
  return s ? s.toUpperCase() : null;
};
/** The event-level verdict. A capital-raise narrative (or an event the counts demoted as not guidance) is INVALID. */
export function eventVerdictOf(e: GuidanceEvent): { status: GuEventStatusKind; reason: string | null } {
  const demoted: any = (e as any).invariantDemoted;
  if (demoted?.excluded || nonGuidanceRaiseSentence(e.whyNow || '')) return { status: 'INVALID', reason: demoted?.reasons?.[0] || 'the narrative describes a capital raise, not guidance' };
  const t = taxonomyOf(e) || '';
  if (/INVALID|NOT_GUIDANCE|CAPITAL/.test(t)) return { status: 'INVALID', reason: 'classified as not guidance' };
  if (/REITERAT|MAINTAIN|UNCHANGED/.test(t)) return { status: 'REITERATED', reason: null };
  if (/LOWER|DOWNGRADE|CUT/.test(t)) return { status: 'LOWERED', reason: null };
  if (/MIXED|RANGE/.test(t)) return { status: 'MIXED', reason: null };
  if (/FIRST|INITIAL|NUMBERS_NOT_FOUND|NO_NUMBERS|DETECTED|AWAITING/.test(t)) return { status: 'NO_NUMBERS', reason: null };
  if (/RAISE|UPGRADE/.test(t)) return { status: 'RAISED', reason: null };
  const c = e.classification ?? (e.v2?.eventClass === 'UPGRADE' ? 'RAISE' : e.v2?.eventClass === 'REITERATION' ? 'REITERATION' : e.v2?.eventClass === 'DOWNGRADE' ? 'DOWNGRADE' : e.v2?.eventClass === 'NO_RAISE' ? 'MIXED' : 'DETECTED');
  return { status: c === 'RAISE' ? 'RAISED' : c === 'REITERATION' ? 'REITERATED' : c === 'DOWNGRADE' ? 'LOWERED' : c === 'MIXED' ? 'MIXED' : 'NO_NUMBERS', reason: null };
}
/** One status per (event, changed metric with a stated period). Per-change direction refines a MIXED event (a metric that went down is LOWERED). */
export function eventStatusesOf(events: readonly GuidanceEvent[]): GuEventStatus[] {
  const out: GuEventStatus[] = [];
  for (const e of events || []) {
    if (!e || !e.ticker || !e.announcement_date || (e.market !== 'IN' && e.market !== 'US')) continue;
    const v = eventVerdictOf(e);
    const primary = (e.sources || []).find((s) => s.tier === 'PRIMARY') || e.sources?.[0];
    for (const ch of e.changes || []) {
      const metric = EV_METRIC[ch.metric]; if (!metric) continue;
      const per = ch.after?.period && ch.after.period !== 'UNSTATED' ? normPeriod(ch.after.period) : 'UNSTATED';
      let st: GuEventStatusKind = v.status;
      if (st === 'MIXED' || st === 'RAISED') { if (ch.direction === 'DOWN' && ch.before) st = 'LOWERED'; else if (ch.direction === 'FLAT' && ch.before) st = 'REITERATED'; }
      const b = ptText(ch.before), a = ptText(ch.after);
      out.push({ market: e.market, ticker: String(e.ticker).toUpperCase(), company: e.company, metric, period: per, date: e.announcement_date.slice(0, 10), status: st,
        verified: e.verification === 'VERIFIED' && (st === 'INVALID' || !!e.primaryAvailable),
        label: STATUS_LABEL[st], display: b && a ? `${b} → ${a}` : a, sourceName: primary?.name ?? null, sourceUrl: e.primarySourceUrl ?? primary?.url ?? null, eventId: e.guidance_event_id ?? null, reason: v.reason });
    }
  }
  return out;
}
/** Newest per (market, ticker, metric, period, date); bounded. */
export function mergeEventStatuses(a: readonly GuEventStatus[], b: readonly GuEventStatus[], max = 3000): GuEventStatus[] {
  const m = new Map<string, GuEventStatus>();
  for (const x of [...a, ...b]) { if (!x?.ticker) continue; const k = `${x.market}|${x.ticker}|${x.metric}|${x.period}|${x.date}`; const cur = m.get(k); if (!cur || (x.verified && !cur.verified)) m.set(k, x); }
  return Array.from(m.values()).sort((x, y) => y.date.localeCompare(x.date)).slice(0, max);
}

/** KV digest the events route may write after each run (compact; optional). The universe also derives statuses from the event store itself. */
export const EVENT_STATUS_KEY = 'guidance-upgrades:event-status:v1';
export const EVENT_STATUS_TTL_S = 30 * 24 * 3600;
export async function writeEventStatuses(events: readonly GuidanceEvent[]): Promise<boolean> {
  try {
    const { kvGet, kvSet } = await import('./kv');
    const prev = await kvGet<{ v: 1; statuses: GuEventStatus[] }>(EVENT_STATUS_KEY).catch(() => null);
    const statuses = mergeEventStatuses(eventStatusesOf(events), Array.isArray(prev?.statuses) ? prev!.statuses : []);
    await kvSet(EVENT_STATUS_KEY, { v: 1, updatedAt: new Date().toISOString(), statuses }, EVENT_STATUS_TTL_S); return true;
  } catch { return false; }
}
/**
 * Production loader for the universe: the persisted event store (both markets) run through the SAME event engine (pure), plus the optional digest.
 * Never throws; an unreadable store gives an empty list and says so in `source`.
 */
export async function loadEventStatuses(now: Date): Promise<{ statuses: GuEventStatus[]; source: string }> {
  const parts: string[] = []; let fromStore: GuEventStatus[] = []; let fromDigest: GuEventStatus[] = [];
  try {
    const [led, eng] = await Promise.all([import('./guidance-upgrades-ledger'), import('./guidance-upgrades')]);
    const [stIN, stUS] = await Promise.all([led.readEventStore('IN').catch(() => null), led.readEventStore('US').catch(() => null)]);
    const cands = [...led.storedCandidates(stIN), ...led.storedCandidates(stUS)];
    if (cands.length) { const evs = eng.processCandidates(cands, () => ({}), now, '120D'); fromStore = eventStatusesOf(evs); parts.push(`event store: ${evs.length} events`); }
    else parts.push('event store: empty or unreadable');
  } catch (e: any) { parts.push(`event store: failed (${String(e?.message || e).slice(0, 60)})`); }
  try {
    const { kvGet } = await import('./kv');
    const d = await kvGet<{ statuses: GuEventStatus[] }>(EVENT_STATUS_KEY);
    if (Array.isArray(d?.statuses)) { fromDigest = d!.statuses; parts.push(`digest: ${fromDigest.length}`); }
  } catch { /* optional */ }
  return { statuses: mergeEventStatuses(fromStore, fromDigest), source: parts.join('; ') };
}
