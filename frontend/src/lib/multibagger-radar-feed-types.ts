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
  /** zzz854: SEC /A amendments the route already folded into this event (optional; the adapter also folds them itself). */
  amendments?: RadarFeedItem[];
  amendment_count?: number;
  /** zzz854 wave 2: a hold-back reason the route already decided (classifier, QA exclusion or verification gate). */
  quarantine_reason?: FeedHoldBackReason | string | null;
  excluded_from_equity_radar?: boolean;
  exclusion_reason?: string;
  /** 'PLAYBOOK' = why_tradable.what_matters / what_breaks_thesis are per-event-type templates, not source facts. */
  why_tradable_kind?: 'PLAYBOOK' | string;
}

// ─── zzz854 shared shapes (feed layer -> engine / UI). All additive and optional. ───

/** Why an item is held out of the Special Situations list. One reason per item; counts are kept per reason. */
export type FeedHoldBackReason =
  | 'FUND_REPURCHASE_OFFER'          // pooled vehicle (fund / BDC / interval / feeder / private credit / non-traded REIT) periodic repurchase or tender
  | 'PARTNERSHIP_UNIT_REPURCHASE'    // LLC / LP / LLLP unit or interest repurchase (not listed common equity)
  | 'DEBT_TENDER'                    // tender / exchange offer for notes, bonds, debentures
  | 'ROUTINE_ISSUER_TENDER'          // employee / option-exchange, odd-lot or periodic issuer tender
  | 'ISSUER_TENDER_TERMS_NOT_READ'   // operating-company SC TO-I with nothing saying it is an equity buyback
  | 'EXCLUDED_FROM_EQUITY_RADAR'     // regulator / court / unlisted / unidentified entity (route QA exclusion)
  | 'AWAITING_VERIFICATION'          // not primary-verified and not AI-confirmed yet (verification gate)
  | 'AI_CONTRADICTED';               // the AI verifier read the primary document and it contradicts the event

/** SEC form -> event subtype. 'AMENDMENT' is never a subtype: an /A keeps its base form's subtype and sets isAmendment. */
export type SecEventSubtype =
  | 'THIRD_PARTY_TENDER'        // SC TO-T: acquirer = filed-by entity, target = subject
  | 'ISSUER_TENDER'             // SC TO-I: the issuer buys its own securities
  | 'GOING_PRIVATE'             // SC 13E3: going-private transaction (not a tender)
  | 'TARGET_RECOMMENDATION'     // SC 14D9: the target's response to a tender
  | 'SPIN_OFF_REGISTRATION'     // 10-12B: registration of the spun-off company
  | 'SECURITIES_REGISTRATION'   // 10-12G (no spin-off wording): registration of a class of securities
  | 'OTHER_FILING';

export interface SecFilingInfo {
  form: string;                 // as filed, e.g. 'SC TO-T/A'
  baseForm: string;             // without /A, normalised, e.g. 'SC TO-T', 'SC 13E3', '10-12B'
  isAmendment: boolean;
  subtype: SecEventSubtype;
  subtypeLabel: string;         // 'Third-party tender offer', 'Going-private transaction (SC 13E3)' ...
  /** number of /A amendments folded into this one event */
  amendmentCount: number;
  /** pub date of the original (non-amendment) filing when seen, and of the latest amendment */
  originalDate: string | null;
  latestAmendmentDate: string | null;
  /** latest date of any filing in the chain (original or amendment) */
  latestFilingDate: string | null;
  accession: string | null;
  subjectCik: string | null;
  filerCik: string | null;
}

/** Who is who in a deal. Names as written in the source (EDGAR all-caps names are title-cased for display). */
export interface DealRoles {
  /** EDGAR '(Subject)' company = the company whose securities the filing is about (the target in a tender). */
  subject: string | null;
  /** EDGAR '(Filed by)' entity, when the feed carried that row. */
  filer: string | null;
  acquirer: string | null;
  /** acquirer ticker when the filed-by CIK / name resolves (never guessed) */
  acquirerTicker?: string | null;
  target: string | null;
  /** Whose economics the deal is about: for tenders / going-private, the target's shareholders. */
  financialOwner: string | null;
  /** One render-ready line, e.g. 'Acquirer: Beretta Holding S.A. -> Target: Sturm Ruger & Co Inc'. Null when roles are not established. */
  roleLine: string | null;
  /** 'Acquirer not stated in the feed' etc. */
  notes: string[];
}

