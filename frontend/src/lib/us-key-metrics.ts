// ═══════════════════════════════════════════════════════════════════════════
// KEY OPERATING METRICS (pure) — the second row of numbers on an earnings card.
//
// WHY. Revenue and EPS are the headline, but they are not what moves a software
// or a hardware name on print day. The feeds print a second row, and it is the
// one the desk reads first:
//
//     SNOW  Q2 FY27
//       RPO   $9.00B  (+30% YoY)
//       NRR   126%
//       FCF   $83.8M
//
// Every one of those sits in the press release, in a highlights bullet or a
// small table, and none of them is in XBRL on print day. lib/us-pr-financials
// reads the income statement (and validates each row against the year-ago XBRL
// figure); lib/us-guidance-figures reads the OUTLOOK ranges. This module reads
// what is left: the REPORTED operating metrics — ARR, net new ARR, RPO, cRPO,
// net revenue retention, backlog, adjusted EBITDA, free cash flow, subscription
// revenue, $100K+ customers, comparable sales, and the non-GAAP margins the
// company itself quoted.
//
// There is no cross-check available for these — no prior-year XBRL column to
// reproduce, no range shape to validate. So the whole design is refusal:
//
//   • ANCHORED LABELS. A metric is read only when its label — or, for the
//     "$753.1 million in Remaining Performance Obligations" shape, its value —
//     starts the line or the clause, after a short run of harmless words ("Q2",
//     "Second quarter", "Ending", "Total", "and", "while"). Samsara's release
//     says "Customers with ARR over $1,000,000 generated over $500 million of
//     ARR" — an unanchored "ARR … $1,000,000" reads as an ARR of one million
//     dollars, and "$500 million of ARR" as an ARR of half a billion. Both are
//     catastrophic and both are killed by requiring the clause to open with the
//     metric. The one exception is a PERCENTAGE: a dollar amount beside a label
//     can belong to a subset of it, but "comparable sales increased by 14.1%"
//     means one thing wherever it sits, so a percentage may be read from mid
//     sentence when its label is adjacent and nothing disqualifying ("compared
//     to", "guidance", "we define") stands in front of it. Five Below's only
//     reported comp is exactly that: mid-sentence, behind a semicolon the
//     shared htmlToText deletes.
//   • ADJACENCY. Between the label and the number there may be a connector
//     ("of", "was", "totaled", ": ") or a growth clause ("grew 16% YoY to"),
//     nothing else. "Free cash flow represents net cash from operating
//     activities…" is a definition, not a figure.
//   • NOTHING FORWARD-LOOKING. Guidance uses the same row labels as results —
//     Zscaler's outlook says "ARR of $4.396 billion to $4.426 billion" nine
//     lines below the reported "ARR … $3,771 million". Any line carrying a
//     forward verb is dropped, AND so is every line inside an outlook/guidance
//     section, because a guidance table's rows carry no verb at all
//     (Snowflake's "Non-GAAP operating margin 2 of 15.5%" is a forecast).
//   • UNITS ARE NEVER GUESSED. "$X million/billion" carries its own scale; a
//     bare "$X" is only usable when the table declared "(in thousands)" or
//     "(in millions)"; "NN%" is a percentage; a bare integer is a count and is
//     accepted for exactly one metric. Anything else is dropped. Ciena labels
//     the rows of its quarterly table just "Gross margin" and puts GAAP and
//     non-GAAP side by side, so the basis comes from the column header the same
//     way the scale comes from the caption — never from a guess.
//   • YoY ONLY FROM THE SAME STATEMENT. A change is reported only when the
//     clause that carries the value also states it. Zscaler's +24% net new ARR
//     growth is in the CFO quote, three lines from the $246 million — so this
//     module prints the value with no change rather than joining two sentences.
//
// Anything that fails a rule is dropped silently: one wrong metric on a card
// costs more than ten missing ones.
// ═══════════════════════════════════════════════════════════════════════════

export type KeyMetricId =
  | 'arr' | 'net_new_arr' | 'rpo' | 'crpo' | 'nrr' | 'backlog' | 'adj_ebitda'
  | 'free_cash_flow' | 'subscription_revenue' | 'customers_100k'
  | 'comparable_sales' | 'gross_margin_adj' | 'operating_margin_adj';

export interface KeyMetric {
  id: KeyMetricId;
  label: string;                    // display label, e.g. "ARR", "cRPO"
  value: number;
  unit: 'usd' | 'pct' | 'count';
  yoy_pct: number | null;           // only when the same line states a YoY change
  source: string;                   // the line it came from, ≤ 200 chars
}

export const KEY_METRIC_LABEL: Record<KeyMetricId, string> = {
  arr: 'ARR',
  net_new_arr: 'Net new ARR',
  rpo: 'RPO',
  crpo: 'cRPO',
  nrr: 'Net revenue retention',
  backlog: 'Backlog',
  adj_ebitda: 'Adjusted EBITDA',
  free_cash_flow: 'Free cash flow',
  subscription_revenue: 'Subscription revenue',
  customers_100k: 'Customers >$100K ARR',
  comparable_sales: 'Comparable sales',
  gross_margin_adj: 'Non-GAAP gross margin',
  operating_margin_adj: 'Non-GAAP operating margin',
};

type Unit = 'usd' | 'pct' | 'count';

