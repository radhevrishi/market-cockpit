// zzz843 — small persistent ledger of past guidance per ticker (KV). Server-only. Public company data only.
// key 'guidance-ledger:v1:<ticker>', 400-day TTL, bounded rows, idempotent by guidance_event_id.
import { kvGet, kvSet, kvMGet } from '@/lib/kv';
import type { GuCandidate, GuGuidancePoint, GuLedgerRow, GuSourceRef, GuidanceEvent } from './guidance-upgrades-types';
import { fmtPoint } from './guidance-upgrades-format';

export const LEDGER_TTL_S = 400 * 24 * 3600;
const MAX_ROWS = 60;
const MAX_IDS = 120;
/** India (and legacy) keys are unchanged. US keys carry a market prefix so a US and an India ticker with the same letters never share history. */
export type LedgerMarket = 'IN' | 'US';
export const ledgerKey = (ticker: string, market: LedgerMarket = 'IN') =>
  market === 'US' ? `guidance-ledger:v1:us:${ticker.toUpperCase()}` : `guidance-ledger:v1:${ticker.toUpperCase()}`;

export interface TickerLedger { rows: GuLedgerRow[]; points: GuGuidancePoint[]; ids: string[] }

export async function readLedgers(tickers: string[], market: LedgerMarket = 'IN'): Promise<Map<string, TickerLedger>> {
  const out = new Map<string, TickerLedger>();
  const list = Array.from(new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))).slice(0, 200);
  if (!list.length) return out;
  try {
    const vals = await kvMGet<TickerLedger>(list.map((t) => ledgerKey(t, market)));
    list.forEach((t, i) => { const v = vals[i]; if (v && Array.isArray(v.rows)) out.set(t, { rows: v.rows, points: Array.isArray(v.points) ? v.points : [], ids: Array.isArray(v.ids) ? v.ids : [] }); });
  } catch { /* cold store: history simply starts empty */ }
  return out;
}

export function ledgerRowsOf(e: GuidanceEvent): GuLedgerRow[] {
  return e.changes.map((c) => ({
    date: e.announcement_date, metric: c.after.metric, period: c.after.period, text: fmtPoint(c.after),
    change: c.direction === 'UP' ? 'RAISED' : c.direction === 'DOWN' ? 'CUT' : c.direction === 'FLAT' ? 'REITERATED' : 'INITIAL',
    result: 'PENDING',
  }));
}

/** Verified events only. Skips an event already stored. Returns how many tickers were written. */
export async function writeEvents(events: GuidanceEvent[], existing: Map<string, TickerLedger>, market: LedgerMarket = 'IN'): Promise<number> {
  let n = 0;
  const byTicker = new Map<string, GuidanceEvent[]>();
  for (const e of events) if (e.verification === 'VERIFIED' && e.ticker) byTicker.set(e.ticker.toUpperCase(), [...(byTicker.get(e.ticker.toUpperCase()) || []), e]);
  for (const [t, evs] of Array.from(byTicker.entries())) {
    const cur = existing.get(t) || { rows: [], points: [], ids: [] };
    const fresh = evs.filter((e) => !cur.ids.includes(e.guidance_event_id));
    if (!fresh.length) continue;
    const next: TickerLedger = {
      rows: [...cur.rows, ...fresh.flatMap(ledgerRowsOf)].slice(-MAX_ROWS),
      points: [...cur.points, ...fresh.flatMap((e) => e.changes.map((c) => c.after))].slice(-MAX_ROWS),
      ids: [...cur.ids, ...fresh.map((e) => e.guidance_event_id)].slice(-MAX_IDS),
    };
    try { await kvSet(ledgerKey(t, market), next, LEDGER_TTL_S); n++; } catch { /* the page still works without history */ }
  }
  return n;
}


