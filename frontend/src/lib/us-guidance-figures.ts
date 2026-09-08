// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE FIGURES (pure) — the numbers behind "guidance raised".
//
// "Guidance raised" is a verdict; what a trader wants is its shape, the way the
// earnings feeds print it:
//
//     Raises FY26 Guide:
//       Revenue:  $5.63B–$5.71B  (Est. $5.54B)   from $5.40B–$5.48B
//       Adj. EPS: $9.83–$10.31   (Est. $9.25)    from $8.65–$9.05
//
// Every figure there except "(Est. …)" is in the press release. It is almost
// never a sentence, though — it is a small table that flattens to lines:
//
//     For the full year of Fiscal 2026:
//     Current Outlook          Prior Outlook
//     Net sales
//     $5.63 billion to $5.71 billion      $5.40 billion to $5.48 billion
//
// so this parser is LINE-oriented, not sentence-oriented, and carries four
// pieces of context down the page: which period the current section guides,
// which PERIODS its columns name, what the other columns mean (Current/Prior,
// GAAP/Non-GAAP, last year's Results/this year's Guidance), and the units the
// table declared ("in millions").
//
// WHY IT IS BUILT OUT OF REFUSALS. A wrong guidance number is worse than a
// missing one: a card that says "FY27 revenue $51M" when the company guided
// $210–240M (C3.ai printed the quarter and the year as two adjacent columns) is
// not a small error, it is a fabricated fact. Every rule below exists because a
// real filing produced a real wrong number without it:
//
//   • ANCHORED LABELS. A clause is only read when its FIRST metric label opens
//     it, after a short run of harmless words ("The Company expects", "For
//     fiscal 2027, we now see"). Samsara's footnote "Constant currency impact to
//     revenue guidance is $2 million for Q3 FY2027 and $10 million for FY2027"
//     is not a revenue guide, and only the words in front of "revenue" say so.
//     us-key-metrics.ts anchors its labels the same way and for the same reason.
//   • PROXIMITY, NOT FIRST-MATCH. A number belongs to the metric label nearest
//     to it on its LEFT, never to the first label on the line. American Outdoor
//     wrote "…full-year guidance for net sales of $200 million to $210 million,
//     and we are increasing our Adjusted EBITDA guidance to $14.5 million to
//     $17.5 million" — one sentence, two metrics, and first-match bound the
//     sales range to EBITDA. The same rule reads Credo's "GAAP gross margin …
//     62.9% and 64.9%, and non-GAAP gross margin … 67.0% and 69.0%" with the
//     right basis on each range, because the basis comes from the words in front
//     of THAT label, not from the line as a whole.
//   • A CONNECTOR, NOT A GAP. Between the label and its number there may only be
//     a forward verb, a period phrase, a range word and punctuation. PVH's "The
//     full year 2026 EPS projection includes an estimated positive impact of
//     approximately $0.40 per share" has an anchored label and a number, and is
//     not guidance; "projection includes an estimated positive impact" is what
//     says so.
//   • COLUMNS NAME PERIODS. When a guidance table's header names two periods
//     ("Second Quarter Fiscal 2027 Guidance | Full Year Fiscal 2027 Guidance",
//     "Q3 FY 2027 | FY 2027"), a row's ranges bind to them positionally. When
//     the count of ranges does not match the count of period columns, the row is
//     dropped whole — a mislabelled period is the most expensive error here.
//     A header that spans the table names the table and not a column, and gives
//     itself away by repeating one of the columns under it ("Fiscal 2027" over
//     "Q2 | FY27"); a column that is only a quarter takes its fiscal year from
//     that spanner. Columns never step BACK a fiscal year: "Q3 FY26 | Q3 FY25"
//     heads a year-over-year comparison of REPORTED results, not a guide.
//   • TWO FIGURES ON A ROW ARE TWO COLUMNS. A row of table cells holding two or
//     more figures may only be read once something has said what its columns
//     are — periods, GAAP | Non-GAAP, Prior | Current. Keeping the first cell
//     and stamping it with the section's period is a guess dressed as a fact:
//     Salesforce's non-GAAP EPS row flattens to "$3.25 - $3.27  $14.06 - $14.12"
//     and the first cell went out as an FY27 guide of $3.25 — which is the Q2
//     number, against a true FY27 guide of $14.06 - $14.12. Such a row is now
//     refused, and every other one it was reading turned out to be a row of
//     REPORTED results (NetApp's income statement, Ollie's comp-sales history,
//     HP's quarter-versus-quarter table) rather than a guide.
//   • A SUBSET IS NOT THE COMPANY. "Subscription revenue" and "Product revenue"
//     are their own metrics; a segment's revenue (Brady's IPS, Dell's
//     AI-Optimized Servers, HPE's Networking) is dropped. Sprinklr guides
//     subscription revenue of $196–197M and total revenue of $215–216M on
//     consecutive lines, and the card must never print the first as "revenue".
//   • UNITS MUST AGREE. A percentage may only land on a dollar metric when the
//     row says "growth"/"increase"/"decline" (or a Results|Guidance column pair
//     makes the percentage a change by construction). Sportsman's Warehouse put
//     a same-store-sales range and an EBITDA range in one sentence; without this
//     the card read "Adj. EBITDA +1%".
//   • RANGE ENDS ARE NOT POINTS. A point is emitted only when its clause holds
//     exactly ONE number of that unit and states the forecast — a forward verb,
//     a lead-in that carried one, or the cells of a guidance table. Planet's
//     "$3 and $10 million" (a trailing scale word governs both ends) came out as
//     a $10M point; Ambarella's "between 59.0% and 60.0%" wrapped across two
//     source lines and came out as 59%. Both are ranges and are read as ranges.
//   • THE CLAUSE'S OWN PERIOD WINS. Genesco's CFO quote sits under a "Second
//     Quarter Fiscal 2027" heading and says "full-year adjusted EPS outlook",
//     so it is bound to the year — not printed twice under two labels.
//
// SHAPES THIS MODULE REFUSES, on purpose:
//   • a multi-period table whose cells lost their range separator in the HTML
//     (Samsara prints "$514 million $516 million" under "Q3 FY2027 Outlook |
//     FY2027 Outlook"): the row's four numbers cannot be mapped onto its two
//     periods, so the table is dropped whole;
//   • a range with a WORD at one end ("Flat to up 1.5%", "flat to down 1%") —
//     reading the number alone states a guide the company did not give;
//   • a loss range written without signs ("GAAP loss per share … between $1.47
//     and $1.27"), where only the word "loss" carries the minus;
//   • a figure standing behind a comparison ("…compared to a net loss per share
//     of $4.28 in the third quarter of fiscal 2025"), whatever its label;
//   • a Q + FY table whose column header is split over two ROWS, so that neither
//     line names a period on its own (Box heads its EPS reconciliation "Three
//     Months Ended | Fiscal Year Ended" over "October 31, 2026 | January 31,
//     2027"): flattened to lines, those columns cannot be reassembled.
//
// Anything that fails a rule is dropped silently.
// ═══════════════════════════════════════════════════════════════════════════

export type GuideMetric =
  | 'revenue' | 'product_revenue' | 'subscription_revenue' | 'eps' | 'operating_income'
  | 'net_income' | 'comparable_sales' | 'gross_margin' | 'operating_margin'
  | 'free_cash_flow' | 'ebitda';
export type GuidePeriod = 'quarter' | 'year';

export interface GuidanceFigure {
  metric: GuideMetric;
  basis: 'gaap' | 'adjusted';
  period: GuidePeriod;
  period_label: string;              // "Q3 FY26", "FY26"
  low: number | null;
  high: number | null;
  unit: 'usd' | 'usd_share' | 'pct';
  prior_low: number | null;
  prior_high: number | null;
  raised: boolean | null;
  source: string;
}

type Unit = 'usd' | 'usd_share' | 'pct';

