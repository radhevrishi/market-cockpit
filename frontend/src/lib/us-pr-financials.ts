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
// diluted-EPS line, and reads the first numeric columns. Units (thousands,
// millions, billions) are inferred from whichever scale makes the prior-year
// column match — no header parsing, no per-company rules.
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

interface Row { label: string; rest: string; cells: string[]; }
interface Table { rows: Row[]; }

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
    while ((rm = rRe.exec(tm[1])) && rguard++ < 400) {
      const cells: string[] = [];
      const cRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cRe.exec(rm[1]))) cells.push(cellText(cm[1]));
      if (!cells.length) continue;
      // Label = first cell that has letters. Everything after it is the numeric zone.
      let li = -1;
      for (let i = 0; i < cells.length; i++) if (/[A-Za-z]/.test(cells[i])) { li = i; break; }
      const label = li >= 0 ? cells[li] : '';
      const rest = (li >= 0 ? cells.slice(li + 1) : cells).join(' ');
      rows.push({ label, rest, cells });
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

interface Hit { cur: number; prev: number; scale: number; label: string; tableIdx: number; }

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

/**
 * Extract the current quarter's GAAP revenue / operating income / net income /
 * diluted EPS from a press release, each validated against `yearAgo`.
 */
export function financialsFromReleaseHtml(html: string, yearAgo: YearAgoRef): ReleaseFinancials {
  const out: ReleaseFinancials = { ...EMPTY, matched: [], labels: {} };
  if (!html || html.length > 6_000_000) return out;
  let tables: Table[];
  try { tables = parseTables(html); } catch { return out; }
  if (!tables.length) return out;

  const found: Partial<Record<PrItem, Hit>> = {};
  const better = (a: Hit, b: Hit | undefined) => !b || a.scale < b.scale || (a.scale === b.scale && a.tableIdx < b.tableIdx);

  // Pass 1: revenue, to learn the scale and the anchor table.
  if (yearAgo.revenue != null && yearAgo.revenue > 0) {
    for (let ti = 0; ti < tables.length; ti++) {
      for (const r of tables[ti].rows) {
        const lbl = cleanLabel(r.label);
        if (!lbl || !REVENUE.test(lbl) || EXCLUDE.test(lbl.replace(/^(total\s+)?(net\s+)?(revenues?|sales)/i, ''))) continue;
        if (OUTLOOK_ZONE.test(r.rest)) continue;
        const h = matchRow(tokens(r.rest), yearAgo.revenue, false, null, lbl, ti);
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
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const lbl = cleanLabel(r.label);
      const toks = tokens(r.rest);
      if (!lbl) continue;
      if (!toks.length) { lastHeader = lbl; continue; }        // a section header row
      if (OUTLOOK_ZONE.test(r.rest)) continue;                 // an outlook, not a result

      if (yearAgo.operating_income != null && OP_INCOME.test(lbl) && !EXCLUDE.test(lbl.replace(/operating|income|loss|profit|earnings|from operations|\(loss\)/gi, ''))) {
        const h = matchRow(toks, yearAgo.operating_income, false, preferScale, lbl, ti);
        if (h && (revCur == null || Math.abs(h.cur) < revCur * 3) && better(h, found.operating_income)) found.operating_income = h;
      }
      if (yearAgo.net_income != null && NET_INCOME.test(lbl) && !EXCLUDE.test(lbl.replace(/net|income|loss|profit|earnings|attributable to|\(loss\)|common|stockholders|shareholders|shareowners|parent|company|inc\.?|corporation|corp\.?|ltd\.?|plc|the|holdings|group/gi, ''))) {
        const h = matchRow(toks, yearAgo.net_income, false, preferScale, lbl, ti);
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
          const h = matchRow(toks, yearAgo.eps, true, null, direct ? lbl : `${lastHeader} · ${lbl}`, ti);
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
