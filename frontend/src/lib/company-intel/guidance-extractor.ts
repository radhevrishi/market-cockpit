// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTELLIGENCE — Guidance Extractor
//
// Pure-regex extractor that pulls structured guidance from concall transcripts
// and earnings PPTs. Designed to surface the items the user actually wants
// to see at a glance:
//
//   • Revenue / EBITDA growth percentages (with year)
//   • Absolute revenue / EBITDA targets in crores (with year)
//   • Operating leverage / margin trajectory
//   • Capex programs (₹ amount + timeline)
//   • Peak revenue / capacity expansion guidance
//   • Order book / pipeline figures
//   • Export contribution targets
//
// Each extraction returns a `quote` (the matched sentence) so the user can
// audit the source. Multiple hits per category are kept and de-duplicated.
//
// Pure function — no IO. Lives in /lib so it can run inside the upload
// route, in cron jobs, and on the client for live preview.
// ═══════════════════════════════════════════════════════════════════════════

export interface GuidanceItem {
  category: GuidanceCategory;
  text: string;            // human-readable summary
  quote: string;           // the source sentence we matched (≤ 300 chars)
  year?: string;           // e.g. 'FY26', 'FY28', 'CY2026'
  pct?: number;            // numeric growth % when applicable
  inrCr?: number;          // numeric INR crores when applicable
  metric?: 'revenue' | 'ebitda' | 'margin' | 'capex' | 'orderbook' | 'capacity' | 'exports';
}

export type GuidanceCategory =
  | 'REVENUE_GROWTH'
  | 'EBITDA_GROWTH'
  | 'REVENUE_TARGET'
  | 'EBITDA_MARGIN'
  | 'CAPEX_PROGRAM'
  | 'PEAK_REVENUE'
  | 'ORDERBOOK'
  | 'OPERATING_LEVERAGE'
  | 'EXPORT_MIX'
  | 'CAPACITY_EXPANSION'
  | 'OTHER';

const CATEGORY_LABEL: Record<GuidanceCategory, string> = {
  REVENUE_GROWTH:      'Revenue Growth',
  EBITDA_GROWTH:       'EBITDA Growth',
  REVENUE_TARGET:      'Revenue Target',
  EBITDA_MARGIN:       'EBITDA Margin',
  CAPEX_PROGRAM:       'Capex',
  PEAK_REVENUE:        'Peak Revenue',
  ORDERBOOK:           'Order Book',
  OPERATING_LEVERAGE:  'Operating Leverage',
  EXPORT_MIX:          'Exports',
  CAPACITY_EXPANSION:  'Capacity',
  OTHER:               'Other',
};

export function categoryLabel(c: GuidanceCategory): string {
  return CATEGORY_LABEL[c] || c;
}

const YEAR_RE = /\b(FY\s?-?\d{2,4}|F-?\d{2}|fiscal\s*\d{4}|by\s*\d{4}|CY\s?\d{4}|by\s*end-?of-?\d{4})\b/gi;
const NORMALIZE_FY = (raw: string): string => {
  const r = raw.toUpperCase().replace(/\s|-/g, '');
  // FY26 / F26 / FY2026 / FISCAL2026
  let m = r.match(/(?:FY|F|FISCAL)0*?(\d{2,4})/);
  if (m) {
    let y = m[1];
    if (y.length === 4) y = y.slice(2);
    return `FY${y.padStart(2, '0')}`;
  }
  m = r.match(/CY(\d{4})/);
  if (m) return `CY${m[1]}`;
  m = r.match(/BY(\d{4})/);
  if (m) return `by ${m[1]}`;
  return raw;
};
const extractYear = (s: string): string | undefined => {
  const m = s.match(YEAR_RE);
  if (!m || m.length === 0) return undefined;
  return NORMALIZE_FY(m[0]);
};

/** Find sentence boundaries; lightweight. */
function splitSentences(text: string): string[] {
  if (!text) return [];
  // Replace common bullet glyphs with sentence separators.
  const clean = text.replace(/[•●▪►▶·]/g, '. ');
  // Split on . ! ? followed by space/newline OR newline alone.
  const parts = clean.split(/(?<=[.!?])\s+|\n+/);
  return parts
    .map(s => s.trim())
    .filter(s => s.length >= 8 && s.length <= 400);
}