// ─── metric labels ──────────────────────────────────────────────────────────
// Each is matched at a clause start (see `anchorOk`). More specific ids are
// tried first so "net new ARR" never reaches the ARR pattern.
interface Spec {
  id: KeyMetricId;
  label: RegExp;                    // the label itself, unanchored (we anchor it)
  units: Unit[];                    // the only units this metric may carry
  /** Cheap substring test, so a segment is only run against the labels that
   *  could possibly be in it. */
  gate: RegExp;
  /** Rejected when the whitelisted prefix ends with one of these. */
  notAfter?: RegExp;
  /** Rejected when the text immediately following the label matches. */
  notBefore?: RegExp;
  /** Parenthetical restatements the label is allowed to be followed by,
   *  e.g. Remaining Performance Obligations ("RPO") RPO was $1,519.2 million. */
  alias?: RegExp;
}

const SPECS: Spec[] = [
  {
    id: 'net_new_arr', units: ['usd'],
    gate: /net\s+new\s+(?:arr|annual)/i,
    label: /net\s+new\s+(?:arr\b|annual(?:ized)?\s+recurring\s+revenue\b)/i,
    alias: /arr/i,
  },
  {
    id: 'customers_100k', units: ['count'],
    gate: /customers?/i,
    label: new RegExp(
      // "customers with more than $100,000 of ARR", "customers >$100K ARR"
      '(?:customers?\\s+(?:with\\s+)?(?:more\\s+than\\s+|greater\\s+than\\s+|over\\s+|at\\s+least\\s+|of\\s+)?[>≥]?\\s*\\$\\s*100(?:,000|\\s*k)\\+?\\s*(?:or\\s+(?:more|greater)\\s+)?(?:in\\s+|of\\s+|with\\s+)?(?:arr\\b|annual(?:ized)?\\s+recurring\\s+revenue\\b))'
      // "customers with ARR of $100,000 or more"
      + '|(?:customers?\\s+with\\s+(?:arr|annual(?:ized)?\\s+recurring\\s+revenue)\\s+(?:of\\s+)?(?:more\\s+than\\s+|greater\\s+than\\s+|over\\s+|at\\s+least\\s+)?[>≥]?\\s*\\$\\s*100(?:,000|\\s*k)\\+?(?:\\s+or\\s+(?:more|greater))?)'
      // "$100K+ customers"
      + '|(?:[>≥]?\\s*\\$\\s*100\\s*k\\+?\\s+(?:arr\\s+)?customers\\b)', 'i'),
  },
  {
    id: 'arr', units: ['usd'],
    gate: /\barr\b|recurring\s+revenue/i,
    label: /(?:total\s+)?(?:annual(?:ized)?\s+recurring\s+revenue|arr)\b/i,
    // "net new ARR" is its own metric; "ARR growth" is a rate, not a level.
    notAfter: /\b(?:net\s+new|new|incremental)\s*$/i,
    notBefore: /^\s*(?:growth|growth\s+rate)\b/i,
    alias: /arr|annual(?:ized)?\s+recurring\s+revenue/i,
  },
  {
    id: 'crpo', units: ['usd'],
    gate: /crpo|current\s+r(?:po|emaining)/i,
    label: /(?:current\s+remaining\s+performance\s+obligations?|current\s+rpo|crpo)\b/i,
    alias: /c?rpos?|current\s+rpo/i,
  },
  {
    id: 'rpo', units: ['usd'],
    gate: /\brpos?\b|remaining\s+performance/i,
    label: /(?:total\s+)?(?:remaining\s+performance\s+obligations?|rpos?)\b/i,
    // "current remaining performance obligations" is cRPO, a different number.
    notAfter: /\bcurrent\s*$/i,
    alias: /rpos?/i,
  },
  {
    id: 'nrr', units: ['pct'],
    gate: /retention|expansion\s+rate|\bnrr\b/i,
    label: /(?:dollar[-\s]?based\s+)?(?:net\s+revenue\s+retention(?:\s+rate)?|net\s+retention(?:\s+rate)?|net\s+expansion\s+rate|nrr)\b/i,
    alias: /nrr|dbnrr/i,
  },
  {
    id: 'backlog', units: ['usd'],
    gate: /backlog/i,
    label: /(?:total\s+|committed\s+)?backlog\b/i,
    // "Awarded Capacity Backlog" is a pipeline, not backlog; FuelCell reports
    // both and the awarded figure is three times the committed one.
    notAfter: /\b(?:awarded|capacity|pipeline|unawarded|potential)\s*$/i,
  },
  {
    id: 'adj_ebitda', units: ['usd'],
    gate: /ebitda/i,
    label: /(?:adjusted|adj\.?|non-?gaap)\s+ebitda(?:\s+(?:profit|loss|income))?\b(?!\s*margin)/i,
  },
  {
    id: 'free_cash_flow', units: ['usd'],
    gate: /free\s+cash\s+flow/i,
    label: /(?:adjusted\s+|non-?gaap\s+)?free\s+cash\s+flow\b(?!\s*margin)/i,
  },
  {
    id: 'subscription_revenue', units: ['usd'],
    gate: /subscription\s+revenue/i,
    label: /(?:total\s+)?subscription\s+revenues?\b/i,
  },
  {
    id: 'comparable_sales', units: ['pct'],
    gate: /comparable|comp\s+store|same[-\s]store/i,
    label: /(?:total\s+)?(?:comparable(?:\s+store)?\s+(?:net\s+)?sales|comp(?:arable)?\s+store\s+net\s+sales|same[-\s]store\s+(?:net\s+)?sales)\b/i,
  },
  {
    id: 'gross_margin_adj', units: ['pct'],
    gate: /gross\s+margin/i,
    label: /(?:non-?gaap|adjusted)(?:\s*\(non-?gaap\))?\s+gross\s+margins?\b/i,
  },
  {
    id: 'operating_margin_adj', units: ['pct'],
    gate: /operating\s+margin/i,
    label: /(?:non-?gaap|adjusted)(?:\s*\(non-?gaap\))?\s+operating\s+margins?\b/i,
  },
];

