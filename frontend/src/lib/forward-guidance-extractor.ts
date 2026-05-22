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
  const m = token.match(/(?:FY|fy|fiscal\s?(?:year\s?)?)?\s*(\d{2,4})/);
  if (!m) return token.toUpperCase();
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
const FY_TOKEN = /(?:FY\s?\d{2,4}|FY[-\s]?\d{2}|F\.Y\.\s?\d{2,4}|fiscal\s?\d{4}|fiscal\s?year\s?\d{2,4}|Q[1-4]\s?FY\s?\d{2,4}|20\d{2}[-–]\d{2})/g;

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

  for (const s of sents) {
    if (!isForwardLooking(s)) continue;
    const fys = (s.match(FY_TOKEN) || []).map(normalizeFY);
    if (fys.length === 0) continue;

    for (const pat of METRIC_PATTERNS) {
      if (!pat.keywords.test(s)) continue;
      const numMatch = s.match(/(?:₹\s*|Rs\.?\s*|INR\s*)?([\d,]+(?:\.\d+)?(?:\s*[-–to]+\s*[\d,]+(?:\.\d+)?)?)\s*(?:%|crore|cr|lakh|billion|million|bn|mn)?/i);
      if (!numMatch) continue;
      const amounts = parseAmount(numMatch[0]);
      const isPct = pat.unit === '%' || isPercentNumber(numMatch[0], s);

      // Normalize unit-aware values to Cr or %
      const scale = (raw: number | undefined): number | undefined => {
        if (raw === undefined) return undefined;
        const lower = numMatch[0].toLowerCase();
        if (lower.includes('lakh')) return raw / 100;
        if (lower.includes('billion') || lower.includes('bn')) return raw * 100;
        if (lower.includes('million') || lower.includes('mn')) return raw / 10;
        return raw;
      };

      for (const fy of fys) {
        out.push({
          fiscalYear: fy,
          metric: pat.metric,
          unit: isPct ? '%' : pat.unit,
          low: isPct ? amounts.low : scale(amounts.low),
          high: isPct ? amounts.high : scale(amounts.high),
          point: isPct ? amounts.point : scale(amounts.point),
          rawPhrase: s.length > 200 ? s.slice(0, 200) + '…' : s,
          confidence: /target|guidance|will\s+(?:reach|achieve|deliver)/i.test(s) ? 'high'
                    : /expect|likely\s+to|aim/i.test(s) ? 'medium'
                    : 'low',
        });
      }
    }
  }

  // Dedupe: keep highest-confidence per (fy, metric) combo
  const seen = new Map<string, GuidanceItem>();
  for (const g of out) {
    const k = `${g.fiscalYear}|${g.metric}`;
    const prev = seen.get(k);
    const conf = { high: 3, medium: 2, low: 1 };
    if (!prev || conf[g.confidence] > conf[prev.confidence]) seen.set(k, g);
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
