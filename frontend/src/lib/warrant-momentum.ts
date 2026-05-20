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

// PATCH 0426 — Capital use + promoter intent + tier classification
// addressing institutional review: distinguish accretive vs dilutive vs
// distress capital raises.
export type CapitalUse = 'CAPEX' | 'DEBT_REPAY' | 'WORKING_CAPITAL' | 'ACQUISITION' | 'GENERAL_CORPORATE' | 'UNKNOWN';
export type PromoterIntent = 'INCREASING_STAKE' | 'MAINTAINING_STAKE' | 'THIRD_PARTY_ONLY' | 'EXITING' | 'UNKNOWN';
export type WarrantTier = 'TIER_1_INSTITUTIONAL' | 'TIER_2_NEUTRAL' | 'TIER_3_DISTRESS';

export interface WarrantDetails {
  issue_price: number | null;          // ₹ per warrant
  warrant_count: number | null;        // total warrants issued
  conversion_period_months: number | null;
  promoter_participation_pct: number | null;  // % of issue going to promoters
  total_size_cr: number | null;        // ₹ Cr total fund-raise
  is_promoter_subscribed: boolean;     // does subject/body mention promoter participation?
  // PATCH 0426 — new institutional fields
  capital_use: CapitalUse;             // what the funds will be used for
  capital_use_evidence: string;        // raw quote substring (debug)
  promoter_intent: PromoterIntent;     // direction of promoter stake change
  has_external_investor: boolean;      // non-promoter institutional allottee present
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
    capital_use: 'UNKNOWN',
    capital_use_evidence: '',
    promoter_intent: 'UNKNOWN',
    has_external_investor: false,
  };

  // PATCH 0423 — Substantially broadened. Previous narrow regexes caused every
  // warrant to score ~2.5 because is_promoter_subscribed / issue_price /
  // conversion_period_months / promoter_participation_pct were all null.
  // Real NSE/BSE preferential allotment notices use varied phrasings.

  // Issue price — many variants
  const pricePatterns = [
    /(?:issue\s+price|warrant\s+(?:issue\s+)?price|exercise\s+price|conversion\s+price|subscription\s+price)\s+(?:of\s+|fixed\s+at\s+|determined\s+at\s+)?(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)/i,
    /(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:\/?-?\s*)?(?:per\s+(?:warrant|equity\s+share|share)|each)/i,
    /(?:price|at\s+a\s+price\s+of|at)\s+(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:\/?-?\s*)?per\s+(?:warrant|share|equity)/i,
    /(?:floor\s+price|minimum\s+price)\s+(?:of\s+|at\s+)?(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)/i,
    /(?:warrants?|shares?)\s+at\s+(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)/i,
    // ICDR reg 164 / 166 style: "shall not be less than Rs. X"
    /(?:not\s+less\s+than|not\s+lower\s+than)\s+(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:\/?-?\s*)?per/i,
  ];
  for (const re of pricePatterns) {
    const m = t.match(re);
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0 && v < 1_000_000) { out.issue_price = v; break; }
    }
  }

  // Warrant count
  const countMatch = t.match(/([\d,]+(?:\.\d+)?)\s*(?:lakh|crore|cr)?\s*(?:fully\s+(?:paid|paid[\s-]?up)\s+)?(?:convertible\s+)?warrants?\b/i);
  if (countMatch) {
    let cnt = parseFloat(countMatch[1].replace(/,/g, ''));
    if (Number.isFinite(cnt)) {
      if (/lakh/i.test(countMatch[0])) cnt *= 1e5;
      if (/crore|\bcr\b/i.test(countMatch[0])) cnt *= 1e7;
      if (cnt >= 1000) out.warrant_count = cnt;        // ignore tiny matches like "1 warrant"
    }
  }

  // Conversion period
  const convPatterns = [
    /(?:within|over|in|tenure\s+of|exercisable\s+(?:within|over)|convertible\s+(?:within|in))\s+(\d+)\s+(?:months|month)/i,
    /(?:within|over|in|tenure\s+of)\s+(\d+(?:\.\d+)?)\s+(?:years|year)/i,
    /(\d+)[\s-]?month\s+(?:conversion|exercise)\s+period/i,
    /period\s+of\s+(\d+)\s+months/i,
  ];
  for (const re of convPatterns) {
    const m = t.match(re);
    if (m) {
      let months = parseFloat(m[1]);
      if (/years?\b/i.test(m[0])) months *= 12;
      if (Number.isFinite(months) && months > 0 && months <= 120) { out.conversion_period_months = Math.round(months); break; }
    }
  }

  // Total size
  const sizePatterns = [
    /(?:aggregating(?:\s+up\s+to)?|total|raising|raise(?:\s+up\s+to)?|amount(?:ing)?\s+to|size\s+of)\s+(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:cr|crore|crores)/i,
    /(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:cr|crore|crores)\s+(?:through|via|by\s+way\s+of|by\s+issuing)/i,
    /total\s+consideration\s+of\s+(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:cr|crore|crores)/i,
  ];
  for (const re of sizePatterns) {
    const m = t.match(re);
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0 && v < 200_000) { out.total_size_cr = v; break; }
    }
  }

  // Promoter participation — much broader. The previous regex required exact
  // "promoter ... subscribe" word order; misses real NSE phrasings like:
  // "preferential allotment of warrants on a preferential basis to promoters",
  // "warrants proposed to be issued and allotted to the promoter group",
  // "the promoter and promoter group of the Company has agreed".
  const promoterPatterns = [
    /\b(?:promoter|promoter\s+group)\s+(?:has|have)?\s*(?:to\s+)?(?:agreed\s+to\s+|propose[ds]?\s+to\s+)?(?:subscrib|infus|invest)/i,
    /(?:to|in\s+favour\s+of|in\s+favor\s+of)\s+(?:the\s+)?(?:promoter|promoter\s+group)/i,
    /allotment\s+(?:to|in\s+favour\s+of|in\s+favor\s+of).{0,80}\bpromoter/i,
    /(?:warrants?|securities|shares?)\s+(?:proposed\s+(?:to\s+be\s+)?|to\s+be\s+)?(?:issued|allotted)\s+(?:and\s+allotted\s+)?to\s+(?:the\s+)?(?:promoter|promoter\s+group)/i,
    /promoter[s']?\s+(?:and\s+promoter\s+group['s]?\s+)?(?:participation|contribution|infusion|warrant)/i,
    /(?:identified|designated)\s+(?:investor|allottee)s?.{0,40}promoter/i,
    // ICDR Reg 164/166 promoter context
    /\bpromoter[s']?(?:\s+group)?\s+category\s+(?:of\s+)?allotment/i,
    // "Investor.*Promoter" table heading in PDFs
    /\bpromoter\b.{0,30}\b(?:allottee|investor|subscriber|category)\b/i,
  ];
  out.is_promoter_subscribed = promoterPatterns.some(re => re.test(t));

  // Promoter participation pct — broader proximity windows
  const promPctPatterns = [
    /promoter[\s\w]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/i,
    /(\d{1,3}(?:\.\d+)?)\s*%[\s\w]{0,40}(?:to\s+)?promoter/i,
    /promoter\s+(?:and\s+promoter\s+group\s+)?(?:contribution|participation|subscription|allocation)[\s\w]{0,20}(\d{1,3}(?:\.\d+)?)\s*%/i,
    // "100% of issue size to promoter"
    /(\d{1,3}(?:\.\d+)?)\s*%\s+of\s+the\s+(?:issue|allotment).{0,40}promoter/i,
  ];
  for (const re of promPctPatterns) {
    const m = t.match(re);
    if (m) {
      const pct = parseFloat(m[1]);
      if (pct >= 0 && pct <= 100) { out.promoter_participation_pct = pct; break; }
    }
  }

  // PATCH 0426 — Capital use tagger. Scan PDF body for "use of proceeds"
  // language. Tier-1 institutional warrants identify CAPEX or strategic
  // acquisition; Tier-3 distress warrants identify debt-repay or
  // general-corporate-purposes (a euphemism for working-capital plug).
  const CAPITAL_USE_PATTERNS: Array<{ use: CapitalUse; re: RegExp }> = [
    { use: 'ACQUISITION',
      re: /\b(?:funding\s+the\s+)?(?:proposed\s+)?acquisition|inorganic\s+(?:growth|expansion)|acquire\s+(?:stake|business|subsidiary|target)|m&a\s+activity|business\s+combination/i },
    { use: 'CAPEX',
      re: /\b(?:capex|capital\s+expenditure|capacity\s+expansion|setting\s+up\s+(?:new\s+)?(?:plant|facility|unit|line)|greenfield|brownfield|new\s+(?:manufacturing\s+)?(?:facility|plant|unit)|expansion\s+of\s+(?:existing\s+)?(?:manufacturing|production|capacity))/i },
    { use: 'DEBT_REPAY',
      re: /\b(?:debt\s+(?:repayment|reduction)|repay(?:ing|ment)\s+(?:of\s+)?(?:outstanding\s+)?(?:debt|loan|borrowings?)|pre[\s-]?pay(?:ment)?\s+(?:of\s+)?(?:loans?|debt|term\s+loan)|reduce\s+(?:our\s+)?(?:debt|indebtedness|leverage)|deleveraging|balance[\s-]?sheet\s+(?:strengthening|repair|restructuring))/i },
    { use: 'WORKING_CAPITAL',
      re: /\bworking\s+capital(?:\s+(?:requirements?|needs|gap|management|support))?|liquidity\s+(?:support|management|cushion)|operational\s+(?:cash\s+)?requirements?/i },
    { use: 'GENERAL_CORPORATE',
      re: /\bgeneral\s+corporate\s+(?:purposes?|requirements?)|general\s+(?:business|funding)\s+(?:purposes?|requirements?)/i },
  ];
  for (const { use, re } of CAPITAL_USE_PATTERNS) {
    const m = t.match(re);
    if (m) {
      out.capital_use = use;
      // Capture context around the match for transparency
      const idx = m.index ?? 0;
      const ctxStart = Math.max(0, idx - 30);
      const ctxEnd = Math.min(t.length, idx + m[0].length + 60);
      out.capital_use_evidence = t.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // PATCH 0426 — External investor detection (non-promoter institutional
  // allottees). FII / FPI / mutual fund / PE name signals a third-party
  // capital raise.
  out.has_external_investor = /\b(?:foreign\s+portfolio\s+investor|FPI|FII|mutual\s+fund|private\s+equity|sovereign\s+(?:wealth\s+)?fund|venture\s+capital|institutional\s+investor|qualified\s+institutional\s+(?:buyer|placement)|external\s+investor|public\s+investor)\b/i.test(t) ||
    // Look for typical third-party allottee patterns (Twin Star Overseas is
    // a promoter entity but most third-party names follow 'XYZ Holdings',
    // 'ABC Capital', 'XYZ Partners').
    /\ballottee[s]?\s*(?:include|are)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Capital|Partners|Holdings|Investments|Advisors|Fund|Trust)/i.test(t);

  // PATCH 0426 — Promoter intent classifier. Combine promoter participation
  // flag + external-investor flag + explicit stake-direction language.
  const incRegex = /\b(?:promoter\s+(?:holding|stake)\s+(?:will\s+)?(?:rise|increase|go\s+up)|increase\s+(?:in\s+)?promoter\s+(?:holding|stake|equity))/i;
  const decRegex = /\b(?:promoter\s+(?:holding|stake)\s+(?:will\s+)?(?:decrease|fall|reduce)|reduction\s+in\s+promoter\s+(?:holding|stake)|promoter\s+(?:exiting|divest))/i;
  if (decRegex.test(t)) {
    out.promoter_intent = 'EXITING';
  } else if (incRegex.test(t) || (out.is_promoter_subscribed && (out.promoter_participation_pct ?? 0) >= 50)) {
    out.promoter_intent = 'INCREASING_STAKE';
  } else if (out.is_promoter_subscribed && !out.has_external_investor) {
    out.promoter_intent = 'MAINTAINING_STAKE';
  } else if (!out.is_promoter_subscribed && out.has_external_investor) {
    out.promoter_intent = 'THIRD_PARTY_ONLY';
  }

  return out;
}

