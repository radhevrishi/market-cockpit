// zzz1112 / zzz1128 — the full-record check for an opened event (pure; used by the detail loader and the drawer).
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';

export type DetailLoad = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ok'; event: GuidanceEvent };

const LIST_FIELDS = ['risks', 'evidenceGaps', 'changes', 'history', 'sources', 'nextEvidence', 'decisionReason', 'flags'] as const;
/** The full record made safe to render, or null when it is not a full event (missing id, still lean, not an object). A missing
 *  LIST becomes an empty list and a missing chain / links an empty object — "nothing listed", never an invented fact. */
export function normalizeFullEvent(e: unknown, wantId?: string): GuidanceEvent | null {
  const x = e as any;
  if (!x || typeof x !== 'object' || Array.isArray(x) || x.lean || typeof x.guidance_event_id !== 'string') return null;
  if (wantId && x.guidance_event_id !== wantId) return null;   // an answer for another company never shows under this one
  const out: any = { ...x };
  for (const k of LIST_FIELDS) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.chain || typeof out.chain !== 'object') out.chain = {};
  if (!out.links || typeof out.links !== 'object') out.links = {};
  return out as GuidanceEvent;
}

