// ═══════════════════════════════════════════════════════════════════════════
// US PRESS-RELEASE BALANCE SHEET (pure) — the CURRENT quarter's balance sheet,
// read from the condensed consolidated balance sheet inside the earnings 8-K.
//
// WHY. On a PRELIM row the announced quarter is not on EDGAR yet, so the card
// falls back to the PREVIOUS quarter's XBRL balance sheet, stamped with `as_of`
// so it does not pretend to be current. But most 8-K releases print the
// condensed balance sheet in full, so the current cash, debt and total assets
// are sitting right there — a week or more before the 10-Q posts them.
//
// HOW THE COLUMNS ARE BOUND. `us-pr-financials` reads the income statement and
// recognises the current column by matching the PRIOR-YEAR one against XBRL.
// A BALANCE SHEET HAS NO YEAR-AGO COLUMN: its comparative is the PRIOR FISCAL
// YEAR END (AppLovin's May-2026 release heads its two columns "March 31, 2026"
// and "December 31, 2025"), so treating column two as a year-ago quarter would
// be flatly wrong. Columns are therefore bound by their HEADERS — two instants,
// one of which must name the announced period end. If no column names it,
// nothing is published.
//
// HOW EVERY FIGURE IS PROVED. That comparative column is itself a date already
// on EDGAR, and that is what makes the whole thing safe: for each line — cash,
// debt, total assets, current liabilities — the reader computes BOTH columns
// and publishes the current one ONLY when the comparative one reproduces the
// filer's own XBRL at that date. So the number the card shows on announcement
// night is built the same way as the number the 10-Q will show a week later,
// by the same arithmetic on the same labels, and a mapping this reader got
// wrong for a given filer cannot reach the card at all.
//
// That check is what settles the two things a release will not tell you
// straight:
//   • SCALE. The caption states it — "(In thousands, except per share data)" —
//     but a caption can be missing, and a share COUNT under a thousands caption
//     may or may not itself be in thousands. Scale is whichever of 1 / 1e3 /
//     1e6 / 1e9 makes the comparative column reproduce XBRL, and the caption,
//     when there is one, must agree. (Precedent: a filer tagging share counts
//     in thousands recently produced a $129.74 EPS against a filed $0.13.)
//   • COMPOSITION. "Cash and cash equivalents" alone, or with the short-term
//     investments line beneath it? "Long-term debt" with or without the current
//     maturities above it? Both readings are defensible; only one reproduces
//     the comparative column, and that is the one used.
//
// A second, blunter net stands behind it: no published figure may sit an order
// of magnitude away from the same filer's PREVIOUS quarter from XBRL.
//
// Nothing here is tuned to a company. Every rule is about the shape of a US
// condensed balance sheet, which has not changed in decades.
// ═══════════════════════════════════════════════════════════════════════════

import type { UsBalanceContext } from './us-earnings-core';

