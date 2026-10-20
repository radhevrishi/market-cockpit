// ═══════════════════════════════════════════════════════════════════════════
// AI VERIFICATION LAYER — shared types.                              (zzz854)
//
// A CLAIM is one thing a list wants to show (a guidance change, a special
// situation) that was NOT already confirmed by a primary document the engine
// read itself. The verifier fetches the primary document, asks the model to
// check the claim against it, and keeps the answer only when the quoted text
// is really in the document and the numbers really match.
// ═══════════════════════════════════════════════════════════════════════════

export type VerifyKind = 'guidance' | 'special_situation';
export type VerifyMarket = 'IN' | 'US' | 'GLOBAL';
export type VerifyBasis = 'GAAP' | 'ADJUSTED' | 'UNSTATED';

export interface VerifyClaim {
  /** stable hash of company + metric + period + values + sourceUrl */
  claimId: string;
  kind: VerifyKind;
  market: VerifyMarket;
  company: string;
  ticker: string | null;
  /** plain sentence the model checks, e.g. "Acme raised FY2026 revenue guidance to 305 to 310 (USD M)" */
  claimText: string;
  metric: string | null;
  /** claimed values in the unit named by `unit`; `new` is what is claimed now, `old` the prior figure (empty = none claimed) */
  numbers: { old: number[]; new: number[] };
  unit: string | null;
  period: string | null;
  basis: VerifyBasis | null;
  /** the company's own document (SEC / NSE / BSE / company release). null = none known */
  primaryUrl: string | null;
  /** where the claim was first seen */
  sourceUrl: string | null;
  /** id of the list item the claim belongs to (guidance_event_id / event_id) */
  refId: string;
  /** zzz856: how primaryUrl was found (null = none). 'feed_link' = the event's own filing link; 'sec_accession' = built from the
   *  SEC accession + CIK; 'exchange_announcement' = the company's NSE / BSE announcement matched by symbol / name + date;
   *  'edgar_by_cik' = the company's EDGAR filing matched by CIK + date. */
  primaryHow?: PrimaryHow | null;
  /** one plain sentence: which document, matched on what */
  primaryDetail?: string | null;
  /** zzz856: queue order. 3 = Tier 1, 2 = Tier 2 (and guidance), 1 = Watchlist, 0 = other */
  priorityTier?: number;
  /** ISO date of the event (queue order: newer first; document search window) */
  eventDate?: string | null;
  /** zzz856: what the document locator may match on (only names / tickers the event itself carries) */
  locateHints?: LocateHints | null;
}

/** zzz1057: 'edgar_by_name' = the company's own EDGAR filing found by an EDGAR full-text search for the name the event gives (no ticker). */
export type PrimaryHow = 'feed_link' | 'sec_accession' | 'exchange_announcement' | 'edgar_by_cik' | 'edgar_by_name';

export interface LocateHints {
  /** NSE symbols / US tickers named by the event */
  tickers: string[];
  /** company names the event names (target / headline subject) */
  names: string[];
  /** the event's own headline + description (≤ 400 chars): a matched company must be named here */
  text: string;
  eventType: string | null;
  region: VerifyMarket;
}

/** zzz856: the result of looking for a claim's primary document (cached per claim). */
export interface LocatedDoc {
  claimId: string;
  found: boolean;
  url: string | null;
  how: PrimaryHow | null;
  /** plain sentence: what was matched, or what was searched when nothing was found */
  detail: string;
  /** the company named on the matched document */
  matchedName: string | null;
  filingDate: string | null;
  /** the document's own subject / description line (≤ 400 chars), when the source gives one */
  text: string | null;
  /** the subject line names this kind of event (acquisition, buyback, scheme ...) */
  kindMatch: boolean;
  checkedAt: string;
}

/** Final and interim states. Only `confirmed` lets an unverified item into a main list. */
export type VerifyStatus =
  | 'confirmed'
  | 'contradicted'
  | 'not_found'
  | 'unreadable'
  | 'no_primary'
  | 'verification_unavailable'
  | 'error';

export interface VerifyExtracted {
  oldValues: number[];
  newValues: number[];
  period: string | null;
  basis: VerifyBasis | null;
  /** ≤ 200 chars, verbatim from the document (checked) */
  quote: string;
  confidence: number;
}