/** Cheap gate: a line with none of these words cannot carry a metric. */
const ANY_METRIC = /\b(?:arr|c?rpos?|nrr|recurring\s+revenue|remaining\s+performance|retention|expansion\s+rate|backlog|ebitda|cash\s+flow|subscription\s+revenue|customers?|comparable|comp\s+store|same[-\s]store|margin)\b/i;

// ─── forward-looking guards ─────────────────────────────────────────────────
/** Required by the brief: any line saying one of these is a forecast. */
const FORWARD_LINE = /\b(expects?|expected|guidance|outlook|anticipates?|forecasts?|will\s+be|projected)\b/i;
/** Opens a guidance section. Its ROWS carry no verb at all, so the section
 *  itself has to be remembered — "Non-GAAP operating margin 2 of 15.5%" under
 *  "For the third quarter … the company expects" is a forecast. */
const FORWARD_OPEN = /\b(?:outlook|guidance|expects?\s+the\s+following|expects?\s*:?\s*$|is\s+(?:issuing|providing)\s+the\s+following|now\s+(?:expects|sees)|projects?\s+the\s+following)\b/i;
/** Closes it: we are back in reported results, or out of the narrative. */
const FORWARD_CLOSE = /\b(?:conference\s+call|webcast|about\s+\w+|forward[-\s]looking\s+statements|safe\s+harbor|investor\s+(?:relations|contact)|media\s+contact|press\s+contact|non-?gaap\s+financial\s+measures|explanation\s+of\s+non-?gaap|use\s+of\s+non-?gaap|statement\s+regarding\s+use|key\s+(?:business\s+)?metrics|operating\s+metrics|condensed\s+consolidated|consolidated\s+(?:statements?|balance)|balance\s+sheets?|statements?\s+of\s+operations|reconciliation|appendix|supplemental\s+(?:financial|information)|financial\s+results\b|results\s+of\s+operations|quarterly\s+results|financial\s+highlights)\b/i;
/** A guidance block is never longer than this; a stale zone is worse than none. */
const FORWARD_MAX_LINES = 60;

// ─── table context ──────────────────────────────────────────────────────────
const MULT: Record<string, number> = {
  thousand: 1e3, thousands: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9,
};
/** "(in thousands)", "(In millions, except per share data)", "(Amounts in thousands…)" */
const CAPTION_SCALE = /\([^)]{0,30}?\bin\s+(thousands|millions|billions)\b/i;
/** A GAAP | non-GAAP COLUMN pair — not two label rows. Ciena's quarterly table
 *  puts both bases side by side and labels the rows just "Gross margin", so the
 *  adjusted figure is the first cell of the second half of the row. */
const COL_GAAP_ONLY = /^gaap(?:\s+results?)?(?:\s*\((?:unaudited|audited)\))?\s*$/i;
const COL_NONGAAP_ONLY = /^non-?gaap(?:\s+results?)?(?:\s*\((?:unaudited|audited)\))?\s*$/i;
const BARE_GROSS_MARGIN = /^gross\s+margins?\b/i;
const BARE_OP_MARGIN = /^operating\s+margins?\b/i;
const PAIRED_MAX_LINES = 120;

/** A flattened table cell: numbers, currency, footnote marks — never a label. */
const CELL = /^[\s$()%*†‡,.\d+–—−-]*(?:\b(?:pts?|bps|nm|na)\b[\s%)]*)?$/i;

// ─── anchoring ──────────────────────────────────────────────────────────────
/** Words allowed between the start of a clause and the metric label. Anything
 *  else — a verb, another metric's name, a number with a unit — means the label
 *  is buried inside a sentence and its neighbouring figure may belong to
 *  something else. */
const PREFIX_OK = new Set([
  'a', 'an', 'the', 'our', 'its', 'their', 'and', 'or', 'also', 'plus', 'while', 'with',
  'in', 'of', 'at', 'for', 'as', 'to', 'on',
  'q1', 'q2', 'q3', 'q4', 'first', 'second', 'third', 'fourth', 'quarter', 'quarterly',
  'half', 'full', 'year', 'yearly', 'annual', 'fiscal', 'fy', 'ended', 'ending', 'end',
  'exit', 'exiting', 'closing', 'period', 'ytd', 'year-to-date', 'yeartodate',
  'total', 'company', "company's", 'group', 'consolidated', 'global', 'worldwide',
  'reported', 'record', 'approximately', 'approx', 'about', 'roughly', 'including',
  'which', 'that', 'gaap', 'non-gaap', 'nongaap', 'adjusted', 'adj', 'current',
  'committed', 'dollar-based', 'trailing', 'overall', 'ending', 'this',
]);
/** Numeric prefix tokens that are periods, not values. */
const PREFIX_NUM_OK = /^(?:q[1-4]|h[12]|fy'?\d{0,4}|'?\d{2}|(?:19|20)\d{2})$/i;
const PREFIX_MAX_WORDS = 6;

