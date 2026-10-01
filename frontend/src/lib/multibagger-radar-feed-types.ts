import type { DealKind, DealTerms, OwnedNumber, ResolvedEntity, SourceSubject } from './radar-owned-types';

// zzz841 — the minimal feed-event shape the Multibagger Radar reads. A local
// structural interface so the Special Situations page's private CanonicalEvent
// never has to be exported (Next.js page-export rule). Any object with these
// fields fits; extra fields (catalyst scores etc.) are ignored on purpose.

export interface RadarFeedItem {
  id?: string;
  title: string;
  link?: string;
  source?: string;
  region?: 'IN' | 'US' | 'GLOBAL';
  pub_date?: string;
  age_hours?: number;
  category?: string;
  tickers?: string[];
  description?: string;
}

export interface RadarFeedEvent {
  event_id: string;
  event_type: string;
  category?: string;
  target_name?: string;
  primary_filing: RadarFeedItem;
  filings?: RadarFeedItem[];
  tier?: 'TIER_1' | 'TIER_2' | 'WATCHLIST' | 'NOISE' | string;
  why_tradable?: { what_happened?: string; what_matters?: string; what_to_watch?: string; what_breaks_thesis?: string };
  region?: 'IN' | 'US' | 'GLOBAL';
  tickers?: string[];
  is_fund?: boolean;
  primary_source?: boolean;
  age_hours?: number;
}

/**
 * zzz847 - optional hints the adapter attaches to a RadarInput (additive; the
 * engine may read them to quarantine or re-type an item). Names are stable.
 */
export interface RadarFeedHints {
  /** Price-move article (share price falls/jumps, since-listing performance). Not a corporate event. */
  isPriceArticle?: boolean;
  /** Results / record-date preview: the result is not out yet. */
  isPreview?: boolean;
  /** Broker target / rating change / "stocks to buy". Non-investment signal. */
  isAnalystTarget?: boolean;
  /** Opinion / prediction / question headline. */
  isOpinion?: boolean;
  /** Government / pay-commission / union news. Not a company. */
  isNonCorporate?: boolean;
  /** SEC Form 10-12G/B registration of a class of securities (not a spin-off). */
  isRegistration?: boolean;
  /** Generic subtype decided from the headline wording. */
  subtypeHint?: 'MERGER' | 'SPIN' | 'FINANCING' | 'GUIDANCE_PLAN' | 'LISTING_DONE' | 'NEW_PRODUCT' | null;
  /** Price / dividend / percent spans that must never be shown as earnings-number evidence. */
  nonEarningsNumbers?: string[];
  /** True when the ticker came from the feed or the headline subject; false means ticker is null on purpose. */
  tickerResolved?: boolean;
  /** How many duplicate cards were merged into this one. */
  mergedDuplicates?: number;
  /** Fund / BDC / interval-fund / feeder periodic repurchase offer (SC TO-I). Not an equity special situation. */
  isFundRepurchaseOffer?: boolean;
  /** Set when the item is held out of the main list; shown only in the visible 'held back' line. */
  feedQuarantineReason?: 'FUND_REPURCHASE_OFFER' | null;
  feedQuarantineLabel?: string;
  /** The subject is a group / promoter name ('<X> Group'): no listed ticker. */
  groupName?: boolean;
  /** Text to show next to the ticker: 'via parent <name>' or 'No listed ticker (group)'. */
  tickerNote?: string;
  /** Listed parent name when the ticker is the parent's (subsidiary / brand). */
  tickerVia?: string;
  /** SC 13E-3 text: percentages in it are legal boilerplate, never a deal amount. */
  isLegalBoilerplateAmount?: boolean;
  // ─── zzz852 (all optional; absent = not stated) ───
  /** Every money / capacity figure with its owner. Only entityRole 'parent' items with countsAsParentEarnings may be read as the company's earnings. */
  ownedNumbers?: OwnedNumber[];
  /** Entity resolution result. The card ticker is set only when entity.state === 'RESOLVED'. */
  entity?: ResolvedEntity;
  /** Deal terms read from the text only (kind-specific); `missing` lists what the source did not state. */
  dealTerms?: DealTerms;
  /** Who the headline is about / who is bought / whose financials these are. */
  sourceSubject?: SourceSubject;
  /** Precise ticker state text: 'Ticker: UTMD (Nasdaq)', 'Listed - security not identified', 'Unlisted / private', 'Not applicable (fund)', 'Not resolved yet'. */
  tickerLabel?: string;
  /** What the headline itself announces. 'DIVIDEND' even when the headline also mentions a profit fall; the engine keeps the corporate-action hierarchy. */
  eventHeadlineKind?: DealKind | 'EARNINGS' | 'OTHER';
  /** Secondary facts in the headline (for example the profit clause of a dividend headline). Never the primary kind. */
  secondaryFacts?: string[];
  /** Set by the QA layer: held out of the equity radar (flag only, the record is kept). */
  excludedFromEquityRadar?: boolean;
  exclusionReason?: string;
}
