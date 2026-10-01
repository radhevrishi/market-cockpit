// zzz852: shared contract between the feed/entity layer (adapter, feed-quality, deal terms) and the radar engine.
// Every extracted number has an owner. A number owned by a target, subsidiary, transaction or industry is NEVER the parent's financial impact.

export type NumberMetric =
  | 'revenue' | 'ebitda' | 'pat' | 'eps' | 'order_value' | 'purchase_price' | 'deal_value' | 'investment' | 'capex'
  | 'capacity' | 'offer_price' | 'dividend_per_share' | 'buyback_size' | 'market_size' | 'percent_stake' | 'share_price' | 'other';

export type EntityRole =
  | 'parent' | 'subsidiary' | 'target' | 'acquired_asset' | 'seller' | 'industry' | 'competitor' | 'transaction' | 'market' | 'regulator' | 'unrelated_comparison' | 'unknown';

export interface OwnedNumber {
  value: number;
  currency?: string;           // INR, USD ...
  unit?: string;               // crore, million, MW, % ...
  raw: string;                 // the text as written, e.g. "Rs 452 crore"
  metric: NumberMetric;
  period?: string;             // e.g. FY25, Q1 FY27, 'not stated'
  entity: string;              // who owns the number: 'Yoga Bar', 'acquisition transaction', 'acquired wind assets'
  entityRole: EntityRole;
  sentence: string;            // source sentence
  /** true only when entityRole is 'parent' (the event company itself) and the metric is a financial statement line */
  countsAsParentEarnings: boolean;
}

export type EntityResolutionState = 'RESOLVED' | 'RESOLVED_MULTIPLE' | 'UNLISTED' | 'NOT_APPLICABLE' | 'UNRESOLVED';

export interface ResolvedEntity {
  legalEntity: string;
  listedIssuer?: string | null;
  security?: string | null;    // 'Common stock'
  ticker?: string | null;
  exchange?: string | null;
  state: EntityResolutionState;
  /** why: 'catalog match', 'filing header', 'parent of subsidiary', 'fund', 'regulator', 'no listed security found' */
  basis: string;
  entityType?: 'OPERATING_COMPANY' | 'FUND' | 'REGULATOR' | 'COURT' | 'PRIVATE' | 'VEHICLE' | 'GROUP' | 'UNKNOWN';
}

export type DealKind = 'TENDER' | 'ACQUISITION' | 'MERGER' | 'SPIN_OFF' | 'BUYBACK' | 'DIVIDEND' | 'SPLIT_BONUS' | 'LEGAL' | 'CAPITAL_RAISE' | 'OTHER';

export interface DealTerms {
  kind: DealKind;
  /** fields found in the source text only; absent = not stated (never inferred) */
  fields: Record<string, string>;
  /** list of stated conditions (expiry, minimum acceptance, financing, approvals) exactly as found */
  statedConditions: string[];
  /** names of the deal fields the source did not state (shown as 'Not stated') */
  missing: string[];
}

export interface SourceSubject { eventSubject: string; target?: string; sourceSubject: string; financialOwner?: string }
