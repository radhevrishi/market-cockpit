// ═══════════════════════════════════════════════════════════════════════════
// FORWARD GUIDANCE EXTRACTOR (PATCH 0629)
//
// Pulls explicit forward guidance numbers from concall transcripts /
// investor presentations / earnings releases. Handles patterns like:
//   "FY27 revenue 1500 Cr"
//   "EBITDA margins 18-19% for FY27"
//   "We target ₹2,500 Cr by FY28"
//   "PAT of ₹100 crore expected in FY26"
//
// Output: structured table of (year, metric, low, high, raw_phrase, confidence)
// that the Concall AI tab renders as a dedicated GUIDANCE panel.
//
// Pure regex/lexicon — no LLM. Aim is recall over precision: if there's
// ambiguity, surface both the high and low. Analyst always cross-checks.
// ═══════════════════════════════════════════════════════════════════════════

// PATCH 0660 — added 4 metric types so the extractor catches all 12 Learn-tab patterns:
//   CAGR             — multi-year compounded growth (distinct from single-yr GROWTH)
//   EBITDA_GROWTH    — explicit "EBITDA growth X%" guidance (Pattern #08)
//   MARGIN_BPS       — basis-point margin expansion (Pattern #07)
//   PEAK_REVENUE     — terminal/peak-capacity revenue (Pattern #09)
// PATCH 0700 — institutional vocabulary expansion. Adds 6 new metrics
// covering realization/ASP, debt repayment, dividend payout, tax-rate
// (incl. MAT credit), capacity-unit guidance, and working-capital-day
// guidance.
export type GuidanceMetric = 'REVENUE' | 'EBITDA' | 'PAT' | 'EBITDA_MARGIN' | 'PAT_MARGIN' | 'OPM' | 'GROWTH' | 'CAPEX' | 'ORDER_BOOK' | 'ORDER_INFLOW' | 'BOOK_TO_BILL' | 'CAPACITY_RAMP' | 'CAGR' | 'EBITDA_GROWTH' | 'MARGIN_BPS' | 'PEAK_REVENUE' | 'ASP' | 'DEBT_REPAYMENT' | 'DIVIDEND_PAYOUT' | 'TAX_RATE' | 'CAPACITY_UNITS' | 'WC_DAYS';

export interface GuidanceItem {
  fiscalYear: string;            // 'FY27' / 'FY28' / 'Q4FY27'
  metric: GuidanceMetric;
  unit: '₹ Cr' | '%' | 'units' | 'days' | 'bps';
  low?: number;
  high?: number;
  point?: number;                // when single value (not a range)
  rawPhrase: string;             // original sentence excerpt for verification
  confidence: 'high' | 'medium' | 'low';
  // PATCH 0660 — flags for context the extractor can detect
  sustainable?: boolean;         // "sustainable / long-term / over a long period"
  isPeak?: boolean;              // "peak revenue potential / at full capacity"
  yearsAhead?: number;           // for CAGR: how many years to compound
}

// Map fiscal year tokens to a normalized 'FY26' / 'FY27' string
const normalizeFY = (token: string): string => {
  // PATCH 0648 — handle '2027-28' (Indian fiscal-year ending notation)
  const range = token.match(/20(\d{2})[-–](\d{2})/);
  if (range) return `FY${range[2]}`;
  // PATCH 0651b — handle 'FY '27', 'FY'27' (apostrophe-prefixed Indian style)
  const cleaned = token.replace(/[''‘’]/g, '');
  const m = cleaned.match(/(?:FY|fy|fiscal\s?(?:year\s?)?)?\s*(\d{2,4})/);
  if (!m) return cleaned.toUpperCase();
  let yr = m[1];
  if (yr.length === 4) yr = yr.slice(-2);
  return `FY${yr}`;
};

const parseAmount = (raw: string): { low?: number; high?: number; point?: number } => {
  // Handle ranges: "1500-1600", "1,500–1,700", "₹1500-1700"
  const rangeMatch = raw.match(/([\d,]+(?:\.\d+)?)\s*[-–to]+\s*([\d,]+(?:\.\d+)?)/i);
  if (rangeMatch) {
    return {
      low:  parseFloat(rangeMatch[1].replace(/,/g, '')),
      high: parseFloat(rangeMatch[2].replace(/,/g, '')),
    };
  }
  const pointMatch = raw.match(/([\d,]+(?:\.\d+)?)/);
  if (pointMatch) return { point: parseFloat(pointMatch[1].replace(/,/g, '')) };
  return {};
};

const sentences = (text: string): string[] => {
  if (!text) return [];
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
};