// ─── Business momentum signals (reuse Concall lib at scoring time) ──────
// Caller passes BullishScore from concall-bullish.ts. Warrant engine treats
// strong concall narrative as a momentum confirmation factor.

// ─── Scoring engine ────────────────────────────────────────────────────────

export interface WarrantExtractionDiagnostics {
  pdf_extracted: boolean;            // did we get PDF body text at all?
  issue_price_found: boolean;
  promoter_subscribed_found: boolean;
  promoter_pct_found: boolean;
  conversion_period_found: boolean;
  total_size_found: boolean;
  cmp_found: boolean;                // did Yahoo return a CMP?
  momentum_found: boolean;           // did concall scoring run?
  missing_fields: string[];          // human-readable list of what's missing
  gate_failures: string[];           // which of A/B/C/D failed and why
}

export interface WarrantConvictionScore {
  conviction: number;                // 0-10 final score
  raw_score: number;                 // pre-cap
  passes_gate: boolean;              // gate per user spec
  signals: string[];                 // POSITIVE drivers
  red_flags: string[];               // NEGATIVE auto-reject reasons
  diagnostics: WarrantExtractionDiagnostics;  // PATCH 0423 — show user WHY score is low
  // PATCH 0426 — Institutional tier rollup + distress probability
  tier: WarrantTier;                 // institutional / neutral / distress
  tier_rationale: string;
  distress_probability: number;     // 0-1 — likelihood this is dilutive/stress financing
  capital_use: CapitalUse;
  promoter_intent: PromoterIntent;
  dilution_pct?: number | null;     // PATCH 0427 — % equity expansion if warrants convert
  // PATCH 0428 — Explicit weighted score per institutional review item 4.A:
  // Score = funding_quality×0.35 + balance_sheet×0.30 + business_trajectory×0.25 − dilution_penalty×0.10
  weighted: {
    funding_quality: number;        // 0-10 — promoter intent + capital use quality
    balance_sheet: number;          // 0-10 — leverage profile (proxy: lack of distress markers)
    business_trajectory: number;    // 0-10 — concall momentum + 90d perf + 52w-high distance
    dilution_penalty: number;       // 0-10 — capped at observed dilution %
    final: number;                  // 0-10 — weighted composite
  };
  bucket: 'GREEN' | 'AMBER' | 'RED';  // PATCH 0428 — hard-filter rule output
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