/** Ticker / security resolution state. Never the bare 'No ticker'. */
export type SecurityState = 'RESOLVED' | 'RESOLVED_MULTIPLE' | 'UNLISTED' | 'UNLISTED_SUBSIDIARY' | 'NON_EQUITY_ENTITY' | 'NOT_APPLICABLE' | 'UNRESOLVED';
export interface SecurityResolution {
  state: SecurityState;
  /** render-ready, e.g. 'Ticker: RGR (NYSE)', 'Resolved - multiple securities: A, B', 'Unlisted subsidiary - listed parent: Vedanta (VEDL)', 'Unresolved - CIK not in ticker map' */
  label: string;
  /** why (also for RESOLVED: the basis) */
  reason: string;
  ticker: string | null;
  tickers?: string[];
  exchange: string | null;
  listedParent?: { name: string; ticker: string | null } | null;
}

/** One information origin: the same underlying filing / release / report, however many copies were seen. */
export interface InformationOrigin {
  originId: string;
  kind: 'PRIMARY_DISCLOSURE' | 'MEDIA_REPORT';
  /** indexes into the source list the origin was computed over */
  members: number[];
  labels: string[];
}
export interface SourceOriginSummary {
  /** every source item seen (filings, party listings, amendments, articles) */
  sourceCount: number;
  /** distinct information origins. Evidence strength must use this, never sourceCount. */
  independentOrigins: number;
  /** copies that are rewrites / syndication of an origin already counted */
  syndicatedCopies: number;
  /** SEC /A amendments of a filing already counted */
  amendmentCopies: number;
  /** the same filing listed once per party (subject / filed-by) */
  partyListings: number;
  /** sourceCount === independentOrigins + syndicatedCopies + amendmentCopies + partyListings (always true) */
  origins: InformationOrigin[];
  /** render-ready, e.g. '4 items - 1 independent origin (2 amendments, 1 party listing)' */
  line: string;
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
  /** Set when the item is held out of the main list; shown only in the visible 'held back' line. zzz854: one reason per item. */
  feedQuarantineReason?: FeedHoldBackReason | null;
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
  // ─── zzz854 (all optional; absent = not computed) ───
  /** SEC form context (form, subtype, amendment chain, CIKs). Null for non-SEC items. */
  secFiling?: SecFilingInfo | null;
  /** Event subtype from the SEC form (SC TO-T, SC TO-I, SC 13E3, 14D9, 10-12B ...). */
  eventSubtype?: SecEventSubtype | null;
  eventSubtypeLabel?: string;
  /** Acquirer / target / filer / subject / financial owner of the deal. */
  dealRoles?: DealRoles | null;
  /** Explicit ticker / security state (replaces 'No ticker'). */
  securityState?: SecurityState;
  securityLabel?: string;
  security?: SecurityResolution;
  /** The only source text is a bare SEC form title ('SC TO-I - X (CIK) (Subject)'): the filing exists, its terms were NOT read. Evidence must not be shown as Confirmed terms. */
  formTitleOnly?: boolean;
  /** Ceiling the engine must respect. 'FILING_EXISTS_TERMS_NOT_READ' = a filing exists, nothing about its terms is known. */
  evidenceCeiling?: 'FILING_EXISTS_TERMS_NOT_READ' | null;
  /** The feed's why_tradable text is a per-event-type playbook template, never source evidence. */
  feedFactsAreTemplate?: boolean;
  /** Information-origin view of the sources (independence by origin, not outlet). */
  sourceOrigins?: SourceOriginSummary;
  independentOrigins?: number;
  /** Deal-term field names dropped because the value only repeated the headline / form title. */
  dealTermsDropped?: string[];
}
