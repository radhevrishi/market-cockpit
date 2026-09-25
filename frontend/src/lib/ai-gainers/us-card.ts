// ═══════════════════════════════════════════════════════════════════════════
// US RESEARCH CARD — BUILT FROM THE FILED DOCUMENTS, NO MODEL.        (zzz798)
//
// The owner's verdict on the US board: "so bad, not as good as India". A US
// card said "EVENT FILED · IMPACT UNKNOWN … Guidance: Not stated" on an 8-K
// whose EX-99.1 carried revenue, EPS and a fiscal-2027 outlook, and "Price:
// Not disclosed" on an acquisition whose 8-K stated the cash paid. The India
// card reads "Order ₹153.76 Cr ÷ ₹1,575 Cr market cap = 9.8%". This module
// gives the US card the same shape, from the SEC documents only:
//
//   EARNINGS   revenue / net income / diluted EPS for the quarter vs the same
//              quarter a year earlier (strict XBRL when the period matches,
//              else the EX-99.1 table with its own "in thousands" scaling,
//              else the release's own sentences), margin change, and the
//              outlook as filed (raised / cut / reaffirmed when it says so).
//              A loss is "loss widened / narrowed", never a growth %.
//   M&A        consideration (cash / stock / both, upfront + contingent), the
//              price ÷ the acquirer's market cap, target revenue, funding,
//              stage (proposed / signed / approved / completed). A cash
//              purchase is never called a "merger / share swap".
//   ORDERS     contract value ÷ market cap, duration, customer.
//   OTHER      FDA / trial results, offerings (a gain on an offering is
//              flagged as unusual), buybacks ÷ market cap, guidance raised,
//              index inclusion, activist 13D, short reports, analyst actions
//              (press only).
//
// MATERIALITY uses the India bands (research-view BANDS / earnings rule):
//   order ÷ mcap ≥15% high, ≥5% moderate · deal ÷ mcap ≥20% / ≥5% ·
//   buyback ÷ mcap ≥5% / ≥2% · offering ÷ mcap ≥10% / ≥3% ·
//   earnings: revenue growth ≥25% or profit change ≥50% high, ≥10% / ≥20%
//   moderate. The arithmetic is always shown ("how computed").
//
// NEVER INVENTS A NUMBER: a figure not in a document is "not stated in the
// filing". Pure: no fetch, no clock, no model (us-card-fetch.ts fetches).
// ═══════════════════════════════════════════════════════════════════════════

import type { StrictFigures } from '@/lib/us-thesis/xbrl';

export const US_CARD_VERSION = 1;

export type UsCardKind =
  | 'earnings' | 'acquisition' | 'merger' | 'divestiture' | 'order' | 'fda' | 'clinical' | 'offering' | 'buyback'
  | 'guidance' | 'index' | 'activist' | 'short_report' | 'analyst' | 'facility' | 'other';
export type UsMatLabel = 'SIGNIFICANT' | 'MODERATE' | 'SMALL' | 'UNKNOWN';

export interface UsFigure { cur: number | null; prev: number | null }
export interface UsEarnings {
  period: string | null;
  basis: 'SEC XBRL' | 'EX-99.1 table' | 'release text';
  /** $ millions */
  revenue: UsFigure | null;
  netIncome: UsFigure | null;
  eps: UsFigure | null;
  adjEps: UsFigure | null;
  adjEbitda: UsFigure | null;
  opIncome: UsFigure | null;
  revenueGrowthPct: number | null;
  /** Profit change in words ("up 80.7%", "loss narrowed", "swung to a profit"). */
  profitChange: string | null;
  profitGrowthPct: number | null;
  margin: { name: string; cur: number; prev: number } | null;
  outlook: string[];
  /** "FY2027" / "full-year 2026" — the period the outlook is for. */
  outlookLabel?: string | null;
  guidance: 'RAISED' | 'CUT' | 'REAFFIRMED' | 'NEW' | 'NOT_STATED';
  guidanceNote: string | null;
}
export interface UsDeal {
  role: 'acquirer' | 'seller';
  structure: 'cash' | 'stock' | 'cash_and_stock' | 'unknown';
  label: string;
  target: string | null;
  stage: 'proposed' | 'signed' | 'approved' | 'completed' | null;
  stageText: string | null;
  /** $ millions */
  upfrontM: number | null;
  contingentM: number | null;
  totalValueM: number | null;
  fairValueM: number | null;
  perShare: string | null;
  exchangeRatio: string | null;
  ownershipPct: number | null;
  premiumPct: number | null;
  premiumTo?: string | null;
  targetRevenueM: number | null;
  targetRevenueText: string | null;
  funding: string | null;
  quotes: string[];
}
export interface UsCardSource {
  tier: 'SEC' | 'PRESS' | 'NONE';
  /** "VERIFIED DOCUMENT (SEC 8-K, filed 2026-09-23)" / "PRESS ONLY — no SEC filing found yet". */
  label: string;
  form: string | null;
  date: string | null;
  url: string | null;
  /** Which document the figures came from ("EX-99.1 press release", "8-K body", …). */
  doc: string | null;
}
export interface UsCard {
  v: number;
  kind: UsCardKind;
  kindWord: string;
  /** The research-view EventType this maps to. */
  eventType: string;
  stage: 'PROPOSED' | 'SIGNED' | 'AWARDED' | 'EXECUTED' | 'MONETIZING' | 'RUMOUR' | 'UNKNOWN';
  stageText: string | null;
  headline: string;
  /** WHAT CHANGED, one line with the numbers. */
  whatChanged: string;
  /** Further stated lines (outlook, earn-out, target revenue, funding …). */
  extra: string[];
  material: { label: UsMatLabel; how: string; ratios: Array<{ basis: 'market_cap' | 'ttm_revenue'; pct: number; text: string }> };
  polarity: 'positive' | 'negative' | 'neutral';
  source: UsCardSource;
  whyResearch: string;
  unknowns: string[];
  flags: string[];
  /** True when WHAT CHANGED carries a figure read from an official document. */
  quantified: boolean;
  quote: string | null;
  earnings?: UsEarnings | null;
  deal?: UsDeal | null;
}

// ── small helpers ──────────────────────────────────────────────────────────

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const sq = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** $ millions → "$849.3M" / "$3.325B" / "$450K". */
export function usdM(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'not stated';
  const neg = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1000) return `${neg}$${(a / 1000).toLocaleString('en-US', { maximumFractionDigits: a >= 100_000 ? 1 : 3 })}B`;
  const whole = Math.abs(a - Math.round(a)) < 1e-9;
  if (a >= 100) return `${neg}$${a.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 1, maximumFractionDigits: whole ? 0 : 1 })}M`;
  if (a >= 1) return `${neg}$${a.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 1, maximumFractionDigits: 2 })}M`;
  return `${neg}$${Math.round(a * 1000).toLocaleString('en-US')}K`;
}
const usd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'not stated' : `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`);
const pctTxt = (p: number) => `${p >= 0 ? '+' : ''}${r1(p).toFixed(1)}%`;

/** "$1.2 billion" / "$150 million" / "US$3.5 million" → $ millions. */
export function moneyToM(num: string, scale: string | null | undefined): number | null {
  const x = Number(String(num).replace(/,/g, ''));
  if (!Number.isFinite(x)) return null;
  const s = String(scale || '').toLowerCase();
  if (/^(billion|bn|b)$/.test(s)) return x * 1000;
  if (/^(million|mn|m|mm)$/.test(s)) return x;
  if (/^(thousand|k)$/.test(s)) return x / 1000;
  return null;
}
const MONEY = String.raw`(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|bn|mn|thousand)\b`;