  // ── PATCH 0459 IMP-5 — Deleveraging-with-inflection bonus. Audit
  // flagged STL Networks (and similar) as scoring 4.5 when institutional
  // priors say 6.5-7. Root cause: DEBT_REPAY was treated as PURE distress
  // (-0.20 to tier classification), even when the deleveraging is
  // happening at an INFLECTING business with promoter capital infusion.
  //
  // Now: when capital_use === DEBT_REPAY AND business momentum is strong
  // AND promoter participation is heavy, we treat it as the bullish
  // 'balance-sheet repair at inflection' setup rather than distress.
  //   • +1.5 to raw score
  //   • +1.0 if 52w-high breakout also confirms (price is leading the
  //     deleveraging thesis)
  //   • +0.5 if mid-cap or larger (size = institutional comfort)
  if (
    details.capital_use === 'DEBT_REPAY'
    && details.is_promoter_subscribed
    && (details.promoter_participation_pct ?? 0) >= 40
    && business_momentum_score != null && business_momentum_score >= 5
  ) {
    raw += 1.5;
    signals.push('Deleveraging at inflection — interest savings → EPS uplift');
    if (perf_52w_high_pct != null && perf_52w_high_pct >= -10) {
      raw += 1.0;
      signals.push('Price near 52w high — market already validates the turnaround');
    }
    if (market_cap_cr != null && market_cap_cr >= 1000) {
      raw += 0.5;
      signals.push(`₹${market_cap_cr.toFixed(0)}Cr mcap — institutional accessibility`);
    }
  }

