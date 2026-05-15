// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0390 — Warrant Momentum Intelligence
//
// Per user spec: "Most warrant issuances are garbage. You ONLY want
// promoter warrants issued at premium/small discount with post-breakout
// price structure + business momentum improving + small float."
//
// Two-stage pipeline:
//   1. RELEVANCE — does the subject/PDF mention warrants/preferential allotment?
//   2. CONVICTION SCORE 0-10 — strict gates on promoter participation,
//      pricing vs CMP, dilution history, business momentum, governance.
//      Only score ≥ 8 surfaces in feed.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Relevance classifier ──────────────────────────────────────────────────

export type WarrantFilingType =
  | 'PROMOTER_WARRANT'
  | 'PREFERENTIAL_ALLOTMENT'
  | 'CONVERTIBLE_WARRANT'
  | 'WARRANT_CONVERSION'
  | 'QIP_WARRANT'
  | 'OTHER_WARRANT';

// PATCH 0407 — broadened: previously many genuine warrant filings on NSE
// came through as "Preferential Issue / Fund Raising" subjects without the
// literal word "warrant" appearing — the actual warrant terms were in the
// PDF body. Result was 0 warrants detected across 4600+ filings. New
// patterns catch the umbrella categories (preferential / fund raising /
// EGM consent / board meeting outcome with allotment), and the classifier
// also accepts body text so PDF-extracted content surfaces warrants too.
const WARRANT_PATTERNS: Array<{ type: WarrantFilingType; re: RegExp }> = [
  // Promoter warrant — strongest signal
  { type: 'PROMOTER_WARRANT',
    re: /(?:warrants?\s+(?:issued?|allotted?|allotment|to)\s+(?:promoter|promoter\s+group)|promoter[\s-]+warrants?|preferential\s+(?:issue|allotment).*promoter)/i },
  // Preferential allotment (could be promoter or third-party). Common subject.
  { type: 'PREFERENTIAL_ALLOTMENT',
    re: /preferential\s+(?:issue|allotment|offer|placement)|(?:issue|allotment)\s+on\s+(?:a\s+)?preferential\s+basis|allotment\s+of\s+(?:equity\s+shares\s+(?:and|or|with))?\s*warrants?/i },
  // Convertible warrant / equity warrant
  { type: 'CONVERTIBLE_WARRANT',
    re: /(?:convertible\s+warrants?|equity\s+warrants?|warrants?\s+convertible\s+into\s+equity)/i },
  // Warrant conversion notice (existing warrants being converted)
  { type: 'WARRANT_CONVERSION',
    re: /(?:warrant\s+conversion|conversion\s+of\s+warrants?|exercise\s+of\s+warrants?|warrants?\s+(?:into|to)\s+equity\s+shares?)/i },
  // QIP with warrants
  { type: 'QIP_WARRANT',
    re: /(?:qualified\s+institutions?\s+placement|QIP).*warrants?/i },
  // Fund raising via warrants — PATCH 0407
  { type: 'PREFERENTIAL_ALLOTMENT',
    re: /fund[\s-]?rais(?:e|ing).*(?:warrant|preferential)|equity\s+infusion\s+via\s+(?:warrant|preferential)/i },
  // Notice/Outcome of EGM/Board for warrants — PATCH 0407
  { type: 'PREFERENTIAL_ALLOTMENT',
    re: /(?:notice|outcome|intimation)\s+of\s+(?:e?gm|annual\s+general\s+meeting|board\s+meeting).*(?:preferential|warrant)|(?:e?gm|board)\s+(?:approval|consent).*(?:preferential|warrant)/i },
  // PATCH 0419 — even broader nets: most BSE/NSE warrant filings come
  // through as plain "Fund Raising" / "Allotment of Equity Shares" /
  // "Issue of Securities" without "warrant" or "preferential" in subject.
  // Let them through and we'll rank/filter at conviction step.
  { type: 'OTHER_WARRANT',
    re: /\b(?:fund[\s-]?raising|fund[\s-]?raise|raising\s+of\s+capital|capital\s+raise|raise\s+capital)\b/i },
  { type: 'OTHER_WARRANT',
    re: /\ballotment\s+of\s+(?:equity\s+shares|securities|convertible)/i },
  { type: 'OTHER_WARRANT',
    re: /\bissue\s+of\s+(?:securities|equity\s+shares\s+on\s+preferential)/i },
  { type: 'OTHER_WARRANT',
    re: /\b(?:promoter|promoter\s+group)\s+(?:participating|subscribing|conversion|allotted)/i },
  // PATCH 0421 — even broader umbrella subjects. User reported 0/4132 warrant
  // matches over a 14d window which is implausible. NSE/BSE often file these
  // under generic subjects without "warrant" / "preferential" in the title;
  // the real terms are in the PDF body. Let umbrellas through; the strict
  // conviction gate (≥8/10) still filters at scoring time.
  { type: 'OTHER_WARRANT',
    re: /\b(?:postal\s+ballot|special\s+resolution).*(?:preferential|warrant|allotment|issue|capital|securities|fund)/i },
  { type: 'OTHER_WARRANT',
    re: /\b(?:notice|outcome|intimation|disclosure)\s+of\s+(?:e?gm|annual\s+general\s+meeting|extra[\s-]?ordinary\s+general\s+meeting|board\s+meeting)/i },
  { type: 'OTHER_WARRANT',
    re: /\b(?:e?gm|extra[\s-]?ordinary\s+general\s+meeting)\b/i },
  { type: 'OTHER_WARRANT',
    re: /\bissue\s+of\s+(?:warrants?|equity\s+shares|securities|convertible|debenture)/i },
  { type: 'OTHER_WARRANT',
    re: /\b(?:reg(?:ulation)?\s*30|sebi\s+reg(?:ulation)?\s*30).*(?:allotment|warrant|preferential|fund|capital|securities|issue)/i },
  // Generic warrant mention as a fallback
  { type: 'OTHER_WARRANT',
    re: /\bwarrants?\b/i },
];

