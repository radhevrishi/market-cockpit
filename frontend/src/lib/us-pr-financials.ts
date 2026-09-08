// ═══════════════════════════════════════════════════════════════════════════
// US PRESS-RELEASE FINANCIALS (pure) — the just-reported quarter, read from the
// income-statement table inside the earnings 8-K's Exhibit 99.1.
//
// WHY. A company announces on day D; the 10-Q with the XBRL numbers can be a
// week or more behind. Until it lands, a PRELIM card had only the street-basis
// EPS and the price reaction — no revenue, no margin, no market cap. But the
// GAAP statement of operations is right there in the press release, and the
// prior-year column of that table is a number we ALREADY hold from XBRL (the
// year-ago 10-Q). So every figure we take from the release is accepted only
// when the same row's prior-year column reproduces the XBRL year-ago value.
// A row that does not validate is discarded — nothing is guessed.
//
// The extractor is table-driven, not sentence-driven: it walks <table><tr>,
// finds rows whose label is the GAAP revenue / operating-income / net-income /
// diluted-EPS line, and reads its numeric columns. Units (thousands, millions,
// billions) are inferred from whichever scale makes the prior-year column
// match — no per-company rules.
//
// WHICH COLUMN IS THE QUARTER — READ THE HEADER, DO NOT GUESS FROM THE VALUES
// ───────────────────────────────────────────────────────────────────────────
// Finding the row is the easy half. The hard half is deciding WHICH of its
// numeric columns is the quarter just reported, and for a long time this module
// did that positionally: find the column that reproduces the year-ago XBRL
// figure and take the column it is paired with. That reads the common
// `current | year-ago` layout correctly, and it reads Fastenal — which leads
// with the SIX-MONTH pair and puts the quarter pair second — correctly too.
// It cannot read Weyerhaeuser. WY's highlights table is ordered
//
//      2026 | 2026 | 2025
//        Q1 |   Q2 |   Q2
//     1,727 | 1,867 | 1,884
//
// so the reported quarter is the MIDDLE column, and because WY's year-ago net
// sales (1,884) are within 0.9% of its current net sales (1,867), the previous
// QUARTER's column validated against the year-ago XBRL inside tolerance. The
// card published 1,727 — last quarter's revenue — as this quarter's. A wrong
// number is the worst defect this codebase can ship, and no amount of value
// matching can prevent it: the values themselves do not say which period they
// belong to. The header does.
//
// So the table's header block is now read as a grid (colspan advances the
// cursor, rowspan reserves the column below it — the same model the
// reconciliation reader in us-pr-adjusted.ts and the guidance column binder in
// us-guidance-figures.ts use) and every numeric column is bound to the period
// its header names: a date ("Three Months Ended June 30, 2026"), a labelled
// quarter ("Q2 2026", "Second Quarter Fiscal 2027"), or a bare year under a
// period banner. The caller already knows which period end the release reports
// — the consensus row or `periodEndFromReleaseHtml` — and the column bound to
// THAT period end, and required to be a THREE-MONTH window, is the answer.
// Requiring the three-month window is what stops a six-month or year-to-date
// column that ends on the very same date from being read as the quarter, which
// is the Fastenal failure in its general form rather than as a layout quirk.
//
// Three rules keep this honest:
//   • WHEN THE HEADERS ARE READABLE THEY WIN. The value heuristic is never
//     consulted for a table whose columns name their periods.
//   • WHEN THEY ARE NOT, the value heuristic still runs. Plenty of releases
//     head their columns with merged cells, images, or nothing at all, and
//     those releases were being read correctly before.
//   • WHEN THEY ARE READABLE AND NAME NO COLUMN FOR THE REPORTED PERIOD, the
//     table publishes NOTHING. That is the case of a segment table, a
//     prior-period recap or a guidance block; a refused figure is correct and a
//     guessed one is not.
// The year-ago column is bound the same way, headers first, because it is the
// figure every release value is validated against.
// ═══════════════════════════════════════════════════════════════════════════

export interface YearAgoRef {
  revenue: number | null;          // USD
  operating_income: number | null; // USD
  net_income: number | null;       // USD
  eps: number | null;              // $/share, GAAP diluted
}

export type PrItem = 'revenue' | 'operating_income' | 'net_income' | 'eps';

export interface ReleaseFinancials {
  revenue: number | null; revenue_prev: number | null;
  operating_income: number | null; operating_income_prev: number | null;
  net_income: number | null; net_income_prev: number | null;
  eps: number | null; eps_prev: number | null;
  matched: PrItem[];
  scale: number | null;
  labels: Partial<Record<PrItem, string>>;
}

const EMPTY: ReleaseFinancials = {
  revenue: null, revenue_prev: null,
  operating_income: null, operating_income_prev: null,
  net_income: null, net_income_prev: null,
  eps: null, eps_prev: null,
  matched: [], scale: null, labels: {},
};

