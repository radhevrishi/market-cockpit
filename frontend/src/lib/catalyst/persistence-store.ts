// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT CATALYST MEMORY                                          (zzz780)
//
// One record per company × mechanism (`TICKER:KIND`), shared by Portfolio
// Catalysts and AI Daily Gainers, so the same catalyst is never rediscovered
// as new: each detection appends to the record's timeline only when its
// state, confidence or latest evidence changed.
//
// Storage: ONE KV blob (`persist:v1:all`). One read + one write per upsert —
// the Upstash request budget matters more than write contention here, and a
// merge-on-write keeps concurrent writers from dropping each other's records.
// No TTL: this is memory, not cache. Nothing is ever deleted automatically;
// "Archive" and "Dismiss" are user states.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import type { PersistentCatalyst, PersistState, PersistConfidence } from './persistence';
import type { CatalystRecord } from '@/lib/ai-gainers/structured-facts';
import { buildCatalystRecords, factsForFinding, toStoredRecord } from '@/lib/ai-gainers/catalyst-timeline';

export const PERSIST_KEY = 'persist:v1:all';
export type UserFocusState = 'confirmed' | 'watch' | 'dismissed' | 'archived' | 'reviewed';

export interface TimelineEntry {
  at: string;                          // when the system observed it (ISO)
  origin: 'portfolio' | 'gainers';
  state: PersistState;
  confidence: PersistConfidence;
  latestEvidenceDate: string | null;
  summary: string;                     // mechanism at that moment
  specialFocus: boolean;
}

export interface StoredCatalyst {
  id: string;
  ticker: string;
  kind: string;
  label: string;
  sfId: number | null;                 // Special Focus #N — assigned once, kept forever
  firstSeen: string;
  lastSeen: string;
  origins: Array<'portfolio' | 'gainers'>;
  everSpecialFocus: boolean;
  timeline: TimelineEntry[];
  latest: PersistentCatalyst;          // trimmed copy of the newest detection
  user: { state: UserFocusState; at: string; note: string | null } | null;
}

export interface PersistBlob { version: 1; seq: number; records: Record<string, StoredCatalyst> }

const trim = (pc: PersistentCatalyst): PersistentCatalyst => ({
  ...pc,
  evidence: pc.evidence.slice(0, 8).map((e) => ({ ...e, sources: e.sources.slice(0, 3) })),
  forward: pc.forward.slice(0, 3).map((e) => ({ ...e, sources: e.sources.slice(0, 1) })),
  beforeAfter: pc.beforeAfter.slice(0, 6),
});

export async function loadPersist(): Promise<PersistBlob> {
  const b = await kvGet<PersistBlob>(PERSIST_KEY).catch(() => null);
  return b && b.records ? b : { version: 1, seq: 0, records: {} };
}

/** Merge detections into memory. Only detections worth remembering are
 *  stored: MEDIUM / HIGH confidence, Special Focus, or an id already on file
 *  (so a catalyst that decays is followed, never silently dropped). */