// ─── Patterns by metric ─────────────────────────────────────────────────
// PATCH 0660 — order matters. More-specific patterns must come BEFORE
// less-specific ones so the keyword-containment dedup keeps the right
// one. e.g. EBITDA_GROWTH ("ebitda growth") must precede EBITDA
// ("ebitda") and GROWTH ("growth rate").
const METRIC_PATTERNS: Array<{
  metric: GuidanceMetric;
  unit: GuidanceItem['unit'];
  keywords: RegExp;
}> = [
  // Most-specific compound patterns first
  { metric: 'CAGR',           unit: '%',    keywords: /(?:cagr|compound annual growth rate|compounded annual growth|annualized growth)/i },
  { metric: 'EBITDA_GROWTH',  unit: '%',    keywords: /ebitda\s+growth/i },
  { metric: 'MARGIN_BPS',     unit: 'bps',  keywords: /(?:margin\s+(?:expansion|improvement|rise|increase)|(?:expand|improve|rise|increase)\s+(?:by\s+)?\d+[-\s]?\d*\s*bps|\d+[-\s]?\d*\s*bps\s+(?:expansion|improvement|of margin|rise|increase))/i },
  { metric: 'PEAK_REVENUE',   unit: '₹ Cr', keywords: /(?:peak\s+revenue|peak\s+sales|peak\s+turnover|at\s+(?:full|peak)\s+capacity|full[-\s]ramp\s+revenue)/i },
  // PATCH 0700 — institutional vocabulary expansion. Order matters:
  // these compound / multi-word keywords must come BEFORE generic
  // REVENUE / EBITDA so the keyword-containment dedup keeps the right
  // one. WC_DAYS in particular ("DSO", "working capital days") must be
  // resolved before any generic dollar-or-percent fallthrough.
  { metric: 'ASP',            unit: '₹ Cr', keywords: /(?:ASP|average selling price|realiz?ation per (?:ton|tonne|unit|kg|litre|liter)|per[- ]?unit realiz?ation|blended realiz?ation)/i },
  { metric: 'DEBT_REPAYMENT', unit: '₹ Cr', keywords: /(?:debt repayment|deleveraging|debt reduction|debt prepayment|peak debt|net debt\s+(?:reach|to|of|target|will\s+be))/i },
  { metric: 'DIVIDEND_PAYOUT',unit: '%',    keywords: /(?:dividend payout|payout ratio|distribute\s+\d+\s*%\s+(?:of|as)\s+(?:profit|earnings|PAT))/i },
  { metric: 'TAX_RATE',       unit: '%',    keywords: /(?:effective tax rate|ETR|tax payout|MAT (?:credit|utili[sz]ation)|tax rate (?:of|guidance|stood|will\s+be))/i },
  { metric: 'CAPACITY_UNITS', unit: 'units',keywords: /(?:capacity|installed capacity|production capacity|nameplate capacity).{0,40}(?:reach|expand|increase|scale|stood\s+at|will\s+be|target|guidance|of).{0,60}(?:units?|tonnes?|tons?|skids?|MW|GW|MTPA|KTPA|cases?|bottles?|litres?|liters?)/i },
  { metric: 'WC_DAYS',        unit: 'days', keywords: /(?:working capital days|cash conversion cycle|CCC|DSO|debtor days|receivable days|inventory days|working capital cycle)/i },
  // Then standard metrics
  { metric: 'REVENUE',        unit: '₹ Cr', keywords: /(?:revenue|topline|sales|turnover|net sales|gross sales)/i },
  { metric: 'EBITDA',         unit: '₹ Cr', keywords: /(?:ebitda|operating profit)/i },
  { metric: 'PAT',            unit: '₹ Cr', keywords: /(?:PAT|net profit|profit after tax|bottomline|bottom line)/i },
  { metric: 'EBITDA_MARGIN',  unit: '%',    keywords: /(?:ebitda margin|operating margin|opm)/i },
  { metric: 'PAT_MARGIN',     unit: '%',    keywords: /(?:pat margin|net margin|net profit margin)/i },
  { metric: 'GROWTH',         unit: '%',    keywords: /(?:revenue growth|topline growth|sales growth|growth rate|grow at)/i },
  { metric: 'CAPEX',          unit: '₹ Cr', keywords: /(?:capex|capital expenditure|capital investment)/i },
  { metric: 'ORDER_BOOK',     unit: '₹ Cr', keywords: /(?:order\s+book|orderbook|orders\s+in\s+hand|backlog|unexecuted\s+order(?:s)?|executable\s+order(?:s)?|pending\s+order(?:s)?|order\s+pipeline|orders\s+on\s+hand)/i }, // PATCH 0713 + 0843 — widened
  { metric: 'ORDER_INFLOW',   unit: '₹ Cr', keywords: /(?:order\s+intake|order\s+inflow|new\s+order(?:s)?|orders?\s+booked|orders?\s+received|orders?\s+secured|orders?\s+won|fresh\s+order(?:s)?|incremental\s+order(?:s)?)/i }, // PATCH 0843
  { metric: 'BOOK_TO_BILL',   unit: 'x',    keywords: /(?:book[- ]to[- ]bill|book[- ]bill\s+ratio)/i }, // PATCH 0843
  { metric: 'CAPACITY_RAMP',  unit: '%',    keywords: /(?:capacity\s+(?:ramp|expansion|scale[- ]?up|increase|addition|doubl(?:ing|ed?)|tripl(?:ing|ed?))|scale\s+up\s+to|expand(?:ing)?\s+capacity|capacity\s+(?:to|from)\s+\d)/i }, // PATCH 0843
];