/** Sentences of a text (bullets split). */
export function sentencesOf(t: string): string[] {
  return String(t || '').replace(/^\s*(?:.{0,160}?\bExhibit\s+99\.\d+\s*)+/i, '').replace(/&middot;|·|•|●|▪/g, ' • ').replace(/\s+/g, ' ')
    // no split after an abbreviation ("U.S. Army", "Naveris, Inc., a Delaware …", "Zeta Inc. in the S&P 600")
    .split(/(?<=[.!?])(?<!\b(?:U\.S|U\.K|Inc|Corp|Co|Ltd|No|Nos|Mr|Ms|Mrs|Dr|St|Jr|Sr|vs|etc|approx|Tenn|Calif|Mass|N\.A|S\.A|N\.V|L\.P|p\.m|a\.m)\.)\s+(?=[A-Z"“(•$])|\s•\s/).map((s) => s.replace(/^[•.\s]+/, '').trim()).filter((s) => s.length >= 12);
}

/** India's bands (research-view BANDS) — the same thresholds on the US side. */
export const US_BANDS: Record<'order' | 'acquisition' | 'buyback' | 'offering' | 'generic', { high: number; moderate: number }> = {
  order: { high: 15, moderate: 5 },
  acquisition: { high: 20, moderate: 5 },
  buyback: { high: 5, moderate: 2 },
  offering: { high: 10, moderate: 3 },
  generic: { high: 15, moderate: 5 },
};
export function bandLabel(pct: number, kind: keyof typeof US_BANDS): UsMatLabel {
  const b = US_BANDS[kind];
  return pct >= b.high ? 'SIGNIFICANT' : pct >= b.moderate ? 'MODERATE' : 'SMALL';
}
/** The word the owner reads: HIGH / MODERATE / SMALL / UNKNOWN. */
export const matWord = (l: UsMatLabel) => (l === 'SIGNIFICANT' ? 'HIGH' : l);

function ratioVsMcap(valueM: number, mcapM: number | null, kind: keyof typeof US_BANDS, what: string): { label: UsMatLabel; how: string; ratio: { basis: 'market_cap'; pct: number; text: string } | null } {
  if (!mcapM || !(mcapM > 0)) return { label: 'UNKNOWN', how: `${what} ${usdM(valueM)} stated in the filing; market cap not available, so it cannot be sized.`, ratio: null };
  const p = (valueM / mcapM) * 100;
  const pShow = p < 0.1 ? '<0.1' : String(r1(p));
  const text = `${usdM(valueM)} ÷ ${usdM(mcapM)} market cap = ${pShow}%`;
  const b = US_BANDS[kind];
  const label = bandLabel(p, kind);
  return { label, ratio: { basis: 'market_cap', pct: r1(p), text },
    how: `${what}: ${text}. Bands (same as India): ${b.high}% or more of market cap = HIGH, ${b.moderate}–${b.high}% = MODERATE, below ${b.moderate}% = SMALL.` };
}

// ── HTML tables (EX-99.1 financial tables) ────────────────────────────────

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', middot: '·', bull: '•', reg: '®', trade: '™', minus: '−' };
export function decodeHtmlText(h: string): string {
  return String(h || '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c === 160 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => { const c = parseInt(x, 16); return c === 0xa0 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}

export interface TableRow { label: string; vals: number[]; raw: string }
export interface ParsedTable { header: string; rows: TableRow[]; context: string; text: string }

/** One numeric cell → number (bracketed = negative); null when not a number. */
function cellNum(s: string): number | null {
  const t = s.replace(/[$€£\s]/g, '').replace(/−|–/g, '-');
  if (!t || /^[-—]+$/.test(t)) return null;
  const m = /^(\()?(-)?(\d[\d,]*(?:\.\d+)?|\.\d+)(\))?$/.exec(t);
  if (!m) return null;
  const v = Number(m[3].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  return m[1] || m[2] ? -v : v;
}

/** Every <table> of a document as labelled rows of numbers. Percent cells,
 *  "$" cells and closing brackets are merged or dropped, so a row reads
 *  "Revenue: 849342, 868009, 3318714, 3483684". */
export function parseHtmlTables(html: string, maxTables = 40): ParsedTable[] {
  const out: ParsedTable[] = [];
  const src = String(html || '');
  const re = /<table[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(src)) && out.length < maxTables) {
    const before = decodeHtmlText(src.slice(Math.max(lastEnd, m.index - 4000), m.index)).slice(-700);
    lastEnd = m.index + m[0].length;
    const rows: TableRow[] = [];
    const headerParts: string[] = [];
    for (const tr of m[0].match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(decodeHtmlText).filter((c) => c !== '');
      if (!cells.length) continue;
      // merge "(" "123" ")" and "123" "%" fragments
      const toks: string[] = [];
      for (const c of cells) {
        if (/^\)$/.test(c) && toks.length) { toks[toks.length - 1] += ')'; continue; }
        if (/^%\)?$/.test(c) && toks.length) { toks[toks.length - 1] += c; continue; }
        if (/^\$$|^US\$$/.test(c)) continue;
        toks.push(c);
      }
      const labelParts: string[] = [];
      const vals: number[] = [];
      let seenNum = false;
      for (const tk of toks) {
        if (/%\)?$/.test(tk)) { seenNum = true; continue; }        // a percentage column is not a figure
        // an em-dash cell is "nil" in its column — kept as a gap so the columns stay aligned
        if (/^[-—–]+$/.test(tk) && (seenNum || labelParts.length)) { vals.push(NaN); seenNum = true; continue; }
        const v = cellNum(tk.replace(/\)$/, tk.startsWith('(') ? ')' : ''));
        if (v != null && !(tk.length === 4 && /^(19|20)\d\d$/.test(tk) && !seenNum)) {
          const neg = tk.startsWith('(') || /^\(?-/.test(tk);
          vals.push(neg ? -Math.abs(v) : v); seenNum = true;
        } else if (!seenNum) labelParts.push(tk);
      }
      const label = sq(labelParts.join(' '));
      if (vals.some((v) => Number.isFinite(v))) rows.push({ label, vals, raw: toks.join(' | ') });
      else headerParts.push(toks.join(' '));
    }
    if (rows.length) out.push({ header: sq(headerParts.join(' ')), rows, context: before, text: decodeHtmlText(m[0]) });
  }
  return out;
}

/** The scale a table's figures are printed in, from its own words. */
export function tableScale(t: Pick<ParsedTable, 'header' | 'context' | 'text'>): number | null {
  const PH = /\bin (thousands|millions|billions)\b|\(\s*(thousands|millions)\b|\b(thousands|millions) of (?:u\.?s\.? )?dollars/gi;
  const val = (w: string) => (/thousand/i.test(w) ? 1 / 1000 : /billion/i.test(w) ? 1000 : 1);
  // 1) the table's own heading words ("(In thousands, except per share amounts)")
  const own = Array.from(`${t.header} ${t.text.slice(0, 800)}`.matchAll(PH));
  if (own.length) return val(own[0][0]);
  // 2) the caption just above the table — the closest one wins
  const ctx = Array.from(t.context.slice(-500).matchAll(PH));
  if (ctx.length) return val(ctx[ctx.length - 1][0]);
  // 3) "$000" — never a share count's "(000s)"
  if (/\$\s?000s?\b|\(\$\s?000s?\)/.test(`${t.header} ${t.context.slice(-300)}`)) return 1 / 1000;
  return null;
}

/** Which period the table's first two figure columns are: current then prior? */
const MONTH_RX = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? (\d{1,2}),? ((?:19|20)\d\d)\b|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
/** The dates a table's header names, in column order. */
function headerDates(h: string): number[] {
  const out: number[] = [];
  for (const m of Array.from(h.matchAll(MONTH_RX))) {
    const d = m[1] ? Date.parse(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`) : Date.parse(`${m[6].length === 2 ? `20${m[6]}` : m[6]}-${m[4].padStart(2, '0')}-${m[5].padStart(2, '0')}T00:00:00Z`);
    if (Number.isFinite(d)) out.push(d);
  }
  return out;
}
/** Which figure columns are "this quarter" and "the same quarter a year
 *  earlier": by the header's own dates (BlackBerry prints Aug-26 | May-26 |
 *  Aug-25 — the second column is the prior QUARTER, not the year-ago one). */
export function yoyColumns(t: Pick<ParsedTable, 'header'>): { a: number; b: number } | null {
  const ds = headerDates(t.header);
  if (ds.length >= 2) {
    const target = ds[0] - 365 * 86_400_000;
    const j = ds.findIndex((d, i) => i > 0 && Math.abs(d - target) <= 16 * 86_400_000);
    if (j > 0) return { a: 0, b: j };
    // current column is the older one ("2025 | 2026")
    const back = ds.findIndex((d, i) => i > 0 && Math.abs(d - (ds[0] + 365 * 86_400_000)) <= 16 * 86_400_000);
    if (back > 0) return { a: back, b: 0 };
    return null;
  }
  return null;
}

function columnOrder(t: ParsedTable): { curFirst: boolean; quarterFirst: boolean; periodWord: string } {
  const h = t.header;
  const years = Array.from(h.matchAll(/\b(?:\d{1,2}\/\d{1,2}\/)?((?:19|20)?\d{2})\b(?!\s*%)/g)).map((x) => Number(x[1].length === 2 ? `20${x[1]}` : x[1])).filter((y) => y >= 2000 && y <= 2100);
  const curFirst = years.length >= 2 ? years[0] >= years[1] : true;
  const q = /(three|3|thirteen|13|fourteen|14)[- ]months?|(three|thirteen|fourteen|13|14)[- ]weeks?|\bquarter\b|\bQ[1-4]\b/i.exec(h);
  const longer = /(six|nine|twelve|6|9|12)[- ]months?|(twenty|thirty|fifty|26|39|52|53)[- ]weeks?|\byear ended\b|\bfiscal year\b|\bfull[- ]year\b|year[- ]to[- ]date/i.exec(h);
  const quarterFirst = !!q && (!longer || q.index <= longer.index);
  const periodWord = quarterFirst ? 'quarter' : longer && /six|26/i.test(longer[0]) ? 'six months' : longer && /nine|39/i.test(longer[0]) ? 'nine months' : longer ? 'year' : 'period';
  return { curFirst, quarterFirst, periodWord };
}

const RX_REV = /^(?:total\s+)?(?:net\s+)?(?:revenues?|sales|net sales|total net sales|total revenues?)(?:,?\s*net)?(?:\s*\(\d\))?$/i;
const RX_REV_LOOSE = /^(?:total\s+)?(?:net\s+)?(?:revenues?|net sales|sales)\b(?!.*\b(?:cost|per|growth|deferred|%|margin)\b)/i;
const RX_NI = /^(?:gaap\s+)?net\s+(?:income|loss|income\s*\(loss\)|\(loss\)\s*income|earnings|\(loss\)|loss\s*\(income\))(?:\s+attributable to (?:common|[^|]{0,60}?(?:shareholders|stockholders|inc\.?|corporation|company)))?(?:\s*\(\d\))?$/i;
const RX_EPS_D = /(?:diluted)/i;
const RX_EPS_W = /per\s+(?:diluted\s+)?(?:common\s+)?share|\beps\b|earnings\s*\(loss\)\s*per|(?:income|loss|earnings)\s+per/i;
const RX_ADJ = /\badjusted\b|non-gaap|\bcore\b/i;

function pickRow(rows: TableRow[], test: (r: TableRow, i: number) => boolean): TableRow | null {
  for (let i = 0; i < rows.length; i++) if (rows[i].vals.length >= 2 && test(rows[i], i)) return rows[i];
  return null;
}

export interface TableEarnings { revenue: UsFigure | null; netIncome: UsFigure | null; eps: UsFigure | null; adjEps: UsFigure | null; adjEbitda: UsFigure | null; opIncome: UsFigure | null; periodWord: string; ttmRevenue: UsFigure | null; scale: number; quote: string }

/** The quarter's figures from the release's own financial table. Only a
 *  table that states its scale ("in thousands" / "in millions") — or that a
 *  stated revenue sentence calibrates — is used. */
export function earningsFromTables(tables: ParsedTable[], text: string): TableEarnings | null {
  const statedRev = revenueSentence(text);
  for (const t of tables) {
    // a pro forma combination is not the company's result
    if (/pro forma/i.test(`${t.header} ${t.context.slice(-300)}`)) continue;
    const rev = pickRow(t.rows, (r) => RX_REV.test(r.label)) || pickRow(t.rows, (r) => RX_REV_LOOSE.test(r.label) && !RX_ADJ.test(r.label));
    const ni = pickRow(t.rows, (r) => RX_NI.test(r.label) && !RX_ADJ.test(r.label));
    let eps: TableRow | null = null;
    for (let i = 0; i < t.rows.length && !eps; i++) {
      const r = t.rows[i];
      if (r.vals.length < 2 || RX_ADJ.test(r.label) || Math.abs(r.vals[0]) > 500) continue;
      if (RX_EPS_D.test(r.label) && (RX_EPS_W.test(r.label) || /^diluted$/i.test(r.label))) {
        // A bare "Diluted" row under "Weighted average shares" is a share count, not EPS.
        if (/^diluted$/i.test(r.label) && /weighted|shares outstanding/i.test(t.rows[i - 1]?.label || '')) continue;
        eps = r;
      }
    }
    if (!ni && !eps) continue;
    if (!rev && !ni) continue;
    const ord = columnOrder(t);
    let scale = tableScale(t);
    const yc = yoyColumns(t);
    const a = yc ? yc.a : ord.curFirst ? 0 : 1, b = yc ? yc.b : ord.curFirst ? 1 : 0;
    if (scale == null && statedRev && rev) {
      const k = statedRev.curM / rev.vals[a];
      if (k > 0 && [1, 1e-3, 1e-6].some((c) => Math.abs(k / c - 1) < 0.01)) scale = [1, 1e-3, 1e-6].find((c) => Math.abs(k / c - 1) < 0.01)!;
    }
    if (scale == null) continue;
    const fin = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const fig = (r: TableRow | null, s: number): UsFigure | null => {
      if (!r) return null;
      const c = fin(r.vals[a]), p = fin(r.vals[b]);
      return c == null ? null : { cur: r2(c * s * 1000) / 1000, prev: p == null ? null : r2(p * s * 1000) / 1000 };
    };
    const perShare = (r: TableRow | null): UsFigure | null => (r && fin(r.vals[a]) != null ? { cur: r.vals[a], prev: fin(r.vals[b]) } : null);
    const adjEpsRow = pickRow(t.rows, (r) => RX_ADJ.test(r.label) && RX_EPS_W.test(r.label) && Math.abs(r.vals[0]) < 500);
    const ebitdaRow = pickRow(t.rows, (r) => /^adjusted ebitda\b/i.test(r.label) && !/margin|%/i.test(r.label));
    const opRow = pickRow(t.rows, (r) => /^(?:total\s+)?(?:operating (?:income|loss|income \(loss\)|\(loss\) income)|(?:income|loss|\(loss\) income|income \(loss\)) from operations)$/i.test(r.label));
    // the 12-month columns, when the table's second group is a full year
    const ttm = !rev || !ord.quarterFirst || yc?.b !== 1 || !/twelve|12[- ]months|fifty|52|53[- ]weeks|year ended|fiscal year/i.test(t.header) || rev.vals.length !== 4 ? null
      : { cur: r2(rev.vals[ord.curFirst ? 2 : 3] * scale * 1000) / 1000, prev: r2(rev.vals[ord.curFirst ? 3 : 2] * scale * 1000) / 1000 };
    return {
      revenue: fig(rev, scale), netIncome: fig(ni, scale),
      eps: perShare(eps),
      adjEps: perShare(adjEpsRow),
      adjEbitda: fig(ebitdaRow, scale), opIncome: fig(opRow, scale), periodWord: ord.periodWord, ttmRevenue: ttm, scale,
      quote: clip((rev || ni || eps)!.raw, 200),
    };
  }
  return null;
}

// ── sentence readers (release text) ───────────────────────────────────────

export function revenueSentence(text: string): { curM: number; prevM: number | null; sentence: string } | null {
  for (const s of sentencesOf(text)) {
    if (/\b(?:outlook|guidance|expects?|expected|anticipat|forecast|range of)\b/i.test(s)) continue;
    const m = new RegExp(String.raw`\b(?:total |net |consolidated )*(?:revenues?|net sales|sales)\b[^$.]{0,50}?\b(?:was|were|of|totaled|totalled|reached|increased[^$.]{0,30}?to|decreased[^$.]{0,30}?to|grew[^$.]{0,30}?to|declined[^$.]{0,30}?to)\s+(?:a record\s+)?${MONEY}`, 'i').exec(s);
    if (!m) continue;
    const cur = moneyToM(m[1], m[2]);
    if (cur == null) continue;
    const tail = s.slice(m.index + m[0].length);
    const p = new RegExp(String.raw`(?:compared (?:to|with)|versus|vs\.?|from)\s+(?:revenue of\s+)?${MONEY}`, 'i').exec(tail);
    return { curM: cur, prevM: p ? moneyToM(p[1], p[2]) : null, sentence: clip(s, 300) };
  }
  return null;
}
function netIncomeSentence(text: string): { curM: number; prevM: number | null; sentence: string } | null {
  for (const s of sentencesOf(text)) {
    if (/\b(?:adjusted|non-gaap|outlook|guidance|expects?)\b/i.test(s)) continue;
    const m = new RegExp(String.raw`\b(?:gaap\s+)?net (income|loss)\b[^$.]{0,40}?\b(?:was|of|totaled|totalled|amounted to)\s+${MONEY}`, 'i').exec(s);
    if (!m) continue;
    const v = moneyToM(m[2], m[3]);
    if (v == null) continue;
    const cur = /loss/i.test(m[1]) ? -v : v;
    const tail = s.slice(m.index + m[0].length);
    const p = new RegExp(String.raw`(?:compared (?:to|with)|versus|vs\.?|from)\s+(?:a\s+)?(?:(?:prior[- ]year|year[- ]ago)[^$]{0,30})?(?:(?:gaap\s+)?net (income|loss) of\s+)?${MONEY}`, 'i').exec(tail);
    let prev: number | null = null;
    if (p) { const pv = moneyToM(p[2], p[3]); if (pv != null) prev = (p[1] ? /loss/i.test(p[1]) : cur < 0) ? -pv : pv; }
    return { curM: cur, prevM: prev, sentence: clip(s, 300) };
  }
  return null;
}
function epsSentence(text: string): { cur: number; prev: number | null } | null {
  for (const s of sentencesOf(text)) {
    if (/\b(?:adjusted|non-gaap|outlook|guidance|expects?)\b/i.test(s)) continue;
    const m = /\b(?:gaap\s+)?(?:diluted\s+)?(earnings|net income|net loss|loss|income)\s+per\s+(?:diluted\s+)?(?:common\s+)?share\b[^$.]{0,30}?\b(?:was|were|of)\s+(\(?)\$\s?(\d+\.\d+)(\)?)/i.exec(s)
      || /\b(?:gaap\s+)?(earnings|loss)\s+per\s+diluted\s+share\s+(?:was|were|of)\s+(\(?)\$\s?(\d+\.\d+)(\)?)/i.exec(s);
    if (!m) continue;
    const loss = /loss/i.test(m[1]) || !!m[2];
    const cur = (loss ? -1 : 1) * Number(m[3]);
    const p = /(?:compared (?:to|with)|versus|vs\.?|from)\s+(?:a\s+)?(?:(?:gaap\s+)?(?:diluted\s+)?(?:earnings|loss|net (?:income|loss))\s+per\s+(?:diluted\s+)?share\s+of\s+)?(\(?)\$\s?(\d+\.\d+)(\)?)/i.exec(s.slice(m.index + m[0].length));
    return { cur, prev: p ? ((p[1] || loss) && !/earnings/i.test(p[0]) ? -1 : 1) * Number(p[2]) : null };
  }
  return null;
}

/** The release's period in its own words: "fourth quarter of fiscal 2026 ended July 31, 2026". */
export function releasePeriod(text: string): string | null {
  const t = sq(text).slice(0, 6000);
  const re = /\b((?:first|second|third|fourth) (?:fiscal )?quarter(?: (?:of )?(?:fiscal (?:year )?)?\d{4})?(?:,? ended [A-Z][a-z]+\.? \d{1,2},? \d{4})?|(?:fiscal )?(?:quarter|three months) ended [A-Z][a-z]+\.? \d{1,2},? \d{4}|Q[1-4] (?:fiscal )?(?:20)?\d{2}|(?:first|second) half(?: of)?(?: fiscal)? \d{4}|six months ended [A-Z][a-z]+ \d{1,2},? \d{4})/gi;
  const all = Array.from(t.matchAll(re)).map((m) => m[1].replace(/\s+/g, ' ')).filter((x) => x !== x.toUpperCase());
  const best = all.find((x) => /ended/i.test(x)) || all.find((x) => /\d{4}/.test(x)) || all[0] || null;
  return best;
}
function periodEndIso(period: string | null): string | null {
  const m = period && /([A-Z][a-z]+)\.? (\d{1,2}),? (\d{4})/.exec(period);
  if (!m) return null;
  const d = Date.parse(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`);
  return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null;
}

// ── outlook / guidance ────────────────────────────────────────────────────

const OUTLOOK_METRIC = String.raw`(comparable (?:store )?(?:restaurant |retail )?sales(?: growth)?|same[- ]store sales(?: growth)?|organic (?:revenue |sales )?growth|total revenues?|net revenues?|revenues?|net sales|sales|adjusted ebitda|ebitda|adjusted (?:diluted )?(?:eps|earnings per (?:diluted )?share)|(?:gaap )?(?:diluted )?(?:eps|earnings per (?:diluted )?share)|free cash flow|operating income|operating margin|gross margin|capital expenditures|comparable (?:store )?sales(?: growth)?)`;
const RANGE = String.raw`(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:billion|million)?|\d+(?:\.\d+)?\s*%)\s*(?:to|-|–|and)\s*(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:billion|million)?|\d+(?:\.\d+)?\s*%)`;

export function outlookOf(text: string): { lines: string[]; action: UsEarnings['guidance']; note: string | null; label: string | null } {
  const t = sq(text).replace(/&middot;/g, '·');
  const lines: string[] = [];
  let label: string | null = null;
  const starts = Array.from(t.matchAll(/\b(?:outlook|guidance)\b/gi)).map((m) => Math.max(0, (m.index ?? 0) - 60)).slice(0, 12);
  for (const at of starts) {
    if (lines.length >= 4) break;
    const sec = t.slice(at, at + 1800).split(/\b(?:Conference Call|About [A-Z]|Forward[- ]Looking|Non-GAAP Financial Measures|Use of Non-GAAP)\b/)[0];
    // the period label nearest BEFORE the first stated range ("… outlook for fiscal 2027: · Total revenue of …")
    const firstRange = new RegExp(String.raw`${OUTLOOK_METRIC}[^$%.;]{0,60}?${RANGE}`, 'i').exec(sec);
    // the period the first range belongs to: the first period named after the
    // last "outlook / guidance" word before it (a two-column "Q3 FY27 | FY27"
    // table's first range is the quarter's)
    const win = firstRange ? sec.slice(Math.max(0, firstRange.index - 400), firstRange.index) : '';
    const lastKw = Math.max(win.search(/(?:outlook|guidance)(?![\s\S]*(?:outlook|guidance))/i), 0);
    const labs = Array.from(win.slice(lastKw).matchAll(/\b((?:first|second|third|fourth) (?:fiscal )?quarter(?: of)?(?: fiscal(?: year)?)?(?: \d{4})?|Q[1-4] (?:FY ?)?\d{2,4}|fiscal (?:year )?(\d{4})|full[- ]year (\d{4})|(\d{4}) (?:full[- ]year|annual)|FY ?(\d{2,4}))\b/gi));
    const lab = labs.length ? labs[0] : null;
    if (lab && !label) label = /^fy/i.test(lab[1]) ? lab[1].toUpperCase().replace(/\s/, '') : lab[1].replace(/^full year/i, 'full-year').replace(/^fiscal year/i, 'fiscal');
    const re = new RegExp(String.raw`${OUTLOOK_METRIC}[^$%.;·]{0,60}?(?:of|between|in the range of|to be|at|range)?\s*${RANGE}`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sec)) && lines.length < 4) {
      const metric = m[1].replace(/^total /i, '').replace(/^net /i, '');
      const fix = (x: string) => x.replace(/\s+/g, ' ').replace(/\$ /, '$').trim();
      let a = fix(m[2]), b = fix(m[3]);
      // "$3.325 billion to $3.4 billion" / "$180 million to $200 million" → short money
      const sh = (x: string) => { const mm = /\$(\d[\d,]*(?:\.\d+)?)\s*(billion|million)?/i.exec(x); if (!mm) return x; const v = moneyToM(mm[1], mm[2] || (/billion/i.test(b) ? 'billion' : /million/i.test(b) ? 'million' : null)); return v != null && mm[2] ? usdM(v) : v != null && !mm[2] && /(billion|million)/i.test(b) ? usdM(v) : x; };
      if (/\$/.test(a)) { a = sh(a); b = sh(b); }
      const ln = `${metric.charAt(0).toUpperCase()}${metric.slice(1)} ${a}–${b}`;
      if (!lines.some((x) => x.toLowerCase().startsWith(metric.toLowerCase()))) lines.push(ln);
    }
  }
  let action: UsEarnings['guidance'] = 'NOT_STATED';
  let note: string | null = null;
  const up = /\b(?:rais(?:es|ed|ing)|increas(?:es|ed|ing)|lift(?:s|ed))\b[^.]{0,50}\b(?:guidance|outlook)\b/i.exec(t);
  const down = /\b(?:lower(?:s|ed|ing)|reduc(?:es|ed|ing)|cut(?:s)?|revis(?:es|ed) (?:down|lower))\b[^.]{0,50}\b(?:guidance|outlook)\b/i.exec(t);
  const keep = /\b(?:reaffirm(?:s|ed)?|reiterat(?:es|ed)|maintain(?:s|ed)|confirm(?:s|ed))\b[^.]{0,50}\b(?:guidance|outlook)\b/i.exec(t);
  const notUpd = /\bnot updating\b[^.]{0,40}\bguidance\b|\bno change to (?:its )?(?:guidance|outlook)\b/i.exec(t);
  const said = (re: RegExp, i: number) => clip(sentencesOf(t).find((x) => re.test(x)) || sentenceAround(t, i), 220);
  if (up && !/\b(?:does not|did not|not)\b/i.test(t.slice(Math.max(0, up.index - 20), up.index))) { action = 'RAISED'; note = said(/\b(?:rais(?:es|ed|ing)|increas(?:es|ed|ing)|lift(?:s|ed))\b[^.]{0,50}\b(?:guidance|outlook)\b/i, up.index); }
  else if (down) { action = 'CUT'; note = said(/\b(?:lower(?:s|ed|ing)|reduc(?:es|ed|ing)|cut(?:s)?)\b[^.]{0,50}\b(?:guidance|outlook)\b/i, down.index); }
  else if (keep || notUpd) { action = 'REAFFIRMED'; note = said(/\b(?:reaffirm|reiterat|maintain|confirm|not updating|no change)/i, (keep || notUpd)!.index); }
  else if (lines.length) { action = 'NEW'; note = null; }
  return { lines, action, note, label };
}
function sentenceAround(t: string, i: number): string {
  const s = t.lastIndexOf('. ', i);
  const e = t.indexOf('. ', i);
  return t.slice(s < 0 ? 0 : s + 2, e < 0 ? t.length : e + 1).trim();
}

// ── EARNINGS ──────────────────────────────────────────────────────────────

/** The press release's own title ("Cracker Barrel Reports Fourth Quarter …"),
 *  read from the top of the exhibit: exhibit label, contacts and the dateline
 *  removed; an all-caps title put in sentence case. Null when not found. */
export function releaseTitle(text: string): string | null {
  let t = sq(text).slice(0, 1500);
  t = t.replace(/^(?:.{0,160}?\bExhibit\s+99\.\d+\s*)+/i, '').replace(/\b(?:Investor|Media|Press)(?: Relations)? Contacts?:?[^A-Z]{0,4}(?:[A-Z][a-z]+ ){1,3}(?:\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}|\S+@\S+)\s*/g, '').trim();
  const words = t.split(' ');
  const isCaps = (w: string) => /[A-Z]/.test(w) && w === w.toUpperCase();
  let out: string[] = [];
  if (words.length > 3 && words.slice(0, 3).every(isCaps)) {
    // an ALL-CAPS title: the caps run, in sentence case
    for (const w of words) { if (!isCaps(w) && /[a-z]/.test(w)) break; out.push(w); }
    const SM = /^(?:of|and|the|with|into|for|to|its|from|in|on|at|by|a|an|as|or)$/i;
    const tc = out.map((w, i) => (i > 0 && SM.test(w) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
    return out.length >= 3 ? clip(tc, 170) : null;
  }
  const SMALL = /^(?:of|and|the|with|into|for|to|its|from|in|on|at|by|a|an|as|&|or|vs\.?)$/;
  for (let i = 0; i < words.length && i < 40; i++) {
    const w = words[i];
    if (/^[a-z]/.test(w) && !SMALL.test(w)) { if (out.length && /^[A-Z]/.test(out[out.length - 1])) out.pop(); break; }
    if (/^[A-Z][a-z]+\.?$/.test(w) && /^\d{1,2},$/.test(words[i + 1] || '')) break;          // a dateline ("September 14, 2026")
    out.push(w);
  }
  const title = out.join(' ').replace(/[,;:–—-]+$/, '').trim();
  return title.length >= 20 ? clip(title, 170) : null;
}

const growth = (f: UsFigure | null) => (f && f.cur != null && f.prev != null && f.prev > 0 ? r1(((f.cur / f.prev) - 1) * 100) : null);

/** "up 80.7%" / "loss narrowed from $X to $Y" / "swung to a profit" — never a growth % on a loss. */
export function profitWords(f: UsFigure | null): { words: string | null; pct: number | null } {
  if (!f || f.cur == null || f.prev == null) return { words: null, pct: null };
  const { cur, prev } = f;
  if (cur >= 0 && prev > 0) { const p = r1(((cur / prev) - 1) * 100); return { words: p >= 900 ? `up about ${r1(cur / prev)}× (from a small base)` : `${p >= 0 ? 'up' : 'down'} ${Math.abs(p).toFixed(1)}%`, pct: p }; }
  if (cur >= 0 && prev <= 0) return { words: prev === 0 ? 'from zero' : 'swung to a profit from a loss', pct: null };
  if (cur < 0 && prev > 0) return { words: 'swung to a loss from a profit', pct: null };
  // both losses
  const a = Math.abs(cur), b = Math.abs(prev);
  if (Math.abs(a - b) < 1e-9) return { words: 'loss unchanged', pct: null };
  return { words: a < b ? `loss narrowed by ${r1((1 - a / b) * 100).toFixed(1)}%` : a / b >= 10 ? `loss widened about ${Math.round(a / b)}× (from a small base)` : `loss widened by ${r1((a / b - 1) * 100).toFixed(1)}%`, pct: null };
}

export function readUsEarnings(o: { text: string; html?: string | null; xbrl?: StrictFigures | null; filedDate?: string | null; form?: string | null }): UsEarnings | null {
  const period = releasePeriod(o.text);
  const pEnd = periodEndIso(period);
  let e: Omit<UsEarnings, 'revenueGrowthPct' | 'profitChange' | 'profitGrowthPct' | 'margin' | 'outlook' | 'guidance' | 'guidanceNote'> | null = null;
  let ttm: UsFigure | null = null;
  // 1) strict XBRL — only when it describes THIS period (a 10-Q / 10-K, or a
  //    release whose quarter the XBRL already carries).
  const x = o.xbrl;
  if (x && x.basis && x.q_end && x.currency === 'USD') {
    const dd = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
    const samePeriod = pEnd ? dd(x.q_end, pEnd) <= 10 : !!(o.filedDate && x.q_filed && dd(x.q_filed, o.filedDate) <= 5 && /^10-[QK]/.test(String(o.form || '')));
    if (samePeriod && (x.revenue.cur != null || x.net_income.cur != null)) {
      const m = (f: { cur: number | null; prev: number | null }) => (f.cur == null ? null : { cur: f.cur / 1e6, prev: f.prev == null ? null : f.prev / 1e6 });
      e = { period: x.period_label || period, basis: 'SEC XBRL', revenue: m(x.revenue), netIncome: m(x.net_income), eps: x.eps.cur == null ? null : { cur: x.eps.cur, prev: x.eps.prev },
        adjEps: null, adjEbitda: null, opIncome: m(x.operating_income) };
    }
  }
  // 2) the EX-99.1 table, with its own scaling
  if (!e && o.html) {
    const te = earningsFromTables(parseHtmlTables(o.html), o.text);
    if (te && (te.revenue || te.netIncome)) {
      e = { period: period || (te.periodWord === 'quarter' ? 'the quarter' : `the ${te.periodWord}`), basis: 'EX-99.1 table', revenue: te.revenue, netIncome: te.netIncome, eps: te.eps, adjEps: te.adjEps, adjEbitda: te.adjEbitda, opIncome: te.opIncome };
      ttm = te.ttmRevenue;
    }
  }
  // 3) the release's own sentences
  if (!e) {
    const rv = revenueSentence(o.text), ni = netIncomeSentence(o.text), ep = epsSentence(o.text);
    if (rv || ni) e = { period, basis: 'release text', revenue: rv ? { cur: rv.curM, prev: rv.prevM } : null, netIncome: ni ? { cur: ni.curM, prev: ni.prevM } : null, eps: ep ? { cur: ep.cur, prev: ep.prev } : null, adjEps: null, adjEbitda: null, opIncome: null };
  }
  const ol = outlookOf(o.text);
  if (!e && !ol.lines.length) return null;
  const base = e || { period, basis: 'release text' as const, revenue: null, netIncome: null, eps: null, adjEps: null, adjEbitda: null, opIncome: null };
  const pw = profitWords(base.netIncome);
  const margin = (() => {
    const rv = base.revenue;
    if (!rv || rv.cur == null || rv.prev == null || !(rv.cur > 0) || !(rv.prev > 0)) return null;
    if (base.opIncome && base.opIncome.cur != null && base.opIncome.prev != null) return { name: 'Operating margin', cur: r1((base.opIncome.cur / rv.cur) * 100), prev: r1((base.opIncome.prev / rv.prev) * 100) };
    if (base.adjEbitda && base.adjEbitda.cur != null && base.adjEbitda.prev != null) return { name: 'Adjusted EBITDA margin (company measure)', cur: r1((base.adjEbitda.cur / rv.cur) * 100), prev: r1((base.adjEbitda.prev / rv.prev) * 100) };
    return null;
  })();
  const outlook = ol.lines.map((l) => (/^[A-Z][a-z]/.test(l) ? `${l.charAt(0).toLowerCase()}${l.slice(1)}` : l));
  const outlookLabel = ol.label ? ol.label.replace(/^fiscal (\d{4})$/i, 'FY$1') : null;
  // implied growth of a revenue outlook against the release's own twelve-month revenue
  if (ttm && ttm.cur && outlook.length) {
    const revLine = outlook.find((l) => /^revenues?|^sales|^net sales/i.test(l));
    const mm = revLine && /\$([\d.,]+)([MB])–\$([\d.,]+)([MB])/.exec(revLine);
    if (mm) {
      const lo = Number(mm[1].replace(/,/g, '')) * (mm[2] === 'B' ? 1000 : 1), hi = Number(mm[3].replace(/,/g, '')) * (mm[4] === 'B' ? 1000 : 1);
      const i = outlook.findIndex((l) => l.includes(revLine!));
      if (i >= 0 && lo > 0 && hi > 0) outlook[i] += ` (${pctTxt((lo / ttm.cur - 1) * 100)} to ${pctTxt((hi / ttm.cur - 1) * 100)} vs the last twelve months' ${usdM(ttm.cur)})`;
    }
  }
  return { ...base, revenueGrowthPct: growth(base.revenue), profitChange: pw.words, profitGrowthPct: pw.pct, margin, outlook, outlookLabel, guidance: ol.action, guidanceNote: ol.note };
}

/** India's earnings rule on the US figures. */
export function earningsMaterial(e: UsEarnings): { label: UsMatLabel; how: string } {
  const rv = e.revenueGrowthPct, pt = e.profitGrowthPct;
  const lossTurn = /swung/.test(e.profitChange || '');
  const lossNarrow = /loss narrowed by ([\d.]+)%/.exec(e.profitChange || '');
  const lossWide = /loss widened by ([\d.]+)%/.exec(e.profitChange || '') || (/loss widened about/.test(e.profitChange || '') ? ['', '100'] as unknown as RegExpExecArray : null);
  if (rv == null && pt == null && !lossTurn && !lossNarrow && !lossWide) return { label: 'UNKNOWN', how: 'Revenue and profit for the same quarter a year earlier are not stated in the documents read — the change cannot be sized.' };
  const profitMag = pt != null ? Math.abs(pt) : lossTurn ? 100 : lossNarrow ? Number(lossNarrow[1]) : lossWide ? Number(lossWide[1]) : 0;
  const revMag = Math.abs(rv ?? 0);
  const label: UsMatLabel = revMag >= 25 || profitMag >= 50 ? 'SIGNIFICANT' : revMag >= 10 || profitMag >= 20 ? 'MODERATE' : 'SMALL';
  const parts = [rv != null ? `revenue ${pctTxt(rv)} vs a year ago` : 'revenue change not stated', e.profitChange ? `net income ${e.profitChange}` : 'profit change not stated'];
  return { label, how: `${parts.join('; ')}. Bands (same as India): revenue growth 25%+ or profit change 50%+ = HIGH; 10%+ / 20%+ = MODERATE; below = SMALL.` };
}

function earningsLine(e: UsEarnings): string {
  const bits: string[] = [];
  if (e.revenue?.cur != null) bits.push(`Revenue ${usdM(e.revenue.cur)}${e.revenue.prev != null ? ` vs ${usdM(e.revenue.prev)} a year ago (${pctTxt(e.revenueGrowthPct!)})` : ' (year-ago figure not stated)'}`);
  if (e.netIncome?.cur != null) {
    const loss = e.netIncome.cur < 0;
    bits.push(`${loss ? 'Net loss' : 'Net income'} ${usdM(Math.abs(e.netIncome.cur))}${e.netIncome.prev != null ? ` vs ${e.netIncome.prev < 0 ? 'a loss of ' : ''}${usdM(Math.abs(e.netIncome.prev))}${e.profitChange ? ` (${e.profitChange})` : ''}` : ''}`);
  }
  if (e.eps?.cur != null) bits.push(`Diluted EPS ${usd(e.eps.cur)}${e.eps.prev != null ? ` vs ${usd(e.eps.prev)}` : ''}${e.adjEps?.cur != null ? ` (adjusted ${usd(e.adjEps.cur)}${e.adjEps.prev != null ? ` vs ${usd(e.adjEps.prev)}` : ''})` : ''}`);
  if (e.margin) bits.push(`${e.margin.name.replace(/ \(company measure\)/, '')} ${e.margin.cur}% vs ${e.margin.prev}% (${e.margin.cur - e.margin.prev >= 0 ? '+' : ''}${r1(e.margin.cur - e.margin.prev)} pts)`);
  if (e.outlook.length) bits.push(`${e.outlookLabel ? `${e.outlookLabel} ` : ''}outlook: ${e.outlook[0].replace(/ \(.*\)$/, '')}`);
  return bits.join(' · ');
}

// ── M&A ───────────────────────────────────────────────────────────────────

const NAME = String.raw`((?:[A-Z][\w&'’.-]*)(?:\s+(?:[A-Z][\w&'’.-]*|of|and|&|de|la)){0,5})`;
const STOP_NAME = /^(the|a|an|all|its|our|this|certain|substantially)$/i;
export function targetOf(text: string, issuerName?: string | null): string | null {
  const t = sq(text).slice(0, 20000);
  const res = [
    new RegExp(String.raw`\b(?:completion of (?:the |its )?(?:previously announced )?acquisition of|completed (?:the |its )?(?:previously announced )?acquisition of|[Aa]cquisition of|to acquire|[Aa]cquires|[Aa]cquired|will acquire|[Mm]erger with|[Cc]ombination with|acquire all (?:of )?the (?:issued|outstanding) (?:shares|share capital)(?: and listed options)? of)\s+(?:all (?:of )?the (?:issued |outstanding )?(?:shares|share capital|equity interests?)(?: and listed options)? of\s+)?${NAME}`, 'g'),
  ];
  for (const re of res) {
    for (const m of Array.from(t.matchAll(re))) {
      let n = m[1].split(/\.\s+(?=[A-Z])/)[0].replace(/[.,]+$/, '').replace(/\s+(?:Ltd|Limited|Inc|Corp|Corporation|LLC|plc)\.?$/i, (x) => x).trim();
      n = n.replace(/\s+(?:and|of|&)$/i, '').trim();
      const first = n.split(/\s+/)[0];
      if (!n || STOP_NAME.test(first) || /^(Assets|Merger|Shares|Company|Registrant|Item|Section|Agreement)\b/.test(n)) continue;
      if (issuerName && n.toLowerCase().startsWith(issuerName.toLowerCase().split(/\s+/)[0])) continue;
      return n.replace(/,?\s+(?:a|an) (?:Delaware|Nevada|Australian|British)[\s\S]*$/, '').slice(0, 60);
    }
  }
  return null;
}

/** Deal terms from the documents of one filing (+ the original 8-K an 8-K/A amends). */
export function readUsDeal(docs: Array<{ role: string; text: string }>, o: { issuerName?: string | null; items?: string[]; form?: string | null; headline?: string | null } = {}): UsDeal | null {
  const ORDER: Record<string, number> = { primary: 0, ex99: 1, release: 1, original: 2, ex992: 3 };
  docs = [...docs].sort((a, b) => (ORDER[a.role] ?? 5) - (ORDER[b.role] ?? 5));
  const all = docs.map((d) => d.text).join(' \n ');
  if (!all.trim()) return null;
  // Stage and dates come from the filing itself (and the 8-K it amends) — a
  // scheme booklet or pro forma exhibit is full of other dates.
  const main = docs.filter((d) => (ORDER[d.role] ?? 5) <= 3).map((d) => d.text).join(' \n ') || all;
  const lead = docs.filter((d) => d.role === 'ex99' || d.role === 'release').map((d) => sentencesOf(d.text.slice(0, 4000)).slice(0, 4).join(' ')).join(' ');
  const target = targetOf(`${lead} ${o.headline || ''} ${main} ${all}`, o.issuerName);
  const sents = docs.flatMap((d) => sentencesOf(d.text).map((s) => ({ s, role: d.role })));
  const tWord = target ? target.split(/\s+/)[0].replace(/[^\w]/g, '') : null;
  // Sentences about THIS deal: those naming the target, and the two after one.
  const near = new Set<number>();
  sents.forEach((x, i) => { if (tWord && new RegExp(`\\b${tWord}\\b`, 'i').test(x.s)) { near.add(i); near.add(i + 1); near.add(i + 2); } });
  const ours = (i: number) => !tWord || near.has(i);
  const quotes: string[] = [];
  let upfront: number | null = null, contingent: number | null = null, totalValue: number | null = null, fairValue: number | null = null;
  let perShare: string | null = null, ratio: string | null = null, ownership: number | null = null, premium: number | null = null;
  let targetRev: number | null = null, targetRevText: string | null = null, funding: string | null = null;
  let cash = false, stock = false, seller = false;
  let premiumTo: string | null = null;
  sents.forEach((x, i) => {
    const s = x.s;
    if (/\b(?:forward-looking|risks? and uncertainties|could cause)\b/i.test(s)) return;
    const mine = ours(i);
    if (mine && /\b(?:received by the Company|proceeds (?:to|received by) the Company|sale of (?:the )?(?:shares of )?[A-Z][\w ]{0,40}(?:subsidiary|business))\b/i.test(s) && !/\bacqui/i.test(s)) seller = true;
    if (/\b(?:received by the Company|purchase price received)\b/i.test(s)) return;           // the other side of a two-deal 8-K
    const cc = new RegExp(String.raw`\b(?:aggregate |upfront |total |base )?(?:cash consideration|purchase price|consideration|merger consideration)[^$.]{0,60}?(?:of|was|is|consisted of|paid by the Company (?:consisted of|was))\s+(?:approximately\s+)?${MONEY}`, 'i').exec(s)
      || new RegExp(String.raw`\b(?:paid|pay|paying)\b[^$.]{0,80}?(?:aggregate )?(?:cash consideration of\s+)?(?:approximately\s+)?${MONEY}\s+in cash`, 'i').exec(s)
      || new RegExp(String.raw`${MONEY}\s+in (?:upfront )?cash(?: consideration)?\b`, 'i').exec(s)
      || new RegExp(String.raw`\bincludes\s+${MONEY}\s+in upfront cash`, 'i').exec(s);
    if (cc && mine && !/\bup to\b[^$]{0,20}\$/.test(s.slice(Math.max(0, cc.index - 5), cc.index + 30)) && !/\b(?:fair value|preliminary)\b/i.test(s)) {
      const v = moneyToM(cc[1], cc[2]);
      if (v != null && upfront == null) { upfront = v; quotes.push(clip(s, 280)); }
      if (/\bcash\b/i.test(s)) cash = true;
    }
    const ct = new RegExp(String.raw`\bup to (?:an aggregate of\s+)?(?:approximately\s+)?${MONEY}\s+(?:in |of )?(?:additional |contingent |potential )?(?:cash )?(?:consideration|milestone|earn-?out|payments?)`, 'i').exec(s)
      || new RegExp(String.raw`\b(?:earn-?out|milestone payments?|contingent consideration)[^$.]{0,40}?up to\s+${MONEY}`, 'i').exec(s);
    if (ct && mine && contingent == null) { contingent = moneyToM(ct[1], ct[2]); quotes.push(clip(s, 280)); }
    const tv = new RegExp(String.raw`\b(?:transaction|deal|acquisition|merger)\s+(?:is\s+)?valued at\s+(?:approximately\s+)?${MONEY}|\b(?:enterprise|equity|transaction) value of\s+(?:approximately\s+)?${MONEY}`, 'i').exec(s);
    if (tv && mine && totalValue == null) { totalValue = moneyToM(tv[1] || tv[3], tv[2] || tv[4]); quotes.push(clip(s, 280)); }
    const fv = new RegExp(String.raw`\bfair value of the (?:purchase price |total )?consideration[^$.]{0,30}?(?:was|is|of)\s+(?:approximately\s+)?${MONEY}`, 'i').exec(s);
    if (fv && fairValue == null) fairValue = moneyToM(fv[1], fv[2]);
    const ps = /\$\s?(\d+(?:\.\d+)?)\s+per share(?: in cash)?/i.exec(s);
    if (ps && mine && perShare == null && (ORDER[x.role] ?? 5) <= 3 && /\b(?:receive|merger consideration|offer price)\b/i.test(s) && /in cash|merger consideration|offer price/i.test(s)) { perShare = `$${ps[1]} per share${/in cash/i.test(ps[0]) ? ' in cash' : ''}`; if (/in cash/i.test(ps[0])) cash = true; quotes.push(clip(s, 280)); }
    const er = /\b(?:receive|entitled to receive)\s+(between\s+[\d.]+\s+and\s+[\d.]+|[\d.]+)\s+(?:new\s+)?(?:(?:[A-Z]{2,6}\s+)?(?:ordinary\s+|common\s+)?shares?|shares? of [A-Z][\w ]{0,40}?common stock)[^.]{0,40}?\bfor (?:each|every)\s+([^.,;]{0,40}?(?:share|option))/i.exec(s);
    if (er && ratio == null) { ratio = `${er[1]} new shares for each ${er[2]}`.replace(/\s+/g, ' '); stock = true; quotes.push(clip(s, 280)); }
    if (/\b(?:satisfied by the issue of new (?:ordinary )?shares|all[- ]stock|stock[- ]for[- ]stock|share[- ]for[- ]share|exchange ratio|in exchange for (?:shares|newly issued shares)|shares of (?:the Company's|our) common stock as consideration)\b/i.test(s) && mine) stock = true;
    const ow = /\b(?:will|would) own (?:approximately |about )?(\d+(?:\.\d+)?)%\s+of the (?:combined|enlarged|merged)/i.exec(s);
    if (ow && ownership == null) { ownership = Number(ow[1]); quotes.push(clip(s, 280)); }
    const trv = new RegExp(String.raw`\b(?:generated|reported|had|delivered|recorded)\s+(?:approximately |about |nearly )?${MONEY}\s+(?:in|of)\s+(?:revenue|sales|net sales)`, 'i').exec(s)
      || new RegExp(String.raw`\b(?:revenue|sales) of (?:approximately |about )?${MONEY}\s+(?:in|for) (?:fiscal )?(?:20\d\d|the (?:twelve|12) months)`, 'i').exec(s);
    if (trv && mine && targetRev == null && tWord && new RegExp(`\\b${tWord}\\b`, 'i').test(sents.slice(Math.max(0, i - 1), i + 1).map((y) => y.s).join(' '))) { targetRev = moneyToM(trv[1], trv[2]); targetRevText = clip(s, 200); }
    const fd = /\b(?:funded|financed|paid for)\s+(?:with|through|by|from|using)\s+([^.;]{5,120})/i.exec(s);
    if (fd && mine && funding == null && !/\bR&D|research\b/i.test(fd[1])) funding = fd[1].replace(/\s+/g, ' ').trim();
    if (funding == null && mine && /\bcash on hand\b/i.test(s) && /\b(?:consideration|purchase|acqui)/i.test(s)) funding = 'cash on hand';
  });
  // premium: read from the whole text — a booklet lists it as bullets ("premium of approximately: ● 67.3% to …")
  const prm = /\bpremium of\s*(?:approximately|about)?\s*:?\s*[●•·]?\s*(\d+(?:\.\d+)?)\s?%\s*(to [^;●•·]{5,200})?/i.exec(all);
  if (prm) {
    premium = Number(prm[1]);
    const to = prm[2] ? prm[2].trim().replace(/\s+prior to\b[\s\S]*$/i, '').replace(/[;,.]$/, '') : null;
    premiumTo = to && to.length > 110 ? `${to.slice(0, 110).replace(/\s+\S*$/, '')}…` : to;
  }
  const items = new Set(o.items || []);
  const completed = items.has('2.01') || /\b(?:completed (?:the |its )?(?:previously announced )?acquisition|completion of (?:the |its )?(?:previously announced )?acquisition|consummated the|closed the (?:acquisition|transaction|merger)|today announced (?:its|the) acquisition of)\b/i.test(main);
  const approved = /\b(?:shareholders|stockholders|securityholders) (?:have )?(?:approved|voted in favou?r)\b|\bcourt approv(?:ed|al) (?:of )?the scheme\b/i.test(main);
  const signed = items.has('1.01') || /\b(?:entered into (?:a |an )?(?:definitive |binding )?(?:agreement and plan of merger|merger agreement|scheme implementation (?:deed|agreement)|purchase agreement|share purchase agreement)|binding scheme implementation deed)\b/i.test(main);
  const proposed = /\bproposed (?:acquisition|merger|transaction|combination)\b|\bnon-binding\b|\bletter of intent\b|\bscheme meetings?\b/i.test(main);
  const stage: UsDeal['stage'] = completed ? 'completed' : approved ? 'approved' : proposed && !signed ? 'proposed' : signed ? 'signed' : proposed ? 'proposed' : null;
  let stageText: string | null = null;
  if (stage === 'completed') {
    // the date of the sentence that says "completed … acquisition" (the last "On <date>," before it)
    const at = main.search(/\bcompleted (?:the |its )?(?:previously announced )?acquisition\b/);
    const before = at >= 0 ? main.slice(Math.max(0, at - 300), at) : '';
    const ds = Array.from(before.matchAll(/\bOn\s+([A-Z][a-z]+ \d{1,2}, \d{4}),/g));
    stageText = `completed${ds.length ? ` ${ds[ds.length - 1][1]}` : ''}`;
  }
  else {
    const meet = /\b(?:Scheme Meetings?|special meeting|shareholder meeting|general meeting)[^.]{0,80}?\b(?:scheduled to be held|to be held|will be held)\s+on\s+(?:[A-Z][a-z]+,\s+)?([A-Z][a-z]+ \d{1,2}, \d{4})/i.exec(main);
    const close = /\bexpected to (?:close|be (?:completed|implemented))\s+(?:in|by|during)\s+(?:the\s+)?([A-Z][a-z]+(?: \d{4})?|(?:first|second|third|fourth) quarter of \d{4}|\d{4})/i.exec(main);
    stageText = [stage === 'signed' ? 'signed, not yet completed' : stage === 'approved' ? 'approved by holders, not yet completed' : stage === 'proposed' ? 'proposed — holders have not voted yet' : null,
      meet ? `holder vote ${meet[1]}` : null, close ? `expected to complete ${close[1]}` : null].filter(Boolean).join(' · ') || null;
  }
  if (upfront == null && totalValue == null && contingent == null && !ratio && !perShare && ownership == null && !target) return null;
  if (cash && !stock && /\bshares? of (?:the Company's|our|its) common stock\b[^.]{0,60}\b(?:issued|consideration)\b/i.test(all)) stock = true;
  const structure: UsDeal['structure'] = cash && stock ? 'cash_and_stock' : stock ? 'stock' : cash || upfront != null ? 'cash' : 'unknown';
  const role: UsDeal['role'] = seller && upfront == null ? 'seller' : 'acquirer';
  const label = role === 'seller' ? 'Sale of a business (cash received)'
    : structure === 'cash' ? 'Cash acquisition' : structure === 'stock' ? 'Share-swap merger (paid in new shares)' : structure === 'cash_and_stock' ? 'Cash-and-stock acquisition' : 'Acquisition (payment form not stated)';
  return { role, structure, label, target, stage, stageText, upfrontM: upfront, contingentM: contingent, totalValueM: totalValue, fairValueM: fairValue, perShare, exchangeRatio: ratio, ownershipPct: ownership, premiumPct: premium, premiumTo, targetRevenueM: targetRev, targetRevenueText: targetRevText, funding, quotes: quotes.slice(0, 4) };
}

// ── orders / contracts ────────────────────────────────────────────────────

export interface UsOrder { valueM: number | null; customer: string | null; duration: string | null; quote: string | null; hedged: boolean }
export function readUsOrder(text: string): UsOrder | null {
  for (const s of sentencesOf(text).slice(0, 80)) {
    if (/\b(?:forward-looking|risk factors)\b/i.test(s)) continue;
    const m = new RegExp(String.raw`\b(?:award(?:ed)?|contract|order|agreement|purchase order|task order|subcontract)\b[^.]{0,80}?(?:valued at|worth|with (?:a |an )?(?:total |aggregate )?(?:contract )?value of|totaling|of)\s+(?:up to\s+)?(?:approximately\s+)?${MONEY}`, 'i').exec(s)
      || new RegExp(String.raw`\b(?:a|an)\s+${MONEY}\s+(?:multi-year\s+|firm\s+|follow-on\s+)?(?:contract|order|award|agreement|task order)`, 'i').exec(s)
      || new RegExp(String.raw`\bawarded (?:a |an )?(?:[a-z-]+ ){0,3}${MONEY}`, 'i').exec(s);
    if (!m) continue;
    const valueM = moneyToM(m[1], m[2]);
    if (valueM == null) continue;
    const hedged = /\bup to\b|\bpotential(?:ly)?\b|\bceiling\b|\bif all options\b|\bestimated\b/i.test(s);
    const cust = /\b(?:from|by|with)\s+(?:the\s+)?((?:U\.S\.\s+)?(?:[A-Z][\w&'.-]*)(?:\s+(?:[A-Z][\w&'.-]*|of|and|&|for)){0,6})/.exec(s);
    const dur = /\b(?:over|for|spanning|period of|term of)\s+(?:a\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[- ](?:year|month)s?\b/i.exec(s) || /\bthrough (?:fiscal )?(20\d\d)\b/i.exec(s);
    return { valueM, customer: cust ? cust[1].replace(/\s+(?:for|and|of)$/i, '') : null, duration: dur ? dur[0].replace(/^(?:over|for|spanning|period of|term of)\s+/i, '') : null, quote: clip(s, 280), hedged };
  }
  return null;
}

// ── other US event types ──────────────────────────────────────────────────

export interface UsOtherRead { kind: UsCardKind; word: string; valueM: number | null; line: string; quote: string | null; polarity: UsCard['polarity']; flags: string[] }
export function readUsOther(text: string, o: { form?: string | null; items?: string[] } = {}): UsOtherRead | null {
  const ss = sentencesOf(text).slice(0, 220).filter((s) => !/\b(?:forward-looking|safe harbor|risk factors|could cause actual)\b/i.test(s));
  // what the release LEADS with — a designation or a trial named in the
  // "About the company" background is not this filing's event (ARCT)
  const lead = ss.slice(0, 14);
  const findIn = (xs: string[], re: RegExp) => xs.find((s) => re.test(s)) || null;
  const find = (re: RegExp) => findIn(ss, re);
  const form = String(o.form || '').toUpperCase();
  const agency = (s: string) => (/\b(?:FDA|Food and Drug Administration)\b/.test(s) ? 'FDA' : /\b(?:EMA|European Medicines Agency)\b/.test(s) ? 'EMA' : /\bMHRA\b/.test(s) ? 'MHRA' : 'Regulator');
  // FDA / regulator
  const fda = findIn(lead, /\b(?:FDA|Food and Drug Administration|EMA|European Medicines Agency)\b[^.]{0,120}\b(?:approv(?:ed|al)|clear(?:ed|ance)|grant(?:ed|s)?|accept(?:ed|s)?|designation)\b|\b(?:approval|clearance) (?:from|by) the (?:U\.S\. )?(?:FDA|Food and Drug Administration)\b|\bcomplete response letter\b|\bPDUFA\b/i);
  if (fda) {
    const neg = /\bcomplete response letter\b|\bCRL\b|\brefus(?:e|al) to file\b/i.test(fda);
    const ag = agency(fda);
    const word = neg ? `${ag} setback (complete response letter)` : /designation/i.test(fda) ? `${ag} designation` : /PDUFA|accept/i.test(fda) ? `${ag} filing accepted` : `${ag} approval / clearance`;
    return { kind: 'fda', word, valueM: null, line: clip(fda, 240), quote: fda, polarity: neg ? 'negative' : 'positive', flags: [] };
  }
  const trial = findIn(lead, /\b(?:met|achieved|did not meet|failed to meet|missed)\b[^.]{0,40}\bprimary endpoint\b|\btopline (?:results|data)\b|\bstatistically significant\b|\bp\s?[<=]\s?0?\.\d+/i);
  if (trial) {
    const neg = /\bdid not meet|failed to meet|missed|not statistically significant\b/i.test(trial);
    const p = /\bp\s?([<=])\s?(0?\.\d+)/i.exec(trial);
    return { kind: 'clinical', word: neg ? 'Trial missed its goal' : 'Trial result', valueM: null, line: `${clip(trial, 220)}${p ? ` (p${p[1]}${p[2]})` : ''}`, quote: trial, polarity: neg ? 'negative' : 'positive', flags: [] };
  }
  // offering — the event sentence, then the amount wherever the filing states it
  const off = find(/\b(?:pricing of|priced|announces?|entered into|closing of|closed)\b[^.]{0,80}\b(?:underwritten |registered direct |public |private |secondary )?(?:offering|placement|PIPE)\b/i)
    || (/^(424B[1-8]|S-1|F-1)$/.test(form) ? find(/\boffering\b[^.]{0,120}\$\s?\d/i) : null);
  if (off && !/\bnotes due|senior notes|convertible notes\b/i.test(off)) {
    let v: number | null = null;
    for (const s of ss) {
      const gp = new RegExp(String.raw`\b(?:aggregate )?(?:gross proceeds|aggregate (?:gross )?proceeds)\b[^$.]{0,40}?(?:of|to be|are expected to be|were|was|approximately)\s+(?:approximately\s+)?${MONEY}`, 'i').exec(s)
        || new RegExp(String.raw`${MONEY}\s+(?:underwritten |registered direct |public )?(?:offering|private placement)`, 'i').exec(s);
      if (gp) { v = moneyToM(gp[1], gp[2]); if (v != null) break; }
    }
    if (v == null) {
      for (const s of ss) {
        const shp = /\b([\d,]{5,})\s+(?:shares|units)\b[^.$]{0,80}?\b(?:at|price of)\s+(?:a (?:public offering |purchase )?price of\s+)?\$\s?(\d+(?:\.\d+)?)\s+per\s+(?:share|unit)/i.exec(s);
        if (shp) { const n = Number(shp[1].replace(/,/g, '')), px = Number(shp[2]); if (n > 0 && px > 0) { v = r2((n * px) / 1e6); break; } }
      }
    }
    return { kind: 'offering', word: /private placement|PIPE/i.test(off) ? 'Private placement (new shares)' : 'Share offering (new shares)', valueM: v, line: clip(off, 240), quote: off, polarity: 'negative',
      flags: ['A rise on the day of a share sale is unusual — check the price against the market and who bought (a strategic buyer can explain it).'] };
  }
  const bb = find(/\b(?:share )?(?:repurchase|buyback|buy-back) (?:program|programme|authori[sz]ation|plan)\b[^.]{0,120}\$\s?\d|\bauthori[sz]ed (?:the )?(?:repurchase|buyback) of up to\b/i);
  if (bb) {
    const m = new RegExp(MONEY, 'i').exec(bb);
    return { kind: 'buyback', word: 'Share buyback', valueM: m ? moneyToM(m[1], m[2]) : null, line: clip(bb, 240), quote: bb, polarity: 'positive', flags: [] };
  }
  const gd = find(/\b(?:rais(?:es|ed)|increas(?:es|ed)|lower(?:s|ed)|cut(?:s)?|reduc(?:es|ed))\b[^.]{0,60}\b(?:guidance|outlook)\b/i);
  if (gd && !/\bnot (?:updating|changing)\b/i.test(gd)) return { kind: 'guidance', word: /rais|increas/i.test(gd) ? 'Guidance raised' : 'Guidance cut', valueM: null, line: clip(gd, 240), quote: gd, polarity: /rais|increas/i.test(gd) ? 'positive' : 'negative', flags: [] };
  const idx = find(/\b(?:added to|join(?:s|ing)?|inclusion in|included in|will replace)\b[\s\S]{0,60}?\b(?:S&P (?:SmallCap|MidCap|500)|S&P \d{3}|Russell (?:1000|2000|3000)|Nasdaq-100)\b/i);
  if (idx) return { kind: 'index', word: 'Index inclusion', valueM: null, line: clip(idx, 240), quote: idx, polarity: 'positive', flags: ['Index demand is a one-time flow of buying, not a change in the business.'] };
  return null;
}

/** Opinion / price-chatter / solicitation headlines are not company events. */
export const PRESS_NOISE = /\b(?:stock price, news|quote & history|live quotes|stock forecasts?|\bchart\b|outperforming|is (?:the )?stock (?:a buy|fairly valued|undervalued)|fair value|(?:under|over)valued|better buy|time to buy|should you buy|here'?s why|trading \d+(?:\.\d+)?% (?:higher|lower)|stock price (?:up|down)|stock (?:gains|falls|rises|jumps|soars|surges|sinks|slides|climbs|firms|closes|opens|holds|is down|is up)|stocks? (?:jump|rally|surge|fall)|shares (?:hit|jump|gain|fall)|52-week high|options volume|dip than|losing steam|could be (?:a )?(?:game changer|brewing)|could mean for|competitors \d{4}|which .* stock|vs\.? .* stock|investors? (?:have|who) |class action|shareholder alert|fraud investigation|law firm|stake (?:decreased|increased|lowered|raised|trimmed|cut) by|position (?:in|decreased|increased))\b/i;
const OPINION = /\b(?:(?:acquires?|buys?|sells?|trims?|boosts?|lowers?|raises?|cuts?) (?:new )?(?:position|stake|holdings?|shares) (?:in|of)\b|position in\b|(?:under|over)valued|fair value|better buy|time to buy|should you|could be|could mean|what .* means?|is (?:the )?stock|priced in|forecasts?\b|class action|fraud investigation|shareholder alert|investors? (?:have|who) )/i;

/** A press headline's kind (press only — never a filing). 'other' = no company event. */
export function pressKindOf(title: string): { kind: UsCardKind; word: string; polarity: UsCard['polarity'] } {
  const t = String(title || '');
  const none = { kind: 'other' as UsCardKind, word: 'Press coverage only', polarity: 'neutral' as const };
  if (/\b(?:upgrade[sd]?|downgrade[sd]?|price target|initiat(?:es|ed) coverage|reinstat(?:es|ed)|reiterat(?:es|ed)|maintains? (?:\w+ )?rating|outperform|overweight|(?:buy|sell|hold) rating)\b/i.test(t)) return { kind: 'analyst', word: /downgrad/i.test(t) ? 'Analyst downgrade (press only)' : 'Analyst action (press only)', polarity: /downgrad/i.test(t) ? 'negative' : 'positive' };
  if (/\b(?:short (?:seller|report)|Hindenburg|Muddy Waters|Spruce Point|Culper|Fuzzy Panda|Grizzly)\b/i.test(t)) return { kind: 'short_report', word: 'Short-seller report (press only)', polarity: 'negative' };
  if (OPINION.test(t)) return none;
  if (/\b(?:S&P (?:SmallCap|MidCap|500)|Russell (?:1000|2000|3000)|Nasdaq-100)\b/i.test(t) && /\b(?:join|add|inclusion|replace)/i.test(t)) return { kind: 'index', word: 'Index inclusion (press only)', polarity: 'positive' };
  if (/\b(?:activist|13D)\b|\b(?:takes?|builds?|discloses?) (?:a )?(?:\d+(?:\.\d+)?% )?stake\b/i.test(t)) return { kind: 'activist', word: 'Stake / activist (press only)', polarity: 'positive' };
  if (/\b(?:FDA|EMA)\b|\b(?:approval|clearance|advisory (?:committee|panel)|advisors back)\b/i.test(t)) return { kind: 'fda', word: 'FDA / approval (press only)', polarity: 'positive' };
  if (/\b(?:acquires?|acquisition|merger|to buy [A-Z]|takeover|buyout|deal (?:for|with)|extends? .* deal)\b/i.test(t)) return { kind: 'acquisition', word: 'Deal (press only)', polarity: 'positive' };
  if (/\b(?:wins?|awarded|secures?|lands?) (?:a |an )?(?:\$[\d.]+\s?(?:m|bn|b|million|billion) )?(?:contract|order|award)\b|\bcontract (?:worth|valued)\b/i.test(t)) return { kind: 'order', word: 'Contract / order (press only)', polarity: 'positive' };
  if (/\bopens? (?:(?:a|an|its|new|first|expanded|\$[\d.]+\s?(?:m|million|bn|billion))\s+){0,4}[\w-]*\s?(?:facility|plant|factory|campus|headquarters|HQ|center|centre|site)\b|\blaunch(?:es|ed)\b/i.test(t) && !/\bstock opens\b/i.test(t)) return { kind: 'facility', word: 'New facility / launch (press only)', polarity: 'positive' };
  if (/\b(?:reports?|posts?|announces?)\b[^|]{0,40}\b(?:results|earnings|revenue|EPS|Q[1-4])\b|\bQ[1-4](?:\s?FY)?\s?\d{2,4}\b[^|]{0,20}\b(?:results|earnings)\b/i.test(t)) return { kind: 'earnings', word: 'Results coverage (press only)', polarity: 'neutral' };
  if (PRESS_NOISE.test(t)) return none;
  return none;
}

// ── THE CARD ──────────────────────────────────────────────────────────────

export interface UsCardDoc { role: string; url: string; text: string; html?: string | null; name?: string | null }
export interface UsCardInput {
  ticker: string;
  company: string | null;
  /** $ millions, from the scan. */
  marketCapM: number | null;
  filing: { form: string; items: string[]; date: string | null; url: string; subject: string } | null;
  docs: UsCardDoc[];
  /** The original 8-K an 8-K/A amends (its docs), when found. */
  original?: { form: string; date: string | null; url: string; docs: UsCardDoc[] } | null;
  xbrl?: StrictFigures | null;
  press?: Array<{ title: string; url: string; date: string | null; source: string | null }>;
  latestSec?: { form: string; date: string; items?: string[] } | null;
  /** EDGAR answered for this name (a "no filing" is then a checked answer). */
  secChecked: boolean;
  windowDays?: number;
}

const ROLE_WORD: Record<string, string> = { primary: '8-K body', ex99: 'EX-99.1 press release', ex992: 'EX-99.2', proforma: 'pro forma exhibit', release: 'press release', booklet: 'scheme booklet', original: 'original 8-K', ex10: 'EX-10 agreement' };

function secLabel(form: string, date: string | null, doc: string | null): string {
  return `VERIFIED DOCUMENT (SEC ${form}${date ? `, filed ${date.slice(0, 10)}` : ''}${doc ? ` · ${doc}` : ''})`;
}

export function buildUsCard(inp: UsCardInput): UsCard | null {
  const f = inp.filing;
  const mcap = inp.marketCapM && inp.marketCapM > 0 ? inp.marketCapM : null;
  if (f && inp.docs.some((d) => (d.text && d.text.length > 150) || (d.html && d.html.length > 300))) {
    const form = f.form.toUpperCase();
    const items = new Set(f.items);
    const release = inp.docs.find((d) => d.role === 'ex99') || inp.docs.find((d) => d.role === 'release') || inp.docs.find((d) => d.role === 'primary') || inp.docs[0];
    const allDocs = [...inp.docs, ...(inp.original?.docs || []).map((d) => ({ ...d, role: d.role === 'primary' ? 'original' : d.role }))];
    const allText = allDocs.map((d) => d.text).join(' \n ');
    const date = f.date ? f.date.slice(0, 10) : null;
    const baseSource = (doc: string | null, url?: string | null): UsCardSource => ({ tier: 'SEC', label: secLabel(form, date, doc), form, date, url: url || release?.url || f.url, doc });
    const earningsForm = items.has('2.02') || /^(10-Q|10-K|20-F|40-F)(\/A)?$/.test(form) || (form === '6-K' && /\b(?:financial results|results for the|reports? (?:first|second|third|fourth|q[1-4])|quarter(?:ly)? results|half[- ]year results)\b/i.test(release?.text.slice(0, 3000) || ''));
    const dealForm = items.has('2.01') || items.has('1.01') || /^(425|S-4|S-4\/A|F-4|DEFM14A|PREM14A|SC TO-T|SC 14D9)$/.test(form) || (/^(6-K|8-K|8-K\/A)$/.test(form) && /\b(?:acquisition of|to acquire|acquires|merger|scheme of arrangement|schemes of arrangement|business combination|scheme implementation)\b/i.test(allText.slice(0, 12000)));

    // ── EARNINGS ──
    if (earningsForm) {
      const e = readUsEarnings({ text: release?.text || '', html: release?.html || null, xbrl: inp.xbrl, filedDate: date, form });
      if (e && (e.revenue || e.netIncome || e.outlook.length)) {
        const m = earningsMaterial(e);
        const weak = (e.revenueGrowthPct != null && e.revenueGrowthPct < 0 && (e.profitGrowthPct == null ? /widened|swung to a loss/.test(e.profitChange || '') : e.profitGrowthPct < 0)) || (e.profitGrowthPct != null && e.profitGrowthPct <= -20) || /swung to a loss|widened/.test(e.profitChange || '');
        const extra: string[] = [];
        if (e.outlook.length) extra.push(`Outlook as filed${e.outlookLabel ? ` (${e.outlookLabel})` : ''}: ${e.outlook.join(' · ')}`);
        extra.push(e.guidance === 'RAISED' ? `Guidance RAISED — “${e.guidanceNote}”` : e.guidance === 'CUT' ? `Guidance CUT — “${e.guidanceNote}”` : e.guidance === 'REAFFIRMED' ? `Guidance reaffirmed / unchanged — “${e.guidanceNote}”` : e.guidance === 'NEW' ? 'Guidance: a new outlook — the release does not compare it with an earlier one.' : 'Guidance: not stated in the filing.');
        const unknowns: string[] = [];
        if (!e.revenue?.prev) unknowns.push('Revenue a year ago: not stated in the filing');
        if (!e.netIncome) unknowns.push('Net income: not stated in the release');
        if (!e.margin) unknowns.push('Margin: not stated in the filing');
        unknowns.push('Whether the change repeats next quarter: open');
        const numbersRead = !!(e.revenue?.cur != null || e.netIncome?.cur != null);
        const doc = e.basis === 'SEC XBRL' ? 'SEC XBRL figures' : ROLE_WORD[release?.role || 'ex99'] || null;
        return {
          v: US_CARD_VERSION, kind: 'earnings', kindWord: `Earnings${e.period ? ` — ${e.period}` : ''}`, eventType: 'Earnings', stage: 'MONETIZING', stageText: null,
          headline: clip(releaseTitle(release?.text || '') || `Results filed${e.period ? ` for the ${e.period}` : ''}`, 170),
          whatChanged: numbersRead ? earningsLine(e) : `Outlook as filed${e.outlookLabel ? ` (${e.outlookLabel})` : ''}: ${e.outlook.join(' · ')}`,
          extra: extra.slice(0, 3),
          material: numbersRead ? { label: m.label, how: m.how, ratios: [] } : { label: 'UNKNOWN', how: 'The release states an outlook but not this period\'s revenue or profit against a year earlier.', ratios: [] },
          polarity: weak ? 'negative' : 'positive', source: baseSource(doc, e.basis === 'SEC XBRL' ? f.url : release?.url),
          whyResearch: weak
            ? `Results weakened (${[e.revenueGrowthPct != null ? `revenue ${pctTxt(e.revenueGrowthPct)}` : null, e.profitChange ? `profit ${e.profitChange}` : null].filter(Boolean).join(', ')}) — the move is not explained by these figures; check the outlook and one-off items.`
            : `Filed results show ${[e.revenueGrowthPct != null ? `revenue ${pctTxt(e.revenueGrowthPct)}` : null, e.profitChange ? `net income ${e.profitChange}` : null].filter(Boolean).join(' and ') || 'the figures above'}${e.guidance === 'RAISED' ? ' and a raised outlook' : e.outlook.length ? ' with a stated outlook' : ''} — check whether it repeats and what one-off items are in it.`,
          unknowns, flags: [], quantified: numbersRead, quote: e.basis === 'release text' ? revenueSentence(release?.text || '')?.sentence || null : null, earnings: e, deal: null,
        };
      }
    }

    // ── M&A ──
    if (dealForm) {
      const d = readUsDeal(allDocs.map((x) => ({ role: x.role, text: x.text })), { issuerName: inp.company, items: f.items, form, headline: f.subject });
      if (d && (d.upfrontM != null || d.totalValueM != null || d.exchangeRatio || d.ownershipPct != null || d.perShare || d.target)) {
        const price = d.upfrontM ?? d.totalValueM;
        const ratios: UsCard['material']['ratios'] = [];
        let label: UsMatLabel = 'UNKNOWN';
        let how = '';
        if (price != null) {
          const r = ratioVsMcap(price, mcap, 'acquisition', d.upfrontM != null ? (d.structure === 'cash' ? 'Cash paid up front' : 'Consideration') : 'Stated deal value');
          label = r.label; how = r.how; if (r.ratio) ratios.push(r.ratio);
          if (d.contingentM != null && mcap) ratios.push({ basis: 'market_cap', pct: r1(((price + d.contingentM) / mcap) * 100), text: `with the full earn-out: ${usdM(price + d.contingentM)} ÷ ${usdM(mcap)} = ${r1(((price + d.contingentM) / mcap) * 100)}%` });
        } else if (d.ownershipPct != null && d.ownershipPct > 0 && d.ownershipPct < 100) {
          const eq = (d.ownershipPct / (100 - d.ownershipPct)) * 100;
          label = bandLabel(eq, 'acquisition');
          ratios.push({ basis: 'market_cap', pct: r1(eq), text: `new shares = ${d.ownershipPct}% of the combined company → the deal ≈ ${r1(eq)}% of ${inp.ticker}'s current size (${d.ownershipPct} ÷ ${r1(100 - d.ownershipPct)})` });
          how = `Paid in new shares: the sellers would own ${d.ownershipPct}% of the combined company, so the deal is about ${r1(eq)}% of the company's current size (${d.ownershipPct} ÷ ${r1(100 - d.ownershipPct)}). Bands (same as India): 20%+ = HIGH, 5–20% = MODERATE, below 5% = SMALL.`;
        } else how = 'The price is not stated in the documents read — it cannot be sized against market cap.';
        const early = d.stage === 'proposed';
        if (early && label !== 'UNKNOWN') { const lad: UsMatLabel[] = ['SMALL', 'MODERATE', 'SIGNIFICANT']; label = lad[Math.max(0, lad.indexOf(label) - 1)]; how += ' Not completed and holders have not voted — one level lower until it is.'; }
        const pay = d.structure === 'cash' ? 'cash' : d.structure === 'stock' ? 'new shares' : d.structure === 'cash_and_stock' ? 'cash and shares' : 'payment form not stated';
        const wc: string[] = [];
        if (d.role === 'seller') wc.push(`Sold${d.target ? ` ${d.target}` : ' a business'} for ${usdM(price)}`);
        else if (price != null) wc.push(`${d.target ? `${d.target}: ` : ''}${d.upfrontM != null ? `${usdM(d.upfrontM)} ${d.structure === 'cash' ? 'cash' : ''} up front`.replace(/\s+/g, ' ') : `deal value ${usdM(d.totalValueM)}`}${ratios[0] ? ` ÷ ${usdM(mcap)} market cap = ${ratios[0].pct}%` : ''}`);
        else if (d.exchangeRatio) wc.push(`${d.target ? `${d.target}: ` : ''}paid in new shares — ${d.exchangeRatio}`);
        else if (d.perShare) wc.push(`${d.target ? `${d.target}: ` : ''}${d.perShare}`);
        else wc.push(`${d.target ? `Acquisition of ${d.target}` : 'Acquisition'} — price not stated in the documents read`);
        if (d.contingentM != null) wc.push(`+ up to ${usdM(d.contingentM)} more if milestones are met`);
        if (d.ownershipPct != null) wc.push(`sellers would own ${d.ownershipPct}% of the combined company${price == null && ratios[0] ? ` → deal ≈ ${ratios[0].pct}% of ${inp.ticker}'s current size` : ''}`);
        if (d.targetRevenueM != null) wc.push(`target revenue ≈ ${usdM(d.targetRevenueM)}${price != null ? ` (price ≈ ${r1(price / d.targetRevenueM)}× sales)` : ''}`);
        const extra = [
          `How paid: ${pay}${d.perShare ? ` (${d.perShare})` : ''}${d.exchangeRatio && price != null ? ` (${d.exchangeRatio})` : ''}`,
          d.fairValueM != null ? `Fair value of all consideration (pro forma, incl. expected earn-out): ${usdM(d.fairValueM)}` : null,
          `Funding: ${d.funding || 'not stated in the filing'}`,
          d.premiumPct != null ? `Premium: ${d.premiumPct}%${d.premiumTo ? ` ${d.premiumTo}` : ' to the target\'s price'}` : null,
          d.stageText ? `Stage: ${d.stageText}` : null,
        ].filter(Boolean) as string[];
        const unknowns = [
          d.targetRevenueM == null ? 'Target revenue / profit: not stated in the filing' : null,
          d.funding ? null : 'Funding: not stated in the filing',
          'Contribution to earnings: not stated in the filing',
        ].filter(Boolean) as string[];
        const docWord = d.quotes.length ? (allDocs.find((x) => d.quotes.some((q) => sentencesOf(x.text).some((s) => q.startsWith(s.slice(0, 60)))))?.role || release?.role || 'primary') : release?.role || 'primary';
        const origUsed = docWord === 'original' && inp.original;
        const src: UsCardSource = origUsed
          ? { tier: 'SEC', label: `${secLabel(form, date, null)} + original 8-K${inp.original!.date ? ` filed ${inp.original!.date.slice(0, 10)}` : ''}`, form, date, url: f.url, doc: 'original 8-K (terms) + this amendment' }
          : baseSource(ROLE_WORD[docWord] || null, allDocs.find((x) => x.role === docWord)?.url || f.url);
        const stageMap: UsCard['stage'] = d.stage === 'completed' ? 'EXECUTED' : d.stage === 'signed' || d.stage === 'approved' ? 'SIGNED' : d.stage === 'proposed' ? 'PROPOSED' : 'UNKNOWN';
        const kind: UsCardKind = d.role === 'seller' ? 'divestiture' : d.structure === 'stock' ? 'merger' : 'acquisition';
        return {
          v: US_CARD_VERSION, kind, kindWord: d.label, eventType: kind === 'divestiture' ? 'Divestment' : kind === 'merger' ? 'Merger' : 'Acquisition', stage: stageMap, stageText: d.stageText,
          headline: clip((() => {
            const pr = allDocs.filter((x) => x.role === 'ex99' || x.role === 'ex992' || x.role === 'release').map((x) => releaseTitle(x.text)).find(Boolean);
            return pr || `${d.label}${d.target ? ` of ${d.target}` : ''}${d.stageText ? ` — ${d.stageText}` : ''}`;
          })(), 170),
          whatChanged: wc.join(' · '), extra, material: { label, how, ratios }, polarity: 'positive', source: src,
          whyResearch: kind === 'merger'
            ? `Paid in new shares — what matters is how many shares are issued (dilution per share), what the target brings, and the holder vote${d.stageText ? ` (${d.stageText})` : ''}.`
            : kind === 'divestiture' ? 'A sale of a business — what matters is the cash received vs what the business earned, and what the cash is used for.'
              : `${d.structure === 'cash' ? 'A cash purchase' : 'An acquisition'} sized against the company — what matters is what the target earns (revenue / profit) and how it is paid for${d.targetRevenueM != null ? '' : ' (target revenue not stated)'}.`,
          unknowns, flags: [], quantified: price != null || d.ownershipPct != null, quote: d.quotes[0] || null, earnings: null, deal: d,
        };
      }
    }

    // ── ORDERS / OTHER ──
    const releaseFirst = [...allDocs.filter((d) => /^(ex99|release|ex992)$/.test(d.role)), ...allDocs.filter((d) => !/^(ex99|release|ex992)$/.test(d.role))].map((d) => d.text).join(' \n ');
    const other = readUsOther(releaseFirst, { form, items: f.items });
    if (other) {
      const kindBand: keyof typeof US_BANDS | null = other.kind === 'offering' ? 'offering' : other.kind === 'buyback' ? 'buyback' : null;
      const r = kindBand && other.valueM != null ? ratioVsMcap(other.valueM, mcap, kindBand, other.kind === 'offering' ? 'Offering size' : 'Buyback size') : null;
      const wc = `${other.word}${other.valueM != null ? `: ${r?.ratio ? r.ratio.text : usdM(other.valueM)}` : ''}${other.kind === 'fda' || other.kind === 'clinical' || other.kind === 'guidance' || other.kind === 'index' ? ` — “${clip(other.line, 200)}”` : ''}`;
      const why: Record<string, string> = {
        fda: other.polarity === 'negative' ? 'A regulatory setback — check what the FDA asked for and how long a re-filing takes.' : 'An approval opens a market — the revenue it books (price, patients, launch date) is not stated yet.',
        clinical: other.polarity === 'negative' ? 'The trial missed — check what is left in the pipeline and the cash runway.' : 'A trial read-out — what matters is the size of the effect, safety, and the path and time to approval.',
        offering: 'New shares were sold — a rise on an offering is unusual; check the price vs the market, who bought and what the money is for.',
        buyback: 'A buyback returns cash — size vs market cap is shown; check whether it is actually executed and how it is funded.',
        guidance: other.polarity === 'negative' ? 'Guidance was lowered — check what changed and whether it is one-off.' : 'Guidance was raised — check the new range against the old one and what drives it.',
        index: 'Index inclusion brings one-time buying from index funds — it does not change the business.',
      };
      return {
        v: US_CARD_VERSION, kind: other.kind, kindWord: other.word, eventType: other.kind === 'fda' || other.kind === 'clinical' ? 'Regulatory approval' : other.kind === 'offering' ? 'Fundraising' : other.kind === 'buyback' ? 'Buyback' : other.kind === 'guidance' ? 'Guidance' : 'Rating action',
        stage: other.kind === 'offering' || other.kind === 'fda' ? 'EXECUTED' : 'UNKNOWN', stageText: null,
        headline: clip(other.line, 160), whatChanged: wc, extra: [],
        material: r ? { label: r.label, how: r.how, ratios: r.ratio ? [r.ratio] : [] } : { label: 'UNKNOWN', how: other.kind === 'fda' || other.kind === 'clinical' ? 'A binary event — its size is the revenue the product can earn, which the filing does not state.' : 'No amount stated in the filing — it cannot be sized.', ratios: [] },
        polarity: other.polarity, source: baseSource(ROLE_WORD[release?.role || 'primary'] || null), whyResearch: why[other.kind] || 'Read the filing for the size of the event.',
        unknowns: other.valueM == null ? ['Amount: not stated in the filing'] : [], flags: other.flags, quantified: other.valueM != null, quote: other.quote, earnings: null, deal: null,
      };
    }
    const ord = readUsOrder(releaseFirst);
    if (ord && ord.valueM != null && (items.has('1.01') || items.has('7.01') || items.has('8.01') || /^6-K/.test(form))) {
      const r = ratioVsMcap(ord.valueM, mcap, 'order', ord.hedged ? 'Contract ceiling (up to)' : 'Contract value');
      const hedged = ord.hedged;
      const label: UsMatLabel = hedged && r.label !== 'UNKNOWN' ? 'UNKNOWN' : r.label;
      return {
        v: US_CARD_VERSION, kind: 'order', kindWord: 'Contract / order', eventType: 'Order win', stage: 'AWARDED', stageText: null,
        headline: clip(ord.quote || 'Contract / order', 160),
        whatChanged: `${hedged ? 'Contract ceiling (up to)' : 'Order'} ${r.ratio ? r.ratio.text : usdM(ord.valueM)}${ord.customer ? ` · customer: ${ord.customer}` : ''}${ord.duration ? ` · duration: ${ord.duration}` : ''}`,
        extra: [`Customer: ${ord.customer || 'not stated in the filing'}`, `Duration: ${ord.duration || 'not stated in the filing'}`],
        material: { label, how: hedged ? `${r.how} The figure is a ceiling ("up to") — scale only, not a committed amount.` : r.how, ratios: r.ratio ? [r.ratio] : [] },
        polarity: 'positive', source: baseSource(ROLE_WORD[release?.role || 'primary'] || null),
        whyResearch: 'An order sized against the company — what is open is the margin, how fast it is billed and whether it repeats.',
        unknowns: ['Margin: not stated in the filing', ...(ord.duration ? [] : ['Execution period: not stated in the filing'])], flags: [], quantified: true, quote: ord.quote, earnings: null, deal: null,
      };
    }
    // ── A filed event the readers cannot size: said as filed, with its source ──
    const materialItem = f.items.some((i) => ['1.01', '1.02', '2.01', '2.02', '2.03', '3.02', '5.01', '7.01', '8.01'].includes(i)) || /^(6-K|8-K\/A|425|DEFM14A|PREM14A|S-4|F-4|SC 13D|SCHEDULE 13D|SC TO-T|10-Q|10-K|20-F|424B\d|S-1|F-1)/.test(form);
    if (materialItem) {
      // a real title names an action; a slide-deck cover ("The Ai Infrastructure Company 1") does not
      const title = allDocs.filter((d) => /^(ex99|release|ex992)$/.test(d.role)).map((d) => releaseTitle(d.text))
        .find((x) => !!x && /\b(?:announces?|reports?|completes?|acquires?|signs?|launch(?:es)?|receives?|enters?|provides?|grants?|appoints?|expands?|wins?|awarded|secures?|presents?|agreement|partnership|results|update)\b/i.test(x)) || null;
      const body = inp.docs.find((d) => d.role === 'primary')?.text || '';
      const at = body.search(/\bItem\s+(?:1\.01|1\.02|2\.0\d|3\.02|5\.01|7\.01|8\.01)\b/);
      const itemLead = at >= 0 ? (sentencesOf(body.slice(at, at + 3000)).find((x) => /^(?:On|The|As|In|Effective|Pursuant)\b/.test(x) && x.length > 40 && !/\bfurnished\b|not be deemed|incorporated by reference|not undertaking|undertakes no|forward-looking|Exhibit 99/i.test(x)) || null) : null;
      // the release's own lead ("… today announced …") when there is no usable title
      const relLead = allDocs.filter((d) => /^(ex99|release|ex992)$/.test(d.role)).map((d) => sentencesOf(d.text).slice(0, 8).find((x) => /\btoday (?:announced|reported|provided|issued)|\bannounced (?:today|that)\b/i.test(x)) || null).find(Boolean) || null;
      const what = title || itemLead || relLead;
      const whatTxt = `${title || ''} ${itemLead || ''} ${relLead || ''}`;
      const deck = (/\b(?:investor|corporate) (?:presentation|deck|update|day)|slides? (?:to be )?(?:used|presented)|to (?:present|participate) at|fireside chat|webcast|conference\b/i.test(whatTxt) && !/\bclinical data\b|\bresults\b/i.test(whatTxt))
        || /\bappoint(?:s|ed|ment)\b[^.]{0,80}\b(?:board|director|officer)\b|\bannual (?:general )?meeting\b/i.test(whatTxt);
      const clinical = /\bclinical data\b|\bPhase [123][ab]?\b[^.]{0,60}\b(?:data|results)\b/i.test(whatTxt);
      const debtOnly = /\b(?:senior |convertible )?notes? due\b|\bredemption\b|\bpromissory note\b|\bcredit (?:agreement|facility)\b|\bterm loan\b|\bindenture\b|\brevolving\b/i.test(whatTxt) && !/\bacqui|merger|contract|order\b/i.test(whatTxt);
      const kindWord = deck ? 'Routine update (presentation / appointment) — no new event' : debtOnly ? 'Debt financing / redemption — no new operating event' : clinical ? 'Clinical data presented (size not stated)' : f.items.includes('1.01') ? 'Material agreement signed (terms not sized)' : f.items.includes('8.01') ? 'Company announcement (8-K Item 8.01)' : f.items.includes('7.01') ? 'Press release (8-K Item 7.01)' : /^6-K/.test(form) ? 'Foreign-filer report (6-K)' : `${form} filing`;
      return {
        v: US_CARD_VERSION, kind: 'other', kindWord, eventType: deck || debtOnly ? 'No identified catalyst' : f.items.includes('1.01') ? 'Contract' : 'No identified catalyst', stage: f.items.includes('1.01') && !debtOnly ? 'SIGNED' : 'UNKNOWN', stageText: null,
        headline: clip(what || kindWord, 170),
        whatChanged: `${what ? `As filed: “${clip(what, 220)}”` : kindWord}${what && /\$\s?\d/.test(what) ? ' — not sized against the company' : ' — no amount stated in the filing'}`,
        extra: [], material: { label: 'UNKNOWN', how: 'No amount is stated in the filing, so it cannot be sized against the company.', ratios: [] },
        polarity: 'neutral', source: baseSource(ROLE_WORD[release?.role || 'primary'] || null),
        whyResearch: deck ? 'A presentation or appointment restates the story — read it for any new figure; it is not by itself an event.' : debtOnly ? 'Borrowing or repaying debt is financing, not an operating event — it does not explain a move by itself.' : clinical ? 'Clinical data were presented — what matters is the size of the effect, safety, and the path and time to approval; the filing does not size it.' : 'A filed event with no amount stated — read the filing for its terms (value, counterparty, timing) before judging it.',
        unknowns: ['Amount: not stated in the filing'], flags: [], quantified: false, quote: itemLead, earnings: null, deal: null,
      };
    }
    return null;
  }

  // ── PRESS ONLY (no SEC event document in the window) ──
  const press0 = (inp.press || []).filter((p) => p.title);
  const press = press0.filter((p) => pressKindOf(p.title).kind !== 'other');
  const latestWord = inp.latestSec ? `latest SEC filing: ${inp.latestSec.form}${inp.latestSec.items?.length ? ` (Item ${inp.latestSec.items.join(', ')})` : ''} on ${inp.latestSec.date}` : null;
  if (!press.length && press0.length) {
    // only price chatter / opinion pieces — no company event at all
    const p = press0[0];
    return {
      v: US_CARD_VERSION, kind: 'other', kindWord: 'No company event found (market commentary only)', eventType: 'No identified catalyst', stage: 'UNKNOWN', stageText: null,
      headline: 'No SEC filing and no company news — only market commentary in the press',
      whatChanged: `No company event found. The press has only market commentary (e.g. “${clip(p.title, 120)}”) — no SEC filing found yet.`,
      extra: [inp.secChecked ? `SEC EDGAR checked: no results, deal, contract, offering or 13D filing in the last ${inp.windowDays ?? 21} days${latestWord ? ` (${latestWord})` : ''}.` : 'SEC EDGAR could not be checked for this name.'],
      material: { label: 'UNKNOWN', how: 'Nothing to size — no event was found.', ratios: [] }, polarity: 'neutral',
      source: { tier: 'PRESS', label: 'PRESS ONLY — no SEC filing found yet', form: null, date: p.date ? String(p.date).slice(0, 10) : null, url: p.url, doc: p.source },
      whyResearch: 'No filing and no company news explain the move — only price commentary. Check sector moves, peers or a filing that has not reached EDGAR yet.',
      unknowns: ['Official filing: none found yet'], flags: [], quantified: false, quote: null, earnings: null, deal: null,
    };
  }
  if (!press.length) return null;
  const RANK: Partial<Record<UsCardKind, number>> = { acquisition: 0, order: 0, fda: 0, clinical: 0, short_report: 0, facility: 1, index: 1, activist: 1, earnings: 2, analyst: 3 };
  const scored = press.map((p, i) => ({ p, i, k: pressKindOf(p.title) })).sort((a, b) => ((RANK[a.k.kind] ?? 5) - (RANK[b.k.kind] ?? 5)) || (a.i - b.i));
  const top = scored[0];
  const mm = new RegExp(MONEY, 'i').exec(top.p.title) || /\$(\d+(?:\.\d+)?)\s?(m|bn|b)\b/i.exec(top.p.title);
  const v = mm ? moneyToM(mm[1], mm[2]) : null;
  const scale = v != null && mcap ? ` · scale (press figure, not verified): ${usdM(v)} ÷ ${usdM(mcap)} market cap = ${r1((v / mcap) * 100)}%` : '';
  const latest = latestWord;
  const wd = inp.windowDays ?? 21;
  return {
    v: US_CARD_VERSION, kind: top.k.kind, kindWord: top.k.word, eventType: top.k.kind === 'analyst' || top.k.kind === 'index' ? 'Rating action' : top.k.kind === 'acquisition' ? 'Acquisition' : top.k.kind === 'order' ? 'Order win' : top.k.kind === 'facility' ? 'Capacity expansion' : top.k.kind === 'fda' ? 'Regulatory approval' : top.k.kind === 'short_report' ? 'Litigation / regulatory' : top.k.kind === 'earnings' ? 'Earnings' : 'No identified catalyst',
    stage: 'RUMOUR', stageText: null,
    headline: clip(top.p.title, 160),
    whatChanged: `Press report: “${clip(top.p.title, 150)}”${top.p.source ? ` (${top.p.source}${top.p.date ? `, ${String(top.p.date).slice(0, 10)}` : ''})` : ''} — press only, no SEC filing found yet${scale}`,
    extra: [inp.secChecked ? `SEC EDGAR checked: no results, deal, contract, offering or 13D filing in the last ${wd} days${latest ? ` (${latest})` : ''}.` : 'SEC EDGAR could not be checked for this name.', ...scored.slice(1, 3).map((x) => `Also in the press: “${clip(x.p.title, 120)}”`)],
    material: { label: 'UNKNOWN', how: `Press only — no figure from an official filing, so it is not sized.${scale ? ' The scale shown uses the press figure and is not verified.' : ''}`, ratios: [] },
    polarity: top.k.polarity,
    source: { tier: 'PRESS', label: 'PRESS ONLY — no SEC filing found yet', form: null, date: top.p.date ? String(top.p.date).slice(0, 10) : null, url: top.p.url, doc: top.p.source },
    whyResearch: `Press only — no SEC filing found yet. ${top.k.kind === 'analyst' ? 'An analyst view is an opinion, not a company event.' : top.k.kind === 'index' ? 'Index inclusion is a one-time flow of buying, not a change in the business.' : top.k.kind === 'short_report' ? 'A short-seller report is an allegation — look for the company\'s answer in a filing.' : 'Look for the company\'s own 8-K / press release before treating it as fact.'}`,
    unknowns: ['Official filing: none found yet', ...(v != null ? ['Figure: press only, not verified'] : [])], flags: [], quantified: false, quote: null, earnings: null, deal: null,
  };
}

/** SEC-first document ranking for one name: 8-K with EX-99.1 (known after
 *  the index is read) > 8-K > 6-K > deal / offering / periodic forms, fresher
 *  first, ≤10 days preferred over the rest of the window. Pure. */
export function rankUsFilings<T extends { subject: string; dateIso: string | null; ageDays?: number | null; url: string }>(xs: T[], now: Date, preferDays = 10): T[] {
  const formOf = (s: string) => (String(s || '').split(/:| · /)[0] || '').trim().toUpperCase();
  const itemsOf = (s: string) => Array.from(String(s || '').matchAll(/Item (\d\.\d\d)/g)).map((m) => m[1]);
  const score = (a: T): number => {
    const form = formOf(a.subject);
    const items = itemsOf(a.subject);
    const age = a.ageDays ?? (a.dateIso ? Math.floor((now.getTime() - Date.parse(a.dateIso)) / 86_400_000) : 99);
    let s = 0;
    if (/^8-K$/.test(form)) s = items.some((i) => ['2.02', '2.01', '1.01', '7.01', '8.01', '5.01'].includes(i)) ? (items.includes('9.01') ? 100 : 90) : 20;
    else if (/^8-K\/A$/.test(form)) s = items.includes('2.01') || items.includes('2.02') ? 80 : 15;
    else if (/^6-K/.test(form)) s = 70;
    else if (/^(425|DEFM14A|PREM14A|S-4|F-4|SC TO-T|SC 14D9|SC 13D|SCHEDULE 13D)$/.test(form)) s = 60;
    else if (/^(10-Q|10-K|20-F|40-F)$/.test(form)) s = 55;
    else if (/^(424B[1-8]|S-1|F-1)$/.test(form)) s = 50;
    else s = 0;
    if (s === 0) return -1;
    return s + (age <= preferDays ? 200 : 0) - Math.min(age, 60) * 0.5;
  };
  return xs.map((a) => ({ a, s: score(a) })).filter((x) => x.s >= 0).sort((x, y) => y.s - x.s).map((x) => x.a);
}
