// PATCH 0320 — Special Situations event lifecycle state machine.
//
// Captures the institutional view of where an M&A / takeover / spin-off
// event is in its journey from "rumor" to "completed". Each canonical
// event we track is stamped into a state machine with allowed transitions.
//
// State machine:
//
//   RUMOR ─────► BOARD_APPROVED ───► BINDING ─────► REGULATORY ─────► VOTE
//     │                │                  │             │             │
//     │                │                  │             │             ▼
//     │                │                  │             │           COURT
//     │                │                  │             │             │
//     │                │                  │             │             ▼
//     ▼                ▼                  ▼             ▼            OPEN
//   ABANDONED      ABANDONED         ABANDONED       BLOCKED          │
//                                                                     ▼
//                                                                   TENDER
//                                                                     │
//                                                                     ▼
//                                                                   LISTING
//                                                                     │
//                                                                     ▼
//                                                                  COMPLETED
//
// Each transition records (from_state, to_state, ts, source, note).
//
// Storage: KV-backed `specsit-lifecycle:v1:<event_id>` for the canonical
// state + a transitions log; eventually backed by Postgres when Auth lands.

export type LifecycleState =
  | 'RUMOR'              // press leak only
  | 'BOARD_APPROVED'     // target/acquirer board green-light
  | 'BINDING'            // signed agreement / open offer filed
  | 'REGULATORY'         // CCI / SEBI / antitrust review
  | 'VOTE'               // shareholder vote pending
  | 'COURT'              // NCLT / court approval
  | 'OPEN'               // open-offer / tender window active
  | 'TENDER'             // shares being tendered
  | 'LISTING'            // post-completion listing event
  | 'COMPLETED'          // closed successfully
  | 'TERMINATED'         // mutual termination
  | 'ABANDONED'          // walked away
  | 'BLOCKED';           // regulator / court refused

interface StateConfig {
  label: string;
  color: string;
  description: string;
  /** States this one can transition into. Empty = terminal. */
  next: LifecycleState[];
}

export const LIFECYCLE_CONFIG: Record<LifecycleState, StateConfig> = {
  RUMOR:           { label: 'Rumor',           color: '#94A3B8', description: 'Press leak / unconfirmed source', next: ['BOARD_APPROVED', 'ABANDONED'] },
  BOARD_APPROVED:  { label: 'Board approved',  color: '#FB923C', description: 'Target / acquirer board has greenlit the deal', next: ['BINDING', 'ABANDONED'] },
  BINDING:         { label: 'Binding',         color: '#F59E0B', description: 'Definitive agreement signed / open offer filed', next: ['REGULATORY', 'VOTE', 'TERMINATED'] },
  REGULATORY:      { label: 'Regulatory',      color: '#22D3EE', description: 'CCI / SEBI / antitrust review pending', next: ['VOTE', 'COURT', 'OPEN', 'BLOCKED'] },
  VOTE:            { label: 'Shareholder vote',color: '#22D3EE', description: 'Vote scheduled or in progress', next: ['COURT', 'OPEN', 'TERMINATED', 'BLOCKED'] },
  COURT:           { label: 'Court',           color: '#A78BFA', description: 'NCLT / court approval', next: ['OPEN', 'LISTING', 'BLOCKED'] },
  OPEN:            { label: 'Open offer',      color: '#10B981', description: 'Open offer / tender window active', next: ['TENDER', 'TERMINATED'] },
  TENDER:          { label: 'Tendering',       color: '#10B981', description: 'Shares being tendered', next: ['LISTING', 'COMPLETED'] },
  LISTING:         { label: 'Listing event',   color: '#A78BFA', description: 'Spin-off / new entity listing', next: ['COMPLETED'] },
  COMPLETED:       { label: 'Completed',       color: '#10B981', description: 'Deal closed successfully', next: [] },
  TERMINATED:      { label: 'Terminated',      color: '#EF4444', description: 'Mutual termination', next: [] },
  ABANDONED:       { label: 'Abandoned',       color: '#EF4444', description: 'Walked away pre-binding', next: [] },
  BLOCKED:         { label: 'Blocked',         color: '#EF4444', description: 'Regulator / court refused', next: [] },
};

export interface LifecycleTransition {
  from: LifecycleState;
  to: LifecycleState;
  ts: number;
  source?: string;
  note?: string;
}

export interface LifecycleRecord {
  event_id: string;
  current_state: LifecycleState;
  first_seen: number;
  last_updated: number;
  transitions: LifecycleTransition[];
  meta?: Record<string, any>;
}

/** Returns true when `to` is a legal next state from `from`. */
export function isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
  // Allow same-state (idempotent updates).
  if (from === to) return true;
  return LIFECYCLE_CONFIG[from].next.includes(to);
}

/** Build a new record at `RUMOR` (default first state). */
export function newRecord(eventId: string, startState: LifecycleState = 'RUMOR', meta?: Record<string, any>): LifecycleRecord {
  const ts = Date.now();
  return {
    event_id: eventId,
    current_state: startState,
    first_seen: ts,
    last_updated: ts,
    transitions: [],
    meta,
  };
}

/** Apply a transition. Returns updated record or null on illegal transition. */
export function applyTransition(rec: LifecycleRecord, to: LifecycleState, source?: string, note?: string): LifecycleRecord | null {
  if (!isValidTransition(rec.current_state, to)) return null;
  const ts = Date.now();
  return {
    ...rec,
    current_state: to,
    last_updated: ts,
    transitions: [...rec.transitions, { from: rec.current_state, to, ts, source, note }],
  };
}

/** Days since the record entered its current state. */
export function daysInCurrentState(rec: LifecycleRecord): number {
  const lastTrans = rec.transitions[rec.transitions.length - 1];
  const enteredAt = lastTrans ? lastTrans.ts : rec.first_seen;
  return Math.round((Date.now() - enteredAt) / 86_400_000);
}

/** Expected days-to-next-state by current state (rough institutional priors). */
export const EXPECTED_DAYS: Partial<Record<LifecycleState, number>> = {
  RUMOR: 30,
  BOARD_APPROVED: 45,
  BINDING: 90,
  REGULATORY: 60,
  VOTE: 30,
  COURT: 45,
  OPEN: 21,
  TENDER: 30,
  LISTING: 14,
};

/** Computes "is the deal stalled?" — current-state duration > expected × 1.5 */
export function isStalled(rec: LifecycleRecord): boolean {
  const expected = EXPECTED_DAYS[rec.current_state];
  if (!expected) return false;
  return daysInCurrentState(rec) > expected * 1.5;
}
