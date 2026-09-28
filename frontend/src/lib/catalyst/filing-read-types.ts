// zzz813 — the shape of one filing's deterministic read (lib/catalyst/filing-read),
// shared by the server route, the page's reading hook and the pure tab builder.
// Types only: importing this file pulls in no code.

/** A thesis variable the filing moves: up / down, or a level stated with no change. */
export interface Touch { key: string; dir: 'up' | 'down' | 'stated' }

/** zzz824: a change the document states with its prior, for one thesis variable. */
export interface FilingChange { key: string; dir: 'up' | 'down'; text: string; before?: string | null; after?: string | null }

export interface FilingRead {
  url: string;
  status: 'read' | 'failed';
  /** Why the document could not be read ("HTTP 403", "scanned PDF, no text"). */
  reason?: string | null;
  /** The event type the DOCUMENT shows (one of EVENT_TYPES), when it shows one. */
  kind?: string | null;
  /** The one plain-English line: the fact and the figures the document states. */
  line?: string | null;
  /** Figures literally in `line` (a capacity change % is computed from two stated figures). */
  figures?: string[];
  /** The document is paperwork / says nothing material — why. */
  routine?: string | null;
  /** CEO / CFO / MD level (management changes). */
  senior?: boolean;
  /** The company states no material impact (tax notice, penalty). */
  noImpact?: boolean;
  touches?: Touch[];
  /** zzz815: the line the document gave was rejected by the quality gate (table dump, letterhead, OCR) — why. */
  rejected?: string | null;
  /** zzz824: changes the filing itself states with an explicit prior ("up 9% YoY", "from 5,000 to 9,600 MTPA",
   *  "order book ₹184 bn as against ₹150 bn"). A level with no stated prior is never here. */
  changes?: FilingChange[];
  /** zzz824: what kind of document this is (from the subject and the body) — "Credit rating letter", "Results filing". */
  docType?: string | null;
  /** zzz824: the reader's extraction is low-confidence (garbled table, marketing text) — show the subject + "details in filing". */
  lowConfidence?: boolean;
  /** zzz824: a credit-rating action, when the document is a rating letter. */
  ratingAction?: 'upgrade' | 'downgrade' | 'reaffirm' | 'assign' | 'withdraw' | 'revise' | null;
  chars?: number;
  version: string;
  readAt?: string;
}
