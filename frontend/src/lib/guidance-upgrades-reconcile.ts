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