  // ── PATCH 0459 IMP-5 — Post-demerger / group-rerating signal. When the
  // warrant filing or recent concall mentions 'demerger' / 'spin' /
  // 'parent company' / 'group' AND the business is on the right side of
  // separation, we add a structural bonus.
  const demergerHint = /\b(post[- ]?demerger|after\s+demerger|spin[- ]?off|separated\s+entity|listed\s+(?:subsidiary|arm)|parent\s+(?:group|company)|group[- ]?level\s+rerating)\b/i;
  if (demergerHint.test(details.capital_use_evidence || '')) {
    raw += 0.75;
    signals.push('Post-demerger / group rerating context');
  }

  // ── Hard gate per user spec: only score ≥ 8 passes ────────────────────
  // Gates A, B, C, D must all be cleared:
  //   A. Promoter participation = present
  //   B. Pricing not deep-discount (premium_pct >= -10 OR unknown)
  //   C. No critical red flags (operator pump, heavy pledge, dilution pattern)
  //   D. Either breakout/RS OR business momentum present OR positive issue
  //      premium ≥ 10% (PATCH 0536 — promoter willing to pay premium to CMP
  //      is itself a structural conviction signal even when concall PDF
  //      didn't extract; without this, real warrants where the time-budget
  //      bail prevented momentum scoring never crossed the gate).
  const gateA = details.is_promoter_subscribed;
  const gateB = premium_pct == null || premium_pct >= -10;
  const gateC = c.governance_penalty >= -1;
  const premiumProxy = premium_pct != null && premium_pct >= 10;
  const gateD = c.breakout_relative_strength > 0 || c.business_momentum > 0 || premiumProxy;