export function classifyWarrantFiling(subject: string, body: string = ''): WarrantFilingType | null {
  const t = `${subject}\n${body}`;
  for (const { type, re } of WARRANT_PATTERNS) {
    if (re.test(t)) return type;
  }
  return null;
}

// ─── Extraction helpers ────────────────────────────────────────────────────

export interface WarrantDetails {
  issue_price: number | null;          // ₹ per warrant
  warrant_count: number | null;        // total warrants issued
  conversion_period_months: number | null;
  promoter_participation_pct: number | null;  // % of issue going to promoters
  total_size_cr: number | null;        // ₹ Cr total fund-raise
  is_promoter_subscribed: boolean;     // does subject/body mention promoter participation?
}

export function extractWarrantDetails(text: string): WarrantDetails {
  const t = text || '';
  const out: WarrantDetails = {
    issue_price: null,
    warrant_count: null,
    conversion_period_months: null,
    promoter_participation_pct: null,
    total_size_cr: null,
    is_promoter_subscribed: false,
  };

  // Issue price: "₹ 150 per warrant", "Rs. 200/-", "issue price of Rs. 75"
  const priceMatch = t.match(/(?:issue\s+price|warrant\s+price|exercise\s+price|conversion\s+price)\s+(?:of\s+)?(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)/i) ||
                     t.match(/(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:per\s+warrant|each)/i);
  if (priceMatch) out.issue_price = parseFloat(priceMatch[1].replace(/,/g, ''));

  // Warrant count: "1,00,000 warrants", "50 lakh warrants"
  const countMatch = t.match(/([\d,]+(?:\.\d+)?)\s*(?:lakh|crore|cr)?\s*warrants?\b/i);
  if (countMatch) {
    let cnt = parseFloat(countMatch[1].replace(/,/g, ''));
    if (/lakh/i.test(countMatch[0])) cnt *= 1e5;
    if (/crore|cr\b/i.test(countMatch[0])) cnt *= 1e7;
    out.warrant_count = cnt;
  }

  // Conversion period: "within 18 months", "convertible within 18 months"
  const convMatch = t.match(/(?:within|over|in)\s+(\d+)\s+months/i);
  if (convMatch) out.conversion_period_months = parseInt(convMatch[1]);

  // Total size: "₹ 250 Cr", "aggregating Rs. 100 crore"
  const sizeMatch = t.match(/(?:aggregating|total|raising)\s+(?:up\s+to\s+)?(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:cr|crore)/i);
  if (sizeMatch) out.total_size_cr = parseFloat(sizeMatch[1].replace(/,/g, ''));

  // Promoter participation
  out.is_promoter_subscribed = /\b(?:promoter|promoter\s+group)\s+(?:to\s+)?subscrib|allotment\s+to.*promoter|promoter.*subscrib|warrants?\s+(?:issued|allotted)\s+to\s+(?:promoter|promoter\s+group)/i.test(t);

  // Promoter participation pct: "100% to promoter", "promoter participation of 70%"
  const promPctMatch = t.match(/promoter[\s\w]{0,30}(\d{1,3}(?:\.\d+)?)\s*%/i) ||
                       t.match(/(\d{1,3}(?:\.\d+)?)\s*%[\s\w]{0,20}promoter/i);
  if (promPctMatch) {
    const pct = parseFloat(promPctMatch[1]);
    if (pct >= 0 && pct <= 100) out.promoter_participation_pct = pct;
  }

  return out;
}

