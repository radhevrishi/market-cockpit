// PATCH 0321 — Special Situations playbook intelligence library.
//
// Static knowledge base of historical pattern templates for the most
// common Indian + US M&A / spin-off / takeover event types. Each
// playbook captures:
//
//   - expected timeline (avg days from announcement to close)
//   - historical success rate (% deals that closed at stated terms)
//   - typical spread at announcement vs at close
//   - dominant failure modes
//   - sources of friction
//   - tactical guidance (when to enter / exit)
//
// Surfaces on Special Situations cards so a user reading an event has
// the institutional prior immediately visible.
//
// These templates are based on a synthesis of public Indian M&A
// outcomes 2015–2025 + standard US merger-arb references (Greenblatt,
// Mauboussin, Cornell). They are NOT pulled from a live DB.

export type EventType =
  | 'OPEN_OFFER'              // Indian SEBI Takeover Code mandatory offer
  | 'VOLUNTARY_OFFER'         // Indian voluntary tender
  | 'BUYBACK_TENDER'          // Indian Companies Act tender buyback
  | 'BUYBACK_OPEN_MARKET'     // Indian open-market buyback
  | 'SPIN_OFF'                // Demerger / scheme of arrangement
  | 'GOING_PRIVATE'           // SC 13E3 / private equity take-private
  | 'STRATEGIC_MERGER'        // Horizontal / vertical merger
  | 'INDEX_INCLUSION'         // NIFTY / Sensex inclusion event
  | 'INDEX_EXCLUSION'         // NIFTY / Sensex deletion event
  | 'RIGHTS_ISSUE'            // Rights with capital infusion
  | 'PREFERENTIAL_ALLOTMENT'  // QIP / preferential
  | 'OFS'                     // Promoter OFS
  | 'NCLT_SCHEME'             // NCLT scheme of arrangement
  | 'IPO_LISTING'             // Day-one listing event
  | 'DELISTING'               // Going-private from listed exchange
  | 'PROMOTER_STAKE_HIKE';    // Creeping acquisition

export interface Playbook {
  event_type: EventType;
  label: string;
  /** Average days from formal announcement to close, historical. */
  avg_close_days: number;
  /** Range of close days, [p25, p75]. */
  close_days_range: [number, number];
  /** Historical % of these events that completed at stated terms. */
  success_rate_pct: number;
  /** Typical spread at announcement (offer price vs spot, %). */
  typical_spread_pct: number;
  /** Description of the dominant failure modes. */
  failure_modes: string[];
  /** Sources of friction that delay close. */
  friction_points: string[];
  /** Tactical entry / exit guidance. */
  tactics: string;
  /** Whether retail typically over-tenders, leaving institutions arbitrage. */
  retail_overhang: 'YES' | 'NO' | 'SOMETIMES';
}