// Cap a quote string to a readable length.
const cap = (s: string, n = 280) => s.length > n ? s.slice(0, n - 1) + '…' : s;

/** Parse the first INR-crore number from a sentence ('₹650 crores', 'Rs. 4000 crore', '4,000 cr'). */
function parseInrCr(s: string): number | undefined {
  // Match ₹XXXX cr / Rs. XXXX crores / XXXX crore / XXXX cr
  const m = s.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:cr|crore|crores)\b/i)
        || s.match(/([\d,]+(?:\.\d+)?)\s*(?:cr|crore|crores)\b/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Parse the first growth percentage from a sentence ('25% revenue growth', '30%+'). */
function parsePct(s: string): number | undefined {
  const m = s.match(/(\d{1,3})\s*(?:[-–to]+\s*(\d{1,3}))?\s*%\s*(?:\+)?/);
  if (!m) return undefined;
  const lo = parseFloat(m[1]);
  const hi = m[2] ? parseFloat(m[2]) : lo;
  if (!Number.isFinite(lo)) return undefined;
  return (lo + hi) / 2;
}

interface PatternRule {
  category: GuidanceCategory;
  metric?: GuidanceItem['metric'];
  // Triggering regex — case-insensitive. If multiple match the sentence, the
  // most specific (highest priority order in the array) wins.
  pattern: RegExp;
  // Optional second-pass guard — sentence must ALSO match this if present.
  also?: RegExp;
  // Summary template — receives the matched sentence + extracted year.
  summarize: (sentence: string, year: string | undefined, pct?: number, inrCr?: number) => string;
}

const RULES: PatternRule[] = [
  // EBITDA growth — must come BEFORE revenue growth so 'EBITDA growth' isn't mis-tagged.
  { category: 'EBITDA_GROWTH', metric: 'ebitda',
    pattern: /\bebitda\b.{0,40}\b(growth|grow|guidance|cagr)\b/i,
    summarize: (s, y, pct) => pct ? `${pct.toFixed(0)}%+ EBITDA growth${y ? ' for ' + y : ''}` : `EBITDA growth${y ? ' for ' + y : ''}`,
  },
  // EBITDA margin — explicit margin language
  { category: 'EBITDA_MARGIN', metric: 'margin',
    pattern: /\bebitda\s+margin\b/i,
    summarize: (s, y, pct) => pct ? `EBITDA margin ${pct.toFixed(0)}%${y ? ' by ' + y : ''}` : `EBITDA margin guidance${y ? ' for ' + y : ''}`,
  },
  // Revenue growth % — broad
  { category: 'REVENUE_GROWTH', metric: 'revenue',
    pattern: /\b(revenue|topline|top\s*line|sales)\b.{0,40}\b(growth|guidance|grow|cagr)\b/i,
    summarize: (s, y, pct) => pct ? `${pct.toFixed(0)}% revenue growth${y ? ' for ' + y : ''}` : `Revenue growth guidance${y ? ' for ' + y : ''}`,
  },
  // Revenue absolute target in crores
  { category: 'REVENUE_TARGET', metric: 'revenue',
    pattern: /\b(revenue|topline|top\s*line)\b.{0,40}(₹|rs\.?|inr|\d)/i,
    also: /\b(?:cr|crore|crores)\b/i,
    summarize: (s, y, _pct, inrCr) => inrCr ? `₹${inrCr.toLocaleString('en-IN')} crore revenue${y ? ' by ' + y : ''}` : `Revenue target${y ? ' for ' + y : ''}`,
  },
  // Capex
  { category: 'CAPEX_PROGRAM', metric: 'capex',
    pattern: /\b(capex|capital\s+expenditure)\b/i,
    summarize: (s, y, _pct, inrCr) => inrCr ? `₹${inrCr.toLocaleString('en-IN')} crore capex${y ? ' by ' + y : ''}` : `Capex program${y ? ' through ' + y : ''}`,
  },
  // Peak revenue (Indian small/mid-cap classic — 'peak revenue 650 crores')
  { category: 'PEAK_REVENUE', metric: 'revenue',
    pattern: /\bpeak\s+(revenue|turnover|sales)\b/i,
    summarize: (s, y, _pct, inrCr) => inrCr ? `Peak revenue ₹${inrCr.toLocaleString('en-IN')} crore${y ? ' by ' + y : ''}` : `Peak revenue${y ? ' by ' + y : ''}`,
  },
  // Capacity expansion / 15000 MTPA etc.
  { category: 'CAPACITY_EXPANSION', metric: 'capacity',
    pattern: /\b(?:capacity|expansion|new\s+plant|brownfield|greenfield)\b/i,
    summarize: (s, y) => `Capacity expansion${y ? ' by ' + y : ''}`,
  },
  // Order book
  { category: 'ORDERBOOK', metric: 'orderbook',
    pattern: /\b(order\s*book|order\s*intake|order\s*pipeline)\b/i,
    summarize: (s, y, _pct, inrCr) => inrCr ? `Order book ₹${inrCr.toLocaleString('en-IN')} crore${y ? ' (' + y + ')' : ''}` : `Order book commentary${y ? ' for ' + y : ''}`,
  },
  // Operating leverage
  { category: 'OPERATING_LEVERAGE',
    pattern: /\b(operating\s+leverage|opex\s+leverage|fixed\s+cost\s+leverage)\b/i,
    summarize: (_s, y) => `Operating leverage${y ? ' from ' + y : ''}`,
  },
  // Export mix
  { category: 'EXPORT_MIX', metric: 'exports',
    pattern: /\b(export\s+(?:contribution|mix|revenue|share)|export\s+to\s+reach|exports?\s+(?:will|to)\s+reach)\b/i,
    summarize: (s, y, pct) => pct ? `Exports ${pct.toFixed(0)}% of revenue${y ? ' by ' + y : ''}` : `Export mix${y ? ' by ' + y : ''}`,
  },
];

/** Extract guidance items from arbitrary uploaded text. Returns a deduplicated,
 *  category-sorted list with quotes preserved for auditability. */
export function extractGuidance(text: string): GuidanceItem[] {
  if (!text || text.length < 30) return [];
  const sentences = splitSentences(text);
  const seenKey = new Set<string>();
  const out: GuidanceItem[] = [];

  for (const s of sentences) {
    for (const rule of RULES) {
      if (!rule.pattern.test(s)) continue;
      if (rule.also && !rule.also.test(s)) continue;
      const year = extractYear(s);
      const pct = parsePct(s);
      const inrCr = parseInrCr(s);
      const summary = rule.summarize(s, year, pct, inrCr);
      const key = `${rule.category}|${summary}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      out.push({
        category: rule.category,
        metric: rule.metric,
        text: summary,
        quote: cap(s),
        year, pct, inrCr,
      });
      // First-matching rule for a sentence wins (most specific first in RULES).
      break;
    }
  }

  // Sort: REVENUE → EBITDA → margin → capex → peak → orderbook → capacity → exports → operating-leverage → other
  const order: GuidanceCategory[] = [
    'REVENUE_TARGET', 'REVENUE_GROWTH', 'EBITDA_GROWTH', 'EBITDA_MARGIN',
    'CAPEX_PROGRAM', 'PEAK_REVENUE', 'ORDERBOOK', 'CAPACITY_EXPANSION',
    'EXPORT_MIX', 'OPERATING_LEVERAGE', 'OTHER',
  ];
  out.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return out;
}

/** One-line "Growth Guidance" string, mirroring the user's reference table.
 *  Picks the most informative items per company and joins with semicolons. */
export function guidanceSummary(items: GuidanceItem[]): string {
  if (items.length === 0) return '';
  // Prefer revenue + ebitda + capex + peak (max 3 items, semicolon-joined).
  const priority: GuidanceCategory[] = [
    'REVENUE_GROWTH', 'EBITDA_GROWTH', 'REVENUE_TARGET',
    'EBITDA_MARGIN', 'PEAK_REVENUE', 'CAPEX_PROGRAM',
    'ORDERBOOK', 'OPERATING_LEVERAGE', 'EXPORT_MIX', 'CAPACITY_EXPANSION',
  ];
  const seen = new Set<GuidanceCategory>();
  const picks: GuidanceItem[] = [];
  for (const cat of priority) {
    for (const i of items) {
      if (i.category === cat && !seen.has(cat)) {
        picks.push(i);
        seen.add(cat);
        break;
      }
    }
    if (picks.length >= 3) break;
  }
  return picks.map(p => p.text).join('; ');
}