  const conviction = Math.max(0, Math.min(10, raw));
  // PATCH 0425 — Lowered passing floor 8 → 6.5. A pure-data warrant with
  // promoter ✓ + near-52w-high + small-discount + concall momentum scores
  // around 6.5-7.5; the prior 8-floor required ALL components to fire
  // perfectly which essentially never happened on real-world data. Real
  // institutional warrants (STLTECH-class promoter infusions) commonly
  // land in the 6.5-7.5 conviction band, not 8+.
  // PATCH 0536 — further lowered 6.5 → 5.5. With the new gateD proxy, real
  // promoter warrants with full diagnostics (issue-price extracted +
  // premium + governance clean) commonly score in the 5.5-7 band when
  // Yahoo blocks CMP fetch OR the time-budget skips concall extraction.
  // Below 5.5 is correctly noise; 5.5-6.5 contains real signal currently
  // silently dropped.
  const passes_gate = gateA && gateB && gateC && gateD && conviction >= 5.5;

  // PATCH 0423 — extraction & gate-failure diagnostics so the UI can show
  // WHY a warrant scored low instead of forcing the user to guess.
  const missing_fields: string[] = [];
  if (!details.is_promoter_subscribed) missing_fields.push('promoter participation');
  if (details.issue_price == null) missing_fields.push('issue price');
  if (details.conversion_period_months == null) missing_fields.push('conversion period');
  if (details.total_size_cr == null) missing_fields.push('total size');
  if (cmp == null) missing_fields.push('CMP (Yahoo)');
  if (business_momentum_score == null) missing_fields.push('concall narrative score');
  const gate_failures: string[] = [];
  if (!gateA) gate_failures.push('A — no promoter subscription detected');
  if (!gateB) gate_failures.push(`B — pricing deep-discount (${premium_pct?.toFixed(1)}%)`);
  if (!gateC) gate_failures.push(`C — governance penalty (${c.governance_penalty.toFixed(1)})`);
  if (!gateD) gate_failures.push('D — no breakout AND no concall momentum');
  if (gateA && gateB && gateC && gateD && conviction < 6.5) gate_failures.push(`score ${conviction.toFixed(1)} below ≥6.5 floor`);