export function mergeDetections(blob: PersistBlob, list: PersistentCatalyst[], origin: 'portfolio' | 'gainers', now = new Date().toISOString()): { blob: PersistBlob; changed: number } {
  let changed = 0;
  for (const pc of list) {
    const prev = blob.records[pc.id];
    const worth = pc.specialFocus || pc.confidence === 'HIGH' || pc.confidence === 'MEDIUM';
    if (!prev && !worth) continue;
    const entry: TimelineEntry = { at: now, origin, state: pc.state, confidence: pc.confidence, latestEvidenceDate: pc.latestEvidenceDate, summary: pc.mechanism.slice(0, 200), specialFocus: pc.specialFocus };
    if (!prev) {
      blob.records[pc.id] = {
        id: pc.id, ticker: pc.ticker, kind: pc.kind, label: pc.label,
        sfId: pc.specialFocus ? ++blob.seq : null,
        firstSeen: now, lastSeen: now, origins: [origin], everSpecialFocus: pc.specialFocus,
        timeline: [entry], latest: trim({ ...pc, origins: [...new Set([...pc.origins, origin])] }), user: null,
      };
      changed++;
      continue;
    }
    const last = prev.timeline[prev.timeline.length - 1];
    const moved = !last || last.state !== entry.state || last.confidence !== entry.confidence || last.latestEvidenceDate !== entry.latestEvidenceDate || last.specialFocus !== entry.specialFocus;
    if (moved) { prev.timeline = [...prev.timeline, entry].slice(-40); changed++; }
    // A gainers detection (one filing) never overwrites a richer portfolio
    // detection (the whole ledger) — it is added to the timeline and origins.
    const richer = origin === 'portfolio' || !prev.origins.includes('portfolio') || pc.hardCount >= prev.latest.hardCount;
    const eventIds = [...new Set([...(prev.latest.eventIds || []), ...(pc.eventIds || [])])];
    if (richer) prev.latest = trim({ ...pc, origins: [...new Set([...prev.origins, ...pc.origins, origin])] });
    // zzz787: the Daily Gainers event ids behind this mechanism are kept whichever detection is richer — the cross-link.
    if (eventIds.length) prev.latest.eventIds = eventIds;
    prev.origins = [...new Set([...prev.origins, origin])];
    prev.lastSeen = now;
    if (pc.specialFocus && !prev.sfId) prev.sfId = ++blob.seq;
    if (pc.specialFocus) prev.everSpecialFocus = true;
  }
  return { blob, changed };
}

export async function upsertDetections(list: PersistentCatalyst[], origin: 'portfolio' | 'gainers'): Promise<{ changed: number; blob: PersistBlob }> {
  if (!list.length) return { changed: 0, blob: await loadPersist() };
  const blob = await loadPersist();
  const { changed } = mergeDetections(blob, list, origin);
  if (changed) await kvSet(PERSIST_KEY, blob); // no TTL: persistent catalyst records incl. user confirmations
  return { changed, blob };
}

export async function setUserState(id: string, state: UserFocusState | null, note: string | null = null): Promise<StoredCatalyst | null> {
  const blob = await loadPersist();
  const rec = blob.records[id];
  if (!rec) return null;
  rec.user = state ? { state, at: new Date().toISOString(), note: note ? String(note).slice(0, 300) : null } : null;
  // A user-confirmed catalyst is Special Focus from now on; its CURRENT
  // evidence state stays visible — confirmation never hides deterioration.
  if (state === 'confirmed' && !rec.sfId) rec.sfId = ++blob.seq;
  if (state === 'confirmed') rec.everSpecialFocus = true;
  await kvSet(PERSIST_KEY, blob); // no TTL: persistent catalyst records incl. user confirmations
  return rec;
}