// FY token regex for fiscal-year detection
// PATCH 0648 — widened to catch MTAR-style mentions like 'FY26', '2027-28',
// 'next financial year', 'this fiscal' and inline 'fiscal 2027'.
// PATCH 0651b — added apostrophe variants: "FY '27", "FY'27", "FY ’27".
const FY_TOKEN = /(?:FY\s?[''‘’]?\d{2,4}|FY[-\s]?[''‘’]?\d{2}|F\.Y\.\s?[''‘’]?\d{2,4}|fiscal\s?[''‘’]?\d{2,4}|fiscal\s?year\s?[''‘’]?\d{2,4}|Q[1-4]\s?FY\s?[''‘’]?\d{2,4}|20\d{2}[-–]\d{2})/g;

// Phrases that signal *forward* guidance (vs. backward report)
// PATCH 0648 — expanded to catch institutional language MTAR/DEEDEV use:
//   'we estimate', 'should be around', 'in the range of', 'on track for',
//   'we are confident', 'we believe', 'visibility for', 'we expect to close
//   FY27 at', 'over the next 2-3 years', 'medium-term', 'long-term'
// PATCH 0694 — widened to cover institutional Indian-concall phrasing the
// QA report (BUG-10) flagged: "we expect to deliver", "we are targeting",
// "our aspiration is", "we should be able to achieve", "our goal for the
// year", "aim to reach", "trajectory of", "exit-rate", "run-rate" etc.
const FORWARD_SIGNALS = [
  /target/i, /guidance/i, /expect/i, /aim/i, /aspire/i, /by\s+FY/i,
  /reach/i, /achieve/i, /project/i, /plan(?:ned)?\s+to/i, /likely\s+to/i,
  /going\s+forward/i, /next\s+year/i, /coming\s+year/i, /will\s+(?:be|deliver|achieve|reach)/i,
  /estimate/i, /should\s+be/i, /in\s+the\s+range/i, /on\s+track/i,
  /confident/i, /believe/i, /visibility/i, /close\s+FY/i,
  /medium[-\s]term/i, /long[-\s]term/i, /should\s+(?:reach|cross|touch)/i,
  /forecast/i, /anticipate/i, /set\s+to/i, /poised\s+to/i,
  // PATCH 0694 — Indian concall vernacular
  /we\s+expect\s+to\s+(?:deliver|achieve|reach|grow|maintain|sustain)/i,
  /we\s+(?:are|will\s+be)\s+targeting/i,
  /our\s+aspiration\s+is/i,
  /we\s+should\s+be\s+able\s+to/i,
  /our\s+goal\s+(?:for|is|of)/i,
  /goal\s+(?:for|is|of)\s+the\s+(?:year|period|quarter)/i,
  /aim\s+to\s+(?:reach|achieve|deliver|cross|touch)/i,
  /trajectory\s+of/i, /trajectory\s+to/i,
  /exit[-\s]rate/i, /exit\s+(?:run[-\s]?)?rate/i,
  /run[-\s]?rate\s+of/i,
  /(?:we|our)\s+see\s+(?:a\s+)?path\s+to/i,
  /(?:we|our)\s+plan\s+to\s+(?:reach|touch|achieve|exit)/i,
  /(?:should|will|expect\s+to)\s+(?:exit|end)\s+(?:the\s+)?(?:year|quarter|FY)/i,
  /(?:next|over\s+the\s+next)\s+(?:two|three|2|3|few)\s+(?:years|quarters)/i,
  /step[-\s]up\s+(?:to|in)/i,
  /ramp\s+(?:up\s+)?to/i,
  /scale\s+(?:up\s+)?to/i,
  /by\s+the\s+end\s+of/i,
  /(?:we|the\s+company)\s+(?:should|will)\s+(?:see|deliver|cross|touch)/i,
  // PATCH 0713 — institutional forward-looking phrasings the prior list
  // missed. Indian CFO commentary is highly hedged but each of these
  // implies forward guidance in context:
  /\b(?:envisage|envision|contemplat(?:e|ing))\b/i,                              // PATCH 0713
  /\bcommitt(?:ed|ing)\s+to\b/i,                                                  // PATCH 0713
  /\b(?:upward|downward)\s+(?:revision|trajectory)\b/i,                          // PATCH 0713
  /\b(?:road[- ]?map|pathway|line\s+of\s+sight)\s+to\b/i,                        // PATCH 0713
  /\bwe\s+(?:are\s+)?(?:well\s+)?positioned\s+(?:to|for)\b/i,                    // PATCH 0713
  /\b(?:projection|projecting)\s+(?:to|of|for)\b/i,                              // PATCH 0713
  /\bguid(?:e|ing|ed)\s+(?:to|towards|for)\b/i,                                  // PATCH 0713
  /\b(?:order[- ]?book|pipeline)\s+(?:gives\s+us|provides|offers)\s+visibility/i, // PATCH 0713
  /\bvisibility\s+(?:of|for|till|until|through)\s+(?:FY|Q|the)/i,                // PATCH 0713
  /\bturn\s+(?:cash\s+positive|profitable|EBITDA\s+positive)\s+by/i,             // PATCH 0713
  /\b(?:we\s+)?intend\s+to\b/i,                                                   // PATCH 0713
  /\b(?:firm\s+)?orders\s+(?:in\s+hand\s+)?(?:provid|giv)(?:e|ing)\s+(?:visibility|coverage)/i, // PATCH 0713
  /\bmedium[- ]?to[- ]?long[- ]?term\b/i,                                         // PATCH 0713
  /\b(?:upgrad|raisin|maintain)(?:e|ed|ing)\s+(?:our|the)\s+(?:guidance|outlook|estimate|target)/i, // PATCH 0713
  /\b(?:full[- ]?year|annualised|annualized)\s+(?:run[- ]?rate|guidance|target)/i, // PATCH 0713
];