function anchorOk(prefix: string): boolean {
  const p = prefix
    .replace(/^[\s•·▪▸○*–—-]+/, '')
    .replace(/^(?:\(\d{1,2}\)|\[\d{1,2}\])\s*/, '')
    .trim();
  if (!p) return true;
  if (p.length > 70) return false;
  const words = p.split(/\s+/);
  if (words.length > PREFIX_MAX_WORDS) return false;
  for (const raw of words) {
    const w = raw.replace(/^[^A-Za-z0-9$]+/, '').replace(/[^A-Za-z0-9'%-]+$/, '').toLowerCase();
    if (!w) continue;
    if (PREFIX_OK.has(w)) continue;
    if (PREFIX_NUM_OK.test(w)) continue;
    return false;                                   // a real word: not anchored
  }
  return true;
}

// ─── connectors ─────────────────────────────────────────────────────────────
/** label → value, with nothing in between but punctuation, a footnote marker
 *  and at most one linking verb. */
const CONNECT_DIRECT = /^[\s:*†‡]*(?:\((?:\d{1,2}|[a-z])\)\s*)?[\d,\s]{0,6}[\s:;,–—-]*(?:(?:was|were|is|are|of|at|to|ended\s+at|totall?ed|reached|stood\s+at|came\s+in\s+at|amounted\s+to|grew\s+to|increased\s+to|rose\s+to|declined\s+to|decreased\s+to)\s+)?(?:approximately|approx\.?|about|roughly|a\s+record|record|~)?[\s:;,]*$/i;
/** label → growth → value: "Total RPO grew 16% year-over-year to $1.2 billion".
 *  The captured percentage IS the YoY change, stated on the same line. */
const CONNECT_GROWTH = /^[\s:*†‡,]*(?:\(\d{1,2}\)\s*)?(?:(grew|increased|rose|climbed|expanded|advanced|was\s+up|were\s+up|is\s+up|up|declined|decreased|fell|was\s+down|were\s+down|down)\s+)(?:by\s+)?(?:approximately\s+|about\s+|roughly\s+)?(\d{1,3}(?:\.\d+)?)\s*%\s*(?:year[-\s]?over[-\s]?year|yoy|y\/y|year[-\s]on[-\s]year)?\s*,?\s*to\s+(?:approximately\s+|about\s+|roughly\s+)?$/i;
/** label → change, for a metric that IS a change: "comparable sales increased
 *  by 14.1%". Never used for a margin or a retention rate — those are levels,
 *  and "gross margin increased 2 points" would read as a 2% gross margin. */
const CONNECT_PCT_CHANGE = /^[\s:*†‡,]*(?:(increase[ds]?|grew|growth|rose|gain(?:ed)?|up|decrease[ds]?|decline[ds]?|fell|down)\s+)(?:of\s+|by\s+)?(?:approximately\s+|about\s+|roughly\s+)?$/i;
/** value → label: "Ended the quarter with approximately $753.1 million in
 *  Remaining Performance Obligations", "of which $246 million was net new ARR". */
const NEG_WORD = /\b(decrease[ds]?|decline[ds]?|fell|down|lower|drop(?:ped)?|reduction|loss)\b/i;

// ─── numeric tokens ─────────────────────────────────────────────────────────
interface Tok { v: number; unit: Unit; at: number; end: number; }

/**
 * Numbers with an unambiguous unit. A bare "$4.2" is emitted only when the
 * table declared its scale; otherwise it is dropped, because a press release
 * uses the same shape for dollars, thousands and millions.
 *
 * `bareScaled` is set only for the cells of a flattened table row under a
 * caption that declared the scale. There, a formatted number with no currency
 * sign is still a currency cell — Snowflake's reconciliation prints
 * "Non-GAAP free cash flow | 83,803 | 5%" and drops the "$" after the first
 * row. It stays off everywhere else, where a bare number is a count or a year.
 */
function tokens(s: string, scale: number | null, limit = 12, bareScaled = false): Tok[] {
  const out: Tok[] = [];
  const re = /(?:(\()\s*)?(?:(\$)\s*)?(?:(\()\s*)?([-−–—+])?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(\))?\s*(billion|million|thousand|%)?/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(s)) && guard++ < 60 && out.length < limit) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const lit = m[5];
    const raw = lit.replace(/,/g, '');
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) continue;
    const word = (m[7] || '').toLowerCase();
    const dollar = !!m[2];
    // A dash in front of a number that follows another number is a range
    // separator ("45% - 47%"), not a sign.
    let minus = !!m[4] && m[4] !== '+';
    if (minus) {
      const before = s.slice(0, m.index + m[0].indexOf(m[4]!)).replace(/[\s$]+$/, '');
      if (/[\d%)]$/.test(before)) minus = false;
    }
    const neg = minus || (!!(m[1] || m[3]) && !!m[6]);
    let unit: Unit;
    if (word === '%') unit = 'pct';
    else if (word) { unit = 'usd'; v *= MULT[word]; }
    else if (dollar && scale) { unit = 'usd'; v *= scale; }
    else if (dollar) continue;                       // a dollar of unknown scale
    else if (bareScaled && scale && /[,.]/.test(lit)) { unit = 'usd'; v *= scale; }
    else unit = 'count';                             // a bare integer
    if (unit === 'count' && !Number.isInteger(v)) continue;
    // The regex may begin on the whitespace before the digits; the connector
    // test needs that space back or "Retention rate was 117%" reads as "was".
    const lead = /^\s*/.exec(m[0])![0].length;
    out.push({ v: neg ? -v : v, unit, at: m.index + lead, end: m.index + m[0].length });
  }
  return out;
}