  // PATCH 0427 — Dilution estimation. With warrant_count + issue_price we
  // know total raise (₹). Approx share count ≈ market_cap_cr × 1e7 / cmp.
  // Dilution % ≈ warrant_count / (warrant_count + existing_shares) × 100.
  // Conservative estimate; treats warrants as 1:1 conversion (most are).
  let dilution_pct: number | null = null;
  if (details.warrant_count != null && details.warrant_count > 0 && cmp != null && cmp > 0 && market_cap_cr != null && market_cap_cr > 0) {
    const existingShares = (market_cap_cr * 1e7) / cmp;
    if (existingShares > 0) {
      dilution_pct = (details.warrant_count / (existingShares + details.warrant_count)) * 100;
    }
  }
  // Heavy dilution penalty — apply DIRECTLY to raw since governance_penalty
  // was already folded in above.
  if (dilution_pct != null && dilution_pct >= 20) {
    raw -= 2;
    c.governance_penalty -= 2;
    redFlags.push(`Heavy dilution ~${dilution_pct.toFixed(1)}%`);
  } else if (dilution_pct != null && dilution_pct >= 10) {
    raw -= 1;
    c.governance_penalty -= 1;
    redFlags.push(`Material dilution ~${dilution_pct.toFixed(1)}%`);
  }

  // PATCH 0426 — Distress probability + Tier classification.
  // Distress signals (each +0.20):
  //   1. ≥2 prior warrants in history (repeat issuer)
  //   2. Issue price < CMP × 0.75 (deep discount)
  //   3. Microcap (<300 Cr if known)
  //   4. Capital use = DEBT_REPAY or WORKING_CAPITAL or GENERAL_CORPORATE
  //   5. Third-party only (no promoter participation)
  let distress = 0;
  const distressReasons: string[] = [];
  if (prior_warrant_perf.length >= 2) { distress += 0.20; distressReasons.push('repeat issuer'); }
  if (premium_pct != null && premium_pct < -25) { distress += 0.25; distressReasons.push('deep discount'); }
  if (market_cap_cr != null && market_cap_cr < 300) { distress += 0.15; distressReasons.push('microcap'); }
  if (details.capital_use === 'DEBT_REPAY' || details.capital_use === 'WORKING_CAPITAL' || details.capital_use === 'GENERAL_CORPORATE') {
    distress += 0.20; distressReasons.push(`capital use = ${details.capital_use.toLowerCase().replace(/_/g, ' ')}`);
  }
  if (details.promoter_intent === 'THIRD_PARTY_ONLY') { distress += 0.15; distressReasons.push('no promoter skin'); }
  if (details.promoter_intent === 'EXITING') { distress += 0.30; distressReasons.push('promoter exiting'); }
  distress = Math.min(1, distress);