// ─── Business momentum signals (reuse Concall lib at scoring time) ──────
// Caller passes BullishScore from concall-bullish.ts. Warrant engine treats
// strong concall narrative as a momentum confirmation factor.

// ─── Scoring engine ────────────────────────────────────────────────────────

export interface WarrantConvictionScore {
  conviction: number;                // 0-10 final score
  raw_score: number;                 // pre-cap
  passes_gate: boolean;              // gate per user spec
  signals: string[];                 // POSITIVE drivers
  red_flags: string[];               // NEGATIVE auto-reject reasons
  components: {
    promoter_participation: number;  // 0-3
    pricing_premium: number;         // -3 to +3 (premium good, discount bad)
    business_momentum: number;       // 0-2 (from concall narrative score)
    breakout_relative_strength: number;  // 0-2 (price perf last 90d)
    history_boost: number;           // 0-3 (prior warrants rallied)
    governance_penalty: number;      // -3 to 0
  };
  premium_pct: number | null;        // issue_price / cmp - 1, %
  history_summary?: string;
}

export interface ScoreWarrantInputs {
  details: WarrantDetails;
  cmp: number | null;                // current market price
  perf_90d_pct: number | null;       // %
  perf_52w_high_pct: number | null;  // % below 52w high (negative = near high = breakout)
  market_cap_cr: number | null;
  promoter_holding_pct: number | null;
  pledge_pct: number | null;
  business_momentum_score: number | null;  // 0-10 from concall scoring of same filing's body
  prior_warrant_perf: Array<{ date: string; perf_pct: number }>;  // historical KV memory
}