// ═══════════════════════════════════════════════════════════════════════════
// zzz848: persisted RAISE EVENTS, so a long window (120D) is never a 120-day scrape per page load.
// key 'guidance-upgrades:events:v1:<IN|US>', ~400-day TTL. Written after each run (bounded, idempotent), merged on read.
// One record per canonical event (company + metric + period + announcement date, the engine's guidance_event_id).
// Reuters / Business Standard / Moneycontrol / NSE reports of the same raise are ONE record with several sources (source hashes).
// The record keeps the raw candidates (trimmed), so the SAME engine rebuilds the event on read: nothing is stored that the engine could not derive again.
// `covered` = days an earlier run processed completely. It is what lets "Coverage: X/120 days" count days beyond the live caches honestly.
// The event date is the SOURCE date (publishedAt / filing date). firstSeenAt is when we saw it, never used as the event date.
// ═══════════════════════════════════════════════════════════════════════════
export const EVENTS_TTL_S = 400 * 24 * 3600;
export const EVENTS_MAX = 500;                 // events kept per market
export const EVENT_CANDS_MAX = 8;              // candidates kept per event
export const COVERED_MAX = 420;                // processed days kept per market
export const STORE_MAX_CHARS = 900_000;        // stay well inside one KV value
const CAND_TEXT_MAX = 1200;
export const eventsKey = (m: LedgerMarket) => `guidance-upgrades:events:v1:${m}`;

export interface StoredSource { name: string; hash: string; url?: string; tier?: string; date?: string }
export interface StoredRaise {
  id: string; key: string; ticker: string; company: string; market: LedgerMarket; date: string;
  sources: StoredSource[]; cands: GuCandidate[];
  firstSeenAt: string; lastSeenAt: string; lastProcessedAt: string;
}
export interface EventStore { v: 1; market: LedgerMarket; updatedAt: string; events: StoredRaise[]; covered: Record<string, string> }
/** The part of the engine's skeleton the store needs. */
export interface SkeletonLike { guidance_event_id: string; canonical_key: string; ticker: string; company: string; market: string; announcement_date: string; candidates: GuCandidate[]; sources: GuSourceRef[] }

const djb = (t: string): string => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };
/** Same outlet + same link (or same name and day) = same hash, so a source is never stored or counted twice. */
export const sourceHash = (x: { url?: string; name?: string; sourceName?: string; date?: string; publishedAt?: string }): string =>
  djb(`${(x.url || '').toLowerCase().replace(/[?#].*$/, '')}|${(x.url ? '' : `${x.name || x.sourceName || ''}|${(x.date || x.publishedAt || '').slice(0, 10)}`)}`);

export const emptyStore = (m: LedgerMarket, now: Date = new Date()): EventStore => ({ v: 1, market: m, updatedAt: now.toISOString(), events: [], covered: {} });

const validStore = (v: any, m: LedgerMarket): EventStore | null => {
  if (!v || typeof v !== 'object' || v.v !== 1 || !Array.isArray(v.events)) return null;
  const events = v.events.filter((e: any) => e && typeof e.id === 'string' && typeof e.date === 'string' && Array.isArray(e.cands));
  const covered: Record<string, string> = {};
  if (v.covered && typeof v.covered === 'object') for (const k of Object.keys(v.covered)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) covered[k] = String(v.covered[k]);
  return { v: 1, market: m, updatedAt: String(v.updatedAt || ''), events, covered };
};
export async function readEventStore(m: LedgerMarket): Promise<EventStore | null> {
  try { return validStore(await kvGet<EventStore>(eventsKey(m)), m); } catch { return null; }   // cold or unreadable store: the page still works from the live sources
}

/** Candidates to feed back into the engine on read (live candidates are added first, so a live copy always wins the dedupe). */
export const storedCandidates = (st: EventStore | null | undefined): GuCandidate[] => (st ? st.events.flatMap((e) => e.cands) : []);
export const storeCoveredDays = (st: EventStore | null | undefined): Set<string> => new Set(st ? Object.keys(st.covered) : []);