export interface VerifyVerdict {
  claimId: string;
  status: VerifyStatus;
  /** plain-English reason, never the document text beyond the ≤200-char quote */
  reason: string;
  /** what the model said before our checks (kept for audit) */
  modelVerdict?: 'confirmed' | 'contradicted' | 'not_found' | 'unreadable' | null;
  extracted?: VerifyExtracted | null;
  documentUrl: string | null;
  provider: string | null;
  model: string | null;
  checkedAt: string;
  attempts: number;
  /** earliest time a failed check may be retried (ISO); null for final answers */
  retryAfter?: string | null;
  costUsd?: number;
}

/** Why an item is held out of a main list. */
export type AwaitingReason =
  | 'queued'                    // not checked yet
  | 'no_primary'                // no primary document link to read
  | 'not_found'                 // the model could not find the claim in the document
  | 'unreadable'                // document could not be fetched / read (retried with backoff)
  | 'error'                     // model answer was invalid (retried)
  | 'verification_unavailable'; // no API key, or the monthly cap is reached

export interface AwaitingRow {
  claimId: string;
  refId: string;
  kind: VerifyKind;
  market: VerifyMarket;
  company: string;
  ticker: string | null;
  claimText: string;
  reason: AwaitingReason;
  reasonText: string;
  primaryUrl: string | null;
  sourceUrl: string | null;
  checkedAt: string | null;
}

export interface RemovedRow {
  claimId: string;
  refId: string;
  kind: VerifyKind;
  market: VerifyMarket;
  company: string;
  ticker: string | null;
  claimText: string;
  reason: string;
  quote: string | null;
  documentUrl: string | null;
  checkedAt: string;
}

export interface VerificationSummary {
  provider: string;
  model: string | null;
  /** false when no key is configured or the monthly cap is reached */
  available: boolean;
  unavailableReason: string | null;
  /** zzz1153: the provider account refuses calls (no credit / spend limit) although our cap allows them */
  providerNote?: string | null;
  /** 'enforce' (default) hides unverified items; 'report' keeps them but still labels them (owner escape hatch via AI_VERIFY_GATE=report) */
  mode: 'enforce' | 'report';
  primaryVerified: number;
  checked: number;
  confirmed: number;
  contradicted: number;
  awaiting: number;
  awaitingByReason: Partial<Record<AwaitingReason, number>>;
  lastRunAt: string | null;
  /** zzz856: next scheduled verifier run (ISO, from the workflow schedule) */
  nextRunEta?: string | null;
  /** zzz856: the workflow schedule (cron, UTC) the ETA is computed from */
  schedule?: string | null;
  /** zzz856: claims waiting in the verifier queue (null = not readable just now) */
  queueSize?: number | null;
  /** zzz856: awaiting items with / without a primary document located */
  primaryDocument?: { located: number; none: number; notSearchedYet: number; byHow: Partial<Record<PrimaryHow, number>> };
}

export interface GateResult<T> {
  kept: T[];
  awaiting: AwaitingRow[];
  removed: RemovedRow[];
  /** claims with no usable verdict yet: the caller enqueues these */
  pending: VerifyClaim[];
  /** confirmed verdicts by refId, so the caller can attach the extracted values */
  confirmedByRef: Map<string, VerifyVerdict>;
  stats: Omit<VerificationSummary, 'provider' | 'model' | 'available' | 'unavailableReason' | 'mode' | 'lastRunAt' | 'nextRunEta' | 'schedule' | 'queueSize'>;
  /** zzz856: claims with no primary document and no search result yet: the caller enqueues these so the run can look for one */
  toLocate: VerifyClaim[];
}

export interface RunStatus {
  lastRunAt: string | null;
  lastRun: {
    at: string;
    available: boolean;
    unavailableReason: string | null;
    provider: string;
    model: string | null;
    queueBefore: number;
    queueAfter: number;
    checked: number;
    confirmed: number;
    contradicted: number;
    notFound: number;
    unreadable: number;
    noPrimary: number;
    errors: number;
    cacheHits: number;
    spentUsd: number;
    /** zzz856: document search in this run */
    located?: number;
    locateNone?: number;
    locateDeferred?: number;
    elapsedMs?: number;
    stoppedBy: 'done' | 'limit' | 'budget_usd' | 'time' | 'cap' | 'unavailable' | 'locked';
  } | null;
}
