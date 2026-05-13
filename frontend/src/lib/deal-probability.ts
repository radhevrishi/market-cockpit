// PATCH 0306 — Deal-probability heuristic engine.
//
// Estimates probability of an M&A / takeover / open-offer event closing,
// from a set of observable signals. Designed to plug into the merger-arb
// math (lib/merger-arb.ts) so callers can compute probability-weighted
// expected IRR.
//
// THIS IS A HEURISTIC, not a model. It captures the institutional rules
// of thumb most arb desks use mentally:
//   1. Filing tier — actual SEC/NSE filing > board approval > rumor.
//   2. Spread tightness — tight spread = market pricing high probability.
//   3. Time elapsed — deals that linger past expected close lose probability.
//   4. Regulatory hurdles — CCI / NCLT / SEBI overhangs cost 10-20 points.
//   5. Hostile vs friendly — hostile bids cost ~15 points.
//   6. Acquirer financing — confirmed cash > stock-and-cash > stock-only.
//
// When the real backend deal-prob engine lands (lifecycle state machine
// + actual filing parser), this lib becomes the prior + the backend
// becomes the posterior. For now, this gives users a directional read.

export type FilingTier =
  | 'BINDING_AGREEMENT'   // signed merger agreement / open-offer filed
  | 'BOARD_APPROVED'      // board green-light, no binding yet
  | 'PRELIMINARY_OFFER'   // formal but non-binding bid
  | 'EXPLORATORY'         // exploring strategic alternatives
  | 'RUMOR';              // press leak only

export type Friendliness = 'FRIENDLY' | 'HOSTILE' | 'NEGOTIATED';

export type FinancingType = 'ALL_CASH' | 'CASH_AND_STOCK' | 'ALL_STOCK' | 'UNDISCLOSED';

export interface RegulatoryHurdles {
  /** Antitrust / competition commission required. Default false. */
  cci?: boolean;
  /** SEBI no-objection required (Indian takeovers). Default false. */
  sebi?: boolean;
  /** NCLT scheme of arrangement required (demergers / mergers in India). Default false. */
  nclt?: boolean;
  /** Cross-border / FEMA / FDI overhang. Default false. */
  cross_border?: boolean;
  /** Sectoral regulator (RBI for banks, IRDAI for insurance, etc). Default false. */
  sectoral?: boolean;
}

export interface DealProbabilityInput {
  filingTier: FilingTier;
  spreadPct?: number;                  // from merger-arb.ts; tighter spread = higher probability
  daysSinceAnnounced?: number;         // older = more risk
  expectedCloseDays?: number;          // how long the deal was originally expected to take
  friendliness?: Friendliness;         // default FRIENDLY
  financing?: FinancingType;           // default UNDISCLOSED
  hurdles?: RegulatoryHurdles;         // default no hurdles
  insiderOwnershipPct?: number;        // 0-100; high promoter stake = harder block
  alreadyApprovedBy?: Array<'CCI' | 'SEBI' | 'NCLT' | 'CROSS_BORDER' | 'SECTORAL'>;
}

export interface DealProbabilityResult {
  /** Final probability estimate (0-100). */
  score: number;
  /** Label bucket for UI. */
  label: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  color: string;
  /** Breakdown of every factor that affected the score for transparency. */
  factors: Array<{ label: string; delta: number; explanation: string }>;
}

const FILING_TIER_BASE: Record<FilingTier, number> = {
  BINDING_AGREEMENT:   88,
  BOARD_APPROVED:      75,
  PRELIMINARY_OFFER:   55,
  EXPLORATORY:         35,
  RUMOR:               20,
};

const COLOR_FOR_LABEL: Record<DealProbabilityResult['label'], string> = {
  VERY_HIGH: '#10B981',
  HIGH:      '#22D3EE',
  MEDIUM:    '#F59E0B',
  LOW:       '#FB923C',
  VERY_LOW:  '#EF4444',
};

function bucketFor(score: number): DealProbabilityResult['label'] {
  if (score >= 85) return 'VERY_HIGH';
  if (score >= 70) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 30) return 'LOW';
  return 'VERY_LOW';
}