// ─── year-over-year, from the same statement only ───────────────────────────
/** "30% year-over-year", "+27% YoY", "17% y/y". */
const YOY_EXPLICIT = /([+\-−–]?\d{1,3}(?:\.\d+)?)\s*%\s*(?:points?\s+)?(?:increase\s+|decrease\s+|growth\s+|decline\s+)?(?:year[-\s]?over[-\s]?year|yoy|y\/y|year[-\s]on[-\s]year|from\s+(?:the\s+)?(?:prior|year[-\s]ago)\s+year)/i;
/** "an increase of approximately 4.1%" — accepted only when the same statement
 *  makes the comparison a year-over-year one. */
const YOY_DIRECTIONAL = /\b(increase[ds]?|growth|grew|rose|up|gain(?:ed)?|higher|decrease[ds]?|decline[ds]?|fell|down|lower)\b\s*(?:of\s+|by\s+|to\s+)?(?:approximately\s+|about\s+|roughly\s+)?([+\-−–]?\d{1,3}(?:\.\d+)?)\s*%/i;
const YOY_CONTEXT = /year[-\s]?over[-\s]?year|\byoy\b|y\/y|prior[-\s]year|year[-\s]ago|last\s+year|(?:compared\s+(?:to|with)|versus|vs\.?)\s[^.]{0,60}(?:19|20)\d{2}/i;
/** A sequential change is not a YoY change. */
const NOT_YOY = /sequential|quarter[-\s]over[-\s]quarter|q\/q|\bqoq\b|from\s+(?:the\s+)?(?:first|second|third|fourth)\s+quarter\s+of\s+(?:fiscal\s+)?(?:20\d{2})?\s*$/i;

function yoyFrom(tail: string): number | null {
  const t = tail.slice(0, 220);
  if (NOT_YOY.test(t)) return null;
  let m = YOY_EXPLICIT.exec(t);
  let v: number | null = null;
  let at = -1;
  if (m) { v = parseFloat(m[1].replace(/[−–]/, '-')); at = m.index; }
  else if (YOY_CONTEXT.test(t)) {
    m = YOY_DIRECTIONAL.exec(t);
    if (m) {
      v = parseFloat(m[2].replace(/[−–]/, '-'));
      at = m.index;
      if (NEG_WORD.test(m[1])) v = -Math.abs(v);
    }
  }
  if (v == null || !Number.isFinite(v) || at < 0) return null;
  // "representing a 28% year-over-year decline" — the direction word can follow.
  if (v > 0 && NEG_WORD.test(t.slice(at, at + 60))) v = -v;
  if (Math.abs(v) > 1000) return null;
  return v;
}

// ─── sanity ─────────────────────────────────────────────────────────────────
const NON_NEGATIVE: KeyMetricId[] = ['arr', 'rpo', 'crpo', 'backlog', 'subscription_revenue'];

function sane(id: KeyMetricId, unit: Unit, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (unit === 'usd') {
    const a = Math.abs(v);
    if (a < 1e5 || a > 5e12) return false;
    if (NON_NEGATIVE.includes(id) && v < 0) return false;
    return true;
  }
  if (unit === 'pct') {
    if (v < -100 || v > 300) return false;
    // A net retention rate is a ratio around 100; anything outside this band is
    // a different number that landed on the row (a growth rate, a margin).
    if (id === 'nrr' && (v < 50 || v > 250)) return false;
    return true;
  }
  if (!Number.isInteger(v) || v < 1 || v > 1e7) return false;
  return true;
}

// ─── segmentation ───────────────────────────────────────────────────────────
/** Numeric HTML entities the shared htmlToText leaves behind (it only decodes
 *  the decimal form), so a bullet does not become part of the first word. */
function unentity(s: string): string {
  return s.replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => {
    const c = parseInt(h, 16);
    if (c === 0x2022 || c === 0x25aa || c === 0x25cf || c === 0xb7) return '•';
    if (c === 0x2019 || c === 0x2018) return "'";
    if (c === 0x201c || c === 0x201d) return '"';
    if (c === 0x2013 || c === 0x2014 || c === 0x2212) return '–';
    return ' ';
  });
}
const LEAD_NOISE = /^[\s•·▪▸○*–—-]+/;
const LEAD_CHARS = ' \t•·▪▸○*\u2013\u2014-';
/** Bullets and dashes off the front of a line — skipped outright for the many
 *  lines that start with a letter, since this runs on every line of the file. */
const stripLead = (s: string): string =>
  s.length && LEAD_CHARS.indexOf(s[0]) >= 0 ? s.replace(LEAD_NOISE, '') : s;
/** Two whitespace characters in a row, or whitespace that is not a plain space. */
const ODD_SPACE = /\s\s|[^\S ]/;

/** A press release is not prose: one line can carry two metrics ("Total RPO
 *  grew 16% … while cRPO grew 20% …"), so a line is split into sentences and
 *  then into the clauses that each open with their own subject. */
