// ═══════════════════════════════════════════════════════════════════════════
// ADJUSTED / NON-GAAP EPS, READ OUT OF THE FILER'S OWN EARNINGS RELEASE.
//
// WHY THIS EXISTS
// ───────────────
// The vendor "adjusted EPS" field (Yahoo's earningsHistory.epsActual) is not
// the company's adjusted EPS. Verified against the filings: it carried GAP's
// GAAP $1.38 where the release says adjusted diluted EPS was $0.52; SentinelOne's
// GAAP $(0.27) where the release says non-GAAP diluted EPS was +$0.08 (the sign
// inverted); Williams-Sonoma's GAAP $2.84 against a filed non-GAAP $2.10. For
// ChargePoint, Petco, nCino, Phreesia, Affirm and Barrick it carried a number
// that appears NOWHERE in the release — those companies publish no non-GAAP EPS
// at all. Paired with a vendor *adjusted* consensus, any of those manufactures a
// beat that never happened.
//
// So: read the filer's own words, or say nothing. A great many issuers publish
// no adjusted EPS, and `null` is the correct and common answer for them. This
// module is tuned for a high refusal rate with zero wrong values — a refusal
// costs a card one field; a wrong value corrupts the beat, the tag and the tier.
//
// THE THREE SHAPES THE MEASURE APPEARS IN
// ────────────────────────────────────────
//  1. HEADLINE BULLET  "Q2 GAAP Diluted EPS of $3.99, Q2 Adjusted Diluted EPS
//                       of $1.68"
//  2. SENTENCE         "Adjusted net income was $190 million and adjusted
//                       diluted earnings per share were $0.52, excluding …"
//                      "Adjusted net income for the second quarter of 2026 was
//                       $80 million, or $0.95 per diluted share"
//                      "adjusted EPS, excluding special items, was $1.30"
//                      "comparable EPS (non-GAAP) grew 11% to $0.97"
//                      "GAAP diluted EPS of $2.84 per share, or $2.10 on a
//                       non-GAAP basis"
//  3. RECONCILIATION TABLE — the most reliable, and the one tried first.
//     Two orientations, both real and both handled here:
//       (a) PERIOD COLUMNS — the row names the measure, the columns are
//           periods:  "Non-GAAP diluted EPS | $2.10 | $2.00 | $4.03 | $3.86"
//           under "For the Thirteen Weeks Ended | For the Twenty-six Weeks
//           Ended" and a row of dates.
//       (b) METRIC COLUMNS — the columns are metrics, the rows are the basis,
//           and the period is a full-width row above each block:
//           "Three Months Ended August 1, 2026" / "GAAP … 1.28" /
//           "Adjusted (non-GAAP) … 1.28", under a "Diluted Earnings per Share"
//           column header.
//     Two further layouts fall out of the same grid model rather than needing
//     their own code, because a column's label is the join of EVERY header cell
//     covering it and the row's label may be a group header in the stub column:
//       • (Amount, Per share) pairs nested inside each period header;
//       • a stub header that names the measure once for a block of basis rows —
//         "Net income per share attributable to A&F" over "GAAP / Excluded item
//         / Adjusted non-GAAP".
//
// TELLING THE QUARTER COLUMN FROM THE YEAR-TO-DATE ONE — THE MAIN HAZARD
// ──────────────────────────────────────────────────────────────────────
// Releases print the quarter and the year-to-date side by side, and the YTD
// number is the bigger, more flattering one. Build-A-Bear's "$2.16 … adjusted
// $1.73" is the TWENTY-SIX WEEK line; its quarter is $0.70. So every value is
// bound to a period before it is believed:
//   • a column's label is the join of every header cell COVERING that grid
//     column (colspan- and rowspan-aware), so "13 Weeks / Ended / August 1, /
//     2026" reassembles into one period descriptor;
//   • if the column label carries no period, the nearest full-width period row
//     above the value binds it ("Three Months Ended August 1, 2026");
//   • only if neither does, and the table mixes in no longer period anywhere,
//     the table's own caption and the text just above it are consulted;
//   • the bound text must carry a quarter token (three months / thirteen weeks
//     / quarter / Qn) and must NOT carry a longer-period token (six months /
//     twenty-six weeks / nine months / year-to-date / full year …). Both
//     present ⇒ not the quarter;
//   • when the caller supplies `periodEndISO` and the bound text carries a
//     date, the date must match — this is also what keeps the prior-year
//     column out of the current-quarter answer;
//   • the reported quarter is the LATEST period the release shows, ranked by
//     year first and then by date, so a column headed only "Q4 FY26" is not
//     outbid by a prior-year column that carries a fuller label;
//   • two surviving candidates that disagree ⇒ null. If we cannot tell which
//     column is the quarter, we say nothing.
//
// THE OTHER FOUR WAYS A NUMBER LOOKS RIGHT AND IS NOT
// ────────────────────────────────────────────────────
//   • AN OUTLOOK. Guidance sits in tables that look exactly like results, and
//     its column is often the newest date in the document. Three independent
//     guards: the word ("guidance"/"expects"), including in the heading ABOVE
//     the table; the participle ("three months ENDING" is the future, "ENDED"
//     is the past); and the shape ("$4.99 to $5.04" is a range, and a reported
//     result is one number).
//   • A RESTATEMENT. "As Adjusted" over a comparative income-statement column
//     means RESTATED, and its numbers are ordinary GAAP. When the only adjusted
//     marker is in the column header, a GAAP sibling column for the SAME period
//     is required — that is what a reconciliation always has and a restated
//     comparative never does.
//   • A RECONCILING LINE. "Impact of income tax adjustments on adjusted diluted
//     EPS" is a $(0.58) contribution, not an EPS.
//   • A DOLLAR AMOUNT IN A PER-SHARE-LOOKING CELL. Only a value printed the way
//     a filing prints a per-share amount is accepted — a decimal, two to four
//     places, no thousands separator — so "18,362" ($18.362m) can never be one.
//
// Everything here is general: no ticker list, no per-issuer special case, no
// vendor field. It reads whatever wording the filer used.
// ═══════════════════════════════════════════════════════════════════════════

export interface AdjustedEps {
  /** The filer's own adjusted / non-GAAP diluted EPS for the reported quarter. */
  value: number;
  /** The same measure for the year-ago quarter, when the release states it. */
  prior?: number | null;
  /** The filer's wording, e.g. "Adjusted diluted EPS", "Non-GAAP metrics — Earnings (Loss) per Share - Diluted". */
  label: string;
  /** The sentence, bullet or table row it came from, verbatim. */
  source: string;
}

export interface AdjustedEpsOptions {
  /**
   * GAAP diluted EPS for the same quarter. Used only as a guard: a "non-GAAP"
   * figure identical to GAAP is refused unless the release itself puts the two
   * side by side (a reconciliation whose adjustments are nil, or a sentence
   * saying "reported and adjusted EPS of $0.50"). Issuers genuinely do report
   * the same number on both bases and those must survive; a GAAP number we
   * merely mis-parsed as adjusted must not.
   */
  gaapEps?: number | null;
  /**
   * The FISCAL PERIOD END of the quarter being reported (YYYY-MM-DD) — not the
   * announcement date. When supplied it pins the column; when absent, the
   * latest explicitly-quarterly column wins.
   */
  periodEndISO?: string | null;
}

// ─── vocabulary ───────────────────────────────────────────────────────────
// Written to survive re-wording: every alternative is a phrase filers actually
// use, and none of it is tied to an issuer.

/** "adjusted" / "non-GAAP" — the only two families we will call adjusted. */
const ADJ_RE = /\b(?:adjusted|non[\s‐-―-]?gaap)\b/i;

/** A per-share measure: "EPS", or "per <up to 3 words> share". */
const PER_SHARE_RE = /\bEPS\b|\bper\s+(?:[A-Za-z()-]+\s+){0,3}?shares?\b/i;

