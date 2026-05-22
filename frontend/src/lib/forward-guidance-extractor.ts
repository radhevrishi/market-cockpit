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

export type GuidanceMetric = 'REVENUE' | 'EBITDA' | 'PAT' | 'EBITDA_MARGIN' | 'PAT_MARGIN' | 'OPM' | 'GROWTH' | 'CAPEX' | 'ORDER_BOOK';

export interface GuidanceItem {
  fiscalYear: string;            // 'FY27' / 'FY28' / 'Q4FY27'
  metric: GuidanceMetric;
  unit: '₹ Cr' | '%' | 'units' | 'days';
  low?: number;
  high?: number;
  point?: number;                // when single value (not a range)
  rawPhrase: string;             // original sentence excerpt for verification
  confidence: 'high' | 'medium' | 'low';
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
const METRIC_PATTERNS: Array<{
  metric: GuidanceMetric;
  unit: GuidanceItem['unit'];
  keywords: RegExp;
}> = [
  { metric: 'REVENUE',        unit: '₹ Cr', keywords: /(?:revenue|topline|sales|turnover|net sales|gross sales)/i },
  { metric: 'EBITDA',         unit: '₹ Cr', keywords: /(?:ebitda|operating profit)/i },
  { metric: 'PAT',            unit: '₹ Cr', keywords: /(?:PAT|net profit|profit after tax|bottomline|bottom line)/i },
  { metric: 'EBITDA_MARGIN',  unit: '%',    keywords: /(?:ebitda margin|operating margin|opm)/i },
  { metric: 'PAT_MARGIN',     unit: '%',    keywords: /(?:pat margin|net margin|net profit margin)/i },
  { metric: 'GROWTH',         unit: '%',    keywords: /(?:revenue growth|topline growth|sales growth|growth rate|grow at)/i },
  { metric: 'CAPEX',          unit: '₹ Cr', keywords: /(?:capex|capital expenditure|capital investment)/i },
  { metric: 'ORDER_BOOK',     unit: '₹ Cr', keywords: /(?:order book|orderbook|orders in hand|backlog)/i },
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
const FORWARD_SIGNALS = [
  /target/i, /guidance/i, /expect/i, /aim/i, /aspire/i, /by\s+FY/i,
  /reach/i, /achieve/i, /project/i, /plan(?:ned)?\s+to/i, /likely\s+to/i,
  /going\s+forward/i, /next\s+year/i, /coming\s+year/i, /will\s+(?:be|deliver|achieve|reach)/i,
  /estimate/i, /should\s+be/i, /in\s+the\s+range/i, /on\s+track/i,
  /confident/i, /believe/i, /visibility/i, /close\s+FY/i,
  /medium[-\s]term/i, /long[-\s]term/i, /should\s+(?:reach|cross|touch)/i,
  /forecast/i, /anticipate/i, /set\s+to/i, /poised\s+to/i,
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

      let rawMatch = '';
      let amounts: { low?: number; high?: number; point?: number } = {};
      let isPct = wantsPct;

      if (wantsPct) {
        if (pctRange) {
          rawMatch = pctRange[0];
          amounts = { low: parseFloat(pctRange[1].replace(/,/g, '')), high: parseFloat(pctRange[2].replace(/,/g, '')) };
        } else if (pctPoint) {
          rawMatch = pctPoint[0];
          amounts = { point: parseFloat(pctPoint[1].replace(/,/g, '')) };
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
            return raw >= 1 && raw <= 300;
          case 'REVENUE':
          case 'EBITDA':
          case 'ORDER_BOOK':
          case 'CAPEX':
            return raw >= 10;  // Cr-denominated, minimum 10 Cr for any institutional guidance
          case 'PAT':
            return raw >= 1;
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

      for (const fy of fys) {
        out.push({
          fiscalYear: fy,
          metric: pat.metric,
          unit: isPct ? '%' : pat.unit,
          low: finalLow,
          high: finalHigh,
          point: finalPoint,
          rawPhrase: s.length > 200 ? s.slice(0, 200) + '…' : s,
          confidence: /target|guidance|will\s+(?:reach|achieve|deliver)/i.test(s) ? 'high'
                    : /expect|likely\s+to|aim/i.test(s) ? 'medium'
                    : 'low',
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
  const crMetrics = new Set<GuidanceMetric>(['REVENUE', 'EBITDA', 'PAT', 'ORDER_BOOK', 'CAPEX']);
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
  }
}

/** Color for metric chip. */
export function metricColor(m: GuidanceMetric): string {
  switch (m) {
    case 'REVENUE': case 'GROWTH': return '#10B981';
    case 'EBITDA': case 'EBITDA_MARGIN': case 'OPM': return '#22D3EE';
    case 'PAT': case 'PAT_MARGIN': return '#A78BFA';
    case 'CAPEX': return '#F59E0B';
    case 'ORDER_BOOK': return '#EF4444';
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