const isForwardLooking = (sentence: string): boolean => FORWARD_SIGNALS.some((re) => re.test(sentence));

const isPercentNumber = (raw: string, sentence: string): boolean => /%/.test(raw) || /percent|percentage/i.test(sentence);

/**
 * Main extraction function.
 * @param text  Full concall transcript text or investor presentation text.
 * @returns     Array of GuidanceItem rows for the dedicated UI panel.
 */
export function extractGuidance(text: string): GuidanceItem[] {
  if (!text || text.length < 50) return [];
  const sents = sentences(text);
  const out: GuidanceItem[] = [];

  // PATCH 0651b — track the most recent FY token seen so a sentence
  // like "EBITDA margins of around 24%" (no inline FY) can be attributed
  // to whatever FY was established two sentences earlier.
  let recentFY: string | null = null;
  let recentFYAge = 99; // sentences since last FY token; gate at 4

  for (const s of sents) {
    // Update recent-FY tracker BEFORE skipping non-forward sentences so
    // even backward "in FY26 we did X" anchors a context for subsequent
    // forward statements like "we target 30% growth".
    const inlineFys = (s.match(FY_TOKEN) || []).map(normalizeFY);
    if (inlineFys.length > 0) {
      // Use the LAST inline FY (usually the forward one in "from FY26 to FY27")
      recentFY = inlineFys[inlineFys.length - 1];
      recentFYAge = 0;
    } else {
      recentFYAge += 1;
    }

    if (!isForwardLooking(s)) continue;

    // PATCH 0655 — tighten carry-forward to ≤2 sentences (was 4).
    // Wider window over-attributed random later sentences (e.g. an
    // unrelated "50 crore" mention) to the most-recent FY.
    let fys: string[] = inlineFys;
    if (fys.length === 0 && recentFY && recentFYAge <= 2) {
      fys = [recentFY];
    }
    if (fys.length === 0) continue;

    // PATCH 0651b — strip FY tokens from the sentence BEFORE matching
    // numbers, so "FY '27 from 50% revenue growth to 80%" yields 50/80
    // not 27.
    const sStripped = s.replace(FY_TOKEN, ' ');

    // PATCH 0655 — find positions of ALL metric keywords in the
    // sentence first. Each metric is then SCOPED to the substring
    // between its own keyword and the next other-metric keyword
    // (or end of sentence). This semantically partitions a
    // multi-metric sentence so EBITDA_MARGIN can't claim numbers
    // that belong to GROWTH and vice versa.
    type KwHit = { pat: typeof METRIC_PATTERNS[number]; pos: number; end: number };
    const kwHits: KwHit[] = [];
    for (const pat of METRIC_PATTERNS) {
      const re = new RegExp(pat.keywords.source, 'i');
      const m = re.exec(s);
      if (m) kwHits.push({ pat, pos: m.index, end: m.index + m[0].length });
    }
    if (kwHits.length === 0) continue;
    // PATCH 0655 — drop hits CONTAINED within other hits. Example:
    // REVENUE keyword "revenue" overlaps with GROWTH keyword "revenue
    // growth" — they match at the same position. Keep the longer
    // (more specific) keyword so its clause boundaries are correct.
    const deduped: KwHit[] = kwHits.filter(h => {
      const containedBy = kwHits.find(other =>
        other !== h &&
        other.pos <= h.pos &&
        other.end >= h.end &&
        (other.pos < h.pos || other.end > h.end)
      );
      return !containedBy;
    });
    kwHits.length = 0;
    kwHits.push(...deduped);
    // Sort by position so we can compute each metric's clause boundaries.
    kwHits.sort((a, b) => a.pos - b.pos);

    for (let i = 0; i < kwHits.length; i++) {
      const { pat, pos: kwPos, end: kwEnd } = kwHits[i];
      // Clause spans from the PREVIOUS keyword's end (or start of sentence)
      // to the NEXT keyword's start (or end of sentence).
      const clauseStart = i === 0 ? 0 : kwHits[i - 1].end;
      const clauseEnd   = i === kwHits.length - 1 ? s.length : kwHits[i + 1].pos;
      const clause = sStripped.slice(clauseStart, clauseEnd);

      const wantsPct = (pat.unit === '%');
      const wantsBps = (pat.unit === 'bps');
      // PATCH 0700 — new units: 'units' (CAPACITY_UNITS) and 'days' (WC_DAYS).
      // These have their own number-matchers below; they do NOT go through
      // the ₹ Cr crore/lakh scaling chain.
      const wantsUnits = (pat.unit === 'units');
      const wantsDays  = (pat.unit === 'days');

      // Use SINGLE-MATCH regex (no /g) per pattern. First plausible match
      // in the clause wins — restores the pre-0654 behavior that worked
      // for Revenue and Order Book.
      const pctRange = clause.match(/([\d,]+(?:\.\d+)?)\s*%[^%\d]{0,40}?(?:to|[-–]|and|up\s+to)\s*([\d,]+(?:\.\d+)?)\s*%/i);
      const pctPoint = clause.match(/([\d,]+(?:\.\d+)?)\s*%/i);
      const crRange  = clause.match(/(?:₹\s*|Rs\.?\s*|INR\s*)?([\d,]+(?:\.\d+)?)\s*(?:to|[-–])\s*([\d,]+(?:\.\d+)?)\s*(?:crores?|cr|lakhs?|billions?|millions?|bn|mn)\b/i);
      // PATCH 0655 — crPoint requires EITHER ₹/Rs/INR prefix OR
      // crore/cr/lakh/etc suffix. Naked digits don't qualify (prevents
      // "16 manufacturing units" or "50 customers" from matching).
      const crPoint  = clause.match(/(?:₹\s*|Rs\.?\s*|INR\s*)([\d,]+(?:\.\d+)?)\s*(?:crores?|cr|lakhs?|billions?|millions?|bn|mn)?\b|([\d,]+(?:\.\d+)?)\s*(?:crores?|cr|lakhs?|billions?|millions?|bn|mn)\b/i);
      // PATCH 0660 — bps detection for margin-improvement guidance
      const bpsRange = clause.match(/([\d,]+(?:\.\d+)?)\s*(?:bps|basis points?)?[^%\d]{0,30}?(?:to|[-–])\s*([\d,]+(?:\.\d+)?)\s*(?:bps|basis points?)/i);
      const bpsPoint = clause.match(/([\d,]+(?:\.\d+)?)\s*(?:bps|basis points?)/i);
      // PATCH 0700 — unit-of-measure (skids/MW/tonnes/units) and day-count
      // matchers for CAPACITY_UNITS / WC_DAYS guidance.
      const unitsRange = clause.match(/([\d,]+(?:\.\d+)?)\s*(?:units?|tonnes?|tons?|skids?|MW|GW|MTPA|KTPA|cases?|bottles?|litres?|liters?)?\s*(?:to|[-–])\s*([\d,]+(?:\.\d+)?)\s*(?:units?|tonnes?|tons?|skids?|MW|GW|MTPA|KTPA|cases?|bottles?|litres?|liters?)/i);
      const unitsPoint = clause.match(/([\d,]+(?:\.\d+)?)\s*(?:units?|tonnes?|tons?|skids?|MW|GW|MTPA|KTPA|cases?|bottles?|litres?|liters?)/i);
      const daysRange  = clause.match(/([\d,]+(?:\.\d+)?)\s*(?:days?)?\s*(?:to|[-–])\s*([\d,]+(?:\.\d+)?)\s*days?\b/i);
      const daysPoint  = clause.match(/([\d,]+(?:\.\d+)?)\s*days?\b/i);

      let rawMatch = '';
      let amounts: { low?: number; high?: number; point?: number } = {};
      let isPct = wantsPct;

      if (wantsBps) {
        if (bpsRange) {
          rawMatch = bpsRange[0];
          amounts = { low: parseFloat(bpsRange[1].replace(/,/g, '')), high: parseFloat(bpsRange[2].replace(/,/g, '')) };
        } else if (bpsPoint) {
          rawMatch = bpsPoint[0];
          amounts = { point: parseFloat(bpsPoint[1].replace(/,/g, '')) };
        } else continue;
      } else if (wantsPct) {
        if (pctRange) {
          rawMatch = pctRange[0];
          amounts = { low: parseFloat(pctRange[1].replace(/,/g, '')), high: parseFloat(pctRange[2].replace(/,/g, '')) };
        } else if (pctPoint) {
          rawMatch = pctPoint[0];
          amounts = { point: parseFloat(pctPoint[1].replace(/,/g, '')) };
        } else continue;
      } else if (wantsDays) {
        // PATCH 0700 — WC_DAYS: extract day-count guidance (DSO, CCC, WC days)
        if (daysRange) {
          rawMatch = daysRange[0];
          amounts = { low: parseFloat(daysRange[1].replace(/,/g, '')), high: parseFloat(daysRange[2].replace(/,/g, '')) };
        } else if (daysPoint) {
          rawMatch = daysPoint[0];
          amounts = { point: parseFloat(daysPoint[1].replace(/,/g, '')) };
        } else continue;
      } else if (wantsUnits) {
        // PATCH 0700 — CAPACITY_UNITS: extract unit-count guidance
        // (skids / MW / MTPA / tonnes / etc.)
        if (unitsRange) {
          rawMatch = unitsRange[0];
          amounts = { low: parseFloat(unitsRange[1].replace(/,/g, '')), high: parseFloat(unitsRange[2].replace(/,/g, '')) };
        } else if (unitsPoint) {
          rawMatch = unitsPoint[0];
          amounts = { point: parseFloat(unitsPoint[1].replace(/,/g, '')) };
        } else continue;
      } else {
        if (crRange) {
          rawMatch = crRange[0];
          amounts = { low: parseFloat(crRange[1].replace(/,/g, '')), high: parseFloat(crRange[2].replace(/,/g, '')) };
        } else if (crPoint) {
          rawMatch = crPoint[0];
          const n = crPoint[1] || crPoint[2];
          if (!n) continue;
          amounts = { point: parseFloat(n.replace(/,/g, '')) };
        } else continue;
        isPct = isPercentNumber(rawMatch, s);
      }
      // PATCH 0660 — detect sustainable / peak flags from sentence context
      const sustainable = /sustainable|long[-\s]?term|over\s+a\s+long\s+period|long[-\s]horizon|steady[-\s]state/i.test(s);
      const isPeak = /peak\s+revenue|peak\s+sales|peak\s+turnover|at\s+(?:full|peak)\s+capacity|full[-\s]ramp/i.test(s);
      // Suppress kwPos/kwEnd unused warning - kept for future proximity refinements
      void kwPos; void kwEnd;

      // Normalize unit-aware values to Cr or %
      const scale = (raw: number | undefined): number | undefined => {
        if (raw === undefined) return undefined;
        const lower = rawMatch.toLowerCase();
        if (lower.includes('lakh')) return raw / 100;
        if (lower.includes('billion') || lower.includes('bn')) return raw * 100;
        if (lower.includes('million') || lower.includes('mn')) return raw / 10;
        return raw;
      };

      // PATCH 0656 — Sanity floors. Reject implausible guidance values
      // before pushing. MTAR's live run picked up a stray "0%" near
      // "EBITDA margin" (probably a YoY-delta or chart label).
      // Institutional guidance numbers always fall in tight ranges.
      const isSensible = (raw: number | undefined): boolean => {
        if (raw === undefined) return true; // missing is fine; only reject implausible
        switch (pat.metric) {
          case 'EBITDA_MARGIN':
          case 'OPM':
            return raw >= 3 && raw <= 80;
          case 'PAT_MARGIN':
            return raw >= 1 && raw <= 60;
          case 'GROWTH':
          case 'EBITDA_GROWTH':
          case 'CAGR':
            return raw >= 1 && raw <= 300;
          case 'MARGIN_BPS':
            return raw >= 10 && raw <= 2000;   // 10-2000 bps = 0.1-20% margin expansion
          case 'REVENUE':
          case 'EBITDA':
          case 'ORDER_BOOK':
          case 'CAPEX':
          case 'PEAK_REVENUE':
            return raw >= 10;  // Cr-denominated, minimum 10 Cr for any institutional guidance
          case 'PAT':
            return raw >= 1;
          // PATCH 0700 — institutional vocabulary expansion sanity floors
          case 'ASP':
            return raw >= 1;                  // ₹ per unit; very wide range, just reject 0
          case 'DEBT_REPAYMENT':
            return raw >= 1;                  // ₹ Cr; allow small repayments
          case 'DIVIDEND_PAYOUT':
            return raw >= 1 && raw <= 100;    // % of profit
          case 'TAX_RATE':
            return raw >= 5 && raw <= 50;     // ETR rarely outside this band
          case 'CAPACITY_UNITS':
            return raw >= 1;                  // unit count — no upper bound
          case 'WC_DAYS':
            return raw >= 1 && raw <= 500;    // days
          default:
            return true;
        }
      };
      const finalLow   = isPct ? amounts.low   : scale(amounts.low);
      const finalHigh  = isPct ? amounts.high  : scale(amounts.high);
      const finalPoint = isPct ? amounts.point : scale(amounts.point);
      // If point is implausible, OR both low/high implausible, skip entirely.
      if (finalPoint !== undefined && !isSensible(finalPoint)) continue;
      if (finalLow !== undefined && finalHigh !== undefined && !isSensible(finalLow) && !isSensible(finalHigh)) continue;
      // Also skip if a single-sided range bound is wildly off (likely noise)
      if (finalLow !== undefined && !isSensible(finalLow) && finalHigh === undefined) continue;
      if (finalHigh !== undefined && !isSensible(finalHigh) && finalLow === undefined) continue;

      // PATCH 0660 — for CAGR detect how many years (e.g. "over 3-5 years")
      let yearsAhead: number | undefined;
      if (pat.metric === 'CAGR') {
        const ymatch = s.match(/(?:over\s+)?(\d+)\s*(?:-|to|–)\s*(\d+)\s*years?|over\s+(\d+)\s*years?|next\s+(\d+)\s*years?/i);
        if (ymatch) {
          if (ymatch[1] && ymatch[2]) yearsAhead = Math.round((parseInt(ymatch[1]) + parseInt(ymatch[2])) / 2);
          else if (ymatch[3]) yearsAhead = parseInt(ymatch[3]);
          else if (ymatch[4]) yearsAhead = parseInt(ymatch[4]);
        }
      }

      // PATCH 0677 — Context-aware exclusions for false-positive extractions.
      //
      // Bug 1: CAGR/GROWTH picked up from external market research (e.g.,
      //   "CAGR 33.2% Source: Markets & Markets Research Report") which is
      //   the industry size CAGR, NOT company guidance. Reject when context
      //   mentions market-research source.
      //
      // Bug 2: EBITDA_MARGIN picking up YoY EBITDA GROWTH from a table layout.
      //   PDF says "EBITDA# 30.03 59% 99.74 26% EBITDA Margin# 23.86%". The
      //   59% is growth-YoY column. Reject when number is followed by "YoY"
      //   / "yoy growth" / "year-on-year" / "bps" markers within ~30 chars.
      //
      // Bug 3: Margin matched where actual number is BPS expansion not absolute
      //   margin (e.g., "EBITDA margin expanded 326 bps to 23.86%"). My code
      //   picks 326 (parsed as %) but real margin is 23.86%. Reject when number
      //   is followed by "bps" or "basis points" within ~10 chars.
      const marketResearchContext = /\b(?:markets?\s*&?\s*markets|research\s+report|industry\s+(?:cagr|forecast|size|growth)|global\s+market|source\s*:\s*(?:markets|research|knight|gartner|ihs|crisil|nielsen))/i.test(s);
      const isExternalMarketCAGR = (pat.metric === 'CAGR' || pat.metric === 'GROWTH') && marketResearchContext;

      const numStartIdx = sStripped.indexOf(rawMatch);
      const after = numStartIdx >= 0 ? sStripped.slice(numStartIdx + rawMatch.length, numStartIdx + rawMatch.length + 30) : '';
      const looksLikeBpsValue = pat.metric === 'EBITDA_MARGIN' && /\b(?:bps|basis\s*points?)\b/i.test(after);
      const looksLikeGrowthYoY = (pat.metric === 'EBITDA_MARGIN' || pat.metric === 'OPM' || pat.metric === 'PAT_MARGIN') &&
        /\b(?:yoy|y-o-y|y\/y|year[-\s]on[-\s]year)\b/i.test(after);

      // Bug 4 detection: tabular EBITDA-with-percent that's actually growth%.
      // Pattern: "EBITDA <num> <num>%" where num is small (e.g., 30.03) and the
      // % immediately follows another number — the % is growth, not margin.
      const tabularGrowthHit = (pat.metric === 'EBITDA_MARGIN' && /ebitda(?:\s*#)?\s+[\d.,]+\s+[\d.,]+\s*%/i.test(s));

      if (isExternalMarketCAGR || looksLikeBpsValue || looksLikeGrowthYoY || tabularGrowthHit) {
        // Skip this candidate — extraction would mis-attribute.
        continue;
      }

      for (const fy of fys) {
        out.push({
          fiscalYear: fy,
          metric: pat.metric,
          unit: wantsBps ? 'bps' : (isPct ? '%' : pat.unit),
          low: finalLow,
          high: finalHigh,
          point: finalPoint,
          rawPhrase: s.length > 200 ? s.slice(0, 200) + '…' : s,
          confidence: /target|guidance|will\s+(?:reach|achieve|deliver)/i.test(s) ? 'high'
                    : /expect|likely\s+to|aim/i.test(s) ? 'medium'
                    : 'low',
          sustainable: sustainable || undefined,
          isPeak: isPeak || undefined,
          yearsAhead,
        });
      }
    }
  }

  // PATCH 0655 — Dedupe: keep highest-confidence per (fy, metric).
  // At equal confidence:
  //   - For Cr-denominated metrics (REVENUE/EBITDA/PAT/ORDER_BOOK/CAPEX),
  //     prefer the LARGER value (institutional forward guidance is
  //     always the larger of any candidate numbers near the keyword).
  //   - For % metrics, prefer point over range (more specific number).
  // PATCH 0700 — DEBT_REPAYMENT joins the Cr-denominated dedupe set
  // (prefer larger value at equal confidence). ASP stays out because
  // ASP guidance is usually a small ₹/unit number where "larger wins"
  // is the wrong heuristic.
  const crMetrics = new Set<GuidanceMetric>(['REVENUE', 'EBITDA', 'PAT', 'ORDER_BOOK', 'ORDER_INFLOW', 'CAPEX', 'PEAK_REVENUE', 'DEBT_REPAYMENT']);  // PATCH 0843
  const seen = new Map<string, GuidanceItem>();
  for (const g of out) {
    const k = `${g.fiscalYear}|${g.metric}`;
    const prev = seen.get(k);
    const conf = { high: 3, medium: 2, low: 1 };
    const cg = conf[g.confidence];
    const cp = prev ? conf[prev.confidence] : -1;
    const valOf = (it: GuidanceItem): number => it.point ?? it.high ?? it.low ?? 0;
    const isCrMetric = crMetrics.has(g.metric);
    let shouldReplace: boolean;
    if (!prev) shouldReplace = true;
    else if (cg > cp) shouldReplace = true;
    else if (cg < cp) shouldReplace = false;
    else if (isCrMetric) shouldReplace = valOf(g) > valOf(prev);  // prefer larger Cr value
    else {
      const gIsPoint = g.point !== undefined;
      const pIsPoint = prev.point !== undefined;
      shouldReplace = gIsPoint && !pIsPoint;
    }
    if (shouldReplace) seen.set(k, g);
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.fiscalYear !== b.fiscalYear) return a.fiscalYear.localeCompare(b.fiscalYear);
    return a.metric.localeCompare(b.metric);
  });
}