// ─── metric labels ──────────────────────────────────────────────────────────
// Order is priority: when two labels overlap in a clause ("net income per
// share" is EPS, not net income) the earlier one wins.
interface Spec { id: GuideMetric; re: RegExp; unit: Unit; }
const SPECS: Spec[] = [
  // EBITDA first: "Adjusted EBITDA of $415 million to $430 million" is not
  // revenue guidance, and Petco's card said it was until this line existed.
  { id: 'ebitda', re: /\bebitda\b/i, unit: 'usd' },
  { id: 'comparable_sales', re: /(?:total\s+)?comp(?:arable)?(?:\s+store)?\s+(?:net\s+)?sales|same[- ]store\s+(?:net\s+)?sales/i, unit: 'pct' },
  { id: 'gross_margin', re: /gross\s+margins?\b/i, unit: 'pct' },
  { id: 'operating_margin', re: /operating\s+(?:profit\s+)?margins?\b/i, unit: 'pct' },
  { id: 'free_cash_flow', re: /free\s+cash\s+flow/i, unit: 'usd' },
  { id: 'eps', re: /(?:earnings|income|loss|profit)\s*(?:\(loss\)\s*)?per\s+(?:diluted\s+|common\s+|basic\s+|ordinary\s+|class\s+[a-z]\s+)*shares?|per\s+(?:diluted\s+|common\s+)*share\b|\beps\b/i, unit: 'usd_share' },
  { id: 'operating_income', re: /operating\s+(?:income|loss|profit|earnings)|(?:income|earnings|profit|loss)\s*(?:\(loss\)\s*)?from\s+operations|\bebit\b/i, unit: 'usd' },
  { id: 'net_income', re: /net\s+(?:income|earnings|loss|profit)\b/i, unit: 'usd' },
  { id: 'revenue', re: /\b(?:net\s+)?(?:revenues?|sales)\b/i, unit: 'usd' },
];
const SPEC_G = SPECS.map((s) => new RegExp(s.re.source, 'gi'));
const NATURAL: Record<GuideMetric, Unit> = {
  revenue: 'usd', product_revenue: 'usd', subscription_revenue: 'usd', eps: 'usd_share',
  operating_income: 'usd', net_income: 'usd', ebitda: 'usd', free_cash_flow: 'usd',
  comparable_sales: 'pct', gross_margin: 'pct', operating_margin: 'pct',
};

/** Row labels that are never guidance, tested on the words IN FRONT of the
 *  metric label — GitLab's EPS row explains its share count in the same
 *  breath ("…per share assuming approximately 172 million … weighted average
 *  shares outstanding"), and an unanchored test threw the row away. */
const SKIP_PREFIX = /weighted\s+average|shares\s+outstanding|net\s+new\s+stores|store\s+count|tax\s+rate|capital\s+expenditure|interest\s+(?:income|expense)|depreciation|amortization|adjustments?\s+of|total\s+adjustments|stock-based|restructuring|acquisition-related|income\s+tax\s+effect|dividend|organic|constant\s+currency/i;

const ADJ_NEAR = /\b(adjusted|adj\.|non-?gaap|pro\s*forma)\b/i;
// A section only counts as guidance when its HEADING says so. "expects" inside
// a results bullet is not a guidance section — that looseness is what let an
// income-statement row be read as a forecast.
const SECTION_ON = /\b(outlook|guidance|expects?\s+the\s+following|is\s+issuing\s+the\s+following|provided\s+the\s+following\s+financial)\b/i;
/** A line that puts us back into REPORTED results, whatever came before. */
const RESULTS_LINE = /\b(summary\b|year\s+to\s+date|compared\s+to\s+(?:the\s+)?(?:first|second|third|fourth)\s+quarter|(?:first|second|third|fourth)\s+quarter\s+(?:and\s+)?(?:fiscal\s+)?(?:year\s+)?(?:\d{4}\s+)?(?:financial\s+)?results\b|results\s+of\s+operations|highlights?\b)/i;
const FORWARD_VERB = /\b(expects?|expected|anticipates?|guidance|outlook|forecasts?|projects?|projected|estimates?|estimated|sees?|reaffirm\w*|reiterat\w*|maintain\w*|rais\w*|to\s+be\s+in\s+the\s+range|in\s+the\s+range\s+of|now\s+(?:expects|sees))\b/i;
const SECTION_OFF = /\b(condensed\s+consolidated|consolidated\s+(?:statements?|balance)|balance\s+sheets?|statements?\s+of\s+operations|statements?\s+of\s+cash\s+flows?|non-?gaap\s+information|forward-?looking\s+statements|about\s+the\s+company|investor\s+(?:relations|contact)|conference\s+call|reconciliation\s+of\s+(?:gaap\s+)?net|use\s+of\s+non-?gaap)\b/i;
/** …and never when the same line reads as a REPORTED figure. "GAAP diluted net
 *  EPS of $1.06" and "included a $0.86 per-share tariff benefit" both sit near
 *  an outlook heading in their releases; the tense is what separates them. */
const POINT_PAST = /\b(was|were|increased|decreased|declined|rose|fell|reported|delivered|included|per-share\s+benefit)\b/i;

