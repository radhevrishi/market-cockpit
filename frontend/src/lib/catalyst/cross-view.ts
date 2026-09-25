// ═══════════════════════════════════════════════════════════════════════════
// ONE CATALYST, THREE VIEWS — CROSS-LINKED, NEVER DUPLICATED.        (zzz787)
//
//   Research Priority (AI Daily Gainers)  what to investigate NOW
//   Persistent catalyst (memory)          could the mechanism CONTINUE
//   Special Focus                         deserves SUSTAINED attention
//
// The views stay separate and are never merged into one score. What they
// share is identity: the underlying event id (catalystIdOf, TICKER:kind:anchor)
// and the mechanism id (TICKER:KIND). This module turns those ids into
// cross-links and builds the Special Focus queue so the same company /
// mechanism is listed once — a tracked enabling step or a near miss for a
// company already in the queue is shown as a link on that card, not as a
// second item. Pure: no network, no clock, no price.
// ═══════════════════════════════════════════════════════════════════════════

import type { EventKind } from '@/lib/ai-gainers/structured-facts';
import { rankOf, type PersistentCatalyst, type PersistKind } from './persistence';

/** The mechanism kind an event kind feeds (null = no operating mechanism). */
export function persistKindOfEvent(kind: EventKind | string | null | undefined): PersistKind | null {
  switch (kind) {
    case 'order': return 'ORDER_VISIBILITY';
    case 'capacity': return 'CAPACITY_RAMP';
    case 'qualification': return 'CUSTOMER_RAMP';
    case 'strategic_expansion': return 'GEOGRAPHY';
    case 'partnership': return 'PROJECT_PIPELINE';
    default: return null;
  }
}

/** The mechanism id a Daily Gainers event maps to (TICKER:KIND), or null. */
export function persistentIdOfEvent(ticker: string, kind: EventKind | string | null | undefined): string | null {
  const k = persistKindOfEvent(kind);
  return k ? `${String(ticker || '').toUpperCase()}:${k}` : null;
}

export interface FocusStoredLike {
  id: string;
  latest: PersistentCatalyst;
  user: { state: string } | null;
  focus?: { inQueue: boolean; decayed: boolean; note: string | null };
  sfId?: number | null;
}

export interface FocusEntry<R> {
  id: string;
  pc: PersistentCatalyst;
  st: FocusStoredLike | null;
  row: R | null;
  dismissed: boolean;
  decayed: boolean;
  note: string | null;
  /** Tracked enabling steps (MoU / JDA / LoI) of the SAME company — linked here, not listed again. */
  linkedTracked: PersistentCatalyst[];
  /** Daily Gainers event ids behind this mechanism (live + stored), for the cross-link. */
  eventIds: string[];
}

/** The Special Focus queue: one entry per mechanism id (live detection wins,
 *  stored memory fills in), plus the tracked-potential list WITHOUT the
 *  companies already in the queue (those are attached as links). */
export function specialFocusQueue<R>(
  live: Map<string, { pc: PersistentCatalyst; row: R }>,
  stored: Record<string, FocusStoredLike>,
  rowOf: (ticker: string) => R | null,
): { entries: Array<FocusEntry<R>>; tracked: FocusStoredLike[] } {
  const ids = new Set<string>();
  for (const [id, x] of Array.from(live.entries())) if (x.pc.specialFocus) ids.add(id);
  for (const [id, s] of Object.entries(stored)) if (s && s.focus?.inQueue) ids.add(id);
  const tracked0 = Object.values(stored).filter((s) => s && s.latest?.kind === 'PROJECT_PIPELINE' && s.user?.state !== 'dismissed' && s.user?.state !== 'archived');
  const entries: Array<FocusEntry<R>> = [];
  for (const id of Array.from(ids)) {
    const lv = live.get(id);
    const st = stored[id] || null;
    const pc = lv?.pc || st?.latest;
    if (!pc) continue;
    const dismissed = st?.user?.state === 'dismissed' || st?.user?.state === 'archived';
    const eventIds = Array.from(new Set([...(lv?.pc.eventIds || []), ...(st?.latest?.eventIds || [])]));
    entries.push({
      id, pc, st, row: lv?.row ?? rowOf(pc.ticker), dismissed,
      decayed: !!st?.focus?.decayed && !lv?.pc.specialFocus, note: st?.focus?.note || null,
      linkedTracked: tracked0.filter((t) => t.latest.ticker === pc.ticker).map((t) => t.latest),
      eventIds,
    });
  }
  const inQueue = new Set(entries.filter((e) => !e.dismissed).map((e) => e.pc.ticker));
  return { entries, tracked: tracked0.filter((t) => !inQueue.has(t.latest.ticker)) };
}