export function computeDealProbability(input: DealProbabilityInput): DealProbabilityResult {
  const factors: DealProbabilityResult['factors'] = [];

  const base = FILING_TIER_BASE[input.filingTier];
  factors.push({
    label: `Tier · ${input.filingTier}`,
    delta: base,
    explanation: 'Base probability from filing tier — binding agreements close ~88% of the time historically.',
  });

  let score = base;

  // 1) Spread tightness: tighter than 2% = market pricing very high probability
  if (typeof input.spreadPct === 'number' && Number.isFinite(input.spreadPct)) {
    let d = 0;
    if (input.spreadPct < 0) d = -8;        // bidder underwater
    else if (input.spreadPct < 2) d = +8;   // very tight
    else if (input.spreadPct < 5) d = +3;   // normal
    else if (input.spreadPct < 10) d = -5;  // wide
    else d = -12;                            // blowout — market expects failure
    score += d;
    factors.push({
      label: `Spread ${input.spreadPct.toFixed(1)}%`,
      delta: d,
      explanation: d > 0
        ? 'Tight spread means market is pricing high probability of completion.'
        : 'Wide / negative spread signals market doubts the deal closes at offer terms.',
    });
  }

  // 2) Stalled-deal penalty
  if (typeof input.daysSinceAnnounced === 'number'
      && typeof input.expectedCloseDays === 'number'
      && input.expectedCloseDays > 0) {
    const overrunDays = input.daysSinceAnnounced - input.expectedCloseDays;
    if (overrunDays > 0) {
      const d = -Math.min(20, Math.round(overrunDays / 7) * 3); // ~3pt / week overrun, cap −20
      score += d;
      factors.push({
        label: `Stalled +${overrunDays}d`,
        delta: d,
        explanation: 'Deal has run past its expected close — each week of overrun shaves ~3pt.',
      });
    }
  }

  // 3) Hostile / friendly
  if (input.friendliness === 'HOSTILE') {
    score -= 15;
    factors.push({ label: 'Hostile bid', delta: -15, explanation: 'Hostile takeovers face board resistance + competing bidders.' });
  } else if (input.friendliness === 'NEGOTIATED') {
    score += 3;
    factors.push({ label: 'Negotiated', delta: +3, explanation: 'Friendly negotiated deals close more reliably.' });
  }

  // 4) Financing
  if (input.financing === 'ALL_CASH') {
    score += 4;
    factors.push({ label: 'All-cash', delta: +4, explanation: 'All-cash deals avoid acquirer-stock dilution risk and arrive at certain consideration.' });
  } else if (input.financing === 'ALL_STOCK') {
    score -= 4;
    factors.push({ label: 'All-stock', delta: -4, explanation: 'Stock-only consideration adds acquirer-volatility risk to spread.' });
  }

  // 5) Regulatory hurdles + which have already cleared
  const hurdles = input.hurdles || {};
  const approved = new Set(input.alreadyApprovedBy || []);
  const hurdlePenalty = (key: keyof RegulatoryHurdles, approvedKey: NonNullable<DealProbabilityInput['alreadyApprovedBy']>[number], penalty: number, label: string) => {
    if (hurdles[key] && !approved.has(approvedKey)) {
      score -= penalty;
      factors.push({ label: `${label} pending`, delta: -penalty, explanation: `${label} approval still pending — historical bottleneck.` });
    } else if (hurdles[key] && approved.has(approvedKey)) {
      score += Math.round(penalty / 2);
      factors.push({ label: `${label} approved`, delta: +Math.round(penalty / 2), explanation: `${label} clearance secured — removes a known risk factor.` });
    }
  };
  hurdlePenalty('cci', 'CCI', 6, 'CCI');
  hurdlePenalty('sebi', 'SEBI', 4, 'SEBI');
  hurdlePenalty('nclt', 'NCLT', 8, 'NCLT');
  hurdlePenalty('cross_border', 'CROSS_BORDER', 5, 'Cross-border');
  hurdlePenalty('sectoral', 'SECTORAL', 6, 'Sectoral regulator');

  // 6) Insider / promoter stake — higher stake = harder for activists to block
  if (typeof input.insiderOwnershipPct === 'number') {
    if (input.insiderOwnershipPct >= 50) {
      score += 4;
      factors.push({ label: 'Promoter ≥50%', delta: +4, explanation: 'Majority-promoter deals rarely fail at the vote.' });
    } else if (input.insiderOwnershipPct >= 25) {
      score += 2;
      factors.push({ label: 'Promoter 25-50%', delta: +2, explanation: 'Strong promoter stake reduces activist resistance.' });
    } else if (input.insiderOwnershipPct < 10) {
      score -= 3;
      factors.push({ label: 'Promoter <10%', delta: -3, explanation: 'Low insider control raises tactical-vote risk.' });
    }
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));
  const label = bucketFor(score);
  return { score: Math.round(score), label, color: COLOR_FOR_LABEL[label], factors };
}