/** Measures that are NOT per-share earnings even when the words look close. */
const NOT_EPS_RE = new RegExp(
  [
    'EBITDAR?', '\\bEBIT\\b', 'free\\s+cash\\s+flow', 'cash\\s+flow', 'operating\\s+cash',
    'operating\\s+(?:income|loss|margin|profit|expense|earnings)',
    'gross\\s+(?:profit|margin)', '\\brevenues?\\b', '\\bnet\\s+sales\\b',
    'dividends?\\b', 'book\\s+value', 'net\\s+asset\\s+value', '\\bNAV\\b',
    'shares?\\s+(?:used|outstanding|issued|repurchased)', 'weighted[\\s-]average',
    'tax\\s+rate', 'effective\\s+tax', '\\bmargins?\\b', 'backlog', 'bookings',
    '\\bARR\\b', 'billings', 'funds\\s+from\\s+operations', '\\bFFO\\b',
    'par\\s+value', 'price\\s+per\\s+share', 'per\\s+share\\s+price',
  ].join('|'),
  'i',
);

/** Forward-looking figures. An outlook is not a result. Deliberately WITHOUT
 *  "assuming": "earnings per share - assuming dilution" is a per-share label,
 *  not a forecast. */
const GUIDANCE_RE = /\b(?:outlook|guidance|expect(?:s|ed|ing)?|forecast(?:ed)?|project(?:ed|ion)|anticipat\w*|estimat(?:e|es|ed)|target(?:ed|ing)?|will\s+be|range\s+of)\b/i;

/**
 * A period that has not happened yet. In a financial table the participle is
 * the tell and it is completely reliable: results are for the three months
 * ENDED July 31, an outlook is for the three months ENDING October 30. Without
 * this, a guidance reconciliation's column is the latest date in the document
 * and wins every "which column is the quarter" contest.
 */
const FORWARD_RE = /\b(?:months?|weeks?|quarters?|years?|periods?)\s+ending\b|\bending\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

/**
 * A reconciling line rather than the measure itself — "Impact of income tax
 * adjustments on adjusted diluted EPS" is a $(0.58) contribution, not an EPS.
 * Note "adjustment(s)", never "adjusted": the measure's own name starts that way.
 */
const RECONCILING_ROW_RE = /^\s*(?:less|plus|add|deduct|memo|subtotal|impact|effect|effects|adjustments?|reconciling|total\s+adjustments)\b/i;

/** Column headers that hold a delta, a percentage or a guidance bound. */
const BAD_COLUMN_RE = /\b(?:change|growth|variance|increase|decrease|percent|basis\s+points?|bps|low|high|midpoint|range|guidance|outlook|forecast|projected|expected|current|previous|prior\s+guidance)\b|%/i;

/** The reported quarter. Includes the 13/14-week retail conventions. */
const QUARTER_RE = /\b(?:three|3)[\s‐-―-]*months?\b|\bthree[\s‐-―-]*month\b|\b(?:thirteen|13)[\s‐-―-]*weeks?\b|\b(?:fourteen|14)[\s‐-―-]*weeks?\b|\bquarter(?:ly)?\b|\bqtrs?\b|\bQ[1-4]\b|\b[1-4]Q\b|\bQ[1-4]\d{2,4}\b|\b[1-4]Q\d{2,4}\b/i;

/** Anything longer than the quarter: half, three quarters, the year. */
const LONGER_RE = /\b(?:six|6|nine|9|twelve|12)[\s‐-―-]*months?\b|\b(?:six|nine|twelve)[\s‐-―-]*month\b|\b(?:twenty[\s‐-―-]*six|26)[\s‐-―-]*weeks?\b|\b(?:thirty[\s‐-―-]*nine|39)[\s‐-―-]*weeks?\b|\b(?:fifty[\s‐-―-]*(?:two|three)|5[23])[\s‐-―-]*weeks?\b|\byear[\s‐-―-]*to[\s‐-―-]*date\b|\bYTD\b|\bfirst\s+(?:half|six|nine)\b|\bhalf[\s‐-―-]*year\b|\bfull[\s‐-―-]*year\b|\bfiscal\s+year\s+(?:ended|end)\b|\byear\s+ended\b|\bannual\b/i;

/** A unit caption, which must never be mistaken for a per-share measure. */
const UNIT_CAPTION_RE = /\b(?:in|dollars\s+in|amounts\s+in|\$\s*in)\s+(?:thousands|millions|billions)\b|except[^)]*\bper\s+share\b|\bunaudited\b/i;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DATE_SRC = `\\b(${MONTHS.join('|')})\\s+(\\d{1,2})\\s*,?\\s*(\\d{4})\\b`;

// ─── html → text ──────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-',
  minus: '-', hellip: '...', bull: ' ', middot: ' ', deg: ' ', reg: ' ', trade: ' ', copy: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return ' ';
      if (code === 160 || code === 8203 || code === 8204 || code === 8205 || code === 65279) return ' ';
      if (code === 8211 || code === 8212 || code === 8722 || code === 150 || code === 151) return '-';
      if (code === 8216 || code === 8217) return "'";
      if (code === 8220 || code === 8221) return '"';
      if (code < 32 || code > 0x10ffff) return ' ';
      try { return String.fromCodePoint(code); } catch { return ' '; }
    }
    const v = NAMED[body.toLowerCase()];
    return v === undefined ? ' ' : v;
  });
}

const INVISIBLE_RE = /[\u00a0\u2000-\u200f\u202f\u205f\u2060\u3000\ufeff]/g;

/** Tag-stripped, entity-decoded, whitespace-collapsed text of an HTML fragment. */
function clean(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(INVISIBLE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip the parenthetical unit caption out of a label. "($ in millions) 13
 * Weeks Ended August 1, 2026" must keep its period and lose the caption, or
 * "except per share data" turns every column of the table into a per-share one.
 */
function stripUnitCaption(s: string): string {
  return s
    .replace(/\([^()]{0,140}?(?:in\s+(?:thousands|millions|billions)|except[^()]{0,90}?per\s+share)[^()]{0,140}?\)/gi, ' ')
    .replace(/\((?:unaudited|audited)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLER_RE = /^[$()%.,;:*†‡#\-‐-―_\s]*$/;

// ─── the table grid ───────────────────────────────────────────────────────

interface GridCell { col: number; span: number; text: string; }
interface GridRow { cells: GridCell[]; }
interface ParsedTable { rows: GridRow[]; preText: string; }

/**
 * Every <table> in the document, with nested tables removed from each parent so
 * a layout wrapper does not swallow its children's rows. `preText` is the
 * visible text immediately before the table — some filers put the period
 * heading outside the table entirely.
 */
function parseTables(html: string): ParsedTable[] {
  const out: ParsedTable[] = [];
  const open: number[] = [];
  const spans: Array<{ start: number; innerStart: number; innerEnd: number }> = [];
  const tagRe = /<\/?table\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (m[0][1] === '/') {
      const start = open.pop();
      if (start !== undefined) spans.push({ start, innerStart: start + m.input.slice(start).indexOf('>') + 1, innerEnd: m.index });
    } else if (!/\/>\s*$/.test(m[0])) {
      open.push(m.index);
    }
    if (spans.length > 3000) break;                  // pathological document guard
  }
  for (const s of spans) {
    if (s.innerEnd <= s.innerStart) continue;
    let inner = html.slice(s.innerStart, s.innerEnd);
    if (/<table\b/i.test(inner)) inner = stripNestedTables(inner);
    const rows = gridRows(inner);
    if (!rows.length) continue;
    out.push({ rows, preText: clean(html.slice(Math.max(0, s.start - 2000), s.start)).slice(-500) });
  }
  return out;
}

function stripNestedTables(inner: string): string {
  let out = '';
  let depth = 0;
  let last = 0;
  const tagRe = /<\/?table\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(inner))) {
    if (m[0][1] === '/') {
      if (depth > 0) { depth--; if (depth === 0) last = m.index + m[0].length; }
    } else {
      if (depth === 0) out += inner.slice(last, m.index);
      depth++;
    }
  }
  if (depth === 0) out += inner.slice(last);
  return out;
}

/**
 * Rows of a table laid out on a real grid: colspan advances the cursor and
 * rowspan reserves the column for the rows below. That is what keeps a value
 * underneath the header cell that actually describes it.
 */
function gridRows(inner: string): GridRow[] {
  const rows: GridRow[] = [];
  const pending: Array<{ col: number; span: number; left: number }> = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table\b|$)/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(inner))) {
    const cells: GridCell[] = [];
    let col = 0;
    const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr\b|<\/table\b|$)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[2] || '';
      const span = Math.min(60, Math.max(1, parseInt((/colspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || '1', 10) || 1));
      const rspan = Math.min(30, Math.max(1, parseInt((/rowspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || '1', 10) || 1));
      while (pending.some((p) => col >= p.col && col < p.col + p.span)) col++;
      cells.push({ col, span, text: clean(cm[3] || '') });
      if (rspan > 1) pending.push({ col, span, left: rspan - 1 });
      col += span;
      if (col > 400) break;                          // runaway row guard
    }
    for (let i = pending.length - 1; i >= 0; i--) { pending[i].left--; if (pending[i].left <= 0) pending.splice(i, 1); }
    if (cells.length) rows.push({ cells });
    if (rows.length > 900) break;
  }
  return rows;
}