/** Pretty label for the metric badge. */
export function metricLabel(m: GuidanceMetric): string {
  switch (m) {
    case 'REVENUE': return 'Revenue';
    case 'EBITDA': return 'EBITDA';
    case 'PAT': return 'PAT';
    case 'EBITDA_MARGIN': return 'EBITDA Margin';
    case 'PAT_MARGIN': return 'Net Margin';
    case 'OPM': return 'OPM';
    case 'GROWTH': return 'Growth';
    case 'CAPEX': return 'Capex';
    case 'ORDER_BOOK': return 'Order Book';
    case 'ORDER_INFLOW': return 'Order Intake';
    case 'BOOK_TO_BILL': return 'Book-to-Bill';
    case 'CAPACITY_RAMP': return 'Capacity Ramp';
    case 'CAGR': return 'CAGR';
    case 'EBITDA_GROWTH': return 'EBITDA Growth';
    case 'MARGIN_BPS': return 'Margin Expansion (bps)';
    case 'PEAK_REVENUE': return 'Peak Revenue';
    // PATCH 0700 — institutional vocabulary expansion
    case 'ASP': return 'ASP / Realization';
    case 'DEBT_REPAYMENT': return 'Debt Repayment';
    case 'DIVIDEND_PAYOUT': return 'Dividend Payout';
    case 'TAX_RATE': return 'Effective Tax Rate';
    case 'CAPACITY_UNITS': return 'Capacity (units)';
    case 'WC_DAYS': return 'Working Capital Days';
  }
}