// ─── periods ────────────────────────────────────────────────────────────────
// The fiscal year may follow the quarter word behind "fiscal"/"fy" ("fourth
// quarter of fiscal 2026"), or bare, straight after it ("Third Quarter 2026
// Guidance", "fiscal fourth quarter 2026").
const QTR_HEAD = /\b(?:for\s+the\s+)?(first|second|third|fourth)[-\s]+(?:fiscal\s+)?quarter\b(?:[^.\n]{0,40}?\b(?:fiscal(?:\s+year)?|fy)\s*(?:'(\d{2})|(\d{4}))|\s+(?:of\s+)?(20\d{2})\b)?/i;
const QTR_SHORT = /\bq\s*([1-4])\s*(?:fy|fiscal(?:\s+year)?)?\s*'?(\d{2,4})?\b/i;
const YEAR_HEAD = /\b(?:for\s+the\s+)?(?:full[- ]year|full\s+fiscal\s+year|fiscal\s+year|fiscal)\b(?:\s+(?:year\s+)?'?(\d{4}))?/i;
const FY_SHORT = /\bfy\s*'?(\d{2,4})\b/i;
/** "For 2026, the Company now expects…" — a calendar-year filer's full-year guide. */
const BARE_YEAR_HEAD = /^for\s+(?:the\s+)?(?:full\s+year\s+)?(20\d{2})\b(?!\s*(?:q[1-4]|first|second|third|fourth))/i;
/** Docusign's guidance table names its periods only by their end dates. */
const DATED_QTR = /\b(?:three|3)\s+months\s+ended?(?:ing)?\s+([a-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i;
const DATED_YEAR = /\b(?:(?:twelve|12)\s+months|(?:fiscal\s+)?year)\s+end(?:ed|ing)\s+([a-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const CAPTION_SCALE = /\(\s*(?:\$\s*)?(?:amounts\s+)?in\s+(thousands|millions|billions)/i;
/** A column header carries the table's footnote marker as often as not —
 *  Salesforce heads its guidance columns "GAAP" and "Non-GAAP (1)". Anchored
 *  without room for that marker, the pair went unrecognised and both tables
 *  silently threw their non-GAAP column away. */
const COL_MARK = /\s*(?:\((?:\d{1,2}|[a-z])\)|[*†‡])?\s*/.source;
const COL_GAAP = new RegExp(`^${COL_MARK}gaap${COL_MARK}$`, 'i');
const COL_NONGAAP = new RegExp(`^${COL_MARK}non-?gaap${COL_MARK}$`, 'i');
const COL_CURRENT = /\b(current|updated|new)\s+(?:outlook|guidance)\b/i;
const COL_PRIOR = /\b(prior|previous)\s+(?:outlook|guidance)\b/i;
/** Dell's guidance table labels its columns just "Previous" and "Updated". */
const COL_PREV_BARE = /\bprevious\b/i;
const COL_UPD_BARE = /\b(updated|current)\b/i;
/** Campbell's prints last year's actual beside this year's guide: "FY26
 *  Results | FY27 Guidance". The first column is a RESULT, not prior guidance,
 *  and the second is often the percentage change between them. */
const COL_RESULTS = /\b(?:fy\s*'?\d{2,4}|prior[- ]year|last\s+year)\s+results?\b|^\s*results?\s*$/i;
const COL_GUIDANCE = /\bguidance\b|\boutlook\b/i;

/** Only these phrasings mark a later range on a line as PRIOR GUIDANCE. */
const PRIOR_MARK = /\b(?:up\s+from|down\s+from|from\s+(?:the\s+)?(?:previous|prior)|(?:previous|prior)\s+(?:guidance|outlook|range|view|midpoint)|compared\s+to\s+(?:the\s+)?(?:previous|prior)\s+(?:guidance|outlook|range)|versus\s+(?:the\s+)?(?:previous|prior)|raised\s+from|increased\s+from)\b|\([^)]{0,60}\bprior\b\s*\)/i;

const MULT: Record<string, number> = { thousand: 1e3, thousands: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9 };

// ─── anchoring and connectors ───────────────────────────────────────────────
/** Words that may stand between the start of a clause and its first metric
 *  label. Anything else — a noun of its own ("impact", "contribution"), a
 *  segment name, another metric — means the number beside the label may belong
 *  to something else, and the clause is not read at all. */
const PREFIX_OK = new Set([
  'a', 'an', 'the', 'our', 'its', 'their', 'and', 'or', 'also', 'plus', 'while', 'with', 'both',
  'in', 'of', 'at', 'for', 'as', 'to', 'on', 'be', 'is', 'are', 'was', 'were', 'will', 'that',
  'which', 'this', 'these', 'no', 'not', 'now', 'still', 'again', 'it', 'per', 'from', 'than', 'about',
  'we', 'us', 'company', "company's", 'companies', 'corporation', 'corp', 'inc', 'group', 'management', 'board',
  'q1', 'q2', 'q3', 'q4', 'h1', 'h2', 'first', 'second', 'third', 'fourth', 'quarter', 'quarters',
  'quarterly', 'half', 'full', 'full-year', 'fullyear', 'year', 'years', 'yearly', 'annual', 'annualized',
  'fiscal', 'fy', 'ending', 'ended', 'end', 'period', 'ytd', 'months', 'month', 'calendar', 'next',
  'coming', 'upcoming', 'remainder', 'balance', 'today', 'currently', 'previously', 'following',
  'gaap', 'non-gaap', 'nongaap', 'adjusted', 'adj', 'pro', 'forma', 'total', 'consolidated', 'net',
  'core', 'reported', 'underlying', 'record', 'approximately', 'approx', 'roughly',
  'diluted', 'basic', 'common', 'ordinary', 'class', 'share', 'shares', 'continuing', 'operations',
  'product', 'ending', 'through', ...MONTHS,
  'expect', 'expects', 'expected', 'expecting', 'anticipate', 'anticipates', 'anticipated',
  'project', 'projects', 'projected', 'projecting', 'forecast', 'forecasts', 'forecasted', 'forecasting',
  'estimate', 'estimates', 'estimated', 'estimating', 'see', 'sees', 'seeing', 'guide', 'guides',
  'guidance', 'outlook', 'provide', 'provides', 'provided', 'providing', 'issue', 'issues', 'issued',
  'issuing', 'offer', 'offers', 'offered', 'offering', 'raise', 'raises', 'raised', 'raising',
  'lower', 'lowers', 'lowered', 'lowering', 'increase', 'increases', 'increased', 'increasing',
  'decrease', 'decreases', 'decreased', 'decreasing', 'maintain', 'maintains', 'maintained',
  'maintaining', 'reaffirm', 'reaffirms', 'reaffirmed', 'reaffirming', 'reiterate', 'reiterates',
  'reiterated', 'reiterating', 'update', 'updates', 'updating', 'updated', 'revise', 'revises',
  'revised', 'revising', 'narrow', 'narrows', 'narrowed', 'narrowing', 'initiate', 'initiates',
  'initiated', 'initiating', 'announce', 'announces', 'announced', 'set', 'sets', 'plan', 'plans',
  'planning', 'continue', 'continues', 'continuing', 'based', 'information', 'available',
]);
/** The connector a label is allowed to reach its number through. Deliberately
 *  narrower than the prefix: a verb of forecasting, a period phrase, a range
 *  word, punctuation and footnote digits — nothing that could make the number
 *  a component of, or an adjustment to, the metric. */
const GAP_OK = new Set([
  'is', 'are', 'was', 'were', 'will', 'be', 'been', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or',
  'a', 'an', 'the', 'its', 'our', 'their', 'that', 'than', 'from', 'with', 'by', 'as', 'now', 'still',
  'again', 'currently', 'approximately', 'approx', 'about', 'roughly', 'around', 'nearly', 'least',
  'range', 'ranges', 'ranging', 'between', 'high', 'low', 'end', 'ends', 'midpoint', 'mid', 'upper',
  'lower', 'top', 'bottom', 'up', 'down', 'growth', 'grow', 'increase', 'decrease', 'decline',
  'change', 'basis', 'points', 'loss', 'profit', 'income', 'margin',
  'expects', 'expect', 'expected', 'anticipates', 'anticipated', 'projects', 'projected',
  'forecasts', 'forecasted', 'estimates', 'estimated', 'guidance', 'guided', 'outlook', 'sees', 'see',
  'reaffirms', 'reaffirming', 'reiterates', 'reiterating', 'maintains', 'maintaining', 'raises',
  'raising', 'updates', 'updating', 'revised', 'narrowed', 'provides', 'providing',
  'continuing', 'operations', 'share', 'shares', 'diluted', 'common', 'per', 'basic',
  'gaap', 'non-gaap', 'nongaap', 'adjusted', 'total', 'net', 'reported',
  'fiscal', 'year', 'years', 'quarter', 'full', 'first', 'second', 'third', 'fourth', 'ending',
  'ended', 'months', 'month', 'q1', 'q2', 'q3', 'q4', 'fy', 'flat', 'na',
  ...MONTHS,
]);
/** Where a clause stops belonging to its metric: what follows compares, adjusts
 *  or explains, and its numbers are not the guide. */
const CUT = /\b(?:which|compared\s+to|compares\s+to|versus|vs\.?|including|excluding|reflect(?:s|ing)|driven\s+by|assuming|using|net\s+of|related\s+to|incorporat\w+|partially\s+offset|includes?|included)\b/i;
/** Past one of these, a clause has stopped guiding and started comparing. */
const COMPARE_MARK = /\bcompar\w+\s+(?:to|with)\b|\bversus\b|\bvs\.?\s|\blast\s+year\b|\bprior[-\s]year\b|\byear[-\s]ago\b/i;
const GROWTH_WORD = /\b(growth|grow|increases?|increased|declines?|decreases?|decreased|change|up|down|higher|lower|expansion)\b/i;
/** "Flat to up 1.5%" states a range one of whose ends is a word. Reading the
 *  number alone turns Petco's "flat to up 1.5%" into a 1.5% guide. */
const WORDED_END = /\bflat\s+(?:to|-)|\bto\s+(?:up|down|flat)\b|\bapproximately\s+flat\b/i;

const clean = (w: string) => w.replace(/^[^A-Za-z0-9$'-]+/, '').replace(/[^A-Za-z0-9'%-]+$/, '').toLowerCase();
const isNumberish = (w: string) =>
  /^[($]?[\d,.]+%?\)?$/.test(w) || /^(?:19|20)\d{2}$/.test(w) || /^'\d{2}$/.test(w)
  || /^(?:fy|q[1-4]fy?)'?\d{0,4}$/.test(w);

/** True when every word in `prefix` may stand in front of a metric label. One
 *  unknown capitalised token is allowed: it is the filer's own name
 *  ("HPE estimates revenue…", "Planet expects revenue…"). */
function anchorOk(prefix: string): boolean {
  const p = prefix.replace(/^[\s•·▪▸○*–—-]+/, '').replace(/\((?:\d{1,2}|[a-z])\)/g, ' ').trim();
  if (!p) return true;
  if (p.length > 95) return false;
  const words = p.split(/\s+/);
  if (words.length > 15) return false;
  let proper = 0;
  for (const raw of words) {
    const w = clean(raw);
    if (!w) continue;
    if (PREFIX_OK.has(w) || isNumberish(w)) continue;
    if (/^[A-Z]/.test(raw.replace(/^[^A-Za-z]+/, '')) && proper === 0) { proper++; continue; }
    return false;
  }
  return true;
}

/** True when nothing but a connector stands between a label and its number. */
function gapOk(gap: string): boolean {
  const g = gap.replace(/\((?:\d{1,2}|[a-z])\)/g, ' ').replace(/[*†‡]/g, ' ').trim();
  if (!g) return true;
  if (g.length > 110) return false;
  const words = g.split(/\s+/);
  if (words.length > 18) return false;
  for (const raw of words) {
    const w = clean(raw);
    if (!w) continue;
    if (GAP_OK.has(w) || isNumberish(w)) continue;
    return false;
  }
  return true;
}

// ─── numeric tokens ─────────────────────────────────────────────────────────
interface Tok { v: number; raw: number; mult: number; worded: boolean; unit: Unit; at: number; end: number; }

function tokens(s: string, scale: number | null, perShare: boolean): Tok[] {
  const out: Tok[] = [];
  const re = /(\(\s*)?\$?\s*(\(\s*)?(-|−|–|—)?\s*(\d[\d,]*(?:\.\d+)?)\s*(\))?\s*(?:([BMK])\b)?\s*(billion|million|thousand|%)?/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(s)) && guard++ < 60) {
    const raw = m[4].replace(/,/g, '');
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) continue;
    const openParen = !!(m[1] || m[2]);
    // "24.3% - 25.3%" is a range, not a negative: a dash that FOLLOWS a number,
    // a percent sign or a closing bracket is a separator.
    let signIsMinus = !!m[3];
    if (signIsMinus) {
      const before = s.slice(0, m.index + m[0].indexOf(m[3]!)).replace(/[\s$]+$/, '');
      if (/[\d%)]$/.test(before)) signIsMinus = false;
    }
    const neg = signIsMinus || (openParen && !!m[5]);
    // Ciena writes "$1.75B billion"; a lone "$1.2B" means the same thing.
    const letter = m[6] ? { B: 'billion', M: 'million', K: 'thousand' }[m[6].toUpperCase() as 'B'] : '';
    const word = (m[7] || letter || '').toLowerCase();
    const dollar = /\$/.test(m[0]);
    let unit: Unit;
    let mult = 1;
    if (word === '%') unit = 'pct';
    else if (word) { unit = 'usd'; mult = MULT[word]; v *= mult; }
    else if (perShare && dollar) unit = 'usd_share';
    else if (dollar && scale) { unit = 'usd'; mult = scale; v *= scale; }
    else if (dollar) unit = 'usd_share';
    else unit = null as unknown as Unit;             // a bare number: decided below
    const digitsAt = m.index + m[0].indexOf(m[4]);
    // A RANGE END INHERITS THE CURRENCY OF THE END THAT OPENED IT.
    //
    // The mirror image of the "trailing scale word governs both ends" rule two
    // functions down, and it is what a filer's own typography means. SentinelOne
    // (ticker S, Q2 FY27, 8-K of 27 Aug 2026) prints its per-share guidance row
    // as the cells "$0.08 - 0.09" and "$0.30 - 0.32": the dollar sign is written
    // ONCE, on the low end, exactly as "$309 - 311 million" writes its scale word
    // once, on the high end. Without this rule the high end of a per-share range
    // is not a token at all — there is no "$" and no "million" to give it a
    // unit — so the range collapsed to two lone points, the point rule refused
    // them (correctly: two bare numbers under one label prove nothing), and the
    // EPS guide vanished from the card while revenue and operating income, whose
    // high ends carry the scale word, came through. The one metric on which
    // SentinelOne guided BELOW the street was therefore the one metric the card
    // could not show. Nothing here is company-specific: a bare number is adopted
    // only when a range connector joins it directly to a $-marked number on its
    // left, and it takes that number's unit and scale and nothing else.
    if (unit == null) {
      const prev = out[out.length - 1];
      const join = prev && prev.end <= digitsAt ? s.slice(prev.end, digitsAt) : null;
      if (prev && join != null && /^\s*(?:to|and|through|or|-|–|—|−)\s*$/i.test(join)) {
        unit = prev.unit;
        if (prev.unit !== 'pct') { mult = prev.mult; v *= prev.mult; }
      } else continue;                               // a year, a store count, a share count
    }
    out.push({ v: neg ? -v : v, raw: neg ? -parseFloat(raw) : parseFloat(raw), mult, worded: !!word && word !== '%', unit, at: digitsAt, end: m.index + m[0].length });
  }
  return out;
}

interface Rng { lo: number; hi: number; unit: Unit; at: number; }

/** Ranges ("A to B"), plus-or-minus bands and single points, in document order. */
function ranges(s: string, toks: Tok[]): Rng[] {
  const out: Rng[] = [];
  let i = 0;
  while (i < toks.length) {
    const a = toks[i], b = toks[i + 1];
    // Ciena and Marvell guide as a MIDPOINT with a tolerance: "$1.75 billion
    // +/- $50 million", "$3.15 billion +/- 5%". That is a range, and reading
    // only the midpoint (or, worse, pairing the two numbers) loses the band.
    if (b && /^\s*(?:\+\/-|\+-|±|plus\s+or\s+minus)\s*\$?\s*$/i.test(s.slice(a.end, b.at))) {
      const delta = b.unit === 'pct' && a.unit !== 'pct' ? Math.abs(a.v) * (b.v / 100) : Math.abs(b.v);
      out.push({ lo: a.v - delta, hi: a.v + delta, unit: a.unit, at: a.at });
      i += 2;
      continue;
    }
    const byIncrease = /\bby\s*[$]?\s*$/i.test(s.slice(Math.max(0, a.at - 12), a.at));
    const joined = !byIncrease && !!b && /^\s*(?:to|-|–|—|and|through)\s*[$+(]*\s*$/i.test(s.slice(a.end, b.at));
    if (joined && b) {
      // "$3 and $10 million", "$2.928 to $2.941 billion": one scale word at the
      // end governs both ends of the range. Planet's adjusted-EBITDA guide came
      // out as a $10M point because the low end read as a per-share dollar.
      let av = a.v, au = a.unit;
      if (!a.worded && b.worded && a.unit !== 'pct' && b.unit === 'usd') { av = a.raw * b.mult; au = 'usd'; }
      if (au === b.unit) {
        // "$(34.5) - $(42.5)" is a loss range written widest-last.
        const lo = Math.min(av, b.v), hi = Math.max(av, b.v);
        if (b.v >= av || (av < 0 && b.v < 0)) { out.push({ lo, hi, unit: au, at: a.at }); i += 2; continue; }
      }
    }
    out.push({ lo: a.v, hi: a.v, unit: a.unit, at: a.at });
    i += 1;
  }
  return out;
}

function sane(metric: GuideMetric, unit: Unit, lo: number, hi: number): boolean {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return false;
  if (NATURAL[metric] === 'pct') return unit === 'pct' && Math.abs(lo) <= 200 && Math.abs(hi) <= 200;
  if (metric === 'eps') return unit === 'usd_share' && Math.abs(lo) < 1000 && Math.abs(hi) < 1000;
  if (unit === 'usd_share') return false;
  if (unit === 'pct') return Math.abs(lo) <= 200 && Math.abs(hi) <= 200;   // "revenue growth of 6% to 8%"
  if (lo > 0 && hi / lo > 4) return false;                                  // a guidance band is never 8x wide
  return unit === 'usd' && Math.abs(hi) >= 1e4 && Math.abs(hi) <= 2e12;
}

// ─── label hits ─────────────────────────────────────────────────────────────
interface Hit { id: GuideMetric; at: number; end: number; }

/** Every metric label in a clause, in reading order, higher-priority labels
 *  winning any overlap ("net income per share" is EPS, not net income). */
function labelHits(s: string): Hit[] {
  const kept: Array<Hit & { prio: number }> = [];
  for (let p = 0; p < SPECS.length; p++) {
    const re = SPEC_G[p];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(s)) && guard++ < 10) {
      if (m.index === re.lastIndex) re.lastIndex++;
      const at = m.index, end = m.index + m[0].length;
      if (kept.some((k) => at < k.end && k.at < end)) continue;
      kept.push({ id: SPECS[p].id, at, end, prio: p });
    }
  }
  kept.sort((a, b) => a.at - b.at);
  return kept.map(({ id, at, end }) => ({ id, at, end }));
}

/** Revenue that belongs to a slice of the company is not the company's revenue
 *  guide. Subscription and product revenue are metrics in their own right; a
 *  segment's ("AI-Optimized Servers revenue", "revenue from the IDS segment")
 *  is dropped, because a card cannot say whose it is. */
const REV_QUALIFIER_OK = new Set([
  'total', 'net', 'consolidated', 'company', "company's", 'gaap', 'non-gaap', 'nongaap', 'adjusted',
  'reported', 'core', 'the', 'a', 'an', 'our', 'its', 'their', 'in', 'of', 'for', 'and', 'or', 'to',
  'is', 'are', 'be', 'we', 'expects', 'expect', 'expected', 'sees', 'estimates', 'anticipates',
  'projects', 'guidance', 'outlook', 'raising', 'raises', 'now', 'full', 'year', 'full-year',
  'fiscal', 'quarter', 'first', 'second', 'third', 'fourth', 'record', 'approximately', 'that', 'which',
]);
const REV_SUBSET = /\bsegment\b|\bdivision\b|\bbusiness\b|\bgroup\b/i;

function revenueKind(clause: string, hit: Hit): GuideMetric | null {
  if (REV_SUBSET.test(clause.slice(hit.end, hit.end + 28))) return null;
  const w = clean(clause.slice(Math.max(0, hit.at - 30), hit.at).trim().split(/\s+/).pop() || '');
  if (w === 'subscription') return 'subscription_revenue';
  if (w === 'product') return 'product_revenue';
  // The word in front of "revenue" either belongs to the sentence (a verb, an
  // article, the filer's own name) or qualifies the figure — and a qualifier is
  // a segment, a channel or a brand, whose revenue is not the company's.
  return !w || REV_QUALIFIER_OK.has(w) || PREFIX_OK.has(w) || isNumberish(w) ? 'revenue' : null;
}

// ─── line shaping ───────────────────────────────────────────────────────────
const CELL_WORD = /^(?:to|and|through|or|approximately|approx|about|na|nm|million|billion|thousand|bps|pts?|flat|up|down|year|over)$/i;
/** A flattened table cell: numbers, currency, a range word — never a label. */
function isCell(s: string): boolean {
  if (!s || s.length > 46) return false;
  const words = s.split(/\s+/);
  if (words.length > 12) return false;
  return words.every((w) => /^[$()%*†‡,.~\d+–—−-]+$/.test(w) || CELL_WORD.test(w.replace(/[.,:]+$/, '')));
}
/** The shared htmlToText decodes only the decimal entities, so a bullet can
 *  still arrive as "&#x2022;" and become the first "word" of a row label —
 *  which then fails the anchor test and takes Netskope's revenue guide with it. */
function unentity(s: string): string {
  if (s.indexOf('&#') < 0) return s;
  return s.replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => {
    const c = parseInt(h, 16);
    if (c === 0x2019 || c === 0x2018) return "'";
    if (c === 0x201c || c === 0x201d) return '"';
    if (c === 0x2013 || c === 0x2014 || c === 0x2212) return '-';
    return ' ';
  }).replace(/&#\d+;/g, ' ');
}
const DANGLING = /\b(?:of|to|be|is|are|in|the|a|an|and|or|between|from|approximately|about|at|for|with|than|fiscal|year|quarter|ending|ended|up|down|on|per|range)$|[,\-–—$]$/i;

/**
 * Press-release HTML wraps prose at a fixed width, so one sentence arrives as
 * three lines and "…is expected to be between $181.0 million" / "and $185.0
 * million" reads as a point. Put such lines back together — but only when the
 * break is unmistakably mid-sentence, or a table row would be swallowed.
 */
function unwrap(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i];
    let joins = 0;
    while (joins < 2 && i + 1 < lines.length) {
      const nxt = lines[i + 1];
      if (cur.length < 25 || /[.!?:;]$/.test(cur) || !nxt || nxt.length < 4) break;
      const startsLower = /^[a-z]/.test(nxt);
      const dangles = DANGLING.test(cur);
      if (!startsLower && !dangles) break;
      if (!startsLower && !/^[\d($]/.test(nxt)) break;
      // A cell line belongs to the table row above it, not to this sentence —
      // unless this sentence broke in the middle of the number itself
      // ("…expected to be between 59.0% and" / "60.0%").
      if (isCell(nxt) && !(dangles && /\d/.test(cur))) break;
      cur = `${cur} ${nxt}`;
      i++; joins++;
    }
    out.push(cur);
  }
  return out;
}

interface Clause { text: string; line: number; }

/** One line can carry two guides ("…net sales of $200M to $210M, and we are
 *  increasing our Adjusted EBITDA guidance to $14.5M to $17.5M"), and each
 *  needs its own anchor test. */
function clausesOf(line: string, idx: number): Clause[] {
  const out: Clause[] = [];
  const sentences = line.length > 110 ? line.split(/(?<=[.;])\s+(?=[A-Z“"(])/) : [line];
  for (const s0 of sentences) {
    const s = s0.trim();
    if (!s) continue;
    if (s.length <= 80) { out.push({ text: s, line: idx }); continue; }
    for (const c of s.split(/;\s+|,\s+(?=(?:while|and|of\s+which|which|including|with|driven\s+by)\b)/i)) {
      const t = c.trim();
      if (t) out.push({ text: t, line: idx });
    }
  }
  return out;
}

// ─── period parsing ─────────────────────────────────────────────────────────
interface Period { kind: GuidePeriod; label: string; }
const qLabel = (n: number, fy?: string | null) => `Q${n}${fy ? ` FY${String(fy).slice(-2)}` : ''}`;
const fyLabel = (y: string) => `FY${String(y).slice(-2)}`;

interface PeriodCtx { fyEndMonth: number | null; fyMentions: Set<string>; }

/**
 * The period a heading, sub-heading or column header names. Returns null when
 * it names two ("Third Quarter and Fiscal 2026 Outlook") — that heading only
 * opens the section, and the sub-headings under it set the period.
 */
function periodOf(l: string, ctx: PeriodCtx, prev: Period | null): Period | null {
  const bare = BARE_YEAR_HEAD.exec(l);
  const q = QTR_HEAD.exec(l);
  // "full year fiscal 2027" — take the fiscal year wherever it sits in the
  // heading, then fall back to an unnumbered "full year".
  const fyNum = /\b(?:fiscal(?:\s+year)?|fy)\s*'?(\d{4})\b/i.exec(l) || FY_SHORT.exec(l);
  const y = fyNum || YEAR_HEAD.exec(l);
  if (bare && !q) return { kind: 'year', label: fyLabel(bare[1]) };
  if (q && y && /and/i.test(l.slice(Math.min(q.index, y.index), Math.max(q.index, y.index) + 12))) return null;
  // "…reported financial results for its third quarter of fiscal year 2026 …
  // provided guidance for its fourth quarter of fiscal year 2026": a line that
  // names two quarters names neither for our purposes.
  if (q && (l.match(/\b(?:first|second|third|fourth)[-\s]+(?:fiscal\s+)?quarter/gi) || []).length > 1) return null;
  if (q) {
    const n = { first: 1, second: 2, third: 3, fourth: 4 }[q[1].toLowerCase() as 'first'];
    // The fiscal year can sit either side of the quarter word ("Fiscal 2026
    // Fourth Quarter Outlook", "Fourth Quarter Fiscal 2026").
    let fy = q[3] || q[2] || q[4] || (fyNum ? fyNum[1] : null);
    const prevLabel = prev?.label || '';
    if (!fy && prev?.kind === 'quarter' && prevLabel.startsWith(`Q${n} FY`)) fy = `20${prevLabel.slice(-2)}`;
    return { kind: 'quarter', label: qLabel(n, fy) };
  }
  // "Q3 FY 2027 Guidance", "Q3FY27" — the shape a column header uses.
  const qs = QTR_SHORT.exec(l);
  if (qs && (qs[2] || fyNum)) return { kind: 'quarter', label: qLabel(parseInt(qs[1], 10), qs[2] || fyNum![1]) };
  if (qs && /guidance|outlook/i.test(l)) return { kind: 'quarter', label: qLabel(parseInt(qs[1], 10)) };
  if (y && y[1]) return { kind: 'year', label: fyLabel(y[1]) };
  // Dated headers ("Year Ended January 31, 2027", "for the fiscal year ending
  // January 31, 2027"). The fiscal-year LABEL is taken from the date only when
  // the document itself uses that label — a January-ending retailer calls the
  // year ending Jan 2027 "fiscal 2026", and would never be told otherwise here.
  const dy = DATED_YEAR.exec(l);
  if (dy) {
    const lab = fyLabel(dy[3]);
    return ctx.fyMentions.has(lab) ? { kind: 'year', label: lab } : { kind: 'year', label: 'full year' };
  }
  if (y) return { kind: 'year', label: 'full year' };
  const dq = DATED_QTR.exec(l);
  if (dq && ctx.fyEndMonth != null) {
    const mi = MONTHS.indexOf(dq[1].toLowerCase());
    if (mi < 0) return null;
    const endYear = parseInt(dq[3], 10);
    // Which quarter of the fiscal year ends on this date?
    for (const fyEndYear of [endYear, endYear + 1]) {
      const diff = (fyEndYear - endYear) * 12 + (ctx.fyEndMonth - (mi + 1));
      if (diff % 3 === 0 && diff >= 0 && diff <= 9) {
        const n = 4 - diff / 3;
        const lab = fyLabel(String(fyEndYear));
        return { kind: 'quarter', label: qLabel(n, ctx.fyMentions.has(lab) ? String(fyEndYear) : null) };
      }
    }
  }
  return null;
}

/** A column header that is nothing but a quarter takes its fiscal year from the
 *  header SPANNING the table above it. Salesforce heads its per-share
 *  reconciliation "Fiscal 2027 | Q2 | FY27": read on its own the "Q2" column
 *  names no period at all, and the table then had no columns to bind to. */
const BARE_QTR = /^[\s(]*(?:q\s*([1-4])|(first|second|third|fourth)[-\s]+quarter)[\s)]*$/i;
function bareQuarterUnder(line: string, span: Period | null): Period | null {
  const fy = span ? /FY(\d{2})/.exec(span.label) : null;
  if (!fy) return null;
  const m = BARE_QTR.exec(line);
  if (!m) return null;
  const n = m[1] ? parseInt(m[1], 10) : { first: 1, second: 2, third: 3, fourth: 4 }[m[2].toLowerCase() as 'first'];
  return { kind: 'quarter', label: qLabel(n, `20${fy[1]}`) };
}
/** The fiscal year a period label names, for ordering a table's columns. */
const labelFy = (lab: string): number | null => { const m = /FY(\d{2})/.exec(lab); return m ? parseInt(m[1], 10) : null; };

/** The period a guidance CLAUSE names for itself, when it names one before its
 *  first number — Genesco's quote says "full-year adjusted EPS outlook" while
 *  sitting under a "Second Quarter Fiscal 2027" heading. */
function clausePeriod(clause: string, ctx: PeriodCtx, prev: Period | null): Period | null {
  // A press-release lede names the quarter it reports AND the quarter it guides
  // ("…reported financial results for its third quarter of fiscal year 2026 …
  // provided guidance for its fourth quarter of fiscal year 2026"); a paragraph
  // that long is not a period header either way.
  if (clause.length > 240) return null;
  const firstNum = clause.search(/[$(]?\d/);
  let head = firstNum > 0 ? clause.slice(0, firstNum + 6) : clause;
  // A fiscal year IS a number, so a head cut six characters past the first digit
  // can end inside the period phrase: HP's "For the fiscal 2026 fourth quarter,
  // HP estimates GAAP diluted net EPS to be in the range of $0.74 to $0.84" was
  // read as "fiscal 2026" alone and its Q4 guide came out labelled FY26. Let the
  // head run to the end of a quarter phrase that starts inside it.
  const qm = QTR_HEAD.exec(clause);
  if (qm && qm.index < head.length && qm.index + qm[0].length > head.length) head = clause.slice(0, qm.index + qm[0].length);
  if ((head.match(/\b(?:first|second|third|fourth)[-\s]+(?:fiscal\s+)?quarter/gi) || []).length > 1) return null;
  if (!/\b(full[- ]year|fiscal|fy\s*'?\d|first|second|third|fourth|q[1-4])\b/i.test(head)
    && !BARE_YEAR_HEAD.test(head)) return null;
  if (/\bcompar\w+\s+to\b|\bversus\b|\blast\s+year\b|\bprior\s+year\b/i.test(head)) return null;
  return periodOf(head, ctx, prev);
}

// ─── extraction ─────────────────────────────────────────────────────────────
/**
 * Guidance figures from the plain text of an earnings release (the same text
 * the guidance classifier reads).
 */
export function guidanceFiguresFromText(text: string): GuidanceFigure[] {
  if (!text || text.length > 4_000_000) return [];
  const lines = unwrap(text.split('\n').map((l) => unentity(l).replace(/\s+/g, ' ').trim()).filter(Boolean));

  // Fiscal-year labels the document itself uses, so a dated header is never
  // turned into a label the filer would not recognise.
  const ctx: PeriodCtx = { fyEndMonth: null, fyMentions: new Set<string>() };
  {
    const re = /\b(?:fiscal(?:\s+year)?|fy)\s*'?(\d{2,4})\b/gi;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 400) ctx.fyMentions.add(fyLabel(m[1].length === 2 ? `20${m[1]}` : m[1]));
    const fe = DATED_YEAR.exec(text);
    if (fe) { const mi = MONTHS.indexOf(fe[1].toLowerCase()); if (mi >= 0) ctx.fyEndMonth = mi + 1; }
  }

  const out: GuidanceFigure[] = [];
  const seen = new Map<string, number>();

  let zone = false;
  let period: Period | null = null;
  let periodCols: Period[] | null = null;
  let scale: number | null = null;
  let cols: 'gaap' | 'currprior' | 'prevfirst' | 'resultsguide' | null = null;
  let sinceHeading = 0;
  let sincePeriod = 0;
  let sinceLeadIn = 99;          // rows since a line that stated a forecast
  let colsUntil = -1;            // last line of a multi-period column header

  const clauses: Clause[] = [];
  for (let i = 0; i < lines.length; i++) for (const c of clausesOf(lines[i], i)) clauses.push(c);

  for (let ci = 0; ci < clauses.length; ci++) {
    const l = clauses[ci].text;
    const li = clauses[ci].line;
    const firstOfLine = ci === 0 || clauses[ci - 1].line !== li;
    const hasFigure = /[$%]\s*\d|\d\s*%/.test(l);

    if ((SECTION_OFF.test(l) || RESULTS_LINE.test(l)) && !SECTION_ON.test(l)) {
      zone = false; period = null; periodCols = null; cols = null; scale = null; continue;
    }
    // "Current Outlook" / "Prior Outlook" are COLUMN headers, not section
    // headings — treating them as headings wiped the period mid-table.
    const isColHeader = l.length < 40
      && (COL_CURRENT.test(l) || COL_PRIOR.test(l) || COL_PREV_BARE.test(l) || COL_UPD_BARE.test(l));
    const opensZone = SECTION_ON.test(l) && l.length < 200 && !isColHeader;
    if (opensZone) { zone = true; sinceHeading = 0; }
    else if (zone) {
      sinceHeading++;
      if (sinceHeading > 60) { zone = false; period = null; periodCols = null; cols = null; continue; }
    }
    if (!zone) continue;

    // ── which period this section guides ──────────────────────────────────
    // The lines of a two-column header are consumed as a group: a bare
    // "Guidance" line between C3.ai's two period headers used to wipe both.
    if (li > colsUntil) {
      // A HEADING names the period. A sentence that already carries the numbers
      // is the guidance itself, not a heading — American Outdoor's "…maintaining
      // our full-year guidance for net sales of $200 million to $210 million…"
      // relabelled a stated FY27 section "full year".
      // "FY26 Results" names the column beside the guide, not the period the
      // section guides — Campbell's whole outlook came out labelled FY26.
      const headerish = !hasFigure && !COL_RESULTS.test(l) && (l.length < 70 || opensZone);
      let p: Period | null = headerish ? periodOf(l, ctx, period) : null;
      let stated = false;
      if (!p) {
        // Ciena states its guide and its period in one bulleted sentence, and
        // Planet changes period mid-paragraph ("For the full fiscal year 2027,
        // Planet expects…"). Such a clause may only REPLACE a period already set
        // when it names a fiscal year — a bare "full-year" inside a sentence is
        // how the AOUT mislabel happened.
        const cp = clausePeriod(l, ctx, period);
        if (cp && (!period || /FY\d{2}/.test(cp.label))) { p = cp; stated = true; }
      }
      // An unspecific "…outlook for the balance of the fiscal year" must not
      // overwrite the fiscal year the section already named: Ollie's outlook
      // table sits three sentences below "for the fiscal year 2026".
      if (p && period && p.kind === period.kind && !/FY\d{2}/.test(p.label) && /FY\d{2}/.test(period.label)) p = null;
      if (p) {
        period = p; sincePeriod = 0; periodCols = null; sinceLeadIn = 99;
        // Two adjacent period headers are two COLUMNS: C3.ai prints "Second
        // Quarter Fiscal 2027 Guidance" beside "Full Year Fiscal 2027
        // Guidance", and the row beneath carries one range for each.
        if (!stated && firstOfLine) {
          let found = [p];
          let last = li;
          for (let k = 1; k <= 4 && li + k < lines.length; k++) {
            const nx = lines[li + k];
            if (nx.length > 70 || /[$%]\s*\d|\d\s*%/.test(nx) || labelHits(nx).length) break;
            // Every line down to the table's first row is header, whether it
            // names a period or not. SentinelOne and CrowdStrike break each
            // column header over two lines ("Q3 FY27" / "Guidance"), and the
            // trailing bare "Guidance" read as a NEW, period-less guidance
            // heading — which wiped the period and the columns, and took the
            // whole outlook table with them.
            last = li + k;
            const np = periodOf(nx, ctx, p) || bareQuarterUnder(nx, p);
            if (np) found.push(np);              // duplicates kept: see below
          }
          // A header that SPANS the table names the table, not a column, and
          // gives itself away by naming the same period as one of the columns
          // beneath it ("Fiscal 2027" over "Q2 | FY27"). Dropping it is what
          // puts the columns back in their true left-to-right order.
          if (found.length >= 3 && found.slice(1).some((f) => f.label === found[0].label)) found = found.slice(1);
          const labels = found.map((f) => f.label);
          const fys = labels.map(labelFy);
          // Columns never step BACK a fiscal year. "Q3 FY26 | Q3 FY25" heads a
          // year-over-year comparison of REPORTED results — HP prints one two
          // lines under an "outlook" bullet — and binding its rows positionally
          // publishes last year's actuals as this year's guide.
          const forward = fys.every((y, i) => y != null && (i === 0 || y >= fys[i - 1]!));
          // Only a header that names its fiscal year can be bound positionally:
          // PVH's "…full year revenue, operating margin and EPS outlook" sits
          // above "Full Year 2026 Guidance", and those are one period, not two.
          if (found.length >= 2 && forward && new Set(labels).size === labels.length) {
            periodCols = found;
            colsUntil = last;
            // These columns name PERIODS; whatever an earlier table said its
            // columns meant (GAAP | Non-GAAP, Prior | Current) does not apply
            // here, and Salesforce prints one such table directly after another.
            cols = null;
          }
        }
      } else if (opensZone && !hasFigure && l.length < 60) {
        // A new, short guidance heading that names no period must NOT inherit
        // the last one — that is how Ollie's full-year outlook table came out
        // labelled "Q2", from the quarter named in the results headline above.
        period = null; periodCols = null; cols = null;
      } else {
        sincePeriod++;
        // A period's table does not run for pages; past ~35 rows we are elsewhere.
        if (sincePeriod > 35) { period = null; periodCols = null; }
      }
    }

    const cap = CAPTION_SCALE.exec(l);
    if (cap) scale = MULT[cap[1].toLowerCase()];
    const nextLine = lines[li + 1] || '';
    if (COL_GAAP.test(l) && COL_NONGAAP.test(nextLine)) cols = 'gaap';
    // …but "Non-GAAP diluted EPS" is a ROW label that contains both words, and
    // reading it as a column header flipped Dell's two EPS columns.
    else if (/\bgaap\b/i.test(l.replace(/non-?gaap/gi, ' ')) && /non-?gaap/i.test(l) && l.length < 40) cols = 'gaap';
    else if (COL_CURRENT.test(l) && (COL_PRIOR.test(l) || COL_PRIOR.test(nextLine))) cols = 'currprior';
    else if (COL_CURRENT.test(l) && l.length < 40) cols = null;   // current only
    else if (l.length < 60 && COL_RESULTS.test(l) && COL_GUIDANCE.test(nextLine) && nextLine.length < 60) cols = 'resultsguide';
    else if (l.length < 90 && COL_PREV_BARE.test(l) && COL_UPD_BARE.test(l)) {
      cols = COL_PREV_BARE.exec(l)!.index < COL_UPD_BARE.exec(l)!.index ? 'prevfirst' : 'currprior';
    } else if (l.length < 60 && COL_PREV_BARE.test(l) && COL_UPD_BARE.test(nextLine) && nextLine.length < 60) {
      cols = 'prevfirst';
    } else if (l.length < 60 && COL_UPD_BARE.test(l) && COL_PREV_BARE.test(nextLine) && nextLine.length < 60) {
      cols = 'currprior';
    }

    // A line inside the zone that states a forecast and carries no figure is a
    // lead-in: the rows under it are its guidance.
    if (!hasFigure && (SECTION_ON.test(l) || FORWARD_VERB.test(l))) sinceLeadIn = 0;
    else sinceLeadIn++;

    if (!period) continue;
    // A constant-currency figure is a different basis of the same metric, and
    // Samsara prints one row of each; neither the card nor this parser can tell
    // them apart once the label is gone.
    if (/constant\s+currency/i.test(l)) continue;
    const hits = labelHits(l);
    if (!hits.length) continue;
    // RULE: the clause must OPEN with its metric. "Constant currency impact to
    // revenue guidance is $2 million…" is a footnote, not a guide.
    const lead = l.slice(0, hits[0].at);
    if (SKIP_PREFIX.test(lead) || !anchorOk(lead)) continue;

    const perShare = /per\s+(?:diluted\s+|common\s+)*share|\beps\b/i.test(l);
    const own = tokens(l, scale, perShare);

    // Numbers on the label line itself are only guidance when the line says so
    // ("Revenue is expected to be in the range of $105 million to $115 million"),
    // or when the row sits under a lead-in that did. The lead-in has to carry:
    // Sprinklr writes "Sprinklr is providing the following guidance for the
    // third fiscal quarter…" once and then four bare rows, of which only the
    // first is next to the sentence.
    const leadIn = sinceLeadIn <= 12;
    if (own.length && !FORWARD_VERB.test(l) && !leadIn) continue;

    // A table row flattens to a label line and one line per cell. Borrow those
    // cells — but never the next ROW, which is why the walk stops at any line
    // that carries a metric label of its own (PVH's outlook block is four such
    // rows in a row, and borrowing across them bound a margin to revenue).
    let valueText = l;
    let toks = own;
    let fromCells = false;
    // GitLab's EPS row explains its share count on the label line ("…assuming
    // approximately 172 million and 172 million weighted average shares"):
    // numbers that cannot be this metric do not make it a value line.
    const ownUseful = own.some((t) => t.unit === 'pct' || hits.some((h) => t.unit === NATURAL[h.id]));
    if (!own.length || !ownUseful) {
      const parts: string[] = [];
      for (let k = 1; k <= 10 && li + k < lines.length; k++) {
        const nx = lines[li + k];
        if (!isCell(nx) || labelHits(nx).length) break;
        parts.push(nx);
        if (tokens(parts.join(' '), scale, perShare).length >= 6) break;
      }
      if (!parts.length) { if (!own.length) continue; }
      else {
        valueText = parts.join(' ');
        toks = tokens(valueText, scale, perShare);
        fromCells = true;
      }
    }
    if (!toks.length) continue;

    const rs = ranges(valueText, toks);
    if (!rs.length) continue;
    const basisOf = (h: Hit): 'gaap' | 'adjusted' | null => {
      const w = l.slice(Math.max(0, h.at - 30), h.end);
      if (ADJ_NEAR.test(w)) return 'adjusted';
      return /\bgaap\b/i.test(w.replace(/non-?gaap/gi, ' ')) ? 'gaap' : null;
    };
    // Where each label's numbers stop: at the next label, or at the words that
    // start comparing rather than guiding.
    const emitFor = (h: Hit, hNext: Hit | undefined) => {
      let metric: GuideMetric | null = h.id;
      if (metric === 'revenue') metric = revenueKind(l, h);
      if (metric == null) return;
      const sliceStart = fromCells ? 0 : h.end;
      const sliceEnd = fromCells ? valueText.length : (hNext ? hNext.at : l.length);
      const rawSlice = valueText.slice(sliceStart, sliceEnd);
      const cutAt = fromCells ? -1 : rawSlice.search(CUT);
      const hardEnd = sliceStart + (cutAt >= 0 ? cutAt : rawSlice.length);
      const slice = valueText.slice(sliceStart, hardEnd);
      const priorAt = (() => { const m = PRIOR_MARK.exec(rawSlice); return m ? sliceStart + m.index : -1; })();

      const nat = NATURAL[metric];
      const inSlice = rs.filter((r) => r.at >= sliceStart && r.at < hardEnd);
      const priorSide = (r: Rng) => priorAt >= 0 && r.at > priorAt;
      let curr = inSlice.filter((r) => !priorSide(r) && sane(metric!, r.unit, r.lo, r.hi));
      let prior = inSlice.filter((r) => priorSide(r) && sane(metric!, r.unit, r.lo, r.hi));
      // "…now expected to be flat versus prior guidance of positive 1% to 2%":
      // the only range in the clause is the PRIOR one, so there is nothing to
      // print. Genesco's card said comps were guided to +1–2%.
      if (!curr.length) return;

      // Campbell's prints "FY26 Results | FY27 Guidance": the first column is
      // last year's actual — not prior guidance, and not the guide — and the
      // second is the percentage change between them.
      const growth = GROWTH_WORD.test(l.slice(Math.max(0, h.at - 30), h.at)) || GROWTH_WORD.test(slice)
        || (cols === 'resultsguide' && fromCells);
      if (cols === 'resultsguide' && fromCells && curr.length >= 2) curr = curr.slice(1);

      // The metric's own unit wins: "Non-GAAP income from operations of $215
      // million to $217 million, approximately 25% to 26% growth" is a dollar
      // guide, and the percentages restate it.
      const natural = curr.filter((r) => r.unit === nat);
      if (natural.length) curr = natural;
      else if (!growth || !curr.every((r) => r.unit === 'pct')) return;   // a % on a $ metric with nothing saying "growth"
      // "…total sales now down approximately 2%" is a guide to a FALL. The
      // direction is a word, and dropping it inverts the figure.
      if (curr[0].unit === 'pct' && nat !== 'pct' && curr[0].lo > 0
        && /\b(?:down|decline|decrease|lower|negative|fall)\w*\b/i.test(slice.slice(0, Math.max(0, curr[0].at - sliceStart)))) {
        curr = curr.map((r) => ({ ...r, lo: -r.hi, hi: -r.lo }));
      }
      prior = prior.filter((r) => r.unit === curr[0].unit);

      // The basis is stated in front of the label ("non-GAAP gross margin") or
      // behind its value ("…in a range of $11.80 to $12.10 on a non-GAAP
      // basis"); Credo puts one of each on a single line. A second metric in
      // the same clause that states no basis of its own takes the clause's:
      // in "Non-GAAP net income is expected to be between $97.0 million and
      // $101.0 million, or diluted earnings per share between $2.20 and $2.30"
      // the per-share figures are non-GAAP too.
      const basis = basisOf(h) || (/on\s+an?\s+(?:non-?gaap|adjusted)\s+basis|\((?:non-?gaap|adjusted)\)/i.test(slice)
        ? 'adjusted' : (basisOf(hits[0]) || 'gaap'));
      const put = (r: Rng, b: 'gaap' | 'adjusted', p: Period, pr?: Rng) => {
        const isPoint = r.lo === r.hi;
        if (isPoint) {
          // A RANGE WITH A WORDED END IS NEVER A POINT, PRIOR GUIDANCE OR NOT.
          //
          // The three tests below are relaxed when a PRIOR range is present,
          // because "…to X, up from Y" proves the clause is a guide. This one
          // is about something else — whether the number is the whole guide or
          // half of it — and relaxing it published a fabricated figure. Gap's
          // release reads "…now assumes Old Navy comparable sales of flat to
          // down 1%, compared with the prior range of flat to up 1%": both
          // ranges have a WORD at one end, "prior range" satisfied the
          // prior-guidance test, and the card printed a comps guide of +1% for
          // a company guiding comps DOWN as much as 1%. The sign was inverted
          // and the number was one end of a range. Tested first, for every
          // point, so no later relaxation can reach past it.
          if (WORDED_END.test(slice)) return;
          // A point may only stand when the clause holds exactly one number of
          // its unit AND states a forecast. Everything else is a range end, a
          // component, or a reported figure.
          if (!pr) {
            if (inSlice.filter((x) => x.unit === r.unit && sane(metric!, x.unit, x.lo, x.hi)).length > 1) return;
            if (!FORWARD_VERB.test(l) && !leadIn && !fromCells) return;
            if (POINT_PAST.test(l) && !fromCells) return;
          }
        }
        const key = `${metric}|${p.label}|${b}`;
        const idx = seen.get(key);
        if (idx != null) {
          const cur = out[idx];
          const better = (cur.low === cur.high && r.lo !== r.hi) || (cur.prior_low == null && !!pr);
          if (!better) return;
          out.splice(idx, 1);
          seen.forEach((v, k) => { if (v > idx) seen.set(k, v - 1); });
          seen.delete(key);
        }
        seen.set(key, out.length);
        out.push({
          metric: metric!, basis: b, period: p.kind, period_label: p.label,
          low: r.lo, high: r.hi, unit: r.unit,
          prior_low: pr ? pr.lo : null, prior_high: pr ? pr.hi : null,
          raised: pr ? (r.lo > pr.lo || r.hi > pr.hi) : null,
          source: `${l}${valueText === l ? '' : ' ' + valueText}`.slice(0, 240),
        });
      };

      // A clause that names its own period outranks the section it sits in:
      // Genesco's CFO quote says "full-year adjusted EPS outlook" under a
      // "Second Quarter Fiscal 2027" heading, and the guide is the year's.
      const said = fromCells ? null : clausePeriod(l, ctx, period);
      const bound = said && said.kind !== period!.kind ? said : period!;

      if (prior.length && curr.length) { put(curr[0], basis, bound, prior[0]); return; }
      // COLUMNS. Two figures on a row of table cells are two COLUMNS, and the
      // row may only be read once something has said what those columns are.
      if (curr.length >= 2 && periodCols && fromCells) {
        if (curr.length !== periodCols.length) return;            // mapping unclear → nothing
        for (let k = 0; k < curr.length; k++) put(curr[k], basis, periodCols[k]);
        return;
      }
      if (curr.length >= 2 && fromCells && curr[0].unit === curr[1].unit) {
        if (cols === 'gaap') { put(curr[0], 'gaap', bound); put(curr[1], 'adjusted', bound); return; }
        if (cols === 'prevfirst') { put(curr[1], basis, bound, curr[0]); return; }
        if (cols === 'currprior') { put(curr[0], basis, bound, curr[1]); return; }
      }
      // …and when nothing has, the row states nothing this parser can prove.
      // Keeping the FIRST cell and stamping it with the section's period is a
      // guess dressed as a fact: Salesforce's non-GAAP EPS row flattens to
      // "$3.25 - $3.27  $14.06 - $14.12" under a "Q2 | FY27" header, and the
      // first cell came out as an FY27 guide of $3.25 — the Q2 number, against
      // a true FY27 guide of $14.06 - $14.12. Refuse the row instead.
      if (curr.length >= 2 && fromCells) return;
      put(curr[0], basis, bound);
    };

    for (let hi2 = 0; hi2 < hits.length; hi2++) {
      const h = hits[hi2];
      // "…between $1.47 and $1.27 in the third quarter of fiscal 2026 compared
      // to a net loss per share of $4.28 in the third quarter of fiscal 2025":
      // past a comparison the numbers are last year's, whatever the label says.
      if (hi2 > 0 && COMPARE_MARK.test(l.slice(hits[hi2 - 1].end, h.at))) break;
      // Only the first label may open the clause; a later one still has to be
      // reached through a connector, which is checked with its own numbers.
      const firstRange = rs.find((r) => r.at >= (fromCells ? 0 : h.end) && (fromCells || !hits[hi2 + 1] || r.at < hits[hi2 + 1].at));
      if (!firstRange) continue;
      const gap = fromCells ? valueText.slice(0, firstRange.at) : l.slice(h.end, firstRange.at);
      if (!gapOk(gap)) continue;
      emitFor(h, hits[hi2 + 1]);
      if (fromCells) break;                        // the cells belong to the row's label
    }
  }

  // "full year" and "FY26" are the same period stated two ways; when a document
  // uses both, keep one label so the card does not print the guide twice.
  const fyLabels = Array.from(new Set(out.filter((f) => /^FY\d{2}$/.test(f.period_label)).map((f) => f.period_label)));
  if (fyLabels.length === 1) {
    for (const f of out) {
      if (f.period_label === 'full year') f.period_label = fyLabels[0];
      // A quarter guided in the same release belongs to the same fiscal year;
      // Sprinklr and lululemon name the quarter by its end date alone.
      if (f.period === 'quarter' && /^Q[1-4]$/.test(f.period_label)) f.period_label = `${f.period_label} ${fyLabels[0]}`;
    }
  }
  // A point under a quarter label with no fiscal year is the shakiest thing this
  // parser can produce — HPE's reported "$1.06" sat under one. Ranges from such
  // a section are fine; single numbers are not. Tested here, after the labels
  // have inherited the document's fiscal year, or Sprinklr's "Q3" would lose
  // its per-share guide for want of two characters.
  const solid = out.filter((f) => !(f.low === f.high && f.prior_low == null
    && f.period === 'quarter' && !/FY\d{2}$/.test(f.period_label)));
  out.length = 0; out.push(...solid);
  {
    const kept = new Map<string, GuidanceFigure>();
    for (const f of out) {
      const k = `${f.metric}|${f.period_label}|${f.basis}`;
      const prev = kept.get(k);
      if (!prev || (prev.low === prev.high && f.low !== f.high) || (prev.prior_low == null && f.prior_low != null)) kept.set(k, f);
    }
    out.length = 0; out.push(...Array.from(kept.values()));
  }
  const mOrder: GuideMetric[] = ['revenue', 'product_revenue', 'subscription_revenue', 'eps', 'ebitda',
    'operating_income', 'operating_margin', 'net_income', 'comparable_sales', 'gross_margin', 'free_cash_flow'];
  out.sort((a, b) =>
    (a.period === b.period ? 0 : a.period === 'year' ? -1 : 1) ||
    (mOrder.indexOf(a.metric) - mOrder.indexOf(b.metric)) ||
    (a.basis === b.basis ? 0 : a.basis === 'adjusted' ? -1 : 1));
  return out.slice(0, 12);
}

/** "$5.63B–$5.71B", "$9.83–$10.31", "+10% to +12%" */
export function fmtGuideRange(g: { low: number | null; high: number | null; unit: GuidanceFigure['unit'] }): string {
  if (g.low == null || g.high == null) return '—';
  // A narrow band must not collapse to the same string on both sides.
  const narrow = g.low !== g.high && Math.abs(g.high - g.low) / Math.max(1e-9, Math.abs(g.high)) < 0.01;
  const one = (v: number): string => {
    if (g.unit === 'pct') return `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;
    if (g.unit === 'usd_share') return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
    const a = Math.abs(v);
    const body = a >= 1e12 ? `$${(a / 1e12).toFixed(narrow ? 3 : 2)}T`
      : a >= 1e9 ? `$${(a / 1e9).toFixed(narrow ? 3 : 2)}B`
      : a >= 1e6 ? `$${(a / 1e6).toFixed(narrow ? 1 : a >= 1e8 ? 0 : 1)}M`
      : `$${Math.round(a).toLocaleString()}`;
    return v < 0 ? `-${body}` : body;
  };
  if (g.low === g.high) return one(g.low);
  // AN EN-DASH CANNOT SEPARATE TWO SIGNED NUMBERS.
  //
  // Titan Machinery guided to an adjusted LOSS of $1.75 to $1.25 a share and
  // the card printed "-$1.75–-$1.25", where the dash between the two ends is
  // indistinguishable from the minus signs on either side of it. The same is
  // true of a percentage range, whose ends always carry a sign: "+10%–+12%".
  // Whenever either end renders with a leading sign, the two are joined with
  // the word instead — "-$1.75 to -$1.25", "+10% to +12%" — which is how the
  // filers themselves write a negative range and reads correctly wherever the
  // range straddles zero as well.
  const lo = one(g.low), hi = one(g.high);
  const signed = /^[-+−]/.test(lo) || /^[-+−]/.test(hi);
  return signed ? `${lo} to ${hi}` : `${lo}–${hi}`;
}

export const GUIDE_METRIC_LABEL: Record<GuideMetric, string> = {
  revenue: 'Revenue', product_revenue: 'Product revenue', subscription_revenue: 'Subscription revenue',
  eps: 'EPS', operating_income: 'Operating income',
  operating_margin: 'Operating margin', net_income: 'Net income',
  comparable_sales: 'Comparable sales', gross_margin: 'Gross margin',
  free_cash_flow: 'Free cash flow', ebitda: 'EBITDA',
};