const trimCand = (c: GuCandidate): GuCandidate => (c.text && c.text.length > CAND_TEXT_MAX ? { ...c, text: c.text.slice(0, CAND_TEXT_MAX) } : c);

export interface MergeResult { store: EventStore; changed: boolean; added: number; updated: number }
/**
 * Fold one run into the store. Idempotent: the same skeletons and days again change nothing (changed = false, no write).
 * Bounded: newest EVENTS_MAX events, EVENT_CANDS_MAX candidates each, COVERED_MAX days, and a size guard that drops the oldest events first.
 */
export function mergeIntoStore(st: EventStore | null, skeletons: readonly SkeletonLike[], coveredDays: readonly string[], now: Date = new Date()): MergeResult {
  const m: LedgerMarket = skeletons[0]?.market === 'US' ? 'US' : st?.market ?? 'IN';
  const cur = st ?? emptyStore(m, now);
  const nowIso = now.toISOString();
  const byId = new Map(cur.events.map((e) => [e.id, e] as const));
  let added = 0; let updated = 0;
  for (const sk of skeletons) {
    if (!sk.guidance_event_id || !sk.announcement_date) continue;
    const srcs: StoredSource[] = sk.sources.map((x) => ({ name: x.name, hash: sourceHash({ url: x.url, name: x.name, date: x.date }), url: x.url, tier: x.tier, date: x.date }));
    const prev = byId.get(sk.guidance_event_id);
    if (!prev) {
      byId.set(sk.guidance_event_id, {
        id: sk.guidance_event_id, key: sk.canonical_key, ticker: sk.ticker, company: sk.company, market: (sk.market === 'US' ? 'US' : 'IN'), date: sk.announcement_date.slice(0, 10),
        sources: srcs.slice(0, 12), cands: sk.candidates.slice(0, EVENT_CANDS_MAX).map(trimCand), firstSeenAt: nowIso, lastSeenAt: nowIso, lastProcessedAt: nowIso,
      });
      added++; continue;
    }
    const haveSrc = new Set(prev.sources.map((x) => x.hash)); const haveCand = new Set(prev.cands.map((c) => c.id));
    const newSrc = srcs.filter((x) => !haveSrc.has(x.hash)); const newCand = sk.candidates.filter((c) => !haveCand.has(c.id));
    if (!newSrc.length && !newCand.length) continue;           // nothing new about this event: untouched, so the run stays a no-op
    byId.set(prev.id, {
      ...prev, sources: [...prev.sources, ...newSrc].slice(0, 12), cands: [...prev.cands, ...newCand.map(trimCand)].slice(0, EVENT_CANDS_MAX),
      lastSeenAt: nowIso, lastProcessedAt: nowIso,
    });
    updated++;
  }
  const oldest = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
  let events = Array.from(byId.values()).filter((e) => e.date >= oldest).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, EVENTS_MAX);
  const covered: Record<string, string> = { ...cur.covered }; let coveredAdded = 0;
  for (const d of coveredDays) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !covered[d]) { covered[d] = nowIso; coveredAdded++; }
  for (const d of Object.keys(covered)) if (d < oldest) delete covered[d];
  const keys = Object.keys(covered).sort().reverse();
  for (const d of keys.slice(COVERED_MAX)) delete covered[d];
  let next: EventStore = { v: 1, market: m, updatedAt: (added || updated || coveredAdded) ? nowIso : cur.updatedAt, events, covered };
  while (events.length > 0 && JSON.stringify(next).length > STORE_MAX_CHARS) { events = events.slice(0, Math.max(0, events.length - Math.ceil(events.length / 10))); next = { ...next, events }; }
  return { store: next, changed: added + updated + coveredAdded > 0, added, updated };
}
export async function writeEventStore(st: EventStore): Promise<boolean> {
  try { await kvSet(eventsKey(st.market), st, EVENTS_TTL_S); return true; } catch { return false; }
}