/** Color for metric chip. */
export function metricColor(m: GuidanceMetric): string {
  switch (m) {
    case 'REVENUE': case 'GROWTH': case 'CAGR': return '#10B981';
    case 'EBITDA': case 'EBITDA_MARGIN': case 'OPM': case 'EBITDA_GROWTH': case 'MARGIN_BPS': return '#22D3EE';
    case 'PAT': case 'PAT_MARGIN': return '#A78BFA';
    case 'CAPEX': case 'CAPACITY_UNITS': return '#F59E0B';
    case 'ORDER_BOOK': case 'ORDER_INFLOW': case 'BOOK_TO_BILL': case 'PEAK_REVENUE': return '#EF4444';
    case 'CAPACITY_RAMP': return '#F59E0B';
    // PATCH 0700 — institutional vocabulary expansion
    case 'ASP': return '#F472B6';            // pink — realisation/pricing
    case 'DEBT_REPAYMENT': return '#FB923C'; // orange — balance-sheet
    case 'DIVIDEND_PAYOUT': return '#FBBF24'; // amber — capital return
    case 'TAX_RATE': return '#94A3B8';       // slate — accounting
    case 'WC_DAYS': return '#FBBF24';        // amber — working capital
  }
}

/** Format value with appropriate unit. */
export function formatGuidanceValue(g: GuidanceItem): string {
  const fmtNum = (n: number | undefined) => n === undefined ? '?' : n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  if (g.low !== undefined && g.high !== undefined) {
    return `${fmtNum(g.low)}–${fmtNum(g.high)} ${g.unit}`;
  }
  if (g.point !== undefined) return `${fmtNum(g.point)} ${g.unit}`;
  return '?';
}