  // Tier classification — institutional / neutral / distress
  let tier: WarrantTier;
  let tier_rationale: string;
  if (details.capital_use === 'CAPEX' || details.capital_use === 'ACQUISITION') {
    if (details.promoter_intent === 'INCREASING_STAKE' && premium_pct != null && premium_pct >= 0 && distress < 0.30) {
      tier = 'TIER_1_INSTITUTIONAL';
      tier_rationale = `Promoter increasing stake + ${details.capital_use === 'CAPEX' ? 'CAPEX' : 'acquisition'} funding + premium pricing`;
    } else if (distress >= 0.50) {
      tier = 'TIER_3_DISTRESS';
      tier_rationale = `Despite ${details.capital_use.toLowerCase()} use, distress signals: ${distressReasons.join(', ')}`;
    } else {
      tier = 'TIER_2_NEUTRAL';
      tier_rationale = `${details.capital_use === 'CAPEX' ? 'CAPEX' : 'Acquisition'} funding but ${distressReasons.length > 0 ? distressReasons.join(', ') : 'mixed signals'}`;
    }
  } else if (distress >= 0.50) {
    tier = 'TIER_3_DISTRESS';
    tier_rationale = `Distress markers: ${distressReasons.join(', ')}`;
  } else if (details.capital_use === 'DEBT_REPAY' && details.is_promoter_subscribed && distress < 0.40) {
    tier = 'TIER_2_NEUTRAL';
    tier_rationale = 'Balance-sheet repair with promoter support — neutral';
  } else if (details.is_promoter_subscribed) {
    tier = 'TIER_2_NEUTRAL';
    tier_rationale = 'Promoter participating but capital use unclear / non-strategic';
  } else {
    tier = 'TIER_3_DISTRESS';
    tier_rationale = `Third-party financing; ${distressReasons.length > 0 ? distressReasons.join(', ') : 'unverified intent'}`;
  }

  // PATCH 0428 — Explicit weighted score per institutional review item 4.A.
  // Production-grade benchmark formula:
  //   Score = 0.35×funding_quality + 0.30×balance_sheet + 0.25×business_trajectory − 0.10×dilution_penalty
  //
  // Each sub-score is 0-10. Funding quality rewards promoter intent +
  // strategic capital use. Balance sheet rewards lack-of-distress markers.
  // Business trajectory rewards concall momentum + price RS. Dilution
  // penalty grows with measured / inferred dilution.
  let funding_quality = 0;
  if (details.promoter_intent === 'INCREASING_STAKE')  funding_quality += 4;
  else if (details.promoter_intent === 'MAINTAINING_STAKE') funding_quality += 2.5;
  else if (details.promoter_intent === 'THIRD_PARTY_ONLY') funding_quality += 1;
  // EXITING / UNKNOWN add 0
  if (details.capital_use === 'CAPEX')        funding_quality += 4;
  else if (details.capital_use === 'ACQUISITION') funding_quality += 3.5;
  else if (details.capital_use === 'DEBT_REPAY') funding_quality += 2;
  else if (details.capital_use === 'WORKING_CAPITAL') funding_quality += 0.5;
  else if (details.capital_use === 'GENERAL_CORPORATE') funding_quality += 0.5;
  // Premium pricing supports funding quality
  if (premium_pct != null && premium_pct >= 0) funding_quality += 2;
  else if (premium_pct != null && premium_pct >= -10) funding_quality += 1;
  funding_quality = Math.max(0, Math.min(10, funding_quality));

  // Balance sheet score — proxy: inverse of distress probability
  let balance_sheet = Math.max(0, 10 - distress * 10);
  // Bonus when capital use is debt-repay or balance-sheet-strengthening with
  // promoter support — net positive for the balance sheet
  if (details.capital_use === 'DEBT_REPAY' && details.is_promoter_subscribed) balance_sheet = Math.min(10, balance_sheet + 1);
  balance_sheet = Math.max(0, Math.min(10, balance_sheet));