// ─── numbers ──────────────────────────────────────────────────────────────

interface NumCell { value: number; printed: string }

/**
 * A per-share amount as a filing prints one: a decimal with two to four places
 * and no thousands separator. That FORMAT test — a property of the printed
 * release, not of any company — is what stops a dollar column ("18,362" =
 * $18.362m) or a share count from ever being read as an EPS. Negatives come as
 * "(0.27)", and when the filer puts the closing parenthesis in its own cell,
 * as "(0.27".
 */
function perShareNumber(text: string): NumCell | null {
  const t = text.trim();
  if (!t || t.indexOf('%') >= 0) return null;
  const body = t.replace(/[$\s\u00a0]/g, '');
  const m = /^(\()?(-|[\u2010-\u2015])?\$?(\d{1,3}\.\d{2,4})(\))?$/.exec(body);
  if (!m) return null;
  const v = parseFloat(m[3]);
  if (!Number.isFinite(v)) return null;
  return { value: (m[1] || m[2] || m[4]) ? -v : v, printed: t };
}

/** Any printed number, used only to find where a row's label ends. */
const ANY_NUMBER_RE = /^\(?[-‐-―]?[\d,]+(?:\.\d+)?\)?%?$/;

// ─── period reasoning ─────────────────────────────────────────────────────

type Duration = 'quarter' | 'longer' | 'unknown';

function durationOf(text: string): Duration {
  if (LONGER_RE.test(text)) return 'longer';         // both present ⇒ cannot tell ⇒ not the quarter
  if (QUARTER_RE.test(text)) return 'quarter';
  return 'unknown';
}

