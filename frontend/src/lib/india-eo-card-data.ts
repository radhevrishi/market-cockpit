import { resolveFyYear } from '@/lib/calendar-dates';
import { CASH_RATIO_HIGH, CASH_RULE_V } from './india-cash';  // zzz826
import { finSubKind, FIN_KIND_WORD } from './fin-kind';   // zzz1089
// ═══════════════════════════════════════════════════════════════════════════
// INDIA EARNINGS OPPORTUNITIES — WHAT A CARD MAY HONESTLY SHOW  (zzz820)
//
// The owner: "see if all data correct or something messed up; if so fix".
// Pure helpers (no fetch, no React), unit-tested in
// src/lib/__tests__/zzz820-india-eo-data.test.ts. They run on the stored
// graded rows at display time, so rows already on file read correctly without
// being re-graded, and they never invent a figure: anything that cannot be
// shown honestly becomes '—' with a plain reason.
//
//   1. QUARTER LABEL. Indian FY runs Apr–Mar. Results filed in Jul–Sep are for
//      Apr–Jun = Q1 of the FY that ends next March (Aug 2026 → Q1 FY27). A
//      stored label for a quarter that had not even ENDED on the filing date
//      (Aether, 31 Jul 2026, stored "Q1 FY28") is impossible and is replaced
//      by the quarter the filing date implies.
//   2. YEAR-AGO BASE. Screener tables have gaps (half-yearly SME filers, a
//      company that changed its financial year). The feed used to take "four
//      columns back" as the year-ago quarter, so Sales/EPS "YoY" were
//      sometimes measured against a quarter five periods old while profit —
//      which had no such fallback — showed '—'. Those rows are recognisable
//      (sales/EPS year-ago present, profit year-ago missing, Screener feed)
//      and their growth figures are withheld with the reason.
//   3. MARGIN. An operating margin of exactly 0.0% (and 0.0% a year ago) is
//      the feed's "no figure", not a real margin. Banks, NBFCs and insurers
//      have no operating margin in the usual sense (Screener shows a
//      "financing margin" that is often negative for a profitable bank), so
//      for them the tile shows net profit ÷ total income instead — both
//      figures from the same row — and says so.
// ═══════════════════════════════════════════════════════════════════════════

const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const DAY_MS = 86_400_000;

const fin = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);

// ─── 1. Quarter label ─────────────────────────────────────────────────────

/** The results quarter a filing on this date is normally for, e.g.
 *  2026-08-12 → "Q1 FY27", 2026-05-20 → "Q4 FY26", 2026-11-10 → "Q2 FY27",
 *  2027-02-05 → "Q3 FY27". Null for an unreadable date. */
