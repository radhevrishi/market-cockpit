// zzz852: shared contract between the feed/entity layer (adapter, feed-quality, deal terms) and the radar engine.
// Every extracted number has an owner. A number owned by a target, subsidiary, transaction or industry is NEVER the parent's financial impact.

export type NumberMetric =
  | 'revenue' | 'ebitda' | 'pat' | 'eps' | 'order_value' | 'purchase_price' | 'deal_value' | 'investment' | 'capex'
  | 'capacity' | 'offer_price' | 'dividend_per_share' | 'buyback_size' | 'market_size' | 'percent_stake' | 'share_price' | 'other';

export type EntityRole =
  | 'parent' | 'subsidiary' | 'target' | 'acquired_asset' | 'seller' | 'industry' | 'competitor' | 'transaction' | 'market' | 'regulator' | 'unrelated_comparison' | 'unknown'
  // zzz854: explicit deal roles. 'subject' = the company the source is about (same as parent when not a deal); 'acquirer' = the buyer in a deal
  // headline (the event company); 'deal' = the consideration / transaction itself (alias of 'transaction').
  | 'subject' | 'acquirer' | 'deal';

/** zzz854: what kind of figure this is. Only 'reported' figures owned by the subject can ever be its earnings. */
export type NumberNature = 'reported' | 'forecast' | 'deal_consideration' | 'capacity' | 'order_value' | 'market_size' | 'shareholder_payout' | 'other';

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
  // ── zzz854 (optional, filled by the engine for every number it shows) ──
  /** Who the figure belongs to, in words ('Yoga Bar', 'ITC', 'industry / market', 'transaction'). Same as `entity`, kept explicit for the UI. */
  metricOwner?: string;
  /** reported / forecast / deal consideration / capacity / order value / market size. A forecast, deal, capacity, order or market figure is never revenue. */
  nature?: NumberNature;
  /** One plain line for the card: 'Target (Yoga Bar) revenue ₹452 cr — not ITC's revenue; ITC's incremental revenue: Not established'. */
  ownerLabel?: string;
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

export type DealKind = 'TENDER' | 'ACQUISITION' | 'MERGER' | 'SPIN_OFF' | 'BUYBACK' | 'DIVIDEND' | 'SPLIT_BONUS' | 'LEGAL' | 'CAPITAL_RAISE' | 'OTHER'
  // zzz854: a going-private transaction (SC 13E-3) is not a tender: its own terms (consideration, buyer group, vote condition, fairness opinion)
  | 'GOING_PRIVATE';

/** zzz854: the economic subtype of a corporate transaction. Each has its own evidence chain and payoff wording. */
export type DealSubtype = 'THIRD_PARTY_TENDER' | 'ISSUER_TENDER' | 'GOING_PRIVATE' | 'SPIN_OFF' | 'ACQUISITION' | 'STAKE_INVESTMENT' | 'MERGER' | 'BUYBACK' | 'OPEN_OFFER';

export interface DealTerms {
  kind: DealKind;
  /** fields found in the source text only; absent = not stated (never inferred) */
  fields: Record<string, string>;
  /** list of stated conditions (expiry, minimum acceptance, financing, approvals) exactly as found */
  statedConditions: string[];
  /** names of the deal fields the source did not state (shown as 'Not stated') */
  missing: string[];
}

export interface SourceSubject {
  eventSubject: string; target?: string; sourceSubject: string; financialOwner?: string;
  /** zzz854 (optional): the buyer in a deal (SC TO-T filed-by, 'A acquires B'). */
  acquirer?: string;
}