/** What the Special Focus queue shows for one stored record. */
export function focusStatus(rec: StoredCatalyst): { inQueue: boolean; decayed: boolean; note: string | null } {
  const u = rec.user?.state;
  if (u === 'dismissed' || u === 'archived') return { inQueue: false, decayed: false, note: u === 'dismissed' ? 'Dismissed by you.' : 'Archived by you.' };
  if (rec.latest.specialFocus) return { inQueue: true, decayed: false, note: null };
  if (u === 'confirmed' || u === 'watch') return { inQueue: true, decayed: !rec.latest.specialFocus, note: `Kept because you ${u === 'confirmed' ? 'confirmed' : 'are watching'} it — current evidence: ${rec.latest.state.toLowerCase()} / ${rec.latest.confidence.toLowerCase().replace('_', ' ')}.` };
  if (rec.everSpecialFocus) {
    // Decay: the record stays in the queue with an explanation, never silently removed.
    const why = rec.latest.state === 'MATURE' ? 'Original catalyst has matured; new evidence required to establish the next leg.'
      : rec.latest.state === 'STALLING' || rec.latest.state === 'WEAKENING' ? `The mechanism is ${rec.latest.state.toLowerCase()} — ${rec.latest.runway.text}`
        : `No longer meets the Special Focus gate — ${rec.latest.why[rec.latest.why.length - 1] || 'evidence thinner than before'}.`;
    return { inQueue: true, decayed: true, note: why };
  }
  return { inQueue: false, decayed: false, note: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// CATALYST TIMELINE MEMORY                                         (zzz785 C)
//
// One record per UNDERLYING catalyst (`TICKER:kind:anchor`, catalystIdOf) —
// state IDENTIFIED → DOCUMENTED → EXECUTING → CONFIRMED → WEAKENING →
// DISPROVED with previousState, latestEvidence, nextMilestone, invalidation
// and its de-duplicated sources, oldest first. Stored so a LATER day's gainer
// sees the state an earlier day reached (the ladder never slides back without
// contrary evidence). Separate from `persist:v1:all` (mechanism memory for
// Special Focus) — the two are linked by ticker, never merged.
//
// KV: ONE blob `catalyst:v1:records` = { version: 1, records: { [id]: CatalystRecord } }.
// One read + one write per sweep. No TTL (memory, not cache); bounded at
// MAX_RECORDS by evicting the oldest `lastSeen`.
// ═══════════════════════════════════════════════════════════════════════════


export const CATALYST_KEY = 'catalyst:v1:records';
const MAX_RECORDS = 4000;
export interface CatalystBlob { version: 1; records: Record<string, CatalystRecord> }

export async function loadCatalystRecords(): Promise<Record<string, CatalystRecord>> {
  const b = await kvGet<CatalystBlob>(CATALYST_KEY).catch(() => null);
  return b && b.records && typeof b.records === 'object' ? b.records : {};
}

/** Pure: today's findings merged into the stored records. Returns the new
 *  record map and how many records changed (state, sources or milestone). */
export function mergeCatalystFindings(prior: Record<string, CatalystRecord>, findings: Record<string, any>, today: string | null): { records: Record<string, CatalystRecord>; changed: number } {
  const records: Record<string, CatalystRecord> = { ...prior };
  let changed = 0;
  for (const f of Object.values(findings || {})) {
    if (!f || !f.ticker) continue;
    const facts = factsForFinding(f);
    if (!facts.length) continue;
    const views = buildCatalystRecords(String(f.ticker), f.market === 'US' ? 'US' : 'IN', facts, { prior: records, today });
    for (const v of views) {
      const next = toStoredRecord(v);
      const old = records[next.id];
      const same = old && old.state === next.state && old.sources.length === next.sources.length && old.nextMilestone === next.nextMilestone && old.latestEvidence === next.latestEvidence;
      if (!same) changed++;
      records[next.id] = same ? { ...old, lastSeen: next.lastSeen } : next;
    }
  }
  const ids = Object.keys(records);
  if (ids.length > MAX_RECORDS) {
    ids.sort((a, b) => String(records[a].lastSeen).localeCompare(String(records[b].lastSeen)));
    for (const id of ids.slice(0, ids.length - MAX_RECORDS)) delete records[id];
  }
  return { records, changed };
}

/** Server-side, once per research sweep: read the stored records, merge the
 *  day's findings, write back only when something changed. Best-effort. */
export async function rememberGainerCatalysts(findings: Record<string, any>, today: string | null): Promise<{ changed: number; records: Record<string, CatalystRecord> }> {
  const prior = await loadCatalystRecords();
  const { records, changed } = mergeCatalystFindings(prior, findings, today);
  if (changed) await kvSet(CATALYST_KEY, { version: 1, records } as CatalystBlob).catch(() => null); // no TTL: catalyst record history
  return { changed, records };
}

/** Records for a set of tickers (what a research view needs). */
export function catalystRecordsFor(all: Record<string, CatalystRecord>, tickers: string[]): Record<string, CatalystRecord> {
  const on = new Set(tickers.map((t) => String(t).toUpperCase()));
  const out: Record<string, CatalystRecord> = {};
  for (const [id, r] of Object.entries(all || {})) if (r && on.has(String(r.ticker).toUpperCase())) out[id] = r;
  return out;
}