function iso(mo: number, d: number, y: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const yy = y < 100 ? 2000 + y : y;
  if (yy < 1900 || yy > 2200) return null;
  return `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Period-end dates in a header: "August 1, 2026" and the compact US form a few
 * filers use in narrow columns, "8/2/26". Month-first is the US filing
 * convention; a filer who meant otherwise would simply fail to match the
 * caller's period end, which costs a refusal rather than a wrong column.
 */
function datesIn(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(DATE_SRC, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = iso(MONTHS.indexOf(m[1].toLowerCase()) + 1, parseInt(m[2], 10), parseInt(m[3], 10));
    if (v) out.push(v);
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g;
  while ((m = slash.exec(text))) {
    const v = iso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    if (v) out.push(v);
  }
  return out;
}

/** A compact date in a narrow column header — "8/2/26" — is a header, not data. */
const NUMERIC_DATE_RE = /^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$/;

/**
 * Years named by a header: "2026 | 2025", and the fiscal shorthand a highlights
 * table uses when it has no room for dates — "Q4 FY26 | Q4 FY25". Without the
 * shorthand those two columns look equally current and the release is refused.
 */
function yearsIn(text: string): number[] {
  const out: number[] = [];
  const re = /\b(?:19|20)\d{2}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(parseInt(m[0], 10));
  // "FY26", "Q4 FY26", "Q3 26" and the compact "1Q26" a highlights table uses
  // when a column is too narrow for a date.
  const short = /\b(?:FY|fiscal(?:\s+year)?|Q[1-4]|[1-4]Q)\s*'?(\d{2}|\d{4})\b/gi;
  while ((m = short.exec(text))) {
    const n = parseInt(m[1], 10);
    out.push(m[1].length === 2 ? 2000 + n : n);
  }
  return out;
}

/** Does this text name a period at all — by duration, by a date, or by a year? */
function namesPeriod(text: string): boolean {
  return durationOf(text) !== 'unknown' || datesIn(text).length > 0 || yearsIn(text).length > 0;
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];

/** Which quarter of the fiscal year a label names, if it names one. */
function quarterOrdinalOf(text: string): number | null {
  const q = /\bQ([1-4])\b|\b([1-4])Q\b|\bQ([1-4])\d{2,4}\b|\b([1-4])Q\d{2,4}\b/i.exec(text);
  if (q) return parseInt(q[1] || q[2] || q[3] || q[4], 10);
  const w = /\b(first|second|third|fourth)[\s‐-―-]+quarter\b/i.exec(text);
  if (w) return ORDINALS.indexOf(w[1].toLowerCase()) + 1;
  return null;
}

/**
 * The quarter the release announces, taken from its own opening — the title and
 * the dateline. "Intuit Reports Fourth Quarter and Full-year 2026 Earnings" ⇒ 4.
 */
function headlineQuarterOf(html: string): number | null {
  const head = clean(html.slice(0, 60_000)).slice(0, 1200);
  return quarterOrdinalOf(head);
}

function daysBetween(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return NaN;
  return Math.abs(t1 - t2) / 86_400_000;
}

// ─── table candidates ─────────────────────────────────────────────────────

interface Candidate {
  value: number;
  label: string;                 // the filer's wording for the measure
  source: string;                // the row, verbatim, plus the column it was bound to
  tableIdx: number;
  rowIdx: number;
  colIdx: number;
  identity: string;              // measure identity, so a prior can be paired to it
  dates: string[];               // period-end dates bound to this cell
  year: number | null;           // fallback period key
  isBasic: boolean;
  gaapPeer: number | null;       // the unadjusted per-share value in the same column and block
}

/**
 * A header row carries no measured amount: text, punctuation and bare years
 * only. That lets a mid-table sub-header ("$ | Tax rate") still read as a
 * header while a data row never does.
 */
function isHeaderish(row: GridRow): boolean {
  for (const c of row.cells) {
    const t = c.text.trim();
    if (!t) continue;
    if (/[A-Za-z]/.test(t)) continue;
    if (/^\(?(?:19|20)\d{2}\)?$/.test(t)) continue;
    if (NUMERIC_DATE_RE.test(t)) continue;
    if (FILLER_RE.test(t)) continue;
    return false;
  }
  return true;
}

/** The leading text cells of a row — the measure name in a period-column table. */
function rowLabelOf(row: GridRow): string {
  const parts: string[] = [];
  for (const c of row.cells) {
    const t = c.text.trim();
    if (!t) continue;
    if (ANY_NUMBER_RE.test(t.replace(/[$\s]/g, ''))) break;
    if (FILLER_RE.test(t)) continue;
    parts.push(t);
    if (parts.join(' ').length > 240) break;
  }
  return stripUnitCaption(parts.join(' ')).trim();
}

interface TableModel {
  rows: GridRow[];
  preText: string;
  headerish: boolean[];
  rowLabels: string[];
  sections: string[];            // nearest full-width period row above each row
  caption: string;               // full-width title rows above the first data row
  hasLonger: boolean;
  contribs: Array<{ row: number; col: number; span: number; text: string }>;
}

function modelOf(t: ParsedTable): TableModel {
  const rows = t.rows;
  const headerish = rows.map(isHeaderish);
  const rowLabels = rows.map(rowLabelOf);

  // Full-width period rows ("Three Months Ended August 1, 2026") scope the rows
  // beneath them; that is how a metric-column reconciliation states its period.
  // A banner is short. The length caps keep a boilerplate paragraph ("…provided
  // below are non-GAAP financial measures…estimated…") from becoming a period
  // banner or a caption, where its stray words would decide a value's fate.
  const BANNER_MAX = 160;
  const CAPTION_MAX = 180;
  const sections: string[] = [];
  let current = '';
  for (let r = 0; r < rows.length; r++) {
    const nonEmpty = rows[r].cells.filter((c) => c.text.trim() && !FILLER_RE.test(c.text.trim()));
    if (nonEmpty.length === 1) {
      const s = stripUnitCaption(nonEmpty[0].text);
      if (s && s.length <= BANNER_MAX && namesPeriod(s)) current = s;
    }
    sections.push(current);
  }

  const firstData = headerish.findIndex((h) => !h);
  const capUpTo = firstData < 0 ? rows.length : firstData;
  const captionParts: string[] = [];
  for (let r = 0; r < capUpTo; r++) {
    const nonEmpty = rows[r].cells.filter((c) => c.text.trim());
    if (nonEmpty.length !== 1) continue;
    const s = stripUnitCaption(nonEmpty[0].text);
    if (s && s.length <= CAPTION_MAX) captionParts.push(s);
  }

  // Column labels come only from header cells that actually distinguish one
  // column from another. A row with a single cell is a caption or a period
  // banner spanning the whole table ("Reconciliation of Non-GAAP Financial
  // Measures") — letting it into every column's label would make a plain GAAP
  // row read as an adjusted one. It is kept separately, as caption/section.
  const contribs: TableModel['contribs'] = [];
  for (let r = 0; r < rows.length; r++) {
    if (!headerish[r]) continue;
    const nonFiller = rows[r].cells.filter((c) => c.text.trim() && !FILLER_RE.test(c.text.trim()));
    if (nonFiller.length < 2) continue;
    for (const c of nonFiller) {
      const s = stripUnitCaption(c.text);
      if (!s || FILLER_RE.test(s)) continue;
      if (UNIT_CAPTION_RE.test(s) && !datesIn(s).length) continue;
      contribs.push({ row: r, col: c.col, span: c.span, text: s });
    }
  }

  const flat = rows.map((r) => r.cells.map((c) => c.text).join(' ')).join(' ');
  return { rows, preText: t.preText, headerish, rowLabels, sections, caption: captionParts.join(' '), hasLonger: LONGER_RE.test(flat), contribs };
}

/**
 * The row-group header in the stub column — the shape where the measure is
 * named once for a block and the rows below carry only the basis:
 *     Net income per share attributable to A&F   2026    2025
 *     GAAP                                       $4.17   $2.91
 *     Excluded item, net of tax                      -    0.59
 *     Adjusted non-GAAP                          $4.17   $2.32
 * Without it "Adjusted non-GAAP" names no measure at all. Only a header row
 * that also carries column headings qualifies, so a table's title block can
 * never lend "per share" to a row of dollars.
 */
function stubLabel(m: TableModel, aboveRow: number, col: number): string {
  for (let r = aboveRow - 1; r >= 0; r--) {
    if (!m.headerish[r]) continue;
    const nonFiller = m.rows[r].cells.filter((c) => c.text.trim() && !FILLER_RE.test(c.text.trim()));
    if (nonFiller.length < 2) continue;
    const first = m.rows[r].cells.find((c) => c.col === 0);
    if (!first) continue;
    if (col < first.col + first.span) continue;            // it covers our column: a header, not a stub
    const s = stripUnitCaption(first.text);
    if (s && !FILLER_RE.test(s)) return s;
  }
  return '';
}

function columnLabel(m: TableModel, aboveRow: number, col: number): string {
  const parts: string[] = [];
  for (const c of m.contribs) {
    if (c.row >= aboveRow) continue;
    if (col < c.col || col >= c.col + c.span) continue;
    parts.push(c.text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The period a column inherits from the group header on its LEFT. Filers pair
 * an amount column with a per-share column and head only the pair:
 *     July 31, 2026 | Diluted Net EPS | April 30, 2026 | Diluted Net EPS | …
 * The EPS column names no period of its own; the one it belongs to is the
 * nearest period-bearing header cell entirely to its left in the same header
 * row. Applied only when no cell covering the column names a period, so a
 * column that does describe itself is never overruled.
 */
function inheritedPeriod(m: TableModel, aboveRow: number, col: number): string {
  const parts: string[] = [];
  for (let r = 0; r < aboveRow; r++) {
    if (!m.headerish[r]) continue;
    const cells = m.rows[r].cells;
    if (cells.some((c) => col >= c.col && col < c.col + c.span && namesPeriod(stripUnitCaption(c.text)))) continue;
    let best: { col: number; text: string } | null = null;
    for (const c of cells) {
      if (c.col + c.span > col) continue;
      const s = stripUnitCaption(c.text);
      if (!s || !namesPeriod(s)) continue;
      if (!best || c.col > best.col) best = { col: c.col, text: s };
    }
    if (best) parts.push(best.text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Words that say which BASIS a column is on, rather than which period. */
const BASIS_WORDS_RE = /\b(?:results\s+under\s+gaap|non[\s‐-―-]?gaap\s+results|non[\s‐-―-]?gaap|gaap|as\s+reported|reported|as\s+adjusted|adjusted|adjustments?)\b/gi;
const GAAP_MARK_RE = /\bGAAP\b|\bas\s+reported\b|\breported\b/i;

/** The column label with the period stripped out — what is left names a measure. */
function measurePartOf(colLabel: string): string {
  const s = colLabel
    .replace(new RegExp(DATE_SRC, 'gi'), ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:for\s+the\s+)?(?:three|six|nine|twelve|thirteen|fourteen|twenty[\s‐-―-]*six|thirty[\s‐-―-]*nine|fifty[\s‐-―-]*(?:two|three)|\d{1,2})[\s‐-―-]*(?:months?|weeks?)\s*(?:ended|ending)?\b/gi, ' ')
    .replace(/\b(?:first|second|third|fourth)\s+quarter\b|\bquarter\s+ended\b|\bQ[1-4]\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return PER_SHARE_RE.test(s) ? s : '';
}

/** The column label with basis words and footnote markers removed — the period. */
function periodPartOf(colLabel: string): string {
  return colLabel
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(BASIS_WORDS_RE, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim().toLowerCase();
}

/**
 * When the only "adjusted" marker is in the COLUMN header, the table must be a
 * reconciliation — GAAP alongside Non-GAAP for the same period. Demanding the
 * GAAP sibling column is what separates a real "Non-GAAP Results" column from
 * "As Adjusted" over a comparative income-statement column, which means
 * RESTATED and whose numbers are ordinary GAAP.
 */
function hasGaapSiblingColumn(m: TableModel, rowIdx: number, colIdx: number, colLabel: string): boolean {
  const want = periodPartOf(colLabel);
  for (const cell of m.rows[rowIdx].cells) {
    if (cell.col === colIdx) continue;
    if (!perShareNumber(cell.text)) continue;
    const sib = columnLabel(m, rowIdx, cell.col);
    if (!sib || ADJ_RE.test(sib) || !GAAP_MARK_RE.test(sib)) continue;
    if (periodPartOf(sib) === want) return true;
  }
  return false;
}

/** The unadjusted per-share value printed in the same column and period block. */
function gaapPeerFor(m: TableModel, rowIdx: number, colIdx: number, colLabel: string): number | null {
  const section = m.sections[rowIdx];
  let fallback: number | null = null;
  for (let r = 0; r < m.rows.length; r++) {
    if (r === rowIdx || m.headerish[r]) continue;
    if (m.sections[r] !== section) continue;
    const l = m.rowLabels[r];
    if (!l) continue;
    const measure = PER_SHARE_RE.test(`${l} ${colLabel}`)
      ? `${l} ${colLabel}`
      : `${l} ${colLabel} ${stubLabel(m, r, colIdx)}`;
    if (ADJ_RE.test(`${l} ${colLabel}`)) continue;
    if (!PER_SHARE_RE.test(measure) || NOT_EPS_RE.test(measure)) continue;
    const cell = m.rows[r].cells.find((c) => c.col === colIdx && perShareNumber(c.text));
    if (!cell) continue;
    const n = perShareNumber(cell.text);
    if (!n) continue;
    // Prefer the row that actually names the GAAP total over a reconciling line.
    if (/\bGAAP\b|\breported\b|\bnet\s+(?:income|loss|earnings)\b|\bearnings\b|\bEPS\b/i.test(l)) return n.value;
    if (fallback === null) fallback = n.value;
  }
  return fallback;
}

function collectTableCandidates(t: ParsedTable, tableIdx: number, headlineQuarter: number | null): Candidate[] {
  const m = modelOf(t);
  const out: Candidate[] = [];

  for (let r = 0; r < m.rows.length; r++) {
    if (m.headerish[r]) continue;
    const rowLabel = m.rowLabels[r];
    if (!rowLabel) continue;
    if (RECONCILING_ROW_RE.test(rowLabel)) continue;
    const row = m.rows[r];
    const section = m.sections[r];

    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i];
      const n = perShareNumber(cell.text);
      if (!n) continue;
      // A percentage whose sign sits in the next cell is not an EPS.
      const next = row.cells.slice(i + 1).find((c) => c.text.trim());
      if (next && /^[)\s]*%/.test(next.text.trim())) continue;

      const colLabel = columnLabel(m, r, cell.col);
      if (BAD_COLUMN_RE.test(colLabel)) continue;

      const stub = PER_SHARE_RE.test(`${rowLabel} ${colLabel}`) ? '' : stubLabel(m, r, cell.col);
      const measure = `${rowLabel} ${colLabel} ${stub}`.trim();
      if (!ADJ_RE.test(measure)) continue;
      if (!PER_SHARE_RE.test(measure)) continue;
      if (NOT_EPS_RE.test(measure)) continue;
      // The heading that makes a table an outlook is often OUTSIDE it —
      // "Reconciliation of Non-GAAP Financial Measures in Summary Guidance"
      // sits above the table, and Dell's Q3 guidance column would otherwise be
      // the most recent-looking column in the whole release.
      if (GUIDANCE_RE.test(`${rowLabel} ${colLabel} ${section} ${m.caption} ${m.preText.slice(-240)}`)) continue;
      if (!ADJ_RE.test(rowLabel) && !hasGaapSiblingColumn(m, r, cell.col, colLabel)) continue;

      // ── bind the value to a period, most specific evidence first ─────────
      let bound = colLabel;
      if (!namesPeriod(bound)) {
        const inh = inheritedPeriod(m, r, cell.col);
        if (inh) bound = `${bound} ${inh}`.trim();
      }
      let dur = durationOf(bound);
      if (dur === 'unknown' && section) { bound = `${bound} ${section}`; dur = durationOf(bound); }
      if (dur === 'unknown') {
        // The heading may sit above the table rather than inside it — but only
        // trust that when the table itself mixes in no longer period, or the
        // quarter/YTD pair is in this table and must be resolved from it.
        if (m.hasLonger) continue;
        dur = durationOf(`${bound} ${m.caption} ${m.preText}`);
      }
      if (dur !== 'quarter') continue;
      if (FORWARD_RE.test(`${bound} ${section} ${m.caption}`)) continue;

      // A column that names its own period ("2026", "August 2, 2026") is not
      // allowed to inherit the banner's dates — a banner covering the whole
      // block often names BOTH years ("Thirteen Weeks Ended August 1, 2026 and
      // August 2, 2025"), which would make every column match every period.
      const colDates = datesIn(colLabel);
      const colYears = yearsIn(colLabel);
      let dates: string[];
      let year: number | null;
      if (colDates.length) { dates = colDates; year = parseInt(colDates[colDates.length - 1].slice(0, 4), 10); }
      else if (colYears.length) { dates = []; year = colYears[colYears.length - 1]; }
      else {
        dates = datesIn(bound);
        const ys = yearsIn(bound).concat(yearsIn(section));
        year = dates.length ? parseInt(dates[dates.length - 1].slice(0, 4), 10) : (ys.length ? ys[ys.length - 1] : null);
      }

      // A column headed with a bare quarter ordinal — "Q1 | Q2 | Q3 | Q4" down
      // a fiscal year — says which quarter but not which one is being reported.
      // Only the quarter the release itself announces can be it.
      const ord = quarterOrdinalOf(bound);
      if (ord !== null && !dates.length && ord !== headlineQuarter) continue;

      const label = (PER_SHARE_RE.test(rowLabel) && ADJ_RE.test(rowLabel))
        ? rowLabel
        : [stub, rowLabel, measurePartOf(colLabel)].filter(Boolean).join(' — ');
      const rowText = row.cells.map((c) => c.text.trim()).filter((s) => s && !/^[\s]*$/.test(s)).join(' | ');
      out.push({
        value: n.value,
        label,
        source: `${rowText}  [column: ${bound}]`,
        tableIdx,
        rowIdx: r,
        colIdx: cell.col,
        identity: `${tableIdx}|${label.toLowerCase()}`,
        dates,
        year,
        isBasic: /\bbasic\b/i.test(measure) && !/\bdiluted\b/i.test(measure),
        gaapPeer: gaapPeerFor(m, r, cell.col, colLabel),
      });
    }
  }
  return out;
}

// ─── sentences and bullets ────────────────────────────────────────────────

const BLOCK_SENTINEL = '\u0001';

/** Visible text split at block-level boundaries, in document order. */
function blocks(html: string): string[] {
  const marked = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|table|ul|ol|blockquote)\s*>/gi, BLOCK_SENTINEL)
    .replace(/<(?:br|hr)\s*\/?>/gi, BLOCK_SENTINEL)
    .replace(/<(?:p|div|li|tr|h[1-6])\b[^>]*>/gi, BLOCK_SENTINEL);
  const out: string[] = [];
  for (const raw of decodeEntities(marked.replace(/<[^>]*>/g, ' ')).split(BLOCK_SENTINEL)) {
    const t = raw.replace(INVISIBLE_RE, ' ').replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Whether a block sits under a heading that scopes it to a longer period.
 * "adjusted EPS totaled $1.73" under "First Half Fiscal 2026 Results / (26
 * weeks ended August 1, 2026 …)" is the half-year, never the quarter.
 */
function periodScope(all: string[], idx: number): Duration {
  for (let i = idx; i >= 0 && i > idx - 40; i--) {
    const t = all[i];
    if (t.length > 400) continue;                     // a paragraph, not a heading
    if (i !== idx && t.length > 200) continue;
    const d = durationOf(t);
    if (d !== 'unknown') return d;
  }
  return 'unknown';
}

interface SentenceHit { value: number; prior: number | null; label: string; source: string }

// A dollar amount printed to cents, with either style of negative wrapper.
const MONEY = String.raw`(\()?\s*([-‐-―])?\s*\$\s*(\()?\s*([-‐-―])?\s*(\d{1,3}\.\d{2,4})\s*(\))?`;
const MONEY_GROUPS = 6;

/**
 * "…adjusted diluted EPS of $1.68", "non-GAAP diluted EPS was $0.08", and with
 * the appositive filers like to insert — "adjusted EPS, excluding special
 * items, was $1.30".
 */
const SHAPE_A = new RegExp(
  String.raw`((?:adjusted|non[\s‐-―-]?gaap)[A-Za-z()'\s‐-―-]{0,60}?(?:EPS|(?:earnings|income|loss)\s+per\s+(?:[A-Za-z-]+\s+){0,2}shares?|per\s+(?:[A-Za-z-]+\s+){0,2}shares?))` +
  String.raw`\s*(?:\d\s*)?(?:,\s*(?:excluding|including|adjusted|net)[^.$;]{0,50}?,)?\s*` +
  String.raw`(?:of|was|were|is|are|at|totall?ed|totaling|came\s+in\s+at|increased[^.$]{0,40}?to|decreased[^.$]{0,40}?to|grew[^.$]{0,40}?to|rose[^.$]{0,40}?to|improved[^.$]{0,40}?to|declined[^.$]{0,40}?to|,)?\s*` +
  MONEY,
  'i',
);

/** "Adjusted net income … was $80 million, or $0.95 per diluted share" */
const SHAPE_B = new RegExp(
  String.raw`((?:adjusted|non[\s‐-―-]?gaap)\s+net\s+(?:income|loss|earnings)[^.;]{0,180}?),?\s+or\s+` + MONEY +
  String.raw`\s+per\s+(?:[A-Za-z-]+\s+){0,2}shares?`,
  'i',
);

/**
 * The measure named first and marked non-GAAP in a trailing parenthetical:
 * "comparable EPS (non-GAAP) grew 11% to $0.97". Reconciliation tables already
 * read this convention — the marker is inside the row label — and prose uses
 * it just as often. The parenthetical must sit immediately after the per-share
 * term, which is what keeps the shape narrow.
 */
const SHAPE_D = new RegExp(
  String.raw`((?:[A-Za-z][A-Za-z-]*\s+){0,3}(?:EPS|(?:earnings|income)\s+per\s+(?:[A-Za-z-]+\s+){0,2}shares?)\s*\(\s*(?:non[\s‐-―-]?gaap|adjusted)\s*\))` +
  String.raw`\s*(?:of|was|were|is|are|at|totall?ed|grew[^.$]{0,40}?to|increased[^.$]{0,40}?to|decreased[^.$]{0,40}?to|rose[^.$]{0,40}?to|declined[^.$]{0,40}?to|,)?\s*` +
  MONEY,
  'i',
);

/** "GAAP diluted EPS of $2.84 per share, or $2.10 on a non-GAAP basis" */
const SHAPE_C = new RegExp(
  MONEY + String.raw`\s+(?:per\s+(?:[A-Za-z-]+\s+){0,2}shares?[\s,]+)?on\s+an?\s+(adjusted|non[\s‐-―-]?gaap)\s+basis`,
  'i',
);

/** Reads one MONEY group block starting at `base`; honours either negative form. */
function moneyAt(m: RegExpExecArray, base: number): number | null {
  const digits = m[base + 4];
  if (digits === undefined) return null;
  const v = parseFloat(digits);
  if (!Number.isFinite(v)) return null;
  const neg = Boolean(m[base]) || Boolean(m[base + 1]) || Boolean(m[base + 2]) || Boolean(m[base + 3]) || Boolean(m[base + 5]);
  return neg ? -v : v;
}

// Within one sentence, so a decimal point must not stop the scan.
const COMPARED_RE = new RegExp(String.raw`^[^;]{0,70}?\b(?:compared\s+(?:to|with)|versus|vs\.?)\s+` + MONEY, 'i');

/**
 * Framing that makes the amount which FOLLOWS it a year-ago figure, not this
 * quarter's: "This result compares to last year's second quarter adjusted net
 * income of $27 million, or $0.33 per diluted share."
 */
const PRIOR_FRAME_RE = /\b(?:last\s+year|prior[\s-]year|prior\s+fiscal|year[\s-]ago|a\s+year\s+earlier|same\s+(?:period|quarter)\s+(?:of|in)|compares?\s+(?:to|with)|compared\s+(?:to|with)|versus|vs\.)\b/i;

/** Headings that scope everything under them to an outlook rather than a result. */
const GUIDANCE_HEADING_RE = /\b(?:outlook|guidance|forecast|expectations?)\b/i;

/** What follows a guidance figure: the other end of its range. */
const RANGE_TAIL_RE = /^\s*(?:to|-|‐|‑|‒|–|—|and)\s*\$?\s*\d{1,3}\.\d{2,4}/i;

function sentenceHits(html: string): SentenceHit[] {
  const all = blocks(html);
  const hits: SentenceHit[] = [];
  for (let i = 0; i < all.length; i++) {
    const block = all[i];
    if (block.length > 1400) continue;
    if (!ADJ_RE.test(block) || !PER_SHARE_RE.test(block)) continue;
    if (durationOf(block) === 'longer') continue;
    if (periodScope(all, i) === 'longer') continue;
    // Under an "…Outlook" or "…Guidance" heading nothing is a reported result.
    let underGuidance = false;
    for (let k = i; k >= 0 && k > i - 8; k--) {
      if (all[k].length < 120 && GUIDANCE_HEADING_RE.test(all[k])) { underGuidance = true; break; }
    }
    if (underGuidance) continue;

    // Sentence-level, so one bullet's year-to-date aside cannot contaminate the
    // quarter's number.
    // Split on the semicolon too: "EPS was $0.92 …; adjusted EPS … was $1.30"
    // is two claims, and treating it as one lets the first one's "compared to"
    // condemn the second.
    for (const s of block.split(/(?<=[.;])\s+/)) {
      if (!ADJ_RE.test(s) || !PER_SHARE_RE.test(s)) continue;
      if (durationOf(s) === 'longer') continue;

      const tries: Array<[RegExp, number, number]> = [[SHAPE_A, 1, 2], [SHAPE_B, 1, 2], [SHAPE_D, 1, 2], [SHAPE_C, MONEY_GROUPS + 1, 1]];
      for (const [re, labelGroup, moneyBase] of tries) {
        const m = re.exec(s);
        if (!m) continue;
        const v = moneyAt(m, moneyBase);
        if (v === null) continue;
        // Everything that qualifies the amount stands BEFORE it: an outlook verb
        // makes it a forecast, a year-ago framing makes it the prior period.
        // What follows ("…, which beat the guidance range of $90 to $100
        // million") describes the result, and must not condemn it.
        const prefix = s.slice(0, m.index + m[0].length);
        if (GUIDANCE_RE.test(prefix)) continue;
        if (PRIOR_FRAME_RE.test(s.slice(Math.max(0, m.index - 90), m.index))) continue;
        // A reported result is one number. "$4.99 to $5.04" is a range, and a
        // range is always an outlook — even when the sentence never says so.
        if (RANGE_TAIL_RE.test(s.slice(m.index + m[0].length))) continue;
        const rawLabel = (labelGroup === 1 && m[1] ? m[1] : 'adjusted / non-GAAP EPS').replace(/\s+/g, ' ').trim();
        if (NOT_EPS_RE.test(rawLabel)) continue;
        if (/\bbasic\b/i.test(rawLabel) && !/\bdiluted\b/i.test(rawLabel)) continue;

        let prior: number | null = null;
        const cmp = COMPARED_RE.exec(s.slice(m.index + m[0].length));
        if (cmp) prior = moneyAt(cmp, 1);
        hits.push({ value: v, prior, label: rawLabel, source: s.trim() });
        break;
      }
    }
  }
  return hits;
}

// ─── the export ───────────────────────────────────────────────────────────

/**
 * The filer's own adjusted / non-GAAP diluted EPS for the quarter the release
 * reports, or null when the release does not state one — which is the common
 * case and the correct answer for it.
 *
 * Pure: no network, no state, no other project module. The caller fetches the
 * 8-K's EX-99.1 and passes its HTML.
 */
export function adjustedEpsFromReleaseHtml(html: string, opts?: AdjustedEpsOptions): AdjustedEps | null {
  if (!html || typeof html !== 'string' || html.length < 200) return null;
  // A release published as page images (a scanned shareholder letter) carries no
  // readable words. There is nothing to read, and nothing to guess.
  if (!ADJ_RE.test(html)) return null;

  const gaap = typeof opts?.gaapEps === 'number' && Number.isFinite(opts.gaapEps) ? opts.gaapEps : null;
  const periodEnd = opts?.periodEndISO && /^\d{4}-\d{2}-\d{2}$/.test(opts.periodEndISO) ? opts.periodEndISO : null;

  // ── 1. the reconciliation tables ────────────────────────────────────────
  const tables = parseTables(html);
  let all: Candidate[] = [];
  const headlineQuarter = headlineQuarterOf(html);
  for (let i = 0; i < tables.length; i++) all = all.concat(collectTableCandidates(tables[i], i, headlineQuarter));

  // Diluted beats basic; a basic-only figure is not the measure we report.
  const diluted = all.filter((c) => !c.isBasic);
  let cands = diluted.length ? diluted : [];

  // ── 2. pin the column to the reported quarter ───────────────────────────
  if (periodEnd) {
    const dated = cands.filter((c) => c.dates.length);
    const matched = dated.filter((c) => c.dates.some((d) => daysBetween(d, periodEnd) <= 5));
    if (matched.length) cands = matched;
    else if (dated.length === cands.length) cands = [];   // every column names a period, none is ours
    else cands = cands.filter((c) => !c.dates.length);    // undated highlight tables only
  }
  // The reported quarter is the latest period the release shows. Year first,
  // then the date within it: a column headed only "2026" and one headed
  // "August 2, 2026" describe the same quarter, and neither may be outranked
  // by a prior-year column that happens to carry the more precise label.
  const years = cands.map((c) => c.year).filter((y): y is number => y !== null);
  if (years.length) {
    // A candidate whose period could not be pinned to a year at all is weaker
    // evidence than one that could; it does not get to outvote them.
    const maxYear = Math.max(...years);
    cands = cands.filter((c) => c.year === maxYear);
  }
  const dateKeys = cands.map((c) => (c.dates.length ? c.dates[c.dates.length - 1] : '')).filter(Boolean);
  if (dateKeys.length) {
    const maxDate = dateKeys.reduce((a, b) => (b > a ? b : a));
    cands = cands.filter((c) => !c.dates.length || c.dates[c.dates.length - 1] === maxDate);
  }

  const chosen = pickUnanimous(cands);
  if (chosen) {
    // A "non-GAAP" number identical to GAAP is only believable when the release
    // itself puts the two side by side.
    if (gaap !== null && Math.abs(chosen.value - gaap) < 0.005
      && !(chosen.gaapPeer !== null && Math.abs(chosen.gaapPeer - chosen.value) < 0.005)) return null;
    // The year-ago figure may sit beside any of the cells that agreed on the
    // value — a highlights table often shows the quarter alone while the
    // reconciliation behind it shows both years.
    let prior: number | null = null;
    for (const c of cands) { prior = priorFor(c, all); if (prior !== null) break; }
    return { value: chosen.value, prior, label: chosen.label, source: chosen.source };
  }
  if (cands.length) return null;                     // the tables disagree; say nothing

  // ── 3. the headline bullet and the sentence ─────────────────────────────
  const hits = sentenceHits(html);
  if (!hits.length) return null;
  if (new Set(hits.map((h) => h.value.toFixed(4))).size !== 1) return null;   // two different claims
  const hit = hits.find((h) => h.prior !== null) || hits[0];
  if (gaap !== null && Math.abs(hit.value - gaap) < 0.005) {
    // Accept only when the sentence states the equality itself — "reported and
    // adjusted EPS of $0.50", "GAAP and non-GAAP diluted EPS of $x".
    const both = /\b(?:reported|GAAP)\b[^.]{0,40}\band\b[^.]{0,40}\b(?:adjusted|non[\s‐-―-]?gaap)\b/i.test(hit.source)
      || /\b(?:adjusted|non[\s‐-―-]?gaap)\b[^.]{0,40}\band\b[^.]{0,40}\b(?:reported|GAAP)\b/i.test(hit.source);
    if (!both) return null;
  }
  return { value: hit.value, prior: hit.prior, label: hit.label, source: hit.source };
}

/** One value, or nothing. Several cells stating the same number are fine. */
function pickUnanimous(cands: Candidate[]): Candidate | null {
  if (!cands.length) return null;
  if (new Set(cands.map((c) => c.value.toFixed(4))).size !== 1) return null;
  return cands[0];
}

/**
 * The year-ago quarter for the same measure: the same labelled measure in the
 * same table, bound to a quarter roughly a year earlier. Absent or ambiguous
 * ⇒ null, never a guess.
 */
function priorFor(chosen: Candidate, siblings: Candidate[]): number | null {
  const pool = siblings.filter((c) => c.identity === chosen.identity && !(c.rowIdx === chosen.rowIdx && c.colIdx === chosen.colIdx));
  const ck = chosen.dates.length ? chosen.dates[chosen.dates.length - 1] : null;
  const matches = pool.filter((c) => {
    if (ck && c.dates.length) return c.dates.some((d) => { const g = daysBetween(d, ck); return g >= 300 && g <= 430; });
    if (chosen.year && c.year && !ck && !c.dates.length) return c.year === chosen.year - 1;
    return false;
  });
  if (!matches.length) return null;
  return new Set(matches.map((c) => c.value.toFixed(4))).size === 1 ? matches[0].value : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// IS THE VENDOR'S *ESTIMATE* ON THE SAME BASIS AS THE ACTUAL WE PUBLISH?
//
// WHY THIS EXISTS — THE FILER THAT EXPOSED IT
// ────────────────────────────────────────────
// SentinelOne (S), Q2 FY27, filed 27 Aug 2026. The release states non-GAAP
// diluted EPS of +$0.08; the 10-Q's XBRL states GAAP diluted EPS of −$0.27.
// Yahoo's earningsHistory returned, for that same quarter, actual −$0.27 (the
// GAAP line, to the cent) and estimate −$0.23174 — and its three prior rows are
// the same story: actual −0.18 / −0.33 / −0.23 against XBRL GAAP of
// −0.18 / −0.33 / −0.23. For this filer that feed publishes a GAAP-basis
// consensus end to end. The engine resolved the ADJUSTED actual correctly from
// the release (+$0.08) and then paired it with that GAAP-basis estimate, and
// the card announced a "+$0.31 beat" against a "$-0.23 street estimate". Both
// halves of that sentence are false: the real adjusted street number for the
// quarter was around $0.07, so the print was a penny beat, not a thirty-one
// cent one, and no such estimate was ever published by anyone.
//
// The route already refused the MIRROR of this — `vendorLooksGaap` stops the
// feed's "adjusted actual" being used when it is really the GAAP figure, with a
// comment saying a surprise must never be struck across two bases. That guard
// was one-sided: it policed the ACTUAL and never the ESTIMATE. This closes the
// other half, and it is the same principle, so it reads the same way: an
// estimate and an actual must be on one basis or NO surprise is published.
//
// HOW IT DECIDES — EVIDENCE, NEVER SIZE
// ──────────────────────────────────────
// "These two numbers are far apart, so one of them must be wrong" is the
// reasoning that manufactures wrong numbers; a genuine 80% miss looks exactly
// like that. So nothing here keys on the size of the surprise. It keys on WHERE
// THE ESTIMATE SITS between two figures we hold hard evidence for:
//
//   • GAAP diluted EPS for the quarter — the filer's own XBRL;
//   • the adjusted EPS we are about to publish — read out of the filer's own
//     release by `adjustedEpsFromReleaseHtml` above.
//
// When those two differ materially, the interval between them IS the basis
// question, and the estimate's position in it is the answer. An estimate lying
// on top of the GAAP end of that interval, while the actual we publish is the
// adjusted end, is a mismatch. Two worked cases from one week of filings:
//
//   S     GAAP −0.27  adj +0.08  spread 0.35 — estimate −0.232 sits 11% of the
//         way from the GAAP end. GAAP-basis estimate. Refuse.
//   GAP   GAAP  1.38  adj  0.52  spread 0.86 — estimate 0.491 sits 103% of the
//         way from the GAAP end, i.e. hard against the ADJUSTED end. Gap's
//         estimate really is the adjusted consensus (the feed's ACTUAL is the
//         GAAP one — the mirror defect), so Gap keeps its real +$0.03 beat.
//
// Position alone is not enough: a company can genuinely miss by an amount that
// happens to land the estimate near its GAAP line (Workday's Q2 FY27 estimate
// 2.612 sits between a 2.57 GAAP line and a 2.75 adjusted actual, and that is a
// real 5% beat, not a basis error). So a position finding must be CORROBORATED
// by direct evidence about what basis this feed is publishing for this filer:
//
//   W1 — the feed's own ACTUAL for this same quarter reproduces the filer's
//        XBRL GAAP EPS. The estimate beside it is then being quoted off the
//        same book. This is the SentinelOne signature, and Aptera Motors' —
//        an estimate of −0.30 settled against a −0.30 GAAP actual while the
//        release states an adjusted −0.20.
//   W2 — the feed's prior quarters do the same thing: its estimate and its
//        actual agree with each other AND its actual reproduces that quarter's
//        XBRL GAAP EPS. Two such quarters is the witness (one is coincidence —
//        SAIC has exactly one, because adjusted and GAAP happened to coincide
//        in that quarter, and SAIC's estimate is a perfectly good adjusted
//        one).
//
// EVERY THRESHOLD BELOW IS A RATIO OF THE GAAP↔ADJUSTED SPREAD OR OF THE FIGURE
// ITSELF — never an absolute cent count tuned to a filer, never a rule about
// the sign of the estimate. A negative estimate against a profitable adjusted
// actual is suspicious (it is what made this bug visible) but plenty of issuers
// are genuinely expected to lose money, so the sign is not evidence and is not
// consulted. Companies whose adjusted EPS equals their GAAP EPS have no basis
// question to answer and are never touched.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The two bases must differ by at least this much before the question "which
 * basis is this estimate on?" is even meaningful. Below it, GAAP and adjusted
 * are the same number for practical purposes and any estimate is on both.
 * A nickel, i.e. the smallest gap at which a mis-basing could move a verdict.
 */
const BASIS_SPREAD_FLOOR = 0.05;
/**
 * How close to the GAAP end of the GAAP↔adjusted interval an estimate must sit
 * before we will say it is quoted on the GAAP basis, as a fraction of that
 * interval. A quarter of the way is deliberately conservative: in a full week
 * of filings the flagged cases sat at 0.09 and 0.11 while the nearest genuine
 * adjusted estimate sat at 0.61, so the boundary is in open space and not
 * fitted to anything.
 */
const BASIS_HUG = 0.25;

export interface VendorEpsRow {
  /** The feed's consensus estimate for that quarter. */
  estimate: number | null;
  /** The feed's "actual" for that quarter. */
  actual: number | null;
  /** The filer's OWN GAAP diluted EPS for that same quarter, from XBRL. */
  gaapEps: number | null;
}

export interface EpsEstimateBasisInput {
  /** The vendor consensus we would publish a surprise against. */
  estimate: number | null;
  /** The actual we are publishing — normally the release's adjusted EPS. */
  actual: number | null;
  /** The filer's own GAAP diluted EPS for the reported quarter, from XBRL. */
  gaapEps: number | null;
  /** The feed's own "actual" for the reported quarter, if it carries one. */
  vendorActual?: number | null;
  /** Earlier quarters from the same feed, each paired with that quarter's XBRL GAAP EPS. */
  history?: VendorEpsRow[];
}

export interface EpsEstimateBasisVerdict {
  /** True when estimate and actual are demonstrably on DIFFERENT bases. */
  conflict: boolean;
  /** A short, honest sentence for the card when `conflict` — else null. */
  note: string | null;
  /** The witnesses, for the route's notes and for anyone auditing a refusal. */
  evidence: string[];
}

/** Two figures the same to within a cent, or to within 1% of the larger — a
 *  feed rounds to the cent and a filer does not always. */
function sameFigure(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.011, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
}

/** Which book a per-share figure is quoted from, when the two books are far
 *  enough apart for the question to have an answer. */
export type EpsBasis = 'gaap' | 'adjusted' | 'indeterminate';

/**
 * Attribute one per-share figure to the GAAP or the adjusted book, using the
 * gap between the filer's OWN two figures as the ruler.
 *
 * This is the whole detection primitive, and it is deliberately about position,
 * not about size: a figure is called GAAP only when it sits within a quarter of
 * the gap from the GAAP end, and adjusted only when it sits that close to the
 * adjusted end. Anything in between — which is where an ordinary beat or miss
 * lives — is `indeterminate`, and an indeterminate answer never suppresses
 * anything.
 *
 * When the filer's adjusted EPS IS its GAAP EPS (retailers frequently report
 * one number on both bases) there is no gap to measure against and every figure
 * is indeterminate, which is correct: no basis mistake is possible.
 */
export function attributeEpsBasis(
  value: number | null | undefined,
  gaapEps: number | null | undefined,
  adjustedEps: number | null | undefined,
): EpsBasis {
  if (value == null || gaapEps == null || adjustedEps == null) return 'indeterminate';
  if (!Number.isFinite(value) || !Number.isFinite(gaapEps) || !Number.isFinite(adjustedEps)) return 'indeterminate';
  const spread = Math.abs(gaapEps - adjustedEps);
  if (spread < BASIS_SPREAD_FLOOR) return 'indeterminate';
  if (Math.abs(value - gaapEps) <= BASIS_HUG * spread) return 'gaap';
  if (Math.abs(value - adjustedEps) <= BASIS_HUG * spread) return 'adjusted';
  return 'indeterminate';
}

export function epsEstimateBasisConflict(i: EpsEstimateBasisInput): EpsEstimateBasisVerdict {
  const ok = (): EpsEstimateBasisVerdict => ({ conflict: false, note: null, evidence: [] });
  const { estimate: est, actual: act, gaapEps: gaap } = i;
  if (est == null || act == null || gaap == null) return ok();

  // WHERE THE ESTIMATE SITS. Only an estimate hugging the GAAP end of the
  // GAAP↔adjusted gap is a finding; the middle of that gap is what an ordinary
  // beat or miss looks like, and a filer whose two bases coincide has no gap.
  if (attributeEpsBasis(est, gaap, act) !== 'gaap') return ok();
  const spread = Math.abs(gaap - act);

  // CORROBORATION. What basis is this feed actually publishing for this filer?
  const evidence: string[] = [];
  const vAct = i.vendorActual ?? null;
  if (vAct != null && sameFigure(vAct, gaap)) {
    evidence.push(`the feed's own actual for this quarter (${vAct.toFixed(2)}) is the filer's GAAP diluted EPS (${gaap.toFixed(2)})`);
  }
  // Prior quarters where the feed's estimate and actual agree with EACH OTHER
  // and its actual reproduces that quarter's XBRL GAAP EPS: a feed quoting a
  // GAAP consensus and settling it against the GAAP result.
  let gaapQuarters = 0;
  for (const h of i.history || []) {
    if (h.estimate == null || h.actual == null || h.gaapEps == null) continue;
    // "Agree with each other" is generous — a consensus mean is never exactly
    // the print — but it must be far tighter than the basis spread it is being
    // used to argue about.
    const close = Math.abs(h.estimate - h.actual) <= Math.max(0.02, 0.05 * Math.abs(h.actual));
    if (close && sameFigure(h.actual, h.gaapEps)) gaapQuarters++;
  }
  if (gaapQuarters >= 2) {
    evidence.push(`${gaapQuarters} earlier quarters where this feed's estimate, its actual and the filer's XBRL GAAP EPS all agree`);
  }
  if (!evidence.length) return ok();

  evidence.unshift(
    `the estimate (${est.toFixed(2)}) sits on the GAAP end of a ${spread.toFixed(2)} gap between GAAP EPS (${gaap.toFixed(2)}) and the release's adjusted EPS (${act.toFixed(2)})`,
  );
  return {
    conflict: true,
    note: 'the consensus estimate on file is struck on the GAAP basis while the actual here is the company\u2019s own adjusted EPS — a surprise across two bases would not be a real one, so none is shown',
    evidence,
  };
}

/**
 * THE VENDOR'S OWN SURPRISE PERCENTAGE, judged by the same rule.
 *
 * The PRELIM path (a print whose 10-Q has not posted) does not compute its own
 * surprise — it forwards the feed's `surprisePercent`. That figure is only as
 * sound as the feed's own pairing, and the feed does mix its books: for Gap's
 * Q2 FY27 it published an estimate of $0.491 beside an actual of $1.38 — the
 * GAAP line to the cent, where the release's adjusted diluted EPS is $0.52 —
 * and called it +180.9%. The truth is about +6%. Williams-Sonoma (a $2.84 GAAP
 * actual against a filed non-GAAP $2.10) and TJX ($1.36 GAAP against a filed
 * $1.22) are the same shape.
 *
 * THIS ONE REFUSES ONLY ON AN EQUALITY, NEVER ON A POSITION. `attributeEpsBasis`
 * is safe for the ESTIMATE only because `epsEstimateBasisConflict` corroborates
 * it; used bare it mistakes an ordinary miss for a basis error — Workday's
 * 2.612 estimate sits a nickel from its 2.57 GAAP line and 0.14 from its 2.75
 * adjusted actual, and it is a perfectly good adjusted estimate. So the test
 * here is the one thing that cannot be a coincidence: the feed's actual
 * REPRODUCES the filer's GAAP diluted EPS while the figure the card is
 * displaying is the filer's adjusted EPS. The feed settled on one book and the
 * card is narrating the other, so its percentage is not the card's surprise —
 * whichever book its estimate came from.
 */
export function vendorSurpriseUsable(i: {
  /** The feed's estimate for the quarter (kept for callers; not itself evidence). */
  estimate: number | null;
  /** The feed's actual for the quarter — the other half of its own surprise. */
  vendorActual: number | null;
  /** The filer's GAAP diluted EPS for the quarter. */
  gaapEps: number | null;
  /** The adjusted EPS the card is displaying, when one was read from the release. */
  adjustedEps: number | null;
}): { usable: boolean; reason: string | null } {
  const { vendorActual: vAct, gaapEps: gaap, adjustedEps: adj } = i;
  if (vAct == null || gaap == null || adj == null) return { usable: true, reason: null };
  // The filer's two bases coincide: no mistake is possible, and no refusal.
  if (Math.abs(gaap - adj) < BASIS_SPREAD_FLOOR) return { usable: true, reason: null };
  if (sameFigure(vAct, gaap) && !sameFigure(vAct, adj)) {
    return {
      usable: false,
      reason: `the feed settled its surprise against the GAAP figure (${gaap.toFixed(2)}) while the EPS shown here is the company\u2019s own adjusted ${adj.toFixed(2)}`,
    };
  }
  return { usable: true, reason: null };
}
