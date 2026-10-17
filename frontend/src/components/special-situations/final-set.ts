// zzz1066 — pure helpers: which events each Special Situations view lists (audit S01). No React, no I/O.
// Every final view (header, coverage, Radar, All Situations, Analytics, home) works on the same final set. The Archived view
// lists what was held back, labelled; raw discovery stays on its own tab.

export type EvidenceFilter = 'ALL' | 'CONFIRMED' | 'PENDING' | 'ARCHIVED';
type Ev = { event_id: string; region?: string | null; quarantine_reason?: string | null; merged_into?: string | null; verification_pending?: unknown; final?: { evidence_state?: string } | null };
type FeedIn = { final_events?: Ev[] | null; events?: Ev[] | null } | null | undefined;

const inRegion = (e: Ev, region: string) => region === 'ALL' || e.region === region;

/** The final set for a region. Older payloads (no final_events): events that are neither held back nor merged copies. */
export function finalListOf(feed: FeedIn, region = 'ALL'): Ev[] {
  if (!feed) return [];
  if (Array.isArray(feed.final_events)) return feed.final_events.filter((e) => e && inRegion(e, region));
  return (feed.events || []).filter((e) => e && !e.quarantine_reason && !e.merged_into && inRegion(e, region));
}

/** Held back from the final set (contradicted, expired, quarantined, not shown while awaiting a check). Merged copies are not listed. */
export function archivedListOf(feed: FeedIn, region = 'ALL'): Ev[] {
  if (!feed) return [];
  return (feed.events || []).filter((e) => e && !!e.quarantine_reason && !e.merged_into && inRegion(e, region));
}

export const evidenceOf = (e: Ev): 'CONFIRMED' | 'PENDING' => (e.final?.evidence_state === 'PENDING' || (!e.final && !!e.verification_pending) ? 'PENDING' : 'CONFIRMED');

export function evidenceFilterCounts(finalList: ReadonlyArray<Ev>, archived: ReadonlyArray<Ev>): Record<EvidenceFilter, number> {
  let c = 0, p = 0;
  for (const e of finalList) { if (evidenceOf(e) === 'PENDING') p += 1; else c += 1; }
  return { ALL: finalList.length, CONFIRMED: c, PENDING: p, ARCHIVED: archived.length };
}

export function applyEvidenceFilter<T extends Ev>(list: ReadonlyArray<T>, f: EvidenceFilter): T[] {
  if (f === 'ALL' || f === 'ARCHIVED') return list.slice();
  return list.filter((e) => evidenceOf(e) === f);
}