export function scoreWarrantConviction(inputs: ScoreWarrantInputs): WarrantConvictionScore {
  const { details, cmp, perf_90d_pct, perf_52w_high_pct, market_cap_cr,
          promoter_holding_pct, pledge_pct, business_momentum_score, prior_warrant_perf } = inputs;

  const signals: string[] = [];
  const redFlags: string[] = [];
  let raw = 0;
  const c = {
    promoter_participation: 0,
    pricing_premium: 0,
    business_momentum: 0,
    breakout_relative_strength: 0,
    history_boost: 0,
    governance_penalty: 0,
  };

  // ── Gate 1: Promoter participation (MANDATORY per spec) ────────────────
  if (details.is_promoter_subscribed) {
    c.promoter_participation += 2;
    signals.push('Promoter / promoter group subscribed');
    if (details.promoter_participation_pct != null && details.promoter_participation_pct >= 50) {
      c.promoter_participation += 1;
      signals.push(`${details.promoter_participation_pct.toFixed(0)}% to promoter`);
    }
  } else {
    redFlags.push('No promoter participation — third-party warrant');
  }
  raw += c.promoter_participation;

  // ── Gate 2: Pricing vs CMP — premium or ≤ 10% discount required ───────
  let premium_pct: number | null = null;
  if (details.issue_price != null && cmp != null && cmp > 0) {
    premium_pct = (details.issue_price / cmp - 1) * 100;
    if (premium_pct >= 0) {
      c.pricing_premium += 3;
      signals.push(`Issue price +${premium_pct.toFixed(1)}% premium to CMP`);
    } else if (premium_pct >= -10) {
      c.pricing_premium += 1;
      signals.push(`Issue price ${premium_pct.toFixed(1)}% to CMP (small discount)`);
    } else if (premium_pct >= -25) {
      c.pricing_premium -= 1;
      redFlags.push(`Issue price ${premium_pct.toFixed(1)}% deep discount`);
    } else {
      c.pricing_premium -= 3;
      redFlags.push(`Issue price ${premium_pct.toFixed(1)}% — operator-trap deep discount`);
    }
  } else {
    // Price unknown — neutral but limits confidence
    c.pricing_premium += 0.5;  // small benefit of doubt
  }
  raw += c.pricing_premium;

  // ── Gate 3: Breakout / relative strength ──────────────────────────────
  if (perf_52w_high_pct != null && perf_52w_high_pct >= -5) {
    c.breakout_relative_strength += 2;
    signals.push(`Near 52w high (${perf_52w_high_pct.toFixed(1)}% from peak)`);
  } else if (perf_52w_high_pct != null && perf_52w_high_pct >= -15) {
    c.breakout_relative_strength += 1;
    signals.push(`${perf_52w_high_pct.toFixed(1)}% from 52w high — consolidating`);
  } else if (perf_90d_pct != null && perf_90d_pct >= 20) {
    c.breakout_relative_strength += 1.5;
    signals.push(`+${perf_90d_pct.toFixed(0)}% 90d (strong RS)`);
  } else if (perf_90d_pct != null && perf_90d_pct < -10) {
    redFlags.push(`Weak structure (${perf_90d_pct.toFixed(0)}% 90d)`);
    c.breakout_relative_strength -= 0.5;
  }
  raw += c.breakout_relative_strength;

  // ── Gate 4: Business momentum (concall narrative score) ──────────────
  if (business_momentum_score != null) {
    if (business_momentum_score >= 6) {
      c.business_momentum = 2;
      signals.push(`Strong concall momentum (${business_momentum_score.toFixed(1)}/10)`);
    } else if (business_momentum_score >= 4) {
      c.business_momentum = 1;
      signals.push(`Moderate momentum (${business_momentum_score.toFixed(1)}/10)`);
    } else if (business_momentum_score < 2) {
      redFlags.push(`Weak narrative (${business_momentum_score.toFixed(1)}/10)`);
    }
  }
  raw += c.business_momentum;

  // ── History boost: prior warrants rallied? ───────────────────────────
  let history_summary: string | undefined;
  if (prior_warrant_perf.length > 0) {
    const wins = prior_warrant_perf.filter(p => p.perf_pct >= 25);
    if (wins.length >= 1) {
      c.history_boost = Math.min(3, wins.length * 1.5);
      signals.push(`${wins.length}/${prior_warrant_perf.length} prior warrants rallied ≥25%`);
      const avgPerf = prior_warrant_perf.reduce((s, p) => s + p.perf_pct, 0) / prior_warrant_perf.length;
      history_summary = `Avg post-warrant perf: ${avgPerf >= 0 ? '+' : ''}${avgPerf.toFixed(0)}% (${prior_warrant_perf.length} prior)`;
    } else if (prior_warrant_perf.length >= 3) {
      // 3+ prior warrants that didn't rally = chronic dilution pattern
      c.governance_penalty -= 2;
      redFlags.push(`${prior_warrant_perf.length} prior warrants, none rallied — dilution pattern`);
    }
  }
  raw += c.history_boost;

  // ── Auto-reject conditions per spec ──────────────────────────────────
  if (market_cap_cr != null && market_cap_cr < 100) {
    c.governance_penalty -= 2;
    redFlags.push(`Microcap ${market_cap_cr.toFixed(0)}Cr — operator risk`);
  }
  if (pledge_pct != null && pledge_pct >= 25) {
    c.governance_penalty -= 2;
    redFlags.push(`Heavy pledge ${pledge_pct.toFixed(0)}%`);
  }
  if (promoter_holding_pct != null && promoter_holding_pct < 30) {
    c.governance_penalty -= 1;
    redFlags.push(`Low promoter holding ${promoter_holding_pct.toFixed(0)}%`);
  }
  raw += c.governance_penalty;

  // ── Hard gate per user spec: only score ≥ 8 passes ────────────────────
  // Gates A, B, C, D must all be cleared:
  //   A. Promoter participation = present
  //   B. Pricing not deep-discount (premium_pct >= -10 OR unknown)
  //   C. No critical red flags (operator pump, heavy pledge, dilution pattern)
  //   D. Either breakout/RS OR business momentum present
  const gateA = details.is_promoter_subscribed;
  const gateB = premium_pct == null || premium_pct >= -10;
  const gateC = c.governance_penalty >= -1;
  const gateD = c.breakout_relative_strength > 0 || c.business_momentum > 0;

  const conviction = Math.max(0, Math.min(10, raw));
  const passes_gate = gateA && gateB && gateC && gateD && conviction >= 8;

  return {
    conviction: Math.round(conviction * 10) / 10,
    raw_score: Math.round(raw * 10) / 10,
    passes_gate,
    signals,
    red_flags: redFlags,
    components: {
      promoter_participation: Math.round(c.promoter_participation * 10) / 10,
      pricing_premium: Math.round(c.pricing_premium * 10) / 10,
      business_momentum: Math.round(c.business_momentum * 10) / 10,
      breakout_relative_strength: Math.round(c.breakout_relative_strength * 10) / 10,
      history_boost: Math.round(c.history_boost * 10) / 10,
      governance_penalty: Math.round(c.governance_penalty * 10) / 10,
    },
    premium_pct: premium_pct != null ? Math.round(premium_pct * 10) / 10 : null,
    history_summary,
  };
}