export function resultsQuarterFor(filingIso: string | null | undefined): string | null {
  const s = String(filingIso || '');
  if (!ISO_RE.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(5, 7);
  if (!y || !m) return null;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  if (m <= 3) return `Q3 FY${yy(y)}`;       // Oct–Dec quarter, FY ends this March
  if (m <= 6) return `Q4 FY${yy(y)}`;       // Jan–Mar quarter, FY ended this March
  if (m <= 9) return `Q1 FY${yy(y + 1)}`;   // Apr–Jun quarter, FY ends next March
  return `Q2 FY${yy(y + 1)}`;               // Jul–Sep quarter, FY ends next March
}

/** "Q1 FY27" → "2026-06-30" (the quarter's last day), or null. */
export function quarterEndIso(label: string | null | undefined): string | null {
  const m = String(label || '').match(/Q([1-4])\s*FY\s?'?(\d{2}|\d{4})\b/i);
  if (!m) return null;
  const q = +m[1];
  const fy = m[2].length === 4 ? +m[2] : resolveFyYear(+m[2]);   // zzz897 — was 2000 + yy
  if (q === 1) return `${fy - 1}-06-30`;
  if (q === 2) return `${fy - 1}-09-30`;
  if (q === 3) return `${fy - 1}-12-31`;
  return `${fy}-03-31`;
}

/** A late filer or a new listing may file the PREVIOUS quarter, up to this
 *  many days after it ended; anything older is not this season's result. */
export const MAX_FILING_LAG_DAYS = 200;

export interface QuarterCheck {
  /** What the card shows. */
  label: string | null;
  /** True when the stored label was replaced. */
  corrected: boolean;
  /** The stored label, when it was replaced (for the tooltip). */
  stored?: string;
  reason?: string;
}

/**
 * The quarter label a card may show. A stored label is kept when the quarter
 * had ended by the filing date and ended no more than MAX_FILING_LAG_DAYS
 * before it. Otherwise — a quarter still in the future, a years-old one, or a
 * bare "Q1" with no year — the label comes from the filing date.
 */
export function checkQuarterLabel(stored: string | null | undefined, filingIso: string | null | undefined): QuarterCheck {
  const s = String(stored || '').trim();
  const derived = resultsQuarterFor(filingIso);
  if (!derived) return { label: s || null, corrected: false };
  if (!s) return { label: derived, corrected: false };
  const end = quarterEndIso(s);
  if (!end) {
    // "Q1" alone (older payloads) — same quarter, add the year.
    const bare = s.match(/^Q([1-4])$/i);
    if (bare && derived.startsWith(`Q${bare[1]} `)) return { label: derived, corrected: false };
    return { label: derived, corrected: true, stored: s, reason: `stored label "${s}" is not a quarter this filing can be for` };
  }
  const filed = Date.parse(String(filingIso).slice(0, 10) + 'T00:00:00Z');
  const ended = Date.parse(end + 'T00:00:00Z');
  const lag = (filed - ended) / DAY_MS;
  if (lag < 0) return { label: derived, corrected: true, stored: s, reason: `stored "${s}" had not ended on the filing date` };
  if (lag > MAX_FILING_LAG_DAYS) return { label: derived, corrected: true, stored: s, reason: `stored "${s}" ended ${Math.round(lag)} days before the filing` };
  // Normalise spacing/case ("Q1FY27" → "Q1 FY27").
  const m = s.match(/Q([1-4])\s*FY\s?'?(\d{2}|\d{4})/i)!;
  return { label: `Q${m[1]} FY${m[2].slice(-2)}`, corrected: false };
}

// ─── 3. Financial companies (banks, NBFCs, insurers) ──────────────────────

const FIN_TEXT_RE = /\b(bank|banks|banking|nbfc|non[- ]banking|lending|lender|micro ?finance|housing finance|finance|financiers?|financial services|financial holdings?|finance holdings?|capital holdings?|investment corporation|holdings? (?:&|and) investments?|fincorp|finserv|finvest|finlease|leasing|credit|insurance|assurance|life insurance|general insurance)\b/i;

export type FinancialKind = 'lender' | 'insurer';

/**
 * Is this a bank / NBFC / insurer, for which an operating margin is not a
 * meaningful figure? Read from the sector/industry fields when the feed has
 * them, else from the company's registered name ("… Bank Ltd", "… Finance
 * Ltd", "… Small Finance Bank", "… Housing Finance", "… Fincorp"). Never from
 * a ticker list.
 */
export function financialKind(r: { sector?: any; industry?: any; sub_sector?: any; broad_industry?: any; company?: any } | null | undefined): FinancialKind | null {
  if (!r) return null;
  const text = [r.sector, r.industry, r.sub_sector, r.broad_industry, r.company].filter(Boolean).map((x) => decodeEntities(String(x))).join(' | ');
  if (!text) return null;
  if (/\b(insurance|assurance)\b/i.test(text) && !/\bbank\b/i.test(text)) return 'insurer';
  // "Capital" alone is NOT enough (CP Capital is an education company); it
  // needs a finance word.
  return FIN_TEXT_RE.test(text) ? 'lender' : null;
}

/**
 * zzz822 — the card's financial-company test: the shared name/industry test,
 * OR what the engine already concluded about this row (a `financial_kind` /
 * `is_lender` field, or its lender cash tag), so card and grade never
 * disagree (Cholamandalam Financial Holdings was flagged a lender by the
 * engine and shown an operating margin by the card).
 */
export function financialKindOfRow(r: any): FinancialKind | null {
  if (!r) return null;
  const k = financialKind(r);
  if (k) return k;
  const fk = String(r.financial_kind || r.fin_kind || '').toLowerCase();
  if (fk === 'insurer') return 'insurer';
  if (fk === 'lender' || r.is_lender === true) return 'lender';
  const tags: any[] = Array.isArray(r.caveat_tags) ? r.caveat_tags : [];
  if (tags.some((t) => /^lender\b/i.test(String(t)))) return 'lender';
  return null;
}

export interface MarginView {
  /** 'opm' — operating margin; 'net' — net profit ÷ total income (financials). */
  mode: 'opm' | 'net';
  label: string;
  value: number | null;
  prev: number | null;
  /** One short line under the figure. */
  note: string;
  /** Tooltip. */
  title: string;
}

const pctOf = (num: any, den: any): number | null =>
  fin(num) && fin(den) && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

/** What the margin tile shows. See header §3. */
export function marginView(r: any, opts: { newlyListed?: boolean } = {}): MarginView {
  const kind = financialKindOfRow(r);
  if (kind) {
    const value = pctOf(r?.pat_curr_cr, r?.sales_curr_cr);
    const prev = pctOf(r?.pat_prev_cr, r?.sales_prev_cr);
    const who = kind === 'insurer' ? 'insurer' : 'bank / lender';
    return {
      mode: 'net',
      label: 'NET MARGIN',
      value, prev,
      note: value == null ? `${who} — profit or income not in source` : (prev == null ? `${who} · prior n/a` : `${who} · vs ${prev.toFixed(1)}%`),
      title: `${who[0].toUpperCase()}${who.slice(1)}: operating margin is not a meaningful figure (Screener shows a "financing margin" that can be negative for a profitable lender). Shown instead: net profit ÷ total income, both from this quarter's result${prev != null ? ', against the same quarter last year' : ''}.`,
    };
  }
  let value: number | null = fin(r?.opm_pct) ? r.opm_pct : null;
  let prev: number | null = fin(r?.opm_prev_pct) ? r.opm_prev_pct : null;
  // Exactly 0.0% is the feed's "no figure" (the Screener worker writes 0 when
  // the row is absent). A real margin is essentially never exactly zero.
  const zeroNow = value === 0, zeroPrev = prev === 0;
  if (zeroNow) value = null;
  if (zeroPrev) prev = null;
  const note = value != null
    ? (prev != null ? `vs ${prev.toFixed(1)}%` : 'prior n/a')
    : (zeroNow ? 'not in source' : (opts.newlyListed ? 'newly listed' : 'not in source'));
  return {
    mode: 'opm',
    label: 'OPM MARGIN',
    value, prev, note,
    title: zeroNow || zeroPrev
      ? 'The source reported the margin as 0.0% — that is its "no figure" value, so it is shown as unknown rather than as a zero margin.'
      : 'Operating profit ÷ sales for the quarter, against the same quarter last year.',
  };
}

// ─── 2. Year-ago base ─────────────────────────────────────────────────────

/**
 * True when the row's Sales/EPS "YoY" came from a positional look-back over a
 * gappy Screener table and so may compare against the wrong quarter. The
 * signature: Screener-worker feed, profit this quarter known, profit a year
 * ago missing, yet a sales or EPS year-ago figure present (the worker's own
 * year-ago block carries all three together; only the positional fallback
 * fills sales and EPS without profit).
 */
/** Version of the year-ago matching rule enrichment applied (zzz820 date
 *  match = 2). A row carrying it was matched by date, so it is never
 *  UNCONFIRMED, whatever shape its figures have. */
export const YOY_RULE_V = 2;

export function yearAgoUnverified(r: any): boolean {
  if (!r) return false;
  if (fin(r.yoy_rule_v) && r.yoy_rule_v >= YOY_RULE_V) return false;
  if (fin(r.grade_input?.yoy_rule_v) && r.grade_input.yoy_rule_v >= YOY_RULE_V) return false;
  const src = String(r.source || r.financials_source || '');
  if (src !== 'screener-worker') return false;
  if (!fin(r.pat_curr_cr) || fin(r.pat_prev_cr)) return false;
  return fin(r.sales_prev_cr) || fin(r.eps_prev);
}

export const YEAR_AGO_UNVERIFIED_NOTE =
  'Growth not shown: the same quarter last year could not be matched in the Screener table (it has a gap), so the stored growth figures may compare against the wrong quarter.';

export interface GrowthView {
  sales: number | null; salesPrev: number | null;
  pat: number | null; patPrev: number | null;
  eps: number | null; epsPrev: number | null;
  /** Set when growth is withheld. */
  withheld: string | null;
  /** Why the profit figure is '—' while EPS is present, if it is. */
  patNote: string | null;
}

/** The growth figures a card may show. Never back-computes a figure. */
export function growthView(r: any): GrowthView {
  const n = (v: any) => (fin(v) ? v : null);
  if (yearAgoUnverified(r)) {
    return {
      sales: null, salesPrev: null, pat: null, patPrev: null, eps: null, epsPrev: null,
      withheld: YEAR_AGO_UNVERIFIED_NOTE,
      patNote: null,
    };
  }
  const pat = n(r?.net_profit_yoy_pct ?? r?.pat_yoy_pct);
  const patPrev = n(r?.pat_prev_cr);
  const patNote = pat == null && patPrev == null && fin(r?.pat_curr_cr) && fin(r?.eps_yoy_pct)
    ? 'year-ago profit not in source'
    : null;
  return {
    sales: n(r?.sales_yoy_pct), salesPrev: n(r?.sales_prev_cr),
    pat, patPrev,
    eps: n(r?.eps_yoy_pct), epsPrev: n(r?.eps_prev),
    withheld: null,
    patNote,
  };
}

// ─── Words instead of 0–100 numbers ───────────────────────────────────────

/** Quality / inflection axis as a word (the number is not shown). */
export function axisWord(v: any, kind: 'quality' | 'inflection'): string | null {
  if (!fin(v)) return null;
  if (kind === 'quality') return v >= 70 ? 'high quality' : v >= 45 ? 'fair quality' : 'low quality';
  return v >= 70 ? 'strong inflection' : v >= 45 ? 'some inflection' : 'little inflection';
}

/** zzz827 — THE drift banding, shared by EO and the Conviction Beats tab
 *  (so one stock reads the same word on both pages). */
export function driftBand(v: any): 'strong' | 'moderate' | 'weak' | null {
  if (!fin(v)) return null;
  return v >= 70 ? 'strong' : v >= 50 ? 'moderate' : 'weak';
}

/** Post-earnings drift signal as a word. */
export function driftWord(v: any): string | null {
  const b = driftBand(v);
  return b ? `${b} drift signal` : null;
}

/** A quadrant component ("cash conversion 20/20") as words. */
export function partWord(p: { label: string; points: number; of: number }): string {
  const f = p.of > 0 ? p.points / p.of : 0;
  return `${p.label} (${f >= 0.85 ? 'full marks' : f >= 0.4 ? 'partial' : f > 0 ? 'weak' : 'none'})`;
}

// ─── Stale rows (graded under previous rules) ─────────────────────────────

/** Rows graded by an older engine may lack RS / Stage: say so, never blank. */
export function notRecordedNote(r: any): string | null {
  if (!r?._engine_stale) return null;
  const miss: string[] = [];
  if (!fin(r.rs_rating)) miss.push('RS');
  if (!fin(r.stage)) miss.push('Stage');
  return miss.length ? `${miss.join(' & ')} not recorded (older grading rules)` : null;
}

// ─── One-call display fix for a stored row ────────────────────────────────

/**
 * The stored row with its quarter label made honest. Everything else on the
 * card is decided by marginView / growthView at render time; this only fixes
 * the label because it is read in many places (search, CSV, the chips).
 */
export function withHonestQuarter<R extends { quarter?: any; filing_date?: any; _window_date?: any }>(r: R): R & { _quarter_note?: string; _quarter_stored?: string } {
  const q = checkQuarterLabel(r?.quarter, r?._window_date || r?.filing_date);
  if (!q.label || (q.label === r.quarter && !q.corrected)) return r;
  return { ...r, quarter: q.label, ...(q.corrected ? { _quarter_note: q.reason, _quarter_stored: q.stored } : {}) };
}

// ─── Feed-side helpers (used by /api/v1/earnings/enrich) ──────────────────

/** A Screener page whose newest quarter ended more than this many days ago is
 *  stale for a results filing (typically the consolidated page of a company
 *  that stopped consolidating while its standalone page is current). */
export const SCREENER_STALE_DAYS = 120;

export function isQuarterEndStale(iso: string | null | undefined, now: number = Date.now()): boolean {
  if (!iso || !ISO_RE.test(String(iso))) return true;
  return (now - Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')) / DAY_MS > SCREENER_STALE_DAYS;
}

/**
 * The latest value of a quarterly series and the value for the SAME month one
 * year earlier, found by the column's DATE label ("Jun 2026" → "Jun 2025").
 * Null when the dates are missing, do not line up with the series, or the
 * year-ago column is not there — never a positional guess.
 */
export function yoyFromDatedSeries(arr: any, dates: any): { curr: number; prev: number } | null {
  if (!Array.isArray(arr) || !Array.isArray(dates) || arr.length < 2 || arr.length !== dates.length) return null;
  const last = arr.length - 1;
  const lm = String(dates[last] || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!lm) return null;
  const want = `${lm[1]} ${+lm[2] - 1}`.toLowerCase();
  const i = dates.findIndex((d: any) => {
    const m = String(d || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    return !!m && `${m[1]} ${m[2]}`.toLowerCase() === want;
  });
  if (i < 0) return null;
  const curr = Number(arr[last]), prev = Number(arr[i]);
  if (arr[last] == null || arr[i] == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return { curr, prev };
}

/** Two reported figures describe the same number (within rounding: 2%, or
 *  ₹0.5 Cr for small values). Used to prove two sources read the same quarter
 *  on the same statement basis before mixing their figures. */
export function sameFigure(a: any, b: any): boolean {
  if (!fin(a) || !fin(b)) return false;
  const d = Math.abs(a - b);
  return d <= 0.5 || d <= 0.02 * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * How many of a graded day's dropped companies are worth re-checking later —
 * the ones dropped for data that can still ARRIVE: the new quarter not yet on
 * Screener (or Screener serving a stale page), a filing not yet confirmed, or
 * the stale-data guard. Not: rows with no reason, or duplicates of one ticker.
 */
export function recheckableDrops(dropped: any): number {
  if (!Array.isArray(dropped)) return 0;
  const seen = new Set<string>();
  let n = 0;
  for (const x of dropped) {
    const t = String(x?.ticker || '').toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const r = String(x?.reason || '').toLowerCase();
    if (/not on screener|before the filing|scheduled|upcoming|no filing confirmed|stale-data guard|quarter not fresh/.test(r)) n++;
  }
  return n;
}

/** The stored one-line narrative, minus its growth percentages when those
 *  were withheld on the card (so the text never contradicts the tiles). */
export function narrativeForDisplay(r: any): string {
  // zzz822 — entities decoded; the cap reason is shown once, under the badge.
  let n = stripCapReasonFromText(decodeEntities(String(r?.narrative || '')), capReasonOf(r));
  // A corrected quarter label is corrected in the sentence too.
  const q = checkQuarterLabel(r?._quarter_stored || r?.quarter, r?._window_date || r?.filing_date);
  if (q.corrected && q.stored && q.label) n = n.split(q.stored).join(q.label);
  if (r?._quarter_stored && r?.quarter && r._quarter_stored !== r.quarter) n = n.split(r._quarter_stored).join(r.quarter);
  if (!yearAgoUnverified(r)) return n;
  return n
    .replace(/\s*\((?:[^()]*\bYoY\b[^()]*)\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() + ' (Growth figures withheld — year-ago quarter not matched.)';
}

// ─── zzz820b — a tier built on unverified growth does not stand silently ──

export const UNCONFIRMED_LABEL = 'UNCONFIRMED — figures being re-checked';
const TOP = new Set(['BLOCKBUSTER', 'STRONG']);

/**
 * A stored row whose growth was measured against an unverified year-ago
 * quarter (yearAgoUnverified) keeps its stored tier only as `_tier_unconfirmed`
 * (shown small and grey). A BLOCKBUSTER / STRONG row is held in MIXED so it
 * is never counted, chipped, exported or benched as a top-tier result until it
 * is regraded with correct figures. Idempotent.
 */
export function holdUnconfirmed<R extends { tier?: any }>(r: R): R & { _tier_unconfirmed?: string } {
  if (!r || (r as any)._tier_unconfirmed || !yearAgoUnverified(r)) return r;
  const stored = String(r.tier ?? '');
  return { ...r, _tier_unconfirmed: stored || 'unknown', tier: TOP.has(stored) ? 'MIXED' : r.tier };
}

/** holdUnconfirmed over a graded payload's by_tier (rows move bucket with their tier). */
export function holdUnconfirmedPayload<P extends { by_tier?: any }>(p: P): P {
  if (!p || !p.by_tier) return p;
  const out: Record<string, any[]> = {};
  for (const k of Object.keys(p.by_tier)) out[k] = [];
  let moved = false;
  for (const [k, list] of Object.entries(p.by_tier as Record<string, any[]>)) {
    if (!Array.isArray(list)) { out[k] = list as any; continue; }
    for (const r of list) {
      const h = holdUnconfirmed(r);
      const t = h && h !== r ? String(h.tier) : k;
      if (h !== r) moved = true;
      (out[t] ||= []).push(h);
    }
  }
  return moved ? { ...p, by_tier: out } : p;
}

/** How many rows of a stored day carry growth measured against an unverified
 *  year-ago quarter (for the prewarm re-check). */
export function unconfirmedRows(p: any): number {
  let n = 0;
  for (const list of Object.values(p?.by_tier || {})) {
    if (Array.isArray(list)) for (const r of list) if (yearAgoUnverified(r)) n++;
  }
  return n;
}

// ─── zzz826 — stored rows whose cash figures predate the current rule ────

/**
 * True when a stored row's cash figures were fetched under an older cash rule
 * and a fresh fetch could change them: no fiscal-year basis at all (graded
 * before the same-year fix, or regraded from card figures), or a same-year
 * pair whose ratio was hidden by the old ±8x limit. Never for a lender or
 * insurer (the test does not apply) and never once the row carries the
 * current `cash_rule_v` (a fresh fetch already ran; a Screener page with no
 * cash figures stays unknown rather than being re-fetched for ever).
 */
export function needsCashRefetch(r: any): boolean {
  if (!r || typeof r !== 'object') return false;
  const v = fin(r.cash_rule_v) ? r.cash_rule_v : fin(r.grade_input?.cash_rule_v) ? r.grade_input.cash_rule_v : 0;
  if (v >= CASH_RULE_V) return false;
  if (r.fin_kind || r.cash_note === 'not meaningful for lenders' || financialKindOfRow(r)) return false;
  const hasFigures = [r.sales_curr_cr, r.pat_curr_cr, r.eps_curr].some(fin);
  if (!hasFigures) return false;   // a preview card; the fill pass handles those
  const basis = typeof r.cash_basis === 'string' && r.cash_basis.trim();
  if (!basis) return true;
  const ratio = [r.ocf_to_pat_ratio, r.cfo_to_pat_ratio].find(fin);
  const gi = r.grade_input || {};
  const ocf = fin(gi.ocf_annual_cr) ? gi.ocf_annual_cr : fin(r.ocf_annual_cr) ? r.ocf_annual_cr : null;
  const pat = fin(gi.pat_annual_cr) ? gi.pat_annual_cr : fin(r.pat_annual_cr) ? r.pat_annual_cr : null;
  return ratio == null && ocf != null && pat != null && pat > 0 && Math.abs(ocf / pat) > CASH_RATIO_HIGH;
}

/** How many rows of a stored day need a cash re-fetch (for the prewarm re-check). */
export function cashRefetchRows(p: any): number {
  let n = 0;
  for (const list of Object.values(p?.by_tier || {})) {
    if (Array.isArray(list)) for (const r of list) if (needsCashRefetch(r)) n++;
  }
  return n;
}

/**
 * The tickers of a stored day whose figures must be fetched FRESH (enrichment
 * cache bypassed) on a re-check: growth measured against an unverified
 * year-ago quarter, or cash figures from an older rule. A plain rebuild would
 * read the enrichment cache and could re-serve the same figures.
 */
export function refetchTickers(p: any): string[] {
  const out = new Set<string>();
  for (const list of Object.values(p?.by_tier || {})) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const t = String(r?.ticker || '').trim().toUpperCase();
      if (t && (yearAgoUnverified(r) || needsCashRefetch(r))) out.add(t);
    }
  }
  return Array.from(out);
}

/** A graded payload without the grader's stored input (never kept in the
 *  browser — it is large and only the server regrade reads it). */
export function stripGradeInputForStorage<P extends { by_tier?: any }>(p: P): P {
  if (!p || !p.by_tier) return p;
  const by_tier: Record<string, any> = {};
  for (const [k, list] of Object.entries(p.by_tier as Record<string, any>)) {
    by_tier[k] = Array.isArray(list)
      ? list.map((r: any) => {
          if (!r || typeof r !== 'object' || !('grade_input' in r || '_stored_input' in r)) return r;
          const { grade_input: _g, _stored_input: _s, ...rest } = r;
          return rest;
        })
      : list;
  }
  return { ...p, by_tier };
}


// ═══════════════════════════════════════════════════════════════════════════
// zzz822 — ROUND 2: entities, liquidity, size labels, cash tile, cap reason
// ═══════════════════════════════════════════════════════════════════════════

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** "B&amp;B Triplewall" → "B&B Triplewall"; also &#38; / &#x26; and doubly
 *  encoded "&amp;amp;". Text without entities is returned unchanged. */
export function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') < 0) return s;
  let out = s;
  for (let i = 0; i < 3 && /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(out); i++) {
    out = out.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      const v = NAMED_ENTITIES[e.toLowerCase()];
      return v ?? m;
    });
  }
  return out;
}

const decodeAny = (v: any) => (typeof v === 'string' ? decodeEntities(v) : v);

/** The cap reason a row carries (engine v24+), or null. */
export function capReasonOf(r: any): string | null {
  const x = r?.tier_cap_reason;
  return typeof x === 'string' && x.trim() ? decodeEntities(x.trim()) : null;
}

/** Caveat chips without the cap reason (it is shown once, under the badge). */
export function caveatTagsForDisplay(r: any): string[] {
  const tags: any[] = Array.isArray(r?.caveat_tags) ? r.caveat_tags : [];
  const cap = capReasonOf(r);
  return tags.map((t) => decodeEntities(String(t)))
    .filter((t) => t && t !== cap && !/^Capped at (BLOCKBUSTER|STRONG|MIXED|AVOID)\b/i.test(t));
}

/** The summary sentence without the cap reason (old rows carry it inline:
 *  "… with caveats: optical eps + Capped at STRONG: …."). */
export function stripCapReasonFromText(text: string, cap: string | null): string {
  let n = String(text || '');
  if (cap) n = n.split(cap).join('');
  // Any other "Capped at X: …" clause, up to the end of the sentence.
  n = n.replace(/Capped at (?:BLOCKBUSTER|STRONG|MIXED|AVOID):[^+]*?(?=\s\+\s|\.(?:\s|$)|$)/g, '');
  n = n.replace(/\s\+\s(?=\s*(?:\.|$))/g, '')
    .replace(/:\s*\+\s*/g, ': ')
    .replace(/\s\+\s+\+\s/g, ' + ')
    .replace(/\s+with caveats?:\s*(?=\.|$)/gi, '')
    .replace(/caveats: ([^+.]+)\./g, (m, one) => (one.includes(' + ') ? m : `caveat: ${one}.`))
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();
  return n;
}

/**
 * The row with every text field decoded (company, narrative, caveat chips,
 * cap reason, market context) — so "&amp;" never reaches the screen or the
 * CSV. Idempotent.
 */
export function decodeRowText<R>(r: R): R {
  if (!r || typeof r !== 'object') return r;
  const x: any = r;
  const out: any = { ...x };
  for (const k of ['company', 'narrative', 'tier_cap_reason', 'sector', 'industry']) if (typeof x[k] === 'string') out[k] = decodeEntities(x[k]);
  if (Array.isArray(x.caveat_tags)) out.caveat_tags = x.caveat_tags.map(decodeAny);
  if (Array.isArray(x.market_context)) out.market_context = x.market_context.map(decodeAny);
  if (Array.isArray(x.methodology_tags)) out.methodology_tags = x.methodology_tags.map(decodeAny);
  return out;
}

/** Everything a stored row needs before display: decoded text, then the
 *  unconfirmed hold. */
export function prepareDisplayRow<R extends { tier?: any }>(r: R): R & { _tier_unconfirmed?: string } {
  return holdUnconfirmed(decodeRowText(r));
}

/** prepareDisplayRow over a payload's by_tier (rows move bucket with their tier). */
export function prepareDisplayPayload<P extends { by_tier?: any }>(p: P): P {
  if (!p || !p.by_tier) return p;
  const decoded: Record<string, any> = {};
  for (const [k, list] of Object.entries(p.by_tier as Record<string, any>)) decoded[k] = Array.isArray(list) ? list.map((r) => decodeRowText(r)) : list;
  return holdUnconfirmedPayload({ ...p, by_tier: decoded });
}

// ─── Liquidity ────────────────────────────────────────────────────────────

/** An AVERAGE day's trading above this share of the company's market cap is
 *  not believable as an average (it is a results-day spike or a unit slip). */
export const MAX_PLAUSIBLE_DAILY_TURNOVER_PCT = 5;

export interface LiquidityView {
  cr: number | null; note: string | null; title: string;
  /** "avg (20d)" when the figure is a real multi-day average, else null. */
  label: string | null;
  /** The one-day (usually results-day) turnover, when that is all we have. */
  oneDayCr: number | null;
}

/** Fewest sessions a traded-value figure must cover to count as an average. */
export const MIN_ADTV_DAYS = 10;

/**
 * The real multi-day average traded value (₹ Cr/day) and the days it covers,
 * or nulls. zzz826 — `adtv_cr` counts only when it carries `adtv_days`
 * (enrichment sets that from Yahoo's daily history). A stored `adtv_cr`
 * without it may be ONE day's turnover (the bhavcopy fallback before zzz826
 * stored the results-day figure there), so it is unknown, not small.
 */
export function realAdtv(r: any): { cr: number | null; days: number | null } {
  const explicit = [r?.adtv_20d_cr, r?.avg_traded_value_cr].find(fin);
  if (explicit != null && explicit > 0) return { cr: explicit, days: fin(r?.adtv_days) ? r.adtv_days : 20 };
  if (fin(r?.adtv_cr) && r.adtv_cr > 0 && fin(r?.adtv_days) && r.adtv_days >= MIN_ADTV_DAYS) return { cr: r.adtv_cr, days: r.adtv_days };
  return { cr: null, days: null };
}

/**
 * The 💧 traded-value chip. Only a real multi-day average is shown ("avg
 * (20d)"); anything else is '—'. Still hidden when implausible (above 5% of
 * market cap per day). A one-day turnover is named as such in the tooltip.
 */
export function liquidityView(r: any): LiquidityView {
  const { cr: raw, days } = realAdtv(r);
  const oneDay = fin(r?.turnover_1d_cr) && r.turnover_1d_cr > 0 ? r.turnover_1d_cr : null;
  const mcap = fin(r?.market_cap_cr) && r.market_cap_cr > 0 ? r.market_cap_cr : null;
  const base = 'Average value of shares traded per day (₹ Cr).';
  const oneDayBit = oneDay != null ? ` One day's turnover (usually results day) was ₹${oneDay >= 1 ? oneDay.toFixed(1) + ' Cr' : Math.round(oneDay * 100) + ' L'} — one day is not an average, so it is not used.` : '';
  if (raw == null) return { cr: null, note: 'not in source', label: null, oneDayCr: oneDay, title: `${base} No multi-day average is on file for this company.${oneDayBit}` };
  if (mcap != null && (raw / mcap) * 100 > MAX_PLAUSIBLE_DAILY_TURNOVER_PCT) {
    return {
      cr: null, note: 'not a daily average', label: null, oneDayCr: oneDay,
      title: `${base} The stored figure (₹${Math.round(raw).toLocaleString('en-IN')} Cr) is ${((raw / mcap) * 100).toFixed(1)}% of the market cap in one day — not believable as an average, so it is not shown.`,
    };
  }
  const d = days ?? 20;
  return { cr: raw, note: null, label: `avg (${d}d)`, oneDayCr: oneDay, title: `${base} Median of the last ${d} trading sessions.` };
}

// ─── Size labels: ONE threshold set, shared with the Mkt Cap filter ───────

export type CapBucket = 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO';
/** Market-cap size bands in ₹ Cr (lower bound inclusive). The Mkt Cap filter
 *  and every card label read this one table. */
export const CAP_BUCKETS: ReadonlyArray<{ key: CapBucket; min: number; label: string }> = [
  { key: 'MEGA', min: 200_000, label: '≥ ₹2,00,000 Cr' },
  { key: 'LARGE', min: 20_000, label: '₹20,000 – 2,00,000 Cr' },
  { key: 'MID', min: 5_000, label: '₹5,000 – 20,000 Cr' },
  { key: 'SMALL', min: 500, label: '₹500 – 5,000 Cr' },
  { key: 'MICRO', min: 0, label: '< ₹500 Cr' },
];

/** The size band of a market cap, or null when the cap is unknown. */
export function capBucket(cr: any): CapBucket | null {
  if (!fin(cr) || cr <= 0) return null;
  for (const b of CAP_BUCKETS) if (cr >= b.min) return b.key;
  return 'MICRO';
}

/** Filter test: 'all', a band, or 'sweet' (the ₹5k–50k Cr multibagger band). */
export function capInBand(cr: any, f: string): boolean {
  if (f === 'all') return true;
  if (!fin(cr)) return false;
  if (f === 'sweet') return cr >= 5_000 && cr <= 50_000;
  return capBucket(cr) === String(f).toUpperCase();
}

// ─── Cash tile ────────────────────────────────────────────────────────────

export interface CashTileView { text: string; note: string; color: 'good' | 'warn' | 'bad' | 'none'; basis: string | null }

/** zzz1068 — the same-fiscal-year CFO and profit (₹ Cr) the ratio is built from, when both are
 *  real figures labelled with their fiscal year (`cash_fy`). Lenders never get one. Pure. */
export function yearCashFigures(r: any): { ocf: number; pat: number; fy: string } | null {
  if (financialKindOfRow(r)) return null;
  return rawYearCash(r);
}
/** zzz1089 — the same figures for ANY company (lenders included: shown as figures, never as a cash test). */
export function rawYearCash(r: any): { ocf: number; pat: number; fy: string } | null {
  const gi = r?.grade_input || {};
  const fy = [r?.cash_fy, gi.cash_fy].find((x) => typeof x === 'string' && x.trim());
  const ocf = [r?.ocf_annual_cr, gi.ocf_annual_cr].find(fin);
  const pat = [r?.pat_annual_cr, gi.pat_annual_cr].find(fin);
  if (!fy || ocf == null || pat == null || ocf === 0 || pat === 0) return null;
  return { ocf, pat, fy: String(fy).trim() };
}

/** "₹723 Cr" / "−₹231 Cr" (one decimal under 10). Pure. */
export function fmtCrSigned(v: number): string {
  const a = Math.abs(v);
  const s = a < 10 ? (Math.round(a * 10) / 10).toString() : Math.round(a).toLocaleString('en-IN');
  return `${v < 0 ? '−' : ''}₹${s} Cr`;
}

/**
 * The CFO/PAT tile. '—' when the ratio is missing or exactly 0.00 (the feed's
 * "no figure"); "not meaningful for lenders" for banks / NBFCs / insurers
 * (their operating cash flow is loan growth); the engine's cash basis
 * ("FY26 full year") shown under the ratio when present.
 */
/** zzz1089 — figures read from the company's screener.in page when the feed has none (/api/v1/fin-fallback). */
export interface CashFallback { cfo: number | null; pat: number | null; fy: string | null }

const ratioNote = (v: number) => (v < 0 ? 'operations burned cash' : v < 0.6 ? 'below the divergence line' : v < 1 ? 'partly cash-backed'
  : v >= CASH_RATIO_HIGH ? 'profit small vs cash' : 'earnings are cash-backed');

export function cashTileView(r: any, fb?: CashFallback | null): CashTileView {
  const basis = typeof r?.cash_basis === 'string' && r.cash_basis.trim() ? r.cash_basis.trim()
    : (typeof r?.cash_fy === 'string' && r.cash_fy.trim() ? `${r.cash_fy.trim()} full year` : null);
  const fbYear = fb && fin(fb.cfo) && fin(fb.pat) && fb.fy ? { ocf: fb.cfo, pat: fb.pat, fy: fb.fy } : null;
  const fk = financialKindOfRow(r);
  if (fk) {
    // zzz1089 — not every financial company is a lender: an asset manager / fintech / exchange gets the normal cash test; a bank,
    // NBFC, broker or insurer gets its real figures shown (loan book and client money move its operating cash) instead of "—"
    const sub = finSubKind(r, true);
    const yr = rawYearCash(r) || fbYear;
    const yb = yr ? `${yr.fy} full year` : basis;
    if (sub === 'asset-light' && yr && yr.pat > 0) {
      const v = Math.round((yr.ocf / yr.pat) * 100) / 100;
      return { text: `${v.toFixed(2)}x`, note: `${ratioNote(v)} · not part of the grade`, color: v < 0.6 ? 'bad' : v < 1 ? 'warn' : 'good', basis: yb };
    }
    const word = FIN_KIND_WORD[sub || 'nbfc'];
    // zzz1094 — owner: a plain ratio like every other card ("−7.69x"), short note; grey (a lender's cash is loan growth)
    if (yr && yr.pat > 0) { const v = Math.round((yr.ocf / yr.pat) * 100) / 100; return { text: `${v.toFixed(2)}x`, note: `${sub === 'bank' ? 'bank' : sub === 'broker' ? 'broker' : 'lender'} · not graded`, color: v < 0.6 ? 'bad' : v < 1 ? 'warn' : 'good', basis: yb }; }
    // zzz1100 — owner: same green / amber / red as every other card (colour only; it still does not count in the grade)
    if (yr) return { text: `CFO ${fmtCrSigned(yr.ocf)}`, note: `loss year · ${word}`, color: yr.ocf > 0 ? 'warn' : 'bad', basis: yb };
    return { text: `n/a (${word})`, note: 'not meaningful for lenders', color: 'none', basis: null };
  }
  const v0 = [r?.ocf_to_pat_ratio, r?.cfo_to_pat_ratio].find(fin);
  const v = v0 == null && fbYear && fbYear.pat > 0 && Math.abs(fbYear.ocf / fbYear.pat) <= 50 ? Math.round((fbYear.ocf / fbYear.pat) * 100) / 100 : v0;
  if (v0 == null && v != null && fbYear) return { text: `${v.toFixed(2)}x`, note: ratioNote(v), color: v < 0.6 ? 'bad' : v < 1 ? 'warn' : 'good', basis: `${fbYear.fy} full year` };
  if (v == null || v === 0) {
    // zzz1068 — the figures ARE in the source; the ratio is refused because the year's profit was a
    // LOSS (19 of the 20 India non-lender gaps on 15–17 Oct: SOLARA, E2E, CROMPTON …) or tiny. Say so
    // and show the cash figure, instead of "not in source".
    const yr = yearCashFigures(r) || fbYear;
    if (yr) return yr.pat < 0
      ? { text: `CFO ${fmtCrSigned(yr.ocf)}`, note: `loss year (${fmtCrSigned(yr.pat)})`, color: yr.ocf > 0 ? 'warn' : 'bad', basis: basis || `${yr.fy} full year` }
      : { text: `CFO ${fmtCrSigned(yr.ocf)}`, note: `profit ${fmtCrSigned(yr.pat)} too small for a ratio`, color: yr.ocf > 0 ? 'warn' : 'bad', basis: basis || `${yr.fy} full year` };
    return { text: '—', note: 'not in source', color: 'none', basis };
  }
  // zzz826 — ratios up to ±50x are real now (same-year figures); a very high
  // one means profit is small next to cash flow, not "super cash-backed".
  const note = v < 0 ? 'operations burned cash' : v < 0.6 ? 'below the divergence line' : v < 1 ? 'partly cash-backed'
    : v >= CASH_RATIO_HIGH ? 'profit small vs cash' : 'earnings are cash-backed';
  return { text: `${v.toFixed(2)}x`, note, color: v < 0.6 ? 'bad' : v < 1 ? 'warn' : 'good', basis };
}

// ─── Refill / rebuild counts (prewarm) ────────────────────────────────────

/** Cards on a stored day with no financial numbers / no share price. */
export function missingDetailCounts(p: any): { noData: number; noPrice: number } {
  let noData = 0, noPrice = 0;
  for (const list of Object.values(p?.by_tier || {})) {
    if (!Array.isArray(list)) continue;
    for (const r of list as any[]) {
      const hasFin = ['sales_yoy_pct', 'net_profit_yoy_pct', 'pat_yoy_pct', 'eps_yoy_pct', 'sales_curr_cr', 'pat_curr_cr', 'eps_curr'].some((k) => fin(r?.[k]));
      if (!hasFin) noData++;
      if (!(fin(r?.price) && r.price > 0) && !(fin(r?.current_price) && r.current_price > 0)) noPrice++;
    }
  }
  return { noData, noPrice };
}

/**
 * Stored days graded under rules too old to regrade in-process, in rebuild
 * order: OLDEST RULES first (furthest back in `legacyOrder`, which is newest
 * first), then the oldest date. Returns the first not locked, or null.
 */
export function orderStaleRebuilds(stale: ReadonlyArray<{ date: string; version: string }>, legacyOrder: readonly string[]): Array<{ date: string; version: string }> {
  const rank = (v: string) => { const i = legacyOrder.indexOf(v); return i < 0 ? -1 : i; };
  return [...stale].sort((a, b) => (rank(b.version) - rank(a.version)) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
export async function pickStaleRebuild(
  stale: ReadonlyArray<{ date: string; version: string }> | null | undefined,
  legacyOrder: readonly string[],
  isLocked: (date: string) => Promise<boolean>,
): Promise<{ date: string; version: string } | null> {
  for (const x of orderStaleRebuilds(stale || [], legacyOrder)) if (!(await isLocked(x.date))) return x;
  return null;
}