// ═══════════════════════════════════════════════════════════════════════════
// IN THE LIST MEANS IT MEETS THE GATE.                                (zzz802)
// CYIENTDLM sat in the Special Focus list under the words "No longer meets the
// Special Focus gate" — a list entry contradicting itself. A record that once
// qualified and has decayed is still never silently removed (the reason is
// kept), but it is shown in its own DROPPED OUT section with that reason. An
// entry the owner chose to keep (confirmed / watch) stays in the list — the
// owner's choice is the reason, and its note says so.
// ═══════════════════════════════════════════════════════════════════════════
export function splitDroppedOut<E extends { dismissed: boolean; decayed: boolean; st: { user: { state: string } | null } | null }>(entries: E[]): { inFocus: E[]; droppedOut: E[] } {
  const kept = (e: E) => e.st?.user?.state === 'confirmed' || e.st?.user?.state === 'watch';
  const live = entries.filter((e) => !e.dismissed);
  return { inFocus: live.filter((e) => !e.decayed || kept(e)), droppedOut: live.filter((e) => e.decayed && !kept(e)) };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEAR MISSES — ONE LIST FOR THE COUNT AND THE ROWS.                 (zzz788)
// The owner read "29 near misses — one piece of evidence away" beside "Show
// all 27" and could not reconcile them: the 27 was the Special Focus queue,
// the 29 the near-miss list, and neither button said which. The near-miss
// count is now the length of the SAME array the expanded list renders (one
// line per company, best mechanism first), companies already in the visible
// Special Focus queue are excluded and counted, and each button names its list.
// ═══════════════════════════════════════════════════════════════════════════
export function nearMissList<R>(
  live: Map<string, { pc: PersistentCatalyst; row: R }>,
  entries: Array<{ pc: PersistentCatalyst; dismissed?: boolean }>,
): { near: Array<{ pc: PersistentCatalyst; row: R }>; excludedInQueue: number; mechanisms: number } {
  const inQ = new Set(entries.filter((e) => !e.dismissed).map((e) => e.pc.ticker));
  const best = new Map<string, { pc: PersistentCatalyst; row: R }>();
  const excluded = new Set<string>();
  let mechanisms = 0;
  for (const x of Array.from(live.values())) {
    if (!x.pc.nearMiss) continue;
    if (inQ.has(x.pc.ticker)) { excluded.add(x.pc.ticker); continue; }
    mechanisms++;
    const prev = best.get(x.pc.ticker);
    if (!prev || rankOf(x.pc) > rankOf(prev.pc)) best.set(x.pc.ticker, x);
  }
  const near = Array.from(best.values()).sort((a, b) => rankOf(b.pc) - rankOf(a.pc));
  return { near, excludedInQueue: excluded.size, mechanisms };
}

/** The two buttons, each naming its own list. */
export function focusButtonWords(queueShown: number, nearCount: number): { near: string; all: string } {
  return {
    near: `${nearCount} near miss${nearCount === 1 ? '' : 'es'} — one piece of evidence away (not in Special Focus)`,
    all: `Show all ${queueShown} Special Focus`,
  };
}