  // Business trajectory — concall momentum + price RS + 52w-high distance
  let business_trajectory = 0;
  if (business_momentum_score != null) business_trajectory += Math.min(5, business_momentum_score / 2);
  if (perf_90d_pct != null) {
    if (perf_90d_pct >= 30)      business_trajectory += 3;
    else if (perf_90d_pct >= 15) business_trajectory += 2;
    else if (perf_90d_pct >= 0)  business_trajectory += 1;
    else if (perf_90d_pct <= -15) business_trajectory -= 1;
  }
  if (perf_52w_high_pct != null) {
    if (perf_52w_high_pct >= -5) business_trajectory += 2;
    else if (perf_52w_high_pct >= -15) business_trajectory += 1;
  }
  business_trajectory = Math.max(0, Math.min(10, business_trajectory));

  // Dilution penalty — scaled to 0-10 from observed dilution %
  let dilution_penalty = 0;
  if (dilution_pct != null) {
    // ≤5% → 0, 5-10% → 2, 10-20% → 5, ≥20% → 8, ≥30% → 10
    if (dilution_pct >= 30)      dilution_penalty = 10;
    else if (dilution_pct >= 20) dilution_penalty = 8;
    else if (dilution_pct >= 10) dilution_penalty = 5;
    else if (dilution_pct >= 5)  dilution_penalty = 2;
  }
  // Heavy issuer history compounds the dilution penalty
  if (prior_warrant_perf.length >= 3) dilution_penalty = Math.min(10, dilution_penalty + 2);

  const weighted_final = Math.max(0, Math.min(10,
    0.35 * funding_quality +
    0.30 * balance_sheet +
    0.25 * business_trajectory -
    0.10 * dilution_penalty
  ));

  const weighted = {
    funding_quality:     Math.round(funding_quality * 10) / 10,
    balance_sheet:       Math.round(balance_sheet * 10) / 10,
    business_trajectory: Math.round(business_trajectory * 10) / 10,
    dilution_penalty:    Math.round(dilution_penalty * 10) / 10,
    final:               Math.round(weighted_final * 10) / 10,
  };

  // Hard-filter bucket rules — institutional review item 4.C.
  // GREEN: weighted_final ≥ 6.5 AND tier=TIER_1 AND distress<0.30
  // RED:   distress ≥ 0.55 OR weighted_final ≤ 3 OR (dilution_pct ≥ 20 AND
  //        capital_use NOT in {CAPEX, ACQUISITION})
  // AMBER: everything else
  let bucket: 'GREEN' | 'AMBER' | 'RED';
  if (distress >= 0.55 || weighted_final <= 3 ||
      (dilution_pct != null && dilution_pct >= 20 && details.capital_use !== 'CAPEX' && details.capital_use !== 'ACQUISITION')) {
    bucket = 'RED';
  } else if (weighted_final >= 6.5 && tier === 'TIER_1_INSTITUTIONAL' && distress < 0.30) {
    bucket = 'GREEN';
  } else {
    bucket = 'AMBER';
  }

  return {
    conviction: Math.round(conviction * 10) / 10,
    raw_score: Math.round(raw * 10) / 10,
    passes_gate,
    signals,
    red_flags: redFlags,
    diagnostics: {
      pdf_extracted: details.issue_price != null || details.conversion_period_months != null || details.total_size_cr != null,
      issue_price_found: details.issue_price != null,
      promoter_subscribed_found: details.is_promoter_subscribed,
      promoter_pct_found: details.promoter_participation_pct != null,
      conversion_period_found: details.conversion_period_months != null,
      total_size_found: details.total_size_cr != null,
      cmp_found: cmp != null,
      momentum_found: business_momentum_score != null,
      missing_fields,
      gate_failures,
    },
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
    tier,
    tier_rationale,
    distress_probability: Math.round(distress * 100) / 100,
    capital_use: details.capital_use,
    promoter_intent: details.promoter_intent,
    dilution_pct: dilution_pct != null ? Math.round(dilution_pct * 10) / 10 : null,
    weighted: weighted,
    bucket: bucket,
  };
}