export const PLAYBOOKS: Record<EventType, Playbook> = {
  OPEN_OFFER: {
    event_type: 'OPEN_OFFER',
    label: 'Open Offer (SEBI Takeover Code)',
    avg_close_days: 75,
    close_days_range: [55, 110],
    success_rate_pct: 92,
    typical_spread_pct: 3.5,
    failure_modes: [
      'SEBI declines minimum-price calculation (rare ~3%)',
      'Acquirer pulls offer due to material adverse change (rare ~2%)',
      'Court injunction from minority shareholders (very rare)',
    ],
    friction_points: [
      'SEBI letter of offer review (typical 30-40 days)',
      'Public-announcement to draft-LOO turnaround (~21 days)',
      'Open-offer window itself is mandated 10 working days',
    ],
    tactics: 'Enter on announcement-day dip (often -2 to -4% intraday). Exit by tendering shares into the window; institutional spread capture is the SEBI-mandated price minus current spot.',
    retail_overhang: 'YES',
  },
  VOLUNTARY_OFFER: {
    event_type: 'VOLUNTARY_OFFER',
    label: 'Voluntary Tender Offer',
    avg_close_days: 60,
    close_days_range: [40, 90],
    success_rate_pct: 78,
    typical_spread_pct: 5,
    failure_modes: [
      'Acceptance below minimum threshold (~15% of cases)',
      'Acquirer withdraws after CCI delay',
      'Better counter-offer emerges (4-5% of cases)',
    ],
    friction_points: ['CCI approval if size > threshold', 'Acceptance ratio uncertainty'],
    tactics: 'Voluntary offers without minimum-acceptance condition are higher-conviction. Check minimum threshold carefully — failure to clear it returns all shares un-tendered.',
    retail_overhang: 'SOMETIMES',
  },
  BUYBACK_TENDER: {
    event_type: 'BUYBACK_TENDER',
    label: 'Tender Buyback (Companies Act 2013)',
    avg_close_days: 90,
    close_days_range: [70, 130],
    success_rate_pct: 99,
    typical_spread_pct: 8,
    failure_modes: ['Almost never fails once record date is set'],
    friction_points: [
      'Acceptance ratio dilution — small shareholders (<₹2L holding) get ~100% acceptance, large get 5-20%',
      'Record-date dynamics: spread typically widens 2-3 days before record date as arbitrageurs accumulate',
    ],
    tactics: 'For positions < ₹2L total cost: enter before record date; 100% acceptance ratio = full premium captured. For large positions, model the acceptance ratio carefully — the residual post-buyback shares are exposed to mean-reversion.',
    retail_overhang: 'NO',
  },
  BUYBACK_OPEN_MARKET: {
    event_type: 'BUYBACK_OPEN_MARKET',
    label: 'Open-Market Buyback',
    avg_close_days: 180,
    close_days_range: [120, 365],
    success_rate_pct: 95,
    typical_spread_pct: 4,
    failure_modes: ['Company abandons mid-program (5%)', 'Hits 25% of average daily volume cap repeatedly = slow execution'],
    friction_points: ['No defined timeline', 'Daily volume caps slow accumulation'],
    tactics: 'Lower-conviction arb than tender buyback. Treat the announced ceiling as soft anchor; price drift toward ceiling but rarely above.',
    retail_overhang: 'NO',
  },
  SPIN_OFF: {
    event_type: 'SPIN_OFF',
    label: 'Demerger / Spin-Off',
    avg_close_days: 270,
    close_days_range: [180, 540],
    success_rate_pct: 88,
    typical_spread_pct: 12,
    failure_modes: ['NCLT delay > 12 months (15%)', 'Stock-exchange listing held up by SEBI', 'Promoter sub-categorization disputes'],
    friction_points: [
      'NCLT approval typical 6-9 months',
      'SEBI / Stock exchange listing approvals ~3 months post-NCLT',
      'Record-date arbitrage as ex-demerger price discovers',
    ],
    tactics: 'Greenblatt-classic setup. Best entry is post-NCLT-approval pre-listing; least uncertainty, biggest valuation gap. Sum-of-parts unlock typically materializes 6-18 months post-listing.',
    retail_overhang: 'NO',
  },
  GOING_PRIVATE: {
    event_type: 'GOING_PRIVATE',
    label: 'Going Private / Take-Private',
    avg_close_days: 150,
    close_days_range: [100, 270],
    success_rate_pct: 82,
    typical_spread_pct: 6,
    failure_modes: [
      'Minority shareholder vote fails (12%)',
      'Special committee rejects price',
      'Competing bid forces price hike',
    ],
    friction_points: ['Special committee fairness opinion', 'Minority approval vote'],
    tactics: 'Spread tightens through the deal as vote approaches and committee endorses. Hostile take-privates are higher-risk.',
    retail_overhang: 'NO',
  },
  STRATEGIC_MERGER: {
    event_type: 'STRATEGIC_MERGER',
    label: 'Strategic Merger',
    avg_close_days: 120,
    close_days_range: [80, 240],
    success_rate_pct: 86,
    typical_spread_pct: 5,
    failure_modes: ['Antitrust block (5%)', 'Shareholder vote fails (3%)', 'Material adverse change'],
    friction_points: ['CCI / antitrust', 'Synergy realization concerns can sour acquirer board'],
    tactics: 'For all-cash deals: pure arb. For stock deals: short the acquirer in proportion to exchange ratio.',
    retail_overhang: 'NO',
  },
  INDEX_INCLUSION: {
    event_type: 'INDEX_INCLUSION',
    label: 'Index Inclusion (NIFTY / Sensex / MSCI)',
    avg_close_days: 14,
    close_days_range: [7, 30],
    success_rate_pct: 100,
    typical_spread_pct: 2,
    failure_modes: ['None — index changes are deterministic post-announcement'],
    friction_points: ['Forced buying from passive funds occurs at rebalance date'],
    tactics: 'Buy on announcement, sell ON rebalance day into passive flow. Classic forced-buying arbitrage.',
    retail_overhang: 'NO',
  },
  INDEX_EXCLUSION: {
    event_type: 'INDEX_EXCLUSION',
    label: 'Index Exclusion',
    avg_close_days: 14,
    close_days_range: [7, 30],
    success_rate_pct: 100,
    typical_spread_pct: -3,
    failure_modes: ['None'],
    friction_points: ['Forced selling from passive funds occurs at rebalance date'],
    tactics: 'Avoid the rebalance flow. Stock often bottoms 1-2 days POST rebalance and is a contrarian buy opportunity if fundamentals are intact.',
    retail_overhang: 'NO',
  },
  RIGHTS_ISSUE: {
    event_type: 'RIGHTS_ISSUE',
    label: 'Rights Issue',
    avg_close_days: 45,
    close_days_range: [30, 75],
    success_rate_pct: 92,
    typical_spread_pct: -10,
    failure_modes: ['Under-subscription forces promoter top-up', 'Withdrawal before opening'],
    friction_points: ['Theoretical ex-rights price drop on record date'],
    tactics: 'Rights at deep discount typically dilute existing shareholders. Subscribe if business is strong; avoid if rights are funding losses.',
    retail_overhang: 'YES',
  },
  PREFERENTIAL_ALLOTMENT: {
    event_type: 'PREFERENTIAL_ALLOTMENT',
    label: 'Preferential Allotment / QIP',
    avg_close_days: 30,
    close_days_range: [20, 50],
    success_rate_pct: 95,
    typical_spread_pct: 0,
    failure_modes: ['QIP fails to raise full amount (rare)'],
    friction_points: ['SEBI floor price calculation', 'Lock-in period for promoter / institutional investors'],
    tactics: 'QIPs to marquee institutional names = positive signal. QIPs to related parties at floor price = governance flag.',
    retail_overhang: 'NO',
  },
  OFS: {
    event_type: 'OFS',
    label: 'Offer for Sale (promoter OFS)',
    avg_close_days: 7,
    close_days_range: [3, 14],
    success_rate_pct: 90,
    typical_spread_pct: -5,
    failure_modes: ['Under-subscription if OFS floor is above market'],
    friction_points: ['T+2 OFS cycle is fast — no time for slow positioning'],
    tactics: 'OFS floor is typically 3-5% below market. Mechanical 2-day arbitrage by bidding at floor and selling next session.',
    retail_overhang: 'YES',
  },
  NCLT_SCHEME: {
    event_type: 'NCLT_SCHEME',
    label: 'NCLT Scheme of Arrangement',
    avg_close_days: 240,
    close_days_range: [150, 540],
    success_rate_pct: 91,
    typical_spread_pct: 8,
    failure_modes: ['NCLT rejection (5%)', 'Creditor objection upheld (3%)'],
    friction_points: [
      'NCLT bench delays — varies by jurisdiction (Mumbai/Delhi faster than Kolkata)',
      'Creditor + member committee voting',
      'Income-tax NOC for scheme effectiveness',
    ],
    tactics: 'Watch NCLT-bench-specific timelines. Mumbai NCLT averages 180-240 days post-petition. Tax NOCs add 30-60 days post-approval.',
    retail_overhang: 'NO',
  },
  IPO_LISTING: {
    event_type: 'IPO_LISTING',
    label: 'IPO Day-One Listing',
    avg_close_days: 1,
    close_days_range: [1, 1],
    success_rate_pct: 100,
    typical_spread_pct: 0,
    failure_modes: ['None — listing is mechanical post-allotment'],
    friction_points: ['Allotment ratio uncertainty for retail'],
    tactics: 'Grey-market premium (GMP) is the best proxy for listing-day pop. Track GMP from T-3 to T-1 for entry/exit calibration.',
    retail_overhang: 'YES',
  },
  DELISTING: {
    event_type: 'DELISTING',
    label: 'Voluntary Delisting',
    avg_close_days: 180,
    close_days_range: [120, 365],
    success_rate_pct: 70,
    typical_spread_pct: 10,
    failure_modes: [
      'Reverse book-building discovers price acquirer rejects (20%)',
      'Insufficient acceptance to reach 90% threshold (10%)',
    ],
    friction_points: ['Reverse book-building can run weeks; discovered price can be 20-50% above floor'],
    tactics: 'Delisting offers are the highest-asymmetry arb when entered post-announcement: floor capture if it fails (often -5%), full discovered-price capture if it succeeds (often +30 to +50%). Position size for survival of the failure case.',
    retail_overhang: 'NO',
  },
  PROMOTER_STAKE_HIKE: {
    event_type: 'PROMOTER_STAKE_HIKE',
    label: 'Promoter Stake Hike (Creeping Acquisition)',
    avg_close_days: 30,
    close_days_range: [14, 60],
    success_rate_pct: 100,
    typical_spread_pct: 3,
    failure_modes: ['None — creeping acquisition is governed by 5%-per-year rule'],
    friction_points: ['Triggers mandatory open offer when ≥25% threshold crossed'],
    tactics: 'Stake hikes near 25% are strongest signals — open offer trigger imminent. Stake hikes from <10% base are weak signals (could be financial investment).',
    retail_overhang: 'NO',
  },
};

/** Helper: get the playbook for an event type. */
export function getPlaybook(eventType: string): Playbook | undefined {
  return PLAYBOOKS[eventType as EventType];
}