// ─── html → rows of cell text ───────────────────────────────────────────────
function decode(s: string): string {
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&#8203;|&#xfeff;|​|﻿/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8212;|&mdash;|&#x2014;/gi, '—').replace(/&#8211;|&ndash;|&#x2013;/gi, '–')
    .replace(/&#8217;|&rsquo;|&#x2019;/gi, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => { const c = parseInt(n, 10); return c > 31 && c < 0x10000 ? String.fromCharCode(c) : ' '; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c > 31 && c < 0x10000 ? String.fromCharCode(c) : ' '; });
}
function cellText(inner: string): string {
  return decode(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * One cell placed on the table's real grid. `col` is the grid column the cell
 * starts at once every earlier colspan and every rowspan still in force from
 * the rows above have been accounted for, and `span` is how many columns it
 * covers. Without those two numbers a header cell cannot be matched to the
 * value underneath it: filers wrap a period header in `colspan="2"` over the
 * ($, amount) pair as a matter of course, and stack "Three Months Ended" over
 * "June 30, 2026" in two separate header rows.
 */
interface GridCell { col: number; span: number; text: string }
interface Row { label: string; rest: string; cells: string[]; grid: GridCell[] }
interface Table { rows: Row[] }

function parseTables(html: string): Table[] {
  const tables: Table[] = [];
  const tRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  let guard = 0;
  while ((tm = tRe.exec(html)) && guard++ < 400) {
    const rows: Row[] = [];
    const rRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    let rguard = 0;
    // Rowspans still open from earlier rows; each one blocks its columns.
    const pending: Array<{ col: number; span: number; left: number }> = [];
    while ((rm = rRe.exec(tm[1])) && rguard++ < 400) {
      const cells: string[] = [];
      const grid: GridCell[] = [];
      let col = 0;
      const cRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1] || '';
        const text = cellText(cm[2]);
        cells.push(text);
        const span = Math.min(60, Math.max(1, parseInt((/colspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || '1', 10) || 1));
        const rspan = Math.min(30, Math.max(1, parseInt((/rowspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || '1', 10) || 1));
        while (pending.some((p) => col >= p.col && col < p.col + p.span)) col++;
        grid.push({ col, span, text });
        if (rspan > 1) pending.push({ col, span, left: rspan - 1 });
        col += span;
        if (col > 400) break;                              // runaway row guard
      }
      for (let i = pending.length - 1; i >= 0; i--) { pending[i].left--; if (pending[i].left <= 0) pending.splice(i, 1); }
      if (!cells.length) continue;
      // Label = first cell that has letters. Everything after it is the numeric zone.
      let li = -1;
      for (let i = 0; i < cells.length; i++) if (/[A-Za-z]/.test(cells[i])) { li = i; break; }
      const label = li >= 0 ? cells[li] : '';
      const rest = (li >= 0 ? cells.slice(li + 1) : cells).join(' ');
      rows.push({ label, rest, cells, grid });
    }
    if (rows.length) tables.push({ rows });
  }
  return tables;
}

// ─── label matching ─────────────────────────────────────────────────────────
const cleanLabel = (s: string) =>
  s.replace(/\(\s*\d+\s*\)|\[\s*\d+\s*\]|\*+/g, ' ')     // footnote markers
    .replace(/\((?:in\s+)?(?:thousands|millions|billions)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ').replace(/[:\s]+$/g, '').trim();

// Anything on these lines is not the GAAP headline figure.
const EXCLUDE = /non-?gaap|adjusted|adj\.|pro\s*forma|constant\s+currency|organic|comparable|excluding|ebitda|cost\s+of|costs?\s+and|gross|per\s+share|per\s+diluted|per\s+basic|segment|product|subscription|services?\b|license|hardware|software|deferred|margin|%|percent|growth|change|weighted|shares\s+outstanding|dividend|backlog|billings|bookings|arr\b|rpo\b|free\s+cash|cash\s+flow|guidance|outlook/i;
/** Rejected for an EPS row. "basic" alone is a different line; "basic and
 *  diluted" is the SAME line for a company with no dilution (every loss-maker:
 *  SNOW, AI, IOT print exactly one combined figure). */
const isBadEpsLabel = (s: string) =>
  /non-?gaap|adjusted|adj\.|pro\s*forma|weighted|shares|dividend|guidance|outlook|constant|organic|before\s+discontinued|discontinued/i.test(s)
  || (/\bbasic\b/i.test(s) && !/basic\s*(?:and|&|\/|,)\s*diluted/i.test(s));

const REVENUE = /^(?:total\s+)?(?:net\s+)?(?:operating\s+)?(?:revenues?|sales|net\s+sales)(?:\s*,?\s*net)?(?:\s*\(.*\))?$/i;
// "Consolidated operating profit" is the same line as "Operating profit", and
// leaving the qualifier out of the shape cost Lockheed Martin its margin
// entirely: its release states "Consolidated operating profit | $2,479 | $748"
// in the very first table, that row was rejected for the leading word, and a
// SEGMENT table five tables later then matched — its Space division's $741 of
// six-month profit is within a per cent of the $748 consolidated year-ago
// figure — and published a segment number as the company's operating income.
const OP_INCOME = /^(?:total\s+)?(?:consolidated\s+)?(?:(?:operating\s+(?:income|profit|earnings|loss)(?:\s*\(loss\)|\s*\/\s*\(loss\)|\s*\(income\))?)|(?:(?:income|earnings|profit|loss)\s*(?:\(loss\)|\/\s*\(loss\)|\(income\))?\s+from\s+operations)|(?:operating\s+\(loss\)\s*(?:income|profit|earnings))|(?:earnings\s+before\s+interest\s+and\s+taxes(?:\s*\(ebit\))?)|(?:ebit))$/i;
const NET_INCOME = /^(?:total\s+)?net\s+(?:income|earnings|loss|profit)(?:\s*\(loss\)|\s*\/\s*\(loss\)|\s*\(income\))?(?:\s+attributable\s+to\s+.{2,80})?$/i;
// Direct one-row EPS: "Diluted earnings per share", "Net income (loss) per
// share, diluted", "Net loss per share attributable to X — basic and diluted",
// optionally prefixed "GAAP".
const EPS_DIRECT = /^(?:gaap\s+)?(?:(?:diluted\s+)?(?:net\s+)?(?:income|earnings|loss|profit)?\s*(?:\(loss\)|\(income\))?\s*per\s+(?:common\s+|ordinary\s+|class\s+[a-z]\s+(?:and\s+class\s+[a-z]\s+)?common\s+|diluted\s+)?shares?(?:\s+attributable\s+to\s+.{2,120})?\s*[-–—,:]?\s*(?:basic\s*(?:and|&|\/)\s*diluted|diluted)?|diluted\s+(?:net\s+)?(?:income|earnings|loss)?\s*(?:\(loss\))?\s*per\s+(?:common\s+|ordinary\s+)?shares?(?:\s+attributable\s+to\s+.{2,120})?|diluted\s+eps)(?:\s*\(.*\))?$/i;
const EPS_HEADER = /per\s+(?:common\s+|ordinary\s+|diluted\s+|basic\s+and\s+diluted\s+)?shares?|earnings\s+per\s+share|eps\b/i;
/**
 * The second guard on a DIRECT EPS row: the label must literally name a
 * per-share figure, so that a shape `EPS_DIRECT` matched loosely can still be
 * thrown out.
 *
 * It used to be `/per\s+share|eps/`, which requires "per" and "share" to be
 * ADJACENT — and most of the market does not write it that way. Citi Trends'
 * August-2026 release states its EPS on two separate tables as "Diluted net
 * income (loss) per common share"; `EPS_DIRECT` matched it both times and this
 * guard then discarded it, so the PRELIM card printed "EPS not tagged" for a
 * company whose release states the figure twice. Every qualifier `EPS_DIRECT`
 * itself allows between "per" and "share" — common, ordinary, diluted, basic,
 * "Class A common" — is therefore allowed here too, and nothing else is.
 */
const EPS_PER_SHARE = /per\s+(?:(?:common|ordinary|diluted|basic|and|class\s+[a-z])\s+){0,4}shares?\b|earnings\s+per\s+share|\beps\b/i;
/** Under a "…per share:" header, the diluted figure sits on a row called
 *  "Diluted", or (Genesco) "Net earnings (loss)" beneath a "Diluted … per
 *  share:" header. */
const EPS_SUBROW = /^(?:diluted|(?:total\s+)?net\s+(?:income|earnings|loss|profit)(?:\s*\(loss\)|\s*\(income\))?)(?:\s*\(.*\))?$/i;

/**
 * A GUIDANCE ROW WEARS THE SAME CLOTHES AS A RESULTS ROW — a label on the left
 * and numbers on the right — and the label alone does not give it away.
 * Abercrombie's August-2026 release carries, in its outlook table, the row
 * "Net income per diluted share (2)(3)(5) | In The Range of $2.90 to $3.20".
 * Its $2.90 is within a cent of A&F's year-ago $2.91, so the range validated
 * as a [prior, current] pair and would have put $3.20 on the card against a
 * reported $4.17.
 *
 * The tell is not in the label, it is in the NUMERIC ZONE: an income statement
 * puts nothing there but figures, currency symbols and punctuation, so prose
 * beside the numbers means the row is an outlook, a share-count note ("Around
 * 44 million") or a footnote — never a reported figure. Checked on the numeric
 * zone only, so a label that happens to mention a forecast is unaffected.
 */
/** The wording of a block that restates the same lines on a non-GAAP basis. */
const ADJ_BLOCK = /\bnon[\s‐-―-]?gaap\b|\badjusted\b|\bpro\s*forma\b|\bas\s+adjusted\b/i;

const OUTLOOK_ZONE = /\b(?:range|approximately|around|about|expects?|expected|anticipate\w*|outlook|guidance|forecast|projected?|estimated?)\b|\bto\s*\$/i;

// ─── numeric tokens ─────────────────────────────────────────────────────────
function tokens(rest: string): number[] {
  const out: number[] = [];
  const re = /(\(?)\s*\$?\s*([-−–]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(\)?)\s*(%?)/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(rest)) && guard++ < 40) {
    if (m[5]) continue;                                 // percentage column
    const raw = m[3].replace(/,/g, '');
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) continue;
    const neg = !!m[1] || !!m[2];
    out.push(neg ? -v : v);
  }
  return out;
}

const SCALES = [1e3, 1e6, 1e9, 1];
const relClose = (a: number, b: number) => {
  if (b === 0) return Math.abs(a) < 1;
  return Math.abs(a - b) / Math.abs(b) <= 0.015;
};

// ─── column → period binding ────────────────────────────────────────────────
// Everything from here to `buildBinding` answers one question: for each numeric
// column of a table, WHICH PERIOD does its header name? Nothing in it is tied
// to an issuer — it is the vocabulary US filers head their columns with.

/**
 * The reported quarter, in every spelling a US filing heads a column with.
 * "Quarters Ended June 30," opens Hexcel's statement of operations — the plural
 * is as common as the singular, and an anchored `quarter\b` misses it entirely.
 * The week counts are every quarter length a 52/53-week calendar produces: 13,
 * and 14 in the leap quarter, for a 13/13/13/13 filer; 12 with a closing 16 for
 * the 12/12/12/16 calendar Costco and others keep — COST's Q4 release heads its
 * columns "16 Weeks Ended | 52 Weeks Ended", and without the 16 its quarter has
 * no readable duration at all.
 */
const Q_TOKEN = /\b(?:three|3)[\s‐-―-]*months?\b|\b(?:twelve|12|thirteen|13|fourteen|14|sixteen|16)[\s‐-―-]*weeks?\b|\bquarters?(?:ly)?\b|\bqtrs?\b|\bQ[1-4]\b|\b[1-4]Q\b/i;
/** Anything longer than the quarter: the half, three quarters, the year. This
 *  is what keeps a six-month column that ENDS ON THE SAME DATE as the quarter
 *  from being read as the quarter — Fastenal's release leads with exactly that
 *  column, and it is the general form of that whole class of error. */
const LONGER_TOKEN = /\b(?:six|6|nine|9|twelve|12)[\s‐-―-]*months?\b|\b(?:twenty[\s‐-―-]*six|26)[\s‐-―-]*weeks?\b|\b(?:thirty[\s‐-―-]*nine|39)[\s‐-―-]*weeks?\b|\b(?:fifty[\s‐-―-]*(?:two|three)|5[23])[\s‐-―-]*weeks?\b|\byear[\s‐-―-]*to[\s‐-―-]*date\b|\bYTD\b|\bfirst\s+(?:half|six|nine)\b|\bhalf[\s‐-―-]*year\b|\bfull[\s‐-―-]*year\b|\byear\s+ended\b|\byear[\s‐-―-]*end\b|\bannual\b/i;
/** A period that has not happened yet. The participle is the whole tell and it
 *  is completely reliable: a result is for the quarter ENDED June 30, a guide
 *  is for the quarter ENDING September 30. A guidance column is otherwise the
 *  newest-looking column on the page. */
const ENDING_TOKEN = /\b(?:months?|weeks?|quarters?|years?|periods?)\s+ending\b|\bending\s+[A-Za-z]{3,9}\.?\s+\d{1,2}\b|\bguidance\b|\boutlook\b|\bforecast\b|\bprojected\b|\bestimated\b/i;
/** Columns that hold a delta, a percentage, a share count or a guidance bound
 *  rather than a period's figures. */
const NON_PERIOD_COL = /\b(?:change|variance|increase|decrease|percent|basis\s+points?|\bbps\b|growth|low|high|midpoint|range)\b|%/i;

type Duration = 'quarter' | 'longer' | 'both' | 'unknown';
function durationOf(text: string): Duration {
  const q = Q_TOKEN.test(text), l = LONGER_TOKEN.test(text);
  if (q && l) return 'both';                 // "three and six months ended" — cannot tell
  if (l) return 'longer';
  if (q) return 'quarter';
  return 'unknown';
}

/** Period-end dates a header names, in the two forms filings print them. */
function datesIn(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(DATE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const day = parseInt(m[2], 10), yr = parseInt(m[3], 10);
    if (!mo || !(day >= 1 && day <= 31) || !(yr >= 1990 && yr <= 2100)) continue;
    out.push(`${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g;
  while ((m = slash.exec(text))) {
    const mo = parseInt(m[1], 10), day = parseInt(m[2], 10);
    let yr = parseInt(m[3], 10); if (yr < 100) yr += 2000;
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
    out.push(`${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return out;
}

/** Years a header names — plainly ("2026") or in the fiscal shorthand a
 *  highlights table falls back on when the column is too narrow for a date
 *  ("FY26", "Q4 FY26", "2Q26"). */
function yearsIn(text: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const plain = /\b(?:19|20)\d{2}\b/g;
  while ((m = plain.exec(text))) out.push(parseInt(m[0], 10));
  const short = /\b(?:FY|fiscal(?:\s+year)?|Q[1-4]|[1-4]Q)\s*'?(\d{2})\b/gi;
  while ((m = short.exec(text))) out.push(2000 + parseInt(m[1], 10));
  return out;
}

/** Months a header names without a day beside them — "Jun.", "September". */
function monthsIn(text: string): number[] {
  const out: number[] = [];
  const re = /\b([A-Za-z]{3,9})\.?(?!\s+\d{1,2}\s*,?\s*\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = MONTHS[m[1].toLowerCase()];
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];
/** Which quarter of the fiscal year a label names, if it names one. */
function quarterOrdinalOf(text: string): number | null {
  const q = /\bQ\s?([1-4])\b|\b([1-4])Q\b/i.exec(text);
  if (q) return parseInt(q[1] || q[2], 10);
  const w = /\b(first|second|third|fourth)[\s‐-―-]+(?:fiscal[\s‐-―-]+)?quarter\b/i.exec(text);
  if (w) return ORDINALS.indexOf(w[1].toLowerCase()) + 1;
  // The ordinal and the word "quarter" need not be adjacent: a five-quarter
  // trend table heads one column with "QUARTERS" on the top row, "2026" on the
  // next and "SECOND" on the third, and the column label reassembles as
  // "QUARTERS 2026 SECOND". One ordinal in a label that also names a quarter is
  // that column's ordinal; two would be ambiguous and name nothing.
  if (Q_TOKEN.test(text)) {
    const all = text.match(/\b(?:first|second|third|fourth)\b/gi);
    if (all) {
      const uniq = Array.from(new Set(all.map((s) => s.toLowerCase())));
      if (uniq.length === 1) return ORDINALS.indexOf(uniq[0]) + 1;
    }
  }
  return null;
}

/**
 * The quarter the release itself says it is announcing, from its opening lines.
 * Weyerhaeuser's columns are headed "Q1 | Q2 | Q2" under "2026 | 2026 | 2025"
 * and name no date at all, so the only thing that says which of the two Q2
 * columns is being reported is the release's own title — "Weyerhaeuser Reports
 * Second Quarter Results" — read together with the later of the two years.
 */
function headlineQuarterOf(html: string): number | null {
  const head = decode(html.slice(0, 80_000).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 1500);
  const re = /\b(first|second|third|fourth)[\s\-]+(?:fiscal[\s\-]+)?quarter\b|\bQ\s?([1-4])\b/gi;
  let m: RegExpExecArray | null, guard = 0;
  while ((m = re.exec(head)) && guard++ < 20) {
    const ctx = head.slice(Math.max(0, m.index - 80), m.index + m[0].length + 60);
    // A sentence about the quarter AHEAD names a quarter this release does not
    // report — "expects third quarter revenue of…" in the opening bullets.
    if (ENDING_TOKEN.test(ctx) || /\bexpects?\b|\banticipat/i.test(ctx)) continue;
    return m[2] ? parseInt(m[2], 10) : ORDINALS.indexOf(m[1].toLowerCase()) + 1;
  }
  return null;
}

const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** A footnote marker standing in its own cell — "(1)", "(1)(2)", "*". Reading
 *  it as a number turns Weyerhaeuser's "(1)(2)" into a -1 in the numeric zone. */
const MARKER_CELL = /^(?:\(\s*\d{1,2}\s*\)\s*|[*†‡]\s*)+$/;

interface NumCell { col: number; value: number }

/**
 * The measured values of one row, each still attached to the grid column it was
 * printed in. Filers put the currency symbol, the amount and the closing
 * parenthesis of a negative in THREE separate cells, so the sign has to be
 * gathered from the neighbours; and a footnote marker sitting between the label
 * and the first figure is not a figure.
 */
function numericCells(row: Row): NumCell[] {
  const out: NumCell[] = [];
  const g = row.grid;
  // "(62)" is a footnote marker in one row and NEGATIVE SIXTY-TWO MILLION in
  // the next, and the shape does not tell them apart. The position does: a
  // marker is printed between the label and the money, so it can only be one
  // while the currency symbol that opens the numeric zone is still ahead of us.
  // A row that prints no currency symbol at all — International Paper's
  // "Earnings (Loss) from Continuing Operations | (12) | 75 | 76" — has no
  // marker zone, and its leading parenthesis is a minus sign.
  let money = g.length;
  for (let i = 0; i < g.length; i++) if (g[i].text.trim().startsWith('$')) { money = i; break; }
  let seen = false;
  for (let i = 0; i < g.length; i++) {
    const t = g[i].text.trim();
    if (!t) continue;
    if (i < money && !seen && MARKER_CELL.test(t)) continue;   // footnote marker, not a value
    if (t.indexOf('%') >= 0) { seen = true; continue; }    // a percentage column
    const m = /^(\()?\s*\$?\s*([-−–])?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(\)?)$/.exec(t.replace(/\s+/g, ' '));
    if (!m) { if (/\d/.test(t)) seen = true; continue; }
    const v = parseFloat(m[3].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    seen = true;
    // The per-cent sign lands in its own cell as often as not — "80.5" then
    // "%" — and a ratio is not a figure of the line item.
    let pct = false;
    for (let k = i + 1; k < g.length; k++) { const p = g[k].text.trim(); if (!p) continue; pct = /^[)\s]*%/.test(p); break; }
    if (pct) continue;
    let neg = !!m[1] || !!m[2] || !!m[4];
    // "(" alone in the cell before, ")" alone in the cell after.
    if (!neg) {
      for (let k = i - 1; k >= 0; k--) { const p = g[k].text.trim(); if (!p) continue; if (p === '(' || p === '$(') neg = true; break; }
      if (!neg) for (let k = i + 1; k < g.length; k++) { const p = g[k].text.trim(); if (!p) continue; if (p === ')') neg = true; break; }
    }
    out.push({ col: g[i].col, value: neg ? -v : v });
  }
  return out;
}

/** A row that carries no measured amount — text, filler, bare years and dates
 *  only — is a header row, and only header rows may label a column. */
const FILLER_CELL = /^[$()%.,;:*†‡#\-‐-―_\s]*$/;
function isHeaderRow(row: Row): boolean {
  for (const c of row.grid) {
    const t = c.text.trim();
    if (!t) continue;
    if (/[A-Za-z]/.test(t)) continue;
    if (/^\(?(?:19|20)\d{2}\)?$/.test(t)) continue;
    if (/^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$/.test(t)) continue;
    if (FILLER_CELL.test(t)) continue;
    return false;
  }
  return true;
}

interface ColPeriod {
  dates: string[];
  year: number | null;
  ord: number | null;
  dur: Duration;
  forward: boolean;
  /** The header text this was read out of, for the row label we publish. */
  text: string;
}

/**
 * The period bound to one grid column of one row: the join, TOP DOWN, of every
 * header cell above that row which COVERS the column, plus the nearest
 * full-width period banner above it. Top-down order matters — "Three Months
 * Ended June 30," on one header row and "2026" on the next only reassemble into
 * a readable date in that order.
 */
function periodForColumn(rows: Row[], headerRow: boolean[], banners: string[], usable: boolean[], upTo: number, col: number): ColPeriod {
  const parts: string[] = [];
  for (let r = 0; r < upTo; r++) {
    if (!headerRow[r] || !usable[r]) continue;
    // A row with a single meaningful cell labels the TABLE, not a column; it is
    // picked up as a banner instead, so that a title spanning every column
    // cannot lend its words to each of them.
    const meaningful = rows[r].grid.filter((c) => c.text.trim() && !FILLER_CELL.test(c.text.trim()));
    if (meaningful.length < 2) continue;
    for (const c of meaningful) if (col >= c.col && col < c.col + c.span) parts.push(c.text);
  }
  // THE DEEPEST HEADER CELL WINS ON THE YEAR. Crinetics heads its two quarter
  // columns "Three months ended September 30, 2025" — the spanner carries the
  // year — and then distinguishes them one row below with "2025 | 2024". Read
  // as one string both columns claim September 30, 2025 and neither can be told
  // from the other. A bare year lower in the header block is the more specific
  // statement of the two, so the spanner's month and day are re-based onto it.
  {
    let bare: number | null = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (datesIn(parts[i]).length) continue;
      const ys = yearsIn(parts[i]);
      if (ys.length) { bare = ys[ys.length - 1]; break; }
    }
    if (bare !== null) {
      const spanned = datesIn(parts.join(' '));
      if (spanned.length && !spanned.some((d) => parseInt(d.slice(0, 4), 10) === bare)) {
        for (let i = 0; i < parts.length; i++) {
          parts[i] = parts[i].replace(new RegExp(DATE_RE.source, 'gi'), (_m, mo, dy) => `${mo} ${dy}, ${bare}`);
        }
      }
    }
  }
  const own = parts.join(' ').replace(/\s+/g, ' ').trim();
  const banner = banners[upTo] || '';
  // The banner goes IN FRONT: "Three Months Ended June 30," + "2026".
  const bound = banner ? `${banner} ${own}`.replace(/\s+/g, ' ').trim() : own;

  const ownDates = datesIn(own);
  const ownYears = yearsIn(own);
  let dates = ownDates.length ? ownDates : datesIn(bound);
  // A banner covering the whole block often names BOTH years ("Three Months
  // Ended June 30, 2026 and 2025"). A column that states its own year keeps
  // only the banner dates belonging to that year — otherwise every column
  // would match every period.
  if (!ownDates.length && ownYears.length && dates.length) {
    dates = dates.filter((d) => ownYears.includes(parseInt(d.slice(0, 4), 10)));
  }
  // The same trick with the MONTH. Peabody heads five columns "Jun. | Mar. |
  // Jun. | Jun. | Jun." over "2026 | 2026 | 2025 | 2026 | 2025", with the days
  // only in the sentence above the table ("For the Quarters Ended Jun. 30,
  // 2026, Mar. 31, 2026 and Jun. 30, 2025 …"). Without this the June and the
  // March column inherit the same three dates and neither can be told apart.
  if (!ownDates.length && dates.length) {
    const months = monthsIn(own);
    if (months.length) dates = dates.filter((d) => months.includes(parseInt(d.slice(5, 7), 10)));
  }
  const years = ownYears.length ? ownYears : yearsIn(bound);
  return {
    dates,
    year: dates.length ? parseInt(dates[dates.length - 1].slice(0, 4), 10) : (years.length ? years[years.length - 1] : null),
    ord: quarterOrdinalOf(own) ?? quarterOrdinalOf(bound),
    dur: durationOf(own) !== 'unknown' ? durationOf(own) : durationOf(bound),
    forward: ENDING_TOKEN.test(bound),
    text: bound,
  };
}

/** A column whose period is pinned well enough to be trusted or ruled out. */
function isResolved(p: ColPeriod): boolean {
  if (p.dur === 'both' || p.dur === 'unknown') return false;
  return p.dates.length > 0 || (p.year !== null && p.ord !== null);
}

interface Binding {
  /**
   * The (current, year-ago) pairs this row offers, in reading order — empty
   * when the table's headers name no column for the reported period.
   *
   * There is more than one pair whenever a filer nests a second sub-column
   * inside each period: Chipotle prints "3,348,562 | 100.0 | 3,063,393 | 100.0"
   * under one "Three months ended June 30, 2026 | 2025" header, the 100.0 being
   * percent of revenue, and Starbucks does the same with an "As a % of total
   * net revenues" block. The header cannot separate those — nothing in it
   * distinguishes them — so the sub-columns of the current period are paired
   * positionally with the sub-columns of the comparative period, leftmost
   * first, and the year-ago XBRL figure decides which pair is the line item.
   * The percentage pair cannot reproduce a year-ago dollar amount.
   */
  pick(row: Row): Array<{ cur: number; prev: number }>;
}

/**
 * Bind a table's numeric columns to periods, or report that its headers cannot
 * be read. Returns null when they cannot — the caller then falls back to the
 * value-matching heuristic, which is the right answer for the many releases
 * whose columns are headed by merged cells, images or nothing at all.
 */
function buildBinding(rows: Row[], reportedEnd: string, headlineQ: number | null): Binding | null {
  const headerRow = rows.map(isHeaderRow);
  // Full-width banner rows scope everything under them ("Three Months Ended
  // June 30,"), which is how a great many statements of operations state the
  // period their year columns belong to.
  const banners: string[] = [];
  let cur = '';
  for (let r = 0; r < rows.length; r++) {
    const meaningful = rows[r].grid.filter((c) => c.text.trim() && !FILLER_CELL.test(c.text.trim()));
    if (headerRow[r] && meaningful.length === 1) {
      const s = meaningful[0].text.replace(/\((?:in\s+)?(?:thousands|millions|billions)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
      if (s && s.length <= 200 && (durationOf(s) !== 'unknown' || datesIn(s).length)) cur = s;
    }
    banners.push(cur);
  }

  // A HEADER BLOCK THAT DOES NOT LINE UP WITH THE BODY CANNOT LABEL IT.
  // ExxonMobil's data sheet opens its year row with "2026" in the stub column —
  // the cell the body uses for the line-item name — so every year sits one
  // column to the left of the figures it belongs to and "Three Months Ended
  // June 30," lands over the year-ago column. A bare year or date in the stub
  // column of a header row, in a table whose body labels its rows there, is
  // that shift showing; the headers are then not readable and the value
  // heuristic takes over.
  const BARE_PERIOD_CELL = /^\(?(?:19|20)\d{2}\)?$|^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$/;
  let stubIsLabel = false;
  for (let r = 0; r < rows.length; r++) {
    if (headerRow[r]) continue;
    const c0 = rows[r].grid.find((c) => c.col === 0);
    if (c0 && /[A-Za-z]{3}/.test(c0.text)) { stubIsLabel = true; break; }
  }
  if (stubIsLabel) {
    for (let r = 0; r < rows.length; r++) {
      if (!headerRow[r]) continue;
      const c0 = rows[r].grid.find((c) => c.col === 0);
      if (c0 && BARE_PERIOD_CELL.test(c0.text.trim())) return null;
    }
  }

  // A HEADER ROW THAT LABELS ONLY SOME OF THE FIGURES LABELS NONE OF THEM.
  // Qualcomm's statement of operations opens "Three Months Ended | Nine Months
  // Ended" on a row that is missing its stub cell, so both spanners sit nine
  // grid columns to the left of the figures they describe and "Nine Months
  // Ended" lands squarely over the QUARTER's two columns. Geometry alone cannot
  // tell that apart from a legitimate spanner — but a legitimate one covers
  // every figure column in the table (each group gets a period) while a shifted
  // one covers a prefix and leaves the rest bare. A row that covers some and
  // not all is therefore not used to label anything.
  const numCols = new Set<number>();
  for (let r = 0; r < rows.length; r++) {
    if (headerRow[r]) continue;
    for (const n of numericCells(rows[r])) numCols.add(n.col);
  }
  const usable: boolean[] = rows.map((row, r) => {
    if (!headerRow[r]) return false;
    const meaningful = row.grid.filter((c) => c.text.trim() && !FILLER_CELL.test(c.text.trim()));
    if (meaningful.length < 2) return true;                 // a banner, handled elsewhere
    let covered = 0;
    for (const col of numCols) if (meaningful.some((c) => col >= c.col && col < c.col + c.span)) covered++;
    return covered === 0 || covered === numCols.size;
  });

  const reportedYear = parseInt(reportedEnd.slice(0, 4), 10);
  const cache = new Map<string, ColPeriod>();
  const periodAt = (r: number, col: number): ColPeriod => {
    const k = `${r}|${col}`;
    let p = cache.get(k);
    if (!p) { p = periodForColumn(rows, headerRow, banners, usable, r, col); cache.set(k, p); }
    return p;
  };

  // A column stating the ADJUSTED basis of the same period is not a period
  // column for our purposes: this module publishes the GAAP line only, and
  // Qualcomm heads its summary table "GAAP | Non-GAAP" with an identical
  // "Q3 Fiscal 2026 | Q3 Fiscal 2025" pair under each. Both halves name the
  // reported quarter, and only the basis marker tells them apart.
  const ADJ_COLUMN = /\bnon[\s‐-―-]?gaap\b|\badjusted\b|\bpro\s*forma\b|\bas\s+adjusted\b/i;
  const isQuarter = (p: ColPeriod) =>
    p.dur === 'quarter' && !p.forward && !NON_PERIOD_COL.test(p.text) && !ADJ_COLUMN.test(p.text);

  // Is this table header-governed at all? Count the numeric columns whose
  // period is pinned. Two is the minimum that can express a comparison, and
  // demanding a majority stops one stray dated cell in an otherwise unlabelled
  // table from putting the whole table under header control.
  let resolved = 0, total = 0;
  // The latest fiscal year this table's quarter columns name. Hexcel's segment
  // table stacks a "Second Quarter 2026" block over a "Second Quarter 2025"
  // one; judged row by row, every row of the 2025 block is the latest thing in
  // its own row and would read as the quarter just reported. The year has to be
  // ranked across the whole table, and pinned to the period end the caller
  // named, before "Q2" means anything.
  let maxYear: number | null = null;
  for (let r = 0; r < rows.length; r++) {
    if (headerRow[r]) continue;
    for (const n of numericCells(rows[r])) {
      total++;
      const p = periodAt(r, n.col);
      if (isResolved(p)) resolved++;
      if (isQuarter(p) && p.year !== null && (maxYear === null || p.year > maxYear)) maxYear = p.year;
      if (total > 4000) break;
    }
  }
  if (resolved < 2 || resolved * 2 < total) return null;

  const pick = (row: Row): Array<{ cur: number; prev: number }> => {
    const NONE: Array<{ cur: number; prev: number }> = [];
    const r = rows.indexOf(row);
    if (r < 0) return NONE;
    const nums = numericCells(row);
    if (nums.length < 2) return NONE;
    const periods = nums.map((n) => periodAt(r, n.col));

    const matchesReported = (p: ColPeriod): boolean => {
      if (!isQuarter(p)) return false;
      // A column that names a date is judged on the date and nothing else.
      if (p.dates.length) return p.dates.some((d) => dayGap(d, reportedEnd) <= 6);
      // Otherwise the filer labelled it "Q2 2026": the quarter must be the one
      // the release says it is announcing, the year the latest the table shows,
      // and that year must sit within a year of the period end the caller
      // reported — a fiscal label leads or trails the calendar by up to a year
      // (a June-year-end filer's "Q1 FY2027" ends in September 2026).
      if (p.ord === null || p.year === null || headlineQ === null) return false;
      return p.ord === headlineQ && p.year === maxYear && Math.abs(p.year - reportedYear) <= 1;
    };
    const curIdxs: number[] = [];
    for (let i = 0; i < periods.length; i++) if (matchesReported(periods[i])) curIdxs.push(i);
    if (!curIdxs.length) return NONE;
    const cp = periods[curIdxs[0]];

    // The year-ago column, bound the same way: a year earlier by the date it
    // names, or — when only one of the two columns carries a date, which is
    // what happens when a banner names the current period's date and the
    // comparative column carries only its year (Saia heads "Second Quarter |
    // Six Months" over "2026 | 2025 | 2026 | 2025") — the same quarter ordinal
    // one fiscal year back.
    const matchesPrior = (p: ColPeriod): boolean => {
      if (!isQuarter(p)) return false;
      if (cp.dates.length && p.dates.length) {
        return p.dates.some((d) => cp.dates.some((c) => { const g = dayGap(d, c); return g >= 300 && g <= 430 && d < c; }));
      }
      return p.ord !== null && cp.ord !== null && p.ord === cp.ord
        && p.year !== null && cp.year !== null && p.year === cp.year - 1;
    };
    const prevIdxs: number[] = [];
    for (let i = 0; i < periods.length; i++) if (!curIdxs.includes(i) && matchesPrior(periods[i])) prevIdxs.push(i);
    if (!prevIdxs.length) return NONE;

    // One current column and one comparative column: the ordinary case.
    // Several of each: the nested-sub-column case, paired positionally. Any
    // other shape — three current columns against one comparative, say — is a
    // layout we cannot map, and mapping it wrongly is exactly the failure this
    // whole binding exists to prevent, so the row is dropped.
    if (curIdxs.length === 1 || prevIdxs.length === 1) {
      const same = (idxs: number[]) => idxs.every((i) => Math.abs(nums[i].value - nums[idxs[0]].value) <= 1e-9);
      if (!same(curIdxs) || !same(prevIdxs)) return NONE;
      return [{ cur: nums[curIdxs[0]].value, prev: nums[prevIdxs[0]].value }];
    }
    if (curIdxs.length !== prevIdxs.length) return NONE;
    return curIdxs.map((ci, k) => ({ cur: nums[ci].value, prev: nums[prevIdxs[k]].value }));
  };

  return { pick };
}

interface Hit { cur: number; prev: number; scale: number; label: string; tableIdx: number; }

/**
 * The header-bound pair, checked against the year-ago XBRL figure. The column
 * choice is already made — this only settles the SCALE the table is printed in
 * (thousands, millions, billions) and refuses the row when the column the
 * headers named as the year-ago one does not in fact reproduce the year-ago
 * filing. A row that cannot be validated is discarded, exactly as before: the
 * headers decide WHICH column, the year-ago XBRL still decides WHETHER.
 */
function matchBound(pairs: Array<{ cur: number; prev: number }>, yearAgo: number, isEps: boolean, preferScale: number | null, label: string, tableIdx: number): Hit | null {
  const scales = isEps ? [1] : (preferScale ? [preferScale, ...SCALES.filter((s) => s !== preferScale)] : SCALES);
  for (const pair of pairs) {
    for (const sc of scales) {
      const good = isEps ? Math.abs(pair.prev - yearAgo) <= 0.011 : relClose(pair.prev * sc, yearAgo);
      if (good) return { cur: pair.cur * sc, prev: pair.prev * sc, scale: sc, label, tableIdx };
    }
  }
  return null;
}

function matchRow(toks: number[], yearAgo: number, isEps: boolean, preferScale: number | null, label: string, tableIdx: number): Hit | null {
  if (toks.length < 2) return null;
  const head = toks.slice(0, 4);
  const scales = isEps ? [1] : (preferScale ? [preferScale, ...SCALES.filter((s) => s !== preferScale)] : SCALES);
  for (const sc of scales) {
    const close = (v: number) => isEps ? Math.abs(v - yearAgo) <= 0.011 : relClose(v * sc, yearAgo);
    // Standard layout: [current, prior, …]. The current figure is the column
    // the matched prior-year one is PAIRED with, which is not always the first.
    //
    // A US comparative table is built out of current/prior PAIRS, so a prior
    // column always sits at an odd offset from its own current column.
    // Fastenal's release leads with the six-month pair and puts the quarter
    // pair after it — "$0.63 | 0.55 | 14.8% | $0.33 | 0.29 | 15.9%" — so its
    // year-ago quarter matches at index 3 and the answer is index 2, $0.33.
    // Taking the first column regardless published Fastenal's June quarter at
    // $0.63 of EPS, which is its half-year figure. A prior column at an EVEN
    // index is not a pair at all but a time series — Weyerhaeuser prints
    // "Q3 | prior quarter | year-ago quarter", matching at index 2 — and there
    // the first column is still the one being reported.
    // The pairing only holds where the leading two columns ARE a pair. A
    // GAAP-to-non-GAAP reconciliation table looks identical positionally and
    // is not: Microsoft's June-2026 release carries "Net Income | $35,766 |
    // $(480) | $35,286 | $27,233 | …", where column 1 is the adjustment and
    // column 2 the non-GAAP result, so reading the year-ago $27,233 as the
    // fourth column's partner would put $35,286 — Microsoft's non-GAAP net
    // income — on a GAAP row. An adjustment column is small and points the
    // other way; a period column is neither.
    const paired = head.length >= 2 && (head[0] >= 0) === (head[1] >= 0)
      && Math.abs(head[1]) >= Math.abs(head[0]) * 0.25;
    for (let k = 1; k < head.length; k++) {
      if (!close(head[k])) continue;
      const curIdx = (paired && k % 2 === 1) ? k - 1 : 0;
      return { cur: head[curIdx] * sc, prev: head[k] * sc, scale: sc, label, tableIdx };
    }
    // Prior-first layout: [prior, current]
    if (close(head[0]) && head.length >= 2) return { cur: head[1] * sc, prev: head[0] * sc, scale: sc, label, tableIdx };
  }
  return null;
}

// ─── which quarter is this release about? ───────────────────────────────────
// Needed for the filers no consensus feed covers. A micro-cap announces on an
// 8-K, its 10-Q is weeks away, and Yahoo has no earnings history for it — so
// the quarter end (which the consensus row would otherwise have supplied) has
// to come from the release itself. Every US income statement is headed with
// the period it covers, in one of a handful of shapes:
//
//   Three Months Ended July 31, 2026        (calendar-month filers)
//   Thirteen Weeks Ended August 2, 2026     (52/53-week retailers)
//   Quarter Ended June 30, 2026
//   For the three and six months ended June 30, 2026
//
// The rule is only ever "read the date the filer wrote", never arithmetic on a
// 91-day quarter — a 52/53-week calendar breaks that immediately.
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const PERIOD_HEAD = new RegExp(
  String.raw`(?:three|thirteen|3|13)[\s\-]*(?:months?|weeks?)?\s*(?:and\s+(?:\w+|\d+)[\s\-]*(?:months?|weeks?)\s*)?ended?` +
  String.raw`|quarters?\s+ended?|periods?\s+ended?|(?:months?|weeks?)\s+ended?`,
  'i');
const DATE_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;

/**
 * The period end this release reports on, or null.
 *
 * `filedISO` bounds the answer: an earnings release always covers a quarter
 * that has already ended, and US companies announce within roughly 110 days of
 * the close. A date outside that window belongs to a comparative column, a
 * subsequent-event note or a forward-looking sentence, and is discarded. Among
 * the candidates that survive, the LATEST wins — the current period is always
 * the most recent date on the page's period headers.
 */
export function periodEndFromReleaseHtml(html: string, filedISO: string): string | null {
  if (!html || !/^\d{4}-\d{2}-\d{2}$/.test(filedISO)) return null;
  const text = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  if (!text) return null;
  const filedMs = Date.parse(filedISO + 'T00:00:00Z');
  const lo = filedMs - 110 * 86_400_000;              // oldest plausible quarter end
  const hi = filedMs;                                  // never after the announcement
  let best: string | null = null;

  // Only dates that sit just after a period-ended phrase are considered: the
  // same page carries the release date, the year-ago column and, often, a
  // conference-call date, and none of those name this quarter.
  const heads: number[] = [];
  const headRe = new RegExp(PERIOD_HEAD.source, 'gi');
  for (let m = headRe.exec(text); m; m = headRe.exec(text)) heads.push(m.index + m[0].length);
  for (const at of heads) {
    const window = text.slice(at, at + 60);
    DATE_RE.lastIndex = 0;
    const d = DATE_RE.exec(window);
    if (!d) continue;
    const mo = MONTHS[d[1].toLowerCase()];
    if (!mo) continue;
    const day = parseInt(d[2], 10), yr = parseInt(d[3], 10);
    if (!(day >= 1 && day <= 31) || !(yr >= 1990 && yr <= 2100)) continue;
    const iso = `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ms = Date.parse(iso + 'T00:00:00Z');
    if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
    if (!best || iso > best) best = iso;
  }
  return best;
}

export interface ReleaseFinancialsOptions {
  /**
   * The fiscal period end of the quarter this release reports (YYYY-MM-DD) —
   * the consensus row's quarter, or `periodEndFromReleaseHtml`. When supplied,
   * a table whose column headers name their periods is read by those headers
   * and the value heuristic is not consulted for it; when such a table names no
   * column for this period end, the table publishes nothing.
   */
  reportedPeriodEnd?: string | null;
}

/**
 * Extract the current quarter's GAAP revenue / operating income / net income /
 * diluted EPS from a press release, each validated against `yearAgo`.
 */
export function financialsFromReleaseHtml(html: string, yearAgo: YearAgoRef, opts?: ReleaseFinancialsOptions): ReleaseFinancials {
  const out: ReleaseFinancials = { ...EMPTY, matched: [], labels: {} };
  if (!html || html.length > 6_000_000) return out;
  let tables: Table[];
  try { tables = parseTables(html); } catch { return out; }
  if (!tables.length) return out;

  // One column→period binding per table, built once. `null` for a table whose
  // headers cannot be read — those keep the value-matching heuristic.
  const reportedEnd = opts?.reportedPeriodEnd && /^\d{4}-\d{2}-\d{2}$/.test(opts.reportedPeriodEnd) ? opts.reportedPeriodEnd : null;
  const headlineQ = reportedEnd ? headlineQuarterOf(html) : null;
  const binds: Array<Binding | null> = tables.map((t) => {
    if (!reportedEnd) return null;
    try { return buildBinding(t.rows, reportedEnd, headlineQ); } catch { return null; }
  });

  const found: Partial<Record<PrItem, Hit>> = {};
  const better = (a: Hit, b: Hit | undefined) => !b || a.scale < b.scale || (a.scale === b.scale && a.tableIdx < b.tableIdx);

  // Pass 1: revenue, to learn the scale and the anchor table.
  if (yearAgo.revenue != null && yearAgo.revenue > 0) {
    for (let ti = 0; ti < tables.length; ti++) {
      for (const r of tables[ti].rows) {
        const lbl = cleanLabel(r.label);
        if (!lbl || !REVENUE.test(lbl) || EXCLUDE.test(lbl.replace(/^(total\s+)?(net\s+)?(revenues?|sales)/i, ''))) continue;
        if (OUTLOOK_ZONE.test(r.rest)) continue;
        const b = binds[ti];
        const h = b ? matchBound(b.pick(r), yearAgo.revenue, false, null, lbl, ti)
          : matchRow(tokens(r.rest), yearAgo.revenue, false, null, lbl, ti);
        if (!h) continue;
        if (!(h.cur > 0) || h.cur < yearAgo.revenue * 0.2 || h.cur > yearAgo.revenue * 5) continue;
        if (better(h, found.revenue)) found.revenue = h;
      }
    }
  }
  const preferScale = found.revenue?.scale ?? null;
  const anchor = found.revenue?.tableIdx ?? null;
  const revCur = found.revenue?.cur ?? null;

  // Pass 2: the dollar lines, then EPS. Anchor table first, then the rest.
  const order = anchor != null ? [anchor, ...tables.map((_, i) => i).filter((i) => i !== anchor)] : tables.map((_, i) => i);
  for (const ti of order) {
    let lastHeader = '';
    const rows = tables[ti].rows;
    const bind = binds[ti];
    const match = (r: Row, toks: number[], ya: number, isEps: boolean, scale: number | null, label: string): Hit | null =>
      bind ? matchBound(bind.pick(r), ya, isEps, scale, label, ti)
        : matchRow(toks, ya, isEps, scale, label, ti);
    // The full-width row that opens a NON-GAAP BLOCK. WisdomTree's income
    // statement prints its GAAP lines, then a bare row reading "As Adjusted
    // (Non-GAAP)", and then repeats every line under names that say nothing
    // about the basis — "Total revenues", "Net income", "Earnings per
    // share-diluted". Its adjusted year-ago EPS is $0.18 against a GAAP $0.17,
    // a cent apart, so the adjusted row validated and $0.31 went out where the
    // company reported $0.28. Only the block banner says which basis the rows
    // beneath it are on, and a banner is a row that carries nothing else.
    let adjBlock = false;
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const lbl = cleanLabel(r.label);
      const toks = tokens(r.rest);
      if (!lbl) continue;
      if (!toks.length) {
        lastHeader = lbl;                                      // a section header row
        const alone = r.cells.filter((c) => c.trim() && !/^[-—–$()%.,:*†‡\s]*$/.test(c.trim())).length === 1;
        // A banner that opens a LIST OF ADJUSTMENTS ("Non-GAAP adjustments:")
        // is not a restatement block — the GAAP lines that follow it in the
        // same table are still GAAP.
        if (alone) adjBlock = ADJ_BLOCK.test(lbl) && !/\badjustments?\b|\breconcil/i.test(lbl);
        continue;
      }
      if (OUTLOOK_ZONE.test(r.rest)) continue;                 // an outlook, not a result
      if (adjBlock) continue;                                  // a non-GAAP restatement of the same lines

      if (yearAgo.operating_income != null && OP_INCOME.test(lbl) && !EXCLUDE.test(lbl.replace(/operating|income|loss|profit|earnings|from operations|\(loss\)/gi, ''))) {
        const h = match(r, toks, yearAgo.operating_income, false, preferScale, lbl);
        if (h && (revCur == null || Math.abs(h.cur) < revCur * 3) && better(h, found.operating_income)) found.operating_income = h;
      }
      if (yearAgo.net_income != null && NET_INCOME.test(lbl) && !EXCLUDE.test(lbl.replace(/net|income|loss|profit|earnings|attributable to|\(loss\)|common|stockholders|shareholders|shareowners|parent|company|inc\.?|corporation|corp\.?|ltd\.?|plc|the|holdings|group/gi, ''))) {
        const h = match(r, toks, yearAgo.net_income, false, preferScale, lbl);
        if (h && (revCur == null || Math.abs(h.cur) < revCur * 3) && better(h, found.net_income)) found.net_income = h;
      }
      if (yearAgo.eps != null) {
        const direct = EPS_DIRECT.test(lbl) && !isBadEpsLabel(lbl) && EPS_PER_SHARE.test(lbl);
        const sub = EPS_SUBROW.test(lbl) && EPS_HEADER.test(lastHeader)
          && !/weighted|shares\s+outstanding|share\s+count/i.test(lastHeader)
          && !isBadEpsLabel(lastHeader) && !isBadEpsLabel(lbl)
          // a bare "Diluted" row is the diluted line whatever the header says;
          // any other sub-row must sit under an explicitly DILUTED header
          && (/^diluted/i.test(lbl) || /diluted/i.test(lastHeader));
        if (direct || sub) {
          const h = match(r, toks, yearAgo.eps, true, null, direct ? lbl : `${lastHeader} · ${lbl}`);
          if (h && Math.abs(h.cur) < 1000 && better(h, found.eps)) found.eps = h;
        }
      }
      // Keep the most recent header-ish label for the two-row EPS form; a row
      // with numbers is not a header.
    }
  }

  const put = (k: PrItem, h: Hit | undefined) => {
    if (!h) return;
    (out as any)[k] = h.cur;
    (out as any)[`${k}_prev`] = h.prev;
    out.matched.push(k);
    out.labels[k] = h.label;
    if (out.scale == null && k !== 'eps') out.scale = h.scale;
  };
  put('revenue', found.revenue);
  put('operating_income', found.operating_income);
  put('net_income', found.net_income);
  put('eps', found.eps);
  return out;
}