function segments(line: string): string[] {
  const out: string[] = [];
  const sentences = line.length > 100
    ? line.split(/(?<=[.;!?])\s+(?=["“(\w])/)
    : [line];
  for (const s0 of sentences) {
    const s = s0.trim();
    if (!s) continue;
    if (s.length <= 80) { out.push(s); continue; }
    const clauses = s.split(/;\s+|,\s+(?=(?:while|and|of\s+which|which|including|with|driven\s+by)\b)/i);
    for (const c of clauses) {
      const t = c.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

// ─── extraction ─────────────────────────────────────────────────────────────
interface Found { value: number; unit: Unit; yoy: number | null; source: string; }
interface Got { v: number; unit: Unit; yoy: number | null; end: number; }

/** Everything a spec needs, compiled once — this runs over every line of every
 *  release, so nothing is built inside the loop. */
interface Compiled {
  spec: Spec;
  labelG: RegExp;                 // global, for walking every occurrence
  aliasParen: RegExp | null;      // ("RPO")
  aliasAgain: RegExp | null;      // …Obligations RPO was
  valueFirst: RegExp;             // "$753.1 million in Remaining Performance Obligations"
  pctFirst: RegExp | null;        // "a 76% non-GAAP gross margin"
  countFirst: RegExp | null;      // "1,571 customers with $100K+ ARR"
  pctOnly: boolean;
}
const COMPILED: Compiled[] = SPECS.map((spec) => {
  const L = spec.label.source;
  const pctOnly = spec.units.length === 1 && spec.units[0] === 'pct';
  return {
    spec,
    labelG: new RegExp(L, 'gi'),
    aliasParen: spec.alias ? new RegExp(`^(?:${spec.alias.source})s?$`, 'i') : null,
    aliasAgain: spec.alias ? new RegExp(`^\\s*(?:${spec.alias.source})\\b`, 'i') : null,
    valueFirst: new RegExp(
      `(\\$\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*(?:billion|million|thousand))\\s+(?:was|were|is|are|of|in)\\s+(?:the\\s+)?(?:${L})`, 'i'),
    pctFirst: pctOnly ? new RegExp(`(\\d{1,3}(?:\\.\\d+)?)\\s*%\\s+(?:${L})`, 'i') : null,
    countFirst: spec.id === 'customers_100k' ? new RegExp(`(\\d[\\d,]{1,8})\\s+(?:${L})`, 'i') : null,
    pctOnly,
  };
});

/** Words that, standing just in front of an unanchored label, mean the number
 *  beside it is not this quarter's figure for this metric. */
const UNANCHORED_BLOCK = /\b(?:guidance|outlook|expects?|expected|anticipat\w*|forecast\w*|project\w*|target\w*|compared\s+(?:to|with)|versus|vs\.?|prior[-\s]year|year[-\s]ago|excluding|customers?\s+with|defines?|defined|represents?|refers?\s+to|calculat\w*|assum\w*)\b/i;
const UNANCHORED_GAP = 25;

/** Strip the label's own restatement — `("RPO") RPO was …` — so the connector
 *  test sees only the gap the writer meant. */
function skipRestatement(rest: string, c: Compiled): string {
  if (!c.aliasParen || !c.aliasAgain) return rest;
  let r = rest;
  for (let i = 0; i < 3; i++) {
    const paren = /^\s*\(\s*["'“”]?\s*([A-Za-z ]{1,40}?)\s*["'“”]?\s*\)/.exec(r);
    if (paren && c.aliasParen.test(paren[1].trim())) { r = r.slice(paren[0].length); continue; }
    const again = c.aliasAgain.exec(r);
    if (again) { r = r.slice(again[0].length); continue; }
    break;
  }
  return r;
}

function readValue(spec: Spec, rest: string, scale: number | null, allowPctChange: boolean,
  bareScaled = false, maxGap = 60): Got | null {
  const toks = tokens(rest, scale, 5, bareScaled);
  for (const t of toks.slice(0, 4)) {
    if (!spec.units.includes(t.unit)) continue;
    const gap = rest.slice(0, t.at);
    if (gap.length > maxGap) break;
    if (CONNECT_DIRECT.test(gap)) return { v: t.v, unit: t.unit, yoy: null, end: t.end };
    const g = CONNECT_GROWTH.exec(gap);
    if (g) {
      let pct = parseFloat(g[2]);
      if (NEG_WORD.test(g[1])) pct = -pct;
      return { v: t.v, unit: t.unit, yoy: Number.isFinite(pct) ? pct : null, end: t.end };
    }
    if (allowPctChange && t.unit === 'pct') {
      const c = CONNECT_PCT_CHANGE.exec(gap);
      if (c) return { v: NEG_WORD.test(c[1]) ? -Math.abs(t.v) : t.v, unit: 'pct', yoy: null, end: t.end };
    }
  }
  return null;
}

/**
 * Reported operating metrics from the plain text of an earnings press release
 * (the same text lib/us-guidance feeds to the guidance classifier).
 */
export function keyMetricsFromText(text: string): KeyMetric[] {
  if (!text || text.length > 4_000_000) return [];

  const rawLines = text.split('\n');
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length && lines.length < 20_000; i++) {
    const r0 = rawLines[i];
    const r = r0.indexOf('&#') < 0 ? r0 : unentity(r0);
    let l = r.trim();
    // htmlToText has already collapsed runs of spaces and tabs, so the global
    // rewrite is only worth paying for on the lines that still need it.
    if (ODD_SPACE.test(l)) l = l.replace(/\s+/g, ' ');
    if (l) lines.push(l);
  }

  const hits = new Map<KeyMetricId, Found>();
  let scale: number | null = null;
  let forwardSince = -1;                 // lines since the guidance section opened
  let pairedSince = -1;                  // lines since a GAAP | non-GAAP column pair

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── context ────────────────────────────────────────────────────────────
    if (line.indexOf('(') >= 0) {
      const cap = CAPTION_SCALE.exec(line);
      if (cap) scale = MULT[cap[1].toLowerCase()];
    }

    const bare = stripLead(line);
    if (line.length < 40 && COL_GAAP_ONLY.test(bare)) {
      const nxt = stripLead(lines[i + 1] || '');
      const nxt2 = stripLead(lines[i + 2] || '');
      if (COL_NONGAAP_ONLY.test(nxt) || COL_NONGAAP_ONLY.test(nxt2)) pairedSince = 0;
    } else if (pairedSince >= 0) {
      pairedSince++;
      if (pairedSince > PAIRED_MAX_LINES || FORWARD_CLOSE.test(line) || line.length > 260) pairedSince = -1;
    }

    const closesForward = FORWARD_CLOSE.test(line) && line.length < 200;
    if (forwardSince >= 0) {
      forwardSince++;
      if (forwardSince > FORWARD_MAX_LINES || closesForward) forwardSince = -1;
    }
    if (FORWARD_OPEN.test(line) && line.length < 400 && !closesForward) forwardSince = 0;
    const forwardZone = forwardSince >= 0;

    if (forwardZone) continue;
    if (!ANY_METRIC.test(line)) continue;
    if (FORWARD_LINE.test(line)) continue;   // a forecast, whatever the section

    // ── candidates ─────────────────────────────────────────────────────────
    const segs = segments(line);
    const wholeLine = segs.length === 1 && stripLead(segs[0]) === bare;
    // The cells under a table row label are the same whichever metric asks.
    let cells: string[] | null = null;
    const rowCells = (): string[] => {
      if (cells) return cells;
      cells = [];
      for (let k = 1; k <= 16 && i + k < lines.length; k++) {
        const nx = stripLead(lines[i + k]);
        if (!CELL.test(nx) || nx.length > 30) break;
        cells.push(nx);
      }
      return cells;
    };

    for (const seg0 of segs) {
      const seg = stripLead(seg0);
      if (!seg || !ANY_METRIC.test(seg)) continue;
      // A metric already found is only revisited to pick up a YoY, and a YoY
      // always carries a percent sign — so a segment without one can never
      // improve it. This is exact, not a heuristic, and it keeps a long
      // document from re-running every pattern on every later line.
      const mayAddYoy = seg.indexOf('%') >= 0;

      for (const c of COMPILED) {
        const spec = c.spec;
        const prev = hits.get(spec.id);
        if (prev && (prev.yoy != null || !mayAddYoy)) continue;
        if (!spec.gate.test(seg)) continue;

        const allowChange = spec.id === 'comparable_sales';
        let got: Got | null = null;
        let source = seg;

        // ① Anchored label: the first occurrence whose prefix is harmless.
        let at = -1, end = -1;
        c.labelG.lastIndex = 0;
        let m: RegExpExecArray | null;
        let guard = 0;
        while ((m = c.labelG.exec(seg)) && guard++ < 8) {
          const prefix = seg.slice(0, m.index);
          if (spec.notAfter && spec.notAfter.test(prefix)) continue;
          if (spec.notBefore && spec.notBefore.test(seg.slice(m.index + m[0].length))) continue;
          if (!anchorOk(prefix)) continue;
          at = m.index; end = m.index + m[0].length; break;
        }

        if (at >= 0) {
          const rest = skipRestatement(seg.slice(end), c);
          got = readValue(spec, rest, scale, allowChange);

          // A flattened table row: "Free cash flow" then "$" then "64.7". Only a
          // short label line may borrow the cells below it, and only from lines
          // that are cells — never from the next paragraph.
          if (!got && wholeLine && seg.length <= 80 && !tokens(rest, scale, 1).length) {
            const cs = rowCells();
            if (cs.length) {
              got = readValue(spec, `${rest} ${cs.join(' ')}`, scale, allowChange, true);
              if (got) source = `${seg} ${cs.join(' ')}`;
            }
          }
        }

        // ② Value before label: "…with approximately $753.1 million in Remaining
        //    Performance Obligations", "of which $246 million was net new ARR".
        //    Still anchored — the clause must OPEN with the value.
        if (!got) {
          const vm = c.valueFirst.exec(seg);
          if (vm && anchorOk(seg.slice(0, vm.index))) {
            const t = tokens(vm[1], scale, 1)[0];
            if (t && spec.units.includes(t.unit)) got = { v: t.v, unit: t.unit, yoy: null, end: vm.index + vm[0].length };
          }
        }
        // A count that leads its own label: "1,571 customers with $100K+ ARR".
        if (!got && c.countFirst) {
          const cm = c.countFirst.exec(seg);
          if (cm && anchorOk(seg.slice(0, cm.index))) {
            const v = parseFloat(cm[1].replace(/,/g, ''));
            if (Number.isFinite(v) && Number.isInteger(v)) got = { v, unit: 'count', yoy: null, end: cm.index + cm[0].length };
          }
        }

        // ③ Unanchored, percentages only. A dollar amount can belong to a
        //    subset of the metric beside it ("$500 million of ARR" from
        //    customers over $1M); a percentage cannot — "comparable sales
        //    increased by 14.1%" means exactly one thing wherever it sits. Five
        //    Below's only reported comp is mid-sentence, behind a semicolon the
        //    shared htmlToText deletes, so this is the only way to read it.
        if (!got && c.pctOnly) {
          c.labelG.lastIndex = 0;
          let g2 = 0;
          while ((m = c.labelG.exec(seg)) && g2++ < 6) {
            if (UNANCHORED_BLOCK.test(seg.slice(Math.max(0, m.index - 70), m.index))) continue;
            const r = readValue(spec, seg.slice(m.index + m[0].length), scale, allowChange, false, UNANCHORED_GAP);
            if (r) { got = r; break; }
          }
          // "…representing a 76% non-GAAP gross margin"
          if (!got && c.pctFirst) {
            const pm = c.pctFirst.exec(seg);
            if (pm && !UNANCHORED_BLOCK.test(seg.slice(Math.max(0, pm.index - 70), pm.index))) {
              const v = parseFloat(pm[1]);
              if (Number.isFinite(v)) got = { v, unit: 'pct', yoy: null, end: pm.index + pm[0].length };
            }
          }
        }

        if (!got) continue;
        if (got.unit === 'count' && /^(?:19|20)\d{2}$/.test(String(got.v))) continue;  // a year
        if (!sane(spec.id, got.unit, got.v)) continue;

        const yoy = got.yoy ?? yoyFrom(seg.slice(Math.min(got.end, seg.length)));
        const cur = hits.get(spec.id);
        if (cur) {
          // One entry per metric: the first statement (the highlights block)
          // wins, and is only displaced by a later one that adds the YoY for
          // the SAME number — a materially different figure is a different
          // period or a different basis, not a better version of this one.
          const near = got.unit === 'pct'
            ? Math.abs(cur.value - got.v) <= 0.5
            : Math.abs(cur.value) > 0 && Math.abs(cur.value - got.v) / Math.abs(cur.value) <= 0.02;
          if (!(cur.yoy == null && yoy != null && near)) continue;
        }
        hits.set(spec.id, {
          value: got.v, unit: got.unit, yoy,
          source: source.length > 200 ? source.slice(0, 199) + '…' : source,
        });
      }

      // Ciena's quarterly table labels its rows "Gross margin" / "Operating
      // margin" and puts GAAP and non-GAAP side by side, so the adjusted figure
      // is the first cell of the row's second half. Only the column header
      // makes that readable, so this runs only inside such a table.
      if (pairedSince >= 0 && wholeLine && seg.length <= 40) {
        const which: KeyMetricId | null = BARE_GROSS_MARGIN.test(seg) ? 'gross_margin_adj'
          : BARE_OP_MARGIN.test(seg) ? 'operating_margin_adj' : null;
        if (which && !hits.has(which)) {
          const cells = rowCells();
          const toks = tokens(cells.join(' '), scale, 12);
          const n = toks.length;
          if (n >= 4 && n % 2 === 0) {
            const half = n / 2;
            const parallel = toks.slice(0, half).every((t, k) => t.unit === toks[half + k].unit);
            const t = toks[half];
            if (parallel && t.unit === 'pct' && sane(which, 'pct', t.v)) {
              const src = `${seg} ${cells.join(' ')}`;
              hits.set(which, {
                value: t.v, unit: 'pct', yoy: null,
                source: src.length > 200 ? src.slice(0, 199) + '…' : src,
              });
            }
          }
        }
      }
    }
  }

  const order: KeyMetricId[] = [
    'arr', 'net_new_arr', 'rpo', 'crpo', 'nrr', 'backlog', 'subscription_revenue',
    'adj_ebitda', 'free_cash_flow', 'gross_margin_adj', 'operating_margin_adj',
    'comparable_sales', 'customers_100k',
  ];
  const out: KeyMetric[] = [];
  for (const id of order) {
    const h = hits.get(id);
    if (!h) continue;
    out.push({ id, label: KEY_METRIC_LABEL[id], value: h.value, unit: h.unit, yoy_pct: h.yoy, source: h.source });
  }
  return out;
}

/** "$2.13B", "126%", "1,571" — the card's rendering of a key metric. */
export function fmtKeyMetric(m: { value: number; unit: KeyMetric['unit'] }): string {
  if (m.unit === 'pct') return `${Math.round(m.value * 10) / 10}%`;
  if (m.unit === 'count') return Math.round(m.value).toLocaleString('en-US');
  const a = Math.abs(m.value);
  const body = a >= 1e12 ? `$${(a / 1e12).toFixed(2)}T`
    : a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B`
      : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M`
        // Sportsman's Warehouse reported adjusted EBITDA of $0.6M; printing it
        // as "$600,000" beside "$122.2M" on the next card reads as a different
        // unit. Below a million, stay in millions with one decimal.
        : a >= 1e4 ? `$${(a / 1e6).toFixed(1)}M`
          : `$${Math.round(a).toLocaleString('en-US')}`;
  return m.value < 0 ? `-${body}` : body;
}