// ─── entity decoding, same shape as us-pr-financials ────────────────────────
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
const cellText = (inner: string): string =>
  decode(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ─── grid: <table> → cells with real column spans ───────────────────────────
// A press-release table is a LAYOUT, not a data structure: spacer columns, a
// separate "$" column, and the heading colspan'd across the group it labels.
// Only a grid that honours colspan/rowspan can say which heading a given number
// sits under, and that is the whole basis of the column binding below.
interface GCell { text: string; c0: number; c1: number; }   // [c0, c1) column range
interface GRow { cells: GCell[]; }
interface GTable { rows: GRow[]; ncols: number; start: number; }

function parseGrid(html: string): GTable[] {
  const out: GTable[] = [];
  const tRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  let guard = 0;
  while ((tm = tRe.exec(html)) && guard++ < 400) {
    const rows: GRow[] = [];
    const carry = new Map<number, { left: number; cell: GCell }>();   // rowspans still open
    const rRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    let rguard = 0;
    let ncols = 0;
    while ((rm = rRe.exec(tm[1])) && rguard++ < 500) {
      const cells: GCell[] = [];
      let col = 0;
      const skipHeld = () => {
        for (;;) {
          const held = carry.get(col);
          if (!held) break;
          cells.push({ text: held.cell.text, c0: col, c1: col + 1 });
          col++;
        }
      };
      const cRe = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
      let cm: RegExpExecArray | null;
      let cguard = 0;
      while ((cm = cRe.exec(rm[1])) && cguard++ < 200) {
        skipHeld();
        const attrs = cm[2] || '';
        const cs = Math.max(1, Math.min(40, parseInt((/colspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || '1', 10) || 1));
        const rs = Math.max(1, Math.min(40, parseInt((/rowspan\s*=\s*["']?(\d+)/i.exec(attrs) || [])[1] || '1', 10) || 1));
        const cell: GCell = { text: cellText(cm[3]), c0: col, c1: col + cs };
        cells.push(cell);
        if (rs > 1) for (let k = col; k < col + cs; k++) carry.set(k, { left: rs - 1, cell });
        col += cs;
      }
      skipHeld();
      ncols = Math.max(ncols, col);
      carry.forEach((v, k) => { v.left -= 1; if (v.left <= 0) carry.delete(k); });
      if (cells.length) rows.push({ cells });
    }
    if (rows.length) out.push({ rows, ncols, start: tm.index });
  }
  return out;
}

// ─── numbers ────────────────────────────────────────────────────────────────
/** A cell that is a single figure. `(1,234)` is negative; a lone dash is the
 *  filer writing zero, which is what an unused debt line looks like. */
function cellNumber(t: string): number | null {
  const s = t.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^[—–\-]$/.test(s)) return 0;
  if (/%/.test(s)) return null;                      // a percentage is not a balance
  const m = /^\(?\s*\$?\s*([-−–]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*\)?\s*$/.exec(s);
  if (!m) return null;
  const v = parseFloat(m[2].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  return (/^\(/.test(s) || m[1]) ? -v : v;
}

// ─── dates and period headings ──────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const DATE_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/;
function isoFrom(text: string): string | null {
  const d = DATE_RE.exec(text);
  if (!d) return null;
  const mo = MONTHS[d[1].toLowerCase()];
  if (!mo) return null;
  const day = parseInt(d[2], 10), yr = parseInt(d[3], 10);
  if (!(day >= 1 && day <= 31) || !(yr >= 1990 && yr <= 2100)) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const dayGap = (a: string, b: string) =>
  Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000);

/** Months covered by a duration heading, or null when the heading names an
 *  INSTANT (which is what every balance-sheet column is). 52/53-week retailers
 *  say "Thirteen Weeks Ended", which is the same three months. */
function durationMonths(head: string): number | null {
  const h = head.toLowerCase();
  if (/\b(?:three|3)\s*[-\s]?months?\s+ended\b|\bthirteen\s+weeks?\s+ended\b|\b13\s+weeks?\s+ended\b|\bquarters?\s+ended\b|\bthree\s+months?\s+ending\b/.test(h)) return 3;
  if (/\b(?:six|6)\s*[-\s]?months?\s+ended\b|\btwenty[-\s]?six\s+weeks?\s+ended\b|\b26\s+weeks?\s+ended\b/.test(h)) return 6;
  if (/\b(?:nine|9)\s*[-\s]?months?\s+ended\b|\bthirty[-\s]?nine\s+weeks?\s+ended\b|\b39\s+weeks?\s+ended\b/.test(h)) return 9;
  if (/\b(?:twelve|12)\s*[-\s]?months?\s+ended\b|\bfifty[-\s]?(?:two|three)\s+weeks?\s+ended\b|\b5[23]\s+weeks?\s+ended\b|\byears?\s+ended\b|\bfiscal\s+year\s+ended\b/.test(h)) return 12;
  return null;
}

interface Column { c0: number; c1: number; iso: string; months: number | null; }

/**
 * The period columns of one table, from its heading rows.
 *
 * A heading row is any row above the first row of figures. Their cell texts are
 * stacked per column — the "Three Months Ended" that spans two year columns and
 * the "2026" underneath it belong to the same column — and a column is a period
 * column when that stack names a date.
 */
function columnsOf(t: GTable): { cols: Column[]; firstDataRow: number } {
  // A HEADING SPLIT ACROSS TWO ROWS IS STILL A HEADING. Most filers write
  // "March 31," and "December 31," on one row and "2026" / "2025" on the next
  // (Lineage, Tempus, Hagerty — 83 of the 250 releases in the first audit run),
  // and a row of bare years is numeric enough to look like the first row of
  // figures. Reading it as data stopped the stack one row short of the year and
  // no column named a date at all, so every one of those releases was refused.
  const isYearRow = (r: GRow): boolean => {
    let years = 0;
    for (const c of r.cells) {
      const s = c.text.trim();
      if (!s || /^[$(),.:;|\-—–]+$/.test(s)) continue;
      if (/^\(?(?:19|20)\d{2}\)?$/.test(s)) { years++; continue; }
      return false;                                 // real content: a data row
    }
    return years > 0 && years <= 6;
  };
  let firstData = -1;
  for (let i = 0; i < t.rows.length; i++) {
    if (isYearRow(t.rows[i])) continue;
    if (t.rows[i].cells.some((c) => /\d/.test(c.text) && cellNumber(c.text) != null)) { firstData = i; break; }
  }
  if (firstData <= 0) return { cols: [], firstDataRow: firstData };
  const stack: string[] = new Array(t.ncols).fill('');
  for (let i = 0; i < firstData; i++) {
    for (const c of t.rows[i].cells) {
      if (!c.text) continue;
      for (let k = c.c0; k < Math.min(c.c1, t.ncols); k++) stack[k] = (stack[k] + ' ' + c.text).trim();
    }
  }
  // A split heading — "June 30," on one row and "2026" on the next — reads as
  // one string once stacked, which is why the stack is built before parsing.
  const cols: Column[] = [];
  let k = 0;
  while (k < t.ncols) {
    const s = stack[k];
    if (!s) { k++; continue; }
    let j = k;
    while (j + 1 < t.ncols && stack[j + 1] === s) j++;
    const iso = isoFrom(s);
    if (iso) cols.push({ c0: k, c1: j + 1, iso, months: durationMonths(s) });
    k = j + 1;
  }
  return { cols, firstDataRow: firstData };
}

/** The value in one row under one column: the numeric cell whose own span sits
 *  inside the heading's span. The "$" cell and the spacers beside it carry no
 *  number and are skipped; two figures under one heading is ambiguous. */
function valueUnder(row: GRow, col: Column): number | null {
  let hit: number | null = null;
  for (const c of row.cells) {
    if (c.c1 <= col.c0 || c.c0 >= col.c1) continue;
    const v = cellNumber(c.text);
    if (v == null) continue;
    if (hit != null) return null;
    hit = v;
  }
  return hit;
}

/** The row's label: the first cell with letters that is not itself a figure. */
function rowLabel(row: GRow): string {
  for (const c of row.cells) {
    if (!/[A-Za-z]/.test(c.text)) continue;
    if (cellNumber(c.text) != null) continue;
    return c.text.replace(/\(\s*\d+\s*\)|\[\s*\d+\s*\]|\*+/g, ' ')
      .replace(/\((?:in\s+)?(?:thousands|millions|billions)[^)]*\)/gi, ' ')
      .replace(/\s+/g, ' ').replace(/[:\s]+$/g, '').trim();
  }
  return '';
}

// ─── the balance-sheet line items ───────────────────────────────────────────
const L_TOTAL_ASSETS = /^total\s+assets$/i;
const L_TOTAL_CURR_ASSETS = /^total\s+current\s+assets$/i;
const L_TOTAL_CURR_LIAB = /^total\s+current\s+liabilities$/i;
const L_TOTAL_LIAB = /^total\s+liabilities(?:\s+and\s+.*)?$/i;
const L_TOTAL_EQUITY = /^total\s+(?:stockholders|shareholders|shareowners|members|partners)'?\s*(?:deficit|equity).*$/i;

/** Plain cash. The restricted-cash roll-up is a superset and is only the right
 *  answer when the plain line is absent — the same ordering `balanceContext`
 *  uses on the XBRL side, for the same reason (Buckle tags only the roll-up). */
const L_CASH_PLAIN = /^cash(?:\s+and\s+cash\s+equivalents|\s*&\s*cash\s+equivalents|\s+equivalents)?(?:\s*,?\s*(?:net|at\s+carrying\s+value|unrestricted))?$/i;
const L_CASH_RESTRICTED = /^cash,?\s+cash\s+equivalents,?\s+and\s+restricted\s+cash(?:\s+equivalents)?$|^cash\s+and\s+restricted\s+cash(?:\s+equivalents)?$/i;
/**
 * Cash stated INCLUDING investments, and investments as their own line.
 *
 * Each comes in two strengths, because the wording decides how much proof the
 * line needs:
 *   • EXPLICIT — the label itself says short-term ("Short-term investments").
 *     A label that names its own maturity needs nothing else.
 *   • AMBIGUOUS — "Investments", "Marketable securities". On Disney's balance
 *     sheet the line called "Investments" is $8.4bn of NON-current equity
 *     stakes, and adding it to cash reported $14.1bn against a filed $5.7bn.
 *     These are taken only from INSIDE the current-assets section, which is
 *     the structural proof the label does not give.
 *
 * The wording is also what sets `cash_incl_st_inv` — never a guess.
 */
const L_CASH_WITH_INV_EXPLICIT = /^cash(?:\s+and\s+cash\s+equivalents)?(?:\s*,)?\s+and\s+short[-\s]?term\s+(?:investments|marketable\s+securities)$|^cash,?\s+cash\s+equivalents,?\s+and\s+short[-\s]?term\s+(?:investments|marketable\s+securities)$/i;
const L_CASH_WITH_INV_AMBIG = /^cash(?:\s+and\s+cash\s+equivalents)?(?:\s*,)?\s+and\s+(?:investments|marketable\s+securities)$|^cash,?\s+cash\s+equivalents,?\s+and\s+(?:investments|marketable\s+securities)$/i;
const L_ST_INV_EXPLICIT = /^(?:short[-\s]?term\s+investments|short[-\s]?term\s+marketable\s+securities|marketable\s+securities,?\s+(?:current|short[-\s]?term)|investments,?\s+current|available[-\s]for[-\s]sale\s+(?:debt\s+)?securities,?\s+current|marketable\s+investments,?\s+current)(?:\s*,?\s*(?:at\s+fair\s+value|net))?$/i;
const L_ST_INV_AMBIG = /^(?:marketable\s+securities|investments|marketable\s+investments|available[-\s]for[-\s]sale\s+(?:debt\s+)?securities)(?:\s*,?\s*(?:at\s+fair\s+value|net))?$/i;

/** Current debt. Several of these can appear at once (Evertec prints both a
 *  current portion of long-term debt and short-term borrowings), so they are
 *  SUMMED, not chosen between — the composition is proved on the comparative
 *  column either way. */
const L_DEBT_CURRENT = /^(?:current\s+(?:portion|maturities|installments)\s+of\s+(?:long[-\s]?term\s+)?(?:debt|borrowings|notes\s+payable|obligations|debt\s+obligations)|(?:long[-\s]?term\s+)?debt,?\s*current(?:\s+portion|\s+maturities)?|short[-\s]?term\s+(?:debt|borrowings|notes\s+payable|loans)|notes\s+payable,?\s*current(?:\s+portion)?|current\s+debt|current\s+portion\s+of\s+convertible\s+(?:senior\s+)?notes|convertible\s+(?:senior\s+)?notes,?\s*current|borrowings\s+under\s+(?:the\s+)?(?:revolving\s+)?credit\s+facility|line\s+of\s+credit|revolving\s+credit\s+facility|commercial\s+paper)(?:\s*,?\s*net(?:\s+of\s+.*)?)?$/i;
/** Long-term debt, as it appears BELOW the total-current-liabilities line. A
 *  caption there never includes the current maturities — the balance sheet has
 *  already counted them above — so the two are summed. */
const L_DEBT_LONGTERM = /^(?:long[-\s]?term\s+(?:debt|borrowings|notes\s+payable)|debt|borrowings|notes\s+payable|convertible\s+(?:senior\s+)?notes|senior\s+notes|term\s+loan)(?:\s*,?\s*(?:net|non-?current|less\s+current\s+(?:portion|maturities|installments)|net\s+of\s+current\s+(?:portion|maturities)|excluding\s+current\s+(?:portion|maturities)|net\s+of\s+(?:unamortized\s+)?(?:debt\s+)?(?:issuance|discount|deferred).*|and\s+finance\s+lease\s+obligations))*$/i;
const L_DEBT_TOTAL = /^total\s+(?:debt|borrowings)$/i;
// Lease liabilities are NOT debt here, exactly as they are not in the XBRL
// ladder `balanceContext` walks. Nothing that names a lease is matched above.

// ─── scale ──────────────────────────────────────────────────────────────────
const SCALE_RE = /\(\s*(?:us\s*)?\$?\s*(?:amounts?\s+|dollars?\s+|figures?\s+)?in\s+(thousands|millions|billions)\b|\b(?:amounts?|dollars?|figures?)\s+in\s+(thousands|millions|billions)\b|\bin\s+(thousands|millions|billions)\s*,?\s*(?:except|unaudited|and)/i;
const SCALE_OF: Record<string, number> = { thousands: 1e3, millions: 1e6, billions: 1e9 };
/** The caption's scale for a table, read from its own heading rows first and
 *  then from the prose immediately above it. Advisory only: it must agree with
 *  what the comparative column proves, and it is never used alone. */
function captionScale(html: string, t: GTable, firstDataRow: number): number | null {
  const inTable = t.rows.slice(0, Math.max(1, firstDataRow)).map((r) => r.cells.map((c) => c.text).join(' ')).join(' ');
  const above = decode(html.slice(Math.max(0, t.start - 1800), t.start).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  for (const src of [inTable, above.slice(-1200)]) {
    const m = SCALE_RE.exec(src);
    if (m) { const w = (m[1] || m[2] || m[3] || '').toLowerCase(); if (SCALE_OF[w]) return SCALE_OF[w]; }
  }
  return null;
}

// ─── output ─────────────────────────────────────────────────────────────────
export interface ReleaseBalanceSheet extends UsBalanceContext {
  /** Always 'release' here — the marker the payload carries so the card can
   *  tell a release-derived balance sheet from an XBRL one. */
  source: 'release';
  /** The scale the comparative column proved, and the labels actually used, so
   *  a verification run can show its working. */
  scale: number;
  labels: Record<string, string>;
  /** The instant the comparative column names — the date whose XBRL proved
   *  every figure above. Not published on the card; kept for audit. */
  proved_against: string;
}

/**
 * The XBRL context at one instant, supplied by the caller (the route passes
 * `(iso) => balanceContext(facts, iso)`). Keeping it a callback is what keeps
 * this module pure and testable: it never touches EDGAR itself.
 */
export type XbrlAt = (iso: string) => UsBalanceContext | null;

const decades = (a: number, b: number) => Math.abs(Math.log10(Math.abs(a / b)));
/**
 * Reproduces the filed figure?
 *
 * The bar is deliberately near-exact: the release and the XBRL are the SAME
 * number, and the ONLY legitimate reason for any difference is that the release
 * rounds to its own unit where XBRL is stated in dollars. So the band is that
 * unit — half a million for a release written in millions, half a thousand for
 * one written in thousands — and never a percentage of the figure, because a
 * percentage grows with the number and lets a big company's near-miss through.
 *
 * Two live examples of what the band is holding back. Lyell's combined "cash,
 * cash equivalents and marketable securities" also folds in the NON-current
 * securities; it validated on a comparative column where the non-current slice
 * happened to be small, then published 2.7% above the filed figure for the
 * quarter announced. Global Payments' two balance-sheet debt lines run about
 * 0.4-0.6% below the `LongTermDebt` element it tags — consistently, at both
 * dates — so a percentage band wide enough for the comparative column is wide
 * enough for a $130m error on the announced one. Both are refused now.
 *
 * `unit` is the release's own rounding unit, in $m. A tiny relative band is
 * kept beside it only for figures large enough that dollar-level agreement is
 * not on offer at all.
 */
function reproduces(a: number | null, b: number | null | undefined, unit = 0): boolean {
  if (a == null || b == null) return false;
  const tol = Math.max(0.06, unit * 0.5 + 1e-9, Math.abs(b) * 0.003);
  return Math.abs(a - b) <= tol;
}

/**
 * The announced quarter's balance sheet, read from the earnings release.
 *
 * Returns null — meaning "keep the previous quarter's XBRL context, stamped
 * with its own date" — whenever the release carries no balance sheet, no column
 * names the announced period end, the comparative column's XBRL is not
 * available, or nothing reproduces it. That fallback is the safe default and
 * every failure path lands on it.
 *
 * @param html               the EX-99 press release
 * @param opts.periodEndISO  the period end being announced
 * @param opts.xbrlAt        the filer's own XBRL context at a given instant
 * @param opts.prior         the PREVIOUS quarter's XBRL context (order-of-
 *                           magnitude backstop; optional)
 */
export function balanceSheetFromReleaseHtml(
  html: string,
  opts: { periodEndISO: string; xbrlAt: XbrlAt; prior?: UsBalanceContext | null; onRefuse?: (reason: string) => void },
): ReleaseBalanceSheet | null {
  const periodEnd = opts?.periodEndISO;
  // A diagnostics hook, not a feature: a verification run needs to know WHY a
  // release was refused, and the alternative — inferring it from a null — is
  // how a coverage regression goes unnoticed.
  const no = (why: string): null => { try { opts.onRefuse?.(why); } catch { /* never */ } return null; };
  if (!html || html.length > 6_000_000) return no('no html');
  if (!periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return no('no period end');
  if (typeof opts.xbrlAt !== 'function') return no('no xbrl callback');
  const prior = opts.prior || null;

  let tables: GTable[];
  try { tables = parseGrid(html); } catch { return no('grid parse failed'); }
  if (!tables.length) return no('no tables');

  // ── 1. find the balance sheet, structurally ──────────────────────────────
  // Not "the third table" and not "the table after the words BALANCE SHEET":
  // the table that carries a total-assets line alongside a total-liabilities or
  // total-equity line, whose columns are INSTANTS, and one of whose instants is
  // the announced period end.
  interface Found { t: GTable; cur: Column; cmp: Column; ref: UsBalanceContext; firstDataRow: number; }
  let bs: Found | null = null;
  let near = '';                                               // why the closest candidate table failed
  for (const t of tables) {
    const { cols, firstDataRow } = columnsOf(t);
    if (firstDataRow < 0 || cols.length < 2) continue;
    if (cols.some((c) => c.months != null)) continue;          // a statement of operations, not a balance sheet
    const labels = t.rows.map(rowLabel);
    const hasAssets = labels.some((l) => L_TOTAL_ASSETS.test(l));
    const hasFooting = labels.some((l) => L_TOTAL_LIAB.test(l) || L_TOTAL_CURR_LIAB.test(l) || L_TOTAL_EQUITY.test(l));
    if (!hasAssets || !hasFooting) continue;
    near = 'no column names the announced period end';
    // ±4 days: a 52/53-week filer's own balance-sheet date can sit a few days
    // from the period end the consensus feed carries, and it is still the same
    // balance sheet. Anything further apart is a different period.
    const cur = cols.find((c) => Math.abs(dayGap(c.iso, periodEnd)) <= 4);
    if (!cur) continue;
    near = 'no comparative column whose XBRL we hold';
    // THE COMPARATIVE COLUMN IS THE PROOF, NOT A YEAR-AGO QUARTER. For most
    // filers it is the prior FISCAL YEAR END; whatever it is, it is a date
    // already filed, so its XBRL is the yardstick every line below is measured
    // with. No published figure is ever derived from it.
    let found: Found | null = null;
    for (const cmp of cols) {
      if (cmp === cur || cmp.iso === cur.iso) continue;
      const ref = opts.xbrlAt(cmp.iso);
      if (!ref || !ref.as_of || Math.abs(dayGap(ref.as_of, cmp.iso)) > 4) continue;
      found = { t, cur, cmp, ref, firstDataRow };
      break;
    }
    if (found) { bs = found; break; }
  }
  if (!bs) return no(near || 'no balance-sheet table');

  const rows = bs.t.rows;
  const labels = rows.map(rowLabel);
  const idxOf = (re: RegExp) => labels.findIndex((l) => l && re.test(l));
  const iCurrAssets = idxOf(L_TOTAL_CURR_ASSETS);
  const iCurrLiab = idxOf(L_TOTAL_CURR_LIAB);

  /** Every row matching a shape, within an optional row range, as [cur, cmp]
   *  pairs in the release's own units. */
  const linesIn = (re: RegExp, lo = 0, hi = rows.length): Array<{ cur: number; cmp: number; label: string }> => {
    const out: Array<{ cur: number; cmp: number; label: string }> = [];
    for (let i = Math.max(0, lo); i < Math.min(rows.length, hi); i++) {
      if (!labels[i] || !re.test(labels[i])) continue;
      const a = valueUnder(rows[i], bs!.cur), b = valueUnder(rows[i], bs!.cmp);
      if (a == null || b == null) continue;
      out.push({ cur: a, cmp: b, label: labels[i] });
    }
    return out;
  };
  const one = (re: RegExp, lo?: number, hi?: number) => {
    const all = linesIn(re, lo, hi);
    if (!all.length) return null;
    // Two different lines wearing the same shape means wording this reader
    // cannot disambiguate — refuse rather than choose.
    if (all.some((x) => Math.abs(x.cur - all[0].cur) > 0.5)) return null;
    return all[0];
  };

  const assets = one(L_TOTAL_ASSETS);
  if (!assets || !(assets.cur > 0) || !(assets.cmp > 0)) return no('total assets not readable in both columns');

  // ── 2. the scale, PROVED by the comparative column ───────────────────────
  const stated = captionScale(html, bs.t, bs.firstDataRow);
  const refAssets = bs.ref.total_assets_musd;
  let scale: number | null = null;
  if (refAssets != null && refAssets > 0) {
    const fits = [1, 1e3, 1e6, 1e9].filter((s) => reproduces((assets.cmp * s) / 1e6, refAssets, s / 1e6));
    if (fits.length === 1) scale = fits[0];
  }
  if (scale == null) {
    // The filer tagged no `Assets` at the comparative date (banks and some
    // REITs). Fall back to the caption, but then demand that some OTHER line
    // reproduce the comparative column before anything is published.
    if (stated == null) return no('scale unprovable: no XBRL total assets and no caption');
    scale = stated;
  } else if (stated != null && stated !== scale) {
    // The caption and the filing disagree about the units. One of them is
    // wrong and there is no way to tell which — publish nothing.
    return no('caption scale disagrees with the filed figures');
  }
  const musd = (v: number) => Math.round((v * scale!) / 1e4) / 100;

  const out: ReleaseBalanceSheet = {
    cash_musd: null, cash_incl_st_inv: false, debt_musd: null,
    sbc_musd: null, buyback_musd: null, dividends_musd: null,
    diluted_shares_m: null, diluted_shares_yoy_pct: null,
    as_of: bs.cur.iso,                                        // the release's OWN column date
    total_assets_musd: null, current_liabilities_musd: null,
    source: 'release', scale, labels: {}, proved_against: bs.cmp.iso,
  };
  let proved = 0;

  // The blunt second net the comparative check sits in front of: nothing may
  // land an order of magnitude from the same filer's previous quarter.
  const sane = (v: number, p: number | null | undefined): boolean =>
    p == null || !(Math.abs(p) >= 1) || decades(Math.abs(v) || 1e-9, Math.abs(p)) < 1;

  /** Publish `cur` only when `cmp` reproduces the filer's own XBRL. */
  const publish = (
    key: 'total_assets_musd' | 'current_liabilities_musd' | 'cash_musd' | 'debt_musd',
    lbl: string, cur: number, cmp: number, refVal: number | null | undefined, priorVal?: number | null,
  ): boolean => {
    if (!reproduces(musd(cmp), refVal, scale! / 1e6)) return false;
    const v = musd(cur);
    if (!sane(v, priorVal)) return false;
    (out as any)[key] = v;
    out.labels[key.replace(/_musd$/, '')] = lbl;
    proved++;
    return true;
  };

  publish('total_assets_musd', assets.label, assets.cur, assets.cmp, refAssets, prior?.total_assets_musd);
  const cl = one(L_TOTAL_CURR_LIAB);
  if (cl) publish('current_liabilities_musd', cl.label, cl.cur, cl.cmp, bs.ref.current_liabilities_musd, prior?.current_liabilities_musd);

  // ── 3. cash ──────────────────────────────────────────────────────────────
  // Both defensible readings are built and the one that reproduces the
  // comparative column wins, so the figure on the PRELIM card is composed
  // exactly as the figure the 10-Q will produce a week later. `cash_incl_st_inv`
  // then comes from the winning construction's own wording, never a guess.
  {
    // AN AMBIGUOUS INVESTMENTS LINE IS ONLY SAFE INSIDE A CURRENT-ASSETS
    // SECTION. Lyell's May-2026 release presents an UNCLASSIFIED balance sheet
    // whose single line reads "Cash, cash equivalents and marketable
    // securities | 260,977" — and 6,954 of that is NON-current securities, so
    // it stands 2.7% above the $254.0m the 10-Q's cash-plus-short-term-
    // investments would later show. On a classified balance sheet the section
    // itself proves the securities are current; without one there is nothing to
    // prove it with, so an ambiguous line is not used at all.
    const upTo = iCurrAssets >= 0 ? iCurrAssets : rows.length;
    const withInv = one(L_CASH_WITH_INV_EXPLICIT, 0, upTo)
      || (iCurrAssets > 0 ? one(L_CASH_WITH_INV_AMBIG, 0, iCurrAssets) : null);
    const plain = one(L_CASH_PLAIN, 0, upTo);
    const restricted = one(L_CASH_RESTRICTED, 0, upTo);
    const sti = one(L_ST_INV_EXPLICIT, 0, upTo)
      || (iCurrAssets > 0 ? one(L_ST_INV_AMBIG, 0, iCurrAssets) : null);
    interface Cand { cur: number; cmp: number; incl: boolean; label: string; }
    const cands: Cand[] = [];
    const base = plain || restricted;
    if (withInv) cands.push({ cur: withInv.cur, cmp: withInv.cmp, incl: true, label: withInv.label });
    if (base && sti && sti.cur > 0) cands.push({ cur: base.cur + sti.cur, cmp: base.cmp + sti.cmp, incl: true, label: `${base.label} + ${sti.label}` });
    if (base) cands.push({ cur: base.cur, cmp: base.cmp, incl: false, label: base.label });
    if (plain && restricted) cands.push({ cur: restricted.cur, cmp: restricted.cmp, incl: false, label: restricted.label });
    for (const c of cands) {
      if (publish('cash_musd', c.label, c.cur, c.cmp, bs.ref.cash_musd, prior?.cash_musd)) { out.cash_incl_st_inv = c.incl; break; }
    }
  }

  // ── 4. debt ──────────────────────────────────────────────────────────────
  // TOTAL DEBT MUST BE A TOTAL — the rule `balanceContext` learned on GE
  // Aerospace and JPMorgan, restated for free-text labels. The balance sheet's
  // own sections do the disambiguation: a debt caption ABOVE the
  // total-current-liabilities line is a current maturity, one BELOW it is
  // long-term and by construction excludes what was already counted above, so
  // the two sides are summed. Where the release states its own "Total debt",
  // that is taken instead. Every reading is then thrown away unless the
  // comparative column reproduces the filer's XBRL total — which is what
  // stopped Redwire (long-term line only, current portion missed, 5% light) and
  // Evertec (two current lines, one of them dropped, 5% light) reaching a card.
  {
    interface Cand { cur: number; cmp: number; label: string; }
    const cands: Cand[] = [];
    const total = one(L_DEBT_TOTAL);
    if (total) cands.push({ cur: total.cur, cmp: total.cmp, label: total.label });
    const curLines = iCurrLiab > 0
      ? linesIn(L_DEBT_CURRENT, iCurrAssets >= 0 ? iCurrAssets : 0, iCurrLiab)
      : [];
    const ltLines = iCurrLiab >= 0 ? linesIn(L_DEBT_LONGTERM, iCurrLiab + 1) : linesIn(L_DEBT_LONGTERM);
    const sum = (a: Array<{ cur: number; cmp: number }>, f: 'cur' | 'cmp') => a.reduce((s, x) => s + x[f], 0);
    const names = (a: Array<{ label: string }>) => a.map((x) => x.label).join(' + ');
    if (curLines.length || ltLines.length) {
      cands.push({
        cur: sum(curLines, 'cur') + sum(ltLines, 'cur'),
        cmp: sum(curLines, 'cmp') + sum(ltLines, 'cmp'),
        label: [names(curLines), names(ltLines)].filter(Boolean).join(' + '),
      });
    }
    // The long-term side ALONE is offered only when the balance sheet shows no
    // current debt at all — a filer whose XBRL total happens to be the
    // non-current element is still not a filer whose total debt excludes the
    // maturities printed above the subtotal. IBEX's release shows $0.82m
    // current and $0.57m long-term; its XBRL tags only `DebtCurrent`, and at
    // the comparative date that element sat close enough to the long-term line
    // for a long-term-only reading to validate by coincidence — small numbers
    // make cheap coincidences. If the balance sheet prints a current-debt line,
    // the total includes it or nothing is published.
    if (ltLines.length && !curLines.length) cands.push({ cur: sum(ltLines, 'cur'), cmp: sum(ltLines, 'cmp'), label: names(ltLines) });
    for (const c of cands) {
      if (c.cur < 0 || c.cmp < 0) continue;
      if (publish('debt_musd', c.label, c.cur, c.cmp, bs.ref.debt_musd, prior?.debt_musd)) break;
    }
  }

  // Nothing reproduced the comparative column beyond total assets on a caption
  // scale we could not prove — that is not a balance sheet we understand.
  if (proved === 0 || (refAssets == null && proved < 2)) return no('nothing reproduced the comparative column');

  // ── 5. diluted share count, from the statement of operations ─────────────
  const sh = dilutedSharesFromRelease(tables, periodEnd, opts.xbrlAt);
  if (sh) {
    out.diluted_shares_m = sh.now;
    out.diluted_shares_yoy_pct = sh.yoy_pct;
    out.labels.diluted_shares = sh.label;
  }

  // ── 6. the quarter's flows, when the release states a THREE-MONTH column ─
  const fl = quarterFlowsFromRelease(tables, periodEnd, opts.xbrlAt);
  if (fl) {
    out.sbc_musd = fl.sbc; out.buyback_musd = fl.buyback; out.dividends_musd = fl.dividends;
    out.flows_as_of = periodEnd;
    Object.assign(out.labels, fl.labels);
  }

  return out;
}

// ─── weighted-average diluted shares ────────────────────────────────────────
/** A weighted-average share COUNT row, which is the only kind of row a share
 *  count may be taken from. "Weighted-average shares used in computing net loss
 *  per share … basic and diluted" is one; "Non-GAAP diluted shares" is not, and
 *  neither is a per-share amount that merely mentions dilution. */
const SHARE_COUNT_ROW = /\bshares?\b/i;
const SHARE_COUNT_KIND = /weighted[-\s]?average|shares?\s+used\s+in|shares?\s+used\s+to\s+compute/i;
const L_DILUTED_SHARES = /dilut/i;
/** Basic-only is a different line; "basic and diluted" is the SAME line for a
 *  company with no dilution, which is every loss-maker. */
const BAD_SHARE_ROW = /\bbasic\b(?!\s*(?:and|&|\/|,)\s*dilut)|anti-?dilut|potential|option|warrant|restricted\s+stock|non-?gaap|adjusted|pro\s*forma/i;
/**
 * A table that reconciles GAAP to non-GAAP is not the statement of operations,
 * however much its rows look like one.
 *
 * Fastly's May-2026 release carries "Weighted average diluted common shares |
 * 176,494 | 143,284" in its non-GAAP reconciliation — a NON-GAAP diluted count,
 * 22.9m of equity awards above the 153,579 its GAAP statement two tables
 * earlier reports, and its year-ago column is IDENTICAL to the GAAP one (the
 * company was loss-making then, so nothing was dilutive). The year-ago check
 * therefore passed and a non-GAAP share count went onto the card. The tell is
 * the table, not the row: a reconciliation says so somewhere in its labels.
 */
const NON_GAAP_TABLE = /non-?gaap|reconciliation\s+of\s+gaap|adjusted\s+(?:ebitda|net|operating|earnings)|pro\s*forma/i;

/**
 * The quarter's weighted-average DILUTED share count, from the release's
 * statement of operations.
 *
 * Bound to a column the heading itself calls a THREE-MONTH (or thirteen-week)
 * period ending on the announced date — never a six- or nine-month column,
 * which is the trap that put Fastenal's half-year EPS on its quarter card in
 * the income-statement reader.
 *
 * SHARE SCALE IS SETTLED SEPARATELY FROM THE DOLLAR SCALE, and the same way
 * everything else here is: the YEAR-AGO three-month column of the same row is a
 * quarter already on EDGAR, so the scale is whichever of 1 / 1e3 / 1e6
 * reproduces the filer's own weighted-average diluted count for it. A release
 * with no year-ago column publishes no share count.
 */
function dilutedSharesFromRelease(
  tables: GTable[], periodEnd: string, xbrlAt: XbrlAt,
): { now: number; yoy_pct: number | null; label: string } | null {
  for (const t of tables) {
    const { cols, firstDataRow } = columnsOf(t);
    if (firstDataRow < 0 || !cols.length) continue;
    const col = cols.find((c) => c.months === 3 && Math.abs(dayGap(c.iso, periodEnd)) <= 4);
    if (!col) continue;
    const yoy = cols.find((c) => c.months === 3 && Math.abs(Math.abs(dayGap(col.iso, c.iso)) - 365) <= 25) || null;
    if (!yoy) continue;
    const ref = xbrlAt(yoy.iso);
    const refShares = ref?.diluted_shares_m ?? null;
    if (refShares == null || !(refShares > 0) || !ref?.as_of || Math.abs(dayGap(ref.as_of, yoy.iso)) > 6) continue;
    const labels = t.rows.map(rowLabel);
    if (NON_GAAP_TABLE.test(labels.join(' | '))) continue;
    for (let i = 0; i < t.rows.length; i++) {
      const l = labels[i];
      if (!l || !L_DILUTED_SHARES.test(l) || !SHARE_COUNT_ROW.test(l) || !SHARE_COUNT_KIND.test(l) || BAD_SHARE_ROW.test(l)) continue;
      const raw = valueUnder(t.rows[i], col);
      const rawY = valueUnder(t.rows[i], yoy);
      if (raw == null || !(raw > 0) || rawY == null || !(rawY > 0)) continue;
      const s = [1, 1e3, 1e6].find((k) => reproduces((rawY * k) / 1e6, refShares, k / 1e6));
      if (!s) continue;
      const now = Math.round(((raw * s) / 1e6) * 100) / 100;
      const then = (rawY * s) / 1e6;
      return { now, yoy_pct: Math.round((now / then - 1) * 10000) / 100, label: l };
    }
  }
  return null;
}

// ─── the quarter's stock comp, buybacks and dividends ───────────────────────
// A release's cash-flow statement is year-to-date, exactly as the 10-Q's is,
// and the release does not carry the previous quarter's cumulative figure to
// de-cumulate against. So these are published ONLY when the filer presents a
// column its own heading calls a three-month period ending on the announced
// date, AND the year-ago three-month column of the same row reproduces the
// filer's XBRL for that quarter. Where it does not, they stay null and the
// route keeps the previous quarter's XBRL flows, stamped with their own date.
const L_SBC = /^(?:non[-\s]?cash\s+)?(?:stock|share|equity)[-\s]?based\s+compensation(?:\s+(?:expense|costs?))?(?:,?\s*net.*)?$/i;
const L_BUYBACK = /^(?:repurchases?\s+(?:of|and\s+retirement\s+of)\s+(?:common\s+)?(?:stock|shares)|purchases?\s+of\s+(?:treasury\s+stock|common\s+stock)|(?:common\s+)?stock\s+repurchases?|repurchases?\s+of\s+treasury\s+stock|payments?\s+for\s+repurchases?\s+of\s+(?:common\s+)?stock|share\s+repurchases?)(?:\s*,?\s*(?:net|including.*))?$/i;
const L_DIVIDENDS = /^(?:(?:cash\s+)?dividends?\s+paid(?:\s+(?:to|on)\s+.{0,50})?|payments?\s+of\s+(?:cash\s+)?dividends?(?:\s+.{0,40})?|dividends?\s+(?:paid\s+)?on\s+common\s+stock)$/i;

function quarterFlowsFromRelease(
  tables: GTable[], periodEnd: string, xbrlAt: XbrlAt,
): { sbc: number | null; buyback: number | null; dividends: number | null; labels: Record<string, string> } | null {
  for (const t of tables) {
    const { cols, firstDataRow } = columnsOf(t);
    if (firstDataRow < 0 || !cols.length) continue;
    const col = cols.find((c) => c.months === 3 && Math.abs(dayGap(c.iso, periodEnd)) <= 4);
    const yoy = col ? cols.find((c) => c.months === 3 && Math.abs(Math.abs(dayGap(col.iso, c.iso)) - 365) <= 25) : null;
    if (!col || !yoy) continue;
    const labels = t.rows.map(rowLabel);
    // Only a cash-flow statement: it is the one table with an operating- or
    // financing-activities caption. Stock comp also appears in a non-GAAP
    // reconciliation, where it is an add-back on a different basis.
    const flat = labels.join(' | ').toLowerCase();
    if (!/operating\s+activities|financing\s+activities/.test(flat)) continue;
    const ref = xbrlAt(yoy.iso);
    if (!ref) continue;
    const scale = [1, 1e3, 1e6].find((k) => {
      // The scale of a cash-flow table is proved the same way as everything
      // else: on a line whose year-ago quarter XBRL already holds.
      for (const [re, refVal] of [[L_SBC, ref.sbc_musd], [L_DIVIDENDS, ref.dividends_musd], [L_BUYBACK, ref.buyback_musd]] as Array<[RegExp, number | null]>) {
        if (refVal == null || !(refVal > 0.05)) continue;
        for (let i = 0; i < t.rows.length; i++) {
          if (!labels[i] || !re.test(labels[i])) continue;
          const v = valueUnder(t.rows[i], yoy);
          if (v != null && reproduces((Math.abs(v) * k) / 1e6, refVal, k / 1e6)) return true;
        }
      }
      return false;
    });
    if (!scale) continue;
    const get = (re: RegExp): { v: number; label: string } | null => {
      let hit: { v: number; label: string } | null = null;
      for (let i = 0; i < t.rows.length; i++) {
        if (!labels[i] || !re.test(labels[i])) continue;
        const v = valueUnder(t.rows[i], col);
        if (v == null) continue;
        if (hit && Math.abs(hit.v - Math.abs(v)) > 0.5) return null;
        if (!hit) hit = { v: Math.abs(v), label: labels[i] };
      }
      return hit;
    };
    const s = get(L_SBC), b = get(L_BUYBACK), d = get(L_DIVIDENDS);
    if (!s && !b && !d) continue;
    const m = (x: { v: number } | null) => x ? Math.round((x.v * scale) / 1e4) / 100 : null;
    const lbl: Record<string, string> = {};
    if (s) lbl.sbc = s.label;
    if (b) lbl.buyback = b.label;
    if (d) lbl.dividends = d.label;
    return { sbc: m(s), buyback: m(b), dividends: m(d), labels: lbl };
  }
  return null;
}
